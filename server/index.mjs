// Local/hosted project server for the landing-page CMS.
//
// It owns one site folder PER USER so the visual editor and VS Code edit the same files:
//   - email/password login (SQLite), with per-user data isolation and roles
//   - REST API for pages, files, assets, search, Git and static export
//   - Server-Sent Events (/api/events) announcing file changes for the signed-in user
//
// Website content lives on disk: data/users/<userId>/site/... (seeded from ./site).
// Accounts, sessions and form submissions live in SQLite: data/cms.db.
//
// Usage: node --experimental-sqlite server/index.mjs
// Env: CMS_DATA_DIR (default ./data), CMS_SEED_DIR (default ./site), CMS_PUBLIC_DIR
//      (built frontend to serve, default ./public), CMS_PORT (default 4310),
//      CMS_ALLOWED_HOSTS, CMS_SECURE_COOKIE=1 (set behind HTTPS),
//      ADMIN_EMAIL / ADMIN_PASSWORD (seed the first admin on startup).

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, realpathSync, watch } from 'node:fs';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { Db } from './db.mjs';
import { Git } from './git.mjs';
import { emailConfigured, sendEmail, setEmailConfig } from './mail.mjs';
import { IGNORED_DIRS, Project, ProjectError, hash, readText, toPosix, writeText } from './project.mjs';

const DATA_DIR = (() => {
  const dir = path.resolve(process.env.CMS_DATA_DIR ?? 'data');
  mkdirSync(path.join(dir, 'users'), { recursive: true });
  // Real, long-form path: Windows file watching asserts on 8.3 short names.
  return realpathSync.native(dir);
})();
const SEED_DIR = path.resolve(process.env.CMS_SEED_DIR ?? 'site');
const PUBLIC_DIR = path.resolve(process.env.CMS_PUBLIC_DIR ?? 'public');
const PORT = Number(process.env.CMS_PORT ?? 4310);
// Bind to localhost by default; set CMS_HOST=0.0.0.0 in a container (behind a reverse proxy).
const HOST = process.env.CMS_HOST ?? '127.0.0.1';
const SECURE_COOKIE = process.env.CMS_SECURE_COOKIE === '1';
const MAX_BODY = 25 * 1024 * 1024;

const db = new Db(path.join(DATA_DIR, 'cms.db'));

// Apply any email provider an admin saved via Platform Settings (falls back to env vars).
setEmailConfig(db.getEmailSettings());

// Seed an admin account on first boot so there's always a way in.
(() => {
  const email = process.env.ADMIN_EMAIL ?? 'admin@example.com';
  const password = process.env.ADMIN_PASSWORD ?? 'changeme';
  try {
    if (!db.getUserByEmail(email)) {
      db.createUser({ email, password, role: 'admin' });
      console.log(`Seeded admin account: ${email}` + (process.env.ADMIN_PASSWORD ? '' : ' (password "changeme" — change it!)'));
    }
  } catch (e) {
    console.error(`Could not seed the admin account (${email}): ${e.message}. Set valid ADMIN_EMAIL / ADMIN_PASSWORD.`);
  }
})();

/**
 * Resolves where a submission is emailed, most specific first:
 *   the contact section's "Send submissions to" → the website's notify email → the account email.
 * The recipient is always read from saved data, never from the submitted request.
 */
async function recipientFor(owner, site, pageSlug, sectionId) {
  const project = contextFor(owner.id).project;
  try {
    if (pageSlug && sectionId) {
      const { page } = await project.readPage(site, pageSlug);
      const section = page.sections.find((s) => s.id === sectionId);
      const email = section?.data?.notifyEmail?.trim();
      if (email) return email;
    }
  } catch {
    /* fall through to website/account */
  }
  const websiteEmail = (await project.readWebsite(site).catch(() => null))?.website?.notifyEmail?.trim();
  return websiteEmail || owner.email;
}

/** Emails `to` about a new submission through the platform provider (no-op if unconfigured). */
function notifySubmission(to, s) {
  if (!to || !emailConfigured()) return;
  const subject = `New submission on ${s.site || 'your site'}`;
  const text = [
    `New form submission on "${s.site || 'your site'}"${s.page ? ` (page: ${s.page})` : ''}.`,
    '',
    `Name:    ${s.name || '—'}`,
    `Email:   ${s.email || '—'}`,
    `Message: ${s.message || '—'}`,
  ].join('\n');
  // reply-to = the person who submitted, so the owner can reply to them directly.
  sendEmail({ to, subject, text, replyTo: s.email }).catch((e) => console.error(`Submission email to ${to} failed: ${e.message}`));
}

// One Project/Git per user, created on demand and cached.
const perUser = new Map();
function contextFor(userId) {
  if (!perUser.has(userId)) {
    const root = path.join(DATA_DIR, 'users', userId, 'site');
    perUser.set(userId, { project: new Project(root), git: new Git(root), root });
  }
  return perUser.get(userId);
}

/** Copies the seed site into a user's folder the first time they need it. */
async function ensureUserSite(userId) {
  const dest = path.join(DATA_DIR, 'users', userId, 'site');
  if (existsSync(dest)) {
    // Existing users get components and library presets added to the seed since their copy was made.
    // Files they already have are never overwritten, so their edits stay.
    if (existsSync(SEED_DIR)) {
      for (const dir of ['components', 'library']) {
        if (existsSync(path.join(SEED_DIR, dir))) await fs.cp(path.join(SEED_DIR, dir), path.join(dest, dir), { recursive: true, force: false, errorOnExist: false });
      }
    }
    return;
  }
  if (existsSync(SEED_DIR)) await fs.cp(SEED_DIR, dest, { recursive: true, filter: (src) => !src.includes(`${path.sep}dist`) });
  else mkdirSync(dest, { recursive: true });
}

const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.html': 'text/html; charset=utf-8',
  '.mp4': 'video/mp4', '.pdf': 'application/pdf',
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

const EXTRA_HOSTS = new Set((process.env.CMS_ALLOWED_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean));

function isAllowedHost(hostname) {
  const h = hostname.toLowerCase();
  return LOCAL_HOSTS.has(h) || /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || /^\[[0-9a-f:.]+\]$/.test(h) || EXTRA_HOSTS.has(h);
}

/**
 * The connection must reach 127.0.0.1 (directly or via a reverse proxy that sets the
 * upstream Host to localhost), the public address (X-Forwarded-Host) must be allowed,
 * Origin (when sent) must match, and writes must carry the X-CMS header. Auth on top of
 * this scopes every request to the signed-in user.
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

function send(res, status, body, headers = {}) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(data);
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function sessionCookie(token) {
  const parts = [`cms_session=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${30 * 24 * 60 * 60}`];
  if (SECURE_COOKIE) parts.push('Secure');
  return parts.join('; ');
}
const clearedCookie = `cms_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${SECURE_COOKIE ? '; Secure' : ''}`;

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

/** Serves the built Angular app (if CMS_PUBLIC_DIR exists), falling back to index.html for SPA routes. */
async function serveApp(req, res, pathname) {
  if (!existsSync(PUBLIC_DIR)) return send(res, 404, { error: 'Not found' });
  const rel = decodeURIComponent(pathname).replace(/^\/+/, '');
  const abs = path.resolve(PUBLIC_DIR, rel);
  if (abs !== PUBLIC_DIR && !abs.startsWith(PUBLIC_DIR + path.sep)) return send(res, 404, { error: 'Not found' });
  if (rel && existsSync(abs) && (await fs.stat(abs)).isFile()) return serveStatic(res, abs);
  return serveStatic(res, path.join(PUBLIC_DIR, 'index.html'));
}

async function projectSnapshot(project) {
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
    siteDir: project.root,
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

const clients = new Set(); // { res, userId }
const pending = new Map(); // userId -> Set(relPath)
let flushTimer = null;

function broadcast(userId, event) {
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const c of clients) if (c.userId === userId) c.res.write(line);
}

/** Parses data/users/<id>/site/<rel> paths and batches change events per user. */
function queueChange(relFromData) {
  if (!relFromData) return;
  const posix = toPosix(relFromData);
  const seg = posix.split('/');
  if (seg[0] !== 'users' || seg[2] !== 'site') return;
  const userId = seg[1];
  const rel = seg.slice(3).join('/');
  if (!rel) return;
  const top = rel.split('/')[0];
  if (IGNORED_DIRS.has(top) || /(^|\/)\.|~$|\.(swp|tmp)$/.test(rel)) return;
  if (!pending.has(userId)) pending.set(userId, new Set());
  pending.get(userId).add(rel);
  clearTimeout(flushTimer);
  flushTimer = setTimeout(async () => {
    for (const [userId, paths] of pending) {
      const root = path.join(DATA_DIR, 'users', userId, 'site');
      const changes = [];
      for (const p of paths) {
        const abs = path.join(root, p);
        const stat = await fs.stat(abs).catch(() => null);
        if (stat?.isDirectory()) continue;
        const text = stat ? await readText(abs).catch(() => null) : null;
        changes.push({ path: p, hash: text === null ? null : hash(text) });
      }
      if (changes.length) broadcast(userId, { type: 'change', changes });
    }
    pending.clear();
  }, 120);
}

// --- routes (handlers receive ctx = { project, git, user }) ------------------------------

const routes = [];
const route = (method, pattern, handler) => routes.push({ method, pattern, handler });

route('GET', /^\/api\/project$/, async (_req, _m, _url, ctx) => projectSnapshot(ctx.project));

const SLUG = '([a-z0-9][a-z0-9-]*)';
const siteRoute = (suffix = '') => new RegExp(`^/api/websites/${SLUG}${suffix}$`);
const pageRoute = (suffix = '') => new RegExp(`^/api/websites/${SLUG}/pages/${SLUG}${suffix}$`);

route('POST', /^\/api\/websites$/, async (req, _m, _url, { project }) => {
  const { website } = await readBody(req);
  return project.createWebsite(website);
});

route('GET', siteRoute(), async (_req, [site], _url, { project }) => project.readWebsite(site));

route('PUT', siteRoute(), async (req, [site], _url, { project }) => {
  const { website, base, force } = await readBody(req);
  if (website.slug !== site) throw new ProjectError(400, 'Website slug mismatch');
  return project.writeWebsite(website, { base, force: !!force });
});

route('DELETE', siteRoute(), async (_req, [site], _url, { project }) => {
  await project.deleteWebsite(site);
  return { ok: true };
});

route('GET', pageRoute(), async (_req, [site, slug], _url, { project }) => project.readPage(site, slug));

route('POST', siteRoute('/pages'), async (req, [site], _url, { project }) => {
  const { page } = await readBody(req);
  return project.createPage({ ...page, website: site });
});

route('PUT', pageRoute(), async (req, [site, slug], _url, { project }) => {
  const { page, base, force } = await readBody(req);
  if (page.slug !== slug || page.website !== site) throw new ProjectError(400, 'Page path mismatch; use the rename endpoint');
  return project.writePage(page, { base, force: !!force });
});

route('POST', pageRoute('/merge'), async (req, [site, slug], _url, { project }) => {
  const { page, overrides } = await readBody(req);
  if (page.slug !== slug || page.website !== site) throw new ProjectError(400, 'Page path mismatch');
  await project.writePage(page, { force: true, overrides: overrides ?? {} });
  return project.readPage(site, slug);
});

route('POST', pageRoute('/rename'), async (req, [site, slug], _url, { project }) => {
  const { to } = await readBody(req);
  return project.renamePage(site, slug, to);
});

route('DELETE', pageRoute(), async (_req, [site, slug], _url, { project }) => {
  await project.deletePage(site, slug);
  return { ok: true };
});

route('GET', /^\/api\/files$/, async (_req, _m, _url, { project }) => project.tree());

route('GET', /^\/api\/file$/, async (_req, _m, url, { project }) => {
  const rel = url.searchParams.get('path');
  const content = await readText(project.resolve(rel));
  if (content === null) throw new ProjectError(404, `${rel} not found`);
  return { path: rel, content, hash: hash(content) };
});

route('PUT', /^\/api\/file$/, async (req, _m, _url, { project }) => {
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

route('POST', /^\/api\/file$/, async (req, _m, _url, { project }) => {
  const { path: rel, content = '' } = await readBody(req);
  const abs = project.resolve(rel);
  if ((await readText(abs)) !== null) throw new ProjectError(409, `${rel} already exists`);
  await writeText(abs, content);
  return { path: rel, hash: hash(content) };
});

route('DELETE', /^\/api\/file$/, async (_req, _m, url, { project }) => {
  const rel = url.searchParams.get('path');
  if (!rel) throw new ProjectError(400, 'path is required');
  await fs.rm(project.resolve(rel), { recursive: true, force: true });
  return { ok: true };
});

route('GET', /^\/api\/search$/, async (_req, _m, url, { project }) =>
  project.search(url.searchParams.get('q') ?? '', {
    regex: url.searchParams.get('regex') === '1',
    caseSensitive: url.searchParams.get('case') === '1',
  }),
);

route('POST', /^\/api\/assets$/, async (req, _m, _url, { project }) => {
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

route('POST', /^\/api\/export$/, async (req, _m, _url, { project }) => {
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
  for (const { site, slug, dir } of pages ?? []) {
    const src = project.resolve(`${project.pageDir(site, slug)}/page.js`);
    const out = path.resolve(dist, dir);
    if (!out.startsWith(dist)) continue;
    if ((await readText(src)) !== null) await fs.cp(src, path.join(out, 'page.js'), { force: true });
  }
  return { ok: true, dir: path.join(project.root, 'dist') };
});

route('POST', /^\/api\/open$/, async (req, _m, _url, { project }) => {
  const { path: rel } = await readBody(req);
  const target = rel ? project.resolve(rel) : project.root;
  const win = process.platform === 'win32';
  if (win && /["%^&|<>]/.test(target)) throw new ProjectError(400, 'Path contains characters that cannot be passed to VS Code');
  const quote = (a) => (win ? `"${a}"` : a);
  const args = rel ? ['--goto', quote(target)] : [quote(project.root)];
  await new Promise((resolve, reject) => {
    const child = spawn('code', args, { shell: win, detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => reject(new ProjectError(400, 'Could not start VS Code. Is the "code" command on your PATH?')));
    child.on('spawn', resolve);
    child.unref();
  });
  return { ok: true, path: target };
});

// Git (per user)
route('GET', /^\/api\/git\/status$/, async (_req, _m, _url, { git }) => git.status());
route('GET', /^\/api\/git\/log$/, async (_req, _m, _url, { git }) => git.log());
route('GET', /^\/api\/git\/branches$/, async (_req, _m, _url, { git }) => git.branches());
route('GET', /^\/api\/git\/diff$/, async (_req, _m, url, { git }) => ({ diff: await git.diff(url.searchParams.get('path')) }));
route('GET', /^\/api\/git\/show$/, async (_req, _m, url, { git }) => ({ content: await git.show(url.searchParams.get('path'), url.searchParams.get('ref') ?? 'HEAD') }));
route('POST', /^\/api\/git\/commit$/, async (req, _m, _url, { git }) => ({ summary: await git.commit((await readBody(req)).message) }));
route('POST', /^\/api\/git\/branch$/, async (req, _m, _url, { git }) => {
  const { name } = await readBody(req);
  await git.createBranch(name, true);
  return git.branches();
});
route('POST', /^\/api\/git\/switch$/, async (req, _m, _url, { git }) => {
  await git.switchBranch((await readBody(req)).name);
  return git.branches();
});
route('POST', /^\/api\/git\/revert$/, async (req, _m, _url, { git }) => {
  await git.revert((await readBody(req)).path);
  return { ok: true };
});

// Form submissions (owner reads their own; see public POST /api/submit below)
route('GET', /^\/api\/submissions$/, async (_req, _m, _url, { user }) => ({ submissions: db.listSubmissions(user.id) }));
route('DELETE', /^\/api\/submissions\/([a-z0-9_]+)$/, async (_req, [id], _url, { user }) => {
  db.deleteSubmission(user.id, id);
  return { ok: true };
});

// Account: the signed-in user changes their own password
route('POST', /^\/api\/account\/password$/, async (req, _m, _url, { user }) => {
  const { currentPassword, newPassword } = await readBody(req);
  if (!db.verifyUserPassword(user.id, currentPassword ?? '')) throw new ProjectError(400, 'Current password is incorrect');
  db.updatePassword(user.id, newPassword ?? '');
  return { ok: true };
});

// Account: the signed-in user sets or clears their own mobile number
route('POST', /^\/api\/account\/phone$/, async (req, _m, _url, { user }) => {
  const { phone } = await readBody(req);
  try {
    db.updatePhone(user.id, phone);
  } catch (e) {
    throw new ProjectError(400, e.message);
  }
  return { user: db.publicUser(db.getUserById(user.id)) };
});

// Admin-only: user management
const requireAdmin = (user) => {
  if (user.role !== 'admin') throw new ProjectError(403, 'Admins only');
};

route('GET', /^\/api\/admin\/users$/, async (_req, _m, _url, { user }) => {
  requireAdmin(user);
  return { users: db.listUsers() };
});

// Platform email settings (admin-only). Secrets (API key, SMTP password) are never sent back.
route('GET', /^\/api\/admin\/settings$/, async (_req, _m, _url, { user }) => {
  requireAdmin(user);
  const e = db.getEmailSettings();
  return {
    email: {
      provider: e.provider,
      from: e.from,
      hasApiKey: !!e.apiKey,
      smtp: { host: e.smtp.host, port: e.smtp.port, secure: e.smtp.secure, user: e.smtp.user, hasPassword: !!e.smtp.pass },
    },
    active: emailConfigured(),
  };
});

route('PUT', /^\/api\/admin\/settings$/, async (req, _m, _url, { user }) => {
  requireAdmin(user);
  const { provider, from, apiKey, smtp } = await readBody(req);
  if (provider && !['smtp', 'resend', 'sendgrid'].includes(provider)) throw new ProjectError(400, 'Provider must be "smtp", "resend" or "sendgrid"');
  db.setSetting('email_provider', provider ?? '');
  db.setSetting('email_from', from ?? '');
  // API providers: a blank key keeps the saved one.
  if (apiKey && String(apiKey).trim()) db.setSetting('email_api_key', String(apiKey).trim());
  // SMTP: save connection details; a blank password keeps the saved one.
  if (smtp) {
    db.setSetting('email_smtp_host', smtp.host ?? '');
    db.setSetting('email_smtp_port', String(Number(smtp.port) || 587));
    db.setSetting('email_smtp_secure', smtp.secure ? '1' : '');
    db.setSetting('email_smtp_user', smtp.user ?? '');
    if (smtp.pass && String(smtp.pass).trim()) db.setSetting('email_smtp_pass', String(smtp.pass));
  }
  setEmailConfig(db.getEmailSettings()); // apply immediately — no restart
  return { ok: true, active: emailConfigured() };
});

route('POST', /^\/api\/admin\/users$/, async (req, _m, _url, { user }) => {
  requireAdmin(user);
  const { email, password, role, phone } = await readBody(req);
  const created = db.createUser({ email, password, phone, role: role === 'admin' ? 'admin' : 'user' });
  return { user: created };
});

route('PUT', /^\/api\/admin\/users\/([a-z0-9_]+)\/role$/, async (req, [id], _url, { user }) => {
  requireAdmin(user);
  const { role } = await readBody(req);
  const target = db.getUserById(id);
  if (!target) throw new ProjectError(404, 'User not found');
  if (role !== 'admin' && role !== 'user') throw new ProjectError(400, 'Role must be "user" or "admin"');
  // Don't let the last admin demote themselves and lock everyone out.
  if (target.role === 'admin' && role === 'user' && db.countAdmins() <= 1) throw new ProjectError(400, 'There must be at least one admin');
  db.setRole(id, role);
  return { ok: true };
});

route('DELETE', /^\/api\/admin\/users\/([a-z0-9_]+)$/, async (_req, [id], _url, { user }) => {
  requireAdmin(user);
  const target = db.getUserById(id);
  if (!target) throw new ProjectError(404, 'User not found');
  if (id === user.id) throw new ProjectError(400, 'You cannot delete your own account');
  if (target.role === 'admin' && db.countAdmins() <= 1) throw new ProjectError(400, 'There must be at least one admin');
  db.deleteUser(id);
  // The user's website files are left on disk under data/users/<id>/ (removed manually if desired).
  return { ok: true };
});

/** Admin resets a user's password: generates a temporary one, signs them out everywhere, and returns it once. */
route('POST', /^\/api\/admin\/users\/([a-z0-9_]+)\/password$/, async (_req, [id], _url, { user }) => {
  requireAdmin(user);
  const target = db.getUserById(id);
  if (!target) throw new ProjectError(404, 'User not found');
  // 10 unambiguous characters (no 0/O/1/l/I) the admin can read out or paste.
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(10);
  const password = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
  db.updatePassword(id, password);
  db.deleteUserSessions(id); // force re-login with the new password
  return { email: target.email, password };
});

// --- server -------------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const denied = checkRequest(req);
  if (denied) return send(res, 403, { error: denied });

  const user = db.getSessionUser(parseCookies(req).cms_session);

  // --- auth routes (no session required) ---
  if (url.pathname.startsWith('/api/auth/')) {
    try {
      if (req.method === 'POST' && url.pathname === '/api/auth/register') {
        const { email, password, phone } = await readBody(req);
        const created = db.createUser({ email, password, phone, role: 'user' });
        await ensureUserSite(created.id);
        const token = db.createSession(created.id);
        return send(res, 200, { user: created }, { 'Set-Cookie': sessionCookie(token) });
      }
      if (req.method === 'POST' && url.pathname === '/api/auth/login') {
        // `identifier` may be an email or a mobile number; `email` kept for older clients.
        const { identifier, email, password } = await readBody(req);
        const authed = db.authenticate(identifier ?? email, password);
        if (!authed) return send(res, 401, { error: 'Wrong email/mobile or password' });
        await ensureUserSite(authed.id);
        const token = db.createSession(authed.id);
        return send(res, 200, { user: authed }, { 'Set-Cookie': sessionCookie(token) });
      }
      if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
        db.deleteSession(parseCookies(req).cms_session);
        return send(res, 200, { ok: true }, { 'Set-Cookie': clearedCookie });
      }
      if (req.method === 'GET' && url.pathname === '/api/auth/me') {
        return send(res, 200, { user: user ?? null });
      }
    } catch (e) {
      const status = e instanceof ProjectError ? e.status : 400;
      return send(res, status, { error: e.message });
    }
    return send(res, 404, { error: 'Not found' });
  }

  // --- public: form submissions from published pages ---
  if (req.method === 'POST' && url.pathname === '/api/submit') {
    try {
      const { ownerId, site, pageSlug, sectionId, page, name, email, message } = await readBody(req);
      // The owner is the explicit ownerId (external published pages) or the signed-in
      // user (a form submitted while viewing one's own site inside the app).
      const owner = ownerId ? db.getUserById(ownerId) : user ? db.getUserById(user.id) : null;
      if (!owner) return send(res, 400, { error: 'Unknown site owner' });
      db.addSubmission({ ownerId: owner.id, site, page, name, email, message });
      notifySubmission(await recipientFor(owner, site, pageSlug, sectionId), { site, page, name, email, message });
      return send(res, 200, { ok: true });
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
  }

  // --- public static assets (previews, published assets) ---
  if (req.method === 'GET' && url.pathname.startsWith('/site/')) {
    if (!user) return send(res, 401, { error: 'Not signed in' });
    const rel = decodeURIComponent(url.pathname.slice('/site/'.length));
    if (!/^(assets|dist|scripts)\//.test(rel)) return send(res, 404, { error: 'Not found' });
    try {
      return await serveStatic(res, contextFor(user.id).project.resolve(rel));
    } catch {
      return send(res, 404, { error: 'Not found' });
    }
  }

  // --- everything else under /api requires a session ---
  if (url.pathname.startsWith('/api/')) {
    if (!user) return send(res, 401, { error: 'Not signed in' });

    // Admins may view another user's project by passing their id (header for fetch,
    // ?as= for the EventSource which can't set headers). The project context becomes
    // that user's; ctx.user stays the real admin so admin-only routes still work.
    let owner = user;
    const asId = String(req.headers['x-cms-as'] ?? url.searchParams.get('as') ?? '').trim();
    if (asId && asId !== user.id) {
      if (user.role !== 'admin') return send(res, 403, { error: 'Admins only' });
      const target = db.getUserById(asId);
      if (!target) return send(res, 404, { error: 'User not found' });
      owner = db.publicUser(target);
    }

    await ensureUserSite(owner.id);
    const ctx = { ...contextFor(owner.id), user };

    if (url.pathname === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify({ type: 'hello', siteDir: ctx.root })}\n\n`);
      // Register under the viewed project's id so its file changes reach this stream.
      const client = { res, userId: owner.id };
      clients.add(client);
      const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
      req.on('close', () => {
        clearInterval(ping);
        clients.delete(client);
      });
      return;
    }

    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.pattern.exec(url.pathname);
      if (!m) continue;
      try {
        return send(res, 200, await r.handler(req, m.slice(1), url, ctx));
      } catch (e) {
        const status = e instanceof ProjectError ? e.status : 500;
        if (status === 500) console.error(e);
        return send(res, status, { error: e.message, ...(e.extra ?? {}) });
      }
    }
    return send(res, 404, { error: 'Not found' });
  }

  // --- built frontend (SPA) ---
  if (req.method === 'GET' || req.method === 'HEAD') return serveApp(req, res, url.pathname);
  send(res, 404, { error: 'Not found' });
});

watch(DATA_DIR, { recursive: true }, (_event, filename) => queueChange(filename?.toString())).on('error', (e) =>
  console.error('File watching stopped:', e.message),
);

server.listen(PORT, HOST, () => {
  console.log(`CMS project server: http://${HOST}:${PORT}`);
  console.log(`Data folder:        ${DATA_DIR}`);
});
