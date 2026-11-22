// src/pages/help/venues.jsx
// The Help page's "Managing Venues" section. Help.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, InfoBox } from './parts.jsx'

export const id = 'venues'
export const label = 'Managing Venues'
export const order = 50

// ── VENUES ──────────────────────────────────────
export function Section() {
  return (
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
  )
}
