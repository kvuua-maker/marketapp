#!/usr/bin/env node
/**
 * Uploads simulator screenshots to App Store Connect.
 *
 * Usage: node scripts/asc-screenshots.mjs <iphone.png> <ipad.png>
 * Display types: APP_IPHONE_69 (1320×2868), APP_IPAD_PRO_3GEN_129 (2048×2732 / 2064×2752)
 */
import { createSign, createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';

const API = 'https://api.appstoreconnect.apple.com/v1';
const BUNDLE = process.env.APP_BUNDLE_ID ?? 'com.kvuua.marketapp';

function jwt() {
  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: 'ES256', kid: process.env.ASC_KEY_ID, typ: 'JWT' })}.${b64({
    iss: process.env.ASC_ISSUER_ID,
    iat: now,
    exp: now + 900,
    aud: 'appstoreconnect-v1',
  })}`;
  const signature = createSign('SHA256')
    .update(unsigned)
    .sign({ key: (process.env.ASC_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'), dsaEncoding: 'ieee-p1363' })
    .toString('base64url');
  return `${unsigned}.${signature}`;
}

async function api(method, path, body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${jwt()}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text.slice(0, 300) };
  }
  if (!response.ok) {
    console.log(`  ✗ ${method} ${path} -> HTTP ${response.status} ${JSON.stringify(parsed).slice(0, 400)}`);
  } else {
    console.log(`  ✓ ${method} ${path}`);
  }
  return { ok: response.ok, status: response.status, body: parsed };
}

const files = [
  { path: process.argv[2], type: 'APP_IPHONE_69', name: 'iphone-catalog.png' },
  { path: process.argv[3], type: 'APP_IPAD_PRO_3GEN_129', name: 'ipad-catalog.png' },
].filter((entry) => entry.path);

const apps = await api('GET', `/apps?filter%5BbundleId%5D=${BUNDLE}&limit=5`);
const app = apps.body?.data?.[0];
const versions = await api('GET', `/apps/${app.id}/appStoreVersions?limit=10`);
const version = versions.body?.data?.[0];
const localizations = await api('GET', `/appStoreVersions/${version.id}/appStoreVersionLocalizations?limit=20`);
const localization = localizations.body?.data?.find((row) => row.attributes?.locale === 'uk') ?? localizations.body?.data?.[0];
console.log(`localization ${localization.id} (${localization.attributes?.locale})`);

const existingSets = await api('GET', `/appStoreVersionLocalizations/${localization.id}/appScreenshotSets?limit=50`);
const setByType = new Map((existingSets.body?.data ?? []).map((row) => [row.attributes.screenshotDisplayType, row.id]));

for (const file of files) {
  const data = readFileSync(file.path);
  const size = statSync(file.path).size;
  console.log(`\n${file.name}: ${(size / 1024).toFixed(0)} KB, type ${file.type}`);

  let setId = setByType.get(file.type);
  if (!setId) {
    const created = await api('POST', '/appScreenshotSets', {
      data: {
        type: 'appScreenshotSets',
        attributes: { screenshotDisplayType: file.type },
        relationships: { appStoreVersionLocalization: { data: { type: 'appStoreVersionLocalizations', id: localization.id } } },
      },
    });
    setId = created.body?.data?.id;
  }
  if (!setId) continue;
  console.log(`  set ${setId}`);

  const existing = await api('GET', `/appScreenshotSets/${setId}/appScreenshots?limit=50`);
  if ((existing.body?.data ?? []).length > 0) {
    console.log('  screenshots already present, skipping upload');
    continue;
  }

  const reserved = await api('POST', '/appScreenshots', {
    data: {
      type: 'appScreenshots',
      attributes: { fileSize: size, fileName: file.name },
      relationships: { appScreenshotSet: { data: { type: 'appScreenshotSets', id: setId } } },
    },
  });
  const screenshot = reserved.body?.data;
  if (!screenshot) continue;

  for (const operation of screenshot.attributes?.uploadOperations ?? []) {
    const response = await fetch(operation.url, {
      method: operation.method ?? 'PUT',
      headers: operation.requestHeaders ?? {},
      body: data.subarray(operation.offset ?? 0, (operation.offset ?? 0) + (operation.length ?? data.length)),
    });
    console.log(`  upload chunk ${operation.length ?? data.length} -> HTTP ${response.status}`);
  }

  await api('PATCH', `/appScreenshots/${screenshot.id}`, {
    data: {
      type: 'appScreenshots',
      id: screenshot.id,
      attributes: { uploaded: true, sourceFileChecksum: createHash('md5').update(data).digest('hex') },
    },
  });
}

console.log('\nscreenshots done');
