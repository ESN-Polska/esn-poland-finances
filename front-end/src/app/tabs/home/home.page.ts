import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { FinancialRequest } from '@models/financial-request.model';
import { RequestsService } from '../../services/requests.service';

@Component({
  selector: 'app-home-tab',
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss']
})
export class HomePage implements OnInit {
  public latestRequest: FinancialRequest | null = null;
  public isLoading = true;

  constructor(
    private router: Router,
    private requestsService: RequestsService
  ) {}

  public async ngOnInit(): Promise<void> {
    await this.loadRecentActivity();
  }

  public async ionViewWillEnter(): Promise<void> {
    await this.loadRecentActivity();
  }

  public async loadRecentActivity(): Promise<void> {
    this.isLoading = true;
    try {
      this.latestRequest = await this.requestsService.getLatestRequest();
    } catch (err) {
      console.error('Failed to load recent activity', err);
    } finally {
      this.isLoading = false;
    }
  }

  public goToSubmit(): void {
    this.router.navigate(['/t/requests/submit']);
  }

  public viewRequest(requestId: string): void {
    const [seq, year] = requestId.split('/');
    if (year && seq) {
      this.router.navigate(['/t/requests/view', year, seq]);
    } else {
      this.router.navigate(['/t/requests/view', encodeURIComponent(requestId)]);
    }
  }
}
