import { Component, Input, OnInit } from '@angular/core';
import { ModalController, ToastController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { Configurations, FinancialRequestType, GuestInvitation } from '@models/configurations.model';
import { AppService } from '@app/app.service';

@Component({
  selector: 'app-guest-invite-modal',
  templateUrl: './guestInviteModal.component.html',
  styleUrls: ['./guestInviteModal.component.scss']
})
export class GuestInviteModalComponent implements OnInit {
  @Input() configurations!: Configurations;
  @Input() existingInvite?: GuestInvitation;
  @Input() isEditMode = false;

  public guestName = '';
  public guestEmail = '';
  public purpose = '';
  public position = '';
  public defaultSourceOfFunding = '';
  public maxAmount?: number;
  public expirationOption: '7' | '14' | '30' | 'custom' = '14';
  public customExpirationDate = '';
  public isMultiUse = false;
  public customizeInstructions = false;
  public customInstructionsEn = '';
  public customInstructionsPl = '';

  public allowedTypesMap: Record<FinancialRequestType, boolean> = {
    INVOICE_REIMBURSEMENT: true,
    DELEGATION_SETTLEMENT: true,
    INVOICE_TO_PAY: false,
    ADVANCE_PAYMENT: false
  };

  public readonly availableRequestTypes: FinancialRequestType[] = [
    'INVOICE_REIMBURSEMENT',
    'DELEGATION_SETTLEMENT',
    'INVOICE_TO_PAY',
    'ADVANCE_PAYMENT'
  ];

  public createdInvitation?: GuestInvitation;
  public generatedLink = '';
  public isCreatedStep = false;

  constructor(
    private modalCtrl: ModalController,
    private toastCtrl: ToastController,
    private translate: TranslateService,
    public app: AppService
  ) {}

  ngOnInit(): void {
    if (this.isEditMode && this.existingInvite) {
      this.guestName = this.existingInvite.guestName || '';
      this.guestEmail = this.existingInvite.guestEmail || '';
      this.purpose = this.existingInvite.purpose || '';
      this.position = this.existingInvite.position || '';
      this.defaultSourceOfFunding = this.existingInvite.defaultSourceOfFunding || '';
      this.maxAmount = this.existingInvite.maxAmount;
      this.isMultiUse = Boolean(this.existingInvite.isMultiUse);

      const allowed = this.existingInvite.allowedRequestTypes || [];
      for (const t of this.availableRequestTypes) {
        this.allowedTypesMap[t] = allowed.includes(t);
      }

      if (this.existingInvite.instructions) {
        this.customizeInstructions = true;
        this.customInstructionsEn = this.existingInvite.instructions.en || '';
        this.customInstructionsPl = this.existingInvite.instructions.pl || '';
      } else {
        this.customInstructionsEn = this.configurations?.guestAccessInstructions?.en || '';
        this.customInstructionsPl = this.configurations?.guestAccessInstructions?.pl || '';
      }

      this.expirationOption = 'custom';
      this.customExpirationDate = this.existingInvite.expiresAt ? this.existingInvite.expiresAt.substring(0, 10) : '';
      return;
    }

    if (this.existingInvite) {
      this.createdInvitation = this.existingInvite;
      this.generatedLink = this.buildGuestLink(this.existingInvite.id);
      this.isCreatedStep = true;
      return;
    }

    const defaultDays = this.configurations?.guestAccessDefaultExpirationDays || 14;
    if (defaultDays === 7 || defaultDays === 14 || defaultDays === 30) {
      this.expirationOption = String(defaultDays) as any;
    } else {
      this.expirationOption = 'custom';
      const target = new Date();
      target.setDate(target.getDate() + defaultDays);
      this.customExpirationDate = target.toISOString().substring(0, 10);
    }

    const allowed = this.configurations?.guestAccessAllowedRequestTypes || [
      'INVOICE_REIMBURSEMENT',
      'DELEGATION_SETTLEMENT'
    ];
    for (const t of this.availableRequestTypes) {
      this.allowedTypesMap[t] = allowed.includes(t);
    }

    this.customInstructionsEn = this.configurations?.guestAccessInstructions?.en || '';
    this.customInstructionsPl = this.configurations?.guestAccessInstructions?.pl || '';
  }

  public get isValid(): boolean {
    if (!this.guestName?.trim()) return false;
    if (!this.guestEmail?.trim() || !this.guestEmail.includes('@')) return false;
    if (this.configurations?.guestAccessRequirePurpose && !this.purpose?.trim()) return false;
    const hasAnyType = Object.values(this.allowedTypesMap).some(v => v);
    if (!hasAnyType) return false;
    if (this.expirationOption === 'custom' && !this.customExpirationDate) return false;
    return true;
  }

  public generate(): void {
    if (!this.isValid) return;

    let expiresAt: string;
    if (this.expirationOption === 'custom') {
      const expDate = new Date(this.customExpirationDate);
      expDate.setHours(23, 59, 59, 999);
      expiresAt = expDate.toISOString();
    } else {
      const days = Number(this.expirationOption);
      const d = new Date();
      d.setDate(d.getDate() + days);
      d.setHours(23, 59, 59, 999);
      expiresAt = d.toISOString();
    }

    const selectedTypes = this.availableRequestTypes.filter(t => this.allowedTypesMap[t]);

    const instructions =
      this.customizeInstructions && (this.customInstructionsEn.trim() || this.customInstructionsPl.trim())
        ? {
            en: this.customInstructionsEn.trim(),
            pl: this.customInstructionsPl.trim()
          }
        : undefined;

    if (this.isEditMode && this.existingInvite) {
      const updatedInvite: GuestInvitation = {
        ...this.existingInvite,
        guestName: this.guestName.trim(),
        guestEmail: this.guestEmail.trim().toLowerCase(),
        purpose: this.purpose.trim(),
        position: this.position.trim() || undefined,
        allowedRequestTypes: selectedTypes,
        defaultSourceOfFunding: this.defaultSourceOfFunding.trim() || undefined,
        maxAmount: this.maxAmount && Number(this.maxAmount) > 0 ? Number(this.maxAmount) : undefined,
        instructions,
        expiresAt,
        isMultiUse: this.isMultiUse
      };
      this.modalCtrl.dismiss({ invitation: updatedInvite, isEdit: true });
      return;
    }

    const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : 'g_' + Math.random().toString(36).substring(2, 12) + Date.now().toString(36);

    const currentUser = this.app.currentUser;
    const createdBy = currentUser?.getDisplayName() || currentUser?.userId || 'admin';

    const newInvite: GuestInvitation = {
      id,
      guestName: this.guestName.trim(),
      guestEmail: this.guestEmail.trim().toLowerCase(),
      purpose: this.purpose.trim(),
      position: this.position.trim() || undefined,
      allowedRequestTypes: selectedTypes,
      defaultSourceOfFunding: this.defaultSourceOfFunding.trim() || undefined,
      maxAmount: this.maxAmount && Number(this.maxAmount) > 0 ? Number(this.maxAmount) : undefined,
      instructions,
      createdAt: new Date().toISOString(),
      expiresAt,
      createdBy,
      status: 'ACTIVE',
      isMultiUse: this.isMultiUse
    };

    this.createdInvitation = newInvite;
    this.generatedLink = this.buildGuestLink(id);
    this.isCreatedStep = true;
  }

  public buildGuestLink(tokenId: string): string {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://finances.esn-poland.link';
    return `${origin}/auth?guestToken=${encodeURIComponent(tokenId)}`;
  }

  public async copyLink(): Promise<void> {
    if (!this.generatedLink) return;
    try {
      await navigator.clipboard.writeText(this.generatedLink);
      const toast = await this.toastCtrl.create({
        message: this.translate.instant('CONFIGURATIONS.LINK_COPIED'),
        duration: 2500,
        color: 'success',
        position: 'bottom'
      });
      await toast.present();
    } catch {
      // Fallback
    }
  }

  public async copyEmailTemplate(): Promise<void> {
    if (!this.createdInvitation) return;
    const d = new Date(this.createdInvitation.expiresAt);
    const expiresFormatted = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
    let template = this.translate.instant('CONFIGURATIONS.GUEST_INVITE_EMAIL_BODY', {
      name: this.createdInvitation.guestName,
      purpose: this.createdInvitation.purpose,
      link: this.generatedLink,
      expiresAt: expiresFormatted
    });

    try {
      await navigator.clipboard.writeText(template);
      const toast = await this.toastCtrl.create({
        message: this.translate.instant('CONFIGURATIONS.EMAIL_TEMPLATE_COPIED'),
        duration: 2500,
        color: 'success',
        position: 'bottom'
      });
      await toast.present();
    } catch {
      // Fallback
    }
  }

  public dismiss(): void {
    this.modalCtrl.dismiss({ invitation: this.createdInvitation });
  }

  public close(): void {
    this.modalCtrl.dismiss();
  }
}
