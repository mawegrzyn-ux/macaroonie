// src/pages/docs/checklists.jsx
// The Docs page's "Checklists" section. Docs.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, Mono, DataTable, InfoBox } from './parts.jsx'

export const id = 'checklists'
export const label = 'Checklists'
export const order = 160

// ── CHECKLISTS ──────────────────────────────────
export function Section() {
  return (
    <section id="checklists" data-doc="">
      <H2>Checklists</H2>
      <P>
        Operator-defined recurring checklists (migration 083) — unlike Food safety, there
        is no fixed set of built-in checks. Tenants build their own templates with any
        number of tasks and a daily/weekly/monthly due schedule.
      </P>
      <H3>Schema</H3>
      <DataTable
        head={['Table', 'Purpose']}
        rows={[
          ['checklist_templates', 'One row per checklist definition: name, department, frequency (daily/weekly/monthly), due_day_of_week / due_day_of_month, sort_order.'],
          ['checklist_template_items', 'Ordered tasks belonging to a template. sort_order for drag-reorder.'],
          ['checklist_instances', 'One row per template per calendar occurrence (a specific day/week/month) — created on first interaction, not pre-generated. Records completed_by / completed_at.'],
          ['checklist_instance_items', 'Tick state per instance per template item.'],
        ]}
      />
      <H3>API</H3>
      <P>
        Mounted at <Mono>/api/checklists</Mono>, gated by <Mono>requirePermission('checklists', …)</Mono>.
        <Mono> GET /due</Mono> returns every template due for a venue/date. <Mono>GET
        /instance</Mono> + <Mono>PUT /instance</Mono> load/save the tick state for one
        template on one date — the instance row is created lazily on first PUT. There is
        no complete action: <Mono>PUT /instance</Mono> sets status{' '}
        <Mono>completed</Mono> when every active template item is ticked (keeping the first{' '}
        <Mono>completed_by</Mono>/<Mono>completed_at</Mono> while it stays complete) and{' '}
        <Mono>in_progress</Mono> with both cleared otherwise. Tick all is the client sending
        every item checked. Template
        CRUD and item CRUD/reorder live under <Mono>/templates</Mono> and
        <Mono> /templates/:id/items</Mono>.
      </P>
      <H3>Closed days: follow opening days (migration 124)</H3>
      <P>
        <Mono>tenants.hs_follow_opening_days</Mono> (boolean, default false) is one switch for
        all H&amp;S: when on, a venue's closed days expect no daily checklists and no fridge,
        hold or cooking checks. "Closed" comes only from{' '}
        <Mono>services/openDays.js</Mono> (the same resolver Cash Recon and the Rota use:
        exception, then date override, then weekly template). <Mono>openDatesOrNull()</Mono>{' '}
        returns null for a venue with no weekly template (treated as open every day) and{' '}
        <Mono>hsClosedDates()</Mono> returns the closed subset of a date list, empty when the
        setting is off.
      </P>
      <DataTable
        head={['Where', 'Effect']}
        rows={[
          ['GET/PATCH /api/hs-settings', 'routes/hsSettings.js. GET ?venue_id=&date= returns { follow_opening_days, closed } (view on any of food_safety, checklists, hs_dashboard, dashboard); PATCH { follow_opening_days } is owner/admin.'],
          ['GET /api/checklists/due', 'Each row gains not_required: true for daily templates when the venue is closed that day. Weekly and monthly rows are never not_required.'],
          ['GET /api/dashboard-tiles/hs-status', 'computeHsStatus() drops daily checklists and fridge/hold/cooking from expected (and completed) on a closed venue-day; unresolved out-of-range readings still count. Venue-days and days gain closed; status is \'closed\' when nothing is expected or unresolved, future days included. Checklist breakdown rows carry not_required.'],
          ['Admin', 'components/hs/HsSettings.jsx: HsSettingsButton({ venueId, section, label }) opens the H&S settings window (General = this switch, owner/admin; the food safety setup sections from HsSetup.jsx need food_safety manage) on the page\'s venue. Used by Food safety, Checklists and the H&S Dashboard header (config.HeaderExtra, now passed venueId). ClosedDayNotice (those pages, config.Notice, MobileHSDashboard). Checklists Today groups not_required rows; Dashboard.jsx has a closed status style.'],
        ]}
      />
      <H3>Key files</H3>
      <DataTable
        head={['File', 'Purpose']}
        rows={[
          ['api/src/routes/checklists.js', 'All checklist routes.'],
          ['admin/src/pages/Checklists.jsx', 'Two tabs: Today (tick off what\'s due) and Checklists (the template builder).'],
          ['admin/src/components/checklists/shared.jsx', 'ChecklistRunPanel — the tick-list UI, reused as-is by both Checklists.jsx and the H&S Dashboard\'s checklist widget, with a Tick all button. Accepts a hideHeader + onStateChange mode ({ isCompleted, isPending, hasItems, tickAll, untickAll }) so the host renders ChecklistHeaderAction (Tick all, then an All done badge that offers a confirmed Untick all) in its own header.'],
        ]}
      />
      <InfoBox type="info">
        Completion used to be a separate step (a Complete button, then Reopen with a
        double confirm). Since October 2026 it follows the ticks only, so the dashboard
        widgets and the Checklists page can never disagree about it, and fixing a task is
        just unticking it.
      </InfoBox>
      <H3>Legacy spreadsheet import</H3>
      <P>
        <Mono>services/legacyImportSvc.js</Mono> (used by <Mono>routes/legacyImport.js</Mono>, the
        Legacy data import page, and <Mono>scripts/import-legacy-checklists.js</Mono>) reads the old
        CAFE_MANAGER workbook into checklist instances and food-safety logs. It never creates
        checklist templates: each checklist sheet is matched to an existing template of the same
        frequency whose task labels cover at least half of the sheet's columns. Preview and
        commit run the same code; only the transaction outcome differs. Reruns only fill gaps.
      </P>
      <DataTable
        head={['Sheet', 'Goes to']}
        rows={[
          ['KitchenDayChecklist, KitchenDayClosingChecklist', 'Daily templates, matched by exact task label'],
          ['KitchenWeekChecklist', 'Weekly template, matched by exact task label'],
          ['KitchenMonthChecklist', 'Monthly template, matched by exact task label'],
          ['Monthly Audit', 'Monthly H&S audit template. Questions matched by their number (1.1.0 ... 3.2.6) at the start of the task label, else by exact text; per-question Notes columns go to checklist_instance_items.notes; Completed By to completed_by'],
          ['FridgeFreezerChecksAM / PM', 'fs_temp_logs (creates equipment + AM/PM capture times if missing)'],
          ['HotFoodCheck', 'fs_cooking_checks'],
          ['DeliveryCheck', 'fs_delivery_checks'],
        ]}
      />
    </section>
  )
}
