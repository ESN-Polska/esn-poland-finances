import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';

import { DragDropModule } from '@angular/cdk/drag-drop';
import { FinancesRoutingModule } from './finances.routing.module';
import { FinancesPage } from './finances.page';

// Modals
import { BudgetExportModalComponent } from './modals/budget-export-modal/budget-export-modal.component';
import { AmendmentModalComponent } from './modals/amendment-modal/amendment-modal.component';
import { BudgetLineModalComponent } from './modals/budget-line-modal/budget-line-modal.component';
import { BudgetCategoryModalComponent } from './modals/budget-category-modal/budget-category-modal.component';
import { BudgetGroupModalComponent } from './modals/budget-group-modal/budget-group-modal.component';
import { CsvImportModalComponent } from './modals/csv-import-modal/csv-import-modal.component';
import { BudgetHistoryModalComponent } from './modals/budget-history-modal/budget-history-modal.component';

// Subtabs
import { SummarySubtabComponent } from './subtabs/summary/summary-subtab.component';
import { BudgetSubtabComponent } from './subtabs/budget/budget-subtab.component';
import { DocumentsSubtabComponent } from './subtabs/documents/documents-subtab.component';
import { FiscalSubtabComponent } from './subtabs/fiscal/fiscal-subtab.component';
import { TransactionsSubtabComponent } from './subtabs/transactions/transactions-subtab.component';
import { SectionsSubtabComponent } from './subtabs/sections/sections-subtab.component';
import { MeetingsSubtabComponent } from './subtabs/meetings/meetings-subtab.component';
import { AdvancesSubtabComponent } from './subtabs/advances/advances-subtab.component';
import { DelegationsSubtabComponent } from './subtabs/delegations/delegations-subtab.component';
import { TransfersSubtabComponent } from './subtabs/transfers/transfers-subtab.component';
import { DepositsSubtabComponent } from './subtabs/deposits/deposits-subtab.component';

// Pipes
import { FinanceNumberPipe } from './pipes/finance-number.pipe';
import { AppDatePipe } from '../../pipes/app-date.pipe';

@NgModule({
  declarations: [
    FinancesPage,
    BudgetExportModalComponent,
    AmendmentModalComponent,
    BudgetLineModalComponent,
    BudgetCategoryModalComponent,
    BudgetGroupModalComponent,
    CsvImportModalComponent,
    BudgetHistoryModalComponent,
    SummarySubtabComponent,
    BudgetSubtabComponent,
    DocumentsSubtabComponent,
    FiscalSubtabComponent,
    TransactionsSubtabComponent,
    SectionsSubtabComponent,
    MeetingsSubtabComponent,
    AdvancesSubtabComponent,
    DelegationsSubtabComponent,
    TransfersSubtabComponent,
    DepositsSubtabComponent,
    FinanceNumberPipe
  ],
  exports: [
    FinanceNumberPipe,
    AppDatePipe
  ],
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    TranslateModule,
    DragDropModule,
    FinancesRoutingModule,
    AppDatePipe
  ]
})
export class FinancesModule {}
