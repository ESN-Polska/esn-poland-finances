import { Component, OnInit, ViewChild } from '@angular/core';
import { AlertController, IonSelect, LoadingController, ModalController, ToastController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';

import { AppService } from '@app/app.service';
import { ConfigurationsService } from './configurations.service';
import { MediaService } from '@app/common/media.service';
import { RoleEditorComponent } from './roleEditor.component';
import { UserRoleMappingsComponent } from './userRoleMappings.component';
import { GuestInviteModalComponent } from './guestInviteModal.component';
import { GuestInstructionsModalComponent } from './guestInstructionsModal.component';
import { EmailTemplateComponent } from './emailTemplate/emailTemplate.component';

import {
  AppPermission,
  Configurations,
  ConfigurationPageSection,
  CustomRole,
  DEFAULT_CONFIGURATION_PAGE_SECTIONS_ORDER,
  BuiltInRole,
  GuestInvitation,
  FinancialRequestType,
  EmailTemplates,
  EmailTemplateTypes
} from '@models/configurations.model';
import { User } from '@models/user.model';

@Component({
  selector: 'app-configurations',
  templateUrl: './configurations.page.html',
  styleUrls: ['./configurations.page.scss']
})
export class ConfigurationsPage implements OnInit {
  public EmailTemplates = EmailTemplates;
  public EmailTemplateTypes = EmailTemplateTypes;

  configurations: Configurations =
    this.app?.configurations || new Configurations({ PK: Configurations.PK });

  @ViewChild('customRoleSelect') customRoleSelect?: IonSelect;
  selectedCustomRoleId: string | null = null;

  pageSection: ConfigurationPageSection = DEFAULT_CONFIGURATION_PAGE_SECTIONS_ORDER[0];
  pageSections: ConfigurationPageSection[] =
    this.configurations?.configurationPageSectionsOrder?.length
      ? [...this.configurations.configurationPageSectionsOrder]
      : [...DEFAULT_CONFIGURATION_PAGE_SECTIONS_ORDER];

  timezones: string[] = (Intl as any).supportedValuesOf
    ? (Intl as any).supportedValuesOf('timeZone')
    : ['Europe/Warsaw', 'UTC'];

  guestFilterStatus: 'ALL' | 'ACTIVE' | 'USED' | 'EXPIRED' | 'REVOKED' = 'ALL';
  guestSearchQuery: string = '';

  constructor(
    private modalCtrl: ModalController,
    private alertCtrl: AlertController,
    private loadingCtrl: LoadingController,
    private toastCtrl: ToastController,
    private translate: TranslateService,
    private configurationsService: ConfigurationsService,
    private mediaService: MediaService,
    public app: AppService
  ) {}

  async ngOnInit(): Promise<void> {
    if (this.app?.configurations) {
      this.configurations = this.app.configurations;
      if (this.configurations.configurationPageSectionsOrder?.length) {
        this.pageSections = this.configurations.configurationPageSectionsOrder;
      }
    }

    const firstAccessible = this.pageSections.find(s => this.canAccessPageSection(s));
    if (firstAccessible) {
      this.pageSection = firstAccessible;
    } else {
      this.app.goTo(['/t/home']);
      return;
    }

    await this.loadData();
  }

  async loadData(): Promise<void> {
    try {
      this.configurations = await this.configurationsService.get();
      this.app.configurations = this.configurations;
      if (this.app.currentUser && !this.app.isImpersonating) {
        User.applyConfigurationPermissions(this.app.currentUser, this.configurations);
      }

      if (this.configurations.configurationPageSectionsOrder?.length) {
        this.pageSections = this.configurations.configurationPageSectionsOrder;
      }

      if (!this.canAccessPageSection(this.pageSection)) {
        const accessible = this.pageSections.find(s => this.canAccessPageSection(s));
        if (accessible) {
          this.pageSection = accessible;
        } else {
          this.app.goTo(['/t/home']);
        }
      }
    } catch (e) {
      console.error('Failed to load configurations', e);
    }
  }

  canAccessPageSection(section: ConfigurationPageSection): boolean {
    const user = this.app.currentUser;
    if (!user) return false;
    if (user.isAdministrator || user.isAuditor) return true;

    if (section === 'OPTIONS') {
      return user.hasPermission(AppPermission.CONFIGURATIONS.OPTIONS);
    }
    if (section === 'USERS') {
      return user.hasPermission(AppPermission.CONFIGURATIONS.USERS);
    }
    if (section === 'GUESTS') {
      return user.hasPermission(AppPermission.CONFIGURATIONS.GUESTS);
    }
    if (section === 'TEMPLATES') {
      return user.hasPermission(AppPermission.CONFIGURATIONS.TEMPLATES);
    }
    return false;
  }

  canModifyOptions(): boolean {
    const user = this.app.currentUser;
    if (!user) return false;
    if (user.isAdministrator) return true;
    if (user.isAuditor) return false;
    return user.hasPermission(AppPermission.CONFIGURATIONS.OPTIONS);
  }

  canModifyUsers(): boolean {
    const user = this.app.currentUser;
    if (!user) return false;
    if (user.isAdministrator) return true;
    if (user.isAuditor) return false;
    return user.hasPermission(AppPermission.CONFIGURATIONS.USERS);
  }

  canModifyGuests(): boolean {
    const user = this.app.currentUser;
    if (!user) return false;
    if (user.isAdministrator) return true;
    if (user.isAuditor) return false;
    return user.hasPermission(AppPermission.CONFIGURATIONS.GUESTS);
  }

  canModifyTemplates(): boolean {
    const user = this.app.currentUser;
    if (!user) return false;
    if (user.isAdministrator) return true;
    if (user.isAuditor) return false;
    return user.hasPermission(AppPermission.CONFIGURATIONS.TEMPLATES);
  }

  canUsePreview(): boolean {
    const user = this.app.currentUser;
    if (!user) return false;
    if (user.isAdministrator) return true;
    if (user.isAuditor) return false;
    return user.hasPermission(AppPermission.CONFIGURATIONS.USERS);
  }

  canReorderPageSections(): boolean {
    const user = this.app.currentUser;
    if (!user) return false;
    if (user.isAdministrator) return true;
    if (user.isAuditor) return false;

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
      if (this.app.currentUser && !this.app.isImpersonating) {
        User.applyConfigurationPermissions(this.app.currentUser, this.configurations);
      }
      this.app.updateTitle();
    } catch (err: any) {
      const isConflict =
        err?.status === 409 ||
        err?.statusCode === 409 ||
        err?.error?.message?.includes('CONFIGURATIONS_CONFLICT') ||
        err?.message?.includes('CONFIGURATIONS_CONFLICT') ||
        String(err).includes('CONFIGURATIONS_CONFLICT');

      if (isConflict) {
        await this.loadData();
        const alert = await this.alertCtrl.create({
          header: this.translate.instant('COMMON.OPERATION_FAILED'),
          message: this.translate.instant('CONFIGURATIONS.CONFLICT_ALERT'),
          buttons: [{ text: this.translate.instant('COMMON.CONFIRM'), role: 'cancel' }]
        });
        await alert.present();
      } else {
        throw err;
      }
    } finally {
      await loading.dismiss();
    }
  }

  async openTemplateEmailModal(templateType: EmailTemplateTypes | EmailTemplates): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: EmailTemplateComponent,
      componentProps: { templateType }
    });
    await modal.present();
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

  hasAdminGroup(): boolean {
    const assignment = (this.configurations?.automaticRoleAssignments || []).find(
      a => a.roleId === 'ADMINISTRATOR'
    );
    return !!assignment && (assignment.extendedRolePatterns?.length || 0) > 0;
  }

  canRemoveAdministrator(): boolean {
    if (!this.configurations?.administratorsIds?.length) return false;
    if (this.configurations.administratorsIds.length > 1) return true;
    return this.configurations.administratorsIds.length === 1 && this.hasAdminGroup();
  }

  async removeAdministratorById(userId: string): Promise<void> {
    if (!this.canRemoveAdministrator()) return;
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

  async addManager(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: this.translate.instant('CONFIGURATIONS.ADD_MANAGER'),
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
            if (!updated.managersIds.includes(userId)) {
              updated.managersIds.push(userId);
              await this.updateConfigurations(updated);
            }
          }
        }
      ]
    });
    await alert.present();
  }

  async removeManagerById(userId: string): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: this.translate.instant('COMMON.CONFIRM'),
      message: this.translate.instant('CONFIGURATIONS.REMOVE_MANAGER_CONFIRM', { userId }),
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('COMMON.DELETE'),
          role: 'destructive',
          handler: async () => {
            const updated = new Configurations(this.configurations);
            updated.managersIds = updated.managersIds.filter(id => id !== userId);
            await this.updateConfigurations(updated);
          }
        }
      ]
    });
    await alert.present();
  }

  async addAuditor(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: this.translate.instant('CONFIGURATIONS.ADD_AUDITOR'),
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
            if (!updated.auditorsIds.includes(userId)) {
              updated.auditorsIds.push(userId);
              await this.updateConfigurations(updated);
            }
          }
        }
      ]
    });
    await alert.present();
  }

  async removeAuditorById(userId: string): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: this.translate.instant('COMMON.CONFIRM'),
      message: this.translate.instant('CONFIGURATIONS.REMOVE_AUDITOR_CONFIRM', { userId }),
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('COMMON.DELETE'),
          role: 'destructive',
          handler: async () => {
            const updated = new Configurations(this.configurations);
            updated.auditorsIds = updated.auditorsIds.filter(id => id !== userId);
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
    const requirePatterns =
      roleId === 'ADMINISTRATOR' &&
      (!this.configurations?.administratorsIds || !this.configurations.administratorsIds.length);
    const readOnly = !this.canModifyUsers();

    const modal = await this.modalCtrl.create({
      component: RoleEditorComponent,
      componentProps: {
        mode: 'automatic',
        roleId,
        assignment: existing || { roleId, extendedRolePatterns: [] },
        requirePatterns,
        readOnly
      }
    });
    await modal.present();
    const { data } = await modal.onDidDismiss();
    if (!data?.extendedRolePatterns || readOnly) return;

    if (
      roleId === 'ADMINISTRATOR' &&
      !data.extendedRolePatterns.length &&
      (!this.configurations?.administratorsIds || !this.configurations.administratorsIds.length)
    ) {
      const alert = await this.alertCtrl.create({
        header: this.translate.instant('COMMON.OPERATION_FAILED'),
        message: this.translate.instant('CONFIGURATIONS.CANNOT_REMOVE_LAST_ADMIN_GROUP'),
        buttons: [{ text: this.translate.instant('COMMON.CONFIRM'), role: 'cancel' }]
      });
      await alert.present();
      return;
    }

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
    const readOnly = !this.canModifyUsers();
    const modal = await this.modalCtrl.create({
      component: RoleEditorComponent,
      componentProps: { mode: 'custom', role, readOnly }
    });
    await modal.present();
    const { data } = await modal.onDidDismiss();
    if (!data?.role || readOnly) return;

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

  seeAsCustomRole(roleId: string): void {
    const role = this.configurations?.customRoles?.find(customRole => customRole.id === roleId);
    if (role) {
      this.app.seeAsCustomRole(role);
    }
    setTimeout(() => this.resetCustomRoleSelector());
  }

  private resetCustomRoleSelector(): void {
    this.selectedCustomRoleId = null;
    if (this.customRoleSelect) {
      this.customRoleSelect.value = null;
    }
  }

  get filteredGuestInvitations(): GuestInvitation[] {
    const invites = this.configurations?.guestInvitations || [];
    const query = this.guestSearchQuery.trim().toLowerCase();
    const now = new Date().toISOString();

    return invites.filter(inv => {
      let effectiveStatus = inv.status;
      if (inv.status === 'ACTIVE' && inv.expiresAt && inv.expiresAt < now) {
        effectiveStatus = 'EXPIRED';
      }

      const matchesStatus =
        this.guestFilterStatus === 'ALL' || effectiveStatus === this.guestFilterStatus;

      const matchesSearch =
        !query ||
        inv.guestName?.toLowerCase().includes(query) ||
        inv.guestEmail?.toLowerCase().includes(query) ||
        (inv.purpose && inv.purpose.toLowerCase().includes(query)) ||
        (inv.submittedRequestId && inv.submittedRequestId.toLowerCase().includes(query));

      return matchesStatus && matchesSearch;
    });
  }

  getGuestStatus(invite: GuestInvitation): string {
    const now = new Date().toISOString();
    if (invite.status === 'ACTIVE' && invite.expiresAt && invite.expiresAt < now) {
      return 'EXPIRED';
    }
    return invite.status;
  }

  async openCreateGuestInviteModal(existing?: GuestInvitation): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: GuestInviteModalComponent,
      componentProps: {
        configurations: this.configurations,
        existingInvite: existing
      }
    });

    await modal.present();
    const { data } = await modal.onWillDismiss();

    if (data?.invitation && !existing) {
      const updated = new Configurations(this.configurations);
      updated.guestAccessEnabled = true;
      updated.guestInvitations = [data.invitation, ...(updated.guestInvitations || [])];
      await this.updateConfigurations(updated);
    }
  }

  async openEditGuestInviteModal(invite: GuestInvitation): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: GuestInviteModalComponent,
      componentProps: {
        configurations: this.configurations,
        existingInvite: invite,
        isEditMode: true
      }
    });

    await modal.present();
    const { data } = await modal.onWillDismiss();

    if (data?.invitation && data?.isEdit) {
      const updated = new Configurations(this.configurations);
      const list = [...(updated.guestInvitations || [])];
      const idx = list.findIndex(i => i.id === invite.id);
      if (idx !== -1) {
        list[idx] = data.invitation;
        updated.guestInvitations = list;
        await this.updateConfigurations(updated);
        const toast = await this.toastCtrl.create({
          message: this.translate.instant('CONFIGURATIONS.INVITE_UPDATED'),
          duration: 2500,
          color: 'success',
          position: 'bottom'
        });
        await toast.present();
      }
    }
  }

  async copyGuestLink(invite: GuestInvitation): Promise<void> {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://finances.esn-poland.link';
    const link = `${origin}/auth?guestToken=${encodeURIComponent(invite.id)}`;

    try {
      await navigator.clipboard.writeText(link);
      const toast = await this.toastCtrl.create({
        message: this.translate.instant('CONFIGURATIONS.LINK_COPIED'),
        duration: 2500,
        color: 'success',
        position: 'bottom'
      });
      await toast.present();
    } catch {
      // Fallback
    }
  }

  async changeGuestInviteValidity(invite: GuestInvitation): Promise<void> {
    const currentExpiry = invite.expiresAt ? new Date(invite.expiresAt) : new Date();
    const currentDateStr = currentExpiry.toISOString().substring(0, 10);

    const alert = await this.alertCtrl.create({
      header: this.translate.instant('CONFIGURATIONS.CHANGE_VALIDITY'),
      inputs: [
        {
          name: 'validityDate',
          type: 'date',
          value: currentDateStr
        }
      ],
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('COMMON.SAVE'),
          handler: async (data: { validityDate?: string }) => {
            if (!data?.validityDate) return;
            const updated = new Configurations(this.configurations);
            const target = (updated.guestInvitations || []).find(i => i.id === invite.id);
            if (!target) return;

            const newDate = new Date(data.validityDate);
            newDate.setHours(23, 59, 59, 999);
            target.expiresAt = newDate.toISOString();
            if (target.status === 'EXPIRED' && newDate.getTime() > Date.now()) {
              target.status = 'ACTIVE';
            }

            await this.updateConfigurations(updated);
          }
        }
      ]
    });
    await alert.present();
  }

  async revokeGuestInvite(invite: GuestInvitation): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: this.translate.instant('COMMON.CONFIRM'),
      message: this.translate.instant('CONFIGURATIONS.REVOKE_INVITE_CONFIRM'),
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('CONFIGURATIONS.REVOKE_INVITE'),
          role: 'destructive',
          handler: async () => {
            const updated = new Configurations(this.configurations);
            const target = (updated.guestInvitations || []).find(i => i.id === invite.id);
            if (target) {
              target.status = 'REVOKED';
              await this.updateConfigurations(updated);
            }
          }
        }
      ]
    });
    await alert.present();
  }

  async unrevokeGuestInvite(invite: GuestInvitation): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: this.translate.instant('COMMON.CONFIRM'),
      message: this.translate.instant('CONFIGURATIONS.UNREVOKE_INVITE_CONFIRM'),
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('CONFIGURATIONS.UNREVOKE_INVITE'),
          handler: async () => {
            const updated = new Configurations(this.configurations);
            const target = (updated.guestInvitations || []).find(i => i.id === invite.id);
            if (target) {
              target.status = 'ACTIVE';
              const now = new Date();
              if (target.expiresAt && new Date(target.expiresAt).getTime() <= now.getTime()) {
                const days = this.configurations?.guestAccessDefaultExpirationDays || 7;
                const newExp = new Date();
                newExp.setDate(newExp.getDate() + days);
                newExp.setHours(23, 59, 59, 999);
                target.expiresAt = newExp.toISOString();
              }
              await this.updateConfigurations(updated);
              const toast = await this.toastCtrl.create({
                message: this.translate.instant('CONFIGURATIONS.UNREVOKE_INVITE_SUCCESS'),
                duration: 2500,
                color: 'success',
                position: 'bottom'
              });
              await toast.present();
            }
          }
        }
      ]
    });
    await alert.present();
  }

  async deleteGuestInvite(invite: GuestInvitation): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: this.translate.instant('COMMON.CONFIRM'),
      message: this.translate.instant('CONFIGURATIONS.DELETE_INVITE_CONFIRM'),
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('COMMON.DELETE'),
          role: 'destructive',
          handler: async () => {
            const updated = new Configurations(this.configurations);
            updated.guestInvitations = (updated.guestInvitations || []).filter(i => i.id !== invite.id);
            await this.updateConfigurations(updated);
          }
        }
      ]
    });
    await alert.present();
  }

  viewGuestRequest(requestId?: string): void {
    if (!requestId) return;
    const parts = requestId.split('/');
    if (parts.length === 2) {
      this.app.goTo(['/t/requests/view', parts[1], parts[0]]);
    } else {
      this.app.goTo(['/t/requests/view', encodeURIComponent(requestId)]);
    }
  }

  isGuestRequestTypeAllowed(type: FinancialRequestType): boolean {
    const allowed = this.configurations?.guestAccessAllowedRequestTypes || [];
    return allowed.includes(type);
  }

  async toggleGuestRequestType(type: FinancialRequestType): Promise<void> {
    const updated = new Configurations(this.configurations);
    const current = new Set(updated.guestAccessAllowedRequestTypes || []);
    if (current.has(type)) {
      current.delete(type);
    } else {
      current.add(type);
    }
    updated.guestAccessAllowedRequestTypes = Array.from(current);
    await this.updateConfigurations(updated);
  }

  async changeGuestInstructions(lang?: 'en' | 'pl'): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: GuestInstructionsModalComponent,
      componentProps: {
        instructions: this.configurations.guestAccessInstructions,
        initialLang: lang || 'pl'
      }
    });

    await modal.present();
    const { data } = await modal.onWillDismiss();
    if (data?.instructions) {
      const updated = new Configurations(this.configurations);
      updated.guestAccessInstructions = data.instructions;
      await this.updateConfigurations(updated);
    }
  }
}
