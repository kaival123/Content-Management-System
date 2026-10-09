import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, signal, viewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { findBuilderElement, getBuilderElementDef } from '../../core/builder';
import {
  CardStyle,
  CustomSectionData,
  Device,
  ElementKind,
  ElementStyle,
  FieldDef,
  GridItemAlign,
  GridSettings,
  LandingPage,
  Section,
  SectionStyle,
  SectionType,
  Selection,
  Theme,
} from '../../core/models';
import { AuthService } from '../../core/auth.service';
import { EditHistory, HistoryTarget } from '../../core/edit-history';
import { ConflictChoice, PageStore } from '../../core/page-store';
import { ProjectService, pageDir, sectionFilePath } from '../../core/project.service';
import { SiteService } from '../../core/site.service';
import { SectionPreset, instantiateSection, toPreset } from '../../core/templates';
import { WebsiteStore } from '../../core/website-store';
import { CarouselPatch, CarouselSettingsForm } from './carousel-settings';
import { PagesPanel } from './pages-panel';
import { SectionLibrary } from './section-library';
import { DEFAULT_CAROUSEL, getElementDef, getSectionDef, resolveCarousel, resolveGrid, sectionDefs, supportsCarousel, supportsGrid } from '../../core/section-registry';
import { resolveTheme } from '../../core/styles';
import { FONT_OPTIONS } from '../../core/templates';
import { slugify, uid } from '../../core/util';
import { api } from '../../core/api';
import { PageRenderer, TextEdit } from '../../renderer/page-renderer';
import { downloadFile } from '../../shared/files';
import { Icon } from '../../shared/icon';
import { ToastService } from '../../shared/toast';
import { RangeControl, SegControl, SegOption, ToggleControl } from './controls';
import { ConflictDialog } from './conflict-dialog';
import { CustomBuilder } from './custom-builder';
import { ElementStyleForm, StylePatch } from './element-style-form';
import { FieldPatch, SectionForm } from './section-form';
import { SectionSettings, SectionStylePatch } from './section-settings';

type LeftTab = 'pages' | 'sections' | 'theme' | 'settings';
type SectionTab = 'content' | 'grid' | 'slider' | 'style' | 'advanced';
type ElementTab = 'content' | 'style' | 'advanced';

/** Everything the element panel needs about the selected element. */
interface ElementInfo {
  source: 'preset' | 'builder' | 'column';
  label: string;
  kind: ElementKind;
  style: ElementStyle | undefined;
  fields: FieldDef[];
  data: any;
  /** For elements repeated per list item. */
  index: number | null;
  count: number;
}

/** Width each device is rendered at. Desktop is a minimum; it fills wider canvases. */
const DEVICE_WIDTH: Record<Device, number> = { desktop: 1280, tablet: 820, mobile: 390 };

const THEME_PRESETS: { name: string; theme: Partial<Theme> }[] = [
  { name: 'Indigo', theme: { primaryColor: '#4f46e5', accentColor: '#06b6d4', backgroundColor: '#ffffff', surfaceColor: '#f8fafc', textColor: '#0f172a' } },
  { name: 'Emerald', theme: { primaryColor: '#059669', accentColor: '#0ea5e9', backgroundColor: '#ffffff', surfaceColor: '#f0fdf4', textColor: '#052e16' } },
  { name: 'Sunset', theme: { primaryColor: '#ea580c', accentColor: '#db2777', backgroundColor: '#fffbf5', surfaceColor: '#fff1e6', textColor: '#291507' } },
  { name: 'Rose', theme: { primaryColor: '#e11d48', accentColor: '#9333ea', backgroundColor: '#ffffff', surfaceColor: '#fff1f2', textColor: '#1f0a12' } },
  { name: 'Midnight', theme: { primaryColor: '#f59e0b', accentColor: '#f43f5e', backgroundColor: '#0b1020', surfaceColor: '#131a33', textColor: '#e2e8f0' } },
  { name: 'Mono', theme: { primaryColor: '#111827', accentColor: '#6b7280', backgroundColor: '#ffffff', surfaceColor: '#f4f4f5', textColor: '#111827' } },
];

/** Removes keys set to undefined so "reset" really falls back to defaults. */
function applyPatch<T extends object>(target: T, key: keyof T, value: unknown): void {
  if (value === undefined) delete target[key];
  else (target as any)[key] = value;
}

@Component({
  selector: 'app-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    DatePipe,
    Icon,
    PageRenderer,
    SectionForm,
    SectionSettings,
    ElementStyleForm,
    CustomBuilder,
    ConflictDialog,
    PagesPanel,
    SectionLibrary,
    CarouselSettingsForm,
    RangeControl,
    SegControl,
    ToggleControl,
  ],
  templateUrl: './editor.html',
  host: { class: 'ed', '(window:keydown)': 'onKeydown($event)' },
})
export class Editor {
  /** Route param, bound via withComponentInputBinding. */
  readonly id = input.required<string>();

  protected readonly store = inject(PageStore);
  protected readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly project = inject(ProjectService);
  private readonly router = inject(Router);

  // --- sync with the project folder -----------------------------------------------------------

  protected readonly saveState = computed(() => this.store.saveState(this.id()));
  protected readonly conflicts = computed(() => this.store.conflicts(this.id()));
  protected readonly saveError = computed(() => this.store.saveError(this.id()));
  protected readonly reviewing = signal(false);
  private readonly previewEl = viewChild<ElementRef<HTMLElement>>('preview');
  private readonly canvasEl = viewChild<ElementRef<HTMLElement>>('canvas');

  protected readonly page = computed(() => this.store.getById(this.id()));
  protected readonly theme = computed(() => resolveTheme(this.page()?.theme ?? ({} as Theme)));
  protected readonly websites = inject(WebsiteStore);
  private readonly edits = inject(EditHistory);
  private readonly site = inject(SiteService);
  protected readonly website = computed(() => this.websites.get(this.page()?.website));
  /** Pages of this website, for link pickers. */
  protected readonly sitePages = computed(() => {
    const p = this.page();
    return p ? this.store.pagesOf(p.website).map((x) => ({ slug: x.slug, title: x.title })) : [];
  });
  protected readonly libraryOpen = signal(false);
  protected readonly savingPreset = signal<Section | null>(null);

  // --- selection -------------------------------------------------------------------

  protected readonly selectedId = signal<string | null>(null);
  private readonly selectedEl = signal<{ el: string; index: number | null } | null>(null);
  protected readonly selected = computed(() => this.page()?.sections.find((s) => s.id === this.selectedId()) ?? null);
  protected readonly selectedDef = computed(() => {
    const s = this.selected();
    return s ? getSectionDef(s.type) : null;
  });
  /** The section's own fields, plus a "send submissions to" field for contact forms. */
  protected readonly sectionFields = computed<FieldDef[]>(() => {
    const def = this.selectedDef();
    if (!def) return [];
    if (this.selected()?.type !== 'contact') return def.fields;
    return [
      ...def.fields,
      { key: 'notifyEmail', label: 'Send form submissions to', type: 'text', placeholder: 'defaults to the website / account email' },
    ];
  });
  protected readonly selection = computed<Selection | null>(() => {
    const id = this.selectedId();
    if (!id) return null;
    const el = this.selectedEl();
    return { sectionId: id, el: el?.el ?? null, index: el?.index ?? null };
  });

  /** Resolves the selected element to what the element panel shows; null when a section (or nothing) is selected. */
  protected readonly element = computed<ElementInfo | null>(() => {
    const s = this.selected();
    const sel = this.selectedEl();
    if (!s || !sel) return null;

    if (sel.el.startsWith('el:')) {
      const found = findBuilderElement(s.data, sel.el.slice(3));
      if (!found) return null;
      const def = getBuilderElementDef(found.element.type);
      return { source: 'builder', label: def.label, kind: def.kind, style: found.element.style, fields: def.fields, data: found.element.data, index: null, count: 0 };
    }
    if (sel.el.startsWith('col:')) {
      const colId = sel.el.slice(4);
      const index = (s.data as CustomSectionData).columns?.findIndex((c) => c.id === colId) ?? -1;
      if (index < 0) return null;
      const col = s.data.columns[index];
      return { source: 'column', label: `Column ${index + 1}`, kind: 'box', style: col.style, fields: [], data: {}, index: null, count: 0 };
    }

    const def = getElementDef(s.type, sel.el);
    if (!def) return null;
    const sectionDef = getSectionDef(s.type);
    const wanted = new Set(def.fields ?? []);
    if (def.list) {
      const items: any[] = s.data[def.list] ?? [];
      const listField = sectionDef.fields.find((f) => f.key === def.list);
      const index = Math.min(sel.index ?? 0, Math.max(items.length - 1, 0));
      return {
        source: 'preset',
        label: def.label,
        kind: def.kind,
        style: s.elements?.[def.key],
        fields: (listField?.itemFields ?? []).filter((f) => wanted.has(f.key)),
        data: items[index] ?? {},
        index,
        count: items.length,
      };
    }
    return {
      source: 'preset',
      label: def.label,
      kind: def.kind,
      style: s.elements?.[def.key],
      fields: sectionDef.fields.filter((f) => wanted.has(f.key)),
      data: s.data,
      index: null,
      count: 0,
    };
  });

  // --- panels ------------------------------------------------------------------------

  protected readonly leftTab = signal<LeftTab>('sections');
  private readonly sectionTabChoice = signal<SectionTab>('content');
  protected readonly elementTab = signal<ElementTab>('style');
  /** Effective settings of the selected section's grid, or null if it has none. */
  protected readonly selectedCarousel = computed(() => {
    const s = this.selected();
    return s && supportsCarousel(s.type) ? resolveCarousel(s) : null;
  });
  protected readonly selectedGrid = computed(() => {
    const s = this.selected();
    return s && supportsGrid(s.type) ? resolveGrid(s) : null;
  });
  /** Falls back to Content when the Grid tab is chosen but the section has no grid. */
  protected readonly sectionTab = computed<SectionTab>(() =>
    (this.sectionTabChoice() === 'grid' && !this.selectedGrid()) || (this.sectionTabChoice() === 'slider' && !this.selectedCarousel()) ? 'content' : this.sectionTabChoice(),
  );
  /** Columns have no content of their own, so they open on Style. */
  protected readonly effectiveElementTab = computed<ElementTab>(() =>
    this.element()?.source === 'column' && this.elementTab() === 'content' ? 'style' : this.elementTab(),
  );

  protected readonly device = signal<Device>('desktop');
  /** Space available for the preview; updated by a ResizeObserver. */
  private readonly canvasWidth = signal(DEVICE_WIDTH.desktop);
  /**
   * The preview renders at the device's real width and is zoomed down to fit, so
   * container queries (and therefore per-device layouts) match the real page.
   */
  protected readonly frameWidth = computed(() =>
    this.device() === 'desktop' ? Math.max(DEVICE_WIDTH.desktop, this.canvasWidth()) : DEVICE_WIDTH[this.device()],
  );
  protected readonly frameZoom = computed(() => Math.min(1, this.canvasWidth() / this.frameWidth()));
  protected readonly addOpen = signal(false);
  protected readonly dragIndex = signal<number | null>(null);
  protected readonly dropIndex = signal<number | null>(null);
  protected readonly slugError = signal('');

  protected readonly canUndo = computed(() => !!this.page() && this.edits.canUndo(this.page()!.website));
  protected readonly canRedo = computed(() => !!this.page() && this.edits.canRedo(this.page()!.website));
  protected readonly previewUrl = computed(() => {
    const p = this.page();
    this.website();
    return p ? `${this.site.pageUrl(p.website, p.slug)}${p.status === 'draft' ? '?preview=1' : ''}` : '';
  });

  /** Components available in the project (reactive: follows site/components/). */
  protected readonly sectionDefs = computed(() => sectionDefs());
  protected readonly fonts = FONT_OPTIONS;
  protected readonly presets = THEME_PRESETS;
  protected readonly devices: { value: Device; icon: string; label: string }[] = [
    { value: 'desktop', icon: 'monitor', label: 'Desktop' },
    { value: 'tablet', icon: 'tablet', label: 'Tablet' },
    { value: 'mobile', icon: 'phone', label: 'Mobile' },
  ];
  protected readonly themeColors: { key: keyof Theme; label: string }[] = [
    { key: 'primaryColor', label: 'Primary' },
    { key: 'accentColor', label: 'Accent' },
    { key: 'backgroundColor', label: 'Background' },
    { key: 'surfaceColor', label: 'Surface' },
    { key: 'textColor', label: 'Text' },
  ];
  protected readonly headingWeights: SegOption<number>[] = [400, 500, 600, 700, 800, 900].map((w) => ({ value: w, label: String(w) }));
  protected readonly buttonWeights: SegOption<number>[] = [400, 500, 600, 700, 800].map((w) => ({ value: w, label: String(w) }));
  protected readonly gridDevices: { key: Device; label: string; icon: string; options: number[] }[] = [
    { key: 'desktop', label: 'Desktop', icon: 'monitor', options: [1, 2, 3, 4, 5, 6] },
    { key: 'tablet', label: 'Tablet', icon: 'tablet', options: [1, 2, 3, 4] },
    { key: 'mobile', label: 'Mobile', icon: 'phone', options: [1, 2, 3] },
  ];
  protected readonly cardStyles: { value: CardStyle; label: string }[] = [
    { value: 'bordered', label: 'Bordered' },
    { value: 'shadow', label: 'Shadow' },
    { value: 'flat', label: 'Filled' },
    { value: 'none', label: 'Plain' },
  ];
  protected readonly itemAligns: { value: GridItemAlign; label: string }[] = [
    { value: 'stretch', label: 'Equal height' },
    { value: 'start', label: 'Top' },
    { value: 'center', label: 'Middle' },
  ];

  constructor() {
    // Tell the user when the page was reloaded because its files changed (e.g. saved in VS Code).
    effect(() => {
      const ext = this.store.externalUpdate();
      if (ext?.id !== this.id()) return;
      const names = ext.paths.map((p) => p.split('/').pop()).join(', ');
      this.toast.show(`Updated from code: ${names}`, 'info');
    });

    // The canvas only exists once the page has loaded, so observe it whenever it appears.
    effect((onCleanup) => {
      const canvas = this.canvasEl()?.nativeElement;
      if (!canvas) return;
      const ro = new ResizeObserver(([entry]) => this.canvasWidth.set(Math.max(200, entry.contentRect.width)));
      ro.observe(canvas);
      onCleanup(() => ro.disconnect());
    });
  }

  protected keepMine(): void {
    void this.store.keepMine(this.id());
  }

  protected keepTheirs(): void {
    if (!confirm('Discard your unsaved changes in the visual editor and load the version from the files?')) return;
    void this.store.keepTheirs(this.id());
  }

  protected applyMerge(choices: Record<string, ConflictChoice>): void {
    this.reviewing.set(false);
    void this.store.merge(this.id(), choices).then(() => this.toast.show('Changes merged and saved'));
  }

  protected retrySave(): void {
    void this.store.save(this.id());
  }

  /** Opens a section's source file (or its component) in Developer Mode. */
  protected editCode(s: Section, target: 'section' | 'component'): void {
    const p = this.page();
    if (!p) return;
    const file = target === 'section' ? sectionFilePath(p.website, p.slug, s) : `components/${this.project.components().find((c) => c.type === s.type)?.folder}/component.html`;
    void this.router.navigate(['/admin/code'], { queryParams: { file, page: `${p.website}/${p.slug}` } });
  }

  protected openInVsCode(s?: Section): void {
    const p = this.page();
    if (!p) return;
    this.project.openInEditor(s ? sectionFilePath(p.website, p.slug, s) : `${pageDir(p.website, p.slug)}/page.json`).catch((e: Error) => this.toast.show(e.message, 'error'));
  }

  protected def(s: Section) {
    return getSectionDef(s.type);
  }

  private edit(recipe: (p: LandingPage) => void, coalesceKey?: string): void {
    this.store.update(this.id(), recipe, coalesceKey);
  }

  private editSection(sectionId: string, recipe: (s: Section) => void, coalesceKey?: string): void {
    this.edit((p) => {
      const s = p.sections.find((x) => x.id === sectionId);
      if (s) recipe(s);
    }, coalesceKey);
  }

  // --- selection ----------------------------------------------------------------------

  protected onSelect(sel: Selection, scroll = false): void {
    this.selectedId.set(sel.sectionId);
    this.selectedEl.set(sel.el ? { el: sel.el, index: sel.index } : null);
    this.leftTab.set('sections');
    if (scroll) {
      const el = this.previewEl()?.nativeElement.querySelector(`[data-section-id="${sel.sectionId}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  /** A new element was added in the builder: select it and open its content. */
  protected onElementAdded(sel: Selection): void {
    this.onSelect(sel);
    this.elementTab.set('content');
  }

  protected selectSection(id: string, scroll = false): void {
    this.onSelect({ sectionId: id, el: null, index: null }, scroll);
  }

  protected selectElement(key: string): void {
    const id = this.selectedId();
    if (id) this.onSelect({ sectionId: id, el: key, index: 0 });
  }

  protected backToSection(): void {
    this.selectedEl.set(null);
  }

  protected clearSelection(): void {
    this.selectedId.set(null);
    this.selectedEl.set(null);
  }

  /** Steps through items of a repeated element (e.g. feature 1 → 2). */
  protected stepItem(dir: -1 | 1): void {
    const info = this.element();
    const sel = this.selectedEl();
    if (!info || !sel || info.index === null) return;
    const next = (info.index + dir + info.count) % info.count;
    this.selectedEl.set({ ...sel, index: next });
  }

  protected setSectionTab(tab: SectionTab): void {
    this.sectionTabChoice.set(tab);
  }

  // --- element edits ----------------------------------------------------------------

  /** Text typed directly on the canvas. */
  protected onTextEdit({ selection, field, value }: TextEdit): void {
    const { sectionId, el, index } = selection;
    if (!el) return;
    this.editSection(
      sectionId,
      (s) => {
        if (el.startsWith('el:')) {
          const found = findBuilderElement(s.data, el.slice(3));
          if (found) found.element.data[field] = value;
          return;
        }
        // Repeated elements write into their list item; others into the section's data.
        const list = getElementDef(s.type, el)?.list;
        if (list) {
          const item = s.data[list]?.[index ?? 0];
          if (item) item[field] = value;
        } else {
          s.data[field] = value;
        }
      },
      `${sectionId}:${el}:${index}:${field}`,
    );
  }

  /** Content changed in the element panel. */
  protected patchElementContent(patch: FieldPatch): void {
    const sel = this.selection();
    const info = this.element();
    if (!sel?.el || !info) return;
    this.editSection(
      sel.sectionId,
      (s) => {
        if (info.source === 'builder') {
          const found = findBuilderElement(s.data, sel.el!.slice(3));
          if (found) found.element.data[patch.key] = patch.value;
          return;
        }
        const def = getElementDef(s.type, sel.el!);
        if (def?.list) {
          const item = s.data[def.list]?.[info.index ?? 0];
          if (item) item[patch.key] = patch.value;
        } else {
          s.data[patch.key] = patch.value;
        }
      },
      `${sel.sectionId}:${sel.el}:${info.index}:${patch.path}`,
    );
  }

  /** Finds the style object of an element inside a draft section, creating it for preset elements. */
  private styleTarget(s: Section, el: string): ElementStyle | null {
    if (el.startsWith('el:')) return findBuilderElement(s.data, el.slice(3))?.element.style ?? null;
    if (el.startsWith('col:')) return (s.data as CustomSectionData).columns.find((c) => c.id === el.slice(4))?.style ?? null;
    s.elements ??= {};
    return (s.elements[el] ??= {});
  }

  protected patchElementStyle({ key, value }: StylePatch): void {
    const sel = this.selection();
    if (!sel?.el) return;
    this.editSection(
      sel.sectionId,
      (s) => {
        const target = this.styleTarget(s, sel.el!);
        if (!target) return;
        applyPatch(target, key, value);
        if (s.elements?.[sel.el!] && !Object.keys(s.elements[sel.el!]).length) delete s.elements[sel.el!];
      },
      `${sel.sectionId}:${sel.el}:style.${key}`,
    );
  }

  protected resetElementStyle(): void {
    const sel = this.selection();
    if (!sel?.el) return;
    this.editSection(sel.sectionId, (s) => {
      const target = this.styleTarget(s, sel.el!);
      if (target) for (const k of Object.keys(target)) delete (target as any)[k];
      if (s.elements) delete s.elements[sel.el!];
    });
    this.toast.show('Element style reset', 'info');
  }

  protected toggleElementHidden(): void {
    const info = this.element();
    this.patchElementStyle({ key: 'hidden', value: info?.style?.hidden ? undefined : true });
  }

  protected removeBuilderElement(): void {
    const sel = this.selection();
    if (!sel?.el?.startsWith('el:')) return;
    this.editSection(sel.sectionId, (s) => {
      const found = findBuilderElement(s.data, sel.el!.slice(3));
      if (found) found.column.elements.splice(found.index, 1);
    });
    this.backToSection();
  }

  protected duplicateBuilderElement(): void {
    const sel = this.selection();
    if (!sel?.el?.startsWith('el:')) return;
    const newId = uid('e_');
    this.editSection(sel.sectionId, (s) => {
      const found = findBuilderElement(s.data, sel.el!.slice(3));
      if (found) found.column.elements.splice(found.index + 1, 0, { ...structuredClone(found.element), id: newId });
    });
    this.onSelect({ sectionId: sel.sectionId, el: 'el:' + newId, index: null });
  }

  // --- section edits -------------------------------------------------------------------

  /** Inserts a section from the library after the selected section (or before the footer). */
  /** The page already has a back to top button (one per page is enough). */
  protected readonly hasBackToTop = computed(() => !!this.page()?.sections.some((s) => s.type === 'back-to-top'));

  /** One-click back to top button, at the end of the page (its place doesn't matter). */
  protected addBackToTop(): void {
    const section = instantiateSection({ type: 'back-to-top' });
    this.edit((p) => p.sections.push(section));
    this.sectionTabChoice.set('content');
    setTimeout(() => this.selectSection(section.id, true));
    this.toast.show('Added a back to top button — more designs under Add section → Back to top');
  }

  protected insertPreset(preset: SectionPreset): void {
    const section = instantiateSection(preset);
    this.libraryOpen.set(false);
    this.edit((p) => {
      const at = p.sections.findIndex((s) => s.id === this.selectedId());
      // Insert after the selected section, or before the footer, or at the end.
      const footer = p.sections.findIndex((s) => s.type === 'footer');
      const index = at >= 0 ? at + 1 : footer >= 0 ? footer : p.sections.length;
      p.sections.splice(index, 0, section);
    });
    this.sectionTabChoice.set('content');
    setTimeout(() => this.selectSection(section.id, true));
    this.toast.show(`Added “${getSectionDef(section.type).label}”`);
  }

  protected patchSection(sectionId: string, patch: FieldPatch): void {
    this.editSection(sectionId, (s) => (s.data[patch.key] = patch.value), `${sectionId}:${patch.path}`);
  }

  protected patchSectionStyle(sectionId: string, { key, value }: SectionStylePatch): void {
    this.editSection(sectionId, (s) => applyPatch(s.style, key, value), `${sectionId}:style.${key}`);
  }

  /** Several style values at once, as a single undo step (e.g. the Slider tab's width choice). */
  protected patchSectionStyles(sectionId: string, patch: Partial<SectionStyle>): void {
    this.editSection(sectionId, (s) => {
      for (const [key, value] of Object.entries(patch)) applyPatch(s.style, key as keyof SectionStyle, value);
    }, `${sectionId}:style.${Object.keys(patch).join()}`);
  }

  protected setAnchor(sectionId: string, anchor: string): void {
    this.editSection(sectionId, (s) => (s.data.anchor = anchor));
  }

  protected setCustomData(sectionId: string, data: CustomSectionData): void {
    this.editSection(sectionId, (s) => (s.data = data));
  }

  protected toggleVisible(s: Section, e?: Event): void {
    e?.stopPropagation();
    this.editSection(s.id, (x) => (x.visible = !x.visible));
  }

  protected move(index: number, dir: -1 | 1, e?: Event): void {
    e?.stopPropagation();
    this.reorder(index, index + dir);
  }

  private reorder(from: number, to: number): void {
    this.edit((p) => {
      if (to < 0 || to >= p.sections.length || from === to) return;
      const [item] = p.sections.splice(from, 1);
      p.sections.splice(to, 0, item);
    });
  }

  protected duplicateSection(s: Section, e?: Event): void {
    e?.stopPropagation();
    const copy: Section = { ...structuredClone(s), id: uid('s_') };
    // Builder elements need fresh ids so selecting one doesn't select its twin.
    if (copy.type === 'custom') {
      for (const col of (copy.data as CustomSectionData).columns) {
        col.id = uid('c_');
        for (const el of col.elements) el.id = uid('e_');
      }
    }
    this.edit((p) => {
      const i = p.sections.findIndex((x) => x.id === s.id);
      p.sections.splice(i + 1, 0, copy);
    });
    this.selectSection(copy.id);
  }

  protected removeSection(s: Section, e?: Event): void {
    e?.stopPropagation();
    if (!confirm(`Remove the “${this.def(s).label}” section?`)) return;
    this.edit((p) => (p.sections = p.sections.filter((x) => x.id !== s.id)));
    if (this.selectedId() === s.id) this.clearSelection();
  }

  // Native drag & drop for the section list.
  protected onDragStart(i: number, e: DragEvent): void {
    this.dragIndex.set(i);
    e.dataTransfer?.setData('text/plain', String(i));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  }

  protected onDragOver(i: number, e: DragEvent): void {
    if (this.dragIndex() === null) return;
    e.preventDefault();
    this.dropIndex.set(i);
  }

  protected onDrop(i: number, e: DragEvent): void {
    e.preventDefault();
    const from = this.dragIndex();
    if (from !== null) this.reorder(from, i);
    this.onDragEnd();
  }

  protected onDragEnd(): void {
    this.dragIndex.set(null);
    this.dropIndex.set(null);
  }

  // --- grid ------------------------------------------------------------------------------

  protected setGrid<K extends keyof GridSettings>(sectionId: string, key: K, value: GridSettings[K]): void {
    this.editSection(
      sectionId,
      (s) => {
        s.grid = { ...resolveGrid(s), [key]: value };
        // Superseded by grid settings (pages saved before grids existed).
        delete s.data.columns;
      },
      `${sectionId}:grid.${key}`,
    );
  }

  /** Sets a device's column count and switches the preview to that device so the change is visible. */
  protected setColumns(sectionId: string, device: Device, cols: number): void {
    this.setGrid(sectionId, device, cols);
    this.device.set(device);
  }

  protected resetGrid(sectionId: string): void {
    this.editSection(sectionId, (s) => {
      delete s.grid;
      delete s.data.columns;
      s.grid = resolveGrid(s);
    });
  }

  /** Cells for the Grid tab's mini diagram: one per item, with the item's span, clamped to the column count. */
  protected diagramBlocks(s: Section): { c: number; r: number }[] {
    const cols = resolveGrid(s)[this.device()];
    const items: any[] = s.data.items ?? s.data.plans ?? [];
    return items.map((item) =>
      s.type === 'grid' ? { c: Math.min(Number(item.colSpan) || 1, cols), r: Number(item.rowSpan) || 1 } : { c: 1, r: 1 },
    );
  }

  // --- carousel -------------------------------------------------------------------------------

  protected patchCarousel(sectionId: string, { key, value }: CarouselPatch): void {
    this.editSection(sectionId, (s) => (s.carousel = { ...resolveCarousel(s), [key]: value }), `${sectionId}:carousel.${key}`);
  }

  protected resetCarousel(sectionId: string): void {
    this.editSection(sectionId, (s) => (s.carousel = { ...DEFAULT_CAROUSEL, ...getSectionDef(s.type).carousel }));
  }

  // --- reusable sections ---------------------------------------------------------------------

  /** Saves a section to site/library/saved/ so it can be inserted on any page. */
  protected async saveToLibrary(event: Event): Promise<void> {
    event.preventDefault();
    const section = this.savingPreset();
    if (!section) return;
    const name = String(new FormData(event.target as HTMLFormElement).get('name') ?? '').trim();
    if (!name) return;
    const file = `library/saved/${slugify(name) || 'section'}-${Date.now().toString(36)}.json`;
    const content = JSON.stringify({ name, description: `Saved from “${this.page()?.title}”`, section: toPreset(section) }, null, 2) + '\n';
    try {
      await api('POST', '/api/file', { path: file, content });
      this.savingPreset.set(null);
      this.toast.show(`Saved “${name}” — find it under Add section → Saved sections`);
    } catch (e) {
      this.toast.show((e as Error).message, 'error');
    }
  }

  /** Opens another page of the website in the editor. */
  protected openPage(pageId: string): void {
    if (pageId === this.id()) return;
    this.clearSelection();
    void this.router.navigate(['/admin/pages', pageId]);
  }

  // --- theme --------------------------------------------------------------------------------

  /** Theme settings apply to the whole website; custom CSS here is the page's own. */
  protected setTheme<K extends keyof Theme>(key: K, value: Theme[K] | undefined): void {
    const p = this.page();
    if (!p) return;
    if (key === 'customCss') {
      this.edit((d) => (d.customCss = (value as string | undefined) ?? ''), 'customCss');
      return;
    }
    this.websites.update(p.website, (w) => applyPatch(w.theme, key, value), `theme.${key}`);
  }

  protected setWebsiteCss(e: Event): void {
    const p = this.page();
    if (p) this.websites.update(p.website, (w) => (w.customCss = (e.target as HTMLTextAreaElement).value), 'customCss');
  }

  protected themeText(key: keyof Theme, e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    this.setTheme(key, (v.trim() ? v : undefined) as never);
  }

  protected applyPreset(theme: Partial<Theme>): void {
    const p = this.page();
    if (p) this.websites.update(p.website, (w) => (w.theme = { ...w.theme, ...theme }));
  }

  // --- settings -------------------------------------------------------------------------------

  protected setTitle(e: Event): void {
    const value = (e.target as HTMLInputElement).value;
    this.edit((p) => (p.title = value), 'title');
  }

  protected setSlug(e: Event): void {
    const input = e.target as HTMLInputElement;
    const slug = slugify(input.value);
    if (!slug) {
      this.slugError.set('URL cannot be empty.');
      return;
    }
    const error = this.site.changeSlug(this.id(), slug);
    this.slugError.set(error ?? '');
    if (!error) input.value = slug;
  }

  protected setSeo(key: 'metaTitle' | 'metaDescription', e: Event): void {
    const value = (e.target as HTMLInputElement).value;
    this.edit((p) => (p.seo[key] = value), `seo.${key}`);
  }

  protected togglePublish(): void {
    const p = this.page();
    if (!p) return;
    const next = p.status === 'published' ? 'draft' : 'published';
    this.site.setStatus(p.website, next);
    this.toast.show(next === 'published' ? 'Website published — all its pages are live' : 'Website unpublished');
  }

  protected exportPage(): void {
    const p = this.page();
    if (p) downloadFile(`${p.slug}.json`, this.store.exportJson(p.id), 'application/json');
  }

  protected async copyLink(): Promise<void> {
    const p = this.page();
    if (!p) return;
    try {
      await navigator.clipboard.writeText(`${location.origin}${this.site.pageUrl(p.website, p.slug)}`);
      this.toast.show('Link copied');
    } catch {
      this.toast.show('Could not copy the link', 'error');
    }
  }

  // --- history --------------------------------------------------------------------------------

  // Undo covers the whole website: this page, the theme, page tree and menus, and other
  // pages (e.g. links rewritten by a URL change).
  protected undo(): void {
    const p = this.page();
    if (p) this.announce(this.edits.undo(p.website), 'Undid');
  }

  protected redo(): void {
    const p = this.page();
    if (p) this.announce(this.edits.redo(p.website), 'Redid');
  }

  /** Says so when undo/redo changed something that isn't visible on this page. */
  private announce(step: HistoryTarget[] | null, verb: string): void {
    if (!step || step.some((t) => t.kind === 'website' || t.id === this.id())) return;
    const titles = [...new Set(step.map((t) => this.store.getById(t.id)?.title).filter(Boolean))];
    if (titles.length) this.toast.show(`${verb} a change on “${titles.join('”, “')}”`);
  }

  protected onKeydown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement;
    // Leave native undo alone while typing in a field or on the canvas.
    if (target.closest('input, textarea, select, [contenteditable]')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      e.shiftKey ? this.redo() : this.undo();
    } else if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      this.redo();
    } else if (e.key === 'Escape') {
      this.libraryOpen.set(false);
      // Step out one level: element → section → nothing.
      if (this.selectedEl()) this.backToSection();
      else this.clearSelection();
    }
  }
}
