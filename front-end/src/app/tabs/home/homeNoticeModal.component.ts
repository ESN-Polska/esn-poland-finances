import { Component, Input, OnInit } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { HomeNotice } from '@models/configurations.model';
import { AppService } from '@app/app.service';

@Component({
  selector: 'app-home-notice-modal',
  template: `
    <ion-header>
      <ion-toolbar color="ideaToolbar">
        <ion-buttons slot="start">
          <ion-button [title]="'COMMON.CLOSE' | translate" (click)="close()">
            <ion-icon name="close-circle-outline" slot="icon-only"></ion-icon>
          </ion-button>
        </ion-buttons>
        <ion-title>{{ 'HOME.MANAGE_NOTICE' | translate }}</ion-title>
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
              <h2>{{ 'HOME.NOTICE_SETTINGS' | translate }}</h2>
              <p>{{ 'HOME.NOTICE_SETTINGS_I' | translate }}</p>
            </ion-label>
          </ion-list-header>

          <ion-item>
            <ion-label>{{ 'HOME.NOTICE_ACTIVE' | translate }}</ion-label>
            <ion-toggle slot="end" [(ngModel)]="active"></ion-toggle>
          </ion-item>

          <ion-item>
            <ion-label position="stacked">{{ 'HOME.NOTICE_TYPE' | translate }}</ion-label>
            <ion-select [(ngModel)]="type" interface="popover">
              <ion-select-option value="info">{{ 'HOME.NOTICE_TYPE_INFO' | translate }}</ion-select-option>
              <ion-select-option value="warning">{{ 'HOME.NOTICE_TYPE_WARNING' | translate }}</ion-select-option>
              <ion-select-option value="success">{{ 'HOME.NOTICE_TYPE_SUCCESS' | translate }}</ion-select-option>
            </ion-select>
          </ion-item>

          <ion-item *ngIf="app.isLanguageAvailable('en')">
            <ion-label position="stacked">{{ 'HOME.NOTICE_TEXT_EN' | translate }}</ion-label>
            <ion-textarea
              [(ngModel)]="textEn"
              [autoGrow]="true"
              [rows]="3"
              [placeholder]="'HOME.NOTICE_TEXT_EN_PLACEHOLDER' | translate"
            ></ion-textarea>
          </ion-item>

          <ion-item *ngIf="app.isLanguageAvailable('pl')">
            <ion-label position="stacked">{{ 'HOME.NOTICE_TEXT_PL' | translate }}</ion-label>
            <ion-textarea
              [(ngModel)]="textPl"
              [autoGrow]="true"
              [rows]="3"
              [placeholder]="'HOME.NOTICE_TEXT_PL_PLACEHOLDER' | translate"
            ></ion-textarea>
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
      ion-item {
        --padding-start: 16px;
        --inner-padding-end: 16px;
        margin-bottom: 12px;
      }
    `
  ]
})
export class HomeNoticeModalComponent implements OnInit {
  @Input() currentNotice?: HomeNotice;

  active = false;
  type: 'info' | 'warning' | 'success' = 'info';
  textEn = '';
  textPl = '';

  constructor(private modalCtrl: ModalController, public app: AppService) {}

  ngOnInit(): void {
    if (this.currentNotice) {
      this.active = !!this.currentNotice.active;
      this.type = this.currentNotice.type || 'info';
      this.textEn = this.currentNotice.text?.en || '';
      this.textPl = this.currentNotice.text?.pl || '';
    }
  }

  close(): void {
    this.modalCtrl.dismiss();
  }

  save(): void {
    const notice: HomeNotice = {
      active: this.active,
      type: this.type,
      text: {
        en: this.textEn.trim(),
        pl: this.textPl.trim()
      }
    };
    this.modalCtrl.dismiss({ notice });
  }
}
