// src/pages/Help.jsx
// Operator-facing user guide — step-by-step instructions for restaurant staff.
import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'

const SECTIONS = [
  { id: 'getting-started',     label: 'Getting Started' },
  { id: 'venues',              label: 'Managing Venues' },
  { id: 'tables',              label: 'Tables & Combinations' },
  { id: 'schedule',            label: 'Setting Your Schedule' },
  { id: 'schedule-exceptions', label: 'Schedule Exceptions' },
  { id: 'rules',               label: 'Booking Rules' },
  { id: 'deposits',            label: 'Deposits & Payments' },
  { id: 'timeline',            label: 'Using the Timeline' },
  { id: 'manual-booking',      label: 'Manual Booking' },
  { id: 'bookings',            label: 'Managing Bookings' },
  { id: 'widget',              label: 'Booking Widget' },
  { id: 'faq',                 label: 'FAQ & Troubleshooting' },
]

export default function Help() {
  const [activeId, setActiveId] = useState('getting-started')

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

            <div className="space-y-3 mb-6">
              {[
                ['Create your venue', 'Give it a name, address, and timezone. The timezone is critical — all booking times display in your local time.'],
                ['Add tables and sections', 'Organise your floor plan into sections (Main Floor, Terrace, Bar, etc.), then add each table with its seating capacity.'],
                ['Set table order', 'Use the Reorder button on the Tables page to drag tables into the order they appear on your floor plan. This drives the Timeline row sequence and the smart-allocation adjacency logic.'],
                ['Set up table combinations', 'If adjacent tables can be pushed together for larger parties, create a combination (e.g. T1 + T2 = combined table for 6).'],
                ['Configure your weekly schedule', 'Define which days you open and add sittings (Lunch, Dinner). Each sitting has its own slot duration, interval, and cover cap.'],
                ['Set booking rules', 'Configure minimum and maximum covers per booking, the hold time limit, and the cutoff before a slot starts.'],
                ['(Optional) Enable deposits', 'Connect a Stripe account and set a deposit amount if you want to require payment to confirm bookings.'],
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
                ['Operator', 'Can create and manage bookings. Cannot change venue configuration.'],
                ['Viewer', 'Read-only. Can view bookings and schedules but cannot make changes.'],
              ].map(([role, desc]) => (
                <div key={role} className="flex gap-3 items-start border rounded-lg px-3 py-2">
                  <span className="text-sm font-semibold w-20 shrink-0">{role}</span>
                  <span className="text-sm text-muted-foreground">{desc}</span>
                </div>
              ))}
            </div>
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
              <li>Go to <strong>Venues</strong> in the sidebar.</li>
              <li>Click <strong>Add venue</strong>.</li>
              <li>Enter the venue name, address, and — most importantly — the correct timezone.</li>
              <li>Save. The venue will appear in the Venues list.</li>
            </ol>

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
              From the venue detail page you can also access <strong>Booking Rules</strong> and{' '}
              <strong>Deposit Rules</strong> — shortcut links are shown below the venue details.
              These settings are per-venue, so each location can have different rules.
            </P>
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

            <H3>Last order time and Doors close</H3>
            <P>
              Each sitting has a <strong>Last order</strong> time — this is the latest slot that will be
              offered to guests. No new booking slots are generated after this time within the sitting.
              You can set or change it by clicking the pencil icon on the sitting row.
            </P>
            <P>
              Each day also has a <strong>Doors close</strong> time, set via the time picker that appears
              in the day header when the day is toggled open (next to the Interval field). This represents
              when the venue physically closes. By default, the booking widget will <strong>hide all slots
              at or after the Doors close time</strong> — guests will not see those slots, even if they
              are technically available in the schedule.
            </P>
            <InfoBox type="info">
              The Doors close time affects the widget only. Slots at or after that time remain fully
              visible and bookable from the admin Timeline. Use it to stop online bookings running into
              your closing time without having to adjust your sitting end times.
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
                  desc: 'Off by default. When off, the adjacency expansion only picks tables that are neighbours in your table sort order. Turn on to allow non-neighbouring tables to be combined — useful if you want the engine to skip a reserved table and take the next one.',
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
          </section>

          {/* ── DEPOSITS ──────────────────────────────────── */}
          <section id="deposits" data-help="">
            <H2>Deposits &amp; Payments</H2>
            <P>
              Macaroonie integrates with Stripe Connect so each restaurant can take deposits directly into
              their own bank account. The platform deducts a small fee automatically.
            </P>

            <H3>Setting up Stripe</H3>
            <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside ml-2 mb-4">
              <li>Go to your venue's <strong>Deposit Rules</strong> page.</li>
              <li>Click <strong>Connect with Stripe</strong> and complete the Stripe onboarding flow.</li>
              <li>Once connected, enable <strong>Require deposit</strong> and set the deposit amount in pence (e.g. 1000 = £10.00).</li>
              <li>Save. New bookings for this venue will now require payment before confirmation.</li>
            </ol>

            <H3>How the deposit flow works</H3>
            <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside ml-2 mb-4">
              <li>Guest selects a slot — a hold is created (slot is temporarily reserved).</li>
              <li>Guest sees the deposit amount and completes payment in the widget.</li>
              <li>Stripe confirms payment via webhook → booking is confirmed automatically.</li>
              <li>If the guest abandons, the hold expires and the slot is released. No charge is taken.</li>
            </ol>

            <InfoBox type="warn">
              Bookings are only confirmed after Stripe's webhook is received — not when the guest sees
              the payment success screen. This prevents double-bookings and ensures payment has actually
              cleared before the slot is permanently held.
            </InfoBox>

            <H3>Issuing refunds</H3>
            <P>
              Open the booking from the Timeline, click the booking tile to open the detail drawer, and
              click <strong>Issue refund</strong> in the Payment section. The refund is processed
              immediately via Stripe and returns to the guest's original payment method within 5–10 days.
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
              <li>Use the <strong>venue selector</strong> to switch between venues.</li>
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
              A grey column does not mean all tables are full — it means the schedule says the venue is not open
              at that time. If a table shows white but has no booking card, capacity is available. Use
              Manual allocation to book outside the schedule if needed.
            </InfoBox>

            <H3>Booking tile colours</H3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-6">
              {[
                ['Confirmed', '#dbeafe', '#3b82f6'],
                ['Pending payment', '#fef9c3', '#eab308'],
                ['Completed', '#dcfce7', '#22c55e'],
                ['Cancelled', '#fee2e2', '#ef4444'],
                ['No show', '#f3f4f6', '#9ca3af'],
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

            <H3>Making a new booking</H3>
            <ol className="space-y-1.5 text-sm text-muted-foreground list-decimal list-inside ml-2 mb-4">
              <li>Click <strong>+ New booking</strong> in the top-right toolbar — <em>or</em> click directly on any empty cell on the Timeline canvas. Clicking on the canvas pre-selects that time slot automatically.</li>
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
              Click the <strong>⛶</strong> (Maximize) icon in the toolbar to expand the Timeline to full
              screen — useful on tablets at the host stand. Press <strong>Escape</strong> or click the
              icon again to exit.
            </P>

            <H3>Live updates</H3>
            <P>
              The Timeline updates automatically via WebSocket when bookings are created, modified, or
              cancelled by another user. You do not need to refresh the page. The refresh button in the
              toolbar forces an immediate re-fetch if you suspect the view is out of sync.
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
              <li>Click <strong>+ New booking</strong> in the top toolbar of the Timeline.</li>
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
              name, email, phone number, or the number of covers. Changes save immediately and update
              the booking record.
            </P>

            <H3>Rescheduling a booking</H3>
            <P>
              Click <strong>Reschedule</strong> next to the Date &amp; time section. A date picker and
              time picker appear pre-filled with the current booking time. Change the date and/or time,
              then click <strong>Move booking</strong>. The booking keeps the same table and its original
              duration.
            </P>

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
              <li>A warning appears if the selected table(s) cannot seat the booking's party size.</li>
            </ul>
            <P>
              The <strong>Save</strong> button for the override appears at the top of the drawer panel,
              next to the × close button — so it is always visible without scrolling.
            </P>
            <InfoBox type="tip">
              All save actions (table override, guest details, notes, reschedule) appear in the drawer
              header next to the × button when you are in an edit mode. Click × to close the drawer —
              this does <em>not</em> save. Use the contextual save button (e.g. "Assign T1 + T2",
              "Save notes") to save changes.
            </InfoBox>

            <H3>Changing booking status</H3>
            <P>
              Status transition buttons appear at the bottom of the drawer. Available transitions depend
              on the current status:
            </P>
            <div className="space-y-2 mb-4">
              {[
                ['Confirmed', ['Mark completed', 'Mark no show', 'Cancel']],
                ['Pending payment', ['Confirm manually', 'Cancel']],
                ['Completed / No show / Cancelled', ['No further transitions available']],
              ].map(([from, tos]) => (
                <div key={from} className="flex flex-wrap gap-2 items-center text-sm">
                  <span className="font-medium w-40 shrink-0">{from}</span>
                  <span className="text-muted-foreground">→</span>
                  <span className="text-muted-foreground">{tos.join(', ')}</span>
                </div>
              ))}
            </div>

            <H3>Operator notes</H3>
            <P>
              Click the notes area at the bottom of the drawer to add or edit internal notes. Notes are
              visible only to staff — they are never shown to guests. Useful for allergy information,
              special occasion details, or follow-up actions.
            </P>

            <H3>Issuing a refund</H3>
            <P>
              If a deposit was taken, a <strong>Payment</strong> section appears in the drawer showing
              the amount and status. Click <strong>Issue refund</strong> to process a full refund via
              Stripe. The refund is instant on Macaroonie's side; the guest receives funds within 5–10
              business days depending on their bank.
            </P>

            <H3>Viewing all bookings</H3>
            <P>
              The <strong>Bookings</strong> page in the sidebar shows a searchable, filterable list of
              all bookings across all dates — useful for looking up a specific guest or reference number.
            </P>
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
              <li><strong>Payment</strong> (if deposit required) — guest completes card payment.</li>
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

          {/* ── FAQ ───────────────────────────────────────── */}
          <section id="faq" data-help="">
            <H2>FAQ &amp; Troubleshooting</H2>
            <div className="space-y-4">
              {[
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
              ].map(({ q, a }) => (
                <div key={q} className="border rounded-lg p-4">
                  <p className="text-sm font-semibold mb-2">Q: {q}</p>
                  <p className="text-sm text-muted-foreground">A: {a}</p>
                </div>
              ))}
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
function H3({ children, className }) {
  return <h3 className={cn('text-base font-semibold mt-6 mb-3', className)}>{children}</h3>
}
function P({ children }) {
  return <p className="text-sm text-muted-foreground leading-relaxed mb-3">{children}</p>
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
