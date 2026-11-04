#!/usr/bin/env node
/**
 * One-shot App Store Connect fixes for MarketApp:
 * content rights, copyright, MarketApp URLs (not Vakansio), review details.
 */
import { createSign } from 'node:crypto';

const API = 'https://api.appstoreconnect.apple.com/v1';
const BUNDLE = process.env.APP_BUNDLE_ID ?? 'com.kvuua.marketapp';
const SITE = 'https://kvuua-maker.github.io/marketapp';

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
  console.log(`  ${response.ok ? '✓' : '✗'} ${method} ${path} -> HTTP ${response.status}${response.ok ? '' : ' ' + JSON.stringify(parsed).slice(0, 400)}`);
  return { ok: response.ok, status: response.status, body: parsed };
}

const apps = await api('GET', `/apps?filter%5BbundleId%5D=${BUNDLE}&limit=5`);
const app = apps.body?.data?.[0];
const infos = await api('GET', `/apps/${app.id}/appInfos?limit=5`);
const info = infos.body?.data?.[0];
const infosLoc = await api('GET', `/appInfos/${info.id}/appInfoLocalizations?limit=20`);
const infoLoc = infosLoc.body?.data?.find((row) => row.attributes?.locale === 'uk') ?? infosLoc.body?.data?.[0];
const versions = await api('GET', `/apps/${app.id}/appStoreVersions?limit=10`);
const version = versions.body?.data?.[0];
const versionsLoc = await api('GET', `/appStoreVersions/${version.id}/appStoreVersionLocalizations?limit=20`);
const versionLoc = versionsLoc.body?.data?.find((row) => row.attributes?.locale === 'uk') ?? versionsLoc.body?.data?.[0];

// 1. Content rights (app-level)
console.log('content rights:');
await api('PATCH', `/apps/${app.id}`, {
  data: { type: 'apps', id: app.id, attributes: { contentRightsDeclaration: 'DOES_NOT_USE_THIRD_PARTY_CONTENT' } },
});

// 2. Copyright (version-level)
console.log('copyright:');
await api('PATCH', `/appStoreVersions/${version.id}`, {
  data: { type: 'appStoreVersions', id: version.id, attributes: { copyright: '2026 MarketApp' } },
});

// 3. Support URL on the MarketApp site, marketing URL removed
console.log('support / marketing url:');
await api('PATCH', `/appStoreVersionLocalizations/${versionLoc.id}`, {
  data: {
    type: 'appStoreVersionLocalizations',
    id: versionLoc.id,
    attributes: {
      supportUrl: `${SITE}/support.html`,
      marketingUrl: null,
    },
  },
});

// 4. Privacy policy URL at app-info level
console.log('privacy policy url:');
await api('PATCH', `/appInfoLocalizations/${infoLoc.id}`, {
  data: {
    type: 'appInfoLocalizations',
    id: infoLoc.id,
    attributes: { privacyPolicyUrl: `${SITE}/marketapp_privacy.html` },
  },
});

// 5. App Review Information
console.log('review details:');
const existing = await api('GET', `/appStoreVersions/${version.id}/appStoreReviewDetail`);
const attributes = {
  contactFirstName: 'Vladyslav',
  contactLastName: 'Khomenko',
  contactPhone: '+380974690000',
  contactEmail: 'kvuua@yahoo.com',
  demoAccountRequired: false,
  notes: 'No demo account required. The app uses guest checkout. Payment is cash on delivery via Nova Poshta.',
};
const current = Array.isArray(existing.body?.data) ? existing.body.data[0] : existing.body?.data;
if (current) {
  await api('PATCH', `/appStoreReviewDetails/${current.id}`, {
    data: { type: 'appStoreReviewDetails', id: current.id, attributes },
  });
} else {
  await api('POST', '/appStoreReviewDetails', {
    data: {
      type: 'appStoreReviewDetails',
      attributes,
      relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: version.id } } },
    },
  });
}

console.log('\ndone');
