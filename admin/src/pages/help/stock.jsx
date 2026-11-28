// src/pages/help/stock.jsx
// The Help page's "Stock" section (inventory phase 4a: the Stock page, stock
// on hand and each item's history, counting by storage area on the office
// and the phone, key-item counts, approval, blind counts, adjustments, the
// count day on Today, Pepper; phase 4b: waste, its reasons and WRAP's kinds,
// till voids marked wasted, transfers between venues, the phone's waste page;
// phase 5: usage from sales, the Usage tab, Recompute, ordering up to par;
// phase 6a: variance by period, food cost actual and theoretical, closing and
// reopening a period, why an item is out, reviewing, the variance band;
// phase 6b: food cost week by week on Cash Recon, the stock and costing
// widgets and the Overview tile, dishes over their cost target on Today,
// Home's set-up gaps, rules on food cost and waste).
// Help.jsx gathers every file in this folder
// (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, InfoBox, DataTable } from './parts.jsx'

export const id = 'stock'
export const label = 'Stock'
export const order = 377

export function Section() {
  return (
    <section id="stock" data-help="">
      <H2>Stock</H2>
      <P>
        <strong>Stock</strong> (main menu, under Stock) shows what you have at each venue and is where you count it.
        Nothing on it is typed in as a stock level: what is on hand is worked out from what happened, the last
        approved count plus every delivery booked in, adjustment, waste and transfer since, less what sales took
        off. Pick the venue at the top; the page has eight tabs: On hand, Usage, Variance, Counts, Waste, Transfers,
        Adjustments and Settings.
      </P>
      <InfoBox type="info">
        Sales are taken off by their recipes. Every few minutes Macaroonie works out what each dish sold on the
        till, the kiosks, online and on another till (Loyverse, Square) used, by the recipe it uses there (the
        takeaway version for a takeaway, the venue&apos;s own where it has one), with its options and a meal
        deal&apos;s picks. So today&apos;s sales are taken off <strong>up to the last run</strong>: the On hand and
        Usage tabs say when that was (<em>up to the last run at 14:05</em>). A dish with no recipe takes nothing off,
        and the Usage tab lists it.
      </InfoBox>
      <H3>On hand and an item&apos;s history</H3>
      <P>
        <strong>On hand</strong> lists every item in use at the venue: what is on hand, what came in since the last
        count (deliveries, adjustments, waste, transfers and what was sold), when it was last counted, which storage areas it is kept in, and <strong>Below par</strong> when it is
        under the venue&apos;s par from its order lists. An item never counted here says <em>Not counted</em>. With
        Costing view you also see what the stock is worth, at what the venue paid for it lately (the average over
        the last 90 days, else the last price paid). Search by name, code or barcode; in the Macaroonie Office app
        the scan button reads a barcode.
      </P>
      <P>
        Tap an item for its <strong>history</strong>: every delivery, approved count, adjustment, waste, transfer and
        day of sales, newest first, each with what it changed and the balance after it. A day&apos;s sales are one line
        (<em>Sales on Fri 27 Nov</em>) with how much went through the till, online and other tills. A count shows what it found against what was expected
        then (for example <em>-2.1 kg on expected</em>). The balance starts at the item&apos;s first count.
      </P>
      <H3>Usage from sales</H3>
      <P>
        The <strong>Usage</strong> tab shows what sales took off at the venue over the days you pick (up to 31; the
        last 7 to start with): each item with how much was used, how much of it went through the till, the kiosks,
        online orders and other tills, and with Costing view what it was worth at what you paid for it. <strong>By
        day</strong> shows each day on its own. Under them, <strong>Sold without a full recipe</strong> lists the
        dishes that took nothing off (or not all they should), with why and how to fix each: no recipe linked, an
        option with no rule, an online order&apos;s option renamed since, a unit with no size, a draft Pepper read
        in that nobody has checked (its items are taken off, but marked), an item with no price (its items are taken
        off, the cost isn&apos;t known). <strong>Left out</strong> lists open items typed in on the till, services,
        which need no recipe, and dishes no longer on any menu whose recipe isn&apos;t known. A dish taken off the
        menus since it sold still takes its recipe off when its day is worked out again (as the menu last had it).
      </P>
      <P>
        What counts: closed till and kiosk checks on the till&apos;s trading day, online orders on their day,
        receipts from another till as the Item mapping maps them (a meal deal from another till is taken off at the
        dishes guests pick most in it), and GloriaFood orders by name only (listed, nothing taken off). Test till
        sales are left out, and so is a void: one marked wasted is in Waste already. A refund on another till gives
        nothing back unless <strong>Refunds on other tills give stock back</strong> is on in Settings.
      </P>
      <P>
        A day is worked out again by itself when its sales change (a till that syncs late, an order cancelled,
        another till&apos;s line mapped), and every open day of the last two weeks is worked out again when a recipe,
        a dish&apos;s link or an option rule is saved. Someone with Stock manage can press <strong>Recompute these
        days</strong> (asked first) to work the days picked out again now, for example after fixing a recipe for an
        older day. A day&apos;s sales are taken off at its last sale, so count before opening or after closing: a
        count in the middle of trading has that whole day&apos;s sales taken off after it.
      </P>
      <H3>Storage areas</H3>
      <P>
        On the <strong>Settings</strong> tab, add the venue&apos;s storage areas (Walk-in, Dry store, Bar) and drag
        them into the order you walk round in. Tap <strong>Items</strong> on an area to put its items in shelf
        order (search to add one, drag to order, the cross to take one off, then Save). An item can be in two areas,
        for example chicken in the walk-in and in the line fridge: you count it in both and the count adds them up.
        Areas only order the count sheet; the stock is the venue&apos;s, so moving a box from one area to another is
        never recorded. An area can&apos;t be deleted while a count being taken has lines in it.
      </P>
      <H3>Counting</H3>
      <P>
        On the <strong>Counts</strong> tab tap <strong>Start counting</strong>. A <strong>full count</strong> covers
        every item at the venue (the ones in its areas and anything counted, delivered or adjusted there before). A
        <strong> key items</strong> count covers a short list you keep on the Settings tab (proteins, cheese, what
        goes missing) and leaves every other item&apos;s figure alone. Only one count can be taken at a venue at a
        time, so everyone counting adds to the same sheet.
      </P>
      <P>
        The sheet goes area by area. Type what is on the shelf for each item, in whatever units it is easiest to
        count in: the item&apos;s standard units (kg or g, l or ml, each), its own units (a tray, a portion) or the
        supplier&apos;s packs (a case of 4 x 2.5 kg). Tap <strong>Another unit</strong> to count one item in
        several, for example 2 cases, 3 trays and 400 g on one line; the total shows underneath. Each line saves
        by itself a moment after you type it (it says <em>Saved</em>), so there is no Save button on a count and
        nothing is lost if the phone goes to sleep. Two people can count two areas of the same count at the same
        time. Tap <strong>Walk-in done</strong> when an area is finished; the tabs show how many of each area&apos;s
        items are counted. Found something that isn&apos;t on the sheet? Search for it: it is counted in the area you
        are in.
      </P>
      <P>
        When everything is counted tap <strong>Submit the count</strong>. It first waits for every line still
        saving (on a slow connection in the walk-in that can take a moment); if a line didn&apos;t save, it says so
        under the line and the count isn&apos;t sent until you put it right. In a full count, any item nobody
        counted is listed: confirm them all as zero, or go back and count them. A count that was started by mistake
        can be cancelled (asked twice). Someone with Stock view can open a count being taken to look, read only.
      </P>
      <P>
        A count can be dated up to 14 days back. If an approved count at the venue is later than it, the sheet
        says so: what that later count counted keeps its figures (on hand starts from each item&apos;s last count),
        so this one only changes items the later one didn&apos;t count.
      </P>
      <H3>Counting on the phone</H3>
      <P>
        On the phone, open <strong>Stock count</strong> on the home screen: it shows the count being taken at your
        venue (or lets you start one), one column, area by area, with the scanner in the Macaroonie Office app to
        find the line. Today&apos;s <em>Stock count due</em> and <em>Stock count to approve</em> cards open it at
        that venue and count; a submitted count shows its review there, with Approve for whoever may.
      </P>
      <H3>Expected against counted, and approval</H3>
      <P>
        A submitted count shows, for each item, what was <strong>expected</strong> at the moment of the count (the
        last approved count, plus deliveries and transfers in since, less waste, transfers out and what sales used by
        their recipes, with adjustments either way), what was <strong>counted</strong> and the
        <strong> difference</strong>, biggest first; with Costing view the value of each difference and the total
        missing, found and net. On hand doesn&apos;t change until the count is <strong>approved</strong>; then the
        counted figures are the new starting point. An approved count is never changed: if it was wrong, count
        again and the newer count replaces it. <strong>Back to counting</strong> sends a submitted count back to be
        corrected.
      </P>
      <DataTable
        head={['Who', 'Can']}
        rows={[
          ['Stock view', 'See on hand, counts, the history and the settings. No values (those need Costing view as well; a delivery\'s value is its supplier\'s price, so it needs purchasing prices too).'],
          ['Stock use', 'Start a count, count, submit it, cancel a count being taken.'],
          ['Stock manage', 'Approve counts, send them back, adjust stock, and set up areas, key-item lists and the settings.'],
        ]}
      />
      <H3>A second person and blind counts</H3>
      <P>
        Two settings on the Settings tab, for the whole group. <strong>A second person approves</strong>: whoever
        approves a count must be someone who neither counted a line of it nor submitted it. On a shared tablet the
        person is whoever switched in with their PIN, not the account the tablet is signed in as, so a manager who
        counted there can&apos;t approve the count from their own login, and another manager can approve it on the
        tablet. <strong>Blind counts</strong>: what is expected stays hidden while counting, on the count sheet and
        on Pepper&apos;s count card, so people count what is really there rather than what the screen says; it shows
        once the count is submitted.
      </P>
      <InfoBox type="info">
        Blind counts hide the count&apos;s expected figure only. The On hand tab, an item&apos;s history and asking
        Pepper how much there is still show today&apos;s figures to anyone with Stock view, also while a count is
        being taken: keep counters on the count sheet.
      </InfoBox>
      <H3>The count day</H3>
      <P>
        On the Settings tab, give each venue a <strong>count day</strong> (say Monday) and whether it is a full or a
        key items count. On that day Home and the phone&apos;s Today show <em>Stock count due</em> until that
        day&apos;s count is submitted: a full count, or for a key items day a count of its list (a full count does
        too). A few items counted on their own, or told to Pepper, don&apos;t count as the day&apos;s count. A
        submitted count shows <em>Stock count to approve</em> to whoever may approve it.
      </P>
      <H3>Ordering up to par</H3>
      <P>
        The same card (<strong>Count day and pars</strong>) says how the venue&apos;s order lists read their pars.
        <strong> Order up to par</strong>: Fill to par and each line&apos;s Par button order the par less what is on hand
        and what is already on order (orders placed and not yet received), in whole packs. <strong>Order the
        par</strong>: the par is ordered as it is. Left on its own it is up to par once the venue has an approved count,
        and the par as it is before. On the order form each line shows on hand, on order and what sales used in the
        last 7 days, and the form says which way its pars read. Up to par needs <strong>Stock view</strong>, since it
        uses what is on hand: for someone without it the order form, and Pepper, order the par as it is, and the form
        says so.
      </P>
      <H3>Adjustments</H3>
      <P>
        The <strong>Adjustments</strong> tab (Stock manage) is for what fits nothing else, such as stock found in
        another venue&apos;s delivery or a correction. Find the item, choose <strong>Take off</strong> or
        <strong> Add</strong>, the quantity in one of its units and a reason (needed), then Save. An adjustment is
        never edited or deleted: <strong>Reverse</strong> adds the same quantity the other way, dated at the
        adjustment it reverses (the list says when it was reversed), so the two cancel out as if neither had been
        made. A count since the adjustment keeps its figure: it counted what was really there. Wasted stock goes on the
        Waste tab, and stock sent to another venue on the Transfers tab, not here.
      </P>
      <H3>Waste</H3>
      <P>
        The <strong>Waste</strong> tab is where you log what was thrown away, and see each day&apos;s waste. Under
        <strong> Log waste</strong> choose what it was: <strong>An item</strong> (a tray of chicken thighs, 6 limes),
        <strong> A prep batch</strong> (half a kilo of curry paste) or <strong>A dish</strong> (2 burgers). Find it by
        name (an item also by code or barcode), say how much in any of its units, tap the reason, and add a note or a
        photo if it helps. Before you save, the form shows what it takes off stock and, with Costing view, what it was
        worth: a batch or a dish is broken into its ingredients by its recipe, so 2 burgers take off 2 patties, 2 buns
        and the sauce in them. A dish taken away or delivered can have a recipe of its own: pick the order type and the
        right recipe is used. Tap <strong>Log waste</strong>. Logging waste needs Stock use.
      </P>
      <InfoBox type="warn">
        When the recipe can&apos;t say what is in something, the line says so: a dish with no recipe linked takes
        nothing off stock, a unit the item has no size for is left out, and a recipe Pepper read in that nobody has
        checked yet is used as it is (<em>not checked yet</em>), so check it on the Recipes page.
      </InfoBox>
      <P>
        The day&apos;s list (pick another day with the date button or the arrows) shows every entry with its reason,
        its kind, who logged it and when, what it took off and its value, and the day&apos;s total by kind. Made a
        mistake? <strong>Undo</strong> takes an entry back on the same trading day (asked twice), for whoever logged
        it or someone with Stock manage; it stays on the list marked <em>Undone</em>. Once the trading day is over,
        someone with Stock manage can <strong>Reverse</strong> it instead: a second entry the other way, dated with the
        first, so a count since keeps its figure (added up, the mistake and its reversal count as nothing). Under the
        list, <strong>The last seven days</strong> adds waste up by reason, kind, item or person. When some of what
        an entry took off has no price paid at the venue yet, its value covers the rest and the line says so. On a
        shared tablet waste is logged, undone and photographed only for the tablet&apos;s own venue.
      </P>
      <H3>Waste reasons and WRAP&apos;s kinds</H3>
      <P>
        Every reason is one of the three kinds WRAP uses for food waste in hospitality: <strong>spoilage</strong> (gone
        off or out of date before it was used), <strong>preparation</strong> (lost in the kitchen: trim, made too much,
        dropped, burnt, a dish made and not served) and <strong>plate</strong> (what guests leave or send back). The
        group starts with nine reasons. On the <strong>Settings</strong> tab (Stock manage) add your own with their
        kind, change one or switch one off (the pencil, then <strong>Save</strong>), or drag them into the order the
        waste form shows them. A reason already used is switched off rather than deleted, so past waste keeps its
        reason.
      </P>
      <H3>Dishes voided on the till as wasted</H3>
      <P>
        When a dish is voided on the till after it was made and marked as wasted, it is waste already: it shows on the
        Waste tab by itself, marked <em>Till void</em> with its check number and the void&apos;s reason, broken into its
        ingredients by its recipe and taken off stock. Don&apos;t log it again, and it can&apos;t be undone here: the
        till keeps its record. A void&apos;s reason counts under your waste reason of the same name (so
        <em> Sent back by a guest</em> is plate waste); any other reason counts as preparation. Test sales made on the
        Test data page are left out. What a void took off is kept within minutes of it: while the till&apos;s day is
        still open it follows the recipe as you put it right, and once the day is closed it never changes, so a dish
        taken off every menu later, or a recipe changed, leaves past waste, on hand and the Waste report as they
        were.
      </P>
      <H3>Transfers between venues</H3>
      <P>
        The <strong>Transfers</strong> tab moves stock from one of your venues to another in two steps. Under
        <strong> Send stock</strong> pick the venue it goes to, add the items with how much of each in any of their
        units, and tap <strong>Send</strong>: it leaves this venue&apos;s stock at once and shows under
        <em> Sent from here, on its way</em>. At the other venue it shows under <em>On its way here</em>, and on
        Home and the phone&apos;s Today as <em>Transfer to receive</em>. Tap <strong>Receive</strong>, say what
        actually arrived of each item (it starts as what was sent) and tap <strong>Receive it</strong>. If less
        arrived, the difference is kept on the transfer as <em>lost in transit</em>: the sending venue lost it, and
        the receiving venue gets only what came. A transfer still on its way can be cancelled at the venue that sent
        it (asked twice): the stock comes back there. Sending, receiving and cancelling need Stock use.
      </P>
      <P>
        A transfer is valued at what the sending venue paid for the stock lately (its average over the last 90 days),
        so both venues see the same pounds (with Costing view); when the sending venue has paid nothing for it yet,
        it has no value at either venue. On a shared tablet a person can only send from, and
        receive at, the tablet&apos;s own venue.
      </P>
      <H3>Waste on the phone</H3>
      <P>
        In the Macaroonie Office app or on the phone, the <strong>Waste</strong> tile opens the same form in one
        column, with <strong>Add a photo</strong> taking a picture with the camera, and today&apos;s waste at the
        venue under it with Undo for what you logged.
      </P>
      <H3>Pepper and reports</H3>
      <P>
        Ask Pepper <em>how much chicken have we got?</em>, <em>what happened to the rice this week?</em> (its
        history with the balance) or tell it a count, <em>2 cases and 3 trays of chicken in the walk-in</em>: the
        card shows each line in your units (and what was on hand before, unless counts are blind), and the count is
        saved when you confirm (approved at once if you may approve counts, else it waits for approval). A count told
        to Pepper is a few items only, never the count day&apos;s count. Pepper can also start a key items count from one of your lists.
        Reports have Stock on hand, Stock moves, Stock counts, Count lines (expected, counted, the difference and
        its value) and Stock adjustments, and the starter <strong>Last count&apos;s differences</strong>. In Stock
        moves a delivery&apos;s value is <strong>Paid</strong>, at its supplier&apos;s price, for people who see
        purchasing prices. A count&apos;s row opens it on the Stock page at its venue.
      </P>
      <P>
        Tell Pepper <em>we dropped a tray of 12 chicken thighs</em> and it logs the waste with the right item and
        reason after you confirm its card (which shows what it takes off); <strong>Undo</strong> on the card takes it
        back for 10 minutes after (after that, undo it on the Waste tab on its trading day, or someone with Stock
        manage reverses it). Ask <em>what did we waste this week?</em> for waste by reason, kind, item or person. Pepper
        can send stock to another venue (<em>send 2 trays of chicken to Leeds</em>) and receive a transfer (<em>the
        rice from Soho came, but 2 limes short</em>), each confirmed first. Reports have <strong>Waste</strong> (each
        item of each entry, till voids marked wasted included) and <strong>Stock transfers</strong> (sent, received,
        lost in transit), with the starters <strong>Waste by reason this week</strong> and <strong>Transfers in
        transit</strong>. A row of the Waste report opens the Waste tab on its trading day with that entry picked
        out.
      </P>
      <P>
        Ask Pepper <em>how much chicken did we sell through yesterday?</em> or <em>why isn&apos;t the soup taking
        anything off stock?</em>: it answers from usage from sales, by day and by till, online and other tills, and
        for a dish with what couldn&apos;t be costed and why. Reports have <strong>Usage from sales</strong> (each item
        each trading day, by channel, with its value with Costing view) and <strong>Dish sales and theoretical
        cost</strong> (units, net sales, theoretical cost, GP and cost % of what really sold), with the starters
        <strong> Theoretical food cost by week</strong> and <strong>Uncosted dishes by sales</strong>.
      </P>

      <H3>Variance: what was used against what sales took</H3>
      <P>
        The <strong>Variance</strong> tab puts a pound figure on the gap between what the counts say was used and
        what the dishes sold should have used. It works by <strong>period</strong>: a period runs from one approved
        full count at the venue to the next, and is made when the later count is approved. Until then the tab shows
        the period running since the last full count, to now.
      </P>
      <DataTable
        head={['Figure', 'What it is']}
        rows={[
          ['Actual usage', 'The opening count, plus what was received and sent here from another venue, less what was sent away (and lost on the way), less the closing count.'],
          ['Theoretical', 'What sales took off by their recipes in the period (the Usage tab). Late sales from a closed period that landed here are marked.'],
          ['Waste', 'Waste logged, and dishes voided on the till as wasted.'],
          ['Variance', 'Actual less theoretical: above zero, more was used than sales explain.'],
          ['Unexplained', 'The variance less waste and adjustments (an adjustment says why, so it explains its part). This is what the counts found against what the documents say.'],
        ]}
      />
      <P>
        Items are listed by pounds of unexplained loss, biggest first, each with its share of the venue&apos;s food
        sales (<em>0.8 pts of food sales</em>), and the ones over the band are marked <strong>Flagged</strong>
        (<strong>Over</strong> when more was found than expected). <strong>Only flagged</strong> narrows the list. At
        the top, <strong>Food cost</strong> shows the actual food cost % (what was used, over net food sales) beside
        the theoretical (what sales took), the gap between them in points, and whether the unexplained loss is over
        the venue band. Net food sales are food and drink, VAT out: retail goods and services are left out.
        Pounds need Costing view; the food cost % and shares of sales need Till reports view as well, in reports
        too (an item&apos;s share of food sales needs both, and whether a period was over the band needs Till
        reports view).
      </P>
      <P>
        In the period running since the last full count, an item has actual usage only once it is counted again: a
        key-item count of the item is enough. The actual food cost % and the gap are shown only when every item
        sales used has actual usage (both sides then cover the same items), so in that period they wait for the next
        full count: the tile says <em>not known yet</em> and how many items aren&apos;t counted; the theoretical food
        cost shows all the time. <strong>Key items</strong> shows what each key-item count found
        against the documents since the count before it, for the last two weeks, so a daily count of proteins gives
        a daily figure. <strong>By venue</strong> shows one item at every venue (<em>which site loses most on
        chicken</em>), at each venue&apos;s latest period or since its last full count.
      </P>
      <H3>Why an item is out</H3>
      <P>
        Tap an item for its figures and <strong>Why it may be</strong>: what the documents say about it in the
        period, each with where to put it right. Dishes sold without a recipe that may use it (by their names),
        deliveries changed after the count, on hand going below zero (a delivery not booked in, or a recipe taking
        too much off), a unit that changed, waste logged, adjustments, transfers not received yet, late sales from a
        closed period, and remakes the kitchen logged (they aren&apos;t taken off as usage yet). <strong>Between its
        counts</strong> shows the item&apos;s figures between each pair of its counts in the period.
      </P>
      <H3>Closing and reopening a period</H3>
      <P>
        Someone with Stock manage closes a period with <strong>Close the period</strong> (asked first). Closing
        freezes its figures, like a Z on the till: they stay as they were, whatever changes later. Its trading days
        are closed too, so usage from sales never works them out again: a sale that reaches a closed day late (a
        till or hub that synced the next morning) counts in the next open period instead, marked <em>late sales in
        it</em>, which makes that period look a little better and the closed one a little worse.
        <strong> Reopen</strong> needs a note saying why; it works the period&apos;s days out again from the sales,
        late ones in them, and its figures follow the documents until it is closed again. A period can&apos;t be
        reopened while a later period at the venue is closed: reopen that one first. While usage from sales is being
        worked out for the venue (every few minutes, for a moment), closing and reopening say so: try again in a
        minute. Changing whether refunds give stock back (Settings) changes open days only: a closed period&apos;s
        days keep the setting they were closed with, so switching it makes no late sales.
      </P>
      <InfoBox type="info">
        A day&apos;s sales count at the day&apos;s last sale. Count before opening or after closing: a count taken in
        the middle of trading has that whole day&apos;s sales after it.
      </InfoBox>
      <H3>Reviewing flagged items</H3>
      <P>
        When a closed period has flagged items nobody has looked at, Today shows <strong>Variance to review</strong>
        to people with Stock manage. Open the item, see why it may be, and tap <strong>Mark as reviewed</strong>
        (with what you found, if you like). Once every flagged item is reviewed it leaves Today.{' '}
        <strong>Not reviewed after all</strong> asks first, as it takes the review and its note away. Without Stock
        manage the tab is view only (it says so): the figures show, but closing, reopening and reviewing don&apos;t.
        <strong> By venue</strong> shows a closed period&apos;s items as they were flagged when it was closed.
      </P>
      <H3>The variance band</H3>
      <P>
        Settings has the <strong>Variance band</strong> (Stock manage): a venue is over the band when its
        unexplained loss in a period is more than a number of points of its net food sales (1 by default), and an
        item is flagged when its unexplained loss, or gain, is over a share of what sales took (3%) and over a sum in
        pounds (£50).
      </P>
      <P>
        Ask Pepper <em>what was our food cost last week against theoretical?</em> or <em>where are we losing
        stock?</em> for a period&apos;s food cost and its flagged items, and <em>why are we short on chicken?</em> for
        one item&apos;s figures and evidence. Closing and reopening are done on the Variance tab. Reports have
        <strong> Stock variance by period</strong>, <strong>Food cost by period</strong> and <strong>Stock
        periods</strong>, with the starters <strong>Variance by item</strong> and <strong>Theoretical against
        actual food cost by week</strong>. A period whose counts left out an item sales used has no actual food
        cost there either, and the actual food cost % over several periods counts only the sales of the periods
        that have one.
      </P>
      <H3>Food cost week by week</H3>
      <P>
        Cash Recon&apos;s week has a <strong>Food cost</strong> card, below the grid and under the wages in the card view
        (for people with Costing view and Till reports view). <strong>Theoretical, this week</strong> is what the week&apos;s sales should have used
        by their recipes, as a share of its net food sales; dishes sold without a full recipe make it read low, and so
        do open items and dishes no longer on a menu (their sales count, with nothing to cost them by): the card says
        how many of each. <strong>Actual</strong> needs a full count at both ends, and a week rarely starts and
        ends on a count, so the week never gets an actual of its own: the card shows the actual of the stock period
        that covers the whole week (and says it is the period&apos;s figure, not the week&apos;s), else the latest
        closed period, named with its dates. With neither, it says actual needs a full count at both ends.
      </P>
      <H3>On dashboards and the Overview</H3>
      <P>
        <strong>Add widget</strong> on any dashboard has a <strong>Stock and costing</strong> group:
      </P>
      <DataTable
        head={['Widget', 'Shows', 'Needs']}
        rows={[
          ['Food cost % actual and theoretical', 'The week\'s food cost card, and the latest closed periods\' actual against theoretical', 'Costing view and Till reports view'],
          ['Waste this week by reason', 'The dashboard week\'s waste by reason, till voids included', 'Stock view (values with Costing view)'],
          ['Top variance items', 'The newest stock period\'s flagged items and biggest unexplained losses', 'Stock view (pounds with Costing view)'],
          ['Margin by menu', 'What sold in the week by menu: net sales, gross profit and cost % at what was paid', 'Costing view (sales with Till reports view)'],
        ]}
      />
      <P>
        The Overview has a <strong>Stock</strong> tile (Customise layout, Add tile): each venue in a line with what
        waits (counts to approve, transfers to receive, flagged items to review), when it was last fully counted and,
        with Costing view and Till reports view, this week&apos;s theoretical food cost and the latest actual.
      </P>
      <H3>Dishes over their cost target, and set-up gaps</H3>
      <P>
        Today shows <strong>Dishes over the cost target</strong> to people with Costing view when dishes on a
        venue&apos;s live menus cost more than the target on Menu margins (at today&apos;s supplier prices, at the order
        type where each is worst): the dearest first, and how many are over the limit. It opens Menu margins at the
        venue. Home suggests the set-up still missing to whoever manages it: no storage areas at a venue (Stock, opening
        Stock&apos;s Settings), best sellers with no recipe (Recipes, opening the Recipes page on what isn&apos;t costed),
        and inventory items used in recipes with no supplier price (Purchasing setup, opening Inventory). An item counts
        as having no price when it has no supplier price that is switched on from a supplier that is switched on, and
        no delivery booked in: the same test Menu margins costs by.
      </P>
      <H3>Rules on food cost and waste</H3>
      <P>
        Rules (Settings, Rules, or say it to Pepper) can start from three more things: <em>When a dish goes over 35%,
        tell the owner</em>; <em>When a stock period closes over the band, add an H&amp;S action for the manager</em>;
        <em> When waste over £50 is logged, tell the owner</em>. A dish going over its target is looked for every hour,
        and at once when a supplier price changes in the app (Price creep and cost alerts), and tells once: it tells again only after the dish has come back under and gone over again (or from over the
        target to over the limit). A rule with a percentage of its own (<em>over 35%</em>) tells once as the dish passes
        that figure, whether that is the step that takes it over the target or a price rise after it, and not again
        while it stays above. A period tells when it is closed with its unexplained loss over the venue&apos;s band
        or with flagged items. Costs and shares of sales are left out of a notice for people who can&apos;t see them, and
        can&apos;t go into an H&amp;S action at all (everyone who reads the action log would see them). Making a rule on a
        dish&apos;s cost needs Costing view; on waste, Stock view (and Costing view to use an amount); on a period, Stock
        view (and Costing view and Till reports view to use an amount, or to put the unexplained loss in its text: the
        points over the band are a share of sales).
      </P>
      <H3>Forecasts and suggested orders</H3>
      <P>
        Macaroonie forecasts what each item will use from what sales took. For a day, it takes what sales used on the
        same weekday over the last four weeks (Tuesdays use 6.2 kg), and scales it by the covers booked for that day
        against what was usually booked as far ahead for that weekday (<em>18% more covers booked</em>). Only the weeks
        the venue was already taking bookings count, so a venue two weeks into bookings is compared with those two weeks.
        A venue that takes few bookings isn&apos;t scaled, nor one taking bookings for less than a week, and the scaling is
        held between half and twice the usual. A weekday with no
        sales worked out yet uses an average day. Today counts only what is left after what sales took so far.
      </P>
      <P>
        <strong>Suggest</strong> on the order form (Purchasing, see Purchasing in this guide) uses it: for each line from
        a supplier, the forecast until the <em>delivery after next</em> (the order arrives on the supplier&apos;s next
        delivery and has to last until the one after), plus the <strong>buffer</strong>, less what is on hand and
        what is already on order to arrive before then, in whole packs up to the supplier&apos;s minimum. An item sales
        never used in the four weeks (cleaning stock, an item with no recipe) is filled up to its par instead; with no
        par either it isn&apos;t suggested.
      </P>
      <DataTable
        head={['Where', 'What']}
        rows={[
          ['Stock, Settings, Suggested orders', 'The buffer: a share of the forecast added on top (10% unless you change it). Stock manage.'],
          ['Reports, Suggested orders', 'Every suggestion beside what was ordered and, once its days have passed, what was really used against the forecast. The starter How good are the suggested orders sums it up by item (add the supplier as a column with Purchasing view). Stock view shows the suggestions and the forecast; what the restaurant order did with them (its supplier, what was ordered, placed or not, who and when) needs Purchasing view as well, as on Restaurant orders.'],
          ['Pepper', 'Ask "what should we order from Brakes?": suggested_order gives each item\'s packs and why. It orders nothing; ask it to fill the order with those quantities, then check and place it.'],
        ]}
      />
      <InfoBox type="info">
        The forecast reads usage from sales, so it is as good as the recipes: a dish with no recipe uses nothing, and
        its items look quieter than they are. Weather and local events don&apos;t count yet.
      </InfoBox>
    </section>
  )
}
