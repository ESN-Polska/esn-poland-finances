import { Pipe, PipeTransform, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { TranslateService, LangChangeEvent } from '@ngx-translate/core';
import { Subscription } from 'rxjs';

const KNOWN_PHRASE_TO_KEY: { [phraseLower: string]: string } = {
  // In review
  'review started': 'REQUESTS.HISTORY_COMMENTS.IN_REVIEW',
  'review started by manager': 'REQUESTS.HISTORY_COMMENTS.IN_REVIEW',
  'weryfikacja rozpoczęta': 'REQUESTS.HISTORY_COMMENTS.IN_REVIEW',
  'weryfikacja rozpoczęta przez managera': 'REQUESTS.HISTORY_COMMENTS.IN_REVIEW',

  // Submission
  'initial submission': 'REQUESTS.HISTORY_COMMENTS.INITIAL_SUBMISSION',
  'pierwsze złożenie wniosku': 'REQUESTS.HISTORY_COMMENTS.INITIAL_SUBMISSION',
  'złożenie wniosku': 'REQUESTS.HISTORY_COMMENTS.INITIAL_SUBMISSION',
  'submitted by applicant': 'REQUESTS.HISTORY_COMMENTS.SUBMITTED_BY_APPLICANT',
  'złożono przez wnioskodawcę': 'REQUESTS.HISTORY_COMMENTS.SUBMITTED_BY_APPLICANT',
  'wniosek złożony przez wnioskodawcę': 'REQUESTS.HISTORY_COMMENTS.SUBMITTED_BY_APPLICANT',

  // Drafts
  'draft created': 'REQUESTS.HISTORY_COMMENTS.DRAFT_CREATED',
  'utworzono wersję roboczą': 'REQUESTS.HISTORY_COMMENTS.DRAFT_CREATED',
  'wersja robocza utworzona': 'REQUESTS.HISTORY_COMMENTS.DRAFT_CREATED',
  'initial draft created': 'REQUESTS.HISTORY_COMMENTS.DRAFT_CREATED',
  'utworzono początkową wersję roboczą': 'REQUESTS.HISTORY_COMMENTS.DRAFT_CREATED',
  'draft saved': 'REQUESTS.HISTORY_COMMENTS.DRAFT_SAVED',
  'zapisano wersję roboczą': 'REQUESTS.HISTORY_COMMENTS.DRAFT_SAVED',
  'wersja robocza zapisana': 'REQUESTS.HISTORY_COMMENTS.DRAFT_SAVED',

  // Approved
  'request approved': 'REQUESTS.HISTORY_COMMENTS.REQUEST_APPROVED',
  'wniosek zatwierdzony': 'REQUESTS.HISTORY_COMMENTS.REQUEST_APPROVED',
  'zatwierdzono wniosek': 'REQUESTS.HISTORY_COMMENTS.REQUEST_APPROVED',

  // Paid
  'payout completed': 'REQUESTS.HISTORY_COMMENTS.PAYOUT_COMPLETED',
  'wypłata zrealizowana': 'REQUESTS.HISTORY_COMMENTS.PAYOUT_COMPLETED',
  'płatność zrealizowana': 'REQUESTS.HISTORY_COMMENTS.PAYOUT_COMPLETED',

  // Updated
  'updated': 'REQUESTS.HISTORY_COMMENTS.UPDATED',
  'zaktualizowano': 'REQUESTS.HISTORY_COMMENTS.UPDATED'
};

const POLISH_STATUS_MAP: { [statusLower: string]: string } = {
  'wersja robocza': 'DRAFT',
  'złożony': 'SUBMITTED',
  'w weryfikacji': 'IN_REVIEW',
  'w trakcie weryfikacji': 'IN_REVIEW',
  'poprawki': 'CHANGES_REQUESTED',
  'zatwierdzony': 'APPROVED',
  'opłacony': 'PAID',
  'odrzucony': 'REJECTED'
};

@Pipe({
  name: 'statusComment',
  pure: false
})
export class StatusCommentPipe implements PipeTransform, OnDestroy {
  private subscription?: Subscription;
  private lastInput?: string;
  private lastStatus?: string;
  private lastOutput = '';
  private lastLang = '';

  constructor(
    private translate: TranslateService,
    private ref: ChangeDetectorRef
  ) {
    this.subscription = this.translate.onLangChange.subscribe((_event: LangChangeEvent) => {
      this.lastInput = undefined;
      this.ref.markForCheck();
    });
  }

  public transform(comment?: string, status?: string): string {
    if (!comment || !comment.trim()) {
      return '';
    }

    const currentLang = this.translate.currentLang || this.translate.defaultLang || 'pl';
    if (comment === this.lastInput && status === this.lastStatus && currentLang === this.lastLang) {
      return this.lastOutput;
    }

    this.lastInput = comment;
    this.lastStatus = status;
    this.lastLang = currentLang;
    this.lastOutput = this.translateComment(comment.trim(), status);
    return this.lastOutput;
  }

  private translateComment(comment: string, status?: string): string {
    // 1. Direct translation key
    if (comment.startsWith('REQUESTS.') || comment.startsWith('COMMON.')) {
      if (comment === 'REQUESTS.HISTORY_COMMENTS.STATUS_CHANGED_TO') {
        const rawStatus = status || '';
        const translatedStatus = this.translateStatus(rawStatus);
        return this.translate.instant('REQUESTS.HISTORY_COMMENTS.STATUS_CHANGED_TO', { status: translatedStatus });
      }

      const direct = this.translate.instant(comment);
      if (direct && direct !== comment) {
        return direct;
      }
    }

    // 2. Known historical phrases in English or Polish
    const lower = comment.toLowerCase();
    const mappedKey = KNOWN_PHRASE_TO_KEY[lower];
    if (mappedKey) {
      return this.translate.instant(mappedKey);
    }

    // 3. Status transition pattern: "Status changed to <STATUS>" or "Status zmieniony na <STATUS>"
    const enMatch = comment.match(/^status changed to\s+(.+)$/i);
    const plMatch = comment.match(/^status zmieniony na\s+(.+)$/i);
    const matchedStatusStr = enMatch?.[1] || plMatch?.[1];

    if (matchedStatusStr) {
      const rawStatus = status || matchedStatusStr.trim();
      const translatedStatus = this.translateStatus(rawStatus);
      return this.translate.instant('REQUESTS.HISTORY_COMMENTS.STATUS_CHANGED_TO', { status: translatedStatus });
    }

    // 4. Custom user remark (e.g. manager's specific comments) -> return as-is
    return comment;
  }

  private translateStatus(statusStr: string): string {
    if (!statusStr) return '';

    // Check if it's a Polish status label
    const lower = statusStr.trim().toLowerCase();
    const mappedEnum = POLISH_STATUS_MAP[lower] || statusStr.trim().toUpperCase().replace(/[\s-]+/g, '_');

    const key = `REQUESTS.STATUSES.${mappedEnum}`;
    const translated = this.translate.instant(key);
    return translated && translated !== key ? translated : statusStr;
  }

  public ngOnDestroy(): void {
    if (this.subscription) {
      this.subscription.unsubscribe();
    }
  }
}
