import { ChangeDetectionStrategy, Component, computed, effect, inject, input } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { PageStore } from '../core/page-store';
import { withSharedSections } from '../core/shared-sections';
import { SiteService } from '../core/site.service';
import { WebsiteStore } from '../core/website-store';
import { PageRenderer } from '../renderer/page-renderer';

/**
 * Public route for websites: /<website> renders the homepage, /<website>/<path>
 * the page at that place in the page tree. Unpublished websites need ?preview=1.
 */
@Component({
  selector: 'app-public-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageRenderer, RouterLink],
  template: `
    @if (page(); as p) {
      @if (p.status === 'draft') {
        <div class="preview-bar">
          Draft preview — this website is not published yet.
          <a [routerLink]="['/admin/pages', p.id]">Back to editor</a>
        </div>
      }
      <app-page-renderer [page]="shown()!" />
    } @else {
      <div class="not-found">
        <h1>404</h1>
        <p>This page doesn't exist or isn't published.</p>
        <a routerLink="/admin">Go to admin</a>
      </div>
    }
  `,
})
export class PublicPage {
  readonly site = input.required<string>();
  /** Page path within the website ("" for the homepage), from the route matcher. */
  readonly path = input<string>('');
  /** Query param; any value lets admins view drafts. */
  readonly preview = input<string>();

  private readonly sites = inject(SiteService);
  private readonly websites = inject(WebsiteStore);
  private readonly store = inject(PageStore);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);

  protected readonly page = computed(() => {
    const segs = (this.path() ?? '').split('/').filter(Boolean);
    const p = this.sites.pageForPath(this.site(), segs);
    if (!p) return undefined;
    return p.status === 'published' || this.preview() !== undefined ? p : undefined;
  });

  /** The page plus the website-wide sections (e.g. the mini header) that live on other pages. */
  protected readonly shown = computed(() => {
    const p = this.page();
    return p ? withSharedSections(p, this.store.pagesOf(p.website)) : undefined;
  });

  constructor() {
    effect(() => {
      const p = this.page();
      const w = p ? this.websites.get(p.website) : undefined;
      this.title.setTitle(p ? p.seo.metaTitle || (w?.homepage === p.slug ? (w?.name ?? p.title) : `${p.title} · ${w?.name ?? ''}`) : 'Page not found');
      if (p?.seo.metaDescription) {
        this.meta.updateTag({ name: 'description', content: p.seo.metaDescription });
      } else {
        this.meta.removeTag('name="description"');
      }
    });
  }
}
