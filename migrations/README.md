# Database Migrations

PostgreSQL migrations for the restaurant Macaroonie.
Run in order. Each file is idempotent-safe when run fresh on an empty DB.

## Run order

| File | What it creates |
|------|----------------|
| `001_tenants_users.sql` | `tenants`, `users`, `set_updated_at()` trigger function |
| `002_venues.sql` | `venues`, `venue_sections`, `tables` |
| `003_schedules.sql` | `venue_schedule_templates`, `venue_sittings`, `sitting_slot_caps`, `schedule_date_overrides`, `override_sittings`, `override_slot_caps` |
| `004_booking_rules.sql` | `booking_rules`, `deposit_rules` |
| `005_bookings.sql` | `booking_holds`, `bookings`, `payments`, `notification_log` |
| `006_functions.sql` | `sweep_expired_holds()`, `get_available_slots()`, `confirm_hold()` |
| `007_seed_example.sql` | Dev seed data — **do not run in production** |

## Apply

```bash
# Run all migrations against a local DB
psql $DATABASE_URL -f migrations/001_tenants_users.sql
psql $DATABASE_URL -f migrations/002_venues.sql
psql $DATABASE_URL -f migrations/003_schedules.sql
psql $DATABASE_URL -f migrations/004_booking_rules.sql
psql $DATABASE_URL -f migrations/005_bookings.sql
psql $DATABASE_URL -f migrations/006_functions.sql

# Dev seed only
psql $DATABASE_URL -f migrations/007_seed_example.sql
```

Or with a migration runner (recommended for production):
```bash
# Using node-pg-migrate, Flyway, or Liquibase
# Rename files to match your runner's naming convention
```

## RLS: how it works

Every table (except `tenants`) has RLS enabled.

The API sets the tenant context at the start of every transaction:

```sql
SET LOCAL app.tenant_id = '<uuid>';
```

Every RLS policy is:
```sql
USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
```

**Important**: use transaction-mode connection pooling (PgBouncer transaction mode).
Session-mode pooling will leak tenant context across connections.

## Slot resolver

`get_available_slots(venue_id, date, covers)` returns all slots for a given date.

```sql
-- Example: get Friday slots for 2 covers
SELECT * FROM get_available_slots(
  'your-venue-uuid'::uuid,
  '2025-01-17'::date,
  2
);
```

Returns:
```
slot_time           | available | available_covers | reason
--------------------+-----------+------------------+-----------
2025-01-17 18:00:00 | true      | 40               | available
2025-01-17 18:15:00 | true      | 40               | available
2025-01-17 18:30:00 | true      | 30               | available
2025-01-17 18:45:00 | true      | 20               | available
-- 19:00 is hidden (zero cap, zero_cap_display = 'hidden')
2025-01-17 19:15:00 | true      | 40               | available
...
```

## Hold sweep

Enable pg_cron and schedule the sweep job once:

```sql
SELECT cron.schedule('sweep-holds', '* * * * *', 'SELECT sweep_expired_holds()');
```

This is a safety net. Primary hold release is the explicit
`DELETE /holds/{id}` API call on cancel or confirm.

## Key constraints

- `booking_holds`: `UNIQUE (table_id, starts_at)` — DB-level double-booking guard
- `bookings` availability index is partial (`WHERE status NOT IN ('cancelled')`)
- `sitting_slot_caps`: sparse — only store slots that differ from `sitting.default_max_covers`
- `schedule_date_overrides`: `UNIQUE (venue_id, override_date)` — one override per date per venue
