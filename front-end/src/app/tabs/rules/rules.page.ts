import { Component } from '@angular/core';
import { AlertController, LoadingController, ModalController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { AppPermission, Configurations, LocalizedText } from '@models/configurations.model';
import { AppService } from '../../app.service';
import { ConfigurationsService } from '../configurations/configurations.service';
import { MediaService } from '../../common/media.service';
import { RulesWarningModalComponent } from './rulesWarningModal.component';
import { RulesDocumentModalComponent } from './rulesDocumentModal.component';

@Component({
  selector: 'app-rules-tab',
  templateUrl: './rules.page.html',
  styleUrls: ['./rules.page.scss']
})
export class RulesPage {
  get configurations(): Configurations {
    return this.app.configurations;
  }

  get currentLang(): string {
    return this.translate.currentLang === 'pl' ? 'pl' : 'en';
  }

  get warningText(): string {
    return (
      this.configurations?.getRulesWarningText(this.translate.currentLang) ||
      this.translate.instant('RULES.WARNING_TEXT')
    );
  }

  get revisionNoticeText(): string {
    const number = this.configurations?.rulesResolutionNumber || 'XX/XX';
    const date = this.configurations?.rulesRevisionDate;
    const formattedDate = this.formatDate(date);
    return this.translate.instant('RULES.REVISION_NOTICE', {
      number,
      date: formattedDate
    });
  }

  get rulesFileURL(): LocalizedText {
    if (typeof this.configurations?.rulesFileURL === 'string') {
      return {
        en: this.configurations.rulesFileURL,
        pl: this.configurations.rulesFileURL
      };
    }
    return (
      this.configurations?.rulesFileURL || {
        en: 'https://media.finances.esn-poland.link/rules/finances-rules.pdf',
        pl: 'https://media.finances.esn-poland.link/rules/finances-rules.pdf'
      }
    );
  }

  get hasPlRules(): boolean {
    return !!this.rulesFileURL?.pl?.trim();
  }

  get hasEnRules(): boolean {
    return !!this.rulesFileURL?.en?.trim();
  }

  get hasBothRules(): boolean {
    return this.hasPlRules && this.hasEnRules;
  }

  constructor(
    public app: AppService,
    private configurationsService: ConfigurationsService,
    private mediaService: MediaService,
    private modalCtrl: ModalController,
    private loadingCtrl: LoadingController,
    private alertCtrl: AlertController,
    private translate: TranslateService
  ) {}

  canEditWarningText(): boolean {
    const user = this.app.currentUser;
    return !!user && (user.isAdministrator || user.hasPermission(AppPermission.RULES.TEXT));
  }

  canUpdateDocument(): boolean {
    const user = this.app.currentUser;
    return !!user && (user.isAdministrator || user.hasPermission(AppPermission.RULES.UPDATE));
  }

  public downloadRules(lang?: 'en' | 'pl'): void {
    const targetLang = lang || (this.currentLang === 'pl' ? 'pl' : 'en');
    const url =
      this.configurations?.getRulesFileURL(targetLang) ||
      this.rulesFileURL?.[targetLang] ||
      (targetLang === 'en' ? this.rulesFileURL?.pl : this.rulesFileURL?.en) ||
      'https://media.finances.esn-poland.link/rules/finances-rules.pdf';
    window.open(url, '_blank');
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

  async editWarningText(): Promise<void> {
    if (!this.canEditWarningText()) return;

    const modal = await this.modalCtrl.create({
      component: RulesWarningModalComponent,
      componentProps: {
        currentWarningText: this.configurations?.rulesWarningText
      }
    });
    await modal.present();

    const { data } = await modal.onDidDismiss();
    if (data?.warningText) {
      const updated = new Configurations(this.configurations);
      updated.rulesWarningText = data.warningText;
      await this.saveConfigurations(updated);
    }
  }

  async updateDocumentRevision(): Promise<void> {
    if (!this.canUpdateDocument()) return;

    const modal = await this.modalCtrl.create({
      component: RulesDocumentModalComponent,
      componentProps: {
        currentRulesFileURL: this.configurations?.rulesFileURL,
        currentResolutionNumber: this.configurations?.rulesResolutionNumber,
        currentRevisionDate: this.configurations?.rulesRevisionDate
      }
    });
    await modal.present();

    const { data } = await modal.onDidDismiss();
    if (data?.resolutionNumber && data?.revisionDate) {
      const hasUploads = !!data.filePl || !!data.fileEn;
      let uploading: any = null;

      if (hasUploads) {
        uploading = await this.loadingCtrl.create({
          message: this.translate.instant('COMMON.UPLOADING')
        });
        await uploading.present();
      }

      try {
        const currentRules: LocalizedText =
          typeof this.configurations?.rulesFileURL === 'object' && this.configurations?.rulesFileURL
            ? { ...this.configurations.rulesFileURL }
            : {
                en: typeof this.configurations?.rulesFileURL === 'string' ? this.configurations.rulesFileURL : '',
                pl: typeof this.configurations?.rulesFileURL === 'string' ? this.configurations.rulesFileURL : ''
              };

        const uploadPromises: Promise<void>[] = [];

        if (data.filePl) {
          uploadPromises.push(
            this.mediaService.uploadDocument(data.filePl).then(({ url }) => {
              currentRules.pl = url;
            })
          );
        }

        if (data.fileEn) {
          uploadPromises.push(
            this.mediaService.uploadDocument(data.fileEn).then(({ url }) => {
              currentRules.en = url;
            })
          );
        }

        if (uploadPromises.length > 0) {
          await Promise.all(uploadPromises);
        }

        const updated = new Configurations(this.configurations);
        updated.rulesFileURL = currentRules;
        updated.rulesResolutionNumber = data.resolutionNumber;
        updated.rulesRevisionDate = data.revisionDate;
        await this.saveConfigurations(updated);
      } catch (err: any) {
        const alert = await this.alertCtrl.create({
          header: this.translate.instant('COMMON.OPERATION_FAILED'),
          message: err?.message || this.translate.instant('COMMON.OPERATION_FAILED'),
          buttons: [{ text: this.translate.instant('COMMON.CONFIRM'), role: 'cancel' }]
        });
        await alert.present();
      } finally {
        if (uploading) {
          await uploading.dismiss();
        }
      }
    }
  }

  private async saveConfigurations(updated: Configurations): Promise<void> {
    const loading = await this.loadingCtrl.create({
      message: this.translate.instant('COMMON.SAVING')
    });
    await loading.present();

    try {
      this.app.configurations = await this.configurationsService.update(updated);
    } catch (err: any) {
      const isConflict =
        err?.status === 409 ||
        err?.statusCode === 409 ||
        err?.error?.message?.includes('CONFIGURATIONS_CONFLICT') ||
        err?.message?.includes('CONFIGURATIONS_CONFLICT') ||
        String(err).includes('CONFIGURATIONS_CONFLICT');

      if (isConflict) {
        this.app.configurations = await this.configurationsService.get();
        const alert = await this.alertCtrl.create({
          header: this.translate.instant('COMMON.OPERATION_FAILED'),
          message: this.translate.instant('CONFIGURATIONS.CONFLICT_ALERT'),
          buttons: [{ text: this.translate.instant('COMMON.CONFIRM'), role: 'cancel' }]
        });
        await alert.present();
      } else {
        const alert = await this.alertCtrl.create({
          header: this.translate.instant('COMMON.OPERATION_FAILED'),
          message: err?.message || this.translate.instant('COMMON.OPERATION_FAILED'),
          buttons: [{ text: this.translate.instant('COMMON.CONFIRM'), role: 'cancel' }]
        });
        await alert.present();
      }
    } finally {
      await loading.dismiss();
    }
  }
}
