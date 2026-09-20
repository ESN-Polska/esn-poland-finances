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
    const editId = this.route.snapshot.paramMap.get('id');

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
      this.router.navigate(['/t/requests/my-requests']);
      return;
    }

    // Strict Permission check: Only DRAFT and CHANGES_REQUESTED can be edited!
    if (!existing.canEdit()) {
      await this.showToast('REQUESTS.LOCKED_READONLY_NOTICE', 'warning');
      this.router.navigate(['/t/requests/view', encodeURIComponent(requestId)], { replaceUrl: true });
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

    this.addDocumentItem();
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
      if (this.request.documents && this.request.documents.length > 0) {
        const totals = this.requestsService.calculateTotals(this.request.documents);
        this.request.totalGrossAmount = totals.totalGrossAmount;
        this.request.totalVatAmount = totals.totalVatAmount;
        this.request.currency = this.request.documents[0].currency || 'PLN';
      } else {
        this.request.totalGrossAmount = 0;
        this.request.totalVatAmount = 0;
      }
    }
  }

  public onAdvanceAmountChange(): void {
    this.request.totalGrossAmount = Number(this.request.requestedAmountPLN) || 0;
    this.request.totalVatAmount = 0;
    this.request.currency = 'PLN';
  }

  /* File upload handling */
  public onFileSelected(
    event: any,
    targetDoc: InvoiceDocumentItem,
    field: 'attachment' | 'proofOfPaymentAttachment'
  ): void {
    const file = event.target?.files?.[0];
    if (!file) return;

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
      const validationError = this.validateForSubmission();
      if (validationError) {
        await this.showToast(validationError, 'warning');
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
      this.router.navigate(['/t/requests/my-requests'], { replaceUrl: true });
    } catch (err: any) {
      console.error('Failed to save request', err);
      await this.showToast(err.message || 'Error saving request', 'danger');
    } finally {
      this.isSubmitting = false;
    }
  }

  private validateForSubmission(): string | null {
    if (!this.request.position?.trim()) return 'REQUESTS.VALIDATION.POSITION_REQUIRED';
    if (!this.request.sourceOfFunding?.trim()) return 'REQUESTS.VALIDATION.FUNDING_REQUIRED';
    if (!this.request.accountHolderName?.trim()) return 'REQUESTS.VALIDATION.ACCOUNT_HOLDER_REQUIRED';
    if (!this.request.accountHolderAddress?.trim()) return 'REQUESTS.VALIDATION.ACCOUNT_ADDRESS_REQUIRED';
    if (!this.request.iban?.trim()) return 'REQUESTS.VALIDATION.IBAN_REQUIRED';

    if (
      this.request.requestType === 'INVOICE_TO_PAY' ||
      this.request.requestType === 'INVOICE_REIMBURSEMENT'
    ) {
      if (!this.request.documents || this.request.documents.length === 0) {
        return 'REQUESTS.VALIDATION.AT_LEAST_ONE_DOC';
      }

      for (let i = 0; i < this.request.documents.length; i++) {
        const doc = this.request.documents[i];
        if (!doc.invoiceNumber?.trim()) return 'REQUESTS.VALIDATION.DOC_NUMBER_REQUIRED';
        if (!doc.issuedBy?.trim()) return 'REQUESTS.VALIDATION.ISSUER_REQUIRED';
        if (!doc.issuedOn) return 'REQUESTS.VALIDATION.ISSUE_DATE_REQUIRED';
        if (doc.grossAmount <= 0) return 'REQUESTS.VALIDATION.AMOUNT_GREATER_ZERO';
        if (this.request.requestType === 'INVOICE_TO_PAY' && !doc.bankAccountDetails?.trim()) {
          return 'REQUESTS.VALIDATION.SELLER_BANK_REQUIRED';
        }
      }
    } else if (this.request.requestType === 'ADVANCE_PAYMENT') {
      if (!this.request.requestedAmountPLN || this.request.requestedAmountPLN <= 0) {
        return 'REQUESTS.VALIDATION.ADVANCE_AMOUNT_REQUIRED';
      }
      if (!this.request.explanationAndBudget?.trim()) {
        return 'REQUESTS.VALIDATION.EXPLANATION_REQUIRED';
      }
    } else if (this.request.requestType === 'DELEGATION_SETTLEMENT') {
      if (!this.request.totalGrossAmount || this.request.totalGrossAmount <= 0) {
        return 'REQUESTS.VALIDATION.DELEGATION_AMOUNT_REQUIRED';
      }
    }

    return null;
  }

  public goBack(): void {
    this.router.navigate(['/t/requests/my-requests']);
  }

  private async showToast(messageKey: string, color: string): Promise<void> {
    const msg = this.translate.instant(messageKey);
    const toast = await this.toastCtrl.create({
      message: msg && msg !== messageKey ? msg : messageKey,
      duration: 3500,
      position: 'bottom',
      color
    });
    await toast.present();
  }
}
