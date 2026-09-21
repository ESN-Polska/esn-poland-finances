import { DynamoDB, HandledError, ResourceController } from 'idea-aws';
import { AppPermission, Configurations, DEFAULT_CONFIGURATION_PAGE_SECTIONS_ORDER } from '../models/configurations.model';
import { User } from '../models/user.model';

const DDB_TABLES = {
  configurations: process.env.DDB_TABLE_configurations
};
const ddb = new DynamoDB();

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

    this.configurations = new Configurations({
      ...this.body,
      PK: Configurations.PK
    });

    const errors = this.configurations.validate();
    if (errors.length) {
      throw new HandledError(`Invalid fields: ${errors.join(', ')}`);
    }

    if (DDB_TABLES.configurations) {
      await ddb.put({
        TableName: DDB_TABLES.configurations,
        Item: JSON.parse(JSON.stringify(this.configurations))
      });
    }

    return this.configurations;
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
      'automaticRoleAssignments'
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

    const allowedFields = [
      ...(this.user.hasPermission('configurations.options') ? optionFields : []),
      ...(this.user.hasPermission('configurations.users') ? userFields : []),
      ...(hasFullConfigurationsRights ? ['configurationPageSectionsOrder'] : [])
    ];

    if (changedFields.some(field => !allowedFields.includes(field))) {
      throw new HandledError('Unauthorized: insufficient permissions for updated fields');
    }
  }
}
