import { UpstreamError } from './errors.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 3;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt) {
  return Math.min(800 * 2 ** attempt, 8000) + Math.floor(Math.random() * 250);
}

/**
 * HTTP fetch with timeout and retry/backoff for transient failures (429/5xx/network).
 * Uses the global fetch (Node 18+), no dependencies.
 */
export async function fetchWithRetry(url, options = {}) {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_RETRIES,
    headers = {},
    method = 'GET',
    body,
    label = url,
  } = options;

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        body,
        headers: {
          accept: 'application/json, text/xml, application/xml;q=0.9, */*;q=0.8',
          'user-agent': 'MarketApp/1.0 (+https://github.com/)',
          ...headers,
        },
        signal: controller.signal,
      });

      if (response.status === 429 || response.status >= 500) {
        const retryAfter = Number(response.headers.get('retry-after'));
        const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoffMs(attempt);
        lastError = new UpstreamError(`${label}: upstream responded ${response.status}`);
        if (attempt < retries) {
          await sleep(wait);
          continue;
        }
        throw lastError;
      }

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new UpstreamError(`${label}: upstream responded ${response.status}`, {
          status: response.status,
          body: text.slice(0, 300),
        });
      }

      return response;
    } catch (error) {
      clearTimeout(timer);
      if (error instanceof UpstreamError && error.status && error.status < 500 && error.status !== 429) {
        throw error;
      }
      lastError = error;
      if (attempt < retries) {
        await sleep(backoffMs(attempt));
        continue;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw new UpstreamError(`${label}: request failed`, { cause: lastError?.message });
}

export async function fetchJson(url, options = {}) {
  const response = await fetchWithRetry(url, options);
  return response.json();
}

export async function fetchText(url, options = {}) {
  const response = await fetchWithRetry(url, options);
  return response.text();
}
