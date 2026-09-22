import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';
import { IDEAApiService } from '@idea-ionic/common';

import { environment as env } from '@env';

export interface GitHubContributor {
  login: string;
  html_url: string;
  avatar_url: string;
  contributions: number;
  type?: string;
  name?: string | null;
}

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, TranslateModule],
  selector: 'app-credits',
  templateUrl: './credits.page.html',
  styleUrls: ['./credits.page.scss']
})
export class CreditsPage implements OnInit {
  contributors: GitHubContributor[] = [];
  loading = true;
  failed = false;
  version = env.idea.app.version;

  private readonly api = inject(IDEAApiService);
  private readonly modalCtrl = inject(ModalController);

  close(): void {
    this.modalCtrl.dismiss();
  }

  getContributionsURL(login: string): string {
    return `https://github.com/ESN-Polska/esn-poland-finances/commits?author=${encodeURIComponent(login)}`;
  }

  async ngOnInit(): Promise<void> {
    try {
      this.contributors = await this.api.getResource('contributors');
    } catch (_) {
      this.failed = true;
    } finally {
      this.loading = false;
    }
  }
}
