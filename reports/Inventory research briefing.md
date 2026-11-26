# Inventory, recipe costing and stock control: research briefing (26 Nov 2026)

Method note: web search only. Direct page fetches were blocked in this session (vendor hosts are outside the network allowlist), so vendor behaviour below comes from search extracts of their help centres and blogs, not full-page reads. Items marked [unverified] are from general industry knowledge or could not be confirmed against a source.

## 1. Recipe costing

**Yield**
- Yield % = EP (edible portion) weight / AP (as purchased) weight x 100. EP cost per unit = AP cost per unit / yield %. A 90% yield makes each usable unit cost about 11% more than the invoice says (Galley: https://www.galleysolutions.com/food-costing-framework; MarketMan: https://www.marketman.com/blog/food-yield-percentage).
- Two places yield lives, and good products support both:
  - Per ingredient or per "prep action" (trim loss that is always the same: peeled onion). meez ships a database of 3,000+ ingredients with tested prep-action yields, overridable (https://intercom.help/getmeez/en/articles/9346249-yield-faqs, https://intercom.help/getmeez/en/articles/4593355-creating-ingredient-prep-actions).
  - Per batch recipe (cooking loss): Toast xtraCHEF prep recipes carry a batch size plus a yield field, "the percentage of the batch that is usable" (https://support.toasttab.com/en/article/xtraCHEF-Recipe-Costing). Lightspeed: batch unit cost = total cost / expected yield (https://o-series-support.lightspeedhq.com/hc/en-us/articles/31329334643099-Using-the-recipe-cost-calculator).
- Supy records actual batch output next to theoretical yield, and splits cost across co-products (by market value, or all to the primary output) (https://supy.io/blog/learn-prep-recipe-yield-batch-production-tracking, https://supy.io/blog/learn-breakdown-recipe-cost-allocation-co-products).

**Units**
- Pattern everywhere: purchase pack -> base unit -> recipe unit. Apicbase: ingredients are entered at the supplier pack size, recipes use the portion, the system converts; without a custom conversion 1 litre = 1 kg (https://support.apicbase.com/help/adding-and-editing-packages-and-pricing).
- meez: a per-ingredient "UoM equivalency" tab (weight to volume, each to weight, custom units such as "Tub = 2.85 lb"); a count unit with no weight breaks costing and nutrition (https://intercom.help/getmeez/en/articles/6492463-uom-equivalency-tab-explained).
- "Top reasons recipes aren't costing" in meez are missing conversions and missing yields (https://intercom.help/getmeez/en/articles/7204464-top-4-reasons-why-your-recipes-aren-t-costing).

**Sub-recipes, modifiers, combos**
- Nested sub-recipes with cost roll-up are standard (Galley, meez, MarketMan, xtraCHEF, Apicbase). Loyverse composite items nest to 3 levels (https://help.loyverse.com/help/how-create-composite-item).
- Square's own recipes (beta) cannot nest, cannot be used on items with variations, and modifiers do not deplete stock or count in COGS; Square sells a MarketMan add-on to fill this (https://squareup.com/help/gb/en/article/8629-beta-track-ingredient-costs-with-square-recipes). This is the gap cheap POS inventory leaves.
- Modifiers need their own recipe deltas (add, remove, swap); xtraCHEF lets prep recipes be attached to modifiers. Combos: cost = sum of the chosen components; margin must be judged on the discounted combo price [unverified as a vendor feature].
- Plate cost = sum of portion costs of every recipe on the dish (https://pos.toasttab.com/blog/on-the-line/calculate-plate-cost). Food cost % = plate cost / net selling price. Typical range quoted 28 to 35% (Crunchtime).

**Cost basis**
| Product | Recipe / item cost basis | Source |
|---|---|---|
| Restaurant365 | Per item, per location, one of: Weighted Average (Last Count), Weighted Average (Last 3), Last Received; zero-price and negative lines excluded | https://docs.restaurant365.com/docs/purchased-item-record-cost-update-method |
| Apicbase | Weighted average cost for stock value; sales, waste and transfers draw on it; falls back to the pack's list price if no purchase in 30 days | https://support.apicbase.com/help/how-does-apicbase-manage-your-inventory |
| Supy | Rolling weighted average, with a toggle to latest purchase price on each recipe | https://supy.io/blog/learn-recipe-cost-weighted-average-audit-trail |
| Toast xtraCHEF | Most recent invoice price | https://pos.toasttab.com/products/recipe-costing |
| WISK | Latest invoice prices for pour cost | https://wisk.ai/beverage-costing |
| Loyverse | Read-only Average Cost, recalculated on each receipt | https://help.loyverse.com/help/advanced-inventory-management |
| MarketMan | "Live" prices from invoices; exact method not confirmed | https://www.marketman.com/platform/recipe-costing-software |
| Fourth, Crunchtime, Nory, Galley | Not confirmed | |

- Weighted average: new avg = (on hand qty x avg cost + received qty x received price) / (on hand qty + received qty).
- Why: last price shows today's margin and price creep (best for menu pricing); weighted average smooths noise and matches stock valuation and COGS (best for AvT and accounts). FIFO layers are rare in restaurant tools; LIFO is not allowed under IFRS (https://pos.toasttab.com/blog/on-the-line/restaurant-inventory-costing-methods). Franchise costing usually adds a third basis: a standard (contract) price [unverified].

## 2. Actual vs theoretical (AvT)

- Actual usage = opening stock + purchases + transfers in - transfers out - closing stock. Actual cost % = actual usage value / net sales.
- Theoretical usage = sum over items sold (qty sold x recipe qty, including modifiers), plus logged waste if waste is treated as "explained".
- Variance = actual - theoretical, per ingredient, in quantity and value; also as points of sales. Unexplained variance = variance - logged waste.
- Targets: Crunchtime says pick a band such as plus or minus 1 percentage point; 1.9% on $1M sales = $19,000 (https://www.crunchtime.com/blog/blog/explaining-actual-vs-theoretical-food-cost-variance). Supy: under 2 points is good control, over 4 to 5 points for several weeks has a root cause (https://supy.io/blog/learn-theoretical-vs-actual-food-cost-variance). Rosnet's data (204 groups, 5,281 sites): new customers start about 8.7% above theoretical (https://www.rosnet.com/customer-stories/restaurant-food-cost-improvement-analysis).
- QSR versus full service split: no authoritative source found. Rule of thumb [unverified]: QSR 0.5 to 1 point, full service 1 to 2 points.
- Item thresholds seen: investigate over 3% on a high-volume item or over $50 on any item; repeat offenders matter more than one bad week.
- Causes: over-portioning, unlogged waste, theft, unrecorded transfers, wrong or stale recipes and yields, receiving and invoice errors, count errors (same item in different units), unrung sales and comps (Crunchtime; https://www.marginedge.com/blog/a-restaurant-operators-guide-to-actual-vs-theoretical-food-costs-and-usage).
- Rank ingredients by variance in money, not %, then start at the worst site for each (Crunchtime).
- Cadence: daily or per-shift counts of a short key-item list (proteins, cheese, high-theft), weekly counts of key items, full count at period end (weekly in QSR, at least monthly), always at a fixed time before deliveries (https://www.marketman.com/resources/restaurant-inventory-count-schedule-guide, https://www.marginedge.com/blog/top-restaurant-inventory-best-practices). The "top items = 80% of cost" rule is common wisdom, no source found.
- R365 states its AvT is not meant to tie exactly to the accounts (https://docs.restaurant365.com/docs/actual-vs-theoretical-analysis).

## 3. Stock operations

- Perpetual (theoretical on hand from a movements ledger) plus periodic counts that correct it is the norm. Ledger rows [design inference]: item, site, storage area, movement type (receipt, sale depletion, waste, transfer in/out, production consume/produce, count adjustment, return), qty in base unit, unit cost at the time, source document.
- Counts (R365): templates per storage location, ordered "shelf to sheet"; a quantity per unit of measure for each item (case + each + kg); completion blocked until every location is counted; variance review, then approval by a different permission (https://docs.restaurant365.com/docs/inventory-counts-create-and-edit-an-inventory-template, https://docs.restaurant365.com/docs/review-and-approve-an-inventory-count).
- Apicbase: count packs plus loose "Part"; uncounted items keep their quantity, zero must be counted explicitly (https://support.apicbase.com/help/counting-your-inventory).
- Bars: WISK uses barcode scan plus a Bluetooth scale for part bottles; others use tenths by eye (https://wisk.ai/bar-inventory-software).
- Waste log fields: item or recipe, qty, reason, cost, shift or person. WRAP's split for UK hospitality: 21% spoilage, 45% preparation, 34% plate; about 1.1 Mt and £3.2bn a year, 75% avoidable; method is Target, Measure, Act (https://guardiansofgrub.com/, https://wrap.ngo/sectors/hospitality-food-service).
- Central kitchen (Supy): prep items are "semi-finished, stockable"; production consumes ingredients and adds the batch at cost; transfers to sites at cost, no internal invoice; without production recipes semi-finished stock values at zero (https://supy.io/blog/learn-central-kitchen-semi-finished-vs-finished-recipes).
- R365 costing transactions: invoices, transfers (receiving site), commissary fulfilments, approved counts.
- Negative stock and real-time versus nightly depletion: no clear vendor documentation found. Common practice [unverified]: allow negative, flag it as a signal of a missed receipt or wrong recipe, never block a sale.

## 4. Ordering

- Par: par = average daily usage x (lead time + days between deliveries) + safety stock; safety stock often 20 to 25% of usage, or (max daily usage x max lead time) - (avg daily usage x avg lead time). Order = par - on hand (https://marketman.com/blog/how-to-calculate-par-level-in-a-restaurant, https://pos.toasttab.com/blog/on-the-line/par-level).
- Forecast: suggested = max(0, forecast usage over cover days + buffer - on hand - on order), rounded up to the pack and supplier minimum [rounding and on-order are standard practice, not confirmed per vendor].
- R365: "consumption days" + "buffer days"; on hand is the last count if entered, else theoretical; it also reports how the suggestion compared with what was ordered (https://docs.restaurant365.com/docs/po-suggestion-evaluation).
- Crunchtime: "Need minus Have", need from forecast sales x recipes, pars and history (https://www.crunchtime.com/blog/benefits-of-recommended-orders).
- Presentation: pre-filled order per supplier, editable quantity, with on hand and usage shown beside it.

## 5. Menu engineering

- Kasavana-Smith, per menu category:
  - Popularity threshold = 70% x (1 / number of items). Item is "high" if its share of units sold is at or above it.
  - Contribution margin (CM) = net price - plate cost. Threshold = weighted average CM = total CM / total units sold.
  - Star: high/high. Plowhorse: popular, low CM. Puzzle: unpopular, high CM. Dog: low/low (https://psu.pb.unizin.org/hmd329/chapter/ch9/, https://jwu.pressbooks.pub/foodservicefinancialsystems/?p=126).
- It ranks on cash margin, not food cost %: a 40% cost item can earn more pounds than a 25% one. Show both.
- Price creep: MarketMan, Nory, Supy re-cost recipes on each approved invoice and alert on rises (https://get.nory.ai/restaurant-inventory-management-software).
- UK VAT: eat-in is always 20%; hot takeaway 20%; cold takeaway food mostly zero-rated, except excepted items (confectionery, crisps, drinks) (https://www.gov.uk/guidance/catering-takeaway-food-and-vat-notice-7091). Net price = gross / 1.2 for standard-rated. The same item has a different margin by order type.

## 6. UK specifics

- PPDS (Natasha's Law, 1 Oct 2021): food packed on site before the customer orders needs the name and a full ingredients list with the 14 allergens emphasised. Not for distance selling (https://www.food.gov.uk/ppds, https://www.gov.uk/government/publications/labelling-guidance-for-prepacked-for-direct-sale-ppds-food-products).
- "May contain" only after a risk assessment finds an unavoidable cross-contamination risk; voluntary but must be accurate; supplier "may contain" should be passed on; never beside a "free from" claim (https://www.food.gov.uk/business-guidance/food-allergen-labelling-and-information-requirements-technical-guidance-summary).
- Fourth auto-calculates allergens and nutrition from ingredients and publishes to POS, web and screens (https://www.fourth.com/white-paper/nutrition-and-allergen-information). Legal risk: the food business is liable; a roll-up is only as good as supplier specs, and substitutions or a changed product silently break it. Keep supplier-product level allergens, an approval step, and re-approval on change (FDF change management guidance, referenced by the FSA).
- Calories (England, SI 2021/909, from 6 Apr 2022): businesses with 250+ employees; a franchise counts the whole network's employees, so a small franchisee is caught (https://www.gov.uk/government/publications/calorie-labelling-in-the-out-of-home-sector/calorie-labelling-in-the-out-of-home-sector-implementation-guidance). [unverified this session: statement "adults need around 2000 kcal a day", exemption for items on sale under 30 days, 20% tolerance, £2,500 fixed penalty.]
- HACCP: prep batches need made-on and use-by labels from the recipe's shelf life [unverified in sources].

## 7. Franchise

- Checklist (Supy): standard item master and recipes, franchisee-scoped access, estate cost roll-up, AvT per site (https://supy.io/blog/learn-restaurant-franchise-management-software).
- Crunchtime: franchisor-set configuration, franchisees control users and site details (https://www.crunchtime.com/solutions/franchisee-franchisor-setup/).
- Rank stores on variance, not raw food cost %: a store with higher cost can be better run (Toast: https://pos.toasttab.com/blog/on-the-line/actual-vs-theoretical-food-cost).
- Locked recipes with local prices and mandated-supplier compliance: standard in enterprise tools but not confirmed in public docs.

## 8. Failure modes

- Operators often run inventory without ever building recipes (https://www.fsrmagazine.com/feature/inventory-management-too-expensive-ignore-and-too-complicated-spreadsheets/). No survey data found; the rest is vendor and trade commentary.
- Recurring causes: unit and conversion gaps, stale prices and recipes, long counts, mismatched count units, zero-priced items distorting averages (https://supy.io/blog/learn-inactive-zero-priced-items-average-cost).
- What reduces effort: invoice scanning that creates items and prices, ingredient databases with default yields, key-item counts, mobile counting in shelf order, barcode scan, AI recipe import with a review step.

## 9. AI, 2025 to 2026

- MarketMan: AI invoice scanning (line capture, item mapping, cost alerts), "AI Recipe Match" reading uploaded ingredient lists and matching to inventory (https://www.restaurantdive.com/press-release/20250206-marketman-unveils-new-ai-recipe-management-features-to-streamline-back-of-h/).
- meez: AI recipe importer (PDF, scans), recipes tagged for one-by-one validation (https://intercom.help/getmeez/en/articles/13402676-importing-your-recipes).
- Galley Assist: a foodservice-specific LLM (https://natlawreview.com/press-releases/galley-solutions-unveils-galley-assist-first-domain-specific-llm-built).
- Nory: "agentic AI" for forecasting, labour, inventory (https://restauranttechnologynews.com/2026/06/nory-brings-agentic-ai-to-restaurant-forecasting-labor-optimization-inventory-management-and-profitability/). Restaurant365: R365 AI, May 2026.
- BlueCart: LLM invoice OCR from dock photos (https://www.bluecart.com/blog/how-ai-is-changing-food-procurement).

## Design implications

1. Store every quantity in a base unit per item (g, ml, each) with per-item conversions; refuse to cost a line with no conversion and say which one is missing.
2. Yield in two places: per ingredient prep (trim) and per batch recipe (cooking loss, with actual output recorded at production).
3. Keep three costs per item per venue: last received, weighted average, standard (brand) price. Recipes and menu engineering default to last; stock value and AvT use weighted average.
4. One movements ledger is the source of truth; on hand is a projection, counts post adjustments.
5. Modifiers and combos carry recipe deltas, or theoretical usage will be wrong from day one.
6. AvT per ingredient in quantity and money, with logged waste shown separately from unexplained variance; default alert band about 1 point of sales, configurable.
7. Key-item count lists (daily) alongside full counts; count sheets by storage area in shelf order; several units per line; uncounted is not zero; approval step.
8. Allow negative stock and surface it as a data-quality flag.
9. Prep items are stockable only when flagged; production is one tap (batch made, actual yield).
10. Suggested order = forecast usage over cover + buffer days - on hand - on order, pack-rounded, per supplier delivery days; fall back to pars when there is no forecast.
11. Menu engineering on net-of-VAT price by order type, showing cash margin and cost % together, with price-creep alerts from receiving.
12. Allergens held at supplier-product level, rolled up as a draft that a person approves; any recipe or product change reopens approval. Never publish an auto-derived declaration unreviewed.
13. Franchisor recipes locked, venue prices local; store ranking on variance.
14. Setup by AI: invoice scan creates items, packs and prices; recipe import from documents, always into a review queue.
15. Calories: treat every franchisee as in scope when the brand network has 250+ staff.
