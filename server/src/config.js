import process from 'node:process';
import { loadEnvFile } from './core/env.js';

// Load server/.env before any value is read below.
const envFile = loadEnvFile(new URL('../.env', import.meta.url));

function int(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function float(value, fallback) {
  const parsed = Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return !['0', 'false', 'no', 'off'].includes(String(value).toLowerCase());
}

const deepseekKey = process.env.DEEPSEEK_API_KEY ?? '';

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  envFile: envFile.loaded ? envFile.path : null,
  port: int(process.env.PORT, 8787),
  dbPath: process.env.DB_PATH ?? new URL('../data/marketapp.db', import.meta.url).pathname,
  defaultCurrency: 'UAH',

  // Retail price = supplier cost * (1 + margin). Owner never sets prices manually.
  pricing: {
    marginPercent: float(process.env.MARGIN_PERCENT, 15),
    // "x9" = round up so the price always ends with 9 (1499, 349, 99...)
    rounding: process.env.PRICE_ROUNDING ?? 'x9',
    minMarginPercent: float(process.env.MIN_MARGIN_PERCENT, 5),
  },

  sync: {
    intervalMinutes: int(process.env.SYNC_INTERVAL_MINUTES, 90),
    pageSize: int(process.env.SYNC_PAGE_SIZE, 100),
    maxProductsPerSupplier: int(process.env.MAX_PRODUCTS_PER_SYNC, 8000),
    requestConcurrency: int(process.env.SYNC_REQUEST_CONCURRENCY, 3),
    batchSize: int(process.env.SYNC_BATCH_SIZE, 96),
    staleAfterMinutes: int(process.env.SYNC_STALE_AFTER_MINUTES, 180),
  },

  ai: {
    enabled: Boolean(deepseekKey),
    apiKey: deepseekKey,
    baseUrl: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
    model: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
    batchSize: int(process.env.DEEPSEEK_BATCH_SIZE, 12),
    concurrency: int(process.env.DEEPSEEK_CONCURRENCY, 3),
    timeoutMs: int(process.env.DEEPSEEK_TIMEOUT_MS, 90_000),
    maxRetries: int(process.env.DEEPSEEK_MAX_RETRIES, 3),
    minDescriptionChars: int(process.env.AI_MIN_DESCRIPTION_CHARS, 40),
  },

  suppliers: {
    aveopt: {
      enabled: bool(process.env.AVEPTO_ENABLED, true),
      baseUrl: process.env.AVEPTO_BASE_URL ?? 'https://www.aveopt.com.ua',
      // Public WooCommerce Store API — verified live, ~6400 SKU.
      endpoint: '/wp-json/wc/store/v1/products',
      marginPercent: float(process.env.AVEPTO_MARGIN_PERCENT, NaN),
      // api = WooCommerce Store API (default), xml = YML/XML price list.
      source: (process.env.AVEPTO_SOURCE ?? 'api').toLowerCase(),
      xmlUrl: process.env.AVEPTO_XML_URL ?? '',
      xmlPath: process.env.AVEPTO_XML_PATH ?? '',
    },
    lugi: {
      enabled: bool(process.env.LUGI_ENABLED, false),
      baseUrl: process.env.LUGI_API_BASE ?? '',
      companyId: process.env.LUGI_COMPANY_ID ?? '',
      companySecret: process.env.LUGI_COMPANY_SECRET ?? '',
      marginPercent: float(process.env.LUGI_MARGIN_PERCENT, NaN),
    },
    dropt: {
      enabled: bool(process.env.DROPT_ENABLED, true),
      xmlUrl:
        process.env.DROPT_XML_URL ??
        'https://dropt.in.ua/index.php?route=export/prom&markup=0&ids=uniq',
      xmlPath: process.env.DROPT_XML_PATH ?? '',
      marginPercent: float(process.env.DROPT_MARGIN_PERCENT, 15),
      // Daily cycle by default; the main supplier keeps its 90-minute schedule.
      syncIntervalMinutes: int(process.env.DROPT_SYNC_INTERVAL_MINUTES, 1440),
      idPrefix: process.env.DROPT_ID_PREFIX ?? 'dropt_',
    },
    zakupus: {
      enabled: bool(process.env.ZAKUPUS_ENABLED, false),
      xmlUrl: process.env.ZAKUPUS_XML_URL ?? '',
      // Optional: local path to a downloaded price file (used by tests/CI).
      xmlPath: process.env.ZAKUPUS_XML_PATH ?? '',
      marginPercent: float(process.env.ZAKUPUS_MARGIN_PERCENT, NaN),
    },
  },

  orders: {
    // Where supplier orders are delivered when a supplier has no order API.
    supplierEmail: {
      aveopt: process.env.AVEPTO_ORDER_EMAIL ?? 'orders@aveopt.local',
      lugi: process.env.LUGI_ORDER_EMAIL ?? 'orders@lugi.local',
      zakupus: process.env.ZAKUPUS_ORDER_EMAIL ?? 'zakupusb2b@gmail.com',
    },
    emailProvider: process.env.EMAIL_PROVIDER ?? 'outbox', // outbox | resend
    emailFrom: process.env.EMAIL_FROM ?? 'orders@marketapp.local',
    resendApiKey: process.env.RESEND_API_KEY ?? '',
  },

  images: {
    // SSRF guard: only these hosts may be proxied through /v1/img.
    allowedHosts: (process.env.IMAGE_ALLOWED_HOSTS ?? 'www.aveopt.com.ua,aveopt.com.ua')
      .split(',')
      .map((host) => host.trim())
      .filter(Boolean),
    maxWidth: int(process.env.IMAGE_MAX_WIDTH, 1200),
  },

  delivery: {
    novaPoshtaApiKey: process.env.NOVA_POSHTA_API_KEY ?? '',
    novaPoshtaSender: process.env.NOVA_POSHTA_SENDER ?? '',
    novaPoshtaContact: process.env.NOVA_POSHTA_CONTACT ?? '',
    novaPoshtaPhone: process.env.NOVA_POSHTA_PHONE ?? '',
    novaPoshtaCity: process.env.NOVA_POSHTA_CITY ?? '',
    novaPoshtaWarehouse: process.env.NOVA_POSHTA_WAREHOUSE ?? '',
  },

  // Optional token for automation endpoints (CI smoke tests, external schedulers).
  internalToken: process.env.INTERNAL_TOKEN ?? '',

  // Bearer token that protects the analytics summary.
  adminToken: process.env.ADMIN_TOKEN ?? '',

  // Optional Telegram notifications for the supplier sync.
  notifications: {
    telegram: {
      token: process.env.TELEGRAM_BOT_TOKEN ?? '',
      chatId: process.env.TELEGRAM_CHAT_ID ?? '',
    },
  },

  // Sign in with Apple: the identity token audience is the iOS bundle id.
  // A comma-separated list keeps TestFlight (com.kvuua.marketapp) and
  // simulator builds working at the same time.
  appleClientIds: (process.env.APPLE_CLIENT_ID ?? 'com.kvuua.marketapp')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
};

export function supplierMargin(supplierId) {
  const override = config.suppliers[supplierId]?.marginPercent;
  return Number.isFinite(override) ? override : config.pricing.marginPercent;
}
