import { Component, Input, OnInit } from '@angular/core';
import { AlertController, ModalController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import {
  APP_PERMISSION_TREE,
  AppPermission,
  OAUTH_ROLE_OPTIONS,
  CustomRole,
  AutomaticRoleAssignment
} from '@models/configurations.model';
import { User } from '@models/user.model';
import { AppService } from '@app/app.service';

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
        <ion-buttons slot="end" *ngIf="!readOnly">
          <ion-button [title]="'COMMON.SAVE' | translate" (click)="save()" [disabled]="mode === 'custom' && !name?.trim()">
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
            <ion-input [readonly]="readOnly" [(ngModel)]="name"></ion-input>
          </ion-item>

          <!-- Assigned Users Section -->
          <ng-container *ngIf="mode === 'custom'">
            <ion-list-header class="roleUsersHeader">
              <ion-label>
                <h2>{{ 'CONFIGURATIONS.ROLE_USERS' | translate }}</h2>
                <p>{{ 'CONFIGURATIONS.ROLE_USERS_I' | translate }}</p>
              </ion-label>
              <ion-button
                fill="clear"
                size="small"
                class="modeToggleBtn"
                (click)="toggleBulkMode()"
                *ngIf="!readOnly"
              >
                {{ (bulkMode ? 'CONFIGURATIONS.LIST_VIEW' : 'CONFIGURATIONS.PASTE_USERNAMES') | translate }}
              </ion-button>
            </ion-list-header>

            <!-- Bulk Mode: Textarea -->
            <ion-item *ngIf="bulkMode">
              <ion-label position="stacked">{{ 'CONFIGURATIONS.ROLE_USERS' | translate }}</ion-label>
              <ion-textarea
                [readonly]="readOnly"
                [(ngModel)]="bulkUserIdsText"
                [autoGrow]="true"
                [placeholder]="'CONFIGURATIONS.ROLE_USERS_PLACEHOLDER' | translate"
              ></ion-textarea>
            </ion-item>

            <!-- Interactive Mode -->
            <ng-container *ngIf="!bulkMode">
              <!-- Empty State -->
              <ion-item class="noElements" *ngIf="!assignedUserIds.length">
                <ion-label>{{ 'CONFIGURATIONS.NO_USERS_ADDED' | translate }}</ion-label>
              </ion-item>

              <!-- List of Assigned Users -->
              <ion-item *ngFor="let uid of assignedUserIds" class="assignedUserItem">
                <ion-label class="ion-text-wrap">
                  <span class="assignedUserName">{{ getUserIdentifier(uid) }}</span>
                  <span class="unregisteredBadge" *ngIf="isUnregistered(uid)">
                    {{ 'CONFIGURATIONS.USER_NOT_REGISTERED' | translate }}
                  </span>
                </ion-label>
                <ion-button
                  fill="clear"
                  color="medium"
                  slot="end"
                  *ngIf="getUserNickname(uid)"
                  (click)="openAccountsProfile(uid)"
                  [title]="'COMMON.OPEN' | translate"
                >
                  <ion-icon name="open-outline" slot="icon-only"></ion-icon>
                </ion-button>
                <ion-button
                  fill="clear"
                  color="danger"
                  slot="end"
                  *ngIf="!readOnly"
                  (click)="removeUser(uid)"
                  [title]="'COMMON.DELETE' | translate"
                >
                  <ion-icon name="trash-outline" slot="icon-only"></ion-icon>
                </ion-button>
              </ion-item>

              <!-- Add User Input & Autocomplete Suggestions -->
              <div class="addUserWrapper" *ngIf="!readOnly">
                <div class="addUserInputRow">
                  <ion-input
                    [(ngModel)]="userSearchInput"
                    [placeholder]="'CONFIGURATIONS.USERNAME_PLACEHOLDER' | translate"
                    (keyup.enter)="addUser(userSearchInput)"
                    (ionFocus)="showSuggestions = true"
                    (ionBlur)="onSearchBlur()"
                  ></ion-input>
                  <ion-button
                    size="small"
                    [disabled]="!userSearchInput?.trim()"
                    (click)="addUser(userSearchInput)"
                  >
                    {{ 'COMMON.ADD' | translate }}
                  </ion-button>
                </div>

                <!-- Autocomplete Suggestions List -->
                <div class="suggestionsList" *ngIf="showSuggestions && userSuggestions.length > 0">
                  <div
                    class="suggestionItem"
                    *ngFor="let suggestion of userSuggestions"
                    (mousedown)="addUser(suggestion)"
                  >
                    <span class="suggestionName">{{ getUserIdentifier(suggestion.userId) }}</span>
                    <span class="suggestionSection" *ngIf="suggestion.section">{{ suggestion.section }}</span>
                  </div>
                </div>
              </div>
            </ng-container>
          </ng-container>

          <!-- Automatic Role Patterns -->
          <ion-list-header>
            <ion-label>
              <h2>{{ 'CONFIGURATIONS.OAUTH_ROLES' | translate }}</h2>
              <p>{{ 'CONFIGURATIONS.OAUTH_ROLES_I' | translate }}</p>
            </ion-label>
          </ion-list-header>
          <ion-item *ngFor="let permission of availableRoleOptions">
            <ion-checkbox slot="start" [disabled]="readOnly" [(ngModel)]="selectedCASPermissions[permission]"></ion-checkbox>
            <ion-label class="ion-text-wrap">{{ permission }}</ion-label>
          </ion-item>
          <ion-item>
            <ion-label position="stacked">{{ 'CONFIGURATIONS.CUSTOM_OAUTH_PATTERNS' | translate }}</ion-label>
            <ion-textarea
              [readonly]="readOnly"
              [(ngModel)]="customExtendedRolePatterns"
              [autoGrow]="true"
              [placeholder]="'CONFIGURATIONS.CUSTOM_OAUTH_PATTERNS_PLACEHOLDER' | translate"
            ></ion-textarea>
          </ion-item>

          <!-- Application Permissions -->
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
                  [disabled]="readOnly"
                  [checked]="isPermissionChecked(group.permission)"
                  [indeterminate]="isPermissionIndeterminate(group)"
                  (ionChange)="!readOnly && setPermissionGroup(group, $event.detail.checked)"
                ></ion-checkbox>
                <ion-label class="ion-text-wrap">{{ group.permission }}</ion-label>
              </ion-item>
              <ion-item class="permissionChild" *ngFor="let child of group.children">
                <ion-checkbox
                  slot="start"
                  [disabled]="readOnly"
                  [checked]="isPermissionChecked(child)"
                  (ionChange)="!readOnly && setPermission(child, $event.detail.checked)"
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
  @Input() readOnly = false;
  @Input() casPermissionOptions?: string[];
  @Input() allUsers: User[] = [];

  readonly permissionTree = APP_PERMISSION_TREE;
  get availableRoleOptions(): string[] {
    return this.casPermissionOptions && this.casPermissionOptions.length > 0
      ? this.casPermissionOptions
      : OAUTH_ROLE_OPTIONS;
  }

  selectedCASPermissions: Record<string, boolean> = {};
  selectedAppPermissions: Record<string, boolean> = {};
  name = '';
  assignedUserIds: string[] = [];
  bulkMode = false;
  bulkUserIdsText = '';
  userSearchInput = '';
  showSuggestions = false;
  customExtendedRolePatterns = '';

  get title(): string {
    if (this.mode === 'custom') {
      if (this.readOnly) return this.role ? this.role.name : 'Custom Role Details';
      return this.role ? 'Edit Custom Role' : 'Create Custom Role';
    }
    return `Automatic ${this.roleId.toLowerCase().replace(/_/g, ' ')} Assignment`;
  }

  constructor(
    private modalCtrl: ModalController,
    private alertCtrl: AlertController,
    private translate: TranslateService,
    public app: AppService
  ) {}

  ngOnInit(): void {
    this.name = this.role?.name || '';
    this.assignedUserIds = (this.role?.userIds || [])
      .map(id => String(id || '').replace(/^@+/, '').trim())
      .filter(Boolean);
    this.syncBulkTextFromAssigned();

    const selectedCAS = this.role?.extendedRolePatterns || this.assignment?.extendedRolePatterns || [];
    selectedCAS.forEach(permission => (this.selectedCASPermissions[permission] = true));
    (this.role?.permissions || []).forEach(permission => (this.selectedAppPermissions[permission] = true));
    this.normalizePermissionTree();
    this.customExtendedRolePatterns = selectedCAS
      .filter(permission => !this.availableRoleOptions.includes(permission))
      .join('\n');
  }

  getUserIdentifier(userOrId: string): string {
    const raw = (userOrId || '').replace(/^@+/, '').trim().toLowerCase();
    const user = (this.allUsers || []).find(
      u => (u.userId || '').toLowerCase() === raw || (u.nickname || '').toLowerCase() === raw
    );
    if (user) {
      const parts = [user.firstName, user.lastName].filter(Boolean);
      if (parts.length > 0) {
        return user.nickname ? `${parts.join(' ')} (${user.nickname})` : parts.join(' ');
      }
      if (typeof user.getDisplayName === 'function') {
        const name = user.getDisplayName();
        if (name && name !== user.userId) {
          return user.nickname && !name.includes(user.nickname) ? `${name} (${user.nickname})` : name;
        }
      }
      return user.nickname || user.userId || '';
    }
    return (userOrId || '').replace(/^@+/, '').trim();
  }

  getUserNickname(userOrId: string): string | undefined {
    const raw = (userOrId || '').replace(/^@+/, '').trim().toLowerCase();
    const user = (this.allUsers || []).find(
      u => (u.userId || '').toLowerCase() === raw || (u.nickname || '').toLowerCase() === raw || (u.preferredUsername || '').toLowerCase() === raw
    );
    if (user?.nickname) return user.nickname;
    if (user?.preferredUsername) return user.preferredUsername;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw);
    return isUuid ? undefined : (raw || undefined);
  }

  getUserNicknameOrId(userOrId: string): string {
    return this.getUserNickname(userOrId) || (userOrId || '').replace(/^@+/, '').trim();
  }

  isUnregistered(userOrId: string): boolean {
    const raw = (userOrId || '').replace(/^@+/, '').trim().toLowerCase();
    return !(this.allUsers || []).some(
      u => (u.userId || '').toLowerCase() === raw || (u.nickname || '').toLowerCase() === raw || (u.preferredUsername || '').toLowerCase() === raw
    );
  }

  openAccountsProfile(id: string): void {
    const raw = (id || '').replace(/^@+/, '').trim().toLowerCase();
    const user = (this.allUsers || []).find(
      u => (u.userId || '').toLowerCase() === raw || (u.nickname || '').toLowerCase() === raw || (u.preferredUsername || '').toLowerCase() === raw
    );
    this.app.openAccountsProfile(user || id);
  }

  removeUser(id: string): void {
    const cleanId = (id || '').replace(/^@+/, '').trim().toLowerCase();
    const found = (this.allUsers || []).find(
      u => (u.userId || '').toLowerCase() === cleanId ||
           (u.nickname || '').toLowerCase() === cleanId ||
           (u.preferredUsername || '').toLowerCase() === cleanId
    );
    const idsToRemove = new Set([cleanId]);
    if (found) {
      if (found.userId) idsToRemove.add(found.userId.toLowerCase());
      if (found.nickname) idsToRemove.add(found.nickname.toLowerCase());
      if (found.preferredUsername) idsToRemove.add(found.preferredUsername.toLowerCase());
    }
    this.assignedUserIds = this.assignedUserIds.filter(
      existing => !idsToRemove.has(existing.replace(/^@+/, '').trim().toLowerCase())
    );
    this.syncBulkTextFromAssigned();
  }

  addUser(userOrString: User | string): void {
    let idToAdd: string;
    let foundUser: User | undefined;
    if (typeof userOrString === 'object') {
      idToAdd = userOrString.userId || userOrString.nickname || '';
      foundUser = userOrString;
    } else {
      const raw = (userOrString || '').replace(/^@+/, '').trim();
      if (!raw) return;
      foundUser = (this.allUsers || []).find(
        u => (u.userId || '').toLowerCase() === raw.toLowerCase() ||
             (u.nickname || '').toLowerCase() === raw.toLowerCase() ||
             (u.preferredUsername || '').toLowerCase() === raw.toLowerCase()
      );
      idToAdd = foundUser ? (foundUser.userId || foundUser.nickname || raw) : raw;
    }

    if (!idToAdd) return;
    const cleanId = idToAdd.replace(/^@+/, '').trim().toLowerCase();
    const exists = this.assignedUserIds.some(existing => {
      const c = existing.replace(/^@+/, '').trim().toLowerCase();
      return (
        c === cleanId ||
        (foundUser?.userId && c === foundUser.userId.toLowerCase()) ||
        (foundUser?.nickname && c === foundUser.nickname.toLowerCase()) ||
        (foundUser?.preferredUsername && c === foundUser.preferredUsername.toLowerCase())
      );
    });
    if (!exists) {
      this.assignedUserIds.push(idToAdd);
    }
    this.userSearchInput = '';
    this.showSuggestions = false;
    this.syncBulkTextFromAssigned();
  }

  get userSuggestions(): User[] {
    const query = (this.userSearchInput || '').trim().toLowerCase();
    if (!query) return [];
    const assignedSet = new Set(
      this.assignedUserIds.map(id => id.replace(/^@+/, '').trim().toLowerCase())
    );
    return (this.allUsers || [])
      .filter(u => {
        const uid = (u.userId || '').toLowerCase();
        const unick = (u.nickname || '').toLowerCase();
        const upref = (u.preferredUsername || '').toLowerCase();
        if (assignedSet.has(uid) || assignedSet.has(unick) || (upref && assignedSet.has(upref))) return false;
        return (
          uid.includes(query) ||
          unick.includes(query) ||
          (upref && upref.includes(query)) ||
          (u.firstName || '').toLowerCase().includes(query) ||
          (u.lastName || '').toLowerCase().includes(query) ||
          (typeof u.getDisplayName === 'function' && u.getDisplayName().toLowerCase().includes(query))
        );
      })
      .slice(0, 5);
  }

  onSearchBlur(): void {
    setTimeout(() => {
      this.showSuggestions = false;
    }, 200);
  }

  toggleBulkMode(): void {
    if (this.bulkMode) {
      this.syncAssignedFromBulkText();
    } else {
      this.syncBulkTextFromAssigned();
    }
    this.bulkMode = !this.bulkMode;
  }

  private syncBulkTextFromAssigned(): void {
    this.bulkUserIdsText = this.assignedUserIds
      .map(id => this.getUserNicknameOrId(id))
      .join('\n');
  }

  private syncAssignedFromBulkText(): void {
    const lines = (this.bulkUserIdsText || '')
      .split(/[\n,]/)
      .map(line => line.replace(/^@+/, '').trim())
      .filter(Boolean);

    const deduped: string[] = [];
    for (const raw of lines) {
      const found = (this.allUsers || []).find(
        u => (u.userId || '').toLowerCase() === raw.toLowerCase() ||
             (u.nickname || '').toLowerCase() === raw.toLowerCase() ||
             (u.preferredUsername || '').toLowerCase() === raw.toLowerCase()
      );
      const targetId = found ? (found.userId || found.nickname || raw) : raw;
      const cleanTarget = targetId.toLowerCase();
      if (!deduped.some(d => d.toLowerCase() === cleanTarget)) {
        deduped.push(targetId);
      }
    }
    this.assignedUserIds = deduped;
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
    if (this.readOnly) return;
    const extendedRolePatterns = [
      ...this.availableRoleOptions.filter(permission => this.selectedCASPermissions[permission]),
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

    if (this.mode === 'custom' && !this.name?.trim()) {
      return;
    }

    if (this.bulkMode) {
      this.syncAssignedFromBulkText();
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
        userIds: this.assignedUserIds
          .map(userId => userId.trim().replace(/^@+/, '').toLowerCase())
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

