# Macaroonie POS — design

Status: **Phases 1-5 built cloud-first; the hub and printer trials are parked** (11 Oct 2026).
Decisions agreed 11 Oct 2026. What runs today, and what's provisioned for the hub, is in
section 8. Kitchen screens (KDS, 16 Oct 2026): section 9. Self-order kiosks (17 Oct 2026):
section 10.

A restaurant till with table service and counter service, built into Macaroonie:
table service first, counter mode later. This file is the design; CLAUDE.md links here.

---

## 1. Decisions

| Topic | Decision |
|---|---|
| Market | UK only. No fiscal device. VAT eat-in vs takeaway. |
| Terminals | Android tablets and Windows touch PCs, Chrome, installed PWA at `pos.macaroonie.com`. iPad later. |
| Local hub | One per venue. Prints, keeps terminals in sync, keeps the venue trading with the internet down. |
| Printers | Epson network printers (ePOS-capable models). The hub prints raw ESC/POS on port 9100. |
| Payments | Launch: card on a separate machine, tender recorded. Later: integrated Dojo, SumUp, Zettle, Stripe Terminal, Adyen behind one adapter. |
| Kitchen | Printers, and kitchen screens (KDS) on Android tablets / TV boxes since 16 Oct 2026 (section 9). |
| Order | Table service first, then counter mode. |

---

## 2. Architecture

```
  Terminals (PWA, Chrome)          Venue hub (Node + SQLite)              Cloud (Fastify + Postgres)
  ┌───────────────────┐   wss/https   ┌───────────────────────┐   https    ┌──────────────────────┐
  │ IndexedDB, events │◄────LAN──────►│ event log, sequencer  │◄──────────►│ config, devices,     │
  │ local-first UI    │               │ config snapshot       │  outbox    │ event archive,       │
  └───────────────────┘               │ print spooler         │            │ reports, Cash Recon  │
           │                          └──────────┬────────────┘            └──────────────────────┘
           │ hub unreachable: straight to cloud  │ TCP 9100 (ESC/POS)
           │ both unreachable: terminal alone    ▼
           │                          Epson printers, cash drawer
```

- **Cloud** (the existing API): system of record for config (menus, tables, staff, printers,
  revenue streams, order types, tax rates, POS roles), the device registry, the full event archive, reports, and the
  Cash Recon feed.
- **Hub**: Node 22 + SQLite in each venue (`hub/` in this repo). Holds a snapshot of the
  venue's config and the live event log, sequences events, pushes them to terminals over a
  WebSocket, prints, and syncs with the cloud through an outbox. Packaged as a Docker image
  (Linux mini PC / Raspberry Pi 5) and a Windows service; updates itself from the cloud.
- **Terminal**: a separate Vite app (`pos/`, not the admin bundle): small, its own service
  worker and IndexedDB. Local-first: every tap writes an event to the device and updates the
  screen at once; sending to the hub happens in the background.
- **`shared/pos/`**: pure code used by all three: the check reducer (events to check state),
  pricing (reusing `shared/orderPricing.js` and `shared/promotions.js`), split maths, course
  logic and the ticket builder.

### 2.1 Terminal to hub (the hard part)

Browser rules decide this:

1. A page served over `https` may only call `https` / `wss`.
2. Chrome asks permission ("Local Network Access") before a public site talks to a LAN
   address. One prompt per device; the hub must answer the private-network preflight.
3. The hub's name must still resolve when the internet is down.

| | Option | Internet down? | Setup |
|---|---|---|---|
| **A (recommended)** | Per-venue private CA. The hub's certificate is for its LAN IP, signed by a venue CA limited (name constraints) to private IP ranges. The CA is installed once on each terminal. | Works: no DNS involved | Install the CA on each tablet once; DHCP reservation for the hub (printers need one anyway) |
| B | Public name `<hub>.hub.macaroonie.com` pointing at the LAN IP, Let's Encrypt via DNS-01 | Fails unless the router has a local DNS entry | No per-device install |

Trial 2 proves option A on the venue's own tablets.

### 2.2 Events and sync

- Every change is an **event**: `{ id (ULID made on the device), venue_id, device_id,
  staff_id, check_id, type, payload, client_at }`.
- The **hub sequences**: it checks the event against the current state (same reducer),
  gives it a `seq`, stores it and broadcasts it. An event that no longer applies is refused
  with a reason and the terminal rolls it back.
- **Soft locks**: a check open on one terminal shows "in use by Anna" elsewhere; it can be
  taken over (same server or manager).
- **Cloud** receives the hub's log in order (outbox, acknowledged by `seq`). Config flows the
  other way as versioned snapshots.
- **Hub down**: terminals send to the cloud, which sequences for that venue while the hub's
  heartbeat is missing.
- **Hub and internet down**: the terminal works alone and queues its events.
- **Merging after a split**: logs are unions keyed by event id; state is rebuilt by replaying
  in order. Events that no longer apply (paying a check closed elsewhere, voiding a line already
  voided) become **conflicts** listed for a manager. Money is never merged silently.
- **Check numbers** come from the hub; a terminal on its own uses its prefix (`T2-0041`)
  until it syncs.
- Cloud tables (`pos_checks`, lines, payments) are **projections** rebuilt from events;
  reports read the projections.

First event types: `check.opened`, `check.covers_set`, `check.table_moved`,
`check.server_changed`, `line.added`, `line.changed` (before send), `line.deleted` (before send),
`lines.sent`, `course.held`, `course.fired`, `line.voided`, `discount.applied`,
`discount.removed`, `service_charge.set`, `check.split`, `check.merged`, `lines.moved`,
`bill.printed`, `payment.added`, `payment.voided`, `check.closed`, `check.reopened`,
`refund.added`, `drawer.opened`, `day.closed`.

### 2.3 Devices and staff

- **Terminal pairing**: a manager signs in (Auth0) once on the device, picks the venue and
  names the terminal. The cloud creates a `pos_devices` row and a device secret (stored
  hashed). The terminal also receives the hub address and the venue CA to install.
- **Hub pairing**: a one-time code from admin (POS settings, Hubs, Add hub).
- **Staff**: 4–6 digit PIN per staff member (`cash_staff`), hashed (scrypt), synced to the hub
  and terminals, attempts limited. Manager PIN for overrides. Devices can be revoked in admin.
- **POS permissions per role**: void after send, refund, discount up to N%, comp, open
  drawer, reopen check, take over another server's check, price override, manager override.

### 2.4 Printing

- The hub prints raw **ESC/POS over TCP 9100** (every Epson network printer and ESC/POS
  clone accepts it). Code page WPC1252 (`ESC t 16`) so £ prints.
- The ticket is built in `shared/pos/tickets.js` as a list of print operations, so the same
  ticket can be previewed in admin; `hub/src/escpos.js` turns it into bytes.
- **Routing**: dish → section → revenue stream → venue default. Station printers (Kitchen,
  Bar, Pass), a receipt printer per terminal, a backup printer per printer.
- Queue per printer with retries; status check so terminals see "printer offline / out of
  paper"; reprint.
- Cash drawer opened through the receipt printer (`ESC p`).
- Hub down: terminals print straight to the printer with Epson ePOS-Print (later phase).

### 2.5 Payments (later releases, designed now)

- Tenders: `cash`, `card_external`, `voucher`, `account`; `card_integrated` per provider.
- `pos_payment_attempts` with a state machine (`pending` → `approved` / `declined` /
  `cancelled` / `unknown`), provider reference and idempotency key.
- One adapter interface (same idea as `services/paymentGateways/` for web ordering):
  `start({ amount, tip, reference, reader })`, `status()`, `cancel()`, `refund()`,
  `parseWebhook()`.
- Providers to check when we get there: Dojo (cloud API to card machines), SumUp (Cloud API
  for Solo readers), Stripe Terminal (server-driven), Adyen (Terminal API, cloud or local),
  Zettle (may only offer native app SDKs, which a PWA can't use: confirm).
- A card machine is paired to a terminal or picked per payment.
- Integrated payments need the internet; offline the till falls back to `card_external`.
- Card data never touches Macaroonie (PCI scope stays with the provider).

---

## 3. Data model (cloud, first cut)

| Table | Holds |
|---|---|
| `pos_devices` | terminals and hubs: venue, kind, name, secret hash, last seen, app version, revoked |
| `pos_revenue_streams` | venue, name (Restaurant / Bar / Kiosk), menus, service charge, the order types it offers with their prompts, default order type, sort (was `pos_revenue_centres` with a VAT mode; migration 170, section 8.1) |
| `pos_printers` | venue, name, IP, port, columns, kind (receipt / station), backup printer |
| `pos_print_routes` | dish, section or revenue stream → printer |
| `pos_roles` | permissions and limits per staff role |
| `cash_staff` + | `pin_hash`, `pos_role_id` |
| `floor_areas` | venue, name, size, sort |
| `tables` + | `floor_area_id`, `x`, `y`, `w`, `h`, `shape`, `rotation` |
| `pos_courses` | tenant: Drinks / Starters / Mains / Desserts, order, fire by default |
| `menu_sections` + / `menu_items` + | default course / course override |
| modifiers | extend variant groups: nested groups, "no / extra / light", per-dish prices (exist) |
| combos | `menu_items.kind = 'combo'` + steps (migration 171, section 8.2) |
| `pos_events` | the event log (source of truth) |
| `pos_checks`, `pos_check_lines`, `pos_payments` | projections |
| `pos_shifts` / `pos_days` | drawer floats, X/Z reports, cash-up into Cash Recon |

---

## 4. What we reuse

- **Menus**: sections, dishes, option groups (`price_mode`, `min_select` / `max_select`),
  tax settings (`shared/tax.js`, section 8.1), allergens, the sold-out list.
- **Promotions engine** (`shared/promotions.js`) for automated discounts.
- **Tables, sections, combinations** from bookings.
- **Staff and roles** from the rota.
- **Cash Recon**: POS takings and service charge fill the day; service charge feeds rota tip
  pots.
- **Customers and bookings**: a seated booking becomes a check.
- **Subdomain pattern** from `ops.` (`platformHost.js`, `RESERVED_SUBDOMAINS`).
- **Online orders**: `orders.channel` already allows `pos`.

---

## 5. UK specifics

- VAT: a dish's rate comes from its tax setting (dish, then section, then menu, then the
  tenant's default rate), with exceptions per order type (eat in vs take out), location and
  revenue stream (section 8.1). The receipt shows the VAT number and a VAT breakdown.
- Tips and service charge: the Employment (Allocation of Tips) Act 2023 needs fair
  allocation and records; POS tips and service charge feed Cash Recon SC sources, then the
  rota's tip pots.
- Records: keep the event log 6 years (HMRC VAT records).
- Allergies print prominently on kitchen tickets.

---

## 6. Phases

| # | Phase | Size |
|---|---|---|
| 0 | Trials: printing from the hub; terminal ↔ hub over the LAN with the internet down; sync merge rules. Hardware chosen. | S |
| 1 | Foundations: events and projections, pairing + PIN, POS roles, revenue centres, printers and routing, courses, modifier extensions, hub service, `pos.` app shell with offline cache. | L |
| 2 | Table-service MVP: floor designer and floor view, open table, order entry, send / hold / fire, kitchen tickets, pre-bill, pay (cash + external card), receipt, delete / void, X/Z, Cash Recon feed. | XL |
| 3 | Check operations: split, merge, transfer, tabs, reopen, refunds. | L |
| 4 | Discounts: manual and automated, comps, service charge, limits; void and discount reports. | M |
| 5 | Counter mode: quick-service screen, order numbers, order types (Take out), combos. | M |
| 6 | Integrations: card terminals, online orders into the POS and kitchen, bookings on the floor plan, KDS. | XL |
| 7 | Till layout designer. | M |

### Phase 0 trials

1. **Printing (`hub/`, done first)**: the hub prints a kitchen ticket and a receipt, cuts,
   and opens the drawer on the venue's Epson: `node hub/bin/test-print.js <printer-ip>`.
   See `hub/README.md`.
2. **Terminal ↔ hub**: a test page on `pos.macaroonie.com` talks `wss` to the hub by IP with
   the venue CA installed; two tablets see each other's changes with the router's internet
   cable pulled out. Confirms the Local Network Access prompt on the venue's Chrome versions.
3. **Sync rules**: two terminals working alone, then reconnecting; the merge is the same every
   time and conflicts are listed (tested in Node).

Done when: tickets print correctly on the venue's printer; two tablets stay in sync with the
internet down; this document is confirmed.

### Hardware for the trials

- Hub: fanless mini PC (e.g. Intel N100) on Windows or Linux, or a Raspberry Pi 5 with an SSD.
- Fixed IPs (DHCP reservations) for the hub and every printer.
- Recommended: a small UPS for router, hub and printers; a 4G backup router.

---

## 7. Risks and open questions

- Chrome's Local Network Access prompt and private-network rules on the venue's Android and
  Windows versions (Trial 2).
- Installing a CA on Android needs a screen lock; Chrome honours user-installed CAs (Trial 2).
- iPad later: Safari's PWA storage limits and local network rules need their own check.
- Hub failure: terminals fall back to the cloud; a spare hub can be paired in its place.
- Device clocks: the hub gives the time; events also carry the hub's `seq`.

---

## 8. Built so far (cloud-first, hub parked)

On 11 Oct 2026 the hub and the printer / LAN trials were parked ("build everything else,
provision in code for the hub"). What exists:

| Part | Where | Notes |
|---|---|---|
| Rules, pricing, printing, reports | `shared/pos/` | `checks.js` (events + `applyEvent()`), `pricing.js`, `printing.js` (`jobsForEvent()`, `routeFor()`), `reports.js` (`dayFigures()`), `sequencer.js` (`createSequencer(store)`), `permissions.js`, `pin.js`, `ids.js` (ULID), `tickets.js`. Tests: `node --test shared/pos/test/*.test.mjs`. |
| Schema | migration 156 | Section 3's tables as built; see Docs.jsx → Till (POS) for the columns. |
| Sequencer | the cloud | `services/posSvc.js` runs `createSequencer()` with a Postgres store under a per-venue advisory lock. The hub will run the same sequencer with SQLite. |
| Till API | `/pos-api` (`routes/posApi.js`) | Pairing, device auth, config snapshot, events in, sync out, presence, reports, print queue (claim / status routes are for the hub). |
| Admin | `/api/pos` (`routes/posSetup.js`) | Till setup, Floor plan, Till reports pages; Menus / Variant groups / Promotions till fields. |
| Till app | `pos/` | React PWA served by the API on `pos.<domain>` (`routes/posSite.js`, no nginx change); the same build runs the kitchen screens on `kitchen.<domain>` and the kiosks on `kiosk.<domain>` (18 Oct 2026: each device app on its own address, `pos/src/lib/appHost.js`; a pairing code only works on its kind's address; `POST /pos-api/disconnect` and `/move`). Local-first: IndexedDB outbox, optimistic apply, socket + polling sync. Table service, tabs, counter mode, courses (hold / fire), modifiers, combos, discounts / comps / offers, service charge, split / move / merge, pay (external card, cash, voucher, ...), refunds, reopen, X / Z. |
| Cash Recon | `services/reconFill.js` | Z figures fill the Cash Recon day through `recon_map` (shared with Loyverse). |
| Sold out | `services/soldOut.js` | Hold a dish (or tap a sold out one) on the till: `PUT /pos-api/sold-out/:itemId` (role permission `sold_out`, or a manager's PIN), online only. The same `ordering_item_availability` rows as online ordering; every till, the orders board and the menu screens hear it. `tillConfig().sold_out`. Migration 166. |

Changes from sections 2-3, while there is no hub:

- **Tills talk to the cloud only.** With the internet down a till keeps trading on its own
  (outbox), but two tills don't see each other until it's back; clashes are refused and listed
  (Till reports → Refused changes). The hub removes that gap.
- **Linking is by the code the device shows**, not an Auth0 login: the device asks for a code
  (`POST /pos-api/pairings`, it keeps the secret) and shows it with a QR code; someone signed in
  types it in Till setup (Add a till / screen / kiosk) or links it in the installer app
  (`POST /api/pos/venues/:id/link`, 19 Oct 2026: the only way). The code's address decides the kind (till, kitchen
  screen, kiosk); the app opens the matching screens, and the kind in every config reply wins over
  the one saved on the device (`relabel()` in `pos/src/lib/store.js`).
- **App updates**: the service worker keeps the app on the device, so after a deploy a device
  runs the copy it started with. `pos/src/lib/appUpdate.js` checks for a new copy every 30
  minutes and when the screen comes back, and reloads at a quiet moment (a till with nobody
  signed in, a kiosk on its start screen, a kitchen screen nobody has touched for 30 s). A copy
  from before kiosks ran a newly paired kiosk as a till (17 Oct 2026); that can't recur.
- **Printing**: bills and receipts print from the till's browser (hidden iframe + print dialog,
  `pos/src/lib/print.js`); kitchen tickets are queued in `pos_print_jobs` and can optionally
  print from the till's browser too (Till → settings). The hub will claim the queue and print
  ESC/POS to the Epsons (`hub/src/printer.js`, Trial 1 code).

Provisioned for the hub (no other change needed when it comes):

- `pos_devices.kind = 'hub'`, and `POST /pos-api/print-jobs/claim` / `/:id/status` accept only hubs.
- `pos/src/lib/transport.js` tries `device.hub_url` before the cloud.
- The sequencer takes a store object; the hub supplies a SQLite one.

Still to do: Trials 1-3 on real hardware, the hub service, card terminal adapters, the
till layout designer (Phase 7), online orders into the till, bookings on the floor plan.
Kitchen screens: section 9.

### 8.1 Tax rates, order types and revenue streams (migration 170, 16 Oct 2026)

The user's design: a **revenue stream** (the old revenue centre) is a till grouping for
recognising revenue by place and/or device and doesn't decide tax; **order types** (Eat in,
Take out, Delivery, Collection, then the tenant's own list) decide how tickets behave; tax is
set per menu with overrides by section and by dish, as rates from a tenant list of **tax
rates** with values per location, plus overrides per revenue stream. Choices made with the
user: a rate can differ per order type (an exception on the setting); one tenant list of rates
with a % per location; the tenant's own list of order types; used everywhere (till, online
ordering, the Deliveroo file, Cash Recon fill through the Z, reports).

- **Rule**: `shared/tax.js` `taxFor([dish, section, menu], { venue_id, order_type_id,
  revenue_stream_id }, rates)`. Level first (the dish's setting wins over its section's, the
  section's over its menu's, then the default rate); within a setting the most specific
  matching exception (stream 4, type 2, venue 1; added up) wins, else its own rate. Clashing
  exceptions of the same weight are refused on save (`taxProblems()`).
- **Till**: the config carries each item's levels, the rates (values for the venue) and the
  streams with their order types and prompts. Each line stores `vat_rate` and `tax_rate_id`.
  `check.order_type_set` / `check.stream_set` carry the re-rated lines, so a type changed
  offline is applied with the rates the till showed. `check.tent_set` sets the tent number.
  Name and tent can be required per stream and type: the till asks at counter start, Send and
  Pay.
- **Kitchen**: kitchen orders carry `type` (the order type id), `type_name` and `tent`; flow
  links filter on the tenant's types; the kitchen screen's tabs are the tenant's types.
- **Reports**: day figures by revenue stream and by order type; the Z prints both.
- Not built: tax-inclusive vs exclusive pricing per location (all prices include VAT); a rate
  change on a date (change the % on the day, or publish a menu with another rate).

### 8.2 Combos (migration 171, 16 Oct 2026)

The user's design: a combo is a menu item like any other, built from steps. Each step has a
min and max (min 0 = optional), may allow the same choice more than once, may pick itself when
it has one choice, may wait behind a button (optional steps), and may show only after a pick in
an earlier step. Choices are dishes, whole sections or choices typed in for the combo, each with
an extra charge. The combo's own price can be £0. Menus, the website and screens show the
description and the price ("from" when choices can cost more); the till and the ordering page
go through the steps. Option groups gained "more than once" and "show a button".

Choices made with the user: automatic combos group and reprice (items stay as entered, the
saving shows as a discount, only when cheaper, re-checked as the check changes); automatic
combos apply on the till and online; a manual combo starts from its own button or "Make it a
combo" on a till line; step choices can be dishes, sections or new.

- **Rule**: `shared/combos.js` (steps, conditions, pricing, "from" price, the automatic
  matcher). The till prices through `priceItem()` → `priceCombo()`; online through
  `priceLine()` / `priceBasket()`.
- **Till**: a combo line stores its parts in `line.combo` (each with `item_id`, `section_id`,
  `course_id`, `upcharge`, `modifiers`); an automatic combo is a `promotions.set` entry with
  `kind: 'combo'` and `count`, worked out by the till (`autoCombosFor()`) whenever the lines
  change, so it is in the event log like any offer. "Make it a combo" adds the combo with the
  dish picked and deletes the original line (only before it's sent).
- **Kitchen**: each part routes by its own dish (a typed-in part like the combo); tickets and
  kitchen screens show the combo's name with the parts under it, repeats counted.
- Not built: a combo inside a combo; per-step prices that depend on another step; combos on
  GloriaFood or Deliveroo (the Deliveroo file sends a combo's own price; its choices are
  Deliveroo modifiers set in the Hub).

---

## 9. Kitchen screens (KDS)

Address: `kitchen.<domain>` (`kds.<domain>` forwards there) since 18 Oct 2026; screens paired on the till address before then move with one tap (section 8, `pos/src/lib/appHost.js`).

Built 16 Oct 2026, migration 168. Modelled on what a kitchen display such as ConnectSmart
Kitchen does, not a copy of it: tickets by station, a pass (expo) that checks orders before
they go out, timers, bump / recall / remake / rush, "on order" counts, bump bars, speed of
service reporting, and an order-ready board for guests. Android tablets and TV boxes in
Chrome, as an installed PWA.

### 9.1 How it fits

```
  Till ──events──►  sequencer (cloud now, hub later)  ◄──events── Kitchen screen
                    │ shared/pos/checks.js   (checks)
                    │ shared/pos/kitchen.js  (kitchen orders)
                    ▼
             pos_events ─► pos_checks, kds_orders, kds_log
                    │
                    └─► pos.seq { kinds } ─► tills / kitchen screens     kitchen.board ─► menu screens
```

- **A kitchen screen is a device** (`pos_devices.kind = 'kds'`), linked by the code it shows at
  the kitchen address like a till; the same `pos/` app opens the kitchen UI for it. No PIN: a
  kitchen screen belongs to a station, not a person.
- **Kitchen events are POS events.** Bump, done, recall, remake, rush and collected are events
  in the venue's `pos_events` log, sequenced like check events. The kitchen's state
  (`kds_orders`) is a projection, like `pos_checks`. The rules live once, in
  `shared/pos/kitchen.js`, and run in the sequencer and on the screen (local first: a tap shows
  at once and is kept in the screen's outbox until the sequencer accepts it).
- **Till to kitchen**: sending dishes, firing a course, voids, moves and merges on the till
  change the kitchen orders in the same sequencer step, so the kitchen and the till never
  disagree about what was sent.
- **Online orders** enter as server-made events (`kitchen.order_in` / `kitchen.order_status`)
  when accepted on the orders board; the pass marking one ready marks the online order ready
  (the guest's email), if switched on.
- **GloriaFood orders** (migration 178, 17 Oct 2026) enter the same way, as GloriaFood pushes
  them (or the poll collects them), when Till setup switches it on (`kds_gloriafood`, off by
  default). Their kitchen id is `gf-<gloriafood_orders.id>` (source `gloriafood`, from the id
  prefix). GloriaFood dishes carry only a name: they are matched by name to the venue's live
  menus so dish and section links apply, and the GloriaFood order type maps to one of the
  tenant's (`kds_gloriafood_types`). Ready / collected in the kitchen moves our board status;
  Ready / Collected on the board and a cancellation in GloriaFood reach the kitchen. GloriaFood
  itself is never told.
- **The kitchen flow** (migration 169, 16 Oct 2026) replaced printer-style routing. Stations are
  prep, expo, runner or order ready board; links go from Orders in (the till and online orders)
  to stations and on from station to station, each with an optional filter (dishes, sections,
  revenue streams, order types). From each point a dish takes the links that name it most closely
  (dish, section, revenue stream, order type, then links for every dish), so a burger bun goes
  Prep 1 > Prep 2 (meat) > Expo 1 while the fries go Prep 1 > Expo 1, Prep 3's dishes go to
  Expo 2, and ORB 1 shows an order ready once both expos are done. Links that tie all apply:
  an expo can send to a board and a runner at once, or to a runner that then sends to the board.
  A dish's whole way is worked out when it is sent and kept on the dish (`item.route`), so a flow
  change during service only affects dishes sent after it. Designer: Till setup → Kitchen
  screens → Kitchen flows.
- **Several flows** (migration 177, 17 Oct 2026): a venue keeps named flows (`kds_flows`: a busy
  night, one cook, the grill down), one in use (`pos_settings.kds_active_flow_id`). The kitchen
  screen's flow button (top right) lists them and switches the whole kitchen
  (`PUT /pos-api/kitchen/flow`; Till setup can do the same, and can stop a screen switching). The
  shared rules don't know about it: the sequencer's kitchen config simply carries the links of the
  flow in use. A switch takes the venue's sequencer lock and the sequencer re-reads the setting per
  event, so it falls between two events, and it only affects dishes sent after it (dishes keep
  `item.route`). Switching needs the cloud for now (the hub would sequence it locally).
- **Order-ready boards**: the menu screens' `order_status` block shows numbers preparing and
  ready (`/screen-api/orders`), pushed on `kitchen.board`: every counter and online order, or one
  board station of the flow by name (`boards[name]`, ready once every dish on its way there has
  arrived). Side by side or stacked, with an optional animation when a number changes column.
- **Speed of service**: every bump and remake is a `kds_log` row (station, seconds, items,
  order type and source); Till reports → Kitchen shows it per station and hour, and the CSV
  export is the raw rows for spreadsheets or a BI warehouse.

### 9.2 Offline: do we need the hub?

Yes, for till-to-kitchen without the internet. A web app (PWA) can only make outgoing
connections: it can't listen for connections, and it can't discover other devices on the LAN
(no mDNS, no raw sockets). WebRTC between two tablets would work over the LAN, but setting up a
WebRTC connection needs a signalling server both can reach, which is the cloud. So two browsers
can't find each other with the internet down unless something on the LAN listens for them:
that is the hub.

What happens today without the hub:

- Internet up: tills and kitchen screens talk to the cloud; a dish sent on the till is on the
  kitchen screen within a second (socket push, else the poll).
- Internet down: each device carries on alone. The kitchen screen keeps its tickets and saves
  its taps; the till keeps trading and saves its sends. Nothing new reaches the kitchen until
  the till's sends reach the cloud. Printed kitchen tickets (when the hub prints) or a till
  printing kitchen tickets in its browser are the fallback.

What the hub changes, with no change to the rules: tills and kitchen screens get
`device.hub_url` (`pos/src/lib/transport.js` already tries it first); the hub runs
`createSequencer()` with a SQLite store, which already handles kitchen events through
`loadKitchenOrders()` / `saveKitchenOrders()` / `saveKitchenLog()`; it pushes `pos.seq` over its
own WebSocket and forwards everything to the cloud through its outbox. Section 2.1 (https, the
venue certificate, Chrome's Local Network Access prompt) applies to kitchen screens the same as
tills.

Network note (from the Wingstop technology guideline): sites that split the network into VLANs
(POS, KDS, menu boards, order-ready boards) must allow the POS and KDS VLANs to reach the hub on
its port, and the menu-board VLAN to reach the cloud (the order-ready board reads
`/screen-api/orders` from the cloud). With 4G / 5G failover the cloud path keeps working and
nothing changes for the devices.

### 9.3 Not built yet

- The hub itself (above), so no till-to-kitchen with the internet down.
- GloriaFood: a change to an order's dishes after it reached the kitchen isn't copied (only a
  cancellation); a dish whose GloriaFood name differs from the menu's isn't matched (it follows
  the order type and default links); orders that arrived while sending was off don't come on
  later; GloriaFood isn't told when the kitchen finishes.
- Ready / bumped shown on the till (the till doesn't show what the kitchen has done).
- Item-level cook times and "start this now" timing across stations (all dishes of an order
  start together; held courses and later online orders wait).
- No "split one dish into two jobs" (e.g. the burger's bun and meat as separate items on two
  stations at once): a dish moves through stations one after another, or a combo's parts go
  their own ways.
- Kitchen flows switch by hand only: no switching by time of day or day of the week, and dishes
  already sent are never moved to the new flow's stations (finish them where they are).
- Tested in Chromium on desktop sizes (tablet, TV, portrait) only; not yet on a real Android
  tablet, a TV box, or with a real bump bar. Sound needs one tap on the screen first (browser
  autoplay rule).

### 9.4 The kitchen test bench (17 Oct 2026)

Till setup > Kitchen screens > Test the kitchen opens every kitchen screen of a venue on one
page, scaled down, with a pretend kitchen in the browser (`shared/pos/kitchenBench.js`,
`pos/src/kitchen/Bench.jsx`). The screens are the real kitchen app in frames; the bench answers
their `/pos-api` calls and pushes with the same rules the sequencer runs, so a flow can be tried
with test orders (till or online, tables, counter, held courses, combos, made-up rushes),
bumps, recalls, remakes, flow switches and a screen going offline, and nothing reaches the
real screens, the tills, the reports or the database. The admin gets a signed, read-only link
(8 hours) to the venue's setup. Not built: playing back a real service, speeding the clock up,
till screens on the bench, or GloriaFood orders as a source.


## 10. Self-order kiosks (migration 172, 17 Oct 2026)

Address: `kiosk.<domain>` since 18 Oct 2026 (set it as the kiosk browser's start page); kiosks paired on the till address before then move with one tap.

The user's brief: "a fully fledged kiosk as a PWA, inspired by the screenshots (Wingstop's start
screen, menu with a category rail, a FLAVOR RULES combo with a step list and a card slider, a heat
slider from No spice to Very spicy), with a few ways of presenting choices: a simple grid, a list,
a slider like the screenshot, a spin wheel". Guides read: Wingstop's technology architecture deck
and the ConnectSmart Kitchen guide.

### 10.1 How it fits

- A kiosk is a till device of kind `kiosk`, linked by the code it shows at the kiosk address
  (`kiosk.<domain>`, 18 Oct 2026). The same PWA boots the kiosk screens (`pos/src/kiosk`) for it.
- Its orders are counter checks made of the till's own events (`kioskOrder()` in
  `shared/kiosk.js`), sequenced by the same sequencer, so they reach the tills' Counter list, the
  kitchen (and its flow), Till reports, X / Z and Cash Recon with no special case. The kiosk is the
  check's server (`kioskStaff()`: `{ kiosk: true }`, no permissions).
- The kiosk rules (`kioskProblem()` in `shared/pos/checks.js`) keep a kiosk to the events an order
  needs: open a counter check, add menu dishes, automatic offers, send, take a `card_external`
  payment, close. Nothing else (no discounts, voids, cash, tips, other checks, approvals).
- Prices, tax, combos and automatic offers are the till's own (`priceItem()`, `posTax()`,
  `shared/pos/offers.js`), so the kiosk shows exactly what the till charges.
- Card payments: a test reader only (Approve / Decline, no money). A real terminal plugs in at the
  card step: it must give back a reference the `payment.added` event carries.
- The design (`kiosk_designs`, tenant-wide) sets brand, layout (cards, round or oval photos, or
  hexagons, set apart for dishes and for choices; choices in words only, from the left or
  centred; the top bar; icon-only Back and Start again),
  start screen, languages, menu home page
  (sections down the side, or a page of section tiles), how choices show, paying and timing;
  `normaliseDesign()` is the one checker, `ownDesign()` keeps only the tenant's own ids. The editor
  shows the real kiosk in a frame and posts the unsaved design to it.
- Shared previews (migration 187): a design can have one lasting link for people outside the
  group (`kiosk_designs.share_token`, venue, stream, optional end date). The link opens
  `kiosk.<domain>/?kiosk_share=<token>`, a page that frames the kiosk at kiosk size with the
  saved design (`GET /pos-api/kiosk-share`, found in system mode). It never places an order, like
  Till setup's 12-hour previews; New link stops the old one.
- Menu version in previews (migration 188): a preview (the editor's, or a shared link with
  `share_menu = 'draft'`) can show the menus with changes saved and not published yet; the editor
  lists the menus with such changes (`menuChanges()`). A kiosk itself always gets the published menu.
- Split photo (migration 185): option groups and combo steps with it on turn the dish's photo into
  the picks' pictures side by side with torn edges between them (`splitImages()`).
- Choices: an option group or a combo step shows as grid, list, slider (with a level scale such as
  heat) or spin wheel; the group / step picks, else the design. Options have a picture, a line of
  words and a level 0-5.
- Languages: the kiosk's own words come in nine languages (`shared/kioskText.js`); the menu's words
  are translated on Menus > Translations (`menu_translations`, with an AI first draft).

### 10.2 Offline

- The kiosk keeps its config (IndexedDB) and opens without the internet, but its start screen says
  ordering is paused until it is back: a pay-at-counter order needs the till to see it, and a card
  payment needs the order to reach the kitchen.
- A card payment that went through when the order can't be sent is kept in the kiosk's outbox and
  sent again until accepted; the guest gets the kiosk's own number (`KS1-0012`) to show at the
  counter. The check carries it as `provisional_no`.
- A pay-at-counter order whose reply was lost is sent again with the same events; the server skips
  event ids it already has and returns the order number, so the till never gets it twice.
- Noticing (19 Oct 2026): the live link carries a heartbeat (a ping every 15 s, 6 s for the pong),
  so a router that loses the internet with the Wi-Fi still up is noticed, not only a link that
  closes. Any sign of trouble (link closed or silent, a request with no reply, the browser's
  offline event) gets two quick tries (after 1 s and 2 s) before ordering pauses; then a try
  every 5 s until the server answers. A server restart shorter than the quick tries never pauses
  ordering.
- Pictures: every picture in the config is loaded into the service worker's picture cache after
  each menu change (`pos/src/kiosk/photos.js`), so a guest mid-order sees the whole menu offline.
  Start screen videos aren't kept.
- With the hub (later), kiosks get `device.hub_url` like tills and keep taking orders with the
  internet down.

### 10.3 Not built yet

- Real card terminals (Dojo, SumUp, Zettle, Stripe Terminal, Adyen) at the kiosk.
- Receipts go to the kiosk's browser print; the receipt printer picked in Till setup is used once
  the hub prints.
- No loyalty, logins, vouchers or promo codes on the kiosk (automatic offers only).
- No "upsize" or "make it a meal" prompts beyond automatic combos and the "Anything else?" dishes.
- No age check for age-restricted dishes.
- The design editor has no undo beyond Discard.
- Tested in Chromium at kiosk sizes (1080 x 1920 and 1920 x 1080); not yet on a real kiosk screen,
  with a real card terminal, or with a screen reader.
