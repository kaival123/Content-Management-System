import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { LandingPage, PageNode, Website } from '../../core/models';
import { PageStore } from '../../core/page-store';
import { ProjectService } from '../../core/project.service';
import { SiteService } from '../../core/site.service';
import { parentOf } from '../../core/site-tree';
import { TemplatePage, instantiateSections, templatePages } from '../../core/templates';
import { withFreshIds } from '../../core/section-registry';
import { slugify, uid } from '../../core/util';
import { Icon } from '../../shared/icon';
import { ToastService } from '../../shared/toast';

interface Row {
  node: PageNode;
  page: LandingPage | undefined;
  depth: number;
  first: boolean;
  last: boolean;
  canIndent: boolean;
}

/**
 * The website's pages as a tree: open, add, rename, change URL, duplicate, delete,
 * reorder, nest (sub-pages), set the homepage and menu options. Changes are saved to
 * website.json (order/nesting) and the page folders.
 */
@Component({
  selector: 'app-pages-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    @let w = website();
    <div class="site-head">
      <input class="site-name" [value]="w.name" (change)="renameSite($event)" aria-label="Website name" />
      <small>/{{ w.slug }} · {{ rows().length }} page{{ rows().length === 1 ? '' : 's' }}</small>
    </div>

    <ul class="page-tree">
      @for (r of rows(); track r.node.slug) {
        <li class="page-row" [class.current]="r.page?.id === currentId()" [style.padding-left.px]="6 + r.depth * 16">
          <button type="button" class="page-open" (click)="r.page && open.emit(r.page.id)" [title]="'Open ' + (r.page?.title ?? r.node.slug)">
            @if (r.depth) {
              <span class="page-branch">└</span>
            }
            <app-icon [name]="w.homepage === r.node.slug ? 'home' : 'file'" [size]="14" />
            <span class="page-title">{{ r.page?.title ?? r.node.slug }}</span>
            @if (r.node.hideInMenu) {
              <app-icon name="eye-off" [size]="12" class="page-flag" />
            }
          </button>
          <span class="page-actions">
            <button type="button" class="btn-icon sm" title="Move up" [disabled]="r.first" (click)="site.move(w.slug, r.node.slug, 'up')"><app-icon name="up" [size]="13" /></button>
            <button type="button" class="btn-icon sm" title="Move down" [disabled]="r.last" (click)="site.move(w.slug, r.node.slug, 'down')"><app-icon name="down" [size]="13" /></button>
            <button type="button" class="btn-icon sm" title="Page settings" [class.active-icon]="editing() === r.node.slug" (click)="toggleEdit(r.node.slug)"><app-icon name="settings" [size]="13" /></button>
          </span>
        </li>
        @if (editing() === r.node.slug && r.page; as page) {
          <li class="page-settings" [style.margin-left.px]="6 + r.depth * 16">
            <div class="field">
              <label [attr.for]="'pt-' + r.node.slug">Page name</label>
              <input [id]="'pt-' + r.node.slug" type="text" [value]="page.title" (change)="rename(page, $event)" />
            </div>
            <div class="field">
              <label [attr.for]="'pu-' + r.node.slug">URL</label>
              <div class="input-prefix">
                <span>/{{ parentPath(r.node.slug) }}</span>
                <input [id]="'pu-' + r.node.slug" type="text" [value]="page.slug" (change)="changeSlug(page, $event)" />
              </div>
              @if (slugError()) {
                <span class="field-error">{{ slugError() }}</span>
              }
            </div>
            <div class="field">
              <label [attr.for]="'pm-' + r.node.slug">Menu label <small>(optional)</small></label>
              <input [id]="'pm-' + r.node.slug" type="text" [placeholder]="page.title" [value]="r.node.menuLabel ?? ''" (change)="setMenuLabel(r.node, $event)" />
            </div>
            <label class="ctl ctl-toggle">
              <span class="ctl-label">Show in navigation menus</span>
              <input type="checkbox" class="switch" [checked]="!r.node.hideInMenu" (change)="toggleMenu(r.node)" />
            </label>
            <div class="page-setting-actions">
              <button type="button" class="btn btn-sm btn-secondary" [disabled]="w.homepage === r.node.slug" (click)="setHome(r.node)"><app-icon name="home" [size]="13" /> Set as homepage</button>
              <button type="button" class="btn btn-sm btn-secondary" (click)="startAdd(r.node.slug)"><app-icon name="plus" [size]="13" /> Add sub-page</button>
              <button type="button" class="btn btn-sm btn-secondary" [disabled]="!r.canIndent" (click)="site.move(w.slug, r.node.slug, 'indent')" title="Make it a sub-page of the page above">Nest →</button>
              <button type="button" class="btn btn-sm btn-secondary" [disabled]="!r.depth" (click)="site.move(w.slug, r.node.slug, 'outdent')" title="Move up one level">← Un-nest</button>
              <button type="button" class="btn btn-sm btn-secondary" (click)="duplicate(page)"><app-icon name="copy" [size]="13" /> Duplicate</button>
              <button type="button" class="btn btn-sm btn-danger" (click)="remove(page)"><app-icon name="trash" [size]="13" /> Delete</button>
            </div>
          </li>
        }
      }
    </ul>

    @if (adding() !== null) {
      <form class="page-add" (submit)="add($event)">
        <strong>{{ adding() ? 'New sub-page of “' + titleOf(adding()!) + '”' : 'New page' }}</strong>
        <div class="field">
          <label for="pa-title">Page name</label>
          <input id="pa-title" name="title" type="text" placeholder="e.g. About us" required autofocus />
        </div>
        <div class="field">
          <label for="pa-start">Start with</label>
          <select id="pa-start" name="start">
            <option value="blank">Blank page (empty canvas)</option>
            <option value="copy">Copy of the current page</option>
            @for (t of templatePages(); track t.key) {
              <option [value]="t.key">{{ t.label }}</option>
            }
          </select>
        </div>
        <div class="page-setting-actions">
          <button type="button" class="btn btn-sm btn-secondary" (click)="adding.set(null)">Cancel</button>
          <button type="submit" class="btn btn-sm btn-primary"><app-icon name="plus" [size]="13" /> Add page</button>
        </div>
      </form>
    } @else {
      <button type="button" class="btn btn-dashed btn-block" (click)="startAdd('')"><app-icon name="plus" [size]="16" /> Add page</button>
    }
  `,
})
export class PagesPanel {
  readonly website = input.required<Website>();
  readonly currentId = input<string | null>(null);
  readonly open = output<string>();

  protected readonly site = inject(SiteService);
  private readonly pages = inject(PageStore);
  private readonly project = inject(ProjectService);
  private readonly toast = inject(ToastService);

  protected readonly editing = signal<string | null>(null);
  /** null: not adding; '': a top-level page; otherwise the parent's slug. */
  protected readonly adding = signal<string | null>(null);
  protected readonly slugError = signal('');

  protected readonly rows = computed<Row[]>(() => {
    const w = this.website();
    const out: Row[] = [];
    const walk = (nodes: PageNode[], depth: number) =>
      nodes.forEach((node, i) => {
        out.push({ node, page: this.pages.getBySlug(w.slug, node.slug), depth, first: i === 0, last: i === nodes.length - 1, canIndent: i > 0 });
        walk(node.children ?? [], depth + 1);
      });
    walk(w.pages, 0);
    return out;
  });

  /** Pages from every template, offered as starting points for new pages. */
  protected readonly templatePages = computed(() =>
    this.project.templates().flatMap((t) =>
      templatePages(t)
        .filter((p) => p.sections.length)
        .map((p) => ({ key: `${t.id}::${p.slug}`, label: `${p.title} — from “${t.name}”`, page: p })),
    ),
  );

  protected titleOf(slug: string): string {
    return this.pages.getBySlug(this.website().slug, slug)?.title ?? slug;
  }

  protected parentPath(slug: string): string {
    const segs = this.site.segments(this.website().slug, slug);
    const parents = segs.slice(0, -1);
    return `p/${this.website().slug}/${parents.length ? parents.join('/') + '/' : ''}`;
  }

  protected toggleEdit(slug: string): void {
    this.slugError.set('');
    this.editing.set(this.editing() === slug ? null : slug);
  }

  protected renameSite(e: Event): void {
    const name = (e.target as HTMLInputElement).value.trim();
    if (name) this.site.rename(this.website().slug, name);
  }

  protected rename(page: LandingPage, e: Event): void {
    const title = (e.target as HTMLInputElement).value.trim();
    if (title) this.site.renamePage(page.id, title);
  }

  protected changeSlug(page: LandingPage, e: Event): void {
    const input = e.target as HTMLInputElement;
    const slug = slugify(input.value);
    if (!slug) {
      this.slugError.set('URL cannot be empty.');
      return;
    }
    const error = this.site.changeSlug(page.id, slug);
    this.slugError.set(error ?? '');
    if (!error) {
      input.value = slug;
      this.editing.set(slug);
      this.toast.show('URL changed — links to this page were updated');
    }
  }

  protected setMenuLabel(node: PageNode, e: Event): void {
    this.site.setMenuOptions(this.website().slug, node.slug, { menuLabel: (e.target as HTMLInputElement).value.trim() || undefined });
  }

  protected toggleMenu(node: PageNode): void {
    this.site.setMenuOptions(this.website().slug, node.slug, { hideInMenu: node.hideInMenu ? undefined : true });
  }

  protected setHome(node: PageNode): void {
    this.site.setHomepage(this.website().slug, node.slug);
    this.toast.show(`${this.titleOf(node.slug)} is now the homepage`);
  }

  protected duplicate(page: LandingPage): void {
    const copy = this.site.duplicatePage(page.id);
    if (copy) this.open.emit(copy.id);
  }

  protected async remove(page: LandingPage): Promise<void> {
    const slugs = this.site.subtree(page.website, page.slug);
    const extra = slugs.length - 1;
    if (!confirm(`Delete “${page.title}”${extra ? ` and its ${extra} sub-page${extra === 1 ? '' : 's'}` : ''}?`)) return;
    const wasCurrent = slugs.some((s) => this.pages.getBySlug(page.website, s)?.id === this.currentId());
    await this.site.deletePage(page.id);
    this.editing.set(null);
    if (wasCurrent) {
      const w = this.website();
      const next = (w.homepage && this.pages.getBySlug(w.slug, w.homepage)) || this.pages.pagesOf(w.slug)[0];
      if (next) this.open.emit(next.id);
    }
  }

  protected startAdd(parent: string): void {
    this.adding.set(parent);
  }

  protected add(event: Event): void {
    event.preventDefault();
    const form = new FormData(event.target as HTMLFormElement);
    const title = String(form.get('title') ?? '').trim();
    const start = String(form.get('start') ?? 'blank');
    if (!title) return;
    const w = this.website();
    let sections: LandingPage['sections'] = [];
    if (start === 'copy') {
      const current = this.currentId() ? this.pages.getById(this.currentId()!) : undefined;
      sections = structuredClone(current?.sections ?? []).map((s) => ({ ...s, id: uid('s_'), data: withFreshIds(s.data) }));
    } else if (start !== 'blank') {
      const t = this.templatePages().find((x) => x.key === start);
      if (t) sections = instantiateSections((t.page as TemplatePage).sections);
    }
    const parent = this.adding() || undefined;
    const currentSlug = this.currentId() ? this.pages.getById(this.currentId()!)?.slug : undefined;
    const after = parent ? undefined : currentSlug && !parentOf(w.pages, currentSlug) ? currentSlug : undefined;
    const page = this.site.addPage(w.slug, { title, parent, after, sections });
    this.adding.set(null);
    this.toast.show(`Added “${page.title}”`);
    this.open.emit(page.id);
  }
}
