// src/pages/docs/hs-action-log.jsx
// The Docs page's "H&S Action Log" section. Docs.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, Mono, DataTable, InfoBox } from './parts.jsx'

export const id = 'hs-action-log'
export const label = 'H&S Action Log'
export const order = 220

// ── H&S ACTION LOG ──────────────────────────────
export function Section() {
  return (
    <section id="hs-action-log" data-doc="">
      <H2>H&amp;S Action Log</H2>
      <P>
        Migration 092. A general facilities/compliance to-do list per venue — migrated from
        the legacy spreadsheet's "ActionLog" tab (Date, Category, Task, Details, Assigned To,
        Due Date, Priority, Completed, Notes, Attachments). Not date-scoped like the other
        food-safety checks — an entry stays open across days until completed.
      </P>
      <H3>Schema</H3>
      <DataTable
        head={['Table', 'Purpose']}
        rows={[
          ['hs_action_categories', 'Tenant-managed, reorderable named list (same pattern as fs_hold_stations — soft-deleted via is_active, not a fixed enum). Seeded with the spreadsheet\'s four categories (Repairs, Records, Training, Cleaning) for every tenant.'],
          ['hs_action_log', 'One row per action item. category_id (nullable FK, ON DELETE SET NULL), logged_date, task, details, assigned_to (free text — historical assignee names were inconsistent nicknames, not a clean FK target), due_date, priority enum (low/medium/high/critical), is_completed + completed_by + completed_at, notes, attachment_media_id (nullable FK to media_items), created_by.'],
        ]}
      />
      <InfoBox type="warn">
        <Mono>completed_by</Mono> / <Mono>created_by</Mono> are plain <Mono>text</Mono> columns
        storing <Mono>req.user.email</Mono>, not a FK to <Mono>users(id)</Mono> — matching
        <Mono> checklist_instances.completed_by</Mono>'s existing convention exactly. Don't
        "fix" these to a uuid FK without also changing that convention everywhere else.
      </InfoBox>
      <H3>API</H3>
      <P>
        Mounted at <Mono>/api/hs-action-log</Mono>, gated by <Mono>requirePermission('hs_action_log', …)</Mono>.
        Category CRUD + <Mono>PATCH /categories/reorder</Mono> follows the exact
        fs_hold_stations pattern. Entries: <Mono>GET /entries?venue_id=&amp;status=open|completed|all&amp;category_id=</Mono>,
        <Mono> POST</Mono>, generic <Mono>PATCH /entries/:id</Mono>, and a dedicated
        <Mono> PATCH /entries/:id/complete</Mono> that always sets
        <Mono> completed_by</Mono>/<Mono>completed_at</Mono> server-side from the caller's
        JWT — never trust a client-supplied value for who completed something.
      </P>
      <H3>Attachments</H3>
      <P>
        Reuses the existing Media library rather than a bespoke upload path.
        <Mono> MediaLibraryModal</Mono> in <Mono>picker</Mono> mode returns
        <Mono> (url, item)</Mono> to <Mono>onPick</Mono>; the entry stores
        <Mono> item.id</Mono> as <Mono>attachment_media_id</Mono> (a real FK) and keeps the
        URL only for display. Media library uploads are image-only
        (<Mono>ALLOWED_MIMES</Mono> in <Mono>media.js</Mono>) — matches the spreadsheet's
        observed use case (photo evidence), not PDFs.
      </P>
      <H3>Key files</H3>
      <DataTable
        head={['File', 'Purpose']}
        rows={[
          ['api/src/routes/hsActionLog.js', 'All Action Log routes.'],
          ['admin/src/components/hsActionLog/shared.jsx', 'HSActionLogPanel — the one implementation, reused by the standalone page and the H&S Dashboard\'s action_log widget. Also the category-management modal.'],
          ['admin/src/pages/HSActionLog.jsx', 'Standalone page at /hs-action-log — just a venue picker + HSActionLogPanel.'],
        ]}
      />
    </section>
  )
}
