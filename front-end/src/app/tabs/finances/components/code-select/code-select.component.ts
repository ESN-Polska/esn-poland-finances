import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnDestroy,
  OnChanges,
  SimpleChanges,
  forwardRef,
  ElementRef,
  HostListener,
  inject
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { Subscription } from 'rxjs';
import { FinancesService } from '../../../../services/finances.service';
import { FinancesStateService } from '../../../../services/finances-state.service';
import { AppService } from '../../../../app.service';
import { isBudgetGroup, isBudgetLine, BudgetLineItem } from '@models/annual-budget.model';

export type UniversalCodeCategory = 'ALL' | 'BUDGET_LINE' | 'SECTION' | 'SUB_BUDGET' | 'OUT_OF_BUDGET';

export interface UniversalCodeOption {
  code: string;
  lineNumber?: string;
  name: string;
  category: 'BUDGET_LINE' | 'SECTION' | 'SUB_BUDGET' | 'OUT_OF_BUDGET';
  categoryLabel?: string;
  subtitle?: string;
  icon?: string;
  isActive?: boolean;
}

@Component({
  selector: 'app-code-select',
  templateUrl: './code-select.component.html',
  styleUrls: ['./code-select.component.scss'],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => CodeSelectComponent),
      multi: true
    }
  ]
})
export class CodeSelectComponent implements OnInit, OnDestroy, OnChanges, ControlValueAccessor {
  private financesService = inject(FinancesService);
  public stateService = inject(FinancesStateService);
  public app = inject(AppService);
  private elementRef = inject(ElementRef);

  @Input() placeholder: string = '';
  @Input() disabled: boolean = false;
  @Input() allowClear: boolean = true;
  @Input() year?: number;
  @Input() allowedCategories?: ('BUDGET_LINE' | 'SECTION' | 'SUB_BUDGET' | 'OUT_OF_BUDGET')[];
  @Input() budgetLineType?: 'REVENUE' | 'EXPENSE' | 'COST' | 'ALL' = 'ALL';
  @Input() includeInactive: boolean = false;

  @Output() codeSelected = new EventEmitter<UniversalCodeOption | null>();

  public value: string = '';
  public isOpen: boolean = false;
  public searchQuery: string = '';
  public selectedCategory: UniversalCodeCategory = 'ALL';
  public loading: boolean = false;

  public allOptions: UniversalCodeOption[] = [];
  private sub?: Subscription;

  // ControlValueAccessor callbacks
  private onChange: (value: string) => void = () => {};
  private onTouched: () => void = () => {};

  ngOnInit(): void {
    this.sub = this.stateService.activeYear$.subscribe((y) => {
      if (!this.year) {
        this.loadCodes(y);
      }
    });
    this.loadCodes(this.targetYear);
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if ((changes['year'] && !changes['year'].firstChange) || changes['budgetLineType'] || changes['allowedCategories']) {
      this.loadCodes(this.targetYear);
    }
  }

  get showCategoryChips(): boolean {
    if (!this.allowedCategories) return true;
    return this.allowedCategories.length > 1;
  }

  get targetYear(): number {
    return this.year || this.stateService.activeYear || new Date().getFullYear();
  }

  // CVA Methods
  writeValue(val: string): void {
    this.value = val || '';
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState?(isDisabled: boolean): void {
    this.disabled = isDisabled;
  }

  public async loadCodes(year: number): Promise<void> {
    this.loading = true;
    try {
      const needMeetings = !this.allowedCategories || this.allowedCategories.includes('SUB_BUDGET');
      const needSections = !this.allowedCategories || this.allowedCategories.includes('SECTION');

      const [budget, meetings, sections] = await Promise.all([
        this.financesService.getBudget(year).catch(() => null),
        needMeetings ? this.financesService.getMeetings(year).catch(() => []) : Promise.resolve([]),
        needSections ? this.financesService.getSections(year).catch(() => []) : Promise.resolve([])
      ]);

      const options: UniversalCodeOption[] = [];

      // 1. Budget lines
      if (budget && (!this.allowedCategories || this.allowedCategories.includes('BUDGET_LINE'))) {
        const collectLines = (items: any[], type: 'REVENUE' | 'EXPENSE') => {
          for (const item of items || []) {
            if (isBudgetLine(item)) {
              if (item.code) {
                const localizedName = typeof item.name === 'string'
                  ? item.name
                  : (this.app.currentLanguage === 'en' ? item.name?.en : item.name?.pl) || item.name?.pl || item.name?.en || item.code;
                options.push({
                  code: item.code,
                  lineNumber: item.number || undefined,
                  name: localizedName,
                  category: 'BUDGET_LINE',
                  icon: type === 'REVENUE' ? 'trending-up-outline' : 'trending-down-outline',
                  isActive: true
                });
              }
            } else if (isBudgetGroup(item)) {
              collectLines(item.items || [], type);
            }
          }
        };

        const isExpense = this.budgetLineType === 'EXPENSE' || this.budgetLineType === 'COST';
        const isRevenue = this.budgetLineType === 'REVENUE';
        const allowAll = !this.budgetLineType || this.budgetLineType === 'ALL';

        for (const cat of budget.categories || []) {
          if ((allowAll || isRevenue) && cat.revenues?.items) {
            collectLines(cat.revenues.items, 'REVENUE');
          }
          if ((allowAll || isExpense) && cat.expenses?.items) {
            collectLines(cat.expenses.items, 'EXPENSE');
          }
        }

        // 2. Out of budget codes
        if (!this.allowedCategories || this.allowedCategories.includes('OUT_OF_BUDGET')) {
          const oobList = budget.outOfBudgetCodes || [];

          for (const oob of oobList) {
            if (this.includeInactive || oob.isActive !== false) {
              options.push({
                code: oob.code,
                name: oob.name,
                category: 'OUT_OF_BUDGET',
                subtitle: oob.description || 'Rozliczenie pozabudżetowe',
                icon: 'construct-outline',
                isActive: oob.isActive !== false
              });
            }
          }
        }
      }

      // 3. Sub-budgets (Meetings)
      for (const m of meetings || []) {
        if (m.code) {
          options.push({
            code: m.code,
            name: m.name,
            category: 'SUB_BUDGET',
            subtitle: `Sub-budżet [${m.budgetCode || 'brak linii'}]`,
            icon: 'people-outline',
            isActive: m.status !== 'SETTLED'
          });
        }
      }

      // 4. Section subaccounts
      for (const s of sections || []) {
        const sCode = s.sectionCode || (s as any).code;
        if (sCode) {
          if (this.includeInactive || s.isActive !== false) {
            options.push({
              code: sCode,
              name: s.sectionName || (s as any).name || sCode,
              category: 'SECTION',
              subtitle: `Subkonto sekcji • Saldo: ${(s.saldo ?? s.currentBalance ?? 0).toFixed(2)} PLN`,
              icon: 'business-outline',
              isActive: s.isActive !== false
            });
          }
        }
      }

      this.allOptions = options;
    } catch {
      this.allOptions = [];
    } finally {
      this.loading = false;
    }
  }

  get filteredOptions(): UniversalCodeOption[] {
    let list = this.allOptions;

    // Filter by allowed categories
    if (this.allowedCategories && this.allowedCategories.length > 0) {
      list = list.filter((o) => this.allowedCategories!.includes(o.category));
    }

    // Filter by active category tab
    if (this.selectedCategory !== 'ALL') {
      list = list.filter((o) => o.category === this.selectedCategory);
    }

    // Filter by search text
    const query = (this.searchQuery || '').trim().toLowerCase();
    if (query) {
      list = list.filter(
        (o) =>
          o.code.toLowerCase().includes(query) ||
          (o.lineNumber && o.lineNumber.toLowerCase().includes(query)) ||
          o.name.toLowerCase().includes(query) ||
          (o.subtitle && o.subtitle.toLowerCase().includes(query))
      );
    }

    return list;
  }

  get selectedOption(): UniversalCodeOption | undefined {
    return this.allOptions.find((o) => o.code === this.value);
  }

  public getCategoryCount(cat: UniversalCodeCategory): number {
    if (cat === 'ALL') {
      if (this.allowedCategories && this.allowedCategories.length > 0) {
        return this.allOptions.filter((o) => this.allowedCategories!.includes(o.category)).length;
      }
      return this.allOptions.length;
    }
    return this.allOptions.filter((o) => o.category === cat).length;
  }

  public isCategoryAllowed(cat: UniversalCodeCategory): boolean {
    if (cat === 'ALL') return true;
    if (!this.allowedCategories || this.allowedCategories.length === 0) return true;
    return this.allowedCategories.includes(cat);
  }

  public toggleOpen(): void {
    if (this.disabled) return;
    this.isOpen = !this.isOpen;
    if (this.isOpen) {
      this.searchQuery = '';
      this.onTouched();
    }
  }

  public selectCode(option: UniversalCodeOption): void {
    this.value = option.code;
    this.onChange(this.value);
    this.codeSelected.emit(option);
    this.isOpen = false;
    this.searchQuery = '';
  }

  public clearSelection(event?: MouseEvent): void {
    if (event) event.stopPropagation();
    this.value = '';
    this.onChange('');
    this.codeSelected.emit(null);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.isOpen && !this.elementRef.nativeElement.contains(event.target)) {
      this.isOpen = false;
    }
  }
}
