import { Resource } from 'idea-toolbox';

export type FinancialRequestType =
  | 'INVOICE_TO_PAY'
  | 'INVOICE_REIMBURSEMENT'
  | 'ADVANCE_PAYMENT'
  | 'DELEGATION_SETTLEMENT';

export type RequestStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'IN_REVIEW'
  | 'CHANGES_REQUESTED'
  | 'APPROVED'
  | 'PAID'
  | 'REJECTED';

export type FinancialRequestStatus = RequestStatus;

export type Currency = 'PLN' | 'EUR';

export interface AttachmentFile {
  fileId: string;
  fileName: string;
  fileSize: number;
  contentType: string;
  s3Key: string;
  url?: string;
  uploadedAt: string;
}

export interface InvoiceDocumentItem {
  id: string;
  invoiceNumber: string;
  ksefNumber?: string;
  issuedBy: string;
  issuedOn: string;
  paymentDeadline?: string;
  paidOn?: string;
  bankAccountDetails?: string;
  currency: Currency;
  grossAmount: number;
  vatAmount: number;
  explanation?: string;
  attachment?: AttachmentFile;
  proofOfPaymentAttachment?: AttachmentFile;
}

export interface StatusHistoryEntry {
  status: RequestStatus;
  timestamp: string;
  updatedBy: string;
  comment?: string;
}

export class FinancialRequest extends Resource {
  requestId: string; // e.g. "1/2026" or "draft_uuid"
  year: number;
  sequenceNumber?: number;

  userId: string;
  userDisplayName: string;
  userEmail: string;
  userAvatarURL?: string;
  section: string;
  country: string;
  extendedRoles: string[];

  position: string;
  sourceOfFunding: string;
  requestType: FinancialRequestType;
  status: RequestStatus;

  currency: Currency;
  totalGrossAmount: number;
  totalVatAmount: number;

  // Type A & B
  documents: InvoiceDocumentItem[];

  // Type C: Advance payment
  requestedAmountPLN?: number;
  explanationAndBudget?: string;

  // Type D: Delegation
  delegationFormAttachment?: AttachmentFile;
  ticketAttachments?: AttachmentFile[];
  otherReceipts?: AttachmentFile[];

  generalExplanation?: string;

  // Payout Bank Details
  accountHolderName: string;
  accountHolderAddress: string;
  iban: string;
  swiftBic?: string;

  additionalRemarks?: string;
  adminRemarks?: string;
  statusHistory: StatusHistoryEntry[];

  submittedAt?: string;
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
    this.requestId = this.clean(x.requestId, String);
    this.year = this.clean(x.year, Number, new Date().getFullYear());
    this.sequenceNumber = this.clean(x.sequenceNumber, Number);

    this.userId = this.clean(x.userId, String)?.toLowerCase();
    this.userDisplayName = this.clean(x.userDisplayName, String);
    this.userEmail = this.clean(x.userEmail, String);
    this.userAvatarURL = this.clean(x.userAvatarURL, String, '');
    this.section = this.clean(x.section, String);
    this.country = this.clean(x.country, String);
    this.extendedRoles = this.cleanArray(x.extendedRoles, String);

    this.position = this.clean(x.position, String);
    this.sourceOfFunding = this.clean(x.sourceOfFunding, String);
    this.requestType = this.clean(x.requestType, String, 'INVOICE_TO_PAY');
    this.status = this.clean(x.status, String, 'DRAFT');

    this.currency = this.clean(x.currency, String, 'PLN');
    this.totalGrossAmount = this.clean(x.totalGrossAmount, Number, 0);
    this.totalVatAmount = this.clean(x.totalVatAmount, Number, 0);

    this.documents = Array.isArray(x.documents) ? x.documents : [];
    this.requestedAmountPLN = this.clean(x.requestedAmountPLN, Number);
    this.explanationAndBudget = this.clean(x.explanationAndBudget, String);

    this.delegationFormAttachment = x.delegationFormAttachment || undefined;
    this.ticketAttachments = Array.isArray(x.ticketAttachments) ? x.ticketAttachments : [];
    this.otherReceipts = Array.isArray(x.otherReceipts) ? x.otherReceipts : [];

    this.generalExplanation = this.clean(x.generalExplanation, String);

    this.accountHolderName = this.clean(x.accountHolderName, String);
    this.accountHolderAddress = this.clean(x.accountHolderAddress, String);
    this.iban = this.clean(x.iban, String);
    this.swiftBic = this.clean(x.swiftBic, String);

    this.additionalRemarks = this.clean(x.additionalRemarks, String);
    this.adminRemarks = this.clean(x.adminRemarks, String);
    this.statusHistory = Array.isArray(x.statusHistory) ? x.statusHistory : [];

    this.submittedAt = this.clean(x.submittedAt, String);
    this.createdAt = this.clean(x.createdAt, String, new Date().toISOString());
    this.updatedAt = this.clean(x.updatedAt, String, new Date().toISOString());
  }

  get isDraft(): boolean {
    return this.status === 'DRAFT';
  }

  get isNumbered(): boolean {
    return this.status !== 'DRAFT' && typeof this.sequenceNumber === 'number';
  }

  get displayId(): string {
    if (this.isDraft || !this.sequenceNumber) {
      const y = this.year || new Date(this.createdAt || Date.now()).getFullYear();
      return `—/${y}`;
    }
    return this.requestId;
  }

  canEdit(): boolean {
    return this.status === 'DRAFT' || this.status === 'CHANGES_REQUESTED';
  }

  isEditableBy(user: { userId: string }): boolean {
    return this.canEdit() && this.userId === user.userId?.toLowerCase();
  }

  getSectionOrCountry(): string {
    const section = (this.section || '').trim();
    if (section && section !== 'undefined') {
      return section;
    }
    const country = (this.country || '').trim();
    if (country && country !== 'undefined') {
      return `ESN ${country}`;
    }
    return '';
  }
}
