import { DynamoDB, HandledError, ResourceController } from 'idea-aws';
import { Configurations } from '../models/configurations.model';
import { User } from '../models/user.model';

const DDB_TABLES = {
  users: process.env.DDB_TABLE_users,
  configurations: process.env.DDB_TABLE_configurations
};
const ddb = new DynamoDB();

export const handler = (ev: any, _: any, cb: any): Promise<void> => new UsersRC(ev, cb).handleRequest();

class UsersRC extends ResourceController {
  callerUser: User;
  targetUser: any;

  constructor(event: any, callback: any) {
    super(event, callback, { resourceId: 'userId' });
    this.callerUser = event.requestContext?.authorizer?.lambda?.user
      ? new User(event.requestContext.authorizer.lambda.user)
      : (null as any);
  }

  protected async checkAuthBeforeRequest(): Promise<void> {
    if (!this.callerUser) throw new HandledError('Unauthorized');

    if (!this.resourceId) return;

    const userId = this.resourceId.toLowerCase();
    try {
      if (DDB_TABLES.users) {
        this.targetUser = await ddb.get({ TableName: DDB_TABLES.users, Key: { userId } });
      }
      if (!this.targetUser) throw new HandledError('User not found');
    } catch {
      throw new HandledError('User not found');
    }
  }

  protected async getResource(): Promise<any> {
    return this.targetUser;
  }

  protected async getResources(): Promise<any[]> {
    if (!DDB_TABLES.users) return [];

    const search = this.queryParams?.search ? String(this.queryParams.search).toLowerCase() : '';
    const includeRoleAssignments = this.queryParams?.roleAssignments === 'true';
    const canViewRoleAssignments =
      this.callerUser?.isAdministrator || this.callerUser?.hasPermission('configurations.users');

    let rawUsers: any[] = (await ddb.scan({ TableName: DDB_TABLES.users })) || [];
    if (search) {
      rawUsers = rawUsers.filter(
        u =>
          u.userId?.toLowerCase().includes(search) ||
          u.name?.toLowerCase().includes(search) ||
          u.firstName?.toLowerCase().includes(search) ||
          u.lastName?.toLowerCase().includes(search) ||
          u.section?.toLowerCase().includes(search)
      );
    }
    rawUsers.sort((a, b): number => (a.name || a.userId || '').localeCompare(b.name || b.userId || ''));

    if (!canViewRoleAssignments || !includeRoleAssignments) {
      return rawUsers.slice(0, 50);
    }

    let configurations = new Configurations({ PK: Configurations.PK });
    if (DDB_TABLES.configurations) {
      try {
        const configData = await ddb.get({
          TableName: DDB_TABLES.configurations,
          Key: { PK: Configurations.PK }
        });
        if (configData) configurations = new Configurations(configData);
      } catch {}
    }

    return rawUsers.map(rawUser => {
      const user = new User(rawUser);
      User.applyConfigurationPermissions(user, configurations);

      const manualSources = [
        ...(configurations.administratorsIds.includes(user.userId)
          ? [{ roleId: 'ADMINISTRATOR', roleName: 'ADMINISTRATOR', matchedExtendedRole: 'manual' }]
          : []),
        ...(configurations.financialManagersIds.includes(user.userId)
          ? [{ roleId: 'FINANCIAL_MANAGER', roleName: 'FINANCIAL MANAGER', matchedExtendedRole: 'manual' }]
          : [])
      ];

      const customSources = (configurations.customRoles || [])
        .filter(role => user.customRoleIds.includes(role.id))
        .reduce((sources, role) => {
          if (role.userIds.includes(user.userId)) {
            sources.push({ roleId: role.id, roleName: role.name, matchedExtendedRole: 'manual' });
          }
          (role.extendedRolePatterns || [])
            .filter(pattern => User.matchesExtendedCASPermission(user, pattern))
            .forEach(matchedExtendedRole => {
              sources.push({ roleId: role.id, roleName: role.name, matchedExtendedRole });
            });
          return sources;
        }, [] as { roleId: string; roleName: string; matchedExtendedRole: string }[]);

      const builtInSources = (configurations.automaticRoleAssignments || [])
        .filter(assignment => User.hasAnyCASPermission(user, assignment.extendedRolePatterns))
        .map(assignment => ({
          roleId: assignment.roleId,
          roleName: assignment.roleId.replace(/_/g, ' '),
          matchedExtendedRole: assignment.extendedRolePatterns.find(p => User.matchesExtendedCASPermission(user, p)) || ''
        }));

      return {
        ...rawUser,
        roleAssignmentSources: [...manualSources, ...customSources, ...builtInSources]
      };
    });
  }
}
