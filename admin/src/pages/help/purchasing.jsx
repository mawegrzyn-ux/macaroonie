// src/pages/help/purchasing.jsx
// The Help page's "Purchasing" section. Help.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, InfoBox, DataTable } from './parts.jsx'

export const id = 'purchasing'
export const label = 'Purchasing'
export const order = 370

// ── PURCHASING ────────────────────────────────
export function Section() {
  return (
    <section id="purchasing" data-help="">
      <H2>Purchasing</H2>
      <P>
        Purchasing is how restaurants order from suppliers. Managers set up what can be ordered
        once: the <strong>inventory</strong> (every product you buy), the <strong>suppliers</strong>{' '}
        and their prices, and <strong>order lists</strong>. Staff then pick a list, type the quantities
        and place the order: Macaroonie splits it into one purchase order per supplier, sends the
        ones that go by email, and books the deliveries in when they arrive. Also on your phone at{' '}
        <strong>/mobile → Purchasing</strong>.
      </P>

      <H3>1. Suppliers (Purchasing → Suppliers)</H3>
      <P>
        Add each company you buy from with its contact details and how it takes orders:
      </P>
      <DataTable
        head={['Send orders by', 'What happens when an order is placed']}
        rows={[
          ['Email', 'Emailed straight to the supplier\'s order address from the venue\'s email account, with a PDF or Excel copy attached (your choice). Copy-to addresses get it too.'],
          ['Print', 'Waits under To send: staff print it and hand or fax it over, then tap Mark as sent.'],
          ['Excel file', 'Waits under To send: staff download the Excel file (for suppliers with an upload portal), then mark it sent.'],
          ['PDF file', 'Waits under To send: staff download the PDF and send it themselves, then mark it sent.'],
        ]}
      />
      <P>
        Also set the <strong>delivery days</strong>, the <strong>order cutoff</strong> (orders placed after
        it count as the next day's), the <strong>days from order to delivery</strong>, and optionally a
        minimum order and delivery charge. These work out the delivery date each order is placed for.
        Switch on <strong>Needs their order reference when an order is marked sent</strong> for suppliers who
        confirm orders with a reference of their own (their website, app or confirmation email, e.g.
        S043172591): nobody can mark an order sent without typing it in.
      </P>
      <P>
        Under <strong>Per venue</strong>, each venue can have its own account number, delivery days, cutoff
        and <strong>days from order to delivery</strong> (Same = the supplier's), and its own delivery
        details:
      </P>
      <DataTable
        head={['Per venue', 'Where it is used']}
        rows={[
          ['Delivery phone', 'The number the driver rings. Printed on the order and in Copy for checkout. Empty: the venue\'s own phone.'],
          ['Delivery slot', 'When drivers may come, from and to (either can be Any). Shown when placing, on the order and its printed copy.'],
          ['Driver instructions', 'Start the note to the supplier on every order from this venue (it can be changed or cleared when placing), and print on the order.'],
        ]}
      />

      <H3>2. Inventory (Purchasing → Inventory)</H3>
      <P>
        Every product you buy, once, however many suppliers sell it. An item is <strong>counted in</strong>{' '}
        weight, volume or count, and has a storage type: <strong>chilled</strong> and{' '}
        <strong>frozen</strong> items ask for a probe temperature when a delivery is booked in.
      </P>
      <P>
        An item has no price of its own. Its prices are its <strong>supplier prices</strong>: which
        supplier, their product code, the pack (e.g. Case of 6 × 2 kg), the price per pack before VAT,
        the VAT rate, and optionally a minimum order and a step (e.g. half cases). One supplier can
        have several prices for the same item (different pack sizes). Each price shows what it comes
        to per kg, litre or item, so prices can be compared.
      </P>
      <DataTable
        head={['Which price a venue orders', '']}
        rows={[
          ['The venue\'s own choice', 'Set under "Which price each venue orders" on the item.'],
          ['Else the company choice', 'The star on a supplier price.'],
          ['Else the cheapest', 'Per kg, litre or item, at that venue\'s price.'],
        ]}
      />
      <P>
        A supplier price can carry the <strong>supplier's product name</strong>: what the supplier calls
        it when that isn't just the item's name, such as a brand (item <em>Ketchup</em>, supplier price{' '}
        <em>Heinz Tomato Ketchup</em>). Staff still order <em>Ketchup</em>; the product name shows under
        it on the order form and is what the supplier sees on their copy of the order. For two brands from
        the same supplier, give each its own supplier price with its own product name: staff pick between
        them by tapping the pack, and the star decides which is ordered normally.
      </P>
      <P>
        <strong>Venue prices</strong> on a supplier price set what one venue pays when it differs from
        the company price. Every price change (by hand, by import or from an invoice) is kept, with the pack size it
        was for (a new pack size is a change too): tap <strong>History</strong> to see them. Each change also checks
        the dishes made with the item: any it takes over their cost target show on Menu margins (Price creep and cost
        alerts).
      </P>
      <InfoBox type="tip">
        <strong>Import</strong> loads a whole price list from a CSV or Excel file (download the template
        for the headings, including Product name, Minimum order and Order in steps of): new items, suppliers and
        categories are added, existing prices updated. Minimum order and Order in steps of are in packs; left
        blank they stay as they are. Check file shows what would change first; rows with a problem are listed and
        skipped.
      </InfoBox>
      <P>
        Deleting an item that has been ordered, is on an order being filled in, or has been counted or adjusted
        on the Stock page, switches it off instead, so those orders and stock records keep it. A supplier price or a supplier that an open order uses (a draft with a quantity,
        or one waiting for approval) can't be deleted: switch it off instead, and the order shows the line as
        needing another price (see Placing an order).
        <strong> Categories</strong> group items on lists and orders; drag them into the order you want.
      </P>
      <P>
        Changing a supplier price's pack size (by hand or by import) keeps the amount on open orders: 3 bags of
        5 kg become 2 bags once the bag is 10 kg (never less than was asked for), fitted to the new minimum and
        steps.
      </P>

      <H3>3. Order lists (Purchasing → Order lists)</H3>
      <P>
        A list is what a venue orders from, e.g. "Daily fresh" or "Weekly dry goods". It can mix any
        suppliers. Pick the venues that use it, add items, and drag them into order (within each
        category). Each venue can have a <strong>par</strong> per item: the usual quantity, in packs.
        Staff can fill an order to its pars in one tap.
      </P>

      <H3>4. Placing an order (Purchasing → Order)</H3>
      <ol className="list-decimal ml-5 space-y-2 text-sm text-muted-foreground mb-4">
        <li>Pick the venue at the top, then tap a list (or <strong>Something else</strong> to search the whole inventory).</li>
        <li>Use <strong>−</strong> / <strong>+</strong> or type a quantity. The pack you are ordering (Case, Box, Bag and its size) sits next to the quantity. Where the supplier has a minimum, the first <strong>+</strong> goes straight to it and <strong>−</strong> below it goes back to 0. <strong>Par</strong> sets the usual quantity; <strong>Fill to par</strong> does it for every empty line. Once the venue counts its stock, pars are <em>up to par</em>: the par less what is on hand and already on order (each line shows on hand, on order and what sales used in the last 7 days). That needs Stock view: without it the form orders the par as it is, and says so. The Stock page&apos;s Settings say which way each venue&apos;s pars read.</li>
        <li><strong>Show</strong> picks what else each line shows: the supplier, the price per pack, the last order (how many and when) and a <strong>Last quantity</strong> column at the end. All are off until you switch them on, and the choice is remembered on that device. Price only appears for people allowed to see prices.</li>
        <li>To order an item from another supplier or another pack this time, tap its pack (it has a small arrow when there is another). The amount stays the same: each choice says what the quantity becomes, e.g. 3 × Bag 5 kg (15 kg) becomes 2 × Sack 10 kg (20 kg). <strong>Add item</strong> adds anything from the inventory.</li>
        <li>Group by <strong>Supplier</strong> to see each supplier's next delivery date and when to order by for it.</li>
        <li>Tap <strong>Review &amp; place</strong>: one order per supplier, each with its delivery date and a note for the supplier. The note starts as the venue's driver instructions for that supplier (change or clear it; <strong>Use the driver instructions again</strong> puts them back), and the delivery slot and phone show under the date. To deliver on another day, tap one of <strong>Their delivery days</strong> (the supplier's next four) or tap the date to pick any day from the calendar. Under the date it says when to order by for that day (e.g. order by 18:00 today). Then <strong>Place</strong>.</li>
      </ol>
      <P>
        Quantities save as you type, so a half-filled order is waiting as a <strong>Draft</strong> on the
        list's tile. Quantities below a supplier's minimum or step are rounded up when the order is placed.
        Staff see prices only if their role can view purchasing setup.
      </P>
      <DataTable
        head={['The date picked', 'What happens']}
        rows={[
          ['A delivery day, in time', 'Says when to order by for it. Place as normal.'],
          ['A day they don\'t deliver, or too late for it', 'Says why (e.g. "Too late for Tue 3 Nov: Fresh Direct\'s cutoff for it was 18:00 today"). Pick another day, or switch on Agreed with the supplier if you have arranged it with them, then place.'],
          ['A day in the past', 'Can\'t be placed: pick another day.'],
        ]}
      />
      <P>
        When the venue already has an order from the same supplier for the same day, Place order says so and
        waits for an answer:
      </P>
      <DataTable
        head={['The order already there', 'What you can do']}
        rows={[
          ['Waiting under To send', 'Add to it (the lines go on that order; a product already on it has its quantity topped up) or Separate order (a second order for the same day).'],
          ['Already with the supplier', 'Only a second order: switch on Place a second order (or pick another day). To change what they already have, phone them.'],
        ]}
      />
      <P>
        The placed screen says which orders were added to. Sending for approval only notes it: the manager
        answers when placing.
      </P>
      <P>
        Each line keeps the supplier price it was filled in on, even if another price becomes the usual one
        later. If that price, its supplier or the item is switched off while the order waits, the line turns
        red and says so, and the order can't be placed or sent for approval until it has{' '}
        <strong>Pick another price</strong> (the amount is kept, as above) or <strong>Take it off</strong>.
        It is never moved to another price or supplier by itself.
      </P>

      <H3>5. Deliveries (Purchasing → Deliveries)</H3>
      <DataTable
        head={['Status', 'What to do']}
        rows={[
          ['To send', 'Not with the supplier yet: Email it, or Print / PDF / Excel and tap Mark as sent. Quantities can still be changed and more of the supplier\'s products added. An email that failed shows why.'],
          ['Sent', 'Waiting for the delivery. "Due today or overdue" lists the ones to expect.'],
          ['Received', 'Booked in. The delivery check is under Food safety → Deliveries.'],
          ['Cancelled', 'Cancelled before it arrived.'],
        ]}
      />
      <P>
        An order&apos;s page (in the office and on the phone) opens with a plain card: the delivery day, the
        status in big letters and the supplier&apos;s reference beside it (<strong>Add it</strong> or{' '}
        <strong>Change</strong>). The three dots at the card&apos;s top right hold <strong>Print</strong>,{' '}
        <strong>PDF</strong>, <strong>Excel</strong>, <strong>Copy for checkout</strong>,{' '}
        <strong>Codes for quick order</strong>, <strong>Correct the delivery</strong> (once it is received) and{' '}
        <strong>Details and history</strong>: who asked for it, when it was placed and by whom, when and how it
        was sent, when it was received and by whom, and the account number, phone, delivery slot, note to the
        supplier and any orders it was split into. The buttons for sending and booking in, and the lines, are
        under the card as before.
      </P>
      <P>
        While an order waits under <strong>To send</strong>, someone with Purchasing approval can still
        change it. <strong>Change quantities</strong> changes how many of each (0 takes a line off); a quantity
        below the supplier's minimum or between their steps is rounded up, and the line says what it will
        order.{' '}
        <strong>Add items</strong> lists everything that supplier sells you: search by name, tap the
        products to add (something already on the order can't be picked again: change its quantity
        instead), tap Done, set how many, then <strong>Save</strong>. Added products go on at today's price
        for the venue, rounded up to the supplier's minimum and steps. If you see prices, the total shows
        what the order comes to and what it was before. Once an order has been sent it can't change:
        cancel it and order again.
      </P>
      <P>
        The delivery date can be moved until the delivery is booked in. A day the supplier doesn't deliver, or
        one too late for their cutoff, asks first: tap <strong>Agreed with</strong> the supplier to move it
        anyway, or keep the old date. A day in the past can't be picked.
      </P>
      <P>
        <strong>Mark as sent</strong> asks how the order reached the supplier (including{' '}
        <strong>Ordered on their website or app</strong>), their <strong>order reference</strong> (needed for
        suppliers set to need it, otherwise optional) and <strong>when it went</strong>: Just now, or Earlier
        (any time in the last 14 days since the order was made, e.g. phoned in yesterday and marked today).
        The reference shows on the order and its card; <strong>Change</strong> (or <strong>Add it</strong>)
        sets it later, until the order is cancelled.
      </P>
      <P>
        <strong>Copy for checkout</strong> on an order gives what a supplier's website or app asks for at its
        checkout: the account number, where to deliver (the venue's address from Website, under the location's
        Find us), the day and slot, the phone, the instructions and our order number. Copy them all at once, or
        one line at a time with the button beside it for checkouts with separate boxes. The delivery slot,
        driver's phone and instructions also show on the order and print on its copy.
      </P>
      <DataTable
        head={['On the Deliveries tab', 'Means']}
        rows={[
          ['Past their cutoff', 'Still To send after the supplier\'s cutoff for its delivery day: send it now and check they can still make that day, or move it.'],
          ['Not booked in', 'Sent, and its delivery day has gone without the delivery being booked in: check whether it came, then book it in (or cancel it).'],
          ['Their ref', 'The supplier\'s own order reference.'],
        ]}
      />
      <P>
        The search box on the Deliveries tab finds an order by the supplier's reference (part of it is
        enough) or our PO number, whatever its state. Today lists the same late orders.
      </P>
      <P>
        When a delivery arrives, open it and tap <strong>Book in delivery</strong>: for each line, how
        many arrived (a lower number marks it Short; you can also pick Damaged, Substituted or Not
        delivered, with a note), the packaging, damage and quality checks, the temperature of the chilled
        and frozen goods (chilled at or below 8°C, frozen at or below -15°C), and whether you accepted it.
        If anything failed, say what was done about it. Saving writes the venue's delivery check for
        Food safety, so it doesn't need typing in twice. <strong>Correct the delivery</strong> (in the three-dot
        menu of a received order) updates it.
      </P>

      <H3>6. Orders that need approval</H3>
      <P>
        A role's <strong>Purchasing approval</strong> permission (Access → Roles) decides who can place
        orders. People who can order (Purchasing: Manage) but not approve fill in an order the same way,
        then tap <strong>Send for approval</strong> instead of Place order: they pick the day they'd like
        from each supplier and can leave a note for the manager. A day the supplier can't make is only a note
        here (the manager agrees it with them or picks another day when placing it); a day in the past can't
        be asked for. Nothing reaches the suppliers yet. To make someone request only, set their role's
        Purchasing approval to None.
      </P>
      <DataTable
        head={['Who', 'What they can do with an order waiting for approval']}
        rows={[
          ['The person who asked', 'See it under Waiting for approval on the Order tab, and Take it back to change it (it becomes a draft again).'],
          ['Someone with Purchasing approval', 'Open it from Waiting for approval (the Order tab says how many are waiting). Change any quantity: a changed line shows what was asked for. Then Place order (the days asked for are picked already), Split for another day, Send back with a reason, or Decline (deletes it).'],
        ]}
      />
      <P>
        An order that was sent back shows <strong>Sent back</strong> on its list's tile and the reason at the
        top: change it and send it for approval again. A placed purchase order records who asked for it and
        who placed it. Changing a placed order's quantities, adding products to it, splitting it and
        cancelling it also need Purchasing approval; sending it, moving its delivery date and booking the
        delivery in don't.
      </P>

      <H3>7. Splitting an order for another day</H3>
      <P>
        <strong>Split for another day</strong> moves part of an order to a second order with its own
        delivery day: tap <strong>Move</strong> (or All) on the lines that should come later, then pick the
        day from the supplier's delivery days or the calendar. It must be a different day from the first
        order's, and something has to stay on the first one (to move everything, change its delivery day).
        The new day is checked like placing (Agreed with the supplier for a day they can't make), and both
        parts of each line must still meet the supplier's minimum and steps: with a minimum of 20, a line of 30
        can only move all of it or none, and the line says why.
      </P>
      <DataTable
        head={['Split', 'What happens']}
        rows={[
          ['An order waiting for approval', 'The moved part becomes a second request from the same person, also waiting for approval. Each is placed (or sent back) on its own.'],
          ['A purchase order not sent yet', 'A second purchase order to the same supplier for the new day, with the same prices, note and delivery charge. Both wait under To send.'],
          ['A purchase order the supplier already has', 'The first one goes back to To send marked Changed, and its copy says Amended and that it replaces the earlier one. Suppliers that take email get both straight away; for the others, send both again.'],
        ]}
      />
      <P>
        The two purchase orders link to each other (Split off / Part moved to), and the second one's copy
        tells the supplier which order it was split from.
      </P>

      <H3>8. Reading the invoice when a delivery comes</H3>
      <P>
        In <strong>Book in delivery</strong>, photograph the supplier's invoice or delivery note (or choose
        photos or a PDF of it) and tap <strong>Read it with Pepper</strong>. Pepper reads every line and
        matches it to what was ordered, or to another product you buy from that supplier; then the form
        fills itself in. Check each line before saving: nothing is saved until you tap Save.
      </P>
      <DataTable
        head={['On the invoice', 'What the form does']}
        rows={[
          ['A line that was ordered', 'Sets how many arrived (fewer marks it Short) and shows the line as invoiced. People who see prices get the invoice price per pack, with how much it differs from the ordered price, and can correct it.'],
          ['Something else instead of what was ordered', 'Marks the ordered line Substituted, with what came instead.'],
          ['Not ordered, but one of the supplier\'s products', 'Listed under On the invoice, not ordered, set to Add it: it is booked in as arrived.'],
          ['Not ordered and not recognised', 'Listed there too, waiting for you: Add it (pick the inventory item, then one of the supplier\'s packs or the pack as invoiced; with Purchasing setup you can make a new inventory item), Came instead (of an ordered line), or Leave out. Save waits until each one is decided.'],
          ['An ordered line not on the invoice', 'Marked Not on the invoice: check it arrived.'],
          ['Delivery charges, deposits, discounts', 'Shown under the summary (prices only).'],
        ]}
      />
      <P>
        If Pepper matched a line wrongly, tap <strong>Not this line</strong> under it: the invoice line moves
        to the list below to be decided again. The order keeps the prices it was placed at; the invoice's
        prices are kept beside them. The invoice files stay with the order (Invoice, on the order's page),
        and the supplier's copy of the order still shows only what was ordered. On the order's page, lines that
        arrived without being ordered carry a Not ordered badge with the quantity that arrived and (with prices)
        their value at the invoice's prices; their total shows as Not ordered, arrived under the order total,
        which stays as ordered.
      </P>

      <H3>9. Updating the price list from an invoice</H3>
      <P>
        With Purchasing setup (Manage), saving a delivery whose invoice differs from the price list asks{' '}
        <strong>Update the price list from the invoice</strong>; the same button stays on the order's page
        until nothing differs.
      </P>
      <DataTable
        head={['Line', 'Choices']}
        rows={[
          ['A price that changed', 'Everywhere (the supplier price), this venue only (its own venue price), or Keep.'],
          ['A product not in the price list', 'Add to price list: the supplier\'s product name, code and pack come from the invoice and can be changed. Optionally make it the one ordered from now on, at this venue or everywhere.'],
          ['A substitute', 'Just this time, or add it as another product for the same item (another brand from that supplier).'],
        ]}
      />
      <P>
        Each change shows in the price's History as from the invoice. Updating needs Purchasing setup; staff
        who book deliveries in without it still record the invoice prices for a manager to look at.
      </P>
      <H3>10. Supplier codes and quick orders</H3>
      <P>
        A supplier price's <strong>product code</strong> (the code in the supplier's own catalogue, e.g.{' '}
        <em>MEA161</em>) shows in a small grey box next to the pack everywhere you order: the order form,
        Add an item, the supplier switch, the Place order window, splitting, the purchase order page,
        booking a delivery in and the Inventory list.
      </P>
      <DataTable
        head={['Searching by code', 'Finds']}
        rows={[
          ['The order form\'s search box', 'Items by name, our own code, any supplier\'s code (whole or part) or the supplier\'s product name.'],
          ['Add an item, Add items on a purchase order', 'The same. A supplier\'s code typed in full offers that supplier\'s product, even when the item is usually ordered from someone else.'],
          ['The Deliveries search', 'An order with that product code on a line (the whole code), besides their reference and our PO number.'],
          ['Inventory', 'Items by name, code or any supplier\'s code or product name.'],
        ]}
      />
      <P>
        <strong>Codes for quick order</strong> (on a purchase order) and <strong>Codes</strong> (on the order
        form) give each supplier's codes with how many packs, ready for the quick order box on their website
        or app: <em>MEA161:20,POR106:7</em>, on one line or one a line (remembered on this device). Copy puts
        them on the clipboard; <strong>CSV file</strong> downloads the same lines as code, name and quantity,
        with no prices. Lines whose price has no product code are listed underneath to add by hand: add the
        code to the supplier price on the Inventory page and it is there next time.
      </P>
      <H3>11. Tidying the catalogue</H3>
      <P>
        A supplier's product code names one product, so it can't be on two of that supplier's prices in use:
        saving a price with a code the supplier already has on another item is refused, naming that item (an
        import or an invoice's price list leaves such a row out with the reason). Change one of the codes, or
        switch the other price off first. A switched-off price or item can keep its code, but switching it back
        on waits until the code is free again.
      </P>
      <P>
        Naming an item like one already there (capitals and spaces at the ends don't count) shows a warning
        with <strong>Open it</strong>: staff can't tell two items with one name apart on an order. Rename one,
        or keep one: add the other's supplier prices to it and switch the other off.
      </P>
      <DataTable
        head={['On the Inventory page', 'What it does']}
        rows={[
          ['Check', 'The catalogue check: a code on two products, two items in use with one name, items nobody sells (no price from a supplier that is switched on), and prices without a product code. Tap an item to open it. Anyone who can see Inventory can run it.'],
          ['Select', 'Tap items to choose them (or Choose all shown), then Switch off or Switch on. The window first says what will change, which items are on open orders (those lines then have to be taken off before the order can be placed) and which codes another item already uses (switching on waits until that is fixed). Switched-off items keep their prices and history.'],
          ['Update prices', 'One supplier\'s new prices matched by their product code. Pick the supplier, then download their prices now as a CSV to edit, paste lines (code, price), or choose a CSV or Excel file with a Code and a Price column. Check lists what would change, with changes of 20% or more marked, and the codes it couldn\'t use (not found, switched off, on two products, unreadable). Update saves the changes into each price\'s History. Prices without a code and venues\' own prices stay as they are; a collection price column is left out (a supplier price here is the delivered price).'],
        ]}
      />
      <H3>12. Bringing a supplier's basket into an order</H3>
      <P>
        Ordered on a supplier's own website or app? <strong>Import basket</strong> on the order form sets the
        order to match what is in their basket, by their product codes, so the order here (and the delivery
        check, the costs and the history) says what was really ordered. Nothing is sent to the supplier.
      </P>
      <ol className="list-decimal ml-5 space-y-2 text-sm text-muted-foreground mb-4">
        <li>Pick the <strong>supplier</strong> (the one with lines on the order is picked for you). A supplier with no product codes here can't be picked.</li>
        <li>Choose their basket as a <strong>CSV, Excel or text file</strong>, or <strong>paste</strong> it: <em>MEA161:20, POR106:7</em> on one line or one a line (<em>MEA161 20</em>, <em>MEA161 x 20</em> and <em>20 x MEA161</em> work too), or the basket's rows copied with their headings (a Code and a Qty column). Quantities are their packs.</li>
        <li><strong>Take off their lines that aren't in the basket</strong> is on at first: off, only what is in the basket changes.</li>
        <li><strong>Check</strong> lists what would change: <strong>Add</strong>, <strong>Change</strong> (from and to, and "was" when the line was on another supplier's or another pack's price) and <strong>Take off</strong>, then what is left out. <strong>Apply</strong> changes the order; <strong>Change the basket</strong> goes back.</li>
      </ol>
      <DataTable
        head={['In the basket', 'What happens']}
        rows={[
          ['A code of one of their products here', 'The line is set to the basket\'s quantity, on that price (moved from another supplier or pack when it was on one).'],
          ['A code twice', 'The quantities are added up.'],
          ['A quantity below the minimum, or not in its steps', 'It goes up to what can be ordered, as placing does, and the line says so.'],
          ['A code not found here', 'Left out. Someone with Purchasing setup can tap Add it: pick the inventory item, then give one of the supplier\'s prices for it the code, or make a new price with it. Then it checks again.'],
          ['A code on a price or item that is switched off, or on two products', 'Left out, and listed.'],
          ['Two codes of one item', 'The second is left out: an order has one line for each item.'],
          ['A line that can\'t be read', 'Left out with its line number. Two numbers either side of an x (12 x 20) could be either way round: write code:quantity.'],
        ]}
      />
      <P>
        Anyone who can fill the order in can import into it (a draft; an order waiting for approval needs
        Purchasing approval). Up to 2,000 lines at a time.
      </P>

      <H3>13. Out of stock until a date</H3>
      <P>
        When a supplier says a product is out of stock, record it on that price: tap the line's pack on the
        order form (or the price on the item's Inventory page), then <strong>Out of stock?</strong>, and pick{' '}
        <strong>the first day it can be delivered again</strong> (Tomorrow, In a week, In 2 weeks, In 4
        weeks, or any day), with what they said if you like. From that day it counts as back in stock by
        itself; <strong>Back in stock</strong> clears it sooner and <strong>Change</strong> moves the day.
        It is for every venue, and shows who marked it and when.
      </P>
      <DataTable
        head={['Where', 'What it says']}
        rows={[
          ['Order form lines', 'Out of stock at Brakes until Fri 6 Nov, for an order whose next delivery is before then, with Pick another price.'],
          ['Place order', 'Each supplier\'s lines out of stock for the date picked, with the first day they are all back: deliver then or later, order them from another supplier, or order anyway.'],
          ['Splitting an order, the purchase order page', 'The lines out of stock for that order\'s (or the new) delivery day.'],
          ['Inventory and Add an item', 'Which price is out of stock now.'],
        ]}
      />
      <P>
        Nothing moves to another supplier by itself and nothing is stopped: staff pick another price (the
        amount is kept), another day, or order anyway. Anyone who orders, approves or keeps the catalogue can
        mark it, even on an order they can't change; people with View only see it.
      </P>

      <H3>14. Booking in a delivery without an order</H3>
      <P>
        Some goods arrive with no purchase order here: extras the driver brought, a standing delivery nobody
        orders in the app, a cash and carry run. To book them in, someone with Purchasing setup (Manage)
        switches it on first: on the Purchasing page tap <strong>Settings</strong>, then under Book in
        deliveries without an order pick who may do it, and Save.
      </P>
      <DataTable
        head={['Setting', 'Who can book one in']}
        rows={[
          ['Off', 'Nobody: deliveries are only booked in against a purchase order. This is how it starts.'],
          ['Anyone who books deliveries in', 'Everyone with Purchasing or Purchasing approval (Manage).'],
          ['Only people with Purchasing approval', 'Managers only: people who can only send orders for approval can\'t.'],
        ]}
      />
      <P>
        Then the Deliveries tab has <strong>Book in without an order</strong>. Pick the supplier it came from
        (suppliers with nothing in the price list are there too), then fill in the form like any delivery:
      </P>
      <DataTable
        head={['On the form', 'What to do']}
        rows={[
          ['Arrived on', 'Today, or the day it came (up to a month back).'],
          ['Their delivery note or invoice number', 'Optional. Filled in from the invoice when Pepper reads one.'],
          ['Invoice or delivery note', 'Read it with Pepper, as for an order: the supplier\'s products it finds are added; anything else waits for you to Add it (pick the inventory item and its pack) or Leave it out.'],
          ['What arrived', 'Add a product: search the inventory and tap one of the supplier\'s packs, or Another pack / As it came packed to give the pack yourself. Set how many came with the - and +; the X takes a line off. People who see prices can type the price paid per pack (it starts at the price list\'s).'],
          ['Checks', 'The same checks and temperatures as any delivery. Saving writes the delivery check for Food safety for the day it arrived.'],
        ]}
      />
      <P>
        Saving makes a purchase order for it, marked <strong>No order</strong>, already received, with what
        arrived as its lines and its total at the prices paid. It is never sent to the supplier (there is no
        Print, PDF or Excel copy), and it doesn't count as the last order on the order form. It is listed
        under Received &amp; cancelled. <strong>Correct the delivery</strong> changes how many came (0 takes a
        line off), adds products, or moves the day; with Purchasing setup, <strong>Update the price list</strong>{' '}
        offers the prices paid that differ from the price list, as for an invoice. Pepper can show these
        deliveries but can't book one in yet: use the Deliveries tab.
      </P>
      <H3>15. Barcodes on items and supplier products</H3>
      <P>
        An inventory item and each supplier price can carry a <strong>Barcode</strong>: the GTIN printed under the
        bars (8, 12, 13 or 14 digits). It is checked as you type: a number whose last digit doesn&apos;t match the
        rest is refused, as for dishes. Your own <strong>Item code</strong> and the supplier&apos;s product code stay
        free text beside it. The search on the Inventory page and on the order form finds a barcode typed or
        scanned in whole; in the Macaroonie Office app the scan button reads it with the camera. A supplier
        product&apos;s barcode picks that supplier&apos;s price on the order.
      </P>
      <P>
        The inventory import and <strong>Update the price list</strong> take a <strong>Barcode</strong> column too
        (headed Barcode, GTIN, EAN or UPC). In the import it is the supplier product&apos;s barcode on a row with a
        supplier, else the item&apos;s; a column headed <strong>Item barcode</strong> is always the item&apos;s. A
        barcode that isn&apos;t a right GTIN is left out and listed with its row: the rest of the row still goes in.
        Pepper can read and set a supplier price&apos;s barcode as well as an item&apos;s.
      </P>
      <H3>16. Stock on hand and stock counts</H3>
      <P>
        Stock on hand and counting have a page of their own now: <strong>Stock</strong> (main menu, under Stock),
        with counts by storage area, approval, adjustments and each item&apos;s history. See the Stock section of
        this guide. The Inventory page&apos;s Stock on hand tab links there. An item below its par at a venue (the
        highest par on the venue&apos;s order lists) is still marked <strong>Below par</strong>, on the Stock page.
      </P>
      <H3>17. Units and yield for recipes</H3>
      <P>
        Each item&apos;s drawer has a <strong>Units and yield</strong> card, which recipes cost the item by (see
        Recipes). <strong>Yield</strong> is the share left after trimming (an onion about 88%): a recipe using 100
        g needs 100 ÷ 0.88 = about 114 g bought. <strong>Used in recipes in</strong> and <strong>Counted in</strong>{' '}
        are the units it is usually used and counted in. <strong>Its own units</strong> are sizes beyond g, kg, ml
        and the rest: 1 slice = 20 g, 1 each = 150 g for an item kept in grams. Each part saves with its own
        button. A unit a recipe uses can&apos;t be deleted until the recipe changes (the page names it), and an
        item in a recipe, or with units of its own, keeps how it is counted. Changing how an item is counted
        clears a usual unit that no longer fits (kg for an item now counted in ml). Deleting an item a recipe uses
        switches it off instead.
      </P>
      <H3>18. Suggested quantities from sales</H3>
      <P>
        <strong>Suggest</strong> on the order form works out how much of each line to order from one supplier: what
        sales are forecast to use until the supplier&apos;s <em>delivery after next</em> (the same weekday over the last
        four weeks, scaled by the covers booked), plus the buffer, less what is on hand and what is already on order to
        arrive before then, in whole packs up to the supplier&apos;s minimum. An item sales never used is filled up to its
        par. It needs Stock view, as it reads what is on hand (see Stock, Forecasts and suggested orders).
      </P>
      <ol className="list-decimal ml-5 space-y-2 text-sm text-muted-foreground mb-4">
        <li>Tap <strong>Suggest</strong>, then <strong>Suggest</strong> beside the supplier (each says when its order would arrive and what it has to last until). Grouped by supplier, each supplier&apos;s heading has its own Suggest.</li>
        <li>The lines that change are marked in blue with <strong>Suggested from sales</strong> (or <strong>up to par</strong>) and why in a sentence; <strong>How</strong> shows each day&apos;s forecast, the buffer, on hand and on order.</li>
        <li>Check each and tap <strong>OK</strong>, or <strong>OK all</strong>, or type another quantity. Nothing is saved until you do, and the order can&apos;t be placed while a suggestion waits. <strong>Put back</strong> returns the lines to what they were.</li>
      </ol>
      <P>
        Every suggestion is kept beside the line, with what you then order, so the report <strong>Suggested orders</strong>{' '}
        can show how often they were taken and how close the forecast came to what was really used. After a reload a line
        still says what was suggested, with <strong>Use</strong> to take it.
      </P>
      <InfoBox type="info">
        All of this can also be done by chat with Pepper (Ask Pepper): ordering, booking deliveries
        in, changing prices and importing a supplier's price list from a PDF or photo. Pepper understands
        suppliers' codes too ("order 20 MEA161", "add 2 POR106 to PO-00012"), gives the quick order codes
        for an order, checks the catalogue, switches several items off or on, updates a supplier's prices
        by their codes, brings a supplier's basket into an order and marks a price out of stock. See
        Pepper → Purchasing by chat.
      </InfoBox>
    </section>
  )
}
