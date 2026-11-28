// src/pages/docs/mobile-app.jsx
// The Docs page's "Mobile App (/mobile)" section. Docs.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, Mono, InfoBox } from './parts.jsx'

export const id = 'mobile-app'
export const label = 'Mobile App (/mobile)'
export const order = 210

// ── MOBILE APP ──────────────────────────────
export function Section() {
  return (
    <section id="mobile-app" data-doc="">
      <H2>Mobile App (/mobile)</H2>
      <P>
        A phone-portrait section of the same admin SPA at <Mono>/mobile/*</Mono>, chosen
        over a separate Vite project / subdomain so it shares the existing Auth0 session,
        API, and GitHub Actions deploy pipeline with zero new infra (no new Nginx server
        block, no new DNS record, no second Auth0 application). It gets its own installable
        identity ("Macaroonie Office", short name Office; Ops before 25 Nov 2026) purely through a second static PWA manifest swapped in
        at runtime — everything else about the app is unchanged.
      </P>
      <H3>Routing and layout</H3>
      <P>
        <Mono>main.jsx</Mono> mounts a second top-level route tree,{' '}
        <Mono>{`<Route path="mobile" element={<MobileShell />}>`}</Mono>, as a sibling of the
        existing <Mono>{`<Route element={<AppShell />}>`}</Mono> tree — both still sit inside
        the same <Mono>RequireAuth</Mono> + <Mono>TenantGate</Mono> wrappers, so login and
        restaurant selection are identical to the desktop app. The phone&apos;s pages are the
        routes with <Mono>shell: &apos;mobile&apos;</Mono> in each area&apos;s{' '}
        <Mono>admin/src/routes/&lt;area&gt;.jsx</Mono> (paths relative to{' '}
        <Mono>/mobile</Mono>), gathered by <Mono>main.jsx</Mono>, which keeps the tree and its
        catch-all to the hub.
        <Mono> admin/src/components/mobile/MobileShell.jsx</Mono> replaces
        <Mono> AppShell</Mono>'s sidebar entirely with a minimal header (back arrow / title (Office on the hub)
        and the group&apos;s name / the three-dot menu, safe-area aware) — there is no shared chrome between the two shells by
        design; the desktop sidebar assumes a ≥1015px tablet per the Standard Design Rules,
        which is the wrong shape for a phone.
      </P>
      <H3>Module registry</H3>
      <P>
        <Mono>admin/src/mobile/registry.js</Mono> exports <Mono>MOBILE_MODULES</Mono> — the
        same "one array drives a picker" pattern as <Mono>modules.js</Mono>. <Mono>MobileHub.jsx</Mono> (the <Mono>/mobile</Mono>{' '}
        index route) renders one tile per entry, in a two-column grid, and <Mono>AskPepperBar</Mono>{' '}
        (<Mono>components/ai/AskPepperBar.jsx</Mono>) at the bottom when <Mono>/api/ai/status</Mono> says{' '}
        <Mono>can_chat</Mono>: a question (typed, or a held mic) goes to <Mono>/mobile/assistant</Mono> in the
        address&apos;s state (<Mono>{"{ ask: { text, voice } }"}</Mono>), which takes it off the address and hands it
        to <Mono>ChatView</Mono>&apos;s <Mono>ask</Mono> prop: sent once in the remembered chat. Shipping a new mobile-optimised page is:
        add an entry here, add the route (<Mono>shell: &apos;mobile&apos;</Mono>) in its area&apos;s{' '}
        <Mono>admin/src/routes/&lt;area&gt;.jsx</Mono>, build the page — no
        changes to the shell or hub. An entry&apos;s <Mono>areas</Mono> (the Today feed&apos;s task
        areas, or <Mono>'all'</Mono>) give its tile a badge: <Mono>tileBadge()</Mono> in{' '}
        <Mono>mobile/today.js</Mono> counts that area&apos;s tasks from <Mono>GET /api/ops/today</Mono>{' '}
        for the venue picked on Today (<Mono>maca_today_venue</Mono>), red when one is late;{' '}
        <Mono>todayLine()</Mono> words the Today tile. The hub and the Today page share one query
        (<Mono>useTodayFeed()</Mono>, key <Mono>['ops-today', venueId]</Mono>, the office Today
        page&apos;s key).
      </P>
      <H3>Today on the phone</H3>
      <P>
        <Mono>pages/mobile/MobileToday.jsx</Mono> (<Mono>/mobile/today</Mono>, the first tile) is the office
        Today page in one column, built from its exported parts (<Mono>Glance</Mono>,{' '}
        <Mono>TaskBoard</Mono>, <Mono>FormSheet</Mono>, <Mono>greeting()</Mono>, <Mono>readVenue()</Mono>{' '}
        in <Mono>pages/Home.jsx</Mono>), which take <Mono>linkFor</Mono>: <Mono>opsLink(path)</Mono>{' '}
        sends an office path to the phone&apos;s own page (<Mono>/purchasing</Mono> to{' '}
        <Mono>/mobile/purchasing</Mono> with its query, <Mono>/cash-recon</Mono> to{' '}
        <Mono>/mobile/cash-up</Mono>, <Mono>/orders</Mono>, <Mono>/food-safety</Mono> and{' '}
        <Mono>/checklists</Mono> to their phone pages), else to the office site on{' '}
        <Mono>ops.</Mono> (<Mono>standardHref()</Mono>, an <Mono>&lt;a href&gt;</Mono>). Pepper is its
        own tile; the page links to it. The mobile routes end with a catch-all to the hub, so
        links to pages the phone no longer has (<Mono>/mobile/dashboards</Mono>) land there.
      </P>
      <H3>Service worker</H3>
      <P>
        <Mono>vite-plugin-pwa</Mono> (<Mono>admin/vite.config.js</Mono>) builds <Mono>sw.js</Mono> with Workbox. It
        precaches only the built JS, CSS, fonts and images, never <Mono>index.html</Mono>, so a new deploy can&apos;t
        boot from an old cached page; nginx sends <Mono>index.html</Mono> for every app route with no-cache headers.
        Because of that there is no navigation fallback (<Mono>navigateFallback: null</Mono>): a fallback to a page
        that isn&apos;t precached makes Workbox throw <Mono>non-precached-url</Mono> each time the worker starts, which
        showed in every console from 22 Aug to 14 Oct 2026.
      </P>
      <H3>Page crash message</H3>
      <P>
        <Mono>PageErrorBoundary</Mono> (<Mono>components/PageErrorBoundary.jsx</Mono>) wraps the page outlet in
        both <Mono>AppShell</Mono> and <Mono>MobileShell</Mono>, keyed by the path. A page that throws while it renders
        shows &quot;This page stopped working&quot; with the error text and a Reload button, and logs the error with its
        component stack (<Mono>Page crashed:</Mono>), instead of unmounting the whole admin to a blank screen. The
        sidebar and header stay usable, and moving to another page clears it. It doesn&apos;t catch errors in event
        handlers or promises; those still need their own try/catch and a visible message.
      </P>
      <H3>Hidden inputs (sr-only)</H3>
      <P>
        A file, colour or switch input hidden with Tailwind&apos;s <Mono>sr-only</Mono> is absolutely positioned. The
        admin&apos;s shell is a full-height box that never scrolls; pages scroll inside their own panes. An{' '}
        <Mono>sr-only</Mono> input with no positioned parent inside such a pane was placed where it would be with the
        pane unscrolled, below the screen. That made the window itself scrollable, and when the input got focus the
        window scrolled to it and the whole app moved off screen. The browser focuses a file input as its dialog
        closes, so on the GloriaFood import (at the bottom of a long settings pane) picking a file left a blank page.
        The address didn&apos;t change, nothing was logged, and Back fixed it. <Mono>index.css</Mono> now pins{' '}
        <Mono>.sr-only</Mono> to <Mono>top: 0; left: 0</Mono> of its containing block, so it stays on screen. Also give
        the label or wrapper of a hidden input <Mono>relative</Mono>, so the input sits inside it.
      </P>
      <H3>Scoped second PWA manifest</H3>
      <P>
        <Mono>vite-plugin-pwa</Mono> already generates the main app's manifest (
        <Mono>manifest.webmanifest</Mono>, scope <Mono>/</Mono>) and injects its{' '}
        <Mono>{'<link rel="manifest">'}</Mono> tag into <Mono>index.html</Mono> at build
        time. Rather than configure a second plugin instance (this is a single-page SPA —
        there's only one <Mono>index.html</Mono> to inject into), a hand-written static file{' '}
        <Mono>admin/public/mobile.webmanifest</Mono> ships alongside it (scope{' '}
        <Mono>/mobile/</Mono>, <Mono>start_url: /mobile</Mono>, its own name/icons/theme
        colour). <Mono>MobileShell</Mono>'s <Mono>useMobileManifest()</Mono> effect swaps
        the existing <Mono>{'<link rel="manifest">'}</Mono>'s <Mono>href</Mono>, the{' '}
        <Mono>{'<link rel="apple-touch-icon">'}</Mono>'s <Mono>href</Mono>, the{' '}
        <Mono>{'<meta name="theme-color">'}</Mono>, and{' '}
        <Mono>{'<meta name="apple-mobile-web-app-title">'}</Mono> on mount, and restores the
        originals on unmount. iOS reads the apple-touch-icon/title meta tags from whatever
        page is current when "Add to Home Screen" runs (Safari doesn't consult the manifest
        for pre-17.4 behaviour), so swapping those tags — not just the manifest link — is
        what actually changes the installed icon/name on iPhone.
      </P>
      <InfoBox type="warn">
        This swap only takes effect while a <Mono>/mobile</Mono> route is mounted — a user
        who installs from the desktop routes still gets the main "Macaroonie" identity, and
        vice versa. There is no server-side content negotiation involved; both manifests and
        both icon sets ship in every build and are just static files under{' '}
        <Mono>admin/public/</Mono> (<Mono>mobile.webmanifest</Mono>,{' '}
        <Mono>mobile-pwa-192.png</Mono>, <Mono>mobile-pwa-512.png</Mono>,{' '}
        <Mono>mobile-apple-touch-icon.png</Mono>).
      </InfoBox>
      <P>
        <Mono>MobileShell</Mono> also fetches <Mono>GET /me</Mono> and calls{' '}
        <Mono>applySiteTheme(me.site_theme)</Mono> itself, duplicating the effect{' '}
        <Mono>AppShell.jsx</Mono> runs for the desktop app. <Mono>/mobile</Mono> never
        mounts <Mono>AppShell</Mono>, so without this the <Mono>--site-accent</Mono>/{' '}
        <Mono>--site-primary</Mono> CSS variables would never be set on a session that opens
        straight into <Mono>/mobile</Mono> (e.g. the installed PWA's own start URL) — any
        mobile UI that themes itself with those variables (the H&S Dashboard widget headers)
        would silently show the hardcoded fallback colour instead of the tenant's actual
        brand accent.
      </P>
      <H3>Mobile H&amp;S Dashboard</H3>
      <P>
        <Mono>admin/src/pages/mobile/MobileHSDashboard.jsx</Mono> is a parallel
        implementation of <Mono>HSDashboard.jsx</Mono> for logging only — same dashboards-as-tabs
        (<Mono>DashboardTabs</Mono>: framed strip, arrow buttons that scroll it, shown while there
        is more that way), same widget types, same underlying{' '}
        <Mono>/api/hs-dashboards/*</Mono> endpoints and the same shared body components (
        <Mono>ChecklistRunPanel</Mono>, <Mono>TempChecksTable</Mono>,{' '}
        <Mono>DeliveryChecksPanel</Mono>, <Mono>HoldChecksTable</Mono>,{' '}
        <Mono>CookingChecksPanel</Mono>, <Mono>HSActionLogPanel</Mono>) — full interactivity,
        for checks. Layout editing (dashboards and widgets) was removed from the Ops app: it is
        done on the desktop page. <Mono>WIDGET_TYPE_BY_KEY</Mono> is imported from{' '}
        <Mono>HSDashboard.jsx</Mono>.
      </P>
      <P>
        The one deliberate difference: mobile ignores <Mono>col_span</Mono> and{' '}
        <Mono>height_px</Mono> entirely and always renders one full-width column at natural
        content height, so the page itself is the only scroll container — no nested
        scroll-within-scroll widget regions, which is a common mobile UX papercut. Those two
        fields still exist on the shared <Mono>hs_dashboard_widgets</Mono> rows and still
        drive the desktop grid; a widget resized on desktop is unaffected on mobile and vice
        versa, same "one data model, per-surface rendering rules" approach already used for
        website-CMS data blocks.
      </P>
      <InfoBox type="info">
        This first mobile module reuses the existing food-safety/checklist body components
        unmodified — they already use responsive Tailwind classes (
        <Mono>{'hidden sm:table-cell'}</Mono>, <Mono>{'overflow-x-auto'}</Mono> table
        wrappers, <Mono>{'sm:grid-cols-2'}</Mono>) rather than a fixed min-width, so they
        hold up reasonably at phone width without a mobile-specific rewrite. If a future
        mobile module's body component doesn't already reflow this way, redesign that
        component rather than assuming the mobile shell alone will fix it.
      </InfoBox>
      <H3>Mobile Expenses</H3>
      <P>
        <Mono>admin/src/pages/mobile/MobileExpenses.jsx</Mono> — the second mobile module.
        Venue picker + a week navigator (prev / next, a date overlay that jumps to that
        date's Monday via <Mono>getMonday()</Mono>, Back to this week). <Mono>WeekExpensesPanel</Mono>{' '}
        reads the week through <Mono>useReconWeek()</Mono> (week-detail, which now also returns
        each expense's <Mono>receipt_url</Mono>): week cash / card / VAT totals, then one card per
        day (Mon-Sun, closed days labelled from <Mono>open_dates</Mono>, submitted days locked)
        with a per-day Add and tap-to-edit rows. <Mono>useExpenseActions(venueId)</Mono> holds the
        create / update / delete mutations (date passed per call; each invalidates that day
        and week-detail) and is shared with <Mono>PettyCashPanel</Mono>, the single-day panel the
        Cash Dashboard's petty cash widget still uses. The Add/Edit modal has a
        category chip picker and a <Mono>capture="environment"</Mono> file input for
        snapping a receipt photo straight from the phone camera. Reuses the exact same API
        surface as <Mono>CashRecon.jsx</Mono>'s <Mono>ExpensesSection</Mono> (
        <Mono>GET config</Mono> for categories, <Mono>GET/POST/PUT/DELETE
        .../cash-recon/expenses[/:id]</Mono>, <Mono>POST .../expenses/:id/receipt</Mono>) —
        no new backend surface for this feature beyond the bug fix below. Blocked (no Add
        button, inline banner instead) when the day's report is already{' '}
        <Mono>submitted</Mono>, matching what the API now enforces server-side.
      </P>
      <InfoBox type="warn">
        Building this surfaced a live bug in <Mono>POST /:venueId/cash-recon/expenses</Mono>:
        the Zod schema required a <Mono>report_id</Mono> (a UUID for an existing{' '}
        <Mono>cash_daily_reports</Mono> row), but <Mono>ExpensesSection.handleAdd()</Mono> —
        the ONLY caller — has only ever sent <Mono>date</Mono>, never{' '}
        <Mono>report_id</Mono> (it doesn't have one in scope; see its props). Every "Add
        expense" click via that inline form has been failing Zod validation (400) since it
        shipped, silently swallowed by an empty <Mono>catch {'{}'}</Mono>. Fixed by changing
        the endpoint to take <Mono>date</Mono> and find-or-create the daily report row itself
        (the same <Mono>INSERT … ON CONFLICT (tenant_id, venue_id, report_date) DO
        UPDATE … RETURNING *</Mono> upsert <Mono>PUT /daily/:date</Mono> already uses for its
        header row) — this also blocks adding to a submitted report, matching that PUT's
        guard. Both the desktop "Add expense" form and the new mobile page call this same,
        now-working endpoint. Deliberately NOT reusing <Mono>PUT /daily/:date</Mono> itself
        for single-expense writes — that endpoint replaces the day's income/takings/SC
        entries wholesale from the request body, so a caller that only wants to add one
        expense would need to round-trip the entire day's state first to avoid wiping it.
      </InfoBox>
      <H3>Mobile Purchasing</H3>
      <P>
        <Mono>admin/src/pages/mobile/MobilePurchasing.jsx</Mono> (replaced Mobile Order Sheets): a venue
        picker over the same <Mono>PurchasingApp</Mono> as the desktop page with <Mono>phone</Mono> set
        (single column, smaller padding). The order form's header and totals bar are sticky inside
        <Mono> MobileShell</Mono>'s scrolling main. See the Purchasing section.
      </P>
      <H3>Suggesting the mobile view from desktop</H3>
      <P>
        <Mono>admin/src/components/MobileSuggestModal.jsx</Mono>, mounted at the bottom of{' '}
        <Mono>AppShell</Mono> (never rendered under <Mono>MobileShell</Mono> itself, so it
        can't offer to send someone already on <Mono>/mobile</Mono> back to <Mono>/mobile</Mono>).
        Detects a touch device in portrait — <Mono>IS_TOUCH</Mono> (the same{' '}
        <Mono>{'navigator.maxTouchPoints > 0'}</Mono> module-load check used elsewhere) plus a{' '}
        <Mono>{"matchMedia('(max-width: 700px) and (orientation: portrait)')"}</Mono> query,
        checked on mount and on that query's own <Mono>change</Mono> listener so rotating a
        phone into portrait mid-session also triggers it, not just page load. On a match it
        shows a large centred modal pointing at <Mono>/mobile</Mono>. Either button —{' '}
        <Mono>Open mobile view</Mono> (navigates there) or <Mono>Stay on this page</Mono>{' '}
        (dismiss) — sets <Mono>maca_mobile_prompt_dismissed</Mono> in localStorage, so it's a
        one-time offer per browser rather than a repeating nag.
      </P>
      <H3>Persistent mobile / standard toggle</H3>
      <P>
        <Mono>admin/src/components/MobileViewToggle.jsx</Mono> is a separate, always-on
        counterpart to the suggestion modal above — a small floating pill button fixed at{' '}
        <Mono>bottom-4 left-4</Mono>, shown any time the viewport matches{' '}
        <Mono>{"IS_TOUCH && matchMedia('(max-width: 700px)')"}</Mono> (no portrait
        requirement, no dismissal — it reappears on every visit rather than offering once).
        It takes a <Mono>target</Mono> prop: <Mono>{"target=\"mobile\""}</Mono> (mounted in{' '}
        <Mono>AppShell.jsx</Mono>, next to <Mono>MobileSuggestModal</Mono>) navigates to{' '}
        <Mono>/mobile</Mono>. The <Mono>{"target=\"standard\""}</Mono> copy in{' '}
        <Mono>MobileShell.jsx</Mono> was removed once the Ops app had its own host (ops.):
        the phone app has no link back to the standard view.
      </P>
      <H3>Mobile Cash Up</H3>
      <P>
        <Mono>admin/src/pages/mobile/MobileCashUp.jsx</Mono> (<Mono>/mobile/cash-up</Mono>).
        Venue picker + week nav over a plain vertical list of the week's 7 days, each row
        showing the day name/date, a <Mono>StatusBadge</Mono>, total income, and variance —
        fetched from the same <Mono>GET /venues/:id/cash-recon/week/:week_start</Mono>{' '}
        endpoint the desktop <Mono>WeekView</Mono>'s day cards already use. Tapping a day
        opens the module-local <Mono>MobileDayDeclaration</Mono> for the complete daily
        declaration — the same "list, then a full-page detail" shape the other mobile modules use. A "Week variance"
        tile below the list sums the days' variances plus the week's cash wages.
      </P>
      <H3>Single header on the day-detail view</H3>
      <P>
        <Mono>CashRecon.jsx</Mono>'s <Mono>DayView</Mono> renders its own sticky header
        (back arrow, full date, status/save indicator, Submit/Unsubmit) — fine on desktop,
        but under <Mono>MobileShell</Mono> it stacked directly underneath the shell's own
        header, producing two back arrows and two bars. Fixed with a small mechanism rather
        than a rebuild: <Mono>MobileShell.jsx</Mono> exports{' '}
        <Mono>useHideMobileHeader()</Mono> — called by <Mono>MobileDayDeclaration</Mono> to
        suppress the shell's header for as long as it's mounted — and{' '}
        <Mono>MobileMenu</Mono> (re-exported from <Mono>components/mobile/MobileMenu.jsx</Mono>), the
        same three-dot menu the shell header uses, so the replacement header keeps it. <Mono>DayView</Mono> itself gained
        a <Mono>hideHeader</Mono> + <Mono>onStateChange</Mono> prop pair (the same shape as{' '}
        <Mono>ChecklistRunPanel</Mono>'s existing <Mono>hideHeader</Mono>/
        <Mono>onStateChange</Mono>): with <Mono>hideHeader</Mono>, it skips its own header
        div entirely and instead reports <Mono>{'{ status, saving, saved, saveErr, isSubmitted, submitPending, submit, unsubmit }'}</Mono>{' '}
        via <Mono>onStateChange</Mono> on every change, so <Mono>MobileDayDeclaration</Mono>{' '}
        can render one unified header — back arrow (to the day list), an{' '}
        <Mono>EEE, dd MMM</Mono> date (e.g. "Mon, 21 Sep") with the autosave indicator
        underneath, a Submit/Unsubmit button, and sign-out — with <Mono>DayView</Mono>'s
        body rendered underneath it, header-less. No <Mono>StatusBadge</Mono> pill here —
        the Submit/Unsubmit button's own label and colour already say submitted-vs-not, so
        a separate status pill next to the date was redundant (the week-list view above
        keeps its own <Mono>StatusBadge</Mono> per day, since that view has no per-day
        submit button to read the state off instead). The
        underlying visibility toggle is a plain boolean context (mount sets it, unmount
        clears it) — no page content passed through context, so there's no render-loop risk
        from passing JSX/objects through it.
      </P>
      <H3>Mobile Wages</H3>
      <P>
        <Mono>admin/src/pages/mobile/MobileWages.jsx</Mono> (<Mono>/mobile/wages</Mono>) is a venue
        picker and week navigator over <Mono>WeekWagesEditor</Mono> with{' '}
        <Mono>layout="cards"</Mono> (see Cash Reconciliation), so it shows exactly what the
        desktop Wages page and the dashboard widgets show. The earlier Paid checkbox, the
        per-entry <Mono>/paid</Mono> endpoint and the submitted-report lock are gone with wage
        submission (migration 137). It passes <Mono>showBank={'{false}'}</Mono> and{' '}
        <Mono>hidePaidOnForAll</Mono> (Bank is still filled from the pay method; Paid on is set by{' '}
        <Mono>setPaid()</Mono> / <Mono>payInFull()</Mono> to today when today is in the week). In
        the cards layout each person has a header strip with the name in a larger font. The day
        declaration (<Mono>DayView</Mono>) has a read-only Wages paid today card from{' '}
        <Mono>['cash-recon-wages', venueId, week]</Mono>: entries with <Mono>paid_date</Mono> = the
        day, plus a warning for cash paid with no day (counts in the week only).
      </P>
      <H3>Mobile Allergens</H3>
      <P>
        <Mono>admin/src/pages/mobile/MobileAllergens.jsx</Mono> (<Mono>/mobile/allergens</Mono>,
        registry key <Mono>allergens</Mono>) renders <Mono>AllergenLookup</Mono> from{' '}
        <Mono>components/menus/AllergenMatrix.jsx</Mono> with <Mono>phone</Mono>: menu picker and
        search in a <Mono>sticky top-0</Mono> bar inside <Mono>MobileShell</Mono>&apos;s scrolling{' '}
        <Mono>main</Mono>, the tag filter folded behind one button that names the active filters,
        bottom padding so the Standard view pill doesn&apos;t cover the last rows. Menu choice in
        localStorage <Mono>maca_allergen_lookup_mobile</Mono>. Read-only, same{' '}
        <Mono>GET /api/menus/:id/allergens</Mono> as the dashboard widget; no new API.
      </P>
      <H3>Notices and the Office app (migration 262)</H3>
      <P>
        <Mono>/mobile/notices</Mono> (<Mono>MobileNotices</Mono>, from the header menu): the person&apos;s push
        notices (see Today: Task notices). Inside the Macaroonie Office app the phone pages use its bridge for
        sign-in, the push token, speech (<Mono>ChatView</Mono> <Mono>talkMode</Mono> on <Mono>/mobile/assistant</Mono>)
        and the order form&apos;s Scan button (<Mono>canScan()</Mono> / <Mono>scanBarcode()</Mono>). The hub hides a
        tile with a <Mono>module</Mono> the role has none of (the Allergens tile).
      </P>
      <H3>The header menu and tiles without a tile (25 Nov 2026)</H3>
      <P>
        <Mono>components/mobile/MobileMenu.jsx</Mono> is the three-dot button at the right of the header
        (<Mono>data-testid</Mono> <Mono>mobile-menu</Mono>, an amber dot on a shared device with nobody switched
        in) and its panel (<Mono>mobile-menu-panel</Mono>, rows 48 px, closes on a pick, a tap outside or Escape):
        Signed in as (<Mono>/me</Mono> <Mono>full_name</Mono> or <Mono>email</Mono>); on a shared device the
        device, the person (<Mono>shared-person</Mono>) with Lock (<Mono>useSharedLock()</Mono>) and Switch person,
        or Who is this? (<Mono>askWhoNow()</Mono>, both from <Mono>components/SharedDevice.jsx</Mono>); This device
        (<Mono>/mobile/device</Mono>); Switch location (2+ groups: <Mono>TenantSwitcherModal</Mono>, then the same
        page fresh); Notices (<Mono>/mobile/notices</Mono>); Sign out (<Mono>signOut()</Mono>). The shell mounts{' '}
        <Mono>{'<SharedDeviceLayer pill={false} />'}</Mono>, so the phone has no floating pill; the office keeps it.
      </P>
      <P>
        A <Mono>MOBILE_MODULES</Mono> entry with <Mono>hub: false</Mono> keeps its route, its header title and
        links to it, with no tile: Wages (Today&apos;s wages task, <Mono>shared/forms.js</Mono>{' '}
        <Mono>phone</Mono>), Pepper (the ask bar), Notices and This device (the menu).
      </P>
      <H3>Capture, This device and the iPhone build (step 6)</H3>
      <P>
        The hub and Today have <Mono>CaptureButton</Mono> (see Pepper: Captures). <Mono>/mobile/device</Mono>{' '}
        (<Mono>MobileDevice</Mono>, from the header menu) holds <Mono>OfficePinSettings</Mono> and{' '}
        <Mono>SharedDeviceSettings</Mono> (see Shared devices); <Mono>MobileShell</Mono> mounts{' '}
        <Mono>SharedDeviceLayer</Mono>. The Office app builds for both platforms (<Mono>app.json</Mono>{' '}
        <Mono>platforms</Mono>, <Mono>ios.infoPlist</Mono> reason strings, <Mono>app.config.js</Mono> push mode,{' '}
        <Mono>eas.json</Mono>: <Mono>production</Mono> is the store build, an app bundle for Google Play and App Store / TestFlight, <Mono>preview</Mono> and <Mono>development</Mono> an APK to install by hand; <Mono>submit.production.android</Mono> sends to Play&apos;s internal track as a draft); its bridge tells the page{' '}
        <Mono>MacaroonieOffice.platform</Mono> (<Mono>lib/push.js</Mono> labels the device). What differs on an
        iPhone: <Mono>office-app/layout.js</Mono> (<Mono>pagePadding()</Mono>, <Mono>keyboardEvents()</Mono>),{' '}
        <Mono>speechCore.js</Mono> (<Mono>cumulative</Mono>), <Mono>scanCore.js</Mono> (<Mono>scannedCode()</Mono>:
        a UPC-A read as EAN-13). Not built yet: <Mono>eas build -p ios</Mono> needs the owner&apos;s Apple
        developer account (<Mono>office-app/README.md</Mono>). Tests: <Mono>office-app/test/ios.test.mjs</Mono>.
        The Google Play listing is in <Mono>office-app/store-assets/android/</Mono>: <Mono>store-listing.md</Mono>{' '}
        (name, short and full description, Play Console notes), <Mono>icon-512.png</Mono>,{' '}
        <Mono>feature-graphic-1024x500.png</Mono> and seven 1080 x 1920 phone screenshots of the real{' '}
        <Mono>/mobile</Mono> pages on invented data. <Mono>make-assets.mjs</Mono> takes them again (its own{' '}
        API and Vite on a test database, the tests&apos; model stand-in for Pepper) and{' '}
        <Mono>make-assets.py</Mono> checks their sizes and modes.
      </P>
      <H3>Sharing to the Office app (26 Nov 2026)</H3>
      <P>
        The Android app is a share target: <Mono>expo-share-intent</Mono> (9.0.0, for Expo SDK 58) and its config
        plugin in <Mono>office-app/app.json</Mono> put <Mono>SEND</Mono> (<Mono>image/*</Mono>,{' '}
        <Mono>text/plain</Mono>) and <Mono>SEND_MULTIPLE</Mono> (<Mono>image/*</Mono>) intent filters on the main
        activity; the iPhone&apos;s share extension is off (<Mono>disableIOS</Mono>). <Mono>App.js</Mono>{' '}
        (<Mono>useShareTarget()</Mono>) listens to the library&apos;s native module (<Mono>onChange</Mono>,{' '}
        <Mono>getShareIntent()</Mono> on start and on coming to the front), and <Mono>office-app/shareCore.js</Mono>{' '}
        has the rules: <Mono>whatWasShared()</Mono> (the first picture and how many more, words, or a refusal),{' '}
        <Mono>readShared()</Mono> (the picture shrunk natively with <Mono>expo-image-manipulator</Mono> to 2,000 px
        on the long side, JPEG 0.8 then 0.6, at most 5 MB, the content address tried before the cached copy),{' '}
        <Mono>createShareInbox()</Mono> (one item, in memory only, taken once, dropped after 10 minutes). The
        bridge&apos;s share part: <Mono>MacaroonieOffice.share.take()</Mono> (the call{' '}
        <Mono>share.take</Mono>, behind the same <Mono>bridgeAllowed()</Mono> check as the token:{' '}
        <Mono>{"{ kind: 'image', name, type, dataBase64, more }"}</Mono> | <Mono>{"{ kind: 'text', text }"}</Mono> |{' '}
        <Mono>{"{ kind: 'refused', message }"}</Mono> | <Mono>null</Mono>) and{' '}
        <Mono>share.onShared(fn)</Mono>, fired by <Mono>sharedScript()</Mono> with no data in it. On a share the
        app tells a page on <Mono>{'ops.<root>/mobile'}</Mono> (<Mono>onPhonePages()</Mono> in{' '}
        <Mono>links.js</Mono>), or loads the phone home. Page side, <Mono>lib/officeApp.jsx</Mono>:{' '}
        <Mono>canTakeShared()</Mono>, <Mono>onShared()</Mono>, <Mono>sharedItem()</Mono> (base64 to a{' '}
        <Mono>File</Mono>, JPEG / PNG / GIF / WebP only), <Mono>takeShared()</Mono>,{' '}
        <Mono>useSharedItem(ready)</Mono> (<Mono>MobileHub</Mono>, once <Mono>/me</Mono> is loaded) and{' '}
        <Mono>useSharedGoesToHub()</Mono> (<Mono>MobileShell</Mono>: another phone page goes to the hub). The hub
        opens <Mono>CaptureButton</Mono> with it, or shows <Mono>shared-no-capture</Mono> to a role without Pepper.
        Everything is feature-detected, so builds of the app from before this behave as they did. Tests:{' '}
        <Mono>office-app/test/share.test.mjs</Mono>.
      </P>
    </section>
  )
}
