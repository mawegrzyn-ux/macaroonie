// src/pages/help/staff-rota.jsx
// The Help page's "Staff & Rota" section. Help.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, InfoBox, DataTable } from './parts.jsx'

export const id = 'staff-rota'
export const label = 'Staff & Rota'
export const order = 230

export function Section() {
  return (
    <section id="staff-rota" data-help="">
      <H2>Staff &amp; Rota</H2>
      <P>
        The <strong>Staff</strong> section of the sidebar holds your staff list, job roles, the
        weekly rota, rota setup and the Rota dashboard. Roles, shifts and the rota settings are
        shared by every venue in your company; staff and the rota itself are per venue.
      </P>
      <H3>Roles</H3>
      <P>
        Staff, then <strong>Roles</strong>. Add each job title (Manager, Chef, Waiter, Pot wash)
        with a <strong>tip points multiplier</strong>: 1.0 is a standard share, 1.1 gets 10% more
        points for the same shift. Drag to reorder. Deleting a role removes it from anyone who has it.
      </P>
      <H3>Staff</H3>
      <P>
        Pick the venue, then tap <strong>Add staff</strong> or tap a person to edit their name,
        role and pay. Pay options:
      </P>
      <DataTable
        head={['Pay type', 'How it is worked out']}
        rows={[
          ['Hourly', 'Hours worked times their hourly rate. You can set a different hourly rate per shift (for example more for Dinner); hours outside any shift use the default rate.'],
          ['Fixed per week', 'Their amount, once, for any week they work at all.'],
          ['Fixed per day', 'Their amount for each day they work, however many shifts that day.'],
          ['Fixed per shift', 'An amount per shift worked, with an optional different amount per shift (for example Lunch £40, Dinner £60).'],
        ]}
      />
      <P>
        <strong>Paid by</strong> sets how each person gets their pay: <strong>Cash in hand</strong>,{' '}
        <strong>Bank transfer</strong>, or <strong>Split</strong>. With Split you enter the amount that
        goes by bank transfer each week (for example £200) and the rest is cash in hand; a week that
        pays less than that amount goes all to the bank. The rota pay and the wages list use this to
        show the bank and cash parts.
      </P>
      <P>
        Someone who already has wages or rota history is made inactive rather than deleted, so
        past weeks keep their figures.
      </P>
      <P>
        <strong>Leaving.</strong> When someone resigns or is let go, open them and use{' '}
        <strong>Set a leaving date</strong>: pick their last working day and, if you like, a reason.
        From the day after, they are not on the rota: later weeks don't show them, and in the week
        they leave their remaining days show as LEFT. Earlier weeks still show them with their
        shifts, pay and tips. If they were already on the rota after that day, the app says how many
        entries that is before taking them off; tap <strong>Yes, set leaving date</strong> to go
        ahead. After their last day they move to the <strong>Left</strong> group at the bottom of the
        Staff list, they aren't offered for new wage weeks or the wages Add person list, and they
        can no longer sign in on the till. <strong>Clear leaving date</strong> puts them back on the
        rota (entries taken off earlier are not put back). Use this rather than turning Active off,
        which hides someone from every week, past ones included.
      </P>
      <P>
        <strong>Off the rota.</strong> For a stretch when someone can't be rostered (long leave, a
        season back home, a suspension), use <strong>Add a period off the rota</strong> with a from
        and to date (both days included, up to two years) and an optional reason. Those days show as
        AWAY on the rota and can't be tapped; a week entirely inside the period lists them under the
        grid in <strong>Off the rota all week</strong> instead of a row. Their rota entries inside the
        period are taken off when you add it (again, the app says how many first). A person's periods
        can't overlap. The bin next to a period removes it (entries it took off are not put back).
        Paid holiday still goes on the rota as PTO, so it is paid: a period off the rota is unpaid
        unless you add a pay adjustment.
      </P>
      <P>
        The Staff list shows <strong>Last day</strong>, <strong>Off rota until</strong> and{' '}
        <strong>Off rota from</strong> badges, so you can see at a glance who is leaving or away.
        Leaving dates and periods save straight away with their own buttons; they don't need the
        editor's Save.
      </P>
      <H3>Rota setup</H3>
      <P>
        Rota, then <strong>Rota setup</strong>. Choose how the rota is entered:
        <strong> Day parts</strong> (each day split into your shifts, and each person is ON or OFF
        for a shift) or <strong>Hours</strong> (start and end times, at 15 minute, 30 minute or 1
        hour steps). Then add your <strong>day parts / shifts</strong>, for example Lunch 11:30 to
        15:00 and Dinner 18:00 to 23:00, each with its <strong>tip points</strong> (for example
        Lunch 0.5, Dinner 1). A shift that ends at or before its start runs past midnight.
        Shifts are used in both modes: in Hours mode they decide per-shift rates and tip points
        for the hours that fall inside them.
      </P>
      <P>
        <strong>Round tip shares to</strong> (also in Rota setup): leave blank to share tips to the
        penny, or enter an amount (for example 0.50 for the nearest 50p, 1 for the nearest pound, 5
        for the nearest £5; quick buttons are provided). Choose <strong>Nearest</strong>,{' '}
        <strong>Always up</strong> or <strong>Always down</strong>. Rounding can make the shares add up
        to slightly more or less than the pot; the Tips table says by how much, and shows each
        person's exact share under the rounded one. Always down never pays out more than the pot.
      </P>
      <P>
        <strong>Closed days</strong> (also in Rota setup): two separate switches, <strong>Hide closed
        days on the rota</strong> (the Rota page grid) and <strong>Hide closed days on printouts and
        images</strong> (Print / PDF and Save image). Closed days come from each venue's booking
        schedule (the weekly schedule, date overrides and exceptions), the same days Cash Recon treats
        as closed. A closed day with someone rostered on it is always shown, marked "Closed", so nobody
        disappears from the rota. A venue with no weekly schedule set up never hides any days.
      </P>
      <H3>The rota</H3>
      <P>
        <strong>Rota</strong> shows names down the side and the days of the week across the top.
        Pick the venue and use the arrows to change week.
      </P>
      <DataTable
        head={['Mode', 'How to enter it']}
        rows={[
          ['Day parts', 'Each day has a column per shift. Tap a cell to switch the person ON or OFF for that shift. The bottom row counts who is on each shift.'],
          ['Hours', 'Tap a person\'s day to open their times. Add as many periods as fit without overlapping (for example 11:00 to 15:00 and 18:00 to 23:00), or tap a shift name to add its times in one go. Each period has a box to mark it as working or a kind of time off. Clear day takes them off that day.'],
        ]}
      />
      <P>
        <strong>Sickness and time off.</strong> Next to each name is a small square button showing
        what a tap puts in for that person: <strong>ON</strong> to start with. Tap it to pick
        ON / OFF, SICK / OFF, PTO / OFF, UTO / OFF or ABS / OFF. Tapping that person's cells then
        flicks between OFF and the option you picked, so to mark someone sick for the week, pick
        SICK / OFF and tap their shifts (a cell that was ON changes straight to SICK). Pick ON / OFF
        again to go back to rostering. The button is per person and is remembered while you move
        between weeks.
      </P>
      <DataTable
        head={['Code', 'Means', 'Pay and tips']}
        rows={[
          ['ON', 'Working', 'Hours, pay and tip points.'],
          ['SICK', 'Off sick', 'Unpaid on the rota, no tip points. Use a pay override for sick pay.'],
          ['PTO', 'Paid time off (holiday)', 'Paid as if they worked the shift; not counted as hours worked and no tip points.'],
          ['UTO', 'Unpaid time off', 'Unpaid, no tip points.'],
          ['ABS', 'Absent (did not turn up)', 'Unpaid, no tip points.'],
        ]}
      />
      <P>
        The Week column and the bottom row count only people working. Time off shows on the
        printout and image in the same colour as on the grid, and the Rota dashboard's who's-on list shows who is
        off that day. <strong>Copy from week</strong> copies only worked shifts, not time off.
      </P>
      <P>
        Nothing is saved until you tap <strong>Save rota</strong>; <strong>Discard changes</strong>{' '}
        throws them away. <strong>Clear rota</strong> (next to Save) empties the whole week after
        you confirm; it is an unsaved change too, so tap Save to keep it or Discard to undo it. Unsaved changes are kept if you look at another week and come back.
        <strong> Copy from week</strong> replaces this week with one of the last 8 weeks (it asks
        first if this week already has entries). If you switch mode in Rota setup, entries made
        in the old mode still count for pay and are listed in a notice until you save that week.
      </P>
      <P>
        <strong>Taking someone off a week.</strong> Everyone active on the Staff page has a row.
        If someone isn't working a week at all (on holiday, not needed, about to leave), tap the
        person-with-a-minus button next to their name and then <strong>Take off</strong>. Their
        row goes, any shifts or time off they had that week are cleared, and they are listed
        under the grid in <strong>Off this week's rota</strong>. Tap their name there
        (<strong>Put back</strong>) to bring them back. Like everything else on the grid, it is
        only kept when you tap Save rota (Discard undoes it). It is for that week only: next week
        they are on the rota again. Someone taken off doesn't show on the printout or image, or
        in hours and pay and tips, unless they have money that week (a pay adjustment, wages
        owed from last week, a tip move or a tip pot paid to them). Copy from week leaves them
        off. For paid holiday, keep them on and mark their days PTO instead, so they are paid.
      </P>
      <P>
        <strong>Leavers and people away.</strong> Days after someone's leaving date show as LEFT,
        and days in a period off the rota show as AWAY, both hatched; they can't be tapped, and the
        name has a line saying why (for example "Last day Wed 4 Nov"). Someone away the whole week is
        listed under the grid in <strong>Off the rota all week</strong>; someone who left before the
        week doesn't show at all. Both are set on the Staff page, not here. Copy from week skips
        shifts that would land on those days, and the printout and image show the same hatched LEFT
        and AWAY tiles.
      </P>
      <P>
        <strong>Print / PDF</strong> opens your device's print dialog with the week on an A4
        landscape page that looks like the rota grid: names down the side, days across with the
        shifts under each day, and the same green ON, grey OFF and coloured time off tiles (by
        hours: each day's times in the same tinted boxes). It leaves out what is only for the
        screen: the roles under the names, the take-off and tap mode buttons, each person's hours
        and the On shift row. A line under the sheet gives the shift times. Pick a printer, or
        "Save as PDF" to keep a copy. <strong>Save image</strong> saves the same sheet as a JPG
        picture (on a tablet or phone it is <strong>Share image</strong>, which opens the share
        sheet so you can send it straight to a staff group chat). Both print exactly what is on screen; if you
        have unsaved changes the sheet is marked "DRAFT, not saved". The buttons are also on the
        Rota grid dashboard widget, and anyone who can view the rota can use them.
      </P>
      <H3>Hours and pay</H3>
      <P>
        Below the rota (for anyone with rota pay access) each rostered person's hours and pay
        for the week (hours worked, with any time off listed under them). <strong>Rota pay</strong> is
        what the rota works out; tap it to override it for this week (<strong>Use calculated</strong>{' '}
        goes back). <strong>Adjustments</strong> opens that person's pay for the week, where you can add:
      </P>
      <DataTable
        head={['Adjustment', 'What it does']}
        rows={[
          ['Extra pay', 'Added to this week\'s pay (a bonus, extra hours, a covered shift). Add a note to say why.'],
          ['Deduction', 'Taken off this week\'s pay. If deductions are more than the pay, pay stops at £0.00 and the table shows how much was short; the rest isn\'t carried over.'],
          ['Cash advance', 'Money handed over now, from the till: added to this week\'s pay (so it goes into this week\'s wages and the till count), and taken off next week\'s pay automatically as Advance repaid. Removing the advance removes the repayment too; change the repayment next week if it\'s paid back differently.'],
          ['Owed from last week', 'Not added by hand: when last week\'s Cash Recon wages paid someone less than their total in cash, the rest is added here. Paying it in last week\'s wages removes it.'],
        ]}
      />
      <P>
        Tap any adjustment to change its amount or note, or the bin to remove it (it asks first).{' '}
        <strong>Total pay</strong> is rota pay plus adjustments. <strong>Fill Cash Recon wages</strong>{' '}
        writes everyone's total pay into that week's Cash Recon wages, with a note listing any
        adjustments: existing rows are updated (someone already paid in full stays paid at the new
        amount), missing people are added, and other rows are left alone. Each row also gets its
        bank transfer part from the person's Paid by setting.
      </P>
      <P>
        When anyone that week is paid partly or fully by bank transfer, the table adds{' '}
        <strong>Bank</strong> and <strong>Cash</strong> columns: how much of each total goes by bank
        transfer and how much is cash in hand.
      </P>
      <H3>Tip pots</H3>
      <P>
        Set up in Rota setup, then <strong>Tip pots</strong>. A pot has a name and collects money
        from two places: the Cash Recon <strong>service charge and tips sources</strong> you tick
        for it (a source can only be in one pot; sources are listed by venue), and any{' '}
        <strong>manual lines</strong> you add (for example a cash tips jar that is not in Cash
        Recon). Each pot is shared one of three ways:
      </P>
      <DataTable
        head={['Sharing', 'What happens']}
        rows={[
          ['By points', 'Each shift worked earns its tip points, times the person\'s role multiplier (Hours mode counts part of a shift in proportion). The pot is split by each person\'s share of all the points. Tip rounding in Rota setup applies here.'],
          ['Manual', 'Payroll enters each person\'s amount every week (Share amounts on the pot). Split evenly fills in equal amounts for everyone on the rota. The pot shows how much is still to share.'],
          ['Kept by house', 'Counted as tips in, but not shared with staff.'],
        ]}
      />
      <H3>Paying a pot out: cash or bank, shares or specific people</H3>
      <P>
        In the pot's settings, <strong>Paid in</strong> says whether the pot is paid in{' '}
        <strong>Cash</strong> or by <strong>Bank transfer</strong>, and <strong>Paid to</strong>{' '}
        says who receives it:
      </P>
      <DataTable
        head={['Paid to', 'What happens']}
        rows={[
          ['Each person\'s share', 'Everyone is paid their own share of the pot, in cash or by bank as set.'],
          ['Specific people', 'The whole pot goes to the people you pick on the Rota page (tap Change on the pot\'s card), split equally between them. Their pick is kept for the following weeks until you change it, and older weeks keep what they had. Until someone is picked the pot is paid as shares.'],
        ]}
      />
      <P>
        Everyone still gets their share overall. When a pot goes to specific people, the people it
        was paid to get less of the other tips and everyone else gets more, in cash (or by bank when
        no pot is paid in cash). Example: £200 cash tips and £40 card tips shared equally between 6
        people is £40 each. With the card tips paid by bank to Cara, Cara gets £40 by bank transfer
        and nothing in cash, and the other five get £40 cash each: £200 cash and £40 by bank in all.
      </P>
      <P>
        The table under the pots then shows a <strong>Bank</strong> and a <strong>Cash</strong>{' '}
        column for each person, and a <strong>Pay out</strong> line with the totals. Tip moves and
        +/− nudges are paid the same way as the adjustment. If a pot paid to someone is bigger than
        their share of everything, their cash shows <strong>hands on £x</strong>: they pass that
        much to the others, and the Pay out line says how much in total.
      </P>
      <P>
        A pot can also have <strong>fees and surcharges</strong>, for example card fees and tax:
        in the pot's settings tap <strong>Add fee</strong> for each one and give it a name and a
        percentage. They are taken off the pot's total (sources plus manual lines) before anything
        is shared, so staff share what is left. Fees stack: each one is taken from what is left
        after the ones above it, so 2% card fees then 20% tax takes 21.6% in total, not 22%.
        Dragging them into a different order does not change the total, only how much each fee
        shows as. The pot's card on the Rota page shows the total before deductions, each fee,
        and the amount available to share.
      </P>
      <P>
        <strong>Manual lines</strong> are either a <strong>£ amount</strong> or a{' '}
        <strong>% of pot</strong> (pick when you add the line). Both can be negative, to take
        money out: for example a cash tips jar of £40, a breakage deduction of −£10, or a card
        fee of −2%. A % line is worked out on the pot's Cash Recon sources plus its £ lines, and
        the card shows what it comes to in £. On the Rota page, tap the <strong>+</strong> /{' '}
        <strong>−</strong> button next to a line to switch between adding and deducting (a
        tablet's number keypad has no minus key). A percentage must be between −100% and 100%.
        A pot never goes below £0.
      </P>
      <P>
        On the Rota page, the <strong>Tips</strong> section shows a card per pot with where its
        money came from; type this week's amount for each manual line and tap{' '}
        <strong>Save amounts</strong>. Below the cards, a table shows each person's points and
        their share of every pot, with a total per person. The "Distribution" choice that used
        to sit on each Cash Recon service charge source is gone: tip pots replace it. Sources that
        were set to "Distributed to Staff" were moved into a "Staff tips" pot shared by points.
      </P>
      <P>
        <strong>Tip moves and adjustments</strong>, below the table, lets payroll reward or correct
        a week. Tap <strong>New</strong> and choose what to do: <strong>Move</strong> (take from one
        person and give to others, the total stays the same), <strong>Add</strong> (give people
        extra on top of their tips, e.g. a £25 bonus; nobody else loses anything) or{' '}
        <strong>Take out</strong> (remove an amount from people, e.g. £25 for a till shortage; it
        is not passed to anyone). Add and Take out need a reason, which is shown in the list. You
        can't take out more than someone has. For a move, choose <strong>Points</strong> (changes
        everyone's share of every pot shared by points) or <strong>£ amount</strong> (moved after
        all the pots are shared), pick who to take from, then tick one or more people to give to.
        Split it <strong>Equally</strong> (enter the total; pennies left over go to the first
        people), <strong>By £</strong> / <strong>By points</strong> (type each person's amount),
        or <strong>By %</strong> (enter the total and each person's percentage, which must add up
        to 100). You can't move more than the person has, and you can add a note. Every move is
        listed with who, how much, when and the note, and each can be undone on its own (bin
        icon). <strong>Undo all point entries</strong> / <strong>Undo all £ entries</strong> clear a
        week in one go. £ moves and adjustments show in the <strong>Adjusted £</strong> column, and
        the line under the pots shows the total added and taken out. Tips are shown here
        only; they are not added to Cash Recon wages.
      </P>
      <P>
        <strong>Quick +/− nudges.</strong> For small corrections, each person's{' '}
        <strong>Total</strong> in the tips table has a <strong>−</strong> and a{' '}
        <strong>+</strong> button. <strong>−</strong> takes £0.50 of their tips and puts it in the
        week's <strong>Unallocated</strong> pot, shown just above the table.{' '}
        <strong>+</strong> takes £0.50 out of the Unallocated pot and gives it to that person, so
        you can only add what you have taken off someone first. The small red or green figure under
        a total is that person's net change. Whatever is left in the Unallocated pot at the end of
        the week is <strong>carried over to the next week</strong>: next week's box shows it as
        carried over, and you can hand it out there with <strong>+</strong> (anything still left
        carries on again). <strong>Undo all</strong> (with a confirm) puts this week's +/− back as
        they were. Nudges are separate from the tip moves list.
      </P>
      <P>
        <strong>Half-point +/−.</strong> When a pot is shared by points, each person's{' '}
        <strong>Points</strong> also has a <strong>−</strong> and a <strong>+</strong> button
        (Rota page and the Rota dashboard's Tips widget). They work like the £ buttons:{' '}
        <strong>−</strong> takes half a point off someone and puts it in the week's{' '}
        <strong>spare points</strong>, shown in the Unallocated box; <strong>+</strong> gives half
        a spare point to someone, so you take off someone first. Spare points keep their share of
        the pots, so taking half a point off one person doesn't change anyone else's tips; the
        box shows what the spare points are worth. Anything they are still worth at the end of the
        week is carried over to next week with the rest of the unallocated tips. The{' '}
        <strong>Changed</strong> column shows each person's point moves plus their taps.{' '}
        <strong>Undo point taps</strong> (in the box, with a confirm) puts everyone's points back
        as they were before the taps; it doesn't touch the tip moves list.
      </P>
      <H3>Rota dashboard</H3>
      <P>
        The <strong>Rota dashboard</strong> works like the Cash and H&amp;S dashboards: named
        tabs, Edit layout to add, resize and reorder widgets, and any other widget can go on it
        too (see Dashboards).
      </P>
      <DataTable
        head={['Widget', 'Shows']}
        rows={[
          ['Rota grid', 'The week\'s rota, editable the same way as the Rota page. Tap a day heading to select that day.'],
          ['Who\'s on', 'Everyone working the selected day, grouped by shift, plus anyone entered by hours. Day buttons along the top pick the day.'],
          ['Hours and pay', 'The pay table from the Rota page; the title bar shows the week\'s total pay. In Edit layout, Show bank transfer and cash splits each total into Bank and Cash columns by each person\'s Paid by setting.'],
          ['Tips', 'The tip pots and each person\'s share from the Rota page; the title bar shows the total shared with staff this week. In Edit layout, Hide pots / Hide staff shares / Hide moves pick which of its three parts show, so you can add the widget more than once and lay the parts out separately.'],
        ]}
      />
      <H3>The rota on the phone</H3>
      <P>
        On the phone app (<strong>ops.</strong> or the Macaroonie Office app) the{' '}
        <strong>Rota</strong> tile opens this week's rota for the restaurant picked at the top. Use
        the arrows, or swipe across the page, for the week before or after; <strong>Back to this
        week</strong> comes back. Three views:
      </P>
      <DataTable
        head={['View', 'Shows']}
        rows={[
          ['By day', 'A card per day: who is on with their shifts or hours and role, who is off and why (SICK, PTO and so on), anyone off the rota that day (left, or an off-rota period), and the day\'s people and hours. The row of days at the top stays put and jumps to a day; today is picked out.'],
          ['By person', 'One row per person: a box per day with the hours they are on, S for sick, P for holiday (paid time off), U unpaid, A absent, and their hours for the week.'],
          ['Me', 'Your own week. The first time, tap your name (the phone remembers it); Not you? picks again.'],
        ]}
      />
      <P>
        If you can edit the rota, tap a person's day (a row on By day, a box on By person, a day on
        Me) to set each shift <strong>Off</strong>, <strong>On</strong>, <strong>Sick</strong> or{' '}
        <strong>Holiday</strong>, then <strong>Save</strong>. On an hourly rota you set the times
        instead: add hours (or a shift's times) and pick what each period is. <strong>Add
        someone</strong> under a day puts a person who isn't on yet onto it. It saves to the same
        rota as the office, so the grid shows the change straight away; the rest of the week stays
        as it was. People who can only view the rota see it with a View only note, and nothing
        opens. Pay and tips stay in the office.
      </P>
      <InfoBox type="tip">
        Access is set per module in Access: Staff (staff list, roles, rota setup), Rota (view or
        edit the rota), Rota pay (hours and pay, pay overrides and filling Cash Recon wages),
        Rota tips (tip pots, points, tip shares, moves and adjustments) and Rota dashboard.
        Rota pay and Rota tips are separate, so you can, for example, let operators view tips
        without seeing wages. Both are owners and admins only by default. Someone who can see
        only one of them sees just that section on the Rota page and dashboard.
      </InfoBox>
    </section>
  )
}
