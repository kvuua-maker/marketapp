import { createHash, randomBytes } from 'node:crypto';
import { get, run } from '../db/database.js';

const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function createSession(db, userId) {
  const token = randomBytes(32).toString('hex');
  const now = Date.now();
  run(db, 'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)', [
    hashToken(token),
    userId,
    new Date(now).toISOString(),
    new Date(now + SESSION_TTL_MS).toISOString(),
  ]);
  return token;
}

/** Returns the signed-in user id for a Bearer token, or null. */
export function userFromRequest(db, req) {
  const header = String(req.headers.authorization ?? '');
  if (!header.startsWith('Bearer ')) return null;

  const token = header.slice(7).trim();
  if (token.length < 16) return null;

  const row = get(db, 'SELECT user_id, expires_at FROM sessions WHERE token_hash = ?', [hashToken(token)]);
  if (!row) return null;
  if (row.expires_at <= new Date().toISOString()) return null;
  return row.user_id;
}

export function destroySession(db, req) {
  const header = String(req.headers.authorization ?? '');
  if (!header.startsWith('Bearer ')) return;
  const token = header.slice(7).trim();
  if (token.length < 16) return;
  run(db, 'DELETE FROM sessions WHERE token_hash = ?', [hashToken(token)]);
}
