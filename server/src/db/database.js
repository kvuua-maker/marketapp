import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Opens (and migrates) the SQLite database.
 * `:memory:` is supported for tests.
 */
export function openDatabase(path) {
  if (path !== ':memory:') {
    mkdirSync(dirname(resolve(path)), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec(readFileSync(resolve(here, 'schema.sql'), 'utf8'));
  return db;
}

/**
 * node:sqlite distinguishes positional (?) from named (:name) parameters.
 * The codebase uses both `[a, b]` and `{1: a, 2: b}` shorthand — normalise here.
 */
function normalizeParams(params) {
  if (params === undefined || params === null) return [];
  if (Array.isArray(params)) return params;
  if (typeof params === 'object') {
    const keys = Object.keys(params);
    if (keys.length > 0 && keys.every((key) => /^\d+$/.test(key))) {
      return keys.sort((a, b) => Number(a) - Number(b)).map((key) => params[key]);
    }
    return params;
  }
  return [params];
}

function execute(db, method, sql, params) {
  const statement = db.prepare(sql);
  const normalized = normalizeParams(params);
  return Array.isArray(normalized) ? statement[method](...normalized) : statement[method](normalized);
}

export function all(db, sql, params = undefined) {
  return execute(db, 'all', sql, params);
}

export function get(db, sql, params = undefined) {
  return execute(db, 'get', sql, params);
}

export function run(db, sql, params = undefined) {
  return execute(db, 'run', sql, params);
}

/** Runs fn inside a transaction; rolls back on throw. */
export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function setSetting(db, key, value) {
  run(db, 'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
    key,
    String(value),
  ]);
}

export function getSetting(db, key) {
  return get(db, 'SELECT value FROM settings WHERE key = ?', [key])?.value ?? null;
}
