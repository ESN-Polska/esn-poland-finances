import { Component, Input, OnInit, inject } from '@angular/core';
import { ModalController, ToastController, LoadingController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { FinancesService } from '../../../../services/finances.service';
import { AppService } from '../../../../app.service';
import { BankTransactionRecord } from '@models/cashflow-transaction.model';

@Component({
  selector: 'app-csv-import-modal',
  templateUrl: './csv-import-modal.component.html',
  styleUrls: ['./csv-import-modal.component.scss']
})
export class CsvImportModalComponent implements OnInit {
  private modalCtrl = inject(ModalController);
  private toastCtrl = inject(ToastController);
  private loadingCtrl = inject(LoadingController);
  private financesService = inject(FinancesService);
  private translate = inject(TranslateService);
  public app = inject(AppService);

  @Input() year!: number;
  @Input() scheme?: string;

  selectedFile: File | null = null;
  rawCsvText: string = '';
  selectedScheme: string = 'ERSTE_BANK_POLSKA';
  parsedTransactions: BankTransactionRecord[] = [];
  parsing: boolean = false;
  fileName: string = '';

  ngOnInit(): void {
    this.selectedScheme =
      this.scheme ||
      this.app.configurations?.financesConfig?.csvImportScheme ||
      'ERSTE_BANK_POLSKA';
  }

  close(): void {
    this.modalCtrl.dismiss();
  }

  async onFileSelected(event: any): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) return;

    this.selectedFile = file;
    this.fileName = file.name;
    this.parsing = true;

    try {
      const buffer = await file.arrayBuffer();
      let text = '';
      try {
        // 1. Try UTF-8 with strict validation first
        const decoderUtf8 = new TextDecoder('utf-8', { fatal: true });
        text = decoderUtf8.decode(buffer);
      } catch {
        // 2. If invalid UTF-8 bytes encountered, fallback to Windows-1250 or ISO-8859-2
        try {
          const decoder1250 = new TextDecoder('windows-1250', { fatal: true });
          text = decoder1250.decode(buffer);
        } catch {
          const decoderIso = new TextDecoder('iso-8859-2');
          text = decoderIso.decode(buffer);
        }
      }
      text = text.replace(/^\uFEFF/, '');
      text = BankTransactionRecord.fixPolishMojibake(text);

      this.rawCsvText = text;
      this.parseTransactionsCsv(text, this.selectedScheme);
    } catch (err: any) {
      console.error('CSV parse error', err);
      const toast = await this.toastCtrl.create({
        message: this.translate.instant('FINANCES.MODALS.CSV_IMPORT.PARSE_ERROR', { error: err?.message || '' }),
        duration: 4000,
        color: 'danger'
      });
      await toast.present();
    } finally {
      this.parsing = false;
    }
  }

  onSchemeChanged(): void {
    if (this.rawCsvText) {
      this.parseTransactionsCsv(this.rawCsvText, this.selectedScheme);
    }
  }

  private parseCsvRows(text: string): string[][] {
    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentField = '';
    let inQuotes = false;

    // Detect delimiter from first non-empty line
    const firstLine = text.split(/\r?\n/).find((l) => l.trim().length > 0) || '';
    const commaCount = (firstLine.match(/,/g) || []).length;
    const semiCount = (firstLine.match(/;/g) || []).length;
    const delimiter = semiCount > commaCount ? ';' : ',';

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const nextChar = text[i + 1];

      if (inQuotes) {
        if (char === '"' && nextChar === '"') {
          currentField += '"';
          i++; // skip escaped quote
        } else if (char === '"') {
          inQuotes = false;
        } else {
          currentField += char;
        }
      } else {
        if (char === '"') {
          inQuotes = true;
        } else if (char === delimiter) {
          currentRow.push(currentField.trim());
          currentField = '';
        } else if (char === '\r') {
          if (nextChar === '\n') {
            i++;
          }
          currentRow.push(currentField.trim());
          if (currentRow.some((c) => c.length > 0)) {
            rows.push(currentRow);
          }
          currentRow = [];
          currentField = '';
        } else if (char === '\n') {
          currentRow.push(currentField.trim());
          if (currentRow.some((c) => c.length > 0)) {
            rows.push(currentRow);
          }
          currentRow = [];
          currentField = '';
        } else {
          currentField += char;
        }
      }
    }

    if (currentField.length > 0 || currentRow.length > 0) {
      currentRow.push(currentField.trim());
      if (currentRow.some((c) => c.length > 0)) {
        rows.push(currentRow);
      }
    }

    return rows;
  }

  private parseDateToIso(dateStr: string): string {
    if (!dateStr) return '';
    const clean = dateStr.trim();
    // DD-MM-YYYY or DD.MM.YYYY or DD/MM/YYYY
    const dmy = clean.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{4})$/);
    if (dmy) {
      const d = dmy[1].padStart(2, '0');
      const m = dmy[2].padStart(2, '0');
      const y = dmy[3];
      return `${y}-${m}-${d}`;
    }
    // YYYY-MM-DD
    const ymd = clean.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/);
    if (ymd) {
      const y = ymd[1];
      const m = ymd[2].padStart(2, '0');
      const d = ymd[3].padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    return clean;
  }

  private parseAmountValue(amountStr: string): number {
    if (!amountStr) return 0;
    const clean = amountStr.replace(/^["']|["']$/g, '').replace(/[\s\u00A0]/g, '').replace(',', '.');
    const val = parseFloat(clean);
    return isNaN(val) ? 0 : val;
  }

  private isErsteBankFormat(rows: string[][]): boolean {
    if (rows.length < 2) return false;
    const r0 = rows[0];
    if (r0.length >= 5) {
      const col2Clean = (r0[2] || '').replace(/^['"]/, '').replace(/\s+/g, '');
      const col4Clean = (r0[4] || '').toUpperCase();
      if (
        (col4Clean === 'PLN' || col4Clean === 'EUR') &&
        (/^\d{26}$/.test(col2Clean) || /^[A-Z]{2}\d+/.test(col2Clean) || col2Clean.length >= 16)
      ) {
        return true;
      }
    }
    return false;
  }

  private parseErsteBankPolska(rows: string[][]): BankTransactionRecord[] {
    const txs: BankTransactionRecord[] = [];
    if (rows.length < 2) return txs;

    const r0 = rows[0];
    const isStatementHeader = this.isErsteBankFormat(rows);
    let accountIban = '';
    let fileCurrency: 'PLN' | 'EUR' = 'PLN';
    let startIndex = 1;

    if (isStatementHeader) {
      accountIban = (r0[2] || '').replace(/^['"]/, '').trim();
      fileCurrency = (r0[4] || '').toUpperCase() === 'EUR' ? 'EUR' : 'PLN';
      startIndex = 1;
    } else {
      const firstCol = (r0[0] || '').toLowerCase();
      if (/data|date|ksi[eę]gow|booking/i.test(firstCol)) {
        startIndex = 1;
      } else {
        startIndex = 0;
      }
    }

    for (let i = startIndex; i < rows.length; i++) {
      const row = rows[i];
      if (row.length < 6) continue;

      const rawBooking = row[0];
      const rawOperation = row[1] || rawBooking;
      const bookingDate = this.parseDateToIso(rawBooking);
      const operationDate = this.parseDateToIso(rawOperation) || bookingDate;
      if (!bookingDate) continue;

      const transferTitle = BankTransactionRecord.fixPolishMojibake(row[2] || '').trim();
      const partyName = BankTransactionRecord.fixPolishMojibake(row[3] || '').trim();
      const partyAccount = (row[4] || '').replace(/^['"]/, '').trim();
      const amount = this.parseAmountValue(row[5]);
      const balanceAfter = this.parseAmountValue(row[6]);
      const statementSequenceNumber = parseInt(row[7], 10) || 0;
      const txYear = parseInt(bookingDate.split('-')[0], 10) || this.year;

      const record = new BankTransactionRecord({
        bookingDate,
        operationDate,
        transferTitle,
        partyName,
        partyAccount,
        amount,
        direction: amount >= 0 ? 'INFLOW' : 'OUTFLOW',
        currency: fileCurrency,
        balanceAfter,
        statementSequenceNumber,
        accountIban,
        year: txYear,
        reconciliationStatus: 'UNLINKED',
        settlements: []
      });

      txs.push(record);
    }

    return txs;
  }

  private parseGenericCsv(rows: string[][]): BankTransactionRecord[] {
    const txs: BankTransactionRecord[] = [];
    if (rows.length < 2) return txs;

    const r0 = rows[0].map((h) => h.toLowerCase());
    let dateIdx = r0.findIndex((h) => /data\s*ksi[eę]gowania|booking\s*date|^data$|^date$/i.test(h));
    let opDateIdx = r0.findIndex((h) => /data\s*operacji|data\s*waluty|value\s*date|operation\s*date/i.test(h));
    let titleIdx = r0.findIndex((h) => /tytu[lł]|title|opis|description/i.test(h));
    let partyIdx = r0.findIndex((h) => /odbiorca|nadawca|kontrahent|party|counterparty|nazwa/i.test(h));
    let accountIdx = r0.findIndex((h) => /rachunek|konto|party\s*account/i.test(h));
    let amountIdx = r0.findIndex((h) => /kwota|amount|warto[sś][cć]/i.test(h));
    let currencyIdx = r0.findIndex((h) => /waluta|currency/i.test(h));
    let balanceIdx = r0.findIndex((h) => /saldo|balance/i.test(h));

    const isHeaderRow = dateIdx !== -1 || amountIdx !== -1 || titleIdx !== -1;
    const startRow = isHeaderRow ? 1 : 0;
    if (dateIdx === -1) dateIdx = 0;
    if (opDateIdx === -1) opDateIdx = 1;
    if (partyIdx === -1) partyIdx = 2;
    if (titleIdx === -1) titleIdx = 3;
    if (amountIdx === -1) amountIdx = 4;
    if (currencyIdx === -1) currencyIdx = 5;
    if (balanceIdx === -1) balanceIdx = 6;

    for (let i = startRow; i < rows.length; i++) {
      const row = rows[i];
      if (row.length <= Math.max(dateIdx, amountIdx)) continue;

      const bookingDate = this.parseDateToIso(row[dateIdx]);
      if (!bookingDate) continue;

      const operationDate = opDateIdx !== -1 && row[opDateIdx] ? this.parseDateToIso(row[opDateIdx]) : bookingDate;
      const transferTitle = titleIdx !== -1 ? BankTransactionRecord.fixPolishMojibake(row[titleIdx] || '').trim() : '';
      const partyName = partyIdx !== -1 ? BankTransactionRecord.fixPolishMojibake(row[partyIdx] || '').trim() : '';
      const partyAccount = accountIdx !== -1 ? (row[accountIdx] || '').replace(/^['"]/, '').trim() : '';
      const amount = this.parseAmountValue(row[amountIdx]);
      const currency = currencyIdx !== -1 && row[currencyIdx]?.toUpperCase() === 'EUR' ? 'EUR' : 'PLN';
      const balanceAfter = balanceIdx !== -1 ? this.parseAmountValue(row[balanceIdx]) : 0;
      const txYear = parseInt(bookingDate.split('-')[0], 10) || this.year;

      const record = new BankTransactionRecord({
        bookingDate,
        operationDate,
        transferTitle,
        partyName,
        partyAccount,
        amount,
        direction: amount >= 0 ? 'INFLOW' : 'OUTFLOW',
        currency,
        balanceAfter,
        year: txYear,
        reconciliationStatus: 'UNLINKED',
        settlements: []
      });

      txs.push(record);
    }

    return txs;
  }

  private parseTransactionsCsv(csvText: string, scheme: string = this.selectedScheme): void {
    const rows = this.parseCsvRows(csvText);
    if (rows.length < 2) {
      this.parsedTransactions = [];
      return;
    }

    let txs: BankTransactionRecord[] = [];
    if (scheme === 'ERSTE_BANK_POLSKA') {
      txs = this.parseErsteBankPolska(rows);
      if (txs.length === 0) {
        txs = this.parseGenericCsv(rows);
      }
    } else {
      txs = this.parseGenericCsv(rows);
      if (txs.length === 0) {
        txs = this.parseErsteBankPolska(rows);
      }
    }

    this.parsedTransactions = txs;
  }

  async importData(): Promise<void> {
    if (this.parsedTransactions.length === 0) return;

    const loading = await this.loadingCtrl.create({
      message: this.translate.instant('FINANCES.MODALS.CSV_IMPORT.IMPORTING', { count: this.parsedTransactions.length })
    });
    await loading.present();

    try {
      const res = await this.financesService.importTransactions(this.year, this.parsedTransactions);
      await loading.dismiss();

      this.modalCtrl.dismiss({
        imported: res.imported,
        duplicates: res.duplicates
      });

      const toast = await this.toastCtrl.create({
        message: this.translate.instant('FINANCES.MODALS.CSV_IMPORT.IMPORT_SUCCESS', {
          imported: res.imported,
          duplicates: res.duplicates
        }),
        duration: 4000,
        color: 'success'
      });
      await toast.present();
    } catch (err: any) {
      await loading.dismiss();
      const toast = await this.toastCtrl.create({
        message: err?.message || this.translate.instant('FINANCES.MODALS.CSV_IMPORT.IMPORT_ERROR'),
        duration: 4000,
        color: 'danger'
      });
      await toast.present();
    }
  }
}
