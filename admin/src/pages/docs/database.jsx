// src/pages/docs/database.jsx
// The Docs page's "Database Schema" section. Docs.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, Mono } from './parts.jsx'

export const id = 'database'
export const label = 'Database Schema'
export const order = 110

// ── DATABASE ────────────────────────────────────
export function Section() {
  return (
    <section id="database" data-doc="">
      <H2>Database Schema</H2>
      <div className="space-y-2.5 mb-6">
        {[
          ['tenants', 'One row per restaurant group.', 'id, name, slug, auth0_org_id'],
          ['venues', 'A physical restaurant location.', 'tenant_id, name, timezone, is_active'],
          ['venue_sections', 'Logical table groupings (Main Floor, Terrace, etc.).', 'venue_id, name, sort_order'],
          ['tables', 'Individual bookable tables. is_unallocated flags the system-managed "Unallocated" pseudo-table auto-created by the smart-relocate engine.', 'venue_id, section_id, label, min_covers, max_covers, sort_order, is_active, is_unallocated'],
          ['table_combinations', 'Pre-configured merged table sets for larger parties.', 'venue_id, name, min_covers, max_covers, is_active'],
          ['table_combination_members', 'Junction table — which tables belong to a combination.', 'combination_id, table_id (composite PK)'],
          ['schedule_templates', 'Weekly schedule template per venue. One row per venue.', 'venue_id'],
          ['schedule_sittings', 'Named service period within a day-of-week (e.g. Lunch Mon–Fri).', 'template_id, dow, name, start_time, end_time, slot_duration_mins, slot_interval_mins, max_covers, doors_close_time'],
          ['venue_sittings', 'Sitting within a weekly template day. name column (nullable) holds an optional session label (e.g. "Lunch", "Dinner") added in migration 023_sitting_names.sql.', 'template_id, opens_at, closes_at, default_max_covers, doors_close_time, sort_order, name text nullable'],
          ['override_sittings', 'Sitting for a specific date override. Also has name (nullable) from migration 023.', 'override_id, opens_at, closes_at, default_max_covers, doors_close_time, sort_order, name text nullable'],
          ['schedule_overrides', 'Replaces sittings for a specific date (bank holidays, closures).', 'venue_id, override_date, is_closed'],
          ['slot_caps', 'Per-slot cover cap overrides. Sparse — only stored when different from sitting default.', 'sitting_id, slot_time, max_covers'],
          ['schedule_exceptions', 'Named date-range exception with optional alternative weekly schedule. is_closed=true closes the period entirely.', 'venue_id, name, date_from, date_to, is_closed, priority'],
          ['exception_day_templates', 'Per-DOW schedule within an exception. Overrides weekly template for that day.', 'exception_id, day_of_week, is_open, slot_interval_mins'],
          ['exception_sittings', 'Sittings for an exception day template. Also has name (nullable) from migration 023.', 'template_id, opens_at, closes_at, default_max_covers, doors_close_time, sort_order, name text nullable'],
          ['exception_sitting_slot_caps', 'Sparse per-slot cover cap overrides within exception sittings.', 'sitting_id, slot_time, max_covers'],
          ['booking_rules', 'Per-venue booking constraints. Smart-allocation flags, status-flow toggles (unconfirmed, reconfirmed, arrived).', 'venue_id, hold_ttl_secs, min_covers, max_covers, cutoff_before_mins, slot_duration_mins, allow_cross_section_combo, allow_non_adjacent_combo, allow_widget_bookings_after_doors_close, enable_unconfirmed_flow, enable_reconfirmed_status, enable_arrived_status'],
          ['deposit_rules', 'Per-venue deposit for online bookings (Booking rules page). refund_hours_before NULL = kept when the guest cancels (CHECK >= 0, migration 220).', 'venue_id, requires_deposit, deposit_type fixed | per_cover, deposit_amount (pounds), currency, refund_hours_before'],
          ['booking_holds', 'Temporary slot reservations. UNIQUE (table_id, starts_at). A deposit hold carries its PaymentIntent and lives at least 15 minutes (migration 220).', 'venue_id, table_id, combination_id, starts_at, ends_at, expires_at, guest_name, guest_email, guest_notes, stripe_pi_id, stripe_account, deposit_pence'],
          ['bookings', 'Confirmed bookings.', 'venue_id, table_id, combination_id, starts_at, ends_at, covers, status, reference, guest_name, guest_email, guest_phone, guest_notes, operator_notes, customer_id'],
          ['customers', 'Customer profiles with GDPR support. Auto-created on booking confirm. is_anonymised flag for GDPR erasure.', 'tenant_id, name, email, phone, notes, is_anonymised, anonymised_at, created_at'],
          ['payments', 'Booking deposits, one row per paid booking (UNIQUE stripe_pi_id). status succeeded | partially_refunded | refunded; refund_hours_before copied from the rule when paid; refund_ids are Stripe refund ids already counted (migration 220).', 'booking_id, stripe_pi_id, stripe_account, amount, currency, status, refunded_amount, refund_hours_before, refund_ids'],
          ['disallowed_table_pairs', 'Junction table — specific table pairs the smart-allocation engine must never combine. Normalised so table_id_a < table_id_b.', 'venue_id, tenant_id, table_id_a, table_id_b (UNIQUE)'],
        ].map(([name, desc, cols]) => (
          <div key={name} className="border rounded-lg p-3">
            <div className="flex flex-wrap items-baseline gap-2 mb-1">
              <code className="text-primary font-semibold text-sm">{name}</code>
              <span className="text-xs text-muted-foreground">{desc}</span>
            </div>
            <p className="text-xs font-mono text-muted-foreground">{cols}</p>
          </div>
        ))}
      </div>
      <H3>Key constraints</H3>
      <ul className="list-disc list-inside space-y-1.5 text-sm text-muted-foreground ml-2">
        <li><Mono>UNIQUE (table_id, starts_at)</Mono> on <Mono>booking_holds</Mono> — DB-level race guard</li>
        <li><Mono>confirm_hold()</Mono> uses <Mono>FOR UPDATE NOWAIT</Mono> at confirm time — second anti-double-booking layer</li>
        <li>Slots are <strong>never stored</strong> — always computed by <Mono>get_available_slots()</Mono> PG function</li>
        <li>RLS policies on every tenant table scoped by <Mono>current_setting('app.tenant_id', true)</Mono></li>
      </ul>
    </section>
  )
}
