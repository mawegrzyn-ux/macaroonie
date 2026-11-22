# Sales from other tills: Loyverse first, then Square and Oracle Simphony

**Status: a plan, parked (22 Nov 2026: the user asked for it written down and put aside). Nothing is built; the decisions in section 10 are open.** The user's ask: "plan integration with
Loyverse for sales, not just cash up. I would like to import all checks with all details, master
data, etc. I need a smart tool for mapping items from Loyverse to Macaroonie menus. The tool needs
to be flexible to allow different mapping approaches, for example we may need to be able to match
all item variant combinations to individual sale items, or there may be modifiers. When planning
consider also Simphony as potential integration or Square POS."

The decisions to make are in section 10. The menu side (menus as catalogues of food, goods and
services) is `docs/CATALOGUE.md`; the two plans meet at the mapping tool.

## 1. What there is today

- **Loyverse** (migration 154) stores no sales. `loyverse_connections` holds the token (sealed),
  `loyverse_venue_links` ties a store to a venue with `day_starts_at` and Cash Recon `mappings`.
  `venueDays()` (`services/loyverseSvc.js`) reads `/receipts` live and `summariseReceipts()`
  (`shared/loyverse.js`) sums them into Cash Recon figures. `loadCatalog()` reads stores, payment
  types, categories and items for the mapping editor.
- **GloriaFood** (migration 159) stores orders (`gloriafood_orders`, money in pence, `items` jsonb
  by name, not linked to our dishes). `services/onlineSalesSvc.js` and the report subject
  `online.sales` put web and GloriaFood orders together with a `UNION ALL`: the precedent for
  showing other systems' sales beside our own.
- **Our till**: `pos_events` is the truth; `pos_checks`, `pos_check_lines`, `pos_payments`,
  `pos_check_discounts`, `pos_check_charges`, `pos_check_vat` and `pos_days` are projections
  (`projectionRows()` / `saveCheck()` in `services/posSvc.js`). Modifiers and combo picks live only
  in `pos_checks.state.lines[]`. The Test data generator writes projections without events
  (`is_generated`).
- **Matching patterns to reuse**: the Deliveroo item links (`deliveroo_item_links`, `nameScore`,
  `rankDishes`, `AUTO_MATCH` 0.9, `matchRow()` in `shared/deliveroo.js`, `DishPicker`), invoice
  lines matched by product code first and name second (`invoiceReadAi.js`), Cash Recon's mapping
  editor (`MappingGroups`).
- **Menus** (`docs/CATALOGUE.md` section 1): an item sits in one section of one menu; options are
  a group library (`menu_variant_groups` / `menu_variant_options`, per-dish prices in
  `menu_item_variant_prices`, prefixes such as Add / No in `pos_prefixes`); combos are items with
  `kind = 'combo'`. Items have **no SKU, PLU or barcode** today.

## 2. What the other systems give us (researched 22 Nov 2026; check against each vendor's docs before building)

| | Loyverse | Square | Oracle Simphony |
|---|---|---|---|
| Sales | `/receipts`: `receipt_number`, `receipt_type` SALE / REFUND with `refund_for`, `receipt_date`, `cancelled_at`, store, POS device, employee, customer, dining option, totals, `total_discounts[]`, `total_taxes[]`, tip, surcharge, `payments[]`; `line_items[]` with `item_id`, `variant_id`, names as sold, SKU, qty, price, gross / total, cost, note, `line_taxes[]`, `line_discounts[]`, `line_modifiers[]` (`modifier_option_id`, name, option, price) | Orders API (`SearchOrders` by location, cursor on `updated_at`): `line_items[]` with `catalog_object_id` (the **variation**), `variation_name`, `modifiers[]`, applied taxes and discounts, service charges, returns as their own objects; Payments API for tenders | BI API `getGuestChecks` by location and business date: `detailLines[]` in sequence, each a menu item, discount, service charge or tender; condiments are lines of their own linked to their item (`parDtlId`) with `modFlag` and a prefix (`modPrfx`, e.g. Add); combo meals; revenue centres |
| Master data | items with variants (`option1..3` name / value, SKU, per-store price), modifiers with options, categories, taxes, discounts, payment types, stores, employees, POS devices, dining options, customers | Catalog API: ITEM, ITEM_VARIATION (price, SKU; up to 250), MODIFIER_LIST / MODIFIER, CATEGORY, TAX, DISCOUNT, ITEM_OPTION; `product_type` (REGULAR, APPOINTMENTS_SERVICE; FOOD_AND_BEV legacy, read only) | Menu item master and definitions (object numbers), menu item classes, major / family groups, condiment groups, RVCs, employees, tender media |
| Change feed | webhooks `receipts.update`, `items.update`, `inventory_levels.update`, `customers.update`, `shifts.create` (per app; names from secondary sources) and paging by date | webhooks (`order.updated`, `catalog.version.updated`), OAuth per merchant | pull per business date (BI data after the day), STS Gen2 for real-time checks; enterprise access through Oracle |
| Auth | access token (we have it, sealed) | OAuth 2 (an app on Square's developer site) | Oracle client credentials per organisation |

What this means for the design: a sale is the same idea everywhere (a header, lines, child lines
for modifiers or condiments, discounts, taxes, charges, payments, refunds that point back), but
**variants and modifiers differ**: Loyverse and Square sell a *variation* and add modifiers;
Simphony sells menu items with condiment lines and Add / No prefixes. The mapping must handle all
three without each system leaking into reports.

## 3. Recommended architecture

```
connector (one per system)  ->  raw store  ->  normalised sales + master data  ->  mapping  ->  readers
 loyverse / square / simphony    as received     one shape for every system       our items     reports, Cash Recon,
 (fetch, page, webhooks)         (re-runnable)   (pence, venue, business date)    + rules       Today, Pepper
```

1. **Connectors** (`services/connectors/<system>.js`), one interface: `listLocations()`,
   `fetchCatalog(since)`, `fetchSales(from, to | cursor)`, `verifyWebhook()`, `normalise(raw)`.
   Generalise `loyverse_connections` / `loyverse_venue_links` into `pos_connections` (system,
   sealed credentials, status) and `pos_connection_venues` (external location ↔ venue,
   `day_starts_at`, Cash Recon mappings). Pre-production: rename, no compatibility path.
2. **Raw store** `ext_documents` (connection, kind `sale` | `item` | `modifier` ..., external id,
   external `updated_at`, payload jsonb, hash, fetched_at). Everything is kept as received, so a
   changed mapping or a bug fix re-runs without fetching again. Kept for 400 days (a setting).
3. **Normalised sales**, one shape for every system, money as integer pence exactly as the other
   till recorded it (never recomputed by our pricing rules):
   - `ext_checks`: connection, venue, external id and number, `business_date` (by the venue's day
     start, as `tradingDay()` does now), opened / closed, sale or refund (+ the check it refunds),
     cancelled, order type / dining option, device, employee, customer, gross, discounts, charges,
     tax, tips, total, currency.
   - `ext_check_lines`: external line id, `parent_line_id` (a modifier or condiment under its item),
     `line_kind` item | modifier | condiment | discount | charge, the external refs (item, variant,
     modifier option, SKU), the name and variant name as sold, prefix (Add / No / Sub), qty, unit
     price, gross, discount, tax, net, cost (when given), note; and the **mapped** columns:
     `item_id`, `option_id`, `combo_id`, `rule_id`, `allocated_net` (see 4.4).
   - `ext_check_payments` (tender as named + our tender, amount, tip, card brand, time),
     `ext_check_discounts`, `ext_check_taxes`.
   - Idempotent: upsert by (connection, external id); a receipt that changes (refunded, cancelled)
     is normalised again from its new raw copy.
4. **Master data** normalised into `ext_catalog` (one row per external object: item, variant,
   modifier group, modifier option, category, tax, discount, payment type, employee, device,
   dining option; its external ref, name, parent, SKU, price, raw attributes such as variant
   option values). This is what the mapping tool shows on the left.
5. **Readers**: reports get a family of "Sales, every till" subjects that `UNION ALL` our till's
   projections with `ext_*` (the `online.sales` precedent), with a `source` field (Macaroonie,
   Loyverse, Square, Simphony); the existing `till.*` subjects stay our till only. Cash Recon fills
   from `ext_checks` instead of reading `/receipts` live (one figure rule, in a shared
   `shared/externalSales.js`, replacing `summariseReceipts()`). Today, Pepper (`till_day`,
   `ask_data`) and the dashboards read the union.

Why not write imported receipts as our own till checks (`pos_checks` with a source column, as the
Test data generator does)? It would make every till report work at once, but our checks are
projections of our events under our pricing, tax and combo rules: an outside receipt's totals
(Loyverse's rounding, added versus included tax, how it spreads a discount) would be recomputed
and drift, its refunds and condiment lines don't fit our event types, and the till's own figures
(`dayFigures()`, which the till reports are tested against) would mix two sources. Kept apart,
the money is always what the other till printed, and the union subjects show both.

## 4. The mapping tool

### 4.1 What can be mapped to what

| External thing | Can become |
|---|---|
| an item (every variant) | one dish |
| a variant (one combination: Large / Oat) | one dish of its own, or a dish + options (Large → our Size: Large, Oat → our Milk: Oat) |
| a variant axis (option name, e.g. Size) | one of our option groups, value by value |
| a modifier option (Extra cheese) | an option of ours, a dish of its own (a side sold as a modifier), or nothing (an instruction such as "no onion", kept on the line as a note) |
| a condiment line (Simphony) with a prefix | an option with that prefix (`pos_prefixes`: Add, No, Sub) |
| an item + a set of modifiers | a combo (meal deal) with its steps, or one dish |
| an item | several dishes (a bundle), its money split |
| a category | a section (for reporting only, when items aren't mapped one by one) |
| a payment type, dining option, employee, device, tax, discount | our tender, order type, staff member, device, tax rate, discount |
| anything | Ignore (not a sale: a gift card load, a deposit) or Keep as sold (reported under its own name, unmapped) |

### 4.2 Rules, applied in order

Each mapping is a rule with a scope (the connection, or one venue), applied most specific first:

1. **Exact** by external id: variant → target, item → target, modifier option → target.
2. **Combination**: item (+ variant) + modifier pattern → combo or dish ("Burger" with "Make it a
   meal" → Burger Meal).
3. **Axis**: a variant axis or modifier group → one of our option groups, value to value.
4. **Pattern**: SKU equals or starts with, name contains or matches, external category → target;
   for bulk ("every Bottle of ..." → the matching dish by name).
5. **Fallback**: by external category → section (report bucket), else Keep as sold.

A rule never changes money: it only says what was sold. Rules keep the external ids and, as a
fallback when an item is re-created on the other till, its SKU and name, so a mapping survives a
catalogue rebuild there. Every rule has an `effective_from`; changing rules re-maps the stored
lines in the background (from `ext_check_lines` and, if needed, the raw copies), so history follows.

### 4.3 Smart suggestions

- **Matching**: SKU or barcode first (our items get codes: `docs/CATALOGUE.md` 4.3), then
  normalised names (Deliveroo's `nameScore` / `rankDishes` lifted into a shared
  `shared/itemMatch.js`), price and category as tie-breakers; auto-accept at the Deliveroo
  threshold, suggest below it.
- **Pepper** for what's left: one `askForJson()` call per batch with refs (never ids, rule 19),
  the external names, variants, modifiers and prices beside our menu, answering a proposed rule
  per item (including "these variants are a size axis", "this modifier is a side dish"), each
  with a reason and a confidence. Counted with `addUsage()`.
- **Learning**: an accepted suggestion becomes an exact rule; a group of accepted ones with the
  same shape is offered as a pattern rule ("12 Large variants mapped to Size: Large: make it a
  rule?").
- **Coverage**: the share of sales value mapped (last 30 days), and the unmapped items sorted by
  value, so the person maps what matters first.

### 4.4 Money when one line becomes several

When a line maps to a dish plus options, a bundle or a combo, its net is spread over the parts by
our list prices (the remainder on the main part), into `allocated_net`, so menu reports add up to
the receipt. If our combo rules already spread a deal's price over its steps, the same function is
used (one implementation, rule 12).

### 4.5 The page

Store tech (or Integrations) → **Item mapping**, per connection with a venue picker:
- left: the external catalogue (category → item → variants → modifiers), each with its state
  (mapped by rule X, suggested, unmapped) and its sales in the last 30 days;
- right: our menus for that venue (the menus its revenue streams sell);
- suggestions to accept one by one or in bulk; a rule editor for the approaches in 4.2;
- **Preview**: what the last 30 days' lines become under the rules, before saving;
- **Copy from another venue** (by name) for groups with one menu per venue;
- **Create missing dishes**: make our dishes from unmapped external items (with their variants as
  an option group), mapped as they are made, for a venue moving to Macaroonie menus.

## 5. Square and Simphony

- **Square**: the line's `catalog_object_id` is the variation, so 4.1's "variant" row applies
  directly; item options (Size, Colour) are the axis; `product_type` APPOINTMENTS_SERVICE marks a
  service (the catalogue type in `docs/CATALOGUE.md`). Returns are separate objects pointing back.
  OAuth and webhooks need a Square developer app (an owner task).
- **Simphony**: condiments arrive as lines with a parent and a prefix, which fit the condiment row
  of 4.1 and our option prefixes; menu items are identified by object number (a stable code, so
  SKU-style rules work well); revenue centres map to revenue streams. Data is per business date
  through the BI API (a nightly pull), real time only through STS Gen2. Access goes through the
  customer's Oracle organisation, so this one waits for a franchise that uses it.

## 6. What else changes

- Cash Recon's Loyverse fill reads stored checks: no live call, the same figures, and a day can
  be filled again after a late sync without asking Loyverse twice.
- Reports: the "Sales, every till" subjects, a `source` field, sales by our dish across tills, and
  a "Mapping coverage" figure; the decisions and coverage tables in the report catalogue updated.
- Purchasing later: theoretical usage from mapped dishes (recipes) works for imported sales too.
- Erasure: imported customers (if taken, decision D3) and names on imported checks must be
  covered by the customer anonymise path.
- Platform status (`services/platformStatus.js`): each connector's last sync as a job, late ones
  marked.

## 7. Phases

| Phase | What | Ends with |
|---|---|---|
| 1 | Connections generalised; Loyverse master data and receipts into raw + normalised tables, by webhook and a 15-minute catch-up | Every Loyverse receipt stored in pence, refunds and cancellations followed |
| 2 | Mapping: exact, axis and combination rules, the page, coverage, preview | Sales attributed to our dishes and options |
| 3 | Smart suggestions (matching + Pepper), learning, pattern rules, re-mapping history, Create missing dishes | Most of a catalogue mapped in a sitting |
| 4 | Readers: union report subjects, Cash Recon from stored checks, Today and Pepper | Loyverse venues reported like our own tills |
| 5 | Square connector (OAuth app, webhooks) | A second system through the same pipeline |
| 6 | Simphony connector (BI API per business date) | When a franchise on Simphony signs |

## 8. Tests

A stand-in Loyverse (as `api/test/local-info.test.mjs` stands in for Open-Meteo) with receipts
covering variants, modifiers, refunds, cancellations, discounts, added and included tax, tips and
late syncs; property checks that mapping never changes a day's totals; the union subjects held to
the sums of their parts.

## 9. Risks

- Vendor field names above come partly from secondary sources (marked in section 2): confirm
  against each vendor's own documentation and a real account before phase 1.
- Loyverse's API limits and history depth (how far back receipts can be read) decide how long the
  first import takes.
- A mapping mistake shows in reports immediately; the preview and coverage are the guard, and
  history re-maps when the rule is fixed.

## 10. Decisions for the user

- **D1** Imported sales kept in tables of their own and shown with ours through "every till"
  report subjects (recommended), or written as our own till checks?
- **D2** Which system is the menu master for a Loyverse venue: Macaroonie (map to our menus;
  recommended, with Create missing dishes for a quick start), or Loyverse (we mirror its
  catalogue into a menu automatically)?
- **D3** Import Loyverse customers (personal data, erasure covered) or only their ids?
- **D4** How far back to import on connecting (e.g. 13 months, for year-on-year)?
- **D5** Webhooks plus a 15-minute catch-up (recommended), or a nightly pull?
- **D6** Where the page lives: Store tech → Item mapping, or a new Integrations section with the
  connections, mapping and sync status together?
