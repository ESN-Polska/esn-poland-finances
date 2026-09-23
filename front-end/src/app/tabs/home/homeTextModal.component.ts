import { Component, Input, OnInit } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { DEFAULT_CONFIGURATIONS, LocalizedText } from '@models/configurations.model';

@Component({
  selector: 'app-home-text-modal',
  template: `
    <ion-header>
      <ion-toolbar color="ideaToolbar">
        <ion-buttons slot="start">
          <ion-button [title]="'COMMON.CLOSE' | translate" (click)="close()">
            <ion-icon name="close-circle-outline" slot="icon-only"></ion-icon>
          </ion-button>
        </ion-buttons>
        <ion-title>{{ 'HOME.EDIT_WELCOME_TEXT' | translate }}</ion-title>
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
          <!-- Title Section -->
          <ion-list-header>
            <ion-label>
              <h2>{{ 'HOME.WELCOME_TITLE_SECTION' | translate }}</h2>
              <p>{{ 'HOME.WELCOME_TITLE_SECTION_I' | translate }}</p>
            </ion-label>
          </ion-list-header>

          <ion-item>
            <ion-label position="stacked">{{ 'HOME.WELCOME_TITLE_EN' | translate }}</ion-label>
            <ion-textarea
              [(ngModel)]="titleEn"
              [autoGrow]="true"
              [rows]="1"
              [placeholder]="'HOME.WELCOME_TITLE_EN_PLACEHOLDER' | translate"
            ></ion-textarea>
          </ion-item>

          <ion-item>
            <ion-label position="stacked">{{ 'HOME.WELCOME_TITLE_PL' | translate }}</ion-label>
            <ion-textarea
              [(ngModel)]="titlePl"
              [autoGrow]="true"
              [rows]="1"
              [placeholder]="'HOME.WELCOME_TITLE_PL_PLACEHOLDER' | translate"
            ></ion-textarea>
          </ion-item>

          <!-- Subtitle Section -->
          <ion-list-header class="ion-padding-top">
            <ion-label>
              <h2>{{ 'HOME.WELCOME_SUBTITLE_SECTION' | translate }}</h2>
              <p>{{ 'HOME.WELCOME_SUBTITLE_SECTION_I' | translate }}</p>
            </ion-label>
          </ion-list-header>

          <ion-item>
            <ion-label position="stacked">{{ 'HOME.WELCOME_SUBTITLE_EN' | translate }}</ion-label>
            <ion-textarea
              [(ngModel)]="subtitleEn"
              [autoGrow]="true"
              [rows]="3"
              [placeholder]="'HOME.WELCOME_SUBTITLE_EN_PLACEHOLDER' | translate"
            ></ion-textarea>
          </ion-item>

          <ion-item>
            <ion-label position="stacked">{{ 'HOME.WELCOME_SUBTITLE_PL' | translate }}</ion-label>
            <ion-textarea
              [(ngModel)]="subtitlePl"
              [autoGrow]="true"
              [rows]="3"
              [placeholder]="'HOME.WELCOME_SUBTITLE_PL_PLACEHOLDER' | translate"
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
export class HomeTextModalComponent implements OnInit {
  @Input() currentTitle?: LocalizedText;
  @Input() currentSubtitle?: LocalizedText;

  titleEn = '';
  titlePl = '';
  subtitleEn = '';
  subtitlePl = '';

  constructor(private modalCtrl: ModalController) {}

  ngOnInit(): void {
    this.titleEn = this.currentTitle?.en || DEFAULT_CONFIGURATIONS.homeWelcomeTitle.en;
    this.titlePl = this.currentTitle?.pl || DEFAULT_CONFIGURATIONS.homeWelcomeTitle.pl;
    this.subtitleEn = this.currentSubtitle?.en || DEFAULT_CONFIGURATIONS.homeWelcomeSubtitle.en;
    this.subtitlePl = this.currentSubtitle?.pl || DEFAULT_CONFIGURATIONS.homeWelcomeSubtitle.pl;
  }

  close(): void {
    this.modalCtrl.dismiss();
  }

  save(): void {
    const title: LocalizedText = {
      en: this.titleEn.trim(),
      pl: this.titlePl.trim()
    };
    const subtitle: LocalizedText = {
      en: this.subtitleEn.trim(),
      pl: this.subtitlePl.trim()
    };
    this.modalCtrl.dismiss({ title, subtitle });
  }
}
