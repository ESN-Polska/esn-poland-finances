import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';

import { TabsComponentRoutingModule } from './tabs.routing.module';
import { TabsComponent } from './tabs.component';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    TranslateModule,
    TabsComponentRoutingModule
  ],
  declarations: [TabsComponent]
})
export class TabsModule {}
