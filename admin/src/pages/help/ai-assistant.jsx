// src/pages/help/ai-assistant.jsx
// The Help page's "Pepper (AI assistant)" section. Help.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, Mono, InfoBox, DataTable } from './parts.jsx'

export const id = 'ai-assistant'
export const label = 'Pepper (AI assistant)'
export const order = 360

// ── PEPPER (AI ASSISTANT) ───────────────────────
export function Section() {
  return (
    <section id="ai-assistant" data-help="">
      <H2>Pepper (AI assistant)</H2>
      <P>
        Pepper is Macaroonie's assistant for staff. Ask it questions and give it jobs in your
        own words, about any part of the app: what's booked tonight, who's working, which
        H&S checks are still to do, how yesterday's cash up came out, which online orders are
        waiting, a dish that has sold out, a supplier order or a menu price. It works with your
        own permissions and never changes anything until you press Confirm on the card it
        shows. There are four ways in:
      </P>
      <DataTable
        head={['Where', 'Who', 'What it can do']}
        rows={[
          ['Ask Pepper (sidebar), the Pepper page, and Pepper in the phone app', 'Staff', 'Everything in "What Pepper can do" below, in the areas your role can see'],
          ['Your own AI app (Claude, Cursor and others) through the staff connector', 'Staff', 'The same as Ask Pepper, with your own permissions'],
          ['The AI chat block on your website', 'Guests', 'Answer questions, book a table, change or cancel a booking'],
          ['Guests\' own AI apps through Macaroonie\'s public connector', 'Guests', 'Find your restaurants, book, change or cancel'],
        ]}
      />
      <P>
        The two guest chats aren't called Pepper: they speak for your restaurant, and they can
        only book, change and cancel tables.
      </P>
      <H3>Asking Pepper</H3>
      <P>
        Press <strong>Ask Pepper</strong> in the sidebar (on a tablet it is the sparkle button
        under the menu button) to open the chat on the right of any page, or open the{' '}
        <strong>Pepper</strong> page. Ask in your own words, for example
        {' '}<em>"What's booked tonight?"</em>, <em>"Who's working tomorrow?"</em> or
        {' '}<em>"Move the Smith booking to 8pm"</em>. Venues, people, dishes, suppliers and the
        rest can be named the way you'd say them; if a name could mean more than one, Pepper
        asks which.
      </P>
      <P>
        Pepper never changes anything on its own. When it wants to make a change it shows a
        card with the exact details and a button that says what it does (such as{' '}
        <strong>Save rota</strong> or <strong>Refund</strong>). Nothing happens until you press
        it; press <strong>Cancel</strong> if it's wrong. Each card works once and expires after
        30 minutes. When something is best done on a page (a full report, setting something
        up, dragging on the timeline), Pepper gives you a link to that page.
      </P>
      <P>
        What it can do follows your role: if you can only view the rota, it can tell you who is
        working but can't change the rota, and it shows pay and tips only if your role can see
        them. Earlier chats are under <strong>Earlier chats</strong> (the clock button in the
        panel); delete one with the bin button.
      </P>
      <P>
        Pepper&apos;s answer appears as it is written, with a line under it saying what it is
        doing (thinking, looking something up, getting a card ready). A card that turns up
        while Pepper is still working can be pressed once the answer has finished.
      </P>
      <P>
        A chat takes one message at a time. While Pepper is working on one, the send button
        waits and what you type stays in the box; wait for the answer, then carry on. A long job
        (a whole menu from a photo, a big price list) can take a few minutes. If it runs past
        about ten, Pepper stops between steps and asks you to say <em>carry on</em>, and picks
        up where it left off. If your connection drops (a phone changing networks), the chat
        says so and shows <em>"Still working on the last message"</em> until Pepper has
        finished; the answer then appears by itself.
      </P>
      <P>
        Everyday questions are answered by a faster model; Pepper moves to its most capable one
        for photos and files, building a menu, importing a price list and long chats, and stays
        on it for the rest of that chat. You don&apos;t need to do anything for this.
      </P>
      <P>
        If Pepper can&apos;t help with a request, it says so and leaves that message out of the
        chat, so the next one isn&apos;t held up by it.
      </P>
      <H3>What Pepper can do</H3>
      <DataTable
        head={['Area', 'Ask things like', 'Follows your permission for']}
        rows={[
          ['Bookings', '"Is there a table for 4 on Friday at 7?", "Book a table for 2 at 7 tonight for Sam Jones", "Mark the Patel booking arrived"', 'Bookings'],
          ['Customers', '"What\'s Jane Smith\'s phone number?", "Take her off the newsletter", "This guest asked us to delete their details"', 'Customers'],
          ['Opening times, closures, tables, booking rules', '"When can people book on Sunday?", "Close Ware on 25 and 26 December", "Let people book up to 60 days ahead"', 'Schedule, Tables, Rules'],
          ['Health & safety', '"Which checks are still to do today?", "Walk-in fridge is 4 degrees", "Tick everything on the opening checklist"', 'Checklists, Food safety, H&S action log'],
          ['Staff and the rota', '"Who\'s working tomorrow?", "Put Jo on Tuesday lunch", "Sam is off sick on Friday", "Copy last week\'s rota", "Jo\'s last day is 30 November"', 'Staff, Rota, Rota pay, Rota tips'],
          ['Cash up and wages', '"How did yesterday\'s cash up come out?", "The card machine was £1,240", "Add £12 for milk", "Mark Jo\'s wages paid", "Fill this week from Loyverse"', 'Cash reconciliation'],
          ['Online orders and sold out', '"Any orders waiting?", "Accept 12, ready in 20 minutes", "Refund order 7", "Pause online orders", "Pad Thai is sold out"', 'Online orders'],
          ['Till and kitchen', '"What did the till take yesterday?", "Any checks still open?", "How fast was the kitchen on Saturday?"', 'Till reports'],
          ['Reports and figures', '"What were net sales by server last week?", "Which dishes sold most on Fridays?", "Run Sales by day for October", "Save that as a report", "Share it with the managers"', 'Reports, and the area a report is about'],
          ['Menus', '"Which dishes are free from peanuts?", "Pad Thai is £11.75 now", "Publish the menu on Monday at 9am"', 'Menus'],
          ['Purchasing', '"Order 3 boxes of tomatoes and fill the rest to par", "Which deliveries are due today?"', 'Purchasing, Purchasing setup'],
          ['Website and marketing', '"Is the website up to date?", "Publish the website", "Put a banner up: closed today", "Switch off the lunch deal", "Any new reviews?", "Which menu screens are offline?"', 'Website, Promotions, Menu screens, Emails'],
          ['Support', '"Log an issue: the card machine keeps disconnecting", "Ask for a feature: split bills by seat"', 'Issue log, Feature requests'],
          ['Finding a page', '"Where do I change the opening times?"', 'The pages you can open'],
          ['How the app works', '"How do I set up tip pots?", "Where do I add a fridge?", "What does variance mean?"', 'Everyone who can use Pepper'],
          ['Your day in one go', '"Brief me on today", "What\'s on at Ware tomorrow?"', 'Each part follows its own area'],
          ['Looking things up on the web', '"What does the Food Standards Agency say about cooling rice?", "Is there a recall on this brand of hummus?", "When does the Ware Christmas market start?"', 'Everyone who can use Pepper, once web search is switched on in Settings'],
        ]}
      />
      <H3>Asking about the page you&apos;re on</H3>
      <P>
        When you open Ask Pepper from the sidebar, a small label above the message box shows
        which page is behind the panel, for example{' '}
        <em>About: Rota · Ware · week of 13 Oct</em> or <em>About: Food safety · Ware · Mon 19 Oct</em>.
        Pepper is told the page and the venue and day or week it is showing, so you can ask
        {' '}<em>"Who is on this week?"</em> or <em>"What still needs doing here?"</em> without
        naming the venue or date. If you name a different venue or day, Pepper goes by what you
        say.
      </P>
      <P>
        On a report, the label shows the report and the period it shows{' '}
        (<em>About: Reports · Sales by day · 2 Nov to 8 Nov</em>), and Pepper is told which report
        is open, the period and the venues you picked, so <em>"Why is Tuesday low?"</em> or{' '}
        <em>"Show this by hour"</em> is about that report. In the builder Pepper is told what the
        report is about. Pepper is only told a report&apos;s name when you can open it yourself.
      </P>
      <P>
        Tap the label to stop sending the page for this chat (it then reads{' '}
        <em>Not sending</em>); tap it again to start. The label follows you as you move
        between pages with the panel open. The Pepper page and the phone app don&apos;t send a
        page.
      </P>
      <P>
        Every message also tells Pepper today&apos;s date and the time at your venues, wherever you
        ask from (the panel, the Pepper page or the phone), so &quot;today&quot;, &quot;tonight&quot; and
        &quot;Saturday&quot; mean the right day. If Pepper ever answers about the wrong day, tell it the
        date and it will look again.
      </P>
      <H3>Your day in one go</H3>
      <P>
        Ask <em>"Brief me on today"</em> (or for another day or venue) and Pepper puts the day
        together in one answer, leading with what needs doing: bookings and big parties, who is
        working, health & safety checks still due and readings out of range, supplier
        deliveries due, yesterday&apos;s cash-up, online orders still open, dishes sold out,
        booking emails that failed and menu screens that are offline. A part your role
        can&apos;t see is left out, and Pepper says which ones.
      </P>
      <H3>Opening a form from Pepper</H3>
      <P>
        Ask Pepper to open a form and it puts a card in the chat with an <strong>Open</strong> button:{' '}
        <em>&ldquo;do today&apos;s cash-up&rdquo;</em>, <em>&ldquo;log the fridge temps&rdquo;</em>,{' '}
        <em>&ldquo;open the closing checklist&rdquo;</em>, <em>&ldquo;add an expense&rdquo;</em>,{' '}
        <em>&ldquo;who&apos;s on Saturday&rdquo;</em>. Open shows the same form the Today page opens, over the
        chat, and you fill it in yourself: Pepper never fills a form&apos;s fields. The forms: fridge and
        freezer, hot and cold hold, cooking and delivery checks; a checklist; the cash-up; the week&apos;s
        wages; the day&apos;s expenses with receipts; sold out dishes; and the rota for a day. Each needs
        access to its area, and shows read only when your role can look but not change.
      </P>
      <H3>How do I...? questions</H3>
      <P>
        Ask how to do something in the app (<em>"How do I set up tip pots?"</em>,{' '}
        <em>"Where do I add a fridge?"</em>) and Pepper answers from this Help guide, with a link
        straight to the part that covers it. If the guide doesn&apos;t cover it, Pepper says so
        rather than guessing.
      </P>
      <P>
        The parts below go into each area in more detail.
      </P>
      <H3>Booking past the usual limits</H3>
      <P>
        Each venue has a usual party size (Rules page) and each booking time can have a covers
        limit (Schedule page). When a booking is outside these, Pepper says which limit is in
        the way and asks before going ahead. Say yes and it shows a card headed{' '}
        <strong>Book past the usual limits?</strong> with the limits listed in an amber box;
        press <strong>Book anyway</strong> (or <strong>Move anyway</strong>) to go ahead. It
        puts the booking on the smallest free table that fits. If no table fits (a party bigger
        than any table, say), it goes on the <strong>Unallocated</strong> row so you can seat it
        on the timeline. Guests and the booking widget still can't book past the limits.
      </P>
      <InfoBox type="info">
        The time still has to be one of the venue's booking times. A time outside the
        sittings or blocked in the schedule, picking a specific table, or changing how long a
        booking lasts is still done on the timeline.
      </InfoBox>
      <H3>Health & safety by chat</H3>
      <P>
        Ask things like <em>"Which H&S checks are still to do today?"</em>,{' '}
        <em>"Walk-in fridge is 4 degrees for the morning check"</em>,{' '}
        <em>"Tick lights and fire exits on the opening checklist"</em> or{' '}
        <em>"Add to the action log: the kitchen tap is dripping, high priority"</em>. Fridges,
        hold stations, check times, dishes and tasks can be named the way you'd say them; if a
        name could mean more than one, Pepper asks which.
      </P>
      <DataTable
        head={['You can', 'Notes']}
        rows={[
          ['See the day\'s H&S status', 'Which checklists are done and how many fridge, hold and cooking checks are logged, the same as the Overview H&S tiles. It can also list each reading and the checks still missing.'],
          ['Log a fridge, freezer or hold temperature', 'For the check due now unless you name one ("evening check"). Logging the same check again replaces the reading.'],
          ['Log a cooking check', 'Matched to your cooking-check dish list; anything else is logged by its name. Under 75°C fails.'],
          ['Log a delivery check', 'Supplier, what was OK, product temperature, accepted or rejected.'],
          ['Add a corrective action', 'For a reading that was out of range or a failed check.'],
          ['Tick or untick checklist tasks', 'Name the tasks or ask for all of them. The checklist is done when every task is ticked.'],
          ['Keep the action log', 'List open actions, add one, mark one done.'],
        ]}
      />
      <P>
        As with bookings, every change shows a card first. A reading out of range shows an{' '}
        <strong>Out of range</strong> box on the card; Pepper then asks what was done about it
        so you can add the corrective action. What it can do follows your permissions for
        Checklists, Food safety and the H&S action log.
      </P>
      <H3>Purchasing by chat</H3>
      <P>
        Ask things like <em>"What's on the Daily order for Ware?"</em>,{' '}
        <em>"Order 3 boxes of tomatoes and fill the rest to par"</em>,{' '}
        <em>"Brakes now charges £13.20 for the oil"</em>,{' '}
        <em>"Which deliveries are due today?"</em> or{' '}
        <em>"The Fresh Co delivery came, one box of tomatoes short, chilled at 4 degrees"</em>.
        Items, suppliers and order lists can be named the way you'd say them; if a name could
        mean more than one, Pepper asks which.
      </P>
      <DataTable
        head={['You can', 'Who', 'Notes']}
        rows={[
          ['Search the inventory', 'Purchasing setup', 'By name, our code or a supplier\'s product code ("what is MEA161?"). Each item with its supplier prices (pack, price ex VAT, price per kg, litre or each), venue prices, which supplier is chosen, and recent price changes.'],
          ['Add or change items', 'Purchasing setup', 'Name, category, storage, code, notes, switch off. A new item can come with its first supplier prices.'],
          ['Add or change supplier prices', 'Purchasing setup', 'Price per pack, pack, VAT, supplier code, the supplier\'s product name (a brand), minimum and steps, a venue\'s own price, and which supplier an item is ordered from (for every venue or one).'],
          ['Add or change suppliers', 'Purchasing setup', 'Contact details, how orders reach them, cutoff, delivery days, minimum order, delivery charge, whether marking an order sent needs their reference, and one venue\'s own account number, days, cutoff, days\' notice, delivery phone, slot and driver instructions.'],
          ['Make and change order lists, set pars', 'Purchasing setup', 'Pars are in packs unless you give kg, litres or each.'],
          ['Import a price list', 'Purchasing setup', 'Attach a CSV with the import headings, or a PDF, photo or email of the supplier\'s list: Pepper reads the products out of it. The card shows what would be added and changed, and any rows it would skip, before anything is saved.'],
          ['Update a supplier\'s prices by their codes', 'Purchasing setup', 'Attach their new prices as a CSV (code and price), or a PDF, photo or email Pepper reads them from, or say them ("Brakes: MEA161 is now £31.50"). The card lists each change with the old and new price (changes of 20% or more marked) and the codes it couldn\'t use. Only prices change.'],
          ['Check the catalogue', 'Purchasing setup', 'Codes on two products, two items in use with one name, items nobody sells and prices without a code ("is the catalogue tidy?").'],
          ['Switch several items off or on', 'Purchasing setup', 'Up to 50 at a time, by name or code. The card says which are on open orders, and switching on is refused for a code another item already uses.'],
          ['See and fill in an order', 'Purchasing', 'The venue\'s draft for a list: quantities, pars, last ordered, other suppliers, and each supplier\'s quick order codes. Quantities are packs (cases, bags), as on the Purchasing page. An item can be named by a supplier\'s product code: "order 20 MEA161" orders it from that supplier. Nothing is sent until you place it.'],
          ['Bring a supplier\'s basket into an order', 'Purchasing (an order waiting for approval: Purchasing approval)', 'After ordering on a supplier\'s website: attach their basket as a CSV or text file, or paste the codes and quantities ("Brakes basket: MEA161 20, POR106 7"). The card lists every line added, changed and taken off, and the codes not found here, before the order changes. Nothing goes to the supplier.'],
          ['Mark a supplier price out of stock', 'Purchasing, Purchasing approval or Purchasing setup', '"Brakes is out of MEA161 until Friday": the first day it can be delivered again, with what they said. Orders for a day before it say so, and placing an order warns about it. "MEA161 is back in stock" clears it. Nothing moves to another supplier by itself.'],
          ['Send an order for approval', 'Purchasing', 'For people without Purchasing approval: the card lists the lines and the day wanted from each supplier, and you can add a note for the manager.'],
          ['See the orders waiting for approval', 'Any purchasing access', 'Who asked and when, the days wanted, each line with what was asked for, and drafts that were sent back with the reason.'],
          ['Place an order', 'Purchasing approval', 'Your draft, or an order waiting for approval. The card lists each supplier with its delivery date (the day asked for, if any), how the order gets to them and the lines, and warns about rounded-up quantities or a small order. A day the supplier can\'t make (not one of their delivery days, or too late for their cutoff) is refused unless you say it was agreed with them; a line whose price was switched off has to be changed or taken off first. The note to each supplier starts as the venue\'s driver instructions. When the venue already has an order from a supplier for that day, Pepper asks whether to add to it or place a separate one. Lines a supplier said are out of stock for that day are flagged on the card.'],
          ['Change, split or send back an order waiting for approval', 'Purchasing approval', 'Change quantities, move part of it to a second order for another day, or send it back with the reason.'],
          ['Send, change, split or cancel a purchase order', 'Purchasing (send, date, reference); Purchasing approval (quantities, split, cancel)', 'Email it, or mark it sent by printout, PDF, Excel, phone or their website, with the supplier\'s order reference (needed for suppliers set to need it) and, if it went earlier, when. Quantities can change while it is waiting to be sent (lines and products to add can be named by their product code); the date and notes until it is received; the supplier\'s reference any time. A split moves part of it to a second order for another day. Asking for a purchase order gives its quick order codes ("MEA161:20,POR106:7") for the supplier\'s website, and an order can be found by a product code on it.'],
          ['Find orders running late', 'Any purchasing access', 'Orders still to send after their cutoff and deliveries never booked in after their day ("which orders are late?"). Also in the day briefing. A purchase order can be found by the supplier\'s reference.'],
          ['Book a delivery in', 'Purchasing', 'Say what was short or missing and the probe temperatures; everything else counts as arrived. This also saves the delivery check in Food safety.'],
        ]}
      />
      <P>
        Every change shows a card first, as with bookings. Prices only show to people who can
        see Purchasing setup; restaurant staff ordering without it see packs and quantities
        but no prices, in the chat and on the cards.
      </P>
      <InfoBox type="info">
        Pepper doesn't delete items, prices, suppliers or lists: it switches them off, the
        same as the pages do. Check a price list import card carefully before pressing
        Import: it can change many prices at once.
      </InfoBox>
      <H3>Menus by chat</H3>
      <P>
        Ask things like <em>"Which dishes on the main menu are free from peanuts?"</em>,{' '}
        <em>"Make a new lunch menu from this photo"</em> (with the photo or PDF attached),{' '}
        <em>"Pad Thai is £11.75 now"</em>,{' '}
        <em>"Add sesame to the Pad See Ew"</em> or{' '}
        <em>"Put all the starters up 5%, rounded up to 5p"</em> and then{' '}
        <em>"Publish it on Monday at 9am"</em>. Menus, sections, dishes,
        option groups and allergens can be named the way you'd say them; if a name could
        mean more than one, Pepper asks which.
      </P>
      <DataTable
        head={['You can', 'Who', 'Notes']}
        rows={[
          ['See the menus and what is on them', 'Menus view', 'Sections, dishes, prices, options, calories, allergens with their level, dietary tags, where each section shows.'],
          ['Find dishes', 'Menus view', 'By name, by tag ("vegan"), or free from allergens, on the live menus (what guests are served). A dish where the allergen can be removed on request is listed separately, so the guest can ask for it without.'],
          ['Make a menu', 'Menus manage', 'Name, venue or all venues, tagline, served times, intro, and its sections and dishes in one go. A new menu isn\'t live anywhere until it is published.'],
          ['Change or copy a menu', 'Menus manage', 'Rename, move to a venue, show to guests or hide, tagline, served times, intro. A copy keeps every section, dish, footer note and print design, and isn\'t live until published.'],
          ['Add dishes', 'Menus manage', 'Into sections already on the menu or new ones. A dish already in that section is left alone unless you ask to update it.'],
          ['Change a dish', 'Menus manage', 'Name, description, price, calories, note, online ordering on or off, house favourite, allergens and their level, dietary tags, options and their prices, which section it is in and where.'],
          ['Change or remove a section', 'Menus manage', 'Title, subtitle, where it shows (everywhere, printed menus only, nowhere), tax rate, position. Removing a section takes its dishes with it; to keep them, hide the section instead.'],
          ['Remove dishes', 'Menus manage', 'The card warns when a combo offers the dish (the combo loses that choice).'],
          ['Change prices', 'Menus manage', 'Whole menu, a section or named dishes: by a %, by an amount or to one price, with rounding. Option prices go up or down with them (not when you set one price).'],
          ['Publish a menu', 'Menus manage', 'Now or at a date and time. The card lists every change waiting to go live and warns about price changes and about another publish already scheduled.'],
          ['Cancel a scheduled publish', 'Menus manage', 'Before it goes live. The draft isn\'t changed.'],
        ]}
      />
      <P>
        Every change shows a card first. A change to a dish&apos;s allergens, and a price that
        changes by more than half, shows a <strong>Check</strong> box on the card: allergens
        show on the website, printed menus, online ordering, the allergen lookup and the till,
        so read them through before pressing Save.
      </P>
      <P>
        Changes made by chat are saved to the draft, the same as on the Menus page: Pepper
        says so and offers to publish. It only publishes when you ask.
      </P>
      <P>
        A long menu goes in batches of up to 50 dishes: Pepper shows a card that makes the
        menu with its first sections, then a card for each next section or two, all in one
        reply. Press them in order, starting with <strong>Create menu</strong>; a card pressed
        before the menu exists says so and changes nothing. A price list read from a PDF or
        photo goes the same way, up to 100 products a card.
      </P>
      <InfoBox type="info">
        Options use your option groups (Menus → Variant groups): a dish gets its own price per
        choice and the group itself isn&apos;t changed. A group name you don&apos;t have yet
        makes a new group, and the card says so. Pepper never guesses allergens from a dish
        name: if a photo or list doesn&apos;t show them, it adds the dishes without and tells
        you. It doesn&apos;t change dish photos, combo steps, print designs, till buttons, or
        the allergen and dietary tag list itself; do those on the Menus pages.
      </InfoBox>
      <H3>The rota and staff by chat</H3>
      <P>
        Ask things like <em>"Who's on tonight?"</em>, <em>"Put Jo and Sam on Saturday
        dinner"</em>, <em>"Sam is off sick tomorrow"</em>, <em>"Copy last week's rota onto
        next week"</em>, <em>"What's the wage bill this week?"</em> or <em>"Move £10 of tips
        from Jo to Sam"</em>.
      </P>
      <DataTable
        head={['You can', 'Who', 'Notes']}
        rows={[
          ['See who is working', 'Rota view', 'A day or a whole week: shifts or times, hours, who is sick or on time off, who is away (left, or off the rota for a period), and closed days.'],
          ['Change the rota', 'Rota manage', 'Put people on or take them off, or mark them sick, on paid or unpaid time off, or absent, for any days of one week. On a shift rota name the shift; on an hourly rota give the times. Someone who has left, or is off the rota for a period, can\'t be put on.'],
          ['Copy a week', 'Rota manage', 'Last week onto this week unless you say otherwise. It replaces everything on the week it copies onto; sickness and time off aren\'t copied.'],
          ['See pay and tips', 'Rota pay view, Rota tips view', 'Hours and pay per person, adjustments, bank and cash; each tip pot, points, shares and what carries to next week. The figures are the Rota page\'s own.'],
          ['Add a pay adjustment', 'Rota pay manage', 'Extra pay, a deduction, or a cash advance (it comes off next week\'s pay by itself).'],
          ['Fill Cash Recon wages from the rota', 'Rota pay manage', 'The same as the button on the Rota page.'],
          ['Move or adjust tips', 'Rota tips manage', 'Move points or tips from one person to others, or give a bonus or take some off (with a note). Enter a week\'s amounts for tip pot lines, such as the cash tips counted.'],
          ['See, add or change staff', 'Staff view, Staff manage', 'Role, hourly or fixed pay, rate, cash or bank. Set a leaving date, or a period off the rota (a long holiday, long sickness): their rota entries in it come off, and the card says how many.'],
        ]}
      />
      <InfoBox type="info">
        Paid holiday goes on the rota as paid time off (PTO). A period off the rota (on the
        Staff page) isn&apos;t paid.
      </InfoBox>
      <H3>Cash up and wages by chat</H3>
      <P>
        Ask things like <em>"How did yesterday's cash up come out?"</em>, <em>"Is this week
        balanced?"</em>, <em>"Card machine £1,240, cash £310 for today"</em>,{' '}
        <em>"Add a £12 expense for milk, paid by card"</em>, <em>"Submit Monday"</em>,{' '}
        <em>"Pay everyone their cash wages today"</em> or <em>"Fill this week from Loyverse"</em>.
      </P>
      <DataTable
        head={['You can', 'Who', 'Notes']}
        rows={[
          ['See a day or a week', 'Cash reconciliation view', 'Income, takings, service charge, expenses, wages paid from the till and the variance (negative means short), plus what isn\'t entered yet. The variance is the same figure as on the Cash Recon page.'],
          ['Enter figures', 'Cash reconciliation manage', 'Income sources, payment channels and service charge sources by name. Only what you say changes; income is split into net and VAT as on the page.'],
          ['Add an expense', 'Cash reconciliation manage', 'Gross amount, VAT, category, and whether it was paid by card (then it isn\'t counted as cash out of the till).'],
          ['Submit a day', 'Cash reconciliation manage', 'The card shows the totals and the variance first. A submitted day can only be unsubmitted on the Cash Recon page, by an owner or admin.'],
          ['See and pay wages', 'Cash reconciliation view, manage to pay', 'Each person\'s cash due and paid. Marking wages paid records the cash handed out and the day it came out of the till.'],
          ['Fill from Loyverse or GloriaFood', 'Cash reconciliation manage', 'Up to 14 days, through the venue\'s field mapping (Cash Recon settings). Submitted days are left alone; the card shows each day\'s figures first.'],
        ]}
      />
      <H3>Online orders, sold out, till and kitchen by chat</H3>
      <P>
        Ask things like <em>"Any online orders waiting?"</em>, <em>"Accept 12, ready in 20
        minutes"</em>, <em>"Order 14 is ready"</em>, <em>"Refund £3.50 on order 7"</em>,{' '}
        <em>"Stop online orders for now"</em>, <em>"The Pad Thai is sold out"</em>,{' '}
        <em>"What did the till take yesterday?"</em> or <em>"How fast was the kitchen on
        Saturday?"</em>.
      </P>
      <DataTable
        head={['You can', 'Who', 'Notes']}
        rows={[
          ['See the day\'s online orders', 'Online orders view', 'Open orders first, with dishes, collection time and whether it is paid; GloriaFood orders too when they show on the board.'],
          ['Move an order on', 'Online orders manage', 'Accept (with the minutes it takes), preparing, ready, collected, a new collection time, or paid at the counter. An order is its number that day ("12", "GF 3"), or the guest\'s name.'],
          ['Turn down, cancel or refund', 'Online orders manage', 'A reason is needed and the guest is told; a paid order is refunded. A refund can be all that is left or an amount.'],
          ['Pause online orders', 'Online orders manage', 'With an optional message for guests; start again the same way.'],
          ['See the report', 'Online orders view', 'Orders, sales, tips, discounts, VAT, refunds, by day and payment, top dishes and promotions used.'],
          ['Sold out', 'Online orders view, manage to change', 'What is sold out and until when; mark a dish sold out for today or until it is put back, or back on. The tills, online ordering, the orders board and the menu screens all show it straight away.'],
          ['Till and kitchen figures', 'Till reports view', 'A trading day\'s figures (live while it is open, else its Z report), the day\'s checks, and kitchen speed by station.'],
        ]}
      />
      <H3>Customers, opening times, tables and rules by chat</H3>
      <P>
        Ask things like <em>"Find Jane Smith"</em>, <em>"Change her phone number to 07700
        900123"</em>, <em>"Close Hertford on Boxing Day"</em>, <em>"What are the booking
        times on Sunday?"</em> or <em>"Hold online bookings for 10 minutes"</em>.
      </P>
      <DataTable
        head={['You can', 'Who', 'Notes']}
        rows={[
          ['Find and see customers', 'Customers view', 'Contact details, visits, newsletter, staff notes, their next and past bookings.'],
          ['Change a customer', 'Customers manage', 'Name, email, phone or staff notes; take them off the newsletter (only the guest can sign up again).'],
          ['Anonymise a customer', 'Customers manage', 'For a request to delete someone\'s details (GDPR). Their details on the profile, bookings and online orders are replaced; it can\'t be undone, and the card says so.'],
          ['See and change opening times', 'Schedule view, manage to change', 'Each weekday\'s booking times and coming closures. Close a venue for dates (Christmas, a private event): the card says how many bookings are already in them, and they stay. Remove a closure to reopen.'],
          ['See tables and booking rules', 'Tables view, Rules view', 'Tables by section with their covers and combinations; party sizes, how far ahead, when online bookings close, booking length and the rest.'],
          ['Change booking rules', 'Rules manage', 'Only what you say changes; the card shows each rule before and after.'],
        ]}
      />
      <P>
        Changing a sitting&apos;s times or covers, tables and combinations is done on the
        Schedule and Tables pages; Pepper gives you the link.
      </P>
      <H3>Website, promotions, reviews, screens and support by chat</H3>
      <P>
        Ask things like <em>"Is the website up to date?"</em>, <em>"Publish the
        website"</em>, <em>"Put a banner up saying we're closed today"</em>,{' '}
        <em>"Switch off the lunch deal"</em>, <em>"Any new reviews?"</em>,{' '}
        <em>"Which menu screens are offline?"</em>, <em>"Did the confirmation email reach
        Jane?"</em> or <em>"Log an issue: the card machine keeps disconnecting"</em>.
      </P>
      <DataTable
        head={['You can', 'Who', 'Notes']}
        rows={[
          ['Website status and publishing', 'Website view, manage to publish', 'Whether it is live, when it was last published and what is waiting to go live. Publishing puts every saved change live now.'],
          ['Emergency banner', 'Website manage', 'On every page straight away (no publish needed), with how urgent it is and an optional link; or off.'],
          ['Promotions', 'Promotions view, manage to switch', 'What each gives, when, uses and discount given; turn one on or off.'],
          ['Reviews', 'Website view, manage to change', 'Recent reviews with the average; the newest held per review site; approve one for the website, hide it, feature it, or save a reply. With Claude in Chrome connected, record the reviews a venue\'s Google, TripAdvisor, Deliveroo or Just Eat page shows into the To check inbox.'],
          ['Menu screens', 'Menu screens view, manage to reload', 'Which screens are online and what they show; reload one that looks stuck.'],
          ['Booking emails', 'Emails view', 'Recent confirmations, reminders, changes and cancellations: sent, failed (and why) or waiting.'],
          ['Report an issue or ask for a feature', 'Issue log, Feature requests', 'Logs it for the platform team: an issue with its impact and urgency, or a feature request others can vote for. Pepper can also list your logged issues.'],
        ]}
      />
      <H3>Finding a page</H3>
      <P>
        Ask <em>"Where do I change the opening times?"</em> or <em>"Take me to the rota"</em>{' '}
        and Pepper replies with a link to the page; tap it to go there. It only offers pages
        you can open. Quicker still: type it into the search box at the top of the menu and
        press Enter, and Pepper picks the pages for you there (see Asking Pepper to search
        the menu).
      </P>
      <H3>Attaching photos, screenshots and files</H3>
      <P>
        You can give Pepper something to read: a photo of a delivery note or a thermometer, a
        screenshot of a booking request email, a supplier's price list, a PDF, or a text or CSV
        file. Press
        the paperclip next to the message box and pick the files, paste a screenshot straight
        into the message box, or drag files onto the chat. On a tablet or phone the camera
        button takes a photo there and then. Then say what you want, for example{' '}
        <em>"Log this delivery"</em> or <em>"Book the party in this email"</em>; the message can
        be left empty.
      </P>
      <DataTable
        head={['You can attach', 'Up to']}
        rows={[
          ['Photos and screenshots (JPEG, PNG, GIF, WebP)', '5 MB each. Big photos are made smaller before they are sent, so a phone photo is fine.'],
          ['PDFs', '10 MB each'],
          ['Text and CSV files (also .md, .json, .tsv, .log)', '1 MB each'],
          ['Per message', '5 files'],
          ['Per chat', '10 files or 20 MB in all; start a new chat for more'],
        ]}
      />
      <P>
        Pepper tells you what it read before it acts on it, and asks if something is unclear
        or cut off. Every change still shows a card to confirm, so check the details on
        the card against the paper. Sent files show in the chat: tap a picture to see it full
        size, or a PDF or text file to open it. Only you can see the files you send.
      </P>
      <InfoBox type="info">
        Word, Excel and PowerPoint files can't be read: save them as a PDF (or a spreadsheet
        as CSV) first. iPhone HEIC photos are turned into JPEGs where the browser can do it;
        if one is refused, take a screenshot of it instead. If a file can't be read, the
        message and the file go back into the message box so you can try again.
      </InfoBox>
      <H3>Talking to Pepper</H3>
      <P>
        The <strong>microphone</strong> next to the message box works two ways. <strong>Tap</strong> it to start,
        speak, and tap again to stop (or just pause): the words go into the box for you to read and send.{' '}
        <strong>Hold</strong> it instead and it records for as long as you hold, pauses included; let go and
        what you said is sent straight away. If the phone takes the press away (a call, say), nothing is
        sent and the words stay in the box. On the phone the microphone is filled in, and the same one is in
        the Pepper bar at the bottom of the phone&apos;s home screen. Pepper answers in a sentence or two, with the detail on screen, and{' '}
        <strong>Read answers aloud</strong> (a switch on that page, for that phone) reads its answers out. It
        never reads out a guest&apos;s phone number or email.
      </P>
      <P>
        <strong>Confirm checks by voice</strong> (Pepper → Settings, owners and admins, off to begin with):
        in talk mode Pepper reads a check back, such as a fridge reading with its unit and whether it is in
        range, and a spoken <em>yes</em> saves it, <em>no</em> cancels it. Only checks (fridge, hold and
        cooking readings, checklist ticks) can be confirmed this way; money, orders, bookings, the rota and
        anything deleted always need a tap. Nothing listens in the background: listening starts only when
        you tap the microphone or hold the button, or just after Pepper asks yes or no. The sound isn&apos;t
        kept, only the words. Speech uses the browser&apos;s own recognition (Chrome and Edge have it), or the
        phone&apos;s in the Macaroonie Office app.
      </P>
      <H3>Looking things up on the web</H3>
      <P>
        Pepper can search the web when an answer needs something from outside the app, or newer
        than it knows: a supplier&apos;s website, official guidance, a food recall, a local event,
        how something is done. It is off until someone who can manage Pepper switches on{' '}
        <strong>Web search in Pepper&apos;s chat</strong> under Pepper → Settings (and presses
        Save). Once it is on, the empty chat says Pepper can look things up on the web. It works in
        Ask Pepper, on the Pepper page and in the phone app. Pepper decides when to search: it
        doesn&apos;t search for things the app itself answers (your bookings, rota, menus), and you
        can ask it to (<em>"look that up"</em>) or not to (<em>"don&apos;t search, just tell me
        what you know"</em>).
      </P>
      <DataTable
        head={['You see', 'What it means']}
        rows={[
          ['Searching the web... under the answer', 'Pepper is searching now. A search takes a few seconds.'],
          ['A line with a globe: Searched the web: ...', 'One search, with the words Pepper searched for. There can be several for one question.'],
          ['Sources under the answer', 'The web pages the answer uses, each with its title and website. Tap one to open it in a new tab. The first four show; Show all lists the rest. These are the only links in the chat that leave the app.'],
          ['A web search didn\'t run: the limit of 5 searches for one message was reached', 'Pepper makes at most 5 searches for one message and answers from what it found. Ask a follow-up to look further.'],
          ['A web search didn\'t run: web search is busy (or wasn\'t available)', 'That one search failed; Pepper carries on with the others or answers without it.'],
          ['Web search wasn\'t available for this one, so I answered without it', 'The search service turned the whole request down, so this answer comes from the app and what Pepper already knows. If it keeps happening, tell whoever looks after your Macaroonie account.'],
        ]}
      />
      <P>
        What a web page says is information for Pepper to weigh, never an instruction to it: a
        page can&apos;t make Pepper change anything, and every change still shows a card for you
        to confirm. For anything that matters (food safety, the law, a price you will act on),
        open the source and read it yourself: Pepper can misread a page, and a page can be wrong
        or out of date.
      </P>
      <P>
        Each search uses 2,500 units of the month&apos;s allowance (about a penny), and the pages
        Pepper reads count like the rest of the chat, so a chat with searches in it uses more than
        one without. Settings shows the month&apos;s <strong>Web searches</strong> beside the
        other figures.
      </P>
      <InfoBox type="info">
        The words Pepper searches for leave the app (they go to the search service Pepper&apos;s
        maker, Anthropic, runs). Pepper is told never to put a guest&apos;s or a staff
        member&apos;s name, email or phone number into a search, so don&apos;t ask it to look a
        person up. The chat on your website never searches the web, and an AI app connected
        through the staff connector uses its own web search, if it has one, not this one.
      </InfoBox>
      <P>
        Switching web search off (or on) takes effect with the next message in every chat. Earlier
        answers keep their sources.
      </P>
      <H3>Using your own AI app</H3>
      <P>
        <strong>Claude (claude.ai and the Claude apps), ChatGPT and other apps that sign in:</strong>{' '}
        copy the address from the Pepper page's <strong>Connect</strong> tab and add it in your AI app as a
        custom connector, leaving any OAuth client ID and secret empty. When you connect it, a Macaroonie
        page opens: sign in if asked, check it names the right app and restaurant group, tick{' '}
        <strong>Read only</strong> if the app should only look things up, pick how long it works for, and
        tap <strong>Allow</strong>. You're taken back to the app, which is now connected. It shows on the
        Connect tab with your access tokens as "(connected app)": revoke it there to disconnect it, and
        connect again when it expires. If the page says the connection is for another restaurant group,
        switch to it there first.
      </P>
      <P>
        <strong>Claude Code, Cursor and other apps that send a header:</strong> on the Pepper page, open{' '}
        <strong>Connect</strong>. Type a name, pick how long it works
        for (<strong>Works for</strong>: 30, 90 or 180 days, or a year; 90 to start with), tick{' '}
        <strong>Read only</strong> if the app should only look things up, and press{' '}
        <strong>Make token</strong>. Copy the token: it is shown once. In your AI app, add a
        custom MCP connector with the address shown and send the token as the header
        {' '}<Mono>Authorization: Bearer mcp_...</Mono>. The list shows until when each token
        works; after that it says <strong>Expired</strong> and the app gets an error asking for
        a new one. Revoke a token with its bin button when you no longer need it.
      </P>
      <P>
        Your AI app then has Pepper&apos;s tools for the areas you can use, with your
        permissions: only the tools for areas your role can see, and only the ones that change
        things where your role can change them (a read-only token gets none of those). There are
        no Pepper cards there: most apps ask you before running a tool that changes something,
        so read what it is about to do before you allow it, and don&apos;t set the app to allow
        changes without asking. A read-only token is the safe choice for an app you only ask
        questions.
      </P>
      <H3>The chat on your website</H3>
      <P>
        Switch on <strong>Chat on your website</strong> under Pepper → Settings, then add
        the <strong>AI chat</strong> block in the website builder: in the page, or as a chat
        button in the corner of the screen. Guests can ask questions and book. A booking only
        goes through when the guest presses Confirm on the card in the chat.
      </P>
      <P>
        To change or cancel a booking, the guest gives their booking reference and email, and
        we email them a 6-digit code to type into the chat. Without the code nothing can be
        changed, so nobody else can move or cancel someone's booking.
      </P>
      <H3>Settings, usage and activity</H3>
      <P>
        People who can manage Pepper (owners and admins, unless your roles say otherwise) see{' '}
        <strong>Settings</strong> and <strong>Activity</strong> on the Pepper page. Settings has
        four switches (Pepper for staff, web search in Pepper's chat, guests' AI apps, website
        chat) with one Save, and this month's usage. Web search needs Pepper for staff switched
        on: with that off, its switch is greyed out. The chats share a monthly allowance; when it
        is used up they pause until
        the next month, and the AI app connectors keep working. Activity lists every change made
        through Pepper, the website chat and AI apps: what, by whom and where; a booking made
        past the usual limits is marked.
      </P>
      <P>
        Usage counts what each reply costs, not just its length: what Pepper writes counts five
        times, and the earlier part of a chat it reads again counts a tenth or less. So a long
        chat costs much less than its size suggests, and an everyday question answered by the
        faster model uses only a small part of what the same question costs on the most
        capable one. A web search counts 2,500 units on top of what Pepper reads from it.{' '}
        <strong>Who uses it this month</strong>{' '}
        shows each person&apos;s replies, their part of the month&apos;s allowance, and how much
        of today&apos;s share they have used.
      </P>
      <DataTable
        head={['Fair use and privacy', 'What it does']}
        rows={[
          ['Each person\'s daily share', 'How much of the month\'s allowance one person can use in a day (10%, 25% or 50%, or no daily limit; 25% to start). Someone who reaches it gets a message saying so and can use Pepper again the next day; everyone else carries on.'],
          ['Keep chats for', 'Chats nobody has used for this long (30, 90 or 180 days, or a year; 90 to start) are deleted with their attached files. Chats can hold guests\' names and phone numbers, so keep them no longer than you need.'],
        ]}
      />
      <P>
        The card has its own Save. The details in Activity are cleared after a year; the line
        saying what was done stays.
      </P>
      <H3>Guests&apos; details in Pepper&apos;s chats</H3>
      <P>
        When you anonymise a customer (Customers page, or by asking Pepper), their name, email
        and phone are also removed from Pepper&apos;s chats, the website chat and the Activity
        details, written as [removed]. A chat they were removed from is closed: you can still
        read it, but not carry on in it. It shows <em>A guest&apos;s details were erased from this
        chat</em> and a <strong>Start a new chat</strong> button, and the chat list marks it.
      </P>
      <InfoBox type="info">
        Their details are found as written on their customer record, bookings and orders. A
        first name on its own, or a phone number written another way, isn&apos;t found, so
        don&apos;t keep guests&apos; details in chats longer than you need them.
      </InfoBox>
      <P>
        Pepper has its own switch on the Access page (Modules tab), and its own line in each
        role: None hides it, View lets someone chat with it. Switching it off stops Pepper and
        the staff connector; the website chat and guests&apos; AI apps have their own switches
        in Settings.
      </P>
      <H3>Turning the chats on (platform admins)</H3>
      <P>
        The chats need an Anthropic API key. On the <strong>Platform</strong> page, open the{' '}
        <strong>AI usage</strong> tab, paste the key into <strong>Anthropic API key</strong>{' '}
        and press <strong>Check and save</strong>. The key is checked with Anthropic before it
        is saved (stored encrypted), and afterwards only its last four characters are shown. The chats use it
        straight away (within a few seconds on every server). <strong>Check the key now</strong>{' '}
        tests the key in use; <strong>Remove saved key</strong> (asks you to confirm) goes back
        to the key in the server's settings file, if there is one. If a key stops working, staff
        see "The AI assistant's key isn't working" in the chat until a new one is saved.
      </P>
      <P>
        Web search is switched on by each restaurant group (Pepper → Settings). It works unless
        web search has been switched off for the Anthropic account the key belongs to (an
        administrator can do that in the Claude Console): while it is off there, Pepper answers
        without it and says <em>Web search wasn&apos;t available for this one</em>. The AI usage
        tab says which groups have web search on and how many searches each has made this month;
        Anthropic charges for each search on top of the usual use.
      </P>
    </section>
  )
}
