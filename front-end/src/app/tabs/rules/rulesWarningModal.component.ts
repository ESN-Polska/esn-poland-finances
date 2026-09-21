import { Component, Input, OnInit } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { LocalizedText } from '@models/configurations.model';

@Component({
  selector: 'app-rules-warning-modal',
  template: `
    <ion-header>
      <ion-toolbar color="ideaToolbar">
        <ion-buttons slot="start">
          <ion-button [title]="'COMMON.CLOSE' | translate" (click)="close()">
            <ion-icon name="close-circle-outline" slot="icon-only"></ion-icon>
          </ion-button>
        </ion-buttons>
        <ion-title>{{ 'RULES.EDIT_WARNING_TEXT' | translate }}</ion-title>
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
              <h2>{{ 'RULES.WARNING_TEXT_SECTION' | translate }}</h2>
              <p>{{ 'RULES.WARNING_TEXT_SECTION_I' | translate }}</p>
            </ion-label>
          </ion-list-header>

          <ion-item>
            <ion-label position="stacked">{{ 'RULES.WARNING_TEXT_EN' | translate }}</ion-label>
            <ion-textarea
              [(ngModel)]="warningEn"
              [autoGrow]="true"
              [rows]="4"
              [placeholder]="'RULES.WARNING_TEXT_PLACEHOLDER' | translate"
            ></ion-textarea>
          </ion-item>

          <ion-item>
            <ion-label position="stacked">{{ 'RULES.WARNING_TEXT_PL' | translate }}</ion-label>
            <ion-textarea
              [(ngModel)]="warningPl"
              [autoGrow]="true"
              [rows]="4"
              [placeholder]="'RULES.WARNING_TEXT_PLACEHOLDER' | translate"
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
export class RulesWarningModalComponent implements OnInit {
  @Input() currentWarningText?: LocalizedText;

  warningEn = '';
  warningPl = '';

  constructor(private modalCtrl: ModalController) {}

  ngOnInit(): void {
    this.warningEn = this.currentWarningText?.en || '';
    this.warningPl = this.currentWarningText?.pl || '';
  }

  close(): void {
    this.modalCtrl.dismiss();
  }

  save(): void {
    const warningText: LocalizedText = {
      en: this.warningEn.trim(),
      pl: this.warningPl.trim()
    };
    this.modalCtrl.dismiss({ warningText });
  }
}
