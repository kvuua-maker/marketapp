#!/usr/bin/env node
/**
 * Read-only App Store Connect audit for MarketApp.
 * Prints what exists and what is still empty, so the metadata step can be
 * planned against real IDs instead of guesses.
 */
import { createSign } from 'node:crypto';

const API = 'https://api.appstoreconnect.apple.com/v1';
const BUNDLE = process.env.APP_BUNDLE_ID ?? 'com.kvuua.marketapp';

function jwt() {
  const keyId = process.env.ASC_KEY_ID;
  const issuer = process.env.ASC_ISSUER_ID;
  const key = (process.env.ASC_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');

  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: 'ES256', kid: keyId, typ: 'JWT' })}.${b64({
    iss: issuer,
    iat: now,
    exp: now + 900,
    aud: 'appstoreconnect-v1',
  })}`;
  const signature = createSign('SHA256')
    .update(unsigned)
    .sign({ key, dsaEncoding: 'ieee-p1363' })
    .toString('base64url');
  return `${unsigned}.${signature}`;
}

let TOKEN = jwt();

async function api(path, options = {}) {
  if (options.method && options.method !== 'GET') {
    TOKEN = jwt();
  }
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 400) };
  }
  if (!response.ok) {
    return { ok: false, status: response.status, body };
  }
  return { ok: true, status: response.status, body };
}

function show(label, result) {
  if (!result.ok) {
    console.log(`${label}: HTTP ${result.status} ${JSON.stringify(result.body).slice(0, 300)}`);
    return;
  }
  console.log(`${label}: OK`);
}

const out = {};

const apps = await api(`/apps?filter%5BbundleId%5D=${BUNDLE}&limit=5`);
show('apps', apps);
const app = apps.body?.data?.[0];
if (!app) {
  console.log('APP RECORD NOT FOUND');
  process.exit(2);
}
out.app = { id: app.id, name: app.attributes.name, bundleId: app.attributes.bundleId, sku: app.attributes.sku };

const infos = await api(`/apps/${app.id}/appInfos?limit=5`);
show('appInfos', infos);
const info = infos.body?.data?.[0];
out.appInfo = info ? { id: info.id, state: info.attributes?.state } : null;

if (info) {
  const localizations = await api(`/appInfos/${info.id}/appInfoLocalizations?limit=20`);
  show('appInfoLocalizations', localizations);
  out.appInfoLocalizations = (localizations.body?.data ?? []).map((row) => ({
    id: row.id,
    locale: row.attributes?.locale,
    name: row.attributes?.name,
    subtitle: row.attributes?.subtitle,
    privacyPolicyUrl: row.attributes?.privacyPolicyUrl,
  }));

  const age = await api(`/appInfos/${info.id}/ageRatingDeclaration`);
  show('ageRatingDeclaration', age);
  out.ageRating = age.body?.data
    ? { id: age.body.data.id, ...age.body.data.attributes }
    : null;
}

const versions = await api(`/apps/${app.id}/appStoreVersions?limit=10`);
show('appStoreVersions', versions);
out.versions = (versions.body?.data ?? []).map((row) => ({
  id: row.id,
  versionString: row.attributes?.versionString,
  state: row.attributes?.appStoreState,
  platform: row.attributes?.platform,
  createdDate: row.attributes?.createdDate,
}));

const version = versions.body?.data?.[0];
if (version) {
  const localizations = await api(`/appStoreVersions/${version.id}/appStoreVersionLocalizations?limit=20`);
  show('appStoreVersionLocalizations', localizations);
  out.versionLocalizations = (localizations.body?.data ?? []).map((row) => ({
    id: row.id,
    locale: row.attributes?.locale,
    descriptionLength: (row.attributes?.description ?? '').length,
    keywords: row.attributes?.keywords,
    supportUrl: row.attributes?.supportUrl,
    marketingUrl: row.attributes?.marketingUrl,
    privacyPolicyUrl: row.attributes?.privacyPolicyUrl,
  }));

  const build = await api(`/appStoreVersions/${version.id}/build`);
  show('version.build', build);
  out.versionBuild = build.body?.data ? { id: build.body.data.id, version: build.body.data.attributes?.version } : null;

  const sets = await api(`/appStoreVersions/${version.id}/appStoreVersionLocalizations?limit=20`);
  const localeId = sets.body?.data?.[0]?.id;
  if (localeId) {
    const screenshots = await api(`/appStoreVersionLocalizations/${localeId}/appScreenshotSets?limit=20`);
    show('appScreenshotSets', screenshots);
    out.screenshotSets = [];
    for (const row of screenshots.body?.data ?? []) {
      const shots = await api(`/appScreenshotSets/${row.id}/appScreenshots?limit=10`);
      out.screenshotSets.push({
        id: row.id,
        type: row.attributes?.screenshotDisplayType,
        screenshots: (shots.body?.data ?? []).map((shot) => ({
          fileName: shot.attributes?.fileName,
          uploaded: shot.attributes?.uploaded,
          state: shot.attributes?.assetDeliveryState?.state,
          errors: shot.attributes?.assetDeliveryState?.errors ?? null,
        })),
      });
    }
  }
}

const builds = await api(`/apps/${app.id}/builds?limit=5&sort=-uploadedDate`);
show('builds', builds);
out.builds = (builds.body?.data ?? []).map((row) => ({
  id: row.id,
  version: row.attributes?.version,
  processingState: row.attributes?.processingState,
  uploadedDate: row.attributes?.uploadedDate,
  expired: row.attributes?.expired,
}));

const eula = await api(`/apps/${app.id}/endUserLicenseAgreement`);
show('endUserLicenseAgreement', eula);
out.eula = eula.body?.data ? { id: eula.body.data.id } : null;

const appStoreLocalizations = await api(`/apps/${app.id}/appStoreVersionExperiments?limit=1`).catch(() => null);
void appStoreLocalizations;

console.log('\n=== AUDIT JSON ===');
console.log(JSON.stringify(out, null, 2));
