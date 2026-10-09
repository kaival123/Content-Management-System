import { LandingPage, Section } from './models';
import { sharedSectionsFor, withSharedSections } from './shared-sections';

const sec = (id: string, type: string, allPages = false, visible = true): Section => ({ id, type, visible, data: { allPages }, style: {} }) as unknown as Section;
const page = (id: string, sections: Section[]): LandingPage => ({ id, website: 'w', slug: id, sections }) as unknown as LandingPage;

describe('website-wide sections', () => {
  const home = page('home', [sec('m1', 'mini-header', true), sec('n1', 'navbar'), sec('h1', 'hero')]);
  const about = page('about', [sec('n2', 'navbar'), sec('a1', 'about')]);
  const pages = [home, about];

  it('shows the home mini header above the other pages', () => {
    const shown = withSharedSections(about, pages);
    expect(shown.sections.map((s) => s.id)).toEqual(['m1', 'n2', 'a1']);
    expect(about.sections.length).toBe(2);
  });

  it('leaves the source page and pages without shared sections untouched', () => {
    expect(withSharedSections(home, pages)).toBe(home);
    expect(withSharedSections(about, [about])).toBe(about);
  });

  it('keeps a page\'s own copy and ignores hidden or unmarked sections', () => {
    const own = page('own', [sec('m2', 'mini-header', true), sec('x', 'hero')]);
    expect(sharedSectionsFor(own, [home, own])).toEqual([]);
    const hidden = page('hid', [sec('m3', 'mini-header', true, false), sec('m4', 'footer')]);
    expect(sharedSectionsFor(about, [hidden, about])).toEqual([]);
  });

  it('takes only the first source for each type', () => {
    const other = page('other', [sec('m9', 'mini-header', true)]);
    expect(sharedSectionsFor(about, [home, other, about]).map((s) => s.id)).toEqual(['m1']);
  });
});
