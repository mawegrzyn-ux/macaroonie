// src/pages/help/new-location.jsx
// The Help page's "Setting Up a New Venue" section. Help.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, InfoBox, DataTable } from './parts.jsx'

export const id = 'new-location'
export const label = 'Setting Up a New Venue'
export const order = 60

// ── NEW VENUE ───────────────────────────────────
export function Section() {
  return (
    <section id="new-location" data-help="">
      <H2>Setting Up a New Venue</H2>
      <P>
        <strong>New venue</strong> (Venues &gt; New venue in the menu, or the button on the Venues page) sets up a
        venue step by step: the venue itself, the brand, the menu, opening hours, tables and bookings, everything
        else, then a check. Nothing is made until you press <strong>Create</strong> on the last step, and you can
        stop at any point and come back: the draft is listed on the New venue page. It needs Manage on Venues.
        Pepper is optional: it can fill the steps in from a description, and it reads the menu from your files.
      </P>

      <H3>Starting a new venue</H3>
      <P>
        Pick <strong>From scratch</strong> (each area set up with sensible defaults) or{' '}
        <strong>Like a venue you have</strong> (each area copied from that venue, then you change what&apos;s
        different), and tap <strong>Start</strong>. Your first venue always starts from scratch. Each step has its
        own <strong>Save and continue</strong>; the steps list at the top jumps to any step. Moving to another step
        with changes not saved asks first: <strong>Save and go</strong>, <strong>Don&apos;t save</strong> or{' '}
        <strong>Stay here</strong>.
      </P>
      <DataTable
        head={['Step', 'What you set']}
        rows={[
          ['The venue', 'Name, web address (follows the name until you change it), time zone, currency, opening date (empty = open now), address and contact details. Describe it to Pepper (optional) fills in the later steps from a few sentences; anything you set yourself stays as you set it.'],
          ['Brand & theme', 'Your group\'s brand (logo, colours, fonts), shared by every venue. On your first venue you set it up here; later venues show it and can change it for everyone. A later venue\'s web page can also have a look of its own: Make its look builds one from a picture or a few words.'],
          ['Menu', 'Read a menu from photos or a PDF (see Menus, A menu from a photo or PDF), or tick menus the group already has for this venue\'s online ordering. Menus made here can be kept for this venue only.'],
          ['Opening hours', 'Each day open or closed with its sittings (name, from, to, covers); Same every day copies one day to the rest. Or copy them from the venue you started from, or leave them for the Schedule page.'],
          ['Tables and bookings', 'Rooms and their tables with seats (Add 6 tables for 4 adds several at once), and the booking rules: smallest and largest party, how far ahead, when online bookings stop.'],
          ['Everything else', 'How many tills, kitchen screens, kiosks and menu screens to get ready, online ordering on straight away or not, and a card per remaining area: copy, new or Later.'],
          ['Check and create', 'What will be set up, what is left for later, and anything to fix first. Create asks once more, then makes it all.'],
        ]}
      />

      <H3>What each area gets</H3>
      <P>
        Each area is <strong>Copy</strong> (brought across from the venue you started from: the card says what it
        has), <strong>New</strong> (set up from what you entered, or standard settings) or <strong>Later</strong>{' '}
        (left for someone to set up on its page). Your choice always wins.
      </P>
      <DataTable
        head={['Area', 'Copy brings', 'New sets up']}
        rows={[
          ['Opening hours', 'Each day\'s booking times, sittings and covers, and dated changes still to come (Christmas, a private hire)', 'The days and sittings from the Opening hours step'],
          ['Tables', 'Rooms, tables, combinations, pairs kept apart, floor plan places', 'The rooms and tables from the Tables step'],
          ['Booking rules', 'Booking length, party sizes, how far ahead, deposits', 'Those you gave, the rest standard'],
          ['Location page', 'The page layout, pictures, PDF menus, its own pages, with this venue\'s address (and its own look if you made one)', 'A page with the address and contact details (and its own look if you made one)'],
          ['Booking emails', 'How they\'re sent, the sender, reminders, the venue\'s own emails', ''],
          ['Online ordering', 'Menus, hours, slots, tips, payment, plus the menus you ticked', 'Set up with the menus you ticked'],
          ['Deliveroo menu file', 'Price uplift, allergen codes, dish matches', ''],
          ['Tax rates', 'Rates of its own that differ from the company\'s', ''],
          ['Store tech', 'Settings, receipts (with the new name and address), revenue streams, floor areas, printers and where tickets print', 'Settings, receipts, revenue streams'],
          ['Kitchen screens', 'Stations and kitchen flows, the flow in use', ''],
          ['Devices to link', 'The same tills, kitchen screens, kiosks and menu screens, with their settings, waiting to be linked', 'As many as you said'],
          ['Cash reconciliation', 'Income sources, payment channels, tips sources, expense categories', 'A standard set'],
          ['Food safety', 'Fridges and freezers, hold stations, check times, cooking sessions and dishes', 'The equipment and check times you gave'],
          ['Checklists', 'Every checklist with its tasks', 'Opening, closing and cleaning lists'],
          ['Dashboards', 'H&S, cash, rota and other dashboards with their widgets', ''],
          ['Purchasing', 'Suppliers\' delivery days and cutoffs, order lists, pars (scaled if trade will differ), its own prices', ''],
          ['Team', '', 'The people you named, with their role and pay'],
        ]}
      />
      <P>
        Some things are never copied because they belong to one place: supplier account numbers, the team,
        links to Loyverse or GloriaFood, card machines, and paired devices (the new ones wait to be linked). An area your role
        can&apos;t set up is left for someone who can, and goes on the list of things still to do.
      </P>

      <H3>Letting Pepper fill it in</H3>
      <P>
        On The venue step, <strong>Describe it to Pepper</strong> takes a few sentences ("a new store in Leeds like
        Ware, about 80 seats, two kiosks, opening 1 December"). Pepper fills in what you haven&apos;t set yourself:
        what to copy, the hours, the tables, the devices. If it needs to know more it asks a few questions, grouped
        by area; tick <strong>Leave it to Pepper</strong> on any of them, or <strong>Skip these</strong>. On
        Everything else, <strong>Ask Pepper about this</strong> on an area card gets a few questions about just that
        area. Pepper&apos;s short summary shows on the last step, and <strong>Print</strong> gives the plan as a page
        for whoever needs it.
      </P>

      <H3>Creating it</H3>
      <P>
        <strong>Create</strong> asks first, then makes the venue and every area at once: if anything fails,
        nothing is made and the message says which area. Before the opening date the venue stays{' '}
        <strong>closed for bookings</strong> (a "Not open yet" closure on the Schedule page) and online ordering
        stays off. Afterwards the page shows what each area got and a <strong>Still to do</strong> list (link the
        devices with the installer app, check the printers&apos; addresses, check and publish the menu made from
        your files and the location page, switch online ordering on, add supplier account numbers, add the team and
        their PINs): tick each off as it&apos;s done, and <strong>Open</strong> goes to its page.
      </P>
      <InfoBox type="tip">
        You can do this in a chat too: ask Pepper "plan a new store in Leeds like Ware". It passes on the
        questions, shows the plan, and creates it from a card you confirm. Venues started in the chat are on
        the New venue page as well, and the steps can finish them.
      </InfoBox>
    </section>
  )
}
