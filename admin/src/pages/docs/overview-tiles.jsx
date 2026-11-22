// src/pages/docs/overview-tiles.jsx
// The Docs page's "Overview Tiles" section. Docs.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, Mono, DataTable, InfoBox } from './parts.jsx'

export const id = 'overview-tiles'
export const label = 'Overview Tiles'
export const order = 240

// ── OVERVIEW TILES ──────────────────────────────
export function Section() {
  return (
    <section id="overview-tiles" data-doc="">
      <H2>Overview Tiles</H2>
      <P>
        Migration 093 turns the home page ("Dashboard", renamed "Overview") into a
        tile-based layout. Simpler than <Mono>hs_dashboards</Mono>/<Mono>hs_dashboard_widgets</Mono> —
        there's no multiple-named-dashboards concept, since Overview is tenant-wide (not
        per-venue). Layout control (<Mono>col_span</Mono>/<Mono>height_px</Mono>/<Mono>sort_order</Mono>)
        mirrors <Mono>hs_dashboard_widgets</Mono>; per-role visibility
        (<Mono>hidden_role_ids</Mono>) mirrors <Mono>nav_items</Mono>. Gated by the existing
        <Mono> dashboard</Mono> module (relabelled "Overview") — no new module was needed.
      </P>
      <H3>Schema</H3>
      <DataTable
        head={['Table / column', 'Purpose']}
        rows={[
          ['dashboard_tiles', "One row per tile. tile_type (CHECK-constrained enum), title_override, hidden_role_ids uuid[], col_span, height_px, sort_order. UNIQUE(tenant_id, tile_type) — a tenant can't add the same tile twice."],
        ]}
      />
      <H3>Tile types</H3>
      <DataTable
        head={['tile_type', 'Source']}
        rows={[
          ['quick_access', "Your pins: the person's own pins (components/home/Pins.jsx, GET / PUT /api/pins, migration 272), the same strip as on Home. A separate personalisation axis from tile layout."],
          ['stats_today', 'The 4 stat cards (bookings/covers/deposit revenue/upcoming), computed client-side from GET /api/bookings for today.'],
          ['upcoming_bookings', "Today's remaining bookings, same data source as stats_today."],
          ['venues_status', 'One row per venue from GET /api/venues.'],
          ['hs_today_status', "Combined Checklists + Food safety status for today, from GET /api/dashboard-tiles/hs-status."],
          ['hs_week_status', 'Same endpoint, Monday-to-Sunday range for the current week.'],
          ['allergen_lookup', 'AllergenLookup from components/menus/AllergenMatrix.jsx over GET /api/menus/:id/allergens (migration 141). Menu choice in localStorage maca_allergen_lookup_overview.'],
        ]}
      />
      <H3>API — /api/dashboard-tiles</H3>
      <P>
        Gated by <Mono>requirePermission('dashboard', 'view' | 'manage')</Mono>. Standard
        CRUD + <Mono>PATCH /reorder</Mono> follow the same shape as every other reorderable
        list in this codebase (fs_hold_stations, hs_action_categories, …).
        <Mono> POST /</Mono> rejects with 422 if the tenant already has that
        <Mono> tile_type</Mono>.
      </P>
      <H3>GET /hs-status — the combined status computation</H3>
      <P>
        Query params: <Mono>from</Mono>, <Mono>to</Mono> (both YYYY-MM-DD), optional
        <Mono> today</Mono> (client-supplied "today" — the server never assumes its own
        timezone matches the viewer's). For each date in range and each active venue, sums:
      </P>
      <DataTable
        head={['Component', 'Expected', 'Completed']}
        rows={[
          ['Checklists', 'Count of active checklist_templates for the venue (every template counts every day — see the Checklists section on why due_day is advisory, not filtering).', "Templates whose current period's checklist_instances.status = 'completed' (period computed via the same periodStartFor() used by checklists.js — factored into utils/checklistPeriod.js so the two can never drift)."],
          ['Equipment temp checks', '(active fs_equipment) × (active fs_capture_times) for the venue.', 'Distinct (equipment_id, capture_time_id) pairs logged in fs_temp_logs for that date (capture_time_id IS NOT NULL only — ad-hoc logs don\'t count toward a slot).'],
          ['Hold checks', 'Same pattern with fs_hold_stations × fs_hold_capture_times.', 'Same pattern against fs_hold_checks.'],
          ['Cooking checks', 'SUM(required_items_count) across active fs_cooking_sessions.', 'Per session, MIN(checks logged for that session+date, required_items_count), summed.'],
        ]}
      />
      <P>
        <Mono>unresolved</Mono> is computed separately: any row in fs_temp_logs /
        fs_hold_checks / fs_cooking_checks for that date with
        <Mono> is_within_range = false AND corrective_action IS NULL</Mono> — the exact same
        predicate <Mono>EndOfDayReview</Mono> already uses client-side. Deliveries are logged
        ad hoc (no schedule, so no "expected count"), so they never count toward
        expected/completed — but a <Mono>fs_delivery_checks</Mono> row for that date that
        failed any check (<Mono>NOT (packaging_ok AND damage_ok AND quality_ok AND temp_ok AND
        accepted)</Mono>) with <Mono>corrective_action IS NULL</Mono> does count toward{' '}
        <Mono>unresolved</Mono>, so a rejected delivery nobody dealt with turns the day red.
      </P>
      <P>
        Each venue result also carries a per-check-type breakdown, used by the{' '}
        <Mono>hs_today_status</Mono> tile's expanded list (not by <Mono>hs_week_status</Mono>,
        which only shows the day's overall dot): <Mono>checklists: [{'{'}id, name, frequency,
        completed{'}'}]</Mono> — one entry per active template, checklists don't have an{' '}
        <Mono>unresolved</Mono> concept so it's a plain done/not-done boolean — and{' '}
        <Mono>categories: [{'{'}key, label, expected, completed, unresolved, status{'}'}]</Mono>{' '}
        — one aggregate entry each for equipment/hold/cooking, included only when that
        category has <Mono>expected &gt; 0</Mono> for the venue (skips clutter for check
        types the venue hasn't configured). A fourth <Mono>delivery</Mono> category appears
        only when at least one delivery was logged that day; its expected/completed both equal
        the number logged, it carries a <Mono>summary</Mono> string ("3 logged · 1 issue")
        that the tile shows instead of the usual <Mono>completed/expected</Mono> fraction, and
        its status is simply red (any unresolved) or green.
      </P>
      <H3>Status derivation</H3>
      <DataTable
        head={['Status', 'Condition']}
        rows={[
          ['red', 'unresolved > 0 (checked first — an outstanding food-safety issue always outranks the completion count), OR expected > 0 and completed === 0.'],
          ['amber', '0 < completed < expected, no unresolved issues.'],
          ['green', 'completed >= expected, expected > 0, no unresolved issues.'],
          ['grey', 'expected === 0 (nothing configured/due that day).'],
          ['upcoming', "date > today, overriding every other branch — standing configuration (equipment, sessions, etc.) doesn't vary by date, so a future date would otherwise compute a real (and misleadingly red) expected/completed pair."],
        ]}
      />
      <InfoBox type="warn">
        postgres.js deserialises <Mono>date</Mono> columns to JS <Mono>Date</Mono> objects,
        not strings. The <Mono>checklist_instances.period_start</Mono> query MUST cast to
        <Mono> ::text</Mono> (matching the existing <Mono>log_date::text</Mono> /
        <Mono> check_date::text</Mono> casts on the food-safety queries) or the
        <Mono>{' `${template_id}|${period_start}`'}</Mono> map-key lookup silently never matches
        — a weekly/monthly checklist marked complete would never show as complete in this
        aggregation. Caught by a direct test against a disposable Postgres before shipping;
        see <Mono>api/src/routes/dashboardTiles.js</Mono>.
      </InfoBox>
      <H3>Responsive layout</H3>
      <P>
        The tile grid is <Mono>grid-cols-1 sm:grid-cols-2 lg:grid-cols-4</Mono> — it only
        actually has 4 columns at the <Mono>lg</Mono> breakpoint. Each tile's stored{' '}
        <Mono>col_span</Mono> (1-4 "quarters") maps through a <Mono>SPAN_CLASSES</Mono>{' '}
        lookup on <Mono>TileCard</Mono> (<Mono>{"{1: 'col-span-1', 2: 'col-span-1 sm:col-span-2', 3: '... lg:col-span-3', 4: '... lg:col-span-4'}"}</Mono>)
        instead of a raw <Mono>{"style={{ gridColumn: `span ${colSpan}` }}"}</Mono>, so a
        tile configured 4-wide degrades to full-width on a 1- or 2-column grid rather than
        overflowing it. The page header also reserves{' '}
        <Mono>max-lg:notouch:pl-14</Mono> so its title doesn't sit under{' '}
        <Mono>AppShell</Mono>'s floating hamburger button. See "Hamburger placement" in the
        Admin portal layout notes for the general pattern every new page header under{' '}
        <Mono>AppShell</Mono> should follow.
      </P>
      <H3>Hamburger placement (AppShell)</H3>
      <P>
        The collapsed-sidebar menu button behaves differently on touch and non-touch
        devices, matching <Mono>AppShell</Mono>'s <Mono>IS_TOUCH</Mono> check{' '}
        (<Mono>navigator.maxTouchPoints &gt; 0</Mono>):
      </P>
      <ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground mb-3">
        <li><strong>Touch devices (any width):</strong> the button sits in a{' '}
        <Mono>w-14</Mono> in-flow rail at the left edge of the shell, centred in an{' '}
        <Mono>h-14</Mono> cell so it lines up with the standard <Mono>h-14</Mono> page
        headers. Page content starts to the right of the rail, so no page needs to reserve
        space for the button. The sidebar itself still opens as a <Mono>fixed</Mono>{' '}
        overlay with a backdrop.</li>
        <li><strong>Non-touch devices below <Mono>lg</Mono>:</strong> a floating{' '}
        <Mono>fixed top-2.5 left-3.5 z-40</Mono> button. Page headers reserve room for it
        with <Mono>max-lg:notouch:pl-14</Mono>.</li>
        <li><strong>Non-touch devices at <Mono>lg</Mono> and up:</strong> the{' '}
        <Mono>w-14</Mono> icon-rail sidebar. There's no floating button.</li>
      </ul>
      <P>
        <Mono>notouch:</Mono> is a custom Tailwind variant (<Mono>tailwind.config.js</Mono>,{' '}
        <Mono>{":root:not([data-touch]) &"}</Mono>). <Mono>main.jsx</Mono> sets{' '}
        <Mono>{'<html data-touch>'}</Mono> before first render using the same{' '}
        <Mono>maxTouchPoints</Mono> test. Its selector specificity also beats a header's own
        responsive padding such as <Mono>sm:px-6</Mono>. The old <Mono>pl-14 lg:pl-6</Mono>{' '}
        on the Overview lost to <Mono>sm:px-6</Mono>, which is why "Overview" sat under the
        button.
      </P>
    </section>
  )
}
