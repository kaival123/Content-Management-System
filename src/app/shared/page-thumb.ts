import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, inject, input, signal } from '@angular/core';
import { LandingPage } from '../core/models';
import { PageRenderer } from '../renderer/page-renderer';

const RENDER_WIDTH = 1280;

/** Scaled-down live render of a page (desktop layout) that fits the host's width. */
@Component({
  selector: 'app-page-thumb',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageRenderer],
  host: { class: 'thumb', inert: '', 'aria-hidden': 'true' },
  template: `
    <div class="thumb-inner" [style.width.px]="width" [style.transform]="'scale(' + scale() + ')'">
      <app-page-renderer [page]="page()" [interactive]="false" />
    </div>
  `,
})
export class PageThumb {
  readonly page = input.required<LandingPage>();
  protected readonly width = RENDER_WIDTH;
  protected readonly scale = signal(0.25);

  constructor() {
    const el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const ro = new ResizeObserver(([entry]) => this.scale.set(entry.contentRect.width / RENDER_WIDTH));
      ro.observe(el);
      destroyRef.onDestroy(() => ro.disconnect());
    });
  }
}
