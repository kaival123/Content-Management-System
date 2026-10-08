// End-to-end API tests: boots the real server against a temp data dir and exercises
// every endpoint, including auth, per-user isolation, roles and security checks.
// Run: node --experimental-sqlite --test server/api.test.mjs

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4000 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN = { email: 'admin@example.com', password: 'adminpw1' };

let child;
let dataDir;

/** A tiny cookie-aware HTTP client (Node fetch doesn't persist cookies). */
function makeClient() {
  let cookie = '';
  async function call(method, pathname, body, extraHeaders = {}) {
    const headers = { 'X-CMS': '1', ...extraHeaders };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (cookie) headers['Cookie'] = cookie;
    const res = await fetch(BASE + pathname, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { status: res.status, data };
  }
  return {
    get: (p, h) => call('GET', p, undefined, h),
    post: (p, b, h) => call('POST', p, b, h),
    put: (p, b, h) => call('PUT', p, b, h),
    del: (p, b, h) => call('DELETE', p, b, h),
  };
}

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'cms-api-'));
  child = spawn(process.execPath, ['--experimental-sqlite', path.join(here, 'index.mjs')], {
    env: {
      ...process.env,
      CMS_PORT: String(PORT),
      CMS_DATA_DIR: dataDir,
      CMS_SEED_DIR: path.join(here, '..', 'site'),
      ADMIN_EMAIL: ADMIN.email,
      ADMIN_PASSWORD: ADMIN.password,
    },
    stdio: 'ignore',
  });
  // Wait until the server answers.
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${BASE}/api/auth/me`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
});

after(async () => {
  child?.kill();
  // Windows keeps the SQLite file locked briefly after the process exits; retry the cleanup.
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 300));
    try {
      rmSync(dataDir, { recursive: true, force: true });
      break;
    } catch {
      /* still locked; retry */
    }
  }
});

describe('security + auth gating', () => {
  test('unauthenticated data call is 401', async () => {
    const c = makeClient();
    assert.equal((await c.get('/api/project')).status, 401);
  });
  test('writes without X-CMS header are 403', async () => {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ADMIN),
    });
    assert.equal(res.status, 403);
  });
  test('wrong password is 401', async () => {
    const c = makeClient();
    assert.equal((await c.post('/api/auth/login', { email: ADMIN.email, password: 'nope' })).status, 401);
  });
  test('me returns null when signed out', async () => {
    const c = makeClient();
    assert.deepEqual((await c.get('/api/auth/me')).data, { user: null });
  });
});

describe('mobile number login', () => {
  test('register with a mobile number, then log in with it', async () => {
    const reg = makeClient();
    const r = await reg.post('/api/auth/register', { email: 'mobile@example.com', password: 'mobile11', phone: '+1 555 987 6543' });
    assert.equal(r.status, 200);
    assert.equal(r.data.user.phone, '+15559876543');

    // Log in by email…
    const byEmail = makeClient();
    assert.equal((await byEmail.post('/api/auth/login', { identifier: 'mobile@example.com', password: 'mobile11' })).status, 200);
    // …and by mobile number.
    const byPhone = makeClient();
    assert.equal((await byPhone.post('/api/auth/login', { identifier: '+15559876543', password: 'mobile11' })).status, 200);
    // Wrong password still fails.
    assert.equal((await makeClient().post('/api/auth/login', { identifier: '+15559876543', password: 'nope' })).status, 401);
  });
});

describe('admin lifecycle: login, project, websites, pages, files', () => {
  const admin = makeClient();
  let siteSlug = 'test-site';

  test('admin logs in', async () => {
    const r = await admin.post('/api/auth/login', ADMIN);
    assert.equal(r.status, 200);
    assert.equal(r.data.user.role, 'admin');
  });

  test('project snapshot loads seeded components/templates', async () => {
    const r = await admin.get('/api/project');
    assert.equal(r.status, 200);
    assert.ok(r.data.components.length > 0, 'components seeded');
    assert.ok(r.data.templates.length > 0, 'templates seeded');
    assert.equal(r.data.websites.length, 0);
  });

  test('creates a website', async () => {
    const r = await admin.post('/api/websites', {
      website: { id: 'w1', slug: siteSlug, name: 'Test Site', status: 'draft', templateId: 'blank', homepage: 'home', pages: [{ slug: 'home' }], theme: {}, customCss: '' },
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.website.slug, siteSlug);
  });

  test('reads the website back', async () => {
    const r = await admin.get(`/api/websites/${siteSlug}`);
    assert.equal(r.status, 200);
    assert.equal(r.data.website.name, 'Test Site');
  });

  test('creates a page with a section', async () => {
    const r = await admin.post(`/api/websites/${siteSlug}/pages`, {
      page: { id: 'p1', slug: 'home', title: 'Home', templateId: 'blank', seo: {}, customCss: '', sections: [{ id: 'abc', type: 'hero', visible: true, data: { heading: 'Hi' }, style: {} }] },
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.page.sections.length, 1);
  });

  test('updates the page', async () => {
    const read = await admin.get(`/api/websites/${siteSlug}/pages/home`);
    const page = read.data.page;
    page.title = 'Home Updated';
    const r = await admin.put(`/api/websites/${siteSlug}/pages/home`, { page, base: read.data.versions });
    assert.equal(r.status, 200);
    assert.equal(r.data.page.title, 'Home Updated');
  });

  test('renames the page', async () => {
    const r = await admin.post(`/api/websites/${siteSlug}/pages/home/rename`, { to: 'start' });
    assert.equal(r.status, 200);
    assert.equal(r.data.page.slug, 'start');
  });

  test('lists and reads raw files, writes and deletes a file', async () => {
    const tree = await admin.get('/api/files');
    assert.equal(tree.status, 200);
    assert.ok(Array.isArray(tree.data));

    const create = await admin.post('/api/file', { path: 'assets/note.txt', content: 'hello' });
    assert.equal(create.status, 200);
    const read = await admin.get('/api/file?path=assets/note.txt');
    assert.equal(read.data.content, 'hello');
    const put = await admin.put('/api/file', { path: 'assets/note.txt', content: 'bye', base: read.data.hash });
    assert.equal(put.status, 200);
    const del = await admin.del('/api/file?path=assets/note.txt');
    assert.equal(del.status, 200);
  });

  test('search finds content', async () => {
    const r = await admin.get('/api/search?q=hero');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.data));
  });

  test('uploads an image asset', async () => {
    const onePng =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const r = await admin.post('/api/assets', { name: 'dot', dataUrl: onePng });
    assert.equal(r.status, 200);
    assert.match(r.data.path, /^assets\/images\/dot-[0-9a-f]+\.png$/);
  });

  test('exports a static build', async () => {
    const r = await admin.post('/api/export', { clean: true, files: [{ path: 'index.html', content: '<!doctype html><title>x</title>' }], pages: [] });
    assert.equal(r.status, 200);
    assert.equal(r.data.ok, true);
  });

  test('deletes the website', async () => {
    const r = await admin.del(`/api/websites/${siteSlug}`);
    assert.equal(r.status, 200);
    assert.equal((await admin.get(`/api/websites/${siteSlug}`)).status, 404);
  });
});

describe('form submissions', () => {
  const admin = makeClient();
  let ownerId;

  test('setup: admin logs in and gets their id', async () => {
    await admin.post('/api/auth/login', ADMIN);
    ownerId = (await admin.get('/api/auth/me')).data.user.id;
  });

  test('public submit (no session) with explicit ownerId stores a submission', async () => {
    const anon = makeClient();
    const r = await anon.post('/api/submit', { ownerId, site: 'test-site', page: 'Contact', name: 'Lead', email: 'lead@x.com', message: 'interested' });
    assert.equal(r.status, 200);
  });

  test('in-app submit (session, no ownerId) is attributed to the signed-in user', async () => {
    const r = await admin.post('/api/submit', { site: 'test-site', page: 'Home', name: 'Self', email: 'self@x.com', message: 'hi' });
    assert.equal(r.status, 200);
  });

  test('submit with unknown owner and no session is rejected', async () => {
    const anon = makeClient();
    assert.equal((await anon.post('/api/submit', { ownerId: 'u_nope', site: 's' })).status, 400);
  });

  test('owner lists their submissions with site + page, then deletes one', async () => {
    const r = await admin.get('/api/submissions');
    assert.equal(r.status, 200);
    assert.ok(r.data.submissions.length >= 2);
    const withPage = r.data.submissions.find((s) => s.page === 'Contact');
    assert.ok(withPage, 'page is stored and returned');
    assert.equal(withPage.site, 'test-site');
    assert.equal((await admin.del(`/api/submissions/${r.data.submissions[0].id}`)).status, 200);
  });
});

describe('roles + account', () => {
  const admin = makeClient();

  test('setup: admin logs in', async () => {
    await admin.post('/api/auth/login', ADMIN);
  });

  test('admin creates a user, lists, promotes, and deletes', async () => {
    const created = await admin.post('/api/admin/users', { email: 'carol@example.com', password: 'carolpw', role: 'user' });
    assert.equal(created.status, 200);
    const id = created.data.user.id;

    const list = await admin.get('/api/admin/users');
    assert.ok(list.data.users.some((u) => u.email === 'carol@example.com'));

    assert.equal((await admin.put(`/api/admin/users/${id}/role`, { role: 'admin' })).status, 200);
    assert.equal((await admin.del(`/api/admin/users/${id}`)).status, 200);
  });

  test('admin resets a user password: temp password works, old one is rejected', async () => {
    const created = await admin.post('/api/admin/users', { email: 'reset-me@example.com', password: 'original1' });
    const id = created.data.user.id;

    // Original password works first.
    const before = makeClient();
    assert.equal((await before.post('/api/auth/login', { email: 'reset-me@example.com', password: 'original1' })).status, 200);

    const reset = await admin.post(`/api/admin/users/${id}/password`);
    assert.equal(reset.status, 200);
    assert.equal(reset.data.email, 'reset-me@example.com');
    assert.ok(reset.data.password && reset.data.password.length >= 8, 'returns a temp password');

    // Old password no longer works; the temp one does.
    const after = makeClient();
    assert.equal((await after.post('/api/auth/login', { email: 'reset-me@example.com', password: 'original1' })).status, 401);
    assert.equal((await after.post('/api/auth/login', { email: 'reset-me@example.com', password: reset.data.password })).status, 200);

    await admin.del(`/api/admin/users/${id}`);
  });

  test('non-admin cannot reset anyone', async () => {
    const victim = await admin.post('/api/admin/users', { email: 'victim@example.com', password: 'victim11' });
    const nonAdmin = makeClient();
    await nonAdmin.post('/api/auth/register', { email: 'nonadmin@example.com', password: 'napass1' });
    assert.equal((await nonAdmin.post(`/api/admin/users/${victim.data.user.id}/password`)).status, 403);
    await admin.del(`/api/admin/users/${victim.data.user.id}`);
  });

  test('admin cannot delete self or demote the last admin', async () => {
    const meId = (await admin.get('/api/auth/me')).data.user.id;
    assert.equal((await admin.del(`/api/admin/users/${meId}`)).status, 400);
    assert.equal((await admin.put(`/api/admin/users/${meId}/role`, { role: 'user' })).status, 400);
  });

  test('non-admin is blocked from admin routes (403)', async () => {
    const bob = makeClient();
    await bob.post('/api/auth/register', { email: 'bob@example.com', password: 'bobpass' });
    assert.equal((await bob.get('/api/admin/users')).status, 403);
    assert.equal((await bob.post('/api/admin/users', { email: 'x@example.com', password: 'xpass123' })).status, 403);
  });

  test('user updates their own mobile number, then logs in with it', async () => {
    const u = makeClient();
    await u.post('/api/auth/register', { email: 'phoneuser@example.com', password: 'phoneu11' });
    const res = await u.post('/api/account/phone', { phone: '+1 555 444 3322' });
    assert.equal(res.status, 200);
    assert.equal(res.data.user.phone, '+15554443322');

    const byNum = makeClient();
    assert.equal((await byNum.post('/api/auth/login', { identifier: '+15554443322', password: 'phoneu11' })).status, 200);

    // Clearing it removes number login.
    assert.equal((await u.post('/api/account/phone', { phone: '' })).data.user.phone, null);
    assert.equal((await makeClient().post('/api/auth/login', { identifier: '+15554443322', password: 'phoneu11' })).status, 401);
  });

  test('user changes their own password; wrong current is rejected', async () => {
    const bob = makeClient();
    await bob.post('/api/auth/login', { email: 'bob@example.com', password: 'bobpass' });
    assert.equal((await bob.post('/api/account/password', { currentPassword: 'wrong', newPassword: 'newbob1' })).status, 400);
    assert.equal((await bob.post('/api/account/password', { currentPassword: 'bobpass', newPassword: 'newbob1' })).status, 200);
    // Old password no longer works, new one does.
    const fresh = makeClient();
    assert.equal((await fresh.post('/api/auth/login', { email: 'bob@example.com', password: 'bobpass' })).status, 401);
    assert.equal((await fresh.post('/api/auth/login', { email: 'bob@example.com', password: 'newbob1' })).status, 200);
  });
});

describe('per-user isolation', () => {
  test("one user cannot see another user's websites", async () => {
    const admin = makeClient();
    await admin.post('/api/auth/login', ADMIN);
    await admin.post('/api/websites', {
      website: { id: 'wx', slug: 'admin-only', name: 'Admin Only', status: 'draft', templateId: 'blank', homepage: 'home', pages: [{ slug: 'home' }], theme: {}, customCss: '' },
    });

    const dave = makeClient();
    await dave.post('/api/auth/register', { email: 'dave@example.com', password: 'davepass' });
    const daveProject = await dave.get('/api/project');
    assert.equal(daveProject.data.websites.length, 0, "dave sees none of admin's sites");
    assert.equal((await dave.get('/api/websites/admin-only')).status, 404);
  });
});

describe('admin can view a user\'s websites (X-CMS-As)', () => {
  const admin = makeClient();
  let eveId;

  test('a user creates two websites', async () => {
    const eve = makeClient();
    const reg = await eve.post('/api/auth/register', { email: 'eve@example.com', password: 'evepass1' });
    eveId = reg.data.user.id;
    for (const slug of ['eve-one', 'eve-two']) {
      await eve.post('/api/websites', {
        website: { id: slug, slug, name: slug, status: 'draft', templateId: 'blank', homepage: 'home', pages: [{ slug: 'home' }], theme: {}, customCss: '' },
      });
    }
    const own = await eve.get('/api/project');
    assert.equal(own.data.websites.length, 2);
  });

  test("admin sees nothing of eve's by default, but sees both with X-CMS-As", async () => {
    await admin.post('/api/auth/login', ADMIN);
    const ownView = await admin.get('/api/project');
    assert.ok(!ownView.data.websites.some((w) => w.website.slug.startsWith('eve-')), 'own project has no eve sites');

    const asEve = await admin.get('/api/project', { 'X-CMS-As': eveId });
    const slugs = asEve.data.websites.map((w) => w.website.slug).sort();
    assert.deepEqual(slugs, ['eve-one', 'eve-two'], 'admin sees both of eve\'s sites');

    // Admin can open one of eve's websites directly.
    assert.equal((await admin.get('/api/websites/eve-one', { 'X-CMS-As': eveId })).status, 200);
  });

  test('a non-admin cannot use X-CMS-As to view others', async () => {
    const mallory = makeClient();
    await mallory.post('/api/auth/register', { email: 'mallory@example.com', password: 'malpass1' });
    assert.equal((await mallory.get('/api/project', { 'X-CMS-As': eveId })).status, 403);
  });
});

describe('session lifecycle', () => {
  test('logout invalidates the session', async () => {
    const c = makeClient();
    await c.post('/api/auth/login', ADMIN);
    assert.equal((await c.get('/api/project')).status, 200);
    await c.post('/api/auth/logout');
    assert.equal((await c.get('/api/project')).status, 401);
  });
});
