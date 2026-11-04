#!/usr/bin/env node
/**
 * Fills App Store Connect metadata for MarketApp and attaches the newest
 * build. Safe to re-run: every step is an idempotent PATCH where possible.
 *
 * Required env: ASC_KEY_ID, ASC_ISSUER_ID, ASC_PRIVATE_KEY
 */
import { createSign } from 'node:crypto';

const API = 'https://api.appstoreconnect.apple.com/v1';
const BUNDLE = process.env.APP_BUNDLE_ID ?? 'com.kvuua.marketapp';

const LEGAL = 'https://kvuua-maker.github.io/Vakansio/legal';

const CONTENT = {
  name: 'MarketApp: електроніка',
  subtitle: 'Побутова техніка з доставкою',
  privacyPolicyUrl: `${LEGAL}/marketapp_privacy.html`,
  supportUrl: `${LEGAL}/support.html`,
  marketingUrl: `${LEGAL}/support.html`,
  promotionalText:
    'Електроніка та товари для дому з доставкою Новою Поштою. Оплата при отриманні, повернення 14 днів.',
  keywords:
    'електроніка,побутова техніка,кухня,краса,навушники,праска,каструля,доставка,нова пошта,знижки',
  description: `MarketApp — це магазин електроніки та товарів для дому в одному застосунку. Знаходьте техніку для кухні, краси, дому та гаджети за чесними цінами й замовляйте за кілька натискань.

ЩО Є В ЗАСТОСУНКУ
• Каталог з реальними фото, цінами та наявністю — оновлюється автоматично
• Розумний пошук українською: підказки товарів, брендів і категорій
• Фільтри за ціною, брендом і наявністю та сортування
• Картка товару з галереєю, зумом, характеристиками й відгуками
• Кошик, що зберігається між пристроями
• Оформлення без реєстрації: імʼя, телефон, місто та відділення
• Історія замовлень, повторне замовлення і скасування до відправлення

ДОСТАВКА ТА ОПЛАТА
• Доставка Новою Поштою у відділення по всій Україні
• Оплата при отриманні (післяплата) — без онлайн-оплат і без карток
• Термін доставки зазвичай 1–3 робочі дні
• Повернення та обмін протягом 14 днів

ЧОМУ MarketApp
• Ціни без прихованих доплат
• Наявність і ціни оновлюються автоматично кілька разів на годину
• Підтримка відповідає протягом 24 годин

Питання чи побажання — пишіть на kvuua@yahoo.com.`,
};

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
    headers: {
      authorization: `Bearer ${jwt()}`,
      'content-type': 'application/json',
    },
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
    const detail = JSON.stringify(parsed).slice(0, 500);
    console.log(`  ✗ ${method} ${path} -> HTTP ${response.status} ${detail}`);
    return { ok: false, status: response.status, body: parsed };
  }
  console.log(`  ✓ ${method} ${path}`);
  return { ok: true, status: response.status, body: parsed };
}

async function patch(path, type, id, attributes) {
  return api('PATCH', path, { data: { type, id, attributes } });
}

// ---------------------------------------------------------------- audit ids
const apps = await api('GET', `/apps?filter%5BbundleId%5D=${BUNDLE}&limit=5`);
const app = apps.body?.data?.[0];
if (!app) {
  console.log('App record not found');
  process.exit(2);
}
console.log(`app ${app.id} (${app.attributes.name})`);

const infos = await api('GET', `/apps/${app.id}/appInfos?limit=5`);
const info = infos.body?.data?.[0];
const infoLoc = (await api('GET', `/appInfos/${info.id}/appInfoLocalizations?limit=20`)).body?.data?.[0];

const versions = await api('GET', `/apps/${app.id}/appStoreVersions?limit=10`);
const version = versions.body?.data?.[0];
const versionLoc = (await api('GET', `/appStoreVersions/${version.id}/appStoreVersionLocalizations?limit=20`))
  .body?.data?.[0];

console.log(`info ${info.id} / loc ${infoLoc?.id} (${infoLoc?.locale})`);
console.log(`version ${version.id} ${version.attributes?.versionString} / loc ${versionLoc?.id} (${versionLoc?.locale})`);

// ------------------------------------------------------------- name & links
if (infoLoc) {
  console.log('name / subtitle / privacy policy:');
  await patch(`/appInfoLocalizations/${infoLoc.id}`, 'appInfoLocalizations', infoLoc.id, {
    name: CONTENT.name,
    subtitle: CONTENT.subtitle,
    privacyPolicyUrl: CONTENT.privacyPolicyUrl,
  });
}

// --------------------------------------------------------- version metadata
if (versionLoc) {
  console.log('description / keywords / urls:');
  await patch(`/appStoreVersionLocalizations/${versionLoc.id}`, 'appStoreVersionLocalizations', versionLoc.id, {
    description: CONTENT.description,
    keywords: CONTENT.keywords,
    supportUrl: CONTENT.supportUrl,
    marketingUrl: CONTENT.marketingUrl,
    promotionalText: CONTENT.promotionalText,
  });
}

// ------------------------------------------------------------- age rating
const age = await api('GET', `/appInfos/${info.id}/ageRatingDeclaration`);
const ageId = age.body?.data?.id;
if (ageId) {
  console.log('age rating (4+):');
  // Apple requires EVERY field in one request, and the schema mixes booleans
  // with string enums. Send all booleans first; the error lists the enum fields.
  const fields = [
    'advertising', 'alcoholTobaccoOrDrugUseOrReferences', 'contests', 'gambling', 'gamblingSimulated',
    'gunsOrOtherWeapons', 'healthOrWellnessTopics', 'lootBox', 'medicalOrTreatmentInformation',
    'messagingAndChat', 'parentalControls', 'profanityOrCrudeHumor', 'sexualContentGraphicAndNudity',
    'sexualContentOrNudity', 'horrorOrFearThemes', 'matureOrSuggestiveThemes', 'unrestrictedWebAccess',
    'userGeneratedContent', 'violenceCartoonOrFantasy', 'violenceRealisticProlongedGraphicOrSadistic',
    'violenceRealistic', 'socialMedia', 'socialMediaAgeRestricted', 'ageAssurance',
  ];
  let attributes = Object.fromEntries(fields.map((field) => [field, false]));
  attributes.userGeneratedContent = true; // the app has moderated customer reviews

  let attempt = await patch(`/ageRatingDeclarations/${ageId}`, 'ageRatingDeclarations', ageId, attributes);
  if (!attempt.ok) {
    const enumFields = new Set(
      (attempt.body?.errors ?? [])
        .map((error) => error.source?.parameter ?? error.source?.pointer?.split('/').pop())
        .filter(Boolean),
    );
    console.log(`  enum fields: ${[...enumFields].join(', ') || 'none'}`);
    for (const field of enumFields) {
      if (field in attributes) attributes[field] = 'NONE';
    }
    attributes.userGeneratedContent = true;
    attempt = await patch(`/ageRatingDeclarations/${ageId}`, 'ageRatingDeclarations', ageId, attributes);
    if (!attempt.ok) console.log('  age rating still rejected:', JSON.stringify(attempt.body).slice(0, 600));
  }
}

// --------------------------------------------------------------- category
const categories = await api('GET', '/appCategories?limit=200');
const shopping = (categories.body?.data ?? []).find(
  (row) => /shopping/i.test(row.id) || /Shopping/i.test(row.attributes?.name ?? ''),
);
if (shopping) {
  console.log(`category ${shopping.id} (${shopping.attributes?.name}):`);
  await api('PATCH', `/appInfos/${info.id}`, {
    data: {
      type: 'appInfos',
      id: info.id,
      relationships: {
        primaryCategory: { data: { type: 'appCategories', id: shopping.id } },
      },
    },
  });
} else {
  console.log('category: Shopping not found in appCategories response');
}

// --------------------------------------------------------------------- EULA
console.log('EULA:');
const eula = await api('GET', `/apps/${app.id}/endUserLicenseAgreement`);
if (eula.body?.data?.id) {
  await patch(`/endUserLicenseAgreements/${eula.body.data.id}`, 'endUserLicenseAgreements', eula.body.data.id, {
    agreementText: 'Див. Умови використання: ' + `${LEGAL}/marketapp_terms.html`,
  });
} else {
  const territories = await api('GET', '/territories?limit=200');
  const territoryData = (territories.body?.data ?? []).map((row) => ({ type: 'territories', id: row.id }));
  console.log(`  territories: ${territoryData.length}`);
  await api('POST', '/endUserLicenseAgreements', {
    data: {
      type: 'endUserLicenseAgreements',
      attributes: { agreementText: 'Див. Умови використання: ' + `${LEGAL}/marketapp_terms.html` },
      relationships: {
        app: { data: { type: 'apps', id: app.id } },
        territories: { data: territoryData },
      },
    },
  });
}

// ------------------------------------------------------------ attach a build
console.log('builds:');
const builds = await api('GET', `/apps/${app.id}/builds?limit=20`);
const buildList = (builds.body?.data ?? []).filter((row) => row.attributes?.processingState === 'VALID');
buildList.sort((a, b) => Number(b.attributes.version) - Number(a.attributes.version));
const build = buildList[0];
if (build) {
  console.log(`newest VALID build ${build.attributes.version} (${build.id})`);
  await api('PATCH', `/appStoreVersions/${version.id}`, {
    data: {
      type: 'appStoreVersions',
      id: version.id,
      relationships: { build: { data: { type: 'builds', id: build.id } } },
    },
  });
} else {
  console.log('  no VALID build found');
}

console.log('\ndone');
