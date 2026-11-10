import { AnnualBudget, DynamicBudgetCategory, DynamicBudgetGroup, BudgetLineItem, BudgetAmendmentItem, isBudgetGroup, isBudgetLine } from '@models/annual-budget.model';
import { DateFormatOption, DEFAULT_DATE_FORMAT } from '@models/configurations.model';
import { formatFinanceAmount } from '../../../../utils/number-utils';
import { formatDateOption } from '../../../../utils/date-utils';

export type BudgetExportType = 'BUDGET' | 'EXECUTION' | 'DOC_B' | 'DOC_A';
export type BudgetExportFormat = 'PDF' | 'EXCEL';
export type BudgetExportLanguage = 'pl' | 'en' | 'both';

export interface CurrentBankBalances {
  bankPln: number;
  bankEur: number;
  bankEurInPln: number;
  termDepositsPln: number;
  totalFunds: number;
  lastBookingDate?: string | null;
  eurExchangeRate?: number;
  eurExchangeDate?: string;
}

/**
 * Fetches EUR/PLN average exchange rate from NBP for the given target date (e.g. last day of execution),
 * or the last possible working day before that day if not available (weekend, holiday, future, before publishing time).
 */
export async function fetchNbpEurRateOnOrBefore(targetDate?: string | Date): Promise<{ rate: number; date: string } | null> {
  const now = new Date();
  let dateObj: Date;

  if (typeof targetDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(targetDate.trim())) {
    const [y, m, d] = targetDate.trim().split('-').map(Number);
    dateObj = new Date(y, m - 1, d, 12, 0, 0);
  } else if (targetDate instanceof Date && !isNaN(targetDate.getTime())) {
    dateObj = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 12, 0, 0);
  } else {
    dateObj = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
  }

  // If target date is strictly in the future compared to today, cap at today
  const todayNoon = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
  if (dateObj > todayNoon) {
    dateObj = todayNoon;
  }

  // If initial target date falls on Saturday or Sunday, move back to Friday
  while (dateObj.getDay() === 0 || dateObj.getDay() === 6) {
    dateObj.setDate(dateObj.getDate() - 1);
  }

  let attempts = 0;
  while (attempts < 15) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    const dateStr = `${y}-${m}-${d}`;

    try {
      const response = await fetch(`https://api.nbp.pl/api/exchangerates/rates/A/EUR/${dateStr}?format=JSON`);
      if (response.ok) {
        const data = await response.json();
        if (data && data.rates && data.rates[0]) {
          return {
            rate: data.rates[0].mid,
            date: dateStr
          };
        }
      }
    } catch (err) {
      // ignore network errors
    }

    // Move to previous day and skip weekend
    dateObj.setDate(dateObj.getDate() - 1);
    while (dateObj.getDay() === 0 || dateObj.getDay() === 6) {
      dateObj.setDate(dateObj.getDate() - 1);
    }
    attempts++;
  }
  return null;
}

/**
 * Fetches EUR/PLN average exchange rate from NBP for the last working day before today.
 */
export async function fetchNbpEurRateBeforeToday(): Promise<{ rate: number; date: string } | null> {
  const today = new Date();
  const dateObj = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1, 12, 0, 0);
  return fetchNbpEurRateOnOrBefore(dateObj);
}

export function computeCurrentBankBalances(
  budget: AnnualBudget | null | undefined,
  txs?: any[],
  deposits?: any[],
  currentEurRate?: { rate: number; date: string } | null,
  asOfDate?: string
): CurrentBankBalances {
  const op = budget?.openingBalances || {};
  const startPln = op.bankPln || op.bankPlnStartingBalance || 0;
  const startEur = op.bankEurStartingBalance || 0;
  const eurRate = currentEurRate?.rate || op.eurExchangeRate || 1;
  const eurDate = currentEurRate?.date || op.eurExchangeDate || '';
  const startDeposits = op.termDepositsPln || op.termDepositsStartingBalance || 0;

  let txList = Array.isArray(txs) ? [...txs] : [];

  if (asOfDate) {
    txList = txList.filter((t) => {
      const d = t.bookingDate || t.operationDate || '';
      return !d || d <= asOfDate;
    });
  }

  const sortedTxs = txList.sort((a, b) => {
    const dateA = a.bookingDate || a.operationDate || '';
    const dateB = b.bookingDate || b.operationDate || '';
    const dateCmp = dateA.localeCompare(dateB);
    if (dateCmp !== 0) return dateCmp;
    return (b.statementSequenceNumber || 0) - (a.statementSequenceNumber || 0);
  });

  const plnTxs = sortedTxs.filter((t) => (t.currency || 'PLN').toUpperCase() === 'PLN');
  const eurTxs = sortedTxs.filter((t) => (t.currency || 'PLN').toUpperCase() === 'EUR');

  let currentBankPln = startPln;
  if (plnTxs.length > 0) {
    const lastPln = plnTxs[plnTxs.length - 1];
    if (lastPln.balanceAfter !== undefined && lastPln.balanceAfter !== null && !isNaN(Number(lastPln.balanceAfter))) {
      currentBankPln = Number(lastPln.balanceAfter);
    } else {
      const sum = plnTxs.reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
      currentBankPln = Math.round((startPln + sum) * 100) / 100;
    }
  }

  let currentBankEur = startEur;
  if (eurTxs.length > 0) {
    const lastEur = eurTxs[eurTxs.length - 1];
    if (lastEur.balanceAfter !== undefined && lastEur.balanceAfter !== null && !isNaN(Number(lastEur.balanceAfter))) {
      currentBankEur = Number(lastEur.balanceAfter);
    } else {
      const sum = eurTxs.reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
      currentBankEur = Math.round((startEur + sum) * 100) / 100;
    }
  }

  const currentBankEurInPln = Math.round(currentBankEur * eurRate * 100) / 100;

  let currentTermDeposits = startDeposits;
  if (Array.isArray(deposits) && deposits.length > 0) {
    currentTermDeposits = deposits.reduce((sum, d) => sum + (Number(d.principalAmount) || 0), 0);
  }

  const totalFunds = Math.round((currentBankPln + currentBankEurInPln + currentTermDeposits) * 100) / 100;

  let lastBookingDate: string | null = null;
  if (sortedTxs.length > 0) {
    const latestTx = [...sortedTxs].sort((a, b) => (b.bookingDate || '').localeCompare(a.bookingDate || ''))[0];
    lastBookingDate = latestTx.bookingDate || null;
  }

  return {
    bankPln: currentBankPln,
    bankEur: currentBankEur,
    bankEurInPln: currentBankEurInPln,
    termDepositsPln: currentTermDeposits,
    totalFunds,
    lastBookingDate,
    eurExchangeRate: eurRate,
    eurExchangeDate: eurDate
  };
}

/**
 * Escapes text for European Excel CSV (semicolon delimiter).
 */
function escapeCsv(val: any): string {
  if (val === null || val === undefined) return '""';
  const str = String(val).replace(/"/g, '""').replace(/[\r\n]+/g, ' ');
  return `"${str}"`;
}

/**
 * Escapes text for HTML content.
 */
function escapeHtml(val: any): string {
  if (val === null || val === undefined) return '';
  return String(val)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Formats a number with European comma separator (e.g. 1250,50) for Excel.
 */
function formatNumber(val: number | undefined | null): string {
  if (val === null || val === undefined || isNaN(val)) return '0,00';
  return val.toFixed(2).replace('.', ',');
}

/**
 * Retrieves localized text or string according to the selected language.
 */
function getLangText(val: any, lang: BudgetExportLanguage = 'pl'): string {
  if (!val) return '';
  if (typeof val === 'string') return val;
  if (lang === 'en') {
    return val.en || val.pl || '';
  }
  if (lang === 'both') {
    const pl = val.pl || '';
    const en = val.en || '';
    if (pl && en && pl !== en) {
      return `${pl} / ${en}`;
    }
    return pl || en || '';
  }
  return val.pl || val.en || '';
}

/**
 * Formats budget status with proper Polish / English translation.
 * DRAFT -> PROJEKT
 * ADOPTED / ACTIVE -> UCHWALONY
 * AMENDED / CHANGED / AMENDING -> ZMIENIONY
 */
export function formatBudgetStatus(status: string | undefined, lang: BudgetExportLanguage = 'pl'): string {
  const s = (status || 'DRAFT').toUpperCase();
  const plMap: Record<string, string> = {
    DRAFT: 'PROJEKT',
    ADOPTED: 'UCHWALONY',
    AMENDED: 'ZMIENIONY',
    ARCHIVED: 'ZARCHIWIZOWANY'
  };
  const enMap: Record<string, string> = {
    DRAFT: 'DRAFT',
    ADOPTED: 'ADOPTED',
    AMENDED: 'AMENDED',
    ARCHIVED: 'ARCHIVED'
  };

  const plText = plMap[s] || s;
  const enText = enMap[s] || s;

  if (lang === 'en') {
    return enText;
  }
  if (lang === 'both') {
    return `${plText} / ${enText}`;
  }
  return plText;
}

/**
 * Formats a date string into the chosen date format (default: DD.MM.YYYY)
 */
export function formatResolutionDate(dateStr?: string, dateFormat: DateFormatOption = DEFAULT_DATE_FORMAT): string {
  if (!dateStr) return '';
  return formatDateOption(dateStr, dateFormat);
}

/**
 * Formats resolution number and date for export and display according to language.
 * Examples:
 * pl: "Uchwała WZD 19/26 z dnia 21.09.2026"
 * en: "NA Resolution 19/26 of 21.09.2026"
 * both: "Uchwała WZD / NA Resolution 19/26 z dnia / of 21.09.2026"
 */
export function formatResolutionString(
  resolutionNumber?: string,
  adoptedDate?: string,
  lang: BudgetExportLanguage = 'pl',
  dateFormat: DateFormatOption = DEFAULT_DATE_FORMAT
): string {
  if (!resolutionNumber) return '';
  const formattedDate = formatResolutionDate(adoptedDate, dateFormat);
  const isEn = lang === 'en';
  const isBoth = lang === 'both';

  const prefix = isEn
    ? 'NA Resolution '
    : isBoth
    ? 'Uchwała WZD / NA Resolution '
    : 'Uchwała WZD ';

  let datePart = '';
  if (formattedDate) {
    if (isEn) {
      datePart = ` of ${formattedDate}`;
    } else if (isBoth) {
      datePart = ` z dnia / of ${formattedDate}`;
    } else {
      datePart = ` z dnia ${formattedDate}`;
    }
  }

  return `${prefix}${resolutionNumber}${datePart}`;
}

/**
 * Generates CSV content and appropriate filename for the specified budget, export type, and language.
 */
export function generateBudgetCsvContent(
  budget: AnnualBudget,
  type: BudgetExportType,
  asOfDate?: string,
  lang: BudgetExportLanguage = 'pl',
  calculationMode: 'NET' | 'GROSS' = 'NET',
  numberDisplayFormat: 'STANDARD' | 'ACCOUNTING' = 'STANDARD',
  currentBalances?: CurrentBankBalances,
  dateFormat: DateFormatOption = DEFAULT_DATE_FORMAT,
  budgetOrgName?: { en?: string; pl?: string }
): { content: string; filename: string } {
  const yr = budget.year || new Date().getFullYear();
  const rawDateStr = asOfDate || new Date().toISOString().split('T')[0];
  const dateStr = formatDateOption(rawDateStr, dateFormat);
  const delim = ';';
  const lines: string[] = [];

  const formatVar = (val: number | undefined | null) => {
    if (numberDisplayFormat === 'ACCOUNTING') {
      return formatFinanceAmount(val || 0, 'ACCOUNTING', { locale: lang === 'en' ? 'en' : 'pl' });
    }
    return formatNumber(val);
  };

  const prefix = '\uFEFF'; // UTF-8 BOM for Microsoft Excel

  const isEn = lang === 'en';
  const isBoth = lang === 'both';

  const typeRev = isEn ? 'Revenue' : isBoth ? 'Przychody / Revenue' : 'Przychody';
  const typeExp = isEn ? 'Expense' : isBoth ? 'Koszty / Expense' : 'Koszty';

  const isGross = calculationMode === 'GROSS';
  const modeSuffixPl = isGross ? '(kwoty brutto)' : '(kwoty netto)';
  const modeSuffixEn = isGross ? '(gross amounts)' : '(net amounts)';

  const orgPl = budgetOrgName?.pl?.trim() || 'ESN Polska';
  const orgEn = budgetOrgName?.en?.trim() || 'ESN Poland';

  if (type === 'EXECUTION') {
    const docTitle = isEn
      ? `${orgEn.toUpperCase()} BUDGET EXECUTION ${yr} ${modeSuffixEn.toUpperCase()}`
      : isBoth
      ? `WYKONANIE BUDŻETU ${orgPl.toUpperCase()} ${yr} ${modeSuffixPl.toUpperCase()} / ${orgEn.toUpperCase()} BUDGET EXECUTION`
      : `Wykonanie budżetu ${orgPl} ${yr} ${modeSuffixPl}`;
    const dateLabel = isEn ? `Execution date: ${dateStr}` : isBoth ? `Dzień wykonania / Execution date: ${dateStr}` : `Dzień wykonania: ${dateStr}`;
    const statusVal = formatBudgetStatus(budget.status, lang);
    const statusLabel = isEn ? `Budget status: ${statusVal}` : isBoth ? `Status budżetu / Budget status: ${statusVal}` : `Status budżetu: ${statusVal}`;

    lines.push(escapeCsv(docTitle));
    lines.push(escapeCsv(dateLabel));
    lines.push(escapeCsv(statusLabel));
    if (budget.resolutionNumber) {
      lines.push(escapeCsv(formatResolutionString(budget.resolutionNumber, budget.adoptedDate, lang, dateFormat)));
    }
    lines.push(escapeCsv('Waluta / Currency: PLN'));
    lines.push('');

    // Headers
    if (isEn) {
      lines.push([
        escapeCsv('Type'),
        escapeCsv('Category'),
        escapeCsv('Group'),
        escapeCsv('Code'),
        escapeCsv('Line'),
        escapeCsv('Budgeted amount [PLN]'),
        escapeCsv(`Execution as of ${dateStr} [PLN]`),
        escapeCsv('Variance [PLN]'),
        escapeCsv('% Executed'),
        escapeCsv('Description')
      ].join(delim));
    } else if (isBoth) {
      lines.push([
        escapeCsv('Typ / Type'),
        escapeCsv('Kategoria / Category'),
        escapeCsv('Grupa / Group'),
        escapeCsv('Kod / Code'),
        escapeCsv('Linia / Line'),
        escapeCsv('Kwota zabudżetowana / Budgeted [PLN]'),
        escapeCsv(`Wykonanie na dzień ${dateStr} / Actual [PLN]`),
        escapeCsv('Odchylenie / Variance [PLN]'),
        escapeCsv('% Wykonania / % Executed'),
        escapeCsv('Opis / Description')
      ].join(delim));
    } else {
      lines.push([
        escapeCsv('Typ'),
        escapeCsv('Kategoria'),
        escapeCsv('Grupa'),
        escapeCsv('Kod'),
        escapeCsv('Linia'),
        escapeCsv('Kwota zabudżetowana [PLN]'),
        escapeCsv(`Wykonanie na dzień ${dateStr} [PLN]`),
        escapeCsv('Odchylenie [PLN]'),
        escapeCsv('% Wykonania'),
        escapeCsv('Opis')
      ].join(delim));
    }

    const categories = budget.categories || [];
    const processItems = (items: (DynamicBudgetGroup | BudgetLineItem)[], catNum: number, catName: string, secType: string, groupPath: string) => {
      for (const it of items || []) {
        if (isBudgetLine(it)) {
          const budgeted = it.budgetedAmount || 0;
          const actual = it.actualAmount || 0;
          const variance = it.variance ?? (actual - budgeted);
          const percent = budgeted !== 0 ? ((actual / budgeted) * 100).toFixed(1).replace('.', ',') + '%' : '0,0%';

          lines.push([
            escapeCsv(secType),
            escapeCsv(`${catNum}. ${catName}`),
            escapeCsv(groupPath),
            escapeCsv(it.code || ''),
            escapeCsv(getLangText(it.name, lang)),
            formatNumber(budgeted),
            formatNumber(actual),
            formatVar(variance),
            percent,
            escapeCsv(getLangText(it.description, lang))
          ].join(delim));
        } else if (isBudgetGroup(it)) {
          const grpLabel = getLangText(it.name, lang);
          const currentPath = groupPath ? `${groupPath} > ${grpLabel}` : grpLabel;
          processItems(it.items || [], catNum, catName, secType, currentPath);
        }
      }
    };

    for (let cIdx = 0; cIdx < categories.length; cIdx++) {
      const cat = categories[cIdx];
      const catNum = cat.number || (cIdx + 1);
      const catName = getLangText(cat.name, lang);

      if (cat.revenues && cat.revenues.enabled !== false && Array.isArray(cat.revenues.items)) {
        processItems(cat.revenues.items, catNum, catName, typeRev, '');
      }
      if (cat.expenses && cat.expenses.enabled !== false && Array.isArray(cat.expenses.items)) {
        processItems(cat.expenses.items, catNum, catName, typeExp, '');
      }

      // Category Net Result row
      const catNetPlan = cat.plannedNetResult ?? ((cat.totalPlannedRevenue || 0) - (cat.totalPlannedExpense || 0));
      const catNetAct = cat.actualNetResult ?? ((cat.totalActualRevenue || 0) - (cat.totalActualExpense || 0));
      const catNetVar = catNetAct - catNetPlan;
      const catNetPct = catNetPlan !== 0 ? ((catNetAct / catNetPlan) * 100).toFixed(1).replace('.', ',') + '%' : '—';

      const sumLabel = isEn ? `RESULT: ${catNum}. ${catName}` : isBoth ? `WYNIK / RESULT: ${catNum}. ${catName}` : `WYNIK: ${catNum}. ${catName}`;
      lines.push([
        escapeCsv(sumLabel),
        escapeCsv(`${catNum}. ${catName}`),
        escapeCsv(''),
        escapeCsv(''),
        escapeCsv(''),
        formatNumber(catNetPlan),
        formatNumber(catNetAct),
        formatVar(catNetVar),
        catNetPct,
        escapeCsv(getLangText(cat.categoryResultExplanation, lang))
      ].join(delim));
    }

    // Grand Totals
    lines.push('');
    const summaryTitle = isEn ? 'FINANCIAL SUMMARY' : isBoth ? 'PODSUMOWANIE FINANSOWE / FINANCIAL SUMMARY' : 'PODSUMOWANIE FINANSOWE';
    const totalRevLabel = isEn ? 'Total Revenue' : isBoth ? 'Łączne przychody / Total Revenue' : 'Łączne przychody';
    const totalExpLabel = isEn ? 'Total Expense' : isBoth ? 'Łączne koszty / Total Expense' : 'Łączne koszty';
    const netResultLabel = isEn
      ? (isGross ? 'Gross Financial Result (Revenue - Expense)' : 'Net Financial Result (Revenue - Expense)')
      : isBoth
      ? (isGross ? 'Wynik finansowy brutto / Gross Result' : 'Wynik finansowy netto / Net Result')
      : (isGross ? 'Wynik finansowy brutto (Przychody - Koszty)' : 'Wynik finansowy netto (Przychody - Koszty)');

    lines.push(escapeCsv(summaryTitle));
    lines.push([
      escapeCsv(totalRevLabel),
      '', '', '', '',
      formatNumber(budget.totalBudgetedRevenue || 0),
      formatNumber(budget.totalActualRevenue || 0),
      formatVar((budget.totalActualRevenue || 0) - (budget.totalBudgetedRevenue || 0)),
      (budget.totalBudgetedRevenue ? (((budget.totalActualRevenue || 0) / budget.totalBudgetedRevenue) * 100).toFixed(1).replace('.', ',') + '%' : '0,0%'),
      ''
    ].join(delim));

    lines.push([
      escapeCsv(totalExpLabel),
      '', '', '', '',
      formatNumber(budget.totalBudgetedExpense || 0),
      formatNumber(budget.totalActualExpense || 0),
      formatNumber((budget.totalActualExpense || 0) - (budget.totalBudgetedExpense || 0)),
      (budget.totalBudgetedExpense ? (((budget.totalActualExpense || 0) / budget.totalBudgetedExpense) * 100).toFixed(1).replace('.', ',') + '%' : '0,0%'),
      ''
    ].join(delim));

    lines.push([
      escapeCsv(netResultLabel),
      '', '', '', '',
      formatNumber(budget.budgetedNetResult || 0),
      formatNumber(budget.actualNetResult || 0),
      formatNumber((budget.actualNetResult || 0) - (budget.budgetedNetResult || 0)),
      (budget.budgetedNetResult ? (((budget.actualNetResult || 0) / budget.budgetedNetResult) * 100).toFixed(1).replace('.', ',') + '%' : '—'),
      ''
    ].join(delim));

    // Opening balances
    if (budget.openingBalances) {
      const actualCurrent = currentBalances || computeCurrentBankBalances(budget);
      lines.push('');
      const obTitle = isEn ? 'OPENING BALANCES' : isBoth ? 'BILANS OTWARCIA / OPENING BALANCES' : 'BILANS OTWARCIA';
      const cbColHeader = isEn ? `As of ${dateStr}` : isBoth ? `Stan na ${dateStr} / As of ${dateStr}` : `Stan na ${dateStr}`;
      const obColHeader = isEn ? 'Opening balance' : isBoth ? 'Bilans otwarcia / Opening' : 'Bilans otwarcia';
      lines.push([escapeCsv(obTitle), '', '', '', '', escapeCsv(obColHeader), escapeCsv(cbColHeader), '', '', ''].join(delim));
      lines.push([escapeCsv(isEn ? 'Bank account PLN' : 'Stan konta bankowego PLN'), '', '', '', '', formatNumber(budget.openingBalances.bankPln || 0), formatNumber(actualCurrent.bankPln || 0), '', '', ''].join(delim));
      const obEurDetails = budget.openingBalances.bankEurStartingBalance
        ? `${budget.openingBalances.bankEurStartingBalance.toFixed(2)} EUR (${isEn ? 'rate' : 'kurs'} NBP: ${budget.openingBalances.eurExchangeRate}${budget.openingBalances.eurExchangeDate ? (isEn ? ' as of ' : ' z dn. ') + formatDateOption(budget.openingBalances.eurExchangeDate, dateFormat) : ''})`
        : '';
      const cbEurDetails = (actualCurrent.bankEur !== undefined && actualCurrent.bankEur !== null)
        ? `${actualCurrent.bankEur.toFixed(2)} EUR (${isEn ? 'rate' : 'kurs'} NBP: ${actualCurrent.eurExchangeRate}${actualCurrent.eurExchangeDate ? (isEn ? ' as of ' : ' z dn. ') + formatDateOption(actualCurrent.eurExchangeDate, dateFormat) : ''})`
        : '';
      const eurNotes = [
        obEurDetails ? `${isEn ? 'Opening balance' : 'Bilans otwarcia'}: ${obEurDetails}` : '',
        cbEurDetails ? `${isEn ? 'As of ' + dateStr : 'Stan na ' + dateStr}: ${cbEurDetails}` : ''
      ].filter(Boolean).join(' | ');

      lines.push([
        escapeCsv(isEn ? 'Bank account EUR (in PLN)' : 'Stan konta bankowego EUR (w PLN)'),
        '', '', '', '',
        formatNumber(budget.openingBalances.bankEurInPln || 0),
        formatNumber(actualCurrent.bankEurInPln || 0),
        '', '',
        escapeCsv(eurNotes)
      ].join(delim));
      lines.push([escapeCsv(isEn ? 'Section sub-account reserves' : 'Środki zarezerwowane na subkonta sekcji'), '', '', '', '', formatNumber(budget.openingBalances.sectionReservesStartingBalance || 0), '', '', '', ''].join(delim));
      lines.push([escapeCsv(isEn ? 'Term deposits' : 'Lokaty terminowe'), '', '', '', '', formatNumber(budget.openingBalances.termDepositsStartingBalance || 0), formatNumber(actualCurrent.termDepositsPln || 0), '', '', ''].join(delim));
      lines.push([escapeCsv(isEn ? 'Unspent operational surplus from prior years' : 'Nierozliczona nadwyżka operacyjna z lat ubiegłych'), '', '', '', '', formatNumber(budget.openingBalances.unspentOperatingSurplusCarryover || 0), '', '', '', ''].join(delim));
      lines.push([escapeCsv(isEn ? 'TOTAL CASH ASSETS / OPENING BALANCE' : 'ŁĄCZNY BILANS OTWARCIA / STAN ŚRODKÓW'), '', '', '', '', formatNumber(budget.openingBalances.totalOpeningBalance || 0), formatNumber(actualCurrent.totalFunds || 0), '', '', ''].join(delim));
    }

    const filename = isEn ? `budget_execution_${yr}_${rawDateStr}.csv` : `budzet_wykonanie_${yr}_${rawDateStr}.csv`;
    return {
      content: prefix + lines.join('\r\n'),
      filename
    };

  } else {
    // 2. PLAN BUDŻETU (BEZ DANYCH WYKONANIA)
    const docTitle = isEn
      ? `${orgEn.toUpperCase()} BUDGET ${yr} ${modeSuffixEn.toUpperCase()}`
      : isBoth
      ? `BUDŻET ${orgPl.toUpperCase()} ${yr} ${modeSuffixPl.toUpperCase()} / ${orgEn.toUpperCase()} BUDGET`
      : `Budżet ${orgPl} ${yr} ${modeSuffixPl}`;

    lines.push(escapeCsv(docTitle));
    const statusVal = formatBudgetStatus(budget.status, lang);
    lines.push(escapeCsv(isEn ? `Status: ${statusVal}` : isBoth ? `Status: ${statusVal}` : `Status: ${statusVal}`));
    if (budget.resolutionNumber) {
      lines.push(escapeCsv(formatResolutionString(budget.resolutionNumber, budget.adoptedDate, lang, dateFormat)));
    }
    lines.push(escapeCsv('Waluta / Currency: PLN'));
    lines.push('');

    if (isEn) {
      lines.push([
        escapeCsv('Type'),
        escapeCsv('Category'),
        escapeCsv('Group'),
        escapeCsv('Code'),
        escapeCsv('Line'),
        escapeCsv('Budgeted amount [PLN]'),
        escapeCsv('Description')
      ].join(delim));
    } else if (isBoth) {
      lines.push([
        escapeCsv('Typ / Type'),
        escapeCsv('Kategoria / Category'),
        escapeCsv('Grupa / Group'),
        escapeCsv('Kod / Code'),
        escapeCsv('Linia / Line'),
        escapeCsv('Kwota zabudżetowana / Budgeted [PLN]'),
        escapeCsv('Opis / Description')
      ].join(delim));
    } else {
      lines.push([
        escapeCsv('Typ'),
        escapeCsv('Kategoria'),
        escapeCsv('Grupa'),
        escapeCsv('Kod'),
        escapeCsv('Linia'),
        escapeCsv('Kwota zabudżetowana [PLN]'),
        escapeCsv('Opis')
      ].join(delim));
    }

    const processPlanItems = (items: (DynamicBudgetGroup | BudgetLineItem)[], catNum: number, catName: string, secType: string, groupPath: string) => {
      for (const it of items || []) {
        if (isBudgetLine(it)) {
          lines.push([
            escapeCsv(secType),
            escapeCsv(`${catNum}. ${catName}`),
            escapeCsv(groupPath),
            escapeCsv(it.code || ''),
            escapeCsv(getLangText(it.name, lang)),
            formatNumber(it.budgetedAmount || 0),
            escapeCsv(getLangText(it.description, lang))
          ].join(delim));
        } else if (isBudgetGroup(it)) {
          const grpLabel = getLangText(it.name, lang);
          const currentPath = groupPath ? `${groupPath} > ${grpLabel}` : grpLabel;
          processPlanItems(it.items || [], catNum, catName, secType, currentPath);
        }
      }
    };

    for (let cIdx = 0; cIdx < (budget.categories || []).length; cIdx++) {
      const cat = budget.categories[cIdx];
      const catNum = cat.number || (cIdx + 1);
      const catName = getLangText(cat.name, lang);

      if (cat.revenues && cat.revenues.enabled !== false && Array.isArray(cat.revenues.items)) {
        processPlanItems(cat.revenues.items, catNum, catName, typeRev, '');
      }
      if (cat.expenses && cat.expenses.enabled !== false && Array.isArray(cat.expenses.items)) {
        processPlanItems(cat.expenses.items, catNum, catName, typeExp, '');
      }

      // Subtotal per category
      const catNetPlan = cat.plannedNetResult ?? ((cat.totalPlannedRevenue || 0) - (cat.totalPlannedExpense || 0));
      const sumLabel = isEn ? `RESULT: ${catNum}. ${catName}` : isBoth ? `WYNIK / RESULT: ${catNum}. ${catName}` : `WYNIK: ${catNum}. ${catName}`;
      lines.push([
        escapeCsv(sumLabel),
        escapeCsv(`${catNum}. ${catName}`),
        '',
        '',
        '',
        formatNumber(catNetPlan),
        escapeCsv(getLangText(cat.categoryResultExplanation, lang))
      ].join(delim));
    }

    // Grand totals
    lines.push('');
    const summaryTitle = isEn ? 'BUDGET PLAN SUMMARY' : isBoth ? 'PODSUMOWANIE PLANU BUDŻETU / BUDGET PLAN SUMMARY' : 'PODSUMOWANIE PLANU BUDŻETU';
    const totalRevLabel = isEn ? 'Total Planned Revenue' : isBoth ? 'Zaplanowane przychody / Planned Revenue' : 'Zaplanowane przychody';
    const totalExpLabel = isEn ? 'Total Planned Expense' : isBoth ? 'Zaplanowane koszty / Planned Expense' : 'Zaplanowane koszty';
    const netResultLabel = isEn
      ? 'Planned Net Result (Revenue - Expense)'
      : isBoth
      ? 'Planowany wynik netto / Planned Net Result'
      : 'Planowany wynik netto (Przychody - Koszty)';

    lines.push(escapeCsv(summaryTitle));
    lines.push([
      escapeCsv(totalRevLabel),
      '', '', '', '',
      formatNumber(budget.totalBudgetedRevenue || 0),
      ''
    ].join(delim));

    lines.push([
      escapeCsv(totalExpLabel),
      '', '', '', '',
      formatNumber(budget.totalBudgetedExpense || 0),
      ''
    ].join(delim));

    lines.push([
      escapeCsv(netResultLabel),
      '', '', '', '',
      formatNumber(budget.budgetedNetResult || 0),
      ''
    ].join(delim));

    if (budget.openingBalances) {
      lines.push('');
      const obTitle = isEn ? 'OPENING BALANCES' : isBoth ? 'BILANS OTWARCIA / OPENING BALANCES' : 'BILANS OTWARCIA';
      const obColHeader = isEn ? 'Opening balance' : isBoth ? 'Bilans otwarcia / Opening' : 'Bilans otwarcia';
      lines.push([escapeCsv(obTitle), '', '', '', '', escapeCsv(obColHeader), ''].join(delim));
      lines.push([escapeCsv(isEn ? 'Bank account PLN' : 'Stan konta bankowego PLN'), '', '', '', '', formatNumber(budget.openingBalances.bankPln || 0), ''].join(delim));
      const obEurDetails = budget.openingBalances.bankEurStartingBalance
        ? `${budget.openingBalances.bankEurStartingBalance.toFixed(2)} EUR (${isEn ? 'rate' : 'kurs'} NBP: ${budget.openingBalances.eurExchangeRate}${budget.openingBalances.eurExchangeDate ? (isEn ? ' as of ' : ' z dn. ') + formatDateOption(budget.openingBalances.eurExchangeDate, dateFormat) : ''})`
        : '';
      lines.push([
        escapeCsv(isEn ? 'Bank account EUR (in PLN)' : 'Stan konta bankowego EUR (w PLN)'),
        '', '', '', '',
        formatNumber(budget.openingBalances.bankEurInPln || 0),
        escapeCsv(obEurDetails)
      ].join(delim));
      lines.push([escapeCsv(isEn ? 'Section sub-account reserves' : 'Środki zarezerwowane na subkonta sekcji'), '', '', '', '', formatNumber(budget.openingBalances.sectionReservesStartingBalance || 0), ''].join(delim));
      lines.push([escapeCsv(isEn ? 'Term deposits' : 'Lokaty terminowe'), '', '', '', '', formatNumber(budget.openingBalances.termDepositsStartingBalance || 0), ''].join(delim));
      lines.push([escapeCsv(isEn ? 'Unspent operational surplus from prior years' : 'Nierozliczona nadwyżka operacyjna z lat ubiegłych'), '', '', '', '', formatNumber(budget.openingBalances.unspentOperatingSurplusCarryover || 0), ''].join(delim));
      lines.push([escapeCsv(isEn ? 'TOTAL CASH ASSETS / OPENING BALANCE' : 'ŁĄCZNY BILANS OTWARCIA / STAN ŚRODKÓW'), '', '', '', '', formatNumber(budget.openingBalances.totalOpeningBalance || 0), ''].join(delim));
    }

    const filename = isEn ? `budget_plan_${yr}.csv` : `budzet_plan_${yr}.csv`;
    return {
      content: prefix + lines.join('\r\n'),
      filename
    };
  }
}

/**
 * Triggers a direct browser file download for a generated CSV string.
 */
export function downloadCsvFile(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/**
 * Generates an official, printable HTML report with @media print styling.
 */
export function generateBudgetHtmlReport(
  budget: AnnualBudget,
  type: BudgetExportType,
  asOfDate?: string,
  lang: BudgetExportLanguage = 'pl',
  logoUrl?: string,
  calculationMode: 'NET' | 'GROSS' = 'NET',
  numberDisplayFormat: 'STANDARD' | 'ACCOUNTING' = 'STANDARD',
  currentBalances?: CurrentBankBalances,
  dateFormat: DateFormatOption = DEFAULT_DATE_FORMAT,
  budgetOrgName?: { en?: string; pl?: string }
): string {
  const yr = budget.year || new Date().getFullYear();
  const rawDateStr = asOfDate || new Date().toISOString().split('T')[0];
  const dateStr = formatDateOption(rawDateStr, dateFormat);

  const isEn = lang === 'en';
  const isBoth = lang === 'both';
  const isExecution = (type === 'EXECUTION');
  const statusFormatted = formatBudgetStatus(budget.status, lang);

  let title = '';
  let subtitle = '';

  const isGross = calculationMode === 'GROSS';
  const modeSuffixPl = isGross ? '(kwoty brutto)' : '(kwoty netto)';
  const modeSuffixEn = isGross ? '(gross amounts)' : '(net amounts)';

  const orgPl = budgetOrgName?.pl?.trim() || 'ESN Polska';
  const orgEn = budgetOrgName?.en?.trim() || 'ESN Poland';

  if (isExecution) {
    title = isEn
      ? `${orgEn} Budget Execution ${yr} ${modeSuffixEn}`
      : isBoth
      ? `Wykonanie budżetu ${orgPl} ${yr} ${modeSuffixPl} / ${orgEn} Budget Execution ${yr} ${modeSuffixEn}`
      : `Wykonanie budżetu ${orgPl} ${yr} ${modeSuffixPl}`;

    const dateLabel = isEn ? `Execution date: <strong>${dateStr}</strong>` : isBoth ? `Dzień wykonania / Execution date: <strong>${dateStr}</strong>` : `Dzień wykonania: <strong>${dateStr}</strong>`;
    const resString = budget.resolutionNumber ? ` | ${formatResolutionString(budget.resolutionNumber, budget.adoptedDate, lang, dateFormat)}` : '';
    subtitle = `${dateLabel} | Status: <strong>${statusFormatted}</strong>${resString}`;
  } else {
    title = isEn
      ? `${orgEn} Budget ${yr} ${modeSuffixEn}`
      : isBoth
      ? `Budżet ${orgPl} ${yr} ${modeSuffixPl} / ${orgEn} Budget ${yr} ${modeSuffixEn}`
      : `Budżet ${orgPl} ${yr} ${modeSuffixPl}`;

    const resString = budget.resolutionNumber ? ` | ${formatResolutionString(budget.resolutionNumber, budget.adoptedDate, lang, dateFormat)}` : '';
    subtitle = `Status: <strong>${statusFormatted}</strong>${resString}`;
  }

  const formatPln = (num: number | undefined | null) => {
    return (num || 0).toLocaleString(isEn ? 'en-US' : 'pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' PLN';
  };

  const formatEur = (num: number | undefined | null) => {
    return (num || 0).toLocaleString(isEn ? 'en-US' : 'pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' EUR';
  };

  const formatPlnWithSign = (num: number | undefined | null) => {
    return formatFinanceAmount(num || 0, numberDisplayFormat, {
      currency: 'PLN',
      forceSign: true,
      locale: isEn ? 'en' : 'pl'
    });
  };

  const categories = budget.categories || [];
  const typeRev = isEn ? 'REVENUE' : isBoth ? 'PRZYCHODY / REVENUE' : 'PRZYCHODY';
  const typeExp = isEn ? 'EXPENSE' : isBoth ? 'KOSZTY / EXPENSE' : 'KOSZTY';

  const actualCurrent = currentBalances || computeCurrentBankBalances(budget);

  const totalBudRev = budget.totalBudgetedRevenue || 0;
  const totalActRev = budget.totalActualRevenue || 0;
  const revVar = totalActRev - totalBudRev;
  const revPctNum = totalBudRev !== 0 ? (totalActRev / totalBudRev) * 100 : 0;
  const revPct = totalBudRev !== 0 ? revPctNum.toFixed(1).replace('.', ',') + '%' : '0,0%';

  const totalBudExp = budget.totalBudgetedExpense || 0;
  const totalActExp = budget.totalActualExpense || 0;
  const expVar = totalActExp - totalBudExp;
  const expPctNum = totalBudExp !== 0 ? (totalActExp / totalBudExp) * 100 : 0;
  const expPct = totalBudExp !== 0 ? expPctNum.toFixed(1).replace('.', ',') + '%' : '0,0%';

  const budNet = budget.budgetedNetResult || 0;
  const actNet = budget.actualNetResult || 0;
  const varNet = actNet - budNet;
  const netPctNum = budNet !== 0 ? (actNet / budNet) * 100 : 0;
  const netPct = budNet !== 0 ? netPctNum.toFixed(1).replace('.', ',') + '%' : '—';

  const totalRevLabel = isEn ? 'TOTAL REVENUE' : isBoth ? 'PRZYCHODY RAZEM / TOTAL REVENUE' : 'PRZYCHODY RAZEM';
  const totalExpLabel = isEn ? 'TOTAL EXPENSE' : isBoth ? 'KOSZTY RAZEM / TOTAL EXPENSE' : 'KOSZTY RAZEM';
  const netResultLabel = isEn
    ? (isGross ? 'GROSS RESULT' : 'NET RESULT')
    : isBoth
    ? (isGross ? 'WYNIK BRUTTO / GROSS RESULT' : 'WYNIK NETTO / NET RESULT')
    : (isGross ? 'WYNIK BRUTTO' : 'WYNIK NETTO');

  let tableRows = '';

  if (isExecution) {
    // 1. Execution Table (7 columns)
    const colCode = isEn ? 'Code' : isBoth ? 'Kod / Code' : 'Kod';
    const colItem = isEn ? 'Category / Group / Line' : isBoth ? 'Kategoria / Grupa / Linia (Category / Group / Line)' : 'Kategoria / Grupa / Linia';
    const colBud = isEn ? 'Budgeted' : isBoth ? 'Zabudżetowano / Budgeted' : 'Zabudżetowano';
    const colAct = isEn ? 'Execution' : isBoth ? 'Wykonanie / Execution' : 'Wykonanie';
    const colVar = isEn ? 'Variance' : isBoth ? 'Odchylenie / Variance' : 'Odchylenie';
    const colNotes = isEn ? 'Description' : isBoth ? 'Opis / Description' : 'Opis';

    const renderExecutionItems = (items: (DynamicBudgetGroup | BudgetLineItem)[], depth = 0): string => {
      let html = '';
      for (const item of items || []) {
        if (isBudgetGroup(item)) {
          const indent = 20 + depth * 14;
          html += `
            <tr class="grp-header-row">
              <td></td>
              <td colspan="6" style="padding-left: ${indent}px;">
                <span style="font-weight: 600; color: #475569;">📁 ${getLangText(item.name, lang)}</span>
              </td>
            </tr>
            ${renderExecutionItems(item.items || [], depth + 1)}
          `;
        } else if (isBudgetLine(item)) {
          const indent = 20 + (depth > 0 ? (depth + 1) * 14 : 0);
          const budgeted = item.budgetedAmount || 0;
          const actual = item.actualAmount || 0;
          const variance = actual - budgeted;
          const percent = budgeted !== 0 ? ((actual / budgeted) * 100).toFixed(1) + '%' : '0.0%';
          const lineDesc = getLangText(item.description, lang);
          html += `
            <tr>
              <td><code>${item.code || '—'}</code></td>
              <td style="padding-left: ${indent}px;">
                <div>${getLangText(item.name, lang)}</div>
              </td>
              <td style="text-align: right;">${formatPln(budgeted)}</td>
              <td style="text-align: right;">${formatPln(actual)}</td>
              <td style="text-align: right; color: ${variance < 0 ? '#dc2626' : '#16a34a'};">${formatPlnWithSign(variance)}</td>
              <td style="text-align: center;">${percent}</td>
              <td style="font-size: 10px; color: #64748b;">${escapeHtml(lineDesc)}</td>
            </tr>
          `;
        }
      }
      return html;
    };

    tableRows = `
      <thead>
        <tr>
          <th style="width: 100px;">${colCode}</th>
          <th>${colItem}</th>
          <th style="text-align: right; width: 120px;">${colBud}</th>
          <th style="text-align: right; width: 120px;">${colAct}</th>
          <th style="text-align: right; width: 110px;">${colVar}</th>
          <th style="text-align: center; width: 80px;">%</th>
          <th>${colNotes}</th>
        </tr>
      </thead>
      <tbody>
        ${categories.map((cat, cIdx) => {
          const catNum = cat.number || (cIdx + 1);
          const catName = getLangText(cat.name, lang);
          const catNetPlan = cat.plannedNetResult ?? ((cat.totalPlannedRevenue || 0) - (cat.totalPlannedExpense || 0));
          const catNetAct = cat.actualNetResult ?? ((cat.totalActualRevenue || 0) - (cat.totalActualExpense || 0));
          const catNetVar = catNetAct - catNetPlan;
          const catNetPct = catNetPlan !== 0 ? ((catNetAct / catNetPlan) * 100).toFixed(1) + '%' : '—';
          const resultLabel = isEn ? 'Result' : isBoth ? 'Wynik / Result' : 'Wynik';

          let catHtml = `
            <tr class="cat-header-row">
              <td colspan="7">
                <strong>${catNum}. ${catName}</strong>
              </td>
            </tr>
          `;

          // Revenues section
          if (cat.revenues && cat.revenues.enabled !== false && Array.isArray(cat.revenues.items) && cat.revenues.items.length > 0) {
            const secPlan = cat.revenues.totalPlanned || 0;
            const secAct = cat.revenues.totalActual || 0;
            const secVar = secAct - secPlan;
            const secPct = secPlan !== 0 ? ((secAct / secPlan) * 100).toFixed(1) + '%' : '0.0%';
            catHtml += `
              <tr class="sec-header-row rev">
                <td colspan="2" style="padding-left: 14px;">
                  <span class="badge badge-rev">${typeRev}</span>
                </td>
                <td style="text-align: right; font-weight: 700;">${formatPln(secPlan)}</td>
                <td style="text-align: right; font-weight: 700;">${formatPln(secAct)}</td>
                <td style="text-align: right; font-weight: 700; color: ${secVar < 0 ? '#dc2626' : '#16a34a'};">${formatPlnWithSign(secVar)}</td>
                <td style="text-align: center; font-weight: 700;">${secPct}</td>
                <td></td>
              </tr>
              ${renderExecutionItems(cat.revenues.items, 0)}
            `;
          }

          // Expenses section
          if (cat.expenses && cat.expenses.enabled !== false && Array.isArray(cat.expenses.items) && cat.expenses.items.length > 0) {
            const secPlan = cat.expenses.totalPlanned || 0;
            const secAct = cat.expenses.totalActual || 0;
            const secVar = secAct - secPlan;
            const secPct = secPlan !== 0 ? ((secAct / secPlan) * 100).toFixed(1) + '%' : '0.0%';
            catHtml += `
              <tr class="sec-header-row exp">
                <td colspan="2" style="padding-left: 14px;">
                  <span class="badge badge-exp">${typeExp}</span>
                </td>
                <td style="text-align: right; font-weight: 700;">${formatPln(secPlan)}</td>
                <td style="text-align: right; font-weight: 700;">${formatPln(secAct)}</td>
                <td style="text-align: right; font-weight: 700; color: ${secVar > 0 ? '#dc2626' : '#16a34a'};">${formatPlnWithSign(secVar)}</td>
                <td style="text-align: center; font-weight: 700;">${secPct}</td>
                <td></td>
              </tr>
              ${renderExecutionItems(cat.expenses.items, 0)}
            `;
          }


          // Category Net Result row
          const catExplanation = getLangText(cat.categoryResultExplanation, lang);
          catHtml += `
            <tr class="cat-result-row">
              <td colspan="2" style="padding-left: 14px; font-weight: 700; color: #1e293b;">
                ${resultLabel}: ${catNum}. ${catName}
              </td>
              <td style="text-align: right; font-weight: 700;">${formatPlnWithSign(catNetPlan)}</td>
              <td style="text-align: right; font-weight: 700;">${formatPlnWithSign(catNetAct)}</td>
              <td style="text-align: right; font-weight: 700; color: ${catNetVar < 0 ? '#dc2626' : '#16a34a'};">${formatPlnWithSign(catNetVar)}</td>
              <td style="text-align: center; font-weight: 700;">${catNetPct}</td>
              <td style="font-size: 10px; color: #475569; font-style: italic;">${catExplanation || ''}</td>
            </tr>
          `;

          return catHtml;
        }).join('')}
      </tbody>
      <tbody class="table-summary-tbody">
        <tr style="background: #f8fafc; border-top: 2px solid #cbd5e1; font-weight: 700;">
          <td colspan="2">${totalRevLabel}</td>
          <td style="text-align: right;">${formatPln(totalBudRev)}</td>
          <td style="text-align: right;">${formatPln(totalActRev)}</td>
          <td style="text-align: right; color: ${revVar < 0 ? '#dc2626' : '#16a34a'};">${formatPlnWithSign(revVar)}</td>
          <td style="text-align: center;">${revPct}</td>
          <td></td>
        </tr>
        <tr style="background: #f8fafc; font-weight: 700;">
          <td colspan="2">${totalExpLabel}</td>
          <td style="text-align: right;">${formatPln(totalBudExp)}</td>
          <td style="text-align: right;">${formatPln(totalActExp)}</td>
          <td style="text-align: right; color: ${expVar > 0 ? '#dc2626' : '#16a34a'};">${formatPlnWithSign(expVar)}</td>
          <td style="text-align: center;">${expPct}</td>
          <td></td>
        </tr>
        <tr style="background: #e2e8f0; font-weight: 700; border-top: 1px solid #cbd5e1; border-bottom: 2px solid #94a3b8;">
          <td colspan="2">${netResultLabel}</td>
          <td style="text-align: right;">${formatPlnWithSign(budNet)}</td>
          <td style="text-align: right;">${formatPlnWithSign(actNet)}</td>
          <td style="text-align: right; color: ${varNet < 0 ? '#dc2626' : '#16a34a'};">${formatPlnWithSign(varNet)}</td>
          <td style="text-align: center; font-weight: 700;">${netPct}</td>
          <td></td>
        </tr>
      </tbody>
    `;
  } else {
    // Budget Plan Table (4 columns: Code, Category/Group/Line, Budgeted amount, Notes)
    const colCode = isEn ? 'Code' : isBoth ? 'Kod / Code' : 'Kod';
    const colItem = isEn ? 'Category / Group / Line' : isBoth ? 'Kategoria / Grupa / Linia (Category / Group / Line)' : 'Kategoria / Grupa / Linia';
    const colBud = isEn ? 'Budgeted amount [PLN]' : isBoth ? 'Kwota zabudżetowana / Budgeted [PLN]' : 'Kwota zabudżetowana [PLN]';
    const colNotes = isEn ? 'Description' : isBoth ? 'Opis / Description' : 'Opis';

    const renderPlanItems = (items: (DynamicBudgetGroup | BudgetLineItem)[], depth = 0): string => {
      let html = '';
      for (const item of items || []) {
        if (isBudgetGroup(item)) {
          const indent = 20 + depth * 14;
          html += `
            <tr class="grp-header-row">
              <td></td>
              <td colspan="3" style="padding-left: ${indent}px;">
                <span style="font-weight: 600; color: #475569;">📁 ${getLangText(item.name, lang)}</span>
              </td>
            </tr>
            ${renderPlanItems(item.items || [], depth + 1)}
          `;
        } else if (isBudgetLine(item)) {
          const indent = 20 + (depth > 0 ? (depth + 1) * 14 : 0);
          const budgeted = item.budgetedAmount || 0;
          const lineDesc = getLangText(item.description, lang);
          html += `
            <tr>
              <td><code>${item.code || '—'}</code></td>
              <td style="padding-left: ${indent}px;">
                <div>${getLangText(item.name, lang)}</div>
              </td>
              <td style="text-align: right; font-weight: 600;">${formatPln(budgeted)}</td>
              <td style="font-size: 10px; color: #64748b;">${escapeHtml(lineDesc)}</td>
            </tr>
          `;
        }
      }
      return html;
    };

    tableRows = `
      <thead>
        <tr>
          <th style="width: 110px;">${colCode}</th>
          <th>${colItem}</th>
          <th style="text-align: right; width: 160px;">${colBud}</th>
          <th>${colNotes}</th>
        </tr>
      </thead>
      <tbody>
        ${categories.map((cat, cIdx) => {
          const catNum = cat.number || (cIdx + 1);
          const catName = getLangText(cat.name, lang);
          const catNetPlan = cat.plannedNetResult ?? ((cat.totalPlannedRevenue || 0) - (cat.totalPlannedExpense || 0));
          const resultLabel = isEn ? 'Result' : isBoth ? 'Wynik / Result' : 'Wynik';

          let catHtml = `
            <tr class="cat-header-row">
              <td colspan="4">
                <strong>${catNum}. ${catName}</strong>
              </td>
            </tr>
          `;

          // Revenues section
          if (cat.revenues && cat.revenues.enabled !== false && Array.isArray(cat.revenues.items) && cat.revenues.items.length > 0) {
            const secPlan = cat.revenues.totalPlanned || 0;
            catHtml += `
              <tr class="sec-header-row rev">
                <td colspan="2" style="padding-left: 14px;">
                  <span class="badge badge-rev">${typeRev}</span>
                </td>
                <td style="text-align: right; font-weight: 700;">${formatPln(secPlan)}</td>
                <td></td>
              </tr>
              ${renderPlanItems(cat.revenues.items, 0)}
            `;
          }

          // Expenses section
          if (cat.expenses && cat.expenses.enabled !== false && Array.isArray(cat.expenses.items) && cat.expenses.items.length > 0) {
            const secPlan = cat.expenses.totalPlanned || 0;
            catHtml += `
              <tr class="sec-header-row exp">
                <td colspan="2" style="padding-left: 14px;">
                  <span class="badge badge-exp">${typeExp}</span>
                </td>
                <td style="text-align: right; font-weight: 700;">${formatPln(secPlan)}</td>
                <td></td>
              </tr>
              ${renderPlanItems(cat.expenses.items, 0)}
            `;
          }


          // Category Net Result row
          const catExplanation = getLangText(cat.categoryResultExplanation, lang);
          catHtml += `
            <tr class="cat-result-row">
              <td colspan="2" style="padding-left: 14px; font-weight: 700; color: #1e293b;">
                ${resultLabel}: ${catNum}. ${catName}
              </td>
              <td style="text-align: right; font-weight: 700;">${formatPlnWithSign(catNetPlan)}</td>
              <td style="font-size: 10px; color: #475569; font-style: italic;">${catExplanation || ''}</td>
            </tr>
          `;

          return catHtml;
        }).join('')}
      </tbody>
      <tbody class="table-summary-tbody">
        <tr style="background: #f8fafc; border-top: 2px solid #cbd5e1; font-weight: 700;">
          <td colspan="2">${totalRevLabel}</td>
          <td style="text-align: right;">${formatPln(budget.totalBudgetedRevenue)}</td>
          <td></td>
        </tr>
        <tr style="background: #f8fafc; font-weight: 700;">
          <td colspan="2">${totalExpLabel}</td>
          <td style="text-align: right;">${formatPln(budget.totalBudgetedExpense)}</td>
          <td></td>
        </tr>
        <tr style="background: #e2e8f0; font-weight: 700; border-top: 1px solid #cbd5e1; border-bottom: 2px solid #94a3b8;">
          <td colspan="2">${netResultLabel}</td>
          <td style="text-align: right;">${formatPlnWithSign(budget.budgetedNetResult)}</td>
          <td></td>
        </tr>
      </tbody>
    `;
  }

  // Opening balances table section & Current balances table section (side-by-side)
  let openingBalancesHtml = '';
  if (budget.openingBalances) {
    const obTitle = isEn
      ? 'Opening Balances'
      : isBoth
      ? 'Bilans otwarcia / Opening Balances'
      : 'Bilans otwarcia';

    const openingTableHtml = `
      <table style="margin-bottom: 16px;">
        <tbody>
          <tr><td>${isEn ? 'Bank account PLN' : 'Stan konta bankowego PLN'}</td><td style="text-align: right; font-weight: 500;">${formatPln(budget.openingBalances.bankPln)}</td></tr>
          <tr>
            <td>
              <div>${isEn ? 'Bank account EUR (in PLN)' : isBoth ? 'Stan konta bankowego EUR (w PLN) / Bank EUR' : 'Stan konta bankowego EUR (w PLN)'}</div>
              ${budget.openingBalances.bankEurStartingBalance ? `
                <div style="font-size: 10px; color: #64748b; margin-top: 2px;">
                  ${formatEur(budget.openingBalances.bankEurStartingBalance)}
                  ${budget.openingBalances.eurExchangeRate ? ` (${isEn ? 'NBP rate' : isBoth ? 'kurs / rate NBP' : 'kurs NBP'}: ${budget.openingBalances.eurExchangeRate}${budget.openingBalances.eurExchangeDate ? (isEn ? ' as of ' : ' z dn. ') + formatDateOption(budget.openingBalances.eurExchangeDate, dateFormat) : ''})` : ''}
                </div>
              ` : ''}
            </td>
            <td style="text-align: right; font-weight: 500; vertical-align: top;">${formatPln(budget.openingBalances.bankEurInPln)}</td>
          </tr>
          <tr><td>${isEn ? 'Section sub-account reserves' : 'Środki zarezerwowane na subkonta sekcji'}</td><td style="text-align: right; font-weight: 500;">${formatPln(budget.openingBalances.sectionReservesStartingBalance)}</td></tr>
          <tr><td>${isEn ? 'Term deposits' : 'Lokaty terminowe'}</td><td style="text-align: right; font-weight: 500;">${formatPln(budget.openingBalances.termDepositsStartingBalance)}</td></tr>
          <tr><td>${isEn ? 'Unspent operational surplus from prior years' : 'Nierozliczona nadwyżka operacyjna z lat ubiegłych'}</td><td style="text-align: right; font-weight: 500;">${formatPln(budget.openingBalances.unspentOperatingSurplusCarryover)}</td></tr>
          <tr style="background: #f1f5f9; font-weight: 700;"><td>${isEn ? 'Total Opening Balance' : 'Łączny bilans otwarcia'}</td><td style="text-align: right;">${formatPln(budget.openingBalances.totalOpeningBalance)}</td></tr>
        </tbody>
      </table>
    `;

    if (isExecution) {
      const cbTitle = isEn
        ? `As of ${dateStr}`
        : isBoth
        ? `Stan na ${dateStr} / As of ${dateStr}`
        : `Stan na ${dateStr}`;

      openingBalancesHtml = `
        <div style="margin-top: 24px; display: flex; gap: 24px; align-items: flex-start; flex-wrap: wrap;">
          <!-- Left: Opening Balances -->
          <div style="flex: 1; min-width: 320px; max-width: 520px;">
            <h3 style="margin: 0 0 8px 0; font-size: 13px; color: #334155;">${obTitle}</h3>
            ${openingTableHtml}
          </div>

          <!-- Right (OBOK): Current Bank Balances -->
          <div style="flex: 1; min-width: 320px; max-width: 520px;">
            <h3 style="margin: 0 0 8px 0; font-size: 13px; color: #334155;">${cbTitle}</h3>
            <table style="margin-bottom: 16px;">
              <tbody>
                <tr><td>${isEn ? 'Bank account PLN' : 'Stan konta bankowego PLN'}</td><td style="text-align: right; font-weight: 500;">${formatPln(actualCurrent.bankPln)}</td></tr>
                <tr>
                  <td>
                    <div>${isEn ? 'Bank account EUR (in PLN)' : isBoth ? 'Stan konta bankowego EUR (w PLN) / Bank EUR' : 'Stan konta bankowego EUR (w PLN)'}</div>
                    ${actualCurrent.bankEur !== undefined && actualCurrent.bankEur !== null ? `
                      <div style="font-size: 10px; color: #64748b; margin-top: 2px;">
                        ${formatEur(actualCurrent.bankEur)}
                        ${actualCurrent.eurExchangeRate ? ` (${isEn ? 'NBP rate' : isBoth ? 'kurs / rate NBP' : 'kurs NBP'}: ${actualCurrent.eurExchangeRate}${actualCurrent.eurExchangeDate ? (isEn ? ' as of ' : ' z dn. ') + formatDateOption(actualCurrent.eurExchangeDate, dateFormat) : ''})` : ''}
                      </div>
                    ` : ''}
                  </td>
                  <td style="text-align: right; font-weight: 500; vertical-align: top;">${formatPln(actualCurrent.bankEurInPln)}</td>
                </tr>
                <tr><td>${isEn ? 'Term deposits' : 'Lokaty terminowe'}</td><td style="text-align: right; font-weight: 500;">${formatPln(actualCurrent.termDepositsPln)}</td></tr>
                <tr style="background: #f1f5f9; font-weight: 700;"><td>${isEn ? 'Total Current Cash Assets' : 'Łączny obecny stan środków'}</td><td style="text-align: right;">${formatPln(actualCurrent.totalFunds)}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      `;
    } else {
      // Plan budżetu (bez obecnego stanu)
      openingBalancesHtml = `
        <div style="margin-top: 24px; max-width: 520px;">
          <h3 style="margin: 0 0 8px 0; font-size: 13px; color: #334155;">${obTitle}</h3>
          ${openingTableHtml}
        </div>
      `;
    }
  }

  return `<!DOCTYPE html>
<html lang="${isEn ? 'en' : 'pl'}">
<head>
  <meta charset="UTF-8">
  <base href="${typeof window !== 'undefined' ? window.location.origin : ''}/">
  <title>${title}</title>
  <style>
    @page {
      size: A4 landscape;
      margin: 12mm 12mm 16mm 12mm;
    }
    * {
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #0f172a;
      background: #ffffff;
      margin: 0;
      padding: 20px 20px 30px 20px;
      font-size: 12px;
      line-height: 1.4;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    .rainbow-footer {
      position: fixed !important;
      bottom: 0 !important;
      left: 0 !important;
      right: 0 !important;
      width: 100% !important;
      height: 5px !important;
      background: linear-gradient(
        to right,
        #F15A24 0%, #F15A24 20%,
        #7AC143 20%, #7AC143 40%,
        #00AEEF 40%, #00AEEF 60%,
        #EC008C 60%, #EC008C 80%,
        #2E3192 80%, #2E3192 100%
      ) !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      z-index: 9999 !important;
      margin: 0 !important;
      padding: 0 !important;
    }

    .header-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      border-bottom: 1px solid #e2e8f0;
      padding-bottom: 12px;
    }
    .header-titles h1 {
      margin: 0 0 4px 0;
      font-size: 20px;
      color: #0f172a;
    }
    .header-titles .subtitle {
      font-size: 12px;
      color: #64748b;
    }
    .header-logo {
      text-align: right;
    }
    .doc-logo {
      max-height: 55px;
      max-width: 220px;
      object-fit: contain;
      display: block;
    }

    .kpi-row {
      display: flex;
      gap: 16px;
      margin-bottom: 20px;
    }
    .kpi-card {
      flex: 1;
      padding: 10px 14px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
    }
    .kpi-label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #64748b;
      font-weight: 600;
    }
    .kpi-value {
      font-size: 15px;
      font-weight: 700;
      margin-top: 4px;
      color: #0f172a;
    }
    .kpi-value.pos { color: #16a34a; }
    .kpi-value.neg { color: #dc2626; }

    .kpi-card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 2px;
    }
    .kpi-badge {
      font-size: 10px;
      font-weight: 700;
      padding: 1px 6px;
      border-radius: 4px;
      line-height: 1.3;
    }
    .kpi-badge-rev {
      background: #dcfce7;
      color: #15803d;
    }
    .kpi-badge-exp-ok {
      background: #dcfce7;
      color: #15803d;
    }
    .kpi-badge-exp-warn {
      background: #fef9c3;
      color: #854d0e;
    }
    .kpi-badge-exp-over {
      background: #fee2e2;
      color: #b91c1c;
    }
    .kpi-meta-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 10px;
      color: #64748b;
      margin-top: 6px;
      padding-top: 5px;
      border-top: 1px dashed #e2e8f0;
    }
    .kpi-progress-bar {
      width: 100%;
      height: 4px;
      background: #e2e8f0;
      border-radius: 2px;
      overflow: hidden;
      margin-top: 6px;
    }
    .kpi-progress-fill {
      height: 100%;
      border-radius: 2px;
    }
    .kpi-progress-fill.rev {
      background: #22c55e;
    }
    .kpi-progress-fill.exp {
      background: #3b82f6;
    }
    .kpi-progress-fill.exp.over-limit {
      background: #ef4444;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 24px;
      font-size: 11px;
    }
    th {
      background: #f1f5f9;
      color: #334155;
      text-align: left;
      padding: 6px 8px;
      font-weight: 600;
      border-bottom: 2px solid #cbd5e1;
    }
    td {
      padding: 5px 8px;
      border-bottom: 1px solid #e2e8f0;
      vertical-align: middle;
    }
    tfoot td, .table-summary-tbody td {
      padding: 6px 8px;
    }
    tfoot, .table-summary-tbody {
      display: table-row-group;
    }
    .cat-header-row td {
      background: #f8fafc;
      font-size: 12px;
      font-weight: 600;
      padding-top: 8px;
      padding-bottom: 8px;
      border-top: 2px solid #e2e8f0;
    }
    .grp-header-row td {
      background: #ffffff;
      color: #475569;
      font-weight: 600;
      font-size: 11px;
      padding-left: 12px;
    }
    code {
      font-family: monospace;
      font-weight: 600;
      background: #f1f5f9;
      padding: 2px 4px;
      border-radius: 4px;
      font-size: 10px;
      white-space: nowrap;
    }
    .badge {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      margin-right: 6px;
    }
    .badge-rev { background: #dcfce7; color: #166534; }
    .badge-exp { background: #fee2e2; color: #991b1b; }
    .badge-cat {
      background: #0f172a;
      color: #ffffff;
      font-weight: 800;
      border-radius: 4px;
      padding: 2px 7px;
      margin-right: 6px;
    }
    .sec-header-row td {
      background: #f8fafc;
      font-size: 11px;
      border-top: 1px solid #e2e8f0;
      border-bottom: 1px solid #e2e8f0;
      padding-top: 6px;
      padding-bottom: 6px;
    }
    .sec-header-row.rev td:first-child {
      border-left: 4px solid #16a34a;
    }
    .sec-header-row.exp td:first-child {
      border-left: 4px solid #dc2626;
    }
    .cat-result-row td {
      background: #f1f5f9;
      border-top: 1px dashed #cbd5e1;
      border-bottom: 2px solid #cbd5e1;
      font-size: 11px;
      padding-top: 6px;
      padding-bottom: 6px;
    }

    @media print {
      * {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      body {
        padding: 0 !important;
        margin: 0 !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      .no-print { display: none !important; }
      .rainbow-footer {
        position: fixed !important;
        bottom: 0 !important;
        left: 0 !important;
        right: 0 !important;
        width: 100% !important;
        height: 5px !important;
        background: linear-gradient(
          to right,
          #F15A24 0%, #F15A24 20%,
          #7AC143 20%, #7AC143 40%,
          #00AEEF 40%, #00AEEF 60%,
          #EC008C 60%, #EC008C 80%,
          #2E3192 80%, #2E3192 100%
        ) !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
        z-index: 9999 !important;
        margin: 0 !important;
        padding: 0 !important;
      }
      tr { page-break-inside: avoid !important; }
      .cat-header-row { page-break-after: avoid !important; }
      .grp-header-row { page-break-after: avoid !important; }
      tfoot, .table-summary-tbody {
        display: table-row-group !important;
        page-break-inside: avoid !important;
        break-inside: avoid !important;
      }
      .table-summary-tbody tr {
        page-break-inside: avoid !important;
        break-inside: avoid !important;
      }
    }
  </style>
</head>
<body>
  <div class="header-row">
    <div class="header-titles">
      <h1>${title}</h1>
      <div class="subtitle">${subtitle}</div>
    </div>
    ${logoUrl ? `
    <div class="header-logo">
      <img src="${logoUrl}" alt="Logo" class="doc-logo" />
    </div>` : ''}
  </div>

  <table>
    ${tableRows}
  </table>

  ${openingBalancesHtml}

  <div class="rainbow-footer"></div>

  <div class="no-print print-toolbar">
    <button type="button" class="btn-print" onclick="window.print()">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -2px; margin-right: 6px;"><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
      ${isEn ? 'Print / Save as PDF' : 'Drukuj / Zapisz jako PDF'}
    </button>
    <button type="button" class="btn-close" onclick="window.close()">
      ${isEn ? 'Close tab' : 'Zamknij kartę'}
    </button>
  </div>

  <style>
    .print-toolbar {
      position: fixed;
      bottom: 20px;
      right: 24px;
      z-index: 9999;
      display: flex;
      gap: 10px;
      background: rgba(15, 23, 42, 0.92);
      backdrop-filter: blur(8px);
      padding: 8px 12px;
      border-radius: 30px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3);
    }
    .print-toolbar button {
      padding: 8px 16px;
      font-size: 12px;
      font-weight: 600;
      border: none;
      border-radius: 20px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      transition: all 0.2s;
    }
    .btn-print { background: #00AEEF; color: #ffffff; }
    .btn-print:hover { background: #0098d4; }
    .btn-close { background: #334155; color: #cbd5e1; }
    .btn-close:hover { background: #475569; color: #ffffff; }
  </style>

  <script>
    window.addEventListener('DOMContentLoaded', function() {
      setTimeout(function() {
        try { window.print(); } catch (e) {}
      }, 450);
    });
  </script>
</body>
</html>`;
}

/**
 * Triggers opening a printable window for saving as PDF or printing.
 */
export function openPrintablePdf(htmlContent: string): boolean {
  try {
    const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 120000);
    return true;
  } catch (err) {
    console.error('Failed to open printable window:', err);
    return false;
  }
}

export interface AmendmentDraftExportOptions {
  language?: BudgetExportLanguage;
  asOfDate?: string;
  resolutionNumber?: string;
  description?: string;
  dateFormat?: DateFormatOption;
  numberFormatMode?: any;
  organisationNamePl?: string;
  organisationNameEn?: string;
  logoUrl?: string;
}

/**
 * Generates CSV content containing ONLY the modified / edited lines of an amendment draft.
 */
export function generateAmendmentDraftCsvContent(
  budget: AnnualBudget,
  itemsDiff: BudgetAmendmentItem[],
  options?: AmendmentDraftExportOptions
): string {
  const lang = options?.language || 'pl';
  const isEn = lang === 'en';
  const isBoth = lang === 'both';
  const delim = ';';

  const escapeCsv = (val: string | number | null | undefined): string => {
    if (val === null || val === undefined) return '""';
    const s = String(val).replace(/"/g, '""');
    return `"${s}"`;
  };

  const formatNumber = (num?: number): string => {
    const n = num ?? 0;
    return `"${n.toFixed(2).replace('.', ',')}"`;
  };

  const formatVar = (num?: number): string => {
    const n = num ?? 0;
    const sign = n > 0 ? '+' : '';
    return `"${sign}${n.toFixed(2).replace('.', ',')}"`;
  };

  const getChangeTypeLabel = (type?: string): string => {
    switch (type) {
      case 'ADD_LINE':
        return isEn ? 'New line' : isBoth ? 'Nowa pozycja / New line' : 'Nowa pozycja';
      case 'REMOVE_LINE':
        return isEn ? 'Removed' : isBoth ? 'Wykreślenie / Removed' : 'Wykreślenie';
      case 'RENAME_LINE':
        return isEn ? 'Renamed' : isBoth ? 'Zmiana nazwy / Renamed' : 'Zmiana nazwy';
      case 'MODIFY_LINE':
      default:
        return isEn ? 'Amount change' : isBoth ? 'Zmiana kwoty / Amount change' : 'Zmiana kwoty';
    }
  };

  const lines: string[] = [];

  // Title info
  const title = isEn
    ? `BUDGET AMENDMENT DRAFT ${budget.year}`
    : isBoth
    ? `PROJEKT NOWELIZACJI BUDŻETU / BUDGET AMENDMENT DRAFT ${budget.year}`
    : `PROJEKT NOWELIZACJI BUDŻETU ${budget.year}`;

  lines.push([escapeCsv(title)].join(delim));
  if (options?.resolutionNumber) {
    lines.push([escapeCsv(isEn ? `Resolution: ${options.resolutionNumber}` : `Uchwała: ${options.resolutionNumber}`)].join(delim));
  }
  lines.push([escapeCsv(isEn ? `Draft as of: ${options?.asOfDate || new Date().toISOString().substring(0, 10)}` : `Stan na dzień: ${options?.asOfDate || new Date().toISOString().substring(0, 10)}`)].join(delim));
  lines.push('');

  // Headers
  const colCode = isEn ? 'Code' : isBoth ? 'Kod / Code' : 'Kod';
  const colPath = isEn ? 'Category / Group' : isBoth ? 'Kategoria / Grupa / Category' : 'Kategoria / Grupa';
  const colName = isEn ? 'Line Name' : isBoth ? 'Nazwa pozycji / Line Name' : 'Nazwa pozycji';
  const colType = isEn ? 'Change Type' : isBoth ? 'Typ zmiany / Change Type' : 'Typ zmiany';
  const colPrev = isEn ? 'Current Plan [PLN]' : isBoth ? 'Dotychczasowy plan [PLN] / Current' : 'Dotychczasowy plan [PLN]';
  const colProp = isEn ? 'Proposed Plan [PLN]' : isBoth ? 'Proponowany plan [PLN] / Proposed' : 'Proponowany plan [PLN]';
  const colDelta = isEn ? 'Difference [PLN]' : isBoth ? 'Różnica [PLN] / Difference' : 'Różnica [PLN]';
  const colAct = isEn ? 'Execution [PLN]' : isBoth ? 'Wykonanie [PLN] / Execution' : 'Wykonanie [PLN]';
  const colJust = isEn ? 'Justification' : isBoth ? 'Uzasadnienie / Justification' : 'Uzasadnienie';

  lines.push([
    escapeCsv(colCode),
    escapeCsv(colPath),
    escapeCsv(colName),
    escapeCsv(colType),
    escapeCsv(colPrev),
    escapeCsv(colProp),
    escapeCsv(colDelta),
    escapeCsv(colAct),
    escapeCsv(colJust)
  ].join(delim));

  let totPrev = 0;
  let totProp = 0;
  let totDelta = 0;
  let totAct = 0;

  for (const it of itemsDiff || []) {
    const code = it.budgetCode || it.lineCode || '—';
    const path = it.categoryPath || '';
    const name = (isEn ? it.lineName?.en : it.lineName?.pl) || it.lineName?.pl || it.lineName?.en || '';
    const changeType = getChangeTypeLabel(it.changeType);
    const prev = it.previousAmount || it.currentAmount || 0;
    const prop = it.proposedAmount ?? (prev + (it.deltaAmount || 0));
    const delta = it.deltaAmount ?? (prop - prev);
    const act = it.actualAmountAtTime || 0;
    const just = it.explanation || it.justification || '';

    totPrev += prev;
    totProp += prop;
    totDelta += delta;
    totAct += act;

    lines.push([
      escapeCsv(code),
      escapeCsv(path),
      escapeCsv(name),
      escapeCsv(changeType),
      formatNumber(prev),
      formatNumber(prop),
      formatVar(delta),
      formatNumber(act),
      escapeCsv(just)
    ].join(delim));
  }

  // Summary row
  lines.push('');
  lines.push([
    escapeCsv(isEn ? 'TOTAL DELTA' : isBoth ? 'PODSUMOWANIE ZMIAN / TOTAL DELTA' : 'PODSUMOWANIE ZMIAN'),
    '',
    '',
    '',
    formatNumber(totPrev),
    formatNumber(totProp),
    formatVar(totDelta),
    formatNumber(totAct),
    ''
  ].join(delim));

  return lines.join('\r\n');
}

/**
 * Generates an official HTML/PDF report containing ONLY the modified lines of an amendment draft,
 * based strictly on the standard annual budget export formatting and styles.
 */
export function generateAmendmentDraftHtmlReport(
  budget: AnnualBudget,
  itemsDiff: BudgetAmendmentItem[],
  options?: AmendmentDraftExportOptions
): string {
  const yr = budget.year || new Date().getFullYear();
  const lang = options?.language || 'pl';
  const isEn = lang === 'en';
  const isBoth = lang === 'both';
  const dateFormat = options?.dateFormat || DEFAULT_DATE_FORMAT;
  const rawDateStr = options?.asOfDate || new Date().toISOString().substring(0, 10);
  const dateStr = formatDateOption(rawDateStr, dateFormat);
  const logoUrl = options?.logoUrl;

  const orgPl = options?.organisationNamePl || 'ESN Polska';
  const orgEn = options?.organisationNameEn || 'ESN Poland';

  const title = isEn
    ? `${orgEn} Budget Amendment Proposal ${yr}`
    : isBoth
    ? `Projekt Nowelizacji Budżetu ${orgPl} ${yr} / ${orgEn} Budget Amendment Proposal ${yr}`
    : `Projekt Nowelizacji Budżetu ${orgPl} ${yr}`;

  const dateLabel = isEn
    ? `As of: <strong>${dateStr}</strong>`
    : isBoth
    ? `Dzień wykonania / As of: <strong>${dateStr}</strong>`
    : `Stan na dzień: <strong>${dateStr}</strong>`;

  const statusLabel = isEn
    ? 'Status: <strong>AMENDMENT PROPOSAL</strong>'
    : isBoth
    ? 'Status: <strong>PROJEKT NOWELIZACJI / AMENDMENT PROPOSAL</strong>'
    : 'Status: <strong>PROJEKT NOWELIZACJI</strong>';

  const resString = options?.resolutionNumber
    ? ` | ${formatResolutionString(options.resolutionNumber, rawDateStr, lang, dateFormat)}`
    : '';

  const subtitle = `${dateLabel} | ${statusLabel}${resString}`;

  const formatPln = (num: number | undefined | null) => {
    return (num || 0).toLocaleString(isEn ? 'en-US' : 'pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' PLN';
  };

  const formatPlnWithSign = (num: number | undefined | null) => {
    return formatFinanceAmount(num || 0, 'STANDARD', {
      currency: 'PLN',
      forceSign: true,
      locale: isEn ? 'en' : 'pl'
    });
  };

  const escapeHtml = (str?: string): string => {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };

  const typeRev = isEn ? 'REVENUE' : isBoth ? 'PRZYCHODY / REVENUE' : 'PRZYCHODY';
  const typeExp = isEn ? 'EXPENSE' : isBoth ? 'KOSZTY / EXPENSE' : 'KOSZTY';

  const totalRevLabel = isEn ? 'TOTAL REVENUE' : isBoth ? 'PRZYCHODY RAZEM / TOTAL REVENUE' : 'PRZYCHODY RAZEM';
  const totalExpLabel = isEn ? 'TOTAL EXPENSE' : isBoth ? 'KOSZTY RAZEM / TOTAL EXPENSE' : 'KOSZTY RAZEM';
  const netResultLabel = isEn
    ? 'NET RESULT'
    : isBoth
    ? 'WYNIK NETTO / NET RESULT'
    : 'WYNIK NETTO';

  const colCode = isEn ? 'Code' : isBoth ? 'Kod / Code' : 'Kod';
  const colItem = isEn ? 'Category / Group / Line' : isBoth ? 'Kategoria / Grupa / Linia (Category / Group / Line)' : 'Kategoria / Grupa / Linia';
  const colCur = isEn ? 'Current Plan [PLN]' : isBoth ? 'Dotychczasowy plan / Current [PLN]' : 'Dotychczasowy plan [PLN]';
  const colProp = isEn ? 'Proposed Plan [PLN]' : isBoth ? 'Proponowany plan / Proposed [PLN]' : 'Proponowany plan [PLN]';
  const colDelta = isEn ? 'Difference [PLN]' : isBoth ? 'Różnica / Delta [PLN]' : 'Różnica [PLN]';
  const colAct = isEn ? 'Execution [PLN]' : isBoth ? 'Wykonanie / Execution [PLN]' : 'Wykonanie [PLN]';
  const colJust = isEn ? 'Justification' : isBoth ? 'Uzasadnienie / Justification' : 'Uzasadnienie';

  // Deltas
  const revItems = (itemsDiff || []).filter((it) => it.type === 'REVENUE');
  const expItems = (itemsDiff || []).filter((it) => it.type === 'EXPENSE');

  const revDelta = revItems.reduce((acc, it) => acc + (it.deltaAmount ?? it.difference ?? 0), 0);
  const expDelta = expItems.reduce((acc, it) => acc + (it.deltaAmount ?? it.difference ?? 0), 0);
  const netDelta = revDelta - expDelta;

  const baseBudRev = budget.totalBudgetedRevenue || 0;
  const propBudRev = baseBudRev + revDelta;
  const totalActRev = budget.totalActualRevenue || 0;

  const baseBudExp = budget.totalBudgetedExpense || 0;
  const propBudExp = baseBudExp + expDelta;
  const totalActExp = budget.totalActualExpense || 0;

  const baseNet = budget.budgetedNetResult || 0;
  const propNet = baseNet + netDelta;
  const totalActNet = budget.actualNetResult || 0;

  // Group itemsDiff by Category and Section
  interface CatGroup {
    catName: string;
    revenues: BudgetAmendmentItem[];
    expenses: BudgetAmendmentItem[];
  }

  const catMap = new Map<string, CatGroup>();

  for (const it of itemsDiff || []) {
    let catName = isEn ? 'Other' : 'Inne';
    if (it.categoryPath) {
      const parts = it.categoryPath.split(' > ');
      if (parts.length > 0 && parts[0].trim()) {
        catName = parts[0].trim();
      }
    }

    if (!catMap.has(catName)) {
      catMap.set(catName, { catName, revenues: [], expenses: [] });
    }

    const grp = catMap.get(catName)!;
    if (it.type === 'REVENUE') {
      grp.revenues.push(it);
    } else {
      grp.expenses.push(it);
    }
  }

  const renderSectionRows = (items: BudgetAmendmentItem[], secType: 'REVENUE' | 'EXPENSE'): string => {
    if (!items || items.length === 0) return '';
    const isRev = secType === 'REVENUE';
    const secCur = items.reduce((s, it) => s + (it.previousAmount || it.currentAmount || 0), 0);
    const secProp = items.reduce((s, it) => s + (it.proposedAmount ?? ((it.previousAmount || 0) + (it.deltaAmount || 0))), 0);
    const secDelta = items.reduce((s, it) => s + (it.deltaAmount ?? it.difference ?? 0), 0);
    const secAct = items.reduce((s, it) => s + (it.actualAmountAtTime || 0), 0);

    const deltaColor = isRev
      ? (secDelta < 0 ? '#dc2626' : '#16a34a')
      : (secDelta > 0 ? '#dc2626' : '#16a34a');

    let html = `
      <tr class="sec-header-row ${isRev ? 'rev' : 'exp'}">
        <td colspan="2" style="padding-left: 14px;">
          <span class="badge ${isRev ? 'badge-rev' : 'badge-exp'}">${isRev ? typeRev : typeExp}</span>
        </td>
        <td style="text-align: right; font-weight: 700;">${formatPln(secCur)}</td>
        <td style="text-align: right; font-weight: 700;">${formatPln(secProp)}</td>
        <td style="text-align: right; font-weight: 700; color: ${deltaColor};">${formatPlnWithSign(secDelta)}</td>
        <td style="text-align: right; font-weight: 700;">${formatPln(secAct)}</td>
        <td></td>
      </tr>
    `;

    for (const it of items) {
      const code = it.budgetCode || it.lineCode || '—';
      const name = (isEn ? it.lineName?.en : it.lineName?.pl) || it.lineName?.pl || it.lineName?.en || '';
      const prev = it.previousAmount ?? it.currentAmount ?? 0;
      const prop = it.proposedAmount ?? (prev + (it.deltaAmount || 0));
      const delta = it.deltaAmount ?? it.difference ?? (prop - prev);
      const act = it.actualAmountAtTime || 0;
      const just = it.explanation || it.justification || '';

      // Extract group subpath from categoryPath
      let groupSubpath = '';
      if (it.categoryPath) {
        const parts = it.categoryPath.split(' > ');
        if (parts.length > 2) {
          groupSubpath = parts.slice(2).join(' > ');
        }
      }

      let changeBadge = '';
      if (it.changeType === 'ADD_LINE') {
        changeBadge = `<span class="badge badge-rev" style="margin-left: 6px; font-size: 8px;">${isEn ? 'NEW' : 'NOWA'}</span>`;
      } else if (it.changeType === 'REMOVE_LINE') {
        changeBadge = `<span class="badge badge-exp" style="margin-left: 6px; font-size: 8px;">${isEn ? 'REMOVED' : 'USUNIĘTO'}</span>`;
      } else if (it.changeType === 'RENAME_LINE') {
        changeBadge = `<span class="badge" style="background: #e0f2fe; color: #0369a1; margin-left: 6px; font-size: 8px;">${isEn ? 'RENAMED' : 'NAZWA'}</span>`;
      }

      const lineDeltaColor = isRev
        ? (delta < 0 ? '#dc2626' : delta > 0 ? '#16a34a' : '#64748b')
        : (delta > 0 ? '#dc2626' : delta < 0 ? '#16a34a' : '#64748b');

      html += `
        <tr>
          <td><code>${escapeHtml(code)}</code></td>
          <td style="padding-left: 20px;">
            ${groupSubpath ? `<div style="font-size: 10px; color: #64748b; margin-bottom: 1px;">📁 ${escapeHtml(groupSubpath)}</div>` : ''}
            <div>
              ${escapeHtml(name)}
              ${changeBadge}
            </div>
          </td>
          <td style="text-align: right;">${formatPln(prev)}</td>
          <td style="text-align: right; font-weight: 600;">${formatPln(prop)}</td>
          <td style="text-align: right; font-weight: 700; color: ${lineDeltaColor};">${formatPlnWithSign(delta)}</td>
          <td style="text-align: right; color: #64748b;">${formatPln(act)}</td>
          <td style="font-size: 10px; color: #475569;">${escapeHtml(just)}</td>
        </tr>
      `;
    }

    return html;
  };

  let bodyRows = '';
  if (catMap.size === 0) {
    bodyRows = `<tr><td colspan="7" style="text-align: center; padding: 24px; color: #94a3b8;">${isEn ? 'No lines modified in this amendment draft.' : 'Brak zmodyfikowanych pozycji w projekcie nowelizacji.'}</td></tr>`;
  } else {
    for (const grp of catMap.values()) {
      bodyRows += `
        <tr class="cat-header-row">
          <td colspan="7">
            <strong>${escapeHtml(grp.catName)}</strong>
          </td>
        </tr>
        ${renderSectionRows(grp.revenues, 'REVENUE')}
        ${renderSectionRows(grp.expenses, 'EXPENSE')}
      `;
    }
  }

  const tableHtml = `
    <thead>
      <tr>
        <th style="width: 100px;">${colCode}</th>
        <th>${colItem}</th>
        <th style="text-align: right; width: 130px;">${colCur}</th>
        <th style="text-align: right; width: 130px;">${colProp}</th>
        <th style="text-align: right; width: 120px;">${colDelta}</th>
        <th style="text-align: right; width: 120px;">${colAct}</th>
        <th>${colJust}</th>
      </tr>
    </thead>
    <tbody>
      ${bodyRows}
    </tbody>
    <tbody class="table-summary-tbody">
      <tr style="background: #f8fafc; border-top: 2px solid #cbd5e1; font-weight: 700;">
        <td colspan="2">${totalRevLabel}</td>
        <td style="text-align: right;">${formatPln(baseBudRev)}</td>
        <td style="text-align: right;">${formatPln(propBudRev)}</td>
        <td style="text-align: right; color: ${revDelta < 0 ? '#dc2626' : '#16a34a'};">${formatPlnWithSign(revDelta)}</td>
        <td style="text-align: right;">${formatPln(totalActRev)}</td>
        <td></td>
      </tr>
      <tr style="background: #f8fafc; font-weight: 700;">
        <td colspan="2">${totalExpLabel}</td>
        <td style="text-align: right;">${formatPln(baseBudExp)}</td>
        <td style="text-align: right;">${formatPln(propBudExp)}</td>
        <td style="text-align: right; color: ${expDelta > 0 ? '#dc2626' : '#16a34a'};">${formatPlnWithSign(expDelta)}</td>
        <td style="text-align: right;">${formatPln(totalActExp)}</td>
        <td></td>
      </tr>
      <tr style="background: #e2e8f0; font-weight: 700; border-top: 1px solid #cbd5e1; border-bottom: 2px solid #94a3b8;">
        <td colspan="2">${netResultLabel}</td>
        <td style="text-align: right;">${formatPlnWithSign(baseNet)}</td>
        <td style="text-align: right;">${formatPlnWithSign(propNet)}</td>
        <td style="text-align: right; color: ${netDelta < 0 ? '#dc2626' : '#16a34a'};">${formatPlnWithSign(netDelta)}</td>
        <td style="text-align: right;">${formatPlnWithSign(totalActNet)}</td>
        <td></td>
      </tr>
    </tbody>
  `;

  return `<!DOCTYPE html>
<html lang="${isEn ? 'en' : 'pl'}">
<head>
  <meta charset="UTF-8">
  <base href="${typeof window !== 'undefined' ? window.location.origin : ''}/">
  <title>${escapeHtml(title)}</title>
  <style>
    @page {
      size: A4 landscape;
      margin: 12mm 12mm 16mm 12mm;
    }
    * {
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #0f172a;
      background: #ffffff;
      margin: 0;
      padding: 20px 20px 30px 20px;
      font-size: 12px;
      line-height: 1.4;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    .rainbow-footer {
      position: fixed !important;
      bottom: 0 !important;
      left: 0 !important;
      right: 0 !important;
      width: 100% !important;
      height: 5px !important;
      background: linear-gradient(
        to right,
        #F15A24 0%, #F15A24 20%,
        #7AC143 20%, #7AC143 40%,
        #00AEEF 40%, #00AEEF 60%,
        #EC008C 60%, #EC008C 80%,
        #2E3192 80%, #2E3192 100%
      ) !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      z-index: 9999 !important;
      margin: 0 !important;
      padding: 0 !important;
    }

    .header-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      border-bottom: 1px solid #e2e8f0;
      padding-bottom: 12px;
    }
    .header-titles h1 {
      margin: 0 0 4px 0;
      font-size: 20px;
      color: #0f172a;
    }
    .header-titles .subtitle {
      font-size: 12px;
      color: #64748b;
    }
    .header-logo {
      text-align: right;
    }
    .doc-logo {
      max-height: 55px;
      max-width: 220px;
      object-fit: contain;
      display: block;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 24px;
      font-size: 11px;
    }
    th {
      background: #f1f5f9;
      color: #334155;
      text-align: left;
      padding: 6px 8px;
      font-weight: 600;
      border-bottom: 2px solid #cbd5e1;
    }
    td {
      padding: 5px 8px;
      border-bottom: 1px solid #e2e8f0;
      vertical-align: middle;
    }
    tfoot td, .table-summary-tbody td {
      padding: 6px 8px;
    }
    tfoot, .table-summary-tbody {
      display: table-row-group;
    }
    .cat-header-row td {
      background: #f8fafc;
      font-size: 12px;
      font-weight: 600;
      padding-top: 8px;
      padding-bottom: 8px;
      border-top: 2px solid #e2e8f0;
    }
    .grp-header-row td {
      background: #ffffff;
      color: #475569;
      font-weight: 600;
      font-size: 11px;
      padding-left: 12px;
    }
    code {
      font-family: monospace;
      font-weight: 600;
      background: #f1f5f9;
      padding: 2px 4px;
      border-radius: 4px;
      font-size: 10px;
      white-space: nowrap;
    }
    .badge {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      margin-right: 6px;
    }
    .badge-rev { background: #dcfce7; color: #166534; }
    .badge-exp { background: #fee2e2; color: #991b1b; }
    .badge-cat {
      background: #0f172a;
      color: #ffffff;
      font-weight: 800;
      border-radius: 4px;
      padding: 2px 7px;
      margin-right: 6px;
    }
    .sec-header-row td {
      background: #f8fafc;
      font-size: 11px;
      border-top: 1px solid #e2e8f0;
      border-bottom: 1px solid #e2e8f0;
      padding-top: 6px;
      padding-bottom: 6px;
    }
    .sec-header-row.rev td:first-child {
      border-left: 4px solid #16a34a;
    }
    .sec-header-row.exp td:first-child {
      border-left: 4px solid #dc2626;
    }

    @media print {
      * {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      body {
        padding: 0 !important;
        margin: 0 !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      .no-print { display: none !important; }
      .rainbow-footer {
        position: fixed !important;
        bottom: 0 !important;
        left: 0 !important;
        right: 0 !important;
        width: 100% !important;
        height: 5px !important;
        background: linear-gradient(
          to right,
          #F15A24 0%, #F15A24 20%,
          #7AC143 20%, #7AC143 40%,
          #00AEEF 40%, #00AEEF 60%,
          #EC008C 60%, #EC008C 80%,
          #2E3192 80%, #2E3192 100%
        ) !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
        z-index: 9999 !important;
        margin: 0 !important;
        padding: 0 !important;
      }
      tr { page-break-inside: avoid !important; }
      .cat-header-row { page-break-after: avoid !important; }
      .grp-header-row { page-break-after: avoid !important; }
      tfoot, .table-summary-tbody {
        display: table-row-group !important;
        page-break-inside: avoid !important;
        break-inside: avoid !important;
      }
      .table-summary-tbody tr {
        page-break-inside: avoid !important;
        break-inside: avoid !important;
      }
    }
  </style>
</head>
<body>
  <div class="header-row">
    <div class="header-titles">
      <h1>${title}</h1>
      <div class="subtitle">${subtitle}</div>
    </div>
    ${logoUrl ? `
    <div class="header-logo">
      <img src="${logoUrl}" alt="Logo" class="doc-logo" />
    </div>` : ''}
  </div>

  <table>
    ${tableHtml}
  </table>

  ${options?.description ? `
  <div style="margin-top: 16px; padding: 10px 14px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 11px;">
    <strong>${isEn ? 'Justification / Resolution notes:' : 'Uzasadnienie / opis projektu nowelizacji:'}</strong>
    <p style="margin: 4px 0 0 0; color: #475569;">${escapeHtml(options.description)}</p>
  </div>
  ` : ''}

  <div class="rainbow-footer"></div>

  <div class="no-print print-toolbar">
    <button type="button" class="btn-print" onclick="window.print()">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -2px; margin-right: 6px;"><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
      ${isEn ? 'Print / Save as PDF' : 'Drukuj / Zapisz jako PDF'}
    </button>
    <button type="button" class="btn-close" onclick="window.close()">
      ${isEn ? 'Close tab' : 'Zamknij kartę'}
    </button>
  </div>

  <style>
    .print-toolbar {
      position: fixed;
      bottom: 20px;
      right: 24px;
      z-index: 9999;
      display: flex;
      gap: 10px;
      background: rgba(15, 23, 42, 0.92);
      backdrop-filter: blur(8px);
      padding: 8px 12px;
      border-radius: 30px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3);
    }
    .print-toolbar button {
      padding: 8px 16px;
      font-size: 12px;
      font-weight: 600;
      border: none;
      border-radius: 20px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      transition: all 0.2s;
    }
    .btn-print { background: #00AEEF; color: #ffffff; }
    .btn-print:hover { background: #0098d4; }
    .btn-close { background: #334155; color: #cbd5e1; }
    .btn-close:hover { background: #475569; color: #ffffff; }
  </style>

  <script>
    window.addEventListener('DOMContentLoaded', function() {
      setTimeout(function() {
        try { window.print(); } catch (e) {}
      }, 450);
    });
  </script>
</body>
</html>`;
}
