// src/pages/docs/menus.jsx
// The Docs page's "Menus" section. Docs.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, Mono, DataTable, InfoBox } from './parts.jsx'

export const id = 'menus'
export const label = 'Menus'
export const order = 390

export function Section() {
  return (
    <section id="menus" data-doc="">
      <H2>Menus</H2>
      <P>
        Structured menu manager (migration 048) — <Mono>menus</Mono> →{' '}
        <Mono>menu_sections</Mono> → <Mono>menu_items</Mono>, with an admin bulk-upsert
        PATCH rewriting the whole tree per save (delete + re-insert under the{' '}
        <Mono>menu_id</Mono> — acceptable since only one admin edits a menu at a time).
        Renders on the website via the <Mono>menu_inline</Mono> block, and standalone as a
        printable page at <Mono>GET /api/menus/:id/print</Mono>.
      </P>
      <P>
        <Mono>DELETE /api/menus/:id</Mono> calls <Mono>forgetMenu()</Mono> in the same
        transaction: the id comes out of <Mono>ordering_settings.menu_ids</Mono>,{' '}
        <Mono>pos_revenue_streams.menu_ids</Mono> and{' '}
        <Mono>deliveroo_settings.menu_ids</Mono> (uuid arrays with no foreign key); its{' '}
        <Mono>menu_times</Mono> rows go by their foreign key (migration 230). Before
        migration 222, which cleared the ids left behind, a stale id was sent back unseen by
        Ordering setup and every save failed with "A chosen menu wasn't found". The ordering
        and Deliveroo settings reads also return only menus their page lists, and the
        revenue stream window drops ids it doesn't list.
      </P>
      <H3>Reading a menu from files</H3>
      <P>
        <Mono>/api/ai/menus</Mono> (<Mono>routes/menuImport.js</Mono>, under /api/ai for the 5-minute proxy timeout).{' '}
        <Mono>POST /read</Mono> (menus manage + ai_assistant view, Pepper on) takes up to 10 files (multipart, kind
        from the first bytes: images up to 5 MB each, PDFs up to 10 MB, 20 MB in all), an optional hint and{' '}
        <Mono>venue_id</Mono> (the tenant's, else 404), and calls <Mono>readMenu()</Mono> in{' '}
        <Mono>services/menuReadAi.js</Mono>: one streamed call to the main model (<Mono>AI_MODEL</Mono>, effort
        medium, <Mono>max_tokens</Mono> 32,000) with the files as image / document blocks, the tenant's allergen and
        dietary tags, option groups and currency, and structured output (<Mono>MENU_SCHEMA</Mono>: sections, dishes
        with a price string, calories, allergens with a level, dietary, options by group with base or extra prices).
        Counted with <Mono>addUsage()</Mono> after <Mono>chatUnitsLeft()</Mono> / <Mono>personUnitsLeft()</Mono>.
        A refusal, a cut-off answer (max_tokens: "a few pages at a time") or no dishes is a 422; Claude busy is a 503.{' '}
        <Mono>toSections()</Mono> turns the answer into <Mono>create_menu</Mono>'s sections (<Mono>readPrice()</Mono>{' '}
        reads "£12.50" and "12,50"; a dish priced by base options loses its own price). Nothing is saved.
      </P>
      <P>
        <Mono>POST /import</Mono> (menus manage) takes the reviewed menu (<Mono>{'{ name, venue_id?, tagline?, service_times?, sections }'}</Mono>,
        up to <Mono>MAX_IMPORT_DISHES</Mono> 600 dishes) and runs <Mono>createMenuFromSections()</Mono> from{' '}
        <Mono>ai/tools/menus.js</Mono> in process with a staff context (<Mono>staffContext()</Mono> in the route, built with <Mono>makeContext()</Mono>): the same plan as
        Pepper's <Mono>create_menu</Mono> without its 50-dish batch limit (<Mono>planCreate(ctx, input, {'{ batch: false }'})</Mono>).
        Tags are matched to existing ones only; an option group whose existing choices don't cover the menu's gets a new group
        named "group (menu name)". The menu is made unpublished through <Mono>POST /api/menus</Mono> + the whole-tree PATCH,
        audited as <Mono>import_menu</Mono>. Admin: <Mono>components/menus/MenuImport.jsx</Mono> (files, review, done;{' '}
        <Mono>MenuImportModal</Mono> on the Menus page, embedded in the wizard's Menu step). Tests:{' '}
        <Mono>api/test/menu-import.test.mjs</Mono>.
      </P>
      <H3>Option group display names</H3>
      <P>
        <Mono>menu_variant_groups.display_name</Mono> (migration 198, text, NULL = the name): what guests and the tills
        see. The body's <Mono>display_name</Mono> is trimmed, empty = NULL, left out of a PATCH = unchanged, copied
        by <Mono>/copy</Mono>. <Mono>attachVariantGroupsToItems()</Mono> puts it on an attached group only when
        set; <Mono>releaseContent()</Mono> stores it as the group's <Mono>name</Mono> (<Mono>shownGroup()</Mono> in{' '}
        <Mono>shared/menuDiff.js</Mono>), so every reader of a published menu (online ordering, website blocks, print,
        screens, tills, kiosks) shows it with no change of its own, and menus whose groups have none hash as before.
        Draft reads for guests (<Mono>loadMenuVersion(s)</Mono> with version draft: staging, preview links, kiosk
        draft previews) map it with <Mono>withShownGroupNames()</Mono>; the editor's <Mono>GET /api/menus/:id</Mono>{' '}
        reads <Mono>loadMenuFull()</Mono> straight (the group's own name, <Mono>display_name</Mono> beside it). The
        live group library (<Mono>tillConfig()</Mono>, <Mono>kioskConfig()</Mono> groups: nested groups) and the
        translation sources select <Mono>COALESCE(display_name, name) AS name</Mono>, so <Mono>group:&lt;id&gt;:name</Mono>{' '}
        translates the display name.
      </P>
      <H3>Option group looks and types</H3>
      <P>
        Migration 206 adds to <Mono>menu_variant_groups</Mono> the group's own kiosk look,{' '}
        <Mono>kiosk_tiles</Mono> (NULL | cards | round | oval | hexagon | plain, <Mono>TILE_STYLES</Mono>),{' '}
        <Mono>kiosk_pictures</Mono> (NULL | true | false: words only) and <Mono>kiosk_entrance</Mono> (NULL | none |
        appear | slide | bubble | deal, <Mono>ENTRANCE_KEYS</Mono>), beside <Mono>kiosk_display</Mono>; and{' '}
        <Mono>variation_type</Mono> (NULL | modification | side | addition, <Mono>VARIATION_TYPES</Mono> in{' '}
        <Mono>shared/procurement.js</Mono>): what the group does to the dish's recipe, for stock counts later (nothing
        reads it yet). <Mono>VariantGroupBody</Mono> takes all four as nullable enums; a PATCH that leaves one out keeps
        it (POST: NULL); <Mono>loadVariantGroups()</Mono> (<Mono>g.*</Mono>) lists them and <Mono>/copy</Mono> copies
        them. They aren't in <Mono>attachVariantGroupsToItems()</Mono>, so they never reach menu releases: like the
        rest of the group library they change straight away. <Mono>kioskConfig()</Mono>'s groups carry the three kiosk
        ones; <Mono>GET /api/pos/venues/:id/setup</Mono> returns <Mono>option_groups</Mono> (id, name,{' '}
        <Mono>display_name</Mono>, the four kiosk columns) for the kiosk design editor.
      </P>
      <P>
        A kiosk design can give groups a look of its own: <Mono>options.group_looks</Mono>,{' '}
        <Mono>[{'{ group_id, display, tiles, pictures, entrance }'}]</Mono>, each part NULL = not set here
        (<Mono>normaliseDesign()</Mono>: one row per group, up to 200, unknown values NULL, a row with nothing set
        kept; <Mono>ownDesign()</Mono> keeps only the tenant's own groups). <Mono>groupLook(design, group)</Mono> in{' '}
        <Mono>shared/kiosk.js</Mono> is the one rule, part by part: the design's look for the group, else the group's
        own, else the design's for every choice (<Mono>options.display</Mono>, <Mono>layout.option_tiles</Mono>,{' '}
        <Mono>layout.option_pictures</Mono>, <Mono>options.entrance</Mono>); a null group (combo steps, a dish's
        one-off options) gets the design's. The kiosk: <Mono>OptionGroup.jsx</Mono> takes the display and entrance from
        it and <Mono>choiceLook(design, group)</Mono> (<Mono>displays.jsx</Mono>) the display's tiles and pictures, and
        wraps the display in <Mono>.k-choices.k-opts-&lt;tiles&gt;</Mono> with <Mono>data-enter</Mono> and{' '}
        <Mono>data-tiles</Mono>; a combo step's page and its tab's thumbs carry the design's (the tab's: the first
        picked group's). The root no longer has <Mono>.k-opts-*</Mono> (it keeps <Mono>data-option-tiles</Mono> and
        the design's <Mono>data-enter</Mono>): a choice's picture style comes from the one choices container above it
        (a group an option opens renders after its parent's container, not in it). Entrances: every{' '}
        <Mono>[data-enter]</Mono> sets <Mono>--k-enter-name</Mono>, <Mono>--k-enter-ms</Mono> and{' '}
        <Mono>--k-enter-step</Mono>, which the choices inherit, so the nearest one wins. Corner pictures carry their
        group's style themselves: <Mono>pickImages()</Mono>' corner entries are{' '}
        <Mono>{'{ src, scale, tiles }'}</Mono> and <Mono>CornerPicks</Mono> sets <Mono>data-tiles</Mono>, which kiosk.css
        keys on. Admin: <Mono>GroupLooks</Mono> in <Mono>KioskDesigner.jsx</Mono> (Choices: add a group, a select per
        part whose empty choice names the default, Group: or Design:), <Mono>LookRow</Mono> and the Recipe and
        stock box in <Mono>VariantGroupsManager.jsx</Mono>. Tests: <Mono>shared/test/kiosk.test.mjs</Mono>,{' '}
        <Mono>api/test/option-group-look.test.mjs</Mono>.
      </P>
      <H3>Copying dishes, sections and option groups</H3>
      <P>
        Dishes and sections are copied in the editor's draft (<Mono>Menus.jsx</Mono>), nothing on the server until
        Save changes: <Mono>copyOfDish(item, {'{ id, rename, map }'})</Mono> is a <Mono>structuredClone</Mono> with a
        new uuid and "(copy)" on the name, a combo's step and choice ids made fresh with <Mono>when</Mono> following
        them (as <Mono>remapCombo()</Mono> does for <Mono>/duplicate</Mono>), and choices' <Mono>item_id</Mono> /{' '}
        <Mono>section_id</Mono> moved through <Mono>map</Mono>. <Mono>copyOfSection()</Mono> maps the section and
        each dish to new ids first, so a combo in a copied section offers the copy's dishes and section; dish names
        stay. The copy goes just after the original (<Mono>copyItem()</Mono> in <Mono>SectionEditor</Mono>,{' '}
        <Mono>copySection()</Mono> in <Mono>SectionsPanel</Mono>, <Mono>copyItemAt()</Mono> /{' '}
        <Mono>copySectionAt()</Mono> in <Mono>MenuEditor</Mono> for the panels' Copy) and is selected. Per-dish
        option prices come along in either shape (<Mono>overridesOf()</Mono> reads both). Not copied: translations
        (keyed by id), sold out, print design placement. The dish panel's <Mono>copy-options-from</Mono> list
        (<Mono>copyOptionsFrom()</Mono>) takes another dish's <Mono>variant_groups</Mono> with its overrides: groups
        this dish has keep their place and take the other dish's prices, new ones follow.
      </P>
      <H3>A dish's own options (menu_item_variants) on the Menus page</H3>
      <P>
        Options added to one dish directly (<Mono>menu_item_variants</Mono>: the sample menus in{' '}
        <Mono>services/menuSeeds.js</Mono>, older menus, imports, the API) are asked first, as the choice
        {' '}<Mono>key: 'variants'</Mono>, name Choose, base price, pick one (<Mono>itemChoices()</Mono>), with ids{' '}
        <Mono>v:&lt;label&gt;</Mono> (<Mono>variantOptionId()</Mono>) because the rows are re-inserted with new ids
        on every save. Until Oct 2026 the Menus page's save payload sent <Mono>variants: []</Mono> for every dish,
        so saving a menu deleted them, and with them any meal deal rule on them (<Mono>cleanDealGroups()</Mono>{' '}
        keeps a choice's <Mono>groups.variants</Mono> only while the dish has own options). The payload now sends
        them back (label, price, place), as <Mono>menuSaveBody()</Mono> does; <Mono>contentKey()</Mono> ignores
        their ids, so this is never a change to publish.
      </P>
      <P>
        They can't be edited on the page (new options come from option groups). <Mono>OwnOptionsCard</Mono> lists them
        in the dish panel above the attached groups; <Mono>ItemRow</Mono> shows an amber badge
        (<Mono>dish-own-options</Mono>). <strong>Turn into an option group</strong>: <Mono>sameAsOwnOptions()</Mono>{' '}
        looks for a library group asking the same thing (base, min 1 / max 1, no repeat, not on request, no nested
        groups, the same labels ignoring case and spaces) that isn't on the dish, the one with the fewest price
        differences; else <Mono>POST /api/menus/variant-groups</Mono> makes one (name: the labels joined with " / ",
        cut to 80; <Mono>display_name</Mono> Choose, so tills, kiosks and online ordering show the same heading;
        the website and print now show a group heading above them), added to the{' '}
        <Mono>['menu-variant-groups']</Mono> cache at once. <Mono>ownOptionPrices()</Mono> gives the dish's prices as
        overrides and a map <Mono>v:&lt;label&gt;</Mono> {'->'} the group's option id, and{' '}
        <Mono>withOwnOptionsAsGroup()</Mono> (in the draft) puts the group first among the dish's groups (own options
        were asked first), clears the own options and moves meal deal rules on them with{' '}
        <Mono>moveDealGroup()</Mono> (<Mono>shared/combos.js</Mono>): a choice of the dish loses its{' '}
        <Mono>variants</Mono> entry, a choice of its whole section keeps it too for the section's other dishes.{' '}
        <strong>Remove</strong> (inline confirm) sets <Mono>variants: []</Mono>. Tests:{' '}
        <Mono>api/test/own-options.test.mjs</Mono>, the <Mono>moveDealGroup</Mono> test in{' '}
        <Mono>shared/test/dealOptions.test.mjs</Mono>.
      </P>
      <P>
        <strong>Phone layout.</strong> A dish row's name has <Mono>min-w-[7rem]</Mono> and a section heading's title{' '}
        <Mono>min-w-[8rem]</Mono> in rows that wrap (<Mono>flex-wrap</Mono>), with the badges, price and buttons in one
        group (<Mono>ml-auto</Mono>): where the row is too narrow for both (a phone, a tablet with a panel open), the
        group goes onto a second line instead of squeezing the name to nothing. The dish and section panels
        (<Mono>SIDE_PANEL</Mono>) sit beside the list from md up and are full-screen sheets below
        (<Mono>max-md:fixed inset-0 z-50</Mono>). The top bar wraps, its buttons are icons only below sm
        (<Mono>TOP_BTN</Mono>) and the top Save is hidden there (the bottom bar saves). The menus{' '}
        <Mono>Card</Mono> (<Mono>components/menus/shared.jsx</Mono>) wraps its header button under the title and has
        less padding on a phone.
      </P>
      <P>
        <Mono>POST /api/menus/variant-groups/:id/copy</Mono> (menus manage, tenant filtered, 404 otherwise) copies the
        group row and its options generically (every column but id and timestamps, so a new column comes along without
        a code change), names it "name (copy)" (name cut to fit 80), moves later groups' <Mono>sort_order</Mono> down
        one and puts the copy right after the original. An option whose <Mono>child_group_id</Mono> is the group itself
        points at the copy. <Mono>menu_translations</Mono> rows for the options (<Mono>option:&lt;id&gt;:label</Mono>,{' '}
        <Mono>:description</Mono>) and the scale words (<Mono>group:&lt;id&gt;:scale_low</Mono> / <Mono>scale_high</Mono>)
        are copied to the new ids; the name's isn't (the name changed). No dish is attached. The Variant groups page
        opens the copy in its editor (<Mono>VariantGroupsManager.jsx</Mono>). Tests:{' '}
        <Mono>api/test/variant-group-copy.test.mjs</Mono>; the sweep's fixtures copy a group.
      </P>
      <P>
        <Mono>GET /api/menus/print-designs</Mono> (open to signed-in staff, like the other menu reads) lists every print design of the tenant with its menu
        (id, name, layout, menu_id, menu_name), for Brand &amp; theme's Use the brand on other designs.
      </P>
      <H3>Publishing: draft and live (migration 165)</H3>
      <P>
        The menu tables are the <strong>draft</strong>: the Menus page, the allergen matrix, the
        menu designer and the AI change tools read and write them as before. What guests and
        devices see is the <strong>live</strong> version: the newest row of{' '}
        <Mono>menu_releases</Mono> for the menu whose <Mono>goes_live_at</Mono> has passed and
        that wasn&apos;t cancelled. A release is a frozen copy made by{' '}
        <Mono>releaseContent(loadMenuFull())</Mono> (<Mono>shared/menuDiff.js</Mono>) and never
        changes after insert, so <Mono>services/menuReleases.js</Mono> caches release content
        in memory by id.
      </P>
      <DataTable
        head={['Piece', 'What it does']}
        rows={[
          ['menu_releases', 'tenant_id, menu_id (cascade), snapshot jsonb, content_hash, goes_live_at, note, published_by, created_at, cancelled_at / cancelled_by, announced_at. A future goes_live_at = scheduled. Live = DISTINCT ON (menu_id) ... ORDER BY goes_live_at DESC, created_at DESC among non-cancelled rows with goes_live_at <= now(). RLS.'],
          ['menu_preview_links', 'An hour-long link (id) to print the draft (release_id null) or a given release on the public print page, which has no login. POST /api/menus/:id/preview-link returns the path; GET /:id/print?preview=<id> prints it (410 once expired, Cache-Control private).'],
          ['menus.needs_first_release', 'Set by the migration for every menu that existed. backfillFirstReleases() (server.js, at start-up) publishes their current draft once, so nothing disappears on deploy. New menus start without a release: not live anywhere until published.'],
          ['releaseContent() / contentKey()', 'What a release keeps (sections, dishes, prices, option prices with variant_groups resolved, dietary codes, allergen_levels, till fields, footer notes, menu settings incl. is_published and venue_id) and a stable string to compare two versions. Left out (tenant-wide, always current): the tag list, the allergen notice, print designs and print_design_id, timestamps. An attached group goes in by its display name (shownGroup(): display_name as name, migration 198), so a new display name is a change to publish; diffMenus() lists a group renamed that way as the dish\'s options changing. contentKey ignores one-off option ids (re-made on every save), nested sort_order numbers (the array order says it), key order, null vs missing and numeric strings.'],
          ['diffMenus(live, draft)', 'The change list the editor and the AI publish card show: [{ kind, text }], kind menu | section | added | removed | price | options | dish | notes.'],
          ['loadMenuVersion() / loadMenuVersions()', 'The one way to read what guests see: loadMenuFull()-shaped, version live (default), draft, or a releaseId; with the tenant\'s current tags, notice and print design attached. loadMenuVersions() filters on the version\'s own venue_id and is_published (publishedOnly).'],
          ['publishAllergens() / allergenStatus()', 'Allergens and dietary tags only (the Allergen matrix): a release now from the live content with the draft\'s dish tags (withDraftTags()), for every menu; scheduled releases get a copy with the new tags and are cancelled. See Menus, Allergen matrix.'],
          ['publishMenu()', 'Snapshot the draft. at empty or within 30 seconds = now; at most 400 days ahead. 422 when the hash equals the live one. Immediate publishes set announced_at and the route calls announceMenus().'],
          ['announceDueReleases()', 'Run every minute by the hold sweep (jobs/hold-sweep.js): marks releases that went live since the last run as announced and calls announceMenus(): tillsMayNeedConfig() plus a menus.live broadcast on the menus:<tenantId> room for screens.'],
          ['Routes', 'GET /api/menus?status=1 (publish per menu: live_at, scheduled_at, scheduled_count, changed); GET /:id?version=live; GET /:id/publish (live, scheduled, in_sync, changes, history); POST /:id/publish { at?, note? } (manage); DELETE /:id/releases/:releaseId (cancel a future one, manage); POST /:id/releases/:releaseId/restore (copy a release into the draft with restorableBody() + writeMenu(), manage); POST /:id/preview-link { release_id? }; GET /:id/allergens?version=live.'],
          ['Admin (components/menus/MenuPublish.jsx)', 'PublishButton, beside Save in the menu editor\'s top bar: a badge with the number of changes in GET /:id/publish (a dot when there is no live version, a clock when one is scheduled), filled while changes wait and the editor is saved; it opens PublishWindow (portal into document.body: the bar\'s backdrop blur would make a fixed window fixed to the bar), whose PublishContent is the old card: changes, Publish now / Schedule / Preview print / Discard changes, scheduled publishes, history. Both read the query [\'menu-publish\', id], which the editor\'s Save invalidates. PublishBadges on the Menus list.'],
        ]}
      />
      <DataTable
        head={['Reader', 'Version']}
        rows={[
          ['Website menu_inline block (loadInlineMenus in siteDataSvc.js)', 'Live; a staging host passes draft: true. Shown-to-guests and section visibility come from the version.'],
          ['GET /api/menus/public/:menuId', 'Live, 404 unless the live version is shown to guests.'],
          ['GET /api/menus/:id/print (incl. ?view=dietary, ?design=)', 'Live; ?preview=<link> prints the draft or a release. The Menus list prints live (or a draft preview for a menu never published); the editor and the designer print the draft through preview links.'],
          ['Online ordering (loadOrderingMenu in orderSvc.js)', 'Live, so order prices and dishes match what is published.'],
          ['Till config (tillMenus in posSvc.js)', 'Live: the menus named by revenue streams, else the venue\'s live menus shown to guests. Each item carries its tax levels [dish, section, menu] trimmed to the venue.'],
          ['Deliveroo (loadDishes / loadSetup in routes/deliveroo.js)', 'Live; no menus picked = live menus shown to guests. Matches to a live dish removed from the draft still save.'],
          ['Cooking check dish buttons (loadCookingPicker)', 'Live. POST /food-safety/cooking with a live dish gone from the draft logs its name with menu_item_id null.'],
          ['Allergen lookup (AllergenLookup)', 'Live (menus with a live version only). The Allergen matrix editor stays on the draft.'],
          ['AI menu tools', 'get_menu draft unless version live; find_dishes live (draft with include_unpublished for menus never published); change tools write the draft; publish_menu and cancel_menu_publish publish.'],
          ['Draft readers (unchanged)', 'Menus page, allergen matrix editor, menu designer (GET /:id/design), Promotions and Store tech dish pickers, Ordering setup and sold-out lists.'],
        ]}
      />
      <InfoBox type="warn">
        A new place that shows a menu to guests or devices must read it through{' '}
        <Mono>loadMenuVersion()</Mono> / <Mono>loadMenuVersions()</Mono>, never{' '}
        <Mono>loadMenuFull()</Mono> or its own SQL on the menu tables, or it shows unpublished
        changes. Option groups (the Variant groups library), tags, the allergen notice and print
        designs are tenant-wide and stay live: a dish&apos;s own option prices are in the
        release, but the till reads nested option groups from the library.
      </InfoBox>
      <H3>Menu times (migration 230)</H3>
      <P>
        One table per venue of when each menu is on, on the website (online ordering), the self-order
        kiosks and the tills: Menus &gt; Menu times (<Mono>pages/MenuTimes.jsx</Mono>,{' '}
        <Mono>/menus/times</Mono>; the migration adds the link first under every group&apos;s Menus,
        with the same hidden roles). <Mono>shared/menuTimes.js</Mono> is the one set of rules for the
        API, the page, the till and the kiosk; the schedules themselves are{' '}
        <Mono>shared/menuSchedule.js</Mono>&apos;s (<Mono>menuOnAt()</Mono>, <Mono>scheduleLabel()</Mono>,
        the new <Mono>scheduleError()</Mono>).
      </P>
      <DataTable
        head={['Piece', 'What it does']}
        rows={[
          ['menu_times', 'PK (venue_id, menu_id), tenant_id (forced RLS), times jsonb (the menu\'s own schedule, NULL = any time), web / kiosk / till jsonb cells { use: off | menu | always | own, times }, updated_at, updated_by. Menu or venue deleted: the rows go (foreign keys). No row: the menu is on the tills and kiosks at any time. The website\'s on / off is ordering_settings.menu_ids, so a stored web cell is never off (switched off, it keeps what it said for when it goes back online).'],
          ['Cells', "use menu = the menu's own times, always = any time on that channel, own = the cell's own times, off = not on that channel. channelTimes(row, channel) is the only reader: a schedule, null for any time, false for off."],
          ['GET /api/menu-times/venues/:venueId', 'Menus view. { venue, menus, rows, ordering, streams, devices, warnings }: menus the venue can use (shared ones and its own, with own, is_published and live: a release already live), a row for each with the usual cells filled in (web.use off when the menu isn\'t online), whether online ordering is set up and on, the active revenue streams with their menu_ids, how many tills and kiosks the venue has ({ till, kiosk }), menuTimesWarnings().'],
          ['PUT /api/menu-times/venues/:venueId', "Menus manage. { rows: [{ menu_id, times, web, kiosk, till }] }, the rows sent only (others left alone). A menu the venue can't use 422, twice 400; menuTimesProblems() 422 with code menu_times and problems; a row that says nothing beyond the usual is deleted. The web cells rewrite ordering_settings.menu_ids (the menus already online that stay on in their order, then the new ones; at most 20). Broadcasts pos.config to the venue's tills and kiosks."],
          ['shared/menuTimes.js', 'CHANNELS, USES, cleanSchedule() / cleanCell() / cleanRow(), isDefaultRow(), channelTimes(), channelLabel(), timesLabel(), menusOnNow(menus, parts) (menus as { id, times } at venue-local parts), tillMenusShown(menus, parts, pick), nextStart(menus, parts), menuTimesProblems(rows, names) (what stops a save: a bad date range, a time with no days or ending before it starts, a schedule\'s own times overlapping), menuTimesWarnings(rows, names, today) (two menus on at once on a channel, from today on: notes only, both show).'],
          ['services/menuTimesSvc.js', 'loadMenuTimes(tx, tenantId, venueId) (stored rows, tidied), channelMenuTimes(tx, tenantId, venueId, channel) ({ menuId: times | false }, menus with no row left out: read it with ?? null), webSchedules(tx, venueId) (online ordering\'s schedules, see Web Ordering > Menu times online).'],
          ['Device configs', "tillMenuData(..., { channel }) with 'till' in tillConfig() and 'kiosk' in kioskConfig(): a menu off there is left out, every other menu carries times (null = any time). The times are part of the config (not liveFields()), so a change reaches devices through the pos.config push or the content pull."],
          ['Store openings', 'A copied location\'s online ordering (storeSetup.js) copies the template\'s menu_times rows for the shared menus.'],
        ]}
      />
      <P>
        <strong>The till</strong> (<Mono>pos/src/lib/tillMenus.js</Mono>): <Mono>useShownMenus(config, menuIds)</Mono>{' '}
        takes the check&apos;s revenue stream menus (<Mono>streamMenus()</Mono>), works out the venue-local time
        (<Mono>tillNow()</Mono>, the venue&apos;s time zone) every 30 s (<Mono>useTick</Mono>) and returns{' '}
        <Mono>{'{ menus, shown, ids, auto, onNow, basis, none, pick(ids), follow() }'}</Mono> from{' '}
        <Mono>tillMenusShown()</Mono>: the menus on now, every menu when none is on, or the till&apos;s pick (prefs{' '}
        <Mono>menu_pick</Mono> <Mono>{'{ ids, basis }'}</Mono>; the basis is the day and the ids on now, so the
        pick lapses by itself when they change, and the hook clears it). <Mono>MenuPanel</Mono> has no menu chips
        any more (its tabs are the sections of the menus shown), and <Mono>LayoutScreen</Mono> takes{' '}
        <Mono>menus</Mono> (shown) and <Mono>tillMenus</Mono> (all of them): a categories zone with sections picked
        shows those of the menus shown, falling back to the picked ones when none of them is.{' '}
        <Mono>components/MenusModal.jsx</Mono> is the pick, opened from More (<Mono>ActionsMenu</Mono>&apos;s{' '}
        <Mono>menus</Mono> prop and <Mono>menusHint()</Mono>, only with more than one menu), the counter&apos;s{' '}
        <Mono>counter-menus</Mono> button and the till layout button action <Mono>menus</Mono>{' '}
        (<Mono>BUTTON_ACTIONS</Mono>, no order needed, group Till) in <Mono>runButton()</Mono> of Check.jsx and
        Counter.jsx.
      </P>
      <P>
        <strong>The kiosk</strong> (<Mono>pos/src/kiosk/store.js</Mono>): <Mono>state.menuIds</Mono> holds the
        visit&apos;s menus (null = every menu: previews, share links and replays), set at boot,{' '}
        <Mono>startOrder()</Mono> and <Mono>restart()</Mono> from <Mono>menusOnNowFor(config, preview)</Mono>;{' '}
        <Mono>refreshMenus()</Mono> runs every 30 s and after a new config, on the start screen only, so a guest
        mid-order keeps their menus. <Mono>kioskSections(config, menuIds = state.menuIds)</Mono>,{' '}
        <Mono>kioskItemIds()</Mono> and <Mono>itemOffNow(config, id, menuIds)</Mono> (home page featured tiles,
        banner links, &ldquo;Anything else?&rdquo; dishes) and <Mono>countFor(config, prefs, menuIds)</Mono>{' '}
        (the allergens count) all use it. <Mono>noMenuOn(s)</Mono> closes ordering (<Mono>orderingClosed()</Mono>{' '}
        in Start.jsx shows the <Mono>k-closed</Mono> card with <Mono>data-why=&quot;menus&quot;</Mono>) and{' '}
        <Mono>nextMenuAt(config)</Mono> says when it opens; words <Mono>no_menu_title</Mono>,{' '}
        <Mono>no_menu_back_at</Mono>, <Mono>no_menu_later</Mono> in the nine languages. A journey&apos;s playback
        uses <Mono>kioskSections(config, null)</Mono>.
      </P>
      <P>
        <strong>Admin</strong>: <Mono>MenuTimes.jsx</Mono> keeps the whole venue as a draft (venue in{' '}
        <Mono>maca_menu_times_venue</Mono>), a table from md (<Mono>mt-table</Mono>) and cards below
        (<Mono>mt-cards</Mono>), a select per cell (<Mono>mt-cell</Mono>, Own times opening the times window,
        which is <Mono>ScheduleEditor</Mono> with <Mono>alwaysOpen</Mono>), problems that disable Save and notes
        that don&apos;t, and one Save for the table. Ordering setup&apos;s Menus card only lists{' '}
        <Mono>online_menus</Mono> with a link to Menu times.
      </P>
      <H3>Schema (relevant to this section)</H3>
      <DataTable
        head={['Table / column', 'Purpose']}
        rows={[
          ['menu_items.calories', 'Migration 094. Nullable int (kcal), CHECK >= 0. Shown next to the price wherever price is shown — website block, print, and the page-builder canvas preview.'],
          ['menus.print_settings', 'Migration 120. jsonb, default {}. Optional keys: font_scale (int 70-150, %), margin_mm (3-25, null = 8mm/12mm), repeat_header (first | compact | full), repeat_footer, page_numbers, keep_sections (bools), variant_columns (1-3: variant label + price pairs per row, .variants grid of .variant pairs). Zod PrintSettings in menus.js strips unknown keys; written with tx.json(). A missing key keeps the original layout.'],
          ['menu_sections.print_break_before / print_keep_together', 'Migration 120. none | column | page (CHECK), and a boolean. Print only: the website menu_inline block and the canvas ignore them.'],
          ['menus.tax / menu_sections.tax / menu_items.tax', 'Migration 170 (replaced the dish and section vat_rate_takeaway / vat_rate_eat_in columns of migrations 122 and 127). jsonb { rate, rules: [{ venues, streams, types, rate }] }, {} = not set. Edited with TaxBox (components/menus/TaxBox.jsx) in the menu Settings, SectionDrawer and ItemDrawer; checked by checkMenuTax() on save (422 on the first problem) and by taxSettingProblems() in the page (Save off). Part of the release (menuDiff.js), so a tax change goes live on publish. See Tax, Order Types & Streams.'],
          ['menu_dietary_tags (admin page)', 'Route /menus/dietary-tags (MenuDietaryTags.jsx, DietaryTagsManager.jsx), titled Allergens & dietary tags since migration 145 (which also renames the default nav label from Dietary tags). Two Cards, Allergens and Dietary tags, each a drag-sortable list (SortableRows, PATCH /menus/dietary/reorder { ids }). Add and edit use one modal (TagModal: type, label, glyph, code, colour) calling POST /menus/dietary and PATCH /menus/dietary/:id; merge (POST /menus/dietary/:id/merge { into_id }) and delete are in the modal with inline confirms. An amber bar offers POST /menus/dietary/standard-allergens when any of the 14 is missing.'],
          ['menu_dietary_tags.kind / standard_key', 'Migration 145. kind dietary | allergen (default dietary). standard_key = which of the 14 UK allergens the tag is (celery, gluten, crustaceans, eggs, fish, lupin, milk, molluscs, mustard, nuts, peanuts, sesame, soya, sulphites), unique per tenant, only on allergens. The migration turns existing tags that match one by code or exact label (n / Nuts, Dairy, Soy...) into that allergen, then inserts the ones each tenant is missing. A standard allergen cannot become a dietary tag (PATCH 422).'],
          ['menu_dietary_tags.show_on_menu', 'Migration 146. Boolean, default true. Off = staff-only: left out of every guest surface, kept in the matrix, lookup and menu editor. TagModal On menus Show / Hide; the tags page marks the row Not on menus.'],
          ['menu_dietary_tags.in_key', 'Migration 147. Boolean, default true (new tags are in the key). Whether the allergen notice key lists the tag. Written only by PUT /menus/allergen-notice (key_tag_ids sets every tag of the tenant). A tag with show_on_menu off is never listed, whatever in_key says.'],
          ['menu_allergen_notice', 'Migration 147. One row per tenant (tenant_id PK, RLS): title, body, removable_note (explains the asterisk), ordering_text (online ordering only), used_only (key lists only ticked tags the dishes use). No row = DEFAULT_NOTICE in shared/menuTags.js. Seeded from each tenant\'s first allergens footer note.'],
          ['menu_item_dietary.level', 'Migration 145. contains | may_contain | removable (default contains); no row = the dish does not have it. Dietary tags are always contains: tagLevel() in menus.js forces it on every write, and turning an allergen into a dietary tag resets its links to contains.'],
          ['menu_sections.image_url', 'Migration 095. Nullable text (a Media library URL). A small category icon/image next to the section heading — capped at 1.3em (website block / canvas) or 1.6em (print) so it never renders larger than the heading font next to it, regardless of the uploaded image\'s actual resolution.'],
        ]}
      />
      <InfoBox type="info">
        Both are plain nullable columns with no companion "show/hide" toggle — they render
        automatically whenever set, the same way <Mono>notes</Mono> and{' '}
        <Mono>image_url</Mono> (dish photo) already work. Don't add a per-menu visibility
        toggle unless asked; that would be new scope, not what these migrations do.
      </InfoBox>
      <InfoBox type="warn">
        Printing drops background colours unless an element opts in with{' '}
        <Mono>print-color-adjust: exact</Mono> (plus the <Mono>-webkit-</Mono> form). Both print
        layouts set it on the dietary tag chips and the tinted boxes: <Mono>.tag-chip</Mono>,{' '}
        <Mono>.section.highlight</Mono>, <Mono>.item.featured</Mono>, <Mono>.menu-intro</Mono> in{' '}
        <Mono>menu_print.eta</Mono>, and <Mono>.ml-tag</Mono>, <Mono>.ml-item.featured</Mono>,{' '}
        <Mono>.ml-box-tint</Mono>, <Mono>.ml-intro</Mono> in <Mono>shared/menuLayout.js</Mono>. The
        page background is left out on purpose. A new coloured element meant to print needs the
        same rule; the on-screen preview always shows colours, so only a real print or PDF shows
        the problem.
      </InfoBox>
      <H3>Touch points for any new menu_items / menu_sections field</H3>
      <P>
        Because the whole tree is rewritten on every save, a new column needs updating in
        (all in <Mono>api/src/routes/menus.js</Mono> unless noted): the Zod{' '}
        <Mono>ItemBody</Mono>/<Mono>SectionBody</Mono> schema, the{' '}
        <Mono>loadMenuFull()</Mono> SELECT's <Mono>jsonb_build_object</Mono> (items only —
        sections use <Mono>SELECT s.*</Mono> so a new section column needs no query change),
        the <Mono>upsertMenuTree()</Mono> INSERT, and <Mono>menuSaveBody()</Mono> (the
        loaded-menu-to-PATCH-body copy used by <Mono>/:id/duplicate</Mono> and every AI menu
        tool: a field missing there is wiped whenever the assistant changes that menu). On the
        frontend (<Mono>admin/src/pages/Menus.jsx</Mono>):
        the new-item/new-section default object, the editor form field, and the explicit
        field whitelist in the save-payload builder (it does not spread <Mono>...item</Mono>
        — omitting a field there silently drops it on save even though the editor state has
        it). On the render side: <Mono>api/src/views/site/blocks/menu_inline.eta</Mono>{' '}
        (website), <Mono>api/src/views/menu_print.eta</Mono> (print), and{' '}
        <Mono>admin/src/components/website-builder/canvas/dataBlocks.jsx</Mono>'s{' '}
        <Mono>MenuInlineCanvas</Mono> (page-builder live preview) — the canvas/SSR-parity
        gotcha applies here same as the variant-visibility toggles: grep all three render
        sites, not just one, before considering a menu-item display change done.
      </P>
      <P>
        Pictures on the website block: block data <Mono>show_dish_photos</Mono> and{' '}
        <Mono>show_section_images</Mono> (default on, read as <Mono>!== false</Mono> so blocks
        saved before them keep their pictures; editor toggles Show dish photos / Show section
        pictures under Display, defaults in <Mono>blockRegistry.js</Mono>). Off, the{' '}
        <Mono>menu_inline.eta</Mono> partial and <Mono>MenuInlineCanvas</Mono> skip the dish{' '}
        <Mono>image_url</Mono> and the section heading picture. Block data only: no migration, the
        menu, online ordering, kiosks and print are unchanged.
      </P>
      <P>
        Dish order: each <Mono>SectionEditor</Mono> wraps its items in its own{' '}
        <Mono>DndContext</Mono> + <Mono>SortableContext</Mono> (Pointer, Touch and Keyboard
        sensors, <Mono>restrictToVerticalAxis</Mono> + <Mono>restrictToParentElement</Mono>),
        so a dish can only be dropped within its own section. <Mono>ItemRow</Mono> uses{' '}
        <Mono>useSortable</Mono> with the grip button as the activator, so tapping the row
        still opens the dish panel. The drop reorders the draft with <Mono>arrayMove</Mono>;
        the save payload's <Mono>sort_order</Mono> is the array index, so nothing server-side
        changed.
      </P>
      <P>
        A dish&apos;s option groups in the dish panel: <Mono>AttachedGroups</Mono> (its own{' '}
        <Mono>DndContext</Mono> + <Mono>SortableContext</Mono>, the same sensors and modifiers) and{' '}
        <Mono>AttachedGroupCard</Mono> (<Mono>useSortable</Mono> on the group id, the grip as the
        activator, <Mono>disabled</Mono> for View; <Mono>CSS.Translate</Mono> so cards of different
        heights aren&apos;t stretched). A drop reorders <Mono>item.variant_groups</Mono> with{' '}
        <Mono>arrayMove</Mono>; the save sends the index as <Mono>sort_order</Mono>{' '}
        (<Mono>menu_item_variant_groups</Mono>), which <Mono>attachVariantGroupsToItems()</Mono> orders
        by, so the order reaches the release (<Mono>menuDiff.js</Mono> compares{' '}
        <Mono>variant_groups</Mono> by position: &quot;options or option prices changed&quot;) and{' '}
        <Mono>itemChoices()</Mono> / <Mono>posChoices()</Mono> ask the groups in it. Cards start
        closed: <Mono>ItemDrawer</Mono> keeps <Mono>openGroups</Mono> (a Set of group ids) and the page
        keys it by the dish id, so every dish opens with all closed; <Mono>attachGroup()</Mono> opens
        the new group. The card&apos;s name is a <Mono>div role=&quot;button&quot;</Mono>{' '}
        (<Mono>aria-expanded</Mono>, Enter and Space), not a button: the panel is a disabled fieldset
        for View users, who must still open it to see the prices. Test ids <Mono>dish-groups</Mono>,{' '}
        <Mono>dish-group</Mono> (<Mono>data-group</Mono>, <Mono>data-open</Mono>),{' '}
        <Mono>dish-group-toggle</Mono>, <Mono>dish-group-summary</Mono>.
      </P>
      <H3>Print layout (menu_print.eta)</H3>
      <P>
        The print page is built from designed pages: sections are split into page groups
        wherever a section has <Mono>print_break_before = 'page'</Mono>, and each group
        renders as its own <Mono>.page</Mono> sheet (paper-sized, the same padding on screen
        and in print) with its header (full on page 1; later pages per{' '}
        <Mono>repeat_header</Mono>), its own multi-column <Mono>.cols</Mono>, and a{' '}
        <Mono>.page-bottom</Mono> pushed to the bottom by flex (callouts + footer line on the
        last page, or every page with <Mono>repeat_footer</Mono>, plus "Page x of y"). Column
        breaks are <Mono>break-before: column</Mono> (not on a page group's first section);
        keep-together is <Mono>break-inside: avoid</Mono> on the section. Font scale is a{' '}
        <Mono>--fs</Mono> CSS variable multiplied into every font size after the print bar.
      </P>
      <P>
        A small inline script measures each sheet after fonts load: a page taller than the
        paper gets a red <Mono>.fit-note</Mono> (screen only) with the excess in mm, the
        print bar shows a summary, and the page gets class <Mono>spills</Mono>, which drops
        its flex layout so the print engine can break it onto a second sheet (header and
        footer then only appear once). The check is skipped when the window is narrower than
        the page, since the screen layout then differs from print. Tested by rendering the
        template in headless Chromium and counting PDF pages: fitting designed pages give
        exactly one sheet each.
      </P>
      <H3>Allergens and dietary tags (migration 145)</H3>
      <P>
        Every tag is a dietary tag (on a dish or not) or an allergen (on a dish at a level:
        Contains, May contain, Can be removed). <Mono>shared/menuTags.js</Mono> holds the
        rules: <Mono>STANDARD_ALLERGENS</Mono> (the 14, also used by{' '}
        <Mono>ensureStandardAllergens()</Mono> in <Mono>services/menuSeeds.js</Mono>, called for
        new tenants in <Mono>POST /api/platform/tenants</Mono>, by the menu seed route and by the
        tags page button), <Mono>ALLERGEN_LEVELS</Mono>, <Mono>LEVEL_LABELS</Mono>,{' '}
        <Mono>REMOVABLE_NOTE</Mono>, <Mono>levelOf()</Mono>, <Mono>isRemovable()</Mono>,{' '}
        <Mono>menuTags()</Mono>, <Mono>hasRemovable()</Mono> and the allergen notice helpers{' '}
        <Mono>DEFAULT_NOTICE</Mono>, <Mono>noticeOf()</Mono> and <Mono>allergenKey()</Mono>{' '}
        (migration 147, below).
      </P>
      <P>
        In the menu tree a dish keeps <Mono>dietary</Mono> (codes of every tag it shows, both
        kinds, in tag order) and gains <Mono>allergen_levels</Mono>{' '}
        (<Mono>{'{ code: level }'}</Mono>, only levels other than contains).{' '}
        <Mono>loadMenuFull()</Mono>, the website loader (<Mono>loadInlineMenus()</Mono> in
        siteDataSvc.js) and <Mono>loadOrderingMenu()</Mono> all return it; <Mono>ItemBody</Mono>,{' '}
        <Mono>upsertMenuTree()</Mono>, <Mono>/duplicate</Mono> and the Menus.jsx save payload
        carry it. <Mono>upsertMenuTree()</Mono> also resolves a standard key as a code, so the
        seeds can say <Mono>nuts</Mono> for a tenant whose nuts tag is code <Mono>n</Mono>. Tag
        order: dietary tags first, then allergens, each by <Mono>sort_order</Mono> (the matrix
        API lists allergens first).
      </P>
      <P>
        On menus May contain looks the same as Contains and Can be removed adds a small
        asterisk inside the badge, with <Mono>* Can be removed on request</Mono> in the key.
        Six places draw the badges and must stay in step: <Mono>menu_print.eta</Mono>,{' '}
        <Mono>menu_print_dietary.eta</Mono>, <Mono>shared/menuLayout.js</Mono> (designed print
        and designer canvas), <Mono>blocks/menu_inline.eta</Mono>, <Mono>MenuInlineCanvas</Mono>{' '}
        in <Mono>dataBlocks.jsx</Mono>, and <Mono>shared/ordering.eta</Mono>. What the key
        under a menu lists, and the asterisk note&apos;s words, come from the allergen notice
        (below).
      </P>
      <P>
        Staff tools show the levels apart with <Mono>LevelChip</Mono> (AllergenMatrix.jsx):
        filled = Contains, outlined on a pale tint = May contain, filled with an asterisk = Can
        be removed. The dish panel in Menus.jsx (<Mono>AllergenPicker</Mono>) and the matrix
        cycle an allergen No, Contains, May contain, Can be removed; dietary tags toggle.
      </P>
      <P>
        Tags with <Mono>show_on_menu</Mono> off (migration 146) are dropped where guest data is
        loaded, so the six renderers above skip their codes (each already ignores a code with no
        tag): <Mono>loadPrintMenu()</Mono> (automatic and designed print, dietary list, and the
        designer, which draws what prints) and <Mono>GET /menus/public/:menuId</Mono> filter{' '}
        <Mono>dietary_tags</Mono> through <Mono>menuTags()</Mono>; <Mono>loadInlineMenus()</Mono>{' '}
        filters tags, dish codes and levels in SQL; <Mono>loadOrderingMenu()</Mono> filters tags,
        codes and levels; <Mono>MenuInlineCanvas</Mono> uses <Mono>menuTags()</Mono> itself because
        it reads the admin menu route. <Mono>allergenKey()</Mono> / <Mono>hasRemovable()</Mono> only
        count shown tags, so the asterisk note goes when the only removable allergen is hidden.{' '}
        <Mono>loadMenuFull()</Mono> and the matrix keep every tag.
      </P>
      <H3>Allergen notice (migration 147)</H3>
      <P>
        One notice per tenant, built in the <Mono>AllergenNoticeCard</Mono> on the Allergens &amp;
        dietary page (<Mono>DietaryTagsManager.jsx</Mono>): title, body, which tags its key lists
        (<Mono>menu_dietary_tags.in_key</Mono>), <Mono>used_only</Mono>, the asterisk note and an
        online-ordering line, with a preview and explicit Save / Discard. The draft keeps key ticks
        as changes over each tag&apos;s <Mono>in_key</Mono>, so a tag added meanwhile keeps its own
        value. API: <Mono>GET /api/menus/allergen-notice</Mono> (the notice through{' '}
        <Mono>noticeOf()</Mono>) and <Mono>PUT /api/menus/allergen-notice</Mono>{' '}
        (<Mono>requireRole(&apos;admin&apos;, &apos;owner&apos;)</Mono>, body{' '}
        <Mono>{'{ title, body, removable_note, ordering_text, used_only, key_tag_ids? }'}</Mono>; upserts the
        row and sets <Mono>in_key = id = ANY(key_tag_ids)</Mono> for every tag of the tenant in one
        transaction; <Mono>removable_note</Mono> can&apos;t be blank).
      </P>
      <P>
        <Mono>loadAllergenNotice(tx, tenantId)</Mono> in <Mono>routes/menus.js</Mono> loads it;{' '}
        <Mono>loadMenuFull()</Mono> attaches it as <Mono>allergen_notice</Mono> (so print, the
        designer, the public menu JSON and the builder canvas have it), <Mono>loadInlineMenus()</Mono>{' '}
        attaches it to each website menu, and <Mono>GET /order-api/venues/:id</Mono> returns it.
        Every renderer builds the key with{' '}
        <Mono>allergenKey(tags, sections, notice)</Mono>: the notice&apos;s words plus the tags shown
        on menus, ticked for the key and (with <Mono>used_only</Mono>) used by those sections&apos;
        dishes, and <Mono>removable</Mono> when a dish shows a removable allergen.
      </P>
      <DataTable
        head={['Surface', 'How the notice shows']}
        rows={[
          ['menu_print.eta', 'A footer note of kind allergens prints the notice (title, body, key, asterisk note) instead of its own title/body. The print route passes it.key = allergenKey(...) for the printed sections.'],
          ['shared/menuLayout.js', 'buildContext() sets ctx.key from allergenKey(). The callouts block prints the notice for an allergens note; the key block prints only the key (empty when it has nothing to list). Chip tooltips use removable_note.'],
          ['menu_print_dietary.eta', 'Notice title/body above the key. The key div carries data-used-only when used_only is on; only then does the Choose dishes script hide key pairs no ticked dish uses.'],
          ['blocks/menu_inline.eta + MenuInlineCanvas', 'Under the menu unless block data show_allergen_notice is false (editor toggle Show allergen notice); then only the asterisk note shows when needed. The .eta gets allergenKey through it.siteBlocks (siteRenderer.js SITE_BLOCKS), for the sections and dishes the block keeps.'],
          ['shared/ordering.eta', 'Imports allergenKey / noticeOf from /order-api/menuTags.js (shared/menuTags.js served by orderApi.js). The notice, then ordering_text plus the venue phone, under the menu; replaced the fixed allergy sentence.'],
          ['Menus.jsx CalloutsPanel / MenuDesigner.jsx', 'An Allergies & Diet note has no title/body inputs, just a link to the Allergens & dietary page; its stored title stays (CalloutBody needs one). The designer picker names it after the notice.'],
        ]}
      />
      <H3>Allergen matrix (migration 141)</H3>
      <P>
        No new data tables: the matrix edits <Mono>menu_item_dietary</Mono> (dish to tag links)
        against the tenant&apos;s <Mono>menu_dietary_tags</Mono>. <Mono>GET /api/menus/:id/allergens</Mono>{' '}
        (any signed-in user) returns{' '}
        <Mono>{'{ menu: { id, name, venue_name }, tags, sections: [{ id, title, visibility, items: [{ id, name, native_name, description, levels: { tagId: level } }] }] }'}</Mono>{' '}
        from <Mono>loadAllergenMatrix()</Mono> in <Mono>routes/menus.js</Mono>, every section
        included, tags with <Mono>kind</Mono> and <Mono>standard_key</Mono>, allergens first.{' '}
        <Mono>PUT /api/menus/:id/allergens</Mono>{' '}
        (<Mono>requirePermission(&apos;menus&apos;, &apos;manage&apos;)</Mono>) takes{' '}
        <Mono>{'{ items: [{ item_id, levels: { tagId: level } }] }'}</Mono> for the changed dishes only: 422 if any
        dish isn&apos;t on that menu, tag ids not belonging to the tenant are dropped, then each
        sent dish&apos;s links are replaced and <Mono>menus.updated_at</Mono> bumped. It never
        goes through the whole-tree <Mono>PATCH /:id</Mono>, so it can&apos;t disturb sections,
        prices or designs; but a menu editor draft loaded before the save will write its own
        (older) tags back on its next save.
      </P>
      <P>
        <strong>Publishing allergens only</strong> (7 Nov 2026, no migration). The PUT takes{' '}
        <Mono>publish: true</Mono>: after saving it runs <Mono>publishAllergens(tx, tenantId, {'{ by }'})</Mono>{' '}
        (<Mono>services/menuReleases.js</Mono>) in the same transaction and returns the matrix
        with <Mono>published</Mono>. For every menu with a live version it makes a release going
        live now from the <em>live</em> content with each dish&apos;s <Mono>dietary</Mono> and{' '}
        <Mono>allergen_levels</Mono> taken from the draft by dish id (<Mono>withDraftTags(live, draft)</Mono>{' '}
        in <Mono>shared/menuDiff.js</Mono>): dishes only in the draft stay out, dishes only live
        keep their tags, every other field stays as it is live, so the rest of the draft stays
        unpublished (<Mono>GET /:id/publish</Mono> still lists it). Note{' '}
        <Mono>Allergens and dietary tags only</Mono>, <Mono>announced_at</Mono> now, and the route
        calls <Mono>announceMenus()</Mono> for the menus whose live version changed. Each scheduled
        release (not cancelled, later than now) whose tags differ from the draft gets a copy with
        the draft&apos;s tags at the same <Mono>goes_live_at</Mono> (its note plus{' '}
        <Mono>(allergens updated)</Mono>, its publisher kept), and the original is cancelled, so it
        can&apos;t bring the old tags back. Menus never published are skipped and listed in{' '}
        <Mono>unpublished</Mono> when their draft has tags. Every menu row is locked{' '}
        <Mono>FOR UPDATE</Mono> in id order first (the PUT takes the same locks before saving), and{' '}
        <Mono>publishMenu()</Mono> now locks its menu row, so a full publish can&apos;t slip
        between reading the live release and adding the allergen one. Also{' '}
        <Mono>GET /api/menus/allergens/unpublished</Mono> (<Mono>allergenStatus()</Mono>:{' '}
        <Mono>{'{ menus: [{ menu_id, name, dishes: [names], scheduled }], unpublished }'}</Mono>) and{' '}
        <Mono>POST /api/menus/allergens/publish</Mono> (menus manage; returns{' '}
        <Mono>{'{ menus, unpublished, live_menu_ids }'}</Mono>). Admin: the{' '}
        <Mono>allergen-publish-on</Mono> tick in <Mono>AllergenMatrixEditor</Mono> (localStorage{' '}
        <Mono>maca_allergen_publish</Mono>), the waiting note <Mono>allergen-unpublished</Mono> with{' '}
        <Mono>allergen-publish-now</Mono> (query <Mono>[&apos;allergen-unpublished&apos;]</Mono>), the
        result <Mono>PublishedNote</Mono> (<Mono>allergen-published</Mono>). Tests:{' '}
        <Mono>shared/test/menuDiff.test.mjs</Mono>, <Mono>api/test/allergen-publish.test.mjs</Mono>.
      </P>
      <P>
        Every dish row in <Mono>AllergenLookup</Mono> is a button that expands to the description
        and each tag by name, grouped Contains / May contain / Can be removed / Dietary (one open
        at a time). Its free-from filter keeps dishes the allergen can be removed from, flagged
        &quot;Ask for it without ...&quot;; May contain never counts as free from. Admin: <Mono>pages/MenuAllergenMatrix.jsx</Mono> (<Mono>/menus/allergens</Mono>, nav link
        under Menus, seeded by the migration for existing tenants and by the standard menu (its record in{' '}
        <Mono>shared/nav/menus.js</Mono>)) renders <Mono>AllergenMatrixEditor</Mono>;{' '}
        <Mono>AllergenLookup</Mono> is the read-only widget body (search, and a tag filter that
        cycles any / contains / free from; sections with <Mono>visibility = &apos;hidden&apos;</Mono>{' '}
        left out). The tags sit in <Mono>TagFilterModal</Mono>, a pop-up grid (allergens, then
        dietary) opened by the Allergens &amp; diet button; only the filters in use show in the
        widget, as chips that remove themselves. The pop-up is rendered inline, not in a portal,
        so it stays visible inside a dashboard in full screen. Both live in <Mono>components/menus/AllergenMatrix.jsx</Mono> and share{' '}
        <Mono>useMenuChoice()</Mono> (menu choice in localStorage) and{' '}
        <Mono>useAllergenMatrix()</Mono> (query key <Mono>['allergen-matrix', menuId]</Mono>).
        The lookup passes <Mono>live: true</Mono> to both (migration 165): it lists only menus
        with a live version (<Mono>GET /menus?status=1</Mono>) and reads{' '}
        <Mono>GET /menus/:id/allergens?version=live</Mono> (key{' '}
        <Mono>['allergen-matrix', menuId, 'live']</Mono>); the matrix editor stays on the draft.
        Migration 141 adds <Mono>allergen_lookup</Mono> to the{' '}
        <Mono>hs_dashboard_widgets.widget_type</Mono> CHECK (any dashboard since migration
        152; the widget remembers its menu as{' '}
        <Mono>maca_allergen_lookup_&lt;widgetId&gt;</Mono>) and to the{' '}
        <Mono>dashboard_tiles.tile_type</Mono> CHECK (<Mono>TILE_CATALOG</Mono>).
      </P>
      <H3>Menu designer (menu_print_designs)</H3>
      <P>
        A menu can have any number of print designs. Migration 121 stored one layout on{' '}
        <Mono>menus.print_layout</Mono>; migration 135 moved it into{' '}
        <Mono>menu_print_designs</Mono> (id, tenant_id, menu_id, name, layout jsonb, ordered
        by created_at; existing layouts became "Design 1") and dropped the column.{' '}
        <Mono>menus.print_design_id</Mono> (FK, ON DELETE SET NULL) is the design{' '}
        <Mono>GET /api/menus/:id/print</Mono> renders with{' '}
        <Mono>menu_print_designed.eta</Mono>, so the admin Print button and the website{' '}
        <Mono>menu_inline</Mono> block's PDF link show it; NULL = the automatic{' '}
        <Mono>menu_print.eta</Mono>. <Mono>?design=&lt;id&gt;</Mono> prints any of the menu's
        designs, <Mono>?auto=1</Mono> the automatic layout. <Mono>?view=dietary</Mono> renders{' '}
        <Mono>menu_print_dietary.eta</Mono> instead, whatever design is chosen: dish name and its
        dietary tag chips (glyph + colour, icons only) per row, grouped by section, sections with{' '}
        <Mono>visibility = 'hidden'</Mono> dropped, portrait on the menu's paper size, the
        allergen notice and its key (from <Mono>allergenKey()</Mono>, plus the asterisk note; rows with a
        removable allergen carry <Mono>data-removable</Mono> so the note hides with them). Its <strong>Choose dishes</strong> mode is screen-side only: each row
        carries <Mono>data-id</Mono> / <Mono>data-tags</Mono>, unticked ids are kept in
        localStorage <Mono>maca_dietary_skip_&lt;menuId&gt;</Mono> (left-out ids, so new dishes
        show), and the <Mono>.off</Mono> class hides rows, empty section rows and unused key
        entries in print. Linked from the Menus list and editor (<Mono>Dietary list</Mono>).
      </P>
      <DataTable
        head={['Piece', 'Detail']}
        rows={[
          ['Layout shape', '{ paper_size, orientation, margin_mm, cols (6|12|24), row_mm (2.5|5|10), font_scale, master: [block], pages: [{ id, hide_master, blocks: [block] }] }. block = { id, type, ref, x, y, w, h, opts }, x/w in grid columns, y/h in grid rows. master blocks draw on every page (under the page\'s own blocks) unless the page has hide_master.'],
          ['Fold', 'layout.fold (none | vertical | horizontal), fold_gap_mm (0-40, default 10), fold_line. layoutGeometry() keeps the column count (or an even row count) but splits it in half with the gap between: colMm = (contentW - gap) / cols, and colStart/colEnd (rowStart/rowEnd) add the gap to any grid line past the middle, so a block on either side stays clear of it and one spanning the middle includes it. A top / bottom fold centres the content vertically so the gap sits on the sheet\'s centre line. colAtMm()/rowAtMm() map a mm position back to the grid for the designer\'s drag and resize; crossesFold() keeps new blocks off the fold; foldGapBox() gives the strip the designer shades and the optional dashed .ml-fold-line printed in it.'],
          ['Variant columns', 'layout.variant_columns (1-3, default 1) sets how many variant label + price pairs sit in a row; item and full-section blocks can override it with opts.variant_columns (unset = the layout default). itemHtml() builds .ml-variants as a grid of .ml-v pairs.'],
          ['Fonts', 'layout.font_body / font_heading / font_script (defaults Inter / Fraunces / Caveat) and per-block opts.font, all z.enum(FONT_OPTIONS) from shared/fonts.js (the website builder\'s list, now shared with Website.jsx, SiteBlockEditors.jsx, ReservationsWidget.jsx and FontPicker.jsx). pageStyle() sets --ml-body / --ml-heading / --ml-script; a block with opts.font sets all three on itself, and .ml-block re-reads font-family so the override takes. layoutFontsUrl(layout) builds one Google Fonts URL for the fonts in use (googleFontsUrl() requests only each font\'s real weights, plus Fraunces\' opsz axis); the print route and the designer both load it. GET /:id/design also returns site_fonts { heading, body } from tenant_site.theme.typography for Page setup\'s "Use website fonts" (a copy, not a live link).'],
          ['Block types', 'header, intro, section (opts.mode title | full, columns), item, text, image, divider, callouts, key, footer, page_number. ref = menu_sections.id or menu_items.id for section / item.'],
          ['Validation', 'LayoutBody in menus.js: every block inside the grid (x + w <= cols, y + h <= rows for the paper, margin and row height), section/item need a ref, opts is a whitelisted object (unknown keys stripped). Max 20 pages, 400 blocks a page, 100 repeated.'],
          ['Routes', 'GET /api/menus/:id/design (the menu with designs[] and print header details: tenant name, logo, brand colour, venue address; shared loadPrintMenu() with the print route). POST /:id/designs { name, layout } (201; a menu\'s first design also becomes print_design_id), PUT /:id/designs/:designId { name?, layout? }, DELETE /:id/designs/:designId, PUT /:id/print-design { design_id | null } (the design must belong to the menu, else 404). Menu GETs return design_count. The whole-tree PATCH never touches designs.'],
          ['Designer designs bar', 'MenuDesigner.jsx: a pill per design (Printing badge on print_design_id), Copy (new unsaved design from the current one), New design. The open design is kept in the URL (?design=<id>); first load picks the URL one, else the printing one, else the first. Switching is disabled while there are unsaved changes. A new design has designId null and saves with POST; after that PUT. The Page panel\'s "This design" section renames, chooses the design for printing (or the automatic layout), and deletes it (inline confirm; deleting the printing design sends printing back to automatic).'],
          ['Section visibility', 'menu_sections.visibility (migration 136): show | website_hidden | hidden. website_hidden = printed menus only. Left out by loadInlineMenus() in siteDataSvc.js (menu_inline block), GET /api/menus/public/:menuId, loadOrderingMenu() in orderSvc.js (online ordering counts as the website, so those dishes can\'t be ordered) and the builder canvas (MenuInlineCanvas). hidden = also not printed: the print route filters it before menu_print.eta, and buildContext() / placementSummary() in shared/menuLayout.js leave it out, so a designer block on it draws nothing in print and the designer explains why (missingText()) rather than calling it deleted. Edited in the Menus section panel ("Where it shows"), with Hidden / Print only row badges.'],
          ['One renderer', 'shared/menuLayout.js (repo root, plain ESM, own package.json with type module). The print view calls renderPageHtml(); MenuDesigner.jsx draws its own draggable wrappers but fills them with renderBlockInner() and positions them with blockStyle(), and injects the same MENU_LAYOUT_CSS. Admin imports it through the @shared Vite alias; the API by relative path.'],
          ['Dish option prices', 'A dish\'s per-option prices live in menu_item_variant_prices (item, option, price). loadMenuFull() returns each attached group as options[] with overridden + price_pence; Menus.jsx edits them as overrides[]. overridesOf() in Menus.jsx reads either shape, and both setOverride() and the save payload use it, so editing one option keeps the others.'],
          ['Stable ids', 'upsertMenuTree() still deletes and re-inserts the tree, but inserts sections and items under the ids the client sends (Menus.jsx sends s.id / it.id; new ones are crypto.randomUUID()). A duplicate id in one save is a 23505, 409. /duplicate gives the copy fresh ids and copies every print design with remapLayout(), which remaps block refs (dropping blocks whose section or dish is gone) and callout_ids; the copy\'s print_design_id points at the copy of the printing design. Footer notes (menu_callouts) keep their ids the same way (Menus.jsx ensureIds() gives new notes an id), because a callouts block can pick notes by id.'],
          ['Positions', 'A save that leaves sort_order out of a section, dish, dish option, attached option group or footer note gets its place in the list (the Zod bodies have no default, so upsertMenuTree()\'s fallback to the index applies). loadMenuFull() puts dishes with the same position in name order, then id order: its json_agg(DISTINCT ...) hands them back in no useful order (by the jsonb, so by random id), which once made a test pass or fail by chance.'],
          ['Footer notes pick', 'A callouts block\'s opts.callout_ids (uuid array, max 50, LayoutBody) limits it to those notes, in the menu\'s order; absent = every note, new ones included; ids of deleted notes are ignored. pickedCallouts(menu, opts) in shared/menuLayout.js is used by the renderer and the designer panel (Show all notes + a tick box per note). /duplicate maps callout_ids to the copy\'s new note ids.'],
          ['Stays linked', 'Blocks store only a ref and grid position; content is read from the live menu. A ref that no longer exists renders nothing in print and a red "deleted" placeholder in the designer. A full section leaves out dishes that have their own item block (ctx.placedItemIds). placementSummary() drives the designer\'s "Not placed yet" tray.'],
          ['Print CSS', 'Each .ml-page is the paper size, blocks are absolutely positioned in mm inside .ml-content, overflow hidden. In print each page box is the printable area (100vw x 100vh, minus 0.5mm) with break-after: page, and .ml-content is translated by half the difference from the paper size, so a printer that keeps its own margins neither adds a blank sheet per page nor moves the design on the paper. A screen-only script outlines blocks whose content is taller than the block and lists the pages in the print bar.'],
        ]}
      />
      <P>
        Designer interaction uses pointer events, not @dnd-kit (a free 2D canvas with snap,
        cross-page moves and corner resizing is not an ordered list). The page is drawn at
        real mm size inside a <Mono>transform: scale()</Mono> wrapper; pointer maths divides
        by the zoom. On touch the first tap selects a block and only a selected block has{' '}
        <Mono>touch-action: none</Mono>, so the canvas still scrolls. Newly dropped
        text-bearing blocks (FITTABLE) are measured after render and set to their content
        height. Tested: API routes against Postgres, the designed print as a PDF in headless
        Chromium (one sheet per designed page), and the designer driven in Chromium with a
        mocked API (tap-add, tray drag with snap preview, move, resize, repeat on every page,
        add page, save payload).
      </P>

      <H3>Deliveroo menu file (migration 157)</H3>
      <P>
        <Mono>/menus/deliveroo</Mono> (<Mono>pages/MenuDeliveroo.jsx</Mono>, pieces in{' '}
        <Mono>components/menus/DeliverooParts.jsx</Mono>) reads the Deliveroo Hub bulk-management
        file, fills it from our menus, lets staff review and edit it, and writes it back with the
        same columns, order, item ids and line endings. The file is never stored on the server:
        the page keeps it in sessionStorage (<Mono>maca_deliveroo_file_&lt;venueId&gt;</Mono>).
        What is stored, per venue, is how to fill it.
      </P>
      <DataTable
        head={['Piece', 'Detail']}
        rows={[
          ['shared/deliveroo.js', 'All the rules, used by the page and the API: parseCsv() (text kept exactly, quotes, CRLF, BOM; returns eol + trailing), readSheet() (header check: item_id, item_name, delivery_price; duplicate ids), tidyRows(), toCsv(columns, rows, { eol, trailing }), priceRule(), dishPrice(), dishValues(), nameScore() / rankDishes() / matchRow(), buildRow(), rowProblems(), defaultMaps(), FILL_FIELDS, DELIVEROO_ALLERGENS, DELIVEROO_DIETARY. Tests: node --test shared/test/deliveroo.test.mjs.'],
          ['deliveroo_settings', 'One per venue: menu_ids (empty = every published menu of the venue or the company), price_uplift_pct, price_round_pence (1|5|10|50|100), price_round_mode (up|nearest), fill { column: bool } over defaultFill(), allergen_map / dietary_map { tag code: [Deliveroo codes] } over defaultMaps() (standard_key: gluten -> gluten_wheat, sesame -> sesame_seeds, soya -> soybeans, sulphites -> sulphur_dioxide_sulphites, nuts -> none), include_may_contain, include_removable.'],
          ['deliveroo_item_links', 'One per venue per Deliveroo item_id: menu_item_id (no FK, upsertMenuTree() re-inserts dishes) or skip, keep text[] (columns where Deliveroo\'s value stays), overrides { column: text } (typed values). Only FILL_FIELDS columns can be kept or overridden.'],
          ['Matching', 'A saved link wins (linked / skipped / missing when the dish is gone). Else rankDishes() over name, native_name, kitchen_name: 1 = same normalised name, 0.95 = same without brackets, without pack words (can, bottle, 330ml) or without spaces, else word overlap capped at 0.89 (0.75 when one name contains the other). auto when the best is >= 0.9 and not tied; else suggested (top 3) or none.'],
          ['Filling', 'dishValues(): delivery_price = priceRule(dishPrice(dish), pct, round, mode); dishPrice() = price_pence, else the cheapest base-mode option or ad-hoc variant. tax_rate = dish.vat, worked out by the API with taxFor() for the settings\' order_type_id (default: the tenant\'s type named Delivery) and revenue_stream_id (deliveroo_settings, migration 170). allergens = the mapped codes of the dish\'s allergen tags (May contain / Can be removed per settings); an allergen tag with no code is an error, so the CSV can\'t silently drop it. buildRow(): override, then keep, then the menu value; an empty menu value never blanks Deliveroo\'s; columns outside FILL_FIELDS are never touched.'],
          ['Checks', 'rowProblems(): errors = what Deliveroo would refuse (no item_id or one Excel turned into 1.23E+15, delivery price not a positive amount with up to 2 decimals, VAT not 0/5/12.5/20, calories not a whole number, no_allergens with others, booleans not true/false); warnings = price change over 30%, unknown allergen or dietary code. The CSV download is disabled while any error is left.'],
          ['Routes (/api/deliveroo)', 'POST /read { file_name, data base64 } (menus view; CSV decoded as UTF-8, else Windows-1252; .xlsx/.xls via xlsx with formatted text; 8 MB file limit, bodyLimit 12 MB; 5000 rows). GET /venues/:venueId (view; settings with defaults, links, menus, menu_ids_used, dishes with dietary, allergen_levels, variant_groups, variants, vat and vat_name for the settings\' order type and stream, order_types, revenue_streams, tags). PUT /venues/:venueId/settings and PUT /venues/:venueId/links (menus manage; links upsert the items sent, delete the ones sent with nothing to remember, leave others alone; menu ids and dish ids are checked to be the tenant\'s). POST /xlsx { columns, rows, file_name } (view; every cell a text cell so Excel keeps ids and prices as typed). Every query filters tenant_id.'],
          ['Page', 'Settings draft applies to the review live and is saved with Save settings (menus picked only change the dish list after saving). Save matches sends only rows whose effective link (auto matches included, so they become stable) differs from the saved one. CSV is built in the browser with toCsv() using the file\'s own eol / trailing newline; the API test checks a file read and written back unchanged is byte for byte the same. api.postBlob() (lib/api.js) downloads the .xlsx.'],
        ]}
      />
      <P>
        Deliveroo's allergen codes were taken from Deliveroo's bulk-management and Menu API
        guides and are only offered as suggestions (the map is editable, and unknown codes are a
        warning, not an error). Tested: shared tests, the API against Postgres with two tenants
        and the real One Thai Ware export (round trip, Windows-1252, xlsx in and out, permissions),
        and the page in Chromium at 1280, 1015 and 390 px (match, skip, keep, typed prices, code
        map, save, download and reload).
      </P>
      <H3>The Allergens page (migration 258)</H3>
      <P>
        <Mono>pages/Allergens.jsx</Mono> (<Mono>/allergens</Mono>): <Mono>AllergenLookup</Mono> as a page, for the{' '}
        <Mono>allergens</Mono> module (see RBAC: Allergen lookup). The live read (<Mono>?version=live</Mono>) takes
        Menus or Allergen lookup; the draft and every write stay Menus. Search words in{' '}
        <Mono>NAV_KEYWORDS</Mono> include allergy and free from.
      </P>
    </section>
  )
}
