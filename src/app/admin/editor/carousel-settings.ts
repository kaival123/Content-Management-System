import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { CarouselArrowPosition, CarouselArrowStyle, CarouselDotsPosition, CarouselDotsStyle, CarouselSettings, Device, Section, SectionStyle } from '../../core/models';
import { DEFAULT_CAROUSEL, resolveCarousel } from '../../core/section-registry';
import { Icon } from '../../shared/icon';
import { ColorControl, RangeControl, SegControl, SegOption, ToggleControl } from './controls';

/** A layout choice drawn as a tiny diagram: the slides (rect), arrows and dots. */
interface LayoutOption<T> {
  value: T;
  label: string;
  rect: [number, number, number, number];
  arrows?: [number, number][];
  dots?: [number, number][];
}

/** Arrow positions, grouped as shown in the picker. */
const ARROW_POSITION_GROUPS: { label: string; options: LayoutOption<CarouselArrowPosition>[] }[] = [
  {
    label: 'Top',
    options: [
      { value: 'top-left', label: 'Left', rect: [3, 10, 42, 18], arrows: [[5, 5], [11, 5]] },
      { value: 'top-center', label: 'Center', rect: [3, 10, 42, 18], arrows: [[21, 5], [27, 5]] },
      { value: 'top-right', label: 'Right', rect: [3, 10, 42, 18], arrows: [[37, 5], [43, 5]] },
    ],
  },
  {
    label: 'Bottom',
    options: [
      { value: 'bottom-left', label: 'Left', rect: [3, 2, 42, 18], arrows: [[5, 25], [11, 25]] },
      { value: 'bottom-center', label: 'Center', rect: [3, 2, 42, 18], arrows: [[15, 25], [33, 25]], dots: [[21, 25], [24, 25], [27, 25]] },
      { value: 'bottom-right', label: 'Right', rect: [3, 2, 42, 18], arrows: [[37, 25], [43, 25]] },
    ],
  },
  {
    label: 'Left / right',
    options: [
      { value: 'left', label: 'Left', rect: [11, 3, 34, 24], arrows: [[5, 11], [5, 19]] },
      { value: 'right', label: 'Right', rect: [3, 3, 34, 24], arrows: [[43, 11], [43, 19]] },
    ],
  },
  {
    label: 'Both sides',
    options: [
      { value: 'sides', label: 'On slides', rect: [3, 4, 42, 22], arrows: [[8, 15], [40, 15]] },
      { value: 'outside', label: 'Outside', rect: [10, 4, 28, 22], arrows: [[4, 15], [44, 15]] },
    ],
  },
];

const DOTS_POSITIONS: LayoutOption<CarouselDotsPosition>[] = [
  { value: 'below', label: 'Below, centred', rect: [3, 2, 42, 18], dots: [[20, 25], [24, 25], [28, 25]] },
  { value: 'below-left', label: 'Below, left', rect: [3, 2, 42, 18], dots: [[5, 25], [9, 25], [13, 25]] },
  { value: 'below-right', label: 'Below, right', rect: [3, 2, 42, 18], dots: [[35, 25], [39, 25], [43, 25]] },
  { value: 'overlay', label: 'Over the slides', rect: [3, 2, 42, 26], dots: [[20, 23], [24, 23], [28, 23]] },
];

export interface CarouselPatch {
  key: keyof CarouselSettings;
  value: unknown;
}

/** Slider tab: behaviour of a carousel section. Slides themselves are edited in Content. */
@Component({
  selector: 'app-carousel-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, NgTemplateOutlet, ColorControl, RangeControl, SegControl, ToggleControl],
  template: `
    @let c = settings();
    <p class="tip">
      <app-icon name="slides" [size]="13" />
      {{ slideCount() }} slide{{ slideCount() === 1 ? '' : 's' }} — add, reorder or edit them under Content → Slides, or click a slide in the preview.
    </p>

    <h3 class="panel-label">Slider width</h3>
    <div class="style-picker width-picker" role="radiogroup" aria-label="Slider width">
      @for (o of widthModes; track o.value) {
        <button type="button" role="radio" [attr.aria-checked]="widthMode() === o.value" [class.active]="widthMode() === o.value" [title]="o.hint" (click)="setWidthMode(o.value)">
          <svg viewBox="0 0 48 30" width="48" height="30" aria-hidden="true">
            <rect x="1" y="1" width="46" height="28" rx="3" class="wp-page" />
            <rect [attr.x]="o.box[0]" y="9" [attr.width]="o.box[1]" height="12" [attr.rx]="o.value === 'full' ? 0 : 2" class="wp-slider" />
          </svg>
          {{ o.label }}
        </button>
      }
    </div>
    @if (widthMode() === 'custom') {
      <app-range-control label="Maximum width" [value]="section().style.contentWidth" [min]="320" [max]="2560" [step]="10" [fallback]="1920" (valueChange)="stylePatch.emit({ contentWidth: $event ?? 1920 })" />
      <app-seg-control [options]="widthPresets" [value]="section().style.contentWidth" (valueChange)="stylePatch.emit({ contentWidth: $event })" />
    }
    @if (widthMode() !== 'full') {
      <app-range-control label="Space at the sides" [value]="section().style.paddingSide" [min]="0" [max]="160" [step]="4" [fallback]="24" (valueChange)="stylePatch.emit({ paddingSide: $event })" />
    }
    <p class="field-hint">{{ widthHint() }}</p>

    <h3 class="panel-label">Slider height</h3>
    <app-seg-control [options]="heightModes" [value]="c.heightMode" (valueChange)="set('heightMode', $event ?? 'auto')" />
    @if (c.heightMode === 'fixed' || c.heightMode === 'screen') {
      @for (d of devices; track d.key) {
        @let field = c.heightMode === 'screen' ? d.screen : d.height;
        <div class="height-row" [class.current]="device() === d.key">
          <button type="button" class="grid-row-label" [title]="'Preview on ' + d.label" (click)="previewDevice.emit(d.key)">
            <app-icon [name]="d.icon" [size]="15" /> {{ d.label }}
          </button>
          @if (c.heightMode === 'screen') {
            <app-range-control label="" [value]="c[field]" [min]="20" [max]="100" [step]="5" unit="%" [fallback]="100" (valueChange)="set(field, $event ?? defaults[field])" />
          } @else {
            <app-range-control label="" [value]="c[field]" [min]="120" [max]="1200" [step]="10" unit="px" [fallback]="560" (valueChange)="set(field, $event ?? defaults[field])" />
          }
        </div>
      }
      <p class="field-hint">
        {{ c.heightMode === 'screen' ? 'Share of the visitor’s screen height (100% = full screen).' : 'Every slide gets exactly this height.' }}
        Images fill the slide; text that doesn’t fit is cut off.
      </p>
    } @else {
      <p class="field-hint">Each slide is as tall as its content{{ section().data.slideHeight ? ' (at least ' + section().data.slideHeight + 'px, from Content → Slide height)' : '' }}.</p>
    }

    <h3 class="panel-label">Slides visible per device</h3>
    @for (d of devices; track d.key) {
      <div class="per-view" [class.current]="device() === d.key">
        <button type="button" class="grid-row-label" [title]="'Preview on ' + d.label" (click)="previewDevice.emit(d.key)">
          <app-icon [name]="d.icon" [size]="15" /> {{ d.label }}
          <span class="per-view-value">{{ stacked() ? 1 : c[d.field] }} per view</span>
        </button>
        <div class="seg per-view-options" role="radiogroup" [attr.aria-label]="d.label + ' slides per view'">
          @for (n of options; track n) {
            <button
              type="button"
              role="radio"
              [attr.aria-checked]="c[d.field] === n"
              [class.active]="c[d.field] === n"
              [class.beyond]="n > slideCount()"
              [disabled]="stacked() && n > 1"
              [title]="n > slideCount() ? 'More than the ' + slideCount() + ' slides there are — the rest stays empty' : n + ' per view'"
              (click)="setPerView(d.field, d.key, n)"
            >{{ n }}</button>
          }
        </div>
      </div>
    }
    @if (stacked()) {
      <p class="field-hint">{{ c.transition === 'flip' ? 'Flip' : 'Fade' }} shows one slide at a time.</p>
    } @else if (tooFew(); as t) {
      <p class="field-hint warn">{{ t }}</p>
    }

    <h3 class="panel-label">Slide content</h3>
    <div class="pos-wrap">
      <div class="pos-grid" role="radiogroup" aria-label="Content position">
        @for (y of posY; track y) {
          @for (x of posX; track x) {
            <button
              type="button"
              role="radio"
              [attr.aria-checked]="c.contentX === x && c.contentY === y"
              [class.active]="c.contentX === x && c.contentY === y"
              [class.default]="!c.contentX && !c.contentY"
              [title]="posLabel(x, y)"
              (click)="setPosition(x, y)"
            ><span></span></button>
          }
        }
      </div>
      <div class="pos-side">
        <span class="ctl-label">Content position</span>
        <strong>{{ c.contentX || c.contentY ? posLabel(c.contentX || 'left', c.contentY || 'middle') : 'Layout default' }}</strong>
        @if (c.contentX || c.contentY) {
          <button type="button" class="link-btn" (click)="setPosition('', '')">Use the layout's default</button>
        }
        @if (!verticalWorks()) {
          <small>Top / middle / bottom shows when the slide is taller than its content (e.g. Slider height → Fixed).</small>
        }
      </div>
    </div>
    <div class="nudge-head">
      <span class="ctl-label">Move content</span>
      @if (c.contentMoveX || c.contentMoveY) {
        <button type="button" class="link-btn" (click)="set('contentMoveX', 0); set('contentMoveY', 0)">Reset</button>
      }
    </div>
    <div class="nudge">
      <div class="nudge-pad" role="group" aria-label="Move the slide content">
        <span class="nudge-name"><app-icon name="layout" [size]="13" /> Slide text</span>
        <button type="button" class="nudge-up" title="Up" (click)="nudge('contentMoveY', -step)"><app-icon name="chevron-up" [size]="14" /></button>
        <button type="button" class="nudge-left" title="Left" (click)="nudge('contentMoveX', -step)"><app-icon name="chevron-left" [size]="14" /></button>
        <button type="button" class="nudge-center" title="Back to its position" (click)="set('contentMoveX', 0); set('contentMoveY', 0)"><span></span></button>
        <button type="button" class="nudge-right" title="Right" (click)="nudge('contentMoveX', step)"><app-icon name="chevron-right" [size]="14" /></button>
        <button type="button" class="nudge-down" title="Down" (click)="nudge('contentMoveY', step)"><app-icon name="chevron-down" [size]="14" /></button>
      </div>
      <div class="nudge-values">
        <app-range-control label="← Left / right →" [value]="c.contentMoveX" [min]="-400" [max]="400" [step]="1" unit="px" [fallback]="0" (valueChange)="set('contentMoveX', $event ?? 0)" />
        <app-range-control label="↑ Up / down ↓" [value]="c.contentMoveY" [min]="-400" [max]="400" [step]="1" unit="px" [fallback]="0" (valueChange)="set('contentMoveY', $event ?? 0)" />
      </div>
    </div>
    @if (c.contentMoveX || c.contentMoveY) {
      <app-toggle-control label="Also move it on phones" [value]="c.contentMovePhones" (valueChange)="set('contentMovePhones', $event)" />
    }
    @if (flipLabel(); as fl) {
      <app-toggle-control [label]="'Flip layout — ' + fl" [value]="c.flipLayout" (valueChange)="set('flipLayout', $event)" />
    }
    @if (hasImages()) {
      <app-toggle-control label="Mirror images (flip horizontally)" [value]="c.mirrorImages" (valueChange)="set('mirrorImages', $event)" />
    }

    <h3 class="panel-label">Motion</h3>
    <app-seg-control label="Transition" [options]="transitions" [value]="c.transition" (valueChange)="set('transition', $event)" />
    <app-range-control label="Gap between slides" [value]="c.gap" [min]="0" [max]="80" [step]="2" [fallback]="24" (valueChange)="set('gap', $event ?? 24)" />
    <app-range-control label="Animation speed" [value]="c.speed" [min]="100" [max]="2000" [step]="50" unit="ms" [fallback]="500" (valueChange)="set('speed', $event ?? 500)" />
    <app-toggle-control label="Autoplay" [value]="c.autoplay" (valueChange)="set('autoplay', $event)" />
    @if (c.autoplay) {
      <app-range-control label="Time per slide" [value]="c.autoplaySpeed" [min]="1000" [max]="15000" [step]="250" unit="ms" [fallback]="4000" (valueChange)="set('autoplaySpeed', $event ?? 4000)" />
      <app-toggle-control label="Pause on hover" [value]="c.pauseOnHover" (valueChange)="set('pauseOnHover', $event)" />
      <p class="field-hint">Autoplay and dragging are paused inside the editor so they don't get in the way — use Preview to see them.</p>
    }
    <app-toggle-control label="Infinite loop" [value]="c.loop" (valueChange)="set('loop', $event)" />
    <app-toggle-control label="Center mode (active slide in the middle)" [value]="c.center" (valueChange)="set('center', $event)" />

    <ng-template #diagram let-o>
      <svg viewBox="0 0 48 30" width="48" height="30" aria-hidden="true">
        <rect [attr.x]="o.rect[0]" [attr.y]="o.rect[1]" [attr.width]="o.rect[2]" [attr.height]="o.rect[3]" rx="2.5" class="lo-slides" />
        @for (a of o.arrows ?? []; track $index) {
          <circle [attr.cx]="a[0]" [attr.cy]="a[1]" r="2.6" class="lo-arrow" />
        }
        @for (d of o.dots ?? []; track $index) {
          <circle [attr.cx]="d[0]" [attr.cy]="d[1]" r="1.2" class="lo-dot" />
        }
      </svg>
    </ng-template>

    <h3 class="panel-label">Arrows</h3>
    <app-toggle-control label="Previous / next arrows" [value]="c.arrows" (valueChange)="set('arrows', $event)" />
    @if (c.arrows) {
      <span class="ctl-label">Position</span>
      <div class="layout-groups" role="radiogroup" aria-label="Arrow position">
        @for (g of arrowPositionGroups; track g.label) {
          <div class="layout-group">
            <span class="layout-group-label">{{ g.label }}</span>
            <div class="layout-picker">
              @for (o of g.options; track o.value) {
                <button type="button" role="radio" [attr.aria-checked]="c.arrowPosition === o.value" [class.active]="c.arrowPosition === o.value" [title]="g.label + ' — ' + o.label" (click)="set('arrowPosition', o.value)">
                  <ng-container *ngTemplateOutlet="diagram; context: { $implicit: o }" />
                  <span>{{ o.label }}</span>
                </button>
              }
            </div>
          </div>
        }
      </div>
      <span class="ctl-label">Style</span>
      <div class="style-picker" role="radiogroup" aria-label="Arrow style">
        @for (o of arrowStyles; track o.value) {
          <button type="button" role="radio" [attr.aria-checked]="c.arrowStyle === o.value" [class.active]="c.arrowStyle === o.value" (click)="set('arrowStyle', o.value)">
            <span class="arrow-sample" [class]="'arrow-sample as-' + o.value"><app-icon name="chevron-right" [size]="12" /></span>
            {{ o.label }}
          </button>
        }
      </div>
      <app-range-control label="Arrow size" [value]="c.arrowSize" [min]="24" [max]="80" [step]="2" [fallback]="44" (valueChange)="set('arrowSize', $event ?? 44)" />

      <div class="nudge-head">
        <span class="ctl-label">Move arrows</span>
        @if (c.prevX || c.prevY || c.nextX || c.nextY) {
          <button type="button" class="link-btn" (click)="resetNudge()">Reset</button>
        }
      </div>
      @for (a of nudgeArrows; track a.key) {
        <div class="nudge">
          <div class="nudge-pad" role="group" [attr.aria-label]="'Move the ' + a.label">
            <span class="nudge-name"><app-icon [name]="a.icon" [size]="13" /> {{ a.label }}</span>
            <button type="button" class="nudge-up" title="Up" (click)="nudge(a.y, -step)"><app-icon name="chevron-up" [size]="14" /></button>
            <button type="button" class="nudge-left" title="Left" (click)="nudge(a.x, -step)"><app-icon name="chevron-left" [size]="14" /></button>
            <button type="button" class="nudge-center" title="Back to its position" (click)="set(a.x, 0); set(a.y, 0)"><span></span></button>
            <button type="button" class="nudge-right" title="Right" (click)="nudge(a.x, step)"><app-icon name="chevron-right" [size]="14" /></button>
            <button type="button" class="nudge-down" title="Down" (click)="nudge(a.y, step)"><app-icon name="chevron-down" [size]="14" /></button>
          </div>
          <div class="nudge-values">
            <app-range-control label="← Left / right →" [value]="c[a.x]" [min]="-300" [max]="300" [step]="1" unit="px" [fallback]="0" (valueChange)="set(a.x, $event ?? 0)" />
            <app-range-control label="↑ Up / down ↓" [value]="c[a.y]" [min]="-300" [max]="300" [step]="1" unit="px" [fallback]="0" (valueChange)="set(a.y, $event ?? 0)" />
          </div>
        </div>
      }
    }

    <h3 class="panel-label">Pagination</h3>
    <app-toggle-control label="Show pagination" [value]="c.dots" (valueChange)="set('dots', $event)" />
    @if (c.dots) {
      <span class="ctl-label">Style</span>
      <div class="style-picker dots" role="radiogroup" aria-label="Pagination style">
        @for (o of dotsStyles; track o.value) {
          <button type="button" role="radio" [attr.aria-checked]="c.dotsStyle === o.value" [class.active]="c.dotsStyle === o.value" (click)="set('dotsStyle', o.value)">
            <span class="dots-sample" [class]="'dots-sample ds-' + o.value">
              @switch (o.value) {
                @case ('numbers') { <i>01</i><i class="on">02</i><i>03</i> }
                @case ('fraction') { <b>2</b>&nbsp;/ 6 }
                @case ('progress') { <i class="bar"><i></i></i> }
                @default { <i></i><i class="on"></i><i></i><i></i> }
              }
            </span>
            {{ o.label }}
          </button>
        }
      </div>
      <span class="ctl-label">Position</span>
      <div class="layout-picker" role="radiogroup" aria-label="Pagination position">
        @for (o of dotsPositions; track o.value) {
          <button type="button" role="radio" [attr.aria-checked]="c.dotsPosition === o.value" [class.active]="c.dotsPosition === o.value" [title]="o.label" (click)="set('dotsPosition', o.value)">
            <ng-container *ngTemplateOutlet="diagram; context: { $implicit: o }" />
            <span>{{ o.label }}</span>
          </button>
        }
      </div>
      @if (c.arrows && c.arrowPosition === 'bottom-center' && c.dotsPosition !== 'overlay') {
        <p class="field-hint">The pagination sits between the arrows.</p>
      }
    }
    @if (c.arrows || c.dots) {
      <app-color-control label="Control colour (active dot, progress, solid arrows)" [value]="c.controlColor || undefined" (valueChange)="set('controlColor', $event ?? '')" />
    }

    <h3 class="panel-label">Interaction</h3>
    <app-toggle-control label="Mouse drag" [value]="c.drag" (valueChange)="set('drag', $event)" />
    <app-toggle-control label="Touch swipe" [value]="c.touch" (valueChange)="set('touch', $event)" />
    <app-toggle-control label="Keyboard arrows" [value]="c.keyboard" (valueChange)="set('keyboard', $event)" />

    <button type="button" class="btn btn-sm btn-secondary" (click)="resetSettings.emit()"><app-icon name="undo" [size]="14" /> Reset slider settings</button>
  `,
})
export class CarouselSettingsForm {
  readonly section = input.required<Section>();
  readonly device = input<Device>('desktop');
  readonly patch = output<CarouselPatch>();
  readonly resetSettings = output<void>();
  readonly previewDevice = output<Device>();
  /** Changes to the section's layout style (width, side space), applied as one edit. */
  readonly stylePatch = output<Partial<SectionStyle>>();

  protected readonly settings = computed(() => resolveCarousel(this.section()));
  protected readonly slideCount = computed(() => (this.section().data.slides ?? []).length);

  protected readonly devices: {
    key: Device;
    field: 'perViewDesktop' | 'perViewTablet' | 'perViewMobile';
    height: 'heightDesktop' | 'heightTablet' | 'heightMobile';
    screen: 'screenDesktop' | 'screenTablet' | 'screenMobile';
    label: string;
    icon: string;
  }[] = [
    { key: 'desktop', field: 'perViewDesktop', height: 'heightDesktop', screen: 'screenDesktop', label: 'Desktop', icon: 'monitor' },
    { key: 'tablet', field: 'perViewTablet', height: 'heightTablet', screen: 'screenTablet', label: 'Tablet', icon: 'tablet' },
    { key: 'mobile', field: 'perViewMobile', height: 'heightMobile', screen: 'screenMobile', label: 'Mobile', icon: 'phone' },
  ];
  protected readonly defaults = DEFAULT_CAROUSEL;
  protected readonly heightModes: SegOption<CarouselSettings['heightMode']>[] = [
    { value: 'auto', label: 'Auto', title: 'As tall as the content' },
    { value: 'fixed', label: 'Fixed', title: 'An exact height in px' },
    { value: 'screen', label: 'Screen height', title: 'A share of the screen height' },
  ];
  protected readonly options = Array.from({ length: 12 }, (_, i) => i + 1);

  /** Warns when a device shows more slides than exist (they're shown as picked, with empty space). */
  protected readonly tooFew = computed(() => {
    const c = this.settings();
    const count = this.slideCount();
    const over = this.devices.filter((d) => c[d.field] > count).map((d) => `${d.label.toLowerCase()} (${c[d.field]})`);
    if (!over.length) return '';
    return `Only ${count} slide${count === 1 ? '' : 's'}: ${over.join(', ')} will leave empty space and can't slide. Add slides under Content → Slides.`;
  });
  protected readonly widthModes: { value: 'contained' | 'full' | 'custom'; label: string; hint: string; box: [number, number] }[] = [
    { value: 'contained', label: 'Contained', hint: 'Same width as the rest of the page content', box: [10, 28] },
    { value: 'full', label: 'Full width', hint: 'Edge to edge, the full width of the screen', box: [1, 46] },
    { value: 'custom', label: 'Custom', hint: 'Up to a width you choose (e.g. 1920px)', box: [5, 38] },
  ];
  protected readonly widthPresets: SegOption<number>[] = [1200, 1440, 1600, 1920].map((w) => ({ value: w, label: String(w), title: `${w}px` }));

  /** The section's width as one of the three choices. */
  protected readonly widthMode = computed(() => {
    const st = this.section().style;
    if (st.width === 'full') return 'full';
    if (st.width === 'custom') return 'custom';
    return 'contained';
  });

  protected readonly widthHint = computed(() => {
    const st = this.section().style;
    switch (this.widthMode()) {
      case 'full':
        return 'The slider touches both edges of the screen on every device.';
      case 'custom':
        return `At most ${st.contentWidth ?? 1920}px wide; smaller screens use their full width.`;
      default:
        return 'Matches the page content width (Theme → Layout → Content width).';
    }
  });

  protected setWidthMode(mode: 'contained' | 'full' | 'custom'): void {
    const st = this.section().style;
    if (mode === 'full') this.stylePatch.emit({ width: 'full', paddingSide: 0 });
    else if (mode === 'custom') this.stylePatch.emit({ width: 'custom', contentWidth: st.contentWidth ?? 1920, paddingSide: st.paddingSide === 0 && st.width === 'full' ? undefined : st.paddingSide });
    else this.stylePatch.emit({ width: undefined, paddingSide: undefined });
  }

  protected readonly arrowPositionGroups = ARROW_POSITION_GROUPS;
  protected readonly dotsPositions = DOTS_POSITIONS;
  protected readonly arrowStyles: { value: CarouselArrowStyle; label: string }[] = [
    { value: 'circle', label: 'Circle' },
    { value: 'square', label: 'Square' },
    { value: 'outline', label: 'Outline' },
    { value: 'solid', label: 'Solid' },
    { value: 'minimal', label: 'Minimal' },
  ];
  protected readonly dotsStyles: { value: CarouselDotsStyle; label: string }[] = [
    { value: 'pills', label: 'Pills' },
    { value: 'dots', label: 'Dots' },
    { value: 'lines', label: 'Lines' },
    { value: 'numbers', label: 'Numbers' },
    { value: 'fraction', label: 'Counter' },
    { value: 'progress', label: 'Progress' },
    { value: 'thumbs', label: 'Thumbnails' },
  ];
  protected readonly transitions: SegOption<'slide' | 'fade' | 'flip'>[] = [
    { value: 'slide', label: 'Slide' },
    { value: 'fade', label: 'Fade' },
    { value: 'flip', label: 'Flip', title: '3D flip, one slide at a time' },
  ];

  /** Pixels moved per click on the nudge pad. */
  protected readonly step = 4;
  protected readonly nudgeArrows: { key: string; label: string; icon: string; x: 'prevX' | 'nextX'; y: 'prevY' | 'nextY' }[] = [
    { key: 'prev', label: 'Left arrow', icon: 'chevron-left', x: 'prevX', y: 'prevY' },
    { key: 'next', label: 'Right arrow', icon: 'chevron-right', x: 'nextX', y: 'nextY' },
  ];

  protected nudge(key: 'prevX' | 'prevY' | 'nextX' | 'nextY' | 'contentMoveX' | 'contentMoveY', by: number): void {
    const limit = key.startsWith('content') ? 400 : 300;
    const v = Math.max(-limit, Math.min(limit, (this.settings()[key] ?? 0) + by));
    this.set(key, v);
  }

  protected resetNudge(): void {
    for (const k of ['prevX', 'prevY', 'nextX', 'nextY'] as const) this.set(k, 0);
  }

  /** Fade and flip show one slide at a time. */
  protected readonly stacked = computed(() => this.settings().transition !== 'slide');
  protected readonly posX = ['left', 'center', 'right'] as const;
  protected readonly posY = ['top', 'middle', 'bottom'] as const;
  protected readonly variant = computed(() => String(this.section().data.variant || 'card'));

  /** What "flip layout" does for this slide layout (null: nothing to swap). */
  protected readonly flipLabel = computed(() => {
    switch (this.variant()) {
      case 'card':
      case 'product':
        return 'image below the text';
      case 'image':
        return 'caption above the image';
      case 'testimonial':
        return 'author above the quote';
      case 'team':
        return 'photo below the name';
      default:
        return null;
    }
  });
  protected readonly hasImages = computed(() => this.variant() !== 'content' && this.variant() !== 'testimonial');
  /** Vertical position only shows when slides have room (hero, fixed height…). */
  protected readonly verticalWorks = computed(() => this.variant() === 'hero' || this.variant() === 'portfolio' || this.settings().heightMode !== 'auto');

  protected posLabel(x: string, y: string): string {
    const v = { top: 'Top', middle: 'Middle', bottom: 'Bottom' }[y] ?? '';
    const h = { left: 'left', center: 'centre', right: 'right' }[x] ?? '';
    return y === 'middle' && x === 'center' ? 'Centre' : `${v} ${h}`;
  }

  protected setPosition(x: CarouselSettings['contentX'], y: CarouselSettings['contentY']): void {
    this.set('contentX', x);
    this.set('contentY', y);
  }

  protected set(key: keyof CarouselSettings, value: unknown): void {
    this.patch.emit({ key, value });
  }

  /** Sets a device's slides-per-view and previews that device so the change is visible. */
  protected setPerView(field: 'perViewDesktop' | 'perViewTablet' | 'perViewMobile', device: Device, n: number): void {
    this.set(field, n);
    this.previewDevice.emit(device);
  }
}
