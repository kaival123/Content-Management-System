// SQLite-backed platform data: users (with roles), login sessions and form submissions.
//
// This is the ONLY database in the CMS. Website content stays as files on disk
// (one folder per user); the database just answers "who are you, what do you own".
//
// Uses Node's built-in node:sqlite (run with --experimental-sqlite on Node 22).

import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// --- password hashing (scrypt, no external deps) ------------------------------------------

export function hashPassword(password) {
  const salt = randomBytes(16);
  const dk = scryptSync(String(password), salt, 64);
  return `scrypt$${salt.toString('hex')}$${dk.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const dk = scryptSync(String(password), Buffer.from(saltHex, 'hex'), 64);
  const expected = Buffer.from(hashHex, 'hex');
  return expected.length === dk.length && timingSafeEqual(expected, dk);
}

// --- database -----------------------------------------------------------------------------

export class Db {
  constructor(file) {
    mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS users (
        id            TEXT PRIMARY KEY,
        email         TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role          TEXT NOT NULL DEFAULT 'user',
        created_at    TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token      TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS submissions (
        id         TEXT PRIMARY KEY,
        owner_id   TEXT NOT NULL,
        site       TEXT NOT NULL,
        name       TEXT,
        email      TEXT,
        message    TEXT,
        created_at TEXT NOT NULL
      );
    `);
  }

  /** Closes the underlying database (releases the file so it can be removed). */
  close() {
    this.db.close();
  }

  // --- users ------------------------------------------------------------------------------

  /** Creates a user. Throws if the email is already taken. Returns the public user record. */
  createUser({ email, password, role = 'user' }) {
    const normalized = String(email).trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) throw new Error('Enter a valid email address');
    if (String(password).length < 6) throw new Error('Password must be at least 6 characters');
    if (this.getUserByEmail(normalized)) throw new Error('An account with that email already exists');
    const user = { id: `u_${randomUUID().replace(/-/g, '').slice(0, 20)}`, email: normalized, role, created_at: new Date().toISOString() };
    this.db
      .prepare('INSERT INTO users (id, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(user.id, user.email, hashPassword(password), role, user.created_at);
    return this.publicUser(user);
  }

  getUserByEmail(email) {
    return this.db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).trim().toLowerCase());
  }

  getUserById(id) {
    return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  }

  countUsers() {
    return this.db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  }

  listUsers() {
    return this.db.prepare('SELECT id, email, role, created_at FROM users ORDER BY created_at').all();
  }

  setRole(id, role) {
    this.db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  }

  countAdmins() {
    return this.db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n;
  }

  updatePassword(id, newPassword) {
    if (String(newPassword).length < 6) throw new Error('New password must be at least 6 characters');
    this.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), id);
  }

  /** Verifies a user's current password by id (used before changing it). */
  verifyUserPassword(id, password) {
    const row = this.getUserById(id);
    return !!row && verifyPassword(password, row.password_hash);
  }

  deleteUser(id) {
    this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    this.db.prepare('DELETE FROM users WHERE id = ?').run(id);
  }

  /** Verifies a login. Returns the public user record or null. */
  authenticate(email, password) {
    const row = this.getUserByEmail(email);
    if (!row || !verifyPassword(password, row.password_hash)) return null;
    return this.publicUser(row);
  }

  publicUser(row) {
    return { id: row.id, email: row.email, role: row.role };
  }

  // --- sessions ---------------------------------------------------------------------------

  createSession(userId) {
    const token = randomBytes(32).toString('hex');
    this.db
      .prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(token, userId, new Date().toISOString(), Date.now() + SESSION_TTL_MS);
    return token;
  }

  /** Returns the public user for a session token, or null if missing/expired. */
  getSessionUser(token) {
    if (!token) return null;
    const session = this.db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
    if (!session) return null;
    if (session.expires_at < Date.now()) {
      this.deleteSession(token);
      return null;
    }
    const user = this.getUserById(session.user_id);
    return user ? this.publicUser(user) : null;
  }

  deleteSession(token) {
    if (token) this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }

  // --- submissions ------------------------------------------------------------------------

  addSubmission({ ownerId, site, name, email, message }) {
    const row = { id: `s_${randomUUID().replace(/-/g, '').slice(0, 20)}`, created_at: new Date().toISOString() };
    this.db
      .prepare('INSERT INTO submissions (id, owner_id, site, name, email, message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(row.id, ownerId, site ?? '', name ?? '', email ?? '', message ?? '', row.created_at);
    return row;
  }

  listSubmissions(ownerId) {
    return this.db.prepare('SELECT * FROM submissions WHERE owner_id = ? ORDER BY created_at DESC').all(ownerId);
  }

  deleteSubmission(ownerId, id) {
    this.db.prepare('DELETE FROM submissions WHERE owner_id = ? AND id = ?').run(ownerId, id);
  }
}
