# Booking API

Fastify + postgres.js + Auth0 + Stripe + BullMQ + WebSockets.

## Stack

| Layer | Choice |
|---|---|
| Framework | Fastify 4 |
| DB client | postgres.js (raw SQL, tagged templates) |
| Auth | Auth0 JWT (JWKS validation) |
| Payments | Stripe Connect |
| Queue | BullMQ + Redis |
| Validation | Zod |
| Logging | Pino |

## Setup

```bash
npm install
cp .env.example .env
# fill in .env values

# Run migrations (from project root)
psql $DATABASE_URL -f ../migrations/001_tenants_users.sql
# ... through 006_functions.sql

npm run dev
```

## Auth0 setup

1. Create an Auth0 API (Applications → APIs) — set identifier as `AUTH0_AUDIENCE`
2. Enable Organizations in Auth0
3. Create an organization per tenant; store the org ID in `tenants.auth0_org_id`
4. Add a Login Action to inject `tenant_id` and `role` into the access token:

```javascript
exports.onExecutePostLogin = async (event, api) => {
  const ns = `https://${event.request.hostname}/claims/`
  api.accessToken.setCustomClaim(ns + 'tenant_id', event.organization?.id ?? null)
  api.accessToken.setCustomClaim(ns + 'role', event.user.app_metadata?.role ?? 'operator')
}
```

## Route summary

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | — | Health check |
| GET | `/api/venues` | ✓ | List venues for tenant |
| POST | `/api/venues` | admin | Create venue |
| PATCH | `/api/venues/:id` | admin | Update venue |
| GET | `/api/venues/:id/sections` | ✓ | List sections |
| POST | `/api/venues/:id/sections` | admin | Create section |
| GET | `/api/venues/:id/tables` | ✓ | List tables |
| POST | `/api/venues/:id/tables` | admin | Create table |
| GET | `/api/venues/:venueId/schedule` | ✓ | Full schedule (templates + sittings + caps) |
| PUT | `/api/venues/:venueId/schedule/template/:dow` | admin | Upsert day template |
| POST | `/api/venues/:venueId/schedule/template/:dow/sittings` | admin | Add sitting |
| PATCH | `/api/venues/:venueId/schedule/sittings/:sid` | admin | Update sitting |
| PUT | `/api/venues/:venueId/schedule/sittings/:sid/caps` | admin | Replace slot caps |
| GET | `/api/venues/:venueId/schedule/overrides` | ✓ | List date overrides |
| POST | `/api/venues/:venueId/schedule/overrides` | admin | Create override |
| GET | `/api/venues/:venueId/slots` | public | Available slots for date |
| POST | `/api/bookings/holds` | ✓ | Create hold |
| DELETE | `/api/bookings/holds/:holdId` | ✓ | Release hold |
| POST | `/api/bookings` | ✓ | Confirm free booking |
| GET | `/api/bookings` | ✓ | List bookings (timeline query) |
| GET | `/api/bookings/:id` | ✓ | Single booking |
| PATCH | `/api/bookings/:id/status` | operator | Update status |
| PATCH | `/api/bookings/:id/notes` | ✓ | Update operator notes |
| POST | `/api/payments/intent` | ✓ | Create Stripe PaymentIntent |
| POST | `/api/payments/:id/refund` | admin | Refund payment |
| POST | `/webhooks/stripe` | Stripe sig | Stripe webhook (confirm booking) |

## Tenant RLS

Every authenticated request resolves `tenant_id` from the Auth0 JWT.
Every DB query runs inside `withTenant(tenantId, tx => ...)` which sets:

```sql
SET LOCAL app.tenant_id = '<uuid>'
```

RLS policies on every table filter automatically. No manual WHERE clauses needed.

## Key behaviours

- **Double-booking guard**: `UNIQUE (table_id, starts_at)` on `booking_holds`
- **Final lock**: `confirm_hold()` uses `FOR UPDATE NOWAIT` before INSERT
- **Free bookings**: `POST /bookings` directly (no Stripe)
- **Paid bookings**: `POST /payments/intent` → Stripe.js → webhook confirms
- **Hold release**: explicit DELETE on cancel; pg_cron + BullMQ sweep as fallback
