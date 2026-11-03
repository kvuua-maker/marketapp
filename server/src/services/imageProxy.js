import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

let sharpLib = null;

/** Lazily loads sharp so a missing binary degrades to a passthrough proxy. */
export async function initImageProxy(logger) {
  try {
    const mod = await import('sharp');
    sharpLib = mod.default;
    logger?.info('image proxy ready', { resizer: 'sharp', version: sharpLib.versions?.sharp });
  } catch (error) {
    logger?.warn('sharp unavailable, images will be proxied without resizing', { error: error.message });
  }
  return Boolean(sharpLib);
}

function cacheDir() {
  const dir = new URL('../../data/img-cache/', import.meta.url).pathname;
  mkdirSync(dir, { recursive: true });
  return dir;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'access-control-allow-origin': '*', ...headers });
  res.end(body);
}

/**
 * GET /v1/img?url=<encoded>&w=400
 * Downloads a supplier image, resizes it to WebP and caches it on disk.
 * Only hosts from IMAGE_ALLOWED_HOSTS are fetched (SSRF guard).
 */
export async function handleImageProxy(req, res, url, { config, logger }) {
  const source = url.searchParams.get('url');
  const width = Math.min(Math.max(Number.parseInt(url.searchParams.get('w') ?? '400', 10) || 400, 80), 1200);

  if (!source) {
    send(res, 400, JSON.stringify({ error: { code: 'missing_url', message: 'url is required' } }), {
      'content-type': 'application/json',
    });
    return;
  }

  let target;
  try {
    target = new URL(source);
  } catch {
    send(res, 400, 'bad url', { 'content-type': 'text/plain' });
    return;
  }

  const allowed = config.images.allowedHosts;
  if (!['http:', 'https:'].includes(target.protocol) || !allowed.includes(target.hostname)) {
    send(res, 403, 'host not allowed', { 'content-type': 'text/plain' });
    return;
  }

  const key = createHash('sha1').update(`${target.href}|${width}`).digest('hex');
  const file = join(cacheDir(), `${key}.webp`);
  const cacheHeaders = { 'cache-control': 'public, max-age=31536000, immutable', etag: `"${key}"` };

  if (existsSync(file)) {
    const info = statSync(file);
    res.writeHead(200, {
      'content-type': 'image/webp',
      'content-length': info.size,
      ...cacheHeaders,
    });
    createReadStream(file).pipe(res);
    return;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25_000);
    const response = await fetch(target.href, {
      headers: { 'user-agent': 'MarketApp/1.0 (image proxy)', accept: 'image/*' },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!response.ok) {
      send(res, 502, 'upstream error', { 'content-type': 'text/plain' });
      return;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > 15 * 1024 * 1024) {
      send(res, 413, 'image too large', { 'content-type': 'text/plain' });
      return;
    }

    if (!sharpLib) {
      // Degraded mode: serve the original bytes but still cache them.
      writeFileSync(file.replace(/\.webp$/, '.orig'), buffer);
      res.writeHead(200, {
        'content-type': response.headers.get('content-type') ?? 'image/jpeg',
        'content-length': buffer.byteLength,
        ...cacheHeaders,
      });
      res.end(buffer);
      return;
    }

    const processed = await sharpLib(buffer)
      .rotate()
      .resize({ width, withoutEnlargement: true, fit: 'inside' })
      .webp({ quality: 78, effort: 4 })
      .toBuffer();

    writeFileSync(file, processed);
    res.writeHead(200, {
      'content-type': 'image/webp',
      'content-length': processed.byteLength,
      ...cacheHeaders,
    });
    res.end(processed);
  } catch (error) {
    logger?.warn('image proxy failed', { url: target.href.slice(0, 120), error: error.message });
    send(res, 502, 'proxy error', { 'content-type': 'text/plain' });
  }
}
