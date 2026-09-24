import { Component, OnInit } from '@angular/core';
import { ActionSheetController, ModalController, ToastController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { User } from '@models/user.model';
import { AppService } from '../../app.service';

@Component({
  selector: 'app-profile-tab',
  templateUrl: './profile.page.html',
  styleUrls: ['./profile.page.scss']
})
export class ProfilePage implements OnInit {
  public get user(): User | null {
    return this.app.currentUser;
  }
  public avatarError = false;
  
  public activeCurrencyTab: 'PLN' | 'EUR' = 'PLN';

  public plnBankDetails = {
    accountHolderName: '',
    accountHolderAddress: '',
    iban: '',
    swiftBic: ''
  };
  public plnBankAccountType: 'DOMESTIC' | 'INTERNATIONAL' = 'DOMESTIC';

  public eurBankDetails = {
    accountHolderName: '',
    accountHolderAddress: '',
    iban: '',
    swiftBic: ''
  };
  public eurBankAccountType: 'DOMESTIC' | 'INTERNATIONAL' = 'DOMESTIC';

  public isSaving = false;
  public hasAttemptedSubmit = false;

  constructor(
    public app: AppService,
    private actionSheetCtrl: ActionSheetController,
    private toastCtrl: ToastController,
    private modalCtrl: ModalController,
    private translate: TranslateService
  ) {}

  public async openSupportContact(): Promise<void> {
    const email = this.app.configurations?.supportEmail?.trim();
    if (!email) return;

    const actionSheet = await this.actionSheetCtrl.create({
      header: this.translate.instant('SUPPORT.TITLE'),
      subHeader: email,
      buttons: [
        {
          text: this.translate.instant('SUPPORT.ACTION_SEND'),
          icon: 'mail-outline',
          handler: () => {
            const appTitle = this.app.configurations?.getAppTitle(this.app.currentLanguage) || 'ESN Finances';
            const userIdentifier = this.user ? `${this.user.getDisplayName()} (@${this.user.userId})` : 'User';
            const subject = encodeURIComponent(`[${appTitle}] Support Request - ${userIdentifier}`);
            window.location.href = `mailto:${email}?subject=${subject}`;
          }
        },
        {
          text: this.translate.instant('SUPPORT.ACTION_COPY'),
          icon: 'copy-outline',
          handler: () => {
            if (navigator?.clipboard?.writeText) {
              navigator.clipboard.writeText(email).then(() => {
                this.showToast('SUPPORT.EMAIL_COPIED', 'success');
              }).catch(() => {
                this.showToast('SUPPORT.EMAIL_COPIED', 'success');
              });
            } else {
              this.showToast('SUPPORT.EMAIL_COPIED', 'success');
            }
          }
        },
        {
          text: this.translate.instant('COMMON.CANCEL'),
          icon: 'close-outline',
          role: 'cancel'
        }
      ]
    });
    await actionSheet.present();
  }

  public async openCredits(): Promise<void> {
    const { CreditsPage } = await import('../credits/credits.page');
    const modal = await this.modalCtrl.create({ component: CreditsPage, cssClass: 'creditsModal' });
    await modal.present();
  }

  public openAccountsProfile(userId?: string): void {
    if (this.app.currentUser?.isGuest || userId?.startsWith('guest_')) return;
    if (userId) {
      window.open(`https://accounts.esn.org/user/${encodeURIComponent(userId)}`, '_blank', 'noopener,noreferrer');
    }
  }

  public async ngOnInit(): Promise<void> {
    const saved = await this.app.getDefaultBankDetails();
    if (saved) {
      if (saved.pln) {
        this.plnBankDetails = {
          accountHolderName: saved.pln.accountHolderName || '',
          accountHolderAddress: saved.pln.accountHolderAddress || '',
          iban: saved.pln.iban || '',
          swiftBic: saved.pln.swiftBic || ''
        };
        this.plnBankAccountType =
          saved.pln.accountType ||
          (saved.pln.swiftBic || (saved.pln.iban && /^[A-Za-z]{2}/.test(saved.pln.iban.trim()) && !saved.pln.iban.trim().toUpperCase().startsWith('PL'))
            ? 'INTERNATIONAL'
            : 'DOMESTIC');
      }
      if (saved.eur) {
        this.eurBankDetails = {
          accountHolderName: saved.eur.accountHolderName || '',
          accountHolderAddress: saved.eur.accountHolderAddress || '',
          iban: saved.eur.iban || '',
          swiftBic: saved.eur.swiftBic || ''
        };
        this.eurBankAccountType =
          saved.eur.accountType ||
          (saved.eur.swiftBic || (saved.eur.iban && /^[A-Za-z]{2}/.test(saved.eur.iban.trim()) && !saved.eur.iban.trim().toUpperCase().startsWith('PL'))
            ? 'INTERNATIONAL'
            : 'DOMESTIC');
      }
    }
    if (this.user) {
      if (!saved?.pln && !this.plnBankDetails.accountHolderName) {
        this.plnBankDetails.accountHolderName = this.user.getDisplayName();
      }
      if (!saved?.eur && !this.eurBankDetails.accountHolderName) {
        this.eurBankDetails.accountHolderName = this.user.getDisplayName();
      }
    }
  }

  public setPlnBankAccountType(type: 'DOMESTIC' | 'INTERNATIONAL'): void {
    this.plnBankAccountType = type;
    if (type === 'DOMESTIC') {
      this.plnBankDetails.swiftBic = '';
    }
    if (this.plnBankDetails.iban) {
      this.plnBankDetails.iban = this.formatIban(this.plnBankDetails.iban, type);
    }
  }

  public setEurBankAccountType(type: 'DOMESTIC' | 'INTERNATIONAL'): void {
    this.eurBankAccountType = type;
    if (type === 'DOMESTIC') {
      this.eurBankDetails.swiftBic = '';
    }
    if (this.eurBankDetails.iban) {
      this.eurBankDetails.iban = this.formatIban(this.eurBankDetails.iban, type);
    }
  }

  public formatDomesticAccount(value: string): string {
    if (!value) return '';
    const digits = value.replace(/\D/g, '').slice(0, 26);
    if (digits.length <= 2) return digits;
    const firstTwo = digits.slice(0, 2);
    const rest = digits.slice(2);
    const restGroups = rest.match(/.{1,4}/g);
    return restGroups ? `${firstTwo} ${restGroups.join(' ')}` : firstTwo;
  }

  public formatInternationalIban(value: string): string {
    if (!value) return '';
    const cleaned = value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 34);
    return cleaned.match(/.{1,4}/g)?.join(' ') || cleaned;
  }

  public formatSwift(value: string): string {
    if (!value) return '';
    return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11);
  }

  public formatIban(value: string, forceType?: 'DOMESTIC' | 'INTERNATIONAL'): string {
    const type = forceType || this.plnBankAccountType;
    if (type === 'DOMESTIC') {
      return this.formatDomesticAccount(value);
    }
    return this.formatInternationalIban(value);
  }

  public onPlnIbanInput(event: any): void {
    const raw = event.target?.value || '';
    this.plnBankDetails.iban = this.plnBankAccountType === 'DOMESTIC'
      ? this.formatDomesticAccount(raw)
      : this.formatInternationalIban(raw);
  }

  public onEurIbanInput(event: any): void {
    const raw = event.target?.value || '';
    this.eurBankDetails.iban = this.eurBankAccountType === 'DOMESTIC'
      ? this.formatDomesticAccount(raw)
      : this.formatInternationalIban(raw);
  }

  public onPlnSwiftInput(event: any): void {
    const raw = event.target?.value || '';
    this.plnBankDetails.swiftBic = this.formatSwift(raw);
  }

  public onEurSwiftInput(event: any): void {
    const raw = event.target?.value || '';
    this.eurBankDetails.swiftBic = this.formatSwift(raw);
  }

  public isValidDomesticAccount(val: string | undefined): boolean {
    const clean = (val || '').replace(/\D/g, '');
    return clean.length === 26;
  }

  public isValidInternationalIban(val: string | undefined): boolean {
    const clean = (val || '').replace(/\s+/g, '').toUpperCase();
    return /^[A-Z]{2}[A-Z0-9]{13,32}$/.test(clean);
  }

  public isValidSwift(val: string | undefined): boolean {
    const clean = (val || '').replace(/\s+/g, '').toUpperCase();
    return /^[A-Z0-9]{8}$|^[A-Z0-9]{11}$/.test(clean);
  }

  public isPlnFieldInvalid(field: string): boolean {
    if (!this.hasAttemptedSubmit) return false;
    switch (field) {
      case 'accountHolderName':
        return false;
      case 'accountHolderAddress':
        return false;
      case 'iban':
        if (!this.plnBankDetails.iban?.trim()) return false;
        return this.plnBankAccountType === 'DOMESTIC'
          ? !this.isValidDomesticAccount(this.plnBankDetails.iban)
          : !this.isValidInternationalIban(this.plnBankDetails.iban);
      case 'swiftBic':
        if (!this.plnBankDetails.swiftBic?.trim()) return false;
        return this.plnBankAccountType === 'INTERNATIONAL' && !this.isValidSwift(this.plnBankDetails.swiftBic);
      default:
        return false;
    }
  }

  public isEurFieldInvalid(field: string): boolean {
    if (!this.hasAttemptedSubmit) return false;
    switch (field) {
      case 'accountHolderName':
        return false;
      case 'accountHolderAddress':
        return false;
      case 'iban':
        if (!this.eurBankDetails.iban?.trim()) return false;
        return this.eurBankAccountType === 'DOMESTIC'
          ? !this.isValidDomesticAccount(this.eurBankDetails.iban)
          : !this.isValidInternationalIban(this.eurBankDetails.iban);
      case 'swiftBic':
        if (this.eurBankAccountType !== 'INTERNATIONAL' || !this.eurBankDetails.swiftBic?.trim()) return false;
        return !this.isValidSwift(this.eurBankDetails.swiftBic);
      default:
        return false;
    }
  }

  public async saveBankDetails(): Promise<void> {
    this.hasAttemptedSubmit = true;

    // Validate PLN formats if filled
    const isPlnIbanInvalid = this.isPlnFieldInvalid('iban');
    const isPlnSwiftInvalid = this.isPlnFieldInvalid('swiftBic');

    if (isPlnIbanInvalid || isPlnSwiftInvalid) {
      this.activeCurrencyTab = 'PLN';
      await this.showToast('REQUESTS.VALIDATION.INVALID_IBAN', 'warning');
      this.scrollToInvalid();
      return;
    }

    // Validate EUR formats if filled
    const isEurIbanInvalid = this.isEurFieldInvalid('iban');
    const isEurSwiftInvalid = this.isEurFieldInvalid('swiftBic');

    if (isEurIbanInvalid || isEurSwiftInvalid) {
      this.activeCurrencyTab = 'EUR';
      await this.showToast('REQUESTS.VALIDATION.INVALID_IBAN', 'warning');
      this.scrollToInvalid();
      return;
    }

    if (this.plnBankAccountType === 'DOMESTIC') {
      this.plnBankDetails.swiftBic = '';
    }
    if (this.eurBankAccountType === 'DOMESTIC') {
      this.eurBankDetails.swiftBic = '';
    }

    const hasAnyPlnField =
      !!this.plnBankDetails.accountHolderName?.trim() ||
      !!this.plnBankDetails.accountHolderAddress?.trim() ||
      !!this.plnBankDetails.iban?.trim() ||
      !!this.plnBankDetails.swiftBic?.trim() ||
      this.plnBankAccountType === 'INTERNATIONAL';

    const hasAnyEurField =
      !!this.eurBankDetails.accountHolderName?.trim() ||
      !!this.eurBankDetails.accountHolderAddress?.trim() ||
      !!this.eurBankDetails.iban?.trim() ||
      !!this.eurBankDetails.swiftBic?.trim() ||
      this.eurBankAccountType === 'INTERNATIONAL';

    this.isSaving = true;
    try {
      await this.app.saveDefaultBankDetails({
        pln: hasAnyPlnField ? {
          ...this.plnBankDetails,
          accountType: this.plnBankAccountType
        } : undefined,
        eur: hasAnyEurField ? {
          ...this.eurBankDetails,
          accountType: this.eurBankAccountType
        } : undefined
      });
      this.hasAttemptedSubmit = false;
      await this.showToast('PROFILE.BANK_SAVED_SUCCESS', 'success');
    } catch (err) {
      console.error('Failed to save bank details', err);
      await this.showToast('Error saving bank details', 'danger');
    } finally {
      this.isSaving = false;
    }
  }

  private scrollToInvalid(): void {
    setTimeout(() => {
      const firstInvalid = document.querySelector('.is-invalid');
      if (firstInvalid) {
        firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
  }

  private async showToast(messageKey: string, color: string): Promise<void> {
    const msg = this.translate.instant(messageKey);
    const toast = await this.toastCtrl.create({
      message: msg && msg !== messageKey ? msg : messageKey,
      duration: 3000,
      position: 'bottom',
      color
    });
    await toast.present();
  }
}
