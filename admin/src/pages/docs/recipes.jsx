// src/pages/docs/recipes.jsx
// The Docs page's "Recipes and costing" section (inventory phases 1 to 3). Docs.jsx
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
        go inside others (422 <Mono>not_prep</Mono>), a recipe used inside another or added by an option rule
        stays prep (422 <Mono>in_use</Mono>), one that <Mono>recipe_links</Mono> or an &ldquo;is a recipe&rdquo;
        rule names stays a dish (422 <Mono>linked</Mono>, with <Mono>dishes</Mono> and <Mono>rules</Mono>), and{' '}
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
      <H3>Phase 2: what is sold, linked (migrations 302, 303)</H3>
      <P>
        <Mono>recipe_links</Mono>: <Mono>dish_id</Mono> (a <Mono>menu_items.id</Mono>, plain: the menu save deletes and
        re-inserts dishes under the same ids), <Mono>recipe_id</Mono> (a dish recipe, cascade), <Mono>portions</Mono>{' '}
        (&gt; 0, default 1), the scope <Mono>venue_id</Mono>, <Mono>revenue_stream_id</Mono>, <Mono>order_type_id</Mono>{' '}
        (each empty = any; a stream link stores its stream&apos;s venue, CHECK stream needs venue, the API refuses another
        venue: 422 <Mono>stream_venue</Mono>), <Mono>missing_since</Mono>, <Mono>created_by</Mono>. Unique per dish and
        scope (<Mono>COALESCE</Mono> to the zero uuid). <Mono>recipe_option_rules</Mono>: <Mono>option_id</Mono> (a{' '}
        <Mono>menu_variant_options.id</Mono>, plain) or, for a dish&apos;s own one-off option, <Mono>dish_id</Mono> +{' '}
        <Mono>option_label</Mono> (as sales name it, <Mono>v:&lt;label&gt;</Mono>); <Mono>dish_id</Mono> with an option
        is that dish&apos;s exception; <Mono>action</Mono> add | remove | swap | scale | recipe | nothing with{' '}
        <Mono>item_id</Mono> or <Mono>sub_recipe_id</Mono> + <Mono>qty</Mono> + <Mono>unit</Mono> (add),{' '}
        <Mono>item_id</Mono> (remove), <Mono>item_id</Mono> + <Mono>swap_item_id</Mono> (+ optional <Mono>qty</Mono>,{' '}
        <Mono>unit</Mono>) (swap), <Mono>factor</Mono> (scale, up to 20), <Mono>recipe_id</Mono> (a dish recipe, qty =
        portions); <Mono>missing_since</Mono> for dish rules; unique per option and dish, and per dish and lower(label).{' '}
        <Mono>costing_settings</Mono> (one row per tenant, optional): <Mono>target_pct</Mono>, <Mono>limit_pct</Mono>{' '}
        (defaults 30 and 35, target &lt;= limit), <Mono>sections</Mono> jsonb{' '}
        <Mono>{'[{ section_id, target_pct, limit_pct }]'}</Mono>. All three force RLS. Migration 303 puts Menu margins
        after Recipes in saved menus (record in <Mono>shared/nav/recipes.js</Mono>, module costing).
      </P>
      <H3>The engine, phase 2</H3>
      <P>
        <Mono>recipeFor(dishId, scope, links, {'{ names }'})</Mono> returns <Mono>{'{ link, why, score }'}</Mono>: a link
        applies when every scope it sets is the sale&apos;s, and the closest wins, scored as <Mono>taxFor()</Mono> scores a
        tax rule (<Mono>RULE_WEIGHTS</Mono>: stream 4, order type 2, venue 1; a stream link&apos;s venue adds nothing), so
        a dish&apos;s recipe and its VAT never disagree on which setting is closer; <Mono>why</Mono> is{' '}
        <Mono>scopeText()</Mono> (&ldquo;Take out at Bar (Soho)&rdquo;, &ldquo;every venue&rdquo;).{' '}
        <Mono>ruleFor(dishId, option, rules)</Mono> (the dish&apos;s exception, else the option&apos;s),{' '}
        <Mono>ruleText()</Mono>, <Mono>ruleProblem()</Mono>. <Mono>dishCost(dishId, {'{ options, picks }'}, scope, ctx)</Mono>:
        the picked recipe&apos;s lines times portions / what it makes, then each option: add (a one-line recipe costed
        by <Mono>recipeCost()</Mono>), remove, swap, scale (the recipe&apos;s lines only), recipe (a portion of its own
        recipe), nothing; prefixes (<Mono>PREFIX_FACTORS</Mono>: No 0, Light 0.5, Extra 2, On the side 1) act on the
        recipe&apos;s lines of the option&apos;s item when it has them, else on what the option adds; an option with no rule
        finds its lines by name for a prefix, and otherwise follows its group&apos;s <Mono>variation_type</Mono>{' '}
        through <Mono>optionDefault(option)</Mono> (<Mono>{'{ state, type, text }'}</Mono>: addition and side a gap;
        modification nothing; no type nothing unless it is a priced extra; a dish&apos;s own option nothing), the one
        rule the Options tab&apos;s <Mono>state</Mono>, the matrix&apos;s and the cost all read. A link or an
        &ldquo;is a recipe&rdquo; rule naming a prep recipe is a <Mono>not_dish</Mono> gap, never a unit of the batch
        as a portion. Steps carry <Mono>plain</Mono> (the words without money) where <Mono>text</Mono> has some;
        the cost route sends <Mono>plain</Mono> to people without Costing view. A meal deal sums its picks (a list,
        a till line&apos;s combo parts with <Mono>modifiers</Mono>, or a basket&apos;s <Mono>combo</Mono> with{' '}
        <Mono>choices</Mono>), or gives <Mono>min</Mono> / <Mono>max</Mono> over its steps&apos; choices
        (<Mono>stepChoices()</Mono>; a step with a condition adds nothing to the least); <Mono>typical</Mono> is the cost at
        <Mono>typicalPicks()</Mono> (phase 5: each step&apos;s most sold dish from <Mono>ctx.pickMix</Mono>, else its first
        choice; <Mono>typical_picks</Mono>). Goods with no link offer the inventory item with the same barcode
        (<Mono>goods_item</Mono>); a service is <Mono>not_needed</Mono>, never a gap.{' '}
        <Mono>dishMargin()</Mono> / <Mono>menuMargins(menu, scope, ctx, {'{ rates, settings }'})</Mono>: price by{' '}
        <Mono>fromPrice()</Mono> (the till and online price: one price per dish on a menu), VAT by{' '}
        <Mono>taxFor([dish, section, menu], scope)</Mono>, <Mono>margin()</Mono>, band by <Mono>costBand()</Mono> against{' '}
        <Mono>thresholdsFor(settings, sectionId)</Mono>; priced options (an extra&apos;s added cost; a base option&apos;s
        whole dish); a deal&apos;s range by <Mono>dealRange(parts, basePence, vat)</Mono>: each end over what its own
        picks sell for (the deal&apos;s price before extra charges plus those picks&apos; <Mono>price_pence</Mono>), the
        cost % extremes by Dinkelbach&apos;s method over the steps&apos; picks, GP by the picks that do least and most;
        banded at its highest cost % (<Mono>range</Mono> names the picks). <Mono>marginSteps()</Mono> words the
        price and VAT. Tests:{' '}
        <Mono>shared/test/dishCost.test.mjs</Mono>.
      </P>
      <H3>Phase 2 routes</H3>
      <P>
        Loaders: <Mono>services/dishCostSvc.js</Mono> (public): <Mono>loadLinks()</Mono>, <Mono>loadOptionRules()</Mono>,{' '}
        <Mono>loadOptionLibrary()</Mono>, <Mono>loadScopes()</Mono>, <Mono>loadCostingSettings()</Mono>,{' '}
        <Mono>goodsIndex()</Mono>, <Mono>loadDishCosting()</Mono> (<Mono>loadCosting()</Mono> with the items rules name),{' '}
        <Mono>menusFor()</Mono> (<Mono>loadMenuVersions()</Mono>), <Mono>dishIdsOnMenus()</Mono> (draft or live),{' '}
        <Mono>copyRecipeLinks()</Mono> (menus&apos; <Mono>POST /:id/duplicate</Mono>: links, dish rules, section
        targets onto the new ids), <Mono>sweepRecipeLinks()</Mono>. <Mono>/api/recipe-links</Mono>{' '}
        (<Mono>routes/recipeLinks.js</Mono>; Recipes view, changes Recipes manage, money Costing view):{' '}
        <Mono>GET /dishes</Mono> (the Dishes tab, with matches by <Mono>matchThing()</Mono>, goods offers, links on no
        menu), <Mono>GET /dishes/:dishId</Mono> (rows, columns, each cell&apos;s recipe set or inherited with{' '}
        <Mono>from</Mono>, cost and margin, the dish&apos;s options), <Mono>PUT /dishes/:dishId/cell</Mono>,{' '}
        <Mono>DELETE /links/:recipeLinkId</Mono>, <Mono>POST /bulk</Mono>, <Mono>POST /goods</Mono> (a one-line recipe of
        the item, 1 each, under <Mono>lockRecipes()</Mono>), <Mono>GET /recipes/:recipeId</Mono> (its links, and{' '}
        <Mono>rules</Mono>: how many option rules name it), <Mono>GET /names</Mono> (every dish on a menu, draft or
        live, by name with its options as <Mono>dishCost()</Mono> takes them; Recipes or Costing view, for Pepper),{' '}
        <Mono>GET /dishes/:dishId/cost</Mono> <Mono>?venue_id &amp;revenue_stream_id &amp;order_type_id &amp;version &amp;options</Mono>{' '}
        (Recipes or Costing view). <Mono>/api/recipe-options</Mono> (<Mono>routes/recipeOptions.js</Mono>):{' '}
        <Mono>GET /</Mono>, <Mono>GET /options/:optionId</Mono>, <Mono>PUT /rules</Mono> (strict: every field, rule
        13), <Mono>DELETE /rules/:optionRuleId</Mono>. <Mono>/api/menu-margins</Mono> (<Mono>routes/menuMargins.js</Mono>,
        Costing view): <Mono>GET /</Mono> <Mono>?menu_id &amp;venue_id &amp;revenue_stream_id &amp;order_type_id &amp;version</Mono>{' '}
        (live by default through <Mono>loadMenuVersion()</Mono>), <Mono>GET /settings</Mono>, <Mono>PUT /settings</Mono>{' '}
        (Costing manage, whole). Every id is checked to be the group&apos;s (rule 4). The job{' '}
        <Mono>jobs/recipe-links.js</Mono> (daily, system mode, each tenant in its own transaction): marks links and dish
        rules whose dish is on no menu, clears those that are back, deletes what has been missing 30 days.
      </P>
      <H3>Phase 2 admin, reports and Pepper</H3>
      <P>
        <Mono>pages/Recipes.jsx</Mono> tabs <Mono>?tab=dishes</Mono> (<Mono>components/recipes/DishList.jsx</Mono>;{' '}
        <Mono>?dish=</Mono> opens <Mono>DishMatrix.jsx</Mono>, a grid inside its card from 640 px and a list per venue
        below) and <Mono>?tab=options</Mono> (<Mono>OptionRules.jsx</Mono>: <Mono>OptionList</Mono>,{' '}
        <Mono>OptionEditor</Mono>, <Mono>RuleForm</Mono>, <Mono>RuleModal</Mono>); the editor&apos;s{' '}
        <Mono>MenusCard</Mono> (Used on menus, Link a dish). <Mono>pages/MenuMargins.jsx</Mono> (<Mono>/menu-margins</Mono>,
        lazy; <Mono>?menu= &amp;venue= &amp;stream= &amp;type= &amp;version= &amp;dish=</Mono>; CSV made in the page from the
        rows). Reports: <Mono>recipes.links</Mono> (module recipes) and <Mono>recipes.margins</Mono> (the work{' '}
        <Mono>dish_margins</Mono>: each live menu dish at each venue and active order type by <Mono>menuMargins()</Mono>;
        module costing; a row opens <Mono>/menu-margins</Mono> at its menu, venue and order type), starters Dishes
        over the target cost % and Dishes with no recipe. Pepper: <Mono>dish_cost</Mono> (Recipes or Costing view:
        finds the dish through <Mono>GET /names</Mono>, then the cost route) and <Mono>menu_margins</Mono> (read,
        through the routes, by names). Registry:{' '}
        <Mono>recipes.links</Mono>, <Mono>recipes.option_rules</Mono>, <Mono>recipes.margins</Mono>.
      </P>
      <H3>Phase 3: recipes read in, drafts, coverage by sales (migration 304)</H3>
      <P>
        <Mono>recipes.source</Mono> (migration 304): <Mono>reader</Mono> (read in from a file or text) |{' '}
        <Mono>pepper</Mono> (Pepper&apos;s <Mono>make_recipe</Mono>) | null (made on the page, copied, a goods recipe).
        Kept when the recipe goes live. <Mono>needsCheck(r)</Mono> in <Mono>shared/costing.js</Mono> is{' '}
        <Mono>status = draft</Mono> with a source: <Mono>recipeCost()</Mono> then adds the gap <Mono>draft</Mono>
        (&ldquo;not checked yet&rdquo;, line null), so the recipe, every recipe it sits inside and every dish linked to it
        are partly costed until it is made live. A draft with no source (a variation, a copy) is costed as before. A copy
        of an unchecked draft keeps its source.
      </P>
      <P>
        The reader: <Mono>services/recipeReadAi.js</Mono> (<Mono>readRecipes()</Mono>, <Mono>toRecipes()</Mono>,{' '}
        <Mono>RECIPE_SCHEMA</Mono>, one <Mono>askForJson()</Mono> call, use <Mono>recipe_reader</Mono>): items go to the
        model as <Mono>i1</Mono>... (name, code, kept in and own units; up to 800), prep recipes as <Mono>r1</Mono>... (up
        to 300), a prep recipe of the same reading is <Mono>n1</Mono>... (its place in the answer). In code: a ref is
        checked against the list sent (anything else is dropped), lines without one go through{' '}
        <Mono>matchThing()</Mono> against every active item and prep recipe, listed or not (code, then name: auto is
        matched, 0.6 and up suggested, else not found), units through <Mono>toBase()</Mono> /{' '}
        <Mono>inRecipeUnit()</Mono> (<Mono>unit_problem</Mono>), quantities through <Mono>qtyOf()</Mono> (fractions,
        &frac12;; a comma is a decimal point only before one or two figures or after a lone 0, else a thousands
        separator). The answer carries <Mono>items_listed</Mono> / <Mono>items_total</Mono> and{' '}
        <Mono>preps_listed</Mono> / <Mono>preps_total</Mono>. Which read lines become draft lines is{' '}
        <Mono>readLineKept()</Mono> in <Mono>shared/costing.js</Mono> (the review&apos;s <Mono>draftsBody()</Mono> and
        Pepper&apos;s <Mono>draftsFromReading()</Mono>); <Mono>draftNotes()</Mono> keeps whole unmatched lines in the
        2,000 characters and counts the ones that didn&apos;t fit. <Mono>suggestYield()</Mono>: the fast model, use{' '}
        <Mono>yield_suggestion</Mono>.
      </P>
      <P>
        Routes: <Mono>routes/recipeRead.js</Mono> at <Mono>/api/ai/recipes</Mono> (registered in{' '}
        <Mono>areas/recipes.js</Mono>): <Mono>POST /read</Mono> <Mono>{'{ files: [{ name, data }], text, hint }'}</Mono>{' '}
        (Recipes manage + Pepper; photos and PDFs by their first bytes, Excel or CSV read to rows by{' '}
        <Mono>sheetRead.js</Mono>, up to 10 files, 20 MB, 60,000 characters of text; nothing saved) and{' '}
        <Mono>POST /yield</Mono> <Mono>{'{ item_id | name }'}</Mono> (Purchasing setup or Recipes manage + Pepper; nothing
        saved). <Mono>POST /api/recipes/drafts</Mono> <Mono>{'{ source, recipes: [{ key, name, kind, ..., lines, left_out }] }'}</Mono>{' '}
        (Recipes manage; <Mono>makeDrafts()</Mono>: one transaction under <Mono>lockRecipes()</Mono>, a line is an item, a
        prep recipe or <Mono>new_key</Mono> (a prep recipe of the same request, made first; a loop is 422{' '}
        <Mono>recipe_cycle</Mono>), each checked by <Mono>checkRecipe()</Mono>; <Mono>left_out</Mono> goes into the notes as
        &ldquo;Read but not matched&rdquo;). <Mono>POST /api/recipe-links/dishes/:dishId/recipe</Mono> (a draft dish recipe
        for the dish, linked for every venue when it has none; 422 for a deal or a service).
      </P>
      <P>
        Coverage by sales: <Mono>salesCoverage(rows, ctxFor)</Mono>, <Mono>soldState()</Mono>, <Mono>optionGaps()</Mono>{' '}
        (from <Mono>offeredOptions()</Mono>, the matrix&apos;s rule too; a meal deal&apos;s typed-in choice is a{' '}
        <Mono>deal</Mono> fix),{' '}
        <Mono>costedShare()</Mono> in <Mono>shared/costing.js</Mono>: a dish sold at its venue, stream and order type is
        costed when <Mono>dishCost()</Mono> there has no gaps and no option it offers needs a rule; the share is{' '}
        <Mono>coverageShare()</Mono> (<Mono>shared/itemMapping.js</Mono>), services, dishes on no menu and our own
        till, kiosk or online lines with no dish (open items, <Mono>reason: 'open'</Mono>) left out; only another
        till&apos;s line with no dish is not costed, with the <Mono>map</Mono> fix. Sales:{' '}
        <Mono>services/recipeCoverageSvc.js</Mono> <Mono>loadSold()</Mono> (closed till checks, lines not voided,{' '}
        <Mono>NOT is_generated</Mono>; a kiosk device as server is the kiosk channel; online orders in{' '}
        <Mono>OWN_COUNTED</Mono>, line total less discount; another till&apos;s item lines not ignored, by the main
        part&apos;s dish or by name), <Mono>coverageCtx()</Mono> (every menu, draft over live, deals&apos; choices).{' '}
        <Mono>GET /api/recipes/coverage</Mono> <Mono>?venue_id &amp;days</Mono> (Recipes view; pence only with till reports
        view, as the report subject&apos;s sales fields, else each dish&apos;s <Mono>share_pct</Mono>; the last{' '}
        <Mono>days</Mono> up to yesterday, as a report&apos;s Last 30 days).
      </P>
      <P>
        Admin: <Mono>components/recipes/Coverage.jsx</Mono> (<Mono>CoverageCard</Mono> on the Recipes tab),{' '}
        <Mono>RecipeReader.jsx</Mono> (lazy, <Mono>?read=1</Mono>: files, <Mono>photoCapture()</Mono> on phones,
        pasted text; the review with <Mono>draftsBody()</Mono>), <Mono>RecipeEditor.jsx</Mono> <Mono>NewForDish</Mono>{' '}
        (<Mono>?recipe=new&amp;for_dish=</Mono>), Make a recipe for this dish on <Mono>DishList.jsx</Mono> and{' '}
        <Mono>DishMatrix.jsx</Mono>, <Mono>YieldSuggestion</Mono> in <Mono>components/purchasing/units.jsx</Mono>.
        Reports: <Mono>recipes.coverage</Mono> (the work <Mono>recipe_coverage</Mono>: a row per dish sold on a day at a
        venue, stream, order type and channel in the period, last 30 days without one; the sales field needs till
        reports view), starter Uncosted dishes by sales. Pepper: <Mono>read_recipes</Mono> (consequential; the card pins
        the reading), <Mono>make_recipe</Mono> (consequential), <Mono>link_recipes</Mono> (reversible, Undo puts each
        cell back), <Mono>recipe_coverage</Mono> (read); the plain form <Mono>recipe</Mono> (<Mono>forms/recipes.js</Mono>,
        the route&apos;s <Mono>RecipeNewBody</Mono>). Evaluation: <Mono>api/eval/tasks/recipes.mjs</Mono> (9 tasks;{' '}
        <Mono>--only=recipes</Mono>).
      </P>
      <InfoBox type="info">
        Phase 5 (27 Nov 2026) built usage from sales on the same walk: <Mono>usageOf()</Mono>, <Mono>recipeUsage()</Mono>,
        <Mono>matchOptions()</Mono>, <Mono>typicalPicks()</Mono>, <Mono>pickMix()</Mono> and <Mono>soldMargins()</Mono> in{' '}
        <Mono>shared/costing.js</Mono>; <Mono>dishCost()</Mono>&apos;s lines carry <Mono>bought</Mono>; the recipe, link
        and option rule routes mark usage days on change (<Mono>marksUsageOnChange()</Mono>); Menu margins&apos; Sold
        tab (<Mono>GET /api/menu-margins/sold</Mono>, <Mono>components/recipes/SoldMargins.jsx</Mono>); the Stock
        section has the rest. Not yet: engineering and scenarios. They are the later phases of <Mono>docs/INVENTORY.md</Mono>; what is left is in{' '}
        <Mono>docs/claude/outstanding/recipes.md</Mono>.
      </InfoBox>
    </section>
  )
}
