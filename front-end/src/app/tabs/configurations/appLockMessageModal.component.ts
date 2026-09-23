import { Component, Input, OnInit } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { LocalizedText } from '@models/configurations.model';
import { AppService } from '@app/app.service';

@Component({
  selector: 'app-lock-message-modal',
  template: `
    <ion-header>
      <ion-toolbar color="ideaToolbar">
        <ion-buttons slot="start">
          <ion-button [title]="'COMMON.CLOSE' | translate" (click)="close()">
            <ion-icon name="close-circle-outline" slot="icon-only"></ion-icon>
          </ion-button>
        </ion-buttons>
        <ion-title>{{ 'CONFIGURATIONS.APP_LOCK_MESSAGE_TITLE' | translate }}</ion-title>
        <ion-buttons slot="end">
          <ion-button [title]="'COMMON.SAVE' | translate" (click)="save()">
            <ion-icon name="checkmark-circle-outline" slot="icon-only"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <div class="maxWidthContainer">
        <ion-list class="aList">
          <ion-list-header>
            <ion-label>
              <h2>{{ 'CONFIGURATIONS.APP_LOCK_MESSAGE_TITLE' | translate }}</h2>
              <p>{{ 'CONFIGURATIONS.APP_LOCK_MESSAGE_I' | translate }}</p>
            </ion-label>
          </ion-list-header>

          <!-- English Lock Message -->
          <ion-item class="instructionItem" *ngIf="app.isLanguageAvailable('en')">
            <ion-label position="stacked">{{ 'CONFIGURATIONS.APP_LOCK_MESSAGE_EN' | translate }}</ion-label>
            <ion-textarea
              [(ngModel)]="messageEn"
              [autoGrow]="true"
              [rows]="4"
              class="instructionsTextarea"
              [placeholder]="'CONFIGURATIONS.APP_LOCK_MESSAGE_PLACEHOLDER' | translate"
            ></ion-textarea>
          </ion-item>

          <!-- Polish Lock Message -->
          <ion-item class="instructionItem ion-margin-top" *ngIf="app.isLanguageAvailable('pl')">
            <ion-label position="stacked">{{ 'CONFIGURATIONS.APP_LOCK_MESSAGE_PL' | translate }}</ion-label>
            <ion-textarea
              [(ngModel)]="messagePl"
              [autoGrow]="true"
              [rows]="4"
              class="instructionsTextarea"
              [placeholder]="'CONFIGURATIONS.APP_LOCK_MESSAGE_PLACEHOLDER' | translate"
            ></ion-textarea>
          </ion-item>
        </ion-list>
      </div>
    </ion-content>
  `,
  styles: [
    `
      .maxWidthContainer {
        max-width: 760px;
        margin: 0 auto;
        padding: 8px 12px 32px 12px;
      }
      .instructionItem {
        --padding-start: 16px;
        --inner-padding-end: 16px;
        border: 1px solid var(--border-color, rgba(0, 0, 0, 0.08));
        border-radius: 10px;
        margin-bottom: 16px;
        background: var(--bg-card, #ffffff);
      }
      .instructionsTextarea {
        font-size: 0.95rem;
        line-height: 1.5;
        margin-top: 4px;
        margin-bottom: 4px;
      }
    `
  ]
})
export class AppLockMessageModalComponent implements OnInit {
  @Input() message?: LocalizedText;

  public messageEn = '';
  public messagePl = '';

  constructor(private modalCtrl: ModalController, public app: AppService) {}

  ngOnInit(): void {
    this.messageEn = this.message?.en || '';
    this.messagePl = this.message?.pl || '';
  }

  public close(): void {
    this.modalCtrl.dismiss();
  }

  public save(): void {
    const updated: LocalizedText = {
      en: this.messageEn.trim(),
      pl: this.messagePl.trim()
    };
    this.modalCtrl.dismiss({ message: updated });
  }
}
