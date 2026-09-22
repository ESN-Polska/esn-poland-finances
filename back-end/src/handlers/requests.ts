import { DynamoDB, HandledError, ResourceController, SES } from 'idea-aws';
import { randomUUID } from 'crypto';
import { FinancialRequest } from '../models/financial-request.model';
import { Configurations, EmailTemplates, formatSenderName } from '../models/configurations.model';
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

const ddb = new DynamoDB();
const ses = new SES();

export const handler = (ev: any, _: any, cb: any): Promise<void> => new RequestsHandler(ev, cb).handleRequest();

class RequestsHandler extends ResourceController {
  constructor(event: any, callback: any) {
    super(event, callback);
  }

  /**
   * GET /requests or GET /requests/{id}
   */
  protected async getResources(): Promise<any> {
    const user = this.getAuthenticatedUser();
    const requestId = this.pathParameters?.id;

    if (requestId) {
      const decodedId = decodeURIComponent(requestId);
      const raw = await ddb.get({
        TableName: DDB_TABLES.requests,
        Key: { requestId: decodedId }
      }).catch(() => null);

      if (!raw) {
        throw new HandledError('Request not found');
      }

      const request = new FinancialRequest(raw);
      if (!user.isAdministrator && request.userId !== user.userId.toLowerCase()) {
        throw new HandledError('Access denied');
      }

      return request;
    }

    // List user's requests (or all if admin requested)
    if (this.queryParams?.all === 'true' && user.isAdministrator) {
      const items: any[] = await ddb.scan({
        TableName: DDB_TABLES.requests
      });
      return items.map((x: any) => new FinancialRequest(x));
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
      return items.map((x: any) => new FinancialRequest(x));
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
      return items.map((x: any) => new FinancialRequest(x));
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
      section: user.section || user.sectionCode || (user.country ? 'ESN ' + user.country : ''),
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
    const requestId = this.pathParameters?.id;
    if (!requestId) throw new HandledError('Missing requestId parameter');

    const decodedId = decodeURIComponent(requestId);
    const raw = await ddb.get({
      TableName: DDB_TABLES.requests,
      Key: { requestId: decodedId }
    }).catch(() => null);

    if (!raw) throw new HandledError('Request not found');
    const existing = new FinancialRequest(raw);

    // Permission check
    if (!user.isAdministrator && existing.userId !== user.userId.toLowerCase()) {
      throw new HandledError('Access denied');
    }

    if (!user.isAdministrator && !existing.canEdit()) {
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

    const newHistoryEntry = {
      status: updatedStatus,
      timestamp: new Date().toISOString(),
      updatedBy: user.getDisplayName() || user.userId,
      comment:
        updates.historyNote ||
        (updatedStatus === 'SUBMITTED'
          ? isTransitioningFromDraftToSubmitted
            ? 'Initial submission'
            : 'Resubmitted after corrections'
          : 'Updated')
    };

    const updated = new FinancialRequest({
      ...existing,
      ...updates,
      requestId: targetRequestId,
      year: targetYear,
      sequenceNumber: targetSeqNumber,
      userId: existing.userId,
      status: updatedStatus,
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
    const requestId = this.pathParameters?.id;
    if (!requestId) throw new HandledError('Missing requestId parameter');

    const decodedId = decodeURIComponent(requestId);
    const raw = await ddb.get({
      TableName: DDB_TABLES.requests,
      Key: { requestId: decodedId }
    }).catch(() => null);

    if (!raw) throw new HandledError('Request not found');
    const existing = new FinancialRequest(raw);

    if (!user.isAdministrator && existing.userId !== user.userId.toLowerCase()) {
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

  private getTemplateForStatus(status: string, lang: 'pl' | 'en' = 'pl'): EmailTemplates {
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
          return EmailTemplates.REQUEST_STATUS_UPDATED_EN;
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
          return EmailTemplates.REQUEST_STATUS_UPDATED_PL;
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
      case EmailTemplates.REQUEST_STATUS_UPDATED_PL:
        return 'notify-request-status-updated-pl';
      case EmailTemplates.REQUEST_STATUS_UPDATED_EN:
        return 'notify-request-status-updated-en';
      default:
        return 'notify-request-status-updated-pl';
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
    if (!request.userEmail || targetStatus === 'DRAFT') return;

    try {
      if (await isEmailInBlockList(request.userEmail)) {
        this.logger.warn('Skipping email notification, recipient is in blocklist', { email: request.userEmail });
        return;
      }

      const userLang = ((request as any).language || (request as any).preferredLanguage || '').toLowerCase();
      const lang: 'pl' | 'en' = userLang === 'en' || (request.country && request.country.toLowerCase() !== 'poland') ? 'en' : 'pl';
      const templateEnum = this.getTemplateForStatus(targetStatus, lang);
      const templateName = this.getSESTemplateName(templateEnum);
      const totalAmount = `${Number(request.totalGrossAmount || 0).toFixed(2)} ${request.currency || 'PLN'}`;
      const requestUrl = `${BASE_URL}/t/requests/view/${encodeURIComponent(request.requestId)}`;

      const templateData = {
        user: request.userDisplayName || request.userId,
        requestId: request.requestId,
        title: request.requestType || 'Financial Request',
        detail: totalAmount,
        url: requestUrl,
        message: comment || '',
        status: targetStatus
      };

      const configurations = await this.getConfigurations();
      const senderName = formatSenderName(configurations.getAppTitle(lang) || 'ESN Poland');

      await ses.sendTemplatedEmail({
        toAddresses: [request.userEmail],
        template: `${templateName}-${STAGE}`,
        templateData
      }, {
        ...SES_CONFIG,
        sourceName: senderName
      });
    } catch (err) {
      // Non-blocking error handling: log error but don't fail the request operation
      this.logger.error('Failed to send request update email notification', err, {
        requestId: request.requestId,
        targetStatus,
        email: request.userEmail
      });
    }
  }
}
