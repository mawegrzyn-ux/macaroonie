# Macaroonie — Claude Code Context

> ⚠️ DEVELOPER ONLY — contains infra details, env var names, auth config.

**Multitenant restaurant table booking + website CMS for the F&B / QSR franchise sector.**

Each master-franchisee registers as a tenant (Auth0 org). They configure venues, tables,
schedules, booking rules, deposits, and per-venue websites via an admin portal.
Guests book through an embeddable widget (iframe / Ember.js) and browse venue sites
at `{slug}.macaroonie.com`.

Owner: Obscure Kitty. Stack chosen for familiarity with existing plugin work (Node.js, PostgreSQL, React).

---

## ⚠️ Project status — pre-production

**Macaroonie is in active pre-prod development and testing.** No real customers, no real
booking traffic depend on it yet. Treat the codebase accordingly:

- **Backwards compatibility is NOT a concern.** Don't add fallback paths for legacy
  data shapes, deprecated field names, or schema-version-N rendering. Drop columns,
  rename without migrations, replace whole subsystems if cleaner. Simpler code beats
  defensive code at this stage.
- **Don't preserve "legacy fallback" rendering for old layouts** when shipping new
  ones — pick the new path and let it be the only path.
- **No need for feature flags or staged rollouts** for new features. Ship them on,
  iterate on the live deploy.
- **Migrations don't need data-preservation routines** beyond what naturally falls
  out of the SQL. Drop tables, drop columns, drop legacy enums when they stop being
  the source of truth.

This stops applying once we onboard the first real franchise. At that point flip
this note and revisit any places it's been quoted as justification.

---

## Table of Contents

1. [SOS Checklist](#sos-checklist)
2. [EOS Protocol](#eos-protocol)
3. [Standard Design Rules](#standard-design-rules)
4. [Repo structure](#repo-structure)
5. [Tech stack](#tech-stack)
6. [Admin portal design principles](#admin-portal-design-principles)
7. [Multitenancy](#multitenancy--the-most-important-thing-to-understand)
8. [Auth flow](#auth-flow)
9. [Key files](#key-files)
10. [Database — critical patterns](#database--critical-patterns)
11. [Completed items](#completed-items-implemented)
12. [Outstanding items](#outstanding-items)
13. [Environment variables](#environment-variables)
14. [Common mistakes to avoid](#common-mistakes-to-avoid)
15. [Deployment — CI/CD](#deployment--cicd-via-github-actions)
16. [Running locally](#running-locally)
17. [Doc maintenance](#doc-maintenance)

---

## SOS Checklist

When a new session begins:

**1. Orient:**
- Read CLAUDE.md (loaded automatically).
- If the conversation has a compacted summary, verify claims against the actual codebase before referencing past items as "pending".

**2. Verify codebase state:**
- `git log --oneline -5` — what changed since last session?
- `git status` — pick up uncommitted WIP.
- `git branch -a` — confirm you're on the right branch.
- If the user mentions earlier work, grep to confirm it exists before assuming it's still pending.

**3. Establish session context:**
- Ask the user what they want to work on; don't assume.
- For a multi-step task, create a TodoWrite immediately.
- Note today's date for changelog entries.

**Critical rule:** Never reference backlog items, bugs, or features from a session summary as "pending" without verifying. Session summaries go stale. Always grep / check live code.

---

## EOS Protocol

When the user signals end of session ("wrap up", "eos", "that's all", or naturally winds down):

**1. Update all docs** affected by this session:
- CLAUDE.md — new completed items, new gotchas, key-file references.
- In-app Help.jsx — **always** add/update the operator-facing section for any new or changed feature. This is the most user-visible doc and must never lag behind shipped code.
- In-app Docs.jsx — **always** add/update the technical section for any new API routes, DB tables, services, or architectural changes.
- CHANGE.md — prepend a changelog entry for shipped features.

**2. Impact analysis:**
- Files modified / created this session.
- Existing features that may be affected by changes.
- Cross-cutting concerns flagged (e.g. RLS implications, template include paths, CSS variable additions).

**3. Risk + gap assessment:**
- Untested edge cases.
- Incomplete bits left behind (mark them clearly in Outstanding items).
- Recommended next actions for the user.

**4. Hand off for commit.** The **user commits and pushes via GitHub Desktop**. Claude must NOT print `git add` / `git commit` / `git push` command blocks for the user to run — they don't use the CLI for this. The GitHub Actions workflow on the server auto-deploys on push. After making code changes, just say "ready to commit" with a short list of files changed and a suggested commit-message subject line — let the user drive the rest in GitHub Desktop. Same goes for any time you'd otherwise tell them to "push from your laptop" — drop that phrase, the user knows their own workflow.

---

## Standard Design Rules

App-wide defaults — assume these on every new screen unless documented otherwise.

1. **Touch-first.** Admin portal targets tablet-sized touch screens at host stands. Minimum 48×48 px touch targets. `touch-manipulation` on every interactive element.
2. **No hover-only affordances.** Every interactive element must be discoverable and usable by tap alone.
3. **Drag-drop is the default for any orderable list.** If it has a `sort_order` column, the UI must support drag-reorder. Always-visible grip handles; `@dnd-kit` with both PointerSensor and TouchSensor.
4. **No native browser popups** (`window.confirm` / `prompt` / `alert`). Use inline confirmation patterns (double-confirm, typed-confirmation for destructive ops).
5. **Every save is explicit.** Each section has its own Save button — no auto-save, no global form state. Changes are only persisted when the user clicks Save.
6. **Destructive operations require double confirmation.** Delete, anonymise, and data-clearing actions show an inline "Are you sure?" before executing.
7. **No emojis in committed code or files** unless explicitly requested by the user.
8. **Mobile-responsive from 1015 px wide.** Sidebar + main content must remain usable at that width without horizontal scroll.
9. **All modals scrollable.** Use `max-h-[85vh] overflow-y-auto` on modal content areas so content does not clip on smaller tablet screens.
10. **Date as a styled button with invisible `<input type="date">` overlay.** Tapping opens the OS date picker on mobile. No custom calendar components.
11. **`type="tel"` / `inputMode="tel"` on phone inputs.** Triggers numeric keypad on tablets without custom code.

---

## Repo structure

```
/
├── api/              Node.js API (Fastify)
├── admin/            React admin portal (Vite)
├── migrations/       PostgreSQL migration files (run in order 001–021)
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

## Admin portal design principles

The admin portal is **optimised for tablet-sized touch screens** used by front-of-house staff at a host stand or service counter. Design decisions must reflect this:

- **Touch targets minimum 48 × 48 px** — buttons, covers selectors, slot tiles, grip handles
- **`touch-manipulation` CSS on every interactive element** — eliminates 300 ms tap delay on iOS/Android
- **No hover-only affordances** — every interactive element must be discoverable and usable by tap
- **`type="tel"` / `inputMode="tel"`** on phone number inputs — triggers numeric keypad on iOS/Android tablets without custom code
- **Custom numeric keypad** for covers/number inputs on touch devices — `inputMode="none"` suppresses native keyboard; a 3×4 grid overlay is rendered instead. Detection: `navigator.maxTouchPoints > 0` evaluated once at module load as `IS_TOUCH`
- **Date as a styled button with invisible `<input type="date">` overlay** — tapping the label opens the OS date picker on mobile, and a native datepicker on desktop; avoids custom calendar components
- **Minimum 1015 px wide layout assumed** — sidebar + timeline must remain usable at that width without horizontal scroll inside panels
- **All modals scrollable** — use `max-h-[85vh] overflow-y-auto` on modal content areas so content does not clip on smaller tablet screens in landscape

When adding new UI: always verify interactive elements are finger-sized, add `touch-manipulation`, and test at 1015 px width.

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
- `src/routes/bookings.js` — Hold creation, free booking confirm, list/detail, status updates. `POST /bookings/admin-override` — admin direct booking that bypasses all slot/capacity/window rules; handles single table, multi-table (auto-creates combination), or unallocated row.
- `src/routes/customers.js` — Customer profiles. GET /customers?q= (search), GET /customers/:id (detail + bookings), PATCH /customers/:id, POST /customers/:id/anonymise (GDPR erasure), GET /customers/:id/export (GDPR JSON download). Exports upsertCustomer() helper called by bookings.js on every confirm.
- `src/routes/payments.js` — Payment intent creation + Stripe webhook. `handlePaymentSucceeded` copies `combination_id` and `guest_notes` from hold to booking INSERT.
- `src/routes/schedules.js` — Full schedule CRUD (templates, sittings, slot caps, overrides).
- `src/routes/website.js` — Website builder admin CRUD: config singleton, gallery (with reorder), custom pages, menu PDFs, opening hours, allergens, multipart upload, slug availability, DNS verify.
- `src/routes/publicSite.js` — Public JSON: `GET /api/site/:slug` bundles config + gallery + pages + menus + hours + allergens + venue. Also serves `sitemap.xml` / `robots.txt`.
- `src/routes/siteRenderer.js` — Subdomain + custom-domain SSR. `resolveSiteHost(host)` returns `{ slug, customDomain }` or null. Renders `views/site/templates/{template_key}/{view}.eta`. Reserved subdomains (api, www, mail, …) bypass.
- `src/services/siteDataSvc.js` — `loadSiteBundle({ slug, customDomain })`. Global lookup → `withTenant(tenant_id, …)` for scoped rows. Checks `is_published` AND `custom_domain_verified` on the custom-domain path.
- `src/services/storageSvc.js` — Pluggable uploads. `getStorage().put(tenantId, kind, ext, mimetype, buffer)`. Drivers: `LocalStorage` (writes to `UPLOAD_DIR`, served at `/uploads/*` by `@fastify/static`), `S3Storage` (lazy-imports `@aws-sdk/client-s3`, compatible with AWS S3, DO Spaces via `S3_ENDPOINT`, Cloudflare R2). Selected via `STORAGE_DRIVER` env.
- `src/views/site/shared/head.eta` — Central theme renderer. Converts `website_config.theme` JSONB into CSS custom properties (`--c-*` for colours, `--f-*` for fonts, `--r-*` for radii, etc) and auto-loads Google Fonts. Every template includes it.
- `src/views/site/templates/classic/`, `src/views/site/templates/modern/` — the two shipping public-site templates. Each has `index.eta`, `menu.eta`, `page.eta`, `partials/{header,footer}.eta`.
- `src/routes/slots.js` — Calls `get_available_slots()` PG function. Thin wrapper.
- `src/routes/emailTemplates.js` — Email template CRUD + venue email settings + merge-fields endpoint + preview renderer + delivery log query + `POST /send-test` (sends a real email through the venue's configured provider against sample merge fields, used by the Widget Test page to verify setup without creating a booking). Mounted at `/api/email-templates`.
- `src/routes/widgetApi.js` — Public booking-widget API (`/widget-api/*`). No auth, CORS-allow-all, scoped per `venueId`. Mirrors `/api/bookings` but resolves tenant from venue lookup (`resolveTenant(venueId)` returns `{ id, tenant_id, ... }`). Free-booking only for v1 — deposit-required venues throw 422 on confirm. Rate limit shared with the global `@fastify/rate-limit` config.
- `src/views/site/widget.eta` — Standalone iframe-friendly booking widget page. Vanilla JS, ~400 lines, 5-step flow (covers/date/slot/details/confirmed). Reads `?theme=light|dark&accent=hex` URL params. Posts `macaroonie:booking-confirmed` message to parent on success. Uses `X-Frame-Options: ALLOWALL` + CSP `frame-ancestors *` so any tenant site can embed.
- `src/routes/media.js` — Per-tenant media library API. Mounted at `/api/media`. Routes: `/categories` CRUD; `/items` (list with `category_id`/`scope`/`search` filters), `/items/scopes` (DISTINCT scope values for dropdown), `/items/check-duplicate` (filename + hash within scope), `/items/upload` (multipart, validates MIME, hashes content, optionally extracts dimensions via `sharp`), `/items/:id/replace` (multipart, **swaps file behind an existing item** — used by the image editor's "Replace original" path; keeps row id, updates url/storage_key/bytes/dimensions/hash, deletes old file best-effort), `/items/:id` PATCH/DELETE, `/items/bulk` (delete / move-category / move-scope). Storage goes through existing `storageSvc` with kind `'media'`. `sharp` is lazy-loaded — listed as `optionalDependencies` so a broken native build doesn't crash the API; missing it just means no width/height capture.
- `src/routes/emailMonitoring.js` — SendGrid monitoring API. `GET /summary` returns stats + suppression lists + local email_log totals in one round-trip. `GET /stats` daily breakdown. `GET /suppressions/:type` (bounces / blocks / spam_reports / invalid_emails). `DELETE /suppressions/:type/:email` (owner-only — clears a specific entry so retries can flow). `GET /log` paginates local email_log. Uses `loadSendgridKey(tenantId, venueId)` to resolve the per-venue key with env fallback. Mounted at `/api/email-monitoring`.
- `src/services/sendgridSvc.js` — SendGrid Web API wrapper. `getStats({ apiKey, startDate, endDate })`, `getSuppressions({ apiKey, type, limit })`, `removeSuppression({ apiKey, type, email })`, `pingApiKey({ apiKey })`. All raise `Error.status` from the HTTP response so callers can distinguish auth failures from rate limits.
- `src/routes/manageBooking.js` — Public guest-facing booking management. SSR page at `/manage/{token}`. No auth — manage_token UUID IS the auth. GET shows details, POST /modify changes date/time/covers, POST /cancel cancels. Queues modification/cancellation emails.
- `src/services/emailSvc.js` — Pluggable email delivery: `sendEmail({ provider, credentials, from, to, subject, html })` with 5 drivers (sendgrid/postmark/mailgun/ses/smtp). Also exports `renderTemplate()` (mustache-style {{field}} replacer with HTML escaping), `buildMergeFields()` (booking+venue+customer→fields object), and `MERGE_FIELDS` (16 available fields with examples).
- `src/services/emailTemplateDefaults.js` — Built-in default HTML email templates (confirmation/reminder/modification/cancellation). Mobile-responsive, professional layout. Used when a tenant hasn't customised their own.
- `src/jobs/emailWorker.js` — BullMQ job processor for booking emails. Loads booking+venue+customer, resolves template (venue→tenant→built-in), resolves provider+credentials, renders, sends, logs to email_log, marks reminder_sent_at.
- `src/routes/platform.js` — Platform admin routes (`/api/me`, `/api/platform/tenants` CRUD + stats). `requirePlatformAdmin` guard. `/api/me` returns user profile + available tenants for org switcher.
- `src/routes/team.js` — In-app team management (`/api/team`). List members, invite (sends Auth0 invitation email), role change (syncs `app_metadata.role` to Auth0), deactivate (removes from Auth0 org), `POST /:userId/reset-password` (Auth0 change-password email). Owner-only for mutations; admin can view. Self-protection guards. Falls back to local-only invites with a warning if `AUTH0_MGMT_*` env vars are unset.
- `src/services/auth0MgmtSvc.js` — Auth0 Management API wrapper. In-memory M2M token cache (refreshes ~5min before expiry), `inviteUserToOrg`, `removeUserFromOrg`, `updateUserAppMetadata` (role sync), `sendPasswordResetEmail`, `createOrganization`, `enableOrgConnection`, `provisionTenantOrg`, `getConnectionByName`. `isConfigured()` / `canInvite()` feature checks let callers degrade gracefully when creds are missing.
- `src/routes/access.js` — Access management (`/api/access`). `GET /modules` lists all known modules merged with the tenant's `tenant_modules` rows. `PATCH /modules/:key` toggles a module on/off (owner only). `GET /roles` returns tenant_roles with permissions. `POST/PATCH/DELETE /roles[/:id]` for custom-role CRUD; built-in roles can be edited but not deleted; custom roles can't be deleted while users reference them.
- `src/config/modules.js` — Single source of truth for the module registry (key, label, description, per-built-in default permissions). 14 modules currently: bookings, venues, tables, schedule, rules, customers, website, email_templates, cash_recon, team, settings, dashboard, widget_test, documentation. Export `MODULES`, `MODULE_KEYS`, `PERMISSION_LEVELS`, `permissionAtLeast()`.
- `src/config/ws.js` — WebSocket server. Rooms keyed by venue_id. Auth via JWT query param.
- `src/services/broadcastSvc.js` — Call `broadcastBooking(type, booking)` after any booking mutation.
- `src/jobs/queues.js` — BullMQ queues. `notificationQueue` for emails, `holdSweepQueue` for hold cleanup.

### Admin portal
- `src/lib/api.js` — `useApi()` hook. Injects Auth0 token automatically. All API calls go through here. `download(path, filename)` method fetches with auth and triggers browser Save dialog.
- `src/hooks/useRealtimeBookings.js` — WS hook. Connects to `/ws?venue=&token=`. Invalidates TanStack Query on push.
- `src/pages/Timeline.jsx` — Gantt view. @dnd-kit for drag. Booking cards positioned by pixel-accurate time offset. Current-time red line indicator (today only, updates every 30 s).
- `src/pages/Schedule.jsx` — 7-day grid + sitting editor + slot caps grid.
- `src/pages/Tables.jsx` — table list with drag-to-reorder (grip handles always visible), combinations, disallowed pairs section.
- `src/pages/Rules.jsx` — booking rules + smart allocation toggles (allow_cross_section_combo, allow_non_adjacent_combo). enable_reconfirmed_status toggle (re-confirmed status for operator phone-call workflow).
- `src/pages/Bookings.jsx` — Guestplan-style time-grouped list. Stats bar (reservations/tables/guests — active only). Inline status dropdown. Phone visible. Permanent resizable right panel (280–700 px). BookingDrawer in inlineMode.
- `src/pages/Customers.jsx` — Customer list + resizable detail panel. GDPR anonymise (double-confirm inline) + export (JSON download via api.download()).
- `src/pages/Website.jsx` — Website builder admin page (`/website` route). Left-rail 18-section nav: Setup & domain, Template, Theme, Branding, Hero, About, Gallery, Menus, Allergens, Opening hours, Find us, Contact, Online ordering, Delivery, Booking widget, Custom pages, SEO, Analytics. Onboarding card for tenants with no `website_config` row yet. Shared primitives: `SectionCard`, `FormRow`, `Toggle`, `SaveBar`, `FileUpload`, `ImageField`, `useConfigFields()` helper. Theme section saves the full `theme` JSONB in one PATCH; each content section saves its own subset.
- `src/pages/Docs.jsx` — in-app technical documentation (auto-synced with codebase).
- `src/pages/Help.jsx` — operator user guide.
- `src/pages/Settings.jsx` — theme colour picker (live CSS var update) + timeline view defaults.
- `src/contexts/SettingsContext.jsx` — `themeHex` state + `hexToHsl`/`fgForHex`/`applyTheme` helpers. Default `#630812`. Persisted to `maca_settings` localStorage key.
- `src/contexts/TimelineSettingsContext.jsx` — `hideInactive`, `groupBySections`, `panelMode`, `venueId`, `refetchTrigger`. All three toggles persisted to `maca_timeline_prefs` localStorage.
- `src/components/bookings/BookingDrawer.jsx` — booking detail side-panel. Save button in header (contextual per edit mode). Table override: individual checkboxes only, pre-populated from member_table_ids; **single-table → `PATCH /relocate`** (cascade displacement), **multi-table → `PATCH /tables`** (direct), **unallocated → `PATCH /tables`**; "Unallocated" checkbox at top of picker (orange); unallocated bookings show orange badge in view mode. **Capacity warning** (amber) shown permanently in table section when `booking.covers` exceeds table/combination max. **End time editor**: "End time" button in Date & time section; `PATCH /bookings/:id/duration`; midnight crossover handled.
- `src/components/bookings/NewBookingModal.jsx` — admin new booking. Touch-optimised: 48px cover buttons, date-as-button (OS picker), tel input for phone, custom numeric keypad for covers on touch devices. Accepts `openManual`/`prefillTime`/`prefillTableId`. **Canvas click flow** opens ManualAllocModal directly. **Manual allocation** button bypasses slot resolver. Customer search: debounced suggestions panel (desktop: side panel; mobile: inline below phone field with × dismiss). Walk In button. autoFocus suppressed on touch. **Slot warnings**: amber when booking end > `sitting_closes_at`; red when > `sitting_doors_close`.
- `src/components/widget/BookingWidget.jsx` — Self-contained widget component. This is the reference implementation for the Ember.js widget.
- `src/pages/EmailTemplates.jsx` — Email template admin page (`/email-templates` route). 3 tabs: Templates (per-type editor with merge field pills, preview iframe, reset-to-default), Settings (provider picker, credentials, sender identity, reminder toggle + hours slider, guest modify/cancel permissions), Sent emails (audit log). Venue selector in header. TipTap visual WYSIWYG editor with toolbar + HTML mode toggle.
- `src/pages/Media.jsx` — Standalone media library page (`/media` route). Renders the modal in `manager` mode. Browse/organise/upload tenant assets without being mid-task.
- `src/components/media/MediaLibrary.jsx` — Reusable per-tenant media library modal. Two modes: `picker` (returns URL via `onPick` callback, "Insert selected" footer button) and `manager` (no insert action). Features: grid + list views, search, category sidebar, scope (form) filter, upload (button + drag-drop), duplicate detection (filename + SHA-256 hash), upload progress chips, single + multi select, single-item detail panel (preview, rename, change category, change scope, delete, **edit**), bulk actions (move category, move scope, delete), resizable detail panel, ESC to close, fullscreen toggle.
- `src/components/media/ImageEditor.jsx` — Crop / rotate / flip editor. Uses `react-easy-crop` for the crop UI; rotation (90° increments) and flip (H/V) applied via `<canvas>` at export. Aspect-ratio presets (Free, 1:1, 4:3, 3:2, 16:9, 9:16). Two save modes: **Save as new** (POST `/media/items/upload` with the cropped Blob → fresh media_items row) or **Replace original** (POST `/media/items/:id/replace` → keeps the row id, swaps file content + url + storage_key + dimensions + hash, deletes old file best-effort). Output MIME matches input for JPEG/WebP, falls back to PNG for everything else. `crossOrigin='anonymous'` on the source `<Image>` so canvas isn't tainted (works for same-origin and CORS-enabled S3 URLs).
- `src/pages/EmailMonitoring.jsx` — SendGrid monitoring (`/email-monitoring` route). Two stacked sections: **What went out** (4 stat cards from SendGrid + 4 from local log + daily breakdown table + recent sends from email_log) and **What's in (suppressions)** (4 cards — bounces/blocks/spam_reports/invalid_emails — with inline removal). Venue picker in header (uses that venue's SendGrid API key). Date range selector (7/30/90 days). Falls back to a clear "this venue is using {provider}" banner when the venue isn't on SendGrid; falls back to a "no API key" banner when the key is missing/invalid. Owner-only on suppression removal.
- `src/pages/Team.jsx` — Team management page (`/team` route). Invite users, set roles (inline dropdown), deactivate/reactivate. RBAC reference table. Owner-only mutations.
- `src/pages/Platform.jsx` — Platform admin dashboard (`/platform` route). Tenant list with venue/user counts, create/edit tenant cards, active/inactive sections, stats overview. Platform admin only.
- `src/pages/Access.jsx` — Access management (`/access` route). Two tabs: **Modules** (master on/off toggles per module, owner-only) and **Roles** (list of tenant_roles + inline permission matrix editor with `none/view/manage` toggle pills per module). Built-in roles show a "Lock" badge, can be edited but not deleted. Custom roles can be added/edited/deleted (only when no user references them). Available to anyone for viewing, mutations are owner-only (API-enforced).

---

## Database — critical patterns

### Slot generation
Slots are **never stored**. They are computed at request time by the `get_available_slots(venue_id, date, covers)` PG function (current definition in `020_slot_start_filter.sql`). The function:
1. Checks for named schedule exceptions (highest priority) → date override → weekly template
2. Iterates sittings, generates candidate times at `slot_interval_mins` while `slot_time < closes_at`
3. **Slot is generated as long as `slot_time < closes_at`** — the booking may run past `closes_at`. Contrast with the old rule which required `slot_time + duration ≤ closes_at`.
4. Looks up per-slot cover cap (sparse — only stored if different from sitting default)
5. Subtracts active bookings + non-expired holds from the cap
6. Applies `zero_cap_display` logic (hidden vs unavailable)
7. Returns `sitting_closes_at` and `sitting_doors_close` per slot for frontend warnings

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

## Completed items (implemented)

Items 1–6 from the original bootstrap checklist are done:
- ✅ `auth0_org_id` added to migration 001
- ✅ `PATCH /bookings/:id/move`, `GET|PATCH /venues/:id/rules`, `GET|PATCH /venues/:id/deposit-rules` added
- ✅ `Rules.jsx` ESM issue fixed (`useVenueId` hook)
- ✅ `table_id` + `combination_id` added to slot resolver response
- ✅ pg_cron sweep activated
- ✅ `broadcastBooking()` wired into all booking mutations

Additionally implemented across development sessions:
- ✅ **Smart allocation** — `PATCH /bookings/:id/relocate` (cross-table drag, adjacency expansion, cascade displacement, Unallocated row)
- ✅ **Table sort order** — `PATCH /venues/:id/tables/reorder` + drag-to-reorder on Tables page (always-visible grip handles)
- ✅ **Allocation rules** — `allow_cross_section_combo`, `allow_non_adjacent_combo` toggles on `booking_rules`; `disallowed_table_pairs` table; all enforced in `/relocate`
- ✅ **Disallowed pairs UI** — Tables page shows "Disallowed pairs" section with add/remove
- ✅ **combination_id fix** — `POST /bookings` (free booking confirm) now copies `combination_id` from the hold record
- ✅ **Timeline canvas click** — clicking empty slot on Timeline opens New Booking modal pre-filled with that time
- ✅ **Booking drawer save UX** — save button moved to drawer header, contextual label per active edit mode
- ✅ **Table override simplified** — drawer override picker is now individual-table checkboxes only (no preset combos radio section); pre-populated from `member_table_ids`
- ✅ **Schedule sitting edit** — pencil button on each sitting opens inline edit form for times + default covers
- ✅ **Schedule slot_time fix** — PostgreSQL `TIME` columns return `HH:MM:SS`; normalised to `HH:MM` on load and save to match API validation regex
- ✅ **Docs + Help pages** wired into AppShell nav and main.jsx routes
- ✅ **Doors close time** — `venue_schedule_templates.doors_close_time` column (migration 011); "Last order time" label on sitting closes_at; "Doors close" time picker per day in Schedule; widget slot filtering enforced in `GET /slots` for unauthenticated callers
- ✅ **Widget booking hours rule** — `allow_widget_bookings_after_doors_close` on `booking_rules`; "Opening hours enforcement" section in Rules page
- ✅ **Stripe webhook booking fix** — `combination_id` and `guest_notes` now copied from hold into booking INSERT in `handlePaymentSucceeded` (payments.js)
- ✅ **Doors close time moved per sitting** — `doors_close_time` column on `venue_sittings` and `override_sittings` (migration 013); removed from day-template level
- ✅ **Schedule exceptions** — `schedule_exceptions`, `exception_day_templates`, `exception_sittings`, `exception_sitting_slot_caps` tables (migration 014); `get_available_slots()` updated with Priority 1 exception resolution; full CRUD in `schedules.js`; `ExceptionsSection` / `ExceptionCard` / `ExceptionDayCard` components in `Schedule.jsx`
- ✅ **get_available_slots() bug fix** — `v_exc_template_id uuid` scalar variable replaces direct record field access to prevent "record not assigned yet" PG 55000 error (migration 015)
- ✅ **Admin manual allocation** — `POST /bookings/admin-override` API endpoint; ManualAllocModal in NewBookingModal with free date/time/table selection, "Booked" indicators from day bookings query, unallocated option
- ✅ **Timeline grey column overlay** — `GET /slots?covers=1` used to compute unavailable time strips; grey = outside sittings or cap=0 (reason='unavailable'); fully-booked (reason='full') stays white; strips clipped in secondary combo rows to avoid bleed-through the spanning card
- ✅ **New Booking Modal touch optimisation** — 48px cover buttons, date-as-button overlay, `type="tel"` phone, custom numeric keypad on touch devices
- ✅ **enable_reconfirmed_status** — added to `booking_rules` (migration 012), `BookingRulesBody` schema in venues.js, `BookingRulesSchema` and UI toggle in Rules.jsx
- ✅ **New booking statuses** — `arrived` (cyan, between confirmed and seated), `seated` (renamed from `completed`), `checked_out` (muted grey-green, after seated); migration 017; all capacity queries exclude `checked_out` same as `cancelled`/`no_show`
- ✅ **Bookings page redesign** — Guestplan-style time-grouped list; stats bar; inline status dropdown; phone visible; permanent resizable right panel (BookingDrawer in inlineMode)
- ✅ **Walk In button** — in NewBookingModal guest step; skips all details; books immediately as "Walk In" with dummy email
- ✅ **Timeline canvas click → ManualAllocModal** — clicking empty canvas now opens ManualAllocModal directly with time + table pre-populated (openManual + initialTableIds props)
- ✅ **Timeline liveBooking fix** — drawer in Timeline derives `liveBooking = bookingsRes.find(b => b.id === selected.id) ?? selected` so status updates reflect immediately without stale snapshot
- ✅ **notificationQueue fire-and-forget** — all three `notificationQueue.add()` calls wrapped as `.catch()` promises; API process no longer crashes when Redis is unavailable
- ✅ **Customer database** — `customers` table with RLS (migration 018); `customer_id` FK on `bookings`; auto-upsert on every booking confirm (fire-and-forget); `upsertCustomer()` exported from customers.js; walk-in/TBC emails skipped
- ✅ **Customer GDPR** — `POST /customers/:id/anonymise` replaces all PII with placeholder values, anonymises all linked bookings, never deletes the row; `GET /customers/:id/export` returns JSON download
- ✅ **Customer search in booking modal** — debounced search as operator types in name/email/phone; suggestions panel appears to the right of the modal; clicking a result pre-fills the form
- ✅ **Customers page** — `/customers` route; searchable list; resizable detail panel; GDPR anonymise with double confirmation; GDPR export download
- ✅ **Timeline current-time indicator** — red vertical line across all table rows + dot and label in header; today-only; updates every 30 s
- ✅ **iOS autoFocus suppressed** — `autoFocus={!IS_TOUCH}` on guest name field prevents iOS keyboard popping on modal open
- ✅ **deploy.sh always builds as ubuntu** — both `npm install` and `npm run build` in `deploy_admin()` and `deploy_api()` now run via `sudo -u ubuntu bash -c ...` so dist/ files are never owned by root
- ✅ **table_combination_members tenant_id bug** — admin-override INSERT was passing `tenant_id` to `table_combination_members` which has no such column; removed
- ✅ **checked_out tile colour** — changed from light green to grey (`#e5e7eb` / `#9ca3af`)
- ✅ **New booking FAB** — `+ New booking` moved from toolbar to round floating action button (`absolute bottom-6 right-6 z-30 w-14 h-14 rounded-full`) on timeline canvas
- ✅ **Booking tile shape** — `clip-path` arrow polygon removed; tiles are plain rounded rectangles
- ✅ **Timeline controls → sidebar** — venue selector, inactive toggle, sections toggle, panel toggle, refresh, fullscreen all moved to AppShell sidebar above logout; shown only when route is `/timeline`; icon-only variants for collapsed sidebar
- ✅ **"Inactive" label** — renamed from "Cancelled and no-show" throughout
- ✅ **Settings page** — new `/settings` route; `SettingsContext` for `themeHex` (default `#630812`); `hexToHsl` + `fgForHex` helpers; `--primary`/`--primary-foreground` CSS vars applied at runtime; timeline defaults toggles delegate to `TimelineSettingsContext`; persisted to `localStorage` as `maca_settings`
- ✅ **panelMode to sidebar + localStorage** — `panelMode` moved from local Timeline state into `TimelineSettingsContext`; persisted alongside `hideInactive` and `groupBySections` in `maca_timeline_prefs`
- ✅ **Mobile customer search inline** — on small screens (`< sm`) suggestions panel moved inline below phone field with × dismiss; desktop side-panel unchanged; pure CSS responsive classes
- ✅ **Slot start-time filter** — `get_available_slots()` now generates slots where `slot_time < closes_at` only (not `slot_time + duration ≤ closes_at`); migration 020 drops/recreates `slot_result` type adding `sitting_closes_at` and `sitting_doors_close` fields; `GET /slots` passes both fields through; `NewBookingModal` shows amber/red warning when booking end exceeds last-order/doors-close time
- ✅ **BookingDrawer end-time editor** — "End time" button added to Date & time section; native `<input type="time">` on OS picker; calls existing `PATCH /bookings/:id/duration`; midnight crossover handled; Save in drawer header
- ✅ **enable_arrived_status flag** — added to `booking_rules` (migration 021); controls whether "Arrived" status is shown in booking drawer; defaults to `true`; included in `BookingRulesBody` Zod schema and Rules page toggle
- ✅ **BookingDrawer redesign (UX polish)** — new full-panel layout; unified `editMode` string (`null | 'guest' | 'datetime' | 'table' | 'notes'`) replaces multiple boolean flags; guest count supports direct typing (`type="tel"`) in addition to ± buttons; date/time unified editor: clicking either the start-time pill or the end-time pill opens a single inline card with date + start + end pickers (replaced separate Reschedule/End-time modes); customer search panel rendered as `fixed right-[420px] top-14` sibling outside `overflow-hidden` drawer div (fixes previous clipping); `handleCustSearch(changedValue)` called per-field (not multi-field priority) so editing any of name/email/phone independently triggers search
- ✅ **Timeline grey strips in secondary combo rows** — secondary row canvas now rendered at `z-index: 4` (above primary row's z=3 stacking context) with `pointer-events: none` (passes clicks through to the primary's spanning card); clipped `linear-gradient` background makes grey strips visible outside the booking time while remaining transparent where the spanning card sits
- ✅ **Grey strip architecture redesign** — per-row grey strip rendering removed entirely; single CSS `linear-gradient` as `backgroundImage` on the rows wrapper div; `backgroundColor` for custom timeline bg; decoupled from per-row z-index stacking; booking tiles cover grey naturally via their own opaque backgrounds
- ✅ **Status colours** — 9 booking statuses each have a customisable hex bg colour; `DEFAULT_STATUS_COLOURS` in `SettingsContext`; `deriveBorderFromBg()` (HSL lightness −30pp) auto-derives border; `applyStatusColours()` writes `--status-{name}-bg/bd` CSS vars on `:root`; `index.css` uses `var(--status-confirmed-bg, #bfdbfe)` etc.; `setStatusColour(status, hex)` + `resetStatusColours()` exposed from context; `StatusColourEditor` in Settings with 12 pastel swatches + colour picker + Done + Reset all
- ✅ **Timeline background colour** — `timelineBg` state in `SettingsContext` (default `#ffffff`); applied as `backgroundColor` on the Timeline rows wrapper div; 6 predefined swatches + `ColourPickerRow` in Settings
- ✅ **Closed/unavailable area colour** — `greyColour` state in `SettingsContext` (default `#8c8c8c`); `hexToRgba(greyColour, 0.38)` used in `greyBackground` useMemo gradient stops; 6 grey swatches + `ColourPickerRow` in Settings
- ✅ **Tile modes (compact / extensive)** — `tileMode` + `compactFontSize` in `TimelineSettingsContext`; persisted to `maca_timeline_prefs`; `ROW_HEIGHT_MAP = { compact: { sm:36, md:44, lg:52 }, extensive: 72 }`; `BookingCard` renders single-row (compact) or 3-line flex-col (extensive); extensive shows phone + table allocation via `tableById` Map; `Detail` toggle button in AppShell sidebar; default tile mode + compact size configurable in Settings
- ✅ **Wide time columns** — `wideColumns` boolean in `TimelineSettingsContext` (default `false`); `const hourWidth = wideColumns ? 120 : HOUR_WIDTH`; all three utility functions (`timeToX`, `sittingTimeToX`, `durationToWidth`) accept optional `hw` param defaulting to `HOUR_WIDTH`; all resize/drag/canvas-click/grey-strip calculations use `hourWidth`; `TableRow`, `BookingCard`, `TimelineHeader` all accept `hourWidth` prop; toggle in Settings → Timeline defaults
- ✅ **ColourPickerRow sync fix** — `useEffect(() => setHexInput(value), [value])` added so local picker state syncs when an external swatch button updates the context value (previously only colour wheel/hex input worked; swatches appeared to do nothing)
- ✅ **Resize drag no-drawer-open** — `wasResizingRef` boolean ref set to `true` in `handleUp` after resize mutation fires; `handleBookingClick` checks ref and returns early (suppressing drawer open) then resets ref; prevents the `click` event that fires after `pointerup` from opening the booking drawer
- ✅ **Timeline TDZ fix** — `hourWidth`, `totalWidth`, `rowHeight` declarations (and their `tileMode`/`compactFontSize`/`wideColumns` destructure) moved to before the `nowX` useMemo in `Timeline.jsx`. Previously they were declared ~50 lines after `nowX`, causing a `ReferenceError: Cannot access '...' before initialization` crash (Temporal Dead Zone) that made the entire Timeline render blank. Also added `hourWidth, totalWidth` to the `nowX` dep array.
- ✅ **Compact tile vertical padding** — `py-[3px]` added to the compact tile content div (`flex items-center h-full ...`) so there is a small top/bottom gap around text inside each booking tile in compact mode.
- ✅ **Opening hour line** — `showStartLine` (boolean, default `true`) and `startLineColour` (hex, default `#630812`) added to `SettingsContext`; `firstOpenX` useMemo in Timeline computes x-position of first sitting's `opens_at` for the selected date; a `position:absolute` 3px-wide full-height overlay div is rendered inside the Timeline wrapper at `LABEL_WIDTH + firstOpenX` (z=2, `pointer-events:none`) when `showStartLine` is true; Settings → Appearance shows toggle + colour picker + 6 swatches (only visible when line is enabled).
- ✅ **Shade header row** — `headerBgStrips` boolean (default `false`) added to `SettingsContext`; when true the same `backgroundStyle` object (grey strips + diagonal stripes) is applied as inline style to the `TimelineHeader` outer div, replacing `bg-background`; sticky label cell retains `bg-background` regardless; toggle in Settings → Appearance.
- ✅ **Last order time inclusive** — migration `022_slot_inclusive_last_order.sql` changes `WHILE v_slot_time < v_sitting.closes_at` to `<=` so the last-order slot itself is bookable (e.g. 22:00 last orders → 22:00 slot offered). Uses `CREATE OR REPLACE FUNCTION` so no type drop needed.
- ✅ **Section headers in grouped view (bug fix)** — grouped-section `TableRow` call was missing `rowHeight`, `tileMode`, `compactFontSize`, `tableById`, `hourWidth` props; now matches flat-view `TableRow` exactly.
- ✅ **Timeline hour range control** — `timelineStart` (default 9) and `timelineEnd` (default 24) added to `TimelineSettingsContext`; persisted to `maca_timeline_prefs`; derived `startHour`, `endHour`, `totalHours` in Timeline component; `timeToX` and `sittingTimeToX` accept optional `sh = START_HOUR` third param; `startHour` threaded to `TableRow`, `BookingCard`, `TimelineHeader`, all useMemos and drag/resize/canvas-click handlers; Settings → Timeline defaults shows two hour dropdowns.
- ✅ **Drawer table override uses /relocate** — single-table selection in `BookingDrawer` now calls `PATCH /bookings/:id/relocate` (triggers cascade displacement), multi-table still calls `PATCH /bookings/:id/tables`.
- ✅ **Overlap detection (stop sign)** — `overlappingIds` useMemo O(n²) pairwise check on active bookings for shared tables and overlapping time windows; overlapping `BookingCard` tiles get red `ring-2 ring-red-500 ring-inset` border and `⛔` badge top-right.
- ✅ **Date display as full word** — Timeline top bar replaced with styled-button + invisible `<input type="date">` overlay (matching Bookings pattern); both Timeline and Bookings now show `EEEE d MMMM yyyy` format (e.g. "Monday 22 March 2026"); "Today" shown when on current date; Today button only visible when not on today.
- ✅ **Opening hour line per sitting** — `firstOpenX` (single value) replaced with `sessionStartXs` (array); one 3px line rendered per sitting so both lunch and dinner get their own line; `TimelineHeader` receives `sessionStartXs`/`showStartLine`/`startLineColour` props and renders lines inside its canvas when `headerBgStrips` is on.
- ✅ **Header shade toggle fix** — `TimelineHeader` outer div was missing `bg-background` class so it appeared shaded by default (parent wrapper's `backgroundStyle` bled through); `bg-background` added to the `className` — `backgroundStyle` inline style overrides it when `headerBgStrips` is on.
- ✅ **Session names on sittings** — migration `023_sitting_names.sql` adds `name text` (nullable) to `venue_sittings`, `override_sittings`, `exception_sittings`; `SittingBody` Zod schema updated; `name` returned in `sittings-for-date` and all schedule GET endpoints; Schedule.jsx sitting editor has a "Session name" text input (placeholder: e.g. Lunch, Dinner); name displayed next to time range in sitting list.
- ✅ **Per-sitting stats bar** — `sittingStats` useMemo in Timeline maps active bookings to sittings by HH:MM comparison; shows total bk/covers + per-sitting breakdown in Timeline and Bookings top bars (`hidden sm:flex`); uses sitting `name` if set, falls back to `opens_at–closes_at` time range.
- ✅ **Capacity warning always visible in drawer** — `hasCapacityIssue = booking.covers > (combination_max_covers ?? table_max_covers)` computed on drawer open; amber warning shown permanently in table section (not just when editMode === 'table').
- ✅ **Sidebar expanded-by-default setting** — `sidebarExpandedDefault` boolean (default `true`) added to `SettingsContext`; AppShell uses it to initialise the `open` state on desktop (mobile always starts collapsed); Settings → Interface toggle.
- ✅ **Zero cap greying fix** — `staleTime: 0` added to `slots-overlay` query; `if (slots.length > 1)` changed to `>= 1` with `intervalMs` defaulting to 15 min so single-slot venues now get cap=0 greying.
- ✅ **Unallocated option in drawer** — `tables` query made non-lazy (always fetches); `unallocatedTable` derived from `tables.find(t => t.is_unallocated)`; "Unallocated" checkbox added at top of table picker (orange); currently-unallocated bookings show orange "Unallocated" badge in view mode; `handleTableSave` routes unallocated selection to `PATCH /tables` (not `/relocate`); `toggleTable` clears unallocated when a real table is picked.
- ✅ **Table lock** — `table_locked boolean DEFAULT false` on `bookings` (migration 024); `PATCH /bookings/:id/lock` toggles the flag; `/relocate` conflict scan now selects `table_locked` and throws 422 before displacing if any conflicting booking is locked; `BookingDrawer` shows a lock/unlock icon button inline next to the table pill (amber ring when locked, muted when unlocked); `Lock`/`Unlock` icons from lucide-react.
- ✅ **Tenant Website Builder / CMS — one site per tenant + location pages** *(migrations 025 + 026 + 027 + 041 + 042 + 043)*. Each master franchisee has ONE site at `{tenant_site.subdomain_slug}.macaroonie.com` (or a verified custom domain). Each venue under the tenant becomes a `/locations/{venue.slug}` page driven by `website_config` + the venue row, plus a `/locations` index. Booking widget gained a tenant mode (`/widget/tenant/:tenantId`) with a location-picker step 0, and a `?venue=<id>` deep-link param. Migration 043 (May 2026) flipped the architecture from one-site-per-venue to this model — the `tenant_brand_defaults` table was renamed to `tenant_site` and absorbed `subdomain_slug`, `custom_domain[_verified]`, `home_blocks`, `is_published`, `meta_title/description`, `default_widget_venue_id`, locations-index settings (`hide_locations_index`, `locations_heading`, `locations_intro`); `website_config.home_blocks` → `page_blocks` (drives the location page layout); `website_pages` got a nullable `venue_id` (NULL = tenant-level page, non-NULL = location page). **Pre-flip background:** Venue sites inherit brand defaults and override per-location (address, hours, gallery, menus, hero, about). New tables: `website_config` (per-venue, UNIQUE venue_id), `website_opening_hours`, `website_gallery_images`, `website_pages`, `website_menu_documents`, `website_allergen_info` (migration 025). Migration 026 adds `custom_domain`, `custom_domain_verified`, `template_key` ('classic' | 'modern'), and `theme` JSONB. Migration 027 shifts from UNIQUE tenant_id to UNIQUE venue_id, adds `tenant_brand_defaults` with emergency banner. Pluggable storage service (`STORAGE_DRIVER=local|s3`). Subdomain + custom-domain SSR renderer with `@fastify/view` + Eta. Two shipping templates (classic, modern) sharing theme CSS variables. Admin page at `/website` with venue picker + brand defaults mode (4 sections: identity, theme, analytics, emergency banner) + per-venue mode (18 sections: setup, template, theme overrides, branding, hero, about, gallery with @dnd-kit reorder, PDF menus, allergens, opening hours, find us, contact + socials, online ordering, delivery providers, booking widget, custom pages, SEO, analytics). Deployment pieces (wildcard Nginx, DNS, SSL) pending — see Outstanding items.
- ✅ **Cash recon — SC included_in_income flag** *(migrations 033 + 034)* — independent `included_in_income` boolean on `cash_sc_sources`. Works alongside existing `included_in_takings` with XOR variance adjustment: both on = no change (SC in income AND till); income only = subtract (SC bundled in income but not in till); takings only = add (SC not in income but in till); both off = no change. Toggle in admin SC source editor. Summary shows signed "SC adjustment" line. Weekly grid variance also uses XOR logic.
- ✅ **Booking email system** *(migration 035)* — end-to-end: `manage_token` UUID on bookings (guest auth for self-service). Pluggable email service (`emailSvc.js`) with 4 providers (SendGrid, Mailgun, SES, SMTP) selectable per venue. Default HTML email templates (confirmation, reminder, modification, cancellation) with 16 `{{merge_fields}}`. Email worker (`emailWorker.js`) processes BullMQ jobs: loads booking + venue + template, renders fields, sends, logs to `email_log`. Reminder scheduling via delayed BullMQ jobs (configurable hours-before per venue). Guest manage page at `/manage/{token}` (SSR, themed, modify date/time/covers + cancel with double-confirm). Triggers wired into bookings.js (confirmation on create, cancellation on status change, reminder on confirm). Admin page at `/email-templates` with 3 tabs: template editor (per-type, merge field pills, preview iframe, reset-to-default), settings (provider, credentials, sender, reminders, guest permissions), sent emails log.
- ✅ **Auto-deploy migrations** — `api/scripts/migrate.js` runner with `schema_migrations` tracking table. Runs automatically in GitHub Actions workflow + deploy.sh. Auto-baseline (`AUTO_BASELINE_UP_TO=024` env) for servers whose schema predates the runner. Manual baseline workflow (`.github/workflows/db-baseline.yml`).
- ✅ **CLAUDE.md session protocols** — adopted SOS Checklist, EOS Protocol, Standard Design Rules, Doc maintenance section from the COGS template. TOC added. Gotchas section marked append-only.
- ✅ **Visual email editor** — TipTap WYSIWYG with toolbar (bold/italic/underline, headings, lists, alignment, link, image, divider, colour picker, CTA button insert). Visual / HTML mode toggle. Merge field pills insert at cursor in visual mode. `<a class="btn">` preserved via extended Link extension with class attribute round-trip. URL sanitisation (`isSafeUrl`) prevents `javascript:`/`data:` injection.
- ✅ **Platform admin + tenant/user management** *(migration 036)* — `platform_admins` table (global, no RLS). Auth middleware detects platform admins and bypasses all role gates. `GET /api/me` returns user profile + available tenants (for org switcher). Platform admin routes: `GET/POST/PATCH /api/platform/tenants` + stats. Team routes: `GET/POST/PATCH/DELETE /api/team` for invite, role change, deactivate (owner-only, self-protected). Org switcher in AppShell sidebar (re-authenticates with different Auth0 org). `VITE_AUTH0_ORG_ID` now optional. Team page at `/team`. Platform page at `/platform`.
- ✅ **Auth0 Management API integration** — full team lifecycle in-app, no Auth0 dashboard required for tenant operators. New service `api/src/services/auth0MgmtSvc.js` (token caching via client-credentials grant, `inviteUserToOrg`, `removeUserFromOrg`, `updateUserAppMetadata`, `sendPasswordResetEmail`). `POST /api/team/invite` now sends an Auth0 organization invitation email and rolls back the local row if Auth0 fails. `PATCH /api/team/:userId` syncs role to Auth0 `app_metadata.role` whenever role changes. `DELETE /api/team/:userId` removes the user from the Auth0 org membership in addition to setting `is_active=false` locally. New endpoint `POST /api/team/:userId/reset-password` (owner-only) sends an Auth0 password change email — no need to touch the Auth0 dashboard. Auth middleware reconciles Auth0 sub ↔ local user on first login (links by email when invited row has `auth0_user_id IS NULL`), uses local `users.role` as source of truth for `req.user.role`, and rejects auth when local `is_active=false`. New env vars `AUTH0_MGMT_CLIENT_ID`, `AUTH0_MGMT_CLIENT_SECRET`, `AUTH0_INVITE_CLIENT_ID` (all optional — when missing, system degrades to local-only invites with a warning banner in the Team page). Migration 037 seeds the initial platform admin (Michal) so `/platform` works on first deploy.
- ✅ **Auto-provision Auth0 organisations on tenant creation** — `POST /api/platform/tenants` with `auto_provision: true` (UI default) creates the Auth0 organisation via `provisionTenantOrg()` and enables Username-Password + Google connections with `assign_membership_on_login: true` baked in. New helpers in `auth0MgmtSvc.js`: `createOrganization`, `getConnectionByName`, `enableOrgConnection`, `provisionTenantOrg`. The tenant row is inserted in the DB FIRST (with the provisioned `auth0_org_id`), so a partial Auth0 failure leaves the platform admin a clear edit path. Response includes `auth0_provisioning: { attempted, org_created, enabled_connections, error }` so the UI can surface partial failures with an inline warning. Requires extra M2M scopes (`create:organizations`, `read:connections`, `create:organization_connections`) on top of the team-invite scopes — listed in `api/.env.example`.
- ✅ **Configurable RBAC: tenant module switches + custom roles** *(migration 038)* — extends RBAC beyond the booking-focused enum. Two new tables: `tenant_modules` (per-tenant on/off switch per module — disabled modules are hidden from nav AND rejected at the API) and `tenant_roles` (custom roles per tenant with a `permissions` JSONB mapping `module_key → 'manage' | 'view' | 'none'`). 4 built-in roles seeded (owner/admin/operator/viewer); built-in roles can have permissions edited but not deleted. New `users.custom_role_id` (nullable) takes precedence over the legacy `users.role` enum when set. New module registry at `api/src/config/modules.js` lists all 14 modules + descriptions + per-built-in defaults — single source of truth for migrations, API, UI.
  - **Module groups** (`MODULE_GROUPS` in modules.js) bundle tightly-coupled modules under one master switch. Current groups: `bookings` (bookings, venues, tables, schedule, rules, customers, widget_test), `email_templates`, `website`, `cash_recon`. Core modules (dashboard, team, settings, documentation) are `core: true` with no master switch. The tenant Modules tab in `/access` toggles GROUPS, not individual modules — disabling Bookings hides every booking-related nav entry at once.
  - **Role permissions stay per-module** so a role can have `bookings: manage` + `rules: view` even though both belong to the same group.
  - **Routes**: `/api/access/modules` (per-module list/patch — internal), `/api/access/module-groups` (group-level toggles — what the UI uses), `/api/access/roles` (custom-role CRUD).
  - New `requirePermission(moduleKey, level)` middleware for route gating. `/api/me` extended with `enabled_modules: string[]`, `permissions: { module: level }`, `effective_role`. AppShell filters nav by `me.permissions[item.module]`. New admin page at `/access` with Modules (group toggles) + Roles tabs.

---

## Outstanding items

### Build next (larger features)

**1. Booking widget — Stripe deposit flow**
The free-booking widget is shipped (`/widget/:venueId` + `/widget-api/*`).
Deposit-required venues currently throw 422 on `confirm`. Wire the existing
`/payments/intent` Stripe flow into the public widget: Payment Intent created
on hold, public Stripe.js form, webhook → confirm_hold. Same UX, just an
extra step before Confirmed.

**2. GloriaFood sales integration**
*(paused — needs API access details from the user)* Pull order data from GloriaFood
for sales reporting and reconciliation. Architecture decisions pending: Partner API vs
Restaurant API, polling vs webhook, per-venue vs tenant-level credentials, where it
displays in the admin UI.

**3. Header & Footer as page-builder blocks**
The site header and footer are currently template-baked (`templates/{key}/partials/header.eta` + `footer.eta`) and read auto-derived data: tenant_site logo + nav from venues/menus/pages, social_links, address, etc. Operators want them editable AS BLOCKS in the page builder so they can add/remove nav links, swap CTA copy, restructure footer columns, surface custom social handles. Required:
- Two new block types: `header` and `footer`. Each has rich data shape (header: `{ logo_url, brand_text, nav_items: [{label,url}], cta: {text, url} }`; footer: `{ columns: [{title, items: [{label,url}]}], copyright, show_social, show_powered_by }`).
- React canvas components for both, with editor controls (add/remove link, drag-reorder).
- Eta block partials per template (`templates/{key}/blocks/header.eta`, `footer.eta`) so each template renders its own signature chrome.
- Rendering shift: `index.eta` and `location.eta` STOP including `partials/header.eta` / `partials/footer.eta`. Instead, the home_blocks/page_blocks array renders, and we auto-prepend a `header` block + auto-append a `footer` block when missing (so the user always gets working chrome out of the box).
- Page builder UX: header block should be locked at index 0, footer at the last position (no drag). New "+" inserter sits between them.
- Picking a page template seeds blocks with header + footer at the expected positions.

**4. RBAC rollout to existing routes**
The foundation (migration 038, `requirePermission` middleware, `/api/access/*`, `/access` admin page) is in place. Still to do — incrementally:
- Replace `requireRole('admin', 'owner')` with `requirePermission('<module>', 'manage')` on every existing route, module by module
- Update `Team.jsx` to assign `custom_role_id` (currently still writes the legacy `users.role` enum)
- Add per-page route guards in `main.jsx` so e.g. `/cash-recon` redirects to dashboard if `permissions.cash_recon === 'none'` (currently the page renders and just gets an empty list)
- Surface a tooltip / disabled-button affordance on `view`-only access (currently hidden vs full-access; no middle-state UX yet)

**4. Customer hard delete**
Customers page currently supports anonymise (GDPR erasure by overwrite) but not hard delete.
A double-confirmation hard delete (for internal test/demo data cleanup) is still outstanding.
Must cascade-delete linked bookings or reassign them. Requires `requireRole('owner')` guard.

**5. Website builder — deployment pieces** *(feature shipped code-side, not yet deployed)*
- Nginx: wildcard server block for `*.macaroonie.com` (proxy_pass → Fastify API).
- DNS: wildcard A record `* → <Lightsail-IP>` on Lightsail DNS. Wildcard does NOT
  shadow more-specific records (regular `api`, `app`, etc. take precedence as expected).
- SSL: wildcard cert via Certbot DNS-01. **DNS lives on AWS Lightsail** (NOT Route53,
  NOT Cloudflare), so there's no off-the-shelf Certbot plugin. Use AWS CLI hook
  scripts with `certbot --manual --preferred-challenges dns-01` — see the runbook in
  the "Lightsail wildcard cert setup" gotcha below for the full path including IAM
  policy, hook scripts, and the renewal cron entry.
- Custom domains: per-tenant SSL provisioning (Caddy on-demand TLS or Certbot per
  domain). The app only resolves the Host header; cert provisioning is out of process.
- Migrations 025 + 026 + 027 + 035 + 036 + 037 + 038 + 039 + 040 + 041 + 042 are applied automatically by the migrate runner
  (or auto-baselined on first run via `AUTO_BASELINE_UP_TO=024`).
- Optional: set `STORAGE_DRIVER=s3` + `S3_*` env vars to use S3 / DO Spaces / R2
  instead of local disk for uploads.

**6. Email system loose ends**
- `nodemailer` is not in `api/package.json` — the SMTP email provider will crash on first use.
  Add `"nodemailer": "^6.9.0"` if any tenant selects SMTP.
- Guest manage page `POST /modify` directly UPDATEs `starts_at` without checking
  `get_available_slots()` — a guest could move into a slot that's already full or outside
  any sitting. Add slot validation before applying.
- Stripe webhook confirmation path (`payments.js handlePaymentSucceeded`) does not
  schedule reminder emails; only the free-booking path does. Wire `scheduleReminder()`
  into the webhook path too.
- After deploy, clear stale BullMQ jobs in Redis — the `notificationQueue` job name
  changed to `'booking_email'` (with required `venueId` field), so old-format jobs
  enqueued before the change will fail forever.
- Legacy `src/services/notificationSvc.js` is dead code — safe to delete.

**7. Docs.jsx update for platform/team**
Help.jsx has a Team Management section; Docs.jsx does not yet have a corresponding
technical section for the platform-admin routes, RBAC matrix, or `platform_admins` table.

**8. Test suite**
No tests exist yet. Recommended approach:
- API: Vitest + supertest for route integration tests
- DB: Use a test database with migrations applied, reset between test runs
- Priority test targets: `confirm_hold()` race condition, slot resolver output, booking flow end-to-end, admin-override booking creation, schedule exception resolution

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

> **This section is append-only.** Never delete an entry — only correct one if it turns out to be wrong. This is the most-read section of the doc; every "subtle why didn't that work" bug gets a new entry.

- **Never query tenant tables without `withTenant()`** — RLS silently returns empty rows, not an error.
- **Never trust client for payment confirmation** — booking only becomes permanent via Stripe webhook, not client-side resolve.
- **Never store slots** — they are always computed. Do not add a `slots` table.
- **`slot_duration_mins` ≠ `slot_interval_mins`** — duration is how long a booking lasts, interval is how often a new slot starts. Both live on different tables.
- **`max_covers = 0` on a slot cap ≠ fully booked** — it means intentionally blocked. The `zero_cap_display` venue setting controls whether it shows as hidden or unavailable.
- **Hold TTL is configurable per venue** — `booking_rules.hold_ttl_secs`. Default 300 (5 min). Widget countdown is driven by `expires_at` from the hold response, not a local timer.
- **pg_cron is a fallback** — the primary hold release is the explicit `DELETE /holds/:id` call. Don't rely on the sweep as the main path.
- **`slot_time` from DB is `HH:MM:SS`** — PostgreSQL `TIME` columns serialise to `HH:MM:SS` in JSON, but the API validation regex expects `HH:MM`. Always call `.slice(0, 5)` on slot_time values before using them as keys or sending them back to the API. **CAVEAT:** this only applies to columns of type `time` (e.g. `sitting_slot_caps.slot_time`, `venue_sittings.opens_at`). The composite type returned by `get_available_slots()` had its `slot_time` field changed from `time` to `timestamptz` in migration 020, and postgres.js deserialises that to a JS `Date` object — `.slice()` on it throws `s.slot_time.slice is not a function`. For slot_result rows, convert to the venue-local `HH:MM` via `Intl.DateTimeFormat('en-GB', { timeZone: venue.timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(date)` (see `widgetApi.js`). The admin `/api/slots` route passes the Date through and the consumers handle it — the widget API materialises HH:MM strings because the public widget JS interpolates them directly into a date string.
- **`combination_id` must be copied from hold to booking** — `POST /bookings` (free-booking path) copies it; `confirm_hold()` PG function does not yet — see Outstanding items. Never assume the booking record has `combination_id` set just because the hold had it (on the Stripe webhook path).
- **`guest_notes` was silently dropped on paid bookings** — now fixed. The Stripe webhook INSERT previously omitted both `combination_id` and `guest_notes`. Both are now copied from the hold record.
- **`/relocate` throws 422 when no combo exists for expanded table set** — step 4 no longer auto-creates combinations. If adjacency expansion finds T8+T9+T10 but no pre-configured combination exists for those tables, the endpoint returns 422 and the drag snaps back. Operators must create the combination in the Tables page first.
- **`v_exc_template` in `get_available_slots()`** — when no schedule exception covers the date, the record variable is never assigned by SELECT INTO. Accessing `.id` on an uninitialized PL/pgSQL RECORD throws PG 55000 'not assigned yet'. Always use a scalar UUID variable (`v_exc_template_id uuid := NULL`) and assign it only when the record IS found.
- **Admin override `starts_at` is server-local time** — `POST /bookings/admin-override` receives `YYYY-MM-DDTHH:MM:SS` without a timezone offset and passes it to `new Date()`, which interprets it as server-local time. If the server and venue are in different timezones, the stored `starts_at` will be offset. Future work: pass the venue's IANA timezone and convert in the server.
- **Timeline grey strips are per-column, not per-row** — grey = outside any sitting OR slot cap explicitly set to 0 (reason='unavailable'). Fully-booked slots (reason='full') are NOT greyed — they stay white. Secondary combo rows clip grey strips to the booking's own time window only; grey IS shown outside the booking's time.
- **`table_combination_members` has no `tenant_id`** — RLS on that table is enforced via a subquery on `table_combinations`. Never pass `tenant_id` to INSERT INTO `table_combination_members`.
- **`notificationQueue.add()` must never be awaited in request path** — Redis may be unavailable. Always use fire-and-forget: `.catch(e => req.log.warn(...))`. The booking is created and the response sent; the email is best-effort.
- **Customer anonymise never deletes** — GDPR right to erasure is implemented by overwriting PII fields with placeholder values and setting `is_anonymised=true`. The row is kept for audit/reporting. Never DELETE a customer row.
- **`api.download()` in the frontend** — use `api.download(path, filename)` to fetch auth-protected binary responses (JSON exports, etc.). It handles the Auth0 token injection and creates a temporary object URL for the browser Save dialog.
- **deploy.sh requires root but builds as ubuntu** — the script requires `sudo` to talk to PM2, but all `npm install` / `npm run build` steps must run as the `ubuntu` user to keep `dist/` and `node_modules/` owned by ubuntu. If `dist/` becomes root-owned, run `sudo chown -R ubuntu:ubuntu /home/ubuntu/app/admin/dist` then redeploy.
- **`slot_result` type requires DROP + CREATE** — PostgreSQL composite types used in functions cannot be altered. Any migration that adds fields to `slot_result` must `DROP FUNCTION get_available_slots` first, then `DROP TYPE slot_result`, then recreate both. See migration 020.
- **slot warning in booking modal uses local time** — `new Date(slot_time).getHours()` interprets the UTC timestamp in the browser's local timezone. If the server timezone and browser timezone differ, warning thresholds may be slightly off. Fix: use `slotsRes.timezone` to convert properly (outstanding).
- **`checked_out` is NOT the same as `completed`** — `completed` was renamed to `seated` in migration 017. `checked_out` is a new separate status (after seated). Do not confuse the two in queries or UI labels.
- **Secondary combo row canvas at z=4** — secondary combo rows (where the spanning card from the primary row above paints over them) must have `z-index: 4` AND `pointer-events: none` on their canvas div. z=4 ensures their clipped gradient background paints above the primary's z=3 stacking context. `pointer-events: none` lets click and drag events pass through to the primary row's spanning card. Without z=4, the gradient is invisible (the primary's z=3 stacking context covers T3B entirely).
- **`handleCustSearch` in BookingDrawer takes a single field value** — pass only the value of the field that just changed, not all three fields. The previous multi-field priority logic meant editing name while email was already filled always searched by email, so name-only changes never triggered search.
- **`ColourPickerRow` has local `hexInput` state** — the component uses `useState(value)` for the colour wheel and hex text input, which only initialises once. If the context value changes externally (e.g. an external swatch button calls `setTimelineBg(hex)`), the picker will show a stale colour unless synced via `useEffect(() => setHexInput(value), [value])`. Always include this effect when using `ColourPickerRow` alongside external swatch buttons that update the same context value.
- **`hourWidth` must be threaded everywhere in Timeline** — `HOUR_WIDTH = 80` is the module-level constant used as the default param in utility functions. The runtime `hourWidth` (80 or 120 from `wideColumns`) must be passed as a prop to `TableRow`, `BookingCard`, and `TimelineHeader`, and used in all pixel calculations (drag/resize deltas, `nowX`, `unavailableStrips`, gradient offsets, `handleCanvasClick`). Using the module constant directly in any of these bypasses the wide-columns setting.
- **`wideColumns` dep in useMemos** — `unavailableStrips` useMemo depends on `[sittingsForDate, slotsOverlay, hourWidth, totalWidth]`. If `hourWidth` is omitted from the dep array, the grey strips will not reposition when the wide-columns toggle changes.
- **`hourWidth`/`totalWidth`/`rowHeight` must be declared before `nowX` useMemo** — these are `const` declarations inside the component function body. `nowX` references `hourWidth` and `totalWidth` inside its callback. Because `useMemo` runs synchronously on first render, accessing a `const` that appears later in the function body throws a Temporal Dead Zone (TDZ) `ReferenceError`. Always keep `hourWidth`/`totalWidth`/`rowHeight` above any useMemo that references them.
- **`headerBgStrips` removes `bg-background` from `TimelineHeader` outer div** — when `headerBgStrips` is true, `backgroundStyle` is applied as inline style to the header's outer div, which overrides the Tailwind `bg-background` class (inline styles win). The sticky label cell inside still carries its own `bg-background` to mask scrolling content behind it. If you add any new wrapper classes to `TimelineHeader` that set a background, they will be silently overridden when `headerBgStrips` is on.
- **`showStartLine` colour picker only mounts when line is enabled** — in Settings, the `ColourPickerRow` for `startLineColour` is conditionally rendered inside `{showStartLine && ...}`. This means the picker's local state is reset each time the toggle is switched on. This is intentional (avoids a stale picker) but means the hex input always initialises from the context value when re-shown.
- **`sessionStartXs` replaces `firstOpenX` in Timeline** — the opening-hour line is now drawn once per sitting (not just the first sitting of the day). The useMemo returns an array; render site maps over it. Never revert to a single scalar — venues with lunch + dinner sessions need both lines.
- **Drawer table override routes single vs multi** — single table → `PATCH /relocate` (cascade displacement); multi-table → `PATCH /tables` (direct assignment, no displacement); unallocated table → `PATCH /tables` (never /relocate — the relocate endpoint rejects the unallocated table ID). Check `handleTableSave` branching logic before modifying.
- **`tables` query in BookingDrawer is non-lazy** — it was previously `enabled: editMode === 'table'`. It now fetches immediately on drawer open so `unallocatedTable` and `hasCapacityIssue` are available in view mode. Do not re-add the `enabled` gate.
- **Sitting `name` field is nullable text** — `SittingBody` validates it as `z.string().max(100).nullable().optional()`. In the frontend, always fall back to the time-range string: `sitting.name ?? \`${sitting.opens_at.slice(0,5)}–${sitting.closes_at.slice(0,5)}\``.
- **`sidebarExpandedDefault` only controls initial state** — it initialises the `open` state in AppShell's `useState`. Subsequent manual toggles work normally per-session. Mobile always starts collapsed regardless of the setting.
- **`sittingStats` useMemo uses local browser time for HH:MM comparison** — booking start times are UTC ISO strings; `new Date(b.starts_at).getHours()` returns local time. If the server timezone differs from the browser, bookings near sitting boundaries may be assigned to the wrong sitting in the stats display (cosmetic only — not used for any business logic).
- **Migration 022 uses `CREATE OR REPLACE FUNCTION`** — unlike migration 020 which had to `DROP TYPE slot_result` before recreation, migration 022 does not change the return type so `CREATE OR REPLACE` is safe. If you ever need to change `slot_result` again, revert to the DROP + CREATE pattern.
- **Overlap detection is frontend-only** — `overlappingIds` is computed from the in-memory `bookingsRes` array. It does not call the API. If a booking is created by another user and the timeline hasn't refreshed, an overlap may not be detected until the next WebSocket push or 60-second refetch.
- **`startHour` must be threaded the same way as `hourWidth`** — `timeToX(iso, hw, sh)` and `sittingTimeToX(t, hw, sh)` both accept `sh` (startHour) as a third optional param defaulting to `START_HOUR`. In the Timeline component, `startHour` is derived from `timelineStart` (context). Pass `startHour` as a prop to `TableRow`, `BookingCard`, and `TimelineHeader` — exactly the same threading pattern as `hourWidth`. All useMemos calling these functions must include `startHour` in their dep arrays. Using the module constant `START_HOUR` directly anywhere in the component body bypasses the timeline hour range setting.
- **`table_locked` is checked in `/relocate` only** — the lock prevents cascade displacement when an operator drags a booking onto tables occupied by a locked booking. It does NOT prevent the operator from directly reassigning via `PATCH /tables` (multi-table path) or `POST /bookings/admin-override`. The lock is a hint to the relocation engine, not a hard DB constraint.
- **Website CMS: subdomain slug is a GLOBAL namespace** — `website_config.subdomain_slug UNIQUE` across all tenants. Separate from `tenants.slug` (Auth0 lookup). `GET /api/website/slug-available?slug=...` must be used before POSTing a new config; the endpoint is authenticated but does NOT use `withTenant()` because it needs to see other tenants' rows.
- **Website CMS: custom_domain is the SSR lookup key, not the SSL provisioning key** — the app resolves the Host header against `website_config.custom_domain`. It does NOT issue certificates. SSL is terminated at Nginx (or Caddy on-demand TLS); the tenant-facing flow is: (a) tenant sets `custom_domain`, (b) tenant points DNS at our IP, (c) tenant clicks "Verify DNS" → `POST /api/website/verify-domain` (checks A + CNAME records), (d) an out-of-band process provisions a cert. Setting the domain clears `custom_domain_verified` so the site stays offline until verified.
- **Website CMS: `theme` JSONB is column-overwrite, not deep-merge** — PATCHing `theme: {...}` replaces the whole column. The admin page's `ThemeSection` holds the FULL merged theme in local state and PATCHes the entire object. Don't try to PATCH a partial theme object — the missing keys become null, not defaults.
- **Website CMS: pluggable storage via `STORAGE_DRIVER`** — `local` writes to `UPLOAD_DIR` and serves through `@fastify/static` at `/uploads/*`. `s3` lazy-imports `@aws-sdk/client-s3` (listed as `optionalDependencies` so local installs don't pay the download cost). Switching drivers mid-flight will ORPHAN existing upload URLs — run a migration script to copy files between backends before switching.
- **Website CMS: templates share CSS variables via `views/site/shared/head.eta`** — the shared head computes every `--c-*`, `--f-*`, `--r-*` CSS variable from `config.theme` (merged over defaults). When adding a new template, consume those variables; don't add a per-template CSS variable schema. When adding a new theme knob, update `ThemeSchema` in `routes/website.js`, the default constant in `admin/src/pages/Website.jsx`, and the CSS-variable emit in `shared/head.eta` together.
- **Website CMS: reserved subdomains** — `api, www, admin, app, mail, static, assets, cdn, ws, stripe, webhook, webhooks` never match as tenant sites, regardless of DB content. Extend `RESERVED_SUBDOMAINS` in `siteRenderer.js` before using any new infrastructure subdomain.
- **Website CMS: `loadSiteBundle()` reloads on every request** — no caching. Cheap (~1 round trip for the config + a single parallel query for everything else) but not free. If traffic becomes a concern, add a short TTL cache keyed on `(tenant_id, updated_at)` inside the service, invalidated on any admin mutation. Don't cache by slug alone — would leak between tenants if slugs are ever reused.
- **Website CMS: `GET /api/site/:slug` short-circuits on `is_published = false`** — returns 404 for the public JSON AND the SSR renderer. Admin preview must go through the admin portal's authenticated path (or pass `includeUnpublished: true` in a future preview endpoint). Never expose the `includeUnpublished` flag on the public route.
- **Website CMS: `custom_domain_verified` is cleared on every mutation of `custom_domain`** — the PATCH handler explicitly sets `custom_domain_verified = false` whenever the body contains `custom_domain`. Refetch the config on the client after PATCHing so the UI shows the unverified state and the "Verify DNS" button.
- **Website CMS: Eta includes are path-relative to the `views` root** — the templates use `include('../../shared/head', it)` because they live 3 levels deep (`views/site/templates/{key}/index.eta`). Don't change the directory layout without updating every include path. Tests catch this only by rendering each template.
- **`timelineStart`/`timelineEnd` are integers, not strings** — stored in localStorage as numbers. When reading from `tlSettings`, do arithmetic directly: `const totalHours = endHour - startHour`. The `<select>` dropdowns in Settings use `Number(e.target.value)` on `onChange` to ensure the stored value is always a number, not a string.
- **React hook stability** — always return stable references from custom hooks. Any object/function used in a `useEffect` deps array must be wrapped in `useMemo` / `useCallback` or you get an infinite render loop. This applies to every `useContext`-returned value, every query result object, and every callback passed as a prop.
- **Migration idempotency** — wrap migrations in `BEGIN`/`COMMIT` (our runner does this automatically via `sql.begin()`). All seeds should use `ON CONFLICT DO NOTHING` / `WHERE NOT EXISTS`. Re-running `scripts/migrate.js` must be safe.
- **Trust but verify (session summaries)** — never reference session-summary items as "still open" without checking the actual code. Session summaries go stale between runs. Always grep / check live code before claiming something is pending.
- **File ownership on server** — if git throws "dubious ownership" on the Lightsail server, fix once with `git config --global --add safe.directory /home/ubuntu/app` rather than chowning files. The deploy workflow uses `git reset --hard` which needs this.
- **`manage_token` is the ONLY auth for the guest manage page** — the UUID in the URL IS the authentication. Do not add rate-limiting or IP-blocking that would break email link clicks. Do not expose manage_token in any admin API list response (it would let any admin-portal user access any guest's manage page).
- **`notificationQueue.add()` job name changed to `'booking_email'`** — the old `'confirmation'` / `'cancellation'` job names are no longer used. The worker now calls `processEmailJob` from `emailWorker.js` instead of the legacy `notificationSvc.sendNotification()`.
- **Reminder jobs use `jobId: 'reminder-{bookingId}'`** — BullMQ deduplicates by jobId, so re-confirming a booking doesn't create duplicate reminders. If the booking is cancelled, the reminder job stays in the queue but `processEmailJob` skips it (checks `reminder_sent_at` and terminal status).
- **Email template `theme` JSONB is column-overwrite** — same as website_config.theme. The admin page's ThemeSection holds the FULL merged theme and PATCHes the entire object. Never PATCH a partial theme.
- **SC `included_in_income` XOR variance** — the two SC flags (`included_in_income` + `included_in_takings`) are independent booleans. The variance formula is `totalIncome + scAdjustment - totalTakings` where scAdjustment is the signed XOR sum. When both flags are on, the adjustment is 0 (not doubled). When only income is on, the SC is subtracted from the expected-till figure. When only takings is on, it's added.
- **Migration 027 number collision** — both `027_cash_reconciliation.sql` and `027_per_venue_websites.sql` exist. They have different version strings in `schema_migrations` so the runner applies both. Confusing but not broken. Do not renumber — would cause re-application on servers that already ran them.
- **`platform_admins` table has NO RLS** — it's a global table queried during auth before any tenant context is set. Never add RLS to it. Access is gated in the API middleware (`requirePlatformAdmin`), not at the DB level.
- **`requireRole()` lets platform admins through automatically** — platform admins bypass all role checks. If you need to restrict something to ONLY tenant-level owners (not platform admins), you need a custom guard that explicitly checks `req.user.role === 'owner' && !req.isPlatformAdmin`.
- **`VITE_AUTH0_ORG_ID` is now optional** — when omitted, Auth0 prompts the user to select an org on login (for multi-tenant users). When set, it forces that org (existing single-tenant behaviour). Removing this env var from an existing deployment changes login UX.
- **Org switcher triggers a full re-authentication** — `loginWithRedirect({ organization: auth0_org_id })` navigates away from the SPA. All local state is lost. This is by design — Auth0 issues a new JWT with the new org's claims. TanStack Query cache is rebuilt on return.
- **Self-protection in team management** — `PATCH /team/:userId` and `DELETE /team/:userId` reject operations where the target `auth0_user_id` matches `req.user.sub`. Cannot demote yourself, cannot deactivate yourself. Enforced API-side (not just UI).
- **Auth0 Mgmt API is OPTIONAL** — when `AUTH0_MGMT_CLIENT_ID`/`AUTH0_MGMT_CLIENT_SECRET`/`AUTH0_INVITE_CLIENT_ID` are unset, `auth0MgmtSvc.isConfigured()` returns false and `/team/invite` falls back to creating a local row only (logged warning, Team UI shows an amber banner). This is intentional for local dev. In production all three MUST be set.
- **When the user pastes a string and errors follow, RECHECK THE STRING first** — don't dive into schema, validation, or framework debugging until the pasted value has been verified end-to-end. Bit us hard with Postmark (2026-05-02): an invisible character from the original clipboard paste produced a 401 "invalid token" response, and I spent multiple turns chasing schema bugs, CHECK constraints, and POST upsert behaviour — while the actual fix was the user re-copying the token to the clipboard. **The fastest sanity check** is to call the external API directly (e.g. `curl -H 'X-Postmark-Server-Token: <pasted-value>' ...`) with the same string and see if the third party rejects it. If THEY reject the raw value, it's the string. If they accept it, it's the app. Don't reflexively add `.trim()` calls to mask possible whitespace — that hides the real issue and tomorrow's bug looks identical.
- **`systemctl reload nginx` doesn't always pick up new `location` modifiers** — adding `^~`, `~*`, or other matching modifiers to existing locations sometimes leaves the running workers using the old matching table even after a clean reload (config tested OK, no error). Symptom: the new behaviour is in `nginx -T` output but requests still hit the old block. `systemctl restart nginx` (full process restart, ~50ms downtime) clears it. For routing-modifier changes, prefer restart over reload.
- **Eta `<% ... %>` JS blocks containing `//` line comments break the parser** — production Eta sometimes fails to detect the closing `%>` when the JS body has line comments (especially comments that contain backticks or em-dashes). Symptom: 500 with "Bad template syntax: Unexpected token '>'", and the compiled JS has literal `<%` / `%>` tokens appearing as raw source where Eta failed to compile them. Bit us on `views/site/shared/head.eta` (May 2026) where I'd added a multi-line `// comment` block above some `const` declarations. **Workaround**: use `/* ... */` block comments inside `<% %>` JS blocks (the rest of the file already does this — match the convention). Single-line `//` comments are usually fine if they don't sit between `<%` and the next `%>` boundary, but block comments are universally safe.
- **Eta `<%= %>` interpolation breaks on certain `.filter(...).join(...)` chains** — production Eta sometimes fails to emit the closing `)` of the wrapping `__eta.e(...)` when the inline expression is a chained array method ending in `.join(' ')` or `.join(' · ')`. Symptom: 500 with "Bad template syntax: Unexpected token '>'", and the compiled JS shown in the error has the source line `<div><%= [a, b].filter(Boolean).join(' ') %></div>` followed directly by `__eta.res+='</div>...'` without the matching `)`. The expression itself is valid JS — Eta just trips on the closing-tag detection in this exact shape. Bit us on `templates/classic/partials/footer.eta` (May 2026). **Workaround**: hoist the join into a `<% const x = [a,b].filter(Boolean).join(' ') %>` statement above the markup, then interpolate the variable: `<%= x %>`. Apply this to every venue card and address line — there are ~15 places across `templates/{classic,modern,onethai}/{fallback_home,fallback_location,locations,menu_hub,partials/footer}.eta`. Do NOT inline-chain `.filter(Boolean).join(...)` inside `<%= %>`.
- **Eta JS blocks must NOT start with `(` after a text/HTML line** — JavaScript's ASI (automatic semicolon insertion) does NOT insert a semicolon before a line starting with `(`, so the previous line's value gets called as a function. Symptom: `"<main>\n\n" is not a function` 500 from Eta. Bit us once when an `index.eta` had `<main>\n\n<% (it.config.home_blocks || []).forEach(...) %>` — the literal `<main>\n\n` ends up being called. Fix: assign the expression to a `const` first, OR use a `for…of` loop, OR put a leading semicolon. Same trap applies to any `<% (...)... %>` after HTML text.
- **Block-based page composition lives in `home_blocks` JSONB** — `website_config.home_blocks` is the only source of truth for the home-page layout. Both SSR templates (classic + modern) iterate `home_blocks` via `views/site/blocks/renderer.eta`. An empty array renders an empty page — there is no legacy flat-layout fallback (removed 2026-05-03 since we're pre-prod). Legacy admin nav entries (Hero, About) were also removed; their content lives inside the page-builder blocks. Legacy columns (`hero_*`, `about_text`, `about_html`) remain in the schema for now but are not read by any template — drop in a future migration when convenient.
- **Block dispatch is a single `<%~ include('./renderer', { ...it, block }) %>`** — the renderer.eta switches on `it.block.type` and includes the right per-block partial. Adding a new block type means: (1) entry in `blockRegistry.js` with editor component + default data, (2) new partial under `views/site/blocks/<type>.eta`, (3) line in `renderer.eta` for the dispatch. The frontend block list is the contract — server treats `data` as opaque JSONB.
- **Data blocks (gallery, hours, contact, etc.) don't store content on the block** — they just store display options like `heading`. Content comes from the existing per-section data (website_config fields, website_gallery_images rows, etc.). This is intentional — a single content source feeds both the legacy flat layout and any block instance, so users editing one place see the change everywhere.
- **All website-CMS image uploads mirror into `media_items`** — `/website/upload` does the storage put AND inserts a media_items row when `kind === 'images'` so the asset is visible in the Media library. PDF kinds (`menus`, `docs`) DON'T mirror because they're tracked via `website_menu_documents`. The `media_item_id` is returned in the response for callers that want to link.
- **`about_html` is the new rich-text source of truth** — templates check `it.config.about_html` first (rendered raw via `<%~ %>`) and fall back to `it.config.about_text` (escaped, with `white-space: pre-wrap`). The admin section uses TipTap and writes to `about_html`. The legacy column stays so existing data keeps rendering. Both Eta `about` blocks (classic + modern) need updating in lockstep when the about layout changes.
- **Theme presets are partial themes — deep-merged onto the current theme** — so a preset that only specifies colors leaves the user's typography tweaks intact. To curate a new preset, add to `THEME_PRESETS` in `Website.jsx`. Don't make presets mutable — they're keyed by `key` and rendered as fixed buttons.
- **Gallery layout is template-side, not CSS-side** — the Eta template branches on `it.config.gallery_style`. The `gallery_size` value maps to two numbers (`thumbMin`, `thumbHt`) at the top of the gallery block — keep them in sync if you change the size enum.
- **Opening hours `source = 'venue'` derives from `venue_schedule_templates` + `venue_sittings`** — `siteDataSvc.loadSiteBundle()` runs a separate aggregate query (`MIN(opens_at), MAX(closes_at)` per `day_of_week`). Result rows are normalised to the same shape `website_opening_hours` produces (`HH:MM` slices, `is_closed` boolean), so the templates don't branch on source. When the user switches source from manual → venue, manual rows in `website_opening_hours` are NOT deleted — they're just ignored in render. Switch back to keep them.
- **Apex Nginx `location /uploads/` must use `^~` prefix-priority** — the apex `macaroonie.com` server block has a regex `location ~* \.(js|css|png|jpg|...)$` that serves static admin-portal assets from `/home/ubuntu/app/admin/dist`. In Nginx, regex locations take precedence over plain prefix locations, so a plain `location /uploads/` is shadowed by the extension regex for `.png`/`.jpg`/etc. and the request gets served (with 404) from the wrong root. Fix by writing `location ^~ /uploads/ { proxy_pass ...; }` — the `^~` modifier tells Nginx to stop after a prefix match without checking regex locations. Same trap applies to any new path serving binary uploads on the apex.
- **PATCH `/website/config` and POST `/website/verify-domain` MUST scope by venue_id** — both endpoints used to filter UPDATE/SELECT only by `tenant_id`, which silently overwrote every venue's website_config under the tenant. A hero image saved for "One Thai Cafe in Ware" propagated to every venue site of the same master franchisee. Fixed (2026-05-03) by including `id = ${existing.id}` (looked up via the existing `ensureConfig(tenant_id, venue_id)` helper) on UPDATE, and by requiring `venue_id` query/body param on `verify-domain`. When adding new endpoints that mutate `website_config`, ALWAYS scope by `venue_id`. The `ensureConfig` helper exists for exactly this — use it.
- **`POST /api/email-templates/settings/:venueId` upserts ALL body fields** — used to be a thin "create with email_provider only" handler that silently dropped `provider_api_key`, `from_name`, etc. on first save. The frontend would call POST when no row existed, get a 201 back, and think the credentials had been saved when they hadn't. Symptom: switching to Postmark, saving, then trying to send a test → "Request does not contain a valid Server token" because the token never made it to the DB. Fixed by routing POST through the same upsert helper as PATCH (insert-or-noop, then dynamic UPDATE of supplied fields). Always test first-save flow when adding a settings page, not just edits.
- **`provider_domain` field is overloaded across email providers** — the column stores different things depending on `email_provider`: Mailgun uses it for the sending domain (`mg.macaroonie.com`); Postmark uses it for the message stream name (`outbound`); SES re-uses `provider_region` for the AWS region. The UI gates input fields by provider so users never see the overloading. If you add a new provider that needs ANOTHER field type, prefer adding `provider_extra` JSONB or another typed column rather than further overloading. Don't rename `provider_domain` — too many migrations + worker + test-send paths reference it.
- **Auth0 Mgmt API requires a Login Action that reads `app_metadata.role`** — role sync (`PATCH /team/:userId` calling `updateUserAppMetadata`) writes the role to `app_metadata.role` on the Auth0 user. The Auth0 Login Action then injects it as a JWT claim (`https://{AUTH0_DOMAIN}/claims/role`). Without that Action in place, the JWT keeps the old role until the user re-invites or you manually set it in the Auth0 dashboard. Verify the Action exists in Auth0 → Actions → Library before relying on role sync.
- **Auth0 invitation roll-back on failure** — `POST /team/invite` inserts the local row first, then calls Auth0. If Auth0 returns non-2xx the local row is DELETEd before responding 502. Re-invites work cleanly because no orphan row remains. Do not change the order — calling Auth0 first leaves no audit trail when the local insert fails on a unique conflict.
- **First-login user reconciliation** — `requireAuth` in `auth.js` reconciles Auth0 sub ↔ local user every request. Three cases: (1) already linked → bump `last_login_at`, use local `users.role` as authoritative; (2) `auth0_user_id` is NULL but email matches an invited row → link sub, bump login; (3) `is_active=false` locally → reject with 403 even if Auth0 still trusts the user. The local DB is the source of truth for `req.user.role`, not the JWT — so role changes take effect without waiting for the next Auth0 token refresh.
- **`AUTH0_INVITE_CLIENT_ID` is the SPA client_id, not the M2M one** — the value is the same as the admin portal's `VITE_AUTH0_CLIENT_ID`. It's where users land after accepting their invitation. Confusing because the password reset endpoint also uses it, but the variable name is shared deliberately so there's only one SPA-client value to configure.
- **No conditional `useQuery` between an early return and another hook** — React error #310 (`Rendered more hooks than during the previous render`) fires when a component returns early before some hooks, then on a later render reaches those hooks. Pattern that broke `/platform`: `const me = useQuery(...)` → `if (!me?.is_platform_admin) return <Denied/>` → `const tenants = useQuery(...)`. First render `me` is undefined, only 1 hook runs; once `me` loads with `is_platform_admin: true`, 2 hooks run → React aborts. Fix: declare ALL hooks unconditionally at the top, gate the secondary query with `enabled: condition`, and move the early `return` AFTER every hook call.
- **Auth0 invitation links require `invitation` + `organization` to be forwarded to `/authorize`** — when an invited user clicks the email link they land on `https://<app>/?invitation=X&organization=org_Y`. `RequireAuth` in `main.jsx` MUST detect those query params and pass them as `authorizationParams` on `loginWithRedirect`. Without this, Auth0 runs a normal login → user authenticates with their existing Google/email account → Auth0 rejects with "user X is not part of org_Y" because the invitation acceptance step never ran. The check must run BEFORE the `isAuthenticated` gate too — an already-logged-in user clicking an invitation for a different org still needs the acceptance flow.
- **Auth0 invitation requires `Application Login URI` set on the SPA app** — Auth0 returns 400 `A default login route is required to generate the invitation url` from `POST /api/v2/organizations/{orgId}/invitations` when the SPA application has no Application Login URI. Set it under Auth0 → Applications → Macaroonie Admin → Settings → Application URIs → Application Login URI to the SPA root (e.g. `https://macaroonie.com`). Without this, every invite call returns 400 and the local row is rolled back.
- **Custom error status to dodge Nginx error pages** — Nginx by default replaces upstream JSON 502/504 bodies with its own HTML "Bad Gateway" / "Gateway Timeout" pages, so the admin UI sees no `body.error` and shows the literal HTTP status text. For "I caught the upstream failure cleanly" cases (e.g. Auth0 invitation rejected), throw `httpError(422, ...)` instead of 502 — Nginx leaves 4xx bodies alone, so the actual error message reaches the operator.
- **Auth0 invitation setup is 8 steps and Auth0's own docs are stale** — the actual current dashboard requires: (1) M2M app authorised against Management API with the 6 scopes; (2) `AUTH0_INVITE_CLIENT_ID` = SPA client_id; (3) Application Login URI set on the SPA app (Settings → Application URIs); (4) Allowed Callback/Logout/Web Origins all include the SPA root; (5) Connections enabled at the **Application** level (Application → Connections tab); (6) Connections added at the **Organization** level (Organization → Connections tab); (7) **per-connection Auto-Membership = Enable** inside Org → Connection → Authentication section (THIS IS THE STEP THAT'S LEAST OBVIOUS — without it Google login loops back to the picker with no error); (8) Login Action that propagates `app_metadata.role` to a JWT claim. Help.jsx + Docs.jsx have the operator-facing version. If invitations fail, the order to debug is: pm2 logs (real Auth0 error) → Auth0 → Monitoring → Logs (per-attempt cause) → walk this checklist.
- **`provisionTenantOrg` skips steps 6 + 7 of the manual checklist** — when auto-provision is on, the API creates the org and enables Username-Password + Google connections with `assign_membership_on_login: true` in one call. Steps 1–5 + 8 (M2M scopes, env vars, SPA URIs, app-level connection toggles, role-claim Login Action) are still one-time tenant-wide setup that the platform admin does before the first auto-provisioned tenant. Auto-provision is enabled by default in the Platform → New Tenant card; uncheck if you want to manually paste an existing `org_…`.
- **Auth middleware reconcile uses a 3s Promise.race timeout** — the user-row lookup in `requireAuth` races against `setTimeout(reject, 3000)`. If the DB hangs, the timeout rejects, the catch logs a warning, and the request continues with the JWT role — never produces ERR_EMPTY_RESPONSE for the upstream client. The `last_login_at` UPDATE is fire-and-forget (`.catch(...)` only), so the request never blocks on a write that nobody reads in this request.
- **Fastify preHandlers in arrays must be async or use `done` callback** — a sync hook without a `done` parameter (e.g. `function requirePlatformAdmin(req, reply) { ... }`) chained inside a `preHandler: [requireAuth, requirePlatformAdmin]` array silently breaks the chain — the route handler never runs and the request hangs forever with no error. Always declare guards as `async function` (Fastify awaits the returned Promise). Symptom that took hours to find: logs show every preHandler running, the last one's "pass" log fires, then nothing — no route handler log, no `request completed`. Diagnostic was adding a log line at the very top of the route handler and seeing it never fire.
- **Module registry is single source of truth** — `api/src/config/modules.js` lists every module the platform knows about. To add a new one: (1) add it to `MODULES` with a `group` (or `core: true` for always-on) and per-built-in `default` permission map, (2) if it's part of an existing group, append its key to `MODULE_GROUPS[i].moduleKeys`; if it's its own product, add a new entry to `MODULE_GROUPS`, (3) write a migration to `INSERT INTO tenant_modules (tenant_id, module_key, is_enabled) SELECT t.id, '<new_key>', true FROM tenants t ON CONFLICT DO NOTHING`, (4) wire `requirePermission('<new_key>', 'manage')` on the relevant routes, (5) add a `module: '<new_key>'` field to the relevant `NAV` entries in `AppShell.jsx`. Don't hardcode module keys outside this file.
- **Site model is one-per-TENANT** — `tenant_site` (singleton per tenant, renamed from `tenant_brand_defaults` in migration 043) owns subdomain, custom domain, brand identity, home_blocks, SEO, banner, locations-index settings. `website_config` (one per venue) owns location-page content only: hero, gallery, hours, address, contact, menus, allergens, plus a `page_blocks` jsonb for the per-venue page layout. Don't put subdomain/SEO/home_blocks on `website_config` — they're tenant-level now. Conversely don't put address/hours on `tenant_site` — those are per-location. The renderer merges them at request time via `mergeLocationConfig()` in `siteDataSvc.js`.
- **Routes**: `/` → tenant home (renders `tenant_site.home_blocks`, falls back to `fallback_home.eta`). `/locations` → list of all venues (404 if `hide_locations_index`). `/locations/:venueSlug` → location page (`website_config.page_blocks`, falls back to `fallback_location.eta`). `/locations/:venueSlug/menu[/{id}]` → location menu(s). `/menu` → tenant menu hub (lists venues with menus). `/p/:slug` → tenant-level custom page. `/locations/:venueSlug/p/:slug` → venue-level custom page. `/widget/:venueId` → venue-direct widget (deep link). `/widget/tenant/:tenantId[?venue=ID]` → tenant widget with location picker.
- **`website_pages` venue_id is nullable** — `venue_id IS NULL` means a tenant-level page (visible in tenant-home nav); non-NULL means a location-specific page (visible only in that location's nav). Slug uniqueness is enforced by two partial unique indexes (one for tenant-level, one per venue). The admin `/website/pages?venue_id=tenant` flag selects tenant-level; a UUID selects venue-level.
- **`brand-defaults` admin endpoints alias `tenant-site`** — kept temporarily so the `BrandIdentitySection`/`BrandThemeSection`/`BrandAnalyticsSection`/`BrandBannerSection` admin components keep working without rewrite. Future cleanup: rename the JSX components and switch to `/tenant-site` directly. Both routes write to the same row.
- **`/website/config` POST + PATCH no longer accept subdomain/custom_domain/is_published/meta_title/meta_description** — they were dropped from `website_config` in migration 043. The Zod `VenueConfigBody` rejects these keys; submitting them returns a 400. Move them onto the `/website/tenant-site` PATCH instead.
- **`PageBuilder` accepts `blocksField`/`saveEndpoint`/`invalidateKey` props** — defaults to tenant home (`home_blocks`, `/website/tenant-site`, `['tenant-site']`) but the `<VenueActiveSection>` dispatcher passes `page_blocks`, `/website/config?venue_id=X`, `['website-config', venueId]` for location pages. Don't hardcode `home_blocks` in any new builder code — always read the field from props.
- **`booking_widget` block has 4 fallback levels** — block-data `venue_id` → location's `it.venue.id` → `tenant_site.default_widget_venue_id` → `/widget/tenant/:tenantId` (location picker). On a tenant home page with multiple venues and no default venue set, it renders the picker. Setting `default_widget_venue_id` on the tenant skips the picker for the home embed.
- **Module groups are the unit of tenant-level toggling, NOT modules** — bookings/venues/tables/schedule/rules/customers/widget_test all belong to the `bookings` group and toggle together (they're operationally one product). The `/access` UI shows one switch per group; `PATCH /access/module-groups/:key` upserts every member module's `tenant_modules` row in one transaction. Don't add per-individual-module toggles to the Modules tab — that's a deliberate design choice. The per-module endpoint (`PATCH /access/modules/:key`) is kept for internal use only.
- **Lightsail wildcard cert setup runbook** — Lightsail DNS has no Certbot plugin, so wildcard issuance uses `certbot --manual --preferred-challenges dns-01` with AWS CLI hook scripts. The full sequence is documented in the chat history (this session, May 2026). Key pieces: (1) IAM user with policy `lightsail:GetDomain`, `lightsail:CreateDomainEntry`, `lightsail:DeleteDomainEntry` on the domain, (2) AWS CLI v2 + credentials on the server, (3) `/etc/letsencrypt/lightsail-auth.sh` and `/etc/letsencrypt/lightsail-cleanup.sh` hook scripts, (4) `certbot certonly --manual --manual-auth-hook ... --manual-cleanup-hook ...`, (5) renewal cron at `/etc/cron.d/certbot` running every Monday + Nginx reload hook. **Don't switch to Route53 or Cloudflare** — the user's preference is Lightsail-everything; the hook-script path keeps that. **Don't switch to Caddy on-demand TLS** for the wildcard either — saved for a future round if custom-domain provisioning becomes high-traffic. Re-running `certbot renew` is idempotent; the hook scripts handle the dance with Lightsail DNS each time.
- **Built-in roles are never deleted, but their permissions can be edited** — `tenant_roles.is_builtin = true` for the four seeded roles. The DELETE endpoint refuses to delete them (422). The PATCH endpoint allows full permission edits (so a tenant can take, say, `email_templates: manage` away from their admin role). The role's `key` is immutable in code (used to map legacy `users.role` enum) — the editor doesn't show a key field for built-ins.
- **Permission gate ordering: tenant module switch wins, then role permission** — `requirePermission()` first checks `tenant_modules.is_enabled` for the tenant; if disabled, even an owner is rejected with 403. Only if the module IS enabled does it check the user's role permission level. Same logic in `/api/me` when computing the `permissions` map. So an owner CAN turn off their own access by disabling a module — that's intentional, gives a single switch to neutralise a feature platform-wide for the tenant.
- **Custom roles bypass the legacy `users.role` enum** — when `users.custom_role_id` is set, the auth path resolves permissions from `tenant_roles.permissions`. When it's NULL (default), it maps `users.role` enum → `tenant_roles.key` (matching one of the 4 built-ins) and uses those. The legacy enum stays for backwards compat — don't remove the column.
- **`/api/me` is the SPA's nav-gating contract** — frontend reads `me.permissions[module]` to decide whether to render a nav entry, route guard, or button. After ANY mutation that affects modules or roles (PATCH module toggle, role permission edit), invalidate `['me']` so the UI refreshes. The TanStack Query stale time is 60s by default — without manual invalidation, changes only show up after a minute.
- **Nginx `client_max_body_size` defaults to 1 MB and silently breaks PNG uploads** — the API allows 30 MB via `@fastify/multipart`, but Nginx in front of it caps the request body at 1 MB by default. JPEGs are usually < 1 MB so they slip through; PNGs are typically 2–10 MB and get rejected with 413 before they reach Fastify. Symptom from the operator's perspective: "I can't upload PNG files" (sometimes works for tiny PNGs, never for normal photos). Fix: every server block that proxies to the API must include `client_max_body_size 30M;` (or higher if the API ceiling is raised). `setup.sh` now sets it on the apex block; the wildcard `*.macaroonie.com` server block must have it too. Same trap applies to PDF menu uploads (25 MB API limit) and receipt uploads in cash-recon.
- **Google Fonts v2 returns HTTP 400 for the WHOLE stylesheet if any one requested weight is missing for any one font** — `head.eta` and `FontPicker.jsx` both maintain a `FONT_WEIGHTS` map of which weights each Google Font ships with, and the URL builders request only those weights per-font. Earlier code requested `wght@300;400;500;600;700;800` for every font, which broke whenever a picky font (Caveat, DM Serif Display, Libre Baskerville, etc.) ended up in the list — the entire CSS file failed and ALL fonts (not just the picky one) silently fell back to system defaults. When adding a new font to the picker: add it to BOTH `FONT_WEIGHTS` maps with its actual supported weight set (look up on fonts.google.com under "Styles"). Don't request a weight a font doesn't have.
- **Page builder block partials should use a unique scoped class for any layout that needs media queries** — inline styles can't carry `@media` rules, so a fixed `display:grid; grid-template-columns:repeat(3,1fr)` inline style means the block stays 3-col forever and ends up wider than the viewport on phones, producing a horizontal scroll strip on the right. Pattern used by `menu_inline.eta`, `dish_list.eta`, `reviews_band.eta`, `story_with_stamp.eta`: derive a `_blockId` from `it.block.id`, emit a `<style>` tag with the desktop layout AND `@media` collapse rules keyed on that class, then put the class on the wrapper. Always pair this with `overflow-x: hidden; max-width: 100vw` on `html, body` (in `head.eta`) as the defensive top-level guard so any future block that overflows doesn't leak the strip.
- **Header block has separate desktop + mobile visibility flags** — `mobile_show_logo`, `mobile_show_brand`, `mobile_show_subtitle`, `mobile_show_links`, `mobile_show_cta`, `mobile_breakpoint`. Defaults: logo + brand + CTA on, subtitle + links off, breakpoint 768px. Each emits a `display:none` rule inside `@media (max-width: ${mobile_breakpoint}px)`. Don't conflate `show_logo` (desktop master) with `mobile_show_logo` — both must pass for the logo to render on mobile.
- **Eta JS blocks must NOT contain regex literals with quote chars OR template literals with `${...}`** — Eta's parser tracks quote state naively to find the closing `%>`. A regex like `/^["']|["']$/g` opens a `"` and a `'` that the tracker counts as live string state, never closes them, never finds the matching `%>`, and consumes the rest of the file as JS. Symptom: a 500 with "unclosed string at line N col M" pointing at a JS line FAR below the broken block — usually inside a `<script>` tag that has nothing to do with the cause. Same trap with template literals like `` `family=${x}&display=swap` `` — Eta misreads the `${` as Eta interpolation territory in some configs, or simply gets confused by the quote-balance asymmetry. Fix: use plain `String(x).replace(/^#/, '')` for non-quote regexes, define helper functions outside the block if you need quote-bearing regexes, and use string concatenation (`'a=' + x + '&b=' + y`) instead of template literals inside `<% %>` blocks. Bit us in `widget.eta` (May 2026) — the new top-of-file `<%` block had `replace(/^["']|["']$/g, '')` which broke widget rendering with an error that pointed 170 lines below into the public JS. Reserve template literals for code OUTSIDE Eta blocks (i.e. inside script tags meant for the browser).
- **Eta's `autoEscape: true` HTML-escapes `"` to `&quot;` in `<%= %>` output — silently breaks CSS font-family strings** — if you build a font-family value in JS that contains the quotes (e.g. `const x = '"Poppins", system-ui, sans-serif'`) and emit it via `<%= x %>`, the rendered CSS becomes `font-family: &quot;Poppins&quot;, system-ui, ...` which is invalid. The browser silently falls through to the next font in the stack (usually `system-ui` which looks plausibly correct on most OSes), so every font picker on the Reservations widget LOOKED like it did nothing for weeks. **Fix: use `<%~ %>` (raw, no escape) when the JS value already contains literal CSS-safe quotes.** Affected files were `reservations_widget.eta` at `--r-font-cal`, `--r-font-slot`, and the body `font-family`. The safer alternative pattern (matches what `head.eta` already does) is to keep quotes LITERAL in the template — `font-family: "<%= bareFontName %>", system-ui, ...;` — so escaping only touches the bare font name. Any time you're tempted to build a quoted CSS value in JS and `<%=` it, stop and use `<%~` instead.
- **Eta auto-declares `include`, `includeAsync`, `__eta` AND `layout` at the top of every compiled template** — any `const/let/var layout = ...` (or the same with the other names) inside a block's `<% %>` produces `SyntaxError: Identifier 'layout' has already been declared` and the whole page 500s. Bit us in `gallery.eta` (May 2026) where `const layout = d.layout || 'grid'` collided with Eta's own `function layout(path, data)`. Fix: rename your variable (`layoutMode` is fine), but more generally avoid `layout` / `include` / `includeAsync` / `__eta` as identifiers inside Eta partials. The compiled output is visible in the 500 response body — look for `function layout(path, data)` near the top and your conflicting `const` below.
- **`setAttribute('disabled', false)` STILL DISABLES the button** — browsers treat the presence of the `disabled` attribute as disabled regardless of the value (`'false'` as a string is truthy from HTML's POV). Bit us hard in the reservations widget's `el()` helper (May 2026): an `else if (v != null) setAttribute(k, v)` catch-all ran for `disabled: false`, silently disabling every calendar cell and slot button for hours. The fix: handle `disabled` (and other boolean HTML attributes like `checked`, `readonly`, `required`) explicitly — set the attribute ONLY when the value is truthy. Same idea: in any DOM-builder helper, the catch-all branch must skip falsy values (`v != null && v !== false`) or the boolean-presence trap will catch you again.

---

## Deployment — CI/CD via GitHub Actions

**Deployment is fully automated on push.** A GitHub Actions workflow (`.yml`) handles build and
deploy automatically when changes are pushed from the developer's laptop. **Never suggest running
`deploy.sh` manually** — it is not needed and should not be referenced at the end of responses.

- **To deploy:** `git push` from the local laptop. The Actions workflow does the rest.
- **Migrations run automatically** via `api/scripts/migrate.js`, invoked from both the GitHub
  Actions workflow and `deploy.sh`. The runner tracks applied migrations in a
  `schema_migrations` table and only applies new files in order. Each migration runs in a
  transaction — if it fails, the deploy aborts before the API restarts.
- **First-time baseline** — on a server that already had migrations applied manually via
  `psql`, SSH in once and run:
  ```bash
  cd /home/ubuntu/app/api && set -a; source .env; set +a
  node scripts/migrate.js --baseline-up-to 024
  ```
  This records 001–024 as applied without running them. Subsequent deploys then apply
  025, 026, and anything new.
- **OS user is `ubuntu`** — app lives at `/home/ubuntu/app`.
- **deploy.sh** exists on the server as a fallback but is not part of the normal workflow.

---

## Running locally

```bash
# Prerequisites: Postgres 16, Redis 7, Node 22

# API
cd api
cp .env.example .env   # fill in values
psql $DATABASE_URL -f ../migrations/001_tenants_users.sql
# ... run 002-010 in order
psql $DATABASE_URL -f ../migrations/011_doors_close_time.sql
psql $DATABASE_URL -f ../migrations/012_reconfirmed_status.sql
psql $DATABASE_URL -f ../migrations/013_doors_close_per_sitting.sql
psql $DATABASE_URL -f ../migrations/014_schedule_exceptions.sql
psql $DATABASE_URL -f ../migrations/015_fix_get_available_slots.sql
psql $DATABASE_URL -f ../migrations/016_noslot_noshow_cancelled.sql
psql $DATABASE_URL -f ../migrations/017_seated_checked_out.sql
psql $DATABASE_URL -f ../migrations/018_customers.sql
psql $DATABASE_URL -f ../migrations/019_customer_visit_count.sql
psql $DATABASE_URL -f ../migrations/020_slot_start_filter.sql
psql $DATABASE_URL -f ../migrations/021_enable_arrived_status.sql
psql $DATABASE_URL -f ../migrations/022_slot_inclusive_last_order.sql
psql $DATABASE_URL -f ../migrations/023_sitting_names.sql
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

---

## Doc maintenance

- **Update CLAUDE.md as part of EOS, every session.** If you skip a session, the doc rots.
- **"Common mistakes to avoid" is append-only.** Never delete an entry — only correct one if it turns out to be wrong. This section beats every other section in long-term value.
- **Keep the TOC synced.** When adding or renaming a section, update the Table of Contents.
- **Don't let the doc grow past ~3,000 lines.** Once a module section exceeds ~200 lines, move it to `docs/<MODULE>.md` and link from CLAUDE.md.
- **Don't duplicate what's already in code** (table schemas exposed via API, route lists). Reference instead.
- **Don't include credentials, tokens, or secret values** — only their names and where they live.
- **Don't include time-sensitive status** ("in progress this sprint") — that's what Outstanding items is for.
- **Don't write planning / decision documents inline.** Decisions go in commit messages or PR descriptions.
- **Cross-link with docs/.** CLAUDE.md is the index; deep-dives live elsewhere.
- **Companion files worth setting up:**

| File | Purpose |
|------|---------|
| `MEMORY.md` (in `~/.claude/projects/<repo>/memory/`) | Persistent AI memory — short notes that survive across sessions |
| `docs/<MODULE>.md` | Deep dives that don't belong in CLAUDE.md |
| `CHANGE.md` | Living changelog — prepend on every deploy |

