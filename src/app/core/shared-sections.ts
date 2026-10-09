import { LandingPage, Section } from './models';

/**
 * Sections that are switched on for "every page of the website" (data.allPages, e.g. the mini header) live on one page
 * and are shown on the website's other pages too, above that page's own sections. Edit them on the page they belong to.
 * A page that has its own section of the same type marked this way keeps that one instead.
 */
export function sharedSectionsFor(page: LandingPage, siblings: LandingPage[]): Section[] {
  const own = new Set(page.sections.filter((s) => s.data?.['allPages']).map((s) => s.type));
  const taken = new Set(own);
  const shared: Section[] = [];
  for (const other of siblings) {
    if (other.id === page.id) continue;
    for (const s of other.sections) {
      if (!s.visible || !s.data?.['allPages'] || taken.has(s.type)) continue;
      taken.add(s.type);
      shared.push(s);
    }
  }
  return shared;
}

/** The page as visitors see it: the website-wide sections first, then its own. */
export function withSharedSections(page: LandingPage, siblings: LandingPage[]): LandingPage {
  const shared = sharedSectionsFor(page, siblings);
  return shared.length ? { ...page, sections: [...shared, ...page.sections] } : page;
}
