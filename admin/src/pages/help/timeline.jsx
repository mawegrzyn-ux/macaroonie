// src/pages/help/timeline.jsx
// The Help page's "Using the Timeline" section. Help.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, InfoBox, DataTable } from './parts.jsx'

export const id = 'timeline'
export const label = 'Using the Timeline'
export const order = 120

// ── TIMELINE ────────────────────────────────────
export function Section() {
  return (
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
  )
}
