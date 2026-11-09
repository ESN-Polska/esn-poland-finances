import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { Subscription } from 'rxjs';
import { FinancesStateService } from '../../services/finances-state.service';
import { AppService } from '../../app.service';
import {
  AppPermission,
  DEFAULT_FINANCES_PAGE_SECTIONS_ORDER,
  FinancesPageSection
} from '@models/configurations.model';

@Component({
  selector: 'app-finances',
  templateUrl: './finances.page.html',
  styleUrls: ['./finances.page.scss']
})
export class FinancesPage implements OnInit, OnDestroy {
  public stateService = inject(FinancesStateService);
  public app = inject(AppService);

  activeYear: number = new Date().getFullYear();
  activeSubtab: string = 'SUMMARY';
  availableYears: number[] = [];

  private subs: Subscription[] = [];

  ngOnInit(): void {
    this.stateService.refreshAvailableYears(this.app.configurations?.financesConfig?.firstYear);
    this.subs.push(
      this.stateService.activeYear$.subscribe((y) => (this.activeYear = y))
    );
    this.subs.push(
      this.stateService.activeSubtab$.subscribe((tab) => (this.activeSubtab = tab))
    );
    this.subs.push(
      this.stateService.availableYears$.subscribe((years) => (this.availableYears = years))
    );
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
  }

  onYearChange(year: number): void {
    this.stateService.setYear(year);
  }

  onSubtabChange(subtab: string): void {
    this.stateService.setSubtab(subtab);
  }

  get configuredSubtabs(): FinancesPageSection[] {
    const list = this.app.configurations?.financesPageSectionsOrder?.length
      ? this.app.configurations.financesPageSectionsOrder
      : DEFAULT_FINANCES_PAGE_SECTIONS_ORDER;

    return list.filter((tab) => this.canAccessSubtab(tab));
  }

  canAccessSubtab(subtab: FinancesPageSection): boolean {
    const user = this.app.currentUser;
    if (!user) return false;
    if (user.isAdministrator || user.isManager || user.isAuditor) return true;

    switch (subtab) {
      case 'SUMMARY':
        return user.hasPermission(AppPermission.FINANCES.SUMMARY) || user.hasPermission(AppPermission.FINANCES.PARENT);
      case 'BUDGET':
        return user.hasPermission(AppPermission.FINANCES.BUDGET) || user.hasPermission(AppPermission.FINANCES.PARENT);
      case 'DOCUMENTS':
        return user.hasPermission(AppPermission.FINANCES.DOCUMENTS) || user.hasPermission(AppPermission.FINANCES.PARENT);
      case 'FISCAL':
        return user.hasPermission(AppPermission.FINANCES.FISCAL) || user.hasPermission(AppPermission.FINANCES.PARENT);
      case 'TRANSACTIONS':
        return user.hasPermission(AppPermission.FINANCES.TRANSACTIONS) || user.hasPermission(AppPermission.FINANCES.PARENT);
      case 'SECTIONS':
        return user.hasPermission(AppPermission.FINANCES.SECTIONS) || user.hasPermission(AppPermission.FINANCES.PARENT);
      case 'MEETINGS':
        return user.hasPermission(AppPermission.FINANCES.MEETINGS) || user.hasPermission(AppPermission.FINANCES.PARENT);
      case 'ADVANCES':
        return user.hasPermission(AppPermission.FINANCES.ADVANCES) || user.hasPermission(AppPermission.FINANCES.PARENT);
      case 'DELEGATIONS':
        return user.hasPermission(AppPermission.FINANCES.DELEGATIONS) || user.hasPermission(AppPermission.FINANCES.PARENT);
      case 'INTERNAL':
        return user.hasPermission(AppPermission.FINANCES.INTERNAL) || user.hasPermission(AppPermission.FINANCES.PARENT);
      case 'DEPOSITS':
        return user.hasPermission(AppPermission.FINANCES.DEPOSITS) || user.hasPermission(AppPermission.FINANCES.PARENT);
      default:
        return true;
    }
  }
}
