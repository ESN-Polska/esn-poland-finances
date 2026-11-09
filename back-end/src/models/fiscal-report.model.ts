import { Resource } from 'idea-toolbox';
import { DocumentAttachmentItem } from './accounting-document.model';

export interface FiscalDailyReport {
  id: string;
  monthReportId?: string;
  year?: number;
  monthKey?: string; // "YYYY-MM"
  /** Target budget line code (e.g. 'card', 'merch') */
  linkedBudgetCode?: string;
  printDate: string; // ISO YYYY-MM-DD
  saleDate: string; // ISO YYYY-MM-DD
  dailyReportNumber?: string; // e.g. "01/03/2026"
  reportNumber?: string; // UI alias
  printoutCode?: string; // Numer wydruku
  grossAmount: number;
  vatAmount: number;
  netAmount: number;
  reconciledTransactionId?: string;
  notes?: string;
}

export class FiscalMonthlyReport extends Resource {
  id: string; // e.g. "fiscal_2026_03"
  year: number;
  monthKey: string; // "YYYY-MM"
  monthNumber: number; // 1..12

  get month(): number {
    return this.monthNumber;
  }
  set month(v: number) {
    this.monthNumber = v;
  }

  get monthName(): string {
    const names = [
      'Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec',
      'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'
    ];
    return names[this.monthNumber - 1] || `Miesiąc ${this.monthNumber}`;
  }

  get grossTotal(): number {
    return this.totalGross;
  }
  set grossTotal(v: number) {
    this.totalGross = v;
  }

  get vatTotal(): number {
    return this.totalVat;
  }
  set vatTotal(v: number) {
    this.totalVat = v;
  }

  get netTotal(): number {
    return this.totalNet;
  }
  set netTotal(v: number) {
    this.totalNet = v;
  }

  reportAttachment?: DocumentAttachmentItem;
  dailyReports: FiscalDailyReport[];

  totalGross: number;
  totalVat: number;
  totalNet: number;

  notes?: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  updatedBy?: string;

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
    this.monthKey = this.clean(x.monthKey, String, `${this.year}-01`);
    const parts = this.monthKey.split('-');
    this.monthNumber = parts.length > 1 ? parseInt(parts[1], 10) : 1;

    if (x.reportAttachment) {
      this.reportAttachment = {
        fileId: this.clean(x.reportAttachment.fileId, String),
        fileName: this.clean(x.reportAttachment.fileName, String),
        fileSize: this.clean(x.reportAttachment.fileSize, Number, 0),
        contentType: this.clean(x.reportAttachment.contentType, String, 'application/pdf'),
        s3Key: this.clean(x.reportAttachment.s3Key, String),
        url: this.clean(x.reportAttachment.url, String, ''),
        uploadedAt: this.clean(x.reportAttachment.uploadedAt, String, new Date().toISOString())
      };
    }

    this.dailyReports = Array.isArray(x.dailyReports)
      ? x.dailyReports.map((dr: any, idx: number) => ({
          id: this.clean(dr.id, String, `${this.id}_dr_${idx + 1}`),
          monthReportId: this.clean(dr.monthReportId, String, this.id),
          year: this.year,
          monthKey: this.monthKey,
          linkedBudgetCode: this.clean(dr.linkedBudgetCode, String, 'card'),
          printDate: this.clean(dr.printDate, String, ''),
          saleDate: this.clean(dr.saleDate, String, dr.printDate || ''),
          dailyReportNumber: this.clean(dr.dailyReportNumber, String, `${idx + 1}`),
          printoutCode: this.clean(dr.printoutCode, String, ''),
          grossAmount: this.clean(dr.grossAmount, Number, 0),
          vatAmount: this.clean(dr.vatAmount, Number, 0),
          netAmount: this.clean(dr.netAmount, Number, Math.round((Number(dr.grossAmount || 0) - Number(dr.vatAmount || 0)) * 100) / 100),
          reconciledTransactionId: this.clean(dr.reconciledTransactionId, String, ''),
          notes: this.clean(dr.notes, String, '')
        }))
      : [];

    this.recalculateMonthlyTotals();

    this.notes = this.clean(x.notes, String, '');
    this.createdAt = this.clean(x.createdAt, String, new Date().toISOString());
    this.updatedAt = this.clean(x.updatedAt, String, new Date().toISOString());
    this.createdBy = this.clean(x.createdBy, String, '');
    this.updatedBy = this.clean(x.updatedBy, String, '');
  }

  recalculateMonthlyTotals(): void {
    let gross = 0;
    let vat = 0;
    let net = 0;

    for (const dr of this.dailyReports || []) {
      gross += Number(dr.grossAmount) || 0;
      vat += Number(dr.vatAmount) || 0;
      net += Number(dr.netAmount) || 0;
    }

    this.totalGross = Math.round(gross * 100) / 100;
    this.totalVat = Math.round(vat * 100) / 100;
    this.totalNet = Math.round(net * 100) / 100;
  }
}
