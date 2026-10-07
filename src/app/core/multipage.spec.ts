import { readFileSync, readdirSync } from 'node:fs';
import { UrlSegment } from '@angular/router';
import { legacyPublicMatcher, publicPageMatcher } from '../app.routes';
import { isReservedSlug } from './util';
import { join } from 'node:path';
import { renderSection } from './engine/render';
import { PageNode } from './models';
import { resolveCarousel } from './section-registry';
import { siteRuntime } from './site-runtime';
import { SiteService } from './site.service';
import { findByPath, flatten, insertNode, movePage, pathOf, removeNode, updateNode } from './site-tree';
import { loadSiteComponents } from './site.test-helpers';
import { LibraryItem, PageTemplate, instantiateSection, templatePages } from './templates';

const SITE = join(process.cwd(), 'site');
const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const opts = { editor: false, assetBase: '/site/', sanitizeHtml: (h: string) => h, resolveLink: (slug: string) => `/p/x/${slug}` };

describe('page tree', () => {
  const tree: PageNode[] = [{ slug: 'home' }, { slug: 'services', children: [{ slug: 'design' }, { slug: 'dev' }] }, { slug: 'contact' }];

  it('finds paths and pages by path', () => {
    expect(pathOf(tree, 'dev')).toEqual(['services', 'dev']);
    expect(pathOf(tree, 'nope')).toBeNull();
    expect(findByPath(tree, ['services', 'design'])?.slug).toBe('design');
    expect(flatten(tree).map((n) => n.slug)).toEqual(['home', 'services', 'design', 'dev', 'contact']);
  });

  it('moves, nests and un-nests pages', () => {
    expect(movePage(tree, 'contact', 'up').map((n) => n.slug)).toEqual(['home', 'contact', 'services']);
    const nested = movePage(tree, 'contact', 'indent');
    expect(pathOf(nested, 'contact')).toEqual(['services', 'contact']);
    const back = movePage(nested, 'contact', 'outdent');
    expect(back.map((n) => n.slug)).toEqual(['home', 'services', 'contact']);
    expect(movePage(tree, 'home', 'indent')).toBe(tree); // nothing above it
  });

  it('inserts, updates and removes pages with their sub-pages', () => {
    const added = insertNode(tree, { slug: 'about' }, { after: 'home' });
    expect(added.map((n) => n.slug)).toEqual(['home', 'about', 'services', 'contact']);
    expect(pathOf(insertNode(tree, { slug: 'seo' }, { parent: 'services' }), 'seo')).toEqual(['services', 'seo']);
    expect(updateNode(tree, 'dev', { slug: 'development' }).length).toBe(3);
    const [without, removed] = removeNode(tree, 'services');
    expect(without.map((n) => n.slug)).toEqual(['home', 'contact']);
    expect(flatten([removed!]).length).toBe(3);
  });

  it('builds relative links for the static build', () => {
    expect(SiteService.relativeLink([], ['about'])).toBe('about/');
    expect(SiteService.relativeLink(['services', 'dev'], [])).toBe('../../');
    expect(SiteService.relativeLink(['about'], ['services', 'dev'], '#team')).toBe('../services/dev/#team');
    expect(SiteService.relativeLink([], [])).toBe('./');
  });
});

describe('carousel', () => {
  const components = loadSiteComponents();
  const carousel = components.find((c) => c.type === 'carousel')!;

  it('passes settings to the runtime and CSS', () => {
    const section = instantiateSection({ type: 'carousel', carousel: { perViewDesktop: 4, perViewTablet: 2, perViewMobile: 1, transition: 'fade' } });
    const html = renderSection(section, carousel, opts);
    expect(html).toContain('--per-d: 4');
    expect(html).toContain('lp-car-fade');
    const config = JSON.parse(/data-carousel="([^"]+)"/.exec(html)![1].replace(/&quot;/g, '"'));
    expect(config).toEqual(resolveCarousel(section));
  });

  it('passes content position, flip and the flip transition to CSS', () => {
    const plain = renderSection(instantiateSection({ type: 'carousel' }), carousel, opts);
    expect(plain).not.toMatch(/lp-car-(x|y)-|lp-car-flip|lp-car-mirror/);
    const html = renderSection(
      instantiateSection({ type: 'carousel', carousel: { contentX: 'right', contentY: 'bottom', flipLayout: true, mirrorImages: true, transition: 'flip' } }),
      carousel,
      opts,
    );
    for (const cls of ['lp-car-x-right', 'lp-car-y-bottom', 'lp-car-flip', 'lp-car-mirror', 'lp-car-fade', 'lp-car-flipfx']) expect(html).toContain(cls);
  });

  it('moves the slide content, on phones only when asked', () => {
    const html = renderSection(instantiateSection({ type: 'carousel', carousel: { contentMoveX: 30, contentMoveY: -12 } }), carousel, opts);
    expect(html).toContain('--car-cx: 30px; --car-cy: -12px');
    expect(html).toContain('lp-car-cmove-desk');
    const phones = renderSection(instantiateSection({ type: 'carousel', carousel: { contentMoveX: 30, contentMovePhones: true } }), carousel, opts);
    expect(phones).not.toContain('lp-car-cmove-desk');
  });

  it('sets a per-device slider height', () => {
    const auto = renderSection(instantiateSection({ type: 'carousel' }), carousel, opts);
    expect(auto).not.toContain('lp-car-fixed-h');
    const fixed = renderSection(instantiateSection({ type: 'carousel', carousel: { heightMode: 'fixed', heightDesktop: 600, heightTablet: 400, heightMobile: 300 } }), carousel, opts);
    expect(fixed).toContain('lp-car-fixed-h');
    expect(fixed).toMatch(/--car-h-d: 600px; --car-h-t: 400px; --car-h-m: 300px; --slide-h: var\(--car-h\)/);
    const screen = renderSection(instantiateSection({ type: 'carousel', carousel: { heightMode: 'screen', screenDesktop: 100 } }), carousel, opts);
    expect(screen).toContain('--car-h-d: 100vh');
  });

  it('ships a self-contained runtime (the static build embeds its source)', () => {
    const rt = new Function(`return (${siteRuntime.toString()})()`)();
    expect(Object.keys(rt).sort()).toEqual(['initAccordions', 'initAnimations', 'initBackToTop', 'initCarousel', 'initCarousels', 'initForms', 'initImageFallback', 'initNav']);
  });
});

describe('site content', () => {
  const components = loadSiteComponents();
  const byType = new Map(components.map((c) => [c.type, c]));
  const templates: PageTemplate[] = readdirSync(join(SITE, 'templates'))
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJson(join(SITE, 'templates', f)));
  const library: LibraryItem[] = readdirSync(join(SITE, 'library')).flatMap((cat) =>
    readdirSync(join(SITE, 'library', cat))
      .filter((f) => f.endsWith('.json'))
      .map((f) => ({ ...readJson(join(SITE, 'library', cat, f)), id: `${cat}/${f}`, category: cat, file: '' })),
  );

  it('has single, multi-page and blank templates', () => {
    const kinds = new Set(templates.map((t) => t.kind));
    expect(kinds).toEqual(new Set(['single', 'multi']));
    expect(templates.find((t) => t.id === 'blank')?.pages[0].sections).toEqual([]);
    expect(templates.find((t) => t.id === 'blank-multi')?.kind).toBe('multi');
  });

  it.each(templates.map((t) => [t.id, t] as const))('template %s renders every page and links only to its own pages', (_id, t) => {
    const slugs = new Set(templatePages(t).map((p) => p.slug));
    expect(slugs.size).toBe(templatePages(t).length);
    for (const page of templatePages(t)) {
      for (const preset of page.sections) {
        expect(byType.has(preset.type), `${page.slug}: unknown component ${preset.type}`).toBe(true);
        const html = renderSection(instantiateSection(preset), byType.get(preset.type), opts);
        expect(html, `${page.slug}/${preset.type}`).not.toContain('lp-missing');
      }
      for (const [, slug] of JSON.stringify(page.sections).matchAll(/"page:([a-z0-9-]+)/g)) {
        expect(slugs.has(slug), `${page.slug} links to unknown page ${slug}`).toBe(true);
      }
    }
  });

  it.each(library.map((item) => [item.id, item] as const))('library preset %s renders', (_id, item) => {
    expect(item.name).toBeTruthy();
    expect(byType.has(item.section.type)).toBe(true);
    const html = renderSection(instantiateSection(item.section), byType.get(item.section.type), opts);
    expect(html).not.toContain('lp-missing');
  });
});

describe('clean public URLs', () => {
  const seg = (...parts: string[]) => parts.map((p) => new UrlSegment(p, {}));

  it('serves websites at /<website>/<path>', () => {
    const home = publicPageMatcher(seg('amnx'));
    expect(home?.posParams?.['site'].path).toBe('amnx');
    expect(home?.posParams?.['path'].path).toBe('');
    expect(publicPageMatcher(seg('amnx', 'services', 'design'))?.posParams?.['path'].path).toBe('services/design');
  });

  it("leaves the app's own paths and files alone", () => {
    for (const first of ['admin', 'api', 'site', 'p', 'favicon.ico']) expect(publicPageMatcher(seg(first, 'x'))).toBeNull();
    expect(isReservedSlug('Admin')).toBe(true);
    expect(isReservedSlug('amnx')).toBe(false);
  });

  it('recognises old /p/<website> links so they can redirect', () => {
    expect(legacyPublicMatcher(seg('p', 'amnx', 'about'))?.posParams?.['rest'].path).toBe('amnx/about');
    expect(legacyPublicMatcher(seg('amnx'))).toBeNull();
  });
});
