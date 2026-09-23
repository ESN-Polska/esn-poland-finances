#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import * as DDB from 'aws-cdk-lib/aws-dynamodb';

import { ApiDomainStack } from './api-domain-stack';
import { MediaStack } from './media-stack';
import { SESStack } from './ses-stack';
import { ResourceController, ApiStack, DDBTable } from './api-stack';
import { FrontEndStack } from './front-end-stack';

import { parameters, stages, Stage, DOMAIN, PROD_CUSTOM_DOMAIN } from './environments';

//
// API RESOURCES & CONTROLLER DEFINITIONS
//

const apiResources: ResourceController[] = [
  { name: 'auth', isAuthFunction: true },
  { name: 'login', paths: ['/login'] },
  { name: 'requests', paths: ['/requests', '/requests/{id}', '/requests/{year}/{id}'] },
  { name: 'configurations', paths: ['/configurations'] },
  { name: 'users', paths: ['/users', '/users/{userId}'] },
  { name: 'contributors', paths: ['/contributors'] },
  { name: 'refreshContributors' },
  { name: 'media', paths: ['/media'] },
  { name: 'sesNotifications' }
];

//
// DYNAMODB TABLES SPECIFICATION
//

const tables: { [tableName: string]: DDBTable } = {
  configurations: {
    PK: { name: 'PK', type: DDB.AttributeType.STRING }
  },
  contributors: {
    PK: { name: 'PK', type: DDB.AttributeType.STRING }
  },
  users: {
    PK: { name: 'userId', type: DDB.AttributeType.STRING }
  },
  financial_requests: {
    PK: { name: 'requestId', type: DDB.AttributeType.STRING },
    indexes: [
      {
        indexName: 'byUser',
        partitionKey: { name: 'userId', type: DDB.AttributeType.STRING },
        sortKey: { name: 'createdAt', type: DDB.AttributeType.STRING }
      },
      {
        indexName: 'byStatus',
        partitionKey: { name: 'status', type: DDB.AttributeType.STRING },
        sortKey: { name: 'createdAt', type: DDB.AttributeType.STRING }
      }
    ]
  },
  idea_emailsBlocklist: {
    PK: { name: 'email', type: DDB.AttributeType.STRING },
    expiresAtField: 'expiresAt'
  }
};

//
// CDK APP SYNTHESIS
//

const app = new cdk.App();

// Environment lookup
const env: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION || 'eu-central-1'
};

// 1. SES Stack (Domain identity & notification topics)
const sesStack = new SESStack(app, `${parameters.project}-ses`, {
  env,
  project: parameters.project,
  domain: DOMAIN
});

// 2. Api Domain Stack
const apiDomainStack = new ApiDomainStack(app, `${parameters.project}-api-domain`, {
  env,
  domain: parameters.apiDomain
});

// 3. Media Stack (S3 + CloudFront CDN)
const mediaStack = new MediaStack(app, `${parameters.project}-media`, {
  env,
  mediaBucketName: `${parameters.project}-media`,
  mediaDomain: parameters.mediaDomain
});

// 4. Per-Stage Deployment (Dev or Prod based on context, e.g. --context stage=dev)
const targetStage = app.node.tryGetContext('stage') as string | undefined;
const activeStages = targetStage && (stages as any)[targetStage]
  ? { [targetStage]: (stages as any)[targetStage] as Stage }
  : stages;

for (const [stageName, stageConfig] of Object.entries(activeStages)) {
  const stackPrefix = `${parameters.project}-${stageName}`;

  // API & Compute Stack
  const apiStack = new ApiStack(app, `${stackPrefix}-api`, {
    env,
    project: parameters.project,
    stage: stageName,
    apiDomain: parameters.apiDomain,
    resourceControllers: apiResources,
    tables,
    mediaBucketArn: mediaStack.mediaBucketArn,
    ses: {
      identityArn: sesStack.identityArn,
      notificationTopicArn: sesStack.notificationTopicArn
    },
    removalPolicy: stageConfig.destroyDataOnDelete ? cdk.RemovalPolicy.DESTROY : cdk.RemovalPolicy.RETAIN,
    lambdaLogLevel: stageConfig.logLevel || 'INFO',
    appDomain: stageConfig.alternativeDomains?.[0] || stageConfig.domain
  });

  // Front-End Static Hosting Stack
  new FrontEndStack(app, `${stackPrefix}-front-end`, {
    env,
    project: parameters.project,
    stage: stageName,
    domain: stageConfig.domain,
    alternativeDomains: stageConfig.alternativeDomains,
    certificateARN: parameters.frontEndCertificateARN
  });
}

app.synth();
