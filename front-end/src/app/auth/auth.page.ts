import { Component, Input, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { environment as env } from '@env';
import { AppService } from '../app.service';

@Component({
  selector: 'app-auth',
  templateUrl: './auth.page.html',
  styleUrls: ['./auth.page.scss']
})
export class AuthPage implements OnInit {
  @Input() token?: string;

  public isProcessing = false;
  public version = env.idea?.app?.version || '1.0.0';

  constructor(
    public appService: AppService,
    private route: ActivatedRoute,
    private router: Router
  ) {}

  public async ngOnInit(): Promise<void> {
    await this.appService.init();

    // Check token from @Input (routed parameter) or snapshot queryParams
    const queryToken = this.token || this.route.snapshot.queryParamMap.get('token');

    if (queryToken) {
      this.isProcessing = true;
      try {
        await this.appService.setToken(queryToken);
        await this.router.navigate(['/'], { replaceUrl: true });
      } catch (err) {
        console.error('Failed to process authentication token', err);
        this.isProcessing = false;
      }
    } else if (this.appService.isAuthenticated) {
      await this.router.navigate(['/'], { replaceUrl: true });
    }
  }

  public get currentLang(): string {
    return this.appService.currentLanguage;
  }

  public setLang(lang: string): void {
    this.appService.setLanguage(lang);
  }

  public login(): void {
    this.isProcessing = true;
    this.appService.startLoginFlow();
  }
}
