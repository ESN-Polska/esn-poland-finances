import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { RemovalPolicy } from 'aws-cdk-lib';
import * as S3 from 'aws-cdk-lib/aws-s3';
import * as CloudFront from 'aws-cdk-lib/aws-cloudfront';
import * as ACM from 'aws-cdk-lib/aws-certificatemanager';
import * as Route53 from 'aws-cdk-lib/aws-route53';
import * as Route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as IAM from 'aws-cdk-lib/aws-iam';

export interface MediaProps extends cdk.StackProps {
  mediaBucketName: string;
  mediaDomain: string;
}

export class MediaStack extends cdk.Stack {
  public readonly mediaBucketArn: string;

  constructor(scope: Construct, id: string, props: MediaProps) {
    super(scope, id, props);

    const s3MediaBucket = new S3.Bucket(this, 'MediaBucket', {
      bucketName: props.mediaBucketName,
      publicReadAccess: false,
      cors: [
        {
          allowedHeaders: ['*'],
          allowedMethods: [S3.HttpMethods.GET, S3.HttpMethods.PUT],
          allowedOrigins: ['*'],
          exposedHeaders: [],
          maxAge: 3000
        }
      ],
      removalPolicy: RemovalPolicy.DESTROY,
      lifecycleRules: [
        { prefix: 'downloads/', expiration: cdk.Duration.days(1) },
        {
          prefix: 'documents/',
          transitions: [{ storageClass: S3.StorageClass.INFREQUENT_ACCESS, transitionAfter: cdk.Duration.days(180) }]
        },
        {
          prefix: 'receipts/',
          transitions: [{ storageClass: S3.StorageClass.INFREQUENT_ACCESS, transitionAfter: cdk.Duration.days(180) }]
        }
      ]
    });
    this.mediaBucketArn = s3MediaBucket.bucketArn;

    const zone = Route53.HostedZone.fromLookup(this, 'HostedZone', {
      domainName: props.mediaDomain.split('.').slice(-2).join('.')
    });

    const certificate = new ACM.DnsValidatedCertificate(this, 'Certificate', {
      domainName: props.mediaDomain,
      hostedZone: zone,
      region: 'us-east-1'
    });

    const mediaDistributionOAI = new CloudFront.OriginAccessIdentity(this, 'DistributionOAI', {
      comment: `OAI for https://${props.mediaDomain}`
    });

    const mediaDistribution = new CloudFront.CloudFrontWebDistribution(this, 'Distribution', {
      originConfigs: [
        {
          s3OriginSource: { s3BucketSource: s3MediaBucket, originAccessIdentity: mediaDistributionOAI },
          behaviors: [
            { isDefaultBehavior: true, defaultTtl: cdk.Duration.days(7), maxTtl: cdk.Duration.days(30), compress: true }
          ]
        }
      ],
      viewerProtocolPolicy: CloudFront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      priceClass: CloudFront.PriceClass.PRICE_CLASS_100,
      viewerCertificate: CloudFront.ViewerCertificate.fromAcmCertificate(certificate, {
        aliases: [props.mediaDomain],
        securityPolicy: CloudFront.SecurityPolicyProtocol.TLS_V1_2_2021
      })
    });

    s3MediaBucket.addToResourcePolicy(
      new IAM.PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [s3MediaBucket.arnForObjects('*')],
        principals: [
          new IAM.CanonicalUserPrincipal(mediaDistributionOAI.cloudFrontOriginAccessIdentityS3CanonicalUserId)
        ]
      })
    );

    new Route53.ARecord(this, 'DomainRecord', {
      zone: zone,
      recordName: props.mediaDomain,
      target: Route53.RecordTarget.fromAlias(new Route53Targets.CloudFrontTarget(mediaDistribution))
    });

    new cdk.CfnOutput(this, 'MediaBucketName', { value: s3MediaBucket.bucketName });
    new cdk.CfnOutput(this, 'MediaDistributionID', { value: mediaDistribution.distributionId });
  }
}
