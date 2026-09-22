import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ToastController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import {
  AttachmentFile,
  FinancialRequest,
  FinancialRequestType,
  InvoiceDocumentItem
} from '@models/financial-request.model';
import { AppService } from '../../../app.service';
import { RequestsService } from '../../../services/requests.service';

@Component({
  selector: 'app-request-form',
  templateUrl: './request-form.page.html',
  styleUrls: ['./request-form.page.scss']
})
export class RequestFormPage implements OnInit {
  public isEditMode = false;
  public isChangesRequested = false;
  public isSubmitting = false;
  public totalNetAmount = 0;
  public bankAccountType: 'DOMESTIC' | 'INTERNATIONAL' = 'DOMESTIC';
  public hasAttemptedSubmit: boolean = false;
  public readonly MAX_FILE_SIZE_MB = 20;
  private readonly MAX_FILE_SIZE = this.MAX_FILE_SIZE_MB * 1024 * 1024;

  public request: Partial<FinancialRequest> = {
    position: '',
    sourceOfFunding: '',
    requestType: 'INVOICE_TO_PAY',
    currency: 'PLN',
    totalGrossAmount: 0,
    totalVatAmount: 0,
    documents: [],
    accountHolderName: '',
    accountHolderAddress: '',
    iban: '',
    swiftBic: '',
    additionalRemarks: '',
    ticketAttachments: []
  };

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private toastCtrl: ToastController,
    private translate: TranslateService,
    private appService: AppService,
    private requestsService: RequestsService
  ) {}

  public async ngOnInit(): Promise<void> {
    const year = this.route.snapshot.paramMap.get('year');
    const id = this.route.snapshot.paramMap.get('id');
    let editId: string | null = null;

    if (year && id) {
      editId = `${id}/${year}`;
    } else if (id) {
      editId = decodeURIComponent(id);
    }

    if (editId) {
      this.isEditMode = true;
      await this.loadExistingRequest(editId);
    } else {
      this.isEditMode = false;
      await this.initNewRequest();
    }
  }

  private async loadExistingRequest(requestId: string): Promise<void> {
    const existing = await this.requestsService.getRequestById(requestId);
    if (!existing) {
      await this.showToast('REQUESTS.NOT_FOUND', 'danger');
      this.router.navigate(['/t/requests']);
      return;
    }

    // Strict Permission check: Only DRAFT and CHANGES_REQUESTED can be edited!
    if (!existing.canEdit()) {
      await this.showToast('REQUESTS.LOCKED_READONLY_NOTICE', 'warning');
      const [seq, year] = requestId.split('/');
      if (year && seq) {
        this.router.navigate(['/t/requests/view', year, seq], { replaceUrl: true });
      } else {
        this.router.navigate(['/t/requests/view', encodeURIComponent(requestId)], { replaceUrl: true });
      }
      return;
    }

    this.isChangesRequested = existing.status === 'CHANGES_REQUESTED';
    this.request = {
      ...existing,
      documents: existing.documents ? [...existing.documents] : [],
      ticketAttachments: existing.ticketAttachments ? [...existing.ticketAttachments] : []
    };

    if (
      (this.request.requestType === 'INVOICE_TO_PAY' ||
        this.request.requestType === 'INVOICE_REIMBURSEMENT') &&
      (!this.request.documents || this.request.documents.length === 0)
    ) {
      this.addDocumentItem();
    }

    this.bankAccountType =
      existing.swiftBic || (existing.iban && /^[A-Za-z]{2}/.test(existing.iban.trim()) && !existing.iban.trim().toUpperCase().startsWith('PL'))
        ? 'INTERNATIONAL'
        : 'DOMESTIC';

    this.recalculateTotals();
  }

  private async initNewRequest(): Promise<void> {
    const user = this.appService.currentUser;
    const defaultBank = await this.appService.getDefaultBankDetails();

    this.request = {
      position: '',
      sourceOfFunding: '',
      requestType: 'INVOICE_TO_PAY',
      currency: 'PLN',
      totalGrossAmount: 0,
      totalVatAmount: 0,
      documents: [],
      accountHolderName: defaultBank?.accountHolderName || user?.getDisplayName() || '',
      accountHolderAddress: defaultBank?.accountHolderAddress || '',
      iban: defaultBank?.iban || '',
      swiftBic: defaultBank?.swiftBic || '',
      additionalRemarks: '',
      ticketAttachments: []
    };

    this.bankAccountType =
      defaultBank?.swiftBic || (defaultBank?.iban && /^[A-Za-z]{2}/.test(defaultBank.iban.trim()) && !defaultBank.iban.trim().toUpperCase().startsWith('PL'))
        ? 'INTERNATIONAL'
        : 'DOMESTIC';

    this.addDocumentItem();
  }

  public get requestDisplayId(): string {
    if (this.request.status === 'DRAFT' || !this.request.sequenceNumber) {
      const y = this.request.year || new Date(this.request.createdAt || Date.now()).getFullYear();
      return `—/${y}`;
    }
    return this.request.requestId || '';
  }

  public get isDraft(): boolean {
    return this.request.status === 'DRAFT';
  }

  public selectType(type: FinancialRequestType): void {
    this.request.requestType = type;
    if (
      (type === 'INVOICE_TO_PAY' || type === 'INVOICE_REIMBURSEMENT') &&
      (!this.request.documents || this.request.documents.length === 0)
    ) {
      this.addDocumentItem();
    }
    this.recalculateTotals();
  }

  /* Multi-document operations */
  public addDocumentItem(): void {
    if (!this.request.documents) this.request.documents = [];

    const newItem: InvoiceDocumentItem = {
      id: 'doc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      invoiceNumber: '',
      ksefNumber: '',
      issuedBy: '',
      issuedOn: new Date().toISOString().split('T')[0],
      paymentDeadline: '',
      paidOn: '',
      bankAccountDetails: '',
      currency: this.request.currency || 'PLN',
      grossAmount: 0,
      vatAmount: 0,
      explanation: ''
    };

    this.request.documents.push(newItem);
    this.recalculateTotals();
  }

  public removeDocumentItem(index: number): void {
    if (this.request.documents && this.request.documents.length > 1) {
      this.request.documents.splice(index, 1);
      this.recalculateTotals();
    }
  }

  public recalculateTotals(): void {
    if (
      this.request.requestType === 'INVOICE_TO_PAY' ||
      this.request.requestType === 'INVOICE_REIMBURSEMENT'
    ) {
      const curr = this.request.currency || 'PLN';
      if (this.request.documents && this.request.documents.length > 0) {
        for (const doc of this.request.documents) {
          doc.currency = curr;
        }
        const totals = this.requestsService.calculateTotals(this.request.documents);
        this.request.totalGrossAmount = totals.totalGrossAmount;
        this.request.totalVatAmount = totals.totalVatAmount;
      } else {
        this.request.totalGrossAmount = 0;
        this.request.totalVatAmount = 0;
      }
    }
    const gross = Number(this.request.totalGrossAmount) || 0;
    const vat = Number(this.request.totalVatAmount) || 0;
    this.totalNetAmount = Math.max(0, Math.round((gross - vat) * 100) / 100);
  }

  public getDocNet(doc: InvoiceDocumentItem): number {
    const gross = Number(doc.grossAmount) || 0;
    const vat = Number(doc.vatAmount) || 0;
    return Math.max(0, Math.round((gross - vat) * 100) / 100);
  }

  public onCurrencyChange(newCurr: any): void {
    this.request.currency = newCurr;
    this.recalculateTotals();
  }

  public setBankAccountType(type: 'DOMESTIC' | 'INTERNATIONAL'): void {
    this.bankAccountType = type;
    if (type === 'DOMESTIC') {
      this.request.swiftBic = '';
    }
    if (this.request.iban) {
      this.request.iban = this.formatIban(this.request.iban, type);
    }
  }

  public formatDomesticAccount(value: string): string {
    if (!value) return '';
    const digits = value.replace(/\D/g, '').slice(0, 26);
    if (digits.length <= 2) return digits;
    const firstTwo = digits.slice(0, 2);
    const rest = digits.slice(2);
    const restGroups = rest.match(/.{1,4}/g);
    return restGroups ? `${firstTwo} ${restGroups.join(' ')}` : firstTwo;
  }

  public formatInternationalIban(value: string): string {
    if (!value) return '';
    const cleaned = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    let letters = '';
    let digits = '';
    for (let i = 0; i < cleaned.length; i++) {
      const char = cleaned[i];
      if (letters.length < 2) {
        if (/[A-Z]/.test(char)) {
          letters += char;
        }
      } else {
        if (/[0-9]/.test(char)) {
          digits += char;
        }
      }
    }
    digits = digits.slice(0, 32);
    const combined = letters + digits;
    return combined.match(/.{1,4}/g)?.join(' ') || combined;
  }

  public formatSwift(value: string): string {
    if (!value) return '';
    return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11);
  }

  public formatIban(value: string, forceType?: 'DOMESTIC' | 'INTERNATIONAL'): string {
    const type = forceType || this.bankAccountType;
    if (type === 'DOMESTIC') {
      return this.formatDomesticAccount(value);
    }
    return this.formatInternationalIban(value);
  }

  public onPayoutIbanInput(event: any): void {
    const raw = event.target?.value || '';
    const formatted = this.bankAccountType === 'DOMESTIC'
      ? this.formatDomesticAccount(raw)
      : this.formatInternationalIban(raw);
    this.request.iban = formatted;
  }

  public onPayoutSwiftInput(event: any): void {
    const raw = event.target?.value || '';
    this.request.swiftBic = this.formatSwift(raw);
  }

  public onSellerIbanInput(event: any, doc: InvoiceDocumentItem): void {
    const raw = (event.target?.value || '').trim();
    if (/^[A-Za-z]/.test(raw)) {
      doc.bankAccountDetails = this.formatInternationalIban(raw);
    } else {
      doc.bankAccountDetails = this.formatDomesticAccount(raw);
    }
  }

  public isValidDomesticAccount(val: string | undefined): boolean {
    const clean = (val || '').replace(/\D/g, '');
    return clean.length === 26;
  }

  public isValidInternationalIban(val: string | undefined): boolean {
    const clean = (val || '').replace(/\s+/g, '').toUpperCase();
    return /^[A-Z]{2}[0-9]{13,32}$/.test(clean);
  }

  public isValidSwift(val: string | undefined): boolean {
    const clean = (val || '').replace(/\s+/g, '').toUpperCase();
    return /^[A-Z0-9]{8}$|^[A-Z0-9]{11}$/.test(clean);
  }

  public isValidSellerBank(val: string | undefined): boolean {
    return this.isValidDomesticAccount(val) || this.isValidInternationalIban(val);
  }

  public isFieldInvalid(field: string): boolean {
    if (!this.hasAttemptedSubmit) return false;
    switch (field) {
      case 'position':
        return !this.request.position?.trim();
      case 'sourceOfFunding':
        return !this.request.sourceOfFunding?.trim();
      case 'accountHolderName':
        return this.request.requestType !== 'INVOICE_TO_PAY' && !this.request.accountHolderName?.trim();
      case 'accountHolderAddress':
        return this.request.requestType !== 'INVOICE_TO_PAY' && !this.request.accountHolderAddress?.trim();
      case 'iban':
        if (this.request.requestType === 'INVOICE_TO_PAY') return false;
        return this.bankAccountType === 'DOMESTIC'
          ? !this.isValidDomesticAccount(this.request.iban)
          : !this.isValidInternationalIban(this.request.iban);
      case 'swiftBic':
        return this.request.requestType !== 'INVOICE_TO_PAY' &&
          this.bankAccountType === 'INTERNATIONAL' &&
          !this.isValidSwift(this.request.swiftBic);
      case 'requestedAmountPLN':
        return this.request.requestType === 'ADVANCE_PAYMENT' &&
          (!this.request.requestedAmountPLN || Number(this.request.requestedAmountPLN) <= 0);
      case 'explanationAndBudget':
        return this.request.requestType === 'ADVANCE_PAYMENT' && !this.request.explanationAndBudget?.trim();
      case 'delegationFormAttachment':
        return this.request.requestType === 'DELEGATION_SETTLEMENT' && !this.request.delegationFormAttachment;
      case 'ticketAttachments':
        return this.request.requestType === 'DELEGATION_SETTLEMENT' &&
          (!this.request.ticketAttachments || this.request.ticketAttachments.length === 0);
      case 'delegationTotalAmount':
        return this.request.requestType === 'DELEGATION_SETTLEMENT' &&
          (!this.request.totalGrossAmount || Number(this.request.totalGrossAmount) <= 0);
      default:
        return false;
    }
  }

  public isDocFieldInvalid(doc: InvoiceDocumentItem, field: string): boolean {
    if (!this.hasAttemptedSubmit) return false;
    switch (field) {
      case 'invoiceNumber':
        return !doc.invoiceNumber?.trim();
      case 'issuedBy':
        return !doc.issuedBy?.trim();
      case 'issuedOn':
        return !doc.issuedOn;
      case 'paymentDeadline':
        return this.request.requestType === 'INVOICE_TO_PAY' && !doc.paymentDeadline;
      case 'paidOn':
        return this.request.requestType === 'INVOICE_REIMBURSEMENT' && !doc.paidOn;
      case 'bankAccountDetails':
        return this.request.requestType === 'INVOICE_TO_PAY' && !this.isValidSellerBank(doc.bankAccountDetails);
      case 'grossAmount':
        return doc.grossAmount === undefined || doc.grossAmount === null || Number(doc.grossAmount) <= 0;
      case 'vatAmount':
        return doc.vatAmount === undefined || doc.vatAmount === null || Number(doc.vatAmount) < 0 || Number(doc.vatAmount) > Number(doc.grossAmount);
      case 'attachment':
        return !doc.attachment;
      default:
        return false;
    }
  }

  public onAdvanceAmountChange(): void {
    this.request.totalGrossAmount = Number(this.request.requestedAmountPLN) || 0;
    this.request.totalVatAmount = 0;
    this.request.currency = 'PLN';
    this.totalNetAmount = this.request.totalGrossAmount;
  }

  /* File upload handling */
  public onFileSelected(
    event: any,
    targetDoc: InvoiceDocumentItem,
    field: 'attachment' | 'proofOfPaymentAttachment'
  ): void {
    const file = event.target?.files?.[0];
    if (!file) return;

    if (file.size > this.MAX_FILE_SIZE) {
      this.showToast('REQUESTS.VALIDATION.FILE_TOO_LARGE', 'warning', { max: `${this.MAX_FILE_SIZE_MB}MB` });
      if (event.target) event.target.value = '';
      return;
    }

    targetDoc[field] = {
      fileId: 'file_' + Date.now(),
      fileName: file.name,
      fileSize: file.size,
      contentType: file.type,
      s3Key: `requests/${Date.now()}_${file.name}`,
      uploadedAt: new Date().toISOString()
    };
  }

  public removeAttachment(
    targetDoc: InvoiceDocumentItem,
    field: 'attachment' | 'proofOfPaymentAttachment'
  ): void {
    targetDoc[field] = undefined;
  }

  public onSingleFileSelected(event: any, field: 'delegationFormAttachment'): void {
    const file = event.target?.files?.[0];
    if (!file) return;

    if (file.size > this.MAX_FILE_SIZE) {
      this.showToast('REQUESTS.VALIDATION.FILE_TOO_LARGE', 'warning', { max: `${this.MAX_FILE_SIZE_MB}MB` });
      if (event.target) event.target.value = '';
      return;
    }

    this.request[field] = {
      fileId: 'file_' + Date.now(),
      fileName: file.name,
      fileSize: file.size,
      contentType: file.type,
      s3Key: `requests/${Date.now()}_${file.name}`,
      uploadedAt: new Date().toISOString()
    };
  }

  public onMultipleFilesSelected(event: any, field: 'ticketAttachments'): void {
    const files: FileList = event.target?.files;
    if (!files || files.length === 0) return;

    if (!this.request[field]) this.request[field] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.size > this.MAX_FILE_SIZE) {
        this.showToast('REQUESTS.VALIDATION.FILE_TOO_LARGE', 'warning', { max: `${this.MAX_FILE_SIZE_MB}MB` });
        continue;
      }
      this.request[field]!.push({
        fileId: 'file_' + Date.now() + '_' + i,
        fileName: file.name,
        fileSize: file.size,
        contentType: file.type,
        s3Key: `requests/tickets/${Date.now()}_${file.name}`,
        uploadedAt: new Date().toISOString()
      });
    }
  }

  public removeMultipleFile(field: 'ticketAttachments', index: number): void {
    if (this.request[field]) {
      this.request[field]!.splice(index, 1);
    }
  }

  /* Save as DRAFT or SUBMITTED */
  public async save(targetStatus: 'DRAFT' | 'SUBMITTED'): Promise<void> {
    if (targetStatus === 'SUBMITTED') {
      this.hasAttemptedSubmit = true;
      const isValid = this.validateForSubmission();
      if (!isValid) {
        await this.showToast('REQUESTS.VALIDATION.FILL_ALL_REQUIRED', 'warning');
        setTimeout(() => {
          const firstInvalid = document.querySelector('.is-invalid');
          if (firstInvalid) {
            firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, 100);
        return;
      }
    }

    this.isSubmitting = true;
    try {
      this.recalculateTotals();
      const saved = await this.requestsService.saveRequest(this.request, targetStatus);

      const msgKey =
        targetStatus === 'DRAFT'
          ? 'REQUESTS.DRAFT_SAVED_SUCCESS'
          : this.isChangesRequested
          ? 'REQUESTS.RESUBMITTED_SUCCESS'
          : 'REQUESTS.SUBMITTED_SUCCESS';

      await this.showToast(msgKey, 'success');
      this.router.navigate(['/t/requests'], { replaceUrl: true });
    } catch (err: any) {
      console.error('Failed to save request', err);
      await this.showToast(err.message || 'Error saving request', 'danger');
    } finally {
      this.isSubmitting = false;
    }
  }

  private validateForSubmission(): boolean {
    if (!this.request.position?.trim()) return false;
    if (!this.request.sourceOfFunding?.trim()) return false;

    // Only require personal payout bank account when federation pays the applicant directly
    if (this.request.requestType !== 'INVOICE_TO_PAY') {
      if (!this.request.accountHolderName?.trim()) return false;
      if (!this.request.accountHolderAddress?.trim()) return false;
      if (!this.request.iban?.trim()) return false;
      if (this.bankAccountType === 'DOMESTIC') {
        if (!this.isValidDomesticAccount(this.request.iban)) return false;
      } else {
        if (!this.isValidInternationalIban(this.request.iban)) return false;
        if (!this.isValidSwift(this.request.swiftBic)) return false;
      }
    }

    if (
      this.request.requestType === 'INVOICE_TO_PAY' ||
      this.request.requestType === 'INVOICE_REIMBURSEMENT'
    ) {
      if (!this.request.documents || this.request.documents.length === 0) {
        return false;
      }

      for (let i = 0; i < this.request.documents.length; i++) {
        const doc = this.request.documents[i];
        if (!doc.invoiceNumber?.trim()) return false;
        if (!doc.issuedBy?.trim()) return false;
        if (!doc.issuedOn) return false;

        if (this.request.requestType === 'INVOICE_TO_PAY') {
          if (!doc.paymentDeadline) return false;
          if (!doc.bankAccountDetails?.trim() || !this.isValidSellerBank(doc.bankAccountDetails)) {
            return false;
          }
        }

        if (this.request.requestType === 'INVOICE_REIMBURSEMENT') {
          if (!doc.paidOn) return false;
        }

        if (doc.grossAmount === undefined || doc.grossAmount === null || Number(doc.grossAmount) <= 0) {
          return false;
        }
        if (doc.vatAmount === undefined || doc.vatAmount === null || Number(doc.vatAmount) < 0 || Number(doc.vatAmount) > Number(doc.grossAmount)) {
          return false;
        }
        if (!doc.attachment) return false;
      }
    } else if (this.request.requestType === 'ADVANCE_PAYMENT') {
      if (!this.request.requestedAmountPLN || Number(this.request.requestedAmountPLN) <= 0) {
        return false;
      }
      if (!this.request.explanationAndBudget?.trim()) {
        return false;
      }
    } else if (this.request.requestType === 'DELEGATION_SETTLEMENT') {
      if (!this.request.totalGrossAmount || Number(this.request.totalGrossAmount) <= 0) {
        return false;
      }
      if (!this.request.delegationFormAttachment) {
        return false;
      }
      if (!this.request.ticketAttachments || this.request.ticketAttachments.length === 0) {
        return false;
      }
    }

    return true;
  }

  public goBack(): void {
    this.router.navigate(['/t/requests']);
  }

  private async showToast(messageKey: string, color: string, interpolateParams?: any): Promise<void> {
    const msg = this.translate.instant(messageKey, interpolateParams);
    const toast = await this.toastCtrl.create({
      message: msg && msg !== messageKey ? msg : messageKey,
      duration: 3500,
      position: 'bottom',
      color
    });
    await toast.present();
  }
}
