// src/pages/docs/food-safety.jsx
// The Docs page's "Food Safety Logs" section. Docs.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, Mono, DataTable, InfoBox } from './parts.jsx'

export const id = 'food-safety'
export const label = 'Food Safety Logs'
export const order = 150

// ── FOOD SAFETY ─────────────────────────────────
export function Section() {
  return (
    <section id="food-safety" data-doc="">
      <H2>Food Safety Logs</H2>
      <P>
        SFBB-style due-diligence logging, per venue and per day. Migration 076 (core
        tables), 077 (equipment capture times), 090 (hold stations + cooking sessions as
        their own reorderable/manageable entities rather than fixed enums), 142 (cooking
        items: where the cooking-check dish buttons come from).
      </P>
      <H3>Schema</H3>
      <DataTable
        head={['Table', 'Purpose']}
        rows={[
          ['fs_equipment', 'Fridges/freezers being monitored. sort_order for drag-reorder.'],
          ['fs_capture_times', 'Named capture times for equipment checks (e.g. AM/PM) — one column per row in the Equipment grid.'],
          ['fs_temp_logs', 'One row per equipment reading per capture time per day. Out-of-range readings carry a nullable corrective_action.'],
          ['fs_delivery_checks', 'One row per delivery logged: supplier, temp, condition, notes.'],
          ['fs_hold_stations', 'Named hot/cold hold stations (migration 090). sort_order for drag-reorder — replaces an earlier fixed set.'],
          ['fs_hold_capture_times', 'Named capture times for hold checks, same pattern as fs_capture_times.'],
          ['fs_hold_checks', 'One row per hold-station reading per capture time per day.'],
          ['fs_cooking_sessions', 'Named cooking-check sessions (migration 090) — e.g. "Lunch service" — with a required_items_count target and optional time_of_day. sort_order for drag-reorder; a new session goes to the end (max + 1).'],
          ['fs_cooking_settings', 'Migration 142. One row per venue: item_source menus | own | both (no row = menus). Edited in H&S settings, Cooking items (GET/PUT /cooking-settings).'],
          ['fs_cooking_items', 'Migration 142. The venue\'s own cooking-check list: name, optional category (its tab; none = "Our items"), sort_order (drag), is_active (soft delete). /cooking-items CRUD + /cooking-items/reorder.'],
          ['fs_cooking_checks', 'One row per dish checked: menu_item_id (a menu dish) or cooking_item_id (an own-list item, migration 142), or neither for a typed one-off; dish_name always holds the name at the time. core_temp_c, corrective_action.'],
        ]}
      />
      <H3>API</H3>
      <P>
        Mounted at <Mono>/api/food-safety</Mono>, gated by <Mono>requirePermission('food_safety', …)</Mono>.
        Every collection follows the same shape: <Mono>GET</Mono> list for a venue/date,
        <Mono> POST</Mono> create, <Mono>PATCH</Mono> update by id, plus a
        <Mono> /reorder</Mono> endpoint for the three drag-reorderable lists
        (equipment, hold stations, cooking sessions). <Mono>PATCH /cooking/:id</Mono>{' '}
        also takes <Mono>session_id</Mono> (checked against the reading's venue) so a
        reading can be moved to another session. See <Mono>src/routes/foodSafety.js</Mono> for the full
        route list — it mirrors the schema above one-for-one (equipment, capture-times,
        temp-logs, deliveries, hold-stations, hold-capture-times, holds, cooking-sessions,
        cooking, plus a <Mono>GET /defaults</Mono> for the built-in target/min/max per
        equipment type).
      </P>
      <P>
        The cooking picker's tabs and dish buttons come from{' '}
        <Mono>GET /cooking/items?venue_id=</Mono>, which returns{' '}
        <Mono>{'{ item_source, sections: [{ id, title, kind, items: [{ id, name, kind }] }] }'}</Mono>{' '}
        from <Mono>loadCookingPicker()</Mono> in <Mono>services/cookingItems.js</Mono>: menu
        sections of the venue's published menus (venue and tenant-wide), then own-list items
        grouped by category, per <Mono>fs_cooking_settings.item_source</Mono>. The H&amp;S
        test data generator calls the same loader. <Mono>POST /cooking</Mono> takes{' '}
        <Mono>menu_item_id</Mono>, <Mono>cooking_item_id</Mono> or a typed{' '}
        <Mono>dish_name</Mono>, and copies the name into <Mono>dish_name</Mono>.
      </P>
      <H3>Key files</H3>
      <DataTable
        head={['File', 'Purpose']}
        rows={[
          ['api/src/routes/foodSafety.js', 'All food-safety routes.'],
          ['admin/src/pages/FoodSafety.jsx', 'Recording only. Tabs: Today (fridge checks + counts), Deliveries (entry-form + current-week list with click-to-edit), Holds, Cooking. Empty states open H&S settings on the right section.'],
          ['admin/src/components/hs/HsSetup.jsx', 'All food safety setup, shown as sections of the H&S settings window (HsSettings.jsx): SETUP_SECTIONS + HsSetupSection. Fridges & freezers and Hold stations (sortable lists), Fridge check times (/capture-times) and Hold check times (/hold-capture-times, kept separate), Cooking sessions (CookingSessionsSettings from shared.jsx, sortable). Remove/deactivate confirms inline. After any change it invalidates every fs-* query key so open check pages refresh.'],
          ['admin/src/components/foodSafety/shared.jsx', 'Shared panels reused by both FoodSafety.jsx and HSDashboard.jsx widgets — TempChecksTable, DeliveryChecksPanel/Board, HoldChecksTable, CookingChecksPanel, EndOfDayReview. One implementation of each check type, not two. CookingChecksPanel: the session is picked in CookingEntryModal (default: last picked in this panel, else sessionForNow(): on today, the latest session whose time_of_day has passed, else the first); Today\'s checks is grouped by session in sort order with n/required per group, readings without a (live) session last.'],
        ]}
      />
      <InfoBox type="info">
        The Cooking tab's menu-category tabs and dish buttons are deliberately styled like
        till/POS buttons (fixed height, tighter width, distinct <Mono>bg-muted/60</Mono> fill)
        since this is used mid-service on a tablet, not a form to fill in at a desk.
      </InfoBox>
      <H3>Reading pre-fill + touch keypad</H3>
      <P>
        <Mono>TempCell</Mono> / <Mono>HoldCell</Mono> initialise their local <Mono>value</Mono>{' '}
        state from <Mono>equipment.min_temp_c</Mono> / <Mono>station.min_temp_c</Mono>{' '}
        (the lower end of that equipment's configured range) when no reading exists yet,
        instead of an empty string behind a placeholder. This is display-only — the existing
        autosave path (<Mono>onChange</Mono> / <Mono>onBlur</Mono> / stepper tap) is what
        actually persists a log row, so an untouched cell never fakes a reading.
      </P>
      <P>
        On touch devices (<Mono>navigator.maxTouchPoints &gt; 0</Mono>, the same{' '}
        <Mono>IS_TOUCH</Mono> detection pattern as <Mono>NewBookingModal</Mono>'s covers
        stepper), the temp cell renders as a button instead of a native{' '}
        <Mono>&lt;input&gt;</Mono>; tapping it opens <Mono>TempKeypadModal</Mono> — a
        full-screen centred modal (never clipped by the check table's own scroll container)
        supporting one decimal place and a <Mono>±</Mono> sign toggle for negative freezer
        readings. This exists because some touch platforms (confirmed on at least one
        Linux/Chrome tablet) never surface their on-screen keyboard for a text/number input
        — a platform limitation <Mono>inputMode="decimal"</Mono> can't fix, so the app
        stops depending on it entirely for this field. Applied to{' '}
        <Mono>TempCell</Mono>, <Mono>HoldCell</Mono>, and <Mono>CookingEntryModal</Mono>'s
        core-temp field.
      </P>
      <P>
        Each row in the Cooking tab's "Today's checks" list is a button; tapping it opens{' '}
        <Mono>CookingEntryModal</Mono> with <Mono>target.existingCheck</Mono> set, which
        seeds <Mono>checkId</Mono>/<Mono>temp</Mono>/<Mono>note</Mono> from that row —{' '}
        <Mono>persist()</Mono> already routed to <Mono>onUpdate</Mono> whenever{' '}
        <Mono>checkId</Mono> is set, so this only needed the initialisation path, not new
        save logic. The dish name is shown as the modal title but isn't editable, matching{' '}
        <Mono>CookingPatch</Mono>'s schema (only <Mono>core_temp_c</Mono> /{' '}
        <Mono>corrective_action</Mono> can change once a check exists).
      </P>
      <P>
        <Mono>DELETE /api/food-safety/cooking/:id</Mono> hard-deletes a{' '}
        <Mono>fs_cooking_checks</Mono> row (no soft-delete flag on this table, and nothing
        else references its id, unlike the config entities above which use{' '}
        <Mono>is_active</Mono>). The <Mono>CookingEntryModal</Mono>'s "Delete this reading"
        control only renders when <Mono>checkId</Mono> is set (i.e. editing an existing
        check, not logging a new one) and requires an inline double-confirm (Standard
        Design Rule #6) before calling it.
      </P>
    </section>
  )
}
