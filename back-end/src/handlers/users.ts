import { DynamoDB, HandledError, ResourceController } from 'idea-aws';
import { AppPermission, Configurations } from '../models/configurations.model';
import { User } from '../models/user.model';
import { findCountryMatch, getCountriesLibrary } from '../services/esnCountries';

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
    const isSelf = this.callerUser?.userId?.toLowerCase() === userId;
    try {
      if (DDB_TABLES.users) {
        this.targetUser = await ddb.get({ TableName: DDB_TABLES.users, Key: { userId } });
      }
      if (!this.targetUser) {
        if (isSelf) {
          this.targetUser = JSON.parse(JSON.stringify(this.callerUser));
          this.targetUser.userId = userId;
        } else {
          throw new HandledError('User not found');
        }
      }
    } catch {
      if (isSelf) {
        this.targetUser = JSON.parse(JSON.stringify(this.callerUser));
        this.targetUser.userId = userId;
      } else {
        throw new HandledError('User not found');
      }
    }
  }

  protected async getResource(): Promise<any> {
    return this.targetUser;
  }

  protected async patchResource(): Promise<any> {
    const userId = this.resourceId?.toLowerCase();
    if (!userId) throw new HandledError('Missing userId parameter');

    const isSelf = this.callerUser.userId?.toLowerCase() === userId;
    const isAdmin = this.callerUser.isAdministrator;

    if (!isSelf && !isAdmin) {
      this.returnStatusCode = 403;
      throw new HandledError('Forbidden: you can only update your own profile');
    }

    if (!DDB_TABLES.users) {
      throw new HandledError('Users database table is not configured');
    }

    let userRecord = this.targetUser;
    if (!userRecord) {
      userRecord = await ddb.get({ TableName: DDB_TABLES.users, Key: { userId } });
    }
    if (!userRecord) {
      userRecord = JSON.parse(JSON.stringify(this.callerUser));
      userRecord.userId = userId;
    }

    if (this.body?.disabledEmailNotifications !== undefined) {
      if (!Array.isArray(this.body.disabledEmailNotifications)) {
        throw new HandledError('disabledEmailNotifications must be an array of strings');
      }
      const rawList = this.body.disabledEmailNotifications;
      const sanitized = Array.from(
        new Set(
          rawList
            .filter((item: any) => typeof item === 'string' && item.trim().length > 0)
            .map((item: string) => item.trim())
        )
      );
      userRecord.disabledEmailNotifications = sanitized;
    }

    // Update primary section
    if (this.body?.sectionCode !== undefined || this.body?.section !== undefined) {
      userRecord.primarySectionChosen = true;
      const targetCode = String(this.body.sectionCode || '').trim();
      const targetName = String(this.body.section || '').trim();
      const availableSections: any[] = userRecord.availableSections || [];

      if (availableSections.length > 0) {
        const match = availableSections.find(
          (s: any) =>
            (targetCode && String(s.code || '').toLowerCase() === targetCode.toLowerCase()) ||
            (targetName && String(s.name || '').toLowerCase() === targetName.toLowerCase())
        );
        if (!match && !isAdmin) {
          throw new HandledError('Selected section is not among your available sections');
        }
        if (match) {
          userRecord.sectionCode = match.code || '';
          userRecord.section = match.name || '';
        } else if (isAdmin) {
          userRecord.sectionCode = targetCode;
          userRecord.section = targetName;
        }
      } else if (isAdmin) {
        userRecord.sectionCode = targetCode;
        userRecord.section = targetName;
      }

      // If country not explicitly passed, align country with this section's prefix
      if (this.body?.country === undefined && userRecord.sectionCode) {
        const prefix = String(userRecord.sectionCode).split('-')[0]?.toUpperCase().trim();
        let availableCountries: any[] = userRecord.availableCountries || [];
        if (prefix) {
          let matchedCountry = findCountryMatch(prefix, availableCountries);
          if (!matchedCountry) {
            const library = await getCountriesLibrary();
            matchedCountry = findCountryMatch(prefix, library);
            if (matchedCountry) {
              if (!availableCountries.some((c: any) => c.code === matchedCountry?.code)) {
                availableCountries.push(matchedCountry);
                userRecord.availableCountries = availableCountries;
              }
            }
          }
          if (matchedCountry) {
            userRecord.country = matchedCountry.name || matchedCountry.code;
          }
        }
      }
    }

    // Update primary country
    if (this.body?.country !== undefined) {
      const targetCountry = String(this.body.country || '').trim();
      const availableCountries: any[] = userRecord.availableCountries || [];

      if (availableCountries.length > 0) {
        const match = availableCountries.find(
          (c: any) =>
            (c.name && String(c.name || '').toLowerCase() === targetCountry.toLowerCase()) ||
            (c.code && String(c.code || '').toLowerCase() === targetCountry.toLowerCase())
        );
        if (!match && !isAdmin) {
          throw new HandledError('Selected country is not among your available countries');
        }
        if (match) {
          userRecord.country = match.name || match.code || targetCountry;
        } else if (isAdmin) {
          userRecord.country = targetCountry;
        }
      } else if (isAdmin) {
        userRecord.country = targetCountry;
      }
    }

    if (this.body?.primarySectionChosen !== undefined) {
      userRecord.primarySectionChosen = !!this.body.primarySectionChosen;
    }

    await ddb.put({
      TableName: DDB_TABLES.users,
      Item: userRecord
    });

    this.targetUser = userRecord;
    return userRecord;
  }

  protected async getResources(): Promise<any[]> {
    if (!DDB_TABLES.users) return [];

    const search = this.queryParams?.search ? String(this.queryParams.search).toLowerCase() : '';
    const includeRoleAssignments = this.queryParams?.roleAssignments === 'true';
    const canViewRoleAssignments =
      this.callerUser?.isAdministrator ||
      this.callerUser?.hasPermission(AppPermission.CONFIGURATIONS.USERS) ||
      this.callerUser?.hasPermission(AppPermission.CONFIGURATIONS.ROLES);

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

    const includeGuests = this.queryParams?.includeGuests === 'true';
    let rawUsers: any[] = (await ddb.scan({ TableName: DDB_TABLES.users })) || [];

    // Skip guest users unless specifically requested with ?includeGuests=true
    if (!includeGuests) {
      rawUsers = rawUsers.filter(
        u => !u.isGuest && !String(u.userId || '').toLowerCase().startsWith('guest_') && !(u.roles || []).includes('GUEST')
      );
    }

    // Merge any known configured users who might not have logged in yet
    const existingIds = new Set(rawUsers.map(u => String(u.userId || '').toLowerCase()));
    const knownConfigUserIds = Array.from(new Set([
      ...(configurations.administratorsIds || []),
      ...(configurations.managersIds || []),
      ...(configurations.auditorsIds || []),
      ...(configurations.blockedUserIds || []),
      ...(configurations.customRoles || []).reduce((acc, r) => [...acc, ...(r.userIds || [])], [] as string[])
    ].map(id => String(id || '').toLowerCase().trim()).filter(Boolean)));

    for (const configUserId of knownConfigUserIds) {
      if (!existingIds.has(configUserId) && !configUserId.startsWith('guest_')) {
        rawUsers.push({
          userId: configUserId,
          firstName: '',
          lastName: '',
          name: '',
          email: '',
          section: '',
          sectionCode: '',
          country: '',
          roles: [],
          extendedRoles: [],
          lastLoginAt: ''
        });
        existingIds.add(configUserId);
      }
    }

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

    return rawUsers.map(rawUser => {
      const user = new User(rawUser);
      User.applyConfigurationPermissions(user, configurations);

      const manualSources = [
        ...(configurations.administratorsIds.includes(user.userId)
          ? [{ roleId: 'ADMINISTRATOR', roleName: 'ADMINISTRATOR', matchedExtendedRole: 'manual' }]
          : []),
        ...((configurations.managersIds || []).includes(user.userId)
          ? [{ roleId: 'MANAGER', roleName: 'MANAGER', matchedExtendedRole: 'manual' }]
          : []),
        ...((configurations.auditorsIds || []).includes(user.userId)
          ? [{ roleId: 'AUDITOR', roleName: 'AUDITOR', matchedExtendedRole: 'manual' }]
          : [])
      ];

      const customSources: Array<{ roleId: string; roleName: string; matchedExtendedRole: string }> = [];
      const seenCustomKeys = new Set<string>();

      for (const role of configurations.customRoles || []) {
        if (!user.customRoleIds.includes(role.id)) continue;

        if (role.userIds.includes(user.userId)) {
          customSources.push({ roleId: role.id, roleName: role.name, matchedExtendedRole: 'manual' });
        }

        for (const pattern of role.extendedRolePatterns || []) {
          if (User.matchesRolePattern(user, pattern)) {
            const key = `${role.id}:::${pattern}`;
            if (!seenCustomKeys.has(key)) {
              seenCustomKeys.add(key);
              customSources.push({ roleId: role.id, roleName: role.name, matchedExtendedRole: pattern });
            }
          }
        }
      }

      const builtInSources: Array<{ roleId: string; roleName: string; matchedExtendedRole: string }> = [];
      const seenBuiltInKeys = new Set<string>();
      const builtInOrder = ['ADMINISTRATOR', 'MANAGER', 'AUDITOR'];

      for (const targetRoleId of builtInOrder) {
        const matchingAssignments = (configurations.automaticRoleAssignments || []).filter(
          assignment => assignment.roleId === targetRoleId
        );

        for (const assignment of matchingAssignments) {
          for (const pattern of assignment.extendedRolePatterns || []) {
            if (User.matchesRolePattern(user, pattern)) {
              const key = `${assignment.roleId}:::${pattern}`;
              if (!seenBuiltInKeys.has(key)) {
                seenBuiltInKeys.add(key);
                builtInSources.push({
                  roleId: assignment.roleId,
                  roleName: assignment.roleId.replace(/_/g, ' '),
                  matchedExtendedRole: pattern
                });
              }
            }
          }
        }
      }

      return {
        ...rawUser,
        roleAssignmentSources: [...manualSources, ...builtInSources, ...customSources]
      };
    });
  }
}
