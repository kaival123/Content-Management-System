import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Animation, AnimationEasing } from '../../core/models';
import { RangeControl, SegControl, SegOption, ToggleControl } from './controls';

export interface AnimationPatch {
  key: 'animation' | 'animationDuration' | 'animationDelay' | 'animationEasing' | 'animationRepeat';
  value: unknown;
}

/** Effects grouped for the picker; the values are the Animation names used in the page data. */
const GROUPS: { label: string; options: { value: Animation; label: string }[] }[] = [
  {
    label: 'Fade',
    options: [
      { value: 'fade', label: 'Fade in' },
      { value: 'fade-up', label: 'Fade in from below' },
      { value: 'fade-down', label: 'Fade in from above' },
      { value: 'fade-left', label: 'Fade in from the left' },
      { value: 'fade-right', label: 'Fade in from the right' },
      { value: 'fade-up-left', label: 'Fade in from below left' },
      { value: 'fade-up-right', label: 'Fade in from below right' },
      { value: 'fade-down-left', label: 'Fade in from above left' },
      { value: 'fade-down-right', label: 'Fade in from above right' },
    ],
  },
  {
    label: 'Slide (longer travel)',
    options: [
      { value: 'slide-up', label: 'Slide up' },
      { value: 'slide-down', label: 'Slide down' },
      { value: 'slide-left', label: 'Slide in from the left' },
      { value: 'slide-right', label: 'Slide in from the right' },
    ],
  },
  {
    label: 'Zoom in',
    options: [
      { value: 'zoom', label: 'Zoom (subtle)' },
      { value: 'zoom-in', label: 'Zoom in' },
      { value: 'zoom-in-up', label: 'Zoom in from below' },
      { value: 'zoom-in-down', label: 'Zoom in from above' },
      { value: 'zoom-in-left', label: 'Zoom in from the left' },
      { value: 'zoom-in-right', label: 'Zoom in from the right' },
    ],
  },
  {
    label: 'Zoom out',
    options: [
      { value: 'zoom-out', label: 'Zoom out' },
      { value: 'zoom-out-up', label: 'Zoom out from below' },
      { value: 'zoom-out-down', label: 'Zoom out from above' },
      { value: 'zoom-out-left', label: 'Zoom out from the left' },
      { value: 'zoom-out-right', label: 'Zoom out from the right' },
    ],
  },
  {
    label: 'Flip',
    options: [
      { value: 'flip-left', label: 'Flip left' },
      { value: 'flip-right', label: 'Flip right' },
      { value: 'flip-up', label: 'Flip up' },
      { value: 'flip-down', label: 'Flip down' },
    ],
  },
];

/** Entrance animation picker with its timing: duration, delay, easing and whether it repeats. */
@Component({
  selector: 'app-animation-control',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RangeControl, SegControl, ToggleControl],
  template: `
    <div class="field">
      <label [attr.for]="id">Entrance animation</label>
      <select [id]="id" (change)="pick($event)">
        <option value="none" [selected]="!value()">None</option>
        @for (g of groups; track g.label) {
          <optgroup [label]="g.label">
            @for (o of g.options; track o.value) {
              <option [value]="o.value" [selected]="value() === o.value">{{ o.label }}</option>
            }
          </optgroup>
        }
      </select>
    </div>
    @if (value() && value() !== 'none') {
      <app-range-control label="Duration" [value]="duration()" [min]="100" [max]="3000" [step]="50" unit="ms" [fallback]="700" (valueChange)="patch.emit({ key: 'animationDuration', value: $event })" />
      <app-range-control label="Delay" [value]="delay()" [min]="0" [max]="2000" [step]="50" unit="ms" [fallback]="0" (valueChange)="patch.emit({ key: 'animationDelay', value: $event })" />
      <app-seg-control class="seg-wrap" label="Easing" [options]="easings" [value]="easing() ?? 'ease'" (valueChange)="patch.emit({ key: 'animationEasing', value: $event === 'ease' ? undefined : $event })" />
      <app-toggle-control label="Play again every time it scrolls into view" [value]="repeat()" (valueChange)="patch.emit({ key: 'animationRepeat', value: $event || undefined })" />
    }
  `,
})
export class AnimationControl {
  private static next = 0;
  readonly value = input<Animation | undefined>();
  readonly duration = input<number | undefined>();
  readonly delay = input<number | undefined>();
  readonly easing = input<AnimationEasing | undefined>();
  readonly repeat = input<boolean | undefined>();
  readonly patch = output<AnimationPatch>();

  protected readonly id = `anim-${AnimationControl.next++}`;
  protected readonly groups = GROUPS;
  protected readonly easings: SegOption<AnimationEasing>[] = [
    { value: 'ease', label: 'Ease' },
    { value: 'ease-out', label: 'Smooth' },
    { value: 'ease-in-out', label: 'In-out' },
    { value: 'ease-out-back', label: 'Back' },
    { value: 'linear', label: 'Linear' },
  ];

  protected pick(e: Event): void {
    const v = (e.target as HTMLSelectElement).value;
    this.patch.emit({ key: 'animation', value: v === 'none' ? undefined : v });
  }
}
