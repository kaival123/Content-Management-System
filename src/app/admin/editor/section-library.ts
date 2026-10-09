import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { api } from '../../core/api';
import { LandingPage, Theme } from '../../core/models';
import { ProjectService } from '../../core/project.service';
import { sectionDefs } from '../../core/section-registry';
import { LibraryItem, SectionPreset, instantiateSection } from '../../core/templates';
import { Icon } from '../../shared/icon';
import { PageThumb } from '../../shared/page-thumb';
import { ToastService } from '../../shared/toast';

/** A library card: a preset from site/library/, or a component with its default content. */
interface Card {
  id: string;
  name: string;
  description: string;
  category: string;
  preset: SectionPreset;
  /** Set for files the user may delete (saved sections). */
  file?: string;
}

const BASIC = 'components';

/**
 * Section library: browse presets by category (site/library/<category>/*.json),
 * preview them in the page's theme and insert one into the page. "Basic components"
 * lists every component with its default content.
 */
@Component({
  selector: 'app-section-library',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, PageThumb],
  template: `
    <div class="modal-backdrop" (click)="close.emit()"></div>
    <div class="modal modal-wide lib" role="dialog" aria-modal="true" aria-labelledby="lib-title">
      <header class="modal-head">
        <div>
          <h2 id="lib-title">Add section</h2>
          <p>Pick a ready-made section — you can customise everything after inserting it.</p>
        </div>
        <label class="adm-search lib-search">
          <app-icon name="search" [size]="16" />
          <input type="search" placeholder="Search sections…" [value]="query()" (input)="setQuery($event)" autofocus />
        </label>
        <button type="button" class="btn-icon" title="Close (Esc)" (click)="close.emit()"><app-icon name="x" /></button>
      </header>
      <div class="lib-body">
        <nav class="lib-cats">
          @for (c of categories(); track c.id) {
            <button type="button" [class.active]="category() === c.id && !query()" (click)="pick(c.id)">
              {{ c.label }} <span class="adm-count">{{ c.count }}</span>
            </button>
          }
        </nav>
        <div class="lib-grid">
          @for (card of shown(); track card.id) {
            <article class="lib-card">
              <button type="button" class="lib-thumb" (click)="choose(card)" [attr.aria-label]="'Insert ' + card.name">
                @defer (on viewport) {
                  <app-page-thumb [page]="previewPage(card)" />
                } @placeholder {
                  <span class="lib-thumb-ph" aria-hidden="true"></span>
                }
                <span class="lib-name">{{ card.name }}</span>
                <span class="lib-insert"><app-icon name="plus" [size]="16" /> Insert</span>
              </button>
              <div class="lib-info">
                <strong>{{ card.name }}</strong>
                @if (card.description) {
                  <small>{{ card.description }}</small>
                }
              </div>
              @if (card.file) {
                <button type="button" class="btn-icon sm danger lib-del" title="Delete saved section" (click)="remove(card)"><app-icon name="trash" [size]="13" /></button>
              }
            </article>
          } @empty {
            <p class="field-hint lib-empty">
              @if (category() === 'saved' && !query()) {
                No saved sections yet. Select any section and use <b>Save to library</b> to reuse it on other pages.
              } @else {
                Nothing found.
              }
            </p>
          }
          @if (hidden() > 0) {
            <div class="lib-more">
              <button type="button" class="btn" (click)="more()">Show {{ hidden() > pageSize ? pageSize : hidden() }} more <span class="adm-count">{{ hidden() }} not shown</span></button>
            </div>
          }
        </div>
      </div>
    </div>
  `,
  host: { '(document:keydown.escape)': 'close.emit()' },
})
export class SectionLibrary {
  /** Theme of the page being edited, so previews match it. */
  readonly theme = input.required<Theme>();
  readonly insert = output<SectionPreset>();
  readonly close = output<void>();

  private readonly project = inject(ProjectService);
  private readonly toast = inject(ToastService);

  /** What is typed in the box (updates at once). */
  protected readonly query = signal('');
  /** The search actually applied: follows the box after a short pause, so typing never blocks on rendering. */
  private readonly term = signal('');
  private termTimer: ReturnType<typeof setTimeout> | undefined;
  /** Previews are live renders, so long lists are shown a page at a time. */
  protected readonly pageSize = 24;
  private readonly limit = signal(this.pageSize);
  protected readonly category = signal('hero');

  private readonly cards = computed<Card[]>(() => {
    const presets: Card[] = this.project.library().map((item: LibraryItem) => ({
      id: item.id,
      name: item.name,
      description: item.description ?? '',
      category: item.category,
      preset: item.section,
      file: item.category === 'saved' ? item.file : undefined,
    }));
    const basics: Card[] = sectionDefs().map((d) => ({
      id: `${BASIC}/${d.type}`,
      name: d.label,
      description: d.description,
      category: BASIC,
      preset: { type: d.type },
    }));
    return [...presets, ...basics];
  });

  protected readonly categories = computed(() => {
    const labels = this.project.config().libraryCategories ?? [];
    const counts = new Map<string, number>();
    for (const c of this.cards()) counts.set(c.category, (counts.get(c.category) ?? 0) + 1);
    const known = labels.map((l) => ({ id: l.id, label: l.label, count: counts.get(l.id) ?? 0 })).filter((c) => c.count || c.id === 'saved');
    // Categories that exist as folders but aren't listed in config/site.json.
    const extra = [...counts.keys()]
      .filter((id) => id !== BASIC && !labels.some((l) => l.id === id))
      .map((id) => ({ id, label: id.replace(/(^|-)(\w)/g, (_, s, c) => (s ? ' ' : '') + c.toUpperCase()), count: counts.get(id)! }));
    return [...known, ...extra, { id: BASIC, label: 'Basic components', count: counts.get(BASIC) ?? 0 }];
  });

  /** Everything that matches the search or the open category. */
  private readonly matches = computed(() => {
    const words = this.term().trim().toLowerCase().split(/s+/).filter(Boolean);
    if (words.length) {
      return this.cards().filter((c) => {
        const hay = `${c.name} ${c.description} ${c.category} ${c.preset.type}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      });
    }
    return this.cards().filter((c) => c.category === this.category());
  });

  protected readonly shown = computed(() => this.matches().slice(0, this.limit()));
  protected readonly hidden = computed(() => Math.max(0, this.matches().length - this.limit()));

  private readonly previews = new Map<string, { theme: Theme; page: LandingPage }>();

  /** A throwaway one-section page per card, in the current theme. */
  protected previewPage(card: Card): LandingPage {
    const cached = this.previews.get(card.id);
    if (cached && cached.theme === this.theme()) return cached.page;
    const page: LandingPage = {
      id: `lib-${card.id}`,
      website: '',
      title: card.name,
      slug: 'preview',
      customCss: '',
      status: 'draft',
      templateId: '',
      seo: { metaTitle: '', metaDescription: '' },
      theme: this.theme(),
      sections: [instantiateSection(card.preset)],
      createdAt: '',
      updatedAt: '',
    };
    this.previews.set(card.id, { theme: this.theme(), page });
    return page;
  }

  protected pick(id: string): void {
    clearTimeout(this.termTimer);
    this.query.set('');
    this.term.set('');
    this.limit.set(this.pageSize);
    this.category.set(id);
  }

  protected setQuery(e: Event): void {
    const value = (e.target as HTMLInputElement).value;
    this.query.set(value);
    clearTimeout(this.termTimer);
    this.termTimer = setTimeout(() => {
      this.term.set(value);
      this.limit.set(this.pageSize);
    }, 250);
  }

  protected more(): void {
    this.limit.update((n) => n + this.pageSize);
  }

  protected choose(card: Card): void {
    this.insert.emit(card.preset);
  }

  protected async remove(card: Card): Promise<void> {
    if (!card.file || !confirm(`Delete the saved section “${card.name}”? Pages that already use it keep their copy.`)) return;
    try {
      await api('DELETE', `/api/file?path=${encodeURIComponent(card.file)}`);
      this.toast.show('Saved section deleted', 'info');
    } catch (e) {
      this.toast.show((e as Error).message, 'error');
    }
  }
}
