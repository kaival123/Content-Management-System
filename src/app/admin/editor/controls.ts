import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { COLOR_TOKENS } from '../../core/styles';
import { Icon } from '../../shared/icon';

let nextId = 0;

/**
 * Colour picker offering "Default" (inherit), the page's theme colours, and a
 * custom colour. Theme tokens keep following the theme if it changes later.
 */
@Component({
  selector: 'app-color-control',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ctl">
      <span class="ctl-label">{{ label() }}</span>
      <div class="swatches-row">
        <button type="button" class="sw sw-none" [class.active]="!value()" title="Default" (click)="valueChange.emit(undefined)">
          <span></span>
        </button>
        @for (t of tokens; track t.value) {
          <button type="button" class="sw" [class.active]="value() === t.value" [title]="t.label" (click)="valueChange.emit(t.value)">
            <span [style.background]="t.css"></span>
          </button>
        }
        <label class="sw sw-custom" [class.active]="isCustom()" title="Custom colour">
          <span [style.background]="isCustom() ? value() : null"></span>
          <input type="color" [value]="isCustom() ? value() : '#6366f1'" (input)="pick($event)" />
        </label>
      </div>
      @if (isCustom()) {
        <input class="ctl-hex" type="text" [value]="value()" (change)="pick($event)" [attr.aria-label]="label() + ' hex value'" />
      }
    </div>
  `,
})
export class ColorControl {
  readonly label = input.required<string>();
  readonly value = input<string | undefined>();
  readonly valueChange = output<string | undefined>();
  protected readonly tokens = COLOR_TOKENS;
  protected readonly isCustom = computed(() => !!this.value() && !this.value()!.startsWith('__'));

  protected pick(e: Event): void {
    const v = (e.target as HTMLInputElement).value.trim();
    this.valueChange.emit(v || undefined);
  }
}

/** Slider + number box. Emits undefined on reset, meaning "use the default". */
@Component({
  selector: 'app-range-control',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <div class="ctl">
      <label class="ctl-label" [attr.for]="id">
        {{ label() }}
        @if (value() === undefined || value() === null) {
          <span class="ctl-auto">{{ placeholder() }}</span>
        }
      </label>
      <div class="range-row">
        <input
          type="range"
          [id]="id"
          [min]="min()"
          [max]="max()"
          [step]="step()"
          [value]="value() ?? fallback()"
          [class.unset]="value() === undefined"
          (input)="emit($event)"
        />
        <span class="num">
          <input type="number" [min]="min()" [max]="max()" [step]="step()" [value]="value() ?? ''" [placeholder]="'' + fallback()" (change)="emit($event)" />
          @if (unit()) {
            <small>{{ unit() }}</small>
          }
        </span>
        <button type="button" class="btn-icon sm" title="Reset" [style.visibility]="value() === undefined ? 'hidden' : 'visible'" (click)="valueChange.emit(undefined)">
          <app-icon name="undo" [size]="13" />
        </button>
      </div>
    </div>
  `,
})
export class RangeControl {
  readonly label = input.required<string>();
  readonly value = input<number | undefined>();
  readonly min = input(0);
  readonly max = input(100);
  readonly step = input(1);
  readonly unit = input('px');
  /** Value the slider shows while nothing is set. */
  readonly fallback = input(0);
  readonly placeholder = input('Auto');
  readonly valueChange = output<number | undefined>();
  protected readonly id = `rc${nextId++}`;

  protected emit(e: Event): void {
    const raw = (e.target as HTMLInputElement).value;
    this.valueChange.emit(raw === '' ? undefined : Number(raw));
  }
}

export interface SegOption<T> {
  value: T;
  label?: string;
  icon?: string;
  title?: string;
}

/** Segmented single-choice control. Clicking the active option again clears it when `clearable`. */
@Component({
  selector: 'app-seg-control',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <div class="ctl">
      @if (label()) {
        <span class="ctl-label">{{ label() }}</span>
      }
      <div class="seg seg-fill">
        @for (o of options(); track o.value) {
          <button type="button" [class.active]="value() === o.value" [title]="o.title ?? o.label ?? ''" (click)="choose(o.value)">
            @if (o.icon) {
              <app-icon [name]="o.icon" [size]="15" />
            }
            {{ o.label }}
          </button>
        }
      </div>
    </div>
  `,
})
export class SegControl<T = string> {
  readonly label = input<string>('');
  readonly options = input.required<SegOption<T>[]>();
  readonly value = input<T | undefined>();
  readonly clearable = input(false);
  readonly valueChange = output<T | undefined>();

  protected choose(v: T): void {
    this.valueChange.emit(this.clearable() && v === this.value() ? undefined : v);
  }
}

/** Labelled on/off switch. */
@Component({
  selector: 'app-toggle-control',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label class="ctl ctl-toggle">
      <span class="ctl-label">{{ label() }}</span>
      <input type="checkbox" class="switch" [checked]="!!value()" (change)="valueChange.emit($any($event.target).checked)" />
    </label>
  `,
})
export class ToggleControl {
  readonly label = input.required<string>();
  readonly value = input<boolean | undefined>();
  readonly valueChange = output<boolean>();
}

/** Three device toggles for "hide on…" settings. */
@Component({
  selector: 'app-hide-on-control',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <div class="ctl">
      <span class="ctl-label">Hide on</span>
      <div class="hide-on">
        @for (d of devices; track d.key) {
          <button type="button" [class.active]="value()?.[d.key]" (click)="toggle(d.key)" [title]="'Hide on ' + d.label">
            <app-icon [name]="d.icon" [size]="15" /> {{ d.label }}
          </button>
        }
      </div>
    </div>
  `,
})
export class HideOnControl {
  readonly value = input<{ desktop?: boolean; tablet?: boolean; mobile?: boolean } | undefined>();
  readonly valueChange = output<{ desktop?: boolean; tablet?: boolean; mobile?: boolean } | undefined>();
  protected readonly devices = [
    { key: 'desktop' as const, label: 'Desktop', icon: 'monitor' },
    { key: 'tablet' as const, label: 'Tablet', icon: 'tablet' },
    { key: 'mobile' as const, label: 'Mobile', icon: 'phone' },
  ];

  protected toggle(key: 'desktop' | 'tablet' | 'mobile'): void {
    const next = { ...this.value(), [key]: !this.value()?.[key] };
    const any = next.desktop || next.tablet || next.mobile;
    this.valueChange.emit(any ? next : undefined);
  }
}
