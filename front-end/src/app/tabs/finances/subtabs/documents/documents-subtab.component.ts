import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { ToastController, LoadingController, AlertController, ModalController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import { FinancesStateService } from '../../../../services/finances-state.service';
import { FinancesNavigationService } from '../../../../services/finances-navigation.service';
import { FinancesService } from '../../../../services/finances.service';
import { AppService } from '../../../../app.service';
import { DocumentRecord } from '@models/accounting-document.model';
import { AppPermission } from '@models/configurations.model';
import { DocumentEditModalComponent } from '../../modals/document-edit-modal/document-edit-modal.component';

@Component({
  selector: 'app-documents-subtab',
  templateUrl: './documents-subtab.component.html',
  styleUrls: ['./documents-subtab.component.scss']
})
export class DocumentsSubtabComponent implements OnInit, OnDestroy {
  public stateService = inject(FinancesStateService);
  public navService = inject(FinancesNavigationService);
  private financesService = inject(FinancesService);
  public app = inject(AppService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private toastCtrl = inject(ToastController);
  private loadingCtrl = inject(LoadingController);
  private alertCtrl = inject(AlertController);
  private modalCtrl = inject(ModalController);
  private translate = inject(TranslateService);

  documents: DocumentRecord[] = [];
  loading: boolean = true;
  searchQuery: string = '';
  filterStatus: 'ALL' | 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' | 'COST' | 'REVENUE' = 'ALL';
  highlightedDocId: string | null = null;
  codeFilter: string | null = null;

  private subs: Subscription[] = [];

  ngOnInit(): void {
    this.subs.push(
      this.stateService.activeYear$.subscribe((year) => {
        this.loadDocuments(year);
      })
    );

    this.subs.push(
      this.route.queryParams.subscribe((params) => {
        const code = params['code'];
        if (code) {
          this.codeFilter = code;
          this.searchQuery = code;
        } else if (this.codeFilter) {
          this.codeFilter = null;
          this.searchQuery = '';
        }
      })
    );

    this.subs.push(
      this.navService.jumpTarget$.subscribe((target) => {
        if (target?.subtab === 'DOCUMENTS') {
          if (target.targetId) {
            this.highlightedDocId = target.targetId;
            setTimeout(() => {
              const el = document.getElementById(`doc-${target.targetId}`);
              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 300);
          }
          if (target.code) {
            this.codeFilter = target.code;
            this.searchQuery = target.code;
          }
        }
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

  async loadDocuments(year: number): Promise<void> {
    this.loading = true;
    try {
      this.documents = await this.financesService.getDocuments(year);
    } catch (err: any) {
      console.error('Failed to load documents', err);
    } finally {
      this.loading = false;
    }
  }

  get countAll(): number {
    return this.documents.length;
  }
  get countUnpaid(): number {
    return this.documents.filter((d) => this.isDocUnpaid(d)).length;
  }
  get countPartiallyPaid(): number {
    return this.documents.filter((d) => this.isDocPartiallyPaid(d)).length;
  }
  get countPaid(): number {
    return this.documents.filter((d) => this.isDocPaid(d)).length;
  }
  get countCost(): number {
    return this.documents.filter((d) => (d.documentType || 'COST') === 'COST').length;
  }
  get countRevenue(): number {
    return this.documents.filter((d) => d.documentType === 'REVENUE').length;
  }

  isDocPaid(d: DocumentRecord): boolean {
    if (d.status === 'SETTLED' || d.status === 'PAID') return true;
    if (d.paymentOrigin === 'ADVANCE' && d.advanceId) return true;
    return (d.paidAmount || 0) >= d.grossAmount && d.grossAmount > 0;
  }

  isDocPartiallyPaid(d: DocumentRecord): boolean {
    if (this.isDocPaid(d)) return false;
    const paid = d.paidAmount || 0;
    return paid > 0 && paid < d.grossAmount;
  }

  isDocUnpaid(d: DocumentRecord): boolean {
    return !this.isDocPaid(d) && !this.isDocPartiallyPaid(d);
  }

  get filteredDocuments(): DocumentRecord[] {
    let list = this.documents;
    if (this.filterStatus === 'UNPAID') {
      list = list.filter((d) => this.isDocUnpaid(d));
    } else if (this.filterStatus === 'PARTIALLY_PAID') {
      list = list.filter((d) => this.isDocPartiallyPaid(d));
    } else if (this.filterStatus === 'PAID') {
      list = list.filter((d) => this.isDocPaid(d));
    } else if (this.filterStatus === 'COST') {
      list = list.filter((d) => (d.documentType || 'COST') === 'COST');
    } else if (this.filterStatus === 'REVENUE') {
      list = list.filter((d) => d.documentType === 'REVENUE');
    }

    if (!this.searchQuery.trim()) return list;

    const q = this.searchQuery.toLowerCase().trim();
    return list.filter(
      (d) =>
        d.invoiceNumber?.toLowerCase().includes(q) ||
        d.ksefNumber?.toLowerCase().includes(q) ||
        d.issuedBy?.toLowerCase().includes(q) ||
        d.notes?.toLowerCase().includes(q) ||
        d.codeAllocations?.some(
          (a) => (a.code || a.linkedCode)?.toLowerCase().includes(q) || a.description?.toLowerCase().includes(q)
        )
    );
  }

  async openAddDocumentModal(): Promise<void> {
    if (!this.canEdit || this.isArchived) return;
    const modal = await this.modalCtrl.create({
      component: DocumentEditModalComponent,
      componentProps: {
        year: this.stateService.activeYear,
        canEdit: this.canEdit
      },
      cssClass: 'modal-large'
    });
    await modal.present();
    const { data, role } = await modal.onWillDismiss();
    if (role === 'saved' || data?.savedDocument) {
      await this.loadDocuments(this.stateService.activeYear);
    }
  }

  async openEditDocumentModal(doc: DocumentRecord): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: DocumentEditModalComponent,
      componentProps: {
        document: doc,
        year: this.stateService.activeYear,
        canEdit: this.canEdit && !this.isArchived
      },
      cssClass: 'modal-large'
    });
    await modal.present();
    const { data, role } = await modal.onWillDismiss();
    if (role === 'saved' || data?.savedDocument) {
      await this.loadDocuments(this.stateService.activeYear);
    }
  }

  async deleteDocument(doc: DocumentRecord, event?: MouseEvent): Promise<void> {
    if (event) event.stopPropagation();
    if (!this.canEdit || this.isArchived) return;

    const alert = await this.alertCtrl.create({
      header: this.translate.instant('FINANCES.DOCUMENTS.CONFIRM_DELETE_DOC_TITLE'),
      message: this.translate.instant('FINANCES.DOCUMENTS.CONFIRM_DELETE_DOC_MSG', {
        num: doc.invoiceNumber || doc.ksefNumber || doc.id
      }),
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('COMMON.DELETE'),
          role: 'destructive',
          handler: async () => {
            const loading = await this.loadingCtrl.create({
              message: this.translate.instant('COMMON.DELETING')
            });
            await loading.present();
            try {
              await this.financesService.deleteDocument(doc.id);
              this.documents = this.documents.filter((d) => d.id !== doc.id);
              const toast = await this.toastCtrl.create({
                message: this.translate.instant('COMMON.DELETE_SUCCESS'),
                duration: 2500,
                color: 'success'
              });
              await toast.present();
            } catch (err: any) {
              const toast = await this.toastCtrl.create({
                message: err?.message || this.translate.instant('COMMON.DELETE_ERROR'),
                duration: 4000,
                color: 'danger'
              });
              await toast.present();
            } finally {
              await loading.dismiss();
            }
          }
        }
      ]
    });
    await alert.present();
  }

  jumpToBudgetLine(code: string): void {
    if (!code) return;
    this.navService.jumpToBudgetLine(code, this.stateService.activeYear);
  }

  jumpToAdvance(advanceId: string): void {
    this.navService.jumpToAdvance(advanceId, this.stateService.activeYear);
  }

  clearSearch(): void {
    this.searchQuery = '';
    this.codeFilter = null;
    this.navService.clearJumpTarget();
    this.router.navigate([], {
      queryParams: { code: null, targetId: null },
      queryParamsHandling: 'merge'
    });
  }

  clearFilter(): void {
    this.searchQuery = '';
    this.codeFilter = null;
    this.navService.clearJumpTarget();
    this.router.navigate([], {
      queryParams: { code: null, targetId: null },
      queryParamsHandling: 'merge'
    });
  }

  async toggleDocumentSettled(doc: DocumentRecord): Promise<void> {
    if (!this.canEdit || this.isArchived) return;

    doc.status = doc.status === 'SETTLED' ? 'APPROVED' : 'SETTLED';
    try {
      await this.financesService.saveDocument(doc);
      const statusLabel = doc.status === 'SETTLED'
        ? this.translate.instant('FINANCES.DOCUMENTS.STATUS_UPDATED_SETTLED')
        : this.translate.instant('FINANCES.DOCUMENTS.STATUS_UPDATED_PENDING');
      const toast = await this.toastCtrl.create({
        message: this.translate.instant('FINANCES.DOCUMENTS.STATUS_UPDATED', { status: statusLabel }),
        duration: 2000,
        color: 'success'
      });
      await toast.present();
    } catch (err: any) {
      const toast = await this.toastCtrl.create({
        message: err?.message || this.translate.instant('FINANCES.DOCUMENTS.STATUS_ERROR'),
        duration: 3500,
        color: 'danger'
      });
      await toast.present();
    }
  }
}
