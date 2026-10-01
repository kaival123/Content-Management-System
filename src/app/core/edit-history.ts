import { Injectable, signal } from '@angular/core';

/** Something an undo step applies to: one page, or one website's settings. */
export interface HistoryTarget {
  kind: 'page' | 'website';
  id: string;
  /** Website the target belongs to (the page's website, or the website itself). */
  site: string;
}

interface Store {
  undo(id: string): void;
  redo(id: string): void;
  /** Drops the store's own snapshots for `id`. */
  clear(id: string): void;
}

const LIMIT = 200;

function lastIndexFor(steps: HistoryTarget[][], site: string): number {
  for (let i = steps.length - 1; i >= 0; i--) if (steps[i].some((t) => t.site === site)) return i;
  return -1;
}

/**
 * One timeline of edits across a website's pages and its settings (theme, page tree,
 * menus), so undo/redo steps back through everything in the order it happened. Each
 * store keeps its own snapshots; this only records which store and which page or
 * website each step belongs to. Undo is per website: editing one website never
 * undoes another.
 *
 * `group()` merges the edits made inside it into one step (e.g. changing a page's URL
 * also rewrites links on other pages and the page tree — undo reverts all of it).
 */
@Injectable({ providedIn: 'root' })
export class EditHistory {
  private readonly stores = new Map<HistoryTarget['kind'], Store>();
  private readonly past = signal<HistoryTarget[][]>([]);
  private readonly future = signal<HistoryTarget[][]>([]);
  private grouping: HistoryTarget[] | null = null;
  private replaying = false;

  register(kind: HistoryTarget['kind'], store: Store): void {
    this.stores.set(kind, store);
  }

  /**
   * Called by a store on every edit. `coalesced` edits (typing into the same field)
   * extend the previous step instead of adding one, but still end the redo trail.
   */
  record(target: HistoryTarget, coalesced = false): void {
    if (this.replaying) return;
    if (coalesced) {
      this.dropFuture(target.site);
      return;
    }
    if (this.grouping) {
      this.grouping.push(target);
      return;
    }
    this.push([target]);
  }

  group<T>(fn: () => T): T {
    if (this.grouping) return fn();
    this.grouping = [];
    try {
      return fn();
    } finally {
      const step = this.grouping;
      this.grouping = null;
      if (step.length) this.push(step);
    }
  }

  /** Reactive (reads signals), so it can be used in computed() and templates. */
  canUndo(site: string): boolean {
    return this.past().some((s) => s.some((t) => t.site === site));
  }

  canRedo(site: string): boolean {
    return this.future().some((s) => s.some((t) => t.site === site));
  }

  /** Undoes the latest step that touched `site`. Returns what it changed. */
  undo(site: string): HistoryTarget[] | null {
    const past = this.past();
    const i = lastIndexFor(past, site);
    if (i < 0) return null;
    const step = past[i];
    this.replay(step, 'undo');
    this.past.set([...past.slice(0, i), ...past.slice(i + 1)]);
    this.future.update((f) => [...f, step]);
    return step;
  }

  redo(site: string): HistoryTarget[] | null {
    const future = this.future();
    const i = lastIndexFor(future, site);
    if (i < 0) return null;
    const step = future[i];
    this.replay(step, 'redo');
    this.future.set([...future.slice(0, i), ...future.slice(i + 1)]);
    this.past.update((p) => [...p, step]);
    return step;
  }

  /**
   * Clears all history of a website. Used after pages are added or deleted: older
   * snapshots of the page tree would no longer match the pages that exist.
   */
  clearSite(site: string): void {
    const targets = [...this.past(), ...this.future()].flat().filter((t) => t.site === site);
    for (const t of targets) this.stores.get(t.kind)?.clear(t.id);
    this.forget((t) => t.site === site);
  }

  /** Drops history entries of a page or website whose snapshots its store discarded. */
  forget(predicate: (t: HistoryTarget) => boolean): void {
    const keep = (steps: HistoryTarget[][]) => steps.map((s) => s.filter((t) => !predicate(t))).filter((s) => s.length);
    this.past.update(keep);
    this.future.update(keep);
  }

  private push(step: HistoryTarget[]): void {
    this.past.update((p) => [...p.slice(-(LIMIT - 1)), step]);
    this.dropFuture(step[0].site);
  }

  private dropFuture(site: string): void {
    if (this.future().some((s) => s.some((t) => t.site === site))) {
      this.future.update((f) => f.filter((s) => !s.some((t) => t.site === site)));
    }
  }

  private replay(step: HistoryTarget[], dir: 'undo' | 'redo'): void {
    this.replaying = true;
    try {
      // Undo in reverse order of the edits; redo in the original order.
      const ordered = dir === 'undo' ? [...step].reverse() : step;
      for (const t of ordered) this.stores.get(t.kind)?.[dir](t.id);
    } finally {
      this.replaying = false;
    }
  }
}
