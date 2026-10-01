import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { Diagnostic } from '@codemirror/lint';
import { MergeView } from '@codemirror/merge';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { Router, RouterLink } from '@angular/router';
import { ApiError, api } from '../../core/api';
import { ComponentDef } from '../../core/engine/render';
import { Exporter } from '../../core/exporter';
import { LandingPage } from '../../core/models';
import { PageStore } from '../../core/page-store';
import { FileChange, ProjectService, pageDir } from '../../core/project.service';
import { deepClone, slugify } from '../../core/util';
import { PageRenderer } from '../../renderer/page-renderer';
import { createFileState, createMergeView, langFor } from '../../shared/code-editor';
import { Icon } from '../../shared/icon';
import { ToastService } from '../../shared/toast';

interface FileEntry {
  path: string;
  type: 'file' | 'dir';
  size?: number;
}

interface OpenFile {
  path: string;
  /** Content on disk when opened / last saved. */
  saved: string;
  hash: string;
  current: string;
  problems: Diagnostic[];
  /** Set when the file changed on disk while it had unsaved edits here. */
  diskChanged: { content: string; hash: string } | null;
}

type Panel = 'files' | 'search' | 'git';

interface GitStatus {
  repo: boolean;
  branch: string | null;
  files: { path: string; status: string; staged: boolean }[];
}

/**
 * Developer Mode: the project's source files (site/) in a code editor, with search,
 * syntax checking, Git, and a live preview that reflects unsaved edits. Saving writes
 * straight to disk — the same files VS Code sees — and refuses to overwrite a file
 * that changed on disk in the meantime unless the user chooses to.
 */
@Component({
  selector: 'app-dev-mode',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, PageRenderer],
  templateUrl: './dev-mode.html',
  host: { class: 'dev', '(window:keydown)': 'onKeydown($event)', '(window:beforeunload)': 'onBeforeUnload($event)' },
})
export class DevMode {
  /** Query params: file to open, page to preview. */
  readonly file = input<string>();
  readonly page = input<string>();

  protected readonly project = inject(ProjectService);
  private readonly store = inject(PageStore);
  private readonly exporter = inject(Exporter);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly editorHost = viewChild<ElementRef<HTMLElement>>('editorHost');
  private readonly diffHost = viewChild<ElementRef<HTMLElement>>('diffHost');

  protected readonly panel = signal<Panel>('files');
  protected readonly tree = signal<FileEntry[]>([]);
  protected readonly collapsed = signal<Set<string>>(new Set(['assets']));
  protected readonly open = signal<OpenFile[]>([]);
  protected readonly active = signal<string | null>(null);
  protected readonly activeFile = computed(() => this.open().find((f) => f.path === this.active()) ?? null);
  protected readonly dirtyCount = computed(() => this.open().filter((f) => f.current !== f.saved).length);

  /** Save conflict for the active file (it changed on disk since it was opened). */
  protected readonly saveConflict = signal<{ path: string; disk: string; diskHash: string } | null>(null);
  /** Diff shown instead of the editor: { title, a (old), b (new) }. */
  protected readonly diff = signal<{ title: string; path: string; a: string; b: string; editable?: boolean } | null>(null);

  protected readonly searchQuery = signal('');
  protected readonly searchRegex = signal(false);
  protected readonly searchCase = signal(false);
  protected readonly searchResults = signal<{ path: string; line: number; text: string }[]>([]);
  protected readonly searching = signal(false);

  protected readonly git = signal<GitStatus | null>(null);
  protected readonly gitLog = signal<{ short: string; subject: string; author: string; date: string }[]>([]);
  protected readonly branches = signal<{ current: string | null; all: string[] }>({ current: null, all: [] });
  protected readonly commitMessage = signal('');
  protected readonly gitBusy = signal(false);

  protected readonly showPreview = signal(true);
  /** Page previewed on the right, as "<website>/<page>". */
  protected readonly previewSlug = signal<string | null>(null);
  private previewPageOf(key: string | null) {
    const [site, slug] = (key ?? '').split('/');
    return site && slug ? this.store.getBySlug(site, slug) : undefined;
  }
  protected readonly newComponentOpen = signal(false);
  protected readonly building = signal(false);

  private view: EditorView | null = null;
  private mergeView: MergeView | null = null;
  private readonly states = new Map<string, EditorState>();

  protected readonly pages = computed(() => this.store.sorted());

  /** Tree rows with depth, hiding children of collapsed folders. */
  protected readonly rows = computed(() => {
    const hidden = this.collapsed();
    return this.tree()
      .filter((e) => ![...hidden].some((dir) => e.path.startsWith(dir + '/')))
      .map((e) => ({ ...e, depth: e.path.split('/').length - 1, name: e.path.split('/').pop()! }));
  });

  // Preview: project components and page, with unsaved buffers applied.
  protected readonly previewComponents = computed<ComponentDef[]>(() => {
    const buffers = new Map(this.open().map((f) => [f.path, f.current]));
    return this.project.components().map((c) => {
      const tpl = buffers.get(`components/${c.folder}/component.html`);
      const css = buffers.get(`components/${c.folder}/component.css`);
      return tpl === undefined && css === undefined ? c : { ...c, template: tpl ?? c.template, css: css ?? c.css };
    });
  });
  protected readonly previewBaseCss = computed(() => this.open().find((f) => f.path === 'styles/base.css')?.current ?? this.project.baseCss());
  protected readonly previewPage = computed<LandingPage | null>(() => {
    const saved = this.previewPageOf(this.previewSlug());
    if (!saved) return null;
    const dir = `${pageDir(saved.website, saved.slug)}/`;
    const page = deepClone(saved);
    for (const f of this.open()) {
      if (f.current === f.saved || !f.path.startsWith(dir)) continue;
      try {
        const rest = f.path.slice(dir.length);
        if (rest === 'page.css') page.theme = { ...page.theme, customCss: f.current };
        else if (rest === 'page.json') Object.assign(page, { ...JSON.parse(f.current), sections: page.sections, slug: saved.slug, website: saved.website });
        else if (rest.startsWith('sections/') && rest.endsWith('.json')) {
          const s = JSON.parse(f.current);
          const i = page.sections.findIndex((x) => x.id === s.id);
          if (i >= 0) page.sections[i] = { ...s, style: { ...s.style, customCss: page.sections[i].style.customCss } };
        } else if (rest.startsWith('sections/') && rest.endsWith('.css')) {
          const id = rest.slice('sections/'.length, -4).split('-').slice(1).join('-');
          const sec = page.sections.find((x) => x.id === id);
          if (sec) sec.style = { ...sec.style, customCss: f.current };
        }
      } catch {
        // Invalid JSON while typing: keep previewing the last valid version.
      }
    }
    return page;
  });

  constructor() {
    void this.refreshTree();
    void this.refreshGit();

    // Open the file / page passed in the URL.
    effect(() => {
      const file = this.file();
      const page = this.page();
      untracked(() => {
        if (page) this.previewSlug.set(page);
        if (file) void this.openFile(file);
      });
    });

    // Default preview page.
    effect(() => {
      const pages = this.pages();
      if (!this.previewSlug() && pages.length) untracked(() => this.previewSlug.set(`${pages[0].website}/${pages[0].slug}`));
    });

    const unsubscribe = this.project.onFileChanges((changes) => void this.onDiskChanges(changes));
    inject(DestroyRef).onDestroy(() => {
      unsubscribe();
      this.view?.destroy();
      this.mergeView?.destroy();
    });

    // Mount the editor for the active file.
    effect(() => {
      const host = this.editorHost()?.nativeElement;
      const path = this.active();
      const diff = this.diff();
      untracked(() => {
        if (!host || diff) return;
        const state = path ? this.states.get(path) : null;
        if (!state) {
          this.view?.destroy();
          this.view = null;
          return;
        }
        if (!this.view || !host.contains(this.view.dom)) {
          this.view?.destroy();
          this.view = new EditorView({ state, parent: host });
        } else if (this.view.state !== state) {
          this.view.setState(state);
        }
      });
    });

    // Mount the diff view.
    effect(() => {
      const host = this.diffHost()?.nativeElement;
      const diff = this.diff();
      untracked(() => {
        this.mergeView?.destroy();
        this.mergeView = null;
        if (host && diff) this.mergeView = createMergeView(host, { path: diff.path, a: diff.a, b: diff.b, editableB: diff.editable });
      });
    });
  }

  // --- files -------------------------------------------------------------------------------------

  private async refreshTree(): Promise<void> {
    try {
      this.tree.set(await api<FileEntry[]>('GET', '/api/files'));
    } catch (e) {
      this.toast.show((e as Error).message, 'error');
    }
  }

  protected toggleDir(path: string): void {
    this.collapsed.update((s) => {
      const next = new Set(s);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  }

  protected isCollapsed(path: string): boolean {
    return this.collapsed().has(path);
  }

  protected isOpenDirty(path: string): boolean {
    const f = this.open().find((x) => x.path === path);
    return !!f && f.current !== f.saved;
  }

  protected icon(path: string): string {
    const lang = langFor(path);
    return lang === 'html' ? 'code' : lang === 'css' ? 'palette' : lang === 'json' ? 'settings' : lang === 'js' ? 'text' : /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(path) ? 'image' : 'file';
  }

  async openFile(path: string, line?: number): Promise<void> {
    this.diff.set(null);
    if (/\.(png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|mp4|pdf)$/i.test(path)) {
      window.open(`/site/${path}`, '_blank');
      return;
    }
    if (!this.open().some((f) => f.path === path)) {
      try {
        const res = await api<{ content: string; hash: string }>('GET', `/api/file?path=${encodeURIComponent(path)}`);
        this.states.set(path, this.makeState(path, res.content));
        this.open.update((list) => [...list, { path, saved: res.content, hash: res.hash, current: res.content, problems: [], diskChanged: null }]);
      } catch (e) {
        this.toast.show((e as Error).message, 'error');
        return;
      }
    }
    this.active.set(path);
    // Opening a page's file previews that page.
    const m = /^websites\/([^/]+)\/pages\/([^/]+)\//.exec(path);
    if (m) this.previewSlug.set(`${m[1]}/${m[2]}`);
    if (line) setTimeout(() => this.goToLine(line));
  }

  private makeState(path: string, doc: string): EditorState {
    return createFileState(path, doc, {
      onChange: (content) => this.patchOpen(path, { current: content }),
      onSave: () => void this.save(path),
      onProblems: (problems) => this.patchOpen(path, { problems }),
    });
  }

  private patchOpen(path: string, patch: Partial<OpenFile>): void {
    this.open.update((list) => list.map((f) => (f.path === path ? { ...f, ...patch } : f)));
    if (patch.current !== undefined && this.view && this.active() === path) this.states.set(path, this.view.state);
  }

  private goToLine(line: number): void {
    if (!this.view) return;
    const l = this.view.state.doc.line(Math.min(Math.max(line, 1), this.view.state.doc.lines));
    this.view.dispatch({ selection: { anchor: l.from }, effects: EditorView.scrollIntoView(l.from, { y: 'center' }) });
    this.view.focus();
  }

  protected activate(path: string): void {
    if (this.view && this.active()) this.states.set(this.active()!, this.view.state);
    this.diff.set(null);
    this.active.set(path);
  }

  protected closeFile(path: string, event?: Event): void {
    event?.stopPropagation();
    const f = this.open().find((x) => x.path === path);
    if (f && f.current !== f.saved && !confirm(`Close ${path} without saving?`)) return;
    this.states.delete(path);
    const list = this.open().filter((x) => x.path !== path);
    this.open.set(list);
    if (this.active() === path) this.active.set(list.at(-1)?.path ?? null);
  }

  /** Replaces a buffer's content (e.g. after reloading from disk). */
  private setBuffer(path: string, content: string, hash: string): void {
    const state = this.makeState(path, content);
    this.states.set(path, state);
    if (this.view && this.active() === path) this.view.setState(state);
    this.patchOpen(path, { saved: content, hash, current: content, diskChanged: null });
  }

  async save(path = this.active() ?? '', force = false): Promise<void> {
    const f = this.open().find((x) => x.path === path);
    if (!f) return;
    if (f.problems.length && !force && !confirm(`${path} has ${f.problems.length} syntax problem(s). Save anyway?`)) return;
    try {
      const res = await api<{ hash: string }>('PUT', '/api/file', { path, content: f.current, base: f.hash, force });
      this.patchOpen(path, { saved: f.current, hash: res.hash, diskChanged: null });
      this.saveConflict.set(null);
      this.toast.show(`Saved ${path}`);
      void this.refreshGit();
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 409) this.saveConflict.set({ path, disk: err.body?.disk ?? '', diskHash: err.body?.diskHash ?? '' });
      else this.toast.show(err.message, 'error');
    }
  }

  async saveAll(): Promise<void> {
    for (const f of this.open()) if (f.current !== f.saved) await this.save(f.path);
  }

  /** Discards unsaved edits in the buffer. */
  protected async revertBuffer(): Promise<void> {
    const f = this.activeFile();
    if (!f || (f.current !== f.saved && !confirm(`Discard your unsaved changes to ${f.path}?`))) return;
    try {
      const res = await api<{ content: string; hash: string }>('GET', `/api/file?path=${encodeURIComponent(f.path)}`);
      this.setBuffer(f.path, res.content, res.hash);
    } catch (e) {
      this.toast.show((e as Error).message, 'error');
    }
  }

  // Conflict handling for the active file.
  protected overwriteDisk(): void {
    const c = this.saveConflict() ?? (this.activeFile()?.diskChanged ? { path: this.active()! } : null);
    if (c) void this.save(c.path, true);
  }

  protected takeDisk(): void {
    const f = this.activeFile();
    const disk = this.saveConflict()?.disk ?? f?.diskChanged?.content;
    const hash = this.saveConflict()?.diskHash ?? f?.diskChanged?.hash;
    if (!f || disk === undefined || hash === undefined) return;
    this.setBuffer(f.path, disk, hash);
    this.saveConflict.set(null);
  }

  protected compareWithDisk(): void {
    const f = this.activeFile();
    const disk = this.saveConflict()?.disk ?? f?.diskChanged?.content;
    if (!f || disk === undefined) return;
    this.diff.set({ title: `${f.path}: on disk ↔ your edits (right side is editable)`, path: f.path, a: disk, b: f.current, editable: true });
  }

  /** Takes the (possibly hand-merged) right side of the compare view into the buffer. */
  protected useMerged(): void {
    const d = this.diff();
    const f = this.activeFile();
    if (!d || !f || !this.mergeView) return;
    const merged = this.mergeView.b.state.doc.toString();
    const diskHash = this.saveConflict()?.diskHash ?? f.diskChanged?.hash ?? f.hash;
    const disk = this.saveConflict()?.disk ?? f.diskChanged?.content ?? f.saved;
    // The merge now accounts for the disk version, so it becomes the base for saving.
    const state = this.makeState(f.path, merged);
    this.states.set(f.path, state);
    this.patchOpen(f.path, { saved: disk, hash: diskHash, current: merged, diskChanged: null });
    this.saveConflict.set(null);
    this.diff.set(null);
  }

  private async onDiskChanges(changes: FileChange[]): Promise<void> {
    void this.refreshTree();
    void this.refreshGit();
    for (const change of changes) {
      const f = this.open().find((x) => x.path === change.path);
      if (!f || change.hash === f.hash) continue; // not open, or our own save
      if (change.hash === null) {
        this.toast.show(`${f.path} was deleted on disk`, 'info');
        continue;
      }
      const res = await api<{ content: string; hash: string }>('GET', `/api/file?path=${encodeURIComponent(f.path)}`).catch(() => null);
      if (!res) continue;
      if (f.current === f.saved) {
        this.setBuffer(f.path, res.content, res.hash);
        this.toast.show(`Reloaded ${f.path} (changed on disk)`, 'info');
      } else {
        this.patchOpen(f.path, { diskChanged: { content: res.content, hash: res.hash } });
      }
    }
  }

  protected async newFile(): Promise<void> {
    const dir = this.active()?.split('/').slice(0, -1).join('/') ?? '';
    const path = prompt('New file path (inside site/):', dir ? `${dir}/` : 'scripts/new.js');
    if (!path) return;
    try {
      await api('POST', '/api/file', { path: path.trim(), content: '' });
      await this.refreshTree();
      await this.openFile(path.trim());
    } catch (e) {
      this.toast.show((e as Error).message, 'error');
    }
  }

  protected async deleteFile(path: string, event: Event): Promise<void> {
    event.stopPropagation();
    if (!confirm(`Delete ${path}? You can restore it from Git if it was committed.`)) return;
    try {
      await api('DELETE', `/api/file?path=${encodeURIComponent(path)}`);
      if (this.open().some((f) => f.path === path)) {
        this.states.delete(path);
        this.open.update((l) => l.filter((f) => f.path !== path));
        if (this.active() === path) this.active.set(this.open().at(-1)?.path ?? null);
      }
      await this.refreshTree();
    } catch (e) {
      this.toast.show((e as Error).message, 'error');
    }
  }

  protected openInVsCode(): void {
    this.project.openInEditor(this.active() ?? undefined).catch((e: Error) => this.toast.show(e.message, 'error'));
  }

  // --- search ------------------------------------------------------------------------------------

  protected async search(): Promise<void> {
    const q = this.searchQuery().trim();
    if (!q) return;
    this.searching.set(true);
    try {
      const params = new URLSearchParams({ q, regex: this.searchRegex() ? '1' : '0', case: this.searchCase() ? '1' : '0' });
      this.searchResults.set(await api('GET', `/api/search?${params}`));
    } catch (e) {
      this.toast.show((e as Error).message, 'error');
    } finally {
      this.searching.set(false);
    }
  }

  protected readonly groupedResults = computed(() => {
    const groups = new Map<string, { line: number; text: string }[]>();
    for (const r of this.searchResults()) {
      if (!groups.has(r.path)) groups.set(r.path, []);
      groups.get(r.path)!.push(r);
    }
    return [...groups.entries()].map(([path, hits]) => ({ path, hits }));
  });

  // --- git ------------------------------------------------------------------------------------------

  protected async refreshGit(): Promise<void> {
    try {
      const [status, log, branches] = await Promise.all([
        api<GitStatus>('GET', '/api/git/status'),
        api('GET', '/api/git/log'),
        api('GET', '/api/git/branches'),
      ]);
      this.git.set(status);
      this.gitLog.set(log);
      this.branches.set(branches);
    } catch {
      this.git.set(null);
    }
  }

  protected async showGitDiff(path: string): Promise<void> {
    try {
      const [head, current] = await Promise.all([
        api<{ content: string | null }>('GET', `/api/git/show?path=${encodeURIComponent(path)}`),
        api<{ content: string }>('GET', `/api/file?path=${encodeURIComponent(path)}`).catch(() => ({ content: '' })),
      ]);
      this.diff.set({ title: `${path}: last commit ↔ working copy`, path, a: head.content ?? '', b: current.content });
    } catch (e) {
      this.toast.show((e as Error).message, 'error');
    }
  }

  private async gitAction(fn: () => Promise<unknown>, success: string): Promise<void> {
    this.gitBusy.set(true);
    try {
      await fn();
      this.toast.show(success);
      await this.refreshGit();
    } catch (e) {
      this.toast.show((e as Error).message, 'error');
    } finally {
      this.gitBusy.set(false);
    }
  }

  protected commit(): void {
    const message = this.commitMessage().trim();
    if (!message) return;
    if (this.dirtyCount() && !confirm('Some open files have unsaved changes that will not be committed. Commit anyway?')) return;
    void this.gitAction(async () => {
      await api('POST', '/api/git/commit', { message });
      this.commitMessage.set('');
    }, 'Committed');
  }

  protected revertGit(path: string): void {
    if (!confirm(`Discard all uncommitted changes to ${path}? This cannot be undone.`)) return;
    void this.gitAction(() => api('POST', '/api/git/revert', { path }), `Reverted ${path}`);
  }

  protected newBranch(): void {
    const name = prompt('New branch name:')?.trim();
    if (name) void this.gitAction(() => api('POST', '/api/git/branch', { name }), `Created and switched to ${name}`);
  }

  protected switchBranch(event: Event): void {
    const name = (event.target as HTMLSelectElement).value;
    if (name === this.branches().current) return;
    if (this.dirtyCount() && !confirm('You have unsaved files. Switch branch anyway?')) return;
    void this.gitAction(() => api('POST', '/api/git/switch', { name }), `Switched to ${name}`);
  }

  // --- components & build ------------------------------------------------------------------------

  protected async createComponent(event: Event): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.target as HTMLFormElement);
    const label = String(form.get('label') ?? '').trim();
    const base = String(form.get('base') ?? '');
    if (!label) return;
    const folder = label.replace(/[^a-zA-Z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : '')).replace(/^./, (c) => c.toUpperCase());
    const type = slugify(label);
    if (this.project.components().some((c) => c.type === type || c.folder === folder)) {
      this.toast.show(`A component called ${folder} already exists`, 'error');
      return;
    }
    const source = this.project.components().find((c) => c.type === base);
    const files = source ? this.copyComponent(source, type, label) : this.blankComponent(type, label);
    try {
      for (const [name, content] of Object.entries(files)) await api('POST', '/api/file', { path: `components/${folder}/${name}`, content });
      this.newComponentOpen.set(false);
      await this.refreshTree();
      await this.openFile(`components/${folder}/component.html`);
      this.toast.show(`${folder} created — it's now in the editor's "Add section" menu`);
    } catch (e) {
      this.toast.show((e as Error).message, 'error');
    }
  }

  private blankComponent(type: string, label: string): Record<string, string> {
    const schema = {
      type,
      label,
      description: 'Custom component',
      icon: 'layout',
      fields: [
        { key: 'heading', label: 'Heading', type: 'text' },
        { key: 'text', label: 'Text', type: 'textarea' },
        { key: 'buttonLabel', label: 'Button label', type: 'text' },
        { key: 'buttonHref', label: 'Button link', type: 'url' },
      ],
      elements: [
        { key: 'heading', label: 'Heading', kind: 'text', fields: ['heading'] },
        { key: 'text', label: 'Text', kind: 'text', fields: ['text'] },
        { key: 'button', label: 'Button', kind: 'button', fields: ['buttonLabel', 'buttonHref'] },
      ],
      defaults: { heading: label, text: 'Describe this section. Edit the template in components/.', buttonLabel: 'Learn more', buttonHref: '#' },
    };
    return {
      'schema.json': JSON.stringify(schema, null, 2) + '\n',
      'component.html': `{{!--
  ${label} — template for this section (see site/README.md for the syntax).
  Fields come from schema.json. data-el makes an element selectable/styleable in the
  visual editor; data-edit="field" makes its text editable on the canvas.
--}}
<div class="${type}">
  <h2 class="lp-h2" data-el="heading" data-edit="heading">{{heading}}</h2>
  <p class="lp-lead lp-pre" data-el="text" data-edit="text">{{text}}</p>
  {{#if buttonLabel}}
  <a class="lp-btn lp-btn-primary" data-el="button" data-edit="buttonLabel" href="{{buttonHref}}">{{buttonLabel}}</a>
  {{/if}}
</div>
`,
      'component.css': `/* ${label} section. Scope rules with the section class to avoid affecting others. */

.lp-sec-${type} .${type} {
  max-width: 720px;
  margin: 0 auto;
}
`,
    };
  }

  private copyComponent(source: ComponentDef, type: string, label: string): Record<string, string> {
    const { folder, template, css, ...schema } = source as ComponentDef & { error?: unknown };
    delete (schema as { error?: unknown }).error;
    return {
      'schema.json': JSON.stringify({ ...schema, type, label, description: `Copy of ${source.label}` }, null, 2) + '\n',
      'component.html': template,
      'component.css': css.replaceAll(`.lp-sec-${source.type}`, `.lp-sec-${type}`),
    };
  }

  protected async buildSite(): Promise<void> {
    this.building.set(true);
    try {
      const res = await this.exporter.build();
      this.toast.show(`Built ${res.pages} published page${res.pages === 1 ? '' : 's'} into ${res.dir}`);
      await this.refreshTree();
    } catch (e) {
      this.toast.show((e as Error).message, 'error');
    } finally {
      this.building.set(false);
    }
  }

  protected setPreview(event: Event): void {
    this.previewSlug.set((event.target as HTMLSelectElement).value || null);
  }

  protected openVisualEditor(): void {
    const page = this.previewPageOf(this.previewSlug());
    void this.router.navigate(page ? ['/admin/pages', page.id] : ['/admin']);
  }

  protected onKeydown(e: KeyboardEvent): void {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (e.shiftKey) void this.saveAll();
      else void this.save();
    } else if (mod && e.shiftKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      this.panel.set('search');
    }
  }

  protected onBeforeUnload(e: BeforeUnloadEvent): void {
    if (this.dirtyCount()) e.preventDefault();
  }

  protected setSearch(e: Event): void {
    this.searchQuery.set((e.target as HTMLInputElement).value);
  }

  protected setCommitMessage(e: Event): void {
    this.commitMessage.set((e.target as HTMLTextAreaElement).value);
  }
}
