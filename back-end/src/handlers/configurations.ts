import { DynamoDB, HandledError, ResourceController, S3 } from 'idea-aws';
import { AppPermission, Configurations, DEFAULT_CONFIGURATION_PAGE_SECTIONS_ORDER } from '../models/configurations.model';
import { User } from '../models/user.model';

const PROJECT = process.env.PROJECT || 'esn-poland-finances';
const S3_BUCKET_MEDIA = process.env.S3_BUCKET_MEDIA || `${PROJECT}-media`;
const DDB_TABLES = {
  configurations: process.env.DDB_TABLE_configurations
};
const ddb = new DynamoDB();
const s3 = new S3();

export const handler = (ev: any, _: any, cb: any): Promise<void> => new ConfigurationsRC(ev, cb).handleRequest();

class ConfigurationsRC extends ResourceController {
  user: User | null = null;
  configurations!: Configurations;

  constructor(event: any, callback: any) {
    super(event, callback);
    // GET /configurations is public; PUT is protected by authorizer
    this.user = event.requestContext?.authorizer?.lambda?.user
      ? new User(event.requestContext.authorizer.lambda.user)
      : null;
  }

  protected async checkAuthBeforeRequest(): Promise<void> {
    if (!DDB_TABLES.configurations) {
      this.configurations = new Configurations({ PK: Configurations.PK });
      return;
    }

    try {
      const data = await ddb.get({
        TableName: DDB_TABLES.configurations,
        Key: { PK: Configurations.PK }
      });
      this.configurations = new Configurations(data);
    } catch (err) {
      if (String(err).includes('Not found') || (err as any)?.name === 'ResourceNotFoundException') {
        this.configurations = new Configurations({ PK: Configurations.PK });
      } else {
        throw new HandledError('Error loading configuration');
      }
    }
  }

  protected async getResources(): Promise<Configurations> {
    return this.configurations;
  }

  protected async putResources(): Promise<Configurations> {
    if (!this.user) {
      throw new HandledError('Unauthorized');
    }

    this.checkConfigurationUpdatePermissions();

    const existingUpdatedAt = this.configurations?.updatedAt;
    const clientUpdatedAt = this.body?.updatedAt;

    // Optimistic Concurrency Control (OCC):
    // If the database already has an updatedAt, ensure client has provided matching updatedAt.
    if (existingUpdatedAt && (!clientUpdatedAt || clientUpdatedAt !== existingUpdatedAt)) {
      this.returnStatusCode = 409;
      throw new HandledError('CONFIGURATIONS_CONFLICT');
    }

    const newUpdatedAt = new Date().toISOString();
    const newConfigurations = new Configurations({
      ...this.body,
      PK: Configurations.PK,
      updatedAt: newUpdatedAt
    });

    const errors = newConfigurations.validate();
    if (errors.length) {
      throw new HandledError(`Invalid fields: ${errors.join(', ')}`);
    }

    if (DDB_TABLES.configurations) {
      const putParams: any = {
        TableName: DDB_TABLES.configurations,
        Item: JSON.parse(JSON.stringify(newConfigurations))
      };

      if (existingUpdatedAt) {
        putParams.ConditionExpression = '#u = :expectedUpdatedAt';
        putParams.ExpressionAttributeNames = { '#u': 'updatedAt' };
        putParams.ExpressionAttributeValues = { ':expectedUpdatedAt': existingUpdatedAt };
      } else {
        putParams.ConditionExpression = 'attribute_not_exists(#u) OR #u = :expectedUpdatedAt';
        putParams.ExpressionAttributeNames = { '#u': 'updatedAt' };
        putParams.ExpressionAttributeValues = { ':expectedUpdatedAt': clientUpdatedAt || '' };
      }

      try {
        await ddb.put(putParams);
      } catch (err: any) {
        if (err?.name === 'ConditionalCheckFailedException' || String(err).includes('ConditionalCheckFailed')) {
          this.returnStatusCode = 409;
          throw new HandledError('CONFIGURATIONS_CONFLICT');
        }
        throw err;
      }

      // Clean up previous files from S3 if URLs were replaced
      if (this.configurations?.rulesFileURL && newConfigurations.rulesFileURL !== this.configurations.rulesFileURL) {
        await this.deleteOldS3File(this.configurations.rulesFileURL);
      }
      if (this.configurations?.appLogoURL && newConfigurations.appLogoURL !== this.configurations.appLogoURL) {
        await this.deleteOldS3File(this.configurations.appLogoURL);
      }
      if (this.configurations?.appLogoURLDarkMode && newConfigurations.appLogoURLDarkMode !== this.configurations.appLogoURLDarkMode) {
        await this.deleteOldS3File(this.configurations.appLogoURLDarkMode);
      }
    }

    this.configurations = newConfigurations;
    return this.configurations;
  }

  private async deleteOldS3File(fileUrl?: string): Promise<void> {
    if (!fileUrl) return;
    try {
      const url = new URL(fileUrl);
      const mediaDomain = process.env.MEDIA_DOMAIN || 'media.finances.esn-poland.link';
      if (url.hostname === mediaDomain) {
        const key = url.pathname.replace(/^\/+/, '');
        if (key && (key.startsWith('documents/') || key.startsWith('images/'))) {
          await s3.deleteObject({ bucket: S3_BUCKET_MEDIA, key });
        }
      }
    } catch {
      // Ignore URL parsing or S3 errors to prevent blocking configuration updates
    }
  }

  private checkConfigurationUpdatePermissions(): void {
    if (!this.user) throw new HandledError('Unauthorized');
    if (this.user.isAdministrator) return;

    const changedFields = [
      'appTitle',
      'appSubtitle',
      'supportEmail',
      'appLogoURL',
      'appLogoURLDarkMode',
      'timezone',
      'usersOriginDisplay',
      'configurationPageSectionsOrder',
      'administratorsIds',
      'financialManagersIds',
      'customRoles',
      'automaticRoleAssignments',
      'rulesWarningText',
      'rulesFileURL',
      'rulesResolutionNumber',
      'rulesRevisionDate'
    ].filter(field => JSON.stringify(this.body[field]) !== JSON.stringify((this.configurations as any)[field]));

    if (!changedFields.length) return;

    const hasFullConfigurationsRights =
      this.user.isAdministrator ||
      DEFAULT_CONFIGURATION_PAGE_SECTIONS_ORDER.every(section => {
        if (section === 'OPTIONS') return this.user!.hasPermission(AppPermission.CONFIGURATIONS.OPTIONS);
        if (section === 'USERS') return this.user!.hasPermission(AppPermission.CONFIGURATIONS.USERS);
        return false;
      });

    // Tab ordering is restricted to administrators or users with full configuration rights
    if (changedFields.includes('configurationPageSectionsOrder') && !hasFullConfigurationsRights) {
      throw new HandledError('Unauthorized: only users with full configuration rights can reorder configuration tabs');
    }

    const optionFields = [
      'appTitle',
      'appSubtitle',
      'supportEmail',
      'appLogoURL',
      'appLogoURLDarkMode',
      'timezone',
      'usersOriginDisplay'
    ];

    const userFields = [
      'administratorsIds',
      'financialManagersIds',
      'customRoles',
      'automaticRoleAssignments'
    ];

    const rulesTextFields = ['rulesWarningText'];
    const rulesDocumentFields = ['rulesFileURL', 'rulesResolutionNumber', 'rulesRevisionDate'];

    const allowedFields = [
      ...(this.user.hasPermission(AppPermission.CONFIGURATIONS.OPTIONS) ? optionFields : []),
      ...(this.user.hasPermission(AppPermission.CONFIGURATIONS.USERS) ? userFields : []),
      ...(hasFullConfigurationsRights ? ['configurationPageSectionsOrder'] : []),
      ...(this.user.hasPermission(AppPermission.RULES.TEXT) ? rulesTextFields : []),
      ...(this.user.hasPermission(AppPermission.RULES.UPDATE) ? rulesDocumentFields : [])
    ];

    if (changedFields.some(field => !allowedFields.includes(field))) {
      throw new HandledError('Unauthorized: insufficient permissions for updated fields');
    }
  }
}
