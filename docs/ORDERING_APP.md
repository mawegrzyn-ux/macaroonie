# Ordering app per tenant: plan

Status: proposal, 28 Oct 2026. Nothing here is built yet. Decisions marked
**Open** need an answer before the phase that depends on them starts.

## 1. What we're making

Each restaurant group (tenant) gets its own guest app. Guests order and pay
for collection in it, see their rewards and their past orders, reorder in two
taps and get a notification when their order is ready. The app carries the
group's own name, icon and colours. Guests install it from the restaurant's
website; there is no app store in the first version.

It replaces nothing. The website's `/order` page and the loyalty web app keep
working. Under the hood the app and `/order` share one ordering engine, and the
app's Rewards tab is the loyalty web app.

## 2. Recommendation in one paragraph

Build an installable web app (PWA) at `/app` on the tenant's own site address
(`{slug}.macaroonie.com/app`, and `{their domain}/app` once a custom domain is
verified). Reuse the ordering engine behind `/order` (moved into one module both
load) and the loyalty web app's sign-in, card and rewards. Add accounts with
order history and reorder, and web push for order status. Real card payments
(Stripe) come first, because an ordering app that can only take "pay at the
counter" isn't worth installing. Native store apps are a later, separate
decision (section 9).

## 3. Decisions

| # | Question | Recommended | Status |
|---|---|---|---|
| D1 | Web app (PWA) or store apps? | PWA first; store apps later only if tenants ask (section 9) | **Open** |
| D2 | Where does the app live? | `/app` on the tenant's site address, not `order.macaroonie.com/{slug}` (see 3.1) | **Open** |
| D3 | Ordering only, or one guest app with loyalty? | One guest app: Order, Rewards, My orders, Account | **Open** |
| D4 | Are table bookings in the app? | Not in the first version; a Book tab can open the reservations widget later | **Open** |
| D5 | What is a guest account? | The loyalty member row (`loyalty_members`): it already has email, name, phone, sessions, export and erasure. Ordering accounts work even when the loyalty programme is off (section 5.3) | **Open** |
| D6 | Payments | Stripe as a web-ordering payment gateway (one file in `services/paymentGateways/`), with Apple Pay and Google Pay through Stripe | **Open** (Stripe account model: see 6.1) |
| D7 | One app per tenant, or per location? | Per tenant; the guest picks a location (nearest first) | Recommended |
| D8 | Fulfilment | Collection only, as `/order` today; delivery is separate work | Recommended |

### 3.1 Why the tenant's own address

Android and Chrome tie an installed web app to its origin (we hit this with
`/mobile`, see CLAUDE.md Outstanding 11). On one shared origin
(`order.macaroonie.com/{slug}`) every tenant's app would share storage,
sign-in cookies and the notification permission, and installing a second
tenant's app can open the first one instead. On `{slug}.macaroonie.com` each
tenant is its own origin, and their custom domain makes it fully theirs.
Wildcard DNS, the certificate and custom-domain switching already exist.

Cost of this choice: a tenant that changes its site address or adds a custom
domain gets a new origin, so guests who installed the old one keep it (it still
works) until they install again. The app should keep working on both.

## 4. What exists already

| Need | Already there | Gap |
|---|---|---|
| Menu, options, combos, prices, promotions, tax | `/order-api` + `shared/orderPricing.js`, `promotions.js`, `combos.js`, served as modules | none |
| Ordering UI | `views/site/shared/ordering.eta` (about 1,800 lines of plain script in a template) | not reusable outside the template (5.2) |
| Order status page | `/order/status/:token` | needs to live inside the app too |
| Sign-in | loyalty's emailed six-digit code, sessions (`/loyalty-api/t/:slug/code`, `/verify`, `/me`) | only while the loyalty programme and its web app are on (5.3) |
| Rewards | loyalty web app (`views/site/loyalty.eta`), wallet cards | none |
| Orders linked to a guest | `orders.loyalty_member_id` (migration 211), `orders.customer_id` | no "my orders" route |
| Reorder | `order_items.options` are display labels only | the original picks aren't stored (5.4) |
| Installable page per tenant | `services/loyaltyPage.js`: manifest from the brand, a worker | icons are the favicon only (Chrome wants 192 and 512 px PNGs), worker caches nothing |
| Payments | gateways `pay_at_venue` and `demo` (`services/paymentGateways/`) | no real card gateway (6.1) |
| Push notifications | none anywhere | new (5.6) |
| Order status events | `orderSvc.js` `TRANSITIONS`, order emails | no push on accepted / ready |

## 5. Design

### 5.1 Addresses and files

| Address (tenant site host) | What |
|---|---|
| `/app` and `/app/*` | the app page (one page, routes inside it: `#order`, `#rewards`, `#orders`, `#account`, `#order/<token>`) |
| `/app/manifest.webmanifest` | per-tenant manifest (`id: "/app"`, `scope: "/app/"`, `display: standalone`, name, colours from the Brand page) |
| `/app/icon-192.png`, `/app/icon-512.png`, `/app/icon-maskable-512.png`, `/app/apple-touch-icon.png` | made from the Brand page's logo or favicon with `sharp`, cached by content hash |
| `/app/sw.js` | the app's service worker (scope `/app/`) |

Served by a new `routes/guestApp.js` registered inside `siteRenderer.js`'s host
handling (like `/loyalty`), on production hosts only (not staging). The page is
a server-rendered shell (`views/site/app.eta`) plus plain ES modules, no new
build step, the same as the loyalty web app and the menu screen player.

When the app's switch is off (5.8) every `/app` path is 404.

### 5.2 One ordering engine

Move the script out of `ordering.eta` into `api/src/views/site/shared/ordering/`
modules served at `/order-api/ui/*.js` (versioned URLs), with one entry
point: `mountOrdering(root, { venue, options, mode })`, where `mode` is `page`
(today's `/order`) or `app` (full height, no site header, the basket as a
bottom sheet, the app's tab bar below). `ordering.eta` then shrinks to the
markup and one `mountOrdering()` call. Both surfaces run the same code, so a
fix or feature reaches both (avoids the drift CLAUDE.md warns about for the
builder canvas).

This is the riskiest part of the work: the page has many options (block
options, sticky basket, promo box, loyalty box, combos wizard, flying
picture). Do it as a pure move first, with the existing ordering browser
checks passing unchanged, before adding `app` mode.

### 5.3 Accounts

The account is the loyalty member row. Changes:

- Sign-in, account details, order history and reorder work whenever the app is
  on, even when the loyalty programme is off. Earning, the card, rewards and
  the Rewards tab show only when loyalty is on. Today `loyaltyPageData()` and
  the `/loyalty-api/t/:slug/*` routes refuse when the programme or its web app
  is off; split that check into "accounts on" (the app or the loyalty web app
  is on) and "loyalty on".
- Joining asks only for what ordering needs (name, email, optional phone,
  newsletter box as today). Joining loyalty, when it is on, is the same
  account.
- Checkout prefills name, email and phone from the account and sets
  `orders.loyalty_member_id` as today.
- GDPR: the existing member export and erasure cover the account. Export adds
  the member's orders; erasure leaves orders anonymised as the Customers
  anonymise already does.

**Open:** a guest who doesn't want an account can still order as a guest
(recommended: yes, as `/order` does).

### 5.4 My orders and reorder

- `GET /loyalty-api/t/:slug/me/orders?before=` (member session): the member's
  orders newest first (venue, time, status, total, lines as shown), 20 at a
  time. One query by `tenant_id` and `loyalty_member_id`.
- Live status for open orders: the existing `/order-api/orders/:token`,
  polled while the screen is open, plus push (5.6).
- Reorder needs the original picks. New column `order_items.selection jsonb`
  (the basket line's `{ item_id, choices, combo selection, qty, note }` exactly
  as `priceBasket()` took it), written by `createOrder()`. Reorder puts those
  lines into the basket and re-prices them with today's menu. A dish that is
  gone, sold out or whose options changed is listed as "not added" with the
  reason; nothing is silently swapped. Older orders without `selection` offer
  "Order again" only for lines without options.
- Favourites (a heart on dishes) are stored on the member
  (`loyalty_members.favourite_item_ids uuid[]`), shown as a row at the top of
  the menu.

### 5.5 Choosing a location

- One location: skip the picker.
- Several: list the locations that have online ordering on, with today's
  collection hours and open / closed / paused. "Use my location" sorts by
  distance (`navigator.geolocation` and each location's
  `website_config.latitude` / `longitude`, the Find us data). Nothing about the guest's position is sent to
  the server.
- The last location used is remembered on the device.

### 5.6 Notifications (web push)

- VAPID key pair for the platform, kept sealed in `platform_secrets` (made on
  first use).
- `guest_push_subscriptions` (tenant_id, member_id null, order_id null,
  endpoint unique, keys, user_agent, created_at, last_ok_at, failures) with
  forced RLS. A subscription made at checkout without an account is tied to
  that order only.
- `POST /order-api/push/subscribe` and `/unsubscribe`, by order token or member
  session.
- Sent from `orderSvc.js` after the status change commits: accepted (with
  ready time), ready, cancelled or rejected. Queued on `notificationQueue` (not
  awaited, like emails). A 404 / 410 from the push service deletes the
  subscription.
- The worker shows the notification and opens `/app#order/<token>` on tap.
- Ask for permission only after the guest places an order ("Tell me when it's
  ready"), never on first open.
- iPhone: web push works only after the app is added to the Home Screen
  (iOS 16.4+). The app shows a short "Add to Home Screen" guide on iPhone
  Safari, and falls back to the order status email when push isn't possible.
- Library: `web-push` (npm), or our own small VAPID + aes128gcm sender if we'd
  rather keep the dependency out (the vault already does AES-GCM).

### 5.7 Offline and speed

- The worker caches the app shell and modules, and dish pictures as they are
  shown (same idea as the kiosk's `photos.js`, but on demand, not the whole
  menu).
- Menu data: network first, the last copy shown greyed with "Offline: can't
  order right now" when there is no connection. Placing an order and paying
  always need the connection.
- Install prompt: Android shows Install from the browser menu; the app adds
  its own Install button (`beforeinstallprompt`) in Account.

### 5.8 Admin

- Website > Ordering app (new page, `web_ordering_setup` manage): on / off, app
  name (default the brand name, short name up to 12 letters), icon (default the
  brand's logo, with a preview of the round and square crops), the install
  link and a QR code for posters and receipts, which tabs show, and a preview
  of the app in a phone frame.
- Online orders and the order emails get a "Track it in our app" line when the
  app is on.
- The kiosk receipt QR code and the loyalty card QR can point at the app when
  it is on.

### 5.9 Data changes (one migration)

- `ordering_app_settings` (tenant_id unique, enabled, name, short_name,
  icon_url, tabs jsonb, updated_at, updated_by), forced RLS.
- `order_items.selection jsonb`.
- `loyalty_members.favourite_item_ids uuid[] NOT NULL DEFAULT '{}'`.
- `guest_push_subscriptions` (5.6).
- Nav: Website > Ordering app link (`DEFAULT_NAV_TREE`, `ROUTE_CATALOG`,
  migration adding it to existing menus).

## 6. Payments

### 6.1 Stripe gateway (before the app)

Online ordering takes money only at the counter today. The plan in CLAUDE.md
(Outstanding 14, Stage 1) stands:

- `services/paymentGateways/stripe.js` implementing the gateway interface in
  `services/paymentGateways/index.js` (`start` makes a PaymentIntent and hands
  its client secret to the page, `confirmFromClient` asks Stripe, `parseWebhook`
  verifies the signature, `refund`, `cancel`).
- One Stripe account per tenant, direct charges, the tenant is the merchant of
  record, the platform fee as `application_fee_amount` (decided Sep 2026).
  **Open:** Stripe Connect (Standard accounts, onboarding link in the admin) or
  the tenant's own secret key as the card machines do. Connect is needed to
  take the platform fee; own keys are quicker to ship.
- Payment Element in the ordering engine: cards, Apple Pay, Google Pay. Apple
  Pay needs each domain registered with Stripe (`{slug}.macaroonie.com` and
  every verified custom domain): register on save / verify, and show the state
  on the Domain page.
- Webhook dedupe by event id; the existing `applyPaymentResult()` already
  refunds a duplicate payment.
- Card machine accounts (migration 193) already store a Stripe key per tenant
  for Terminal; reuse the same account where the tenant agrees.

## 7. Phases

Each phase ships on its own and is useful on its own.

| Phase | What | Depends on |
|---|---|---|
| P0 | Stripe gateway for `/order` (6.1) | D6 |
| P1 | Ordering engine moved into modules, `/order` unchanged (5.2) | none |
| P2 | The app: `/app`, manifest, icons, worker, tabs, location picker, ordering in `app` mode, order status inside the app, Website > Ordering app page | P1, D1-D3 |
| P3 | Accounts without loyalty, My orders, reorder (`order_items.selection`), favourites | P2, D5 |
| P4 | Web push for order status, iPhone Add to Home Screen guide | P2 |
| P5 | Polish: install QR code on receipts / emails / kiosk, offline menu, app analytics (opens, installs, orders from the app via `orders.channel = 'app'`) | P2 |

Rough size: P0 large (money, webhooks, domain registration), P1 medium and
careful, P2 large, P3 medium, P4 medium, P5 small to medium.

`orders.channel` gets a new value `app` so reports can tell app orders from
website orders (CHECK constraint in the migration).

## 8. Testing

- P1: every existing ordering browser check runs unchanged against the moved
  engine (1280 and 390 px), plus the guest checkout API tests.
- API tests (`api/test/ordering-app.test.mjs`): manifest and icons per tenant
  and host, 404 when off, member orders (own only, another tenant's member
  refused, the sweep fixtures add an app order and a push subscription),
  reorder with a removed dish and changed options, push subscription rules,
  push sent on accepted / ready with a stand-in push service (and 410 deleting
  the subscription).
- `system-paths.test.mjs`: `/app` and its files found by host in system mode.
- Browser: Chromium mobile emulation at 390 x 844 (install prompt, standalone
  display, tabs, order, pay with Stripe test cards, status, reorder, push via
  a stand-in), offline with the worker. Stripe against its test mode, not a
  stand-in, for P0.
- Real devices before launch: an Android phone (install, push, Google Pay) and
  an iPhone (Add to Home Screen, push after install, Apple Pay).

## 9. Store apps (later, if tenants ask)

One Expo codebase (like `android-app/`), built per tenant from a config (name,
bundle id, icons, colours, the tenant's site address), EAS build profiles per
tenant. What to know first:

- Apple rejects apps that are only a website in a frame (App Review guideline
  4.2). The app needs real native parts: push through APNs / FCM, Apple Pay,
  location, the wallet card, and native screens at least for the shell.
- Apps made from a template for many businesses must be published from each
  business's own developer account (guideline 4.2.6). Each tenant needs an
  Apple Developer account (US$99 a year) and a Google Play account (US$25 once),
  and we act as their developer through team access.
- Every release goes through store review; web parts can still update without
  one.
- The PWA from this plan stays the base: the native shell can load the same
  ordering engine, so nothing in phases P1-P4 is thrown away.

## 10. Not in this plan

Delivery (zones, fees, drivers, Deliveroo-style tracking), table ordering by
QR code, scheduled orders more than the existing order-ahead days, gift cards,
group orders, tipping changes, a guest chat in the app, a Macaroonie-wide app
across tenants (the loyalty "network" programme is data model only).

## 11. Risks

- Moving the ordering engine (P1) can break `/order` in subtle ways; mitigated
  by doing a pure move first with the existing checks.
- Apple Pay domain registration across custom domains has many moving parts
  (a domain changed or unverified later).
- iPhone push depends on guests adding the app to the Home Screen; many won't,
  so email stays the fallback.
- Sharing one origin with the tenant's website means the website's own
  service worker (none today) must never take `/app` and vice versa: keep their
  scopes apart.
- Card payments make Macaroonie part of the money flow; refunds, disputes and
  the platform fee need support processes before launch.
