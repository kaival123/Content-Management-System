import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, SecurityContext, computed, effect, inject, input, output, untracked } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { ComponentDef, RenderOptions, renderPageCss, renderSection } from '../core/engine/render';
import { loadFonts } from '../core/font-loader';
import { LeadStore } from '../core/lead-store';
import { LandingPage, Selection } from '../core/models';
import { MenuItem } from '../core/engine/render';
import { PageStore } from '../core/page-store';
import { ProjectService } from '../core/project.service';
import { CarouselController, siteRuntime } from '../core/site-runtime';

/** A same-origin path the router handles: not an external link, file or API/asset URL. */
function isAppPath(href: string): boolean {
  return /^\/(?!\/)/.test(href) && !/^\/(api|site)(\/|$)/.test(href) && !/\.[a-z0-9]{2,5}([?#]|$)/i.test(href);
}
import { SiteService } from '../core/site.service';
import { resolveTheme, themeVars } from '../core/styles';
import { uid } from '../core/util';
import { WebsiteStore } from '../core/website-store';

const IMAGE_PLACEHOLDER =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e0e7ff"/><stop offset="1" stop-color="#cffafe"/></linearGradient></defs><rect width="400" height="300" fill="url(#g)"/><path d="M150 190l40-50 30 35 20-22 40 37z" fill="#a5b4fc"/><circle cx="250" cy="110" r="16" fill="#a5b4fc"/></svg>',
  );

const runtime = siteRuntime();

interface Linking {
  menu: MenuItem[];
  homeHref: string;
  resolveLink: (slug: string, hash: string) => string;
}

export interface TextEdit {
  selection: Selection;
  /** Content field the edited text belongs to (from the element's data-edit attribute). */
  field: string;
  value: string;
}

/**
 * Renders a page from the project's component templates (site/components/) using
 * the template engine. Sections are patched individually, so editing one section
 * never re-renders the rest, and the section being typed into is left alone until
 * the user leaves it.
 *
 * Inputs `components`/`baseCss` override the project's (Developer Mode previews
 * unsaved component code with them). `interactive` false (thumbnails) skips
 * carousels and other behaviour.
 */
@Component({
  selector: 'app-page-renderer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
  host: {
    class: 'lp',
    '[class.lp-editable]': 'editable()',
    '[style]': 'themeVars()',
    '(click)': 'onClick($event)',
    '(input)': 'onInput($event)',
    '(keydown)': 'onKeydown($event)',
    '(submit)': 'onSubmit($event)',
    '(focusout)': 'onFocusOut()',
  },
})
export class PageRenderer {
  readonly page = input.required<LandingPage>();
  /** Editor mode: everything is selectable, text is editable in place and links don't navigate. */
  readonly editable = input(false);
  readonly interactive = input(true);
  readonly selection = input<Selection | null>(null);
  readonly components = input<ComponentDef[] | null>(null);
  readonly baseCss = input<string | null>(null);
  readonly selectionChange = output<Selection>();
  readonly textEdit = output<TextEdit>();

  private readonly project = inject(ProjectService);
  private readonly site = inject(SiteService);
  private readonly websites = inject(WebsiteStore);
  private readonly pageStore = inject(PageStore);
  private readonly router = inject(Router);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly leads = inject(LeadStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  private readonly scope = uid('r');
  private readonly styleEl = document.createElement('style');
  private readonly root = document.createElement('div');
  /** Rendered HTML per section id, to skip unchanged sections. */
  private readonly rendered = new Map<string, { html: string; el: HTMLElement }>();
  /** Running carousels per section, and the slide each was on (kept across re-renders). */
  private readonly carousels = new Map<string, CarouselController[]>();
  private readonly carouselIndex = new Map<string, number>();
  /** Set when a section changed while the user was typing in it; re-rendered on blur. */
  private deferred = false;

  protected readonly themeVars = computed(() => themeVars(this.page().theme));
  private readonly componentList = computed(() => this.components() ?? this.project.components());
  private readonly componentMap = computed(() => new Map(this.componentList().map((c) => [c.type, c])));
  private readonly website = computed(() => this.websites.get(this.page().website));
  /** Site navigation and page links for the templates. */
  private readonly linking = computed<Linking>(() => {
    const page = this.page();
    this.website(); // page tree / homepage changes
    const href = (slug: string) => this.site.pageUrl(page.website, slug);
    return {
      menu: this.site.menu(page.website, page.slug, href),
      homeHref: this.site.pageUrl(page.website, this.website()?.homepage ?? page.slug),
      resolveLink: (slug: string, hash: string) => (this.pageStore.getBySlug(page.website, slug) ? href(slug) + hash : '#'),
    };
  });

  constructor() {
    this.host.setAttribute('data-lp', this.scope);
    this.root.className = 'lp-root';
    this.host.append(this.styleEl, this.root);
    runtime.initNav(this.host);
    // Back to top buttons only exist in the live (non-editor) markup, so this is a no-op in the editor.
    const stopBackToTop = runtime.initBackToTop(this.host);
    // FAQ answers open and close smoothly (editor markup has no data-accordion: always open).
    runtime.initAccordions(this.host);

    effect(() => {
      const t = resolveTheme(this.page().theme);
      loadFonts(t.fontFamily, t.headingFont);
    });

    effect(() => {
      this.styleEl.textContent = renderPageCss(
        this.page(),
        this.baseCss() ?? this.project.baseCss(),
        this.componentList(),
        `[data-lp="${this.scope}"]`,
        this.website()?.customCss ?? '',
      );
    });

    effect(() => {
      // Track inputs explicitly; the DOM work itself shouldn't create dependencies.
      const page = this.page();
      const components = this.componentMap();
      const editable = this.editable();
      const linking = this.linking();
      untracked(() => this.patch(page, components, editable, linking));
    });

    effect(() => {
      const sel = this.selection();
      untracked(() => this.applySelection(sel));
    });

    // Replace broken images with a placeholder (error events don't bubble, so capture them).
    this.host.addEventListener(
      'error',
      (e) => {
        const img = e.target as HTMLImageElement;
        if (img.tagName === 'IMG' && img.src !== IMAGE_PLACEHOLDER) img.src = IMAGE_PLACEHOLDER;
      },
      true,
    );

    this.setUpAnimations();
    inject(DestroyRef).onDestroy(() => {
      for (const list of this.carousels.values()) list.forEach((c) => c.destroy());
      stopBackToTop();
    });
  }

  // --- rendering ------------------------------------------------------------------------------

  private patch(page: LandingPage, components: Map<string, ComponentDef>, editable: boolean, linking: Linking): void {
    const opts: RenderOptions = {
      editor: editable,
      assetBase: '/site/',
      sanitizeHtml: (html: string) => this.sanitizer.sanitize(SecurityContext.HTML, html) ?? '',
      resolveLink: linking.resolveLink,
      vars: { menu: linking.menu, homeHref: linking.homeHref },
    };
    const typingIn = (document.activeElement as HTMLElement | null)?.closest?.('[data-section-id]');
    const visible = page.sections.filter((s) => s.visible);
    const keep = new Set<string>();
    let previous: Element | null = null;

    for (const section of visible) {
      keep.add(section.id);
      const html = renderSection(section, components.get(section.type), opts);
      let entry = this.rendered.get(section.id);
      if (!entry || entry.html !== html) {
        if (entry && typingIn === entry.el && this.root.contains(entry.el)) {
          // Don't replace the section under the caret; its text already shows what was typed.
          this.deferred = true;
        } else {
          const tpl = document.createElement('template');
          tpl.innerHTML = html;
          const el = tpl.content.firstElementChild as HTMLElement;
          if (entry) {
            this.stopCarousels(section.id);
            entry.el.replaceWith(el);
          }
          entry = { html, el };
          this.rendered.set(section.id, entry);
        }
      }
      // Keep DOM order in sync with section order.
      const expectedNext: Element | null = previous ? previous.nextElementSibling : this.root.firstElementChild;
      if (expectedNext !== entry.el) {
        if (previous) previous.after(entry.el);
        else this.root.prepend(entry.el);
      }
      previous = entry.el;
    }

    for (const [id, entry] of this.rendered) {
      if (!keep.has(id)) {
        this.stopCarousels(id);
        entry.el.remove();
        this.rendered.delete(id);
      }
    }
    this.root.querySelector(':scope > .lp-empty')?.remove();
    if (!visible.length) {
      this.root.insertAdjacentHTML(
        'beforeend',
        editable
          ? '<div class="lp-empty lp-empty-canvas"><strong>This page is empty</strong><span>Use <b>Add section</b> to insert a hero, carousel, pricing table or any other section from the library.</span></div>'
          : '<div class="lp-empty">This page has no visible sections yet.</div>',
      );
    }

    if (this.interactive()) this.startCarousels();
    this.applySelection(this.selection());
    if (!editable && this.interactive()) this.observeAnimations();
    // Sections were re-rendered: show/hide back to top buttons for the current scroll position.
    if (!editable) window.dispatchEvent(new Event('scroll'));
  }

  private startCarousels(): void {
    for (const [id, entry] of this.rendered) {
      if (this.carousels.has(id) || !entry.el.querySelector('[data-carousel]')) continue;
      const started = runtime.initCarousels(entry.el, { editor: this.editable(), startIndex: () => this.carouselIndex.get(id) ?? 0 });
      this.carousels.set(id, [...started.values()]);
    }
  }

  private stopCarousels(sectionId: string): void {
    const list = this.carousels.get(sectionId);
    if (!list) return;
    if (list[0]) this.carouselIndex.set(sectionId, list[0].index());
    list.forEach((c) => c.destroy());
    this.carousels.delete(sectionId);
  }

  private applySelection(sel: Selection | null): void {
    if (!this.editable()) return;
    for (const el of this.root.querySelectorAll('.lp-selected, .lp-el-selected, .lp-el-related')) {
      el.classList.remove('lp-selected', 'lp-el-selected', 'lp-el-related');
    }
    if (!sel) return;
    const section = this.root.querySelector(`[data-section-id="${CSS.escape(sel.sectionId)}"]`);
    if (!section) return;
    if (!sel.el) {
      section.classList.add('lp-selected');
      return;
    }
    for (const el of section.querySelectorAll(`[data-el="${CSS.escape(sel.el)}"]`)) {
      const index = el.getAttribute('data-index');
      const exact = sel.index === null || index === null || Number(index) === sel.index;
      el.classList.add(exact ? 'lp-el-selected' : 'lp-el-related');
    }
    // Bring the selected slide into view when an item of a carousel is chosen in the panel.
    if (sel.index !== null && section.querySelector(`.lp-carousel [data-el="${CSS.escape(sel.el)}"]`)) {
      this.carousels.get(sel.sectionId)?.[0]?.goTo(sel.index);
    }
  }

  // --- interaction ------------------------------------------------------------------------------

  private selectionFor(target: Element): Selection | null {
    const section = target.closest<HTMLElement>('[data-section-id]');
    if (!section) return null;
    const el = target.closest<HTMLElement>('[data-el]');
    const inSection = el && section.contains(el);
    return {
      sectionId: section.dataset['sectionId']!,
      el: inSection ? el!.dataset['el']! : null,
      index: inSection && el!.dataset['index'] !== undefined ? Number(el!.dataset['index']) : null,
    };
  }

  protected onClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    // Carousel controls and the menu toggle work everywhere, including the editor.
    if (target.closest('.lp-car-arrow, .lp-car-dot, .lp-nav-toggle')) return;
    const anchor = target.closest('a');
    if (this.editable()) {
      // Links and buttons must not navigate inside the editor. (The caret is placed on
      // mousedown, so this doesn't interfere with editing text.)
      if (anchor || target.closest('button')) event.preventDefault();
      const sel = this.selectionFor(target);
      if (sel) {
        event.stopPropagation();
        this.selectionChange.emit(sel);
      }
      return;
    }
    const href = anchor?.getAttribute('href') ?? '';
    // Links to other pages of the website (/<site>/…) stay inside the app.
    if (isAppPath(href) && !event.ctrlKey && !event.metaKey && anchor?.target !== '_blank') {
      event.preventDefault();
      // Previewing a draft: stay in preview mode on the next page (drafts 404 without it).
      const target = new URL(href, location.origin);
      if (new URLSearchParams(location.search).has('preview') && !target.searchParams.has('preview')) target.searchParams.set('preview', '1');
      void this.router.navigateByUrl(target.pathname + target.search + target.hash);
      return;
    }
    // With <base href="/"> a plain "#id" link would navigate to the site root instead of scrolling.
    if (href.startsWith('#')) {
      event.preventDefault();
      if (href.length > 1) this.host.querySelector(`[id="${CSS.escape(href.slice(1))}"]`)?.scrollIntoView({ behavior: 'smooth' });
      else window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  protected onInput(event: Event): void {
    const el = (event.target as HTMLElement).closest<HTMLElement>('[data-edit]');
    if (!this.editable() || !el) return;
    const selection = this.selectionFor(el);
    if (!selection?.el) return;
    this.textEdit.emit({ selection, field: el.dataset['edit']!, value: el.innerText.replace(/\n$/, '') });
  }

  protected onKeydown(event: KeyboardEvent): void {
    const el = (event.target as HTMLElement).closest<HTMLElement>('[data-edit]');
    if (!this.editable() || !el) return;
    if (event.key === 'Escape') {
      el.blur();
      return;
    }
    // Single-line elements (buttons, labels) don't take line breaks.
    if (event.key === 'Enter' && !getComputedStyle(el).whiteSpace.startsWith('pre')) {
      event.preventDefault();
      el.blur();
    }
  }

  protected onFocusOut(): void {
    if (!this.deferred) return;
    this.deferred = false;
    // Let focus settle, then bring the section we skipped up to date.
    setTimeout(() => this.patch(this.page(), this.componentMap(), this.editable(), this.linking()));
  }

  protected onSubmit(event: Event): void {
    const form = event.target as HTMLFormElement;
    // Forms never submit from the editor.
    if (this.editable()) {
      event.preventDefault();
      return;
    }
    if (form.dataset['form'] !== 'contact') {
      // Forms without a real endpoint (e.g. a login layout not wired up yet) do nothing.
      if (!form.getAttribute('action')) event.preventDefault();
      return;
    }
    event.preventDefault();
    const data = new FormData(form);
    this.leads.add({
      pageId: this.page().id,
      pageTitle: this.page().title,
      name: String(data.get('name') ?? ''),
      email: String(data.get('email') ?? ''),
      message: String(data.get('message') ?? ''),
    });
    form.reset();
    form.querySelector('.lp-success')?.remove();
    const msg = document.createElement('p');
    msg.className = 'lp-success';
    msg.textContent = form.dataset['success'] || 'Thanks!';
    form.prepend(msg);
  }

  // --- animations -------------------------------------------------------------------------------

  private observer: IntersectionObserver | null = null;

  private setUpAnimations(): void {
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('lp-in');
            this.observer?.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.15 },
    );
    inject(DestroyRef).onDestroy(() => this.observer?.disconnect());
  }

  private observeAnimations(): void {
    this.root.querySelectorAll('.lp-anim:not(.lp-in)').forEach((el) => this.observer?.observe(el));
  }
}
