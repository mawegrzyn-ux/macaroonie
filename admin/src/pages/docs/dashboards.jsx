// src/pages/docs/dashboards.jsx
// The Docs page's "Dashboards (shared widgets)" section. Docs.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, Mono, DataTable, InfoBox } from './parts.jsx'

export const id = 'dashboards'
export const label = 'Dashboards (shared widgets)'
export const order = 170

// ── DASHBOARDS (SHARED WIDGETS) ───────────────────
export function Section() {
  return (
    <section id="dashboards" data-doc="">
      <H2>Dashboards (shared widgets)</H2>
      <P>
        Migration 152. Every dashboard, whatever its kind, can hold every widget type, and a
        fourth kind, <Mono>'custom'</Mono>, gives blank dashboards on the Dashboards page
        (<Mono>/dashboards</Mono>, <Mono>pages/Dashboards.jsx</Mono>). The kinds still keep
        dashboards apart (each page lists only its own) and each is gated by its own module;
        only the widget lists were merged.
      </P>
      <DataTable
        head={['Kind', 'Page', 'API mount', 'Module']}
        rows={[
          ['hs', '/hs-dashboard (HSDashboard.jsx)', '/api/hs-dashboards', 'hs_dashboard'],
          ['cash', '/cash-dashboard (CashDashboard.jsx)', '/api/cash-dashboards', 'cash_dashboard'],
          ['rota', '/rota-dashboard (RotaDashboard.jsx)', '/api/rota-dashboards', 'rota_dashboard'],
          ['custom', '/dashboards (Dashboards.jsx; not on the phone)', '/api/custom-dashboards', 'custom_dashboard (core, no tenant switch)'],
        ]}
      />
      <H3>API (routes/hsDashboards.js)</H3>
      <P>
        <Mono>WIDGET_MODULE</Mono> maps every widget type to the module whose data it shows,
        and <Mono>WIDGET_TYPES</Mono> (its keys) replaced <Mono>WIDGET_TYPES_BY_KIND</Mono>:
        every mount accepts every type. <Mono>POST /dashboards/:id/widgets</Mono> also needs
        at least view on that module (<Mono>permissionLevel()</Mono> from{' '}
        <Mono>middleware/auth.js</Mono>), else 403 "You don't have access to ..., so you can't
        add that widget.". This is a convenience check only: the widget's data comes from
        that module's own routes, which check it on every read. <Mono>POST /dashboards</Mono>{' '}
        now checks the venue belongs to the tenant (404) and puts a new dashboard after the
        venue's others of that kind. The <Mono>widget_type</Mono> CHECK already listed every
        type, so the migration only widens the <Mono>kind</Mono> CHECK.
      </P>
      <DataTable
        head={['Module', 'Widget types']}
        rows={[
          ['checklists', 'checklist'],
          ['food_safety', 'temp_checks, delivery_checks, hold_checks, cooking_checks'],
          ['hs_action_log', 'action_log'],
          ['menus', 'allergen_lookup'],
          ['cash_recon', 'every cash_* type except cash_tips_payout'],
          ['rota_tips', 'cash_tips_payout, rota_tips'],
          ['rota', 'rota_grid, rota_today'],
          ['rota_pay', 'rota_week_pay'],
        ]}
      />
      <P>
        Migration 152 also adds <Mono>custom_dashboard</Mono> to every role's{' '}
        <Mono>permissions</Mono> (built-in: viewer view, others manage; custom roles copy their{' '}
        <Mono>hs_dashboard</Mono> level, else view) and a Dashboards nav link straight after
        the Overview link (<Mono>route = '/'</Mono>), or at the end of the top level when a
        tenant has no Overview link. <Mono>ROUTE_CATALOG</Mono>, <Mono>defaultNav.js</Mono>,
        the Overview <Mono>SHORTCUT_OPTIONS</Mono> and the mobile registry include it.
      </P>
      <H3>Dashboards per role (migration 229)</H3>
      <P>
        <Mono>hs_dashboards.hidden_role_ids</Mono> (uuid[], default empty) lists the roles a
        dashboard is hidden from, as <Mono>nav_items</Mono> and <Mono>dashboard_tiles</Mono>{' '}
        do. <Mono>GET /dashboards</Mono> leaves out those hidden from the caller&apos;s role{' '}
        (<Mono>effectiveRoleId()</Mono> in <Mono>services/roles.js</Mono>: the custom role, else
        the built-in row for <Mono>users.role</Mono>); with <Mono>?all=1</Mono> someone with
        Manage on the page gets every dashboard (the admin asks for it while editing the
        layout), and platform admins always do. <Mono>GET /dashboards/:id/widgets</Mono> is 404
        for a hidden dashboard to anyone below Manage. <Mono>POST</Mono> and{' '}
        <Mono>PATCH /dashboards</Mono> take <Mono>hidden_role_ids</Mono>, checked by{' '}
        <Mono>ownRoleIds()</Mono> (the tenant&apos;s own roles, duplicates dropped, else 400),
        which the nav item and Overview tile routes now use too (they stored any uuid before;
        the nav PATCH also checks <Mono>parent_id</Mono> is the tenant&apos;s). Hiding is not
        access control for data: every widget still reads its own module&apos;s routes.
      </P>
      <P>
        Admin: <Mono>components/dashboards/RoleVisibilityModal.jsx</Mono>{' '}
        (<Mono>RoleVisibilityModal</Mono>, a tick per role; <Mono>visibilityText()</Mono>) is
        shared by the Overview tiles and <Mono>DashboardPage</Mono> (<Mono>HSDashboard.jsx</Mono>):
        the edit strip&apos;s <Mono>Seen by</Mono> button (<Mono>dash-roles</Mono>), tabs marked
        with an eye while editing (<Mono>data-hidden</Mono>, <Mono>data-hidden-from-me</Mono>),
        the list query keyed by edit mode with <Mono>placeholderData</Mono> kept for the same
        venue so the open tab survives the switch.
      </P>
      <H3>Admin: one catalog, one navigator</H3>
      <P>
        <Mono>components/dashboards/widgetTypes.jsx</Mono> is the only widget catalog:{' '}
        <Mono>WIDGET_TYPES</Mono> (H&amp;S and Menus types defined there, plus{' '}
        <Mono>CASH_WIDGET_TYPES</Mono> from <Mono>cashRecon/widgets.jsx</Mono> and{' '}
        <Mono>ROTA_WIDGET_TYPES</Mono> from <Mono>staff/rotaWidgets.jsx</Mono>), each with{' '}
        <Mono>group</Mono> (Add widget heading, <Mono>WIDGET_GROUPS</Mono>),{' '}
        <Mono>module</Mono> (same map as the API) and <Mono>nav</Mono> (<Mono>'day'</Mono> |{' '}
        <Mono>'week'</Mono> | <Mono>null</Mono>). <Mono>renderWidget()</Mono> draws any type;{' '}
        <Mono>canUseWidget(meta, me)</Mono> decides whether a viewer sees it (from{' '}
        <Mono>/me</Mono>'s <Mono>permissions</Mono>); <Mono>NoAccess</Mono> is shown in its
        place otherwise, and the header figure and checklist action are left out.
      </P>
      <P>
        <Mono>DashboardPage</Mono> no longer takes <Mono>widgetTypes</Mono>,{' '}
        <Mono>renderWidget</Mono> or <Mono>useNav</Mono>. A config now gives{' '}
        <Mono>apiBase</Mono>, <Mono>keyPrefix</Mono>, <Mono>title</Mono>, <Mono>icon</Mono>,{' '}
        <Mono>primaryGroup</Mono> (listed first in <Mono>AddWidgetModal</Mono>),{' '}
        <Mono>defaultNav</Mono> (navigator mode while no widget needs a date), the optional{' '}
        <Mono>HeaderExtra</Mono>, the empty-state texts and <Mono>moduleKey</Mono> (the
        page&apos;s dashboard module, the same one the API mount uses). Every layout control
        (Edit layout, New dashboard, Create dashboard, Add widget, and everything inside Edit
        layout) shows only when <Mono>canEditLayout</Mono>: platform admin or{' '}
        <Mono>me.permissions[moduleKey] === &apos;manage&apos;</Mono>, matching the API, which
        refuses every layout write without Manage. View users get read-only empty-state
        wording instead of the buttons. <Mono>AddWidgetModal</Mono> lists
        every type the person can use, grouped, and says how many it left out. The header has
        a <Mono>New dashboard</Mono> button (no need to enter Edit layout).{' '}
        <Mono>ClosedDayNotice</Mono> shows on any dashboard with an H&amp;S day widget (
        <Mono>hasHsDayWidget()</Mono>), not only the H&amp;S one.
      </P>
      <P>
        <Mono>components/dashboards/nav.jsx</Mono>: <Mono>useDashboardNav()</Mono> keeps one
        selected day; <Mono>ctx = {'{ date, weekStart, selectedDay, setSelectedDay }'}</Mono>{' '}
        (<Mono>selectedDay</Mono> is <Mono>date</Mono>, <Mono>weekStart</Mono> its Monday),
        so H&amp;S widgets (<Mono>ctx.date</Mono>) and cash/rota widgets (
        <Mono>ctx.weekStart</Mono> + <Mono>ctx.selectedDay</Mono>) share it.{' '}
        <Mono>navModeFor(widgets, WIDGET_TYPE_BY_KEY, fallback)</Mono> picks{' '}
        <Mono>'day'</Mono>, <Mono>'week'</Mono> (week step keeps today if it's in that week,
        else the Monday, as <Mono>useWeekNav()</Mono> did) or <Mono>'both'</Mono> (day arrows
        inside week arrows, two-line label): day widgets and week widgets together, or one
        widget whose own <Mono>nav</Mono> is <Mono>'both'</Mono> (the import widget).{' '}
        <Mono>DashboardNav</Mono> draws it, with the
        invisible <Mono>input[type=date]</Mono> over the label in every mode;{' '}
        <Mono>mobile</Mono> makes it full width. Today is the browser's local date (the old
        H&amp;S navigator used UTC). <Mono>useWeekNav()</Mono> stays in{' '}
        <Mono>cashRecon/widgets.jsx</Mono> for the Rota page only.
      </P>
      <P>
        Phone: <Mono>pages/mobile/MobileDashboard.jsx</Mono> exports{' '}
        <Mono>MobileDashboardPage({'{ apiBase, keyPrefix, defaultNav, emptyText, emptyWidgetsText }'})</Mono>{' '}
        (read-only layout, any widget, same navigator); <Mono>MobileHSDashboard.jsx</Mono> is
        that page for the H&amp;S kind. The blank (custom) dashboards aren&apos;t on the phone
        (<Mono>/mobile/dashboards</Mono> was removed; old links land on the hub through the
        mobile routes&apos; catch-all). <Mono>PayHeader</Mono>/<Mono>TipsHeader</Mono> moved from{' '}
        <Mono>RotaDashboard.jsx</Mono> to <Mono>staff/rotaWidgets.jsx</Mono> (the Rota page
        imports them from there).
      </P>
      <InfoBox type="warn">
        Adding a widget type now means: the <Mono>widget_type</Mono> CHECK (migration),{' '}
        <Mono>WIDGET_MODULE</Mono> in <Mono>hsDashboards.js</Mono>, and the type in its group's
        list plus its renderer (reached through <Mono>renderWidget()</Mono> in{' '}
        <Mono>widgetTypes.jsx</Mono>) with a <Mono>module</Mono> and <Mono>nav</Mono>. It is
        then offered on every dashboard, desktop and phone.
      </InfoBox>
    </section>
  )
}
