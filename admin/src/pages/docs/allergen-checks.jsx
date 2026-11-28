// src/pages/docs/allergen-checks.jsx
// The Docs page's "Allergen checks" section (inventory phase 8a, migration
// 316, 27 Nov 2026; phase 8b, migrations 317 and 318: reopening on changes,
// the Today item, substitutes, calories). Docs.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, Mono, InfoBox, DataTable } from './parts.jsx'

export const id = 'allergen-checks'
export const label = 'Allergen and calorie checks'
export const order = 256.7

export function Section() {
  return (
    <section id="allergen-checks" data-doc="">
      <H2>Allergen and calorie checks</H2>
      <P>
        Inventory phase 8a (<Mono>docs/INVENTORY.md</Mono> 8.3, decision D6; migration 316, 27 Nov 2026): allergens on the
        supplier&apos;s product, a roll-up through recipes giving each dish&apos;s <em>suggested</em> allergens, and a check
        against what the dish <em>declares</em> (the menus area&apos;s data), which a person accepts or dismisses. Nothing
        changes a declaration by itself. Area: recipes (the product columns are purchasing&apos;s <Mono>inv_quotes</Mono>; the
        declaration is the menus area&apos;s, written through its own route). Phase 8b (migrations 317 and 318) works the
        checks out again where each change is saved, puts what it opened on Today, counts a substitute delivered, and adds
        suggested calories on the same walk.
      </P>
      <H3>Tables</H3>
      <DataTable
        head={['Table / columns', 'What']}
        rows={[
          ['inv_quotes.allergens_contains, allergens_may_contain', 'text[] of STANDARD_ALLERGENS keys (shared/menuTags.js, the menus\' 14): one list, rule 12'],
          ['inv_quotes.allergens_checked_at, _by, _source', 'when someone saved them (null = unknown: a gap, never "free"), who, and where from (a note, 300 chars)'],
          ['allergen_checks', 'one row per menu dish (plain dish_id, menu_id: no foreign keys), status open | accepted | dismissed, differences jsonb, fingerprint, suggested, declared, scopes (the scope groups with evidence), gaps, complete, decided_by / _at, note, history jsonb, worked_at. RLS forced. Unique (tenant_id, dish_id).'],
          ['allergen_checks.venue_ids, changed_at, change (317)', 'the venues the dish is sold at (Today per venue); when and what change opened it, opened it again or changed it while open (500 chars). Cleared by a decision'],
          ['inv_items.kcal_per_100g, kcal_each, kcal_source (318)', 'energy: per 100 g (per 100 ml for an item kept in ml) or, kept in each, per one, of the part used; null = unknown. The other kind of unit is refused (energyProblem()); a base unit change clears both'],
          ['calorie_checks (318)', 'one row per menu dish like allergen_checks: status, kind missing | differs | under, suggested_kcal, min_kcal, max_kcal, declared_kcal, fingerprint, complete, gaps, scopes jsonb, decided_kcal (the figure accepted, or the suggestion dismissed), decided_by / _at, note, history, venue_ids, changed_at, change, worked_at. RLS forced. Unique (tenant_id, dish_id); the nightly links sweep deletes those of dishes on no menu'],
        ]}
      />
      <H3>The rule: shared/allergenCheck.js</H3>
      <P>
        <Mono>dishItems(dishId, scope, ctx)</Mono> walks the dish on the cost engine&apos;s own walk: <Mono>usageOf()</Mono> in{' '}
        <Mono>shared/costing.js</Mono> with a <Mono>trace</Mono> (<Mono>{'{ item, recipe }'}</Mono> callbacks; without one
        the walk is unchanged), which hears of every item line, its quantity known or not, through <Mono>batchItems()</Mono>{' '}
        into prep recipes; once for the dish and once per offered option whose rule adds, swaps or is a recipe. No fourth
        walk. <Mono>scopeSuggestion()</Mono> takes each item at <Mono>chooseQuote()</Mono>&apos;s product at the scope&apos;s
        venue and its <Mono>quoteAllergens()</Mono>; <Mono>recipeSuggestion()</Mono> does the same for one recipe
        (<Mono>recipeUsage()</Mono> with the trace).
      </P>
      <DataTable
        head={['Function', 'What']}
        rows={[
          ['dishScopes(dish, ctx, venueIds)', 'each venue the dish\'s menu is sold at (a menu with a venue: that one; else every active venue), and each of the dish\'s links that applies there (a stream\'s, an order type\'s): every recipe the matrix can pick'],
          ['dishCheck(dish, results, declared, names)', 'the union over the scopes against the one declaration: missing, missing_may, weaker (always), not_found and stronger (only when every scope is complete); groups (scopes with the same suggestion, evidence and gaps), gaps once'],
          ['declaredOf(dish, tags)', 'the dish\'s dietary codes and allergen_levels by the tags\' standard_key; a tag outside the 14 is left out; removable counts as contains'],
          ['fingerprint(differences) / nextCheck(stored, check)', 'what a decision holds for, and insert / update / delete: no differences delete a row unless accepted; dismissed holds while the fingerprint is the same; accepted with differences again reopens, the decision into history'],
          ['acceptedLevels(declared, differences, keys)', 'the declaration\'s new levels: DIFFERENCE_KINDS[kind].suggest (null takes it off)'],
          ['checksDish(dish)', 'food dishes only: meal deals (their allergens are their dishes\') and goods and services are not checked'],
          ['checkState(row) / CHECK_STATES / checkCounts(rows)', 'what the list says of a check: its stored status, else agree only when complete, incomplete ("Not all known") while anything is unknown (never a pass), not_checkable with no recipe. The tab, its counts, the list order and Pepper all read it (rule 12)'],
          ['pickedDifferences(differences, keys)', 'the ticked allergens of the differences there are now: what the tab counts, confirms and sends'],
          ['gapAt(gap, venueNames)', 'an unknown ingredient\'s gap named at every venue it is unknown at (a scope group, the check\'s merged gaps, the recipe editor\'s venue groups), never the first venue alone'],
        ]}
      />
      <P>
        Gaps: <Mono>no_recipe</Mono>, <Mono>not_dish</Mono>, <Mono>empty</Mono> (a recipe with no ingredients),{' '}
        <Mono>draft</Mono> (a recipe Pepper wrote, <Mono>needsCheck()</Mono>: its unmatched lines are in its notes),{' '}
        <Mono>option</Mono> (an option <Mono>optionDefault()</Mono> calls a gap), <Mono>item_gone</Mono>,{' '}
        <Mono>no_product</Mono> and <Mono>unknown</Mono> (the chosen product has no <Mono>allergens_checked_at</Mono>).
      </P>
      <H3>Service and routes</H3>
      <P>
        <Mono>api/src/services/allergenCheckSvc.js</Mono> (public): <Mono>loadAllergenCtx()</Mono> (draft and live menus,
        tags, active venues, <Mono>loadDishCosting()</Mono> at the group&apos;s prices: lines don&apos;t depend on the venue,
        the product is chosen per scope), <Mono>workOut()</Mono>, <Mono>storeChecks()</Mono> (under a per-group advisory
        lock; an accepted check keeps the differences it accepted as its record), <Mono>checkRows()</Mono> (store false: a
        read-only view), <Mono>loadRecipeSuggestion()</Mono>. Checks of dishes on no menu are deleted by the nightly links
        sweep (<Mono>sweepTenantLinks()</Mono>).
      </P>
      <DataTable
        head={['Route', 'Who', 'What']}
        rows={[
          ['PUT /api/inventory/quotes/:id/allergens', 'Purchasing setup manage', '{ known, contains, may_contain, source }, whole (strict); known false clears to unknown'],
          ['POST /api/ai/allergens/read', 'Purchasing setup manage + Pepper', '{ quote_id, files } (photos, PDFs; up to 4, 20 MB): services/allergenReadAi.js readSpec(), askForJson() use allergen_reader, the names as data, no ids; { allergens: { key: { level, words } }, product_name, notes, said }. Nothing saved, the file not kept'],
          ['GET /api/allergen-checks?venue_id=', 'Recipes view', 'every food dish\'s check, worked out and kept; each row\'s state (checkState()); open first, then incomplete; counts (open, incomplete, dismissed, accepted, agree, not_checkable), venues, can_decide'],
          ['GET /api/allergen-checks/dishes/:dishId', 'Recipes view', 'one dish\'s check (404 for a dish on none of the group\'s menus)'],
          ['POST /api/allergen-checks/dishes/:dishId/accept', 'Recipes manage + Menus manage', '{ fingerprint, allergens }: the allergens always named (400 without; 422 nothing when none of them differs now, so ticks left from before accept nothing). GET then PUT /api/menus/:id/allergens as the person (callApi()), the dish\'s whole levels (every tag, rule 13); the draft only, no publish; 409 changed when the fingerprint differs'],
          ['POST /api/allergen-checks/dishes/:dishId/dismiss', 'Recipes manage + Menus manage', '{ fingerprint, note } (note required)'],
          ['POST /api/allergen-checks/dishes/:dishId/reopen', 'Recipes manage + Menus manage', 'a dismissal taken back, into history'],
          ['GET /api/allergen-checks/recipes/:recipeId', 'Recipes view', 'a recipe\'s own suggestion at each active venue, venues with the same answer together'],
        ]}
      />
      <H3>Opened again on a change (phase 8b, migration 317)</H3>
      <P>
        One hook, <Mono>allergensChanged(tx, req, change)</Mono> in <Mono>allergenCheckSvc.js</Mono>, called after the change
        in its own transaction (a savepoint: a failure is logged and the change is saved; never in a dry run). change:{' '}
        <Mono>{'{ kind, itemIds, quoteIds, recipeIds, dishIds, optionIds, venueIds }'}</Mono>.{' '}
        <Mono>dishesToCheck()</Mono> (<Mono>shared/allergenCheck.js</Mono>) finds the dishes: price creep&apos;s index{' '}
        <Mono>dishesUsing(itemIds, recipes, links, {'{ recipeIds }'})</Mono> (<Mono>shared/priceCreep.js</Mono>, up through
        prep recipes), the dishes offering an option whose rule adds or swaps in one of them (<Mono>optionsUsing()</Mono>), and
        the dishes named. Meal deals aren&apos;t checked, so <Mono>dealsHolding()</Mono> adds nothing. Their checks are kept by{' '}
        <Mono>storeChecks(..., {'{ cause }'})</Mono> and <Mono>storeCalorieChecks()</Mono>: a check inserted, reopened or
        whose open differences change is marked (<Mono>changed_at</Mono>, <Mono>change</Mono>: <Mono>changeWords()</Mono>).
        A decision clears it.
      </P>
      <DataTable
        head={['Kind', 'Called from']}
        rows={[
          ['quote', 'routes/inventory.js: POST /items/:id/quotes, PATCH /quotes/:id (price, pack, on or off, supplier, name or code), DELETE /quotes/:id, PUT /quotes/:id/venue-prices, POST /price-update, POST /import; routes/purchasing.js POST /pos/:id/price-list'],
          ['quote_allergens', 'PUT /api/inventory/quotes/:id/allergens'],
          ['preferred', 'PUT /api/inventory/items/:id/preferred (price creep isn\'t told: it compares prices with their history; the hourly sweep sees that crossing)'],
          ['supplier', 'PATCH /api/suppliers/:id switching is_active'],
          ['substitute', 'receiveInto() (POST /pos/:id/receive, a delivery without an order) when a line is, or was, Substituted'],
          ['recipe', 'PUT /api/recipes/:id, PATCH /:id/active, DELETE (the dishes its links and rules reached)'],
          ['link', 'PUT /api/recipe-links/dishes/:id/cell, DELETE /links/:id, POST /bulk, POST /dishes/:id/recipe'],
          ['option_rule', 'PUT /api/recipe-options/rules, DELETE /rules/:id'],
          ['item', 'PATCH /api/inventory/items/:id (energy or base unit), POST /items/:id/units, PATCH /units/:id (a size): calories'],
        ]}
      />
      <P>
        Substitutes: <Mono>loadSubstitutes()</Mono> reads, per venue and item, the latest received line in the last{' '}
        <Mono>SUBSTITUTE_DAYS</Mono> (14) days; when it is Substituted, <Mono>substituteKnown()</Mono> says whether the line&apos;s
        supplier price is what came (its code, else its name, is the invoice&apos;s: as the price list&apos;s Add leaves it).
        Known, its allergens count at that venue beside the chosen product (evidence says &quot;a substitute delivered&quot;);
        unknown, a <Mono>substitute</Mono> gap.
      </P>
      <H3>Calories (phase 8b, migration 318): shared/calorieCheck.js</H3>
      <P>
        The trace of <Mono>usageOf()</Mono> / <Mono>recipeUsage()</Mono> carries each item line&apos;s <Mono>qty</Mono>: its
        usable base quantity (the line&apos;s, before its yield is bought) times its share of the batch (<Mono>tr.eat</Mono>{' '}
        carries a prep recipe line&apos;s own yield). Without a trace nothing changes. <Mono>dishEnergy()</Mono> sums{' '}
        <Mono>qty x energyOf(item).per_base</Mono> for one serving (no options), with <Mono>usageOf()</Mono>&apos;s quantity
        gaps and <Mono>no_energy</Mono>; <Mono>recipeEnergy()</Mono> for the editor.
      </P>
      <DataTable
        head={['Function', 'What']}
        rows={[
          ['calorieCheck(dish, results, declared, names)', 'over dishScopes(): suggested = the highest complete scope; min, max, spread; lower = the highest known part; difference missing | differs (outside withinTolerance(): 10%, at least 10 kcal) | under (incomplete, the known part already over the declaration)'],
          ['calorieFingerprint(check) / nextCalorieCheck(stored, check)', 'kind:declared:suggested:lower; a dismissal holds while the kind and declared figure are the same and the figure stays within the tolerance of decided_kcal; accepted with a difference again reopens'],
          ['calorieMoved(fingerprint, check)', 'a change marks an open check only when its difference moved past the tolerance'],
          ['energyOf / energyProblem / energyWords', 'an item\'s figure for its kind of unit; validation; words'],
        ]}
      />
      <DataTable
        head={['Route', 'Who', 'What']}
        rows={[
          ['GET /api/allergen-checks, /dishes/:id', 'Recipes view', 'each row carries calories (calorieView(): state by checkState(), difference, groups with their top lines, gaps, decision, change)'],
          ['POST /dishes/:id/calories/accept', 'Recipes manage + Menus manage', '{ fingerprint }; 422 incomplete with gaps; GET /api/menus/:id then PATCH it with menuSaveBody() as the person (the only route that writes menu_items.calories: every field sent back), the draft only'],
          ['POST /dishes/:id/calories/dismiss, /reopen', 'Recipes manage + Menus manage', '{ fingerprint, note }; a dismissal taken back'],
          ['GET /api/allergen-checks/summary?venue_id=', 'Recipes view', 'Today\'s source (services/opsToday.js allergen_checks, module recipes): the marked open checks and calorie checks at the venue, can_decide; read only'],
          ['GET /api/allergen-checks/recipes/:id', 'Recipes view', 'also calories: the recipe\'s energy and its linked dishes\' declared figures'],
        ]}
      />
      <InfoBox type="warn">
        Accepting goes through the Allergen matrix&apos;s <Mono>PUT /api/menus/:id/allergens</Mono>, not the whole-tree menu
        PATCH: that route writes only the dishes sent (<Mono>docs/claude/areas/menus.md</Mono>: a new place that edits dish
        tags writes only the dishes it changed), with each dish&apos;s every tag. Pepper&apos;s <Mono>find_dishes</Mono> reads
        the live release, so allergy answers change only when the menu&apos;s allergens are published.
      </InfoBox>
      <H3>Admin, Pepper, reports</H3>
      <P>
        Admin: <Mono>components/purchasing/allergens.jsx</Mono> (<Mono>QuoteAllergensModal</Mono>, lazy from{' '}
        <Mono>pages/Inventory.jsx</Mono>), <Mono>components/recipes/Allergens.jsx</Mono> (the tab, lazy at{' '}
        <Mono>?tab=allergens&amp;check=</Mono>; <Mono>RecipeSuggestion</Mono>, lazy in the recipe editor). Pepper (
        <Mono>api/src/ai/tools/recipes.js</Mono>): <Mono>allergen_check</Mono> (read, Recipes view) and{' '}
        <Mono>read_product_allergens</Mono> (consequential, the card pins the reading; <Mono>modules: [&apos;purchasing_setup&apos;]</Mono>, so
        the connector, the supplier price record and <Mono>what_can_i_do</Mono> offer it on Purchasing setup manage, what its run
        checks; its link is <Mono>/inventory?q=</Mono> the item&apos;s name, which the Inventory page searches). In the tab,{' '}
        <Mono>CheckDetail</Mono> is keyed by the check&apos;s fingerprint, so what is ticked starts again when the check changes.
        Reports: subject{' '}
        <Mono>recipes.allergen_checks</Mono>, the allergen fields on <Mono>purchasing.prices</Mono>, starters{' '}
        <Mono>dishes_with_allergen_differences</Mono> and <Mono>items_with_unknown_allergens</Mono>. Registry:{' '}
        <Mono>recipes.allergen_checks</Mono>; <Mono>read_product_allergens</Mono> on <Mono>purchasing.prices</Mono>. Tests:{' '}
        <Mono>shared/test/allergenCheck.test.mjs</Mono>, <Mono>api/test/allergen-checks.test.mjs</Mono>.
      </P>
      <P>
        Phase 8b: the tab&apos;s <Mono>CaloriesCard</Mono> (keyed by its fingerprint), the Changed and Calories filters
        (<Mono>&amp;changed=1</Mono>, Today&apos;s link), <Mono>RecipeCalories</Mono> in the editor&apos;s card, and purchasing&apos;s{' '}
        <Mono>EnergyForm</Mono> in <Mono>components/purchasing/units.jsx</Mono>. Reports: subject{' '}
        <Mono>recipes.calorie_checks</Mono>, Allergen checks&apos; <Mono>change</Mono> / <Mono>changed_at</Mono>, the energy
        fields on <Mono>purchasing.items</Mono>, starters <Mono>dishes_with_calorie_differences</Mono> and{' '}
        <Mono>items_with_no_energy</Mono>. Registry <Mono>recipes.calorie_checks</Mono>. Tests:{' '}
        <Mono>shared/test/calorieCheck.test.mjs</Mono>, <Mono>api/test/allergen-reopen.test.mjs</Mono>,{' '}
        <Mono>api/test/calorie-checks.test.mjs</Mono>.
      </P>
    </section>
  )
}
