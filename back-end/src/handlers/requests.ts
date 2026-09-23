import { DynamoDB, HandledError, ResourceController, S3, SES } from 'idea-aws';
import { randomUUID } from 'crypto';
import { FinancialRequest } from '../models/financial-request.model';
import { AppPermission, Configurations, EmailTemplates, formatSenderName } from '../models/configurations.model';
import { User } from '../models/user.model';
import { isEmailInBlockList } from './sesNotifications';

const STAGE = process.env.STAGE || 'dev';
const APP_DOMAIN = process.env.APP_DOMAIN || 'finances.esn-poland.link';
const BASE_URL = `https://${APP_DOMAIN}`;
const SES_CONFIG = {
  source: process.env.SES_SOURCE_ADDRESS || 'no-reply@esn-poland.link',
  sourceArn: process.env.SES_IDENTITY_ARN,
  region: process.env.SES_REGION
};
const DDB_TABLES = {
  requests: process.env.DDB_TABLE_financial_requests || 'esn-poland-finances-dev-financial_requests',
  configurations: process.env.DDB_TABLE_configurations
};
const S3_BUCKET_MEDIA = process.env.S3_BUCKET_MEDIA || 'esn-poland-finances-media';
const S3_ASSETS_FOLDER = process.env.S3_ASSETS_FOLDER || `assets/${STAGE}`;

const ddb = new DynamoDB();
const ses = new SES();
const s3 = new S3();

export const handler = (ev: any, _: any, cb: any): Promise<void> => new RequestsHandler(ev, cb).handleRequest();

class RequestsHandler extends ResourceController {
  constructor(event: any, callback: any) {
    super(event, callback, { resourceId: 'id' });
  }

  protected async getResource(): Promise<any> {
    return this.getResources();
  }

  protected async postResources(): Promise<any> {
    return this.postResource();
  }

  protected async patchResources(): Promise<any> {
    return this.patchResource();
  }

  protected async deleteResources(): Promise<any> {
    return this.deleteResource();
  }

  private getRequestId(): string | undefined {
    if (this.pathParameters?.year && this.pathParameters?.id) {
      return `${decodeURIComponent(this.pathParameters.id)}/${decodeURIComponent(this.pathParameters.year)}`;
    }
    const id = this.pathParameters?.id || this.queryParams?.id || this.body?.requestId;
    if (id) {
      return decodeURIComponent(id);
    }
    return undefined;
  }

  /**
   * GET /requests or GET /requests/{id}
   */
  protected async getResources(): Promise<any> {
    const user = this.getAuthenticatedUser();
    const canViewAll =
      user.isAdministrator ||
      user.isManager ||
      user.isAuditor ||
      user.hasPermission(AppPermission.REQUESTS.VIEW_ALL) ||
      user.hasPermission(AppPermission.REQUESTS.MANAGE) ||
      user.hasPermission(AppPermission.REQUESTS.PARENT);

    const requestId = this.getRequestId();

    if (requestId) {
      const decodedId = requestId;
      const raw = await ddb.get({
        TableName: DDB_TABLES.requests,
        Key: { requestId: decodedId }
      }).catch(() => null);

      if (!raw) {
        throw new HandledError('Request not found');
      }

      const request = new FinancialRequest(raw);
      const isOwner = (request.userId || '').toLowerCase() === (user.userId || '').toLowerCase();
      if (!canViewAll && !isOwner) {
        throw new HandledError('Access denied');
      }

      return request;
    }

    // List all requests if requested and user has view_all permissions
    if (this.queryParams?.all === 'true') {
      if (!canViewAll) {
        throw new HandledError('Access denied');
      }
      const items: any[] = await ddb.scan({
        TableName: DDB_TABLES.requests
      });
      return items
        .filter((x: any) => x.status !== 'DRAFT')
        .map((x: any) => new FinancialRequest(x))
        .sort((a: FinancialRequest, b: FinancialRequest) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }

    // List current user's requests using GSI
    try {
      const items: any[] = await ddb.query({
        TableName: DDB_TABLES.requests,
        IndexName: 'byUser',
        KeyConditionExpression: 'userId = :uid',
        ExpressionAttributeValues: {
          ':uid': user.userId.toLowerCase()
        },
        ScanIndexForward: false
      });
      return items
        .map((x: any) => new FinancialRequest(x))
        .sort((a: FinancialRequest, b: FinancialRequest) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } catch (err) {
      this.logger.error('Failed to query user requests by index', err);
      // Fallback scan with filter
      const items: any[] = await ddb.scan({
        TableName: DDB_TABLES.requests,
        FilterExpression: 'userId = :uid',
        ExpressionAttributeValues: {
          ':uid': user.userId.toLowerCase()
        }
      });
      return items
        .map((x: any) => new FinancialRequest(x))
        .sort((a: FinancialRequest, b: FinancialRequest) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
  }

  /**
   * POST /requests
   * Creates or submits a new request
   */
  protected async postResource(): Promise<any> {
    const user = this.getAuthenticatedUser();
    const body = this.body || {};
    const status = body.status || 'DRAFT';
    const year = new Date().getFullYear();

    if (user.isGuest) {
      if (user.guestAllowedRequestTypes?.length && body.requestType && !user.guestAllowedRequestTypes.includes(body.requestType)) {
        throw new HandledError('Request type not allowed for this guest invitation');
      }
      if (user.guestMaxAmount && Number(body.totalGrossAmount || 0) > user.guestMaxAmount) {
        throw new HandledError(`Total gross amount exceeds guest limit of ${user.guestMaxAmount} PLN`);
      }
    }

    let sequenceNumber: number | undefined;
    let requestId: string;

    if (status === 'SUBMITTED') {
      sequenceNumber = await this.getNextSequenceNumber(year);
      requestId = `${sequenceNumber}/${year}`;
    } else {
      requestId = `draft_${randomUUID().replace(/-/g, '')}`;
    }

    const request = new FinancialRequest({
      ...body,
      requestId,
      year,
      sequenceNumber,
      userId: user.userId.toLowerCase(),
      userDisplayName: user.getDisplayName(),
      userEmail: user.email,
      userAvatarURL: user.avatarURL || '',
      section: user.section || user.sectionCode || '',
      country: user.country || '',
      extendedRoles: user.extendedRoles || [],
      isGuest: !!user.isGuest,
      guestInvitationId: user.guestInvitationId,
      guestPurpose: user.guestPurpose,
      status,
      statusHistory: [
        {
          status,
          timestamp: new Date().toISOString(),
          updatedBy: user.getDisplayName() || user.userId,
          comment: status === 'SUBMITTED' ? 'Initial submission' : 'Draft created'
        }
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    if (request.status === 'SUBMITTED') {
      request.submittedAt = request.createdAt;
    }

    await ddb.put({
      TableName: DDB_TABLES.requests,
      Item: JSON.parse(JSON.stringify(request))
    });

    if (request.status === 'SUBMITTED') {
      if (user.isGuest && user.guestInvitationId) {
        await this.markGuestInvitationUsed(user.guestInvitationId, request.requestId);
      }
      await this.sendRequestNotificationEmail(request, 'SUBMITTED', 'Initial submission');
    }

    return request;
  }

  /**
   * PATCH /requests/{id}
   * Updates an existing request (only if DRAFT or CHANGES_REQUESTED)
   */
  protected async patchResource(): Promise<any> {
    const user = this.getAuthenticatedUser();
    const requestId = this.getRequestId();
    if (!requestId) throw new HandledError('Missing requestId parameter');

    const decodedId = requestId;
    const raw = await ddb.get({
      TableName: DDB_TABLES.requests,
      Key: { requestId: decodedId }
    }).catch(() => null);

    if (!raw) throw new HandledError('Request not found');
    const existing = new FinancialRequest(raw);

    const isOwner = (existing.userId || '').toLowerCase() === (user.userId || '').toLowerCase();
    const canManage =
      user.isAdministrator ||
      user.isManager ||
      user.hasPermission(AppPermission.REQUESTS.PARENT) ||
      user.hasPermission(AppPermission.REQUESTS.MANAGE);

    // Permission check: either owner modifying an editable request, or a manager
    if (!isOwner && !canManage) {
      throw new HandledError('Access denied');
    }

    if (isOwner && !canManage && !existing.canEdit()) {
      throw new HandledError('This request cannot be modified in its current status');
    }

    const updates = this.body || {};
    const updatedStatus = updates.status || existing.status;

    if (user.isGuest) {
      if (user.guestAllowedRequestTypes?.length && updates.requestType && !user.guestAllowedRequestTypes.includes(updates.requestType)) {
        throw new HandledError('Request type not allowed for this guest invitation');
      }
      if (user.guestMaxAmount && updates.totalGrossAmount && Number(updates.totalGrossAmount) > user.guestMaxAmount) {
        throw new HandledError(`Total gross amount exceeds guest limit of ${user.guestMaxAmount} PLN`);
      }
    }

    let targetRequestId = existing.requestId;
    let targetYear = existing.year;
    let targetSeqNumber = existing.sequenceNumber;
    let isTransitioningFromDraftToSubmitted = false;

    if (existing.status === 'DRAFT' && updatedStatus === 'SUBMITTED') {
      isTransitioningFromDraftToSubmitted = true;
      targetYear = new Date().getFullYear();
      targetSeqNumber = await this.getNextSequenceNumber(targetYear);
      targetRequestId = `${targetSeqNumber}/${targetYear}`;
    }

    const defaultComment =
      isTransitioningFromDraftToSubmitted
        ? 'Initial submission'
        : updatedStatus === 'SUBMITTED'
        ? 'Resubmitted after corrections'
        : canManage && existing.status !== updatedStatus
        ? `Status changed to ${updatedStatus}`
        : 'Updated';

    const newHistoryEntry = {
      status: updatedStatus,
      timestamp: new Date().toISOString(),
      updatedBy: user.getDisplayName() || user.userId,
      comment: updates.historyNote || defaultComment
    };

    const updated = new FinancialRequest({
      ...existing,
      ...updates,
      requestId: targetRequestId,
      year: targetYear,
      sequenceNumber: targetSeqNumber,
      userId: existing.userId,
      status: updatedStatus,
      adminRemarks: typeof updates.adminRemarks !== 'undefined' ? updates.adminRemarks : existing.adminRemarks,
      statusHistory: [...(existing.statusHistory || []), newHistoryEntry],
      updatedAt: new Date().toISOString()
    });

    if (updatedStatus === 'SUBMITTED' && !updated.submittedAt) {
      updated.submittedAt = updated.updatedAt;
    }

    await ddb.put({
      TableName: DDB_TABLES.requests,
      Item: JSON.parse(JSON.stringify(updated))
    });

    // If migrating from draft to submitted, delete old unnumbered draft item
    if (isTransitioningFromDraftToSubmitted) {
      await ddb.delete({
        TableName: DDB_TABLES.requests,
        Key: { requestId: existing.requestId }
      }).catch(err => {
        this.logger.error('Failed to cleanup old draft item after submission', err);
      });

      if (user.isGuest && (user.guestInvitationId || existing.guestInvitationId)) {
        await this.markGuestInvitationUsed(user.guestInvitationId || existing.guestInvitationId!, updated.requestId);
      }
    }

    // Send email notification on status transition or reviewer comments
    if (existing.status !== updatedStatus || updates.historyNote) {
      await this.sendRequestNotificationEmail(
        updated,
        updatedStatus,
        updates.historyNote || newHistoryEntry.comment
      );
    }

    return updated;
  }

  /**
   * DELETE /requests/{id}
   * Only allowed for DRAFT requests
   */
  protected async deleteResource(): Promise<any> {
    const user = this.getAuthenticatedUser();
    const requestId = this.getRequestId();
    if (!requestId) throw new HandledError('Missing requestId parameter');

    const decodedId = requestId;
    const raw = await ddb.get({
      TableName: DDB_TABLES.requests,
      Key: { requestId: decodedId }
    }).catch(() => null);

    if (!raw) throw new HandledError('Request not found');
    const existing = new FinancialRequest(raw);

    const isOwner = (existing.userId || '').toLowerCase() === (user.userId || '').toLowerCase();
    if (!user.isAdministrator && !isOwner) {
      throw new HandledError('Access denied');
    }

    if (existing.status !== 'DRAFT') {
      throw new HandledError('Only draft requests can be deleted');
    }

    await ddb.delete({
      TableName: DDB_TABLES.requests,
      Key: { requestId: decodedId }
    });

    return { success: true, deletedId: decodedId };
  }

  private getAuthenticatedUser(): User {
    const userRaw = (this.event as any)?.requestContext?.authorizer?.lambda?.user || (this.event as any)?.user;
    if (!userRaw) {
      throw new HandledError('Unauthorized');
    }
    return new User(userRaw);
  }

  private async getNextSequenceNumber(year: number): Promise<number> {
    try {
      const items: any[] = await ddb.scan({
        TableName: DDB_TABLES.requests,
        FilterExpression: '#yr = :yr',
        ExpressionAttributeNames: { '#yr': 'year' },
        ExpressionAttributeValues: { ':yr': year },
        ProjectionExpression: 'sequenceNumber'
      });

      const maxSeq = items.reduce((max: number, item: any) => {
        const num = Number(item.sequenceNumber) || 0;
        return num > max ? num : max;
      }, 0);

      return maxSeq + 1;
    } catch {
      return 1;
    }
  }

  private async markGuestInvitationUsed(guestInvitationId: string, requestId: string): Promise<void> {
    if (!DDB_TABLES.configurations || !guestInvitationId) return;
    try {
      const data = await ddb.get({
        TableName: DDB_TABLES.configurations,
        Key: { PK: Configurations.PK }
      });
      if (!data) return;
      const configurations = new Configurations(data);
      const invite = (configurations.guestInvitations || []).find(inv => inv.id === guestInvitationId);
      if (invite) {
        if (!invite.isMultiUse) {
          invite.status = 'USED';
        }
        invite.submittedRequestId = requestId;
        invite.submittedAt = new Date().toISOString();
        await ddb.put({
          TableName: DDB_TABLES.configurations,
          Item: JSON.parse(JSON.stringify(configurations))
        });
      }
    } catch (err) {
      this.logger.error('Failed to update guest invitation status', err);
    }
  }

  private getTemplateForStatus(status: string, lang: 'pl' | 'en' = 'pl'): EmailTemplates | null {
    if (lang === 'en') {
      switch (status) {
        case 'SUBMITTED':
          return EmailTemplates.REQUEST_SUBMITTED_EN;
        case 'CHANGES_REQUESTED':
          return EmailTemplates.REQUEST_CHANGES_REQUESTED_EN;
        case 'APPROVED':
          return EmailTemplates.REQUEST_APPROVED_EN;
        case 'PAID':
          return EmailTemplates.REQUEST_PAID_EN;
        case 'REJECTED':
          return EmailTemplates.REQUEST_REJECTED_EN;
        default:
          return null;
      }
    } else {
      switch (status) {
        case 'SUBMITTED':
          return EmailTemplates.REQUEST_SUBMITTED_PL;
        case 'CHANGES_REQUESTED':
          return EmailTemplates.REQUEST_CHANGES_REQUESTED_PL;
        case 'APPROVED':
          return EmailTemplates.REQUEST_APPROVED_PL;
        case 'PAID':
          return EmailTemplates.REQUEST_PAID_PL;
        case 'REJECTED':
          return EmailTemplates.REQUEST_REJECTED_PL;
        default:
          return null;
      }
    }
  }

  private getSESTemplateName(emailTemplate: EmailTemplates): string {
    switch (emailTemplate) {
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

  private configurations: Configurations | null = null;

  private async getConfigurations(): Promise<Configurations> {
    if (this.configurations) return this.configurations;
    if (!DDB_TABLES.configurations) {
      this.configurations = new Configurations({ PK: Configurations.PK });
      return this.configurations;
    }
    try {
      const data = await ddb.get({
        TableName: DDB_TABLES.configurations,
        Key: { PK: Configurations.PK }
      });
      this.configurations = new Configurations(data || { PK: Configurations.PK });
    } catch (err) {
      this.configurations = new Configurations({ PK: Configurations.PK });
    }
    return this.configurations;
  }

  private async sendRequestNotificationEmail(
    request: FinancialRequest,
    targetStatus: string,
    comment?: string
  ): Promise<void> {
    if (!request.userEmail || targetStatus === 'DRAFT' || targetStatus === 'IN_REVIEW') return;

    try {
      if (await isEmailInBlockList(request.userEmail)) {
        this.logger.warn('Skipping email notification, recipient is in blocklist', { email: request.userEmail });
        return;
      }

      const configurations = await this.getConfigurations();
      const userLang = ((request as any).language || (request as any).preferredLanguage || '').toLowerCase();
      let lang: 'pl' | 'en' = userLang === 'en' || (request.country && request.country.toLowerCase() !== 'poland') ? 'en' : 'pl';
      if (configurations?.forcedLanguage && configurations.forcedLanguage !== 'ALL') {
        lang = configurations.forcedLanguage === 'pl' ? 'pl' : 'en';
      }
      const templateEnum = this.getTemplateForStatus(targetStatus, lang);
      if (!templateEnum) return;

      const templateName = this.getSESTemplateName(templateEnum);
      const totalAmount = `${Number(request.totalGrossAmount || 0).toFixed(2)} ${request.currency || 'PLN'}`;
      const requestUrl = `${BASE_URL}/t/requests/view/${encodeURIComponent(request.requestId)}`;

      const templateData = {
        user: request.userDisplayName || request.userId,
        requestId: request.requestId,
        title: request.requestType || 'Financial Request',
        detail: totalAmount,
        url: requestUrl,
        message: this.resolveCommentForEmail(comment, lang),
        status: targetStatus
      };

      const senderName = formatSenderName(configurations.getAppTitle(lang) || 'ESN Poland');
      const replyTo = configurations.supportEmail?.trim() ? [configurations.supportEmail.trim()] : undefined;

      try {
        await ses.sendTemplatedEmail({
          toAddresses: [request.userEmail],
          replyToAddresses: replyTo,
          template: `${templateName}-${STAGE}`,
          templateData
        }, {
          ...SES_CONFIG,
          sourceName: senderName
        });
      } catch (err: any) {
        if (err?.name === 'NotFoundException' || err?.message?.includes('does not exist')) {
          this.logger.warn(`Template ${templateName}-${STAGE} not found in SES, initializing from S3`, { templateName });
          const defaultSubjects: { [key: string]: string } = {
            'notify-guest-invitation-pl': 'Zaproszenie do złożenia wniosku finansowego',
            'notify-guest-invitation-en': 'Invitation to submit a financial request',
            'notify-request-submitted-pl': 'Nowy wniosek finansowy {{requestId}} został złożony',
            'notify-request-submitted-en': 'New financial request {{requestId}} submitted',
            'notify-request-changes-requested-pl': 'Wymagane poprawki we wniosku finansowym {{requestId}}',
            'notify-request-changes-requested-en': 'Changes requested for financial request {{requestId}}',
            'notify-request-approved-pl': 'Wniosek finansowy {{requestId}} został zatwierdzony',
            'notify-request-approved-en': 'Financial request {{requestId}} approved',
            'notify-request-paid-pl': 'Wypłata środków dla wniosku finansowego {{requestId}}',
            'notify-request-paid-en': 'Payment processed for financial request {{requestId}}',
            'notify-request-rejected-pl': 'Wniosek finansowy {{requestId}} został odrzucony',
            'notify-request-rejected-en': 'Financial request {{requestId}} rejected'
          };
          const subject = defaultSubjects[templateName] || templateName;
          const content = await s3.getObjectAsText({
            bucket: S3_BUCKET_MEDIA,
            key: `${S3_ASSETS_FOLDER}/${templateName}.hbs`
          });
          await ses.setTemplate(`${templateName}-${STAGE}`, subject, content, true);
          await ses.sendTemplatedEmail({
            toAddresses: [request.userEmail],
            replyToAddresses: replyTo,
            template: `${templateName}-${STAGE}`,
            templateData
          }, {
            ...SES_CONFIG,
            sourceName: senderName
          });
          this.logger.info(`Successfully initialized ${templateName}-${STAGE} from S3 and sent email`);
        } else {
          throw err;
        }
      }
    } catch (err) {
      // Non-blocking error handling: log error but don't fail the request operation
      this.logger.error('Failed to send request update email notification', err, {
        requestId: request.requestId,
        targetStatus,
        email: request.userEmail
      });
    }
  }

  private resolveCommentForEmail(comment?: string, lang: 'pl' | 'en' = 'pl'): string {
    if (!comment) return '';
    const keyMap: { [key: string]: { pl: string; en: string } } = {
      'REQUESTS.HISTORY_COMMENTS.IN_REVIEW': {
        pl: 'Weryfikacja rozpoczęta',
        en: 'Review started'
      },
      'REQUESTS.HISTORY_COMMENTS.REQUEST_APPROVED': {
        pl: 'Wniosek został zatwierdzony',
        en: 'Financial request approved'
      },
      'REQUESTS.HISTORY_COMMENTS.PAYOUT_COMPLETED': {
        pl: 'Wypłata została zrealizowana',
        en: 'Payment has been processed'
      },
      'REQUESTS.HISTORY_COMMENTS.INITIAL_SUBMISSION': {
        pl: 'Wniosek został złożony',
        en: 'Request submitted'
      },
      'REQUESTS.HISTORY_COMMENTS.SUBMITTED_BY_APPLICANT': {
        pl: 'Wniosek złożony przez wnioskodawcę',
        en: 'Submitted by applicant'
      }
    };
    if (keyMap[comment]) {
      return keyMap[comment][lang];
    }
    return comment;
  }
}
