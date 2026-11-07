/**
 * Telegram notifications for the supplier sync.
 * No-op when TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID are not configured, so the
 * pipeline never fails because of a missing notification channel.
 */

export function telegramConfigured(config) {
  const telegram = config?.notifications?.telegram;
  return Boolean(telegram?.token && telegram?.chatId);
}

/** Human-readable summary of one sync run (pure, unit-tested). */
export function formatSyncSummary({ reason = 'interval', results = [], error = null, catalog = null } = {}) {
  if (error) {
    return [
      '❌ MarketApp sync failed',
      `reason: ${reason}`,
      `error: ${String(error.message ?? error).slice(0, 400)}`,
    ].join('\n');
  }

  const lines = [`✅ MarketApp sync (${reason})`];
  for (const result of results) {
    const counters = result?.counters ?? result ?? {};
    lines.push(
      `• ${result?.supplierId ?? 'supplier'}: fetched ${counters.fetched ?? 0}, published ${counters.published ?? 0}, ` +
        `updated ${counters.updated ?? 0}, rejected ${counters.rejected ?? 0}, duplicates ${counters.duplicates ?? 0}`,
    );
    if (result?.error) lines.push(`  ⚠️ ${String(result.error).slice(0, 200)}`);
  }
  if (catalog) {
    lines.push(`Каталог: ${catalog.products} товарів / ${catalog.inStock} в наявності`);
  }
  return lines.join('\n');
}

export async function notifySync({ config, logger, reason, results = [], error = null, catalog = null } = {}) {
  if (!telegramConfigured(config)) return false;

  const telegram = config.notifications.telegram;
  const text = formatSyncSummary({ reason, results, error, catalog });

  try {
    const response = await fetch(`https://api.telegram.org/bot${telegram.token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: telegram.chatId,
        text: text.slice(0, 3800),
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      logger?.warn('telegram notification rejected', { status: response.status });
      return false;
    }
    logger?.info('telegram notification sent', { reason });
    return true;
  } catch (notifyError) {
    logger?.warn('telegram notification failed', { error: notifyError.message });
    return false;
  }
}
