// src/pages/help/food-safety.jsx
// The Help page's "Food Safety Logs" section. Help.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, InfoBox, DataTable } from './parts.jsx'

export const id = 'food-safety'
export const label = 'Food Safety Logs'
export const order = 170

// ── FOOD SAFETY ─────────────────────────────────
export function Section() {
  return (
    <section id="food-safety" data-help="">
      <H2>Food Safety Logs</H2>
      <P>
        The <strong>Food safety</strong> page (sidebar nav) is your SFBB-style due-diligence
        record: fridge/freezer temperatures, delivery checks, hot/cold holding, and
        cooking/reheat checks, all logged per venue and per day. Every reading autosaves
        as soon as you type or tap a stepper — there is no separate Save button to forget.
      </P>
      <H3>Tabs</H3>
      <DataTable
        head={['Tab', 'What it is']}
        rows={[
          ['Today', 'Fridge/freezer temperature checks, plus a count of today\'s deliveries, hold checks and cooking checks. One row per fridge or freezer, one column per fridge check time (e.g. AM/PM). Each unlogged reading starts pre-filled at the low end of that fridge\'s normal range, so you only need to nudge the +/- steppers or overtype it — nothing saves until you actually touch the cell.'],
          ['Deliveries', 'Log a delivery: supplier, temperature, condition. The main view is an entry form on one side and a list of this week\'s deliveries on the other — click any item in the list to load it back into the form for editing.'],
          ['Holds', 'Hot-hold and cold-hold checks for food kept warm/cold for service. Same layout (and same pre-filled reading) as the fridge checks on Today, one column per hold check time.'],
          ['Cooking', 'Cooking/reheat core-temperature checks. Pick a category tab, then tap the dish you just cooked (the dishes come from your menus, your own cooking list, or both: see Cooking items in H&S settings) — no typing a dish name each time. In the pop-up, pick the session (Lunch, Dinner, ...) the reading belongs to and dial in the core temperature (target: ≥75°C for 30 seconds, or FSA equivalents). The session starts on the one you picked last, or on today\'s current session by its time. The "Today\'s checks" list on the right is grouped by session, each with how many of its required items are done (e.g. 1/2). Tap any entry to reopen it, move it to another session, correct the reading, or delete it (double-confirm) if it was logged in error.'],
        ]}
      />
      <H3>Setting it up (H&amp;S settings)</H3>
      <P>
        Everything the checks are built from is set up in <strong>H&amp;S settings</strong>
        (the button at the top of the Food safety, Checklists and H&amp;S Dashboard pages).
        Pick the venue at the top right of the settings window, then a section:
      </P>
      <DataTable
        head={['Section', 'What you set up']}
        rows={[
          ['General', 'Follow restaurant opening days (owners and admins, all venues). See Closed days below.'],
          ['Fridges & freezers', 'Each fridge or freezer with its target, min and max temperature. Drag the handle to set the order they appear.'],
          ['Fridge check times', 'When fridge and freezer temperatures are checked each day (e.g. 09:00 Opening, 17:00 Evening). Leave empty for one reading per day.'],
          ['Hold stations', 'Hot and cold holding stations (bain-marie, salad bar, ...) with their safe range. Drag to reorder.'],
          ['Hold check times', 'When hold checks happen each day. Kept separate from the fridge check times.'],
          ['Cooking sessions', 'How many times a day cooking checks happen (e.g. Lunch, Dinner), with an optional time and how many items must be checked in each. Drag the handle to set their order.'],
          ['Cooking items', 'Which dishes the cooking check buttons show: Menus (the venue\'s published menus, one tab per menu section), Our own items (a list you keep here, one tab per category), or Both. Choose and tap Save. Add your own items with a name and an optional category; items without a category go under "Our items". Drag to reorder. Whatever the choice, "Log a dish not on the list" still lets you type any dish.'],
        ]}
      />
      <P>
        Removing or deactivating anything asks you to confirm first. Readings already logged
        are kept. Deliveries need no setup: the supplier is typed in with each delivery.
      </P>
      <H3>Out-of-range readings</H3>
      <P>
        Any reading outside its configured min/max shows in red immediately — you don't
        need to add a corrective action before it saves. The <strong>Corrective actions</strong>
        button (visible on every tab) cycles through every reading for the day that's still
        out of range and missing a note, so nothing gets forgotten by end of service.
      </P>
      <InfoBox type="tip">
        Every check type here (Equipment, Deliveries, Holds, Cooking) can also be added as
        its own widget on a custom <strong>H&amp;S Dashboard</strong> — see that section
        below if you want several of these side by side with a checklist on one screen.
      </InfoBox>
      <InfoBox type="info">
        On a touch tablet, tapping a temperature field opens a built-in on-screen keypad
        (digits, a decimal point, and a +/- sign for freezer readings) instead of trying to
        bring up your device's own keyboard. This is deliberate — some touch devices (seen
        on at least one Linux/Chrome tablet) never show their native keyboard for this kind
        of field, so the app no longer depends on it.
      </InfoBox>
    </section>
  )
}
