import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { LandingPage } from '../../core/models';
import { ProjectService } from '../../core/project.service';
import { SiteService } from '../../core/site.service';
import { DEFAULT_THEME, PageTemplate, TemplatePage, instantiateSections, templatePages } from '../../core/templates';
import { slugify } from '../../core/util';
import { WebsiteStore } from '../../core/website-store';
import { Icon } from '../../shared/icon';
import { PageThumb } from '../../shared/page-thumb';
import { ToastService } from '../../shared/toast';

type Kind = 'single' | 'multi';

/** Create New Website → Single page / Multi-page → template (or blank) → name. */
@Component({
  selector: 'app-new-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, PageThumb],
  templateUrl: './new-page.html',
})
export class NewPage {
  private readonly project = inject(ProjectService);
  private readonly websites = inject(WebsiteStore);
  private readonly site = inject(SiteService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  protected readonly kind = signal<Kind>('single');
  protected readonly templateId = signal<string | null>(null);
  protected readonly name = signal('');
  protected readonly description = signal('');
  /** User-typed URL; null means "derive it from the name". */
  private readonly customSlug = signal<string | null>(null);
  protected readonly submitted = signal(false);
  protected readonly creating = signal(false);

  protected readonly slug = computed(() => this.customSlug() ?? slugify(this.name()));
  protected readonly slugTaken = computed(() => !!this.slug() && this.websites.isSlugTaken(this.slug()));
  protected readonly nameError = computed(() => (this.submitted() && !this.name().trim() ? 'Give your website a name.' : ''));

  /** Templates of the chosen kind, grouped: Blank first, then by category. */
  protected readonly groups = computed(() => {
    const list = this.project.templates().filter((t) => (t.kind ?? 'single') === this.kind());
    const byCategory = new Map<string, PageTemplate[]>();
    for (const t of list) {
      const cat = t.category || 'Other';
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat)!.push(t);
    }
    return [...byCategory.entries()]
      .sort(([a], [b]) => Number(b === 'Blank') - Number(a === 'Blank') || a.localeCompare(b))
      .map(([category, templates]) => ({ category, templates }));
  });

  protected readonly selected = computed(() => {
    const all = this.groups().flatMap((g) => g.templates);
    return all.find((t) => t.id === this.templateId()) ?? all.find((t) => t.category === 'Blank') ?? all[0] ?? null;
  });

  private readonly previewCache = new Map<string, LandingPage>();

  /** A throwaway page for the template's homepage so each card can show a real preview. */
  protected preview(t: PageTemplate): LandingPage {
    let page = this.previewCache.get(t.id);
    if (!page) {
      const home: TemplatePage = t.pages?.[0] ?? { slug: 'home', title: 'Home', sections: [] };
      page = {
        id: `preview-${t.id}`,
        website: `preview-${t.id}`,
        title: home.title,
        slug: home.slug,
        customCss: '',
        status: 'draft',
        templateId: t.id,
        seo: { metaTitle: '', metaDescription: '' },
        theme: { ...DEFAULT_THEME, ...(this.project.config().defaultTheme ?? {}), ...t.theme },
        sections: instantiateSections(home.sections),
        createdAt: '',
        updatedAt: '',
      };
      this.previewCache.set(t.id, page);
    }
    return page;
  }

  protected pageTitles(t: PageTemplate): string[] {
    return templatePages(t).map((p) => p.title);
  }

  protected setKind(kind: Kind): void {
    this.kind.set(kind);
    this.templateId.set(null);
  }

  protected setName(e: Event): void {
    this.name.set((e.target as HTMLInputElement).value);
  }

  protected setSlug(e: Event): void {
    this.customSlug.set(slugify((e.target as HTMLInputElement).value) || null);
  }

  protected setDescription(e: Event): void {
    this.description.set((e.target as HTMLTextAreaElement).value);
  }

  protected async create(event: Event): Promise<void> {
    event.preventDefault();
    this.submitted.set(true);
    const template = this.selected();
    if (!template) {
      this.toast.show('Choose a template first.', 'error');
      return;
    }
    if (!this.name().trim()) {
      // The name field is far below the templates: bring it into view so the reason is obvious.
      const input = document.getElementById('np-name') as HTMLInputElement | null;
      input?.scrollIntoView({ block: 'center' });
      input?.focus({ preventScroll: true });
      this.toast.show('Give your website a name to create it.', 'error');
      return;
    }
    this.creating.set(true);
    try {
      const home = await this.site.createWebsite({ name: this.name(), slug: this.slug(), template, description: this.description() });
      const n = templatePages(template).length || 1;
      this.toast.show(`Created “${this.name().trim()}” with ${n} page${n === 1 ? '' : 's'}`);
      void this.router.navigate(['/admin/pages', home.id]);
    } catch (e) {
      this.toast.show((e as Error).message, 'error');
    } finally {
      this.creating.set(false);
    }
  }
}
