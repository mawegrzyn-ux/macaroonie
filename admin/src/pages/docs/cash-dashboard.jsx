// src/pages/docs/cash-dashboard.jsx
// The Docs page's "Cash Dashboard" section. Docs.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, Mono, DataTable, InfoBox } from './parts.jsx'

export const id = 'cash-dashboard'
export const label = 'Cash Dashboard'
export const order = 190

// ── CASH DASHBOARD ───────────────────────────────
export function Section() {
  return (
    <section id="cash-dashboard" data-doc="">
      <H2>Cash Dashboard</H2>
      <P>
        <Mono>/cash-dashboard</Mono> (<Mono>pages/CashDashboard.jsx</Mono>) runs on the same
        engine as the H&amp;S Dashboard. <Mono>HSDashboard.jsx</Mono> exports{' '}
        <Mono>DashboardPage({'{ config }'})</Mono>, which owns tabs, edit mode, widget CRUD,
        the grid and full screen. Since migration 152 the widget catalog, renderers and
        navigator are shared by every dashboard (see Dashboards (shared widgets)); a config
        only gives the API mount, title, <Mono>primaryGroup</Mono> and{' '}
        <Mono>defaultNav</Mono>. Cash widgets read <Mono>ctx.weekStart</Mono>,{' '}
        <Mono>ctx.selectedDay</Mono> and <Mono>ctx.setSelectedDay</Mono>. A widget type with{' '}
        <Mono>flush: true</Mono> renders without body padding (the grid widget).
      </P>
      <H3>Storage and API (migration 101)</H3>
      <P>
        No new tables. <Mono>hs_dashboards.kind</Mono> (<Mono>'hs' | 'cash'</Mono>, default{' '}
        <Mono>'hs'</Mono>) splits the two. <Mono>routes/hsDashboards.js</Mono> is registered
        twice in <Mono>app.js</Mono>: <Mono>/api/hs-dashboards</Mono> with{' '}
        <Mono>{"{ kind: 'hs', moduleKey: 'hs_dashboard' }"}</Mono> and{' '}
        <Mono>/api/cash-dashboards</Mono> with{' '}
        <Mono>{"{ kind: 'cash', moduleKey: 'cash_dashboard' }"}</Mono>. Each mount filters
        every query by its kind (including widget PATCH/DELETE, which load the parent
        dashboard first) and is gated by its own module. Until migration 152 each mount also
        accepted only its own <Mono>WIDGET_TYPES_BY_KIND[kind]</Mono>; now every mount accepts
        every type. The <Mono>widget_type</Mono> CHECK constraint lists every type.
      </P>
      <P>
        New module <Mono>cash_dashboard</Mono> in the <Mono>cash_recon</Mono> group (one tenant
        switch covers both). The migration copies each tenant's <Mono>cash_recon</Mono>{' '}
        switch and each role's <Mono>cash_recon</Mono> permission onto it, and inserts a{' '}
        <Mono>/cash-dashboard</Mono> nav link straight after <Mono>/cash-recon</Mono>.{' '}
        <Mono>ROUTE_CATALOG</Mono>, <Mono>defaultNav.js</Mono> and the Overview{' '}
        <Mono>SHORTCUT_OPTIONS</Mono> include it too.
      </P>
      <H3>Widgets</H3>
      <DataTable
        head={['widget_type', 'Source']}
        rows={[
          ['cash_day_tiles', 'useReconWeek() — tile per date, status, dayTotal(income), variance(). Tap sets ctx.selectedDay and opens DayView (exported from CashRecon.jsx) in a fixed inset-0 z-50 overlay rendered inline, so it stays inside the dashboard\'s full-screen element; closing invalidates cash-recon-week-detail. Options (settings): hide_closed (filter to calc.visibleDates), compact (76px tiles, status dot + variance)'],
          ['cash_day_balance', 'useReconWeek() — day figures for ctx.selectedDay'],
          ['cash_week_balance', 'useReconWeek() — weekDayTotal, weekExpenses, weekCardExpenses, weekCashWages, weekVariance'],
          ['cash_recon_grid', 'SpreadsheetView with hideHeader (editable; saves through PUT /daily/:date)'],
          ['cash_wages_paid', 'WeekWagesEditor (GET /wages/:week_start + config, Save = PUT /wages/:week_start); HeaderValue: cash paid. Widget options (WAGES_OPTIONS in widgets.jsx, widget.settings): hide_manage → hideManage (no add/copy/set default/remove), hide_bulk → hideBulk (no Pay everyone in full / Paid on for all), paid_only → paidOnly (Name + Paid columns, Paid total only), show_bank → showBank (Bank column; the Wages page and /mobile/wages always show it). Hidden fields still round-trip through toRow()/toPayload(). Bank refills from splitPay() with the person\'s pay_method when a Total is typed; Full pays cashDueOf() = total − bank.'],
          ['cash_petty_cash', 'PettyCashPanel (exported from MobileExpenses.jsx) for ctx.selectedDay'],
          ['cash_week_expenses', 'useReconWeek() — detail.days[date].expenses grouped by day (read-only), dayExpenses/weekExpenses/weekCardExpenses totals; day heading sets ctx.selectedDay. Added in migration 102 (CHECK constraint only)'],
          ['cash_week_staff', 'Same WeekWagesEditor and the same options as cash_wages_paid (both keys kept so existing dashboards keep working). Added in migration 104; standardised in migration 137.'],
          ['cash_week_summary_grid', 'useReconWeek() — the SpreadsheetView row set with only the WEEK column (weekTotal per source/SC/channel, weekDayTotal, weekExpenses, weekCardExpenses, weekCashWages, weekVariance); read-only. ScEffectBadge exported from CashRecon.jsx for it. Added in migration 103 (CHECK constraint only)'],
          ['cash_tips_payout', 'useRotaPay(venueId, ctx.weekStart) — the rota pay payload (GET /api/rota/venues/:venueId/weeks/:week/pay, computeRotaWeek()), so it needs rota_tips view (useRotaPerms().canSeeTips; without it the widget says so and makes no request). Shows totals.tips_cash / tips_bank as tiles, non-house pots (paid_to_people ?? total, how paid from payout_method / payout_to / payees) and kept_by_house, then tipRows() with tip_share / tip_bank / tip_cash (TipMoneyCell for "hands on"). HeaderValue: totals.tips_shared. Read-only. Options (TIPS_PAYOUT_OPTIONS): hide_pots, hide_people, hide_share, hide_empty (rows with no tip_cash or tip_bank), hide_notes (handed on, unallocated, pots with nobody picked). Added in migration 144 (CHECK constraint only).'],
          ['cash_import', 'useLoyverseLink() + useGloriaFoodLink() (GET /api/loyverse|gloriafood/venues/:id/link) and useReconWeek(). One card per linked source not left out (detail from the link: store and trading day; restaurant and last_order_at, when the last order was received); Fill <day> opens LoyverseFillModal / GloriaFoodFillModal (ReconFillModal: preview + apply, which invalidates cash-recon-week-detail) with [ctx.selectedDay], disabled for a future or submitted day or when nothing is mapped; Fill this week passes calc.dates up to today. The days list reads week-detail\'s days[date].filled.{loyverse,gloriafood} = { at, by } | null (cash_daily_reports.<source>_filled_at / _by) and sets ctx.selectedDay. Fill buttons need useReconLinkPerms().canFill (cash_recon manage); the API checks it again on apply. nav: \'both\' (its CASH_WIDGET_TYPES entry; widgetTypes.jsx keeps t.nav ?? \'week\'). Options (IMPORT_OPTIONS): hide_days, hide_week, hide_loyverse, hide_gloriafood. Added in migration 212 (CHECK constraint only).'],
        ]}
      />
      <InfoBox type="warn">
        <Mono>reconCalc()</Mono> in <Mono>CashRecon.jsx</Mono> is the single implementation of
        the week grid maths (totals and the variance). SpreadsheetView calls
        it with its override-aware cell reader; <Mono>useReconWeek(venueId, weekStart)</Mono>{' '}
        calls it with saved values for the widgets, using the same{' '}
        <Mono>cash-recon-config</Mono> / <Mono>cash-recon-week-detail</Mono> query keys, so an
        edit in the grid refreshes every balance widget. Change a formula there, never in a
        widget.
      </InfoBox>
      <H3>Renaming widgets and tiles</H3>
      <P>
        <Mono>components/dashboards/TitleRename.jsx</Mono> is the Edit-layout name row used by{' '}
        <Mono>WidgetCard</Mono> (H&amp;S and Cash dashboards) and the Overview&apos;s{' '}
        <Mono>TileCard</Mono>. It PATCHes <Mono>title_override</Mono> on explicit Save; an empty
        name, a name equal to the default, or <strong>Use default</strong> sends{' '}
        <Mono>null</Mono>, so the built-in title (or the checklist name) shows again. Both PATCH
        routes already accepted <Mono>title_override</Mono>; there was just no UI for it.
      </P>
      <H3>Header figures</H3>
      <P>
        A widget type can set <Mono>HeaderValue</Mono> (a component) in its type list;{' '}
        <Mono>WidgetCard</Mono> renders it in the title bar outside Edit layout with{' '}
        <Mono>{'{ widget, venueId, ctx }'}</Mono>. The cash widgets use a shared{' '}
        <Mono>HeaderFigure</Mono> (label + amount): Week summary grid shows{' '}
        <Mono>calc.weekVariance()</Mono> (coloured like the grid), Week expenses shows{' '}
        <Mono>calc.weekExpenses()</Mono> (cash only), Wages paid shows the sum of{' '}
        <Mono>cash_amount</Mono>. They read the same query keys as the widget bodies
        (<Mono>useReconWeek</Mono>, <Mono>useWeekWages</Mono>), so they add no requests and
        refresh with them.
      </P>
      <H3>Per-widget options (all dashboards)</H3>
      <P>
        <Mono>hs_dashboard_widgets.settings</Mono> (jsonb, default <Mono>{'{}'}</Mono>, migration
        105) holds a widget's display options. A widget type declares them in its type list
        (<Mono>{"options: [{ key, label, hint }]"}</Mono> on <Mono>CASH_WIDGET_TYPES</Mono> /
        the H&amp;S list); <Mono>WidgetCard</Mono> renders one toggle per option in Edit layout
        and saves the whole object through <Mono>PATCH /dashboards/:id/widgets/:widgetId</Mono>{' '}
        (<Mono>{'{ settings }'}</Mono>). The API accepts a flat map of booleans, numbers and short
        strings (at most 20 keys) and writes it with <Mono>tx.json()</Mono>; it does not know what
        any key means. The renderer receives <Mono>widget.settings</Mono>. Options are
        boolean toggles only for now.
      </P>
      <H3>Row spanning (all dashboards)</H3>
      <P>
        <Mono>lib/dashboardGrid.js</Mono> gives the H&amp;S Dashboard, the Cash Dashboard and
        the Overview tiles one grid model: fixed-height implicit rows (<Mono>ROW_UNIT</Mono>{' '}
        120px, <Mono>GRID_GAP</Mono> 16px) with <Mono>grid-auto-flow: row dense</Mono>. A
        card spans <Mono>rowSpanFor(height_px)</Mono> rows (2 to 8) as well as its{' '}
        <Mono>col_span</Mono> columns, and its body is <Mono>flex-1 min-h-0</Mono>, filling
        the card and scrolling inside it. The height controls step one row at a time and write{' '}
        <Mono>heightForRows(n)</Mono> back to the existing <Mono>height_px</Mono> column, so
        no migration was needed and older free-form values snap to the nearest row count.
        Dense packing lets shorter cards fill the space beside a tall one, so on-screen
        order can differ slightly from sort order.
      </P>
    </section>
  )
}
