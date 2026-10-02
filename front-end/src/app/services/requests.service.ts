import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Storage } from '@ionic/storage-angular';
import { BehaviorSubject, Observable } from 'rxjs';
import { IDEAApiService } from '@idea-ionic/common';
import { environment as env } from '@env';
import {
  AttachmentFile,
  FinancialRequest,
  FinancialRequestType,
  InvoiceDocumentItem,
  RequestStatus
} from '@models/financial-request.model';
import {
  AppPermission,
  CsvExportSettings,
  DEFAULT_CSV_EXPORT_SETTINGS,
  BankExportSettings,
  DEFAULT_BANK_EXPORT_SETTINGS,
  BankExportElixirType,
  BankExportGrouping
} from '@models/configurations.model';
import { AppService } from '../app.service';

export interface BankTransactionItem {
  id: string;
  requestId: string;
  displayId: string;
  requestType: FinancialRequestType;
  invoiceIndex?: number;
  invoiceNumber?: string;
  ksefNumber?: string;
  recipientName: string;
  recipientAccount: string;
  cleanRecipientAccount: string;
  recipientAddress: string;
  recipientNip?: string;
  amount: number;
  currency: string;
  title: string;
  isDomestic: boolean;
  isDomesticPln: boolean;
  recipientSwift?: string;
  status: RequestStatus;
  originalRequest: FinancialRequest;
}

export function transliteratePolishToAscii(str: string | null | undefined): string {
  if (!str) return '';
  const mapping: { [key: string]: string } = {
    'ą': 'a', 'Ą': 'A',
    'ć': 'c', 'Ć': 'C',
    'ę': 'e', 'Ę': 'E',
    'ł': 'l', 'Ł': 'L',
    'ń': 'n', 'Ń': 'N',
    'ó': 'o', 'Ó': 'O',
    'ś': 's', 'Ś': 'S',
    'ź': 'z', 'Ź': 'Z',
    'ż': 'z', 'Ż': 'Z'
  };
  let res = str.replace(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g, m => mapping[m] || m);
  res = res.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return res;
}

export function cleanPolishBankAccount(account: string | null | undefined): string {
  if (!account) return '';
  let acc = account.trim().replace(/\s+/g, '').replace(/-/g, '');
  if (acc.toUpperCase().startsWith('PL')) {
    acc = acc.substring(2);
  }
  return acc;
}

export function isDomesticAccount(account: string | null | undefined, swiftBic?: string | null): boolean {
  if (swiftBic && swiftBic.trim().length > 0) return false;
  if (!account) return false;
  const raw = account.trim().replace(/\s+/g, '').replace(/-/g, '');
  if (/^[A-Za-z]{2}/.test(raw) && !raw.toUpperCase().startsWith('PL')) {
    return false;
  }
  const clean = cleanPolishBankAccount(raw);
  return /^[0-9]{26}$/.test(clean);
}

export function isDomesticPlnAccount(account: string | null | undefined, currency?: string, swiftBic?: string | null): boolean {
  if (currency && currency !== 'PLN') return false;
  return isDomesticAccount(account, swiftBic);
}

/**
 * Sorts bank transaction items oldest first (lowest request number on top)
 */
export function compareTransactionsOldestFirst(a: BankTransactionItem, b: BankTransactionItem): number {
  const reqA = a.originalRequest;
  const reqB = b.originalRequest;

  // 1. Year ascending (older year on top, e.g. 2025 before 2026)
  const yearA = reqA?.year || (reqA?.createdAt ? new Date(reqA.createdAt).getFullYear() : 0);
  const yearB = reqB?.year || (reqB?.createdAt ? new Date(reqB.createdAt).getFullYear() : 0);
  if (yearA !== yearB && yearA > 0 && yearB > 0) {
    return yearA - yearB;
  }

  // Helper to extract sequence number from "25/2026"
  const parseSeq = (id?: string): number | null => {
    if (!id) return null;
    const parts = id.split('/');
    const n = parseInt(parts[0], 10);
    return isNaN(n) ? null : n;
  };

  // 2. Sequence number ascending (lowest request number on top, e.g. 1/2026 before 25/2026)
  const seqA = typeof reqA?.sequenceNumber === 'number' ? reqA.sequenceNumber : parseSeq(a.displayId || a.requestId);
  const seqB = typeof reqB?.sequenceNumber === 'number' ? reqB.sequenceNumber : parseSeq(b.displayId || b.requestId);
  if (seqA !== null && seqB !== null && seqA !== seqB) {
    return seqA - seqB;
  }

  // 3. Creation timestamp ascending (oldest date on top)
  const timeA = reqA?.createdAt ? new Date(reqA.createdAt).getTime() : 0;
  const timeB = reqB?.createdAt ? new Date(reqB.createdAt).getTime() : 0;
  if (timeA !== timeB && timeA > 0 && timeB > 0) {
    return timeA - timeB;
  }

  // 4. If same request, sort by invoiceIndex ascending
  const idxA = a.invoiceIndex ?? 0;
  const idxB = b.invoiceIndex ?? 0;
  if (idxA !== idxB) {
    return idxA - idxB;
  }

  return (a.id || '').localeCompare(b.id || '');
}

export function formatBankTransferTitle(
  template: string,
  context: {
    invoiceNumber?: string;
    invoiceNumbers?: string[];
    ksefNumber?: string;
    displayId?: string;
    requestId?: string;
    applicantName?: string;
    year?: string | number;
  }
): string {
  if (!template) return '';
  const yearStr = String(context.year || new Date().getFullYear());
  const singleInv = context.invoiceNumber || (context.invoiceNumbers && context.invoiceNumbers.length > 0 ? context.invoiceNumbers[0] : '');
  const multiInvs = context.invoiceNumbers && context.invoiceNumbers.length > 0 ? context.invoiceNumbers.join(', ') : singleInv;

  let title = template
    .replace(/{invoiceNumber}/g, singleInv || '—')
    .replace(/{invoiceNumbers}/g, multiInvs || '—')
    .replace(/{ksefNumber}/g, context.ksefNumber || '')
    .replace(/{displayId}/g, context.displayId || '')
    .replace(/{requestId}/g, context.requestId || '')
    .replace(/{applicantName}/g, context.applicantName || '')
    .replace(/{year}/g, yearStr);

  if (title.length > 140 && context.invoiceNumbers && context.invoiceNumbers.length > 1) {
    let currentInvs = [...context.invoiceNumbers];
    while (currentInvs.length > 1 && title.length > 140) {
      currentInvs.pop();
      const shortened = currentInvs.join(', ') + '...';
      title = template
        .replace(/{invoiceNumber}/g, singleInv || '—')
        .replace(/{invoiceNumbers}/g, shortened)
        .replace(/{ksefNumber}/g, context.ksefNumber || '')
        .replace(/{displayId}/g, context.displayId || '')
        .replace(/{requestId}/g, context.requestId || '')
        .replace(/{applicantName}/g, context.applicantName || '')
        .replace(/{year}/g, yearStr);
    }
  }

  return title.substring(0, 140).trim();
}

const REQUESTS_STORAGE_KEY = 'financial_requests_list';
const SEQUENCE_STORAGE_KEY = 'financial_requests_seq_';

@Injectable({
  providedIn: 'root'
})
export class RequestsService {
  private _storage: Storage | null = null;
  private requestsSubject = new BehaviorSubject<FinancialRequest[]>([]);
  public requests$: Observable<FinancialRequest[]> = this.requestsSubject.asObservable();

  constructor(
    private storage: Storage,
    private http: HttpClient,
    private api: IDEAApiService,
    private appService: AppService
  ) {}

  private async initStorage(): Promise<Storage> {
    if (!this._storage) {
      this._storage = await this.storage.create();
    }
    return this._storage;
  }

  /**
   * Loads all requests for the currently authenticated user
   */
  public async loadMyRequests(): Promise<FinancialRequest[]> {
    const user = this.appService.currentUser;
    if (!user) return [];

    const storage = await this.initStorage();
    const rawList: any[] = (await storage.get(REQUESTS_STORAGE_KEY)) || [];

    try {
      const apiRequests: any[] = await this.api.getResource('requests');
      if (Array.isArray(apiRequests)) {
        // Recover any local unsynced drafts that are not yet on the server
        const unsyncedDrafts = rawList.filter(
          (r) =>
            r.status === 'DRAFT' &&
            r.userId?.toLowerCase() === user.userId?.toLowerCase() &&
            !apiRequests.some((ar) => ar.requestId === r.requestId)
        );

        for (const draft of unsyncedDrafts) {
          try {
            const synced = await this.api.postResource('requests', { body: draft });
            if (synced) {
              apiRequests.push(synced);
            }
          } catch (syncErr) {
            console.warn('Could not sync local draft to backend', syncErr);
            apiRequests.push(draft);
          }
        }

        const mapped = apiRequests
          .map((r) => new FinancialRequest(r))
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        this.requestsSubject.next(mapped);
        await storage.set(REQUESTS_STORAGE_KEY, apiRequests);
        return mapped;
      }
    } catch {
      // Fallback to local storage if API call fails
    }

    const myRequests = rawList
      .filter((r) => r.userId?.toLowerCase() === user.userId?.toLowerCase())
      .map((r) => new FinancialRequest(r))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    this.requestsSubject.next(myRequests);
    return myRequests;
  }

  /**
   * Loads all requests across all users (for managers, auditors, and administrators)
   */
  public async loadAllRequests(): Promise<FinancialRequest[]> {
    const user = this.appService.currentUser;
    const canViewAll =
      user?.isAdministrator ||
      user?.isManager ||
      user?.isAuditor ||
      user?.hasPermission(AppPermission.REQUESTS.VIEW_ALL) ||
      user?.hasPermission(AppPermission.REQUESTS.MANAGE) ||
      user?.hasPermission(AppPermission.REQUESTS.PAYOUTS) ||
      user?.hasPermission(AppPermission.REQUESTS.PARENT);

    if (!canViewAll) {
      return [];
    }

    try {
      const apiRequests: any[] = await this.api.getResource('requests', { params: { all: 'true' } });
      if (Array.isArray(apiRequests)) {
        const mapped = apiRequests.map((r) => new FinancialRequest(r));
        const storage = await this.initStorage();
        await storage.set(REQUESTS_STORAGE_KEY, apiRequests);
        return mapped;
      }
    } catch (err: any) {
      if (err?.status === 403 || err?.statusCode === 403 || err?.message?.includes('Access denied')) {
        return [];
      }
    }

    const storage = await this.initStorage();
    const rawList: any[] = (await storage.get(REQUESTS_STORAGE_KEY)) || [];
    return rawList
      .filter((r) => (r.status || '').toUpperCase() !== 'DRAFT')
      .map((r) => new FinancialRequest(r))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  /**
   * Update request status and optional reviewer comments / remarks (for managers & administrators)
   */
  public async updateRequestStatus(
    requestId: string,
    status: RequestStatus,
    comment?: string,
    adminRemarks?: string,
    paymentConfirmationAttachment?: AttachmentFile,
    paymentConfirmationAttachments?: AttachmentFile[]
  ): Promise<FinancialRequest> {
    return this.updateRequestStatusWithUpdates(requestId, {
      status,
      comment,
      adminRemarks,
      paymentConfirmationAttachment,
      paymentConfirmationAttachments
    });
  }

  /**
   * Update request with arbitrary updates (e.g. partial document payouts, status changes)
   */
  public async updateRequestStatusWithUpdates(
    requestId: string,
    updates: Partial<FinancialRequest> & {
      status?: RequestStatus;
      historyNote?: string;
      comment?: string;
      adminRemarks?: string;
      paymentConfirmationAttachment?: AttachmentFile;
      paymentConfirmationAttachments?: AttachmentFile[];
      skipStatusHistory?: boolean;
    }
  ): Promise<FinancialRequest> {
    const user = this.appService.currentUser;
    const now = new Date().toISOString();

    const body: any = { requestId, ...updates };
    if (updates.comment && !body.historyNote) {
      body.historyNote = updates.comment;
    }
    delete body.comment;

    try {
      let updatedRaw: any = null;
      try {
        updatedRaw = await this.api.patchResource(this.getRequestApiPath(requestId), { body });
      } catch {
        try {
          updatedRaw = await this.api.patchResource('requests', {
            params: { id: requestId },
            body
          });
        } catch {
          updatedRaw = await this.api.patchResource(['requests', encodeURIComponent(requestId)], { body });
        }
      }

      if (updatedRaw) {
        const updatedReq = new FinancialRequest(updatedRaw);
        const storage = await this.initStorage();
        const rawList: any[] = (await storage.get(REQUESTS_STORAGE_KEY)) || [];
        const idx = rawList.findIndex((r) => r.requestId === requestId);
        if (idx >= 0) {
          rawList[idx] = updatedRaw;
          await storage.set(REQUESTS_STORAGE_KEY, rawList);
        }
        await this.loadMyRequests();
        return updatedReq;
      }
    } catch {
      // Fallback to local storage update
    }

    const storage = await this.initStorage();
    const rawList: any[] = (await storage.get(REQUESTS_STORAGE_KEY)) || [];
    const idx = rawList.findIndex((r) => r.requestId === requestId);
    if (idx < 0) throw new Error('Request not found');

    const existing = new FinancialRequest(rawList[idx]);
    const targetStatus = updates.status || existing.status;
    const nowTs = new Date();

    const isDocPayoutSettlingRequest =
      existing.status === 'APPROVED' &&
      targetStatus === 'PAID' &&
      Array.isArray(updates.documents) &&
      updates.documents.length > 0 &&
      Boolean(updates.historyNote);

    const confirmations = updates.paymentConfirmationAttachments?.length
      ? updates.paymentConfirmationAttachments
      : (updates.paymentConfirmationAttachment ? [updates.paymentConfirmationAttachment] : undefined);
    const primaryConfirmation = confirmations?.[0] || updates.paymentConfirmationAttachment;

    const shouldAddHistory = !updates.skipStatusHistory && (existing.status !== targetStatus || Boolean(updates.historyNote));
    const historyEntries: any[] = [];

    if (shouldAddHistory) {
      if (isDocPayoutSettlingRequest) {
        historyEntries.push({
          status: 'APPROVED',
          timestamp: nowTs.toISOString(),
          updatedBy: user?.getDisplayName() || user?.userId || 'Manager',
          comment: updates.historyNote
        });
        historyEntries.push({
          status: 'PAID',
          timestamp: new Date(nowTs.getTime() + 100).toISOString(),
          updatedBy: user?.getDisplayName() || user?.userId || 'Manager',
          comment: 'REQUESTS.HISTORY_COMMENTS.PAYOUT_COMPLETED'
        });
      } else {
        historyEntries.push({
          status: targetStatus,
          timestamp: now,
          updatedBy: user?.getDisplayName() || user?.userId || 'Manager',
          comment: updates.historyNote || updates.comment || `Updated`
        });
      }
    }

    const updatedData = {
      ...rawList[idx],
      ...updates,
      status: targetStatus,
      adminRemarks: typeof updates.adminRemarks !== 'undefined' ? updates.adminRemarks : existing.adminRemarks,
      paymentConfirmationAttachment: primaryConfirmation || existing.paymentConfirmationAttachment,
      paymentConfirmationAttachments: confirmations || existing.paymentConfirmationAttachments || (existing.paymentConfirmationAttachment ? [existing.paymentConfirmationAttachment] : []),
      statusHistory: [...(existing.statusHistory || []), ...historyEntries],
      updatedAt: now
    };

    rawList[idx] = updatedData;
    await storage.set(REQUESTS_STORAGE_KEY, rawList);
    await this.loadMyRequests();
    return new FinancialRequest(updatedData);
  }

  /**
   * Mark a payout transaction or the entire request as paid.
   */
  public async markPayoutItemPaid(
    request: FinancialRequest,
    transaction?: BankTransactionItem,
    mode: 'SINGLE' | 'ALL' = 'SINGLE',
    comment?: string,
    paymentConfirmationAttachment?: AttachmentFile,
    paymentConfirmationAttachments?: AttachmentFile[]
  ): Promise<FinancialRequest> {
    const now = new Date().toISOString();
    const allDocs = request.documents ? JSON.parse(JSON.stringify(request.documents)) : [];

    const confirmations: AttachmentFile[] = paymentConfirmationAttachments?.length
      ? paymentConfirmationAttachments
      : (paymentConfirmationAttachment ? [paymentConfirmationAttachment] : []);
    const primaryConfirmation = confirmations[0] || paymentConfirmationAttachment;

    const paidDocs: any[] = [];

    if (mode === 'ALL' || !transaction || allDocs.length === 0) {
      for (const d of allDocs) {
        if (!d.payoutPaidOn) {
          paidDocs.push(d);
        }
        d.payoutPaidOn = d.payoutPaidOn || now;
      }
    } else if (transaction.invoiceIndex !== undefined && transaction.invoiceIndex >= 0 && transaction.invoiceIndex < allDocs.length) {
      if (!allDocs[transaction.invoiceIndex].payoutPaidOn) {
        paidDocs.push(allDocs[transaction.invoiceIndex]);
      }
      allDocs[transaction.invoiceIndex] = {
        ...allDocs[transaction.invoiceIndex],
        payoutPaidOn: now
      };
    } else {
      // Find matching unpaid documents by currency or invoiceNumber
      let matched = false;
      if (transaction.currency) {
        for (let i = 0; i < allDocs.length; i++) {
          const docCur = (allDocs[i].currency || request.currency || 'PLN').toUpperCase();
          if (!allDocs[i].payoutPaidOn && docCur === transaction.currency.toUpperCase()) {
            paidDocs.push(allDocs[i]);
            allDocs[i] = {
              ...allDocs[i],
              payoutPaidOn: now
            };
            matched = true;
          }
        }
      }
      if (!matched && transaction.invoiceNumber) {
        for (let i = 0; i < allDocs.length; i++) {
          if (!allDocs[i].payoutPaidOn && allDocs[i].invoiceNumber === transaction.invoiceNumber) {
            paidDocs.push(allDocs[i]);
            allDocs[i] = {
              ...allDocs[i],
              payoutPaidOn: now
            };
            matched = true;
            break;
          }
        }
      }
      if (!matched) {
        // Fallback: mark first unpaid document
        const firstUnpaid = allDocs.findIndex((d: any) => !d.payoutPaidOn);
        if (firstUnpaid >= 0) {
          paidDocs.push(allDocs[firstUnpaid]);
          allDocs[firstUnpaid] = {
            ...allDocs[firstUnpaid],
            payoutPaidOn: now
          };
        }
      }
    }

    const allPaid = allDocs.length > 0 && allDocs.every((d: any) => Boolean(d.payoutPaidOn));
    const targetStatus: RequestStatus = allPaid ? 'PAID' : 'APPROVED';

    // Accumulate payment confirmations from all payouts for the payment confirmation section
    const existingReqConfirmations: AttachmentFile[] = Array.isArray(request.paymentConfirmationAttachments)
      ? [...request.paymentConfirmationAttachments]
      : (request.paymentConfirmationAttachment ? [request.paymentConfirmationAttachment] : []);
    for (const c of confirmations) {
      if (!existingReqConfirmations.some(x => x.fileId === c.fileId || (x.s3Key && x.s3Key === c.s3Key))) {
        existingReqConfirmations.push(c);
      }
    }

    // Determine status history comment: "{invoice(s) number(s)} marked as paid"
    const invoiceNums = paidDocs
      .map((d: any) => d.invoiceNumber?.trim())
      .filter((n: string | undefined): n is string => Boolean(n));

    let invoicesStr = '';
    if (invoiceNums.length > 0) {
      invoicesStr = invoiceNums.join(', ');
    } else if (transaction?.invoiceNumber) {
      invoicesStr = transaction.invoiceNumber;
    } else if (paidDocs.length > 0) {
      invoicesStr = paidDocs.length === 1 ? 'Document' : 'Documents';
    } else {
      invoicesStr = 'Document';
    }

    const defaultComment = `${invoicesStr} marked as paid`;
    const finalComment = comment ? `${defaultComment} (${comment})` : defaultComment;

    return this.updateRequestStatusWithUpdates(request.requestId, {
      status: targetStatus,
      documents: allDocs.length > 0 ? allDocs : undefined,
      comment: finalComment,
      skipStatusHistory: false,
      paymentConfirmationAttachment: existingReqConfirmations[0] || primaryConfirmation,
      paymentConfirmationAttachments: existingReqConfirmations.length > 0 ? existingReqConfirmations : (confirmations.length > 0 ? confirmations : undefined)
    });
  }

  /**
   * Helper to extract raw value for a specific CSV export column ID
   */
  private getRequestColumnRawValue(req: FinancialRequest, colId: string): any {
    const grossPLN =
      typeof req.getGrossAmountPLN === 'function'
        ? req.getGrossAmountPLN()
        : (req.currency || 'PLN').toUpperCase() === 'PLN'
        ? req.totalGrossAmount || 0
        : 0;

    const vatPLN =
      typeof req.getVatAmountPLN === 'function'
        ? req.getVatAmountPLN()
        : (req.currency || 'PLN').toUpperCase() === 'PLN'
        ? req.totalVatAmount || 0
        : 0;

    const grossEUR =
      typeof req.getGrossAmountEUR === 'function'
        ? req.getGrossAmountEUR()
        : (req.currency || '').toUpperCase() === 'EUR'
        ? req.totalGrossAmount || 0
        : 0;

    const vatEUR =
      typeof req.getVatAmountEUR === 'function'
        ? req.getVatAmountEUR()
        : (req.currency || '').toUpperCase() === 'EUR'
        ? req.totalVatAmount || 0
        : 0;

    const isSingleEur = (req.currency || '').toUpperCase() === 'EUR' && !req.isMixedCurrency?.();

    switch (colId) {
      case 'displayId':
        return req.displayId;
      case 'createdAt':
        return req.createdAt ? new Date(req.createdAt) : null;
      case 'submittedAt':
        return req.submittedAt ? new Date(req.submittedAt) : null;
      case 'status':
        return req.status;
      case 'requestType':
        return req.requestType;
      case 'applicantName':
        return req.userDisplayName || '';
      case 'applicantEmail':
        return req.userEmail || '';
      case 'sectionOrCountry':
        return typeof req.getSectionOrCountry === 'function'
          ? req.getSectionOrCountry()
          : req.section || req.country || '';
      case 'isGuest':
        return Boolean(req.isGuest);
      case 'position':
        return req.position || '';
      case 'sourceOfFunding':
        return req.sourceOfFunding || '';
      case 'grossPLN':
        return grossPLN;
      case 'vatPLN':
        return vatPLN;
      case 'plnIban':
        return isSingleEur ? '' : req.iban || '';
      case 'plnSwift':
        return isSingleEur ? '' : req.swiftBic || '';
      case 'plnAccountHolder':
        return isSingleEur ? '' : req.accountHolderName || '';
      case 'grossEUR':
        return grossEUR;
      case 'vatEUR':
        return vatEUR;
      case 'eurIban':
        return req.ibanEUR || (isSingleEur ? req.iban : '');
      case 'eurSwift':
        return req.swiftBicEUR || (isSingleEur ? req.swiftBic : '');
      case 'eurAccountHolder':
        return req.accountHolderNameEUR || (isSingleEur ? req.accountHolderName : '');
      case 'adminRemarks':
        return req.adminRemarks || '';
      case 'currency':
        return req.currency || 'PLN';
      case 'totalGrossAmount':
        return req.totalGrossAmount || 0;
      case 'totalVatAmount':
        return req.totalVatAmount || 0;
      case 'generalExplanation':
        return req.generalExplanation || req.explanationAndBudget || '';
      case 'accountHolderAddress':
        return req.accountHolderAddress || '';
      case 'accountHolderAddressEUR':
        return req.accountHolderAddressEUR || '';
      case 'guestPurpose':
        return req.guestPurpose || '';
      default:
        return (req as any)[colId] ?? '';
    }
  }

  /**
   * Format a raw value according to CSV export settings
   */
  private formatCsvValue(val: any, settings: CsvExportSettings): string {
    if (val === null || val === undefined) return '""';

    if (val instanceof Date) {
      if (isNaN(val.getTime())) return '""';
      const yyyy = val.getFullYear();
      const mm = String(val.getMonth() + 1).padStart(2, '0');
      const dd = String(val.getDate()).padStart(2, '0');
      let dateStr = `${yyyy}-${mm}-${dd}`;
      if (settings.dateFormat === 'DD.MM.YYYY') {
        dateStr = `${dd}.${mm}.${yyyy}`;
      } else if (settings.dateFormat === 'DD/MM/YYYY') {
        dateStr = `${dd}/${mm}/${yyyy}`;
      }
      return `"${dateStr}"`;
    }

    if (typeof val === 'boolean') {
      const boolStr = settings.booleanFormat === '1_0' ? (val ? '1' : '0') : val ? 'TRUE' : 'FALSE';
      return `"${boolStr}"`;
    }

    if (typeof val === 'number') {
      let numStr = val.toFixed(2);
      if (settings.decimalSeparator === ',') {
        numStr = numStr.replace('.', ',');
      }
      return `"${numStr}"`;
    }

    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
  }

  /**
   * Export financial requests to a downloadable CSV spreadsheet
   */
  public exportToCsv(
    requests: FinancialRequest[],
    filename = `requests-export-${new Date().toISOString().slice(0, 10)}.csv`
  ): void {
    const settings = this.appService.configurations?.csvExportSettings || DEFAULT_CSV_EXPORT_SETTINGS;
    const currentLang =
      this.appService.configurations?.forcedLanguage &&
      this.appService.configurations.forcedLanguage !== 'ALL'
        ? this.appService.configurations.forcedLanguage
        : this.appService.currentLanguage || 'en';

    const enabledColumns = (settings.columns || []).filter(c => c.enabled);
    if (!enabledColumns.length) {
      enabledColumns.push(...DEFAULT_CSV_EXPORT_SETTINGS.columns.filter(c => c.enabled));
    }

    const headers = enabledColumns.map(col => {
      const custom = col.customHeader
        ? col.customHeader[currentLang as 'en' | 'pl'] ||
          (typeof col.customHeader === 'string' ? col.customHeader : '')
        : '';
      if (custom && custom.trim()) {
        return custom.trim();
      }
      return col.defaultHeader?.[currentLang as 'en' | 'pl'] || col.defaultHeader?.['en'] || col.id;
    });

    const delimiter = settings.delimiter || ';';

    const rows = requests.map(req => {
      return enabledColumns
        .map(col => {
          const raw = this.getRequestColumnRawValue(req, col.id);
          return this.formatCsvValue(raw, settings);
        })
        .join(delimiter);
    });

    const prefix = settings.includeBom !== false ? '\uFEFF' : '';
    const csvContent = prefix + [headers.join(delimiter), ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  /**
   * Builds bank transaction items from financial requests based on export settings
   */
  public buildBankTransactions(
    requests: FinancialRequest[],
    settings?: BankExportSettings
  ): BankTransactionItem[] {
    const s = settings || this.appService.configurations?.bankExportSettings || DEFAULT_BANK_EXPORT_SETTINGS;
    const transactions: BankTransactionItem[] = [];

    for (const req of requests) {
      const year = req.year || new Date(req.createdAt).getFullYear();
      const applicantName = req.accountHolderName || req.userDisplayName || '';
      const applicantAddress = req.accountHolderAddress || '';
      const isEur = (req.currency === 'EUR');
      const applicantAccount = isEur && req.ibanEUR ? req.ibanEUR : (req.iban || req.ibanEUR || '');
      const applicantSwift = isEur ? (req.ibanEUR ? (req.swiftBicEUR || '') : (req.swiftBic || '')) : (req.swiftBic || '');
      const cleanAppAccount = cleanPolishBankAccount(applicantAccount);

      if (req.requestType === 'INVOICE_REIMBURSEMENT') {
        const allDocs = req.documents || [];
        const docs = allDocs.filter(d => !d.payoutPaidOn);
        if (allDocs.length > 0 && docs.length === 0) {
          // All documents for this reimbursement are already paid out
          continue;
        }

        if (s.grouping === 'PER_DOCUMENT' && docs.length > 0) {
          docs.forEach((doc, idx) => {
            const originalIdx = allDocs.indexOf(doc);
            const docIdx = originalIdx >= 0 ? originalIdx : idx;
            const docAmount = Number(doc.grossAmount) || 0;
            const docCurrency = doc.currency || req.currency || 'PLN';
            const isDocEur = (docCurrency === 'EUR');
            const docAccount = isDocEur && req.ibanEUR ? req.ibanEUR : (req.iban || req.ibanEUR || '');
            const docSwift = isDocEur ? (req.ibanEUR ? (req.swiftBicEUR || '') : (req.swiftBic || '')) : (req.swiftBic || '');
            const cleanDocAccount = cleanPolishBankAccount(docAccount);
            const title = formatBankTransferTitle(s.reimbursementTitleTemplate, {
              invoiceNumber: doc.invoiceNumber,
              ksefNumber: doc.ksefNumber,
              displayId: req.displayId,
              requestId: req.requestId,
              applicantName,
              year
            });
            transactions.push({
              id: `${req.requestId}_doc_${docIdx}`,
              requestId: req.requestId,
              displayId: req.displayId,
              requestType: req.requestType,
              invoiceIndex: docIdx,
              invoiceNumber: doc.invoiceNumber || '',
              ksefNumber: doc.ksefNumber || '',
              recipientName: applicantName,
              recipientAccount: docAccount,
              cleanRecipientAccount: cleanDocAccount,
              recipientAddress: applicantAddress,
              recipientSwift: docSwift,
              amount: docAmount,
              currency: docCurrency,
              title,
              isDomestic: isDomesticAccount(docAccount, docSwift),
              isDomesticPln: isDomesticPlnAccount(docAccount, docCurrency, docSwift),
              status: req.status,
              originalRequest: req
            });
          });
        } else if (docs.length > 0) {
          // Group documents by currency so that EUR and PLN documents are never aggregated together
          const docsByCurrency = new Map<string, typeof docs>();
          for (const doc of docs) {
            const docCur = (doc.currency || req.currency || 'PLN').toUpperCase();
            if (!docsByCurrency.has(docCur)) {
              docsByCurrency.set(docCur, []);
            }
            docsByCurrency.get(docCur)!.push(doc);
          }

          const hasMultipleCurrencies = docsByCurrency.size > 1;

          docsByCurrency.forEach((curDocs, curCurrency) => {
            const isCurEur = (curCurrency === 'EUR');
            const curAccount = isCurEur && req.ibanEUR ? req.ibanEUR : (req.iban || req.ibanEUR || '');
            const curSwift = isCurEur ? (req.ibanEUR ? (req.swiftBicEUR || '') : (req.swiftBic || '')) : (req.swiftBic || '');
            const cleanCurAccount = cleanPolishBankAccount(curAccount);
            const curAmount = curDocs.reduce((acc, d) => acc + (Number(d.grossAmount) || 0), 0);
            const invNumbers = curDocs.map(d => d.invoiceNumber).filter(Boolean);
            const ksefNumbers = curDocs.map(d => d.ksefNumber).filter(Boolean);

            const tmpl = curDocs.length > 1 ? s.reimbursementMultipleTitleTemplate : s.reimbursementTitleTemplate;
            const title = formatBankTransferTitle(tmpl, {
              invoiceNumber: invNumbers[0] || '',
              invoiceNumbers: invNumbers,
              ksefNumber: ksefNumbers[0] || '',
              displayId: req.displayId,
              requestId: req.requestId,
              applicantName,
              year
            });

            const txId = hasMultipleCurrencies ? `${req.requestId}_${curCurrency.toLowerCase()}` : req.requestId;

            transactions.push({
              id: txId,
              requestId: req.requestId,
              displayId: req.displayId,
              requestType: req.requestType,
              invoiceNumber: invNumbers.join(', '),
              ksefNumber: ksefNumbers.join(', '),
              recipientName: applicantName,
              recipientAccount: curAccount,
              cleanRecipientAccount: cleanCurAccount,
              recipientAddress: applicantAddress,
              recipientSwift: curSwift,
              amount: curAmount,
              currency: curCurrency,
              title,
              isDomestic: isDomesticAccount(curAccount, curSwift),
              isDomesticPln: isDomesticPlnAccount(curAccount, curCurrency, curSwift),
              status: req.status,
              originalRequest: req
            });
          });
        } else {
          const fallbackCurrency = req.currency || 'PLN';
          const isFallbackEur = (fallbackCurrency === 'EUR');
          const fallbackAccount = isFallbackEur && req.ibanEUR ? req.ibanEUR : (req.iban || req.ibanEUR || '');
          const fallbackSwift = isFallbackEur ? (req.ibanEUR ? (req.swiftBicEUR || '') : (req.swiftBic || '')) : (req.swiftBic || '');
          const cleanFallbackAccount = cleanPolishBankAccount(fallbackAccount);
          const title = formatBankTransferTitle(s.reimbursementTitleTemplate, {
            invoiceNumber: '',
            invoiceNumbers: [],
            ksefNumber: '',
            displayId: req.displayId,
            requestId: req.requestId,
            applicantName,
            year
          });
          transactions.push({
            id: req.requestId,
            requestId: req.requestId,
            displayId: req.displayId,
            requestType: req.requestType,
            invoiceNumber: '',
            ksefNumber: '',
            recipientName: applicantName,
            recipientAccount: fallbackAccount,
            cleanRecipientAccount: cleanFallbackAccount,
            recipientAddress: applicantAddress,
            recipientSwift: fallbackSwift,
            amount: Number(req.totalGrossAmount) || 0,
            currency: fallbackCurrency,
            title,
            isDomestic: isDomesticAccount(fallbackAccount, fallbackSwift),
            isDomesticPln: isDomesticPlnAccount(fallbackAccount, fallbackCurrency, fallbackSwift),
            status: req.status,
            originalRequest: req
          });
        }
      } else if (req.requestType === 'INVOICE_TO_PAY') {
        const allDocs = req.documents || [];
        const docs = allDocs.filter(d => !d.payoutPaidOn);
        if (allDocs.length > 0 && docs.length === 0) {
          // All invoices for this request are already paid out
          continue;
        }

        if (s.grouping === 'PER_DOCUMENT' && docs.length > 0) {
          docs.forEach((doc, idx) => {
            const originalIdx = allDocs.indexOf(doc);
            const docIdx = originalIdx >= 0 ? originalIdx : idx;
            const docAmount = Number(doc.grossAmount) || 0;
            const contractorAccount = doc.bankAccountDetails || '';
            const cleanContractorAcc = cleanPolishBankAccount(contractorAccount);
            const docCurrency = doc.currency || req.currency || 'PLN';
            const title = formatBankTransferTitle(s.invoiceToPayTitleTemplate, {
              invoiceNumber: doc.invoiceNumber,
              ksefNumber: doc.ksefNumber,
              displayId: req.displayId,
              requestId: req.requestId,
              applicantName: doc.issuedBy || applicantName,
              year
            });
            transactions.push({
              id: `${req.requestId}_doc_${docIdx}`,
              requestId: req.requestId,
              displayId: req.displayId,
              requestType: req.requestType,
              invoiceIndex: docIdx,
              invoiceNumber: doc.invoiceNumber || '',
              ksefNumber: doc.ksefNumber || '',
              recipientName: doc.issuedBy || applicantName,
              recipientAccount: contractorAccount,
              cleanRecipientAccount: cleanContractorAcc,
              recipientAddress: applicantAddress,
              recipientSwift: '',
              amount: docAmount,
              currency: docCurrency,
              title,
              isDomestic: isDomesticAccount(contractorAccount),
              isDomesticPln: isDomesticPlnAccount(contractorAccount, docCurrency),
              status: req.status,
              originalRequest: req
            });
          });
        } else {
          const invNumbers = docs.map(d => d.invoiceNumber).filter(Boolean);
          const firstDoc = docs[0];
          const contractorAccount = firstDoc?.bankAccountDetails || '';
          const cleanContractorAcc = cleanPolishBankAccount(contractorAccount);
          const reqCurrency = firstDoc?.currency || req.currency || 'PLN';
          const title = formatBankTransferTitle(s.invoiceToPayTitleTemplate, {
            invoiceNumber: invNumbers.join(', '),
            invoiceNumbers: invNumbers,
            ksefNumber: docs.map(d => d.ksefNumber).filter(Boolean).join(', '),
            displayId: req.displayId,
            requestId: req.requestId,
            applicantName: firstDoc?.issuedBy || applicantName,
            year
          });
          const curAmount = docs.length > 0
            ? docs.reduce((acc, d) => acc + (Number(d.grossAmount) || 0), 0)
            : (Number(req.totalGrossAmount) || 0);
          transactions.push({
            id: req.requestId,
            requestId: req.requestId,
            displayId: req.displayId,
            requestType: req.requestType,
            invoiceNumber: invNumbers.join(', '),
            ksefNumber: docs.map(d => d.ksefNumber).filter(Boolean).join(', '),
            recipientName: firstDoc?.issuedBy || applicantName,
            recipientAccount: contractorAccount,
            cleanRecipientAccount: cleanContractorAcc,
            recipientAddress: applicantAddress,
            recipientSwift: '',
            amount: curAmount,
            currency: reqCurrency,
            title,
            isDomestic: isDomesticAccount(contractorAccount),
            isDomesticPln: isDomesticPlnAccount(contractorAccount, reqCurrency),
            status: req.status,
            originalRequest: req
          });
        }
      } else if (req.requestType === 'ADVANCE_PAYMENT') {
        const isAdvEur = (req.currency === 'EUR');
        const advAccount = isAdvEur && req.ibanEUR ? req.ibanEUR : (req.iban || req.ibanEUR || '');
        const advSwift = isAdvEur ? (req.ibanEUR ? (req.swiftBicEUR || '') : (req.swiftBic || '')) : (req.swiftBic || '');
        const cleanAdvAccount = cleanPolishBankAccount(advAccount);
        const reqCurrency = req.currency || 'PLN';
        const title = formatBankTransferTitle(s.advanceTitleTemplate, {
          displayId: req.displayId,
          requestId: req.requestId,
          applicantName,
          year
        });
        transactions.push({
          id: req.requestId,
          requestId: req.requestId,
          displayId: req.displayId,
          requestType: req.requestType,
          recipientName: applicantName,
          recipientAccount: advAccount,
          cleanRecipientAccount: cleanAdvAccount,
          recipientAddress: applicantAddress,
          recipientSwift: advSwift,
          amount: Number(req.totalGrossAmount) || 0,
          currency: reqCurrency,
          title,
          isDomestic: isDomesticAccount(advAccount, advSwift),
          isDomesticPln: isDomesticPlnAccount(advAccount, reqCurrency, advSwift),
          status: req.status,
          originalRequest: req
        });
      } else if (req.requestType === 'DELEGATION_SETTLEMENT') {
        const isDelEur = (req.currency === 'EUR');
        const delAccount = isDelEur && req.ibanEUR ? req.ibanEUR : (req.iban || req.ibanEUR || '');
        const delSwift = isDelEur ? (req.ibanEUR ? (req.swiftBicEUR || '') : (req.swiftBic || '')) : (req.swiftBic || '');
        const cleanDelAccount = cleanPolishBankAccount(delAccount);
        const reqCurrency = req.currency || 'PLN';
        const title = formatBankTransferTitle(s.delegationTitleTemplate, {
          displayId: req.displayId,
          requestId: req.requestId,
          applicantName,
          year
        });
        transactions.push({
          id: req.requestId,
          requestId: req.requestId,
          displayId: req.displayId,
          requestType: req.requestType,
          recipientName: applicantName,
          recipientAccount: delAccount,
          cleanRecipientAccount: cleanDelAccount,
          recipientAddress: applicantAddress,
          recipientSwift: delSwift,
          amount: Number(req.totalGrossAmount) || 0,
          currency: reqCurrency,
          title,
          isDomestic: isDomesticAccount(delAccount, delSwift),
          isDomesticPln: isDomesticPlnAccount(delAccount, reqCurrency, delSwift),
          status: req.status,
          originalRequest: req
        });
      }
    }

    return transactions.sort(compareTransactionsOldestFirst);
  }

  /**
   * Export transactions to Erste Bank Polska .txt format (4120414|1)
   */
  public exportToErsteBankTxt(
    transactions: BankTransactionItem[],
    settings?: BankExportSettings,
    filename = `przelewy-erste-${new Date().toISOString().slice(0, 10)}.txt`
  ): void {
    const s = settings || this.appService.configurations?.bankExportSettings || DEFAULT_BANK_EXPORT_SETTINGS;
    const cleanSender = cleanPolishBankAccount(s.senderAccountNumber);

    const header = `${s.templateVersion || '4120414'}|${s.packageType || '1'}\r\n`;

    const executionDateStr = s.includeExecutionDate ? (() => {
      const d = new Date();
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      return `${dd}-${mm}-${d.getFullYear()}`;
    })() : '';

    const lines = transactions.map(item => {
      const rachunekMa = item.cleanRecipientAccount || cleanPolishBankAccount(item.recipientAccount);
      const recipientNameAscii = transliteratePolishToAscii(item.recipientName).replace(/\|/g, ' ').substring(0, 105);
      const addressAscii = s.includeAddress ? transliteratePolishToAscii(item.recipientAddress).replace(/\|/g, ' ').substring(0, 105) : '';
      const amountStr = item.amount.toFixed(2).replace('.', ',');
      const transferType = s.transferType || '1';
      const titleAscii = transliteratePolishToAscii(item.title).replace(/\|/g, ' ').substring(0, 140);
      const nip = (item.recipientNip || '').replace(/[^0-9]/g, '');

      return `1|${cleanSender}|${rachunekMa}|${recipientNameAscii}|${addressAscii}|${amountStr}|${transferType}|${titleAscii}|${executionDateStr}|${nip}|`;
    });

    const fileContent = header + lines.join('\r\n') + (lines.length > 0 ? '\r\n' : '');
    const blob = new Blob([fileContent], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  /**
   * Get the single most recent request for user dashboard widget
   */
  public async getLatestRequest(): Promise<FinancialRequest | null> {
    const list = await this.loadMyRequests();
    return list.length > 0 ? list[0] : null;
  }

  /**
   * Get request by formatted ID (e.g. "1/2026")
   */
  /**
   * Helper to build clean API path segments e.g. /requests/2026/1 or /requests/draft_xyz
   */
  public getRequestApiPath(requestId: string): string[] {
    const [seq, year] = requestId.split('/');
    if (year && seq) {
      return ['requests', year, seq];
    }
    return ['requests', encodeURIComponent(requestId)];
  }

  public async getRequestById(requestId: string): Promise<FinancialRequest | null> {
    try {
      const raw = await this.api.getResource(this.getRequestApiPath(requestId));
      if (raw && !Array.isArray(raw)) {
        const req = new FinancialRequest(raw);
        await this.updateRequestInCache(req);
        return req;
      }
    } catch (err: any) {
      if (err?.status === 403 || err?.statusCode === 403 || err?.message?.includes('Access denied')) {
        throw err;
      }
      // Fallback to query param
    }

    try {
      const raw = await this.api.getResource('requests', { params: { id: requestId } });
      if (raw && !Array.isArray(raw)) {
        const req = new FinancialRequest(raw);
        await this.updateRequestInCache(req);
        return req;
      }
      if (Array.isArray(raw)) {
        const foundItem = raw.find(
          (r: any) => r.requestId === requestId || r.requestId === decodeURIComponent(requestId)
        );
        if (foundItem) {
          const req = new FinancialRequest(foundItem);
          await this.updateRequestInCache(req);
          return req;
        }
      }
    } catch (err: any) {
      if (err?.status === 403 || err?.statusCode === 403 || err?.message?.includes('Access denied')) {
        throw err;
      }
      // Fallback
    }

    try {
      const raw = await this.api.getResource(['requests', encodeURIComponent(requestId)]);
      if (raw && !Array.isArray(raw)) {
        const req = new FinancialRequest(raw);
        await this.updateRequestInCache(req);
        return req;
      }
    } catch (err: any) {
      if (err?.status === 403 || err?.statusCode === 403 || err?.message?.includes('Access denied')) {
        throw err;
      }
      // Fallback to local storage
    }

    const user = this.appService.currentUser;
    const canViewAll =
      user?.isAdministrator ||
      user?.isManager ||
      user?.isAuditor ||
      user?.hasPermission(AppPermission.REQUESTS.VIEW_ALL) ||
      user?.hasPermission(AppPermission.REQUESTS.MANAGE) ||
      user?.hasPermission(AppPermission.REQUESTS.PAYOUTS) ||
      user?.hasPermission(AppPermission.REQUESTS.PARENT);

    const storage = await this.initStorage();
    const rawList: any[] = (await storage.get(REQUESTS_STORAGE_KEY)) || [];
    const found = rawList.find(
      (r) => r.requestId === requestId || r.requestId === decodeURIComponent(requestId)
    );
    if (!found) {
      return null;
    }

    const isOwner = (found.userId || '').toLowerCase() === (user?.userId || '').toLowerCase();
    if (!canViewAll && !isOwner) {
      return null;
    }

    return new FinancialRequest(found);
  }

  private async updateRequestInCache(req: FinancialRequest): Promise<void> {
    try {
      const storage = await this.initStorage();
      const rawList: any[] = (await storage.get(REQUESTS_STORAGE_KEY)) || [];
      const idx = rawList.findIndex((r) => r.requestId === req.requestId);
      if (idx >= 0) {
        rawList[idx] = req;
      } else {
        rawList.unshift(req);
      }
      await storage.set(REQUESTS_STORAGE_KEY, rawList);
    } catch {
      // Ignore cache errors
    }
  }

  /**
   * Calculate totals across all documents for an invoice/reimbursement request
   */
  public calculateTotals(documents: InvoiceDocumentItem[]): {
    totalGrossAmount: number;
    totalVatAmount: number;
  } {
    let gross = 0;
    let vat = 0;
    for (const doc of documents) {
      gross += Number(doc.grossAmount) || 0;
      vat += Number(doc.vatAmount) || 0;
    }
    return {
      totalGrossAmount: Math.round(gross * 100) / 100,
      totalVatAmount: Math.round(vat * 100) / 100
    };
  }

  /**
   * Generate next sequential request ID for current calendar year (e.g. "1/2026", "2/2026")
   */
  public async generateNextRequestId(year = new Date().getFullYear()): Promise<{
    requestId: string;
    sequenceNumber: number;
    year: number;
  }> {
    const storage = await this.initStorage();
    const seqKey = `${SEQUENCE_STORAGE_KEY}${year}`;
    let currentSeq = (await storage.get(seqKey)) || 0;
    currentSeq += 1;
    await storage.set(seqKey, currentSeq);

    return {
      requestId: `${currentSeq}/${year}`,
      sequenceNumber: currentSeq,
      year
    };
  }

  /**
   * Save a request as DRAFT or submit it as SUBMITTED
   */
  public async saveRequest(
    payload: Partial<FinancialRequest>,
    targetStatus: 'DRAFT' | 'SUBMITTED'
  ): Promise<FinancialRequest> {
    const user = this.appService.currentUser;
    if (!user) throw new Error('User must be authenticated to submit request');

    const storage = await this.initStorage();
    const rawList: any[] = (await storage.get(REQUESTS_STORAGE_KEY)) || [];

    // Calculate totals
    let totals: { totalGrossAmount: number; totalVatAmount: number; currency?: string };
    if (payload.requestType === 'ADVANCE_PAYMENT') {
      const advGross = Number(payload.requestedAmountPLN ?? payload.totalGrossAmount) || 0;
      totals = { totalGrossAmount: advGross, totalVatAmount: 0, currency: payload.currency || 'PLN' };
    } else if (payload.requestType === 'DELEGATION_SETTLEMENT') {
      const delGross = Number(payload.delegationTotalAmount ?? payload.totalGrossAmount) || 0;
      totals = { totalGrossAmount: delGross, totalVatAmount: 0, currency: 'PLN' };
    } else if (
      (payload.requestType === 'INVOICE_TO_PAY' || payload.requestType === 'INVOICE_REIMBURSEMENT') &&
      payload.documents &&
      payload.documents.length > 0
    ) {
      const plnDocs = payload.documents.filter((d) => (d.currency || 'PLN').toUpperCase() === 'PLN');
      const eurDocs = payload.documents.filter((d) => (d.currency || '').toUpperCase() === 'EUR');

      const plnTotals = this.calculateTotals(plnDocs);
      const eurTotals = this.calculateTotals(eurDocs);

      let primaryCurr = payload.currency || 'PLN';
      if (eurDocs.length > 0 && plnDocs.length === 0) {
        primaryCurr = 'EUR';
        totals = {
          totalGrossAmount: eurTotals.totalGrossAmount,
          totalVatAmount: eurTotals.totalVatAmount,
          currency: 'EUR'
        };
      } else if (plnDocs.length > 0 && eurDocs.length === 0) {
        primaryCurr = 'PLN';
        totals = {
          totalGrossAmount: plnTotals.totalGrossAmount,
          totalVatAmount: plnTotals.totalVatAmount,
          currency: 'PLN'
        };
      } else {
        totals = {
          totalGrossAmount: Math.round((plnTotals.totalGrossAmount + eurTotals.totalGrossAmount) * 100) / 100,
          totalVatAmount: Math.round((plnTotals.totalVatAmount + eurTotals.totalVatAmount) * 100) / 100,
          currency: primaryCurr
        };
      }
    } else {
      totals = {
        totalGrossAmount: Number(payload.totalGrossAmount) || 0,
        totalVatAmount: Number(payload.totalVatAmount) || 0,
        currency: payload.currency || 'PLN'
      };
    }

    const now = new Date().toISOString();
    const requestBody: any = {
      ...payload,
      ...totals,
      requestedAmountPLN: payload.requestType === 'ADVANCE_PAYMENT' ? totals.totalGrossAmount : payload.requestedAmountPLN,
      delegationTotalAmount: payload.requestType === 'DELEGATION_SETTLEMENT' ? totals.totalGrossAmount : payload.delegationTotalAmount,
      status: targetStatus,
      currency: totals.currency || payload.currency || 'PLN'
    };

    let savedReq: FinancialRequest | null = null;

    // 1. Try persisting via backend API
    if (payload.requestId) {
      try {
        let updatedRaw: any = null;
        try {
          updatedRaw = await this.api.patchResource(
            this.getRequestApiPath(payload.requestId),
            { body: requestBody }
          );
        } catch {
          try {
            updatedRaw = await this.api.patchResource('requests', {
              params: { id: payload.requestId },
              body: requestBody
            });
          } catch {
            updatedRaw = await this.api.patchResource(
              ['requests', encodeURIComponent(payload.requestId)],
              { body: requestBody }
            );
          }
        }
        if (updatedRaw) {
          savedReq = new FinancialRequest(updatedRaw);
        }
      } catch (err: any) {
        console.warn('Failed to patch request on backend API', err);
        // If request was not found on backend (e.g. was a purely local draft), fallback to POST
        if (err?.status === 404 || err?.statusCode === 404 || err?.message?.includes('not found')) {
          try {
            const createdRaw = await this.api.postResource('requests', { body: requestBody });
            if (createdRaw) {
              savedReq = new FinancialRequest(createdRaw);
            }
          } catch (postErr) {
            console.error('Failed to post request as fallback', postErr);
          }
        }
      }
    } else {
      try {
        const createdRaw = await this.api.postResource('requests', { body: requestBody });
        if (createdRaw) {
          savedReq = new FinancialRequest(createdRaw);
        }
      } catch (err) {
        console.warn('Failed to post new request to backend API', err);
      }
    }

    // 2. If API succeeded, update local storage cache and reload
    if (savedReq) {
      const idx = rawList.findIndex((r) => r.requestId === payload.requestId || r.requestId === savedReq!.requestId);
      if (idx >= 0) {
        rawList[idx] = savedReq;
      } else {
        rawList.unshift(savedReq);
      }
      await storage.set(REQUESTS_STORAGE_KEY, rawList);
      await this.loadMyRequests();
      return savedReq;
    }

    // 3. Fallback to local storage if API was unreachable or failed completely
    let existingIndex = -1;
    if (payload.requestId) {
      existingIndex = rawList.findIndex((r) => r.requestId === payload.requestId);
    }

    if (existingIndex >= 0) {
      const existing = new FinancialRequest(rawList[existingIndex]);
      if (!existing.canEdit()) {
        throw new Error('This request is locked and cannot be modified');
      }

      let targetRequestId = existing.requestId;
      let targetYear = existing.year || new Date().getFullYear();
      let targetSeqNumber = existing.sequenceNumber;

      if (existing.status === 'DRAFT' && targetStatus === 'SUBMITTED') {
        const nextId = await this.generateNextRequestId(targetYear);
        targetRequestId = nextId.requestId;
        targetSeqNumber = nextId.sequenceNumber;
        targetYear = nextId.year;
      }

      const updatedData = {
        ...rawList[existingIndex],
        ...payload,
        ...totals,
        requestId: targetRequestId,
        year: targetYear,
        sequenceNumber: targetSeqNumber,
        userAvatarURL: rawList[existingIndex]?.userAvatarURL || user.avatarURL || '',
        status: targetStatus,
        updatedAt: now
      };

      if (targetStatus === 'SUBMITTED' && !updatedData.submittedAt) {
        updatedData.submittedAt = now;
      }

      if (existing.status !== targetStatus) {
        updatedData.statusHistory = [
          ...(updatedData.statusHistory || []),
          {
            status: targetStatus,
            timestamp: now,
            updatedBy: user.getDisplayName(),
            comment: targetStatus === 'SUBMITTED' ? 'REQUESTS.HISTORY_COMMENTS.SUBMITTED_BY_APPLICANT' : 'REQUESTS.HISTORY_COMMENTS.DRAFT_SAVED'
          }
        ];
      }

      rawList[existingIndex] = updatedData;
      await storage.set(REQUESTS_STORAGE_KEY, rawList);
      await this.loadMyRequests();
      return new FinancialRequest(updatedData);
    } else {
      const year = new Date().getFullYear();
      let sequenceNumber: number | undefined;
      let requestId: string;

      if (targetStatus === 'SUBMITTED') {
        const nextId = await this.generateNextRequestId(year);
        sequenceNumber = nextId.sequenceNumber;
        requestId = nextId.requestId;
      } else {
        const rand = Math.random().toString(36).substring(2, 8);
        requestId = `draft_${Date.now()}_${rand}`;
      }

      const newRequestData: any = {
        ...payload,
        requestId,
        year,
        sequenceNumber,
        userId: user.userId,
        userDisplayName: user.getDisplayName(),
        userEmail: user.email,
        userAvatarURL: user.avatarURL || '',
        section: payload.section || user.section || user.sectionCode || '',
        country: payload.country || user.country || '',
        extendedRoles: user.extendedRoles || [],
        status: targetStatus,
        ...totals,
        currency: payload.currency || 'PLN',
        createdAt: now,
        updatedAt: now,
        submittedAt: targetStatus === 'SUBMITTED' ? now : undefined,
        statusHistory: [
          {
            status: targetStatus,
            timestamp: now,
            updatedBy: user.getDisplayName(),
            comment: targetStatus === 'SUBMITTED' ? 'REQUESTS.HISTORY_COMMENTS.SUBMITTED_BY_APPLICANT' : 'REQUESTS.HISTORY_COMMENTS.DRAFT_CREATED'
          }
        ]
      };

      rawList.unshift(newRequestData);
      await storage.set(REQUESTS_STORAGE_KEY, rawList);
      await this.loadMyRequests();
      return new FinancialRequest(newRequestData);
    }
  }

  /**
   * Delete a request (allowed ONLY when DRAFT and owned by user)
   */
  public async deleteDraft(requestId: string): Promise<boolean> {
    const user = this.appService.currentUser;
    if (!user) return false;

    try {
      await this.api.deleteResource(this.getRequestApiPath(requestId));
    } catch {
      try {
        await this.api.deleteResource('requests', { params: { id: requestId } });
      } catch {
        try {
          await this.api.deleteResource(['requests', encodeURIComponent(requestId)]);
        } catch (err) {
          console.warn('Failed to delete draft from backend API', err);
        }
      }
    }

    const storage = await this.initStorage();
    const rawList: any[] = (await storage.get(REQUESTS_STORAGE_KEY)) || [];
    const targetIndex = rawList.findIndex((r) => r.requestId === requestId);

    if (targetIndex >= 0) {
      rawList.splice(targetIndex, 1);
      await storage.set(REQUESTS_STORAGE_KEY, rawList);
    }

    await this.loadMyRequests();
    return true;
  }
}
