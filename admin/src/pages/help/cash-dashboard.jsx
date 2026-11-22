// src/pages/help/cash-dashboard.jsx
// The Help page's "Cash Dashboard" section. Help.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, P, InfoBox, DataTable } from './parts.jsx'

export const id = 'cash-dashboard'
export const label = 'Cash Dashboard'
export const order = 210

// ── CASH DASHBOARD ───────────────────────────────
export function Section() {
  return (
    <section id="cash-dashboard" data-help="">
      <H2>Cash Dashboard</H2>
      <P>
        The <strong>Cash dashboard</strong> page (sidebar nav, next to Cash recon) lets you
        lay out your cash reconciliation on one screen, the same way the H&amp;S Dashboard
        works for checks. Create named dashboards (tabs), then tap <strong>Edit layout</strong>{' '}
        to add, reorder, resize or remove widgets. Every figure is the same one the Cash
        Recon pages show, so the dashboard never disagrees with them. Like every dashboard, it
        can also hold H&amp;S, menu and rota widgets (see Dashboards).
      </P>
      <P>
        With only cash (and rota) widgets on it, the navigator at the top picks the{' '}
        <strong>week</strong>. Tap a day in the{' '}
        <strong>Days of the week</strong> widget to open that day's full declaration (the same
        screen as on the Cash Recon page); the back arrow returns to the dashboard. The tapped
        day is also selected, so the Day balance and Petty cash widgets show it. The selected
        day starts as today (or the Monday when you move to another week).
      </P>
      <DataTable
        head={['Widget', 'Shows']}
        rows={[
          ['Days of the week', 'One tile per day with its status, income and variance. Tap a tile to open that day\'s declaration. Closed days are faded. In Edit layout, two switches on the widget: Hide closed days (leave out days the venue is closed) and Compact (smaller tiles showing the day, a status dot and the variance: green submitted, amber draft, grey not started).'],
          ['Day balance', 'The selected day: income, service charges, takings, cash expenses, card expenses and the variance.'],
          ['Week balance', 'The week: income, takings, cash expenses, wages paid in cash and the variance, plus how many days are submitted.'],
          ['Reconciliation grid', 'The full week grid from Cash Recon. You can type into it the same way; tap a day heading to select that day.'],
          ['Wages paid', 'The title bar shows the total paid in cash so far. The week\'s wages list (Name, Total, Paid, Paid on, Notes), the same as the Wages page. A payment is recorded on the day selected on the dashboard. Save to keep changes. In Edit layout you can switch on: Hide list changes (no Add staff, Copy from, Set as default or remove), Hide pay-all options (no Pay everyone in full or Paid on for all), Name and Paid only, and Show bank transfer (adds the Bank column; without it a person paid partly by bank shows the bank amount under their name).'],
          ['Petty cash', 'The selected day\'s expenses, with the same add/edit form (receipt photo, VAT, paid by card) as the mobile Expenses page.'],
          ['Week expenses', 'The title bar shows the week\'s cash expenses total. Every expense logged this week, grouped by day, with category, VAT and a Card badge for card-paid ones. Totals at the bottom: cash expenses, paid by card, and VAT included. Tap a day heading to select that day, then use the Petty cash widget to edit it.'],
          ['Week staff list', 'The same wages list as the Wages paid widget: add someone from your staff list (or a one-off name), remove someone, copy the list from one of the last 8 weeks, and Set as default for new weeks. Changes are only written when you tap Save (Discard changes throws them away). Has the same three display options as Wages paid.'],
          ['Week summary grid', 'The title bar shows the week\'s variance. The reconciliation grid with the individual days taken out: every income source, service charge and payment channel with its week total, then cash expenses and wages paid out of the till, and the variance. Read only, and always matches the WEEK column of the full grid.'],
          ['Tips to pay out', 'How much of the week\'s tips to pay staff in cash and how much by bank transfer, as two big figures, then each tip pot (what came in and how it is paid out) and each person\'s Bank and Cash amounts with totals. The title bar shows the week\'s total tips. Read only: the figures are the same as the Rota page\'s tips table, which is where pots, shares, moves and who gets a pot are changed. In Edit layout you can switch on: Hide tip pots, Hide staff list (just the two totals), Hide each person\'s total, Hide people with nothing to pay, and Hide notes. Needs access to rota tips.'],
          ['Import from Loyverse / GloriaFood', 'Fills Cash Recon from the venue\'s Loyverse and GloriaFood links without leaving the dashboard. One card per linked source with Fill (the selected day) and Fill this week (Monday up to today); each opens the same fill window as Cash Recon, so you see the figures next to what Cash Recon has before you tap Fill. Below, every day of the week with when each source last filled it (tap a day to select it; hold over a time to see who filled it). Submitted days and days that haven\'t happened yet can\'t be filled. The dashboard\'s date bar steps days and weeks while this widget is on it. In Edit layout: Hide the days, Day only (no Fill this week), Leave out Loyverse, Leave out GloriaFood. Filling needs Manage on Cash reconciliation; with View you see the days only. Links are set up in Cash Recon settings (see Fill from Loyverse and Fill from GloriaFood).'],
        ]}
      />
      <InfoBox type="tip">
        A dashboard keeps the column layout you set up, and each widget can span several
        columns and several rows. Make the grid tall and the balances short, and the
        shorter widgets stack beside it instead of leaving a gap.
      </InfoBox>
    </section>
  )
}
