// src/pages/help/access.jsx
// The Help page's "Modules & Roles" section. Help.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, InfoBox, DataTable } from './parts.jsx'

export const id = 'access'
export const label = 'Modules & Roles'
export const order = 460

// ── ACCESS (modules + roles) ─────────────────────
export function Section() {
  return (
    <section id="access" data-help="">
      <H2>Modules &amp; Roles</H2>
      <P>
        The <strong>Access</strong> page (sidebar, owner-only) controls two layers of
        access for your tenant: which features are turned on at all, and who can do
        what within them.
      </P>

      <H3>Modules tab — turn product areas on or off</H3>
      <P>
        Each toggle controls a group of related features. Disabling a group hides every
        nav entry it contains for everyone in your tenant — including owners — and the
        API rejects mutations on those routes. Easy to turn back on.
      </P>
      <DataTable
        head={['Group', 'Includes', 'When to disable']}
        rows={[
          ['Bookings', 'Timeline, Bookings, Customers, Venues, Tables, Schedule, Rules, Widget Test', 'Never (this is the core product). Available so non-restaurant deployments can repurpose the platform.'],
          ['Booking emails', 'Email templates, sender settings, sent log', 'If you want to handle confirmation emails entirely outside Macaroonie.'],
          ['Website CMS', 'Per-venue marketing sites, brand defaults', 'If your tenants don\'t need branded subsites.'],
          ['Cash reconciliation', 'Daily close-out, weekly grid, SC sources', 'If you don\'t track end-of-day cash through Macaroonie.'],
          ['Pepper (AI assistant)', 'Ask Pepper, the Pepper page, the phone app\'s Pepper, the staff connector for AI apps', 'If staff shouldn\'t use AI at all. The website chat and guests\' AI apps have their own switches on the Pepper page.'],
        ]}
      />
      <P>
        Always-on (no toggle): Overview, Team, Settings, Documentation. These are core
        to running the platform itself.
      </P>

      <H3>Roles tab — fine-grained per-user permissions</H3>
      <P>
        Four built-in roles ship per tenant: Owner, Admin, Operator, Viewer. Each has
        a permissions matrix showing every module set to <strong>none</strong>,
        <strong> view</strong>, or <strong>manage</strong> (Checklists, Food safety logs and
        the H&amp;S Action Log also offer <strong>use</strong>, see below). Built-in roles can be
        edited (e.g. take Email Templates away from Admin) but not deleted.
      </P>
      <P>
        Click <strong>+ New role</strong> to define custom roles like &ldquo;Manager&rdquo;
        or &ldquo;Host&rdquo; with their own matrix. Custom roles can be deleted as long
        as no users are assigned: tap the bin on its row, then <strong>Delete</strong> (or
        <strong> Keep</strong>); a role someone still has says how many people to move to another
        role first. Assign custom roles in the Team page once they exist.
      </P>
      <InfoBox type="info">
        Disabling a module at the tenant level wins over role permissions — even an
        Owner can&apos;t access a disabled module. To grant access, turn the module on
        first, then check the role permission.
      </InfoBox>

      <H3>What View and Manage mean</H3>
      <P>
        The same rule applies on every page: <strong>View</strong> lets someone open the
        page and use it to look things up, <strong>Manage</strong> lets them change things
        there, and <strong>None</strong> hides it. With View, the buttons that change things
        are hidden or greyed out and a blue &ldquo;View only&rdquo; bar says so at the top;
        the app also refuses the change if it&apos;s tried another way. For example: View on
        Cash reconciliation shows the week and each day with every figure, but nothing can be
        typed, submitted or set up; View on Menus opens each menu without Save; View on a
        dashboard shows its widgets but no Edit layout.
      </P>
      <P>
        A few changes also need an Owner or Admin login on top of Manage, because they undo
        finished work or touch money: Cash Recon settings and unsubmitting a submitted day or
        week, deleting a booking, refunding a deposit. Removing an email suppression needs the
        Owner. Team and Access themselves stay Owner only.
      </P>
      <P>
        The built-in roles start from sensible defaults: an Operator manages bookings, Cash
        Recon, the rota, online orders and H&amp;S checks, and can view customers, venues,
        tables, the schedule and menus; a Viewer can view bookings, customers, menus and the
        H&amp;S pages. Change any of these in the role&apos;s matrix.
      </P>

      <H3>Use: the checks without the setup</H3>
      <P>
        Checklists, Food safety logs, the H&amp;S Action Log and Cash reconciliation have a fourth level between View
        and Manage: <strong>Use</strong>. It is for people who do the everyday work but
        shouldn&apos;t change how it is set up, such as a supervisor who completes the checklists
        and logs the temperature checks, or a manager who does the cash-up. In Access → Roles those modules show{' '}
        <strong>Use</strong> between View and Manage, with a line saying what it allows; the
        other modules stay None, View or Manage.
      </P>
      <DataTable
        head={['Area', 'Use can', 'Still needs Manage']}
        rows={[
          ['Checklists', 'Tick checklists (Tick all too) and write their notes, wherever they show: the Checklists page, dashboards, Today and the phone', 'Making and changing the checklists and their tasks'],
          ['Food safety logs', 'Log and correct temperature, hold, cooking and delivery checks, and write corrective actions', 'Everything in H&S settings (the units, check times, hold stations, cooking sessions and dishes), and deleting a cooking reading'],
          ['H&S Action Log', 'Log actions, change them and tick them off', 'Deleting an action and changing the categories'],
          ['Cash reconciliation', 'Fill in and submit days, add, change and delete expenses and receipts, fill a day from the till, Loyverse or GloriaFood, and change the week\'s wage list and what was paid, wherever they show: Cash Recon, the Cash dashboard, Today and the phone', 'Cash Recon settings (sources, channels, categories, staff), Set as default on a wage list, unsubmitting a day (also owner or admin) and linking Loyverse or GloriaFood'],
          ['Purchasing', 'Return goods to the supplier from a delivery that was booked in, and cancel a return not sent yet (Purchasing, a delivery\'s Return items, or Pepper)', 'Ordering, sending purchase orders and booking deliveries in; sending a return and recording its credit note need Purchasing approval'],
        ]}
      />
      <P>
        For a supervisor, make a role (for example Supervisor) with Use on those three and View on
        the H&amp;S Dashboard: they open the dashboards and fill in their widgets but can&apos;t
        change the layout. On <strong>Today</strong> they get each check&apos;s own button instead
        of View, and Pepper logs readings, ticks checklists and logs actions for them too. The
        built-in roles keep their levels (Operator Manage, Viewer View) unless you change them.
      </P>
    </section>
  )
}
