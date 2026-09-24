import { DynamoDB, HandledError, ResourceController, S3, SES } from 'idea-aws';
import {
  AppPermission,
  Configurations,
  DEFAULT_CONFIGURATION_PAGE_SECTIONS_ORDER,
  EmailTemplates,
  formatSenderName
} from '../models/configurations.model';
import { User } from '../models/user.model';
import { isEmailInBlockList } from './sesNotifications';

const PROJECT = process.env.PROJECT || 'esn-poland-finances';
const STAGE = process.env.STAGE || 'dev';
const APP_DOMAIN = process.env.APP_DOMAIN || 'finances.esn-poland.link';
const BASE_URL = `https://${APP_DOMAIN}`;
const S3_BUCKET_MEDIA = process.env.S3_BUCKET_MEDIA || `${PROJECT}-media`;
const S3_ASSETS_FOLDER = process.env.S3_ASSETS_FOLDER || `assets/${STAGE}`;
const SES_CONFIG = {
  source: process.env.SES_SOURCE_ADDRESS || 'no-reply@esn-poland.link',
  sourceArn: process.env.SES_IDENTITY_ARN,
  region: process.env.SES_REGION
};
const DDB_TABLES = {
  configurations: process.env.DDB_TABLE_configurations
};

const ddb = new DynamoDB();
const s3 = new S3();
const ses = new SES();

export const handler = (ev: any, _: any, cb: any): Promise<void> => new ConfigurationsRC(ev, cb).handleRequest();

class ConfigurationsRC extends ResourceController {
  user: User | null = null;
  configurations!: Configurations;

  constructor(event: any, callback: any) {
    super(event, callback);
    // GET /configurations is public; PUT/PATCH are protected by authorizer
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
    const isLocking = Boolean(this.body?.appLocked && !this.configurations?.appLocked);
    let appLockedAt = this.configurations?.appLockedAt;
    if (isLocking || (this.body?.appLocked && !appLockedAt)) {
      appLockedAt = newUpdatedAt;
    }
    const newConfigurations = new Configurations({
      ...this.body,
      appLockedAt,
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
      if (this.configurations?.delegationSettlementSheetURL && newConfigurations.delegationSettlementSheetURL !== this.configurations.delegationSettlementSheetURL) {
        await this.deleteOldS3File(this.configurations.delegationSettlementSheetURL);
      }
      if (this.configurations?.delegationInstructionsURL && newConfigurations.delegationInstructionsURL !== this.configurations.delegationInstructionsURL) {
        await this.deleteOldS3File(this.configurations.delegationInstructionsURL);
      }
      if (this.configurations?.appLogoURL && newConfigurations.appLogoURL !== this.configurations.appLogoURL) {
        await this.deleteOldS3File(this.configurations.appLogoURL);
      }
      if (this.configurations?.appLogoURLDarkMode && newConfigurations.appLogoURLDarkMode !== this.configurations.appLogoURLDarkMode) {
        await this.deleteOldS3File(this.configurations.appLogoURLDarkMode);
      }
      if (this.configurations?.organisationLogoURL && newConfigurations.organisationLogoURL !== this.configurations.organisationLogoURL) {
        await this.deleteOldS3File(this.configurations.organisationLogoURL);
      }
    }

    this.configurations = newConfigurations;
    return this.configurations;
  }

  /**
   * PATCH /configurations
   * Handles SES templates management & sending guest invitation emails
   */
  protected async patchResources(): Promise<any> {
    if (!this.user) {
      throw new HandledError('Unauthorized');
    }

    const action = this.body?.action;

    // Guest invitation sending can be performed by users with GUESTS permission
    if (action === 'SEND_GUEST_INVITATION_EMAIL') {
      if (!this.user.isAdministrator && !this.user.hasPermission(AppPermission.CONFIGURATIONS.GUESTS)) {
        throw new HandledError('Unauthorized');
      }
      return await this.sendGuestInvitationEmail(this.body);
    }

    // Viewing templates can be performed by administrators, auditors, or users with TEMPLATES permission
    if (action === 'GET_EMAIL_TEMPLATE') {
      if (
        !this.user.isAdministrator &&
        !this.user.isAuditor &&
        !this.user.hasPermission(AppPermission.CONFIGURATIONS.TEMPLATES)
      ) {
        throw new HandledError('Unauthorized');
      }
      return await this.getEmailTemplate(this.body.template);
    }

    // All template modifications and tests require TEMPLATES permission and cannot be performed by auditors
    if (
      this.user.isAuditor ||
      (!this.user.isAdministrator && !this.user.hasPermission(AppPermission.CONFIGURATIONS.TEMPLATES))
    ) {
      throw new HandledError('Unauthorized');
    }

    switch (action) {
      case 'SET_EMAIL_TEMPLATE':
        return await this.setEmailTemplate(this.body.template, this.body.subject, this.body.content);
      case 'RESET_EMAIL_TEMPLATE':
        return await this.resetEmailTemplate(this.body.template);
      case 'TEST_EMAIL_TEMPLATE':
        return await this.testEmailTemplate(this.body.template);
      default:
        throw new HandledError('Unsupported action');
    }
  }

  private getSESTemplateName(emailTemplate: EmailTemplates): string {
    switch (emailTemplate) {
      case EmailTemplates.GUEST_INVITATION_PL:
        return 'notify-guest-invitation-pl';
      case EmailTemplates.GUEST_INVITATION_EN:
        return 'notify-guest-invitation-en';
      case EmailTemplates.REQUEST_SUBMITTED_PL:
        return 'notify-request-submitted-pl';
      case EmailTemplates.REQUEST_SUBMITTED_EN:
        return 'notify-request-submitted-en';
      case EmailTemplates.REQUEST_CHANGES_REQUESTED_PL:
        return 'notify-request-changes-requested-pl';
      case EmailTemplates.REQUEST_CHANGES_REQUESTED_EN:
        return 'notify-request-changes-requested-en';
      case EmailTemplates.REQUEST_APPROVED_PL:
        return 'notify-request-approved-pl';
      case EmailTemplates.REQUEST_APPROVED_EN:
        return 'notify-request-approved-en';
      case EmailTemplates.REQUEST_PAID_PL:
        return 'notify-request-paid-pl';
      case EmailTemplates.REQUEST_PAID_EN:
        return 'notify-request-paid-en';
      case EmailTemplates.REQUEST_REJECTED_PL:
        return 'notify-request-rejected-pl';
      case EmailTemplates.REQUEST_REJECTED_EN:
        return 'notify-request-rejected-en';
      default:
        throw new HandledError("Template doesn't exist");
    }
  }

  private async getEmailTemplate(emailTemplate: EmailTemplates): Promise<{ subject: string; content: string }> {
    const templateName = this.getSESTemplateName(emailTemplate);
    try {
      const template = await ses.getTemplate(`${templateName}-${STAGE}`);
      return { subject: template.Subject || '', content: template.Html || '' };
    } catch (error) {
      // If not yet present in SES, load default .hbs from S3 assets and initialize
      await this.resetEmailTemplate(emailTemplate);
      const template = await ses.getTemplate(`${templateName}-${STAGE}`);
      return { subject: template.Subject || '', content: template.Html || '' };
    }
  }

  private async setEmailTemplate(emailTemplate: EmailTemplates, subject: string, content: string): Promise<void> {
    if (!subject || !subject.trim()) throw new HandledError('Missing subject');
    if (!content || !content.trim()) throw new HandledError('Missing content');

    const templateName = this.getSESTemplateName(emailTemplate);

    // Validate template syntax using SES testTemplate before saving
    try {
      await ses.testTemplate(`${templateName}-${STAGE}`, {
        user: 'Jan Kowalski',
        title: 'Example Purpose',
        detail: '150.00 PLN',
        url: BASE_URL,
        message: 'Example Message',
        requestId: '1/2026',
        status: 'SUBMITTED'
      });
    } catch (err: any) {
      this.logger.warn('Syntax test warning for template', err);
    }

    await ses.setTemplate(`${templateName}-${STAGE}`, subject, content, true);
  }

  private async testEmailTemplate(emailTemplate: EmailTemplates): Promise<void> {
    const toEmail = this.user?.email;
    if (!toEmail) throw new HandledError('User email not found');

    const templateName = this.getSESTemplateName(emailTemplate);
    const isEnglish = emailTemplate.endsWith('_EN');
    const senderName = formatSenderName(this.configurations?.getAppTitle(isEnglish ? 'en' : 'pl') || 'ESN Poland');
    const templateData = {
      user: this.user ? this.user.getDisplayName() : 'User',
      title: isEnglish ? 'National Assembly Reimbursement' : 'Zjazd Krajowy',
      detail: '250.00 PLN',
      url: `${BASE_URL}/t/requests`,
      message: isEnglish ? 'This is an example notification message.' : 'To jest przykładowa treść wiadomości.',
      requestId: '1/2026',
      status: 'SUBMITTED'
    };

    try {
      await ses.testTemplate(`${templateName}-${STAGE}`, templateData);
    } catch (error) {
      this.logger.warn('Testing template syntax failed', error, { template: `${templateName}-${STAGE}` });
      throw new HandledError('Bad template syntax');
    }

    try {
      await ses.sendTemplatedEmail({
        toAddresses: [toEmail],
        template: `${templateName}-${STAGE}`,
        templateData
      }, {
        ...SES_CONFIG,
        sourceName: senderName
      });
    } catch (error: any) {
      this.logger.error('Sending test email failed', error, { template: `${templateName}-${STAGE}` });
      throw new HandledError(`Sending failed: ${error?.message || 'SES error'}`);
    }
  }

  private async resetEmailTemplate(emailTemplate: EmailTemplates): Promise<void> {
    const templateName = this.getSESTemplateName(emailTemplate);
    const defaultSubjects: Record<EmailTemplates, string> = {
      [EmailTemplates.GUEST_INVITATION_PL]: 'Zaproszenie do złożenia wniosku finansowego',
      [EmailTemplates.GUEST_INVITATION_EN]: 'Invitation to submit financial request',
      [EmailTemplates.REQUEST_SUBMITTED_PL]: 'Potwierdzenie złożenia wniosku finansowego {{requestId}}',
      [EmailTemplates.REQUEST_SUBMITTED_EN]: 'Financial request submitted {{requestId}}',
      [EmailTemplates.REQUEST_CHANGES_REQUESTED_PL]: 'Wymagane poprawki do wniosku finansowego {{requestId}}',
      [EmailTemplates.REQUEST_CHANGES_REQUESTED_EN]: 'Changes requested for financial request {{requestId}}',
      [EmailTemplates.REQUEST_APPROVED_PL]: 'Wniosek finansowy {{requestId}} został zatwierdzony',
      [EmailTemplates.REQUEST_APPROVED_EN]: 'Financial request {{requestId}} approved',
      [EmailTemplates.REQUEST_PAID_PL]: 'Wypłata środków dla wniosku finansowego {{requestId}}',
      [EmailTemplates.REQUEST_PAID_EN]: 'Payment processed for financial request {{requestId}}',
      [EmailTemplates.REQUEST_REJECTED_PL]: 'Wniosek finansowy {{requestId}} został odrzucony',
      [EmailTemplates.REQUEST_REJECTED_EN]: 'Financial request {{requestId}} rejected'
    };

    const subject = defaultSubjects[emailTemplate] || templateName;
    const content = await s3.getObjectAsText({
      bucket: S3_BUCKET_MEDIA,
      key: `${S3_ASSETS_FOLDER}/${templateName}.hbs`
    });

    await ses.setTemplate(`${templateName}-${STAGE}`, subject, content, true);
  }

  private async sendGuestInvitationEmail(params: {
    inviteId: string;
    lang?: 'pl' | 'en';
    subject?: string;
    content?: string;
  }): Promise<{ success: boolean; message?: string }> {
    const { inviteId, lang = 'pl', subject, content } = params;
    if (!inviteId) throw new HandledError('Missing inviteId');

    const invite = (this.configurations?.guestInvitations || []).find(i => i.id === inviteId);
    if (!invite) throw new HandledError('Guest invitation not found');
    if (!invite.guestEmail) throw new HandledError('Guest invitation has no email');

    if (await isEmailInBlockList(invite.guestEmail)) {
      throw new HandledError('Recipient email is blocked due to previous bounces');
    }

    let effectiveLang: 'pl' | 'en' = lang;
    if (this.configurations?.forcedLanguage && this.configurations.forcedLanguage !== 'ALL') {
      effectiveLang = this.configurations.forcedLanguage === 'pl' ? 'pl' : 'en';
    }

    const guestLink = `${BASE_URL}/auth?guestToken=${encodeURIComponent(invite.id)}`;
    const expiryDate = invite.expiresAt ? new Date(invite.expiresAt).toLocaleDateString(effectiveLang === 'pl' ? 'pl-PL' : 'en-US') : '';
    const senderName = formatSenderName(this.configurations?.getAppTitle(effectiveLang) || 'ESN Poland');
    const sesParams = {
      ...SES_CONFIG,
      sourceName: senderName
    };

    if (subject && content) {
      // Send customized email (rendered HTML or direct text)
      await ses.sendEmail({
        toAddresses: [invite.guestEmail],
        subject,
        html: content
      }, sesParams);
    } else {
      // Send templated email
      const templateEnum = effectiveLang === 'en' ? EmailTemplates.GUEST_INVITATION_EN : EmailTemplates.GUEST_INVITATION_PL;
      const templateName = this.getSESTemplateName(templateEnum);
      const templateData = {
        user: invite.guestName,
        title: invite.purpose || 'ESN Polska',
        detail: expiryDate,
        url: guestLink,
        message: invite.instructions?.[effectiveLang] || ''
      };

      try {
        await ses.sendTemplatedEmail({
          toAddresses: [invite.guestEmail],
          template: `${templateName}-${STAGE}`,
          templateData
        }, sesParams);
      } catch (err: any) {
        if (String(err).includes('does not exist') || err?.name === 'NotFoundException') {
          await this.resetEmailTemplate(templateEnum);
          await ses.sendTemplatedEmail({
            toAddresses: [invite.guestEmail],
            template: `${templateName}-${STAGE}`,
            templateData
          }, sesParams);
        } else {
          throw err;
        }
      }
    }

    return { success: true };
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
      'appOrganisation',
      'homeWelcomeTitle',
      'homeWelcomeSubtitle',
      'homeNotice',
      'supportEmail',
      'appLogoURL',
      'appLogoURLDarkMode',
      'organisationLogoURL',
      'timezone',
      'usersOriginDisplay',
      'configurationPageSectionsOrder',
      'administratorsIds',
      'managersIds',
      'auditorsIds',
      'customRoles',
      'automaticRoleAssignments',
      'rulesWarningText',
      'rulesFileURL',
      'rulesResolutionNumber',
      'rulesRevisionDate',
      'delegationSettlementSheetURL',
      'delegationInstructionsURL',
      'guestAccessEnabled',
      'guestAccessAllowedRequestTypes',
      'guestAccessDefaultExpirationDays',
      'guestAccessInstructions',
      'guestAccessRequirePurpose',
      'guestInvitations',
      'appLocked',
      'appLockedAt',
      'appLockMessage'
    ].filter(field => JSON.stringify(this.body[field]) !== JSON.stringify((this.configurations as any)[field]));

    if (!changedFields.length) return;

    if (this.user.isAuditor) {
      throw new HandledError('Unauthorized');
    }

    const hasFullConfigurationsRights =
      this.user.isAdministrator ||
      DEFAULT_CONFIGURATION_PAGE_SECTIONS_ORDER.every(section => {
        if (section === 'OPTIONS') return this.user!.hasPermission(AppPermission.CONFIGURATIONS.OPTIONS);
        if (section === 'USERS') return this.user!.hasPermission(AppPermission.CONFIGURATIONS.USERS);
        if (section === 'RESOURCES') return this.user!.hasPermission(AppPermission.CONFIGURATIONS.RESOURCES);
        if (section === 'GUESTS') return this.user!.hasPermission(AppPermission.CONFIGURATIONS.GUESTS);
        if (section === 'TEMPLATES') return this.user!.hasPermission(AppPermission.CONFIGURATIONS.TEMPLATES);
        return false;
      });

    // Tab ordering is restricted to administrators or users with full configuration rights
    if (changedFields.includes('configurationPageSectionsOrder') && !hasFullConfigurationsRights) {
      throw new HandledError('Unauthorized: only users with full configuration rights can reorder configuration tabs');
    }

    const optionFields = [
      'appTitle',
      'appOrganisation',
      'homeWelcomeTitle',
      'homeWelcomeSubtitle',
      'homeNotice',
      'supportEmail',
      'appLogoURL',
      'appLogoURLDarkMode',
      'organisationLogoURL',
      'timezone',
      'usersOriginDisplay',
      'appLocked',
      'appLockedAt',
      'appLockMessage'
    ];

    const resourceFields = [
      'delegationSettlementSheetURL',
      'delegationInstructionsURL'
    ];

    const userFields = [
      'administratorsIds',
      'managersIds',
      'auditorsIds',
      'customRoles',
      'automaticRoleAssignments'
    ];

    const guestFields = [
      'guestAccessEnabled',
      'guestAccessAllowedRequestTypes',
      'guestAccessDefaultExpirationDays',
      'guestAccessInstructions',
      'guestAccessRequirePurpose',
      'guestInvitations'
    ];

    const homeTextFields = ['homeWelcomeTitle', 'homeWelcomeSubtitle'];
    const homeNoticeFields = ['homeNotice'];
    const rulesTextFields = ['rulesWarningText'];
    const rulesDocumentFields = ['rulesFileURL', 'rulesResolutionNumber', 'rulesRevisionDate'];

    const allowedFields = [
      ...(this.user.hasPermission(AppPermission.CONFIGURATIONS.OPTIONS) ? optionFields : []),
      ...(this.user.hasPermission(AppPermission.CONFIGURATIONS.RESOURCES) || this.user.hasPermission(AppPermission.CONFIGURATIONS.OPTIONS) ? resourceFields : []),
      ...(this.user.hasPermission(AppPermission.CONFIGURATIONS.USERS) ? userFields : []),
      ...(this.user.hasPermission(AppPermission.CONFIGURATIONS.GUESTS) ? guestFields : []),
      ...(hasFullConfigurationsRights ? ['configurationPageSectionsOrder'] : []),
      ...(this.user.hasPermission(AppPermission.RULES.TEXT) ? rulesTextFields : []),
      ...(this.user.hasPermission(AppPermission.RULES.UPDATE) ? rulesDocumentFields : []),
      ...(this.user.hasPermission(AppPermission.HOME.TEXT) ? homeTextFields : []),
      ...(this.user.hasPermission(AppPermission.HOME.NOTICE) ? homeNoticeFields : [])
    ];

    if (changedFields.some(field => !allowedFields.includes(field))) {
      throw new HandledError('Unauthorized: insufficient permissions for updated fields');
    }
  }
}
