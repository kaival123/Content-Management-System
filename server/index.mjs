// Local project server for the landing-page CMS.
//
// It owns the site/ folder so the visual editor and VS Code edit the same files:
//   - REST API for pages, files, assets, search, Git and static export
//   - Server-Sent Events (/api/events) announcing every file change on disk
//
// Usage: node server/index.mjs   (env: CMS_SITE_DIR, CMS_PORT)
// Listens on 127.0.0.1 only; see checkRequest() for how browsers on other sites are kept out.

import { spawn } from 'node:child_process';
import { mkdirSync, realpathSync, watch } from 'node:fs';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { Git } from './git.mjs';
import { IGNORED_DIRS, Project, ProjectError, hash, readText, toPosix, writeText } from './project.mjs';

// Real, long-form path: Windows file watching asserts on 8.3 short names (e.g. KAIVAL~1).
const SITE_DIR = (() => {
  const dir = path.resolve(process.env.CMS_SITE_DIR ?? 'site');
  mkdirSync(dir, { recursive: true });
  return realpathSync.native(dir);
})();
const PORT = Number(process.env.CMS_PORT ?? 4310);
const MAX_BODY = 25 * 1024 * 1024;

const project = new Project(SITE_DIR);
const git = new Git(SITE_DIR);

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
};

// --- security ---------------------------------------------------------------------------

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function hostnameOf(value) {
  try {
    return new URL(value.includes('://') ? value : `http://${value}`).hostname;
  } catch {
    return '';
  }
}

/** Extra host names allowed to reach the CMS (comma-separated), e.g. CMS_ALLOWED_HOSTS=cms.local */
const EXTRA_HOSTS = new Set((process.env.CMS_ALLOWED_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean));

/**
 * Addresses the CMS may be opened from: localhost, IP addresses (e.g. 172.20.18.54 when
 * `ng serve --host 0.0.0.0` is used on a LAN) and explicitly allowed names. Arbitrary
 * domain names are refused because that is how DNS-rebinding attacks reach local servers.
 */
function isAllowedHost(hostname) {
  const h = hostname.toLowerCase();
  return LOCAL_HOSTS.has(h) || /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || /^\[[0-9a-f:.]+\]$/.test(h) || EXTRA_HOSTS.has(h);
}

/**
 * This server can write files, so only the CMS itself may call it:
 * - the connection must come to 127.0.0.1 (directly or via the dev-server proxy),
 * - the address the CMS was opened at (Host, or X-Forwarded-Host through the proxy)
 *   must be localhost, an IP address or an allowed name (defeats DNS rebinding),
 * - Origin, when sent, must be that same address (defeats other websites),
 * - state-changing requests must carry X-CMS, a custom header that forces a CORS
 *   preflight which this server never approves.
 */
function checkRequest(req) {
  if (!LOCAL_HOSTS.has(hostnameOf(req.headers.host ?? ''))) return 'Bad host';
  const forwarded = String(req.headers['x-forwarded-host'] ?? '').split(',')[0].trim();
  const openedAt = forwarded || req.headers.host;
  if (!isAllowedHost(hostnameOf(openedAt))) {
    return `The CMS was opened at "${hostnameOf(openedAt)}". Use localhost or an IP address, or add the name to CMS_ALLOWED_HOSTS.`;
  }
  if (req.headers.origin) {
    const origin = hostnameOf(req.headers.origin);
    if (origin !== hostnameOf(openedAt) && !LOCAL_HOSTS.has(origin)) return 'Bad origin';
  }
  if (!['GET', 'HEAD'].includes(req.method) && req.headers['x-cms'] !== '1') return 'Missing X-CMS header';
  return null;
}

// --- helpers ------------------------------------------------------------------------------

function send(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(data);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new ProjectError(413, 'Request too large');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ProjectError(400, 'Invalid JSON body');
  }
}

async function serveStatic(res, absFile) {
  try {
    const data = await fs.readFile(absFile);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(absFile).toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch {
    send(res, 404, { error: 'Not found' });
  }
}

async function projectSnapshot() {
  const websites = [];
  const errors = [];
  for (const site of await project.websiteSlugs()) {
    try {
      const { website, versions } = await project.readWebsite(site);
      const pages = [];
      for (const slug of await project.pageSlugs(site)) {
        try {
          pages.push(await project.readPage(site, slug));
        } catch (e) {
          errors.push({ slug: `${site}/${slug}`, message: e.message, file: e.extra?.file });
        }
      }
      websites.push({ website, versions, pages });
    } catch (e) {
      errors.push({ slug: site, message: e.message, file: e.extra?.file });
    }
  }
  return {
    siteDir: SITE_DIR,
    config: await project.config(),
    baseCss: await project.baseCss(),
    components: await project.components(),
    templates: await project.templates(),
    library: await project.library(),
    websites,
    pageErrors: errors,
  };
}

// --- file watching + events -------------------------------------------------------------

const clients = new Set();
const pending = new Map();
let flushTimer = null;

function broadcast(event) {
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) res.write(line);
}

/** Batches watcher events and announces each changed file with its new content hash. */
function queueChange(rel) {
  if (!rel) return;
  const posix = toPosix(rel);
  const top = posix.split('/')[0];
  if (IGNORED_DIRS.has(top) || /(^|\/)\.|~$|\.(swp|tmp)$/.test(posix)) return;
  pending.set(posix, true);
  clearTimeout(flushTimer);
  flushTimer = setTimeout(async () => {
    const changes = [];
    for (const p of pending.keys()) {
      const abs = path.join(SITE_DIR, p);
      const stat = await fs.stat(abs).catch(() => null);
      if (stat?.isDirectory()) continue;
      const text = stat ? await readText(abs).catch(() => null) : null;
      changes.push({ path: p, hash: text === null ? null : hash(text) });
    }
    pending.clear();
    if (changes.length) broadcast({ type: 'change', changes });
  }, 120);
}

// --- routes -----------------------------------------------------------------------------

const routes = [];
const route = (method, pattern, handler) => routes.push({ method, pattern, handler });

route('GET', /^\/api\/project$/, async () => projectSnapshot());

const SLUG = '([a-z0-9][a-z0-9-]*)';
const siteRoute = (suffix = '') => new RegExp(`^/api/websites/${SLUG}${suffix}$`);
const pageRoute = (suffix = '') => new RegExp(`^/api/websites/${SLUG}/pages/${SLUG}${suffix}$`);

route('POST', /^\/api\/websites$/, async (req) => {
  const { website } = await readBody(req);
  return project.createWebsite(website);
});

route('GET', siteRoute(), async (_req, [site]) => project.readWebsite(site));

route('PUT', siteRoute(), async (req, [site]) => {
  const { website, base, force } = await readBody(req);
  if (website.slug !== site) throw new ProjectError(400, 'Website slug mismatch');
  return project.writeWebsite(website, { base, force: !!force });
});

route('DELETE', siteRoute(), async (_req, [site]) => {
  await project.deleteWebsite(site);
  return { ok: true };
});

route('GET', pageRoute(), async (_req, [site, slug]) => project.readPage(site, slug));

route('POST', siteRoute('/pages'), async (req, [site]) => {
  const { page } = await readBody(req);
  return project.createPage({ ...page, website: site });
});

route('PUT', pageRoute(), async (req, [site, slug]) => {
  const { page, base, force } = await readBody(req);
  if (page.slug !== slug || page.website !== site) throw new ProjectError(400, 'Page path mismatch; use the rename endpoint');
  return project.writePage(page, { base, force: !!force });
});

/** Resolves a conflict: writes the editor's page, but takes chosen files' content from `overrides`. */
route('POST', pageRoute('/merge'), async (req, [site, slug]) => {
  const { page, overrides } = await readBody(req);
  if (page.slug !== slug || page.website !== site) throw new ProjectError(400, 'Page path mismatch');
  await project.writePage(page, { force: true, overrides: overrides ?? {} });
  // Re-read so files chosen from disk are reflected in the returned model.
  return project.readPage(site, slug);
});

route('POST', pageRoute('/rename'), async (req, [site, slug]) => {
  const { to } = await readBody(req);
  return project.renamePage(site, slug, to);
});

route('DELETE', pageRoute(), async (_req, [site, slug]) => {
  await project.deletePage(site, slug);
  return { ok: true };
});

route('GET', /^\/api\/files$/, async () => project.tree());

route('GET', /^\/api\/file$/, async (_req, _m, url) => {
  const rel = url.searchParams.get('path');
  const content = await readText(project.resolve(rel));
  if (content === null) throw new ProjectError(404, `${rel} not found`);
  return { path: rel, content, hash: hash(content) };
});

/** Saves a file. With `base`, refuses to overwrite a file that changed on disk since it was opened. */
route('PUT', /^\/api\/file$/, async (req) => {
  const { path: rel, content, base, force } = await readBody(req);
  if (typeof content !== 'string') throw new ProjectError(400, 'content must be a string');
  const abs = project.resolve(rel);
  const disk = await readText(abs);
  if (!force && base !== undefined && (disk === null ? null : hash(disk)) !== base && disk !== content) {
    throw new ProjectError(409, `${rel} changed on disk`, { disk, diskHash: disk === null ? null : hash(disk) });
  }
  await writeText(abs, content);
  return { path: rel, hash: hash(content) };
});

route('POST', /^\/api\/file$/, async (req) => {
  const { path: rel, content = '' } = await readBody(req);
  const abs = project.resolve(rel);
  if ((await readText(abs)) !== null) throw new ProjectError(409, `${rel} already exists`);
  await writeText(abs, content);
  return { path: rel, hash: hash(content) };
});

route('DELETE', /^\/api\/file$/, async (_req, _m, url) => {
  const rel = url.searchParams.get('path');
  if (!rel) throw new ProjectError(400, 'path is required');
  await fs.rm(project.resolve(rel), { recursive: true, force: true });
  return { ok: true };
});

route('GET', /^\/api\/search$/, async (_req, _m, url) =>
  project.search(url.searchParams.get('q') ?? '', {
    regex: url.searchParams.get('regex') === '1',
    caseSensitive: url.searchParams.get('case') === '1',
  }),
);

/** Stores an uploaded image under assets/images/ and returns its project-relative path. */
route('POST', /^\/api\/assets$/, async (req) => {
  const { name = 'image', dataUrl } = await readBody(req);
  const m = /^data:(image\/(png|jpeg|gif|webp|avif|svg\+xml));base64,(.+)$/.exec(dataUrl ?? '');
  if (!m) throw new ProjectError(400, 'Unsupported image');
  const ext = { 'image/jpeg': 'jpg', 'image/svg+xml': 'svg' }[m[1]] ?? m[2];
  const buf = Buffer.from(m[3], 'base64');
  const base = String(name).replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'image';
  const rel = `assets/images/${base}-${hash(buf).slice(0, 8)}.${ext}`;
  await fs.mkdir(path.dirname(project.resolve(rel)), { recursive: true });
  await fs.writeFile(project.resolve(rel), buf);
  return { path: rel };
});

/** Writes a static build (HTML rendered by the editor) into dist/ and copies assets and scripts. */
route('POST', /^\/api\/export$/, async (req) => {
  const { files, clean, pages } = await readBody(req);
  const dist = project.resolve('dist');
  if (clean) await fs.rm(dist, { recursive: true, force: true });
  for (const f of files ?? []) {
    const abs = path.resolve(dist, f.path);
    if (!abs.startsWith(dist + path.sep)) throw new ProjectError(400, 'Invalid export path');
    await writeText(abs, f.content);
  }
  for (const dir of ['assets', 'scripts']) {
    await fs.cp(project.resolve(dir), path.join(dist, dir), { recursive: true, force: true }).catch(() => {});
  }
  // Page-specific scripts: websites/<site>/pages/<slug>/page.js → dist/<output dir>/page.js
  for (const { site, slug, dir } of pages ?? []) {
    const src = project.resolve(`${project.pageDir(site, slug)}/page.js`);
    const out = path.resolve(dist, dir);
    if (!out.startsWith(dist)) continue;
    if ((await readText(src)) !== null) await fs.cp(src, path.join(out, 'page.js'), { force: true });
  }
  return { ok: true, dir: path.join(SITE_DIR, 'dist') };
});

/** Opens the project (or a file in it) in VS Code, if the `code` command is installed. */
route('POST', /^\/api\/open$/, async (req) => {
  const { path: rel } = await readBody(req);
  const target = rel ? project.resolve(rel) : SITE_DIR;
  const win = process.platform === 'win32';
  // On Windows `code` is a .cmd script, which needs a shell; quote paths and refuse
  // characters cmd.exe would interpret.
  if (win && /["%^&|<>]/.test(target)) throw new ProjectError(400, 'Path contains characters that cannot be passed to VS Code');
  const quote = (a) => (win ? `"${a}"` : a);
  const args = rel ? ['--goto', quote(target)] : [quote(SITE_DIR)];
  await new Promise((resolve, reject) => {
    const child = spawn('code', args, { shell: win, detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => reject(new ProjectError(400, 'Could not start VS Code. Is the "code" command on your PATH?')));
    child.on('spawn', resolve);
    child.unref();
  });
  return { ok: true, path: target };
});

route('GET', /^\/api\/git\/status$/, async () => git.status());
route('GET', /^\/api\/git\/log$/, async () => git.log());
route('GET', /^\/api\/git\/branches$/, async () => git.branches());
route('GET', /^\/api\/git\/diff$/, async (_req, _m, url) => ({ diff: await git.diff(url.searchParams.get('path')) }));
route('GET', /^\/api\/git\/show$/, async (_req, _m, url) => ({ content: await git.show(url.searchParams.get('path'), url.searchParams.get('ref') ?? 'HEAD') }));
route('POST', /^\/api\/git\/commit$/, async (req) => ({ summary: await git.commit((await readBody(req)).message) }));
route('POST', /^\/api\/git\/branch$/, async (req) => {
  const { name } = await readBody(req);
  await git.createBranch(name, true);
  return git.branches();
});
route('POST', /^\/api\/git\/switch$/, async (req) => {
  await git.switchBranch((await readBody(req)).name);
  return git.branches();
});
route('POST', /^\/api\/git\/revert$/, async (req) => {
  await git.revert((await readBody(req)).path);
  return { ok: true };
});

// --- server -------------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const denied = checkRequest(req);
  if (denied) return send(res, 403, { error: denied });

  if (url.pathname === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify({ type: 'hello', siteDir: SITE_DIR })}\n\n`);
    clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => {
      clearInterval(ping);
      clients.delete(res);
    });
    return;
  }

  // Project files served for previews: /site/assets/..., /site/dist/...
  if (req.method === 'GET' && url.pathname.startsWith('/site/')) {
    const rel = decodeURIComponent(url.pathname.slice('/site/'.length));
    if (!/^(assets|dist|scripts)\//.test(rel)) return send(res, 404, { error: 'Not found' });
    try {
      return await serveStatic(res, project.resolve(rel));
    } catch {
      return send(res, 404, { error: 'Not found' });
    }
  }

  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = r.pattern.exec(url.pathname);
    if (!m) continue;
    try {
      return send(res, 200, await r.handler(req, m.slice(1), url));
    } catch (e) {
      const status = e instanceof ProjectError ? e.status : 500;
      if (status === 500) console.error(e);
      return send(res, status, { error: e.message, ...(e.extra ?? {}) });
    }
  }
  send(res, 404, { error: 'Not found' });
});

const migrated = await project.migrateLegacyPages();
if (migrated.length) console.log(`Moved ${migrated.length} page(s) from site/pages/ into site/websites/: ${migrated.join(', ')}`);

watch(SITE_DIR, { recursive: true }, (_event, filename) => queueChange(filename?.toString())).on('error', (e) =>
  console.error('File watching stopped:', e.message),
);

server.listen(PORT, '127.0.0.1', () => {
  console.log(`CMS project server: http://127.0.0.1:${PORT}`);
  console.log(`Project folder:     ${SITE_DIR}`);
});
