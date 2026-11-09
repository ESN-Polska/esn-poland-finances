import { DynamoDB, HandledError, ResourceController } from 'idea-aws';
import { BankTransactionRecord } from '../models/cashflow-transaction.model';
import { AppPermission, Configurations } from '../models/configurations.model';
import { User } from '../models/user.model';

const DDB_TABLES = {
  transactions: process.env.DDB_TABLE_cashflow_transactions || 'esn-poland-finances-dev-cashflow_transactions',
  configurations: process.env.DDB_TABLE_configurations
};

const ddb = new DynamoDB();

export const handler = (ev: any, _: any, cb: any): Promise<void> => new CashflowTransactionsRC(ev, cb).handleRequest();

class CashflowTransactionsRC extends ResourceController {
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
      this.user.hasPermission(AppPermission.FINANCES.TRANSACTIONS);

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
        TableName: DDB_TABLES.transactions,
        IndexName: 'byYear',
        KeyConditionExpression: '#yr = :year',
        ExpressionAttributeNames: { '#yr': 'year' },
        ExpressionAttributeValues: { ':year': year }
      }).catch(() => []);
      return (items || []).map((t: any) => new BankTransactionRecord(t));
    }

    const all = await ddb.scan({ TableName: DDB_TABLES.transactions }).catch(() => []);
    return (all || []).map((t: any) => new BankTransactionRecord(t));
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

    const tx = await ddb.get({
      TableName: DDB_TABLES.transactions,
      Key: { id }
    }).catch(() => null);

    if (!tx) {
      this.returnStatusCode = 404;
      throw new HandledError('Transaction not found');
    }
    return new BankTransactionRecord(tx);
  }

  protected async postResources(): Promise<any> {
    return this.postResource();
  }

  protected async putResources(): Promise<any> {
    return this.putResource();
  }

  protected async putResource(): Promise<any> {
    const tx = new BankTransactionRecord(this.body);
    if (!tx.id) {
      tx.id = `tx_${Date.now()}`;
    }
    tx.updatedAt = new Date().toISOString();

    await ddb.put({
      TableName: DDB_TABLES.transactions,
      Item: tx
    });
    return tx;
  }

  protected async postResource(): Promise<any> {
    const rawPath = (this.event as any)?.rawPath || (this.event as any)?.path || '';
    const routeKey = (this.event as any)?.routeKey || '';
    const pathParamId = (this.pathParameters as any)?.id;
    const isImport = rawPath.includes('/import') || routeKey.includes('/import') || pathParamId === 'import' || !!this.body?.transactions;

    if (isImport) {
      const defaultYear = parseInt(this.body?.year, 10) || new Date().getFullYear();
      const rawList: any[] = Array.isArray(this.body?.transactions) ? this.body.transactions : [];

      let imported = 0;
      let duplicates = 0;
      const savedItems: BankTransactionRecord[] = [];

      for (const item of rawList) {
        const partyName = BankTransactionRecord.fixPolishMojibake(item.partyName || item.counterparty || '');
        const transferTitle = BankTransactionRecord.fixPolishMojibake(item.transferTitle || item.title || '');
        const bookingDate = item.bookingDate || '';
        const operationDate = item.operationDate || item.valueDate || bookingDate;
        const amount = Number(item.amount) || 0;
        const partyAccount = item.partyAccount || '';
        const accountIban = item.accountIban || '';
        const balanceAfter = Number(item.balanceAfter) || 0;
        const statementSequenceNumber = Number(item.statementSequenceNumber) || 0;
        const txYear = parseInt(bookingDate.split('-')[0], 10) || item.year || defaultYear;

        const hash = item.id || BankTransactionRecord.generateHash(
          accountIban,
          bookingDate,
          operationDate,
          amount,
          transferTitle,
          partyAccount || partyName,
          balanceAfter,
          statementSequenceNumber
        );

        const existing = await ddb.get({
          TableName: DDB_TABLES.transactions,
          Key: { id: hash }
        }).catch(() => null);

        if (existing) {
          duplicates++;
        } else {
          const newRecord = new BankTransactionRecord({
            ...item,
            id: hash,
            year: txYear,
            deduplicationHash: hash,
            accountIban,
            partyName,
            partyAccount,
            transferTitle,
            bookingDate,
            operationDate,
            amount,
            direction: amount >= 0 ? 'INFLOW' : 'OUTFLOW',
            currency: (item.currency === 'EUR' ? 'EUR' : 'PLN'),
            balanceAfter,
            statementSequenceNumber,
            reconciliationStatus: item.reconciliationStatus || 'UNLINKED',
            settlements: item.settlements || [],
            directBudgetCode: item.directBudgetCode || '',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });

          await ddb.put({
            TableName: DDB_TABLES.transactions,
            Item: newRecord
          });
          imported++;
          savedItems.push(newRecord);
        }
      }

      return {
        imported,
        duplicates,
        items: savedItems
      };
    }

    return this.putResource();
  }
}
