#!/usr/bin/env node
/**
 * Removes the custom End User License Agreement so the app falls back to
 * Apple's standard license. Idempotent: safe to run when none exists.
 */
import { createSign } from 'node:crypto';

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

async function api(method, path) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${jwt()}`, 'content-type': 'application/json' },
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  console.log(`  ${response.ok ? '✓' : '✗'} ${method} ${path} -> HTTP ${response.status}`);
  return { ok: response.ok, status: response.status, body };
}

const apps = await api('GET', `/apps?filter%5BbundleId%5D=${BUNDLE}&limit=5`);
const app = apps.body?.data?.[0];
if (!app) {
  console.log('app not found');
  process.exit(2);
}

const current = await api('GET', `/apps/${app.id}/endUserLicenseAgreement`);
const eula = current.body?.data;
if (!eula) {
  console.log('no custom EULA — Apple standard license already applies');
  process.exit(0);
}

console.log(`custom EULA ${eula.id} found, deleting…`);
await api('DELETE', `/endUserLicenseAgreements/${eula.id}`);

const after = await api('GET', `/apps/${app.id}/endUserLicenseAgreement`);
if (after.status === 404 || !after.body?.data) {
  console.log('done: custom EULA removed, Apple standard license is in effect');
} else {
  console.log('warning: EULA still present');
  process.exit(3);
}
