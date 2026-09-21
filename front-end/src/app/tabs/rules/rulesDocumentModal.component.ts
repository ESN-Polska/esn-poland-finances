import { Component, Input, OnInit } from '@angular/core';
import { AlertController, ModalController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';

@Component({
  selector: 'app-rules-document-modal',
  template: `
    <ion-header>
      <ion-toolbar color="ideaToolbar">
        <ion-buttons slot="start">
          <ion-button [title]="'COMMON.CLOSE' | translate" (click)="close()">
            <ion-icon name="close-circle-outline" slot="icon-only"></ion-icon>
          </ion-button>
        </ion-buttons>
        <ion-title>{{ 'RULES.UPDATE_DOCUMENT_REVISION' | translate }}</ion-title>
        <ion-buttons slot="end">
          <ion-button [title]="'COMMON.SAVE' | translate" [disabled]="!isValid" (click)="save()">
            <ion-icon name="checkmark-circle-outline" slot="icon-only"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <div class="maxWidthContainer">
        <ion-list class="aList">
          <!-- Document File Picker -->
          <ion-list-header>
            <ion-label>
              <h2>{{ 'RULES.DOCUMENT_FILE' | translate }}</h2>
              <p>{{ 'RULES.DOCUMENT_FILE_I' | translate }}</p>
            </ion-label>
          </ion-list-header>

          <input
            type="file"
            #fileInput
            (change)="onFileSelected($event)"
            accept="application/pdf,.pdf"
            style="display: none"
          />

          <ion-item class="filePickerItem" (click)="fileInput.click()">
            <ion-icon name="cloud-upload-outline" slot="start" color="primary"></ion-icon>
            <ion-label *ngIf="!selectedFile">
              <h3>{{ 'RULES.CHOOSE_NEW_DOCUMENT' | translate }}</h3>
              <p>{{ 'RULES.SUPPORTED_FORMATS' | translate }}</p>
            </ion-label>
            <ion-label *ngIf="selectedFile">
              <h3>{{ selectedFile.name }}</h3>
              <p>{{ formatFileSize(selectedFile.size) }}</p>
            </ion-label>
            <ion-button slot="end" fill="outline" size="small">
              {{ (selectedFile ? 'COMMON.EDIT' : 'COMMON.ADD') | translate }}
            </ion-button>
          </ion-item>

          <!-- Resolution / Revision Details -->
          <ion-list-header>
            <ion-label>
              <h2>{{ 'RULES.REVISION_DETAILS' | translate }}</h2>
              <p>{{ 'RULES.REVISION_DETAILS_I' | translate }}</p>
            </ion-label>
          </ion-list-header>

          <ion-item>
            <ion-label position="stacked">{{ 'RULES.RESOLUTION_NUMBER' | translate }}</ion-label>
            <ion-input
              [(ngModel)]="resolutionNumber"
              [placeholder]="'RULES.RESOLUTION_NUMBER_PLACEHOLDER' | translate"
            ></ion-input>
          </ion-item>

          <ion-item>
            <ion-label position="stacked">{{ 'RULES.RESOLUTION_DATE' | translate }}</ion-label>
            <ion-input
              type="date"
              [(ngModel)]="revisionDate"
            ></ion-input>
          </ion-item>

          <!-- Live Preview -->
          <ion-list-header *ngIf="previewText">
            <ion-label>
              <h2>{{ 'RULES.PREVIEW' | translate }}</h2>
            </ion-label>
          </ion-list-header>

          <ion-item *ngIf="previewText" class="previewItem">
            <ion-label class="ion-text-wrap">
              <em>{{ previewText }}</em>
            </ion-label>
          </ion-item>
        </ion-list>
      </div>
    </ion-content>
  `,
  styles: [
    `
      .maxWidthContainer {
        max-width: 680px;
        margin: 0 auto;
      }
      .filePickerItem {
        cursor: pointer;
        --padding-start: 16px;
        --inner-padding-end: 16px;
        margin-bottom: 16px;
        border: 2px dashed var(--ion-color-step-300, #ccc);
        border-radius: 8px;
      }
      ion-item {
        --padding-start: 16px;
        --inner-padding-end: 16px;
        margin-bottom: 12px;
      }
      .previewItem {
        background: var(--ion-color-step-50, #f9f9f9);
        border-radius: 8px;
      }
    `
  ]
})
export class RulesDocumentModalComponent implements OnInit {
  @Input() currentResolutionNumber?: string;
  @Input() currentRevisionDate?: string;

  selectedFile: File | null = null;
  resolutionNumber = '';
  revisionDate = '';

  get isValid(): boolean {
    return (
      !!this.selectedFile &&
      !!this.resolutionNumber.trim() &&
      !!this.revisionDate
    );
  }

  get previewText(): string {
    const num = this.resolutionNumber.trim() || 'XX/XX';
    const formattedDate = this.formatDate(this.revisionDate);
    return this.translate.instant('RULES.REVISION_NOTICE', {
      number: num,
      date: formattedDate
    });
  }

  constructor(
    private modalCtrl: ModalController,
    private alertCtrl: AlertController,
    private translate: TranslateService
  ) {}

  ngOnInit(): void {
    this.resolutionNumber = this.currentResolutionNumber || '';
    this.revisionDate = this.currentRevisionDate || new Date().toISOString().split('T')[0];
  }

  async onFileSelected(event: any): Promise<void> {
    const file = event.target?.files?.[0];
    if (!file) return;

    const isPdf =
      file.type === 'application/pdf' ||
      file.name.toLowerCase().endsWith('.pdf');

    if (!isPdf) {
      const alert = await this.alertCtrl.create({
        header: this.translate.instant('COMMON.OPERATION_FAILED'),
        message: this.translate.instant('RULES.ONLY_PDF_ALLOWED'),
        buttons: [{ text: this.translate.instant('COMMON.CONFIRM'), role: 'cancel' }]
      });
      await alert.present();
      event.target.value = '';
      return;
    }

    this.selectedFile = file;
  }

  formatFileSize(bytes: number): string {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  formatDate(isoDate: string): string {
    if (!isoDate) return '';
    try {
      const [year, month, day] = isoDate.split('-');
      if (year && month && day) {
        return `${day}.${month}.${year}`;
      }
      return new Date(isoDate).toLocaleDateString(
        this.translate.currentLang === 'pl' ? 'pl-PL' : 'en-GB'
      );
    } catch {
      return isoDate;
    }
  }

  close(): void {
    this.modalCtrl.dismiss();
  }

  save(): void {
    if (!this.isValid) return;

    this.modalCtrl.dismiss({
      file: this.selectedFile,
      resolutionNumber: this.resolutionNumber.trim(),
      revisionDate: this.revisionDate
    });
  }
}
