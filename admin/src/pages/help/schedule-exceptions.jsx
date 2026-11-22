// src/pages/help/schedule-exceptions.jsx
// The Help page's "Schedule Exceptions" section. Help.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, InfoBox, DataTable } from './parts.jsx'

export const id = 'schedule-exceptions'
export const label = 'Schedule Exceptions'
export const order = 90

// ── SCHEDULE EXCEPTIONS ─────────────────────────
export function Section() {
  return (
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
  )
}
