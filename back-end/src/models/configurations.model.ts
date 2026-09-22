import { Resource } from 'idea-toolbox';
import { FinancialRequestType } from './financial-request.model';
export { FinancialRequestType };

export const DEFAULT_TIMEZONE = 'Europe/Warsaw';

export const DEFAULT_CONFIGURATION_PAGE_SECTIONS_ORDER = [
  'GUESTS',
  'USERS',
  'TEMPLATES',
  'OPTIONS'
] as const;

export type ConfigurationPageSection = (typeof DEFAULT_CONFIGURATION_PAGE_SECTIONS_ORDER)[number];

export enum EmailTemplateTypes {
  GUEST_INVITATION = 'GUEST_INVITATION',
  REQUEST_SUBMITTED = 'REQUEST_SUBMITTED',
  REQUEST_CHANGES_REQUESTED = 'REQUEST_CHANGES_REQUESTED',
  REQUEST_APPROVED = 'REQUEST_APPROVED',
  REQUEST_PAID = 'REQUEST_PAID',
  REQUEST_REJECTED = 'REQUEST_REJECTED',
  REQUEST_STATUS_UPDATED = 'REQUEST_STATUS_UPDATED'
}

export enum EmailTemplates {
  GUEST_INVITATION_PL = 'GUEST_INVITATION_PL',
  GUEST_INVITATION_EN = 'GUEST_INVITATION_EN',
  REQUEST_SUBMITTED_PL = 'REQUEST_SUBMITTED_PL',
  REQUEST_SUBMITTED_EN = 'REQUEST_SUBMITTED_EN',
  REQUEST_CHANGES_REQUESTED_PL = 'REQUEST_CHANGES_REQUESTED_PL',
  REQUEST_CHANGES_REQUESTED_EN = 'REQUEST_CHANGES_REQUESTED_EN',
  REQUEST_APPROVED_PL = 'REQUEST_APPROVED_PL',
  REQUEST_APPROVED_EN = 'REQUEST_APPROVED_EN',
  REQUEST_PAID_PL = 'REQUEST_PAID_PL',
  REQUEST_PAID_EN = 'REQUEST_PAID_EN',
  REQUEST_REJECTED_PL = 'REQUEST_REJECTED_PL',
  REQUEST_REJECTED_EN = 'REQUEST_REJECTED_EN',
  REQUEST_STATUS_UPDATED_PL = 'REQUEST_STATUS_UPDATED_PL',
  REQUEST_STATUS_UPDATED_EN = 'REQUEST_STATUS_UPDATED_EN'
}

export const getEmailTemplateKey = (type: EmailTemplateTypes, lang: 'pl' | 'en'): EmailTemplates => {
  return `${type}_${lang.toUpperCase()}` as EmailTemplates;
};

export const formatSenderName = (name: string): string => {
  if (!name) return '';
  const trimmed = name.trim();
  // If contains non-ASCII characters, encode using RFC 2047 MIME encoded-word syntax
  if (/[^\x00-\x7F]/.test(trimmed)) {
    const base64 = typeof (globalThis as any).Buffer !== 'undefined'
      ? (globalThis as any).Buffer.from(trimmed, 'utf-8').toString('base64')
      : btoa(unescape(encodeURIComponent(trimmed)));
    return `=?UTF-8?B?${base64}?=`;
  }
  if (/[,;"]/.test(trimmed) && !trimmed.startsWith('"')) {
    return `"${trimmed.replace(/"/g, '\\"')}"`;
  }
  return trimmed;
};

export const AppPermission = {
  HOME: {
    PARENT: 'home',
    TEXT: 'home.text',
    NOTICE: 'home.notice',
    STATISTICS: 'home.statistics'
  },
  FINANCIAL_REQUESTS: {
    PARENT: 'financial_requests',
    VIEW_ALL: 'financial_requests.view_all',
    MANAGE: 'financial_requests.manage',
    EXPORT: 'financial_requests.export'
  },
  RULES: {
    PARENT: 'rules',
    TEXT: 'rules.text',
    UPDATE: 'rules.update'
  },
  CONFIGURATIONS: {
    PARENT: 'configurations',
    GUESTS: 'configurations.guests',
    USERS: 'configurations.users',
    TEMPLATES: 'configurations.templates',
    OPTIONS: 'configurations.options'
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

export type BuiltInRole = 'ADMINISTRATOR' | 'MANAGER' | 'AUDITOR';

export interface AutomaticRoleAssignment {
  roleId: BuiltInRole | string;
  extendedRolePatterns: string[];
}

export type GuestInvitationStatus = 'ACTIVE' | 'USED' | 'EXPIRED' | 'REVOKED';

export interface GuestInvitation {
  id: string;
  guestName: string;
  guestEmail: string;
  purpose: string;
  position?: string;
  allowedRequestTypes?: FinancialRequestType[];
  defaultSourceOfFunding?: string;
  maxAmount?: number;
  instructions?: LocalizedText;
  createdAt: string;
  expiresAt: string;
  createdBy: string;
  status: GuestInvitationStatus;
  isMultiUse?: boolean;
  submittedRequestId?: string;
  submittedAt?: string;
  lastAccessedAt?: string;
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

export interface HomeNotice {
  active: boolean;
  type: 'info' | 'warning' | 'success';
  text: LocalizedText;
}

export const DEFAULT_CONFIGURATIONS = {
  appTitle: {
    en: 'Online Financial System',
    pl: 'Internetowy System Finansowy'
  },
  appOrganisation: {
    en: 'ESN Poland Federation',
    pl: 'Związek stowarzyszeń ESN Polska'
  },
  homeWelcomeTitle: {
    en: 'Welcome to the Online Financial System',
    pl: 'Witaj w Internetowym Systemie Finansowym'
  },
  homeWelcomeSubtitle: {
    en: 'This is the Online Financial System of the ESN Poland Federation.',
    pl: 'To jest Internetowy System Finansowy Związku stowarzyszeń ESN Polska.'
  },
  homeNotice: {
    active: false,
    type: 'info' as const,
    text: {
      en: '',
      pl: ''
    }
  },
  supportEmail: '',
  appLogoURL: '',
  appLogoURLDarkMode: '',
  organisationLogoURL: '',
  timezone: DEFAULT_TIMEZONE,
  configurationPageSectionsOrder: DEFAULT_CONFIGURATION_PAGE_SECTIONS_ORDER,
  administratorsIds: [] as string[],
  managersIds: [] as string[],
  auditorsIds: [] as string[],
  customRoles: [] as CustomRole[],
  automaticRoleAssignments: [] as AutomaticRoleAssignment[],
  rulesWarningText: {
    en: 'Please, make sure you have read and understood them before submitting a request. Not complying with the defined deadlines in the rules document might cause your submission being rejected.',
    pl: 'Prosimy o zapoznanie się z zasadami przed złożeniem wniosku. Niedopełnienie terminów określonych w dokumencie może skutkować odrzuceniem wniosku.'
  },
  rulesFileURL: 'https://media.finances.esn-poland.link/rules/finances-rules.pdf',
  rulesResolutionNumber: 'XX/XX',
  rulesRevisionDate: '',
  guestAccessEnabled: true,
  guestAccessAllowedRequestTypes: ['INVOICE_REIMBURSEMENT', 'DELEGATION_SETTLEMENT'] as FinancialRequestType[],
  guestAccessDefaultExpirationDays: 14,
  guestAccessInstructions: {
    en: 'Please provide all necessary invoice attachments, travel tickets, and proof of payment. Ensure that the bank account details match the invoice or attendee name.',
    pl: 'Prosimy o dołączenie wszystkich faktur, biletów podróżnych oraz potwierdzeń płatności. Upewnij się, że dane konta bankowego są poprawne.'
  },
  guestAccessRequirePurpose: true,
  guestInvitations: [] as GuestInvitation[]
};

/**
 * The platform's configurations.
 */
export class Configurations extends Resource {
  static PK = '1';
  PK = Configurations.PK;

  /** The IDs of the platform's administrators. */
  administratorsIds: string[];
  /** The IDs of the platform's managers. */
  managersIds: string[];
  /** The IDs of the platform's auditors. */
  auditorsIds: string[];
  /** Configured custom roles with arbitrary permissions. */
  customRoles: CustomRole[];
  /** Automatic role assignments matched against CAS extended roles. */
  automaticRoleAssignments: AutomaticRoleAssignment[];

  /** The name/title of the platform in supported languages. */
  appTitle: LocalizedText;
  /** The organisation name in supported languages. */
  appOrganisation: LocalizedText;
  /** Home page welcome title in supported languages. */
  homeWelcomeTitle: LocalizedText;
  /** Home page welcome subtitle in supported languages. */
  homeWelcomeSubtitle: LocalizedText;
  /** Home page announcement notice banner. */
  homeNotice: HomeNotice;
  /** Contact email for support. */
  supportEmail: string;
  /** The logo of the platform in light mode (CDN URL). */
  appLogoURL: string;
  /** The logo of the platform in dark mode (CDN URL). */
  appLogoURLDarkMode: string;
  /** The logo of the organisation used across exported documents (CDN URL). */
  organisationLogoURL: string;
  /** The timezone to use for dates and deadlines. */
  timezone: string;
  /** Order of configuration subtabs. */
  configurationPageSectionsOrder: ConfigurationPageSection[];
  /** Last update timestamp (ISO string), used for optimistic concurrency control. */
  updatedAt?: string;

  /** Rules warning notice text in supported languages. */
  rulesWarningText: LocalizedText;
  /** Rules document URL to download. */
  rulesFileURL: string;
  /** Resolution number governing this rules revision (e.g. "XX/XX" or "04/2026"). */
  /** Rules resolution number. */
  rulesResolutionNumber: string;
  /** Date of the rules revision (YYYY-MM-DD). */
  rulesRevisionDate: string;

  /** Master switch for guest reimbursements without ESN Accounts. */
  guestAccessEnabled: boolean;
  /** Allowed request types for guests. */
  guestAccessAllowedRequestTypes: FinancialRequestType[];
  /** Default expiration days for generated guest links. */
  guestAccessDefaultExpirationDays: number;
  /** Localized instructions shown to guests. */
  guestAccessInstructions: LocalizedText;
  /** Whether purpose is required when creating an invite. */
  guestAccessRequirePurpose: boolean;
  /** Active and historical guest invitations. */
  guestInvitations: GuestInvitation[];

  constructor(data?: any) {
    super();
    if (data) {
      this.load(data);
    }
  }

  load(x: any): void {
    super.load(x);
    this.updatedAt = this.clean(x.updatedAt, String);
    this.administratorsIds = this.cleanArray(x.administratorsIds, String).map(id => id.toLowerCase());
    this.managersIds = this.cleanArray(x.managersIds, String).map(id => id.toLowerCase());
    this.auditorsIds = this.cleanArray(x.auditorsIds, String).map(id => id.toLowerCase());
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

    const defaultOrganisation = DEFAULT_CONFIGURATIONS.appOrganisation;
    if (typeof x.appOrganisation === 'string') {
      this.appOrganisation = { en: x.appOrganisation, pl: x.appOrganisation };
    } else {
      this.appOrganisation = {
        en: this.clean(x.appOrganisation?.en, String, defaultOrganisation.en),
        pl: this.clean(x.appOrganisation?.pl, String, defaultOrganisation.pl)
      };
    }

    const defaultWelcomeTitle = DEFAULT_CONFIGURATIONS.homeWelcomeTitle;
    if (typeof x.homeWelcomeTitle === 'string') {
      this.homeWelcomeTitle = { en: x.homeWelcomeTitle, pl: x.homeWelcomeTitle };
    } else {
      this.homeWelcomeTitle = {
        en: this.clean(x.homeWelcomeTitle?.en, String, defaultWelcomeTitle.en),
        pl: this.clean(x.homeWelcomeTitle?.pl, String, defaultWelcomeTitle.pl)
      };
    }

    const defaultWelcomeSubtitle = DEFAULT_CONFIGURATIONS.homeWelcomeSubtitle;
    if (typeof x.homeWelcomeSubtitle === 'string') {
      this.homeWelcomeSubtitle = { en: x.homeWelcomeSubtitle, pl: x.homeWelcomeSubtitle };
    } else {
      this.homeWelcomeSubtitle = {
        en: this.clean(x.homeWelcomeSubtitle?.en, String, defaultWelcomeSubtitle.en),
        pl: this.clean(x.homeWelcomeSubtitle?.pl, String, defaultWelcomeSubtitle.pl)
      };
    }

    const defaultNotice = DEFAULT_CONFIGURATIONS.homeNotice;
    const noticeType = ['info', 'warning', 'success'].includes(x.homeNotice?.type) ? x.homeNotice.type : 'info';
    this.homeNotice = {
      active:
        x.homeNotice?.active !== undefined
          ? Boolean(x.homeNotice.active)
          : defaultNotice.active,
      type: noticeType,
      text: {
        en: this.clean(x.homeNotice?.text?.en, String, defaultNotice.text.en),
        pl: this.clean(x.homeNotice?.text?.pl, String, defaultNotice.text.pl)
      }
    };

    this.supportEmail = this.clean(x.supportEmail, String, DEFAULT_CONFIGURATIONS.supportEmail);
    this.appLogoURL = this.clean(x.appLogoURL, String);
    this.appLogoURLDarkMode = this.clean(x.appLogoURLDarkMode, String);
    this.organisationLogoURL = this.clean(x.organisationLogoURL, String);
    this.timezone = this.clean(x.timezone, String, DEFAULT_TIMEZONE);

    const configuredSections = this.cleanArray(x.configurationPageSectionsOrder, String) as ConfigurationPageSection[];
    this.configurationPageSectionsOrder = [
      ...configuredSections.filter((section, index) =>
        DEFAULT_CONFIGURATION_PAGE_SECTIONS_ORDER.includes(section) && configuredSections.indexOf(section) === index
      ),
      ...DEFAULT_CONFIGURATION_PAGE_SECTIONS_ORDER.filter(section => !configuredSections.includes(section))
    ];

    const defaultWarning = DEFAULT_CONFIGURATIONS.rulesWarningText;
    if (typeof x.rulesWarningText === 'string') {
      this.rulesWarningText = { en: x.rulesWarningText, pl: x.rulesWarningText };
    } else {
      this.rulesWarningText = {
        en: this.clean(x.rulesWarningText?.en, String, defaultWarning.en),
        pl: this.clean(x.rulesWarningText?.pl, String, defaultWarning.pl)
      };
    }

    this.rulesFileURL = this.clean(x.rulesFileURL, String, DEFAULT_CONFIGURATIONS.rulesFileURL);
    this.rulesResolutionNumber = this.clean(
      x.rulesResolutionNumber || (typeof x.rulesRevisionNotice === 'object' ? x.rulesRevisionNotice?.pl || x.rulesRevisionNotice?.en : x.rulesRevisionNotice),
      String,
      DEFAULT_CONFIGURATIONS.rulesResolutionNumber
    );
    this.rulesRevisionDate = this.clean(x.rulesRevisionDate, String, DEFAULT_CONFIGURATIONS.rulesRevisionDate);

    this.guestAccessEnabled =
      x.guestAccessEnabled !== undefined
        ? Boolean(x.guestAccessEnabled)
        : DEFAULT_CONFIGURATIONS.guestAccessEnabled;
    this.guestAccessAllowedRequestTypes = this.cleanArray(
      x.guestAccessAllowedRequestTypes,
      String,
      DEFAULT_CONFIGURATIONS.guestAccessAllowedRequestTypes
    ) as FinancialRequestType[];
    this.guestAccessDefaultExpirationDays = this.clean(
      x.guestAccessDefaultExpirationDays,
      Number,
      DEFAULT_CONFIGURATIONS.guestAccessDefaultExpirationDays
    );
    const defaultGuestInstructions = DEFAULT_CONFIGURATIONS.guestAccessInstructions;
    if (typeof x.guestAccessInstructions === 'string') {
      this.guestAccessInstructions = { en: x.guestAccessInstructions, pl: x.guestAccessInstructions };
    } else {
      this.guestAccessInstructions = {
        en: this.clean(x.guestAccessInstructions?.en, String, defaultGuestInstructions.en),
        pl: this.clean(x.guestAccessInstructions?.pl, String, defaultGuestInstructions.pl)
      };
    }
    this.guestAccessRequirePurpose =
      x.guestAccessRequirePurpose !== undefined
        ? Boolean(x.guestAccessRequirePurpose)
        : DEFAULT_CONFIGURATIONS.guestAccessRequirePurpose;
    this.guestInvitations = this.cleanArray(x.guestInvitations, Object).map((inv: any) => ({
      id: this.clean(inv.id, String),
      guestName: this.clean(inv.guestName, String),
      guestEmail: this.clean(inv.guestEmail, String),
      purpose: this.clean(inv.purpose, String),
      position: this.clean(inv.position, String),
      allowedRequestTypes: this.cleanArray(inv.allowedRequestTypes, String) as FinancialRequestType[],
      defaultSourceOfFunding: this.clean(inv.defaultSourceOfFunding, String),
      maxAmount:
        inv.maxAmount !== undefined && inv.maxAmount !== null && inv.maxAmount !== ''
          ? Number(inv.maxAmount)
          : undefined,
      instructions: inv.instructions
        ? {
            en: this.clean(inv.instructions.en, String),
            pl: this.clean(inv.instructions.pl, String)
          }
        : undefined,
      createdAt: this.clean(inv.createdAt, String),
      expiresAt: this.clean(inv.expiresAt, String),
      createdBy: this.clean(inv.createdBy, String),
      status: (['ACTIVE', 'USED', 'EXPIRED', 'REVOKED'].includes(inv.status) ? inv.status : 'ACTIVE') as GuestInvitationStatus,
      isMultiUse: inv.isMultiUse !== undefined ? Boolean(inv.isMultiUse) : false,
      submittedRequestId: this.clean(inv.submittedRequestId, String),
      submittedAt: this.clean(inv.submittedAt, String),
      lastAccessedAt: this.clean(inv.lastAccessedAt, String)
    }));
  }

  getAppTitle(lang: string = 'en'): string {
    if (typeof this.appTitle === 'string') return this.appTitle;
    return (this.appTitle as any)?.[lang] || this.appTitle?.en || this.appTitle?.pl || '';
  }

  getAppOrganisation(lang: string = 'en'): string {
    if (typeof this.appOrganisation === 'string') return this.appOrganisation;
    return (this.appOrganisation as any)?.[lang] || this.appOrganisation?.en || this.appOrganisation?.pl || '';
  }

  getOrganisationLogo(): string {
    return this.organisationLogoURL || '';
  }

  getRulesWarningText(lang: string = 'en'): string {
    if (typeof this.rulesWarningText === 'string') return this.rulesWarningText;
    return (this.rulesWarningText as any)?.[lang] || this.rulesWarningText?.en || this.rulesWarningText?.pl || '';
  }

  getHomeWelcomeTitle(lang: string = 'en'): string {
    if (typeof this.homeWelcomeTitle === 'string') return this.homeWelcomeTitle;
    return (this.homeWelcomeTitle as any)?.[lang] || this.homeWelcomeTitle?.en || this.homeWelcomeTitle?.pl || '';
  }

  getHomeWelcomeSubtitle(lang: string = 'en'): string {
    if (typeof this.homeWelcomeSubtitle === 'string') return this.homeWelcomeSubtitle;
    return (this.homeWelcomeSubtitle as any)?.[lang] || this.homeWelcomeSubtitle?.en || this.homeWelcomeSubtitle?.pl || '';
  }

  getHomeNoticeText(lang: string = 'en'): string {
    if (!this.homeNotice?.text) return '';
    if (typeof this.homeNotice.text === 'string') return this.homeNotice.text;
    return (this.homeNotice.text as any)?.[lang] || this.homeNotice.text?.en || this.homeNotice.text?.pl || '';
  }

  isHomeNoticeActive(): boolean {
    return !!this.homeNotice?.active && !!(this.homeNotice?.text?.en?.trim() || this.homeNotice?.text?.pl?.trim());
  }

  safeLoad(newData: any, safeData: any): void {
    super.safeLoad(newData, safeData);
    this.PK = Configurations.PK;
    this.updatedAt = this.clean(safeData.updatedAt, String);
    this.homeWelcomeTitle = safeData.homeWelcomeTitle;
    this.homeWelcomeSubtitle = safeData.homeWelcomeSubtitle;
    this.homeNotice = safeData.homeNotice;
    this.rulesWarningText = safeData.rulesWarningText;
    this.rulesFileURL = safeData.rulesFileURL;
    this.rulesResolutionNumber = safeData.rulesResolutionNumber;
    this.rulesRevisionDate = safeData.rulesRevisionDate;
    this.guestAccessEnabled = safeData.guestAccessEnabled;
    this.guestAccessAllowedRequestTypes = safeData.guestAccessAllowedRequestTypes;
    this.guestAccessDefaultExpirationDays = safeData.guestAccessDefaultExpirationDays;
    this.guestAccessInstructions = safeData.guestAccessInstructions;
    this.guestAccessRequirePurpose = safeData.guestAccessRequirePurpose;
    this.guestInvitations = safeData.guestInvitations;
  }

  hasAdminGroup(): boolean {
    const adminAssignment = (this.automaticRoleAssignments || []).find(a => a.roleId === 'ADMINISTRATOR');
    return !!adminAssignment && (adminAssignment.extendedRolePatterns || []).length > 0;
  }

  validate(): string[] {
    const errors = super.validate();
    if (this.iE(this.administratorsIds) && !this.hasAdminGroup()) errors.push('administratorsIds');
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
      if (!role.name || !role.name.trim()) {
        errors.push('customRoles.name');
      }
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
    for (const inv of this.guestInvitations || []) {
      if (!inv.id || !inv.id.trim()) errors.push('guestInvitations.id');
      if (!inv.guestName || !inv.guestName.trim()) errors.push('guestInvitations.guestName');
      if (!inv.guestEmail || !inv.guestEmail.trim()) errors.push('guestInvitations.guestEmail');
      if (this.guestAccessRequirePurpose && (!inv.purpose || !inv.purpose.trim())) {
        errors.push('guestInvitations.purpose');
      }
    }
    return errors;
  }
}
