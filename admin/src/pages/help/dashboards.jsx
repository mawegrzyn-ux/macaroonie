// src/pages/help/dashboards.jsx
// The Help page's "Dashboards" section. Help.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, InfoBox, DataTable } from './parts.jsx'

export const id = 'dashboards'
export const label = 'Dashboards'
export const order = 190

// ── DASHBOARDS ───────────────────────────────
export function Section() {
  return (
    <section id="dashboards" data-help="">
      <H2>Dashboards</H2>
      <P>
        The <strong>Dashboards</strong> page (sidebar nav, under Overview) is for your own
        screens. Tap <strong>Create dashboard</strong> (or <strong>New dashboard</strong> once
        you have one), give it a name and it starts blank. Then tap <strong>Add widget</strong>{' '}
        and pick from every widget in the app, mixed on one page: for example a manager's
        screen with today's checklists, the fridge temperatures, the days of the week from Cash
        Recon and who's on from the rota. Dashboards are per venue, shown as tabs, and are
        arranged the same way as the H&amp;S Dashboard (Edit layout to rename, reorder, resize
        or remove).
      </P>
      <H3>Every dashboard can use every widget</H3>
      <P>
        The H&amp;S, Cash and Rota dashboards work the same way now: <strong>Add widget</strong>{' '}
        lists all widgets, grouped under Health &amp; safety, Menus, Cash and Rota, with the
        page's own group first. So you can, for example, put the rota's Who's on next to the
        fridge checks on the H&amp;S Dashboard, or a checklist on the Cash dashboard. The widget
        tables under H&amp;S Dashboard, Cash Dashboard and Staff &amp; Rota say what each one shows.
      </P>
      <InfoBox type="info">
        A widget only shows to people who can open its area. Add widget only lists widgets from
        areas you have access to (for example cash widgets need Cash reconciliation, Tips to
        pay out needs Rota tips), and says how many it left out. If someone without access opens
        a dashboard that has one, they see "You don't have access to ..." in that widget instead
        of its figures. Access is set per module in Access, as before.
      </InfoBox>
      <H3>Who sees each dashboard</H3>
      <P>
        A dashboard can be hidden from some roles, for example a Managers dashboard your
        supervisors don&apos;t need. In <strong>Edit layout</strong>, pick its tab and tap{' '}
        <strong>Seen by</strong> (it says Everyone, or who it is hidden from). Untick the roles
        that shouldn&apos;t see it and tap Save. A role made later sees it until it is unticked
        there.
      </P>
      <P>
        The roles it is hidden from don&apos;t get its tab, on the desktop or the phone. People
        who can edit the page&apos;s layout (Manage on that dashboard page) still get every
        dashboard while editing, with an eye icon on the hidden ones; one hidden from your own
        role leaves your tabs when you tap Done editing. Hiding a dashboard only tidies what each
        role sees: what its widgets show still follows each area&apos;s own access. It works the
        same on the H&amp;S, Cash and Rota dashboards and this page.
      </P>
      <H3>The date bar</H3>
      <P>
        One date bar drives every widget on the dashboard, and it changes with what's on it:
      </P>
      <DataTable
        head={['Widgets on the dashboard', 'Date bar']}
        rows={[
          ['Only checks and checklists', 'One day. The arrows move a day; Today jumps back.'],
          ['Only cash and rota widgets', 'One week. The arrows move a week; This week jumps back. The selected day is today (or the Monday in another week); tap a day in Days of the week or the rota grid to pick another.'],
          ['Both', 'The day and its week. The inner arrows move a day, the outer double arrows move a week. Cash and rota widgets follow the week the day is in.'],
        ]}
      />
      <P>
        In every case, tap the date in the middle to pick any date from your device's calendar.
        On a closed day, a dashboard with H&amp;S checks on it shows the closed-day note (when
        H&amp;S follows opening days is on). The Action log and Allergen lookup don't depend on a date.
      </P>
      <P>
        These dashboards are on the desktop only. On the phone (ops.macaroonie.com) the{' '}
        <strong>H&amp;S Dashboard</strong> tile shows your H&amp;S dashboards, and{' '}
        <strong>Today</strong> lists what needs doing.
      </P>
    </section>
  )
}
