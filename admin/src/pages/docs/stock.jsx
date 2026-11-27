// src/pages/docs/stock.jsx
// The Docs page's "Stock" section (inventory phase 4a: the ledger, storage
// areas, stocktakes, adjustments; phase 4b: waste and its reasons, till voids
// marked wasted, transfers between venues; phase 5: usage from sales). Docs.jsx gathers every file in this
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
        purchasing. Phase 4b (migrations 308 and 309) added waste (with the till&apos;s voids marked wasted) and
        transfers between venues as further move sources, the Waste and Transfers tabs and the phone&apos;s{' '}
        <Mono>/mobile/stock-waste</Mono>; phase 5 (migration 311) usage from sales, below.
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
        4b added waste, till voids and transfers there; callers didn&apos;t change. With <Mono>costs</Mono> each move gets{' '}
        <Mono>cost_per_base</Mono>: the price paid for a delivery (invoice price, else ordered), else{' '}
        <Mono>costAt()</Mono>: the average paid at the venue over the 90 days before the move, else the last price
        paid before it (<Mono>itemCost()</Mono> in <Mono>shared/costing.js</Mono>). <Mono>loadStockOnHand()</Mono>,{' '}
        <Mono>itemCostsAt()</Mono>, <Mono>costLookup()</Mono>, <Mono>countScope()</Mono>,{' '}
        <Mono>loadCountItems()</Mono> sit beside it. Since phase 5 <Mono>SALES_COUNTED</Mono> is true: usage from
        sales is a source too (kind <Mono>usage</Mono>), and every answer carries <Mono>salesNote()</Mono> (up to when
        sales are taken off: the last run, <Mono>salesTakenOff()</Mono>).
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
        /venues/:venueId/settings</Mono>, adjustments and <Mono>POST /adjustments/:id/reverse</Mono> (the same
        quantity the other way, dated at the original&apos;s <Mono>adjusted_at</Mono>; when it was done is{' '}
        <Mono>created_at</Mono>): on hand starts from the last approved count, so a reversal dated after a count would
        be added on top of what the count found, which already held the mistake.
      </P>
      <P>
        Permissions: View reads, Use counts (start, lines, areas, submit, cancel a draft), Manage approves, reopens,
        cancels a submitted count, adjusts and sets up; checked with <Mono>requirePermission()</Mono> and{' '}
        <Mono>permissionAtLeast()</Mono> (<Mono>stockAccess()</Mono>). Values (stock value, a move&apos;s or a
        difference&apos;s value) only with Costing view; a delivery&apos;s <Mono>cost_per_base</Mono> and value (its
        supplier&apos;s price and line total) also need purchasing prices (<Mono>sees_prices</Mono>:{' '}
        <Mono>seesPurchasingPrices()</Mono> on <Mono>purchasing_setup</Mono>, as recipes&apos; explanation does).
        Who did it (every <Mono>_by</Mono> column, the second person rule) is <Mono>stockPerson(req)</Mono>: on a
        shared device the office PIN person switched in (<Mono>req.acting</Mono>), by their own sign-in email, else
        the account; <Mono>approvalProblem()</Mono> compares every form of the approver&apos;s name (email and sub).
        Every id is the group&apos;s: venues by{' '}
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
        <Mono>review</Mono> and <Mono>expected</Mono> out while the count is a draft, for everyone, and Pepper&apos;s{' '}
        <Mono>count_stock</Mono> card leaves out each line&apos;s &quot;was&quot; figure (<Mono>countPlan()</Mono>{' '}
        reads <Mono>blind_count</Mono> from <Mono>/meta</Mono>); on hand itself (the On hand tab,{' '}
        <Mono>stock_on_hand</Mono>, the ledger) stays readable with Stock View. <Mono>later_count</Mono> names an
        approved count at the venue dated after a draft or submitted one: the items it counted keep its figures.
      </P>
      <InfoBox>
        The count sheet saves each line as it is typed (debounced, about a second) instead of a Save button: the one
        place Standard Design Rule 5 gives way, so two people can count two areas at once and a sleeping phone loses
        nothing. The sheet fetches the count every few seconds while it is a draft. Submit (and Confirm all as zero)
        awaits <Mono>useLineSaver().flush()</Mono>, which sends what is waiting and resolves once every line sent or
        saving has its answer; a failed line stops the submit. The sheet is read only (ReadOnlyNotice) when the
        count&apos;s <Mono>can_count</Mono> is false.
      </InfoBox>
      <H3>Waste (phase 4b, migration 308)</H3>
      <P>
        Tables: <Mono>waste_reasons</Mono> (the group&apos;s: <Mono>name</Mono> unique ignoring case,{' '}
        <Mono>kind</Mono> spoilage | preparation | plate, <Mono>sort_order</Mono>, <Mono>is_active</Mono>; seeded
        once per group from <Mono>WASTE_REASON_SEEDS</Mono> by the migration for groups that exist and by{' '}
        <Mono>ensureWasteReasons()</Mono> on a new group&apos;s first read, the flag{' '}
        <Mono>stock_settings.waste_reasons_seeded</Mono> keeping deleted reasons gone), <Mono>stock_waste</Mono>{' '}
        (venue, <Mono>wasted_at</Mono>, <Mono>day</Mono> the venue&apos;s trading day, <Mono>what</Mono> item |
        recipe | dish with <Mono>item_id</Mono>, <Mono>recipe_id</Mono> (a prep batch) or <Mono>dish_id</Mono> (a
        plain id, no foreign key: the menu save re-inserts dishes) and the matrix scope{' '}
        <Mono>revenue_stream_id</Mono> / <Mono>order_type_id</Mono>; <Mono>name</Mono>, <Mono>qty</Mono>,{' '}
        <Mono>unit</Mono> and <Mono>qty_base</Mono> as logged; <Mono>reason_id</Mono> with the reason&apos;s{' '}
        <Mono>reason</Mono> and <Mono>reason_kind</Mono> then; <Mono>value</Mono> pounds; <Mono>gaps</Mono> jsonb
        text; note, <Mono>photo_url</Mono>, <Mono>wasted_by</Mono>; <Mono>undone_at</Mono>/<Mono>_by</Mono>;{' '}
        <Mono>reverses_id</Mono> unique) and <Mono>stock_waste_items</Mono> (each item it took off:{' '}
        <Mono>qty_base</Mono> as bought, below zero on a reversing entry, and <Mono>cost_per_base</Mono> then).
      </P>
      <P>
        Breaking in: <Mono>itemsOf(what, ctx)</Mono> in <Mono>shared/stockItems.js</Mono> (its own file:{' '}
        <Mono>shared/stock.js</Mono> can&apos;t import the cost engine, which imports procurement, which re-exports
        stock) takes an item as it is, a prep batch through <Mono>recipeMakes()</Mono> (yield less loss) and its
        lines, and a dish through <Mono>dishCost()</Mono>&apos;s lines: the recipe <Mono>recipeFor()</Mono> picks for
        the venue, stream and order type, the options&apos; rules and a deal&apos;s picks (<Mono>flatPicks()</Mono>),
        each line bought at its yield (<Mono>dishCost()</Mono>&apos;s lines carry <Mono>yield_pct</Mono> since 4b).
        What it can&apos;t say is a gap in words, never a refusal: no recipe, a unit with no size, a draft with a{' '}
        <Mono>source</Mono> (<Mono>needsCheck()</Mono>: <em>not checked yet</em>), a meal deal with no picks. A
        service takes nothing. The ctx is <Mono>wasteCtx()</Mono> (<Mono>coverageCtx()</Mono>&apos;s: every menu,
        draft over live). Each item is valued with <Mono>itemCostsAt()</Mono> at the moment it is logged.
      </P>
      <P>
        Till voids: <Mono>loadWastedVoids()</Mono> reads <Mono>pos_check_lines</Mono> with{' '}
        <Mono>status = &apos;voided&apos;</Mono> and <Mono>void_waste</Mono>, <Mono>NOT pos_checks.is_generated</Mono>{' '}
        (D10), the line&apos;s own record from <Mono>pos_checks.state</Mono> (its modifiers and combo picks), the
        trading day from <Mono>void_day_id</Mono> (else the venue&apos;s at the void&apos;s moment, by the till&apos;s day
        start), who from <Mono>cash_staff</Mono>; <Mono>voidReason()</Mono> names the group&apos;s reason of the
        void&apos;s words, else preparation. Never copied into <Mono>stock_waste</Mono>, never undone here.
      </P>
      <P>
        What a void took off is kept (migration 310): <Mono>stock_void_waste</Mono> (keyed by the till line&apos;s id,
        no foreign key to <Mono>pos_check_lines</Mono>, which the till rewrites on every save; the check&apos;s{' '}
        <Mono>at</Mono> and <Mono>qty</Mono> it was broken in for, the recipe, the gaps) and{' '}
        <Mono>stock_void_waste_items</Mono> (each item&apos;s <Mono>qty_base</Mono> and <Mono>cost_per_base</Mono> at
        the void&apos;s moment). <Mono>loadWastedVoids()</Mono> breaks a void in only when nothing is kept for it, its
        own record changed, or its till day is still open (D9: open days are recomputed, closed ones never change);
        a dish on no menu now keeps what was kept, and isn&apos;t kept when nothing was. Keeping happens under the
        group&apos;s advisory lock in a savepoint, only in a read committed transaction that can write (a report
        run&apos;s repeatable read breaks in without keeping). The sweep <Mono>jobs/stock-voids.js</Mono> (every 10
        minutes, <Mono>sweepVoidWaste()</Mono>, system mode per group) keeps the last 14 days&apos; voids nobody has
        read yet. Both are <Mono>waste</Mono> moves (<Mono>wasteMoves</Mono>, <Mono>voidWasteMoves</Mono> in{' '}
        <Mono>MOVE_SOURCES</Mono>); an undone entry moves nothing; a reversing entry is dated at its original&apos;s{' '}
        <Mono>wasted_at</Mono> and <Mono>day</Mono> (a count between keeps its figure). The trading day is{' '}
        <Mono>venueDay()</Mono>: <Mono>businessDate()</Mono> at the till&apos;s <Mono>day_starts_at</Mono>, else 04:00.
      </P>
      <P>
        Routes (<Mono>api/src/routes/stockWaste.js</Mono>): <Mono>GET/POST /waste-reasons</Mono>,{' '}
        <Mono>PUT /waste-reasons/order</Mono> (every reason), <Mono>PUT /waste-reasons/:reasonId</Mono> (whole),{' '}
        <Mono>DELETE /waste-reasons/:reasonId</Mono> (409 <Mono>reason_in_use</Mono>; Manage for changes);{' '}
        <Mono>GET /venues/:venueId/waste/pickers</Mono> (items with their units, prep recipes with theirs, dishes,
        streams, order types, active reasons, <Mono>today</Mono>); <Mono>POST /venues/:venueId/waste/preview</Mono>{' '}
        and <Mono>POST /venues/:venueId/waste</Mono> (<Mono>WasteBody</Mono>, Use); <Mono>GET /venues/:venueId/waste?day=|from=&to=</Mono>{' '}
        (entries and voids, <Mono>by_kind</Mono>, <Mono>can_undo</Mono> / <Mono>can_reverse</Mono> per entry by{' '}
        <Mono>wasteUndo()</Mono>, <Mono>venue_problem</Mono> on a shared device at another venue);{' '}
        <Mono>GET /venues/:venueId/waste/summary?from=&to=&days=&by=</Mono> (<Mono>wasteTotals()</Mono>: a reversing
        entry counts minus one; <Mono>days</Mono> trading days up to <Mono>to</Mono>, the venue&apos;s today by
        default);{' '}
        <Mono>POST /waste/:wasteId/undo</Mono> (its trading day: whoever logged it with Use, or Manage; 409{' '}
        <Mono>day_over</Mono> after), <Mono>POST /waste/:wasteId/reverse</Mono> (Manage, after its day),{' '}
        <Mono>POST /waste/:wasteId/photo</Mono> (multipart, storage folder <Mono>waste</Mono>; the file&apos;s first
        bytes must be a JPEG, PNG, WebP or HEIC and it is stored under that type&apos;s extension, never the
        filename&apos;s: <Mono>/uploads/</Mono> is served on the admin&apos;s origin). Logging, undo, reverse and the
        photo hold a shared device&apos;s person to its venue (<Mono>venueProblem()</Mono>, 403{' '}
        <Mono>venue</Mono>). An entry&apos;s <Mono>unvalued</Mono> counts its items with no price paid (the value is
        then partial). Values need Costing view everywhere.
      </P>
      <H3>Transfers (phase 4b, migration 309)</H3>
      <P>
        Tables: <Mono>stock_transfers</Mono> (<Mono>number</Mono> per group under an advisory lock,{' '}
        <Mono>from_venue_id</Mono> &lt;&gt; <Mono>to_venue_id</Mono>, <Mono>status</Mono> sent | received | cancelled,
        note, sent, received (with <Mono>receive_note</Mono>) and cancelled by and at) and{' '}
        <Mono>stock_transfer_lines</Mono> (one per item: <Mono>qty</Mono>/<Mono>unit</Mono>/<Mono>qty_base</Mono>{' '}
        sent, <Mono>received_qty</Mono>/<Mono>received_unit</Mono>/<Mono>received_base</Mono> once received,{' '}
        <Mono>cost_per_base</Mono> the sender&apos;s average when sent). <Mono>transferLineMoves()</Mono> in{' '}
        <Mono>shared/stock.js</Mono> gives a line&apos;s moves: <Mono>transfer_out</Mono> at the sender when sent;
        once received, <Mono>transfer_out</Mono> of what arrived and <Mono>lost_in_transit</Mono> of the rest (
        <Mono>lostInTransit()</Mono>, never below zero), both at <Mono>sent_at</Mono>, and <Mono>transfer_in</Mono>{' '}
        at the receiver at <Mono>received_at</Mono>; once cancelled, <Mono>transfer_in</Mono> back at the sender at{' '}
        <Mono>cancelled_at</Mono>. One source (<Mono>transferMoves</Mono>) in <Mono>MOVE_SOURCES</Mono>; its moves
        carry <Mono>cost_fixed</Mono>, so a line the sender had no cost for has no value at either end (never the
        receiver&apos;s own average). A line received as sent is typed in by <Mono>asSentEntry()</Mono> (the unit it
        was sent in while that unit&apos;s size is the same, else the base quantity sent), on the page and in
        Pepper&apos;s <Mono>receive_transfer</Mono>.
      </P>
      <P>
        Routes (<Mono>api/src/routes/stockTransfers.js</Mono>): <Mono>GET /venues/:venueId/transfers</Mono>{' '}
        (<Mono>incoming</Mono>, <Mono>outgoing</Mono>, <Mono>history</Mono>, <Mono>can_send</Mono>),{' '}
        <Mono>GET /transfers/:transferId</Mono> (lines with each item&apos;s count units),{' '}
        <Mono>POST /venues/:venueId/transfers</Mono> (<Mono>TransferBody</Mono>: <Mono>to_venue_id</Mono> and{' '}
        <Mono>lines</Mono>, or one <Mono>item_id</Mono>/<Mono>qty</Mono>/<Mono>unit</Mono> for the plain form),{' '}
        <Mono>POST /transfers/:transferId/receive</Mono> (<Mono>ReceiveBody</Mono>: every line once, 0 when none
        came), <Mono>POST /transfers/:transferId/cancel</Mono> (a sent one). All Stock use; a shared device acts only
        at its own venue (<Mono>venueProblem()</Mono> in <Mono>routes/stock.js</Mono>: the app has no list of venues
        per person, the device&apos;s venue is the one limit there is). Both venues are the group&apos;s:{' '}
        <Mono>requireOwnVenue()</Mono>, <Mono>refuseOtherTenantsVenues</Mono> and the route&apos;s own lookup of{' '}
        <Mono>to_venue_id</Mono>.
      </P>
      <InfoBox>
        A transfer in is valued at the sender&apos;s cost on its line, but it doesn&apos;t join the receiver&apos;s
        average paid (<Mono>costAt()</Mono> reads deliveries): later moves of that item at the receiver are valued at
        its own deliveries&apos; average. Full counts cover items received by transfer (<Mono>countScope()</Mono>).
      </InfoBox>
      <H3>Admin</H3>
      <P>
        <Mono>pages/Stock.jsx</Mono> (lazy; <Mono>?venue= &amp;tab= &amp;count= &amp;item= &amp;transfer=</Mono>) with lazy
        tabs in <Mono>components/stock/</Mono>: <Mono>Waste.jsx</Mono> (<Mono>WasteList</Mono>, <Mono>useWasteDay</Mono>,
        the week&apos;s summary), <Mono>WasteForm.jsx</Mono> (<Mono>useWastePickers</Mono>; the preview as a query, the
        photo by <Mono>photoCapture()</Mono> after the save), <Mono>Transfers.jsx</Mono> (send, <Mono>Receive</Mono>,
        cancel asked twice; receive only on the receiving venue&apos;s page, cancel on the sender&apos;s),{' '}
        <Mono>StockSettings.jsx</Mono>&apos;s <Mono>WasteReasonsCard</Mono> (<Mono>SortableRows</Mono>),{' '}
        <Mono>OnHand.jsx</Mono>, <Mono>ItemHistory.jsx</Mono>, <Mono>Counts.jsx</Mono> (<Mono>StartCount</Mono>,{' '}
        <Mono>useCounts</Mono>), <Mono>CountSheet.jsx</Mono> (<Mono>useLineSaver()</Mono>), <Mono>CountReview.jsx</Mono>,{' '}
        <Mono>Adjustments.jsx</Mono>, <Mono>StockSettings.jsx</Mono>; <Mono>shared.jsx</Mono> (<Mono>EntriesEditor</Mono>,{' '}
        <Mono>useStockMeta</Mono>, <Mono>useStockList</Mono>). Phone: <Mono>pages/mobile/MobileStockCount.jsx</Mono>{' '}
        and the Stock count tile (<Mono>mobile/registry.js</Mono>, areas <Mono>stock</Mono>);{' '}
        <Mono>pages/mobile/MobileStockWaste.jsx</Mono> and its Waste tile (phase 4b). The Inventory page&apos;s{' '}
        <Mono>?tab=stock</Mono> links to <Mono>/stock</Mono>. Test ids: <Mono>stock-row</Mono>,{' '}
        <Mono>stock-count-line</Mono>, <Mono>stock-entry-qty</Mono>, <Mono>stock-count-submit</Mono>,{' '}
        <Mono>stock-count-zero-all</Mono>, <Mono>stock-count-approve</Mono>, <Mono>stock-review-row</Mono>,{' '}
        <Mono>stock-adjust-save</Mono>, <Mono>stock-area-add</Mono>; 4b <Mono>waste-form</Mono>,{' '}
        <Mono>waste-search</Mono>, <Mono>waste-pick</Mono>, <Mono>waste-qty</Mono>, <Mono>waste-unit</Mono>,{' '}
        <Mono>waste-reason</Mono> (<Mono>data-reason</Mono>), <Mono>waste-preview</Mono>, <Mono>waste-save</Mono>,{' '}
        <Mono>waste-row</Mono> (<Mono>data-kind</Mono> logged | till_void), <Mono>waste-undo</Mono>,{' '}
        <Mono>waste-confirm</Mono>, <Mono>transfer-row</Mono> (<Mono>data-status</Mono>), <Mono>transfer-open-receive</Mono>,{' '}
        <Mono>transfer-receive-qty</Mono>, <Mono>transfer-send-save</Mono>, <Mono>transfer-cancel</Mono>,{' '}
        <Mono>waste-reason-row</Mono>.
      </P>
      <H3>Today, Pepper, reports</H3>
      <P>
        Today: source <Mono>stock</Mono> in <Mono>services/opsToday.js</Mono> (module <Mono>stock</Mono>):{' '}
        <Mono>stock_count_due</Mono> on the venue&apos;s count day until a count of the kind it counts, dated that
        day, is submitted (a full count, or one of its <Mono>key_list_id</Mono>; a quick count, a key count with no
        list, never is) (Use) and <Mono>stock_count_to_approve</Mono> for whoever may approve{' '}
        (<Mono>approvalProblem()</Mono>). Their action is <Mono>/stock?tab=counts&amp;venue=&amp;count=</Mono>, which
        the phone maps to <Mono>/mobile/stock-count</Mono> (<Mono>PHONE_PAGES</Mono> in{' '}
        <Mono>admin/src/mobile/today.js</Mono>; the page reads <Mono>?venue=</Mono> and <Mono>?count=</Mono>). Pepper{' '}
        (<Mono>ai/tools/stock.js</Mono>): <Mono>stock_on_hand</Mono>, <Mono>stock_moves</Mono> (read) and{' '}
        <Mono>count_stock</Mono> (consequential, <Mono>needs: &apos;use&apos;</Mono>; entries in several units, an
        area; the quick count route); the plain form <Mono>stock_key_count</Mono> (<Mono>api/src/forms/stock.js</Mono>);
        registry <Mono>shared/registry/stock.js</Mono>. Reports (<Mono>reports/catalogue/stock.js</Mono>, works in{' '}
        <Mono>reports/work/stock.js</Mono>): <Mono>stock.on_hand</Mono> (was <Mono>purchasing.stock</Mono>),{' '}
        <Mono>stock.moves</Mono>, <Mono>stock.counts</Mono>, <Mono>stock.count_lines</Mono> (expected, counted,
        difference, value, <Mono>latest</Mono>), <Mono>stock.adjustments</Mono>; values need Costing, and a
        delivery&apos;s on <Mono>stock.moves</Mono> is its own field <Mono>paid</Mono> (measure Value received),
        which needs <Mono>purchasing_setup</Mono> as the purchasing subjects&apos; money does; counts and count lines
        open at their venue (<Mono>?venue=</Mono>); the starter{' '}
        <Mono>stock_last_count_differences</Mono>. Phase 4b: Today&apos;s <Mono>stock_transfer_to_receive</Mono>{' '}
        (each transfer sent to the venue, for Stock use; action <Mono>/stock?tab=transfers&amp;venue=&amp;transfer=</Mono>,
        which the phone opens on the office: <Mono>PHONE_TABS</Mono>); Pepper&apos;s <Mono>log_waste</Mono>{' '}
        (reversible: its inverse is <Mono>POST /waste/:id/undo</Mono>), <Mono>waste_summary</Mono> (read),{' '}
        <Mono>send_transfer</Mono> and <Mono>receive_transfer</Mono> (consequential), all <Mono>needs: &apos;use&apos;</Mono>,
        Activity words in <Mono>shared/pepperActions.js</Mono>; the plain forms <Mono>stock_waste</Mono> (with a photo
        attached after the save) and <Mono>stock_transfer</Mono> (one item); registry objects <Mono>stock.waste</Mono>,{' '}
        <Mono>stock.waste_reasons</Mono>, <Mono>stock.transfers</Mono> (opened at their tabs: the page&apos;s nav
        record in <Mono>shared/nav/stock.js</Mono> lists <Mono>waste</Mono> and <Mono>transfers</Mono> among its{' '}
        <Mono>tabs</Mono>); report subjects <Mono>stock.waste</Mono> (a row per item of each entry, voids included;
        a row opens <Mono>/stock?tab=waste&amp;venue=&amp;date=&amp;waste=</Mono>, the Waste tab on its trading day
        with the entry picked out) and <Mono>stock.transfers</Mono> (a row per line at each end),
        starters <Mono>stock_waste_by_reason_week</Mono> and <Mono>stock_transfers_in_transit</Mono>. Tests:{' '}
        <Mono>api/test/stock-counts.test.mjs</Mono>, <Mono>api/test/stock-on-hand.test.mjs</Mono>,{' '}
        <Mono>api/test/stock-waste.test.mjs</Mono>, <Mono>api/test/stock-transfers.test.mjs</Mono>,{' '}
        <Mono>shared/test/stock.test.mjs</Mono>, <Mono>shared/test/stockWaste.test.mjs</Mono>; fixtures{' '}
        <Mono>api/test/support/fixtures/stock.mjs</Mono> (kinds <Mono>areaId</Mono>, <Mono>reasonId</Mono>,{' '}
        <Mono>wasteId</Mono>, <Mono>transferId</Mono>).
      </P>
      <H3>Usage from sales (phase 5)</H3>
      <P>
        Migration 311 (<Mono>docs/INVENTORY.md</Mono> 7 and 9, decisions D9 and D10). The walk is the cost
        engine&apos;s: <Mono>usageOf(sold, scope, ctx)</Mono> in <Mono>shared/costing.js</Mono> turns one sold dish
        (options by id or, for an online order, by their words through <Mono>matchOptions()</Mono>; a meal deal&apos;s
        picks, or with none its <Mono>typicalPicks()</Mono> from <Mono>ctx.pickMix</Mono>) into{' '}
        <Mono>{'{ items: [{ item_id, qty_base }], uncosted: [{ reason, text, fix }] }'}</Mono> on{' '}
        <Mono>dishCost()</Mono>&apos;s lines (each carries <Mono>bought</Mono>: recipeCost()&apos;s{' '}
        <Mono>bought_qty</Mono>, as bought after its yield) and, for a prep recipe inside, on <Mono>recipeCost()</Mono>&apos;s
        own lines by its yield and loss. So <Mono>cost = sum(qty_base x per_base)</Mono> by construction.{' '}
        <Mono>itemsOf()</Mono> (waste) is built on it (<Mono>recipeUsage()</Mono> for a batch).
      </P>
      <P>
        Sold lines are read once: <Mono>loadSoldLines()</Mono> beside <Mono>loadSold()</Mono> in{' '}
        <Mono>services/recipeCoverageSvc.js</Mono> on the channel fragments <Mono>SOLD_FROM</Mono> (till and kiosk:
        closed checks, lines not voided, test sales left out, on <Mono>pos_days.business_date</Mono>, options and
        combo from <Mono>pos_checks.state</Mono>; online: the counted statuses on <Mono>service_date</Mono>, the order
        type the order&apos;s, else Ordering setup&apos;s for its fulfilment, else the type of that name; imported:{' '}
        <Mono>ext_line_parts</Mono> main, options and extra dishes, VAT out by the line&apos;s tax share, refunds only
        with <Mono>stock_settings.refunds_return_stock</Mono>; GloriaFood by name, <Mono>gloriaDayRows()</Mono> on
        the link&apos;s day basis). <Mono>loadPickMix()</Mono> reads the last 30 days&apos; picks of the deals that
        need them.
      </P>
      <P>
        <Mono>services/stockUsageSvc.js</Mono>: <Mono>computeDays()</Mono> replaces the days&apos; rows in one
        transaction: <Mono>stock_usage_days</Mono> (tenant, venue, day, item; <Mono>qty_base</Mono>,{' '}
        <Mono>cost_per_base</Mono> and <Mono>cost_how</Mono> average | last | standard at the day&apos;s last sale,{' '}
        <Mono>channels</Mono> jsonb, <Mono>at</Mono> the day&apos;s last sale) and <Mono>dish_cost_days</Mono> (venue,
        day, channel, dish and section by id and name, stream, order type, recipe, <Mono>qty</Mono>,{' '}
        <Mono>sales_pence</Mono>, <Mono>net_pence</Mono> VAT out, <Mono>cost</Mono> pounds, <Mono>uncosted_qty</Mono>,{' '}
        <Mono>typical_qty</Mono>, <Mono>left_out</Mono>, <Mono>gaps</Mono>), and <Mono>stock_usage_marks</Mono> (each
        day&apos;s fingerprint from <Mono>dayFingerprints()</Mono>: per channel lines, quantity, last change, and the
        imported parts&apos; hash). <Mono>runVenueUsage()</Mono> works out the venue&apos;s last{' '}
        <Mono>USAGE_DAYS</Mono> (14) trading days (<Mono>venueToday()</Mono>: the till&apos;s day start, else 04:00)
        that changed, were marked (<Mono>stock_usage_venues.dirty_from</Mono>, set by <Mono>markUsageDirty()</Mono>:
        the recipe, link and option rule plugins call <Mono>marksUsageOnChange(app)</Mono>, an <Mono>onSend</Mono>{' '}
        hook; the refunds setting) or were never worked out; <Mono>usageHooks.isDayClosed()</Mono> (false until
        phase 6) keeps closed days. <Mono>sweepStockUsage()</Mono> (job <Mono>jobs/stock-usage.js</Mono>, every 5
        minutes) registers the venues of groups with recipes, claims due ones with a lease
        (<Mono>running_until</Mono>, <Mono>FOR UPDATE SKIP LOCKED</Mono>), runs each in system mode and lets go.
      </P>
      <P>
        Routes (<Mono>routes/stockUsage.js</Mono>): <Mono>GET /api/stock/venues/:venueId/usage?from=&amp;to=</Mono>{' '}
        (Stock view; values with Costing view; at most 31 days) and <Mono>POST .../usage/recompute</Mono>{' '}
        <Mono>{'{ from, to }'}</Mono> (Stock manage; up to 31 days, none after today; 409 while the job holds the
        venue). On hand, the ledger and count scopes read the usage moves; <Mono>/settings</Mono> takes{' '}
        <Mono>refunds_return_stock</Mono> and the venue&apos;s settings <Mono>par_mode</Mono> (whole saves). The order
        form (purchasing&apos;s <Mono>orderStock()</Mono>) shows on hand, on order and usage over 7 days with Stock view,
        and fills pars by <Mono>packsToPar(par, quote, parStock(mode, stock))</Mono> with <Mono>parModeOf()</Mono>.
        Menu margins&apos; <Mono>GET /api/menu-margins/sold</Mono> sums <Mono>dish_cost_days</Mono> by{' '}
        <Mono>soldMargins()</Mono>. Pepper: <Mono>usage_summary</Mono> (read). Reports: <Mono>stock.usage</Mono>,{' '}
        <Mono>stock.dish_sales</Mono> (module costing; sales need till reports), starters{' '}
        <Mono>stock_theoretical_food_cost_week</Mono> and <Mono>uncosted_dishes_by_sales</Mono> (now on{' '}
        <Mono>dish_cost_days</Mono>); <Mono>stock_usage_marks</Mono> and <Mono>stock_usage_venues</Mono> are decided
        out. Tests: <Mono>shared/test/stockUsage.test.mjs</Mono>, <Mono>api/test/stock-usage.test.mjs</Mono>; the
        fixtures recompute late (<Mono>fillLate</Mono>, after the till&apos;s sales).
      </P>
    </section>
  )
}
