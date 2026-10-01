import { Component, Input, OnInit } from '@angular/core';
import { ModalController, ToastController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { BankExportSettings, DEFAULT_BANK_EXPORT_SETTINGS } from '@models/configurations.model';
import { AppService } from '@app/app.service';
import {
  BankTransactionItem,
  RequestsService,
  cleanPolishBankAccount,
  transliteratePolishToAscii
} from '@app/services/requests.service';

@Component({
  selector: 'app-bank-export-modal',
  templateUrl: './bank-export-modal.component.html',
  styleUrls: ['./bank-export-modal.component.scss']
})
export class BankExportModalComponent implements OnInit {
  @Input() transactions: BankTransactionItem[] = [];

  public items: Array<BankTransactionItem & { selected: boolean; originalTitle: string }> = [];
  public settings: BankExportSettings = { ...DEFAULT_BANK_EXPORT_SETTINGS };
  public senderAccount = '';

  constructor(
    private modalCtrl: ModalController,
    private toastCtrl: ToastController,
    private translate: TranslateService,
    private appService: AppService,
    private requestsService: RequestsService
  ) {}

  ngOnInit(): void {
    const configSettings = this.appService.configurations?.bankExportSettings;
    this.settings = configSettings ? JSON.parse(JSON.stringify(configSettings)) : { ...DEFAULT_BANK_EXPORT_SETTINGS };
    this.senderAccount = this.settings.senderAccountNumber || '';

    this.items = (this.transactions || []).map(t => ({
      ...t,
      selected: t.isDomesticPln,
      originalTitle: t.title
    }));
  }

  get selectedItems(): BankTransactionItem[] {
    return this.items.filter(i => i.selected);
  }

  get selectedTotalAmount(): number {
    return this.selectedItems.reduce((acc, curr) => acc + (curr.amount || 0), 0);
  }

  get isSenderAccountValid(): boolean {
    const clean = cleanPolishBankAccount(this.senderAccount);
    return clean.length === 26;
  }

  get hasUnresolvedPlaceholders(): boolean {
    return this.selectedItems.some(i => i.title.includes('XX'));
  }

  get hasOverlengthTitles(): boolean {
    return this.selectedItems.some(i => i.title.length > 140);
  }

  public onSelectAll(event: any): void {
    const checked = event?.detail?.checked ?? true;
    this.items.forEach(i => {
      if (i.isDomesticPln) {
        i.selected = checked;
      }
    });
  }

  public resetTitle(item: BankTransactionItem & { originalTitle: string }): void {
    item.title = item.originalTitle;
  }

  public close(): void {
    this.modalCtrl.dismiss(null, 'cancel');
  }

  public export(): void {
    if (!this.selectedItems.length) {
      this.showToast('REQUESTS.PAYOUTS.NO_TRANSACTIONS_SELECTED', 'warning');
      return;
    }

    if (!this.isSenderAccountValid) {
      this.showToast('REQUESTS.PAYOUTS.INVALID_SENDER_ACCOUNT', 'danger');
      return;
    }

    if (this.hasOverlengthTitles) {
      this.showToast('REQUESTS.PAYOUTS.TITLE_TOO_LONG_WARNING', 'warning');
      return;
    }

    const currentSettings: BankExportSettings = {
      ...this.settings,
      senderAccountNumber: cleanPolishBankAccount(this.senderAccount)
    };

    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `przelewy-erste-${dateStr}.txt`;

    try {
      this.requestsService.exportToErsteBankTxt(this.selectedItems, currentSettings, filename);
      this.showToast('REQUESTS.PAYOUTS.EXPORT_SUCCESS', 'success');
      this.modalCtrl.dismiss({ exportedCount: this.selectedItems.length }, 'confirm');
    } catch (err: any) {
      this.showToast(err?.message || 'Export failed', 'danger');
    }
  }

  private async showToast(keyOrMsg: string, color: string): Promise<void> {
    const translated = this.translate.instant(keyOrMsg);
    const toast = await this.toastCtrl.create({
      message: translated && translated !== keyOrMsg ? translated : keyOrMsg,
      duration: 3500,
      position: 'bottom',
      color
    });
    await toast.present();
  }
}
