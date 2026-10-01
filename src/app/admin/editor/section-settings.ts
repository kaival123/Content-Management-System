import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { Section, SectionStyle } from '../../core/models';
import { ProjectService, assetUrl } from '../../core/project.service';
import { readImageAsDataUrl } from '../../shared/files';
import { Icon } from '../../shared/icon';
import { ToastService } from '../../shared/toast';
import { ColorControl, HideOnControl, RangeControl, SegControl, SegOption, ToggleControl } from './controls';
import { ANIMATION_OPTIONS } from './element-style-form';

export interface SectionStylePatch {
  key: keyof SectionStyle;
  value: unknown;
}

let nextId = 0;

/** Style (background, spacing, layout) and Advanced (visibility, anchor, CSS) settings for a section. */
@Component({
  selector: 'app-section-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, ColorControl, RangeControl, SegControl, ToggleControl, HideOnControl],
  template: `
    @let st = section().style;
    @if (mode() === 'style') {
      <details class="grp" open>
        <summary>Background</summary>
        <app-seg-control [options]="bgTypes" [value]="st.backgroundType ?? 'color'" (valueChange)="set('backgroundType', $event)" />
        @switch (st.backgroundType ?? 'color') {
          @case ('gradient') {
            <app-color-control label="From" [value]="st.gradientFrom" (valueChange)="set('gradientFrom', $event)" />
            <app-color-control label="To" [value]="st.gradientTo" (valueChange)="set('gradientTo', $event)" />
            <app-range-control label="Angle" [value]="st.gradientAngle" [min]="0" [max]="360" unit="°" [fallback]="135" (valueChange)="set('gradientAngle', $event)" />
          }
          @case ('image') {
            <div class="field">
              <label [attr.for]="id + 'img'">Image</label>
              @if (st.backgroundImage) {
                <div class="image-preview">
                  <img [src]="assetUrl(st.backgroundImage)" alt="" />
                  <button type="button" class="btn-icon" title="Remove image" (click)="set('backgroundImage', undefined)"><app-icon name="x" [size]="14" /></button>
                </div>
              }
              <div class="image-row">
                <input
                  [id]="id + 'img'"
                  type="url"
                  placeholder="https://… image URL"
                  [value]="st.backgroundImage?.startsWith('data:') ? '' : (st.backgroundImage ?? '')"
                  (change)="setText('backgroundImage', $event)"
                />
                <label class="btn btn-sm btn-secondary" title="Upload image">
                  <app-icon name="upload" [size]="14" />
                  <input type="file" accept="image/*" hidden (change)="upload($event)" />
                </label>
              </div>
            </div>
            <app-color-control label="Overlay colour" [value]="st.overlayColor" (valueChange)="set('overlayColor', $event)" />
            <app-range-control label="Overlay strength" [value]="st.overlayOpacity" [min]="0" [max]="100" unit="%" [fallback]="40" (valueChange)="set('overlayOpacity', $event)" />
            <app-toggle-control label="Parallax (fixed while scrolling)" [value]="st.parallax" (valueChange)="set('parallax', $event || undefined)" />
            <app-color-control label="Fallback colour" [value]="st.background" (valueChange)="set('background', $event ?? '')" />
          }
          @default {
            <app-color-control label="Colour" [value]="st.background || undefined" (valueChange)="set('background', $event ?? '')" />
          }
        }
      </details>

      <details class="grp" open>
        <summary>Text</summary>
        <app-color-control label="Text colour" [value]="st.textColor || undefined" (valueChange)="set('textColor', $event ?? '')" />
        <app-seg-control label="Alignment" [options]="aligns" [value]="st.align" (valueChange)="set('align', $event)" />
      </details>

      <details class="grp" open>
        <summary>Spacing</summary>
        <app-range-control label="Padding top" [value]="st.paddingTop ?? st.paddingY" [min]="0" [max]="240" [step]="4" [fallback]="80" (valueChange)="set('paddingTop', $event)" />
        <app-range-control label="Padding bottom" [value]="st.paddingBottom ?? st.paddingY" [min]="0" [max]="240" [step]="4" [fallback]="80" (valueChange)="set('paddingBottom', $event)" />
        <app-range-control label="Side padding (left and right)" [value]="st.paddingSide" [min]="0" [max]="160" [step]="4" [fallback]="24" (valueChange)="set('paddingSide', $event)" />
        <app-range-control label="Padding on phones" [value]="st.paddingMobile" [min]="0" [max]="160" [step]="4" [fallback]="56" (valueChange)="set('paddingMobile', $event)" />
        <app-range-control label="Margin top" [value]="st.marginTop" [min]="-120" [max]="160" [step]="4" [fallback]="0" (valueChange)="set('marginTop', $event)" />
        <app-range-control label="Margin bottom" [value]="st.marginBottom" [min]="-120" [max]="160" [step]="4" [fallback]="0" (valueChange)="set('marginBottom', $event)" />
      </details>

      <details class="grp" open>
        <summary>Layout</summary>
        <app-seg-control label="Content width" [options]="widths" [value]="st.width ?? 'boxed'" (valueChange)="set('width', $event)" />
        @if (st.width === 'custom') {
          <app-range-control label="Custom width" [value]="st.contentWidth" [min]="320" [max]="2560" [step]="10" [fallback]="960" (valueChange)="set('contentWidth', $event)" />
          <app-seg-control [options]="widthPresets" [value]="st.contentWidth" (valueChange)="set('contentWidth', $event)" />
          <p class="field-hint">Never wider than the screen: on smaller screens the section fills the width.</p>
        }
        @let h = height();
        <app-seg-control label="Height" [options]="heightModes" [value]="h.mode" (valueChange)="setHeightMode($event ?? 'auto')" />
        @if (h.mode !== 'auto') {
          <app-seg-control label="Unit" [options]="heightUnits" [value]="h.unit" (valueChange)="setHeightUnit($event ?? 'px')" />
          @for (d of heightDevices; track d.key) {
            <app-range-control
              [label]="d.label"
              [value]="h.values[d.key]"
              [min]="h.unit === 'vh' ? 10 : 100"
              [max]="h.unit === 'vh' ? 100 : 1600"
              [step]="h.unit === 'vh' ? 5 : 10"
              [unit]="h.unit === 'vh' ? '%' : 'px'"
              [fallback]="h.fallback[d.key]"
              [placeholder]="d.key === 'desktop' ? '' : 'Same as ' + (d.key === 'tablet' ? 'desktop' : 'tablet')"
              (valueChange)="setHeightValue(d.key, $event)"
            />
          }
          <app-seg-control label="Vertical position" [options]="valigns" [value]="st.verticalAlign ?? 'center'" (valueChange)="set('verticalAlign', $event)" />
          <p class="field-hint">
            {{ h.mode === 'fixed' ? 'Exactly this tall (padding included); content that doesn’t fit is cut off.' : 'At least this tall (padding included); grows with its content.' }}
            {{ h.unit === 'vh' ? '% of the visitor’s screen height.' : '' }}
          </p>
          @if (section().type === 'carousel') {
            <p class="field-hint">For the height of the slides themselves, use Slider → Slider height.</p>
          }
        }
      </details>

      <details class="grp">
        <summary>Borders</summary>
        <app-range-control label="Top border" [value]="st.borderTopWidth" [min]="0" [max]="16" [fallback]="0" (valueChange)="set('borderTopWidth', $event)" />
        <app-range-control label="Bottom border" [value]="st.borderBottomWidth" [min]="0" [max]="16" [fallback]="0" (valueChange)="set('borderBottomWidth', $event)" />
        <app-color-control label="Border colour" [value]="st.borderColor" (valueChange)="set('borderColor', $event)" />
      </details>
    } @else {
      <app-hide-on-control [value]="st.hideOn" (valueChange)="set('hideOn', $event)" />
      <app-seg-control label="Entrance animation" [options]="animations" [value]="st.animation ?? 'none'" (valueChange)="set('animation', $event === 'none' ? undefined : $event)" />
      <div class="field">
        <label [attr.for]="id + 'anchor'">Anchor id</label>
        <input [id]="id + 'anchor'" type="text" placeholder="e.g. pricing" [value]="section().data.anchor ?? ''" (change)="setAnchor($event)" />
        <span class="field-hint">Link to this section with <code>#{{ section().data.anchor || 'anchor-id' }}</code> in any button or menu.</span>
      </div>
      <div class="field">
        <label [attr.for]="id + 'cls'">CSS class</label>
        <input [id]="id + 'cls'" type="text" placeholder="my-section" [value]="st.cssClass ?? ''" (change)="setText('cssClass', $event)" />
      </div>
      <div class="field">
        <label [attr.for]="id + 'css'">Custom CSS</label>
        <textarea
          class="code"
          [id]="id + 'css'"
          rows="8"
          spellcheck="false"
          placeholder="/* Applies to this section only */&#10;h2 { color: tomato; }&#10;.lp-card { border-radius: 0; }"
          [value]="st.customCss ?? ''"
          (input)="setText('customCss', $event, false)"
        ></textarea>
        <span class="field-hint">Rules are scoped to this section. Plain properties apply to the section itself.</span>
      </div>
    }
  `,
})
export class SectionSettings {
  /** One-click values for the Custom width option (px). */
  protected readonly widthPresets: SegOption<number>[] = [1200, 1440, 1600, 1920].map((w) => ({ value: w, label: String(w), title: `${w}px` }));
  readonly section = input.required<Section>();
  readonly mode = input<'style' | 'advanced'>('style');
  readonly patch = output<SectionStylePatch>();
  /** Several style values changed together, as one undo step. */
  readonly patchMany = output<Partial<SectionStyle>>();
  readonly anchorChange = output<string>();

  private readonly toast = inject(ToastService);
  private readonly project = inject(ProjectService);
  protected readonly assetUrl = assetUrl;
  protected readonly id = `ss${nextId++}`;
  protected readonly animations = ANIMATION_OPTIONS;
  protected readonly bgTypes: SegOption<'color' | 'gradient' | 'image'>[] = [
    { value: 'color', label: 'Colour' },
    { value: 'gradient', label: 'Gradient' },
    { value: 'image', label: 'Image' },
  ];
  protected readonly aligns: SegOption<'left' | 'center'>[] = [
    { value: 'left', icon: 'align-left', label: 'Left' },
    { value: 'center', icon: 'align-center', label: 'Center' },
  ];
  protected readonly widths: SegOption<'boxed' | 'narrow' | 'full' | 'custom'>[] = [
    { value: 'narrow', label: 'Narrow' },
    { value: 'boxed', label: 'Boxed' },
    { value: 'full', label: 'Full' },
    { value: 'custom', label: 'Custom' },
  ];
  protected readonly valigns: SegOption<'start' | 'center' | 'end'>[] = [
    { value: 'start', label: 'Top' },
    { value: 'center', label: 'Middle' },
    { value: 'end', label: 'Bottom' },
  ];

  protected readonly heightModes: SegOption<'auto' | 'min' | 'fixed'>[] = [
    { value: 'auto', label: 'Auto', title: 'As tall as its content' },
    { value: 'min', label: 'Minimum', title: 'At least this tall' },
    { value: 'fixed', label: 'Fixed', title: 'Exactly this tall' },
  ];
  protected readonly heightUnits: SegOption<'px' | 'vh'>[] = [
    { value: 'px', label: 'Pixels' },
    { value: 'vh', label: '% of screen' },
  ];
  protected readonly heightDevices: { key: 'desktop' | 'tablet' | 'mobile'; label: string }[] = [
    { key: 'desktop', label: 'Desktop' },
    { key: 'tablet', label: 'Tablet' },
    { key: 'mobile', label: 'Mobile' },
  ];

  /** Height settings as shown in the panel (older sections store only minHeight in vh). */
  protected readonly height = computed(() => {
    const st = this.section().style;
    const legacy = !st.heightMode && !!st.minHeight;
    const mode = legacy ? 'min' : (st.heightMode ?? 'auto');
    const unit = legacy ? 'vh' : (st.heightUnit ?? 'px');
    const desktop = legacy ? st.minHeight : st.heightDesktop;
    const values = { desktop, tablet: legacy ? undefined : st.heightTablet, mobile: legacy ? undefined : st.heightMobile };
    const base = desktop ?? (unit === 'vh' ? 100 : 600);
    const fallback = { desktop: base, tablet: values.tablet ?? base, mobile: values.mobile ?? values.tablet ?? base };
    return { mode, unit, values, fallback };
  });

  protected setHeightMode(mode: 'auto' | 'min' | 'fixed'): void {
    if (mode === 'auto') {
      this.patchMany.emit({ heightMode: undefined, minHeight: undefined });
      return;
    }
    const h = this.height();
    this.patchMany.emit({
      heightMode: mode,
      heightUnit: h.unit,
      heightDesktop: h.values.desktop ?? (h.unit === 'vh' ? 100 : 600),
      heightTablet: h.values.tablet,
      heightMobile: h.values.mobile,
      minHeight: undefined,
    });
  }

  protected setHeightUnit(unit: 'px' | 'vh'): void {
    if (unit === this.height().unit) return;
    // Values don't carry over between px and %: start from a sensible default.
    this.patchMany.emit({ heightUnit: unit, heightDesktop: unit === 'vh' ? 100 : 600, heightTablet: undefined, heightMobile: undefined });
  }

  protected setHeightValue(device: 'desktop' | 'tablet' | 'mobile', value: number | undefined): void {
    const key = device === 'desktop' ? 'heightDesktop' : device === 'tablet' ? 'heightTablet' : 'heightMobile';
    if (device === 'desktop' && value === undefined) value = this.height().unit === 'vh' ? 100 : 600;
    this.set(key, value);
  }

  protected set(key: keyof SectionStyle, value: unknown): void {
    this.patch.emit({ key, value });
  }

  protected setText(key: keyof SectionStyle, e: Event, trim = true): void {
    const raw = (e.target as HTMLInputElement).value;
    const v = trim ? raw.trim() : raw;
    this.set(key, v || undefined);
  }

  protected setAnchor(e: Event): void {
    const v = (e.target as HTMLInputElement).value.trim().replace(/^#/, '').replace(/\s+/g, '-');
    this.anchorChange.emit(v);
  }

  protected async upload(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      this.set('backgroundImage', await this.project.uploadImage(file, await readImageAsDataUrl(file, 2000)));
    } catch (err) {
      this.toast.show(err instanceof Error ? err.message : 'Upload failed', 'error');
    }
  }
}
