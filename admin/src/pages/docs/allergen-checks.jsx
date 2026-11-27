// src/pages/docs/allergen-checks.jsx
// The Docs page's "Allergen checks" section (inventory phase 8a, migration
// 316, 27 Nov 2026). Docs.jsx gathers every file in this folder (except
// parts.jsx) and shows them by order, then id.
import { H2, H3, P, Mono, InfoBox, DataTable } from './parts.jsx'

export const id = 'allergen-checks'
export const label = 'Allergen checks'
export const order = 256.7

export function Section() {
  return (
    <section id="allergen-checks" data-doc="">
      <H2>Allergen checks</H2>
      <P>
        Inventory phase 8a (<Mono>docs/INVENTORY.md</Mono> 8.3, decision D6; migration 316, 27 Nov 2026): allergens on the
        supplier&apos;s product, a roll-up through recipes giving each dish&apos;s <em>suggested</em> allergens, and a check
        against what the dish <em>declares</em> (the menus area&apos;s data), which a person accepts or dismisses. Nothing
        changes a declaration by itself. Area: recipes (the product columns are purchasing&apos;s <Mono>inv_quotes</Mono>; the
        declaration is the menus area&apos;s, written through its own route). Phase 8b adds reopening on changes, the Today
        item and calories.
      </P>
      <H3>Tables</H3>
      <DataTable
        head={['Table / columns', 'What']}
        rows={[
          ['inv_quotes.allergens_contains, allergens_may_contain', 'text[] of STANDARD_ALLERGENS keys (shared/menuTags.js, the menus\' 14): one list, rule 12'],
          ['inv_quotes.allergens_checked_at, _by, _source', 'when someone saved them (null = unknown: a gap, never "free"), who, and where from (a note, 300 chars)'],
          ['allergen_checks', 'one row per menu dish (plain dish_id, menu_id: no foreign keys), status open | accepted | dismissed, differences jsonb, fingerprint, suggested, declared, scopes (the scope groups with evidence), gaps, complete, decided_by / _at, note, history jsonb, worked_at. RLS forced. Unique (tenant_id, dish_id).'],
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
    </section>
  )
}
