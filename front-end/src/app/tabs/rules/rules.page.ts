import { Component } from '@angular/core';
import { AlertController, LoadingController, ModalController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { AppPermission, Configurations } from '@models/configurations.model';
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

  public downloadRules(): void {
    const url =
      this.configurations?.rulesFileURL ||
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
        currentResolutionNumber: this.configurations?.rulesResolutionNumber,
        currentRevisionDate: this.configurations?.rulesRevisionDate
      }
    });
    await modal.present();

    const { data } = await modal.onDidDismiss();
    if (data?.file && data?.resolutionNumber && data?.revisionDate) {
      const uploading = await this.loadingCtrl.create({
        message: this.translate.instant('COMMON.UPLOADING')
      });
      await uploading.present();

      try {
        const { url } = await this.mediaService.uploadDocument(data.file);
        const updated = new Configurations(this.configurations);
        updated.rulesFileURL = url;
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
        await uploading.dismiss();
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
