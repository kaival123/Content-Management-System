import { Injectable, inject } from '@angular/core';
import { EditHistory } from './edit-history';
import { MenuItem } from './engine/render';
import { LandingPage, PageNode, PageStatus, Website } from './models';
import { PageStore } from './page-store';
import { ProjectService } from './project.service';
import { flatten, findByPath, findNode, insertNode, movePage, pathOf, removeNode, updateNode } from './site-tree';
import { DEFAULT_THEME } from './styles';
import { PageTemplate, TemplatePage, instantiateSections } from './templates';
import { uid } from './util';
import { WebsiteStore } from './website-store';

/**
 * Operations that span a website and its pages: creating websites from templates,
 * adding/moving/removing pages in the page tree, links between pages and menus.
 */
@Injectable({ providedIn: 'root' })
export class SiteService {
  private readonly websites = inject(WebsiteStore);
  private readonly pages = inject(PageStore);
  private readonly project = inject(ProjectService);
  private readonly edits = inject(EditHistory);

  // --- websites ---------------------------------------------------------------------------------

  /** Creates a website with all pages of `template`. Returns the homepage. */
  async createWebsite(input: { name: string; slug?: string; template: PageTemplate; description?: string }): Promise<LandingPage> {
    const slug = this.websites.uniqueSlug(input.slug || input.name);
    const now = new Date().toISOString();
    const toNode = (p: TemplatePage): PageNode => ({
      slug: p.slug,
      ...(p.hideInMenu ? { hideInMenu: true } : {}),
      ...(p.menuLabel ? { menuLabel: p.menuLabel } : {}),
      ...(p.children?.length ? { children: p.children.map(toNode) } : {}),
    });
    const template = input.template;
    const tree = (template.pages?.length ? template.pages : [{ slug: 'home', title: 'Home', sections: [] }]).map(toNode);
    const website: Website = {
      id: uid('w_'),
      slug,
      name: input.name.trim() || 'Untitled website',
      status: 'draft',
      templateId: template.id,
      homepage: tree[0].slug,
      pages: tree,
      theme: { ...DEFAULT_THEME, ...(this.project.config().defaultTheme ?? {}), ...template.theme },
      customCss: '',
      createdAt: now,
      updatedAt: now,
    };
    await this.websites.create(website);

    let home: LandingPage | null = null;
    const walk = (list: TemplatePage[]) => {
      for (const p of list) {
        const page = this.pages.create({
          website: slug,
          title: p.title,
          slug: p.slug,
          templateId: template.id,
          sections: instantiateSections(p.sections),
          description: home ? undefined : input.description,
        });
        home ??= page;
        walk(p.children ?? []);
      }
    };
    walk(template.pages?.length ? template.pages : [{ slug: 'home', title: 'Home', sections: [] }]);
    return home!;
  }

  async deleteWebsite(slug: string): Promise<void> {
    await this.websites.remove(slug);
    this.pages.dropWebsite(slug);
  }

  setStatus(site: string, status: PageStatus): void {
    this.websites.update(site, (w) => (w.status = status));
  }

  rename(site: string, name: string): void {
    this.websites.update(site, (w) => (w.name = name), 'name');
  }

  /** Imports pages saved in this browser by the earlier CMS as single-page websites. */
  async importBrowserPages(): Promise<number> {
    const legacy = this.pages.browserPages();
    for (const p of legacy) {
      const blank = this.project.templates().find((t) => t.id === 'blank') ?? { id: 'blank', kind: 'single', category: 'Blank', name: 'Blank', description: '', preview: [], theme: {}, pages: [] };
      const home = await this.createWebsite({ name: p.title || 'Imported page', slug: p.slug, template: { ...blank, theme: p.theme ?? {} } as PageTemplate });
      this.pages.update(home.id, (d) => {
        d.title = p.title || d.title;
        d.seo = { metaTitle: p.seo?.metaTitle ?? '', metaDescription: p.seo?.metaDescription ?? '' };
        d.sections = p.sections ?? [];
        d.customCss = (p.theme as { customCss?: string })?.customCss ?? '';
      });
      if (p.status === 'published') this.setStatus(home.website, 'published');
    }
    this.pages.retireBrowserPages();
    return legacy.length;
  }

  // --- pages ------------------------------------------------------------------------------------

  /** Adds a page to a website's tree (after `after`, or as a sub-page of `parent`). */
  addPage(site: string, input: { title: string; slug?: string; parent?: string; after?: string; sections?: LandingPage['sections'] }): LandingPage {
    const page = this.pages.create({
      website: site,
      title: input.title,
      slug: input.slug || input.title,
      templateId: 'blank',
      sections: input.sections ?? [],
    });
    this.websites.update(site, (w) => {
      w.pages = insertNode(w.pages, { slug: page.slug }, { parent: input.parent, after: input.parent ? undefined : input.after });
      w.homepage ??= page.slug;
    });
    // Earlier snapshots of the page tree don't include the new page.
    this.edits.clearSite(site);
    return page;
  }

  duplicatePage(pageId: string): LandingPage | undefined {
    const source = this.pages.getById(pageId);
    if (!source) return undefined;
    const copy = this.pages.duplicate(pageId);
    if (!copy) return undefined;
    this.websites.update(source.website, (w) => (w.pages = insertNode(w.pages, { slug: copy.slug }, { after: source.slug })));
    this.edits.clearSite(source.website);
    return copy;
  }

  /** Slugs that would be deleted together with a page (the page and its sub-pages). */
  subtree(site: string, slug: string): string[] {
    const node = findNode(this.websites.get(site)?.pages ?? [], slug);
    return node ? flatten([node]).map((n) => n.slug) : [slug];
  }

  async deletePage(pageId: string): Promise<void> {
    const page = this.pages.getById(pageId);
    if (!page) return;
    const site = page.website;
    const slugs = this.subtree(site, page.slug);
    for (const s of slugs) {
      const p = this.pages.getBySlug(site, s);
      if (p) await this.pages.remove(p.id);
    }
    this.websites.update(site, (w) => {
      [w.pages] = removeNode(w.pages, page.slug);
      if (w.homepage && slugs.includes(w.homepage)) w.homepage = w.pages[0]?.slug ?? null;
    });
    // Deleting can't be undone, and earlier snapshots of the page tree still list the page.
    this.edits.clearSite(site);
  }

  renamePage(pageId: string, title: string): void {
    this.pages.update(pageId, (p) => (p.title = title), 'title');
  }

  /**
   * Changes a page's URL slug: renames its folder (on save), updates the page tree,
   * the homepage, and every "page:<old>" link on the website's pages.
   */
  changeSlug(pageId: string, newSlug: string): string | null {
    const page = this.pages.getById(pageId);
    if (!page || page.slug === newSlug) return null;
    if (this.pages.isSlugTaken(page.website, newSlug, pageId)) return 'Another page of this website already uses this URL.';
    const old = page.slug;
    // One undo step for the page, the page tree and the rewritten links.
    this.edits.group(() => this.applySlug(page, old, newSlug));
    return null;
  }

  private applySlug(page: LandingPage, old: string, newSlug: string): void {
    const pageId = page.id;
    this.pages.update(pageId, (p) => (p.slug = newSlug));
    this.websites.update(page.website, (w) => {
      w.pages = updateNode(w.pages, old, { slug: newSlug });
      if (w.homepage === old) w.homepage = newSlug;
    });
    const pattern = new RegExp(`^page:${old.replace(/[-]/g, '\\-')}(?=$|#)`);
    for (const other of this.pages.pagesOf(page.website)) {
      if (!JSON.stringify(other.sections).includes(`"page:${old}`)) continue;
      this.pages.update(other.id, (p) => {
        p.sections = JSON.parse(JSON.stringify(p.sections), (_k, v) => (typeof v === 'string' ? v.replace(pattern, `page:${newSlug}`) : v));
      });
    }
  }

  setHomepage(site: string, slug: string): void {
    this.websites.update(site, (w) => (w.homepage = slug));
  }

  move(site: string, slug: string, how: 'up' | 'down' | 'indent' | 'outdent'): void {
    this.websites.update(site, (w) => (w.pages = movePage(w.pages, slug, how)));
  }

  setMenuOptions(site: string, slug: string, patch: Pick<PageNode, 'hideInMenu' | 'menuLabel'>): void {
    this.websites.update(site, (w) => (w.pages = updateNode(w.pages, slug, patch)), `menu.${slug}.${Object.keys(patch).join()}`);
  }

  // --- URLs, links and menus --------------------------------------------------------------------

  /** Path segments of a page within its website ([] for the homepage). */
  segments(site: string, slug: string): string[] {
    const w = this.websites.get(site);
    if (!w || w.homepage === slug) return [];
    return pathOf(w.pages, slug) ?? [slug];
  }

  /** In-app URL of a page: /<site> for the homepage, /<site>/<path> for the others. */
  pageUrl(site: string, slug: string): string {
    const segs = this.segments(site, slug);
    return `/${site}${segs.length ? '/' + segs.join('/') : ''}`;
  }

  /** Page for an in-app URL path (segments after /<site>). Empty path = homepage. */
  pageForPath(site: string, path: string[]): LandingPage | undefined {
    const w = this.websites.get(site);
    if (!w) return undefined;
    if (!path.length) return w.homepage ? this.pages.getBySlug(site, w.homepage) : undefined;
    const node = findByPath(w.pages, path);
    return node ? this.pages.getBySlug(site, node.slug) : undefined;
  }

  /**
   * Navigation for templates (@menu): the page tree without hidden pages, with
   * hrefs from `href` and the current page marked active.
   */
  menu(site: string, currentSlug: string, href: (slug: string) => string): MenuItem[] {
    const w = this.websites.get(site);
    if (!w) return [];
    const toItem = (n: PageNode): MenuItem | null => {
      if (n.hideInMenu) return null;
      const page = this.pages.getBySlug(site, n.slug);
      const children = (n.children ?? []).map(toItem).filter((x): x is MenuItem => !!x);
      return {
        label: n.menuLabel || page?.title || n.slug,
        href: href(n.slug),
        active: n.slug === currentSlug || children.some((c) => c.active),
        children,
      };
    };
    return w.pages.map(toItem).filter((x): x is MenuItem => !!x);
  }

  /** Relative link from one page's folder to another's in the static build. */
  static relativeLink(from: string[], to: string[], hash = ''): string {
    const up = '../'.repeat(from.length);
    const target = to.length ? `${to.join('/')}/` : '';
    return `${up}${target}` + hash || './';
  }
}
