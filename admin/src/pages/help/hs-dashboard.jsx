// src/pages/help/hs-dashboard.jsx
// The Help page's "H&S Dashboard" section. Help.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, InfoBox, DataTable } from './parts.jsx'

export const id = 'hs-dashboard'
export const label = 'H&S Dashboard'
export const order = 200

// ── H&S DASHBOARD ───────────────────────────────
export function Section() {
  return (
    <section id="hs-dashboard" data-help="">
      <H2>H&amp;S Dashboard</H2>
      <P>
        The <strong>H&amp;S Dashboard</strong> page (sidebar nav) lets you build your own
        screen combining any mix of checklists and food-safety check widgets behind a single
        date navigator — useful for a kitchen-pass tablet showing "everything due right
        now" without switching between the Food safety and Checklists pages. It can also hold
        any cash, rota or menu widget (see Dashboards). Each widget's
        header uses your website's brand accent colour, same as Cash Reconciliation's
        section cards.
      </P>
      <H3>Dashboards and widgets</H3>
      <P>
        You can create any number of named dashboards, shown as tabs across the top. Click
        <strong> Edit layout</strong> to add widgets, rename, reorder, resize their width (in
        grid columns) and height (in rows), or remove them. To rename a widget, type in its{' '}
        <strong>Name</strong> box and tap Save; <strong>Use default</strong> puts the built-in
        name back. The same works on the Cash dashboard. A tall widget spans several
        rows, and shorter widgets stack beside it instead of leaving a gap. The health &amp;
        safety widgets are:
      </P>
      <P>
        <strong>Who can change a dashboard.</strong> Each dashboard page has its own permission
        in Access → Roles (H&amp;S Dashboard, Cash Recon Dashboard, Rota Dashboard,
        Dashboards). <strong>View</strong> lets someone open the dashboards, switch tabs, change
        the date and use the widgets; they don&apos;t see Edit layout, New dashboard or Add
        widget. <strong>Manage</strong> is needed to add, rename, reorder or delete dashboards
        and to add, remove, resize, rename or set up widgets. What someone can do inside a
        widget (enter figures, tick a checklist, log a temperature) comes from that
        widget&apos;s own area: for example, the cash widgets follow the Cash Reconciliation
        permission, so View on Cash Recon Dashboard with Manage on Cash Reconciliation lets
        someone fill in the week without changing the layout. The checks need only{' '}
        <strong>Use</strong> on Checklists and Food safety logs (see Modules &amp; Roles), and a
        dashboard can be hidden from roles that don&apos;t need it (see Dashboards).
      </P>
      <DataTable
        head={['Widget', 'Shows']}
        rows={[
          ['Checklist', 'One specific checklist, ticked right on the dashboard. Tick all sits in the widget\'s own header; once every task is ticked it shows All done (tap it to untick all).'],
          ['Temperature checks', 'The Equipment (fridge/freezer) grid.'],
          ['Delivery checks', 'The delivery log entry form + this week\'s list.'],
          ['Hot / cold hold checks', 'The Holds grid.'],
          ['Cooking / reheat checks', 'The till-style cooking checks panel.'],
          ['Action log', 'The full Action Log list (see below) for one venue.'],
          ['Allergen lookup', 'Read-only allergen and dietary search over a menu (see Menus, Allergen matrix). The menu picked is remembered on that device for each widget.'],
        ]}
      />
      <P>
        Every widget reads and writes the exact same data as the Food safety and Checklists
        pages — there's only one copy of each day's checks, the dashboard is just another
        place to see and log them.
      </P>
      <InfoBox type="tip">
        Use <strong>Full screen</strong> (top right) to hide the sidebar entirely — good
        for a wall-mounted or kitchen-pass tablet running one dashboard all day. On an iPad
        added to the home screen, Full screen fills the whole app window (iPads don't allow
        true full screen there); tap <strong>Exit</strong> to go back.
      </InfoBox>
      <P>
        The dashboard tabs sit on the same row as the date selector. A dashboard always
        keeps the column layout you set up. On a narrower screen (for example an iPad held
        upright) the columns get narrower, so widgets you placed side by side stay side by
        side. If a table inside a narrow widget doesn't fit, scroll it sideways within the
        widget.
      </P>
    </section>
  )
}
