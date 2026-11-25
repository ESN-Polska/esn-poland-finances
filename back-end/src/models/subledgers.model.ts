import { Resource } from 'idea-toolbox';
import { Currency } from './financial-request.model';
import { DocumentAttachmentItem } from './accounting-document.model';

// ==========================================
// 1. MONTHLY RECONCILIATION (SUMMARY SUBTAB)
// ==========================================

export type ReconciliationStatus = 'MATCHED' | 'DISCREPANCY' | 'NO_DATA';

export interface MonthlyReconciliationRow {
  month: number; // 1..12
  monthName: {
    pl: string;
    en: string;
  };

  // PLN Account
  plnStartingBalance: number;
  plnInflows: number;
  plnOutflows: number;
  plnNetBalance: number;
  plnExpectedClosing: number;
  plnActualClosing?: number;
  plnStatus: ReconciliationStatus;
  plnStatementAttachment?: DocumentAttachmentItem;

  // EUR Account
  eurStartingBalance: number;
  eurInflows: number;
  eurOutflows: number;
  eurNetBalance: number;
  eurExpectedClosing: number;
  eurActualClosing?: number;
  eurStatus: ReconciliationStatus;
  eurStatementAttachment?: DocumentAttachmentItem;

  comment?: string;
}

export class MonthlyReconciliationRecord extends Resource {
  id: string;
  subledgerType: string = 'reconciliation';
  year: number;
  lastImportedBookingDate?: string; // "YYYY-MM-DD"
  months: MonthlyReconciliationRow[];
  notes?: string;
  updatedAt: string;
  updatedBy?: string;

  constructor(data?: any) {
    super();
    if (data) {
      this.load(data);
    }
  }

  load(x: any): void {
    super.load(x);
    this.id = this.clean(x.id, String, x.year ? `reconciliation_${x.year}` : '');
    this.subledgerType = this.clean(x.subledgerType, String, 'reconciliation');
    this.year = this.clean(x.year, Number, new Date().getFullYear());
    this.lastImportedBookingDate = this.clean(x.lastImportedBookingDate, String, '');

    const monthNames = [
      { pl: 'Styczeń', en: 'January' },
      { pl: 'Luty', en: 'February' },
      { pl: 'Marzec', en: 'March' },
      { pl: 'Kwiecień', en: 'April' },
      { pl: 'Maj', en: 'May' },
      { pl: 'Czerwiec', en: 'June' },
      { pl: 'Lipiec', en: 'July' },
      { pl: 'Sierpień', en: 'August' },
      { pl: 'Wrzesień', en: 'September' },
      { pl: 'Październik', en: 'October' },
      { pl: 'Listopad', en: 'November' },
      { pl: 'Grudzień', en: 'December' }
    ];

    this.months = Array.from({ length: 12 }, (_, i) => {
      const existing = (x.months || []).find((m: any) => m.month === i + 1) || {};
      const plnIn = this.clean(existing.plnInflows, Number, 0);
      const plnOut = this.clean(existing.plnOutflows, Number, 0);
      const plnStart = this.clean(existing.plnStartingBalance, Number, 0);
      const plnNet = existing.plnNetBalance !== undefined && existing.plnNetBalance !== null
        ? Number(existing.plnNetBalance)
        : Math.round((plnIn - plnOut) * 100) / 100;
      const plnExp = existing.plnExpectedClosing !== undefined && existing.plnExpectedClosing !== null
        ? Number(existing.plnExpectedClosing)
        : Math.round((plnStart + plnNet) * 100) / 100;

      const eurIn = this.clean(existing.eurInflows, Number, 0);
      const eurOut = this.clean(existing.eurOutflows, Number, 0);
      const eurStart = this.clean(existing.eurStartingBalance, Number, 0);
      const eurNet = existing.eurNetBalance !== undefined && existing.eurNetBalance !== null
        ? Number(existing.eurNetBalance)
        : Math.round((eurIn - eurOut) * 100) / 100;
      const eurExp = existing.eurExpectedClosing !== undefined && existing.eurExpectedClosing !== null
        ? Number(existing.eurExpectedClosing)
        : Math.round((eurStart + eurNet) * 100) / 100;

      return {
        month: i + 1,
        monthName: monthNames[i],
        plnStartingBalance: plnStart,
        plnInflows: plnIn,
        plnOutflows: plnOut,
        plnNetBalance: plnNet,
        plnExpectedClosing: plnExp,
        plnActualClosing: existing.plnActualClosing !== undefined && existing.plnActualClosing !== null ? Number(existing.plnActualClosing) : undefined,
        plnStatus: (existing.plnStatus || 'NO_DATA') as ReconciliationStatus,
        plnStatementAttachment: existing.plnStatementAttachment,

        eurStartingBalance: eurStart,
        eurInflows: eurIn,
        eurOutflows: eurOut,
        eurNetBalance: eurNet,
        eurExpectedClosing: eurExp,
        eurActualClosing: existing.eurActualClosing !== undefined && existing.eurActualClosing !== null ? Number(existing.eurActualClosing) : undefined,
        eurStatus: (existing.eurStatus || 'NO_DATA') as ReconciliationStatus,
        eurStatementAttachment: existing.eurStatementAttachment,

        comment: this.clean(existing.comment, String, '')
      };
    });

    this.notes = this.clean(x.notes, String, '');
    this.updatedAt = this.clean(x.updatedAt, String, new Date().toISOString());
    this.updatedBy = this.clean(x.updatedBy, String, '');
  }
}

// ==========================================
// 2. MEETINGS SUB-LEDGER
// ==========================================

export class MeetingRecord extends Resource {
  id: string;
  year: number;
  code: string; // "NA1", "kopik1", "CM1"
  name: string; // "National Assembly Warszawa"
  meetingType: 'STATUTORY' | 'FUNCTIONAL';
  budgetCode: string; // Linked budget code (e.g. "NA")
  budgetUrl?: string; // Link to Google Spreadsheets budget
  city?: string;
  startDate?: string;
  endDate?: string;
  totalRevenue: number;
  totalCost: number;
  federationGrant: number;
  actualResult: number;
  status: 'OPEN' | 'SETTLED' | 'PLANNED' | 'COMPLETED';
  notes?: string;

  get meetingCode(): string {
    return this.code;
  }
  set meetingCode(v: string) {
    this.code = v;
  }

  get meetingName(): string {
    return this.name;
  }
  set meetingName(v: string) {
    this.name = v;
  }

  get linkedBudgetLineCode(): string {
    return this.budgetCode;
  }
  set linkedBudgetLineCode(v: string) {
    this.budgetCode = v;
  }

  get totalRevenues(): number {
    return this.totalRevenue;
  }
  set totalRevenues(v: number) {
    this.totalRevenue = v;
  }

  get totalExpenses(): number {
    return this.totalCost;
  }
  set totalExpenses(v: number) {
    this.totalCost = v;
  }

  get netResult(): number {
    return this.actualResult;
  }
  set netResult(v: number) {
    this.actualResult = v;
  }

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
    this.code = this.clean(x.code || x.meetingCode, String, '').trim();
    this.name = this.clean(x.name || x.meetingName, String, '');
    this.meetingType = this.clean(x.meetingType, String, 'STATUTORY') as 'STATUTORY' | 'FUNCTIONAL';
    this.budgetCode = this.clean(x.budgetCode || x.linkedBudgetLineCode, String, '').trim();
    this.budgetUrl = this.clean(x.budgetUrl || x.sheetUrl, String, '');
    this.city = this.clean(x.city, String, '');
    this.startDate = this.clean(x.startDate, String, '');
    this.endDate = this.clean(x.endDate, String, '');
    this.totalRevenue = this.clean(x.totalRevenue !== undefined ? x.totalRevenue : x.totalRevenues, Number, 0);
    this.totalCost = this.clean(x.totalCost !== undefined ? x.totalCost : x.totalExpenses, Number, 0);
    this.federationGrant = this.clean(x.federationGrant, Number, 0);
    this.actualResult = Math.round((this.totalRevenue - this.totalCost + this.federationGrant) * 100) / 100;
    this.status = this.clean(x.status, String, 'OPEN') as 'OPEN' | 'SETTLED' | 'PLANNED' | 'COMPLETED';
    this.notes = this.clean(x.notes, String, '');
  }
}

// ==========================================
// 3. ADVANCE PAYMENTS REGISTRY
// ==========================================

export class AdvanceRecord extends Resource {
  id: string;
  year: number;
  advanceNumber: string; // e.g. "01/2026"
  recipientName: string;
  recipientAddress?: string;
  recipientUserId?: string;
  iban: string;
  swiftBic?: string;
  budgetCode: string; // Linked budget code
  payoutGrossAmount: number;
  usedGrossAmount: number;
  remainingBalance: number;
  isSettled: boolean;
  explanationAndBudget?: string;
  payoutDate: string;
  settledDate?: string;
  currency: string;
  settledDocumentIds?: string[];
  payoutTxId?: string; // Linked bank outflow transaction
  settlementTxId?: string; // Linked bank return/top-up transaction
  operationType?: 'RETURN' | 'TOP_UP' | 'ZERO';
  notes?: string;

  get purpose(): string {
    return this.explanationAndBudget || '';
  }
  set purpose(v: string) {
    this.explanationAndBudget = v;
  }

  get issuedDate(): string {
    return this.payoutDate;
  }
  set issuedDate(v: string) {
    this.payoutDate = v;
  }

  get amount(): number {
    return this.payoutGrossAmount;
  }
  set amount(v: number) {
    this.payoutGrossAmount = v;
  }

  get settledAmount(): number {
    return this.usedGrossAmount;
  }
  set settledAmount(v: number) {
    this.usedGrossAmount = v;
  }

  get status(): 'SETTLED' | 'PARTIALLY_SETTLED' | 'OPEN' {
    if (this.isSettled || this.remainingBalance <= 0) return 'SETTLED';
    if (this.usedGrossAmount > 0) return 'PARTIALLY_SETTLED';
    return 'OPEN';
  }

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
    this.advanceNumber = this.clean(x.advanceNumber, String, '');
    this.recipientName = this.clean(x.recipientName, String, '');
    this.recipientAddress = this.clean(x.recipientAddress, String, '');
    this.recipientUserId = this.clean(x.recipientUserId, String, '');
    this.iban = this.clean(x.iban, String, '').trim();
    this.swiftBic = this.clean(x.swiftBic, String, '');
    this.budgetCode = this.clean(x.budgetCode, String, '').trim();
    this.payoutGrossAmount = this.clean(x.payoutGrossAmount ?? x.amount, Number, 0);
    this.usedGrossAmount = this.clean(x.usedGrossAmount ?? x.settledAmount, Number, 0);
    this.remainingBalance = Math.round((this.payoutGrossAmount - this.usedGrossAmount) * 100) / 100;
    this.isSettled = this.remainingBalance <= 0 || Boolean(x.isSettled) || x.status === 'SETTLED';
    this.explanationAndBudget = this.clean(x.explanationAndBudget || x.purpose, String, '');
    this.payoutDate = this.clean(x.payoutDate || x.issuedDate, String, new Date().toISOString().substring(0, 10));
    this.settledDate = this.clean(x.settledDate, String, '');
    this.currency = this.clean(x.currency, String, 'PLN');
    this.settledDocumentIds = Array.isArray(x.settledDocumentIds) ? x.settledDocumentIds.map((id: any) => String(id)) : [];
    this.payoutTxId = this.clean(x.payoutTxId, String, '');
    this.settlementTxId = this.clean(x.settlementTxId, String, '');
    this.operationType = this.clean(x.operationType, String, this.remainingBalance > 0 ? 'RETURN' : this.remainingBalance < 0 ? 'TOP_UP' : 'ZERO') as any;
    this.notes = this.clean(x.notes, String, '');
  }
}

// ==========================================
// 4. DELEGATIONS SUB-LEDGER
// ==========================================

export class DelegationRecord extends Resource {
  id: string;
  year: number;
  sequenceNumber: string; // Manually entered e.g. "01/03/2026"
  recipientName: string;
  recipientAddress?: string;
  recipientUserId?: string;
  recipientSection?: string;
  destination?: string;
  purpose?: string;
  startDate?: string;
  endDate?: string;
  receivedDate?: string;
  settledDate?: string;
  iban: string;
  swiftBic?: string;
  requestedTotalAmount: number;

  // Split assigned by Treasurer / Form
  expensesBudgetCode?: string;
  diemsBudgetCode?: string;
  ticketsAmount: number;
  otherExpensesAmount: number;
  diemAmount: number;
  totalSettledAmount: number;
  isSplitAssigned: boolean;
  payoutTxId?: string; // Linked bank payout transaction

  get costsAmount(): number {
    return this.ticketsAmount + (this.otherExpensesAmount || 0);
  }
  set costsAmount(v: number) {
    this.ticketsAmount = v;
  }

  get attendeeName(): string {
    return this.recipientName;
  }
  set attendeeName(v: string) {
    this.recipientName = v;
  }

  get personName(): string {
    return this.recipientName;
  }
  set personName(v: string) {
    this.recipientName = v;
  }

  get delegationNumber(): string {
    return this.sequenceNumber;
  }
  set delegationNumber(v: string) {
    this.sequenceNumber = v;
  }

  get tripStartDate(): string | undefined {
    return this.startDate;
  }
  set tripStartDate(v: string | undefined) {
    this.startDate = v;
  }

  get totalAmount(): number {
    return this.requestedTotalAmount;
  }
  set totalAmount(v: number) {
    this.requestedTotalAmount = v;
  }

  get travelCost(): number {
    return this.ticketsAmount;
  }
  set travelCost(v: number) {
    this.ticketsAmount = v;
  }

  get travelBudgetCode(): string | undefined {
    return this.expensesBudgetCode;
  }
  set travelBudgetCode(v: string | undefined) {
    this.expensesBudgetCode = v;
  }

  get budgetCode(): string | undefined {
    return this.expensesBudgetCode;
  }
  set budgetCode(v: string | undefined) {
    this.expensesBudgetCode = v;
  }

  get diemBudgetCode(): string | undefined {
    return this.diemsBudgetCode;
  }
  set diemBudgetCode(v: string | undefined) {
    this.diemsBudgetCode = v;
  }

  delegationFormAttachment?: DocumentAttachmentItem;
  ticketAttachments?: DocumentAttachmentItem[];
  otherReceipts?: DocumentAttachmentItem[];
  notes?: string;

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
    this.sequenceNumber = this.clean(x.sequenceNumber, String, '');
    this.recipientName = this.clean(x.recipientName || x.attendeeName, String, '');
    this.recipientAddress = this.clean(x.recipientAddress, String, '');
    this.recipientUserId = this.clean(x.recipientUserId, String, '');
    this.recipientSection = this.clean(x.recipientSection, String, '');
    this.destination = this.clean(x.destination, String, '');
    this.purpose = this.clean(x.purpose, String, '');
    this.startDate = this.clean(x.startDate || x.receivedDate || x.date, String, '');
    this.endDate = this.clean(x.endDate, String, '');
    this.receivedDate = this.clean(x.receivedDate || this.startDate, String, '');
    this.settledDate = this.clean(x.settledDate, String, '');
    this.iban = this.clean(x.iban, String, '').trim();
    this.swiftBic = this.clean(x.swiftBic, String, '');

    this.expensesBudgetCode = this.clean(x.expensesBudgetCode || x.travelBudgetCode, String, '');
    this.diemsBudgetCode = this.clean(x.diemsBudgetCode || x.diemBudgetCode, String, '');

    const costsVal = x.costsAmount !== undefined ? x.costsAmount : (x.ticketsAmount ?? x.travelCost);
    this.ticketsAmount = this.clean(costsVal, Number, 0);
    this.otherExpensesAmount = this.clean(x.otherExpensesAmount, Number, 0);
    this.diemAmount = this.clean(x.diemAmount, Number, 0);
    this.totalSettledAmount = Math.round((this.ticketsAmount + this.otherExpensesAmount + this.diemAmount) * 100) / 100;
    this.requestedTotalAmount = this.clean(x.requestedTotalAmount ?? x.totalAmount, Number, this.totalSettledAmount);
    this.isSplitAssigned = Boolean(x.isSplitAssigned);
    this.payoutTxId = this.clean(x.payoutTxId, String, '');

    this.delegationFormAttachment = x.delegationFormAttachment;
    this.ticketAttachments = Array.isArray(x.ticketAttachments) ? x.ticketAttachments : [];
    this.otherReceipts = Array.isArray(x.otherReceipts) ? x.otherReceipts : [];
    this.notes = this.clean(x.notes, String, '');
  }
}

// ==========================================
// 5. SECTION SUB-ACCOUNTS (HELD IN TRUST)
// ==========================================

export class SectionSubAccount extends Resource {
  id: string;
  year: number;
  sectionCode: string; // e.g. "s3city", "sAGH"
  sectionName: string;
  startingBalance: number;
  inflows: number; // legacy alias
  outflows: number; // legacy alias
  currentBalance: number;

  // New detailed accounting columns 1:1 with spreadsheet
  txRevenues: number;
  txCosts: number;
  txBalance: number; // txRevenues - txCosts
  internalTransfersNet: number;
  delegationsTotal: number;
  saldo: number; // startingBalance + txBalance + internalTransfersNet - delegationsTotal
  isActive: boolean;
  deactivatedAtYear?: number;
  notes?: string;

  get openingBalance(): number {
    return this.startingBalance;
  }
  set openingBalance(v: number) {
    this.startingBalance = v;
  }

  get totalInflows(): number {
    return this.inflows;
  }
  set totalInflows(v: number) {
    this.inflows = v;
  }

  get totalOutflows(): number {
    return this.outflows;
  }
  set totalOutflows(v: number) {
    this.outflows = v;
  }

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
    this.sectionCode = this.clean(x.sectionCode, String, '').trim();
    this.sectionName = this.clean(x.sectionName, String, '');
    this.startingBalance = this.clean(x.startingBalance !== undefined ? x.startingBalance : x.openingBalance, Number, 0);

    this.txRevenues = this.clean(x.txRevenues !== undefined ? x.txRevenues : x.inflows, Number, 0);
    this.txCosts = this.clean(x.txCosts !== undefined ? x.txCosts : x.outflows, Number, 0);
    this.txBalance = Math.round((this.txRevenues - this.txCosts) * 100) / 100;
    this.internalTransfersNet = this.clean(x.internalTransfersNet, Number, 0);
    this.delegationsTotal = this.clean(x.delegationsTotal, Number, 0);
    this.saldo = Math.round((this.startingBalance + this.txBalance + this.internalTransfersNet - this.delegationsTotal) * 100) / 100;

    this.inflows = this.txRevenues;
    this.outflows = this.txCosts;
    this.currentBalance = this.saldo;

    this.isActive = x.isActive !== false;
    this.deactivatedAtYear = x.deactivatedAtYear ? Number(x.deactivatedAtYear) : undefined;
    this.notes = this.clean(x.notes, String, '');
  }
}

// ==========================================
// 6. INTERNAL TRANSFERS
// ==========================================

export class InternalTransfer extends Resource {
  id: string;
  year: number;
  date: string;
  fromBudgetCode: string;
  toBudgetCode: string;
  fromCodeType?: 'BUDGET_LINE' | 'SUB_BUDGET' | 'SECTION';
  toCodeType?: 'BUDGET_LINE' | 'SUB_BUDGET' | 'SECTION';
  amount: number;
  justification: string;
  approvedBy: string;

  get title(): string {
    return this.justification;
  }
  set title(v: string) {
    this.justification = v;
  }

  get fromCode(): string {
    return this.fromBudgetCode;
  }
  set fromCode(v: string) {
    this.fromBudgetCode = v;
  }

  get toCode(): string {
    return this.toBudgetCode;
  }
  set toCode(v: string) {
    this.toBudgetCode = v;
  }

  get transferDate(): string {
    return this.date;
  }
  set transferDate(v: string) {
    this.date = v;
  }

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
    this.date = this.clean(x.date, String, new Date().toISOString().substring(0, 10));
    this.fromBudgetCode = this.clean(x.fromBudgetCode, String, '');
    this.toBudgetCode = this.clean(x.toBudgetCode, String, '');
    this.fromCodeType = this.clean(x.fromCodeType, String, 'BUDGET_LINE') as any;
    this.toCodeType = this.clean(x.toCodeType, String, 'BUDGET_LINE') as any;
    this.amount = this.clean(x.amount, Number, 0);
    this.justification = this.clean(x.justification || x.title, String, '');
    this.approvedBy = this.clean(x.approvedBy, String, '');
  }
}

// ==========================================
// 7. TERM DEPOSITS
// ==========================================

export interface TermDepositCapitalization {
  date: string;
  ratePct?: number;
  amount: number;
  isSettled?: boolean;
}

export class TermDeposit extends Resource {
  id: string;
  year: number;
  bankName: string;
  depositNumber: string;
  principalAmount: number;
  currency: Currency;
  interestRate: number; // e.g. 5.25 (%)
  startDate: string;
  maturityDate: string;
  capitalizedInterest: number;
  capitalizations: TermDepositCapitalization[];
  interestBudgetLineCode?: string;
  status: 'ACTIVE' | 'CLOSED' | 'MATURED' | 'BROKEN';
  notes?: string;

  get name(): string {
    return this.bankName;
  }
  set name(v: string) {
    this.bankName = v;
  }

  get accruedInterest(): number {
    return this.capitalizedInterest;
  }
  set accruedInterest(v: number) {
    this.capitalizedInterest = v;
  }

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
    this.bankName = this.clean(x.bankName || x.name, String, 'Erste Bank Polska');
    this.depositNumber = this.clean(x.depositNumber, String, '');
    this.principalAmount = this.clean(x.principalAmount, Number, 0);
    this.currency = (this.clean(x.currency, String, 'PLN') === 'EUR' ? 'EUR' : 'PLN') as Currency;
    this.interestRate = this.clean(x.interestRate, Number, 0);
    this.startDate = this.clean(x.startDate, String, '');
    this.maturityDate = this.clean(x.maturityDate, String, '');

    this.capitalizations = Array.isArray(x.capitalizations)
      ? x.capitalizations.map((cap: any) => ({
          date: this.clean(cap.date, String, ''),
          ratePct: this.clean(cap.ratePct, Number, 0),
          amount: this.clean(cap.amount, Number, 0),
          isSettled: cap.isSettled !== false
        }))
      : [];

    const sumCaps = this.capitalizations.reduce((acc, c) => acc + (Number(c.amount) || 0), 0);
    this.capitalizedInterest = this.clean(x.capitalizedInterest ?? x.accruedInterest, Number, sumCaps);
    this.interestBudgetLineCode = this.clean(x.interestBudgetLineCode, String, '');
    this.status = this.clean(x.status, String, 'ACTIVE') as 'ACTIVE' | 'CLOSED' | 'MATURED' | 'BROKEN';
    this.notes = this.clean(x.notes, String, '');
  }
}
