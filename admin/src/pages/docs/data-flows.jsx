// src/pages/docs/data-flows.jsx
// The Docs page's "Data Flows" section. Docs.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, Mono, Code, DataTable, InfoBox } from './parts.jsx'

export const id = 'data-flows'
export const label = 'Data Flows'
export const order = 460

// ── DATA FLOWS ──────────────────────────────────
export function Section() {
  return (
    <section id="data-flows" data-doc="">
      <H2>Data Flows</H2>

      <H3>Hold lifecycle</H3>
      <Code>{`Guest presses "Book"
  → POST /bookings/holds
      UNIQUE (table_id, starts_at) guards concurrent requests
      expires_at = now() + hold_ttl_secs (default 300s)
  → Widget shows countdown from expires_at

Guest cancels or abandons
  → DELETE /bookings/holds/:id → slot freed immediately
  → Stripe PI cancelled if attached

── Deposit venues (widget only) ───────────────────────────
  → POST /widget-api/venues/:id/holds/:hold/deposit
      PaymentIntent on the group's Stripe account, hold kept 15 min
  → Guest pays in the widget (Payment Element, 3DS in place)
  → POST .../deposit/confirm  (or the Connect webhook, whichever first)
      Stripe asked → settleDeposit()
        confirm_hold(hold_id, tenant_id, allow_expired)
        → INSERT bookings + payments, DELETE booking_holds
        (table gone → deposit refunded, guest picks another time)
      broadcastBooking('booking.created') → WS push to Timeline

── Free booking (no deposit) ───────────────────────────────
  → POST /bookings
      confirm_hold() → INSERT bookings, DELETE holds
      broadcastBooking() → WS push

── Hold expiry (no guest action) ───────────────────────────
  → pg_cron: SELECT sweep_expired_holds() every minute
  → BullMQ holdSweepQueue: fallback sweep`}</Code>

      <H3>Slot generation (never stored)</H3>
      <Code>{`GET /slots?venue_id=&date=&covers=
  → calls get_available_slots(venue_id, date, covers) PG function

Function logic (slot resolution priority):
  Priority 1 — Schedule exceptions (highest priority / narrowest date range wins on equal priority)
  Priority 2 — Single-date overrides (schedule_date_overrides)
  Priority 3 — Weekly template (venue_schedule_templates)

  1. Check schedule_exceptions for matching date range
       is_closed = true → return empty
       exception found → use exception day template sittings
       no exception → check schedule_overrides for exact date
         is_closed = true → return empty
         has override sittings → use those
         no match → fall back to weekly template (day-of-week)
  2. For each sitting: generate candidates at slot_interval_mins
  3. For each candidate:
       → look up slot_caps (sparse) or use sitting.max_covers
       → subtract active bookings in [starts_at, ends_at)
       → subtract non-expired holds in same window
       → also block slots where combination member table is held/booked
  4. zero_cap_display:
       'hidden'      → skip slot entirely
       'unavailable' → return with available=false
  5. Return per-slot: {
       slot_time, available, available_covers, reason,
       table_id, combination_id,
       sitting_closes_at,   ← last order time for this sitting
       sitting_doors_close  ← doors close time (nullable)
     }

Note: a slot is generated if slot_time < closes_at, even if
slot_time + duration would run past closes_at. The frontend
shows a warning in the booking modal when the booking end
time would exceed sitting_closes_at or sitting_doors_close.`}</Code>

      <H3>Combination tile spanning (Timeline)</H3>
      <P>
        Combination bookings span multiple table rows in the Timeline. The{' '}
        <Mono>comboSpanMap</Mono> useMemo computes, for each combination booking, which member
        tables are <em>adjacent</em> in the rendered row order. Adjacent tables collapse into
        one tall card (height = ROW_HEIGHT × n). Non-adjacent groups each render as independent
        tiles at their respective positions.
      </P>
      <Code>{`// Booking covers T1, T2, T4 — row order: T1=0, T2=1, T3A=2, T4=3
comboSpanMap:
  T1 → spanRows: 2   (primary of [T1,T2] group; tall card)
  T2 → spanRows: 0   (secondary; not rendered — covered by T1 card)
  T4 → spanRows: 1   (primary of [T4] group; normal-height tile)`}</Code>

      <H3>Smart relocation — drag-to-table flow</H3>
      <P>
        When an operator drags a booking tile onto a <em>different</em> table row, the frontend
        calls <Mono>PATCH /bookings/:id/relocate</Mono> with the target table ID. The API runs
        the following allocation algorithm atomically:
      </P>
      <Code>{`PATCH /bookings/:id/relocate  { target_table_id, starts_at? }

1. Compute new time window (preserve original duration)

2. Find allocation for target table + booking.covers:
   a. Single table — target alone fits covers  →  use it
   b. Combination — find smallest combo containing target that fits
   c. Adjacency expansion — expand outward from target by sort_order
      (alternates above / below) until total max_covers ≥ covers

2b. Load allocation rules (allow_cross_section_combo, allow_non_adjacent_combo)
    and disallowed_table_pairs for the venue — used as filters in steps 3b/3c

3. For 2+ table allocation: look up existing combination with exactly those members
   → found: use it
   → not found: throw 422 "Create a table combination first"
   (Step 3 no longer auto-creates combinations)

4. Conflict scan — find bookings overlapping the new time window
   on any of the allocated tables (including combo member tables)

5. For each conflict:
   a. Find a free single table with enough capacity for the
      conflict's covers (not already claimed in this transaction)
   b. If found  →  cascade-move conflict there
   c. If not    →  move conflict to the Unallocated table

6. Auto-create Unallocated table if needed (sort_order −999,
   is_unallocated = true — created once per venue on first use)

7. Execute all UPDATEs, broadcast every changed booking via WS

Returns: { moved: Booking, displaced: Booking[] }`}</Code>

      <H3>Unallocated table</H3>
      <P>
        The Unallocated table is a system-managed pseudo-table (one per venue, auto-created).
        It is excluded from slot availability, widget selection, and normal table editors.
        In the Timeline it renders as an orange row at the very top, only when it contains bookings.
      </P>
      <DataTable
        head={['Property', 'Value', 'Notes']}
        rows={[
          ['is_unallocated', 'true', 'Filters it out of normal sections, slot queries, widget'],
          ['sort_order', '−999', 'Ensures it sorts before all real tables'],
          ['max_covers', '9999', 'Accepts any booking regardless of party size'],
          ['label', 'Unallocated', 'Displayed in the Timeline orange row header'],
          ['Drop target', 'Blocked', 'Cannot manually drop bookings onto it — detected via isUnallocated flag in droppable data'],
          ['Drag source', 'Allowed', 'Booking can be dragged out → triggers another /relocate call'],
        ]}
      />

      <H3>Table sort order &amp; adjacency</H3>
      <P>
        The <Mono>sort_order</Mono> column on <Mono>tables</Mono> drives two things simultaneously:
        (1) the vertical row order in the Timeline and (2) which tables the smart-allocate engine
        considers "adjacent" when building an adjacency expansion. Setting order via the Tables
        page "Reorder" mode therefore directly controls smart-allocation behaviour.
      </P>
      <Code>{`// Tables page Reorder mode calls:
PATCH /venues/:id/tables/reorder  { ids: [uuid, uuid, ...] }
// Sets sort_order = 0, 1, 2 … for each ID in the submitted order

// Timeline renders rows by:
ORDER BY sort_order, label

// Adjacency expansion in /relocate:
allTables sorted by sort_order → target at index i
→ expand lo/hi outward (alternating above/below)
   until sum(max_covers) ≥ booking.covers`}</Code>

      <H3>Z-order hierarchy (Timeline)</H3>
      <DataTable
        head={['Element', 'z-index', 'Notes']}
        rows={[
          ['Session-start line overlays', '2', 'One position:absolute full-height div per sitting at LABEL_WIDTH + x (from sessionStartXs array). pointer-events:none. Renders behind booking cards. TimelineHeader renders matching lines inside its canvas div when headerBgStrips is on.'],
          ['Overlap stop-sign badge', '10 (within tile)', 'position:absolute span inside BookingCard. Rendered when overlappingIds.has(booking.id). Tile also gets ring-2 ring-red-500 ring-inset. Detection is frontend-only — computed from bookingsRes in-memory array.'],
          ['Normal booking card', '1', 'CSS .timeline-slot default'],
          ['Spanning combo card', '5', 'Inline override — above row borders'],
          ['Canvas with spanning card', '3', 'Creates stacking context above subsequent rows'],
          ['Secondary combo row canvas', '4 + pointer-events:none', 'Paints gradient background above primary z=3; transparent holes let spanning card show through; pointer-events:none passes click/drag to primary card'],
          ['Sticky label column', '10', 'Always above all booking cards'],
          ['Sticky header row', '12', 'Topmost sticky element'],
          ['DragOverlay ghost', '999', 'Portal-rendered — always on top of everything'],
        ]}
      />

      <InfoBox type="warn">
        A deposit booking is only made once the server has read the PaymentIntent back from Stripe
        (the widget&apos;s confirm or the Connect webhook, through <Mono>settleDeposit()</Mono>), never on the
        browser&apos;s word. <Mono>confirm_hold()</Mono> uses{' '}
        <Mono>FOR UPDATE NOWAIT</Mono> to prevent double-booking under concurrent requests.
      </InfoBox>
    </section>
  )
}
