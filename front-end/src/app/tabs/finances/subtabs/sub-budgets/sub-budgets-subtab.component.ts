import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { ToastController, AlertController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import { FinancesStateService } from '../../../../services/finances-state.service';
import { FinancesNavigationService } from '../../../../services/finances-navigation.service';
import { FinancesService } from '../../../../services/finances.service';
import { AppService } from '../../../../app.service';
import { MeetingRecord } from '@models/subledgers.model';
import {
  AnnualBudget,
  BudgetLineItem,
  isBudgetLine,
  isBudgetGroup,
  DynamicBudgetGroup
} from '@models/annual-budget.model';
import { AppPermission } from '@models/configurations.model';

@Component({
  selector: 'app-sub-budgets-subtab',
  templateUrl: './sub-budgets-subtab.component.html',
  styleUrls: ['./sub-budgets-subtab.component.scss']
})
export class SubBudgetsSubtabComponent implements OnInit, OnDestroy {
  public stateService = inject(FinancesStateService);
  public navService = inject(FinancesNavigationService);
  private financesService = inject(FinancesService);
  public app = inject(AppService);
  private toastCtrl = inject(ToastController);
  private alertCtrl = inject(AlertController);
  private translate = inject(TranslateService);

  meetings: MeetingRecord[] = [];
  budget: AnnualBudget | null = null;
  loading: boolean = true;
  searchQuery: string = '';

  private subs: Subscription[] = [];

  ngOnInit(): void {
    this.subs.push(
      this.stateService.activeYear$.subscribe((year) => {
        this.loadData(year);
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

  async loadData(year: number): Promise<void> {
    this.loading = true;
    try {
      const [meetings, budget] = await Promise.all([
        this.financesService.getMeetings(year),
        this.financesService.getBudget(year).catch(() => null)
      ]);
      this.meetings = meetings || [];
      this.budget = budget;
    } catch (err: any) {
      console.error('Failed to load sub-budgets data', err);
    } finally {
      this.loading = false;
    }
  }

  get allBudgetLines(): BudgetLineItem[] {
    if (!this.budget) return [];
    const lines: BudgetLineItem[] = [];
    const collect = (items: (DynamicBudgetGroup | BudgetLineItem)[]) => {
      for (const it of items || []) {
        if (isBudgetLine(it)) {
          lines.push(it);
        } else if (isBudgetGroup(it)) {
          collect(it.items || []);
        }
      }
    };
    for (const cat of this.budget.categories || []) {
      if (cat.expenses?.items) collect(cat.expenses.items);
      if (cat.revenues?.items) collect(cat.revenues.items);
    }
    return lines;
  }

  get filteredMeetings(): MeetingRecord[] {
    if (!this.searchQuery.trim()) return this.meetings;
    const q = this.searchQuery.toLowerCase().trim();
    return this.meetings.filter(
      (m) =>
        (m.code || '').toLowerCase().includes(q) ||
        (m.name || '').toLowerCase().includes(q) ||
        (m.city || '').toLowerCase().includes(q) ||
        (m.budgetCode || '').toLowerCase().includes(q)
    );
  }

  jumpToBudgetLine(code: string): void {
    this.navService.jumpToBudgetLine(code, this.stateService.activeYear);
  }

  async openAddSubBudgetAlert(): Promise<void> {
    const budgetOptions = this.allBudgetLines.map((line) => ({
      label: `${line.code} — ${line.name}`,
      value: line.code
    }));

    const alert = await this.alertCtrl.create({
      header: this.translate.instant('FINANCES.MEETINGS.ADD_SUB_BUDGET'),
      inputs: [
        {
          name: 'name',
          type: 'text',
          placeholder: this.translate.instant('FINANCES.MEETINGS.NAME_LABEL')
        },
        {
          name: 'code',
          type: 'text',
          placeholder: this.translate.instant('FINANCES.MEETINGS.CODE_LABEL')
        },
        {
          name: 'budgetCode',
          type: 'text',
          placeholder: this.translate.instant('FINANCES.MEETINGS.BUDGET_LINE_LABEL') + ' (' + (budgetOptions.map(b => b.value).slice(0, 5).join(', ')) + '...)'
        },
        {
          name: 'totalRevenue',
          type: 'number',
          placeholder: this.translate.instant('FINANCES.MEETINGS.COL_REVENUE')
        },
        {
          name: 'totalCost',
          type: 'number',
          placeholder: this.translate.instant('FINANCES.MEETINGS.COL_COST')
        },
        {
          name: 'budgetUrl',
          type: 'url',
          placeholder: this.translate.instant('FINANCES.MEETINGS.SPREADSHEET_URL_LABEL')
        }
      ],
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('COMMON.SAVE'),
          handler: async (data) => {
            if (!data.name?.trim() || !data.code?.trim() || !data.budgetCode?.trim()) {
              const t = await this.toastCtrl.create({
                message: 'Nazwa, kod oraz powiązana linia budżetowa są wymagane!',
                duration: 3000,
                color: 'warning'
              });
              t.present();
              return false;
            }

            const rec = new MeetingRecord({
              year: this.stateService.activeYear,
              name: data.name.trim(),
              code: data.code.trim().toUpperCase(),
              budgetCode: data.budgetCode.trim(),
              totalRevenue: Number(data.totalRevenue) || 0,
              totalCost: Number(data.totalCost) || 0,
              actualResult: (Number(data.totalRevenue) || 0) - (Number(data.totalCost) || 0),
              budgetUrl: data.budgetUrl?.trim() || '',
              status: 'OPEN',
              meetingType: 'STATUTORY'
            });

            try {
              const saved = await this.financesService.saveMeeting(rec);
              this.meetings.unshift(saved);
              const t = await this.toastCtrl.create({
                message: this.translate.instant('FINANCES.MEETINGS.SAVE_SUCCESS'),
                duration: 2500,
                color: 'success'
              });
              t.present();
            } catch (err: any) {
              console.error('Failed to create sub-budget', err);
              const t = await this.toastCtrl.create({
                message: 'Błąd podczas zapisywania sub-budżetu',
                duration: 3000,
                color: 'danger'
              });
              t.present();
            }
            return true;
          }
        }
      ]
    });

    await alert.present();
  }

  async openEditSubBudgetAlert(m: MeetingRecord): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: this.translate.instant('FINANCES.MEETINGS.EDIT_SUB_BUDGET'),
      inputs: [
        {
          name: 'name',
          type: 'text',
          value: m.name,
          placeholder: this.translate.instant('FINANCES.MEETINGS.NAME_LABEL')
        },
        {
          name: 'code',
          type: 'text',
          value: m.code,
          placeholder: this.translate.instant('FINANCES.MEETINGS.CODE_LABEL')
        },
        {
          name: 'budgetCode',
          type: 'text',
          value: m.budgetCode,
          placeholder: this.translate.instant('FINANCES.MEETINGS.BUDGET_LINE_LABEL')
        },
        {
          name: 'totalRevenue',
          type: 'number',
          value: m.totalRevenue,
          placeholder: this.translate.instant('FINANCES.MEETINGS.COL_REVENUE')
        },
        {
          name: 'totalCost',
          type: 'number',
          value: m.totalCost,
          placeholder: this.translate.instant('FINANCES.MEETINGS.COL_COST')
        },
        {
          name: 'budgetUrl',
          type: 'url',
          value: m.budgetUrl || '',
          placeholder: this.translate.instant('FINANCES.MEETINGS.SPREADSHEET_URL_LABEL')
        }
      ],
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('COMMON.SAVE'),
          handler: async (data) => {
            if (!data.name?.trim() || !data.code?.trim() || !data.budgetCode?.trim()) {
              return false;
            }

            m.name = data.name.trim();
            m.code = data.code.trim().toUpperCase();
            m.budgetCode = data.budgetCode.trim();
            m.totalRevenue = Number(data.totalRevenue) || 0;
            m.totalCost = Number(data.totalCost) || 0;
            m.actualResult = m.totalRevenue - m.totalCost;
            m.budgetUrl = data.budgetUrl?.trim() || '';

            try {
              await this.financesService.saveMeeting(m);
              const t = await this.toastCtrl.create({
                message: this.translate.instant('FINANCES.MEETINGS.SAVE_SUCCESS'),
                duration: 2500,
                color: 'success'
              });
              t.present();
            } catch (err: any) {
              console.error('Failed to update sub-budget', err);
              const t = await this.toastCtrl.create({
                message: 'Błąd podczas aktualizacji',
                duration: 3000,
                color: 'danger'
              });
              t.present();
            }
            return true;
          }
        }
      ]
    });

    await alert.present();
  }

  async toggleStatus(m: MeetingRecord): Promise<void> {
    if (!this.canEdit || this.isArchived) return;
    m.status = m.status === 'SETTLED' ? 'OPEN' : 'SETTLED';
    try {
      await this.financesService.saveMeeting(m);
    } catch (err: any) {
      console.error('Failed to update sub-budget status', err);
    }
  }

  async deleteSubBudget(m: MeetingRecord): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: this.translate.instant('FINANCES.MEETINGS.DELETE_CONFIRM_TITLE'),
      message: this.translate.instant('FINANCES.MEETINGS.DELETE_CONFIRM_MSG'),
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('COMMON.DELETE'),
          role: 'destructive',
          handler: async () => {
            try {
              await this.financesService.deleteSubledgerItem('meetings', m.id);
              this.meetings = this.meetings.filter((item) => item.id !== m.id);
            } catch (err: any) {
              console.error('Failed to delete sub-budget', err);
            }
          }
        }
      ]
    });
    await alert.present();
  }
}
