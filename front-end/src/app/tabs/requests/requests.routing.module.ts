import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { RequestsPage } from './requests.page';
import { RequestFormPage } from './submit/request-form.page';
import { RequestViewPage } from './view/request-view.page';
import { ManageRequestsPage } from './manage/manage-requests.page';

const routes: Routes = [
  {
    path: '',
    component: RequestsPage
  },
  {
    path: 'manage',
    component: ManageRequestsPage
  },
  {
    path: 'submit',
    component: RequestFormPage
  },
  {
    path: 'edit/:id',
    component: RequestFormPage
  },
  {
    path: 'edit/:year/:id',
    component: RequestFormPage
  },
  {
    path: 'view/:id',
    component: RequestViewPage
  },
  {
    path: 'view/:year/:id',
    component: RequestViewPage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class RequestsRoutingModule {}
