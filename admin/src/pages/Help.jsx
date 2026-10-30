// src/pages/Help.jsx
// Operator-facing user guide — step-by-step instructions for restaurant staff.
import { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { helpSlug } from '@shared/help.js'

const SECTIONS = [
  { id: 'getting-started',     label: 'Getting Started' },
  { id: 'today',               label: 'Today: What Needs Doing' },
  { id: 'overview',            label: 'The Overview Page' },
  { id: 'venues',              label: 'Managing Venues' },
  { id: 'new-location',        label: 'Setting Up a New Venue' },
  { id: 'tables',              label: 'Tables & Combinations' },
  { id: 'schedule',            label: 'Setting Your Schedule' },
  { id: 'schedule-exceptions', label: 'Schedule Exceptions' },
  { id: 'rules',               label: 'Booking Rules' },
  { id: 'deposits',            label: 'Deposits & Payments' },
  { id: 'timeline',            label: 'Using the Timeline' },
  { id: 'manual-booking',      label: 'Manual Booking' },
  { id: 'bookings',            label: 'Managing Bookings' },
  { id: 'customers',           label: 'Customers & GDPR' },
  { id: 'cash-recon',          label: 'Cash Reconciliation' },
  { id: 'food-safety',         label: 'Food Safety Logs' },
  { id: 'checklists',          label: 'Checklists' },
  { id: 'dashboards',          label: 'Dashboards' },
  { id: 'hs-dashboard',        label: 'H&S Dashboard' },
  { id: 'cash-dashboard',      label: 'Cash Dashboard' },
  { id: 'staff-rota',          label: 'Staff & Rota' },
  { id: 'mobile-app',          label: 'Mobile App' },
  { id: 'hs-action-log',       label: 'H&S Action Log' },
  { id: 'settings',            label: 'Settings' },
  { id: 'navigation',          label: 'Navigation & Quick Access' },
  { id: 'widget',              label: 'Booking Widget' },
  { id: 'brand',               label: 'Brand & Theme' },
  { id: 'website',             label: 'Website Builder' },
  { id: 'menus',               label: 'Menus' },
  { id: 'tax',                 label: 'Tax, Order Types & Streams' },
  { id: 'screens',             label: 'Menu Screens' },
  { id: 'online-orders',       label: 'Online Orders' },
  { id: 'loyalty',             label: 'Loyalty' },
  { id: 'ai-assistant',        label: 'Pepper (AI assistant)' },
  { id: 'purchasing',          label: 'Purchasing' },
  { id: 'till',                label: 'Till (POS)' },
  { id: 'kitchen',             label: 'Kitchen screens' },
  { id: 'kiosks',              label: 'Self-order kiosks' },
  { id: 'kiosk-analytics',     label: 'Kiosk analytics' },
  { id: 'installer',           label: 'Installer app' },
  { id: 'android-app',         label: 'Android app' },
  { id: 'emails',              label: 'Booking Emails' },
  { id: 'team',                label: 'Team Management' },
  { id: 'access',              label: 'Modules & Roles' },
  { id: 'email-monitoring',    label: 'Email Monitoring' },
  { id: 'media-library',       label: 'Media Library' },
  { id: 'reviews',             label: 'Reviews' },
  { id: 'issues',              label: 'Issue Log' },
  { id: 'feature-requests',    label: 'Feature Requests' },
  { id: 'changelog',           label: 'What is New' },
  { id: 'test-data',           label: 'Test Data (pre-prod)' },
  { id: 'faq',                 label: 'FAQ & Troubleshooting' },
]

export default function Help() {
  const [activeId, setActiveId] = useState('getting-started')
  const { hash } = useLocation()

  // A link to a section or subsection (/help#tip-pots, from Pepper or
  // elsewhere): the page is drawn after the browser looked for the anchor,
  // so scroll to it here.
  useEffect(() => {
    const id = decodeURIComponent(hash.replace(/^#/, ''))
    if (!id) return
    const t = setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }), 0)
    return () => clearTimeout(t)
  }, [hash])

  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        const visible = entries.filter(e => e.isIntersecting)
        if (visible.length) setActiveId(visible[0].target.id)
      },
      { rootMargin: '-10% 0px -75% 0px' },
    )
    document.querySelectorAll('section[data-help]').forEach(el => observer.observe(el))
    return () => observer.disconnect()
  }, [])

  return (
    <div className="flex h-full overflow-hidden">
      {/* TOC */}
      <aside className="w-52 shrink-0 border-r overflow-y-auto py-6 px-3 hidden md:block">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-2 mb-3">
          Contents
        </p>
        <nav className="space-y-0.5">
          {SECTIONS.map(s => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className={cn(
                'block px-2 py-1.5 rounded text-sm transition-colors',
                activeId === s.id
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent',
              )}
            >
              {s.label}
            </a>
          ))}
        </nav>
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-8 space-y-16">
          <div>
            <h1 className="text-2xl font-bold">Help &amp; User Guide</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Step-by-step instructions for restaurant operators and front-of-house staff.
            </p>
          </div>

          {/* ── GETTING STARTED ───────────────────────────── */}
          <section id="getting-started" data-help="">
            <H2>Getting Started</H2>
            <P>
              Welcome to Macaroonie. Follow this checklist to get your restaurant set up and ready to take
              bookings. Each step links to a section in this guide.
            </P>
            <InfoBox type="tip">
              Macaroonie lives at <strong>office.macaroonie.com</strong>. The phone app is at{' '}
              <strong>ops.macaroonie.com</strong> (see Mobile App). <strong>macaroonie.com</strong> is the
              public page about the platform, and old admin links there forward to office.macaroonie.com.
            </InfoBox>

            <div className="space-y-3 mb-6">
              {[
                ['Set up your venue', 'Venues > New venue walks you through it: the name, address and timezone, your brand, the menu (read from photos or a PDF), opening hours, tables and the rest. The timezone is critical — all booking times display in your local time.'],
                ['Add tables and sections', 'Organise your floor plan into sections (Main Floor, Terrace, Bar, etc.), then add each table with its seating capacity.'],
                ['Set table order', 'Use the Reorder button on the Tables page to drag tables into the order they appear on your floor plan. This drives the Timeline row sequence and the smart-allocation adjacency logic.'],
                ['Set up table combinations', 'If adjacent tables can be pushed together for larger parties, create a combination (e.g. T1 + T2 = combined table for 6).'],
                ['Configure your weekly schedule', 'Define which days you open and add sittings (Lunch, Dinner). Each sitting has its own slot duration, interval, and cover cap.'],
                ['Set booking rules', 'Configure minimum and maximum covers per booking, the hold time limit, and the cutoff before a slot starts.'],
                ['(Optional) Enable deposits', 'Connect your Stripe account in Ordering setup, then turn deposits on in Booking rules: guests booking online pay by card.'],
                ['Test the booking widget', 'Go to Widget Test in the sidebar and run a test booking end-to-end before going live.'],
              ].map(([title, desc], i) => (
                <div key={i} className="flex gap-3">
                  <span className="shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold mt-0.5">
                    {i + 1}
                  </span>
                  <div>
                    <p className="text-sm font-medium">{title}</p>
                    <p className="text-xs text-muted-foreground">{desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <H3>Roles explained</H3>
            <div className="space-y-2">
              {[
                ['Owner', 'Full access. Can manage billing, team, and all settings.'],
                ['Admin', 'Can configure venues, tables, schedules, and rules. Can manage bookings.'],
                ['Operator', 'Can create and manage bookings, Cash Recon, the rota and H&S checks. Can look at customers, tables and the schedule but not change them.'],                ['Viewer', 'Read-only. Can view bookings, customers, menus and schedules but cannot make changes.'],
              ].map(([role, desc]) => (
                <div key={role} className="flex gap-3 items-start border rounded-lg px-3 py-2">
                  <span className="text-sm font-semibold w-20 shrink-0">{role}</span>
                  <span className="text-sm text-muted-foreground">{desc}</span>
                </div>
              ))}
            </div>

            <H3>Switching restaurants</H3>
            <P>
              If your account is connected to more than one restaurant, the sidebar header shows
              your current restaurant's name with a small arrow next to it. Tap the name (or the
              arrow) to open the restaurant picker. If your account only has one restaurant, the
              name is shown without an arrow — there's nothing to switch to.
            </P>
            <P>
              When you sign in to a restaurant (by picking it on the login screen, or from an
              invitation link), that's the restaurant you work in, even if this browser was last used
              for another one. Switching in the sidebar afterwards sticks until you next sign in.
              Otherwise Macaroonie opens the restaurant you used last on that browser. On the phone
              (ops.macaroonie.com) the top of the home screen says which restaurant you're working in,
              with a <strong>Switch</strong> button to change it.
            </P>

            <H3>Menu on tablets</H3>
            <P>
              On a tablet (or any touch screen) the menu stays tucked away behind the{' '}
              <strong>menu button</strong> in a narrow strip down the left edge, so every page
              gets the full width of the screen. Tap it to slide the menu open, and tap outside
              the menu to close it again.
            </P>
          </section>

          {/* ── OVERVIEW PAGE ─────────────────────────────── */}
          <section id="today" data-help="">
            <H2>Today: What Needs Doing</H2>
            <P>
              <strong>Today</strong> (top of the main menu) is the place to start a shift. It says hello,
              shows the day at a glance (bookings and covers, parties of 8 or more, how many people are on
              the rota, and whether the venue is closed today), then everything that needs doing at the venue,
              with Pepper beside it. Pick the venue at the top right if you work at more than one;
              the page remembers it.
            </P>
            <H3>Where the tasks come from</H3>
            <P>
              Tasks are worked out from your own set-up and records, not by Pepper, so the list is
              there even when Pepper is switched off. They update every minute and when you tap Refresh.
            </P>
            <DataTable
              head={['Task', 'Shows when']}
              rows={[
                ['Fridge and freezer check', 'A check time in Food safety settings has fridges not logged yet'],
                ['Hot and cold hold check', 'A hold check time has stations not logged yet'],
                ['Cooking checks', 'A cooking session has fewer checks than it needs'],
                ['Corrective action needed', 'A reading (fridge, hold, cooking or delivery) is out of range with no corrective action'],
                ['A checklist', 'A checklist due today, this week or this month is not finished'],
                ['H&S action', 'An open action log entry is due today or overdue'],
                ['Send the order to...', 'A supplier order is waiting to be sent'],
                ['Book in the delivery from...', 'A supplier order sent earlier is due to arrive today'],
                ['Supplier orders waiting for approval', 'Someone asked for an order and you can approve orders'],
                ['Cash-up not submitted', "Yesterday's cash-up isn't submitted (and the venue was open)"],
                ['Online orders waiting', 'Online orders are waiting to be accepted'],
              ]}
            />
            <P>
              A task goes away by itself once the record exists: log the reading, tick the checklist, send the
              order. Closed days expect no fridge, hold or cooking checks when your group follows opening days
              in H&amp;S settings. You only see the areas your role can see; the page says which ones it left out.
            </P>
            <H3>Late, Now, Next and Later</H3>
            <DataTable
              head={['Group', 'Means']}
              rows={[
                ['Late', 'More than 30 minutes past its time, or overdue by nature (a reading needing an action, yesterday\'s cash-up)'],
                ['Now', 'Due within 30 minutes either side, or due some time today with no set time'],
                ['Next', 'Due in the next two hours'],
                ['Later', 'Later today, or due this week or month'],
              ]}
            />
            <H3>Doing a task from the page</H3>
            <P>
              Each task has one button. Fridge, hold and cooking checks and checklists open right on the page,
              the same forms as the Food safety and Checklists pages: type the readings or tick the tasks, then
              tap <strong>Done</strong>. <strong>Open the full page</strong> takes you to the page itself. Other
              tasks (a supplier order, the cash-up, online orders) open their page. If your role can only view an
              area, the button says <strong>View</strong> and the form is read only.
            </P>
            <H3>Go to</H3>
            <P>
              Your main menu as big tiles, the pages with something to do first, with a count on each.
              Tap <strong>Everything</strong> to see every page.
            </P>
            <H3>Asking Pepper on the Today page</H3>
            <P>
              Pepper sits beside the tasks (below them on a narrower screen) with suggestions for the
              day. It's the same chat as the Pepper panel, so it carries on where you left off; tap
              <strong> New chat</strong> to start again. Your messages tell Pepper which venue and day
              you're looking at.
            </P>
          </section>

          <section id="overview" data-help="">
            <H2>The Overview Page</H2>
            <P>
              <strong>Overview</strong> (the home page, sidebar nav) is built from tiles — Quick
              access shortcuts, today's stats, upcoming bookings, venue status, and (if your
              owner has added them) H&amp;S status tiles. An owner or admin can click
              <strong> Customise layout</strong> to add, remove, resize, reorder, rename, and set which
              roles can see each tile. To rename a tile, type in its <strong>Name</strong> box and tap
              Save; <strong>Use default</strong> puts the built-in name back.
            </P>
            <H3>Available tiles</H3>
            <DataTable
              head={['Tile', 'Shows']}
              rows={[
                ['Quick access shortcuts', 'Your own personal shortcut picker (see the info box below).'],
                ['Today\'s stats', 'Bookings today, covers today, deposit revenue, upcoming today.'],
                ['Upcoming bookings', 'Today\'s remaining bookings from now, soonest first.'],
                ['Venues status', 'One card per venue with an active/inactive dot and table count.'],
                ['H&S checks today', 'Combined Checklists + Food safety status for today. Below the overall badge, every checklist is listed by name (done/not done), plus one line each for fridge/freezer checks, hot/cold hold checks, and cooking checks (only the categories you actually have configured), and a delivery checks line showing how many deliveries were logged that day — grouped by venue if you have more than one. A delivery that failed a check with no corrective action noted turns the day red.'],
                ['Week\'s H&S status', 'The same status as a Monday-to-Sunday strip for the current week — one coloured cell per day.'],
                ['Allergen lookup', 'Pick a menu, search a dish, or press Allergens & diet and tap tags in the grid to list dishes that have them or are free from them. Shows Contains, May contain and Can be removed apart (see Menus, Allergen matrix).'],
              ]}
            />
            <H3>H&amp;S status colours</H3>
            <DataTable
              head={['Colour', 'Meaning']}
              rows={[
                ['Green', 'Everything due today is complete, with no unresolved out-of-range readings.'],
                ['Amber', 'Some checks are done, some aren\'t yet.'],
                ['Red', 'Either nothing has been done yet, or there\'s an out-of-range reading (temperature, hold, or cooking check) still missing a corrective action — that always takes priority over the completion count.'],
                ['Grey', 'Nothing is due or configured for that day.'],
              ]}
            />
            <P>
              The status combines Checklists (every active checklist counts, regardless of its
              daily/weekly/monthly frequency — see the Checklists section) with Food safety
              (equipment and hold temperature checks against their configured capture times, and
              cooking-check sessions against their required item count).
            </P>
            <H3>Per-role visibility</H3>
            <P>
              In edit mode, each tile shows a <strong>Visible to all</strong> / <strong>Hidden
              from N</strong> button — click it to untick specific roles. A hidden tile simply
              doesn't appear for anyone in that role; there's no partial/blurred state.
            </P>
            <InfoBox type="info">
              The <strong>Quick access</strong> tile is different from the Overview's own tile
              layout: an admin decides whether the tile appears at all (and for which roles), but
              each person still personalises which shortcuts show up inside it, from a fixed
              catalog — that part is unrelated to tile layout permissions.
            </InfoBox>
          </section>

          {/* ── VENUES ────────────────────────────────────── */}
          <section id="venues" data-help="">
            <H2>Managing Venues</H2>
            <P>
              A venue is a physical restaurant location. You can have multiple venues under one account
              (useful for restaurant groups or franchises). Each venue has its own tables, schedule, and rules.
            </P>

            <H3>Creating a venue</H3>
            <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside ml-2 mb-4">
              <li>Go to <strong>Venues</strong> in the sidebar and tap <strong>New venue</strong> (or Venues &gt; New venue in the menu).</li>
              <li>Pick <strong>From scratch</strong>, or <strong>Like a venue you have</strong> to copy one of your venues.</li>
              <li>Go through the steps: the name, address and — most importantly — the correct timezone come first.</li>
              <li>Check it on the last step and tap <strong>Create</strong>. The venue appears in the Venues list. See Setting up a new venue below.</li>
            </ol>
            <P>
              With no venues yet, the Overview shows a <strong>Set up your first venue</strong> card that opens the same steps.
            </P>

            <InfoBox type="warn">
              Always set the correct <strong>timezone</strong> for your venue. All booking times, slot
              generation, and cutoff calculations use this timezone. A wrong timezone will cause slots
              to appear at the wrong times in the widget.
            </InfoBox>

            <H3>Activating and deactivating a venue</H3>
            <P>
              Only <strong>active</strong> venues appear in the booking widget and accept new bookings.
              Deactivate a venue to take it offline temporarily (e.g. for renovation) without deleting it.
              You can reactivate it at any time from the Venues page.
            </P>
            <InfoBox type="tip">
              If your widget shows no slots and you suspect a configuration issue, first check that the
              venue is active. It is easy to accidentally deactivate a venue when editing settings.
            </InfoBox>

            <H3>Venue settings</H3>
            <P>
              Booking length, party sizes, how far ahead guests can book and deposits are set per venue on the{' '}
              <strong>Booking rules</strong> page (pick the venue at the top), so each location can have different rules.
            </P>
          </section>

          {/* ── NEW VENUE ─────────────────────────────────── */}
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

          {/* ── TABLES ────────────────────────────────────── */}
          <section id="tables" data-help="">
            <H2>Tables &amp; Combinations</H2>

            <H3>Adding tables</H3>
            <P>
              Go to <strong>Tables</strong> in the sidebar. Select your venue, then click{' '}
              <strong>Add table</strong>. Each table needs:
            </P>
            <ul className="list-disc list-inside text-sm text-muted-foreground ml-2 mb-4 space-y-1">
              <li><strong>Label</strong> — the name shown on the Timeline (e.g. T1, Bar 3, Garden A).</li>
              <li><strong>Section</strong> — which area of the restaurant this table belongs to.</li>
              <li><strong>Min covers</strong> — smallest party size this table suits.</li>
              <li><strong>Max covers</strong> — largest party size this table suits.</li>
            </ul>
            <P>
              Tables with <strong>Active</strong> turned off will not appear in the Timeline or widget
              and cannot be booked.
            </P>

            <H3>Sections</H3>
            <P>
              Sections group tables into areas of your restaurant — for example, <em>Main Floor</em>,{' '}
              <em>Terrace</em>, or <em>Private Dining Room</em>. Sections appear as labelled groups in
              the Timeline, making it easier to find a table at a glance. Create sections on the Tables
              page before adding tables to them.
            </P>

            <H3>Table combinations</H3>
            <P>
              A table combination defines two or more tables that can be pushed together to accommodate
              a larger party. For example, T1 and T2 can form a combined table for up to 8 covers.
            </P>
            <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside ml-2 mb-4">
              <li>Scroll to the <strong>Table combinations</strong> section at the bottom of the Tables page.</li>
              <li>Click <strong>Add combination</strong>.</li>
              <li>Give it a name (e.g. "T1 + T2"), set the min and max covers for the combined space, and select which tables are part of it.</li>
              <li>Save. The combination will now be offered by the booking widget for appropriately sized parties.</li>
            </ol>
            <InfoBox type="info">
              The booking widget automatically selects the right table or combination based on party size.
              When multiple options fit, the widget prefers individual tables first and only suggests
              combinations when needed for larger parties.
            </InfoBox>

            <H3>How combination tiles appear in the Timeline</H3>
            <P>
              When a combination booking is confirmed, the Timeline shows it as a single tall tile spanning
              all the member table rows — as long as those tables are adjacent in the Timeline list.
              If non-adjacent tables are combined (e.g. T1+T2 and T4, with T3A between them in the list),
              separate tiles appear at each group's position.
            </P>
            <InfoBox type="info">
              Pre-configured combinations always take priority over the adjacency rule when you drag a
              booking on the Timeline. Even if a combination's members are not neighbours in the sort
              order (e.g. T1+T2+T3B with T3A sitting between T2 and T3B), the system will use the
              combination as a relocation target. The "Allow non-adjacent tables" rule in Rules only
              affects the engine's automatic expansion, not combinations you have explicitly created.
            </InfoBox>

            <H3>Setting table order</H3>
            <P>
              The order of tables in the Tables page determines the row sequence in the Timeline{' '}
              <strong>and</strong> controls which tables are considered "next to" each other when the
              system automatically finds space for a dragged booking. Getting this order right is
              important for smart allocation to work the way your floor plan is physically laid out.
            </P>
            <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside ml-2 mb-4">
              <li>Go to <strong>Tables</strong> in the sidebar and select your venue.</li>
              <li>Click the <strong>Reorder</strong> button in the top-right header.</li>
              <li>The page switches to a flat sorted list showing all tables with position numbers on the left.</li>
              <li>Grab the <strong>grip handle</strong> (⠿) on any row and drag it up or down to the desired position.</li>
              <li>When the order looks right, click <strong>Save order</strong>. The new order takes effect in the Timeline and smart allocation immediately.</li>
            </ol>
            <InfoBox type="tip">
              Set up your table order to match the physical floor plan — tables that are physically
              adjacent should be adjacent in the list. This is what the system uses when it tries to
              combine nearby tables for a large-party booking that gets dragged to a new position.
            </InfoBox>
          </section>

          {/* ── SCHEDULE ──────────────────────────────────── */}
          <section id="schedule" data-help="">
            <H2>Setting Your Schedule</H2>
            <P>
              The schedule controls when guests can book. It has three layers, each overriding the one below:
              date overrides → weekly template → nothing (closed).
            </P>

            <H3>Weekly template</H3>
            <P>
              Go to <strong>Schedule</strong> in the sidebar. The 7-day grid shows Monday through Sunday.
              For each day you open, add one or more <strong>sittings</strong>.
            </P>

            <H3>Sittings</H3>
            <P>
              A sitting is a named service period — for example, <em>Lunch</em> from 12:00 to 15:00, or{' '}
              <em>Dinner</em> from 18:00 to 23:00. Each sitting has:
            </P>
            <div className="grid grid-cols-2 gap-3 mb-4">
              {[
                ['Name', 'Displayed in the booking widget (e.g. "Dinner").'],
                ['Start & end time', 'When this service period runs. Last slot is generated before the end time.'],
                ['Slot duration', 'How long each booking lasts (e.g. 90 minutes). Guests hold the table for this duration.'],
                ['Slot interval', 'How often new slots start (e.g. every 30 min). Shorter = more slots, more flexibility.'],
                ['Max covers', 'Total covers allowed per slot across all tables in this sitting.'],
                ['Active', 'Toggle to temporarily disable a sitting without deleting it.'],
              ].map(([label, desc]) => (
                <div key={label} className="border rounded-lg p-2.5">
                  <p className="text-xs font-semibold mb-0.5">{label}</p>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                </div>
              ))}
            </div>

            <InfoBox type="info">
              <strong>Slot duration ≠ slot interval.</strong> Duration is how long a booking occupies the
              table. Interval is how frequently new bookings can start. For example: duration 90 min,
              interval 30 min means slots at 18:00, 18:30, 19:00, etc., each holding the table for 90 minutes.
            </InfoBox>

            <H3>Editing a sitting's times or cover cap</H3>
            <P>
              To change the opening time, closing time, or default cover cap of an existing sitting,
              click the <strong>pencil (✏)</strong> icon on the right side of the sitting row.
              An inline edit form appears — update the values and click <strong>Save</strong>.
              The caps editor will re-generate slots from the new times immediately.
            </P>

            <H3>Session names</H3>
            <P>
              Give each sitting a name to identify it in reports and the top bar stats. Open the sitting
              editor (pencil icon) and enter a name in the <strong>Session name</strong> field — for
              example "Lunch", "Dinner", or "Brunch". The name appears next to the sitting's time range
              in the Schedule page and is used to label the per-sitting booking counts in the Timeline
              and Bookings top bars.
            </P>
            <InfoBox type="tip">
              Naming your sessions is optional but recommended. Without names, the stats bar shows the
              time range (e.g. "12:00–15:00") instead of a friendly label.
            </InfoBox>

            <H3>Last order time and Doors close</H3>
            <P>
              Each sitting has a <strong>Last order</strong> time (the sitting's end time). The system
              generates booking slots for all times that <em>start</em> at or before the last order time —
              including the last order time itself. A booking may therefore run past the last order time.
              If it does, the booking modal will show an amber notice ("This booking ends at HH:MM,
              after last orders"). The booking can still be confirmed.
            </P>
            <P>
              Each sitting also has an optional <strong>Doors close</strong> time. This represents when
              the venue physically closes. If a booking would end after doors close, the booking modal
              shows a red warning. Again, this is informational — the operator can still proceed.
            </P>
            <P>
              The widget uses <strong>Doors close</strong> as a hard cut-off for guest-facing bookings:
              slots at or after that time are hidden from guests. Operators creating bookings from the
              admin portal bypass this restriction entirely.
            </P>
            <InfoBox type="info">
              Set Last order time to when you want to stop accepting new sittings. Set Doors close to
              when the venue physically closes. The system handles the rest — bookings that start before
              last order but run past it or past doors close time get a warning, not a block.
            </InfoBox>

            <H3>Slot cap overrides</H3>
            <P>
              Below each sitting you can set a cover cap for a specific time slot — for example, limit
              the 13:00 slot to 20 covers even though the sitting allows 50. Set a cap to 0 to block
              a specific slot entirely. Leave the cap field empty to use the sitting's default.
            </P>

            <H3>Copying a day's schedule</H3>
            <P>
              Click the copy icon on any day column to copy all its sittings to another day.
              This is useful when your Mon–Fri schedule is the same: configure Monday, then copy to
              Tuesday through Friday.
            </P>

            <H3>Date overrides</H3>
            <P>
              A date override replaces the weekly template for a specific date. Use it to:
            </P>
            <ul className="list-disc list-inside text-sm text-muted-foreground ml-2 mb-4 space-y-1">
              <li>Close on a bank holiday — mark the date as <strong>Closed</strong>.</li>
              <li>Run a different schedule on a special event day — add custom sittings for that date.</li>
            </ul>
            <P>
              Date overrides are added from the Schedule page by clicking the calendar icon on the
              relevant day.
            </P>
          </section>

          {/* ── SCHEDULE EXCEPTIONS ───────────────────────── */}
          <section id="schedule-exceptions" data-help="">
            <H2>Schedule Exceptions</H2>
            <P>
              Schedule exceptions let you apply alternative schedules or closures for a specific date range —
              for example, a Christmas closure, reduced hours during a refurbishment, or a special event week
              with different sitting times. Exceptions override your normal weekly schedule during the date range.
            </P>

            <H3>Types of exception</H3>
            <DataTable
              head={['Type', 'When to use', 'What happens']}
              rows={[
                ['Closed', 'Bank holidays, full closures', 'No slots are offered for any date in the range. Widget shows no availability.'],
                ['Alternative schedule', 'Reduced hours, seasonal menus, special events', 'You configure a separate weekly schedule for the exception period. Days with no exception template fall back to your normal weekly schedule.'],
              ]}
            />

            <H3>Creating an exception</H3>
            <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside ml-2 mb-4">
              <li>Go to <strong>Schedule</strong> and scroll to the <strong>Schedule Exceptions</strong> section below the weekly grid.</li>
              <li>Click <strong>Add exception</strong>.</li>
              <li>Give it a descriptive name (e.g. "Christmas 2026"), set the date range, and choose whether the period is <strong>Closed</strong> or has an <strong>Alternative schedule</strong>.</li>
              <li>Set a <strong>Priority</strong> number. Higher priority wins when two exceptions cover the same date. Narrower date ranges win on equal priority.</li>
              <li>Save. A card appears in the exceptions list.</li>
            </ol>

            <H3>Configuring an alternative schedule exception</H3>
            <P>
              After creating an alternative-schedule exception, click <strong>Configure</strong> on its card.
              You will see 7 day cards (Monday–Sunday). For each day you want to customise:
            </P>
            <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside ml-2 mb-4">
              <li>Toggle the day <strong>Open</strong>.</li>
              <li>Set the slot interval for that day.</li>
              <li>Add sittings with their own start/end times, cover cap, and doors-close time.</li>
            </ol>
            <InfoBox type="info">
              Days within the exception period that have no exception day template fall back to your normal
              weekly schedule automatically — you only need to configure the days that differ.
            </InfoBox>
            <InfoBox type="warn">
              Exceptions are resolved at slot-generation time. Changes take effect for all future slot requests
              immediately — no rebuild required.
            </InfoBox>
          </section>

          {/* ── RULES ─────────────────────────────────────── */}
          <section id="rules" data-help="">
            <H2>Booking Rules</H2>
            <P>
              Booking rules control the constraints applied to all bookings at a venue.
              Go to <strong>Rules</strong> in the sidebar, or access them via your venue's settings page.
            </P>

            <div className="space-y-3 mb-6">
              {[
                {
                  label: 'Min / Max covers',
                  desc: 'The smallest and largest party size accepted per booking. Guests entering a party size outside this range will be told no tables are available.',
                },
                {
                  label: 'Hold time limit (hold_ttl_secs)',
                  desc: 'How long a guest has to complete their booking after selecting a slot. Default is 300 seconds (5 minutes). After this, the slot is released and becomes available again. The widget shows a countdown.',
                },
                {
                  label: 'Booking cutoff (cutoff_before_mins)',
                  desc: 'How many minutes before a slot starts it becomes unbookable online. For example, a 30-minute cutoff means guests cannot book the 19:00 slot after 18:30. Walk-ins are not affected.',
                },
                {
                  label: 'Slot duration',
                  desc: 'The default booking duration in minutes. This is used when creating holds and bookings. It can be overridden per sitting in the Schedule. Individual bookings can also be manually resized from the Timeline.',
                },
              ].map(({ label, desc }) => (
                <div key={label} className="border rounded-lg p-3">
                  <p className="text-sm font-semibold mb-1">{label}</p>
                  <p className="text-sm text-muted-foreground">{desc}</p>
                </div>
              ))}
            </div>

            <InfoBox type="tip">
              Start with a 5-minute hold time for busy services. Increase to 10–15 minutes if your
              guests tend to be slower completing the booking form, or if you see many abandoned holds.
            </InfoBox>

            <H3>Smart allocation rules</H3>
            <P>
              These settings control how the smart-allocation engine behaves when a large-party booking
              is dragged to a new table row and needs to span multiple tables.
            </P>
            <div className="space-y-3 mb-4">
              {[
                {
                  label: 'Allow combining tables from different sections',
                  desc: 'Off by default. When off, the engine will only expand into tables within the same section (e.g. Main Floor). Turn on if your floor plan allows cross-section combinations (e.g. joining a Main Floor table with a Terrace table).',
                },
                {
                  label: 'Allow combining non-adjacent tables',
                  desc: 'Off by default. Controls automatic adjacency expansion only — when the engine is building a multi-table group on the fly, it will not skip over other tables to reach a non-neighbouring one. This setting does NOT affect pre-configured combinations: a combination you have explicitly created in the Tables page is always eligible as a relocation target, regardless of whether its members are adjacent in the sort order. Turn this on if you also want the engine\'s automatic expansion to be able to skip neighbours.',
                },
              ].map(({ label, desc }) => (
                <div key={label} className="border rounded-lg p-3">
                  <p className="text-sm font-semibold mb-1">{label}</p>
                  <p className="text-sm text-muted-foreground">{desc}</p>
                </div>
              ))}
            </div>

            <H3>Disallowed table pairs</H3>
            <P>
              Found at the bottom of the <strong>Tables</strong> page. You can add specific table pairs
              that the smart-allocation engine should <em>never</em> combine — for example, if two tables
              are in the same section but are physically separated by a structural column.
            </P>
            <ol className="space-y-1.5 text-sm text-muted-foreground list-decimal list-inside ml-2 mb-4">
              <li>Go to <strong>Tables</strong>, scroll to the <strong>Disallowed pairs</strong> section.</li>
              <li>Select the first table from the left dropdown, then the second from the right dropdown.</li>
              <li>Click <strong>Add</strong>. The pair is saved and the engine will never combine those two tables.</li>
              <li>Click the × next to any existing pair to remove the restriction.</li>
            </ol>
            <InfoBox type="info">
              Disallowed pairs apply only to the smart-allocation engine (drag-to-table on the Timeline).
              An operator can still manually assign any table combination via the booking drawer Override.
            </InfoBox>

            <H3>Opening hours enforcement</H3>
            <P>
              Found in the <strong>Rules</strong> page under its own section heading.
            </P>
            <div className="space-y-3 mb-4">
              {[
                {
                  label: 'Allow widget bookings past doors-close time',
                  desc: 'When off (default), the booking widget hides all slots at or after the Doors close time set on each day in the Schedule. Admin-created bookings from the Timeline always bypass this restriction. Turn it on if you want guests to be able to book late slots that run past physical closing — for example, a late-night sitting that ends after the bar closes.',
                },
              ].map(({ label, desc }) => (
                <div key={label} className="border rounded-lg p-3">
                  <p className="text-sm font-semibold mb-1">{label}</p>
                  <p className="text-sm text-muted-foreground">{desc}</p>
                </div>
              ))}
            </div>

            <H3>Re-confirmed status</H3>
            <P>
              When <strong>Enable re-confirmed status</strong> is turned on in Rules, a <em>Re-confirmed</em> status
              option appears in the booking status dropdown inside the booking drawer. Use this to record that
              a staff member has called the guest the day before and confirmed they are still attending.
              This is separate from the call-to-confirm workflow — both can be enabled independently.
            </P>

            <H3>Arrived status</H3>
            <P>
              When <strong>Enable arrived status</strong> is turned on in Rules (it is on by default),
              an <em>Arrived</em> status option appears in the booking status dropdown. Set a booking to
              Arrived when the guest walks in — before they are shown to their table. This gives
              front-of-house a clear intermediate state between Confirmed and Seated.
            </P>
          </section>

          {/* ── DEPOSITS ──────────────────────────────────── */}
          <section id="deposits" data-help="">
            <H2>Deposits &amp; Payments</H2>
            <P>
              A venue can take a deposit when guests book online. The guest pays by card in the booking
              widget, and the money goes straight to your own Stripe account (the one you connect for online
              orders). Bookings your staff add on the Timeline or the Bookings page take no deposit.
            </P>

            <H3>Turning deposits on</H3>
            <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside ml-2 mb-4">
              <li>
                Connect your Stripe account first: <strong>Online orders</strong> &gt; <strong>Ordering setup</strong> &gt;{' '}
                <strong>Your Stripe account</strong> &gt; <strong>Connect Stripe</strong>. Guests can&apos;t pay a deposit
                until Stripe says your account can take payments.
              </li>
              <li>Open <strong>Booking rules</strong>, pick the venue and tick <strong>Take a deposit with online bookings</strong>.</li>
              <li>Choose <strong>One amount per booking</strong> or <strong>An amount per guest</strong>, and type the amount in pounds (for example 10 or 7.50).</li>
              <li>
                Under <strong>Refunded when the guest cancels at least this many hours before</strong>, type the hours
                (for example 24). Leave it empty to keep the deposit whenever a guest cancels.
              </li>
              <li>Press <strong>Save deposit rules</strong>.</li>
            </ol>
            <InfoBox type="warn">
              While deposits are on and Stripe isn&apos;t connected (or not ready yet), the Booking rules page says so in
              amber, and guests can&apos;t book that venue online at all: the widget asks them to phone instead.
            </InfoBox>

            <H3>What the guest sees</H3>
            <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside ml-2 mb-4">
              <li>The widget says a deposit is taken (for example &quot;A deposit of £5.00 a guest&quot;) when they choose the party size.</li>
              <li>They pick a date and time, then type their details. Email is needed for a deposit: Stripe sends the receipt there.</li>
              <li><strong>Continue to payment</strong> holds the table for 15 minutes while they pay with card, Apple Pay or Google Pay.</li>
              <li>Once Stripe confirms the payment, the booking is made and the confirmation page shows the deposit paid.</li>
              <li>If they go back or give up, the table is let go and nothing is charged.</li>
            </ol>
            <P>
              The booking is only made once Macaroonie has checked with Stripe that the money was taken; what the guest&apos;s
              browser says is never enough. If the payment goes through but the table was taken in the meantime (the guest
              waited far too long), the deposit is refunded straight away and the guest is asked to pick another time.
            </P>

            <H3>When a guest cancels</H3>
            <P>
              Guests can cancel from the link in their confirmation email. If they cancel at least the hours you set before
              the booking, the deposit goes back to their card by itself, and the page tells them so. Later than that (or if
              you left the hours empty), the deposit is kept, and the page says that before they confirm.
            </P>

            <H3>Refunding a deposit yourself</H3>
            <P>
              Open the booking (Timeline or Bookings). The <strong>Deposit</strong> part of the booking shows what was paid,
              anything refunded and the cancellation rule. Owners and admins see <strong>Refund…</strong>: leave the amount
              empty to refund all that is left, or type part of it (for example 5), then press <strong>Yes, refund</strong>.
              You can refund in several parts. The money goes back to the guest&apos;s card, usually within 5 to 10 working days.
            </P>
          </section>

          {/* ── TIMELINE ──────────────────────────────────── */}
          <section id="timeline" data-help="">
            <H2>Using the Timeline</H2>
            <P>
              The Timeline is your main day-to-day tool. It shows all tables as rows and time as columns,
              with confirmed bookings displayed as coloured tiles.
            </P>

            <H3>Navigation</H3>
            <ul className="list-disc list-inside text-sm text-muted-foreground ml-2 mb-4 space-y-1">
              <li>Use the <strong>← →</strong> arrows to move one day at a time, or click the date field to jump to any date.</li>
              <li>Click <strong>Today</strong> to return to the current date instantly.</li>
              <li>Switch venue using the <strong>venue selector</strong> in the sidebar (shown only if you have more than one venue).</li>
              <li>Scroll horizontally to see earlier or later times. <strong>Table labels stay pinned</strong> on the left so you always know which row you're looking at.</li>
            </ul>

            <H3>Reading the Timeline</H3>
            <P>
              Time columns on the Timeline are colour-coded to help you see availability at a glance:
            </P>
            <DataTable
              head={['Column colour', 'Meaning']}
              rows={[
                ['White / clear', 'The venue is open at this time and there is available capacity.'],
                ['Grey', 'The venue is closed at this time (before/after sittings, between sittings) OR a slot cap has been explicitly set to 0.'],
                ['Blue card', 'A confirmed booking occupies this table at this time.'],
                ['Light blue card', 'A combination booking spanning multiple table rows.'],
              ]}
            />
            <InfoBox type="info">
              A grey column means the venue is closed at that time or the slot cap is set to 0. A fully-booked
              slot stays white — it is still structurally open. If a table shows white but has no booking
              card, capacity is available. Use Manual allocation to book outside the schedule if needed.
            </InfoBox>

            <H3>Booking tile colours</H3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-6">
              {[
                ['Not confirmed', '#fed7aa', '#f97316'],
                ['Confirmed', '#bfdbfe', '#3b82f6'],
                ['Re-confirmed', '#c7d2fe', '#6366f1'],
                ['Pending payment', '#fde68a', '#d97706'],
                ['Arrived', '#a5f3fc', '#0891b2'],
                ['Seated', '#86efac', '#16a34a'],
                ['Checked out', '#e5e7eb', '#9ca3af'],
                ['Cancelled', '#fca5a5', '#ef4444'],
                ['No show', '#d1d5db', '#9ca3af'],
              ].map(([label, bg, border]) => (
                <div
                  key={label}
                  className="flex items-center gap-2 px-2.5 py-2 rounded-lg border-l-4 text-sm"
                  style={{ background: bg, borderLeftColor: border }}
                >
                  {label}
                </div>
              ))}
            </div>

            <H3>Tile modes</H3>
            <P>
              The Timeline supports two tile layouts. Toggle between them using the{' '}
              <strong>Detail</strong> button in the sidebar:
            </P>
            <DataTable
              head={['Mode', 'What it shows']}
              rows={[
                ['Compact (default)', 'Single-line tile: covers count and guest name. Row height and font size adjustable (S/M/L) in Settings.'],
                ['Detailed', 'Three-line tile: name + covers + notes indicator / phone number / table allocation. Row height is fixed at 72 px.'],
              ]}
            />

            <H3>Timeline controls</H3>
            <P>
              View settings for the Timeline live in the <strong>sidebar</strong> (left panel), just above
              the logout button. They only appear when you are on the Timeline page.
            </P>
            <DataTable
              head={['Control', 'What it does']}
              rows={[
                ['Venue selector', 'Switch between venues (shown only if you have more than one).'],
                ['Detail toggle', 'Switch between compact (dense) and detailed (3-line) tile layout. See Tile modes above.'],
                ['Inactive', 'Hide/show cancelled, no-show, and checked-out bookings on the canvas.'],
                ['Sections', 'Show/hide section divider labels between table groups.'],
                ['Panel', 'Switch between a docked right panel and a floating overlay for the booking detail drawer.'],
                ['Refresh', 'Force-reload all bookings for the current date.'],
                ['Full screen', 'Expand to full screen — useful at the host stand. Press Escape or click again to exit.'],
              ]}
            />

            <H3>Making a new booking</H3>
            <ol className="space-y-1.5 text-sm text-muted-foreground list-decimal list-inside ml-2 mb-4">
              <li>Tap the <strong>round + button</strong> at the bottom-right of the Timeline — <em>or</em> click directly on any empty cell on the Timeline canvas. Clicking the canvas opens the manual allocation screen pre-filled with that time and table.</li>
              <li>Select the party size (covers).</li>
              <li>Select an available time slot. If you clicked the canvas, the matching slot is already highlighted. The slot label shows which table or combination will be assigned.</li>
              <li>Click <strong>Continue</strong> to proceed to guest details.</li>
              <li>Enter the guest's name, email, and optionally phone number and notes.</li>
              <li>Click <strong>Confirm booking</strong>. The booking appears on the Timeline immediately.</li>
            </ol>

            <H3>Drag to reschedule (desktop)</H3>
            <P>
              Click and drag any booking tile to move it. Release to confirm. The booking is updated
              immediately and broadcast to all other logged-in users.
            </P>
            <div className="space-y-2 mb-4">
              {[
                ['Same row, new time', 'Drag left or right — the booking moves to the new time, keeping its current table and duration.'],
                ['Different table row, same or new time', 'Drag up or down (with or without a horizontal shift) — the system automatically finds the best table arrangement for the booking\'s party size anchored to the table you drop onto. See smart allocation below.'],
              ].map(([label, desc]) => (
                <div key={label} className="flex gap-3 items-start border rounded-lg px-3 py-2.5 text-sm">
                  <span className="font-semibold w-52 shrink-0">{label}</span>
                  <span className="text-muted-foreground">{desc}</span>
                </div>
              ))}
            </div>

            <H3>Smart allocation on cross-table drop</H3>
            <P>
              When you drop a booking on a <em>different</em> table row, Macaroonie automatically works
              out the best table arrangement for the booking's party size, anchored to the table you
              dropped on:
            </P>
            <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside ml-2 mb-4">
              <li><strong>Single table first</strong> — if the target table can seat the whole party, it is used alone.</li>
              <li><strong>Combination second</strong> — if a configured combination includes the target table and has enough capacity, the smallest fitting combination is used.</li>
              <li><strong>Adjacent tables third</strong> — if no combination fits, the system expands outward from the target table (using your table sort order) until there is enough combined capacity.</li>
            </ol>
            <P>
              If any of the tables in the chosen arrangement are already occupied at that time, the
              system tries to move the conflicting booking to another free table. If no free table
              exists, the conflicting booking is moved to the <strong>Unallocated</strong> row.
            </P>

            <H3>The Unallocated row</H3>
            <P>
              The Unallocated row appears at the very top of the Timeline (highlighted in orange) when
              the system has been unable to find a free table for a displaced booking during a
              smart-allocation cascade.
            </P>
            <ul className="list-disc list-inside text-sm text-muted-foreground ml-2 mb-4 space-y-1">
              <li>Bookings in the Unallocated row <strong>still exist and are confirmed</strong> — they just have no table assigned yet.</li>
              <li>You <strong>cannot drop</strong> bookings into the Unallocated row manually — it is managed by the system only.</li>
              <li>To re-assign an unallocated booking, <strong>drag it out</strong> of the Unallocated row and drop it onto any real table row. Smart allocation runs again from that target table.</li>
              <li>The Unallocated row disappears automatically once all bookings in it have been re-assigned.</li>
            </ul>
            <InfoBox type="warn">
              Resolve unallocated bookings before the service starts. Guests with unallocated bookings
              have no table and will need to be seated manually.
            </InfoBox>

            <H3>Manual Mode</H3>
            <P>
              The <strong>Manual</strong> button (hand icon, turns amber when on) in the timeline
              sidebar switches off smart cascade displacement. In Manual Mode, dragging a booking
              to a new table places it there directly — even if another booking is already in that
              slot. No conflicts are moved, no Unallocated row is used.
            </P>
            <P>
              Use Manual Mode when you want to rearrange tables yourself, create a deliberate
              temporary overlap, or resolve a complex seating puzzle step by step. Overlapping
              tiles still show the red stop-sign badge so you can see exactly what needs fixing.
              Turn Manual Mode off when you're done to restore the smart cascade behaviour.
            </P>
            <InfoBox type="warn">
              Manual Mode can create double-bookings on the same table. Always check for red
              stop-sign badges before the service starts and resolve any overlaps.
            </InfoBox>

            <H3>Accessing a booking stacked beneath another</H3>
            <P>
              When two bookings overlap on the same table row, the top tile receives taps normally.
              To open the booking drawer for the tile <em>beneath</em> it, press and hold the top
              tile for <strong>5 seconds</strong> without moving your finger — the drawer for the
              underlying booking opens instead. Moving more than a few pixels during the hold
              cancels it and starts a normal drag.
            </P>

            <H3>Hold to drag (mobile / touch screen)</H3>
            <P>
              On a touch device, tap a booking tile to open the detail drawer. To drag it, press and hold
              for <strong>0.25 seconds</strong> until the tile activates, then drag to the new position.
              A short tap always opens the drawer — a long press starts the drag.
            </P>

            <H3>Resize booking duration</H3>
            <P>
              On desktop, grab the <strong>right edge</strong> of any booking tile and drag left or right
              to shorten or extend the booking. Duration snaps to 15-minute increments. The new end time
              is saved automatically when you release. This override is remembered — dragging the booking
              later will preserve the custom duration.
            </P>

            <H3>Full screen mode</H3>
            <P>
              Click the <strong>Full screen</strong> button in the sidebar (Timeline controls section) to
              expand to full screen — useful on tablets at the host stand. The icon changes to a Minimize
              icon when you are in full screen. Press <strong>Escape</strong> or click the icon again to exit.
            </P>

            <H3>Live updates</H3>
            <P>
              The Timeline updates automatically via WebSocket when bookings are created, modified, or
              cancelled by another user. You do not need to refresh the page. The refresh button in the
              toolbar forces an immediate re-fetch if you suspect the view is out of sync.
            </P>

            <H3>Current time indicator</H3>
            <P>
              When you are viewing <strong>today's date</strong>, a red vertical line runs across all table
              rows showing the current time. A dot and the time label appear in the header bar at the top of
              the line. The line updates every 30 seconds. It is not shown when viewing past or future dates.
            </P>

            <H3>Opening hour line</H3>
            <P>
              A configurable thick vertical line marks the start time of the first sitting for the day.
              It spans the full height of the Timeline — through the header row and all table rows — so you
              can see at a glance when service begins. Colour and visibility are controlled in{' '}
              <strong>Settings → Appearance → Opening hour line</strong>.
            </P>

            <H3>Top bar stats</H3>
            <P>
              On tablet and desktop, the top bar shows a live count of active bookings and covers for
              the selected date. When you have two or more sittings, each sitting appears separately
              with its booking count and cover count — using the session name if you have set one, or
              the sitting time range as a fallback. Cancelled, no-show, and checked-out bookings are
              excluded from all counts.
            </P>

            <H3>Overlapping bookings</H3>
            <P>
              If two active bookings are assigned to the same table at the same time, both tiles are
              highlighted with a <strong>red border</strong> and a <strong>⛔ stop sign</strong> badge
              in the top-right corner. This is a warning — the system will not prevent you from creating
              the overlap (some operators do this intentionally for walk-ins). Resolve the conflict by
              dragging one booking to a different table or updating its table assignment in the drawer.
            </P>
          </section>

          {/* ── MANUAL BOOKING ────────────────────────────── */}
          <section id="manual-booking" data-help="">
            <H2>Manual Booking</H2>
            <P>
              The standard <strong>+ New booking</strong> flow automatically finds the best available table for
              the chosen date, time, and covers. Sometimes you need to place a booking that bypasses these rules —
              for example, a walk-in after last orders, a VIP seated at a reserved table, or a booking made
              during a closed period. Use <strong>Manual allocation</strong> for these cases.
            </P>

            <H3>How to create a manual booking</H3>
            <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside ml-2 mb-4">
              <li>Tap the <strong>round + button</strong> at the bottom-right of the Timeline — <em>or</em> click any empty cell on the canvas (which opens the manual allocation screen directly with that time pre-filled).</li>
              <li>Select the number of covers on the slot-selection screen.</li>
              <li>Instead of picking a time slot, click the <strong>Manual allocation</strong> button (amber, next to Continue).</li>
              <li>In the Manual allocation panel, set the <strong>date</strong> and <strong>time</strong> freely — any date or time is valid regardless of your schedule.</li>
              <li>Select the <strong>table(s)</strong> for this booking. Tables that already have a booking at the chosen time are shown with a <strong>Booked</strong> badge — but you can still select them if needed (you are overriding the system).</li>
              <li>If no specific table is needed, tick <strong>Unallocated</strong> instead. The booking will appear in the Unallocated row on the Timeline and can be dragged to a table later.</li>
              <li>Click <strong>Continue to guest details</strong>, fill in the guest's name and email, then confirm.</li>
            </ol>

            <InfoBox type="warn">
              Manual allocation bypasses schedule, capacity, and booking-window rules entirely. It will not
              prevent double-booking a table — the system trusts the operator's judgement. Use with care.
            </InfoBox>

            <H3>Multiple tables in a manual booking</H3>
            <P>
              You can select more than one table in the manual allocation panel. If a combination already exists
              for those exact tables, it will be used. If not, a new combination is automatically created and
              named after the selected tables (e.g. "T1 + T2"). The combination appears in the Timeline as a
              single spanning tile across all member table rows.
            </P>

            <H3>Walk In bookings</H3>
            <P>
              For guests who arrive without a booking, click <strong>+ New booking</strong>, choose a slot or
              click <strong>Manual allocation</strong>, then on the guest details step click the{' '}
              <strong>Walk In</strong> button instead of filling in any details. The booking is created
              immediately as "Walk In" with no guest name or email required. Walk-in bookings appear on the
              Timeline and Bookings list like any other booking and their status can be updated as normal.
            </P>
          </section>

          {/* ── BOOKINGS ──────────────────────────────────── */}
          <section id="bookings" data-help="">
            <H2>Managing Bookings</H2>
            <P>
              Tap or click any booking tile on the Timeline to open the <strong>Booking Drawer</strong> —
              a panel on the right side of the screen with full details and editing options.
            </P>

            <H3>Editing guest details</H3>
            <P>
              Click <strong>Edit</strong> next to the Guest details section header to change the guest's
              name, email, phone number, or the number of covers. The covers field supports both the ±
              buttons and direct typing — tap the number to type a new value directly. Changes save
              when you click the save button in the drawer header.
            </P>

            <H3>Rescheduling or changing the end time</H3>
            <P>
              In the Date &amp; time section of the booking drawer, you will see two pill buttons — one
              showing the start date and time, and one showing the end time. Click either pill to open
              the inline date and time editor:
            </P>
            <ul className="list-disc list-inside text-sm text-muted-foreground ml-2 mb-4 space-y-1">
              <li><strong>Date</strong> — click the field to open the OS date picker.</li>
              <li><strong>Start time</strong> — change the booking start time.</li>
              <li><strong>End time</strong> — extend or shorten the booking without affecting the start time.</li>
            </ul>
            <P>
              Once you have made your changes, click the contextual save button that appears in the drawer
              header (e.g. <em>"Move booking"</em> or <em>"Save end time"</em>). The booking is updated
              immediately. Click the start pill again to close the editor without saving.
            </P>
            <InfoBox type="tip">
              Use the end time field when a table is running over — update it so the Timeline reflects
              actual occupancy and staff know the table is still in use.
            </InfoBox>

            <H3>Reassigning a table or combination</H3>
            <P>
              Click <strong>Override</strong> in the Table assignment section. You will see a list of
              all active tables with checkboxes — you can select one table or multiple tables. The
              checkboxes are pre-ticked with the booking's current table assignment so you can see
              exactly what is already assigned and make targeted changes.
            </P>
            <ul className="list-disc list-inside text-sm text-muted-foreground ml-2 mb-4 space-y-1">
              <li>Select a <strong>single table</strong> — the booking moves to that table alone.</li>
              <li>Select <strong>multiple tables</strong> — Macaroonie finds a matching pre-configured combination or creates one automatically. The new combination will also appear in the Tables page for future use.</li>
              <li>Select <strong>Unallocated</strong> at the top of the list to move the booking out of any table assignment. It will appear in the orange Unallocated row on the Timeline and can be dragged to a real table later.</li>
              <li>A warning appears if the selected table(s) cannot seat the booking's party size.</li>
            </ul>
            <P>
              The <strong>Save</strong> button for the override appears at the top of the drawer panel,
              next to the × close button — so it is always visible without scrolling.
            </P>
            <InfoBox type="warn">
              If the booking's cover count exceeds the capacity of the currently assigned table or
              combination, an amber warning is shown in the table section of the drawer — even when
              you are not in table-edit mode. This is a reminder to reassign to a larger table.
            </InfoBox>
            <InfoBox type="tip">
              All save actions (table override, guest details, notes, reschedule) appear in the drawer
              header next to the × button when you are in an edit mode. Click × to close the drawer —
              this does <em>not</em> save. Use the contextual save button (e.g. "Assign T1 + T2",
              "Save notes") to save changes.
            </InfoBox>

            <H3>Booking statuses</H3>
            <DataTable
              head={['Status', 'Tile colour', 'When to use']}
              rows={[
                ['Unconfirmed', 'Orange', 'Guest booked online; you need to call to confirm. Only shown when the "Call to confirm" flow is enabled in Rules.'],
                ['Confirmed', 'Blue', 'Booking is confirmed and expected.'],
                ['Re-confirmed', 'Indigo', 'You have called the guest to reconfirm their attendance. Optional — enable in Rules.'],
                ['Arrived', 'Cyan', 'Guest has arrived at the venue. Set this when the party walks in the door.'],
                ['Seated', 'Green', 'Guest has been shown to their table and is seated.'],
                ['Checked out', 'Grey', 'Guest has finished and left. Table is free. This status is excluded from capacity counts.'],
                ['Cancelled', 'Red (faded)', 'Booking has been cancelled. The slot is released back to availability.'],
                ['No show', 'Grey (faded)', 'Guest did not arrive. The slot is released.'],
              ]}
            />
            <InfoBox type="tip">
              Change status quickly by clicking the status badge in the Bookings list — a dropdown appears inline.
              On the Timeline, click a booking card to open the detail panel and change status there.
            </InfoBox>

            <H3>Operator notes</H3>
            <P>
              Click the notes area at the bottom of the drawer to add or edit internal notes. Notes are
              visible only to staff — they are never shown to guests. Useful for allergy information,
              special occasion details, or follow-up actions.
            </P>

            <H3>Issuing a refund</H3>
            <P>
              If a deposit was taken, a <strong>Deposit</strong> part appears in the drawer with what was paid and
              refunded. Owners and admins press <strong>Refund…</strong>, leave the amount empty for all of it or type
              part, then <strong>Yes, refund</strong>. See Deposits &amp; Payments.
            </P>

            <H3>Viewing all bookings</H3>
            <P>
              The <strong>Bookings</strong> page in the sidebar shows a searchable, filterable list of
              all bookings across all dates — useful for looking up a specific guest or reference number.
            </P>
          </section>

          {/* ── CUSTOMERS & GDPR ──────────────────────────────── */}
          <section id="customers" data-help="">
            <H2>Customers &amp; GDPR</H2>
            <P>
              Macaroonie automatically builds a customer database as bookings are confirmed. Every time a
              booking is made with an email address, a customer profile is created or updated. You can search,
              view, and manage customer records from the <strong>Customers</strong> page in the sidebar.
            </P>

            <H3>Searching for a customer</H3>
            <P>
              Go to <strong>Customers</strong> and type in the search box at the top. You can search by
              name, email address, or phone number. Results appear immediately as you type. Click any
              customer row to open their full profile in the right-hand panel.
            </P>

            <H3>Customer profile</H3>
            <P>
              The detail panel shows the customer's contact details and their full booking history — date,
              venue, table, covers, and status for every booking linked to their record.
            </P>

            <H3>Customer search while taking a booking</H3>
            <P>
              When creating a new booking via the <strong>+ New booking</strong> button, as you type a
              name, email, or phone number in the guest details step, a panel appears to the right of the
              booking form showing matching customer records. Clicking a match pre-fills the name, email,
              and phone fields automatically — no need to type everything out for returning guests.
            </P>

            <H3>GDPR — Exporting a customer's data</H3>
            <P>
              If a customer requests a copy of all personal data held about them (a Subject Access Request
              under GDPR), open their profile from the Customers page and click{' '}
              <strong>Export customer data (JSON)</strong>. This downloads a JSON file containing their
              contact details and the full history of their bookings with your venue.
            </P>

            <H3>GDPR — Anonymising a customer</H3>
            <P>
              If a customer requests that their personal data be deleted (a Right to Erasure request under
              GDPR), open their profile and click <strong>Anonymise all personal data</strong>. You will be
              asked to confirm twice before anything changes.
            </P>
            <P>
              Anonymisation <strong>replaces</strong> all identifying information — name, email, phone, and
              notes — with placeholder values. All their linked bookings are also anonymised. The records
              themselves are retained for audit and financial purposes, but no personal information remains.
              This process cannot be undone.
            </P>
            <InfoBox type="warn">
              Anonymisation is permanent and irreversible. Once confirmed, the customer's personal details
              cannot be recovered. Only proceed when you have received a valid erasure request.
            </InfoBox>
            <P>
              Anonymising also covers the customer&apos;s online orders: name, email, phone, notes and
              allergy information are removed, and they come off the newsletter. The export includes
              their online orders and what they agreed to at checkout.
            </P>
            <P>
              It covers Pepper too: their name, email and phone are taken out of Pepper&apos;s chats,
              the website chat and Pepper&apos;s Activity, and a chat they were in is closed (see
              Pepper → Guests&apos; details in Pepper&apos;s chats).
            </P>

            <H3>Newsletter</H3>
            <P>
              Guests join your newsletter by ticking the optional newsletter box when they order online.
              A newsletter icon shows next to subscribers in the customer list, and the{' '}
              <strong>Newsletter</strong> button above the list shows only subscribers. A
              customer&apos;s profile shows when and how they subscribed.
            </P>
            <P>
              If someone asks to stop receiving it, open their profile and tap{' '}
              <strong>Unsubscribe</strong>, then <strong>Yes, unsubscribe</strong>. Staff can&apos;t
              subscribe anyone: only the guest can, so you always have their own agreement. Ordering
              again without ticking the box does not unsubscribe them.
            </P>
          </section>

          {/* ── CASH RECONCILIATION ──────────────────────────── */}
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
            <H3>Fill from Loyverse</H3>
            <P>
              If the venue sells through a <strong>Loyverse</strong> till, Cash Recon can fill a day's
              income, service charges and takings from Loyverse instead of you typing them in. Set it up
              once per venue in Cash Recon settings (gear icon) &gt; <strong>Loyverse</strong> (owners
              and admins):
            </P>
            <DataTable
              head={['Step', 'What to do']}
              rows={[
                ['1. Add the account', 'In the Loyverse Back Office open Integrations > Access tokens, add a token, then paste it under Loyverse accounts > Add account. It is checked with Loyverse before it is saved, stored encrypted and never shown again. One account can serve several venues; add more accounts if your venues use different Loyverse logins.'],
                ['2. Pick the store', 'Under This venue, choose the account and the Loyverse store that is this venue.'],
                ['3. Trading day start', 'Sales before this time count on the day before. Leave 00:00 if you close before midnight; set e.g. 04:00 if you trade past midnight.'],
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
              Then tap <strong>Fill from Loyverse</strong> on a day (top of the day) or a week (top of
              the week grid or week cards), or use the <strong>Import from Loyverse / GloriaFood</strong>{' '}
              widget on a dashboard (see Cash Dashboard). A window shows each mapped line with the Loyverse figure and
              what Cash Recon has now ("same now", "empty now" or the current amount), plus the
              day's receipts, gross sales and any payment types Loyverse took money on that are not
              mapped to a channel. Tick the days to fill and tap <strong>Fill</strong>. Only mapped lines
              are written, their notes stay, and <strong>submitted days are never changed</strong>
              (unsubmit first). You can fill the same day again after late sales; it just rewrites the
              mapped lines. A day where refunds were bigger than sales can show a minus figure.
            </P>
            <InfoBox type="tip">
              If Loyverse stops accepting the token (it was deleted or the account changed), the fill
              window says so and the account shows the error under Loyverse accounts. Make a new token
              in Loyverse and use <strong>Replace token</strong>.
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
              Then tap <strong>Fill from GloriaFood</strong> on a day or a week. The window works like the
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

          {/* ── FOOD SAFETY ───────────────────────────────── */}
          <section id="food-safety" data-help="">
            <H2>Food Safety Logs</H2>
            <P>
              The <strong>Food safety</strong> page (sidebar nav) is your SFBB-style due-diligence
              record: fridge/freezer temperatures, delivery checks, hot/cold holding, and
              cooking/reheat checks, all logged per venue and per day. Every reading autosaves
              as soon as you type or tap a stepper — there is no separate Save button to forget.
            </P>
            <H3>Tabs</H3>
            <DataTable
              head={['Tab', 'What it is']}
              rows={[
                ['Today', 'Fridge/freezer temperature checks, plus a count of today\'s deliveries, hold checks and cooking checks. One row per fridge or freezer, one column per fridge check time (e.g. AM/PM). Each unlogged reading starts pre-filled at the low end of that fridge\'s normal range, so you only need to nudge the +/- steppers or overtype it — nothing saves until you actually touch the cell.'],
                ['Deliveries', 'Log a delivery: supplier, temperature, condition. The main view is an entry form on one side and a list of this week\'s deliveries on the other — click any item in the list to load it back into the form for editing.'],
                ['Holds', 'Hot-hold and cold-hold checks for food kept warm/cold for service. Same layout (and same pre-filled reading) as the fridge checks on Today, one column per hold check time.'],
                ['Cooking', 'Cooking/reheat core-temperature checks. Pick a category tab, then tap the dish you just cooked (the dishes come from your menus, your own cooking list, or both: see Cooking items in H&S settings) — no typing a dish name each time. In the pop-up, pick the session (Lunch, Dinner, ...) the reading belongs to and dial in the core temperature (target: ≥75°C for 30 seconds, or FSA equivalents). The session starts on the one you picked last, or on today\'s current session by its time. The "Today\'s checks" list on the right is grouped by session, each with how many of its required items are done (e.g. 1/2). Tap any entry to reopen it, move it to another session, correct the reading, or delete it (double-confirm) if it was logged in error.'],
              ]}
            />
            <H3>Setting it up (H&amp;S settings)</H3>
            <P>
              Everything the checks are built from is set up in <strong>H&amp;S settings</strong>
              (the button at the top of the Food safety, Checklists and H&amp;S Dashboard pages).
              Pick the venue at the top right of the settings window, then a section:
            </P>
            <DataTable
              head={['Section', 'What you set up']}
              rows={[
                ['General', 'Follow restaurant opening days (owners and admins, all venues). See Closed days below.'],
                ['Fridges & freezers', 'Each fridge or freezer with its target, min and max temperature. Drag the handle to set the order they appear.'],
                ['Fridge check times', 'When fridge and freezer temperatures are checked each day (e.g. 09:00 Opening, 17:00 Evening). Leave empty for one reading per day.'],
                ['Hold stations', 'Hot and cold holding stations (bain-marie, salad bar, ...) with their safe range. Drag to reorder.'],
                ['Hold check times', 'When hold checks happen each day. Kept separate from the fridge check times.'],
                ['Cooking sessions', 'How many times a day cooking checks happen (e.g. Lunch, Dinner), with an optional time and how many items must be checked in each. Drag the handle to set their order.'],
                ['Cooking items', 'Which dishes the cooking check buttons show: Menus (the venue\'s published menus, one tab per menu section), Our own items (a list you keep here, one tab per category), or Both. Choose and tap Save. Add your own items with a name and an optional category; items without a category go under "Our items". Drag to reorder. Whatever the choice, "Log a dish not on the list" still lets you type any dish.'],
              ]}
            />
            <P>
              Removing or deactivating anything asks you to confirm first. Readings already logged
              are kept. Deliveries need no setup: the supplier is typed in with each delivery.
            </P>
            <H3>Out-of-range readings</H3>
            <P>
              Any reading outside its configured min/max shows in red immediately — you don't
              need to add a corrective action before it saves. The <strong>Corrective actions</strong>
              button (visible on every tab) cycles through every reading for the day that's still
              out of range and missing a note, so nothing gets forgotten by end of service.
            </P>
            <InfoBox type="tip">
              Every check type here (Equipment, Deliveries, Holds, Cooking) can also be added as
              its own widget on a custom <strong>H&amp;S Dashboard</strong> — see that section
              below if you want several of these side by side with a checklist on one screen.
            </InfoBox>
            <InfoBox type="info">
              On a touch tablet, tapping a temperature field opens a built-in on-screen keypad
              (digits, a decimal point, and a +/- sign for freezer readings) instead of trying to
              bring up your device's own keyboard. This is deliberate — some touch devices (seen
              on at least one Linux/Chrome tablet) never show their native keyboard for this kind
              of field, so the app no longer depends on it.
            </InfoBox>
          </section>

          {/* ── CHECKLISTS ────────────────────────────────── */}
          <section id="checklists" data-help="">
            <H2>Checklists</H2>
            <P>
              The <strong>Checklists</strong> page (sidebar nav) covers recurring operational
              checklists — opening, closing, cleaning, or anything else you define — per venue.
              Unlike Food safety, there's no fixed set of built-in checks: you build your own
              checklists, name them however you like, and set how often they're due.
            </P>
            <H3>Two tabs</H3>
            <DataTable
              head={['Tab', 'What it is']}
              rows={[
                ['Today', 'Whatever checklists are due today. Tick items off as you go, or tap Tick all to tick every task at once. There is no separate Complete button: ticking the last task marks the whole checklist complete, recording who completed it and when.'],
                ['Checklists', 'The builder. Create a checklist, give it a name and optional department, set its frequency (daily / weekly / monthly), and add/reorder/remove its individual tasks.'],
              ]}
            />
            <H3>Frequency</H3>
            <P>
              <strong>Daily</strong> checklists are due every day. <strong>Weekly</strong> checklists
              let you pick which day of the week they're due. <strong>Monthly</strong> checklists let
              you pick a day of the month. A checklist only shows on the Today tab on the day(s) it's
              actually due.
            </P>
            <InfoBox type="info">
              Once a checklist has been completed for a given day, it stays visible on Today showing
              who completed it and at what time — useful for shift handover and due-diligence
              records.
            </InfoBox>
            <H3>Made a mistake? Untick it</H3>
            <P>
              Untick any task and the checklist goes back to not-yet-done (who/when it was
              completed is cleared); tick it again to complete it. If <strong>Tick all</strong>{' '}
              was tapped by mistake on the H&amp;S Dashboard, tap the green{' '}
              <strong>All done</strong> badge in the widget's header, then{' '}
              <strong>Untick all</strong>.
            </P>
            <H3>Closed days (H&amp;S settings)</H3>
            <P>
              Owners and admins can turn on <strong>Follow restaurant opening days</strong> in{' '}
              <strong>H&amp;S settings</strong>, General (the button on the Food safety, Checklists
              or H&amp;S Dashboard page). It applies to every venue. When it's on, on a day a venue is closed:
            </P>
            <DataTable
              head={['What', 'On a closed day']}
              rows={[
                ['Daily checklists', 'Not needed. They move to a greyed "Not needed today (closed)" group on the Today tab; you can still open and tick them.'],
                ['Weekly and monthly checklists', 'Still due, as their week or month has open days.'],
                ['Fridge / freezer, hot and cold holding, cooking checks', 'Not expected. A banner says the venue is closed; anything you record still saves.'],
                ['Overview H&S tiles', 'The day shows as Closed instead of red or amber. An out-of-range reading you did record still shows as needing action.'],
              ]}
            />
            <P>
              Opening days come from each venue's booking schedule (<strong>Setup</strong>,{' '}
              <strong>Schedule</strong>): the weekly template, single-date overrides and named
              closures such as Christmas. A venue with no schedule set up counts as open every day.
            </P>
          </section>

          {/* ── DASHBOARDS ─────────────────────────────── */}
          <section id="dashboards" data-help="">
            <H2>Dashboards</H2>
            <P>
              The <strong>Dashboards</strong> page (sidebar nav, under Overview) is for your own
              screens. Tap <strong>Create dashboard</strong> (or <strong>New dashboard</strong> once
              you have one), give it a name and it starts blank. Then tap <strong>Add widget</strong>{' '}
              and pick from every widget in the app, mixed on one page: for example a manager's
              screen with today's checklists, the fridge temperatures, the days of the week from Cash
              Recon and who's on from the rota. Dashboards are per venue, shown as tabs, and are
              arranged the same way as the H&amp;S Dashboard (Edit layout to rename, reorder, resize
              or remove).
            </P>
            <H3>Every dashboard can use every widget</H3>
            <P>
              The H&amp;S, Cash and Rota dashboards work the same way now: <strong>Add widget</strong>{' '}
              lists all widgets, grouped under Health &amp; safety, Menus, Cash and Rota, with the
              page's own group first. So you can, for example, put the rota's Who's on next to the
              fridge checks on the H&amp;S Dashboard, or a checklist on the Cash dashboard. The widget
              tables under H&amp;S Dashboard, Cash Dashboard and Staff &amp; Rota say what each one shows.
            </P>
            <InfoBox type="info">
              A widget only shows to people who can open its area. Add widget only lists widgets from
              areas you have access to (for example cash widgets need Cash reconciliation, Tips to
              pay out needs Rota tips), and says how many it left out. If someone without access opens
              a dashboard that has one, they see "You don't have access to ..." in that widget instead
              of its figures. Access is set per module in Access, as before.
            </InfoBox>
            <H3>The date bar</H3>
            <P>
              One date bar drives every widget on the dashboard, and it changes with what's on it:
            </P>
            <DataTable
              head={['Widgets on the dashboard', 'Date bar']}
              rows={[
                ['Only checks and checklists', 'One day. The arrows move a day; Today jumps back.'],
                ['Only cash and rota widgets', 'One week. The arrows move a week; This week jumps back. The selected day is today (or the Monday in another week); tap a day in Days of the week or the rota grid to pick another.'],
                ['Both', 'The day and its week. The inner arrows move a day, the outer double arrows move a week. Cash and rota widgets follow the week the day is in.'],
              ]}
            />
            <P>
              In every case, tap the date in the middle to pick any date from your device's calendar.
              On a closed day, a dashboard with H&amp;S checks on it shows the closed-day note (when
              H&amp;S follows opening days is on). The Action log and Allergen lookup don't depend on a date.
            </P>
            <P>
              On the phone (ops.macaroonie.com), the <strong>Dashboards</strong> tile shows the same
              dashboards in one column, for logging and looking only; build and arrange them on the
              desktop page.
            </P>
          </section>

          {/* ── H&S DASHBOARD ─────────────────────────────── */}
          <section id="hs-dashboard" data-help="">
            <H2>H&amp;S Dashboard</H2>
            <P>
              The <strong>H&amp;S Dashboard</strong> page (sidebar nav) lets you build your own
              screen combining any mix of checklists and food-safety check widgets behind a single
              date navigator — useful for a kitchen-pass tablet showing "everything due right
              now" without switching between the Food safety and Checklists pages. It can also hold
              any cash, rota or menu widget (see Dashboards). Each widget's
              header uses your website's brand accent colour, same as Cash Reconciliation's
              section cards.
            </P>
            <H3>Dashboards and widgets</H3>
            <P>
              You can create any number of named dashboards, shown as tabs across the top. Click
              <strong> Edit layout</strong> to add widgets, rename, reorder, resize their width (in
              grid columns) and height (in rows), or remove them. To rename a widget, type in its{' '}
              <strong>Name</strong> box and tap Save; <strong>Use default</strong> puts the built-in
              name back. The same works on the Cash dashboard. A tall widget spans several
              rows, and shorter widgets stack beside it instead of leaving a gap. The health &amp;
              safety widgets are:
            </P>
            <P>
              <strong>Who can change a dashboard.</strong> Each dashboard page has its own permission
              in Access → Roles (H&amp;S Dashboard, Cash Recon Dashboard, Rota Dashboard,
              Dashboards). <strong>View</strong> lets someone open the dashboards, switch tabs, change
              the date and use the widgets; they don&apos;t see Edit layout, New dashboard or Add
              widget. <strong>Manage</strong> is needed to add, rename, reorder or delete dashboards
              and to add, remove, resize, rename or set up widgets. What someone can do inside a
              widget (enter figures, tick a checklist, log a temperature) comes from that
              widget&apos;s own area: for example, the cash widgets follow the Cash Reconciliation
              permission, so View on Cash Recon Dashboard with Manage on Cash Reconciliation lets
              someone fill in the week without changing the layout.
            </P>
            <DataTable
              head={['Widget', 'Shows']}
              rows={[
                ['Checklist', 'One specific checklist, ticked right on the dashboard. Tick all sits in the widget\'s own header; once every task is ticked it shows All done (tap it to untick all).'],
                ['Temperature checks', 'The Equipment (fridge/freezer) grid.'],
                ['Delivery checks', 'The delivery log entry form + this week\'s list.'],
                ['Hot / cold hold checks', 'The Holds grid.'],
                ['Cooking / reheat checks', 'The till-style cooking checks panel.'],
                ['Action log', 'The full Action Log list (see below) for one venue.'],
                ['Allergen lookup', 'Read-only allergen and dietary search over a menu (see Menus, Allergen matrix). The menu picked is remembered on that device for each widget.'],
              ]}
            />
            <P>
              Every widget reads and writes the exact same data as the Food safety and Checklists
              pages — there's only one copy of each day's checks, the dashboard is just another
              place to see and log them.
            </P>
            <InfoBox type="tip">
              Use <strong>Full screen</strong> (top right) to hide the sidebar entirely — good
              for a wall-mounted or kitchen-pass tablet running one dashboard all day. On an iPad
              added to the home screen, Full screen fills the whole app window (iPads don't allow
              true full screen there); tap <strong>Exit</strong> to go back.
            </InfoBox>
            <P>
              The dashboard tabs sit on the same row as the date selector. A dashboard always
              keeps the column layout you set up. On a narrower screen (for example an iPad held
              upright) the columns get narrower, so widgets you placed side by side stay side by
              side. If a table inside a narrow widget doesn't fit, scroll it sideways within the
              widget.
            </P>
          </section>

          {/* ── CASH DASHBOARD ─────────────────────────────── */}
          <section id="cash-dashboard" data-help="">
            <H2>Cash Dashboard</H2>
            <P>
              The <strong>Cash dashboard</strong> page (sidebar nav, next to Cash recon) lets you
              lay out your cash reconciliation on one screen, the same way the H&amp;S Dashboard
              works for checks. Create named dashboards (tabs), then tap <strong>Edit layout</strong>{' '}
              to add, reorder, resize or remove widgets. Every figure is the same one the Cash
              Recon pages show, so the dashboard never disagrees with them. Like every dashboard, it
              can also hold H&amp;S, menu and rota widgets (see Dashboards).
            </P>
            <P>
              With only cash (and rota) widgets on it, the navigator at the top picks the{' '}
              <strong>week</strong>. Tap a day in the{' '}
              <strong>Days of the week</strong> widget to open that day's full declaration (the same
              screen as on the Cash Recon page); the back arrow returns to the dashboard. The tapped
              day is also selected, so the Day balance and Petty cash widgets show it. The selected
              day starts as today (or the Monday when you move to another week).
            </P>
            <DataTable
              head={['Widget', 'Shows']}
              rows={[
                ['Days of the week', 'One tile per day with its status, income and variance. Tap a tile to open that day\'s declaration. Closed days are faded. In Edit layout, two switches on the widget: Hide closed days (leave out days the venue is closed) and Compact (smaller tiles showing the day, a status dot and the variance: green submitted, amber draft, grey not started).'],
                ['Day balance', 'The selected day: income, service charges, takings, cash expenses, card expenses and the variance.'],
                ['Week balance', 'The week: income, takings, cash expenses, wages paid in cash and the variance, plus how many days are submitted.'],
                ['Reconciliation grid', 'The full week grid from Cash Recon. You can type into it the same way; tap a day heading to select that day.'],
                ['Wages paid', 'The title bar shows the total paid in cash so far. The week\'s wages list (Name, Total, Paid, Paid on, Notes), the same as the Wages page. A payment is recorded on the day selected on the dashboard. Save to keep changes. In Edit layout you can switch on: Hide list changes (no Add staff, Copy from, Set as default or remove), Hide pay-all options (no Pay everyone in full or Paid on for all), Name and Paid only, and Show bank transfer (adds the Bank column; without it a person paid partly by bank shows the bank amount under their name).'],
                ['Petty cash', 'The selected day\'s expenses, with the same add/edit form (receipt photo, VAT, paid by card) as the mobile Expenses page.'],
                ['Week expenses', 'The title bar shows the week\'s cash expenses total. Every expense logged this week, grouped by day, with category, VAT and a Card badge for card-paid ones. Totals at the bottom: cash expenses, paid by card, and VAT included. Tap a day heading to select that day, then use the Petty cash widget to edit it.'],
                ['Week staff list', 'The same wages list as the Wages paid widget: add someone from your staff list (or a one-off name), remove someone, copy the list from one of the last 8 weeks, and Set as default for new weeks. Changes are only written when you tap Save (Discard changes throws them away). Has the same three display options as Wages paid.'],
                ['Week summary grid', 'The title bar shows the week\'s variance. The reconciliation grid with the individual days taken out: every income source, service charge and payment channel with its week total, then cash expenses and wages paid out of the till, and the variance. Read only, and always matches the WEEK column of the full grid.'],
                ['Tips to pay out', 'How much of the week\'s tips to pay staff in cash and how much by bank transfer, as two big figures, then each tip pot (what came in and how it is paid out) and each person\'s Bank and Cash amounts with totals. The title bar shows the week\'s total tips. Read only: the figures are the same as the Rota page\'s tips table, which is where pots, shares, moves and who gets a pot are changed. In Edit layout you can switch on: Hide tip pots, Hide staff list (just the two totals), Hide each person\'s total, Hide people with nothing to pay, and Hide notes. Needs access to rota tips.'],
                ['Import from Loyverse / GloriaFood', 'Fills Cash Recon from the venue\'s Loyverse and GloriaFood links without leaving the dashboard. One card per linked source with Fill (the selected day) and Fill this week (Monday up to today); each opens the same fill window as Cash Recon, so you see the figures next to what Cash Recon has before you tap Fill. Below, every day of the week with when each source last filled it (tap a day to select it; hold over a time to see who filled it). Submitted days and days that haven\'t happened yet can\'t be filled. The dashboard\'s date bar steps days and weeks while this widget is on it. In Edit layout: Hide the days, Day only (no Fill this week), Leave out Loyverse, Leave out GloriaFood. Filling needs Manage on Cash reconciliation; with View you see the days only. Links are set up in Cash Recon settings (see Fill from Loyverse and Fill from GloriaFood).'],
              ]}
            />
            <InfoBox type="tip">
              A dashboard keeps the column layout you set up, and each widget can span several
              columns and several rows. Make the grid tall and the balances short, and the
              shorter widgets stack beside it instead of leaving a gap.
            </InfoBox>
          </section>

          {/* ── STAFF & ROTA ────────────────────────────── */}
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
            <InfoBox type="tip">
              Access is set per module in Access: Staff (staff list, roles, rota setup), Rota (view or
              edit the rota), Rota pay (hours and pay, pay overrides and filling Cash Recon wages),
              Rota tips (tip pots, points, tip shares, moves and adjustments) and Rota dashboard.
              Rota pay and Rota tips are separate, so you can, for example, let operators view tips
              without seeing wages. Both are owners and admins only by default. Someone who can see
              only one of them sees just that section on the Rota page and dashboard.
            </InfoBox>
          </section>

          {/* ── MOBILE APP ────────────────────────────── */}
          <section id="mobile-app" data-help="">
            <H2>Mobile App</H2>
            <P>
              Visit <strong>ops.macaroonie.com</strong> on a phone (signed in with your usual
              account) for a phone-sized version of the app, starting with the H&amp;S Dashboard.
              It's the same data and the same Tick all/log actions as the desktop page — just
              laid out in a single column for a phone screen instead of a resizable grid.
            </P>
            <H3>Installing it as an app</H3>
            <P>
              On <strong>ops.macaroonie.com</strong>, use your browser's <strong>Add to Home
              Screen</strong> (Safari: Share → Add to Home Screen; Android Chrome: menu → Add to
              Home screen or the install banner). It installs under its own name, <strong>
              Macaroonie Ops</strong>, with its own icon — separate from the main desktop app if
              you also have that installed — and opens straight into the mobile section, full
              screen, no browser address bar. Because it has its own address, Android installs it as
              a separate app too. The first time you open it you sign in again (and pick your
              restaurant, if you have more than one). If you installed it earlier from
              macaroonie.com/mobile, remove that icon and add it again from ops.macaroonie.com.
            </P>
            <P>
              If your account is connected to more than one restaurant, the top of the home screen
              says which one you&apos;re <strong>Working in</strong>. Tap <strong>Switch</strong> to
              pick another; the phone app keeps it until you switch again, and signing in again opens
              the restaurant you sign in to. The office and the phone app each remember their own
              choice, so switching on one doesn&apos;t switch the other.
            </P>
            <P>
              More mobile-optimised pages will appear on the <strong>/mobile</strong> hub screen
              over time — it's a home screen of tiles, two to a row, one per available mobile module.
              <strong> Expenses</strong> is the second one: it shows a whole week (Monday to
              Sunday) of petty cash expenses, with the week's cash, card and VAT totals at the top.
              Use the arrows to move a week back or forward, tap the week to jump to any date, or
              <strong> Back to this week</strong>. Each day has its own <strong>Add</strong> button,
              and tapping an expense opens it to edit (snap a receipt photo with your phone's
              camera). Submitted days are marked and locked. <strong>Purchasing</strong> is the third: pick a
              list, fill in quantities and place the order, then send, print and book in deliveries, the
              same screens as the desktop Purchasing page. <strong>Cash Up</strong> is the fourth: a plain list of the
              week's days with status, income and variance at a glance — tap a day to open the
              full declaration, which also lists the <strong>wages paid today</strong> (they count in
              that day's variance; wages with no Paid on day only count in the week).{' '}
              <strong>Wages</strong> is the fifth: the week's wages list, one card per person with Total,
              Paid (tap <strong>Full</strong> to pay the cash part), Paid on and Notes. Typing a Paid
              amount or tapping Full sets Paid on to today when you're on this week. On the phone the
              Bank transfer column and Paid on for all are left out (a person paid partly by bank
              shows the bank amount under their name); use the desktop Wages page for those. Tap{' '}
              <strong>Save</strong> to keep changes.
            </P>
            <P>
              On the phone the <strong>H&amp;S Dashboard</strong> is for logging checks only: switch
              between your dashboards with the tabs (the small arrows scroll them when there are
              more), tick checklists and enter temperatures. Adding, removing and arranging widgets
              and dashboards is done on the H&amp;S Dashboard in the office admin. The{' '}
              <strong>Dashboards</strong> tile does the same for the dashboards you made on the
              Dashboards page. Both show any widget the dashboard holds, cash and rota ones included,
              with the same date bar as the desktop.
            </P>
            <P>
              If you open the regular desktop admin portal on a phone held upright, you'll see a
              pop-up offering to switch to this mobile view — tap <strong>Open mobile
              view</strong> to jump straight there, or <strong>Stay on this page</strong> to keep
              using the desktop layout. It only offers once; dismissing it (either way) won't ask
              again on that phone.
            </P>
            <P>
              Beyond that one-time pop-up, whenever you're on a phone-sized screen you'll also see
              a small floating <strong>Mobile view</strong> button in the bottom-left corner of the
              regular desktop admin pages — tap it any time to jump to <strong>/mobile</strong>. The
              Ops app itself has no link back to the standard view: it's the phone app, and the full
              admin is at office.macaroonie.com.
            </P>
            <InfoBox type="tip">
              This is the same login and the same restaurant data as the desktop admin portal —
              there's nothing extra to set up. If you're not signed in, it takes you through the
              normal login first.
            </InfoBox>
          </section>

          {/* ── H&S ACTION LOG ────────────────────────────── */}
          <section id="hs-action-log" data-help="">
            <H2>H&amp;S Action Log</H2>
            <P>
              The <strong>Action log</strong> page (sidebar nav) is a general facilities and
              compliance to-do list per venue — repairs, records, training, cleaning, or anything
              else that needs tracking with a due date and an owner. Unlike Food safety and
              Checklists, it isn't tied to a specific day; items stay open until someone marks
              them complete.
            </P>
            <H3>Adding an action</H3>
            <P>
              Click <strong>Add</strong> and fill in the task, an optional category, priority,
              who it's assigned to, when it was raised, and a due date. You can attach a photo
              (picked from or uploaded to your Media library) and add notes as things progress.
            </P>
            <H3>Categories</H3>
            <P>
              Ships with four categories — <strong>Repairs</strong>, <strong>Records</strong>,
              <strong> Training</strong>, <strong>Cleaning</strong> — matching the original
              paper/spreadsheet log. Click the gear icon to add your own, rename, reorder, or
              retire ones you don't use.
            </P>
            <H3>Filters and completing</H3>
            <P>
              The <strong>Open / Completed / All</strong> tabs and the category dropdown filter
              the list. Tick the checkbox on the left of any item to mark it complete — this
              records who completed it and when, same as a checklist. Overdue items (a due date in
              the past, still open) are flagged in red.
            </P>
            <InfoBox type="tip">
              The Action Log is also available as a widget on the H&amp;S Dashboard, so it can sit
              alongside your checklists and temperature checks on one screen.
            </InfoBox>
          </section>

          {/* ── SETTINGS ──────────────────────────────────── */}
          <section id="settings" data-help="">
            <H2>Settings</H2>
            <P>
              Go to <strong>Settings</strong> in the sidebar to customise the look and default behaviour
              of the admin portal. All changes apply immediately and are saved to your browser — they
              persist across sessions without needing to log out or refresh.
            </P>

            <H3>Theme colour</H3>
            <P>
              Choose a brand colour from the preset swatches or enter a hex value in the text box.
              The entire portal updates instantly — buttons, active nav items, and primary actions all
              use the chosen colour. Your choice is remembered even after closing the browser.
            </P>
            <InfoBox type="info">
              Settings are stored locally in your browser — they are not synced across devices or users.
              Each staff member can have their own colour preference.
            </InfoBox>

            <H3>Page colours and card headers</H3>
            <P>
              Every page uses the same look as the Rota dashboard: a light grey background with
              white cards on it, and each card has a coloured header band. The band colour is
              your brand's accent colour (Brand &amp; theme → Colours → Accent), so it matches
              your brand on every page and dashboard. Changing
              the accent there changes the header bands for everyone in your business. The
              Theme colour above only changes buttons and highlights.
            </P>

            <H3>Booking status colours</H3>
            <P>
              Each of the nine booking statuses has its own tile colour on the Timeline. You can
              customise any status colour from the <strong>Booking status colours</strong> section:
            </P>
            <ol className="space-y-1.5 text-sm text-muted-foreground list-decimal list-inside ml-2 mb-4">
              <li>Tap a status tile (e.g. <em>Confirmed</em>) to expand its editor.</li>
              <li>Choose from the 12 preset pastel swatches, or use the colour picker / hex input for a custom colour.</li>
              <li>Tap <strong>Done</strong> to apply. A border colour is automatically derived from the background you set.</li>
              <li>Use <strong>Reset all</strong> to return every status to the default palette in one tap.</li>
            </ol>
            <InfoBox type="info">
              Status colour changes apply to the Timeline tiles and the status colour reference swatches
              in this Help guide immediately. The booking status labels and their meanings do not change —
              only the visual colour.
            </InfoBox>

            <H3>Timeline background colour</H3>
            <P>
              Change the background colour of the empty canvas area on the Timeline. Six preset swatches
              range from pure white to soft pastels. You can also use the colour picker or type a hex
              value for a precise match. The change applies in real time on the Timeline.
            </P>

            <H3>Closed / unavailable areas colour</H3>
            <P>
              The grey shading that marks closed hours and blocked slots on the Timeline can be
              recoloured here. Six grey and neutral tones are provided, plus a custom picker. The
              shade is always applied at 38% opacity so it stays subtle over any background.
            </P>

            <H3>Opening hour line</H3>
            <P>
              A thick vertical line that runs the full height of the Timeline, marking the point where the
              first sitting of the day opens. Use the toggle to show or hide it, and the colour picker to
              match your brand or make it more visible against your chosen background. Six preset colour
              swatches are available when the line is enabled. The line is on by default.
            </P>

            <H3>Shade closed areas in header row</H3>
            <P>
              When this toggle is on, the same grey shading and diagonal stripes that appear in the table
              rows for closed and last-orders periods are also drawn in the hours header row at the top of
              the Timeline. Off by default — turn it on if you find the header row hard to read against the
              rest of the canvas.
            </P>

            <H3>Interface</H3>
            <P>
              The <strong>Sidebar expanded by default</strong> toggle controls whether the left navigation
              sidebar starts open (showing labels) or collapsed (showing icons only) when the app loads.
              Turn it off at the host stand if you want maximum screen space from the moment you open the app.
              You can always expand the sidebar manually at any time using the toggle at the top of the sidebar.
            </P>

            <H3>Timeline defaults</H3>
            <P>
              These settings control how the Timeline opens each time. You can also change all of them
              live from the sidebar while on the Timeline — the Settings page just saves the starting state.
            </P>
            <DataTable
              head={['Setting', 'Description']}
              rows={[
                ['Default tile mode', 'Compact (default) — dense, one-line tiles. Detailed — three-line tiles showing name, phone, and table allocation.'],
                ['Compact tile size', 'When in Compact mode, choose S (smallest), M (medium), or L (largest) row and font size.'],
                ['Wide time columns', 'Increases each hour column from 80 px to 120 px wide — useful on large screens or when bookings are closely spaced.'],
                ['Side panel mode', 'When on, the booking drawer opens as a docked right panel. When off, it opens as a floating overlay.'],
                ['Section dividers', 'Show or hide the section label rows (Main Floor, Terrace, etc.) between table groups.'],
                ['Hide inactive', 'Hide cancelled, no-show, and checked-out bookings from the Timeline canvas by default.'],
                ['Timeline hours', 'Set the first and last hour shown on the timeline canvas. Default 09:00–24:00. Narrow it to hide unused hours and make the canvas more compact.'],
              ]}
            />
            <InfoBox type="tip">
              On a large monitor, try Detailed tile mode with Wide time columns for a clear, at-a-glance
              service view. On a tablet at the host stand, Compact S keeps the maximum number of tables
              visible without scrolling.
            </InfoBox>
          </section>

          {/* ── NAVIGATION & QUICK ACCESS ─────────────────── */}
          <section id="navigation" data-help="">
            <H2>Navigation &amp; Quick Access</H2>
            <P>
              An owner can customise the left sidebar for everyone in the restaurant from the
              <strong> Navigation</strong> page (sidebar nav, under Account) — and can optionally
              replace the sidebar entirely with a tile-based quick-access screen instead.
            </P>
            <H3>The standard menu</H3>
            <P>
              Every group starts with the same menu, grouped by job: <strong>Home</strong> (Overview,
              Dashboards, Pepper), <strong>Service</strong> (Timeline, Bookings, Customers, Online orders),{' '}
              <strong>Money</strong> (Till reports, Cash recon, Cash dashboard), <strong>Health &amp; safety</strong>,{' '}
              <strong>Stock</strong> (Purchasing, with Order lists, Inventory and Suppliers under it),{' '}
              <strong>People</strong> (Staff, Rota), <strong>Menus</strong> (Menus and their pages, Promotions),{' '}
              <strong>Brand &amp; web</strong> (Brand &amp; theme, Website, Media, Reviews,
              Emails), <strong>Venues</strong> (Venues and New venue, Schedule, Tables, Booking rules,
              Ordering setup), <strong>Store tech</strong> (Tills, Floor plan, Kiosks, Kitchen screens, Menu
              screens, Printers, Printing, Card machines, Order types, Revenue streams, Courses, Staff and PINs,
              Till roles, Receipts and payments, Cash Recon link), <strong>Admin</strong> and <strong>Help</strong>.
              Each page is in it once.
              Pages your role can&apos;t open, and modules switched off, don&apos;t show.
            </P>
            <P>
              The standard menu replaced every group&apos;s menu once, in October 2026 (changes made on this page
              before then went, and the menu went back to the sidebar). In October 2026 the Store tech section
              replaced the Till setup link (whose tabs are now its pages) and took Menu screens from Menus; other
              changes made here were kept. <strong>Reset to defaults</strong> on this page brings the standard menu
              back at any time.
            </P>
            <H3>Editing the sidebar tree</H3>
            <P>
              The Navigation page shows the current sidebar as an outline: sections and links,
              nested as deep as you like. Use the arrow buttons on each row to move an item up or
              down, indent it under the item above, or outdent it back out. <strong>Add section</strong>
              and <strong>Add link</strong> create new items; picking a link's page from the list
              also fills in a sensible icon and permission automatically.
            </P>
            <H3>Per-item controls</H3>
            <DataTable
              head={['Control', 'Effect']}
              rows={[
                ['Module gate', 'Ties the item to an existing module permission — hidden automatically for any role without access, same as today.'],
                ['Hide for specific roles', 'An extra hide on top of the module gate — hide an otherwise-permitted item from just one or two roles without touching their permissions.'],
                ['Show as a quick-access tile', 'Also surfaces this link as a tile in Quick access / Launcher mode (see below).'],
              ]}
            />
            <H3>Sidebar vs. Launcher</H3>
            <P>
              The <strong>Sidebar / Launcher</strong> toggle at the top of the Navigation page is
              restaurant-wide. In <strong>Launcher</strong> mode, the entire sidebar tree is
              replaced for every user by a full-page tile grid at <Mono>/launcher</Mono>, built
              from whichever links have "Show as a quick-access tile" turned on. A single
              "Quick access" link stays in the sidebar so nobody loses their way back to it.
            </P>
            <InfoBox type="warn">
              Switching to Launcher mode before flagging any items hides the whole sidebar with
              nothing to replace it. If that happens, open the Navigation page (still reachable —
              it's your safety net) and switch back to Sidebar, or flag the items you want first.
            </InfoBox>
            <H3>Personalising Quick access</H3>
            <P>
              On the Quick access / Launcher screen itself, each person can tap <strong>Customise</strong>
              to drag their own tiles into a preferred order or hide ones they don't use — this is
              personal to your device/browser and doesn't change what anyone else sees.
              <strong> Reset to admin defaults</strong> clears your personal changes and goes back
              to the order the admin set up.
            </P>
            <InfoBox type="info">
              This is a different feature from the small <strong>Quick access</strong> widget on the
              Overview page, which is a separate, always-available set of shortcuts each person
              picks for themselves from a fixed list — unrelated to the restaurant-wide Navigation
              designer described here.
            </InfoBox>
          </section>

          {/* ── WIDGET ────────────────────────────────────── */}
          <section id="widget" data-help="">
            <H2>Booking Widget</H2>
            <P>
              The booking widget is an embeddable piece of your website that lets guests book a table
              directly, without calling the restaurant. It enforces all your booking rules automatically.
            </P>

            <H3>Testing the widget</H3>
            <P>
              Before embedding on your website, use the built-in test page at{' '}
              <strong>Widget Test</strong> in the sidebar. This runs the full booking flow in your
              browser so you can confirm slots appear correctly and bookings land in the Timeline.
            </P>

            <H3>Guest booking flow</H3>
            <ol className="space-y-1.5 text-sm text-muted-foreground list-decimal list-inside ml-2 mb-4">
              <li><strong>Party size</strong> — guest enters the number of covers.</li>
              <li><strong>Date</strong> — guest picks a date from the calendar.</li>
              <li><strong>Time slot</strong> — available slots are shown based on your schedule and current bookings.</li>
              <li><strong>Guest details</strong> — name, email, phone (optional), and special notes.</li>
              <li><strong>Payment</strong> (if the venue takes a deposit): the guest pays by card, Apple Pay or Google Pay.</li>
              <li><strong>Confirmation</strong> — booking reference shown; confirmation email sent.</li>
            </ol>

            <H3>Hold timer</H3>
            <P>
              Once a guest selects a slot, it is temporarily reserved with a countdown timer (based on
              your hold time limit in Booking Rules, default 5 minutes). If the guest doesn't complete
              the booking within the countdown, the slot is released for others. This prevents guests
              from "parking" on a popular slot indefinitely.
            </P>

            <H3>Embedding on your website</H3>
            <P>
              Add the following script tag to your website, replacing <code className="bg-muted px-1 rounded text-xs">YOUR_VENUE_ID</code> with
              your venue's UUID (found on the Venues page):
            </P>
            <pre className="bg-gray-900 text-green-300 text-xs rounded-lg p-4 overflow-x-auto mb-4 leading-relaxed">
{`<script
  src="https://your-domain.com/widget/loader.js"
  data-venue-id="YOUR_VENUE_ID"
  defer
></script>
<div id="macaroonie-widget"></div>`}
            </pre>

            <H3>Customising the widget appearance</H3>
            <P>
              The widget reads CSS custom properties from your website for theming. Add these to
              your website's CSS to match your brand:
            </P>
            <pre className="bg-gray-900 text-green-300 text-xs rounded-lg p-4 overflow-x-auto mb-4 leading-relaxed">
{`:root {
  --booking-accent: #d97706;     /* Button and highlight colour */
  --booking-radius: 8px;         /* Border radius */
  --booking-font: 'Your Font';   /* Font family */
}`}
            </pre>
          </section>

          {/* ── BRAND & THEME ─────────────────────────────── */}
          <section id="brand" data-help="">
            <H2>Brand &amp; Theme</H2>
            <P>
              <strong>Brand &amp; theme</strong> (under Brand &amp; web in the menu) holds your restaurant
              group&apos;s brand: the brand name, tagline, logo and browser icon, the colours and the fonts. It is
              more than the website: every designer offers it (kiosk designs, menu screen boards, printed menus),
              the admin&apos;s card headers use its accent colour, and the colour swatches in every builder start
              with it. Changing it needs Manage on Website; everyone else sees it read only.
            </P>

            <H3>Setting the brand</H3>
            <P>
              The <strong>Brand</strong> card takes the name, tagline, logo and browser icon; the{' '}
              <strong>Colours</strong> and <strong>Fonts</strong> cards set the seven colours and the heading and
              text fonts. <strong>Theme ideas</strong> makes a theme from your logo or a photo and a few words (see
              Website Builder, Make a theme from a picture) or starts from a ready-made one. Each card has its own
              Save. The website shows brand changes once it is published (Website &gt; Publish); the designers and
              the admin use them straight away.
            </P>

            <H3>Putting the brand on other designs</H3>
            <P>
              <strong>Use the brand on other designs</strong> lists your kiosk designs, menu screen boards and printed
              menu designs (the ones your role can change). Tick the ones that should take the brand, check the before
              and after preview, tap <strong>Use the brand on the ticked designs</strong>, then{' '}
              <strong>Yes, use the brand</strong>. Each design takes the brand&apos;s colours and
              fonts and keeps everything else: its layout, pictures and words. Each one says when it is done, or why
              it couldn&apos;t be saved.
            </P>
            <P>
              In the kiosk designer, the menu screen designer and the printed menu designer, the theme maker&apos;s
              button has <strong>Use the brand</strong> beside it: it fills that design&apos;s colours and fonts from
              the brand, and nothing is saved until you save the design. The theme maker also shows{' '}
              <strong>Your brand</strong> as the first theme.
            </P>
            <InfoBox type="info">
              The website&apos;s own settings stay on the Website page: the template, the layout (Look &amp; layout),
              the header and footer, the site name and the picture shared on social media, and a location&apos;s own
              look (see Website Builder, Give a location its own look).
            </InfoBox>
          </section>

          {/* ── WEBSITE BUILDER ──────────────────────────── */}
          <section id="website" data-help="">
            <H2>Website Builder</H2>
            <P>
              Build a public-facing website for your restaurant — hero image, menus, gallery,
              opening hours, booking widget, links to delivery partners, SEO and analytics.
              Your site is hosted at <Mono>{'{slug}.macaroonie.com'}</Mono> and you can later
              point your own domain at it (e.g. <Mono>book.yourrestaurant.co.uk</Mono>).
            </P>

            <H3>Getting started</H3>
            <ol className="list-decimal ml-5 space-y-2 text-sm text-muted-foreground mb-4">
              <li>Go to <strong>Website</strong> in the sidebar (globe icon).</li>
              <li>
                On first visit you'll see an onboarding card. Pick a <strong>subdomain</strong>
                &nbsp;(lowercase letters, numbers, hyphens — e.g. <Mono>wingstop-covent-garden</Mono>)
                and click <strong>Create website</strong>.
              </li>
              <li>
                Your site is created but <strong>not yet published</strong> — it only goes live
                when you flip the <em>Publish</em> toggle in Setup &amp; domain.
              </li>
              <li>
                Fill in sections in any order. Each section has its own <strong>Save</strong>
                button — changes only go live when you save.
              </li>
            </ol>

            <H3>The 18 sections</H3>
            <P>The left rail groups sections into logical steps:</P>

            <DataTable
              head={['Section', 'What it does']}
              rows={[
                ['Setup & domain',   'Subdomain slug, custom domain (with DNS verification), publish toggle.'],
                ['Template',         'Visual layout. Pick Classic (warm, traditional) or Modern (editorial, full-bleed hero).'],
                ['Theme',            'Your look & feel — independent of template. Colours, fonts, sizes, spacing, corners, buttons, hero overlay.'],
                ['Look & layout',    'The site name and social-preview picture, the boxed inset layout, and a location\'s own look. The logo, colours and fonts are on the Brand & theme page (see Brand & Theme); the website uses them once published.'],
                ['Hero',             'The first screen guests see: image, heading, subheading, call-to-action button.'],
                ['About',            'Short story / description with an optional image.'],
                ['Gallery',          'Photo grid. Drag to reorder, add captions, upload new images.'],
                ['PDF menus',        'Upload PDF menus with labels (e.g. Lunch, Dinner, Drinks), only for menus you haven\'t built on the Menus page: those show with the Menu (inline) block and have their own printable PDF. Show PDF menus switches them on or off for the location. On, add the PDF menus block to a page to list them (every page template includes it). Off, the block shows nothing, isn\'t offered when adding blocks, and the location\'s menu page is hidden.'],
                ['Allergens',        'Either a PDF document OR a structured dish-by-dish table with allergen pills.'],
                ['Opening hours',    '7-day grid. Multiple sessions per day (Lunch/Dinner) supported.'],
                ['Find us',          'Address, latitude/longitude, Google Maps embed URL.'],
                ['Contact',          'Phone, email, Instagram, Facebook, X, TikTok, YouTube.'],
                ['Online ordering',  'Links to takeaway/pre-order services (e.g. GloriaFood).'],
                ['Delivery',         'Links to Deliveroo, Just Eat, Uber Eats, Gogetters, Foodhub.'],
                ['Reservations widget', 'Embed the live reservations widget inline. Per-block: header, button, fonts (3 tracks), day colours. Every block also has an Anchor ID in its settings for in-page links.'],
                ['Guestplan widget', 'If you take bookings with Guestplan: paste your access key in the block. Guestplan shows its own floating booking button and form on the page (on a computer it may open the form by itself). The heading is optional and shows where the block sits.'],
                ['Pages',            'Standalone pages or modal overlays. Link picker lists them plus block anchors.'],
                ['SEO',              'Meta title, description and social-preview image (Open Graph).'],
                ['Analytics',        'Google Analytics 4 and Meta (Facebook) Pixel IDs.'],
              ]}
            />

            <H3>Heading block</H3>
            <P>
              Add a <strong>Heading</strong> block (Content) for a section title on its own: type straight onto
              the page or in the panel. While the block is selected you can also fill in a small line above (for
              example OUR MENU) and a line below. In the panel choose the heading level (H1 to H4: use one H1 per
              page, usually its main title, so search engines read the page outline correctly), the size
              (Automatic follows the level; large sizes shrink to fit on phones), alignment, font (the theme's
              heading or body font, or any font from the list), weight, italic, capitals, a decoration (a short
              bar underneath, or lines either side), colours from your theme, a background and the space above
              and below. An empty Heading block shows nothing on the live site.
            </P>

            <H3>Tabs block</H3>
            <P>
              Add a <strong>Tabs</strong> block (Layout) to put other blocks behind tabs, for example Lunch,
              Dinner and Drinks menus. On the page, tap a tab to open it and use the + inside it to add blocks
              to that tab. To move a block into another tab, drag it onto that tab's name. In the panel you can
              rename tabs, drag them into a new order, add more (up to 10) and remove one (with a confirm, which
              also removes its blocks). Choose the tab style (underline, pills or boxed), alignment, the colour
              of the open tab, a background, and how phones show it: the tab strip (scrolls sideways) or
              drop-down sections. Give a tab a <strong>link anchor</strong> (e.g. <Mono>dinner</Mono>) and a
              link to <Mono>#dinner</Mono> opens that tab; a link to any anchor inside a tab opens it too.
              Columns and Tabs can't be put inside a tab or a column.
            </P>

            <H3>Menu block without pictures</H3>
            <P>
              The <strong>Menu (inline)</strong> block shows the dish photos and the small section pictures
              you set on the Menus page. To show a menu in words only, select the block and, under Display,
              switch off <strong>Show dish photos</strong> and <strong>Show section pictures</strong> (either
              one on its own works too). It only changes that block: the same menu elsewhere on the site,
              online ordering, the kiosks and the printed menu keep their pictures.
            </P>

            <H3>Photos from your computer</H3>
            <P>
              Drag a photo from your computer onto the page: dropped on an <strong>Image</strong>,{' '}
              <strong>Hero</strong> or <strong>Story</strong> block it becomes that block&apos;s picture;
              dropped on any other block, a new Image block with it goes after that block. Every picture
              field in the block settings (and on the Website pages) takes a dropped photo too. They go
              into Media like an upload. Blocks move by the grip handle on their left edge: it shows when
              you point at a block, on the selected block, and always on a touch screen.
            </P>

            <H3>Full screen editing</H3>
            <P>
              The <strong>Full screen</strong> button at the top of the page builder hides the app menu and the
              website menu so you only see the page and the block settings. Each scrolls on its own. Tap{' '}
              <strong>Exit full screen</strong> to get the menus back. The builder remembers your choice.
            </P>

            <H3>Publishing your site</H3>
            <P>
              Every change you make in the website builder shows on your <strong>staging</strong> address straight
              away. Guests only see it once you publish. The <strong>Publish</strong> button sits at the top of the
              website menu, above Home. Underneath it says whether your live site matches staging:{' '}
              <em>Live matches staging · published 3 days ago</em>, or <em>4 changes not live yet · last published
              yesterday</em> with the number on the Publish button too (or <em>Not published yet</em>). It updates
              by itself after each save. The publish window lists what would change: Home page, Brand &amp; theme (also changes made on the Brand &amp; theme page),
              each page or pop-up (new, changed, removed or hidden), each location&apos;s page and details. Gallery
              photos, PDF menus, allergens, opening hours from your schedule and menus built on the Menus page
              aren&apos;t part of publishing: they show on the live site as soon as you save them.
              The <strong>Staging</strong> button next to it opens your staging site in a new tab, so you can check
              your edits before publishing (it appears once your site has an address under Domain).
              Tap Publish to open the publish window: copy or open your staging link, <strong>Publish now</strong>,
              schedule a publish for later (or cancel one), or <strong>Override staging with production</strong> to
              throw away unpublished edits (asks you to confirm). Your address, custom domain and the{' '}
              <strong>Site is live</strong> switch are under <strong>Domain</strong>; while the site is switched off,
              the publish window reminds you that visitors see a 404 page.
            </P>

            <H3>Staging password</H3>
            <P>
              Your staging site is hidden from search engines, but anyone who has its link can open it. To keep it
              private, open the publish window and under <strong>Staging</strong> tap <strong>Add a password</strong>,
              type one (at least 6 characters) and tap <strong>Save password</strong>. From then on, visitors to your
              staging address see a page asking for the password; once they enter it, their browser remembers it for 30
              days. Send the password to whoever needs to see the preview (your designer, the owner, a manager).
            </P>
            <P>
              You don&apos;t need to type it yourself: the <strong>Staging</strong> button and <strong>Open staging</strong>{' '}
              in the publish window take you straight in (the Staging button shows a small lock while a password is set).
              <strong> Change password</strong> signs everyone out of staging, so they need the new one.{' '}
              <strong>Remove password</strong> (asks you to confirm) opens staging to anyone with the link again. Only
              owners and admins can set, change or remove it. Your live site never asks for a password.
            </P>

            <H3>Theme manager — how it works</H3>
            <P>
              The theme (colours and fonts on the <strong>Brand &amp; theme</strong> page, spacing
              on Website &gt; Look &amp; layout) controls the look &amp; feel of your site
              regardless of which template you chose. A theme change to Classic instantly
              applies the same way if you switch to Modern.
            </P>
            <P>You can fine-tune seven areas:</P>
            <DataTable
              head={['Group', 'Controls']}
              rows={[
                ['Colours',    '7 colours: Primary (brand/CTA), Accent (highlights), Background, Surface (alt-band background), Body text, Muted text, Borders.'],
                ['Typography', 'Heading + body font (Google Fonts auto-loaded), base size, heading scale, weights, line-height.'],
                ['Spacing',    'Container max width, section padding (desktop + mobile), grid gap, and the boxed-inset "Layout" card below (side padding on boxed/wide blocks — see next).'],
                ['Corners',    'Small / medium / large border-radius.'],
                ['Logo',       'Header logo height.'],
                ['Buttons',    'Radius, padding, font weight.'],
                ['Hero',       'Overlay darkness (so text stays readable over images) and minimum height.'],
              ]}
            />
            <InfoBox type="tip">
              Start with colours + fonts. Everything else is fine-tuning. <strong>Reset to
              defaults</strong> is always available if you mess something up.
            </InfoBox>

            <H3>Colours on blocks and in the other builders</H3>
            <P>
              A block&apos;s colour (a heading, the footer, a promo, the basket, the reservations
              widget&apos;s buttons) offers the seven theme colours first. A theme colour follows the
              theme: change Primary on the Theme page and every block using Primary changes with it.
              The last swatch, the rainbow, is a <strong>custom colour</strong>: tap it for your
              device&apos;s colour picker, or type a code like #336699 in the box that appears. A
              custom colour stays as it is when the theme changes. Tap a theme swatch to go back to
              the theme.
            </P>
            <P>
              The menu screen designer, the kiosk designer, menu tag colours and the booking email
              editor&apos;s text colour show the same theme colours as swatches, then a custom colour.
              The kiosk designer also has a <strong>Website colours</strong> set to start from.
            </P>
            <P>
              Background colours can also be <strong>See-through</strong> (the checkered swatch first
              in the row): nothing is drawn, so what is behind shows. On a menu screen board: the
              board&apos;s background (the designer shows a checkerboard behind it), a box, a scrolling
              text&apos;s background and the order board&apos;s Ready and Preparing boxes. On a kiosk
              design: Cards, Buttons and Highlights (the page and the words always have a colour; the
              pop-up windows keep the page colour so they stay readable). Text colours have no
              See-through. A printed menu&apos;s colours are inks on the paper, so they don&apos;t have it either.
            </P>

            <H3>Make a theme from a picture</H3>
            <P>
              <strong>Make a theme</strong> builds a whole look (colours, fonts, corners and capitals)
              from a picture and a few words. It is on the Brand &amp; theme page (Theme ideas),
              in the kiosk designer (Brand), in the menu screen designer (Board &gt; Theme maker) and
              in the printed menu designer (Page setup &gt; Colours). You need Manage on that page.
            </P>
            <DataTable
              head={['Step', 'What to do']}
              rows={[
                ['1. A picture', 'Upload one, drop it on the box, pick one from Media, or tap Use my logo. A logo, a photo of the restaurant or the food, or anything with the look you want. Its main colours show under it, and three themes made straight from them (light, dark and bold) show at once.'],
                ['2. The look you want', 'Optional. Say it in your own words ("relaxed Italian, terracotta and olive"), or tap an example. "Make it warmer" works from what you have now.'],
                ['3. Make themes', 'Pepper makes three themes from the picture and the words (it takes a few seconds). Try again for three more; More like this on a theme for three close to it.'],
                ['4. Show on', 'See every theme on the website, a kiosk, a menu screen or a printed menu, so one theme can go everywhere.'],
                ['5. Use this', 'Fills in the page\'s colours and fonts. Nothing changes until you save, as usual: check it, then Save.'],
              ]}
            />
            <P>
              Every theme is checked before you see it: words are made dark or light enough to read on
              what they sit on, the website&apos;s buttons always carry white words, and a menu screen
              gets a deep background with light words, which reads from across the room. A printed menu
              keeps its cream paper and takes the theme&apos;s fonts and inks. The window also lists{' '}
              <strong>Themes you used</strong> (on this device), so the theme you gave the website can
              go on the kiosks and screens too.
            </P>
            <InfoBox type="tip">
              Without Pepper (switched off, or no AI key on the server) the window still makes the three
              themes from the picture&apos;s colours. Pepper&apos;s themes count towards your AI allowance
              like a chat; the picture isn&apos;t kept.
            </InfoBox>

            <H3>Boxed inset (margins) — customisable per step</H3>
            <P>
              The <strong>Layout</strong> card (Website &gt; Look &amp; layout, tenant-wide — applies to every
              venue's site) controls the side padding inside "boxed" and "wide" blocks. Padding is
              picked from 5 numbered <strong>steps</strong>, and you can now redefine what each
              step actually means: give it a plain pixel value (e.g. step 1 = 20px) or a
              percentage (e.g. step 3 = 5%) — mix units freely across the 5 steps.
            </P>
            <P>
              Below the step editor, two pickers set which step is the <strong>default</strong>
              (used everywhere) and which step applies only on narrow phones held upright (the{' '}
              <strong>mobile portrait override</strong> — tablets, phone landscape, and desktop
              always use the default). Any individual block can still override its own inset in
              the page builder's block inspector, picking one of the same 5 steps.
            </P>
            <P>
              Each step can also have its own <strong>mobile value</strong> — tick "Mobile" under
              any step card to give it a different px/% value on narrow phone portraits (≤600px)
              than on everything else, e.g. step 1 = 16px on desktop, 8px on mobile. This applies
              everywhere that step number is used — the site-wide default AND any individual
              block that's set its own inset to that step — so you don't need to separately tune
              mobile spacing per block.
            </P>
            <P>
              After clicking <strong>Save layout</strong>, publish the site again: the live site
              shows the last published version, so a new mobile value appears there only after the
              next publish. The mobile value applies on phones held upright; turn the phone sideways
              and the normal value is used.
            </P>
            <P>
              The two rows of step buttons below show what each step means on phones. The default
              step row shows a second line (for example &ldquo;8px mobile&rdquo;) when a step has a
              mobile value. The mobile portrait override row shows only the phone value, because it
              only applies on phones. If the override is set, it decides the phone padding for
              blocks that use the default, not the default step.
            </P>
            <InfoBox type="tip">
              A practical use: set step 1 to a fixed 20px for tight mobile margins, and set a
              different step to 5% so wide-screen margins scale with the page instead of staying
              a fixed width forever.
            </InfoBox>

            <H3>Give a location its own look</H3>
            <P>
              Every location&apos;s page starts on the group&apos;s brand (the logo, colours and fonts on the{' '}
              <strong>Brand &amp; theme</strong> page) and the website&apos;s layout. If you run more than one
              venue and want one location&apos;s page to look different (its own logo, colours, even its own
              site name), open Website &gt; <strong>Look &amp; layout</strong> and tap{' '}
              <strong>Give a location its own look</strong>, then pick the venue. This copies today&apos;s
              settings as a starting point and adds the venue as its own pill: from then on, editing that pill
              only changes that location, and the group&apos;s brand only changes locations without their own
              look. A new venue can get its own look while it is set up (New venue &gt; Brand &amp; theme).
            </P>
            <P>
              To go back to the group&apos;s brand, open that venue&apos;s pill and tap{' '}
              <strong>Remove override</strong> (with an inline confirm). The pills only show once you have more
              than one venue.
            </P>
            <P>
              The page builder previews every page in the site&apos;s template and brand:
              the home page, extra pages and modals, and each location page. A location page, and
              any page belonging to that location, previews with its own look when the
              location has one. The small label next to "Page builder" shows the template in use.
            </P>

            <H3>Custom domain</H3>
            <P>
              You can point your own domain (e.g. <Mono>www.yourrestaurant.com</Mono>) at your
              Macaroonie site. Open <strong>Domain → How to connect your domain</strong>
              for the full walkthrough (including the exact DNS records to add at GoDaddy,
              Cloudflare, Namecheap, and the rest). The short version:
            </P>
            <ol className="list-decimal ml-5 space-y-2 text-sm text-muted-foreground mb-4">
              <li>
                In <strong>Website → Domain</strong>, type the address guests will use, exactly:{' '}
                <Mono>www.yourrestaurant.com</Mono> and <Mono>yourrestaurant.com</Mono> are different.
                Save. You&apos;ll see <strong>DNS not verified</strong>.
              </li>
              <li>
                At your DNS provider (Cloudflare, GoDaddy, 123-reg etc.), add the record the guide
                shows: a <strong>CNAME</strong> to your Macaroonie address for <Mono>www.</Mono>, or an{' '}
                <strong>A record</strong> to the IP address it lists for the bare domain. On Cloudflare,
                set the record to <strong>DNS only</strong> (grey cloud).
              </li>
              <li>Wait a few minutes, then click <strong>Verify DNS</strong>.</li>
              <li>
                Once DNS is verified, our server switches the domain on by itself and gets its HTTPS
                certificate, usually within a minute or two. Until then the domain shows a plain{' '}
                <strong>404</strong> page: that is expected, not a fault in your DNS. Stay on the Domain
                section: it updates by itself and the link to your domain appears once it works.
              </li>
            </ol>
            <P>What the Domain section can say while it switches the domain on:</P>
            <DataTable
              head={['Message', 'What it means']}
              rows={[
                ['Switching … on', 'All good; it usually takes a minute or two.'],
                ['Waiting for …\'s DNS', 'Your domain doesn\'t point only at us yet. The message says where it points. Fix the record at your DNS provider; we check again every minute. A leftover IPv6 (AAAA) record that points elsewhere stops it too: delete it.'],
                ['Works on http:// only for now', 'The site is on, but the HTTPS certificate couldn\'t be issued yet. We try again by ourselves (the time is shown); pressing Verify DNS tries again sooner. Usual cause: Cloudflare\'s orange cloud (switch it to DNS only).'],
              ]}
            />
            <InfoBox type="info">
              Want both <Mono>yourrestaurant.com</Mono> and <Mono>www.yourrestaurant.com</Mono>? Enter one in
              the Domain section (that is the site&apos;s address) and point the other one at us too. It is
              switched on with the first and sends visitors to it, also if you add its DNS record later
              (within a minute of it pointing at us). Without that record, the other name doesn&apos;t work
              and browsers show it as not secure.
            </InfoBox>
            <InfoBox type="info">
              A browser that opened your domain before it was switched on can keep offering the old address
              from its history (an <Mono>http://</Mono> or <Mono>www.</Mono> one). Type the full{' '}
              <Mono>https://</Mono> address once, or try a private window, before deciding something is wrong.
            </InfoBox>
            <InfoBox type="warn">
              Typing a different domain clears the verified flag, and you&apos;ll need to verify again.
              Saving the Domain section without changing the domain keeps it verified.
            </InfoBox>

            <H3>Uploading images and PDFs</H3>
            <P>
              Any section with an image uses a standard upload button. Images are compressed
              on upload where sensible. Size limits:
            </P>
            <DataTable
              head={['File type', 'Max size', 'Formats']}
              rows={[
                ['Images (logo, favicon, hero, about, gallery, OG image)', '8 MB each', 'JPG, PNG, WebP, SVG, GIF, and ICO (for the favicon)'],
                ['PDF menus',    '25 MB each', 'PDF'],
                ['Allergen PDF', '25 MB',      'PDF'],
              ]}
            />

            <H3>Gallery — drag to reorder</H3>
            <P>
              The gallery section shows a grid of images. <strong>Drag any image</strong>
              by the grip handle (top-left) to reorder. Captions are edited inline — changes
              aren't saved until you click <strong>Save order &amp; captions</strong> at the
              bottom of the section.
            </P>
            <InfoBox type="tip">
              On touch devices, press-and-hold an image for a moment before dragging (so
              you don't trigger a page scroll by accident).
            </InfoBox>

            <H3>Menus (PDF viewer)</H3>
            <P>
              Upload a PDF (e.g. <em>Lunch Menu</em>) and Macaroonie embeds a nice inline
              viewer on your site at <Mono>{'{slug}.macaroonie.com/menu'}</Mono>. You can upload
              multiple PDFs — each appears as a tab button so guests can switch between them.
              A "Download PDF" link is always visible.
            </P>

            <H3>Allergen information</H3>
            <P>Two ways to tell guests about allergens:</P>
            <ul className="list-disc ml-5 space-y-1.5 text-sm text-muted-foreground mb-4">
              <li><strong>Upload PDF</strong> — simplest. Link to your existing allergen guide.</li>
              <li>
                <strong>Dish-by-dish table</strong> — add each dish and toggle which of the 14
                common UK/EU allergens it contains (gluten, dairy, egg, peanut, etc). Free-text
                notes per dish.
              </li>
            </ul>

            <H3>Opening hours</H3>
            <P>
              A 7-day grid with one or more <strong>sessions</strong> per day. A session is a
              continuous block (e.g. <em>Lunch 12:00–15:00</em>). Most restaurants will have two
              sessions per day — click <strong>Add session</strong> to add a second one.
              Tick <strong>Closed</strong> to mark a whole day (or a specific session) as closed.
            </P>

            <H3>Online ordering &amp; delivery</H3>
            <P>
              Both sections are lists. <strong>Add a row</strong>, paste the URL, click
              Save. The entries appear as buttons in their respective bands on your site.
              Delivery providers have a dropdown for a clean logo/label; Online ordering is free-text.
            </P>
            <InfoBox type="tip">
              These sections are hidden by default. Flip the "Show section on site" toggle at
              the top of each to make them visible.
            </InfoBox>

            <H3>Reservations widget</H3>
            <P>
              Guests book directly via an embeddable widget. <strong>Reservations widget</strong>
              in the sidebar lets you set the tenant-wide defaults that apply to every embed
              of the widget across all your venues.
            </P>
            <P>
              The flow visitors see: covers → date → time → details → confirmation.
              A month-view calendar with prev/next navigation, jump-to-date input, and
              closed days greyed out (hatched) so they can't waste clicks on the venue's
              day off.
            </P>
            <P>What you can customise on the Reservations widget page:</P>
            <ul className="list-disc ml-5 space-y-1.5 text-sm text-muted-foreground mb-4">
              <li>
                <strong>Header</strong> — show/hide the brand line at top, override the
                header text, override the "Book a table" sub-line.
              </li>
              <li>
                <strong>Button</strong> — background and text colour (pick from your brand
                palette), corner radius.
              </li>
              <li>
                <strong>Borders + radii</strong> — border colour, card/chip corner radius.
              </li>
              <li>
                <strong>Typography</strong> — three independent font tracks: <em>Body</em>
                (header, button labels, form fields), <em>Calendar</em> (date numbers),
                <em>Time slots</em> (HH:MM buttons). Each has its own font picker and
                size slider — mix a script font for the calendar with a sans-serif for
                slots, etc.
              </li>
              <li>
                <strong>Calendar day colours</strong> — Open day vs Closed day, each with
                background, text, and border. Pick from the brand palette.
              </li>
              <li>
                <strong>Messages</strong> — "Larger party? Call us" copy override.
              </li>
              <li>
                <strong>Debug</strong> — diagnostic overlay at top of widget showing live
                state. Leave off for normal customers; flip on to debug.
              </li>
            </ul>

            <P>Two ways to use it on a site:</P>
            <ul className="list-disc ml-5 space-y-1.5 text-sm text-muted-foreground mb-4">
              <li>
                <strong>On your Macaroonie site</strong> — add a <em>Reservations widget</em>
                block from the Page builder. Same controls as the tenant defaults but
                per-block, so a specific page can override fonts/colours without changing
                the tenant default. Set <em>Anchor ID</em> in the block to make it linkable
                with <Mono>&lt;a href="#book-now"&gt;</Mono> from anywhere.
              </li>
              <li>
                <strong>On any other site</strong> — the <em>Share &amp; embed</em> card on
                the Reservations widget page generates both a direct URL (for email links,
                QR codes, link-in-bio) and an iframe embed code (for embedding inline on
                third-party sites). Both bake your saved defaults into URL query params.
              </li>
            </ul>
            <InfoBox type="info">
              The widget posts a <Mono>macaroonie:booking-confirmed</Mono> message to the
              parent window when a booking succeeds — your dev can hook this for analytics,
              redirects, or thank-you popups. The hold TTL (configurable per venue in Rules,
              default 5 min) reserves the slot client-side; abandoning the form releases it.
            </InfoBox>

            <H3>Pages & modals</H3>
            <P>
              For content that doesn't fit elsewhere — <em>Private Dining</em>, <em>Careers</em>,
              <em>Events</em>, <em>Terms &amp; Conditions</em>. Each page has:
            </P>
            <ul className="list-disc ml-5 space-y-1.5 text-sm text-muted-foreground mb-4">
              <li>A <strong>title</strong>.</li>
              <li>A <strong>URL slug</strong> — standalone pages live at <Mono>/p/{'{slug}'}</Mono>; modals also open from <Mono>#modal/{'{slug}'}</Mono>.</li>
              <li><strong>Opens as</strong> — standalone page or modal overlay.</li>
              <li>The same <strong>block builder</strong> as the home page. Set Anchor ID on a block to deep-link a section.</li>
              <li>Every nav / button / footer link uses a <strong>link selector</strong>: this page (with or without an anchor), other pages, modals, or a custom URL.</li>
            </ul>
            <P>
              The list always includes <strong>Order online</strong>, your online ordering page at{' '}
              <Mono>/order</Mono> (marked <em>Ordering</em>). Design it like any other page: add a hero,
              some text or photos around the <strong>Online ordering</strong> block, which shows the menu,
              basket and checkout. You can rename it, but it always stays at <Mono>/order</Mono>, stays
              published and can&apos;t be deleted; switch ordering on or off in Online orders, Setup.
              The Online ordering block can also go on another page (one per page).
            </P>
            <P>
              The list also always includes <strong>Loyalty</strong>, your loyalty page at{' '}
              <Mono>/loyalty</Mono> (marked <em>Loyalty</em>), holding the <strong>Loyalty card</strong>{' '}
              block where guests join, sign in and see their card. It works the same way: rename it and
              design around the block, but it stays at <Mono>/loyalty</Mono>, stays published and
              can&apos;t be deleted. See Loyalty, The Loyalty page on your website.
            </P>

            <H3>SEO &amp; Analytics</H3>
            <P>
              Set the meta title (what shows in browser tabs and search results) and meta
              description (the preview snippet under the title). Upload a social preview image
              (ideally 1200×630 — this is what appears when someone shares your URL on Facebook,
              WhatsApp, iMessage, LinkedIn etc.).
            </P>
            <P>
              <strong>Restaurant details for search</strong> — fill in <em>Cuisine type</em>
              (e.g. Thai, Italian, Japanese) and <em>Price range</em> ($–$$$$). These appear
              directly in Google search results and are also read by AI assistants such as
              ChatGPT, Perplexity, and Google Gemini when they summarise your restaurant. The
              system embeds them as <Mono>schema.org/Restaurant</Mono> structured data (JSON-LD)
              on every page of your site automatically.
            </P>
            <P>
              Your site also serves an <Mono>llms.txt</Mono> file at{' '}
              <Mono>{'https://{slug}.macaroonie.com/llms.txt'}</Mono> — a plain-text index
              that AI crawlers read to discover your venues, addresses, opening hours, and booking
              links without having to parse HTML. No action required on your part; it is generated
              automatically from your published content.
            </P>
            <P>
              Analytics: paste your <strong>Google Analytics 4 measurement ID</strong> (starts
              with <Mono>G-</Mono>) and / or a <strong>Meta Pixel ID</strong>. Both are injected
              on every page automatically. Make sure you comply with your cookie-consent rules.
            </P>

            <H3>Publishing &amp; going live</H3>
            <ol className="list-decimal ml-5 space-y-2 text-sm text-muted-foreground mb-4">
              <li>Fill in at minimum: site name, logo, hero image + heading, opening hours, contact details.</li>
              <li>Preview by visiting <Mono>{'https://{slug}.macaroonie.com'}</Mono> — works even while unpublished for admins.</li>
              <li>
                When you're ready, go to <strong>Setup &amp; domain</strong>, flip
                <em>&nbsp;Site is live</em> on, and save.
              </li>
              <li>Your site is now public. Any future change you save applies within ~1 minute.</li>
            </ol>
            <InfoBox type="warn">
              Publishing is a hard on/off switch. When off, visitors see a 404 page — regardless
              of how much content you've filled in.
            </InfoBox>

            <H3>Common issues</H3>
            <div className="space-y-2.5">
              <div className="space-y-1.5 border rounded-xl px-4 py-3">
                <p className="text-sm font-semibold">"Subdomain already taken"</p>
                <p className="text-sm text-muted-foreground">
                  Subdomains are global — one per Macaroonie customer. Try adding a city or brand
                  qualifier: <Mono>wingstop-london</Mono> instead of <Mono>wingstop</Mono>.
                </p>
              </div>
              <div className="space-y-1.5 border rounded-xl px-4 py-3">
                <p className="text-sm font-semibold">Changes don't appear on the site</p>
                <p className="text-sm text-muted-foreground">
                  Make sure you clicked <strong>Save</strong> at the bottom of the section
                  (changes are never auto-saved). Then hard-refresh your browser (Ctrl-Shift-R or
                  ⌘-Shift-R) — your site is cached for about a minute.
                </p>
              </div>
              <div className="space-y-1.5 border rounded-xl px-4 py-3">
                <p className="text-sm font-semibold">"DNS not verified" after I added the CNAME</p>
                <p className="text-sm text-muted-foreground">
                  DNS can take up to 24 hours to propagate. Try again in 10 minutes. The verify
                  button's error message shows what records we saw — use it to double-check your
                  DNS provider.
                </p>
              </div>
              <div className="space-y-1.5 border rounded-xl px-4 py-3">
                <p className="text-sm font-semibold">Gallery images don't reorder</p>
                <p className="text-sm text-muted-foreground">
                  Grab the image by the grip handle (top-left of each card), not by the image
                  itself. On touch devices, press-and-hold briefly before dragging.
                </p>
              </div>
              <div className="space-y-1.5 border rounded-xl px-4 py-3">
                <p className="text-sm font-semibold">Theme changes didn't apply to my custom pages</p>
                <p className="text-sm text-muted-foreground">
                  Custom pages inherit the theme automatically — no action needed. If you're
                  still seeing the old style, hard-refresh your browser to bypass the cache.
                </p>
              </div>
            </div>
          </section>

          {/* ── MENUS ──────────────────────────────────────── */}
          <section id="menus" data-help="">
            <H2>Menus</H2>
            <P>
              The <strong>Menus</strong> page (sidebar nav) is a structured menu builder —
              sections (Starters, Curries, …) containing dishes, each with a price, optional
              description and photo. Menus display on your website via the Booking widget's
              menu block and can be opened as a printable PDF at any time.
            </P>
            <P>
              To give a dish (or a section) its photo, tap the picture box and pick one from Media, or
              drag a photo from your computer straight onto the box.
            </P>
            <P>
              Anyone who can manage Menus can also build and change menus by chat: attach a photo or
              PDF of a menu to <strong>Ask Pepper</strong> and ask it to make the menu, or ask it to
              change a price, add an allergen or put a section up 5%. See <strong>Pepper → Menus by
              chat</strong>.
            </P>
            <H3>A menu from a photo or PDF</H3>
            <P>
              <strong>From a photo or PDF</strong> on the Menus page (also the Menu step when setting up a new venue)
              makes a whole menu from the menu you already have. Add photos of each page (in order) or a PDF:
              choose files, drop them on the box, or take a photo on a tablet or phone. Up to 10 files, photos up to
              5 MB each and PDFs up to 10 MB. Optionally say what to know ("only the dinner pages; prices are for eat
              in"), then tap <strong>Read the menu with Pepper</strong>; a long menu takes a minute or two.
            </P>
            <P>
              Pepper lists the sections and dishes it read with their prices, descriptions, allergens, dietary tags
              and options (sizes, extras). Check them: change a name or price, open a dish for its description, remove
              anything that isn&apos;t right, add a dish it missed, and give the menu a name and the venue it is for.{' '}
              <strong>Make the menu</strong> saves it as a draft, not published: check it in the menu editor, add
              photos, then publish it. Allergens and dietary tags are matched to the ones you already have (never
              added); options use your option groups where they match, or get a new group named after the menu. It
              needs Manage on Menus and Pepper switched on, and counts towards your AI allowance like a chat. A
              reading is only as good as the picture: check every price before publishing.
            </P>
            <H3>Publishing menu changes</H3>
            <P>
              Saving a menu saves a <strong>draft</strong>. Guests and staff keep seeing the{' '}
              <strong>live</strong> menu until you publish: the website, online ordering, the till,
              the Deliveroo menu file, cooking check dish buttons and the allergen lookup all use the
              live menu. So you can change several prices over a few days, check them, and put them
              all out at once.
            </P>
            <P>
              The <strong>Publish</strong> button sits next to Save at the top of a menu. Its small
              badge counts the saved changes that aren&apos;t live yet (a dot means the menu has never
              been published, a clock that a publish is scheduled); while changes are waiting it is
              the coloured button. Tap it to open the <strong>Publishing</strong> window: what is
              live, and every change waiting to go live (prices in amber, dishes added in green,
              removed in red). Then:
            </P>
            <DataTable
              head={['Button', 'What it does']}
              rows={[
                ['Publish now', 'Asks you to confirm, then the changes go live straight away. Open tills update within a few seconds.'],
                ['Schedule', 'Pick a date and time. The live menu stays as it is until then, and switches by itself at that time (within a minute). Use it for a planned price rise or a new season\'s menu. Changes you save after scheduling are not included: publish again for those.'],
                ['Preview print', 'Prints the draft, so you can check it before guests see it. The link works for an hour.'],
                ['Discard changes', 'Puts the live menu back into the editor and throws the unpublished changes away. Asks you to confirm first.'],
                ['Cancel (scheduled)', 'Withdraws a scheduled publish before it goes live. The draft is not changed.'],
                ['Publish history', 'Every publish, newest first. Preview prints an earlier version; Copy into editor puts it back into the draft (nothing goes live until you publish it).'],
              ]}
            />
            <P>
              Save your changes before publishing: the Publishing window asks you to while the menu has
              unsaved changes. A brand-new menu isn&apos;t on the website, online ordering or the till
              until its first publish. <strong>Shown to guests</strong> (in the menu&apos;s Settings)
              is part of the draft too, so hiding a menu also takes effect when you publish.
            </P>
            <P>
              On the Menus list, each menu shows <strong>LIVE</strong>,{' '}
              <strong>LIVE · CHANGES NOT PUBLISHED</strong>, <strong>NOT PUBLISHED</strong> or{' '}
              <strong>GOES LIVE</strong> with the time of a scheduled publish. Print and Dietary list
              on the list print the live menu; in the menu editor they print the saved draft. Staging
              websites show the draft too, so you can check a website change before publishing.
            </P>
            <P>
              Some things are not part of a menu&apos;s publish and change straight away: the
              allergen and dietary tag list (names, colours, badges), the allergen notice, option
              groups themselves (Menus &rarr; Variant groups), print designs and which one prints,
              and dishes marked sold out for online ordering.
            </P>
            <H3>Sections and dishes</H3>
            <P>
              Click <strong>Add section</strong> to create a category, then <strong>Add
              dish</strong> inside it. Every dish can have a single price, or — for dishes sold
              in multiple sizes/proteins — one or more <strong>variant groups</strong> (managed
              separately under Menus → Variant groups) attached with per-dish price overrides.
            </P>
            <P>
              Tap a dish to edit it in the panel on the right. Tap a section's heading to edit the
              section there too: its title, subtitle, small icon, <strong>Highlight</strong>, print
              options and tax. The section heading shows badges for what is set
              (Highlight, Tax, New page…). Deleting a section is in its panel and asks you to confirm.
            </P>
            <P>
              Deleting a whole menu also takes it off <strong>Ordering setup</strong> (with its menu
              times), every <strong>revenue stream</strong> that named it and the{' '}
              <strong>Deliveroo menu file</strong> settings. A revenue stream left with no menus shows
              every menu on its tills.
            </P>
            <P>
              To change the order of dishes, drag a dish by its grip (the dotted handle on the left
              of the row) up or down. A dish stays in its own section; to move it to another
              section, delete it and add it there. The small arrows still move a dish one place at
              a time. Click <strong>Save changes</strong> to keep the new order.
            </P>
            <P>
              <strong>A dish&apos;s option groups</strong> (Variant groups, at the bottom of its panel)
              show as cards, closed at first: each says the group&apos;s name, how many options it has
              and how many prices you changed for this dish. Tap a group&apos;s name to open it and set
              this dish&apos;s prices; tap it again to close it. A group you attach opens straight away.
              Drag a group by its grip to change the order: the till, kiosks and online ordering ask
              the groups in that order (flavour first, then dips). Save changes keeps the order;
              guests get it once the menu is published.
            </P>
            <P>
              <strong>Options on this dish only.</strong> Some dishes have options added to the dish
              itself rather than from an option group: the sample menus, menus made before option
              groups, and some imports. The dish&apos;s row shows a small amber badge with how many,
              and its panel lists them in an amber card above its option groups. Guests pick one, at
              its price, before any group. They are kept when you save. They can&apos;t be changed
              here; the card has two buttons:
            </P>
            <ul className="list-disc ml-5 space-y-2 text-sm text-muted-foreground mb-4">
              <li><strong>Turn into an option group</strong>: makes an option group with the same
                options and prices (on Menus &rarr; Variant groups, named after the options, where you
                can rename it and use it on other dishes; guests still see the heading
                &ldquo;Choose&rdquo;). It goes first among the dish&apos;s groups. When a group with the
                same options already exists, the button says <strong>Use the option group</strong> and
                the dish uses that group, keeping its own prices. A meal deal that changed these
                options (Options in this deal) changes the group instead.</li>
              <li><strong>Remove</strong>: takes them off the dish, after asking. Guests then order it
                at its own price, so give it one if it has none.</li>
            </ul>
            <P>
              Both are part of the menu draft: Save changes keeps them. The new group itself is made
              straight away (it stays on Variant groups even if you don&apos;t save).
            </P>
            <P>
              <strong>On a phone</strong> each dish&apos;s badges, price and buttons go on a second line
              under its name, a dish&apos;s or section&apos;s panel opens over the whole screen (close it
              with the cross), and the buttons along the top show only their icons. Save with the bar
              at the bottom, which shows as soon as there is something to save.
            </P>
            <H3>Copying dishes, sections and options</H3>
            <P>
              <strong>Copy a dish</strong>: tap the copy icon on its row, or <strong>Copy</strong> at
              the top of its panel. The copy goes just after it, named &ldquo;(copy)&rdquo;, with
              everything the dish has: price, description, photo, options with this dish&apos;s own
              prices, allergens and tags, till, tax and online settings, a combo&apos;s steps. Its panel
              opens so you can rename it.
            </P>
            <P>
              <strong>Copy a section</strong> (a category): tap the copy icon on the section&apos;s
              heading, or <strong>Copy</strong> at the top of its panel. The copy goes just after it with
              all its dishes, each keeping its own name; only the section is named &ldquo;(copy)&rdquo;.
              A meal deal in the section that offers a dish of the section, or the whole section,
              offers the copy&apos;s.
            </P>
            <P>
              <strong>Copy options from another dish</strong>: in a dish&apos;s panel, under Variant
              groups, pick a dish from <strong>Copy options from another dish</strong> (only dishes
              with option groups are listed). Its groups come over with that dish&apos;s prices; a
              group this dish already has takes those prices too, and its other groups stay.
            </P>
            <P>
              Copies are part of the menu draft: nothing is kept until <strong>Save changes</strong>,
              and guests see them once the menu is published. Translations aren&apos;t copied with a
              dish or section; the print designer lists the copies under Not placed yet.
            </P>
            <P>
              <strong>Copy an option group</strong>: on <strong>Menus &rarr; Variant groups</strong>,
              tap the copy icon on a group. The copy, &ldquo;Name (copy)&rdquo;, is made straight away
              just after it with every setting and option (prices, pictures, words, levels, then ask),
              and opens so you can rename or change it. It isn&apos;t on any dish until you attach it.
              Translations of its options come with it.
            </P>
            <P>
              <strong>Where a section shows.</strong> In a section's panel, <strong>Where it
              shows</strong> has three choices. <strong>Everywhere</strong> is the usual.{' '}
              <strong>Hide on website</strong> keeps the section on printed menus but leaves it off
              your website and online ordering (so its dishes can't be ordered online), for example a
              set menu you only hand out in the restaurant. <strong>Hide everywhere</strong> takes it
              off printed menus too; it stays on this page so you can show it again later. The
              section heading shows a <strong>Print only</strong> or <strong>Hidden</strong> badge.
            </P>
            <DataTable
              head={['Field', 'What it does']}
              rows={[
                ['Calories', 'Optional kcal count shown next to the price on the website and printed menu. Leave blank for dishes you haven\'t calculated yet — nothing is required.'],
                ['Category icon', 'A small image/icon next to a section\'s title (e.g. a little flame for "Spicy", a leaf for "Vegan Specials"). Upload something roughly square — 64×64 or 96×96 px works well — it always displays small, no bigger than the heading text next to it, regardless of the source size.'],
                ['House favourite', 'Highlights the dish with the featured styling.'],
                ['Dietary tags', 'Small coloured badges (vegan, gluten-free, spicy, …) shown next to the dish name. Tap one in the dish panel to switch it on or off.'],
                ['Allergens', 'One tile per allergen. Tap a tile to step through No, Contains, May contain and Can be removed. All three show the allergen\'s badge on the menu; Can be removed adds a small asterisk, explained by the allergen notice\'s asterisk note.'],
              ]}
            />
            <H3>Option groups: more than once, and behind a button</H3>
            <P>
              On <strong>Menus &rarr; Variant groups</strong>, two settings change how a group is picked
              on the till and the ordering page. <strong>The same option more than once</strong> lets a
              guest take an option twice or more (2 x Extra cheese): each tap adds one, a minus takes one
              off, each one is charged and counts towards &ldquo;at most&rdquo;. <strong>Don&apos;t open
              it by itself: show a button for it</strong> (only for optional groups, at least 0) keeps the
              group closed behind a &ldquo;+ Extras&rdquo; button, so guests who don&apos;t want extras
              aren&apos;t shown them. Tickets, the kitchen screen and receipts show repeats as
              &ldquo;2 x Cheese&rdquo;.
            </P>
            <H3>Option group display names</H3>
            <P>
              A group&apos;s <strong>Group name</strong> is yours, for telling groups apart here and on the
              Menus page (Flavour x2, Flavour x2 (copy)). Its <strong>Display name</strong> is what guests
              see as the heading over its options, such as Choose your flavours: on kiosks, the ordering
              page, the website, printed menus and menu screens, and on the tills. Leave it empty to show
              the group name. The list says <strong>Guests see: ...</strong> for groups that have one. A
              new or changed display name reaches a menu&apos;s guests when the menu is published (the menu
              shows changes not published, like a rename); translate it on Menus → Translations.
            </P>
            <H3>Option group types for stock</H3>
            <P>
              Open a group on <strong>Menus &rarr; Variant groups</strong>: <strong>Recipe and stock</strong>
              says what its options do to the dish. <strong>Product modification</strong>: the dish changes a
              lot, things go on and off its recipe (Make it vegan, No bun). <strong>Side addition</strong>: a
              separate item with its own recipe (a dip pot, fries, a drink). <strong>Adds to the
              recipe</strong>: something added to the dish&apos;s own recipe (extra cheese, a sauce on the
              wings). <strong>Not set</strong> until you pick one. Nothing uses it yet: stock counts will, so
              setting it now saves going through every group later. The list shows each group&apos;s type
              under its name, and a copy of a group keeps it.
            </P>
            <H3>Combos</H3>
            <P>
              A combo is a menu item like any other (in any section, with its own price, description and
              photo) that is put together in steps: for example Main, Side, Drink, then an optional sauce
              pot. Open a dish and tap <strong>Combo</strong> at the top of its panel (Dish is the usual).
              The price is the combo&apos;s own price, and it can be £0 when every choice carries its own
              price. Tap <strong>Edit steps</strong> to build it:
            </P>
            <DataTable
              head={['Setting', 'What it does']}
              rows={[
                ['Step name', 'What the guest is choosing, e.g. "Choose your side". Steps go in order; drag the grip to move one.'],
                ['How many', 'At least / at most. At least 0 makes the step optional.'],
                ['The same choice more than once', 'e.g. 2 x Cola. Each one counts towards "at most".'],
                ['Pick it by itself when there\'s one choice', 'A step with only one choice is filled in for the guest and skipped (its dish\'s own options are still asked).'],
                ['Don\'t open it: show a button', 'Only for optional steps: the step waits behind a "+ Sauce pot" button.'],
                ['When it shows', 'Always, or only when something is picked in an earlier step, e.g. Sauce pot only with Fries. Change that pick and the step (and what was chosen in it) goes.'],
                ['Choices', '+ Dishes picks dishes from this menu; + A whole section offers every dish in a section (dishes added to it later too); + New choice is a choice typed in just for this combo (e.g. Surprise toy), with an optional kitchen name. Each choice can have an extra charge (e.g. Shake +£1.50).'],
              ]}
            />
            <P>
              A dish picked in a step keeps its own option groups unless you change them for the deal
              (see Options in a meal deal below): a burger still asks for its cooking or extras, at the
              dish&apos;s extra prices. Its size or protein (options that set the dish&apos;s price)
              don&apos;t change the combo&apos;s price; only extra charges do. A combo can&apos;t be a
              choice in another combo. Dishes switched off for online ordering can still be a
              combo&apos;s choice.
            </P>
            <P>
              <strong>Manual or Automatic.</strong> A manual combo is only used when it is chosen: its
              own button, or <strong>Make it a combo</strong> on a dish already on a till order. An
              automatic combo also applies by itself when an order has its dishes as separate items, on
              the till and online, whenever that makes the order cheaper. The items stay as they were
              entered; the check or basket shows them as &ldquo;In Burger meal&rdquo; and the saving as
              a line (&ldquo;Burger meal &minus;£3.50&rdquo;). It is checked again whenever the order
              changes.
            </P>
            <P>
              On the website, printed menus and menu screens a combo shows like a dish: its name,
              description and price, with <strong>from</strong> when choices can cost more (the panel
              shows &ldquo;Shown as from £11.00&rdquo;). The steps only appear when ordering, and on a
              menu screen set to <strong>How to order (steps)</strong>. The panel lists anything that
              stops a combo working, for example a step with no choices.
            </P>
            <InfoBox type="info">
              Promotions also has a <strong>Meal deal</strong> kind: a set price when a basket happens to
              hold a starter, a main and a drink, online only. A combo is a menu item of its own with
              steps, on the till and online; an automatic combo also finds its dishes as separate items.
            </InfoBox>
            <H3>Options in a meal deal</H3>
            <P>
              In <strong>Edit steps</strong>, each dish or section choice has{' '}
              <strong>Options in this deal</strong> under its name: what that dish asks inside the deal,
              one option group at a time. The dish stays the menu&apos;s dish, so its kitchen stations,
              allergens, photo, sold out and (later) stock still follow it; only what the guest is asked
              changes. The line under the button says what is changed (&ldquo;Flavour: 3 of 4, choose 1
              to 2 · Dip: not asked&rdquo;), or <em>As on the dish</em>.
            </P>
            <DataTable
              head={['For each group', 'What the deal asks']}
              rows={[
                ['As on the dish', 'What the dish asks on its own (the usual).'],
                ['Leave out', 'Not asked in the deal, e.g. no dip question for the meal\'s wings.'],
                ['Only some', 'Tap an option to leave it out of the deal, e.g. three of the four flavours. At least one stays.'],
                ['Another group', 'A group from Variant groups asked instead, e.g. Meal sauce (free ketchup, or mayo +20p) in place of the fries\' own sauces. Make a copy copies the dish\'s own group and asks the copy: change the copy\'s options and prices on Variant groups (the link at the bottom opens it in a new tab), and the dish on its own keeps its group.'],
                ['How many', 'At least and at most inside the deal, e.g. up to two flavours in the meal while the wings on their own take one. Leave it on As the group to keep the group\'s own.'],
                ['Extra charges in the deal', 'Tap to open it: a box per option the deal asks, for what that option costs on top of the deal\'s price, e.g. Atomic +0.50 or Large +2.00 in the meal. Empty is as on the dish: an option that adds to the dish\'s price keeps its own charge (shown greyed in the box), and an option that sets the dish\'s price (a size, a flavour) costs nothing extra, because the deal\'s price replaces the dish\'s. 0.00 makes an option free in the deal, e.g. a sauce that costs 20p on its own.'],
              ]}
            />
            <P>
              <strong>In the deal:</strong> under each group shows what will be asked. A choice offering a
              whole section changes every dish in it that has that group. Prices follow what is asked: an
              option left out can&apos;t be picked, and another group charges its own prices. The changes
              belong to the combo: they are saved with the menu and go live when it is published, on the
              kiosk, the till and online ordering alike, and kitchen tickets show each part with what was
              picked. <strong>Make it a combo</strong> on the till keeps only the picks the deal asks for.
              An automatic combo only counts a dish ordered on its own when the deal could have asked it
              that way: with three of the four flavours, wings ordered with BBQ don&apos;t make the deal,
              while a dip the deal leaves out simply stays on the wings at its own price. A group later
              taken off the dish drops out of the deal the next time the menu is saved.
            </P>
            <P>
              <strong>Extra charges.</strong> The deal&apos;s own charge for an option shows beside it on the
              kiosk, the till and online ordering (&ldquo;Atomic +£0.50&rdquo;), is added to the meal&apos;s
              price when picked, and is on the line and the receipt. The window&apos;s <em>In the deal</em>{' '}
              line lists the charges, and the line under the button names them (&ldquo;Flavour: 3 of 4, Atomic
              +£0.50&rdquo;). A menu that has any deal charge shows the meal as <strong>from</strong> its
              price. A step that picks itself (one choice) shows its choice&apos;s extra charge beside{' '}
              <em>Included</em> on the till and online, e.g. <em>Included · +£1.00</em>.
            </P>
            <P>
              <strong>One option left.</strong> When a group the deal changes is left with a single option
              and something has to be picked from it (Only some down to Lemon pepper, say, in a flavour
              group that asks for one), the deal picks it for the guest: the kiosk, the till and online
              ordering don&apos;t ask it, but it is on the line, the kitchen ticket, the meal&apos;s picture
              and the price (an extra charge on that option still applies). The window says{' '}
              <em>always Lemon pepper. Guests aren&apos;t asked</em>, and the line under the button says{' '}
              <em>Flavour: always Lemon pepper</em>. A dish left with nothing to ask gets no page of its own
              on the kiosk. An optional group left with one option (a dip they might not want) is still
              asked, as yes or no: set How many to at least 1 to always include it without asking (for a
              group that can be picked more than once, the same number at least and at most, e.g. 2 to 2 for
              two Ranch dips). An option that opens a question of its own (Steak, then how it&apos;s cooked)
              is still asked.
            </P>
            <H3>Allergens and dietary tags</H3>
            <P>
              <strong>Menus &rarr; Allergens &amp; dietary</strong> has two lists.{' '}
              <strong>Allergens</strong> starts with the 14 allergens UK law says you must declare
              (celery, gluten, crustaceans, eggs, fish, lupin, milk, molluscs, mustard, nuts, peanuts,
              sesame, soya and sulphites), marked <strong>Standard</strong>. If any are missing, an
              amber bar offers to add them back. <strong>Dietary tags</strong> are the rest: vegan,
              gluten-free, spicy and so on. Tap a tag to change its label, badge text, code, colour
              or type, and drag the grips to change the order the badges show in (dietary tags come
              before allergens on the menu).
            </P>
            <P>
              A dish either has a dietary tag or not. An allergen has one of four settings for each
              dish: <strong>Contains</strong>, <strong>May contain</strong> (for example a risk of
              cross-contact), <strong>Can be removed</strong> (the dish has it but the kitchen can
              make it without), or no setting (the dish doesn&apos;t have it). On the website, the
              printed menu, the dietary list and online ordering the first three look the same, the
              allergen&apos;s badge, except that Can be removed adds a small asterisk, explained by the
              allergen notice (below).
            </P>
            <P>
              If you had your own tag for an allergen before, for example &ldquo;N&rdquo; for nuts,
              it was turned into that allergen, so dishes kept their badge. If you end up with two tags
              for the same thing, open the one you don&apos;t want and use <strong>Merge into another
              tag</strong>: every dish moves onto the tag you pick and the old one is deleted. Which
              badges a key under a menu lists is set in the allergen notice (below).
            </P>
            <P>
              <strong>Keeping a tag off menus.</strong> Open a tag and set <strong>On menus</strong> to{' '}
              <strong>Hide</strong> when guests don&apos;t need its badge, for example the Gluten allergen
              when your dishes already show a Gluten-free tag. A hidden tag is left off the website, printed
              menus and their keys, the dietary list and online ordering. You still set it on dishes as
              usual, and it still shows in the Allergen matrix, the allergen lookup and the menu editor,
              so staff can answer allergy questions. The list marks it <strong>Not on menus</strong>, and
              the matrix and dish panel show a crossed-out eye next to it.
            </P>
            <P>
              <strong>The allergen notice.</strong> The <strong>Allergen notice</strong> card at the bottom
              of the same page sets what guests read under your menus. One notice is used everywhere:
            </P>
            <DataTable
              head={['Setting', 'What it does']}
              rows={[
                ['Title and Text', 'Your own words, for example "Allergies & Diet" and "Please tell us about any allergies before you order." Leave the title blank for none.'],
                ['Tags in the key', 'Tap a badge to put it in the key under the notice, or take it out. All and None do a whole list at once. A tag hidden on menus is greyed out: it is never in the key.'],
                ['Which ticked tags a menu lists', 'Only the ones its dishes use (each menu lists just the ticked badges that appear on it), or All of them (every ticked badge, whatever the menu).'],
                ['Asterisk note', 'Explains the asterisk on a dish whose allergen can be removed, for example "Ask us to leave it out". Shown whenever a dish on the menu has one, so it can\'t be blank.'],
                ['Online ordering line', 'An extra line shown only on the online ordering page, followed by the venue\'s phone number when it has one. Leave it blank for none.'],
              ]}
            />
            <P>
              The preview shows the notice as guests will see it. Click <strong>Save notice</strong> to
              apply it, or <strong>Discard</strong> to go back. Where it shows:
            </P>
            <DataTable
              head={['Where', 'How']}
              rows={[
                ['Printed menus', 'Add an Allergies & Diet footer note to the menu (Footer callouts on the menu page). It prints the notice and its key; it no longer has words of its own. In the menu designer, the Footer notes block prints it the same way, and the Allergen key block prints only the key.'],
                ['Dietary list', 'At the bottom of the list. With "Only the ones its dishes use", the key follows the dishes you tick under Choose dishes.'],
                ['Website menu block', 'Under the menu, on by default. Untick "Show allergen notice" in the block settings to leave it off (the asterisk note still shows when a dish needs it).'],
                ['Online ordering', 'Under the menu, followed by the online ordering line.'],
              ]}
            />
            <InfoBox type="tip">
              Every reading here saves as part of the whole menu — click <strong>Save</strong> at
              the top of the page once you're done editing, same as any other admin form.
            </InfoBox>
            <H3>Printing</H3>
            <P>
              Every menu has a printable version at <strong>Open as printable PDF</strong> (also
              linked from the bottom of the menu block on your website) — no extra setup, it
              renders straight from the browser's print dialog. Columns, paper size and
              orientation are configurable per menu.
            </P>
            <P>
              <strong>Print layout.</strong> Under <strong>Settings</strong> on a menu you can also
              set the <strong>font size</strong> (80% to 130%), the <strong>page margins</strong>,
              what header later pages get (none, a one-line menu name, or the full header),
              whether the <strong>footer repeats</strong> on every page (allergen key, notes and
              footer line), <strong>page numbers</strong>, and <strong>Keep every section in one
              piece</strong>, and <strong>Variant options per row</strong> (1, 2 or 3): with 2 or 3, a
              dish's options such as Chicken, Prawns and Beef sit side by side with their prices,
              which saves space on long menus. In each section's panel (tap its heading), choose whether it continues
              after the previous section, <strong>starts in a new column</strong> or{' '}
              <strong>starts on a new page</strong>, and whether to keep that section in one piece.
            </P>
            <P>
              The print page shows each printed sheet separately and says at the top how many
              pages there are. If a page is too long for one sheet it is marked in red with how
              much too long it is. Fix it by starting a section on a new page, letting a long
              section split, or making the font smaller. Otherwise that page runs onto an extra
              sheet without its header and footer. The check needs a window wide enough to show
              the page at full size.
            </P>
            <P>
              Dietary tag colours, highlighted sections and house favourites keep their background
              colour on paper and in a saved PDF, even with the print dialog's &ldquo;Background
              graphics&rdquo; option off. The cream page background does not print, which saves ink.
            </P>
            <H3>Allergen matrix</H3>
            <P>
              <strong>Menus &rarr; Allergen matrix</strong> shows every dish of one menu as a row, the
              allergens as the first columns and the dietary tags after them. Pick the menu at the top
              and use the search box to find a dish by name. Tap an allergen box to step through{' '}
              <strong>Contains</strong> (the badge), <strong>May contain</strong> (the badge
              outlined on a pale background), <strong>Can be removed</strong> (the badge with an
              asterisk) and back to empty; the key above the table shows the three. Tap a dietary box
              to switch the tag on or off. Changed boxes get an amber outline, and
              nothing is stored until you tap <strong>Save</strong> (it says how many dishes you
              changed). <strong>Discard</strong> puts everything back. You can&apos;t switch menu while
              there are unsaved changes.
            </P>
            <P>
              The columns are your tags from Menus &rarr; Allergens &amp; dietary. A setting here is
              the same one the dish panel in the menu editor shows, and the same badge the dish shows
              on the website, the printed menu and the dietary list.
              Sections hidden on the website or everywhere still show here, marked as hidden. If the
              same menu is open in the menu editor, save one before changing the other, or the later
              save puts back the tags it loaded.
            </P>
            <InfoBox type="tip">
              Add an <strong>Allergen lookup</strong> widget to an H&amp;S dashboard, or the Allergen
              lookup tile to the Overview, so front-of-house staff can answer allergy questions
              without editing anything. Press <strong>Allergens &amp; diet</strong> to open every tag
              as a grid: tap a tag once to list dishes that have it, twice to list dishes free from
              it, and a third time to clear it, then press <strong>Show dishes</strong>. The filters
              you picked stay under the search; tap one to remove it. Free from also lists dishes the
              allergen can be removed from, marked &ldquo;Ask for it without&rdquo; that allergen;
              dishes that may contain it are never listed as free from it. Sections hidden everywhere
              are left out of the lookup. Tap a dish to see its tags written out in full, grouped
              Contains, May contain, Can be removed and Dietary.
            </InfoBox>
            <P>
              On a phone, open the Ops app (<strong>/mobile</strong>) and tap{' '}
              <strong>Allergens</strong>. Pick the menu and search a dish; the menu and search box
              stay at the top while you scroll. Tap <strong>Filter by allergen or diet</strong> to open
              the tag buttons; once a filter is on, the button says which (for example
              &ldquo;Free from Milk&rdquo;). Tap a dish to see its description and every tag by name.
              The phone remembers the last menu you picked.
            </P>
            <H3>Dietary list</H3>
            <P>
              Tap <strong>Dietary list</strong> next to <strong>Print</strong> (on the menus list or at
              the top of a menu) for a simple sheet listing every dish in one column and its allergen
              and dietary badges, as icons only, in the second, grouped by section. A key under the
              list says what each icon used on it means, and what the asterisk means if a dish has an
              allergen that can be removed. It prints portrait on the menu's paper size and runs onto
              more pages when the menu is long. Sections set to hide everywhere are left out.
            </P>
            <P>
              To print only some dishes, tap <strong>Choose dishes</strong> at the top of the list,
              untick the dishes you don't want (tap a row or its tick box), then tap{' '}
              <strong>Done</strong>. <strong>Tick all</strong> and <strong>Untick all</strong> help with
              long menus. The top bar says how many dishes are in the list, a section with no ticked
              dishes is left out, and the key only shows icons that are used. Your choice is
              remembered on that device, and a dish added to the menu later is included until you
              untick it.
            </P>
            <H3>Designing the print yourself</H3>
            <P>
              For full control, open a menu and tap <strong>Design print</strong> (save the menu
              first). Tap <strong>Start designing</strong>. Each page is a grid, and you place
              everything on it yourself: the menu header, section titles, whole sections, single
              dishes, text, images, lines, the footer notes, the allergen key and page numbers.
            </P>
            <DataTable
              head={['To', 'Do this']}
              rows={[
                ['Add something', 'Drag it from the list on the left onto a page, or tap + to add it to the page marked "adding here".'],
                ['Move it', 'Tap it to select it (blue outline), then drag (a mouse can drag straight away, photos included). It snaps to the grid, and can be dragged onto another page.'],
                ['Add a photo from your computer', 'Drag it onto a page: onto an image block to replace its picture, anywhere else to add an image block there. It goes into Media too.'],
                ['Resize it', 'Drag the blue corner of the selected block, or use the Across / Down / Width / Height buttons on the right.'],
                ['Make it the right height', 'Tap "Fit height to content". New blocks size themselves when you drop them.'],
                ['Place a whole section', 'Use "Title and dishes". Its dishes flow inside the block (choose 1 to 4 columns). A dish you place on its own is left out of it, so you can pull a dish out and put it somewhere else.'],
                ['Repeat a section heading', 'Add the section\'s "Section title" again on the next page, and type something like "(continued)" in "Text after the title".'],
                ['Repeat on every page', 'Select the block and tick "Show on every page", e.g. a header, footer or page number. Tick "Hide repeated blocks on this page" on a page (a cover, say) to leave them off it.'],
                ['Change paper, margins or the grid', 'Page setup at the top: A4 or A3, landscape or portrait, margins, 6 / 12 / 24 columns, row height and the text size for the whole menu.'],
                ['Design a folded menu', 'Page setup > Folded sheet: "Fold left | right" or "Fold top / bottom", and the gap at the fold (for example 10 mm). The page splits into two halves with a striped FOLD strip between them. Blocks snap to either side of the gap and new blocks are kept off it; a block can still stretch across both halves. Tick "Print a fold line" for a faint dashed line to fold along.'],
                ['Put variant options side by side', 'Page setup has "Variant options per row" (1, 2 or 3) for every dish. A dish block, or a section showing its dishes, can pick its own number or use the default.'],
                ['Change the fonts', 'Page setup > Fonts: one font for headings and prices, one for text, one for the handwritten lines (taglines, handwritten text). Any font from the website builder can be used. "Use website fonts" copies the headings and text fonts from the Brand & theme page; "Standard fonts" goes back to the usual three.'],
                ['Change the colours', 'Page setup > Colours: the text, the prices, lines and handwriting (the menu\'s own colour unless you pick one), and the descriptions. The paper stays cream. Make a theme fills in the fonts and colours from a picture and a few words (see Make a theme from a picture); Standard colours goes back.'],
                ['Choose which footer notes print', 'Select the Footer notes block and untick "Show all notes", then tick the notes you want in that spot. Put a second Footer notes block elsewhere to print the others there. With "Show all notes" ticked, notes you add to the menu later appear automatically; with your own pick, they don\'t until you tick them.'],
                ['Make another design for the same menu', 'Use the Designs bar under the top bar. "Copy" starts a new design from the one open (handy for an A3 poster and an A5 table card of the same menu); "New design" starts a blank one. Name it in the panel on the right (with nothing selected) and tap Save. Tap a design\'s name to open it; save or undo your changes first.'],
                ['Choose which design prints', 'Open the design and tap "Use this design for printing" in the panel on the right. The design used for printing has a Printing badge. "Use the automatic layout instead" goes back to the automatic layout.'],
                ['Give one block its own font', 'Select it and pick a font under Look > Font. Everything in that block uses it. "Use the menu fonts again" undoes it.'],
              ]}
            />
            <P>
              The list on the left shows every dish that is not on the page yet, so a dish you add to
              the menu later shows up there. The design stays linked to the menu: names, prices,
              descriptions and allergens always come from the menu, so editing a price there
              changes the print too. A red line along the bottom of a block means its text is cut
              off; an orange outline means two blocks overlap.
            </P>
            <P>
              A section set to <strong>Hide everywhere</strong> doesn't print and isn't listed on
              the left; a block you had already placed for it stays on the page with a note, and
              prints nothing.
            </P>
            <InfoBox type="info">
              Nothing changes until you tap <strong>Save</strong>. Your first saved design is used
              for printing: the menu's Print button and the <strong>Open as printable PDF</strong>{' '}
              link on your website both use it. Later designs are saved without changing what
              prints until you tap <strong>Use this design for printing</strong>. To delete a
              design, open it and use <strong>Delete this design</strong> at the bottom of the
              panel on the right; if it was the one used for printing, printing goes back to the
              automatic layout. The Print layout settings above only apply to the automatic layout.
            </InfoBox>
            <H3>Deliveroo menu file</H3>
            <P>
              <strong>Menus &rarr; Deliveroo menu</strong> updates the menu file Deliveroo gives you
              (the bulk-management CSV) from your menus here, so prices, VAT, descriptions,
              allergens and calories on Deliveroo match what you sell, without typing them into the
              spreadsheet by hand. Pick the venue at the top; each venue has its own settings and
              matches, because each Deliveroo site has its own file.
            </P>
            <DataTable
              head={['Step', 'What to do']}
              rows={[
                ['1. Get the file', 'In the Deliveroo Hub go to Menu, Menu Manager, Bulk management and download the menu file (a CSV). Keep that file: Deliveroo can\'t undo an upload.'],
                ['2. Open it here', 'Tap the box under Deliveroo file and choose the CSV, or drop it on the box. A copy you saved from Excel (.xlsx) works too. The file stays in this browser tab only.'],
                ['3. Check the settings', 'Under How the file is filled: which menus to match against, the price rule (menu price plus a %, rounded up or to the nearest 1p, 5p, 10p, 50p or £1), which columns to fill, and whether May contain and Can be removed allergens are listed. Tap Save settings.'],
                ['4. Review the items', 'Each Deliveroo item shows the dish it is filled from, its price now and after, and the other columns that change. Fix what needs it (see below).'],
                ['5. Save matches', 'Stores each item\'s dish, skips and your own values, so next time the same file (or a newer one) opens matched.'],
                ['6. Download', 'CSV for Deliveroo is the file to upload, in the Hub under Menu, Menu Manager, Bulk management. Excel, to edit gives the same rows as a spreadsheet you can change and open here again.'],
              ]}
            />
            <P>
              Each item is matched to a dish by name. The badge says how: <strong>Auto match</strong>{' '}
              (the names are the same, apart from things like &ldquo;Can&rdquo; or &ldquo;330ml&rdquo;
              or a name in brackets), <strong>Matched</strong> (you chose it, or it was saved),{' '}
              <strong>Check</strong> (close names; tap <strong>Use</strong> under it to take the closest,
              or <strong>Choose dish</strong> to pick another), <strong>Not matched</strong>,{' '}
              <strong>Left as is</strong> (you chose to leave it alone) and <strong>Dish gone</strong>{' '}
              (the saved dish was deleted from the menu). An item with no dish is left exactly as
              Deliveroo has it. Filter the list with <strong>Changes</strong>, <strong>To check</strong>{' '}
              and <strong>Problems</strong>, or search by name.
            </P>
            <DataTable
              head={['Column', 'Filled with']}
              rows={[
                ['Delivery price', 'The dish\'s menu price plus your %, rounded as set. A dish priced only by its options (e.g. Chicken, Prawn, Tofu) uses its cheapest option, and the review says which.'],
                ['VAT rate', 'The dish\'s tax for the order type picked under How the file is filled (Delivery to start with), and the revenue stream if you pick one: see Tax, Order Types & Streams. Deliveroo takes 0, 5, 12.5 or 20.'],
                ['Description', 'The dish description.'],
                ['Allergens', 'The dish\'s allergens, sent as Deliveroo\'s codes (see Allergen and dietary codes).'],
                ['Calories', 'The dish\'s calories (kcal).'],
                ['Name, In-store price, Dietary, Energy (kcal)', 'Off to start with; switch them on under Columns filled from the menu.'],
              ]}
            />
            <P>
              An empty value on your menu never clears what Deliveroo has: a dish with no description
              leaves Deliveroo&apos;s description in place. Columns this page doesn&apos;t fill (PLU,
              barcodes, nutrition, max quantity and so on) are written back exactly as they were, and
              the item ids, order and columns stay the same.
            </P>
            <P>
              Tap an item&apos;s name or its changes to open it. For each column you can use{' '}
              <strong>Our menu</strong>, keep <strong>Deliveroo&apos;s</strong> value, or{' '}
              <strong>Type it</strong>. <strong>Change prices shown</strong> raises or lowers the
              delivery price of every item in the list by a % (rounded) or sets one price for them
              all, for example search &ldquo;can&rdquo; and set the cans to £2.50. Typed values stay
              until you undo them, even if the menu changes.
            </P>
            <InfoBox type="warn">
              Deliveroo has its own allergen codes, and lists nuts one by one (nuts_cashew,
              nuts_almond and so on). Open <strong>Allergen and dietary codes</strong> to see what each
              of your tags is sent as. A dish with an allergen that has no code is a problem, and the
              CSV can&apos;t be downloaded until you give the allergen a code or keep Deliveroo&apos;s
              value for that dish: otherwise Deliveroo would show the dish without that allergen.
              Check a few dishes on Deliveroo after uploading, and keep your own allergen
              information up to date.
            </InfoBox>
            <P>
              Other problems are shown in red on the item (Deliveroo would refuse the file) or amber
              (worth a look, for example a price that changes by more than 30%). If Excel has turned
              an item id into a number like 1.23E+15, use the file Deliveroo gave you instead: the id
              can&apos;t be recovered.
            </P>
          </section>

          {/* ── TAX, ORDER TYPES & REVENUE STREAMS ───────────── */}
          <section id="tax" data-help="">
            <H2>Tax, Order Types &amp; Revenue Streams</H2>
            <P>
              Three separate things, each in one place:
            </P>
            <DataTable
              head={['What', 'Where', 'What it does']}
              rows={[
                ['Tax rates', 'Menus → Tax rates', 'Your list of rates (Standard 20%, Zero 0%, Reduced 5%...). One is the default. A location can charge another % for a rate.'],
                ['Order types', 'Store tech → Order types', 'How an order is served: Eat in, Take out, Delivery, Collection and any you add (Drive thru, Staff meal...). They decide how tickets behave and can change a dish\'s tax.'],
                ['Revenue streams', 'Store tech → Revenue streams', 'Groups of tills for reporting sales by place or device (Restaurant, Bar, Kiosk). A stream picks which order types its tills offer and what each asks for. It doesn\'t decide tax.'],
              ]}
            />

            <H3>Tax rates</H3>
            <P>
              <strong>Add rate</strong>: a name and a %, and optionally a different % at a location. The
              rate marked <strong>Default</strong> is used for any dish that has no rate set anywhere;
              <strong> Make default</strong> moves it. Drag rates into the order they appear in lists.
              Removing a rate takes it off the lists; you can't remove the default, or a rate a menu
              still uses (the message names the menus). Sales already made keep the rate they had.
            </P>

            <H3>Setting a dish&apos;s tax</H3>
            <P>
              The <strong>Tax</strong> box is in the menu&apos;s Settings, each section&apos;s panel and each
              dish&apos;s panel. Pick a <strong>Rate</strong>, or leave it as the default wording (the same as
              what it sits under). Then add <strong>exceptions</strong> for when a different rate applies:
              tap the order types it is for (none picked = any), optionally a location and the revenue
              streams there, then the rate to charge.
            </P>
            <DataTable
              head={['Which wins', '']}
              rows={[
                ['Dish, section, menu', 'A dish\'s own setting wins over its section\'s, a section\'s over its menu\'s, and the menu\'s over the default rate. A setting with a rate or an exception that matches the sale counts; a blank one passes to the level above.'],
                ['Within one setting', 'The exception that names the sale most closely wins: one for a revenue stream beats one for an order type, which beats one for a location only. One naming a stream and a type beats one naming just the stream. No matching exception: the setting\'s own rate.'],
              ]}
            />
            <P>
              Example: the <em>Sandwiches</em> section has rate Standard and an exception
              <em> Take out, Delivery, Collection → Zero</em>, so cold sandwiches are 20% eaten in and 0% to
              take away. A hot toastie in that section gets its own rate, Standard, and is 20% whichever
              way it is sold, because the dish&apos;s setting wins over the section&apos;s exceptions.
            </P>
            <InfoBox type="info">
              Two exceptions that could both apply to the same sale at different rates are flagged in red
              and Save stays off until one changes. Under each Tax box a line shows what it gives for every
              order type. <strong>Menus → Tax rates → Check</strong> shows every dish&apos;s rate for each
              order type at a location and revenue stream, exactly as the till, online ordering and the
              Deliveroo file work it out.
            </InfoBox>
            <P>
              Tax settings are part of the menu: like a price change, a new rate reaches the till, online
              ordering, menu screens and the Deliveroo file when you publish the menu. Changing the % of a
              rate on the Tax rates page applies straight away.
            </P>

            <H3>Order types</H3>
            <P>
              <strong>Store tech → Order types</strong> lists them for every location: add, rename, give
              a colour (used on the till and kitchen tickets) and drag into order. Removing one takes it
              off every till, stream and filter (<strong>Put back</strong> brings it back); checks and
              orders already taken keep it. Order types are used by the till&apos;s buttons, tax exceptions,
              kitchen flow links, the kitchen screens&apos; tabs, tickets and receipts, Till reports, online
              ordering (Ordering setup picks the type collection orders count as) and the Deliveroo file
              (its settings pick the type, Delivery to start with).
            </P>

            <H3>Revenue streams</H3>
            <P>
              <strong>Store tech → Revenue streams</strong>, per location: a name, which order types its
              tills offer and, for each one, <strong>Name</strong> and <strong>Tent</strong>: No, Ask
              (can be skipped) or Must (the check can&apos;t go to the kitchen or be paid without it).
              <strong> New checks start as</strong> picks the type a new check starts with. Each stream
              also picks its menus, an optional service charge and a colour. A till belongs to one (Tills
              tab) and a floor area can name one; staff can move a check to another on the till (More →
              Revenue stream). Till reports show sales by stream and by order type.
            </P>

            <H3>On the till</H3>
            <ul className="list-disc ml-5 space-y-2 text-sm text-muted-foreground mb-4">
              <li><strong>Counter</strong>: tap the order type, then type the customer name or tent number if asked, then tap dishes.</li>
              <li><strong>A check</strong>: More → <strong>Order type</strong> changes it (items already on the check take the new type&apos;s tax) and the name or tent number; More → <strong>Tent number</strong> sets just the tent.</li>
              <li>A detail the type must have and the check is missing is asked for at <strong>Send</strong> and <strong>Pay</strong>.</li>
              <li>The order type, customer name and tent number print on kitchen tickets and receipts and show on the kitchen screens.</li>
            </ul>
          </section>

          {/* ── MENU SCREENS ──────────────────────────────── */}
          <section id="screens" data-help="">
            <H2>Menu Screens</H2>
            <P>
              Show your menus on screens in the restaurant (digital menu boards). You design each
              board on <strong>Screens</strong> (Website in the menu), and every screen shows a board,
              or a playlist of boards that take turns. Prices come from your <strong>published</strong>{' '}
              menus, so a price change appears on every screen when you publish the menu (now or at the
              time you scheduled). Dishes marked sold out (on the till or the Online orders board) show
              as sold out within seconds.
            </P>

            <H3>What you need</H3>
            <P>
              Any screen that can run Chrome: an Android TV box or stick, a smart TV with Chrome, an
              Android tablet, or a PC. Fully Kiosk Browser (Android) works too. The screen needs the
              internet to get started and for changes; if the internet drops, it keeps showing its
              boards, photos, videos and fonts, and catches up as soon as it is back online.
            </P>

            <H3>Adding a screen</H3>
            <ol className="list-decimal ml-5 space-y-2 text-sm text-muted-foreground mb-4">
              <li>On the screen, open the screens address shown on <strong>Screens → Add a screen</strong> (screens.your-domain) in Chrome.</li>
              <li>In Chrome&apos;s menu choose <strong>Install app</strong> (or <strong>Add to Home screen</strong>): it then opens full screen with no address bar. In Fully Kiosk, set the address as the Start URL.</li>
              <li>The screen shows a six-letter code and a QR code (both change every 15 minutes until they&apos;re used).</li>
              <li>In the admin press <strong>Add screen</strong>, type the code, give the screen a name (e.g. Counter left), pick the location and what it shows. Or scan the QR code with your phone: it opens the installer app (see Installer app) to do the same there. The screen shows it within a few seconds.</li>
            </ol>
            <P>
              Each screen gets an ID (S1, S2 ...). <strong>Identify</strong> shows the name and ID on the
              screen for 20 seconds, so you can tell which is which. <strong>Edit</strong> changes what it
              shows, its size, and <strong>Mounted</strong>: turn the picture for a screen hung on its side
              (for TVs that can&apos;t turn it themselves). <strong>New device for this screen</strong>{' '}
              moves the screen to a new box or TV by its code; the old one stops. Removing a screen sends
              it back to showing a code.
            </P>
            <P>
              On the screen itself, five quick taps (or five presses of OK on a TV remote) open its own
              settings: its name and ID, the venue, what it is showing, whether it is online, Reload, and{' '}
              <strong>Disconnect this screen</strong> (asked twice). A disconnected screen shows a new code and
              is listed here as not paired, with its name and boards kept: <strong>New device for this
              screen</strong> pairs it again.
            </P>
            <P>
              The list shows which screens are online (a green dot), what each is showing now, and
              when an offline screen was last seen.
            </P>
            <P>
              <strong>With several locations</strong>: boards and playlists are shared by every location
              (one design for all; each screen shows its own location&apos;s sold out dishes and order
              ready board), while screens and walls belong to a location. The <strong>Location</strong>{' '}
              picker beside the tabs (on Screens and Walls) shows one location&apos;s screens and walls, or
              every location&apos;s; it is remembered on this device, and a new screen or wall starts at the
              location picked.
            </P>

            <H3>Designing a board</H3>
            <P>
              <strong>Boards → New board</strong>: give it a name and the screen&apos;s size (Full HD
              landscape or portrait, 4K, HD, or your own). The designer opens. Add blocks from the left
              (tap +, or drag onto the board), drag them to move (press anywhere on a block, photos
              included), drag the corner to resize; they snap to a grid (hold Alt to place freely,
              arrow keys nudge). On a tablet, tap a block first, then drag it. The panel on the right
              has the selected block&apos;s options; with nothing selected it has the board&apos;s
              background, colours, fonts and price style. Save when you&apos;re done.
            </P>
            <P>
              <strong>Grid</strong>: the grid button at the top (next to the zoom buttons) shows lines
              over the board where blocks snap, with every fifth line darker. Zoomed out, the lines
              are drawn every few snap steps so they don&apos;t run together. The snap step is in the
              board panel under Snap. Your choice is remembered on this device.
            </P>
            <P>
              <strong>Colours</strong>: every colour shows your brand&apos;s colours first
              (the Brand &amp; theme page): tap one to use it. To use any other colour, tap the
              square below them for your device&apos;s colour picker, or type a code like
              #f5b301. A ticked swatch means that theme colour is in use; a ring round the square
              means a custom colour.
            </P>
            <P>
              <strong>Theme maker</strong> (board panel): the background, colours and fonts from a
              picture and a few words. A light theme gives the board a deep background with light words,
              which reads best from across the room. See Website Builder → Make a theme from a picture.
            </P>
            <P>
              <strong>Photos and videos from your computer</strong>: drag them straight onto the board.
              Dropped on a picture (or video) block, they replace its picture; dropped anywhere else,
              they become a new block there, the photo&apos;s own shape. They go into Media too, and the
              same file dropped twice is only kept once.
            </P>
            <DataTable
              head={['Block', 'What it shows']}
              rows={[
                ['Menu list', 'A section of a menu (or dishes you pick), with prices, descriptions, options (Small £3 · Large £4), allergen tags and calories. 1 to 4 columns, sizes and colours, dotted line to the price. Menu sections in the left column add one in a tap.'],
                ['Featured dish', 'One dish, large, with its photo from the menu, description and price.'],
                ['Price', 'Just a dish\'s price (or one option\'s), to put on a photo or a designed background, so the price still updates.'],
                ['Heading / Text', 'Your own words, any font and size.'],
                ['Image', 'A photo, logo or picture from Media.'],
                ['Video', 'A video from Media (MP4 or WebM, up to 150 MB), playing on a loop, sound off unless you tick With sound. Each screen keeps a copy, so it plays without the internet. Use MP4 (H.264): it plays on every screen.'],
                ['Scrolling text', 'A line of text moving across the board, like a news ticker. Set its speed, gap and direction.'],
                ['Box or line', 'A coloured panel behind other blocks, or a line (make it thin).'],
                ['Clock', 'The venue\'s time, with the date if you like.'],
                ['Allergen key', 'What the tags on this board\'s dishes mean, from your allergen notice.'],
              ]}
            />
            <P>
              The designer shows the live prices. <strong>Draft prices</strong> shows the menus as saved
              but not yet published, and <strong>Sold out at</strong> shows a venue&apos;s sold out
              dishes, so you can check how the board will look. A menu that has never been published
              shows nothing on a board until you publish it. Sections set to <strong>Hide
              everywhere</strong> never show.
            </P>
            <P>
              Sold out dishes are crossed out with <strong>Sold out</strong> (wording in the board
              settings), or left out if you pick <strong>Leave out</strong> on the block.
            </P>
            <P>
              <strong>Combos on a board.</strong> A Menu list or Featured dish block has{' '}
              <strong>Combos</strong>: <strong>Like the menu</strong> shows a combo as its name,
              description and price (&ldquo;from £11.00&rdquo; when choices can cost more);{' '}
              <strong>How to order (steps)</strong> also shows its steps numbered 1, 2, 3, each with
              its rule (Choose 1, Optional, up to 2), its choices and their extra charges, and
              &ldquo;With Fries&rdquo; on a step that only shows with an earlier pick, like a
              how-to-order poster.
            </P>

            <H3>Animation</H3>
            <P>
              Any block can <strong>come on</strong> with a movement (fade, rise up, drop down, from the
              left or right, zoom, pop, wipe), taking the time you set and starting after a delay, so
              blocks can arrive one after another. A block can also keep moving <strong>while on</strong>{' '}
              (pulse, float, swing, slow zoom, blink). Press <strong>Play</strong> at the top of the
              designer to watch the board as the screens will show it (videos play and scrolling text
              moves too); press Stop to place blocks where they end up. In the board settings,{' '}
              <strong>Play the animations again every</strong> replays the entrances, for a board that
              stays on for a long time.
            </P>

            <H3>Playlists and times of day</H3>
            <P>
              <strong>Playlists</strong>: a list of boards that take turns, each for the seconds you
              set (drag to reorder). <strong>Set times and dates</strong> on a board to show it only
              then, for example a breakfast board 07:00 to 11:00 and a lunch board 11:00 to 15:00. A time
              ends just before its end time, so the lunch board takes over at exactly 11:00. Boards with
              no times show all the time. When nothing is on, the screen goes black. Times are the
              venue&apos;s time. Save the playlist, then pick it for a screen.
            </P>
            <P>
              Each board <strong>comes on with</strong> a transition (cut, fade, slide in from either
              side, slide up or down, zoom, wipe) at the speed you pick. A board with a video offers{' '}
              <strong>Video length</strong> to show it for exactly as long as its video. The{' '}
              <strong>Preview</strong> under the list plays the boards with their transitions (up to 5
              seconds each, so you can check quickly). Screens with the same playlist change boards at
              the same moment.
            </P>

            <H3>Walls: several screens, one picture</H3>
            <P>
              Screens side by side (or stacked) can show one board between them: one picture across all
              of them, changing boards, playing videos and scrolling text together.
            </P>
            <ol className="list-decimal ml-5 space-y-2 text-sm text-muted-foreground mb-4">
              <li>Add each screen as usual (Screens tab).</li>
              <li><strong>Walls → New wall</strong>: name it and pick how many screens across and down.</li>
              <li>Under <strong>Which screen goes where</strong>, pick each screen as you look at the wall (left, right, top left ...).</li>
              <li><strong>Gap between screens</strong>: how much of the picture hides behind the frames where two screens meet, so lines and text stay straight across (0 for frameless screens).</li>
              <li>Press <strong>Make a board this size</strong> (the wall&apos;s size: two Full HD screens side by side make 3840 x 1080, plus the gap), then <strong>Design</strong> it. The designer shows dashed lines where the screens meet, so nothing important sits on a join.</li>
              <li>Pick the board (or a playlist of wall-sized boards) under <strong>Shows</strong> and save the wall. The preview shows which part each screen gets.</li>
            </ol>
            <P>
              A screen on a wall shows the wall&apos;s board instead of its own; take it off the wall
              (pick No screen) to give it its own board again. The screens keep in step on their own
              (each sets its clock from Macaroonie), so they don&apos;t need to see each other.
            </P>


            <H3>Sold out from the till</H3>
            <P>
              On the till, <strong>hold a dish down</strong> (or tap one that&apos;s sold out) and choose{' '}
              <strong>Sold out for today</strong> (back on at midnight), <strong>Sold out until I put it
              back</strong>, or <strong>Back on sale</strong>. It changes the till, online ordering, the
              Online orders board and the screens at once. Till roles need <strong>Mark dishes sold
              out</strong> (Supervisor and Manager have it), or a manager types their PIN. It needs the
              till to be online. Tills and kiosks also check what is sold out every 30 seconds (or as set in Store tech, Device updates), so one
              that missed the change catches up within half a minute.
            </P>
            <InfoBox type="tip">
              Changing a board or playlist reaches the screens within seconds. If a screen seems stuck,
              <strong> Reload</strong> it from the list, or check it&apos;s online.
            </InfoBox>
          </section>

          {/* ── ONLINE ORDERS ─────────────────────────────── */}
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
              Your ordering page is in <strong>Website → Pages &amp; modals → Order online</strong>.
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
                ['Menus', "Which of your menus guests can order from. Dishes you switch off for ordering, or dishes without a price, are left out."],
                ['Menu times and dates', "Under each chosen menu, tap Set times and dates. Times of day: pick the days and the hours it is served (for example lunch Mon to Fri 11:00 to 15:00); add more rows for other days or hours. Dates: From and Until, to schedule a menu change (old menu Until 31 May, new menu From 1 June). Menus with times or dates can't overlap each other, and Save stays off with a message until they don't. A menu with neither, such as drinks, is always available alongside the others. Make it always available clears the schedule."],
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
              The menu&apos;s own option settings (in the menu&apos;s details) apply to online ordering
              and the self-order kiosks too, the same as on your website and printed menu (the till
              shows staff every option). <strong>Don&apos;t show the variant
              option at all if it isn&apos;t priced</strong> leaves options with no price (or £0) out, so
              guests can&apos;t pick them. <strong>Don&apos;t show a price on zero-priced variants</strong>{' '}
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

          {/* ── LOYALTY ──────────────────────────────────── */}
          <section id="loyalty" data-help="">
            <H2>Loyalty</H2>
            <P>
              Loyalty gives your guests points, stamp cards and rewards. They collect and spend them at
              every one of your locations that takes part: on the tills, the self-order kiosks and
              online ordering. Each guest has a card in a loyalty web app on your website, and can add it
              to Apple Wallet or Google Wallet. Open <strong>Loyalty</strong> in the main menu (under
              Customers). It has six tabs: Overview, Programme, Rewards, Stamp cards, Members and Wallet.
            </P>
            <InfoBox type="info">
              Loyalty starts switched off. Nothing reaches guests until you turn on{' '}
              <strong>Loyalty is on</strong> in the Programme tab and press Save.
            </InfoBox>

            <H3>Switching loyalty on</H3>
            <P>
              In <strong>Programme</strong>, give the programme the <strong>Name guests see</strong>{' '}
              (for example Ware Club) and turn on <strong>Loyalty is on</strong>. The{' '}
              <strong>Features</strong> card switches each part on or off on its own:
            </P>
            <DataTable
              head={['Feature', 'What it does']}
              rows={[
                ['Points', 'Guests earn points on what they spend.'],
                ['Stamp cards', 'Buy a set number of dishes, or visit a set number of times, to fill a card.'],
                ['Spend points on rewards', 'Guests swap points for rewards from your list.'],
                ['Apple Wallet / Google Wallet', 'The card in the guest\'s phone wallet, with its balance kept up to date.'],
                ['Loyalty web app', 'Guests join, sign in and see their card at /loyalty on your website.'],
                ['Macaroonie loyalty', 'Taking part in a Macaroonie-wide programme. Not available yet.'],
              ]}
            />
            <P>
              Every card on the Programme tab saves together with one <strong>Save</strong> at the
              bottom. <strong>Discard</strong> puts back what was saved.
            </P>

            <H3>Points and how they are earned</H3>
            <P>
              In the <strong>Points</strong> card choose <strong>What they&apos;re called</strong>{' '}
              (points, beans, stars), <strong>Points per pound</strong>, the{' '}
              <strong>Smallest spend that earns</strong>, an optional <strong>Welcome gift</strong>{' '}
              of points for joining, and whether <strong>Points run out</strong> after a number of
              months with nothing earned or spent (then the whole balance goes).
            </P>
            <P>
              Points are counted on what the guest paid: after discounts, without tips or service
              charge, and less any refund. A till order earns when its check is closed. An online order
              earns once it is paid, or collected if paid at the counter. A refund later takes back the
              points it covered, and an online order that is cancelled gives back any reward spent on it.
            </P>

            <H3>Where loyalty works</H3>
            <P>
              The <strong>Where it works</strong> card has a row for Tills, Self-order kiosks and Online
              ordering, each with <strong>Earn</strong> and <strong>Spend rewards</strong>. Keep{' '}
              <strong>Every venue takes part</strong> ticked, or untick it and pick the venues. A venue
              left out doesn&apos;t offer loyalty on its tills, kiosks or online ordering, but its
              guests&apos; cards still work at the others.
            </P>

            <H3>Rewards</H3>
            <P>
              In <strong>Rewards</strong>, <strong>Add a reward</strong>: <strong>Money off</strong>,{' '}
              <strong>Percent off</strong> or <strong>A free dish</strong> (pick which dishes or
              sections can be free). Give it a <strong>Points price</strong> to offer it for points, or
              leave it blank for a reward only stamp cards or staff give. You can also set the{' '}
              <strong>Smallest order it can go on</strong>, the most it <strong>Takes off</strong>,{' '}
              <strong>Where it can be used</strong> (tills, kiosks, online), and how long{' '}
              <strong>A held reward lasts</strong>. Drag the grips to set the order guests see. A reward
              that has already been used can&apos;t be deleted: switch it off instead.
            </P>

            <H3>Stamp cards</H3>
            <P>
              In <strong>Stamp cards</strong>, add a card. <strong>Stamps come from</strong> either a
              stamp for each dish (pick the dishes or sections that earn one) or a stamp for each
              visit. Set the <strong>Stamps to fill it</strong>, the{' '}
              <strong>Most stamps from one order</strong> if you want a cap, and the reward{' '}
              <strong>A full card gives</strong>. A full card gives its reward to the guest to hold and
              starts again; stamps beyond a full card carry on to the next one. Stamp cards only count
              while the Stamp cards feature is on.
            </P>

            <H3>How guests join and sign in</H3>
            <P>
              Guests use their card on your website&apos;s <strong>Loyalty</strong> page,{' '}
              <Mono>/loyalty</Mono>, and on the loyalty web app at{' '}
              <Mono>loyalty.macaroonie.com/your-web-address</Mono>. Set up your website address first
              (Website, Domain). The Overview tab shows both links. Guests type their email and get a
              six-digit code that works for 15 minutes; there is no password. A new guest then gives a
              name (and a phone number, if you ask for one in <strong>Joining</strong>) and must agree
              to the words in <strong>What guests agree to</strong>. The newsletter box is optional and
              never ticked for them.
            </P>
            <P>
              Their card shows a QR code and member number, their points, stamp cards, rewards and
              history, and the Add to Apple Wallet / Add to Google Wallet buttons. Under{' '}
              <strong>Settings</strong> they can change their details and newsletter choice, download
              their data, get a new card code, or leave and delete their account. Guests can add the web
              app to their phone&apos;s home screen.
            </P>
            <P>
              Sign-in codes are emailed through your email settings (Booking emails, Settings), from the
              location used by your website&apos;s booking widget, or else one with email settings.
            </P>

            <H3>Joining at the till, or added by staff</H3>
            <P>
              On the till, open a check&apos;s actions and tap the programme&apos;s name, then{' '}
              <strong>Not a member yet?</strong>. Type their name and email (phone optional), read the
              words on screen to the guest, tick <strong>The guest agrees</strong> and tap{' '}
              <strong>Join and add to the check</strong>. Tick the newsletter only if they ask for it.
              They get an email with their card. Staff with access to Members can also add someone in
              the Members tab.
            </P>

            <H3>Loyalty on the till</H3>
            <P>
              On a check, open its actions and tap the programme&apos;s name. Scan the QR code on the
              guest&apos;s phone (a scanner or the camera), or search by email, phone, name or member
              number. An email has to be typed in full. Tap the member to put them on the check: their
              name shows in the check&apos;s header. Under <strong>Their rewards</strong>,{' '}
              <strong>Use</strong> puts a reward&apos;s discount on the check and{' '}
              <strong>Take off</strong> puts it back. Take their rewards off before removing the member.
              Points and stamps arrive when the check is closed.
            </P>

            <H3>Loyalty on the kiosks</H3>
            <P>
              On the kiosk&apos;s order page, guests tap <strong>Loyalty card</strong> and hold the QR
              code on their phone under the scanner, or use the camera. A kiosk is a public screen, so it
              finds members by their card only and shows just their first name. They can use rewards on
              the order, and the kiosk says what the order earns. A reward that no longer fits the order
              (a free dish taken out of the basket) is left off and says why. Guests who aren&apos;t
              members can scan a code on the screen to join on their phone. Starting again takes the
              card off.
            </P>

            <H3>Loyalty in online ordering</H3>
            <P>
              At checkout, guests first choose <strong>How would you like to order?</strong>:{' '}
              <strong>Sign in or join</strong> your programme (it says what the order earns) or{' '}
              <strong>Continue as a guest</strong>. The rest of checkout shows once they have chosen.
              Members sign in with the same emailed code as the web app, or join there and then; their
              name, email and phone fill in Your details. Signed in, they see their points and what the
              order earns, and can tap <strong>Use</strong> on their rewards. A guest who chose to order as
              a guest isn&apos;t asked again on that visit and can still tap{' '}
              <strong>Sign in or join instead</strong>. A guest already signed in on your website or the
              web app skips the question. <strong>Not you? Sign out</strong> clears the details the card
              filled in and asks again.
            </P>

            <H3>The Loyalty page on your website</H3>
            <P>
              Website, <strong>Pages &amp; modals</strong> always lists <strong>Loyalty</strong>, your
              loyalty page at <Mono>/loyalty</Mono> (marked <em>Loyalty</em>), the address on receipts,
              kiosks and wallet cards. Design it like any other page: it holds the{' '}
              <strong>Loyalty card</strong> block, and you can add a heading, text or photos around it.
              You can rename it, but it always stays at <Mono>/loyalty</Mono>, stays published and
              can&apos;t be deleted. It shows only while loyalty and its web app are switched on; at other
              times the address says loyalty isn&apos;t open.
            </P>

            <H3>The Loyalty card block</H3>
            <P>
              The <strong>Loyalty card</strong> block is the guest&apos;s own card on your website.
              Signed out, it shows the programme&apos;s name, how points and stamps are earned and the
              email sign-in or join. Signed in, it shows their QR card with their points and member
              number, stamp cards, rewards, wallet buttons, and the History and Settings tabs. It is on
              the Loyalty page and can go on any other page too. In its settings you can set a heading
              (blank: the programme&apos;s name, shown until they sign in; a heading of your own shows on
              the card too), the words above the sign-in, which parts show (How it works, Stamp cards,
              Rewards, Wallet buttons, History tab, Settings tab), the width (Narrow, Boxed, Wide), the
              button and box colours, and the card&apos;s colours (blank: the ones set in Programme). In
              the builder, tap <strong>Signed out</strong> or <strong>Signed in</strong> above the
              block to see a sample of each. Signing in on one block (or at checkout) signs the guest in
              on every block on that browser.
            </P>

            <H3>The Loyalty website block</H3>
            <P>
              In the page builder, add the <strong>Loyalty</strong> block to any page. It shows the
              programme&apos;s name, how points and stamps are earned, the three cheapest rewards and a
              button to <Mono>/loyalty</Mono>. In its settings you can change the heading, text and
              button words, hide the rewards, and pick Banner or Card and colours. The block hides itself
              while loyalty or the web app is switched off.
            </P>

            <H3>Wallet cards</H3>
            <P>
              Cards use Macaroonie&apos;s Apple Wallet and Google Wallet accounts and your brand&apos;s
              colours (change them in Programme, <strong>The card&apos;s colours</strong>). An owner or
              admin can use your own accounts instead in the <strong>Wallet</strong> tab: for Apple your
              Pass Type ID, Team ID, pass certificate, private key and Apple&apos;s WWDR certificate;
              for Google your issuer ID and a service account key file. A wallet card&apos;s balance
              updates within about a minute of a change.
            </P>

            <H3>Members</H3>
            <P>
              The <strong>Members</strong> tab lists your members, searchable by name, email, phone or
              member number, with filters for status, newsletter and tag. <strong>CSV</strong> downloads
              the list. Open a member to:
            </P>
            <DataTable
              head={['Action', 'What happens']}
              rows={[
                ['Profile', 'Change name, email, phone, the newsletter (only the guest can tick it), staff-only notes and tags.'],
                ['Points', 'Add or take away points, with a reason. Shows in their history.'],
                ['Give a reward', 'Gives them a reward to hold, with a note. A given reward can be taken back while unused.'],
                ['Put it back', 'For a reward taken out on a till or kiosk but never used: the points or reward return.'],
                ['New card code', 'The old QR code stops working. Use it when someone else has a photo of theirs.'],
                ['Close membership', 'Their card stops working on tills and kiosks and they are signed out of the web app. Open again undoes it.'],
              ]}
            />
            <P>
              Two permissions in Modules &amp; Roles control this: <strong>Loyalty</strong> (programme,
              rewards, stamp cards, wallet) and <strong>Loyalty members</strong> (the members list, which
              holds personal data).
            </P>

            <H3>Members&apos; data and GDPR</H3>
            <P>
              <strong>Download their data</strong> gives a member&apos;s details and full history as a
              file. <strong>Erase this member</strong> (owner or admin, type ERASE) clears their name,
              email, phone, notes, tags and consents, stops their card and wallet cards, and cancels
              rewards they hold. The points history stays, without anything that names them, so your
              figures still add up. Guests can do both themselves in the web app. Anonymising a customer
              on the Customers page also erases their loyalty membership.
            </P>
          </section>

          {/* ── PEPPER (AI ASSISTANT) ─────────────────────── */}
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
                ['Menus', '"Which dishes are free from peanuts?", "Pad Thai is £11.75 now", "Publish the menu on Monday at 9am"', 'Menus'],
                ['Purchasing', '"Order 3 boxes of tomatoes and fill the rest to par", "Which deliveries are due today?"', 'Purchasing, Purchasing setup'],
                ['Website and marketing', '"Is the website up to date?", "Publish the website", "Put a banner up: closed today", "Switch off the lunch deal", "Any new reviews?", "Which menu screens are offline?"', 'Website, Promotions, Menu screens, Emails'],
                ['Support', '"Log an issue: the card machine keeps disconnecting", "Ask for a feature: split bills by seat"', 'Issue log, Feature requests'],
                ['Finding a page', '"Where do I change the opening times?"', 'The pages you can open'],
                ['How the app works', '"How do I set up tip pots?", "Where do I add a fridge?", "What does variance mean?"', 'Everyone who can use Pepper'],
                ['Your day in one go', '"Brief me on today", "What\'s on at Ware tomorrow?"', 'Each part follows its own area'],
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
                ['Search the inventory', 'Purchasing setup', 'Each item with its supplier prices (pack, price ex VAT, price per kg, litre or each), venue prices, which supplier is chosen, and recent price changes.'],
                ['Add or change items', 'Purchasing setup', 'Name, category, storage, code, notes, switch off. A new item can come with its first supplier prices.'],
                ['Add or change supplier prices', 'Purchasing setup', 'Price per pack, pack, VAT, supplier code, the supplier\'s product name (a brand), minimum and steps, a venue\'s own price, and which supplier an item is ordered from (for every venue or one).'],
                ['Add or change suppliers', 'Purchasing setup', 'Contact details, how orders reach them, cutoff, delivery days, minimum order, delivery charge, and one venue\'s own account number, days or cutoff.'],
                ['Make and change order lists, set pars', 'Purchasing setup', 'Pars are in packs unless you give kg, litres or each.'],
                ['Import a price list', 'Purchasing setup', 'Attach a CSV with the import headings, or a PDF, photo or email of the supplier\'s list: Pepper reads the products out of it. The card shows what would be added and changed, and any rows it would skip, before anything is saved.'],
                ['See and fill in an order', 'Purchasing', 'The venue\'s draft for a list: quantities, pars, last ordered, other suppliers. Quantities are packs (cases, bags), as on the Purchasing page. Nothing is sent until you place it.'],
                ['Send an order for approval', 'Purchasing', 'For people without Purchasing approval: the card lists the lines and the day wanted from each supplier, and you can add a note for the manager.'],
                ['See the orders waiting for approval', 'Any purchasing access', 'Who asked and when, the days wanted, each line with what was asked for, and drafts that were sent back with the reason.'],
                ['Place an order', 'Purchasing approval', 'Your draft, or an order waiting for approval. The card lists each supplier with its delivery date (the day asked for, if any), how the order gets to them and the lines, and warns about rounded-up quantities, a missed cutoff or a small order.'],
                ['Change, split or send back an order waiting for approval', 'Purchasing approval', 'Change quantities, move part of it to a second order for another day, or send it back with the reason.'],
                ['Send, change, split or cancel a purchase order', 'Purchasing (send, date); Purchasing approval (quantities, split, cancel)', 'Email it, or mark it sent by printout, PDF, Excel or phone. Quantities can change while it is waiting to be sent; the date and notes until it is received. A split moves part of it to a second order for another day.'],
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
                ['Reviews', 'Website view, manage to change', 'Recent reviews with the average; approve one for the website, hide it, feature it, or save a reply.'],
                ['Menu screens', 'Menu screens view, manage to reload', 'Which screens are online and what they show; reload one that looks stuck.'],
                ['Booking emails', 'Emails view', 'Recent confirmations, reminders, changes and cancellations: sent, failed (and why) or waiting.'],
                ['Report an issue or ask for a feature', 'Issue log, Feature requests', 'Logs it for the platform team: an issue with its impact and urgency, or a feature request others can vote for. Pepper can also list your logged issues.'],
              ]}
            />
            <H3>Finding a page</H3>
            <P>
              Ask <em>"Where do I change the opening times?"</em> or <em>"Take me to the rota"</em>{' '}
              and Pepper replies with a link to the page; tap it to go there. It only offers pages
              you can open.
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
              three switches (Pepper for staff, guests' AI apps, website chat) with one Save, and this
              month's usage. The chats share a monthly allowance; when it is used up they pause until
              the next month, and the AI app connectors keep working. Activity lists every change made
              through Pepper, the website chat and AI apps: what, by whom and where; a booking made
              past the usual limits is marked.
            </P>
            <P>
              Usage counts what each reply costs, not just its length: what Pepper writes counts five
              times, and the earlier part of a chat it reads again counts a tenth or less. So a long
              chat costs much less than its size suggests, and an everyday question answered by the
              faster model uses only a small part of what the same question costs on the most
              capable one. <strong>Who uses it this month</strong>{' '}
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
          </section>

          {/* ── PURCHASING ──────────────────────────────── */}
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
              minimum order and delivery charge. Under <strong>Per venue</strong>, a venue can have its own
              account number, delivery days or cutoff. These work out the delivery date each order is
              placed for.
            </P>

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
              the company price. Every price change (by hand, by import or from an invoice) is kept: tap{' '}
              <strong>History</strong> to see them.
            </P>
            <InfoBox type="tip">
              <strong>Import</strong> loads a whole price list from a CSV or Excel file (download the template
              for the headings, including Product name): new items, suppliers and categories are added, existing prices updated.
              Check file shows what would change first; rows with a problem are listed and skipped.
            </InfoBox>
            <P>
              Deleting an item that has been ordered switches it off instead, so past orders keep it.
              <strong> Categories</strong> group items on lists and orders; drag them into the order you want.
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
              <li>Use <strong>−</strong> / <strong>+</strong> or type a quantity. The pack you are ordering (Case, Box, Bag and its size) sits next to the quantity. <strong>Par</strong> sets the usual quantity; <strong>Fill to par</strong> does it for every empty line.</li>
              <li><strong>Show</strong> picks what else each line shows: the supplier, the price per pack, the last order (how many and when) and a <strong>Last quantity</strong> column at the end. All are off until you switch them on, and the choice is remembered on that device. Price only appears for people allowed to see prices.</li>
              <li>To order an item from another supplier this time, tap its pack (it has a small arrow when there is another supplier). <strong>Add item</strong> adds anything from the inventory.</li>
              <li>Group by <strong>Supplier</strong> to see each supplier's next delivery date and cutoff.</li>
              <li>Tap <strong>Review &amp; place</strong>: one order per supplier, each with its delivery date and an optional note. To deliver on another day, tap one of <strong>Their delivery days</strong> (the supplier's next four) or tap the date to pick any day from the calendar. Once today's cutoff has passed, the first date offered is already the next delivery after it. Then <strong>Place</strong>.</li>
            </ol>
            <P>
              Quantities save as you type, so a half-filled order is waiting as a <strong>Draft</strong> on the
              list's tile. Quantities below a supplier's minimum or step are rounded up when the order is placed.
              Staff see prices only if their role can view purchasing setup.
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
              While an order waits under <strong>To send</strong>, someone with Purchasing approval can still
              change it. <strong>Change quantities</strong> changes how many of each (0 takes a line off).{' '}
              <strong>Add items</strong> lists everything that supplier sells you: search by name, tap the
              products to add (something already on the order can't be picked again: change its quantity
              instead), tap Done, set how many, then <strong>Save</strong>. Added products go on at today's price
              for the venue, rounded up to the supplier's minimum and steps. If you see prices, the total shows
              what the order comes to and what it was before. Once an order has been sent it can't change:
              cancel it and order again.
            </P>
            <P>
              When a delivery arrives, open it and tap <strong>Book in delivery</strong>: for each line, how
              many arrived (a lower number marks it Short; you can also pick Damaged, Substituted or Not
              delivered, with a note), the packaging, damage and quality checks, the temperature of the chilled
              and frozen goods (chilled at or below 8°C, frozen at or below -15°C), and whether you accepted it.
              If anything failed, say what was done about it. Saving writes the venue's delivery check for
              Food safety, so it doesn't need typing in twice. <strong>Correct the delivery</strong> updates it.
            </P>

            <H3>6. Orders that need approval</H3>
            <P>
              A role's <strong>Purchasing approval</strong> permission (Access → Roles) decides who can place
              orders. People who can order (Purchasing: Manage) but not approve fill in an order the same way,
              then tap <strong>Send for approval</strong> instead of Place order: they pick the day they'd like
              from each supplier and can leave a note for the manager. Nothing reaches the suppliers yet. To make
              someone request only, set their role's Purchasing approval to None.
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
            <InfoBox type="info">
              All of this can also be done by chat with Pepper (Ask Pepper): ordering, booking deliveries
              in, changing prices and importing a supplier's price list from a PDF or photo. See Pepper →
              Purchasing by chat.
            </InfoBox>
          </section>

          {/* ── TILL (POS) ─────────────────────────────────── */}
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
            <ol className="list-decimal ml-5 space-y-2 text-sm text-muted-foreground mb-4">
              <li><strong>Order types</strong> (shared by every venue): Eat in, Take out, Delivery, Collection and any you add. They decide how a check is served, can change a dish's tax, and show on tickets and kitchen screens.</li>
              <li><strong>Revenue streams</strong>: groups of tills for reporting sales by place or device, e.g. Restaurant, Bar, Kiosk. Each picks the order types its tills offer (and for each, whether to ask for a customer name and a tent number: No, Ask or Must), which type new checks start as, its menus and an optional service charge (from a number of covers). A stream doesn't decide tax. Drag them into order. See Tax, Order Types &amp; Streams.</li>
              <li><strong>Courses</strong> (shared by every venue): Starters, Mains, Desserts, in the order they go to the kitchen. A course <strong>held by default</strong> waits to be fired when it goes with an earlier course.</li>
              <li><strong>Till roles</strong> (shared by every venue): what Server, Supervisor and Manager may do: void sent items, refund, comp, discounts up to a %, open the drawer, reopen checks, take over other people's checks, change prices, move items between checks, see reports, close the day, approve for others.</li>
              <li><strong>Staff and PINs</strong>: give each person a till role and a 4 to 6 digit PIN (not 1111 or 1234, and different from everyone else's at the venue). People come from the Staff page.</li>
              <li><strong>Venue hub</strong>: the small computer on the venue&apos;s network that prints the network and USB printers and, with <strong>Hub first</strong> on, keeps the tills, kiosks, kitchen screens and order ready boards trading with the internet down. Link it, see its state and updates, the USB printers plugged into it, and how to install one (see Set up the venue hub on a mini PC and Hub first below).</li>
              <li><strong>Printers</strong>: each printer, on the network, USB on the venue hub, or plugged into a till, kitchen screen or kiosk (see Printers and the venue hub below). Kitchen tickets print where the kitchen flow sends dishes: a <strong>Kitchen printer</strong> box in Kitchen screens.</li>
              <li><strong>Printing</strong>: how kitchen tickets, receipts and bills look (see Ticket and receipt designs below).</li>
              <li><strong>Card machines</strong>: your Dojo, Stripe or SumUp account and the card machines at the venue; each till and kiosk picks its machine (see Card machines below).</li>
              <li><strong>Receipts and payments</strong>: when the trading day starts, the name, address and VAT number on receipts, the ways to pay, tips, asking for covers, and when staff are signed out. Tax rates are set on Menus → Tax rates.</li>
              <li><strong>Cash Recon link</strong>: which till figures go into which Cash Recon fields when the day is closed (see End of day).</li>
              <li><strong>Floor plan</strong> (Store tech → Floor plan): add an area (e.g. Restaurant), tap tables to put them on it, drag them where they stand, drag the round corner to resize, Turn, Square / Round, and add walls, the bar, plants and labels. Save the area. Tables themselves are added on the Tables page.</li>
              <li><strong>Tills</strong>: open the till address on the tablet: it shows a six-letter code and a QR code. Tap <strong>Add a till</strong>, type the code, give it a name, table service or counter, and <strong>Add the till</strong>: the tablet sets itself up. Or scan the QR code with your phone and do the same in the installer app. <strong>New device</strong> on a till's row puts it on another tablet (type the code that tablet shows; the old one stops), and so does choosing <strong>One already here</strong> in Add a till. Removing a till signs it out; <strong>Bring back</strong> on the Removed line links it again with its settings. Each till and kiosk gets its own block of counter <strong>order numbers</strong> when it is added (the first 1-99, the next 100-199, and so on), shown on its row; change it in the till's window (<strong>Order numbers</strong>, from and to). Two tills or kiosks at a location can't share numbers: the window says which one already uses them.</li>
            </ol>

            <H3>Printers and the venue hub</H3>
            <P>
              Store tech → <strong>Printers</strong> lists the venue&apos;s printers. <strong>Add</strong> one, say whether it is for
              the kitchen or bar or for receipts, and how it is connected:
            </P>
            <ul className="list-disc ml-5 space-y-2 text-sm text-muted-foreground mb-4">
              <li><strong>On the network</strong>: an Epson (or other ESC/POS) printer with a network cable or Wi-Fi. Give it a fixed address on the router and type it here (port 9100). The <strong>venue hub</strong> prints to it, and can use a <strong>backup printer</strong> when it doesn&apos;t answer.</li>
              <li><strong>USB on the hub</strong>: a USB receipt printer plugged into the venue hub&apos;s mini PC. Pick it from the printers the hub found (it lists them every minute). The hub prints to it like a network printer, can use a backup printer, and says how it is.</li>
              <li><strong>Plugged into a till or screen</strong>: a USB or Bluetooth printer set up as the printer of a till, kitchen screen or kiosk. That device prints its tickets through Chrome. Start Chrome with <strong>--kiosk-printing</strong> so it prints without asking each time. A kiosk&apos;s printer prints that kiosk&apos;s receipts only.</li>
            </ul>
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
              printers again if they moved). Removed in Store tech, a hub shows a new code by itself. Running the command again
              on the same mini PC updates it and keeps its link.
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
                ['What devices need', 'The Macaroonie Android app (version 1.3 or later) on each till, kiosk, kitchen screen and menu screen. A device in a web browser can\'t reach the hub (browsers block it from a secure page) and simply keeps using Macaroonie.'],
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
              Store tech → <strong>Printing</strong> decides how printed kitchen tickets, receipts and bills look. Designs
              belong to the whole company; each venue picks which one it prints and can change a design&apos;s words or
              leave parts out. Without a design, tickets print the usual way.
            </P>
            <ul className="list-disc ml-5 space-y-2 text-sm text-muted-foreground mb-4">
              <li><strong>What prints where</strong>: for <em>Kitchen tickets</em>, <em>Till receipts and bills</em> and <em>Kiosk receipts</em>, pick a design for the whole company (<strong>Company</strong>) and, if this venue needs another, for the venue picked at the top of Store tech. Kiosk receipts print like till receipts until you pick a kiosk design.</li>
              <li><strong>New design</strong> starts from the usual layout. A design is a list of parts from top to bottom: drag the grips to change the order, tap a part to change it, <strong>Add a part</strong> for more, and the bin (in the part&apos;s box) to take one out. The dishes, and a receipt&apos;s total, always stay.</li>
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
              Store tech, Add screen on the Screens page, or the installer), choose{' '}
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

            <H3>Taking an order</H3>
            <ol className="list-decimal ml-5 space-y-2 text-sm text-muted-foreground mb-4">
              <li>Sign in with your PIN. The till signs you out after the time set in Receipts and payments. A PIN set or changed in Store tech works straight away; if the till is offline it needs to have been online once since.</li>
              <li><strong>Floor</strong>: tap a table (it asks for covers if set to), or <strong>New tab</strong> for a named tab. Colours show which tables are free, open, waiting for a held course, or billed.</li>
              <li>Tap dishes. Pick a <strong>seat</strong> and <strong>course</strong> at the bottom of the menu first if you want them. Dishes with choices and combos open a window to pick them, add a note or allergies.</li>
              <li><strong>Send</strong> sends new items to the kitchen. If a later course is held, <strong>Fire</strong> sends it when it's time.</li>
              <li>Tap an item on the check to change it: before it's sent you can change or delete it; after, <strong>Void</strong> it with a reason (the kitchen gets a VOID ticket), or <strong>Comp</strong> it.</li>
              <li><strong>More</strong>: guests, move table, name, order type, tent number, server, revenue stream, discount, service charge, offers, split or move items to another check, merge checks, an item not on the menu, print bill, no sale, close an empty check.</li>
              <li><strong>Pay</strong>: cash (with change), card, card machine (the amount goes straight to the till&apos;s card machine, see Card machines), voucher and so on, a tip if switched on, and as many payments as needed to split the bill. Then close with or without a receipt.</li>
            </ol>
            <P>
              <strong>Counter</strong> takes an order with a number (from the number set in Receipts and
              payments, each day), pays it, and sends it to the kitchen when it's closed. Pick the
              order type first (Eat in, Take out...: the ones the till's revenue stream offers) and type
              the customer name or tent number if that type asks for them; one it must have can't be
              skipped.{' '}
              <strong>Closed</strong> lists today's closed checks: print the receipt again, <strong>Refund</strong>{' '}
              or <strong>Reopen</strong>.
            </P>
            <P>
              A dish has run out: <strong>hold it down</strong> on the menu and pick <strong>Sold out for
              today</strong> or <strong>until I put it back</strong>. It shows as sold out on every till,
              online ordering and the menu screens. Tap it to put it back on, or to add it anyway.
            </P>
            <InfoBox type="tip">
              Something your role doesn't allow (a void, a big discount, a refund) asks for a manager: someone
              whose role has <strong>Approve for others</strong> types their PIN on the same till, and the check
              records who approved it.
            </InfoBox>

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
              service charge and tips are written into that day of Cash Recon; otherwise use{' '}
              <strong>Fill Cash Recon</strong> on the day in Till reports. A submitted Cash Recon day isn't changed.
            </P>

            <H3>Till reports</H3>
            <DataTable
              head={['Tab', 'What it shows']}
              rows={[
                ['Days', 'Each trading day: sales, payments, cash expected and counted, revenue streams, order types, VAT, staff, discounts and comps, voids, refunds, best sellers, open checks. The open day is shown as it stands now.'],
                ['Checks', 'Every check of a day with its items, totals and full history: who did what, when, and who approved it.'],
                ['Refused changes', 'Changes a till made offline that couldn\'t be applied when it caught up. Note what was done and mark them dealt with.'],
                ['Print queue', 'Tickets and other jobs, waiting or printed, with the reason when one didn\'t print.'],
                ['Kitchen', 'Speed of service from the kitchen screens: per station, tickets, dishes, average, middle and slowest times, how many were on time and late, the average by hour, and every remake with its reason. Download CSV for every bump and remake.'],
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

          {/* ── KITCHEN SCREENS ─────────────────────────────── */}
          <section id="kitchen" data-help="">
            <H2>Kitchen screens</H2>
            <P>
              Kitchen screens show the orders to cook on a screen instead of (or as well as) printed tickets.
              Use an Android tablet, or an Android TV box or stick with a big screen, in Chrome. Orders from
              the till, from online ordering and from GloriaFood arrive the moment they're sent; the cooks tap to say a dish or
              order is done, and the expo (the pass) marks the order ready. A <strong>kitchen flow</strong> says
              how dishes move between stations: a burger bun from Prep 1 on to Prep 2 for the meat, while the
              fries go from Prep 1 straight to Expo 1. You can keep several flows (a busy night, a quiet night with
              one cook, the grill down) and switch between them from a kitchen screen.
            </P>
            <InfoBox type="info">
              Kitchen screens talk to Macaroonie over the internet, like the tills. If the internet drops, a
              screen keeps what it has and saves its taps, then catches up when it's back; new orders reach it
              once the till can send them. Working between the till and the kitchen with the internet down
              needs the venue hub, which comes later.
            </InfoBox>

            <H3>Setting up (Store tech → Kitchen screens)</H3>
            <ol className="list-decimal ml-5 space-y-2 text-sm text-muted-foreground mb-4">
              <li><strong>Stations</strong>, four kinds (plus the Splitter and Sleeper below and <strong>Kitchen printer</strong>, which prints the dishes that reach it: see Printers and the venue hub): <strong>Prep</strong> (Grill, Fryer, Bar, Prep 1...) makes dishes; <strong>Expo</strong> (the pass) checks whole orders before they go out; <strong>Runner</strong> takes orders out to tables or the counter; <strong>Order ready board</strong> shows order numbers on menu screens (nothing to bump, no kitchen screen). Each station turns a ticket amber after your target minutes and red after more. <strong>Show held courses</strong> shows dishes waiting to be fired, greyed out. <strong>Show orders before their dishes get here</strong> (on for an expo) puts a ticket up as soon as the order is sent, each dish marked where it is now (At Grill). <strong>On order counts</strong>: groups such as Wings, counting how many pieces are on order (the 8pc dish counts 8, the 6 Wings option counts 6).</li>
              <li><strong>Kitchen flow</strong> (at the top): boxes for <strong>Orders in</strong> (the till and online orders) and every station, joined by links. Drag a box's dot onto another box (or tap the dot, then the box) to send dishes on to it. Tap a link's label to choose which dishes take it: dishes, sections, the till or kiosk they were <strong>sent from</strong> (the bar's till to the bar), revenue streams or order types (your own list: Eat in, Take out...); a link with no filter takes every dish. To list the dishes that <em>don't</em> go that way instead, switch the link from <strong>Only these</strong> to <strong>All except these</strong>: Orders in to the Wok, all except Drinks and Desserts, takes every other dish (any one thing listed leaves a dish out, so a section, a few dishes and an order type can be listed together). Its label reads <em>Except Drinks, Desserts</em> in red. From each box a dish takes the links that name it most closely (the dish, then its section, the till or kiosk it was sent from, its revenue stream, its order type, then All except links, then links for every dish), so Prep 1 to Prep 2 for burgers and Prep 1 to Expo 1 for everything else sends the bun on and the fries straight to the expo; and an All except link beside a link for every dish sends what it leaves out down the link for every dish. Links that tie all apply: Expo 1 to ORB 1 and to a Runner at once, or for eat in only. <strong>Check a dish</strong> shows a dish's way. A new flow arranges itself; drag boxes by their grip, or press <strong>Tidy</strong>. A way round in a circle can't be saved. <strong>Save flow</strong>: dishes sent from then on follow it (dishes already in the kitchen keep their way).</li>
              <li><strong>Taking a station out of a flow</strong> (the grill down tonight, one cook on the fryer): tap the station's box, then <strong>Take out of this flow</strong> and <strong>Yes, take it out</strong>. The box leaves this flow with its links, and no dish goes to that station while this flow is in use; link the stations that take over its dishes, then <strong>Save flow</strong>. It shows under <strong>Not in this flow</strong> above the boxes, where <strong>Put back</strong> brings it back (with no links: draw them again). The station itself, its screens and its settings stay, and your other flows still use it. To remove a station everywhere, delete it under <strong>Edit station</strong> instead.</li>
              <li><strong>Sharing tickets between two stations (Splitter)</strong>: for two cooks on the same job, e.g. two wingmen. <strong>Add to the flow</strong> → <strong>Splitter</strong> (it was called Balance box), name it (Wings) and list its <strong>Pieces</strong>: what a dish counts when the box weighs up who has more to cook (the <em>10 Wings</em> option counts 10, the <em>8pc Boneless</em> dish counts 8; a dish not listed counts its quantity). Link Orders in to the box for the wings (a link naming the Wings section or the dishes), and the box to Wingman 1 and Wingman 2; leave the link for every dish going to the Fryer. Each ticket's wings then go to just one wingman, the one with the fewest pieces still to cook (a piece counts until that station bumps it), taking turns when they're level; the rest of the ticket goes to the fryer. <strong>Big tickets</strong> (in the box's window): <em>Keep each ticket on one station</em> (the usual) sends all of a ticket's wings to one wingman however many there are; <em>Share big tickets</em> with a number, e.g. 30, shares out a ticket with more than 30 pieces: each dish line goes, biggest first, to whichever wingman then has the fewest pieces (counting what this ticket has already given them), so 3 x 20 wings on one ticket can go 20 to one and 40 to the other. One dish line is never split (a line of 3 x 10 Wings stays with one wingman), and a meal deal's parts can go to different wingmen. The choice is made when the order reaches the kitchen (a held course: when it's fired), and then the dish stays with that wingman. A box's links out show <strong>Shared</strong> and have no filters; <strong>Check a dish</strong> shows <em>Wingman 1 or Wingman 2</em>. The box has no kitchen screen and nothing to bump. If one wingman is taken out of the flow in use, the other gets every ticket.</li>
              <li><strong>How a Splitter shares</strong> (in its window): <em>Fewest pieces</em> (the usual) sends each ticket to the station with the fewest pieces still to cook. <em>Smart: by speed</em> also watches how fast each station has been bumping: it works out how long a piece has been taking there (from its last 8 tickets in the last 30 minutes, not counting time a ticket sat waiting behind others) and sends the ticket where it should be done soonest, its pieces still to cook times that time. So if Wingman 2 has been taking twice as long as Wingman 1, Wingman 1 gets about two tickets for every one of Wingman 2's; when Wingman 2 catches up it gets its share back. A station with nothing to go on yet (no bumps lately) counts as fast as the others, and with no bumps anywhere it shares by pieces.</li>
              <li><strong>When one order type gets busy</strong> (also in the Splitter's window): <em>Give it its own station</em>, then a count, an order type and a station, e.g. <em>From 5 waiting Delivery orders, send Delivery orders to Wingman 2 and every other order to the other stations</em>. Waiting means with dishes still to cook at the stations the box shares between (the new order counts too). Below the count the box shares as usual; once there are that many, every delivery ticket goes to Wingman 2 and every other ticket to the others, until the deliveries are bumped and the count drops again. Pick a station the box links to in the kitchen flow (the list puts those first and marks the others <em>not linked to it yet</em>; the flow shows a warning if it doesn't link to it). If that station is deleted or stops bumping, the rule switches off. The station list and the flow designer say which way each Splitter shares.</li>
              <li><strong>Holding dishes back for a while (Sleeper)</strong>: for orders that should start later than they arrive, e.g. delivery orders waiting 10 minutes so the food isn't ready before the driver, or desserts waiting 20 minutes after the mains. <strong>Add to the flow</strong> → <strong>Sleeper</strong>, name it (Delivery wait) and set <strong>Hold dishes for</strong> (1 to 240 minutes) under <strong>Edit station</strong>. Then decide which dishes it holds with the link into it from Orders in: tap the link's label and pick an order type (Delivery), a revenue stream, the till or kiosk it was sent from, a section (Desserts) or single dishes; a link with no filter holds every dish. Link the Sleeper on to the stations those dishes go to (the Grill, the Fryer; those links can have filters too), and keep the usual links from Orders in for everything else: a dish takes the links that name it most closely, so delivery dishes take the Sleeper and the rest go straight to the stations. The wait counts from when a dish reaches the Sleeper; then it reaches the next stations by itself. Kitchen screens that show dishes before they arrive (the pass) show it as <em>Waiting at Delivery wait until 19:42</em>, with the ticket's clock showing that time; the grill only sees it once it wakes, and its timer starts then. The pass's Bump sends it on at once, and a dish remade after it woke doesn't wait again. A Sleeper has no kitchen screen and nothing to bump. For a different wait add another Sleeper (Delivery wait 10 min, Dessert wait 20 min). A Sleeper before a kitchen printer prints the ticket when it wakes (within a minute). <strong>Check a dish</strong> shows the wait in its way.</li>
              <li><strong>Order statuses for the boards (Setter)</strong>: a Setter sets an order&apos;s status as a dish passes it, so order ready boards can show more than Preparing and Ready (Cooking, Bagging, Out for delivery). <strong>Add a station</strong> (or <strong>Add to the flow</strong>) → <strong>Setter</strong>; its name is the status, so each Setter at a location needs its own name (call it the same at every location). Under <strong>On order ready boards</strong> pick how it shows on a tile: <strong>Words</strong> (a coloured label under the number, with your own words if you like), a <strong>Flag</strong> in the corner, a <strong>Coloured border</strong> round the tile, a <strong>Traffic light</strong> (pick which lamp is lit), a <strong>Square</strong> or a <strong>Dot</strong>; its <strong>Colour</strong>; and <strong>Movement</strong>: Still, Pulse, Turn, Blink, Bounce, Shake or Glow. Put it in the kitchen flow where the status should change: before a station to say the dish is there (Orders in → <em>Cooking</em> → Grill), after one to say it has left it (Grill → <em>Bagging</em> → Pass). Dishes go straight through a Setter; it has no kitchen screen and nothing to bump. An order shows the last Setter its dishes reached, and keeps it on the Ready side too.</li>
              <li><strong>Several flows</strong>: the row of flow names above the boxes picks the flow you're looking at; a green dot marks the one <strong>in use</strong>. <strong>New flow</strong> starts an empty one; <strong>Copy</strong> (in the box on the right) starts from the flow you're looking at, which is the quick way to make, say, a <em>Grill down</em> flow from your normal one. <strong>Use this flow now</strong> puts the flow you're looking at in use, after a confirm. <strong>Rename</strong> and the bin (delete, after a confirm) are there too; the flow in use can't be deleted. <strong>Order</strong> sets the order kitchen screens list the flows in (drag the rows). Save or discard changes before opening another flow.</li>
              <li><strong>Flows shared by every location</strong>: with more than one location, a flow can be used by all of them. In <strong>New flow</strong> (or <strong>Copy</strong>) pick <strong>Every location</strong> instead of <strong>Only at</strong> this location. A shared flow has a globe on its tab and shows at every location after that location's own flows; each location puts it in use (or not) itself. Its boxes are station <em>names</em>: at each location a box is that location's station with the same name (capitals and spaces don't matter), so one flow sends Ware's dishes to Ware's Grill and Pass and Hertford's to Hertford's. <strong>Add to the flow</strong> offers this location's stations, or a new box of any kind (tap it to name it). A box this location has no station for shows <em>none here</em>, greyed; the note above the boxes lists what each location lacks, with <strong>Add them at</strong> that location to make the stations there. A location without a box's station leaves that box's links out, so its dishes take the next closest link (no Fryer at Hertford: the fries go with everything else to the Grill). Revenue stream and Sent from filters in a shared flow go by name too (each location's <em>Bar till</em>). Tap a box to rename it, change its kind or remove it from the flow; its panel lists every location's station of that name, with <strong>Add it</strong> where there isn't one, and <strong>Edit station here</strong> for this location's. Changes to a shared flow count at every location once saved. It can't be deleted while any location has it in use. <strong>Copy</strong> turns a shared flow into this location's own (its boxes become this location's stations of those names) or this location's flow into a shared one.</li>
              <li><strong>Kitchen screens</strong>: <strong>Add a screen</strong>, name it, tick the stations it shows (none ticked: all; order ready boards aren't shown on kitchen screens), what it opens on (tickets or the On order counts), tickets across, text size, the <strong>ticket title</strong> (what each ticket's header shows big: <em>Table or name</em>, the usual; the order number; the tent; the table; or the customer's name), the beep, and whether it <strong>can switch the kitchen flow</strong> (on unless you turn it off). On the screen, open the kitchen screen address (kitchen.macaroonie.com, shown on the tab) in Chrome and install it: it shows a code. Type that code in the Add a screen window (or scan its QR code with a phone).</li>
              <li><strong>Online orders</strong>: send online orders to the kitchen when they're accepted (an order for later comes on when it's time to start it), and mark them ready when the kitchen finishes (the guest gets the ready email).</li>
              <li><strong>GloriaFood orders</strong> (when the venue is linked to GloriaFood in Cash Recon settings): tick <strong>Send GloriaFood orders to the kitchen screens</strong> and press Save. Accepted orders then come onto the screens as GloriaFood sends them, marked with an orange <strong>GloriaFood</strong> label and GloriaFood's order number. Dishes are matched to your menus by name (capitals and spaces don't matter) and show under your menu's name, so dish and section links in the kitchen flow apply to them; a dish with no match (a name GloriaFood spells differently) goes by the order type and the links for every dish. Pick which of your order types each GloriaFood type counts as (Pickup, Delivery, Dine in...); they start matched by name. An order for later comes on the minutes you set before its time. Ready at the pass marks it Ready on the Online orders board, Collected marks it Collected there (with <strong>Mark them ready when the kitchen finishes</strong> on; GloriaFood isn't told). Ready or Collected on the board, or a cancellation in GloriaFood, takes it off the screens. Test orders from GloriaFood come on too, with the note "GloriaFood test order". Orders that arrived while this was off, imported orders, and orders more than two hours past their time don't come on.</li>
            </ol>

            <H3>Using a kitchen screen</H3>
            <ul className="list-disc ml-5 space-y-2 text-sm text-muted-foreground mb-4">
              <li>Tickets run left to right, oldest first (rush orders first). The header shows the table, tab or customer name (or what the screen's <strong>Ticket title</strong> asks for: with <em>Tent</em>, "Tent 12" with the order number beside it; an order without a tent shows its table or name instead), the order number, the timer, the order type and tent number, covers and server. Notes are yellow, allergies red, options pink and removals red.</li>
              <li>At a prep station, <strong>tap a dish</strong> to mark it done (tap again to undo): it goes on to the next station at once. <strong>Tap a ticket</strong> to pick it (blue outline), then <strong>BUMP</strong> to finish it here: its dishes go on to the next station in the flow ("From Grill" on the next station's ticket). Marking the last dish of a ticket done bumps it too. When dishes on one ticket go different ways, each says where it goes next ("Then Prep 2", "Then Pass").</li>
              <li><strong>The expo</strong> sees whole orders, each dish marked where it is now ("At Fryer"), and <strong>READY</strong> marks the order ready (it also finishes dishes still at earlier stations). Tapping a dish at the expo ticks it off instead of sending it on: see <em>Ticking dishes off at the pass</em> below. A line says when some of the order goes through another expo. Ready orders wait under the tick button until <strong>Collected</strong>.</li>
              <li><strong>A runner</strong> gets the order once the expo is done, and <strong>DONE</strong> when it's taken out. When the runner is the last step for every dish, DONE hands the order over (it leaves the order ready board).</li>
              <li>A station can't bump a dish that hasn't reached it yet, and can't bring back one the next station has already done.</li>
              <li>Along the top: All orders, one tab per order type, Online (your online orders and GloriaFood's), and the stations this screen shows. The green bar shows the average bump time today, the last 10, how many are done, the share on time, Live or Offline, and the time.</li>
              <li><strong>Rush</strong> moves a ticket to the front. <strong>SUM</strong> shows how many of each dish are on order. <strong>Prev</strong> lists the last tickets bumped here: <strong>Bring back</strong> one bumped by mistake. <strong>Remake</strong> puts a dish back on with a reason (for the waste report).</li>
              <li>A dish voided on the till shows crossed out with VOID until the ticket is bumped. Dishes moved to another table or check follow it.</li>
              <li>A <strong>combo</strong> shows as its name with its parts under it ("› Burger", "› 2 x KETCHUP"). Each part goes to the station that makes it, so the grill sees the burger and the fryer the fries, each under the combo's name; a part typed in just for the combo (a sauce pot, a toy) goes where the combo itself goes.</li>
              <li>The clock button lists orders for later (held courses, and online and GloriaFood orders for a later time). They come on by themselves when it's time.</li>
              <li>The gear button: pick the station, Tickets or On order counts, text size, beep, full screen, and the bump bar keys.</li>
              <li><strong>The flow button</strong> (top right, with the name of the flow in use, when you have more than one flow) lists your kitchen flows with the stations each uses. Tap <strong>Switch</strong> on another, then <strong>Yes, switch</strong>: dishes sent from then on go its way, for the whole kitchen. Dishes already on the screens stay where they are, so finish them as usual. Every kitchen screen shows the new flow straight away with a note saying who switched. Switching needs the internet; a screen not allowed to switch (Store tech) shows the flows without the Switch buttons.</li>
            </ul>
            <InfoBox type="tip">
              Bump bars and keyboards work: 1 to 9 and 0 pick a ticket, Enter or Space bumps, the arrows page
              through tickets, R brings the last ticket back, S shows what's on order, P makes a ticket a rush.
              Set a USB or Bluetooth bump bar to send those keys.
            </InfoBox>

            <H3>Ticking dishes off at the pass</H3>
            <P>
              At the expo (the pass) and runners, tapping a dish <strong>ticks it off</strong>: a packing check,
              so you can go down the ticket as you bag or plate it. A ticked dish turns grey with a tick and the
              ticket says how many are ticked (<em>2 ticked</em>); tap it again to untick it. Ticking off doesn't
              send anything on: when every dish is ticked the ticket says <strong>CHECKED</strong> (its top in the
              All ticked off colour) and stays on the screen until you press <strong>READY</strong> (or
              <strong> DONE</strong> at a runner). A dish still at an earlier station (<em>At Fryer</em>) can be
              ticked off too when the pass shows orders before their dishes get there: it's in front of you, so it
              counts as done at the fryer and leaves the fryer's screen.
            </P>
            <ul className="list-disc ml-5 space-y-2 text-sm text-muted-foreground mb-4">
              <li><strong>Bump when every dish is ticked</strong>: if you'd rather the last tick sends the order on, open the station in Store tech → Kitchen screens (<strong>Edit station</strong>) and under <strong>Ticking off dishes</strong> pick <em>Bump when every dish is ticked</em> instead of <em>Keep the ticket until READY</em>. The last tick then marks the order ready, as READY would. The station list says which each expo or runner does.</li>
              <li>A tick goes when the dish is made again (<strong>Remake</strong>), or when the station before takes it back (undoes it, or brings its ticket back with <strong>Prev</strong>): it has to be ticked off again when it comes back. READY then <strong>Prev</strong> at the pass brings the ticket back with its ticks.</li>
              <li>Prep stations don't tick: a dish tapped there is done and goes on.</li>
            </ul>

            <H3>Ticket colours</H3>
            <P>
              Store tech → Kitchen screens → <strong>Ticket colours</strong> sets the colours every kitchen
              screen of the venue draws tickets in. Tap a colour square to change it (the website's colours come
              first, then any colour of your own); <strong>Standard colour</strong> puts one back. Words turn
              black or white by themselves to stay readable. The preview beside the list shows a ticket in your
              colours. Press <strong>Save</strong>; the screens change at once.
            </P>
            <ul className="list-disc ml-5 space-y-2 text-sm text-muted-foreground mb-4">
              <li><strong>Dishes</strong>: the background of a dish's row when it's <em>To do</em>, <em>Ticked off</em> (done at a prep station, ticked off at the pass), <em>On its way</em> (still at an earlier station), <em>Held</em> (its course not fired yet) and <em>Voided</em>.</li>
              <li><strong>Ticket tops</strong>: an order being made, <em>New</em> (the first 30 seconds), <em>Rush</em>, <em>Prepared</em> (every dish has reached the pass) and <em>All ticked off</em> (every dish ticked off at the pass, waiting for READY).</li>
              <li><strong>Timer</strong>: its colour from the station's amber time and from its red time.</li>
              <li><strong>Dish names by section</strong>: pick a section from your menus (<em>Colour a section's dishes</em>) and a colour: those dishes' names show in it, so drinks or sides stand out on a busy ticket. A meal deal's parts take their own section's colour. Sections go by name, so one colour covers <em>Sides</em> in every menu. Remove one with its X.</li>
            </ul>

            <H3>Testing the kitchen</H3>
            <P>
              Try a kitchen flow before service without touching the real screens. In Store tech → Kitchen
              screens, <strong>Test the kitchen</strong> → <strong>Open the kitchen test</strong> opens a new window
              with every kitchen screen of the venue side by side, scaled down. They are the real kitchen screen,
              working on pretend orders: nothing you do there reaches the kitchen screens, the tills, the online
              orders board or the reports, and nothing is saved.
            </P>
            <ul className="list-disc ml-5 space-y-2 text-sm text-muted-foreground mb-4">
              <li><strong>Test order</strong>: pick dishes, where it comes from (the till or online), which till or kiosk sent it (for Sent from links), the order type, the revenue stream, a table or the counter, a tent number (counter orders) and a customer name, to see how tickets and order ready boards show them. With dishes in different courses, <strong>Hold later courses</strong> keeps them back until you press <strong>Fire</strong> on the order. A combo's choices are picked at random.</li>
              <li><strong>Made-up order</strong> sends one order made up from your menus; <strong>Rush: 5 orders</strong> sends five at once. <strong>Clear all</strong> takes every test order off.</li>
              <li>Tap and bump on the screens as you would in the kitchen. The <strong>Orders</strong> list on the right shows where each dish is on its way (green done, amber there now, grey still to come), the order ready boards' numbers, and an X to void a dish. <strong>Activity</strong> lists every tap, which screen made it, and anything refused.</li>
              <li><strong>Kitchen flow</strong> switches the flow for the test (also from a screen's flow button): orders sent after it go the new way, orders already there keep theirs. It doesn't change the flow in use in the real kitchen.</li>
              <li><strong>Screens</strong>: <strong>As set up</strong> shows your kitchen screens with their stations; <strong>One per station</strong> shows one screen for each station. <strong>Size</strong> (tablet, TV, upright), <strong>Across</strong> (screens per row) and the arrows button (one screen bigger) change the view. <strong>Online / Offline</strong> on a screen pretends its Wi-Fi went: its taps wait and go when it's back.</li>
              <li>Changes made in Store tech while the test is open show after <strong>Reload setup</strong> (which also clears the test orders). The link works for 8 hours; open it again from Store tech after that. View on Store tech is enough.</li>
            </ul>

            <H3>Order ready board</H3>
            <P>
              To show guests their order numbers, add an <strong>Order status</strong> block to a board on the{' '}
              <strong>Screens</strong> page and put the board on a screen at the counter. It lists numbers being
              prepared and numbers ready to collect, and changes as the kitchen bumps them. Ready numbers stay
              for the minutes you set, or until the order is collected.
            </P>
            <ul className="list-disc ml-5 space-y-2 text-sm text-muted-foreground mb-4">
              <li><strong>Which orders</strong>: every counter and online order (ready once the kitchen has finished the whole order), or one <strong>order ready board</strong> from the kitchen flow by name, e.g. ORB 1: only orders with dishes on their way to it, ready once all of them have arrived (both Expo 1 and Expo 2 done). Use the same board name at every venue and one board design works everywhere.</li>
              <li><strong>Each tile</strong>: what shows big (<strong>Big text</strong>: the order number, the tent number, the table or the customer's name) and what goes small under it (<strong>Under it</strong>: tap Order number, Tent number, Table, Customer name, Order type or Where from). With tents at the counter, Big text <em>Tent number</em> with <em>Order number</em> under it shows "TENT 12 / Order 57". An order without the big one shows its order number instead (online orders have no tent), and a line shows only when the order has it. Names are the name typed on the till or kiosk, or an online guest's first name: they show on a public screen.</li>
              <li><strong>Tile look</strong>: make the tiles your own. <strong>Words</strong>: the font (Body, Heading, Script or any listed font), weight, italic, capitals, the space inside, and a separate font for the small lines. <strong>Shape</strong>: Rounded (with how round the corners are), Square, Pill or Circle; a border (width and colour) and a shadow (Soft, Strong or a Glow in the number's colour). <strong>Picture behind the tile</strong>: one for ready tiles and one for preparing tiles, filling the tile or shown whole, darkened so the number stays readable (Darken). <strong>Small picture</strong>: a picture on every tile (a bell, your logo), or one per order type (a plate for Eat in, a bag for Take out), placed left, right, above or in the corner, sized with the number. Pictures with a see-through background (PNG) look best.</li>
              <li><strong>Statuses</strong>: each tile shows its order&apos;s status from the kitchen flow&apos;s Setters (switch off with <strong>Show order statuses</strong>). Every Setter is listed: <strong>Hide</strong> it on this board, or give it another look, movement, colour, words or lit lamp here only; anything left on <em>As the Setter</em> follows the Setter&apos;s own settings. The designer shows the statuses on its example numbers; movement runs on the screens, and here when you press Play.</li>
              <li><strong>Layout</strong>: Preparing and Ready side by side, or one above the other, with Ready first if you like. Colours for the titles, the ready box and number, and the preparing number and box.</li>
              <li><strong>When a number changes</strong>: float over (from Preparing to Ready), fade out and in, pop out and in, or zoom out and in, taking the time you set. Press Play in the designer to see it.</li>
            </ul>
          </section>

          {/* ── SELF-ORDER KIOSKS ───────────────────────────── */}
          <section id="kiosks" data-help="">
            <H2>Self-order kiosks</H2>
            <P>
              A kiosk is a big touch screen guests order on by themselves: they pick staying or going, choose
              dishes and their options, see the allergens, and pay by card or at the counter. The order goes to
              the kitchen, the tills' <strong>Counter</strong> list, Till reports and Cash Recon like any counter
              order, with the kiosk named as who took it. Use an upright or wide touch screen running Chrome
              (an Android kiosk or a Windows touch PC).
            </P>
            <InfoBox type="info">
              Card payments use a <strong>test card reader</strong> for now: the kiosk shows Approve and Decline
              buttons and no money is taken. Real card terminals connect here later. Until then, let guests pay
              at the counter (or offer both while you try it out).
            </InfoBox>

            <H3>Setting up (Store tech → Kiosks)</H3>
            <ol className="list-decimal ml-5 space-y-2 text-sm text-muted-foreground mb-4">
              <li><strong>Kiosk designs</strong>: <strong>New design</strong> opens the design editor (below). Designs are shared by every venue. A kiosk uses the design picked for it, or the first design. <strong>Copy</strong> makes a copy to try changes on; a design a kiosk uses can't be deleted.</li>
              <li><strong>Add a kiosk</strong>: its name, its <strong>revenue stream</strong> (the stream's order types are the kiosk's Staying or going? buttons, and the stream decides whether it asks for a name or a tent number), its design, its <strong>card machine</strong> (see Card machines; none = guests pay at the counter) and the receipt printer.</li>
              <li>On the screen, open the kiosk address (kiosk.macaroonie.com, shown on the tab) in Chrome: it shows a code. Type that code in the Add a kiosk window (or scan its QR code with a phone), and set the address as the kiosk browser's start page. For a screen guests can't leave, run Chrome in kiosk mode or use a kiosk browser (such as Fully Kiosk). <strong>New device</strong> on the kiosk's row moves it to another screen; the old one stops.</li>
            </ol>

            <H3>Screens of another shape or size</H3>
            <P>
              Each design is made for one screen: a Full HD kiosk (1080 x 1920) unless you pick another in the
              design&apos;s <strong>Screen</strong> card. A kiosk on a screen that isn&apos;t that shape or size still
              looks as designed:
            </P>
            <ul className="list-disc ml-5 space-y-1 text-sm text-muted-foreground mb-4">
              <li><strong>Another shape</strong> (a 4:3 tablet, a phone, a screen with the browser&apos;s bars showing): the kiosk keeps the design&apos;s shape, as big as fits and centred, with bars at the sides or above and below. The bars are black, or the design&apos;s Page colour if you pick that. If you&apos;d rather the kiosk filled the screen, pick <strong>Fill the screen</strong>: its layout then stretches to the screen&apos;s shape. A screen only a few pixels off the shape gets no bars.</li>
              <li><strong>Another size</strong> (a phone or tablet, or a screen bigger than the design&apos;s): the kiosk is zoomed so it is laid out at the design&apos;s size, and looks the same, only smaller or bigger. You don&apos;t need Chrome&apos;s <em>Desktop site</em> setting for this, so turn it off if you switched it on (it changes every other site too). A difference under 10% is left as it is. Turning the screen keeps the same zoom.</li>
              <li>The zoom works in a phone&apos;s or tablet&apos;s browser (Chrome on Android, Safari on an iPad; in Fully Kiosk, keep its wide viewport setting on). A computer&apos;s browser (Chrome on a Windows kiosk) keeps its own size: there, set the screen&apos;s display scaling (Windows Settings, Display, Scale) so it is close to the design&apos;s size. The shape is kept everywhere.</li>
            </ul>
            <P>
              The kiosk&apos;s staff panel (five quick taps in the top-left corner of its start screen) shows, on its{' '}
              <strong>Screen</strong> line, the screen&apos;s size as the browser counts it, the design&apos;s, the zoom and
              where the bars are. In the design editor, <strong>Try on</strong> above the preview shows the design on a
              Full HD kiosk, a 16:10 or 4:3 tablet, or a phone, as that screen would show it.
            </P>

            <H3>The design editor</H3>
            <P>
              Settings are on the left in cards you open and close; on the right is the kiosk itself, showing
              your changes as you make them. Use it like the kiosk: nothing you order there is sent.{' '}
              <strong>Start screen</strong> and <strong>Menu</strong> jump to those screens, <strong>Upright</strong>{' '}
              and <strong>Wide</strong> turn the screen, <strong>Try on</strong> shows the design on another screen
              (see Screens of another shape or size above; the preview is the design&apos;s own screen otherwise), and
              the list next to them picks the revenue stream it orders as. Nothing is kept until <strong>Save</strong>; <strong>Discard</strong> goes back to the
              last save, and leaving with changes not saved asks first. On a phone, Settings and Preview take
              turns.
            </P>
            <P>
              <strong>Save as</strong> (beside Save) keeps what you see as a new design under a name you choose,
              and opens it. Changes you haven&apos;t saved go into the new design only: the design you started
              from stays as it was last saved, so the kiosks using it don&apos;t change. Use it to try another
              version (a summer look, say) without touching the one your kiosks show, then pick the new design
              for a kiosk in Store tech → Kiosks when it is ready. The new design isn&apos;t shared (a share link
              stays with the design it was made for). <strong>Copy</strong> on the Kiosks page does the same
              from a saved design.
            </P>
            <InfoBox type="tip">
              The preview shows the menu as published, the same as the kiosks. A photo, price or dish you have saved
              on the Menus page but not published yet only shows once you pick <strong>Menu with unpublished
              changes</strong> in the list above the preview (or tap <strong>Show the changes</strong> in the note
              that names the menus with such changes). Option group pictures (flavours, sauces) show straight away
              either way. After changing a menu in another tab, tap <strong>Reload</strong> to see it.
            </InfoBox>
            <DataTable
              head={['Card', 'What you set']}
              rows={[
                ['Brand', 'Logo, colours (start from a set: Website colours (your website theme\'s), Fresh, Red and gold, Night, Ocean, Plain, then change any: each colour offers the website\'s colours as swatches, or a custom one), the bottom bar\'s and the side menu\'s own colours (see Bottom bar and side menu colours below), the fonts for headings and text, headings in capitals, rounded corners. Colours that are hard to read together are pointed out. Make a theme (at the top) fills all of these from a picture and a few words (see Website Builder, Make a theme from a picture).'],
                ['Layout', 'The bar along the top (logo and language) on or off. Back and Start again with their words, or icons only. How pictures are drawn is set apart for dishes (Menu card) and for choices (Choices card). Top of a dish\'s page: the photo beside the words, or Photo on top, with the photo lined up left, centre or right and the name, description, price and allergens under it lined up left, centre or right (on a wide screen the photo is always above the words in its own column, and only the words\' line-up applies). A meal deal\'s pages follow it too: the deal\'s picture and words on its steps, and a picked dish\'s own photo and words on its options page. Shade behind the dish\'s photo (on unless you turn it off): a quiet shade behind the dish\'s photo on its page and in the order, so cut-out pictures (PNGs on a see-through background) sit on the same background whether one pick shows or several share the photo; off, the page\'s own background, even behind a split photo (a No frame photo gets the design\'s rounded corners while the shade shows). Build a meal deal\'s picture from the picks (on unless you turn it off): see A meal deal\'s picture below. The picture flies into the order (on unless you turn it off): see Adding to the order below.'],
                ['Screen', 'The screen the design is made for: Full HD kiosk (1080 x 1920), HD, a 16:10 or 4:3 tablet, QHD, 4K, or another size you type in (its width and height upright, in the pixels its browser counts: a phone or tablet reports fewer than it has, often half). The preview shows the design at this size. On a screen of another shape: Keep this shape (bars around the kiosk, black or the Page colour) or Fill the screen. See Screens of another shape or size above.'],
                ['Start screen', 'Pictures apart from the buttons or behind them; pictures and videos taking turns (drag to order, up to 8), each with a Fit (see Fitting pictures below); the headline and the question; each order type\'s words, icon or picture; the Allergens button.'],
                ['Languages', 'The language your menu is written in, and the languages guests can pick (flags on the start screen).'],
                ['Menu', 'Dish pictures: how the menu\'s dishes, the section tiles, the dish\'s own photo and the basket are drawn: Cards (photo on a card), Round or Oval (the photo in a circle or an ellipse, the words under it, no card), Hexagons (they lock together like a honeycomb, and buttons, chips and cards across the kiosk take the hexagon look too), or No frame (the whole picture as it is, straight on the page: no card, corners or shadow; best with PNGs on a see-through background, such as cut-out food photos). A home page with banners and featured tiles (each can open a section or a dish, and each has a Fit for its picture: see Fitting pictures below), the banners\' shape; sections down the side with pictures or words only, or none (the menu opens on a page of section tiles: drag them into order, give each a picture, words and a width); dishes per row; descriptions, calories, dietary badges and quick add; sections left off the kiosk.'],
                ['Choices', 'How choices show where an option group or combo step doesn\'t pick its own: grid, list, slider or spin wheel. Choice pictures, set apart from the dishes\': Cards, Round, Oval, Hexagons or No frame (the whole picture with nothing behind it, the list and wheel thumbs too; a picked one glows in the button colour round its outline, with its name in that colour and the tick). Hexagon choices in a grid lock together like a honeycomb even when there are only a few (three make two over one, four make two over two); the list, slider and wheel show hexagon photos. Words only leaves the pictures out: each choice shows its name, level and price in the shape you picked (a card also shows the description), so hexagons become hexagons of words; the list and the wheel leave their small pictures out too, and a split photo still uses the pictures. Line up the choices: a grid or honeycomb of choices, with its heading, from the left or centred on the screen. When the choices appear: Just there, Fade in, Slide in from the side, Bubble up or Deal like cards; one after another each time a dish\'s page or a combo step opens (grids, honeycombs, lists and the slider; the wheel comes in whole; nothing moves for guests whose device asks for less motion). Picks on the dish\'s photo (for groups and steps with Split photo on): Split photo, or Small in the corner (see below). Option groups with their own look: groups this design shows another way (how they show, picture style, words only, how they come in); see How choices show below. The spin wheel\'s Spin button, and whether a spin picks the choice it stops on. The marks for levels: flames, stars or dots.'],
                ['Paying', 'By card, at the counter (and whether the kitchen starts on a pay-at-counter order straight away or once it\'s paid), the note on the order done screen for orders paid at the counter, "Anything else?" dishes before paying, the number to type (a tent number, the usual, or a table number).'],
                ['Order done', 'The screen after paying: its heading, what shows big and the lines under it, for every order type or one type its own way, a message, the receipts on offer (printed, a QR code, by email) and how long it shows. See The order done screen and receipts below.'],
                ['Timing and access', 'When the kiosk starts again if nobody taps, how long "Still there?" waits, and the reach button, with optional pictures or videos (up to 4, taking turns like the start screen\'s) to fill the top of the screen while everything is brought down; without them the space shows your brand colour and the reach sign.'],
              ]}
            />
            <InfoBox type="tip">
              Words you leave empty use the kiosk's own words, which come in all nine languages. Words you type
              show as typed: translate them on <strong>Menus → Translations</strong>.
            </InfoBox>

            <H3>The order done screen and receipts</H3>
            <P>
              After paying, the kiosk shows a big number guests keep an eye on, and a few lines under it. You
              design that screen in the design editor&apos;s <strong>Order done</strong> card, the same for every
              order type or each order type its own way (an eat-in order with a tent, a takeaway called by
              name).
            </P>
            <ul className="list-disc ml-5 space-y-1 text-sm text-muted-foreground mb-4">
              <li><strong>Big on the screen</strong>: <em>Automatic</em> (the usual) shows the <strong>tent number</strong> when the guest typed one (a tent they took from the stand and put on their table), and the order number when they didn&apos;t. Or always the order number, the tent (or table) number, or the customer&apos;s name. An order that hasn&apos;t got the one you picked (the name wasn&apos;t asked, the tent was skipped) shows its order number instead.</li>
              <li><strong>Under it</strong>: tap the small lines to show, in this order: Order number, Tent number (or Table number), Customer name, Order type. The big one isn&apos;t repeated, and a line the order hasn&apos;t got is left out. With a tent big, the screen also says to put it on the table; with tents, the &ldquo;we&apos;ll call your number&rdquo; line isn&apos;t shown (the food comes to the table).</li>
              <li><strong>Message</strong>: words of your own under the rest, e.g. where to collect a takeaway. Translate them on Menus → Translations.</li>
              <li><strong>Each order type</strong>: every order type the preview&apos;s revenue stream offers is listed with what that stream asks its guests (a name, a tent or table number: not asked, asked, or must be given; set in Store tech → Revenue streams). When the screen would show something the type&apos;s guests are never asked for, an amber note says so (the name, say, for a type that doesn&apos;t ask for one), and what shows instead. Turn on <strong>Its own way</strong> to give a type its own big value, lines or message; anything left <em>As for every type</em> follows the settings above it. <strong>Show</strong> puts an example order of that type on the preview (a name and a tent only where the type asks for them) and keeps it there while you change things; <strong>Order done</strong> above the preview does the same for the first type.</li>
              <li><strong>Receipts</strong>: printed on the kiosk&apos;s receipt printer (none, the guest can print one, or always); a <strong>QR code</strong> the guest scans with their phone to see the receipt; and <strong>Email the receipt</strong>, where the guest types their email address on the kiosk&apos;s keyboard. Paid by card, the receipt goes straight away; paying at the counter, it goes as soon as the till takes payment (the kiosk tells the guest so).</li>
              <li><strong>Shows for</strong>: how long the screen stays before the start screen comes back (5 to 120 seconds). It waits while a guest types an email address.</li>
            </ul>
            <P>
              The receipt page (the QR code&apos;s link) shows the order as the kiosk receipt design prints it
              (Store tech → Printing), with a button to print it or save it as a PDF. It works for a year. An order
              paid at the counter shows as a bill marked &ldquo;Not paid yet&rdquo; until it is paid at the till,
              then as the receipt. Emails are sent through the location&apos;s own email settings (Emails →
              Settings), up to three times an order. The email address isn&apos;t kept: the kiosk shows it back
              as its first letter and its domain (s***@gmail.com), and that&apos;s all that is noted. Nothing a guest
              types is recorded with their visit for Kiosk analytics either.
            </P>
            <P>
              For an order paid at the counter, the address is held locked away (encrypted) only until the till
              takes payment, and the receipt goes within a minute of that; then the address is forgotten like any
              other. Nothing is sent, and the address is dropped, if the order is cancelled at the till (every dish
              taken off), if nobody pays it within a day, or if the location&apos;s email provider keeps refusing it
              (it is tried a few times, a few minutes apart). An unpaid bill is never emailed.
            </P>

            <H3>Bottom bar and side menu colours</H3>
            <P>
              The bar along the bottom (Start again, the order&apos;s total, View order, and Back where a screen has
              one) and the sections down the side of the menu have colours of their own in the design&apos;s
              <strong> Brand</strong> card, under the main colours: <strong>Bottom bar</strong>,
              <strong> Bottom bar text</strong>, <strong>Side menu</strong> and <strong>Side menu text</strong>.
              Until you set them they follow the colours above, as before: the bottom bar in the Text colour and the
              side menu in the Cards colour. Their words say <em>Automatic</em> until you set them: whichever of the
              Page and Text colours reads better on that bar, so picking a bar colour on its own is enough. Each
              colour box shows the colour in use; <strong>Reset</strong> (or clearing the code) makes a colour follow
              again. The preview changes as you go; Save keeps it.
            </P>
            <ul className="list-disc list-inside text-sm text-muted-foreground ml-2 mb-4 space-y-1">
              <li>The bottom bar colour is on every bottom bar: the menu, the order, the name and table number, paying and the allergens screen. A dish&apos;s own page keeps its bar in the Cards colour.</li>
              <li>Back on a bottom bar is solid in the bar&apos;s words colour with the bar&apos;s colour for its words; Start again and the other buttons on the bar are outlined in the words colour. View order keeps the Highlights colour.</li>
              <li>The section picked down the side gets a tint of the Buttons colour on the side menu&apos;s own colour.</li>
              <li>A pair that is hard to read (red words on a red bar, say) is pointed out under the colours.</li>
              <li>Picking a colour set (Fresh, Night and the others) or a theme from the theme maker starts the bottom bar and side menu colours over: they follow the new colours.</li>
              <li>A design without a side menu (Menu card, Sections down the side: None) keeps its side menu colours but doesn&apos;t show them.</li>
            </ul>

            <H3>Fitting pictures: banners, featured tiles, start and reach pictures</H3>
            <P>
              Every home page banner and featured tile picture, every start screen picture or video and every reach
              picture has a <strong>Fit</strong> under it in the design editor. It says how the picture fills its
              space. Tap it to open the choices; the preview changes as you go, and Save keeps it.
            </P>
            <DataTable
              head={['Fit', 'What it does']}
              rows={[
                ['Automatic (the usual)', 'A photo fills the space; a picture with a see-through background (a cut-out PNG logo) shows whole, nothing cropped.'],
                ['Fill', 'Fills the space and crops what doesn\'t fit. Keep in view picks the part that must show: the top of a photo, its bottom right corner and so on.'],
                ['Whole picture', 'Shows all of it, nothing cropped. Place it picks where it sits (a corner, a side or the middle), Size how big it is (30 to 100% of the space) and Behind it the colour round it: none (the page shows through), or the design\'s Cards, Brand, Highlights or Text colour.'],
              ]}
            />
            <P>
              <strong>Banner shape</strong> (Menu card, once there is a banner) sets the shape of every banner:
              Wide (16 by 7, as before), Short (3 by 1, so more of the menu shows below), Tall (16 by 9) or
              <strong> Picture&apos;s own shape</strong> (each banner as wide and high as its own picture, so a
              logo or a poster fits without cropping; banners of different shapes change height as they take
              turns). A banner is never more than about a third of the screen high, so on a wide kiosk the banner
              is often that height whatever its shape, and the Fit decides how the picture sits in it.
            </P>
            <InfoBox type="tip">
              A logo cut short at the bottom of a banner: pick <strong>Whole picture</strong>, or
              <strong> Picture&apos;s own shape</strong> for the banner, and a colour behind it if the logo&apos;s
              background is see-through.
            </InfoBox>

            <H3>Dishes with no price</H3>
            <P>
              The kiosk leaves off its menu any dish it can't price: one with no price of its own and no option with a
              price to choose (for example 12 Wings with the price left empty and flavours that don't cost anything).
              The design editor says which dishes those are, above the preview. Set a price on the Menus page and
              publish the menu to put them on the kiosk. A dish like that can still be part of a meal deal, which has
              its own price. If a banner, featured tile or "Anything else?" still points at one, its page says it can't
              be ordered on the kiosk and asks the guest to order at the counter.
            </P>

            <H3>Sharing a preview</H3>
            <P>
              <strong>Share</strong> in the design editor's top bar makes a link to this design that anyone can open,
              with no sign-in: send it to a brand team, a franchise partner or a designer. It opens the kiosk at the
              size of the screen the design is made for, scaled to fit their screen, with <strong>Upright</strong>, <strong>Wide</strong>,{' '}
              <strong>Start again</strong> and <strong>Full screen</strong> (for trying it on a tablet). They see the
              design as saved, with the menu and prices of the location you pick (and, where a location has more than
              one, the revenue stream it orders as). Nothing is ordered or paid. The page around the kiosk says so
              (as the design editor does above its preview); opened on its own with Full screen, a thin dark band
              along the top of the kiosk says <em>Preview: orders aren&apos;t sent</em>, with the kiosk just below it,
              so it never covers a price or a button.
            </P>
            <ul className="list-disc ml-5 space-y-2 text-sm text-muted-foreground mb-4">
              <li><strong>Copy link</strong>, <strong>Open</strong>, or the QR code for someone holding a phone or tablet. The dialog shows how many times the link was opened.</li>
              <li>Each design has one link. Saving the design updates what the link shows; changes you haven't saved aren't in it.</li>
              <li><strong>Menu</strong>: the published menu (what the kiosks show), or the menu with unpublished changes, to show a new menu before it goes live. The changes show on the link as soon as they are saved on the Menus page, unfinished ones too, and the page tells whoever opens it that it includes changes not published yet.</li>
              <li><strong>Works until</strong> gives the link an end date (leave it empty for none). <strong>New link</strong> stops the old one for everyone and makes another; <strong>Stop sharing</strong> stops it.</li>
              <li>Making, moving and stopping a link needs Manage on Store tech. Shared designs are marked <strong>Preview shared</strong> in Store tech → Kiosks.</li>
            </ul>

            <H3>How choices show (Menus)</H3>
            <ul className="list-disc ml-5 space-y-2 text-sm text-muted-foreground mb-4">
              <li><strong>Display name</strong> (Menus → Variant groups, open a group): what guests see as the group's heading (kiosks, online ordering, the website, printed menus, menu screens) and the tills, such as Choose your flavours for a group you call Flavour x2 (copy). Empty: the group name. The group name stays for telling groups apart on the Menus pages. A dish's group headings change once its menu is published; translate the display name on Menus → Translations.</li>
              <li><strong>Menus → Variant groups</strong>, open a group, <strong>Self-order kiosk</strong>: how its options show (grid, list, slider, spin wheel, or as the design says) and the words at the two ends of a scale (No spice ... Very spicy).</li>
              <li>A group can have its own look on every kiosk there too: <strong>Picture style</strong> (Cards, Round, Oval, Hexagons, No frame), <strong>Pictures or words</strong> (With pictures, Words only) and <strong>When the options appear</strong> (Just there, Fade in, Slide in from the side, Bubble up, Deal like cards). Each is <strong>As the kiosk design says</strong> until you pick one, so the flavours can come in as a honeycomb that bubbles up while the dips stay small round pictures. It works straight away (no publishing), and a small picture of a pick in the corner of the dish's photo takes the group's picture style too.</li>
              <li>A kiosk design can change that again for its own kiosks: <strong>Choices → Option groups with their own look</strong> in the kiosk design (Store tech → Kiosks, edit a design). <strong>Add an option group</strong>, then for each: <strong>Shown as</strong>, <strong>Pictures</strong>, <strong>Words</strong> and <strong>Coming in</strong>. Each starts on its default, which says what the guest gets without it: <strong>Group: ...</strong> when the group picked one, else <strong>Design: ...</strong> (the design's settings for every choice). Pick another and the design shows the group that way, whatever the group says; the cross takes the group off the list. So the order is: the design's look for the group, then the group's own, then the design's for every choice, each part on its own. Combo steps aren't option groups: they keep the design's look (and their own Shown as).</li>
              <li>Each option can have two <strong>pictures</strong> (tap a square, or drop a picture on it): <strong>Tile</strong>, shown on the choice itself (a cut-out PNG works well), and <strong>On dish</strong>, shown on or in place of the dish's photo when the group has Split photo on (for example the wings made in that flavour). An option with no On dish picture uses its Tile picture there. Each option can also have a <strong>line of words</strong> under its name, and a <strong>level</strong> from 0 to 5 (shown as flames, and as the slider's scale). Drag options by their grip to change their order.</li>
              <li>A combo's steps (<strong>Edit steps</strong>) each have <strong>On a kiosk, the choices show as</strong>. A new choice typed in for a combo can have a picture and words too; a dish shows its own photo and description.</li>
              <li><strong>Picks on the dish's photo</strong> (on each variant group, and on each combo step): <strong>No</strong>, <strong>Split the photo</strong> or <strong>Small in the corner</strong>. The picks' pictures show on the dish's photo as the guest picks, on the dish page and on the order line. Each group decides, so 10 Wings can split its photo between the two flavours picked and show the dip small in the corner. <strong>Split the photo</strong>: one pick's picture takes the photo's place; two or more show side by side with a torn edge between them (three picks show the left third of the first picture, the middle of the second and the right third of the third). <strong>Small in the corner</strong>: each pick's picture small in the photo's bottom corner, on top of the photo (split or not), in the choices' picture style. <strong>Size in the corner</strong> (under it) sets how big: <strong>Automatic</strong> (about a quarter of the photo's width, smaller when several picks share the corner) or <strong>Set a size</strong>, from 10% to 70% of the photo's width with the slider or the - and + buttons; the small sketch shows the photo with the picture at that size. Each group and step has its own size, so the dip can be small while the drink is bigger; when the pictures don't fit side by side they shrink together. It uses each option's <strong>On dish</strong> picture (its Tile picture when it has none); on a combo step, each choice's <strong>On meal</strong> picture (else a typed-in choice's Tile picture, or a dish's own photo). Give every option an On dish picture of the same dish made that way, taken the same way, so the parts line up. A variant group's setting and pictures work straight away; a combo step's need the menu published.</li>
              <li><strong>Pictures with a see-through background</strong> (a PNG or WebP of a cut-out dip pot, burger or bottle): the kiosk notices the see-through parts by itself and shows the picture whole, with nothing behind it, wherever it appears (dishes, choices, section tiles, the rail, the bundle's picked steps). In the dish photo's corner such a pick has no round badge or ring round it, just a soft shadow under its outline, so it looks as if it sits on the photo. Pictures without see-through parts (photos, JPEGs) keep the frame, the background and the badge. Nothing to switch on: save the picture with a transparent background.</li>
            </ul>

            <H3>What guests see</H3>
            <ul className="list-disc ml-5 space-y-2 text-sm text-muted-foreground mb-4">
              <li>The start screen: flags for the languages, Staying or going? (or Start your order with one order type), and the Allergens button (see below).</li>
              <li>The menu: sections down the side (or a page of section tiles), the home page, dishes as cards, round or oval photos, or hexagons (choices can have a different style from the dishes). A dish with nothing to choose can be added with its + straight away.</li>
              <li>Back is always a solid button at the bottom left, beside the main button (Add, Continue, Checkout), never at the top. In a combo it goes one step back, and out of the combo from its first step. On the order page it is Add more. In a section opened from the tiles page it goes back to the tiles.</li>
              <li>Start again sits in the bottom bar after Back (on the menu, the order page, the name and tent number, and How to pay), and asks first when the order has something in it. With the bar along the top off, the language button is in the bottom bar too.</li>
              <li>A dish: its choices shown the way you set; the Add button points at anything still to choose. A combo goes step by step, with its allergens shown for what was picked: each step's name sits right above its choices (the name says what to pick, so there is no Choose 1 line; a step taking more than one shows 1/2 beside it), <strong>Step 2 of 5</strong> shows beside Continue at the button's size, and the steps along the top (down the side on a wide screen) show each done step's pick as its picture with its name under it. Every page of a deal has the big picture a dish's page has, as <strong>Top of a dish's page</strong> says: the deal's picture (see A meal deal's picture) and words on its steps and last page, and on a picked dish's own options page that dish's photo, description, calories and allergens with <em>In Burger meal</em> under its name; on a wide screen it is the column down the side, above the steps. The running price shows once: in the bar along the top, or with the bar off in the deal's picture block (above a picked dish's page as a line with the deal's name).</li>
              <li><strong>A meal deal's picture</strong> (Layout: <strong>Build a meal deal's picture from the picks</strong>, on unless you turn it off): until the first pick, the deal's own photo; then the picture is put together from the picks, like a photo of the meal. The first step's pick stands big in the middle (wings, split by their flavours once picked) and stays there, and the other steps' picks stand beside it in the order picked: the first on the left, the second on the right, the third further left, the fourth further right, each smaller and a little further back. Steps set to <em>Small in the corner</em> (dips, sauces) stand in front of it, in the order picked. Each new pick pops in and the others slide over to make room. On a picked dish's own options page (its flavours) the big picture is that dish; when it's done, the meal's picture comes back with the dish popping in with its flavours. A choice's picture for the meal (On meal in the combo editor) is used when it has one, else the dish's photo or the typed-in choice's own picture; a choice with no picture is left out. Cut-out pictures (PNGs on a see-through background) look best: they stand in the picture as they are, while ordinary photos get a small frame. The order shows the meal the same way. On a wide screen the picture stays at the top of the side column while the steps scroll under it. Turned off: the deal's own photo, with each step's picks on it as the step says.</li>
              <li><strong>Adding to the order</strong> (Layout: <strong>The picture flies into the order</strong>, on unless you turn it off): when a guest taps Add to order, the dish&apos;s big picture (a meal deal&apos;s picture as it was put together) zooms out and flies into the order button at the bottom, which bounces as it lands. The same happens with + on the menu and with a dish added from "Anything else?" on the order page (it flies into Checkout). Changing a dish from the order (Update order) doesn&apos;t fly. Turned off, or on a screen set to reduce motion, the order button only bounces.</li>
              <li>The order page: change or take off dishes, "Anything else?", then the name or tent number if the stream asks, then pay. The order number shows at the end (with a receipt to print if you allow it).</li>
              <li><strong>Tents</strong>: keep numbered tents (table stands) on a stand beside the kiosk or till. For an order type whose revenue stream asks for a tent, the kiosk says "Your tent number" and "Take a numbered tent from the stand", and the order number screen says "Put tent 12 on your table: we'll bring your order to you." The tent number goes to the kitchen screens, kitchen tickets and the order ready board. If your guests sit down first and type the number on their table instead, set <strong>Number to type</strong> to <em>Table number</em> in the design's Paying panel.</li>
              <li>Nobody tapping for a while: "Still there?", then the kiosk starts again. The reach button brings everything down to the lower half of the screen; the top shows the design's reach pictures or videos if it has any, with a button at their foot to move the screen back up. A dish marked sold out on the till greys out on the kiosk straight away.</li>
              <li><strong>Paying by card</strong>: the kiosk sends the order&apos;s total to its card machine and waits ("Follow the instructions on the card reader"). Once the machine approves, the order goes to the till and the kitchen. Declined: Try again, or pay at the counter if the design allows it. Back from the card step cancels the payment on the machine. On a test card machine (and in previews) Approve and Decline buttons stand in for the card.</li>
              <li>Without the internet the kiosk stops taking new orders. A card order already paid when the internet goes is kept on the kiosk and sent when it's back; the guest gets the order number straight away (the kiosk numbers its own orders) to show at the counter.</li>
              <li>The kiosk notices a lost connection within seconds (within about half a minute when the shop's router loses the internet but the Wi-Fi stays up). It tries twice more straight away, so a short blip doesn't pause ordering; only then does the start screen say ordering is paused. It then tries every few seconds and opens ordering again as soon as it gets through.</li>
              <li>Every picture on the menu (dishes, sections, choices, banners, the logo) is kept on the kiosk after each menu change, and so are the design&apos;s videos (start screen and reach band), so the kiosk opens with its menu, pictures and videos straight away and a guest already ordering when the internet goes still sees them all. A video the design stops playing is deleted from the kiosk.</li>
              <li>The kiosk checks for prices and sold out dishes every 30 seconds and for the whole menu and design every 3 minutes (Store tech, Device updates, can change both), as well as hearing about changes straight away (see Keeping tablets up to date in Android app).</li>
              <li>The staff panel (five quick taps in the top-left corner of the start screen) shows the connection (Online, Checking or Offline), how many of the menu&apos;s pictures and the design&apos;s videos are saved on the kiosk, and when it last checked prices and sold out and the whole menu.</li>
            </ul>

            <H3>Allergens and diets on the kiosk</H3>
            <ul className="list-disc ml-5 space-y-2 text-sm text-muted-foreground mb-4">
              <li>The <strong>Allergens</strong> button on the start screen (switch it off in the design's Start screen panel) opens a screen with your allergen notice at the top, then <strong>Allergens to avoid</strong> (the 14, plus any of your own) and <strong>Dietary choices</strong> (the diets your kiosk's dishes carry, such as Vegan) as big tick boxes. The notice's words are the ones on <strong>Menus → Allergens &amp; dietary</strong> (Allergen notice card), in the guest's language from Menus → Translations.</li>
              <li>As the guest ticks, the screen says how many dishes suit them: "12 of 40 dishes suit you" (sold out dishes aren't counted), or that none do and to ask your staff. It doesn't list the dishes.</li>
              <li><strong>See the menu</strong> asks Staying or going? when there is more than one order type, then opens the menu with the picks kept for the whole order. Start again (or the kiosk timing out) clears them.</li>
              <li>On the menu, a strip at the top says what is being marked and how many dishes suit, with <strong>Change</strong> back to the allergens screen. A dish to check gets a yellow <strong>!</strong> mark (and a yellow edge on cards), with why under its name and the guest's allergens highlighted: <em>Contains: Milk</em>, <em>May contain: Nuts</em>, <em>Can be removed: Eggs</em> (it still suits: the guest asks for it without), <em>Not marked: Vegan</em>. Dishes that suit have no mark. On hexagons only the mark shows.</li>
              <li>A meal deal suits when every step the guest must pick from has a choice that suits (a choice you typed in for the combo has no allergens listed, so it never counts as vegan). If it suits but some of its choices have the allergens, it says <em>Some choices contain: Milk</em>, and inside the deal each choice to check carries the same mark and words.</li>
              <li>On a dish's page the guest's allergens are highlighted in the allergen line, with a yellow box saying what to check.</li>
              <li>This only reads the allergens and diets set on your dishes (Menus, Allergen matrix): a dish with none set counts as having none. Guests with an allergy are still told to speak to your staff.</li>
            </ul>

            <H3>Translations (Menus → Translations)</H3>
            <P>
              Every word a kiosk can show is listed by group (sections, dishes, combos, options, order types,
              allergens, the allergen notice, words typed in kiosk designs, the kiosk's own words) next to its
              translation in the language you pick. Type and press <strong>Save</strong>; empty a box to take a
              translation off. The kiosk's own words and the 14 allergens already come in every language (shown
              faintly in the box); type only to change them. <strong>Suggest the missing ones</strong> asks
              the AI for a first draft of everything missing: suggestions are marked <strong>Check</strong>,
              and nothing is kept until you Save.
            </P>
            <P>
              Kiosk orders show in Till reports with the kiosk's name as the server. How guests use the kiosk
              (what they look at, where they give up, every visit played back) is on <strong>Kiosk analytics</strong>{' '}
              (next section).
            </P>
          </section>

          {/* ── KIOSK ANALYTICS ─────────────────────────────── */}
          <section id="kiosk-analytics" data-help="">
            <H2>Kiosk analytics</H2>
            <P>
              Every kiosk records each guest&apos;s visit as it happens: which screens they saw and for how long, every
              dish they opened, what they picked and changed, what they took out of the order, where they touched
              (including touches on things that don&apos;t answer), and how the visit ended. <strong>Store tech → Kiosk
              analytics</strong> sums the visits up and plays any visit back, step by step, on the kiosk itself. It needs
              Till reports (View); operators have it, viewers don&apos;t.
            </P>
            <InfoBox type="info">
              Nothing a guest types is recorded: a name or tent number is kept only as how many letters it had (it plays
              back as dots), and touches on the kiosk&apos;s keyboard and number pad are recorded at the keyboard&apos;s
              middle, not on the key. Visits aren&apos;t linked to a card, a customer or a person.
            </InfoBox>

            <H3>What counts as a visit</H3>
            <ul className="list-disc ml-5 space-y-2 text-sm text-muted-foreground mb-4">
              <li>A visit starts with the first touch on the start screen and ends when the kiosk goes back to it: after the order number screen, <strong>Start again</strong>, the &quot;Still there?&quot; timeout, or 45 seconds without a touch on the start screen (a guest who touched and walked away).</li>
              <li>How it ended: <strong>Ordered</strong>, <strong>Started again</strong>, <strong>Timed out</strong>, <strong>Walked away</strong>, or <strong>Cut short</strong> (the kiosk was reloaded, switched off or updated mid-visit; the visit is kept up to that point).</li>
              <li>The kiosk sends finished visits within a minute, and keeps them while it is offline (up to about 40) to send when it is back. Previews, shared preview links and the design editor are never recorded.</li>
              <li>To stop a design&apos;s kiosks recording, switch off <strong>Record guests&apos; visits</strong> in the design&apos;s <strong>Timing and access</strong> panel (on unless you turn it off).</li>
            </ul>

            <H3>The analytics overview</H3>
            <P>
              Pick <strong>Today</strong>, <strong>7 days</strong>, <strong>30 days</strong> or your own days (up to 92),
              and optionally one kiosk or one design. Days follow the venue&apos;s time.
            </P>
            <ul className="list-disc ml-5 space-y-2 text-sm text-muted-foreground mb-4">
              <li><strong>Tiles</strong>: visits, how many ordered (and the share of visits), orders taken and the average order, how long ordering takes, visits that gave up with something in the order (and what was left in it), touches per visit (and the share on things that don&apos;t answer: a button that looks tappable but isn&apos;t), and how many used the allergens screen and the reach button.</li>
              <li><strong>How far guests got</strong>: touched the screen, opened the menu, opened a dish, added to the order, looked at the order, name or number, paying, ordered. The biggest drop shows where guests stop.</li>
              <li><strong>How visits ended</strong>, and for those that gave up, the screen they were on last.</li>
              <li><strong>Time on each screen</strong>: the average time on the start screen, the menu, choosing a dish (a dish&apos;s page or a meal deal&apos;s steps), the order, paying and so on, over the visits that saw it.</li>
              <li><strong>Changes of mind</strong>: started again, timed out, dishes opened and left without adding, dishes taken out of the order, &quot;Start again?&quot; asked and how often the guest kept ordering, &quot;Still there?&quot; asked and answered, cards declined, card machine not available.</li>
              <li><strong>Dishes</strong>: per dish, how often it was opened, how long guests looked at it, how often it was added (and how many), taken out, or left without adding. A dish opened often and rarely added is worth a look (its picture, its price, its options).</li>
              <li><strong>By hour</strong> (visits and orders) and <strong>By kiosk</strong>.</li>
            </ul>

            <H3>Playing a visit back</H3>
            <P>
              The <strong>Visits</strong> tab lists visits newest first, with the kiosk, how it ended, how long it took,
              the order (or what was left in it) and the touches; filter by how it ended. Tap a visit to play it back: the
              kiosk is shown as the guest saw it (with the design and menu), each touch as a ring where the finger landed
              (red: a touch on nothing that answers), scrolling put back where the guest scrolled.
            </P>
            <ul className="list-disc ml-5 space-y-2 text-sm text-muted-foreground mb-4">
              <li><strong>Play</strong> / <strong>Pause</strong>, the slider to jump to any moment, step back and forward, speeds 1x to 8x, and <strong>Skip long pauses</strong> (on unless you untick it: a pause of more than a couple of seconds plays as a short one).</li>
              <li>The <strong>Steps</strong> list says what happened in words (&quot;Opened Wings&quot;, &quot;Touched Lemon pepper&quot;, &quot;Added 2 x Wings&quot;, &quot;Removed Fries&quot;, &quot;Left Burger without adding it&quot;, &quot;Touched nothing that answers&quot;, &quot;Typed on the keyboard&quot;), with the time and how long the guest stayed on each step. Tap a step to jump there.</li>
              <li><strong>This visit</strong> sums it up: how it ended, the order, dishes added, when the first dish was added, touches, the language.</li>
              <li>The playback uses the design and the menu as they are now: a note says when the design has changed since the visit (or was deleted: the kiosk&apos;s design now is used). Dishes and prices show as the menu is now: a dish taken off the menu since doesn&apos;t show in the playback (a note under it says so), but the steps still name it.</li>
              <li>The playback can&apos;t be touched and never sends anything. Visits are played back for 90 days; after that only their summary (in the list and the overview) is kept, for 400 days.</li>
            </ul>
          </section>

          {/* ── INSTALLER APP ───────────────────────────────── */}
          <section id="installer" data-help="">
            <H2>Installer app</H2>
            <P>
              The installer is a phone app for setting up a venue&apos;s devices while you stand next to them:
              tills, kitchen screens, self-order kiosks and menu screens. Open{' '}
              <strong>installer.macaroonie.com</strong> on your phone and sign in as usual. In Chrome choose{' '}
              <strong>Install app</strong> (on an iPhone, Share then <strong>Add to Home Screen</strong>) so it
              opens like an app. It shows what you can see in Store tech (tills, kitchen screens, kiosks) and
              Menu screens; linking and changing devices needs Manage on them.
            </P>

            <H3>Linking a device</H3>
            <ol className="list-decimal ml-5 space-y-2 text-sm text-muted-foreground mb-4">
              <li>On the device, open its address in Chrome: <strong>pos.macaroonie.com</strong> for a till, <strong>kitchen.macaroonie.com</strong> for a kitchen screen, <strong>kiosk.macaroonie.com</strong> for a kiosk, <strong>screens.macaroonie.com</strong> for a menu screen. It shows a six-letter code and a QR code.</li>
              <li>Scan the QR code with your phone&apos;s camera. It opens the installer on that code. (In the installer, <strong>Link a device showing a code</strong> lets you type the code instead, or scan it with <strong>Scan the QR code</strong> where the phone offers it.)</li>
              <li>Check the venue at the top (<strong>Change</strong> picks another). For a new device, give it a name and, for a kitchen screen, tick the stations it shows; for a menu screen, pick the board or playlist. To put the code on one already set up (it keeps its name and settings), choose <strong>One already here</strong> and pick it: one that isn&apos;t linked is picked for you, and removed ones are at the bottom of the list.</li>
              <li>Tap <strong>Link</strong>. The device sets itself up within a few seconds.</li>
            </ol>
            <P>
              The code is for the kind of device it was shown on: a code from the kitchen screen address can only
              become a kitchen screen. Codes change every 15 minutes until they&apos;re used, and work once.
            </P>

            <H3>Adding a new device</H3>
            <P>
              <strong>Add a new device</strong> asks what it is, then shows its address (with a QR code a device
              with a camera can scan to open it). Open it on the device and link the code it shows. That is the
              only way a device is set up, here and in Store tech: devices never take a code typed into them.
            </P>

            <H3>A device&apos;s page</H3>
            <P>
              The home page lists every till, kitchen screen, kiosk and menu screen at the venue with its state:{' '}
              <strong>Online</strong>, <strong>Offline</strong> or <strong>Not linked</strong>. Tap one to change its name and settings (then Save), to show a menu
              screen&apos;s name on it (<strong>Show its name on the screen</strong>) or reload it, to move it
              to a new device, or to remove it.
            </P>
            <P>
              <strong>Move it to a new device</strong> is for a broken or replaced tablet or TV: link the new
              device&apos;s code and it takes this device&apos;s name and settings;
              the old one stops working.
            </P>
            <InfoBox type="info">
              The installer only links and sets up devices. Everything else (stations and the kitchen flow, kiosk
              designs, boards and playlists, printers) is set up in Store tech and on the Screens page.
            </InfoBox>
          </section>

          <section id="android-app" data-help="">
            <H2>Android app</H2>
            <P>
              The <strong>Macaroonie</strong> Android app runs a till, a kitchen screen, a self-order kiosk or a
              menu screen on an Android tablet, TV box or smart TV. It opens the same apps as Chrome does at pos.,
              kitchen., kiosk. and screens.macaroonie.com, but straight away and full screen: no address bar, no Android bars at the top or bottom, the screen
              stays on and the back button does nothing, so staff and guests can&apos;t leave it by accident. The
              apps inside it update themselves like the web pages do; the app itself rarely needs updating.
            </P>

            <H3>Getting the app on a tablet</H3>
            <P>
              On the tablet, open Chrome at pos.macaroonie.com, kitchen.macaroonie.com or kiosk.macaroonie.com
              (any of the three). The setup screen has a <strong>Get the Android app</strong> button: tap it, and
              when the file has downloaded open it and tap <strong>Install</strong>. Android may ask you to allow
              installing apps from Chrome first. You can also type the address with /android on the end (for
              example kiosk.macaroonie.com/android) to download it straight away. On a computer the setup screen
              shows that address as a link (it downloads the file there too): type it on the Android device. The
              button only shows once Macaroonie has added
              the app, and never inside the app itself.
            </P>

            <H3>Setting up a tablet with the app</H3>
            <ol className="list-decimal ml-5 space-y-2 text-sm text-muted-foreground mb-4">
              <li>Install the app on the tablet (above).</li>
              <li>Open it and pick what the tablet is: <strong>Till</strong>, <strong>Kitchen screen</strong>, <strong>Self-order kiosk</strong> or <strong>Menu screen</strong>.</li>
              <li>It shows a six-letter code and a QR code. Link it as any other device: scan the QR code with your phone (the installer app), or type the code in Store tech (<strong>Add a till</strong>, <strong>Add a screen</strong>, <strong>Add a kiosk</strong>) or, for a menu screen, on the Screens page (<strong>Add screen</strong>).</li>
              <li>From then on the tablet opens that app every time it starts.</li>
            </ol>

            <H3>Keeping tablets up to date</H3>
            <P>
              Each till, kitchen screen and kiosk keeps its menu, prices and settings on the tablet, so it opens
              with them straight away, with the internet down too. A kiosk also keeps every picture on its menu
              and its design&apos;s videos. Changes reach the tablets in two ways:
            </P>
            <ul className="list-disc ml-5 space-y-2 text-sm text-muted-foreground mb-4">
              <li><strong>Straight away</strong>: the tablet is told as soon as you save something it shows (a menu published, a dish sold out, a setting in Store tech).</li>
              <li><strong>By checking</strong>, in case it missed being told: as standard, tills and kiosks check prices and sold out dishes every 30 seconds, every tablet checks its whole menu and settings every 3 minutes, and menu screens check their boards every minute. How often is yours to choose per location: Store tech, <strong>Device updates</strong> (see <a href="#device-updates" className="underline">Device updates</a>). A dish sold out changes on the tablet straight away; new prices (a menu published, a publish you scheduled going live, an option or a promotion changed) download the menu again.</li>
            </ul>
            <P>
              A till&apos;s settings show when it last checked (<strong>Prices and sold out checked</strong>,{' '}
              <strong>Whole menu checked</strong>) and how often it checks; on a kiosk, the staff panel&apos;s{' '}
              <strong>Last checked</strong> and <strong>Checks for changes</strong>; on a menu screen, its settings
              panel.
            </P>

            <H3>Changing what a tablet is</H3>
            <P>
              Tap the <strong>top left corner</strong> of the screen five times quickly (within three seconds).
              The app shows <strong>What is this device?</strong> over the till, kitchen screen or kiosk, which
              keeps running underneath. Pick another type, or press <strong>Back to the till</strong> (nothing
              reloads) or <strong>Reload the till</strong> when it seems stuck. Opened this way it goes back by
              itself after a minute nobody touches it, so a kiosk is never left on it. The taps also reach
              whatever sits in that corner (the venue name, the first tab), which does no harm.
            </P>
            <P>
              Each type keeps its own link to the restaurant. A kiosk switched to a till and back is still the
              same kiosk, still linked; while the tablet shows another type, Store tech shows the kiosk as
              offline. To stop a tablet being a kiosk for good, Disconnect it in its staff panel (or remove it
              in Store tech). A tablet that isn&apos;t linked yet also has <strong>Change device type</strong> on
              its setup screen, and if the app can&apos;t reach Macaroonie it says so, tries again every five
              seconds and offers <strong>Change device type</strong> too.
            </P>
            <InfoBox type="info">
              The corner works from version 1.1 of the app (shown under the choices on What is this device?).
              A tablet with version 1.0 needs the new download installed over it first. Menu screens need
              version 1.2.
            </InfoBox>

            <H3>Menu screens on a TV box or smart TV</H3>
            <P>
              Pick <strong>Menu screen</strong> to show menu boards and order ready boards (the boards and
              playlists you made on the Screens page). From version 1.2 the app shows on an Android TV&apos;s
              home screen too, so a TV box or a smart TV running Android TV can install it from the download
              like a tablet (sideloading: allow installing from the browser or file manager you use). With a
              remote, the arrows move between the choices on <strong>What is this device?</strong> and OK picks.
            </P>
            <P>
              A screen with no touch can&apos;t use the top left corner: press <strong>OK five times</strong> on
              the remote to open the screen&apos;s own settings, then <strong>Change device type</strong> (shown
              only inside the app). A screen not linked yet has <strong>Change device type</strong> under its
              code. Like in Chrome, a linked menu screen keeps its boards, pictures and videos and keeps showing
              them with the internet down.
            </P>

            <H3>Printing and the camera</H3>
            <P>
              Bills and receipts printed from the tablet go to Android&apos;s print service, which shows its print
              window: install your printer&apos;s Android print plugin (Epson, Star and others make one) to print
              to it. Ticket printers on the network or plugged into a mini PC are better on the venue hub (Store
              tech, Printers), which prints without asking. The first time the app scans a QR code (a loyalty
              card) Android asks to allow the camera.
            </P>
            <InfoBox type="info">
              To keep guests in the kiosk app, turn on Android&apos;s <strong>App pinning</strong> (Settings,
              Security) and pin the app, or use your device manager&apos;s kiosk mode.
            </InfoBox>

            <H3>Adding a new build of the app (platform admins)</H3>
            <P>
              The <strong>Platform</strong> page&apos;s <strong>Android app</strong> tab decides what the setup
              screens offer. After a build on expo.dev, open the Android internal distribution build, copy its
              Install or Download link (or the build page&apos;s own address) and paste it in, then press
              <strong> Copy and offer it</strong>. Macaroonie keeps its own copy of the app, so the download keeps
              working after Expo&apos;s link runs out. It must be an APK build: an app bundle for Google Play
              can&apos;t be installed this way and is refused. <strong>Stop offering it</strong> removes the copy
              and the button (tablets that have the app keep it). Tablets already running the app don&apos;t
              update by themselves: install the new download over the old one.
            </P>
          </section>

          {/* ── BOOKING EMAILS ──────────────────────────────── */}
          <section id="emails" data-help="">
            <H2>Booking Emails</H2>
            <P>
              Macaroonie automatically sends emails to guests when bookings are confirmed,
              modified, cancelled, or coming up soon. You can customise the templates, choose
              your email provider, and control what guests can do from the email link.
            </P>

            <H3>Getting started</H3>
            <ol className="list-decimal ml-5 space-y-2 text-sm text-muted-foreground mb-4">
              <li>Go to <strong>Emails</strong> in the sidebar (mail icon).</li>
              <li>
                Emails work <strong>out of the box</strong> with the built-in templates and
                your platform's SendGrid key. No setup needed for basic confirmation +
                reminder emails.
              </li>
              <li>
                To customise, switch to the <strong>Templates</strong> tab and edit the subject
                line or HTML body for each email type.
              </li>
              <li>
                To change provider or configure reminders, use the <strong>Settings</strong> tab.
              </li>
            </ol>

            <H3>The 3 tabs</H3>
            <DataTable
              head={['Tab', 'What it does']}
              rows={[
                ['Templates', 'Edit the subject and HTML body for each email type. Insert merge fields, preview with sample data, reset to the built-in default.'],
                ['Settings',  'Choose email provider (SendGrid, Mailgun, SES, SMTP), configure sender identity, reminder timing, and guest self-service permissions. Keys and passwords are stored encrypted and never shown again: a saved one shows as "Saved, ends 1a2b". Leave the box empty to keep it, type a new one to replace it, or press Remove (then Save) to take it off.'],
                ['Sent emails', 'Audit log of recent deliveries — see what was sent, when, to whom, and whether it succeeded or failed.'],
              ]}
            />

            <H3>Email types</H3>
            <DataTable
              head={['Type', 'When it sends', 'What it contains']}
              rows={[
                ['Confirmation', 'Immediately when a booking is confirmed (free or paid).', 'Booking details + a "View or manage your booking" button linking to the guest manage page.'],
                ['Reminder',     'Automatically, X hours before the booking (configurable per venue, default 24h).', 'Booking details + a reminder to contact the venue if they can\'t make it.'],
                ['Modification', 'When the guest modifies their booking (date, time, or covers) from the manage page.', 'Updated booking details.'],
                ['Cancellation', 'When the booking is cancelled (by the guest from the manage page, or by an operator).', 'Cancelled booking details.'],
              ]}
            />

            <H3>Merge fields</H3>
            <P>
              Templates use <Mono>{'{{field_name}}'}</Mono> placeholders that get replaced with
              real booking data when the email is sent. Click any field pill in the editor to
              insert it into the body.
            </P>
            <DataTable
              head={['Field', 'Example value']}
              rows={[
                ['{{guest_name}}',        'John Smith'],
                ['{{venue_name}}',        'Wingstop Covent Garden'],
                ['{{booking_date}}',      'Friday 15 May 2026'],
                ['{{booking_time}}',      '19:30'],
                ['{{booking_end_time}}',  '21:00'],
                ['{{covers}}',            '4'],
                ['{{table_label}}',       'T5'],
                ['{{booking_reference}}', 'WS-A3F2'],
                ['{{manage_link}}',       'Link to view/modify/cancel the booking'],
                ['{{guest_notes}}',       'Window seat please'],
                ['{{venue_address}}',     '42 Long Acre, London WC2E 9LG'],
                ['{{venue_phone}}',       '+44 20 7946 0958'],
              ]}
            />
            <InfoBox type="tip">
              The most important field is <Mono>{'{{manage_link}}'}</Mono> — this is the URL
              guests click to view, modify, or cancel their booking. Always include it in your
              confirmation and reminder templates.
            </InfoBox>

            <H3>Editing a template</H3>
            <ol className="list-decimal ml-5 space-y-2 text-sm text-muted-foreground mb-4">
              <li>Select the email type tab (Confirmation / Reminder / Modification / Cancellation).</li>
              <li>Edit the <strong>subject line</strong> — merge fields work here too.</li>
              <li>Edit the <strong>HTML body</strong>. Click merge field pills above the editor to insert them.</li>
              <li>Click <strong>Preview</strong> to see the email rendered with sample data in a preview panel.</li>
              <li>Click <strong>Save template</strong>.</li>
              <li>To go back to the built-in default, click <strong>Reset to default</strong> or <strong>Delete custom</strong>.</li>
            </ol>
            <InfoBox type="info">
              Templates are per-venue. Select the venue from the dropdown in the header bar.
              If a venue has no custom template, it uses the built-in default automatically.
            </InfoBox>

            <H3>Email providers</H3>
            <P>
              Each venue can use a different email provider. Configure it in the
              <strong> Settings</strong> tab.
            </P>
            <DataTable
              head={['Provider', 'Setup']}
              rows={[
                ['SendGrid (default)', 'Works out of the box with the platform API key. Optionally add a per-venue key for dedicated sending.'],
                ['Postmark',           'Recommended for transactional. Paste the Server API token from Postmark → Servers → your server → API Tokens. Strong deliverability, ~$15/10k emails, branded click tracking handled automatically (click.pstmrk.it with valid TLS).'],
                ['Mailgun',            'Requires an API key + Mailgun domain (e.g. mg.yourdomain.com) per venue. PICK THE REGION (US or EU) — EU accounts silently 401 if you leave it on US.'],
                ['AWS SES',            'Cheapest at scale. Uses AWS credentials + region. First-time use requires a one-off "production access" form to be approved by AWS (~24h).'],
                ['SMTP',               'Any SMTP server — Gmail, Outlook, self-hosted. Enter host, port, username, password.'],
              ]}
            />

            <H3>Sender identity</H3>
            <P>
              Set the <strong>From name</strong> (e.g. "Wingstop Covent Garden"),
              <strong> From email</strong> (must be verified with your provider), and an
              optional <strong>Reply-to</strong> address where guest replies land.
            </P>
            <InfoBox type="warn">
              If From email is not verified with your email provider, emails may be rejected
              or land in spam. Check your provider's domain verification docs.
            </InfoBox>

            <H3>Reminders</H3>
            <P>
              Reminders are sent automatically before each booking. Configure in Settings:
            </P>
            <ul className="list-disc ml-5 space-y-1.5 text-sm text-muted-foreground mb-4">
              <li><strong>Enabled / disabled</strong> — toggle per venue.</li>
              <li><strong>Hours before</strong> — slider from 1 to 72 hours (default 24h = 1 day before).</li>
              <li>Each booking gets at most one reminder (tracked by <Mono>reminder_sent_at</Mono>).</li>
              <li>If a booking is cancelled before the reminder fires, it's skipped automatically.</li>
            </ul>

            <H3>Guest manage page</H3>
            <P>
              Every confirmation and reminder email includes a <strong>"View or manage your
              booking"</strong> button. This links to a page at{' '}
              <Mono>macaroonie.com/manage/{'<token>'}</Mono> where the guest can:
            </P>
            <ul className="list-disc ml-5 space-y-1.5 text-sm text-muted-foreground mb-4">
              <li><strong>View</strong> their booking details (date, time, guests, table, status).</li>
              <li><strong>Modify</strong> the date, time, or number of guests (if allowed).</li>
              <li><strong>Cancel</strong> the booking with a double-confirmation (if allowed + within cutoff).</li>
            </ul>
            <P>
              The page is themed with the venue's brand colour and logo. No login is needed —
              the link itself authenticates the guest.
            </P>

            <H3>Guest permissions</H3>
            <P>Control what guests can do from their manage page. Set in Settings:</P>
            <DataTable
              head={['Setting', 'Default', 'What it does']}
              rows={[
                ['Allow guests to modify', 'On',  'Guests can change date, time, or covers.'],
                ['Allow guests to cancel', 'On',  'Guests can cancel their booking.'],
                ['Cancel cutoff (hours)',  '2h',   'Guests cannot cancel within this many hours of the booking. E.g. 2h = can\'t cancel less than 2 hours before.'],
              ]}
            />

            <H3>Sent emails log</H3>
            <P>
              The <strong>Sent emails</strong> tab shows the last 50 deliveries with:
              time, type, recipient, subject, and status. Statuses:
            </P>
            <DataTable
              head={['Status', 'Meaning']}
              rows={[
                ['Sent',    'Email delivered to the provider successfully.'],
                ['Queued',  'In the queue, waiting to be processed.'],
                ['Failed',  'Delivery failed — check the error message. The system will retry.'],
                ['Bounced', 'Email bounced (invalid address, full inbox, etc).'],
              ]}
            />

            <H3>Common issues</H3>
            <div className="space-y-2.5">
              <div className="space-y-1.5 border rounded-xl px-4 py-3">
                <p className="text-sm font-semibold">Guests aren't receiving emails</p>
                <p className="text-sm text-muted-foreground">
                  Check the <strong>Sent emails</strong> tab for failed deliveries. Common causes:
                  invalid SendGrid API key, unverified sender domain, or the guest's email is
                  incorrect. Walk-in bookings (<Mono>walkin@walkin.com</Mono>) are skipped automatically.
                </p>
              </div>
              <div className="space-y-1.5 border rounded-xl px-4 py-3">
                <p className="text-sm font-semibold">Reminder didn't send</p>
                <p className="text-sm text-muted-foreground">
                  Check that <strong>Reminders</strong> are enabled in Settings for this venue.
                  Also verify Redis is running — reminders use BullMQ delayed jobs. If the booking
                  was created less than the reminder window ago, the reminder hasn't fired yet.
                </p>
              </div>
              <div className="space-y-1.5 border rounded-xl px-4 py-3">
                <p className="text-sm font-semibold">Guest can't modify or cancel from the email link</p>
                <p className="text-sm text-muted-foreground">
                  Check <strong>Settings → Guest self-service</strong>. If "Allow guests to modify" or
                  "Allow guests to cancel" is off, those buttons won't appear on the manage page.
                  Also check the cancel cutoff — guests can't cancel within the cutoff window.
                </p>
              </div>
              <div className="space-y-1.5 border rounded-xl px-4 py-3">
                <p className="text-sm font-semibold">Emails going to spam</p>
                <p className="text-sm text-muted-foreground">
                  Make sure your sending domain has SPF, DKIM, and DMARC records configured with
                  your email provider. Use a professional From email (not a free Gmail/Yahoo address).
                  Check your provider's domain authentication docs.
                </p>
              </div>
              <div className="space-y-1.5 border rounded-xl px-4 py-3">
                <p className="text-sm font-semibold">Logo next to the sender in Gmail / Apple Mail</p>
                <p className="text-sm text-muted-foreground">
                  Inbox avatars use <strong>BIMI</strong>, not an image inside the email.
                  Go to <strong>Emails → Settings → Inbox logo</strong>, upload a square SVG
                  (solid background), then add the TXT record it shows at the DNS host for your
                  From domain. You also need DMARC at <Mono>p=quarantine</Mono> or <Mono>p=reject</Mono>.
                  Gmail and Apple Mail additionally require a Verified Mark Certificate (VMC)
                  from DigiCert or Entrust. Yahoo and Fastmail show the logo without a VMC.
                </p>
              </div>
            </div>
          </section>

          {/* ── TEAM MANAGEMENT ────────────────────────────── */}
          <section id="team" data-help="">
            <H2>Team Management</H2>
            <P>
              Manage who has access to your restaurant's admin portal. Invite team members,
              assign roles, and control what each person can see and do.
            </P>

            <H3>Roles</H3>
            <DataTable
              head={['Role', 'What they can do']}
              rows={[
                ['Owner',    'Full access. Manage team, billing, brand defaults, all settings. Can invite other owners.'],
                ['Admin',    'Manage venues, rules, website, emails, schedule. Cannot manage team or billing.'],
                ['Operator', 'Front-of-house. Manage bookings, view timeline, handle walk-ins.'],
                ['Viewer',   'Read-only access to bookings and timeline. Cannot make changes.'],
              ]}
            />

            <H3>Inviting a team member</H3>
            <ol className="list-decimal ml-5 space-y-2 text-sm text-muted-foreground mb-4">
              <li>Go to <strong>Team</strong> in the sidebar.</li>
              <li>Click <strong>Invite</strong> (top right). Only owners see this button.</li>
              <li>Enter the team member's email, optional full name, and choose a role.</li>
              <li>Click <strong>Send invite</strong>.</li>
              <li>
                The team member receives an email with a link to set their password and
                join your restaurant. Once they accept, they can log in straight away with the
                role you chose. Their row shows an "Invite pending" badge until they first log in.
              </li>
            </ol>
            <InfoBox type="info">
              You no longer need to touch the Auth0 dashboard — invitations, role changes,
              deactivation, and password resets are all handled here. (If you see an amber
              banner saying "Auth0 invitations not configured", ask your platform admin to
              fill in the Auth0 management credentials on the API.)
            </InfoBox>

            <H3>Changing a role</H3>
            <P>
              Owners can change any team member's role using the dropdown next to their name.
              The change takes effect immediately for in-app permissions. The next time the user
              signs in, their session also reflects the new role at the Auth0 level. You cannot
              change your own role.
            </P>

            <H3>Resetting a password</H3>
            <P>
              Click the <strong>key icon</strong> next to a member to send them a password reset
              email. They get a one-time link to set a new password — you never see or handle
              the password yourself. The icon turns green for a moment to confirm the email was
              sent.
            </P>

            <H3>Deactivating a member</H3>
            <P>
              Click the <strong>X</strong> button next to a member to deactivate them. They are
              immediately removed from your restaurant's Auth0 organisation, so even an existing
              login session can no longer access the admin portal. Their record is kept, and you
              can reactivate them later from the "Deactivated" section at the bottom — they
              will need to be re-invited so they get a fresh login link.
            </P>

            <H3>Switching between tenants</H3>
            <P>
              If you have access to multiple restaurant brands (tenants), a <strong>tenant
              switcher</strong> dropdown appears at the top of the sidebar. Selecting a different
              tenant logs you out and back in under that tenant's context.
            </P>

            <H3>Platform admins</H3>
            <P>
              Platform admins are Macaroonie staff who can manage all tenants. They see a
              <strong> Platform</strong> link at the bottom of the sidebar (shield icon) and
              can create, edit, and deactivate tenants from the platform dashboard. Platform
              admins bypass all role restrictions within any tenant.
            </P>
            <P>
              The platform dashboard's <strong>Registered interest</strong> tab lists everyone who filled in
              the form on macaroonie.com (newest first, with a count of new ones on the tab). Tap the email or
              phone to get in touch, set each one to <strong>New</strong>, <strong>Contacted</strong> or{' '}
              <strong>Closed</strong>, keep a note (with its own Save), or delete it (it asks first).{' '}
              <strong>Open</strong> hides closed ones; <strong>All</strong> shows everything.
            </P>

            <H3>Creating a new tenant (master franchisee)</H3>
            <ol className="list-decimal ml-5 space-y-2 text-sm text-muted-foreground mb-4">
              <li>Open <strong>Platform</strong> from the sidebar (platform admins only) and stay on its <strong>Tenants</strong> tab.</li>
              <li>Click <strong>+ New tenant</strong>.</li>
              <li>
                Enter the franchise name (e.g. "Wingstop UK"), a slug
                (lowercase, hyphenated — e.g. <code>wingstop-uk</code>), and pick a plan.
              </li>
              <li>
                Leave <strong>Auto-provision Auth0 organisation</strong> ticked (recommended).
                The API will create the Auth0 org, enable Username/Password + Google login,
                and turn on auto-membership — all the Auth0 dashboard work happens
                automatically.
              </li>
              <li>Click <strong>Create tenant</strong>. The tenant appears in the list immediately.</li>
              <li>
                Use the <strong>tenant switcher</strong> button in the top-left of the
                sidebar (opens a "Switch restaurant" picker) to enter the new tenant. Then go
                to <strong>Team</strong> and invite the franchise owner.
              </li>
            </ol>
            <InfoBox type="info">
              If auto-provisioning isn't available (the platform's Auth0 management
              credentials don't include the org-creation scopes) the form shows a warning
              and the Auth0 Org ID field becomes required — paste an org id you've
              created manually in the Auth0 dashboard.
            </InfoBox>
          </section>

          {/* ── ACCESS (modules + roles) ───────────────────── */}
          <section id="access" data-help="">
            <H2>Modules &amp; Roles</H2>
            <P>
              The <strong>Access</strong> page (sidebar, owner-only) controls two layers of
              access for your tenant: which features are turned on at all, and who can do
              what within them.
            </P>

            <H3>Modules tab — turn product areas on or off</H3>
            <P>
              Each toggle controls a group of related features. Disabling a group hides every
              nav entry it contains for everyone in your tenant — including owners — and the
              API rejects mutations on those routes. Easy to turn back on.
            </P>
            <DataTable
              head={['Group', 'Includes', 'When to disable']}
              rows={[
                ['Bookings', 'Timeline, Bookings, Customers, Venues, Tables, Schedule, Rules, Widget Test', 'Never (this is the core product). Available so non-restaurant deployments can repurpose the platform.'],
                ['Booking emails', 'Email templates, sender settings, sent log', 'If you want to handle confirmation emails entirely outside Macaroonie.'],
                ['Website CMS', 'Per-venue marketing sites, brand defaults', 'If your tenants don\'t need branded subsites.'],
                ['Cash reconciliation', 'Daily close-out, weekly grid, SC sources', 'If you don\'t track end-of-day cash through Macaroonie.'],
                ['Pepper (AI assistant)', 'Ask Pepper, the Pepper page, the phone app\'s Pepper, the staff connector for AI apps', 'If staff shouldn\'t use AI at all. The website chat and guests\' AI apps have their own switches on the Pepper page.'],
              ]}
            />
            <P>
              Always-on (no toggle): Overview, Team, Settings, Documentation. These are core
              to running the platform itself.
            </P>

            <H3>Roles tab — fine-grained per-user permissions</H3>
            <P>
              Four built-in roles ship per tenant: Owner, Admin, Operator, Viewer. Each has
              a permissions matrix showing every module set to <strong>none</strong>,
              <strong> view</strong>, or <strong>manage</strong>. Built-in roles can be edited
              (e.g. take Email Templates away from Admin) but not deleted.
            </P>
            <P>
              Click <strong>+ New role</strong> to define custom roles like &ldquo;Manager&rdquo;
              or &ldquo;Host&rdquo; with their own matrix. Custom roles can be deleted as long
              as no users are assigned. Assign custom roles in the Team page once they exist.
            </P>
            <InfoBox type="info">
              Disabling a module at the tenant level wins over role permissions — even an
              Owner can&apos;t access a disabled module. To grant access, turn the module on
              first, then check the role permission.
            </InfoBox>

            <H3>What View and Manage mean</H3>
            <P>
              The same rule applies on every page: <strong>View</strong> lets someone open the
              page and use it to look things up, <strong>Manage</strong> lets them change things
              there, and <strong>None</strong> hides it. With View, the buttons that change things
              are hidden or greyed out and a blue &ldquo;View only&rdquo; bar says so at the top;
              the app also refuses the change if it&apos;s tried another way. For example: View on
              Cash reconciliation shows the week and each day with every figure, but nothing can be
              typed, submitted or set up; View on Menus opens each menu without Save; View on a
              dashboard shows its widgets but no Edit layout.
            </P>
            <P>
              A few changes also need an Owner or Admin login on top of Manage, because they undo
              finished work or touch money: Cash Recon settings and unsubmitting a submitted day or
              week, deleting a booking, refunding a deposit. Removing an email suppression needs the
              Owner. Team and Access themselves stay Owner only.
            </P>
            <P>
              The built-in roles start from sensible defaults: an Operator manages bookings, Cash
              Recon, the rota, online orders and H&amp;S checks, and can view customers, venues,
              tables, the schedule and menus; a Viewer can view bookings, customers, menus and the
              H&amp;S pages. Change any of these in the role&apos;s matrix.
            </P>
          </section>

          {/* ── EMAIL MONITORING ───────────────────────────── */}
          <section id="email-monitoring" data-help="">
            <H2>Email Monitoring</H2>
            <P>
              The <strong>Email monitor</strong> page (sidebar, under the Emails section)
              shows what your venue is sending and what&apos;s being blocked at the SendGrid
              gateway. It&apos;s split into two sections.
            </P>

            <H3>What went out</H3>
            <P>
              Aggregate stats from SendGrid for the selected window (last 7 / 30 / 90 days):
              requested, delivered, opens, clicks, bounces, spam reports, plus delivery /
              open / bounce rates.
            </P>
            <P>
              Below the cards is a daily breakdown table (one row per day) and the local send
              log — every email Macaroonie tried to send, with status, recipient, subject, and
              provider. Cross-reference the two: if a row in the local log shows
              &ldquo;sent&rdquo; but the recipient claims they didn&apos;t receive it, look
              at the SendGrid bounces column for that day.
            </P>

            <H3>What&apos;s in (suppressions)</H3>
            <P>
              Four lists showing addresses SendGrid is currently blocking:
            </P>
            <DataTable
              head={['List', 'Meaning', 'When to remove']}
              rows={[
                ['Bounces',        'Recipient mailbox rejected the message (usually invalid address or full mailbox).', 'Once the recipient confirms the issue is fixed.'],
                ['Blocks',         'ISP blocked our IP or content (looks like spam to them).', 'After contacting the ISP or modifying email content.'],
                ['Spam reports',   'Recipient marked one of our emails as spam.', 'Only with the recipient\'s explicit re-opt-in.'],
                ['Invalid emails', 'Address malformed at SendGrid validation (typo, missing @, etc.).', 'Never — fix the source data.'],
              ]}
            />
            <P>
              Hover an entry → trash icon appears (owner only) → click to remove and let
              future emails to that address through. Useful when a guest&apos;s mailbox was
              temporarily full and they&apos;re asking why they&apos;re not getting reminders.
            </P>

            <InfoBox type="info">
              Monitoring currently shows SendGrid data only. If your venue uses Postmark,
              Mailgun, or SES, this page shows a banner explaining that monitoring isn&apos;t
              wired up for that provider yet — but the local send log still works.
            </InfoBox>
          </section>

          {/* ── MEDIA LIBRARY ──────────────────────────────── */}
          <section id="media-library" data-help="">
            <H2>Media Library</H2>
            <P>
              The <strong>Media</strong> page (sidebar, under Website) is your tenant&apos;s
              shared image library. Every image uploaded anywhere in the platform — hero
              shots, brand logos, gallery photos, OG images — is stored here and can be
              picked again from any image field via the new <strong>Choose from library</strong>
              button.
            </P>

            <H3>Two ways to use it</H3>
            <ol className="list-decimal ml-5 space-y-2 text-sm text-muted-foreground mb-4">
              <li>
                <strong>Picker</strong> — opens automatically when you click "Choose from library"
                next to any image field on the website builder, brand defaults, etc.
                Pick one image and click <strong>Insert selected</strong> — the field gets the URL.
              </li>
              <li>
                <strong>Manager</strong> — open <strong>Media</strong> from the sidebar to browse,
                rename, recategorise, or bulk-delete without being mid-task. It opens as a normal
                page; use the sidebar to leave it.
              </li>
            </ol>

            <H3>Categories</H3>
            <P>
              User-defined flat tags. Create them from the sidebar (&ldquo;+ New category&rdquo;).
              Hover a category to rename or delete. Deleting a category does NOT delete its
              items — they just become uncategorised.
            </P>

            <H3>Scope (form filter)</H3>
            <P>
              Each image is tagged with a <strong>scope</strong> — either &ldquo;shared&rdquo;
              (global library) or a specific form key like <code className="font-mono">website:hero</code>.
              The Form filter dropdown lets you see only images for a particular form, or all.
              Use <strong>Move to scope</strong> in the detail panel to promote an image from
              form-specific to shared (so it can be reused anywhere).
            </P>

            <H3>Upload</H3>
            <ul className="list-disc ml-5 space-y-1 text-sm text-muted-foreground mb-4">
              <li>Click <strong>Upload</strong> in the sidebar to pick files.</li>
              <li>Or drag image files anywhere onto the modal.</li>
              <li>Multiple files at once is fine; each gets its own progress chip.</li>
              <li>If a file with the same name (or identical contents) exists in the same scope, you&apos;ll be asked: <strong>Replace</strong> / <strong>Keep both</strong> / <strong>Cancel</strong>.</li>
              <li>Set <strong>Upload to</strong> in the sidebar before uploading to auto-tag new files into a category.</li>
            </ul>

            <H3>Multi-select</H3>
            <P>
              Hover a thumbnail to reveal its checkbox; or hold ⌘/Ctrl/Shift while clicking to
              add to selection. The right panel switches to bulk actions: move category, move
              scope, delete all.
            </P>

            <H3>Image editor</H3>
            <P>
              Click <strong>Edit image</strong> in the detail panel to open the editor.
              You can crop (with aspect ratio presets — Free / 1:1 / 4:3 / 3:2 / 16:9 / 9:16),
              rotate in 90° increments, and flip horizontally or vertically.
            </P>
            <P>
              Two ways to save:
            </P>
            <ul className="list-disc ml-5 space-y-1 text-sm text-muted-foreground mb-4">
              <li><strong>Save as new</strong> — creates a fresh image (with a "-edited" suffix on the filename) so the original stays untouched.</li>
              <li><strong>Replace original</strong> — overwrites the file behind the item. References to it elsewhere (hero images, brand defaults) instantly use the edited version.</li>
            </ul>
            <InfoBox type="info">
              Brightness, contrast, and other adjustments aren&apos;t in this release —
              just crop / rotate / flip for now. If you need colour adjustments,
              edit the file in your image tool of choice and re-upload.
            </InfoBox>
          </section>

          {/* ── Reviews ───────────────────────────────────── */}
          <section id="reviews" data-help="">
            <H2>Reviews</H2>
            <P>
              The Reviews page (<strong>sidebar nav</strong>) lets you collect, moderate, and showcase
              guest reviews from Google (via automated scraping) or add them manually.
            </P>
            <H3>Importing reviews</H3>
            <DataTable
              head={['Method', 'How']}
              rows={[
                ['Google scrape', 'Enter a Google Place ID on the Venue settings page, then click Scrape Google Reviews on the Reviews page. The job runs in the background via Apify — results appear within a minute or two. Requires an APIFY_API_TOKEN to be configured on the server.'],
                ['Manual entry', 'Click Add review, fill in the reviewer name, rating, text, and date. Useful for reviews collected by phone or in person.'],
                ['CSV import', 'Upload a CSV with columns: reviewer_name, rating, review_text, review_date. Platform admin can provide a template.'],
              ]}
            />
            <H3>Moderation</H3>
            <P>
              New reviews (scraped or imported) start as <strong>unapproved</strong>. Approved reviews can
              be shown in the Reviews Band block on your public site. Featured reviews are highlighted at
              the top of the block. Use <strong>Bulk approve</strong> to approve multiple at once after
              a scrape.
            </P>
            <InfoBox type="tip">
              The Reviews Band block on your site automatically pulls from your approved (and optionally
              featured) reviews — no copy-paste required.
            </InfoBox>
          </section>

          <section id="issues" data-help="">
            <H2>Issue Log</H2>
            <P>
              The Issue Log (<strong>sidebar nav</strong>) is your ITIL-style incident and service request
              tracker. Use it to report bugs, outages, change requests, or service needs. Platform admin
              can acknowledge, update, and resolve issues, and can promote them to the development backlog.
            </P>
            <P>
              Everyone sees the issues of the restaurant group they are in. A platform admin sees the
              same, plus an <strong>All restaurant groups</strong> button that lists every group&apos;s
              issues with the group&apos;s name on each.
            </P>
            <H3>Priority matrix</H3>
            <P>
              Priority is calculated automatically from <strong>Impact</strong> and <strong>Urgency</strong>:
            </P>
            <DataTable
              head={['Impact', 'Urgency', 'Priority']}
              rows={[
                ['Critical', 'Critical', 'P1 — Critical'],
                ['Critical / High', 'High / Critical', 'P2 — High'],
                ['Medium or mixed', 'Medium or mixed', 'P3 — Medium'],
                ['Low', 'Low', 'P4 — Low'],
              ]}
            />
            <H3>Categories</H3>
            <DataTable
              head={['Category', 'When to use']}
              rows={[
                ['Incident', 'Something is broken or degraded right now.'],
                ['Problem', 'Root cause investigation of recurring incidents.'],
                ['Change request', 'Planned modification to the system.'],
                ['Service request', 'Routine request (e.g. account changes, access).'],
              ]}
            />
            <H3>Lifecycle</H3>
            <P>
              Issues move through: <strong>New</strong> → <strong>Acknowledged</strong> → <strong>In
              progress</strong> → <strong>Resolved</strong> → <strong>Closed</strong>. Platform admin
              adds resolution notes when closing. Issues can be promoted to a backlog item if
              development work is needed.
            </P>
          </section>

          <section id="feature-requests" data-help="">
            <H2>Feature Requests</H2>
            <P>
              The Feature Requests page (<strong>sidebar nav</strong>) is a shared wishlist across all
              tenants. Submit requests, upvote existing ones, and track progress as platform admin moves
              items through their lifecycle.
            </P>
            <H3>Upvoting</H3>
            <P>
              Click the upvote button on any request to add your vote. Click again to remove it. Your
              votes are tied to your account. The upvote count is visible to all tenants — popular
              requests get prioritised.
            </P>
            <H3>Lifecycle statuses</H3>
            <DataTable
              head={['Status', 'Meaning']}
              rows={[
                ['Submitted', 'Received, not yet reviewed.'],
                ['Under review', 'Platform admin is evaluating feasibility.'],
                ['Planned', 'Accepted, will be built in a future sprint.'],
                ['In progress', 'Currently being built.'],
                ['Shipped', 'Deployed and available.'],
                ['Declined', 'Not going ahead — see admin notes for reason.'],
              ]}
            />
          </section>

          <section id="changelog" data-help="">
            <H2>What is new</H2>
            <P>
              The <strong>What is new</strong> page (<strong>sidebar nav</strong>) shows a timeline of
              platform updates, new features, and bug fixes published by the platform team. Each entry
              has a title, date, category (feature / fix / improvement / deprecation), and description.
            </P>
            <P>
              New entries are published by platform admin — they appear automatically for all tenants
              as soon as they are published. Unpublished drafts are only visible to platform admin.
            </P>
          </section>

          <section id="test-data" data-help="">
            <H2>Test data (pre-prod)</H2>
            <P>
              The <strong>Test data</strong> page fills a venue with practice records while
              Macaroonie is in testing. Pick the venue at the top. It has four parts: generate
              dummy bookings, clear bookings, generate past health &amp; safety logs, and clear
              generated health &amp; safety logs.
            </P>
            <H3>Generate past health &amp; safety logs</H3>
            <P>
              Choose a past date range (up to today, a year at most) and what to fill. Use
              <strong> Preview</strong> to see roughly how much it will make, then
              <strong> Generate</strong>.
            </P>
            <DataTable
              head={['What', 'What it makes']}
              rows={[
                ['Fridge & freezer temperatures', 'One reading per fridge or freezer per check time, inside its limits.'],
                ['Hot & cold hold checks', 'One reading per hold station per hold check time, inside its limits.'],
                ['Cooking checks', 'Each cooking session gets its required number of checks, with dishes picked at random from your published menus, all at 75°C or above.'],
                ['Past purchase orders', 'One per supplier per delivery day (the venue\'s own delivery days if set) for the items on the venue\'s order lists, most of them, at quantities around the pars.'],
                ['Delivery checks', 'Books in every received purchase order in the range without a check: the supplier, the items that arrived, and the chilled / frozen temperatures by each item\'s storage (chilled 1-5°C, frozen -22 to -18°C).'],
                ['Checklists & audits', 'Daily, weekly and monthly checklists (the monthly audit included) marked complete with every task ticked. Pick which checklists to include. One that someone had already started is completed and ticked off too.'],
              ]}
            />
            <P>
              <strong>Readings out of range</strong> sets roughly what share of readings fall
              outside the limits, each with a corrective action written in, so reports and the
              Overview tiles show what a real log looks like. 0 keeps everything in range.
              <strong> Skip days the venue is closed</strong> leaves closed days empty.
              Days that already have a reading are left alone, so running it twice does not
              double anything up. Readings are signed with your venue staff names.
            </P>
            <H3>Clear generated health &amp; safety logs</H3>
            <P>
              Removes only what the generator made, for the dates and types you choose, after
              you type DELETE. Readings and checklists people entered are never removed. A
              checklist that had been started before the generator completed it stays
              completed.
            </P>
          </section>

          <section id="faq" data-help="">
            <H2>FAQ &amp; Troubleshooting</H2>
            <div className="space-y-4">
              {[
                {
                  q: 'A page shows "This page stopped working".',
                  a: 'Something on that page failed while it was being shown. Nothing you saved before is lost. Press Reload page; moving to another page from the menu also clears it. If it happens again, send support the message in the grey box and say what you pressed just before.',
                },
                {
                  q: 'My venue is not showing any slots in the widget.',
                  a: 'Check that (1) the venue is active — it is easy to accidentally deactivate it in settings. (2) The venue has a schedule with sittings for the day you are testing. (3) The date is not blocked by a date override marked as Closed. (4) The booking cutoff has not passed for those slots.',
                },
                {
                  q: 'A guest says the slot was available but they got a conflict error at checkout.',
                  a: 'This is expected behaviour. The slot was available when the guest started, but another guest completed their booking first. The double-booking protection (database UNIQUE constraint + FOR UPDATE lock) prevents two bookings for the same slot. The guest should select another time.',
                },
                {
                  q: 'Bookings are not appearing on the Timeline after they are confirmed.',
                  a: 'Click the refresh button in the Timeline toolbar. If bookings still do not appear, log out and log back in — Auth0 tokens expire after a period of inactivity, which prevents data from loading. This is not a data loss issue; the bookings are saved correctly in the database.',
                },
                {
                  q: 'How do I block off a specific date (bank holiday, private event)?',
                  a: 'Go to Schedule → click the calendar/override icon on the day → Add date override → mark it as Closed (or add custom sittings with reduced hours). The override applies to all tables at that venue for that date.',
                },
                {
                  q: 'Can the same table be booked twice in one day?',
                  a: 'Yes — multiple bookings at different times on the same table is normal and correct. The system only prevents overlapping bookings on the same table. The slot generator subtracts confirmed bookings and active holds when calculating what is available.',
                },
                {
                  q: 'What happens if a guest does not complete their booking within the hold time?',
                  a: 'The hold expires automatically. The slot becomes available again within the next minute (pg_cron sweep runs every minute). The guest sees an "expired" message if they try to continue. There is no charge taken for expired holds.',
                },
                {
                  q: 'How do I change the party size limit for my venue?',
                  a: 'Go to Rules for your venue and update Min Covers and Max Covers. These limits apply to all bookings for that venue. The widget will only show slots for party sizes within this range.',
                },
                {
                  q: 'A combination booking is only showing one tile in the Timeline, not spanning all the tables.',
                  a: 'The Timeline merges tiles for adjacent tables. If the combination includes non-adjacent tables (with other tables between them in the list), you will see separate tiles. This is correct — each contiguous group of tables in the combination shows as one merged tile, and non-adjacent groups show as separate tiles.',
                },
                {
                  q: 'I dragged a booking to a new time but the duration changed.',
                  a: 'This is fixed in the current version. Dragging now preserves the booking\'s actual duration (including any manual resize). If you see the duration reset to the default slot duration, ensure your API is up to date.',
                },
                {
                  q: 'The venue selector is empty on the Timeline.',
                  a: 'This usually means your Auth0 session has expired. Log out and log back in. If the issue persists, check that at least one venue is active for your account on the Venues page.',
                },
                {
                  q: 'I dragged a booking to a different table but it ended up on unexpected tables.',
                  a: 'Smart allocation picks the best arrangement anchored to the table you dropped on. If the target table alone cannot seat the party, the system looks for a combination that includes that table, then falls back to adjacent tables by sort order. To get predictable results, (1) configure combinations for the table groupings you want, and (2) set your table sort order to match the physical floor plan — Tables → Reorder.',
                },
                {
                  q: 'A booking appeared in the Unallocated row after a drag.',
                  a: 'This means a booking was displaced when smart allocation moved the dragged booking onto its table, and no other free table was available at that time. The displaced booking is still confirmed — it just has no physical table. Drag it out of the Unallocated row and drop it onto a suitable table row to re-assign it. The smart-allocation engine will run again from the new target table.',
                },
                {
                  q: 'How do I control which tables the system combines when I drag a large-party booking?',
                  a: 'Two ways: (1) Create explicit table combinations on the Tables page — the system always prefers configured combinations over ad-hoc adjacency. (2) Set your table sort order (Tables → Reorder) so that tables you want combined are adjacent in the list — the adjacency expansion follows sort order, so physically adjacent tables should be neighbours in the list.',
                },
                {
                  q: 'I set the table order but the Timeline still shows the old order.',
                  a: 'The Timeline fetches the table list when it loads. Click the Refresh button in the Timeline toolbar, or navigate away and back, to pick up the new sort order.',
                },
                {
                  q: 'Dragging a booking to a different table returns it to where it was with no error.',
                  a: 'The most common cause is that migration 010 (allocation_rules) has not been applied to the database. Run: psql $DATABASE_URL -f migrations/010_allocation_rules.sql. Without this migration, the /relocate endpoint fails silently because the allow_cross_section_combo column and disallowed_table_pairs table do not exist.',
                },
                {
                  q: 'The drag snapped back and the Timeline shows a red banner saying "No table combination is configured".',
                  a: 'The smart-allocation engine found the right table set (via adjacency expansion) but no pre-configured combination exists for those tables. Go to Tables → Table combinations → Add combination, create a combination for those tables, then try the drag again.',
                },
                {
                  q: 'I created a new booking for 5 covers but it only shows on one table in the Timeline.',
                  a: 'The booking was probably confirmed via the free-booking path before the combination_id fix was deployed. The booking hold had a combination_id but the older confirm code did not copy it to the booking record. Open the booking in the drawer, click Override, re-select the correct tables, and save to fix the assignment.',
                },
                {
                  q: 'Slot caps I entered are not showing when I reopen the sitting.',
                  a: 'This was a known bug (now fixed) where PostgreSQL returned slot_time as HH:MM:SS but the frontend expected HH:MM, so saved values would not display on reload. After updating to the latest version, saved caps should display correctly.',
                },
                {
                  q: 'I want to prevent certain tables from being combined by the smart-allocation engine.',
                  a: 'Go to Tables → scroll to Disallowed pairs → select the two tables and click Add. The engine will never combine that pair, regardless of party size or adjacency. Note: this only restricts the engine — operators can still manually assign any table combination via the booking drawer Override.',
                },
                {
                  q: 'Guests can\'t see late slots in the widget but they appear in the admin timeline.',
                  a: 'Check the Doors close time on that day in the Schedule page. If it\'s set, the widget hides slots at or after that time. Either remove the Doors close time, move it later, or enable \'Allow widget bookings past doors-close time\' in Rules → Opening hours enforcement.',
                },
                {
                  q: 'A paid booking via the widget didn\'t show the guest\'s notes / appeared as single table instead of combination.',
                  a: 'This was a bug in the Stripe webhook — fixed. The webhook now correctly copies both combination_id and guest_notes from the hold into the booking. If you have affected historical bookings, you\'ll need to manually update them via the drawer.',
                },
                {
                  q: 'The Manual allocation button does not appear.',
                  a: 'It is always visible on the slot selection step of the New booking modal, next to the Continue button. If you do not see it, check that you are on the Timeline page (not the Bookings list) and that the modal has fully loaded.',
                },
                {
                  q: 'I created a schedule exception but slots still show normally.',
                  a: 'Check that the exception\'s date range covers today\'s date and that the priority is set correctly. If two exceptions overlap the same date, the one with the higher priority number wins. Also verify migration 014 and 015 have been run on your database.',
                },
                {
                  q: 'Grey columns appear where I expect the venue to be open.',
                  a: 'Grey columns mean the slot query returned no available slots for that time. This usually means no sitting covers that time in your schedule. Check your sittings on the Schedule page and ensure the day is toggled open.',
                },
                {
                  q: 'I can see fewer slots than expected — some late slots are missing.',
                  a: 'This was fixed in migration 020. Previously the system only showed slots where the entire booking would finish before the last order time. Now any slot that starts at or before the last order time is shown. If you still see fewer slots than expected after applying migration 020, check that the sitting\'s end time (Last order) is set correctly in the Schedule.',
                },
                {
                  q: 'The booking modal shows a warning about running past last orders or doors close.',
                  a: 'This is informational only — the booking can still be confirmed. The amber warning means the booking end time falls after the sitting\'s last order time. The red warning means it falls after the sitting\'s doors close time. Both warnings are shown to help you plan staffing, but neither blocks the booking.',
                },
                {
                  q: 'A guest\'s booking is running longer than expected — how do I update the end time?',
                  a: 'Open the booking in the drawer (tap the tile on the Timeline). In the Date & time section, tap the End time button. A time picker appears — select the new end time and tap Save end time in the drawer header. The Timeline updates immediately. On a tablet, the native OS time picker opens automatically.',
                },
                {
                  q: 'I want to change the brand colour / make the portal look different.',
                  a: 'Go to Settings in the sidebar. In the Appearance section, pick a colour using the colour picker, type a hex value directly, or select one of the preset swatches. The change applies instantly across the whole portal. Settings are saved in your browser and persist across sessions.',
                },
                {
                  q: 'The + New booking button has disappeared from the toolbar.',
                  a: 'The + New booking button moved from the toolbar to a round floating button at the bottom-right corner of the Timeline canvas. You can also click any empty cell on the canvas to start a manual booking at that time.',
                },
                {
                  q: 'The venue selector / refresh / fullscreen controls are gone from the Timeline toolbar.',
                  a: 'These controls moved to the sidebar (left menu). They appear above the logout button when you are on the Timeline page. If the sidebar is collapsed to icon-only mode, you will see small icon buttons; expand the sidebar to see the full labels.',
                },
                {
                  q: 'How do I hide cancelled and no-show bookings from the Timeline?',
                  a: 'In the sidebar, while on the Timeline page, tap the Inactive toggle. This hides cancelled, no-show, and checked-out bookings from the canvas. Tap it again to show them. The setting persists across sessions — it is also configurable as a default in Settings → Timeline defaults.',
                },
                {
                  q: 'How do I edit the start time and end time of a booking from the drawer?',
                  a: 'In the booking drawer, tap either the start time pill or the end time pill in the Date & time section. Both open the same unified editor showing the date, start time, and end time together. Change whichever values you need, then tap the save button in the drawer header. To close without saving, tap the start pill again.',
                },
                {
                  q: 'Can I type a number directly into the covers field in the booking drawer?',
                  a: 'Yes. In the booking drawer, tap the covers number in the Guest details section — it becomes a direct-entry field. You can also use the + and − buttons. The value saves when you tap the save button in the drawer header.',
                },
                {
                  q: 'How do I change the colour of a specific booking status on the Timeline?',
                  a: 'Go to Settings → Booking status colours. Tap the status tile you want to change (e.g. Confirmed). Choose one of the 12 preset swatches or use the colour picker for a custom shade. Tap Done. To restore all statuses to their defaults at once, tap Reset all.',
                },
                {
                  q: 'The Timeline background colour swatch I clicked did not seem to change anything.',
                  a: 'The colour did apply — the swatch selected applies immediately to the Timeline canvas. If the change is hard to see, try a more distinct colour (e.g. a warm cream or pale blue from the swatches). The colour picker circle in Settings also updates to reflect the newly selected swatch.',
                },
                {
                  q: 'How do I make the Timeline tiles show the phone number and table allocation?',
                  a: 'Tap the Detail toggle in the sidebar (on the Timeline page) to switch to Detailed tile mode. Each tile will expand to show three lines: name + covers, phone number, and table allocation. You can set Detailed as the default in Settings → Timeline defaults → Default tile mode.',
                },
                {
                  q: 'The booking tiles are too small to read on my large monitor.',
                  a: 'Two options: (1) In Settings → Timeline defaults, increase the Compact tile size from S to M or L for larger text and row height while staying in compact mode. (2) Switch to Detailed mode using the Detail toggle in the sidebar for the fullest information display. You can also enable Wide time columns in Settings to spread the Timeline out horizontally.',
                },
                {
                  q: 'Can I make the hour columns wider so I can see booking times more clearly?',
                  a: 'Yes. Go to Settings → Timeline defaults → Wide time columns and toggle it on. This increases each hour column from 80 px to 120 px. The change applies instantly on the Timeline and persists across sessions.',
                },
              ].map(({ q, a }) => (
                <div key={q} className="border rounded-lg p-4">
                  <p className="text-sm font-semibold mb-2">Q: {q}</p>
                  <p className="text-sm text-muted-foreground">A: {a}</p>
                </div>
              ))}
              <div className="space-y-1.5 border rounded-xl px-4 py-3">
                <p className="text-sm font-semibold">What is the thick coloured line on the Timeline?</p>
                <p className="text-sm text-muted-foreground">
                  That is the <strong>opening hour line</strong> — a visual marker at the start of the
                  first sitting for the day. You can change its colour or turn it off entirely in{' '}
                  <strong>Settings → Appearance → Opening hour line</strong>.
                </p>
              </div>
              <div className="space-y-1.5 border rounded-xl px-4 py-3">
                <p className="text-sm font-semibold">Why is a booking showing a ⛔ stop sign?</p>
                <p className="text-sm text-muted-foreground">
                  Two or more active bookings are assigned to the same table at the same time. Both tiles
                  are flagged with a red border and the stop sign. Open one of the bookings and either
                  change its table assignment or adjust its time to resolve the conflict.
                </p>
              </div>
              <div className="space-y-1.5 border rounded-xl px-4 py-3">
                <p className="text-sm font-semibold">The stats bar doesn't show Lunch and Dinner separately — it shows a time range instead.</p>
                <p className="text-sm text-muted-foreground">
                  Session names haven't been set yet. Go to <strong>Schedule</strong>, click the pencil
                  icon on each sitting, and enter a name (e.g. "Lunch", "Dinner"). The stats bar will
                  use these names automatically.
                </p>
              </div>
              <div className="space-y-1.5 border rounded-xl px-4 py-3">
                <p className="text-sm font-semibold">How do I hide the early-morning columns on the Timeline?</p>
                <p className="text-sm text-muted-foreground">
                  Go to <strong>Settings → Timeline defaults → Timeline hours</strong> and change the
                  start hour to match when your day actually begins (e.g. 11:00). The timeline canvas
                  will only show hours from that point onwards.
                </p>
              </div>
              <div className="space-y-1.5 border rounded-xl px-4 py-3">
                <p className="text-sm font-semibold">Can I assign a booking to no table (Unallocated)?</p>
                <p className="text-sm text-muted-foreground">
                  Yes. Open the booking drawer, click <strong>Override</strong> in the table section, and
                  select <strong>Unallocated</strong> at the top of the table list. The booking moves to
                  the orange Unallocated row on the Timeline where it can be dragged to a real table later.
                </p>
              </div>
            </div>
          </section>

        </div>
      </main>
    </div>
  )
}

// ── Shared primitives ─────────────────────────────────────────

function H2({ children }) {
  return <h2 className="text-xl font-bold mb-4 pb-2 border-b">{children}</h2>
}
// Each subsection has an anchor from its heading (helpSlug(), shared with
// Pepper's help answers, which link to it: /help#tip-pots).
function H3({ children, className }) {
  const id = typeof children === 'string' ? helpSlug(children) : undefined
  return <h3 id={id} className={cn('text-base font-semibold mt-6 mb-3 scroll-mt-4', className)}>{children}</h3>
}
function P({ children }) {
  return <p className="text-sm text-muted-foreground leading-relaxed mb-3">{children}</p>
}
function Mono({ children }) {
  return <code className="bg-muted px-1 py-0.5 rounded text-xs font-mono">{children}</code>
}
function InfoBox({ type = 'info', children }) {
  const s = {
    info: 'bg-blue-50 border-blue-200 text-blue-900',
    warn: 'bg-amber-50 border-amber-200 text-amber-900',
    tip:  'bg-green-50 border-green-200 text-green-900',
  }
  const icons = { info: 'ℹ️', warn: '⚠️', tip: '💡' }
  return (
    <div className={cn('border rounded-lg p-3 text-sm flex gap-2 mb-4', s[type])}>
      <span className="shrink-0 mt-0.5">{icons[type]}</span>
      <span>{children}</span>
    </div>
  )
}
function DataTable({ head, rows }) {
  return (
    <div className="overflow-x-auto mb-4 rounded-lg border">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-muted">
            {head.map(h => (
              <th key={h} className="text-left px-3 py-2 font-semibold text-muted-foreground border-b">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className={i % 2 === 1 ? 'bg-muted/20' : ''}>
              {row.map((cell, j) => (
                <td key={j} className="px-3 py-2 border-b border-border/50 text-muted-foreground align-top">
                  {j === 0 ? <strong className="font-semibold text-foreground">{cell}</strong> : cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
