import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';

import { RequestsRoutingModule } from './requests.routing.module';
import { RequestsPage } from './requests.page';
import { RequestFormPage } from './submit/request-form.page';
import { RequestViewPage } from './view/request-view.page';
import { ManageRequestsPage } from './manage/manage-requests.page';

@NgModule({
  declarations: [
    RequestsPage,
    RequestFormPage,
    RequestViewPage,
    ManageRequestsPage
  ],
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    TranslateModule,
    RequestsRoutingModule
  ]
})
export class RequestsModule {}
