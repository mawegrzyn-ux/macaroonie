// src/pages/docs/recipes.jsx
// The Docs page's "Recipes and costing" section (inventory phase 1). Docs.jsx
// gathers every file in this folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, Mono, InfoBox } from './parts.jsx'

export const id = 'recipes'
export const label = 'Recipes and costing'
export const order = 255

export function Section() {
  return (
    <section id="recipes" data-doc="">
      <H2>Recipes and costing</H2>
      <P>
        Inventory phase 1 (<Mono>docs/INVENTORY.md</Mono> 5.1 to 5.5; migrations 298 to 301, 27 Nov 2026). Recipes
        and prep recipes, the cost engine and the Recipes page at <Mono>/recipes</Mono> (main menu under Stock,
        module <Mono>recipes</Mono>). Area notes: <Mono>docs/claude/areas/recipes.md</Mono>. Item units and yield
        are on the Inventory page (see Purchasing, Units and yield).
      </P>
      <H3>Tables</H3>
      <P>
        <Mono>recipes</Mono> (migration 300): <Mono>name</Mono>, <Mono>kind</Mono> dish | prep, <Mono>category</Mono>,{' '}
        <Mono>yield_qty</Mono> + <Mono>yield_unit</Mono> (what a prep batch makes before its loss: a standard unit or
        portion), <Mono>portions</Mono> (a dish; empty = 1), <Mono>loss_pct</Mono> (0 to under 100, prep only),{' '}
        <Mono>method</Mono>, <Mono>photo_url</Mono> (a <Mono>/uploads/</Mono> path from the media library or an
        https address), <Mono>shelf_life_hours</Mono>, <Mono>code</Mono>, <Mono>status</Mono> draft | live,{' '}
        <Mono>variant_of</Mono> (a variation: the recipe it varies, which is no variation itself; ON DELETE SET
        NULL), <Mono>notes</Mono>, <Mono>is_active</Mono>, <Mono>created_by</Mono>. <Mono>recipe_lines</Mono>:{' '}
        <Mono>recipe_id</Mono> (cascade), <Mono>sort_order</Mono>, exactly one of <Mono>item_id</Mono> (an
        inventory item) or <Mono>sub_recipe_id</Mono> (a prep recipe; never the line&apos;s own recipe), <Mono>qty</Mono>{' '}
        &gt; 0, <Mono>unit</Mono> (free text, 1 to 30: a unit the thing doesn&apos;t know is a gap, not a refusal),{' '}
        <Mono>yield_pct</Mono> (the line&apos;s own, else the item&apos;s), <Mono>note</Mono>. Both force RLS. Nothing
        stores a cost. Lines point at items and recipes with plain foreign keys: an item in a recipe is switched off
        instead of deleted, a recipe used inside another refuses deletion.
      </P>
      <H3>Modules</H3>
      <P>
        Migration 299, group <Mono>recipes</Mono> (Recipes and costing): <Mono>recipes</Mono> (View reads recipes
        and methods without costs; Manage changes them; owner and admin manage, operator view, viewer none) and{' '}
        <Mono>costing</Mono> (View shows costs; Manage is for targets and scenarios later; owner and admin manage,
        others none). Custom roles got recipes View, and costing View only where they had Purchasing setup View or
        Manage. A cost tells what suppliers charge, so every money field (routes, reports, Pepper) needs costing
        View; the supplier, pack and pack price inside the explanation also need purchasing prices{' '}
        (<Mono>seesPurchasingPrices()</Mono>).
      </P>
      <H3>The cost engine: shared/costing.js</H3>
      <P>
        Plain ESM, no database, one implementation for the API, reports and Pepper (the page shows what the API
        returns). <Mono>toBase(qty, unit, item)</Mono>: a standard unit of the item&apos;s kind by its factor, else
        the item&apos;s own unit of that name, else <Mono>{'{ base: null, problem }'}</Mono> named (&ldquo;Cheddar
        has no size for a tbsp&rdquo;). <Mono>itemCost(item, venueId, data, basis)</Mono>: <Mono>standard</Mono> is{' '}
        <Mono>chooseQuote()</Mono>&apos;s quote at <Mono>quotePrice()</Mono> for the venue over its{' '}
        <Mono>pack_base_qty</Mono>; <Mono>last</Mono> the latest received line at the venue (<Mono>invoice_price</Mono>,
        else <Mono>price</Mono>, per pack); <Mono>average</Mono> the received lines of the last{' '}
        <Mono>AVERAGE_DAYS</Mono> (90) weighted by quantity (only older ones: <Mono>no_recent</Mono>, not{' '}
        <Mono>no_receipts</Mono>); a received line whose <Mono>base_unit</Mono> isn&apos;t the item&apos;s is left out
        (its pack size is in the old unit); usable cost = cost / (yield / 100), never cost x (1 + waste). <Mono>recipeCost(recipe, ctx)</Mono> returns <Mono>{'{ cost, per_unit, unit, makes, lines, gaps, coverage, complete }'}</Mono>:
        a line&apos;s cost is <Mono>toBase()</Mono> / yield x cost per base unit; a prep recipe inside is costed by its
        own <Mono>per_unit</Mono> (total / (yield_qty x (1 - loss))) with the line converted by{' '}
        <Mono>inRecipeUnit()</Mono>; a dish is total / portions. Lines that can&apos;t be costed are left out and
        listed as gaps with a reason (<Mono>no_price</Mono>, <Mono>no_receipts</Mono>, <Mono>no_recent</Mono>, <Mono>no_unit</Mono>,{' '}
        <Mono>missing</Mono>, <Mono>empty</Mono>, <Mono>no_yield</Mono>, <Mono>sub_partial</Mono>, <Mono>cycle</Mono>,{' '}
        <Mono>too_deep</Mono>), the words and how to fix it; coverage is full, partial or none. Results are
        remembered per request by recipe, venue and basis (<Mono>ctx._memo</Mono>), and only for the ctx&apos;s own
        recipe object: an edited copy with the same id (a draft) is costed afresh. <Mono>explain()</Mono> gives
        rows <Mono>{'{ kind, label, steps, amount }'}</Mono> and the same as text; <Mono>nestingProblem()</Mono>{' '}
        refuses a recipe inside itself (with the path) or a chain deeper than <Mono>MAX_DEPTH</Mono> (5);{' '}
        <Mono>margin({'{ gross_pence, vat_rate, cost }'})</Mono> is where pence meet pounds: net = gross -{' '}
        <Mono>vatIncluded()</Mono>, GP = net - cost, cost % = cost / net; the cost is rounded to the penny once and
        GP is net less it, GP % is 100 less cost %, so the parts always add up (phase 2 uses it). Tests:{' '}
        <Mono>shared/test/costing.test.mjs</Mono>.
      </P>
      <H3>Loading: services/costingSvc.js</H3>
      <P>
        <Mono>loadRecipes()</Mono> (every recipe with its lines), <Mono>loadCostItems()</Mono> (items with their own
        units, no prices), <Mono>loadReceipts()</Mono> (received lines of the window plus each venue&apos;s latest
        per item, only lines whose <Mono>base_unit</Mono> is the item&apos;s as it is now) and <Mono>loadCosting(tx, tenantId, venueId, {'{ basis, recipes }'})</Mono>, which reads them once
        with <Mono>loadItemQuotes()</Mono> and <Mono>loadPreferred()</Mono> into the ctx the engine takes.{' '}
        <Mono>recipeView()</Mono> puts the engine&apos;s answer on a recipe, money only with costs.
      </P>
      <H3>Routes: /api/recipes</H3>
      <P>
        <Mono>routes/recipes.js</Mono>, registered by <Mono>api/src/areas/recipes.js</Mono>. Reading needs recipes
        View, changing recipes Manage. <Mono>GET /</Mono> <Mono>?venue_id &amp;basis &amp;kind &amp;q &amp;active=on|off|all</Mono>{' '}
        (each with coverage and gap count; <Mono>cost</Mono> and <Mono>per_unit</Mono> for costing View; counts by
        coverage; <Mono>can</Mono>); <Mono>GET /pickers</Mono> (items with <Mono>unit_choices</Mono>, prep recipes,
        recipes a variation may vary, categories, yield units); <Mono>GET /:recipeId</Mono> (lines with their item or
        prep recipe, gaps, <Mono>used_in</Mono>, <Mono>variations</Mono>; with costs <Mono>bases</Mono> (each basis&apos;s
        per unit) and <Mono>explanation</Mono>); <Mono>POST /preview</Mono> (a draft&apos;s cost, nothing written; a
        loop comes back as <Mono>nesting</Mono>); <Mono>POST /</Mono>; <Mono>PUT /:recipeId</Mono> (the whole
        recipe: every field required, lines replaced, rule 13); <Mono>POST /:recipeId/copy</Mono>{' '}
        <Mono>{'{ name?, variant? }'}</Mono> (a draft; a variation goes on the original&apos;s group);{' '}
        <Mono>PATCH /:recipeId/active</Mono>; <Mono>DELETE /:recipeId</Mono> (409 <Mono>in_use</Mono> while inside
        another recipe). Saves check every item, prep recipe and variation is the group&apos;s (404), only prep recipes
        go inside others (422 <Mono>not_prep</Mono>), a dish used inside another stays prep, and{' '}
        <Mono>nestingProblem()</Mono> (422 <Mono>recipe_cycle</Mono> / <Mono>recipe_depth</Mono> with{' '}
        <Mono>path</Mono>). Create, save and copy take <Mono>lockRecipes()</Mono> first (a transaction advisory lock
        per group), so two saves at once can&apos;t each pass the check against the other&apos;s old lines and write a
        loop. A venue in the query must be the group&apos;s (<Mono>loadVenue()</Mono>, 404).
      </P>
      <H3>Admin</H3>
      <P>
        <Mono>pages/Recipes.jsx</Mono> (lazy, <Mono>admin/src/routes/recipes.jsx</Mono>; address{' '}
        <Mono>?recipe= &amp;venue= &amp;basis=</Mono>, and <Mono>?q=</Mono> to start the list&apos;s search), <Mono>components/recipes/RecipeEditor.jsx</Mono> (the lines,
        details and method cards, each with its own Save sending the whole recipe through <Mono>saveBody()</Mono>;
        the live cost from <Mono>POST /preview</Mono> 350 ms after a change; <Mono>CostCard</Mono>,{' '}
        <Mono>UsedCard</Mono>), <Mono>components/recipes/shared.jsx</Mono> (<Mono>CostAt</Mono>, badges,{' '}
        <Mono>usePickers()</Mono>). Menu record <Mono>shared/nav/recipes.js</Mono>; migration 301 put the link after
        Purchasing in saved menus.
      </P>
      <H3>Reports and Pepper</H3>
      <P>
        <Mono>api/src/reports/catalogue/recipes.js</Mono> (heading Recipes and costing): <Mono>recipes.recipes</Mono>,{' '}
        <Mono>recipes.lines</Mono> (module recipes) and <Mono>recipes.costs</Mono> (module costing, the work{' '}
        <Mono>recipe_costs</Mono> in <Mono>reports/work/recipes.js</Mono>: every recipe at each venue of the report
        by <Mono>loadCosting()</Mono> and <Mono>recipeCost()</Mono> at standard prices; the measure{' '}
        <Mono>average_portion_cost</Mono> averages dishes only, as a prep&apos;s cost is per litre, kg or each;{' '}
        <Mono>recipes.lines.what</Mono> answers to ingredient). Starters in{' '}
        <Mono>starters/recipes.js</Mono>: Recipes not fully costed, Recipe cost by venue. Pepper:{' '}
        <Mono>api/src/ai/tools/recipes.js</Mono>, <Mono>find_recipes</Mono> and <Mono>recipe</Mono> (read only,
        through the routes, by name; a recipe&apos;s link is <Mono>/recipes?q=</Mono> its name, no id, rule 19); registry <Mono>shared/registry/recipes.js</Mono> (<Mono>recipes.recipes</Mono>).
      </P>
      <InfoBox type="info">
        Not yet: links from recipes to menu dishes and options, the variation matrix per venue, revenue stream and
        order type, menu margins, recipes read by Pepper, stock. They are the later phases of{' '}
        <Mono>docs/INVENTORY.md</Mono>; what is left is in <Mono>docs/claude/outstanding/recipes.md</Mono>.
      </InfoBox>
    </section>
  )
}
