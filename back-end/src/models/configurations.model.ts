import { Resource } from 'idea-toolbox';
import { FinancialRequestType } from './financial-request.model';
export { FinancialRequestType };

export const DEFAULT_TIMEZONE = 'Europe/Warsaw';

export const SUPPORTED_LANGUAGES = ['en', 'pl'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const DEFAULT_CONFIGURATION_PAGE_SECTIONS_ORDER = [
  'GUESTS',
  'USERS',
  'ROLES',
  'RESOURCES',
  'TEMPLATES',
  'EXPORTS',
  'OPTIONS'
] as const;

export type ConfigurationPageSection = (typeof DEFAULT_CONFIGURATION_PAGE_SECTIONS_ORDER)[number];

export type CsvDelimiter = ';' | ',' | '\t';
export type CsvDateFormat = 'YYYY-MM-DD' | 'DD.MM.YYYY' | 'DD/MM/YYYY';
export type CsvDecimalSeparator = ',' | '.';
export type CsvBooleanFormat = 'TRUE_FALSE' | '1_0';

export type CsvColumnCategory = 'METADATA' | 'APPLICANT' | 'FINANCIAL' | 'BANKING' | 'REMARKS';

export interface CsvExportColumnConfig {
  id: string;
  enabled: boolean;
  category: CsvColumnCategory;
  defaultHeader: {
    en: string;
    pl: string;
  };
  customHeader?: {
    en?: string;
    pl?: string;
  };
}

export interface CsvExportSettings {
  delimiter: CsvDelimiter;
  includeBom: boolean;
  dateFormat: CsvDateFormat;
  decimalSeparator: CsvDecimalSeparator;
  booleanFormat: CsvBooleanFormat;
  columns: CsvExportColumnConfig[];
}

export enum EmailTemplateTypes {
  GUEST_INVITATION = 'GUEST_INVITATION',
  REQUEST_SUBMITTED = 'REQUEST_SUBMITTED',
  REQUEST_CHANGES_REQUESTED = 'REQUEST_CHANGES_REQUESTED',
  REQUEST_APPROVED = 'REQUEST_APPROVED',
  REQUEST_PAID = 'REQUEST_PAID',
  REQUEST_REJECTED = 'REQUEST_REJECTED'
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
  REQUEST_REJECTED_EN = 'REQUEST_REJECTED_EN'
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
  RULES: {
    PARENT: 'rules',
    TEXT: 'rules.text',
    UPDATE: 'rules.update'
  },
  REQUESTS: {
    PARENT: 'requests',
    VIEW_ALL: 'requests.view_all',
    EXPORT: 'requests.export',
    MANAGE: 'requests.manage'
  },
  CONFIGURATIONS: {
    PARENT: 'configurations',
    GUESTS: 'configurations.guests',
    USERS: 'configurations.users',
    ROLES: 'configurations.roles',
    RESOURCES: 'configurations.resources',
    TEMPLATES: 'configurations.templates',
    EXPORTS: 'configurations.exports',
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

/** Country and local scoped OAuth roles published by ESN Accounts. */
export const OAUTH_ROLE_OPTIONS = [
  'PL:country-president',
  'PL:country-vice_president',
  'PL:country-treasurer',
  'PL:country-communication',
  'PL:country-regular_board_member',
  'PL:country-secretary',
  'PL:country-staff',
  'PL:country-board_support',
  'PL:country-webmaster',
  'PL:country-project_coordinator',
  'PL:country-auditor',
  'PL:country-education',
  'PL:country-activity_coordinator',
  'PL:country-event_coordinator',
  'PL:country-esncard',
  'PL:country-alumnus'
];

/** Alias for existing front-end configuration components */
export const CAS_PERMISSION_OPTIONS = OAUTH_ROLE_OPTIONS;

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

export const DEFAULT_CSV_EXPORT_COLUMNS: CsvExportColumnConfig[] = [
  { id: 'displayId', enabled: true, category: 'METADATA', defaultHeader: { en: 'ID', pl: 'Nr wniosku' } },
  { id: 'createdAt', enabled: true, category: 'METADATA', defaultHeader: { en: 'Date Created', pl: 'Data utworzenia' } },
  { id: 'submittedAt', enabled: true, category: 'METADATA', defaultHeader: { en: 'Date Submitted', pl: 'Data złożenia' } },
  { id: 'status', enabled: true, category: 'METADATA', defaultHeader: { en: 'Status', pl: 'Status' } },
  { id: 'requestType', enabled: true, category: 'METADATA', defaultHeader: { en: 'Type', pl: 'Typ' } },
  { id: 'applicantName', enabled: true, category: 'APPLICANT', defaultHeader: { en: 'Applicant Name', pl: 'Wnioskodawca' } },
  { id: 'applicantEmail', enabled: true, category: 'APPLICANT', defaultHeader: { en: 'Applicant Email', pl: 'E-mail wnioskodawcy' } },
  { id: 'sectionOrCountry', enabled: true, category: 'APPLICANT', defaultHeader: { en: 'Section / Country', pl: 'Sekcja / Kraj' } },
  { id: 'isGuest', enabled: true, category: 'APPLICANT', defaultHeader: { en: 'Guest', pl: 'Gość' } },
  { id: 'position', enabled: true, category: 'APPLICANT', defaultHeader: { en: 'Position', pl: 'Pozycja' } },
  { id: 'sourceOfFunding', enabled: true, category: 'FINANCIAL', defaultHeader: { en: 'Funding Source', pl: 'Źródło finansowania' } },
  { id: 'grossPLN', enabled: true, category: 'FINANCIAL', defaultHeader: { en: 'PLN Gross Amount', pl: 'Kwota brutto PLN' } },
  { id: 'vatPLN', enabled: true, category: 'FINANCIAL', defaultHeader: { en: 'PLN VAT Amount', pl: 'Kwota VAT PLN' } },
  { id: 'plnIban', enabled: true, category: 'BANKING', defaultHeader: { en: 'PLN IBAN', pl: 'IBAN PLN' } },
  { id: 'plnSwift', enabled: true, category: 'BANKING', defaultHeader: { en: 'PLN SWIFT/BIC', pl: 'SWIFT/BIC PLN' } },
  { id: 'plnAccountHolder', enabled: true, category: 'BANKING', defaultHeader: { en: 'PLN Account Holder', pl: 'Właściciel konta PLN' } },
  { id: 'grossEUR', enabled: true, category: 'FINANCIAL', defaultHeader: { en: 'EUR Gross Amount', pl: 'Kwota brutto EUR' } },
  { id: 'vatEUR', enabled: true, category: 'FINANCIAL', defaultHeader: { en: 'EUR VAT Amount', pl: 'Kwota VAT EUR' } },
  { id: 'eurIban', enabled: true, category: 'BANKING', defaultHeader: { en: 'EUR IBAN', pl: 'IBAN EUR' } },
  { id: 'eurSwift', enabled: true, category: 'BANKING', defaultHeader: { en: 'EUR SWIFT/BIC', pl: 'SWIFT/BIC EUR' } },
  { id: 'eurAccountHolder', enabled: true, category: 'BANKING', defaultHeader: { en: 'EUR Account Holder', pl: 'Właściciel konta EUR' } },
  { id: 'adminRemarks', enabled: true, category: 'REMARKS', defaultHeader: { en: 'Reviewer Remarks', pl: 'Uwagi weryfikatora' } },
  // Optional columns (disabled by default)
  { id: 'currency', enabled: false, category: 'FINANCIAL', defaultHeader: { en: 'Request Currency', pl: 'Waluta wniosku' } },
  { id: 'totalGrossAmount', enabled: false, category: 'FINANCIAL', defaultHeader: { en: 'Total Gross (Original)', pl: 'Łączna kwota brutto' } },
  { id: 'totalVatAmount', enabled: false, category: 'FINANCIAL', defaultHeader: { en: 'Total VAT (Original)', pl: 'Łączna kwota VAT' } },
  { id: 'generalExplanation', enabled: false, category: 'REMARKS', defaultHeader: { en: 'Explanation / Budget', pl: 'Uzasadnienie / Kosztorys' } },
  { id: 'accountHolderAddress', enabled: false, category: 'BANKING', defaultHeader: { en: 'PLN Holder Address', pl: 'Adres właściciela konta PLN' } },
  { id: 'accountHolderAddressEUR', enabled: false, category: 'BANKING', defaultHeader: { en: 'EUR Holder Address', pl: 'Adres właściciela konta EUR' } },
  { id: 'guestPurpose', enabled: false, category: 'APPLICANT', defaultHeader: { en: 'Guest Purpose', pl: 'Cel zaproszenia gościa' } }
];

export const DEFAULT_CSV_EXPORT_SETTINGS: CsvExportSettings = {
  delimiter: ';',
  includeBom: true,
  dateFormat: 'YYYY-MM-DD',
  decimalSeparator: ',',
  booleanFormat: 'TRUE_FALSE',
  columns: DEFAULT_CSV_EXPORT_COLUMNS
};

export function cleanCsvExportSettings(raw: any): CsvExportSettings {
  if (!raw || typeof raw !== 'object') {
    return JSON.parse(JSON.stringify(DEFAULT_CSV_EXPORT_SETTINGS));
  }
  const validDelimiters: CsvDelimiter[] = [';', ',', '\t'];
  const validDateFormats: CsvDateFormat[] = ['YYYY-MM-DD', 'DD.MM.YYYY', 'DD/MM/YYYY'];
  const validDecimalSeparators: CsvDecimalSeparator[] = [',', '.'];
  const validBooleanFormats: CsvBooleanFormat[] = ['TRUE_FALSE', '1_0'];

  const delimiter: CsvDelimiter = validDelimiters.includes(raw.delimiter)
    ? raw.delimiter
    : DEFAULT_CSV_EXPORT_SETTINGS.delimiter;
  const includeBom =
    raw.includeBom !== undefined ? Boolean(raw.includeBom) : DEFAULT_CSV_EXPORT_SETTINGS.includeBom;
  const dateFormat: CsvDateFormat = validDateFormats.includes(raw.dateFormat)
    ? raw.dateFormat
    : DEFAULT_CSV_EXPORT_SETTINGS.dateFormat;
  const decimalSeparator: CsvDecimalSeparator = validDecimalSeparators.includes(raw.decimalSeparator)
    ? raw.decimalSeparator
    : DEFAULT_CSV_EXPORT_SETTINGS.decimalSeparator;
  const booleanFormat: CsvBooleanFormat = validBooleanFormats.includes(raw.booleanFormat)
    ? raw.booleanFormat
    : DEFAULT_CSV_EXPORT_SETTINGS.booleanFormat;

  const defaultColsMap = new Map(DEFAULT_CSV_EXPORT_COLUMNS.map(c => [c.id, c]));
  const seenIds = new Set<string>();
  const resolvedCols: CsvExportColumnConfig[] = [];

  if (Array.isArray(raw.columns)) {
    for (const c of raw.columns) {
      if (
        c &&
        typeof c === 'object' &&
        typeof c.id === 'string' &&
        defaultColsMap.has(c.id) &&
        !seenIds.has(c.id)
      ) {
        seenIds.add(c.id);
        const def = defaultColsMap.get(c.id)!;
        resolvedCols.push({
          id: c.id,
          enabled: Boolean(c.enabled),
          category: def.category,
          defaultHeader: { ...def.defaultHeader },
          customHeader:
            c.customHeader && typeof c.customHeader === 'object'
              ? {
                  en: typeof c.customHeader.en === 'string' ? c.customHeader.en.trim() : undefined,
                  pl: typeof c.customHeader.pl === 'string' ? c.customHeader.pl.trim() : undefined
                }
              : undefined
        });
      }
    }
  }

  for (const def of DEFAULT_CSV_EXPORT_COLUMNS) {
    if (!seenIds.has(def.id)) {
      resolvedCols.push(JSON.parse(JSON.stringify(def)));
    }
  }

  return {
    delimiter,
    includeBom,
    dateFormat,
    decimalSeparator,
    booleanFormat,
    columns: resolvedCols
  };
}

export const DEFAULT_CONFIGURATIONS = {
  appTitle: {
    en: 'ESN Poland Finances app',
    pl: 'ESN Poland Finances app'
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
  appLogoURLEmail: '',
  organisationLogoURL: '',
  timezone: DEFAULT_TIMEZONE,
  usersOriginDisplay: UsersOriginDisplayOptions.BOTH,
  configurationPageSectionsOrder: DEFAULT_CONFIGURATION_PAGE_SECTIONS_ORDER,
  administratorsIds: [] as string[],
  managersIds: [] as string[],
  auditorsIds: [] as string[],
  customRoles: [] as CustomRole[],
  automaticRoleAssignments: [] as AutomaticRoleAssignment[],
  blockedUserIds: [] as string[],
  rulesWarningText: {
    en: 'Please, make sure you have read and understood them before submitting a request. Not complying with the defined deadlines in the rules document might cause your submission being rejected.',
    pl: 'Prosimy o zapoznanie się z zasadami przed złożeniem wniosku. Niedopełnienie terminów określonych w dokumencie może skutkować odrzuceniem wniosku.'
  },
  rulesFileURL: {
    en: 'https://media.finances.esn-poland.link/rules/finances-rules.pdf',
    pl: 'https://media.finances.esn-poland.link/rules/finances-rules.pdf'
  },
  rulesResolutionNumber: 'XX/XX',
  rulesRevisionDate: '',
  delegationSettlementSheetURL: '',
  delegationInstructionsURL: '',
  guestAccessEnabled: true,
  guestAccessAllowedRequestTypes: ['INVOICE_REIMBURSEMENT', 'DELEGATION_SETTLEMENT'] as FinancialRequestType[],
  guestAccessDefaultExpirationDays: 14,
  guestAccessInstructions: {
    en: 'Please provide all necessary invoice attachments, travel tickets, and proof of payment. Ensure that the bank account details match the invoice or attendee name.',
    pl: 'Prosimy o dołączenie wszystkich faktur, biletów podróżnych oraz potwierdzeń płatności. Upewnij się, że dane konta bankowego są poprawne.'
  },
  guestAccessRequirePurpose: true,
  guestInvitations: [] as GuestInvitation[],
  appLocked: false,
  appLockedAt: undefined as string | undefined,
  appLockMessage: {
    en: 'The application is temporarily locked for maintenance. Please check back later.',
    pl: 'Aplikacja jest tymczasowo zablokowana z powodu prac konserwacyjnych. Prosimy spróbować później.'
  },
  oauthRoleOptions: [...OAUTH_ROLE_OPTIONS] as string[],
  forcedLanguage: 'ALL',
  threadRequestEmails: false,
  threadRequestEmailsSubject: {
    en: 'Financial request {{requestId}}',
    pl: 'Wniosek finansowy {{requestId}}'
  },
  csvExportSettings: DEFAULT_CSV_EXPORT_SETTINGS
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
  /** Automatic role assignments matched against ESN Accounts OAuth extended roles. */
  automaticRoleAssignments: AutomaticRoleAssignment[];
  /** Blocked/suspended user IDs who are prevented from logging in or submitting requests. */
  blockedUserIds: string[];

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
  /** Rasterized PNG companion logo used for email clients when appLogoURL is SVG (CDN URL). */
  appLogoURLEmail: string;
  /** The logo of the organisation used across exported documents (CDN URL). */
  organisationLogoURL: string;
  /** The timezone to use for dates and deadlines. */
  timezone: string;
  /** Origin information to show when presenting users. */
  usersOriginDisplay: UsersOriginDisplayOptions;
  /** Order of configuration subtabs. */
  configurationPageSectionsOrder: ConfigurationPageSection[];
  /** Last update timestamp (ISO string), used for optimistic concurrency control. */
  updatedAt?: string;

  /** Rules warning notice text in supported languages. */
  rulesWarningText: LocalizedText;
  /** Rules document URLs in supported languages (English and Polish). */
  rulesFileURL: LocalizedText;
  /** Delegation settlement blank template sheet URL to download (XLSX). */
  delegationSettlementSheetURL: string;
  /** Delegation instructions guide URL to download or view (e.g. PDF or wiki). */
  delegationInstructionsURL: string;
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

  /** Master switch to temporarily lock the application and disable logins. */
  appLocked: boolean;
  /** ISO timestamp when the application was locked. */
  appLockedAt?: string;
  /** Message displayed on the sign-in page when the application is locked. */
  appLockMessage: LocalizedText;
  /** Configured ESN Accounts OAuth role options offered as checkboxes in modals. */
  oauthRoleOptions: string[];
  /** When set to a specific language code ('en', 'pl', etc.), forces that language everywhere and disables multi-language switches. 'ALL' enables all supported languages. */
  forcedLanguage: string;
  /** Whether financial request email notifications are grouped into a single unified thread. */
  threadRequestEmails: boolean;
  /** Configured unified email subject for financial requests in supported languages. */
  threadRequestEmailsSubject: LocalizedText;
  /** Configured CSV export settings including delimiter, encoding BOM, date format, and column customizations. */
  csvExportSettings: CsvExportSettings;

  constructor(data?: any) {
    super();
    if (data) {
      this.load(data);
    }
  }

  load(x: any): void {
    super.load(x);
    this.updatedAt = this.clean(x.updatedAt, String);
    const normalizeHandle = (id: string) => String(id || '').replace(/^@+/, '').trim().toLowerCase();
    this.administratorsIds = this.cleanArray(x.administratorsIds, String).map(normalizeHandle).filter(Boolean);
    this.managersIds = this.cleanArray(x.managersIds, String).map(normalizeHandle).filter(Boolean);
    this.auditorsIds = this.cleanArray(x.auditorsIds, String).map(normalizeHandle).filter(Boolean);
    this.customRoles = this.cleanArray(x.customRoles, Object).map((role: any) => ({
      id: this.clean(role.id, String),
      name: this.clean(role.name, String),
      userIds: this.cleanArray(role.userIds, String).map(normalizeHandle).filter(Boolean),
      permissions: this.cleanArray(role.permissions, String) as AppPermission[],
      extendedRolePatterns: this.cleanArray(role.extendedRolePatterns, String)
    }));
    this.automaticRoleAssignments = this.cleanArray(x.automaticRoleAssignments, Object).map((assignment: any) => ({
      roleId: this.clean(assignment.roleId, String),
      extendedRolePatterns: this.cleanArray(assignment.extendedRolePatterns, String)
    }));
    this.blockedUserIds = this.cleanArray(x.blockedUserIds, String).map(normalizeHandle).filter(Boolean);

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
    this.appLogoURLEmail = this.clean(x.appLogoURLEmail, String);
    this.organisationLogoURL = this.clean(x.organisationLogoURL, String);
    this.timezone = this.clean(x.timezone, String, DEFAULT_TIMEZONE);
    this.usersOriginDisplay = this.clean(
      x.usersOriginDisplay,
      String,
      DEFAULT_CONFIGURATIONS.usersOriginDisplay || UsersOriginDisplayOptions.BOTH
    );

    const configuredSections = this.cleanArray(x.configurationPageSectionsOrder, String) as ConfigurationPageSection[];
    let resolvedSections = [
      ...configuredSections.filter((section, index) =>
        DEFAULT_CONFIGURATION_PAGE_SECTIONS_ORDER.includes(section) && configuredSections.indexOf(section) === index
      )
    ];
    if (resolvedSections.length > 0 && !resolvedSections.includes('ROLES')) {
      const usersIdx = resolvedSections.indexOf('USERS');
      if (usersIdx !== -1) {
        resolvedSections.splice(usersIdx + 1, 0, 'ROLES');
      } else {
        resolvedSections.push('ROLES');
      }
    }
    if (resolvedSections.length > 0 && !resolvedSections.includes('RESOURCES')) {
      const rolesIdx = resolvedSections.indexOf('ROLES');
      const usersIdx = resolvedSections.indexOf('USERS');
      if (rolesIdx !== -1) {
        resolvedSections.splice(rolesIdx + 1, 0, 'RESOURCES');
      } else if (usersIdx !== -1) {
        resolvedSections.splice(usersIdx + 1, 0, 'RESOURCES');
      } else {
        resolvedSections.push('RESOURCES');
      }
    }
    if (resolvedSections.length > 0 && !resolvedSections.includes('EXPORTS')) {
      const optionsIdx = resolvedSections.indexOf('OPTIONS');
      if (optionsIdx !== -1) {
        resolvedSections.splice(optionsIdx, 0, 'EXPORTS');
      } else {
        resolvedSections.push('EXPORTS');
      }
    }
    for (const section of DEFAULT_CONFIGURATION_PAGE_SECTIONS_ORDER) {
      if (!resolvedSections.includes(section)) {
        resolvedSections.push(section);
      }
    }
    this.configurationPageSectionsOrder = resolvedSections.length ? resolvedSections : [...DEFAULT_CONFIGURATION_PAGE_SECTIONS_ORDER];

    const defaultWarning = DEFAULT_CONFIGURATIONS.rulesWarningText;
    if (typeof x.rulesWarningText === 'string') {
      this.rulesWarningText = { en: x.rulesWarningText, pl: x.rulesWarningText };
    } else {
      this.rulesWarningText = {
        en: this.clean(x.rulesWarningText?.en, String, defaultWarning.en),
        pl: this.clean(x.rulesWarningText?.pl, String, defaultWarning.pl)
      };
    }

    const defaultRulesFileURL = DEFAULT_CONFIGURATIONS.rulesFileURL;
    if (typeof x.rulesFileURL === 'string') {
      this.rulesFileURL = { en: x.rulesFileURL, pl: x.rulesFileURL };
    } else if (x.rulesFileURL && typeof x.rulesFileURL === 'object') {
      this.rulesFileURL = {
        en: typeof x.rulesFileURL.en === 'string' ? x.rulesFileURL.en : (defaultRulesFileURL?.en || ''),
        pl: typeof x.rulesFileURL.pl === 'string' ? x.rulesFileURL.pl : (defaultRulesFileURL?.pl || '')
      };
    } else {
      this.rulesFileURL = {
        en: defaultRulesFileURL?.en || '',
        pl: defaultRulesFileURL?.pl || ''
      };
    }
    this.delegationSettlementSheetURL = this.clean(
      x.delegationSettlementSheetURL,
      String,
      DEFAULT_CONFIGURATIONS.delegationSettlementSheetURL
    );
    this.delegationInstructionsURL = this.clean(
      x.delegationInstructionsURL,
      String,
      DEFAULT_CONFIGURATIONS.delegationInstructionsURL
    );
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

    this.appLocked =
      x.appLocked !== undefined
        ? Boolean(x.appLocked)
        : DEFAULT_CONFIGURATIONS.appLocked;
    this.appLockedAt = this.clean(x.appLockedAt, String);
    const defaultLockMessage = DEFAULT_CONFIGURATIONS.appLockMessage;
    if (typeof x.appLockMessage === 'string') {
      this.appLockMessage = { en: x.appLockMessage, pl: x.appLockMessage };
    } else {
      this.appLockMessage = {
        en: this.clean(x.appLockMessage?.en, String, defaultLockMessage.en),
        pl: this.clean(x.appLockMessage?.pl, String, defaultLockMessage.pl)
      };
    }
    this.oauthRoleOptions = this.cleanArray(
      x.oauthRoleOptions,
      String,
      DEFAULT_CONFIGURATIONS.oauthRoleOptions
    );
    this.forcedLanguage = this.clean(x.forcedLanguage, String, DEFAULT_CONFIGURATIONS.forcedLanguage);
    this.threadRequestEmails =
      x.threadRequestEmails !== undefined
        ? Boolean(x.threadRequestEmails)
        : DEFAULT_CONFIGURATIONS.threadRequestEmails;
    const defaultThreadSubject = DEFAULT_CONFIGURATIONS.threadRequestEmailsSubject;
    if (typeof x.threadRequestEmailsSubject === 'string') {
      this.threadRequestEmailsSubject = { en: x.threadRequestEmailsSubject, pl: x.threadRequestEmailsSubject };
    } else {
      this.threadRequestEmailsSubject = {
        en: this.clean(x.threadRequestEmailsSubject?.en, String, defaultThreadSubject.en),
        pl: this.clean(x.threadRequestEmailsSubject?.pl, String, defaultThreadSubject.pl)
      };
    }
    this.csvExportSettings = cleanCsvExportSettings(x.csvExportSettings);
  }

  getThreadRequestEmailsSubject(lang: string = 'en'): string {
    const effectiveLang = (this.forcedLanguage && this.forcedLanguage !== 'ALL') ? this.forcedLanguage : lang;
    if (typeof this.threadRequestEmailsSubject === 'string') return this.threadRequestEmailsSubject;
    return (this.threadRequestEmailsSubject as any)?.[effectiveLang] ||
      this.threadRequestEmailsSubject?.en ||
      this.threadRequestEmailsSubject?.pl ||
      (effectiveLang === 'en' ? 'Financial request {{requestId}}' : 'Wniosek finansowy {{requestId}}');
  }

  getAppTitle(lang: string = 'en'): string {
    const effectiveLang = (this.forcedLanguage && this.forcedLanguage !== 'ALL') ? this.forcedLanguage : lang;
    if (typeof this.appTitle === 'string') return this.appTitle;
    return (this.appTitle as any)?.[effectiveLang] || this.appTitle?.en || this.appTitle?.pl || '';
  }

  getAppOrganisation(lang: string = 'en'): string {
    const effectiveLang = (this.forcedLanguage && this.forcedLanguage !== 'ALL') ? this.forcedLanguage : lang;
    if (typeof this.appOrganisation === 'string') return this.appOrganisation;
    return (this.appOrganisation as any)?.[effectiveLang] || this.appOrganisation?.en || this.appOrganisation?.pl || '';
  }

  getOrganisationLogo(): string {
    return this.organisationLogoURL || '';
  }

  getRulesWarningText(lang: string = 'en'): string {
    const effectiveLang = (this.forcedLanguage && this.forcedLanguage !== 'ALL') ? this.forcedLanguage : lang;
    if (typeof this.rulesWarningText === 'string') return this.rulesWarningText;
    return (this.rulesWarningText as any)?.[effectiveLang] || this.rulesWarningText?.en || this.rulesWarningText?.pl || '';
  }

  getRulesFileURL(lang: string = 'en'): string {
    const effectiveLang = (this.forcedLanguage && this.forcedLanguage !== 'ALL') ? this.forcedLanguage : lang;
    if (typeof this.rulesFileURL === 'string') return this.rulesFileURL;
    return (this.rulesFileURL as any)?.[effectiveLang] || (effectiveLang === 'en' ? this.rulesFileURL?.pl : this.rulesFileURL?.en) || this.rulesFileURL?.pl || this.rulesFileURL?.en || '';
  }

  getHomeWelcomeTitle(lang: string = 'en'): string {
    const effectiveLang = (this.forcedLanguage && this.forcedLanguage !== 'ALL') ? this.forcedLanguage : lang;
    if (typeof this.homeWelcomeTitle === 'string') return this.homeWelcomeTitle;
    return (this.homeWelcomeTitle as any)?.[effectiveLang] || this.homeWelcomeTitle?.en || this.homeWelcomeTitle?.pl || '';
  }

  getHomeWelcomeSubtitle(lang: string = 'en'): string {
    const effectiveLang = (this.forcedLanguage && this.forcedLanguage !== 'ALL') ? this.forcedLanguage : lang;
    if (typeof this.homeWelcomeSubtitle === 'string') return this.homeWelcomeSubtitle;
    return (this.homeWelcomeSubtitle as any)?.[effectiveLang] || this.homeWelcomeSubtitle?.en || this.homeWelcomeSubtitle?.pl || '';
  }

  getHomeNoticeText(lang: string = 'en'): string {
    const effectiveLang = (this.forcedLanguage && this.forcedLanguage !== 'ALL') ? this.forcedLanguage : lang;
    if (!this.homeNotice?.text) return '';
    if (typeof this.homeNotice.text === 'string') return this.homeNotice.text;
    return (this.homeNotice.text as any)?.[effectiveLang] || this.homeNotice.text?.en || this.homeNotice.text?.pl || '';
  }

  isHomeNoticeActive(): boolean {
    return !!this.homeNotice?.active && !!(this.homeNotice?.text?.en?.trim() || this.homeNotice?.text?.pl?.trim());
  }

  getAppLockMessage(lang: string = 'en'): string {
    const effectiveLang = (this.forcedLanguage && this.forcedLanguage !== 'ALL') ? this.forcedLanguage : lang;
    if (typeof this.appLockMessage === 'string') return this.appLockMessage;
    return (this.appLockMessage as any)?.[effectiveLang] || this.appLockMessage?.en || this.appLockMessage?.pl || '';
  }

  getOAuthRoleOptions(): string[] {
    return (this.oauthRoleOptions && this.oauthRoleOptions.length > 0)
      ? this.oauthRoleOptions
      : OAUTH_ROLE_OPTIONS;
  }

  safeLoad(newData: any, safeData: any): void {
    super.safeLoad(newData, safeData);
    this.PK = Configurations.PK;
    this.updatedAt = this.clean(safeData.updatedAt, String);
    this.homeWelcomeTitle = safeData.homeWelcomeTitle;
    this.homeWelcomeSubtitle = safeData.homeWelcomeSubtitle;
    this.homeNotice = safeData.homeNotice;
    this.rulesWarningText = safeData.rulesWarningText;
    if (typeof safeData.rulesFileURL === 'string') {
      this.rulesFileURL = { en: safeData.rulesFileURL, pl: safeData.rulesFileURL };
    } else if (safeData.rulesFileURL && typeof safeData.rulesFileURL === 'object') {
      this.rulesFileURL = {
        en: typeof safeData.rulesFileURL.en === 'string' ? safeData.rulesFileURL.en : (DEFAULT_CONFIGURATIONS.rulesFileURL?.en || ''),
        pl: typeof safeData.rulesFileURL.pl === 'string' ? safeData.rulesFileURL.pl : (DEFAULT_CONFIGURATIONS.rulesFileURL?.pl || '')
      };
    } else {
      this.rulesFileURL = safeData.rulesFileURL || DEFAULT_CONFIGURATIONS.rulesFileURL;
    }
    this.delegationSettlementSheetURL = this.clean(
      safeData.delegationSettlementSheetURL,
      String,
      DEFAULT_CONFIGURATIONS.delegationSettlementSheetURL
    );
    this.delegationInstructionsURL = this.clean(
      safeData.delegationInstructionsURL,
      String,
      DEFAULT_CONFIGURATIONS.delegationInstructionsURL
    );
    this.rulesResolutionNumber = safeData.rulesResolutionNumber;
    this.rulesRevisionDate = safeData.rulesRevisionDate;
    this.guestAccessEnabled = safeData.guestAccessEnabled;
    this.guestAccessAllowedRequestTypes = safeData.guestAccessAllowedRequestTypes;
    this.guestAccessDefaultExpirationDays = safeData.guestAccessDefaultExpirationDays;
    this.guestAccessInstructions = safeData.guestAccessInstructions;
    this.guestAccessRequirePurpose = safeData.guestAccessRequirePurpose;
    this.guestInvitations = safeData.guestInvitations;
    this.appLocked = safeData.appLocked !== undefined ? Boolean(safeData.appLocked) : DEFAULT_CONFIGURATIONS.appLocked;
    this.appLockedAt = safeData.appLockedAt ? String(safeData.appLockedAt) : undefined;
    this.appLockMessage = safeData.appLockMessage || DEFAULT_CONFIGURATIONS.appLockMessage;
    this.oauthRoleOptions = safeData.oauthRoleOptions !== undefined ? safeData.oauthRoleOptions : DEFAULT_CONFIGURATIONS.oauthRoleOptions;
    this.forcedLanguage = safeData.forcedLanguage !== undefined ? this.clean(safeData.forcedLanguage, String, DEFAULT_CONFIGURATIONS.forcedLanguage) : DEFAULT_CONFIGURATIONS.forcedLanguage;
    this.blockedUserIds = safeData.blockedUserIds !== undefined
      ? this.cleanArray(safeData.blockedUserIds, String).map((id: string) => String(id || '').replace(/^@+/, '').trim().toLowerCase()).filter(Boolean)
      : DEFAULT_CONFIGURATIONS.blockedUserIds;
    this.threadRequestEmails =
      safeData.threadRequestEmails !== undefined
        ? Boolean(safeData.threadRequestEmails)
        : DEFAULT_CONFIGURATIONS.threadRequestEmails;
    const defaultThreadSubject = DEFAULT_CONFIGURATIONS.threadRequestEmailsSubject;
    if (typeof safeData.threadRequestEmailsSubject === 'string') {
      this.threadRequestEmailsSubject = { en: safeData.threadRequestEmailsSubject, pl: safeData.threadRequestEmailsSubject };
    } else if (safeData.threadRequestEmailsSubject && typeof safeData.threadRequestEmailsSubject === 'object') {
      this.threadRequestEmailsSubject = {
        en: typeof safeData.threadRequestEmailsSubject.en === 'string' ? safeData.threadRequestEmailsSubject.en : defaultThreadSubject.en,
        pl: typeof safeData.threadRequestEmailsSubject.pl === 'string' ? safeData.threadRequestEmailsSubject.pl : defaultThreadSubject.pl
      };
    } else {
      this.threadRequestEmailsSubject = defaultThreadSubject;
    }
    this.csvExportSettings = cleanCsvExportSettings(safeData.csvExportSettings);
  }

  hasAdminGroup(): boolean {
    const adminAssignment = (this.automaticRoleAssignments || []).find(a => a.roleId === 'ADMINISTRATOR');
    return !!adminAssignment && (adminAssignment.extendedRolePatterns || []).length > 0;
  }

  validate(): string[] {
    const errors = super.validate();
    if (this.iE(this.administratorsIds) && !this.hasAdminGroup()) errors.push('administratorsIds');
    const adminIds = new Set((this.administratorsIds || []).map(id => id.toLowerCase()));
    if ((this.blockedUserIds || []).some(id => adminIds.has(id.toLowerCase()))) {
      errors.push('blockedUserIds.cannotSuspendAdmin');
    }
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
    const validExtendedRolePattern = /^[A-Za-z0-9*_-]+(?:\.[A-Za-z0-9*_-]+)*:[A-Za-z0-9*_-]+$/;
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
    for (const option of this.oauthRoleOptions || []) {
      if (!validExtendedRolePattern.test(option)) {
        errors.push('oauthRoleOptions');
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

    if (this.csvExportSettings) {
      const validDelimiters = [';', ',', '\t'];
      if (!validDelimiters.includes(this.csvExportSettings.delimiter)) {
        errors.push('csvExportSettings.delimiter');
      }
      if (!Array.isArray(this.csvExportSettings.columns) || this.csvExportSettings.columns.length === 0) {
        errors.push('csvExportSettings.columns');
      }
    }

    return errors;
  }
}
