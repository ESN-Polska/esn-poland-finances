import { Component, Input, OnInit } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { LocalizedText } from '@models/configurations.model';

@Component({
  selector: 'app-guest-instructions-modal',
  template: `
    <ion-header>
      <ion-toolbar color="ideaToolbar">
        <ion-buttons slot="start">
          <ion-button [title]="'COMMON.CLOSE' | translate" (click)="close()">
            <ion-icon name="close-circle-outline" slot="icon-only"></ion-icon>
          </ion-button>
        </ion-buttons>
        <ion-title>{{ 'CONFIGURATIONS.GUEST_INSTRUCTIONS_TITLE' | translate }}</ion-title>
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
              <h2>{{ 'CONFIGURATIONS.GUEST_INSTRUCTIONS_TITLE' | translate }}</h2>
              <p>{{ 'CONFIGURATIONS.GUEST_INSTRUCTIONS_I' | translate }}</p>
            </ion-label>
          </ion-list-header>

          <!-- English Instructions -->
          <ion-item class="instructionItem">
            <ion-label position="stacked">{{ 'CONFIGURATIONS.GUEST_INSTRUCTIONS_EN' | translate }}</ion-label>
            <ion-textarea
              [(ngModel)]="instructionsEn"
              [autoGrow]="true"
              [rows]="4"
              class="instructionsTextarea"
              [placeholder]="'CONFIGURATIONS.GUEST_INSTRUCTIONS_PLACEHOLDER' | translate"
            ></ion-textarea>
          </ion-item>

          <!-- Polish Instructions -->
          <ion-item class="instructionItem ion-margin-top">
            <ion-label position="stacked">{{ 'CONFIGURATIONS.GUEST_INSTRUCTIONS_PL' | translate }}</ion-label>
            <ion-textarea
              [(ngModel)]="instructionsPl"
              [autoGrow]="true"
              [rows]="4"
              class="instructionsTextarea"
              [placeholder]="'CONFIGURATIONS.GUEST_INSTRUCTIONS_PLACEHOLDER' | translate"
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
export class GuestInstructionsModalComponent implements OnInit {
  @Input() instructions?: LocalizedText;
  @Input() initialLang: 'en' | 'pl' = 'pl';

  public instructionsEn = '';
  public instructionsPl = '';

  constructor(private modalCtrl: ModalController) {}

  ngOnInit(): void {
    this.instructionsEn = this.instructions?.en || '';
    this.instructionsPl = this.instructions?.pl || '';
  }

  public close(): void {
    this.modalCtrl.dismiss();
  }

  public save(): void {
    const updated: LocalizedText = {
      en: this.instructionsEn.trim(),
      pl: this.instructionsPl.trim()
    };
    this.modalCtrl.dismiss({ instructions: updated });
  }
}
