// src/pages/docs/hs-dashboard.jsx
// The Docs page's "H&S Dashboard" section. Docs.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, Mono, DataTable, InfoBox } from './parts.jsx'

export const id = 'hs-dashboard'
export const label = 'H&S Dashboard'
export const order = 180

// ── H&S DASHBOARD ───────────────────────────────
export function Section() {
  return (
    <section id="hs-dashboard" data-doc="">
      <H2>H&amp;S Dashboard</H2>
      <P>
        Customisable dashboards (migrations 086–088) combining any mix of checklist and
        food-safety check widgets behind one date navigator. Deliberately built as a thin
        layout layer over the existing Food safety / Checklists data and components — there
        is no separate data model per widget type, just a reference to which
        template/venue/check-type to render.
      </P>
      <H3>Schema</H3>
      <DataTable
        head={['Table', 'Purpose']}
        rows={[
          ['hs_dashboards', 'One row per named dashboard (shown as a tab). venue_id, kind (hs | cash | rota | custom), name, column_count, sort_order.'],
          ['hs_dashboard_widgets', 'One row per widget on a dashboard. widget_type enum (checklist / temp_checks / delivery_checks / hold_checks / cooking_checks / action_log), checklist_template_id (nullable, only for widget_type=checklist), title_override, col_span, height_px, sort_order.'],
        ]}
      />
      <H3>API</H3>
      <P>
        Mounted at <Mono>/api/hs-dashboards</Mono>, gated by <Mono>requirePermission('hs_dashboard', …)</Mono>.
        CRUD + <Mono>PUT /reorder</Mono> for dashboards, and CRUD + <Mono>PUT
        /:id/widgets/reorder</Mono> for widgets. Widget resize (col_span, height_px) goes
        through the same widget <Mono>PATCH</Mono>.
      </P>
      <H3>Rendering</H3>
      <P>
        <Mono>admin/src/pages/HSDashboard.jsx</Mono> renders each widget by
        <Mono> widget_type</Mono> using the exact same shared components as the Food safety
        and Checklists pages (<Mono>ChecklistRunPanel</Mono>, <Mono>TempChecksTable</Mono>,
        <Mono> DeliveryChecksPanel</Mono>, <Mono>HoldChecksTable</Mono>,
        <Mono> CookingChecksPanel</Mono>) — one implementation of each check type reused in
        three places (its own page, this dashboard, and nowhere else). The container is
        full width (<Mono>w-full</Mono> plus <Mono>p-4 md:p-6</Mono>); it used to be{' '}
        <Mono>w-[90%] mx-auto</Mono>, which left a visible empty strip down the left on a
        tablet.
      </P>
      <P>
        <strong>Columns shrink, never drop.</strong> The grid is always exactly{' '}
        <Mono>column_count</Mono> columns: <Mono>repeat(column_count, minmax(0, 1fr))</Mono>.
        On a narrower screen, each column gets narrower, so the layout the operator built is
        kept. Two half-width widgets stay side by side on a portrait iPad instead of
        stacking. Content wider than its card (e.g. a temperature table) scrolls inside the
        card body. This replaced <Mono>repeat(column_count, minmax(240px, 1fr))</Mono>{' '}
        inside <Mono>overflow-x-auto</Mono>, which overflowed sideways. It also replaced a
        short-lived <Mono>ResizeObserver</Mono> version that dropped to fewer columns on
        narrow screens, which broke the side-by-side layout.
      </P>
      <P>
        <strong>Date and tabs row.</strong> The date navigator and the dashboard tabs share
        one row that wraps only below <Mono>sm</Mono> (<Mono>flex-wrap sm:flex-nowrap</Mono>).
        From <Mono>sm</Mono> up, the tabs strip is <Mono>flex-1 min-w-0 overflow-x-auto</Mono>,
        so it scrolls sideways instead of dropping to a second line. The date label is{' '}
        <Mono>w-44</Mono>, with the shorter <Mono>EEE d MMM yyyy</Mono> format.
      </P>
      <P>
        <strong>Full screen.</strong> <Mono>toggleFullscreen()</Mono> uses{' '}
        <Mono>requestFullscreen</Mono> or <Mono>webkitRequestFullscreen</Mono> (iPad
        Safari) and listens to both <Mono>fullscreenchange</Mono> and{' '}
        <Mono>webkitfullscreenchange</Mono>. If neither API exists, or the request promise
        rejects, it falls back to a "pseudo" full screen instead. That pins the container
        over the whole app (<Mono>fixed inset-0 z-50</Mono>) and is tracked in{' '}
        <Mono>pseudoFullscreen</Mono> state. This is the only mode that works on an iPad
        home-screen (standalone) app, which has no Fullscreen API at all.
      </P>
      <InfoBox type="info">
        The date navigator (prev/next day, Today, click-to-open native date picker) uses a
        fixed-width label button plus an invisible <Mono>input[type=date]</Mono> overlay —
        the same "styled button + native picker" pattern used on Timeline and Bookings, not
        a custom calendar component.
      </InfoBox>
      <InfoBox type="warn">
        A card's size is fixed by the grid, never by its content. It spans a whole
        number of fixed-height rows (see "Row spanning" under Cash Dashboard), and the body
        is <Mono>flex-1 min-h-0 overflow-auto</Mono>, so taller content scrolls and shorter
        content leaves blank space instead of collapsing the card. This replaced an explicit{' '}
        <Mono>height: heightPx</Mono> on the body, which in turn had replaced{' '}
        <Mono>maxHeight</Mono> (a max-height let short content shrink the card below the
        chosen size). The Overview tiles (<Mono>Dashboard.jsx</Mono>'s <Mono>TileCard</Mono>)
        use the same grid.
      </InfoBox>
      <P>
        Each widget's header bar uses <Mono>var(--site-accent-soft)</Mono> background /{' '}
        <Mono>var(--site-accent)</Mono> border, the same theming Cash Reconciliation's{' '}
        <Mono>SectionCard</Mono> header uses (see the Cash Reconciliation section) — applied
        inline via <Mono>style</Mono>, not a Tailwind class, since the value comes from a CSS
        variable set at runtime by <Mono>SettingsContext.applySiteTheme()</Mono>. This only
        works if something in the current route tree has actually called{' '}
        <Mono>applySiteTheme()</Mono> — see the Mobile App section for why{' '}
        <Mono>MobileShell.jsx</Mono> needed its own copy of that fetch-and-apply effect.
      </P>
    </section>
  )
}
