import { LOCALE_ID, NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { RouteReuseStrategy } from '@angular/router';
import { registerLocaleData, DecimalPipe } from '@angular/common';
import localePl from '@angular/common/locales/pl';
import { HTTP_INTERCEPTORS, HttpBackend, HttpClient, HttpClientModule } from '@angular/common/http';

import { IonicModule, IonicRouteStrategy } from '@ionic/angular';
import { IonicStorageModule } from '@ionic/storage-angular';
import { TranslateLoader, TranslateModule } from '@ngx-translate/core';
import { TranslateHttpLoader } from '@ngx-translate/http-loader';

import { AppComponent } from './app.component';
import { AppRoutingModule } from './app.routing.module';
import { AuthInterceptor } from './auth.interceptor';
import { AppService } from './app.service';

registerLocaleData(localePl, 'pl');

// Configure DecimalPipe to re-evaluate dynamically on locale/language change without page reload
if ((DecimalPipe as any).ɵpipe) {
  (DecimalPipe as any).ɵpipe.pure = false;
}
const origDecimalTransform = DecimalPipe.prototype.transform;
DecimalPipe.prototype.transform = function (this: any, value: any, digitsInfo?: string, locale?: string) {
  const effectiveLocale = String(locale || this._locale || '');
  if (
    this._cachedValue === value &&
    this._cachedDigitsInfo === digitsInfo &&
    this._cachedLocale === effectiveLocale
  ) {
    return this._cachedResult;
  }
  const result = origDecimalTransform.call(this, value, digitsInfo, locale);
  this._cachedValue = value;
  this._cachedDigitsInfo = digitsInfo;
  this._cachedLocale = effectiveLocale;
  this._cachedResult = result;
  return result;
};

class DynamicLocale extends String {
  constructor(private appService: AppService) {
    super('en');
  }
  override toLowerCase(): string {
    return this.appService.numberFormatLocale.toLowerCase();
  }
  override toUpperCase(): string {
    return this.appService.numberFormatLocale.toUpperCase();
  }
  override replace(searchValue: any, replaceValue: any): string {
    return this.appService.numberFormatLocale.replace(searchValue, replaceValue);
  }
  override toString(): string {
    return this.appService.numberFormatLocale;
  }
  override valueOf(): string {
    return this.appService.numberFormatLocale;
  }
  override charAt(pos: number): string {
    return this.appService.numberFormatLocale.charAt(pos);
  }
  override slice(start?: number, end?: number): string {
    return this.appService.numberFormatLocale.slice(start, end);
  }
  override substring(start: number, end?: number): string {
    return this.appService.numberFormatLocale.substring(start, end);
  }
  override split(separator: any, limit?: number): string[] {
    return this.appService.numberFormatLocale.split(separator, limit);
  }
  override indexOf(searchString: string, position?: number): number {
    return this.appService.numberFormatLocale.indexOf(searchString, position);
  }
  override startsWith(searchString: string, position?: number): boolean {
    return this.appService.numberFormatLocale.startsWith(searchString, position);
  }
  override endsWith(searchString: string, position?: number): boolean {
    return this.appService.numberFormatLocale.endsWith(searchString, position);
  }
  override includes(searchString: string, position?: number): boolean {
    return this.appService.numberFormatLocale.includes(searchString, position);
  }
  override trim(): string {
    return this.appService.numberFormatLocale.trim();
  }
  [Symbol.toPrimitive](_hint: string): string {
    return this.appService.numberFormatLocale;
  }
}

export function createTranslateLoader(handler: HttpBackend) {
  return new TranslateHttpLoader(new HttpClient(handler), './assets/i18n/', '.json');
}

@NgModule({
  declarations: [AppComponent],
  imports: [
    BrowserModule,
    HttpClientModule,
    IonicModule.forRoot({
      mode: 'md'
    }),
    IonicStorageModule.forRoot({
      name: 'esn-finances'
    }),
    TranslateModule.forRoot({
      loader: {
        provide: TranslateLoader,
        useFactory: createTranslateLoader,
        deps: [HttpBackend]
      },
      defaultLanguage: 'en'
    }),
    AppRoutingModule
  ],
  providers: [
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    { provide: HTTP_INTERCEPTORS, useClass: AuthInterceptor, multi: true },
    {
      provide: LOCALE_ID,
      useFactory: (app: AppService) => new DynamicLocale(app),
      deps: [AppService]
    }
  ],
  bootstrap: [AppComponent]
})
export class AppModule {}
