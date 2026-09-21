import { Component, OnInit } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';

import { AppService } from '@app/app.service';
import { UsersService } from '@app/common/users.service';
import { ConfigurationsService } from './configurations.service';
import { Configurations } from '@models/configurations.model';
import { User } from '@models/user.model';

@Component({
  selector: 'app-user-role-mappings',
  template: `
    <ion-header>
      <ion-toolbar color="ideaToolbar">
        <ion-buttons slot="start">
          <ion-button [title]="'COMMON.CLOSE' | translate" (click)="close()">
            <ion-icon name="close-circle-outline" slot="icon-only"></ion-icon>
          </ion-button>
        </ion-buttons>
        <ion-title>{{ 'CONFIGURATIONS.CAS_MATCHED_USERS' | translate }}</ion-title>
        <ion-buttons slot="end">
          <ion-button
            [title]="'CONFIGURATIONS.REFRESH_ROLE_MAPPINGS' | translate"
            [disabled]="loading"
            (click)="refresh()"
          >
            <ion-icon name="refresh-outline" slot="icon-only"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
      <ion-toolbar class="searchFilterToolbar">
        <div class="headerFilterContainer">
          <div class="searchWrapper">
            <ion-icon name="search-outline" class="searchIcon"></ion-icon>
            <input
              type="text"
              class="searchInput"
              [(ngModel)]="search"
              (input)="filterUsers()"
              [placeholder]="'CONFIGURATIONS.SEARCH_USERS' | translate"
            />
            <button *ngIf="search" class="clearSearchBtn" (click)="search = ''; filterUsers()">
              <ion-icon name="close-circle"></ion-icon>
            </button>
          </div>
          <div class="casFilterWrapper">
            <span class="filterLabel">{{ 'CONFIGURATIONS.FILTER_CAS_PERMISSION' | translate }}:</span>
            <ion-select
              interface="popover"
              class="filterSelect"
              [(ngModel)]="selectedCasPermission"
              (ionChange)="filterUsers()"
            >
              <ion-select-option value="">{{ 'COMMON.ALL' | translate }}</ion-select-option>
              <ion-select-option *ngFor="let permission of casPermissionOptions" [value]="permission">
                {{ permission }}
              </ion-select-option>
            </ion-select>
          </div>
        </div>
      </ion-toolbar>
    </ion-header>
    <ion-content class="mappingsContent">
      <div class="maxWidthContainer">
        <ion-list class="aList">
          <ion-item *ngIf="loading && !users">
            <ion-label><ion-skeleton-text animated></ion-skeleton-text></ion-label>
          </ion-item>
          <ion-item class="noElements" *ngIf="users && !filteredUsers.length">
            <ion-label>{{ 'CONFIGURATIONS.NO_CAS_MATCHED_USERS' | translate }}</ion-label>
          </ion-item>
          <ion-item *ngFor="let user of filteredUsers">
            <ion-label class="ion-text-wrap">
              <h2 class="userDisplayName">{{ getUserDisplayName(user) }}</h2>
              <p class="userMeta">
                <span class="userHandle">@{{ user.userId }}</span>
                <span *ngIf="user.country"> · {{ user.country }}</span>
                <span *ngIf="user.section"> · {{ user.section }}</span>
              </p>
              <p class="loginMeta">{{ 'CONFIGURATIONS.LAST_LOGIN' | translate }}: {{ getLastLoginLabel(user.lastLoginAt) }}</p>
              <div class="matchedRolesWrapper" *ngIf="getInheritedSources(user)?.length">
                <span class="matchedRolesLabel">{{ 'CONFIGURATIONS.MATCHED_ROLES' | translate }}:</span>
                <div class="tagsContainer">
                  <span *ngFor="let source of getInheritedSources(user)" class="sourceTag">
                    {{ source.matchedExtendedRole }}<span *ngIf="source.roleName"> → {{ source.roleName }}</span>
                  </span>
                </div>
              </div>
            </ion-label>
            <ion-button fill="clear" color="medium" slot="end" (click)="app.openUserProfileById(user.userId)">
              <ion-icon name="open-outline" slot="icon-only"></ion-icon>
            </ion-button>
          </ion-item>
        </ion-list>
      </div>
    </ion-content>
  `,
  styleUrls: ['./userRoleMappings.component.scss']
})
export class UserRoleMappingsComponent implements OnInit {
  users?: User[];
  filteredUsers: User[] = [];
  search = '';
  selectedCasPermission = '';
  casPermissionOptions: string[] = [];
  loading = false;

  constructor(
    private modalCtrl: ModalController,
    private usersService: UsersService,
    private configurationsService: ConfigurationsService,
    private translate: TranslateService,
    public app: AppService
  ) {}

  async ngOnInit(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    this.loading = true;
    try {
      const [users, configurations] = await Promise.all([
        this.usersService.getAll({ roleAssignments: true }),
        this.configurationsService.get()
      ]);
      this.users = users;
      this.setCasPermissionOptions(configurations);
      this.filterUsers();
    } catch {
      this.users = [];
    } finally {
      this.loading = false;
    }
  }

  private setCasPermissionOptions(configurations: Configurations): void {
    const customPatterns = (configurations.customRoles || []).reduce(
      (acc, role) => [...acc, ...(role.extendedRolePatterns || [])],
      [] as string[]
    );
    const autoPatterns = (configurations.automaticRoleAssignments || []).reduce(
      (acc, assignment) => [...acc, ...(assignment.extendedRolePatterns || [])],
      [] as string[]
    );

    this.casPermissionOptions = Array.from(new Set([...customPatterns, ...autoPatterns])).sort();
    if (this.selectedCasPermission && !this.casPermissionOptions.includes(this.selectedCasPermission)) {
      this.selectedCasPermission = '';
    }
  }

  filterUsers(): void {
    const query = this.search.trim().toLowerCase();
    this.filteredUsers = (this.users || [])
      .filter(user => {
        const sources = user.roleAssignmentSources || [];
        const inheritedSources = sources.filter(source => source.matchedExtendedRole !== 'manual');
        if (!inheritedSources.length) return false;
        if (
          this.selectedCasPermission &&
          !inheritedSources.some(source => source.matchedExtendedRole === this.selectedCasPermission)
        ) {
          return false;
        }
        return true;
      })
      .filter(user => {
        if (!query) return true;
        return [user.userId, user.firstName, user.lastName, user.section, user.country]
          .filter(Boolean)
          .some(val => val.toLowerCase().includes(query));
      });
  }

  getUserDisplayName(user: User): string {
    return user.getDisplayName ? user.getDisplayName() : user.userId;
  }

  getInheritedSources(user: User): User['roleAssignmentSources'] {
    return (user.roleAssignmentSources || []).filter(source => source.matchedExtendedRole !== 'manual');
  }

  getLastLoginLabel(lastLoginAt: string): string {
    if (!lastLoginAt) return this.translate.instant('CONFIGURATIONS.NEVER');
    const elapsed = Math.max(0, Date.now() - new Date(lastLoginAt).getTime());
    const minutes = Math.floor(elapsed / 60000);
    if (minutes < 1) return this.translate.instant('CONFIGURATIONS.JUST_NOW');
    if (minutes < 60) return this.translate.instant('CONFIGURATIONS.MINUTES_AGO', { count: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours <= 24) return this.translate.instant('CONFIGURATIONS.HOURS_AGO', { count: hours });
    return new Date(lastLoginAt).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  close(): void {
    this.modalCtrl.dismiss();
  }
}
