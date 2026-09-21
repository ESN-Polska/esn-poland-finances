import { Component, HostListener } from '@angular/core';
import { Router } from '@angular/router';
import { MenuController } from '@ionic/angular';
import { AppPermission } from '@models/configurations.model';
import { AppService } from '../app.service';

@Component({
  selector: 'app-tabs',
  templateUrl: 'tabs.component.html',
  styleUrls: ['tabs.component.scss']
})
export class TabsComponent {
  public avatarError = false;
  public isMenuOpen = false;

  constructor(
    public app: AppService,
    private menuCtrl: MenuController,
    private router: Router
  ) {}

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
      user.hasPermission(AppPermission.CONFIGURATIONS.USERS)
    );
  }

  public async logout(): Promise<void> {
    await this.closeMenu();
    await this.app.logout();
  }
}
