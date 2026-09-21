import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Storage } from '@ionic/storage-angular';
import { BehaviorSubject, Observable } from 'rxjs';
import { environment as env } from '@env';
import {
  FinancialRequest,
  FinancialRequestType,
  InvoiceDocumentItem,
  RequestStatus
} from '@models/financial-request.model';
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
    const myRequests = rawList
      .filter((r) => r.userId?.toLowerCase() === user.userId?.toLowerCase())
      .map((r) => new FinancialRequest(r))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    this.requestsSubject.next(myRequests);
    return myRequests;
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
  public async getRequestById(requestId: string): Promise<FinancialRequest | null> {
    const storage = await this.initStorage();
    const rawList: any[] = (await storage.get(REQUESTS_STORAGE_KEY)) || [];
    const found = rawList.find(
      (r) => r.requestId === requestId || r.requestId === decodeURIComponent(requestId)
    );
    return found ? new FinancialRequest(found) : null;
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

    let existingIndex = -1;
    if (payload.requestId) {
      existingIndex = rawList.findIndex((r) => r.requestId === payload.requestId);
    }

    const now = new Date().toISOString();

    if (existingIndex >= 0) {
      // Modifying existing request
      const existing = new FinancialRequest(rawList[existingIndex]);
      if (!existing.canEdit()) {
        throw new Error('This request is locked and cannot be modified');
      }

      // Calculate totals
      let totals = { totalGrossAmount: 0, totalVatAmount: 0 };
      if (payload.documents && payload.documents.length > 0) {
        totals = this.calculateTotals(payload.documents);
      } else if (payload.requestType === 'ADVANCE_PAYMENT') {
        totals = { totalGrossAmount: payload.requestedAmountPLN || 0, totalVatAmount: 0 };
      }

      const updatedData = {
        ...rawList[existingIndex],
        ...payload,
        ...totals,
        userAvatarURL: rawList[existingIndex]?.userAvatarURL || user.avatarURL || '',
        status: targetStatus,
        updatedAt: now
      };

      // Add status history entry if status changed
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
      // Creating brand new request
      const nextId = await this.generateNextRequestId();
      let totals = { totalGrossAmount: 0, totalVatAmount: 0 };
      if (payload.documents && payload.documents.length > 0) {
        totals = this.calculateTotals(payload.documents);
      } else if (payload.requestType === 'ADVANCE_PAYMENT') {
        totals = { totalGrossAmount: payload.requestedAmountPLN || 0, totalVatAmount: 0 };
      }

      const newRequestData: any = {
        ...payload,
        requestId: nextId.requestId,
        year: nextId.year,
        sequenceNumber: nextId.sequenceNumber,
        userId: user.userId,
        userDisplayName: user.getDisplayName(),
        userEmail: user.email,
        userAvatarURL: user.avatarURL || '',
        section: user.section || user.sectionCode || (user.country ? 'ESN ' + user.country : ''),
        country: user.country || '',
        extendedRoles: user.extendedRoles || [],
        status: targetStatus,
        ...totals,
        currency: payload.currency || 'PLN',
        createdAt: now,
        updatedAt: now,
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

    const storage = await this.initStorage();
    const rawList: any[] = (await storage.get(REQUESTS_STORAGE_KEY)) || [];
    const targetIndex = rawList.findIndex((r) => r.requestId === requestId);

    if (targetIndex < 0) return false;

    const target = new FinancialRequest(rawList[targetIndex]);
    if (target.status !== 'DRAFT' || target.userId?.toLowerCase() !== user.userId?.toLowerCase()) {
      throw new Error('Only draft requests can be deleted');
    }

    rawList.splice(targetIndex, 1);
    await storage.set(REQUESTS_STORAGE_KEY, rawList);
    await this.loadMyRequests();
    return true;
  }
}
