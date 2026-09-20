import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController, ToastController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { FinancialRequest, RequestStatus } from '@models/financial-request.model';
import { RequestsService } from '../../services/requests.service';

@Component({
  selector: 'app-requests-tab',
  templateUrl: './requests.page.html',
  styleUrls: ['./requests.page.scss']
})
export class RequestsPage implements OnInit {
  public allRequests: FinancialRequest[] = [];
  public filteredRequests: FinancialRequest[] = [];
  public selectedStatus: string = 'ALL';
  public searchQuery: string = '';
  public isLoading: boolean = false;

  constructor(
    private router: Router,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController,
    private translate: TranslateService,
    private requestsService: RequestsService
  ) {}

  public async ngOnInit(): Promise<void> {
    await this.loadRequests();
  }

  public async ionViewWillEnter(): Promise<void> {
    await this.loadRequests();
  }

  public async loadRequests(): Promise<void> {
    this.isLoading = true;
    try {
      this.allRequests = await this.requestsService.loadMyRequests();
      this.applyFilters();
    } catch (err) {
      console.error('Failed to load requests', err);
    } finally {
      this.isLoading = false;
    }
  }

  public setStatusFilter(status: string): void {
    this.selectedStatus = status;
    this.applyFilters();
  }

  public clearSearch(): void {
    this.searchQuery = '';
    this.applyFilters();
  }

  public applyFilters(): void {
    const q = this.searchQuery.trim().toLowerCase();
    this.filteredRequests = this.allRequests.filter((req) => {
      const matchesStatus =
        this.selectedStatus === 'ALL' || req.status === this.selectedStatus;

      const matchesSearch =
        !q ||
        req.requestId?.toLowerCase().includes(q) ||
        req.position?.toLowerCase().includes(q) ||
        req.sourceOfFunding?.toLowerCase().includes(q) ||
        req.documents?.some(
          (d) =>
            d.invoiceNumber?.toLowerCase().includes(q) ||
            d.issuedBy?.toLowerCase().includes(q)
        );

      return matchesStatus && matchesSearch;
    });
  }

  public countByStatus(status: RequestStatus): number {
    return this.allRequests.filter((r) => r.status === status).length;
  }

  public goToSubmit(): void {
    this.router.navigate(['/t/requests/submit']);
  }

  public viewRequest(requestId: string): void {
    this.router.navigate(['/t/requests/view', encodeURIComponent(requestId)]);
  }

  public editRequest(requestId: string): void {
    this.router.navigate(['/t/requests/edit', encodeURIComponent(requestId)]);
  }

  public async confirmDelete(requestId: string): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: this.translate.instant('REQUESTS.DELETE_CONFIRM_TITLE'),
      message: this.translate.instant('REQUESTS.DELETE_CONFIRM_MSG'),
      buttons: [
        {
          text: this.translate.instant('COMMON.CANCEL'),
          role: 'cancel'
        },
        {
          text: this.translate.instant('COMMON.DELETE'),
          role: 'destructive',
          handler: async () => {
            try {
              await this.requestsService.deleteDraft(requestId);
              await this.loadRequests();
              const toast = await this.toastCtrl.create({
                message: this.translate.instant('REQUESTS.DELETED_SUCCESS'),
                duration: 2500,
                color: 'success'
              });
              await toast.present();
            } catch (err: any) {
              const toast = await this.toastCtrl.create({
                message: err.message || 'Failed to delete request',
                duration: 3000,
                color: 'danger'
              });
              await toast.present();
            }
          }
        }
      ]
    });

    await alert.present();
  }
}
