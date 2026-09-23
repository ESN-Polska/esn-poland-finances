import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Storage } from '@ionic/storage-angular';
import { BehaviorSubject, Observable } from 'rxjs';
import { IDEAApiService } from '@idea-ionic/common';
import { environment as env } from '@env';
import {
  FinancialRequest,
  FinancialRequestType,
  InvoiceDocumentItem,
  RequestStatus
} from '@models/financial-request.model';
import { AppPermission } from '@models/configurations.model';
import { AppService } from '../app.service';

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
    adminRemarks?: string
  ): Promise<FinancialRequest> {
    const user = this.appService.currentUser;
    const now = new Date().toISOString();

    const body: any = { status, requestId };
    if (comment) body.historyNote = comment;
    if (typeof adminRemarks !== 'undefined') body.adminRemarks = adminRemarks;

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
    const newHistory = {
      status,
      timestamp: now,
      updatedBy: user?.getDisplayName() || user?.userId || 'Manager',
      comment: comment || `Status changed to ${status}`
    };

    const updatedData = {
      ...rawList[idx],
      status,
      adminRemarks: typeof adminRemarks !== 'undefined' ? adminRemarks : existing.adminRemarks,
      statusHistory: [...(existing.statusHistory || []), newHistory],
      updatedAt: now
    };

    rawList[idx] = updatedData;
    await storage.set(REQUESTS_STORAGE_KEY, rawList);
    await this.loadMyRequests();
    return new FinancialRequest(updatedData);
  }

  /**
   * Export financial requests to a downloadable CSV spreadsheet
   */
  public exportToCsv(
    requests: FinancialRequest[],
    filename = `requests-export-${new Date().toISOString().slice(0, 10)}.csv`
  ): void {
    const headers = [
      'ID',
      'Date Created',
      'Date Submitted',
      'Status',
      'Type',
      'Applicant Name',
      'Applicant Email',
      'Section / Country',
      'Guest',
      'Position',
      'Funding Source',
      'Gross Amount',
      'VAT Amount',
      'Currency',
      'IBAN',
      'SWIFT/BIC',
      'Account Holder',
      'Admin Remarks'
    ];

    const rows = requests.map((req) => {
      const escape = (val: any) => {
        if (val === null || val === undefined) return '""';
        const str = String(val).replace(/"/g, '""');
        return `"${str}"`;
      };

      return [
        escape(req.displayId),
        escape(req.createdAt ? new Date(req.createdAt).toISOString().slice(0, 10) : ''),
        escape(req.submittedAt ? new Date(req.submittedAt).toISOString().slice(0, 10) : ''),
        escape(req.status),
        escape(req.requestType),
        escape(req.userDisplayName || ''),
        escape(req.userEmail || ''),
        escape(typeof req.getSectionOrCountry === 'function' ? req.getSectionOrCountry() : req.section || req.country || ''),
        escape(req.isGuest ? 'Yes' : 'No'),
        escape(req.position || ''),
        escape(req.sourceOfFunding || ''),
        escape(req.isMixedCurrency?.() ? `${req.getGrossAmountPLN()} PLN / ${req.getGrossAmountEUR()} EUR` : (req.totalGrossAmount || 0)),
        escape(req.isMixedCurrency?.() ? `${req.getVatAmountPLN()} PLN / ${req.getVatAmountEUR()} EUR` : (req.totalVatAmount || 0)),
        escape(req.isMixedCurrency?.() ? 'PLN / EUR' : (req.currency || 'PLN')),
        escape(req.iban || ''),
        escape(req.swiftBic || ''),
        escape(req.accountHolderName || ''),
        escape(req.adminRemarks || '')
      ].join(';');
    });

    const csvContent = '\uFEFF' + [headers.join(';'), ...rows].join('\r\n');
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
      totals = { totalGrossAmount: advGross, totalVatAmount: 0, currency: 'PLN' };
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
            comment: targetStatus === 'SUBMITTED' ? 'Submitted by applicant' : 'Draft saved'
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
        section: user.section || user.sectionCode || '',
        country: user.country || '',
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
            comment: targetStatus === 'SUBMITTED' ? 'Submitted by applicant' : 'Initial draft created'
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
