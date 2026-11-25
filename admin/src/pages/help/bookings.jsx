// src/pages/help/bookings.jsx
// The Help page's "Managing Bookings" section. Help.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, InfoBox, DataTable } from './parts.jsx'

export const id = 'bookings'
export const label = 'Managing Bookings'
export const order = 140

// ── BOOKINGS ────────────────────────────────────
export function Section() {
  return (
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

      <H3>Bookings on the phone</H3>
      <P>
        The phone app (<strong>ops.</strong> or the Macaroonie Office app) has two booking tiles for
        anyone with the Bookings module. Both open today at the restaurant this phone is on (the one
        it is shared for, or the one picked on Today); the arrows and the day button move the day,
        and Back to today comes back. Changes go through the same bookings as the office Timeline,
        so they show on every screen straight away.
      </P>
      <DataTable
        head={['Tile', 'What it does']}
        rows={[
          ['Timeline', 'A row per table with its bookings as blocks along the day: swipe the times sideways, the table names stay put. It opens at the current time with a red line at now. Cancelled and no-show bookings are hidden until you tap Show cancelled.'],
          ['Guest list', 'The day\'s bookings by time: covers, table, status and notes, with a red warning sign when the notes mention an allergy or intolerance. Search by name or phone; the chips filter by status (Still to come leaves out cancelled, no-show and checked out). Arrived and Seated sit on each row. The tile shows how many bookings are still on today.'],
        ]}
      />
      <P>
        Tap a booking on either page for its details: time, covers, table, phone (tap to call),
        email, notes and the allergy warning, and the status buttons the restaurant uses (see
        Booking statuses). <strong>Cancelled</strong> and <strong>No show</strong> ask for a second
        tap. People with Bookings View can look but not change.
      </P>
      <P>
        The <strong>+</strong> beside the day makes a booking: pick the restaurant, the day and the
        covers, then one of the times still free for that many (the same times the office and the
        widget offer). The time and its table are held for a few minutes while you add the
        guest's name, phone, email (optional) and notes; <strong>Book</strong> confirms it and the
        list moves to its day. Cancel lets the time go. For a table of your choice, a booking
        that needs another one moved, or a walk-in, use New booking on the office Timeline.
      </P>

      <H3>Viewing all bookings</H3>
      <P>
        The <strong>Bookings</strong> page in the sidebar shows a searchable, filterable list of
        all bookings across all dates — useful for looking up a specific guest or reference number.
      </P>
    </section>
  )
}
