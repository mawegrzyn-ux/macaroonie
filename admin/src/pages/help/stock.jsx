// src/pages/help/stock.jsx
// The Help page's "Stock" section (inventory phase 4a: the Stock page, stock
// on hand and each item's history, counting by storage area on the office
// and the phone, key-item counts, approval, blind counts, adjustments, the
// count day on Today, Pepper). Help.jsx gathers every file in this folder
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
        approved count plus every delivery booked in and every adjustment since. Pick the venue at the top; the
        page has four tabs: On hand, Counts, Adjustments and Settings.
      </P>
      <InfoBox type="warn">
        Sales aren&apos;t taken off yet. Until dishes sold take their ingredients off (a later step), on hand goes
        up with deliveries and only comes down when you count, so an item used in dishes looks higher than it is
        between counts, and shows as short when you count it.
      </InfoBox>
      <H3>On hand and an item&apos;s history</H3>
      <P>
        <strong>On hand</strong> lists every item in use at the venue: what is on hand, what came in since the last
        count, when it was last counted, which storage areas it is kept in, and <strong>Below par</strong> when it is
        under the venue&apos;s par from its order lists. An item never counted here says <em>Not counted</em>. With
        Costing view you also see what the stock is worth, at what the venue paid for it lately (the average over
        the last 90 days, else the last price paid). Search by name, code or barcode; in the Macaroonie Office app
        the scan button reads a barcode.
      </P>
      <P>
        Tap an item for its <strong>history</strong>: every delivery, approved count and adjustment, newest first,
        each with what it changed and the balance after it. A count shows what it found against what was expected
        then (for example <em>-2.1 kg on expected</em>). The balance starts at the item&apos;s first count.
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
        last approved count plus what came in and was adjusted since), what was <strong>counted</strong> and the
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
      <H3>Adjustments</H3>
      <P>
        The <strong>Adjustments</strong> tab (Stock manage) is for what fits nothing else, such as stock found in
        another venue&apos;s delivery or a correction. Find the item, choose <strong>Take off</strong> or
        <strong> Add</strong>, the quantity in one of its units and a reason (needed), then Save. An adjustment is
        never edited or deleted: <strong>Reverse</strong> adds the same quantity the other way, dated at the
        adjustment it reverses (the list says when it was reversed), so the two cancel out as if neither had been
        made. A count since the adjustment keeps its figure: it counted what was really there. Wasted stock gets its
        own page in the next step.
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
    </section>
  )
}
