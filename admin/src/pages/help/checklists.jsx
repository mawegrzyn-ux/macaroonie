// src/pages/help/checklists.jsx
// The Help page's "Checklists" section. Help.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, InfoBox, DataTable } from './parts.jsx'

export const id = 'checklists'
export const label = 'Checklists'
export const order = 180

// ── CHECKLISTS ──────────────────────────────────
export function Section() {
  return (
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
  )
}
