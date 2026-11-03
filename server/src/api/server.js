import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { all, get, run } from '../db/database.js';
import { AppError, NotFoundError, ValidationError, toPublicError } from '../core/errors.js';
import { createOrder } from '../orders/router.js';
import { getOrder } from '../orders/outbox.js';
import { norm, normPhone } from '../domain/normalize.js';
import { moderateReview } from '../services/reviewModerator.js';
import { handleImageProxy } from '../services/imageProxy.js';
import { NovaPoshtaService } from '../services/novaPoshta.js';
import { searchCities } from '../services/uaCities.js';

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
    where.push('(p.title_norm LIKE :q OR p.description_norm LIKE :q OR p.category_norm LIKE :q OR p.brand_norm LIKE :q)');
    params[':q'] = `%${normalisedQuery}%`;
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
    where.push('p.stock > 0');
  }
  if (query.onlyInStock) {
    where.push('p.stock > 0');
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
  return { whereSql, orderSql, params };
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
    logger: logger.child({ service: 'nova-poshta' }),
  });

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
        const inStock = get(db, 'SELECT COUNT(*) AS count FROM products WHERE stock > 0')?.count ?? 0;
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
           FROM products WHERE stock > 0
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
           WHERE stock > 0 AND vendor IS NOT NULL AND vendor <> ''
           GROUP BY vendor ORDER BY count DESC LIMIT 60`,
        );
        sendJson(res, 200, { items: rows }, { 'cache-control': 'public, max-age=300' });
        return;
      }

      if (req.method === 'GET' && path === '/v1/products') {
        const query = parseListQuery(url.searchParams);
        const { whereSql, orderSql, params } = buildProductsQuery(query);
        const filterParams = { ...params };
        delete filterParams[':limit'];
        delete filterParams[':offset'];

        const countRow = get(db, `SELECT COUNT(*) AS count FROM products p ${whereSql}`, filterParams);
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
           WHERE stock > 0 AND old_price_cents IS NOT NULL AND old_price_cents > price_cents
           ORDER BY (old_price_cents - price_cents) DESC LIMIT ?`,
          [limit],
        );
        sendJson(res, 200, { items: rows.map(toApiProduct) }, { 'cache-control': 'public, max-age=120' });
        return;
      }

      if (req.method === 'GET' && path === '/v1/filters') {
        const range = get(
          db,
          'SELECT MIN(price_cents) AS minPrice, MAX(price_cents) AS maxPrice FROM products WHERE stock > 0',
        );
        const brands = all(
          db,
          `SELECT vendor AS name, COUNT(*) AS count FROM products
           WHERE stock > 0 AND vendor IS NOT NULL AND vendor <> ''
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
           WHERE stock > 0 AND title_norm LIKE ? ORDER BY length(title) ASC LIMIT 6`,
          [like],
        );
        const brands = all(
          db,
          `SELECT DISTINCT vendor AS name FROM products
           WHERE stock > 0 AND vendor <> '' AND brand_norm LIKE ? LIMIT 4`,
          [like],
        );
        const categories = all(
          db,
          `SELECT DISTINCT category AS name FROM products
           WHERE stock > 0 AND category_norm LIKE ? LIMIT 3`,
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
             WHERE product_id = ? AND status = 'published'
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
             rating_avg = (SELECT AVG(rating) FROM reviews WHERE product_id = ? AND status = 'published'),
             rating_count = (SELECT COUNT(*) FROM reviews WHERE product_id = ? AND status = 'published')
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

      if (req.method === 'GET' && path === '/v1/orders') {
        const phone = normPhone(url.searchParams.get('phone'));
        if (!phone) throw new ValidationError('Вкажіть коректний номер телефону', [{ field: 'phone' }]);
        const orders = all(db, 'SELECT * FROM orders WHERE phone_norm = ? ORDER BY created_at DESC LIMIT 50', [phone]);
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
        const payload = await readJsonBody(req);
        const result = await createOrder({ db, adapters, config, logger, payload, novaPoshta });
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
