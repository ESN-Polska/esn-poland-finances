import { Resource } from 'idea-toolbox';
import { Currency } from './financial-request.model';

export type BankTransactionDirection = 'INFLOW' | 'OUTFLOW';
export type TransactionReconciliationStatus = 'UNLINKED' | 'MATCHED' | 'DISCREPANCY' | 'DIRECT_CODED';
export type TransactionSettlementTargetType = 'DOCUMENT' | 'FISCAL_DAILY_REPORT' | 'ADVANCE' | 'DIRECT_BUDGET_LINE';

export interface TransactionSettlement {
  settlementId: string;
  targetType: TransactionSettlementTargetType;
  /** Target entity ID (documentId, dailyReportId, advanceId, or budgetCode) */
  targetId: string;
  /** Identifier label (invoice number, report code, or budget line code) */
  targetLabel: string;
  /** Amount allocated from this transaction to the target entity */
  allocatedAmount: number;
  notes?: string;
}

export class BankTransactionRecord extends Resource {
  id: string; // Deterministic hash
  year: number;
  accountIban: string;
  currency: Currency;

  bookingDate: string; // ISO YYYY-MM-DD
  operationDate: string; // ISO YYYY-MM-DD
  transferTitle: string;
  partyName: string;
  partyAccount: string;

  /** Signed amount: positive = Inflow, negative = Outflow */
  amount: number;
  direction: BankTransactionDirection;
  balanceAfter: number;
  statementSequenceNumber: number;

  reconciliationStatus: TransactionReconciliationStatus;
  settlements: TransactionSettlement[];

  /** Direct budget line code for uninvoiced movements (e.g. 'admin-bank', 'przychody-finansowe') */
  directBudgetCode?: string;

  /** Batch reference of the CSV file import */
  importBatchId: string;
  createdAt: string;
  updatedAt: string;

  constructor(data?: any) {
    super();
    if (data) {
      this.load(data);
    }
  }

  load(x: any): void {
    super.load(x);
    this.id = this.clean(x.id, String);
    this.year = this.clean(x.year, Number, new Date().getFullYear());
    this.accountIban = this.clean(x.accountIban, String, '').trim();
    this.currency = (this.clean(x.currency, String, 'PLN') === 'EUR' ? 'EUR' : 'PLN') as Currency;

    this.bookingDate = this.clean(x.bookingDate, String, '');
    this.operationDate = this.clean(x.operationDate, String, this.bookingDate);
    this.transferTitle = BankTransactionRecord.fixPolishMojibake(this.clean(x.transferTitle, String, ''));
    this.partyName = BankTransactionRecord.fixPolishMojibake(this.clean(x.partyName, String, ''));
    this.partyAccount = this.clean(x.partyAccount, String, '');

    this.amount = this.clean(x.amount, Number, 0);
    this.direction = this.amount >= 0 ? 'INFLOW' : 'OUTFLOW';
    this.balanceAfter = this.clean(x.balanceAfter, Number, 0);
    this.statementSequenceNumber = this.clean(x.statementSequenceNumber, Number, 0);

    this.settlements = Array.isArray(x.settlements)
      ? x.settlements.map((st: any, idx: number) => ({
          settlementId: this.clean(st.settlementId, String, `st_${idx + 1}`),
          targetType: this.clean(st.targetType, String, 'DOCUMENT') as TransactionSettlementTargetType,
          targetId: this.clean(st.targetId, String),
          targetLabel: this.clean(st.targetLabel, String, ''),
          allocatedAmount: this.clean(st.allocatedAmount, Number, 0),
          notes: this.clean(st.notes, String, '')
        }))
      : [];

    this.directBudgetCode = this.clean(x.directBudgetCode, String, '');

    if (this.directBudgetCode) {
      this.reconciliationStatus = 'DIRECT_CODED';
    } else if (this.settlements && this.settlements.length > 0) {
      const totalAllocated = this.settlements.reduce((acc, s) => acc + (Number(s.allocatedAmount) || 0), 0);
      const absAmount = Math.abs(this.amount);
      this.reconciliationStatus = Math.abs(totalAllocated - absAmount) < 0.05 ? 'MATCHED' : 'DISCREPANCY';
    } else {
      this.reconciliationStatus = this.clean(x.reconciliationStatus, String, 'UNLINKED') as TransactionReconciliationStatus;
    }

    this.importBatchId = this.clean(x.importBatchId, String, '');
    this.createdAt = this.clean(x.createdAt, String, new Date().toISOString());
    this.updatedAt = this.clean(x.updatedAt, String, new Date().toISOString());
  }

  notes?: string;
  isBankFeeOrInterest?: boolean;

  get counterparty(): string {
    return this.partyName;
  }
  set counterparty(v: string) {
    this.partyName = BankTransactionRecord.fixPolishMojibake(v);
  }

  get title(): string {
    return this.transferTitle;
  }
  set title(v: string) {
    this.transferTitle = BankTransactionRecord.fixPolishMojibake(v);
  }

  get valueDate(): string {
    return this.operationDate;
  }
  set valueDate(v: string) {
    this.operationDate = v;
  }

  get directBudgetLineCode(): string | undefined {
    return this.directBudgetCode;
  }
  set directBudgetLineCode(v: string | undefined) {
    this.directBudgetCode = v;
  }

  get flowType(): BankTransactionDirection {
    return this.direction;
  }
  set flowType(v: BankTransactionDirection) {
    this.direction = v;
  }

  get settlementStatus(): string {
    return this.reconciliationStatus === 'MATCHED' || this.reconciliationStatus === 'DIRECT_CODED'
      ? 'SETTLED'
      : 'UNSETTLED';
  }
  set settlementStatus(v: string) {
    this.reconciliationStatus = v === 'SETTLED' ? 'MATCHED' : 'UNLINKED';
  }

  /**
   * Cleans mojibake characters caused by decoding UTF-8 as Windows-1250 / Latin-1
   */
  static fixPolishMojibake(str: string): string {
    if (!str) return str;
    const replacements: [string, string][] = [
      // Windows-1250 misinterpretations of UTF-8
      ['Ä\u2026', 'ą'], ['Ä…', 'ą'],
      ['Ä\u201e', 'Ą'], ['Ä„', 'Ą'],
      ['Ä\u2021', 'ć'], ['Ä‡', 'ć'],
      ['Ä\u2020', 'Ć'], ['Ä†', 'Ć'],
      ['Ä\u2122', 'ę'], ['Ä™', 'ę'],
      ['Ä\u0098', 'Ę'], ['Ä˜', 'Ę'],
      ['\u0139\u201a', 'ł'], ['Ĺ‚', 'ł'],
      ['\u0139\u0081', 'Ł'], ['\u0139\u00A0', 'Ł'], ['Ĺ\u0081', 'Ł'], ['Ĺ ', 'Ł'], ['Ĺ\u0141', 'Ł'],
      ['\u0139\u201e', 'ń'], ['Ĺ„', 'ń'],
      ['\u0139\u0083', 'Ń'], ['Ĺƒ', 'Ń'],
      ['\u0102\u0142', 'ó'], ['Ăł', 'ó'],
      ['\u0102\u201c', 'Ó'], ['Ă“', 'Ó'],
      ['\u0139\u203a', 'ś'], ['Ĺ›', 'ś'],
      ['\u0139\u0161', 'Ś'], ['Ĺš', 'Ś'],
      ['\u0139\u015f', 'ź'], ['Ĺş', 'ź'],
      ['\u0139\u0105', 'Ź'], ['Ĺą', 'Ź'],
      ['\u0139\u013d', 'ż'], ['ĹĽ', 'ż'],
      ['\u0139\u00bb', 'Ż'], ['Ĺ»', 'Ż'],

      // ISO-8859-1 (Latin-1) misinterpretations of UTF-8
      ['Å‚', 'ł'], ['Å\u0081', 'Ł'], ['Å ', 'Ł'],
      ['Å„', 'ń'], ['Åƒ', 'Ń'],
      ['Ã³', 'ó'], ['Ã“', 'Ó'],
      ['Å›', 'ś'], ['Åš', 'Ś'],
      ['Åº', 'ź'], ['Å¹', 'Ź'],
      ['Å¼', 'ż'], ['Å»', 'Ż']
    ];

    let res = str;
    for (const [bad, good] of replacements) {
      res = res.split(bad).join(good);
    }
    return res;
  }

  /**
   * Generates a deterministic deduplication hash for bank transaction imports
   */
  static generateDeduplicationHash(
    bookingDate: string,
    amount: number,
    counterparty: string = '',
    title: string = ''
  ): string {
    return BankTransactionRecord.generateHash('', bookingDate, bookingDate, amount, title, counterparty);
  }

  static generateHash(
    accountIban: string,
    bookingDate: string,
    operationDate: string,
    amount: number,
    title: string,
    partyAccount: string,
    balanceAfter?: number,
    statementSequenceNumber?: number
  ): string {
    const cleanTitle = BankTransactionRecord.fixPolishMojibake(title).trim().toLowerCase();
    const cleanParty = BankTransactionRecord.fixPolishMojibake(partyAccount).trim();
    const seqStr = statementSequenceNumber !== undefined && statementSequenceNumber !== null ? `_${statementSequenceNumber}` : '';
    const balStr = balanceAfter !== undefined && balanceAfter !== null ? `_${balanceAfter.toFixed(2)}` : '';
    const raw = `${accountIban.trim()}_${bookingDate}_${operationDate}_${amount.toFixed(2)}_${cleanTitle}_${cleanParty}${balStr}${seqStr}`;
    // Simple deterministic hash
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      const char = raw.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return `tx_${Math.abs(hash).toString(36)}_${bookingDate.replace(/-/g, '')}_${Math.abs(Math.round(amount * 100))}${seqStr}`;
  }
}
