import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import * as Lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, NodejsFunctionProps } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as IAM from 'aws-cdk-lib/aws-iam';
import * as ApiGw from 'aws-cdk-lib/aws-apigatewayv2';
import * as ApiGwAlpha from '@aws-cdk/aws-apigatewayv2-alpha';
import * as ApiGwAlphaIntegrations from '@aws-cdk/aws-apigatewayv2-integrations-alpha';
import * as ApiGwAlphaAuthorizers from '@aws-cdk/aws-apigatewayv2-authorizers-alpha';
import * as DDB from 'aws-cdk-lib/aws-dynamodb';

export interface ApiProps extends cdk.StackProps {
  project: string;
  stage: string;
  apiDomain: string;
  resourceControllers: ResourceController[];
  tables: { [tableName: string]: DDBTable };
  mediaBucketArn: string;
  ses: { identityArn: string; notificationTopicArn: string };
  removalPolicy: RemovalPolicy;
  lambdaLogLevel: 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';
  appDomain: string;
}

export interface ResourceController {
  name: string;
  paths?: string[];
  isAuthFunction?: boolean;
}

export interface DDBTable {
  PK: DDB.Attribute;
  SK?: DDB.Attribute;
  indexes?: DDB.GlobalSecondaryIndexProps[];
  stream?: DDB.StreamViewType;
  expiresAtField?: string;
}

const defaultLambdaFnProps: NodejsFunctionProps = {
  runtime: Lambda.Runtime.NODEJS_22_X,
  architecture: Lambda.Architecture.ARM_64,
  timeout: Duration.seconds(30),
  memorySize: 512,
  bundling: { minify: true, sourceMap: true },
  environment: { NODE_OPTIONS: '--enable-source-maps' },
  loggingFormat: Lambda.LoggingFormat.JSON
};

const defaultDDBTableProps = {
  billingMode: DDB.BillingMode.PAY_PER_REQUEST,
  pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true }
};

export class ApiStack extends cdk.Stack {
  public readonly httpApi: ApiGwAlpha.HttpApi;
  public readonly ddbTables: { [name: string]: DDB.Table } = {};
  public readonly functions: { [name: string]: NodejsFunction } = {};

  constructor(scope: Construct, id: string, props: ApiProps) {
    super(scope, id, props);

    // 1. Create DynamoDB Tables
    for (const [tableName, tableDef] of Object.entries(props.tables)) {
      const fullTableName = `${props.project}-${props.stage}-${tableName}`;
      const table = new DDB.Table(this, `Table_${tableName}`, {
        tableName: fullTableName,
        partitionKey: tableDef.PK,
        sortKey: tableDef.SK,
        billingMode: defaultDDBTableProps.billingMode,
        pointInTimeRecoverySpecification: defaultDDBTableProps.pointInTimeRecoverySpecification,
        removalPolicy: props.removalPolicy,
        timeToLiveAttribute: tableDef.expiresAtField,
        stream: tableDef.stream
      });

      if (tableDef.indexes) {
        for (const idx of tableDef.indexes) {
          table.addGlobalSecondaryIndex(idx);
        }
      }

      this.ddbTables[tableName] = table;
    }

    // 2. Base Environment Variables for Lambda Functions
    const lambdaEnv: { [key: string]: string } = {
      STAGE: props.stage,
      PROJECT: props.project,
      APP_DOMAIN: props.appDomain,
      SES_IDENTITY_ARN: props.ses.identityArn,
      SES_NOTIFICATION_TOPIC_ARN: props.ses.notificationTopicArn,
      LOG_LEVEL: props.lambdaLogLevel,
      S3_BUCKET_MEDIA: `${props.project}-media`,
      S3_IMAGES_FOLDER: `images/${props.stage}`
    };
    for (const [tableName, table] of Object.entries(this.ddbTables)) {
      lambdaEnv[`DDB_TABLE_${tableName}`] = table.tableName;
    }

    // 3. Create Lambda Authorizer if present
    let httpAuthorizer: ApiGwAlphaAuthorizers.HttpLambdaAuthorizer | undefined;
    const authController = props.resourceControllers.find(c => c.isAuthFunction);
    if (authController) {
      const authFn = new NodejsFunction(this, `Fn_${authController.name}`, {
        ...defaultLambdaFnProps,
        entry: `src/handlers/${authController.name}.ts`,
        environment: lambdaEnv,
        memorySize: 256
      });
      this.functions[authController.name] = authFn;

      httpAuthorizer = new ApiGwAlphaAuthorizers.HttpLambdaAuthorizer(
        'HttpAuthorizer',
        authFn,
        {
          responseTypes: [ApiGwAlphaAuthorizers.HttpLambdaResponseType.SIMPLE],
          identitySource: ['$request.header.Authorization']
        }
      );
    }

    // 4. Create HTTP API Gateway v2
    this.httpApi = new ApiGwAlpha.HttpApi(this, 'HttpApi', {
      apiName: `${props.project}-${props.stage}-api`,
      corsPreflight: {
        allowHeaders: ['Authorization', 'Content-Type', 'X-Requested-With'],
        allowMethods: [
          ApiGwAlpha.CorsHttpMethod.GET,
          ApiGwAlpha.CorsHttpMethod.POST,
          ApiGwAlpha.CorsHttpMethod.PUT,
          ApiGwAlpha.CorsHttpMethod.PATCH,
          ApiGwAlpha.CorsHttpMethod.DELETE,
          ApiGwAlpha.CorsHttpMethod.OPTIONS
        ],
        allowOrigins: ['*']
      }
    });

    // 5. Create Controller Lambda Functions and Register Routes
    for (const controller of props.resourceControllers) {
      if (controller.isAuthFunction) continue;

      const fn = new NodejsFunction(this, `Fn_${controller.name}`, {
        ...defaultLambdaFnProps,
        entry: `src/handlers/${controller.name}.ts`,
        environment: lambdaEnv
      });
      this.functions[controller.name] = fn;

      // Grant permissions to all DynamoDB tables
      for (const table of Object.values(this.ddbTables)) {
        table.grantReadWriteData(fn);
      }

      // Grant permissions to S3 media bucket
      fn.addToRolePolicy(
        new IAM.PolicyStatement({
          actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
          resources: [`${props.mediaBucketArn}/*`]
        })
      );

      // Register routes if controller specifies paths
      if (controller.paths && controller.paths.length > 0) {
        const integration = new ApiGwAlphaIntegrations.HttpLambdaIntegration(
          `Integration_${controller.name}`,
          fn
        );

        for (const path of controller.paths) {
          if (controller.name === 'configurations' && path === '/configurations') {
            // GET /configurations is public (loaded on app startup before auth)
            this.httpApi.addRoutes({
              path,
              methods: [ApiGwAlpha.HttpMethod.GET],
              integration,
              authorizer: undefined
            });
            // PUT /configurations is protected
            this.httpApi.addRoutes({
              path,
              methods: [ApiGwAlpha.HttpMethod.PUT, ApiGwAlpha.HttpMethod.PATCH],
              integration,
              authorizer: httpAuthorizer
            });
          } else {
            const isPublic = path === '/login' || path === '/public-info';
            this.httpApi.addRoutes({
              path,
              methods: [ApiGwAlpha.HttpMethod.ANY],
              integration,
              authorizer: isPublic ? undefined : httpAuthorizer
            });
          }
        }
      }
    }

    // 6. Common IAM Policies (Systems Manager / SSM parameter access for JWT secrets)
    const accessSystemsManagerPolicy = new IAM.Policy(this, 'AccessSystemsManager', {
      statements: [
        new IAM.PolicyStatement({
          effect: IAM.Effect.ALLOW,
          actions: ['ssm:GetParameter', 'ssm:GetParameters'],
          resources: ['*']
        })
      ]
    });

    // Grant SSM & DDB to auth function if present
    if (authController && this.functions[authController.name]) {
      const authFn = this.functions[authController.name];
      if (authFn.role) authFn.role.attachInlinePolicy(accessSystemsManagerPolicy);
      for (const table of Object.values(this.ddbTables)) {
        table.grantReadData(authFn);
      }
    }

    // Attach SSM policy to all functions
    for (const fn of Object.values(this.functions)) {
      if (fn.role) fn.role.attachInlinePolicy(accessSystemsManagerPolicy);
    }

    // 7. Custom Domain API Mapping
    new ApiGw.CfnApiMapping(this, 'HttpApiMapping', {
      domainName: props.apiDomain,
      apiId: this.httpApi.httpApiId,
      apiMappingKey: props.stage,
      stage: '$default'
    });

    new cdk.CfnOutput(this, 'HttpApiUrl', { value: this.httpApi.apiEndpoint });
  }
}
