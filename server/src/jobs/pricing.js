/**
 * Dynamic pricing job: competitor prices → decision → storefront price.
 *
 * Sources: Prom.ua (live) and hotline.ua (best-effort; its legacy search route
 * currently answers with a stub, which the engine treats as "no data" and
 * therefore keeps the current price).
 */
import { all, get, run } from '../db/database.js';
import { searchProm, searchHotline } from '../pricing/competitors.js';
import { matchScore } from '../pricing/matcher.js';
import { decidePrice, marginPercent } from '../pricing/engine.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function candidates(db, { limit, pauseDays }) {
  return all(
    db,
    `SELECT p.id, p.title, p.cost_cents, p.price_cents, p.stock, p.vendor,
            (SELECT COUNT(*) FROM events e
              WHERE e.product_id = p.id AND e.created_at >= datetime('now', '-30 days')) AS views
       FROM products p
       LEFT JOIN pricing_pauses pp ON pp.product_id = p.id
      WHERE p.stock > 0 AND p.cost_cents > 0 AND p.price_cents > 0
        AND (pp.product_id IS NULL OR pp.created_at < datetime('now', ?))
      ORDER BY views DESC, p.cost_cents DESC
      LIMIT ?`,
    [`-${pauseDays} days`, limit],
  );
}

export async function runDynamicPricing({ db, config, logger, limit }) {
  const opts = config.pricing.dynamic;
  const max = limit ?? opts.maxProductsPerRun;
  const rows = candidates(db, { limit: max, pauseDays: opts.pauseDays });
  const now = () => new Date().toISOString();

  const stats = {
    scanned: 0,
    matched: 0,
    updated: 0,
    floor: 0,
    paused: 0,
    noData: 0,
    unchanged: 0,
    dryRun: 0,
    errors: 0,
    marginSum: 0,
    marginCount: 0,
  };

  logger.info('dynamic pricing started', {
    products: rows.length,
    sources: opts.sources,
    floorMargin: opts.floorMarginPercent,
    undercut: opts.undercutPercent,
    maxMargin: opts.maxMarginPercent,
  });

  for (const product of rows) {
    stats.scanned += 1;
    const query = product.title.slice(0, 90);

    const offers = [];
    let source = '';
    try {
      if (opts.sources.includes('prom')) {
        const prom = await searchProm(query, { timeoutMs: opts.timeoutMs });
        if (prom.length > 0) source = 'prom';
        offers.push(...prom);
      }
      if (opts.sources.includes('hotline')) {
        const hotline = await searchHotline(query, { timeoutMs: opts.timeoutMs });
        if (hotline.length > 0) source = source ? `${source}+hotline` : 'hotline';
        offers.push(...hotline);
      }
    } catch (error) {
      stats.errors += 1;
      logger.warn('competitor fetch failed — keeping current price', {
        productId: product.id,
        error: error.message,
      });
    }

    const matched = offers
      .map((offer) => ({ ...offer, score: matchScore(product.title, offer.title, { vendor: product.vendor }) }))
      .filter((offer) => offer.score >= opts.minMatchScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);

    if (matched.length > 0) stats.matched += 1;

    for (const offer of matched.slice(0, 5)) {
      run(
        db,
        `INSERT INTO competitor_prices
           (product_id, source, competitor_title, competitor_url, price_cents, match_score, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [product.id, source || 'unknown', offer.title, offer.url, offer.priceCents, offer.score, now()],
      );
    }

    const decision = decidePrice({
      costCents: product.cost_cents,
      currentPriceCents: product.price_cents,
      competitorPrices: matched.map((offer) => offer.priceCents),
      options: {
        floorMarginPercent: opts.floorMarginPercent,
        undercutPercent: opts.undercutPercent,
        maxMarginPercent: opts.maxMarginPercent,
        maxDailyChangePercent: opts.maxDailyChangePercent,
      },
    });

    run(
      db,
      `INSERT INTO price_recommendations
         (product_id, old_price_cents, new_price_cents, floor_cents, ceiling_cents,
          cheapest_cents, status, reason, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        product.id,
        product.price_cents,
        decision.priceCents,
        decision.floorPrice ?? null,
        decision.ceilingPrice ?? null,
        decision.cheapestCents ?? null,
        decision.status,
        decision.reason ?? '',
        source || 'none',
        now(),
      ],
    );

    if ((decision.status === 'updated' || decision.status === 'floor') && opts.dryRun) {
      stats.dryRun += 1;
      logger.info('price would change (dry run)', {
        productId: product.id,
        from: product.price_cents,
        to: decision.priceCents,
        reason: decision.reason,
      });
    } else if (decision.status === 'updated' || decision.status === 'floor') {
      run(
        db,
        'UPDATE products SET price_cents = ?, margin_percent = ?, updated_at = ? WHERE id = ?',
        [decision.priceCents, marginPercent(decision.priceCents, product.cost_cents), now(), product.id],
      );
      run(
        db,
        `INSERT INTO price_history (product_id, price_cents, old_price_cents, reason, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [product.id, decision.priceCents, product.price_cents, decision.reason, now()],
      );
      stats.updated += 1;
      if (decision.status === 'floor') stats.floor += 1;
      stats.marginSum += marginPercent(decision.priceCents, product.cost_cents);
      stats.marginCount += 1;
      logger.info('price updated', {
        productId: product.id,
        from: product.price_cents,
        to: decision.priceCents,
        status: decision.status,
        reason: decision.reason,
      });
    } else if (decision.status === 'paused') {
      stats.paused += 1;
      run(
        db,
        `INSERT INTO pricing_pauses (product_id, reason, created_at) VALUES (?, ?, ?)
         ON CONFLICT(product_id) DO UPDATE SET reason = excluded.reason, created_at = excluded.created_at`,
        [product.id, decision.reason, now()],
      );
      logger.warn('pricing paused for product', { productId: product.id, reason: decision.reason });
    } else if (decision.status === 'no_data') {
      stats.noData += 1;
    } else {
      stats.unchanged += 1;
    }

    if (opts.requestDelayMs > 0) await sleep(opts.requestDelayMs);
  }

  const avgMargin = stats.marginCount > 0 ? stats.marginSum / stats.marginCount : 0;
  const summary = { ...stats, avgMargin };
  logger.info('dynamic pricing finished', summary);
  return summary;
}
