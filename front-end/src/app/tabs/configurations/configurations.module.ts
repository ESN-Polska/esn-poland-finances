import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';

import { ConfigurationsPage } from './configurations.page';
import { ConfigurationsPageRoutingModule } from './configurations.routing.module';
import { RoleEditorComponent } from './roleEditor.component';
import { UserRoleMappingsComponent } from './userRoleMappings.component';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    TranslateModule,
    ConfigurationsPageRoutingModule
  ],
  declarations: [
    ConfigurationsPage,
    RoleEditorComponent,
    UserRoleMappingsComponent
  ]
})
export class ConfigurationsModule {}
