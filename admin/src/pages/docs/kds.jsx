// src/pages/docs/kds.jsx
// The Docs page's "Kitchen screens (KDS)" section. Docs.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, Mono, DataTable, InfoBox } from './parts.jsx'

export const id = 'kds'
export const label = 'Kitchen screens (KDS)'
export const order = 270

// ── KITCHEN SCREENS ────────────────────────────────
export function Section() {
  return (
    <section id="kds" data-doc="">
      <H2>Kitchen screens (KDS)</H2>
      <P>
        Migrations 168, 169 (kitchen flow), 177 (several kitchen flows), 182 (stations out of a flow), 183 (Splitters), 200 (Sleepers), 191 (kitchen printers) and 207 (ticket colours). Design in <Mono>docs/POS.md</Mono> section 9. A kitchen screen is a till device of
        kind <Mono>kds</Mono> (<Mono>pos_devices</Mono>, short code K1, K2 ...), paired with a one-time
        code like a till. The same app at <Mono>pos.&lt;domain&gt;</Mono> boots{' '}
        <Mono>pos/src/kitchen/KitchenApp.jsx</Mono> (lazy) when the device's kind is <Mono>kds</Mono>.
        Kitchen events live in the venue's <Mono>pos_events</Mono> log and go through the same sequencer,
        so the venue hub can run them later with no change.
      </P>
      <H3>Kitchen orders</H3>
      <P>
        <Mono>shared/pos/kitchen.js</Mono> is the one implementation of the kitchen's rules, run by the
        sequencer and by the screen. A kitchen order is a till check (id = check id) or an online order
        (id <Mono>web-&lt;orders.id&gt;</Mono>). <Mono>kitchenForCheckEvent()</Mono> turns till events
        (<Mono>KITCHEN_CHECK_EVENTS</Mono>: lines.sent, course.fired, line.voided, lines.moved,
        check.merged, table / name / covers / server / note changes) into kitchen orders;{' '}
        <Mono>applyKitchenEvent()</Mono> applies kitchen events and returns <Mono>{'{ ok, orders, log }'}</Mono>.
        Held courses and online orders with a <Mono>fire_at</Mono> wait (<Mono>isFired()</Mono>); orders
        untouched for <Mono>STALE_HOURS</Mono> (16) drop off.
      </P>
      <H3>The kitchen flow</H3>
      <P>
        Station kinds (<Mono>STATION_KINDS</Mono>): <Mono>prep</Mono> makes dishes, <Mono>expo</Mono>{' '}
        checks whole orders, <Mono>runner</Mono> takes them out, <Mono>board</Mono> is an order ready board
        (nothing to bump, never on a kitchen screen), <Mono>balance</Mono> a Splitter (called Balance box before migration 200), <Mono>sleeper</Mono> a Sleeper (migration 200) and <Mono>printer</Mono> a
        kitchen printer (migration 191: prints the dishes that reach it, see Till (POS) → Printing; nothing to bump,
        never on a kitchen screen, links out allowed; a venue with only printer boxes still has a kitchen,{' '}
        <Mono>KITCHEN_KINDS</Mono> in <Mono>services/kitchenSvc.js</Mono>). The flow is links{' '}
        <Mono>{'{ from: stationId | null (Orders in), to, targets: [{ kind, id }], exclude }'}</Mono>; targets are
        item, section, device (the till or kiosk it was sent from, migration 192), revenue_stream,
        order_type (an <Mono>order_types</Mono> id, migration 170) or default, and empty targets mean every
        dish. <Mono>exclude</Mono> (migration 204, All except these in the designer) turns the filter round:
        the link takes every dish none of its targets names (<Mono>isExcept()</Mono>: exclude with at least
        one target; with none it is a link for every dish, and the API saves it as one). From each node a
        dish takes every link whose filter names it most specifically (<Mono>linkRank()</Mono>: item 0,
        section 1, device 2, revenue stream 3, order type 4, an Except link that doesn&apos;t leave the dish
        out 5, every dish 6; ties all apply; links to kitchen printers are ranked only against other links to kitchen printers, so a printer for every dish still gets the dishes a more specific link sends to a station; a link with <Mono>always</Mono> (<Mono>kds_flow_edges.always</Mono> / <Mono>box_links[].always</Mono>, migration 255) is left out of the ranking and taken by every dish it matches, beside whatever the ranking picks; <Mono>flowProblems()</Mono> refuses it out of a Splitter and <Mono>tidyBalanceBox()</Mono> clears it;{' '}
        <Mono>nextStations()</Mono>). When a dish is sent, <Mono>itemRoute()</Mono> works out its whole way
        and stores it on the item as <Mono>{'route: { [node]: [the nodes before it, \'start\' = Orders in] }'}</Mono>{' '}
        (combo parts each get their own way, merged for the item), so a flow change only affects
        dishes sent after it. Stations left out of the config (switched off or deleted) are passed
        straight through; links to them are ignored, so the next most specific link applies.
      </P>
      <P>
        <strong>Several flows</strong> (migration 177): a venue has one or more named flows
        (<Mono>kds_flows</Mono>, each with its links and layout); one is in use,{' '}
        <Mono>pos_settings.kds_active_flow_id</Mono>, else the first by sort order
        (<Mono>activeFlowOf()</Mono> in <Mono>services/kitchenSvc.js</Mono>). The sequencer's kitchen
        config (<Mono>loadKitchenConfig()</Mono>) carries only the links of the flow in use as{' '}
        <Mono>cfg.flow</Mono>, with <Mono>flow_id</Mono> and <Mono>active_setting</Mono> (the setting as
        read): nothing in <Mono>shared/pos/kitchen.js</Mono> knows there is more than one flow.{' '}
        <Mono>switchFlow()</Mono> takes the venue's till lock (<Mono>pg_advisory_xact_lock</Mono> on{' '}
        <Mono>pos:&lt;venue&gt;</Mono>, the sequencer's), so a switch falls between two events; the
        Postgres store's <Mono>context()</Mono> re-reads the setting per event
        (<Mono>activeFlowSetting()</Mono>) and reloads the kitchen config when it changed, so a switch in
        the middle of another device's batch counts from its next event. A switch never touches dishes
        already sent: they keep <Mono>item.route</Mono>.
      </P>
      <P>
        <strong>Shared flows</strong> (migration 192): a flow with <Mono>kds_flows.venue_id</Mono> NULL is
        shared by every location. Its boxes are named stations, <Mono>boxes</Mono> jsonb{' '}
        <Mono>{'[{ id, name, kind }]'}</Mono>, and its links are <Mono>box_links</Mono> jsonb{' '}
        <Mono>{'[{ id, from: box id | null, to: box id, targets, exclude }]'}</Mono> (not{' '}
        <Mono>kds_flow_edges</Mono>). <Mono>resolveSharedFlow(flow, place)</Mono> in{' '}
        <Mono>shared/pos/kitchen.js</Mono> turns it into one location&apos;s links: each box is the
        location&apos;s station with the same <Mono>flowName()</Mono> (trimmed, spaces collapsed, lower case;
        the first of two), links touching a box the location lacks are left out (so the next closest link
        applies), and its revenue stream and device filters, stored by name, become the location&apos;s ids
        of those names (none: <Mono>{'{ kind, id: null }'}</Mono>, which matches no dish, so an Except link
        there leaves nothing out and stays an Except link, ranked as at the other locations). Dish, section and
        order type filters stay ids (the company&apos;s). It returns <Mono>{'{ links, matches, missing, differs }'}</Mono>{' '}
        (a station of a different kind works as its own kind there). <Mono>loadFlows()</Mono> lists a
        venue&apos;s own flows, then the shared ones (each by sort order); <Mono>loadFlow()</Mono> resolves a
        shared one at the venue (<Mono>flowPlace()</Mono>: its stations, revenue streams, tills and kiosks),
        so the sequencer, kitchen screens (<Mono>kdsConfig()</Mono>, flows with <Mono>shared</Mono>) and the
        test bench get ordinary links and nothing else changes. Because the flow in use falls back to the
        first, <Mono>pinActiveFlows()</Mono> writes each venue&apos;s flow in use down before shared flows
        are made, reordered or deleted; <Mono>ensureFlows()</Mono> makes Main flow only for a venue with no
        flows at all. <Mono>shareFlow(links, stations, names)</Mono> turns a venue&apos;s flow into a shared
        one (box id = station id, so the layout carries over; a duplicate name&apos;s links and filters on
        streams or tills that have gone are dropped, and an Except link left with none takes every dish; a
        shared flow copied to a venue does the same with the names the venue lacks),{' '}
        <Mono>boxProblems()</Mono> checks boxes (a name each,
        no two alike, a known kind).
      </P>
      <P>
        <strong>Sent from</strong> (migration 192): link filter kind <Mono>device</Mono> names the till or
        kiosk that sent the order (<Mono>pos_devices</Mono> of kind terminal | kiosk at the venue, by id; in
        a shared flow by name). <Mono>RANK</Mono>: item 0, section 1, device 2, revenue_stream 3,
        order_type 4, default 5. <Mono>itemFromLine()</Mono> passes the <Mono>lines.sent</Mono>{' '}
        event&apos;s <Mono>device_id</Mono> into the route target; online and GloriaFood orders have no
        device, so a device link never takes them. The test bench&apos;s Test order has a Sent from choice
        (<Mono>spec.device_id</Mono>, checked against <Mono>data.devices</Mono>).
      </P>
      <P>
        <strong>Setters</strong> (migration 203): a station of kind <Mono>setter</Mono> sets the order&apos;s status
        as a dish passes it. Like a board it is done as soon as a dish reaches it (<Mono>noBump()</Mono>), so dishes
        go straight on; no kitchen screen (not in <Mono>BUMP_KINDS</Mono>; Store tech drops it from screens when a
        station becomes one), bumps refused. Its name is the status: the API refuses a second Setter of the same
        name at a venue (<Mono>checkSetterName()</Mono>, case and spaces ignored, 409). Its look is in
        settings (<Mono>status_look</Mono> from <Mono>STATUS_LOOKS</Mono>, <Mono>status_colour</Mono>,{' '}
        <Mono>status_text</Mono> (empty = the name), <Mono>status_anim</Mono> from <Mono>STATUS_ANIMS</Mono>,{' '}
        <Mono>status_lamp</Mono> 1-3), read through <Mono>statusOf()</Mono>. <Mono>orderStatus(o, cfg, at)</Mono>{' '}
        is the Setter the order&apos;s live, fired dishes reached last (by <Mono>flowTimes().arrived()</Mono>), so it
        is worked out, never stored; <Mono>boardNumbers()</Mono> puts it on each entry as <Mono>status</Mono> when
        given <Mono>cfg</Mono> (<Mono>boardFor()</Mono> passes it for the all-orders feed and every board). The
        screen designer gets the list as <Mono>order_statuses</Mono> from <Mono>designerData()</Mono> (one per name,
        the first location&apos;s look).
      </P>
      <P>
        <strong>Sleepers</strong> (migration 200): a station of kind <Mono>sleeper</Mono> holds the dishes that
        reach it for <Mono>settings.delay_mins</Mono> (1-240, <Mono>SLEEP_MINS_MAX</Mono>; Zod in{' '}
        <Mono>StationSettings</Mono>), then passes them on by itself. Which dishes it holds is decided by the
        links into it like any station, so filters by order type, revenue stream, till, dish or section (or
        none) need nothing new; links out may have filters. It is time based: <Mono>flowTimes(item, cfg, at)</Mono>{' '}
        counts a Sleeper done at <Mono>wakes(id)</Mono> = arrived + delay, and only once <Mono>at</Mono> is that
        late (no <Mono>at</Mono>: not done), so the next station&apos;s <Mono>arrived()</Mono> is null until then
        and the screen, the bench and the board see the dish arrive as their clocks pass the time, with no event.{' '}
        <Mono>nodeState()</Mono> at the Sleeper is <Mono>sleeping</Mono>; <Mono>itemWhere()</Mono> includes it (so
        refusals say Still at it) and <Mono>itemSleeps()</Mono> gives <Mono>{'[{ station_id, until }]'}</Mono>;{' '}
        <Mono>stationTickets()</Mono> puts <Mono>sleeps</Mono> on each upcoming item (and leaves the Sleeper out of{' '}
        <Mono>where</Mono>) and <Mono>sleeping_until</Mono> on a ticket whose only dishes are asleep, and times
        the pass with <Mono>workSince()</Mono> (first arrival at a bump station, else the wake time) instead of{' '}
        <Mono>liveSince()</Mono>. A forced finish (the pass bumping dishes still on their way, an order set ready
        from outside) marks the Sleeper done too; a remake records the Sleepers already passed in{' '}
        <Mono>item.slept</Mono>, which pass straight through afterwards. No kitchen screen (<Mono>BUMP_KINDS</Mono>),
        bumps refused, never a Splitter&apos;s output. Kitchen printers after a Sleeper print through the minute
        sweep (<Mono>kitchenPrintsDue()</Mono> asks <Mono>printsDue()</Mono> with the time now, so a wake is
        printed within a minute). Order status only changes on events, so a dish whose way ends at a Sleeper
        (no station after it) makes no difference to when an order is ready. A shared flow&apos;s Sleeper box
        takes each location&apos;s own station of that name and its own minutes.
      </P>
      <P>
        <strong>Splitters</strong> (migration 183; the kind stays <Mono>balance</Mono>, and the code keeps the balance names: <Mono>balanceTicket()</Mono>, <Mono>kds_balance_turns</Mono>): a station of kind <Mono>balance</Mono> shares work
        between the stations it links to (prep, expo or runner only, links out without filters:{' '}
        <Mono>flowProblems()</Mono>; fewer than two is a warning). <Mono>itemRoute()</Mono> still walks
        through it (so Check a dish shows both); <Mono>resolveBalances(route, cfg, pick)</Mono> then takes
        each box out of a dish&apos;s way, keeping only the picked station and what follows it
        (<Mono>collapseBalance()</Mono>, also used by the tests). <Mono>balanceTicket(items, cfg, at)</Mono>{' '}
        decides every box on the dishes one event sends or fires, upstream boxes first
        (<Mono>flowBoxes()</Mono>), changing their ways in place: by default the whole ticket goes to the
        output with the lowest <Mono>stationLoad()</Mono> (every fired dish on its way to that station not
        yet done, counted with the box&apos;s <Mono>settings.pieces</Mono>, the same member shape and{' '}
        <Mono>memberCount()</Mono> as On order counts; a dish no member names counts its quantity), a tie
        going to the first after the box&apos;s last pick. With <Mono>settings.split_above = N</Mono> and
        more than N pieces of the ticket reaching the box, each unit (a dish line, or a meal deal part; the
        deal&apos;s own options count with its first part there; <Mono>unitPieces()</Mono>) goes, biggest
        first, to the output with the lowest load plus what this ticket already put there, ties taking
        turns; a line&apos;s quantity is never split. A meal deal&apos;s way is its parts&apos; ways merged.
        It runs in <Mono>lines.sent</Mono> (held lines keep the box until <Mono>course.fired</Mono>{' '}
        decides them) and <Mono>kitchen.order_in</Mono> (online and GloriaFood orders, later ones too). The sequencer gives
        those events <Mono>cfg.balance = {'{ open, last, picks }'}</Mono> through the store&apos;s{' '}
        <Mono>loadOpenKitchenOrders()</Mono> / <Mono>loadBalanceTurns()</Mono> and saves{' '}
        <Mono>picks</Mono> with <Mono>saveBalanceTurns()</Mono> (<Mono>kds_balance_turns</Mono>); the test
        bench keeps both in memory. A box is never on a kitchen screen (<Mono>BUMP_KINDS</Mono> everywhere
        stations are listed for screens), refuses bumps, and is passed straight through by{' '}
        <Mono>flowTimes()</Mono> like a board. Making a station a box drops its links to non-bumping
        stations and its links&apos; filters (<Mono>tidyBalanceBox()</Mono>); pieces must name the
        tenant&apos;s dishes.
      </P>
      <P>
        <strong>Splitter modes</strong> (no migration: settings jsonb). <Mono>settings.share_mode</Mono>{' '}
        (<Mono>SHARE_MODES</Mono>: <Mono>pieces</Mono> | <Mono>speed</Mono>) and the busy order type rule{' '}
        <Mono>rush_type_id</Mono> / <Mono>rush_count</Mono> (1 to <Mono>RUSH_COUNT_MAX</Mono> 99, default 5) /{' '}
        <Mono>rush_station_id</Mono> (both ids or neither; off = no type). <Mono>balanceTicket(items, cfg, at, ko)</Mono>{' '}
        now takes the kitchen order (its <Mono>type</Mono>; the three call sites pass it) and picks the
        output with the lowest score, <Mono>(load + pieces added) x pace</Mono>, a tie (within 1e-6) to the
        first after the last pick. Pace is 1 everywhere for <Mono>pieces</Mono> (so it is the old rule);
        for <Mono>speed</Mono> it is <Mono>stationPace(orders, stationId, members, cfg, at)</Mono> over{' '}
        <Mono>cfg.balance.recent</Mono> (else <Mono>open</Mono>): seconds per piece over the station&apos;s
        last <Mono>PACE_TICKETS</Mono> (8) bumps in the <Mono>PACE_MINUTES</Mono> (30) before{' '}
        <Mono>at</Mono>, each counted from the later of its <Mono>started_at</Mono> and the station&apos;s
        bump before it (queueing time isn&apos;t counted twice), pieces by <Mono>piecesAt()</Mono> (the
        same count as <Mono>stationLoad()</Mono>), recalled bumps left out, null with fewer than two
        bumps, never under 1 s a piece; unknown paces take the others&apos; average (<Mono>fillPaces()</Mono>).
        The busy rule (<Mono>busyTypeStations()</Mono>) applies when the box links to{' '}
        <Mono>rush_station_id</Mono> and has two or more outputs: <Mono>typeWaiting()</Mono> counts
        open orders of the type (not the order itself) with a live dish active or upcoming at any output,
        plus one when the order is of that type; at <Mono>rush_count</Mono> or more the order&apos;s
        tickets may go only to the rush station (type) or only to the others (any other order), big
        tickets shared among those. The sequencer adds <Mono>recent</Mono> only when a box uses{' '}
        <Mono>speed</Mono>, from the store&apos;s <Mono>loadRecentKitchenOrders(PACE_MINUTES * 2)</Mono>{' '}
        (kds_orders of any status changed in that many minutes, bounded by <Mono>created_at</Mono> for
        the index); the test bench passes its own orders. API: <Mono>StationSettings</Mono> (refine: type
        and station together), <Mono>checkSplitterRule()</Mono> (the tenant&apos;s order type; a bumping
        station of the venue, not the box; other kinds keep no Splitter settings),{' '}
        <Mono>dropBusyStation()</Mono> clears the rule from Splitters when its station is deleted or stops
        bumping. <Mono>flowWarnings()</Mono> warns when a box&apos;s rule names a station it doesn&apos;t
        link to (the flow PUT now loads station settings for it). Admin: <Mono>StationModal</Mono>{' '}
        (How it shares, <Mono>BusyTypeRule</Mono> with <Mono>linkedFrom()</Mono> putting linked stations
        first), the station row, and <Mono>balanceRule()</Mono> / <Mono>busyRule()</Mono> in{' '}
        <Mono>KitchenFlow.jsx</Mono> (box note, link panel, Check a dish).
      </P>
      <P>
        <strong>Flow timers</strong> (migration 265, 22 Nov 2026): <Mono>kds_flows.timers</Mono> jsonb, each
        a start (<Mono>start</Mono> = when the dish went live, or a station / box: when the dish reached it or
        was done there, <Mono>flowTimes()</Mono>) and an end (a prep, expo or runner station / box: the dish&apos;s
        tap there, <Mono>item.done[to]</Mono>), per dish or per ticket, with a target. The rules are{' '}
        <Mono>shared/pos/kitchenTimers.js</Mono>: <Mono>normaliseTimers()</Mono>, <Mono>timerProblems()</Mono>{' '}
        (blocks saving; the designer shows the same list), <Mono>resolveTimers()</Mono> (a shared flow&apos;s box
        ids to the venue&apos;s station ids through <Mono>resolveSharedFlow().matches</Mono>),{' '}
        <Mono>timerSpan()</Mono> (one dish: only when its route has both points with the start before the end,
        not voided, tapped at the end) and <Mono>timerResults()</Mono> / <Mono>summarise()</Mono> (count, average,
        median and p90 as Postgres&apos;s percentile_cont, max, on time, the five slowest). Results are worked
        out after the fact by <Mono>kitchenTimers()</Mono> (kitchenSvc) from <Mono>kds_orders.state</Mono> for
        the kitchen report and Pepper&apos;s <Mono>kitchen_report</Mono>; nothing in the sequencer, the kitchen
        screens or the venue hub reads them, and no event or log row changed. Copies carry timers the way
        they carry links (a venue&apos;s flow shared keeps them, box id = station id; a shared flow copied to a
        venue keeps those whose boxes match); the store setup copy remaps their ids like any jsonb. The
        designer draws them as dotted violet arrows in lanes under the boxes (<Mono>timerPath()</Mono> in{' '}
        <Mono>KitchenFlow.jsx</Mono>), apart from the solid links and the dashed wire being dragged.
      </P>
      <P>
        <strong>Stations out of a flow</strong> (migration 182): <Mono>kds_flows.off_station_ids</Mono>{' '}
        (uuid[], default empty) are the venue&apos;s stations a flow leaves out. The designer doesn&apos;t
        draw them (Not in this flow lists them with Put back) and{' '}
        <Mono>PUT /api/pos/kds-flows/:id</Mono> refuses a link to or from one (422 &quot;X is out of this
        flow: put it back before linking it&quot;) and any id that isn&apos;t one of the venue&apos;s stations,
        so routing needs no change: with no link reaching it, <Mono>itemRoute()</Mono> never sends a dish
        there, and the kitchen screen&apos;s flow list (<Mono>station_ids</Mono>, from the links) leaves it
        out. <Mono>flowWarnings()</Mono> is given only the stations in the flow, so an out station
        isn&apos;t reported as off every dish&apos;s way. Copying a flow copies the list; ids of stations
        deleted later are ignored when read. A station out of every flow is simply never reached; it
        keeps its screens and settings.
      </P>
      <P>
        A dish <em>arrives</em> at a node when every node before it is done (<Mono>flowTimes()</Mono>;{' '}
        <Mono>item.reset[node]</Mono> moves the arrival on after a remake) and is <em>done</em> there when
        that station bumps it (<Mono>item.done[node]</Mono>); a board is done when reached.{' '}
        <Mono>nodeState()</Mono> gives held | upcoming | active | done | voided. Prep stations bump only
        arrived dishes; an expo or runner with <Mono>show_upcoming</Mono> (default on for expo) also
        finishes dishes still at earlier stations. Undoing a dish or bringing a bump back is refused with{' '}
        <Mono>moved_on</Mono> once a later station has done it. A remake at a prep station clears that
        station and everything after it; at an expo or runner it starts the dish again from Orders in.
      </P>
      <P>
        <strong>The packing check</strong> (no migration: kitchen order state and station settings). At an
        expo or runner (<Mono>isOrderLevel()</Mono>) a tap sends <Mono>kitchen.item_checked</Mono>{' '}
        <Mono>{'{ order_id, station_id, item_id, checked }'}</Mono> instead of <Mono>kitchen.item_done</Mono>:
        it sets or clears <Mono>item.checked[stationId]</Mono> (the time) and changes nothing about where the
        dish is, so the ticket stays until READY / DONE (<Mono>kitchen.bumped</Mono>). Refused at prep
        stations (<Mono>station</Mono>: they mark dishes done), for voided and held dishes, dishes not on
        their way to the station, dishes already done there (<Mono>nothing</Mono>: Prev brings the ticket
        back), the same value twice (<Mono>nothing</Mono>) and, without <Mono>show_upcoming</Mono>, a dish still
        at an earlier station (<Mono>upcoming</Mono>). Ticking a dish that is still upcoming marks it done at
        every station before (<Mono>finishBefore()</Mono>: it is in front of the pass), without a bump
        record there. With the station setting <Mono>bump_when_checked</Mono> (default false;{' '}
        <Mono>STATION_DEFAULTS</Mono>, <Mono>StationSettings</Mono>, expo / runner only in the admin), the tick
        that leaves every dish the station would bump (<Mono>bumpable()</Mono>) ticked runs the same bump as
        READY (<Mono>bumpStation()</Mono>, now shared with <Mono>kitchen.bumped</Mono>) with{' '}
        <Mono>by_items: true</Mono> on the bump record and a <Mono>kds_log</Mono> bump row. Ticks go with a
        remake (<Mono>delete item.checked</Mono>) and when the dish is sent back before the station: an
        undone dish or a recalled bump at an earlier station clears the ticks at every station after it
        (<Mono>untickAfter()</Mono>), so a stale tick never counts towards the last-tick bump. Recalling the
        pass&apos;s own bump keeps its ticks. <Mono>stationTickets()</Mono> gives each item{' '}
        <Mono>ticked</Mono> and each ticket <Mono>ticked</Mono> (a count) and <Mono>all_ticked</Mono>{' '}
        (every dish to bump there, active or upcoming with <Mono>show_upcoming</Mono>, ticked); the screen
        shows CHECKED and the All ticked off top. (A meal deal&apos;s parts one by one: next paragraph.) Devices still on an older copy of the app send{' '}
        <Mono>kitchen.item_done</Mono> at the pass, which keeps working (done, and the last one bumps).
      </P>
      <P>
        <strong>A meal deal&apos;s parts one by one</strong> (no migration: kitchen order state).{' '}
        <Mono>kitchen.item_done</Mono> and <Mono>kitchen.item_checked</Mono> take an optional{' '}
        <Mono>parts</Mono> (1 to 60 places in <Mono>item.parts</Mono>, checked by{' '}
        <Mono>kitchenEventProblem()</Mono>). The parts a station shows come from{' '}
        <Mono>stationPartIndexes()</Mono> in <Mono>shared/pos/kitchen.js</Mono>: at a prep station the parts
        routed to it (<Mono>part.route[station]</Mono>), at the pass and runners every part; naming another
        part is refused with code <Mono>parts</Mono> (&quot;Fries isn&apos;t made at Grill&quot;), and so is{' '}
        <Mono>item_done</Mono> with parts at the pass (code <Mono>station</Mono>: it ticks parts off). Parts
        done or ticked off are kept in <Mono>item.part_ticks[stationId]</Mono>{' '}
        <Mono>{'{ [index]: when }'}</Mono> until the last of the station&apos;s parts is named: that event
        counts as the whole dish (done, with the bump the last dish of a ticket makes; or ticked off, with the
        last-tick bump under <Mono>bump_when_checked</Mono>) and drops the part ticks, so they are always
        some, never all, of a station&apos;s parts, and the dish still moves on as one. A BUMP (or READY) with
        parts half ticked keeps them beside the finished dish, so Prev brings the ticket back with them as they
        were; while the dish is done or ticked off there it counts as every part ticked. Undoing a part of a
        dish not yet done takes just that part off; undoing a part of a dish done (or ticked off) there
        undoes the dish and keeps its other parts ticked, at the dish&apos;s time; undoing the whole dish, a
        remake (<Mono>kitchen.remake</Mono>) and the dish sent back to an earlier station (
        <Mono>untickAfter()</Mono>) drop them. A part tick isn&apos;t a dish ticked: tickets count only whole
        dishes, so CHECKED waits for every part. <Mono>stationTickets()</Mono> gives each item&apos;s{' '}
        <Mono>parts</Mono> with <Mono>index</Mono> and <Mono>ticked</Mono> (all of them once the dish is
        done or ticked off there) and <Mono>parts_ticked</Mono>; <Mono>partRows()</Mono> groups them as the
        screen shows them (<Mono>countParts()</Mono>: &quot;2 x Ketchup pot&quot; once, with both places as{' '}
        <Mono>indexes</Mono>, ticked when all are). Kitchen screen: each part row is its own 48 px target (
        <Mono>kds-part-row</Mono>, <Mono>data-parts</Mono>, <Mono>data-ticked</Mono>, <Mono>kds-part-tick</Mono>)
        sending <Mono>itemDone()</Mono> / <Mono>itemChecked()</Mono> in <Mono>pos/src/kitchen/store.js</Mono>{' '}
        with the row&apos;s indexes; the dish row shows <Mono>kds-parts-count</Mono> (1/3) while some are
        ticked. The test bench applies the same events. Tests:{' '}
        <Mono>shared/pos/test/kitchenParts.test.mjs</Mono>, <Mono>api/test/kitchen-parts.test.mjs</Mono>.
      </P>
      <P>
        <strong>Ticket colours</strong> (migration 207): <Mono>pos_settings.kds_colours</Mono> jsonb{' '}
        <Mono>{'{ states: { [key]: \'#rrggbb\' }, sections: [{ name, colour }] }'}</Mono>, per venue, written by{' '}
        <Mono>PATCH /api/pos/venues/:id/settings</Mono> (<Mono>kds_colours</Mono>: Zod checks keys and codes,
        then <Mono>normaliseKitchenColours()</Mono> stores it cleaned: lower case, names trimmed and spaces
        collapsed, each section name once ignoring case, at most <Mono>SECTION_COLOURS_MAX</Mono> 100;{' '}
        <Mono>configChanged()</Mono> tells the screens). <Mono>shared/pos/kitchenColours.js</Mono> is the one
        implementation: <Mono>KITCHEN_COLOURS</Mono> (12 keys in groups dish / head / timer, each with the
        standard <Mono>bg</Mono>, <Mono>ink</Mono> and <Mono>dim</Mono>: todo, ticked, upcoming, held, voided,
        head, head_new, head_rush, head_prepared, head_checked, timer_warn, timer_late),{' '}
        <Mono>ticketColours(colours)</Mono> (a set colour gets <Mono>inkOn()</Mono> words: black when its
        luminance is over 0.6, else white; a held row with its own colour dims to 0.65),{' '}
        <Mono>sectionColour()</Mono>, <Mono>sectionColoursById()</Mono>, <Mono>sectionKey()</Mono>.{' '}
        <Mono>kdsConfig()</Mono> sends <Mono>colours: {'{ states, sections: { [sectionId]: colour } }'}</Mono>:
        sections match by name over the venue&apos;s menus (draft tables and the live versions, so a section
        renamed before publishing keeps the colour of either name). Kitchen items and meal deal parts carry{' '}
        <Mono>section_id</Mono> (<Mono>itemFromLine()</Mono> / <Mono>itemFromOnline()</Mono>; a typed-in part
        takes the combo&apos;s section). The kitchen screen draws rows, tops, the RUSH chip and the timer from
        these with inline styles (<Mono>rowLook()</Mono>, the head key rush &gt; new &gt; checked &gt;
        prepared &gt; head), names and parts in their section colour except on voided rows. The test bench
        passes the venue&apos;s colours to its screens (<Mono>kitchenTestData()</Mono>). A new location
        copies them (<Mono>storeSetup.js</Mono>). Admin: <Mono>components/pos/KitchenColours.jsx</Mono>{' '}
        (<Mono>TicketColoursCard</Mono> on Store tech → Kitchen screens with <Mono>TicketPreview</Mono>, one
        Save) and the station window&apos;s Ticking off dishes choice.
      </P>
      <P>
        An order is <Mono>ready</Mono> (<Mono>orderFacts()</Mono>) when every dish has reached every board
        and runner on its way, and dishes with neither are done everywhere; it becomes{' '}
        <Mono>collected</Mono> by itself when everything is done and every dish's way ends at a runner
        (the runner handed it over), else when Collected is tapped. <Mono>boardState()</Mono> and{' '}
        <Mono>boardNumbers({'{ boardId, cfg }'})</Mono> give each board's own preparing / ready lists.{' '}
        <Mono>flowProblems()</Mono> (blocks saving: links to missing stations, out of a board, to itself,
        twice, unknown filters, circles) and <Mono>flowWarnings()</Mono> (nothing comes in, stations on no
        dish's way) are shared by the API and the designer.
      </P>
      <DataTable
        head={['Event', 'Payload', 'From']}
        rows={[
          ['kitchen.item_done', '{ order_id, station_id, item_id, done }', 'screen (a prep station: the dish goes on; the last one done bumps the ticket)'],
          ['kitchen.item_checked', '{ order_id, station_id, item_id, checked }', 'screen at an expo or runner: the packing check (ticks a dish off; nothing moves unless the station bumps when every dish is ticked)'],
          ['kitchen.bumped / kitchen.recalled', '{ order_id, station_id }', 'screen (the dishes go on to the next station; an expo / runner bump can make the order ready; recall undoes the last bump unless a later station has done its dishes)'],
          ['kitchen.remake', '{ order_id, station_id, item_id, reason? }', 'screen (item active again, logged)'],
          ['kitchen.priority', '{ order_id, on }', 'screen (rush)'],
          ['kitchen.collected', '{ order_id }', 'screen (pass, after ready)'],
          ['kitchen.order_in', '{ order }', 'server only: an online order (refused from devices)'],
          ['kitchen.order_status', '{ order_id, status: ready | collected | cancelled }', 'server only: the online order changed on the orders board'],
        ]}
      />
      <P>
        Kitchen events need no staff member, don't open a trading day, and are refused with code{' '}
        <Mono>kitchen_off</Mono> at a venue with no stations. Refusals stay out of Till reports' Refused
        changes. The sequencer's store gains <Mono>loadKitchenOrders()</Mono>,{' '}
        <Mono>saveKitchenOrders()</Mono> and <Mono>saveKitchenLog()</Mono> (Postgres in{' '}
        <Mono>services/posSvc.js</Mono>; the in-memory test store and the future SQLite one do the same).
      </P>
      <DataTable
        head={['Table', 'What it holds']}
        rows={[
          ['kds_stations', 'Per venue: name, kind prep | expo | runner | board | balance (183, a Splitter) | printer (191) | sleeper (200), colour, settings jsonb { target_mins, late_mins, show_held, show_upcoming, summary_groups: [{ id, name, members: [{ kind dish | option, id | label, qty }] }], pieces (a Splitter: members, same shape), split_above (a Splitter: null = each ticket on one station, N = share a ticket with more than N pieces), share_mode (a Splitter: pieces | speed), rush_type_id / rush_count / rush_station_id (a Splitter\'s busy order type rule), printer_id (a printer box), delay_mins (a Sleeper, 1-240), bump_when_checked (an expo or runner: the last dish ticked off bumps the ticket) }, sort_order, is_active.'],
          ['kds_balance_turns', 'Each Splitter\'s last pick (183): station_id (the box, PK, ON DELETE CASCADE), last_station_id, updated_at. Written by the sequencer (saveBalanceTurns()) so a tie goes to the next station. Forced RLS.'],
          ['kds_flows', 'A venue\'s kitchen flows (177): name (1-40, unique per venue ignoring case and spaces), layout jsonb { [stationId | start]: { x, y } } (where the designer draws each box), sort_order (the kitchen screen\'s list), off_station_ids uuid[] (182: the venue\'s stations this flow leaves out), timers jsonb (265: [{ id, name, from (\'start\' or a station / box id), from_when reached | done, to (a prep, expo or runner station / box), per dish | ticket, target_mins 1-240 }], at most 20, tidied by normaliseTimers() and checked by timerProblems() in shared/pos/kitchenTimers.js; read only by the kitchen report, never by the sequencer, screens or hub). Forced RLS like every tenant table. The migration made one "Main flow" per venue with stations or links, holding its links and layout, in use. A venue without any flow gets it from GET .../setup (ensureFlows()). Shared flows (192): venue_id NULL, boxes jsonb [{ id, name, kind }], box_links jsonb [{ id, from, to, targets }] (layout keys are box ids), names unique per tenant (index kds_flows_shared_name); a venue\'s own flow can\'t take a shared flow\'s name, a shared one can\'t take any flow\'s.'],
          ['kds_flow_edges', 'A flow\'s links (169, flow_id NOT NULL since 177, ON DELETE CASCADE with the flow): from_station_id (NULL = Orders in), to_station_id (both ON DELETE CASCADE), targets jsonb, exclude boolean (204: All except these, the link takes every dish its targets don\'t name; kept false when targets is empty), sort_order. One link per pair per flow (unique index on flow_id, from, to). Read them by flow_id, never by venue alone. Replaced kds_routes: each station\'s routes became one link from Orders in, every prep station got a link to every expo.'],
          ['kds_orders', 'Projection (like pos_checks): id text (a check id, web-<orders.id> or gf-<gloriafood_orders.id>), source till | online | gloriafood (178; taken from the id prefix by applyKitchenEvent(), never from the payload), check_id / order_id, status active | ready | collected | cancelled, state jsonb (the whole kitchen order), last_seq.'],
          ['kds_log', 'One row per bump and remake: station (id, name, kind), seconds since the dishes arrived or were fired, items, order source / type / number, reason, recalled_at (a recalled bump is left out of the report). Feeds the Kitchen report and its CSV.'],
          ['pos_devices', 'kind kds; settings { station_ids, view tickets | on_order, columns, text_size, sound, can_switch_flow (absent = true: its flow button may put another flow in use), ticket_main auto | number | tent | table | name (the ticket header\'s title: ticketTitle() in pos/src/kitchen/KitchenApp.jsx; auto or absent = table, tab or guest name with the order number beside it; another field falls back to auto when the order lacks it) }.'],
          ['pos_settings', 'kds_online_orders (send accepted online orders), kds_online_ready (ready in the kitchen marks the online order ready, collected completes it; for GloriaFood orders: their board status), kds_gloriafood (178, default off: send GloriaFood orders), kds_gloriafood_types jsonb ({ pickup | delivery | dine_in | order_ahead | table_reservation: order type id | null }; a key left out is matched by name by gloriaFoodTypes()), kds_gloriafood_lead_mins (0-240, default 20: an order for later comes on this long before its time), kds_active_flow_id (the flow in use, ON DELETE SET NULL; NULL = the first), kds_flow_switched_at / kds_flow_switched_by (the last switch: a screen\'s name or a person\'s email). kds_flow_layout moved to kds_flows.layout (177).'],
        ]}
      />
      <H3>API</H3>
      <DataTable
        head={['Route', 'What it does']}
        rows={[
          ['GET /pos-api/config (kds device)', 'kdsConfig(): stations (active only, boards too), flow (the links of the flow in use, a shared one resolved at the venue), flows [{ id, name, shared, station_ids (the stations its links send dishes to, in station order) }], active_flow_id, flow_switched_at / flow_switched_by, the device\'s settings, courses, venue name and time zone. No staff, PINs or menus. version changes with any of them, so a switch reaches every screen through pos.config.'],
          ['PUT /pos-api/kitchen/flow', '{ flow_id } from a kds device\'s flow button: switchFlow() with the screen\'s name as switched_by; returns { flow_id, name, switched_at, switched_by, changed } (changed false: already in use). 403 for any other device kind or a screen with can_switch_flow false (read fresh from pos_devices), 404 for a flow not at its venue. Broadcasts pos.config. Online only (the screen says so offline).'],
          ['GET /pos-api/kitchen/sync?since=', 'Kitchen orders changed since a seq (reset with every live order when far behind) and server_time for the screen\'s clock.'],
          ['POST /pos-api/events', 'Takes kitchen events from kds devices (server-only types refused). The answer has kitchen (orders touched). Broadcasts pos.seq with kinds [checks | kitchen] (tills skip kitchen-only changes) and kitchen.board to screens:<venue>.'],
          ['/api/pos/venues/:id/kds-stations, /kds-stations/:id, .../kds-stations/order', 'Stations (pos_setup manage). Turning a station into a board drops its links onward and takes it off kitchen screens; a kitchen screen can\'t show a board (422).'],
          ['PUT /api/pos/kds-flows/:id', '{ links: [{ from, to, targets, exclude }], layout, off_station_ids, timers } replaces one flow\'s links, layout and the stations it leaves out (182; no list = none out; a link touching one is 422) (pos_setup manage). 422 with the first flowProblems() message (links name the flow\'s venue\'s stations); dish / section / revenue stream / order type ids must be the tenant\'s; layout keys that aren\'t start or a station are dropped. Returns { id, links, layout, off_station_ids, warnings }. Device filters name the venue\'s tills and kiosks. A shared flow takes { boxes, links, layout } instead (box ids are uuids, boxProblems() and flowProblems() on the boxes, links only between boxes, stream and device filters by name, menu ids checked) and returns { id, shared, boxes, links, layout, warnings }, warnings including each location that lacks a box\'s station or has one of another kind; it broadcasts pos.config to every venue. GET /api/pos/venues/:id/setup returns kds_flows (own then shared: [{ id, name, sort_order, layout, shared, off_station_ids, links, boxes? }]), kds_active_flow_id, kds_flow_switched_at / _by, kds_locations [{ id, name, active_flow_id, stations }] (every venue, for matching boxes) and kds_shared_names { revenue_stream, device } (every active name, once). Deleting a revenue centre takes it out of every filter of every own flow (a link left with no filter goes; an Except link left with none becomes a link for every dish); shared flows name streams, so nothing to drop. exclude without targets is saved as false; an Except link can\'t name every dish (default) and links out of a Splitter can\'t be Except (they take no filter).'],
          ['POST /api/pos/venues/:id/kds-flows', '{ name, copy_from?, shared? } a new flow at the end of its list: empty, or a copy of copy_from (one of this venue\'s flows or a shared one, else 404). shared true makes it shared (pinActiveFlows() first). Copies go either way: own to shared with shareFlow(); shared to own with resolveSharedFlow() (links whose stream / till filters all name nothing here are dropped, unmatched stations go to off_station_ids, the layout follows the matches). 422 when the name is taken.'],
          ['PATCH / DELETE /api/pos/kds-flows/:id', 'Rename ({ name }, 422 when taken); delete (422 for the flow in use: put another in use first; takes the till lock so it can\'t race a switch). A shared flow: 422 "in use at X" while any venue has it in use (after pinActiveFlows()); both broadcast to every venue.'],
          ['PUT /api/pos/kds-flows/shared/order', '{ ids } the shared flows\' order, the same at every location (pos_setup manage; pinActiveFlows() first).'],
          ['PUT /api/pos/venues/:id/kds-flows/order, .../kds-flows/active', 'order: { ids } sort order (keeps the flow in use in use, writing its id down if it was only "the first"); active: { flow_id } switchFlow() with the person\'s email as switched_by. Both pos_setup manage; both broadcast pos.config.'],
          ['GET /api/pos/venues/:id/kitchen-report[.csv]?from=&to=', 'Per station: tickets, items, average, median, p90, max, on time (within target_mins), late; by hour; remakes. timers (265): every timer of the venue\'s flows (own then shared) as { flow_id, flow_name, flow_in_use, id, name, from_name, to_name, from_when, per, target_mins, missing, count, avg_secs, median_secs, p90_secs, max_secs, on_time, on_time_pct, slowest [{ number, item, seconds, at }] }, worked out by kitchenTimers() (kitchenSvc) over the kds_orders created in the period (at most 20,000: timers_capped); missing = a shared flow\'s box with no station of its name here. CSV: every bump and remake (pos_reports view).'],
          ['POST /api/pos/venues/:id/kitchen-test', 'A signed link to the kitchen test bench (pos_setup view): { token, url } (8 hours). See The kitchen test bench below.'],
          ['GET /pos-api/kitchen-test?token=', 'The bench\'s data (kitchenTestData()): stations, courses, order types, flows with their links, kitchen screens, tables, revenue streams, the live menus\' dishes (no prices) and expires_at. 401 for a bad, run out or other-kind link; 404 when the link\'s venue isn\'t its tenant\'s. Reads only.'],
          ['POST /api/pos/venues/:id/kitchen-live', 'A signed link to the live kitchen view (pos_setup view): { token, url, expires_at, can_bump } (12 hours, kind kitchen_live). The link carries b: 1 and by (the maker\'s email) only when the maker has pos_setup manage (permissionLevel()): only then may the page bump. See The live kitchen view below.'],
          ['GET /pos-api/kitchen-live?token=', 'The live view\'s setup (kitchenLiveData()): the kitchen screen config without printers, the venue\'s kitchen screens not removed ({ id, name, short_code, settings, linked, last_seen_at }), its order ready boards (boards: { screens: orderBoardScreens(), stations: the board stations { id, name }, address: screensOrigin() }), can_bump (the link\'s b), expires_at and server_time. 401 (code link) for a bad, run out or other-kind link; 404 when the link\'s venue isn\'t its tenant\'s. Reads only.'],
          ['GET /screen-api/live/config?token=&screen=<id> | &board=<board station id | all>[&version=]', 'A live view board\'s config, by the same signed link (never a screen pairing): liveScreenConfig() (the venue\'s menu screen as screenConfig() gives it, no venue hub; 404 code gone for another venue\'s screen) or liveBoardConfig() (a plain 1920 x 1080 board, one Order status block of that board station\'s numbers or of every order; 404 for a station that isn\'t the venue\'s active board). Exactly one of screen / board (400). { unchanged, version } when the version matches. 401 code link as above. Rate limit 240 a minute.'],
          ['GET /screen-api/live/orders?token=', 'boardFor() for the link\'s venue, as GET /screen-api/orders gives a screen. Same 401.'],
          ['GET /pos-api/kitchen-live/sync?token=&since=', 'The venue\'s kitchen orders as GET /pos-api/kitchen/sync gives a kitchen screen (kitchenSync(): reset from 0 or a sequence the server doesn\'t know, then what changed), plus source: cloud. Same 401 / 404. Reads only.'],
          ['POST /pos-api/kitchen-live/events?token=', '{ screen_id, events } the live view\'s taps while its Allow bumping switch is on (5 Nov 2026). 403 code view_only for a link that can only watch (no b); 404 when screen_id is neither a kitchen screen of the link\'s venue (pos_devices kind kds, not removed) nor an active bumping station of it (One per station). Only KITCHEN_DEVICE_EVENTS (item_done, item_checked, bumped, recalled, remake, priority, collected); any other type is refused on its own (code view_only). The rest go through takeEvents() as device live:<screen id> (kind kds, the link\'s tenant and venue) with actor "Live kitchen view (<email>)", so deviceEvent(), the sequencer, the broadcasts and afterKitchen() (online orders\' and GloriaFood\'s board status) run as for a kitchen screen. Same 401. Rate limit 240 a minute; at most MAX_BATCH events.'],
          ['GET /screen-api/orders', 'boardFor(): { preparing, ready } for every counter and online order, and boards: { [board station name, lower case]: { preparing, ready } } per order ready board, for the Order status block (opts.board picks one by name; screens with one get needs_orders in their config, poll every 15 s and refetch on kitchen.board).'],
        ]}
      />
      <H3>Online orders</H3>
      <P>
        <Mono>orderSvc.js</Mono> calls <Mono>kitchenOnOnlineOrder()</Mono> (<Mono>services/kitchenSvc.js</Mono>)
        after an order is placed or changes status. Accepted (or auto-accepted) orders go in through{' '}
        <Mono>submitServerEvent('kitchen.order_in')</Mono> with <Mono>onlineSnapshot()</Mono> (items routed
        like till dishes; <Mono>fire_at</Mono> = collection time minus the ordering lead time for later
        orders); ready / completed / rejected / cancelled on the orders board follow as{' '}
        <Mono>kitchen.order_status</Mono>. The other way, a pass bump or collect calls{' '}
        <Mono>changeStatus()</Mono> (actor "Kitchen screen &lt;name&gt;") when{' '}
        <Mono>kds_online_ready</Mono> is on, so the guest gets the ready email.
      </P>
      <H3>GloriaFood orders (migration 178)</H3>
      <P>
        <Mono>kitchenOnGloriaFood(tenantId, venueId, ids)</Mono> (<Mono>services/kitchenSvc.js</Mono>) runs
        after <Mono>gloriafood_orders</Mono> rows are stored or updated (<Mono>ingestWithTx()</Mono> returns
        their <Mono>ids</Mono>; <Mono>ingestOrders()</Mono> and <Mono>pollVenue()</Mono> call it once the
        transaction has committed, not awaited, since GloriaFood wants its answer within 15 s) and after{' '}
        <Mono>POST /api/orders/gloriafood/:id/status</Mono>. It holds an advisory lock per venue
        (<Mono>gf-kitchen:&lt;venue&gt;</Mono>) while it reads the rows and submits, so an order and its
        cancellation pushed together land in that order; the rows are read fresh by id, never taken from
        the push. For a row not yet in the kitchen: only when <Mono>kds_gloriafood</Mono> is on, the
        status is accepted, the board status isn&apos;t ready / completed, the order isn&apos;t imported
        (<Mono>received_via = 'import'</Mono>) and its fulfil (or accepted) time is less than two hours
        past, <Mono>kitchen.order_in</Mono> with <Mono>gloriaFoodSnapshot()</Mono>: id{' '}
        <Mono>gf-&lt;uuid&gt;</Mono>, number = GloriaFood&apos;s order id, guest first name, table number,
        type from <Mono>gloriaFoodTypes()</Mono> (type_name = our type&apos;s name, else GloriaFood&apos;s
        label), note = instructions (test orders, <Mono>source = 'admin'</Mono>, get &quot;GloriaFood test
        order&quot;), <Mono>fire_at</Mono> = fulfil time minus <Mono>kds_gloriafood_lead_mins</Mono> for{' '}
        <Mono>for_later</Mono> orders. Dishes keep GloriaFood&apos;s options (&quot;2 x Extra egg&quot;)
        and are matched by name to the venue&apos;s live menus (<Mono>dishMatcher()</Mono>: lower case,
        spaces collapsed, first match wins), which gives them <Mono>item_id</Mono> / <Mono>section_id</Mono>{' '}
        for the flow&apos;s dish and section links and the menu&apos;s name (kitchen name if set); no match
        routes by order type and default links. For a row already in the kitchen:{' '}
        <Mono>kitchen.order_status</Mono> cancelled (status canceled in GloriaFood), ready (board ready) or
        collected (board completed). The other way, <Mono>onlineMoves()</Mono> returns GloriaFood moves too
        and <Mono>afterKitchen()</Mono> in <Mono>posApi.js</Mono> sets <Mono>board_status</Mono> ready (from
        accepted / preparing) or completed, <Mono>board_status_by</Mono> &quot;Kitchen screen &lt;name&gt;&quot;,
        and broadcasts <Mono>order.updated</Mono> (source gloriafood) when <Mono>kds_online_ready</Mono> is
        on. GloriaFood itself is never told. A change to an order&apos;s dishes after it reached the kitchen
        isn&apos;t copied. Store tech: <Mono>GET .../setup</Mono> returns <Mono>gloriafood</Mono>{' '}
        (<Mono>{'{ show_on_board, types }'}</Mono>, null without a link); the PATCH checks type ids are the
        tenant&apos;s (422). Tests: <Mono>api/test/gloriafood-kitchen.test.mjs</Mono>.
      </P>
      <H3>The screen</H3>
      <P>
        <Mono>pos/src/kitchen/store.js</Mono> keeps confirmed kitchen orders (last sync), an IndexedDB
        outbox of this screen's taps, and shows confirmed + outbox applied with{' '}
        <Mono>applyKitchenEvent()</Mono>, like the till's store. It syncs over the socket and a poll,
        keeps a clock offset from <Mono>server_time</Mono> for the timers, and goes through{' '}
        <Mono>lib/transport.js</Mono> (hub first when one is set). <Mono>kitchenCfg()</Mono> /{' '}
        <Mono>useCfg()</Mono> give the shared rules the stations and flow. <Mono>KitchenApp.jsx</Mono>:
        tickets in columns (<Mono>stationTickets(orders, station, now, cfg)</Mono>: each item with state,
        where (stations it is at now), from, next, and per ticket elsewhere = dishes going through another
        expo or runner), BUMP / READY (expo) / DONE (runner), the Ready panel at expos and runners
        (<Mono>readyOrders()</Mono>), the On order counts
        (<Mono>onOrderCounts()</Mono>), speed figures (<Mono>stationStats()</Mono>), Prev / bring back
        (<Mono>recentBumps()</Mono>), orders for later (<Mono>laterOrders()</Mono>), bump bar keys, wake
        lock and full screen.
      </P>
      <InfoBox type="info">
        Offline between the till and the kitchen needs the venue hub: a web app can't accept connections
        or find other devices on the LAN, so two tablets can't talk to each other without a server they
        both reach. With the hub, tills and kitchen screens point at it (<Mono>hub_url</Mono>) and it runs
        the same sequencer and kitchen rules. Admin: <Mono>components/pos/KitchenSection.jsx</Mono> (Store
        tech → Kitchen screens: stations, screens, online and GloriaFood orders (<Mono>OnlineCard</Mono>); <Mono>StationModal</Mono>),{' '}
        <Mono>components/pos/KitchenFlow.jsx</Mono> (the flow designer, on its own page since migration
        241: Store tech → Kitchen flow designer, <Mono>/pos/kitchen-flow</Mono>,{' '}
        <Mono>KitchenFlowSection</Mono>), Kitchen tab in{' '}
        <Mono>pages/PosReports.jsx</Mono>, Order status block in <Mono>shared/screenLayout.js</Mono> +{' '}
        <Mono>ScreenDesigner.jsx</Mono>.
      </InfoBox>
      <H3>Flow designer</H3>
      <P>
        <Mono>KitchenFlow.jsx</Mono>: a scrolling canvas of boxes (<Mono>[data-node]</Mono>, Orders in +
        every station) and links (SVG curves with a label button at the middle, above the boxes). Drag a
        box by its grip (pointer events with capture; the canvas scrolls when dragging near its edge),
        drag its dot onto another box (<Mono>elementFromPoint</Mono> on release) or tap the dot then the
        box. The panel edits a link's filter (the tenant's order types, revenue streams, a section / dish search)
        and its Only these / All except these switch (<Mono>exclude</Mono>; Except labels are red and read
        Except ..., <Mono>data-except</Mono>), shows a box's links, or <Mono>Check a dish</Mono> (<Mono>itemRoute()</Mono> on the draft, its
        links and boxes highlighted). <Mono>placeMissing()</Mono> gives boxes without a saved place their{' '}
        <Mono>tidyLayout()</Mono> place (columns by the longest way from Orders in, else by kind) so boxes
        never jump; a flow with no saved layout re-tidies as links change until a box is moved by hand.
        Explicit Save flow / Discard, problems block Save, Full screen (Escape leaves). View only: no
        grips, dots or Save; links and boxes still open their panels.
      </P>
      <H3>Order status block</H3>
      <P>
        <Mono>orderStatusHtml()</Mono> in <Mono>shared/screenLayout.js</Mono>. Options: <Mono>board</Mono>{' '}
        (a board station's name; <Mono>orderBoardData()</Mono>), <Mono>show</Mono> both | preparing | ready
        (<Mono>ORDER_SHOWS</Mono>, <Mono>orderShow()</Mono>; one column adds <Mono>is-one</Mono> and{' '}
        <Mono>data-show</Mono>, and its float animation fades instead; migration 237 turned the old{' '}
        <Mono>show_preparing</Mono> false into show ready), <Mono>filter_types</Mono> /{' '}
        <Mono>filter_streams</Mono> (order type and revenue stream names; <Mono>orderFilter()</Mono>, see
        below), <Mono>tile_main</Mono> number | tent |
        table | name and <Mono>tile_lines</Mono> (any of number, tent, table, name, type, source; what each
        tile shows, migration 189 turned the old <Mono>show_names</Mono> into <Mono>tile_lines</Mono>{' '}
        [&apos;name&apos;]), <Mono>layout</Mono> side | stacked,{' '}
        <Mono>ready_first</Mono>, <Mono>preparing_bg</Mono>, <Mono>change_anim</Mono> none | float | fade
        | pop | zoom (<Mono>ORDER_CHANGE_ANIMS</Mono>) and <Mono>change_ms</Mono>. The player keeps the
        changes between fetches (<Mono>orderChanges()</Mono>: numbers in and out of each column, per
        board, kept for <Mono>ORDER_CHANGE_KEEP_MS</Mono> by <Mono>keepOrderChanges()</Mono>) and passes
        them as <Mono>orders.changes</Mono>; the block draws numbers coming in with{' '}
        <Mono>sl-och-in</Mono> and numbers going out in their old place with <Mono>sl-och-out</Mono>, a
        negative animation-delay keeping a redraw mid-animation in step, then draws plain once it is over.
        The designer's Play shows an example change.
      </P>
      <P>
        A tile is drawn by <Mono>orderInfo(order, {'{ main, lines }'})</Mono> in{' '}
        <Mono>shared/orderInfo.js</Mono> (also loaded by the player from <Mono>/lib/orderInfo.js</Mono>):
        the big value (the chosen field, else the first of number, tent, table, name the order has; the
        tile&apos;s <Mono>data-main</Mono> says which), a caption over a tent or table (<Mono>sl-ocap</Mono>),
        then the lines that have a value, never the big one again (<Mono>sl-oline</Mono>, Order 57 / Tent
        12 / Table 4 / the name / the order type / Online or GloriaFood). A name as the big value is drawn
        smaller. The numbers come from <Mono>boardNumbers()</Mono> in <Mono>shared/pos/kitchen.js</Mono>,
        whose entries carry <Mono>number, name</Mono> (online guest, else the till or kiosk name),{' '}
        <Mono>tent, table, type_name, stream, source</Mono>. <Mono>normaliseOrderInfo()</Mono> tidies a saved
        choice; the designer&apos;s Each tile section (<Mono>TileSection</Mono> in{' '}
        <Mono>ScreenDesigner.jsx</Mono>) keeps lines in field order.
      </P>
      <P>
        Showing only some orders: <Mono>orderFilter(o)</Mono> keeps entries whose <Mono>type_name</Mono> is
        in <Mono>filter_types</Mono> and whose <Mono>stream</Mono> is in <Mono>filter_streams</Mono>, by name
        (trimmed, any case; an empty list = every one; both set = both). It runs on the live lists before{' '}
        <Mono>max</Mono>, and on the numbers fading out of a change; the feed itself is the venue&apos;s whole
        list (<Mono>boardFeed()</Mono>, 40 a column), so a filtered board shows at most what fits in those 40.
        The designer&apos;s example numbers aren&apos;t filtered: <Mono>sampleOrders()</Mono> gives them the
        picked order types in turn. Streams are names because boards are shared by every location and each
        has its own streams (as shared kitchen flows match them). A kitchen order keeps its stream:{' '}
        <Mono>stream</Mono> (id) and <Mono>stream_name</Mono> from <Mono>headerFromCheck()</Mono> (the
        check&apos;s <Mono>revenue_stream_id</Mono>, its name from the kitchen config&apos;s{' '}
        <Mono>revenue_streams</Mono>, <Mono>loadKitchenConfig()</Mono>; <Mono>check.stream_set</Mono> is a
        kitchen check event, so the header follows a change) or from <Mono>kitchen.order_in</Mono>{' '}
        (<Mono>onlineSnapshot()</Mono> sends the online order&apos;s Ordering setup stream; GloriaFood orders
        have none). <Mono>boardNumbers()</Mono> entries carry it as <Mono>stream</Mono>. The designer lists{' '}
        <Mono>order_types</Mono> (active names) and <Mono>order_streams</Mono> (one per name across the
        locations) from <Mono>designerData()</Mono>; <Mono>OrderFilterSection</Mono> /{' '}
        <Mono>NameChips</Mono> and <Mono>ShowChoice</Mono> in <Mono>ScreenDesigner.jsx</Mono>.
      </P>
      <P>
        How tiles look (<Mono>TileLook</Mono> in <Mono>ScreenDesigner.jsx</Mono>, the Tile look section) is
        stored on the block as <Mono>tile_*</Mono> options: <Mono>tile_font</Mono> / <Mono>tile_line_font</Mono>
        (a font role or a listed font; added to <Mono>boardFonts()</Mono>), <Mono>tile_weight</Mono>,{' '}
        <Mono>tile_italic</Mono>, <Mono>tile_upper</Mono>, <Mono>tile_shape</Mono> (<Mono>TILE_SHAPES</Mono>:
        rounded with <Mono>tile_radius</Mono> px, square, pill, circle), <Mono>tile_padding</Mono> (% of the
        number size), <Mono>tile_border_width</Mono> / <Mono>tile_border_color</Mono>, <Mono>tile_shadow</Mono>{' '}
        (<Mono>TILE_SHADOWS</Mono>), <Mono>tile_ready_image</Mono> / <Mono>tile_prep_image</Mono> with{' '}
        <Mono>tile_image_fit</Mono> and <Mono>tile_image_dim</Mono> (a dark layer, <Mono>::before</Mono>), and small
        pictures: <Mono>tile_icon</Mono>, <Mono>tile_type_icons</Mono> (order type name to picture, matched in any
        case; <Mono>tileIcon()</Mono>), <Mono>tile_icon_pos</Mono> (<Mono>TILE_ICON_POSITIONS</Mono>) and{' '}
        <Mono>tile_icon_size</Mono>. <Mono>tileLook()</Mono> in <Mono>shared/screenLayout.js</Mono> turns them into
        custom properties on <Mono>.sl-orders</Mono> (<Mono>--otf</Mono>, <Mono>--otr</Mono>, <Mono>--orimg</Mono>,
        <Mono>--ordim</Mono>, <Mono>--otis</Mono> ...), so a tile is one CSS rule set; each tile wraps its words in{' '}
        <Mono>.sl-otext</Mono> beside an optional <Mono>img.sl-oicon</Mono> (<Mono>data-icon</Mono> on the tile).
        <Mono>tileImageUrls()</Mono> adds the pictures to <Mono>boardImageUrls()</Mono>, so screens load them before
        showing the board and keep them offline.
      </P>
      <P>
        Statuses on tiles: <Mono>shownStatus(o, status)</Mono> merges an entry&apos;s <Mono>status</Mono> with the
        block&apos;s <Mono>status_looks[name]</Mono> (any case; <Mono>hide</Mono>, <Mono>look</Mono>,{' '}
        <Mono>colour</Mono>, <Mono>text</Mono>, <Mono>anim</Mono>, <Mono>lamp</Mono>) unless <Mono>show_status</Mono> is
        false; <Mono>statusHtml()</Mono> draws words inside <Mono>.sl-otext</Mono> and the flag, border, traffic
        light, square and dot over the tile, each a <Mono>.sl-ostat</Mono> with <Mono>--osc</Mono> and{' '}
        <Mono>sl-osa-*</Mono> movement that runs only under <Mono>.sl-board.sl-play</Mono>. With no live orders
        (the designer) the example numbers take <Mono>ctx.statuses</Mono> (designer data) in turn.
        Admin: <Mono>StatusSection</Mono> in <Mono>ScreenDesigner.jsx</Mono>; the Setter&apos;s own look in{' '}
        <Mono>StationModal</Mono> (<Mono>KitchenSection.jsx</Mono>).
      </P>
      <H3>The kitchen test bench</H3>
      <P>
        Store tech → Kitchen screens → Test the kitchen (<Mono>TestCard</Mono> in{' '}
        <Mono>KitchenSection.jsx</Mono>, a <Mono>div role=&quot;button&quot;</Mono> so it works in the View
        only fieldset) calls <Mono>POST /api/pos/venues/:venueId/kitchen-test</Mono> (pos_setup view) for a
        signed link and opens <Mono>pos.&lt;domain&gt;/?kitchen_test=&lt;token&gt;</Mono> in a new window
        (opened blank before the request, so pop-up blockers allow it). Links come from{' '}
        <Mono>services/previewLinks.js</Mono> (<Mono>makeLink(kind, data, hours)</Mono> /{' '}
        <Mono>readLink(kind, token)</Mono>, HMAC-SHA256 with the sealed <Mono>kiosk_preview_key</Mono> in{' '}
        <Mono>platform_secrets</Mono>), shared with kiosk previews; a link carries its kind, so a kiosk
        preview link never opens the bench and back. Kitchen links last 8 hours.{' '}
        <Mono>GET /pos-api/kitchen-test?token=</Mono> (rate limited, no device) returns{' '}
        <Mono>kitchenTestData()</Mono> (<Mono>services/kitchenSvc.js</Mono>): the kitchen screen config
        (stations, courses, order types), every flow with its links, the venue&apos;s kitchen screens,
        tables, revenue streams and the live menus&apos; dishes (no prices). It only reads.
      </P>
      <P>
        The page (<Mono>pos/src/kitchen/Bench.jsx</Mono>) runs a pretend kitchen in the browser:{' '}
        <Mono>createBench(data)</Mono> in <Mono>shared/pos/kitchenBench.js</Mono> stands in for the
        sequencer and <Mono>/pos-api</Mono> with the same rules (<Mono>kitchenForCheckEvent()</Mono> for
        test till orders as <Mono>lines.sent</Mono> / <Mono>course.fired</Mono> / <Mono>line.voided</Mono>,{' '}
        <Mono>applyKitchenEvent()</Mono> for <Mono>kitchen.order_in</Mono> online orders and the
        screens&apos; taps), its own sequence numbers, sync with reset after Clear all, an activity log, and
        its own flow in use (<Mono>switchFlow()</Mono>, refusing screens with{' '}
        <Mono>can_switch_flow: false</Mono>). Test orders are made with <Mono>sendOrder(spec)</Mono> (spec <Mono>tent</Mono>{' '}
        on counter till orders, <Mono>name</Mono> as the till name or the online guest) or made up by{' '}
        <Mono>randomSpec()</Mono> (some counter orders get a tent); a combo&apos;s parts come from{' '}
        <Mono>randomComboParts()</Mono> (<Mono>resolveSteps()</Mono>). Each screen is the real kitchen app
        in a same-origin frame (<Mono>?kitchen_test=&amp;screen=&lt;id&gt;</Mono>,{' '}
        <Mono>BenchScreen.jsx</Mono>), scaled with a CSS transform from a fixed size (tablet 1280 x 800,
        TV 1920 x 1080, upright 800 x 1280). It gets <Mono>window.parent.kdsBench.connect(screenId)</Mono>:
        a transport answering <Mono>GET /pos-api/config</Mono>, <Mono>GET /pos-api/kitchen/sync</Mono>,{' '}
        <Mono>POST /pos-api/events</Mono> and <Mono>PUT /pos-api/kitchen/flow</Mono> from the bench, and{' '}
        <Mono>subscribe()</Mono> in place of the socket (<Mono>pos.seq</Mono>, <Mono>pos.config</Mono>).{' '}
        <Mono>bootKitchen(device, benchLink)</Mono> in <Mono>pos/src/kitchen/store.js</Mono> switches the
        store to bench mode: no IndexedDB (<Mono>keep</Mono>), its choices in <Mono>sessionStorage</Mono>{' '}
        (<Mono>maca_kds_bench_&lt;id&gt;</Mono>), no forgetting the device on a 401, so a test never
        touches a real kitchen screen&apos;s data on the same browser. Online / Offline per screen makes its
        transport throw an offline error and fires <Mono>offline</Mono> / <Mono>online</Mono> in its
        frame, so taps wait in the screen&apos;s outbox as they would on Wi-Fi.
      </P>
      <H3>The live kitchen view</H3>
      <P>
        Store tech → Kitchen screens → Live view (<Mono>LiveCard</Mono> in <Mono>KitchenSection.jsx</Mono>,
        sharing <Mono>KitchenPageButton</Mono> with the test bench) calls{' '}
        <Mono>POST /api/pos/venues/:venueId/kitchen-live</Mono> (pos_setup view) for a signed link of kind{' '}
        <Mono>kitchen_live</Mono> (<Mono>kitchenLiveToken()</Mono> / <Mono>readKitchenLiveToken()</Mono> in{' '}
        <Mono>services/kitchenSvc.js</Mono>, 12 hours) and opens{' '}
        <Mono>kitchen.&lt;domain&gt;/?kitchen_live=&lt;token&gt;</Mono>. The page (
        <Mono>pos/src/kitchen/Live.jsx</Mono>, lazy in <Mono>pos/src/App.jsx</Mono>; no service worker
        update reloads, <Mono>main.jsx</Mono>; kept out of <Mono>navigateFallback</Mono>) loads{' '}
        <Mono>GET /pos-api/kitchen-live</Mono>: <Mono>kitchenLiveData()</Mono>, the kitchen screen config
        (stations, flows, courses, order types, colours, no printers) and the venue&apos;s kitchen screens
        from <Mono>pos_devices</Mono> (kind kds, not removed) with their settings, whether a device is linked
        and when it was last seen. It reloads that on a <Mono>pos.config</Mono> or <Mono>pos.revoked</Mono>{' '}
        push (800 ms debounce) and every <Mono>pull.content</Mono> seconds.
      </P>
      <P>
        Orders are followed once for the whole page (<Mono>useKitchenFeed()</Mono>): the socket{' '}
        <Mono>/ws?kitchen_live=&lt;token&gt;</Mono> (a branch in <Mono>config/ws.js</Mono>: the link read
        with <Mono>readLink(&apos;kitchen_live&apos;)</Mono>, its venue checked against its tenant in system
        mode, closed 4003 otherwise; it joins only the venue&apos;s till room <Mono>pos:&lt;venue&gt;</Mono> and
        answers pings) says <Mono>pos.seq</Mono> with kind kitchen. The page pings every{' '}
        <Mono>PING_EVERY_MS</Mono> (25 s, once the server&apos;s <Mono>connected</Mono> message says{' '}
        <Mono>heartbeat: true</Mono>), which keeps the link open through proxies that close quiet ones; no
        answer within <Mono>PONG_WAIT_MS</Mono> (10 s) drops it without waiting for it to close and opens
        another (the kiosk&apos;s heartbeat). The page asks{' '}
        <Mono>GET /pos-api/kitchen-live/sync</Mono> (one request in flight, asked again if a push came
        meanwhile), also every 20 s with the socket open and every 3 s without it. It keeps the orders, the
        sequence each order last changed at, the sequence of the last reset and the server clock offset,
        and drops finished orders after <Mono>STALE_HOURS</Mono> as the screens do.
      </P>
      <P>
        Each screen is the real kitchen app in a frame (<Mono>?kitchen_live=&amp;screen=&lt;id&gt;</Mono>,{' '}
        <Mono>BenchScreen.jsx</Mono> with <Mono>host=&quot;kdsLive&quot;</Mono>), getting{' '}
        <Mono>window.parent.kdsLive.connect(screenId)</Mono>: <Mono>GET /pos-api/config</Mono> answered with
        the config and that screen as its device (version <Mono>live.&lt;config version&gt;.&lt;stamp of the
        device&gt;</Mono>, so a setting change reaches it), <Mono>GET /pos-api/kitchen/sync</Mono> from the
        page&apos;s orders (a reset for 0, a sequence ahead of the page&apos;s or behind its last reset), and{' '}
        <Mono>POST /pos-api/events</Mono> as below. The link carries <Mono>viewOnly</Mono>, a function the
        store asks at every tap (<Mono>isViewOnly()</Mono> in <Mono>pos/src/kitchen/store.js</Mono>): true
        until the page&apos;s Allow bumping switch is on. Until then <Mono>kitchen()</Mono> refuses every
        kitchen event before it touches the screen (a toast with the link&apos;s <Mono>viewOnlyText</Mono>, once
        while showing). <Mono>switchFlows: false</Mono> keeps <Mono>switchFlow()</Mono> refused whatever the
        switch (<Mono>flowSwitchHere()</Mono>, <Mono>FLOWS_ELSEWHERE</Mono>), and the flow panel shows no
        Switch (<Mono>kds-flow-view-only</Mono>, from <Mono>inLiveView()</Mono>). Choices go to <Mono>sessionStorage</Mono> under{' '}
        <Mono>maca_kds_live_&lt;id&gt;</Mono>; the page&apos;s own (mode, size, across, sound) to{' '}
        <Mono>maca_kds_live</Mono>. Sound plays from the page (<Mono>link.chime</Mono>): a frame can&apos;t
        play sound until it is tapped, and the Sound button or the first tap on the page unlocks it.
      </P>
      <P>
        Full screen: the Fullscreen API on the screen&apos;s card (webkit-prefixed on an iPad), else the
        card fixed over the window (<Mono>data-full</Mono> screen | window); while full the frame fills the
        card at its real size, so the kitchen app lays itself out for it; leaving scales it back without
        reloading the frame. <Mono>&amp;full=&lt;screen id&gt;</Mono> in the address (kept with{' '}
        <Mono>history.replaceState</Mono>) opens with that screen filling the window; Escape leaves the
        window mode. Tests: <Mono>api/test/kitchen-live.test.mjs</Mono>.
      </P>
      <P>
        <strong>Bumping from the live view</strong> (5 Nov 2026): the page shows the Allow bumping switch (
        <Mono>BumpSwitch</Mono>, <Mono>live-bump</Mono>, role switch) when the setup says{' '}
        <Mono>can_bump</Mono>, else a Watch only line (<Mono>live-watch-only</Mono>). It starts off at every
        visit and lives only in memory (<Mono>bumpingRef</Mono>, never stored). Tapping it asks first (
        <Mono>BumpConfirm</Mono>, <Mono>live-bump-confirm</Mono> with <Mono>live-bump-yes</Mono> /{' '}
        <Mono>live-bump-no</Mono>; a second tap on the switch closes the question). As it goes on, a bar (
        <Mono>live-bump-banner</Mono>, with <Mono>live-bump-note-ok</Mono> and <Mono>live-bump-off</Mono>)
        says what it does for <Mono>BUMP_NOTE_MS</Mono> (8 s, or until OK; 6 Nov 2026, it stayed before);
        then the switch and a badge on every screen card (<Mono>live-bump-badge</Mono>, also in full screen)
        say it is on, and either turns it off. A link without <Mono>b</Mono> (made before 5 Nov 2026, or by
        someone with pos_setup view) shows <Mono>WATCH_ONLY</Mono>: open Live view again from Store tech. With it on, a frame&apos;s{' '}
        <Mono>POST /pos-api/events</Mono> goes to <Mono>POST /pos-api/kitchen-live/events</Mono> with the
        screen&apos;s id (a kitchen screen&apos;s device id, or a station id in One per station) and the page
        pulls the orders at once (<Mono>pull</Mono> from <Mono>useKitchenFeed()</Mono>); a refusal of the whole
        batch (403, 404) comes back as every tap refused with its words, and a 401 ends the page. The server
        takes them as device <Mono>live:&lt;screen id&gt;</Mono>, never the real screen&apos;s id: a kitchen
        screen ignores <Mono>pos.seq</Mono> from its own device id, so the real screen would miss the change.
        Who may bump is fixed when the link is made (<Mono>b</Mono> in the signed link, from pos_setup manage):
        the page has no login to check at tap time. At a hub-first location the taps go to the cloud like the
        rest of the page, and the hub&apos;s screens get them when the hub follows the cloud. Tests: the
        bumping tests in <Mono>api/test/kitchen-live.test.mjs</Mono>, the live view bump in{' '}
        <Mono>api/test/gloriafood-kitchen.test.mjs</Mono>.
      </P>
      <P>
        <strong>Order ready boards</strong> (4 Nov 2026) show under the kitchen screens (
        <Mono>BoardsSection</Mono>, <Mono>boardCards()</Mono> in <Mono>Live.jsx</Mono>), each the real screen
        player in live mode in a frame of <Mono>screens.&lt;root&gt;</Mono> (
        <Mono>?board_live=&lt;this link&gt;</Mono>; see Menu screens → Player). The setup&apos;s{' '}
        <Mono>boards</Mono> come from <Mono>kitchenLiveData()</Mono>: <Mono>orderBoardScreens()</Mono> in{' '}
        <Mono>services/screenSvc.js</Mono> (the venue&apos;s menu screens whose board, playlist board or
        wall&apos;s shows an <Mono>order_status</Mono> block, in the Screens page&apos;s order, with size, wall,
        linked, last seen, online and what they show) and the venue&apos;s board stations. As set up: one
        card per such screen (<Mono>&amp;screen=&lt;id&gt;</Mono>, as it shows now, its own design and
        Order status options); One per station, or no such screen: a plain board per board station (
        <Mono>&amp;board=&lt;station id&gt;</Mono>, <Mono>liveBoardConfig()</Mono>: one Order status block
        naming the station), or one of every counter and online order (<Mono>&amp;board=all</Mono>) when the
        flow has no board station. A frame takes the screen&apos;s own shape (at most 560 px tall; a screen
        turned on its side is drawn upright), follows the numbers itself (<Mono>/screen-api/live/orders</Mono> on its
        pull time and on <Mono>kitchen.board</Mono>; board, playlist and menu changes on its screen&apos;s
        rooms) and has its own Full screen. The socket&apos;s <Mono>board_live</Mono> branch in{' '}
        <Mono>config/ws.js</Mono> reads the link (<Mono>readLink(&apos;kitchen_live&apos;)</Mono>), checks its
        venue against its tenant and a named screen against the venue, then joins that screen&apos;s rooms (
        <Mono>screen:</Mono>, <Mono>screens:</Mono>, <Mono>screens-t:</Mono>, <Mono>menus:</Mono>) or only{' '}
        <Mono>screens:&lt;venue&gt;</Mono>; the paired-screen branch skips a <Mono>board_live</Mono>{' '}
        connection. Tests: <Mono>api/test/kitchen-live.test.mjs</Mono>, the live view test in{' '}
        <Mono>api/test/system-paths.test.mjs</Mono>.
      </P>
    </section>
  )
}
