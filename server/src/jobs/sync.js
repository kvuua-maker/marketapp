import { transaction, run, get, setSetting } from '../db/database.js';
import { norm } from '../domain/normalize.js';

const DEFAULT_BATCH_SIZE = 96;

function upsertProduct(db, record, contentHashValue) {
  const now = new Date().toISOString();
  run(
    db,
    `INSERT INTO products (
       id, supplier_id, external_id, title, description, short_description, image_url, images_json,
       category, category_raw, cost_cents, price_cents, old_price_cents, margin_percent, currency, stock,
       product_url, vendor, content_hash, ai_status, ai_meta_json,
       title_norm, description_norm, category_norm, brand_norm, created_at, updated_at
     ) VALUES (
       :id, :supplierId, :externalId, :title, :description, :shortDescription, :imageUrl, :imagesJson,
       :category, :categoryRaw, :costCents, :priceCents, :oldPriceCents, :marginPercent, :currency, :stock,
       :productUrl, :vendor, :contentHash, :aiStatus, :aiMetaJson,
       :titleNorm, :descriptionNorm, :categoryNorm, :brandNorm, :now, :now
     )
     ON CONFLICT(supplier_id, external_id) DO UPDATE SET
       title = excluded.title,
       description = excluded.description,
       short_description = excluded.short_description,
       image_url = excluded.image_url,
       images_json = excluded.images_json,
       category = excluded.category,
       category_raw = excluded.category_raw,
       cost_cents = excluded.cost_cents,
       price_cents = excluded.price_cents,
       old_price_cents = excluded.old_price_cents,
       margin_percent = excluded.margin_percent,
       currency = excluded.currency,
       stock = excluded.stock,
       product_url = excluded.product_url,
       vendor = excluded.vendor,
       content_hash = excluded.content_hash,
       ai_status = excluded.ai_status,
       ai_meta_json = excluded.ai_meta_json,
       title_norm = excluded.title_norm,
       description_norm = excluded.description_norm,
       category_norm = excluded.category_norm,
       brand_norm = excluded.brand_norm,
       updated_at = excluded.updated_at`,
    {
      ':id': record.id,
      ':supplierId': record.supplierId,
      ':externalId': record.externalId,
      ':title': record.title,
      ':description': record.description,
      ':shortDescription': record.shortDescription,
      ':imageUrl': record.imageUrl,
      ':imagesJson': JSON.stringify(record.images ?? [record.imageUrl]),
      ':category': record.category,
      ':categoryRaw': record.categoryRaw,
      ':costCents': record.costCents,
      ':priceCents': record.priceCents,
      ':oldPriceCents': record.oldPriceCents ?? null,
      ':marginPercent': record.marginPercent,
      ':currency': record.currency,
      ':stock': record.stock,
      ':productUrl': record.productUrl,
      ':vendor': record.vendor,
      ':contentHash': contentHashValue,
      ':aiStatus': record.aiStatus,
      ':aiMetaJson': JSON.stringify(record.aiMeta ?? {}),
      ':titleNorm': norm(record.title),
      ':descriptionNorm': norm(record.description),
      ':categoryNorm': norm(record.category),
      ':brandNorm': norm(record.vendor || record.categoryRaw || ''),
      ':now': now,
    },
  );
}

function recordRejection(db, supplierId, result) {
  run(
    db,
    `INSERT INTO product_rejections (supplier_id, external_id, title, reason, content_hash, created_at)
     VALUES (:supplierId, :externalId, :title, :reason, :hash, :now)
     ON CONFLICT(supplier_id, external_id) DO UPDATE SET
       reason = excluded.reason, content_hash = excluded.content_hash, created_at = excluded.created_at`,
    {
      ':supplierId': supplierId,
      ':externalId': String(result.raw.externalId),
      ':title': String(result.raw.title ?? '').slice(0, 300),
      ':reason': result.reason ?? 'rejected',
      ':hash': String(result.raw.contentHash ?? ''),
      ':now': new Date().toISOString(),
    },
  );
}

/**
 * Runs one supplier sync: stream products -> AI validation/enrichment -> SQLite.
 * Returns counters for the sync_runs table.
 */
export async function runSupplierSync({ db, adapter, ai, config, marginPercent, logger }) {
  // Larger flushes keep the AI worker pool saturated instead of waiting
  // for one small batch at a time.
  const batchSize = config.sync.batchSize ?? DEFAULT_BATCH_SIZE;
  const startedAt = new Date().toISOString();
  const runId = run(
    db,
    `INSERT INTO sync_runs (supplier_id, started_at, status) VALUES (?, ?, 'running')`,
    { 1: adapter.id, 2: startedAt },
  ).lastInsertRowid;

  const counters = { fetched: 0, published: 0, rejected: 0, updated: 0 };
  let batch = [];
  let message = '';

  const flush = async () => {
    if (batch.length === 0) return;
    const results = await ai.enrichBatch(batch, { marginPercent });
    transaction(db, () => {
      for (const result of results) {
        if (!result.ok) {
          counters.rejected += 1;
          recordRejection(db, adapter.id, result);
          continue;
        }
        const existing = get(db, 'SELECT content_hash FROM products WHERE id = ?', { 1: result.record.id });
        upsertProduct(db, result.record, result.raw.contentHash ?? '');
        if (existing) counters.updated += 1;
        counters.published += 1;
      }
    });
    batch = [];
  };

  try {
    for await (const raw of adapter.fetchProducts({
      maxProducts: config.sync.maxProductsPerSupplier,
      pageSize: config.sync.pageSize,
    })) {
      raw.supplierId = adapter.id;
      raw.contentHash = ai.cacheKey ? ai.cacheKey(raw) : '';
      counters.fetched += 1;
      batch.push(raw);
      if (batch.length >= batchSize) await flush();
    }
    await flush();

    run(
      db,
      `UPDATE sync_runs SET finished_at = ?, status = 'ok', fetched = ?, published = ?, rejected = ?, updated = ?, message = ?
       WHERE id = ?`,
      {
        1: new Date().toISOString(),
        2: counters.fetched,
        3: counters.published,
        4: counters.rejected,
        5: counters.updated,
        6: message,
        7: runId,
      },
    );
    setSetting(db, `last_sync:${adapter.id}`, new Date().toISOString());
    logger.info('sync finished', { supplier: adapter.id, ...counters });
    return { supplierId: adapter.id, status: 'ok', ...counters };
  } catch (error) {
    run(
      db,
      `UPDATE sync_runs SET finished_at = ?, status = 'failed', fetched = ?, published = ?, rejected = ?, updated = ?, message = ?
       WHERE id = ?`,
      {
        1: new Date().toISOString(),
        2: counters.fetched,
        3: counters.published,
        4: counters.rejected,
        5: counters.updated,
        6: error.message.slice(0, 500),
        7: runId,
      },
    );
    logger.error('sync failed', { supplier: adapter.id, error });
    return { supplierId: adapter.id, status: 'failed', error: error.message, ...counters };
  }
}

/** Runs all adapters sequentially (politeness + predictable memory). */
export async function runAllSyncs({ db, adapters, ai, config, logger }) {
  const results = [];
  for (const adapter of adapters) {
    try {
      const healthy = await adapter.healthCheck();
      if (!healthy) {
        logger.warn('supplier skipped: not healthy/configured', { supplier: adapter.id });
        results.push({ supplierId: adapter.id, status: 'skipped' });
        continue;
      }
      const marginPercent = config.suppliers[adapter.id]?.marginPercent;
      const margin = Number.isFinite(marginPercent) ? marginPercent : config.pricing.marginPercent;
      results.push(await runSupplierSync({ db, adapter, ai, config, marginPercent: margin, logger }));
    } catch (error) {
      logger.error('supplier crashed', { supplier: adapter.id, error });
      results.push({ supplierId: adapter.id, status: 'failed', error: error.message });
    }
  }
  return results;
}
