// src/pages/help/hs-action-log.jsx
// The Help page's "H&S Action Log" section. Help.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, InfoBox } from './parts.jsx'

export const id = 'hs-action-log'
export const label = 'H&S Action Log'
export const order = 250

// ── H&S ACTION LOG ──────────────────────────────
export function Section() {
  return (
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
  )
}
