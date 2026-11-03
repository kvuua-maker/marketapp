import { getSetting, setSetting } from '../db/database.js';

/**
 * Simple interval scheduler (no cron dependency).
 * - runs immediately on boot when the last sync is older than `staleAfterMinutes`
 * - then every `intervalMinutes`
 * - never overlaps two syncs
 */
export function startScheduler({ db, intervalMinutes, staleAfterMinutes, runNow, logger }) {
  let running = false;
  let timer = null;
  let stopped = false;

  const tick = async (reason) => {
    if (running || stopped) return { skipped: true };
    running = true;
    const startedAt = Date.now();
    try {
      logger.info('sync started', { reason });
      const results = await runNow(reason);
      setSetting(db, 'last_sync_global', new Date().toISOString());
      logger.info('sync completed', { reason, ms: Date.now() - startedAt, results: results?.length ?? 0 });
      return results;
    } catch (error) {
      logger.error('scheduler run failed', { reason, error });
      return { error: error.message };
    } finally {
      running = false;
    }
  };

  const intervalMs = Math.max(intervalMinutes, 1) * 60_000;
  timer = setInterval(() => { void tick('interval'); }, intervalMs);
  timer.unref?.();

  const lastSync = getSetting(db, 'last_sync_global');
  const stale = !lastSync || Date.now() - Date.parse(lastSync) > staleAfterMinutes * 60_000;
  if (stale) {
    const boot = setTimeout(() => { void tick('startup'); }, 2_000);
    boot.unref?.();
  }

  return {
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
    },
    trigger: (reason = 'manual') => tick(reason),
    get isRunning() { return running; },
  };
}
