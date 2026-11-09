import { DynamoDB, HandledError, ResourceController } from 'idea-aws';
import { DocumentRecord } from '../models/accounting-document.model';
import { AppPermission, Configurations } from '../models/configurations.model';
import { User } from '../models/user.model';

const DDB_TABLES = {
  documents: process.env.DDB_TABLE_accounting_documents || 'esn-poland-finances-dev-accounting_documents',
  configurations: process.env.DDB_TABLE_configurations
};

const ddb = new DynamoDB();

export const handler = (ev: any, _: any, cb: any): Promise<void> => new AccountingDocumentsRC(ev, cb).handleRequest();

class AccountingDocumentsRC extends ResourceController {
  user: User | null = null;
  configurations!: Configurations;

  constructor(event: any, callback: any) {
    super(event, callback, { resourceId: 'id' });
  }

  private getAuthenticatedUser(): User {
    const userRaw = (this.event as any)?.requestContext?.authorizer?.lambda?.user || (this.event as any)?.user;
    if (!userRaw) {
      this.returnStatusCode = 401;
      throw new HandledError('Unauthorized');
    }
    return new User(userRaw);
  }

  protected async checkAuthBeforeRequest(): Promise<void> {
    this.user = this.getAuthenticatedUser();

    if (DDB_TABLES.configurations) {
      const configsData = await ddb.get({
        TableName: DDB_TABLES.configurations,
        Key: { PK: Configurations.PK }
      }).catch(() => null);
      this.configurations = new Configurations(configsData || {});
      User.applyConfigurationPermissions(this.user, this.configurations);
    } else {
      this.configurations = new Configurations();
    }

    const httpMethod = (this.event as any)?.httpMethod || (this.event as any)?.requestContext?.httpMethod || 'GET';
    const isReadMethod = httpMethod === 'GET';

    const canView =
      this.user.isAdministrator ||
      this.user.isManager ||
      this.user.isAuditor ||
      this.user.hasPermission(AppPermission.FINANCES.PARENT) ||
      this.user.hasPermission(AppPermission.FINANCES.DOCUMENTS);

    if (!canView) {
      this.returnStatusCode = 403;
      throw new HandledError('Forbidden - insufficient finances permissions');
    }

    if (!isReadMethod) {
      const canEdit =
        this.user.isAdministrator ||
        this.user.isManager ||
        this.user.hasPermission(AppPermission.FINANCES.MANAGE) ||
        this.user.hasPermission(AppPermission.FINANCES.PARENT);

      if (!canEdit) {
        this.returnStatusCode = 403;
        throw new HandledError('Forbidden - write access required');
      }
    }
  }

  protected async getResources(forcedYear?: number): Promise<any> {
    const yearParam = forcedYear || (this.pathParameters as any)?.year || (this.queryParams as any)?.year || (this.pathParameters as any)?.id;
    const year = typeof yearParam === 'number' ? yearParam : parseInt(yearParam, 10);

    if (year && !isNaN(year)) {
      const items: any[] = await ddb.query({
        TableName: DDB_TABLES.documents,
        IndexName: 'byYear',
        KeyConditionExpression: '#yr = :year',
        ExpressionAttributeNames: { '#yr': 'year' },
        ExpressionAttributeValues: { ':year': year }
      }).catch(() => []);
      return (items || []).map((d: any) => new DocumentRecord(d));
    }

    const all = await ddb.scan({ TableName: DDB_TABLES.documents }).catch(() => []);
    return (all || []).map((d: any) => new DocumentRecord(d));
  }

  protected async getResource(): Promise<any> {
    const id = (this.pathParameters as any)?.id;
    if (!id) {
      return this.getResources();
    }

    const year = parseInt(id, 10);
    if (!isNaN(year) && year >= 2000 && year <= 2100 && /^\d{4}$/.test(id)) {
      return this.getResources(year);
    }

    const doc = await ddb.get({
      TableName: DDB_TABLES.documents,
      Key: { id }
    }).catch(() => null);

    if (!doc) {
      this.returnStatusCode = 404;
      throw new HandledError('Document not found');
    }
    return new DocumentRecord(doc);
  }

  protected async postResources(): Promise<any> {
    return this.putResource();
  }

  protected async putResources(): Promise<any> {
    return this.putResource();
  }

  protected async postResource(): Promise<any> {
    return this.putResource();
  }

  protected async putResource(): Promise<any> {
    const doc = new DocumentRecord(this.body);
    if (!doc.id) {
      doc.id = `doc_${Date.now()}`;
    }
    doc.updatedAt = new Date().toISOString();

    const errors = doc.validate();
    if (errors.length > 0) {
      this.returnStatusCode = 400;
      throw new HandledError(`Validation errors: ${errors.join('; ')}`);
    }

    await ddb.put({
      TableName: DDB_TABLES.documents,
      Item: doc
    });
    return doc;
  }

  protected async deleteResource(): Promise<any> {
    const id = (this.pathParameters as any)?.id;
    if (!id) {
      this.returnStatusCode = 400;
      throw new HandledError('Document ID required');
    }

    await ddb.delete({
      TableName: DDB_TABLES.documents,
      Key: { id }
    });
    return { success: true, deletedId: id };
  }
}
