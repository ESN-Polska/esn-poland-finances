import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';

import { RequestsRoutingModule } from './requests.routing.module';
import { RequestsPage } from './requests.page';
import { RequestFormPage } from './submit/request-form.page';
import { RequestViewPage } from './view/request-view.page';
import { RequestReviewPage } from './review/request-review.page';
import { ManageRequestsPage } from './manage/manage-requests.page';
import { StatusCommentPipe } from './pipes/status-comment.pipe';
import { MarkPaidModalComponent } from './markPaidModal.component';
import { PayoutsPage } from './payouts/payouts.page';
import { BankExportModalComponent } from './payouts/bank-export-modal/bank-export-modal.component';
import { AppDatePipe } from '../../pipes/app-date.pipe';

@NgModule({
  declarations: [
    RequestsPage,
    RequestFormPage,
    RequestViewPage,
    RequestReviewPage,
    ManageRequestsPage,
    StatusCommentPipe,
    MarkPaidModalComponent,
    PayoutsPage,
    BankExportModalComponent
  ],
  exports: [
    StatusCommentPipe,
    AppDatePipe
  ],
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    TranslateModule,
    RequestsRoutingModule,
    AppDatePipe
  ]
})
export class RequestsModule {}
