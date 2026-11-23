// src/pages/docs/navigation.jsx
// The Docs page's "Navigation" section. Docs.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, Mono, DataTable, InfoBox } from './parts.jsx'

export const id = 'navigation'
export const label = 'Navigation'
export const order = 230

// ── NAVIGATION & LAUNCHER ───────────────────────
export function Section() {
  return (
    <section id="navigation" data-doc="">
      <H2>Navigation</H2>
      <P>
        Migration 091 replaces the previously-hardcoded <Mono>NAV_SECTIONS</Mono> array in
        <Mono> AppShell.jsx</Mono> with an admin-configurable, arbitrary-depth tree per
        tenant, plus a tenant-wide toggle to swap the sidebar for a quick-access tile
        launcher instead.
      </P>
      <H3>Schema</H3>
      <DataTable
        head={['Table / column', 'Purpose']}
        rows={[
          ['nav_items', 'Self-referencing tree (parent_id → nav_items.id, ON DELETE CASCADE). kind is \'section\' (pure grouping label, no route) or \'link\' (route required). module ties an item to the existing tenant_modules/tenant_roles permission system. hidden_role_ids uuid[] is an ADDITIONAL hide on top of module gating. (show_in_launcher and launcher_sort_order, the Launcher\'s tiles, were dropped by migration 274.)'],
          ['nav_items.description', 'Migration 241. The entry\'s own words on what it is for, at most 260 characters (CHECK nav_items_description_len). NULL = the page\'s standard description from shared/navSearch.js. See Descriptions below.'],
        ]}
      />
      <H3>API — /api/nav</H3>
      <P>
        Every route requires <Mono>requirePermission('nav_designer', 'view' | 'manage')</Mono>
        — owner-only <Mono>manage</Mono> by default (see <Mono>modules.js</Mono>).
      </P>
      <DataTable
        head={['Method', 'Path', 'Purpose']}
        rows={[
          ['GET', '/route-catalog', 'Static list of every real admin-portal route + a suggested icon/label/module — the designer can only ever point a link at a known page, never an arbitrary URL. Each page also carries its standard description (NAV_DESCRIPTIONS), which the designer shows as the Description box\'s placeholder.'],
          ['GET', '/items', 'Flat list of active nav_items for the tenant.'],
          ['POST', '/items', 'Create a section or link. New items land at the end of their sibling list.'],
          ['PATCH', '/items/reorder', 'Body { parent_id, ids } — re-sequences sort_order for one sibling list (move up/down).'],
          ['PATCH', '/items/:id/reparent', 'Body { parent_id, index } — moves an item to a new parent at a position. Used for both "indent" (new parent = previous sibling) and "outdent" (new parent = grandparent) from the frontend.'],
          ['PATCH', '/items/:id', 'Generic field update (label, icon, route, module, description, hidden_role_ids, is_active, …). description (also on POST) is trimmed, an empty one becomes null (= the standard words), and one over 260 characters is a 400.'],
          ['DELETE', '/items/:id', 'Hard delete — children cascade via the FK.'],
          ['POST', '/reset', 'Deletes every nav_items row for the tenant and re-seeds via seedDefaultNav().'],
        ]}
      />
      <H3>The menu search</H3>
      <P>
        The menu search (8 Nov 2026; since Pepper-first step 2c it is the ask bar, see Home, pins and
        the ask bar) finds the links that fit what was typed. The rules are one shared file, <Mono>shared/navSearch.js</Mono>:{' '}
        <Mono>searchTerms()</Mono> splits the query into words and drops filler
        (<Mono>STOP_WORDS</Mono> — articles, question words and doing-words like
        <Mono> change</Mono>/<Mono>edit</Mono>; when every word is filler the words themselves
        are used, so &ldquo;whats new&rdquo; still finds What&apos;s new), and{' '}
        <Mono>searchNavTree(nodes, query)</Mono> walks a tree in <Mono>/api/me</Mono>&apos;s{' '}
        <Mono>nav_tree</Mono> shape and keeps a link when <em>every</em> term prefix-matches a
        word in its label, its route&apos;s own words, its page&apos;s{' '}
        <Mono>NAV_KEYWORDS</Mono> entry, its description (since migration 241), or an
        ancestor&apos;s label — ranked by where the terms hit (<Mono>SEARCH_WEIGHTS</Mono>: own
        label 4, keywords/route 3, description 2, ancestors 1; see Descriptions below). A term
        also hits a word that is the same word in another form (12 Nov 2026):{' '}
        <Mono>wordForms()</Mono> gives a word and itself without a plural ending
        (<Mono>designers</Mono> → <Mono>designer</Mono>, <Mono>dishes</Mono> → <Mono>dish</Mono>,{' '}
        <Mono>allergies</Mono> → <Mono>allergy</Mono>; never under three letters, a word ending
        in ss keeps its s), and two words match when their forms meet. Such a hit is worth{' '}
        <Mono>FORM_PENALTY</Mono> (0.5) less than the word as typed, so &ldquo;menus&rdquo; puts
        Menus before Menu times, and it is never a prefix: &ldquo;times&rdquo; is the same word
        as &ldquo;time&rdquo;, not the start of &ldquo;timeline&rdquo;.{' '}
        <Mono>NAV_KEYWORDS</Mono>{' '}
        (each page record&apos;s <Mono>keywords</Mono>, below) maps every <Mono>ROUTE_CATALOG</Mono> route to its everyday vocabulary
        (&ldquo;wages&rdquo; for the Rota, &ldquo;allergy&rdquo; for the allergen pages), so a
        link renamed in the designer is still found; <Mono>EXTRA_SEARCH_ROUTES</Mono> covers
        the platform-admin pages that live outside the catalogue.
      </P>
      <P>
        The UI is the ask bar, <Mono>admin/src/components/layout/AskBar.jsx</Mono>: it searches the role-pruned{' '}
        <Mono>nav_tree</Mono> (so results never offer a page the person can&apos;t open) with a Platform section
        added for platform admins (<Mono>searchTreeOf()</Mono>). Tests:{' '}
        <Mono>shared/test/navSearch.test.mjs</Mono> (terms, matching, ranking), plus a drift
        check in <Mono>api/test/nav-default.test.mjs</Mono> — every catalogue route must have
        keywords and no keyword entry may point at a route that is gone, so a new page
        can&apos;t ship without search words.
      </P>
      <P>
        Pepper&apos;s own menu search (9 Nov 2026: <Mono>POST /api/ai/nav-search</Mono>,{' '}
        <Mono>routes/navAi.js</Mono>, picks from refs L1..Ln on the everyday model, shown in the sidebar as
        Pepper&apos;s picks) was retired with step 2c: one of the three page matchers the strategy made into one.
        Enter in the ask bar now hands the words to Pepper&apos;s chat, whose <Mono>open_page</Mono> finds pages with
        the same <Mono>searchNavTree()</Mono> and answers with a nav card.
      </P>
      <H3>Descriptions</H3>
      <P>
        Every menu entry has a very brief description of what it is for (migration 241, 12 Nov
        2026). The rules are in <Mono>shared/navSearch.js</Mono>:{' '}
        <Mono>NAV_DESCRIPTIONS</Mono> holds the standard description of every{' '}
        <Mono>ROUTE_CATALOG</Mono> page (one sentence, in the words people would type; each page
        record&apos;s <Mono>description</Mono>, below),{' '}
        <Mono>NAV_SECTION_DESCRIPTIONS</Mono> the standard menu&apos;s sections by name (from{' '}
        <Mono>shared/nav/sections.js</Mono>), and{' '}
        <Mono>DESCRIPTION_MAX</Mono> is 260. <Mono>navDescription(node)</Mono> is the one reader:
        the entry&apos;s own <Mono>nav_items.description</Mono> when a group wrote one, else its
        page&apos;s standard one, else (a section) the standard one for its name, else nothing.{' '}
        <Mono>/api/me</Mono>&apos;s <Mono>nav_tree</Mono> carries each node&apos;s stored{' '}
        <Mono>description</Mono>; the fallback is applied where it is read, so a standard
        description changed in code reaches every group that hasn&apos;t written its own.
      </P>
      <DataTable
        head={['Where', 'What happens']}
        rows={[
          ['Search (matchLink())', 'A term counts once, at the best place it hits: the link\'s own name 4, its page\'s search words or route 3, its description 2, a section above it 1 (SEARCH_WEIGHTS), each 0.5 less when the hit is another form of the word (a plural). Every term must hit somewhere. Results sort by score, then by how many terms are in the link\'s own name (labelHits), then by name. A section\'s description is shown, never searched through its links.'],
          ['Results (AskBar.jsx)', 'Name (ask-result-label, wraps), the description under it (two lines at most, the whole of it in its tooltip), then where the link sits (ask-result-place, from placeText(): a name said once when a section and the link under it share it).'],
          ['Sidebar (AppShell.jsx)', 'A link\'s or section\'s tooltip is its description (toNavItem()).'],
          ['Navigation designer', 'Each row shows the description (nav-row-description, data-own when it is the entry\'s own words). The add / edit form has a Description box (nav-description) with the page\'s standard words as its placeholder, a counter to 260 (nav-description-count), a hint (nav-description-hint) and Use the standard words (nav-description-standard). Save waits while it is too long.'],
          ['Pepper', 'open_page returns the page\'s standard description as about (ai/tools/general.js).'],
        ]}
      />
      <P>
        <Mono>api/test/nav-default.test.mjs</Mono> fails when a catalogue route has no description
        or one over 260 characters, so a new page can&apos;t ship without one;{' '}
        <Mono>shared/test/navSearch.test.mjs</Mono> covers the weights, the tie-break, plurals, a
        group&apos;s own words winning and sections not being searched through.
      </P>
      <H3>The designers' own pages</H3>
      <P>
        The same migration gave nine pages that used to sit inside other pages their own
        address, catalogue entry and menu link, so the search can find them by name. No new
        permission modules: each is gated by the module of the page it came out of.
      </P>
      <DataTable
        head={['Entry', 'Address', 'Module', 'Came out of', 'Code']}
        rows={[
          ['Kiosk designer', '/pos/kiosk-designs (a design: /pos/kiosk-designs/:id)', 'pos_setup', 'The designs list at the bottom of Store tech → Kiosks', 'KioskDesignsSection (KiosksSection.jsx), TABS key kiosk-designs; pages/KioskDesigner.jsx'],
          ['Kitchen flow designer', '/pos/kitchen-flow', 'pos_setup', 'The flow at the top of Store tech → Kitchen screens', 'KitchenFlowSection (KitchenSection.jsx), TABS key kitchen-flow; KitchenFlow.jsx'],
          ['Receipt & ticket designer', '/pos/print-designs (a design: /pos/print-designs/:id)', 'pos_setup', 'The designs list on Store tech → Printing', 'PrintDesignsSection (PrintingSection.jsx), TABS key print-designs; pages/PrintDesigner.jsx'],
          ['Screen board designer', '/screens/boards (a board: /screens/boards/:id)', 'screens', 'The Boards tab of Menu screens', 'pages/Screens.jsx page="boards" (SCREEN_PAGES); pages/ScreenDesigner.jsx'],
          ['Screen playlists', '/screens/playlists', 'screens', 'The Playlists tab of Menu screens', 'pages/Screens.jsx page="playlists"'],
          ['Screen walls', '/screens/walls', 'screens', 'The Walls tab of Menu screens', 'pages/Screens.jsx page="walls"'],
          ['Menu print designer', '/menus/print-designs (a menu: /menus/print-designs/:menuId, ?design=<id>)', 'menus', 'The Design print button in the menu editor (still there)', 'pages/MenuPrintDesigns.jsx (the list); pages/MenuDesigner.jsx'],
          ['Page builder', '/website/builder', 'website', 'The Home and Pages & modals sections of Website', 'pages/Website.jsx with the builder prop (BUILD_TENANT_NAV / BUILD_VENUE_NAV / BUILD_SINGLE_NAV, BUILDER_SECTIONS)'],
          ['Reservations widget', '/website/reservations-widget', 'website', 'A page that was only linked from Website', 'pages/ReservationsWidget.jsx'],
        ]}
      />
      <P>
        The Store tech pages are <Mono>TABS</Mono> of <Mono>PosSetup.jsx</Mono>, with{' '}
        <Mono>PageLink</Mono> cards (<Mono>components/pos/shared.jsx</Mono>) between each designer
        and the page it came out of (<Mono>kiosk-designer-link</Mono> / <Mono>kiosks-link</Mono>,{' '}
        <Mono>kitchen-flow-link</Mono> / <Mono>kitchen-screens-link</Mono>,{' '}
        <Mono>print-designer-link</Mono> / <Mono>printing-link</Mono>). The four screens pages are
        one component with a <Mono>page</Mono> prop and a row of page buttons
        (<Mono>screens-pages</Mono>). <Mono>Website.jsx</Mono> is mounted twice (settings and
        builder); a <Mono>?section=</Mono> that lives on the other page is sent there, and the rail
        links between Website, Page builder and Reservations widget.
      </P>
      <P>
        <strong>Old addresses</strong> redirect inside the app: <Mono>Moved</Mono> in{' '}
        <Mono>main.jsx</Mono> for <Mono>/pos/kiosks/designs/:id</Mono>,{' '}
        <Mono>/pos/printing/designs/:id</Mono> and <Mono>/menus/:id/design</Mono> (keeping the id
        and the <Mono>?query</Mono>), <Mono>/screens?tab=</Mono> in <Mono>Screens.jsx</Mono>,{' '}
        <Mono>/website?section=</Mono> in <Mono>Website.jsx</Mono> and <Mono>/reservations-widget</Mono>.
      </P>
      <P>
        <strong>Which link is lit.</strong> The sidebar lights a link at any address that starts
        with its own, so <Mono>/website</Mono> would light beside <Mono>/website/builder</Mono> and{' '}
        <Mono>/screens</Mono> beside <Mono>/screens/boards</Mono>. <Mono>exactRoutes(tree)</Mono>{' '}
        (<Mono>shared/navSearch.js</Mono>) returns the links whose address another link&apos;s
        begins with (followed by a slash), plus the home page; <Mono>AppShell.jsx</Mono> gives
        those <Mono>end</Mono>. It is worked out from the person&apos;s own menu, so a designer
        opened from a list page (<Mono>/pos/layouts/:id</Mono>) still lights its link.
      </P>
      <P>
        <strong>Addresses the admin never sees.</strong> On office. and ops. nginx hands some
        paths to the API before the app loads, matched as plain prefixes (<Mono>/api/</Mono>,{' '}
        <Mono>/ws</Mono>, <Mono>/webhooks/</Mono>, <Mono>/manage</Mono>, <Mono>/reservations</Mono>,{' '}
        <Mono>/widget-api</Mono>, <Mono>/order-api</Mono>, <Mono>/uploads/</Mono>,{' '}
        <Mono>/template-assets/</Mono>). The Reservations widget page&apos;s old address,{' '}
        <Mono>/reservations-widget</Mono>, starts with one of them, so loading or reloading it
        showed the API&apos;s 404 (it only worked when reached by a link inside the app); it is{' '}
        <Mono>/website/reservations-widget</Mono> now. The nav test reads the prefixes from{' '}
        <Mono>scripts/nginx-office-ops.sh</Mono> and <Mono>admin/vite.config.js</Mono> and fails on
        a catalogue route under one.
      </P>
      <H3>The outline editor, not drag-and-drop reparenting</H3>
      <P>
        Free-form drag-and-drop tree reparenting (dropping a node onto an arbitrary other
        node at an arbitrary position) is fragile to build correctly. Instead the designer
        is an outline editor — move up/down, indent, outdent — which still supports
        arbitrary depth. <Mono>reparent()</Mono> computes the old-siblings list (excluding
        the moved item), computes the new-siblings list under the target parent (reusing
        the same list if the parent didn't change), splices the item in at the requested
        index, persists the new <Mono>parent_id</Mono>, then re-sequences
        <Mono> sort_order</Mono> for the new-siblings list and — if the parent actually
        changed — also re-sequences the old-siblings list to close the gap left behind.
      </P>
      <H3>/api/me: nav_tree</H3>
      <P>
        <Mono>platform.js</Mono>'s <Mono>/api/me</Mono> handler fetches the tenant's active
        <Mono> nav_items</Mono>, builds the tree, and prunes it against the caller's
        effective permissions and role id (<Mono>pruneNavTree()</Mono>): a link is dropped
        if its module is disabled/unpermitted or its own id is in
        <Mono> hidden_role_ids</Mono> for the caller's role; a section is dropped only if
        every child was pruned. Platform admins bypass all of it.
        <Mono> AppShell.jsx</Mono> renders <Mono>nav_tree</Mono> directly instead of a
        hardcoded array (superseding the note about static gating in the RBAC section
        above).
      </P>
      <H3>/api/me: site_theme</H3>
      <P>
        The same handler also returns <Mono>site_theme</Mono> — the tenant's public-website
        brand colours (<Mono>tenant_site.theme.colors</Mono>), resolved with the same
        default fallbacks <Mono>head.eta</Mono> uses so every tenant gets a value even
        before touching the Website builder. Piggybacks on the existing{' '}
        <Mono>/api/me</Mono> round-trip (already fetched on every admin page load) rather
        than adding a new one. <Mono>SettingsContext.applySiteTheme()</Mono> writes it as{' '}
        <Mono>--site-primary</Mono> / <Mono>--site-accent</Mono> / etc CSS variables on{' '}
        <Mono>:root</Mono> — a namespace deliberately separate from <Mono>--primary</Mono>{' '}
        (the operator's own admin colour pick, Settings page) and <Mono>--accent</Mono> (a
        neutral hover-state grey used pervasively via <Mono>hover:bg-accent</Mono>), so
        borrowing the tenant's brand colour for admin UI (e.g. Cash Recon's{' '}
        <Mono>SectionCard</Mono> header/footer bars) never repaints the app's own hover
        surfaces.
      </P>
      <H3>Page colours and card headers (admin/src/index.css)</H3>
      <P>
        The admin uses the Rota dashboard's look everywhere: a light grey page canvas,
        white cards, and an accent header bar on each card. The pieces:
      </P>
      <DataTable
        head={['Piece', 'What it does']}
        rows={[
          ['--page / bg-page', 'The grey canvas (220 16% 95%). Set on body, AppShell\'s and MobileShell\'s root, TenantGate and the H&S / Cash / Rota dashboard root.'],
          ['--background / bg-background', 'White surfaces: cards, page title bars, sidebar, modals, and the list-and-detail workspaces (Bookings, Timeline, Customers, Cash Recon\'s week grid).'],
          ['--border, --muted, --muted-foreground, --accent', 'Darker than before (border 86%, muted 94%, muted text 40%, hover 92%) so lines, fills and secondary text read on both white and grey.'],
          ['.border:where(...) rule', 'Any element with the plain border class and no bg-* class gets a white background (one-class specificity, in @layer components): lists, table frames, inputs and outlined buttons turn white on the grey page with no per-page edits. bg-* utilities and hover:/disabled: variants still win. An element that must stay see-through over a coloured parent sets bg-transparent.'],
          ['.section-head', 'The card header bar: --site-accent-soft background and a 2px --site-accent bottom border (the tenant\'s website accent, default pink). Used by every shared SectionCard / Card / Section component, dashboard widget and Overview tile header, the Rota page panels and Cash Recon\'s SectionCard. Don\'t combine it with border-b (that resets the border width to 1px).'],
          ['bg-card', 'Mapped to --background in tailwind.config.js (it was used but never defined).'],
        ]}
      />
      <H3>Page records: one file per area</H3>
      <P>
        Since 22 Nov 2026 every page the menu can link to is one record in its area&apos;s file,{' '}
        <Mono>shared/nav/&lt;area&gt;.js</Mono> (<Mono>export const pages = [...]</Mono>), so two
        features in different areas never edit the same list. A record is{' '}
        <Mono>{'{ path, label, menuLabel?, icon, module?, section, parent?, order, catalogOrder, keywords, description }'}</Mono>:{' '}
        <Mono>section</Mono> names a section of <Mono>shared/nav/sections.js</Mono> (label, order,
        standard description), <Mono>parent</Mono> the link it sits under, <Mono>order</Mono> its
        place among its section&apos;s (or parent&apos;s) links and <Mono>catalogOrder</Mono> its
        place in the catalogue, both spaced by 10 with ties broken by path;{' '}
        <Mono>searchOnly</Mono> marks a platform-admin page with search words only.{' '}
        <Mono>shared/nav/index.js</Mono> imports each area file by name (<Mono>shared/</Mono> runs
        in Node and in Vite, so it can&apos;t gather the folder; a new area adds its import there)
        and builds <Mono>ROUTE_CATALOG</Mono>, <Mono>DEFAULT_NAV_TREE</Mono>,{' '}
        <Mono>NAV_KEYWORDS</Mono>, <Mono>NAV_DESCRIPTIONS</Mono>, <Mono>EXTRA_SEARCH_ROUTES</Mono>{' '}
        and <Mono>NAV_SECTION_DESCRIPTIONS</Mono> in the shapes they had when written by hand;{' '}
        <Mono>api/src/routes/nav.js</Mono>, <Mono>api/src/config/defaultNav.js</Mono> and{' '}
        <Mono>shared/navSearch.js</Mono> re-export them, so every reader is unchanged.{' '}
        <Mono>shared/test/navPages.test.mjs</Mono> checks the records and that every file in the
        folder is imported. A new page still needs a migration that adds its link to menus already
        saved.
      </P>
      <H3>Deep links: a page at a venue, day or week, and tab</H3>
      <P>
        Since 22 Nov 2026 (<Mono>docs/PEPPER_FIRST.md</Mono> 4.6) a page&apos;s record can say what its
        address opens it at: <Mono>accepts</Mono>, some of <Mono>venue</Mono> (a venue id),{' '}
        <Mono>date</Mono> (YYYY-MM-DD), <Mono>week</Mono> (its Monday) and <Mono>tab</Mono>, with{' '}
        <Mono>tabs</Mono> naming the tab keys. <Mono>shared/nav/links.js</Mono> holds the rules:{' '}
        <Mono>pageLink(path, {'{ venue, date, week, tab }'})</Mono> builds the address keeping only what
        the page accepts and only values in a good shape (a uuid, a real day, a Monday, a known tab),{' '}
        <Mono>linkValues(path, params)</Mono> reads one back by the same rules, and{' '}
        <Mono>pageAccepts(path)</Mono> says what a page takes. In the admin,{' '}
        <Mono>useDeepLink(path, {'{ ready, apply }'})</Mono> (<Mono>admin/src/lib/deepLink.js</Mono>,
        beside <Mono>useLinked()</Mono> for records) reads the values when the page opens (and again
        when a link to the same page is followed while it is open), calls <Mono>apply</Mono> once as soon
        as <Mono>ready</Mono> is true (the page&apos;s venues have loaded), and takes the values out of
        the address. Only shapes are checked there: the page ignores a venue that isn&apos;t in its own
        venue list. Pepper's <Mono>open_page</Mono> builds these links with <Mono>pageLink()</Mono> (Docs, Pepper's tools). Tests: <Mono>shared/test/navLinks.test.mjs</Mono>.
      </P>
      <DataTable
        head={['Page', 'Accepts', 'Tabs']}
        rows={[
          ['/timeline', 'venue, date', ''],
          ['/bookings', 'venue, date', ''],
          ['/rota', 'venue, week', ''],
          ['/food-safety', 'venue, date, tab', 'today, deliveries, holds, cooking'],
          ['/orders', 'venue, date, tab', 'board, report, transactions'],
          ['/cash-recon', 'venue, date, week, tab', 'week, wages (a date alone opens that day)'],
        ]}
      />
      <H3>Seeding</H3>
      <P>
        <Mono>api/src/config/defaultNav.js</Mono> exports <Mono>DEFAULT_NAV_TREE</Mono> (built
        from the page records) +
        <Mono> seedDefaultNav(tx, tenantId)</Mono>, used both for brand-new tenants
        (<Mono>POST /api/platform/tenants</Mono>) and the designer's <Mono>POST
        /api/nav/reset</Mono>. Migration 091 also seeds this same tree once, directly in
        SQL, for every tenant that existed at migration time — that one-time seed is never
        re-run, so the page records are the only copy that matters going forward; a change to
        the standard menu needs a migration for menus already saved.
      </P>
      <P>
        Migration 196 (20 Oct 2026) replaced every tenant's menu with the new default tree once: it
        deletes every <Mono>nav_items</Mono> row, set <Mono>tenants.nav_style = 'sidebar'</Mono> (a column dropped by 274) and
        re-seeds each tenant from a JSON copy of <Mono>DEFAULT_NAV_TREE</Mono> through a temporary{' '}
        <Mono>pg_temp.seed_nav()</Mono> function (so launcher tiles and designer edits went). The tree has
        eleven sections grouped by job (Home, Service, Money, Health &amp; safety, Stock, People, Menus,
        Brand &amp; web, Venues, Admin, Help) and names every <Mono>ROUTE_CATALOG</Mono> route exactly once.{' '}
        <Mono>api/test/nav-default.test.mjs</Mono> fails when the migration's JSON and{' '}
        <Mono>DEFAULT_NAV_TREE</Mono> differ, when a catalogue route is missing or doubled, or when a new
        tenant's <Mono>/api/me</Mono> tree doesn't match: change both together.
      </P>
      <P>
        Migration 202 (23 Oct 2026) added the <strong>Store tech</strong> section after Venues: the old
        Till setup page's tabs became pages of their own (<Mono>/pos/tills</Mono>, <Mono>/pos/kiosks</Mono>,{' '}
        <Mono>/pos/kitchen</Mono>, <Mono>/pos/printers</Mono>, <Mono>/pos/printing</Mono>,{' '}
        <Mono>/pos/cards</Mono>, <Mono>/pos/types</Mono>, <Mono>/pos/streams</Mono>, <Mono>/pos/courses</Mono>,{' '}
        <Mono>/pos/staff</Mono>, <Mono>/pos/roles</Mono>, <Mono>/pos/receipts</Mono>, <Mono>/pos/recon</Mono>),
        each a catalogue route, with Floor plan and Menu screens beside them. Unlike 196 it edits each
        tenant's menu in place: it deletes the <Mono>/pos</Mono> link (with its Floor plan child) and the{' '}
        <Mono>/screens</Mono> link wherever they are, inserts the section after the top-level item holding{' '}
        <Mono>/venues</Mono> (else at the end), gives the new links the roles the old ones were hidden from,
        and moves a quick-access tile to Tills / Menu screens. Other Navigation changes stay; a tenant that
        already has <Mono>/pos/tills</Mono> is skipped. The nav test applies 202's change to 196's JSON and
        compares the result with <Mono>DEFAULT_NAV_TREE</Mono>.
      </P>
      <P>
        Later migrations add single links the same way (insert beside a known route, copy its{' '}
        <Mono>hidden_role_ids</Mono>, skip tenants that already have the route): 208 Kiosk analytics, 211 Loyalty,
        216 Device updates, and 219 <strong>Venue hub</strong> (<Mono>/pos/hub</Mono>, just before{' '}
        <Mono>/pos/printers</Mono>, 30 Oct 2026: the hub moved off the Printers page onto its own,{' '}
        <Mono>components/pos/HubSection.jsx</Mono>). The nav test applies each of them too.
      </P>
      <P>
        Migration 241 (12 Nov 2026) adds <Mono>nav_items.description</Mono> and the nine designer
        links (see The designers&apos; own pages above), one after another so each can go after the
        one before it: every link goes straight after its anchor page&apos;s first place in a
        group&apos;s menu (same parent, hidden from the same roles, later siblings moved down one),
        or after a fallback anchor when the group took the first one out (Screen playlists after
        the board designer, else after Menu screens). A group with neither anchor gets no link,
        and a group that already has the page keeps its menu as it is, so running it twice adds
        nothing. The nav test runs it on a rebuilt pre-241 menu and checks the places, the roles
        and the second run.
      </P>
      <H3>Launcher mode retired (migration 274)</H3>
      <P>
        Until Pepper-first step 2d a group could replace the sidebar with a tile screen at{' '}
        <Mono>/launcher</Mono> (<Mono>tenants.nav_style</Mono> <Mono>launcher</Mono>, tiles from{' '}
        <Mono>nav_items.show_in_launcher</Mono> in <Mono>launcher_sort_order</Mono>, each viewer&apos;s order and
        hidden tiles in local storage, the designer&apos;s Sidebar / Launcher switch, <Mono>PATCH /api/nav/style</Mono>,{' '}
        <Mono>/api/me</Mono>&apos;s <Mono>launcher_tiles</Mono>). All of it is gone: the sidebar is the only menu and
        each person&apos;s pins on Home are their shortcuts. Migration 274 gave each active member of a group that was
        in launcher mode, with no pins yet, the group&apos;s tiles as pins (in the tiles&apos; order, each page once, at
        most 12; <Mono>GET /api/pins</Mono> leaves out any the person&apos;s menu doesn&apos;t hold), then dropped the
        three columns and their index. Tests: <Mono>api/test/home-pins.test.mjs</Mono> (274 on real rows),{' '}
        <Mono>api/test/nav-default.test.mjs</Mono> (241&apos;s and 243&apos;s SQL replayed without the dropped column).
      </P>
    </section>
  )
}
