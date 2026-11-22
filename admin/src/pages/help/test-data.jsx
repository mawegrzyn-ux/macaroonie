// src/pages/help/test-data.jsx
// The Help page's "Test Data (pre-prod)" section. Help.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, DataTable } from './parts.jsx'

export const id = 'test-data'
export const label = 'Test Data (pre-prod)'
export const order = 530

export function Section() {
  return (
    <section id="test-data" data-help="">
      <H2>Test data (pre-prod)</H2>
      <P>
        The <strong>Test data</strong> page fills a venue with practice records while
        Macaroonie is in testing. Pick the venue at the top. It has six parts: generate
        dummy bookings, clear bookings, generate past till sales, clear test till sales,
        generate past health &amp; safety logs, and clear generated health &amp; safety logs.
      </P>
      <H3>Generate past till sales</H3>
      <P>
        Fills past days with till sales, as if the venue's tills and kiosks had taken them,
        so Till reports and the report builder have something to show. Pick
        <strong> From</strong> and <strong>To</strong> (days before today, about three years
        back at most; between midnight and the time the trading day starts, yesterday still
        counts as today) and how many <strong>orders a day</strong> on average, use
        <strong> Preview</strong> to see roughly how many it will make, then
        <strong> Generate</strong>.
      </P>
      <DataTable
        head={['What', 'What it makes']}
        rows={[
          ['Orders', 'Tables with guests and counter orders through the day, busiest at lunch and dinner, more on Fridays and Saturdays and in December than in the summer. Each one with the venue\'s own menus, prices, order types, charges, discounts and promotions, numbered by its till, and taken by the venue\'s staff (nobody after their last working day). A table in an area with its own revenue stream sells in that stream. A party sits at a table big enough for it, and a table takes its next party a few minutes after the last one has paid. A venue with no till yet gets two stand-in tills: T1 at the counter and T2 at tables.'],
          ['Kiosks', 'When the venue has self-order kiosks, about a third of the orders come from them, some paid at the counter.'],
          ['Payments', 'Mostly card, some cash (with change), now and then a voucher, a split bill between guests or a tip.'],
          ['Now and then', 'A void, a comp, a discount, an optional charge taken off, a cancelled order or a refund. When the person on the till can\'t do it, a manager approves it, as on the till.'],
          ['The day', 'Opened and closed by the venue\'s staff, with the cash counted (usually what the till expected).'],
        ]}
      />
      <P>
        Days with real till sales are left alone, and days the venue is closed are left out
        unless you untick <strong>Skip days the venue is closed</strong>. Making the same
        days again replaces the test days made before. A long range goes a few weeks at a
        time: <strong>Stop after these days</strong> stops it and keeps the days already
        made.
      </P>
      <P>
        In <strong>Till reports</strong> test days are marked <strong>Test sales</strong>,
        have no Z number and never go into Cash Recon. Their checks aren't on any till,
        kitchen screen or venue hub. The report builder reads them like real sales and
        can't tell them apart, so clear them when you are done.
      </P>
      <H3>Clear test till sales</H3>
      <P>
        Deletes only the days the generator made, with their checks, for the dates you
        choose or every test day of the venue, after you type DELETE. Real till sales are
        never removed.
      </P>
      <H3>Generate past health &amp; safety logs</H3>
      <P>
        Choose a past date range (up to today, a year at most) and what to fill. Use
        <strong> Preview</strong> to see roughly how much it will make, then
        <strong> Generate</strong>.
      </P>
      <DataTable
        head={['What', 'What it makes']}
        rows={[
          ['Fridge & freezer temperatures', 'One reading per fridge or freezer per check time, inside its limits.'],
          ['Hot & cold hold checks', 'One reading per hold station per hold check time, inside its limits.'],
          ['Cooking checks', 'Each cooking session gets its required number of checks, with dishes picked at random from your published menus, all at 75°C or above.'],
          ['Past purchase orders', 'One per supplier per delivery day (the venue\'s own delivery days if set) for the items on the venue\'s order lists, most of them, at quantities around the pars.'],
          ['Delivery checks', 'Books in every received purchase order in the range without a check: the supplier, the items that arrived, and the chilled / frozen temperatures by each item\'s storage (chilled 1-5°C, frozen -22 to -18°C).'],
          ['Checklists & audits', 'Daily, weekly and monthly checklists (the monthly audit included) marked complete with every task ticked. Pick which checklists to include. One that someone had already started is completed and ticked off too.'],
        ]}
      />
      <P>
        <strong>Readings out of range</strong> sets roughly what share of readings fall
        outside the limits, each with a corrective action written in, so reports and the
        Overview tiles show what a real log looks like. 0 keeps everything in range.
        <strong> Skip days the venue is closed</strong> leaves closed days empty.
        Days that already have a reading are left alone, so running it twice does not
        double anything up. Readings are signed with your venue staff names.
      </P>
      <H3>Clear generated health &amp; safety logs</H3>
      <P>
        Removes only what the generator made, for the dates and types you choose, after
        you type DELETE. Readings and checklists people entered are never removed. A
        checklist that had been started before the generator completed it stays
        completed.
      </P>
    </section>
  )
}
