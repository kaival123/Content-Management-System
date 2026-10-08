import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, input, output, signal, viewChild } from '@angular/core';
import { COUNTRIES, Country, DEFAULT_COUNTRY, countryByCode, digitsOf, flagEmoji, isValidNational, parseE164, toE164 } from './phone';

export interface PhoneValue {
  /** E.164 string ("" when empty). */
  value: string;
  /** Empty is valid (the field is optional); otherwise the length must match the country. */
  valid: boolean;
}

/**
 * Country dropdown (dial code) + national number input with per-country length validation.
 * Emits the full E.164 number and whether it's valid. An empty number counts as valid.
 */
@Component({
  selector: 'app-phone-input',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'close()' },
  template: `
    <div class="ph">
      <div class="ph-row">
        <div class="ph-cc">
          <button type="button" class="ph-country" (click)="toggle()" [attr.aria-expanded]="open()" aria-haspopup="listbox" aria-label="Select country code">
            <span class="ph-cc-flag">{{ flag(country().code) }}</span>
            <span class="ph-cc-dial">+{{ country().dial }}</span>
            <svg class="ph-cc-chev" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
          </button>
          @if (open()) {
            <div class="ph-backdrop" (click)="close()"></div>
            <div class="ph-menu">
              <input
                #searchBox
                type="text"
                class="ph-search"
                [value]="search()"
                (input)="onSearch($any($event.target).value)"
                (keydown)="onKey($event)"
                placeholder="Search country or code"
                aria-label="Search countries"
                autocomplete="off"
              />
              <ul class="ph-list" role="listbox">
                @for (c of filtered(); track c.code; let i = $index) {
                  <li
                    role="option"
                    [attr.aria-selected]="c.code === countryCode()"
                    [class.ph-active]="i === active()"
                    (mouseenter)="active.set(i)"
                    (mousedown)="$event.preventDefault()"
                    (click)="pick(c)"
                  >
                    <span class="ph-li-flag">{{ flag(c.code) }}</span>
                    <span class="ph-li-name">{{ c.name }}</span>
                    <span class="ph-li-dial">+{{ c.dial }}</span>
                  </li>
                } @empty {
                  <li class="ph-empty">No match</li>
                }
              </ul>
            </div>
          }
        </div>
        <div class="ph-num">
          <input
            type="tel"
            class="ph-input"
            inputmode="numeric"
            [value]="national()"
            [attr.maxlength]="country().max"
            (input)="onNational($any($event.target).value)"
            (blur)="touched.set(true)"
            [attr.aria-label]="'Mobile number'"
            [placeholder]="placeholder()"
          />
        </div>
      </div>
      @if (showError()) {
        <p class="ph-err">Enter a valid {{ country().name }} number ({{ lengthHint() }} digits).</p>
      }
    </div>
  `,
  styles: [
    `
      .ph {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .ph-row {
        display: flex;
        gap: 8px;
      }
      .ph-cc {
        position: relative;
        flex: 0 0 auto;
      }
      .ph-country {
        display: flex;
        align-items: center;
        gap: 6px;
        height: 100%;
        min-height: 42px;
        padding: 0 10px;
        border: 1px solid #cbd5e1;
        border-radius: 10px;
        background: #fff;
        font: inherit;
        cursor: pointer;
      }
      .ph-cc-flag {
        font-size: 1.1rem;
      }
      .ph-cc-dial {
        font-weight: 600;
      }
      .ph-cc-chev {
        color: #94a3b8;
      }
      .ph-backdrop {
        position: fixed;
        inset: 0;
        z-index: 40;
      }
      .ph-menu {
        position: absolute;
        z-index: 41;
        top: calc(100% + 4px);
        left: 0;
        width: 280px;
        max-width: 78vw;
        background: #fff;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        box-shadow: 0 16px 40px rgb(15 23 42 / 0.18);
        overflow: hidden;
      }
      .ph-search {
        width: 100%;
        padding: 11px 14px;
        border: 0;
        border-bottom: 1px solid #eef2f7;
        outline: none;
        font: inherit;
        font-size: 0.95rem;
      }
      .ph-list {
        margin: 0;
        padding: 4px;
        list-style: none;
        max-height: 240px;
        overflow-y: auto;
      }
      .ph-list li {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 9px 10px;
        border-radius: 8px;
        cursor: pointer;
        font-size: 0.92rem;
      }
      .ph-list li.ph-active {
        background: #eef2ff;
      }
      .ph-list li[aria-selected='true'] {
        font-weight: 600;
      }
      .ph-li-flag {
        font-size: 1.1rem;
      }
      .ph-li-name {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .ph-li-dial {
        color: #64748b;
      }
      .ph-empty {
        padding: 14px;
        color: #94a3b8;
        justify-content: center;
      }
      .ph-num {
        display: flex;
        align-items: center;
        flex: 1;
        min-width: 0;
        border: 1px solid #cbd5e1;
        border-radius: 10px;
        background: #fff;
        overflow: hidden;
      }
      .ph-num:focus-within {
        outline: 2px solid #4f46e5;
        border-color: #4f46e5;
      }
      .ph-input {
        flex: 1;
        min-width: 0;
        padding: 10px 12px;
        border: 0;
        outline: none;
        font: inherit;
        font-size: 1rem;
        background: none;
      }
      .ph-err {
        margin: 0;
        color: #b91c1c;
        font-size: 0.8rem;
      }
    `,
  ],
})
export class PhoneInput {
  /** Initial E.164 value (e.g. "+15551234567"). */
  readonly value = input<string>('');
  readonly placeholder = input<string>('');
  readonly changed = output<PhoneValue>();

  readonly countries = COUNTRIES;
  readonly countryCode = signal<string>(DEFAULT_COUNTRY);
  readonly national = signal<string>('');
  readonly touched = signal(false);

  // Searchable country dropdown state.
  readonly open = signal(false);
  readonly search = signal('');
  readonly active = signal(0);
  private readonly searchBox = viewChild<ElementRef<HTMLInputElement>>('searchBox');

  readonly country = computed<Country>(() => countryByCode(this.countryCode()) ?? COUNTRIES[0]);
  readonly isValid = computed(() => this.national().trim() === '' || isValidNational(this.country(), this.national()));
  readonly showError = computed(() => this.touched() && this.national().trim() !== '' && !this.isValid());

  /** Countries matching the search text (by name, ISO code, or dial code). */
  readonly filtered = computed<Country[]>(() => {
    const q = this.search().trim().toLowerCase();
    if (!q) return COUNTRIES;
    const digits = q.replace(/\D/g, '');
    return COUNTRIES.filter(
      (c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase() === q || (digits !== '' && c.dial.includes(digits)),
    );
  });

  private seeded = false;

  constructor() {
    // Seed country + national from the initial value once. Ignoring later changes avoids a
    // feedback loop when the parent stores what we emit back into our `value` input.
    effect(() => {
      const v = this.value();
      if (this.seeded) return;
      this.seeded = true;
      const parsed = parseE164(v);
      this.countryCode.set(parsed.country.code);
      this.national.set(parsed.national);
    });
  }

  flag = flagEmoji;

  lengthHint(): string {
    const c = this.country();
    return c.min === c.max ? String(c.min) : `${c.min}–${c.max}`;
  }

  // --- searchable dropdown ----------------------------------------------------------------

  toggle(): void {
    this.open() ? this.close() : this.openMenu();
  }

  private openMenu(): void {
    this.search.set('');
    this.active.set(Math.max(0, this.filtered().findIndex((c) => c.code === this.countryCode())));
    this.open.set(true);
    setTimeout(() => this.searchBox()?.nativeElement.focus(), 0);
  }

  close(): void {
    this.open.set(false);
  }

  onSearch(value: string): void {
    this.search.set(value);
    this.active.set(0);
  }

  onKey(e: KeyboardEvent): void {
    const list = this.filtered();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.active.set(Math.min(this.active() + 1, list.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.active.set(Math.max(this.active() - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const c = list[this.active()];
      if (c) this.pick(c);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
    }
  }

  pick(c: Country): void {
    this.countryCode.set(c.code);
    // Trim the number to the new country's max so it can never exceed the allowed length.
    this.national.set(this.national().slice(0, this.country().max));
    this.close();
    this.emit();
  }

  onNational(raw: string): void {
    // Digits only, capped at the country's max length — extra typing/pasting is dropped.
    this.national.set(digitsOf(raw).slice(0, this.country().max));
    this.emit();
  }

  private emit(): void {
    const valid = this.isValid();
    this.changed.emit({ value: valid ? toE164(this.country(), this.national()) : '', valid });
  }
}
