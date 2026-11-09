import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { ToastController, AlertController } from '@ionic/angular';
import { Subscription } from 'rxjs';
import { FinancesStateService } from '../../../../services/finances-state.service';
import { FinancesService } from '../../../../services/finances.service';
import { AppService } from '../../../../app.service';
import { SectionSubAccount } from '@models/subledgers.model';
import { AppPermission } from '@models/configurations.model';

@Component({
  selector: 'app-sections-subtab',
  templateUrl: './sections-subtab.component.html',
  styleUrls: ['./sections-subtab.component.scss']
})
export class SectionsSubtabComponent implements OnInit, OnDestroy {
  public stateService = inject(FinancesStateService);
  private financesService = inject(FinancesService);
  public app = inject(AppService);
  private toastCtrl = inject(ToastController);
  private alertCtrl = inject(AlertController);

  sections: SectionSubAccount[] = [];
  loading: boolean = true;
  searchQuery: string = '';

  private subs: Subscription[] = [];

  ngOnInit(): void {
    this.subs.push(
      this.stateService.activeYear$.subscribe((year) => {
        this.loadSections(year);
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

  async loadSections(year: number): Promise<void> {
    this.loading = true;
    try {
      this.sections = await this.financesService.getSections(year);
    } catch (err: any) {
      console.error('Failed to load sections', err);
    } finally {
      this.loading = false;
    }
  }

  get filteredSections(): SectionSubAccount[] {
    if (!this.searchQuery.trim()) return this.sections;
    const q = this.searchQuery.toLowerCase().trim();
    return this.sections.filter(
      (s) => s.sectionCode.toLowerCase().includes(q) || s.sectionName.toLowerCase().includes(q)
    );
  }

  get totalTrustHeld(): number {
    return this.sections.reduce((sum, s) => sum + (s.currentBalance || 0), 0);
  }
}
