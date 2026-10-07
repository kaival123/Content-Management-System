import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { ElementKind, ElementStyle, Shadow, TextAlign } from '../../core/models';
import { AnimationControl } from './animation-control';
import { ColorControl, HideOnControl, RangeControl, SegControl, SegOption, ToggleControl } from './controls';

export interface StylePatch {
  key: keyof ElementStyle;
  value: unknown;
}

let nextId = 0;

/**
 * Style controls for one element. `mode` splits them across the Style and Advanced tabs.
 * Controls shown depend on the element kind, e.g. images get aspect ratio but no font size.
 */
@Component({
  selector: 'app-element-style-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AnimationControl, ColorControl, RangeControl, SegControl, ToggleControl, HideOnControl],
  template: `
    @let s = value() ?? {};
    @if (mode() === 'style') {
      @if (hasText()) {
        <details class="grp" open>
          <summary>Typography</summary>
          <app-range-control label="Font size" [value]="s.fontSize" [min]="10" [max]="120" [fallback]="16" (valueChange)="set('fontSize', $event)" />
          <app-range-control label="Font size on phones" [value]="s.fontSizeMobile" [min]="10" [max]="80" [fallback]="16" (valueChange)="set('fontSizeMobile', $event)" />
          <app-seg-control label="Weight" [options]="weights" [value]="s.fontWeight" [clearable]="true" (valueChange)="set('fontWeight', $event)" />
          <app-range-control label="Line height" [value]="s.lineHeight" [min]="0.8" [max]="2.5" [step]="0.05" unit="" [fallback]="1.5" (valueChange)="set('lineHeight', $event)" />
          <app-range-control label="Letter spacing" [value]="s.letterSpacing" [min]="-4" [max]="10" [step]="0.1" [fallback]="0" (valueChange)="set('letterSpacing', $event)" />
          <app-seg-control label="Alignment" [options]="aligns" [value]="s.textAlign" [clearable]="true" (valueChange)="set('textAlign', $event)" />
          <app-seg-control label="Case" [options]="cases" [value]="s.textTransform" [clearable]="true" (valueChange)="set('textTransform', $event)" />
          <app-toggle-control label="Italic" [value]="s.italic" (valueChange)="set('italic', $event || undefined)" />
        </details>
      }

      <details class="grp" open>
        <summary>Colours</summary>
        @if (hasText()) {
          <app-color-control label="Text colour" [value]="s.color" (valueChange)="set('color', $event)" />
        }
        @if (kind() !== 'text') {
          <app-color-control label="Background" [value]="s.background" (valueChange)="set('background', $event)" />
        }
        <app-color-control label="Border colour" [value]="s.borderColor" (valueChange)="set('borderColor', $event)" />
      </details>

      @if (kind() === 'image') {
        <details class="grp" open>
          <summary>Image</summary>
          <app-seg-control label="Shape" [options]="ratios" [value]="s.aspectRatio" [clearable]="true" (valueChange)="set('aspectRatio', $event)" />
          <app-seg-control label="Fit" [options]="fits" [value]="s.objectFit" [clearable]="true" (valueChange)="set('objectFit', $event)" />
        </details>
      }

      <details class="grp" [open]="kind() !== 'text'">
        <summary>Box</summary>
        @if (kind() !== 'image') {
          <app-range-control label="Padding (top/bottom)" [value]="s.paddingY" [min]="0" [max]="80" [fallback]="0" (valueChange)="set('paddingY', $event)" />
          <app-range-control label="Padding (left/right)" [value]="s.paddingX" [min]="0" [max]="120" [fallback]="0" (valueChange)="set('paddingX', $event)" />
        }
        <app-range-control label="Corner radius" [value]="s.radius" [min]="0" [max]="60" [fallback]="0" (valueChange)="set('radius', $event)" />
        <app-range-control label="Border width" [value]="s.borderWidth" [min]="0" [max]="12" [fallback]="0" (valueChange)="set('borderWidth', $event)" />
        <app-seg-control label="Shadow" [options]="shadows" [value]="s.shadow" [clearable]="true" (valueChange)="set('shadow', $event)" />
      </details>

      <details class="grp" open>
        <summary>Size & spacing</summary>
        <app-range-control label="Max width" [value]="s.maxWidth" [min]="40" [max]="1400" [step]="10" [fallback]="600" placeholder="Full" (valueChange)="set('maxWidth', $event)" />
        @if (kind() === 'button') {
          <app-toggle-control label="Full width" [value]="s.fullWidth" (valueChange)="set('fullWidth', $event || undefined)" />
        }
        <app-range-control label="Space above" [value]="s.marginTop" [min]="0" [max]="160" [fallback]="0" (valueChange)="set('marginTop', $event)" />
        <app-range-control label="Space below" [value]="s.marginBottom" [min]="0" [max]="160" [fallback]="0" (valueChange)="set('marginBottom', $event)" />
      </details>
    } @else {
      <app-toggle-control label="Hide this element" [value]="s.hidden" (valueChange)="set('hidden', $event || undefined)" />
      <app-hide-on-control [value]="s.hideOn" (valueChange)="set('hideOn', $event)" />
      <app-animation-control [value]="s.animation" [duration]="s.animationDuration" [delay]="s.animationDelay" [easing]="s.animationEasing" [repeat]="s.animationRepeat" (patch)="set($event.key, $event.value)" />
      <div class="field">
        <label [attr.for]="id">CSS class</label>
        <input [id]="id" type="text" placeholder="my-class another-class" [value]="s.cssClass ?? ''" (change)="setText('cssClass', $event)" />
        <span class="field-hint">Target it from the page or section Custom CSS.</span>
      </div>
    }
  `,
})
export class ElementStyleForm {
  readonly kind = input.required<ElementKind>();
  readonly value = input<ElementStyle | undefined>();
  readonly mode = input<'style' | 'advanced'>('style');
  readonly patch = output<StylePatch>();

  protected readonly id = `esf${nextId++}`;
  protected readonly hasText = computed(() => this.kind() === 'text' || this.kind() === 'button' || this.kind() === 'box');

  protected readonly weights: SegOption<number>[] = [300, 400, 500, 600, 700, 800].map((w) => ({ value: w, label: String(w) }));
  protected readonly aligns: SegOption<TextAlign>[] = [
    { value: 'left', icon: 'align-left', title: 'Left' },
    { value: 'center', icon: 'align-center', title: 'Center' },
    { value: 'right', icon: 'align-right', title: 'Right' },
  ];
  protected readonly cases: SegOption<'none' | 'uppercase' | 'capitalize'>[] = [
    { value: 'none', label: 'Aa' },
    { value: 'uppercase', label: 'AA' },
    { value: 'capitalize', label: 'Ab Cd' },
  ];
  protected readonly shadows: SegOption<Shadow>[] = [
    { value: 'none', label: 'None' },
    { value: 'sm', label: 'S' },
    { value: 'md', label: 'M' },
    { value: 'lg', label: 'L' },
  ];
  protected readonly ratios: SegOption<NonNullable<ElementStyle['aspectRatio']>>[] = [
    { value: 'auto', label: 'Original' },
    { value: '1/1', label: '1:1' },
    { value: '4/3', label: '4:3' },
    { value: '16/9', label: '16:9' },
    { value: '3/4', label: '3:4' },
  ];
  protected readonly fits: SegOption<'cover' | 'contain'>[] = [
    { value: 'cover', label: 'Fill (crop)' },
    { value: 'contain', label: 'Fit (no crop)' },
  ];

  protected set(key: keyof ElementStyle, value: unknown): void {
    this.patch.emit({ key, value });
  }

  protected setText(key: keyof ElementStyle, e: Event): void {
    const v = (e.target as HTMLInputElement).value.trim();
    this.set(key, v || undefined);
  }
}
