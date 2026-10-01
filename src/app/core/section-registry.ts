import { signal } from '@angular/core';
import { BuilderColumn, CarouselSettings, ElementDef, GridSettings, Section, SectionDef, SectionStyle, SectionType } from './models';
import { uid } from './util';

/**
 * Section definitions (schemas) of the components in site/components/. They are
 * loaded from the project at runtime, so components added or edited in VS Code
 * appear in the editor without rebuilding the app. Backed by a signal so views
 * that read definitions update when components change.
 */
const defs = signal<ReadonlyMap<string, SectionDef>>(new Map());

export function setSectionDefs(list: SectionDef[]): void {
  defs.set(new Map(list.map((d) => [d.type, d])));
}

/** All section types in menu order (as loaded from the project). */
export function sectionDefs(): SectionDef[] {
  return [...defs().values()];
}

/** Definition for a section type. Unknown types (e.g. a deleted component) get a placeholder. */
export function getSectionDef(type: SectionType): SectionDef {
  return (
    defs().get(type) ?? {
      type,
      label: `${type} (missing component)`,
      description: 'This component no longer exists in site/components/.',
      icon: 'help',
      fields: [],
      defaults: {},
      elements: [],
    }
  );
}

export function getElementDef(type: SectionType, key: string): ElementDef | undefined {
  return getSectionDef(type).elements?.find((e) => e.key === key);
}

export const DEFAULT_SECTION_STYLE: SectionStyle = {
  background: '',
  textColor: '',
  paddingY: 80,
  align: 'center',
};

export const DEFAULT_GRID: GridSettings = {
  desktop: 3,
  tablet: 2,
  mobile: 1,
  gap: 24,
  rowHeight: 200,
  cardStyle: 'bordered',
  itemAlign: 'stretch',
  textAlign: 'left',
};

export function supportsGrid(type: SectionType): boolean {
  return !!getSectionDef(type).grid;
}

/**
 * Effective grid settings for a section: its own settings over the section type's
 * defaults. Also covers pages saved before grids existed (legacy `columns` field).
 */
export function resolveGrid(section: Section): GridSettings {
  const legacyColumns = Number(section.data?.columns) || undefined;
  return {
    ...DEFAULT_GRID,
    ...getSectionDef(section.type).grid,
    ...(legacyColumns ? { desktop: legacyColumns } : {}),
    ...section.grid,
  };
}

export const DEFAULT_CAROUSEL: CarouselSettings = {
  perViewDesktop: 3,
  perViewTablet: 2,
  perViewMobile: 1,
  gap: 24,
  autoplay: false,
  autoplaySpeed: 4000,
  speed: 500,
  loop: true,
  arrows: true,
  dots: true,
  drag: true,
  touch: true,
  keyboard: true,
  center: false,
  transition: 'slide',
  pauseOnHover: true,
  arrowPosition: 'sides',
  arrowStyle: 'circle',
  arrowSize: 44,
  prevX: 0,
  prevY: 0,
  nextX: 0,
  nextY: 0,
  dotsPosition: 'below',
  dotsStyle: 'pills',
  controlColor: '',
  contentX: '',
  contentY: '',
  flipLayout: false,
  mirrorImages: false,
  contentMoveX: 0,
  contentMoveY: 0,
  contentMovePhones: false,
  heightMode: 'auto',
  heightDesktop: 560,
  heightTablet: 460,
  heightMobile: 380,
  screenDesktop: 100,
  screenTablet: 80,
  screenMobile: 70,
};

export function supportsCarousel(type: SectionType): boolean {
  return !!getSectionDef(type).carousel;
}

/** Effective carousel settings: the section's own over the component's defaults. */
export function resolveCarousel(section: Section): CarouselSettings {
  return { ...DEFAULT_CAROUSEL, ...getSectionDef(section.type).carousel, ...section.carousel };
}

/** Gives custom-section columns and elements fresh ids (defaults and copies must not share ids). */
export function withFreshIds(data: any): any {
  if (!Array.isArray(data?.columns)) return data;
  return {
    ...data,
    columns: (data.columns as BuilderColumn[]).map((c) => ({
      ...c,
      id: uid('c_'),
      elements: (c.elements ?? []).map((e) => ({ ...e, id: uid('e_') })),
    })),
  };
}

/** Creates a new section of the given type, optionally overriding default content/style/grid. */
export function createSection(
  type: SectionType,
  data?: any,
  style?: Partial<SectionStyle>,
  grid?: Partial<GridSettings>,
  carousel?: Partial<CarouselSettings>,
): Section {
  const def = getSectionDef(type);
  const section: Section = {
    id: uid('s_'),
    type,
    visible: true,
    data: withFreshIds({ ...structuredClone(def.defaults ?? {}), ...(data ?? {}) }),
    style: { ...DEFAULT_SECTION_STYLE, ...(def.defaultStyle ?? {}), ...(style ?? {}) },
  };
  if (def.grid) section.grid = { ...DEFAULT_GRID, ...def.grid, ...(grid ?? {}) };
  if (def.carousel) section.carousel = { ...DEFAULT_CAROUSEL, ...def.carousel, ...(carousel ?? {}) };
  return section;
}
