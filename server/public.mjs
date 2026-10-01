// Production file serving: the CMS app (Angular build) and the published websites.
//
//   /<website>/…      the static build in site/dist/<website>/ (what visitors see)
//   /assets/…, /scripts/…  shared files of that build (site/dist/assets, site/dist/scripts)
//   /main-….js etc.   the CMS app's own files (dist/cms/browser)
//   anything else     the CMS app (index.html), which handles /admin, sign-in and previews
//
// A website that isn't in site/dist (not published, or not built yet) falls through to
// the app, which shows it to signed-in users with ?preview.

import fs from 'node:fs/promises';
import path from 'node:path';

const LONG_CACHE = 'public, max-age=31536000, immutable';

export class PublicFiles {
  /** @param {{ appDir: string, distDir: string, mime: Record<string,string> }} opts */
  constructor({ appDir, distDir, mime }) {
    this.appDir = appDir;
    this.distDir = distDir;
    this.mime = mime;
  }

  /** Serves the request if it is for a file or page; returns false if it isn't handled. */
  async handle(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    const pathname = safeDecode(url.pathname);
    if (pathname === null) return false;

    // CMS app files (hashed names → cache for a year).
    if (pathname !== '/' && (await this.sendFile(req, res, this.appDir, pathname, /-[A-Z0-9]{8}\.(js|css)$/.test(pathname) ? LONG_CACHE : 'no-cache'))) {
      return true;
    }

    // Published websites (skipped with ?preview so editors can view drafts in the app).
    const first = pathname.split('/')[1] ?? '';
    if (first && !url.searchParams.has('preview') && (await isDir(path.join(this.distDir, first)))) {
      const target = await this.resolve(this.distDir, pathname);
      if (target?.dir && !pathname.endsWith('/')) {
        // Pages link to each other relatively, which only works with the trailing slash.
        res.writeHead(301, { Location: pathname + '/' + url.search });
        res.end();
        return true;
      }
      if (target && (await this.sendFile(req, res, this.distDir, target.dir ? path.posix.join(pathname, 'index.html') : pathname, 'no-cache'))) return true;
      if (first === 'assets' || first === 'scripts') return false;
    }

    // Everything else is a route of the app.
    return this.sendFile(req, res, this.appDir, '/index.html', 'no-cache');
  }

  async resolve(root, pathname) {
    const abs = inside(root, pathname);
    if (!abs) return null;
    const stat = await fs.stat(abs).catch(() => null);
    if (!stat) return null;
    return { dir: stat.isDirectory() };
  }

  async sendFile(req, res, root, pathname, cache) {
    const abs = inside(root, pathname);
    if (!abs) return false;
    const stat = await fs.stat(abs).catch(() => null);
    if (!stat?.isFile()) return false;
    res.writeHead(200, {
      'Content-Type': this.mime[path.extname(abs).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': cache,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    });
    if (req.method === 'HEAD') res.end();
    else res.end(await fs.readFile(abs));
    return true;
  }
}

/** Absolute path of `pathname` under `root`, or null if it would leave it. */
function inside(root, pathname) {
  const abs = path.resolve(root, '.' + pathname);
  return abs === root || abs.startsWith(root + path.sep) ? abs : null;
}

async function isDir(abs) {
  const stat = await fs.stat(abs).catch(() => null);
  return !!stat?.isDirectory();
}

function safeDecode(p) {
  try {
    const d = decodeURIComponent(p);
    return d.includes('\0') ? null : d;
  } catch {
    return null;
  }
}
