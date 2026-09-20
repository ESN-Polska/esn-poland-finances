import { Resource } from 'idea-toolbox';
import { Configurations } from './configurations.model';

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
  /** Legacy CAS roles */
  roles: string[];
  /** Scoped extended roles (e.g. National.treasurer:PL, Local.treasurer:PL-WAR-SGH) */
  extendedRoles: string[];
  /** ISO timestamp of last login */
  lastLoginAt: string;
  /** Administrator flag */
  isAdministrator: boolean;

  constructor(data?: any) {
    super();
    if (data) {
      this.load(data);
    }
  }

  static applyConfigurationPermissions(user: User, configurations: Configurations): void {
    const isConfigAdmin = (configurations.administratorsIds || []).includes(user.userId);
    const hasNationalTreasurerRole = (user.extendedRoles || []).some(role =>
      role.toLowerCase().startsWith('national.treasurer')
    );
    user.isAdministrator = isConfigAdmin || hasNationalTreasurerRole;
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
  }

  getDisplayName(): string {
    const parts = [this.firstName, this.lastName].filter(Boolean);
    return parts.length > 0 ? parts.join(' ') : this.userId;
  }
}
