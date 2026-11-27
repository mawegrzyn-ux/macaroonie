// src/pages/docs/menu-engineering.jsx
// The Docs page's "Menu engineering and scenarios" section (inventory phase
// 7a, migration 314, 27 Nov 2026). Docs.jsx gathers every file in this folder
// (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, Mono, InfoBox, DataTable } from './parts.jsx'

export const id = 'menu-engineering'
export const label = 'Menu engineering and scenarios'
export const order = 256

export function Section() {
  return (
    <section id="menu-engineering" data-doc="">
      <H2>Menu engineering and scenarios</H2>
      <P>
        Inventory phase 7a (<Mono>docs/INVENTORY.md</Mono> 8.2, 10.4; migration 314, 27 Nov 2026): Menu margins&apos;
        Engineering and Scenarios tabs (<Mono>/menu-margins?tab=engineering</Mono>, <Mono>?tab=scenarios</Mono>,{' '}
        <Mono>&amp;scenario=</Mono> opens one), Push prices into a menu&apos;s draft, Pepper&apos;s{' '}
        <Mono>menu_engineering</Mono> and <Mono>save_scenario</Mono>, the report subjects. Area: recipes
        (<Mono>docs/claude/areas/recipes.md</Mono>). Price creep, cost alerts and <Mono>why_cost_changed</Mono> are
        phase 7b (Price creep and cost alerts, the next section).
      </P>
      <H3>The rules (shared, rule 12)</H3>
      <DataTable
        head={['File', 'What it holds']}
        rows={[
          ['shared/engineering.js', 'engineer(rows, { names }): Kasavana and Smith per menu section over dish_cost_days rows; popular = units x n >= 0.7 x section units; profitable = GP per unit >= section GP / section costed units (weighted by units); classes star | plough_horse | puzzle | dog, null when no unit was costed. A row with any unit not costed (cost null or uncosted_qty > 0) is left out of GP and counted for popularity. Left out: rows with left_out, no dish or no section. CLASSES (labels, hints, suggestions), classWords(), averageText() (a section\'s average GP per unit in words, a gap when no unit was costed, never £0.00), withoutSales() and ENGINEERING_SALES_FIELDS.'],
          ['shared/scenarios.js', 'changedPrice() (percent, amount in pounds, set; round_to 1 | 5 | 10 | 50 | 100 pence, up | nearest | down; also Pepper\'s change_prices), changedCost(), changeProblem(), changeApplies(), changeWords(), applyPrices(item, sectionId, changes) (the dish\'s price_pence, its base options with a price as its own overrides, priced one-off variants; extras untouched; set refused on a dish priced by its options), scenarioFigures(menu, scope, ctx, { rates, settings, changes, units }), pushPrices(full, changes), priceStamp(), scenarioCsvRows(), scenarioCsv() (the Export CSV text: a text cell starting with = + - @ gets a leading quote, plain numbers stay).'],
          ['shared/costing.js', 'dealTypical(item, scope, ctx, mctx): a meal deal at its typical picks (typicalPicks()) with what those picks add to the bill, so its cost is paired with its price.'],
        ]}
      />
      <P>
        A meal deal rung up as a deal is one dish of its own section in engineering (<Mono>dish_cost_days</Mono> keeps
        its picks&apos; cost on the deal&apos;s row; the picked dishes have no rows of their own). An automatic deal
        (combo mode <Mono>auto</Mono>) found among dishes rung up one by one is a promotion over separate lines
        (<Mono>autoCombosFor()</Mono> in <Mono>shared/pos/offers.js</Mono>, <Mono>findAutoCombos()</Mono> online): each
        dish keeps its own row in its own section, at its net after the saving, and the deal has none;{' '}
        <Mono>engineeringFor()</Mono> lists the menus&apos; automatic deals as <Mono>auto_deals</Mono> so the tab and
        Pepper say so. In a scenario its cost is its typical picks&apos;, and a cost change reaches it only through its
        picks (a change for every dish is never applied twice; one naming the deal itself, or its own section, is said
        in <Mono>skipped</Mono>). Weighted figures compare the same dishes on both sides: a
        dish with no cost or no price before or after is left out of both (<Mono>left_out</Mono> with its units). Pence
        meet pounds only in <Mono>margin()</Mono>.
      </P>
      <H3>Table</H3>
      <P>
        <Mono>cost_scenarios</Mono> (migration 314, RLS forced): <Mono>name</Mono>, <Mono>menu_id</Mono> (cascade),{' '}
        <Mono>venue_id</Mono>, <Mono>revenue_stream_id</Mono> (needs a venue), <Mono>order_type_id</Mono> (each
        cascade, empty = the group&apos;s prices / any), <Mono>mix_days</Mono> 1 to 93 (28), <Mono>changes</Mono> jsonb{' '}
        <Mono>[{'{'} what, applies, section_id, dish_id, how, value, round_to, round {'}'}]</Mono> in order (section and
        dish ids plain: the menu save re-inserts dishes under the same ids), <Mono>notes</Mono>, <Mono>created_by</Mono>,{' '}
        <Mono>updated_by</Mono>, <Mono>pushed_at</Mono>, <Mono>pushed_by</Mono>, timestamps.
      </P>
      <H3>Routes</H3>
      <DataTable
        head={['Route', 'Needs', 'What']}
        rows={[
          ['GET /api/menu-margins/engineering ?venue_id &menu_id &from &to | &days', 'Costing view', 'engineeringFor() (services/menuEngineeringSvc.js) over dish_cost_days: sections with menu_id and menu, total, left_out, auto_deals ([{ name, menu }], the automatic deals on the menus engineered), classes, worked_out_at. Without till reports view (pos_reports) withoutSales(): no GP, net, cost %, classes. Default the last 28 days to yesterday, up to 93 days.'],
          ['GET /api/cost-scenarios', 'Costing view', 'The group\'s scenarios with names, newest first.'],
          ['POST /api/cost-scenarios/preview', 'Costing view', 'An unsaved scenario\'s figures (the builder; nothing written).'],
          ['GET /api/cost-scenarios/:id', 'Costing view', 'The scenario, scenarioView(): figures on the menu\'s draft, the mix (units from dish_cost_days over the last mix_days to yesterday, at the venue, stream and order type when named, left_out rows out), the words. Net and GP at the mix need till reports view.'],
          ['POST /api/cost-scenarios, PUT /:id', 'Costing manage', 'The whole scenario (ScenarioBody, strict: every field, rule 13). checkBody(): menu, venue, stream (its venue\'s), order type, each change\'s section and dish on the menu\'s draft.'],
          ['POST /:id/copy, DELETE /:id', 'Costing manage', 'A copy named "(copy)"; delete.'],
          ['POST /:id/push/preview', 'Costing manage + Menus manage', 'pushPrices() on GET /api/menus/:id (called in-process as the person): every price that changes, skipped words, sold_at (the menu\'s venue or every venue, the revenue streams whose menu_ids hold it), unpublished (publishStatus()), stamp, publish_page.'],
          ['POST /:id/push { stamp }', 'Costing manage + Menus manage', 'The same plan again; 409 when its stamp differs (the draft changed), 422 with nothing to change; then the whole-tree PATCH /api/menus/:id with menuSaveBody() as the person (Menus manage checked again); pushed_at. Never publishes.'],
        ]}
      />
      <InfoBox type="warning">
        Push prices writes the menu&apos;s draft only, through the menus area&apos;s own routes and the whole-tree save
        with every field; a release is made only by publishing. A price lives on the dish of a menu (one price at every
        venue, stream and order type; only the VAT differs): a dish priced by its options gets those options&apos;
        prices as its own (<Mono>menu_item_variant_prices</Mono>), never the library option&apos;s.
      </InfoBox>
      <H3>Pepper</H3>
      <P>
        <Mono>menu_engineering</Mono> (read, Costing view; <Mono>api/src/ai/tools/recipes.js</Mono>): menu, section,
        venue, days by name; a section&apos;s classes as names, GP per unit, what to do; through the route, so the same
        sales rule. <Mono>save_scenario</Mono> (consequential, confirm): changes by dish or section name, resolved on the
        menu&apos;s draft through <Mono>POST /api/cost-scenarios/preview</Mono>; the card shows the changes in words and
        the cost % (and GP with till reports view) at the mix; <Mono>replace</Mono> changes the same-named scenario on
        that menu, starting from the saved one (<Mono>GET /api/cost-scenarios/:id</Mono>, rule 13): its changes become
        the new ones, its venue, stream, order type, days and notes stay unless given, and the card lists what else
        changes. A section with no costed unit has <Mono>average_gp_per_unit</Mono> &quot;not costed&quot;, never
        £0.00. Activity words in <Mono>shared/pepperActions.js</Mono>, registry object{' '}
        <Mono>recipes.scenarios</Mono>; engineering is a figure (<Mono>notObjects</Mono>).
      </P>
      <H3>Reports</H3>
      <P>
        <Mono>recipes.engineering</Mono> (work <Mono>menu_engineering</Mono> in <Mono>reports/work/recipes.js</Mono>):
        one row per dish sold in a section over the report&apos;s period (the first of the <Mono>periods</Mono>{' '}
        <Mono>run.js</Mono> passes as asked, never the ranges a weekly report widens by six days; dated at its last
        day; every venue together, the subject has no venue), class, popular, profitable, units, share, GP per unit and the section&apos;s, total GP,
        cost %, what to do; GP, net, cost %, class and profitable need Costing and till reports view.{' '}
        <Mono>recipes.scenarios</Mono> over <Mono>cost_scenarios</Mono>. Starter <Mono>menu_engineering_month</Mono>{' '}
        (this month, no venues choice).
      </P>
    </section>
  )
}
