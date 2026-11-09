import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { ToastController, LoadingController, AlertController, ModalController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import { FinancesStateService } from '../../../../services/finances-state.service';
import { FinancesNavigationService } from '../../../../services/finances-navigation.service';
import { FinancesService } from '../../../../services/finances.service';
import { AppService } from '../../../../app.service';
import { BankTransactionRecord } from '@models/cashflow-transaction.model';
import { AppPermission } from '@models/configurations.model';
import { CsvImportModalComponent } from '../../modals/csv-import-modal/csv-import-modal.component';

@Component({
  selector: 'app-transactions-subtab',
  templateUrl: './transactions-subtab.component.html',
  styleUrls: ['./transactions-subtab.component.scss']
})
export class TransactionsSubtabComponent implements OnInit, OnDestroy {
  public stateService = inject(FinancesStateService);
  public navService = inject(FinancesNavigationService);
  private financesService = inject(FinancesService);
  public app = inject(AppService);
  private toastCtrl = inject(ToastController);
  private loadingCtrl = inject(LoadingController);
  private alertCtrl = inject(AlertController);
  private modalCtrl = inject(ModalController);
  private translate = inject(TranslateService);

  transactions: BankTransactionRecord[] = [];
  loading: boolean = true;
  searchQuery: string = '';
  currencyFilter: 'ALL' | 'PLN' | 'EUR' = 'ALL';
  settlementFilter: 'ALL' | 'SETTLED' | 'UNSETTLED' = 'ALL';
  highlightedTxId: string | null = null;

  private subs: Subscription[] = [];

  ngOnInit(): void {
    this.subs.push(
      this.stateService.activeYear$.subscribe((year) => {
        this.loadTransactions(year);
      })
    );

    this.subs.push(
      this.navService.jumpTarget$.subscribe((target) => {
        if (target?.subtab === 'TRANSACTIONS') {
          if (target.targetId) {
            this.highlightedTxId = target.targetId;
            setTimeout(() => {
              const el = document.getElementById(`tx-${target.targetId}`);
              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 300);
          }
          if (target.code) {
            this.searchQuery = target.code;
          }
        }
      })
    );
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
  }

  get canEdit(): boolean {
    const user = this.app.currentUser;
    if (!user) return false;
    return (
      user.isAdministrator ||
      user.isManager ||
      user.hasPermission(AppPermission.FINANCES.MANAGE) ||
      user.hasPermission(AppPermission.FINANCES.PARENT)
    );
  }

  get isArchived(): boolean {
    return this.stateService.isArchived;
  }

  async loadTransactions(year: number): Promise<void> {
    this.loading = true;
    try {
      const list = await this.financesService.getTransactions(year);
      this.transactions = (list || []).sort((a, b) => {
        const dateComp = (b.bookingDate || '').localeCompare(a.bookingDate || '');
        if (dateComp !== 0) return dateComp;
        return (a.statementSequenceNumber || 0) - (b.statementSequenceNumber || 0);
      });
    } catch (err: any) {
      console.error('Failed to load transactions', err);
    } finally {
      this.loading = false;
    }
  }

  get filteredTransactions(): BankTransactionRecord[] {
    let list = this.transactions;

    if (this.currencyFilter !== 'ALL') {
      list = list.filter((t) => t.currency === this.currencyFilter);
    }

    if (this.settlementFilter === 'SETTLED') {
      list = list.filter((t) => t.settlementStatus === 'SETTLED');
    } else if (this.settlementFilter === 'UNSETTLED') {
      list = list.filter((t) => t.settlementStatus !== 'SETTLED');
    }

    if (!this.searchQuery.trim()) return list;

    const q = this.searchQuery.toLowerCase().trim();
    return list.filter(
      (t) =>
        (t.partyName && t.partyName.toLowerCase().includes(q)) ||
        (t.counterparty && t.counterparty.toLowerCase().includes(q)) ||
        (t.transferTitle && t.transferTitle.toLowerCase().includes(q)) ||
        (t.title && t.title.toLowerCase().includes(q)) ||
        (t.directBudgetLineCode && t.directBudgetLineCode.toLowerCase().includes(q)) ||
        (t.notes && t.notes.toLowerCase().includes(q))
    );
  }

  clearSearch(): void {
    this.searchQuery = '';
  }

  async openImportModal(): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: CsvImportModalComponent,
      componentProps: {
        year: this.stateService.activeYear,
        scheme: this.app.configurations?.financesConfig?.csvImportScheme || 'ERSTE_BANK_POLSKA'
      }
    });
    await modal.present();
    const { data } = await modal.onWillDismiss();
    if (data && (data.imported !== undefined || data.duplicates !== undefined)) {
      await this.loadTransactions(this.stateService.activeYear);
    }
  }

  jumpToBudgetLine(code: string): void {
    this.navService.jumpToBudgetLine(code, this.stateService.activeYear);
  }

  async directCodeBankFee(tx: BankTransactionRecord): Promise<void> {
    if (!this.canEdit || this.isArchived) return;

    const alert = await this.alertCtrl.create({
      header: this.translate.instant('FINANCES.TRANSACTIONS.DIRECT_FEE_ALERT_TITLE'),
      subHeader: `${tx.title} (${tx.amount} ${tx.currency})`,
      inputs: [
        {
          name: 'code',
          type: 'text',
          placeholder: this.translate.instant('FINANCES.TRANSACTIONS.DIRECT_FEE_CODE_PH'),
          value: tx.directBudgetLineCode || ''
        },
        {
          name: 'notes',
          type: 'text',
          placeholder: this.translate.instant('FINANCES.TRANSACTIONS.DIRECT_FEE_NOTES_PH'),
          value: tx.notes || ''
        }
      ],
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('FINANCES.TRANSACTIONS.DIRECT_FEE_ASSIGN_BTN'),
          handler: async (data) => {
            if (!data.code?.trim()) return;
            tx.directBudgetLineCode = data.code.trim();
            tx.isBankFeeOrInterest = true;
            tx.settlementStatus = 'SETTLED';
            tx.notes = data.notes;
            await this.financesService.saveTransaction(tx);
            const toast = await this.toastCtrl.create({
              message: this.translate.instant('FINANCES.TRANSACTIONS.DIRECT_FEE_SUCCESS'),
              duration: 2500,
              color: 'success'
            });
            await toast.present();
          }
        }
      ]
    });
    await alert.present();
  }
}
