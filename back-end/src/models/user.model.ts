import { Resource } from 'idea-toolbox';
import {
  ALL_APP_PERMISSIONS,
  AppPermission,
  Configurations,
  LocalizedText,
  UsersOriginDisplayOptions
} from './configurations.model';

export interface RoleAssignmentSource {
  roleId: string;
  roleName: string;
  matchedExtendedRole: string;
}

export class User extends Resource {
  /** Username in ESN Accounts (lowercase) */
  userId: string;
  /** Email address */
  email: string;
  /** First name */
  firstName: string;
  /** Last name */
  lastName: string;
  /** Section code (e.g. PL-WAR-SGH) */
  sectionCode: string;
  /** Section name (e.g. ESN SGH Warsaw) */
  section: string;
  /** Country */
  country: string;
  /** Avatar URL from ESN Accounts */
  avatarURL: string;
  /** ESN Accounts roles */
  roles: string[];
  /** Scoped extended roles (e.g. PL-WAR-SGH:section-treasurer, PL:country-president) */
  extendedRoles: string[];
  /** ISO timestamp of last login */
  lastLoginAt: string;
  /** Administrator flag */
  isAdministrator: boolean;
  /** Manager flag */
  isManager: boolean;
  /** Auditor flag */
  isAuditor: boolean;
  /** Whether the user can manage finances (full rights except user management) */
  canManageFinances: boolean;
  /** Effective application permissions */
  permissions: AppPermission[];
  /** IDs of custom roles granted to this user */
  customRoleIds: string[];
  /** Source breakdown for inherited/automatic roles */
  roleAssignmentSources: RoleAssignmentSource[];
  /** Whether the user is an external guest without an ESN Account */
  isGuest: boolean;
  /** Guest invitation ID / token reference if authenticated as guest */
  guestInvitationId?: string;
  /** Purpose / event for the guest reimbursement */
  guestPurpose?: string;
  /** Optional prefilled position for the guest */
  guestPosition?: string;
  /** Optional prefilled default source of funding for the guest */
  guestDefaultSourceOfFunding?: string;
  /** Allowed request types for this guest */
  guestAllowedRequestTypes?: string[];
  /** Optional reimbursement amount limit for this guest */
  guestMaxAmount?: number;
  /** Optional custom localized instructions for this guest */
  guestInstructions?: LocalizedText;
  /** Types of automatic email notifications disabled by user */
  disabledEmailNotifications?: string[];

  constructor(data?: any) {
    super();
    if (data) {
      this.load(data);
    }
  }

  /** Match role pattern (supporting * wildcard, e.g. PL:country-*, *:section-treasurer) against user's extendedRoles/roles */
  static matchesRolePattern(user: User, pattern: string): boolean {
    const roles = (user.extendedRoles && user.extendedRoles.length > 0) ? user.extendedRoles : (user.roles || []);
    const normalizedPattern = pattern.toLowerCase().trim();
    return roles.some(userRole =>
      new RegExp(`^${normalizedPattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`).test(
        String(userRole).toLowerCase().trim()
      )
    );
  }

  /** Alias for backward compatibility */
  static matchesExtendedCASPermission(user: User, permission: string): boolean {
    return User.matchesRolePattern(user, permission);
  }

  static hasAnyRole(user: User, patterns: string[]): boolean {
    return (patterns || []).some(p => User.matchesRolePattern(user, p));
  }

  static hasAnyCASPermission(user: User, permissions: string[]): boolean {
    return User.hasAnyRole(user, permissions);
  }

  /**
   * Evaluates permissions based on current Configurations:
   * - First user / config admin gets Administrator role (ALL_APP_PERMISSIONS).
   * - Manager gets all permissions EXCEPT configurations.users.
   * - Auditor gets read-only access (view all requests, export).
   * - Custom roles add explicit permissions.
   * - Guest gets zero administrative permissions.
   */
  static applyConfigurationPermissions(user: User, configurations: Configurations): void {
    if (user.isGuest) {
      user.isAdministrator = false;
      user.isManager = false;
      user.isAuditor = false;
      user.canManageFinances = false;
      user.permissions = [];
      user.customRoleIds = [];
      user.roleAssignmentSources = [];
      return;
    }

    const autoRoleAssignments = configurations.automaticRoleAssignments || [];
    const automaticRoleIds = autoRoleAssignments
      .filter(assignment => User.hasAnyRole(user, assignment.extendedRolePatterns))
      .map(assignment => assignment.roleId);

    // 1. Evaluate Administrator status
    user.isAdministrator =
      (configurations.administratorsIds || []).includes(user.userId) ||
      automaticRoleIds.includes('ADMINISTRATOR');

    // 2. Evaluate Manager status
    user.isManager =
      !user.isAdministrator &&
      ((configurations.managersIds || []).includes(user.userId) ||
        automaticRoleIds.includes('MANAGER'));
    user.canManageFinances = user.isAdministrator || user.isManager;

    // 3. Evaluate Auditor status
    user.isAuditor =
      (configurations.auditorsIds || []).includes(user.userId) ||
      automaticRoleIds.includes('AUDITOR');

    // 4. Evaluate Custom Roles
    user.customRoleIds = (configurations.customRoles || [])
      .filter(role => role.userIds.includes(user.userId) || User.hasAnyRole(user, role.extendedRolePatterns))
      .map(role => role.id);

    const assignedCustomRoles = (configurations.customRoles || []).filter(r => user.customRoleIds.includes(r.id));
    const customPerms = assignedCustomRoles.reduce(
      (acc, role) => [...acc, ...(role.permissions || [])],
      [] as AppPermission[]
    );

    // 5. Calculate effective permissions
    if (user.isAdministrator) {
      user.permissions = [...ALL_APP_PERMISSIONS];
    } else if (user.isManager) {
      // Manager has all permissions except configurations, plus any explicitly granted custom permissions
      const configurationsPrefix = AppPermission.CONFIGURATIONS.PARENT;
      const baseManagerPerms = ALL_APP_PERMISSIONS.filter(
        perm => perm !== configurationsPrefix && !perm.startsWith(`${configurationsPrefix}.`)
      );
      user.permissions = Array.from(new Set([...baseManagerPerms, ...customPerms]));
    } else if (user.isAuditor) {
      // Auditor has read-only access across requests and home statistics, plus any custom permissions
      const baseAuditorPerms = [
        AppPermission.REQUESTS.VIEW_ALL,
        AppPermission.REQUESTS.EXPORT,
        AppPermission.HOME.STATISTICS
      ];
      user.permissions = Array.from(new Set([...baseAuditorPerms, ...customPerms]));
    } else {
      user.permissions = Array.from(new Set(customPerms));
    }
  }

  get isAuditorOnly(): boolean {
    if (!this.isAuditor) return false;
    if (this.isAdministrator || this.isManager || this.canManageFinances) return false;
    if (this.hasPermission(AppPermission.REQUESTS.MANAGE)) return false;
    if (this.customRoleIds && this.customRoleIds.length > 0) return false;
    return true;
  }

  hasPermission(permission: AppPermission | string): boolean {
    if (this.isAdministrator) return true;

    // Check explicitly granted permissions first (including custom roles)
    if (
      (this.permissions || []).some(
        granted => permission === granted || permission.startsWith(`${granted}.`)
      )
    ) {
      return true;
    }

    // Manager default fallback: has all current and future permissions except configurations
    if (this.isManager) {
      const configurationsPrefix = AppPermission.CONFIGURATIONS.PARENT;
      if (permission === configurationsPrefix || permission.startsWith(`${configurationsPrefix}.`)) {
        return false;
      }
      return true;
    }

    return false;
  }

  load(x: any): void {
    super.load(x);
    this.userId = this.clean(x.userId, String)?.toLowerCase();
    this.email = this.clean(x.email, String);
    this.firstName = this.clean(x.firstName, String);
    this.lastName = this.clean(x.lastName, String);
    this.sectionCode = this.clean(x.sectionCode, String);
    this.section = this.clean(x.section, String);
    this.country = this.clean(x.country, String);
    this.avatarURL = this.clean(x.avatarURL, String);
    this.roles = this.cleanArray(x.roles, String);
    this.extendedRoles = this.cleanArray(x.extendedRoles, String);
    this.lastLoginAt = this.clean(x.lastLoginAt, String);
    this.isAdministrator = this.clean(x.isAdministrator, Boolean, false);
    this.isManager = this.clean(x.isManager, Boolean, false);
    this.isAuditor = this.clean(x.isAuditor, Boolean, false);
    this.canManageFinances = this.clean(x.canManageFinances, Boolean, false);
    this.permissions = this.cleanArray(x.permissions, String) as AppPermission[];
    this.customRoleIds = this.cleanArray(x.customRoleIds, String);
    this.roleAssignmentSources = this.cleanArray(x.roleAssignmentSources, Object) as RoleAssignmentSource[];
    this.isGuest = this.clean(x.isGuest, Boolean, false);
    this.guestInvitationId = this.clean(x.guestInvitationId, String);
    this.guestPurpose = this.clean(x.guestPurpose, String);
    this.guestPosition = this.clean(x.guestPosition, String);
    this.guestDefaultSourceOfFunding = this.clean(x.guestDefaultSourceOfFunding, String);
    this.guestAllowedRequestTypes = this.cleanArray(x.guestAllowedRequestTypes, String);
    this.guestMaxAmount =
      x.guestMaxAmount !== undefined && x.guestMaxAmount !== null && x.guestMaxAmount !== ''
        ? Number(x.guestMaxAmount)
        : undefined;
    if (x.guestInstructions && typeof x.guestInstructions === 'object') {
      this.guestInstructions = {
        en: this.clean(x.guestInstructions.en, String),
        pl: this.clean(x.guestInstructions.pl, String)
      };
    }
    this.disabledEmailNotifications = this.cleanArray(x.disabledEmailNotifications, String);
  }

  isEmailNotificationEnabled(templateType: string): boolean {
    return !(this.disabledEmailNotifications || []).includes(templateType);
  }

  getDisplayName(): string {
    const parts = [this.firstName, this.lastName].filter(Boolean);
    return parts.length > 0 ? parts.join(' ') : this.userId;
  }

  getAccountsProfileURL(): string {
    return this.userId ? `https://accounts.esn.org/user/${encodeURIComponent(this.userId)}` : 'https://accounts.esn.org';
  }

  getSectionOrCountry(): string {
    const section = (this.section || this.sectionCode || '').trim();
    if (section && section !== 'undefined') {
      return section;
    }
    const country = (this.country || '').trim();
    if (country && country !== 'undefined') {
      return country;
    }
    return '';
  }

  getOrigin(displayOption: UsersOriginDisplayOptions = UsersOriginDisplayOptions.BOTH): string | null {
    return getUserOrigin(this, displayOption);
  }
}

export const getUserOrigin = (
  user: { country?: string; section?: string },
  displayOption: UsersOriginDisplayOptions
): string | null => {
  const isUnknown = (val?: string) => !val || val.trim().toLowerCase() === 'unknown';
  const cleanCountry = isUnknown(user?.country) ? null : user.country?.trim();
  const cleanSection = isUnknown(user?.section) ? null : user.section?.trim();

  if (displayOption === UsersOriginDisplayOptions.COUNTRY) return cleanCountry || null;
  if (displayOption === UsersOriginDisplayOptions.SECTION) return cleanSection || null;
  if (displayOption === UsersOriginDisplayOptions.BOTH) {
    if (cleanCountry && cleanSection) {
      if (cleanCountry === cleanSection) return cleanSection;
      return `${cleanCountry} - ${cleanSection}`;
    }
    return cleanSection || cleanCountry || null;
  }
  return null;
};
