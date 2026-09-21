import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { ConfigurationsPage } from './configurations.page';

const routes: Routes = [
  {
    path: '',
    component: ConfigurationsPage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class ConfigurationsPageRoutingModule {}
