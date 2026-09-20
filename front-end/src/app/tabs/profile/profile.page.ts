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
  public user: User | null = null;
  public bankDetails = {
    accountHolderName: '',
    accountHolderAddress: '',
    iban: '',
    swiftBic: ''
  };
  public isSaving = false;

  constructor(
    public app: AppService,
    private toastCtrl: ToastController,
    private translate: TranslateService
  ) {}

  public async ngOnInit(): Promise<void> {
    this.user = this.app.currentUser;
    const saved = await this.app.getDefaultBankDetails();
    if (saved) {
      this.bankDetails = { ...this.bankDetails, ...saved };
    } else if (this.user) {
      // Pre-populate name if empty
      this.bankDetails.accountHolderName = this.user.getDisplayName();
    }
  }

  public async saveBankDetails(): Promise<void> {
    this.isSaving = true;
    try {
      await this.app.saveDefaultBankDetails(this.bankDetails);
      const toast = await this.toastCtrl.create({
        message: this.translate.instant('PROFILE.BANK_SAVED_SUCCESS'),
        duration: 3000,
        position: 'bottom',
        color: 'success'
      });
      await toast.present();
    } catch (err) {
      console.error('Failed to save bank details', err);
    } finally {
      this.isSaving = false;
    }
  }
}
