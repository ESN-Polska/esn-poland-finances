import { Component, OnInit } from '@angular/core';
import { AppService } from './app.service';
import { NavigationHistoryService } from './services/navigation-history.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent implements OnInit {
  constructor(
    private appService: AppService,
    private navHistory: NavigationHistoryService
  ) {}

  public async ngOnInit(): Promise<void> {
    await this.appService.init();
  }
}
