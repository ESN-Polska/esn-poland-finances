import { DynamoDB, HandledError, ResourceController } from 'idea-aws';
import { FinancialRequest } from '../models/financial-request.model';
import { User } from '../models/user.model';

const DDB_TABLES = {
  requests: process.env.DDB_TABLE_financial_requests || 'esn-poland-finances-dev-financial_requests',
  configurations: process.env.DDB_TABLE_configurations
};

const ddb = new DynamoDB();

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

    const year = new Date().getFullYear();
    const sequenceNumber = await this.getNextSequenceNumber(year);
    const requestId = `${sequenceNumber}/${year}`;

    const request = new FinancialRequest({
      ...body,
      requestId,
      year,
      sequenceNumber,
      userId: user.userId.toLowerCase(),
      userDisplayName: user.getDisplayName(),
      userEmail: user.email,
      section: user.section || user.sectionCode,
      country: user.country || 'Poland',
      extendedRoles: user.extendedRoles || [],
      status: body.status || 'DRAFT',
      statusHistory: [
        {
          status: body.status || 'DRAFT',
          timestamp: new Date().toISOString(),
          updatedBy: user.getDisplayName() || user.userId,
          comment: body.status === 'SUBMITTED' ? 'Initial submission' : 'Draft created'
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

    const newHistoryEntry = {
      status: updatedStatus,
      timestamp: new Date().toISOString(),
      updatedBy: user.getDisplayName() || user.userId,
      comment: updates.historyNote || (updatedStatus === 'SUBMITTED' ? 'Resubmitted after corrections' : 'Updated')
    };

    const updated = new FinancialRequest({
      ...existing,
      ...updates,
      requestId: existing.requestId, // ID cannot change
      year: existing.year,
      sequenceNumber: existing.sequenceNumber,
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
}
