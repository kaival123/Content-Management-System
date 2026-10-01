import { CarouselSettings, ElementStyle, GridSettings, Section, SectionStyle, Theme } from './models';
import { createSection } from './section-registry';
import { DEFAULT_THEME } from './styles';

export { DEFAULT_THEME };

export const FONT_OPTIONS = [
  'Inter',
  'Poppins',
  'Roboto',
  'Open Sans',
  'Montserrat',
  'Lato',
  'Playfair Display',
  'Merriweather',
  'DM Sans',
  'Space Grotesk',
  'Nunito',
  'Raleway',
  'Oswald',
  'Source Serif 4',
  'Work Sans',
  'Manrope',
  'Outfit',
  'Plus Jakarta Sans',
  'Lora',
  'Bebas Neue',
];

/** A section described by only what differs from its component's defaults (templates, library presets). */
export interface SectionPreset {
  type: string;
  data?: any;
  style?: Partial<SectionStyle>;
  grid?: Partial<GridSettings>;
  carousel?: Partial<CarouselSettings>;
  elements?: Record<string, ElementStyle>;
}

export interface TemplatePage {
  slug: string;
  title: string;
  sections: SectionPreset[];
  children?: TemplatePage[];
  hideInMenu?: boolean;
  menuLabel?: string;
}

/** A starting point for new websites, stored as site/templates/<id>.json. */
export interface PageTemplate {
  id: string;
  /** "single": one landing page; "multi": several connected pages. */
  kind: 'single' | 'multi';
  category: string;
  name: string;
  description: string;
  /** Swatch colours shown on the template card. */
  preview: string[];
  theme: Partial<Theme>;
  /** The first page is the homepage. */
  pages: TemplatePage[];
}

/** A section preset in the section library: site/library/<category>/<name>.json. */
export interface LibraryItem {
  id: string;
  name: string;
  description?: string;
  category: string;
  /** Project-relative file the preset was read from. */
  file: string;
  section: SectionPreset;
}

export function instantiateSection(p: SectionPreset): Section {
  const section = createSection(p.type, structuredClone(p.data), p.style, p.grid, p.carousel);
  if (p.elements && Object.keys(p.elements).length) section.elements = structuredClone(p.elements);
  return section;
}

export function instantiateSections(sections: SectionPreset[] = []): Section[] {
  return sections.map(instantiateSection);
}

/** All pages of a template, depth-first (parents before children). */
export function templatePages(template: PageTemplate): TemplatePage[] {
  const walk = (pages: TemplatePage[]): TemplatePage[] => pages.flatMap((p) => [p, ...walk(p.children ?? [])]);
  return walk(template.pages ?? []);
}

/** Turns an existing section back into a preset (for "Save as reusable section"). */
export function toPreset(section: Section): SectionPreset {
  const preset: SectionPreset = { type: section.type, data: structuredClone(section.data), style: structuredClone(section.style) };
  if (section.grid) preset.grid = structuredClone(section.grid);
  if (section.carousel) preset.carousel = structuredClone(section.carousel);
  if (section.elements && Object.keys(section.elements).length) preset.elements = structuredClone(section.elements);
  return preset;
}
