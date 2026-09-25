import { Injectable } from '@angular/core';
import { IDEAApiService } from '@idea-ionic/common';
import { User } from '@models/user.model';

@Injectable({ providedIn: 'root' })
export class UsersService {
  constructor(private api: IDEAApiService) {}

  /**
   * Get list of users with optional search and role assignments.
   */
  async getAll(options?: { search?: string; roleAssignments?: boolean }): Promise<User[]> {
    const params: Record<string, string> = {};
    if (options?.search) params['search'] = options.search;
    if (options?.roleAssignments) params['roleAssignments'] = 'true';

    try {
      const rawUsers: any[] = await this.api.getResource('users', { params });
      return (rawUsers || []).map(u => new User(u));
    } catch {
      return [];
    }
  }

  /**
   * Get single user by ID.
   */
  async getById(userId: string): Promise<User | null> {
    try {
      const raw = await this.api.getResource(['users', encodeURIComponent(userId.toLowerCase())]);
      return raw ? new User(raw) : null;
    } catch {
      return null;
    }
  }

  /**
   * Update disabled automatic email notifications preferences for user.
   */
  async updateNotificationPreferences(userId: string, disabledEmailNotifications: string[]): Promise<User | null> {
    try {
      const raw = await this.api.patchResource(['users', encodeURIComponent(userId.toLowerCase())], {
        body: { disabledEmailNotifications }
      });
      return raw ? new User(raw) : null;
    } catch (err) {
      console.error('Failed to update user notification preferences', err);
      throw err;
    }
  }

  /**
   * Update primary section/country preferences for user.
   */
  async updateOrigin(
    userId: string,
    data: { sectionCode?: string; section?: string; country?: string; primarySectionChosen?: boolean }
  ): Promise<User | null> {
    try {
      const raw = await this.api.patchResource(['users', encodeURIComponent(userId.toLowerCase())], {
        body: data
      });
      return raw ? new User(raw) : null;
    } catch (err) {
      console.error('Failed to update user origin preferences', err);
      throw err;
    }
  }
}
