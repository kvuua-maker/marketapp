import { createServer } from 'node:http';
import { handleSalesDriveWebhook } from '../salesdrive/webhook.js';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { all, get, run } from '../db/database.js';
import {
  AppError,
  NotFoundError,
  RateLimitError,
  UnauthorizedError,
  ValidationError,
  toPublicError,
} from '../core/errors.js';
import { createOrder } from '../orders/router.js';
import { composeCancellationEmail, enqueueOutbox, getOrder } from '../orders/outbox.js';
import { norm, normPhone } from '../domain/normalize.js';
import { moderateReview } from '../services/reviewModerator.js';
import { handleImageProxy } from '../services/imageProxy.js';
import { NovaPoshtaService } from '../services/novaPoshta.js';
import { searchCities } from '../services/uaCities.js';
import { verifyAppleIdentityToken } from '../auth/apple.js';
import { createSession, destroySession, userFromRequest } from '../auth/session.js';

const MAX_BODY_BYTES = 256 * 1024;

// ── Device identity & rate limiting ─────────────────────────────────────────
// The app generates a random device token; orders store only its hash, so the
// order history endpoint can never be browsed by knowing a phone number.

const RATE_BUCKETS = new Map();

function clientTokenFrom(req) {
  const raw = String(req.headers['x-client-token'] ?? '').trim();
  return /^[A-Za-z0-9_-]{16,64}$/.test(raw) ? raw : null;
}

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex').slice(0, 32);
}

function requireClientToken(req) {
  const token = clientTokenFrom(req);
  if (!token) throw new UnauthorizedError('Потрібен токен пристрою');
  return token;
}

function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  if (RATE_BUCKETS.size > 10_000) {
    for (const [bucketKey, bucket] of RATE_BUCKETS) {
      if (bucket.resetAt <= now) RATE_BUCKETS.delete(bucketKey);
    }
  }
  const entry = RATE_BUCKETS.get(key);
  if (!entry || entry.resetAt <= now) {
    RATE_BUCKETS.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  entry.count += 1;
  if (entry.count > limit) {
    throw new RateLimitError('Забагато запитів. Спробуйте трохи пізніше.');
  }
}

function requireUser(db, req) {
  const userId = userFromRequest(db, req);
  if (!userId) throw new UnauthorizedError('Потрібен вхід через Apple ID');
  return userId;
}

function clientKey(req) {
  return clientTokenFrom(req) ?? `ip:${req.socket.remoteAddress ?? 'unknown'}`;
}

function sendJson(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type,authorization',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'x-request-id': randomUUID(),
    ...extraHeaders,
  });
  res.end(payload);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new AppError('Request body too large', { code: 'payload_too_large', status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new AppError('Invalid JSON body', { code: 'invalid_json', status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function safeJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/** List payload: deliberately without the full description (kept for the detail screen). */
export function toApiProduct(row) {
  const images = safeJson(row.images_json, [row.image_url]).filter(Boolean);
  const oldPrice = Number(row.old_price_cents) > Number(row.price_cents) ? Number(row.old_price_cents) : null;
  return {
    id: row.id,
    title: row.title,
    shortDescription: row.short_description,
    imageUrl: row.image_url,
    images: (images.length > 0 ? images : [row.image_url]).slice(0, 6),
    priceCents: row.price_cents,
    oldPriceCents: oldPrice,
    discountPercent: oldPrice ? Math.round((1 - row.price_cents / oldPrice) * 100) : 0,
    currency: row.currency,
    category: row.category,
    stock: row.stock,
    vendor: row.vendor,
    supplierId: row.supplier_id,
    productUrl: row.product_url,
    rating: Number(row.rating_avg ?? 0),
    ratingCount: Number(row.rating_count ?? 0),
  };
}

function parseListQuery(searchParams) {
  const limit = Math.min(Math.max(Number.parseInt(searchParams.get('limit') ?? '24', 10) || 24, 1), 60);
  const offset = Math.max(Number.parseInt(searchParams.get('offset') ?? '0', 10) || 0, 0);
  const q = (searchParams.get('q') ?? '').trim().slice(0, 120);
  const category = (searchParams.get('category') ?? '').trim().slice(0, 80);
  const brand = (searchParams.get('brand') ?? '').trim().slice(0, 80);
  const ids = (searchParams.get('ids') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 60);
  const sort = searchParams.get('sort') ?? 'relevance';
  const minPrice = Number.parseInt(searchParams.get('min_price') ?? '', 10);
  const maxPrice = Number.parseInt(searchParams.get('max_price') ?? '', 10);
  const brands = (searchParams.get('brand') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 20);
  const onlyInStock = ['1', 'true', 'yes'].includes(String(searchParams.get('in_stock') ?? ''));
  const includeOutOfStock = ['1', 'true', 'yes'].includes(String(searchParams.get('include_out_of_stock') ?? ''));
  return {
    limit,
    offset,
    q,
    category,
    brand,
    brands,
    ids,
    sort,
    includeOutOfStock,
    onlyInStock,
    minPrice: Number.isFinite(minPrice) ? minPrice : null,
    maxPrice: Number.isFinite(maxPrice) ? maxPrice : null,
  };
}

/** Builds a prefix FTS query: "кастр" -> "кастр"*. */
function buildFtsQuery(raw) {
  const tokens = norm(raw)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 2);
  if (tokens.length === 0) return null;
  return tokens.map((token) => `"${token.replace(/"/g, '')}"*`).join(' AND ');
}

function buildProductsQuery(query) {
  const where = [];
  const params = {};
  const normalisedQuery = norm(query.q);

  if (query.ids.length > 0) {
    where.push(`p.id IN (${query.ids.map((_, index) => `:id${index}`).join(',')})`);
    query.ids.forEach((id, index) => {
      params[`:id${index}`] = id;
    });
  }
  if (normalisedQuery) {
    params[':q'] = `%${normalisedQuery}%`;
    const ftsQuery = buildFtsQuery(query.q);
    if (ftsQuery) {
      // Fast path: FTS narrows the candidate set, the CASE below ranks it.
      where.push('p.id IN (SELECT id FROM products_fts WHERE products_fts MATCH :fts)');
      params[':fts'] = ftsQuery;
    } else {
      where.push('(p.title_norm LIKE :q OR p.description_norm LIKE :q OR p.category_norm LIKE :q OR p.brand_norm LIKE :q)');
    }
  }
  if (query.category && query.category !== 'Усі') {
    where.push('p.category = :category');
    params[':category'] = query.category;
  }
  if (query.brand) {
    where.push('p.brand_norm = :brand');
    params[':brand'] = norm(query.brand);
  }
  if (query.brands && query.brands.length > 0) {
    const placeholders = query.brands.map((_, index) => `:brand${index}`);
    where.push(`p.brand_norm IN (${placeholders.join(',')})`);
    query.brands.forEach((brand, index) => {
      params[`:brand${index}`] = norm(brand);
    });
  }
  if (query.minPrice !== null) {
    where.push('p.price_cents >= :minPrice');
    params[':minPrice'] = query.minPrice;
  }
  if (query.maxPrice !== null) {
    where.push('p.price_cents <= :maxPrice');
    params[':maxPrice'] = query.maxPrice;
  }
  if (!query.includeOutOfStock && !query.onlyInStock) {
    where.push('p.stock > 0 AND p.hidden_by_price = 0');
  }
  if (query.onlyInStock) {
    where.push('p.stock > 0 AND p.hidden_by_price = 0');
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const sortSql =
    {
      price_asc: 'p.price_cents ASC',
      price_desc: 'p.price_cents DESC',
      new: 'p.updated_at DESC',
      discount: '(COALESCE(p.old_price_cents, 0) - p.price_cents) DESC',
    }[query.sort] ?? 'p.updated_at DESC';

  // Relevance: title hits first, then brand/category hits, then description hits.
  const orderSql = normalisedQuery
    ? `CASE
         WHEN p.title_norm LIKE :q THEN 0
         WHEN p.brand_norm LIKE :q OR p.category_norm LIKE :q THEN 1
         ELSE 2
       END, ${sortSql}`
    : sortSql;

  params[':limit'] = query.limit;
  params[':offset'] = query.offset;

  const countParams = Object.fromEntries(
    Object.entries(params).filter(([key]) => new RegExp(`${key}(?!\\d)`).test(whereSql)),
  );

  return { whereSql, orderSql, params, countParams };
}

export function createAppServer({ db, adapters, ai, config, logger, syncTrigger }) {
  const adapterById = new Map(adapters.map((adapter) => [adapter.id, adapter]));
  const novaPoshta = new NovaPoshtaService({
    apiKey: config.delivery.novaPoshtaApiKey,
    senderRef: config.delivery.novaPoshtaSender,
    senderContactRef: config.delivery.novaPoshtaContact,
    senderPhone: config.delivery.novaPoshtaPhone,
    senderCityRef: config.delivery.novaPoshtaCity,
    senderWarehouseRef: config.delivery.novaPoshtaWarehouse,
    cod: config.delivery.novaPoshtaCod,
    logger: logger.child({ service: 'nova-poshta' }),
  });

  const server = createServer(async (req, res) => {
    const startedAt = Date.now();
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    // Static legal pages (App Store support URL fallback). Handled without
    // throwing: this block runs before the global try/catch below.
    const LEGAL_PAGES = new Set(['support.html', 'marketapp_privacy.html', 'marketapp_terms.html']);
    if (req.method === 'GET' && path.startsWith('/legal/')) {
      const file = path.slice('/legal/'.length);
      try {
        if (!LEGAL_PAGES.has(file)) throw new Error('unknown page');
        const body = readFileSync(new URL(`../../public/legal/${file}`, import.meta.url));
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'public, max-age=3600',
        });
        res.end(body);
      } catch {
        sendJson(res, 404, { error: { code: 'not_found', message: 'Сторінку не знайдено' } });
      }
      return;
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'content-type,authorization',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
      });
      res.end();
      return;
    }

    try {
      if (req.method === 'POST' && path === '/v1/webhooks/salesdrive') {
        const token = String(req.headers['x-webhook-token'] ?? url.searchParams.get('token') ?? '');
        if (!config.salesdrive?.webhookSecret || token !== config.salesdrive.webhookSecret) {
          throw new AppError('Forbidden', { code: 'forbidden', status: 403 });
        }
        const body = await readJsonBody(req).catch(() => ({}));
        const result = handleSalesDriveWebhook({ db, body, config, logger });
        sendJson(res, 200, { ok: true, ...result });
        return;
      }

      if (req.method === 'GET' && (path === '/admin/orders' || path === '/admin/orders.json')) {
        if (!config.adminToken || url.searchParams.get('token') !== config.adminToken) {
          throw new AppError('Forbidden', { code: 'forbidden', status: 403 });
        }
        const orders = db
          .prepare('SELECT id, status, total_cents, ttn, created_at FROM orders ORDER BY created_at DESC LIMIT 200')
          .all();
        const itemsStmt = db.prepare(
          'SELECT title_snapshot, qty, unit_price_cents, supplier_id, supplier_order_status FROM order_items WHERE order_id = ?',
        );
        const rows = orders.map((order) => ({ ...order, items: itemsStmt.all(order.id) }));

        if (path === '/admin/orders.json') {
          sendJson(res, 200, { orders: rows });
          return;
        }

        const esc = (value) =>
          String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
        const body = rows
          .map(
            (order) => `<tr><td>${esc(order.created_at.slice(0, 16).replace('T', ' '))}</td><td>${esc(order.id)}</td>
              <td>${esc(order.status)}</td><td>${(order.total_cents / 100).toFixed(2)} ₴</td>
              <td>${order.items.map((i) => `${esc(i.title_snapshot)} ×${i.qty} (${esc(i.supplier_id)}, ${esc(i.supplier_order_status)})`).join('<br>')}</td>
              <td>${esc(order.ttn ?? '—')}</td></tr>`,
          )
          .join('');
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(`<!doctype html><html lang="uk"><head><meta charset="utf-8"><meta http-equiv="refresh" content="30">
          <title>MarketApp — замовлення</title><style>body{font:14px system-ui;margin:20px}table{border-collapse:collapse;width:100%}
          td,th{border:1px solid #ddd;padding:6px;vertical-align:top}th{background:#f4f4f4;text-align:left}</style></head>
          <body><h1>Замовлення (${rows.length})</h1><p>Оновлюється кожні 30 с · <a href="?token=${esc(url.searchParams.get('token'))}">JSON</a></p>
          <table><tr><th>Дата</th><th>Номер</th><th>Статус</th><th>Сума</th><th>Товари</th><th>ТТН</th></tr>${body || '<tr><td colspan="6">Замовлень немає</td></tr>'}</table>
          </body></html>`);
        return;
      }

      if (req.method === 'GET' && path === '/v1/img') {
        await handleImageProxy(req, res, url, { config, logger });
        return;
      }

      if (req.method === 'GET' && path === '/') {
        sendJson(res, 200, {
          service: 'marketapp',
          version: '1.1.0',
          endpoints: [
            '/v1/health',
            '/v1/categories',
            '/v1/brands',
            '/v1/products',
            '/v1/products/:id',
            '/v1/products/:id/similar',
            '/v1/products/:id/reviews',
            '/v1/promotions',
            '/v1/orders',
            '/v1/orders/:id',
            '/v1/img',
          ],
        });
        return;
      }

      if (req.method === 'GET' && path === '/v1/health') {
        const products = get(db, 'SELECT COUNT(*) AS count FROM products')?.count ?? 0;
        const inStock = get(db, 'SELECT COUNT(*) AS count FROM products WHERE stock > 0 AND hidden_by_price = 0')?.count ?? 0;
        const suppliers = all(db, 'SELECT id, name, enabled FROM suppliers ORDER BY id').map((supplier) => {
          const lastRun = get(
            db,
            'SELECT status, finished_at FROM sync_runs WHERE supplier_id = ? ORDER BY id DESC LIMIT 1',
            [supplier.id],
          );
          return { ...supplier, lastSync: lastRun?.finished_at ?? null, lastStatus: lastRun?.status ?? null };
        });
        sendJson(res, 200, {
          status: 'ok',
          products,
          inStock,
          ai: { enabled: ai.enabled, model: ai.enabled ? config.ai.model : null },
          delivery: { novaPoshta: novaPoshta.configured },
          suppliers,
          time: new Date().toISOString(),
        });
        return;
      }

      if (req.method === 'GET' && path === '/v1/categories') {
        const rows = all(
          db,
          `SELECT category AS name, COUNT(*) AS count
           FROM products WHERE stock > 0 AND hidden_by_price = 0
           GROUP BY category ORDER BY count DESC, name ASC`,
        );
        const total = rows.reduce((sum, row) => sum + row.count, 0);
        sendJson(res, 200, { total, items: rows }, { 'cache-control': 'public, max-age=120' });
        return;
      }

      if (req.method === 'GET' && path === '/v1/brands') {
        const rows = all(
          db,
          `SELECT vendor AS name, COUNT(*) AS count FROM products
           WHERE stock > 0 AND hidden_by_price = 0 AND vendor IS NOT NULL AND vendor <> ''
           GROUP BY vendor ORDER BY count DESC LIMIT 60`,
        );
        sendJson(res, 200, { items: rows }, { 'cache-control': 'public, max-age=300' });
        return;
      }

      if (req.method === 'GET' && path === '/v1/products') {
        const query = parseListQuery(url.searchParams);
        const { whereSql, orderSql, params, countParams } = buildProductsQuery(query);

        const countRow = get(db, `SELECT COUNT(*) AS count FROM products p ${whereSql}`, countParams);
        const rows = all(db, `SELECT p.* FROM products p ${whereSql} ORDER BY ${orderSql} LIMIT :limit OFFSET :offset`, params);
        sendJson(
          res,
          200,
          {
            items: rows.map(toApiProduct),
            total: countRow?.count ?? 0,
            limit: query.limit,
            offset: query.offset,
          },
          { 'cache-control': 'public, max-age=30' },
        );
        return;
      }

      if (req.method === 'GET' && path === '/v1/promotions') {
        const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get('limit') ?? '10', 10) || 10, 1), 20);
        const rows = all(
          db,
          `SELECT * FROM products
           WHERE stock > 0 AND hidden_by_price = 0 AND old_price_cents IS NOT NULL AND old_price_cents > price_cents
           ORDER BY (old_price_cents - price_cents) DESC LIMIT ?`,
          [limit],
        );
        sendJson(res, 200, { items: rows.map(toApiProduct) }, { 'cache-control': 'public, max-age=120' });
        return;
      }

      if (req.method === 'GET' && path === '/v1/filters') {
        const range = get(
          db,
          'SELECT MIN(price_cents) AS minPrice, MAX(price_cents) AS maxPrice FROM products WHERE stock > 0 AND hidden_by_price = 0',
        );
        const brands = all(
          db,
          `SELECT vendor AS name, COUNT(*) AS count FROM products
           WHERE stock > 0 AND hidden_by_price = 0 AND vendor IS NOT NULL AND vendor <> ''
           GROUP BY vendor ORDER BY count DESC LIMIT 40`,
        );
        sendJson(
          res,
          200,
          { minPriceCents: range?.minPrice ?? 0, maxPriceCents: range?.maxPrice ?? 0, brands },
          { 'cache-control': 'public, max-age=300' },
        );
        return;
      }

      if (req.method === 'GET' && path === '/v1/search/suggest') {
        const q = norm(url.searchParams.get('q') ?? '');
        if (q.length < 2) {
          sendJson(res, 200, { items: [] }, { 'cache-control': 'no-store' });
          return;
        }
        const like = `%${q}%`;
        const titles = all(
          db,
          `SELECT id, title, price_cents AS priceCents FROM products
           WHERE stock > 0 AND hidden_by_price = 0 AND title_norm LIKE ? ORDER BY length(title) ASC LIMIT 6`,
          [like],
        );
        const brands = all(
          db,
          `SELECT DISTINCT vendor AS name FROM products
           WHERE stock > 0 AND hidden_by_price = 0 AND vendor <> '' AND brand_norm LIKE ? LIMIT 4`,
          [like],
        );
        const categories = all(
          db,
          `SELECT DISTINCT category AS name FROM products
           WHERE stock > 0 AND hidden_by_price = 0 AND category_norm LIKE ? LIMIT 3`,
          [like],
        );
        sendJson(
          res,
          200,
          {
            items: [
              ...titles.map((row) => ({ type: 'product', id: row.id, title: row.title, priceCents: row.priceCents })),
              ...brands.map((row) => ({ type: 'brand', id: row.name, title: row.name })),
              ...categories.map((row) => ({ type: 'category', id: row.name, title: row.name })),
            ],
          },
          { 'cache-control': 'no-store' },
        );
        return;
      }

      if (req.method === 'GET' && path === '/v1/np/cities') {
        const q = url.searchParams.get('q') ?? '';
        const remote = await novaPoshta.searchCities(q).catch(() => []);
        const items = remote.length > 0
          ? remote
          : searchCities(q, 20).map((name) => ({ name, ref: null }));
        sendJson(res, 200, { configured: novaPoshta.configured, items }, { 'cache-control': 'public, max-age=600' });
        return;
      }

      if (req.method === 'GET' && path === '/v1/np/warehouses') {
        const city = url.searchParams.get('city') ?? '';
        const q = url.searchParams.get('q') ?? '';
        if (!novaPoshta.configured) {
          sendJson(res, 200, { configured: false, items: [] }, { 'cache-control': 'no-store' });
          return;
        }
        const items = await novaPoshta.searchWarehouses(city, q).catch(() => []);
        sendJson(res, 200, { configured: true, items }, { 'cache-control': 'public, max-age=600' });
        return;
      }

      if (req.method === 'POST' && path === '/v1/events') {
        const token = requireClientToken(req);
        rateLimit(`events:${token}`, 120, 60_000);
        const body = await readJsonBody(req);
        const allowed = new Set(['product_view', 'add_to_cart', 'order_created', 'search']);
        const name = String(body?.name ?? '');
        if (!allowed.has(name)) {
          throw new ValidationError('Невідома подія', [{ field: 'name' }]);
        }
        run(
          db,
          'INSERT INTO events (name, product_id, order_id, meta_json, created_at) VALUES (?, ?, ?, ?, ?)',
          [
            name,
            body?.productId ? String(body.productId) : null,
            body?.orderId ? String(body.orderId) : null,
            JSON.stringify(body?.meta ?? {}).slice(0, 2000),
            new Date().toISOString(),
          ],
        );
        sendJson(res, 202, { accepted: true });
        return;
      }

      if (req.method === 'GET' && path === '/v1/analytics/summary') {
        const authorization = String(req.headers.authorization ?? '');
        if (!config.adminToken || authorization !== `Bearer ${config.adminToken}`) {
          throw new UnauthorizedError('Доступ до аналітики заборонено');
        }
        const days = Math.min(Math.max(Number.parseInt(url.searchParams.get('days') ?? '7', 10) || 7, 1), 90);
        const since = new Date(Date.now() - days * 86_400_000).toISOString();
        const totals = all(
          db,
          'SELECT name, COUNT(*) AS count FROM events WHERE created_at >= ? GROUP BY name ORDER BY count DESC',
          [since],
        );
        const topProducts = all(
          db,
          `SELECT product_id AS productId, COUNT(*) AS views FROM events
           WHERE name = 'product_view' AND created_at >= ? AND product_id IS NOT NULL
           GROUP BY product_id ORDER BY views DESC LIMIT 10`,
          [since],
        );
        const orders = get(db, 'SELECT COUNT(*) AS count, COALESCE(SUM(total_cents), 0) AS revenue FROM orders WHERE created_at >= ?', [since]);
        sendJson(res, 200, { days, totals, topProducts, orders }, { 'cache-control': 'no-store' });
        return;
      }

      // Apple 1.2 / UGC: any customer can report a review. Three reports hide it.
      const reportMatch = path.match(/^\/v1\/reviews\/(\d+)\/report$/);
      if (reportMatch && req.method === 'POST') {
        const token = requireClientToken(req);
        rateLimit(`review-report:${token}`, 10, 3_600_000);

        const reviewId = Number.parseInt(reportMatch[1], 10);
        const review = get(db, 'SELECT id, product_id FROM reviews WHERE id = ?', [reviewId]);
        if (!review) throw new NotFoundError('Відгук не знайдено');

        const body = await readJsonBody(req).catch(() => ({}));
        const reason = String(body?.reason ?? '').trim().slice(0, 200);
        run(db, 'INSERT INTO review_reports (review_id, reason, created_at) VALUES (?, ?, ?)', [
          reviewId,
          reason,
          new Date().toISOString(),
        ]);

        const reports = get(db, 'SELECT COUNT(*) AS c FROM review_reports WHERE review_id = ?', [reviewId]).c;
        if (reports >= 3) {
          run(db, 'UPDATE reviews SET hidden = 1 WHERE id = ?', [reviewId]);
          run(
            db,
            `UPDATE products SET
               rating_avg = COALESCE((SELECT AVG(rating) FROM reviews WHERE product_id = ? AND status = 'published' AND hidden = 0), 0),
               rating_count = (SELECT COUNT(*) FROM reviews WHERE product_id = ? AND status = 'published' AND hidden = 0)
             WHERE id = ?`,
            [review.product_id, review.product_id, review.product_id],
          );
        }

        sendJson(res, 202, { accepted: true, reports }, { 'cache-control': 'no-store' });
        return;
      }

      const similarMatch = path.match(/^\/v1\/products\/([^/]+)\/similar$/);
      if (req.method === 'GET' && similarMatch) {
        const id = decodeURIComponent(similarMatch[1]);
        const base = get(db, 'SELECT * FROM products WHERE id = ?', [id]);
        if (!base) throw new NotFoundError('Товар не знайдено');
        const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get('limit') ?? '8', 10) || 8, 1), 20);
        const rows = all(
          db,
          `SELECT * FROM products
           WHERE category = ? AND id <> ? AND stock > 0 AND price_cents BETWEEN ? AND ?
           ORDER BY ABS(price_cents - ?) ASC LIMIT ?`,
          [
            base.category,
            id,
            Math.round(base.price_cents * 0.7),
            Math.round(base.price_cents * 1.3),
            base.price_cents,
            limit,
          ],
        );
        sendJson(res, 200, { items: rows.map(toApiProduct) }, { 'cache-control': 'public, max-age=120' });
        return;
      }

      const reviewsMatch = path.match(/^\/v1\/products\/([^/]+)\/reviews$/);
      if (reviewsMatch && (req.method === 'GET' || req.method === 'POST')) {
        const id = decodeURIComponent(reviewsMatch[1]);
        const product = get(db, 'SELECT id, title, rating_avg, rating_count FROM products WHERE id = ?', [id]);
        if (!product) throw new NotFoundError('Товар не знайдено');

        if (req.method === 'GET') {
          const rows = all(
            db,
            `SELECT id, author, rating, text, created_at FROM reviews
             WHERE product_id = ? AND status = 'published' AND hidden = 0
             ORDER BY created_at DESC LIMIT 50`,
            [id],
          );
          sendJson(
            res,
            200,
            {
              average: Number(product.rating_avg ?? 0),
              count: Number(product.rating_count ?? 0),
              items: rows.map((row) => ({
                id: row.id,
                author: row.author,
                rating: row.rating,
                text: row.text,
                createdAt: row.created_at,
              })),
            },
            { 'cache-control': 'public, max-age=30' },
          );
          return;
        }

        rateLimit(`reviews:${clientKey(req)}`, 5, 3_600_000);
        const body = await readJsonBody(req);
        const author = String(body?.author ?? '').trim().slice(0, 60);
        const text = String(body?.text ?? '').trim().slice(0, 1000);
        const rating = Number.parseInt(body?.rating ?? 0, 10);

        if (text.length < 8) throw new ValidationError('Відгук занадто короткий', [{ field: 'text' }]);
        if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
          throw new ValidationError('Оцінка має бути від 1 до 5', [{ field: 'rating' }]);
        }

        const verdict = await moderateReview({ client: ai.client, author, rating, text, logger });
        if (verdict.status !== 'published') {
          throw new ValidationError('Відгук не пройшов модерацію', [{ field: 'text', reason: verdict.reason }]);
        }

        run(
          db,
          `INSERT INTO reviews (product_id, author, rating, text, status, reason, created_at)
           VALUES (?, ?, ?, ?, 'published', ?, ?)`,
          [id, author, rating, text, verdict.reason, new Date().toISOString()],
        );
        run(
          db,
          `UPDATE products SET
             rating_avg = COALESCE((SELECT AVG(rating) FROM reviews WHERE product_id = ? AND status = 'published' AND hidden = 0), 0),
             rating_count = (SELECT COUNT(*) FROM reviews WHERE product_id = ? AND status = 'published' AND hidden = 0)
           WHERE id = ?`,
          [id, id, id],
        );
        const updated = get(db, 'SELECT rating_avg, rating_count FROM products WHERE id = ?', [id]);
        sendJson(res, 201, {
          status: 'published',
          average: Number(updated.rating_avg ?? 0),
          count: Number(updated.rating_count ?? 0),
        });
        return;
      }

      const productMatch = path.match(/^\/v1\/products\/([^/]+)$/);
      if (req.method === 'GET' && productMatch) {
        const id = decodeURIComponent(productMatch[1]);
        const row = get(db, 'SELECT * FROM products WHERE id = ?', [id]);
        if (!row) throw new NotFoundError('Товар не знайдено');
        sendJson(res, 200, { ...toApiProduct(row), description: row.description }, { 'cache-control': 'public, max-age=120' });
        return;
      }

      // ── Optional Sign in with Apple + cross-device sync ────────────────
      if (req.method === 'POST' && path === '/v1/auth/apple') {
        const body = await readJsonBody(req);
        const identityToken = String(body?.identityToken ?? '');
        if (!identityToken) throw new ValidationError('Потрібен identityToken', [{ field: 'identityToken' }]);

        const payload = await verifyAppleIdentityToken(identityToken, config.appleClientIds, logger);
        const appleSub = String(payload.sub);
        const now = new Date().toISOString();
        const fullName = String(body?.fullName ?? '').trim().slice(0, 80);

        let user = get(db, 'SELECT * FROM users WHERE apple_sub = ?', [appleSub]);
        if (!user) {
          const id = `usr_${randomUUID().slice(0, 12)}`;
          run(db, 'INSERT INTO users (id, apple_sub, email, name, created_at) VALUES (?, ?, ?, ?, ?)', [
            id,
            appleSub,
            payload.email ? String(payload.email).slice(0, 120) : null,
            fullName || null,
            now,
          ]);
          user = { id };
        } else if (fullName) {
          run(db, 'UPDATE users SET name = ? WHERE id = ?', [fullName, user.id]);
        }

        const sessionToken = createSession(db, user.id);

        // Orders placed on this device before signing in become part of the account.
        let ordersClaimed = 0;
        const deviceToken = clientTokenFrom(req);
        if (deviceToken) {
          const result = run(db, 'UPDATE orders SET user_id = ? WHERE client_token_hash = ? AND user_id IS NULL', [
            user.id,
            tokenHash(deviceToken),
          ]);
          ordersClaimed = Number(result?.changes ?? 0);
        }

        sendJson(res, 200, {
          sessionToken,
          user: { id: user.id, email: payload.email ?? null, name: fullName || null },
          ordersClaimed,
        }, { 'cache-control': 'no-store' });
        return;
      }

      if (req.method === 'POST' && path === '/v1/auth/logout') {
        destroySession(db, req);
        sendJson(res, 200, { signedOut: true }, { 'cache-control': 'no-store' });
        return;
      }

      if (path === '/v1/profile' && (req.method === 'GET' || req.method === 'PUT')) {
        const userId = requireUser(db, req);

        if (req.method === 'GET') {
          const row = get(db, 'SELECT phone, addresses_json, updated_at FROM user_profiles WHERE user_id = ?', [userId]);
          sendJson(res, 200, {
            phone: row?.phone ?? null,
            addresses: row?.addresses_json ? JSON.parse(row.addresses_json) : [],
            updatedAt: row?.updated_at ?? null,
          }, { 'cache-control': 'no-store' });
          return;
        }

        const body = await readJsonBody(req);
        const phone = String(body?.phone ?? '').slice(0, 24);
        const addresses = Array.isArray(body?.addresses) ? body.addresses.slice(0, 10) : [];
        const cleaned = addresses
          .filter((item) => item && typeof item === 'object')
          .map((item) => ({
            label: String(item.label ?? '').slice(0, 40),
            city: String(item.city ?? '').slice(0, 80),
            branch: String(item.branch ?? '').slice(0, 160),
          }));

        run(
          db,
          `INSERT INTO user_profiles (user_id, phone, addresses_json, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET phone = excluded.phone,
             addresses_json = excluded.addresses_json, updated_at = excluded.updated_at`,
          [userId, phone || null, JSON.stringify(cleaned), new Date().toISOString()],
        );
        sendJson(res, 200, { saved: true }, { 'cache-control': 'no-store' });
        return;
      }

      if (path === '/v1/cart' && (req.method === 'GET' || req.method === 'PUT')) {
        const userId = requireUser(db, req);

        if (req.method === 'GET') {
          const row = get(db, 'SELECT cart_json, updated_at FROM user_carts WHERE user_id = ?', [userId]);
          sendJson(res, 200, {
            items: row?.cart_json ? JSON.parse(row.cart_json) : [],
            updatedAt: row?.updated_at ?? null,
          }, { 'cache-control': 'no-store' });
          return;
        }

        const body = await readJsonBody(req);
        const rawItems = Array.isArray(body?.items) ? body.items.slice(0, 100) : [];
        const items = rawItems
          .filter((item) => item && typeof item === 'object' && item.productId)
          .map((item) => ({
            productId: String(item.productId).slice(0, 80),
            qty: Math.min(Math.max(Number.parseInt(item.qty ?? 1, 10) || 1, 1), 10),
          }));

        run(
          db,
          `INSERT INTO user_carts (user_id, cart_json, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET cart_json = excluded.cart_json, updated_at = excluded.updated_at`,
          [userId, JSON.stringify(items), new Date().toISOString()],
        );
        sendJson(res, 200, { saved: true, count: items.length }, { 'cache-control': 'no-store' });
        return;
      }

      if (req.method === 'GET' && path === '/v1/orders') {
        const userId = userFromRequest(db, req);
        let orders;

        if (userId) {
          orders = all(
            db,
            'SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
            [userId],
          );
        } else {
          const token = requireClientToken(req);
          const phone = normPhone(url.searchParams.get('phone'));
          if (!phone) throw new ValidationError('Вкажіть коректний номер телефону', [{ field: 'phone' }]);
          orders = all(
            db,
            'SELECT * FROM orders WHERE phone_norm = ? AND client_token_hash = ? ORDER BY created_at DESC LIMIT 50',
            [phone, tokenHash(token)],
          );
        }
        const items = orders.length
          ? all(
              db,
              `SELECT * FROM order_items WHERE order_id IN (${orders.map(() => '?').join(',')})`,
              orders.map((order) => order.id),
            )
          : [];
        const byOrder = new Map();
        for (const item of items) {
          if (!byOrder.has(item.order_id)) byOrder.set(item.order_id, []);
          byOrder.get(item.order_id).push(item);
        }
        sendJson(
          res,
          200,
          {
            items: orders.map((order) => ({
              id: order.id,
              status: order.status,
              totalCents: order.total_cents,
              currency: order.currency,
              createdAt: order.created_at,
              ttn: order.ttn ?? null,
              trackingUrl: NovaPoshtaService.trackingUrl(order.ttn),
              items: (byOrder.get(order.id) ?? []).map((item) => ({
                productId: item.product_id,
                title: item.title_snapshot,
                qty: item.qty,
                unitPriceCents: item.unit_price_cents,
              })),
            })),
          },
          { 'cache-control': 'no-store' },
        );
        return;
      }

      if (req.method === 'POST' && path === '/v1/orders') {
        if (config.orders.paused) {
          throw new AppError('Прийом замовлень тимчасово припинено. Спробуйте пізніше.', {
            code: 'orders_paused',
            status: 503,
          });
        }
        rateLimit(`orders:${clientKey(req)}`, 10, 3_600_000);
        const payload = await readJsonBody(req);
        const token = clientTokenFrom(req);
        const userId = userFromRequest(db, req);
        const result = await createOrder({
          db,
          adapters,
          config,
          logger,
          payload,
          novaPoshta,
          clientTokenHash: token ? tokenHash(token) : null,
          userId,
        });

        // The order consumed the basket: wipe the synced cart so the same
        // items disappear on every signed-in device immediately.
        if (userId) {
          run(
            db,
            `INSERT INTO user_carts (user_id, cart_json, updated_at) VALUES (?, '[]', ?)
             ON CONFLICT(user_id) DO UPDATE SET cart_json = '[]', updated_at = excluded.updated_at`,
            [userId, new Date().toISOString()],
          );
        }

        sendJson(res, 201, result, { 'cache-control': 'no-store' });
        return;
      }

      // Statuses that still can be cancelled: the parcel has not been shipped.
      const cancelMatch = path.match(/^\/v1\/orders\/([^/]+)\/cancel$/);
      if (cancelMatch && (req.method === 'POST' || req.method === 'PUT')) {
        const id = decodeURIComponent(cancelMatch[1]);
        const data = getOrder(db, id);
        if (!data) throw new NotFoundError('Замовлення не знайдено');

        const userId = userFromRequest(db, req);
        const token = clientTokenFrom(req);
        const ownsByUser = data.order.user_id && userId === data.order.user_id;
        const ownsByDevice =
          data.order.client_token_hash && token && tokenHash(token) === data.order.client_token_hash;
        if (!ownsByUser && !ownsByDevice) throw new NotFoundError('Замовлення не знайдено');

        const status = String(data.order.status);
        if (status === 'cancelled') {
          throw new AppError('Замовлення вже скасовано', { code: 'already_cancelled', status: 400 });
        }

        const cancelable = new Set(['new', 'processing', 'routing', 'routed', 'routed_email']);
        if (!cancelable.has(status)) {
          throw new AppError('Товар вже в дорозі, скасування неможливе', {
            code: 'cannot_cancel',
            status: 400,
          });
        }

        const cancelledAt = new Date().toISOString();
        run(db, "UPDATE orders SET status = 'cancelled', cancelled_at = ? WHERE id = ?", [cancelledAt, id]);
        run(db, "UPDATE order_items SET supplier_order_status = 'cancelled' WHERE order_id = ?", [id]);

        // Tell the supplier not to ship. The email is queued in the outbox:
        // without EMAIL_PROVIDER=resend it simply waits there, no errors.
        const bySupplier = new Map();
        for (const item of data.items) {
          if (!bySupplier.has(item.supplier_id)) bySupplier.set(item.supplier_id, []);
          bySupplier.get(item.supplier_id).push({
            title: item.title_snapshot,
            qty: item.qty,
          });
        }
        for (const [supplierId, items] of bySupplier) {
          const supplierName = adapters.find((adapter) => adapter.id === supplierId)?.name ?? supplierId;
          const email = composeCancellationEmail({
            order: { id },
            items,
            supplierName,
          });
          enqueueOutbox(db, {
            orderId: id,
            supplierId,
            channel: 'email',
            to: config.orders.supplierEmail?.[supplierId] ?? `orders+${supplierId}@marketapp.local`,
            subject: email.subject,
            body: email.text,
          });
        }

        logger.info('order cancelled', {
          orderId: id,
          previousStatus: status,
          by: userId ? 'account' : 'device',
          suppliers: bySupplier.size,
        });

        sendJson(res, 200, { id, status: 'cancelled', cancelledAt }, { 'cache-control': 'no-store' });
        return;
      }

      const orderMatch = path.match(/^\/v1\/orders\/(.+)$/);
      if (req.method === 'GET' && orderMatch) {
        const id = decodeURIComponent(orderMatch[1]);
        const data = getOrder(db, id);
        if (!data) throw new NotFoundError('Замовлення не знайдено');
        // Order status contains the customer's name and address: only the
        // device that placed the order may read it.
        if (data.order.client_token_hash) {
          const token = clientTokenFrom(req);
          if (!token || tokenHash(token) !== data.order.client_token_hash) {
            throw new NotFoundError('Замовлення не знайдено');
          }
        }
        sendJson(res, 200, {
          id: data.order.id,
          status: data.order.status,
          totalCents: data.order.total_cents,
          currency: data.order.currency,
          createdAt: data.order.created_at,
          ttn: data.order.ttn ?? null,
          trackingUrl: NovaPoshtaService.trackingUrl(data.order.ttn),
          customer: JSON.parse(data.order.customer_json),
          items: data.items.map((item) => ({
            productId: item.product_id,
            supplierId: item.supplier_id,
            title: item.title_snapshot,
            qty: item.qty,
            unitPriceCents: item.unit_price_cents,
            supplierStatus: item.supplier_order_status,
          })),
          notifications: data.outbox.map((entry) => ({
            supplierId: entry.supplier_id,
            channel: entry.channel,
            status: entry.status,
            createdAt: entry.created_at,
          })),
        });
        return;
      }

      if (req.method === 'POST' && path === '/v1/internal/sync') {
        if (!config.internalToken || req.headers.authorization !== `Bearer ${config.internalToken}`) {
          throw new AppError('Forbidden', { code: 'forbidden', status: 403 });
        }
        if (!syncTrigger) throw new AppError('Sync is not available', { code: 'unavailable', status: 503 });
        void syncTrigger('internal');
        sendJson(res, 202, { accepted: true });
        return;
      }

      throw new NotFoundError(`Невідомий маршрут: ${req.method} ${path}`);
    } catch (error) {
      const status = error instanceof AppError ? error.status : 500;
      if (status >= 500) logger.error('request failed', { path, error });
      sendJson(res, status, { error: toPublicError(error) });
    } finally {
      const remote = req.socket.remoteAddress ?? '';
      const local = remote === '' || remote === '::1' || remote.startsWith('127.') || remote.startsWith('::ffff:127.');
      const entry = { method: req.method, path, status: res.statusCode, ms: Date.now() - startedAt };
      if (local) logger.debug('request', entry);
      else logger.info('remote request', { ...entry, remote });
    }
  });

  server.keepAliveTimeout = 65_000;
  return { server, adapterById, novaPoshta };
}
