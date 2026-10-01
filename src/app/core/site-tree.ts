import { PageNode } from './models';

/**
 * Helpers for a website's page tree (website.json "pages"): order, nesting and
 * URL paths. All functions return new trees instead of mutating.
 */

export function flatten(nodes: PageNode[]): PageNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children ?? [])]);
}

/** Slugs from the root to `slug` (its URL path), or null if it isn't in the tree. */
export function pathOf(nodes: PageNode[], slug: string, trail: string[] = []): string[] | null {
  for (const n of nodes) {
    const here = [...trail, n.slug];
    if (n.slug === slug) return here;
    const found = pathOf(n.children ?? [], slug, here);
    if (found) return found;
  }
  return null;
}

/** Finds the page for a URL path such as ["services", "web-design"]. */
export function findByPath(nodes: PageNode[], path: string[]): PageNode | null {
  let level = nodes;
  let found: PageNode | null = null;
  for (const seg of path) {
    found = level.find((n) => n.slug === seg) ?? null;
    if (!found) return null;
    level = found.children ?? [];
  }
  return found;
}

export function findNode(nodes: PageNode[], slug: string): PageNode | null {
  return flatten(nodes).find((n) => n.slug === slug) ?? null;
}

function clean(nodes: PageNode[]): PageNode[] {
  return nodes.map((n) => {
    const { children, ...rest } = n;
    return children?.length ? { ...rest, children: clean(children) } : rest;
  });
}

/** Removes a page and returns [tree without it, removed node (with its sub-pages)]. */
export function removeNode(nodes: PageNode[], slug: string): [PageNode[], PageNode | null] {
  let removed: PageNode | null = null;
  const walk = (list: PageNode[]): PageNode[] =>
    list.flatMap((n) => {
      if (n.slug === slug) {
        removed = n;
        return [];
      }
      return [{ ...n, children: walk(n.children ?? []) }];
    });
  const next = clean(walk(nodes));
  return [next, removed];
}

/** Inserts `node` after `afterSlug` (same level), as the last child of `parentSlug`, or at the end. */
export function insertNode(nodes: PageNode[], node: PageNode, where: { after?: string; parent?: string } = {}): PageNode[] {
  if (where.parent) {
    return clean(
      nodes.map((n) =>
        n.slug === where.parent
          ? { ...n, children: [...(n.children ?? []), node] }
          : { ...n, children: insertNode(n.children ?? [], node, where) },
      ),
    );
  }
  if (where.after) {
    const i = nodes.findIndex((n) => n.slug === where.after);
    if (i >= 0) return clean([...nodes.slice(0, i + 1), node, ...nodes.slice(i + 1)]);
    return clean(nodes.map((n) => ({ ...n, children: insertNode(n.children ?? [], node, where) })));
  }
  return clean([...nodes, node]);
}

export function updateNode(nodes: PageNode[], slug: string, patch: Partial<PageNode>): PageNode[] {
  return clean(nodes.map((n) => (n.slug === slug ? { ...n, ...patch } : { ...n, children: updateNode(n.children ?? [], slug, patch) })));
}

/** Parent of a page (null for top-level pages). */
export function parentOf(nodes: PageNode[], slug: string, parent: PageNode | null = null): PageNode | null | undefined {
  for (const n of nodes) {
    if (n.slug === slug) return parent;
    const found = parentOf(n.children ?? [], slug, n);
    if (found !== undefined) return found;
  }
  return undefined;
}

function siblingsOf(nodes: PageNode[], slug: string): PageNode[] {
  const parent = parentOf(nodes, slug);
  return parent ? (parent.children ?? []) : nodes;
}

/**
 * Moves a page: up/down among its siblings, `indent` makes it a sub-page of the
 * page above it, `outdent` moves it up one level (right after its former parent).
 */
export function movePage(nodes: PageNode[], slug: string, how: 'up' | 'down' | 'indent' | 'outdent'): PageNode[] {
  const siblings = siblingsOf(nodes, slug);
  const i = siblings.findIndex((n) => n.slug === slug);
  const parent = parentOf(nodes, slug);
  if (i < 0) return nodes;

  if (how === 'up' || how === 'down') {
    const j = how === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= siblings.length) return nodes;
    const reordered = [...siblings];
    [reordered[i], reordered[j]] = [reordered[j], reordered[i]];
    return parent ? updateNode(nodes, parent.slug, { children: reordered }) : clean(reordered);
  }
  const [without, node] = removeNode(nodes, slug);
  if (!node) return nodes;
  if (how === 'indent') {
    if (i === 0) return nodes; // nothing above to nest under
    return insertNode(without, node, { parent: siblings[i - 1].slug });
  }
  if (!parent) return nodes; // already top level
  return insertNode(without, node, { after: parent.slug });
}

export function moveBefore(nodes: PageNode[], slug: string, beforeSlug: string): PageNode[] {
  if (slug === beforeSlug || pathOf([findNode(nodes, slug) ?? { slug: '' }], beforeSlug)) return nodes;
  const [without, node] = removeNode(nodes, slug);
  if (!node) return nodes;
  const walk = (list: PageNode[]): PageNode[] =>
    list.flatMap((n) => (n.slug === beforeSlug ? [node, n] : [{ ...n, children: walk(n.children ?? []) }]));
  return clean(walk(without));
}
