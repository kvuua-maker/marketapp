import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { all, get } from '../db/database.js';
import { AppError, NotFoundError, toPublicError } from '../core/errors.js';
import { createOrder } from '../orders/router.js';
import { getOrder } from '../orders/outbox.js';

const MAX_BODY_BYTES = 256 * 1024;

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

export function toApiProduct(row) {
  const images = safeJson(row.images_json, [row.image_url]).filter(Boolean);
  return {
    id: row.id,
    title: row.title,
    shortDescription: row.short_description,
    description: row.description,
    imageUrl: row.image_url,
    images: images.length > 0 ? images : [row.image_url],
    priceCents: row.price_cents,
    currency: row.currency,
    category: row.category,
    stock: row.stock,
    vendor: row.vendor,
    supplierId: row.supplier_id,
    productUrl: row.product_url,
  };
}

function parseListQuery(searchParams) {
  const limit = Math.min(Math.max(Number.parseInt(searchParams.get('limit') ?? '24', 10) || 24, 1), 60);
  const offset = Math.max(Number.parseInt(searchParams.get('offset') ?? '0', 10) || 0, 0);
  const q = (searchParams.get('q') ?? '').trim().slice(0, 120);
  const category = (searchParams.get('category') ?? '').trim().slice(0, 80);
  const sort = searchParams.get('sort') ?? 'new';
  return { limit, offset, q, category, sort };
}

function buildProductsQuery({ limit, offset, q, category, sort }) {
  const where = [];
  const params = {};
  if (q) {
    where.push('(title LIKE :q OR description LIKE :q)');
    params[':q'] = `%${q.replace(/[%_]/g, '')}%`;
  }
  if (category && category !== 'Усі') {
    where.push('category = :category');
    params[':category'] = category;
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const orderSql = {
    price_asc: 'price_cents ASC',
    price_desc: 'price_cents DESC',
    new: 'updated_at DESC',
  }[sort] ?? 'updated_at DESC';

  params[':limit'] = limit;
  params[':offset'] = offset;
  return { whereSql, orderSql, params };
}

export function createAppServer({ db, adapters, ai, config, logger, syncTrigger }) {
  const adapterById = new Map(adapters.map((adapter) => [adapter.id, adapter]));

  const server = createServer(async (req, res) => {
    const startedAt = Date.now();
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const path = url.pathname.replace(/\/+$/, '') || '/';

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
      if (req.method === 'GET' && path === '/') {
        sendJson(res, 200, {
          service: 'marketapp',
          version: '1.0.0',
          endpoints: ['/v1/health', '/v1/categories', '/v1/products', '/v1/products/:id', '/v1/orders'],
        });
        return;
      }

      if (req.method === 'GET' && path === '/v1/health') {
        const products = get(db, 'SELECT COUNT(*) AS count FROM products')?.count ?? 0;
        const suppliers = all(db, 'SELECT id, name, enabled FROM suppliers ORDER BY id').map((supplier) => {
          const lastRun = get(db, 'SELECT status, finished_at FROM sync_runs WHERE supplier_id = ? ORDER BY id DESC LIMIT 1', {
            1: supplier.id,
          });
          return { ...supplier, lastSync: lastRun?.finished_at ?? null, lastStatus: lastRun?.status ?? null };
        });
        sendJson(res, 200, {
          status: 'ok',
          products,
          ai: { enabled: ai.enabled, model: ai.enabled ? config.ai.model : null },
          suppliers,
          time: new Date().toISOString(),
        });
        return;
      }

      if (req.method === 'GET' && path === '/v1/categories') {
        const rows = all(
          db,
          `SELECT category AS name, COUNT(*) AS count
           FROM products GROUP BY category ORDER BY count DESC, name ASC`,
        );
        const total = rows.reduce((sum, row) => sum + row.count, 0);
        sendJson(res, 200, { total, items: rows }, { 'cache-control': 'public, max-age=120' });
        return;
      }

      if (req.method === 'GET' && path === '/v1/products') {
        const query = parseListQuery(url.searchParams);
        const { whereSql, orderSql, params } = buildProductsQuery(query);
        const filterParams = { ...params };
        delete filterParams[':limit'];
        delete filterParams[':offset'];
        const countRow = get(db, `SELECT COUNT(*) AS count FROM products ${whereSql}`, filterParams);
        const rows = all(
          db,
          `SELECT * FROM products ${whereSql} ORDER BY ${orderSql} LIMIT :limit OFFSET :offset`,
          params,
        );
        sendJson(
          res,
          200,
          {
            items: rows.map(toApiProduct),
            total: countRow?.count ?? 0,
            limit: query.limit,
            offset: query.offset,
          },
          { 'cache-control': 'public, max-age=60' },
        );
        return;
      }

      const productMatch = path.match(/^\/v1\/products\/(.+)$/);
      if (req.method === 'GET' && productMatch) {
        const id = decodeURIComponent(productMatch[1]);
        const row = get(db, 'SELECT * FROM products WHERE id = ?', { 1: id });
        if (!row) throw new NotFoundError('Товар не знайдено');
        sendJson(res, 200, toApiProduct(row), { 'cache-control': 'public, max-age=120' });
        return;
      }

      if (req.method === 'POST' && path === '/v1/orders') {
        const payload = await readJsonBody(req);
        const result = await createOrder({ db, adapters, config, logger, payload });
        sendJson(res, 201, result, { 'cache-control': 'no-store' });
        return;
      }

      const orderMatch = path.match(/^\/v1\/orders\/(.+)$/);
      if (req.method === 'GET' && orderMatch) {
        const id = decodeURIComponent(orderMatch[1]);
        const data = getOrder(db, id);
        if (!data) throw new NotFoundError('Замовлення не знайдено');
        sendJson(res, 200, {
          id: data.order.id,
          status: data.order.status,
          totalCents: data.order.total_cents,
          currency: data.order.currency,
          createdAt: data.order.created_at,
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
      logger.debug('request', { method: req.method, path, ms: Date.now() - startedAt });
    }
  });

  server.keepAliveTimeout = 65_000;
  return { server, adapterById };
}
