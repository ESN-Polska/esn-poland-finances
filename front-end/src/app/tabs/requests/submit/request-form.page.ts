import { Component, OnInit, ViewChild, AfterViewInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { NgForm } from '@angular/forms';
import { Subscription } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { ToastController, LoadingController, AlertController, ViewWillEnter } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import {
  AttachmentFile,
  Currency,
  FinancialRequest,
  FinancialRequestType,
  InvoiceDocumentItem
} from '@models/financial-request.model';
import { UserDefaultBankDetails } from '@models/user.model';
import { AppService } from '../../../app.service';
import { RequestsService } from '../../../services/requests.service';
import { MediaService } from '../../../common/media.service';
import { parseLocaleNumber } from '../../../utils/number-utils';
import {
  formatDomesticAccount,
  formatInternationalIban,
  formatIban,
  formatSwift,
  isValidDomesticAccount,
  isValidInternationalIban,
  isValidSwift
} from '../../../utils/bank-utils';

@Component({
  selector: 'app-request-form',
  templateUrl: './request-form.page.html',
  styleUrls: ['./request-form.page.scss']
})
export class RequestFormPage implements OnInit, AfterViewInit, OnDestroy, ViewWillEnter {
  @ViewChild('requestForm') requestForm?: NgForm;
  private formSub?: Subscription;
  private readonly DRAFT_KEY = 'esn_finances_request_draft';

  public editId: string | null = null;
  public isEditMode = false;
  public isChangesRequested = false;
  public isSubmitting = false;
  public totalNetAmount = 0;
  public bankAccountType: 'DOMESTIC' | 'INTERNATIONAL' = 'DOMESTIC';
  public eurBankAccountType: 'DOMESTIC' | 'INTERNATIONAL' = 'DOMESTIC';
  public hasAttemptedSubmit: boolean = false;
  public readonly MAX_FILE_SIZE_MB = 20;
  private readonly MAX_FILE_SIZE = this.MAX_FILE_SIZE_MB * 1024 * 1024;

  public isMixedCurrency = false;
  private lastResolvedCurrency: Currency = 'PLN';
  private lastWasMixedCurrency = false;
  public totalGrossPLN = 0;
  public totalVatPLN = 0;
  public totalNetPLN = 0;
  public totalGrossEUR = 0;
  public totalVatEUR = 0;
  public totalNetEUR = 0;
  public availableCurrencies = [
    'AUD', 'BRL', 'CAD', 'CHF', 'CLP', 'CNY', 'CZK', 'DKK', 'GBP', 'HKD',
    'HUF', 'IDR', 'ILS', 'INR', 'ISK', 'JPY', 'KRW', 'MXN', 'MYR', 'NOK',
    'NZD', 'PHP', 'RON', 'SEK', 'SGD', 'THB', 'TRY', 'UAH', 'USD', 'XDR', 'ZAR'
  ];

  public request: Partial<FinancialRequest> = {
    position: '',
    sourceOfFunding: '',
    requestType: 'INVOICE_REIMBURSEMENT',
    currency: 'PLN',
    totalGrossAmount: undefined,
    totalVatAmount: undefined,
    documents: [],
    accountHolderName: '',
    accountHolderAddress: '',
    iban: '',
    swiftBic: '',
    additionalRemarks: '',
    ticketAttachments: []
  };

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private toastCtrl: ToastController,
    private loadingCtrl: LoadingController,
    private alertCtrl: AlertController,
    private translate: TranslateService,
    public appService: AppService,
    private requestsService: RequestsService,
    private mediaService: MediaService,
    private cdr: ChangeDetectorRef
  ) {}

  public get allowedRequestTypes(): FinancialRequestType[] {
    const user = this.appService.currentUser;
    if (user?.isGuest) {
      if (user.guestAllowedRequestTypes && user.guestAllowedRequestTypes.length > 0) {
        return user.guestAllowedRequestTypes as FinancialRequestType[];
      }
      return ['INVOICE_REIMBURSEMENT', 'DELEGATION_SETTLEMENT'];
    }
    return ['INVOICE_REIMBURSEMENT', 'INVOICE_TO_PAY', 'ADVANCE_PAYMENT', 'DELEGATION_SETTLEMENT'];
  }

  public isTypeAllowed(type: FinancialRequestType): boolean {
    return this.allowedRequestTypes.includes(type);
  }

  public get isPositionLocked(): boolean {
    const user = this.appService.currentUser;
    return !!(user?.isGuest && user?.guestPosition?.trim());
  }

  public get isSourceOfFundingLocked(): boolean {
    const user = this.appService.currentUser;
    return !!(user?.isGuest && user?.guestDefaultSourceOfFunding?.trim());
  }

  public async ngOnInit(): Promise<void> {
    this.loadCurrencies();
    const year = this.route.snapshot.paramMap.get('year');
    const id = this.route.snapshot.paramMap.get('id');
    let editId: string | null = null;

    if (year && id) {
      if (/^\d{4}$/.test(id) && !/^\d{4}$/.test(year)) {
        editId = `${year}/${id}`;
      } else {
        editId = `${id}/${year}`;
      }
    } else if (id) {
      editId = decodeURIComponent(id);
    }

    if (editId) {
      this.editId = editId;
      this.isEditMode = true;
      await this.loadExistingRequest(editId);
    } else {
      this.isEditMode = false;
      await this.initNewRequest();
    }
  }

  public async ionViewWillEnter(): Promise<void> {
    if (!this.isEditMode) {
      await this.syncProfileBankDetailsIfNeeded();
    }
  }

  public ngAfterViewInit(): void {
    setTimeout(() => {
      if (this.requestForm) {
        this.formSub = this.requestForm.valueChanges?.pipe(debounceTime(1000)).subscribe(() => {
          this.saveDraftLocally();
        });
      }
    }, 0);
  }

  public ngOnDestroy(): void {
    if (this.formSub) {
      this.formSub.unsubscribe();
    }
  }

  public saveDraftLocally(): void {
    if (this.isEditMode || this.hasAttemptedSubmit) return;

    const user = this.appService.currentUser;
    if (user) {
      const activeSection = user.section || user.sectionCode;
      if (activeSection) {
        this.request.section = activeSection;
        this.updateCountryFromSection();
      }
    }

    const draft = {
      ...this.request,
      ticketAttachments: [] // Do not serialize files
    };

    if (draft.documents) {
      draft.documents = draft.documents.map(doc => {
        const { attachment, ...rest } = doc;
        return rest as any; // Do not serialize files
      });
    }

    localStorage.setItem(this.DRAFT_KEY, JSON.stringify(draft));
  }

  private async loadExistingRequest(requestId: string): Promise<void> {
    this.editId = requestId;
    const existing = await this.requestsService.getRequestById(requestId);
    if (!existing) {
      await this.showToast('REQUESTS.NOT_FOUND', 'danger');
      this.router.navigate(['/t/requests']);
      return;
    }

    // Strict Permission check: Only DRAFT and CHANGES_REQUESTED can be edited by the owner!
    const currentUser = this.appService.currentUser;
    if (!currentUser || !existing.isEditableBy(currentUser)) {
      await this.showToast('REQUESTS.LOCKED_READONLY_NOTICE', 'warning');
      const [seq, year] = requestId.split('/');
      if (year && seq) {
        this.router.navigate(['/t/requests/view', year, seq], { replaceUrl: true });
      } else {
        this.router.navigate(['/t/requests/view', encodeURIComponent(requestId)], { replaceUrl: true });
      }
      return;
    }

    this.isChangesRequested = existing.status === 'CHANGES_REQUESTED';
    this.request = {
      ...existing,
      section: existing.section || currentUser?.section || currentUser?.sectionCode || '',
      country: existing.country || currentUser?.country || '',
      documents: existing.documents ? existing.documents.map(doc => ({
        ...doc,
        currency: (doc.originalCurrency ? doc.originalCurrency : doc.currency) as any
      })) : [],
      ticketAttachments: existing.ticketAttachments ? [...existing.ticketAttachments] : []
    };

    if (!this.request.country) {
      this.updateCountryFromSection();
    }

    if (
      (this.request.requestType === 'INVOICE_TO_PAY' ||
        this.request.requestType === 'INVOICE_REIMBURSEMENT') &&
      (!this.request.documents || this.request.documents.length === 0)
    ) {
      this.addDocumentItem();
    }

    this.bankAccountType =
      existing.swiftBic || (existing.iban && /^[A-Za-z]{2}/.test(existing.iban.trim()) && !existing.iban.trim().toUpperCase().startsWith('PL'))
        ? 'INTERNATIONAL'
        : 'DOMESTIC';

    this.eurBankAccountType =
      existing.swiftBicEUR || (existing.ibanEUR && /^[A-Za-z]{2}/.test(existing.ibanEUR.trim()) && !existing.ibanEUR.trim().toUpperCase().startsWith('PL'))
        ? 'INTERNATIONAL'
        : 'DOMESTIC';

    if (this.request.iban) {
      this.request.iban = this.formatIban(this.request.iban, this.bankAccountType);
    }
    if (this.request.ibanEUR) {
      this.request.ibanEUR = this.formatIban(this.request.ibanEUR, this.eurBankAccountType);
    }

    if (this.request.requestType === 'ADVANCE_PAYMENT') {
      if (this.request.requestedAmountPLN === undefined || this.request.requestedAmountPLN === null) {
        this.request.requestedAmountPLN = this.request.totalGrossAmount;
      }
    } else if (this.request.requestType === 'DELEGATION_SETTLEMENT') {
      if (this.request.delegationTotalAmount === undefined || this.request.delegationTotalAmount === null) {
        this.request.delegationTotalAmount = this.request.totalGrossAmount;
      }
    }

    this.recalculateTotals();
  }

  public applyProfileBankDefaults(defaultBank: UserDefaultBankDetails | null, overrideExisting = false): void {
    if (!defaultBank) return;
    const user = this.appService.currentUser;
    const plnBank = defaultBank.pln;
    const eurBank = defaultBank.eur;
    const isEur = this.request.currency === 'EUR' && !this.isMixedCurrency;
    const primaryBank = isEur ? (eurBank || plnBank) : plnBank;

    if (primaryBank) {
      if (overrideExisting || !this.request.accountHolderName?.trim()) {
        this.request.accountHolderName = primaryBank.accountHolderName || user?.getDisplayName() || '';
      }
      if (overrideExisting || !this.request.accountHolderAddress?.trim()) {
        this.request.accountHolderAddress = primaryBank.accountHolderAddress || '';
      }
      if (overrideExisting || !this.request.iban?.trim()) {
        this.bankAccountType =
          primaryBank.accountType ||
          (primaryBank.swiftBic || (primaryBank.iban && /^[A-Za-z]{2}/.test(primaryBank.iban.trim()) && !primaryBank.iban.trim().toUpperCase().startsWith('PL'))
            ? 'INTERNATIONAL'
            : 'DOMESTIC');
        this.request.iban = this.formatIban(primaryBank.iban || '', this.bankAccountType);
      } else if (this.request.iban) {
        this.request.iban = this.formatIban(this.request.iban, this.bankAccountType);
      }
      if (overrideExisting || !this.request.swiftBic?.trim()) {
        this.request.swiftBic = primaryBank.swiftBic || '';
      }
    } else if (overrideExisting || !this.request.accountHolderName?.trim()) {
      this.request.accountHolderName = user?.getDisplayName() || '';
    }

    if (eurBank) {
      if (overrideExisting || !this.request.accountHolderNameEUR?.trim()) {
        this.request.accountHolderNameEUR = eurBank.accountHolderName || plnBank?.accountHolderName || user?.getDisplayName() || '';
      }
      if (overrideExisting || !this.request.accountHolderAddressEUR?.trim()) {
        this.request.accountHolderAddressEUR = eurBank.accountHolderAddress || plnBank?.accountHolderAddress || '';
      }
      if (overrideExisting || !this.request.ibanEUR?.trim()) {
        this.eurBankAccountType =
          eurBank.accountType ||
          (eurBank.swiftBic || (eurBank.iban && /^[A-Za-z]{2}/.test(eurBank.iban.trim()) && !eurBank.iban.trim().toUpperCase().startsWith('PL'))
            ? 'INTERNATIONAL'
            : 'DOMESTIC');
        this.request.ibanEUR = this.formatIban(eurBank.iban || '', this.eurBankAccountType);
      } else if (this.request.ibanEUR) {
        this.request.ibanEUR = this.formatIban(this.request.ibanEUR, this.eurBankAccountType);
      }
      if (overrideExisting || !this.request.swiftBicEUR?.trim()) {
        this.request.swiftBicEUR = eurBank.swiftBic || '';
      }
    }
  }

  private async syncProfileBankDetailsIfNeeded(): Promise<void> {
    const defaultBank = await this.appService.getDefaultBankDetails();
    if (!defaultBank) return;

    const hasNoIban = !this.request.iban?.trim();
    const hasNoAddress = !this.request.accountHolderAddress?.trim();
    if (hasNoIban || hasNoAddress) {
      this.applyProfileBankDefaults(defaultBank, false);
      this.cdr.markForCheck();
    }
  }

  public async loadBankDetailsFromProfile(force = true): Promise<void> {
    const defaultBank = await this.appService.getDefaultBankDetails();
    if (!defaultBank || (!defaultBank.pln && !defaultBank.eur)) {
      await this.showToast('REQUESTS.NO_PROFILE_BANK_SAVED', 'warning');
      return;
    }

    this.applyProfileBankDefaults(defaultBank, force);
    this.requestForm?.form.markAsDirty();
    this.requestForm?.form.updateValueAndValidity();
    this.cdr.markForCheck();
    await this.showToast('REQUESTS.PROFILE_BANK_LOADED', 'success');
  }

  private async syncBankDetailsOnCurrencyChange(newCurrency: Currency, isMixed: boolean): Promise<void> {
    const defaultBank = await this.appService.getDefaultBankDetails();
    if (!defaultBank) return;

    const plnIban = (defaultBank.pln?.iban || '').replace(/\s+/g, '').toUpperCase();
    const eurIban = (defaultBank.eur?.iban || '').replace(/\s+/g, '').toUpperCase();
    const currentIban = (this.request.iban || '').replace(/\s+/g, '').toUpperCase();

    if (!isMixed) {
      if (newCurrency === 'EUR') {
        if (defaultBank.eur?.iban && (!currentIban || currentIban === plnIban)) {
          this.bankAccountType = defaultBank.eur.accountType || (defaultBank.eur.swiftBic ? 'INTERNATIONAL' : 'DOMESTIC');
          this.request.iban = this.formatIban(defaultBank.eur.iban, this.bankAccountType);
          this.request.swiftBic = defaultBank.eur.swiftBic || '';
          if (defaultBank.eur.accountHolderName) {
            this.request.accountHolderName = defaultBank.eur.accountHolderName;
          }
          if (defaultBank.eur.accountHolderAddress) {
            this.request.accountHolderAddress = defaultBank.eur.accountHolderAddress;
          }
        }
      } else if (newCurrency === 'PLN') {
        if (defaultBank.pln?.iban && (!currentIban || currentIban === eurIban)) {
          this.bankAccountType = defaultBank.pln.accountType || (defaultBank.pln.swiftBic ? 'INTERNATIONAL' : 'DOMESTIC');
          this.request.iban = this.formatIban(defaultBank.pln.iban, this.bankAccountType);
          this.request.swiftBic = defaultBank.pln.swiftBic || '';
          if (defaultBank.pln.accountHolderName) {
            this.request.accountHolderName = defaultBank.pln.accountHolderName;
          }
          if (defaultBank.pln.accountHolderAddress) {
            this.request.accountHolderAddress = defaultBank.pln.accountHolderAddress;
          }
        }
      }
    } else {
      if (defaultBank.pln?.iban && (!currentIban || currentIban === eurIban)) {
        this.bankAccountType = defaultBank.pln.accountType || (defaultBank.pln.swiftBic ? 'INTERNATIONAL' : 'DOMESTIC');
        this.request.iban = this.formatIban(defaultBank.pln.iban, this.bankAccountType);
        this.request.swiftBic = defaultBank.pln.swiftBic || '';
      }
      if (defaultBank.eur?.iban && !this.request.ibanEUR?.trim()) {
        this.eurBankAccountType = defaultBank.eur.accountType || (defaultBank.eur.swiftBic ? 'INTERNATIONAL' : 'DOMESTIC');
        this.request.ibanEUR = this.formatIban(defaultBank.eur.iban, this.eurBankAccountType);
        this.request.swiftBicEUR = defaultBank.eur.swiftBic || '';
        this.request.accountHolderNameEUR = defaultBank.eur.accountHolderName || defaultBank.pln?.accountHolderName || this.appService.currentUser?.getDisplayName() || '';
        this.request.accountHolderAddressEUR = defaultBank.eur.accountHolderAddress || defaultBank.pln?.accountHolderAddress || '';
      }
    }
    this.cdr.markForCheck();
  }

  private async initNewRequest(): Promise<void> {
    const user = this.appService.currentUser;
    const defaultBank = await this.appService.getDefaultBankDetails();

    const allowed = this.allowedRequestTypes;
    const defaultType: FinancialRequestType = allowed.includes('INVOICE_REIMBURSEMENT')
      ? 'INVOICE_REIMBURSEMENT'
      : (allowed[0] || 'INVOICE_REIMBURSEMENT');

    let initialSection = user?.section || user?.sectionCode || '';
    if (user?.availableSections?.length) {
      const match = user.availableSections.find(
        s => (s.name && s.name === initialSection) || (s.code && s.code === initialSection)
      );
      if (match) {
        initialSection = match.name || match.code;
      }
    }

    const savedDraft = localStorage.getItem(this.DRAFT_KEY);
    if (savedDraft) {
      try {
        const parsed = JSON.parse(savedDraft);
        if (parsed && Object.keys(parsed).length > 0) {
          this.request = parsed;
          this.request.section = initialSection;
          this.request.country = user?.country || '';
          this.updateCountryFromSection();
          this.request.ticketAttachments = [];
          if (this.request.documents) {
             this.request.documents.forEach(d => delete d.attachment);
          }
          if (this.request.requestType === 'INVOICE_REIMBURSEMENT' && this.request.documents) {
            const today = new Date().toISOString().split('T')[0];
            this.request.documents.forEach(d => {
              if (!d.paidOn) d.paidOn = today;
              if (!d.saleDate) d.saleDate = today;
            });
          }
          this.recalculateTotals();

          // Intelligently backfill empty bank fields from defaultBank without overriding existing draft values
          this.applyProfileBankDefaults(defaultBank, false);

          this.bankAccountType =
            this.request.swiftBic || (this.request.iban && /^[A-Za-z]{2}/.test(this.request.iban.trim()) && !this.request.iban.trim().toUpperCase().startsWith('PL'))
              ? 'INTERNATIONAL'
              : 'DOMESTIC';
          this.eurBankAccountType =
            this.request.swiftBicEUR || (this.request.ibanEUR && /^[A-Za-z]{2}/.test(this.request.ibanEUR.trim()) && !this.request.ibanEUR.trim().toUpperCase().startsWith('PL'))
              ? 'INTERNATIONAL'
              : 'DOMESTIC';
          if (this.request.iban) {
            this.request.iban = this.formatIban(this.request.iban, this.bankAccountType);
          }
          if (this.request.ibanEUR) {
            this.request.ibanEUR = this.formatIban(this.request.ibanEUR, this.eurBankAccountType);
          }
          return;
        }
      } catch (e) {
        console.error('Failed to parse draft', e);
      }
    }

    this.request = {
      section: initialSection,
      country: user?.country || '',
      position: user?.isGuest ? (user.guestPosition || '') : '',
      sourceOfFunding: user?.isGuest ? (user.guestDefaultSourceOfFunding || '') : '',
      requestType: defaultType,
      currency: 'PLN',
      totalGrossAmount: undefined,
      totalVatAmount: undefined,
      documents: [],
      accountHolderName: '',
      accountHolderAddress: '',
      iban: '',
      swiftBic: '',
      accountHolderNameEUR: '',
      accountHolderAddressEUR: '',
      ibanEUR: '',
      swiftBicEUR: '',
      additionalRemarks: '',
      ticketAttachments: []
    };

    this.applyProfileBankDefaults(defaultBank, true);
    this.updateCountryFromSection();

    if (this.request.requestType === 'INVOICE_TO_PAY' || this.request.requestType === 'INVOICE_REIMBURSEMENT') {
      this.addDocumentItem();
    }
  }

  private updateCountryFromSection(): void {
    const user = this.appService.currentUser;
    if (!user || !this.request) return;

    const sections = user.availableSections || [];
    const currentSection = this.request.section;
    const matchedSection = sections.find(
      s => s.name === currentSection || s.code === currentSection
    );

    const sectionCode = matchedSection?.code || user.sectionCode;
    if (!sectionCode) return;

    const prefix = sectionCode.split('-')[0]?.toUpperCase().trim();
    if (!prefix || prefix.length < 2) return;

    const countries = user.availableCountries || [];
    const matchedCountry = countries.find(c => {
      const code = (c.code || '').toUpperCase().trim();
      const name = (c.name || '').toUpperCase().trim();
      return (
        code === prefix ||
        code === `ESN ${prefix}` ||
        code.startsWith(prefix) ||
        name === prefix ||
        name === `ESN ${prefix}` ||
        name.startsWith(`ESN ${prefix} `) ||
        name.endsWith(` (${prefix})`)
      );
    });

    if (matchedCountry) {
      this.request.country = matchedCountry.name || matchedCountry.code;
    } else if (user.country) {
      const uCountry = user.country.toUpperCase().trim();
      if (
        uCountry === prefix ||
        uCountry === `ESN ${prefix}` ||
        uCountry.startsWith(prefix) ||
        uCountry.startsWith(`ESN ${prefix} `) ||
        uCountry.endsWith(` (${prefix})`)
      ) {
        this.request.country = user.country;
      }
    }
  }

  public get requestDisplayId(): string {
    if (this.request.status === 'DRAFT' || !this.request.sequenceNumber) {
      const y = this.request.year || new Date(this.request.createdAt || Date.now()).getFullYear();
      return `—/${y}`;
    }
    return this.request.requestId || '';
  }

  public get isDraft(): boolean {
    return this.request.status === 'DRAFT';
  }

  public selectType(type: FinancialRequestType): void {
    const previousType = this.request.requestType;
    this.request.requestType = type;

    if (type === 'DELEGATION_SETTLEMENT') {
      this.request.currency = 'PLN';
    } else if (
      (type === 'INVOICE_TO_PAY' || type === 'INVOICE_REIMBURSEMENT')
    ) {
      if (!this.request.documents || this.request.documents.length === 0) {
        this.addDocumentItem();
      } else {
        if (type === 'INVOICE_REIMBURSEMENT') {
          const today = new Date().toISOString().split('T')[0];
          this.request.documents.forEach(d => {
            if (!d.paidOn) d.paidOn = today;
            if (!d.saleDate) d.saleDate = today;
          });
        }
        if (previousType === 'ADVANCE_PAYMENT' && this.request.currency) {
          this.request.documents.forEach(d => {
            d.currency = this.request.currency;
            if (this.request.currency === 'PLN' || this.request.currency === 'EUR') {
              d.originalCurrency = undefined;
              d.originalAmount = undefined;
              d.originalVatAmount = undefined;
              d.exchangeRate = undefined;
              d.exchangeDate = undefined;
            }
          });
        }
      }
    }
    this.recalculateTotals();
  }

  /* Multi-document operations */
  public addDocumentItem(): void {
    if (!this.request.documents) this.request.documents = [];

    if (this.request.documents.length >= this.maxDocuments) {
      this.showToast('REQUESTS.MAX_DOCUMENTS_REACHED', 'warning', { max: this.maxDocuments });
      return;
    }

    const lastDoc = this.request.documents[this.request.documents.length - 1];
    const defaultCurrency = lastDoc?.currency || this.request.currency || 'PLN';
    const today = new Date().toISOString().split('T')[0];
    const isReimbursement = this.request.requestType === 'INVOICE_REIMBURSEMENT';

    const newItem: InvoiceDocumentItem = {
      id: 'doc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      invoiceNumber: '',
      ksefNumber: '',
      issuedBy: '',
      issuedOn: today,
      paymentDeadline: '',
      paidOn: isReimbursement ? today : '',
      saleDate: isReimbursement ? today : '',
      bankAccountDetails: '',
      currency: defaultCurrency,
      grossAmount: undefined as any,
      vatAmount: undefined as any,
      explanation: ''
    };

    if (isReimbursement && defaultCurrency !== 'PLN' && defaultCurrency !== 'EUR') {
      newItem.originalCurrency = defaultCurrency;
      this.onForeignCurrencyAmountOrDateChange(newItem);
    }

    this.request.documents.push(newItem);
    this.recalculateTotals();
  }

  public removeDocumentItem(index: number): void {
    if (this.request.documents && this.request.documents.length > 1) {
      this.request.documents.splice(index, 1);
      this.recalculateTotals();
    }
  }

  public onAmountWheel(event: Event): void {
    (event.target as HTMLElement)?.blur();
  }

  public recalculateTotals(): void {
    if (
      this.request.requestType === 'INVOICE_TO_PAY' ||
      this.request.requestType === 'INVOICE_REIMBURSEMENT'
    ) {
      if (this.request.documents && this.request.documents.length > 0) {
        const plnDocs = this.request.documents.filter((d) => (d.currency || 'PLN').toUpperCase() === 'PLN' || ((d.currency || 'PLN').toUpperCase() !== 'EUR' && d.exchangeRate));
        const eurDocs = this.request.documents.filter((d) => (d.currency || '').toUpperCase() === 'EUR');

        const plnTotals = this.requestsService.calculateTotals(plnDocs);
        const eurTotals = this.requestsService.calculateTotals(eurDocs);

        this.totalGrossPLN = plnTotals.totalGrossAmount;
        this.totalVatPLN = plnTotals.totalVatAmount;
        this.totalNetPLN = Math.max(0, Math.round((this.totalGrossPLN - this.totalVatPLN) * 100) / 100);

        this.totalGrossEUR = eurTotals.totalGrossAmount;
        this.totalVatEUR = eurTotals.totalVatAmount;
        this.totalNetEUR = Math.max(0, Math.round((this.totalGrossEUR - this.totalVatEUR) * 100) / 100);

        if (plnDocs.length > 0 && eurDocs.length > 0) {
          this.isMixedCurrency = true;
          this.request.currency = 'PLN';
          this.request.totalGrossAmount = Math.round((this.totalGrossPLN + this.totalGrossEUR) * 100) / 100;
          this.request.totalVatAmount = Math.round((this.totalVatPLN + this.totalVatEUR) * 100) / 100;
          this.totalNetAmount = Math.max(0, Math.round((this.request.totalGrossAmount - this.request.totalVatAmount) * 100) / 100);
        } else if (eurDocs.length > 0) {
          this.isMixedCurrency = false;
          this.request.currency = 'EUR';
          this.request.totalGrossAmount = this.totalGrossEUR;
          this.request.totalVatAmount = this.totalVatEUR;
          this.totalNetAmount = this.totalNetEUR;
        } else {
          this.isMixedCurrency = false;
          this.request.currency = 'PLN';
          this.request.totalGrossAmount = this.totalGrossPLN;
          this.request.totalVatAmount = this.totalVatPLN;
          this.totalNetAmount = this.totalNetPLN;
        }
      } else {
        this.isMixedCurrency = false;
        this.totalGrossPLN = 0;
        this.totalVatPLN = 0;
        this.totalNetPLN = 0;
        this.totalGrossEUR = 0;
        this.totalVatEUR = 0;
        this.totalNetEUR = 0;
        this.request.totalGrossAmount = 0;
        this.request.totalVatAmount = 0;
        this.totalNetAmount = 0;
      }
    } else if (this.request.requestType === 'ADVANCE_PAYMENT') {
      this.isMixedCurrency = false;
      this.request.totalGrossAmount = parseLocaleNumber(this.request.requestedAmountPLN) || 0;
      this.request.totalVatAmount = 0;
      this.request.currency = this.request.currency || 'PLN';
      this.totalNetAmount = this.request.totalGrossAmount;
    } else if (this.request.requestType === 'DELEGATION_SETTLEMENT') {
      this.isMixedCurrency = false;
      this.request.currency = 'PLN';
      this.request.totalGrossAmount = parseLocaleNumber(this.request.delegationTotalAmount) || 0;
      this.request.totalVatAmount = 0;
      this.totalNetAmount = this.request.totalGrossAmount;
    } else {
      this.isMixedCurrency = false;
      const gross = parseLocaleNumber(this.request.totalGrossAmount) || 0;
      const vat = parseLocaleNumber(this.request.totalVatAmount) || 0;
      this.totalNetAmount = Math.max(0, Math.round((gross - vat) * 100) / 100);
    }

    const currentCurrency = (this.request.currency || 'PLN') as Currency;
    const isMixed = this.isMixedCurrency;

    if (
      !this.isEditMode &&
      (currentCurrency !== this.lastResolvedCurrency || isMixed !== this.lastWasMixedCurrency)
    ) {
      this.syncBankDetailsOnCurrencyChange(currentCurrency, isMixed);
      this.lastResolvedCurrency = currentCurrency;
      this.lastWasMixedCurrency = isMixed;
    }
  }

  public getDocNet(doc: InvoiceDocumentItem): number {
    const gross = Math.max(0, parseLocaleNumber(doc.originalCurrency ? doc.originalAmount : doc.grossAmount) || 0);
    const rawVat = parseLocaleNumber(doc.originalCurrency ? doc.originalVatAmount : doc.vatAmount) || 0;
    const vat = Math.max(0, rawVat);
    return Math.min(gross, Math.max(0, Math.round((gross - vat) * 100) / 100));
  }

  public getDocNetPLN(doc: InvoiceDocumentItem): number {
    const gross = Math.max(0, parseLocaleNumber(doc.grossAmount) || 0);
    const rawVat = parseLocaleNumber(doc.vatAmount) || 0;
    const vat = Math.max(0, rawVat);
    return Math.min(gross, Math.max(0, Math.round((gross - vat) * 100) / 100));
  }

  public onCurrencyChange(doc?: InvoiceDocumentItem): void {
    if (doc) {
      if (doc.currency !== 'PLN' && doc.currency !== 'EUR') {
        if (!doc.originalCurrency && doc.grossAmount !== undefined) {
          // Switching from PLN/EUR to Foreign: transfer the typed amount
          doc.originalAmount = doc.grossAmount;
          doc.originalVatAmount = doc.vatAmount;
        }
        if (doc.originalCurrency !== doc.currency || !doc.exchangeRate) {
          doc.originalCurrency = doc.currency;
          doc.exchangeRate = undefined;
          doc.exchangeDate = undefined;
          this.onForeignCurrencyAmountOrDateChange(doc);
        }
      } else if (doc.currency === 'PLN' || doc.currency === 'EUR') {
        if (doc.originalCurrency && doc.originalAmount !== undefined) {
          // Switching from Foreign to PLN/EUR: transfer the typed amount
          doc.grossAmount = doc.originalAmount;
          doc.vatAmount = doc.originalVatAmount !== undefined ? doc.originalVatAmount : 0;
        }
        doc.originalCurrency = undefined;
        doc.originalAmount = undefined;
        doc.originalVatAmount = undefined;
        doc.exchangeRate = undefined;
        doc.exchangeDate = undefined;
      }
    } else {
      // Global/Advance Payment currency changed: sync with existing document(s)
      if (this.request.currency && this.request.documents && this.request.documents.length > 0) {
        this.request.documents.forEach(d => {
          d.currency = this.request.currency;
          if (this.request.currency === 'PLN' || this.request.currency === 'EUR') {
            d.originalCurrency = undefined;
            d.originalAmount = undefined;
            d.originalVatAmount = undefined;
            d.exchangeRate = undefined;
            d.exchangeDate = undefined;
          }
        });
      }
    }
    this.recalculateTotals();
  }

  public onForeignAmountChange(doc: InvoiceDocumentItem): void {
    if (doc.exchangeRate) {
      const originalAmount = parseLocaleNumber(doc.originalAmount) || 0;
      doc.grossAmount = Math.round((originalAmount * doc.exchangeRate) * 100) / 100;

      const originalVat = parseLocaleNumber(doc.originalVatAmount) || 0;
      doc.vatAmount = Math.round((originalVat * doc.exchangeRate) * 100) / 100;
    } else {
      this.onForeignCurrencyAmountOrDateChange(doc);
    }
    this.recalculateTotals();
  }

  public onForeignDateChange(doc: InvoiceDocumentItem): void {
    if (this.request.requestType === 'INVOICE_REIMBURSEMENT' && doc.hasDifferentSaleDate && !doc.saleDate) {
      doc.saleDate = new Date().toISOString().split('T')[0];
    }
    if (doc.originalCurrency && doc.originalCurrency !== 'PLN' && doc.originalCurrency !== 'EUR') {
      this.onForeignCurrencyAmountOrDateChange(doc);
    }
  }

  public async loadCurrencies(): Promise<void> {
    // Currencies are hardcoded in availableCurrencies array for reliability
    // They represent the standard NBP Table A currencies (excluding PLN and EUR which are handled separately)
  }

  public async onForeignCurrencyAmountOrDateChange(doc: InvoiceDocumentItem): Promise<void> {
    if (this.request.requestType !== 'INVOICE_REIMBURSEMENT') return;
    const currencyToUse = doc.originalCurrency || doc.currency;
    if (!currencyToUse || currencyToUse === 'PLN' || currencyToUse === 'EUR') return;

    doc.originalCurrency = currencyToUse;

    const baseDate = doc.hasDifferentSaleDate ? doc.saleDate : doc.issuedOn;
    if (!baseDate) return;

    let dateObj = new Date(baseDate);
    dateObj.setDate(dateObj.getDate() - 1);
    while (dateObj.getDay() === 0 || dateObj.getDay() === 6) {
      dateObj.setDate(dateObj.getDate() - 1);
    }

    let foundRate = false;
    let attempts = 0;
    while (!foundRate && attempts < 10) {
      const dateStr = dateObj.toISOString().split('T')[0];
      try {
        const response = await fetch(`https://api.nbp.pl/api/exchangerates/rates/A/${doc.originalCurrency}/${dateStr}?format=JSON`);
        if (response.ok) {
          const data = await response.json();
          if (data && data.rates && data.rates[0]) {
            doc.exchangeRate = data.rates[0].mid;
            doc.exchangeDate = dateStr;
            const originalGross = parseLocaleNumber(doc.originalAmount) || 0;
            const originalVat = parseLocaleNumber(doc.originalVatAmount) || 0;
            doc.grossAmount = Math.round((originalGross * doc.exchangeRate) * 100) / 100;
            doc.vatAmount = Math.round((originalVat * doc.exchangeRate) * 100) / 100;
            foundRate = true;
          }
        }
      } catch (err) {
        // ignore
      }
      if (!foundRate) {
        dateObj.setDate(dateObj.getDate() - 1);
        while (dateObj.getDay() === 0 || dateObj.getDay() === 6) {
          dateObj.setDate(dateObj.getDate() - 1);
        }
        attempts++;
      }
    }
    this.recalculateTotals();
  }

  public setBankAccountType(type: 'DOMESTIC' | 'INTERNATIONAL'): void {
    this.bankAccountType = type;
    if (type === 'DOMESTIC') {
      this.request.swiftBic = '';
    }
    if (this.request.iban) {
      this.request.iban = this.formatIban(this.request.iban, type);
    }
  }

  public formatDomesticAccount(value: string): string {
    return formatDomesticAccount(value);
  }

  public formatInternationalIban(value: string): string {
    return formatInternationalIban(value);
  }

  public formatSwift(value: string): string {
    return formatSwift(value);
  }

  public formatIban(value: string, forceType?: 'DOMESTIC' | 'INTERNATIONAL'): string {
    return formatIban(value, forceType || this.bankAccountType);
  }

  public setEurBankAccountType(type: 'DOMESTIC' | 'INTERNATIONAL'): void {
    this.eurBankAccountType = type;
    if (type === 'DOMESTIC') {
      this.request.swiftBicEUR = '';
    }
    if (this.request.ibanEUR) {
      this.request.ibanEUR = this.formatIban(this.request.ibanEUR, type);
    }
  }

  public onPayoutIbanInput(event: any): void {
    const raw = event.target?.value || '';
    const formatted = this.bankAccountType === 'DOMESTIC'
      ? this.formatDomesticAccount(raw)
      : this.formatInternationalIban(raw);
    this.request.iban = formatted;
  }

  public onPayoutSwiftInput(event: any): void {
    const raw = event.target?.value || '';
    this.request.swiftBic = this.formatSwift(raw);
  }

  public onEurPayoutIbanInput(event: any): void {
    const raw = event.target?.value || '';
    const formatted = this.eurBankAccountType === 'DOMESTIC'
      ? this.formatDomesticAccount(raw)
      : this.formatInternationalIban(raw);
    this.request.ibanEUR = formatted;
  }

  public onEurPayoutSwiftInput(event: any): void {
    const raw = event.target?.value || '';
    this.request.swiftBicEUR = this.formatSwift(raw);
  }

  public onSellerIbanInput(event: any, doc: InvoiceDocumentItem): void {
    const raw = (event.target?.value || '').trim();
    if (/^[A-Za-z]/.test(raw)) {
      doc.bankAccountDetails = this.formatInternationalIban(raw);
    } else {
      doc.bankAccountDetails = this.formatDomesticAccount(raw);
    }
  }

  public isValidDomesticAccount(val: string | undefined): boolean {
    return isValidDomesticAccount(val);
  }

  public isValidInternationalIban(val: string | undefined): boolean {
    return isValidInternationalIban(val);
  }

  public isValidSwift(val: string | undefined): boolean {
    return isValidSwift(val);
  }

  public get maxDocuments(): number {
    return this.appService.configurations?.requestsConfig?.maxDocumentsPerRequest || 30;
  }

  public get maxFinancialAmount(): number {
    return this.appService.configurations?.requestsConfig?.maxFinancialAmount || 10000000;
  }

  public getVatValidationMessage(doc: InvoiceDocumentItem): string {
    const rawGross = doc.originalCurrency ? doc.originalAmount : doc.grossAmount;
    const rawVat = doc.originalCurrency ? doc.originalVatAmount : doc.vatAmount;
    if (rawVat !== undefined && rawVat !== null && String(rawVat).includes('-')) {
      return 'REQUESTS.VALIDATION.VAT_NEGATIVE';
    }
    const gross = parseLocaleNumber(rawGross) ?? 0;
    const vat = parseLocaleNumber(rawVat);
    if (vat !== undefined && vat > gross) {
      return 'REQUESTS.VALIDATION.VAT_EXCEEDS_GROSS';
    }
    if (rawVat !== undefined && rawVat !== null && String(rawVat).trim() !== '' && vat === undefined) {
      return 'REQUESTS.VALIDATION.MAX_DECIMALS';
    }
    return 'REQUESTS.VALIDATION.VAT_EXCEEDS_GROSS';
  }

  public isValidSellerBank(val: string | undefined): boolean {
    return this.isValidDomesticAccount(val) || this.isValidInternationalIban(val);
  }

  public isFieldInvalid(field: string): boolean {
    if (!this.hasAttemptedSubmit) return false;
    switch (field) {
      case 'position':
        return !this.request.position?.trim();
      case 'sourceOfFunding':
        return !this.request.sourceOfFunding?.trim();
      case 'accountHolderName':
        return (
          this.request.requestType !== 'INVOICE_TO_PAY' &&
          (!this.request.accountHolderName?.trim() ||
            !/[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(this.request.accountHolderName) ||
            this.request.accountHolderName.trim().length < 2)
        );
      case 'accountHolderAddress':
        return this.request.requestType !== 'INVOICE_TO_PAY' && !this.request.accountHolderAddress?.trim();
      case 'iban':
        if (this.request.requestType === 'INVOICE_TO_PAY') return false;
        return this.bankAccountType === 'DOMESTIC'
          ? !this.isValidDomesticAccount(this.request.iban)
          : !this.isValidInternationalIban(this.request.iban);
      case 'swiftBic':
        return this.request.requestType !== 'INVOICE_TO_PAY' &&
          this.bankAccountType === 'INTERNATIONAL' &&
          !this.isValidSwift(this.request.swiftBic);
      case 'accountHolderNameEUR':
        return (
          this.request.requestType !== 'INVOICE_TO_PAY' &&
          this.isMixedCurrency &&
          (!this.request.accountHolderNameEUR?.trim() ||
            !/[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(this.request.accountHolderNameEUR) ||
            this.request.accountHolderNameEUR.trim().length < 2)
        );
      case 'accountHolderAddressEUR':
        return this.request.requestType !== 'INVOICE_TO_PAY' &&
          this.isMixedCurrency &&
          !this.request.accountHolderAddressEUR?.trim();
      case 'ibanEUR':
        if (this.request.requestType === 'INVOICE_TO_PAY' || !this.isMixedCurrency) return false;
        return this.eurBankAccountType === 'DOMESTIC'
          ? !this.isValidDomesticAccount(this.request.ibanEUR)
          : !this.isValidInternationalIban(this.request.ibanEUR);
      case 'swiftBicEUR':
        return this.request.requestType !== 'INVOICE_TO_PAY' &&
          this.isMixedCurrency &&
          this.eurBankAccountType === 'INTERNATIONAL' &&
          !this.isValidSwift(this.request.swiftBicEUR);
      case 'requestedAmountPLN': {
        if (this.request.requestType !== 'ADVANCE_PAYMENT') return false;
        const raw = this.request.requestedAmountPLN;
        if (raw === undefined || raw === null || String(raw).trim() === '') return true;
        if (String(raw).includes('-')) return true;
        const amt = parseLocaleNumber(raw);
        if (amt === undefined) return true;
        return amt < 0 || (amt > 0 && amt < 0.01) || amt > this.maxFinancialAmount;
      }
      case 'explanationAndBudget':
        return this.request.requestType === 'ADVANCE_PAYMENT' && !this.request.explanationAndBudget?.trim();
      case 'delegationFormAttachment':
        return this.request.requestType === 'DELEGATION_SETTLEMENT' && !this.request.delegationFormAttachment;
      case 'ticketAttachments':
        return this.request.requestType === 'DELEGATION_SETTLEMENT' &&
          (!this.request.ticketAttachments || this.request.ticketAttachments.length === 0);
      case 'delegationTotalAmount': {
        if (this.request.requestType !== 'DELEGATION_SETTLEMENT') return false;
        const raw = this.request.delegationTotalAmount;
        if (raw === undefined || raw === null || String(raw).trim() === '') return true;
        if (String(raw).includes('-')) return true;
        const amt = parseLocaleNumber(raw);
        if (amt === undefined) return true;
        return amt < 0 || (amt > 0 && amt < 0.01) || amt > this.maxFinancialAmount;
      }
      default:
        return false;
    }
  }

  public isDocFieldInvalid(doc: InvoiceDocumentItem, field: string): boolean {
    if (!this.hasAttemptedSubmit) return false;
    switch (field) {
      case 'invoiceNumber':
        return !doc.invoiceNumber?.trim();
      case 'issuedBy':
        return !doc.issuedBy?.trim();
      case 'issuedOn':
        return !doc.issuedOn;
      case 'saleDate':
        return this.request.requestType === 'INVOICE_REIMBURSEMENT' && !!doc.hasDifferentSaleDate && !doc.saleDate;
      case 'paymentDeadline':
        return this.request.requestType === 'INVOICE_TO_PAY' && !doc.paymentDeadline;
      case 'paidOn':
        return this.request.requestType === 'INVOICE_REIMBURSEMENT' && !doc.paidOn;
      case 'bankAccountDetails':
        return this.request.requestType === 'INVOICE_TO_PAY' && !this.isValidSellerBank(doc.bankAccountDetails);
      case 'grossAmount': {
        const raw = doc.originalCurrency ? doc.originalAmount : doc.grossAmount;
        if (raw === undefined || raw === null || String(raw).trim() === '') return true;
        if (String(raw).includes('-')) return true;
        const g = parseLocaleNumber(raw);
        if (g === undefined) return true;
        return g < 0 || (g > 0 && g < 0.01) || g > this.maxFinancialAmount;
      }
      case 'vatAmount': {
        const rawGross = doc.originalCurrency ? doc.originalAmount : doc.grossAmount;
        const rawVat = doc.originalCurrency ? doc.originalVatAmount : doc.vatAmount;
        if (rawVat === undefined || rawVat === null || String(rawVat).trim() === '') return true;
        if (String(rawVat).includes('-')) return true;
        const g = parseLocaleNumber(rawGross) ?? 0;
        const v = parseLocaleNumber(rawVat);
        if (v === undefined) return true;
        return v < 0 || (v > 0 && v < 0.01) || v > g;
      }
      case 'attachment':
        return !doc.attachment;
      default:
        return false;
    }
  }

  public onAdvanceAmountChange(): void {
    this.request.totalGrossAmount = parseLocaleNumber(this.request.requestedAmountPLN) || 0;
    this.request.totalVatAmount = 0;
    this.request.currency = this.request.currency || 'PLN';
    this.totalNetAmount = this.request.totalGrossAmount;
  }

  public onDelegationAmountChange(): void {
    this.request.totalGrossAmount = parseLocaleNumber(this.request.delegationTotalAmount) || 0;
    this.request.totalVatAmount = 0;
    this.request.currency = 'PLN';
    this.totalNetAmount = this.request.totalGrossAmount;
  }

  /* File upload handling */
  public async onFileSelected(
    event: any,
    targetDoc: InvoiceDocumentItem,
    field: 'attachment' | 'proofOfPaymentAttachment'
  ): Promise<void> {
    const file = event.target?.files?.[0];
    if (!file) return;

    if (file.size > this.MAX_FILE_SIZE) {
      this.showToast('REQUESTS.VALIDATION.FILE_TOO_LARGE', 'warning', { max: `${this.MAX_FILE_SIZE_MB}MB` });
      if (event.target) event.target.value = '';
      return;
    }

    const loading = await this.loadingCtrl.create({ message: this.translate.instant('COMMON.LOADING') || 'Uploading...' });
    await loading.present();

    try {
      const res = await this.mediaService.uploadDocument(file);
      targetDoc[field] = {
        fileId: res.id,
        fileName: file.name,
        fileSize: file.size,
        contentType: file.type,
        s3Key: res.s3Key,
        uploadedAt: new Date().toISOString()
      };
    } catch (e: any) {
      console.error(e);
      const msg = e?.error?.message || e?.message;
      this.showToast(msg || 'REQUESTS.VALIDATION.UPLOAD_FAILED', 'danger');
    } finally {
      loading.dismiss();
    }
  }

  public removeAttachment(
    targetDoc: InvoiceDocumentItem,
    field: 'attachment' | 'proofOfPaymentAttachment'
  ): void {
    targetDoc[field] = undefined;
  }

  public async onSingleFileSelected(event: any, field: 'delegationFormAttachment'): Promise<void> {
    const file = event.target?.files?.[0];
    if (!file) return;

    if (file.size > this.MAX_FILE_SIZE) {
      this.showToast('REQUESTS.VALIDATION.FILE_TOO_LARGE', 'warning', { max: `${this.MAX_FILE_SIZE_MB}MB` });
      if (event.target) event.target.value = '';
      return;
    }

    const loading = await this.loadingCtrl.create({ message: this.translate.instant('COMMON.LOADING') || 'Uploading...' });
    await loading.present();

    try {
      const res = await this.mediaService.uploadDocument(file);
      this.request[field] = {
        fileId: res.id,
        fileName: file.name,
        fileSize: file.size,
        contentType: file.type,
        s3Key: res.s3Key,
        uploadedAt: new Date().toISOString()
      };
    } catch (e: any) {
      console.error(e);
      const msg = e?.error?.message || e?.message;
      this.showToast(msg || 'REQUESTS.VALIDATION.UPLOAD_FAILED', 'danger');
    } finally {
      loading.dismiss();
    }
  }

  public async onMultipleFilesSelected(event: any, field: 'ticketAttachments'): Promise<void> {
    const files: FileList = event.target?.files;
    if (!files || files.length === 0) return;

    if (!this.request[field]) this.request[field] = [];

    const loading = await this.loadingCtrl.create({ message: this.translate.instant('COMMON.LOADING') || 'Uploading...' });
    await loading.present();

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.size > this.MAX_FILE_SIZE) {
          this.showToast('REQUESTS.VALIDATION.FILE_TOO_LARGE', 'warning', { max: `${this.MAX_FILE_SIZE_MB}MB` });
          continue;
        }

        const res = await this.mediaService.uploadDocument(file);
        this.request[field]!.push({
          fileId: res.id,
          fileName: file.name,
          fileSize: file.size,
          contentType: file.type,
          s3Key: res.s3Key,
          uploadedAt: new Date().toISOString()
        });
      }
    } catch (e: any) {
      console.error(e);
      const msg = e?.error?.message || e?.message;
      this.showToast(msg || 'REQUESTS.VALIDATION.UPLOAD_FAILED', 'danger');
    } finally {
      loading.dismiss();
    }
  }

  public removeMultipleFile(field: 'ticketAttachments', index: number): void {
    if (this.request[field]) {
      this.request[field]!.splice(index, 1);
    }
  }

  /* Save as DRAFT or SUBMITTED */
  public async save(targetStatus: 'DRAFT' | 'SUBMITTED'): Promise<void> {
    if (targetStatus === 'SUBMITTED') {
      this.hasAttemptedSubmit = true;
      const isValid = this.validateForSubmission();
      if (!isValid) {
        await this.showToast('REQUESTS.VALIDATION.FILL_ALL_REQUIRED', 'warning');
        setTimeout(() => {
          const firstInvalid = document.querySelector('.is-invalid');
          if (firstInvalid) {
            firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, 100);
        return;
      }

      const confirmed = await this.confirmSubmissionModal();
      if (!confirmed) {
        return;
      }
    }

    this.isSubmitting = true;
    try {
      this.recalculateTotals();

      if (!this.isEditMode && this.appService.currentUser) {
        const u = this.appService.currentUser;
        const activeSection = u.section || u.sectionCode;
        if (activeSection) {
          this.request.section = activeSection;
          this.request.country = u.country || this.request.country || '';
          this.updateCountryFromSection();
        }
      }

      const requestToSave: Partial<FinancialRequest> = {
        ...this.request,
        requestedAmountPLN: parseLocaleNumber(this.request.requestedAmountPLN),
        delegationTotalAmount: parseLocaleNumber(this.request.delegationTotalAmount),
        documents: this.request.documents?.map(doc => {
          const parsedGross = parseLocaleNumber(doc.grossAmount);
          const parsedVat = parseLocaleNumber(doc.vatAmount);
          const parsedOrigGross = parseLocaleNumber(doc.originalAmount);
          const parsedOrigVat = parseLocaleNumber(doc.originalVatAmount);
          const updatedDoc = {
            ...doc,
            grossAmount: parsedGross !== undefined ? parsedGross : doc.grossAmount,
            vatAmount: parsedVat !== undefined ? parsedVat : doc.vatAmount,
            originalAmount: parsedOrigGross !== undefined ? parsedOrigGross : doc.originalAmount,
            originalVatAmount: parsedOrigVat !== undefined ? parsedOrigVat : doc.originalVatAmount
          };
          if (doc.currency !== 'PLN' && doc.currency !== 'EUR' && doc.originalCurrency && doc.exchangeRate) {
            return {
              ...updatedDoc,
              currency: 'PLN' as any
            };
          }
          return updatedDoc;
        })
      };

      const effectiveStatus =
        targetStatus === 'DRAFT' && this.isChangesRequested
          ? 'CHANGES_REQUESTED'
          : targetStatus;

      const saved = await this.requestsService.saveRequest(requestToSave, effectiveStatus);

      if (!this.isEditMode) {
        localStorage.removeItem(this.DRAFT_KEY);
      }

      const msgKey =
        targetStatus === 'DRAFT'
          ? 'REQUESTS.DRAFT_SAVED_SUCCESS'
          : this.isChangesRequested
          ? 'REQUESTS.RESUBMITTED_SUCCESS'
          : 'REQUESTS.SUBMITTED_SUCCESS';

      await this.showToast(msgKey, 'success');
      this.router.navigate(['/t/requests'], { replaceUrl: true });
    } catch (err: any) {
      console.error('Failed to save request', err);
      const detail = err?.error?.message || err?.message || err;
      const prefix = this.translate.instant('REQUESTS.SAVE_FAILED');
      await this.showToast(`${prefix}: ${detail}`, 'danger');
    } finally {
      this.isSubmitting = false;
    }
  }

  private async confirmSubmissionModal(): Promise<boolean> {
    return new Promise(async (resolve) => {
      const alert = await this.alertCtrl.create({
        header: this.translate.instant('REQUESTS.CONFIRM_SUBMIT_TITLE'),
        message: this.translate.instant('REQUESTS.CONFIRM_SUBMIT_MESSAGE'),
        buttons: [
          {
            text: this.translate.instant('COMMON.CANCEL'),
            role: 'cancel',
            handler: () => resolve(false)
          },
          {
            text: this.translate.instant('REQUESTS.SUBMIT_REQUEST'),
            role: 'confirm',
            handler: () => resolve(true)
          }
        ]
      });
      await alert.present();
    });
  }

  private validateForSubmission(): boolean {
    const user = this.appService.currentUser;
    if (user?.isGuest) {
      if (!this.isTypeAllowed(this.request.requestType as FinancialRequestType)) {
        this.showToast('CONFIGURATIONS.GUEST_TYPE_NOT_ALLOWED', 'danger');
        return false;
      }
      const totalGross = parseLocaleNumber(this.request.totalGrossAmount) || 0;
      if (user.guestMaxAmount && totalGross > user.guestMaxAmount) {
        this.showToast('CONFIGURATIONS.GUEST_LIMIT_EXCEEDED', 'danger', { amount: user.guestMaxAmount });
        return false;
      }
    }

    if (!this.request.section?.trim()) {
      this.request.section = user?.section || user?.sectionCode || '';
    }

    if (!this.request.position?.trim()) return false;
    if (!this.request.sourceOfFunding?.trim()) return false;

    // Only require personal payout bank account when federation pays the applicant directly
    if (this.request.requestType !== 'INVOICE_TO_PAY') {
      if (
        !this.request.accountHolderName?.trim() ||
        !/[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(this.request.accountHolderName) ||
        this.request.accountHolderName.trim().length < 2
      ) {
        return false;
      }
      if (!this.request.accountHolderAddress?.trim()) return false;
      if (!this.request.iban?.trim()) return false;
      if (this.bankAccountType === 'DOMESTIC') {
        if (!this.isValidDomesticAccount(this.request.iban)) return false;
      } else {
        if (!this.isValidInternationalIban(this.request.iban)) return false;
        if (!this.isValidSwift(this.request.swiftBic)) return false;
      }

      if (this.isMixedCurrency) {
        if (
          !this.request.accountHolderNameEUR?.trim() ||
          !/[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(this.request.accountHolderNameEUR) ||
          this.request.accountHolderNameEUR.trim().length < 2
        ) {
          return false;
        }
        if (!this.request.accountHolderAddressEUR?.trim()) return false;
        if (!this.request.ibanEUR?.trim()) return false;
        if (this.eurBankAccountType === 'DOMESTIC') {
          if (!this.isValidDomesticAccount(this.request.ibanEUR)) return false;
        } else {
          if (!this.isValidInternationalIban(this.request.ibanEUR)) return false;
          if (!this.isValidSwift(this.request.swiftBicEUR)) return false;
        }
      }
    }

    if (
      this.request.requestType === 'INVOICE_TO_PAY' ||
      this.request.requestType === 'INVOICE_REIMBURSEMENT'
    ) {
      if (!this.request.documents || this.request.documents.length === 0) {
        return false;
      }
      if (this.request.documents.length > this.maxDocuments) {
        return false;
      }

      for (let i = 0; i < this.request.documents.length; i++) {
        const doc = this.request.documents[i];
        if (!doc.invoiceNumber?.trim()) return false;
        if (!doc.issuedBy?.trim()) return false;
        if (!doc.issuedOn) return false;

        if (this.request.requestType === 'INVOICE_TO_PAY') {
          if (!doc.paymentDeadline) return false;
          if (!doc.bankAccountDetails?.trim() || !this.isValidSellerBank(doc.bankAccountDetails)) {
            return false;
          }
        }

        if (this.request.requestType === 'INVOICE_REIMBURSEMENT') {
          if (!doc.paidOn) return false;
          if (doc.hasDifferentSaleDate && !doc.saleDate) return false;
        }

        const rawGross = doc.originalCurrency ? doc.originalAmount : doc.grossAmount;
        const rawVat = doc.originalCurrency ? doc.originalVatAmount : doc.vatAmount;

        if (rawGross === undefined || rawGross === null || String(rawGross).trim() === '') return false;
        if (rawVat === undefined || rawVat === null || String(rawVat).trim() === '') return false;
        if (String(rawGross).includes('-') || String(rawVat).includes('-')) return false;

        const gross = parseLocaleNumber(rawGross);
        if (gross === undefined || gross < 0 || (gross > 0 && gross < 0.01) || gross > this.maxFinancialAmount) {
          return false;
        }
        const vat = parseLocaleNumber(rawVat);
        if (vat === undefined || vat < 0 || (vat > 0 && vat < 0.01) || vat > gross) {
          return false;
        }
        if (!doc.attachment) return false;
      }
    } else if (this.request.requestType === 'ADVANCE_PAYMENT') {
      const rawAdv = this.request.requestedAmountPLN;
      if (rawAdv === undefined || rawAdv === null || String(rawAdv).trim() === '') return false;
      if (String(rawAdv).includes('-')) return false;
      const advAmt = parseLocaleNumber(rawAdv);
      if (advAmt === undefined || advAmt < 0 || (advAmt > 0 && advAmt < 0.01) || advAmt > this.maxFinancialAmount) {
        return false;
      }
      if (!this.request.explanationAndBudget?.trim()) {
        return false;
      }
    } else if (this.request.requestType === 'DELEGATION_SETTLEMENT') {
      const rawDel = this.request.delegationTotalAmount ?? this.request.totalGrossAmount;
      if (rawDel === undefined || rawDel === null || String(rawDel).trim() === '') return false;
      if (String(rawDel).includes('-')) return false;
      const amt = parseLocaleNumber(rawDel);
      if (amt === undefined || amt < 0 || (amt > 0 && amt < 0.01) || amt > this.maxFinancialAmount) {
        return false;
      }
      if (!this.request.delegationFormAttachment) {
        return false;
      }
      if (!this.request.ticketAttachments || this.request.ticketAttachments.length === 0) {
        return false;
      }
    }

    return true;
  }

  public get guestInstructionsText(): string {
    const userInst = this.appService.currentUser?.guestInstructions;
    const globalInst = this.appService.configurations?.guestAccessInstructions;
    const inst = (userInst && (userInst.pl || userInst.en)) ? userInst : globalInst;
    if (!inst) return '';
    return this.appService.currentLanguage === 'pl'
      ? (inst.pl || inst.en || '')
      : (inst.en || inst.pl || '');
  }

  public async resetForm(): Promise<void> {
    const confirm = await this.alertCtrl.create({
      header: this.translate.instant('COMMON.RESET'),
      message: this.translate.instant('REQUESTS.CONFIRM_RESET'),
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('COMMON.CONFIRM'),
          handler: async () => {
            this.hasAttemptedSubmit = false;
            const requestIdToReload = this.editId || this.request.requestId;
            if (this.isEditMode && requestIdToReload) {
              const loading = await this.loadingCtrl.create({
                message: this.translate.instant('COMMON.LOADING') || 'Loading...'
              });
              await loading.present();
              try {
                await this.loadExistingRequest(requestIdToReload);
                this.requestForm?.form.markAsPristine();
                this.requestForm?.form.markAsUntouched();
                this.requestForm?.form.updateValueAndValidity();
                this.cdr.markForCheck();
              } catch (err: any) {
                console.error('Failed to reset draft form', err);
                await this.showToast(err.message || 'Error reloading request', 'danger');
              } finally {
                await loading.dismiss();
              }
            } else if (!this.isEditMode) {
              localStorage.removeItem(this.DRAFT_KEY);
              await this.initNewRequest();
              this.requestForm?.form.markAsPristine();
              this.requestForm?.form.markAsUntouched();
              this.requestForm?.form.updateValueAndValidity();
              this.cdr.markForCheck();
            }
          }
        }
      ]
    });
    await confirm.present();
  }

  public goBack(): void {
    this.router.navigate(['/t/requests']);
  }

  private async showToast(messageKey: string, color: string, interpolateParams?: any): Promise<void> {
    const msg = this.translate.instant(messageKey, interpolateParams);
    const toast = await this.toastCtrl.create({
      message: msg && msg !== messageKey ? msg : messageKey,
      duration: 3500,
      position: 'bottom',
      color
    });
    await toast.present();
  }
}
