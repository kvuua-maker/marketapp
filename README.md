# MarketApp

Автоматизований дропшипінг-маркетплейс: постачальники → AI → вітрина → замовлення → постачальник.
Власник не торкається нічого: каталог оновлюється за розкладом, ціни рахуються самі,
замовлення маршрутизуються автоматично, оплата — післяплата на Новій Пошті.

```
┌──────────────┐   cron 90 min   ┌─────────────────┐   DeepSeek   ┌──────────────┐
│  Suppliers   │ ──────────────► │  Sync worker    │ ───────────► │ AI controller│
│ Aveopt/LUGI/ │   SupplierAdapter│ (node:sqlite)  │  validate +  │ title/desc/  │
│ Zakupus      │                 │                 │  localise    │ category     │
└──────────────┘                 └────────┬────────┘              └──────┬───────┘
                                          │ products (retail price)      │
                                          ▼                              ▼
                                   ┌──────────────┐              ┌──────────────┐
                                   │   SQLite     │ ◄────────────│ +15% margin  │
                                   └──────┬───────┘              └──────────────┘
                                          │
        ┌─────────────────────────────────┼──────────────────────────────┐
        ▼                                 ▼                              ▼
┌───────────────┐                ┌─────────────────┐            ┌────────────────┐
│  REST API     │                │  Order router   │            │  Email outbox  │
│ /v1/products  │                │  group by       │ ─────────► │  supplier      │
│ /v1/orders    │                │  supplier       │            │  notification  │
└───────┬───────┘                └─────────────────┘            └────────────────┘
        │
        ▼
┌───────────────────────────────┐
│ iOS (SwiftUI)                 │
│ iPhone: TabView               │
│ iPad: NavigationSplitView     │
│ Каталог · Товар · Кошик · НП  │
└───────────────────────────────┘
```

## Швидкий старт

```bash
cd server
cp ../.env.example .env          # заповніть DEEPSEEK_API_KEY (опційно)
npm test                         # 25 тестів, без залежностей
npm run sync                     # розвідка + наповнення БД з Aveopt
npm start                        # http://localhost:8899
```

```bash
curl localhost:8899/v1/health
curl "localhost:8899/v1/products?limit=5"
```

iOS:

```bash
cd ios
brew install xcodegen
xcodegen generate
open MarketApp.xcodeproj
```

## Що вже працює

| Блок | Стан |
|---|---|
| `SupplierAdapter` + 3 адаптери (Aveopt live, LUGI API, Zakupus XML) | ✅ |
| Cron-воркер (кожні 90 хв, доганяє пропущене після рестарту) | ✅ |
| SQLite-схема: товари, замовлення, outbox, історія синків | ✅ |
| AI-контролер: валідація фото/опису, локалізація, категорії, націнка | ✅ (DeepSeek або fallback) |
| Маршрутизація замовлень + лист постачальнику з даними НП | ✅ |
| REST API для вітрини | ✅ |
| SwiftUI: iPhone TabView / iPad NavigationSplitView, LazyVGrid, кеш фото | ✅ |
| GitHub Actions: тести + live sync + iOS build | ✅ |
| TestFlight | ⚙️ потребує Apple-секретів (див. нижче) |

## API

| Метод | Шлях | Опис |
|---|---|---|
| GET | `/v1/health` | стан, кількість товарів, AI, останній синк |
| GET | `/v1/categories` | категорії з кількістю товарів |
| GET | `/v1/products?category=&q=&limit=&offset=` | вітрина |
| GET | `/v1/products/:id` | картка товару |
| POST | `/v1/orders` | замовлення (післяплата) |
| GET | `/v1/orders/:id` | статус + статуси по постачальниках |

```bash
curl -X POST localhost:8899/v1/orders -H 'content-type: application/json' -d '{
  "customer": {"fullName":"Іван Петренко","phone":"0671234567","city":"Київ","branch":"Відділення №1"},
  "items": [{"productId":"aveopt:4488783","qty":1}]
}'
```

## Ціноутворення

`retail = round_x9(wholesale × (1 + MARGIN_PERCENT))`, ніколи не нижче собівартості.
`MARGIN_PERCENT` (типово 15) і `PRICE_ROUNDING=x9` задаються змінними середовища.

## AI

- Без `DEEPSEEK_API_KEY` конвеєр працює: категорії та ціни рахуються правилами,
  назви залишаються мовою постачальника, `ai_status = "fallback"`.
- З ключем DeepSeek перекладає назви/описи українською, обирає категорію з канонічного
  списку і кешується за хешем контенту (повторні синки не витрачають токени).
- Товар без фото або з описом < 40 символів відхиляється і не потрапляє у вітрину.

## GitHub Actions

- `backend`: `npm test`, живий синк з Aveopt, smoke-тест API.
- `ios`: XcodeGen + `xcodebuild` для симулятора (без підпису) — швидка перевірка компіляції.
- `testflight`: архів + upload, вмикається автоматично, щойно додані секрети.

Секрети для TestFlight: `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`,
`APP_STORE_CONNECT_KEY` (вміст .p8), `APPLE_TEAM_ID`, `APP_BUILD_ID`,
`BUILD_CERTIFICATE_BASE64`, `BUILD_CERTIFICATE_PASSWORD`, `PROVISIONING_PROFILE_BASE64`.

## Структура

```
server/src
  suppliers/   adapter.js, aveopt.js, lugi.js, zakupus.js, xml.js, registry.js
  ai/          deepseek.js, controller.js, fallback.js
  jobs/        sync.js, scheduler.js
  orders/      router.js, outbox.js
  api/         server.js
ios/MarketApp
  App/         MarketAppApp.swift, RootView.swift
  Core/        APIClient, CachedAsyncImage, Money, AppConfig
  Features/    Catalog, Product, Cart
```
