/** Section type id, as declared by a component's schema.json (e.g. "hero", or a custom component). */
export type SectionType = string;

export type Align = 'left' | 'center';
export type TextAlign = 'left' | 'center' | 'right';
export type Device = 'desktop' | 'tablet' | 'mobile';
export type Shadow = 'none' | 'sm' | 'md' | 'lg';
/** Entrance animations (AOS-style). Named by where the element comes from; 'zoom' and 'fade-left' are the original two. */
export const ANIMATIONS = [
  'fade', 'fade-up', 'fade-down', 'fade-left', 'fade-right', 'fade-up-left', 'fade-up-right', 'fade-down-left', 'fade-down-right',
  'slide-up', 'slide-down', 'slide-left', 'slide-right',
  'zoom', 'zoom-in', 'zoom-in-up', 'zoom-in-down', 'zoom-in-left', 'zoom-in-right',
  'zoom-out', 'zoom-out-up', 'zoom-out-down', 'zoom-out-left', 'zoom-out-right',
  'flip-left', 'flip-right', 'flip-up', 'flip-down',
] as const;
export type Animation = 'none' | (typeof ANIMATIONS)[number];
export type AnimationEasing = 'ease' | 'ease-out' | 'ease-in-out' | 'ease-out-back' | 'linear';

/** Hide an element or section on specific device widths. */
export interface HideOn {
  desktop?: boolean;
  tablet?: boolean;
  mobile?: boolean;
}

export interface SectionStyle {
  /** Colour or theme token (see styles.ts). Empty string means "inherit from page theme". */
  background: string;
  textColor: string;
  /** Legacy single value for top and bottom padding; paddingTop/paddingBottom take precedence. */
  paddingY: number;
  align: Align;

  // Everything below is optional so pages saved by earlier versions stay valid.
  backgroundType?: 'color' | 'gradient' | 'image';
  gradientFrom?: string;
  gradientTo?: string;
  gradientAngle?: number;
  backgroundImage?: string;
  overlayColor?: string;
  /** 0–100 */
  overlayOpacity?: number;
  parallax?: boolean;

  paddingTop?: number;
  paddingBottom?: number;
  /** Top and bottom padding on phones. */
  paddingMobile?: number;
  /** Space left and right of the content, px (default 24; 0 = edge to edge). */
  paddingSide?: number;
  marginTop?: number;
  marginBottom?: number;

  width?: 'boxed' | 'narrow' | 'full' | 'custom';
  contentWidth?: number;
  /** Minimum height in vh (0 = auto). */
  /** Older "minimum height" in vh; still honoured when heightMode isn't set. */
  minHeight?: number;
  verticalAlign?: 'start' | 'center' | 'end';
  /** Section height: from the content (auto), at least a height (min), or exactly a height (fixed). */
  heightMode?: 'auto' | 'min' | 'fixed';
  /** px, or vh (% of the screen height). */
  heightUnit?: 'px' | 'vh';
  /** Height per device; tablet falls back to desktop, mobile to tablet. */
  heightDesktop?: number;
  heightTablet?: number;
  heightMobile?: number;

  borderTopWidth?: number;
  borderBottomWidth?: number;
  borderColor?: string;

  hideOn?: HideOn;
  animation?: Animation;
  /** Entrance animation timing, in ms (defaults: 700 / 0). */
  animationDuration?: number;
  animationDelay?: number;
  animationEasing?: AnimationEasing;
  /** Plays again every time it scrolls into view. */
  animationRepeat?: boolean;
  cssClass?: string;
  /** Plain CSS scoped to this section. Supports nesting, e.g. `h2 { color: red }`. */
  customCss?: string;
}

/** Style overrides for one element (a heading, button, image, card…). All optional. */
export interface ElementStyle {
  hidden?: boolean;
  hideOn?: HideOn;

  // Typography
  fontSize?: number;
  fontSizeMobile?: number;
  fontWeight?: number;
  lineHeight?: number;
  letterSpacing?: number;
  textTransform?: 'none' | 'uppercase' | 'capitalize';
  italic?: boolean;
  color?: string;
  textAlign?: TextAlign;

  // Box
  background?: string;
  paddingY?: number;
  paddingX?: number;
  radius?: number;
  borderWidth?: number;
  borderColor?: string;
  shadow?: Shadow;
  maxWidth?: number;
  fullWidth?: boolean;

  // Image
  aspectRatio?: 'auto' | '1/1' | '4/3' | '3/2' | '16/9' | '3/4';
  objectFit?: 'cover' | 'contain';

  // Spacing
  marginTop?: number;
  marginBottom?: number;

  animation?: Animation;
  /** Entrance animation timing, in ms (defaults: 700 / 0). */
  animationDuration?: number;
  animationDelay?: number;
  animationEasing?: AnimationEasing;
  /** Plays again every time it scrolls into view. */
  animationRepeat?: boolean;
  cssClass?: string;
}

export type CardStyle = 'bordered' | 'shadow' | 'flat' | 'none';
export type GridItemAlign = 'stretch' | 'start' | 'center';

/** Layout of a section's repeated items (cards). Columns are set per device width. */
export interface GridSettings {
  desktop: number;
  tablet: number;
  mobile: number;
  gap: number;
  /** Minimum row height in px; used by blocks that span several rows. */
  rowHeight: number;
  cardStyle: CardStyle;
  itemAlign: GridItemAlign;
  textAlign: Align;
}

/** Where a carousel's previous/next arrows go. */
export type CarouselArrowPosition =
  | 'sides'
  | 'outside'
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'
  /** Both arrows stacked beside the slides, on the left or right. */
  | 'left'
  | 'right'
  /** Arrows, pagination and the play/pause button together in one bar over the slides. */
  | 'pill';
export type CarouselArrowStyle = 'circle' | 'square' | 'outline' | 'solid' | 'minimal';
/** Where the pagination goes: centred/left/right below the slides, or over them. */
/** 'bar': one navigation bar over the slides that holds the pagination, the arrows and play/pause. */
export type CarouselDotsPosition = 'below' | 'below-left' | 'below-right' | 'overlay' | 'bar';
export type CarouselDotsStyle = 'pills' | 'dots' | 'lines' | 'numbers' | 'fraction' | 'progress' | 'thumbs' | 'capsule';

/** Behaviour of a carousel section. Slides per view are set per device. */
export interface CarouselSettings {
  perViewDesktop: number;
  perViewTablet: number;
  perViewMobile: number;
  gap: number;
  autoplay: boolean;
  /** Time each slide is shown, ms. */
  autoplaySpeed: number;
  /** Transition duration, ms. */
  speed: number;
  loop: boolean;
  arrows: boolean;
  dots: boolean;
  drag: boolean;
  touch: boolean;
  keyboard: boolean;
  center: boolean;
  /** slide: side by side · fade: cross-fade · flip: 3D flip · mask-*: the next slide is revealed through a CSS mask. All but slide show one slide at a time. */
  transition: 'slide' | 'fade' | 'flip' | 'mask-circle' | 'mask-wipe' | 'mask-blinds' | 'mask-split' | 'mask-ink' | 'mask-rise' | 'mask-clock' | 'mask-rows' | 'mask-corner' | 'mask-dots' | 'mask-zoom' | 'mask-diamond' | 'mask-sweep' | 'mask-fall' | 'mask-box' | 'mask-cross' | 'mask-tiles' | 'mask-fan' | 'mask-arc' | 'mask-bars' | 'mask-slats' | 'mask-open' | 'mask-diagonal' | 'auto';
  pauseOnHover: boolean;
  /** How the motion accelerates and settles. 'default' keeps each transition's own curve. */
  easing: 'default' | 'smooth' | 'gentle' | 'snappy' | 'bounce' | 'linear';
  /** Shows a play/pause button on the slider so visitors can switch autoplay off and on. */
  playButton: boolean;
  /** Where the text sits inside each slide ('' = the layout's default). */
  contentX: '' | 'left' | 'center' | 'right';
  contentY: '' | 'top' | 'middle' | 'bottom';
  /** Swap the order inside slides (image below text, author above quote…). */
  flipLayout: boolean;
  /** Mirror slide images horizontally. */
  mirrorImages: boolean;
  /** Extra shift of the slide text from its position, px (+x right, +y down). */
  contentMoveX: number;
  contentMoveY: number;
  /** Apply the shift on phones too (off: phones keep the text in place). */
  contentMovePhones: boolean;
  arrowPosition: CarouselArrowPosition;
  arrowStyle: CarouselArrowStyle;
  /** Arrow button size, px. */
  arrowSize: number;
  /** Extra offset of the previous (left) arrow from its position, px: + moves right / down. */
  prevX: number;
  prevY: number;
  /** Extra offset of the next (right) arrow, px. */
  nextX: number;
  nextY: number;
  dotsPosition: CarouselDotsPosition;
  dotsStyle: CarouselDotsStyle;
  /** Colour of the active dot, progress bar and solid arrows (theme token or CSS colour; '' = primary). */
  controlColor: string;
  /** Background and dot/icon colours of the capsule pagination and the navigation bar ('' = control colour / white). */
  /** Corner radius of the slides in px (null: the theme's own radius). */
  radius: number | null;
  /** Capsule pagination: show the play / stop button inside the capsule. */
  capsulePlay: boolean;
  paginationBg: string;
  paginationFg: string;
  /** Slide height: from the content, an exact px height, or a share of the screen height. */
  heightMode: 'auto' | 'fixed' | 'screen';
  /** Fixed heights per device, px. */
  heightDesktop: number;
  heightTablet: number;
  heightMobile: number;
  /** Screen heights per device, % of the screen height (vh). */
  screenDesktop: number;
  screenTablet: number;
  screenMobile: number;
}

export interface Section {
  id: string;
  type: SectionType;
  visible: boolean;
  /** Section-specific content; its shape is described by the section's field schema. */
  data: any;
  style: SectionStyle;
  /** Only for sections whose definition supports a grid; missing means "use the defaults". */
  grid?: GridSettings;
  /** Only for carousel sections; missing means "use the defaults". */
  carousel?: CarouselSettings;
  /** Style overrides for the section's elements, keyed by ElementDef.key. */
  elements?: Record<string, ElementStyle>;
}

// --- Custom section builder ---------------------------------------------------

export type BuilderElementType =
  | 'heading'
  | 'text'
  | 'image'
  | 'button'
  | 'list'
  | 'icon'
  | 'video'
  | 'spacer'
  | 'divider'
  | 'html';

export interface BuilderElement {
  id: string;
  type: BuilderElementType;
  data: any;
  style: ElementStyle;
}

export interface BuilderColumn {
  id: string;
  elements: BuilderElement[];
  style: ElementStyle;
}

/** Data of a 'custom' section. */
export interface CustomSectionData {
  anchor: string;
  /** Column widths as fractions joined by '-', e.g. '1-1' or '2-1'. */
  layout: string;
  gap: number;
  verticalAlign: 'start' | 'center' | 'end';
  /** Width at and below which columns stack into one. */
  stackOn: 'tablet' | 'mobile' | 'never';
  columns: BuilderColumn[];
}

// --- Page -----------------------------------------------------------------------

export interface Theme {
  primaryColor: string;
  accentColor: string;
  backgroundColor: string;
  surfaceColor: string;
  textColor: string;
  fontFamily: string;
  headingFont: string;
  radius: number;
  maxWidth: number;

  // Optional so older pages stay valid; defaults come from DEFAULT_THEME.
  baseFontSize?: number;
  lineHeight?: number;
  h1Size?: number;
  h2Size?: number;
  h3Size?: number;
  headingWeight?: number;
  headingLetterSpacing?: number;
  headingTransform?: 'none' | 'uppercase';
  buttonRadius?: number;
  buttonPaddingY?: number;
  buttonPaddingX?: number;
  buttonWeight?: number;
  buttonUppercase?: boolean;
  /** Page-wide CSS. */
  customCss?: string;
}

export interface Seo {
  metaTitle: string;
  metaDescription: string;
}

export type PageStatus = 'draft' | 'published';

/** A page's place in the website: order, nesting and menu options (stored in website.json). */
export interface PageNode {
  slug: string;
  children?: PageNode[];
  /** Leave the page out of navigation menus. */
  hideInMenu?: boolean;
  /** Menu text; defaults to the page title. */
  menuLabel?: string;
}

/** A website: a set of connected pages sharing a theme (site/websites/<slug>/). */
export interface Website {
  id: string;
  slug: string;
  name: string;
  status: PageStatus;
  templateId: string;
  /** Slug of the page served at the website's root. */
  homepage: string | null;
  pages: PageNode[];
  theme: Theme;
  /** Site-wide custom CSS (website.css). */
  customCss: string;
  createdAt: string;
  updatedAt: string;
}

export interface LandingPage {
  id: string;
  /** Slug of the website this page belongs to. */
  website: string;
  title: string;
  slug: string;
  /** Page-specific custom CSS (page.css). */
  customCss: string;
  /** Derived from the website (not stored with the page). */
  status: PageStatus;
  templateId: string;
  seo: Seo;
  /** The website theme, plus this page's CSS as customCss (derived, not stored with the page). */
  theme: Theme;
  sections: Section[];
  createdAt: string;
  updatedAt: string;
}

// --- Schemas ----------------------------------------------------------------------

export type FieldType = 'text' | 'textarea' | 'url' | 'image' | 'color' | 'number' | 'select' | 'toggle' | 'lines' | 'list';

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  options?: { label: string; value: string }[];
  /** For type 'list': the fields of each item. */
  itemFields?: FieldDef[];
  /** For type 'list': label used for the "add" button and item headers. */
  itemLabel?: string;
}

/** Which style controls an element offers. */
export type ElementKind = 'text' | 'button' | 'image' | 'box';

/** A styleable, clickable element inside a preset section. */
export interface ElementDef {
  key: string;
  label: string;
  kind: ElementKind;
  /** Content fields edited from the element panel (keys in the section data or list item). */
  fields?: string[];
  /** Set when the element repeats once per item of this list field (e.g. 'items'). */
  list?: string;
}

export interface SectionDef {
  type: SectionType;
  label: string;
  description: string;
  icon: string;
  fields: FieldDef[];
  /** Content for a newly added section. */
  defaults: Record<string, any>;
  defaultStyle?: Partial<SectionStyle>;
  /** Present when the section lays its items out in a customisable grid. */
  grid?: Partial<GridSettings>;
  /** Present when the section is a carousel (gives it a Slider tab). */
  carousel?: Partial<CarouselSettings>;
  /** Elements that can be clicked and styled individually. */
  elements?: ElementDef[];
}

/** Identifies what is selected in the editor. */
export interface Selection {
  sectionId: string;
  /** Element key (preset sections), `el:<id>` or `col:<id>` (custom sections); null = the section itself. */
  el: string | null;
  /** Item index for list elements. */
  index: number | null;
}
