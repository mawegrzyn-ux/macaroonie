// src/pages/help/till.jsx
// The Help page's "Till (POS)" section. Help.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, InfoBox, DataTable } from './parts.jsx'

export const id = 'till'
export const label = 'Till (POS)'
export const order = 380

// ── TILL (POS) ───────────────────────────────────
export function Section() {
  return (
    <section id="till" data-help="">
      <H2>Till (POS)</H2>
      <P>
        The till takes orders and payments at the venue: table service (tables, tabs, courses) and
        counter service (order numbers, pay first). It runs in Chrome or Edge on an Android or Windows
        tablet or PC, at the till address shown in <strong>Store tech → Tills</strong>. Each till keeps
        working without the internet: orders, payments and sign-ins carry on, and it catches up with
        the other tills when the connection is back.
      </P>
      <InfoBox type="info">
        Card payments go through a linked card machine (Dojo, Stripe or SumUp; see Card machines below) or
        a card machine of your own, recorded as Card. Printers are set up on the Printers page: a network
        printer prints through the venue hub (its own page, Venue hub), a printer plugged into a till or
        kitchen screen prints from that device (see Printers and the venue hub below).
      </InfoBox>

      <H3>Setting up (Store tech)</H3>
      <P>
        Everything the till, kitchen screens, kiosks and menu screens need is in the <strong>Store tech</strong>{' '}
        section of the main menu, one page per part. Pick the venue at the top of a page when you have
        more than one; order types, courses, till roles and designs are shared by every venue.
      </P>
      <H3>The Tech board</H3>
      <P>
        Store tech → <strong>Tech board</strong> shows a venue&apos;s kit on one page: the venue hub, tills,
        kitchen screens, kiosks, printers, card machines and menu screens. Each has a light (green working,
        amber or red needs looking at, grey nothing to judge yet), whether it is online, the last thing it
        did (a till&apos;s last activity, a kiosk&apos;s last order, a printer&apos;s last ticket, a card
        machine&apos;s last payment) and <strong>Open</strong> to its own page. A box at the top lists what
        needs someone, worst first. Above that, one light says whether Macaroonie itself is up. The board
        checks again every minute, or press <strong>Check now</strong>. A till or kiosk counts as online when
        it was heard from in the last five minutes, a menu screen in the last two and a half. Card machines
        don&apos;t say whether they&apos;re on, so their last payment is shown instead.
      </P>
      <ol className="list-decimal ml-5 space-y-2 text-sm text-muted-foreground mb-4">
        <li><strong>Order types</strong> (shared by every venue): Eat in, Take out, Delivery, Collection and any you add. They decide how a check is served, can change a dish's tax and show on tickets and kitchen screens.</li>
        <li><strong>Discounts</strong> (shared by every venue): the discounts the till offers by name, e.g. Staff meal 50% or NHS 10%, and whether each needs a manager every time (see Charges and discounts below).</li>
        <li><strong>Charges</strong>: the list of charges a till check can have (shared by every venue: a service charge, a packaging fee, a cup deposit on hot drinks), and for this venue which checks get which by themselves, by revenue stream and order type (see Charges and discounts below).</li>
        <li><strong>Order flows</strong> (shared by every venue): prompts that suggest dishes (Add a drink? when a burger goes on, Any dessert? at checkout), and dishes or charges that go on orders by themselves (a bag on take out orders), each on tills, self-order kiosks or online ordering, at the locations you pick (see Order flows below).</li>
        <li><strong>Revenue streams</strong>: groups of tills for reporting sales by place or device, e.g. Restaurant, Bar, Kiosk. Each picks the order types its tills offer (and for each, whether to ask for a customer name and a tent number: No, Ask or Must), which type new checks start as, its menus, whether its tables and tabs ask for <strong>guests (covers)</strong>, whether it numbers <strong>seats</strong> and whether it uses <strong>courses</strong> (see Guests, seats and courses below), whether a <strong>receipt</strong> prints when one of its checks is paid (<strong>Ask each time</strong>, <strong>Always print</strong> or <strong>Don&apos;t print</strong>) and how the till asks for a new order&apos;s order type, name and tent number (<strong>One screen</strong> or <strong>Two steps</strong>, see Asking for the order type, name and tent number below). A till can have its own of each in its window. A stream doesn't decide tax. Drag them into order. See Tax, Order Types &amp; Streams.</li>
        <li><strong>Courses</strong> (shared by every venue): Starters, Mains, Desserts, in the order they go to the kitchen. A course <strong>held by default</strong> waits to be fired when it goes with an earlier course.</li>
        <li><strong>Till roles</strong> (shared by every venue): what Server, Supervisor and Manager may do: void sent items, refund, comp, <strong>type a discount</strong> in (up to a %), open the drawer, reopen checks, take over other people's checks, change prices, move items between checks, see reports, close the day, approve for others.</li>
        <li><strong>Staff and PINs</strong>: give each person a till role and a 4 to 6 digit PIN. A PIN can start with 0. It can't be an easy one (1111, 1234), someone else&apos;s at the venue, or start the same way as someone else&apos;s (1234 beside 123456): the till signs in as soon as the digits typed match someone, so it couldn&apos;t tell those two apart. People come from the Staff page.</li>
        <li><strong>Venue hub</strong>: the small computer on the venue&apos;s network that prints the network and USB printers and, with <strong>Hub first</strong> on, keeps the tills, kiosks, kitchen screens and order ready boards trading with the internet down. Link it, see its state and updates, the USB printers plugged into it, and how to install one (see Set up the venue hub on a mini PC and Hub first below).</li>
        <li><strong>Printers</strong>: each printer, on the network, USB on the venue hub, or plugged into a till, kitchen screen or kiosk (see Printers and the venue hub below). Kitchen tickets print where the kitchen flow sends dishes: a <strong>Kitchen printer</strong> box in Kitchen screens.</li>
        <li><strong>Printing</strong>: which design each venue prints for kitchen tickets, receipts and bills. The designs themselves are made on Store tech → <strong>Receipt &amp; ticket designer</strong> (see Ticket and receipt designs below).</li>
        <li><strong>Card machines</strong>: your Dojo, Stripe or SumUp account and the card machines at the venue; each till and kiosk picks its machine (see Card machines below).</li>
        <li><strong>Receipts and payments</strong>: when the trading day starts, the name, address and VAT number on receipts, the ways to pay, tips, when staff are signed out, and what <strong>needs a manager every time</strong> (see Manager approvals below). Tax rates are set on Menus → Tax rates.</li>
        <li><strong>Cash Recon link</strong>: which till figures go into which Cash Recon fields when the day is closed (see End of day).</li>
        <li><strong>Floor plan</strong> (Store tech → Floor plan): add an area (e.g. Restaurant), tap tables to put them on it, drag them where they stand, drag the round corner to resize, Turn, Square / Round, and add walls, the bar, plants and labels. Save the area. Tables themselves are added on the Tables page.</li>
        <li><strong>Tills</strong>: open the till address on the tablet: it shows a six-letter code and a QR code. Tap <strong>Add a till</strong>, type the code, give it a name, table service or counter, and <strong>Add the till</strong>: the tablet sets itself up. Or scan the QR code with your phone and do the same in the installer app. <strong>New device</strong> on a till's row puts it on another tablet (type the code that tablet shows; the old one stops), and so does choosing <strong>One already here</strong> in Add a till. Removing a till signs it out; <strong>Bring back</strong> on the Removed line links it again with its settings. A till is <strong>table service</strong> or <strong>counter</strong>, never both, and has settings of its own: guests, seats and courses, no tables (only tabs), what Pay does with items not sent, rows to swipe on a phone, a Send button on a counter till, dish counts on its buttons (see A till&apos;s own settings below). Each till and kiosk gets its own block of counter <strong>order numbers</strong> when it is added (the first 1-99, the next 100-199, and so on), shown on its row; change it in the till's window (<strong>Order numbers</strong>, from and to). Two tills or kiosks at a location can't share numbers: the window says which one already uses them.</li>
        <li><strong>Till layouts</strong>: arrange the till&apos;s order screen yourself (where the order, the categories, the dishes and your own buttons go, and how big they are), pick the layout this venue&apos;s tills use, and give a till its own in its window (see Till layouts: arrange the order screen below).</li>
      </ol>

      <H3>Printers and the venue hub</H3>
      <P>
        Store tech → <strong>Printers</strong> lists the venue&apos;s printers. <strong>Add</strong> one, say whether it is for
        the kitchen or bar or for receipts, and how it is connected:
      </P>
      <ul className="list-disc ml-5 space-y-2 text-sm text-muted-foreground mb-4">
        <li><strong>On the network</strong>: a receipt or kitchen printer (Epson, Star and others) with a network cable or Wi-Fi. Give it a fixed address on the router and type it here (port 9100). The <strong>venue hub</strong> prints to it, and can use a <strong>backup printer</strong> when it doesn&apos;t answer.</li>
        <li><strong>USB on the hub</strong>: a USB receipt printer plugged into the venue hub&apos;s mini PC. Pick it from the printers the hub found (it lists them every minute). The hub prints to it like a network printer, can use a backup printer, and says how it is.</li>
        <li><strong>Plugged into a till or screen</strong>: a USB or Bluetooth printer set up as the printer of a till, kitchen screen or kiosk. That device prints its tickets through Chrome. Start Chrome with <strong>--kiosk-printing</strong> so it prints without asking each time. A kiosk&apos;s printer prints that kiosk&apos;s receipts only.</li>
      </ul>
      <P>
        For printers the hub prints to, pick the <strong>Printer language</strong>: <strong>Epson / ESC/POS</strong>{' '}
        (Epson and most others) or <strong>Star</strong> (Star printers such as the TSP650 and SP700, which speak Star
        unless someone switched them to ESC/POS). If tickets come out with a stray <strong>!</strong> and{' '}
        <strong>B</strong> on every line, or the £ sign is wrong, the language is the wrong one: change it and print the
        ticket again from <strong>Tickets</strong>. The hub picks the change up within a minute.
      </P>
      <P>
        The <strong>venue hub</strong> is a small program on a mini PC on the venue&apos;s network, next to the printers.
        It has its own page, Store tech → <strong>Venue hub</strong> (see Set up the venue hub on a mini PC below); the
        Printers page says which hub prints its printers, with a link to it. Every minute it tells Macaroonie how each of its printers is (ready,
        paper low, out of paper, cover open, not answering), shown on the printer&apos;s row. A printer&apos;s
        <strong> Tickets</strong> button lists the last day&apos;s tickets; one that didn&apos;t print can be printed again
        with <strong>Print again</strong>.
      </P>
      <P>
        <strong>Kitchen tickets</strong> print where the kitchen flow sends dishes: add a station of kind
        <strong> Kitchen printer</strong> in Kitchen screens, pick its printer and link it in the flow. Linked from the till
        and online orders it prints each order when it is sent (held courses under HOLD, then a FIRE ticket when the course
        is fired; a VOID ticket when a dish is voided); after a kitchen screen it prints when that screen bumps the dish
        (a ticket for the runner, say). Orders for later print when their time comes. <strong>Bills and receipts</strong> go
        to each till&apos;s receipt printer (Tills → Edit); a till with none, or with one plugged into it, prints them through
        its own browser.
      </P>
      <InfoBox type="warning">
        Kitchen printers only, no kitchen screens? Dishes that only reach printers count as done there, so online
        orders would show as ready at once. Switch off <strong>Mark them ready when the kitchen finishes</strong> in
        Kitchen screens → Online orders, and move them on from the Online orders board.
      </InfoBox>

      <H3>Set up the venue hub on a mini PC</H3>
      <P>
        The hub needs a small computer that stays on, on the same network as the printers. A fanless mini PC is best
        (for example an Intel N100 with 8 GB and a wired network port), with Ubuntu or Debian Linux; a Windows 10 or 11
        mini PC works too. Plug it into the router or switch with a cable, give it a fixed address on the router, and
        plug any USB receipt printers into it.
      </P>
      <DataTable
        head={['Step', 'What to do']}
        rows={[
          ['1. Install it', 'On the mini PC, open the address shown on Store tech → Venue hub (pos. and your web address, then /hub) and press Download the installer. On Windows, open the downloaded macaroonie-hub-setup.cmd; if Windows says it protected your PC, press More info, then Run anyway, and answer Yes when it asks to allow changes. On Linux, run sh ~/Downloads/macaroonie-hub-setup.sh in a terminal and type the password. It installs everything the hub needs and starts it with the computer. (The same box also has the one-line commands, under Or run a command.)'],
          ['2. Link it', 'When it finishes it shows a six-letter code (on Windows the hub\'s page opens with it). Tap Link a hub and type it, or scan the QR code on the hub\'s page with the installer app on your phone.'],
          ['3. Add its printers', 'Network printers: on the Printers page, Add, On the network, type the address. USB printers: the Venue hub page lists the ones plugged into the hub; tap Add it beside one (or on the Printers page, Add, USB on the hub, and pick it).'],
          ['4. Check it', 'On the Venue hub page, the hub\'s row shows its computer, version and a link to its page; on the Printers page, each printer\'s row says whether it is ready. Print a test ticket from the till.'],
        ]}
      />
      <P>
        <strong>On Windows.</strong> The hub runs as the Windows service <strong>Macaroonie hub</strong> (it is listed in
        Services): it starts with the computer before anyone signs in, Windows starts it again if it ever stops, and
        stopping it stops every part of the hub. The installer also stops the mini PC going to sleep on mains power and
        keeps its USB ports powered, so printers don&apos;t drop off. If Windows won&apos;t run the service (rare: Smart App
        Control on a new Windows 11 computer), the installer says so and runs the hub as a scheduled task instead. The
        <strong> Windows protected your PC</strong> warning only comes with the downloaded file: the one-line command in
        PowerShell (opened as administrator) doesn&apos;t show it.
      </P>
      <P>
        <strong>The hub&apos;s page.</strong> Open <strong>http://(its address):9180</strong> on any phone or computer on the
        venue&apos;s network (the link is on the hub&apos;s row). It shows the link code and QR code until it is linked, then
        whether it reaches Macaroonie, its version, each printer and how it is, the USB printers plugged in, and the
        last tickets (whether they printed, not what was on them).
      </P>
      <P>
        <strong>Updates.</strong> The hub installs new versions by itself at a quiet moment (nothing printing), then
        starts again in a second or two; tickets wait in the queue meanwhile. If a new version doesn&apos;t run, it goes
        back to the one before and says so on its row. Switch <strong>Update by itself</strong> off in the hub&apos;s
        settings to choose when: its row then shows <strong>Update now</strong> when a new version is out.
      </P>
      <P>
        <strong>A new or replaced mini PC.</strong> Run the command on it, then on the old hub&apos;s row tap
        <strong> New device</strong> and type the new code: it keeps the hub&apos;s name and its printers (pick the USB
        printers again if they moved). Removed in Store tech, a hub shows a new code by itself.
      </P>
      <P>
        <strong>Running the installer again.</strong> On a mini PC that is already a hub, the installer says which restaurant
        and venue it is linked to and asks what to do:
      </P>
      <DataTable
        head={['Choice', 'What happens']}
        rows={[
          ['1. Keep it (Enter alone)', 'The hub is updated and stays linked where it is.'],
          ['2. Link it to another restaurant or venue', 'The hub first sends Macaroonie anything it hasn\'t had yet (sales taken while the internet was down), then leaves its venue (that restaurant\'s Venue hub page shows it as not linked) and deletes that venue\'s files from the computer. Then it shows a new code: link it in the other restaurant\'s Store tech → Venue hub.'],
          ['3. Remove the hub', 'It leaves its venue the same way, then everything is removed from the computer.'],
        ]}
      />
      <P>
        If sales are still waiting and Macaroonie can&apos;t be reached, nothing changes: connect the mini PC to the internet and
        run the installer again (or type LOSE to go ahead and lose them). One mini PC is one hub for one venue: two
        restaurants at the same site each need their own. Without being asked: on Windows, run{' '}
        <strong>macaroonie-hub-setup.cmd switch</strong> (or keep, or uninstall) in a Command Prompt; on Linux, add{' '}
        <strong>--switch</strong>, <strong>--keep</strong> or <strong>--uninstall</strong> to the command.
      </P>
      <InfoBox type="info">
        Most USB receipt printers (Epson TM-T20, TM-T88, TM-m30, Star, POS-80 and similar) work. On Windows, install the
        printer&apos;s own driver first; it then appears in the hub&apos;s list by its Windows name. With Hub first on
        (below) the hub keeps printing with the internet down; with it off, tickets wait until the internet is back.
      </InfoBox>

      <H3>Hub first: keep trading with the internet down</H3>
      <P>
        With a venue hub linked, the location&apos;s tills, kiosks, kitchen screens and order ready boards send their
        orders to the hub over the venue&apos;s own network, and the hub sends everything on to Macaroonie. If the
        internet goes down the location carries on as normal: the tills still see each other&apos;s orders, the kitchen
        screens still get their tickets and bump them, the order ready boards still show numbers, tickets still print and
        the X report still adds up. When the internet is back the hub sends everything it kept, in order, and nothing is
        lost or counted twice. If the hub itself is switched off, the devices go straight to Macaroonie by themselves.
      </P>
      <DataTable
        head={['What', 'How']}
        rows={[
          ['Switch it on or off', 'Store tech → Venue hub: Hub first, then Save. It is on as standard once a hub is linked. Off, every device uses Macaroonie directly and the hub only prints.'],
          ['What devices need', 'Macaroonie Player, the Android app (version 1.3 or later), on each till, kiosk, kitchen screen and menu screen. A device in a web browser can\'t reach the hub (browsers block it from a secure page) and simply keeps using Macaroonie.'],
          ['How to tell it is working', 'The till\'s dot at the top says Live · venue hub, or Venue hub · internet down (still green). The kitchen screen\'s bar says the same. On the till, Settings shows the hub\'s address. In Store tech, the hub\'s row says how many devices use it and whether everything has gone to Macaroonie.'],
          ['What needs the internet', 'Card machine payments and refunds, loyalty rewards, receipts by email or QR code, online and GloriaFood orders, and changes made in the admin (a new price, a new PIN) until the hub picks them up (within half a minute).'],
          ['A change Macaroonie refused', 'Rare: two tills changed the same order at once, one through the hub, one straight to Macaroonie. The hub\'s row in Store tech counts them; the till that made the change lists it under Not saved, as for a till that was offline.'],
        ]}
      />
      <InfoBox type="info">
        Give the hub&apos;s mini PC a fixed address on the router and a network cable, and keep tablets on the same
        network (not a guest Wi-Fi that keeps devices apart). A second hub at the same location stands by: it takes over
        if the first hasn&apos;t been seen for 15 minutes.
      </InfoBox>

      <H3>Ticket and receipt designs</H3>
      <P>
        Two pages decide how printed kitchen tickets, receipts and bills look. Store tech →{' '}
        <strong>Receipt &amp; ticket designer</strong> holds the designs (new, copy, delete, and the designer
        itself); Store tech → <strong>Printing</strong> says which design prints where. Each page has a card
        that opens the other. Designs belong to the whole company; each venue picks which one it prints and can
        change a design&apos;s words or leave parts out. Without a design, tickets print the usual way.
      </P>
      <ul className="list-disc ml-5 space-y-2 text-sm text-muted-foreground mb-4">
        <li><strong>What prints where</strong> (Store tech → Printing): for <em>Kitchen tickets</em>, <em>Till receipts and bills</em> and <em>Kiosk receipts</em>, pick a design for the whole company (<strong>Company</strong>) and, if this venue needs another, for the venue picked at the top of Store tech. Kiosk receipts print like till receipts until you pick a kiosk design.</li>
        <li><strong>New design</strong> (Store tech → Receipt &amp; ticket designer) starts from the usual layout. A design is a list of parts from top to bottom: drag the grips to change the order, tap a part to change it, <strong>Add a part</strong> for more, and the bin (in the part&apos;s box) to take one out. The dishes, and a receipt&apos;s total, always stay.</li>
        <li><strong>Kitchen ticket parts</strong>: Station name; <strong>Order title</strong> (what prints big: the table or order number as usual, or the tent number, the table, the order number or the customer&apos;s name; an order without it prints the usual title), its size and white on black; <strong>Details</strong> (order type, tent, table, name, order number, covers, server, check number, time sent; plain or a white-on-black band); <strong>Dishes</strong> (normal or tall, seat numbers on or off); your own <strong>Text</strong>; <strong>Line</strong>; <strong>Space</strong>.</li>
        <li><strong>Receipt parts</strong>: your name, address and VAT number (from Receipts and payments); a <strong>heading</strong> with different words on a receipt and on a bill (e.g. VAT RECEIPT / YOUR BILL); <strong>Order title</strong> (a big order number or tent, handy for counter and kiosk orders); <strong>Details</strong> (table, check, served by, covers, order type and name, tent, date and time); <strong>Dishes</strong> (with options and meal parts priced under each, or one line each); <strong>Totals</strong>; <strong>VAT</strong>; <strong>Payments</strong>; a <strong>footer</strong> with its own words on receipts and bills; Text; Line; Space.</li>
        <li><strong>One venue&apos;s own version</strong>: pick <em>Only at</em> a venue at the top of the design. Untick a part to leave it out there, and change the words of text, heading and footer parts for that venue (<strong>Use the words for all locations</strong> puts them back). Everything else is set for all locations.</li>
        <li>The preview prints a made-up order (a table order, a counter order with a tent, a void; a receipt, a bill, a counter receipt) laid out in the printer&apos;s columns: pick 58 mm or 80 mm paper. Save when you&apos;re done; tills and kiosks get the change straight away.</li>
        <li>The receipt and bill footers that used to be in Receipts and payments are now in a design called <strong>Receipt</strong>, with each venue&apos;s own words.</li>
      </ul>

      <H3>Card machines</H3>
      <P>
        A till or kiosk can send the amount straight to a card machine: staff don&apos;t type it on the machine,
        and the payment goes on the bill only once the machine approves it. Machines from{' '}
        <strong>Dojo</strong>, <strong>Stripe</strong> (Stripe Terminal readers such as the WisePOS E and S700)
        and <strong>SumUp</strong> (the Solo) work this way. Store tech → <strong>Card machines</strong>:
      </P>
      <ol className="list-decimal ml-5 space-y-2 text-sm text-muted-foreground mb-4">
        <li><strong>Add an account</strong> (an owner or admin): the provider, a name, and the key from the provider (Dojo: the secret key from the developer portal; Stripe: a secret key, or a restricted key with Terminal and PaymentIntents; SumUp: an API key). The key is checked with the provider before it is saved and is never shown again: the list shows only its last four characters. Test keys work too (Stripe test mode, Dojo sandbox) and are marked Test.
          For Stripe there is a simpler way: <strong>Our connected Stripe account</strong>, the same Stripe account online orders are paid to (connect it here or in Ordering setup). It needs no key, and card machine sales go to that account.</li>
        <li><strong>Add a card machine</strong>: pick the account, then the machine from the provider&apos;s list, or type the code a new machine shows (a SumUp Solo: Connections, API, Connect; a new Stripe reader: its registration code and the Stripe location; <strong>Make a location from this venue&apos;s address</strong> makes one from the address in the venue&apos;s website details). The <strong>Test card machine</strong> needs no account and takes no money: the till shows Approve and Decline instead of waiting for a card. Use it for training only, as its payments are recorded like real ones.</li>
        <li>Pick each till&apos;s and kiosk&apos;s machine in its own settings (Tills or Kiosks, the pencil): <strong>Card machine</strong>.</li>
      </ol>
      <P>
        On the till, <strong>Pay</strong> then <strong>Card machine</strong> (with a tip if tips are on) and{' '}
        <strong>Send to the card machine</strong>. The till waits while the guest pays; <strong>Cancel on the card
        machine</strong> stops it. Declined or cancelled: <strong>Try again</strong> or pay another way. A Dojo machine
        may ask staff to check a signature: tap <strong>Signature matches</strong> or <strong>It doesn&apos;t match</strong>.
        Closing the Pay window doesn&apos;t stop a payment: open Pay again and the till picks it up. If the till lost its
        connection after the machine approved, Pay offers <strong>Add it to the bill</strong>.
      </P>
      <ul className="list-disc ml-5 space-y-2 text-sm text-muted-foreground mb-4">
        <li><strong>Taking a card machine payment off</strong> (the X beside it, needs the void permission or a manager) first sends the money back to the card, then takes it off the bill.</li>
        <li><strong>Refunds</strong> on a closed check (Closed, Refund) can go back to the card: pick <strong>Card machine</strong> as the way to refund.</li>
        <li>Card machines need the internet. Without it, take the card on the machine by itself and tap <strong>Card</strong> as before.</li>
        <li>The <strong>Card payments</strong> list on the Card machines tab shows every payment and refund with the machine, the till and the card (e.g. Visa •••• 4242). Payments that went through but aren&apos;t on any bill are flagged: add them on the till (Pay offers it) or refund them in the provider&apos;s own app. Till reports staff can see the list too.</li>
        <li>Cash Recon: venues that counted Card into a takings field now count Card machine there too.</li>
      </ul>

      <H3>Device addresses and disconnecting</H3>
      <P>
        Each kind of device has its own address, so each installs as its own app and keeps its own
        pairing: tills at <strong>pos.macaroonie.com</strong>, kitchen screens at{' '}
        <strong>kitchen.macaroonie.com</strong> (kds.macaroonie.com goes there too), self-order kiosks at{' '}
        <strong>kiosk.macaroonie.com</strong> and menu screens at <strong>screens.macaroonie.com</strong>.
        Store tech shows the right one on each tab and in the Add window. The code a device shows can
        only become that kind of device: a kitchen screen's code typed in Add a kiosk is refused and says
        so.
      </P>
      <DataTable
        head={['Device', 'Where Disconnect is', 'What happens']}
        rows={[
          ['Till', 'Till tab → Disconnect this till (a manager confirms)', 'The tablet goes back to the pairing screen. Not while sales are still waiting to be sent: get it online first.'],
          ['Kitchen screen', 'The settings button (bottom right) → Disconnect this screen', 'Back to the pairing screen. Taps not sent yet are lost, and the screen says how many first.'],
          ['Kiosk', 'Five quick taps in the top-left corner of the start screen → Disconnect this kiosk', 'Back to the pairing screen. Paid orders still waiting to reach the till are sent first; without the internet it waits.'],
          ['Menu screen', 'Five quick taps on the screen (or five presses of OK on a remote) → Disconnect this screen', 'It shows a new code. In Screens, Add screen offers it under One already here, so it keeps its boards.'],
        ]}
      />
      <P>
        A disconnected device keeps its name and settings in Store tech (or Screens) and shows{' '}
        <strong>Not linked</strong>: press <strong>Link a device</strong> on its row and type the code the
        device shows (the same device or another one). To take a device away, remove it in Store tech
        instead.
      </P>

      <H3>Reusing a till, kitchen screen, kiosk or menu screen</H3>
      <P>
        A device showing a new code (after Disconnect, a reset or a new tablet) doesn&apos;t need a new till
        (kitchen screen, kiosk, hub, menu screen). Wherever you type or scan the code (the Add window in
        Store tech, Add screen on the Menu screens page, or the installer), choose{' '}
        <strong>One already here</strong> under <strong>Link it as</strong> and pick it: it keeps its name,
        short code and settings (a menu screen keeps its boards and wall place), so reports and kitchen
        flows that name it carry on. When exactly one of that kind isn&apos;t linked, it is already picked
        and the button says <strong>Link as</strong> its name; pick <strong>A new till</strong> (and so on)
        for a new one. Picking one that is still linked moves it to the new device and the old one stops.
      </P>
      <P>
        Removed devices are listed under the list as <strong>Removed</strong>, each with a{' '}
        <strong>Bring back</strong> button, and under One already here. Bringing one back links the code to
        it with its name, short code and settings; any setting pointing at something deleted since (a
        printer, a card machine, a station, a kiosk design) is cleared, so check its settings afterwards.
      </P>
      <InfoBox type="tip">
        A kitchen screen or kiosk set up before they had their own address shows a yellow bar:{' '}
        <strong>Move this kitchen screen</strong> (or kiosk). One tap sends what is waiting, opens its own
        address and pairs it there by itself, as the same device. Then change the start page of the
        device&apos;s browser (or kiosk browser such as Fully Kiosk) to the new address. If the old address
        is opened again, it says where the device went and opens it.
      </InfoBox>

      <H3>The menu on the till</H3>
      <P>
        The till uses your menus from the Menus page. In a section's panel, <strong>Till</strong> sets its
        course and button colour. In a dish's panel, <strong>Till</strong> sets a shorter kitchen name and
        its own course or colour. Combos (see Menus &rarr; Combos) show on their button as &ldquo;Combo
        from £11.00&rdquo;. Save the menu as usual.
      </P>
      <P>
        A till shows the menus of its revenue stream that are on now, by Menus &rarr;{' '}
        <strong>Menu times</strong> (the Tills column), and changes by itself as their times start and end:
        at 15:00 the lunch dishes go and at 17:00 the dinner ones come. The categories of every menu on now
        show together. When none of them is on, the till shows all of them, so it can always sell. To show
        other menus for a while, open <strong>More &rarr; Menus</strong> (on a counter till, the{' '}
        <strong>Menus</strong> button beside the order; a till layout can have a Menus button too) and tap the
        menus to show. That pick holds until the menus on now change (lunch ends), then the till follows the
        menu times again; <strong>Follow the menu times</strong> goes back straight away. The pick is for that
        till only.
      </P>
      <P>
        Tapping a combo opens its steps one under another, with a chip for each at the top (red until
        it&apos;s done; tap one to jump to it). A step behind a button shows as &ldquo;+ Sauce
        pot&rdquo;; a step that picks itself shows &ldquo;Included&rdquo;. A dish picked in a step asks
        its options under it, as the deal asks them (Menus &rarr; Options in a meal deal). Add stays off until every step needed is done, and says what&apos;s
        missing. On the check the combo shows its picks under it, and kitchen tickets and kitchen
        screens print the combo&apos;s name with each part under it, each part going to its own
        station.
      </P>
      <P>
        To turn a dish already on the order into a combo, tap the line and pick the combo under{' '}
        <strong>Make it a combo</strong> (only before it&apos;s sent): the combo opens with that dish
        picked and its options kept, as far as the deal asks them (a flavour or dip the deal leaves
        out is dropped, so the till may ask again), and the dish&apos;s line is replaced. Automatic
        combos apply by themselves (see Menus &rarr; Combos).
      </P>
      <P>
        On <strong>Menus → Variant groups</strong>, tick <strong>Offer No, Light, Extra and On the side</strong>{' '}
        for toppings and sauces (No and Light are free; Extra and On the side charge the option's price),
        and use <strong>Then ask</strong> next to an option to ask another group when it's picked (e.g.
        Steak, then Cooking). Promotions can apply online, on the till, or both (<strong>Where</strong> in
        the promotion).
      </P>

      <H3>Till layouts: arrange the order screen</H3>
      <P>
        Store tech → <strong>Till layouts</strong> lets you arrange the till&apos;s order screen yourself: where the
        order, the categories, the dishes and your own buttons go, how big their buttons are, and where a
        dish&apos;s choices show while it is being added. Layouts are shared by every venue. Each venue picks the
        one its tills use (at the top of the page) and the one they use on a phone (<strong>On phones</strong>, a layout made for a phone), and a till can have its own in its window on Tills
        (<strong>Screen layout</strong>: As the venue, The standard screen, or a layout). Tills with no layout keep
        the standard screen.
      </P>
      <ol className="list-decimal ml-5 space-y-2 text-sm text-muted-foreground mb-4">
        <li><strong>New layout</strong>: give it a name and start from <strong>Like the standard screen</strong>, <strong>Quick service</strong> (categories down the side, a dish&apos;s choices over the dishes, paying buttons along the bottom), one of the three <strong>Phone</strong> starting points (see Phone layouts below) or a copy of one you have. It opens in the designer.</li>
        <li>The screen is a grid of cells (<strong>Cells across</strong> and <strong>Cells down</strong> under Layout). Each <strong>zone</strong> takes a block of cells: drag it to move it, drag its corner to resize it, or tap it and use the − and + of <strong>From the left</strong>, <strong>From the top</strong>, <strong>Wide</strong> and <strong>High</strong>. <strong>Add a zone</strong> puts a new one in the space left.</li>
        <li><strong>The till&apos;s top bar on the order screen</strong> (under Layout): switched off, the order screen (a check, and the counter) takes the whole screen and the till menu moves into <strong>More</strong>: the till&apos;s pages (Floor, Counter, Closed, Reports, Till), <strong>Sign out</strong>, and the location, till, who is signed in, the time and the connection. A counter till also has a <strong>Till menu</strong> button on its New order panel. The till&apos;s other pages (Closed, Reports, Till) keep the bar. You can also add <strong>Till menu</strong> and <strong>Sign out</strong> buttons to a Buttons zone.</li>
        <li>The zones: <strong>Order</strong> (the check with More, Send, Bill and Pay; on a counter till before an order, New order and the orders waiting), <strong>Categories</strong> and <strong>Dishes</strong> (up to four of each), <strong>A category&apos;s dishes</strong> (up to eight), <strong>Buttons</strong> (up to eight zones of your own buttons), <strong>Dish choices</strong>, <strong>Seat and course</strong>, <strong>Menus</strong>, <strong>Pop-up</strong> (see Pop-ups in a till layout below) and <strong>Label</strong> (words on the screen, up to twelve). Only Dish choices, pop-ups and zones shown as a pop-up (see Phone layouts below) can sit over other zones. Zones over each other, or no Order zone, show in red, and Save waits until they are fixed.</li>
        <li><strong>Order</strong>: <strong>Text size of the order</strong> (its items and totals), and <strong>Its own buttons</strong>: tap Back, Cancel order, More, Send, Bill or Pay to leave it out when a Buttons zone does its job instead (the buttons left share the bar under the order). A button left out with no button doing its job is listed in amber (Cancel order and Print bill are still in More). <strong>Colours</strong>: pick Cancel order, More, Send, Bill or Pay, then a colour (None keeps its usual look); the preview on the canvas follows.</li>
        <li>Each zone with buttons has its own grid: <strong>Buttons across</strong> and <strong>Buttons down</strong> set how big they are (fewer makes them bigger), with the <strong>Text size</strong> and <strong>Bold</strong>. <strong>When more than fits</strong>: <strong>Scroll</strong> (down, or across in a zone one button high), <strong>Pages</strong> (arrows under the zone), <strong>More button</strong> (the rest open from a More button in the last place) or <strong>Hide the rest</strong>. <strong>Laid out as</strong>: <strong>Grid</strong> (buttons side by side) or <strong>List</strong>: one button a row, its words on the left and its second line (a dish&apos;s price, Sold out, a menu&apos;s times) on the right, with <strong>Rows showing</strong> for how tall the rows are. A list suits a narrow zone or a phone; on the till a row is never under a finger high.</li>
        <li><strong>Words on the buttons</strong> (each zone with buttons): <strong>Across</strong> (Left, Centre or Right) and <strong>Up and down</strong> (Top, Middle or Bottom) put the words where you want them on that zone&apos;s buttons, and the canvas follows. At the top, a second line (a dish&apos;s price, a choice&apos;s extra price, Sold out) stays at the bottom of the button; in the middle or at the bottom it goes just under the words. A choice&apos;s minus (one less) sits in the corner away from the words. The group headings in a Dish choices zone stay on the left. The Order and Seat and course zones have no such setting: their buttons are as wide as their words.</li>
        <li><strong>Categories</strong>: <strong>All of the till&apos;s menus</strong>, or <strong>Pick them</strong> to choose which sections show, in your order (drag them; X takes one out). <strong>Dishes</strong> shows the dishes of the category tapped, with a search box and prices if you want them. <strong>Dishes left out</strong>: pick a dish under <strong>Leave out a dish</strong> and it never shows in the Dishes zone, its search included (X puts it back). It stays on the menu everywhere else: in a category&apos;s dishes zone, on a dish button, on kiosks and online.</li>
        <li><strong>Several Categories and Dishes zones</strong> (up to four of each): food and drinks side by side, each with its own categories and dishes. Each Dishes zone <strong>Follows</strong> one Categories zone (in the Dishes zone&apos;s settings, once the layout has more than one) and shows the dishes of the category open there; a new Dishes zone follows a Categories zone nothing follows yet. On the till each Categories zone keeps its own category open: tapping Sides changes the food dishes and leaves the drinks as they are. A Categories zone&apos;s settings list the Dishes zones that follow it under <strong>Its dishes show in</strong> (tap one to open it), with a <strong>Make Dishes 2 follow it</strong> button for each of the others. A Categories zone no Dishes zone follows, and two Dishes zones following the same one (they would show the same dishes), are listed in amber: tap the note to open the zone. With several zones of a kind, the zone list, the canvas and the notes number them (Categories 1, Categories 2).</li>
        <li><strong>A category&apos;s dishes</strong> (up to eight in a layout): the dishes of one category you pick, always on screen whatever the Categories zone shows: a Drinks zone beside the dishes, a Sides zone under them. Pick the <strong>Category</strong> (the venue&apos;s menus&apos; categories, by menu); its dishes are listed under it, and tapping one leaves it out of this zone (crossed out; tap again to put it back, or <strong>Show them all</strong>). Picking another category starts with every dish shown. <strong>Prices on the buttons</strong> on or off, and the grid, text, words and When more than fits settings of any zone with buttons. The zone list names it after its category (Dishes: Drinks); while it has no category an amber note says so (tap it to open the zone). A till whose menus don&apos;t have that category shows the zone empty; the category is found on the menus on now first, else on any of the till&apos;s menus. <strong>Dish buttons&apos; colour</strong> colours its dishes&apos; buttons (None keeps the till&apos;s own look), with <strong>Words on the dish buttons</strong> in white, black or a colour of your own (Auto: black or white, whichever reads on the colour). <strong>The category&apos;s name above the dishes</strong> puts the category&apos;s name over its buttons, in <strong>Its text size</strong> and <strong>Its colour</strong> (None: black, or white on a dark background).</li>
        <li><strong>Label</strong> (up to twelve in a layout): words on the screen, a heading over a zone, an offer, a note for staff. Type the <strong>Words</strong> (up to 200 letters; a new line starts a new line on the till), then the <strong>Text size</strong>, <strong>Bold</strong>, the <strong>Colour</strong> (None: black, or white on a dark background) and <strong>Where the words sit</strong> (Across and Up and down). A Label zone with no words yet is listed in amber (it saves). Nothing happens when a Label is tapped.</li>
        <li><strong>Look</strong> (at the end of every zone&apos;s settings): <strong>Background</strong> (every zone but the Order, which keeps its white panel; None is white; words on a colour turn black or white by themselves so they read, and buttons keep their own colours), <strong>Border</strong> (None, Thin, Bold or Dotted, with its colour; None: the till&apos;s dark ink) and, on a zone with buttons, <strong>Buttons&apos; border</strong>: <strong>Standard</strong> (each button keeps its own), None (no border on its buttons), or Thin, Bold or Dotted on every button in the zone, with a colour (None: each button keeps its own border colour).</li>
        <li><strong>Behind the zones</strong> (under Layout): the till&apos;s own colour behind the zones, in the gaps between them and in any cells no zone takes. None keeps the till&apos;s usual grey.</li>
        <li><strong>Duplicate</strong> (at the top of a zone&apos;s settings, for the kinds a layout can have several of: Categories, Dishes, a category&apos;s dishes, Buttons, Dish choices, Pop-up and Label): a copy of the zone with all its settings and buttons. It goes in the first free space of its size (else a smaller free space, else on top of the zone it copies, shown in red until you move it); a pop-up or Dish choices zone goes a cell down and to the right. A copied Dishes zone follows a Categories zone nothing follows yet, and a copied Dish choices zone shows the other kind of choices (Must pick or Optional), so the two split them. A pop-up&apos;s copy is named with (copy). With as many of that kind as a layout takes (or 50 zones), Duplicate is greyed and says why.</li>
        <li><strong>Buttons</strong>: <strong>Add a button</strong> and pick what it does: a dish, Exact cash, Exact card, Pay by (a way to pay), Pay, Print bill, Last receipt, a discount from your list, Discount, Send, Fire a course, More, Guests, Order type, Name, Tent number, Allergy, Table, Split / move items, Merge checks, Charges, a charge from your list, Offers, Loyalty, Item not on menu, Cancel order, No sale (open drawer), Menus (which menus show), Back to tables / orders (off the order: on the till it reads <strong>Back to tables</strong>, or <strong>Back to orders</strong> on a till without tables; give it your own words if you like), Till menu, Sign out or Open a pop-up (pick which). Tap a button in the list to change its words, colour and size (it can take several places across or down); drag the list to change their order. The canvas turns to the page the button you are changing is on.</li>
        <li><strong>Dish choices</strong>: shows a dish&apos;s choices on the screen, instead of in a window, while it is being added: <strong>All choices</strong> in one zone, or two zones, one <strong>Must pick</strong> and one <strong>Optional</strong>. Each draws over <strong>Its own space</strong> (the zones under it) or <strong>The whole screen</strong>. The zone with the must-pick choices has the dish&apos;s name and description, the quantity, Cancel, Add and <strong>Note &amp; more</strong> (the choices window, for a note, allergies, seat, course or price). Each group of choices (Size, Flavour) starts on a row of its own under its heading, its choices in the menu&apos;s order. Without a Dish choices zone, choices open in a window as on the standard screen. While the dish is being added it shows in the Order zone too, at the end of the order (on a counter till before the order starts, at the top of its panel): a dashed line saying <strong>Being added: not on the order yet</strong>, what is picked so far, and a dashed placeholder for each choice still to pick (<strong>Size to be picked</strong>; <strong>Sauces: 2 more to be picked</strong> when some are picked). Tap a placeholder and that choice is brought into view in the choices zone and lit for a moment. Once everything is picked the line says <strong>Ready: tap Add to put it on the order</strong> with its price. Cancel takes the line away; nothing is on the order until Add.</li>
        <li>What a Dish choices zone <strong>Shows</strong>: <strong>The dish&apos;s name</strong>, <strong>The dish&apos;s description</strong> (both on the must-pick zone) and <strong>Prices on the choices</strong>, each on or off; the Add button always shows the total, and a choice that has sold out still says so. <strong>Add the dish on its last must-pick tap</strong>: when a must-pick choice takes one pick (a size, a sauce) and nothing else is left to pick, tapping it puts the dish on the order straight away, with no Add tap. Optional choices tapped before it go on with it, so tap the extras first and the must-pick choice last.</li>
        <li><strong>More picks, more dishes</strong> (on the must-pick zone): a choice that takes one pick (a protein, a size) can take more, and each pick is one more dish. Pad Thai with <strong>Chicken</strong> and <strong>Prawn</strong> tapped adds two Pad Thai, one of each; tapping Chicken again makes it <strong>2 x Chicken</strong> (two chicken ones), and the minus takes one off. Another group with one pick goes on every dish (Mild on both); give it a pick for each dish to pair them in order (Chicken and Mild, Prawn and Hot), and the till says when the numbers don&apos;t match. The Add button says how many dishes and their total, and the quantity is for each dish. Each dish goes on the order as its own line (the same dish twice joins one line). Note &amp; more waits until they are added (change one on the order). It doesn&apos;t work with <strong>Add the dish on its last must-pick tap</strong>, which adds the dish on its first pick: switching on one switches off the other. It covers the dish&apos;s own choices, not a meal deal&apos;s steps or the choices a pick opens (Steak: Cooking).</li>
        <li><strong>Seat and course</strong>: <strong>Shows</strong> <strong>Seat and course</strong>, <strong>Seat only</strong> (dishes go to their usual course) or <strong>Course only</strong> (dishes go to the whole table, Shared).</li>
        <li><strong>Menus</strong> (one per layout): the till&apos;s menus as buttons, to switch menu with one tap instead of More → Menus. <strong>Which menus</strong>: <strong>All of the till&apos;s menus</strong> (those its revenue stream offers, in menu order), or <strong>Pick them</strong> and drag them into your order (X takes one out, Add a menu puts one back). A till only shows the picked menus its revenue stream offers; with none of them on a till, it shows all of its menus. A menu switched off on the tills (Menus → Menu times) never shows, and the designer says so. <strong>Tapping a menu</strong>: <strong>Shows just that menu</strong>, or <strong>Adds it or takes it off</strong> (several menus at once, their categories one after another; one always stays). <strong>Menu times button first</strong> goes back to the menus on now and is lit while the till follows them; <strong>Each menu&apos;s times under its name</strong> shows the till times from Menu times. A menu picked here holds until the menus on now change (lunch ends), like a pick in More → Menus; picking what the menu times show anyway goes back to following them. It has the grid, text, words and When more than fits settings of any zone with buttons.</li>
        <li>Dish choices zones and pop-ups are drawn as dashed outlines over the zones under them, as the till looks between dishes: taps go through to the zone under the outline, and the outline&apos;s name tab (top right for Dish choices, bottom left for a pop-up) selects it or drags it, even with another zone selected. Selected, it fills. <strong>Show a dish being added</strong> fills them all, as on the till while a dish is being added. Pick the screen to preview on beside it (tablets, a big screen, an upright tablet; phones for a layout made for a phone); the canvas uses the dishes, discounts and ways to pay of the venue picked at the top.</li>
        <li><strong>Save</strong>, or <strong>Discard</strong> to go back to what was saved. Tills pick up a saved layout within moments.</li>
      </ol>
      <P>
        On the till, buttons that need an order are greyed until there is one (a counter till before its first
        dish). <strong>Exact cash</strong> and <strong>Exact card</strong> pay what is left at once;{' '}
        <strong>Last receipt</strong> prints the last receipt this till took; a dish button adds the dish (on a
        counter till it starts the order); <strong>Till menu</strong> opens the till menu and{' '}
        <strong>Sign out</strong> signs out, with or without an order. A button whose dish, discount or way to pay the till doesn&apos;t have
        stays greyed. The category open and the page each zone is on stay put while the till runs. Deleting a
        layout puts the venues using it back on the standard screen, and the tills that picked it back on their
        venue&apos;s.
      </P>

      <H3>Pop-ups in a till layout</H3>
      <P>
        A pop-up is a set of buttons that only shows when a button opens it: Drinks, Sauces, Payments,
        anything needed now and then. It opens over the part of the screen it was placed on, and the rest
        of the screen waits behind it until it closes.
      </P>
      <ol className="list-decimal ml-5 space-y-2 text-sm text-muted-foreground mb-4">
        <li>In the designer, <strong>Add a zone</strong> → <strong>Pop-up</strong>. It goes over the middle of the screen; move and resize it like any zone. It can sit over other zones and over other pop-ups (up to eight in a layout).</li>
        <li>Give it a <strong>Name</strong>: it shows on its window controls and on the buttons that open it (unless a button has its own words).</li>
        <li>Add its buttons as in a Buttons zone (dishes, Exact cash, a discount, a charge and so on), with the same grid, text and When more than fits settings. <strong>Close the pop-up</strong> is a button only pop-ups offer: it closes it by hand.</li>
        <li><strong>Opened by</strong> lists the buttons that open it (tap one to go to its zone). <strong>Add a button that opens it</strong> puts one in a Buttons zone or another pop-up (pick which when there are several). In a Buttons zone you can also add one yourself: <strong>Open a pop-up</strong>, then pick the pop-up. A button that can&apos;t be tapped on the till is marked in red: <strong>doesn&apos;t fit</strong> when its zone is full and its When more than fits is Hide the rest (tap it and make room there: fewer or smaller buttons, more across or down, or Pages, Scroll or a More button instead), <strong>can&apos;t be reached</strong> when it sits in a pop-up that nothing opens. A pop-up with no button that works gets a note under Layout.</li>
        <li><strong>Covers</strong>: <strong>Its own space</strong> (the cells it is placed on) or <strong>The whole screen</strong> (it takes the screen over while it is open, which suits a phone; nothing is outside it to tap, so it closes with its X, a Close the pop-up button or after a button is used).</li>
        <li><strong>Looks</strong>: <strong>Border and shadow</strong>, and <strong>Window controls</strong> (a bar with its name and an X that closes it). With both off, its buttons sit on the screen as if they were part of it.</li>
        <li><strong>Closes</strong>: <strong>With a tap outside it</strong> (that tap only closes it: nothing under it is pressed), <strong>After any of its buttons is used</strong>, with its X, or with a Close the pop-up button. Something has to close it: with none of these, the designer says so in red and Save waits.</li>
      </ol>
      <P>
        On the till a pop-up opens with or without an order on screen, and stays open while dishes are
        added from it (on a counter till its first dish starts the order and the pop-up stays open). A
        dish with choices puts it aside while the choices show; it comes back after. A button in a pop-up
        that opens another pop-up shows that one instead. Taking a pop-up out of the layout takes the
        buttons that open it too.
      </P>

      <H3>Which buttons get used: taps on a till layout</H3>
      <P>
        Tills count how often each button of their layout is tapped: the categories, the menus, the dishes and
        your own buttons (the order&apos;s Send, Bill and Pay are in the till&apos;s activity instead, and a
        dish&apos;s choices aren&apos;t counted). In the layout designer press <strong>Taps</strong>: every
        button shows its count and a colour from pale yellow (few) to deep red (the most), and a button never
        tapped is grey. The panel on the right picks <strong>7, 30 or 90 days</strong>, <strong>every till</strong>
        or one, and (for those who can see Till reports) <strong>everyone</strong> or one person, with the total
        and the most tapped buttons; tap one to open its zone. Use it to move what staff reach for most to where
        it is easiest to reach, and to take out what nobody uses. <strong>Hide taps</strong> goes back to the
        plain preview.
      </P>
      <ul className="list-disc ml-5 space-y-2 text-sm text-muted-foreground mb-4">
        <li>What is counted: one number per day, till, person signed in, and button. Not what was on the order and not the time of a tap. Counts are kept for 90 days.</li>
        <li>The till keeps its counts while it is offline and sends them when it can (every minute, and when it is put away).</li>
        <li>The preview shows each zone&apos;s first page, and a Dishes zone the first category&apos;s dishes; the list of most tapped has the rest.</li>
        <li>Reports: <strong>Till buttons tapped</strong> (by layout and button, then by till, person or day), <strong>Till activity by person</strong> and <strong>by till</strong> (orders opened, dishes added, taken off and voided, sends, discounts, bills, payments, refunds and the drawer opened with no sale, from the till&apos;s own record) and <strong>Kitchen screens: taps by screen</strong> (dishes done and ticked off, bumps, tickets brought back, remakes, rushes, collected). Figures about people need Till reports.</li>
      </ul>

      <H3>Phone layouts: the till on a phone</H3>
      <P>
        A till works on a phone too: open the till address in the phone&apos;s browser (or the Android app)
        and link it like any till. A phone is too narrow for the order, the categories and the dishes side
        by side, so a phone layout keeps the dishes on screen and puts the rest behind buttons: the order
        opens over the whole screen from a button that says how many items it holds and what they come to.
        You don&apos;t have to set anything up: a till on a phone-sized screen shows a built-in phone screen
        by itself. Make your own when you want it arranged differently.
      </P>
      <ol className="list-decimal ml-5 space-y-2 text-sm text-muted-foreground mb-4">
        <li><strong>New layout</strong> has three phone starting points. <strong>Phone: counter service</strong>: the categories across the top, the dishes as a list with a search box, and a bar at the bottom with the order&apos;s button, Pay, More and Menu. <strong>Phone: table service</strong>: the same with Send instead of Pay and a <strong>Seat &amp; course</strong> button. <strong>Phone: categories behind a button</strong>: the dishes take the screen and a Categories button opens the categories as a list, which closes when one is picked. All three have no top bar (the Menu button opens the till menu: the till&apos;s pages and Sign out).</li>
        <li><strong>Made for</strong> (under Layout): <strong>Tablet or screen</strong> or <strong>Phone</strong>. A layout made for a phone is previewed on a phone in the designer (three phone sizes beside the canvas), is marked Phone in the list, and is the only kind a phone-sized till draws. Tablets and bigger screens can use a phone layout too.</li>
        <li><strong>On the screen</strong> (the Order, Categories, Menus, Dishes, A category&apos;s dishes and Seat and course zones): <strong>Always</strong>, or <strong>As a pop-up</strong>: the zone leaves the screen and shows only when a button opens it. Going back to Always takes the buttons that open it out.</li>
        <li>A zone shown as a pop-up has the settings of a pop-up. <strong>Name</strong> (empty, it is called what it is: Order, Categories, Dishes and so on). <strong>Covers</strong>: <strong>Its own space</strong> (the cells it is placed on, the rest of the screen waiting behind it) or <strong>The whole screen</strong> (a full takeover; its place in the designer is then only where its outline sits). <strong>Looks</strong>: Border and shadow, and Window controls (its name and a close X). <strong>Closes</strong>: With a tap outside it (not when it takes the whole screen: nothing is outside it), and after it is used: <strong>After a category is picked</strong>, After a menu is picked, After a dish is tapped, After a seat or course is picked. Something has to close it, or Save waits.</li>
        <li><strong>Opened by</strong> lists the buttons that open it; <strong>Add a button that opens it</strong> puts an <strong>Open a pop-up</strong> button in a Buttons zone (or a pop-up). The order must have one that can be tapped: while the Order zone is a pop-up with no button that opens it, or its only button doesn&apos;t fit a full zone that hides the rest, or sits in a pop-up nothing opens, the designer says so in red and Save waits. Tap the problem under Layout to go to the zone that needs changing.</li>
        <li>The button that opens a zone says what is in it under its words. The <strong>order</strong>: its items and total (2 items · £5.30); on a counter till between orders, how many orders wait (1 waiting) or No order yet. The <strong>categories</strong>: the category that is open. The <strong>seat and course</strong>: what is picked (Seat 2 · Mains); it is greyed when the order&apos;s revenue stream uses neither.</li>
        <li><strong>Laid out as</strong> → <strong>List</strong> on the Categories, Dishes, A category&apos;s dishes, Menus, Buttons, Dish choices and Pop-up zones: one a row, the name on the left and the price on the right.</li>
      </ol>
      <P>
        On the till, the order opened from its button shows as it does on a tablet (its items, totals and
        its own More, Send, Bill and Pay), and closes with its X. It closes by itself when its order is
        paid, cancelled or left, so the dishes are there for the next one. Opened with no order on screen
        on a counter till, it shows New order and the orders waiting; tap one and it opens there. One
        pop-up shows at a time, and a dish with choices puts it aside while the choices show.
      </P>
      <P>
        <strong>What a phone-sized till shows.</strong> When the layout picked for it (its own, else its
        venue&apos;s) is made for a phone, that layout. Otherwise the venue&apos;s layout for phones (Store tech →
        Till layouts, <strong>On phones</strong>), and with none picked there the built-in phone screen: the
        counter one on a counter till, the table service one otherwise. The built-in phone screen can&apos;t be
        changed (its dishes show their prices): for your own prices, buttons or dishes on phones, make a layout
        from a phone starting point and pick it On phones. The till&apos;s <strong>Till</strong> page says which
        layout it draws (<strong>Screen layout</strong>). A phone turned on its side shows the layout picked as
        a tablet would, unless that layout is made for a phone (its rows would be too small to tap there): then
        the standard screen. Tablets are not affected.
      </P>
      <P>
        The till&apos;s other screens fit a phone as well. The floor shows <strong>Tables</strong> and{' '}
        <strong>Tabs and orders</strong> as two tabs, the tables as tiles; Closed checks shows the list, then the
        check you tap. A table-service till set to <strong>Rows to swipe</strong> (Store tech → Tills, On a
        phone) shows the tables and tabs as rows instead: a free table with its seats, or the check on it with its
        total. Swipe a check&apos;s row to the <strong>right to pay</strong> (the check opens in Pay) or to the <strong>left to send</strong> what is
        new to the kitchen, or to fire the course waiting when nothing is new (a till set to{' '}
        <strong>Swipe left: Fire the course waiting</strong> fires first, and sends when no course waits); what
        the swipe will do shows behind the row as it moves, and it happens once the row has moved about a third
        of the way across (160 px at most). A swipe left <strong>always asks first</strong>, even with one
        course, so a swipe made by mistake sends nothing: the <strong>Send</strong> window (named after the
        table or tab: each course to cook now or to wait, then <strong>Send</strong> or{' '}
        <strong>Cancel</strong>) or the <strong>Fire</strong> window (a big <strong>Fire</strong> button for each
        course waiting, with what is on it, or <strong>Cancel</strong>). When the order needs something before
        it can go (its guests or its details) the check opens and asks, as its own Send would. A tap still opens
        the check, and a free table&apos;s row opens a new check.
      </P>

      <H3>A till&apos;s own settings</H3>
      <P>
        Each till is <strong>table service</strong> or <strong>counter</strong> (Store tech → Tills, Edit,{' '}
        <strong>Opens in</strong>), never both. The till&apos;s window shows each setting in its own box: the
        question in bold, what you pick under it, and what it means below that. A table-service till has the floor (tables and tabs) and no
        Counter page, and never lists counter orders. A counter till has the Counter page and no floor,
        tables, tabs, guests, seats, courses or Fire, and sends each order to the kitchen as it is paid. Split
        / move items and Merge checks only offer checks of the same kind. A till whose kind is changed in Store
        tech moves to its own page as soon as it hears of the change.
      </P>
      <DataTable
        head={['Setting (Store tech → Tills, Edit)', 'What it does']}
        rows={[
          ['Tables (table service)', 'Tables and tabs: the floor with its tables, and tabs. Only tabs: no tables; the floor page is called Orders and lists the tabs and orders, with New tab.'],
          ['Guests (covers), Seats, Courses (table service)', 'As the revenue stream, or the till\'s own way: see Guests, seats and courses.'],
          ['Pay with items not sent to the kitchen (table service)', 'Warn first (the usual): Pay says what the kitchen hasn\'t been told yet, with Send and pay or Pay without sending. Send and fire them as it is paid: items not sent go to the kitchen and courses waiting are fired as the check closes, without asking.'],
          ['Leaving an order with items not sent (table service)', 'Ask whether to send them (the usual): going back to the floor with items the kitchen hasn\'t had (Back, a layout\'s Back to tables button, the top bar\'s pages, the till menu, Sign out) asks first: Send and leave, Leave without sending, or Stay on the order (see Leaving an order with items not sent). Just leave: the items wait on the order until someone sends them.'],
          ['Receipt when a check is paid', 'As the revenue stream (the usual: the stream\'s own setting, on Revenue streams; the window says which it is), or the till\'s own: Ask each time, Always print or Don\'t print.'],
          ['Asking for the order type, name and tent number', 'As the revenue stream (the usual), or the till\'s own: One screen or Two steps (see Asking for the order type, name and tent number).'],
          ['On a phone (table service)', 'Tiles: the tables as tiles, the tabs as a list. Rows to swipe: tables and tabs as rows; swipe right to pay, left to send what is new or fire the course waiting, always asking first (see Phone layouts).'],
          ['Swipe left (table service, Rows to swipe)', 'Send what is new (the usual): a swipe left sends what the kitchen hasn\'t had, else fires the course waiting. Fire the course waiting: it fires first, else sends. Either way the Send or Fire window asks first.'],
          ['Show a Send button (counter)', 'Off (the usual): counter orders go to the kitchen as they are paid. On: staff can also send an order before it is paid.'],
          ['Show on dish buttons how many are on the order', 'A small number on a dish\'s button: how many of it the order already has.'],
          ['Take one off from the dish\'s button (with the counts on)', 'A dish on the order comes off one at a time from its own button: hold the button down, or swipe its row to the left when the dishes are a list. One not sent yet comes off (Undo for a few seconds; a manager where taking items off needs one); one the kitchen has opens the void window for one. Held down, a dish not on the order, or a row of a list, still opens the sold out window.'],
          ['Screen layout', 'As the venue, the standard screen, or a layout (see Till layouts). The till\'s Till page says which layout it draws on its screen.'],
        ]}
      />

      <H3>Taking an order</H3>
      <ol className="list-decimal ml-5 space-y-2 text-sm text-muted-foreground mb-4">
        <li>Sign in with your PIN (4 to 6 digits, a 0 at the start included). A PIN signs you in as soon as its last digit is typed; if a 4 or 5 digit PIN doesn&apos;t, press <strong>OK</strong>. The till signs you out after the time set in Receipts and payments. A PIN set or changed in Store tech works straight away; if the till is offline it needs to have been online once since.</li>
        <li><strong>Floor</strong>: tap a table, or <strong>New tab</strong> for a named tab (the till asks its name, and its order type and tent number when there is a choice or the type asks for one). Both ask how many guests unless the revenue stream or the till says not to (see Guests, seats and courses below). Colours show which tables are free, open, waiting for a held course, or billed. A check at a table never asks for a tent number (the table says where the food goes); a tab or counter order asks when its order type does.</li>
        <li>Tap dishes. Pick a <strong>seat</strong> and <strong>course</strong> in the bar at the bottom of the menu first if you want them (its buttons are as big as Pay; a stream or till without seats has no seat buttons, one without courses no course buttons). A dish&apos;s button can say how many of it the order has already (a small number in its corner), when the till is set to (Store tech → Tills, <strong>Show on dish buttons how many are on the order</strong>). With <strong>Take one off from the dish&apos;s button</strong> on too, one comes off from there: <strong>hold the button down</strong>, or <strong>swipe its row to the left</strong> when the dishes are a list (what the swipe does shows behind the row: <strong>Take one off</strong> or <strong>Void one</strong>). One not sent yet comes off, with <strong>Undo</strong> for a few seconds (and a manager&apos;s PIN where taking items off needs one); one the kitchen already has opens the void window for one: pick a reason. Dishes with choices and combos open a window to pick them, add a note or allergies (on a till layout with Dish choices zones they show on the screen instead, and the dish shows in the order as it is being picked, with what is still to pick: see Till layouts).</li>
        <li><strong>Send</strong> sends new items to the kitchen. When the order has more than one course, or a course that waits by default, Send asks first: each course is a big button, green with <strong>Cook now</strong> for what the kitchen starts on, plain with a purple <strong>Wait (hold)</strong> label for what waits. Tap a course to switch it, then <strong>Send</strong>. A held course goes on the ticket with HOLD; <strong>Fire</strong> sends it when it&apos;s time. <strong>Send or Fire?</strong> Send is for items the kitchen hasn&apos;t had yet: it sends them, each course to cook now or to wait. Fire is for a course the kitchen already has but was told to wait: it starts that course. Items added after a Send need another Send.</li>
        <li>Tap an item on the check to change it: before it&apos;s sent you can change or delete it; after, <strong>Void</strong> it with a reason (the kitchen gets a VOID ticket), or <strong>Comp</strong> it. The item&apos;s window offers a seat and a course only where the till has them (never on a counter till; at tables, as the revenue stream and the till say: see Guests, seats and courses). For a dish with choices or a meal deal not sent yet, <strong>Change options</strong> opens its own picking screen with what it has picked (a till layout&apos;s Dish choices zones, else the choices window); <strong>Update</strong> changes that same line (picks, price and quantity; fewer than before asks a manager where taking items off needs one). A price typed in before stays unless you pick <strong>Use menu price</strong>. Once the kitchen has it, void it instead.</li>
        <li><strong>Swipe an item to the left</strong> for its button: <strong>Delete</strong> before it&apos;s sent (a message offers <strong>Undo</strong> for a few seconds), <strong>Void</strong> once the kitchen has it (the void window opens: pick a reason). A long swipe deletes straight away. <strong>Swipe a dish to the right</strong> for <strong>Options</strong> (a dish with choices or a meal deal not sent yet): it opens Change options, and a long swipe opens it straight away.</li>
        <li><strong>Drag an item by its grip</strong> (the dots on its left) to another course: every course shows while you drag, so you can drop it into an empty one too. Only items not sent yet move between courses. Grouped <strong>By seat</strong>, drag an item to another seat (sent items too).</li>
        <li><strong>More</strong>: <strong>Menus</strong> (which menus show, when the stream has more than one; see The menu on the till), guests, move table, name, order type, tent number, <strong>Allergy</strong> (see Allergies on an order), server, revenue stream, discount, charges, offers, split or move items to another check, merge checks, an item not on the menu, print bill, no sale, close an empty check, <strong>Cancel order</strong>. On a till whose layout leaves out the top bar, the till menu is under the order&apos;s actions in More (the till&apos;s pages, Sign out and its details).</li>
        <li><strong>Pay</strong>: <strong>Exact cash</strong> and <strong>Exact card</strong> take the amount shown in one tap (Exact card goes to the till&apos;s card machine when it has one, otherwise it records a card payment taken on your own machine). Or pick a way to pay: cash (with change), card, card machine (see Card machines), voucher and so on, a tip if switched on, and as many payments as needed to split the bill. When it&apos;s all paid the till closes the check with or without a receipt, as set on the check&apos;s revenue stream (Store tech → Revenue streams, or the till&apos;s own window): <strong>Ask each time</strong> shows the two buttons, <strong>Always print</strong> and <strong>Don&apos;t print</strong> close it straight away. When the check has items not sent to the kitchen, or a course waiting to be fired, Pay says so first: <strong>Send and pay</strong> tells the kitchen to make it all now, <strong>Pay without sending</strong> leaves it (nothing goes to the kitchen after the check is paid). A till set to <strong>Send and fire them as it is paid</strong> does that by itself without asking (see A till&apos;s own settings below).</li>
      </ol>
      <P>
        <strong>Counter</strong> (on a counter till) takes an order with a number (from the till&apos;s own range of order
        numbers, see Check and order numbers), pays it, and sends it to the kitchen when it's paid: a counter till
        has no Send button unless it is set to show one (Store tech → Tills, <strong>Show a Send button</strong>),
        and no guests, seats or courses. Tap{' '}
        <strong>New order</strong>, or just tap the first dish: the till takes over the screen to ask the
        order type (Eat in, Take out...: the ones the till's revenue stream offers) and the customer name
        or tent number that type asks for (see Asking for the order type, name and tent number below); one
        it must have can't be skipped. The order then opens with that dish. Answered from New order, the
        answers wait on the left (<strong>Change</strong>, or X to clear them) until you tap the first dish.
        With one order type that asks for nothing, a dish starts the order straight away.{' '}
        <strong>Closed</strong> lists today's closed checks: print the receipt again, <strong>Refund</strong>{' '}
        or <strong>Reopen</strong>.
      </P>
      <P>
        A dish has run out: <strong>hold it down</strong> on the menu and pick <strong>Sold out for
        today</strong> or <strong>until I put it back</strong>. It shows as sold out on every till,
        online ordering and the menu screens. Tap it to put it back on, or to add it anyway. On a till
        that takes one off from the dish&apos;s button, holding down a dish that is on the order takes one off
        instead; hold it down once it is off the order, or, when the dishes are a list, hold its row (a list&apos;s
        rows take one off by a swipe).
      </P>

      <H3>Leaving an order with items not sent</H3>
      <P>
        A table-service till asks before it leaves an order whose items the kitchen hasn&apos;t had (Store
        tech → Tills, <strong>Leaving an order with items not sent</strong>: <strong>Ask whether to send
        them</strong>, the usual since 24 Nov 2026). Going back to the floor asks first: <strong>Back</strong>,
        the top bar&apos;s pages, the till menu&apos;s pages and <strong>Sign out</strong>, and a till
        layout&apos;s <strong>Back to tables</strong> and Sign out buttons. The window lists what hasn&apos;t gone and offers:
      </P>
      <ul className="list-disc ml-5 space-y-2 text-sm text-muted-foreground mb-4">
        <li><strong>Send and leave</strong>: it goes to the kitchen, then the till goes where you were going (the Send window first when the order has courses to choose, the order&apos;s details or guests first when it needs them).</li>
        <li><strong>Leave without sending</strong>: the items stay on the order, not sent, until someone sends them.</li>
        <li><strong>Stay on the order</strong>: nothing changes.</li>
      </ul>
      <P>
        An order with nothing new leaves at once, and so does every order on a till set to <strong>Just
        leave</strong>. A counter till never asks: its orders go to the kitchen as they are paid.
        The till signing you out by itself after a quiet time doesn&apos;t ask either: the items wait on the
        order.
      </P>
      <InfoBox type="tip">
        Something your role doesn't allow (a void, a big discount, a refund) asks for a manager: someone
        whose role has <strong>Approve for others</strong> types their PIN on the same till, and the check
        records who approved it.
      </InfoBox>

      <H3>Asking for the order type, name and tent number</H3>
      <P>
        When a counter order or a tab starts, the till takes over the whole screen to ask what the order
        is: its order type, then the customer name and tent number that type asks for (Store tech →
        Revenue streams: No, Ask or Must). It has keys of its own, so it works the same on every tablet
        and the tablet&apos;s own keyboard never pops up: letters for the name (each word starts with a
        capital by itself; <strong>Shift</strong> for a capital in the middle, as in MacDonald; &apos; and -
        for names like O&apos;Neil or Smith-Jones; Space, Clear and Delete) and a number pad for the tent number. Tap a
        field to type into it, or <strong>Next</strong>. A keyboard plugged into the till types too (Enter
        moves on). A name or tent number the type must have keeps <strong>Done</strong> greyed out, with
        what is missing beside it. Tapping an order type that asks for nothing (Delivery, say) finishes
        straight away. <strong>X</strong> (or Escape) closes it without starting anything.
      </P>
      <ul className="list-disc ml-5 space-y-2 text-sm text-muted-foreground mb-4">
        <li><strong>One screen</strong> (the usual): the order types along the top and the name and tent number under them, all at once.</li>
        <li><strong>Two steps</strong>: big order type buttons first (<em>Which kind of order?</em>), then the name or tent number that type asks for, with Back to change the type.</li>
        <li>Pick the way for each revenue stream in Store tech → <strong>Revenue streams</strong> (<strong>Asking for the order type, name and tent number</strong>); a till can have its own in its window (Store tech → Tills). A till that follows the stream asks the way of the stream the order is in.</li>
        <li>The same screen opens for More → <strong>Order type</strong>, <strong>Name</strong> and <strong>Tent number</strong> on a check, and at Send or Pay when a check is missing a name or tent number its order type must have (straight on the name or tent). A check at a table is never asked for a tent number.</li>
      </ul>

      <H3>Allergies on an order</H3>
      <P>
        When a guest has an allergy, flag the whole order: More → <strong>Allergy</strong>, or the{' '}
        <strong>Allergy</strong> button in a Buttons zone of a till layout (Store tech → Till layouts). Tap
        the allergens to keep out and the diets to keep to (the menu&apos;s own, from Menus → Allergens &amp;
        dietary), type a note for the kitchen if needed (Coeliac: no shared fryer) and <strong>Save</strong>.
        A dish with its own allergy note keeps it too (tap the dish on the order).
      </P>
      <ul className="list-disc ml-5 space-y-2 text-sm text-muted-foreground mb-4">
        <li>The order shows a red <strong>Allergy</strong> bar at the top; tap it to change the flag.</li>
        <li>Each dish on the order that doesn&apos;t suit says why under its name, from what the menu says about it: <em>Contains Peanuts</em>, <em>May contain Peanuts</em>, <em>Milk can be left out: ask</em> (an allergen that can be removed on request), <em>Not Vegan</em>. A meal deal counts every dish picked in it, and keeps to a diet when every dish in it does. A dish not on the menu (Item not on menu) gets no warning: check it yourself.</li>
        <li>The window lists the dishes on the order that clash with the flag as you pick, before you save.</li>
        <li>The kitchen gets it on every ticket: kitchen screens show it in red at the top of the order, and printed kitchen tickets have an <strong>ALLERGY</strong> line above the dishes. Change or take off the flag after dishes were sent and the kitchen screens follow at once; kitchen printers that already printed the order print an <strong>ALLERGY UPDATE</strong> ticket.</li>
        <li><strong>Take the flag off</strong> (in the window) asks first. Dishes moved to another check, or a check merged into another, take the flag with them.</li>
        <li>Till reports shows it in the check&apos;s history (Allergy flag: ..., Allergy flag taken off).</li>
      </ul>

      <H3>Cancelling an order</H3>
      <P>
        <strong>Cancel order</strong> (the button at the top of the check, or in More) calls off the whole
        order: pick a reason (Guest left, Wrong order...) and whether what the kitchen made is waste, then
        <strong> Cancel the order</strong>. Everything sent is voided (the kitchen gets VOID tickets), the
        rest comes off, and the check closes as cancelled. A payment on it has to come off first (in Pay).
        The day&apos;s report lists cancelled orders with their reason, who did it and who approved it, and
        what the order was worth when it was cancelled; Closed on the till shows it as (cancelled).
      </P>

      <H3>Charges and discounts</H3>
      <P>
        <strong>Charges</strong> are one list for every venue: Store tech → <strong>Charges</strong>,{' '}
        <strong>Add</strong>. Each has a name (as the bill prints it), a <strong>percent</strong> or an{' '}
        <strong>amount</strong>, whether it is <strong>optional</strong>, <strong>from</strong> how many guests
        (0 = every check; e.g. 2.5% for parties of 6 or more) and the <strong>VAT</strong> on it (No VAT, or one
        of your tax rates). Drag them into the order the bill lists them. Optional service charges usually
        carry no VAT in the UK and ones guests must pay usually do: check with your accountant.
      </P>
      <DataTable
        head={['On', 'What it means']}
        rows={[
          ['The whole check', 'A percent of the check after its discounts, or an amount once per check.'],
          ['Some dishes', 'Only checks with one of the dishes or menu sections you pick get it (a whole section covers dishes added to it later). A percent is of those dishes; an amount is Once (while the check has one of them) or For each dish: a cup deposit of 25p on every hot drink, so 3 coffees are 75p. A meal deal counts the dishes in it.'],
        ]}
      />
      <P>
        <strong>Which checks get them</strong>, below the list, is this venue&apos;s table: a card per revenue
        stream, a row per order type it offers, and the charges as buttons. Tap a charge on a row and{' '}
        <strong>Save</strong>: a till check of that stream and order type gets it by itself when it opens. Each
        venue has its own table (pick the venue at the top). A charge that is on no row is still on the list
        for staff to add by hand.
      </P>
      <ul className="list-disc ml-5 space-y-2 text-sm text-muted-foreground mb-4">
        <li>A new till check gets the charges on its stream and order type&apos;s row, and they show on the check, Pay, the bill and the receipt by name. A charge for parties of 6 waits until the check has 6 guests (More → Guests), then counts by itself. A charge on some dishes counts as those dishes go on: <strong>Cup deposit x 3</strong>.</li>
        <li><strong>More → Charges</strong> lists the check&apos;s charges. <strong>Take off</strong> asks for a reason; an optional charge comes off straight away (unless the switch below says a manager), one that isn&apos;t optional needs a manager every time. <strong>Put back</strong> puts it on again. <strong>Add from the list</strong> puts any other charge on the list on this check, exactly as it is set up; <strong>Type a charge in</strong> types one for this check only (on the whole check, optional, no VAT).</li>
        <li>A till layout can have a button for one charge (a Buttons zone, <strong>A charge</strong>): a tap puts it on the order, puts it back if it was taken off, and says so if it is on already.</li>
        <li>Changing the order type (More → Order type) or the revenue stream (More → Revenue stream) gives the check the charges of its new row; a charge taken off stays off, also if you change back, and charges added on the till stay.</li>
        <li>Checks already open keep their charges when you change the list or the table. Kiosk orders don&apos;t get charges.</li>
      </ul>
      <P>
        <strong>Discounts</strong>: Store tech → <strong>Discounts</strong> lists the ones the till offers by
        name (Staff meal 50%, NHS 10%, £5 off), each a percent or an amount, on the whole check, on items
        only, or either, and whether it <strong>needs a manager every time</strong>. On the till, More →{' '}
        <strong>Discount</strong> (or an item&apos;s Discount) shows the ones that fit at the top: anyone signed
        in can use one that isn&apos;t marked, even without a discount allowance of their own; a marked one asks
        for a manager&apos;s PIN. Below them, a discount can still be typed in: only by people whose till role
        has <strong>Type a discount</strong> (Store tech → Till roles), up to the role&apos;s{' '}
        <strong>Discounts up to (%)</strong>; anyone else, or a bigger discount, needs a manager&apos;s PIN.
        Checks that had a discount keep it if you change or delete it.
      </P>
      <InfoBox type="tip">
        Cash Recon: Store tech → Cash Recon link can send a charge by name to a service charge source (say the
        service charge to the tronc and not the packaging fee), or <strong>All charges</strong> together.
      </InfoBox>

      <H3>Order flows</H3>
      <P>
        Store tech → <strong>Order flows</strong> holds rules that act on orders by themselves, on tills,
        self-order kiosks and online ordering, shared by every venue (each runs where you say). <strong>New flow</strong>: pick what it does, give it a name
        (for you: Add a drink, Delivery bag) and <strong>Create and open</strong>. It opens in the designer.
        A new flow, or a copy, starts switched off: switch it on in the list or the designer once nothing is
        left to set up. Drag the list into order: when two prompts are due together, the first one shows
        first.
      </P>
      <DataTable
        head={['What it does', 'On an order']}
        rows={[
          ['Suggest dishes', 'A prompt over the order: your question (Add a drink?), a line under it if you like, the dishes it offers with their prices, and No thanks. It asks When a dish is added (straight after it goes on) or At checkout (on a till when Pay, Exact cash or card, or a Pay by button is tapped; on a kiosk or online before the guest pays: paying carries on once it is answered). It asks once on an order; a When a dish is added prompt can ask every time one of its dishes goes on (Ask every time a dish sets it off).'],
          ['Add by itself', 'Dishes and charges that go on the order as soon as it matches what is under If, and come off by themselves when it stops matching (on a till, a dish only until it is sent to the kitchen). Each one either can be taken off (by staff on a till, by the guest on a kiosk or online), or can\'t (a manager on a till; never by a guest).'],
        ]}
      />
      <P>
        The designer shows four boxes, <strong>Where</strong>, <strong>When</strong>, <strong>If</strong> and{' '}
        <strong>Then</strong>, each saying in words what the flow does. Tap a box to change it. The preview
        shows the prompt or the order as staff will see it. <strong>Save</strong> keeps the changes,{' '}
        <strong>Discard</strong> puts back what was saved.
      </P>
      <ul className="list-disc ml-5 space-y-2 text-sm text-muted-foreground mb-4">
        <li><strong>Where</strong>: <strong>Every location</strong> or the ones you pick, and what it <strong>Runs on</strong>: <strong>Tills</strong>, <strong>Kiosks</strong>, <strong>Online ordering</strong>, any of them. For tills and kiosks, <strong>Every till there</strong> (every kiosk) or the ones you pick. A flow made before kiosks and online ordering could run flows runs on tills, as it did.</li>
        <li><strong>When</strong>: what it does (Suggest dishes or Add by itself) and, for a prompt, when it asks.</li>
        <li><strong>If</strong>: what the order needs. <strong>The channel is</strong> (revenue streams by name: Counter means every location&apos;s stream called Counter), <strong>The order type is</strong>, <strong>The dish added is</strong> or <strong>The order has</strong> (dishes, or whole menu sections: a section covers dishes added to it later), and <strong>Not when the order has</strong>. A prompt can also skip orders that have one of the dishes it offers (someone with a drink already isn&apos;t asked about drinks). Each kind you pick must hold, and any one of its choices will do. Nothing picked: every order (the designer says so).</li>
        <li><strong>Then</strong>, for a prompt: the question, the line under it, the dishes it offers (drag them into order) and whether staff pick <strong>One of them</strong> (a tap adds it and closes the prompt) or <strong>Any of them</strong> (each tap adds one more of that dish, the count shows on it, and No thanks becomes Done). For Add by itself: the dishes (and how many) and charges from the Charges list, each with <strong>Staff can take it off</strong> on or off.</li>
      </ul>
      <P>On the till:</P>
      <ul className="list-disc ml-5 space-y-2 text-sm text-muted-foreground mb-4">
        <li>A prompt shows only dishes the till can sell now: sold out dishes, and dishes on no menu the till shows at the moment, are left out, and a prompt with nothing left to offer doesn&apos;t show. A dish with choices opens its choices window first; the prompt waits behind it and comes back with what was added. A tap outside the prompt is No thanks (or Done). Answered, it is noted on the order and isn&apos;t asked again there; dishes added from a prompt don&apos;t set off other prompts.</li>
        <li>What a flow puts on shows <strong>Added by</strong> and the flow&apos;s name on the order (on a charge: in More → Charges). A lock means a manager has to take it off: deleting, voiding or lowering the quantity of that dish asks for a manager&apos;s PIN, and so does taking that charge off. Something staff took off stays off on that order; a charge can be put back in More → Charges.</li>
        <li>When the order stops matching (another order type, the dish that set it off taken off), what the flow put on comes off by itself and the till says so. A dish already sent to the kitchen stays.</li>
      </ul>
      <P>On a self-order kiosk:</P>
      <ul className="list-disc ml-5 space-y-2 text-sm text-muted-foreground mb-4">
        <li>A prompt shows over the kiosk after a dish goes in (or before paying), in the kiosk&apos;s language: the question and the line under it can be translated in Menus → Translations, under Order flows. The guest taps a dish (one with choices opens its page, then the next prompt), or No thanks.</li>
        <li>What a flow puts on shows in the order under <strong>Added for your order</strong>, with <strong>Remove</strong> on the ones the guest may take off, and <strong>Add it back</strong> for the ones taken off. Its charges show above the total, with a bin on the ones the guest may take off. Nothing goes on until the guest has a dish of their own in the order.</li>
        <li>The kiosk sends the order with all of it, and the prompts answered, to the till; a till that opens a kiosk order keeps the kiosk&apos;s flows on it.</li>
      </ul>
      <P>On online ordering:</P>
      <ul className="list-disc ml-5 space-y-2 text-sm text-muted-foreground mb-4">
        <li>The channel online orders count under is the revenue stream picked in Ordering setup, and the order type is the one picked there for collection: <strong>If</strong> can name either.</li>
        <li>Prompts, and what flows put on, show in the basket as on a kiosk: <strong>Added for your order</strong> under the dish, a cross on the ones the guest may take off, <strong>Add it back</strong> for the ones taken off, the charges above the total. The order itself is worked out again when it is placed, so what goes on is what the flow says, whatever the page sent; the guest can only take off what may be taken off.</li>
        <li>The order&apos;s page, the order window on Online orders, the printed ticket and the emails show the charges, and the dishes a flow put on. The minimum order counts only the guest&apos;s own dishes.</li>
        <li>A dish a flow puts on can be in a menu section hidden on the website (Where it shows: Hide on website), like a paper bag guests can&apos;t order by itself. Kiosks get it too.</li>
      </ul>

      <H3>How a prompt looks</H3>
      <P>
        A Suggest dishes flow has a fifth box in the designer, <strong>Look</strong>: how its prompt looks
        on each place it runs. Switch between <strong>Tills</strong>, <strong>Kiosks</strong> and{' '}
        <strong>Online ordering</strong> at the top of the panel; each has its own look. A prompt starts
        with the standard look everywhere (how prompts have always looked there), and gets its own as soon
        as you change something. The box says in words what each place shows.
      </P>
      <DataTable
        head={['Setting', 'What it does']}
        rows={[
          ['Header', 'Plain (the question at the top of the prompt), Band of colour (the question on a band across the top: the main colour unless you pick another), or Picture (a picture across the top, three times as wide as it is tall, with the question under it). The question and the line under it can sit on the left or in the middle.'],
          ['Background', 'The prompt\'s colour, and a picture behind it if you like. A picture lies under a veil of the background colour so the words stay readable: the slider says how strong the veil is (0 shows the picture as it is).'],
          ['Dishes', 'Cards (side by side, the picture on top, big) or Rows (one under the other, a small picture beside the name), with the dishes\' pictures on or off. The pictures are the dishes\' photos on the Menus page; a dish without one shows a plain box on a card.'],
          ['Colours', 'The question, the words, the dishes and the No thanks / Done button, each Standard (the place\'s own colour), one of the theme\'s colours, or a colour of your own (the colour picker, or a code like #1d4ed8).'],
        ]}
      />
      <P>
        A theme colour follows its theme when the theme changes. On tills and online ordering the theme is
        your brand (<strong>Brand &amp; theme</strong>; a location with its own Brand &amp; theme uses its
        own). On kiosks it is each kiosk&apos;s design, so one prompt can be blue on one kiosk and purple on
        another; the preview asks which kiosk design to show when you have more than one. Words on a colour
        you pick (on a band, the dishes, the button) are picked to read well.
      </P>
      <P>
        <strong>Standard look</strong> puts the place back to its standard look. <strong>Same look on</strong>{' '}
        copies this place&apos;s look to another place the flow runs on. The preview shows the prompt in the
        look of the place picked above it, close to how it will look there (each has its own fonts and sizes).
        Save keeps it, as with the rest of the flow. Kiosks keep the pictures their prompts show, so they
        work without the internet.
      </P>
      <InfoBox type="info">
        Add by itself only adds dishes without choices to make (nobody picks them for you): for a dish with
        choices, use a prompt. A charge that counts from a number of guests never goes on a kiosk or online
        order (they have no guest count): the designer says so. An order already open when you change a flow
        follows the new version as soon as it is on a till&apos;s screen; kiosks and online ordering follow it
        on their next order or quote.
      </InfoBox>

      <H3>Manager approvals</H3>
      <P>
        Store tech → Receipts and payments → <strong>Needs a manager every time</strong> makes a manager
        type their PIN for these, whatever the person&apos;s own till role allows: <strong>Taking off items
        not sent yet</strong> (deleting, a swipe, or lowering the quantity), <strong>Voiding items the
        kitchen has</strong>, <strong>Cancelling a whole order</strong>, <strong>Refunds</strong>{' '}
        and <strong>Taking an optional charge off</strong> on the till
        (discounts from the list follow their own setting; typing a discount in is the till role&apos;s{' '}
        <strong>Type a discount</strong>, see Charges and discounts). The manager needs <strong>Approve for
        others</strong>, and for voids and refunds that permission too. A manager doing it themselves
        isn&apos;t asked. Switched off, the person&apos;s role decides (Till roles). Turning a dish into a
        combo (Make it a combo) never asks: nothing comes off the order. Charges that aren&apos;t optional
        always need a manager to come off.
      </P>

      <H3>Guests, seats and courses</H3>
      <P>
        Each revenue stream decides three things for its tables and tabs (Store tech →{' '}
        <strong>Revenue streams</strong>, Edit): <strong>Guests (covers)</strong>, <strong>Use seats</strong> and{' '}
        <strong>Use courses</strong>. A till can do each its own way in its window (Store tech → Tills);{' '}
        <strong>As the revenue stream</strong> follows the stream. Counter tills never ask for guests and use no
        seats or courses, whatever the stream says.
      </P>
      <DataTable
        head={['Guests (covers)', 'What the till does']}
        rows={[
          ['Ask, can be skipped', 'Opening a table or a tab asks how many guests, with Skip. The usual for new streams.'],
          ['Must have', 'Opening a table or a tab asks, with no Skip. A check without guests (opened while the till skipped them) asks again before Send and Pay.'],
          ['Don\'t ask', 'A table or a tab opens straight away with no guests (More has no Guests).'],
        ]}
      />
      <P>
        <strong>Use seats</strong> (on unless switched off): seat numbers on items (the seat buttons in the bar at
        the bottom of the menu) and <strong>By seat</strong> on the check. Off: no seat buttons; dishes go to the
        whole table. Seats used to follow Guests (Don&apos;t ask meant no seats too); since 14 Nov 2026 they are a
        switch of their own, so a stream can ask for guests without seats, or use seats without asking.
      </P>
      <P>
        <strong>Use courses</strong> off: dishes go to the kitchen together, the till shows no course buttons
        and Send doesn&apos;t ask about courses. A charge from 6 guests only counts on checks that have them.
      </P>

      <H3>Without the internet</H3>
      <P>
        A till that can't reach the internet keeps going, and shows it at the top. Two tills that can't
        reach each other may change the same check: when they catch up, a change that no longer fits
        (e.g. an item added to a check another till had already closed) isn't saved. The till that made
        it says <strong>Not saved</strong>, and it's listed in <strong>Till reports → Refused changes</strong>{' '}
        for a manager to sort out and mark dealt with.
      </P>

      <H3>Updates to the till app</H3>
      <P>
        Tills, kitchen screens and kiosks keep a copy of the app so they open without the internet. When
        we release a new version, each device fetches it in the background (within 30 minutes, or as soon
        as its screen comes back on) and switches to it at a quiet moment: a till when nobody is signed
        in, a kiosk when it&apos;s back on its start screen with nothing in the basket, a kitchen screen
        when nobody has touched it for 30 seconds. Nothing waiting to be sent is lost. To switch at once,
        close the app and open it again.
      </P>
      <P>
        If a kiosk or kitchen screen ever shows the till&apos;s <strong>Type your PIN</strong> screen
        after pairing, it was still running an older copy of the app (a device that had opened the till
        address before kiosks arrived did this once): reload the page and it opens as it should. The app
        now checks with the server what each device is, so this can&apos;t happen again.
      </P>

      <H3>Check and order numbers</H3>
      <P>
        Every till and kiosk numbers its own checks and orders, so they never clash, even when one is
        working without the internet. A check is numbered by the till that opened it: <strong>T2-47</strong>{' '}
        is till T2's 47th check of the trading day (the code is on the till's row in Store tech, Tills). A
        counter order also gets a short <strong>order number</strong> for calling out and the order ready
        boards, from that till's or kiosk's own range (Front till 100-199, Kiosk 300-399...), going back to the
        start of the range after the last one. Numbers start again each trading day. Till reports shows
        both: #101 with T2-2 under it.
      </P>

      <H3>End of day</H3>
      <P>
        <strong>Reports</strong> on the till shows today's figures so far (X report). <strong>Close the day (Z)</strong>{' '}
        needs every check closed: count the cash in the drawer (without the float) and type it in, then
        <strong>Print Z</strong> for the cash-up. Before closing, the till lists any till or kiosk that still has
        changes it hasn't sent (it was offline, or can't reach the server), and any that hasn't been in touch
        for a while today: the day's figures won't include those changes until they are sent, so check those
        devices first if you can. It's a warning only: a broken or lost device doesn't stop the day closing. The next sale starts a new trading day. If <strong>Fill Cash Recon when the
        day is closed</strong> is on (Store tech → Cash Recon link), the day's sales, takings by way of paying,
        charges and tips are written into that day of Cash Recon; otherwise use{' '}
        <strong>Fill Cash Recon</strong> on the day in Till reports. A submitted Cash Recon day isn't changed.
      </P>

      <H3>Till reports</H3>
      <DataTable
        head={['Tab', 'What it shows']}
        rows={[
          ['Days', 'Each trading day: sales, payments, cash expected and counted, revenue streams, order types, VAT, staff, discounts and comps, charges by name (with how often each was taken off and what that came to), voids, cancelled orders (with their reason and what they were worth), refunds, best sellers, open checks. The open day is shown as it stands now.'],
          ['Checks', 'Every check of a day with its items, totals and full history: who did what, when, and who approved it.'],
          ['Refused changes', 'Changes a till made offline that couldn\'t be applied when it caught up. Note what was done and mark them dealt with.'],
          ['Print queue', 'Tickets and other jobs, waiting or printed, with the reason when one didn\'t print.'],
          ['Kitchen', 'Speed of service from the kitchen screens: per station, tickets, dishes, average, middle and slowest times, how many were on time and late, the average by hour, and every remake with its reason. Flow timers (set on the kitchen flow) show how many dishes or tickets they counted, the average, middle, 9 in 10 and slowest times (with its order) and the share on time against their target. Download CSV for every bump and remake.'],
        ]}
      />

      <H3>Device updates</H3>
      <P>
        Store tech, <strong>Device updates</strong> sets how often this location&apos;s tills, kiosks, kitchen
        screens and menu screens ask Macaroonie for changes. They are told about a change the moment you
        save it (a menu published, a dish sold out, a setting); asking now and then is only a safety net for
        a device that missed being told. Asking less often eases the load on the server and on a weak
        connection; a change a device missed then takes longer to show.
      </P>
      <DataTable
        head={['Time', 'Which devices', 'Standard']}
        rows={[
          ['Menus, pictures and settings', 'Tills, kiosks and kitchen screens', 'Every 3 minutes'],
          ['Prices and sold out', 'Tills and kiosks (Off: only when they are told, and with the menu)', 'Every 30 seconds'],
          ['Menu screen boards', 'Menu screens', 'Every minute'],
          ['Order ready board numbers', 'Menu screens showing order numbers', 'Every 15 seconds'],
        ]}
      />
      <P>
        Start from <strong>Standard</strong>, <strong>Less often</strong> (about a quarter of the asks) or{' '}
        <strong>Least often</strong>, or pick each time yourself, then <strong>Save</strong>. The box under
        the times says roughly how many times an hour this location&apos;s devices ask, before and after
        your change. <strong>Use these at every location</strong> copies the saved times to every location of
        the group (it asks first). Devices pick the new times up straight away when they are online. Orders,
        payments and kitchen taps are never held back by these times: they go at once.
      </P>
    </section>
  )
}
