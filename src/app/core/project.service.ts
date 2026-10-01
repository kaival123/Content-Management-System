import { Injectable, computed, signal } from '@angular/core';
import { ApiError, SIGN_IN_REQUIRED, api } from './api';
import { ComponentDef } from './engine/render';
import { LandingPage, Theme, Website } from './models';
import { setSectionDefs } from './section-registry';
import { LibraryItem, PageTemplate } from './templates';

export interface PageRecord {
  page: LandingPage;
  /** Hash of every file the page was read from, for conflict detection. */
  versions: Record<string, string>;
  errors: { file: string; message: string }[];
}

export interface WebsiteRecord {
  website: Website;
  /** Hash of website.json / website.css, for conflict detection. */
  versions: Record<string, string>;
  pages: PageRecord[];
}

export interface ProjectConfig {
  name?: string;
  defaultTheme?: Partial<Theme>;
  export?: { formEndpoint?: string };
  /** Section library categories in display order. */
  libraryCategories?: { id: string; label: string }[];
}

export interface ProjectSnapshot {
  siteDir: string;
  config: ProjectConfig;
  baseCss: string;
  components: (ComponentDef & { error?: string | null })[];
  templates: PageTemplate[];
  library: LibraryItem[];
  websites: WebsiteRecord[];
  pageErrors: { slug: string; message: string; file?: string }[];
}

export interface FileChange {
  path: string;
  /** New content hash, or null when the file was deleted. */
  hash: string | null;
}

type Listener = (changes: FileChange[]) => void;

/** Project-relative folder of a page (mirrors server/project.mjs). */
export function pageDir(site: string, slug: string): string {
  return `websites/${site}/pages/${slug}`;
}

/** Project-relative path of a section's file (mirrors server/project.mjs). */
export function sectionFilePath(site: string, slug: string, section: { type: string; id: string }): string {
  const safe = (v: string) => String(v).replace(/[^a-zA-Z0-9_-]/g, '');
  return `${pageDir(site, slug)}/sections/${safe(section.type)}-${safe(section.id)}.json`;
}

/** URL for a project-relative asset path ("assets/images/x.jpg"); other URLs pass through. */
export function assetUrl(value: string | null | undefined): string {
  if (!value) return '';
  return value.startsWith('assets/') ? `/site/${value}` : value;
}

/**
 * The connection to the project on disk: loads components, templates, config and
 * pages from the project server, and relays file changes (from VS Code or anywhere
 * else) as they happen.
 */
@Injectable({ providedIn: 'root' })
export class ProjectService {
  /** 'signin': the server runs in production mode and needs the admin password. */
  readonly status = signal<'connecting' | 'ready' | 'offline' | 'signin'>('connecting');
  /** From /api/session: whether this server requires sign-in (production) at all. */
  readonly session = signal<{ auth: boolean; production: boolean }>({ auth: false, production: false });
  readonly error = signal<string | null>(null);
  readonly siteDir = signal('');
  readonly config = signal<ProjectSnapshot['config']>({});
  readonly baseCss = signal('');
  readonly components = signal<ProjectSnapshot['components']>([]);
  readonly templates = signal<PageTemplate[]>([]);
  /** Section library presets and saved sections (site/library/). */
  readonly library = signal<LibraryItem[]>([]);
  readonly pageErrors = signal<ProjectSnapshot['pageErrors']>([]);
  /** Increments on every file change batch; lets views refresh lazily. */
  readonly changeTick = signal(0);
  readonly componentErrors = computed(() => this.components().filter((c) => c.error));

  private readonly listeners = new Set<Listener>();
  private events: EventSource | null = null;
  private readonly websiteHandlers: ((websites: WebsiteRecord[]) => void)[] = [];

  /** The website and page stores register here to receive content whenever the project is (re)loaded. */
  onWebsitesLoaded(handler: (websites: WebsiteRecord[]) => void): void {
    this.websiteHandlers.push(handler);
  }

  onFileChanges(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  constructor() {
    window.addEventListener(SIGN_IN_REQUIRED, () => this.requireSignIn());
  }

  async connect(): Promise<void> {
    await api<{ auth: boolean; production: boolean }>('GET', '/api/session')
      .then((s) => this.session.set({ auth: !!s.auth, production: !!s.production }))
      .catch(() => {});
    await this.load(true);
    if (this.status() === 'ready') this.listen();
  }

  /** Signs in with the admin password (production mode), then loads the project. */
  async signIn(password: string): Promise<void> {
    await api('POST', '/api/login', { password });
    await this.connect();
  }

  async signOut(): Promise<void> {
    await api('POST', '/api/logout').catch(() => {});
    this.requireSignIn();
  }

  private requireSignIn(): void {
    this.events?.close();
    this.events = null;
    this.status.set('signin');
    this.error.set(null);
  }

  /** Loads the whole project. With `includePages` false only components/templates/config are refreshed. */
  async load(includePages: boolean): Promise<void> {
    try {
      const snap = await api<ProjectSnapshot>('GET', '/api/project');
      this.siteDir.set(snap.siteDir);
      this.config.set(snap.config ?? {});
      this.baseCss.set(snap.baseCss);
      setSectionDefs(snap.components);
      this.components.set(snap.components);
      this.templates.set(snap.templates);
      this.library.set(snap.library ?? []);
      this.pageErrors.set(snap.pageErrors);
      if (includePages) for (const h of this.websiteHandlers) h(snap.websites ?? []);
      this.status.set('ready');
      this.error.set(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        this.requireSignIn();
        return;
      }
      this.status.set('offline');
      this.error.set(e instanceof ApiError ? e.message : String(e));
    }
  }

  private listen(): void {
    this.events?.close();
    const events = new EventSource('/api/events');
    this.events = events;
    let wasOffline = false;
    events.onmessage = (msg) => {
      const event = JSON.parse(msg.data);
      if (event.type === 'hello') {
        // Reconnected after the server restarted: reload everything.
        if (wasOffline) void this.load(true);
        wasOffline = false;
        return;
      }
      if (event.type === 'change') this.handleChanges(event.changes as FileChange[]);
    };
    events.onerror = () => {
      wasOffline = true;
      this.status.set('offline');
      this.error.set('Lost connection to the project server. Reconnecting…');
      // In production the stream also fails when the session has expired.
      if (this.session().auth) {
        void api<{ signedIn: boolean }>('GET', '/api/session')
          .then((s) => !s.signedIn && this.requireSignIn())
          .catch(() => {});
      }
    };
    events.onopen = () => {
      if (this.status() === 'offline') this.status.set('ready');
    };
  }

  private handleChanges(changes: FileChange[]): void {
    this.changeTick.update((n) => n + 1);
    const shared = changes.some((c) => /^(components|styles|templates|config|library)\//.test(c.path));
    if (shared) void this.load(false);
    for (const l of this.listeners) l(changes);
  }

  // --- actions ----------------------------------------------------------------------------

  async uploadImage(file: File, dataUrl: string): Promise<string> {
    const res = await api<{ path: string }>('POST', '/api/assets', { name: file.name, dataUrl });
    return res.path;
  }

  async openInEditor(path?: string): Promise<void> {
    await api('POST', '/api/open', { path });
  }
}
