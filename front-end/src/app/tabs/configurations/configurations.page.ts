import { Component, OnInit } from '@angular/core';
import { AlertController, LoadingController, ModalController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';

import { AppService } from '@app/app.service';
import { ConfigurationsService } from './configurations.service';
import { MediaService } from '@app/common/media.service';
import { RoleEditorComponent } from './roleEditor.component';
import { UserRoleMappingsComponent } from './userRoleMappings.component';

import {
  AppPermission,
  Configurations,
  ConfigurationPageSection,
  CustomRole,
  DEFAULT_CONFIGURATION_PAGE_SECTIONS_ORDER,
  BuiltInRole
} from '@models/configurations.model';

@Component({
  selector: 'app-configurations',
  templateUrl: './configurations.page.html',
  styleUrls: ['./configurations.page.scss']
})
export class ConfigurationsPage implements OnInit {
  configurations!: Configurations;

  pageSection: ConfigurationPageSection = 'OPTIONS';
  pageSections: ConfigurationPageSection[] = [...DEFAULT_CONFIGURATION_PAGE_SECTIONS_ORDER];

  timezones: string[] = (Intl as any).supportedValuesOf
    ? (Intl as any).supportedValuesOf('timeZone')
    : ['Europe/Warsaw', 'UTC'];

  constructor(
    private modalCtrl: ModalController,
    private alertCtrl: AlertController,
    private loadingCtrl: LoadingController,
    private translate: TranslateService,
    private configurationsService: ConfigurationsService,
    private mediaService: MediaService,
    public app: AppService
  ) {}

  async ngOnInit(): Promise<void> {
    await this.loadData();
  }

  async loadData(): Promise<void> {
    this.configurations = await this.configurationsService.get();
    this.app.configurations = this.configurations;

    if (this.configurations.configurationPageSectionsOrder?.length) {
      this.pageSections = this.configurations.configurationPageSectionsOrder;
    }

    if (!this.canAccessPageSection(this.pageSection)) {
      const accessible = this.pageSections.find(s => this.canAccessPageSection(s));
      if (accessible) {
        this.pageSection = accessible;
      } else {
        this.app.goTo(['/t/requests']);
      }
    }
  }

  canAccessPageSection(section: ConfigurationPageSection): boolean {
    const user = this.app.currentUser;
    if (!user) return false;
    if (user.isAdministrator) return true;

    if (section === 'OPTIONS') {
      return user.hasPermission(AppPermission.CONFIGURATIONS.OPTIONS);
    }
    if (section === 'USERS') {
      return user.hasPermission(AppPermission.CONFIGURATIONS.USERS);
    }
    return false;
  }

  canReorderPageSections(): boolean {
    const user = this.app.currentUser;
    if (!user) return false;
    if (user.isAdministrator) return true;

    return (
      DEFAULT_CONFIGURATION_PAGE_SECTIONS_ORDER.every(section => this.canAccessPageSection(section)) &&
      this.pageSections.every(section => this.canAccessPageSection(section))
    );
  }

  async updateConfigurations(newConfigurations: Configurations = this.configurations): Promise<void> {
    const loading = await this.loadingCtrl.create({ message: this.translate.instant('COMMON.SAVING') });
    await loading.present();
    try {
      this.configurations = await this.configurationsService.update(newConfigurations);
      this.app.configurations = this.configurations;
      this.app.updateTitle();
    } finally {
      await loading.dismiss();
    }
  }

  //
  // OPTIONS SUBTAB
  //

  async changeAppTitle(lang: 'en' | 'pl' = 'en'): Promise<void> {
    const isPl = lang === 'pl';
    const headerKey = isPl ? 'CONFIGURATIONS.APP_TITLE_PL' : 'CONFIGURATIONS.APP_TITLE_EN';
    const placeholderKey = isPl ? 'CONFIGURATIONS.APP_TITLE_PL_PLACEHOLDER' : 'CONFIGURATIONS.APP_TITLE_EN_PLACEHOLDER';
    const currentVal = (this.configurations.appTitle as any)?.[lang] || '';
    const alert = await this.alertCtrl.create({
      header: this.translate.instant(headerKey),
      inputs: [
        {
          name: 'appTitle',
          type: 'text',
          value: currentVal,
          placeholder: this.translate.instant(placeholderKey)
        }
      ],
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('COMMON.CONFIRM'),
          handler: async data => {
            if (!data.appTitle?.trim()) return;
            const updated = new Configurations(this.configurations);
            if (!updated.appTitle || typeof updated.appTitle === 'string') {
              updated.appTitle = { en: '', pl: '' };
            }
            updated.appTitle[lang] = data.appTitle.trim();
            await this.updateConfigurations(updated);
          }
        }
      ]
    });
    await alert.present();
  }

  async changeAppSubtitle(lang: 'en' | 'pl' = 'en'): Promise<void> {
    const isPl = lang === 'pl';
    const headerKey = isPl ? 'CONFIGURATIONS.APP_SUBTITLE_PL' : 'CONFIGURATIONS.APP_SUBTITLE_EN';
    const placeholderKey = isPl ? 'CONFIGURATIONS.APP_SUBTITLE_PL_PLACEHOLDER' : 'CONFIGURATIONS.APP_SUBTITLE_EN_PLACEHOLDER';
    const currentVal = (this.configurations.appSubtitle as any)?.[lang] || '';
    const alert = await this.alertCtrl.create({
      header: this.translate.instant(headerKey),
      inputs: [
        {
          name: 'appSubtitle',
          type: 'text',
          value: currentVal,
          placeholder: this.translate.instant(placeholderKey)
        }
      ],
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('COMMON.CONFIRM'),
          handler: async data => {
            const updated = new Configurations(this.configurations);
            if (!updated.appSubtitle || typeof updated.appSubtitle === 'string') {
              updated.appSubtitle = { en: '', pl: '' };
            }
            updated.appSubtitle[lang] = data.appSubtitle?.trim() || '';
            await this.updateConfigurations(updated);
          }
        }
      ]
    });
    await alert.present();
  }

  async changeSupportEmail(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: this.translate.instant('CONFIGURATIONS.SUPPORT_EMAIL'),
      inputs: [
        {
          name: 'supportEmail',
          type: 'email',
          value: this.configurations.supportEmail,
          placeholder: this.translate.instant('CONFIGURATIONS.SUPPORT_EMAIL_PLACEHOLDER')
        }
      ],
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('COMMON.CONFIRM'),
          handler: async data => {
            if (!data.supportEmail?.trim()) return;
            const updated = new Configurations(this.configurations);
            updated.supportEmail = data.supportEmail.trim();
            await this.updateConfigurations(updated);
          }
        }
      ]
    });
    await alert.present();
  }

  async uploadAppLogo(event: any, darkMode = false): Promise<void> {
    const file = event.target?.files?.[0];
    if (!file) return;

    const loading = await this.loadingCtrl.create({ message: this.translate.instant('COMMON.UPLOADING') });
    await loading.present();
    try {
      const imageURI = await this.mediaService.uploadImage(file);
      const updated = new Configurations(this.configurations);
      const url = this.app.getImageURLByURI(imageURI);
      if (darkMode) {
        updated.appLogoURLDarkMode = url;
      } else {
        updated.appLogoURL = url;
      }
      await this.updateConfigurations(updated);
    } finally {
      await loading.dismiss();
      event.target.value = '';
    }
  }

  async resetAppLogo(darkMode = false): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: this.translate.instant('CONFIGURATIONS.RESET_APP_LOGO'),
      message: this.translate.instant('CONFIGURATIONS.RESET_APP_LOGO_I'),
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('COMMON.RESET'),
          handler: async () => {
            const updated = new Configurations(this.configurations);
            if (darkMode) {
              updated.appLogoURLDarkMode = '';
            } else {
              updated.appLogoURL = '';
            }
            await this.updateConfigurations(updated);
          }
        }
      ]
    });
    await alert.present();
  }

  async reorderPageSections(event: any): Promise<void> {
    const reordered = event.detail.complete(this.pageSections);
    const updated = new Configurations(this.configurations);
    updated.configurationPageSectionsOrder = reordered;
    this.pageSections = reordered;
    await this.updateConfigurations(updated);
  }

  //
  // USERS SUBTAB
  //

  async addAdministrator(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: this.translate.instant('CONFIGURATIONS.ADD_ADMINISTRATOR'),
      inputs: [
        {
          name: 'userId',
          type: 'text',
          placeholder: this.translate.instant('CONFIGURATIONS.USERNAME_PLACEHOLDER')
        }
      ],
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('COMMON.ADD'),
          handler: async data => {
            const userId = data.userId?.trim().toLowerCase();
            if (!userId) return;
            const updated = new Configurations(this.configurations);
            if (!updated.administratorsIds.includes(userId)) {
              updated.administratorsIds.push(userId);
              await this.updateConfigurations(updated);
            }
          }
        }
      ]
    });
    await alert.present();
  }

  async removeAdministratorById(userId: string): Promise<void> {
    if (this.configurations.administratorsIds.length <= 1) return;
    const alert = await this.alertCtrl.create({
      header: this.translate.instant('COMMON.CONFIRM'),
      message: this.translate.instant('CONFIGURATIONS.REMOVE_ADMINISTRATOR_CONFIRM', { userId }),
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('COMMON.DELETE'),
          role: 'destructive',
          handler: async () => {
            const updated = new Configurations(this.configurations);
            updated.administratorsIds = updated.administratorsIds.filter(id => id !== userId);
            await this.updateConfigurations(updated);
          }
        }
      ]
    });
    await alert.present();
  }

  async addFinancialManager(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: this.translate.instant('CONFIGURATIONS.ADD_FINANCIAL_MANAGER'),
      inputs: [
        {
          name: 'userId',
          type: 'text',
          placeholder: this.translate.instant('CONFIGURATIONS.USERNAME_PLACEHOLDER')
        }
      ],
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('COMMON.ADD'),
          handler: async data => {
            const userId = data.userId?.trim().toLowerCase();
            if (!userId) return;
            const updated = new Configurations(this.configurations);
            if (!updated.financialManagersIds.includes(userId)) {
              updated.financialManagersIds.push(userId);
              await this.updateConfigurations(updated);
            }
          }
        }
      ]
    });
    await alert.present();
  }

  async removeFinancialManagerById(userId: string): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: this.translate.instant('COMMON.CONFIRM'),
      message: this.translate.instant('CONFIGURATIONS.REMOVE_FINANCIAL_MANAGER_CONFIRM', { userId }),
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('COMMON.DELETE'),
          role: 'destructive',
          handler: async () => {
            const updated = new Configurations(this.configurations);
            updated.financialManagersIds = updated.financialManagersIds.filter(id => id !== userId);
            await this.updateConfigurations(updated);
          }
        }
      ]
    });
    await alert.present();
  }

  getAutomaticRoleAssignmentCount(roleId: BuiltInRole): number {
    const assignment = (this.configurations?.automaticRoleAssignments || []).find(a => a.roleId === roleId);
    return assignment?.extendedRolePatterns?.length || 0;
  }

  async manageAutomaticRole(roleId: BuiltInRole): Promise<void> {
    const existing = (this.configurations?.automaticRoleAssignments || []).find(a => a.roleId === roleId);
    const modal = await this.modalCtrl.create({
      component: RoleEditorComponent,
      componentProps: {
        mode: 'automatic',
        roleId,
        assignment: existing || { roleId, extendedRolePatterns: [] }
      }
    });
    await modal.present();
    const { data } = await modal.onDidDismiss();
    if (!data?.extendedRolePatterns) return;

    const updated = new Configurations(this.configurations);
    const filtered = (updated.automaticRoleAssignments || []).filter(a => a.roleId !== roleId);
    if (data.extendedRolePatterns.length) {
      filtered.push({ roleId, extendedRolePatterns: data.extendedRolePatterns });
    }
    updated.automaticRoleAssignments = filtered;
    await this.updateConfigurations(updated);
  }

  async addCustomRole(): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: RoleEditorComponent,
      componentProps: { mode: 'custom' }
    });
    await modal.present();
    const { data } = await modal.onDidDismiss();
    if (!data?.role) return;

    const updated = new Configurations(this.configurations);
    updated.customRoles = [...(updated.customRoles || []), data.role];
    await this.updateConfigurations(updated);
  }

  async manageCustomRole(role: CustomRole): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: RoleEditorComponent,
      componentProps: { mode: 'custom', role }
    });
    await modal.present();
    const { data } = await modal.onDidDismiss();
    if (!data?.role) return;

    const updated = new Configurations(this.configurations);
    updated.customRoles = (updated.customRoles || []).map(r => (r.id === role.id ? data.role : r));
    await this.updateConfigurations(updated);
  }

  async removeCustomRole(role: CustomRole): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: this.translate.instant('COMMON.CONFIRM'),
      message: `Delete custom role "${role.name}"?`,
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('COMMON.DELETE'),
          role: 'destructive',
          handler: async () => {
            const updated = new Configurations(this.configurations);
            updated.customRoles = (updated.customRoles || []).filter(r => r.id !== role.id);
            await this.updateConfigurations(updated);
          }
        }
      ]
    });
    await alert.present();
  }

  async openUserRoleMappings(): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: UserRoleMappingsComponent
    });
    await modal.present();
  }
}
