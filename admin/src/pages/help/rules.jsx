// src/pages/help/rules.jsx
// The Help page's "Booking Rules" section. Help.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, InfoBox } from './parts.jsx'

export const id = 'rules'
export const label = 'Booking Rules'
export const order = 100

// ── RULES ───────────────────────────────────────
export function Section() {
  return (
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
  )
}
