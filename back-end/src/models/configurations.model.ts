import { Resource } from 'idea-toolbox';

export const DEFAULT_TIMEZONE = 'Europe/Warsaw';

export const DEFAULT_CONFIGURATION_PAGE_SECTIONS_ORDER = [
  'OPTIONS',
  'USERS'
] as const;

export type ConfigurationPageSection = (typeof DEFAULT_CONFIGURATION_PAGE_SECTIONS_ORDER)[number];

export const AppPermission = {
  FINANCIAL_REQUESTS: {
    PARENT: 'financial_requests',
    VIEW_ALL: 'financial_requests.view_all',
    MANAGE: 'financial_requests.manage',
    EXPORT: 'financial_requests.export'
  },
  RULES: {
    PARENT: 'rules',
    MANAGE: 'rules.manage'
  },
  CONFIGURATIONS: {
    PARENT: 'configurations',
    OPTIONS: 'configurations.options',
    USERS: 'configurations.users'
  }
} as const;

type PermissionValues<T> = T extends string
  ? T
  : T extends Record<string, unknown>
  ? PermissionValues<T[keyof T]>
  : never;

export type AppPermission = PermissionValues<typeof AppPermission>;

export interface AppPermissionNode {
  permission: AppPermission;
  children: AppPermission[];
}

const permissionDefinitions = Object.values(AppPermission) as (string | Record<string, string>)[];

export const APP_PERMISSION_TREE: AppPermissionNode[] = permissionDefinitions.map(definition => {
  if (typeof definition === 'string') return { permission: definition as AppPermission, children: [] };

  const { PARENT, ...children } = definition;
  return { permission: PARENT as AppPermission, children: Object.values(children) as AppPermission[] };
});

export const ALL_APP_PERMISSIONS: AppPermission[] = APP_PERMISSION_TREE.reduce(
  (permissions, node) => [...permissions, node.permission, ...node.children],
  [] as AppPermission[]
);

/** Country and local scoped CAS permissions published by ESN Accounts. */
export const CAS_PERMISSION_OPTIONS = [
  'National.president:PL',
  'National.vicePresident:PL',
  'National.treasurer:PL',
  'National.pr:PL',
  'National.regularBoardMember:PL',
  'National.secretary:PL',
  'National.staff:PL',
  'National.boardSupport:PL',
  'National.webmaster:PL',
  'National.projectCoordinator:PL',
  'National.Auditor:PL',
  'National.EducationOfficer:PL',
  'National.activity:PL',
  'National.eventCoordinator:PL',
  'National.cardManager:PL',
  'National.alumnus:PL'
];

export interface CustomRole {
  id: string;
  name: string;
  userIds: string[];
  permissions: AppPermission[];
  extendedRolePatterns: string[];
}

export type BuiltInRole = 'ADMINISTRATOR' | 'FINANCIAL_MANAGER';

export interface AutomaticRoleAssignment {
  roleId: BuiltInRole | string;
  extendedRolePatterns: string[];
}

/**
 * The possible options in displaying information about a user.
 */
export enum UsersOriginDisplayOptions {
  COUNTRY = 'country',
  SECTION = 'section',
  BOTH = 'both'
}

export interface LocalizedText {
  en: string;
  pl: string;
}

export const DEFAULT_CONFIGURATIONS = {
  appTitle: {
    en: 'Online Financial System',
    pl: 'Internetowy System Finansowy'
  },
  appSubtitle: {
    en: 'ESN Poland Federation',
    pl: 'Związek stowarzyszeń ESN Polska'
  },
  supportEmail: '',
  appLogoURL: '',
  appLogoURLDarkMode: '',
  timezone: DEFAULT_TIMEZONE,
  configurationPageSectionsOrder: DEFAULT_CONFIGURATION_PAGE_SECTIONS_ORDER,
  administratorsIds: [] as string[],
  financialManagersIds: [] as string[],
  customRoles: [] as CustomRole[],
  automaticRoleAssignments: [] as AutomaticRoleAssignment[]
};

/**
 * The platform's configurations.
 */
export class Configurations extends Resource {
  static PK = '1';
  PK = Configurations.PK;

  /** The IDs of the platform's administrators. */
  administratorsIds: string[];
  /** The IDs of the users who can manage financial requests. */
  financialManagersIds: string[];
  /** Configured custom roles with arbitrary permissions. */
  customRoles: CustomRole[];
  /** Automatic role assignments matched against CAS extended roles. */
  automaticRoleAssignments: AutomaticRoleAssignment[];

  /** The name/title of the platform in supported languages. */
  appTitle: LocalizedText;
  /** The subtitle of the platform in supported languages. */
  appSubtitle: LocalizedText;
  /** Contact email for support. */
  supportEmail: string;
  /** The logo of the platform in light mode (CDN URL). */
  appLogoURL: string;
  /** The logo of the platform in dark mode (CDN URL). */
  appLogoURLDarkMode: string;
  /** The timezone to use for dates and deadlines. */
  timezone: string;
  /** Order of configuration subtabs. */
  configurationPageSectionsOrder: ConfigurationPageSection[];

  constructor(data?: any) {
    super();
    if (data) {
      this.load(data);
    }
  }

  load(x: any): void {
    super.load(x);
    this.administratorsIds = this.cleanArray(x.administratorsIds, String).map(id => id.toLowerCase());
    this.financialManagersIds = this.cleanArray(x.financialManagersIds, String).map(id => id.toLowerCase());
    this.customRoles = this.cleanArray(x.customRoles, Object).map((role: any) => ({
      id: this.clean(role.id, String),
      name: this.clean(role.name, String),
      userIds: this.cleanArray(role.userIds, String).map(id => id.toLowerCase()),
      permissions: this.cleanArray(role.permissions, String) as AppPermission[],
      extendedRolePatterns: this.cleanArray(role.extendedRolePatterns, String)
    }));
    this.automaticRoleAssignments = this.cleanArray(x.automaticRoleAssignments, Object).map((assignment: any) => ({
      roleId: this.clean(assignment.roleId, String),
      extendedRolePatterns: this.cleanArray(assignment.extendedRolePatterns, String)
    }));

    const defaultTitle = DEFAULT_CONFIGURATIONS.appTitle;
    if (typeof x.appTitle === 'string') {
      this.appTitle = { en: x.appTitle, pl: x.appTitle };
    } else {
      this.appTitle = {
        en: this.clean(x.appTitle?.en, String, defaultTitle.en),
        pl: this.clean(x.appTitle?.pl, String, defaultTitle.pl)
      };
    }

    const defaultSubtitle = DEFAULT_CONFIGURATIONS.appSubtitle;
    if (typeof x.appSubtitle === 'string') {
      this.appSubtitle = { en: x.appSubtitle, pl: x.appSubtitle };
    } else {
      this.appSubtitle = {
        en: this.clean(x.appSubtitle?.en, String, defaultSubtitle.en),
        pl: this.clean(x.appSubtitle?.pl, String, defaultSubtitle.pl)
      };
    }

    this.supportEmail = this.clean(x.supportEmail, String, DEFAULT_CONFIGURATIONS.supportEmail);
    this.appLogoURL = this.clean(x.appLogoURL, String);
    this.appLogoURLDarkMode = this.clean(x.appLogoURLDarkMode, String);
    this.timezone = this.clean(x.timezone, String, DEFAULT_TIMEZONE);

    const configuredSections = this.cleanArray(x.configurationPageSectionsOrder, String) as ConfigurationPageSection[];
    this.configurationPageSectionsOrder = [
      ...configuredSections.filter((section, index) =>
        DEFAULT_CONFIGURATION_PAGE_SECTIONS_ORDER.includes(section) && configuredSections.indexOf(section) === index
      ),
      ...DEFAULT_CONFIGURATION_PAGE_SECTIONS_ORDER.filter(section => !configuredSections.includes(section))
    ];
  }

  getAppTitle(lang: string = 'en'): string {
    if (typeof this.appTitle === 'string') return this.appTitle;
    return (this.appTitle as any)?.[lang] || this.appTitle?.en || this.appTitle?.pl || '';
  }

  getAppSubtitle(lang: string = 'en'): string {
    if (typeof this.appSubtitle === 'string') return this.appSubtitle;
    return (this.appSubtitle as any)?.[lang] || this.appSubtitle?.en || this.appSubtitle?.pl || '';
  }

  safeLoad(newData: any, safeData: any): void {
    super.safeLoad(newData, safeData);
    this.PK = Configurations.PK;
  }

  validate(): string[] {
    const errors = super.validate();
    if (this.iE(this.administratorsIds)) errors.push('administratorsIds');
    if (typeof this.appTitle === 'object') {
      if (!this.appTitle?.en?.trim() && !this.appTitle?.pl?.trim()) errors.push('appTitle');
    } else if (this.iE(this.appTitle)) {
      errors.push('appTitle');
    }

    if (
      this.configurationPageSectionsOrder.some(
        section => !DEFAULT_CONFIGURATION_PAGE_SECTIONS_ORDER.includes(section)
      ) ||
      new Set(this.configurationPageSectionsOrder).size !== this.configurationPageSectionsOrder.length
    ) {
      errors.push('configurationPageSectionsOrder');
    }

    const knownPermissions = new Set(ALL_APP_PERMISSIONS);
    const validExtendedRolePattern = /^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)*:[A-Za-z0-9*]+(?:-[A-Za-z0-9*]+)*$/;
    for (const role of this.customRoles || []) {
      if ((role.permissions || []).some(permission => !knownPermissions.has(permission))) {
        errors.push('customRoles.permissions');
      }
      if ((role.extendedRolePatterns || []).some(pattern => !validExtendedRolePattern.test(pattern))) {
        errors.push('customRoles.extendedRolePatterns');
      }
    }
    for (const assignment of this.automaticRoleAssignments || []) {
      if ((assignment.extendedRolePatterns || []).some(pattern => !validExtendedRolePattern.test(pattern))) {
        errors.push('automaticRoleAssignments.extendedRolePatterns');
      }
    }
    return errors;
  }
}
