import { Component, HostBinding, HostListener, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { MenuController, ModalController } from '@ionic/angular';
import { Subscription } from 'rxjs';
import { AppPermission } from '@models/configurations.model';
import { User } from '@models/user.model';
import { AppService } from '../app.service';

@Component({
  selector: 'app-tabs',
  templateUrl: 'tabs.component.html',
  styleUrls: ['tabs.component.scss']
})
export class TabsComponent implements OnInit, OnDestroy {
  public avatarError = false;
  public isMenuOpen = false;
  private userSub?: Subscription;
  private hasPromptedPrimarySection = false;

  @HostBinding('class.has-impersonation')
  public get hasImpersonation(): boolean {
    return this.app.isImpersonating;
  }

  constructor(
    public app: AppService,
    private menuCtrl: MenuController,
    private modalCtrl: ModalController,
    private router: Router
  ) {}

  public ngOnInit(): void {
    this.userSub = this.app.user$.subscribe(user => {
      this.checkAndPromptPrimarySection(user);
    });
  }

  public ngOnDestroy(): void {
    if (this.userSub) {
      this.userSub.unsubscribe();
    }
  }

  private async checkAndPromptPrimarySection(user: User | null): Promise<void> {
    if (!this.app.isReady || this.hasPromptedPrimarySection || this.app.isImpersonating) return;
    if (!user || user.isGuest) return;

    const availableSections = user.availableSections || [];
    const currentCode = user.sectionCode || user.section;
    const isCurrentSectionValid =
      availableSections.length === 0 ||
      availableSections.some(s => s.code === currentCode || s.name === currentCode);

    if (availableSections.length === 1 && !isCurrentSectionValid) {
      const only = availableSections[0];
      user.sectionCode = only.code;
      user.section = only.name;
      user.primarySectionChosen = true;
      this.app.updateCurrentUserRecord(user).catch(() => {});
      return;
    }

    if (
      (!user.primarySectionChosen || !isCurrentSectionValid) &&
      availableSections.length > 1
    ) {
      this.hasPromptedPrimarySection = true;
      try {
        const { SelectPrimarySectionModalComponent } = await import(
          './select-primary-section-modal/select-primary-section-modal.component'
        );
        const modal = await this.modalCtrl.create({
          component: SelectPrimarySectionModalComponent,
          componentProps: { user },
          cssClass: 'selectPrimarySectionModal',
          backdropDismiss: false
        });
        await modal.present();
      } catch (err) {
        console.error('Failed to open select primary section modal', err);
      }
    }
  }

  @HostListener('window:resize')
  public onResize(): void {
    // Triggers change detection on resize to smoothly adapt mode
  }

  public async toggleMenu(): Promise<void> {
    const isOpen = await this.menuCtrl.isOpen('mainMenu');
    if (isOpen || this.isMenuOpen) {
      await this.closeMenu();
    } else {
      await this.openMenu();
    }
  }

  public async openMenu(): Promise<void> {
    this.isMenuOpen = true;
    await this.menuCtrl.open('mainMenu');
  }

  public async closeMenu(): Promise<void> {
    this.isMenuOpen = false;
    await this.menuCtrl.close('mainMenu');
  }

  public async toggleLanguage(): Promise<void> {
    await this.app.toggleLanguage();
  }

  public async navigateAndClose(route: string | any[]): Promise<void> {
    await this.closeMenu();
    this.app.goTo(route);
  }

  public isCurrentRoute(path: string): boolean {
    return this.router.url.startsWith(path);
  }

  public openAccountsProfile(userId?: string): void {
    if (this.app.currentUser?.isGuest || userId?.startsWith('guest_')) return;
    if (userId) {
      window.open(`https://accounts.esn.org/user/${encodeURIComponent(userId)}`, '_blank', 'noopener,noreferrer');
    }
  }

  public canAccessConfigurations(): boolean {
    const user = this.app.currentUser;
    if (!user) return false;
    return (
      user.isAdministrator ||
      user.isAuditor ||
      user.hasPermission(AppPermission.CONFIGURATIONS.PARENT) ||
      user.hasPermission(AppPermission.CONFIGURATIONS.OPTIONS) ||
      user.hasPermission(AppPermission.CONFIGURATIONS.USERS) ||
      user.hasPermission(AppPermission.CONFIGURATIONS.ROLES) ||
      user.hasPermission(AppPermission.CONFIGURATIONS.GUESTS) ||
      user.hasPermission(AppPermission.CONFIGURATIONS.RESOURCES) ||
      user.hasPermission(AppPermission.CONFIGURATIONS.TEMPLATES)
    );
  }

  public async logout(): Promise<void> {
    await this.closeMenu();
    await this.app.logout();
  }
}
