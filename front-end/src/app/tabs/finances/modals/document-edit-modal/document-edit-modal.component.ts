import { Component, Input, OnInit, inject } from '@angular/core';
import { ModalController, ToastController, LoadingController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { DocumentRecord, AccountingDocumentType, DocumentPaymentOrigin, DocumentCodeAllocation, DocumentLinkedTransaction } from '@models/accounting-document.model';
import { BankTransactionRecord } from '@models/cashflow-transaction.model';
import { AdvanceRecord } from '@models/subledgers.model';
import { FinancesService } from '../../../../services/finances.service';
import { MediaService } from '../../../../common/media.service';

@Component({
  selector: 'app-document-edit-modal',
  templateUrl: './document-edit-modal.component.html',
  styleUrls: ['./document-edit-modal.component.scss']
})
export class DocumentEditModalComponent implements OnInit {
  private modalCtrl = inject(ModalController);
  private toastCtrl = inject(ToastController);
  private loadingCtrl = inject(LoadingController);
  private financesService = inject(FinancesService);
  private mediaService = inject(MediaService);
  private translate = inject(TranslateService);

  @Input() document?: DocumentRecord;
  @Input() year: number = new Date().getFullYear();
  @Input() canEdit: boolean = true;

  public isNew: boolean = true;
  public loading: boolean = false;
  public isUploading: boolean = false;

  // Form Model
  public docType: AccountingDocumentType = 'COST';
  public invoiceNumber: string = '';
  public ksefNumber: string = '';
  public issuedBy: string = '';
  public issuedByTaxId: string = '';
  public issuedOn: string = new Date().toISOString().substring(0, 10);
  public saleDate: string = '';
  public paymentDeadline: string = '';
  public currency: 'PLN' | 'EUR' = 'PLN';

  public grossAmount: number = 0;
  public netAmount: number = 0;
  public vatAmount: number = 0;

  public paymentOrigin: DocumentPaymentOrigin = 'TRANSACTIONS';
  public linkedAdvanceId?: string;
  public linkedAdvanceAmount?: number;

  public linkedTransactions: DocumentLinkedTransaction[] = [];
  public codeAllocations: Partial<DocumentCodeAllocation>[] = [];

  public notes: string = '';
  public attachments: any[] = [];

  // Available data for linking
  public availableAdvances: AdvanceRecord[] = [];
  public availableTransactions: BankTransactionRecord[] = [];
  public selectedTxIdToAdd: string = '';

  ngOnInit(): void {
    if (this.document) {
      this.isNew = false;
      this.docType = this.document.documentType || 'COST';
      this.invoiceNumber = this.document.invoiceNumber || '';
      this.ksefNumber = this.document.ksefNumber || '';
      this.issuedBy = this.document.issuedBy || '';
      this.issuedByTaxId = this.document.issuedByTaxId || '';
      this.issuedOn = (this.document.issuedOn || '').substring(0, 10) || new Date().toISOString().substring(0, 10);
      this.saleDate = (this.document.saleDate || '').substring(0, 10);
      this.paymentDeadline = (this.document.paymentDeadline || '').substring(0, 10);
      this.currency = this.document.currency || 'PLN';

      this.grossAmount = this.document.grossAmount || 0;
      this.netAmount = this.document.netAmount || 0;
      this.vatAmount = this.document.vatAmount || 0;

      this.paymentOrigin = this.document.paymentOrigin || 'TRANSACTIONS';
      this.linkedAdvanceId = this.document.linkedAdvanceId || this.document.advanceId;
      this.linkedAdvanceAmount = this.document.linkedAdvanceAmount;

      this.linkedTransactions = (this.document.linkedTransactions || []).map((t) => ({ ...t }));
      this.codeAllocations = (this.document.codeAllocations || []).map((a) => ({ ...a }));
      this.notes = this.document.notes || '';
      this.attachments = (this.document.attachments || []).map((att) => ({ ...att }));
    } else {
      this.isNew = true;
      this.codeAllocations = [
        { code: '', allocatedGrossAmount: 0 }
      ];
    }

    this.loadPrerequisites();
  }

  private async loadPrerequisites(): Promise<void> {
    this.loading = true;
    try {
      const [advances, transactions] = await Promise.all([
        this.financesService.getAdvances(this.year).catch(() => []),
        this.financesService.getTransactions(this.year).catch(() => [])
      ]);
      // Only unsettled advances, plus currently selected advance if editing
      this.availableAdvances = advances.filter(
        (a) => !a.isSettled || a.id === this.linkedAdvanceId
      );
      this.availableTransactions = transactions;
    } finally {
      this.loading = false;
    }
  }

  // Auto calculate VAT or Gross if user changes Net
  public onNetAmountChange(): void {
    if (this.grossAmount <= 0 && this.netAmount > 0) {
      this.vatAmount = Math.round(this.netAmount * 0.23 * 100) / 100;
      this.grossAmount = Math.round((this.netAmount + this.vatAmount) * 100) / 100;
      this.syncSingleAllocationAmount();
    }
  }

  public onGrossAmountChange(): void {
    if (this.netAmount <= 0 && this.grossAmount > 0) {
      this.netAmount = Math.round((this.grossAmount / 1.23) * 100) / 100;
      this.vatAmount = Math.round((this.grossAmount - this.netAmount) * 100) / 100;
    }
    this.syncSingleAllocationAmount();
  }

  private syncSingleAllocationAmount(): void {
    if (this.codeAllocations.length === 1 && (!this.codeAllocations[0].allocatedGrossAmount || this.codeAllocations[0].allocatedGrossAmount === 0)) {
      this.codeAllocations[0].allocatedGrossAmount = this.grossAmount;
    }
  }

  // Allocations helpers
  public addAllocationRow(): void {
    const remaining = Math.max(0, this.grossAmount - this.totalAllocatedAmount);
    this.codeAllocations.push({
      code: '',
      allocatedGrossAmount: remaining
    });
  }

  public removeAllocationRow(index: number): void {
    this.codeAllocations.splice(index, 1);
  }

  public get totalAllocatedAmount(): number {
    return this.codeAllocations.reduce((sum, a) => sum + (Number(a.allocatedGrossAmount || a.amount) || 0), 0);
  }

  public get allocationDelta(): number {
    return Math.round((this.grossAmount - this.totalAllocatedAmount) * 100) / 100;
  }

  // Linked transactions helpers
  public addLinkedTransaction(): void {
    if (!this.selectedTxIdToAdd) return;
    const tx = this.availableTransactions.find((t) => t.id === this.selectedTxIdToAdd);
    if (!tx) return;

    if (this.linkedTransactions.some((lt) => lt.txId === tx.id)) return;

    const remainingToPay = Math.max(0, this.grossAmount - this.totalPaidAmount);
    const defaultAllocation = Math.min(Math.abs(tx.amount), remainingToPay || Math.abs(tx.amount));

    this.linkedTransactions.push({
      txId: tx.id,
      date: tx.bookingDate || tx.operationDate,
      counterparty: tx.partyName || (tx as any).counterparty,
      transferTitle: tx.transferTitle,
      amount: defaultAllocation
    });

    this.selectedTxIdToAdd = '';
  }

  public removeLinkedTransaction(index: number): void {
    this.linkedTransactions.splice(index, 1);
  }

  public get totalPaidAmount(): number {
    if (this.paymentOrigin === 'ADVANCE') {
      return this.linkedAdvanceAmount ?? this.grossAmount;
    }
    return this.linkedTransactions.reduce((sum, lt) => sum + (Number(lt.amount) || 0), 0);
  }

  public get calculatedStatus(): 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' {
    if (this.paymentOrigin === 'ADVANCE' && this.linkedAdvanceId) {
      return 'PAID';
    }
    const paid = this.totalPaidAmount;
    if (paid >= this.grossAmount && this.grossAmount > 0) {
      return 'PAID';
    }
    if (paid > 0) {
      return 'PARTIALLY_PAID';
    }
    return 'UNPAID';
  }

  // Attachments upload
  public async onFileSelected(event: any): Promise<void> {
    const file = event.target?.files?.[0];
    if (!file) return;

    this.isUploading = true;
    try {
      const uploadRes = await this.mediaService.uploadDocument(file);
      this.attachments.push({
        fileId: uploadRes.id,
        fileName: file.name,
        name: file.name,
        fileSize: file.size,
        contentType: file.type || 'application/pdf',
        url: uploadRes.url,
        s3Key: uploadRes.s3Key,
        uploadedAt: new Date().toISOString()
      });
      const toast = await this.toastCtrl.create({
        message: this.translate.instant('FINANCES.DOCUMENTS.UPLOAD_SUCCESS'),
        duration: 2000,
        color: 'success'
      });
      await toast.present();
    } catch (err: any) {
      const toast = await this.toastCtrl.create({
        message: err?.message || this.translate.instant('FINANCES.DOCUMENTS.UPLOAD_ERROR'),
        duration: 4000,
        color: 'danger'
      });
      await toast.present();
    } finally {
      this.isUploading = false;
      event.target.value = '';
    }
  }

  public removeAttachment(index: number): void {
    this.attachments.splice(index, 1);
  }

  // Submit
  public async save(): Promise<void> {
    if (!this.invoiceNumber.trim() && !this.ksefNumber.trim()) {
      const toast = await this.toastCtrl.create({
        message: this.translate.instant('FINANCES.DOCUMENTS.VALIDATION_DOC_NUM'),
        duration: 3000,
        color: 'warning'
      });
      await toast.present();
      return;
    }

    if (this.grossAmount <= 0) {
      const toast = await this.toastCtrl.create({
        message: this.translate.instant('FINANCES.DOCUMENTS.VALIDATION_AMOUNT'),
        duration: 3000,
        color: 'warning'
      });
      await toast.present();
      return;
    }

    const docData: any = this.document ? { ...this.document } : {};
    docData.year = this.year;
    docData.documentType = this.docType;
    docData.invoiceNumber = this.invoiceNumber.trim();
    docData.ksefNumber = this.ksefNumber.trim();
    docData.issuedBy = this.issuedBy.trim();
    docData.issuedByTaxId = this.issuedByTaxId.trim();
    docData.issuedOn = this.issuedOn;
    docData.saleDate = this.saleDate || this.issuedOn;
    docData.paymentDeadline = this.paymentDeadline || undefined;
    docData.currency = this.currency;

    docData.grossAmount = Number(this.grossAmount) || 0;
    docData.netAmount = Number(this.netAmount) || 0;
    docData.vatAmount = Number(this.vatAmount) || 0;

    docData.paymentOrigin = this.paymentOrigin;
    if (this.paymentOrigin === 'ADVANCE') {
      docData.advanceId = this.linkedAdvanceId;
      docData.linkedAdvanceId = this.linkedAdvanceId;
      docData.linkedAdvanceAmount = Number(this.linkedAdvanceAmount) || docData.grossAmount;
      docData.linkedTransactions = [];
      docData.paidAmount = docData.grossAmount;
      docData.isPaid = true;
      docData.status = 'SETTLED';
    } else {
      docData.advanceId = undefined;
      docData.linkedAdvanceId = undefined;
      docData.linkedAdvanceAmount = undefined;
      docData.linkedTransactions = this.linkedTransactions.map((lt) => ({
        txId: lt.txId,
        date: lt.date,
        counterparty: lt.counterparty,
        transferTitle: lt.transferTitle,
        amount: Number(lt.amount) || 0
      }));
      docData.paidAmount = this.totalPaidAmount;
      docData.isPaid = docData.paidAmount >= docData.grossAmount;
      docData.status = docData.isPaid ? 'SETTLED' : (docData.paidAmount > 0 ? 'PARTIALLY_PAID' : 'UNPAID');
    }

    docData.codeAllocations = this.codeAllocations
      .filter((a) => !!a.code)
      .map((a) => ({
        id: a.id || `alloc_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        code: a.code,
        linkedCode: a.code,
        linkedCodeType: 'BUDGET_LINE',
        amount: Number(a.allocatedGrossAmount || a.amount) || 0,
        allocatedGrossAmount: Number(a.allocatedGrossAmount || a.amount) || 0,
        allocatedNetAmount: Number(a.allocatedGrossAmount || a.amount) || 0,
        allocatedVatAmount: 0,
        description: a.description
      }));

    docData.notes = this.notes.trim();
    docData.attachments = this.attachments;

    const loading = await this.loadingCtrl.create({
      message: this.translate.instant('FINANCES.DOCUMENTS.SAVING')
    });
    await loading.present();

    try {
      const record = new DocumentRecord(docData);
      const saved = await this.financesService.saveDocument(record);
      await loading.dismiss();
      this.modalCtrl.dismiss({ savedDocument: saved, role: 'saved' });
    } catch (err: any) {
      await loading.dismiss();
      const toast = await this.toastCtrl.create({
        message: err?.message || this.translate.instant('FINANCES.DOCUMENTS.SAVE_ERROR'),
        duration: 4000,
        color: 'danger'
      });
      await toast.present();
    }
  }

  public dismiss(): void {
    this.modalCtrl.dismiss(null, 'cancel');
  }
}
