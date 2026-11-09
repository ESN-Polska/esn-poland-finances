import { Resource } from 'idea-toolbox';
import { Currency } from './financial-request.model';

export type LinkedCodeType = 'BUDGET_CODE' | 'MEETING_CODE' | 'SECTION_CODE';

export interface DocumentCodeAllocation {
  id: string;
  linkedCodeType: LinkedCodeType;
  /** Linked code string (e.g. 'card', 'NA1', 'sAGH') */
  linkedCode: string;
  code?: string;
  allocatedGrossAmount: number;
  allocatedVatAmount: number;
  allocatedNetAmount: number;
  amount?: number;
  description?: string;
}

export type AccountingDocumentType = 'COST' | 'REVENUE' | 'COMMISSION';
export type DocumentPaymentOrigin = 'TRANSACTIONS' | 'ADVANCE';
export type DocumentRecordStatus = 'DRAFT' | 'APPROVED' | 'SETTLED' | 'CANCELLED';

export interface DocumentAttachmentItem {
  fileId?: string;
  fileName?: string;
  name?: string;
  fileSize?: number;
  contentType?: string;
  s3Key?: string;
  url?: string;
  uploadedAt?: string;
}

export class DocumentRecord extends Resource {
  id: string;
  year: number;
  documentType: AccountingDocumentType;
  invoiceNumber: string;
  ksefNumber?: string;
  issuedBy: string;
  issuedOn: string; // ISO Date YYYY-MM-DD
  saleDate: string; // ISO Date YYYY-MM-DD
  paymentDeadline?: string;
  paidOn?: string;

  currency: Currency;
  grossAmount: number;
  vatAmount: number;
  netAmount: number;

  paymentOrigin: DocumentPaymentOrigin;
  /** Linked advance record ID if settled from an advance */
  advanceId?: string;
  /** Backlink to FinancialRequest if auto-created from PAID status */
  originRequestId?: string;

  /** Multi-code splits across budget lines, meetings, and sections */
  codeAllocations: DocumentCodeAllocation[];
  attachments: DocumentAttachmentItem[];
  status: DocumentRecordStatus;

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
    this.documentType = this.clean(x.documentType, String, 'COST') as AccountingDocumentType;
    this.invoiceNumber = this.clean(x.invoiceNumber, String, '');
    this.ksefNumber = this.clean(x.ksefNumber, String, '');
    this.issuedBy = this.clean(x.issuedBy, String, '');
    this.issuedOn = this.clean(x.issuedOn, String, new Date().toISOString().substring(0, 10));
    this.saleDate = this.clean(x.saleDate, String, this.issuedOn);
    this.paymentDeadline = this.clean(x.paymentDeadline, String, '');
    this.paidOn = this.clean(x.paidOn, String, '');

    this.currency = (this.clean(x.currency, String, 'PLN') === 'EUR' ? 'EUR' : 'PLN') as Currency;
    this.grossAmount = this.clean(x.grossAmount, Number, 0);
    this.vatAmount = this.clean(x.vatAmount, Number, 0);
    this.netAmount = this.clean(x.netAmount, Number, Math.round((this.grossAmount - this.vatAmount) * 100) / 100);

    this.paymentOrigin = this.clean(x.paymentOrigin, String, 'TRANSACTIONS') as DocumentPaymentOrigin;
    this.advanceId = this.clean(x.advanceId, String, '');
    this.originRequestId = this.clean(x.originRequestId, String, '');

    this.codeAllocations = Array.isArray(x.codeAllocations)
      ? x.codeAllocations.map((ca: any, idx: number) => {
          const lCode = this.clean(ca.linkedCode || ca.code, String, '').trim();
          return {
            id: this.clean(ca.id, String, `alloc_${idx + 1}`),
            linkedCodeType: (ca.linkedCodeType === 'MEETING_CODE'
              ? 'MEETING_CODE'
              : ca.linkedCodeType === 'SECTION_CODE'
              ? 'SECTION_CODE'
              : 'BUDGET_CODE') as LinkedCodeType,
            linkedCode: lCode,
            code: lCode,
            allocatedGrossAmount: this.clean(ca.allocatedGrossAmount || ca.amount, Number, 0),
            allocatedVatAmount: this.clean(ca.allocatedVatAmount, Number, 0),
            allocatedNetAmount: this.clean(ca.allocatedNetAmount, Number, 0),
            amount: this.clean(ca.allocatedGrossAmount || ca.amount, Number, 0),
            description: this.clean(ca.description, String, '')
          };
        })
      : [];

    this.attachments = Array.isArray(x.attachments)
      ? x.attachments.map((att: any) => {
          const fName = this.clean(att.fileName || att.name, String, 'attachment.pdf');
          return {
            fileId: this.clean(att.fileId, String, `file_${Date.now()}`),
            fileName: fName,
            name: fName,
            fileSize: this.clean(att.fileSize, Number, 0),
            contentType: this.clean(att.contentType, String, 'application/pdf'),
            s3Key: this.clean(att.s3Key, String, ''),
            url: this.clean(att.url, String, ''),
            uploadedAt: this.clean(att.uploadedAt, String, new Date().toISOString())
          };
        })
      : [];

    this.status = this.clean(x.status, String, 'SETTLED') as DocumentRecordStatus;
    this.notes = this.clean(x.notes, String, '');
    this.createdAt = this.clean(x.createdAt, String, new Date().toISOString());
    this.updatedAt = this.clean(x.updatedAt, String, new Date().toISOString());
    this.createdBy = this.clean(x.createdBy, String, '');
    this.updatedBy = this.clean(x.updatedBy, String, '');
  }

  /**
   * Validates multi-code allocation sums against document totals
   */
  validateAllocations(): string[] {
    const errors: string[] = [];
    if (!this.codeAllocations || this.codeAllocations.length === 0) {
      errors.push('Document must have at least one code allocation.');
      return errors;
    }

    const totalAllocatedGross = this.codeAllocations.reduce((acc, a) => acc + (Number(a.allocatedGrossAmount) || 0), 0);
    const totalAllocatedNet = this.codeAllocations.reduce((acc, a) => acc + (Number(a.allocatedNetAmount) || 0), 0);

    const grossDiff = Math.abs(totalAllocatedGross - this.grossAmount);
    const netDiff = Math.abs(totalAllocatedNet - this.netAmount);

    if (grossDiff > 0.05) {
      errors.push(
        `Sum of allocated gross amounts (${totalAllocatedGross.toFixed(2)}) must equal document gross amount (${this.grossAmount.toFixed(2)}).`
      );
    }

    if (netDiff > 0.05) {
      errors.push(
        `Sum of allocated net amounts (${totalAllocatedNet.toFixed(2)}) must equal document net amount (${this.netAmount.toFixed(2)}).`
      );
    }

    for (const alloc of this.codeAllocations) {
      if (!alloc.linkedCode) {
        errors.push('Each allocation must specify a linked code.');
      }
    }

    return errors;
  }
}
