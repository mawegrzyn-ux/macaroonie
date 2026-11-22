// src/pages/help/online-orders.jsx
// The Help page's "Online Orders" section. Help.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, Mono, InfoBox, DataTable } from './parts.jsx'

export const id = 'online-orders'
export const label = 'Online Orders'
export const order = 340

// ── ONLINE ORDERS ───────────────────────────────
export function Section() {
  return (
    <section id="online-orders" data-help="">
      <H2>Online Orders</H2>
      <P>
        Guests can order food for collection on your website and pay online or when they
        collect. Orders arrive on the <strong>Online orders</strong> page (Service in the
        sidebar), and on a phone at <strong>/mobile → Online orders</strong>.
      </P>
      <H3>Setting it up</H3>
      <P>
        Open <strong>Online orders → Setup</strong> (or Ordering setup in the sidebar) and pick
        the venue. Nothing changes on your website until you tick{' '}
        <strong>Take online orders for collection</strong> and press Save.
      </P>
      <P>
        This is not the <strong>Online ordering</strong> section of the Website builder. That
        section only lists links to outside services such as GloriaFood. To send guests to your
        own ordering page, link a button to <strong>/order</strong>.
      </P>
      <P>
        Your ordering page is in <strong>Page builder → Pages &amp; modals → Order online</strong>.
        Add a hero, opening times or any other blocks around the Online ordering block to make
        it your own. On a phone the category tabs scroll sideways and a basket bar sits at the
        bottom of the screen.
      </P>
      <P>
        Select the Online ordering block in the page builder to change how it looks and works:
      </P>
      <DataTable
        head={['Setting', 'What it does']}
        rows={[
          ['Title and text under it', "Replace the venue name and the \"Order for collection\" line, or hide either. Type {venue} or {address} to fill in the venue's name or address."],
          ['Show the basket', "Beside the menu (the usual; on phones it is a pop-up), or Pop-up only: a basket button floats at the bottom on every screen and the menu uses the full width."],
          ['Keep the basket in view', "The basket beside the menu stays on screen as guests scroll. A long basket scrolls inside itself."],
          ['Basket colours', "A background and text colour from your theme. Pick a text colour when the background is dark; the basket's buttons then use it too."],
          ['Show VAT under the total', "Adds \"Includes VAT £x\" in the basket and at checkout."],
          ['Keep the category bar in view', "The menu and category tabs (and search) stay at the top while scrolling, in a rounded, lightly outlined bar, and the category being looked at is highlighted."],
          ['Space for a sticky site header', "Leave at 0 and the bar and basket sit just below your site header automatically, however tall it is. Enter a height in pixels only to override that."],
          ['Search box', "Guests search dishes by name or description across all menus. Show it as a full-width box, or as a round magnifier icon at the start of the category bar (on phones only, or everywhere) to save space. The icon stays put while the categories scroll under it; tapping it opens the search box, and the cross closes it."],
          ['Highlight house favourites', "Dishes ticked as House favourite on the Menus page get a badge (your wording) and a coloured edge, plus a background and text colour from your theme if you pick them."],
          ['Let guests add a note to each dish', "Turn off to remove the \"Note for the kitchen\" box on dishes. The allergy and order notes at checkout stay."],
        ]}
      />
      <P>
        These settings are part of the page, so on your live site they appear after you
        Publish, like any other page change. Your staging address shows them straight away.
      </P>
      <P>
        Dishes a guest already has in their basket show a small basket badge with how many they
        have, and an outline in your main colour, so they can see what they've picked while they
        browse.
      </P>
      <P>
        When a guest taps Add, the dish&apos;s picture zooms out and flies into the basket (the
        basket beside the menu, or the View basket bar on a phone), which gives a little bounce as
        it lands. A meal deal&apos;s last page has no picture, so its picture flies from the Add
        button. Dishes without a picture, and guests whose phone or computer is set to reduce
        motion, get no flight. No setting: always on.
      </P>
      <P>
        A menu with set times shows them to guests ("Dinner is available every day
        18:00–22:00"), and guests can browse and add from it outside those hours to order for
        later. At checkout only collection times when every dish in the basket is served are
        offered, and the order is checked again when it is placed. A menu whose dates have not
        started or have ended is not shown.
      </P>
      <DataTable
        head={['Setting', 'What it does']}
        rows={[
          ['Menus', "The menus guests can order from at this location, with their times. Which menus are online, and when each is on, are set on Menus > Menu times (the Website column), together with the kiosks and tills: Choose menus and their times on Menu times opens it. Dishes you switch off for ordering, or dishes without a price, are left out."],
          ['Ordering hours', "When guests can collect, per day. Filled in from your opening hours the first time. A day can have several windows, such as lunch and dinner. No window = closed."],
          ['Preparation time', "The earliest a new order can be ready. ASAP orders are promised this many minutes from now."],
          ['Time slots / orders per slot', "Guests pick a collection time from these slots. Set a maximum per slot and full slots are greyed out."],
          ['Order ahead', "How many days ahead guests can order. 0 = today only."],
          ['Minimum order, tips', "A minimum basket value, and optional tip choices at checkout."],
          ['Collection orders are / Count online sales under', "The order type online collection orders count as (Collection to start with): it decides each dish's tax (Menus, Tax rates) and how the order shows in the kitchen. Optionally, the revenue stream online sales count under (Store tech), for reports and tax exceptions that name it."],
          ['Accept automatically', "Off: each new order waits on the board until someone taps Accept. On: it goes straight to In progress."],
          ['Payment methods', "Pay at the counter, Card (Stripe) once your Stripe account is connected (see Card payments with Stripe below), and Test payment for trying the flow before going live: no money moves, so turn it off before real orders."],
          ['Messages', "Collection instructions (on the ordering page and the email) and a note for the confirmation email."],
        ]}
      />
      <P>
        On your website, the ordering page is <Mono>/order</Mono> (with several venues, guests
        pick a location first). Link to it from any button: the link picker lists{' '}
        <strong>Order online</strong>, and the Order options block's "Order with us" card
        points there.
      </P>
      <H3>Card payments with Stripe</H3>
      <P>
        Guests can pay online by card, Apple Pay or Google Pay. The money goes straight to your own Stripe
        account (you see the payments, payouts and any disputes in your Stripe dashboard); the platform&apos;s
        fee for online orders, if it has one, is taken from each payment by Stripe.
      </P>
      <ol className="list-decimal ml-5 space-y-2 text-sm text-muted-foreground mb-4">
        <li>Online orders → <strong>Ordering setup</strong> → Payment methods → <strong>Your Stripe account</strong> →{' '}
          <strong>Connect Stripe</strong> (an owner or admin). Stripe&apos;s own page asks for your business details and
          bank account, then sends you back here.</li>
        <li>Back here the card says how it went: <strong>Your Stripe sign-up isn&apos;t finished</strong> (tap{' '}
          <strong>Continue on Stripe</strong>), <strong>Stripe is checking your details</strong> (Stripe emails you if it
          needs anything; tap <strong>Check again</strong> later), or <strong>Stripe is connected and can take payments</strong>.</li>
        <li>Switch on <strong>Card (Stripe)</strong> in the payment methods and Save. Until Stripe says your account can
          take payments, guests don&apos;t see it.</li>
      </ol>
      <ul className="list-disc ml-5 space-y-2 text-sm text-muted-foreground mb-4">
        <li>At checkout guests see <strong>Card</strong>: Stripe&apos;s card form opens on the next page. A declined card
          says so and they can try another; the order reaches the kitchen only once the payment goes through.</li>
        <li>A guest who leaves before paying can pay from the order&apos;s page (<strong>Pay now</strong>). Unpaid orders
          are cancelled after a while, as with any online payment.</li>
        <li>Refunds from the order (Online orders, the order, <strong>Refund</strong>) go back to the guest&apos;s card
          through Stripe, with the platform&apos;s fee on that amount. Rejecting or cancelling a paid order refunds it.</li>
        <li>Apple Pay and Google Pay are set up for your website&apos;s address when the account is ready (the card lists
          each address). A custom domain added later is added the next time you tap <strong>Check again</strong>.</li>
        <li><strong>Unlink</strong> (asks first) takes Card (Stripe) off checkout and stops Stripe card machines on the
          account. The account and its payments stay at Stripe.</li>
        <li>The same account can run your Stripe card machines on tills and kiosks (Card machines, below).</li>
      </ul>
      <H3>Dishes and options</H3>
      <P>
        On the <strong>Menus</strong> page each dish has an <strong>Online ordering</strong>{' '}
        box: <strong>Can be ordered online</strong>. Its VAT comes from the <strong>Tax</strong> box
        on the dish, its section or its menu, with exceptions for order types such as Collection,
        so you can set a whole section of cold dishes to 0% for takeaway once instead of dish by
        dish (see Tax, Order Types &amp; Streams). In the UK hot takeaway food is 20% and most cold
        takeaway food is 0%.
      </P>
      <P>
        <strong>Minimum order quantity</strong> (same box, − and + buttons, None = no minimum) makes
        guests order at least that many of a dish, for example spring rolls, minimum 2. It counts every
        portion of the dish in the basket whatever the options. The dish card on your ordering page
        shows <em>Min 2</em>, the dish window starts at the minimum and won't go below it, and taking
        the basket below the minimum removes the dish. The dish row on the Menus page shows the same
        badge.
      </P>
      <P>
        Choices come from <strong>Menus → Variant groups</strong>. Each group now says how it
        is priced and how many options a guest picks: a protein or size group is{' '}
        <strong>the dish price, pick 1</strong>; an extras group is{' '}
        <strong>added on top, pick 0 to 3</strong> (for example). In a dish-price group, an option
        left empty or at £0 keeps the dish&apos;s own price: a flavour group with every flavour at £0 on
        a £12.99 dish sells at £12.99 (not £0), and the menu doesn&apos;t say &quot;from&quot; unless the
        options really change the price.
      </P>
      <P>
        The menu&apos;s own option settings (in the menu&apos;s details) apply to online ordering,
        the self-order kiosks and the tills too, the same as on your website and printed menu.{' '}
        <strong>Don&apos;t show the variant
        option at all if it isn&apos;t priced</strong> leaves options with no price (or £0) out, so
        guests and staff can&apos;t pick them. <strong>Don&apos;t show a price on zero-priced variants</strong>{' '}
        keeps a £0 option but shows no price next to it.
        An option with no price of its own leaves the dish at its own price.
      </P>
      <P>
        <strong>Combos online.</strong> A combo&apos;s card shows its price (&ldquo;from £11.00&rdquo;
        when choices can cost more). Tapping it goes one step at a time: Step 1 of 4 at the top,
        Back and Next at the bottom (Next says what&apos;s missing until the step is done), each
        picked dish&apos;s options under it (as the deal asks them, see Menus &rarr; Options in a
        meal deal), and a last page that lists the whole combo with the
        quantity, a note and Add. Optional groups set to show a button wait behind &ldquo;+ Extras&rdquo;,
        and groups that allow more than once have &minus; and + counters. The basket lists each
        combo&apos;s picks under it, and an automatic combo found among separate dishes shows its saving
        as a line in the basket. Orders, the confirmation email, the orders board and the kitchen screens
        show the picks too.
      </P>
      <H3>Privacy at checkout</H3>
      <P>
        Guests see a <strong>Your privacy</strong> section before they can place an order, with
        two boxes:
      </P>
      <DataTable
        head={['Box', 'What it means']}
        rows={[
          ['Order details (required)', "The guest agrees you use their name, email, phone and any allergy information only to prepare the order and contact them about it. Place order stays greyed out until it is ticked."],
          ['Newsletter (optional, unticked)', "The guest chooses to receive occasional, carefully crafted emails with news and offers. It adds them to the newsletter (see Customers & GDPR)."],
        ]}
      />
      <P>
        The wording uses your brand name from the Brand &amp; theme page. If your site has a
        published Privacy Policy page (Website → Legal &amp; cookies), a link to it shows under
        the boxes. Each order keeps a record of exactly what the guest agreed to and when, and the
        order shows it under the guest&apos;s details.
      </P>
      <H3>Handling orders</H3>
      <DataTable
        head={['To', 'Do this']}
        rows={[
          ['Hear new orders', "Tap Sound on once when you open the board (browsers only play sound after a tap)."],
          ['Accept', "Tap Accept on the card, or open it and pick a ready time: Accept now, or 10 to 45 minutes."],
          ['Move it along', "Preparing, then Ready to collect (the guest gets an email), then Collected."],
          ['Push the time back', "Open the order and tap +10m, +15m or +30m. The guest sees the new time on their order page."],
          ['Record payment at the counter', "Paid cash or Paid card on an unpaid order."],
          ['Refund', "Refund, enter the amount, then Yes. Online payments go back to the card; cash or card-terminal payments are only recorded, so hand the money back."],
          ['Reject or cancel', "Reject (new orders) or Cancel order, with an optional reason for the guest. Anything paid online is refunded automatically."],
          ['Print a ticket', "The printer icon in the order prints an 80mm ticket through the browser."],
          ['Run out of a dish', "Sold out on the board: Today (back on at midnight) or Until back on. The till and the menu screens show it too (and the till can set it: hold a dish down)."],
          ['Stop orders for a while', "Pause orders, with an optional message. Guests can still see the menu. Resume orders when you are ready."],
          ['Take orders later tonight', "Hours today (the clock on the phone): pick a time, or type one, and Take orders until. Guests can choose collection times up to then, today only: tomorrow goes back to the usual hours. On a day with no ordering hours it opens online ordering from now. Back to the usual hours undoes it. Menus with set times still follow them."],
        ]}
      />
      <InfoBox type="warn">
        Allergy notes show in red on the card, in the order and on the printed ticket. Always
        read them before cooking.
      </InfoBox>
      <P>
        Guests get an email when the order is confirmed (with a VAT breakdown), when it is
        ready, and if it is cancelled. Each email links to their order page, which updates by
        itself. An unpaid online order is released after 30 minutes. The{' '}
        <strong>Report</strong> tab shows orders, sales, average order, tips, refunds, money
        taken by payment method, your top dishes, discounts given and how often each promotion was used.
      </P>
      <H3>Transactions: every online sale with its tender</H3>
      <P>
        The <strong>Transactions</strong> tab lists every online order of the venue over the days you
        pick, your own online orders and GloriaFood orders together, each with its tender (how it
        was paid): Cash, Card at the counter, Card by phone, Paid online, Not marked paid yet, or
        the wording GloriaFood&apos;s export used for imported orders. Pick Today, 7, 30 or 90 days,
        or <strong>Choose days</strong> for any range up to a year.
      </P>
      <DataTable
        head={['Part', 'What it shows']}
        rows={[
          ['Totals', 'Counted orders, sales (tips included, discounts taken off), refunded, net (sales less refunds), tips and the average order.'],
          ['By tender', 'Net and number of orders per tender, split between your own online ordering and GloriaFood, and what was refunded.'],
          ['By source', 'The same for your own online ordering and GloriaFood.'],
          ['Transactions', 'Each order, newest first: day and time, number, where it came from, status, tender, total, refunded and net. Tap a row for its type, ready time, tips, discounts, delivery and fees, and VAT.'],
        ]}
      />
      <P>
        Filter by source, by tender, or <strong>Counted only</strong>. Rejected and cancelled orders,
        and GloriaFood test orders, are listed with a <strong>Not counted</strong> label and left out
        of the totals; online orders still waiting for their online payment aren&apos;t listed. The
        list shows 100 at a time (Show more); <strong>Download CSV</strong> saves every row of the
        current view, with money in pounds, for a spreadsheet or your accountant. Guest names and
        contact details are never in the report or the CSV.
      </P>
      <InfoBox type="info">
        GloriaFood orders are on the same day Cash Recon puts them: by fulfil time (or accepted
        time) with your trading day&apos;s start, as set on the GloriaFood link in Cash Recon settings.
        Your own online orders are on the day they were for. Refunds of GloriaFood orders happen in
        GloriaFood and aren&apos;t shown here.
      </InfoBox>
      <H3>GloriaFood orders on the board</H3>
      <P>
        If the venue takes orders through GloriaFood and is linked in Cash Recon settings &gt;
        GloriaFood, switch on <strong>Show GloriaFood orders on the Online orders board</strong> there.
        They then appear on this board (and on the phone) next to your own online orders, with an
        orange <strong>GloriaFood</strong> label, their type (pickup, delivery...) and how they were
        paid. They arrive already accepted, so they start under In progress and chime like new orders.
      </P>
      <P>
        Tap one to see the dishes, notes, delivery address and totals, print a ticket, or move it to
        Preparing, Ready and Collected (Sent for deliveries). Those moves only change this board:
        GloriaFood isn&apos;t told, and payments and refunds stay in GloriaFood. An order cancelled in
        GloriaFood shows as Cancelled. GloriaFood orders aren&apos;t in the Report tab; they are in
        the Transactions tab.
      </P>
      <P>
        With kitchen screens, GloriaFood orders can go to the kitchen too (Store tech → Kitchen
        screens → Online orders, see Kitchen screens). The kitchen then moves them to Ready and
        Collected here, and Ready or Collected here takes them off the kitchen screens.
      </P>
      <P>
        Orders you imported from GloriaFood&apos;s order export show too, but only on past days (go back
        with the arrows or pick a day): under <strong>Done</strong>, which opens by itself on a past day,
        with a grey <strong>Imported</strong> label. They are a record, so they can be looked at but not
        moved or printed, and they have no dishes or customer details (the export doesn&apos;t include
        them). The count at the top leaves out GloriaFood test orders. To check orders against a Cash Recon
        day, use <strong>GloriaFood orders</strong> on that day instead (see Cash Reconciliation): the board
        groups orders by calendar day, Cash Recon by your trading day.
      </P>
      <H3>Promotions</H3>
      <P>
        Discounts for online ordering live in <strong>Online orders → Promotions</strong>.
        Tap <strong>New promotion</strong>, fill it in and press Save. Each one can be switched
        on and off from the list, copied, or deleted (tap the bin, then Yes, delete; orders
        that used it keep their discount).
      </P>
      <DataTable
        head={['Setting', 'What it does']}
        rows={[
          ['Name, description', "What guests see in the basket, on the order page and on their receipt email."],
          ['Order discount', "A % or an amount off the whole order."],
          ['Dish discount', "A % or an amount off each of the dishes you pick. Tap Choose dishes to open the menu: tick single dishes, or Whole section so dishes added to that section later count too, then Done (Cancel drops the ticks). What you picked shows as tags you can remove with the x. Every dish covers the whole menu."],
          ['Buy X get Y', "For every X + Y of the chosen dishes, the Y cheapest are free (or a % off). Buy 1 get 1 free, 3 for 2 (buy 2 get 1), half-price second dish."],
          ['Free dish', "Once the order qualifies (for example a minimum spend), one of the dishes you pick is free, or a % off. Pick a whole section such as Desserts to let guests choose. The basket tells guests they have earned it, with a Choose button that takes them to the dishes. The free dish doesn't count towards the minimum spend. More than one free, or the cheapest of several: set How many."],
          ['Meal deal', "Parts, each with a name, how many and which dishes count (for example Starter from the Starters section, Main from Mains, Drink from Soft drinks), and a price. Every complete set in the basket costs the deal price; the dearest dishes that fit are used so guests save the most, and anything extra is at full price. A guest with part of a deal sees 'Add Drink to get Lunch deal' with a button to the drinks."],
          ['Spend more, save more', "Spend levels, each with its own % or £ off the whole order: for example spend £20 get 10% off, spend £40 get 15% off. The highest level reached applies. Guests see how much more to spend for the next level."],
          ['Dish label', "A small badge (for example 2 FOR 1) on the dishes a dish or Buy X get Y offer covers."],
          ['Most it can take off', "A cap on the discount, for example 20% off up to £10."],
          ['Minimum spend', "The basket (before any discount) must reach this. Guests who are close see 'Spend £x more to get ...'."],
          ['Needs one of these dishes', "Only applies when at least one of these dishes is in the basket."],
          ['Automatic', "Taken off as soon as the basket qualifies."],
          ['Tap to apply', "Shown in the basket with the saving and an Apply button; the guest chooses it."],
          ['Promo code', "Only applies when the guest types the code (any capitals). Generate makes a random one. Codes are never shown on your site unless you put them in a Promo block."],
          ['Number of uses', "How many orders can use it in total. Cancelled, rejected and unpaid-then-expired orders give their use back. The list shows uses so far and the total discount given."],
          ['Dates and times', "When it runs, the same way as menu times: From / Until dates and days with hours (happy hour, lunch deal). Checked when the guest places the order."],
          ['Venues', "All venues, or only the ones you pick. Only your own restaurant group's venues are listed."],
          ["Can't be combined", "It only applies if no promotion above it in the list already has, and then nothing below it applies."],
        ]}
      />
      <P>
        <strong>The order of the list is the priority</strong>: drag a promotion up or down by its
        grip. The top one is taken off first and each one after it takes its discount off what is
        left, so 10% off then £5 off a £30 order is £3 then £5. Put an exclusive offer higher
        than the ones it should beat. Spend levels are judged on the full basket before any
        discount.
      </P>
      <P>
        In the basket guests see each discount on its own line, offers they can tap to apply,
        hints such as &quot;Add 1 more to get Rice 2 for 1&quot;, and a <strong>Have a promo
        code?</strong> link when any code promotion is running. A promotion that runs out or ends
        while a guest is checking out is taken off with a message before the order is placed.
        Staff see the discounts on the order, the printed ticket and the Report.
      </P>
      <H3>Promo box on the ordering page</H3>
      <P>
        Tick <strong>Show in the promo box</strong> on a promotion (Promotions → edit → Promo box on the
        ordering page) to give it a card on your ordering page: above the basket on desktop, under the title
        on phones. Choose its background colour from your theme, an optional background image (a dark shade
        is added so the text stays readable) and a text colour (Automatic picks dark or white text to suit the
        background); the editor shows a preview. The card shows the dish label (or OFFER), the name, the
        description (or what it takes off) and the small print, with <strong>Apply offer</strong> for a
        tap-to-apply promotion, <strong>See dishes</strong> / <strong>Start your deal</strong> for dish offers
        and meal deals, and <em>Applied −£x</em> once it counts. Several promotions share one box: guests swipe
        or tap the dots. Code promotions never appear there, so the code stays private. To hide the box, turn
        off <strong>Show the promo box</strong> in the Online ordering block.
      </P>

      <H3>Promo block on your website</H3>
      <P>
        In the page builder, add a <strong>Promo</strong> block and pick a promotion. It shows
        the name, what it takes off, the small print (minimum spend, times, dates) and an{' '}
        <strong>Order now</strong> button that opens the ordering page with the offer ready: a
        code is applied for the guest, a tap-to-apply offer is already chosen. You can change the
        heading, text, button, style (Banner or Voucher card) and colours. The block disappears by
        itself when the promotion is switched off, ends or is used up. Putting a code promotion in
        a Promo block publishes its code. You can also share a link yourself:{' '}
        <Mono>/order?promo=YOURCODE</Mono>.
      </P>
    </section>
  )
}
