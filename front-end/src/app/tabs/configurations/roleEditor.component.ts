import { Component, Input, OnInit } from '@angular/core';
import { AlertController, ModalController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import {
  APP_PERMISSION_TREE,
  AppPermission,
  CAS_PERMISSION_OPTIONS,
  CustomRole,
  AutomaticRoleAssignment
} from '@models/configurations.model';

@Component({
  selector: 'app-role-editor',
  template: `
    <ion-header>
      <ion-toolbar color="ideaToolbar">
        <ion-buttons slot="start">
          <ion-button [title]="'COMMON.CLOSE' | translate" (click)="close()">
            <ion-icon name="close-circle-outline" slot="icon-only"></ion-icon>
          </ion-button>
        </ion-buttons>
        <ion-title>{{ title }}</ion-title>
        <ion-buttons slot="end">
          <ion-button [title]="'COMMON.SAVE' | translate" (click)="save()">
            <ion-icon name="checkmark-circle-outline" slot="icon-only"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content class="roleEditorContent">
      <div class="maxWidthContainer">
        <ion-list class="aList roleEditorList">
          <ion-list-header *ngIf="mode === 'custom'">
            <ion-label>
              <h2>{{ 'CONFIGURATIONS.ROLE_DETAILS' | translate }}</h2>
            </ion-label>
          </ion-list-header>
          <ion-item *ngIf="mode === 'custom'">
            <ion-label position="stacked">{{ 'CONFIGURATIONS.ROLE_NAME' | translate }}</ion-label>
            <ion-input [(ngModel)]="name"></ion-input>
          </ion-item>
          <ion-item *ngIf="mode === 'custom'">
            <ion-label position="stacked">{{ 'CONFIGURATIONS.ROLE_USERS' | translate }}</ion-label>
            <ion-textarea
              [(ngModel)]="userIds"
              [autoGrow]="true"
              [placeholder]="'CONFIGURATIONS.ROLE_USERS_PLACEHOLDER' | translate"
            ></ion-textarea>
          </ion-item>

          <ion-list-header>
            <ion-label>
              <h2>{{ 'CONFIGURATIONS.CAS_PERMISSIONS' | translate }}</h2>
              <p>{{ 'CONFIGURATIONS.CAS_PERMISSIONS_I' | translate }}</p>
            </ion-label>
          </ion-list-header>
          <ion-item *ngFor="let permission of casPermissionOptions">
            <ion-checkbox slot="start" [(ngModel)]="selectedCASPermissions[permission]"></ion-checkbox>
            <ion-label class="ion-text-wrap">{{ permission }}</ion-label>
          </ion-item>
          <ion-item>
            <ion-label position="stacked">{{ 'CONFIGURATIONS.CUSTOM_CAS_PATTERNS' | translate }}</ion-label>
            <ion-textarea
              [(ngModel)]="customExtendedRolePatterns"
              [autoGrow]="true"
              [placeholder]="'CONFIGURATIONS.CUSTOM_CAS_PATTERNS_PLACEHOLDER' | translate"
            ></ion-textarea>
          </ion-item>

          <ion-list-header *ngIf="mode === 'custom'">
            <ion-label>
              <h2>{{ 'CONFIGURATIONS.APP_PERMISSIONS' | translate }}</h2>
              <p>{{ 'CONFIGURATIONS.APP_PERMISSIONS_I' | translate }}</p>
            </ion-label>
          </ion-list-header>
          <ng-container *ngIf="mode === 'custom'">
            <ng-container *ngFor="let group of permissionTree">
              <ion-item>
                <ion-checkbox
                  slot="start"
                  [checked]="isPermissionChecked(group.permission)"
                  [indeterminate]="isPermissionIndeterminate(group)"
                  (ionChange)="setPermissionGroup(group, $event.detail.checked)"
                ></ion-checkbox>
                <ion-label class="ion-text-wrap">{{ group.permission }}</ion-label>
              </ion-item>
              <ion-item class="permissionChild" *ngFor="let child of group.children">
                <ion-checkbox
                  slot="start"
                  [checked]="isPermissionChecked(child)"
                  (ionChange)="setPermission(child, $event.detail.checked)"
                ></ion-checkbox>
                <ion-label class="ion-text-wrap">{{ child }}</ion-label>
              </ion-item>
            </ng-container>
          </ng-container>
        </ion-list>
      </div>
    </ion-content>
  `,
  styleUrls: ['./roleEditor.component.scss']
})
export class RoleEditorComponent implements OnInit {
  @Input() mode: 'custom' | 'automatic' = 'custom';
  @Input() role?: CustomRole;
  @Input() assignment?: AutomaticRoleAssignment;
  @Input() roleId = '';
  @Input() requirePatterns = false;

  readonly permissionTree = APP_PERMISSION_TREE;
  readonly casPermissionOptions = CAS_PERMISSION_OPTIONS;
  selectedCASPermissions: Record<string, boolean> = {};
  selectedAppPermissions: Record<string, boolean> = {};
  name = '';
  userIds = '';
  customExtendedRolePatterns = '';

  get title(): string {
    if (this.mode === 'custom') {
      return this.role ? 'Edit Custom Role' : 'Create Custom Role';
    }
    return `Automatic ${this.roleId.toLowerCase().replace(/_/g, ' ')} Assignment`;
  }

  constructor(
    private modalCtrl: ModalController,
    private alertCtrl: AlertController,
    private translate: TranslateService
  ) {}

  ngOnInit(): void {
    this.name = this.role?.name || '';
    this.userIds = this.role?.userIds?.join('\n') || '';
    const selectedCAS = this.role?.extendedRolePatterns || this.assignment?.extendedRolePatterns || [];
    selectedCAS.forEach(permission => (this.selectedCASPermissions[permission] = true));
    (this.role?.permissions || []).forEach(permission => (this.selectedAppPermissions[permission] = true));
    this.normalizePermissionTree();
    this.customExtendedRolePatterns = selectedCAS
      .filter(permission => !this.casPermissionOptions.includes(permission))
      .join('\n');
  }

  isPermissionChecked(permission: AppPermission): boolean {
    return !!this.selectedAppPermissions[permission];
  }

  isPermissionIndeterminate(group: { permission: AppPermission; children: AppPermission[] }): boolean {
    const selectedChildren = group.children.filter(child => this.isPermissionChecked(child)).length;
    return (
      !this.isPermissionChecked(group.permission) &&
      selectedChildren > 0 &&
      selectedChildren < group.children.length
    );
  }

  setPermission(permission: AppPermission, checked: boolean): void {
    this.selectedAppPermissions[permission] = checked;
    if (!checked) {
      const parent = this.permissionTree.find(group => group.children.includes(permission));
      if (parent) this.selectedAppPermissions[parent.permission] = false;
    }
    this.normalizePermissionTree();
  }

  setPermissionGroup(group: { permission: AppPermission; children: AppPermission[] }, checked: boolean): void {
    this.selectedAppPermissions[group.permission] = checked;
    group.children.forEach(child => (this.selectedAppPermissions[child] = checked));
  }

  private normalizePermissionTree(): void {
    this.permissionTree.forEach(group => {
      if (!group.children.length) return;
      const allChildrenSelected = group.children.every(child => this.isPermissionChecked(child));
      if (this.isPermissionChecked(group.permission)) {
        group.children.forEach(child => (this.selectedAppPermissions[child] = true));
      } else if (allChildrenSelected) {
        this.selectedAppPermissions[group.permission] = true;
      }
    });
  }

  save(): void {
    const extendedRolePatterns = [
      ...this.casPermissionOptions.filter(permission => this.selectedCASPermissions[permission]),
      ...this.customExtendedRolePatterns
        .split(/[\n,]/)
        .map(permission => permission.trim())
        .filter(Boolean)
    ].filter((permission, index, permissions) => permissions.indexOf(permission) === index);

    if (this.mode === 'automatic') {
      if (this.requirePatterns && !extendedRolePatterns.length) {
        this.alertCtrl.create({
          header: this.translate.instant('COMMON.OPERATION_FAILED'),
          message: this.translate.instant('CONFIGURATIONS.CANNOT_REMOVE_LAST_ADMIN_GROUP'),
          buttons: [{ text: this.translate.instant('COMMON.CONFIRM'), role: 'cancel' }]
        }).then(alert => alert.present());
        return;
      }
      this.modalCtrl.dismiss({ extendedRolePatterns });
      return;
    }

    const permissions = this.permissionTree.reduce(
      (selected, group) => [
        ...selected,
        ...(this.selectedAppPermissions[group.permission] ? [group.permission] : []),
        ...group.children.filter(permission => this.selectedAppPermissions[permission])
      ],
      [] as AppPermission[]
    );

    this.modalCtrl.dismiss({
      role: {
        id: this.role?.id || `${Date.now()}`,
        name: this.name.trim(),
        userIds: this.userIds
          .split(/[\n,]/)
          .map(userId => userId.trim().toLowerCase())
          .filter(Boolean),
        permissions,
        extendedRolePatterns
      } as CustomRole
    });
  }

  close(): void {
    this.modalCtrl.dismiss();
  }
}
