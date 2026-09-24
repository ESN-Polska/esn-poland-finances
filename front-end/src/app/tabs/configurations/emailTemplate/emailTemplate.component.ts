import { Component, Input, OnInit } from '@angular/core';
import { AlertController, LoadingController, ModalController, ToastController } from '@ionic/angular';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { TranslateService } from '@ngx-translate/core';
import { ConfigurationsService } from '../configurations.service';
import { AppService } from '@app/app.service';
import { AppPermission, EmailTemplates, EmailTemplateTypes, getEmailTemplateKey } from '@models/configurations.model';

@Component({
  selector: 'app-email-template',
  templateUrl: './emailTemplate.component.html',
  styleUrls: ['./emailTemplate.component.scss']
})
export class EmailTemplateComponent implements OnInit {
  @Input() templateType!: EmailTemplateTypes;
  @Input() template?: EmailTemplates | EmailTemplateTypes;
  @Input() readOnly?: boolean;

  public get isReadOnly(): boolean {
    if (this.readOnly !== undefined) {
      return this.readOnly;
    }
    const user = this.app.currentUser;
    if (!user) return true;
    if (user.isAdministrator) return false;
    if (user.isAuditorOnly) return true;
    return !user.hasPermission(AppPermission.CONFIGURATIONS.TEMPLATES);
  }

  public currentLang: 'en' | 'pl' = 'en';
  public subject = '';
  public content = '';
  public viewMode: 'code' | 'preview' = 'code';
  public previewHtml: SafeHtml = '';
  public variables: { code: string; description: string }[] = [];
  public errors: Set<string> = new Set();
  public isLoading = false;

  // In-memory cache to preserve edits across language tabs
  public templatesState: {
    pl?: { subject: string; content: string; isLoaded: boolean };
    en?: { subject: string; content: string; isLoaded: boolean };
  } = {};

  constructor(
    private modalCtrl: ModalController,
    private alertCtrl: AlertController,
    private loadingCtrl: LoadingController,
    private toastCtrl: ToastController,
    private translate: TranslateService,
    private sanitizer: DomSanitizer,
    private configurationsService: ConfigurationsService,
    public app: AppService
  ) {}

  public get resolvedTemplateType(): EmailTemplateTypes {
    if (this.templateType) return this.templateType;
    if (this.template) {
      if (this.template.endsWith('_PL') || this.template.endsWith('_EN')) {
        return this.template.slice(0, -3) as EmailTemplateTypes;
      }
      return this.template as EmailTemplateTypes;
    }
    return EmailTemplateTypes.REQUEST_SUBMITTED;
  }

  public get activeTemplateKey(): EmailTemplates {
    return getEmailTemplateKey(this.resolvedTemplateType, this.currentLang);
  }

  public get senderDisplayName(): string {
    return this.app.configurations?.getAppTitle(this.currentLang) || 'ESN Poland';
  }

  async ngOnInit(): Promise<void> {
    if (this.app.isLanguageForced()) {
      this.currentLang = (this.app.getForcedLanguage() as 'en' | 'pl') || 'en';
    } else if (this.template && (this.template.endsWith('_PL') || this.template.endsWith('_EN'))) {
      this.currentLang = this.template.endsWith('_PL') ? 'pl' : 'en';
    } else {
      this.currentLang = 'en';
    }

    this.initVariables();
    await this.loadActiveTemplate();
  }

  private initVariables(): void {
    const isGuest = this.resolvedTemplateType === EmailTemplateTypes.GUEST_INVITATION;

    this.variables = [
      { code: 'user', description: this.translate.instant('EMAIL_TEMPLATE.VARIABLES.USER') },
      { code: 'title', description: isGuest ? this.translate.instant('EMAIL_TEMPLATE.VARIABLES.PURPOSE') : this.translate.instant('EMAIL_TEMPLATE.VARIABLES.TITLE') },
      { code: 'detail', description: isGuest ? this.translate.instant('EMAIL_TEMPLATE.VARIABLES.EXPIRATION') : this.translate.instant('EMAIL_TEMPLATE.VARIABLES.DETAIL') },
      { code: 'url', description: this.translate.instant('EMAIL_TEMPLATE.VARIABLES.URL') },
      { code: 'message', description: this.translate.instant('EMAIL_TEMPLATE.VARIABLES.MESSAGE') }
    ];

    if (!isGuest) {
      this.variables.push(
        { code: 'requestId', description: this.translate.instant('EMAIL_TEMPLATE.VARIABLES.REQUEST_ID') },
        { code: 'status', description: this.translate.instant('EMAIL_TEMPLATE.VARIABLES.STATUS') }
      );
    }
  }

  public onSubjectChange(): void {
    if (this.isReadOnly) return;
    if (!this.templatesState[this.currentLang]) {
      this.templatesState[this.currentLang] = { subject: this.subject, content: this.content, isLoaded: true };
    } else {
      this.templatesState[this.currentLang]!.subject = this.subject;
    }
  }

  public onContentChange(): void {
    if (this.isReadOnly) return;
    if (!this.templatesState[this.currentLang]) {
      this.templatesState[this.currentLang] = { subject: this.subject, content: this.content, isLoaded: true };
    } else {
      this.templatesState[this.currentLang]!.content = this.content;
    }
    this.updatePreview();
  }

  public async onLangSegmentChange(event: any): Promise<void> {
    const newLang = event?.detail?.value as 'pl' | 'en';
    if (!newLang || newLang === this.currentLang) return;
    await this.switchLanguage(newLang);
  }

  public async switchLanguage(targetLang: 'pl' | 'en'): Promise<void> {
    const prevLang = this.currentLang;
    if (targetLang === prevLang) return;

    // Cache current form content into previous language state
    this.templatesState[prevLang] = {
      subject: this.subject,
      content: this.content,
      isLoaded: true
    };

    this.currentLang = targetLang;

    if (this.templatesState[targetLang]?.isLoaded) {
      this.subject = this.templatesState[targetLang]!.subject;
      this.content = this.templatesState[targetLang]!.content;
      this.updatePreview();
    } else {
      await this.loadActiveTemplate();
    }
  }

  public async loadActiveTemplate(): Promise<void> {
    const loading = await this.loadingCtrl.create({
      message: this.translate.instant('COMMON.LOADING')
    });
    await loading.present();
    try {
      const data = await this.configurationsService.getEmailTemplate(this.activeTemplateKey);
      this.subject = data.subject || '';
      this.content = data.content || '';
      this.templatesState[this.currentLang] = {
        subject: this.subject,
        content: this.content,
        isLoaded: true
      };
      this.updatePreview();
    } catch (err) {
      console.error('Failed to load email template', err);
      this.showToast(this.translate.instant('COMMON.SOMETHING_WENT_WRONG'), 'danger');
    } finally {
      await loading.dismiss();
    }
  }

  public updatePreview(): void {
    if (!this.content) {
      this.previewHtml = '';
      return;
    }

    const isEn = this.currentLang === 'en';
    const isGuest = this.resolvedTemplateType === EmailTemplateTypes.GUEST_INVITATION;

    const mockData: Record<string, string> = {
      user: this.app.currentUser?.getDisplayName() || (isEn ? 'John Smith' : 'Jan Kowalski'),
      title: isGuest ? (isEn ? 'Guest Speaker & Trainer' : 'Prelegent i trener') : (isEn ? 'Travel Reimbursement' : 'Zwrot kosztów podróży'),
      detail: isGuest ? '31.12.2026' : '250.00 PLN',
      url: isGuest ? 'https://finances.esn-poland.link/auth?guestToken=abc123xyz' : 'https://finances.esn-poland.link/t/requests/view/1/2026',
      message: isEn ? 'Reviewer note or additional comments.' : 'Uwagi weryfikującego lub dodatkowe informacje.',
      requestId: '1/2026',
      status: isEn ? 'APPROVED' : 'ZATWIERDZONY'
    };

    let rendered = this.content;
    for (const [k, v] of Object.entries(mockData)) {
      rendered = rendered.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), v);
    }
    rendered = rendered.replace(/{{\\s*#if\\s+message\\s*}}([\\s\\S]*?){{\\s*\/if\\s*}}/g, '$1');

    // Scope template styles that target 'body' so they also match .emailPreviewFrame
    rendered = rendered.replace(/(<style[^>]*>[\s\S]*?<\/style>)/gi, (styleBlock) => {
      return styleBlock.replace(/\bbody\s*\{/gi, '.emailPreviewFrame, body {');
    });

    this.previewHtml = this.sanitizer.bypassSecurityTrustHtml(rendered);
  }


  public hasFieldAnError(field: string): boolean {
    return this.errors.has(field);
  }

  public async save(): Promise<void> {
    if (this.isReadOnly) return;
    this.errors.clear();
    if (!this.subject?.trim()) this.errors.add('subject');
    if (!this.content?.trim()) this.errors.add('content');

    if (this.errors.size > 0) {
      this.showToast(this.translate.instant('COMMON.FORM_HAS_ERROR_TO_CHECK'), 'warning');
      return;
    }

    // Cache current active values
    this.templatesState[this.currentLang] = {
      subject: this.subject,
      content: this.content,
      isLoaded: true
    };

    const loading = await this.loadingCtrl.create({
      message: this.translate.instant('COMMON.SAVING')
    });
    await loading.present();

    try {
      // Save current active language template
      await this.configurationsService.setEmailTemplate(this.activeTemplateKey, this.subject, this.content);

      // If the other language was also loaded/modified in state, save it as well
      const otherLang = this.currentLang === 'pl' ? 'en' : 'pl';
      if (this.templatesState[otherLang]?.isLoaded) {
        const otherKey = getEmailTemplateKey(this.resolvedTemplateType, otherLang);
        await this.configurationsService.setEmailTemplate(
          otherKey,
          this.templatesState[otherLang]!.subject,
          this.templatesState[otherLang]!.content
        );
      }

      this.showToast(this.translate.instant('COMMON.OPERATION_COMPLETED'), 'success');
      this.modalCtrl.dismiss({ saved: true });
    } catch (err) {
      console.error('Failed to save email template', err);
      this.showToast(this.translate.instant('COMMON.OPERATION_FAILED'), 'danger');
    } finally {
      await loading.dismiss();
    }
  }

  public browseHTMLFile(): void {
    if (this.isReadOnly) return;
    document.getElementById('sesHtmlFileInput')?.click();
  }

  public async loadTemplateFromFile(inputEl: any): Promise<void> {
    if (this.isReadOnly) return;
    if (!inputEl?.files?.length) return;
    const file = inputEl.files[0];
    if (!file) return;

    const fileReader = new FileReader();
    fileReader.onerror = (): void => {
      this.showToast(this.translate.instant('COMMON.SOMETHING_WENT_WRONG'), 'danger');
    };
    fileReader.onload = (event: any) => {
      this.content = String(event.target.result || '');
      this.updatePreview();
      this.showToast(this.translate.instant('EMAIL_TEMPLATE.FILE_LOADED'), 'success');
    };
    fileReader.readAsText(file, 'utf-8');
  }

  public downloadTemplate(): void {
    if (!this.content) return;
    const filename = `notify-${this.resolvedTemplateType.toLowerCase().replace(/_/g, '-')}-${this.currentLang}.html`;
    const blob = new Blob([this.content], { type: 'text/html;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  public async askAndResetTemplate(): Promise<void> {
    if (this.isReadOnly) return;
    const alert = await this.alertCtrl.create({
      header: this.translate.instant('COMMON.ARE_YOU_SURE'),
      message: this.translate.instant('EMAIL_TEMPLATE.RESET_CONFIRM_MSG'),
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('COMMON.CONFIRM'),
          role: 'destructive',
          handler: async () => {
            const loading = await this.loadingCtrl.create({
              message: this.translate.instant('COMMON.LOADING')
            });
            await loading.present();
            try {
              await this.configurationsService.resetEmailTemplate(this.activeTemplateKey);
              if (this.templatesState[this.currentLang]) {
                delete this.templatesState[this.currentLang];
              }
              await this.loadActiveTemplate();
              this.showToast(this.translate.instant('COMMON.OPERATION_COMPLETED'), 'success');
            } catch (err) {
              console.error('Failed to reset template', err);
              this.showToast(this.translate.instant('COMMON.OPERATION_FAILED'), 'danger');
            } finally {
              await loading.dismiss();
            }
          }
        }
      ]
    });
    await alert.present();
  }

  public async askAndSendTestEmailWithCurrentTemplate(): Promise<void> {
    if (this.isReadOnly) return;
    const userEmail = this.app.currentUser?.email || '';
    const alert = await this.alertCtrl.create({
      header: this.translate.instant('EMAIL_TEMPLATE.TEST_TEMPLATE'),
      message: this.translate.instant('EMAIL_TEMPLATE.TEST_TEMPLATE_I', { email: userEmail }),
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('COMMON.SEND'),
          handler: async () => {
            const loading = await this.loadingCtrl.create({
              message: this.translate.instant('COMMON.SENDING')
            });
            await loading.present();
            try {
              await this.configurationsService.testEmailTemplate(this.activeTemplateKey);
              this.showToast(this.translate.instant('EMAIL_TEMPLATE.EMAIL_SENT'), 'success');
            } catch (err: any) {
              console.error('Test email failed', err);
              this.showToast(this.translate.instant('EMAIL_TEMPLATE.BAD_TEMPLATE'), 'danger');
            } finally {
              await loading.dismiss();
            }
          }
        }
      ]
    });
    await alert.present();
  }

  private async showToast(message: string, color: string): Promise<void> {
    const toast = await this.toastCtrl.create({
      message,
      duration: 3000,
      color,
      position: 'bottom'
    });
    await toast.present();
  }

  public close(): void {
    this.modalCtrl.dismiss();
  }
}
