// src/pages/docs/stock.jsx
// The Docs page's "Stock" section (inventory phase 4a: the ledger, storage
// areas, stocktakes, adjustments). Docs.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, Mono, InfoBox } from './parts.jsx'

export const id = 'stock'
export const label = 'Stock'
export const order = 257

export function Section() {
  return (
    <section id="stock" data-doc="">
      <H2>Stock</H2>
      <P>
        Inventory phase 4a (<Mono>docs/INVENTORY.md</Mono> 6.1 to 6.4, decisions D4, D10, D11; migrations 305 to 307,
        27 Nov 2026). The stock area (<Mono>docs/claude/areas/stock.md</Mono>): the ledger, stock on hand, storage
        areas, stocktakes and adjustments, the Stock page at <Mono>/stock</Mono> (module <Mono>stock</Mono>) and the
        phone&apos;s <Mono>/mobile/stock-count</Mono>. Stock on hand and counts (migration 287) moved here from
        purchasing. Waste and transfers (phase 4b) are added as further move sources; usage from sales is phase 5.
      </P>
      <H3>The rule: documents are the truth</H3>
      <P>
        Nothing stores a stock level. Each delivery booked in, approved count and adjustment is a move of one item at
        one venue, and <Mono>stockOnHand({'{ moves, at }'})</Mono> in <Mono>shared/stock.js</Mono> is the one rule:
        the last count (a count sets the quantity) plus every other move after it (signed, in the item&apos;s base
        unit). A move at the very moment of a count is inside it. <Mono>at</Mono> gives what stood at a moment (a
        count&apos;s expected figure). <Mono>runningBalance(moves)</Mono> gives the ledger&apos;s change and balance per
        move (null before the first count; a count&apos;s change is counted less the balance).{' '}
        <Mono>shared/procurement.js</Mono> re-exports <Mono>stockOnHand()</Mono> (the two files load each other, so{' '}
        <Mono>stock.js</Mono> never uses a procurement binding at its top level).
      </P>
      <P>
        <Mono>loadStockMoves(tx, tenantId, {'{ venueIds, itemIds, from, to, kinds, costs, exceptCountId }'})</Mono> in{' '}
        <Mono>api/src/services/stockSvc.js</Mono> reads <Mono>MOVE_SOURCES</Mono>, a list of{' '}
        <Mono>{'{ kind, load }'}</Mono>: deliveries (received <Mono>purchase_order_lines</Mono>, base qty ={' '}
        <Mono>received_qty</Mono> x the line&apos;s own <Mono>pack_base_qty</Mono>, only lines in the item&apos;s base
        unit as it is now, at <Mono>received_at</Mono>), approved counts (lines added per item) and adjustments. Phase
        4b adds sources there; callers don&apos;t change. With <Mono>costs</Mono> each move gets{' '}
        <Mono>cost_per_base</Mono>: the price paid for a delivery (invoice price, else ordered), else{' '}
        <Mono>costAt()</Mono>: the average paid at the venue over the 90 days before the move, else the last price
        paid before it (<Mono>itemCost()</Mono> in <Mono>shared/costing.js</Mono>). <Mono>loadStockOnHand()</Mono>,{' '}
        <Mono>itemCostsAt()</Mono>, <Mono>costLookup()</Mono>, <Mono>countScope()</Mono>,{' '}
        <Mono>loadCountItems()</Mono> sit beside it. <Mono>SALES_COUNTED</Mono> is false and every answer carries{' '}
        <Mono>NO_SALES_NOTE</Mono>.
      </P>
      <H3>Tables</H3>
      <P>
        Migration 306: <Mono>stock_areas</Mono> (venue, name unique per venue ignoring case, <Mono>sort_order</Mono>),{' '}
        <Mono>stock_area_items</Mono> (area, item, <Mono>sort_order</Mono>; an item may be in several areas),{' '}
        <Mono>stock_key_lists</Mono> and <Mono>stock_key_list_items</Mono> (the group&apos;s), <Mono>stock_settings</Mono>{' '}
        (tenant: <Mono>second_person_approves</Mono>, <Mono>blind_count</Mono>), <Mono>stock_venue_settings</Mono>{' '}
        (venue: <Mono>count_weekday</Mono> 0 Sunday to 6, <Mono>count_kind</Mono>, <Mono>key_list_id</Mono>),{' '}
        <Mono>stock_adjustments</Mono> (venue, item, <Mono>qty</Mono> and <Mono>unit</Mono> as typed, signed{' '}
        <Mono>qty_base</Mono>, <Mono>reason</Mono> required, note, <Mono>adjusted_at</Mono>/<Mono>_by</Mono>,{' '}
        <Mono>reverses_id</Mono> unique). <Mono>stock_counts</Mono> gains <Mono>kind</Mono> full | key,{' '}
        <Mono>status</Mono> draft | submitted | approved | cancelled (default draft), <Mono>key_list_id</Mono> and{' '}
        <Mono>key_list_name</Mono>, <Mono>areas_done</Mono> jsonb ({'{ area_id: { by, at } }'}), started, submitted,
        approved and cancelled by and at. <Mono>stock_count_lines</Mono> gains <Mono>area_id</Mono> (null outside an
        area), <Mono>entries</Mono> jsonb as typed (<Mono>[{'{ qty, unit, label, base_qty }'}]</Mono>),{' '}
        <Mono>confirmed_zero</Mono>, <Mono>counted_by</Mono>; one line per count, item and area (UNIQUE NULLS NOT
        DISTINCT). Existing counts became approved full counts with their lines as typed in the base unit. Every
        table has RLS enabled and forced. Migration 305: the module; 307: the menu link after Recipes.
      </P>
      <H3>Routes (/api/stock)</H3>
      <P>
        <Mono>routes/stock.js</Mono>: <Mono>GET /meta</Mono> (levels, settings, <Mono>me</Mono>),{' '}
        <Mono>GET /venues/:venueId</Mono> (every active item: on hand, last count, received and adjusted since,{' '}
        <Mono>units</Mono> and <Mono>default_unit</Mono>, areas, par, <Mono>low</Mono>, value with Costing view),{' '}
        <Mono>GET /venues/:venueId/items/:itemId/moves?from=&amp;to=</Mono> (the ledger, days at the venue).{' '}
        <Mono>routes/stockCounts.js</Mono>: <Mono>GET|POST /venues/:venueId/counts</Mono> (a draft by kind, 409{' '}
        <Mono>open_count</Mono> with its id while the venue has one; or a quick count with <Mono>lines</Mono>: a key
        count of those items, submitted, approved at once when the person may), <Mono>POST
        /venues/:venueId/key-counts</Mono> (the plain form), <Mono>GET|PATCH /counts/:id</Mono>,{' '}
        <Mono>PUT /counts/:id/lines</Mono> (one item in one area; no entries deletes it; FOR SHARE on the count),{' '}
        <Mono>POST /counts/:id/areas/:areaId</Mono>, <Mono>/submit</Mono> (<Mono>zero_item_ids</Mono> or{' '}
        <Mono>all_zero</Mono>; 422 <Mono>not_counted</Mono> with the items), <Mono>/approve</Mono> (Manage;{' '}
        <Mono>approvalProblem()</Mono>, 403 <Mono>second_person</Mono>), <Mono>/reopen</Mono>, <Mono>/cancel</Mono>,{' '}
        <Mono>GET /venues/:venueId/today?date=</Mono> (Today). <Mono>routes/stockSetup.js</Mono>: areas (create,
        rename, <Mono>PUT /venues/:venueId/areas/order</Mono>, <Mono>PUT /areas/:id/items</Mono>, delete: 409{' '}
        <Mono>area_in_count</Mono> while a draft or submitted count has lines there; lines of finished counts join
        the line outside an area), key lists, <Mono>GET|PUT /settings</Mono>, <Mono>PUT
        /venues/:venueId/settings</Mono>, adjustments and <Mono>POST /adjustments/:id/reverse</Mono>.
      </P>
      <P>
        Permissions: View reads, Use counts (start, lines, areas, submit, cancel a draft), Manage approves, reopens,
        cancels a submitted count, adjusts and sets up; checked with <Mono>requirePermission()</Mono> and{' '}
        <Mono>permissionAtLeast()</Mono> (<Mono>stockAccess()</Mono>). Values (stock value, a move&apos;s or a
        difference&apos;s value) only with Costing view. Every id is the group&apos;s: venues by{' '}
        <Mono>requireOwnVenue()</Mono>, items, areas (also the count&apos;s venue&apos;s), key lists, counts and
        adjustments filtered by <Mono>tenant_id</Mono>.
      </P>
      <H3>Counting</H3>
      <P>
        <Mono>countScope()</Mono>: a full count covers the active items in the venue&apos;s areas and every active item
        with a move there; a key count its list&apos;s items. <Mono>countUnits(item, packs)</Mono> gives the units a
        line takes (standard units of the item&apos;s kind, its own <Mono>inv_item_units</Mono>, its supplier
        packs as <Mono>pack:&lt;quote id&gt;</Mono>); <Mono>entriesToBase()</Mono> totals a line with sizes from that
        list only (a pack is also named by its name, &quot;case&quot;). The review is <Mono>countReview()</Mono>:
        expected = <Mono>stockOnHand()</Mono> at <Mono>counted_at</Mono> without the count itself, the difference and
        its value at <Mono>itemCostsAt()</Mono> then; <Mono>expected</Mono> gives every sheet item&apos;s figure (null for one
        never counted), shown beside each line while counting. Blind counting (<Mono>blind_count</Mono>) leaves{' '}
        <Mono>review</Mono> and <Mono>expected</Mono> out while the count is a draft, for everyone.
      </P>
      <InfoBox>
        The count sheet saves each line as it is typed (debounced, about a second) instead of a Save button: the one
        place Standard Design Rule 5 gives way, so two people can count two areas at once and a sleeping phone loses
        nothing. The sheet fetches the count every few seconds while it is a draft.
      </InfoBox>
      <H3>Admin</H3>
      <P>
        <Mono>pages/Stock.jsx</Mono> (lazy; <Mono>?venue= &amp;tab= &amp;count= &amp;item=</Mono>; <Mono>TABS</Mono> has
        the places for Waste and Transfers) with lazy tabs in <Mono>components/stock/</Mono>:{' '}
        <Mono>OnHand.jsx</Mono>, <Mono>ItemHistory.jsx</Mono>, <Mono>Counts.jsx</Mono> (<Mono>StartCount</Mono>,{' '}
        <Mono>useCounts</Mono>), <Mono>CountSheet.jsx</Mono> (<Mono>useLineSaver()</Mono>), <Mono>CountReview.jsx</Mono>,{' '}
        <Mono>Adjustments.jsx</Mono>, <Mono>StockSettings.jsx</Mono>; <Mono>shared.jsx</Mono> (<Mono>EntriesEditor</Mono>,{' '}
        <Mono>useStockMeta</Mono>, <Mono>useStockList</Mono>). Phone: <Mono>pages/mobile/MobileStockCount.jsx</Mono>{' '}
        and the Stock count tile (<Mono>mobile/registry.js</Mono>, areas <Mono>stock</Mono>). The Inventory page&apos;s{' '}
        <Mono>?tab=stock</Mono> links to <Mono>/stock</Mono>. Test ids: <Mono>stock-row</Mono>,{' '}
        <Mono>stock-count-line</Mono>, <Mono>stock-entry-qty</Mono>, <Mono>stock-count-submit</Mono>,{' '}
        <Mono>stock-count-zero-all</Mono>, <Mono>stock-count-approve</Mono>, <Mono>stock-review-row</Mono>,{' '}
        <Mono>stock-adjust-save</Mono>, <Mono>stock-area-add</Mono>.
      </P>
      <H3>Today, Pepper, reports</H3>
      <P>
        Today: source <Mono>stock</Mono> in <Mono>services/opsToday.js</Mono> (module <Mono>stock</Mono>):{' '}
        <Mono>stock_count_due</Mono> on the venue&apos;s count day until a count of that day is submitted (Use) and{' '}
        <Mono>stock_count_to_approve</Mono> for whoever may approve (<Mono>approvalProblem()</Mono>). Pepper{' '}
        (<Mono>ai/tools/stock.js</Mono>): <Mono>stock_on_hand</Mono>, <Mono>stock_moves</Mono> (read) and{' '}
        <Mono>count_stock</Mono> (consequential, <Mono>needs: &apos;use&apos;</Mono>; entries in several units, an
        area; the quick count route); the plain form <Mono>stock_key_count</Mono> (<Mono>api/src/forms/stock.js</Mono>);
        registry <Mono>shared/registry/stock.js</Mono>. Reports (<Mono>reports/catalogue/stock.js</Mono>, works in{' '}
        <Mono>reports/work/stock.js</Mono>): <Mono>stock.on_hand</Mono> (was <Mono>purchasing.stock</Mono>),{' '}
        <Mono>stock.moves</Mono>, <Mono>stock.counts</Mono>, <Mono>stock.count_lines</Mono> (expected, counted,
        difference, value, <Mono>latest</Mono>), <Mono>stock.adjustments</Mono>; values need Costing; the starter{' '}
        <Mono>stock_last_count_differences</Mono>. Tests: <Mono>api/test/stock-counts.test.mjs</Mono>,{' '}
        <Mono>api/test/stock-on-hand.test.mjs</Mono>, <Mono>shared/test/stock.test.mjs</Mono>; fixtures{' '}
        <Mono>api/test/support/fixtures/stock.mjs</Mono> (kind <Mono>areaId</Mono>).
      </P>
    </section>
  )
}
