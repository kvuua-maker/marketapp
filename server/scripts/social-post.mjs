#!/usr/bin/env node
/**
 * Free social posting pipeline.
 *   node --env-file=.env scripts/social-post.mjs --type=review --publish=telegram
 *   types: review | deal | compare      publish: telegram | queue | both
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { openDatabase } from '../src/db/database.js';
import { config } from '../src/config.js';
import { createLogger } from '../src/core/logger.js';
import { pickProducts, templatePost, aiPost } from '../src/marketing/content.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const type = args.type ?? 'review';
const mode = args.mode ?? (type === 'deal' ? 'cheap' : 'popular');
const publish = args.publish ?? 'both';
const logger = createLogger({ app: 'social' });

const db = openDatabase(config.dbPath);
const items = pickProducts(db, { mode, limit: 5 });
if (!items.length) { console.error('no products'); process.exit(1); }

const template = templatePost(type, items);
const { text, ai } = await aiPost({ config, logger, type, items, template });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

const dir = 'data/social-queue';
mkdirSync(dir, { recursive: true });
const packageFile = `${dir}/${stamp}-${type}.json`;
writeFileSync(packageFile, JSON.stringify({ type, ai, text, products: items.map((p) => ({ id: p.id, title: p.title, price: p.price_cents, image: p.image_url })) }, null, 1), 'utf8');
console.log(`queue: ${packageFile} | ai: ${ai}`);
console.log('--- POST ---');
console.log(text);
console.log('-----------');

if (publish === 'telegram' || publish === 'both') {
  const token = config.notifications.telegram.token;
  const chatId = process.env.TELEGRAM_CHANNEL_ID || config.notifications.telegram.chatId;
  if (!token || !chatId) { console.error('telegram not configured'); process.exit(2); }
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: false }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json().catch(() => ({}));
  console.log('telegram:', JSON.stringify({ ok: data.ok, message_id: data?.result?.message_id, chat: chatId }));
  if (!data.ok) process.exit(1);
}
db.close();
