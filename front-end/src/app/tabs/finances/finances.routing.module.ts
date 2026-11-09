import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { FinancesPage } from './finances.page';

const routes: Routes = [
  {
    path: '',
    component: FinancesPage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class FinancesRoutingModule {}
