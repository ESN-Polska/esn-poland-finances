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
  filterStatus: 'ALL' | 'SETTLED' | 'UNSETTLED' = 'ALL';
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

  get filteredDocuments(): DocumentRecord[] {
    let list = this.documents;
    if (this.filterStatus === 'SETTLED') {
      list = list.filter((d) => d.status === 'SETTLED');
    } else if (this.filterStatus === 'UNSETTLED') {
      list = list.filter((d) => d.status !== 'SETTLED');
    }

    if (!this.searchQuery.trim()) return list;

    const q = this.searchQuery.toLowerCase().trim();
    return list.filter(
      (d) =>
        d.invoiceNumber?.toLowerCase().includes(q) ||
        d.ksefNumber?.toLowerCase().includes(q) ||
        d.issuedBy?.toLowerCase().includes(q) ||
        d.notes?.toLowerCase().includes(q) ||
        d.codeAllocations?.some((a) => a.code?.toLowerCase().includes(q) || a.description?.toLowerCase().includes(q))
    );
  }

  jumpToBudgetLine(code: string): void {
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
