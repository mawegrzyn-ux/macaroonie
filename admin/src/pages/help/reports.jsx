// src/pages/help/reports.jsx
// The Help page's "Reports" section. Help.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, Mono, InfoBox, DataTable } from './parts.jsx'

export const id = 'reports'
export const label = 'Reports'
export const order = 220

// ── STAFF & ROTA ──────────────────────────────
// ── REPORTS ─────────────────────────────────────
export function Section() {
  return (
    <section id="reports" data-help="">
      <H2>Reports</H2>
      <P>
        <strong>Reports</strong> (main menu, under Dashboards) answers questions about your own
        figures: till sales, online orders, table bookings, cash reconciliation, staff, the rota
        with its pay and tips, the kitchen screens, self-order kiosk visits, loyalty, purchasing,
        food safety, checklists and the H&S action log, menus, reviews and the website, local news
        and the weather, and Store tech&apos;s tills, card machines, printers and menu screens,
        with the rest to follow. It comes with over a hundred starter reports, such as Sales by day (and Sales by day, every till, with another till such as Loyverse), Payments by tender, No-shows and
        cancellations, Cash variance by day, Hours and pay by person, Ticket times by station and
        Spend by supplier, and you can build your own. A report can be
        drawn as a chart above its table, opened up row by row down to the check, order or
        booking itself, downloaded and printed. A report
        always runs as the person looking at it, so it only ever shows what your role is allowed
        to see.
      </P>
      <H3>Finding a report</H3>
      <P>
        The page lists <strong>Starred</strong> reports first, then <strong>Your reports</strong> and{' '}
        <strong>From your team</strong> (once there are any), then the <strong>Starter reports</strong>{' '}
        an area at a time: Till sales, Online orders, Bookings, Cash reconciliation, Staff and rota,
        Kitchen, Self-order kiosks, Loyalty, Purchasing, Food safety and H&amp;S. Type in{' '}
        <strong>Find a report</strong>{' '}
        to search names and descriptions, or tap an area button to see just that area. The star on a
        report keeps it at the top for you only. A starter shown faded with <strong>Needs Online
        orders</strong> (or another area) is one your role can't run; an owner or admin can give
        access on the Access page. <strong>New report</strong> (top right, with Use or Manage on
        Reports) starts one of your own.
      </P>
      <H3>Opening a report</H3>
      <P>
        A report opens with its usual period, for example last week. Tap <strong>Period</strong> to
        pick another: today or yesterday, this or last week, month, quarter or year, the last 7, 14,
        28 or 90 days (or any number of days up to yesterday), the days coming up (for bookings and
        orders ahead), or two dates of your own. A named period moves on with the calendar; your own
        dates stay as picked. With more than one venue, tap <strong>Venues</strong> for every venue
        or just the ones you tick.
      </P>
      <P>
        A report can ask for more than its period and venues, for example which server or which
        order types. Each such choice is a button beside Period that says what is picked. Tap it
        to pick something else and press <strong>Show</strong>, or <strong>Show everything</strong>{' '}
        to leave nothing out. What you change here lasts for this visit only:{' '}
        <strong>Back to the report's usual choices</strong> puts it back, and the report itself
        stays as it was.
      </P>
      <P>
        The bar above the table says which dates the figures are for, how many rows there are and
        the time they were read. A result is kept for a minute, so opening the same report twice
        doesn't read everything again; <strong>Refresh</strong> reads it again straight away.
      </P>
      <H3>Reading the table</H3>
      <DataTable
        head={['Kind of report', 'What you see']}
        rows={[
          ['Summary', 'A row for each thing the report groups by (a day, a dish, a server), with its figures, subtotals where the report has them, and a Total row at the bottom.'],
          ['Table across', 'Rows down the side and a column for each value of something else (each hour, each channel), with a total for every row and every column.'],
          ['List', 'One row per check, order, booking or payment. The first 5,000 rows show on the page, with a note when there are more; the bottom row adds up the money columns and says how many rows there are in all.'],
        ]}
      />
      <P>
        The headings stay in view as you scroll down and the first column stays as you scroll
        sideways. An empty cell means nothing happened there at all; a 0 means something did but
        none of it counts for that figure (a time of day whose only booking was a no-show has 0
        guests). A report of the top 25 of something can end with a row for everything else. A
        note under the bar tells you when a column was left out because your role can't see it,
        and a figure worked out from it goes with it: without Purchasing setup, Spend by
        supplier shows each supplier's orders without the money or each one's share of it.
      </P>
      <H3>Charts</H3>
      <P>
        A report can have a chart above its table. Eleven of the starter reports open with one
        (Sales by day as bars, Sales by section as parts of a whole, Guests by day and time as
        a heat table), and you choose one for a report of your own in the builder. The chart
        draws the same figures as the table, for the period, venues and other choices showing.{' '}
        <strong>Hide the table</strong> under the chart leaves just the chart, and{' '}
        <strong>Show the table</strong> brings it back. A list has no chart.
      </P>
      <DataTable
        head={['Chart', 'What it shows']}
        rows={[
          ['Bars', 'A bar for each row. Several values, or the parts of a second grouping, sit side by side or stacked on each other. Sideways bars suit long names such as dishes.'],
          ['Lines', 'A line for each value, or for each part of a second grouping, usually over days or weeks.'],
          ['Area', 'Lines with the space under them filled. The parts of one value stack up to its total.'],
          ['Bars with a line', 'One value as bars and another as a line over the same rows, such as sales with the average spend.'],
          ['Parts of a whole', 'One bar cut into its parts, each with its share of the total: sales by section, bookings by source. More than six parts are drawn as a bar each, with their shares.'],
          ['Figures', 'Each value\'s total as a big number, with the change when the report compares periods and a small trend line when it runs by date.'],
          ['Heat table', 'A grid shaded by the value, darker for more: hours down the side and days of the week across.'],
        ]}
      />
      <P>
        Point at a bar, a point or a cell (or tap it) to read its figures. A tap keeps them
        on screen, with a button to open that mark up the way a row of the table opens; tap
        anywhere else to let go. With more than one series, the names above the chart say which
        colour is which: tap a name to take that series off the chart and again to put it back
        (one always stays). With a keyboard, Tab to the chart, walk its marks with the arrow
        keys, press Enter to open one and Escape to let go.
      </P>
      <P>
        Figures of different kinds never share a scale: pounds and a percentage each get a plot
        of their own, one above the other, and every scale starts at zero. A chart draws eight
        series at most (when the figures add up, the smallest are added together) and up to 60
        rows, or 400 when the rows are dates or times. A note under the chart says when something was
        left out, and the table always has everything. When a report can't be drawn as its
        chart (nothing to draw yet, or venues in more than one currency), a line says why and
        the table shows instead.
      </P>
      <H3>Opening a row up</H3>
      <P>
        A row of a summary can be opened to see what is behind it. Tap the row (a line under
        the bar says when rows can be tapped). A window names the row, shows its figures and
        offers what it can be opened into: <strong>By ...</strong> shows the same figures broken
        down by something else (a day's sales by dish, a dish by server), and{' '}
        <strong>Show the rows</strong> lists the checks, dishes sold, payments, orders or
        bookings behind it. When there is only one thing to open into, the tap goes straight
        there. In a table across, tap a figure to open just that cell, or the row's name for
        the whole row. The Total row opens the same way, for everything in the report. A bar,
        point or cell of a chart opens too: tap it, then the button under its figures.
      </P>
      <P>
        A trail above the table shows where you are: <strong>All</strong>, then each row you
        opened and what you opened it into. Tap a step to go back to it, or All for the report
        itself. What you opened can be opened further, each field once on the way down. The
        period, venues and other choices still apply, <strong>Refresh</strong> reads the same
        place again, and the CSV and Excel files are of what is on the page. The steps last for
        the visit: opening the report again starts at the top.
      </P>
      <P>
        The rows behind a figure are the ones that figure counts. Sales count dishes on closed
        checks that weren't voided, so the list behind a day's sales holds those dishes and adds
        up to the figure, and a note says that only they are listed. Where a report's figures
        count different rows (payments beside refunds, bookings beside no-shows), tap the figure
        itself to list its rows, or the row's name for everything behind the row. The row for
        everything else under a top few can't be opened. A share of the total in an opened row
        is its share of what is on the page now.
      </P>
      <H3>Opening the check, order or booking itself</H3>
      <P>
        A row of a list opens the record itself on its own page in the app: a check or a
        trading day in Till reports, an online order on Online orders, a booking on Bookings,
        a customer on Customers, a menu, a section or a dish in the menu editor. A line under
        the bar says what a tap opens (Tap a row to open the check). A dish sold, a payment, a
        discount or a void opens its check, a dish of an online order opens the order and a
        deposit its booking. A check, order or booking opens on its own venue and day,
        whatever that page showed last. In a list of online sales only your own orders open, since GloriaFood
        orders have no page here, so the rows that open are underlined.
      </P>
      <P>
        The first cell of a row that opens is a link: with a keyboard, Tab to it and press
        Enter. Ctrl or Cmd with a click, or the middle mouse button, opens the record in a new
        tab and leaves the report as it is. Picking out words in a row with the mouse doesn't
        open it, and while the report reads its figures again (the result before shown faded)
        its rows don't open.
      </P>
      <P>
        The record's page opens with a bar at the top: <strong>Back to the report</strong> and
        the report's name. It takes you back to the report as you left it: the period, venues
        and other choices, the rows you opened up, and where the page and the table were
        scrolled to. The browser's Back does the same. The bar stays while you look around the
        record's page (close the check, look at another day) and goes once you open another page
        from the menu. The record's address works on its own too, without the bar. When the
        record isn't there any more (a booking deleted, a dish taken off its menu) the page says
        so.
      </P>
      <P>
        The rows listed behind a figure or a row of a summary (<strong>Show the rows</strong>)
        open their record the same way. A row only opens for people whose role can open that
        page: when a report's rows open the customer, someone without access to Customers sees
        them as plain rows. A report of your own sets what its rows open in the builder (see
        Rows, values and filters). The CSV and Excel files have the figures only.
      </P>
      <H3>Where the figures come from</H3>
      <P>
        Every figure is the one its own page shows. Till sales are the till's own X and Z report
        figures, on the trading day: sales after midnight stay on the day before until the trading
        day starts (<strong>Trading day starts at</strong> in Store tech, Receipts and payments), so
        in the small hours tonight's sales are under Yesterday and Today is still empty. Sales,
        every till; Dishes sold, every till; and Payments, every till put your own till beside a
        venue's other till (Loyverse, linked on the Integrations page) with a Till column: the other
        till's receipts count once they come in, on the trading day they fall on, refunds apart. Online
        orders match the Online orders page's Report and
        Transactions tabs: an order sits on the day it was for, rejected and cancelled orders are
        listed but not counted, and a GloriaFood order sits on the trading day its Cash Recon link
        puts it on. Bookings sit on the day they are for, at the venue's own time, and Bookings and
        Guests leave out cancelled bookings and no-shows, as the Bookings page does. A deposit sits
        on the day it was paid. Times are shown at the venue's own time.
      </P>
      <P>
        Kitchen tickets are the Kitchen report's: a ticket is a bump that wasn't brought back,
        timed from the order reaching the station, on time within the station's own target
        minutes and late after its late minutes (8 and 12 unless set in Store tech). Kiosk visits
        are Kiosk analytics' own: a visit ordered when it ended with an order, one that didn't
        gave up on the screen it ended on, and what was left in baskets is what those orders
        held. Loyalty points are each member's history added up, as the member's own page shows
        it; a member erased for GDPR has their points taken to nothing without a line in their
        history, so their history no longer adds up to their points. Supplier orders sit on the
        day they are delivered, cancelled orders are left out of spend, and deliveries booked in
        without an order count with the rest; prices and money need Purchasing setup, as on the
        purchasing pages. A reading out of range with nothing written in its corrective action is
        unresolved, the rule the Overview's H&amp;S tiles use, and a checklist sits on the first
        day of its day, week or month.
      </P>
      <H3>Reports on menus, the website and Store tech</H3>
      <P>
        Each needs its own page&apos;s access as well as Reports. A few starter reports cover them
        (in the list below); build anything else with <strong>New report</strong> (or ask Pepper).
      </P>
      <DataTable
        head={['What a report can be about', 'Needs', 'As it is counted']}
        rows={[
          ['Menu publishes, option groups and options, allergens and dietary tags, which dishes carry which, dish option groups and prices, dishes\' own options, tax rates', 'Menus', 'The menus as they are being edited, as the Menus pages show them; guests see the published version, and Menu publishes says when each went live (Live, Earlier, Scheduled or Cancelled). A tax rate shows its usual %: a location or order type may have its own.'],
          ['Reviews, website pages and modals, Media library files and categories', 'Website CMS', 'Reviews as the Reviews page holds them, on the day written (else the day they reached us), checked or still in the To check inbox; average stars leave out reviews without stars. Pages are as being edited, with their address on the site. A review or page not tied to a location shows only with every venue picked.'],
          ['Local news and events, Local info captures', 'Local info', 'What the captures found and what staff typed in, without what someone hid; weather forecasts are in Weather. A capture says how often it runs, when it last ran and any problem.'],
          ['Menu screens, screen boards, playlists and walls', 'Menu screens', 'What each screen shows (its wall\'s board or playlist when it is in a wall) and whether it talked to us in the last two and a half minutes, as on the Menu screens page.'],
          ['Devices (tills, kitchen screens, kiosks, venue hubs), card machines, printers, print jobs, till roles, floor areas', 'Store tech', 'Store tech\'s own lists; a removed device stays, so its sales keep a name. A print job says when it printed, how long it waited, or that it failed.'],
          ['Till activity, changes refused, card machine payments, kiosk receipts by link', 'Till reports', 'Every change made on a till or kiosk, when it was made and when it reached us (later when the till or the venue was offline); the changes the cloud refused, sorted out or not; every card machine sale and refund, declines included, and any approved but never put on a bill; how often each kiosk receipt was opened and emailed (no addresses).'],
          ['Online order history, dishes sold out now, promotions', 'Online orders (Promotions for the promotions)', 'Each order\'s changes, status by status, by staff, the guest or the system; the dishes sold out at each venue right now, as the tills are told; the Promotions page\'s list.'],
          ['Table combinations, emails sent', 'Bookings (Booking emails for emails)', 'The combinations set up for bigger parties; every email sent for bookings and online orders, sent or failed, test emails included.'],
        ]}
      />
      <H3>Reports on Pepper and your group</H3>
      <P>
        How much Pepper is used, the changes it made and its chats, and your group itself: the
        team, its roles, new locations, the issues you logged and the features you asked for.
        Pepper&apos;s reports hold counts and dates only, never what anyone asked or what Pepper
        answered. Its months and days run on UTC, as its monthly allowance and each
        person&apos;s daily share do.
      </P>
      <DataTable
        head={['What a report can be about', 'Needs', 'As it is counted']}
        rows={[
          ['Pepper\'s use by month: requests, units, tokens and web searches, by where (its chat, AI apps on the staff connector, the website chat, guest AI apps)', 'Pepper (AI assistant)', 'As the month\'s figures on the Pepper page\'s Settings tab.'],
          ['Pepper\'s use by person and day', 'Manage on Pepper (AI assistant)', 'As the people on the Settings tab, by email: requests and the units each person\'s daily share counts. Their name and role come from the team, with Team access; someone no longer on the team has none.'],
          ['Pepper\'s changes', 'Manage on Pepper (AI assistant)', 'As the Activity tab: what each change was, where it was made, who asked (A guest for the website chat), whether it went through, and the booking it was about. What was asked and the answer aren\'t reported.'],
          ['Pepper\'s chats', 'Manage on Pepper (AI assistant)', 'Every chat on the day it started: who started it, which model it ran on, whether it was closed and why, and how many changes it made. Titles and what was said aren\'t reported; chats idle past your retention are deleted, so older days hold fewer.'],
          ['Team', 'Team', 'As the Team page lists everyone with a sign-in: their role, whether they are active, when they last signed in and who invited them.'],
          ['Roles', 'Reports only', 'The four built-in roles and your own, as the Access page lists them, with who has each. What a role may do isn\'t reported.'],
          ['New locations', 'Venues', 'Every new location planned on the New location page or with Pepper, on the day it was started: how far it got, when the location was made and how many follow-ups are left. What was typed and Pepper\'s plan aren\'t reported.'],
          ['Issues', 'Issue log', 'Every issue your group logged, on the day it was logged, with its priority, status and how long resolving it took.'],
          ['Feature requests', 'Feature requests', 'The features your group asked for, with every group\'s votes and where each got to. Other groups\' requests aren\'t counted.'],
        ]}
      />
      <P>
        A starter report your role can&apos;t run says what it needs: Pepper&apos;s use by person
        says <strong>Manage on Pepper (AI assistant)</strong> to someone with View.
      </P>
      <H3>Downloading a file</H3>
      <P>
        <strong>CSV</strong> and <strong>Excel</strong> (top right, with Use or Manage on Reports)
        download the report for the period, venues and other choices showing. A list comes in
        full, not just the rows on the page. Numbers stay numbers: money in pounds, percentages as
        percent, lengths of time in seconds, with the unit in the heading (Net sales (GBP), No-show
        rate (%)). The Excel file has an About sheet saying which report it is, the period, the
        venues, who made it and when. A CSV list holds up to 250,000 rows and an Excel file up to
        200,000 cells; a file that was cut short says so.
      </P>
      <H3>Printing a report</H3>
      <P>
        <strong>Print</strong> (top right of a report) opens the report in a new tab as a page
        made for paper, and the browser's print window opens on it by itself. Choose a printer,
        or Save as PDF for a file. The page is the report as you have it on screen: the period,
        venues and other choices, the rows you opened up, the chart without any series you took
        off, and the table if it is showing under the chart. It starts with your group's name
        and logo, the report's name and what it was run for, and ends with when the figures
        were read and who printed it.
      </P>
      <P>
        The table prints upright when it fits, on its side when it is wider, in smaller text
        when that makes it fit, and otherwise in parts, each part starting with the rows'
        names. The headings repeat on every sheet, a row is never split across two, and Chrome
        and Edge number the sheets. The print page works for 15 minutes: after that it says it
        has run out, and <strong>Print</strong> on the report makes a new one. Anyone who can
        open a report can print it, and the page shows only what your own role may see.
      </P>
      <H3>Keep a file</H3>
      <P>
        <strong>More</strong> (top right of a report), then <strong>Keep a CSV file</strong> or{' '}
        <strong>Keep an Excel file</strong> (with Use or Manage on Reports), makes the same file a
        download would, for the period, venues and other choices showing and the rows you opened
        up, and keeps it on <strong>Past runs</strong> to download later: on another device, or
        once you are back at a desk. A note says where it is, with <strong>Open Past runs</strong>.
        A file is kept for 30 days, or 7 days when it lists people&apos;s names, emails or phone
        numbers. You can also ask Pepper to keep a file of a report for you.
      </P>
      <P>
        Only the person who kept a file can download it: others who manage reports see it on
        Past runs with who made it. If what your role can see in the report changes after the file
        was made, more or less, the file can&apos;t be downloaded any more: run the report again
        for a new one. To take a file off before its time, use <strong>Remove this file</strong> on
        Past runs, then <strong>Yes, remove it</strong>. Your group keeps up to 500 MB of files at
        once. When a guest&apos;s customer record is anonymised or a loyalty member is erased,
        every kept file that lists people is taken off at once.
      </P>
      <H3>Past runs</H3>
      <P>
        <strong>Past runs</strong> (top of the Reports page, or More on a report, then{' '}
        <strong>Past runs of this report</strong>) lists the reports you ran on screen,
        downloaded, printed or kept a file of, newest first: what was done and when, the report,
        the period, venues and other choices it was run for, how many rows it had, how long it
        took, and <strong>By Pepper</strong> when Pepper ran it for you. Words typed into a
        filter show as set, never the words themselves. <strong>Kept files</strong> shows only the
        runs that kept a file, each with <strong>Download</strong>; <strong>Show older runs</strong>{' '}
        at the foot goes further back, up to 400 days. With Manage on Reports,{' '}
        <strong>Everyone&apos;s</strong> shows everyone&apos;s runs in your group with who ran
        them, and the <strong>Report runs</strong> subject under Your group counts them in a
        report of your own.
      </P>
      <H3>Scheduling a report</H3>
      <P>
        Open a report, tap <strong>More</strong>, then <strong>Schedule this report</strong> (you need
        Use or Manage on Reports). Choose <strong>when</strong>: every day, the weekdays you tick, or
        once a month (a day such as the 1st, the last day, or the first Monday), at a time on the
        venue&apos;s clock; the window shows when it next sends. Choose <strong>whether it sends</strong>:
        every time, only when the report has rows, or only when a figure is over or under an amount
        you set (net sales under £500 on any row, say). Choose <strong>what is sent</strong>: the
        figures in the message (the first 100 rows), a CSV or Excel file attached, or both, and
        whether the file is also kept in Past runs. Choose <strong>who gets it</strong>: with Use,
        just you; with Manage, people on your team; an owner or admin can also add outside
        addresses, and decide whether people&apos;s details may go to them (they are left out
        otherwise). Give it a name and a line to go with it, then <strong>Save</strong>.
      </P>
      <P>
        A schedule always covers a moving period (yesterday, last week, this month so far), never
        fixed dates, and it runs as the person who set it up: the people it is sent to see what
        that person may see, so think before sending pay or people&apos;s details. If that person
        leaves, loses access to the report or the report needs changing, the schedule pauses, and
        they and your owners get an email saying why. A send that fails is tried again for up to
        about six hours; one that is more than six hours late is skipped rather than sent late.
        Emails go out through the venue&apos;s own email settings (the Emails page, Settings tab).
      </P>
      <P>
        <strong>Schedules</strong> (top of the Reports page, or More on a report, then{' '}
        <strong>Schedules of this report</strong>) lists yours, or everyone&apos;s with Manage: when
        each next sends, what happened last time, and <strong>Edit</strong>, <strong>Pause</strong> or{' '}
        <strong>Resume</strong>, <strong>Send now</strong> (once, whatever its condition),{' '}
        <strong>Past runs</strong> and delete. Changing someone else&apos;s schedule makes it yours
        from then on. Past runs marks each one <strong>Sent by a schedule</strong> or{' '}
        <strong>Skipped by a schedule</strong>, with how many people it went to. Pepper can do all
        of this too: ask it to email you a report every Monday morning.
      </P>
      <H3>Emailing a report now</H3>
      <P>
        <strong>More</strong>, then <strong>Email it now</strong>, sends the report once as it is on
        screen, with the period, venues and other choices you picked and any rows you opened up:
        in the message, as a CSV or Excel file, or both, to the same people a schedule could go
        to. It shows in Past runs as <strong>Emailed</strong>.
      </P>
      <H3>Data links: figures for other apps</H3>
      <P>
        Owners and admins with Manage on Reports can give a report an address other apps read its
        current figures from (Power BI, Google Sheets, a system of your own): <strong>More</strong>,{' '}
        <strong>Data links</strong>, <strong>Make a data link</strong>. The choices picked on the page
        are the link&apos;s own; tick any the reading app may change (usually the period). The key is
        shown once: copy it then. The app sends it in an <Mono>Authorization: Bearer</Mono> header and
        gets JSON, or CSV with <Mono>?format=csv</Mono>. A link runs with its maker&apos;s access every
        time it is read, stops when they leave or lose Manage, keeps to its calls an hour, and can
        stop on a last day. People&apos;s details are left out unless an owner allows them. Switch a
        link off, give it a <strong>New key</strong> (the old one stops) or delete it from the same
        window. Past runs shows each read as <strong>Read by a data link</strong>.
      </P>
      <H3>Posting a report to a web address</H3>
      <P>
        A schedule can also post the report, as JSON, to a web address of your own each time it
        sends (owners and admins with Manage): fill in <strong>Post to a web address</strong> in the
        schedule window. With nobody to email, the post is the whole send. After saving, the window
        shows a signing secret once: the receiving app checks each post&apos;s{' '}
        <Mono>X-Macaroonie-Signature</Mono> header with it. Addresses must start with https:// and be
        on the public internet.
      </P>
      <H3>Reports on dashboards, the phone, the menu search and Today</H3>
      <P>
        <strong>On a dashboard:</strong> in <strong>Edit layout</strong>, <strong>Add widget</strong>,{' '}
        <strong>A report</strong> (under Reports), then pick the report in the widget. It shows the
        report&apos;s chart and table as you would see them, refreshed every few minutes, with{' '}
        <strong>Open the report</strong> for the rest. Its options <strong>Chart only</strong> and <strong>Table only</strong> leave the other
        out. People who open the dashboard see it with their own access.
      </P>
      <P>
        <strong>On the phone:</strong> the <strong>Reports</strong> tile lists your starred reports, your
        own and your team&apos;s, and the starters, with a search. Tap one to see it with its period;
        building, sharing and schedules stay on the office pages.
      </P>
      <P>
        <strong>In the ask bar:</strong> typing in the ask bar (on Home, or Search or ask at the top of
        the menu) also lists reports you can run whose name or description has your words, under{' '}
        <strong>Saved reports</strong>: your own and your team&apos;s, and the starters you have starred.
      </P>
      <P>
        <strong>On Today:</strong> tick <strong>Also raise a task on Today</strong> in a schedule&apos;s window and
        each time it sends (only when its condition is met, if it has one) the venue&apos;s Today page
        shows a task with the report&apos;s name, opening the report. A schedule can do just that, with
        nobody to email. The task shows for the venues the report covers, to people who can open
        the report.
      </P>
      <H3>How reports look on paper</H3>
      <P>
        <strong>Reports</strong>, then <strong>Layouts</strong>, lists your group&apos;s layouts. A layout
        says how a report prints and how its PDF looks: the paper (the printer&apos;s own, A4 or Letter),
        which way round, the margins, what goes at the top of the first sheet (logo, group name, the
        report&apos;s description, the period, venues and rows, when it was read), the foot of every sheet
        (page numbers and your own words), the style (your brand colour, compact or roomy rows, stripes,
        how negative figures show) and a front page with a paragraph of your own. Tick{' '}
        <strong>The group&apos;s default</strong> and every report prints with it unless it picks
        another. <strong>Show the preview</strong> draws one of your reports with the layout before you
        save. Making and changing layouts needs Manage on Reports.
      </P>
      <P>
        A report picks its layout in <strong>More</strong>, <strong>How it looks on paper</strong> (anyone
        who can change the report).
      </P>
      <H3>A page of reports</H3>
      <P>
        <strong>New page</strong> on the Reports page puts several saved or starter reports on one page,
        in the order you drag them into, with headings, words of your own and page breaks between them.
        Each report can show its chart and table, the chart only or the table only. A page can have its
        own period and venues, which every report on it then uses (people looking can change them for
        their visit), or leave each report its own.
      </P>
      <P>
        Each report on the page is worked out for the person looking, with what their role may see: a
        report they can&apos;t open says so in its place. <strong>Print</strong> and{' '}
        <strong>PDF</strong> give the whole page, a new sheet at each break. A page can&apos;t be kept as a
        file, scheduled or emailed yet; its reports can. A break at the very end is left off.
      </P>
      <H3>PDFs</H3>
      <P>
        <strong>PDF</strong> beside CSV and Excel downloads the report as it prints, with its layout. More,{' '}
        <strong>Keep a PDF</strong> keeps one in Past runs, and a schedule can attach one. The server
        makes one PDF at a time, so at a busy moment it can take a little longer.
      </P>
      <H3>The starter reports</H3>
      <DataTable
        head={['Area', 'Reports']}
        rows={[
          ['Till sales', 'Sales by day; Sales by hour and weekday; Sales by dish; Sales by section; Sales by server; Sales by order type and revenue stream; Payments by tender; Discounts and comps, by whom and why; Voids, by whom and why; Cancelled orders, by whom and why; Charges added and taken off; Tips, by who took the payment; Average spend per check and per guest; VAT by rate; Trading days: cash counted against expected; Sales against the weather; Sales, labour and bookings by venue.'],
          ['Online orders', 'Online orders and sales by day and channel; Top dishes online; Promotions used online; Online orders: time to accept and to get ready; Online refunds; GloriaFood beside your own ordering.'],
          ['Bookings', 'Guests by day and time; Bookings by source; No-shows and cancellations; How far ahead people book; Party sizes; Deposits taken and refunded; New and returning guests; Emails sent and failed.'],
          ['Cash reconciliation', 'Cash variance by day; Cash variance by week; Cash variance by venue; Days the cash was short; Income against takings; Takings by payment channel; Expenses by category; Wages by week.'],
          ['Staff and rota', 'Hours and pay by person; Rota pay by week; Hours on the rota by day; Time off by person; Tips by person and pot; Tip pots by week; Rota pay against the wage list; Labour against sales by week.'],
          ['Kitchen', 'Ticket times by station; Ticket times by hour; Remakes and why; Kitchen screens: taps by screen.'],
          ['Self-order kiosks', 'Kiosk visits and orders by day; Where kiosk guests gave up.'],
          ['Loyalty', 'Members joined by week; Points given and spent; Rewards used; Stamp cards: stamps and cards filled.'],
          ['Purchasing', 'Spend by supplier; Spend by month; Spend by category; Delivery problems by supplier; Orders sent late; Invoices above the price ordered; Price changes; Products out of stock.'],
          ['Food safety and H&S', 'Fridge and freezer readings out of range; Hot and cold hold readings out of range; Cooking checks out of range; Delivery checks failed; Checklists done; Open H&S actions by age; H&S status by day; Food safety checks missed by venue; Food safety days needing action.'],
          ['Customers', 'Newsletter sign-ups by month.'],
          ['Menus', 'Dishes with no photo, price or allergens; Allergens by dish; Price list; Publishing history.'],
          ['Website and reviews', 'Reviews by rating, site and month.'],
          ['Local info', 'Local events and incidents coming up; Weather by the hour.'],
          ['Store tech', 'Card machine payments by machine; Tickets printed by printer; Menu screens offline.'],
          ['Till activity', 'Till activity by person; Till activity by till; Till buttons tapped.'],
          ['Pepper', 'Pepper\'s use by month; Pepper\'s use by person; Pepper\'s changes.'],
          ['Your group', 'Team sign-ins; Issues by priority.'],
        ]}
      />
      <P>
        Starter reports come with Macaroonie and stay as they are; <strong>Customise</strong> on
        one makes a report of your own that starts the same way. Each needs access to its own
        area as well as to Reports: Till reports for till sales, the kitchen and kiosk visits,
        Online orders for online orders, Bookings for bookings, Cash reconciliation for cash
        days, weeks, expenses and wages, Rota for hours on the rota and time off (Rota pay to see
        pay, Rota tips for tips and tip pots, and Cash reconciliation for the wage list beside
        the rota), Loyalty members for loyalty, Purchasing for supplier orders (and Purchasing
        setup for prices, price changes and what is out of stock), and Food safety logs,
        Checklists or the H&amp;S Action Log for theirs (H&amp;S days need Food safety logs, and
        Checklists as well for their colour and anything that counts checklists). The newer
        ones need Customers for newsletter sign-ups, Booking emails for emails, Menus for the
        menus, Website CMS for reviews, Local info, Till reports for card machine payments,
        Store tech for printed tickets, Menu screens for screens offline, Team for team
        sign-ins, Issue log for issues, and Pepper (AI assistant) for Pepper&apos;s use by month
        (Manage on it for use by person and for Pepper&apos;s changes). A figure
        your role can't see is left out of the report with a note saying so, and so are the
        figures a starter takes from another area (the weather, bookings, the rota) when your
        role can't see that area.
      </P>
      <P>
        Cash variance, rota pay and tips and each venue's H&amp;S day are worked out each time a
        report runs, by the same rules as the Cash Recon page, the Rota page and the Overview's
        H&amp;S tiles, so a report always shows what those pages show. Pay belongs to the week
        (Hours on the rota by day shows hours only), and changing a rate, a role's tip points or
        a shift's hours changes past weeks in reports as it does on the Rota page. An order sent
        late is one that went to its supplier after the order deadline for its delivery day,
        judged when it first went.
      </P>
      <H3>Asking Pepper to build a report</H3>
      <P>
        With Use or Manage on Reports and access to Pepper, the New report page starts with{' '}
        <strong>Describe it to Pepper</strong>. Say what the report should show in your own words
        ("net sales by dish last month at Ware, the top 20"), tap one of the examples, or add a
        photo or PDF of a report you use now (<strong>Add a photo or PDF</strong>, or{' '}
        <strong>Take a photo</strong> on a tablet or phone: photos up to 5 MB, PDFs up to 10 MB,
        10 files at most). Then tap <strong>Build it</strong>. Pepper works the report out and
        runs it on your figures, which can take up to a minute.
      </P>
      <P>
        The answer shows the report with your figures (the first 200 rows), its name and{' '}
        <strong>What this shows</strong>: the report in one sentence, worked out from how it is
        set up, so it always says what you see. <strong>What Pepper assumed</strong> lists what
        it chose for you (a period, a figure) and <strong>What Pepper couldn't do</strong> what
        it left out and why (a venue it couldn't find, something the reports don't hold yet).
        When a name could mean more than one thing (a venue or a dish written loosely), Pepper
        asks, and a tap on a choice changes the report straight away; answering a second
        question keeps the first answer. Ask about what is so now (H&amp;S actions still open,
        the points members hold) and the report covers every day instead of a period. When
        nothing the reports hold can show it (stock on the shelf, recipe costs), Pepper says so,
        and <strong>Ask in other words</strong> puts your words back in the box.
      </P>
      <P>
        Then <strong>Save it</strong> (its name and what it is for are filled in for you),{' '}
        <strong>Change it</strong> (say what to change: "only Fridays", "add guests", "as a line
        chart"), <strong>Open in the builder</strong> to carry on by hand (Back in the builder
        comes back to Pepper's answer) or <strong>Start again</strong>. Nothing is saved until you
        save it; going back and reloading the page keep the answer. Pepper is only shown the
        names of the figures and fields your role can see, never your figures, and builds only
        what the builder could have made; the report runs as you. Each build counts towards the
        group's AI allowance and your daily share of it.
      </P>
      <H3>Asking Pepper about your figures</H3>
      <P>
        In the Ask Pepper panel, on the Pepper page or in your own AI app connected to Macaroonie,
        ask about the figures in your own words: <em>"What were net sales by server last week?"</em>,{' '}
        <em>"Which dishes sold most on Fridays at Ware?"</em>, <em>"How many no-shows in
        October?"</em>. Pepper finds the right kind of report and its figures, runs it as you
        and reads the answer back, saying which period it covers and anything it assumed or
        couldn&apos;t do; when a name could mean more than one thing, it asks. It can also find
        and run your saved reports and the starters (for another period or other venues), and
        say what a figure counts (net sales leave out voided dishes; takings are what was
        paid).
      </P>
      <P>
        With Use on Reports, Pepper can save what it found as a report, change your own reports,
        copy one (a starter or someone else&apos;s, to make it your own) and delete your own; with
        Manage it can share them. Every change shows a card first and nothing is saved until you
        press its button. Pepper sees only what your role may see, each question counts towards
        the group&apos;s AI allowance, and it runs at most 20 reports a minute for one person.
      </P>
      <H3>Other words for a figure, and questions reports don&apos;t cover</H3>
      <P>
        Ask in the words your team uses: <em>&ldquo;How many pax did we do last week?&rdquo;</em> finds
        guests (covers), <em>&ldquo;comps&rdquo;</em> finds discounts, <em>&ldquo;over and short&rdquo;</em>{' '}
        finds the cash variance. The figures people ask about most (sales, covers, tips, discounts, voids,
        no-shows, dishes sold, wages, variance, food safety readings) carry these other words, a note on
        using them right (most questions about sales mean net sales; guests booked and guests who ate are
        different figures) and example questions. The search in the report builder&apos;s Data panel finds a
        figure by these words too.
      </P>
      <P>
        When something isn&apos;t in the reports at all (<em>&ldquo;what was our carbon footprint?&rdquo;</em>),
        Pepper says plainly that reports don&apos;t cover it yet and offers the nearest figures, rather than
        working something out another way or guessing.
      </P>
      <H3>Building a report of your own</H3>
      <P>
        With Use or Manage on Reports, tap <strong>New report</strong> on the Reports page and
        pick what the report is about (under <strong>Or build it yourself</strong> when Pepper is
        on): checks, dishes sold, payments, online orders, bookings and
        so on. Each report counts one kind of thing, and what belongs to it (its venue, its
        server, its dishes) can be used in the report too. Only the areas your role can see are
        offered. To begin with a report that is close to what you want instead, open it and tap{' '}
        <strong>Customise</strong>.
      </P>
      <P>
        The builder has three parts. <strong>Data</strong> lists everything that can go in the
        report: Figures (ready-made sums such as Net sales), the fields of the thing itself, and
        under Linked the things it belongs to, each opening to its own fields.{' '}
        <strong>Set up</strong> is the report: what its rows are, what is added up, which rows
        count. <strong>Preview</strong> shows the report as it stands (the first 200 rows), and
        redraws a moment after every change. On a wide screen the three sit side by side; on a
        tablet held upright or a phone they are three tabs.
      </P>
      <P>
        Tap a field in Data and choose what it should be: <strong>Group by</strong>,{' '}
        <strong>Across the top</strong>, <strong>Add as a value</strong> (a figure as it is; a
        number as its Total, Average, Smallest or Largest; anything else as How many different)
        or <strong>Filter</strong>. In a list the choice is <strong>Add as a column</strong>.
        Side by side you can also drag a field by its grip onto Rows, Across the top, Values or
        Filters. A field already in the report is ticked, one marked{' '}
        <strong>Personal details</strong> holds a guest's name, email or phone, and{' '}
        <strong>Find a field</strong> searches the whole list. The builder only offers what will
        work: a field that can't be added up isn't offered as a total.
      </P>
      <H3>Rows, values and filters</H3>
      <DataTable
        head={['In Set up', 'What it does']}
        rows={[
          ['Kind of report', 'Summary: figures added up, by whatever you group them by. List: one row for each check, order or booking, with the columns you pick. Switching keeps what the other kind had while the builder is open.'],
          ['Rows', 'What each row is: a day, a dish, a server. Several groupings nest (dish within section). Tap one to change its heading, group its days by day, week, month, quarter, year or day of the week (a time also by hour), put a subtotal after each, move it across the top or take it off. Drag by the grip to change the order. In a list this is Columns, left to right.'],
          ['Across the top', 'Each grouping here becomes a set of columns, to compare side by side (sales by dish down the side and by hour across). Two at most.'],
          ['Values', 'What is added up in each row. Tap one for its heading, how it is shown (as it comes, a number, money, a percentage, time taken) and its decimal places.'],
          ['Calculation', 'A value worked out from the report\'s other values, written with their short names and + - * / and brackets. total(x) is x for the whole report, so net_sales / total(net_sales) is each row\'s share. Tap a value to put its name in. A value needed only for a calculation can be marked Only for calculations, so it isn\'t a column.'],
          ['Filters', 'Which rows count: a server, an order type, checks over an amount, a period. Each filter is either fixed, or ticked Ask each time the report is opened, which makes it a choice at the top of the report that whoever opens it can change. For text the window offers the values found in your data to tap.'],
          ['Sort', 'By a grouping or a value, low to high or high to low, three levels at most.'],
          ['Show', 'Every row, or only the top or bottom few by one of the values (the top 10 dishes), with an optional row for everything else.'],
          ['Totals', 'A total row at the bottom. A subtotal after each group is set from the grouping itself.'],
          ['Compare with', 'The period before, or the same dates last year: each value gets the earlier period beside it and the change.'],
          ['Chart', 'For a summary or a table across: Table only, or a chart drawn above the table (Bars, Lines, Area, Bars with a line, Parts of a whole, Figures, Heat table). A kind the report doesn\'t fit says why when tapped and changes nothing. Then what the chart draws: the values (one, several, or the line and the bars), which grouping runs along the bottom when there are two, bars stacked or sideways, and whether the table shows under the chart to begin with.'],
          ['Tap a row: break it down by', 'For a summary: the fields a tapped row can be broken down by, in the order they are offered (a dish, a server, the hour). Up to 8. A day or a time can be grouped by week, month, quarter, year or day of the week (a time also by hour). A field the report is grouped by already stays on the list but isn\'t offered on a tap.'],
          ['Tap a row: show the rows', 'The columns of the list behind a tapped row. Left alone, the usual columns for that kind of row are used. Choose starts from them, and you can then add, take off and reorder columns (30 at most). Back to the usual columns undoes it.'],
          ['Tap a row: open it', 'For a list: what a tapped row opens on its own page in the app. The usual one (the check for dishes sold, the booking for deposits), something the row belongs to (its trading day, the dish, its section, the menu, the customer), or Nothing. Only what has a page in the app is offered.'],
          ['Rows a tapped row lists: open', 'For a summary: the same choice for the rows listed behind a tapped row.'],
        ]}
      />
      <P>
        When something is missing the preview says <strong>Not ready to show yet</strong> and why.
        Above the preview, the report's choices (its period, venues and anything it asks each
        time) set what it starts with; whoever opens it can pick something else. A report takes
        up to 8 groupings (30 columns in a list), 2 across the top, 20 values, 30 filters and 12
        choices.
      </P>
      <P>
        The preview's rows can be tapped the way the saved report's can, to try what a row
        opens into; a trail shows above it. Any change to the report goes back to the report
        itself.
      </P>
      <H3>Figures from other subjects</H3>
      <P>
        A summary can put figures from up to three other subjects beside its own: the hours and
        pay on the rota beside the till's sales, the guests booked beside the guests served, or
        the weather beside each day's sales. In Set up, under{' '}
        <strong>Figures from other subjects</strong>, tap <strong>Add</strong> and pick one.
        Subjects that can't line up with the report's rows as they are now say why (the rota
        can't be lined up by dish). Then add its figures: <strong>Figure</strong> on its card,
        or pick it in the list at the top of the Data panel and tap a figure there. Another
        subject's fields can be values or filters, never rows.
      </P>
      <P>
        Each subject is counted on its own, and its figures go beside the row they belong to:
        the same day (or week, month and so on), the same venue, or the same thing both lead to
        (a server, a dish). Nothing is counted twice. The report's period and venues apply to
        every subject. <strong>Filter</strong> on a subject's card picks which of its rows count,
        with a fixed value (it can't be asked each time, and it can't be on the day or the venue,
        which the report decides). Rota weeks run Monday to Sunday, so beside a report by day
        they line up only by week or longer: group the days by week and pick whole weeks. A row
        where a subject has nothing shows nothing for its figures.
      </P>
      <P>
        The box at the top of a subject's card is what it is called in the report (Rota,
        Bookings), and its figures' headings say so. <strong>Take it out</strong> removes its
        figures; the card names any calculation that uses them, which stops working. A table
        across can't have figures from other subjects. When the rows change so that a subject
        can't line up any more, its card says why, the preview leaves its figures out with a
        note, and <strong>Save</strong> waits until you change the rows or take it out.
      </P>
      <P>
        In the report, tapping a row breaks every subject's figures down together, and the rows
        behind one of another subject's figures are that subject's (<strong>The rota weeks behind
        Hours worked</strong>). Someone whose role can't see a subject sees the
        report without its figures, with a note saying so. The <strong>Weather</strong> subject
        (under Local info) is one row per venue and day from the weather capture on the Local
        info page: once the day is over, the weather that was recorded; before that, the latest
        forecast. <strong>Recorded</strong> says which, and the forecast fields (<strong>Weather
        forecast</strong>, <strong>Forecast highest</strong>, <strong>Forecast rain and snow</strong>) keep
        what was forecast for a recorded day, to put beside what happened. Pepper can build reports like these too ("sales
        against the weather by day", "labour against sales by week").
      </P>
      <H3>Saving and changing a report</H3>
      <P>
        Type a name at the top (and, under <strong>Details</strong>, what the report is for) and
        press <strong>Save</strong>. Nothing is kept until you do: the line under the buttons says{' '}
        <strong>Not saved yet</strong>, <strong>Changes not saved</strong> or{' '}
        <strong>Nothing to save</strong>, and Back asks before leaving with changes not saved.{' '}
        <strong>Save as</strong> keeps the report as it was and saves what you see as a new one
        under another name. <strong>View</strong> opens the saved report. Each person can keep up
        to 300 reports.
      </P>
      <P>
        On a report of your own, <strong>Edit</strong> (top right of the report) opens it in the
        builder. On a starter or a report someone else made the button is{' '}
        <strong>Customise</strong>: it opens the builder on a copy, which becomes your own report
        when you save it, and the original stays as it is. With Manage on Reports you can edit
        anyone's report.
      </P>
      <H3>Copying, renaming, sharing and deleting a report</H3>
      <P>
        The <strong>More</strong> button (three dots, top right of a saved report) has the rest.{' '}
        <strong>Make a copy</strong> saves a report of your own set up the same way and opens it.{' '}
        <strong>Name and details</strong> renames it. <strong>Delete this report</strong> asks
        first (Yes, delete it / Keep it); stars on it go with it.
      </P>
      <P>
        <strong>Share</strong> (with Manage on Reports) sets who else can open it:{' '}
        <strong>Only me</strong>, <strong>Some roles</strong> (tick them) or{' '}
        <strong>Everyone</strong> whose role has Reports. <strong>Offer it to the team as a
        starter report</strong> opens it to everyone with Reports, whatever is picked above, to
        run and to make their own from; they find it under From your team. Sharing a report
        shares how it is set up, never the figures: each person who opens it sees only what
        their own role may see, and a column their role can't see is left out for them.
      </P>
      <H3>Who can open, build and share reports</H3>
      <P>
        Reports is its own module on the Access page. <strong>View</strong> opens and runs the
        starter reports and any report shared with you, changes the period, venues and other
        choices for the visit, opens rows up, prints and sees their own past runs.{' '}
        <strong>Use</strong> also builds, saves, copies, renames and
        deletes reports of your own and downloads and keeps files. <strong>Manage</strong> also shares
        reports, sees every report in the group, including ones other people haven't shared
        (marked <strong>Not shared</strong> under From your team), and can change or delete them,
        and sees everyone&apos;s past runs.
        To begin with owners and admins have Manage, operators have View and viewers have no
        access. Guests' names, emails and phone numbers only appear in reports that list them,
        and a guest's customer record needs Customers access as well.
      </P>
      <InfoBox>
        A page of reports can&apos;t be kept as a file or scheduled yet. The builder has no undo (leaving without
        saving goes back to the last save), and filters made of several parts, which a few
        starter reports use, can be taken off but not changed on screen. The Till reports page,
        the Online orders report and the Kitchen report stay where they are.
      </InfoBox>
    </section>
  )
}
