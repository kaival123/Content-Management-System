// Unit tests for the SQLite platform layer (users, sessions, submissions, hashing).
// Run: node --experimental-sqlite --test server/db.test.mjs

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import { Db, hashPassword, verifyPassword } from './db.mjs';

let dir;
let db;

before(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'cms-db-'));
});
after(() => {
  db?.close();
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  // Fresh database file per test for isolation; close the previous one first.
  db?.close();
  db = new Db(path.join(dir, `t-${Math.random().toString(36).slice(2)}.db`));
});

describe('password hashing', () => {
  test('verifies a correct password and rejects a wrong one', () => {
    const stored = hashPassword('hunter2');
    assert.equal(verifyPassword('hunter2', stored), true);
    assert.equal(verifyPassword('wrong', stored), false);
  });
  test('uses a random salt so two hashes of the same password differ', () => {
    assert.notEqual(hashPassword('same'), hashPassword('same'));
  });
  test('does not throw on malformed stored value', () => {
    assert.equal(verifyPassword('x', 'garbage'), false);
    assert.equal(verifyPassword('x', ''), false);
  });
});

describe('users', () => {
  test('creates a user and returns a public record (no password hash)', () => {
    const u = db.createUser({ email: 'A@Example.com', password: 'secret1' });
    assert.ok(u.id.startsWith('u_'));
    assert.equal(u.email, 'a@example.com'); // normalized
    assert.equal(u.role, 'user');
    assert.equal('password_hash' in u, false);
  });
  test('rejects duplicate email (case-insensitive)', () => {
    db.createUser({ email: 'dup@example.com', password: 'secret1' });
    assert.throws(() => db.createUser({ email: 'DUP@example.com', password: 'secret1' }), /already exists/);
  });
  test('rejects an invalid email', () => {
    assert.throws(() => db.createUser({ email: 'not-an-email', password: 'secret1' }), /valid email/);
  });
  test('rejects a short password', () => {
    assert.throws(() => db.createUser({ email: 'short@example.com', password: '123' }), /at least 6/);
  });
  test('authenticate returns the user for correct creds and null otherwise', () => {
    db.createUser({ email: 'auth@example.com', password: 'secret1' });
    assert.equal(db.authenticate('auth@example.com', 'secret1').email, 'auth@example.com');
    assert.equal(db.authenticate('auth@example.com', 'nope'), null);
    assert.equal(db.authenticate('missing@example.com', 'secret1'), null);
  });

  test('a user with a mobile number can log in by email or by number', () => {
    const u = db.createUser({ email: 'phone@example.com', password: 'secret1', phone: '+1 (555) 123-4567' });
    assert.equal(u.phone, '+15551234567'); // normalized
    assert.equal(db.authenticate('phone@example.com', 'secret1').id, u.id);
    assert.equal(db.authenticate('+1 555 123 4567', 'secret1').id, u.id); // same number, different formatting
    assert.equal(db.authenticate('15551234567', 'secret1'), null); // missing the + → different value
    assert.equal(db.authenticate('+15551234567', 'wrong'), null);
  });

  test('rejects a duplicate or invalid mobile number', () => {
    db.createUser({ email: 'a@example.com', password: 'secret1', phone: '+15550001111' });
    assert.throws(() => db.createUser({ email: 'b@example.com', password: 'secret1', phone: '+1 555 000 1111' }), /already exists/);
    assert.throws(() => db.createUser({ email: 'c@example.com', password: 'secret1', phone: '123' }), /valid mobile/);
  });

  test('phone is optional', () => {
    const u = db.createUser({ email: 'nophone@example.com', password: 'secret1' });
    assert.equal(u.phone, null);
  });

  test('updatePhone sets, validates, enforces uniqueness, and clears', () => {
    const a = db.createUser({ email: 'ua@example.com', password: 'secret1' });
    const b = db.createUser({ email: 'ub@example.com', password: 'secret1', phone: '+15551112222' });

    assert.equal(db.updatePhone(a.id, '+1 (555) 999-8888'), '+15559998888');
    assert.equal(db.authenticate('+15559998888', 'secret1').id, a.id); // can now log in by number
    assert.throws(() => db.updatePhone(a.id, '+15551112222'), /already exists/); // b already has it
    assert.throws(() => db.updatePhone(a.id, '123'), /valid mobile/);
    assert.equal(db.updatePhone(a.id, ''), null); // clearing
    assert.equal(db.getUserById(a.id).phone, null);
  });
  test('counts, lists, and changes roles', () => {
    db.createUser({ email: 'a@example.com', password: 'secret1', role: 'admin' });
    const b = db.createUser({ email: 'b@example.com', password: 'secret1' });
    assert.equal(db.countUsers(), 2);
    assert.equal(db.countAdmins(), 1);
    db.setRole(b.id, 'admin');
    assert.equal(db.countAdmins(), 2);
    assert.equal(db.listUsers().length, 2);
  });
  test('updates and verifies a password', () => {
    const u = db.createUser({ email: 'pw@example.com', password: 'secret1' });
    assert.equal(db.verifyUserPassword(u.id, 'secret1'), true);
    db.updatePassword(u.id, 'secret2');
    assert.equal(db.verifyUserPassword(u.id, 'secret1'), false);
    assert.equal(db.verifyUserPassword(u.id, 'secret2'), true);
    assert.throws(() => db.updatePassword(u.id, '123'), /at least 6/);
  });
  test('deletes a user and their sessions', () => {
    const u = db.createUser({ email: 'del@example.com', password: 'secret1' });
    const token = db.createSession(u.id);
    db.deleteUser(u.id);
    assert.equal(db.getUserById(u.id), undefined);
    assert.equal(db.getSessionUser(token), null);
  });
});

describe('sessions', () => {
  test('creates a session and resolves it back to the user', () => {
    const u = db.createUser({ email: 's@example.com', password: 'secret1' });
    const token = db.createSession(u.id);
    assert.equal(db.getSessionUser(token).id, u.id);
  });
  test('returns null for an unknown or empty token', () => {
    assert.equal(db.getSessionUser('nope'), null);
    assert.equal(db.getSessionUser(''), null);
    assert.equal(db.getSessionUser(undefined), null);
  });
  test('deleteSession invalidates the token', () => {
    const u = db.createUser({ email: 's2@example.com', password: 'secret1' });
    const token = db.createSession(u.id);
    db.deleteSession(token);
    assert.equal(db.getSessionUser(token), null);
  });
});

describe('submissions', () => {
  test('adds, lists (newest first) and deletes per owner', () => {
    const owner = db.createUser({ email: 'o@example.com', password: 'secret1' });
    const other = db.createUser({ email: 'o2@example.com', password: 'secret1' });
    const s1 = db.addSubmission({ ownerId: owner.id, site: 'site-a', name: 'A', email: 'a@x.com', message: 'hi' });
    db.addSubmission({ ownerId: owner.id, site: 'site-a', name: 'B', email: 'b@x.com', message: 'yo' });
    db.addSubmission({ ownerId: other.id, site: 'site-b', name: 'C', email: 'c@x.com', message: 'hey' });

    const mine = db.listSubmissions(owner.id);
    assert.equal(mine.length, 2); // other owner's submission is not included
    assert.equal(mine[0].name, 'B'); // newest first

    db.deleteSubmission(owner.id, s1.id);
    assert.equal(db.listSubmissions(owner.id).length, 1);
    // Can't delete another owner's submission.
    const theirs = db.listSubmissions(other.id)[0];
    db.deleteSubmission(owner.id, theirs.id);
    assert.equal(db.listSubmissions(other.id).length, 1);
  });
});
