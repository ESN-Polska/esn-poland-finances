import { Resource } from 'idea-toolbox';
import { UsersOriginDisplayOptions } from './configurations.model';
import { getUserOrigin } from './user.model';

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
  
  hasDifferentSaleDate?: boolean;
  saleDate?: string;
  originalCurrency?: string;
  originalAmount?: number;
  originalVatAmount?: number;
  exchangeRate?: number;
  exchangeDate?: string;
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

  /** Whether this request was submitted by an external guest without an ESN Account */
  isGuest?: boolean;
  /** Invitation ID / token that authorized the guest submission */
  guestInvitationId?: string;
  /** Purpose / event attached to the guest invitation */
  guestPurpose?: string;

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
  delegationTotalAmount?: number;
  delegationFormAttachment?: AttachmentFile;
  ticketAttachments?: AttachmentFile[];
  otherReceipts?: AttachmentFile[];

  generalExplanation?: string;

  // Payout Bank Details (PLN / Primary)
  accountHolderName: string;
  accountHolderAddress: string;
  iban: string;
  swiftBic?: string;

  // Payout Bank Details (EUR - used for mixed currency or EUR payout)
  accountHolderNameEUR?: string;
  accountHolderAddressEUR?: string;
  ibanEUR?: string;
  swiftBicEUR?: string;

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

    this.isGuest = this.clean(x.isGuest, Boolean, false);
    this.guestInvitationId = this.clean(x.guestInvitationId, String);
    this.guestPurpose = this.clean(x.guestPurpose, String);

    this.position = this.clean(x.position, String);
    this.sourceOfFunding = this.clean(x.sourceOfFunding, String);
    this.requestType = this.clean(x.requestType, String, 'INVOICE_TO_PAY');
    this.status = this.clean(x.status, String, 'DRAFT');

    this.currency = this.clean(x.currency, String, 'PLN');
    this.totalGrossAmount = this.clean(x.totalGrossAmount, Number, 0);
    this.totalVatAmount = this.clean(x.totalVatAmount, Number, 0);

    this.documents = Array.isArray(x.documents) ? x.documents : [];
    this.requestedAmountPLN = this.clean(x.requestedAmountPLN, Number);
    this.delegationTotalAmount = this.clean(x.delegationTotalAmount, Number);
    this.explanationAndBudget = this.clean(x.explanationAndBudget, String);

    if (this.requestType === 'ADVANCE_PAYMENT') {
      if (this.requestedAmountPLN !== undefined && this.requestedAmountPLN !== null) {
        this.totalGrossAmount = Number(this.requestedAmountPLN) || 0;
      } else if (this.totalGrossAmount) {
        this.requestedAmountPLN = this.totalGrossAmount;
      }
      this.totalVatAmount = 0;
      this.currency = (this.clean(x.currency, String) as Currency) || 'PLN';
    } else if (this.requestType === 'DELEGATION_SETTLEMENT') {
      if (this.delegationTotalAmount !== undefined && this.delegationTotalAmount !== null) {
        this.totalGrossAmount = Number(this.delegationTotalAmount) || 0;
      } else if (this.totalGrossAmount) {
        this.delegationTotalAmount = this.totalGrossAmount;
      }
      this.totalVatAmount = 0;
      this.currency = 'PLN';
    }

    this.delegationFormAttachment = x.delegationFormAttachment || undefined;
    this.ticketAttachments = Array.isArray(x.ticketAttachments) ? x.ticketAttachments : [];
    this.otherReceipts = Array.isArray(x.otherReceipts) ? x.otherReceipts : [];

    this.generalExplanation = this.clean(x.generalExplanation, String);

    this.accountHolderName = this.clean(x.accountHolderName, String);
    this.accountHolderAddress = this.clean(x.accountHolderAddress, String);
    this.iban = this.clean(x.iban, String);
    this.swiftBic = this.clean(x.swiftBic, String);

    this.accountHolderNameEUR = this.clean(x.accountHolderNameEUR, String);
    this.accountHolderAddressEUR = this.clean(x.accountHolderAddressEUR, String);
    this.ibanEUR = this.clean(x.ibanEUR, String);
    this.swiftBicEUR = this.clean(x.swiftBicEUR, String);

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

  getOrigin(displayOption: UsersOriginDisplayOptions = UsersOriginDisplayOptions.BOTH): string | null {
    return getUserOrigin(this, displayOption);
  }

  getSectionOrCountry(displayOption?: UsersOriginDisplayOptions): string {
    if (displayOption) {
      return this.getOrigin(displayOption) || '';
    }
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

  isMixedCurrency(): boolean {
    if (this.requestType === 'ADVANCE_PAYMENT' || this.requestType === 'DELEGATION_SETTLEMENT') {
      return false;
    }
    if (!this.documents || this.documents.length <= 1) {
      return false;
    }
    const hasPLN = this.documents.some((d) => (d.currency || 'PLN').toUpperCase() === 'PLN');
    const hasEUR = this.documents.some((d) => (d.currency || '').toUpperCase() === 'EUR');
    return hasPLN && hasEUR;
  }

  getGrossAmountPLN(): number {
    if (this.requestType === 'ADVANCE_PAYMENT') {
      return (this.currency || 'PLN').toUpperCase() === 'PLN' ? (Number(this.requestedAmountPLN ?? this.totalGrossAmount) || 0) : 0;
    }
    if (this.requestType === 'DELEGATION_SETTLEMENT') {
      return Number(this.delegationTotalAmount ?? this.totalGrossAmount) || 0;
    }
    if (this.documents && this.documents.length > 0) {
      const sum = this.documents
        .filter((d) => (d.currency || 'PLN').toUpperCase() === 'PLN')
        .reduce((acc, d) => acc + (Number(d.grossAmount) || 0), 0);
      return Math.round(sum * 100) / 100;
    }
    return (this.currency || 'PLN').toUpperCase() === 'PLN' ? Number(this.totalGrossAmount) || 0 : 0;
  }

  getGrossAmountEUR(): number {
    if (this.requestType === 'ADVANCE_PAYMENT') {
      return (this.currency || '').toUpperCase() === 'EUR' ? (Number(this.requestedAmountPLN ?? this.totalGrossAmount) || 0) : 0;
    }
    if (this.requestType === 'DELEGATION_SETTLEMENT') {
      return 0;
    }
    if (this.documents && this.documents.length > 0) {
      const sum = this.documents
        .filter((d) => (d.currency || '').toUpperCase() === 'EUR')
        .reduce((acc, d) => acc + (Number(d.grossAmount) || 0), 0);
      return Math.round(sum * 100) / 100;
    }
    return (this.currency || '').toUpperCase() === 'EUR' ? Number(this.totalGrossAmount) || 0 : 0;
  }

  getVatAmountPLN(): number {
    if (!this.documents || this.documents.length === 0) return 0;
    const sum = this.documents
      .filter((d) => (d.currency || 'PLN').toUpperCase() === 'PLN')
      .reduce((acc, d) => acc + (Number(d.vatAmount) || 0), 0);
    return Math.round(sum * 100) / 100;
  }

  getVatAmountEUR(): number {
    if (!this.documents || this.documents.length === 0) return 0;
    const sum = this.documents
      .filter((d) => (d.currency || '').toUpperCase() === 'EUR')
      .reduce((acc, d) => acc + (Number(d.vatAmount) || 0), 0);
    return Math.round(sum * 100) / 100;
  }

  getNetAmountPLN(): number {
    return Math.max(0, Math.round((this.getGrossAmountPLN() - this.getVatAmountPLN()) * 100) / 100);
  }

  getNetAmountEUR(): number {
    return Math.max(0, Math.round((this.getGrossAmountEUR() - this.getVatAmountEUR()) * 100) / 100);
  }
}
