// src/pages/docs/pos.jsx
// The Docs page's "Till (POS)" section. Docs.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, Mono, DataTable, InfoBox } from './parts.jsx'

export const id = 'pos'
export const label = 'Till (POS)'
export const order = 260

// ── MENUS ───────────────────────────────────────
export function Section() {
  return (
    <section id="pos" data-doc="">
      <H2>Till (POS)</H2>
      <P>
        Migration 156. Design and decisions in <Mono>docs/POS.md</Mono>. Four parts:{' '}
        <Mono>shared/pos/</Mono> (the rules, pricing, printing and report maths, plain ESM used by the
        till, the API and the admin), <Mono>pos/</Mono> (the till app, a React PWA served on{' '}
        <Mono>pos.&lt;domain&gt;</Mono>), <Mono>routes/posApi.js</Mono> (<Mono>/pos-api</Mono>, the till's
        API, device auth) and <Mono>routes/posSetup.js</Mono> (<Mono>/api/pos</Mono>, the admin pages,
        modules <Mono>pos_setup</Mono> and <Mono>pos_reports</Mono>, group <Mono>pos</Mono>). Shared
        server code: <Mono>services/posSvc.js</Mono>. Every query filters <Mono>tenant_id</Mono> itself.
      </P>
      <H3>Tech board and platform status (22 Nov 2026, migration 263)</H3>
      <P>
        Store tech → Tech board (<Mono>/pos/board</Mono>, <Mono>TechBoardSection.jsx</Mono>, the first tab, menu
        link added by migration 263 before Tills): <Mono>GET /api/tech-board/venues/:venueId</Mono>{' '}
        (<Mono>routes/techBoard.js</Mono>; <Mono>requireOwnVenue</Mono> and Store tech or Screens view) returns the
        venue&apos;s devices as Store tech shows them (<Mono>deviceView()</Mono>, removed ones left out) with{' '}
        <Mono>last_action</Mono> (a till&apos;s or kitchen screen&apos;s newest event among the venue&apos;s last 5,000 by{' '}
        <Mono>seq</Mono>, a kiosk&apos;s last <Mono>kiosk_sessions</Mono> visit, a hub&apos;s <Mono>info_at</Mono> and{' '}
        <Mono>info.mirror.last_upload_at</Mono>), the printers with the last day&apos;s waiting and failed tickets and
        the last ticket, the card machines with their last payment (30 days; they report no live state) and,
        with Screens view, the menu screens. When kit counts as online is <Mono>shared/techBoard.js</Mono>{' '}
        (<Mono>DEVICE_ONLINE_MS</Mono> 5 min, <Mono>SCREEN_ONLINE_MS</Mono> 150 s, <Mono>seenState()</Mono>,{' '}
        <Mono>deviceOnline()</Mono>, <Mono>boardSummary()</Mono>), now also used by the installer, the Screens
        routes and the Printers section; a printer reads as on the Printers page (<Mono>printerState()</Mono>),
        with failed tickets today making it need looking at. A Store tech tab with <Mono>readOnly</Mono> skips
        the View-only notice and greyed fieldset. The light at the top is <Mono>GET /api/status/light</Mono>.
      </P>
      <H3>The honeycomb board and its tile model (28 Nov 2026, no migration)</H3>
      <P>
        One model for every place that draws the board, in <Mono>shared/techBoard.js</Mono> (till, public):{' '}
        <Mono>techTiles(board, {'{ now, setup }'})</Mono> turns the route&apos;s answer into tiles{' '}
        <Mono>{'{ key, id, kind, name, tone, word, status, detail, seen_at, facts, count, ring, link, icon }'}</Mono>{' '}
        (kind hub | till | kitchen | kiosk | printer | card | screen, <Mono>TECH_KINDS</Mono> with each kind&apos;s
        label, link, icon and ring line and colour; tone ok | warn | bad | muted; <Mono>deviceState()</Mono>,{' '}
        <Mono>lastAction()</Mono>, <Mono>printerState()</Mono> moved here from the Printers section,{' '}
        <Mono>hubCopy()</Mono> for the hub&apos;s copy for trading offline, <Mono>agoText()</Mono>, which the
        admin&apos;s <Mono>ago()</Mono> now calls). <Mono>techModel(tiles, {'{ light }'})</Mono> gives the groups
        (worst first, <Mono>badge</Mono> &ldquo;2 of 3 up&rdquo;), <Mono>techHealth()</Mono> (worst tone with the
        platform&apos;s <Mono>PLATFORM_LIGHT</Mono>, counts, &ldquo;12 up, 1 down&rdquo;) and{' '}
        <Mono>attention</Mono>; <Mono>seenText()</Mono> the &ldquo;seen 4 min ago&rdquo;; <Mono>screenTiles()</Mono>{' '}
        what a menu screen may know. <Mono>boardSummary()</Mono> is gone.
      </P>
      <P>
        The drawing is <Mono>shared/techHex.js</Mono> (till, public): <Mono>hexSpiral(n)</Mono> (axial coordinates,
        flat-topped hexagons, centre then ring by ring), <Mono>honeycomb(model, {'{ aspect | maxWidth, health }'})</Mono>{' '}
        (one compact spiral per group, the first and worst tile in the middle, the clusters in rows that fit a
        box of that shape or wrap at a width, the health hexagon first at <Mono>HEALTH_SCALE</Mono>; positions in
        radii), <Mono>fitSize()</Mono>, <Mono>honeycombHtml()</Mono> (each tile an SVG hexagon: fill by tone from{' '}
        <Mono>HEX_COLOURS</Mono>, ring by kind from <Mono>ringSvg()</Mono>, a mark per tone from <Mono>MARKS</Mono>,
        the Lucide icon from <Mono>TECH_ICONS</Mono>, names escaped; buttons with <Mono>data-tile</Mono> when{' '}
        <Mono>interactive</Mono>), <Mono>legendHtml()</Mono>, <Mono>attentionHtml()</Mono>,{' '}
        <Mono>sampleTechTiles()</Mono> and <Mono>TECH_HEX_CSS</Mono> (<Mono>--hx-*</Mono> properties; bad tiles
        glow under <Mono>hx-anim</Mono>, never with reduced motion).
      </P>
      <P>
        The page: <Mono>TechBoardSection.jsx</Mono> (header, view, theme, Full screen, the attention box, the
        list) and <Mono>TechHoneycomb.jsx</Mono>, loaded with <Mono>React.lazy</Mono>: <Mono>Honeycomb</Mono>{' '}
        (measures its box with a <Mono>ResizeObserver</Mono>; the page wraps at a 66 px radius, 54 px on a
        phone, full screen fits the box), <Mono>TileSheet</Mono> (a tile&apos;s <Mono>facts</Mono> and link, or the
        health; Escape closes and the focus goes back to the hexagon), <Mono>FullBoard</Mono> (the Fullscreen
        API on its own element, a fixed window-sized view where there is none; <Mono>fullscreenchange</Mono>{' '}
        closes it; reads every 30 s). The view and theme are per device (<Mono>localStorage</Mono>{' '}
        <Mono>mcrn_tech_board_view</Mono>, <Mono>mcrn_tech_board_theme</Mono>). The route now goes through{' '}
        <Mono>services/techBoardSvc.js</Mono> <Mono>loadTechBoard(tx, tenantId, venueId, can)</Mono> (public, also
        the menu screen block&apos;s source) and adds <Mono>venue_name</Mono>, <Mono>timezone</Mono> and a hub&apos;s{' '}
        <Mono>copy_on</Mono> / <Mono>copy_at</Mono> (<Mono>info.mirror.on</Mono>, <Mono>last_follow_at</Mono>).
      </P>
      <P>
        Platform status (<Mono>services/platformStatus.js</Mono>): each API process writes a heartbeat to Redis
        every 30 s (<Mono>mac:status:proc:host:pid</Mono>, gone after 90 s, <Mono>startProcessBeat()</Mono> in{' '}
        <Mono>server.js</Mono>) and each BullMQ worker its last finish and failure (<Mono>watchWorker()</Mono>,{' '}
        <Mono>mac:status:job:name:done|failed</Mono>). <Mono>GET /api/platform/status</Mono> (platform admin; the
        Platform page&apos;s Services tab, <Mono>PlatformStatusCard</Mono>, every 30 s): Postgres (SELECT, size,
        connections), Redis (PING, memory), the processes, the jobs (<Mono>JOBS</Mono>, built from <Mono>loadJobs()</Mono>: each job file&apos;s label and every; interval, last ran, late after three
        intervals and a minute, queue counts, last error), the machine (disk, memory, load) and the deployed
        commit (read from <Mono>.git</Mono>). <Mono>stateOf()</Mono>: down without the database; degraded without
        Redis, with a late repeating job or a disk over 90% full. <Mono>GET /api/status/light</Mono> (anyone
        signed in) gives only <Mono>{'{ state, checked_at }'}</Mono>, kept in Redis for 20 s. Not checked: nginx and
        its certificates, the outside services (Anthropic, Stripe, email providers), the venue hubs&apos; own
        health beyond their reports.
      </P>
      <P>
        Alerts (22 Nov 2026, <Mono>services/platformAlerts.js</Mono>, <Mono>startPlatformAlerts()</Mono> in{' '}
        <Mono>server.js</Mono>): PM2 instance 0 only (never under tests) runs <Mono>platformStatus()</Mono> every
        minute and emails the active <Mono>platform_admins</Mono> (from the platform&apos;s own provider,{' '}
        <Mono>SENDGRID_API_KEY</Mono> and <Mono>EMAIL_FROM</Mono>) by <Mono>nextAlert()</Mono>: down for two checks
        running, degraded for 30 minutes, and up again after either, each once a spell. The admins&apos;
        addresses are kept from the last good read, so a database outage can still be told; the rule&apos;s memory
        and the last alert sent are in Redis (<Mono>mac:status:alert:mem</Mono>, <Mono>:last</Mono>), so a restart
        doesn&apos;t send again, and <Mono>platformStatus()</Mono> returns the last as <Mono>alert</Mono> for the card.
        No push. Tests: <Mono>api/test/platform-alerts.test.mjs</Mono>.
      </P>
      <H3>Checks are events</H3>
      <P>
        A check is never edited in place. The till records events (<Mono>{'{ id: ULID, venue_id, device_id, staff_id, approved_by, check_id, type, payload, client_at }'}</Mono>,
        26 check types in <Mono>CHECK_EVENTS</Mono> plus venue events <Mono>drawer.opened</Mono> and{' '}
        <Mono>day.closed</Mono>) and <Mono>applyEvent(checks, event, {'{ staffById }'})</Mono> in{' '}
        <Mono>shared/pos/checks.js</Mono> turns them into check state, refusing what the rules don't allow
        (closed check, overpayment, missing permission, line already sent, ...). The till applies its own
        events at once (optimistic) from an IndexedDB outbox; the server's sequencer
        (<Mono>shared/pos/sequencer.js</Mono>, <Mono>createSequencer(store)</Mono>) applies them again in
        arrival order under <Mono>pg_advisory_xact_lock(hashtext('pos:' || venue_id))</Mono>, gives each a
        venue sequence number, the check number / counter order number and the trading day
        (<Mono>assigned</Mono>), and stores refusals in <Mono>pos_event_rejections</Mono> (Till reports,
        Refused changes). The same sequencer will run on the venue hub with a SQLite store: only the
        store object differs.
      </P>
      <DataTable
        head={['Table', 'What it holds']}
        rows={[
          ['pos_events', 'Every accepted event (id ULID text, seq per venue, assigned jsonb). The source of truth.'],
          ['pos_event_rejections', 'Refused events with error + code; resolved_at / by / resolution from Till reports.'],
          ['pos_checks', 'Projection: state jsonb (the whole check) plus number, number_code (the opening device\'s short code, migration 217: the check is T2-47), order_no, status, table, server, totals, day_id for queries.'],
          ['pos_check_lines / pos_payments', 'Projections for reporting (payments kind payment | refund).'],
          ['pos_days', 'Trading days: business_date (from day_starts_at), z_number, figures jsonb at Z, declared_cash, recon_filled_at / recon_error. One open per venue.'],
          ['pos_venue_state', 'last_seq, next_z_number, device_numbers jsonb { device_id: { date, check, order } } (each till\'s or kiosk\'s highest numbers per trading day, migration 217; next_check_no / next_order_no dropped).'],
          ['pos_print_jobs', 'Print queue (ops jsonb from tickets.js), status queued | printing | printed | failed, for the hub.'],
          ['pos_devices', 'Tills, kitchen screens, kiosks and venue hubs: kind terminal | kds | kiosk | hub, short_code, secret_hash, pairing_code_hash + pairing_expires_at (only the move hand-over code of POST /pos-api/move), settings jsonb (mode, revenue_stream_id, receipt_printer_id, floor_area_id, order_numbers { from, to } for tills and kiosks (migration 217), receipt_mode stream | ask | always | never (224; stream since 296, was venue), order_prompt stream | one | two (226; same), covers stream | off | ask | must and courses stream | on | off (231) for tills; a hub\'s auto_update), pending_changes + pending_at (changes the device says it hasn\'t sent, X-Pos-Pending), revoked_at; a hub\'s info + info_at (what it says about itself) and update_requested_at (migration 195).'],
          ['pos_settings', 'Per venue: pin_salt, day_starts_at, receipt texts, tenders jsonb, tips, auto_logout_secs, recon_map, recon_auto_fill, approvals jsonb. (Migration 296 moved receipt_mode and order_prompt to pos_revenue_streams and dropped them here. Migration 170 dropped the VAT defaults and counter_revenue_centre_id; 231 dropped require_covers, moved to the streams.)'],
          ['pos_revenue_streams', 'Migration 170 (was pos_revenue_centres): name, menu_ids, colour, sort_order, is_active, default_order_type_id, covers off | ask | must and courses boolean (migration 231: what its tables ask and whether it uses courses; require_covers on became must, off became off), seats boolean (246), receipt_mode ask | always | never and order_prompt one | two (migration 296, from the venue\'s pos_settings: each stream took its venue\'s values). Which order types it offers and what each asks for: pos_stream_order_types (stream_id, order_type_id, enabled, ask_name / ask_tent off | ask | required; no row = off). See Tax, Order Types & Streams.'],
          ['pos_charges', 'Migration 231, tenant-wide, forced RLS: the company\'s till charges (shared/pos/charges.js): name, kind percent | amount, value numeric(10,2) (percent 0.01-50 or whole pence 1-100000, CHECK), optional, min_covers 0-100, tax_rate_id (SET NULL), basis check | dishes, per check | dish, item_ids / section_ids uuid[] (no foreign keys: menu rows are re-inserted on every save; at most 100 / 30; basis dishes needs one), sort_order. Replaced order_types.charges (migration 225), which the migration moved here: each different charge once per group.'],
          ['pos_charge_rules', 'Migration 231, forced RLS: the matrix at each location: (charge_id, revenue_stream_id, order_type_id) primary key, tenant_id, venue_id; cascades from all three. The migration put each moved charge on every stream that offered its order type. A new location copies its template\'s (storeSetup.js).'],
          ['pos_discounts', 'Migration 225, tenant-wide, forced RLS: the discounts the till offers by name: name, kind percent | amount, value numeric(10,2) (percent 0.01-100, or whole pence 1-100000, CHECK), scope any | check | line, needs_manager, sort_order. Reaches every rule runner as settings.discounts.'],
          ['pos_roles / pos_courses', 'Tenant-wide. Role permissions jsonb (shared/pos/permissions.js); courses with hold_by_default.'],
          ['pos_printers', 'Printers (host, port, columns, backup); connection hub | device + device_id; status / status_at from the hub (migration 191); local_id: a USB printer on the venue hub\'s computer (migration 195). pos_print_routes was dropped: kitchen tickets come from the kitchen flow.'],
          ['floor_areas', 'name, width x height in units, revenue_stream_id, decor jsonb. tables gains floor_area_id, pos_x/y/w/h, shape, rotation.'],
          ['cash_staff', 'pos_pin_hash (unique per venue), pos_role_id.'],
          ['menus', 'menu_items kind (dish | combo), kitchen_name, pos_course_id, pos_colour, combo jsonb (steps since migration 171, see Combos); menu_sections pos_course_id, pos_colour; menu_variant_groups pos_prefixes; menu_variant_options child_group_id; promotions channels text[] (online | pos).'],
        ]}
      />
      <H3>Sync</H3>
      <P>
        <Mono>POST /pos-api/events</Mono> takes up to 200 events and answers per event (accepted with
        seq + assigned, duplicate, or refused); the server forces <Mono>venue_id</Mono> and{' '}
        <Mono>device_id</Mono> from the device. <Mono>GET /pos-api/sync?since=seq</Mono> returns newer events
        and the checks they touched (<Mono>reset: true</Mono> with every open check when the till is too far
        behind). Tills join the WebSocket room <Mono>pos:&lt;venueId&gt;</Mono>
        (<Mono>/ws?pos_device=&amp;secret=</Mono>) for <Mono>pos.seq</Mono>, <Mono>pos.config</Mono>{' '}
        (download config again), <Mono>pos.presence</Mono> and <Mono>pos.revoked</Mono>, and poll every
        4 s without the socket (30 s with it). Derived state on the till = confirmed state from the server
        + the outbox replayed on top; a refused outbox event is dropped with a toast.
      </P>
      <H3>Pulling the config, prices and sold out</H3>
      <P>
        Pushes bring changes at once, but devices never depend on them: <Mono>pos/src/lib/livePull.js</Mono>{' '}
        sets the timers the till, kiosk and kitchen screen stores use (<Mono>createPullTimers()</Mono>). The
        whole config every <Mono>pull.content</Mono> seconds (standard 3 minutes;{' '}
        <Mono>GET /pos-api/config?version=</Mono>, answered <Mono>unchanged</Mono> when nothing changed), and
        on a till or kiosk prices and sold out every <Mono>pull.live</Mono> (standard 30 s, 0 = off;{' '}
        <Mono>GET /pos-api/live</Mono> → <Mono>{'{ sold_out, prices }'}</Mono>, tills and kiosks only, 403
        code <Mono>kind</Mono> otherwise). The times are the location's (migration 216, below). <Mono>liveFields()</Mono> in{' '}
        <Mono>services/posSvc.js</Mono> works both out: the venue's <Mono>soldOutRows()</Mono>, and{' '}
        <Mono>prices</Mono>, an md5 stamp over the tenant's live menu release ids (a scheduled publish
        changes it the moment it goes live, with no write), every option group and option row, every
        promotion row and the venue's local date. <Mono>tillConfig()</Mono> and <Mono>kioskConfig()</Mono>{' '}
        compute <Mono>version</Mono> before adding them, and every till or kiosk reply carries them (an
        unchanged one too: <Mono>{'{ unchanged, version, sold_out, prices }'}</Mono>). On the device,{' '}
        <Mono>withLive()</Mono> lays a reply's sold out list (and an unchanged reply's stamp) over the saved
        config and writes it to IndexedDB; <Mono>pricesChanged()</Mono> on a <Mono>/live</Mono> reply means
        fetch the config, whose reply brings the new stamp. A stamp change for another venue's menu costs one
        unchanged config reply. <Mono>keepStorage()</Mono> asks for persistent storage
        (<Mono>navigator.storage.persist()</Mono>) at boot. The till's settings and the kiosk's staff panel
        show when each last ran (<Mono>state.checked</Mono> {'{ content, live }'}).
      </P>
      <H3>Device updates (pull times, migration 216)</H3>
      <P>
        <Mono>pos_settings.pull_content_secs</Mono> (60-3600, standard 180), <Mono>pull_live_secs</Mono>{' '}
        (0 or 10-600, 30), <Mono>pull_screen_secs</Mono> (30-3600, 60) and <Mono>pull_board_secs</Mono>{' '}
        (5-300, 15), CHECK constraints in the migration. <Mono>shared/pos/pullTimes.js</Mono> is the one rule:{' '}
        <Mono>PULL_TIMES</Mono> (key, column, label, limits, which may be off), <Mono>pullTimes(row)</Mono>{' '}
        (from columns or keys, defaults, clamped), <Mono>pullMs()</Mono> (device waits, live off = null),{' '}
        <Mono>PULL_PRESETS</Mono> / <Mono>presetOf()</Mono>, <Mono>asksPerHour()</Mono>,{' '}
        <Mono>pullText()</Mono>. <Mono>settingsView()</Mono> returns <Mono>pull</Mono>;{' '}
        <Mono>PATCH /api/pos/venues/:id/settings</Mono> takes <Mono>pull</Mono> (only the keys sent change;
        Zod refuses out-of-range values) and broadcasts <Mono>pos.config</Mono> and, for menu screens,{' '}
        <Mono>screens.changed</Mono> to <Mono>screens:&lt;venue&gt;</Mono>.{' '}
        <Mono>POST /api/pos/pull-times/everywhere</Mono> (pos_setup manage) writes the times to every venue
        of the tenant (<Mono>ensureSettings()</Mono> first) and tells each. Every device config carries{' '}
        <Mono>pull</Mono>: <Mono>tillConfig()</Mono>, <Mono>kioskConfig()</Mono>, <Mono>kdsConfig()</Mono>{' '}
        (all four) and <Mono>screenConfig()</Mono> (<Mono>{'{ screen, board }'}</Mono>, from a LEFT JOIN on
        the screen's venue's pos_settings, defaults without a row); a change changes the config's version, so
        devices download it. <Mono>createPullTimers(getConfig, tasks)</Mono> runs each task, then waits as
        long as the current config says (read every time; an off pull is looked at again every 60 s);{' '}
        <Mono>check()</Mono>, called by each store after a new config, restarts the timers when the times
        differ from the ones they were set with. The player (<Mono>screen/player.js</Mono>) has its own copy
        of the two limits (<Mono>pullEvery()</Mono>, <Mono>setPullTimers()</Mono> from{' '}
        <Mono>applyConfig()</Mono>). Admin: <Mono>components/pos/DeviceUpdatesSection.jsx</Mono> (Store tech →
        Device updates, <Mono>/pos/updates</Mono>; nav link added by the migration after Card machines):
        presets, a row of times per pull, the asks-an-hour estimate from <Mono>setup.devices</Mono> (and the
        Screens list when the person may see it), Save, Use these at every location with a confirm. The
        till's settings (<Mono>till-pull</Mono>), the kiosk's staff panel (<Mono>k-staff-pull</Mono>) and
        the player's settings panel show the times. Tests: <Mono>shared/pos/test/pullTimes.test.mjs</Mono>,
        the last test in <Mono>api/test/live-pull.test.mjs</Mono>.
      </P>
      <H3>Devices, PINs and permissions</H3>
      <P>
        A till is a linked device, not an Auth0 user: the device shows a code of its own
        (<Mono>POST /pos-api/pairings</Mono>, see Installer app &amp; link codes), someone signed in links it
        with <Mono>POST /api/pos/venues/:id/link</Mono> (Store tech or the installer, the only way a device
        is added), the device keeps the secret it was given with its code, and every call sends <Mono>Authorization: Device &lt;id&gt;.&lt;secret&gt;</Mono> (device rows
        cached 30 s; revoking or switching the module off stops it). People sign in on the till with a PIN:
        <Mono> hashPin()</Mono> (<Mono>shared/pos/pin.js</Mono>, PBKDF2-SHA256, 60000 rounds, the venue's
        salt, so the PIN alone finds the person) is checked on the till, offline. Events carry the person's
        staff id; anything their role lacks needs <Mono>approved_by</Mono> (someone with{' '}
        <Mono>manager</Mono> typed their PIN), checked by <Mono>permissionProblem()</Mono> on both sides.
      </P>
      <P>
        A till learns of a new or changed PIN from its config. Setup changes push <Mono>pos.config</Mono>{' '}
        (cross-process through the Redis relay in <Mono>config/ws.js</Mono>); on top of that,{' '}
        <Mono>staffForPin(pin, &#123; final &#125;)</Mono> in <Mono>pos/src/lib/store.js</Mono> fetches the config
        when a typed PIN matches nobody and looks again, so a PIN set a moment ago works even if the push was
        missed: one request at a time (tries while it is out wait for it), a quiet try (<Mono>PinPad</Mono> tries
        at 4 and 5 digits without a word) at most every <Mono>PIN_REFRESH_GAP_MS</Mono> (1.5 s), a final one (OK,
        or 6 digits) always. <Mono>PinPad</Mono> shows "Checking" and "PIN not recognised" only for final tries,
        and its <Mono>Keypad</Mono> is a <Mono>code</Mono> keypad: every digit stays as typed (a number keypad
        drops a lone leading 0, so a PIN like 0482 used to arrive as 482 and never match). WebCrypto only exists
        on https:// (and localhost): <Mono>hashPin()</Mono> throws a clear message without it, <Mono>PinPad</Mono>{' '}
        shows any error instead of hanging on "Checking", and <Mono>routes/posSite.js</Mono> sends the pos host
        from http:// (X-Forwarded-Proto) to https://.
      </P>
      <P>
        Saving a PIN (<Mono>PUT /api/pos/venues/:id/staff/:staffId/pos</Mono>) refuses a weak one
        (<Mono>weakPin()</Mono>), one someone else at the venue has, and one that overlaps someone else&apos;s:{' '}
        <Mono>pinOverlaps(pin)</Mono> lists its shorter starts (from 4 digits) and every longer PIN starting with
        it (to 6 digits: 110 for a 4-digit PIN), and the route compares their hashes with the venue&apos;s, 422
        when one matches. The till signs in as soon as the digits typed match someone, so 1234 beside 123456 would
        sign the second person in as the first. A person&apos;s own old PIN never blocks their new one. Each
        candidate is a PBKDF2 hash (60,000 rounds), so saving a 4-digit PIN costs 110 hashes, about a third of a
        second on four cores (5 digits 11, 6 digits 2). PINs saved before this check aren&apos;t looked at again
        until one of them is changed. Tests:{' '}
        <Mono>shared/pos/test/pin.test.mjs</Mono>, <Mono>api/test/till-pins.test.mjs</Mono>.
      </P>
      <H3>Manager switches, Cancel order and the receipt choice (migration 224)</H3>
      <P>
        <Mono>pos_settings.approvals</Mono> (jsonb, one boolean per key of <Mono>MANAGER_ACTIONS</Mono> in{' '}
        <Mono>shared/pos/permissions.js</Mono>: <Mono>delete_unsent</Mono>, <Mono>void_sent</Mono>,{' '}
        <Mono>cancel_order</Mono>, <Mono>refund</Mono>; <Mono>normaliseApprovals()</Mono> fills the rest with
        false) are the venue&apos;s "needs a manager every time" switches. <Mono>managerProblem(staffById, event,
        action, settings)</Mono> is the one rule: off = no problem; on = the person or the event&apos;s{' '}
        <Mono>approved_by</Mono> must have <Mono>manager</Mono> plus the action&apos;s own permission (void, refund).
        <Mono> applyEvent()</Mono> now takes <Mono>ctx.settings</Mono> beside <Mono>staffById</Mono> and checks it
        on <Mono>line.changed</Mono> (a lower qty), <Mono>line.deleted</Mono> (not when <Mono>replaced_by</Mono>{' '}
        names a new line on the check: Make it a combo), <Mono>line.voided</Mono>, <Mono>refund.added</Mono> and the
        cancel; refusal code <Mono>manager</Mono>. Every place that applies events passes the venue&apos;s settings:
        the till store (<Mono>state.config.settings</Mono>), the cloud sequencer (<Mono>settingsView()</Mono> in its
        context) and the venue hub&apos;s mirror (<Mono>sequencerContext()</Mono>). On the till,{' '}
        <Mono>can(key, amount, actions)</Mono> / <Mono>approverFor(pin, key, amount, actions)</Mono> in{' '}
        <Mono>pos/src/lib/store.js</Mono> and <Mono>useApproval()(key, amount, label, actions)</Mono> in{' '}
        <Mono>components/ui.jsx</Mono> take the actions an event falls under, so the PIN pad shows before the
        sequencer would refuse.
      </P>
      <P>
        <strong>Cancel order</strong> (<Mono>CancelOrderModal</Mono> in <Mono>CheckActions.jsx</Mono>) is one{' '}
        <Mono>dispatchMany()</Mono> batch: <Mono>line.voided</Mono> for every sent line and{' '}
        <Mono>line.deleted</Mono> for every new one, both with <Mono>cancel: true</Mono>, then{' '}
        <Mono>check.closed &#123; cancel_reason &#125;</Mono>. The close is refused while an active line is left
        (<Mono>items</Mono>) or a payment is on (<Mono>paid</Mono>), and from kiosks; it sets status{' '}
        <Mono>void</Mono> and <Mono>c.cancelled = &#123; reason, value, by, approved_by, at, day_id &#125;</Mono>, where{' '}
        <Mono>value</Mono> is the gross of the lines the cancel took off (summed on the check as{' '}
        <Mono>c.cancelling</Mono> by the flagged void / delete events), so a line voided earlier for another reason
        isn&apos;t counted. <Mono>check.reopened</Mono> clears both. <Mono>dayFigures()</Mono> lists them as{' '}
        <Mono>cancelled</Mono> (<Mono>value</Mono> falls back to the lines left on the check for any without one);
        Till reports shows a Cancelled orders card, the Checks list marks them (<Mono>cancel_reason</Mono> from{' '}
        <Mono>state</Mono> in <Mono>GET /api/pos/venues/:id/checks</Mono>) and the history says "Order cancelled".
      </P>
      <P>
        <strong>Receipts</strong>: <Mono>pos_revenue_streams.receipt_mode</Mono> (<Mono>ask</Mono> default,{' '}
        <Mono>always</Mono>, <Mono>never</Mono>, CHECK; a venue setting until migration 296) and a till&apos;s own{' '}
        <Mono>pos_devices.settings.receipt_mode</Mono> (<Mono>stream</Mono> or absent = follow the stream);{' '}
        <Mono>receiptModeOf(config, streamId)</Mono> in <Mono>shared/pos/tillSettings.js</Mono> (re-exported by{' '}
        <Mono>pos/src/lib/checkOps.js</Mono>) decides: the till&apos;s own, else the check&apos;s stream
        (<Mono>check.revenue_stream_id</Mono>, so a check moved to another stream follows that one), else the
        till&apos;s own stream, else the first. <Mono>PayModal</Mono> closes a paid-off check at once with{' '}
        <Mono>print_receipt</Mono> set unless it is <Mono>ask</Mono>. <Mono>Exact cash</Mono> / <Mono>Exact card</Mono>{' '}
        pay the amount shown in one tap (card: <Mono>card_integrated</Mono> through the till&apos;s card machine when
        it has one, else <Mono>card_external</Mono>).
      </P>
      <P>
        <strong>The check list</strong> (<Mono>components/CheckPanel.jsx</Mono>): <Mono>useSwipe()</Mono> (pointer
        events on the row with <Mono>touch-action: pan-y</Mono>, window listeners, pointer capture once it is a swipe;
        past half the row it acts, past half the button it stays open; the click after a swipe is swallowed) shows
        Delete (new) or Void (sent): Delete goes through <Mono>swipeAction</Mono> in <Mono>Check.jsx</Mono> with a
        5 s toast whose Undo adds <Mono>copyOfLine()</Mono> back; Void opens <Mono>LineModal</Mono> with{' '}
        <Mono>initialMode: 'void'</Mono>. <Mono>useDrag()</Mono> (the grip, <Mono>touch-action: none</Mono>) shows
        every course (or seat) as a <Mono>data-drop</Mono> target while dragging, a floating copy, and scrolls the
        list near its edges; a drop sends <Mono>line.changed &#123; course_id &#125;</Mono> (new lines only,{' '}
        <Mono>canRegroup()</Mono>) or <Mono>&#123; seat &#125;</Mono>. At a table (<Mono>atTable()</Mono>: a{' '}
        <Mono>table_id</Mono> or mode table) <Mono>checkPrompts()</Mono> never asks for a tent number;{' '}
        <Mono>missingDetails()</Mono> and the order type window use it.
      </P>
      <P>
        <strong>Change options</strong> (14 Nov 2026). A dish not sent yet swipes right too (<Mono>onEdit</Mono>,{' '}
        <Mono>line-swipe-edit</Mono> Options; a long swipe opens it at once) when{' '}
        <Mono>canChangeOptions(config, line)</Mono> (<Mono>lib/checkOps.js</Mono>: status new, an{' '}
        <Mono>item_id</Mono>, not an open item or an order flow&apos;s dish, the dish on the till&apos;s menus with
        choices to pick); <Mono>LineModal</Mono>&apos;s <Mono>line-change-options</Mono> does the same.{' '}
        <Mono>Check.jsx</Mono> opens the dish&apos;s own picking screen (a layout&apos;s Dish choices zones, else{' '}
        <Mono>ItemModal</Mono>) titled Change and the dish&apos;s name, with Update as its main button, from the
        line&apos;s picks (<Mono>selectionFromLine()</Mono>) and its own seat, course, note, allergies and typed price
        (<Mono>lineFields()</Mono>). <Mono>changeLine(check, line, item, o)</Mono> sends one{' '}
        <Mono>line.changed</Mono> with <Mono>modifiers</Mono>, <Mono>combo</Mono>, <Mono>unit_price</Mono>,{' '}
        <Mono>qty</Mono>, <Mono>seat</Mono>, <Mono>course_id</Mono> (none when courses are off), <Mono>note</Mono> and{' '}
        <Mono>allergies</Mono>; <Mono>price_override</Mono> true for a new typed price, false for Use menu price after
        a typed one (<Mono>applyEvent()</Mono> clears the mark only together with <Mono>modifiers</Mono>). Fewer than
        before needs <Mono>delete_unsent</Mono> where the venue asks for a manager, and fewer of a flow&apos;s dish
        staff may not take off <Mono>MANAGER_ALWAYS</Mono>. The item window and <Mono>LineModal</Mono> offer a seat
        and a course only where <Mono>seatCourseParts()</Mono> gives them (never on a counter order;{' '}
        <Mono>line-seat</Mono>, <Mono>line-course</Mono>).
      </P>
      <H3>Charges and discounts (migrations 225, 231)</H3>
      <P>
        <strong>Charges</strong> (<Mono>shared/pos/charges.js</Mono>, one implementation for the till, the cloud&apos;s
        sequencer, the venue hub, the API and the admin) are one company list, <Mono>pos_charges</Mono>, and a
        matrix per location, <Mono>pos_charge_rules</Mono> (charge x revenue stream x order type). Routes in{' '}
        <Mono>routes/posSetup.js</Mono>: <Mono>GET/POST /api/pos/charges</Mono>, <Mono>PATCH/DELETE
        /api/pos/charges/:id</Mono>, <Mono>PUT /api/pos/charges/order</Mono>, <Mono>GET /api/pos/charges/catalog</Mono>{' '}
        (the dishes and sections to pick, the group&apos;s own), <Mono>GET/PUT
        /api/pos/venues/:venueId/charge-rules</Mono> (the whole matrix of the venue; a rule twice is saved once;
        another tenant&apos;s charge, stream or type, or a stream of another venue, 422). <Mono>cleanCharge()</Mono>{' '}
        cleans a body (<Mono>normaliseCharge()</Mono>: a percent is always once; a whole-check charge keeps no dishes;
        the same dish twice once) and checks the tax rate, dishes and sections are the tenant&apos;s (<Mono>menu_items</Mono> /{' '}
        <Mono>menu_sections</Mono>, 422; a dish deleted from its menu later just stops counting). At most 40 charges.
      </P>
      <P>
        <Mono>loadCharges()</Mono> (<Mono>services/posSvc.js</Mono>) puts the list in <Mono>settings.charges</Mono> of
        the till config and of <Mono>printConfig()</Mono> (the sequencer; the hub reads its context), each with{' '}
        <Mono>where: [&#123; stream, type &#125;]</Mono> at that venue. <Mono>chargesWhere(list, &#123; streamId, typeId
        &#125;, venueId, rates)</Mono> gives the charges a check of a stream and type gets (with each tax rate&apos;s %
        at the venue as <Mono>vat_rate</Mono>, via <Mono>chargeFromList()</Mono>); the till&apos;s{' '}
        <Mono>chargesFor(config, &#123; streamId, typeId &#125;)</Mono> (<Mono>pos/src/lib/checkOps.js</Mono>) wraps it.
        The till puts them in <Mono>check.opened</Mono>, <Mono>check.order_type_set</Mono> and{' '}
        <Mono>check.stream_set</Mono> (both take optional <Mono>charges</Mono>: the StreamModal sends them with the
        stream when the type stays, else with the type its new stream starts with);{' '}
        <Mono>switchCharges(current, next, off)</Mono> keeps a charge taken off off (also through a round trip:{' '}
        <Mono>check.charges_off</Mono> remembers, by id, ones taken off that left) and keeps charges added on the till.
      </P>
      <P>
        Events: <Mono>charge.added</Mono> either from the list (<Mono>list: true</Mono>, as{' '}
        <Mono>listCharge()</Mono> makes it; the rules check it against <Mono>ctx.settings.charges</Mono> with{' '}
        <Mono>chargeMismatch()</Mono>: a charge not on the list, or with another kind, value, VAT rate, basis, per or
        dishes, is refused with code <Mono>charge</Mono>) or typed (forced to the whole check, optional, from 0 covers,
        no VAT); refused twice or over 12. <Mono>charge.removed</Mono> <Mono>&#123; charge_id, reason &#125;</Mono> (an
        optional one needs the venue&apos;s <Mono>remove_charge</Mono> switch&apos;s manager, one that isn&apos;t optional{' '}
        <Mono>MANAGER_ALWAYS</Mono>) and <Mono>charge.restored</Mono>. Kiosks can&apos;t send charges. The till&apos;s{' '}
        <Mono>addListCharge(check, id)</Mono> (layout button action <Mono>charge</Mono> with <Mono>charge_id</Mono>)
        puts one back when taken off (<Mono>restored</Mono>), does nothing when on (<Mono>already</Mono>), else adds it
        from the list.
      </P>
      <P>
        <Mono>checkTotals()</Mono> gives <Mono>charges</Mono> (each with <Mono>amount</Mono>, <Mono>would_be</Mono>,{' '}
        <Mono>removed</Mono>, <Mono>waiting</Mono> for a <Mono>min_covers</Mono> not reached, and <Mono>count</Mono>{' '}
        for a dish charge) and <Mono>service_charge</Mono>, the sum that counts (still{' '}
        <Mono>pos_checks.service_charge</Mono>). <Mono>chargeBase(charge, lines)</Mono> is the one rule for what a
        charge counts: on the whole check, every live line; on dishes (<Mono>onDishes()</Mono>), the lines whose item
        or section it names, and a combo line counts its parts that are (amounts only: a part&apos;s share of a
        deal&apos;s price isn&apos;t known). A percent is of that net after every discount and offer; an amount is
        once while something counts, or per counted dish (<Mono>perDish()</Mono>: by quantity). Each charge&apos;s VAT
        is added to the VAT table at its own rate. <Mono>billOps()</Mono> prints each by <Mono>chargeLabel()</Mono>{' '}
        (<Mono>Cup deposit x 3</Mono>); <Mono>dayFigures()</Mono> lists <Mono>charges</Mono> by name. Admin:{' '}
        <Mono>components/pos/ChargesSection.jsx</Mono> (Store tech → Charges, <Mono>/pos/charges</Mono>: the list,{' '}
        <Mono>ChargeModal</Mono>, <Mono>ChargeMatrix</Mono>); till: <Mono>ChargesModal</Mono> in{' '}
        <Mono>CheckActions.jsx</Mono> (More → Charges: Add from the list, Type a charge in).
      </P>
      <P>
        <strong>Covers and courses</strong> (migration 231): <Mono>pos_revenue_streams.covers</Mono> off | ask | must
        and <Mono>courses</Mono> (and since migration 246 <Mono>seats</Mono>), and a till&apos;s own{' '}
        <Mono>settings.covers</Mono> / <Mono>settings.courses</Mono> / <Mono>settings.seats</Mono>{' '}
        (<Mono>stream</Mono> = follow it). <Mono>coversOf(config, streamId)</Mono> and{' '}
        <Mono>coursesOn(config, streamId)</Mono> in <Mono>checkOps.js</Mono> decide (the till&apos;s own first);{' '}
        <Mono>seatCourseParts()</Mono> gives the seat and course bar&apos;s parts (also for a till layout&apos;s Seat
        and course zone: <Mono>none</Mono> when neither; seats from <Mono>seatsOn()</Mono> since migration 246);{' '}
        <Mono>coversMissing(check, config)</Mono> makes Send and Pay ask a check that isn&apos;t a counter order for its
        guests under <Mono>must</Mono>. Floor and New tab: off opens at once, ask shows Skip, must doesn&apos;t. Courses off: <Mono>addItem()</Mono> / <Mono>addOpenItem()</Mono> give no{' '}
        <Mono>course_id</Mono> and no course chips show. The till app reads the stream from its config&apos;s{' '}
        <Mono>revenue_streams</Mono> (<Mono>loadStreams()</Mono> selects both).
      </P>
      <P>
        <strong>Discounts</strong> (<Mono>shared/pos/discounts.js</Mono>): <Mono>pos_discounts</Mono>, company-wide,
        through <Mono>GET/POST /api/pos/discounts</Mono>, <Mono>PATCH/DELETE /api/pos/discounts/:id</Mono>,{' '}
        <Mono>PUT /api/pos/discounts/order</Mono> (Store tech view / manage; at most 50). <Mono>loadDiscounts()</Mono>{' '}
        puts the list in <Mono>settings.discounts</Mono> of the till config and of <Mono>printConfig()</Mono>, so the
        sequencer and the hub (<Mono>sequencerContext()</Mono>) judge with it. A discount from the list is{' '}
        <Mono>discount.applied</Mono> with <Mono>preset_id</Mono>: the rules find it in <Mono>ctx.settings</Mono>{' '}
        (<Mono>discountList()</Mono>), refuse a changed type, value or scope (<Mono>presetMismatch()</Mono>, code{' '}
        <Mono>preset</Mono>), need no discount permission, and need a manager every time when{' '}
        <Mono>needs_manager</Mono>. A discount typed in needs the role&apos;s <Mono>open_discount</Mono> (Type a
        discount) and its <Mono>discount_max_pct</Mono> (migration 246; see below). The checks keep the discount as it
        was (name, value). Admin:{' '}
        <Mono>components/pos/DiscountsSection.jsx</Mono> (Store tech → Discounts, <Mono>/pos/discounts</Mono>); till:
        the presets on top of <Mono>DiscountModal</Mono> (<Mono>fitsScope()</Mono> for check or items).
      </P>
      <P>
        <Mono>MANAGER_ACTIONS</Mono> gained <Mono>remove_charge</Mono> and <Mono>custom_discount</Mono> (taken out
        again by migration 246);{' '}
        <Mono>MANAGER_ALWAYS</Mono> (<Mono>'always'</Mono>) in an <Mono>actions</Mono> list asks a manager whatever the
        switches say (<Mono>approverProblem()</Mono>). Migration 225 moved a stream service charge to its tenant&apos;s
        Eat in type when every active stream charged the same, dropped{' '}
        <Mono>pos_revenue_streams.service_charge_percent</Mono> / <Mono>_min_covers</Mono> and{' '}
        <Mono>pos_settings.service_charge_label</Mono>, and added the Discounts menu link after Order types. Tests:{' '}
        <Mono>shared/pos/test/charges.test.mjs</Mono>, <Mono>api/test/till-charges.test.mjs</Mono>.
      </P>
      <H3>Table service or counter, seats, typed discounts, phones (migration 246)</H3>
      <P>
        <strong>Mode lock.</strong> A till&apos;s <Mono>settings.mode</Mono> (<Mono>table</Mono> |{' '}
        <Mono>counter</Mono>) is the whole of what it does: <Mono>counterTill(config)</Mono> in{' '}
        <Mono>pos/src/lib/checkOps.js</Mono>. <Mono>tillPages(counterMode, tables)</Mono> (<Mono>TillMenu.jsx</Mono>)
        gives a counter till Counter and no Floor, a table-service till Floor (called Orders without tables) and no
        Counter; <Mono>Main</Mono> in <Mono>App.jsx</Mono> moves a till that changes kind to its own page. The floor
        lists no counter checks (<Mono>c.mode !== &apos;counter&apos;</Mono>); Move and Merge offer only checks of
        the same kind (<Mono>sameKind()</Mono> in <Mono>CheckActions.jsx</Mono>); on a counter order More has no
        guests, table, seats or courses, <Mono>runButton()</Mono> refuses Guests and Table, and{' '}
        <Mono>coversOf()</Mono> / <Mono>coursesOn()</Mono> / <Mono>seatsOn()</Mono> answer off / false for a counter
        till whatever its stream says. Counter tills show Send only with <Mono>settings.counter_send</Mono>{' '}
        (<Mono>counterSends()</Mono>); their orders go to the kitchen as they are paid.
      </P>
      <P>
        <strong>Seats</strong>: <Mono>pos_revenue_streams.seats</Mono> (boolean, default true; <Mono>StreamBody</Mono>,{' '}
        <Mono>loadStreams()</Mono>) and a till&apos;s <Mono>settings.seats</Mono> <Mono>stream</Mono> | <Mono>on</Mono> |{' '}
        <Mono>off</Mono>, decided by <Mono>seatsOn(config, streamId)</Mono>; <Mono>seatCourseParts()</Mono> uses it
        (it used <Mono>coversOf() !== &apos;off&apos;</Mono>, so a stream without guests had no seats).{' '}
        <strong>Guests</strong>: migration 246 turned streams&apos; covers <Mono>off</Mono> into <Mono>ask</Mono>; new
        tables and new tabs (<Mono>NewTabModal</Mono> in <Mono>Floor.jsx</Mono>: the order prompt, then the covers
        window) ask under ask (Skip) and must (no Skip); <Mono>coversMissing()</Mono> applies to any check that
        isn&apos;t a counter order.
      </P>
      <P>
        <strong>Typed discounts</strong>: the till role permission <Mono>open_discount</Mono> (Type a discount;{' '}
        <Mono>POS_PERMISSIONS</Mono>, <Mono>has(staff, &apos;open_discount&apos;, pct)</Mono> = the permission and{' '}
        <Mono>discount_max_pct</Mono> at least pct) replaces the venue switch <Mono>approvals.custom_discount</Mono>,
        gone from <Mono>MANAGER_ACTIONS</Mono> and refused by the settings route (400). <Mono>applyEvent()</Mono>{' '}
        checks <Mono>need(&apos;open_discount&apos;, pct)</Mono> for a <Mono>discount.applied</Mono> without{' '}
        <Mono>preset_id</Mono> (a manager&apos;s <Mono>approved_by</Mono> otherwise). Migration 246 wrote{' '}
        <Mono>open_discount</Mono> on every role with a limit over 0: true, or false in groups where a location had the
        switch on; the default Supervisor and Manager roles have it.
      </P>
      <P>
        <strong>Phones</strong>: <Mono>pos_settings.phone_layout_id</Mono> (a layout made for a phone; the settings
        PATCH answers 422 <Mono>phone_layout</Mono> for any other) is in <Mono>venueTillLayouts()</Mono>&apos; ids and{' '}
        <Mono>layoutUses()</Mono> (<Mono>phone: true</Mono>); <Mono>{'tillLayoutOf(config, { narrow })'}</Mono>{' '}
        draws the till&apos;s own phone layout, else this one, else <Mono>phoneStandIn()</Mono>. Store tech → Till layouts
        picks it (<Mono>venue-phone-layout</Mono>); the till&apos;s Till page says what it draws (
        <Mono>till-layout-line</Mono>). A table-service till&apos;s <Mono>settings.phone_tables</Mono>{' '}
        <Mono>list</Mono> (<Mono>phoneTablesList()</Mono>) shows the floor as rows on a phone: <Mono>TableRows</Mono>,{' '}
        <Mono>SwipeCheckRow</Mono> in <Mono>Floor.jsx</Mono> with <Mono>useRowSwipe()</Mono> (<Mono>pos/src/lib/rowSwipe.js</Mono>:
        a swipe counts after 12 px sideways and acts at 35% of the row&apos;s width, 160 px at most); left runs{' '}
        <Mono>swipeLeft()</Mono>, which always asks first (see the next part), right opens the check with{' '}
        <Mono>then</Mono> <Mono>pay</Mono> (<Mono>CheckScreen</Mono>&apos;s <Mono>then</Mono> prop runs that action once).
      </P>
      <P>
        <strong>Items not sent at Pay</strong>: <Mono>unsentAtPay(config)</Mono> from <Mono>settings.unsent_at_pay</Mono>{' '}
        (<Mono>ask</Mono> default, <Mono>send</Mono>; counter tills always send). With ask, <Mono>pay()</Mono> in{' '}
        <Mono>Check.jsx</Mono> opens <Mono>UnsentModal</Mono> when <Mono>notFired(check)</Mono> finds items not sent or
        courses waiting (<Mono>unsent-send</Mono> Send and pay dispatches <Mono>sendAllSpecs()</Mono>,{' '}
        <Mono>unsent-pay</Mono> pays as it is); <Mono>PayModal</Mono>&apos;s <Mono>sendOnClose</Mono> puts{' '}
        <Mono>sendAllSpecs()</Mono> (a <Mono>lines.sent</Mono> with no held courses, then a <Mono>course.fired</Mono>{' '}
        per course waiting) before <Mono>check.closed</Mono>. <Mono>settings.tables</Mono> false (<Mono>tablesOn()</Mono>)
        leaves only tabs and orders; <Mono>settings.item_counts</Mono> (<Mono>showsItemCounts()</Mono>,{' '}
        <Mono>itemCounts(check)</Mono>: active lines by dish) puts <Mono>dish-count</Mono> on dish buttons in{' '}
        <Mono>MenuPanel.jsx</Mono> and <Mono>LayoutScreen.jsx</Mono>. Admin: the till window in{' '}
        <Mono>TillsSection.jsx</Mono> (<Mono>till-mode</Mono>, <Mono>till-tables</Mono>, <Mono>till-seats</Mono>,{' '}
        <Mono>till-unsent-at-pay</Mono>, <Mono>till-phone-tables</Mono>), Use seats in{' '}
        <Mono>RevenueStreamsSection.jsx</Mono>, Type a discount in <Mono>RolesSection.jsx</Mono>. Tests:{' '}
        <Mono>api/test/till-fixes.test.mjs</Mono>, <Mono>shared/pos/test/charges.test.mjs</Mono>,{' '}
        <Mono>approvals.test.mjs</Mono>.
      </P>
      <H3>Swipe left asks first, leaving with items not sent, take one off (14 Nov 2026, no migration)</H3>
      <P>
        Three device settings in <Mono>DeviceSettings</Mono> (<Mono>routes/posSetup.js</Mono>; jsonb, left out = the
        usual): <Mono>swipe_left</Mono> <Mono>send</Mono> | <Mono>fire</Mono>, <Mono>leave_unsent</Mono>{' '}
        <Mono>ask</Mono> | <Mono>leave</Mono> (absent = ask since migration 295, which set every till to ask;{' '}
        <Mono>leaveUnsent()</Mono> in <Mono>shared/pos/tillSettings.js</Mono>: anything but leave asks, counter
        tills never), <Mono>count_take_off</Mono> boolean. The till window in{' '}
        <Mono>TillsSection.jsx</Mono> shows <Mono>till-swipe-left</Mono> with Rows to swipe, <Mono>till-leave-unsent</Mono>{' '}
        on table service and <Mono>till-count-take-off</Mono> with the counts on (<Mono>Toggle</Mono> in{' '}
        <Mono>components/pos/shared.jsx</Mono> takes <Mono>testid</Mono>).
      </P>
      <P>
        <strong>Swipe left.</strong> <Mono>swipeLeftAction(check, config)</Mono> (<Mono>pos/src/lib/checkOps.js</Mono>) says{' '}
        <Mono>send</Mono>, <Mono>fire</Mono> or null from <Mono>notFired(check)</Mono>, in the order{' '}
        <Mono>swipe_left</Mono> gives (each falls back to the other); <Mono>SwipeCheckRow</Mono> carries it as{' '}
        <Mono>data-left</Mono> and <Mono>SwipeHint</Mono> words it. <Mono>swipeLeft()</Mono> in <Mono>Floor.jsx</Mono>{' '}
        opens the check (<Mono>then</Mono> <Mono>send</Mono>) only when it needs its details or guests first
        (<Mono>missingDetails()</Mono>, <Mono>coversMissing()</Mono>); otherwise it sets <Mono>confirm</Mono>{' '}
        (<Mono>{'{ kind, checkId }'}</Mono>) and the floor draws <Mono>SendModal</Mono> or <Mono>FireModal</Mono>{' '}
        (<Mono>CheckActions.jsx</Mono>) with <Mono>cancel</Mono> and a <Mono>title</Mono> naming the row, even for one
        course: <Mono>send-course</Mono> per course with <Mono>send-course-items</Mono>, <Mono>send-cancel</Mono>,{' '}
        <Mono>send-go</Mono>; <Mono>fire-course</Mono> (<Mono>data-course</Mono>, 64 px) with{' '}
        <Mono>fire-course-items</Mono>, <Mono>fire-cancel</Mono>. The window reads the check as it is now and goes when
        the check closes or leaves the till. <Mono>Modal</Mono>&apos;s <Mono>wrapTitle</Mono>{' '}
        (<Mono>pos/src/components/ui.jsx</Mono>) lets those titles take two lines.
      </P>
      <P>
        <strong>Leaving with items not sent.</strong> <Mono>leaveUnsent(config)</Mono> (counter tills always{' '}
        <Mono>leave</Mono>). <Mono>Main</Mono> in <Mono>App.jsx</Mono> keeps a <Mono>guard</Mono> ref:{' '}
        <Mono>go()</Mono> (the top bar&apos;s pages, <Mono>till-go-*</Mono> in the till menu) and{' '}
        <Mono>signOutGuarded()</Mono> (<Mono>sign-out</Mono>, <Mono>till-sign-out</Mono>) pass through it, and{' '}
        <Mono>TillNav</Mono> gives <Mono>guardLeave(fn)</Mono> (returns the function that takes it off) and{' '}
        <Mono>signOut</Mono>. <Mono>CheckScreen</Mono> registers <Mono>leave(proceed)</Mono> there and uses it for{' '}
        <Mono>check-back</Mono> and a layout&apos;s <Mono>back</Mono> / <Mono>sign_out</Mono> buttons (its own{' '}
        <Mono>onBack</Mono> doesn&apos;t pass through the guard). With ask and items not sent it opens{' '}
        <Mono>LeaveModal</Mono> (<Mono>leave-items</Mono>, <Mono>leave-stay</Mono>, <Mono>leave-go</Mono>,{' '}
        <Mono>leave-send</Mono>); <Mono>sendAndLeave(proceed)</Mono> asks for details first (<Mono>needDetails()</Mono>),
        opens the Send window with <Mono>then: proceed</Mono> when <Mono>needsSendChoice()</Mono>, else{' '}
        <Mono>sendCheck()</Mono> and goes on. The idle sign-out (<Mono>idleTimer</Mono> in <Mono>store.js</Mono>) calls{' '}
        <Mono>signOut()</Mono> directly and never asks.
      </P>
      <P>
        <strong>Take one off.</strong> <Mono>takesOffCounted(config)</Mono> = <Mono>item_counts</Mono> and{' '}
        <Mono>count_take_off</Mono>; <Mono>lineToTakeOff(check, itemId)</Mono> picks the dish&apos;s own line not sent
        yet, then one an order flow put on, then one sent (the newest of each). <Mono>takeOneOff(item)</Mono> in{' '}
        <Mono>Check.jsx</Mono>: a sent line opens <Mono>LineModal</Mono> with <Mono>initialMode</Mono> void and{' '}
        <Mono>initialVoidQty</Mono> 1; a new one asks <Mono>useApproval()</Mono> with <Mono>offApproval()</Mono>{' '}
        (<Mono>delete_unsent</Mono>; a fixed flow line always), then dispatches <Mono>line.changed</Mono> qty − 1 or{' '}
        <Mono>line.deleted</Mono> with <Mono>approved_by</Mono>, and a toast with Undo (<Mono>line.changed</Mono> + 1,
        or <Mono>line.added</Mono> of <Mono>copyOfLine()</Mono> once the line has gone; its button 48 px). The order
        screen passes <Mono>{'takeOff = { run, label }'}</Mono> to <Mono>MenuPanel</Mono> and{' '}
        <Mono>LayoutScreen</Mono> (<Mono>ItemsZone</Mono>, <Mono>CategoryZone</Mono>, <Mono>ButtonsZone</Mono>);{' '}
        <Mono>useDishPress()</Mono> (<Mono>MenuPanel.jsx</Mono>, used by <Mono>DishButton</Mono> and{' '}
        <Mono>LayoutButton</Mono>) decides per button: with a count on a button, a long press takes one off
        (<Mono>data-hold</Mono> <Mono>take_off</Mono>, else <Mono>sold_out</Mono>); on a list&apos;s row,{' '}
        <Mono>wrap()</Mono> puts it in a <Mono>dish-swipe</Mono> frame (<Mono>data-row</Mono>, <Mono>data-item</Mono>)
        that swipes left through <Mono>useRowSwipe()</Mono> (<Mono>pos/src/lib/rowSwipe.js</Mono>, shared with the
        floor&apos;s rows), showing <Mono>dish-swipe-off</Mono> (Take one off / Void
        one), while its long press keeps the sold out window. <Mono>useHold()</Mono> returns{' '}
        <Mono>{'{ cancel, handlers }'}</Mono> so a swipe that starts cancels the hold. <Mono>useRowSwipe()</Mono>&apos;s{' '}
        <Mono>swallow(key)</Mono> drops the click a swipe ends with; a new press clears it (the swipe that takes the
        last one off removes the row, so its click never comes).
      </P>
      <P>
        Tests: <Mono>api/test/till-fixes.test.mjs</Mono> (the three settings saved, in the till&apos;s config, refused
        when wrong, cleared when left out, viewer and another group).
      </P>
      <H3>Order flows (migrations 235, 236)</H3>
      <P>
        <Mono>shared/pos/orderFlows.js</Mono> is the one set of rules for the till, the cloud&apos;s sequencer, the
        venue hub, the designer and the API. A flow (<Mono>normaliseOrderFlow()</Mono> is its one shape) is{' '}
        <Mono>&#123; id, name, on, kind, trigger, apps, venue_ids, till_ids, kiosk_ids, match, ask, adds &#125;</Mono>: kind{' '}
        <Mono>ask</Mono> (a prompt, trigger <Mono>dish_added</Mono> or <Mono>checkout</Mono>; <Mono>ask</Mono> holds{' '}
        <Mono>title</Mono>, <Mono>message</Mono>, the offered <Mono>item_ids</Mono> in order, <Mono>pick</Mono> one |
        several, <Mono>every_time</Mono>, <Mono>skip_if_has</Mono>) or <Mono>add</Mono> (trigger <Mono>match</Mono>;{' '}
        <Mono>adds</Mono> up to 8 of <Mono>&#123; kind: &apos;dish&apos;, item_id, qty, removable &#125;</Mono> |{' '}
        <Mono>&#123; kind: &apos;charge&apos;, charge_id, removable &#125;</Mono>). <Mono>match</Mono> has{' '}
        <Mono>stream_names</Mono> (channels are revenue streams by name, <Mono>channelKey()</Mono>: every
        location&apos;s stream with that name), <Mono>type_ids</Mono>, <Mono>item_ids</Mono> / <Mono>section_ids</Mono>{' '}
        and <Mono>not_item_ids</Mono> / <Mono>not_section_ids</Mono>: each kind given must hold, any of its entries
        will do (<Mono>flowMatches()</Mono>; for <Mono>dish_added</Mono> the dishes are the dish just added, via{' '}
        <Mono>addedDishes()</Mono>, a combo&apos;s parts too). <Mono>apps</Mono> is any of <Mono>till</Mono>,{' '}
        <Mono>kiosk</Mono>, <Mono>online</Mono> (<Mono>FLOW_APPS</Mono>, in that order; a name that isn&apos;t one is
        dropped); <Mono>venue_ids</Mono> / <Mono>till_ids</Mono> / <Mono>kiosk_ids</Mono> null = every location /
        every till / every kiosk there (<Mono>flowRunsHere()</Mono>). Migration 236 renamed{' '}
        <Mono>flow.device_ids</Mono> to <Mono>till_ids</Mono>; a flow stored with no <Mono>apps</Mono> runs on tills,
        as before. Dishes a flow put on never count towards any flow&apos;s dish conditions
        (<Mono>orderDishes()</Mono> leaves out lines with a <Mono>flow</Mono> mark), so no flow feeds another or
        itself.
      </P>
      <P>
        <Mono>flowProblems()</Mono> stops a flow being switched on (codes <Mono>name</Mono>, <Mono>apps</Mono>,{' '}
        <Mono>tills</Mono>, <Mono>kiosks</Mono>, <Mono>venues</Mono>, <Mono>ask_title</Mono>, <Mono>ask_choices</Mono>,{' '}
        <Mono>adds</Mono>); <Mono>flowWarnings(f, &#123; channels, tills, kiosks, choices, charges, names &#125;)</Mono>{' '}
        only notes (<Mono>every_order</Mono>, <Mono>every_checkout</Mono>, <Mono>every_dish</Mono>,{' '}
        <Mono>no_channel</Mono>, <Mono>tills_elsewhere</Mono>, <Mono>kiosks_elsewhere</Mono>,{' '}
        <Mono>dish_choices</Mono> (a dish it adds needs a choice: left off), <Mono>charge_covers</Mono> (a charge from
        N guests never goes on a kiosk or online order), <Mono>offers_itself</Mono>, <Mono>off</Mono>). <Mono>flowWhenText()</Mono>, <Mono>flowIfLines()</Mono>,{' '}
        <Mono>flowThenLines()</Mono>, <Mono>flowWhereText()</Mono> and <Mono>flowSummary()</Mono> put a flow in words
        (the list and the designer&apos;s boxes). <Mono>newOrderFlow()</Mono> starts a prompt with no question.
      </P>
      <P>
        <strong>On a check</strong> (<Mono>shared/pos/checks.js</Mono>): a dish an add flow put on is a line with{' '}
        <Mono>flow &#123; id, key, removable &#125;</Mono> (<Mono>key</Mono> = <Mono>addKey()</Mono>,{' '}
        <Mono>flowId:dish:itemId</Mono>; never joined with another line); a charge carries{' '}
        <Mono>flow &#123; id, key &#125;</Mono> with <Mono>optional</Mono> = removable, and goes on from the list only
        when <Mono>flowChargeAdd()</Mono> finds that flow switched on adding that charge as removable or not as it
        says (else the list&apos;s own optional applies). <Mono>line.deleted</Mono> and <Mono>charge.removed</Mono>{' '}
        take <Mono>by_flow: true</Mono> when the flow takes its own dish or charge off (no reason, no manager; only
        a flow-marked unsent line or a flow-marked charge). Staff taking one off (delete, void, a charge removed)
        records its key in <Mono>check.flows_off</Mono>, so the flow doesn&apos;t put it back; a charge put back
        (<Mono>charge.restored</Mono>) clears it. A fixed dish (<Mono>removable: false</Mono>) needs{' '}
        <Mono>MANAGER_ALWAYS</Mono> to delete, void or lower (a Cancel order or Make it a combo swap excepted). The
        new event <Mono>check.flow_asked</Mono> <Mono>&#123; flow_id, answer: added | declined, item_ids &#125;</Mono>{' '}
        records a prompt in <Mono>check.flows_asked[flowId]</Mono> (<Mono>n</Mono>, answer, dishes, when, who).
      </P>
      <P>
        <strong>Which act now</strong>: <Mono>askFlowsFor(list, order, &#123; trigger, here, added &#125;)</Mono> gives
        the prompts due (switched on, running <Mono>here</Mono> = <Mono>&#123; venueId, deviceId, app, streams
        &#125;</Mono>, matching, not asked yet unless <Mono>every_time</Mono> on <Mono>dish_added</Mono>, not
        skipped by <Mono>skip_if_has</Mono>); <Mono>askChoices()</Mono> the offered dishes the till can sell (known,
        not sold out, on a menu shown). <Mono>flowAddsFor(list, order, here)</Mono> what add flows want on, and{' '}
        <Mono>flowSyncPlan(order, wanted)</Mono> the changes: <Mono>addDishes</Mono>, <Mono>removeLines</Mono> (unsent
        flow lines no longer wanted, and a second unsent line with a key already on: two tills adding at once),{' '}
        <Mono>addCharges</Mono>, <Mono>dropCharges</Mono>; nothing in <Mono>flows_off</Mono> goes back on.
      </P>
      <P>
        <strong>API</strong> (<Mono>routes/orderFlows.js</Mono>, Store tech view to read, manage to change):{' '}
        <Mono>GET /api/pos/order-flows</Mono> (in order, each with <Mono>problems</Mono>, <Mono>warnings</Mono>,{' '}
        <Mono>summary</Mono>, <Mono>where</Mono>), <Mono>GET /order-flows/catalog</Mono> (dishes by menu and section,
        channels with their locations, order types, charges, locations, tills), <Mono>POST /order-flows</Mono>{' '}
        (<Mono>&#123; name, kind, copy_from? &#125;</Mono>, switched off, at most 60; the catalogue also lists kiosks, and
        each dish&apos;s <Mono>needs_choices</Mono> and each charge&apos;s <Mono>min_covers</Mono>), <Mono>GET/PUT
        /order-flows/:id</Mono> (the whole flow; switched on with problems: 422 code <Mono>flow</Mono> with{' '}
        <Mono>problems</Mono>), <Mono>PATCH /order-flows/:id</Mono> <Mono>&#123; on &#125;</Mono>, <Mono>PUT
        /order-flows/order</Mono>, <Mono>DELETE /order-flows/:id</Mono> (checks keep what it put on). Table{' '}
        <Mono>pos_order_flows</Mono> (name, <Mono>is_active</Mono>, <Mono>sort_order</Mono> as columns, the rest in{' '}
        <Mono>flow</Mono> jsonb; forced RLS). <Mono>ownOrderFlow()</Mono> (<Mono>services/orderFlowSvc.js</Mono>)
        keeps only the company&apos;s own dishes, sections, order types, charges, locations, tills and kiosks
        (<Mono>flowIds()</Mono>, <Mono>ownFlow()</Mono>). <Mono>loadOrderFlows(tx, tenantId, venueId, &#123; app
        &#125;)</Mono> gives the venue&apos;s flows (switched on, in order; with <Mono>app</Mono> only those running
        there): every app&apos;s in <Mono>settings.flows</Mono> of <Mono>printConfig()</Mono> (the sequencer, and so
        the hub, which judge flow charges with them), the tills&apos; in <Mono>tillConfig()</Mono>, the kiosks&apos;
        in <Mono>kioskConfig()</Mono>; a change tells the company&apos;s tills and kiosks to download their config. Migration 235 put an Order flows link after Charges
        in every Store tech menu.
      </P>
      <P>
        <strong>Till</strong> (<Mono>pos/src/lib/orderFlows.js</Mono>): <Mono>flowPlace()</Mono>,{' '}
        <Mono>queueFlowPrompts(checkId, trigger, &#123; added, then, shownIds &#125;)</Mono> (a module queue read with{' '}
        <Mono>useFlowPrompts()</Mono>; prompts with nothing to offer are left out; the last carries{' '}
        <Mono>then</Mono>, e.g. <Mono>&#123; kind: &apos;pay&apos;, opts &#125;</Mono>), <Mono>answerFlowPrompt()</Mono>{' '}
        (sends <Mono>check.flow_asked</Mono>, returns the <Mono>then</Mono>), <Mono>syncFlows(checkId)</Mono> (runs the
        plan, toasts each change, never retries a dish that can&apos;t go on: one with choices, one unknown),{' '}
        <Mono>offApproval()</Mono> (adds <Mono>MANAGER_ALWAYS</Mono> for a fixed flow dish), <Mono>flowNameOf()</Mono>.{' '}
        <Mono>screens/Check.jsx</Mono> queues <Mono>dish_added</Mono> prompts after each dish (from the menu, a layout
        or the choices window; not for dishes added from a prompt), gates <Mono>pay()</Mono> on the checkout ones
        (Pay opens after the last answer, with <Mono>flowsAsked</Mono>), and runs <Mono>syncFlows()</Mono> whenever
        the check&apos;s lines, charges, type, stream, <Mono>flows_off</Mono> or the config version change;{' '}
        <Mono>screens/Counter.jsx</Mono> queues them for the first dish. <Mono>components/FlowPrompt.jsx</Mono> draws
        the prompt (<Mono>paused</Mono> while a dish&apos;s choices window is open, keeping its counts). Admin:{' '}
        <Mono>components/pos/OrderFlowsSection.jsx</Mono> (Store tech → Order flows, <Mono>/pos/flows</Mono>: the
        list, drag order, on / off, copy, delete, New flow) and <Mono>pages/OrderFlowDesigner.jsx</Mono>{' '}
        (<Mono>/pos/flows/:id</Mono>: the Where, When, If and Then boxes, their panels, the preview; the draft keeps
        the words as typed, <Mono>cleanFlow()</Mono> is what is checked and compared). Tests:{' '}
        <Mono>shared/pos/test/orderFlows.test.mjs</Mono>, <Mono>api/test/order-flows.test.mjs</Mono>.
      </P>
      <P>
        <strong>Guests: kiosks and online ordering</strong> (migration 236). A guest&apos;s basket holds only what
        the guest put in; what add flows put on is worked out from it whenever it changes, never stored in it.{' '}
        <Mono>basketOrder()</Mono> makes the order flows see (lines, stream, order type, <Mono>flows_off</Mono>,{' '}
        <Mono>flows_asked</Mono>) and <Mono>guestFlowAdds(list, order, here, off, &#123; all &#125;)</Mono> says
        what goes on: nothing until the guest has a dish of their own, and only removable things can be taken off
        (<Mono>off</Mono> is keys from <Mono>addKey()</Mono>; <Mono>leftOff</Mono> lists them for Add it back).
        Prompts are answered once per order (<Mono>askedAfter()</Mono>); <Mono>cleanFlowsOff()</Mono> /{' '}
        <Mono>cleanFlowsAsked()</Mono> tidy what a guest&apos;s order carries. A dish with options or a meal deal,
        one sold out or not on a menu on now is left off, and a charge counting from N guests never goes on (a guest
        order has no guest count).
      </P>
      <P>
        <strong>Kiosk</strong> (<Mono>shared/kiosk.js</Mono>): <Mono>kioskPlace()</Mono>,{' '}
        <Mono>kioskFlows(config, basket, &#123; device, order_type_id, off, asked, soldOut, isOn &#125;)</Mono>{' '}
        (<Mono>entries</Mono>: the flow dishes as basket entries with their <Mono>flow</Mono> mark;{' '}
        <Mono>charges</Mono>: as <Mono>charge.added</Mono> carries them, from the list, <Mono>optional</Mono> =
        removable, <Mono>flow &#123; id, key &#125;</Mono>; <Mono>leftOff</Mono>; <Mono>order</Mono>),{' '}
        <Mono>promptChoices()</Mono> (what a prompt can offer: known, sellable, not sold out, on now) and{' '}
        <Mono>kioskPrompts()</Mono> (due on <Mono>dish_added</Mono> with the entry added, or at{' '}
        <Mono>checkout</Mono>). <Mono>kioskOrder()</Mono> sends the flow dishes as lines with their marks, the
        charges as <Mono>charge.added</Mono>, each prompt answered as <Mono>check.flow_asked</Mono> and{' '}
        <Mono>flows_off</Mono> on <Mono>check.opened</Mono>, checked with the venue&apos;s settings (its flows and
        charges list). <Mono>KIOSK_EVENTS</Mono> gained <Mono>check.flow_asked</Mono> and <Mono>charge.added</Mono>{' '}
        (only from the list with a flow mark, then judged by <Mono>flowChargeAdd()</Mono> as on a till). The
        kiosk&apos;s config carries its flows and the charges list in <Mono>settings</Mono>, and the dishes they put
        on from a section hidden on the website stay known in <Mono>items</Mono> (<Mono>tillMenuData()</Mono>{' '}
        <Mono>keepIds</Mono>, with <Mono>hidden_menu_ids</Mono>, read by <Mono>itemOffNow()</Mono>), never on its
        menu. The app (<Mono>pos/src/kiosk/store.js</Mono>): <Mono>flowsNow()</Mono>, <Mono>orderEntries()</Mono>,{' '}
        <Mono>orderCharges()</Mono>, <Mono>setFlowOff()</Mono>, the prompt queue (<Mono>state.prompt</Mono>,{' '}
        <Mono>promptNow()</Mono>, <Mono>promptPick()</Mono>, <Mono>promptDone()</Mono>, <Mono>beforePaying()</Mono>;
        a dish with choices opens its page with <Mono>fromPrompt</Mono>), <Mono>FlowPrompt.jsx</Mono>{' '}
        (<Mono>k-flow-prompt</Mono>, <Mono>k-flow-dish</Mono>, <Mono>k-flow-count</Mono>, <Mono>k-flow-done</Mono>),
        the basket&apos;s <Mono>k-flow-line</Mono> / <Mono>k-flow-off</Mono>, <Mono>k-flow-charge</Mono> /{' '}
        <Mono>k-flow-charge-off</Mono> and <Mono>k-flow-left-off</Mono> / <Mono>k-flow-on</Mono> in{' '}
        <Mono>Checkout.jsx</Mono>; journeys record <Mono>flowsOff</Mono> and <Mono>prompt</Mono>. Prompt words are
        translated as <Mono>TK.flow(id, &apos;title&apos; | &apos;message&apos;)</Mono> (Menus → Translations, Order
        flows). A kiosk order opened on a till keeps the kiosk&apos;s flows (<Mono>orderOrigin()</Mono> in the
        till&apos;s <Mono>syncFlows()</Mono>).
      </P>
      <P>
        <strong>Online ordering</strong>: <Mono>onlineFlows(tx, venue, settings)</Mono>{' '}
        (<Mono>services/orderFlowSvc.js</Mono>) gives the flows running online at the venue, <Mono>here</Mono> (its
        channel: the revenue stream Ordering setup picks), the order type (collection) and their charges as the
        list has them (with VAT); <Mono>basketFlows()</Mono> (<Mono>services/orderSvc.js</Mono>) adds the dishes
        they can put on (<Mono>partsById</Mono>: a section hidden on the website too) and{' '}
        <Mono>itemOk</Mono> at the collection time (<Mono>partMenus</Mono>). <Mono>priceBasket(..., &#123; flows
        &#125;)</Mono> (<Mono>shared/orderPricing.js</Mono>) prices the flow dishes as lines with their{' '}
        <Mono>flow</Mono> mark after the guest&apos;s, the charges after every discount (never in the subtotal), and
        returns <Mono>own_subtotal_pence</Mono> (the guest&apos;s dishes: what the minimum order counts),{' '}
        <Mono>charges</Mono>, <Mono>charges_pence</Mono> and <Mono>flows_off</Mono> (left off); total = subtotal −
        discount + charges + tip. A line can&apos;t bring a flow mark of its own. <Mono>GET /order-api/venues/:id</Mono>{' '}
        sends <Mono>flows</Mono> (<Mono>publicFlows()</Mono>: no names or places, with <Mono>items</Mono> = the
        dishes they put on), and serves <Mono>/pos/orderFlows.js</Mono>, <Mono>/pos/charges.js</Mono>,{' '}
        <Mono>/pos/ids.js</Mono> and <Mono>/tax.js</Mono> for the page. The quote and the order take{' '}
        <Mono>flows_off</Mono> (keys) and <Mono>flows_asked</Mono>; <Mono>createOrder()</Mono> works the flows out
        again and stores <Mono>orders.charges</Mono>, <Mono>charges_pence</Mono> and <Mono>flows</Mono>{' '}
        <Mono>&#123; asked, off &#125;</Mono> (only this order&apos;s flows, only removable keys) and{' '}
        <Mono>order_items.flow</Mono>; <Mono>publicOrder()</Mono> / <Mono>adminOrder()</Mono> show the charges and
        each flow dish&apos;s <Mono>&#123; removable &#125;</Mono>, as do the board&apos;s order window, the printed
        ticket and the order emails. The page (<Mono>views/site/shared/ordering.eta</Mono>): flow lines in the
        basket (<Mono>data-flow-line</Mono>; a removable one has a 48 px cross, <Mono>.mo-flow-x</Mono> with{' '}
        <Mono>data-flow-off</Mono>), the charges (<Mono>.mo-flow-charge</Mono>, <Mono>data-flow-charge</Mono>, the
        same cross), what was taken off with Add it back (<Mono>data-flow-left-off</Mono>,{' '}
        <Mono>data-flow-on</Mono>), the prompts after a dish and before paying (<Mono>data-flow-prompt</Mono>,{' '}
        <Mono>data-flow-dish</Mono>, <Mono>data-flow-no</Mono>; what was taken off and asked kept per venue in
        localStorage <Mono>maca_flows_&lt;venue&gt;</Mono>, cleared with the basket), the status page&apos;s
        charges. Tests: <Mono>shared/test/guestFlows.test.mjs</Mono>,{' '}
        <Mono>api/test/order-flows-guests.test.mjs</Mono>.
      </P>
      <P>
        <strong>How a prompt looks</strong> (no migration: it is part of the flow&apos;s jsonb). A prompt&apos;s{' '}
        <Mono>ask.look</Mono> is <Mono>&#123; till, kiosk, online &#125;</Mono>, each null (the channel&apos;s
        standard look, <Mono>promptLookDefault(app)</Mono>: tills left, cards, no pictures; kiosks centred, cards,
        pictures; online left, rows, pictures) or <Mono>&#123; header: &#123; style plain | band | picture, align
        left | center, image_url &#125;, background: &#123; image_url, shade 0-90 &#125;, dishes cards | rows,
        pictures, colours: &#123; window, header, title, text, cards, button &#125; &#125;</Mono>. A colour is null
        (the channel&apos;s own), a theme role (<Mono>PROMPT_ROLES</Mono>: primary, accent, background, surface,
        text, muted) or a <Mono>#rrggbb</Mono> code. <Mono>normalisePromptLook()</Mono> (inside{' '}
        <Mono>normaliseOrderFlow()</Mono>) stores a part only when it differs from the default and drops the whole
        look when every part is null; <Mono>promptPicture()</Mono> takes only <Mono>/path</Mono> or{' '}
        <Mono>http(s)://</Mono> addresses with no spaces, quotes, brackets or backslashes (they go into CSS{' '}
        <Mono>url()</Mono>). Drawing: <Mono>promptStyle(f, app, theme)</Mono> turns roles into codes from the
        channel&apos;s theme (a band without its own colour takes primary) and works out words on a colour with{' '}
        <Mono>promptInk()</Mono> (the theme&apos;s text or background colour, whichever has the better contrast,
        else black or white under 4.5:1); <Mono>promptBackground(st, standard)</Mono> is the one CSS background
        (the colour, or the picture under a veil of the prompt&apos;s colour at <Mono>shade</Mono>%). The
        channel&apos;s theme: tills get <Mono>config.theme_colors</Mono> from <Mono>brandColours(tx, tenantId,
        venueId)</Mono> (<Mono>services/themeColours.js</Mono>: the location&apos;s own Brand &amp; theme while{' '}
        <Mono>use_brand_override</Mono> is on, else the group&apos;s, over <Mono>BRAND_DEFAULTS</Mono>, the same
        rule <Mono>/api/me</Mono>&apos;s <Mono>site_theme</Mono> uses); kiosks use their design&apos;s{' '}
        <Mono>brand.colors</Mono> (a see-through surface counts as the page colour); the ordering page reads the
        site&apos;s CSS variables (<Mono>--c-*</Mono>, so a location&apos;s own brand applies by itself).{' '}
        <Mono>withLookFor(list, app)</Mono> (<Mono>services/orderFlowSvc.js</Mono>) cuts each look down to the
        channel&apos;s own part in the till config, the kiosk config and <Mono>publicFlows()</Mono>, so a kiosk only
        saves the pictures its own prompts show (<Mono>configImages()</Mono> finds them by their{' '}
        <Mono>image_url</Mono> keys). The dishes a till&apos;s ask flows offer carry their photo in the till config
        (<Mono>tillMenuData(..., &#123; pictureIds &#125;)</Mono>; other till dishes don&apos;t). Drawn by{' '}
        <Mono>pos/src/components/FlowPrompt.jsx</Mono> (a bare <Mono>Modal</Mono> with <Mono>panelStyle</Mono>;{' '}
        <Mono>flow-prompt</Mono> <Mono>data-look</Mono> <Mono>data-header</Mono> <Mono>data-dishes</Mono>{' '}
        <Mono>data-pictures</Mono>, <Mono>flow-prompt-band</Mono>, <Mono>flow-prompt-picture</Mono>,{' '}
        <Mono>flow-prompt-photo</Mono>), <Mono>pos/src/kiosk/FlowPrompt.jsx</Mono> (a bare <Mono>Sheet</Mono> with
        its <Mono>background</Mono>; <Mono>k-flow-band</Mono>, <Mono>k-flow-picture</Mono>,{' '}
        <Mono>k-flow-row</Mono>, <Mono>k-flow-row-img</Mono>, <Mono>k-flow-words</Mono> in kiosk.css) and{' '}
        <Mono>openFlowPrompt()</Mono> in <Mono>ordering.eta</Mono> (<Mono>.mo-flow-sheet</Mono>,{' '}
        <Mono>data-flow-band</Mono>, <Mono>data-flow-picture</Mono>, <Mono>.mo-flow-card</Mono>,{' '}
        <Mono>siteTheme()</Mono>). Admin: <Mono>components/pos/PromptLook.jsx</Mono> (<Mono>LookPanel</Mono>: the
        channel switch <Mono>look-panel-app</Mono>, <Mono>look-state</Mono>, colour rows{' '}
        <Mono>look-colour-&lt;key&gt;</Mono> with a swatch per role, a picker and a code, <Mono>look-shade</Mono>,{' '}
        <Mono>look-standard</Mono>, <Mono>look-copy-&lt;app&gt;</Mono>; <Mono>PromptPreview</Mono> with{' '}
        <Mono>preview-app</Mono> and, for kiosks, <Mono>look-kiosk-design</Mono>; <Mono>lookLines()</Mono> for the
        designer&apos;s Look box <Mono>box-look</Mono>). The catalogue route (<Mono>GET
        /api/pos/order-flows/catalog</Mono>) sends <Mono>themes &#123; brand, kiosk &#125;</Mono> (each kiosk design&apos;s
        colours with <Mono>used_by</Mono>, most used first; a kiosk with no design counts for the first one, as{' '}
        <Mono>loadDesign()</Mono> does) and each dish&apos;s <Mono>image_url</Mono>. A brand change reaches tills with
        their next config download (nothing tells them); a kiosk design change is pushed. Tests:{' '}
        <Mono>shared/pos/test/promptLook.test.mjs</Mono>, <Mono>api/test/prompt-look.test.mjs</Mono>.
      </P>
      <H3>The order prompt (migration 226)</H3>
      <P>
        <Mono>pos/src/components/OrderPrompt.jsx</Mono> is the one place the till asks for a check&apos;s order type,
        customer name and tent number. It covers the screen (<Mono>fixed inset-0 z-50</Mono>) and brings its own keys:{' '}
        <Mono>Keyboard</Mono> in <Mono>components/ui.jsx</Mono> (letters, digits, Shift once, &apos; and -, Space,
        Clear, Delete; a capital at the start and after a space, hyphen or apostrophe, Shift turning that round for
        one letter) for the name and the big <Mono>Keypad</Mono> (6 digits) for the tent number. The inputs are{' '}
        <Mono>inputMode=&quot;none&quot;</Mono> (no tablet keyboard) but keep the DOM focus, so a keyboard plugged in
        types there too (Enter: the next empty field, else Done); the keys&apos; wrapper cancels{' '}
        <Mono>mousedown</Mono> so tapping a key never takes the focus. Props: <Mono>types</Mono> (the stream&apos;s{' '}
        <Mono>streamTypes()</Mono>), <Mono>promptsOf(typeId)</Mono> (off | ask | required per field, usually{' '}
        <Mono>promptsFor()</Mono>), <Mono>style</Mono>, <Mono>start</Mono> (<Mono>details</Mono> skips step 1),{' '}
        <Mono>onDone(&#123; typeId, name, tent &#125;)</Mono> (a field the type doesn&apos;t ask keeps the value it came
        with), <Mono>noteFor</Mono>. The field the keys type into is state picked when the type is picked (its first
        empty field) or a field is tapped, never moved by typing; the style is frozen when the prompt opens, so a
        setting pushed meanwhile can&apos;t change the screen under the person&apos;s finger. Tapping a type that asks
        for nothing calls <Mono>onDone</Mono> straight away; with nothing to choose or ask it never shows.
      </P>
      <P>
        <Mono>pos_revenue_streams.order_prompt</Mono> (<Mono>one</Mono> default | <Mono>two</Mono>, CHECK; a venue
        setting until migration 296) and a till&apos;s own <Mono>pos_devices.settings.order_prompt</Mono>{' '}
        (<Mono>stream</Mono> | <Mono>one</Mono> | <Mono>two</Mono>, Zod in <Mono>routes/posSetup.js</Mono>);{' '}
        <Mono>orderPromptOf(config, streamId)</Mono> in <Mono>shared/pos/tillSettings.js</Mono> decides (the
        till&apos;s own, else the stream the order is in: a new order&apos;s <Mono>defaultStreamId()</Mono>, a
        check&apos;s <Mono>revenue_stream_id</Mono>). One screen shows the types as a row above the fields; two steps
        shows big type buttons first, then the fields with Back. Callers: <Mono>screens/Counter.jsx</Mono> (New order,
        or the first dish when <Mono>newOrderAsks()</Mono>: more than one type, or the only type asks something; the
        answers wait on the left with Change / clear until a dish opens the check), <Mono>NewTabModal</Mono> in{' '}
        <Mono>screens/Floor.jsx</Mono> (the name is at least <Mono>ask</Mono>: it is how a tab is found),{' '}
        <Mono>OrderTypeModal</Mono> / <Mono>NameModal</Mono> in <Mono>components/CheckActions.jsx</Mono> (More → Order
        type, Tent number, Name; the events and the re-rating are unchanged) and <Mono>Check.jsx</Mono>&apos;s missing
        details at Send / Pay (<Mono>start: &apos;details&apos;</Mono>). Tests:{' '}
        <Mono>api/test/till-order-prompt.test.mjs</Mono>.
      </P>
      <H3>Till layouts (migration 228)</H3>
      <P>
        <Mono>shared/pos/tillLayout.js</Mono> is the one set of rules for the till, the designer and the API. A
        layout is <Mono>&#123; cols, rows, zones &#125;</Mono> (4-24 x 3-16 cells, 12 x 8 at first); each zone is{' '}
        <Mono>&#123; id, type, x, y, w, h &#125;</Mono> on that grid. The zones with buttons (<Mono>GRID_ZONES</Mono>:
        categories, menus, items, buttons, modifiers, popup) add their own <Mono>cols</Mono> x <Mono>rows</Mono> (1-12),{' '}
        <Mono>font</Mono> (12-36 px), <Mono>bold</Mono>, <Mono>overflow</Mono> (<Mono>scroll</Mono> |{' '}
        <Mono>pages</Mono> | <Mono>more</Mono> | <Mono>hide</Mono>) and where the words sit on their buttons:{' '}
        <Mono>align</Mono> (<Mono>ALIGNS</Mono>: left | center | right) and <Mono>valign</Mono> (<Mono>VALIGNS</Mono>:
        top | middle | bottom), defaulting per type to the look before they existed (<Mono>GRID_DEFAULTS</Mono>:
        categories and buttons centre / middle, dishes and choices left / top), so older layouts read the same.{' '}
        <Mono>buttonTextStyle(zone)</Mono> turns them into a flex column&apos;s <Mono>alignItems</Mono>,{' '}
        <Mono>justifyContent</Mono> and <Mono>textAlign</Mono>; top is <Mono>space-between</Mono>, so a
        button&apos;s second line (a price, Sold out) stays at its bottom, while middle and bottom put it under the
        words. The till&apos;s <Mono>SectionButton</Mono>, <Mono>DishButton</Mono> (<Mono>place</Mono>),{' '}
        <Mono>LayoutButton</Mono> and Dish choices cells and the designer&apos;s <Mono>GridPreview</Mono> all style
        their buttons with it. The Order zone and the Seat and course zone have none (their buttons are sized to
        their words). Categories carry <Mono>sections</Mono> (ids in
        order; null = every section of the till&apos;s menus), dishes <Mono>search</Mono> and <Mono>price</Mono>,
        buttons zones <Mono>buttons</Mono> (<Mono>&#123; id, action, label, colour, w, h &#125;</Mono>, with{' '}
        <Mono>item_id</Mono>, <Mono>preset_id</Mono> or <Mono>tender</Mono> for the actions that name one;{' '}
        <Mono>BUTTON_ACTIONS</Mono>, where <Mono>check: true</Mono> means it needs an order on screen), modifiers{' '}
        <Mono>kind</Mono> (all | required | optional), <Mono>cover</Mono> (zone | screen),{' '}
        <Mono>show_name</Mono>, <Mono>show_description</Mono>, <Mono>show_prices</Mono> (default true),{' '}
        <Mono>auto_add</Mono> and <Mono>split_picks</Mono> (default false; never both: with{' '}
        <Mono>split_picks</Mono> on, <Mono>normaliseZone()</Mono> sets <Mono>auto_add</Mono> false), and the Seat
        and course zone <Mono>font</Mono> and <Mono>parts</Mono> (<Mono>SEAT_PARTS</Mono>: both | seats | courses,
        read by <Mono>SeatCourseBar</Mono>&apos;s <Mono>parts</Mono>). The layout has <Mono>top_bar</Mono> (default true; false = the
        order screens without the till&apos;s top bar), and the Order zone <Mono>font</Mono> (12-36, 16 = the
        standard size), <Mono>hide</Mono> (keys of <Mono>CHECK_BUTTONS</Mono>: back, cancel, more, send, bill, pay,
        kept in that order) and <Mono>colours</Mono> (<Mono>&#123; cancel, more, send, bill, pay &#125;</Mono>, a
        colour code or null). Each of the Order zone&apos;s buttons has a button action that does its job
        (<Mono>CHECK_BUTTONS[].action</Mono>; Pay is also done by exact_cash, exact_card and tender), and{' '}
        <Mono>layoutWarnings()</Mono> gives <Mono>hidden_button</Mono> (with <Mono>button</Mono>) for one left out
        with no such button. Button actions <Mono>till_menu</Mono>, <Mono>sign_out</Mono> and <Mono>menus</Mono>{' '}
        (which menus show, migration 230: see Menus &gt; Menu times) work without an order.{' '}
        <Mono>normaliseTillLayout()</Mono> is the only way a layout is read (unknown zones and buttons dropped, every
        number inside its limits, repeated ids renamed). <Mono>layoutProblems()</Mono> stops a save (no Order zone,
        more zones of a type than its <Mono>max</Mono>, two Dish choices zones that don&apos;t split Must pick and
        Optional, zones overlapping other than the ones that float (<Mono>floats(zone)</Mono>: Dish choices, pop-ups
        and any zone shown as a pop-up), a pop-up nothing closes, an Order zone shown as a pop-up that no button
        opens); <Mono>layoutWarnings()</Mono> only advises.{' '}
        <Mono>packCells(cells, zone)</Mono> places a zone&apos;s buttons (the first free place row by row; a button
        bigger than the grid is cut down) and returns <Mono>&#123; pages, rest, hidden, rows, cols &#125;</Mono>. In a
        Dish choices zone (<Mono>type</Mono> modifiers) each cell goes in the first free place after the cell before it
        (<Mono>Grid</Mono>&apos;s <Mono>inOrder</Mono>, 14 Nov 2026): a group&apos;s heading is as wide as the zone, so a
        later group&apos;s choices filling the gap at the end of the row before it put them under the wrong heading. The
        till&apos;s <Mono>ZoneGrid.jsx</Mono> and the designer&apos;s <Mono>GridPreview</Mono> both use it, so a button
        lands in the same place in both.
      </P>
      <P>
        The Menus zone (type <Mono>menus</Mono>, one per layout, 1 Nov 2026) is a zone with buttons like categories,
        plus <Mono>menu_ids</Mono> (ids in order, at most <Mono>MAX_MENUS</Mono> 30; null = every menu of the
        till&apos;s revenue stream), <Mono>tap</Mono> (<Mono>MENU_TAPS</Mono>: one | several),{' '}
        <Mono>times_button</Mono> (default true) and <Mono>show_times</Mono> (default false).{' '}
        <Mono>menuZoneMenus(zone, menus)</Mono> gives the picked ones the till has, in the zone&apos;s order, else all
        of the till&apos;s menus. A tap goes through <Mono>switchMenus(shown, menuId, tap)</Mono> in{' '}
        <Mono>shared/menuTimes.js</Mono> (shown = <Mono>useShownMenus()</Mono>): null when nothing changes (the menu
        is the only one showing), <Mono>&#123; follow: true &#125;</Mono> when the result is what the menu times show
        by themselves (every menu when none is on), else <Mono>&#123; ids &#125;</Mono> in the till&apos;s menu order,
        stored as the till&apos;s pick (<Mono>prefs.menu_pick</Mono>) and lapsing like one from More → Menus.{' '}
        <Mono>ownTillLayout()</Mono> keeps only the company&apos;s menus (<Mono>layoutIds().menus</Mono>). The till
        draws it with <Mono>MenusZone</Mono> / <Mono>MenuButton</Mono> in <Mono>LayoutScreen.jsx</Mono>, from the{' '}
        <Mono>shownMenus</Mono> that <Mono>Check.jsx</Mono> and <Mono>Counter.jsx</Mono> already work out for the
        screen. The designer previews it from the setup&apos;s <Mono>menus</Mono>, which carry{' '}
        <Mono>till_times</Mono> (<Mono>channelMenuTimes(..., &apos;till&apos;)</Mono>: a schedule, null = any time,
        false = off on the tills; those never show in the zone or its preview).
      </P>
      <P>
        A category&apos;s dishes zone (type <Mono>category</Mono>, up to 8 per layout, 6 Nov 2026) is a grid zone
        (<Mono>GRID_DEFAULTS.category</Mono> 4 x 2, scroll, words top left) with <Mono>section_id</Mono> (a menu
        section, null until picked: warning <Mono>category_unset</Mono>) and <Mono>price</Mono> (default true); it
        counts as a way to find dishes for <Mono>no_dishes</Mono>. It and the Dishes zone (<Mono>items</Mono>) carry{' '}
        <Mono>hide_item_ids</Mono> (dish ids, unique, at most <Mono>MAX_HIDDEN</Mono> 300): dishes left out of that zone
        only. <Mono>shownDishIds(zone, ids)</Mono> is the one rule (the list without them, in its order), used by the
        till&apos;s <Mono>CategoryZone</Mono> and the designer&apos;s preview; the till&apos;s <Mono>ItemsZone</Mono>{' '}
        skips them in its own walk so its search leaves them out too. <Mono>ownLayout()</Mono> keeps a category zone&apos;s{' '}
        <Mono>section_id</Mono> only when it is the company&apos;s (else null) and <Mono>hide_item_ids</Mono> only the
        company&apos;s dishes; <Mono>layoutIds()</Mono> lists both so <Mono>ownTillLayout()</Mono> looks them up. On the
        till <Mono>CategoryZone</Mono> (<Mono>zone-category</Mono>) finds the section on the menus shown now, else on
        any of the till&apos;s menus (<Mono>tillMenus</Mono>), and shows it empty with a note when neither has it. The
        designer: <Mono>CategoryZoneOptions</Mono> (<Mono>tl-category-section</Mono>, a select by menu; changing it
        clears <Mono>hide_item_ids</Mono>; <Mono>tl-category-dish</Mono> chips with <Mono>aria-pressed</Mono>,{' '}
        <Mono>tl-category-show-all</Mono>), <Mono>LeftOutDishes</Mono> for the Dishes zone (<Mono>tl-left-out</Mono>,{' '}
        <Mono>tl-left-out-dish</Mono>, <Mono>tl-leave-out</Mono>), <Mono>zoneName()</Mono> giving Dishes: and the
        section&apos;s title.
      </P>
      <P>
        Several Dishes zones (14 Nov 2026, no migration): a layout takes up to four Categories zones and four Dishes
        zones (<Mono>ZONE_TYPES</Mono> max 4 each; <Mono>MAX_ZONES</Mono> went to 40 so every type at its most still fits,
        and to 50 with Label zones). A
        Dishes zone carries <Mono>follows</Mono>, the id of the Categories zone whose open category it shows;
        null, or an id the layout doesn&apos;t have (cleared by <Mono>normaliseTillLayout()</Mono>), means the first.{' '}
        <Mono>categoriesZoneOf(layout, zone)</Mono> is the one rule (the till, the designer&apos;s previews, the
        warnings) and <Mono>dishesZonesOf(layout, cats)</Mono> the other way round. Warnings: <Mono>categories_alone</Mono>{' '}
        per Categories zone no Dishes zone follows (<Mono>zones</Mono> = that zone; the old wording when the layout has
        no Dishes zone at all) and <Mono>same_dishes</Mono> when two or more follow one (<Mono>zones</Mono> = them),
        naming zones as <Mono>nthName()</Mono> does (Dishes 2 when the layout has several). On the till{' '}
        <Mono>LayoutScreen</Mono> keeps the open category per Categories zone (<Mono>sectionPicks</Mono>, remembered
        as <Mono>layoutId + &apos;:sections&apos;</Mono>), each zone&apos;s categories in <Mono>catSections</Mono> and{' '}
        <Mono>openIn(cats)</Mono>; a Dishes zone takes <Mono>openIn(categoriesZoneOf(layout, z))</Mono>, and a
        pop-up Categories zone&apos;s opener notes its own open category. The designer: <Mono>FollowsPicker</Mono>{' '}
        (<Mono>tl-follows</Mono> with a button per Categories zone, <Mono>aria-pressed</Mono>, <Mono>data-zone-id</Mono>,
        what it lists from <Mono>catsSummary()</Mono>; <Mono>tl-follows-hint</Mono>), <Mono>FollowedBy</Mono> on a
        Categories zone (<Mono>tl-followed-by</Mono>, <Mono>tl-follower</Mono> a div that opens the zone so View users
        can still use it, <Mono>tl-no-follower</Mono>, <Mono>tl-followers-same</Mono>, <Mono>tl-make-follow</Mono>{' '}
        through <Mono>onPatchZone</Mono>), <Mono>addZone()</Mono> giving a new Dishes zone the first Categories zone
        nothing follows, <Mono>previewCells()</Mono> through <Mono>categoriesZoneOf()</Mono>, and the canvas naming
        zones as the zone list does (<Mono>zoneName()</Mono>, Categories 2).
      </P>
      <P>
        The look (14 Nov 2026, no migration; layouts are jsonb and ones saved before keep their look). A{' '}
        <strong>Label</strong> zone (type <Mono>label</Mono>, up to 12) is words on the screen: <Mono>text</Mono> (up
        to <Mono>LABEL_TEXT_MAX</Mono> 200 characters, its lines kept), <Mono>font</Mono> (<Mono>LABEL_FONT</Mono> 10 to
        72, 24), <Mono>colour</Mono>, <Mono>bold</Mono> (default true), <Mono>align</Mono> and <Mono>valign</Mono>{' '}
        (centre and middle); one without words is the warning <Mono>empty_label</Mono>. Every zone but the Order takes{' '}
        <Mono>background</Mono> (a colour; the Order keeps its white panel), every zone <Mono>border</Mono>{' '}
        (<Mono>&#123; style: none | thin | bold | dotted, colour &#125;</Mono>, <Mono>BORDER_STYLES</Mono>; 1, 3 and 2 px; the
        till&apos;s dark ink when no colour is set) and every zone with buttons (<Mono>BUTTON_ZONES</Mono>: the grid
        zones, the Order and Seat and course) <Mono>button_border</Mono> (<Mono>BUTTON_BORDERS</Mono>: standard keeps
        each button&apos;s own, none takes it away). The layout&apos;s own <Mono>background</Mono> is behind the zones
        (the gaps and the cells no zone takes). A category&apos;s dishes zone adds <Mono>button_colour</Mono> and{' '}
        <Mono>button_text</Mono> (null = words made readable on the colour) and the category&apos;s name above its
        dishes (<Mono>show_name</Mono>, default false; <Mono>name_font</Mono> <Mono>NAME_FONT</Mono> 12 to 48, 18;{' '}
        <Mono>name_colour</Mono>). The till and the designer draw all of it through the same helpers in{' '}
        <Mono>shared/pos/tillLayout.js</Mono>: <Mono>zoneBoxStyle(zone)</Mono> (background, its words by{' '}
        <Mono>inkOnColour()</Mono>, notes and counts through <Mono>--zone-muted</Mono> and the till&apos;s{' '}
        <Mono>zone-muted</Mono> class, <Mono>zoneInk()</Mono>; the border), <Mono>buttonBorderStyle(zone)</Mono>{' '}
        (laid over each button&apos;s own style) and <Mono>categoryButtonStyle(zone)</Mono>. On the till:{' '}
        <Mono>LabelZone</Mono> (<Mono>zone-label</Mono> with <Mono>data-align</Mono> / <Mono>data-valign</Mono>,{' '}
        <Mono>label-text</Mono>), <Mono>category-name</Mono> above a category&apos;s dishes, the layout&apos;s
        background on <Mono>layout-screen</Mono>. The designer: the zone&apos;s <Mono>tl-look</Mono> part
        (<Mono>tl-zone-background</Mono>, <Mono>tl-border</Mono>, <Mono>tl-border-colour</Mono>,{' '}
        <Mono>tl-button-border</Mono>, <Mono>tl-button-border-colour</Mono>, <Mono>tl-button-border-hint</Mono>),{' '}
        <Mono>tl-label-options</Mono> (<Mono>tl-label-text</Mono> through <Mono>WordsArea</Mono>, which keeps the
        words as typed while focused; <Mono>tl-label-font</Mono>, <Mono>tl-label-bold</Mono>,{' '}
        <Mono>tl-label-colour</Mono>, <Mono>tl-label-align</Mono>, <Mono>tl-label-valign</Mono>,{' '}
        <Mono>tl-label-preview</Mono>), a category&apos;s <Mono>tl-category-button-colour</Mono>,{' '}
        <Mono>tl-category-button-text</Mono>, <Mono>tl-category-show-name</Mono> and{' '}
        <Mono>tl-category-name-options</Mono>, and Behind the zones (<Mono>tl-background</Mono>) with the
        layout&apos;s own settings, drawn by the canvas on <Mono>tl-behind</Mono>. Colours are picked with <Mono>ColourPick</Mono>{' '}
        (<Mono>components/pos/shared.jsx</Mono>: 48 px swatches, <Mono>noneLabel</Mono>, an own colour as{' '}
        <Mono>&lt;testid&gt;-own</Mono>).
      </P>
      <P>
        <strong>Duplicate</strong> (<Mono>tl-duplicate</Mono>; <Mono>tl-duplicate-full</Mono> says why when the
        layout can&apos;t take another) is <Mono>copyZone(layout, id)</Mono> → <Mono>&#123; layout, id &#125;</Mono>, or
        null for a kind a layout has one of, at its type&apos;s most or at <Mono>MAX_ZONES</Mono>. The copy goes last
        with a fresh id (the id without its number, then 2, 3 ...) and every setting and button; a name gets (copy).
        A zone that floats goes a cell down and to the right when that fits, else where it is; any other goes in the
        first free space of its size, else a smaller one (<Mono>freeSpace()</Mono>, row by row), else on the zone it
        copies (an <Mono>overlap</Mono> problem until it is moved). A Dishes zone&apos;s copy follows a Categories
        zone nothing follows yet (else the same one); a Dish choices zone&apos;s copy takes the other kind, and a
        source showing all the choices becomes Must pick, so the two split them.
      </P>
      <P>
        <strong>The dish being added</strong> (14 Nov 2026). While a till layout&apos;s Dish choices zones are
        building a dish, <Mono>useChoiceBuilder()</Mono> (<Mono>LayoutChoices.jsx</Mono>) also returns{' '}
        <Mono>draftOf(it, cells, &#123; qty, count, ok, total &#125;)</Mono>: the dish&apos;s groups (or a meal deal&apos;s
        steps) with their picks so far and how many a must-pick one still needs (<Mono>missing</Mono>;{' '}
        <Mono>open</Mono> for a step behind a button nobody has opened). <Mono>LayoutScreen</Mono> provides{' '}
        <Mono>&#123; draft, focus(key) &#125;</Mono> through <Mono>DraftContext</Mono> (<Mono>DraftLine.jsx</Mono>,{' '}
        <Mono>useDraft()</Mono>); <Mono>CheckPanel</Mono> draws it with <Mono>DraftRow</Mono> at the end of the order
        (under the line being changed, which is dimmed, for Change options) and the counter&apos;s panel before an
        order starts with <Mono>PendingDraft</Mono>: <Mono>line-draft</Mono> (<Mono>data-ok</Mono>,{' '}
        <Mono>data-edit</Mono>), <Mono>draft-qty</Mono>, <Mono>draft-name</Mono>, <Mono>draft-picks</Mono>, a{' '}
        <Mono>draft-missing</Mono> button per choice still to pick (<Mono>missingText()</Mono>: Size to be picked;
        Sauces: 2 more to be picked), <Mono>draft-state</Mono> and <Mono>draft-price</Mono> (the total once it is
        ready). <Mono>focus(key)</Mono> turns the choices zone (<Mono>ZoneGrid</Mono>) to the page, scroll place or
        More sheet holding that choice and lights it for a moment (<Mono>data-lit</Mono>). Nothing goes on the check
        until Add (or Update); the draft is device state and never sent. Not drawn when the Order zone is a pop-up, or
        on the standard screen (the choices window shows the dish itself).
      </P>
      <P>
        Pop-ups (type <Mono>popup</Mono>, up to 8 per layout, 1 Nov 2026; <Mono>MAX_ZONES</Mono> went to 24 so every
        zone type at its most fits, and to 32 with the category&apos;s dishes zone) are zones with buttons like a Buttons zone (the same <Mono>buttons</Mono>, grid and
        words settings; <Mono>GRID_DEFAULTS.popup</Mono> 3 x 2 in pages), plus <Mono>title</Mono> (default Pop-up),{' '}
        <Mono>frame</Mono> (border and shadow, default true), <Mono>controls</Mono> (a bar with the title and an X,
        default true), <Mono>close_outside</Mono> (default true) and <Mono>close_on_tap</Mono> (default false). They
        float with Dish choices (<Mono>floats(zone)</Mono>, which replaced the <Mono>FLOATING_ZONES</Mono> list on
        12 Nov 2026, when any zone could be shown as a pop-up): they may sit over any zone and never count as an{' '}
        <Mono>overlap</Mono>, against <Mono>choices_space</Mono> or in the designer&apos;s drag clash. Button actions{' '}
        <Mono>open_popup</Mono> (with <Mono>popup_id</Mono>; no order needed) and <Mono>close_popup</Mono> (kept only
        in pop-ups by <Mono>normaliseZone()</Mono>). <Mono>normaliseTillLayout()</Mono> drops an opener whose pop-up
        the layout doesn&apos;t have, or that sits in the pop-up it opens, so taking a pop-up out takes its openers
        (the designer&apos;s Take out relies on that). <Mono>popupCloseProblem(zone)</Mono> is null when{' '}
        <Mono>controls</Mono> or <Mono>close_outside</Mono> is on, <Mono>close_on_tap</Mono> with at least one button,
        or a <Mono>close_popup</Mono> button is there; otherwise <Mono>layoutProblems()</Mono> gives{' '}
        <Mono>popup_stuck</Mono> and the save is refused (422 code <Mono>layout</Mono>). Warnings:{' '}
        <Mono>empty_popup</Mono>, <Mono>popup_unopened</Mono> (no opener that can be tapped: see Phone layouts
        below); a pop-up&apos;s
        dish buttons count against <Mono>no_dishes</Mono> and its buttons against <Mono>hidden_button</Mono>.{' '}
        <Mono>buttonLabel(b, &#123; popups &#125;)</Mono> names an opener after its pop-up and a close button Close.{' '}
        <Mono>ownLayout()</Mono> and <Mono>layoutIds()</Mono> treat a pop-up&apos;s dishes, discounts and charges as
        a Buttons zone&apos;s.
      </P>
      <P>
        On the till, <Mono>LayoutScreen.jsx</Mono> keeps the open pop-up per layout in{' '}
        <Mono>useRemembered(layoutId + &apos;:popup&apos;)</Mono>, like the open category, so it stays open as the
        counter&apos;s first dish opens the order (the counter view gives way to the check view); an effect forgets a
        pop-up taken out of the layout, or it would open by itself if it came back. <Mono>press(b, from)</Mono>{' '}
        opens and closes pop-ups itself and closes a <Mono>close_on_tap</Mono> pop-up before passing any other
        button to <Mono>onButton</Mono> (dishes through <Mono>dishFrom()</Mono>), so the rest still go to{' '}
        <Mono>runButton()</Mono>. <Mono>Popup</Mono> draws a cover over the layout (<Mono>popup-cover</Mono>, z 24: a
        tap on it closes the pop-up only with <Mono>close_outside</Mono>, and never reaches the zone under it) and the
        pop-up over its cells (<Mono>popup</Mono>, a dialog, z 25) with <Mono>ButtonsZone</Mono> inside
        (<Mono>popup-buttons</Mono>). It isn&apos;t drawn while a dish&apos;s choices show (<Mono>!choosing</Mono>)
        and comes back after them. In the designer, Add a zone puts a pop-up over the middle half of the screen named
        Pop-up N; <Mono>PopupOptions</Mono> (<Mono>tl-popup-*</Mono>: name, Looks, Closes with the stuck note, Opened
        by with Add a button that opens it) and the preview (<Mono>tl-popup-preview</Mono>) follow it, and Add a
        button offers Close the pop-up only in pop-ups.
      </P>
      <P>
        API (<Mono>routes/tillLayouts.js</Mono>; Store tech view to read, manage to change): <Mono>GET</Mono> and{' '}
        <Mono>POST /api/pos/till-layouts</Mono> (a new one from <Mono>template</Mono> standard | quick | phone |
        phone_table | phone_categories, the keys of <Mono>LAYOUT_TEMPLATES</Mono>, or{' '}
        <Mono>copy_from</Mono>; 30 per company; the list rows and the setup&apos;s <Mono>till_layouts</Mono> carry{' '}
        <Mono>phone</Mono>), <Mono>GET</Mono>, <Mono>PUT</Mono> and{' '}
        <Mono>DELETE /api/pos/till-layouts/:id</Mono>. <Mono>PUT</Mono> stores <Mono>ownTillLayout()</Mono>&apos;s output
        (sections, dishes, discounts and menus that aren&apos;t the company&apos;s dropped) and answers 422 with code{' '}
        <Mono>layout</Mono> and the problems. <Mono>DELETE</Mono> takes the layout off every till that picked it and
        the foreign key puts <Mono>pos_settings.till_layout_id</Mono> back to null. Every change broadcasts{' '}
        <Mono>pos.config</Mono> to each venue of the company. Which layout a till draws:{' '}
        <Mono>pos_settings.till_layout_id</Mono> (venue settings PATCH, null = the standard screen) and a till&apos;s{' '}
        <Mono>settings.till_layout</Mono> (<Mono>venue</Mono> | <Mono>standard</Mono> | a layout id; device PATCH,
        checked to be the company&apos;s). <Mono>tillConfig()</Mono> carries the layouts in use at the venue
        (<Mono>till_layouts</Mono> by id, <Mono>venueTillLayouts()</Mono>), so a till draws its layout offline too.
      </P>
      <P>
        Till: <Mono>tillLayoutOf(config, &#123; narrow, sideways, counter &#125;)</Mono> (<Mono>pos/src/lib/tillLayout.js</Mono>;
        the screens call <Mono>useTillLayout(config)</Mono>, which follows the screen&apos;s size) picks the till&apos;s own,
        else the venue&apos;s, else none; a layout missing from the config or without an Order zone means the standard
        screen (on a phone-sized screen see Phone layouts below). <Mono>screens/Check.jsx</Mono> and <Mono>screens/Counter.jsx</Mono> then draw{' '}
        <Mono>components/LayoutScreen.jsx</Mono> instead of the check panel and <Mono>MenuPanel</Mono>, giving it the
        Order zone&apos;s content (the check panel, or the counter&apos;s New order and waiting orders), dishes to their
        usual <Mono>pick()</Mono> and every other button to <Mono>runButton()</Mono>: the same windows and{' '}
        <Mono>PayModal</Mono>, with <Mono>autoExact</Mono> for Exact cash and Exact card and{' '}
        <Mono>initialTender</Mono> for Pay by. Last receipt prints <Mono>lastReceiptCheck()</Mono> (<Mono>prefs.last_closed</Mono>,
        set as <Mono>PayModal</Mono> closes a check, else the latest check this till closed today). A dish with choices
        goes into the Dish choices zones when the layout has one (<Mono>choiceZones()</Mono>;{' '}
        <Mono>components/LayoutChoices.jsx</Mono>: <Mono>useChoiceBuilder()</Mono> with the choices window&apos;s own
        picking rules, exported from <Mono>ItemModal.jsx</Mono>, and <Mono>priceItem()</Mono>), else into the window.
        With the must-pick zone&apos;s <Mono>auto_add</Mono>, <Mono>useChoiceBuilder(item, config, initial, &#123;
        onAutoAdd &#125;)</Mono> adds the dish on a tap that picks a choice taking exactly one pick
        (<Mono>min &gt;= 1</Mono>, <Mono>max === 1</Mono>, a group or a combo step) once <Mono>priceItem()</Mono> is
        happy with the whole selection; its picks are read through a ref (<Mono>commit()</Mono>), so the tap that
        completes the dish adds what is on screen. <Mono>ChoiceZone</Mono> drops the dish&apos;s name, description
        and the choices&apos; prices by the zone&apos;s switches (a sold out choice keeps its words). With the
        must-pick zone&apos;s <Mono>split_picks</Mono>, <Mono>useChoiceBuilder(..., &#123; split: true &#125;)</Mono>{' '}
        lets each of the dish&apos;s own groups that takes one pick (<Mono>splitsPicks()</Mono> in{' '}
        <Mono>shared/pos/pricing.js</Mono>: <Mono>max === 1</Mono>, no repeat, no No / Light / Extra; not nested
        groups or meal deal steps) take more, a tap each, and <Mono>splitPicks(choices, selection)</Mono> makes one
        selection per dish: groups picked more than once pair up in order and must all have the same number (else{' '}
        <Mono>&#123; ok: false, error &#125;</Mono>), the rest go on every dish. Each dish is priced on its own; the
        builder returns <Mono>ok</Mono>, <Mono>error</Mono>, <Mono>total</Mono> (every dish, the quantity each) and{' '}
        <Mono>count</Mono>, and <Mono>result().split</Mono> holds the selections. <Mono>addChosen(checkId, item, o)</Mono>{' '}
        (<Mono>lib/checkOps.js</Mono>, used by <Mono>Check.jsx</Mono> and <Mono>Counter.jsx</Mono> for every dish from
        the choices window or the zones) adds a line per selection through <Mono>addItem()</Mono>, which raises an
        identical new line&apos;s quantity instead (<Mono>sameLine()</Mono>, comparing modifiers and combo as data
        with <Mono>asData()</Mono>: a line the till has back from the server has its keys in jsonb&apos;s order). With the
        layout&apos;s <Mono>top_bar</Mono> false, <Mono>Main</Mono> in <Mono>App.jsx</Mono> leaves the bar off the
        check and counter views (<Mono>hideBar</Mono>), and <Mono>TillNav</Mono> (<Mono>components/TillMenu.jsx</Mono>:
        <Mono>go</Mono>, <Mono>view</Mono>, <Mono>counterMode</Mono>, <Mono>hideBar</Mono>, <Mono>openMenu</Mono>)
        carries the till menu down: <Mono>TillMenuSection</Mono> (details, <Mono>tillPages()</Mono>, Sign out) in
        More under the order&apos;s own actions (<Mono>ActionsMenu</Mono>: <Mono>actions-order</Mono> first, headed This
        order (<Mono>actions-order-label</Mono>) when the bar is off, then <Mono>actions-till</Mono>), <Mono>TillMenuModal</Mono> from the counter&apos;s Till menu button
        and the <Mono>till_menu</Mono> button. <Mono>Check.jsx</Mono> leaves the Order zone&apos;s hidden buttons out
        (the footer grid takes as many columns as buttons left), colours them with <Mono>fillStyle()</Mono>{' '}
        (<Mono>ui.jsx</Mono>, black or white words by <Mono>inkOn()</Mono>) and passes <Mono>font</Mono> to{' '}
        <Mono>CheckPanel</Mono>, whose line sizes are in em. No event changed: a layout only arranges the screen.
      </P>
      <P>
        Admin: <Mono>components/pos/TillLayoutsSection.jsx</Mono> (Store tech → Till layouts, <Mono>/pos/layouts</Mono>)
        and <Mono>pages/TillLayoutDesigner.jsx</Mono> (<Mono>/pos/layouts/:id</Mono>). The canvas draws each zone at the
        chosen screen&apos;s size (the till&apos;s 64 px top bar first), moves and resizes zones on whole cells (pointer
        events; a ghost committed on pointer up), previews each zone&apos;s buttons with the venue&apos;s menus,
        discounts and ways to pay (<Mono>usePosSetup()</Mono>, <Mono>/api/pos/discounts</Mono>), turns to the page of
        the button being edited, and draws the Dish choices zones and pop-ups as outlines (<Mono>data-outline</Mono>:
        pointer-events none, so taps reach the zone under them; their name tab <Mono>tl-zone-tab</Mono>, top right for
        Dish choices and bottom left for a pop-up, selects and drags them; an outline sits above even a selected zone,
        z 40, so its tab can always be reached; selected, or a Dish choices zone with <Mono>Show a dish being
        added</Mono>, they fill). The canvas fits the
        column&apos;s width and the window&apos;s height, and its scroller keeps <Mono>scrollbar-gutter: stable</Mono>:
        without it a scrollbar appearing narrowed the canvas, which shortened the page, which hid the scrollbar, round
        and round (the shake with some zones selected). The draft is normalised after every edit; Save sends <Mono>&#123; name, layout &#125;</Mono> and stays off while{' '}
        <Mono>layoutProblems()</Mono> finds any. The till window on Tills has the till&apos;s own choice
        (<Mono>till-layout</Mono>). Tests: <Mono>shared/pos/test/tillLayout.test.mjs</Mono>,{' '}
        <Mono>api/test/till-layouts.test.mjs</Mono>.
      </P>
      <P>
        Phone layouts (12 Nov 2026, no migration: layouts are jsonb and older ones normalise to their old look).
        Three additions to the shared rules. (1) Any of <Mono>POPUP_ZONES</Mono> (check, categories, menus, items,
        category, seats) takes <Mono>show</Mono> (<Mono>SHOWS</Mono>: always | popup). Shown as a pop-up it gets a
        pop-up&apos;s fields: <Mono>title</Mono> (null = <Mono>popupTitle(zone)</Mono>: Order, Categories, Menus,
        Dishes, Seat and course), <Mono>cover</Mono> (<Mono>COVERS</Mono>: zone | screen, the whole screen),{' '}
        <Mono>frame</Mono>, <Mono>controls</Mono>, <Mono>close_outside</Mono> and <Mono>close_on_tap</Mono> (always
        false on the Order zone; default true for categories and menus). <Mono>isPopup(zone)</Mono> is true for a
        Pop-up zone and for any zone shown as one; <Mono>floats(zone)</Mono> adds Dish choices. A Pop-up zone takes{' '}
        <Mono>cover</Mono> too. <Mono>open_popup</Mono> buttons name any such zone (<Mono>popupOpeners(layout,
        id)</Mono> lists them; <Mono>buttonLabel()</Mono> words one with <Mono>popupTitle()</Mono>), and{' '}
        <Mono>normaliseTillLayout()</Mono> drops the openers of a zone that went back to Always.{' '}
        <Mono>popupCloseProblem(zone)</Mono> judges every pop-up (a whole-screen one has no outside, so it needs its
        window controls, <Mono>close_on_tap</Mono> or a Close button): problem <Mono>popup_stuck</Mono>. An opener
        only counts when it can be tapped. <Mono>leftOutButtons(zone)</Mono> gives the buttons a zone with overflow{' '}
        <Mono>hide</Mono> never shows (from the first that doesn&apos;t fit on, as <Mono>packCells()</Mono> places
        them); <Mono>reachablePopups(layout)</Mono> the pop-ups a person can get to (opened by a button that shows,
        in a Buttons zone or in a pop-up they can get to; worked out to a fixed point, so two pop-ups that only open
        each other are never reached); <Mono>popupOpeners()</Mono> marks each opener <Mono>left_out</Mono>,{' '}
        <Mono>shut</Mono> (its zone is a pop-up nothing gets to) and <Mono>works</Mono>.{' '}
        <Mono>unopenedWhy(layout, id)</Mono> is null when one works, else <Mono>why</Mono> none | left_out | shut with
        the zone to change (a button that doesn&apos;t fit first: making room is all it takes). An Order zone shown
        as a pop-up that no button can open is the problem <Mono>order_unopened</Mono> (the order would be out of
        reach; worded per reason, <Mono>zones</Mono> = the zone to change then the order, so tapping the problem
        in the designer opens the zone to change); any other pop-up gets the warning{' '}
        <Mono>popup_unopened</Mono> the same way. (2) Every one of{' '}
        <Mono>GRID_ZONES</Mono> takes <Mono>view</Mono> (<Mono>VIEWS</Mono>: grid | list). A list is one column
        (<Mono>normaliseZone()</Mono> sets <Mono>cols</Mono> 1; <Mono>rows</Mono> = the rows showing), and{' '}
        <Mono>buttonTextStyle(zone)</Mono> returns a row for it (words left, the second line right);{' '}
        <Mono>isList(zone)</Mono>. (3) The layout takes <Mono>phone</Mono> (made for a phone), and{' '}
        <Mono>LAYOUT_TEMPLATES</Mono> gained <Mono>phone</Mono>, <Mono>phone_table</Mono> and{' '}
        <Mono>phone_categories</Mono> (<Mono>phoneTemplate()</Mono>: 6 x 12 cells, no top bar, the dishes as a list,
        a 4 x 2 bar of buttons whose order opener is 2 x 2, the order a whole-screen pop-up).
      </P>
      <P>
        On the till, <Mono>useTillLayout(config)</Mono> follows two media queries: narrow
        (<Mono>max-width: PHONE_MAX_WIDTH</Mono> 639 px) and sideways (wider than that and{' '}
        <Mono>max-height: SIDEWAYS_MAX_HEIGHT</Mono> 499 px). Narrow, <Mono>tillLayoutOf()</Mono> gives the picked
        layout only when it is <Mono>phone</Mono>, else <Mono>phoneStandIn(counter)</Mono>: the phone or phone_table
        template with id <Mono>builtin-phone</Mono> / <Mono>builtin-phone_table</Mono> (never stored, so nothing
        needs setting up). Sideways, a picked phone layout gives null (the standard screen); anything else is as on
        a tablet. <Mono>LayoutScreen.jsx</Mono> draws the zones that don&apos;t float in its grid and the open
        pop-up through <Mono>Popup</Mono> for every kind of zone (<Mono>zoneBody(zone)</Mono> is the one switch):
        over its cells, or <Mono>absolute inset-0</Mono> when <Mono>cover</Mono> is screen (<Mono>data-cover</Mono>,
        no frame, <Mono>popup-cover</Mono> <Mono>data-closes=&quot;0&quot;</Mono>). <Mono>used(zone)</Mono> closes
        a <Mono>close_on_tap</Mono> pop-up after a category, menu, dish, seat or course is picked. The Order pop-up
        remembers which order it showed (<Mono>:orderFor</Mono>) and closes when that order leaves the screen (paid,
        cancelled, Back); opened with no order (the counter&apos;s waiting list) it stays for the order picked there.
        An opener&apos;s note (<Mono>button-note</Mono>) comes from <Mono>noteOf(zone)</Mono>: the order&apos;s{' '}
        <Mono>checkTotals()</Mono> items and total, else the host&apos;s <Mono>noOrderNote</Mono> (Counter.jsx:
        N waiting / No order yet); the open category; the seat and course picked. A seats pop-up with nothing to pick
        (<Mono>seatCourseParts()</Mono> none) greys its opener (<Mono>idle</Mono>). <Mono>useRemembered(key)</Mono>{' '}
        follows its key, so a layout change while the till runs gives each layout its own open category and pop-up.{' '}
        <Mono>ZoneGrid.jsx</Mono> keeps a scrolling list&apos;s rows at <Mono>LIST_MIN</Mono> 48 px or more
        (<Mono>data-view</Mono>); <Mono>DishButton list</Mono>, <Mono>SectionButton</Mono>, <Mono>MenuButton</Mono>,{' '}
        <Mono>LayoutButton</Mono> and the Dish choices cells draw rows; <Mono>SeatCourseBar wrap</Mono> wraps its
        chips in a pop-up. The till&apos;s own screens follow <Mono>useNarrow()</Mono>: <Mono>Floor.jsx</Mono> (two
        tabs, <Mono>floor-tab-tables</Mono> / <Mono>floor-tab-list</Mono>, the tables as tiles instead of the plan),{' '}
        <Mono>Closed.jsx</Mono> (the list, then <Mono>closed-detail</Mono> with <Mono>closed-back</Mono>), the top
        bar&apos;s icons only below <Mono>sm</Mono>.
      </P>
      <P>
        In the designer (<Mono>TillLayoutDesigner.jsx</Mono>): Made for (<Mono>tl-made-for</Mono>: Tablet or screen /
        Phone, which switches the preview screens to <Mono>SCREENS</Mono>&apos; phones through{' '}
        <Mono>screensFor()</Mono>), On the screen (<Mono>tl-show</Mono>: Always / As a pop-up; a phone layout&apos;s
        Order zone starts over the whole screen), <Mono>PopupOptions</Mono> for any pop-up (name, Covers{' '}
        <Mono>tl-popup-cover</Mono>, Looks, Closes with each zone&apos;s own After-use words, Opened by; the Order
        zone&apos;s missing opener in red; an opener row <Mono>tl-popup-opener</Mono> carries{' '}
        <Mono>data-left-out</Mono> / <Mono>data-shut</Mono> / <Mono>data-works</Mono> with a red &quot;doesn&apos;t
        fit&quot; or &quot;can&apos;t be reached&quot; tag, and <Mono>openersNote()</Mono> words the note under the
        list, <Mono>tl-popup-opener-out</Mono> with <Mono>data-why</Mono> left_out | shut | some: red when nothing
        opens the pop-up, amber when another button still does), Laid out as (<Mono>tl-view</Mono>: Grid / List,
        with Rows showing{' '}
        <Mono>tl-zone-rows</Mono>), <Mono>tl-whole-screen-note</Mono>. Every pop-up is drawn as a dashed outline with
        a name tab at its bottom left (<Mono>tabOffset()</Mono> stacks tabs that share a corner), and{' '}
        <Mono>ZoneBodyPreview</Mono> draws what it holds. The pop-up&apos;s name and a button&apos;s words are typed
        into <Mono>WordsInput</Mono>, which keeps what is typed while focused: the draft is normalised (trimmed) on
        every change, which used to swallow a space typed at the end of a word. Store tech → Till layouts marks phone
        layouts (<Mono>layout-kind</Mono>, &quot;(phone)&quot; in the venue&apos;s and a till&apos;s pick) and says
        what a phone-sized till draws. Tests: the phone tests in <Mono>shared/pos/test/tillLayout.test.mjs</Mono>{' '}
        and <Mono>api/test/till-layouts.test.mjs</Mono>; the fixtures&apos; layout has a category zone shown as a
        whole-screen pop-up list, so the tenant sweep replays it.
      </P>
      <H3>Taps on a till layout (migration 266)</H3>
      <P>
        <Mono>pos_till_taps</Mono> (forced RLS) holds one count per device, person (<Mono>staff_id</Mono>, null when
        nobody is signed in), layout, zone, button (<Mono>cell</Mono>: a section, menu or dish id, the
        designer&apos;s button id, or <Mono>times</Mono>) and day, with the button&apos;s last words
        (<Mono>label</Mono>); the unique index is on <Mono>COALESCE(staff_id, nil uuid)</Mono>. The rules are{' '}
        <Mono>shared/pos/tillTaps.js</Mono>: <Mono>TAP_ZONES</Mono> (categories, menus, items, category, buttons,
        popup), <Mono>tapCell()</Mono> (the till keys categories <Mono>s:</Mono> and menus <Mono>m:</Mono>; the
        designer by id), the till&apos;s queue (<Mono>addTaps()</Mono>, <Mono>takeTaps()</Mono>),{' '}
        <Mono>cleanTaps()</Mono> (what the API keeps of an upload), <Mono>heatOf()</Mono>,{' '}
        <Mono>heatShare()</Mono>, <Mono>heatColour()</Mono>, <Mono>heatInk()</Mono> and{' '}
        <Mono>TAPS_KEEP_DAYS</Mono> (90). On the till <Mono>ZoneGrid</Mono> counts a click on a cell (capture,
        before the button&apos;s own handler, also in the More sheet) when given <Mono>layoutId</Mono>, through{' '}
        <Mono>countTap()</Mono> in <Mono>pos/src/lib/taps.js</Mono>: a queue in localStorage
        (<Mono>maca_till_taps</Mono>, at most 3,000 rows), sent every minute and when the page is hidden by{' '}
        <Mono>startTapUpload()</Mono> (started in <Mono>startSync()</Mono>, tills only, always to the cloud). Only
        saved layouts count (the built-in screen has no id). <Mono>POST /pos-api/till-taps</Mono> (tills only, 403
        otherwise) adds each row to its day&apos;s count, leaves out rows naming a person who isn&apos;t the
        venue&apos;s or a layout that isn&apos;t the tenant&apos;s and days past 90, and deletes the venue&apos;s rows
        past 90 days; a refused upload (4xx) is dropped by the till, an offline one kept. The hourly clean-up
        (<Mono>jobs/ai-cleanup.js</Mono>) runs <Mono>cleanUpTillTaps()</Mono> (<Mono>services/tillLayoutSvc.js</Mono>,
        system mode) for every venue, so a venue whose tills stop sending keeps nothing past 90 days either (the
        Privacy policy promises it). The designer&apos;s{' '}
        <Mono>GET /api/pos/till-layouts/:id/taps?days=&amp;venue_id=&amp;device_id=&amp;staff_id=</Mono> (Store tech
        view) returns <Mono>heatOf()</Mono>&apos;s zones, max and total, the 15 most tapped with their words, the
        tills, and the people only for those with Till reports view (a <Mono>staff_id</Mono> without it is 403).
        Reports: the <Mono>till.taps</Mono> subject (Till buttons tapped), Till activity&apos;s counts of each kind
        of change (<Mono>orders_opened</Mono>, <Mono>dishes_added</Mono>, <Mono>voids</Mono>,{' '}
        <Mono>no_sales</Mono> ...), the <Mono>kitchen.taps</Mono> subject (every kitchen screen event, by screen and
        station; trading day) and a Kitchen screen link on kitchen tickets and remakes (their event&apos;s device),
        with the starters Till activity by person, by till, Till buttons tapped and Kitchen screens: taps by
        screen. Tests: <Mono>shared/pos/test/tillTaps.test.mjs</Mono>, <Mono>api/test/till-taps.test.mjs</Mono>.
      </P>
      <H3>Sending to the kitchen</H3>
      <P>
        <Mono>sendCheck(check, heldCourseIds)</Mono> (<Mono>lib/checkOps.js</Mono>) sends every new line as one{' '}
        <Mono>lines.sent</Mono> (<Mono>&#123; send_id, line_ids, held_course_ids &#125;</Mono>). When{' '}
        <Mono>needsSendChoice()</Mono> (more than one course among the new lines, one held by default, or held courses
        already on the check) <Mono>SendModal</Mono> (<Mono>components/CheckActions.jsx</Mono>) asks first: a 64 px
        button per course (<Mono>send-course</Mono>, <Mono>data-held</Mono>, <Mono>aria-pressed</Mono> = cooks now),
        green outline and background with Cook now for a course that cooks now, a plain row with a purple Wait (hold)
        label (<Mono>send-wait</Mono>) for one that waits, a tap switching it; the courses held by default start
        held (<Mono>defaultHeld()</Mono>).
      </P>
      <H3>The order&apos;s allergy flag</H3>
      <P>
        <Mono>shared/pos/allergy.js</Mono> holds the rules: a check&apos;s <Mono>allergy</Mono> is{' '}
        <Mono>&#123; allergens: [&#123; code, name &#125;], diets: [&#123; code, name &#125;], note &#125;</Mono> or null,
        the codes being <Mono>menu_dietary_tags</Mono> codes and the names as the till showed them, so the kitchen,
        tickets and reports read it without the tag list (up to <Mono>ALLERGY_TAGS_MAX</Mono> 30 tags of each kind, a
        note of <Mono>ALLERGY_NOTE_MAX</Mono> 300). <Mono>allergyProblem()</Mono> checks an event&apos;s payload,{' '}
        <Mono>cleanAllergy()</Mono> tidies it (codes once each, words trimmed, null when it says nothing),{' '}
        <Mono>allergyText()</Mono> is the one line the kitchen shows (allergens, then diets, then the note, joined by
        a middle dot), <Mono>allergyPrefs()</Mono> gives the kiosk&apos;s <Mono>&#123; avoid, diet &#125;</Mono> shape
        and <Mono>mergeAllergy()</Mono> joins two flags.
      </P>
      <P>
        Event <Mono>check.allergy_set</Mono> (<Mono>&#123; allergy &#125;</Mono>, null takes it off; open checks only)
        in <Mono>shared/pos/checks.js</Mono> stores <Mono>cleanAllergy(p.allergy)</Mono> on the check (in{' '}
        <Mono>pos_checks.state</Mono>, no column). <Mono>lines.moved</Mono> and <Mono>check.merged</Mono> merge the
        flag into the check that gets the dishes. The kitchen: <Mono>check.allergy_set</Mono> is in{' '}
        <Mono>KITCHEN_CHECK_EVENTS</Mono>; <Mono>headerFromCheck()</Mono> puts <Mono>allergyText()</Mono> in the kitchen
        order&apos;s <Mono>allergy</Mono> (the field online orders&apos; allergy note already used), and{' '}
        <Mono>refreshHeader()</Mono> follows changes, so kitchen screens show it in red at the top of the ticket
        (<Mono>kds-allergy</Mono>). Printing (<Mono>shared/pos/kitchenPrint.js</Mono>): a kitchen ticket carries it as
        an <Mono>ALLERGY</Mono> line above the dishes (<Mono>kitchenTicket()</Mono>, inside the required items part so
        no print design can leave it out), each printer box remembers what it printed in{' '}
        <Mono>o.allergy_printed[stationId]</Mono>, and a later change prints a job of kind <Mono>allergy</Mono> (ALLERGY
        UPDATE, the flag or ALLERGY FLAG TAKEN OFF) to the printers that already printed the order.
      </P>
      <P>
        Till: <Mono>pos/src/components/AllergyModal.jsx</Mono> (chips from <Mono>config.dietary_tags</Mono>: allergens
        and the other kinds as diets; a tag the flag holds that the menu no longer lists stays; a note; the dishes that
        clash as you pick; Take the flag off asks first), opened from More (<Mono>action-allergy</Mono> in{' '}
        <Mono>ActionsMenu</Mono>), the bar on the check (<Mono>check-allergy</Mono>, <Mono>onAllergy</Mono> on{' '}
        <Mono>CheckPanel</Mono>) and the till layout button action <Mono>allergy</Mono> (<Mono>check: true</Mono>,{' '}
        <Mono>runButton()</Mono> in <Mono>Check.jsx</Mono>). <Mono>pos/src/lib/allergyFit.js</Mono>:{' '}
        <Mono>lineClash(config, line, allergy)</Mono> reads a line&apos;s dish and its meal deal parts with the
        kiosk&apos;s <Mono>dishLevels()</Mono> / <Mono>mergeLevels()</Mono> (<Mono>shared/kiosk.js</Mono>): an allergen at
        contains or may contain clashes, removable is &quot;can be left out: ask&quot;, a diet is missing unless the dish
        (or the deal itself) has it or every dish in the deal does; a line not on the menu gives nothing.{' '}
        <Mono>clashWords()</Mono> words it for <Mono>line-clash</Mono> under the line. Till reports names the event in a
        check&apos;s history (<Mono>PosReports.jsx</Mono>). Tests: <Mono>shared/pos/test/allergy.test.mjs</Mono>,{' '}
        <Mono>api/test/till-allergy.test.mjs</Mono>.
      </P>
      <H3>Device kinds and app updates</H3>
      <P>
        One app at <Mono>pos.&lt;domain&gt;</Mono> serves tills, kitchen screens and kiosks;{' '}
        <Mono>boot()</Mono> in <Mono>pos/src/lib/store.js</Mono> picks by the saved device's kind
        (<Mono>openOtherApp()</Mono>: <Mono>kds</Mono> the kitchen app, <Mono>kiosk</Mono> the kiosk app, any
        other kind but <Mono>terminal</Mono> the "Getting the latest app" screen, never the till). The server
        has the last word: every <Mono>/pos-api/config</Mono> reply carries <Mono>device.kind</Mono>, and when it
        (or a cached config's) differs from the saved kind, <Mono>relabel()</Mono> saves the right kind, drops the
        till's cached config and opens that app. A copy of the app from before kiosks (17 Oct 2026) ran a newly
        paired kiosk as a till: its PIN screen failed with "Cannot read properties of undefined (reading
        'find')" because a kiosk's config has no staff (<Mono>staffForPin()</Mono> now reads{' '}
        <Mono>cfg.staff || []</Mono>).
      </P>
      <P>
        The service worker (<Mono>vite-plugin-pwa</Mono>, <Mono>pos/vite.config.js</Mono>, autoUpdate +
        skipWaiting) keeps the app on the device, so a device runs the copy it started with until the page
        loads again. <Mono>pos/src/lib/appUpdate.js</Mono> registers <Mono>/sw.js</Mono> itself (the plugin's{' '}
        <Mono>injectRegister</Mono> is off), asks for a new copy every 30 minutes and when the page becomes
        visible, and after a <Mono>controllerchange</Mono> (not the first one on a device) reloads when the
        screen on show says it's safe: <Mono>whenSafeToReload(fn)</Mono>, last registered wins. The till: pair,
        update, or nobody signed in and 10 s without a touch (<Mono>idleFor()</Mono>); the kiosk: start screen,
        empty basket, no dish open, 10 s; a kitchen screen: 30 s without a touch. Unsent events stay in
        IndexedDB. Kiosk design previews and the kitchen test bench never register or reload
        (<Mono>pos/src/main.jsx</Mono>).
      </P>
      <H3>Prices, VAT and offers</H3>
      <P>
        <Mono>shared/pos/pricing.js</Mono>: <Mono>priceItem()</Mono> (unit price + modifiers: prefixes No /
        Light free, Extra / On the side priced, nested groups always extra; combos through shared/combos.js),{' '}
        <Mono>posTax(item, check, config)</Mono> (the dish's tax levels resolved by{' '}
        <Mono>taxFor()</Mono> in <Mono>shared/tax.js</Mono> for the venue, the check's order type and
        revenue stream: <Mono>{'{ vat_rate, tax_rate_id }'}</Mono>, stored on each line) and <Mono>checkTotals()</Mono> (line discounts and comps, then promotions, then check
        discounts, then the check&apos;s charges, each at its own VAT rate; VAT inclusive per line rate). Promotions with channel{' '}
        <Mono>pos</Mono> are worked out by the till with <Mono>applyPromotions()</Mono> from{' '}
        <Mono>shared/promotions.js</Mono> and stored as a <Mono>promotions.set</Mono> event, so the server
        and reports never recompute them.
      </P>
      <H3>Printing</H3>
      <P>
        Migration 191. Two sources of print jobs, both stored by the sequencer in{' '}
        <Mono>pos_print_jobs</Mono> (with <Mono>station_id</Mono> and <Mono>kitchen_order_id</Mono> for kitchen
        tickets): <Mono>jobsForEvent()</Mono> in <Mono>shared/pos/printing.js</Mono> makes the till&apos;s own (bills,
        receipts, drawer kicks) for the device&apos;s receipt printer; <Mono>kitchenPrintJobs()</Mono> in{' '}
        <Mono>shared/pos/kitchenPrint.js</Mono> makes kitchen tickets from the kitchen orders after every kitchen
        change: a station of kind <Mono>printer</Mono> (<Mono>settings.printer_id</Mono>) prints each dish once when
        the dish reaches it (<Mono>flowTimes().arrived()</Mono>; straight from Orders in that is when it fires),
        grouped per order, printer and kind (<Mono>kitchen</Mono> | <Mono>fire</Mono> | <Mono>void</Mono>) by course,
        with the venue&apos;s kitchen design (<Mono>cfg.ticket_layout</Mono>). A printer straight after Orders in also
        lists held courses under HOLD (<Mono>item.hold_printed</Mono>), then prints FIRE; a voided dish that printed
        prints VOID (<Mono>item.void_printed</Mono>); <Mono>item.printed</Mono> stops a second print. Printer boxes
        never bump (<Mono>noBump()</Mono>): dishes reaching only printers are done there. Orders for later:
        the minute sweep (<Mono>kitchenPrintsDue()</Mono> in <Mono>services/kitchenSvc.js</Mono>, from the hold sweep)
        asks <Mono>printsDue()</Mono> and sends <Mono>kitchen.print_due</Mono>, a server event the sequencer
        answers by printing from <Mono>loadOpenKitchenOrders()</Mono> (nothing due: no event stored).
      </P>
      <P>
        Who prints: <Mono>pos_printers.connection</Mono> <Mono>hub</Mono> (a network printer) is collected by the
        venue hub (<Mono>hub/</Mono>: <Mono>bin/hub.js</Mono>, <Mono>src/cloud.js</Mono>, <Mono>src/service.js</Mono>; a
        device of kind <Mono>hub</Mono> linked by the code it shows, <Mono>POST /pos-api/pairings</Mono> with{' '}
        <Mono>app: 'hub'</Mono>; its routes are only <Mono>/config</Mono> (<Mono>hubConfig()</Mono>: its printers),
        claim, status, <Mono>POST /pos-api/hub/status</Mono> (each printer&apos;s state, shown in Store tech) and
        disconnect); <Mono>device</Mono> (<Mono>device_id</Mono>) by that till or kitchen screen
        (<Mono>pos/src/lib/devicePrint.js</Mono>: on <Mono>pos.print</Mono> and every 20 s, prints through the
        browser). <Mono>POST /pos-api/print-jobs/claim</Mono> hands each device only its own printers&apos; jobs and takes
        back a job collected over two minutes ago and never reported (<Mono>claimed_at</Mono>); only the collector
        reports on it (a till may mark a waiting one printed by hand). A device prints its own bills and receipts in its
        browser when its receipt printer is none or plugged into it (<Mono>receiptHere()</Mono> /{' '}
        <Mono>printsHere()</Mono>: no job is queued then). A kiosk&apos;s printer prints its own receipts only (refused as a
        printer box). Failed jobs: <Mono>POST /api/pos/print-jobs/:id/again</Mono>. Browser printing: a hidden iframe
        (<Mono>pos/src/lib/print.js</Mono>, HTML from <Mono>opsHtml()</Mono> in <Mono>shared/pos/ticketHtml.js</Mono>);
        the hub turns the same operations into printer bytes (<Mono>render()</Mono> in <Mono>hub/src/escpos.js</Mono>) and
        tries the printer&apos;s backup when it doesn&apos;t answer. Migration 254: <Mono>pos_printers.language</Mono>{' '}
        <Mono>escpos</Mono> (the default) or <Mono>star</Mono> (Star Line Mode: <Mono>ESC GS t 32</Mono> for code page
        1252, <Mono>ESC E</Mono> / <Mono>ESC F</Mono> bold, <Mono>ESC i</Mono> size, <Mono>ESC 4</Mono> /{' '}
        <Mono>ESC 5</Mono> highlight, alignment by spaces, <Mono>ESC d 3</Mono> cut, <Mono>BEL</Mono> drawer; no GS
        command, which Star prints as text). It goes to the hub in <Mono>hubConfig()</Mono>; the hub never asks a Star
        printer Epson&apos;s DLE EOT status question (a connection check only).
      </P>
      <H3>The venue hub on a mini PC</H3>
      <P>
        Migration 195. The hub (<Mono>hub/</Mono>, Node 22, no packages) installs on a Linux or Windows mini PC from one
        command, prints to network printers and to USB printers plugged into it, serves a status page on the venue&apos;s
        network and updates itself from the cloud.
      </P>
      <DataTable
        head={['Part', 'What it does']}
        rows={[
          ['Release', 'services/hubRelease.js: hubRelease() builds one tar.gz per API process from the files hub/bin/*.js load (importClosure() follows relative imports, so the shared ticket code comes along) plus hub/package.json, hub/README.md, shared/package.json and a release.json. Sorted names and fixed times: every process makes the same bytes. Version = hub/src/version.js VERSION + "+" + 8 hex of a hash of the files, so any change to the hub or the shared code it uses is a new version. Public routes (no auth): GET /pos-api/hub/release ({ version, sha256, size, url }), /pos-api/hub/release.tgz, /pos-api/hub/install.sh and install.ps1 (installScript(): __MACAROONIE_API__ replaced by the till address, or the request\'s own address on localhost).'],
          ['Install (Linux)', 'hub/install/install.sh: Node 22 from nodejs.org/dist/latest-v22.x checked against SHASUMS256.txt into /opt/macaroonie-hub/node; a system user macaroonie-hub in lp and dialout; the release checked against its sha256, unpacked to releases/<version>, --self-test; launcher.mjs and current.json; a systemd unit (Restart=always, ProtectSystem=full, ReadWritePaths the home); ufw opens 9180 when active; prints the code from state.json. On a computer already linked (hub.json), after the self test it runs the new hub.js link-info and asks on /dev/tty (piped from curl too): keep, switch (systemctl stop, hub.js unlink, then the usual install: a new code) or remove (unlink, then everything goes); --keep / --switch / --uninstall answer it, --force passes --force to unlink, no terminal = keep. A refused unlink (sales waiting, no cloud) chowns the home back and starts the service again. --uninstall leaves the venue with the installed hub.js when it has unlink, then removes it all. Environment overrides for tests (MACAROONIE_HUB_HOME, MACAROONIE_SYSTEMCTL, ...).'],
          ['Install (Windows)', 'hub/install/install.ps1 (irm ... | iex; everything inside Install-MacaroonieHub so errors return to the prompt): Node 22 zip checked by Get-FileHash into C:\\ProgramData\\Macaroonie\\Hub\\node, the release unpacked with tar.exe, then the Windows service MacaroonieHub (Install-HubService): the source of hub/install/HubService.cs travels in the installer ($global:MacaroonieHubServiceSource, a here-string the API fills in: installScript() replaces the __MACAROONIE_HUB_SERVICE_CS__ line), written to hub-service.cs and compiled with the .NET Framework 4 csc.exe Windows ships (C# 5 only) into hub-service.exe; service-args.txt holds the launcher\'s arguments one per line (--api, --http-port 9180, --lan-port 9181, --log-file hub.log); New-Service (or Win32_Service Change) automatic as LocalSystem, sc failure restart 5 s / 10 s / 30 s (reset after a day) and failureflag 1. hub-service.exe runs node\\node.exe launcher.mjs in a job object with KILL_ON_JOB_CLOSE: OnStop / OnShutdown terminate the job (launcher, hub and anything they started), the program dying closes the handle and does the same; a launcher that stops is started again after 5 s growing to 60 s; its log is service.log (1 MB, then service.log.1); hub-service.exe --console [--home DIR] runs the same loop in a terminal. Any failure (no compiler, the service won\'t start, Smart App Control) falls back to the scheduled task (Install-HubTask: at start-up as SYSTEM, restart on failure), as does MACAROONIE_HUB_RUN_AS=task; installing the service removes the task of older hubs. Set-HubPower (unless MACAROONIE_HUB_POWER=leave): powercfg standby and hibernate on AC 0, USB selective suspend off. Firewall rules for 9180 and 9181 (private and domain networks). Stop-Hub stops the service, the task, then every node.exe or hub-service.exe running from the hub\'s folder; Start-Hub starts whichever is installed. Already linked: the same link-info / keep / switch / remove choice as Linux (Read-Host when interactive; MACAROONIE_HUB_CHOICE keep | switch | remove, MACAROONIE_HUB_FORCE=1), LOSE typed to go ahead with sales waiting. MACAROONIE_HUB_UNINSTALL=1 leaves the venue, then removes the service, the task, the firewall rules and the folder. Sets $global:MacaroonieHubFailed and $global:MacaroonieHubRemoved for the setup file. Tested on windows-latest by .github/workflows/hub-windows.yml (hub/test/windows: standin.mjs, a stand-in cloud serving this checkout\'s installer and release; install-test.ps1: install, restarts, the program killed, stop, reinstall, task and back, moving a linked hub, uninstall), with Windows PowerShell 5.1 and PowerShell 7.'],
          ['Download to install', 'pos.<domain>/hub (posSite.js, till host only; the till app\'s service worker leaves /hub alone) redirects to GET /pos-api/hub/setup: hubSetupPage(), plain HTML with its own CSP (no scripts), the download for the user agent\'s system first. GET /pos-api/hub/setup.cmd (attachment macaroonie-hub-setup.cmd): hub/install/setup.cmd with \\r\\n line endings, plain ASCII. Not elevated (fltmc fails) it starts itself again with Start-Process -Verb RunAs (path and argument through environment variables, so a "(1)" or an apostrophe in the path is safe); elevated it downloads install.ps1 to %TEMP% with Invoke-WebRequest and runs it (no iex), exits 1 when $global:MacaroonieHubFailed (3 when removed), else opens http://localhost:9180/. "uninstall", "keep" or "switch" as its argument answers the question without asking. GET /pos-api/hub/setup.sh (attachment macaroonie-hub-setup.sh) is install.sh, which run from a file (*.sh) as a user other than root runs itself again with sudo. Store tech and the installer app\'s Add a hub show the address; Store tech also has both downloads and the commands under Or run a command. Unsigned: Windows SmartScreen and the browser ask before running it.'],
          ['Launcher', 'hub/bin/launcher.js, copied to <home>/launcher.mjs: runs the version in current.json, starts it again at once after exit 75 (an update), else after 2 s growing to 30 s; three stops within a minute of starting go back to current.previous and add the version to bad_versions (rolled_back_from). --log-file writes a log kept under 5 MB.'],
          ['Updates', 'hub/src/update.js createUpdater(): the hub\'s config (hubConfig()) carries release and update { auto: settings.auto_update !== false, requested: update_requested_at set }. At a quiet moment (a claim with no jobs, at most every 30 s) it downloads, checks the sha256 and release.json\'s version, unpacks with tar into releases/<v>.part, runs --self-test, renames, copies the launcher, writes current.json (keeping the version before) and exits 75. Not again for 30 minutes after a failure (5 when asked); a version in bad_versions only when asked. A copy run from the repository (no MACAROONIE_HUB_HOME) only reports updates: manual. POST /api/pos/devices/:id/update sets update_requested_at; a report with the latest version clears it.'],
          ['USB printers', 'hub/src/usb.js. Linux: /sys/class/usbmisc/lp*/device (ieee1284_id, and the USB device\'s idVendor, idProduct, serial or port) gives { id: usb:<vendor>:<product>:<serial | port-…>, name, escpos, path: /dev/usb/lpN }; printing writes the device file non-blocking (EAGAIN = wait), status asks DLE EOT and reads the answer back (no answer = unknown). Windows: Get-Printer (virtual printers left out), id win:<name>; a RAW job through winspool (OpenPrinter / StartDocPrinter RAW / WritePrinter) in an encoded PowerShell command, the name and a temp file in environment variables; status from PrinterStatus. Printers are found again by id at every print, never by device file. Prints and status questions to one printer are queued together.'],
          ['Printers in the cloud', 'A USB printer on the hub is pos_printers connection device, device_id = the hub, local_id = its id (checkPrinterDevice() needs local_id for a hub, clears it otherwise; host is null). hubConfig() sends network printers and the hub\'s own USB printers with interface network | usb; the claim already matches device printers by device_id. POST /pos-api/hub/status (HubReport) stores info (computer, addresses, status_port, local_printers, update) and info_at on pos_devices and updates state for its network printers and its own USB printers. Store tech → Venue hub (components/pos/HubSection.jsx, /pos/hub since migration 219) shows info, hub_release, Update now, Add it (the printer window from PrintersSection.jsx); the Printers page links to it (HubNote); the installer app lists hubs (KINDS.hub) with info.'],
          ['Status page', 'hub/src/statusPage.js on port 9180 (--http-port, 0 = none): GET / (refreshes every 5 s, CSP default-src none) and /status.json. Linking: the code and qrSvg() of the installer link; then cloud, version, update state, printers in words, USB printers found, the last 20 tickets as kind, printer, printed or the reason (never titles or contents). publicState() never includes a secret. The hub also writes state.json beside hub.json for hub.js status and the installers.'],
          ['Linking', 'bin/hub.js shows a code until linked (console, page, state.json); a 401 from the cloud (removed in Store tech) clears hub.json and the venue\'s files and shows a new code instead of stopping (a stop would make the launcher go back a version). hub.json keeps name, venue_name and tenant_name (from the pairing status, refreshed from GET /pos-api/me at start); the page and hub.js status name the restaurant group.'],
          ['Moving a hub', 'hub/src/link.js: one computer is one hub for one venue. linkInfo() (hub.js link-info [--api]): linked, same_api, the names, status linked | removed (401) | offline | other_api. unlink() (hub.js unlink [--force], one line of JSON, exit 2 when refused): starts the venue copy from venue.json / venue.log with the old link, runs one round (upload, follow), counts to_send plus lines left in venue.log; with any and no cloud (and no --force) refuses and changes nothing; else POST /pos-api/disconnect (Store tech shows Not linked; 401 = removed already) and forgetVenue() deletes hub.json, venue.json, venue.log, printers.json, state.json and their .tmp copies. A new link also starts by forgetting them. venue.log lines carry the hub id; replay skips another hub\'s lines (and unmarked ones unless venue.json is this hub\'s), so a computer linked elsewhere never decides the last venue\'s events. The launcher passes MACAROONIE_HUB_LAUNCHER_PID; hub.js exits when that process has gone (checked every 5 s).'],
        ]}
      />
      <H3>Print designs</H3>
      <P>
        Migration 190. A design is a layout <Mono>{'{ blocks: [{ id, type, opts }] }'}</Mono> of kind kitchen or
        receipt (<Mono>shared/pos/ticketLayout.js</Mono>: <Mono>BLOCK_TYPES</Mono> per kind with option
        defaults, <Mono>normaliseLayout()</Mono> (known types and options only, unique ids, the dishes and a
        receipt&apos;s totals added back: <Mono>REQUIRED_BLOCKS</Mono>), <Mono>defaultLayout()</Mono> (what
        tickets printed before designs), <Mono>normaliseVariation()</Mono> / <Mono>applyVariation()</Mono>,{' '}
        <Mono>SAMPLES</Mono> + <Mono>sampleTicket()</Mono> for the preview). <Mono>kitchenTicket(send,
        layout)</Mono> and <Mono>receipt(bill, layout)</Mono> in <Mono>tickets.js</Mono> draw from it (no layout
        = the built-in one; a title block uses <Mono>orderInfo()</Mono> and falls back to the usual title).{' '}
        <Mono>jobsForEvent()</Mono> passes <Mono>cfg.layouts.kitchen</Mono>; <Mono>billOps()</Mono> uses{' '}
        <Mono>cfg.layouts.receipt</Mono>, or <Mono>kiosk_receipt</Mono> for events from a kiosk device.
      </P>
      <DataTable
        head={['Table / route', 'What']}
        rows={[
          ['print_designs', 'tenant, kind kitchen | receipt, name, layout jsonb (normalised on save), created / updated by. Up to 50 per company.'],
          ['print_design_uses', 'tenant, venue_id (NULL = company), use kitchen | receipt | kiosk_receipt, design_id (ON DELETE CASCADE: deleting a design sends places back). Unique per company use and per venue use.'],
          ['print_design_variations', 'tenant, venue_id, design_id (PK venue + design), texts { blockId: { text | receipt_text | bill_text } }, hidden [blockId]. Words only for text / heading / footer parts; the dishes and totals can\'t be hidden. A design save drops words for parts no longer in it.'],
          ['printLayouts(tx, tenantId, venueId)', 'services/printDesignSvc.js: { kitchen, receipt, kiosk_receipt } for a venue: venue choice, else company; kiosk_receipt falls back to receipt; the venue\'s variation applied; null = built-in. In tillConfig() (print_layouts), the sequencer\'s printConfig() (layouts) and kioskConfig() (print_layouts.receipt = kiosk_receipt).'],
          ['GET /api/pos/print-designs?venue_id=', 'pos_setup view: designs, uses { company, venue }, used_at per design, defaults.'],
          ['POST /api/pos/print-designs', 'pos_setup manage: { kind, name, copy_from?, layout? } (copy only within a kind).'],
          ['GET / PUT / DELETE /api/pos/print-designs/:id', 'View: the design with variations per venue and used_at. Manage: { name, layout }; delete.'],
          ['PUT /api/pos/print-designs/:id/variations/:venueId', 'Manage: { texts, hidden }; empty deletes the row.'],
          ['PUT /api/pos/print-design-uses', 'Manage: { venue_id | null, use, design_id | null }; the design\'s kind must fit the use (422).'],
        ]}
      />
      <P>
        Every change broadcasts <Mono>pos.config</Mono> (a company change to every venue). Admin: Store tech →
        Printing (<Mono>components/pos/PrintingSection.jsx</Mono>: what prints where), Store tech → Receipt
        &amp; ticket designer (<Mono>/pos/print-designs</Mono>, <Mono>PrintDesignsSection</Mono> in the same
        file, since migration 241: the designs) and the designer{' '}
        <Mono>pages/PrintDesigner.jsx</Mono> (<Mono>/pos/print-designs/:id</Mono>): parts in a sortable list,
        options per part, <em>Only at</em> a venue for its variation, explicit Save, a column-exact preview from{' '}
        <Mono>previewHtml(ops, cols)</Mono> in <Mono>ticketHtml.js</Mono> (wrapping as <Mono>toText()</Mono>,
        double width and height by CSS transforms). The receipt and bill footers left Store tech&apos;s settings
        (<Mono>pos_settings.receipt_footer</Mono> / <Mono>bill_footer</Mono> dropped): the migration made a
        design named Receipt for tenants that had any, used company wide, with each venue&apos;s footers as its
        variation. New locations copy the template venue&apos;s uses and variations (<Mono>storeSetup.js</Mono>).
        Tests: <Mono>shared/pos/test/tickets.test.mjs</Mono>, <Mono>api/test/print-designs.test.mjs</Mono>.
      </P>
      <H3>Card machines</H3>
      <P>
        Migration 193. A card machine payment is started by the server, never by the device: the till or
        kiosk asks <Mono>POST /pos-api/card/payments</Mono>, the server writes a <Mono>pos_card_payments</Mono>{' '}
        row (pending) and asks the provider (<Mono>services/cardMachines/</Mono>: <Mono>dojo.js</Mono>,{' '}
        <Mono>stripe.js</Mono>, <Mono>sumup.js</Mono>, <Mono>test.js</Mono>; one interface in{' '}
        <Mono>index.js</Mono>, the HTTP call and errors in <Mono>http.js</Mono>) to show the amount on the
        machine; the device then polls <Mono>GET /pos-api/card/payments/:id</Mono>, which asks the provider at
        most every 1.2 s (<Mono>refreshPayment()</Mono> in <Mono>services/cardSvc.js</Mono>). Provider calls
        never run inside a database transaction. Statuses: pending, signature (Dojo asks staff to check a
        signature), approved, declined, cancelled, failed. A sale left pending is asked about by the minute
        sweep (<Mono>sweepPending()</Mono>) and given up after 15 minutes.
      </P>
      <P>
        A payment reaches a check only as <Mono>payment.added</Mono> with tender <Mono>card_integrated</Mono>{' '}
        and <Mono>card_payment_id</Mono> (the shape check requires one and refuses it on any other tender).
        The sequencer (<Mono>shared/pos/cards.js</Mono>: <Mono>cardNeed()</Mono>, <Mono>cardProblem()</Mono>)
        loads the attempt with the store&apos;s <Mono>loadCardPayment()</Mono> (FOR UPDATE) and refuses it unless
        it is an approved sale of this venue, for exactly the payment&apos;s amount and tip, for this check (or no
        check yet: a kiosk pays before its order exists), for this payment id, not used by another event; then{' '}
        <Mono>useCardPayment()</Mono> records the event. A refund (<Mono>refund.added</Mono> with{' '}
        <Mono>card_refund_id</Mono>) needs an approved refund of a card payment on the check, for its amount;
        taking a card machine payment off (<Mono>payment.voided</Mono>) needs <Mono>card_refund_id</Mono> for the
        whole amount and tip (<Mono>applyEvent()</Mono> refuses it without one: <Mono>card_refund</Mono>). A store
        without these methods (the hub) refuses card machine events.
      </P>
      <DataTable
        head={['Table / route', 'What']}
        rows={[
          ['pos_card_accounts', 'tenant, provider dojo | stripe | sumup, name, secret (sealed, services/vault.js SEALED), hint (last 4), mode test | live, settings { merchant_code, merchant_name (SumUp, learned from the key), software_house_id, reseller_id (Dojo, else env), locations (Stripe) }, checked_at, removed_at (key cleared, machines removed; payments keep pointing at it).'],
          ['pos_card_readers', 'tenant, venue, account_id (NULL only for provider test), provider, provider_reader_id (Dojo terminalId, Stripe tmr_, SumUp reader id), name, model, serial, removed_at. pos_devices.settings.card_reader = its id (or none) on a till or kiosk.'],
          ['pos_card_payments', 'tenant, venue, reader, account, provider, kind sale | refund (sale_id), device, staff, check_id, payment_id (the ULID the event will carry; unique per venue), amount, tip, status, message, provider_ref / provider_ref2 (payment intent + session / checkout / charge / transaction), card_brand, card_last4, refunded, used_event_id / used_at, checked_at, finished_at.'],
          ['POST /pos-api/card/payments', 'Till or kiosk: { check_id? (till: open, on the server, amount ≤ what is left, so the till sends its outbox first; 409 not_synced), payment_id, amount, tip (till only), staff_id }. One open payment per machine (409 busy with payment_id).'],
          ['GET /pos-api/card/payments[/:id]', '?check_id= lists a check\'s attempts (Pay picks up a pending one and offers approved ones not on the bill). /:id refreshes from the provider.'],
          ['POST /pos-api/card/payments/:id/cancel | /signature | /test', 'Cancel on the machine (the provider has the last word: a card tapped just before counts); answer a Dojo signature check; a test card (the test machine, or Stripe test mode\'s present_payment_method).'],
          ['POST /pos-api/card/refunds', 'Till only: { sale_id, check_id, refund_id, amount, staff_id, approved_by?, purpose refund | void }, role permission refund or void (or a manager). The sale must be approved, on this check, with enough left; the refund is approved or failed when it returns.'],
          ['/api/pos/card-accounts[...]', 'Store tech view to list; manage + owner/admin to add, change (a new key or settings is checked first), remove. POST /:id/check asks again; GET /:id/readers is the provider\'s list, each marked where it is added.'],
          ['/api/pos/venues/:venueId/card-readers', 'View: the venue\'s machines and which tills and kiosks use them. Manage: add from the list ({ account_id, provider_reader_id, name }), by code ({ account_id, code, name, location? }: SumUp Solo pairing, Stripe registration code), or { provider: \'test\', name }.'],
          ['PATCH / DELETE /api/pos/card-readers/:id', 'Rename; remove (devices using it go back to none).'],
          ['GET /api/pos/venues/:venueId/card-payments?days=&status=', 'Store tech or Till reports view: attempts with machine, device and staff names; not_on_check flags an approved sale no event used.'],
        ]}
      />
      <P>
        Providers. <strong>Stripe Terminal</strong> (server-driven, from the shapes in Stripe&apos;s own Node SDK
        23.0.0): a PaymentIntent (card_present, automatic capture, idempotency key per attempt), then{' '}
        <Mono>POST /v1/terminal/readers/:id/process_payment_intent</Mono> with <Mono>skip_tipping</Mono> (tips are
        taken on the till); the result is the intent&apos;s status, or the reader&apos;s action (failed with a
        failure message = declined); cancel = cancel_action + cancel the intent; refunds through{' '}
        <Mono>POST /v1/refunds</Mono>. A Stripe card account is either the tenant&apos;s own key, or (migration 215)
        the group&apos;s connected Stripe account: <Mono>settings.connect = true</Mono>, no secret stored,{' '}
        <Mono>cardAccount(tenantId, row)</Mono> in <Mono>cardSvc.js</Mono> builds the provider account with the
        platform&apos;s key and <Mono>connect</Mono> = the tenant&apos;s <Mono>stripe_account_id</Mono>, and{' '}
        <Mono>cardMachines/stripe.js</Mono> adds the <Mono>Stripe-Account</Mono> header to every call. Adding one
        needs the account linked with charges on (409 for a second); a key can&apos;t be put on it. No platform fee
        on card machine sales. <Mono>POST /api/pos/card-accounts/:id/locations {'{ venue_id }'}</Mono> makes a
        Terminal location from the venue&apos;s website address (<Mono>createLocation()</Mono>; 422 when the venue
        has no address line and postcode).{' '}
        <strong>SumUp</strong> (Cloud API, from SumUp&apos;s TypeScript SDK 0.2.0): merchant code from{' '}
        <Mono>GET /v0.1/memberships</Mono>, readers paired by the Solo&apos;s code, a reader checkout, its state from{' '}
        <Mono>GET .../readers/:id/checkout/:checkout_id</Mono> and the transaction by{' '}
        <Mono>client_transaction_id</Mono> (card, and the id refunds need); terminate to cancel; refunds{' '}
        <Mono>POST /v1.0/merchants/:code/payments/:txn/refunds</Mono> (a full refund sends no amount, a part one
        sends pounds). <strong>Dojo</strong>: payment intent + terminal session (sessionType Sale), the session&apos;s
        status, signature answers, cancel, refunds on the payment intent; built from Dojo&apos;s API as known
        (docs.dojo.tech and an SDK weren&apos;t reachable), replies read loosely: check against a Dojo sandbox
        first. Base URLs <Mono>STRIPE_API_URL</Mono>, <Mono>SUMUP_API_URL</Mono>, <Mono>DOJO_API_URL</Mono>{' '}
        (tests point them at <Mono>api/test/support/fake-card-providers.mjs</Mono>); Dojo&apos;s{' '}
        <Mono>DOJO_SOFTWARE_HOUSE_ID</Mono> / <Mono>DOJO_RESELLER_ID</Mono> are the platform&apos;s.
      </P>
      <P>
        Devices. The till&apos;s config carries <Mono>card_machine</Mono> ({'{ id, name, provider, test, can_simulate, signature }'}, part of
        its version) from <Mono>cardMachineOf()</Mono>; the kiosk&apos;s too (<Mono>kioskConfig()</Mono>; previews
        none, they keep the pretend reader). Till: <Mono>cardStart()</Mono> / <Mono>cardCheck()</Mono> /{' '}
        <Mono>cardRefund()</Mono> in <Mono>pos/src/lib/store.js</Mono> (sends the check&apos;s outbox first),{' '}
        <Mono>CardPanel</Mono> in <Mono>PayModal.jsx</Mono>, refunds to the card in <Mono>Closed.jsx</Mono>. Kiosk:{' '}
        <Mono>MachineCard</Mono> in <Mono>pos/src/kiosk/Checkout.jsx</Mono> starts a payment for the order&apos;s total
        with the payment id it will use, then <Mono>placeOrder(&apos;card&apos;, {'{ id, card_payment_id }'})</Mono>{' '}
        (<Mono>kioskOrder()</Mono> makes the payment card_integrated); leaving the step cancels it; the idle
        timer waits while the guest pays (<Mono>card_waiting</Mono>). Admin: Store tech → Card machines
        (<Mono>components/pos/CardMachinesSection.jsx</Mono>, <Mono>CardMachinePick</Mono> in the till and kiosk
        windows). Tender <Mono>card_integrated</Mono> (&quot;Card machine&quot;) is on by default; the migration
        added it wherever Cash Recon&apos;s takings mapping had <Mono>card_external</Mono>, and moved kiosks
        that used the old on-screen test reader to a test card machine. Tests:{' '}
        <Mono>shared/pos/test/cards.test.mjs</Mono>, <Mono>api/test/card-machines.test.mjs</Mono>.
      </P>
      <H3>Till and kiosk improvements (24 Nov 2026, migrations 295 and 296)</H3>
      <P>
        <Mono>shared/pos/tillSettings.js</Mono> holds the till settings that follow something else, as pure rules on
        the till&apos;s config (the till re-exports them from <Mono>checkOps.js</Mono>; the admin&apos;s till window
        reads <Mono>streamReceiptMode()</Mono> / <Mono>streamOrderPrompt()</Mono> for its hints):{' '}
        <Mono>counterTill()</Mono>, <Mono>leaveUnsent()</Mono>, <Mono>tillStream(config, streamId)</Mono> (the
        check&apos;s stream, else the till&apos;s, else the first), <Mono>receiptModeOf()</Mono>,{' '}
        <Mono>orderPromptOf()</Mono>, <Mono>RECEIPT_MODE_KEYS</Mono>, <Mono>ORDER_PROMPT_KEYS</Mono>. Migration 295
        sets <Mono>settings.leave_unsent</Mono> to <Mono>ask</Mono> on every till; 296 adds the two stream columns,
        copies each venue&apos;s values onto its streams, drops the <Mono>pos_settings</Mono> columns and turns a
        till&apos;s <Mono>venue</Mono> into <Mono>stream</Mono>. <Mono>StreamBody</Mono> takes{' '}
        <Mono>receipt_mode</Mono> / <Mono>order_prompt</Mono> (defaults ask / one); <Mono>loadStreams()</Mono>{' '}
        returns them, so they reach the till in <Mono>revenue_streams</Mono>.
      </P>
      <P>
        The layout button action <Mono>back</Mono> (key unchanged) is labelled <em>Back to tables / orders</em> in{' '}
        <Mono>BUTTON_ACTIONS</Mono>; <Mono>buttonLabel(b, &#123; backTo &#125;)</Mono> names a button without its own
        words <Mono>BACK_TO.tables</Mono> or <Mono>BACK_TO.orders</Mono> on the till (<Mono>ButtonsZone</Mono> passes{' '}
        <Mono>tablesOn(config) ? &apos;tables&apos; : &apos;orders&apos;</Mono>). Store tech&apos;s setup windows draw
        each setting with <Mono>Setting</Mono> / <Mono>SettingToggle</Mono> (<Mono>components/pos/shared.jsx</Mono>:
        an outlined block, <Mono>data-setting</Mono>, the label <Mono>text-base font-semibold</Mono>, the hint below
        in <Mono>text-sm</Mono> muted); <Mono>CardMachinePick</Mono> and <Mono>OrderNumbersField</Mono> take{' '}
        <Mono>boxed</Mono>. Tests: <Mono>shared/pos/test/tillSettings.test.mjs</Mono>,{' '}
        <Mono>api/test/till-order-prompt.test.mjs</Mono> (the stream settings, a till as the stream, both migrations
        replayed), <Mono>shared/pos/test/tillLayout.test.mjs</Mono>.
      </P>

      <H3>Combined tables (26 Nov 2026, migration 297)</H3>
      <P>
        A party across several tables is one check. The check keeps its main table (<Mono>table_id</Mono>) and
        holds the others in <Mono>joined_table_ids</Mono> (in the order joined; the key is absent when it holds
        none, so the synced state of every other check is unchanged). <Mono>shared/pos/tables.js</Mono> is the one
        set of rules: <Mono>joinedTables(c)</Mono>, <Mono>tablesOf(c)</Mono> (main first), <Mono>holdsTable()</Mono>,{' '}
        <Mono>tableLabel(check, tables)</Mono> (&quot;4 + 5&quot;; <Mono>tables</Mono> a list or a map by id),{' '}
        <Mono>tableTitle()</Mono> (&quot;Table 4&quot; / &quot;Tables 4 + 5&quot;), <Mono>tableLabelSql(alias)</Mono> (the
        same label in SQL for a <Mono>pos_checks</Mono> row), <Mono>tablesAsked(event, checks)</Mono>,{' '}
        <Mono>tableHolders(checks, tableIds, exceptId)</Mono>, <Mono>combinePlan(check, tableIds, checks)</Mono> and{' '}
        <Mono>CHECK_TABLES_MAX</Mono> (12, the main table included).
      </P>
      <DataTable
        head={['Event', 'Payload', 'Rules (applyEvent)']}
        rows={[
          ['check.tables_joined', '{ table_ids: [uuid] }', 'Open checks only, on a table, never a counter order (no_table) or from a kiosk. Not the main table, no table twice, 12 in all. A table already joined is left as it is. With the venue\'s tables known, each must be one of them (code table). With holders known, none may be held by another open check, as its main table or a joined one (code table_held). No permission of its own, as check.table_moved has none.'],
          ['check.tables_split', '{ table_ids: [uuid] }', 'Each must be joined to the check (code missing). The main table is never split off: the check moves.'],
          ['check.opened / check.table_moved', 'table_id', 'Refused (table_held) when the table is joined to another open check. A main table still takes a second check (split bills). A move keeps the joined tables, drops the one it moves to, and clears them all when the check becomes a tab.'],
          ['check.merged', '', 'The check merged away holds no tables any more; the one it went into keeps its own.'],
          ['check.closed', '', 'Nothing is cleared: a table is held only while its check is open, and the closed check keeps the list as a record.'],
          ['check.reopened', '', 'With holders known, joined tables another open check holds now are dropped.'],
        ]}
      />
      <P>
        <strong>Who holds a table.</strong> <Mono>applyEvent()</Mono> only sees the checks an event touches, so the
        rules about other checks read two optional things from its context: <Mono>ctx.holders</Mono> (the open
        checks holding any of <Mono>tablesAsked(event)</Mono>, as <Mono>tableHolders()</Mono> shapes them) and the
        venue&apos;s tables (<Mono>ctx.tables</Mono>, else <Mono>ctx.print.tables</Mono>, which the sequencer&apos;s
        context and the hub&apos;s copy of it already carry). The sequencer asks its store:{' '}
        <Mono>openChecksOnTables(tableIds)</Mono>, implemented over Postgres (<Mono>sequencer()</Mono> in{' '}
        <Mono>posSvc.js</Mono>: <Mono>status = &apos;open&apos;</Mono> and <Mono>table_id = ANY(ids) OR
        joined_table_ids &amp;&amp; ids</Mono>) and in the hub&apos;s mirror (<Mono>shared/pos/mirror.js</Mono>), so a
        hub decides these events as the cloud does. The till passes both in <Mono>dispatchMany()</Mono> from the
        checks it has. Without them (a replay, the Test data page&apos;s generator, a store without the method)
        those rules are skipped. Nothing is kept in a module variable.
      </P>
      <P>
        <strong>The column.</strong> Migration 297 adds <Mono>pos_checks.joined_table_ids uuid[] NOT NULL DEFAULT
        &apos;&#123;&#125;&apos;</Mono>, written by <Mono>projectionRows()</Mono> like every other column (so the Test
        till sales, which store checks through it, carry it too). Older checks hold no joined tables, which the
        default says, so <Mono>CHECK_BREAKDOWNS_V</Mono> / <Mono>proj_v</Mono> is not raised.{' '}
        <Mono>GET /pos-api/checks</Mono> (and the hub&apos;s <Mono>listChecks()</Mono>) returns it;{' '}
        <Mono>GET /api/pos/venues/:venueId/checks</Mono> returns it and a <Mono>table_label</Mono> made by{' '}
        <Mono>tableLabelSql()</Mono>. The report catalogue&apos;s <Mono>till.checks</Mono> has the fields{' '}
        <Mono>tables</Mono> (the same SQL) and <Mono>tables_held</Mono>; the <Mono>table</Mono> link is still the
        main table.
      </P>
      <P>
        <strong>Names.</strong> <Mono>headerFromCheck()</Mono> (<Mono>shared/pos/kitchen.js</Mono>) and{' '}
        <Mono>header()</Mono> (<Mono>shared/pos/printing.js</Mono>) take the table from <Mono>tableLabel()</Mono>, so
        kitchen screens, kitchen tickets, the pass, bills and receipts say &quot;4 + 5&quot; with no change of
        their own; both events are in <Mono>KITCHEN_CHECK_EVENTS</Mono>, so an order already in the kitchen is
        renamed when tables join or split.
      </P>
      <P>
        <strong>The till.</strong> <Mono>pos/src/lib/checkOps.js</Mono>: <Mono>openCheck(&#123; join_table_ids &#125;)</Mono>{' '}
        (the open and the join in one <Mono>dispatchMany()</Mono>), <Mono>combineChanges(check, want, checks)</Mono>{' '}
        → <Mono>&#123; split, join, merge, blocked &#125;</Mono>, <Mono>applyCombine(check, changes, approver)</Mono>{' '}
        (splits, then each <Mono>check.merged</Mono>, then one <Mono>check.tables_joined</Mono>; all or nothing),{' '}
        <Mono>checksByTable(open)</Mono>, <Mono>combinationsWith(config, tableId)</Mono>, <Mono>tableTitleOf()</Mono>,{' '}
        <Mono>itemCount()</Mono>, <Mono>mergeable()</Mono>. <Mono>pos/src/components/CombineModal.jsx</Mono>: the
        check&apos;s <Mono>CombineModal</Mono> (<Mono>combine-picker</Mono>, <Mono>combine-table</Mono> with{' '}
        <Mono>data-state</Mono> main | on | busy | stuck | free, <Mono>combine-label</Mono>,{' '}
        <Mono>combine-suggestion</Mono>, <Mono>combine-done</Mono>, <Mono>combine-cancel</Mono>),{' '}
        <Mono>CombineConfirm</Mono> (<Mono>combine-merge</Mono>, <Mono>combine-merge-order</Mono>,{' '}
        <Mono>combine-merge-go</Mono>, <Mono>combine-merge-cancel</Mono>) and <Mono>runCombine()</Mono> (the
        manager&apos;s approval for <Mono>transfer</Mono> when there is a merge). <Mono>screens/Floor.jsx</Mono>:
        the mode (<Mono>combine-start</Mono>, <Mono>combine-bar</Mono>, <Mono>combine-picked</Mono>,{' '}
        <Mono>combine-go</Mono>), <Mono>table-tile</Mono> with <Mono>data-label</Mono>, <Mono>data-state</Mono>,{' '}
        <Mono>data-party</Mono>, <Mono>data-main</Mono> and <Mono>data-picked</Mono>, the plan&apos;s{' '}
        <Mono>table-link</Mono> lines, and <Mono>check-row</Mono>&apos;s <Mono>data-title</Mono>. More has{' '}
        <Mono>action-combine</Mono>, Move table <Mono>table-combine</Mono>, and <Mono>BUTTON_ACTIONS</Mono> the
        action <Mono>combine</Mono> (<Mono>runButton()</Mono> in <Mono>Check.jsx</Mono>).
      </P>
      <P>
        <strong>Bookings&apos; combinations.</strong> <Mono>tillConfig()</Mono> sends{' '}
        <Mono>table_combinations: [&#123; id, name, table_ids &#125;]</Mono>: the venue&apos;s active{' '}
        <Mono>table_combinations</Mono> whose tables the till has. The till only offers them as one-tap picks; it
        never writes to them. Tests: <Mono>shared/pos/test/tables.test.mjs</Mono>,{' '}
        <Mono>api/test/till-combine.test.mjs</Mono>.
      </P>

      <H3>Check and order numbers (per device)</H3>
      <P>
        Migration 217: every till and kiosk numbers its own checks, so the cloud, the venue hub and a
        device working alone can all accept checks without handing numbers out. Rules in{' '}
        <Mono>shared/pos/numbers.js</Mono>: a check is the device's <Mono>short_code</Mono> and its own
        count for the trading day (<Mono>numberText()</Mono>: T2-47); a counter order (till or kiosk) also
        takes the next <Mono>order_no</Mono> in the device's <Mono>settings.order_numbers</Mono>{' '}
        <Mono>{'{ from, to }'}</Mono>, going round (<Mono>nextNumbers()</Mono>). The device puts{' '}
        <Mono>number</Mono> / <Mono>order_no</Mono> in the <Mono>check.opened</Mono> payload
        (<Mono>takeNumbers()</Mono> in <Mono>pos/src/lib/numbers.js</Mono>, its last numbers in localStorage{' '}
        <Mono>pos_numbers_&lt;device id&gt;</Mono>); the sequencer stamps <Mono>assigned.number_code</Mono>{' '}
        from the device's own code (never the payload's) and keeps each device's highest numbers per day
        (<Mono>noteNumbers()</Mono> into <Mono>pos_venue_state.device_numbers</Mono>), returned as{' '}
        <Mono>numbers</Mono> in <Mono>GET /pos-api/sync</Mono> and every <Mono>/pos-api/config</Mono> reply
        (an unchanged one too) and merged in by <Mono>keepServerNumbers()</Mono> /{' '}
        <Mono>mergeNumbers()</Mono> (later day, then higher check number), so a device that lost its
        storage carries on. The trading day a device counts under: the open day's date when the server
        said one (the till's sync <Mono>day</Mono>, the config's <Mono>trading_day</Mono>), else{' '}
        <Mono>businessDate()</Mono> by its own clock.
      </P>
      <P>
        Ranges: <Mono>POST /api/pos/venues/:id/link</Mono> gives a new till or kiosk the first free block of
        a hundred (<Mono>freeOrderRange()</Mono>: 1-99, 100-199, ...), a device brought back keeps its own
        unless another took it; <Mono>PATCH /api/pos/devices/:id</Mono> keeps the range when the settings
        leave it out and answers 422 <Mono>order_numbers</Mono> naming the device whose range it overlaps.
        Store tech's till and kiosk windows edit it (<Mono>OrderNumbersField</Mono> in{' '}
        <Mono>TillsSection.jsx</Mono>). Unsent changes: devices send <Mono>X-Pos-Pending: n</Mono> on every
        request (<Mono>createTransport(device, {'{ pending }'})</Mono>), stored in{' '}
        <Mono>pos_devices.pending_changes</Mono>; <Mono>GET /pos-api/reports/day</Mono> returns{' '}
        <Mono>waiting</Mono> (devices with changes, or not heard from for 10 minutes but seen today), shown by
        the till's Close the day (<Mono>WaitingDevices</Mono> in <Mono>pos/src/screens/Reports.jsx</Mono>).
        Tests: <Mono>shared/pos/test/numbers.test.mjs</Mono>, <Mono>api/test/device-numbers.test.mjs</Mono>.
      </P>
      <H3>Hub first (migration 218)</H3>
      <P>
        At a location with a linked venue hub and <Mono>pos_settings.hub_first</Mono> on (the default), tills,
        kiosks, kitchen screens and order ready boards send their events to the hub on the venue network; the hub
        decides them over its copy of the venue with the same sequencer, answers at LAN speed with or without the
        internet, and sends them on to the cloud, which decides them again and stays the one record
        (<Mono>pos_events</Mono>, <Mono>seq</Mono>). Design and limits: <Mono>docs/POS.md</Mono> section 11.
      </P>
      <DataTable
        head={['Part', 'What it does']}
        rows={[
          ['The copy', 'shared/pos/mirror.js createMirror(): the cloud\'s state (checks, kitchen orders, the trading day, device numbers, Splitter turns) as the base plus the hub\'s pending events. submit() decides an event with createSequencer() over that view; applyCloud() takes the cloud\'s new events and states and rebases (pending replayed at their own times; one that no longer applies goes to conflicts); sync() / kitchenSync() serve devices with the hub\'s own rev and source hub:<id>; dayReport(), listChecks(), getCheck(); needsCloud() for card machine and loyalty events; snapshot() / createMirror({ snapshot }) for the disk.'],
          ['Device rules', 'shared/pos/deviceRules.js deviceEvent(raw, device, venueId, kioskIds): what POST /pos-api/events allows a device (seq / assigned / hub fields stripped, server-only kitchen events refused, a kiosk only its own counter orders as itself). Used by the cloud for devices and for the hub\'s uploads, and by the hub for its devices.'],
          ['Cloud routes', 'services/hubFirstSvc.js + routes/posApi.js, hub devices only: GET /pos-api/hub/context (sequencer context without PIN hashes, devices and screens with key_hash, hub_first, primary, board_clear_mins, version; ?version= answers unchanged), GET /pos-api/hub/sync?since= (reset with checks open or of the day, kitchen orders and recent event ids; else event ids + seqs and changed checks / kitchen orders since; seq, day, numbers, turns, presence; a shared advisory lock on the venue so a reply is never half way through a decision), POST /pos-api/hub/events ({ events: [{ ...event, hub_at, hub_printed }], rejections }: each event checked with deviceEvent() for its own device, decided by the cloud\'s sequencer at hubTime(hub_at) (the future and older than 3 days clamp to now), pos_events.hub_id set, jobs saved printed by the hub when hub_printed, a device removed before hub_at refused; rejections the hub made are stored with hub_id).'],
          ['Which hub', 'primaryHub(): linked, not removed, its last report has info.lan_port, seen in the last 15 minutes; the oldest such. hubFor(tx, tenantId, venueId, device) gives a device { id, urls: http://<IPv4>:<lan_port> per address the hub reported, lan_key }, or null (hub first off, no primary). In every till / kiosk / kitchen screen /pos-api/config reply and every /screen-api/config reply, unchanged ones too (outside the version).'],
          ['LAN keys', 'deriveKey(\'lan:\' + kind + \':\' + id + \':\' + secret_hash) in services/vault.js (HMAC of SECRETS_KEY): nothing stored, a device linked again gets a new key. The hub only gets sha256 of each key in its context; devices send Authorization: Lan <id>.<key>.'],
          ['Cursors', '/pos-api/sync and /pos-api/kitchen/sync take source; anything but cloud starts the cursor again (reset), and replies say source: cloud. The hub\'s replies say hub:<id>. Devices keep seqSource and send it back.'],
          ['The hub', 'hub/src/venue.js startVenue(): the context every 30 s and after the first report; follow every 5 s, upload every 2 s while pending; venue.json (atomic, every 10 s and when the set-up loads) and venue.log (each accepted event appended + fsync before the answer), replayed on start (held while there is no set-up); tickets for the hub\'s printers to printOwn(), for a printer plugged into a device queued for that device (hub-<ulid>). hub/src/lan.js startLan(): port 9181 (--lan-port, HUB_LAN_PORT; the installers open it), CORS + Access-Control-Allow-Private-Network, GET /lan/ping, the device calls, /screen-api/orders for screen keys; 409 hub_off while not taking events; an unknown key loads the context again (at most every 10 s). service.js reports info.lan_port and info.mirror (on, rev, cloud_seq, pending, to_send, conflicts, devices, last upload / follow, error) every minute and when taking starts or stops.'],
          ['Devices', 'pos/src/lib/transport.js createTransport(device, { pending, hub, onHub }): HUB_PATHS (events, sync, kitchen sync, day report, checks, presence) to the hub first with HUB_TIMEOUT_MS 2500, then the cloud on no answer / 409 / 401; then a quiet /lan/ping every HUB_RETRY_MS 30 s (HUB_RETRY_UNKNOWN_MS 5 s after a 401). hubAllowed(): inside the Android app (IN_APP) or a page on http. Tills and kitchen screens poll every 2 s on the hub; the kiosk\'s reachable() counts the hub; screen/player.js fetchOrders() reads the hub first. StatusDot / kds-link / the kiosk staff panel / the till settings say venue hub. Android app 1.3: mixedContentMode always, plugins/withVenueNetwork.js (usesCleartextTraffic).'],
          ['Admin', 'components/pos/HubSection.jsx (Store tech → Venue hub, /pos/hub, migration 219): HubFirstSetting (the switch, PATCH /api/pos/venues/:id/settings { hub_first }, which also tells screens), HubFirstLine on each hub\'s row from info.mirror.'],
        ]}
      />

      <H3>Trading days, Z and Cash Recon</H3>
      <P>
        The first event after a Z opens a day (<Mono>business_date</Mono> by <Mono>day_starts_at</Mono> in
        the venue time zone); devices start their numbers again for it (below). <Mono>day.closed</Mono> needs no open checks; the
        server stores <Mono>dayFigures()</Mono> (<Mono>shared/pos/reports.js</Mono>, also the till's X / Z)
        and, with <Mono>recon_auto_fill</Mono>, calls <Mono>fillReconFromDay()</Mono>:{' '}
        <Mono>reconValues()</Mono> maps figures through <Mono>recon_map</Mono> (income: revenue stream ids
        / all / -refunds; takings: tender keys, amount + tips − refunds; SC: <Mono>service_charge</Mono> = every
        charge, <Mono>charge:&lt;name&gt;</Mono> = one charge by name from <Mono>figures.charges</Mono>, never both
        counted, and <Mono>tips</Mono>) and{' '}
        <Mono>fillReconDay()</Mono> (<Mono>services/reconFill.js</Mono>, shared with Loyverse) writes only
        mapped fields and skips a submitted Cash Recon day.
      </P>
      <H3>Admin pages</H3>
      <DataTable
        head={['Page', 'Files']}
        rows={[
          ['Store tech /pos/:tab', 'pages/PosSetup.jsx (TABS: one page per part, the key is the address; /pos, /pos?tab=<key> and unknown keys redirect, so store opening follow-ups saved with ?tab= links still work; kiosk, kitchen flow and print designers are TABS of their own since migration 241 (kiosk-designs, kitchen-flow, print-designs), a design opening at /pos/kiosk-designs/:id or /pos/print-designs/:id so its menu link stays lit) + components/pos/*Section.jsx; GET /api/pos/venues/:id/setup is the one read (includes device_urls { terminal, kds, kiosk } from deviceOrigin(), till_url = the till\'s, sections and items for routing, recon_fields). deviceUrl(setup, kind) in TillsSection.jsx; ShownCodeField (the device steps with the kind\'s address + the code box), LinkDeviceModal / LinkDeviceButton (New device / Link a device on a row; Bring back for a removed one) and linkShownCode() there too, used by the Tills, Kitchen screens and Kiosks tabs. Reusing a device: ReusePick (Link it as A new … / One already here, under the code in every Add window: Add a till, Add a screen, Add a kiosk, Link a hub), reusable() (the kind\'s devices: not linked, linked, removed), defaultReuse() (the one not linked when there is exactly one), reuseLabel() (Link as … / Bring back …), RemovedDevices (the Removed line with Bring back). With a device picked, the window sends { code, device_id } and hides name and settings. The Screens page\'s AddScreenModal has the same choice over the location\'s screens (not paired first) and claims with screen_id.'],
          ['Floor plan /pos/floor', 'pages/PosFloor.jsx: snap 0.5 unit, pointer drag / resize, explicit Save per area (PUT /api/pos/floor-areas/:id/layout replaces tables on the area + decor).'],
          ['Till reports /pos/reports', 'pages/PosReports.jsx: days (+ fill-recon, needs cash_recon manage too), checks with events, conflicts, print queue.'],
          ['Menus, Variant groups, Promotions', 'components/menus/TillFields.jsx (section / dish Till box), components/menus/ComboEditor.jsx (Dish / Combo, steps, comboPayload()); VariantGroupsManager pos_prefixes + child_group_id + allow_repeat / on_request; Promotions Where (channels).'],
        ]}
      />
      <H3>Hosting: one build, three addresses</H3>
      <P>
        <Mono>routes/posSite.js</Mono> (fastify-plugin, registered after the apex hook) serves{' '}
        <Mono>pos/dist</Mono> for host kinds <Mono>pos</Mono> (tills), <Mono>kitchen</Mono> (kitchen screens)
        and <Mono>kiosk</Mono> (kiosks) (<Mono>platformHostKind()</Mono>), forwards <Mono>kds.</Mono> to{' '}
        <Mono>kitchen.</Mono> (301), and lets <Mono>/pos-api</Mono>, <Mono>/ws</Mono>, <Mono>/uploads/</Mono>{' '}
        and <Mono>/api/</Mono> through, so the existing <Mono>*.&lt;domain&gt;</Mono> nginx block and wildcard
        certificate cover all three. <Mono>/manifest.webmanifest</Mono> is the build&apos;s with the name for
        the host (Macaroonie Till / Kitchen / Kiosk), so each installs as its own app (Android ties an installed
        app to its address). The deploy builds <Mono>pos/</Mono> after the admin. <Mono>pos</Mono>,{' '}
        <Mono>kitchen</Mono>, <Mono>kds</Mono> and <Mono>kiosk</Mono> are in <Mono>RESERVED_SUBDOMAINS</Mono>.{' '}
        <Mono>deviceOrigin(kind)</Mono> and <Mono>DEVICE_KIND_OF_HOST</Mono> in{' '}
        <Mono>services/platformHost.js</Mono>; kiosk previews are made on the kiosk address and the kitchen
        test bench on the kitchen address.
      </P>
      <DataTable
        head={['Part', 'How']}
        rows={[
          ['pos/src/lib/appHost.js', 'HOST_APP from the address (pos -> terminal, kitchen / kds -> kds, kiosk -> kiosk, anything else null = any kind, for local and test addresses), addressFor(kind) (same scheme and port), belongsHere(kind), takePairCode() (#pair=CODE, removed from the address at once), movedTo() / setMovedTo() (localStorage maca_moved_to), moveDevice(), tellDisconnect(); sets the page title for the address.'],
          ['POST /pos-api/pair { code, app? }', 'Only the move hand-over: the one-time code POST /pos-api/move makes, typed by the app at the new address itself (#pair=CODE). app = HOST_APP; a code for another kind is refused before it is used (422 code wrong_address). Nothing else makes these codes since Store tech\'s were removed (19 Oct 2026).'],
          ['POST /pos-api/disconnect', 'Device auth (kiosks too: KIOSK_ROUTES). secret_hash, pairing_code_hash, pairing_expires_at = NULL: the device row stays (name, settings, short code), Store tech shows Not linked, Link a device on its row links the code the device then shows.'],
          ['POST /pos-api/move', 'Device auth. openPairing(tx, tenantId, deviceId, 10) (moved to services/posSvc.js) -> { code, kind, url = deviceOrigin(kind)/#pair=code }. The old copy\'s secret works until the code is used (pairing replaces it), so a move that never arrives can be tried again.'],
          ['Disconnect on the devices', 'Till: TillSettings Disconnect this till (manager approval, refused with unsent events) -> disconnect() in lib/store.js. Kitchen: SettingsPanel DisconnectBox -> disconnect() in kitchen/store.js (unsent taps dropped, counted first). Kiosk: StaffPanel DisconnectBox -> disconnect() in kiosk/store.js (waiting paid orders sent first, refused while any are left). Offline, the device still forgets itself and says Macaroonie couldn\'t be told.'],
          ['Move on the devices', 'MoveNotice (components/MoveNotice.jsx) when belongsHere() is false: the till app (above its screens), the kitchen app (top) and the kiosk (top of the start screen and in the staff panel). moveTill() / moveScreen() / moveKiosk() send what is waiting, call /pos-api/move, forget the device here, set maca_moved_to and open the new address. The old address then shows MovedAway (opens the new one after 5 s; Set up another device here clears it).'],
        ]}
      />
      <InfoBox type="info">
        Provisioned for later, not built: the venue hub (a <Mono>hub</Mono> device kind, the print-job claim
        routes, <Mono>device.hub_url</Mono> in <Mono>pos/src/lib/transport.js</Mono>, which tries the hub
        before the cloud) and card payment adapters (tenders are external for now). Kitchen screens: next
        section. Tests: <Mono>node --test shared/pos/test/*.test.mjs</Mono> (rules, pricing, printing,
        reports, kitchen, the sequencer against an in-memory store).
      </InfoBox>
    </section>
  )
}
