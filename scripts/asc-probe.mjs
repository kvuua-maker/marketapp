#!/usr/bin/env node
/**
 * Probes which App Store Connect API resources exist for the current key.
 * A 404 means "no such route"; 200/400/403 means the resource exists.
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

async function probe(path) {
  const response = await fetch(`${API}${path}`, {
    method: 'GET',
    headers: { authorization: `Bearer ${jwt()}`, 'content-type': 'application/json' },
  });
  const text = await response.text();
  const preview = text.slice(0, 220).replace(/\s+/g, ' ');
  console.log(`${String(response.status).padEnd(4)} ${path}\n     ${preview}\n`);
  return response.status;
}

const apps = await fetch(`${API}/apps?filter%5BbundleId%5D=${BUNDLE}&limit=1`, {
  headers: { authorization: `Bearer ${jwt()}` },
}).then((r) => r.json());
const appId = apps?.data?.[0]?.id;
console.log(`app id: ${appId}\n`);

const versions = await fetch(`${API}/apps/${appId}/appStoreVersions?limit=1`, {
  headers: { authorization: `Bearer ${jwt()}` },
}).then((r) => r.json());
const versionId = versions?.data?.[0]?.id;
const locs = await fetch(`${API}/appStoreVersions/${versionId}/appStoreVersionLocalizations?limit=5`, {
  headers: { authorization: `Bearer ${jwt()}` },
}).then((r) => r.json());
const locId = locs?.data?.[0]?.id;
console.log(`version ${versionId} localization ${locId}\n`);

// Asset Library discovery (undocumented in older OpenAPI, live since 2026-10).
const lib = await fetch(`${API}/apps/${appId}/assetLibrary`, {
  headers: { authorization: `Bearer ${jwt()}` },
});
const libText = await lib.text();
console.log(`assetLibrary -> HTTP ${lib.status}\n${libText.slice(0, 400)}\n`);
let libraryId = null;
try { libraryId = JSON.parse(libText)?.data?.id; } catch {}

if (libraryId) {
  await probe(`/appAssetLibraries/${libraryId}/images?limit=3`);
  await probe(`/appAssetLibraries/${libraryId}/videos?limit=1`);
  await probe(`/appAssetLibraryRefData`);
}

// Learn the required attributes for a new creative image (mutation is a draft only).
const createBody = {
  data: {
    type: 'appAssetLibraryImages',
    attributes: { fileName: 'probe.png', fileSize: 1024, category: 'CREATIVE_ASSETS' },
    relationships: { appAssetLibrary: { data: { type: 'appAssetLibraries', id: libraryId } } },
  },
};
const created = await fetch(`${API}/appAssetLibraryImages`, {
  method: 'POST',
  headers: { authorization: `Bearer ${jwt()}`, 'content-type': 'application/json' },
  body: JSON.stringify(createBody),
});
const createdText = await created.text();
console.log(`POST appAssetLibraryImages -> HTTP ${created.status}\n${createdText.slice(0, 700)}\n`);

const candidates = [
  '/appAssetLibraryImages?limit=5',
  `/apps/${appId}/appAssetLibraryImages?limit=5`,
  '/appAssetLibraryPlacements?limit=5',
  `/apps/${appId}/appAssetLibraryPlacements?limit=5`,
  `/appStoreVersions/${versionId}/appAssetLibraryPlacements?limit=5`,
  `/appStoreVersionLocalizations/${locId}/appAssetLibraryPlacements?limit=5`,
  '/appPrivacyDetails?limit=5',
  `/apps/${appId}/appPrivacyDetails`,
  '/appDataUsages?limit=5',
  '/appDataCategories?limit=5',
  '/reviewSubmissions?limit=5',
  `/apps/${appId}/reviewSubmissions?limit=5`,
  '/appStoreVersionExperimentsV2?limit=5',
  '/productPageVersions?limit=5',
  '/appCustomProductPages?limit=5',
  '/endUserLicenseAgreements?limit=5',
];

for (const path of candidates) {
  try {
    await probe(path);
  } catch (error) {
    console.log(`ERR  ${path} -> ${error.message}\n`);
  }
}
