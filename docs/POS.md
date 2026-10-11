# Macaroonie POS — design

Status: **Phase 0 (trials)**. Decisions agreed 11 Oct 2026.

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
| Kitchen | Printers only. Kitchen display (KDS) later. |
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
