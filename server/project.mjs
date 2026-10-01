// Reading and writing the landing-page project (site/) on disk.
//
// A website lives in site/websites/<site>/:
//   website.json              name, status, homepage, page tree (order + nesting), theme
//   website.css               site-wide custom CSS (optional)
//   pages/<slug>/page.json    page title, SEO and section order
//   pages/<slug>/page.css     page custom CSS (optional)
//   pages/<slug>/sections/<type>-<id>.json   one file per section (content, style, element styles)
//   pages/<slug>/sections/<type>-<id>.css    section custom CSS (optional)
//
// Page folders are flat; nesting and order live in website.json, so reorganising pages
// never moves files. Small files keep Git diffs readable.

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', '.cache']);

export function hash(content) {
  return createHash('sha1').update(content).digest('hex').slice(0, 16);
}

export function toPosix(p) {
  return p.split(path.sep).join('/');
}

export async function readText(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

export async function writeText(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, 'utf8');
}

const json = (value) => JSON.stringify(value, null, 2) + '\n';

export class ProjectError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export function isValidSlug(slug) {
  return typeof slug === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/.test(slug);
}

function sectionFileName(section) {
  const safe = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, '');
  return `${safe(section.type)}-${safe(section.id)}`;
}

/** Page tree nodes: { slug, children?, hideInMenu?, menuLabel? } — invalid entries are dropped. */
export function normalizeTree(nodes) {
  if (!Array.isArray(nodes)) return [];
  const seen = new Set();
  const walk = (list) =>
    list
      .filter((n) => n && isValidSlug(typeof n === 'string' ? n : n.slug))
      .map((n) => (typeof n === 'string' ? { slug: n } : n))
      .filter((n) => !seen.has(n.slug) && seen.add(n.slug))
      .map((n) => ({ ...n, ...(Array.isArray(n.children) && n.children.length ? { children: walk(n.children) } : { children: undefined }) }));
  return walk(nodes);
}

export function flattenTree(nodes) {
  return (nodes ?? []).flatMap((n) => [n, ...flattenTree(n.children)]);
}

export class Project {
  constructor(root) {
    this.root = path.resolve(root);
  }

  /** Resolves a project-relative path, refusing anything outside the project folder. */
  resolve(rel) {
    const abs = path.resolve(this.root, rel ?? '');
    if (abs !== this.root && !abs.startsWith(this.root + path.sep)) throw new ProjectError(400, 'Path is outside the project');
    return abs;
  }

  rel(abs) {
    return toPosix(path.relative(this.root, abs));
  }

  // --- components, templates, config ----------------------------------------------------

  async components() {
    const dir = this.resolve('components');
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    const list = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const base = path.join(dir, e.name);
      const schemaText = await readText(path.join(base, 'schema.json'));
      if (schemaText === null) continue;
      let schema;
      let error = null;
      try {
        schema = JSON.parse(schemaText);
      } catch (err) {
        error = `schema.json: ${err.message}`;
        schema = {};
      }
      list.push({
        ...schema,
        type: schema.type || e.name.toLowerCase(),
        label: schema.label || e.name,
        description: schema.description || '',
        icon: schema.icon || 'layout',
        fields: schema.fields || [],
        elements: schema.elements || [],
        defaults: schema.defaults || {},
        folder: e.name,
        template: (await readText(path.join(base, 'component.html'))) ?? '',
        css: (await readText(path.join(base, 'component.css'))) ?? '',
        error,
      });
    }
    // Menu order: config/site.json "componentOrder", then alphabetical.
    const order = (await this.config()).componentOrder ?? [];
    const rank = (t) => (order.includes(t) ? order.indexOf(t) : order.length);
    return list.sort((a, b) => rank(a.type) - rank(b.type) || a.label.localeCompare(b.label));
  }

  async templates() {
    const dir = this.resolve('templates');
    const files = (await fs.readdir(dir).catch(() => [])).filter((f) => f.endsWith('.json')).sort();
    const out = [];
    for (const f of files) {
      try {
        out.push(JSON.parse(await readText(path.join(dir, f))));
      } catch {
        // A broken template file shouldn't break the whole project; Developer Mode shows the JSON error.
      }
    }
    // Blank templates first, then by name; the CMS groups them by kind and category.
    return out.sort((a, b) => Number(b.category === 'Blank') - Number(a.category === 'Blank') || String(a.name).localeCompare(String(b.name)));
  }

  async config() {
    const text = await readText(this.resolve('config/site.json'));
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return {};
    }
  }

  async baseCss() {
    return (await readText(this.resolve('styles/base.css'))) ?? '';
  }

  // --- websites ---------------------------------------------------------------------------------

  async websiteSlugs() {
    const entries = await fs.readdir(this.resolve('websites'), { withFileTypes: true }).catch(() => []);
    const slugs = [];
    for (const e of entries) {
      if (e.isDirectory() && (await readText(this.resolve(`websites/${e.name}/website.json`))) !== null) slugs.push(e.name);
    }
    return slugs.sort();
  }

  /** website.json plus its site-wide CSS, with the hash of each file for conflict detection. */
  async readWebsite(site) {
    const dir = `websites/${site}`;
    const versions = {};
    const text = await readText(this.resolve(`${dir}/website.json`));
    if (text === null) throw new ProjectError(404, `Website "${site}" not found`);
    versions[`${dir}/website.json`] = hash(text);
    let meta;
    try {
      meta = JSON.parse(text);
    } catch (e) {
      throw new ProjectError(422, `${dir}/website.json is not valid JSON: ${e.message}`, { file: `${dir}/website.json` });
    }
    const css = await readText(this.resolve(`${dir}/website.css`));
    if (css !== null) versions[`${dir}/website.css`] = hash(css);

    // Pages that exist on disk but aren't in the page tree are added at the end,
    // so a page folder created in VS Code shows up without editing website.json.
    const pages = normalizeTree(meta.pages);
    const listed = new Set(flattenTree(pages).map((n) => n.slug));
    for (const slug of await this.pageSlugs(site)) if (!listed.has(slug)) pages.push({ slug });

    const website = {
      id: meta.id ?? site,
      slug: site,
      name: meta.name ?? site,
      status: meta.status === 'published' ? 'published' : 'draft',
      templateId: meta.templateId ?? 'blank',
      homepage: meta.homepage && listed.has(meta.homepage) ? meta.homepage : (pages[0]?.slug ?? null),
      pages,
      theme: meta.theme ?? {},
      customCss: css ?? '',
      createdAt: meta.createdAt ?? new Date().toISOString(),
      updatedAt: meta.updatedAt ?? new Date().toISOString(),
    };
    return { website, versions };
  }

  websiteToFiles(website) {
    const dir = `websites/${website.slug}`;
    const files = {
      [`${dir}/website.json`]: json({
        id: website.id,
        name: website.name,
        status: website.status,
        templateId: website.templateId,
        homepage: website.homepage,
        pages: website.pages,
        theme: website.theme,
        createdAt: website.createdAt,
        updatedAt: website.updatedAt,
      }),
    };
    if (website.customCss?.trim()) files[`${dir}/website.css`] = website.customCss.endsWith('\n') ? website.customCss : website.customCss + '\n';
    return files;
  }

  async writeWebsite(website, { base = {}, force = false } = {}) {
    if (!isValidSlug(website.slug)) throw new ProjectError(400, 'Invalid website URL');
    const desired = this.websiteToFiles(website);
    const cssPath = `websites/${website.slug}/website.css`;
    const removals = !(cssPath in desired) && (await readText(this.resolve(cssPath))) !== null ? [cssPath] : [];
    await this.checkAndWrite(desired, removals, base, force);
    return this.readWebsite(website.slug);
  }

  async createWebsite(website) {
    if (!isValidSlug(website.slug)) throw new ProjectError(400, 'Invalid website URL');
    if ((await readText(this.resolve(`websites/${website.slug}/website.json`))) !== null) {
      throw new ProjectError(409, `A website already uses the URL "${website.slug}"`);
    }
    return this.writeWebsite(website, { force: true });
  }

  async deleteWebsite(site) {
    if (!isValidSlug(site)) throw new ProjectError(400, 'Invalid website URL');
    await fs.rm(this.resolve(`websites/${site}`), { recursive: true, force: true });
  }

  /**
   * Moves pages from the old flat layout (site/pages/<slug>/) into single-page
   * websites (site/websites/<slug>/pages/<slug>/). The page theme becomes the
   * website theme.
   */
  async migrateLegacyPages() {
    const entries = await fs.readdir(this.resolve('pages'), { withFileTypes: true }).catch(() => []);
    const moved = [];
    for (const e of entries) {
      if (!e.isDirectory() || !isValidSlug(e.name)) continue;
      const pageJson = this.resolve(`pages/${e.name}/page.json`);
      const text = await readText(pageJson);
      if (text === null) continue;
      let site = e.name;
      for (let i = 2; (await readText(this.resolve(`websites/${site}/website.json`))) !== null; i++) site = `${e.name}-${i}`;
      const meta = JSON.parse(text);
      const { theme = {}, status, ...rest } = meta;
      await fs.mkdir(this.resolve(`websites/${site}/pages`), { recursive: true });
      await fs.rename(this.resolve(`pages/${e.name}`), this.resolve(`websites/${site}/pages/${e.name}`));
      await writeText(this.resolve(`websites/${site}/pages/${e.name}/page.json`), json(rest));
      const now = new Date().toISOString();
      await writeText(
        this.resolve(`websites/${site}/website.json`),
        json({ id: `w_${site}`, name: meta.title ?? site, status: status ?? 'draft', templateId: meta.templateId ?? 'blank', homepage: e.name, pages: [{ slug: e.name }], theme, createdAt: meta.createdAt ?? now, updatedAt: now }),
      );
      moved.push(site);
    }
    // Remove the old folder once it's empty.
    if (moved.length) await fs.rmdir(this.resolve('pages')).catch(() => {});
    return moved;
  }

  // --- pages --------------------------------------------------------------------------------

  pageDir(site, slug) {
    return `websites/${site}/pages/${slug}`;
  }

  async pageSlugs(site) {
    const entries = await fs.readdir(this.resolve(`websites/${site}/pages`), { withFileTypes: true }).catch(() => []);
    const slugs = [];
    for (const e of entries) {
      if (e.isDirectory() && (await readText(this.resolve(`${this.pageDir(site, e.name)}/page.json`))) !== null) slugs.push(e.name);
    }
    return slugs.sort();
  }

  /** Reads a page into the editor's model plus the hash of every file it came from. */
  async readPage(site, slug) {
    const dir = this.pageDir(site, slug);
    const versions = {};
    const errors = [];
    const read = async (rel) => {
      const text = await readText(this.resolve(rel));
      if (text !== null) versions[rel] = hash(text);
      return text;
    };

    const pageText = await read(`${dir}/page.json`);
    if (pageText === null) throw new ProjectError(404, `Page "${slug}" not found`);
    let meta;
    try {
      meta = JSON.parse(pageText);
    } catch (e) {
      throw new ProjectError(422, `${dir}/page.json is not valid JSON: ${e.message}`, { file: `${dir}/page.json` });
    }

    const pageCss = await read(`${dir}/page.css`);
    // Listed sections first (in order), then any section files a developer added without listing them.
    const onDisk = (await fs.readdir(this.resolve(`${dir}/sections`)).catch(() => []))
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -5))
      .sort();
    const listed = Array.isArray(meta.sections) ? meta.sections : [];
    const names = [...listed.filter((n) => onDisk.includes(n)), ...onDisk.filter((n) => !listed.includes(n))];

    const sections = [];
    for (const name of names) {
      const rel = `${dir}/sections/${name}.json`;
      const text = await read(rel);
      try {
        const section = JSON.parse(text);
        const css = await read(`${dir}/sections/${name}.css`);
        section.style = { ...(section.style ?? {}) };
        if (css !== null) section.style.customCss = css;
        section.id ??= name;
        section.visible ??= true;
        section.data ??= {};
        sections.push(section);
      } catch (e) {
        errors.push({ file: rel, message: e.message });
      }
    }

    const page = {
      id: meta.id ?? `${site}/${slug}`,
      website: site,
      title: meta.title ?? slug,
      slug,
      templateId: meta.templateId ?? 'blank',
      seo: { metaTitle: '', metaDescription: '', ...(meta.seo ?? {}) },
      // The editor shows the website theme; a page can only add its own CSS (page.css).
      customCss: pageCss ?? '',
      sections,
      createdAt: meta.createdAt ?? new Date().toISOString(),
      updatedAt: meta.updatedAt ?? new Date().toISOString(),
    };
    return { page, versions, errors };
  }

  /** The files a page model is stored as: { relPath: content }. */
  pageToFiles(page) {
    const dir = this.pageDir(page.website, page.slug);
    const files = {};
    const names = [];
    for (const section of page.sections) {
      const name = sectionFileName(section);
      names.push(name);
      const { customCss, ...style } = section.style ?? {};
      const stored = { id: section.id, type: section.type, visible: section.visible, data: section.data, style };
      if (section.grid) stored.grid = section.grid;
      if (section.carousel) stored.carousel = section.carousel;
      if (section.elements && Object.keys(section.elements).length) stored.elements = section.elements;
      files[`${dir}/sections/${name}.json`] = json(stored);
      if (customCss?.trim()) files[`${dir}/sections/${name}.css`] = customCss.endsWith('\n') ? customCss : customCss + '\n';
    }
    files[`${dir}/page.json`] = json({
      id: page.id,
      title: page.title,
      templateId: page.templateId,
      seo: page.seo,
      sections: names,
      createdAt: page.createdAt,
      updatedAt: page.updatedAt,
    });
    const css = page.customCss ?? '';
    if (css.trim()) files[`${dir}/page.css`] = css.endsWith('\n') ? css : css + '\n';
    return files;
  }

  /** All files currently belonging to a page folder. */
  async pageFilesOnDisk(site, slug) {
    const dir = this.pageDir(site, slug);
    const out = [];
    for (const f of ['page.json', 'page.css']) if ((await readText(this.resolve(`${dir}/${f}`))) !== null) out.push(`${dir}/${f}`);
    for (const f of await fs.readdir(this.resolve(`${dir}/sections`)).catch(() => [])) {
      if (f.endsWith('.json') || f.endsWith('.css')) out.push(`${dir}/sections/${f}`);
    }
    return out;
  }

  /**
   * Writes `desired` files and removes `removals`. `base` holds the file hashes the
   * editor last saw; any file that changed on disk since then (and would now be
   * overwritten with different content) is reported as a conflict instead of being
   * written — unless `force` is set. Paths in `skipCheck` are written unconditionally.
   */
  async checkAndWrite(desired, removals, base, force, skipCheck = new Set()) {
    const conflicts = [];
    for (const rel of [...Object.keys(desired), ...removals]) {
      if (skipCheck.has(rel)) continue;
      const disk = await readText(this.resolve(rel));
      const diskHash = disk === null ? null : hash(disk);
      const mine = desired[rel] ?? null;
      if (diskHash !== (base[rel] ?? null) && disk !== mine) conflicts.push({ path: rel, disk, mine });
    }
    if (conflicts.length && !force) throw new ProjectError(409, 'Files changed on disk since you opened them', { conflicts });

    const written = [];
    for (const [rel, content] of Object.entries(desired)) {
      if ((await readText(this.resolve(rel))) === content) continue;
      await writeText(this.resolve(rel), content);
      written.push(rel);
    }
    for (const rel of removals) {
      await fs.rm(this.resolve(rel), { force: true });
      written.push(rel);
    }
    return written;
  }

  /** Writes a page (see checkAndWrite for conflicts). `overrides` replaces individual files' content when merging. */
  async writePage(page, { base = {}, force = false, overrides = {} } = {}) {
    if (!isValidSlug(page.slug) || !isValidSlug(page.website)) throw new ProjectError(400, 'Invalid page URL');
    if ((await readText(this.resolve(`websites/${page.website}/website.json`))) === null) throw new ProjectError(404, `Website "${page.website}" not found`);
    const desired = { ...this.pageToFiles(page) };
    for (const [rel, content] of Object.entries(overrides)) {
      if (content === null) delete desired[rel];
      else desired[rel] = content;
    }
    const existing = await this.pageFilesOnDisk(page.website, page.slug);
    const removals = existing.filter((rel) => !(rel in desired));
    const written = await this.checkAndWrite(desired, removals, base, force, new Set(Object.keys(overrides)));
    return { written, ...(await this.readPage(page.website, page.slug)) };
  }

  async createPage(page) {
    if (!isValidSlug(page.slug)) throw new ProjectError(400, 'Invalid page URL');
    if ((await readText(this.resolve(`${this.pageDir(page.website, page.slug)}/page.json`))) !== null) {
      throw new ProjectError(409, `A page already uses the URL "${page.slug}" in this website`);
    }
    return this.writePage(page, { force: true });
  }

  async renamePage(site, from, to) {
    if (!isValidSlug(to)) throw new ProjectError(400, 'Invalid page URL');
    if ((await readText(this.resolve(`${this.pageDir(site, to)}/page.json`))) !== null) throw new ProjectError(409, `A page already uses the URL "${to}"`);
    await fs.rename(this.resolve(this.pageDir(site, from)), this.resolve(this.pageDir(site, to)));
    return this.readPage(site, to);
  }

  async deletePage(site, slug) {
    if (!isValidSlug(slug) || !isValidSlug(site)) throw new ProjectError(400, 'Invalid page URL');
    await fs.rm(this.resolve(this.pageDir(site, slug)), { recursive: true, force: true });
  }

  // --- section library ------------------------------------------------------------------------

  /** Section presets from library/<category>/*.json (built-in presets and saved sections). */
  async library() {
    const root = this.resolve('library');
    const out = [];
    for (const cat of await fs.readdir(root, { withFileTypes: true }).catch(() => [])) {
      if (!cat.isDirectory()) continue;
      for (const f of (await fs.readdir(path.join(root, cat.name)).catch(() => [])).filter((n) => n.endsWith('.json')).sort()) {
        const rel = `library/${cat.name}/${f}`;
        try {
          const item = JSON.parse(await readText(this.resolve(rel)));
          out.push({ ...item, id: item.id ?? `${cat.name}/${f.slice(0, -5)}`, category: item.category ?? cat.name, file: rel });
        } catch {
          // Broken preset files are skipped; Developer Mode shows the JSON error.
        }
      }
    }
    return out;
  }

  // --- generic files (Developer Mode) --------------------------------------------------------

  async tree() {
    const out = [];
    const walk = async (absDir) => {
      const entries = await fs.readdir(absDir, { withFileTypes: true }).catch(() => []);
      for (const e of entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))) {
        if (e.name.startsWith('.') && e.name !== '.gitignore') continue;
        const abs = path.join(absDir, e.name);
        if (e.isDirectory()) {
          if (IGNORED_DIRS.has(e.name)) continue;
          out.push({ path: this.rel(abs), type: 'dir' });
          await walk(abs);
        } else {
          const stat = await fs.stat(abs);
          out.push({ path: this.rel(abs), type: 'file', size: stat.size });
        }
      }
    };
    await walk(this.root);
    return out;
  }

  async search(query, { regex = false, caseSensitive = false } = {}) {
    if (!query) return [];
    let re;
    try {
      re = new RegExp(regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? 'g' : 'gi');
    } catch (e) {
      throw new ProjectError(400, `Invalid regular expression: ${e.message}`);
    }
    const results = [];
    for (const entry of await this.tree()) {
      if (entry.type !== 'file' || entry.size > 1_000_000 || /\.(png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|mp4|pdf)$/i.test(entry.path)) continue;
      const text = await readText(this.resolve(entry.path));
      text?.split('\n').forEach((line, i) => {
        re.lastIndex = 0;
        if (re.test(line)) results.push({ path: entry.path, line: i + 1, text: line.slice(0, 240) });
      });
      if (results.length > 500) break;
    }
    return results;
  }
}
