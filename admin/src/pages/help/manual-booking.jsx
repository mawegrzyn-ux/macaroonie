// src/pages/help/manual-booking.jsx
// The Help page's "Manual Booking" section. Help.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, InfoBox } from './parts.jsx'

export const id = 'manual-booking'
export const label = 'Manual Booking'
export const order = 130

// ── MANUAL BOOKING ──────────────────────────────
export function Section() {
  return (
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
  )
}
