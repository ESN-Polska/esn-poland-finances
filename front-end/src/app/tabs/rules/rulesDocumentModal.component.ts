import { Component, Input, OnInit } from '@angular/core';
import { AlertController, ModalController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { LocalizedText } from '@models/configurations.model';
import { AppService } from '@app/app.service';

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
          <!-- English Document File Picker -->
          <ng-container *ngIf="app.isLanguageAvailable('en')">
            <ion-list-header>
              <ion-label>
                <h2>{{ 'RULES.DOCUMENT_FILE_EN' | translate }}</h2>
                <p>{{ 'RULES.DOCUMENT_FILE_EN_I' | translate }}</p>
              </ion-label>
            </ion-list-header>

            <input
              type="file"
              #fileInputEn
              (change)="onFileSelected($event, 'en')"
              accept="application/pdf,.pdf"
              style="display: none"
            />

            <ion-item class="filePickerItem" (click)="fileInputEn.click()">
              <ion-icon
                [name]="selectedFileEn || currentFileEn ? 'document-text-outline' : 'cloud-upload-outline'"
                slot="start"
                [color]="selectedFileEn ? 'success' : (currentFileEn ? 'primary' : 'medium')"
              ></ion-icon>

              <ion-label *ngIf="!selectedFileEn && !currentFileEn">
                <h3>{{ 'RULES.CHOOSE_NEW_DOCUMENT_EN' | translate }}</h3>
                <p>{{ 'RULES.SUPPORTED_FORMATS' | translate }}</p>
              </ion-label>

              <ion-label *ngIf="!selectedFileEn && currentFileEn">
                <h3>{{ 'RULES.CURRENT_DOCUMENT_EN' | translate }}</h3>
                <p>{{ 'RULES.ALREADY_UPLOADED' | translate }}</p>
              </ion-label>

              <ion-label *ngIf="selectedFileEn">
                <h3>{{ selectedFileEn.name }}</h3>
                <p>{{ formatFileSize(selectedFileEn.size) }}</p>
              </ion-label>

              <div slot="end" class="fileActions">
                <ion-button
                  *ngIf="!selectedFileEn && currentFileEn"
                  fill="clear"
                  size="small"
                  (click)="viewCurrentDocument(currentFileEn, $event)"
                  [title]="'RULES.VIEW_CURRENT_DOCUMENT' | translate"
                >
                  <ion-icon name="eye-outline" slot="icon-only"></ion-icon>
                </ion-button>

                <ion-button
                  *ngIf="selectedFileEn"
                  fill="clear"
                  color="danger"
                  size="small"
                  (click)="removeSelectedFile('en', $event)"
                  [title]="'RULES.REMOVE_FILE' | translate"
                >
                  <ion-icon name="close-circle-outline" slot="icon-only"></ion-icon>
                </ion-button>

                <ion-button fill="outline" size="small">
                  {{ (selectedFileEn || currentFileEn ? 'COMMON.EDIT' : 'COMMON.ADD') | translate }}
                </ion-button>
              </div>
            </ion-item>
          </ng-container>

          <!-- Polish Document File Picker -->
          <ng-container *ngIf="app.isLanguageAvailable('pl')">
            <ion-list-header>
              <ion-label>
                <h2>{{ 'RULES.DOCUMENT_FILE_PL' | translate }}</h2>
                <p>{{ 'RULES.DOCUMENT_FILE_PL_I' | translate }}</p>
              </ion-label>
            </ion-list-header>

            <input
              type="file"
              #fileInputPl
              (change)="onFileSelected($event, 'pl')"
              accept="application/pdf,.pdf"
              style="display: none"
            />

            <ion-item class="filePickerItem" (click)="fileInputPl.click()">
              <ion-icon
                [name]="selectedFilePl || currentFilePl ? 'document-text-outline' : 'cloud-upload-outline'"
                slot="start"
                [color]="selectedFilePl ? 'success' : (currentFilePl ? 'primary' : 'medium')"
              ></ion-icon>

              <ion-label *ngIf="!selectedFilePl && !currentFilePl">
                <h3>{{ 'RULES.CHOOSE_NEW_DOCUMENT_PL' | translate }}</h3>
                <p>{{ 'RULES.SUPPORTED_FORMATS' | translate }}</p>
              </ion-label>

              <ion-label *ngIf="!selectedFilePl && currentFilePl">
                <h3>{{ 'RULES.CURRENT_DOCUMENT_PL' | translate }}</h3>
                <p>{{ 'RULES.ALREADY_UPLOADED' | translate }}</p>
              </ion-label>

              <ion-label *ngIf="selectedFilePl">
                <h3>{{ selectedFilePl.name }}</h3>
                <p>{{ formatFileSize(selectedFilePl.size) }}</p>
              </ion-label>

              <div slot="end" class="fileActions">
                <ion-button
                  *ngIf="!selectedFilePl && currentFilePl"
                  fill="clear"
                  size="small"
                  (click)="viewCurrentDocument(currentFilePl, $event)"
                  [title]="'RULES.VIEW_CURRENT_DOCUMENT' | translate"
                >
                  <ion-icon name="eye-outline" slot="icon-only"></ion-icon>
                </ion-button>

                <ion-button
                  *ngIf="selectedFilePl"
                  fill="clear"
                  color="danger"
                  size="small"
                  (click)="removeSelectedFile('pl', $event)"
                  [title]="'RULES.REMOVE_FILE' | translate"
                >
                  <ion-icon name="close-circle-outline" slot="icon-only"></ion-icon>
                </ion-button>

                <ion-button fill="outline" size="small">
                  {{ (selectedFilePl || currentFilePl ? 'COMMON.EDIT' : 'COMMON.ADD') | translate }}
                </ion-button>
              </div>
            </ion-item>
          </ng-container>

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
        transition: border-color 0.2s ease, background 0.2s ease;
      }
      .filePickerItem:hover {
        border-color: var(--ion-color-primary, #00aeef);
      }
      .fileActions {
        display: flex;
        align-items: center;
        gap: 6px;
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
  @Input() currentRulesFileURL?: LocalizedText | string;

  selectedFilePl: File | null = null;
  selectedFileEn: File | null = null;
  currentFilePl = '';
  currentFileEn = '';
  resolutionNumber = '';
  revisionDate = '';

  get isValid(): boolean {
    const hasAtLeastOneDoc =
      !!this.selectedFilePl ||
      !!this.selectedFileEn ||
      !!this.currentFilePl ||
      !!this.currentFileEn;

    return (
      hasAtLeastOneDoc &&
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
    private translate: TranslateService,
    public app: AppService
  ) {}

  ngOnInit(): void {
    this.resolutionNumber = this.currentResolutionNumber || '';
    this.revisionDate = this.currentRevisionDate || new Date().toISOString().split('T')[0];

    if (typeof this.currentRulesFileURL === 'string') {
      this.currentFilePl = this.currentRulesFileURL;
      this.currentFileEn = this.currentRulesFileURL;
    } else if (this.currentRulesFileURL) {
      this.currentFilePl = this.currentRulesFileURL.pl || '';
      this.currentFileEn = this.currentRulesFileURL.en || '';
    }
  }

  async onFileSelected(event: any, lang: 'pl' | 'en'): Promise<void> {
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

    if (lang === 'pl') {
      this.selectedFilePl = file;
    } else {
      this.selectedFileEn = file;
    }
  }

  removeSelectedFile(lang: 'pl' | 'en', event?: Event): void {
    if (event) {
      event.stopPropagation();
    }
    if (lang === 'pl') {
      this.selectedFilePl = null;
    } else {
      this.selectedFileEn = null;
    }
  }

  viewCurrentDocument(url: string, event?: Event): void {
    if (event) {
      event.stopPropagation();
    }
    if (url) {
      window.open(url, '_blank');
    }
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
      filePl: this.selectedFilePl,
      fileEn: this.selectedFileEn,
      resolutionNumber: this.resolutionNumber.trim(),
      revisionDate: this.revisionDate
    });
  }
}
