import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject, Observable } from 'rxjs';
import { FinancesStateService } from './finances-state.service';

export interface JumpTarget {
  subtab: string;
  targetId?: string;
  code?: string;
  year?: number;
  highlight?: boolean;
}

@Injectable({ providedIn: 'root' })
export class FinancesNavigationService {
  private router = inject(Router);
  private stateService = inject(FinancesStateService);

  private readonly _jumpTarget$ = new BehaviorSubject<JumpTarget | null>(null);
  public readonly jumpTarget$: Observable<JumpTarget | null> = this._jumpTarget$.asObservable();

  /**
   * Jump to any finances subtab and optionally target a specific record or code.
   */
  public jumpTo(target: JumpTarget): void {
    const year = target.year || this.stateService.activeYear;
    this.stateService.setYear(year, false);
    this.stateService.setSubtab(target.subtab, false);

    this._jumpTarget$.next(target);

    this.router.navigate(['/t/finances'], {
      queryParams: {
        year,
        subtab: target.subtab,
        ...(target.targetId ? { targetId: target.targetId } : {}),
        ...(target.code ? { code: target.code } : {})
      },
      queryParamsHandling: 'merge'
    });
  }

  /**
   * Clear active jump target after the target component has highlighted or opened the record.
   */
  public clearJumpTarget(): void {
    this._jumpTarget$.next(null);
    this.router.navigate([], {
      queryParams: { code: null, targetId: null },
      queryParamsHandling: 'merge'
    });
  }

  /**
   * Jump helpers for common relationships
   */
  public jumpToBudgetLine(code: string, year?: number): void {
    this.jumpTo({ subtab: 'BUDGET', code, year });
  }

  public jumpToDocument(documentId: string, year?: number): void {
    this.jumpTo({ subtab: 'DOCUMENTS', targetId: documentId, year });
  }

  public jumpToTransaction(transactionId: string, year?: number): void {
    this.jumpTo({ subtab: 'TRANSACTIONS', targetId: transactionId, year });
  }

  public jumpToAdvance(advanceId: string, year?: number): void {
    this.jumpTo({ subtab: 'ADVANCES', targetId: advanceId, year });
  }

  public jumpToMeeting(meetingIdOrCode: string, year?: number): void {
    this.jumpTo({ subtab: 'MEETINGS', code: meetingIdOrCode, targetId: meetingIdOrCode, year });
  }

  public jumpToSection(sectionIdOrCode: string, year?: number): void {
    this.jumpTo({ subtab: 'SECTIONS', code: sectionIdOrCode, targetId: sectionIdOrCode, year });
  }
}
