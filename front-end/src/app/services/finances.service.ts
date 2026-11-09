import { Injectable, inject } from '@angular/core';
import { IDEAApiService } from '@idea-ionic/common';
import { AnnualBudget, BudgetAmendment } from '@models/annual-budget.model';
import { DocumentRecord } from '@models/accounting-document.model';
import { BankTransactionRecord } from '@models/cashflow-transaction.model';
import { FiscalMonthlyReport } from '@models/fiscal-report.model';
import {
  MonthlyReconciliationRecord,
  MeetingRecord,
  AdvanceRecord,
  DelegationRecord,
  SectionSubAccount,
  InternalTransfer,
  TermDeposit
} from '@models/subledgers.model';

export interface BudgetExportOptions {
  format: 'EXCEL' | 'PDF';
  type: 'BUDGET' | 'EXECUTION' | 'DOC_B';
  asOfDate?: string;
  language?: 'pl' | 'en' | 'both';
}

@Injectable({ providedIn: 'root' })
export class FinancesService {
  private api = inject(IDEAApiService);

  // ==========================================
  // 1. BUDGET ENDPOINTS
  // ==========================================

  public async getBudget(year: number): Promise<AnnualBudget> {
    const raw = await this.api.getResource(['budgets', year.toString()]);
    return new AnnualBudget(raw);
  }

  public async saveBudget(budget: AnnualBudget): Promise<AnnualBudget> {
    const raw = await this.api.putResource('budgets', { body: budget });
    return new AnnualBudget(raw);
  }

  public async addAmendment(year: number, amendment: BudgetAmendment): Promise<AnnualBudget> {
    const raw = await this.api.postResource(['budgets', year.toString(), 'amendments'], { body: amendment });
    return new AnnualBudget(raw);
  }

  public async exportBudget(year: number, options: BudgetExportOptions): Promise<any> {
    return await this.api.postResource(['budgets', year.toString(), 'export'], { body: options });
  }

  // ==========================================
  // 2. ACCOUNTING DOCUMENTS ENDPOINTS
  // ==========================================

  public async getDocuments(year: number): Promise<DocumentRecord[]> {
    const rawList: any[] = await this.api.getResource(['accounting-documents', year.toString()]);
    if (!Array.isArray(rawList)) return [];
    return rawList.map((item) => new DocumentRecord(item));
  }

  public async saveDocument(doc: DocumentRecord): Promise<DocumentRecord> {
    const raw = await this.api.putResource('accounting-documents', { body: doc });
    return new DocumentRecord(raw);
  }

  public async deleteDocument(id: string): Promise<void> {
    await this.api.deleteResource(['accounting-documents', id]);
  }

  // ==========================================
  // 3. CASHFLOW TRANSACTIONS ENDPOINTS
  // ==========================================

  public async getTransactions(year: number): Promise<BankTransactionRecord[]> {
    const rawList: any[] = await this.api.getResource(['cashflow-transactions', year.toString()]);
    if (!Array.isArray(rawList)) return [];
    return rawList.map((item) => new BankTransactionRecord(item));
  }

  public async saveTransaction(tx: BankTransactionRecord): Promise<BankTransactionRecord> {
    const raw = await this.api.putResource('cashflow-transactions', { body: tx });
    return new BankTransactionRecord(raw);
  }

  public async importTransactions(
    year: number,
    transactions: Partial<BankTransactionRecord>[]
  ): Promise<{ imported: number; duplicates: number; items: BankTransactionRecord[] }> {
    const res = await this.api.postResource(['cashflow-transactions', 'import'], {
      body: { year, transactions }
    });
    return {
      imported: res.imported || 0,
      duplicates: res.duplicates || 0,
      items: Array.isArray(res.items) ? res.items.map((x: any) => new BankTransactionRecord(x)) : []
    };
  }

  // ==========================================
  // 4. FISCAL REPORTS ENDPOINTS
  // ==========================================

  public async getFiscalReports(year: number): Promise<FiscalMonthlyReport[]> {
    const rawList: any[] = await this.api.getResource(['fiscal-reports', year.toString()]);
    if (!Array.isArray(rawList)) return [];
    return rawList.map((item) => new FiscalMonthlyReport(item));
  }

  public async saveFiscalReport(report: FiscalMonthlyReport): Promise<FiscalMonthlyReport> {
    const raw = await this.api.putResource('fiscal-reports', { body: report });
    return new FiscalMonthlyReport(raw);
  }

  // ==========================================
  // 5. SUBLEDGER ENDPOINTS (Meetings, Advances, Delegations, Sections, Reconciliation, Transfers, Deposits)
  // ==========================================

  public async getReconciliations(year: number): Promise<MonthlyReconciliationRecord[]> {
    const raw = await this.api.getResource(['financial-subledgers', 'reconciliation'], { params: { year } });
    const list = Array.isArray(raw) ? raw.map((x) => new MonthlyReconciliationRecord(x)) : [];
    list.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    return list;
  }

  public async saveReconciliation(rec: MonthlyReconciliationRecord): Promise<MonthlyReconciliationRecord> {
    const body = {
      ...rec,
      subledgerType: 'reconciliation',
      id: rec.id || (rec.year ? `reconciliation_${rec.year}` : undefined)
    };
    const raw = await this.api.putResource('financial-subledgers', { body });
    return new MonthlyReconciliationRecord(raw);
  }

  public async getMeetings(year: number): Promise<MeetingRecord[]> {
    const raw = await this.api.getResource(['financial-subledgers', 'meetings'], { params: { year } });
    return Array.isArray(raw) ? raw.map((x) => new MeetingRecord(x)) : [];
  }

  public async saveMeeting(m: MeetingRecord): Promise<MeetingRecord> {
    const raw = await this.api.putResource('financial-subledgers', { body: { subledgerType: 'meetings', ...m } });
    return new MeetingRecord(raw);
  }

  public async getAdvances(year: number): Promise<AdvanceRecord[]> {
    const raw = await this.api.getResource(['financial-subledgers', 'advances'], { params: { year } });
    return Array.isArray(raw) ? raw.map((x) => new AdvanceRecord(x)) : [];
  }

  public async saveAdvance(adv: AdvanceRecord): Promise<AdvanceRecord> {
    const raw = await this.api.putResource('financial-subledgers', { body: { subledgerType: 'advances', ...adv } });
    return new AdvanceRecord(raw);
  }

  public async getDelegations(year: number): Promise<DelegationRecord[]> {
    const raw = await this.api.getResource(['financial-subledgers', 'delegations'], { params: { year } });
    return Array.isArray(raw) ? raw.map((x) => new DelegationRecord(x)) : [];
  }

  public async saveDelegation(del: DelegationRecord): Promise<DelegationRecord> {
    const raw = await this.api.putResource('financial-subledgers', { body: { subledgerType: 'delegations', ...del } });
    return new DelegationRecord(raw);
  }

  public async getSections(year: number): Promise<SectionSubAccount[]> {
    const raw = await this.api.getResource(['financial-subledgers', 'sections'], { params: { year } });
    return Array.isArray(raw) ? raw.map((x) => new SectionSubAccount(x)) : [];
  }

  public async saveSection(sec: SectionSubAccount): Promise<SectionSubAccount> {
    const raw = await this.api.putResource('financial-subledgers', { body: { subledgerType: 'sections', ...sec } });
    return new SectionSubAccount(raw);
  }

  public async getTransfers(year: number): Promise<InternalTransfer[]> {
    const raw = await this.api.getResource(['financial-subledgers', 'transfers'], { params: { year } });
    return Array.isArray(raw) ? raw.map((x) => new InternalTransfer(x)) : [];
  }

  public async saveTransfer(t: InternalTransfer): Promise<InternalTransfer> {
    const raw = await this.api.putResource('financial-subledgers', { body: { subledgerType: 'transfers', ...t } });
    return new InternalTransfer(raw);
  }

  public async getDeposits(year: number): Promise<TermDeposit[]> {
    const raw = await this.api.getResource(['financial-subledgers', 'deposits'], { params: { year } });
    return Array.isArray(raw) ? raw.map((x) => new TermDeposit(x)) : [];
  }

  public async saveDeposit(d: TermDeposit): Promise<TermDeposit> {
    const raw = await this.api.putResource('financial-subledgers', { body: { subledgerType: 'deposits', ...d } });
    return new TermDeposit(raw);
  }

  public async deleteSubledgerItem(type: string, id: string): Promise<void> {
    await this.api.deleteResource(['financial-subledgers', type, id]);
  }
}
