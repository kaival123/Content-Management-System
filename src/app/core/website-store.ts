import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiError, api } from './api';
import { EditHistory } from './edit-history';
import { Website } from './models';
import { FileChange, ProjectService, WebsiteRecord } from './project.service';
import { resolveTheme } from './styles';
import { deepClone, isReservedSlug, slugify } from './util';

const SAVE_DELAY_MS = 400;
const HISTORY_LIMIT = 100;
/** Edits with the same key within this window (e.g. dragging a colour picker) are one undo step. */
const COALESCE_MS = 800;

type WebsiteSaveState = 'saved' | 'dirty' | 'saving' | 'conflict' | 'error';

interface SyncState {
  versions: Record<string, string>;
  saved: boolean;
  dirty: boolean;
  saving: boolean;
  again: boolean;
  timer?: ReturnType<typeof setTimeout>;
  state: WebsiteSaveState;
  error: string | null;
}

interface History {
  past: Website[];
  future: Website[];
  lastKey?: string;
  lastAt: number;
}

/**
 * Websites (site/websites/<slug>/website.json): name, publish status, homepage,
 * page tree and the theme shared by all their pages. Saved like pages: shortly
 * after each edit, refusing to overwrite changes made on disk in the meantime.
 */
@Injectable({ providedIn: 'root' })
export class WebsiteStore {
  private readonly project = inject(ProjectService);
  private readonly _websites = signal<Website[]>([]);
  private readonly sync = new Map<string, SyncState>();
  private readonly syncVersion = signal(0);
  private readonly edits = inject(EditHistory);
  private readonly history = new Map<string, History>();

  readonly websites = this._websites.asReadonly();
  readonly sorted = computed(() => [...this._websites()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  /** Last website reloaded because website.json changed outside the editor. */
  readonly externalUpdate = signal<{ slug: string; at: number } | null>(null);
  readonly lastSaved = signal<{ slug: string; at: number } | null>(null);

  constructor() {
    this.project.onWebsitesLoaded((records) => this.replaceAll(records));
    this.project.onFileChanges((changes) => void this.onFileChanges(changes));
    this.edits.register('website', {
      undo: (slug) => this.step(slug, 'undo'),
      redo: (slug) => this.step(slug, 'redo'),
      clear: (slug) => this.history.delete(slug),
    });
  }

  get(slug: string | null | undefined): Website | undefined {
    return this._websites().find((w) => w.slug === slug);
  }

  /** Effective theme of a website (defaults filled in). */
  theme(slug: string) {
    return resolveTheme(this.get(slug)?.theme ?? ({} as Website['theme']));
  }

  /** True if another website uses the URL, or the app does (/admin, /api…). */
  isSlugTaken(slug: string, except?: string): boolean {
    return isReservedSlug(slug) || this._websites().some((w) => w.slug === slug && w.slug !== except);
  }

  uniqueSlug(base: string): string {
    const root = slugify(base) || 'website';
    let slug = root;
    for (let i = 2; this.isSlugTaken(slug); i++) slug = `${root}-${i}`;
    return slug;
  }

  saveState(slug: string): WebsiteSaveState {
    this.syncVersion();
    return this.sync.get(slug)?.state ?? 'saved';
  }

  saveError(slug: string): string | null {
    this.syncVersion();
    return this.sync.get(slug)?.error ?? null;
  }

  private replaceAll(records: WebsiteRecord[]): void {
    const keep = this._websites().filter((w) => this.sync.get(w.slug)?.dirty);
    const fromDisk = records.filter((r) => !keep.some((k) => k.slug === r.website.slug));
    for (const r of fromDisk) this.setSync(r.website.slug, { versions: r.versions, saved: true, dirty: false, state: 'saved', error: null });
    this._websites.set([...keep, ...fromDisk.map((r) => r.website)]);
  }

  private setSync(slug: string, patch: Partial<SyncState>): SyncState {
    const current = this.sync.get(slug) ?? { versions: {}, saved: false, dirty: false, saving: false, again: false, state: 'saved', error: null };
    const next = { ...current, ...patch };
    this.sync.set(slug, next);
    this.syncVersion.update((v) => v + 1);
    return next;
  }

  private replace(website: Website): void {
    this._websites.update((list) => (list.some((w) => w.slug === website.slug) ? list.map((w) => (w.slug === website.slug ? website : w)) : [...list, website]));
  }

  /** Adds a website locally and writes it to disk (pages are created separately). */
  async create(website: Website): Promise<void> {
    this.replace(website);
    this.setSync(website.slug, { saved: false, dirty: false, state: 'saving' });
    try {
      const record = await api<WebsiteRecord>('POST', '/api/websites', { website });
      const s = this.setSync(website.slug, { versions: record.versions, saved: true, state: 'saved' });
      // Edits made while it was being created.
      if (s.again || s.dirty) void this.save(website.slug);
    } catch (e) {
      this.setSync(website.slug, { state: 'error', error: (e as Error).message });
      throw e;
    }
  }

  /**
   * Applies `recipe` to a copy of the website and schedules a save.
   * `coalesceKey` groups rapid edits of one setting into a single undo step.
   */
  update(slug: string, recipe: (draft: Website) => void, coalesceKey?: string): void {
    const current = this.get(slug);
    if (!current) return;
    const draft = deepClone(current);
    recipe(draft);
    draft.updatedAt = new Date().toISOString();

    let h = this.history.get(slug);
    if (!h) this.history.set(slug, (h = { past: [], future: [], lastAt: 0 }));
    const now = Date.now();
    const coalesce = coalesceKey !== undefined && h.lastKey === coalesceKey && now - h.lastAt < COALESCE_MS;
    if (!coalesce) {
      h.past.push(current);
      if (h.past.length > HISTORY_LIMIT) h.past.shift();
    }
    h.future = [];
    h.lastKey = coalesceKey;
    h.lastAt = now;
    this.edits.record({ kind: 'website', id: slug, site: slug }, coalesce);

    this.replace(draft);
    this.markDirty(slug);
  }

  private step(slug: string, dir: 'undo' | 'redo'): void {
    const h = this.history.get(slug);
    const current = this.get(slug);
    const target = dir === 'undo' ? h?.past.pop() : h?.future.pop();
    if (!h || !current || !target) return;
    (dir === 'undo' ? h.future : h.past).push(current);
    h.lastKey = undefined;
    this.replace({ ...target, updatedAt: new Date().toISOString() });
    this.markDirty(slug);
  }

  private clearHistory(slug: string): void {
    if (this.history.delete(slug)) this.edits.forget((t) => t.kind === 'website' && t.id === slug);
  }

  private markDirty(slug: string): void {
    const s = this.sync.get(slug);
    clearTimeout(s?.timer);
    const timer = s?.state === 'conflict' ? undefined : setTimeout(() => void this.save(slug), SAVE_DELAY_MS);
    this.setSync(slug, { dirty: true, timer, state: s?.state === 'conflict' ? 'conflict' : 'dirty' });
  }

  async save(slug: string, force = false): Promise<void> {
    const s = this.sync.get(slug);
    const website = this.get(slug);
    if (!s || !website) return;
    if (s.saving || !s.saved) {
      this.setSync(slug, { again: true });
      return;
    }
    this.setSync(slug, { saving: true, again: false, dirty: false, state: 'saving' });
    try {
      const record = await api<WebsiteRecord>('PUT', `/api/websites/${slug}`, { website, base: s.versions, force });
      this.setSync(slug, { saving: false, versions: record.versions, state: 'saved', error: null });
      this.lastSaved.set({ slug, at: Date.now() });
    } catch (e) {
      const err = e as ApiError;
      this.setSync(slug, { saving: false, dirty: true, state: err.status === 409 ? 'conflict' : 'error', error: err.message });
      return;
    }
    if (this.sync.get(slug)?.again || this.sync.get(slug)?.dirty) void this.save(slug);
  }

  keepMine(slug: string): Promise<void> {
    this.setSync(slug, { state: 'dirty' });
    return this.save(slug, true);
  }

  async reload(slug: string): Promise<void> {
    try {
      const record = await api<WebsiteRecord>('GET', `/api/websites/${slug}`);
      this.replace(record.website);
      this.clearHistory(slug);
      this.setSync(slug, { versions: record.versions, saved: true, dirty: false, state: 'saved', error: null });
    } catch (e) {
      this.setSync(slug, { state: 'error', error: (e as Error).message });
    }
  }

  /** Deletes the website folder with all its pages. */
  async remove(slug: string): Promise<void> {
    await api('DELETE', `/api/websites/${slug}`);
    this._websites.update((list) => list.filter((w) => w.slug !== slug));
    this.sync.delete(slug);
    this.edits.clearSite(slug);
    this.syncVersion.update((v) => v + 1);
  }

  private async onFileChanges(changes: FileChange[]): Promise<void> {
    const slugs = new Set<string>();
    for (const c of changes) {
      const m = /^websites\/([^/]+)\/website\.(json|css)$/.exec(c.path);
      if (!m) continue;
      const s = this.sync.get(m[1]);
      if (s && (s.versions[c.path] ?? null) === c.hash) continue; // our own write
      slugs.add(m[1]);
    }
    for (const slug of slugs) {
      const s = this.sync.get(slug);
      const exists = changes.some((c) => c.path === `websites/${slug}/website.json` && c.hash !== null);
      if (!exists && !this.get(slug)) continue;
      if (!exists && changes.some((c) => c.path === `websites/${slug}/website.json`)) {
        // website.json deleted on disk
        this._websites.update((list) => list.filter((w) => w.slug !== slug));
        continue;
      }
      if (s?.dirty) {
        void this.save(slug); // surfaces the conflict
      } else {
        await this.reload(slug);
        this.externalUpdate.set({ slug, at: Date.now() });
      }
    }
  }
}
