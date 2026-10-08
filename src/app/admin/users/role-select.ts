import { ChangeDetectionStrategy, Component, ElementRef, inject, input, output, signal } from '@angular/core';

export type Role = 'user' | 'admin';

const OPTIONS: { value: Role; label: string; hint: string }[] = [
  { value: 'user', label: 'User', hint: 'Works on websites' },
  { value: 'admin', label: 'Admin', hint: 'Also manages accounts' },
];

/**
 * Role picker: a button that opens a small menu. A native <select> list can't be styled, so this
 * follows the listbox pattern instead (arrow keys, Enter/Space to choose, Esc to close).
 * It only reports the choice; the parent decides whether to apply it.
 */
@Component({
  selector: 'app-role-select',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'close()' },
  template: `
    <button
      type="button"
      class="rs-btn"
      [class.rs-admin]="value() === 'admin'"
      [class.rs-field]="variant() === 'field'"
      [disabled]="disabled()"
      [title]="disabled() ? disabledHint() : ''"
      aria-haspopup="listbox"
      [attr.aria-expanded]="open()"
      [attr.aria-label]="label()"
      (click)="toggle()"
      (keydown)="onKey($event)"
    >
      <span class="rs-dot" aria-hidden="true"></span>
      <span class="rs-text">{{ current().label }}</span>
      <svg class="rs-chev" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
    </button>

    @if (open()) {
      <div class="rs-backdrop" (click)="close()"></div>
      <ul class="rs-menu" role="listbox" [attr.aria-label]="label()" [style.top.px]="top()" [style.left.px]="left()" [style.min-width.px]="width()">
        @for (o of options; track o.value; let i = $index) {
          <li
            role="option"
            [attr.aria-selected]="o.value === value()"
            [class.rs-active]="i === active()"
            [class.rs-selected]="o.value === value()"
            (mouseenter)="active.set(i)"
            (click)="pick(o.value)"
          >
            <span class="rs-opt-dot" [class.rs-opt-dot-admin]="o.value === 'admin'" aria-hidden="true"></span>
            <span class="rs-opt-body">
              <strong>{{ o.label }}</strong>
              <small>{{ o.hint }}</small>
            </span>
            @if (o.value === value()) {
              <svg class="rs-check" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
            }
          </li>
        }
      </ul>
    }
  `,
  styles: [
    `
      :host {
        display: inline-block;
      }
      .rs-btn {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-width: 112px;
        padding: 6px 10px 6px 12px;
        border: 1px solid #d5dbe5;
        border-radius: 999px;
        background: #f8fafc;
        color: #334155;
        font: inherit;
        font-size: 0.84rem;
        font-weight: 600;
        cursor: pointer;
        transition: border-color 0.15s, background-color 0.15s, box-shadow 0.15s;
      }
      .rs-btn:hover:not(:disabled) {
        border-color: #a5b4fc;
      }
      .rs-btn:focus-visible,
      .rs-btn[aria-expanded='true'] {
        outline: none;
        border-color: #6366f1;
        box-shadow: 0 0 0 3px rgb(99 102 241 / 18%);
      }
      .rs-btn:disabled {
        cursor: not-allowed;
        opacity: 0.7;
      }
      .rs-admin {
        border-color: #c7d2fe;
        background: #eef2ff;
        color: #4338ca;
      }
      .rs-field {
        width: 100%;
        height: 42px;
        padding: 0 12px;
        border-radius: 10px;
        background: #fff;
        font-size: 0.93rem;
        font-weight: 500;
        color: #0f172a;
      }
      .rs-field.rs-admin {
        background: #fff;
        color: #0f172a;
        border-color: #d5dbe5;
      }
      .rs-text {
        flex: 1;
        text-align: left;
      }
      .rs-dot,
      .rs-opt-dot {
        flex: none;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #94a3b8;
      }
      .rs-admin .rs-dot,
      .rs-opt-dot-admin {
        background: #6366f1;
      }
      .rs-chev {
        flex: none;
        color: #64748b;
        transition: transform 0.15s;
      }
      .rs-btn[aria-expanded='true'] .rs-chev {
        transform: rotate(180deg);
      }

      .rs-backdrop {
        position: fixed;
        inset: 0;
        z-index: 250;
      }
      .rs-menu {
        position: fixed;
        z-index: 251;
        margin: 0;
        padding: 6px;
        list-style: none;
        border: 1px solid #e5e9f0;
        border-radius: 12px;
        background: #fff;
        box-shadow: 0 16px 40px -12px rgb(15 23 42 / 28%), 0 2px 6px rgb(15 23 42 / 6%);
        animation: rs-in 0.12s ease-out;
      }
      @keyframes rs-in {
        from {
          opacity: 0;
          transform: translateY(-4px);
        }
      }
      .rs-menu li {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 9px 10px;
        border-radius: 8px;
        color: #0f172a;
        cursor: pointer;
      }
      .rs-menu li.rs-active {
        background: #f1f5ff;
      }
      .rs-opt-body {
        display: flex;
        flex: 1;
        flex-direction: column;
        gap: 1px;
      }
      .rs-opt-body strong {
        font-size: 0.88rem;
      }
      .rs-opt-body small {
        color: #64748b;
        font-size: 0.74rem;
      }
      .rs-check {
        flex: none;
        color: #4f46e5;
      }
      @media (prefers-reduced-motion: reduce) {
        .rs-menu {
          animation: none;
        }
      }
    `,
  ],
})
export class RoleSelect {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly value = input.required<Role>();
  readonly disabled = input(false);
  readonly disabledHint = input('');
  readonly label = input('Role');
  /** 'pill' for table rows, 'field' to match the form inputs. */
  readonly variant = input<'pill' | 'field'>('pill');
  readonly changed = output<Role>();

  protected readonly options = OPTIONS;
  protected readonly open = signal(false);
  protected readonly active = signal(0);
  protected readonly top = signal(0);
  protected readonly left = signal(0);
  protected readonly width = signal(200);

  protected current() {
    return OPTIONS.find((o) => o.value === this.value()) ?? OPTIONS[0];
  }

  protected toggle(): void {
    if (this.open()) this.close();
    else this.show();
  }

  private show(): void {
    const rect = this.host.nativeElement.querySelector('button')!.getBoundingClientRect();
    const menuHeight = OPTIONS.length * 52 + 14;
    // Opens downwards, or upwards when there is no room below.
    this.top.set(rect.bottom + menuHeight + 12 > window.innerHeight ? rect.top - menuHeight - 6 : rect.bottom + 6);
    this.left.set(rect.left);
    this.width.set(Math.max(rect.width, 210));
    this.active.set(Math.max(0, OPTIONS.findIndex((o) => o.value === this.value())));
    this.open.set(true);
  }

  protected close(): void {
    this.open.set(false);
  }

  protected pick(role: Role): void {
    this.close();
    if (role !== this.value()) this.changed.emit(role);
  }

  protected onKey(e: KeyboardEvent): void {
    if (!this.open()) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        this.show();
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        this.active.update((i) => (i + 1) % OPTIONS.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        this.active.update((i) => (i - 1 + OPTIONS.length) % OPTIONS.length);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        this.pick(OPTIONS[this.active()].value);
        break;
      case 'Tab':
        this.close();
        break;
    }
  }
}
