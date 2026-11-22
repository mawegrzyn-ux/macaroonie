// src/pages/help/schedule.jsx
// The Help page's "Setting Your Schedule" section. Help.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, InfoBox } from './parts.jsx'

export const id = 'schedule'
export const label = 'Setting Your Schedule'
export const order = 80

// ── SCHEDULE ────────────────────────────────────
export function Section() {
  return (
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
  )
}
