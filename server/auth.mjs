// Sign-in for the CMS when it runs on a real server (production mode).
//
// One shared admin password (CMS_ADMIN_PASSWORD). A successful sign-in gets a random
// session token in an HttpOnly, SameSite=Strict cookie; sessions live in memory, so a
// restart signs everyone out. Failed attempts are rate-limited per IP address.

import crypto from 'node:crypto';

const COOKIE = 'cms_session';
const SESSION_HOURS = Number(process.env.CMS_SESSION_HOURS ?? 12);
const MAX_FAILURES = 8;
const FAILURE_WINDOW_MS = 10 * 60 * 1000;

export class Auth {
  /** @param {{ password: string, user?: string }} opts */
  constructor({ password, user = 'admin' }) {
    this.user = user;
    // Compare fixed-length digests so the check takes the same time for any input.
    this.passwordDigest = crypto.createHash('sha256').update(password).digest();
    this.sessions = new Map();
    this.failures = new Map();
  }

  cookieValue(req) {
    const header = req.headers.cookie ?? '';
    for (const part of header.split(';')) {
      const [k, ...v] = part.trim().split('=');
      if (k === COOKIE) return decodeURIComponent(v.join('='));
    }
    return null;
  }

  isSignedIn(req) {
    const token = this.cookieValue(req);
    if (!token) return false;
    const expires = this.sessions.get(token);
    if (!expires) return false;
    if (expires < Date.now()) {
      this.sessions.delete(token);
      return false;
    }
    return true;
  }

  /** Too many failed attempts from this address recently? */
  isLimited(ip) {
    const f = this.failures.get(ip);
    if (!f) return false;
    if (Date.now() - f.since > FAILURE_WINDOW_MS) {
      this.failures.delete(ip);
      return false;
    }
    return f.count >= MAX_FAILURES;
  }

  /** Checks the password; returns a Set-Cookie header value on success, null otherwise. */
  signIn(req, password, secure) {
    const ip = clientIp(req);
    const digest = crypto.createHash('sha256').update(String(password ?? '')).digest();
    if (!crypto.timingSafeEqual(digest, this.passwordDigest)) {
      const f = this.failures.get(ip) ?? { count: 0, since: Date.now() };
      f.count++;
      this.failures.set(ip, f);
      return null;
    }
    this.failures.delete(ip);
    const token = crypto.randomBytes(32).toString('base64url');
    this.sessions.set(token, Date.now() + SESSION_HOURS * 3600 * 1000);
    return cookie(token, SESSION_HOURS * 3600, secure);
  }

  signOut(req, secure) {
    const token = this.cookieValue(req);
    if (token) this.sessions.delete(token);
    return cookie('', 0, secure);
  }
}

function cookie(value, maxAge, secure) {
  return `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

export function clientIp(req) {
  // Behind a reverse proxy the real address is the first X-Forwarded-For entry.
  const fwd = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
  return fwd || req.socket.remoteAddress || 'unknown';
}

/** True when the browser reached us over HTTPS (directly or through a proxy). */
export function isHttps(req) {
  return req.socket.encrypted || String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() === 'https';
}
