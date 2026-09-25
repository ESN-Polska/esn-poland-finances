import { Component, OnInit, ViewChild } from '@angular/core';
import { AlertController, IonSelect, LoadingController, ModalController, ToastController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';

import { AppService } from '@app/app.service';
import { ConfigurationsService } from './configurations.service';
import { MediaService } from '@app/common/media.service';
import { UsersService } from '@app/common/users.service';
import { RoleEditorComponent } from './roleEditor.component';
import { UserRoleMappingsComponent } from './userRoleMappings.component';
import { GuestInviteModalComponent } from './guestInviteModal.component';
import { GuestInstructionsModalComponent } from './guestInstructionsModal.component';
import { AppLockMessageModalComponent } from './appLockMessageModal.component';
import { EmailTemplateComponent } from './emailTemplate/emailTemplate.component';
import { OAuthRolesModalComponent } from './oauthRolesModal.component';

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
  EmailTemplateTypes,
  OAUTH_ROLE_OPTIONS,
  UsersOriginDisplayOptions
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
  public UODP = UsersOriginDisplayOptions;
  public usersOriginDisplayOptions = [
    { key: 'BOTH', value: UsersOriginDisplayOptions.BOTH },
    { key: 'COUNTRY', value: UsersOriginDisplayOptions.COUNTRY },
    { key: 'SECTION', value: UsersOriginDisplayOptions.SECTION }
  ];

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
  oauthRoleOptions: string[] = [];

  usersList: User[] = [];
  loadingUsers: boolean = false;
  userSearchQuery: string = '';
  userFilterStatus: 'ALL' | 'ACTIVE' | 'SUSPENDED' = 'ALL';

  constructor(
    private modalCtrl: ModalController,
    private alertCtrl: AlertController,
    private loadingCtrl: LoadingController,
    private toastCtrl: ToastController,
    private translate: TranslateService,
    private configurationsService: ConfigurationsService,
    private mediaService: MediaService,
    private usersService: UsersService,
    public app: AppService
  ) {}

  async ngOnInit(): Promise<void> {
    if (this.app?.configurations) {
      this.configurations = this.app.configurations;
      if (this.configurations.configurationPageSectionsOrder?.length) {
        this.pageSections = this.configurations.configurationPageSectionsOrder;
      }
      this.oauthRoleOptions = this.getActiveOAuthRoleOptions();
    }

    const firstAccessible = this.pageSections.find(s => this.canAccessPageSection(s));
    if (firstAccessible) {
      this.pageSection = firstAccessible;
      if (this.pageSection === 'USERS') {
        this.loadUsers();
      }
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
      this.oauthRoleOptions = this.getActiveOAuthRoleOptions();
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

      if (this.pageSection === 'USERS') {
        this.loadUsers();
      }
    } catch (e) {
      console.error('Failed to load configurations', e);
    }
  }

  trackByRole(_index: number, role: string): string {
    return role;
  }

  trackBySection(_index: number, section: ConfigurationPageSection): string {
    return section;
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
    if (section === 'ROLES') {
      return user.hasPermission(AppPermission.CONFIGURATIONS.ROLES);
    }
    if (section === 'GUESTS') {
      return user.hasPermission(AppPermission.CONFIGURATIONS.GUESTS);
    }
    if (section === 'TEMPLATES') {
      return user.hasPermission(AppPermission.CONFIGURATIONS.TEMPLATES);
    }
    if (section === 'RESOURCES') {
      return (
        user.hasPermission(AppPermission.CONFIGURATIONS.RESOURCES) ||
        user.hasPermission(AppPermission.CONFIGURATIONS.OPTIONS)
      );
    }
    return false;
  }

  canModifyResources(): boolean {
    const user = this.app.currentUser;
    if (!user) return false;
    if (user.isAdministrator) return true;
    if (user.isAuditorOnly) return false;
    return user.hasPermission(AppPermission.CONFIGURATIONS.RESOURCES);
  }

  canModifyOptions(): boolean {
    const user = this.app.currentUser;
    if (!user) return false;
    if (user.isAdministrator) return true;
    if (user.isAuditorOnly) return false;
    return user.hasPermission(AppPermission.CONFIGURATIONS.OPTIONS);
  }

  canModifyRoles(): boolean {
    const user = this.app.currentUser;
    if (!user) return false;
    if (user.isAdministrator) return true;
    if (user.isAuditorOnly) return false;
    return user.hasPermission(AppPermission.CONFIGURATIONS.ROLES);
  }

  canModifyUsers(): boolean {
    const user = this.app.currentUser;
    if (!user) return false;
    if (user.isAdministrator) return true;
    if (user.isAuditorOnly) return false;
    return user.hasPermission(AppPermission.CONFIGURATIONS.USERS);
  }

  canModifyGuests(): boolean {
    const user = this.app.currentUser;
    if (!user) return false;
    if (user.isAdministrator) return true;
    if (user.isAuditorOnly) return false;
    return user.hasPermission(AppPermission.CONFIGURATIONS.GUESTS);
  }

  canModifyTemplates(): boolean {
    const user = this.app.currentUser;
    if (!user) return false;
    if (user.isAdministrator) return true;
    if (user.isAuditorOnly) return false;
    return user.hasPermission(AppPermission.CONFIGURATIONS.TEMPLATES);
  }

  canUsePreview(): boolean {
    const user = this.app.currentUser;
    if (!user) return false;
    if (user.isAdministrator) return true;
    if (user.isAuditorOnly) return false;
    return user.hasPermission(AppPermission.CONFIGURATIONS.ROLES);
  }

  onPageSectionChange(section: ConfigurationPageSection): void {
    if (section === 'USERS') {
      this.loadUsers();
    }
  }

  isGuestUser(u: User | any): boolean {
    if (!u) return false;
    return Boolean(
      u.isGuest ||
      (u.userId && String(u.userId).toLowerCase().startsWith('guest_')) ||
      (Array.isArray(u.roles) && u.roles.includes('GUEST'))
    );
  }

  isUnregisteredUser(u: User | any): boolean {
    return Boolean((u as any)?.isUnregistered);
  }

  get nonGuestUsers(): User[] {
    return (this.usersList || []).filter(u => !this.isGuestUser(u));
  }

  get unregisteredBlockedUsers(): User[] {
    const registeredIds = new Set((this.usersList || []).map(u => (u.userId || '').replace(/^@+/, '').trim().toLowerCase()));
    return (this.configurations?.blockedUserIds || [])
      .map(id => (id || '').replace(/^@+/, '').trim())
      .filter(id => id && !registeredIds.has(id.toLowerCase()))
      .map(id => {
        const u = new User({
          userId: id,
          roles: [],
          extendedRoles: [],
          customRoleIds: []
        } as any);
        (u as any).isUnregistered = true;
        return u;
      });
  }

  get allDirectoryUsers(): User[] {
    return [...this.nonGuestUsers, ...this.unregisteredBlockedUsers];
  }

  get filteredUsers(): User[] {
    const rawQuery = this.userSearchQuery.trim().toLowerCase();
    const cleanQuery = rawQuery.replace(/^@+/, '');

    return this.allDirectoryUsers
      .filter(user => {
        const isSuspended = this.isUserSuspended(user.userId);
        if (this.userFilterStatus === 'ACTIVE' && isSuspended) return false;
        if (this.userFilterStatus === 'SUSPENDED' && !isSuspended) return false;
        return true;
      })
      .filter(user => {
        if (!rawQuery) return true;
        const displayName = this.getUserDisplayName(user).toLowerCase();
        const matchesName = displayName.includes(rawQuery) ||
          displayName.includes(cleanQuery) ||
          (user.firstName || '').toLowerCase().includes(rawQuery) ||
          (user.firstName || '').toLowerCase().includes(cleanQuery) ||
          (user.lastName || '').toLowerCase().includes(rawQuery) ||
          (user.lastName || '').toLowerCase().includes(cleanQuery);
        const matchesId = (user.userId || '').toLowerCase().includes(cleanQuery) ||
          `@${user.userId || ''}`.toLowerCase().includes(rawQuery);
        const matchesCountry = (user.country || '').toLowerCase().includes(cleanQuery);
        const matchesSection = (user.section || '').toLowerCase().includes(cleanQuery) ||
          (user.sectionCode || '').toLowerCase().includes(cleanQuery);
        const matchesEmail = (user.email || '').toLowerCase().includes(cleanQuery);
        return matchesName || matchesId || matchesCountry || matchesSection || matchesEmail;
      });
  }

  get totalUsersCount(): number {
    return this.allDirectoryUsers.length;
  }

  get suspendedUsersCount(): number {
    return this.allDirectoryUsers.filter(u => this.isUserSuspended(u.userId)).length;
  }

  get activeUsersCount(): number {
    return Math.max(0, this.totalUsersCount - this.suspendedUsersCount);
  }

  getUserDisplayName(user: User): string {
    if (!user) return '';
    if (typeof user.getDisplayName === 'function') {
      const name = user.getDisplayName();
      if (name && name !== user.userId) return name;
    }
    const parts = [user.firstName, user.lastName].filter(Boolean);
    if (parts.length > 0) return parts.join(' ');
    if ((user as any).name) return (user as any).name;
    return user.userId ? `@${user.userId}` : '';
  }

  getUserIdentifier(userOrId: User | string): string {
    const user = typeof userOrId === 'string'
      ? this.allDirectoryUsers.find(u => (u.userId || '').toLowerCase() === userOrId.replace(/^@/, '').trim().toLowerCase())
      : userOrId;
    if (user) {
      const parts = [user.firstName, user.lastName].filter(Boolean);
      if (parts.length > 0) return parts.join(' ');
      if (typeof user.getDisplayName === 'function') {
        const name = user.getDisplayName();
        if (name && name !== user.userId) return name;
      }
      return `@${user.userId}`;
    }
    const cleanId = String(userOrId || '').replace(/^@/, '').trim();
    return cleanId ? `@${cleanId}` : '';
  }

  getUserInitials(user: User): string {
    if (!user) return '?';
    const first = (user.firstName?.[0] || user.userId?.[0] || (user as any).name?.[0] || '').toUpperCase();
    const last = (user.lastName?.[0] || '').toUpperCase();
    return `${first}${last}`.trim() || first || '?';
  }

  getUserRoles(user: User): Array<{ key: string; name: string; title?: string }> {
    if (!user) return [];
    const roles: Array<{ key: string; name: string; title?: string }> = [];

    if (this.configurations) {
      User.applyConfigurationPermissions(user, this.configurations);
    }

    if (user.isAdministrator) {
      roles.push({
        key: 'role-administrator',
        name: this.translate.instant('CONFIGURATIONS.ADMINISTRATOR')
      });
    }

    if (user.isManager) {
      roles.push({
        key: 'role-manager',
        name: this.translate.instant('CONFIGURATIONS.MANAGER')
      });
    }

    if (user.isAuditor) {
      roles.push({
        key: 'role-auditor',
        name: this.translate.instant('CONFIGURATIONS.AUDITOR')
      });
    }

    // Custom roles with specific names
    const seenCustomRoleIds = new Set<string>();
    const customRoles = this.configurations?.customRoles || [];
    for (const cr of customRoles) {
      if (seenCustomRoleIds.has(cr.id)) continue;
      const isExplicit = (cr.userIds || []).map(id => id.toLowerCase()).includes(user.userId.toLowerCase());
      const matchedPattern = (cr.extendedRolePatterns || []).find(p => User.matchesRolePattern(user, p));
      const hasId = (user.customRoleIds || []).includes(cr.id);

      if (isExplicit || matchedPattern || hasId) {
        seenCustomRoleIds.add(cr.id);
        roles.push({
          key: 'role-custom',
          name: cr.name,
          title: matchedPattern ? `${cr.name} (${matchedPattern})` : cr.name
        });
      }
    }

    for (const src of user.roleAssignmentSources || []) {
      if (src.roleId && !['ADMINISTRATOR', 'MANAGER', 'AUDITOR'].includes(src.roleId)) {
        if (!seenCustomRoleIds.has(src.roleId)) {
          seenCustomRoleIds.add(src.roleId);
          roles.push({
            key: 'role-custom',
            name: src.roleName || src.roleId,
            title: src.matchedExtendedRole && src.matchedExtendedRole !== 'manual'
              ? `${src.roleName || src.roleId} (${src.matchedExtendedRole})`
              : src.roleName || src.roleId
          });
        }
      }
    }

    return roles;
  }

  async loadUsers(force = false): Promise<void> {
    if (this.loadingUsers || (this.usersList.length > 0 && !force)) return;
    this.loadingUsers = true;
    try {
      const allUsers = await this.usersService.getAll({ roleAssignments: true });
      let list = (allUsers || []).filter(u => !this.isGuestUser(u));

      // Ensure any configured users (administrators, managers, auditors, suspended users, custom role users) appear
      const existingUserIds = new Set(list.map(u => (u.userId || '').toLowerCase()));
      const knownConfigUserIds = Array.from(new Set([
        ...(this.configurations?.administratorsIds || []),
        ...(this.configurations?.managersIds || []),
        ...(this.configurations?.auditorsIds || []),
        ...(this.configurations?.blockedUserIds || []),
        ...(this.configurations?.customRoles || []).reduce((acc, r) => [...acc, ...(r.userIds || [])], [] as string[])
      ].map(id => String(id || '').toLowerCase().trim()).filter(Boolean)));

      for (const id of knownConfigUserIds) {
        if (!existingUserIds.has(id) && !id.startsWith('guest_')) {
          const syntheticUser = new User({
            userId: id,
            firstName: '',
            lastName: '',
            email: '',
            section: '',
            sectionCode: '',
            country: '',
            roles: [],
            extendedRoles: [],
            lastLoginAt: ''
          });
          if (this.configurations) {
            User.applyConfigurationPermissions(syntheticUser, this.configurations);
          }
          list.push(syntheticUser);
          existingUserIds.add(id);
        }
      }
      this.usersList = list;
    } catch (err) {
      console.error('Failed to load users list', err);
      this.usersList = [];
    } finally {
      this.loadingUsers = false;
    }
  }

  isUserSuspended(userId: string): boolean {
    if (!userId || !this.configurations?.blockedUserIds) return false;
    return this.configurations.blockedUserIds.some(id => id.toLowerCase() === userId.toLowerCase());
  }

  isUserBlocked(userId: string): boolean {
    return this.isUserSuspended(userId);
  }

  getUserInheritedSources(user: User): User['roleAssignmentSources'] {
    return (user.roleAssignmentSources || []).filter(source => source.matchedExtendedRole !== 'manual');
  }

  getLastLoginLabel(lastLoginAt: string): string {
    if (!lastLoginAt) return this.translate.instant('CONFIGURATIONS.NEVER');
    const elapsed = Math.max(0, Date.now() - new Date(lastLoginAt).getTime());
    const minutes = Math.floor(elapsed / 60000);
    if (minutes < 1) return this.translate.instant('CONFIGURATIONS.JUST_NOW');
    if (minutes < 60) return this.translate.instant('CONFIGURATIONS.MINUTES_AGO', { count: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours <= 24) return this.translate.instant('CONFIGURATIONS.HOURS_AGO', { count: hours });
    const d = new Date(lastLoginAt);
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  }

  isAdministratorId(userId: string): boolean {
    if (!userId || !this.configurations) return false;
    const cleanId = userId.replace(/^@+/, '').trim().toLowerCase();
    const adminIds = new Set(
      (this.configurations.administratorsIds || []).map(id => id.replace(/^@+/, '').trim().toLowerCase())
    );
    if (adminIds.has(cleanId)) return true;

    const user = (this.usersList || []).find(
      u => (u.userId || '').replace(/^@+/, '').trim().toLowerCase() === cleanId
    );
    if (user) {
      User.applyConfigurationPermissions(user, this.configurations);
      if (user.isAdministrator) return true;
    }
    return false;
  }

  async suspendUser(user: User): Promise<void> {
    if (!this.canModifyUsers()) return;
    if (user.isAdministrator || this.isAdministratorId(user.userId)) {
      const alert = await this.alertCtrl.create({
        header: this.translate.instant('COMMON.WARNING'),
        message: this.translate.instant('CONFIGURATIONS.CANNOT_SUSPEND_ADMIN'),
        buttons: [this.translate.instant('COMMON.OK')]
      });
      await alert.present();
      return;
    }

    const identifier = this.getUserIdentifier(user);
    const alert = await this.alertCtrl.create({
      header: this.translate.instant('CONFIGURATIONS.SUSPEND_USER_CONFIRM_TITLE'),
      message: this.translate.instant('CONFIGURATIONS.SUSPEND_USER_CONFIRM_MSG', {
        name: identifier,
        userId: user.userId
      }),
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('CONFIGURATIONS.SUSPEND_BUTTON'),
          role: 'destructive',
          handler: async () => {
            const current = (this.configurations.blockedUserIds || []).map(id => id.replace(/^@+/, '').trim().toLowerCase());
            const targetId = user.userId.replace(/^@+/, '').trim().toLowerCase();
            if (!current.includes(targetId)) {
              this.configurations.blockedUserIds = [...current, targetId];
              await this.updateConfigurations();
            }
          }
        }
      ]
    });
    await alert.present();
  }

  async blockUser(user: User): Promise<void> {
    return this.suspendUser(user);
  }

  async restoreUser(userId: string): Promise<void> {
    if (!this.canModifyUsers()) return;
    const targetId = userId.replace(/^@+/, '').trim().toLowerCase();
    const identifier = this.getUserIdentifier(targetId);
    const alert = await this.alertCtrl.create({
      header: this.translate.instant('CONFIGURATIONS.RESTORE_USER_CONFIRM_TITLE'),
      message: this.translate.instant('CONFIGURATIONS.RESTORE_USER_CONFIRM_MSG', {
        name: identifier,
        userId: targetId
      }),
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('CONFIGURATIONS.RESTORE_BUTTON'),
          handler: async () => {
            this.configurations.blockedUserIds = (this.configurations.blockedUserIds || [])
              .map(id => id.replace(/^@+/, '').trim().toLowerCase())
              .filter(id => id !== targetId);
            await this.updateConfigurations();
          }
        }
      ]
    });
    await alert.present();
  }

  async unblockUser(userId: string): Promise<void> {
    return this.restoreUser(userId);
  }

  async promptSuspendUser(): Promise<void> {
    if (!this.canModifyUsers()) return;
    const alert = await this.alertCtrl.create({
      header: this.translate.instant('CONFIGURATIONS.SUSPEND_USER_MANUALLY_TITLE'),
      message: this.translate.instant('CONFIGURATIONS.SUSPEND_USER_MANUALLY_MSG'),
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
          text: this.translate.instant('CONFIGURATIONS.SUSPEND_BUTTON'),
          role: 'destructive',
          handler: async (data: any) => {
            const targetId = (data.userId || '').trim().replace(/^@+/, '').toLowerCase();
            if (!targetId) return false;

            if (this.isAdministratorId(targetId)) {
              const warning = await this.alertCtrl.create({
                header: this.translate.instant('COMMON.WARNING'),
                message: this.translate.instant('CONFIGURATIONS.CANNOT_SUSPEND_ADMIN'),
                buttons: [this.translate.instant('COMMON.OK')]
              });
              await warning.present();
              return false;
            }

            const current = (this.configurations.blockedUserIds || []).map(id => id.replace(/^@+/, '').trim().toLowerCase());
            if (!current.includes(targetId)) {
              this.configurations.blockedUserIds = [...current, targetId];
              await this.updateConfigurations();
            }
            return true;
          }
        }
      ]
    });
    await alert.present();
  }

  async promptAddBlockedUser(): Promise<void> {
    return this.promptSuspendUser();
  }

  canReorderPageSections(): boolean {
    const user = this.app.currentUser;
    if (!user) return false;
    if (user.isAdministrator) return true;
    if (user.isAuditorOnly) return false;

    return (
      DEFAULT_CONFIGURATION_PAGE_SECTIONS_ORDER.every(section => this.canAccessPageSection(section)) &&
      this.pageSections.every(section => this.canAccessPageSection(section))
    );
  }

  async updateConfigurations(
    newConfigurations: Configurations = this.configurations,
    options: { silent?: boolean; noLoading?: boolean } | boolean = false
  ): Promise<boolean> {
    const silent = typeof options === 'boolean' ? options : !!options?.silent;
    const noLoading = typeof options === 'object' ? !!options?.noLoading : false;

    let loading: HTMLIonLoadingElement | null = null;
    if (!noLoading) {
      loading = await this.loadingCtrl.create({ message: this.translate.instant('COMMON.SAVING') });
      await loading.present();
    }
    try {
      this.configurations = await this.configurationsService.update(newConfigurations);
      this.oauthRoleOptions = this.getActiveOAuthRoleOptions();
      this.app.configurations = this.configurations;
      if (this.app.isLanguageForced() && this.app.currentLanguage !== this.app.getForcedLanguage()) {
        await this.app.setLanguage(this.app.getForcedLanguage()!);
      }
      if (this.app.currentUser && !this.app.isImpersonating) {
        User.applyConfigurationPermissions(this.app.currentUser, this.configurations);
      }
      this.app.updateTitle();
      if (!silent) {
        const toast = await this.toastCtrl.create({
          message: this.translate.instant('COMMON.OPERATION_COMPLETED'),
          duration: 3000,
          color: 'success'
        });
        await toast.present();
      }
      return true;
    } catch (err: any) {
      await this.loadData();
      const isConflict =
        err?.status === 409 ||
        err?.statusCode === 409 ||
        err?.error?.message?.includes('CONFIGURATIONS_CONFLICT') ||
        err?.message?.includes('CONFIGURATIONS_CONFLICT') ||
        String(err).includes('CONFIGURATIONS_CONFLICT');

      if (isConflict) {
        const alert = await this.alertCtrl.create({
          header: this.translate.instant('COMMON.OPERATION_FAILED'),
          message: this.translate.instant('CONFIGURATIONS.CONFLICT_ALERT'),
          buttons: [{ text: this.translate.instant('COMMON.CONFIRM'), role: 'cancel' }]
        });
        await alert.present();
      } else {
        const rawMessage =
          err?.error?.message ||
          (typeof err?.error === 'string' ? err.error : null) ||
          err?.message ||
          '';

        let displayMessage = rawMessage || this.translate.instant('COMMON.OPERATION_FAILED');
        if (displayMessage.includes('oauthRoleOptions') || displayMessage.includes('Invalid fields')) {
          displayMessage = `${this.translate.instant('CONFIGURATIONS.INVALID_ROLE_PATTERN')}\n\n(${displayMessage})`;
        }

        const alert = await this.alertCtrl.create({
          header: this.translate.instant('COMMON.OPERATION_FAILED'),
          message: displayMessage,
          buttons: [{ text: this.translate.instant('COMMON.CONFIRM'), role: 'cancel' }]
        });
        await alert.present();
      }
      return false;
    } finally {
      if (loading) {
        await loading.dismiss();
      }
    }
  }

  async openTemplateEmailModal(templateType: EmailTemplateTypes | EmailTemplates): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: EmailTemplateComponent,
      componentProps: {
        templateType,
        readOnly: !this.canModifyTemplates()
      }
    });
    await modal.present();
  }

  //
  // OPTIONS SUBTAB
  //

  isLanguageAvailable(lang: string): boolean {
    if (!this.configurations?.forcedLanguage || this.configurations.forcedLanguage === 'ALL') {
      return true;
    }
    return this.configurations.forcedLanguage === lang;
  }

  async onForcedLanguageChange(newLang: string): Promise<void> {
    if (this.configurations.forcedLanguage === newLang) return;
    const updated = new Configurations(this.configurations);
    updated.forcedLanguage = newLang;
    const success = await this.updateConfigurations(updated);
    if (success && newLang !== 'ALL') {
      await this.app.setLanguage(newLang);
    }
  }

  testDelegationSheetURL(): void {
    if (this.configurations?.delegationSettlementSheetURL) {
      window.open(this.configurations.delegationSettlementSheetURL, '_blank');
    }
  }

  async changeDelegationSheetURL(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: this.translate.instant('CONFIGURATIONS.EDIT_DELEGATION_SHEET_URL'),
      inputs: [
        {
          name: 'url',
          type: 'url',
          placeholder: this.translate.instant('CONFIGURATIONS.DELEGATION_SHEET_URL_PLACEHOLDER'),
          value: this.configurations.delegationSettlementSheetURL || ''
        }
      ],
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('COMMON.SAVE'),
          handler: async (data: { url?: string }) => {
            const trimmed = (data?.url || '').trim();
            if (trimmed && !/^https?:\/\//i.test(trimmed)) {
              const toast = await this.toastCtrl.create({
                message: this.translate.instant('CONFIGURATIONS.ENTER_VALID_URL'),
                duration: 3000,
                color: 'warning'
              });
              await toast.present();
              return false;
            }
            const updated = new Configurations(this.configurations);
            updated.delegationSettlementSheetURL = trimmed;
            await this.updateConfigurations(updated);
            return true;
          }
        }
      ]
    });
    await alert.present();
  }

  async uploadDelegationSheetFile(event: any): Promise<void> {
    const file = event?.target?.files?.[0];
    if (!file) return;

    const loading = await this.loadingCtrl.create({
      message: this.translate.instant('COMMON.UPLOADING')
    });
    await loading.present();

    try {
      const { url } = await this.mediaService.uploadDocument(file);
      const updated = new Configurations(this.configurations);
      updated.delegationSettlementSheetURL = url;
      await this.updateConfigurations(updated);
    } catch (err: any) {
      console.error(err);
      const toast = await this.toastCtrl.create({
        message: err?.error?.message || err?.message || this.translate.instant('COMMON.OPERATION_FAILED'),
        duration: 3500,
        color: 'danger'
      });
      await toast.present();
    } finally {
      await loading.dismiss();
      if (event?.target) event.target.value = '';
    }
  }

  async clearDelegationSheetURL(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: this.translate.instant('COMMON.CONFIRM'),
      message: this.translate.instant('CONFIGURATIONS.CLEAR_DELEGATION_SHEET_URL_CONFIRM'),
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('COMMON.CONFIRM'),
          role: 'destructive',
          handler: async () => {
            const updated = new Configurations(this.configurations);
            updated.delegationSettlementSheetURL = '';
            await this.updateConfigurations(updated);
          }
        }
      ]
    });
    await alert.present();
  }

  testDelegationInstructionsURL(): void {
    if (this.configurations?.delegationInstructionsURL) {
      window.open(this.configurations.delegationInstructionsURL, '_blank');
    }
  }

  async changeDelegationInstructionsURL(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: this.translate.instant('CONFIGURATIONS.EDIT_DELEGATION_INSTRUCTIONS_URL'),
      inputs: [
        {
          name: 'url',
          type: 'url',
          placeholder: this.translate.instant('CONFIGURATIONS.DELEGATION_INSTRUCTIONS_URL_PLACEHOLDER'),
          value: this.configurations.delegationInstructionsURL || ''
        }
      ],
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('COMMON.SAVE'),
          handler: async (data: { url?: string }) => {
            const trimmed = (data?.url || '').trim();
            if (trimmed && !/^https?:\/\//i.test(trimmed)) {
              const toast = await this.toastCtrl.create({
                message: this.translate.instant('CONFIGURATIONS.ENTER_VALID_URL'),
                duration: 3000,
                color: 'warning'
              });
              await toast.present();
              return false;
            }
            const updated = new Configurations(this.configurations);
            updated.delegationInstructionsURL = trimmed;
            await this.updateConfigurations(updated);
            return true;
          }
        }
      ]
    });
    await alert.present();
  }

  async uploadDelegationInstructionsFile(event: any): Promise<void> {
    const file = event?.target?.files?.[0];
    if (!file) return;

    const loading = await this.loadingCtrl.create({
      message: this.translate.instant('COMMON.UPLOADING')
    });
    await loading.present();

    try {
      const { url } = await this.mediaService.uploadDocument(file);
      const updated = new Configurations(this.configurations);
      updated.delegationInstructionsURL = url;
      await this.updateConfigurations(updated);
    } catch (err: any) {
      console.error(err);
      const toast = await this.toastCtrl.create({
        message: err?.error?.message || err?.message || this.translate.instant('COMMON.OPERATION_FAILED'),
        duration: 3500,
        color: 'danger'
      });
      await toast.present();
    } finally {
      await loading.dismiss();
      if (event?.target) event.target.value = '';
    }
  }

  async clearDelegationInstructionsURL(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: this.translate.instant('COMMON.CONFIRM'),
      message: this.translate.instant('CONFIGURATIONS.CLEAR_DELEGATION_INSTRUCTIONS_URL_CONFIRM'),
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('COMMON.CONFIRM'),
          role: 'destructive',
          handler: async () => {
            const updated = new Configurations(this.configurations);
            updated.delegationInstructionsURL = '';
            await this.updateConfigurations(updated);
          }
        }
      ]
    });
    await alert.present();
  }

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

  async changeAppOrganisation(lang: 'en' | 'pl' = 'en'): Promise<void> {
    const isPl = lang === 'pl';
    const headerKey = isPl ? 'CONFIGURATIONS.APP_ORGANISATION_PL' : 'CONFIGURATIONS.APP_ORGANISATION_EN';
    const placeholderKey = isPl ? 'CONFIGURATIONS.APP_ORGANISATION_PL_PLACEHOLDER' : 'CONFIGURATIONS.APP_ORGANISATION_EN_PLACEHOLDER';
    const currentVal = (this.configurations.appOrganisation as any)?.[lang] || '';
    const alert = await this.alertCtrl.create({
      header: this.translate.instant(headerKey),
      inputs: [
        {
          name: 'appOrganisation',
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
            if (!updated.appOrganisation || typeof updated.appOrganisation === 'string') {
              updated.appOrganisation = { en: '', pl: '' };
            }
            updated.appOrganisation[lang] = data.appOrganisation?.trim() || '';
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

  async toggleAppLock(): Promise<void> {
    const targetState = !this.configurations.appLocked;
    const confirmMessage = targetState
      ? this.translate.instant('CONFIGURATIONS.APP_LOCK_CONFIRM')
      : this.translate.instant('CONFIGURATIONS.APP_UNLOCK_CONFIRM');

    const alert = await this.alertCtrl.create({
      header: this.translate.instant('CONFIGURATIONS.APP_LOCK'),
      message: confirmMessage,
      buttons: [
        {
          text: this.translate.instant('COMMON.CANCEL'),
          role: 'cancel'
        },
        {
          text: this.translate.instant('COMMON.CONFIRM'),
          handler: async () => {
            const updated = new Configurations(this.configurations);
            updated.appLocked = targetState;
            await this.updateConfigurations(updated);
          }
        }
      ]
    });
    await alert.present();
  }

  async changeAppLockMessage(): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: AppLockMessageModalComponent,
      componentProps: {
        message: this.configurations.appLockMessage
      }
    });

    await modal.present();
    const { data } = await modal.onWillDismiss();
    if (data?.message) {
      const updated = new Configurations(this.configurations);
      updated.appLockMessage = data.message;
      await this.updateConfigurations(updated);
    }
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

  async uploadOrganisationLogo(event: any): Promise<void> {
    const file = event.target?.files?.[0];
    if (!file) return;

    const loading = await this.loadingCtrl.create({ message: this.translate.instant('COMMON.UPLOADING') });
    await loading.present();
    try {
      const imageURI = await this.mediaService.uploadImage(file);
      const updated = new Configurations(this.configurations);
      updated.organisationLogoURL = this.app.getImageURLByURI(imageURI);
      await this.updateConfigurations(updated);
    } finally {
      await loading.dismiss();
      event.target.value = '';
    }
  }

  async resetOrganisationLogo(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: this.translate.instant('CONFIGURATIONS.RESET_ORGANISATION_LOGO'),
      message: this.translate.instant('CONFIGURATIONS.RESET_ORGANISATION_LOGO_I'),
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('COMMON.RESET'),
          handler: async () => {
            const updated = new Configurations(this.configurations);
            updated.organisationLogoURL = '';
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
    await this.updateConfigurations(updated, { silent: true, noLoading: true });
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
            const userId = data.userId?.trim().replace(/^@+/, '').toLowerCase();
            if (!userId) return;
            const updated = new Configurations(this.configurations);
            updated.blockedUserIds = (updated.blockedUserIds || []).filter(
              id => id.replace(/^@+/, '').trim().toLowerCase() !== userId
            );
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
    const cleanId = (userId || '').replace(/^@+/, '').trim().toLowerCase();
    const alert = await this.alertCtrl.create({
      header: this.translate.instant('COMMON.CONFIRM'),
      message: this.translate.instant('CONFIGURATIONS.REMOVE_ADMINISTRATOR_CONFIRM', { userId: cleanId }),
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('COMMON.DELETE'),
          role: 'destructive',
          handler: async () => {
            const updated = new Configurations(this.configurations);
            updated.administratorsIds = updated.administratorsIds.filter(id => id.replace(/^@+/, '').trim().toLowerCase() !== cleanId);
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
            const userId = data.userId?.trim().replace(/^@+/, '').toLowerCase();
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
    const cleanId = (userId || '').replace(/^@+/, '').trim().toLowerCase();
    const alert = await this.alertCtrl.create({
      header: this.translate.instant('COMMON.CONFIRM'),
      message: this.translate.instant('CONFIGURATIONS.REMOVE_MANAGER_CONFIRM', { userId: cleanId }),
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('COMMON.DELETE'),
          role: 'destructive',
          handler: async () => {
            const updated = new Configurations(this.configurations);
            updated.managersIds = updated.managersIds.filter(id => id.replace(/^@+/, '').trim().toLowerCase() !== cleanId);
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
            const userId = data.userId?.trim().replace(/^@+/, '').toLowerCase();
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
    const cleanId = (userId || '').replace(/^@+/, '').trim().toLowerCase();
    const alert = await this.alertCtrl.create({
      header: this.translate.instant('COMMON.CONFIRM'),
      message: this.translate.instant('CONFIGURATIONS.REMOVE_AUDITOR_CONFIRM', { userId: cleanId }),
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('COMMON.DELETE'),
          role: 'destructive',
          handler: async () => {
            const updated = new Configurations(this.configurations);
            updated.auditorsIds = updated.auditorsIds.filter(id => id.replace(/^@+/, '').trim().toLowerCase() !== cleanId);
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
    const readOnly = !this.canModifyRoles();

    const modal = await this.modalCtrl.create({
      component: RoleEditorComponent,
      componentProps: {
        mode: 'automatic',
        roleId,
        assignment: existing || { roleId, extendedRolePatterns: [] },
        requirePatterns,
        readOnly,
        casPermissionOptions: this.configurations?.getOAuthRoleOptions()
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
      componentProps: {
        mode: 'custom',
        casPermissionOptions: this.configurations?.getOAuthRoleOptions()
      }
    });
    await modal.present();
    const { data } = await modal.onDidDismiss();
    if (!data?.role) return;

    const updated = new Configurations(this.configurations);
    updated.customRoles = [...(updated.customRoles || []), data.role];
    await this.updateConfigurations(updated);
  }

  async manageCustomRole(role: CustomRole): Promise<void> {
    const readOnly = !this.canModifyRoles();
    const modal = await this.modalCtrl.create({
      component: RoleEditorComponent,
      componentProps: {
        mode: 'custom',
        role,
        readOnly,
        casPermissionOptions: this.configurations?.getOAuthRoleOptions()
      }
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

  getActiveOAuthRoleOptions(): string[] {
    return this.configurations?.getOAuthRoleOptions() || OAUTH_ROLE_OPTIONS;
  }

  async addOAuthRoleOption(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: this.translate.instant('CONFIGURATIONS.ADD_OAUTH_ROLE'),
      inputs: [
        {
          name: 'rolePattern',
          type: 'text',
          placeholder: this.translate.instant('CONFIGURATIONS.ROLE_OPTION_PLACEHOLDER')
        }
      ],
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('COMMON.ADD'),
          handler: async data => {
            const role = data.rolePattern?.trim();
            if (!role) return;
            const current = [...this.getActiveOAuthRoleOptions()];
            if (!current.includes(role)) {
              current.push(role);
              const updated = new Configurations(this.configurations);
              updated.oauthRoleOptions = current;
              await this.updateConfigurations(updated);
            }
            return true;
          }
        }
      ]
    });
    await alert.present();
  }

  async editOAuthRoleOptions(rolesToEdit?: string[]): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: OAuthRolesModalComponent,
      componentProps: {
        roles: rolesToEdit || this.getActiveOAuthRoleOptions()
      }
    });
    await modal.present();
    const { data } = await modal.onDidDismiss();
    if (data?.roles) {
      const updated = new Configurations(this.configurations);
      updated.oauthRoleOptions = data.roles;
      const success = await this.updateConfigurations(updated);
      if (!success) {
        await this.editOAuthRoleOptions(data.roles);
      }
    }
  }

  async removeOAuthRoleOption(index: number): Promise<void> {
    const current = [...this.getActiveOAuthRoleOptions()];
    if (index >= 0 && index < current.length) {
      current.splice(index, 1);
      const updated = new Configurations(this.configurations);
      updated.oauthRoleOptions = current;
      await this.updateConfigurations(updated);
    }
  }

  async resetOAuthRoleOptionsToDefault(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: this.translate.instant('COMMON.CONFIRM'),
      message: this.translate.instant('CONFIGURATIONS.RESET_OAUTH_ROLES_CONFIRM'),
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('CONFIGURATIONS.RESET_TO_DEFAULTS'),
          role: 'destructive',
          handler: async () => {
            const updated = new Configurations(this.configurations);
            updated.oauthRoleOptions = [...OAUTH_ROLE_OPTIONS];
            await this.updateConfigurations(updated);
          }
        }
      ]
    });
    await alert.present();
  }

  async reorderOAuthRoleOptions(event: any): Promise<void> {
    const reordered = event.detail.complete(this.oauthRoleOptions);
    this.oauthRoleOptions = reordered;
    const updated = new Configurations(this.configurations);
    updated.oauthRoleOptions = reordered;
    await this.updateConfigurations(updated, { silent: true, noLoading: true });
  }
}
