import { Component, Input, OnInit } from '@angular/core';
import { ModalController, ToastController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { AttachmentFile, FinancialRequest } from '@models/financial-request.model';
import { BankTransactionItem } from '@app/services/requests.service';
import { MediaService } from '../../common/media.service';

@Component({
  selector: 'app-mark-paid-modal',
  template: `
    <ion-header>
      <ion-toolbar color="ideaToolbar">
        <ion-buttons slot="start">
          <ion-button [title]="'COMMON.CANCEL' | translate" (click)="close()">
            <ion-icon name="close-circle-outline" slot="icon-only"></ion-icon>
          </ion-button>
        </ion-buttons>
        <ion-title>{{ 'REQUESTS.MANAGE_PANEL.MARK_PAID_HEADER' | translate }}</ion-title>
        <ion-buttons slot="end">
          <ion-button
            [title]="'REQUESTS.STATUSES.PAID' | translate"
            [disabled]="isUploading"
            (click)="confirm()"
            color="success"
            fill="solid"
            class="confirm-btn"
          >
            <ion-spinner *ngIf="isUploading" name="crescent" class="btn-spinner"></ion-spinner>
            <ion-icon *ngIf="!isUploading" name="checkmark-done-circle-outline" slot="start"></ion-icon>
            <span *ngIf="!isUploading">{{ 'REQUESTS.STATUSES.PAID' | translate }}</span>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding modal-content-wrap">
      <div class="maxWidthContainer">
        <!-- Payout Transaction Summary Card (when paying specific transaction) -->
        <div class="summary-box" *ngIf="transaction">
          <div class="summary-row header-row">
            <span class="req-id">{{ transaction.displayId || request.displayId }}</span>
            <span class="req-amount">{{ transaction.amount | number:'1.2-2' }} {{ transaction.currency }}</span>
          </div>
          <div class="summary-divider"></div>
          <div class="summary-grid">
            <div class="grid-item" *ngIf="transaction.invoiceNumber">
              <span class="grid-label">{{ 'REQUESTS.FIELDS.INVOICE_NUMBER' | translate }}</span>
              <span class="grid-value font-medium">{{ transaction.invoiceNumber }}</span>
            </div>
            <div class="grid-item" *ngIf="transaction.ksefNumber">
              <span class="grid-label">KSeF</span>
              <span class="grid-value font-mono">{{ transaction.ksefNumber }}</span>
            </div>
            <div class="grid-item">
              <span class="grid-label">{{ 'REQUESTS.ACCOUNT_HOLDER_NAME' | translate }}</span>
              <span class="grid-value font-medium">{{ transaction.recipientName }}</span>
            </div>
            <div class="grid-item full-width" *ngIf="transaction.recipientAccount">
              <span class="grid-label">{{ 'REQUESTS.BANK_ACCOUNT_NUMBER' | translate }}</span>
              <span class="grid-value font-mono">{{ transaction.recipientAccount }}</span>
            </div>
            <div class="grid-item full-width" *ngIf="transaction.title">
              <span class="grid-label">{{ 'REQUESTS.PAYOUTS.TRANSFER_TITLE' | translate }}</span>
              <span class="grid-value font-mono">{{ transaction.title }}</span>
            </div>
          </div>
        </div>

        <!-- Request Summary Card (when no specific transaction or general mark paid) -->
        <div class="summary-box" *ngIf="!transaction">
          <div class="summary-row header-row">
            <span class="req-id">{{ request.displayId }}</span>
            <span class="req-amount">{{ amountDisplay }}</span>
          </div>
          <div class="summary-divider"></div>
          <div class="summary-grid">
            <div class="grid-item">
              <span class="grid-label">{{ 'REQUESTS.MANAGE_PANEL.APPLICANT' | translate }}</span>
              <span class="grid-value font-medium">{{ request.userDisplayName || request.userId }}</span>
            </div>
            <div class="grid-item" *ngIf="request.accountHolderName">
              <span class="grid-label">{{ 'REQUESTS.ACCOUNT_HOLDER_NAME' | translate }}</span>
              <span class="grid-value">{{ request.accountHolderName }}</span>
            </div>
            <div class="grid-item full-width" *ngIf="request.iban">
              <span class="grid-label">{{ (request.swiftBic ? 'REQUESTS.IBAN' : 'REQUESTS.BANK_ACCOUNT_NUMBER') | translate }}</span>
              <span class="grid-value font-mono">{{ request.iban }}</span>
            </div>
            <div class="grid-item full-width" *ngIf="request.swiftBic">
              <span class="grid-label">{{ 'REQUESTS.SWIFT_BIC' | translate }}</span>
              <span class="grid-value font-mono">{{ request.swiftBic }}</span>
            </div>
          </div>
        </div>

        <!-- Scope selection when multiple payouts exist for this request -->
        <div class="scope-selection-card" *ngIf="transaction && hasMultipleUnpaidPayouts">
          <div
            class="scope-option"
            [class.selected]="payoutMode === 'SINGLE'"
            (click)="payoutMode = 'SINGLE'"
          >
            <div class="scope-radio">
              <div class="radio-dot" *ngIf="payoutMode === 'SINGLE'"></div>
            </div>
            <div class="scope-info">
              <span class="scope-title">{{ 'REQUESTS.MANAGE_PANEL.MARK_SINGLE_TITLE' | translate }} ({{ transaction.amount | number:'1.2-2' }} {{ transaction.currency }})</span>
              <span class="scope-desc">{{ 'REQUESTS.MANAGE_PANEL.MARK_SINGLE_DESC' | translate }}</span>
            </div>
          </div>

          <div
            class="scope-option"
            [class.selected]="payoutMode === 'ALL'"
            (click)="payoutMode = 'ALL'"
          >
            <div class="scope-radio">
              <div class="radio-dot" *ngIf="payoutMode === 'ALL'"></div>
            </div>
            <div class="scope-info">
              <span class="scope-title">{{ 'REQUESTS.MANAGE_PANEL.MARK_ALL_TITLE' | translate }}</span>
              <span class="scope-desc">{{ 'REQUESTS.MANAGE_PANEL.MARK_ALL_DESC' | translate }}</span>
            </div>
          </div>
        </div>

        <!-- Form fields -->
        <div class="form-container">
          <!-- Optional transfer comment/note -->
          <div class="input-group">
            <ion-label class="field-label">
              {{ 'REQUESTS.MANAGE_PANEL.OPTIONAL_PAYMENT_REF' | translate }}
            </ion-label>
            <ion-textarea
              [(ngModel)]="comment"
              rows="3"
              [placeholder]="'REQUESTS.MANAGE_PANEL.OPTIONAL_PAYMENT_REF' | translate"
              class="custom-textarea"
              [disabled]="isUploading"
            ></ion-textarea>
          </div>

          <!-- Optional payment confirmation upload -->
          <div class="input-group">
            <div class="label-with-hint">
              <ion-label class="field-label">
                {{ 'REQUESTS.MANAGE_PANEL.PAYMENT_CONFIRMATION_TITLE' | translate }}
              </ion-label>
              <p class="field-hint">
                {{ 'REQUESTS.MANAGE_PANEL.PAYMENT_CONFIRMATION_HINT' | translate }}
              </p>
            </div>

            <input
              type="file"
              multiple
              #fileInput
              (change)="onFilesSelected($event)"
              accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg"
              style="display: none"
            />

            <!-- Empty state: clickable dropzone -->
            <div
              *ngIf="existingConfirmations.length === 0 && selectedFiles.length === 0"
              class="upload-dropzone"
              (click)="!isUploading && fileInput.click()"
              [class.disabled-zone]="isUploading"
            >
              <div class="dropzone-content">
                <ion-icon name="cloud-upload-outline" class="upload-icon"></ion-icon>
                <div class="upload-texts">
                  <span class="upload-main-text">{{ 'REQUESTS.MANAGE_PANEL.CHOOSE_CONFIRMATION_FILE' | translate }}</span>
                  <span class="upload-sub-text">PDF, PNG, JPG (max. 50 MB)</span>
                </div>
              </div>
            </div>

            <!-- Attached files preview (both existing and newly selected) -->
            <div *ngIf="existingConfirmations.length > 0 || selectedFiles.length > 0" class="files-list-container">
              <!-- Previously uploaded confirmations -->
              <div *ngFor="let att of existingConfirmations; let idx = index" class="file-attached-card existing-confirmation-card">
                <div class="file-icon-box" (click)="openExistingAttachment(att, $event)" [title]="'COMMON.OPEN' | translate" style="cursor: pointer;">
                  <ion-icon [name]="isPdf(att.fileName) ? 'document-text' : 'image'" class="file-type-icon"></ion-icon>
                </div>
                <div class="file-meta" (click)="openExistingAttachment(att, $event)" style="cursor: pointer;">
                  <span class="file-name" [title]="att.fileName">{{ att.fileName }}</span>
                  <div class="file-meta-sub">
                    <span class="file-size" *ngIf="att.fileSize">{{ formatFileSize(att.fileSize) }}</span>
                    <span class="file-badge existing-badge">{{ 'REQUESTS.MANAGE_PANEL.ATTACHED_CONFIRMATION' | translate }}</span>
                  </div>
                </div>
                <div class="file-actions">
                  <ion-button
                    fill="clear"
                    size="small"
                    color="primary"
                    (click)="openExistingAttachment(att, $event)"
                    [title]="'COMMON.OPEN' | translate"
                  >
                    <ion-icon name="open-outline" slot="icon-only"></ion-icon>
                  </ion-button>
                  <ion-button
                    fill="clear"
                    size="small"
                    color="danger"
                    (click)="removeExistingConfirmation(idx, $event)"
                    [disabled]="isUploading"
                    [title]="'COMMON.DELETE' | translate"
                  >
                    <ion-icon name="trash-outline" slot="icon-only"></ion-icon>
                  </ion-button>
                </div>
              </div>

              <!-- Newly selected files -->
              <div *ngFor="let file of selectedFiles; let idx = index" class="file-attached-card new-confirmation-card">
                <div class="file-icon-box">
                  <ion-icon [name]="isPdf(file.name) ? 'document-text' : 'image'" class="file-type-icon"></ion-icon>
                </div>
                <div class="file-meta">
                  <span class="file-name" [title]="file.name">{{ file.name }}</span>
                  <span class="file-size">{{ formatFileSize(file.size) }}</span>
                </div>
                <div class="file-actions">
                  <ion-button
                    fill="clear"
                    size="small"
                    color="danger"
                    (click)="removeFile(idx, $event)"
                    [disabled]="isUploading"
                    [title]="'COMMON.DELETE' | translate"
                  >
                    <ion-icon name="trash-outline" slot="icon-only"></ion-icon>
                  </ion-button>
                </div>
              </div>

              <div class="add-more-row" *ngIf="!isUploading">
                <ion-button
                  fill="outline"
                  size="small"
                  color="primary"
                  (click)="fileInput.click()"
                  class="add-more-btn"
                >
                  <ion-icon name="add-circle-outline" slot="start"></ion-icon>
                  {{ 'REQUESTS.MANAGE_PANEL.ADD_MORE_CONFIRMATIONS' | translate }}
                </ion-button>
              </div>
            </div>
          </div>
        </div>

        <!-- Uploading state banner -->
        <div class="uploading-banner" *ngIf="isUploading">
          <ion-spinner name="crescent" color="primary"></ion-spinner>
          <span>{{ 'COMMON.UPLOADING' | translate }}...</span>
        </div>
      </div>
    </ion-content>
  `,
  styles: [`
    .maxWidthContainer {
      max-width: 600px;
      margin: 0 auto;
      padding-bottom: 24px;
    }
    .confirm-btn {
      --background: #10b981;
      --color: #ffffff;
      font-weight: 600;
      border-radius: 6px;
    }
    .btn-spinner {
      width: 18px;
      height: 18px;
    }
    .summary-box {
      background: var(--ion-color-step-50, #f8fafc);
      border: 1px solid var(--ion-color-step-150, #e2e8f0);
      border-radius: 10px;
      padding: 16px;
      margin-bottom: 20px;
    }
    .header-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }
    .req-id {
      font-size: 1.15rem;
      font-weight: 700;
      color: var(--ion-color-primary, #00aeef);
    }
    .req-amount {
      font-size: 1.15rem;
      font-weight: 700;
      color: #10b981;
    }
    .summary-divider {
      height: 1px;
      background: var(--ion-color-step-150, #e2e8f0);
      margin-bottom: 12px;
    }
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px 16px;
    }
    .grid-item {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .grid-item.full-width {
      grid-column: span 2;
    }
    .grid-label {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--ion-color-step-500, #64748b);
      font-weight: 600;
    }
    .grid-value {
      font-size: 0.9rem;
      color: var(--ion-color-step-850, #1e293b);
    }
    .font-mono {
      font-family: monospace, monospace;
      letter-spacing: 0.02em;
    }
    .font-medium {
      font-weight: 500;
    }
    .form-container {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    .input-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .field-label {
      font-size: 0.92rem;
      font-weight: 600;
      color: var(--ion-color-step-850, #1e293b);
    }
    .field-hint {
      margin: 2px 0 6px 0;
      font-size: 0.8rem;
      color: var(--ion-color-step-500, #64748b);
      line-height: 1.35;
    }
    .custom-textarea {
      --background: var(--ion-color-step-50, #f8fafc);
      border: 1px solid var(--ion-color-step-200, #cbd5e1);
      border-radius: 8px;
      --padding-start: 12px;
      --padding-end: 12px;
      --padding-top: 10px;
      --padding-bottom: 10px;
      font-size: 0.92rem;
    }
    .upload-dropzone {
      display: flex;
      align-items: center;
      justify-content: center;
      border: 2px dashed var(--ion-color-step-300, #94a3b8);
      border-radius: 10px;
      padding: 24px 16px;
      background: var(--ion-color-step-50, #f8fafc);
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .upload-dropzone:hover {
      border-color: var(--ion-color-primary, #00aeef);
      background: var(--ion-color-step-100, #f1f5f9);
    }
    .upload-dropzone.disabled-zone {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .dropzone-content {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      text-align: center;
    }
    .upload-icon {
      font-size: 2.2rem;
      color: var(--ion-color-primary, #00aeef);
    }
    .upload-texts {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .upload-main-text {
      font-size: 0.92rem;
      font-weight: 600;
      color: var(--ion-color-step-800, #334155);
    }
    .upload-sub-text {
      font-size: 0.78rem;
      color: var(--ion-color-step-500, #64748b);
    }
    .file-attached-card {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 14px;
      background: var(--ion-color-step-50, #f8fafc);
      border: 1px solid #10b981;
      border-radius: 8px;
    }
    .file-icon-box {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      border-radius: 8px;
      background: #ecfdf5;
      color: #059669;
      font-size: 1.4rem;
      flex-shrink: 0;
    }
    .file-meta {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-width: 0;
    }
    .file-name {
      font-size: 0.88rem;
      font-weight: 600;
      color: var(--ion-color-step-850, #1e293b);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .file-size {
      font-size: 0.76rem;
      color: var(--ion-color-step-500, #64748b);
      margin-top: 1px;
    }
    .file-meta-sub {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 2px;
    }
    .file-badge {
      display: inline-block;
      font-size: 0.68rem;
      font-weight: 600;
      padding: 1px 6px;
      border-radius: 4px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    .existing-badge {
      background: rgba(16, 185, 129, 0.12);
      color: #059669;
    }
    .file-actions {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
    }
    .files-list-container {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .add-more-row {
      display: flex;
      justify-content: flex-end;
      margin-top: 4px;
    }
    .add-more-btn {
      --border-radius: 6px;
      font-size: 0.84rem;
      font-weight: 500;
    }
    .scope-selection-card {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-bottom: 20px;
    }
    .scope-option {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 12px 14px;
      border: 1px solid var(--ion-color-step-200, #cbd5e1);
      border-radius: 8px;
      background: var(--ion-color-step-50, #f8fafc);
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .scope-option:hover {
      border-color: var(--ion-color-primary, #00aeef);
      background: var(--ion-color-step-100, #f1f5f9);
    }
    .scope-option.selected {
      border-color: var(--ion-color-primary, #00aeef);
      background: rgba(var(--ion-color-primary-rgb, 0, 174, 239), 0.08);
    }
    .scope-radio {
      width: 18px;
      height: 18px;
      border-radius: 50%;
      border: 2px solid var(--ion-color-step-400, #94a3b8);
      display: flex;
      align-items: center;
      justify-content: center;
      margin-top: 2px;
      flex-shrink: 0;
    }
    .scope-option.selected .scope-radio {
      border-color: var(--ion-color-primary, #00aeef);
    }
    .radio-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--ion-color-primary, #00aeef);
    }
    .scope-info {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .scope-title {
      font-size: 0.9rem;
      font-weight: 600;
      color: var(--ion-color-step-850, #1e293b);
    }
    .scope-desc {
      font-size: 0.8rem;
      color: var(--ion-color-step-500, #64748b);
      line-height: 1.35;
    }
    .uploading-banner {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      margin-top: 16px;
      padding: 12px;
      background: var(--ion-color-step-50, #f8fafc);
      border-radius: 8px;
      font-size: 0.88rem;
      font-weight: 500;
      color: var(--ion-color-primary, #00aeef);
    }
  `]
})
export class MarkPaidModalComponent implements OnInit {
  @Input() request!: FinancialRequest;
  @Input() transaction?: BankTransactionItem;

  public payoutMode: 'SINGLE' | 'ALL' = 'SINGLE';
  public comment = '';
  public existingConfirmations: AttachmentFile[] = [];
  public selectedFiles: File[] = [];
  public isUploading = false;

  constructor(
    private modalCtrl: ModalController,
    private toastCtrl: ToastController,
    private translate: TranslateService,
    private mediaService: MediaService
  ) {}

  ngOnInit(): void {
    if (this.transaction) {
      this.payoutMode = 'SINGLE';
    } else {
      this.payoutMode = 'ALL';
    }

    const confirmations = Array.isArray(this.request?.paymentConfirmationAttachments) && this.request.paymentConfirmationAttachments.length > 0
      ? [...this.request.paymentConfirmationAttachments]
      : (this.request?.paymentConfirmationAttachment ? [this.request.paymentConfirmationAttachment] : []);
    this.existingConfirmations = confirmations;
  }

  public get hasMultipleUnpaidPayouts(): boolean {
    if (!this.request?.documents || this.request.documents.length <= 1) return false;
    const unpaid = this.request.documents.filter(d => !d.payoutPaidOn);
    return unpaid.length > 1;
  }

  public get amountDisplay(): string {
    if (!this.request) return '';
    return this.request.isMixedCurrency?.()
      ? `${this.request.getGrossAmountPLN()} PLN + ${this.request.getGrossAmountEUR()} EUR`
      : `${this.request.totalGrossAmount} ${this.request.currency}`;
  }

  public onFilesSelected(event: any): void {
    const files: FileList = event?.target?.files;
    if (!files || files.length === 0) return;

    const maxSize = 50 * 1024 * 1024;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.size > maxSize) {
        this.showToast('REQUESTS.FILE_TOO_LARGE', 'warning');
        continue;
      }
      if (
        !this.selectedFiles.some(f => f.name === file.name && f.size === file.size) &&
        !this.existingConfirmations.some(e => e.fileName === file.name && e.fileSize === file.size)
      ) {
        this.selectedFiles.push(file);
      }
    }
    if (event.target) event.target.value = '';
  }

  public removeFile(index: number, event: Event): void {
    event.stopPropagation();
    if (index >= 0 && index < this.selectedFiles.length) {
      this.selectedFiles.splice(index, 1);
    }
  }

  public removeExistingConfirmation(index: number, event: Event): void {
    event.stopPropagation();
    if (index >= 0 && index < this.existingConfirmations.length) {
      this.existingConfirmations.splice(index, 1);
    }
  }

  public openExistingAttachment(att: AttachmentFile, event?: Event): void {
    if (event) event.stopPropagation();
    if (!att) return;
    if (att.url) {
      window.open(att.url, '_blank', 'noopener,noreferrer');
      return;
    }
    if (att.s3Key) {
      const url = `https://media.finances.esn-poland.link/${att.s3Key.replace(/^\/+/, '')}`;
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  public isPdf(filename: string): boolean {
    return filename?.toLowerCase().endsWith('.pdf');
  }

  public formatFileSize(bytes: number): string {
    if (!bytes || bytes <= 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  public close(): void {
    this.modalCtrl.dismiss(null, 'cancel');
  }

  public async confirm(): Promise<void> {
    if (this.isUploading) return;

    const uploadedAttachments: AttachmentFile[] = [];

    if (this.selectedFiles.length > 0) {
      this.isUploading = true;
      try {
        const uploadPromises = this.selectedFiles.map(async (file) => {
          const uploadRes = await this.mediaService.uploadDocument(file);
          return {
            fileId: uploadRes.id,
            fileName: file.name,
            fileSize: file.size,
            contentType: file.type || 'application/pdf',
            s3Key: uploadRes.s3Key,
            url: uploadRes.url,
            uploadedAt: new Date().toISOString()
          } as AttachmentFile;
        });

        const results = await Promise.all(uploadPromises);
        uploadedAttachments.push(...results);
      } catch (err: any) {
        this.isUploading = false;
        this.showToast(err.message || 'Upload failed', 'danger');
        return;
      }
      this.isUploading = false;
    }

    const allAttachments: AttachmentFile[] = [
      ...this.existingConfirmations,
      ...uploadedAttachments
    ];

    await this.modalCtrl.dismiss(
      {
        mode: this.payoutMode,
        comment: this.comment.trim(),
        paymentConfirmationAttachment: allAttachments[0] || undefined,
        paymentConfirmationAttachments: allAttachments,
        transaction: this.transaction
      },
      'confirm'
    );
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
