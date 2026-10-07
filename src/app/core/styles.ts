import { ElementStyle, HideOn, LandingPage, Section, SectionStyle, Shadow, Theme } from './models';

/**
 * Converts the style settings stored on pages into CSS for the renderer.
 * Kept free of Angular so it is easy to test and reuse (e.g. for server-side export).
 */

export const DEFAULT_THEME: Theme = {
  primaryColor: '#4f46e5',
  accentColor: '#06b6d4',
  backgroundColor: '#ffffff',
  surfaceColor: '#f8fafc',
  textColor: '#0f172a',
  fontFamily: 'Inter',
  headingFont: 'Inter',
  radius: 12,
  maxWidth: 1140,
  baseFontSize: 16,
  lineHeight: 1.6,
  h1Size: 64,
  h2Size: 44,
  h3Size: 20,
  headingWeight: 800,
  headingLetterSpacing: -0.02,
  headingTransform: 'none',
  buttonRadius: 12,
  buttonPaddingY: 14,
  buttonPaddingX: 26,
  buttonWeight: 600,
  buttonUppercase: false,
  customCss: '',
};

/** Colour tokens that follow the page theme, offered next to custom colours in the editor. */
export const COLOR_TOKENS: { label: string; value: string; css: string }[] = [
  { label: 'Primary', value: '__primary__', css: 'var(--lp-primary)' },
  { label: 'Accent', value: '__accent__', css: 'var(--lp-accent)' },
  { label: 'Text', value: '__text__', css: 'var(--lp-text)' },
  { label: 'Background', value: '__bg__', css: 'var(--lp-bg)' },
  { label: 'Surface', value: '__surface__', css: 'var(--lp-surface)' },
];

const TOKEN_CSS = new Map(COLOR_TOKENS.map((t) => [t.value, t.css]));

/** Resolves a stored colour (hex, rgb(), or a theme token) to CSS; empty means "inherit". */
export function resolveColor(value: string | undefined | null): string | null {
  if (!value) return null;
  return TOKEN_CSS.get(value) ?? value;
}

export function resolveTheme(theme: Theme): Required<Theme> {
  const resolved: Record<string, unknown> = { ...DEFAULT_THEME };
  // Unset values (undefined/null) fall back to the defaults instead of overriding them.
  for (const [key, value] of Object.entries(theme)) {
    if (value !== undefined && value !== null) resolved[key] = value;
  }
  return resolved as Required<Theme>;
}

export function themeVars(theme: Theme): Record<string, string> {
  const t = resolveTheme(theme);
  return {
    '--lp-primary': t.primaryColor,
    '--lp-accent': t.accentColor,
    '--lp-bg': t.backgroundColor,
    '--lp-surface': t.surfaceColor,
    '--lp-text': t.textColor,
    '--lp-font': `'${t.fontFamily}', system-ui, sans-serif`,
    '--lp-heading-font': `'${t.headingFont}', system-ui, sans-serif`,
    '--lp-radius': `${t.radius}px`,
    '--lp-max': `${t.maxWidth}px`,
    '--lp-base': `${t.baseFontSize}px`,
    '--lp-lh': String(t.lineHeight),
    '--lp-h1': `${t.h1Size}px`,
    // Unitless copies let CSS scale headings fluidly: full size at 1200px wide, smaller below.
    '--lp-h1-n': String(t.h1Size),
    '--lp-h2-n': String(t.h2Size),
    '--lp-h2': `${t.h2Size}px`,
    '--lp-h3': `${t.h3Size}px`,
    '--lp-hw': String(t.headingWeight),
    '--lp-hls': `${t.headingLetterSpacing}em`,
    '--lp-htt': t.headingTransform,
    '--lp-btn-radius': `${t.buttonRadius}px`,
    '--lp-btn-py': `${t.buttonPaddingY}px`,
    '--lp-btn-px': `${t.buttonPaddingX}px`,
    '--lp-btn-weight': String(t.buttonWeight),
    '--lp-btn-tt': t.buttonUppercase ? 'uppercase' : 'none',
  };
}

const SHADOWS: Record<Shadow, string | null> = {
  none: 'none',
  sm: '0 1px 3px rgb(0 0 0 / 0.12)',
  md: '0 10px 24px -8px rgb(0 0 0 / 0.22)',
  lg: '0 24px 56px -16px rgb(0 0 0 / 0.35)',
};

export const SECTION_WIDTHS: Record<string, string | null> = { boxed: null, narrow: '760px', full: 'none' };

/** Effective section height, or null for "auto". Sections from before heightMode use minHeight (vh). */
export function sectionHeight(st: SectionStyle): { mode: 'min' | 'fixed'; desktop: string; tablet: string; mobile: string } | null {
  if (!st.heightMode && st.minHeight) {
    const v = `${st.minHeight}vh`;
    return { mode: 'min', desktop: v, tablet: v, mobile: v };
  }
  if (!st.heightMode || st.heightMode === 'auto' || !st.heightDesktop) return null;
  const unit = st.heightUnit ?? 'px';
  const d = st.heightDesktop;
  const t = st.heightTablet ?? d;
  const m = st.heightMobile ?? t;
  return { mode: st.heightMode, desktop: `${d}${unit}`, tablet: `${t}${unit}`, mobile: `${m}${unit}` };
}

function hideClasses(hideOn: HideOn | undefined, classes: string[]): void {
  if (hideOn?.desktop) classes.push('lp-hide-d');
  if (hideOn?.tablet) classes.push('lp-hide-t');
  if (hideOn?.mobile) classes.push('lp-hide-m');
}

const px = (n: number | undefined) => (n === undefined || n === null ? null : `${n}px`);

export interface CssResult {
  style: Record<string, string | number | null>;
  classes: string;
}

export function sectionCss(s: Section): CssResult {
  const st = s.style;
  const style: Record<string, string | number | null> = {
    color: resolveColor(st.textColor),
    'text-align': st.align,
    '--pad-t': px(st.paddingTop ?? st.paddingY),
    '--pad-b': px(st.paddingBottom ?? st.paddingY),
    '--pad-m': px(st.paddingMobile),
    '--pad-x': px(st.paddingSide),
    'margin-top': px(st.marginTop),
    'margin-bottom': px(st.marginBottom),
  };

  const type = st.backgroundType ?? 'color';
  if (type === 'gradient') {
    style['background'] = `linear-gradient(${st.gradientAngle ?? 135}deg, ${resolveColor(st.gradientFrom) ?? 'var(--lp-primary)'}, ${resolveColor(st.gradientTo) ?? 'var(--lp-accent)'})`;
  } else if (type === 'image' && st.backgroundImage) {
    const overlay = resolveColor(st.overlayColor) ?? '#000000';
    const opacity = st.overlayOpacity ?? 40;
    const tint = `color-mix(in srgb, ${overlay} ${opacity}%, transparent)`;
    style['background-color'] = resolveColor(st.background);
    style['background-image'] = `linear-gradient(${tint}, ${tint}), url("${st.backgroundImage.replace(/"/g, '%22')}")`;
    style['background-size'] = 'cover';
    style['background-position'] = 'center';
    style['background-attachment'] = st.parallax ? 'fixed' : null;
  } else {
    style['background'] = resolveColor(st.background);
  }

  const width = st.width ?? 'boxed';
  style['--lp-section-max'] = width === 'custom' ? px(st.contentWidth ?? 960) : SECTION_WIDTHS[width];

  // Height: per-device values into --sec-h-d/t/m; base.css picks one by container width.
  const height = sectionHeight(st);
  if (height) {
    style['--sec-h-d'] = height.desktop;
    style['--sec-h-t'] = height.tablet;
    style['--sec-h-m'] = height.mobile;
  }
  if (st.borderTopWidth) style['border-top'] = `${st.borderTopWidth}px solid ${resolveColor(st.borderColor) ?? 'currentColor'}`;
  if (st.borderBottomWidth) style['border-bottom'] = `${st.borderBottomWidth}px solid ${resolveColor(st.borderColor) ?? 'currentColor'}`;

  const classes: string[] = [];
  // Lets components adapt to their width (e.g. an edge-to-edge slider drops its rounded corners).
  if (width !== 'boxed') classes.push(`lp-w-${width}`);
  if (st.paddingSide === 0) classes.push('lp-edge');
  if (height) classes.push(`lp-h-${height.mode}`, `lp-valign-${st.verticalAlign ?? 'center'}`);
  animationCss(st, style, classes);
  hideClasses(st.hideOn, classes);
  if (st.cssClass) classes.push(...st.cssClass.split(/\s+/).filter(Boolean));
  return { style, classes: classes.join(' ') };
}

/** CSS for one element. Only properties the user has set are emitted, so defaults still come from the stylesheet. */
export function elementCss(e: ElementStyle | undefined): CssResult {
  if (!e) return { style: {}, classes: '' };
  const style: Record<string, string | number | null> = {
    '--el-fs': px(e.fontSize),
    '--el-fs-m': px(e.fontSizeMobile),
    'font-weight': e.fontWeight ?? null,
    'line-height': e.lineHeight ?? null,
    'letter-spacing': e.letterSpacing !== undefined ? `${e.letterSpacing}px` : null,
    'text-transform': e.textTransform ?? null,
    'font-style': e.italic ? 'italic' : null,
    color: resolveColor(e.color),
    'text-align': e.textAlign ?? null,
    background: resolveColor(e.background),
    'padding-top': px(e.paddingY),
    'padding-bottom': px(e.paddingY),
    'padding-left': px(e.paddingX),
    'padding-right': px(e.paddingX),
    'border-radius': px(e.radius),
    border: e.borderWidth ? `${e.borderWidth}px solid ${resolveColor(e.borderColor) ?? 'currentColor'}` : null,
    'box-shadow': e.shadow ? SHADOWS[e.shadow] : null,
    'max-width': px(e.maxWidth),
    'aspect-ratio': e.aspectRatio && e.aspectRatio !== 'auto' ? e.aspectRatio.replace('/', ' / ') : null,
    'object-fit': e.objectFit ?? null,
    'margin-top': px(e.marginTop),
    'margin-bottom': px(e.marginBottom),
  };
  if (e.maxWidth && e.textAlign === 'center') {
    style['margin-left'] = 'auto';
    style['margin-right'] = 'auto';
  }
  if (e.borderWidth === 0) style['border'] = '0';

  const classes: string[] = [];
  if (e.fontSize) classes.push('lp-el-fs');
  if (e.fullWidth) classes.push('lp-el-full');
  if (e.hidden) classes.push('lp-el-hidden');
  animationCss(e, style, classes);
  hideClasses(e.hideOn, classes);
  if (e.cssClass) classes.push(...e.cssClass.split(/\s+/).filter(Boolean));
  return { style, classes: classes.join(' ') };
}

/**
 * Combines website, page and section CSS into one stylesheet, all nested under
 * `scope` (a selector for one rendered page) so it can't leak into other pages.
 */
export function pageCustomCss(page: LandingPage, scope: string, siteCss = ''): string {
  const parts: string[] = [];
  // Website-wide CSS (website.css) first, so page and section CSS can override it.
  if (siteCss.trim()) parts.push(`${scope} {
${siteCss.trim()}
}`);
  const pageCss = resolveTheme(page.theme).customCss.trim();
  if (pageCss) parts.push(`${scope} {\n${pageCss}\n}`);
  for (const s of page.sections) {
    const css = s.style.customCss?.trim();
    // Native CSS nesting scopes the user's rules to the section.
    if (css) parts.push(`${scope} [data-section-id="${s.id.replace(/["\\]/g, '\\$&')}"] {\n${css}\n}`);
  }
  return parts.join('\n');
}

const EASINGS: Record<string, string> = {
  ease: 'ease',
  'ease-out': 'cubic-bezier(0.16, 1, 0.3, 1)',
  'ease-in-out': 'cubic-bezier(0.65, 0, 0.35, 1)',
  'ease-out-back': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  linear: 'linear',
};

/** Entrance animation: classes for the effect and CSS variables for its timing. */
function animationCss(
  a: { animation?: string; animationDuration?: number; animationDelay?: number; animationEasing?: string; animationRepeat?: boolean },
  style: Record<string, string | number | null>,
  classes: string[],
): void {
  if (!a.animation || a.animation === 'none') return;
  classes.push('lp-anim', `lp-anim-${a.animation}`);
  if (a.animationRepeat) classes.push('lp-anim-repeat');
  if (a.animationDuration) style['--aos-dur'] = `${a.animationDuration}ms`;
  if (a.animationDelay) style['--aos-delay'] = `${a.animationDelay}ms`;
  if (a.animationEasing && EASINGS[a.animationEasing]) style['--aos-ease'] = EASINGS[a.animationEasing];
}
