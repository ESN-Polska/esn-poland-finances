import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { ToastController, AlertController } from '@ionic/angular';
import { Subscription } from 'rxjs';
import { FinancesStateService } from '../../../../services/finances-state.service';
import { FinancesNavigationService } from '../../../../services/finances-navigation.service';
import { FinancesService } from '../../../../services/finances.service';
import { AppService } from '../../../../app.service';
import { AdvanceRecord } from '@models/subledgers.model';
import { AppPermission } from '@models/configurations.model';

@Component({
  selector: 'app-advances-subtab',
  templateUrl: './advances-subtab.component.html',
  styleUrls: ['./advances-subtab.component.scss']
})
export class AdvancesSubtabComponent implements OnInit, OnDestroy {
  public stateService = inject(FinancesStateService);
  public navService = inject(FinancesNavigationService);
  private financesService = inject(FinancesService);
  public app = inject(AppService);
  private toastCtrl = inject(ToastController);
  private alertCtrl = inject(AlertController);

  advances: AdvanceRecord[] = [];
  loading: boolean = true;
  searchQuery: string = '';
  highlightedAdvanceId: string | null = null;

  private subs: Subscription[] = [];

  ngOnInit(): void {
    this.subs.push(
      this.stateService.activeYear$.subscribe((year) => {
        this.loadAdvances(year);
      })
    );

    this.subs.push(
      this.navService.jumpTarget$.subscribe((target) => {
        if (target?.subtab === 'ADVANCES' && target.targetId) {
          this.highlightedAdvanceId = target.targetId;
          setTimeout(() => {
            const el = document.getElementById(`adv-${target.targetId}`);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 300);
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

  async loadAdvances(year: number): Promise<void> {
    this.loading = true;
    try {
      this.advances = await this.financesService.getAdvances(year);
    } catch (err: any) {
      console.error('Failed to load advances', err);
    } finally {
      this.loading = false;
    }
  }

  get filteredAdvances(): AdvanceRecord[] {
    if (!this.searchQuery.trim()) return this.advances;
    const q = this.searchQuery.toLowerCase().trim();
    return this.advances.filter(
      (a) =>
        a.recipientName.toLowerCase().includes(q) ||
        a.purpose?.toLowerCase().includes(q) ||
        a.id.toLowerCase().includes(q)
    );
  }

  jumpToDocument(docId: string): void {
    this.navService.jumpToDocument(docId, this.stateService.activeYear);
  }
}
