import { Component, OnInit, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController, ToastController } from '@ionic/angular';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AppService } from '../../app.service';
import { UsersService } from '../../common/users.service';
import { User, UserMembershipGroup } from '@models/user.model';

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, TranslateModule],
  selector: 'app-select-primary-section-modal',
  templateUrl: './select-primary-section-modal.component.html',
  styleUrls: ['./select-primary-section-modal.component.scss']
})
export class SelectPrimarySectionModalComponent implements OnInit {
  @Input() public user?: User;
  public selectedCode = '';
  public isSaving = false;
  public sections: UserMembershipGroup[] = [];

  private readonly app = inject(AppService);
  private readonly usersService = inject(UsersService);
  private readonly modalCtrl = inject(ModalController);
  private readonly toastCtrl = inject(ToastController);
  private readonly translate = inject(TranslateService);

  public ngOnInit(): void {
    const user = this.user || this.app.currentUser;
    this.sections = user?.availableSections || [];

    // Preselect current primary section if available, else first
    const currentCode = user?.sectionCode || user?.section;
    if (currentCode && this.sections.some(s => s.code === currentCode || s.name === currentCode)) {
      this.selectedCode = currentCode;
    } else if (this.sections.length > 0) {
      this.selectedCode = this.sections[0].code || this.sections[0].name;
    }
  }

  public getSectionCountry(sectionCode: string): string {
    const user = this.user || this.app.currentUser;
    if (!user || !sectionCode) return '';
    const prefix = sectionCode.split('-')[0]?.toUpperCase().trim();
    if (!prefix || prefix.length < 2) return '';

    const countries = user.availableCountries || [];
    const match = countries.find(c => {
      const code = (c.code || '').toUpperCase().trim();
      const name = (c.name || '').toUpperCase().trim();
      return (
        code === prefix ||
        code === `ESN ${prefix}` ||
        code.startsWith(prefix) ||
        name === prefix ||
        name === `ESN ${prefix}` ||
        name.startsWith(`ESN ${prefix} `) ||
        name.endsWith(` (${prefix})`)
      );
    });

    if (match) {
      return match.name || match.code;
    }
    if (user.country && user.country.toUpperCase().includes(prefix)) {
      return user.country;
    }
    return '';
  }

  public async confirm(): Promise<void> {
    const user = this.user || this.app.currentUser;
    if (!user || !this.selectedCode) return;

    const target = this.sections.find(
      s => s.code === this.selectedCode || s.name === this.selectedCode
    );
    const sectionCode = target?.code || this.selectedCode;
    const section = target?.name || this.selectedCode;
    const alignedCountry = this.getSectionCountry(sectionCode);

    this.isSaving = true;
    try {
      const payload: {
        sectionCode: string;
        section: string;
        country?: string;
        primarySectionChosen: boolean;
      } = {
        sectionCode,
        section,
        primarySectionChosen: true
      };
      if (alignedCountry) {
        payload.country = alignedCountry;
      }

      const updatedUser = await this.usersService.updateOrigin(user.userId, payload);
      if (updatedUser) {
        updatedUser.primarySectionChosen = true;
        await this.app.updateCurrentUserRecord(updatedUser);
      } else {
        user.sectionCode = sectionCode;
        user.section = section;
        if (alignedCountry) user.country = alignedCountry;
        user.primarySectionChosen = true;
        await this.app.updateCurrentUserRecord(user);
      }

      const toast = await this.toastCtrl.create({
        message: this.translate.instant('USER.PRIMARY_SECTION_CONFIRMED'),
        duration: 3000,
        position: 'bottom',
        color: 'success'
      });
      await toast.present();
      await this.modalCtrl.dismiss({ confirmed: true, section, sectionCode });
    } catch (err) {
      console.error('Failed to confirm primary section', err);
      const toast = await this.toastCtrl.create({
        message: this.translate.instant('USER.ORIGIN_UPDATE_FAILED'),
        duration: 4000,
        position: 'bottom',
        color: 'danger'
      });
      await toast.present();
    } finally {
      this.isSaving = false;
    }
  }

  public close(): void {
    this.modalCtrl.dismiss({ confirmed: false });
  }
}
