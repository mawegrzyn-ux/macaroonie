# Macaroonie — Claude Code Context

## What this is
A multitenant restaurant table Macaroonie built for the F&B / QSR franchise sector.
Operators register their restaurant as a tenant. Each tenant configures venues, tables,
opening schedules, booking rules, and deposit requirements via an admin portal.
Guests book tables through an embeddable booking widget (iframe / Ember.js).

Owner: Obscure Kitty. Stack chosen for familiarity with existing plugin work (Node.js, PostgreSQL, React).

---

## Repo structure

```
/
├── api/              Node.js API (Fastify)
├── admin/            React admin portal (Vite)
├── migrations/       PostgreSQL migration files (run in order 001–007)
├── setup.sh          One-shot Lightsail server setup script
├── deploy.sh         Subsequent deployment script
└── CLAUDE.md         This file
```

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| API | Fastify 4, Node.js 22, ESM | Performance, native schema validation |
| DB client | postgres.js (raw SQL) | Matches migrations exactly, no ORM magic |
| Auth | Auth0 (JWT + JWKS) | Offloads auth entirely, fits multitenancy via Orgs |
| Payments | Stripe Connect | Each restaurant is a Connect account, platform takes fee |
| Queue | BullMQ + Redis | Email jobs, hold sweep fallback |
| Validation | Zod | Both API and admin portal |
| Admin UI | React 18, Vite, TanStack Query, @dnd-kit | |
| Realtime | Native WebSocket (ws package) | Timeline live updates |
| Deployment | Lightsail Ubuntu 24.04, Nginx, PM2 | Single instance |

---

## Multitenancy — the most important thing to understand

Every table in the DB (except `tenants`) has:
- A `tenant_id uuid` column
- Row-level security (RLS) enabled
- A policy: `USING (tenant_id = current_setting('app.tenant_id', true)::uuid)`

**Every DB query that touches tenant data MUST go through `withTenant()`:**

```js
// src/config/db.js
import { withTenant } from '../config/db.js'

// CORRECT — sets RLS context before every query
const rows = await withTenant(req.tenantId, tx =>
  tx`SELECT * FROM venues WHERE id = ${venueId}`
)

// WRONG — RLS will block all rows (returns empty, not an error)
const rows = await sql`SELECT * FROM venues WHERE id = ${venueId}`
```

`withTenant()` wraps a transaction with `SET LOCAL app.tenant_id = '${id}'`.
Use `withTx()` only for tenant-resolution queries (slug → tenant_id lookups).

**Connection pooling**: must be transaction-mode (not session-mode) or tenant context leaks between requests. PgBouncer transaction mode is safe.

---

## Auth flow

1. User logs in via Auth0 (organisation-scoped login)
2. Auth0 Login Action injects `tenant_id` (Auth0 org ID) and `role` into access token
3. API middleware (`src/middleware/auth.js`) validates JWT via JWKS
4. Resolves `auth0_org_id` → `tenants.id` (internal UUID)
5. Attaches `req.tenantId` and `req.user.role` to every request
6. Every route handler passes `req.tenantId` to `withTenant()`

Roles: `owner` > `admin` > `operator` > `viewer`
Use `requireRole('admin', 'owner')` for destructive/config operations.

---

## Key files

### API
- `src/config/db.js` — `withTenant()` and `withTx()` helpers. Touch this carefully.
- `src/config/env.js` — Zod-validated env. App won't start with missing vars.
- `src/middleware/auth.js` — JWT validation + tenant resolution. Auth0 claim namespace is `https://${AUTH0_DOMAIN}/claims/`.
- `src/middleware/error.js` — Global error handler. PG error codes mapped to HTTP codes here.
- `src/routes/bookings.js` — Hold creation, free booking confirm, list/detail, status updates.
- `src/routes/payments.js` — Payment intent creation + Stripe webhook handler.
- `src/routes/schedules.js` — Full schedule CRUD (templates, sittings, slot caps, overrides).
- `src/routes/slots.js` — Calls `get_available_slots()` PG function. Thin wrapper.
- `src/config/ws.js` — WebSocket server. Rooms keyed by venue_id. Auth via JWT query param.
- `src/services/broadcastSvc.js` — Call `broadcastBooking(type, booking)` after any booking mutation.
- `src/jobs/queues.js` — BullMQ queues. `notificationQueue` for emails, `holdSweepQueue` for hold cleanup.

### Admin portal
- `src/lib/api.js` — `useApi()` hook. Injects Auth0 token automatically. All API calls go through here.
- `src/hooks/useRealtimeBookings.js` — WS hook. Connects to `/ws?venue=&token=`. Invalidates TanStack Query on push.
- `src/pages/Timeline.jsx` — Gantt view. @dnd-kit for drag. Booking cards positioned by pixel-accurate time offset.
- `src/pages/Schedule.jsx` — 7-day grid + sitting editor + slot caps grid.
- `src/components/widget/BookingWidget.jsx` — Self-contained widget component. This is the reference implementation for the Ember.js widget.

---

## Database — critical patterns

### Slot generation
Slots are **never stored**. They are computed at request time by the `get_available_slots(venue_id, date, covers)` PG function in `006_functions.sql`. The function:
1. Checks for a date override → falls back to weekly template
2. Iterates sittings, generates candidate times at `slot_interval_mins`
3. Looks up per-slot cover cap (sparse — only stored if different from sitting default)
4. Subtracts active bookings + non-expired holds from the cap
5. Applies `zero_cap_display` logic (hidden vs unavailable)

### Double-booking prevention
Two layers:
1. `UNIQUE (table_id, starts_at)` on `booking_holds` — DB-level race condition guard
2. `confirm_hold(hold_id, tenant_id)` PG function uses `FOR UPDATE NOWAIT` at booking confirm time

### Hold lifecycle
```
Guest presses Book
  → POST /bookings/holds → INSERT booking_holds (TTL = hold_ttl_secs, default 300)
  → Widget shows countdown timer

Guest cancels
  → DELETE /bookings/holds/:id → slot immediately free
  → Also cancels Stripe PI if one was attached

Payment received (Stripe webhook)
  → confirm_hold() → INSERT bookings → DELETE hold
  → broadcastBooking() → WS push to timeline

Hold expires (no action)
  → pg_cron sweep or BullMQ holdSweepQueue deletes expired rows
```

---

## Outstanding items for Claude Code to complete

### Must-fix before first run (small)

**1. Add `auth0_org_id` to migration 001**
```sql
-- Add to end of 001_tenants_users.sql:
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS auth0_org_id text UNIQUE;
```

**2. Paste missing API routes from `INTEGRATION_PATCH.js`**
- `PATCH /bookings/:id/move` → add to `src/routes/bookings.js`
- `GET|PATCH /venues/:id/rules` → add to `src/routes/venues.js`
- `GET|PATCH /venues/:id/deposit-rules` → add to `src/routes/venues.js`

**3. Fix Rules.jsx ESM issue**
Replace the `useStateFromFirst` function at the bottom of `src/pages/Rules.jsx`:
```js
// Delete the old function and replace with:
function useVenueId(venues) {
  const [venueId, setVenueId] = useState(null)
  useEffect(() => {
    if (venues.length && !venueId) setVenueId(venues[0].id)
  }, [venues])
  return [venueId, setVenueId]
}
// Then update the component: const [venueId, setVenueId] = useVenueId(venues)
```

**4. Add `table_id` to slot resolver response**
The booking widget needs a `table_id` per slot to create a hold.
Add a subquery to `src/routes/slots.js` — see `INTEGRATION_PATCH.js` for the exact SQL.

**5. Activate pg_cron sweep**
Uncomment in `006_functions.sql`:
```sql
SELECT cron.schedule('sweep-holds', '* * * * *', 'SELECT sweep_expired_holds()');
```
Run this once after confirming `pg_cron` is available on the Lightsail Postgres install.

**6. Wire `broadcastBooking()` into routes**
In `src/routes/bookings.js` and `src/routes/payments.js`, add after every booking INSERT:
```js
import { broadcastBooking } from '../services/broadcastSvc.js'
broadcastBooking('booking.created', booking)   // or 'booking.updated'
```

### Build next (larger features)

**7. Ember.js booking widget**
`src/components/widget/BookingWidget.jsx` is the reference implementation.
Port the 5-step flow (covers → date → slot → details → confirm) to Ember.js.
Style via CSS custom properties (accent colour, theme) so it's white-labelable.
Deploy as an iframe embed with a `<script>` loader snippet.

**8. Team management page**
Route: `/team`. Uses Auth0 Management API to invite users to an organisation.
Pattern: POST to Auth0 `/api/v2/jobs/invitations` → user receives email → joins org.
Store role in `app_metadata.role` on the Auth0 user.

**9. Test suite**
No tests exist yet. Recommended approach:
- API: Vitest + supertest for route integration tests
- DB: Use a test database with migrations applied, reset between test runs
- Priority test targets: `confirm_hold()` race condition, slot resolver output, booking flow end-to-end

---

## Environment variables

Both `.env.example` files document all required vars.
The API will refuse to start if any required var is missing (Zod validation in `src/config/env.js`).

Key vars to set before running:
- `DATABASE_URL` — pre-filled by setup.sh
- `REDIS_URL` — update password to match Redis config
- `AUTH0_DOMAIN` / `AUTH0_AUDIENCE` — from Auth0 dashboard
- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` — from Stripe dashboard
- Admin portal: `VITE_AUTH0_DOMAIN` / `VITE_AUTH0_CLIENT_ID` / `VITE_AUTH0_AUDIENCE`

---

## Common mistakes to avoid

- **Never query tenant tables without `withTenant()`** — RLS silently returns empty rows, not an error.
- **Never trust client for payment confirmation** — booking only becomes permanent via Stripe webhook, not client-side resolve.
- **Never store slots** — they are always computed. Do not add a `slots` table.
- **`slot_duration_mins` ≠ `slot_interval_mins`** — duration is how long a booking lasts, interval is how often a new slot starts. Both live on different tables.
- **`max_covers = 0` on a slot cap ≠ fully booked** — it means intentionally blocked. The `zero_cap_display` venue setting controls whether it shows as hidden or unavailable.
- **Hold TTL is configurable per venue** — `booking_rules.hold_ttl_secs`. Default 300 (5 min). Widget countdown is driven by `expires_at` from the hold response, not a local timer.
- **pg_cron is a fallback** — the primary hold release is the explicit `DELETE /holds/:id` call. Don't rely on the sweep as the main path.

---

## Running locally

```bash
# Prerequisites: Postgres 16, Redis 7, Node 22

# API
cd api
cp .env.example .env   # fill in values
psql $DATABASE_URL -f ../migrations/001_tenants_users.sql
# ... run 002-006
npm install
npm run dev            # starts on :3000 with --watch

# Admin portal (separate terminal)
cd admin
cp .env.example .env   # fill in VITE_ values
npm install
npm run dev            # starts on :5173, proxies /api to :3000
```

Visit `http://localhost:5173`. Auth0 login redirects to the admin portal.
Use `/widget-test` to test the full booking flow without deploying anything.
