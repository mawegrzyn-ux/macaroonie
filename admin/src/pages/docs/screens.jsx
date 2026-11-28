// src/pages/docs/screens.jsx
// The Docs page's "Menu Screens" section. Docs.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, Mono, DataTable, InfoBox } from './parts.jsx'

export const id = 'screens'
export const label = 'Menu Screens'
export const order = 420

// ── WEBSITE CMS ─────────────────────────────────
export function Section() {
  return (
    <section id="screens" data-doc="">
      <H2>Menu Screens</H2>
      <P>
        Digital menu boards (migration 166, module <Mono>screens</Mono>; four pages since migration
        241, each with its own menu entry: <Mono>/screens</Mono> Menu screens,{' '}
        <Mono>/screens/boards</Mono> Screen board designer, <Mono>/screens/playlists</Mono> and{' '}
        <Mono>/screens/walls</Mono>, all <Mono>pages/Screens.jsx</Mono> with a <Mono>page</Mono>{' '}
        prop). A <strong>board</strong> (<Mono>screen_designs</Mono>) is a canvas
        of a fixed size in pixels with positioned blocks; a <strong>playlist</strong> rotates boards
        with optional times of day; a <strong>screen</strong> is a paired device showing a board or
        a playlist. The player is a plain-files PWA on <Mono>screens.&lt;root&gt;</Mono>; boards are
        drawn by one renderer, <Mono>shared/screenLayout.js</Mono>, in the player and in the admin
        designer. Prices are the <strong>live</strong> menus (<Mono>menu_releases</Mono>), so a
        publish changes every screen; sold out comes from <Mono>ordering_item_availability</Mono>.
        Boards and playlists are tenant-wide (every location uses them; each screen shows its own
        venue&apos;s sold out dishes and order ready board); screens and walls have a{' '}
        <Mono>venue_id</Mono>. The Location picker (on the Menu screens and Screen walls pages,{' '}
        <Mono>useScreensPlace()</Mono>, localStorage <Mono>maca_screens_venue</Mono>, empty = every
        location) only filters what is shown and sets the location a new screen or wall starts at;
        reordering one location&apos;s screens sends the whole order with the others in place
        (<Mono>mergeOrder()</Mono>). No API change.
      </P>
      <DataTable
        head={['Table', 'Purpose']}
        rows={[
          ['screen_designs', 'tenant_id, name, width / height (240-8192 px), layout jsonb (board settings + blocks), created_by / updated_by. RLS.'],
          ['screen_playlists / screen_playlist_items', 'A playlist and its boards in order: design_id (cascade), duration_secs (3-3600), schedule jsonb (the menuSchedule.js shape { from, until, times: [{ days, start, end }] }, null = always), sort_order. RLS.'],
          ['screens', 'venue_id, name, short_code (S1, S2 ... unique per tenant), width / height, rotation (0 / 90 / 180 / 270), fit (contain / cover / stretch), playlist_id or design_id (CHECK not both; SET NULL on delete), secret_hash, paired_at, last_seen_at, app_version, device_info and status jsonb (from heartbeats). RLS.'],
          ['screen_pairings', 'Global, no RLS: code_hash (sha256 of the normalised code), secret_hash, device_info, expires_at (15 min), then claimed_at / screen_id / tenant_id. Never holds the code or the secret. Rows expired over a day are deleted when a new code is asked for.'],
          ['pos_roles.permissions.sold_out', 'Till permission "Mark dishes sold out" (shared/pos/permissions.js); the migration sets it on existing Supervisor and Manager roles.'],
          ['screen_walls (migration 167)', 'venue_id, name, cols / rows (1-6), gap (0-400 board px hidden behind the frames), design_id or playlist_id (CHECK not both; SET NULL on delete). RLS.'],
          ['screens.wall_id / wall_col / wall_row (167)', 'A screen\'s place on a wall (FK ON DELETE SET NULL, col / row 0-5, unique partial index on (wall_id, wall_col, wall_row)). A screen on a wall shows the wall\'s board or playlist, not its own.'],
          ['screen_playlist_items.transition / transition_ms (167)', 'How the board comes on: none | fade | slide_left | slide_right | slide_up | slide_down | zoom | wipe (default fade), 0-5000 ms (default 800).'],
        ]}
      />
      <H3>Pairing and device auth</H3>
      <P>
        The screen asks for a code (<Mono>POST /screen-api/pairings</Mono>, no auth, 10 a minute):
        the API makes a six-character code (no 0/O/1/I/L) and a 32-byte secret, stores their
        hashes and returns both. The screen shows the code and polls{' '}
        <Mono>GET /screen-api/pairings/:id</Mono> with <Mono>Authorization: Pairing &lt;secret&gt;</Mono>.
        Someone types the code into Screens (<Mono>POST /api/screens/screens/claim</Mono>, manage):
        the pairing&apos;s secret hash becomes the screen&apos;s <Mono>secret_hash</Mono> (a new
        screen, or <Mono>screen_id</Mono> for a new device on an existing one, which locks the old
        device out). The poll then answers <Mono>paired</Mono> with the screen id, and the device
        signs in with <Mono>Authorization: Screen &lt;id&gt;.&lt;secret&gt;</Mono> from then on: the
        secret never travels again and the API never stores it. <Mono>services/screenAuth.js</Mono>{' '}
        (<Mono>verifyScreen()</Mono>, 15 s cache, <Mono>forgetScreen()</Mono>) checks it for the
        screen API and the WebSocket; a switched-off module answers 403 <Mono>screens_off</Mono>.
      </P>
      <P>
        The player&apos;s own settings: five taps within 3 s (document click), or five presses of Enter /
        Space / Select (a remote&apos;s OK), open <Mono>#settings</Mono> in <Mono>screen/index.html</Mono>{' '}
        (<Mono>openSettings()</Mono> in <Mono>player.js</Mono>; the opening key press is
        preventDefault-ed, or it would press the panel&apos;s first button too). Arrows move between the
        buttons, Escape / Back closes, 60 s idle closes. <strong>Disconnect this screen</strong> (asked
        twice) calls <Mono>POST /screen-api/disconnect</Mono> (screen auth: <Mono>secret_hash = NULL</Mono>,{' '}
        <Mono>forgetScreen()</Mono>), then <Mono>unpair()</Mono> shows a new code; offline it forgets itself
        anyway. The screen row keeps its name, boards and wall place; New device for this screen pairs it
        again.
      </P>
      <H3>Screen API (/screen-api) and live updates</H3>
      <DataTable
        head={['Route', 'What it does']}
        rows={[
          ['GET /config?version=', 'screenConfig() in services/screenSvc.js: player_version, screen (size, rotation, fit), venue (timezone), wall { id, name, cols, rows, col, row, gap } when the screen is on one (its board / playlist then comes from the wall), playlist (items with schedules and transitions) or design_id, designs { id: { width, height, layout } }, the LIVE versions of the menus the boards point at (boardMenuIds(), slimmed by slimMenu(), sections hidden everywhere left out), tags shown on menus, the allergen notice, sold_out item ids, version (sha256 of all of it). { unchanged: true } when the version matches.'],
          ['POST /disconnect', 'The screen forgets its pairing (its settings panel): secret_hash = NULL; the row keeps its name, boards and wall place.'],
          ['POST /heartbeat', 'Every minute: app_version, showing { design_id, name, playlist_item_id }, viewport, error, config_version, offline_secs, clock { offset_ms, rtt_ms }. Written at most once per 50 s per screen; the admin shows a screen online when last_seen_at is under 150 s old.'],
          ['GET /time', '{ now } (server ms), no-store, no auth, 120 a minute. The player takes five samples and keeps the quickest round trip (offset = now + rtt / 2 - received), again every 10 minutes; a jump over 250 ms reschedules the boards.'],
          ['GET /tech', 'The Store status block\'s data (28 Nov 2026): { tiles, light, checked_at, server_time }. tiles = screenTiles(techTiles(loadTechBoard(...))) for the screen\'s own venue (services/techBoardSvc.js, shared/techBoard.js): kind, name, tone, word, seen_at, count, ring, linked, nothing else (no ids, addresses, serials, errors, versions); light = lightStatus().state. Only for a screen one of whose boards (its own, its playlist\'s or its wall\'s: screenBlocks()) has a tech_status block, else 404 no_block. The tills, kitchen screens, kiosks, printers, card machines and hub only when one of those blocks has opts.kit true (stamped on save by stampTechBlocks(): its placer had Store tech view), as /api/tech-board shows kit only to Store tech; else the menu screens alone. no-store, 60 a minute. The config\'s needs_tech says to fetch it; the player does every 45 s (TECH_EVERY_MS) and draws again each time, forgets it when unpaired, and never draws an answer for another venue than its config\'s (techVenue).'],
          ['/ws?screen=<id>&secret=<secret>', 'Joins screen:<id> (screens.changed, screen.identify, screen.reload, screen.removed), screens:<venueId> (screens.sold_out with the item ids), screens-t:<tenantId> (screens.changed after a board or playlist save) and menus:<tenantId> (menus.live from publishing and the minute sweep). Everything except identify / reload / sold out makes the player fetch the config again; so does the socket reopening after a drop (changes meanwhile were pushed to nobody) and the browser coming back online; it also polls every 60 s. A wall change tells each screen it touched.'],
        ]}
      />
      <H3>Admin API (/api/screens)</H3>
      <P>
        Reads need <Mono>screens</Mono> view, changes manage; identify is allowed with view. Every
        query filters <Mono>tenant_id</Mono>; a screen can only point at the tenant&apos;s own
        venue, board and playlist, and a playlist only holds the tenant&apos;s boards.
      </P>
      <DataTable
        head={['Route', 'Notes']}
        rows={[
          ['GET /screens', '{ screens, player_url } (screensOrigin()); each screen with online, shows { kind, name }, status.'],
          ['POST /screens/claim', '{ code, name, venue_id, design_id | playlist_id, width?, height?, rotation? } or { code, screen_id }. Size defaults to the device report (CSS px x devicePixelRatio). 20 a minute.'],
          ['PATCH /screens/:id, PATCH /screens/reorder, DELETE /screens/:id, POST /screens/:id/identify | reload', 'Showing a board clears the playlist and the other way round; both at once is a 422.'],
          ['GET / POST /designs, GET / PUT / DELETE /designs/:id', 'POST takes copy_from, or layout (normalised: the Walls tab sends the guide lines). PUT stores normalizeBoard(layout) (unknown block types dropped, positions clamped), at most 500 KB. The list adds wall_count and video_secs (longest video block, from opts.duration). Delete removes the board from playlists, screens and walls.'],
          ['GET / POST /playlists, PUT / DELETE /playlists/:id', 'PUT replaces the items (transition from TRANSITION_KEYS, transition_ms 0-5000); a time must end after it starts and have days (no overnight times). The list adds wall_count.'],
          ['GET / POST /walls, PUT / DELETE /walls/:id', 'PUT { name, venue_id, cols, rows, gap, design_id | playlist_id, places: [{ col, row, screen_id }] }: refuses a screen twice, two screens in one place, a screen at another venue or another tenant\'s; places outside the grid are dropped; screens taken off are cleared. Moving a screen to another venue (PATCH /screens/:id) takes it off its wall. Delete clears its screens\' places.'],
          ['GET /menu-data?version=live|draft&venue_id=', 'designerData(): every menu (live, or the drafts), unpublished (menus with no live version), tags, notice, and the venue\'s sold out ids.'],
        ]}
      />
      <H3>Renderer (shared/screenLayout.js)</H3>
      <P>
        Blocks: heading, text, menu (a section or picked dishes), dish (featured), price (one dish
        or one option), image, box, clock, allergen_key. Positions are board pixels; later blocks
        sit on top. <Mono>boardContext(layout, data)</Mono> indexes the menus (sections hidden
        everywhere skipped, tags through <Mono>menuTags()</Mono>), the sold out set and the dishes
        shown on the board (for the allergen key); <Mono>renderBlockInner()</Mono> returns HTML,
        <Mono> null</Mono> when the block points at a menu, section or dish that isn&apos;t live
        (the designer explains, the player leaves the space empty), or <Mono>&apos;&apos;</Mono>{' '}
        for nothing to show. Prices go through <Mono>shared/orderPricing.js</Mono>{' '}
        (<Mono>itemChoices()</Mono> with the menu&apos;s variant rules, <Mono>fromPrice()</Mono>),
        so &quot;from&quot; prices match online ordering. <Mono>boardOnAt()</Mono> is{' '}
        <Mono>menuOnAt()</Mono> with the end NOT included (11:00-15:00 hands over at 15:00) and
        23:59 meaning midnight. Fonts: the website list plus Oswald, Bebas Neue, Anton, Barlow
        Condensed, Archivo Black, Pacifico and Permanent Marker (<Mono>SCREEN_FONT_WEIGHTS</Mono>,
        kept apart so the website pickers don&apos;t change). Tests:{' '}
        <Mono>node --test shared/test/screenLayout.test.mjs</Mono>.
      </P>
      <P>
        Migration 167 adds: <strong>video</strong> (a muted, playsinline video, <Mono>data-sl-video</Mono>{' '}
        with loop / sound; with <Mono>still: true</Mono> in the context it is a frame at 0.5 s and
        plays nothing: admin thumbnails and the designer until Play) and <strong>ticker</strong>{' '}
        (scrolling text: copies of the text in a track moved by the <Mono>sl-loop-ticker</Mono>{' '}
        keyframes). Any block can have <Mono>opts.anim_in</Mono> (ANIM_IN: fade, rise, drop, left,
        right, zoom, pop, wipe; <Mono>anim_in_ms</Mono>, <Mono>anim_in_delay</Mono>) and{' '}
        <Mono>opts.anim_loop</Mono> (ANIM_LOOP: pulse, float, swing, zoom, blink;{' '}
        <Mono>anim_loop_ms</Mono>); <Mono>wrapMotion()</Mono> wraps the block&apos;s HTML in{' '}
        <Mono>.sl-in</Mono> / <Mono>.sl-loop</Mono>, whose CSS animations run only under{' '}
        <Mono>.sl-board.sl-play</Mono>. <Mono>startBoardMotion(board, {'{ startMs, nowMs }'})</Mono>{' '}
        sizes the tickers, adds <Mono>sl-play</Mono> and sets each animation&apos;s clock: entrances
        from <Mono>startMs</Mono> (<Mono>replayStart()</Mono> with the board&apos;s{' '}
        <Mono>replay_secs</Mono>), movements from 1 January 1970, so every screen of a wall is at the
        same point. <Mono>playlistPosition(list, nowMs)</Mono> works out which board is on from the
        clock alone (rotation from the epoch, at least 3 s per board); <Mono>wallRegion()</Mono>{' '}
        is the part of a board one wall screen shows, <Mono>wallBoardSize()</Mono> the board size
        for a wall, <Mono>transitionFrames(kind, W, H)</Mono> the Web Animations keyframes in board
        pixels (a slide crosses the whole wall). The board&apos;s <Mono>guide_cols</Mono> /{' '}
        <Mono>guide_rows</Mono> / <Mono>guide_gap</Mono> only draw the designer&apos;s dashed lines.
      </P>
      <P>
        <strong>Store status</strong> (<Mono>tech_status</Mono>, 28 Nov 2026): the Tech board&apos;s honeycomb on a
        board, drawn by <Mono>techStatusHtml()</Mono> with the till area&apos;s <Mono>techModel()</Mono>
        (<Mono>shared/techBoard.js</Mono>) and <Mono>honeycomb()</Mono> / <Mono>honeycombHtml()</Mono> /{' '}
        <Mono>attentionHtml()</Mono> / <Mono>legendHtml()</Mono> (<Mono>shared/techHex.js</Mono>, whose{' '}
        <Mono>TECH_HEX_CSS</Mono> is appended to <Mono>SCREEN_LAYOUT_CSS</Mono>). <Mono>ctx.tech</Mono>:{' '}
        <Mono>{'{ tiles, light }'}</Mono> from <Mono>GET /screen-api/tech</Mono>; <Mono>{'{ pending: true }'}</Mono>{' '}
        (&ldquo;Checking the kit&rdquo;) before the first answer; <Mono>{'{ hidden: true }'}</Mono> in live mode
        (nothing); null in the designer (<Mono>sampleTechTiles()</Mono>, class <Mono>is-sample</Mono>). Options:{' '}
        <Mono>groups</Mono> (TECH_KINDS keys; empty = all), <Mono>show_names</Mono>, <Mono>show_health</Mono>,{' '}
        <Mono>show_attention</Mono>, <Mono>show_legend</Mono>, <Mono>tiles</Mono> large | compact
        (<Mono>TECH_TILE_SIZES</Mono>, the most a radius may be), <Mono>text_size</Mono>, <Mono>label_color</Mono>.
        The strip and the key take an estimate of their lines (<Mono>linesFor()</Mono>) and the hexagons fit
        the rest of the block (<Mono>fitSize()</Mono>); a dark board background (or see-through with light
        words) takes the dark look. Bad tiles glow only on a playing board (<Mono>.sl-play</Mono>): the rule that
        stops the glow elsewhere sits after <Mono>TECH_HEX_CSS</Mono> in <Mono>SCREEN_LAYOUT_CSS</Mono> and is more
        particular than its glow rule. The designer&apos;s panel is <Mono>TechStatusPanel</Mono> in{' '}
        <Mono>ScreenDesigner.jsx</Mono>.
      </P>
      <P>
        Who may show the kit: <Mono>PUT /api/screens/designs/:id</Mono> and <Mono>POST /api/screens/designs</Mono>{' '}
        (with a layout) stamp <Mono>opts.kit</Mono> on each <Mono>tech_status</Mono> block with{' '}
        <Mono>stampTechBlocks(layout, before, canKit)</Mono> (<Mono>shared/screenLayout.js</Mono>): true when the
        person saving has Store tech (<Mono>pos_setup</Mono>) view, else what the same block id had before, else
        false; what the browser sends is ignored, and a copy (<Mono>copy_from</Mono>) keeps its board&apos;s stamps.
        A block with <Mono>kit</Mono> false draws the menu screens only, the designer&apos;s example kit too, and
        its panel says so to a Screens-only editor.
      </P>
      <H3>Player (screen/, routes/screenSite.js)</H3>
      <P>
        Plain files, no build: <Mono>index.html</Mono>, <Mono>player.js</Mono> (ES module),{' '}
        <Mono>sw.js</Mono>, <Mono>manifest.webmanifest</Mono> (display fullscreen), icons.{' '}
        <Mono>routes/screenSite.js</Mono> serves them on host kind <Mono>screens</Mono> (a global
        onRequest hook like posSite), the shared files the player imports as{' '}
        <Mono>/lib/&lt;name&gt;</Mono> (allow-list <Mono>PLAYER_LIBS</Mono>), redirects http to
        https, and writes <Mono>playerVersion()</Mono> (a hash of the player and library files)
        into the page and the service worker. The player keeps its device id and secret and the
        last config in localStorage, so it starts offline; the service worker serves the player
        network-first (cached copy offline) and images and Google Fonts cache-first. It rotates
        the playlist&apos;s boards that are on now (venue time, clock corrected by the server
        time), preloads a board&apos;s images before showing it, scales the board to the screen
        (rotation and fit from the screen), updates clocks every 5 s, asks for a wake lock, hides
        the cursor, and reloads itself when a config names a newer player version (at most once
        in 5 minutes). Works installed from Chrome or in Fully Kiosk (detected by{' '}
        <Mono>window.fully</Mono>, reported in the device info).
      </P>
      <P>
        <strong>The shared files it loads</strong> (4 Nov 2026): <Mono>PLAYER_LIBS</Mono> in{' '}
        <Mono>services/screenSvc.js</Mono> is worked out at start from what <Mono>player.js</Mono> imports
        from <Mono>/lib/</Mono> and everything those import by relative path (<Mono>importClosure()</Mono>{' '}
        in <Mono>utils/importClosure.js</Mono>, shared with <Mono>hubRelease()</Mono>), nested paths kept
        (<Mono>/lib/pos/orderFlows.js</Mono>). It replaced a list kept by hand, which missed the two files{' '}
        <Mono>orderPricing.js</Mono> started importing in #431 (<Mono>pos/orderFlows.js</Mono>,{' '}
        <Mono>pos/charges.js</Mono>): they were 404, the player&apos;s module never ran, and every menu screen
        stayed black. <Mono>sw.js</Mono> gets the same list at serve time (the{' '}
        <Mono>__PLAYER_LIBS__</Mono> placeholder, so <Mono>SHELL_FILES</Mono> keeps what the player loads).{' '}
        <Mono>index.html</Mono> carries a watchdog before the module: <Mono>window.__screenRetry(ms)</Mono>{' '}
        reloads the page unless the player set <Mono>window.__screen</Mono> (60 s; 20 s from the module
        script&apos;s <Mono>onerror</Mono>). <Mono>api/test/browser-modules.test.mjs</Mono> follows every
        module tree a browser loads without a bundler (the player, the online ordering page&apos;s{' '}
        <Mono>/order-api/</Mono> files, the loyalty card&apos;s <Mono>/loyalty-api/</Mono>), checks each is
        served as JavaScript, and that the service worker&apos;s list equals the player&apos;s tree.
      </P>
      <P>
        <strong>Live mode</strong> (the live kitchen view&apos;s order ready boards):{' '}
        <Mono>?board_live=&lt;the view&apos;s signed link&gt;&amp;screen=&lt;id&gt;</Mono> or{' '}
        <Mono>&amp;board=&lt;board station id | all&gt;</Mono>. Data by that link only (
        <Mono>/screen-api/live/config</Mono>, <Mono>/screen-api/live/orders</Mono>, the socket{' '}
        <Mono>/ws?board_live=</Mono>), never a pairing; nothing kept (<Mono>save()</Mono> does nothing, the
        device&apos;s own pairing and config in localStorage are left as they are), no heartbeat, settings
        panel, service worker, full screen offer, wake lock or venue hub; boards drawn upright (rotation 0).
        A 401 or 404 shows the reason and stops. <Mono>routes/screenSite.js</Mono> lets such a page be
        framed by the platform&apos;s hosts (no X-Frame-Options, CSP <Mono>frame-ancestors</Mono> of the root
        and <Mono>*.&lt;root&gt;</Mono>).
      </P>
      <P>
        Since migration 167 screens keep in step without talking to each other: the clock comes
        from <Mono>/screen-api/time</Mono>, the board on now from <Mono>playlistPosition()</Mono>,
        and the next board is drawn hidden (<Mono>.layer.prep</Mono>) 3 s early so its images and
        videos load and its transition starts on time; a late timer jumps into the transition at
        the elapsed point. A screen on a wall crops its part in <Mono>fit()</Mono> (translate,
        then scale and turn). <Mono>syncVideos()</Mono> runs every second: elapsed time from the
        board&apos;s start in a playlist, else from the epoch; small drift is caught up with
        playbackRate 0.9-1.1, big drift (0.5 s on a wall, 1.5 s otherwise) by seeking. A sold out
        push redraws in place (<Mono>redraw()</Mono>, skipped when the HTML is unchanged); a new
        config also re-fits what is on screen (rotation, fit, wall place). The service worker keeps
        every video the boards play in <Mono>screen-video-v1</Mono> (the player posts{' '}
        <Mono>{'{ type: \'videos\', urls }'}</Mono>; one download at a time, videos no board plays
        are deleted) and answers the video element&apos;s byte ranges by slicing the cached file
        (206, or 416), from the network until the copy is there.
      </P>
      <H3>Sold out</H3>
      <P>
        <Mono>services/soldOut.js</Mono> is the one writer: <Mono>setSoldOut()</Mono> (today =
        next venue-local midnight, indefinite = null, false = delete) and{' '}
        <Mono>announceSoldOut()</Mono> (ordering.availability to the venue room, pos.config to the
        tills, screens.sold_out with the ids to the screens). Used by the orders board route and
        the new till route <Mono>PUT /pos-api/sold-out/:itemId</Mono>{' '}
        (<Mono>{'{ sold_out, staff_id, approved_by? }'}</Mono>, checked with{' '}
        <Mono>permissionProblem(..., &apos;sold_out&apos;)</Mono>). <Mono>tillConfig()</Mono>{' '}
        includes <Mono>sold_out: [{'{ item_id, until }'}]</Mono>; the till greys the dish, holding
        a dish (550 ms) or tapping a sold out one opens <Mono>SoldOutModal</Mono>{' '}
        (CheckActions.jsx). <Mono>setSoldOut()</Mono> only marks the tenant&apos;s own dishes: one
        in a menu&apos;s draft, or on a release that isn&apos;t cancelled (a dish taken out of the
        draft is still on the live menu until publish), else 404 "Dish not found". Putting a
        dish back on (false) is allowed for any id, so a stray row can always be cleared.
      </P>
      <InfoBox type="warn">
        A new place that marks dishes sold out must go through <Mono>setSoldOut()</Mono> and{' '}
        <Mono>announceSoldOut()</Mono>, or tills and screens keep showing the dish until their
        next config refresh (up to 10 minutes on a till, a minute on a screen).
      </InfoBox>

      <H3>Designer grid and colours</H3>
      <P>
        <Mono>GridLines</Mono> in <Mono>ScreenDesigner.jsx</Mono> draws the snap grid as an SVG
        beside the board, in screen pixels (one line every <Mono>grid</Mono> board px, times the
        smallest whole number that keeps lines 10 px apart at the current zoom; every fifth line
        darker; <Mono>z-index</Mono> 3, under the wall guides and the selection, no pointer
        events). It used to be a 1px CSS gradient inside the scaled board, which shrank to a
        fraction of a pixel at the usual 20-50% zoom and never showed. On / off is
        per device (<Mono>localStorage maca_screen_grid</Mono>).
      </P>
      <P>
        Board and block colours are <Mono>ColourField</Mono> (<Mono>components/screens/shared.jsx</Mono>),
        now a wrapper of the shared <Mono>ColourPicker</Mono> (<Mono>components/ColourPicker.jsx</Mono>):
        the website theme&apos;s colours from <Mono>GET /api/me</Mono>&apos;s{' '}
        <Mono>site_theme</Mono> (<Mono>useThemeColours()</Mono>, one swatch per distinct colour),
        then a custom colour (native colour input + typed <Mono>#rrggbb</Mono>). Boards store
        colour codes, so a theme pick is copied as its code: changing the website theme later
        doesn&apos;t change a board.
      </P>
      <P>
        See-through: <Mono>ColourPicker</Mono> / <Mono>ColourField</Mono> take <Mono>clear</Mono>, which
        adds <Mono>ClearSwatch</Mono> (a <Mono>CHECKER</Mono> background, <Mono>data-testid=&quot;colour-clear&quot;</Mono>)
        storing the word <Mono>transparent</Mono> (the code box takes it typed too). Used only on
        background fields: the board background (the designer frame shows <Mono>CHECKER</Mono> behind it),
        box colour, scrolling text background, order board <Mono>ready_bg</Mono> / <Mono>preparing_bg</Mono>
        (<Mono>colour()</Mono> in <Mono>shared/screenLayout.js</Mono> already passes <Mono>transparent</Mono>,
        and <Mono>withAlpha()</Mono> keeps it); kiosk design colours in <Mono>CLEAR_COLORS</Mono>
        (<Mono>surface</Mono>, <Mono>primary</Mono>, <Mono>accent</Mono>; <Mono>normaliseDesign()</Mono> drops
        <Mono>transparent</Mono> on any other colour, including the bottom bar and side menu colours, which
        follow when not set). The kiosk sets <Mono>--k-sheet</Mono> (the page colour
        when cards are see-through) for <Mono>.k-sheet</Mono>, and the designer&apos;s readability check
        reads a see-through colour as the page (<Mono>solidColours()</Mono>).
      </P>
    </section>
  )
}
