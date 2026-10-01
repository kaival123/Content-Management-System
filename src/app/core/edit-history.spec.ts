import { EditHistory, HistoryTarget } from './edit-history';

/** A store holding one value per id, with snapshot stacks like PageStore/WebsiteStore. */
function fakeStore(history: EditHistory, kind: HistoryTarget['kind'], site: (id: string) => string) {
  const values = new Map<string, number>();
  const past = new Map<string, number[]>();
  const future = new Map<string, number[]>();
  const stack = (m: Map<string, number[]>, id: string) => m.get(id) ?? (m.set(id, []), m.get(id)!);
  history.register(kind, {
    undo: (id) => {
      const prev = stack(past, id).pop();
      if (prev === undefined) return;
      stack(future, id).push(values.get(id)!);
      values.set(id, prev);
    },
    redo: (id) => {
      const next = stack(future, id).pop();
      if (next === undefined) return;
      stack(past, id).push(values.get(id)!);
      values.set(id, next);
    },
    clear: (id) => {
      past.delete(id);
      future.delete(id);
    },
  });
  return {
    get: (id: string) => values.get(id) ?? 0,
    set(id: string, value: number) {
      stack(past, id).push(values.get(id) ?? 0);
      future.set(id, []);
      values.set(id, value);
      history.record({ kind, id, site: site(id) });
    },
  };
}

describe('EditHistory', () => {
  let history: EditHistory;
  let pages: ReturnType<typeof fakeStore>;
  let sites: ReturnType<typeof fakeStore>;

  beforeEach(() => {
    history = new EditHistory();
    pages = fakeStore(history, 'page', (id) => id.split('/')[0]);
    sites = fakeStore(history, 'website', (id) => id);
  });

  it('undoes page and website edits in the order they happened', () => {
    pages.set('a/home', 1);
    sites.set('a', 10);
    pages.set('a/home', 2);
    history.undo('a');
    expect([pages.get('a/home'), sites.get('a')]).toEqual([1, 10]);
    history.undo('a');
    expect([pages.get('a/home'), sites.get('a')]).toEqual([1, 0]);
    history.redo('a');
    history.redo('a');
    expect([pages.get('a/home'), sites.get('a')]).toEqual([2, 10]);
    expect(history.canRedo('a')).toBe(false);
  });

  it('keeps websites separate', () => {
    pages.set('a/home', 1);
    pages.set('b/home', 5);
    history.undo('a');
    expect([pages.get('a/home'), pages.get('b/home')]).toEqual([0, 5]);
    expect(history.canUndo('a')).toBe(false);
    expect(history.canUndo('b')).toBe(true);
    // A new edit on b doesn't drop a's redo.
    pages.set('b/home', 6);
    expect(history.canRedo('a')).toBe(true);
  });

  it('undoes a group as one step', () => {
    history.group(() => {
      pages.set('a/home', 1);
      sites.set('a', 10);
      pages.set('a/about', 3);
    });
    history.undo('a');
    expect([pages.get('a/home'), sites.get('a'), pages.get('a/about')]).toEqual([0, 0, 0]);
    history.redo('a');
    expect([pages.get('a/home'), sites.get('a'), pages.get('a/about')]).toEqual([1, 10, 3]);
  });

  it('a new edit ends the redo trail; clearSite forgets everything', () => {
    pages.set('a/home', 1);
    history.undo('a');
    pages.set('a/home', 2);
    expect(history.canRedo('a')).toBe(false);
    history.clearSite('a');
    expect(history.canUndo('a')).toBe(false);
  });
});
