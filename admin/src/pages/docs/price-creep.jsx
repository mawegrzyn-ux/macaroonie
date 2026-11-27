// src/pages/docs/price-creep.jsx
// The Docs page's "Price creep and cost alerts" section (inventory phase 7b,
// migration 315, 27 Nov 2026). Docs.jsx gathers every file in this folder
// (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, Mono, InfoBox, DataTable } from './parts.jsx'

export const id = 'price-creep'
export const label = 'Price creep and cost alerts'
export const order = 256.5

export function Section() {
  return (
    <section id="price-creep" data-doc="">
      <H2>Price creep and cost alerts</H2>
      <P>
        Inventory phase 7b (<Mono>docs/INVENTORY.md</Mono> 8.2, 10.4; migration 315, 27 Nov 2026): every change of a
        supplier price works out the dishes whose recipes use the changed items, before and after, records those that
        crossed their cost target or limit (<Mono>cost_alerts</Mono>), and keeps <Mono>cost_target_states</Mono> by the
        hourly sweep&apos;s own function, so the rule trigger <Mono>dish_over_target</Mono> fires once whichever notices a
        crossing first. Menu margins&apos; banner and list, Today&apos;s dishes over target card, Pepper&apos;s{' '}
        <Mono>why_cost_changed</Mono>, the report subject Cost alerts. Area: recipes (the price change call sites are
        purchasing&apos;s, the state table stock&apos;s).
      </P>
      <H3>The hook</H3>
      <P>
        <Mono>priceChanged(tx, req, {'{'} quoteIds, venueIds, source, poId {'}'})</Mono> in{' '}
        <Mono>api/src/services/priceCreepSvc.js</Mono> (public), called after the write in the same transaction, in a
        savepoint (a failure is logged and never stops the price being saved). Call sites:
      </P>
      <DataTable
        head={['Route (purchasing)', 'source', 'Venues']}
        rows={[
          ['POST /api/inventory/items/:id/quotes', 'manual', 'every venue'],
          ['PATCH /api/inventory/quotes/:id (price or pack size changed)', 'manual', 'every venue'],
          ['PUT /api/inventory/quotes/:id/venue-prices', 'manual', 'the venues whose own price changed'],
          ['POST /api/inventory/price-update (not dry_run)', 'price_update', 'every venue'],
          ['POST /api/inventory/import (not dry_run)', 'import', 'every venue'],
          ['POST /api/purchasing/pos/:id/price-list', 'invoice (po_id)', 'the order\'s venue for venue prices only, else every venue'],
        ]}
      />
      <P>
        <Mono>priceCreep()</Mono>: the changed quotes&apos; items; <Mono>dishesUsing()</Mono> (the index: recipe lines
        using the items, up through the prep recipes holding them, to <Mono>recipe_links</Mono>) and{' '}
        <Mono>dealsHolding()</Mono> (<Mono>comboItemIds()</Mono>); with none on a live menu it stops there. Then{' '}
        <Mono>lockCostTargets()</Mono> (the sweep&apos;s advisory lock), taken before any price, history or state is read
        as the sweep takes it, so a price change running at the same time is costed only after it commits (never stale
        prices against the states it wrote). Then one costing ctx (<Mono>loadDishCosting()</Mono> with only the recipes those dishes and the deals&apos; choices need),
        the changed quotes&apos; price history (<Mono>historyFor()</Mono>) and <Mono>pricesAt(quotes, history, now,{' '}
        {'{'} strict: true {'}'})</Mono> for the prices before this transaction (its own rows carry its{' '}
        <Mono>now()</Mono>). At each venue (every live menu with no venue or the venue&apos;s, each active order type,{' '}
        <Mono>withOptions: false</Mono>, <Mono>menuMargins(..., {'{'} only {'}'})</Mono>): <Mono>keepCrossings()</Mono>{' '}
        (<Mono>services/stockFoodCostSvc.js</Mono>, under that lock) over <Mono>overTarget()</Mono> of the after rows, restricted to the dishes worked out, gives the rule events
        (kept on <Mono>req.costEvents</Mono>); <Mono>priceCrossings(before, after)</Mono> gives the alerts (the same
        <Mono> targetCrossings()</Mono> rule with the before side as what was kept), each with{' '}
        <Mono>dishMoves()</Mono>: the items one serving uses (<Mono>usageOf()</Mono>) whose cost per base unit moved,
        and the effect on a serving (their sum is the change in cost), rises first (<Mono>crossingMoves()</Mono>). A
        meal deal is banded at its highest cost %, so it is taken at the picks that give it on each side, not its
        typical picks: <Mono>priceCrossings()</Mono>&apos; <Mono>picks_before</Mono> / <Mono>picks_after</Mono>,{' '}
        <Mono>bandedPicks()</Mono> of the <Mono>dishMargin()</Mono> rows (<Mono>range.cost_pct_max_pick_ids</Mono>;{' '}
        <Mono>bandedPct()</Mono> is the cost % they give, the one <Mono>overTarget()</Mono> reads). <Mono>firesCostAlerts(app)</Mono>, an{' '}
        <Mono>onResponse</Mono> hook registered by <Mono>routes/inventory.js</Mono> and <Mono>routes/purchasing.js</Mono>,
        sends the events to <Mono>fireRulesLater()</Mono> once the change was answered with success.
      </P>
      <InfoBox>
        The price history (<Mono>inv_price_history</Mono>, migration 153) kept the pack price only; migration 315 adds{' '}
        <Mono>pack_base_qty</Mono> on each row (written from now on, a pack change being a row of its own; the latest
        company row of each price backfilled with its pack), so a cost per base unit can be read back at any moment. A
        quote made after the moment is left out; a quote with no row back then but some since is taken as it is now
        (<Mono>unknown</Mono>). Switching a price off, a usual supplier, a recipe or a menu price aren&apos;t in the
        history: the hourly sweep sees those (no alert).
      </InfoBox>
      <H3>Tables</H3>
      <P>
        <Mono>cost_alerts</Mono> (RLS forced): <Mono>venue_id</Mono> (cascade), <Mono>dish_id</Mono> (plain, no foreign
        key: the menu save re-inserts dishes), <Mono>name</Mono>, <Mono>menu_id</Mono>, <Mono>menu</Mono>,{' '}
        <Mono>section</Mono>, <Mono>order_type_id</Mono>, <Mono>order_type</Mono> (the worst), <Mono>old_cost_pct</Mono>{' '}
        (null: not costed then), <Mono>new_cost_pct</Mono>, <Mono>old_band</Mono>, <Mono>new_band</Mono> (watch |
        over), <Mono>threshold_pct</Mono> (the target or the limit crossed), <Mono>target_pct</Mono>,{' '}
        <Mono>limit_pct</Mono>, <Mono>source</Mono> (manual | import | price_update | invoice), <Mono>cause</Mono>{' '}
        (<Mono>causeWords()</Mono>, no money), <Mono>causes</Mono> jsonb (<Mono>[{'{'} item_id, name, base_unit,
        qty_base, before, after, pct, effect, quote_before, quote_after {'}'}]</Mono>), <Mono>po_id</Mono> (set null),{' '}
        <Mono>changed_by</Mono>, <Mono>day</Mono> (the venue&apos;s), <Mono>at</Mono>, <Mono>seen_by</Mono>,{' '}
        <Mono>seen_at</Mono>. <Mono>inv_price_history.pack_base_qty</Mono> (above).
      </P>
      <H3>Routes</H3>
      <DataTable
        head={['Route', 'Needs', 'What']}
        rows={[
          ['GET /api/cost-alerts ?venue_id &since &unseen &dish_id &limit', 'Costing view', 'Alerts newest first, alertSummary() over them as shown, sees_prices. A cause\'s quote_before / quote_after (supplier, pack, pack price) only with purchasing prices; the summary\'s top is { item_id, name, base_unit, venue_id, before, after, pct } (its move at one venue), never a supplier\'s price.'],
          ['GET /api/cost-alerts/summary ?venue_id', 'Costing view', 'The unseen ones: count, dishes, venues, threshold_pct, since, top ({ name, pct }), words ("4 dishes crossed 35% since 1 Dec: Chicken thighs up 12%"), newest_id, newest_at; latest_id, the newest alert seen or not.'],
          ['POST /api/cost-alerts/seen { ids } | { venue_id } | {}', 'Costing manage', 'Marks unseen alerts seen by the person, for everyone; 404 when an id isn\'t the group\'s.'],
          ['GET /api/cost-alerts/why ?dish_id &venue_id &order_type_id &since', 'Costing view', 'whyCostChanged(): a live dish at the start of since (30 days back when left out; refused after today) against now, on today\'s recipe: cost_then, cost_now, change, change_pct, cost_pct_then / now at today\'s menu price, items (itemMoves()), no_history, recipes_changed, uncosted, alerts. A meal deal: the cost, items and cost % at the picks with its highest cost % on each side (picks_then / picks_now, the dishes\' names), the price history of every dish it can hold.'],
        ]}
      />
      <H3>Today, Pepper, reports</H3>
      <P>
        Today (<Mono>services/opsToday.js</Mono>, shell&apos;s): the <Mono>costing</Mono> source&apos;s{' '}
        <Mono>dishes_over_target</Mono> card also reads <Mono>/api/cost-alerts/summary</Mono> as the person: with unseen
        alerts its detail ends with their words, its action is <Mono>/menu-margins?venue=&amp;alerts=1</Mono>, and its
        key carries the newest alert&apos;s id seen or not (<Mono>latest_id</Mono>: a new crossing brings a skipped or
        done card back; marking them seen leaves the key, so it stays done or skipped). No second card.
        Pepper: <Mono>why_cost_changed</Mono> (read, Costing view, <Mono>api/src/ai/tools/recipes.js</Mono>): the dish by
        name through <Mono>/api/recipe-links/names</Mono>, the route above, the moves in words; names, never ids.
        Reports: <Mono>recipes.cost_alerts</Mono> over <Mono>cost_alerts</Mono> (Costing view; open{' '}
        <Mono>/menu-margins?venue=:venue&amp;alerts=1&amp;alert=:id</Mono>), starter{' '}
        <Mono>dishes_crossed_cost_limit</Mono> (this month to date). Registry object <Mono>recipes.cost_alerts</Mono>.
      </P>
      <P>
        Admin: <Mono>components/recipes/CostAlerts.jsx</Mono> (lazy from <Mono>pages/MenuMargins.jsx</Mono>, across every
        tab): the banner (<Mono>cost-alerts-banner</Mono>, Mark as seen with Costing manage) and the drawer of the last 90
        days, or back to the summary&apos;s <Mono>since</Mono> when the oldest unseen alert is older (<Mono>?alerts=1</Mono>,{' '}
        <Mono>&amp;alert=</Mono> marks one; its Mark as seen, like the banner&apos;s, posts <Mono>{'{'} venue_id {'}'}</Mono>:
        every unseen alert there; test ids <Mono>cost-alerts-*</Mono>, <Mono>cost-alert</Mono>). Rules: <Mono>shared/priceCreep.js</Mono> (<Mono>pricesAt()</Mono>,{' '}
        <Mono>dishesUsing()</Mono>, <Mono>dealsHolding()</Mono>, <Mono>itemMoves()</Mono>, <Mono>dishMoves()</Mono>,{' '}
        <Mono>priceCrossings()</Mono>, <Mono>crossingMoves()</Mono>, <Mono>moveWords()</Mono>, <Mono>causeWords()</Mono>,{' '}
        <Mono>alertSummary()</Mono>, <Mono>dayWords()</Mono>, <Mono>CREEP_SOURCES</Mono>, also the report&apos;s words);{' '}
        <Mono>menuMargins()</Mono>&apos;s <Mono>only</Mono>, <Mono>bandedPct()</Mono>, <Mono>bandedPicks()</Mono> and{' '}
        <Mono>perBaseText()</Mono> in <Mono>shared/costing.js</Mono>.
      </P>
    </section>
  )
}
