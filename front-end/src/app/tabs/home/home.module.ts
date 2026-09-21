import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { RouterModule, Routes } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';

import { HomePage } from './home.page';
import { HomeTextModalComponent } from './homeTextModal.component';
import { HomeNoticeModalComponent } from './homeNoticeModal.component';

const routes: Routes = [
  {
    path: '',
    component: HomePage
  }
];

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    TranslateModule,
    RouterModule.forChild(routes)
  ],
  declarations: [HomePage, HomeTextModalComponent, HomeNoticeModalComponent]
})
export class HomeModule {}
