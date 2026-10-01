import { applyLayout, createBuilderElement, createColumn, videoEmbedUrl } from './builder';
import { LandingPage, Section } from './models';
import { createSection } from './section-registry';
import { loadSiteComponents } from './site.test-helpers';
import { DEFAULT_THEME, elementCss, pageCustomCss, resolveColor, sectionCss, themeVars } from './styles';

describe('styles', () => {
  beforeAll(() => loadSiteComponents());

  it('resolves theme tokens and passes through custom colours', () => {
    expect(resolveColor('__primary__')).toBe('var(--lp-primary)');
    expect(resolveColor('#ff0000')).toBe('#ff0000');
    expect(resolveColor('')).toBeNull();
    expect(resolveColor(undefined)).toBeNull();
  });

  it('fills theme defaults for pages saved before the type scale existed', () => {
    const legacy = { ...DEFAULT_THEME, h1Size: undefined, buttonRadius: undefined };
    const vars = themeVars(legacy);
    expect(vars['--lp-h1']).toBe('64px');
    expect(vars['--lp-btn-radius']).toBe('12px');
  });

  it('emits only the element properties that were set', () => {
    expect(elementCss(undefined)).toEqual({ style: {}, classes: '' });
    const { style, classes } = elementCss({ fontSize: 40, color: '__accent__', hidden: true, hideOn: { mobile: true } });
    expect(style['--el-fs']).toBe('40px');
    expect(style['color']).toBe('var(--lp-accent)');
    expect(style['font-weight']).toBeNull();
    expect(classes.split(' ')).toEqual(expect.arrayContaining(['lp-el-fs', 'lp-el-hidden', 'lp-hide-m']));
  });

  it('builds gradient and image backgrounds for sections', () => {
    const s = createSection('cta');
    s.style.backgroundType = 'gradient';
    s.style.gradientFrom = '#000000';
    expect(sectionCss(s).style['background']).toBe('linear-gradient(135deg, #000000, var(--lp-accent))');

    s.style.backgroundType = 'image';
    s.style.backgroundImage = 'https://example.com/a.jpg';
    s.style.overlayOpacity = 50;
    const css = sectionCss(s).style;
    expect(css['background-image']).toContain('url("https://example.com/a.jpg")');
    expect(css['background-image']).toContain('50%');
  });

  it('falls back to the legacy paddingY value', () => {
    const s = createSection('hero');
    s.style.paddingY = 64;
    expect(sectionCss(s).style['--pad-t']).toBe('64px');
    s.style.paddingTop = 10;
    expect(sectionCss(s).style['--pad-t']).toBe('10px');
  });

  it('scopes page and section CSS to one rendered page', () => {
    const section: Section = { ...createSection('faq'), id: 's_1' };
    section.style.customCss = 'h2 { color: red; }';
    const page = { theme: { ...DEFAULT_THEME, customCss: 'p { margin: 0 }' }, sections: [section] } as LandingPage;
    const css = pageCustomCss(page, '[data-lp="r1"]');
    expect(css).toContain('[data-lp="r1"] {\np { margin: 0 }\n}');
    expect(css).toContain('[data-lp="r1"] [data-section-id="s_1"] {\nh2 { color: red; }\n}');
  });
});

describe('builder', () => {
  it('keeps content when reducing the number of columns', () => {
    const cols = [createColumn([createBuilderElement('text')]), createColumn(), createColumn([createBuilderElement('image')])];
    const next = applyLayout(cols, '1-1');
    expect(next.length).toBe(2);
    expect(next[1].elements.map((e) => e.type)).toEqual(['image']);
    expect(applyLayout(next, '1-1-1-1').length).toBe(4);
  });

  it('only builds embed URLs for YouTube and Vimeo', () => {
    expect(videoEmbedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(videoEmbedUrl('https://youtu.be/dQw4w9WgXcQ')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(videoEmbedUrl('https://vimeo.com/76979871')).toBe('https://player.vimeo.com/video/76979871');
    expect(videoEmbedUrl('javascript:alert(1)')).toBeNull();
    expect(videoEmbedUrl('https://evil.example/embed')).toBeNull();
  });
});

describe('section height', () => {
  const sec = (style: Partial<Section['style']>) => ({ ...createSection('hero'), style: { ...createSection('hero').style, ...style } }) as Section;

  it('is automatic unless set', () => {
    const css = sectionCss(sec({}));
    expect(css.style['--sec-h-d']).toBeUndefined();
    expect(css.classes).not.toContain('lp-h-');
  });

  it('keeps older "minimum height" sections as they were', () => {
    const css = sectionCss(sec({ minHeight: 80, verticalAlign: 'end' }));
    expect(css.style['--sec-h-d']).toBe('80vh');
    expect(css.style['--sec-h-m']).toBe('80vh');
    expect(css.classes).toContain('lp-h-min');
    expect(css.classes).toContain('lp-valign-end');
  });

  it('sets fixed or minimum heights per device, falling back to the larger device', () => {
    const fixed = sectionCss(sec({ heightMode: 'fixed', heightUnit: 'px', heightDesktop: 700, heightMobile: 420 }));
    expect([fixed.style['--sec-h-d'], fixed.style['--sec-h-t'], fixed.style['--sec-h-m']]).toEqual(['700px', '700px', '420px']);
    expect(fixed.classes).toContain('lp-h-fixed');
    const screen = sectionCss(sec({ heightMode: 'min', heightUnit: 'vh', heightDesktop: 100, heightTablet: 60 }));
    expect([screen.style['--sec-h-d'], screen.style['--sec-h-t'], screen.style['--sec-h-m']]).toEqual(['100vh', '60vh', '60vh']);
    expect(sectionCss(sec({ heightMode: 'auto', heightDesktop: 500 })).style['--sec-h-d']).toBeUndefined();
  });
});
