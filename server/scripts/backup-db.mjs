#!/usr/bin/env node
/** Daily compressed SQLite backup: VACUUM INTO snapshot + gzip, 7-day retention. */
import { gzipSync } from 'node:zlib';
import { mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDatabase } from '../src/db/database.js';
import { config } from '../src/config.js';

const dir = process.env.BACKUP_DIR ?? '/root/backups';
const keepDays = Number(process.env.BACKUP_KEEP_DAYS ?? 7);
mkdirSync(dir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const snapshot = join(dir, `marketapp-${stamp}.db`);
const target = `${snapshot}.gz`;

const db = openDatabase(config.dbPath);
db.exec(`VACUUM INTO '${snapshot}'`);
db.close();

writeFileSync(target, gzipSync(readFileSync(snapshot)));
unlinkSync(snapshot);

const cutoff = Date.now() - keepDays * 86_400_000;
let removed = 0;
for (const file of readdirSync(dir)) {
  if (!file.startsWith('marketapp-') || !file.endsWith('.gz')) continue;
  const path = join(dir, file);
  if (statSync(path).mtimeMs < cutoff) { unlinkSync(path); removed += 1; }
}

const size = (statSync(target).size / 1048576).toFixed(1);
console.log(`${new Date().toISOString()} backup ${target} (${size} MB), removed ${removed} old file(s)`);
