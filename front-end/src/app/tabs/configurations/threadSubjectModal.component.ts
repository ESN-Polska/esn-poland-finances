import { Component, Input, OnInit } from '@angular/core';
import { AlertController, ModalController, ToastController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { DEFAULT_CONFIGURATIONS, LocalizedText } from '@models/configurations.model';
import { AppService } from '@app/app.service';

@Component({
  selector: 'app-thread-subject-modal',
  template: `
    <ion-header>
      <ion-toolbar color="ideaToolbar">
        <ion-buttons slot="start">
          <ion-button [title]="'COMMON.CLOSE' | translate" (click)="close()">
            <ion-icon name="close-circle-outline" slot="icon-only"></ion-icon>
          </ion-button>
        </ion-buttons>
        <ion-title>{{ 'CONFIGURATIONS.THREAD_SUBJECT_TITLE' | translate }}</ion-title>
        <ion-buttons slot="end">
          <ion-button [title]="'COMMON.SAVE' | translate" (click)="save()" color="primary">
            <ion-icon name="checkmark-circle-outline" slot="icon-only"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="templateModalContent">
      <div class="maxWidthContainer ion-padding">
        <p class="modalIntroText">{{ 'CONFIGURATIONS.THREAD_SUBJECT_DESC' | translate }}</p>

        <ion-list class="aList">
          <ion-list-header>
            <ion-label>
              <h2>{{ 'EMAIL_TEMPLATE.VARIABLES_ALLOWED' | translate }}</h2>
              <p>{{ 'EMAIL_TEMPLATE.VARIABLES_DESC' | translate }}</p>
            </ion-label>
          </ion-list-header>

          <!-- Allowed Variables Info (matching emailTemplate component) -->
          <div class="variablesList">
            <div
              class="variableChip"
              (click)="copyVariable('requestId')"
              [title]="'COMMON.COPY' | translate"
              role="button"
              tabindex="0"
            >
              <code>{{ '{{' }}requestId{{ '}}' }}</code>
              <span class="varDesc">{{ 'EMAIL_TEMPLATE.VARIABLES.REQUEST_ID' | translate }}</span>
              <ion-icon
                [name]="copiedVariable === 'requestId' ? 'checkmark-outline' : 'copy-outline'"
                class="copyIcon"
                [class.copied]="copiedVariable === 'requestId'"
              ></ion-icon>
            </div>
          </div>

          <!-- English Subject -->
          <ion-item class="ion-margin-top" *ngIf="app.isLanguageAvailable('en')">
            <ion-label position="stacked">{{ 'CONFIGURATIONS.THREAD_SUBJECT_EN' | translate }} *</ion-label>
            <ion-input
              [(ngModel)]="subjectEn"
              placeholder="Financial request {{ '{{' }}requestId{{ '}}' }}"
            ></ion-input>
          </ion-item>

          <!-- Polish Subject -->
          <ion-item class="ion-margin-top" *ngIf="app.isLanguageAvailable('pl')">
            <ion-label position="stacked">{{ 'CONFIGURATIONS.THREAD_SUBJECT_PL' | translate }} *</ion-label>
            <ion-input
              [(ngModel)]="subjectPl"
              placeholder="Wniosek finansowy {{ '{{' }}requestId{{ '}}' }}"
            ></ion-input>
          </ion-item>
        </ion-list>

        <ion-row class="ion-margin-top">
          <ion-col size="12">
            <ion-button
              size="small"
              expand="block"
              color="danger"
              fill="outline"
              (click)="askAndResetToDefaults()"
            >
              <ion-icon name="refresh-outline" slot="start"></ion-icon>
              {{ 'CONFIGURATIONS.THREAD_SUBJECT_RESET' | translate }}
            </ion-button>
          </ion-col>
        </ion-row>
      </div>
    </ion-content>
  `,
  styles: [
    `
      .templateModalContent {
        --background: var(--ion-background-color, #f8fafc);

        .maxWidthContainer {
          max-width: 760px;
          margin: 0 auto;
          padding-bottom: calc(36px + env(safe-area-inset-bottom, 0px));
        }

        .modalIntroText {
          margin: 4px 4px 16px 4px;
          font-size: 14px;
          color: var(--ion-color-step-600, #64748b);
          line-height: 1.5;
        }
      }

      .variablesList {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        padding: 8px 16px 16px 16px;

        .variableChip {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: var(--ion-color-step-100, #f1f5f9);
          border: 1px solid var(--ion-color-step-200, #e2e8f0);
          padding: 4px 10px;
          border-radius: 6px;
          font-size: 12px;
          cursor: pointer;
          user-select: none;
          transition: background-color 0.15s ease, border-color 0.15s ease, transform 0.1s ease;

          &:hover {
            background: var(--ion-color-step-200, #e2e8f0);
            border-color: var(--ion-color-primary, #00aeef);
          }

          &:active {
            transform: scale(0.97);
          }

          :is(code) {
            font-family: monospace;
            font-weight: 700;
            color: var(--ion-color-primary, #00aeef);
            background: transparent;
            padding: 0;
          }

          .varDesc {
            color: var(--ion-color-step-600, #64748b);
          }

          .copyIcon {
            font-size: 13px;
            color: var(--ion-color-step-500, #94a3b8);
            margin-left: 2px;
            transition: color 0.15s ease;

            &.copied {
              color: var(--ion-color-success, #22c55e);
            }
          }
        }
      }
    `
  ]
})
export class ThreadSubjectModalComponent implements OnInit {
  @Input() subject?: LocalizedText;

  public subjectEn = '';
  public subjectPl = '';
  public copiedVariable: string | null = null;

  constructor(
    private modalCtrl: ModalController,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController,
    private translate: TranslateService,
    public app: AppService
  ) {}

  ngOnInit(): void {
    const defaultSubject = DEFAULT_CONFIGURATIONS.threadRequestEmailsSubject;
    this.subjectEn = this.subject?.en?.trim() || defaultSubject.en;
    this.subjectPl = this.subject?.pl?.trim() || defaultSubject.pl;
  }

  public close(): void {
    this.modalCtrl.dismiss();
  }

  public async askAndResetToDefaults(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: this.translate.instant('CONFIGURATIONS.THREAD_SUBJECT_RESET'),
      message: this.translate.instant('CONFIGURATIONS.THREAD_SUBJECT_RESET_CONFIRM'),
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('COMMON.RESET'),
          role: 'destructive',
          handler: () => {
            const defaults = DEFAULT_CONFIGURATIONS.threadRequestEmailsSubject;
            this.subjectEn = defaults.en;
            this.subjectPl = defaults.pl;
          }
        }
      ]
    });
    await alert.present();
  }

  public save(): void {
    const defaults = DEFAULT_CONFIGURATIONS.threadRequestEmailsSubject;
    const updated: LocalizedText = {
      en: this.subjectEn.trim() || defaults.en,
      pl: this.subjectPl.trim() || defaults.pl
    };
    this.modalCtrl.dismiss({ subject: updated });
  }

  public async copyVariable(variableCode: string): Promise<void> {
    const textToCopy = `{{${variableCode}}}`;
    let copied = false;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(textToCopy);
        copied = true;
      }
    } catch {
      copied = false;
    }

    if (!copied) {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = textToCopy;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        copied = document.execCommand('copy');
        document.body.removeChild(textarea);
      } catch {
        copied = false;
      }
    }

    if (copied) {
      this.copiedVariable = variableCode;
      setTimeout(() => {
        if (this.copiedVariable === variableCode) {
          this.copiedVariable = null;
        }
      }, 2000);
      const toast = await this.toastCtrl.create({
        message: this.translate.instant('COMMON.COPY_SUCCESS'),
        duration: 2000,
        color: 'success',
        position: 'bottom'
      });
      await toast.present();
    }
  }
}
