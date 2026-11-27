# Inventory: recipes, costing, stock and variance

**Status: phase 1 built on 27 Nov 2026 (recipes and the cost engine, migrations 298 to 301; see "Phase 1 as
built" under section 11). Phases 2 to 10 are a plan. The decisions in section 12 are taken as recommended,
D1 to D12.** The owner's ask when building started: "recipes variations, per revenue stream/order type
matrix, and per location (or ability to link a different recipe to menu items in different locations)",
"stock take module" and "reports". The variation matrix is part of phase 2's links (5.4).

The owner's ask: "lets plan inventory solution. I am copying below COGS tool i built in the past.
analyse, and prepare plan and solution document", then "deep dive on the solution". The COGS tool
is the owner's earlier product, COGS Manager (a multi-market web app that costs menus from
ingredients, vendor prices and recipes, with stock management, allergens, HACCP, audits and an
assistant around it). This document says what of it Macaroonie should take, what Macaroonie
already has, and how to build the rest on what is here.

Where the facts come from: the purchasing, menus, till, cash and reports code and notes as they
stood on 26 Nov 2026 (migration 296 the highest), and a research briefing on how the leading
restaurant inventory products work (`reports/Inventory research briefing.md`, with its sources
and what it could not confirm).

## 1. The short version

- **Macaroonie already has the purchasing half** of COGS Manager: inventory items, suppliers,
  several prices per supplier with a preferred one per venue, order lists and pars, purchase
  orders, receiving with temperature checks, invoices read by Pepper, barcodes, a simple stock
  count and stock on hand. It has the selling half too, and better: real menus, options, meal
  deals, tax by order type, a real till, kiosks, online orders and imported sales.
- **What is missing is the middle: recipes.** Nothing links a dish to the items it uses. Until it
  does there is no dish cost, no margin, no usage from sales, and stock on hand cannot take sales
  off (`SALES_COUNTED = false` in `services/stockSvc.js`).
- **The prize COGS Manager could not reach is actual against theoretical.** It had no till, so its
  sales mix was typed in. Macaroonie knows every dish sold with its options, so it can say what
  should have been used, compare it with what the counts say was used, and put a pound figure on
  the gap per ingredient and per venue. Operators new to this start about 8.7% above theoretical
  food cost (Rosnet, 5,281 sites); closing that gap is where the money is.
- **Build order:** recipes and one cost engine; margins per menu; stock operations (counts by
  area, waste, transfers); usage from sales; variance; then menu engineering, allergen checks and
  suggested orders. Nine phases, about 10 to 13 hours of agent time on the current scale
  (section 11).
- **The design rule above all:** the effort of keeping it up decides whether it is used. Recipes
  come in by Pepper reading what the group already has, the dishes that sell most are costed
  first, daily counts are a short list, and nothing blocks trading.

## 2. COGS Manager, epic by epic

| COGS Manager | Macaroonie today | Verdict |
|---|---|---|
| 1 Auth, users, RBAC, market scope | Auth0, roles, module permissions with View / Use / Manage, venues per person | Have. Add modules for recipes, costing and stock (10.1). |
| 2 Markets, FX, tax per price level, price levels, units, categories, locations and Centres, COGS thresholds | A tenant is one master franchisee; venues carry a currency; tax by venue, revenue stream and order type (`taxFor()`); units g, kg, ml, cl, l, each; flat inventory categories | Take: thresholds, per-item unit conversions, storage areas (the useful part of Centres). Leave: FX and a USD base (D8). |
| 3 Ingredients, vendors, price quotes, preferred vendor, nutrition lookup | `inv_items`, `suppliers`, `inv_quotes` (pack, price per pack ex VAT), venue prices, `inv_preferred`, price history, one choosing rule `chooseQuote()` | Have, and richer (packs, venue prices, out of stock). Add: yield, conversions, allergens. Nutrition later. |
| 4 Recipes, sub-recipes, cost per portion, coverage, market and price-level variations | Nothing | **Build. The core.** Venue variations as an option (D2). |
| 5 Sales items (recipe, ingredient, manual, combo), modifier groups, combos | Menus, an option group library, per-dish option prices, prefixes (No, Light, Extra, On the side), meal deals with steps, goods and services | Have, richer. Build the link from each to recipes (5.4). |
| 6 Menus, COGS % and GP per item and price level, display currency, Menu Engineer (sales mix, scenarios, what-if, push prices), step by step explanation | Menus with one price per dish per menu; tax by order type; real sales | Build margins, engineering from real sales, scenarios, the explanation. Leave display currency. |
| 7 Password-protected share links for reviewers | Kiosk design share links only | Leave. A saved scenario can be exported to Excel. |
| 8 Allergens per ingredient, matrices, roll-up through recipes | Allergens declared per dish (`menu_item_dietary`: contains, may contain, removable), matrix and lookup pages | Take the roll-up as a check on what is declared, never as the declaration (8.1, D6). |
| 9 HACCP: equipment, temperatures, CCP logs | Food safety logs, checklists, delivery checks tied to receiving | Have. |
| 10 Stock Manager: ledger, levels per Centre, POs, GRN, invoices, credit notes, waste, transfers, stocktake, adjustments | POs, receiving (also without an order), invoices read by AI, a single-step count, stock on hand = last count + received | Build: waste, transfers, stocktake with areas and approval, adjustments, returns. Keep the documents as the truth (6.1). |
| 11 QSC audits | Checklists and the H&S action log | Not inventory. Its own backlog item if wanted. |
| 12 Dashboards and KPIs | Dashboards engine, report widget, Overview tiles | Have. Add widgets and tiles (10.3). |
| 13 AI import wizard, data transfer, Excel export | Inventory and price list imports, readers through `askForJson()` | Have the pattern. Add a recipe reader (5.6). |
| 14 Pepper | Pepper, with classes, cards, Undo, forms, rules, an evaluation set | Have. Add tools (10.4). |
| 15 Knowledge base | Help search (`how_do_i`) | Not inventory. |
| 16 Translations | Menu translations for kiosks | Have. Recipes are not translated. |
| 17 POS and kiosk mock-ups | The real till and kiosk | Have. |
| 18 Media library | Have | Recipe photos use it. |
| 19 Audit trail | Pepper's activity record, price history, till events | Partly. Stock documents carry who and when. |
| 20 Dev and PM tooling | Backlog, issue log, changelog | Have. |

### What COGS Manager got right, to keep

- **One price rule feeding every cost** (the preferred quote per market). Macaroonie's
  `chooseQuote()` is that rule already, per venue.
- **Coverage**: showing which recipe lines have no price, and how much of the catalogue is costed.
- **Sub-recipes** that nest, costed by their yield.
- **Variations** of a recipe for a market or a price level. Here that is a venue (D2).
- **Thresholds with colours** against a target cost %.
- **The explanation of a cost, step by step.** It also makes Pepper's answers checkable.
- **Scenarios** that never touch the live menu until pushed.
- **Documents with states and numbers** for stock (transfers in two steps, stocktakes approved).

### What to do differently

- **Yield, not waste added on.** COGS Manager costs a line as `base_qty x (1 + waste%)`. That
  understates the cost: with 20% trim, a usable kilo needs 1.25 kg bought (1 / 0.8), not 1.2.
  The standard is edible portion cost = as purchased cost / yield % (section 5.2).
- **Yield in two places**: trim loss on the item (peeled onion), and cooking loss on the batch
  recipe (a stock that reduces). COGS Manager had one waste % per ingredient.
- **No typed-in sales mix.** The mix is what the tills sold.
- **No FX or base currency.** Money stays in the venue's currency, as purchasing and the till
  keep it. A group trading in two currencies sees figures per currency, as reports do today.
- **No "sales item" layer.** The menu's dishes, options and deals are the sellable catalogue.
  COGS Manager needed sales items because it had no menu system; adding one here would be a
  second catalogue to keep in step.
- **Stock per venue, not per Centre** (D4). Storage areas order the count sheet; they do not hold
  separate stock, so staff never have to record moving a box from the walk-in to the line.
- **Allergens are not derived and published.** A roll-up from ingredients is a check and a draft
  for a person to approve (8.1).

## 3. What Macaroonie has today

Purchasing (`docs/claude/areas/purchasing.md`):

- `inv_items`: name, category, `base_unit` (g, ml or each), storage (ambient, chilled, frozen),
  code, barcode, the group's own fields. **No price, yield or conversion.** Mass, volume and count
  never convert into each other (nothing says 1 each = 150 g).
- `inv_quotes`: a supplier's pack (`pack_count` x `pack_qty` `pack_unit`, `pack_base_qty` in the
  item's base unit), `price` per pack ex VAT in pounds to 4 places, `vat_rate`, product code and
  name, barcode, out of stock until. A venue's own price in `inv_quote_venue_prices`.
- The price for an item at a venue is `chooseQuote()` (`shared/procurement.js`): the venue's
  preferred quote, else the group's, else the cheapest per base unit at that venue's price.
- `purchase_order_lines`: the pack, `price` at ordering (never changes), `received_qty`, and what
  the invoice said (`invoice_price`). **Price paid = `invoice_price`, else `price`.**
- `stock_counts` / `stock_count_lines` (migration 287): a count replaces the quantity outright.
  `stockOnHand({count, receipts, usage})` is the one rule; `usage` is always empty today.
  "Correct the delivery" re-runs receiving, so on hand changes back in time.
- Not there: waste, transfers, returns and credit notes, a stock task on Today, a dashboard tile.
- Modules: `purchasing`, `purchasing_setup` (View shows prices: `seesPurchasingPrices()`),
  `purchasing_approve`. None has a Use level.

Menus (`docs/claude/areas/menus.md`):

- **No shared dish library.** Each menu's dish is its own `menu_items` row. The same burger on
  three menus is three rows with three ids.
- **The menu save deletes and re-inserts the tree under the same ids.** So nothing may point at a
  dish with a foreign key (it would be deleted or cleared on every save). Duplicating a menu gives
  every dish a new id. A release keeps the draft's ids. Tills sell from the live release.
- Option groups and their options are a tenant-wide library with stable ids. A dish's own one-off
  options have no stable id: sales name them `v:<label>`.
- `menu_variant_groups.variation_type` (modification, side, addition; migration 206) was added
  "for stock" and is unused. It is the hook for option recipes.
- One price per dish per menu, in integer pence, VAT included. The VAT rate depends on the venue,
  revenue stream and order type (`taxFor()` in `shared/tax.js`), so the same dish has a different
  net price eating in and taking away.
- A meal deal is a dish of kind combo with steps in `combo` jsonb; `shared/combos.js` prices it.
- Dishes have a type (food, goods, service), a product code and a barcode (feature 48).
- Allergens: 14 standard ones, declared per dish. Nothing at ingredient level.

Sales (`docs/claude/areas/till.md`, `docs/SALES_IMPORT.md`):

- A sold line is `pos_check_lines` (item id, qty, net) for checks that are closed and lines not
  voided. **Options and meal deal picks are only in `pos_checks.state.lines[]`** (`modifiers`:
  group id, option id, prefix, depth, one entry per pick; `combo`: each step's dish with its own
  modifiers). No table holds them.
- A void after sending carries `waste` (the dish had been made).
- A trading day is a `pos_days` row; `businessDate()` gives its date. Sales can arrive late: a hub
  or a till working offline sends events later, and imported sales sync later.
- Kiosk orders are till checks. Online orders are not: `order_items` has the dish id, options by
  label only, and meal deal parts.
- GloriaFood orders are by name only, with no dish ids.
- Loyverse and Square sales are in `ext_checks` with `ext_line_parts` mapped to our dishes and
  options (`mapCheck()`); a mapped meal deal does not say which dishes filled it.
- The kitchen logs remakes by dish name, not id (`kds_log`).
- Measured size: ten venues for a year is about 438,000 checks and 1.08 million lines.

Around it:

- No COGS, gross profit or cost of sales figure anywhere, including Cash Recon.
- No sales forecast. There are future bookings, a 7-day weather forecast and past sales by weekday.
- Every tenant is self-contained: nothing passes recipes from a franchisor to its franchisees.

## 4. Principles

1. **One cost engine** in `shared/costing.js`, used by the API, the pages, reports, Pepper and the
   usage job (rule 12). No page works a cost out for itself.
2. **Documents are the truth; stock is worked out from them.** A delivery, a count, a waste entry
   and a transfer are each a record with who and when. On hand and the ledger are read from them,
   as the till's figures are read from its events. Nothing writes a stock level directly.
3. **Money as each side keeps it.** Costs in pounds to 6 places per base unit, like purchasing.
   Sales in integer pence, like the till. They meet in the margin, in one function.
4. **Nothing blocks trading.** Stock may go negative; that is shown as a sign of a missed
   delivery or a wrong recipe. A dish with no recipe sells and is listed as uncosted.
5. **Links to menu rows are plain ids**, cleaned up by a sweep, never foreign keys.
6. **Setup by reading, checked by a person.** Pepper reads recipe sheets and proposes; nothing it
   reads is live until someone accepts it.
7. **Effort follows value.** Coverage is measured by sales value, so the first ten recipes are the
   ten that matter most. Daily counts are a short key-item list.

## 5. Recipes and costing

### 5.1 Items gain units and yield

New on `inv_items`:

- `yield_pct` numeric, default 100: the usable share after trimming (an onion, 88).
- `count_unit` and `recipe_unit`: the unit the item is usually counted and used in.
- `shelf_life_days` once opened or prepped (for labels, later). *Not built in phase 1: recipes carry
  `shelf_life_hours`; the item's waits for labels.*

New table `inv_item_units` (item, name, `base_qty`): the item's own units beyond the standard
ones. "1 each = 150 g" for an item kept in grams; "1 slice = 20 g"; "1 tbsp = 15 ml";
"1 portion = 180 g". The standard units (g, kg, ml, cl, l, each) keep working through `UNITS`.
One function, `toBase(qty, unit, item)`, converts; a unit that does not fit is refused by name
("Cheddar has no size for a slice"), which is the most common reason recipes fail to cost in
other products.

### 5.2 The cost of an item

Three costs per item per venue, each from data already kept:

| Cost | Rule | Used for |
|---|---|---|
| **Standard** | `chooseQuote()`'s quote at the venue's price, per base unit | Recipes and menu margins: what the dish costs at today's agreed price |
| **Last paid** | the latest received line's `invoice_price`, else `price`, per base unit | Price creep ("the invoice was dearer than the list") |
| **Average** | the weighted average of what was received, per venue | Stock value, usage and variance in pounds |

`itemCost(item, venue, basis)` in `shared/costing.js` returns the cost per base unit and where it
came from. The average is worked out from receipts over a window (D1 settles the default basis).

**As purchased to edible portion:** `cost per usable base unit = cost per base unit / (yield % / 100)`.

### 5.3 Recipes

`recipes`: name, `kind` (dish or prep), category, what it makes (`yield_qty` + unit for a prep
recipe; portions for a dish recipe), `loss_pct` (cooking loss on the batch), method, photo, shelf
life, notes, a code, `status` (draft or live), `variant_of` (a variation: the recipe it varies).
*As built (phase 1): no `venue_id` on the recipe. A variation (a takeaway version, one venue's own way)
is a recipe of its own grouped under the one it varies; which variation a dish uses at which venue and
for which revenue stream or order type is decided by the links (5.4, phase 2), so one variation can serve
several venues and one venue several variations.*

`recipe_lines`: the recipe, sort order, **an item or a prep recipe**, quantity and unit, an
optional yield for this line (when this recipe trims harder than usual), a note.

Rules:

- Prep recipes nest (a sauce in a marinade in a dish), to five levels; a recipe inside itself is
  refused on save.
- A line's cost: `toBase(qty, unit) / line or item yield x item cost`.
- A prep recipe's cost per unit: `total cost / (yield_qty x (1 - loss %))`.
- A dish recipe's cost per portion: `total cost / portions`.
- **Coverage**: `recipeCost()` returns the cost and the list of what it could not cost (no price,
  no conversion, a prep recipe with nothing in it). A recipe with gaps shows a partial cost marked
  as such, never a confident wrong number.
- A line's unit is free text: a unit the item doesn't know is a gap named on the page, never a
  refusal (a reader will bring units nobody has defined yet); deleting an item's own unit that a recipe
  uses is what is refused.
- Recipes are group-wide; cost differs per venue because prices do. A venue with a different
  method or product gets its own version (D2).

### 5.4 Linking recipes to what is sold

**Dishes.** `recipe_links`: recipe, the menu dish's id (plain), portions (default 1). One recipe
serves the same dish on every menu: each menu's dish links to it. To keep that easy:

- A dish with no link is matched to recipes by product code, then name (`matchThing()` in
  `shared/itemMatch.js`), and offered ("Link 14 dishes to their recipes").
- Duplicating a menu copies its dishes' links to the new ids (the duplicate route already keeps a
  map of old to new ids).
- A link whose dish has gone is shown as "no longer on a menu" and cleared by a sweep.

**Options.** `recipe_option_rules`: an option from the library (stable id), optionally for one
dish only, and what it does:

- **adds** lines (extra cheese: 30 g cheddar),
- **removes** an item from the dish's recipe (no onion),
- **swaps** one item for another (oat milk for milk, same quantity or a stated one),
- **scales** the recipe (large: 1.5),
- **is a recipe of its own** (a side),
- **nothing** (well done).

The group's `variation_type` sets the default: addition adds, side is a recipe, modification
scales or swaps. Prefixes follow from the option's own lines: No removes them, Light halves them,
Extra doubles them, On the side changes nothing. A dish's own one-off options are keyed by dish
and label, as sales name them.

**Meal deals.** A deal has no recipe. Its cost is the sum of the dishes picked, each with its own
options. Where the picks are not known (a margin page, an imported sale), the cost is shown as a
range, and as "typical" from what guests actually pick once there are sales.

**Goods and services.** A goods dish with a barcode matching an inventory item links to it one to
one (a recipe of one line, made automatically). A service has no recipe and no stock.

### 5.5 The engine

`shared/costing.js`, plain ESM, no database:

- `toBase()`, `itemCost()`, `recipeCost(recipe, ctx)`, `dishCost(dish, selection, ctx)` (the dish's
  recipe, its options' rules, a deal's parts), `usageOf(dish, selection, ctx)` (the same walk
  returning quantities per item instead of money: one walk, two uses), `explain()` (the steps as
  rows a page or Pepper can show), `margin({ gross_pence, vat_rate, cost })`.
- `ctx` holds the recipes, links, option rules, items, units and the venue's chosen prices, loaded
  once per request by `loadCosting(tx, tenantId, venueId)`.

**Margin:** `net = gross - vatIncluded(gross, rate)`; `GP = net - cost`; `cost % = cost / net`.
The rate is `taxFor()`'s for the chosen order type, so the page has an order type switch.

### 5.6 Getting recipes in

- **Pepper reads recipes**: a spreadsheet, a PDF, a photo of a recipe card, or pasted text.
  `recipeReadAi.js` follows the invoice reader: one `askForJson()` call under `/api/ai/`, items
  sent as refs, never ids; it answers lines with quantities and units, matched to inventory items
  by code then name, with what it could not match listed. The result is a **draft** recipe.
  Nobody's dish is costed from a draft; a person opens it, fixes the gaps and makes it live.
- **From the dish**: "Make a recipe for this dish" opens the editor with the dish's name and its
  options listed for rules.
- **Typical yields**: Pepper may suggest a yield for a common ingredient when asked; it is marked
  as a suggestion until saved.
- **Order of work**: the Recipes page opens on "Costed: 62% of last 30 days' sales" with the
  uncosted dishes sorted by sales value, the same idea as the item mapping coverage.

## 6. Stock

### 6.1 Documents and the ledger

Each thing that moves stock is its own record:

| Record | Table | Exists |
|---|---|---|
| Delivery | `purchase_order_lines` (received) | Yes |
| Count | `stock_counts`, `stock_count_lines` | Yes, extended in 6.2 |
| Waste | `stock_waste` | New |
| Transfer | `stock_transfers`, `stock_transfer_lines` | New |
| Adjustment | `stock_adjustments` (a reason is required) | New |
| Return to supplier | `purchase_returns`, lines | New, phase 9 |
| Usage from sales | `stock_usage_days` | New, section 7 |
| Production | `stock_production` | New, phase 10 |

`loadStockMoves(tx, tenantId, { venueIds, itemIds, from, to })` reads them as one ledger: item,
venue, time, kind, signed quantity in base units, cost at the time, the record it came from.
`stockOnHand()` stays the one rule and takes the moves: last count + everything since. A levels
table is added only when a venue's history makes the read slow; the plan does not start with one,
because two stores of the same number drift.

Corrections follow the documents: a delivery is corrected by "Correct the delivery" (as now), a
waste entry is undone within its day or reversed by a new entry, a count is replaced by counting
again until it is approved.

### 6.2 Stocktake

- **Storage areas** per venue (`stock_areas`: Walk-in, Dry store, Bar; drag to order) with the
  items in shelf order (`stock_area_items`). An item can be in two areas; the count adds them.
- **Kinds**: a full count, or a **key-item count** from a saved short list (proteins, cheese,
  what goes missing). In a key-item count what is not counted is left alone. In a full count
  what is not counted is listed to be confirmed as zero.
- **Several units on one line**: 2 cases + 3 each + 400 g, kept as typed and as the base total.
- **Draft, submitted, approved.** A draft autosaves and two people can count different areas.
  Approval is Manage; counting is Use. Approval can be by a second person only (a setting).
- **Blind count** as a setting: the expected quantity is hidden while counting.
- **On the phone**: the count page by area, with the Office app's scanner finding the line.
- The count shows **expected against counted** with the value of the difference before approval.

### 6.3 Waste

`stock_waste`: venue, time, trading day, **an item, a prep recipe or a dish** (a wasted dish or
batch is broken into its items by the recipe), quantity and unit, reason, cost at the time, who,
a note, a photo. Reasons are a list the group edits (`waste_reasons`), each marked with WRAP's
three kinds: spoilage, preparation, plate.

- A till void marked wasted counts as waste by itself: the dish was made, so its usage stands and
  it shows in the waste report with the void's reason. Nobody enters it twice.
- Logging waste is Use, on the phone or by Pepper ("we dropped a tray of 12 chicken thighs").
- Waste is **explained** loss: variance shows it beside the unexplained part.

### 6.4 Transfers, adjustments, returns

- **Transfers** between venues of the same group, in two steps: sent (leaves the sender), received
  (arrives, with quantities that can differ; the difference stays on the transfer as lost in
  transit). Cancelling a sent transfer brings the stock back. Valued at the sender's average cost.
- **Adjustments** for what fits nothing else, always with a reason.
- **Returns and credit notes** against a delivery: lines, a reason, credit expected and received.
  Receiving's line statuses (short, damaged, missing) stay as they are.

## 7. Usage from sales

`usageOf()` turns one sold dish with its options into quantities of items. A job
(`api/src/jobs/stock-usage.js`, one run claimed in Postgres as the other jobs are) works out each
venue's trading day:

| Channel | Read from | Notes |
|---|---|---|
| Till and kiosk | `pos_checks.state` of closed checks on the day | Lines not voided, plus voids marked wasted. Options and deal picks come from the state; generated test sales are left out. |
| Online orders | `order_items` with the counted statuses | Dish by id; options by label matched within the dish's groups; deal parts as stored. |
| Loyverse, Square | `ext_line_parts` of sales not cancelled | Dish and option ids from the mapping. A mapped deal uses its typical picks. Refund receipts give stock back only when a rule says the goods came back (off by default). |
| GloriaFood | - | By name only today. Counted as "sold without a recipe" until its orders go through the item mapping tool (a follow-up). |

It writes `stock_usage_days` (venue, day, item, quantity, cost at the average, how much came from
each channel) and `dish_cost_days` (venue, day, dish, quantity sold, net sales, theoretical cost,
how many were uncosted). The second feeds margins by day without walking recipes again.

- **Late sales**: the job recomputes any open day whose sales changed (the last 14 days), so a hub
  that syncs the next morning is picked up.
- **Changed recipes**: saving a recipe or an option rule marks the venue's open days for
  recomputing, as a mapping rule does for imported sales. Days inside a closed period are never
  changed: what arrives late lands in the next period, marked.
- **Size**: a day's checks for ten venues is about 1,200 states to read; the job is light.
- With usage in place `SALES_COUNTED` turns on: stock on hand becomes last count + received +
  transfers in - transfers out - waste - usage, and "sales aren't taken off" disappears.
- **Remakes**: the kitchen logs a remake by dish name. Until it carries the dish id (a small till
  change), remakes are not in usage; they show as a known gap in the variance notes.

## 8. Variance, margins and the menu

### 8.1 Actual against theoretical

A **period** runs between two approved full counts at a venue (`stock_periods`: opening count,
closing count, the frozen figures). For each item:

```
actual usage      = opening + received + transfers in - transfers out - returns - closing
theoretical usage = usage from sales in the period
logged waste      = waste entries in the period
variance          = actual - theoretical              (in units and in pounds)
unexplained       = variance - logged waste
```

- Shown ranked by pounds, not percent, with each item's share of the venue's food sales; then by
  venue ("which site loses most on chicken").
- A band the group sets (default 1 point of sales for the venue, and an item rule: over 3% and
  over £50) decides what is flagged.
- Key-item counts give the same figures daily for the short list.
- Closing a period freezes its figures, like a Z. Reopening is Manage and leaves a note.
- **Actual food cost % = actual usage in pounds / net food sales.** It goes to a Cash Recon week
  line, a dashboard widget and the reports. Theoretical cost % sits beside it.
- Pepper's `explain_variance` lists the evidence for a flagged item: dishes sold without a recipe
  that use it, deliveries corrected after the count, negative on hand during the period, a unit
  that changed, waste logged, and transfers not received.

### 8.2 Menu margins and engineering

- **Menu margins page**: a menu, a venue and an order type; every dish with its price, net, cost,
  GP in pounds and cost %, coloured against the thresholds; options with a price show their own
  margin (extra cheese sells at 80p and costs 21p). Uncosted dishes are listed, not hidden.
- **Why this number**: the step by step explanation from `explain()`.
- **Engineering from real sales**, per section, over a period, by Kasavana and Smith:
  - popular = a dish's share of units is at least 70% of an equal share (0.7 / number of dishes);
  - profitable = its GP in pounds is at least the section's average GP per unit sold;
  - stars, plough-horses, puzzles, dogs. Pounds of margin lead; cost % is shown beside.
- **Scenarios** (`cost_scenarios`): change prices or costs by a figure or a percentage, for a dish,
  a section or all; see the weighted cost % and GP at the real mix; save, reopen, export. **Push
  prices** writes the new prices into the menu's draft through `menuSaveBody()`; publishing stays
  a separate, deliberate step.
- **Price creep**: when a price changes (a price list, an invoice applied), the dishes whose cost %
  crosses a threshold are listed, on the page and as a Today item; a rule trigger lets a group ask
  to be told ("when a dish goes over 35%, tell the owner").

### 8.3 Allergens, calories, labels

- **Allergens are kept on the supplier's product** (`inv_quotes`), because two suppliers' soy
  sauces differ: contains, may contain. Pepper can read them from a product spec when asked.
- The roll-up through recipes gives **suggested** allergens per dish. The page shows where the
  suggestion and the declaration differ ("the recipe has sesame; the dish does not say so"). A
  person accepts or dismisses each; nothing changes the declared allergens by itself.
- A change that could alter them (a preferred supplier switched, a product substituted on
  receiving, a recipe line changed) reopens the dish's check and puts it on Today.
- Why not automatic: the food business is liable for the declaration, and a roll-up is only as
  good as the supplier data under it.
- **Calories**: `menu_items.calories` exists. Energy per 100 g on an item gives a suggested figure
  the same way. Calorie labelling applies to businesses of 250 or more employees in England, and a
  franchise counts the whole network; confirm the detail before relying on it.
- **Labels** for food packed before it is ordered (PPDS): the ingredients list with allergens in
  bold and a use-by from the shelf life, printed through the hub. Phase 10.

## 9. Ordering from stock

- **Order to par takes stock off**: `packsToPar()` receives on hand and what is already on order.
- **Suggested order** per supplier: `forecast usage until the delivery after next + a buffer -
  on hand - on order`, rounded up to packs and minimums by the existing `fitQty()`.
- **Forecast, first version**: the average usage on the same weekday over the last four weeks,
  scaled by booked covers against the usual. It is shown with its working ("Tuesdays use 6.2 kg;
  18% more covers booked"). Weather and local events can join later.
- The order form shows on hand, on order and usage beside each line; what was suggested against
  what was ordered is kept, so the suggestion can be judged.

## 10. Where it plugs in

### 10.1 Areas, modules, pages

Two new areas, so two agents can build side by side: **recipes** (recipes, the cost engine, menu
margins, scenarios) and **stock** (counts, areas, waste, transfers, usage, variance, periods).
Purchasing keeps items, suppliers, prices and orders.

| Module | View | Use | Manage |
|---|---|---|---|
| `recipes` | Read recipes and methods (a kitchen's recipe book), no costs | - | Edit recipes, links and option rules |
| `costing` | Costs, margins, engineering, variance in pounds | - | Thresholds, scenarios, push prices |
| `stock` | On hand, counts, waste and transfers, no values | Count, log waste, send and receive transfers | Approve counts, close periods, areas, reasons |

A cost reveals supplier prices, so costs need `costing` View; `seesPurchasingPrices()` stays the
rule for the prices themselves. Each module needs its migration for existing tenants and custom
roles (migration 258 is the pattern).

Pages: **Recipes** (list with coverage, the editor with the live cost and explanation),
**Menu margins** (margins, engineering, scenarios), **Stock** (on hand, counts, waste, transfers,
variance; the Inventory page's Stock tab moves here). On the phone: **Count** and **Waste**.
Settings: thresholds, areas, waste reasons, the count rota, the variance band.

### 10.2 Reports

New subjects, each a work subject where a rule lives in code: recipes, recipe lines, recipe costs
(by venue), dish margins (from `dish_cost_days`: sold, net, theoretical cost, GP), stock moves,
waste, transfers, counts and count lines, usage by day, variance by period. Money needs `costing`.
Starters: margins by menu, dishes over their cost target, waste by reason and by week, variance by
item, theoretical against actual food cost by week, uncosted dishes by sales. Add synonyms (food
cost, GP, plate cost, shrinkage, wastage, stocktake) and re-run the smart builder's budget test.

### 10.3 Today, Home, dashboards

- Today tasks: a count due (from the rota), a count waiting for approval, a transfer to receive,
  variance to review, dishes over their cost target, allergen checks reopened. Set-up gaps for
  Home: no storage areas, top sellers without a recipe, items with no price.
- Dashboard widgets: food cost % actual and theoretical, waste this week by reason, top variance
  items, margin by menu. An Overview tile for stock.

### 10.4 Pepper

- Read: `dish_cost` (with the explanation), `menu_margins`, `find_recipes`, `recipe`,
  `explain_variance`, `why_cost_changed`, `waste_summary`, `suggested_order`.
- Change: `log_waste` (reversible, with Undo), `count_stock` (extended to areas and units),
  `send_transfer` / `receive_transfer`, `read_recipes` (drafts only), `link_recipes`,
  `save_scenario`. Every change tool gets its Activity words and its place in the registry.
- Forms through `open_form`: waste, a key-item count, a transfer.
- Rule triggers: a dish over its cost target, a period's variance over the band, waste logged over
  a value. Actions stay the two a rule may run (a notice, an H&S action).
- An evaluation file for purchasing and stock (there is none today).

### 10.5 Copying a venue

`createStore()` learns the new per-venue set-up: storage areas, count lists, venue recipe versions.

## 11. Phases

Estimates are on the scale in `docs/claude/estimates.md` (minutes of agent time, build plus
tests, browser check, docs and one pull request). A first step in a new area is at the full
scale; steps that follow the same day run nearer half.

| Phase | What | Ends with | Estimate |
|---|---|---|---|
| 1 | **Built 27 Nov 2026.** Units and yield on items; recipes and prep recipes; `shared/costing.js`; the Recipes page with live cost, coverage and the explanation; the `recipes` and `costing` modules | A recipe costed at each venue's prices | 80 to 100 |
| 2 | Links to dishes, option rules, meal deals, goods; the Menu margins page with the order type switch and thresholds; report subjects; Pepper's read tools | Every costed dish shows its margin | 80 to 100 |
| 3 | Pepper reads recipes (sheet, PDF, photo, text) into drafts; match dishes to recipes; coverage by sales value | Most of a menu costed in a sitting | 50 to 65 |
| 4 | The `stock` module; storage areas; stocktake (drafts, units, approval, key items, phone and scanner); waste; transfers; adjustments; `loadStockMoves()` | Stock run from documents | 90 to 110 |
| 5 | Usage from sales (till, kiosk, online, imported); on hand with sales taken off; order to par minus stock | Stock on hand that follows trading | 70 to 90 |
| 6 | Periods and variance; actual and theoretical food cost; the Cash Recon line; widgets; Today tasks; `explain_variance` | A pound figure on the gap, per item and venue | 70 to 90 |
| 7 | Engineering from real sales; scenarios; what-if; push prices; price creep and its rule trigger | Pricing decisions made in the app | 60 to 80 |
| 8 | Allergens on supplier products; the roll-up check and its Today item; suggested calories | Declared allergens checked against recipes | 50 to 65 |
| 9 | Suggested orders from usage and bookings; returns and credit notes | Orders proposed, not just listed | 60 to 80 |
| 10 | Later, not estimated: production of prep batches held as stock, labels, a central kitchen, recipe packs passed from a franchisor to its franchisees, GloriaFood through the mapping tool, remakes with dish ids | | |

Phases 1 to 9: about 610 to 780 minutes. Phases 1 to 3 give costing; 4 to 6 give stock control;
either half is useful alone, and 4 can be built beside 2 and 3 by a second agent.

### Phase 1 as built (27 Nov 2026)

- **Migrations** 298 (`inv_items.yield_pct`, `recipe_unit`, `count_unit`; `inv_item_units`), 299 (modules
  `recipes` and `costing`, group Recipes and costing; custom roles get recipes View, and costing View only
  where they already see supplier prices), 300 (`recipes`, `recipe_lines`), 301 (the Recipes menu link,
  after Purchasing).
- **Engine** `shared/costing.js`: `toBase()`, `itemCost()` (standard, last paid, average paid over 90 days),
  `recipeCost()`, `explain()`, `nestingProblem()`, `margin()`. `dishCost()` and `usageOf()` (5.5) wait for
  the links (phases 2 and 5). Loaded once per request by `loadCosting()` in `api/src/services/costingSvc.js`.
- **API** `/api/recipes` (`api/src/routes/recipes.js`), with a preview route the editor uses for the live
  cost before saving; units under `/api/inventory`.
- **Page** `/recipes`: the list (search, kind, coverage chips, cost at a venue on a basis), the editor (lines
  with drag order, details, method and photo, each saved on its own; the cost, each basis side by side, the
  gaps and the explanation). Units and yield in the Inventory page's item drawer.
- **Reports** Recipes, Recipe lines, Recipe costs (a work subject, standard prices, Costing view); starters
  Recipes not fully costed, Recipe cost by venue. **Pepper** `find_recipes`, `recipe` (read only).
- **What the build changed in the plan**: no `venue_id` on recipes (variations instead, 5.3); line units are
  free text with gaps (5.3); the item's `shelf_life_days` waits; the cost subject is by venue at standard
  prices only.

## 12. Decisions for the owner

| | Decision | Recommended |
|---|---|---|
| D1 | Which cost a recipe uses | The preferred supplier's price at the venue (what `chooseQuote()` picks), with last paid shown beside it. Stock value and variance at the average paid. |
| D2 | Recipes per group or per venue | One recipe for the group; a venue can have its own version where it really differs. Built in phase 1 as variations (`variant_of`); which one a dish uses per venue, revenue stream and order type comes with the links in phase 2. |
| D3 | How options change a recipe | Rules on the library option (add, remove, swap, scale, own recipe), with a per-dish exception. |
| D4 | Stock per storage area or per venue | Per venue. Areas order the count sheet only. |
| D5 | Prep batches (sauces, marinades) as stock | Not at first: a counted batch is turned into its ingredients by the recipe. Held as stock with production in phase 10. |
| D6 | Allergens from recipes | A check and a suggestion a person accepts, never an automatic declaration. |
| D7 | Who sees costs | A `costing` module apart from `recipes`, so a kitchen can read methods without seeing margins. |
| D8 | Currencies | Each venue's own; no exchange rates or base currency. |
| D9 | History when a recipe changes | Open days are recomputed; closed periods never change. |
| D10 | Test till sales | Left out of stock usage. |
| D11 | Counting | Use to count, Manage to approve; a second person required only if the group switches it on. |
| D12 | Where to start | Phases 1 to 3 first (costing shows value in a day), then 4 to 6. |

## 13. Risks and what is not solved

- **Upkeep.** The usual way these modules die is recipes going stale and counts being skipped.
  The design answers with reading recipes in, coverage by value, key-item counts and Today tasks;
  it still needs someone at each group who owns it.
- **Units.** Every costing failure in other products traces to a missing conversion. The engine
  names the gap; it cannot fill it.
- **Options by label.** Online orders and a dish's own options are matched by label; renaming one
  breaks the match until its rule is repointed. The usage job reports what it could not match.
- **Deals from other tills** are costed at typical picks, not actual.
- **GloriaFood and remakes** are outside usage until their follow-ups are built; variance for a
  venue with much GloriaFood trade will read high, and says why.
- **Costs meet pence in one place.** Purchasing is in pounds, the till in pence; a second place
  that mixes them would be a bug waiting.
- **The menu save.** Anything pointing at a dish must survive it. The links are plain ids; a test
  saves a menu and checks every link, rule and usage figure is unchanged.
- **Calories and labelling law** were not confirmed from the legislation in this research.
- **The research** read search extracts, not vendors' full documentation; figures marked
  unverified in the briefing are rules of thumb.

## 14. Tests

- `shared/test/costing.test.mjs`: yields (the 1 / yield rule), conversions refused by name,
  nesting and the cycle refusal, coverage, option rules with each prefix, a deal's parts, margin
  at two VAT rates, and that `usageOf()` and `dishCost()` agree (cost = sum of usage x item cost).
- Stock: `stockOnHand()` with every kind of move; a count approved, replaced, and a delivery
  corrected after it; a transfer in each state; waste from a void.
- Usage: one day's sales from each channel giving the expected quantities; a late sale recomputes
  an open day and leaves a closed period alone; a recipe change does the same.
- Variance: opening + received - closing equals theoretical + waste + variance for every item
  (a property check over generated data).
- A menu saved, duplicated and published keeps every link and rule.
- Cross-tenant: every new table has its fixture and its report decision (rule 28).
- The live Pepper check for the recipe reader before its pull request (the lesson of 24 Nov 2026).

## Appendix: formulas in one place

```
pack to base          pack_base_qty = pack_count x pack_qty x unit factor
cost per base unit    price per pack / pack_base_qty
usable cost           cost per base unit / (yield % / 100)
recipe line           toBase(qty, unit) / (yield % / 100) x cost per base unit
prep recipe unit      sum of lines / (yield_qty x (1 - loss % / 100))
dish portion          sum of lines / portions
net price             gross - round(gross x rate / (100 + rate))
gross profit          net price - cost
cost %                cost / net price
weighted average      (on hand x average + received x price paid) / (on hand + received)
on hand               last count + received + transfers in - transfers out - returns - waste - usage +/- adjustments
actual usage          opening + received + transfers in - transfers out - returns - closing
variance              actual usage - theoretical usage ;  unexplained = variance - logged waste
popular (K-S)         units share >= 0.7 / number of dishes in the section
profitable (K-S)      GP per unit >= section GP / section units
suggested order       forecast usage over cover days + buffer - on hand - on order, up to whole packs
```
