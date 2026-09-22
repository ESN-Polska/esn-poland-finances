import { Component, OnInit } from '@angular/core';
import { ToastController } from '@ionic/angular';
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
  public bankDetails = {
    accountHolderName: '',
    accountHolderAddress: '',
    iban: '',
    swiftBic: ''
  };
  public bankAccountType: 'DOMESTIC' | 'INTERNATIONAL' = 'DOMESTIC';
  public isSaving = false;
  public hasAttemptedSubmit = false;

  constructor(
    public app: AppService,
    private toastCtrl: ToastController,
    private translate: TranslateService
  ) {}

  public openAccountsProfile(userId?: string): void {
    if (userId) {
      window.open(`https://accounts.esn.org/user/${encodeURIComponent(userId)}`, '_blank', 'noopener,noreferrer');
    }
  }

  public async ngOnInit(): Promise<void> {
    const saved = await this.app.getDefaultBankDetails();
    if (saved) {
      this.bankDetails = { ...this.bankDetails, ...saved };
      this.bankAccountType =
        saved.swiftBic || (saved.iban && /^[A-Za-z]{2}/.test(saved.iban.trim()) && !saved.iban.trim().toUpperCase().startsWith('PL'))
          ? 'INTERNATIONAL'
          : 'DOMESTIC';
    } else if (this.user) {
      // Pre-populate name if empty
      this.bankDetails.accountHolderName = this.user.getDisplayName();
    }
  }

  public setBankAccountType(type: 'DOMESTIC' | 'INTERNATIONAL'): void {
    this.bankAccountType = type;
    if (type === 'DOMESTIC') {
      this.bankDetails.swiftBic = '';
    }
    if (this.bankDetails.iban) {
      this.bankDetails.iban = this.formatIban(this.bankDetails.iban, type);
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
    const cleaned = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    let letters = '';
    let digits = '';
    for (let i = 0; i < cleaned.length; i++) {
      const char = cleaned[i];
      if (letters.length < 2) {
        if (/[A-Z]/.test(char)) {
          letters += char;
        }
      } else {
        if (/[0-9]/.test(char)) {
          digits += char;
        }
      }
    }
    digits = digits.slice(0, 32);
    const combined = letters + digits;
    return combined.match(/.{1,4}/g)?.join(' ') || combined;
  }

  public formatSwift(value: string): string {
    if (!value) return '';
    return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11);
  }

  public formatIban(value: string, forceType?: 'DOMESTIC' | 'INTERNATIONAL'): string {
    const type = forceType || this.bankAccountType;
    if (type === 'DOMESTIC') {
      return this.formatDomesticAccount(value);
    }
    return this.formatInternationalIban(value);
  }

  public onIbanInput(event: any): void {
    const raw = event.target?.value || '';
    this.bankDetails.iban = this.bankAccountType === 'DOMESTIC'
      ? this.formatDomesticAccount(raw)
      : this.formatInternationalIban(raw);
  }

  public onSwiftInput(event: any): void {
    const raw = event.target?.value || '';
    this.bankDetails.swiftBic = this.formatSwift(raw);
  }

  public isValidDomesticAccount(val: string | undefined): boolean {
    const clean = (val || '').replace(/\D/g, '');
    return clean.length === 26;
  }

  public isValidInternationalIban(val: string | undefined): boolean {
    const clean = (val || '').replace(/\s+/g, '').toUpperCase();
    return /^[A-Z]{2}[0-9]{13,32}$/.test(clean);
  }

  public isValidSwift(val: string | undefined): boolean {
    const clean = (val || '').replace(/\s+/g, '').toUpperCase();
    return /^[A-Z0-9]{8}$|^[A-Z0-9]{11}$/.test(clean);
  }

  public isFieldInvalid(field: string): boolean {
    if (!this.hasAttemptedSubmit) return false;
    switch (field) {
      case 'accountHolderName':
        return !this.bankDetails.accountHolderName?.trim();
      case 'accountHolderAddress':
        return !this.bankDetails.accountHolderAddress?.trim();
      case 'iban':
        return this.bankAccountType === 'DOMESTIC'
          ? !this.isValidDomesticAccount(this.bankDetails.iban)
          : !this.isValidInternationalIban(this.bankDetails.iban);
      case 'swiftBic':
        return this.bankAccountType === 'INTERNATIONAL' && !this.isValidSwift(this.bankDetails.swiftBic);
      default:
        return false;
    }
  }

  public async saveBankDetails(): Promise<void> {
    this.hasAttemptedSubmit = true;

    const isDomestic = this.bankAccountType === 'DOMESTIC';
    const isNameInvalid = !this.bankDetails.accountHolderName?.trim();
    const isAddressInvalid = !this.bankDetails.accountHolderAddress?.trim();
    const isIbanInvalid = isDomestic
      ? !this.isValidDomesticAccount(this.bankDetails.iban)
      : !this.isValidInternationalIban(this.bankDetails.iban);
    const isSwiftInvalid = !isDomestic && !this.isValidSwift(this.bankDetails.swiftBic);

    if (isNameInvalid || isAddressInvalid || isIbanInvalid || isSwiftInvalid) {
      await this.showToast('REQUESTS.VALIDATION.FILL_ALL_REQUIRED', 'warning');
      this.scrollToInvalid();
      return;
    }

    if (isDomestic) {
      this.bankDetails.swiftBic = '';
    }

    this.isSaving = true;
    try {
      await this.app.saveDefaultBankDetails(this.bankDetails);
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
