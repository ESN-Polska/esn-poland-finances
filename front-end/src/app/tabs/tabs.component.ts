import { Component } from '@angular/core';
import { AppService } from '../app.service';

@Component({
  selector: 'app-tabs',
  templateUrl: 'tabs.component.html',
  styleUrls: ['tabs.component.scss']
})
export class TabsComponent {
  constructor(public app: AppService) {}

  public async logout(): Promise<void> {
    await this.app.logout();
  }
}
