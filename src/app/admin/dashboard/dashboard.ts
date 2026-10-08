import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { SubmissionStore } from '../../core/submission-store';
import { LandingPage, PageStatus, Website } from '../../core/models';
import { PageStore } from '../../core/page-store';
import { ProjectService } from '../../core/project.service';
import { SiteService } from '../../core/site.service';
import { flatten } from '../../core/site-tree';
import { WebsiteStore } from '../../core/website-store';
import { readFileAsText } from '../../shared/files';
import { Icon } from '../../shared/icon';
import { PageThumb } from '../../shared/page-thumb';
import { ToastService } from '../../shared/toast';

type Filter = 'all' | PageStatus;

@Component({
  selector: 'app-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, DatePipe, Icon, PageThumb],
  templateUrl: './dashboard.html',
})
export class Dashboard {
  protected readonly websites = inject(WebsiteStore);
  protected readonly pages = inject(PageStore);
  protected readonly submissions = inject(SubmissionStore);
  private readonly site = inject(SiteService);
  private readonly project = inject(ProjectService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  /** Pages saved in this browser by the earlier, browser-only version of the CMS. */
  protected readonly browserPages = signal(this.pages.browserPages().length);

  protected readonly query = signal('');
  protected readonly filter = signal<Filter>('all');

  protected readonly stats = computed(() => {
    const sites = this.websites.websites();
    const published = sites.filter((w) => w.status === 'published').length;
    return { websites: sites.length, pages: this.pages.pages().length, published, leads: this.submissions.count() };
  });

  protected readonly visible = computed(() => {
    const q = this.query().trim().toLowerCase();
    const f = this.filter();
    return this.websites
      .sorted()
      .filter((w) => f === 'all' || w.status === f)
      .filter((w) => !q || w.name.toLowerCase().includes(q) || w.slug.includes(q));
  });

  protected readonly filters: { value: Filter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'published', label: 'Published' },
    { value: 'draft', label: 'Drafts' },
  ];

  protected homepage(w: Website): LandingPage | undefined {
    return (w.homepage && this.pages.getBySlug(w.slug, w.homepage)) || this.pages.pagesOf(w.slug)[0];
  }

  protected pageCount(w: Website): number {
    return this.pages.pagesOf(w.slug).length;
  }

  protected pageTitles(w: Website): string[] {
    return flatten(w.pages)
      .slice(0, 8)
      .map((n) => this.pages.getBySlug(w.slug, n.slug)?.title ?? n.slug);
  }

  protected edit(w: Website): void {
    const home = this.homepage(w);
    if (home) void this.router.navigate(['/admin/pages', home.id]);
  }

  protected togglePublish(w: Website): void {
    const next: PageStatus = w.status === 'published' ? 'draft' : 'published';
    this.site.setStatus(w.slug, next);
    this.toast.show(next === 'published' ? `“${w.name}” is live` : `“${w.name}” moved to drafts`);
  }

  protected async remove(w: Website): Promise<void> {
    const n = this.pageCount(w);
    if (!confirm(`Delete “${w.name}” and its ${n} page${n === 1 ? '' : 's'}? You can restore it from Git if it was committed.`)) return;
    try {
      await this.site.deleteWebsite(w.slug);
      this.toast.show('Website deleted', 'info');
    } catch (e) {
      this.toast.show((e as Error).message, 'error');
    }
  }

  protected openInVsCode(w: Website): void {
    this.project.openInEditor(`websites/${w.slug}/website.json`).catch((e: Error) => this.toast.show(e.message, 'error'));
  }

  protected async importBrowserPages(): Promise<void> {
    const n = await this.site.importBrowserPages();
    this.browserPages.set(0);
    this.toast.show(`Imported ${n} page${n === 1 ? '' : 's'} into the project folder`);
  }

  /** Imports an exported page JSON as a new single-page website. */
  protected async importPage(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const parsed = JSON.parse(await readFileAsText(file));
      const blank = this.project.templates().find((t) => t.id === 'blank');
      if (!blank) throw new Error('The blank template (site/templates/blank.json) is missing.');
      const home = await this.site.createWebsite({ name: parsed.title || 'Imported page', slug: parsed.slug, template: { ...blank, theme: parsed.theme ?? {} } });
      this.pages.update(home.id, (p) => (p.sections = parsed.sections ?? []));
      this.toast.show(`Imported “${parsed.title || 'page'}”`);
      void this.router.navigate(['/admin/pages', home.id]);
    } catch (e) {
      this.toast.show(e instanceof Error ? e.message : 'Import failed', 'error');
    }
  }

  protected setQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }
}
