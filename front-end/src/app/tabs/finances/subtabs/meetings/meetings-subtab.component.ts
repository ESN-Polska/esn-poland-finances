import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { ToastController, AlertController } from '@ionic/angular';
import { Subscription } from 'rxjs';
import { FinancesStateService } from '../../../../services/finances-state.service';
import { FinancesNavigationService } from '../../../../services/finances-navigation.service';
import { FinancesService } from '../../../../services/finances.service';
import { AppService } from '../../../../app.service';
import { MeetingRecord } from '@models/subledgers.model';
import { AppPermission } from '@models/configurations.model';

@Component({
  selector: 'app-meetings-subtab',
  templateUrl: './meetings-subtab.component.html',
  styleUrls: ['./meetings-subtab.component.scss']
})
export class MeetingsSubtabComponent implements OnInit, OnDestroy {
  public stateService = inject(FinancesStateService);
  public navService = inject(FinancesNavigationService);
  private financesService = inject(FinancesService);
  public app = inject(AppService);
  private toastCtrl = inject(ToastController);
  private alertCtrl = inject(AlertController);

  meetings: MeetingRecord[] = [];
  loading: boolean = true;
  searchQuery: string = '';

  private subs: Subscription[] = [];

  ngOnInit(): void {
    this.subs.push(
      this.stateService.activeYear$.subscribe((year) => {
        this.loadMeetings(year);
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

  async loadMeetings(year: number): Promise<void> {
    this.loading = true;
    try {
      this.meetings = await this.financesService.getMeetings(year);
    } catch (err: any) {
      console.error('Failed to load meetings', err);
    } finally {
      this.loading = false;
    }
  }

  get filteredMeetings(): MeetingRecord[] {
    if (!this.searchQuery.trim()) return this.meetings;
    const q = this.searchQuery.toLowerCase().trim();
    return this.meetings.filter(
      (m) =>
        m.meetingCode.toLowerCase().includes(q) ||
        m.meetingName.toLowerCase().includes(q) ||
        m.city?.toLowerCase().includes(q) ||
        m.linkedBudgetLineCode?.toLowerCase().includes(q)
    );
  }

  jumpToBudgetLine(code: string): void {
    this.navService.jumpToBudgetLine(code, this.stateService.activeYear);
  }
}
