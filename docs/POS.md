# Macaroonie POS — design

Status: **Phases 1-5 built cloud-first; the hub prints (mini PC appliance, 20 Oct 2026, section
2.6); its offline role and the printer trials on real hardware are still to do.**
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
- **Check numbers** come from the device that opens the check (migration 217, section 8.4):
  T2-47 is till T2's 47th check of the trading day, and counter orders take order numbers from
  the device's own range. Nothing hands numbers out, so a device alone, the hub and the cloud
  never give the same one twice.
- Cloud tables (`pos_checks`, lines, payments) are **projections** rebuilt from events;
  reports read the projections.

First event types: `check.opened`, `check.covers_set`, `check.table_moved`,
`check.server_changed`, `line.added`, `line.changed` (before send), `line.deleted` (before send),
`lines.sent`, `course.held`, `course.fired`, `line.voided`, `discount.applied`,
`discount.removed`, `charge.added` / `charge.removed` / `charge.restored` (section 8.5; was
`service_charge.set`), `check.split`, `check.merged`, `lines.moved`,
`bill.printed`, `payment.added`, `payment.voided`, `check.closed`, `check.reopened`,
`refund.added`, `drawer.opened`, `day.closed`.

### 2.3 Devices and staff

- **Terminal pairing**: a manager signs in (Auth0) once on the device, picks the venue and
  names the terminal. The cloud creates a `pos_devices` row and a device secret (stored
  hashed). The terminal also receives the hub address and the venue CA to install.
- **Hub pairing**: a one-time code from admin (POS settings, Hubs, Add hub).
- **Staff**: 4–6 digit PIN per staff member (`cash_staff`), hashed (PBKDF2, `shared/pos/pin.js`),
  synced to the terminals. A leading 0 counts, and no PIN may start with another person's or be
  the start of theirs (`pinOverlaps()`: the till signs in as soon as the digits match someone).
  Manager PIN for overrides. Devices can be revoked in admin.
- **POS permissions per role**: void after send, refund, discount up to N%, comp, open
  drawer, reopen check, take over another server's check, price override, manager override.

### 2.4 Printing

- The hub prints raw **ESC/POS over TCP 9100** (every Epson network printer and ESC/POS
  clone accepts it). Code page WPC1252 (`ESC t 16`) so £ prints.
- The ticket is built in `shared/pos/tickets.js` as a list of print operations, so the same
  ticket can be previewed in admin; `hub/src/escpos.js` turns it into bytes.
- **Designs** (migration 190, 19 Oct 2026): what a kitchen ticket or receipt shows and in which
  order is a layout of parts (`shared/pos/ticketLayout.js`), company wide, picked per use
  (kitchen tickets, till receipts and bills, kiosk receipts) for the company or one venue, with
  a venue's own words and hidden parts. Tills, kiosks and the sequencer get the resolved layouts
  in their config (`print_layouts` / `layouts`); the admin designer previews them in the printer's
  columns (`previewHtml()` in `shared/pos/ticketHtml.js`).
- **Routing** (migration 191, 19 Oct 2026): kitchen tickets go where the kitchen flow sends
  dishes: a station of kind `printer` in the flow prints each dish once when it reaches it
  (`shared/pos/kitchenPrint.js`, run by the sequencer; held courses as HOLD then FIRE, VOID
  after a void; orders for later through `kitchen.print_due` from the minute sweep). The
  old routing list (`pos_print_routes`: dish → section → revenue stream → default) is gone.
  Bills and receipts go to the device's receipt printer; a backup printer per printer.
- **Who prints** (migration 191): a printer is `hub` (network, printed by the venue hub,
  `hub/bin/hub.js`, a device linked by its code) or `device` (plugged into a till or kitchen
  screen, printed by its browser: `pos/src/lib/devicePrint.js`; Chrome `--kiosk-printing` for
  no dialog). A device prints its own bills in its browser when its receipt printer is none or
  plugged into it. The hub reports each printer's state to Store tech. A USB printer plugged
  into the hub's mini PC (migration 195) is `device` with `device_id` = the hub and `local_id`
  = its id on that computer; the hub prints it (section 2.6).
- Queue per printer with retries; status check so terminals see "printer offline / out of
  paper"; reprint.
- Cash drawer opened through the receipt printer (`ESC p`).
- Hub down: terminals print straight to the printer with Epson ePOS-Print (later phase).

### 2.5 Payments (card machines built 20 Oct 2026, migration 193)

Built as designed, with these names and choices:

- Tenders: `cash`, `card_external`, `voucher`, `account`, `card_integrated` ("Card machine",
  one tender for every provider; the provider is on the attempt).
- Attempts are `pos_card_payments` (kind sale | refund; `pending` → `signature` →
  `approved` / `declined` / `cancelled` / `failed`), with the provider's references, the card
  shown (brand, last 4) and `used_event_id` once an event has put it on a check. The
  provider's idempotency key is the attempt id.
- The server drives every payment (`services/cardSvc.js`): the till or kiosk asks the API to
  start one, the API writes the attempt, calls the provider outside any transaction and writes
  the result; the device polls the attempt (at most one provider call per 1.2 s), the minute
  sweep checks attempts devices stopped watching and gives up after 15 minutes. No webhooks yet.
- Adapters in `services/cardMachines/` (`check`, `listReaders`, `pairReader`, `startSale`,
  `saleStatus`, `cancelSale`, `answerSignature`, `refund`, `simulate`): Dojo (Terminal
  Sessions API), Stripe Terminal (server-driven, the tenant's own account, not Connect), SumUp
  (Cloud API for Solo), and a test machine. Adyen and Zettle not built.
- The check rules hold the money: `payment.added` with `card_integrated` must name an approved
  sale attempt of this venue for exactly its amount and tip, used once (`shared/pos/cards.js`,
  checked by the sequencer with the store's `loadCardPayment` / `useCardPayment`); a refund
  or taking such a payment off must name an approved refund attempt. A store without those
  methods (the venue hub) refuses them: integrated payments need the internet, and offline the
  till falls back to `card_external`.
- A card machine is a venue's `pos_card_readers` row; a till or kiosk picks one in its
  settings (`card_reader`). Kiosks pay before their order exists (the attempt carries the
  payment id the order's event will use).
- Card data never touches Macaroonie (PCI scope stays with the provider).

### 2.6 The hub on a mini PC (migration 195, 20 Oct 2026)

Hardware: a fanless mini PC (Intel N100 class, 8 GB, wired Ethernet), one per venue, on a
cable to the router with a fixed address; Linux (Ubuntu / Debian) preferred, Windows 10/11
supported. Android stays for tills, kiosks and kitchen screens: a hub needs raw TCP and USB
access, a service that starts with the computer, and (later) a LAN server, which a PC gives
without app-store packaging.

- **Install**: download the installer on the mini PC from `pos.<domain>/hub` (Windows:
  `macaroonie-hub-setup.cmd` to double-click, which asks to run as administrator; Linux:
  `macaroonie-hub-setup.sh`, which asks for sudo itself), or one command shown in Store tech
  → Printers (`curl … /pos-api/hub/install.sh | sudo sh`, or `irm … /pos-api/hub/install.ps1
  | iex`). Its own Node 22 (checked against
  nodejs.org's SHASUMS), the hub from the cloud (checked against its sha256), a systemd
  service as its own user (in `lp`) or the Windows service `MacaroonieHub` as LocalSystem
  (`hub-service.exe`, compiled on the PC from `hub/install/HubService.cs` with Windows' own C#
  compiler; it runs the launcher in a job object, so stopping it stops every hub process; a
  scheduled task where Windows won't run it), then the link code.
- **Link**: the code on the console, on the hub's page (`http://<hub>:9180`, with a QR code for
  the installer app) and in `state.json`; linked like any device. Removed in Store tech, the
  hub shows a new code by itself.
- **Printers**: network (TCP 9100) and USB on the hub: Linux `/dev/usb/lp*` (found again by
  USB vendor, product and serial, never by device file), Windows printers by name (RAW spooler
  job). The hub lists the USB printers it finds every minute; Store tech offers them.
- **Updates**: the cloud serves the hub's code as one file (`hubRelease()`, version = the
  source version + a hash of the files). The hub installs a new version at a quiet moment
  (download, sha256, unpack, `--self-test`, switch), keeps the version before, and the launcher
  goes back to it when a new one stops three times within a minute. Automatic by default;
  off = Update now in Store tech.
- **Not yet**: the offline role (SQLite sequencer, serving `/pos-api` on the LAN with a venue
  certificate, tills using `hub_url`); serial printers on Linux; a cash drawer kick on its own.
  (The offline role came with hub first, section 11, without SQLite or a venue certificate.)
- **Store tech**: the hub has its own page, Store tech → Venue hub (`/pos/hub`, migration 219,
  `admin/src/components/pos/HubSection.jsx`): linking, its state, version and updates, the USB
  printers it found, Hub first and the install instructions. The Printers page keeps the printers.
- **On Android**: scoped, not built: `docs/ANDROID_HUB.md` (the same hub JavaScript under
  nodejs-mobile in a small Android app with a foreground service).

---

## 3. Data model (cloud, first cut)

| Table | Holds |
|---|---|
| `pos_devices` | terminals and hubs: venue, kind, name, secret hash, last seen, app version, revoked |
| `pos_revenue_streams` | venue, name (Restaurant / Bar / Kiosk), menus, the order types it offers with their prompts, default order type, sort (was `pos_revenue_centres` with a VAT mode; migration 170, section 8.1; its service charge moved to the order types' charges, migration 225, section 8.5) |
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
| Rules, pricing, printing, reports | `shared/pos/` | `checks.js` (events + `applyEvent()`), `pricing.js`, `printing.js` (`jobsForEvent()`: bills, receipts, drawer), `kitchenPrint.js` (kitchen printers in the flow, migration 191), `reports.js` (`dayFigures()`), `sequencer.js` (`createSequencer(store)`), `permissions.js`, `pin.js`, `ids.js` (ULID), `tickets.js`. Tests: `node --test shared/pos/test/*.test.mjs`. |
| Schema | migration 156 | Section 3's tables as built; see Docs.jsx → Till (POS) for the columns. |
| Sequencer | the cloud | `services/posSvc.js` runs `createSequencer()` with a Postgres store under a per-venue advisory lock. The hub will run the same sequencer with SQLite. |
| Till API | `/pos-api` (`routes/posApi.js`) | Pairing, device auth, config snapshot, events in, sync out, presence, reports, print queue (claim / status routes are for the hub). |
| Admin | `/api/pos` (`routes/posSetup.js`) | Store tech, Floor plan, Till reports pages; Menus / Variant groups / Promotions till fields. |
| Till app | `pos/` | React PWA served by the API on `pos.<domain>` (`routes/posSite.js`, no nginx change); the same build runs the kitchen screens on `kitchen.<domain>` and the kiosks on `kiosk.<domain>` (18 Oct 2026: each device app on its own address, `pos/src/lib/appHost.js`; a pairing code only works on its kind's address; `POST /pos-api/disconnect` and `/move`). Local-first: IndexedDB outbox, optimistic apply, socket + polling sync. Table service, tabs, counter mode, courses (hold / fire), modifiers, combos, discounts / comps / offers, service charge, split / move / merge, pay (external card, cash, voucher, ...), refunds, reopen, X / Z. |
| Cash Recon | `services/reconFill.js` | Z figures fill the Cash Recon day through `recon_map` (shared with Loyverse). |
| Sold out | `services/soldOut.js` | Hold a dish (or tap a sold out one) on the till: `PUT /pos-api/sold-out/:itemId` (role permission `sold_out`, or a manager's PIN), online only. The same `ordering_item_availability` rows as online ordering; every till, the orders board and the menu screens hear it. `tillConfig().sold_out`. Migration 166. |

Changes from sections 2-3, while there is no hub:

- **Tills talk to the cloud only.** With the internet down a till keeps trading on its own
  (outbox), but two tills don't see each other until it's back; clashes are refused and listed
  (Till reports → Refused changes). The hub removes that gap.
- **Linking is by the code the device shows**, not an Auth0 login: the device asks for a code
  (`POST /pos-api/pairings`, it keeps the secret) and shows it with a QR code; someone signed in
  types it in Store tech (Add a till / screen / kiosk) or links it in the installer app
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

The hub service prints since migration 191 and installs, links and updates itself on a mini PC
since migration 195 (section 2.6).

Still to do: Trials 1-3 on real hardware, the hub's offline role, Adyen / Zettle card machines
(Dojo, Stripe Terminal and SumUp are built, section 2.5), the till layout designer (Phase 7), online orders into the till, bookings on the floor plan.
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
  Pay, on its full-screen order prompt (section 8.6).
- **Kitchen**: kitchen orders carry `type` (the order type id), `type_name` and `tent`; flow
  links filter on the tenant's types; the kitchen screen's tabs are the tenant's types. What a
  ticket's title and an order ready board's tile show (number, tent, table, name) comes from
  `shared/orderInfo.js` (migration 189: kitchen screen setting `ticket_main`, Order status block
  `tile_main` / `tile_lines`). A kiosk asks for a tent number (design `checkout.number_kind`
  tent, or table); guests take a numbered tent from a stand by the kiosk or till.
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
- **A dish's options in the deal** (25 Oct 2026, no migration): each dish or section choice can
  change what its dish asks inside the deal, one option group at a time: as on the dish, left
  out, only some options, another library group instead, and its own how many
  (`option.groups`, stored only when set). The choice keeps its `item_id`, so routing, stock,
  allergens, photos and sold out still follow the menu dish. One rule, `dealChoices()` in
  `shared/combos.js`, wrapped by `partChoices()` / `dealItem()` (till, kiosk) and
  `partOptions()` with the combo's `deal_groups` (online); `priceCombo()` passes the groups to
  the part pricing, so a pick the deal doesn't ask is refused. "Make it a combo" keeps only the
  picks the deal asks (`picksWithin()`), and an automatic combo only takes separate dishes whose
  picks fit (`dealFits()` in `findAutoCombos()`).
- Not built: a combo inside a combo; per-step prices that depend on another step; combos on
  GloriaFood or Deliveroo (the Deliveroo file sends a combo's own price; its choices are
  Deliveroo modifiers set in the Hub).

### 8.3 Keeping devices up to date by asking (29 Oct 2026, no migration)

Pushes (`pos.config` on the device's venue room) bring changes at once, but a device must never
depend on them (a socket the Android WebView or the router lets hang, a push sent while it was
reconnecting). So tills, kiosks and kitchen screens also ask, on timers in `pos/src/lib/livePull.js`:

| What | How often | Route | Effect |
|---|---|---|---|
| The whole config | standard every 3 minutes (`pull.content`), and on a push | `GET /pos-api/config?version=` | "unchanged" costs one reply; anything else is downloaded and kept on the device |
| Prices and sold out (till, kiosk) | standard every 30 s (`pull.live`, can be off) | `GET /pos-api/live` -> `{ sold_out, prices }` | sold out changes in place; a new prices stamp fetches the config |
| A menu screen's boards | standard every minute (`pull.screen`) | `GET /screen-api/config?version=` | as the whole config |
| Order ready board numbers | standard every 15 s (`pull.board`) | `GET /screen-api/orders` | redrawn |

The times are the location's (migration 216, Store tech -> Device updates; `shared/pos/pullTimes.js`
has the limits and the defaults), carried in every device config as `pull`. `createPullTimers()`
reads them before every wait and starts again when a new config brings other times.

`liveFields()` (`services/posSvc.js`) works out both: the venue's sold out rows now, and a stamp
over the tenant's live menu releases (so a scheduled publish changes it the moment it goes live,
with no write), the option group library, the promotions and the venue's date. Neither is part
of the config's `version` (it is computed before they are added), and every till or kiosk
config reply carries them, an unchanged one too. So a dish sold out never makes a device
download its config again, and a stamp change for something this venue doesn't sell only costs
an "unchanged" config reply.

Every device opens from what it keeps: the config in IndexedDB, the app in the service worker's
precache, a kiosk's pictures in `kiosk-images` (`photos.js` saves every one after each change)
and, since this change, its design's videos (start screen, reach band) in `kiosk-videos`:
`saveVideos()` downloads each whole (a video element's Range requests can't be cached) and the
service worker serves the parts out of the saved file (`rangeRequests`); videos the design stops
playing are deleted. `keepStorage()` asks the browser to keep all of it when space runs short.

### 8.4 Every device numbers its own checks (migration 217, 29 Oct 2026)

Numbers used to come from venue counters in `pos_venue_state` (`next_check_no`, `next_order_no`,
`pos_settings.order_no_start`), given out by the sequencer. That works only while one place
sequences: a till working alone, a hub and the cloud would each count from the same counter and
hand out the same numbers. So every till and kiosk numbers its own (`shared/pos/numbers.js`):

- **Check number**: the device's code and its own count for the trading day, `T2-47`
  (`numberText()`). The device puts `number` in the `check.opened` payload; the sequencer stamps
  `assigned.number_code` from the device's `short_code` (never from the payload) and the check
  stores `number_code`.
- **Order number** (counter orders, tills and kiosks): from the device's range,
  `settings.order_numbers { from, to }`, going round within it. A device gets the next free block
  of a hundred when it is linked (1-99, 100-199, ...; `freeOrderRange()`), keeps it when brought
  back unless another device took it, and Store tech refuses a range that overlaps another till
  or kiosk at the location (422 `order_numbers`, naming it). A kiosk's number is known at once,
  so a paid card order waiting in the outbox shows its real number, not a provisional one.
- **Trading day**: a device counts under the open trading day's date as the server last said
  (the till's sync `day`, a kiosk's config `trading_day`), so a day not closed by the next
  morning keeps counting; with no open day it counts under its own clock's date
  (`businessDate()` with `day_starts_at`), the date the sequencer gives the day it opens.
- **Recovery**: the device keeps `{ date, check, order }` (the last it gave out) in localStorage
  (`pos/src/lib/numbers.js`). The sequencer remembers each device's highest numbers per day
  (`noteNumbers()`, `pos_venue_state.device_numbers`), sent back in every `/sync` and `/config`
  reply (an unchanged one too); `mergeNumbers()` keeps the later day, then the higher check
  number, so a device that lost its storage carries on instead of starting at 1 again.
- **Closing the day**: devices report how many changes they haven't sent yet on every request
  (`X-Pos-Pending`, stored as `pos_devices.pending_changes`). The day report (`/reports/day`)
  lists `waiting`: devices that said they have changes, and devices not heard from for
  10 minutes but seen today. The till's Close the day shows them as a warning (a broken or lost
  device mustn't keep the day open).

This is the first step of hub-first locations: with numbers made on the devices, any place that
sequences (the cloud, the hub, a till on its own) accepts them without coordinating.

### 8.5 Charges per order type and the discount list (migration 225, 31 Oct 2026)

The revenue stream's single service charge (a percent from N covers) gave way to **charges on
the order type** (`order_types.charges`, `shared/pos/charges.js`): several per type, each a
percent of the check after its discounts or an amount per check, optional (staff may take it
off; the venue can make that need a manager) or not (a manager every time), from N guests, with
or without VAT at one of the tenant's tax rates. A check carries its charges as state, put on
by the till in `check.opened` and when its type changes (`switchCharges()`: a charge taken off
stays off, also through a round trip, via `check.charges_off`; charges typed on the till with
`charge.added` stay). `charge.removed` / `charge.restored` take one off and put it back.
`checkTotals()` lists each charge (`amount`, `would_be`, `removed`, `waiting`) and sums the ones
that count as `service_charge`; the bill, receipt, X / Z and Till reports name each one, and the
Cash Recon link can send a charge by name (`charge:<name>`) or all together. Kiosk orders carry
none.

**Discounts** set up in Store tech (`pos_discounts`, `shared/pos/discounts.js`) reach every rule
runner in `settings.discounts`. A discount from the list goes on with its `preset_id`, its
type, value and scope checked against the list; it needs no discount permission, or a manager
every time when marked so. Discounts typed in keep the role's limit and can be put behind a
manager with the venue's `custom_discount` switch (`MANAGER_ACTIONS`).

### 8.6 The order prompt (migration 226, 31 Oct 2026)

A counter order, a tab, More → Order type / Name / Tent number, and the missing details at Send
and Pay all go through one screen, `pos/src/components/OrderPrompt.jsx`. It covers the till and
brings its own keys (letters for the name, a number pad for the tent), because a tablet's own
keyboard is unreliable for this (it covers half the screen, and some tablets never show it) and
staff type the same few things all day. The inputs are `inputMode="none"` but keep the focus, so
a keyboard plugged in still types. Two ways, per venue (`pos_settings.order_prompt`) with a
till's own choice (`pos_devices.settings.order_prompt`): `one`, the types above the fields on one
screen, and `two`, big type buttons first, then only what that type asks. A type that asks for
nothing finishes on the tap. Nothing changed in the events: the prompt hands back
`{ typeId, name, tent }` and the callers open or change the check as before (`check.opened`,
`check.order_type_set` with the re-rated lines and charges and any new name or tent,
`check.renamed`).

### 8.7 Till layouts (migration 228, 31 Oct 2026)

A till's order screen can be arranged by the company (`pos_till_layouts`, company wide;
`shared/pos/tillLayout.js` holds every rule). A layout is a grid of cells holding **zones**: the
order (`check`), `categories`, `items` (dishes), `buttons` (a dish, or a function: a tender,
exact cash or card, the last receipt, a discount from the list, Send, More ...), `modifiers` (a
dish's choices while it is added: must-pick, optional or both, in their own rectangle over
other zones or over the whole screen) and `seats`. Each zone has its own button grid
(`cols` x `rows`, so a button's size follows the zone), text size, bold, and what happens when
more than fits (`scroll`, `pages`, a `more` button in the last cell, or `hide`). One function,
`packCells()`, places the buttons for the till (`pos/src/components/ZoneGrid.jsx`) and the
designer's preview, so a button lands in the same cell in both. Only modifiers zones may sit over
other zones; a layout without the order zone, or with zones overlapping, isn't saved
(`layoutProblems()`).

Which layout a till draws: its own (`pos_devices.settings.till_layout`: a layout id, `standard`,
or `venue`), else its location's (`pos_settings.till_layout_id`), else none: the standard screen
(`tillLayoutOf()` in `pos/src/lib/tillLayout.js`). `tillConfig()` carries the layouts in use at
the venue (`till_layouts` by id), so a till draws its layout offline like the rest of its config.
Nothing changed in the events: a layout only arranges the screen; dishes, choices and buttons go
through the same `addItem()`, choices rules (`toggleChoice()` / `tapStep()` from `ItemModal.jsx`,
the price from `priceItem()`), modals and Pay as the standard screen. A layout names dishes,
sections and discounts by id; `ownTillLayout()` drops any that aren't the company's when it is
saved, and a till greys a button whose dish, discount or tender it doesn't have.

Later on 31 Oct 2026 (no migration): a layout can leave out the till's top bar (`top_bar`
false): the check and counter views then take the whole screen and the till menu (the pages,
Sign out, the till's details) is in More, on the counter's New order panel and behind a Buttons
zone's `till_menu` button (`TillNav` and `TillMenuSection` in `pos/src/components/TillMenu.jsx`).
The order zone has a text size, its own buttons that can be left out when a Buttons zone does
their job (`hide`, warned about by `layoutWarnings()` when nothing does), and colours. A
must-pick modifiers zone can add the dish on the tap that completes a one-pick choice
(`auto_add`), and each modifiers zone can leave out the dish's name, description and prices.

1 Nov 2026 (no migration): each zone with buttons says where the words sit on them (`align`
left | center | right, `valign` top | middle | bottom; defaults per zone type keep the old
look), turned into flex styles by one function, `buttonTextStyle()`, for the till and the
designer's preview. The seats zone shows both, seats only or courses only (`parts`). A
must-pick modifiers zone can take more picks than a one-pick group allows, a dish each
(`split_picks`, never with `auto_add`): `splitPicks()` in `shared/pos/pricing.js` makes one
selection per dish (groups picked more than once pair up in order and need the same count, the
rest go on every dish) and `addChosen()` adds a line for each through `addItem()`. Tills now
follow the menu's option settings (Hide unpriced, Hide £0 price) like the kiosks: every
till item carries `variant_rules`. The Send to the kitchen window is a big button per course,
green for Cook now, plain with a Wait (hold) label for a course that waits. And `addItem()`'s
same-line check compares modifiers as data: a line the till had back from the server (jsonb
reorders keys) never matched a new identical dish before, so it made a second line.
Still not built: a layout per order type, revenue stream or time of day; more picks for a meal
deal's steps or the groups a pick opens.

### 8.8 The order's allergy flag (31 Oct 2026, no migration)

A guest's allergy can be flagged on the whole check, not only on one dish: More → Allergy, the
red bar on the check, or a till layout button (action `allergy`). The flag is
`{ allergens: [{ code, name }], diets: [{ code, name }], note }` (`shared/pos/allergy.js`), set
by the event `check.allergy_set` and kept on the check like its other details; codes are the
menu's tag codes and names are kept beside them, so the kitchen, tickets and reports read it
without the menu. It follows dishes moved to another check and checks merged into another
(`mergeAllergy()`).

The kitchen gets it as words (`allergyText()`) on the kitchen order, the same field online
orders' allergy note uses, so kitchen screens show it at the top of the ticket with no change
of their own. Kitchen printers print it above the dishes, inside the items part of the ticket
that no print design can leave out; each printer box records what it printed with the order
(`o.allergy_printed`), and a change after printing prints an ALLERGY UPDATE ticket (job kind
`allergy`) to the printers that already had the order. The till marks each line that doesn't
suit the flag with the kiosk's own reading of a dish's tags (`dishLevels()` / `mergeLevels()`
in `shared/kiosk.js`; `pos/src/lib/allergyFit.js`), meal deals by the dishes picked in them.
Not linked yet: the kiosk's allergens screen picks and online orders' allergy note stay as they
were (the kiosk's picks don't become the order's flag).

### 8.9 Menu times (migration 230, 31 Oct 2026)

When each menu is on is one table per location for the website, the kiosks and the tills
(Menus > Menu times, `menu_times`, rules in `shared/menuTimes.js`): the menu's own times, and a
cell per channel (the menu's times, any time, the channel's own times, or off). The device
configs carry each menu's times for their channel (`tillMenuData(..., { channel })`); a menu off
on that channel isn't in the config at all. The times are content, not live data: they change
the config version and reach devices by the `pos.config` push or the content pull (8.3).

- **Tills** show the revenue stream's menus that are on now, worked out on the till every 30 s
  in the venue's time zone (`useShownMenus()`), and every menu when none is on, so the till can
  always sell. Staff can pick other menus (More > Menus, the counter's Menus button, the layout
  button action `menus`); the pick is the till's own (prefs `menu_pick`) and lapses when the
  menus on now change. Nothing about menus goes into events or checks: a dish rung up is a dish
  rung up, whichever menus showed.
- **Kiosks** fix a visit's menus when it starts (`state.menuIds`) and change them only on the
  start screen, so a guest never loses a dish mid-order; with no menu on, the start screen is
  closed and says when it opens. Previews show every menu.
- The hub needs nothing: devices decide what shows, and the hub decides events as before.

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
  them (or the poll collects them), when Store tech switches it on (`kds_gloriafood`, off by
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
  change during service only affects dishes sent after it. Designer: Store tech → Kitchen
  screens → Kitchen flows.
- **Several flows** (migration 177, 17 Oct 2026): a venue keeps named flows (`kds_flows`: a busy
  night, one cook, the grill down), one in use (`pos_settings.kds_active_flow_id`). The kitchen
  screen's flow button (top right) lists them and switches the whole kitchen
  (`PUT /pos-api/kitchen/flow`; Store tech can do the same, and can stop a screen switching). The
  shared rules don't know about it: the sequencer's kitchen config simply carries the links of the
  flow in use. A switch takes the venue's sequencer lock and the sequencer re-reads the setting per
  event, so it falls between two events, and it only affects dishes sent after it (dishes keep
  `item.route`). Switching needs the cloud for now (the hub would sequence it locally).
- **Shared flows and Sent from** (migration 192, 20 Oct 2026): a flow can belong to the company
  (`kds_flows.venue_id` NULL) instead of one venue. Its boxes are station *names*; at each venue
  `resolveSharedFlow()` turns them into that venue's stations of the same names (and stream and
  till filters into that venue's ids by name), leaving out links to boxes the venue lacks. The
  sequencer, kitchen screens and the bench only ever see ordinary links, so the rules didn't
  change. Each venue lists its own flows then the shared ones and puts one in use itself. A
  link can also filter on the till or kiosk that sent the order (`device`, ranked after section),
  so Till 1 at a location can send to that location's bar station: decided by names, Till 1 at
  Ware goes to Ware's Bar and Till 1 at Hertford to Hertford's.
- **Except links** (migration 204, 24 Oct 2026): a link's filter can be turned round
  (`exclude`, All except these in the designer): the link takes every dish none of its entries
  names (Orders in > Wok, all except Drinks and Desserts). It ranks after every filter that names
  the dish and before links for every dish, so a link for every dish beside it takes what it leaves
  out; with nothing listed it is a link for every dish. In a shared flow an excepted name a
  location lacks leaves nothing out there.
- **Splitter modes** (24 Oct 2026, no migration): a Splitter shares by fewest pieces or Smart
  (`share_mode: 'speed'`): the ticket goes where it should be done soonest, the pieces still to
  cook there times the station's pace (`stationPace()`: seconds per piece over its last 8 bumps
  in the last 30 minutes, queueing time not counted twice), so a line falling behind gets fewer
  tickets until it catches up. A busy order type rule (`rush_type_id`, `rush_count`,
  `rush_station_id`) splits by order type while that type is busy: from N waiting orders of the
  type (with dishes still to cook at the box's stations), its tickets go to its own station and
  every other ticket to the others. The sequencer reads recent orders for the pace only when a box
  is Smart (`loadRecentKitchenOrders()`); the hub's store will need the same.
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
- Shared flows match stations, revenue streams and tills by name only: a location naming its
  Grill "Grill 1" doesn't get the Grill box (rename the station or the box). There is no
  per-location exception inside a shared flow (copy it as the location's own instead), no
  "switch every location now", and Sent from can't tell online orders apart (they have no
  device; use the order type or revenue stream).
- Tested in Chromium on desktop sizes (tablet, TV, portrait) only; not yet on a real Android
  tablet, a TV box, or with a real bump bar. Sound needs one tap on the screen first (browser
  autoplay rule).

### 9.4 The kitchen test bench (17 Oct 2026)

Store tech > Kitchen screens > Test the kitchen opens every kitchen screen of a venue on one
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
  needs: open a counter check, add menu dishes, automatic offers, send, take a card payment
  (`card_integrated` with an approved attempt, or `card_external` from older kiosks), close. Nothing else (no discounts, voids, cash, tips, other checks, approvals).
- Prices, tax, combos and automatic offers are the till's own (`priceItem()`, `posTax()`,
  `shared/pos/offers.js`), so the kiosk shows exactly what the till charges.
- Card payments (20 Oct 2026): the kiosk's card machine (Store tech → Card machines, section
  2.5). The kiosk starts a sale with the payment id its order's `payment.added` will carry, waits
  for the machine, then sends the order; a declined card offers to try again or pay at the counter.
  The test machine has Approve / Decline buttons; previews and shared links keep a pretend card
  step that never charges.
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
  Store tech's 12-hour previews; New link stops the old one.
- Menu version in previews (migration 188): a preview (the editor's, or a shared link with
  `share_menu = 'draft'`) can show the menus with changes saved and not published yet; the editor
  lists the menus with such changes (`menuChanges()`). A kiosk itself always gets the published menu.
- Split photo (migration 185): option groups and combo steps with it on turn the dish's photo into
  the picks' pictures side by side with torn edges between them (`splitImages()`).
- A meal deal's picture (design `layout.combo_build`, 24 Oct 2026): from the first pick with a
  picture, a meal deal's pages and its order line show the picks put together like a photo of the
  meal instead of the deal's photo (`bundleParts()`, `bundleLayout()` in `shared/kiosk.js`;
  `BundlePhoto`); each new pick pops in. Design `layout.hero_backdrop`: a shade behind every dish
  photo on its page and in the order (off: none, not even behind a split photo).
- Choices: an option group or a combo step shows as grid, list, slider (with a level scale such as
  heat) or spin wheel; the group / step picks, else the design. Options have a picture, a line of
  words and a level 0-5. Since migration 206 a group also has its own picture style, words only and
  entrance, and a design can give any group its own look (display, picture style, words, entrance;
  `options.group_looks`), which wins: `groupLook()` decides each part (design for the group, group,
  design for every choice). Option groups also carry a `variation_type` for stock (modification,
  side, addition), not used yet.
- Languages: the kiosk's own words come in nine languages (`shared/kioskText.js`); the menu's words
  are translated on Menus > Translations (`menu_translations`, with an AI first draft).

### 10.2 Offline

- The kiosk keeps its config (IndexedDB) and opens without the internet, but its start screen says
  ordering is paused until it is back: a pay-at-counter order needs the till to see it, and a card
  payment needs the order to reach the kitchen.
- A card payment that went through when the order can't be sent is kept in the kiosk's outbox and
  sent again until accepted; the guest gets the order number at once, since the kiosk numbers its
  own orders (section 8.4; it was a provisional `KS1-0012` before migration 217).
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

- Zettle and Adyen card machines (Dojo, Stripe Terminal and SumUp are built). Not tried on a real
  machine yet.
- Receipts go to the kiosk's browser print; the receipt printer picked in Store tech is used once
  the hub prints.
- No loyalty, logins, vouchers or promo codes on the kiosk (automatic offers only).
- No "upsize" or "make it a meal" prompts beyond automatic combos and the "Anything else?" dishes.
- No age check for age-restricted dishes.
- The design editor has no undo beyond Discard.
- Tested in Chromium at kiosk sizes (1080 x 1920 and 1920 x 1080); not yet on a real kiosk screen,
  with a real card terminal, or with a screen reader.

## 11. Hub-first locations (migration 218, built 30 Oct 2026)

The user's ask: "would like to rearchitect for hub first if hub present", after asking how a
cloud-only till keeps working when the hub running the restaurant goes. Step one (per-device
numbers, section 8.4) came first; this section is step two, built as designed below (11.3 says
where each piece lives, 11.4 what isn't covered).

### 11.1 The shape

- **One record, the cloud's.** `pos_events` in the cloud stays the one ordered log (`seq`) for a
  venue. Nothing else may give an event its final place, so there is never a second log to merge
  by hand, and cloud-only devices (a till on 4G, a kiosk in a browser, online and GloriaFood orders,
  kitchen events from the server) keep working whether the hub is up or not.
- **The hub decides first.** At a location whose hub is linked and switched to hub first
  (`pos_settings.hub_first`, on by default), tills, kiosks, kitchen screens and order ready boards on
  the venue network talk to the hub. The hub keeps a mirror of the venue: the cloud's state (checks,
  kitchen orders, the trading day, each device's numbers) plus its own **pending** events, the ones
  it accepted that the cloud hasn't confirmed yet. It runs the same sequencer (`shared/pos/sequencer.js`)
  over that mirror, so a LAN device gets its answer, the other tills see the change and the kitchen
  ticket prints within the venue, at LAN speed, with or without the internet.
- **The cloud confirms.** The hub sends its pending events to the cloud in its own order
  (`POST /pos-api/hub/events`, keeping each event's device), where the cloud's sequencer decides
  them again. With nothing else happening at the venue the answers are the same (same rules, same
  state, same order). The hub follows the cloud's log (`GET /pos-api/hub/sync`) and, whenever the
  cloud's state moves, **rebases**: the mirror becomes the cloud's state with the pending events
  replayed on top (each at its original time). An event that no longer applies on top is refused
  there and then, and the cloud refuses it too: a conflict for a manager, as a till's offline change
  is today. Money is never merged silently.
- **Hub down**: devices fall back to the cloud (the transport tries the hub with a short timeout,
  then the cloud), which is the canonical log anyway, so nothing is lost or doubled: event ids make
  every send idempotent wherever it lands first. **Internet down**: the venue keeps trading on the
  hub; online orders and cloud-only devices carry on in the cloud; when the line comes back the
  hub's pending events go up and the two meet in the cloud's log. **Both down**: each device works
  alone, as today.

### 11.2 What runs where

| | Hub (LAN, `http://<hub>:9181`) | Cloud only |
|---|---|---|
| Tills, kiosks | events, sync, day report (X / Z), print jobs for printers plugged into them | config, live prices and sold out, pairing, card machine payments, loyalty, receipts by email, kiosk journeys |
| Kitchen screens | events (bumps), kitchen sync | config, flow switch |
| Order ready boards | `/screen-api/orders` | boards, playlists, config |
| Printing | every ticket for the venue's printers, made from its own decisions | nothing for hub-decided events (they arrive marked printed) |

Events that need the cloud to decide (a card machine payment or refund, a loyalty reward, both
reserved there) pass through: the hub sends its pending events first, then this one, and answers
with the cloud's result; offline they are refused ("needs the internet"), as card machines need it
anyway.

### 11.3 Pieces (as built)

- `shared/pos/mirror.js`: the hub's copy of its venue. The sequencer store in memory over the
  cloud's state (the base) plus the pending events, `submit()`, `applyCloud()` (new cloud events and
  states, then rebase: pending events replayed at their own times, one that no longer applies goes
  to `conflicts`), `sync(since)` / `kitchenSync(since)` with the hub's own `rev` (replies say
  `source: 'hub:<id>'`), `dayReport()` (opens the trading day itself when the internet is down, an
  offline Z included), `listChecks()` / `getCheck()`, `needsCloud()` (card machine and loyalty
  events), `snapshot()` for the disk. `shared/pos/deviceRules.js`: `deviceEvent()`, the rules of
  `POST /pos-api/events` per device (kiosks only their own counter orders, no server-only kitchen
  events), shared by the cloud and the hub. `boardFeed()` in `shared/pos/kitchen.js`: an order ready
  board's numbers, the same in the cloud (`boardFor()`) and on the hub.
- Cloud (`routes/posApi.js`, `services/hubFirstSvc.js`): `GET /pos-api/hub/context` (what the
  sequencer needs: staff and permissions without PIN hashes, devices and screens with the sha256 of
  their LAN keys, settings, print and kitchen config, `hub_first`, `primary`),
  `GET /pos-api/hub/sync?since=` (event ids and seqs, changed checks and kitchen orders, the day,
  each device's numbers, Splitter turns, presence; a reset from 0), `POST /pos-api/hub/events`
  (events in the hub's order, each decided again by the cloud's sequencer at the hub's time
  (`hub_at`, clamped to the last three days), `pos_events.hub_id` / `pos_event_rejections.hub_id`,
  `hub_printed` jobs saved as printed by the hub, a revoked device's later events refused). The
  devices' configs carry `hub { id, urls, lan_key }` (`hubFor()`) while hub first is on and the
  venue has a **primary hub** (linked, reported its venue network port, seen in the last 15 minutes;
  the oldest if there are several). The LAN key is derived, never stored:
  `deriveKey('lan:' + kind + ':' + id + ':' + secret_hash)` (`services/vault.js`, an HMAC of the
  master key), so linking a device again gives it a new key. `/pos-api/sync` and
  `/pos-api/kitchen/sync` take `source`: a cursor from anywhere but the cloud starts again.
  Migration 218: `pos_settings.hub_first` (default on), the two `hub_id` columns.
- Hub (`hub/src/venue.js`, `hub/src/lan.js`, hub version 1.2.0):
  the venue network on port 9181 (`--lan-port`, the installers open it in the firewall), CORS and
  `Access-Control-Allow-Private-Network`, `Authorization: Lan <id>.<key>` checked against the
  context's hashes (an unknown key loads the context again, at most every 10 s). The copy is kept
  in `venue.json` (written atomically every 10 s and as soon as the set-up loads) and `venue.log`
  (every accepted event appended and fsynced before the device is answered), replayed after a
  restart; with no set-up yet the log is kept, not truncated. Upload every 2 s while there is
  something to send, else follow every 5 s; the set-up every 30 s, and again after the hub's first
  report (the cloud only makes it primary once it knows the port). Card machine and loyalty events
  go through to the cloud after everything pending. Tickets for the hub's own printers print at
  once; tickets for a printer plugged into a till or kitchen screen are queued on the hub
  (`hub-<ulid>` ids, collected by that device over the venue network). The hub reports its copy's
  state (`info.mirror`) every minute and as soon as it starts or stops taking events; its status
  page has a Hub first section.
- Devices (`pos/src/lib/transport.js`): the LAN calls (events, sync, kitchen sync, the day report,
  checks, presence) go to the hub first, 2.5 s timeout, then the cloud; after a failure the hub is
  asked again by a quiet `GET /lan/ping` every 30 s (5 s when the hub didn't know the device yet).
  On the hub a till or kitchen screen asks every 2 s (no pushes from the hub); the cursor follows
  the reply's `source`. A kiosk counts the hub as a working connection (orders at the counter keep
  going with the internet down). Order ready boards (`screen/player.js`) read their numbers from
  the hub first. Only where the page may call plain http: the Macaroonie Android app 1.3
  (`mixedContentMode="always"`, cleartext allowed by `plugins/withVenueNetwork.js`) or a page served
  over http; a browser on https stays on the cloud and still works. The till's status dot says
  Live · venue hub, or Venue hub · internet down (green), the kitchen screen's top bar likewise.
- Store tech → Printers → Venue hub: the Hub first switch (own Save), and per hub what its copy is
  doing (devices using it, changes waiting for the cloud, last sent, changes the cloud refused).

### 11.4 Not covered

- A device that times out on the hub and sends the same events to the cloud is safe (event ids), but
  a ticket can print twice if the hub had already printed it before the timeout.
- The hub's decisions use the set-up it last loaded (up to 30 s old): a till PIN, a printer or a menu
  price changed in the admin reaches the hub's decisions within that time.
- Kiosk receipts (QR / email) and card machine payments need the cloud; a kiosk order placed on the
  hub may reach the cloud a few seconds later, so an email receipt asked for at once can be refused
  until it has (try again).
- One hub decides per venue; a second hub stands by (it still prints) and takes over only when the
  first hasn't been seen for 15 minutes.
- Not tried on a real venue network: the Android app's WebView calling the hub, a router that isolates
  Wi-Fi clients, or a mini PC's power cut mid-write (tested by killing the process).
