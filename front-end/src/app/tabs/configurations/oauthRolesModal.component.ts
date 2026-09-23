import { Component, Input, OnInit } from '@angular/core';
import { AlertController, ModalController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { OAUTH_ROLE_OPTIONS } from '@models/configurations.model';

@Component({
  selector: 'app-oauth-roles-modal',
  template: `
    <ion-header>
      <ion-toolbar color="ideaToolbar">
        <ion-buttons slot="start">
          <ion-button [title]="'COMMON.CLOSE' | translate" (click)="close()">
            <ion-icon name="close-circle-outline" slot="icon-only"></ion-icon>
          </ion-button>
        </ion-buttons>
        <ion-title>{{ 'CONFIGURATIONS.EDIT_LIST' | translate }}</ion-title>
        <ion-buttons slot="end">
          <ion-button
            [title]="'COMMON.SAVE' | translate"
            (click)="save()"
          >
            <ion-icon name="checkmark-circle-outline" slot="icon-only"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding modalContent">
      <div class="maxWidthContainer">
        <!-- Info card -->
        <ion-card class="infoCard ion-no-margin ion-margin-bottom">
          <ion-card-content>
            <div class="infoCardHeader">
              <ion-icon name="information-circle-outline" class="infoIcon"></ion-icon>
              <div>
                <strong>{{ 'CONFIGURATIONS.OAUTH_ROLES_SECTION' | translate }}</strong>
                <p class="infoDescription">{{ 'CONFIGURATIONS.EDIT_OAUTH_ROLES_I' | translate }}</p>
              </div>
            </div>
            <div class="syntaxExample">
              <code>[Scope]:[Role]</code> &mdash; <code>PL:country-president</code>, <code>*:section-treasurer</code>
            </div>
            <div class="spreadsheetLinkWrapper">
              <a
                href="https://docs.google.com/spreadsheets/d/e/2PACX-1vRdzqFX1zRyOoAZxsrAWYxEuE0xs_0hX-8Jk10yAwEeC-WE81W2orTtkYjCPH-lrBsGu_lB-bbzlaKf/pubhtml?urp=gmail_link#"
                target="_blank"
                rel="noopener noreferrer"
                class="spreadsheetLink"
              >
                <ion-icon name="open-outline" class="linkIcon"></ion-icon>
                <span>{{ 'CONFIGURATIONS.OAUTH_ROLES_SPREADSHEET_LINK' | translate }}</span>
              </a>
            </div>
          </ion-card-content>
        </ion-card>

        <!-- 3 Centered utility buttons -->
        <div class="centeredButtonsRow">
          <ion-button fill="outline" size="small" (click)="sortRoles()">
            <ion-icon name="swap-vertical-outline" slot="start"></ion-icon>
            {{ 'CONFIGURATIONS.SORT_ALPHABETICAL' | translate }}
          </ion-button>
          <ion-button fill="outline" size="small" (click)="formatAndDeduplicate()">
            <ion-icon name="sparkles-outline" slot="start"></ion-icon>
            {{ 'CONFIGURATIONS.CLEAN_DUPLICATES' | translate }}
          </ion-button>
          <ion-button fill="clear" color="medium" size="small" (click)="restoreDefaults()">
            <ion-icon name="refresh-outline" slot="start"></ion-icon>
            {{ 'CONFIGURATIONS.RESET_TO_DEFAULTS' | translate }}
          </ion-button>
        </div>

        <!-- Editor Box -->
        <div class="editorCard">
          <div class="editorHeader">
            <span class="editorTitle">{{ 'CONFIGURATIONS.ROLES_EDITOR_LABEL' | translate }}</span>
            <span class="lineCount">{{ rawTextLinesCount }} {{ 'CONFIGURATIONS.LINES' | translate }}</span>
          </div>
          <ion-textarea
            [(ngModel)]="rawText"
            [rows]="18"
            [autoGrow]="true"
            class="rolesTextarea"
            [placeholder]="'PL:country-president\nPL:country-treasurer\n*:section-treasurer'"
          ></ion-textarea>
        </div>
      </div>
    </ion-content>
  `,
  styles: [
    `
      .modalContent {
        --background: var(--ion-background-color, #f4f5f8);
      }
      .maxWidthContainer {
        max-width: 760px;
        margin: 0 auto;
        padding: 4px 8px 32px 8px;
      }
      .infoCard {
        border-radius: 12px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
        border: 1px solid var(--ion-color-step-150, #e0e0e0);
        background: var(--ion-card-background, #ffffff);
      }
      .infoCardHeader {
        display: flex;
        align-items: flex-start;
        gap: 12px;
      }
      .infoIcon {
        font-size: 1.5rem;
        color: var(--ion-color-primary, #0055b8);
        flex-shrink: 0;
        margin-top: 2px;
      }
      .infoDescription {
        margin: 4px 0 0 0;
        font-size: 0.9rem;
        color: var(--ion-color-step-600, #666666);
      }
      .syntaxExample {
        margin-top: 10px;
        padding: 8px 12px;
        background: var(--ion-color-step-50, #f8f9fa);
        border-radius: 8px;
        font-size: 0.85rem;
        border: 1px dashed var(--ion-color-step-200, #cccccc);
      }
      .syntaxExample code {
        font-weight: 600;
        color: var(--ion-color-primary, #0055b8);
      }
      .spreadsheetLinkWrapper {
        margin-top: 12px;
        display: flex;
        align-items: center;
      }
      .spreadsheetLink {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        color: var(--ion-color-primary, #0055b8);
        font-size: 0.88rem;
        font-weight: 600;
        text-decoration: none;
        transition: opacity 0.2s ease;
      }
      .spreadsheetLink:hover {
        text-decoration: underline;
        opacity: 0.85;
      }
      .spreadsheetLink .linkIcon {
        font-size: 1.1rem;
      }
      .centeredButtonsRow {
        display: flex;
        justify-content: center;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
        margin: 14px 0 16px 0;
      }
      .editorCard {
        background: var(--ion-card-background, #ffffff);
        border: 1px solid var(--ion-color-step-200, #dcdcdc);
        border-radius: 12px;
        overflow: hidden;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
      }
      .editorHeader {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 16px;
        background: var(--ion-color-step-50, #f8f9fa);
        border-bottom: 1px solid var(--ion-color-step-150, #eaeaea);
        font-size: 0.85rem;
        color: var(--ion-color-step-600, #666);
      }
      .editorTitle {
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      .rolesTextarea {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 0.95rem;
        line-height: 1.6;
        --padding-start: 16px;
        --padding-end: 16px;
        --padding-top: 12px;
        --padding-bottom: 16px;
      }
    `
  ]
})
export class OAuthRolesModalComponent implements OnInit {
  @Input() roles: string[] = [];

  public rawText = '';

  get rawTextLinesCount(): number {
    if (!this.rawText || !this.rawText.trim()) return 0;
    return this.rawText.split('\n').filter(line => line.trim().length > 0).length;
  }

  constructor(
    private modalCtrl: ModalController,
    private alertCtrl: AlertController,
    private translate: TranslateService
  ) {}

  ngOnInit(): void {
    const initial = this.roles && this.roles.length > 0 ? this.roles : OAUTH_ROLE_OPTIONS;
    this.rawText = initial.join('\n');
  }

  public sortRoles(): void {
    const lines = this.getUniqueLines();
    lines.sort((a, b) => a.localeCompare(b));
    this.rawText = lines.join('\n');
  }

  public formatAndDeduplicate(): void {
    const lines = this.getUniqueLines();
    this.rawText = lines.join('\n');
  }

  public async restoreDefaults(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: this.translate.instant('COMMON.CONFIRM'),
      message: this.translate.instant('CONFIGURATIONS.RESET_OAUTH_ROLES_CONFIRM'),
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('CONFIGURATIONS.RESET_TO_DEFAULTS'),
          role: 'destructive',
          handler: () => {
            this.rawText = OAUTH_ROLE_OPTIONS.join('\n');
          }
        }
      ]
    });
    await alert.present();
  }

  private getUniqueLines(): string[] {
    const lines = this.rawText
      .split(/[\n,]/)
      .map(item => item.trim())
      .filter(Boolean);
    return lines.filter((item, index) => lines.indexOf(item) === index);
  }

  public close(): void {
    this.modalCtrl.dismiss();
  }

  public async save(): Promise<void> {
    const unique = this.getUniqueLines();
    const ROLE_PATTERN_REGEX = /^[A-Za-z0-9*_-]+(?:\.[A-Za-z0-9*_-]+)*:[A-Za-z0-9*_-]+$/;
    const invalid = unique.filter(line => !ROLE_PATTERN_REGEX.test(line));
    if (invalid.length > 0) {
      const alert = await this.alertCtrl.create({
        header: this.translate.instant('COMMON.OPERATION_FAILED'),
        message: `${this.translate.instant('CONFIGURATIONS.INVALID_ROLE_PATTERN')}\n\n${invalid.slice(0, 5).map(r => `• ${r}`).join('\n')}${invalid.length > 5 ? `\n... (+${invalid.length - 5})` : ''}`,
        buttons: [{ text: this.translate.instant('COMMON.CONFIRM'), role: 'cancel' }]
      });
      await alert.present();
      return;
    }
    this.modalCtrl.dismiss({ roles: unique });
  }
}
