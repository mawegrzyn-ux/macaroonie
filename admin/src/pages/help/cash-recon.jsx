// src/pages/help/cash-recon.jsx
// The Help page's "Cash Reconciliation" section. Help.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, InfoBox, DataTable } from './parts.jsx'

export const id = 'cash-recon'
export const label = 'Cash Reconciliation'
export const order = 160

// ── CASH RECONCILIATION ────────────────────────────
export function Section() {
  return (
    <section id="cash-recon" data-help="">
      <H2>Cash Reconciliation</H2>
      <P>
        The <strong>Cash recon</strong> page (sidebar nav) is your daily till declaration
        and weekly reconciliation — income, service charges &amp; tips, takings, petty
        cash expenses, and staff wages, all per venue.
      </P>
      <H3>Daily declaration</H3>
      <P>
        Open any day to declare it. Each section (<strong>Income</strong>,{' '}
        <strong>Service Charges &amp; Tips</strong>, <strong>Takings</strong>) is a card
        with a coloured header band using your website's brand accent colour, so the
        sections stay visually distinct as you scroll a long page of figures — a plain
        footer band below each section's figures shows its running total. Every figure
        autosaves as you type; there's no separate Save button.
      </P>
      <H3>Petty cash expenses</H3>
      <P>
        Log any petty cash spend under the day's <strong>Expenses</strong> section — a
        description, an optional category, and the <strong>gross amount</strong> (what
        actually left the till). Add a <strong>VAT amount</strong> too if you want it on
        record — it's stored alongside the expense but never added to or taken off any
        total; the gross amount already covers it everywhere reconciliation figures are
        calculated. Attach a photo of the receipt with your camera or from your library.
        The same form is available on your phone under <strong>/mobile → Expenses</strong>.
      </P>
      <P>
        With Pepper switched on, <strong>Photograph the receipt</strong> at the top of the form fills it in
        for you: Pepper reads the shop and what was bought, the total paid, the VAT (only when the receipt
        prints it), whether it was paid by card, and picks the venue's category that fits. The photo becomes
        the expense's receipt. Check the figures and save as usual. If the receipt has another date, the
        form says so; on the phone a new expense can go on that day instead.
      </P>
      <P>
        If an expense was paid with a card rather than cash from the till, tick{' '}
        <strong>Paid by card</strong> on the expense. It's still recorded, with its receipt
        and VAT, and shows a small <strong>Card</strong> tag in the list. But it's left out
        of Total Expenses and the variance, because that money never came out of
        the till. The day summary and the week grid list card-paid expenses separately as
        "Paid by card (not in recon)" so you can still see what was spent.
      </P>
      <P>
        Once a day is submitted its expenses are locked like the rest of its figures: they
        can&apos;t be added, changed or deleted (on the page, the phone or by Pepper) until an
        owner or admin unsubmits the day. A receipt photo can still be attached.
      </P>
      <H3>Week view / spreadsheet view</H3>
      <P>
        Toggle between a card-based week overview and a dense <strong>spreadsheet
        view</strong> (table icon) showing every day of the week as columns with income,
        service charges, takings, and what was paid out of the till (cash expenses and cash
        wages) as rows, ending in a single <strong>Variance</strong> row — useful for spotting
        a day that doesn't balance at a glance.
      </P>
      <P>
        Below the grid (and under the wages in the card view) the week has a <strong>Food cost</strong> card (Costing
        view and Till reports view):
        the week&apos;s theoretical food cost % from what sold, and the actual from a stock period, the one that
        covers the week, else the latest closed one, named. A week has no actual of its own: see Stock, Food cost
        week by week.
      </P>
      <H3>How the variance works</H3>
      <P>
        Before the cash is counted, staff pay the day's expenses and the cash wages out of the
        till, so the cash they count is exactly what goes to the bank. The variance adds
        those payouts back: <strong>Takings + cash expenses + cash wages paid that day −
        Income</strong>, adjusted for service charges. Zero means balanced, a minus figure is a
        shortfall (red) and a plus figure is a surplus (amber).
      </P>
      <P>
        Each day's variance includes that day's cash expenses and the cash wages whose{' '}
        <strong>Paid on</strong> day is that day (set it on the Wages page, see below). A cash
        wage with no Paid on day is only added to the <strong>week's</strong> variance, so the
        day its cash came out would show short. The week grid shows wages per day in the
        "Paid out of till" section, with any amount that has no day flagged under the week
        total. Expenses paid by card never came out of the till, so they are not added back.
      </P>
      <H3>Wages</H3>
      <P>
        Open a week's <strong>Wages</strong> card to log staff pay. The Wages page, the Cash
        Dashboard's Wages paid and Week staff list widgets, and the phone Wages page all show the
        same list: <strong>Name</strong>, <strong>Total</strong> (what they're owed for the week),{' '}
        <strong>Bank</strong> (the part paid by bank transfer), <strong>Paid</strong> (the cash handed
        over from the till), <strong>Paid on</strong> and <strong>Notes</strong>. Bank fills in from the
        person's Paid by setting on the Staff page when a total is entered, and can be changed. Tap{' '}
        <strong>Full</strong> to pay someone the cash part (total less bank), or{' '}
        <strong>Pay everyone in full</strong>. Nothing is written until you tap{' '}
        <strong>Save</strong>; <strong>Discard changes</strong> throws your edits away.
      </P>
      <P>
        Wages are not submitted any more (the days are), so the list is never locked. The
        totals under the list show Total, Bank transfer, Paid (cash) and Cash left to pay. Only
        cash counts in the day's balance; bank transfers never come out of the till.
      </P>
      <P>
        <strong>Paid on</strong> is the day the cash came out of the till. It fills in today (or
        the day selected on the dashboard) when you enter a payment; change it per person, or
        use <strong>Paid on for all</strong>.
      </P>
      <P>
        <strong>Not paid in full.</strong> If someone is paid part of their cash in hand, the row
        shows what's left, and the Rota adds it to their pay next week as{' '}
        <strong>Owed from last week</strong>. A row with nothing paid in cash isn't carried (it
        may have gone by bank transfer, or not be paid yet).
      </P>
      <DataTable
        head={['Control', 'What it does']}
        rows={[
          ['Set as default', 'Saves the current week\'s staff list (who\'s included) as this venue\'s default. Any future week you open that has no saved wages yet auto-populates from this list instead of your full staff roster.'],
          ['Copy from', 'Replaces the list with the names and totals from one of the last 8 weeks (nothing marked paid). Save to keep it.'],
          ['Cash-only net balance', 'The net cash position (in the daily/weekly totals) subtracts only the cash-paid portion of wages, not the full wage cost — a wage paid by bank transfer no longer drags down your cash figure.'],
          ['Imbalance flag', 'An amber warning icon appears wherever a week\'s wages are shown whenever Total wages doesn\'t match Cash paid, so a data-entry slip doesn\'t go unnoticed.'],
        ]}
      />
      <InfoBox type="tip">
        "Set as default" replaces the old "Load template" button, which pulled from your
        full active-staff list every time. Ad-hoc entries (a name typed in without picking
        an existing staff member) aren't included in the default — only staff you've added
        in Settings have a stable identity to carry over week to week.
      </InfoBox>
      <H3>Settings</H3>
      <P>
        The gear icon manages your income sources, payment channels, service charge
        sources and expense categories, all drag-reorderable, and the venue's Loyverse link
        (see Fill from Loyverse below). The staff list has moved to its
        own <strong>Staff</strong> page in the sidebar (see Staff &amp; Rota).
      </P>
      <H3>Fields filled by other systems</H3>
      <P>
        On the <strong>Income Sources</strong>, <strong>Payment Channels</strong> and{' '}
        <strong>Service Charges</strong> tabs, a field another system fills says so under its
        name, for example <em>Filled by Tills and kiosks: All sales − Refunds</em> or{' '}
        <em>Filled by GloriaFood: Payment: Paid online</em>. A field can be filled by more
        than one. Fields with no such line are typed in on the day.
      </P>
      <P>
        The <strong>Filled from other systems</strong> box at the top of each tab lists those
        systems; tap one to change what it fills: tills and kiosks open{' '}
        <strong>Store tech → Cash Recon link</strong>, Loyverse and GloriaFood open their own
        tabs here. Online orders don't fill Cash Recon yet, so they don't show.
      </P>
      <H3>Staff list — Fixed or Hourly</H3>
      <P>
        Each person on the Staff page has a <strong>pay type</strong>. Hourly staff are paid hours
        times rate, so their default rate is per hour. Fixed staff are paid a set amount per week,
        per day worked, or per shift. The list shows each person's type and rate (for example
        "Hourly, £12.50/hr" or "Fixed, £80.00/day").
      </P>
      <P>
        The pay type is used whenever that person is added to a week: a new week filled from
        your staff list, or someone added on the Wages page or the Week staff list widget, starts
        with their weekly amount if they're Fixed per week, and blank otherwise (hourly, per-day
        and per-shift pay depends on the rota). The quickest way to fill a week from the rota is
        the <strong>Fill Cash Recon wages</strong> button on the Rota page. Typing a Total on the
        Wages list sets that week's amount directly.
      </P>
      <H3>Service charge sources — Takings/Income effect</H3>
      <P>
        Each service charge or tips source has two independent settings — <strong>Effect on
        Takings</strong> and <strong>Effect on Income</strong> — each set to <strong>No
        effect</strong>, <strong>Add</strong>, or <strong>Deduct</strong>. Together they
        control how that source adjusts the day's reconciliation variance (the figure
        comparing what you'd expect in the till against what was actually counted):
      </P>
      <DataTable
        head={['Scenario', 'Set it to']}
        rows={[
          ['The SC amount lands in the till (counted in Takings) but isn\'t part of your declared Income total.', 'Takings: Add. Income: No effect.'],
          ['The SC amount is already counted in Income, but never physically reaches the till (paid out separately, or card-only).', 'Takings: No effect. Income: Deduct.'],
          ['The SC is counted in both Income and the till — no imbalance to correct for.', 'Takings: No effect. Income: No effect (or Add + Deduct, which also nets to zero).'],
          ['A source that needs the opposite of the usual direction — e.g. an amount refunded out of the till separately, so it should reduce the expected till figure instead of adding to it.', 'Takings: Deduct.'],
        ]}
      />
      <InfoBox type="tip">
        If you're not sure, leave both at <strong>No effect</strong> — the source still shows
        up in the Service Charges &amp; Tips section and its own total, it just won't be
        factored into the Variance line. You can always come back and set the effects once
        you've worked out how that particular charge flows through your till.
      </InfoBox>
      <H3>Submitting once a week</H3>
      <P>
        In <strong>Settings → General → How days are submitted</strong> (owners and admins) a venue can
        choose <strong>Once a week</strong> instead of <strong>Each day</strong>. Days are then filled in
        and saved as you go, and the whole week is submitted in one go with <strong>Submit week</strong> on
        the week (the grid or the cards) or the phone&apos;s Cash Up list; a day can&apos;t be submitted on
        its own. Submit week takes every day up to today that has figures (and, with Allow bulk week
        submission on, the open days with none). Home counts a day with figures as done and,
        from the Monday, asks for last week to be submitted (late from the Tuesday). Owners and admins can
        <strong> Unsubmit week</strong>. Pepper can submit a week too (&ldquo;submit last week&rsquo;s cash-up&rdquo;).
      </P>
      <H3>Retrieve from your till systems</H3>
      <P>
        When a venue is linked to Loyverse, GloriaFood or both, a day and a week show one{' '}
        <strong>Retrieve</strong> button for all of them. It opens each system&apos;s fill window in turn
        (see below). In <strong>Settings → General → Retrieve from till systems</strong> you can choose{' '}
        <strong>Fill straight away, without the preview</strong>: Retrieve then fills at once and says what
        it did, leaving out submitted days and, over a week, days with no sales and days still to come.
      </P>
      <P>
        The <strong>Scheduled fill</strong> (same card) fills the day just ended and the two days before it
        every morning at the time you set (venue time), from every linked system. It never touches a
        submitted day, and it leaves alone any figure someone changed by hand since the last fill: the
        card below the switch says when it last ran and what it filled, skipped or kept.
      </P>
      <H3>Fill from Loyverse</H3>
      <P>
        If the venue sells through a <strong>Loyverse</strong> till, Cash Recon can fill a day's
        income, service charges and takings from Loyverse instead of you typing them in. The Loyverse
        account and the venue's store are set up on the <strong>Integrations</strong> page (see
        Integrations); the mapping is set once per venue in Cash Recon settings (gear icon) &gt;{' '}
        <strong>Loyverse</strong> (owners and admins):
      </P>
      <DataTable
        head={['Step', 'What to do']}
        rows={[
          ['1. Connect the account', 'On the Integrations page (Money > Integrations) tap Connect a till and paste a Loyverse access token (Loyverse Back Office > Integrations > Access tokens). It is checked with Loyverse before it is saved, stored encrypted and never shown again.'],
          ['2. Link the store', 'On the same page tap Link a venue: choose the venue, its Loyverse store and when its trading day starts (sales before that time count on the day before; e.g. 04:00 if you trade past midnight).'],
          ['3. Open the Loyverse tab', 'Back in Cash Recon settings > Loyverse, the venue shows its store and day start, with a link to change them on Integrations.'],
          ['4. Map the lines', 'Each income source, service charge source and payment channel gets a list of Loyverse figures. Tap Add, choose Add (+) or Subtract (-), then a figure. The line is filled with the sum. Tap + or - on a figure to flip it, or x to remove it. Lines with nothing mapped are never changed.'],
          ['5. Save', 'Nothing is kept until you tap Save. Match payment types by name maps each payment channel to the Loyverse payment type with the same name in one go.'],
        ]}
      />
      <DataTable
        head={['Figure', 'What it is']}
        rows={[
          ['Gross sales', 'Every item sold, before discounts and refunds (as in the Loyverse sales summary).'],
          ['Net sales', 'Gross sales less refunds and discounts.'],
          ['Refunds / Discounts / Taxes', 'What was refunded, discounted or charged in tax that day (refunded discounts and tax are taken off).'],
          ['Tips / Surcharges', 'Tips and surcharges added at payment, less any refunded.'],
          ['Total collected', 'Money taken by every payment type, less money refunded.'],
          ['Item', 'One item, e.g. a Gratuity item rung up on the bill: its sales after discounts, less refunds of it.'],
          ['Category', 'Every item in a Loyverse category, after discounts, less refunds.'],
          ['Payment type', 'Money taken by one payment type (Cash, Card, Deliveroo...), less money refunded to it.'],
        ]}
      />
      <P>
        A typical setup: income <em>Loyverse sales</em> = Gross sales minus the Gratuity item;
        service charge <em>Gratuity</em> = the Gratuity item plus Tips; each takings channel = its
        payment type.
      </P>
      <P>
        Then tap <strong>Retrieve</strong> on a day (top of the day) or a week (top of
        the week grid or week cards), or use the <strong>Import from Loyverse / GloriaFood</strong>{' '}
        widget on a dashboard (see Cash Dashboard). A window shows each mapped line with the Loyverse figure and
        what Cash Recon has now ("same now", "empty now" or the current amount), plus the
        day's receipts, gross sales and any payment types Loyverse took money on that are not
        mapped to a channel. Tick the days to fill and tap <strong>Fill</strong>. Only mapped lines
        are written, their notes stay, and <strong>submitted days are never changed</strong>
        (unsubmit first). You can fill the same day again after late sales; it just rewrites the
        mapped lines. A day where refunds were bigger than sales can show a minus figure.
      </P>
      <P>
        The figures come from the Loyverse receipts Macaroonie has already stored (the Integrations
        page keeps them in step with Loyverse), not from Loyverse at the moment you fill, so the
        window opens quickly and shows the same figures as reports. The top of the window says how
        far the sync has reached. A day nothing has come in for yet shows <strong>Not synced
        yet</strong> instead of zeros and can&apos;t be ticked: tap <strong>Sync now</strong>, wait a
        minute, then <strong>Read again</strong>. A receipt that reaches Loyverse late (a till that
        was offline) is picked up by the next sync; fill the day again to take it in.
      </P>
      <InfoBox type="tip">
        If Loyverse stops accepting the token (it was deleted or the account changed), syncing
        stops and the Integrations page shows the error. Make a new token in Loyverse and use{' '}
        <strong>Replace token</strong>.
      </InfoBox>
      <H3>Fill from GloriaFood</H3>
      <P>
        If guests order through <strong>GloriaFood</strong>, Cash Recon can fill a day&apos;s income,
        service charges and takings from the venue&apos;s accepted GloriaFood orders, including how
        they were paid. GloriaFood only hands orders over as it accepts them (it has no history to
        read back), so orders count from the day you link the venue onwards; for earlier days, import
        GloriaFood&apos;s order export (see Import past GloriaFood orders below). Set it up once per
        venue in Cash Recon settings (gear icon) &gt; <strong>GloriaFood</strong> (owners and admins):
      </P>
      <DataTable
        head={['Step', 'What to do']}
        rows={[
          ['1. Choose how orders arrive', '"GloriaFood sends them" (recommended): tap Link this venue, copy the address shown, then in the GloriaFood admin panel for that restaurant open Others > 3rd party integrations, add Push Accepted Order, paste the address as the endpoint and choose JSON. Or "Collect them every minute": add Poll Accepted Order v2 in GloriaFood, copy its key, paste it here and save. The key is checked with GloriaFood, stored encrypted and never shown again.'],
          ['2. Check it works', 'Place or accept a test order in GloriaFood. It shows under Latest orders received within a minute (test orders from GloriaFood\'s menu preview are marked and never counted). The first order also sets which GloriaFood restaurant this venue takes orders from; orders from any other restaurant are refused and the reason shows in red.'],
          ['3. Pick the day rule', 'An order counts on the day it is collected or delivered (or, if you prefer, the day it was accepted). Orders before the trading day start count on the day before.'],
          ['4. Map the lines', 'Same as Loyverse: each income source, service charge source and payment channel gets a list of GloriaFood figures, added or subtracted. Lines with nothing mapped are never changed.'],
          ['5. Save', 'Nothing is kept until you tap Save.'],
        ]}
      />
      <DataTable
        head={['Figure', 'What it is']}
        rows={[
          ['Order totals', 'What customers paid: food after discounts, tax, tips, delivery and service fees.'],
          ['Totals excluding tax', 'Order totals less the tax on them.'],
          ['Food subtotal / Items before discounts / Discounts', 'The dishes after discounts, at full price, and the promotions and coupons taken off.'],
          ['Delivery fees / Tips / Service fees / Tax', 'Each part of the orders on its own.'],
          ['Payment', 'Order totals paid one way: Paid online, Cash, Card at the counter, Card by phone. An order paid two ways counts under its main payment (the fill window says how many).'],
          ['Order type', 'Order totals of pickup, delivery, dine in, order ahead or table reservation orders.'],
        ]}
      />
      <P>
        A typical setup: income <em>GloriaFood sales</em> = Order totals minus Tips; service charge
        <em> Tips</em> = Tips; a <em>GloriaFood online</em> takings channel = Payment: Paid online.
        Then tap <strong>Retrieve</strong> on a day or a week. The window works like the
        Loyverse one, and also lists payments that aren&apos;t mapped, cancelled orders and test orders
        (left out). Only accepted orders count; an order cancelled in GloriaFood later drops out the
        next time you fill.
      </P>
      <InfoBox type="tip">
        Guest names, phone numbers and addresses from GloriaFood are only kept for 30 days (the board
        needs them); the order amounts stay for your records.
      </InfoBox>
      <H3>See a day&apos;s GloriaFood orders</H3>
      <P>
        On a day, tap <strong>GloriaFood orders</strong> (next to Fill from GloriaFood; it also shows
        after the day is submitted, and to people who can only view Cash Recon). The window lists every
        GloriaFood order on that trading day, the same way a fill counts them (your day rule and trading
        day start), with the orders counted, order totals, tips and the total by payment method at the
        top. Tap an order for its times, subtotal, delivery fee, service fees, tip, tax and how it was
        paid; orders GloriaFood sent directly also list their dishes. Cancelled, rejected and test orders
        are listed but crossed out, because they don&apos;t count. Imported orders carry an
        <strong> Imported</strong> label and say which file and line they came from. Use the arrows to
        step to the day before or after. Customer names and phone numbers aren&apos;t shown here.
      </P>
      <H3>Import past GloriaFood orders</H3>
      <P>
        For days before the venue was linked, export the order list (CSV, or the same saved as Excel)
        from the GloriaFood admin panel for that restaurant and import it in Cash Recon settings &gt;
        <strong> GloriaFood</strong> &gt; <strong>Import past orders</strong> (owners and admins; link the
        venue first). Choose the file and the window shows what it found before anything is saved: how
        many orders to add, the dates, the accepted total by payment, rows it can&apos;t use (with the
        row number), and any figure your mapping uses that the file doesn&apos;t have. Tap
        <strong> Import</strong> to save them; Fill from GloriaFood then works for those days like any
        other. <strong>Template</strong> downloads an empty file with every column the import reads.
      </P>
      <DataTable
        head={['Column', 'Needed?', 'Used for']}
        rows={[
          ['Order ID', 'Must have', 'Matching: importing the same file again updates those orders instead of adding them twice.'],
          ['Outcome', 'Must have', 'Only accepted orders count; canceled, rejected and timed out ones are kept but left out.'],
          ['Total', 'Must have', 'Order totals and the payment and order type figures.'],
          ['Fulfillment date + Fulfillment time', 'Must have (or Confirmed date + Confirmed time)', 'Which day the order counts on. Confirmed date and time are used for the accepted-time day rule, and when an order has no fulfilment time.'],
          ['Payment method', 'Worth including', 'Payment figures (CASH, ONLINE, CARD...). Without it, fields mapped to a payment show £0 for imported days.'],
          ['Type', 'Worth including', 'Order type figures (pickup, delivery...).'],
          ['Channel, Subtotal, Total taxes, Tip amount - gross, Delivery fee, Service fees on subtotal, Service fees on total, Cash discounts, Currency, Card type', 'Optional', 'The matching figures. Left out, they count as £0.'],
        ]}
      />
      <InfoBox type="tip">
        The export has no dishes or discounts, so Items before discounts and Discounts are £0 for
        imported days: if your mapping uses them, map that line to Order totals or Food subtotal before
        filling past days (the import window warns you). Guest names, emails, phone numbers, addresses
        and comments in the file are never read or stored. Column order doesn&apos;t matter, and
        columns are found by their heading.
      </InfoBox>
      <InfoBox type="warn">
        Orders GloriaFood sent directly are never changed by an import, and rows from the time they
        started arriving onwards are left out, so nothing counts twice. If you open and save the file in
        Excel, check the order numbers: Excel can shorten them (for example 1.25E+09), and the import
        refuses those rows.
        A payment method the export spells its own way (for example a card option you named in
        GloriaFood) shows under that name when mapping. <strong>Remove imported orders</strong> takes
        them all out again; days already filled keep their figures until you fill them again.
      </InfoBox>
      <P>
        To look through imported orders one by one, open a day and tap <strong>GloriaFood orders</strong>.
        With <strong>Show GloriaFood orders on the Online orders board</strong> switched on, they also
        show on the board&apos;s past days (never on today&apos;s).
      </P>
    </section>
  )
}
