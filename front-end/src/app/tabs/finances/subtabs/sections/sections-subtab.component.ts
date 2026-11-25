import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { ToastController, AlertController, LoadingController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import { FinancesStateService } from '../../../../services/finances-state.service';
import { FinancesNavigationService } from '../../../../services/finances-navigation.service';
import { FinancesService } from '../../../../services/finances.service';
import { AppService } from '../../../../app.service';
import { SectionSubAccount, InternalTransfer, DelegationRecord } from '@models/subledgers.model';
import { BankTransactionRecord } from '@models/cashflow-transaction.model';
import { AppPermission } from '@models/configurations.model';

@Component({
  selector: 'app-sections-subtab',
  templateUrl: './sections-subtab.component.html',
  styleUrls: ['./sections-subtab.component.scss']
})
export class SectionsSubtabComponent implements OnInit, OnDestroy {
  public stateService = inject(FinancesStateService);
  public navService = inject(FinancesNavigationService);
  private financesService = inject(FinancesService);
  public app = inject(AppService);
  private toastCtrl = inject(ToastController);
  private alertCtrl = inject(AlertController);
  private loadingCtrl = inject(LoadingController);
  private translate = inject(TranslateService);

  sections: SectionSubAccount[] = [];
  transactions: BankTransactionRecord[] = [];
  transfers: InternalTransfer[] = [];
  delegations: DelegationRecord[] = [];

  loading: boolean = true;
  searchQuery: string = '';
  expandedSectionId: string | null = null;

  private subs: Subscription[] = [];

  ngOnInit(): void {
    this.subs.push(
      this.stateService.activeYear$.subscribe((year) => {
        this.loadSectionsData(year);
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

  async loadSectionsData(year: number): Promise<void> {
    this.loading = true;
    try {
      const [currentYearSections, prevYearSections, txs, transfers, delegations] = await Promise.all([
        this.financesService.getSections(year),
        this.financesService.getSections(year - 1).catch(() => []),
        this.financesService.getTransactions(year).catch(() => []),
        this.financesService.getTransfers(year).catch(() => []),
        this.financesService.getDelegations(year).catch(() => [])
      ]);

      this.transactions = txs || [];
      this.transfers = transfers || [];
      this.delegations = delegations || [];

      // Map previous year closing saldos by code
      const prevSaldoMap = new Map<string, number>();
      for (const p of prevYearSections || []) {
        const pCode = (p.sectionCode || (p as any).code || '').trim().toLowerCase();
        if (pCode) {
          prevSaldoMap.set(pCode, p.saldo ?? p.currentBalance ?? p.startingBalance ?? 0);
        }
      }

      // If a section was deactivated in a prior year, it shouldn't show in current year unless already persisted in current year
      this.sections = (currentYearSections || []).filter((s) => {
        if (s.deactivatedAtYear && s.deactivatedAtYear < year && !s.isActive) {
          return false;
        }
        return true;
      });

      // Calculate dynamic accounting columns for each section
      for (const s of this.sections) {
        const code = (s.sectionCode || (s as any).code || '').trim();
        const codeLower = code.toLowerCase();

        // 1. Starting balance: from previous year closing saldo if available
        if (prevSaldoMap.has(codeLower)) {
          s.startingBalance = prevSaldoMap.get(codeLower)!;
        } else if (s.startingBalance === undefined) {
          s.startingBalance = 0;
        }

        // 2. Transactions (Inflows and Outflows for this section code)
        let rev = 0;
        let cost = 0;
        for (const t of this.transactions) {
          if (t.directCodeSplits?.length) {
            for (const sp of t.directCodeSplits) {
              if ((sp.code || '').trim().toLowerCase() === codeLower) {
                const spAmt = Number(sp.amount) || 0;
                if (t.amount >= 0) rev += spAmt;
                else cost += spAmt;
              }
            }
          } else if ((t.directBudgetCode || '').trim().toLowerCase() === codeLower) {
            const amt = Math.abs(t.amount);
            if (t.amount >= 0) rev += amt;
            else cost += amt;
          }
        }
        s.txRevenues = Math.round(rev * 100) / 100;
        s.txCosts = Math.round(cost * 100) / 100;
        s.txBalance = Math.round((s.txRevenues - s.txCosts) * 100) / 100;

        // 3. Internal transfers (toCode vs fromCode)
        let trIn = 0;
        let trOut = 0;
        for (const tr of this.transfers) {
          const amt = Number(tr.amount) || 0;
          if ((tr.toCode || '').trim().toLowerCase() === codeLower) trIn += amt;
          if ((tr.fromCode || '').trim().toLowerCase() === codeLower) trOut += amt;
        }
        s.internalTransfersNet = Math.round((trIn - trOut) * 100) / 100;

        // 4. Delegations (costsAmount assigned to this section)
        let delCost = 0;
        for (const d of this.delegations) {
          if ((d.budgetCode || '').trim().toLowerCase() === codeLower) {
            delCost += Number(d.costsAmount ?? d.ticketsAmount ?? 0);
          }
        }
        s.delegationsTotal = Math.round(delCost * 100) / 100;

        // 5. Final Saldo
        s.saldo = Math.round((s.startingBalance + s.txBalance + s.internalTransfersNet - s.delegationsTotal) * 100) / 100;
        s.currentBalance = s.saldo;
      }
    } catch (err: any) {
      console.error('Failed to load sections data', err);
    } finally {
      this.loading = false;
    }
  }

  get filteredSections(): SectionSubAccount[] {
    if (!this.searchQuery.trim()) return this.sections;
    const q = this.searchQuery.toLowerCase().trim();
    return this.sections.filter(
      (s) => (s.sectionCode || '').toLowerCase().includes(q) || (s.sectionName || '').toLowerCase().includes(q)
    );
  }

  get totalSectionsSaldo(): number {
    return this.filteredSections.reduce((sum, s) => sum + (s.saldo ?? s.currentBalance ?? 0), 0);
  }

  toggleDrilldown(sectionId: string): void {
    this.expandedSectionId = this.expandedSectionId === sectionId ? null : sectionId;
  }

  getSectionTransactions(sectionCode: string): BankTransactionRecord[] {
    const codeLower = (sectionCode || '').trim().toLowerCase();
    return this.transactions.filter(
      (t) =>
        (t.directBudgetCode || '').trim().toLowerCase() === codeLower ||
        t.directCodeSplits?.some((sp) => (sp.code || '').trim().toLowerCase() === codeLower)
    );
  }

  getSectionTransfers(sectionCode: string): InternalTransfer[] {
    const codeLower = (sectionCode || '').trim().toLowerCase();
    return this.transfers.filter(
      (tr) =>
        (tr.toCode || '').trim().toLowerCase() === codeLower ||
        (tr.fromCode || '').trim().toLowerCase() === codeLower
    );
  }

  getSectionDelegations(sectionCode: string): DelegationRecord[] {
    const codeLower = (sectionCode || '').trim().toLowerCase();
    return this.delegations.filter(
      (d) => (d.budgetCode || '').trim().toLowerCase() === codeLower
    );
  }

  async openAddSectionAlert(): Promise<void> {
    if (!this.canEdit || this.isArchived) return;

    const alert = await this.alertCtrl.create({
      header: this.translate.instant('FINANCES.SECTIONS.ADD_SECTION_TITLE'),
      inputs: [
        {
          name: 'code',
          type: 'text',
          placeholder: this.translate.instant('FINANCES.SECTIONS.FIELD_CODE')
        },
        {
          name: 'name',
          type: 'text',
          placeholder: this.translate.instant('FINANCES.SECTIONS.FIELD_NAME')
        },
        {
          name: 'startingBalance',
          type: 'number',
          placeholder: this.translate.instant('FINANCES.SECTIONS.FIELD_OPENING_BALANCE'),
          value: '0'
        }
      ],
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('COMMON.CREATE'),
          handler: async (data) => {
            const code = (data.code || '').trim();
            const name = (data.name || '').trim();
            const startBal = parseFloat(data.startingBalance) || 0;
            if (!code || !name) return false;

            const newSec = new SectionSubAccount({
              id: `sec_${Date.now()}`,
              year: this.stateService.activeYear,
              sectionCode: code,
              sectionName: name,
              startingBalance: startBal,
              txRevenues: 0,
              txCosts: 0,
              txBalance: 0,
              internalTransfersNet: 0,
              delegationsTotal: 0,
              saldo: startBal,
              isActive: true
            });

            const loading = await this.loadingCtrl.create({ message: this.translate.instant('COMMON.SAVING') });
            await loading.present();
            try {
              await this.financesService.saveSection(newSec);
              await this.loadSectionsData(this.stateService.activeYear);
            } finally {
              await loading.dismiss();
            }
            return true;
          }
        }
      ]
    });
    await alert.present();
  }

  async toggleSectionActive(s: SectionSubAccount, event?: MouseEvent): Promise<void> {
    if (event) event.stopPropagation();
    if (!this.canEdit || this.isArchived) return;

    s.isActive = !s.isActive;
    if (!s.isActive) {
      s.deactivatedAtYear = this.stateService.activeYear;
    } else {
      s.deactivatedAtYear = undefined;
    }

    const loading = await this.loadingCtrl.create({ message: this.translate.instant('COMMON.SAVING') });
    await loading.present();
    try {
      await this.financesService.saveSection(s);
      const toast = await this.toastCtrl.create({
        message: this.translate.instant('COMMON.SAVE_SUCCESS'),
        duration: 2000,
        color: 'success'
      });
      await toast.present();
    } finally {
      await loading.dismiss();
    }
  }
}
