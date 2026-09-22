import { Injectable } from '@angular/core';
import { IDEAApiService } from '@idea-ionic/common';
import { Configurations, EmailTemplates } from '@models/configurations.model';

@Injectable({ providedIn: 'root' })
export class ConfigurationsService {
  constructor(private api: IDEAApiService) {}

  /**
   * Load the platform configurations from the backend.
   */
  async get(): Promise<Configurations> {
    return new Configurations(await this.api.getResource('configurations'));
  }

  /**
   * Update the platform configurations.
   */
  async update(configurations: Configurations): Promise<Configurations> {
    return new Configurations(
      await this.api.putResource('configurations', { body: configurations })
    );
  }

  /**
   * Set a new email template.
   */
  async setEmailTemplate(template: EmailTemplates, subject: string, content: string): Promise<void> {
    const action = 'SET_EMAIL_TEMPLATE';
    await this.api.patchResource('configurations', { body: { action, template, subject, content } });
  }

  /**
   * Reset the email template to stock default.
   */
  async resetEmailTemplate(template: EmailTemplates): Promise<void> {
    const action = 'RESET_EMAIL_TEMPLATE';
    await this.api.patchResource('configurations', { body: { action, template } });
  }

  /**
   * Get the email template subject and HTML content.
   */
  async getEmailTemplate(template: EmailTemplates): Promise<{ subject: string; content: string }> {
    const action = 'GET_EMAIL_TEMPLATE';
    return await this.api.patchResource('configurations', { body: { action, template } });
  }

  /**
   * Send a test email to the current administrator.
   */
  async testEmailTemplate(template: EmailTemplates): Promise<void> {
    const action = 'TEST_EMAIL_TEMPLATE';
    return await this.api.patchResource('configurations', { body: { action, template } });
  }

  /**
   * Send a guest invitation email directly.
   */
  async sendGuestInvitationEmail(params: {
    inviteId: string;
    lang?: 'pl' | 'en';
    subject?: string;
    content?: string;
  }): Promise<{ success: boolean; message?: string }> {
    const action = 'SEND_GUEST_INVITATION_EMAIL';
    return await this.api.patchResource('configurations', { body: { action, ...params } });
  }
}

