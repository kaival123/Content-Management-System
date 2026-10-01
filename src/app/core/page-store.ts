import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiError, api } from './api';
import { EditHistory } from './edit-history';
import { LandingPage, Section, Website } from './models';
import { FileChange, PageRecord, ProjectService, WebsiteRecord } from './project.service';
import { withFreshIds } from './section-registry';
import { DEFAULT_THEME } from './styles';
import { deepClone, slugify, uid } from './util';
import { WebsiteStore } from './website-store';

const HISTORY_LIMIT = 100;
/** Edits to the same field within this window collapse into one undo step. */
const COALESCE_MS = 800;
/** Quiet period before an edit is written to disk. */
const SAVE_DELAY_MS = 500;
/** Pages saved in the browser by earlier versions of the CMS (before the project folder). */
const LEGACY_STORAGE_KEY = 'cms.pages.v1';

export type SaveState = 'saved' | 'dirty' | 'saving' | 'conflict' | 'error';

export interface ConflictFile {
  path: string;
  /** Content on disk now (null if deleted there). */
  disk: string | null;
  /** Content the visual editor wants to write (null if it removes the file). */
  mine: string | null;
}

export type ConflictChoice = 'mine' | 'theirs' | { content: string };

interface History {
  past: LandingPage[];
  future: LandingPage[];
  lastKey?: string;
  lastAt: number;
}

interface SyncState {
  versions: Record<string, string>;
  /** Slug of the folder the page is stored in (differs from page.slug until a rename is saved). */
  savedSlug: string | null;
  dirty: boolean;
  saving: boolean;
  again: boolean;
  timer?: ReturnType<typeof setTimeout>;
  state: SaveState;
  error: string | null;
  conflicts: ConflictFile[];
}

export interface NewPage {
  website: string;
  title: string;
  slug: string;
  templateId: string;
  sections: Section[];
  description?: string;
}

/**
 * Pages of all websites, stored as files in the project folder (see server/project.mjs).
 * The editor works on in-memory copies; changes are written to disk shortly after
 * each edit, together with the file versions they were based on, so changes made
 * elsewhere (e.g. in VS Code) are never silently overwritten.
 *
 * A page's theme and publish status come from its website; `pages()` returns pages
 * with those filled in, while only the page's own content is stored.
 */
@Injectable({ providedIn: 'root' })
export class PageStore {
  private readonly project = inject(ProjectService);
  private readonly websites = inject(WebsiteStore);
  private readonly edits = inject(EditHistory);
  /** Pages as stored (without website-derived fields). */
  private readonly _pages = signal<LandingPage[]>([]);
  private readonly sync = new Map<string, SyncState>();
  private readonly syncVersion = signal(0);
  private readonly history = new Map<string, History>();
  private readonly historyVersion = signal(0);
  /** Keeps object identity stable for pages whose content and website didn't change. */
  private readonly derivedCache = new WeakMap<LandingPage, { website: Website | undefined; page: LandingPage }>();

  readonly pages = computed(() => this._pages().map((p) => this.withWebsite(p)));
  readonly loaded = signal(false);
  readonly sorted = computed(() => [...this.pages()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  /** Last page reloaded because its files changed outside the editor; the editor shows a notice. */
  readonly externalUpdate = signal<{ id: string; paths: string[]; at: number } | null>(null);
  /** Last successful save (the static exporter listens to this). */
  readonly lastSaved = signal<{ id: string; at: number } | null>(null);
  /** Kept for the admin layout's error banner. */
  readonly storageError = computed(() => {
    this.syncVersion();
    const failed = [...this.sync.values()].find((s) => s.state === 'error');
    return failed?.error ?? null;
  });

  constructor() {
    this.project.onWebsitesLoaded((records) => this.replaceAll(records));
    this.project.onFileChanges((changes) => void this.onFileChanges(changes));
    this.edits.register('page', {
      undo: (id) => this.undo(id),
      redo: (id) => this.redo(id),
      clear: (id) => this.clearHistory(id, false),
    });
  }

  private withWebsite(page: LandingPage): LandingPage {
    const website = this.websites.get(page.website);
    const cached = this.derivedCache.get(page);
    if (cached && cached.website === website) return cached.page;
    const derived: LandingPage = {
      ...page,
      theme: { ...DEFAULT_THEME, ...(website?.theme ?? {}), customCss: page.customCss ?? '' },
      status: website?.status ?? 'draft',
    };
    this.derivedCache.set(page, { website, page: derived });
    return derived;
  }

  // --- queries ------------------------------------------------------------------------------

  getById(id: string): LandingPage | undefined {
    return this.pages().find((p) => p.id === id);
  }

  private raw(id: string): LandingPage | undefined {
    return this._pages().find((p) => p.id === id);
  }

  getBySlug(site: string, slug: string): LandingPage | undefined {
    return this.pages().find((p) => p.website === site && p.slug === slug);
  }

  pagesOf(site: string): LandingPage[] {
    return this.pages().filter((p) => p.website === site);
  }

  isSlugTaken(site: string, slug: string, exceptId?: string): boolean {
    return this._pages().some((p) => p.website === site && p.slug === slug && p.id !== exceptId);
  }

  uniqueSlug(site: string, base: string, exceptId?: string): string {
    const root = slugify(base) || 'page';
    let slug = root;
    for (let i = 2; this.isSlugTaken(site, slug, exceptId); i++) slug = `${root}-${i}`;
    return slug;
  }

  /** Reactive save status for a page. */
  saveState(id: string): SaveState {
    this.syncVersion();
    return this.sync.get(id)?.state ?? 'saved';
  }

  conflicts(id: string): ConflictFile[] {
    this.syncVersion();
    return this.sync.get(id)?.conflicts ?? [];
  }

  saveError(id: string): string | null {
    this.syncVersion();
    return this.sync.get(id)?.error ?? null;
  }

  // --- loading ------------------------------------------------------------------------------

  private replaceAll(websites: WebsiteRecord[]): void {
    const records = websites.flatMap((w) => w.pages);
    // Keep pages with unsaved local edits as they are; take everything else from disk.
    const keep = this._pages().filter((p) => this.sync.get(p.id)?.dirty);
    const fromDisk = records.filter((r) => !keep.some((k) => k.id === r.page.id));
    for (const r of fromDisk) this.setSync(r.page.id, { versions: r.versions, savedSlug: r.page.slug, state: 'saved', dirty: false, conflicts: [], error: null });
    this._pages.set([...keep, ...fromDisk.map((r) => r.page)]);
    this.loaded.set(true);
  }

  private setSync(id: string, patch: Partial<SyncState>): SyncState {
    const current = this.sync.get(id) ?? { versions: {}, savedSlug: null, dirty: false, saving: false, again: false, state: 'saved', error: null, conflicts: [] };
    const next = { ...current, ...patch };
    this.sync.set(id, next);
    this.syncVersion.update((v) => v + 1);
    return next;
  }

  /** Stores a page, dropping fields derived from its website. */
  private replacePage(page: LandingPage): void {
    const { theme, status, ...stored } = page;
    const clean = { ...stored, theme: {}, status: 'draft' } as LandingPage;
    this._pages.update((pages) => (pages.some((p) => p.id === clean.id) ? pages.map((p) => (p.id === clean.id ? clean : p)) : [...pages, clean]));
  }

  private base(site: string, slug: string): string {
    return `/api/websites/${site}/pages/${slug}`;
  }

  // --- edits ----------------------------------------------------------------------------------

  /** Adds a page to a website and writes it to disk. */
  create(input: NewPage): LandingPage {
    const now = new Date().toISOString();
    const page: LandingPage = {
      id: uid('p_'),
      website: input.website,
      title: input.title.trim() || 'Untitled page',
      slug: this.uniqueSlug(input.website, input.slug || input.title),
      customCss: '',
      status: 'draft',
      templateId: input.templateId,
      seo: { metaTitle: input.title.trim(), metaDescription: input.description ?? '' },
      theme: {} as LandingPage['theme'],
      sections: input.sections,
      createdAt: now,
      updatedAt: now,
    };
    this.replacePage(page);
    this.setSync(page.id, { savedSlug: null, dirty: true, state: 'dirty' });
    void this.save(page.id);
    return page;
  }

  /**
   * Applies `recipe` to a copy of the page and schedules a save.
   * `coalesceKey` groups rapid edits (e.g. typing) into a single undo step.
   */
  update(id: string, recipe: (draft: LandingPage) => void, coalesceKey?: string): void {
    const current = this.raw(id);
    if (!current) return;
    const draft = deepClone(current);
    recipe(draft);
    draft.updatedAt = new Date().toISOString();

    const h = this.historyFor(id);
    const now = Date.now();
    const coalesce = coalesceKey !== undefined && h.lastKey === coalesceKey && now - h.lastAt < COALESCE_MS;
    if (!coalesce) {
      h.past.push(current);
      if (h.past.length > HISTORY_LIMIT) h.past.shift();
    }
    h.future = [];
    h.lastKey = coalesceKey;
    h.lastAt = now;
    this.historyVersion.update((v) => v + 1);
    this.edits.record({ kind: 'page', id, site: current.website }, coalesce);

    this.replacePage(draft);
    this.markDirty(id);
  }

  /** Steps of one page; the editor undoes through EditHistory, which calls these in order. */
  private undo(id: string): void {
    const h = this.history.get(id);
    const current = this.raw(id);
    const prev = h?.past.pop();
    if (!h || !current || !prev) return;
    h.future.push(current);
    h.lastKey = undefined;
    this.historyVersion.update((v) => v + 1);
    this.replacePage(prev);
    this.markDirty(id);
  }

  private redo(id: string): void {
    const h = this.history.get(id);
    const current = this.raw(id);
    const next = h?.future.pop();
    if (!h || !current || !next) return;
    h.past.push(current);
    h.lastKey = undefined;
    this.historyVersion.update((v) => v + 1);
    this.replacePage(next);
    this.markDirty(id);
  }

  /** Copies a page (within its website, or into `website`). */
  duplicate(id: string, opts: { title?: string; slug?: string; website?: string } = {}): LandingPage | undefined {
    const source = this.raw(id);
    if (!source) return undefined;
    const website = opts.website ?? source.website;
    const now = new Date().toISOString();
    const copy: LandingPage = {
      ...deepClone(source),
      id: uid('p_'),
      website,
      title: opts.title ?? `${source.title} (copy)`,
      slug: this.uniqueSlug(website, opts.slug ?? `${source.slug}-copy`),
      createdAt: now,
      updatedAt: now,
    };
    copy.sections = copy.sections.map((s) => ({ ...s, id: uid('s_'), data: withFreshIds(s.data) }));
    this.replacePage(copy);
    this.setSync(copy.id, { savedSlug: null, dirty: true, state: 'dirty' });
    void this.save(copy.id);
    return copy;
  }

  async remove(id: string): Promise<void> {
    const s = this.sync.get(id);
    const page = this.raw(id);
    clearTimeout(s?.timer);
    if (s?.savedSlug && page) await api('DELETE', this.base(page.website, s.savedSlug));
    this._pages.update((pages) => pages.filter((p) => p.id !== id));
    this.sync.delete(id);
    this.clearHistory(id);
    this.syncVersion.update((v) => v + 1);
  }

  /** Forgets pages of a website that was deleted as a whole. */
  dropWebsite(site: string): void {
    for (const p of this._pages().filter((x) => x.website === site)) {
      clearTimeout(this.sync.get(p.id)?.timer);
      this.sync.delete(p.id);
      this.clearHistory(p.id);
    }
    this._pages.update((pages) => pages.filter((p) => p.website !== site));
    this.syncVersion.update((v) => v + 1);
  }

  exportJson(id: string): string {
    const { status, website, ...page } = this.getById(id) ?? ({} as LandingPage);
    return JSON.stringify(page, null, 2);
  }

  /** Adds an exported page (JSON from "Export JSON" or an older CMS version) to a website. */
  importJson(json: string, website: string): LandingPage {
    const parsed = JSON.parse(json) as Partial<LandingPage>;
    if (!parsed || !Array.isArray(parsed.sections)) {
      throw new Error('This file is not a valid landing page export.');
    }
    return this.create({
      website,
      title: parsed.title || 'Imported page',
      slug: parsed.slug || parsed.title || 'imported',
      templateId: parsed.templateId ?? 'blank',
      sections: parsed.sections.map((s) => ({ ...s, id: uid('s_'), data: withFreshIds(s.data) })),
      description: parsed.seo?.metaDescription,
    });
  }

  /** Pages saved in this browser by the earlier, browser-only version of the CMS. */
  browserPages(): LandingPage[] {
    try {
      const pages = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) ?? '[]');
      return Array.isArray(pages) ? pages : [];
    } catch {
      return [];
    }
  }

  retireBrowserPages(): void {
    try {
      localStorage.setItem(`${LEGACY_STORAGE_KEY}.imported`, localStorage.getItem(LEGACY_STORAGE_KEY) ?? '[]');
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // Storage unavailable; the pages were imported anyway.
    }
  }

  // --- saving ---------------------------------------------------------------------------------

  private markDirty(id: string): void {
    const s = this.sync.get(id);
    clearTimeout(s?.timer);
    const inConflict = s?.state === 'conflict';
    const timer = inConflict ? undefined : setTimeout(() => void this.save(id), SAVE_DELAY_MS);
    this.setSync(id, { dirty: true, timer, state: inConflict ? 'conflict' : 'dirty' });
  }

  /** Writes a page to disk now. `force` overwrites files that changed on disk. */
  async save(id: string, force = false): Promise<void> {
    let s = this.sync.get(id);
    if (!s) return;
    if (s.saving) {
      this.setSync(id, { again: true });
      return;
    }
    clearTimeout(s.timer);
    const page = this.raw(id);
    if (!page) return;
    this.setSync(id, { saving: true, again: false, dirty: false, state: 'saving' });

    try {
      let record: PageRecord;
      if (!s.savedSlug) {
        record = await api<PageRecord>('POST', `/api/websites/${page.website}/pages`, { page });
      } else {
        if (s.savedSlug !== page.slug) {
          const renamed = await api<PageRecord>('POST', `${this.base(page.website, s.savedSlug)}/rename`, { to: page.slug });
          s = this.setSync(id, { savedSlug: page.slug, versions: renamed.versions });
        }
        record = await api<PageRecord>('PUT', this.base(page.website, page.slug), { page, base: s.versions, force });
      }
      s = this.setSync(id, { saving: false, versions: record.versions, savedSlug: page.slug, state: 'saved', error: null, conflicts: [] });
      this.lastSaved.set({ id, at: Date.now() });
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 409 && err.body?.conflicts) {
        this.setSync(id, { saving: false, dirty: true, state: 'conflict', conflicts: err.body.conflicts, error: null });
        return;
      }
      this.setSync(id, { saving: false, dirty: true, state: 'error', error: err.message ?? String(e) });
      return;
    }
    if (s.again || this.sync.get(id)?.dirty) this.markDirty(id);
  }

  /** Conflict resolution: keep the visual editor's version of every file. */
  keepMine(id: string): Promise<void> {
    this.setSync(id, { state: 'dirty', conflicts: [] });
    return this.save(id, true);
  }

  /** Conflict resolution: discard the editor's unsaved changes and load the files from disk. */
  async keepTheirs(id: string): Promise<void> {
    const s = this.sync.get(id);
    const page = this.raw(id);
    const slug = s?.savedSlug ?? page?.slug;
    if (!slug || !page) return;
    clearTimeout(s?.timer);
    await this.reloadFromDisk(id, page.website, slug);
  }

  /** Conflict resolution: choose per file (editor, disk, or hand-merged content). */
  async merge(id: string, choices: Record<string, ConflictChoice>): Promise<void> {
    const page = this.raw(id);
    const s = this.sync.get(id);
    if (!page || !s) return;
    const overrides: Record<string, string | null> = {};
    for (const file of s.conflicts) {
      const choice = choices[file.path] ?? 'mine';
      if (choice === 'theirs') overrides[file.path] = file.disk;
      else if (typeof choice === 'object') overrides[file.path] = choice.content;
    }
    this.setSync(id, { saving: true, state: 'saving' });
    try {
      const record = await api<PageRecord>('POST', `${this.base(page.website, page.slug)}/merge`, { page, overrides });
      this.replacePage({ ...record.page, id });
      this.clearHistory(id);
      this.setSync(id, { saving: false, dirty: false, versions: record.versions, savedSlug: record.page.slug, state: 'saved', conflicts: [], error: null });
      this.lastSaved.set({ id, at: Date.now() });
    } catch (e) {
      this.setSync(id, { saving: false, state: 'error', error: (e as Error).message });
    }
  }

  private async reloadFromDisk(id: string, site: string, slug: string, paths: string[] = []): Promise<void> {
    try {
      const record = await api<PageRecord>('GET', this.base(site, slug));
      // Keep the local id so open editors stay attached even if page.json lost it.
      this.replacePage({ ...record.page, id });
      this.clearHistory(id);
      this.setSync(id, { versions: record.versions, savedSlug: slug, dirty: false, state: 'saved', conflicts: [], error: null });
      if (paths.length) this.externalUpdate.set({ id, paths, at: Date.now() });
    } catch (e) {
      this.setSync(id, { state: 'error', error: (e as Error).message });
    }
  }

  // --- changes made outside the editor ----------------------------------------------------------

  private async onFileChanges(changes: FileChange[]): Promise<void> {
    const byPage = new Map<string, { site: string; slug: string; list: FileChange[] }>();
    for (const c of changes) {
      const m = /^websites\/([^/]+)\/pages\/([^/]+)\//.exec(c.path);
      if (!m) continue;
      const key = `${m[1]}/${m[2]}`;
      if (!byPage.has(key)) byPage.set(key, { site: m[1], slug: m[2], list: [] });
      byPage.get(key)!.list.push(c);
    }

    for (const { site, slug, list } of byPage.values()) {
      const pageJson = `websites/${site}/pages/${slug}/page.json`;
      const entry = [...this.sync.entries()].find(([id, s]) => s.savedSlug === slug && this.raw(id)?.website === site);
      if (!entry) {
        // A page created outside the editor (e.g. a folder copied in VS Code).
        if (list.some((c) => c.path === pageJson && c.hash)) {
          try {
            const record = await api<PageRecord>('GET', this.base(site, slug));
            if (!this.raw(record.page.id)) {
              this.setSync(record.page.id, { versions: record.versions, savedSlug: slug, state: 'saved' });
              this.replacePage(record.page);
            }
          } catch {
            // Not a complete page yet; a later change will pick it up.
          }
        }
        continue;
      }
      const [id, s] = entry;
      // Our own writes come back with hashes we already know.
      const foreign = list.filter((c) => (s.versions[c.path] ?? null) !== c.hash);
      if (!foreign.length || s.saving) continue;

      if (foreign.some((c) => c.path === pageJson && c.hash === null)) {
        if (!s.dirty) {
          this._pages.update((pages) => pages.filter((p) => p.id !== id));
          this.sync.delete(id);
          this.syncVersion.update((v) => v + 1);
        }
        continue;
      }
      if (s.dirty) {
        // Unsaved edits here and changes on disk: saving now surfaces the conflict with details.
        void this.save(id);
      } else {
        await this.reloadFromDisk(id, site, slug, foreign.map((c) => c.path));
      }
    }
  }

  /** Forgets a page's undo steps (`global`: also remove them from the shared timeline). */
  private clearHistory(id: string, global = true): void {
    if (!this.history.delete(id)) return;
    this.historyVersion.update((v) => v + 1);
    if (global) this.edits.forget((t) => t.kind === 'page' && t.id === id);
  }

  private historyFor(id: string): History {
    let h = this.history.get(id);
    if (!h) {
      h = { past: [], future: [], lastAt: 0 };
      this.history.set(id, h);
    }
    return h;
  }
}
