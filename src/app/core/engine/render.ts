import { layoutFractions, videoEmbedUrl } from '../builder';
import { CustomSectionData, ElementStyle, LandingPage, Section, SectionDef } from '../models';
import { resolveCarousel, resolveGrid } from '../section-registry';
import { elementCss, pageCustomCss, resolveColor, sectionCss } from '../styles';
import { Attrs, CompiledTemplate, Helper, TemplateError, compile, decodeEntities, escapeHtml, isUnsafeUrl, rewriteTags } from './template';

/** A section component loaded from site/components/<Name>/. */
export interface ComponentDef extends SectionDef {
  /** Folder name, e.g. "Hero". */
  folder: string;
  template: string;
  css: string;
}

export interface RenderOptions {
  /** Visual-editor mode: adds editing hooks and keeps hidden elements visible (faded). */
  editor: boolean;
  /** Prefix for project-relative asset paths such as "assets/images/x.jpg". */
  assetBase: string;
  sanitizeHtml: (html: string) => string;
  /** Static export: drop editor-only attributes (data-el, data-edit, …) from the output. */
  clean?: boolean;
  /**
   * Turns a link to another page of the website ("page:about", "page:about#team") into
   * a URL. Unknown pages resolve to "#".
   */
  resolveLink?: (slug: string, hash: string) => string;
  /** Variables for templates, available as @name: menu (site navigation), homeHref… */
  vars?: Record<string, unknown>;
}

/** An entry of the site navigation (@menu in templates). */
export interface MenuItem {
  label: string;
  href: string;
  active: boolean;
  children: MenuItem[];
}

export const HELPERS: Record<string, Helper> = {
  /** Theme token or colour → CSS colour ('' when unset). */
  color: (v: string) => resolveColor(v) ?? '',
  default: (v: unknown, fallback: unknown) => (v === undefined || v === null || v === '' ? fallback : v),
  initials: (name: string) =>
    String(name || '?')
      .split(/\s+/)
      .map((w) => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase(),
  json: (v: unknown) => JSON.stringify(v ?? null),
  /** CSS string for a list bullet symbol. */
  marker: (v: string) => JSON.stringify(v || '✓'),
  /** Embeddable YouTube/Vimeo player URL, or '' for anything else. */
  video: (url: string) => videoEmbedUrl(url) ?? '',
  /** Google Maps embed URL for an address / place name (no API key needed), or '' when empty. */
  mapUrl: (query: string) => {
    const q = String(query ?? '').replace(/\s+/g, ' ').trim();
    return q ? `https://www.google.com/maps?q=${encodeURIComponent(q)}&output=embed` : '';
  },
  /**
   * Embed URL for one map: a pasted Google My Maps / "Share → Embed a map" link or <iframe> code
   * (that is how one map can show several pins), otherwise a plain address. Only google.com/maps URLs are accepted.
   */
  mapSrc: (embed: string, query: string) => {
    const raw = String(embed ?? '');
    const url = (/src\s*=\s*["']([^"']+)["']/i.exec(raw)?.[1] ?? raw).trim().replace(/&amp;/g, '&');
    if (/^https:\/\/(www\.)?google\.com\/maps\//i.test(url)) return url;
    const q = String(query ?? '').replace(/\s+/g, ' ').trim();
    return q ? `https://www.google.com/maps?q=${encodeURIComponent(q)}&output=embed` : '';
  },
  /** Google Maps directions link for an address / place name. */
  mapDirections: (query: string) => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(String(query ?? '').trim())}`,
  /** grid-template-columns for a column layout such as "2-1". */
  columns: (layout: string) =>
    layoutFractions(layout || '1')
      .map((f) => `minmax(0, ${f}fr)`)
      .join(' '),
  /** Safe heading tag name. */
  tag: (level: string, fallback = 'h2') => (/^h[1-6]$/.test(level) ? level : fallback),
  eq: (a: unknown, b: unknown) => String(a) === String(b),
  join: (list: unknown[], sep = ', ') => (Array.isArray(list) ? list.join(sep) : ''),
};

const compiled = new WeakMap<ComponentDef, { src: string; tpl: CompiledTemplate }>();

function templateFor(def: ComponentDef): CompiledTemplate {
  const cached = compiled.get(def);
  if (cached && cached.src === def.template) return cached.tpl;
  const tpl = compile(def.template);
  compiled.set(def, { src: def.template, tpl });
  return tpl;
}

/** Validates a template without rendering it; returns the error or null. */
export function checkTemplate(src: string): TemplateError | null {
  try {
    compile(src);
    return null;
  } catch (e) {
    return e instanceof TemplateError ? e : new TemplateError(String(e), 1);
  }
}

function styleString(style: Record<string, string | number | null | undefined>): string {
  return Object.entries(style)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${v}`)
    .join('; ');
}

function elementStyleFor(section: Section, key: string): ElementStyle | undefined {
  if (key.startsWith('el:') || key.startsWith('col:')) {
    const data = section.data as CustomSectionData;
    const id = key.slice(key.indexOf(':') + 1);
    for (const col of data.columns ?? []) {
      if (key.startsWith('col:') && col.id === id) return col.style;
      const el = col.elements.find((e) => e.id === id);
      if (el) return el.style;
    }
    return undefined;
  }
  return section.elements?.[key];
}

/** Carousel easing curves; 'default' leaves each transition's own curve in place. */
const CAROUSEL_EASING: Record<string, string | undefined> = {
  default: undefined,
  smooth: 'cubic-bezier(0.22, 1, 0.36, 1)',
  gentle: 'cubic-bezier(0.45, 0, 0.55, 1)',
  snappy: 'cubic-bezier(0.7, 0, 0.2, 1)',
  bounce: 'cubic-bezier(0.34, 1.4, 0.64, 1)',
  linear: 'linear',
};

function resolveAsset(url: string, base: string): string {
  return url.startsWith('assets/') ? base + url : url;
}

const URL_ATTRS = ['href', 'src', 'action', 'formaction', 'poster'];

/** Adds element styles, editing hooks, grid variables and URL safety to rendered component markup. */
function enhance(html: string, section: Section, opts: RenderOptions): string {
  return rewriteTags(html, (tag, attrs: Attrs) => {
    let changed = false;

    for (const name of URL_ATTRS) {
      const v = attrs.get(name);
      if (v === undefined || v === null) continue;
      if (isUnsafeUrl(v, name === 'src' || name === 'poster')) {
        attrs.set(name, name === 'href' ? '#' : '');
        changed = true;
      } else if (v.startsWith('assets/')) {
        attrs.set(name, escapeHtml(opts.assetBase) + v);
        changed = true;
      } else if (name === 'href' && v.startsWith('page:')) {
        const [slug, hash = ''] = decodeEntities(v.slice(5)).split('#');
        attrs.set(name, escapeHtml(opts.resolveLink?.(slug, hash ? `#${hash}` : '') ?? '#'));
        changed = true;
      }
    }
    // Background images set in templates: style="background-image: url('assets/…')".
    const inlineStyle = attrs.get('style');
    if (inlineStyle && inlineStyle.includes('assets/')) {
      attrs.set('style', inlineStyle.replace(/url\((&#39;|&quot;|'|")?assets\//g, (_m, q = '') => `url(${q}${escapeHtml(opts.assetBase)}assets/`));
      changed = true;
    }
    // Inline event handlers never come from content, but strip any a template might contain.
    for (const name of [...attrs.keys()]) {
      if (name.startsWith('on')) {
        attrs.delete(name);
        changed = true;
      }
    }

    if (attrs.has('data-grid')) {
      const g = resolveGrid(section);
      const style = styleString({
        '--cols-d': g.desktop,
        '--cols-t': g.tablet,
        '--cols-m': g.mobile,
        '--gap': `${g.gap}px`,
        '--row': `${g.rowHeight}px`,
        'align-items': g.itemAlign,
      });
      attrs.set('class', `${attrs.get('class') ?? ''} lp-cards-${g.cardStyle} lp-text-${g.textAlign}`.trim());
      attrs.set('style', escapeHtml(style) + (attrs.get('style') ? `; ${attrs.get('style')}` : ''));
      attrs.delete('data-grid');
      changed = true;
    }

    if (attrs.has('data-carousel')) {
      const c = resolveCarousel(section);
      const style = styleString({
        '--per-d': c.perViewDesktop,
        '--per-t': c.perViewTablet,
        '--per-m': c.perViewMobile,
        '--gap': `${c.gap}px`,
        '--car-speed': `${c.speed}ms`,
        '--car-ease': CAROUSEL_EASING[c.easing],
        '--car-fallback': `url(${opts.assetBase}${DEFAULT_SLIDE_IMAGE})`,
        // Sprite sheets of the ink-splash mask transition.
        '--car-ink-a': c.transition === 'mask-ink' || c.transition === 'auto' ? `url(${opts.assetBase}assets/masks/nature-sprite.png)` : undefined,
        '--car-ink-b': c.transition === 'mask-ink' || c.transition === 'auto' ? `url(${opts.assetBase}assets/masks/nature-sprite-2.png)` : undefined,
        '--car-arrow': `${c.arrowSize}px`,
        '--car-prev-x': c.prevX ? `${c.prevX}px` : undefined,
        '--car-prev-y': c.prevY ? `${c.prevY}px` : undefined,
        '--car-next-x': c.nextX ? `${c.nextX}px` : undefined,
        '--car-next-y': c.nextY ? `${c.nextY}px` : undefined,
        '--car-cx': c.contentMoveX ? `${c.contentMoveX}px` : undefined,
        '--car-cy': c.contentMoveY ? `${c.contentMoveY}px` : undefined,
        '--car-radius': c.radius != null ? `${c.radius}px` : undefined,
        '--car-ctrl': resolveColor(c.controlColor) ?? undefined,
        '--car-pag-bg': resolveColor(c.paginationBg) ?? undefined,
        '--car-pag-fg': resolveColor(c.paginationFg) ?? undefined,
      });
      // Slider height: per-device values; component.css picks one by container width into
      // --car-h. Set after the template's own style so it wins over its --slide-h.
      const fixedH = c.heightMode === 'fixed' || c.heightMode === 'screen';
      const unit = c.heightMode === 'screen' ? 'vh' : 'px';
      const heightStyle = fixedH
        ? styleString({
            '--car-h-d': `${c.heightMode === 'screen' ? c.screenDesktop : c.heightDesktop}${unit}`,
            '--car-h-t': `${c.heightMode === 'screen' ? c.screenTablet : c.heightTablet}${unit}`,
            '--car-h-m': `${c.heightMode === 'screen' ? c.screenMobile : c.heightMobile}${unit}`,
            '--slide-h': 'var(--car-h)',
          })
        : '';
      attrs.set('style', escapeHtml(style) + (attrs.get('style') ? `; ${attrs.get('style')}` : '') + (heightStyle ? `; ${escapeHtml(heightStyle)}` : ''));
      attrs.set('data-carousel', escapeHtml(JSON.stringify(c)));
      attrs.set('data-car-fallback', escapeHtml(opts.assetBase + DEFAULT_SLIDE_IMAGE));
      // Layout of the controls, so CSS can reserve space for them before the runtime adds them.
      const layout = [`lp-car-arrows-${c.arrowPosition}`, `lp-car-arrow-${c.arrowStyle}`, `lp-car-dots-${c.dotsPosition}`, `lp-car-dotstyle-${c.dotsStyle}`];
      // Fade and flip both stack the slides; flip adds the 3D turn.
      if (c.transition !== 'slide') layout.push('lp-car-fade');
      if (c.transition === 'flip') layout.push('lp-car-flipfx');
      // "auto" starts without an effect class; the runtime picks one for every change.
      if (c.transition.startsWith('mask-')) layout.push('lp-car-maskfx', `lp-car-${c.transition}`);
      if (c.transition === 'auto') layout.push('lp-car-maskfx');
      if (c.contentX) layout.push(`lp-car-x-${c.contentX}`);
      if (c.contentY) layout.push(`lp-car-y-${c.contentY}`);
      if (c.flipLayout) layout.push('lp-car-flip');
      if (c.mirrorImages) layout.push('lp-car-mirror');
      if (c.radius != null) layout.push('lp-car-rad');
      if ((c.contentMoveX || c.contentMoveY) && !c.contentMovePhones) layout.push('lp-car-cmove-desk');
      if (fixedH) layout.push('lp-car-fixed-h');
      attrs.set('class', `${attrs.get('class') ?? ''} ${layout.join(' ')}`.trim());
      changed = true;
    }

    const key = attrs.get('data-el');
    if (key) {
      const { style, classes } = elementCss(elementStyleFor(section, key));
      let cls = classes;
      if (opts.editor) cls = cls.replace('lp-el-hidden', 'lp-el-ghost');
      if (cls) attrs.set('class', `${attrs.get('class') ?? ''} ${cls}`.trim());
      const own = styleString(style);
      // The template's own style (per-item values) wins over element-wide overrides.
      if (own) attrs.set('style', escapeHtml(own) + (attrs.get('style') ? `; ${attrs.get('style')}` : ''));
      changed = true;
    }

    if (opts.clean) {
      for (const name of ['data-el', 'data-index', 'data-edit', 'data-ph']) {
        if (attrs.delete(name)) changed = true;
      }
    }

    if (opts.editor && attrs.has('data-edit')) {
      attrs.set('contenteditable', 'plaintext-only');
      attrs.set('spellcheck', 'false');
      changed = true;
    }
    return changed;
  });
}

/** Picture for carousel slides that have none (also the fallback when a slide's image can't load). */
const DEFAULT_SLIDE_IMAGE = 'assets/images/slide-default.jpg';

/** Carousel slide layouts that show a picture. */
const IMAGE_VARIANTS = new Set(['hero', 'image', 'card', 'product', 'team', 'portfolio']);

/** Image sections: the list holding the items (none: the section itself) and the field with the picture. */
const IMAGE_FIELDS: Record<string, { list?: string; field: string }> = {
  gallery: { list: 'images', field: 'image' },
  products: { list: 'products', field: 'image' },
  team: { list: 'members', field: 'photo' },
  blog: { list: 'posts', field: 'image' },
  about: { field: 'image' },
};

/** Fills the image field of an item that has none. */
function fillImage<T extends Record<string, unknown>>(item: T, field: string): T {
  return item?.[field] ? item : { ...item, [field]: DEFAULT_SLIDE_IMAGE };
}

/**
 * Image sections (carousel, gallery, products, team, blog, image + text) show the default picture
 * wherever an image is left blank, so a new or empty section never looks broken.
 */
function withSampleImages(section: Section): Record<string, unknown> {
  const data = section.data;
  if (section.type === 'carousel') {
    if (!IMAGE_VARIANTS.has(String(data.variant || 'card')) || !Array.isArray(data.slides)) return data;
    return { ...data, slides: data.slides.map((s: Record<string, unknown>) => fillImage(s, 'image')) };
  }
  const spec = IMAGE_FIELDS[section.type];
  if (!spec) return data;
  if (!spec.list) return fillImage(data, spec.field);
  const items = data[spec.list];
  if (!Array.isArray(items)) return data;
  return { ...data, [spec.list]: items.map((it: Record<string, unknown>) => fillImage(it, spec.field)) };
}

/** Renders one section, including its <section> wrapper. */
export function renderSection(section: Section, def: ComponentDef | undefined, opts: RenderOptions): string {
  let body: string;
  if (!def) {
    body = `<div class="lp-missing">Missing component “${escapeHtml(section.type)}”. Add it in site/components/ or remove this section.</div>`;
  } else {
    try {
      const html = templateFor(def).render(withSampleImages(section), { helpers: HELPERS, vars: { menu: [], homeHref: '#', ...opts.vars, editor: opts.editor }, sanitizeHtml: opts.sanitizeHtml });
      body = enhance(html, section, opts);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      body = `<div class="lp-missing">Error in ${escapeHtml(def.folder)}/component.html: ${escapeHtml(msg)}</div>`;
    }
  }

  const styleSource = section.style.backgroundImage?.startsWith('assets/')
    ? { ...section, style: { ...section.style, backgroundImage: resolveAsset(section.style.backgroundImage, opts.assetBase) } }
    : section;
  const css = sectionCss(styleSource);
  const classes = ['lp-section', `lp-sec-${section.type}`, css.classes, section.style.align === 'left' ? 'lp-left' : '', section.data?.sticky ? 'lp-sticky' : '']
    .filter(Boolean)
    .join(' ');
  const anchor = section.data?.anchor ? ` id="${escapeHtml(section.data.anchor)}"` : '';
  const tag = opts.editor ? `<span class="lp-section-tag">${escapeHtml(def?.label ?? section.type)}</span>` : '';
  return (
    `<section class="${escapeHtml(classes)}" data-section-id="${escapeHtml(section.id)}" data-img-fallback="${escapeHtml(opts.assetBase + DEFAULT_SLIDE_IMAGE)}"${anchor} style="${escapeHtml(styleString(css.style))}">` +
    `${tag}<div class="lp-container">${body}</div></section>`
  );
}

/** All CSS a page needs: base styles, every component's CSS, then page/section custom CSS scoped to `scope`. */
export function renderPageCss(page: LandingPage, baseCss: string, components: ComponentDef[], scope: string, siteCss = ''): string {
  const parts = [`/* base.css */\n${baseCss}`];
  for (const c of components) if (c.css.trim()) parts.push(`/* components/${c.folder}/component.css */\n${c.css}`);
  const custom = pageCustomCss(page, scope, siteCss);
  if (custom) parts.push(`/* custom */\n${custom}`);
  return parts.join('\n\n');
}
