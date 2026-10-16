# Macaroonie POS — design

Status: **Phases 1-5 built cloud-first; the hub and printer trials are parked** (11 Oct 2026).
Decisions agreed 11 Oct 2026. What runs today, and what's provisioned for the hub, is in
section 8. Kitchen screens (KDS, 16 Oct 2026): section 9.

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
  revenue centres, POS roles), the device registry, the full event archive, reports, and the
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
- **Routing**: dish → section → revenue centre → venue default. Station printers (Kitchen,
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
| `pos_revenue_centres` | venue, name (Bar / Restaurant / Takeaway), VAT mode (eat_in / takeaway), menu, receipt header, sort |
| `pos_printers` | venue, name, IP, port, columns, kind (receipt / station), backup printer |
| `pos_print_routes` | dish or section (optionally per revenue centre) → printer |
| `pos_roles` | permissions and limits per staff role |
| `cash_staff` + | `pin_hash`, `pos_role_id` |
| `floor_areas` | venue, name, size, sort |
| `tables` + | `floor_area_id`, `x`, `y`, `w`, `h`, `shape`, `rotation` |
| `pos_courses` | tenant: Drinks / Starters / Mains / Desserts, order, fire by default |
| `menu_sections` + / `menu_items` + | default course / course override |
| modifiers | extend variant groups: nested groups, "no / extra / light", per-dish prices (exist) |
| combos | `menu_items.kind = 'combo'` + slots (choose from a section or list, upcharges) |
| `pos_events` | the event log (source of truth) |
| `pos_checks`, `pos_check_lines`, `pos_payments` | projections |
| `pos_shifts` / `pos_days` | drawer floats, X/Z reports, cash-up into Cash Recon |

---

## 4. What we reuse

- **Menus**: sections, dishes, option groups (`price_mode`, `min_select` / `max_select`),
  takeaway / eat-in VAT and `vatRateFor()`, allergens, the sold-out list.
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

- VAT: eat-in vs takeaway follows the revenue centre, then dish / section / venue rates. The
  receipt shows the VAT number and a VAT breakdown.
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
| 5 | Counter mode: quick-service screen, order numbers, takeaway revenue centre, combos. | M |
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
| Till app | `pos/` | React PWA served by the API on `pos.<domain>` (`routes/posSite.js`, no nginx change). Local-first: IndexedDB outbox, optimistic apply, socket + polling sync. Table service, tabs, counter mode, courses (hold / fire), modifiers, meal deals, discounts / comps / offers, service charge, split / move / merge, pay (external card, cash, voucher, ...), refunds, reopen, X / Z. |
| Cash Recon | `services/reconFill.js` | Z figures fill the Cash Recon day through `recon_map` (shared with Loyverse). |
| Sold out | `services/soldOut.js` | Hold a dish (or tap a sold out one) on the till: `PUT /pos-api/sold-out/:itemId` (role permission `sold_out`, or a manager's PIN), online only. The same `ordering_item_availability` rows as online ordering; every till, the orders board and the menu screens hear it. `tillConfig().sold_out`. Migration 166. |

Changes from sections 2-3, while there is no hub:

- **Tills talk to the cloud only.** With the internet down a till keeps trading on its own
  (outbox), but two tills don't see each other until it's back; clashes are refused and listed
  (Till reports → Refused changes). The hub removes that gap.
- **Pairing is by one-time code**, not an Auth0 login: Till setup → Add a till shows a code
  that `POST /pos-api/pair` swaps for a device secret.
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

---

## 9. Kitchen screens (KDS)

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

- **A kitchen screen is a device** (`pos_devices.kind = 'kds'`), paired with a one-time code at
  the till address like a till; the same `pos/` app opens the kitchen UI for it. No PIN: a
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
- **Routing** works like printers (dish, section, revenue centre, default) to prep stations;
  the pass sees everything.
- **Order-ready board**: the menu screens' `order_status` block shows numbers preparing and
  ready (`/screen-api/orders`), pushed on `kitchen.board`.
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
- GloriaFood orders on the kitchen screens (they reach the orders board, not the kitchen).
- Ready / bumped shown on the till (the till doesn't show what the kitchen has done).
- Item-level cook times and "start this now" timing across stations (all dishes of an order
  start together; held courses and later online orders wait).
- Tested in Chromium on desktop sizes (tablet, TV, portrait) only; not yet on a real Android
  tablet, a TV box, or with a real bump bar. Sound needs one tap on the screen first (browser
  autoplay rule).

