# Macaroonie — Change Log

All notable changes to this project, most recent first.
Migrations are listed where a database change is required.

---

## [2026-05-03]

### Media library *(migration 040)*
- Per-tenant image library with categories, scope filters, picker + manager
  modes. Spec: see "Epic: Media Library" in project notes.
- New tables: `media_categories` (flat tenant tags) and `media_items`
  (uploaded images with category, scope, hash, dimensions). Both RLS-enforced.
- API at `/api/media`: CRUD for categories and items, multipart upload,
  duplicate pre-check (filename + SHA-256 hash within scope), bulk actions
  (delete / move-category / move-scope), distinct scopes endpoint.
- `sharp` added as **optionalDependency** for image dimension extraction —
  lazy-loaded so a broken native build doesn't crash the API.
- New reusable component `admin/src/components/media/MediaLibrary.jsx`.
  Two modes: `picker` (callback returns URL, "Insert selected" footer)
  and `manager` (organise without inserting).
- Features delivered in v1: grid + list views, search, category sidebar
  (create/rename/delete), scope filter dropdown, upload via button + drag-drop,
  duplicate detection with replace/keep-both/cancel dialog, progress chips,
  single + multi select, single detail panel with preview/rename/change
  category/change scope/delete, bulk move + delete, resizable detail panel,
  ESC + X close, fullscreen toggle.
- **Image editor** (crop / rotate / flip) shipped via `react-easy-crop` +
  canvas-based rotate/flip on export. Aspect-ratio presets: Free, 1:1, 4:3,
  3:2, 16:9, 9:16. Save modes: **Save as new** creates a fresh media item;
  **Replace original** swaps the file behind the existing item via new
  `POST /api/media/items/:id/replace` (id preserved so any references stay
  valid; old file deleted best-effort).
- Deferred to follow-up: brightness/contrast filters, advanced selection
  (shift-range), keyboard navigation between items.
- New `/media` route (standalone manager) + sidebar nav entry under the
  `website` module group.
- `ImageField` in Website.jsx now offers a "Choose from library" button on
  every image upload spot (logo, favicon, hero, about, OG, brand defaults,
  etc.) — falls through to the existing inline upload as the alternative.

---

## [2026-05-02]

### Wildcard SSL cert via Lightsail DNS hooks
- Wildcard `*.macaroonie.com` cert issued via Let's Encrypt DNS-01 with custom
  AWS CLI hook scripts that talk directly to the Lightsail DNS API (no Cloudflare
  / Route53 dependency).
- IAM user with `lightsail:GetDomain/CreateDomainEntry/DeleteDomainEntry` permissions
  + access keys configured in `/root/.aws/`.
- Hook scripts at `/etc/letsencrypt/lightsail-{auth,cleanup}.sh` add/remove the
  `_acme-challenge` TXT record automatically. Renewal via `certbot.timer` is fully
  automated; deploy hook reloads Nginx after each successful renewal.
- Nginx wildcard server block at `/etc/nginx/sites-available/macaroonie-wildcard.conf`
  proxies all subdomains to Fastify on :3000.
- Wildcard `* A <Lightsail-IP>` DNS record added — specific records take precedence
  so existing subdomains (`cogs`, etc.) keep pointing where they were.

### Email infrastructure: Postmark + Mailgun region + monitoring + send-test
- **Postmark** added as 5th email provider (`emailSvc.sendViaPostmark`). Uses
  Server Token via `X-Postmark-Server-Token` header. Branded click tracking is
  shared (`click.pstmrk.it`) — Postmark doesn't support per-customer custom
  tracking domains, by design.
- **Mailgun region picker (US/EU)** — EU accounts silently 401 against the US
  endpoint. Region is now stored on `venue_email_settings.provider_region`.
- **Email monitoring page** at `/email-monitoring` — combines SendGrid Stats +
  Suppression APIs with local `email_log` for a "what went out / what's in"
  view. New service `src/services/sendgridSvc.js`. New routes at
  `/api/email-monitoring/*`.
- **Stand-alone test email sender** in Widget Test page — `POST /api/email-templates/send-test`.
- **Migration 039**: extends `venue_email_settings.email_provider` CHECK
  constraint to include `'postmark'`.
- **POST upsert fix**: `/api/email-templates/settings/:venueId` POST used to
  drop every body field except `email_provider` on first save. Now both POST
  and PATCH route through the same upsert helper that persists every supplied field.

### Configurable RBAC — tenant module switches + custom roles  *(migration 038)*
- **Modules.** New `tenant_modules` table — per-tenant on/off switch per module.
  Disabled modules are hidden from the sidebar nav AND rejected at the API via the new
  `requirePermission()` guard. Owner-only toggles.
- **Module groups.** Tightly-coupled modules toggle together under one master switch:
  `bookings` group bundles bookings/venues/tables/schedule/rules/customers/widget_test;
  `email_templates`, `website`, `cash_recon` are their own groups; core modules (dashboard,
  team, settings, documentation) are always-on. The Modules tab in `/access` shows ONE
  switch per group — `PATCH /access/module-groups/:key` upserts every member in a
  transaction. The per-module endpoint stays as an internal-use API.
- **Roles.** New `tenant_roles` table with a `permissions` JSONB mapping
  `module_key → 'manage' | 'view' | 'none'`. Four built-in roles seeded per tenant
  (owner/admin/operator/viewer) — built-in permissions can be edited but their key
  and the row itself are protected. Custom roles fully editable; can't be deleted
  while users reference them.
- **`users.custom_role_id`** (nullable FK to `tenant_roles`) takes precedence over
  the legacy `users.role` enum when set. The migration backfills it for existing
  users so behavior is unchanged on day one.
- **New module registry** at `api/src/config/modules.js` — single source of truth
  for the 14 modules, descriptions, and per-built-in defaults. To add a new module
  in future, just add it here and the migration/API/UI all pick it up.
- **New API**: `GET /api/access/modules`, `PATCH /api/access/modules/:key`,
  `GET /api/access/roles`, `POST/PATCH/DELETE /api/access/roles[/:id]`.
- **New middleware**: `requirePermission('module', 'view'|'manage')` checks both
  tenant module enablement AND the user's role permission level. Platform admins
  always pass.
- **`/api/me` extended** with `enabled_modules: string[]`, `permissions: { [module]: level }`,
  and `effective_role` so the frontend can gate nav and per-page UI without extra calls.
- **AppShell**: nav entries are now filtered by `me.permissions[module]`. Modules
  whose level is `none` (because module is disabled at tenant level OR role doesn't
  grant access) are hidden completely.
- **New admin page `/access`** — two tabs (Modules + Roles). Permission matrix has
  three-state toggle pills per module. Owner-only mutations.

---

## [2026-05-01 — even later]

### Auto-provision Auth0 organisations on tenant creation
- **Platform → New Tenant** now creates the Auth0 organisation automatically. New
  helpers in `auth0MgmtSvc.js`: `createOrganization`, `getConnectionByName`,
  `enableOrgConnection`, `provisionTenantOrg` (a wrapper that creates the org and
  attaches Username-Password + Google connections with `assign_membership_on_login: true`).
- **`POST /api/platform/tenants`** accepts `auto_provision` (default true). When set
  AND no `auth0_org_id` is supplied AND M2M creds are configured, the API creates the
  org first, then inserts the tenant DB row with the resulting `org_…` id. The response
  includes an `auth0_provisioning` summary so the UI can surface partial failures.
- **Required new M2M scopes**: `create:organizations`, `read:connections`,
  `create:organization_connections`. Existing tenants don't need re-authorisation
  because the M2M app config carries over — but to use auto-provision you must add
  these scopes in the Auth0 dashboard (Applications → APIs → Auth0 Management API →
  Machine to Machine Applications → your M2M app → Edit Permissions).
- **Auth middleware hardening**: user-row reconciliation now races against a 3-second
  timeout, so a stuck DB query can never produce ERR_EMPTY_RESPONSE upstream. The
  `last_login_at` bump is fire-and-forget. Added a fallback in `GET /api/platform/tenants`
  that returns the tenant list without joins if the COUNT join query throws.

---

## [2026-05-01 — later]

### Auth0 Management API for full in-app team lifecycle  *(migration 037 seeds initial platform admin)*
- **No more Auth0 dashboard for tenant operators.** Inviting, role changes, deactivation, and
  password resets all flow through the Team page; only platform admins ever touch Auth0.
- **New service `api/src/services/auth0MgmtSvc.js`**: M2M client-credentials token fetch with
  in-memory cache (5min refresh buffer), `inviteUserToOrg`, `removeUserFromOrg`,
  `updateUserAppMetadata`, `sendPasswordResetEmail`. `isConfigured()` / `canInvite()` feature
  checks let callers degrade gracefully when env vars are missing.
- **`POST /api/team/invite`**: now sends an Auth0 organization invitation email. If Auth0
  returns non-2xx the local users row is rolled back before responding 502. Falls back to
  local-only insert with a warning when `AUTH0_MGMT_*` env vars are unset (dev mode).
- **`PATCH /api/team/:userId`**: when the role changes and the user has an Auth0 link,
  calls `updateUserAppMetadata({ role })` so the next JWT carries the new role. Best-effort
  — Auth0 failure logs but doesn't roll back; the local DB is source of truth.
- **`DELETE /api/team/:userId`**: soft-deactivates locally AND removes the user from the
  Auth0 org (so they can no longer obtain a JWT for this tenant). The Auth0 user account
  itself is preserved.
- **`POST /api/team/:userId/reset-password`**: owner-only. Triggers the Auth0
  `/dbconnections/change_password` endpoint so the user gets a one-time reset link by email.
- **`GET /api/team/auth0-status`**: feature flags consumed by the Team page so the UI
  shows an amber banner when Auth0 is unconfigured, and hides the password-reset button
  when `AUTH0_INVITE_CLIENT_ID` is missing.
- **Auth middleware reconciliation**: `requireAuth` now links `auth0_user_id` ↔ local user
  on every request. Three cases — already linked / first login after invite (link by email)
  / `is_active=false` (rejected with 403). The local DB is now the source of truth for
  `req.user.role` (not the JWT) so role changes take effect without an Auth0 token refresh.
- **Migration 037**: idempotent seed of the initial platform admin (Michal Wegrzyn) so
  `/platform` is reachable on first deploy without manual DB access.
- **New env vars** (all optional): `AUTH0_MGMT_CLIENT_ID`, `AUTH0_MGMT_CLIENT_SECRET`,
  `AUTH0_INVITE_CLIENT_ID`. See `api/.env.example` for the M2M scopes required.
- **Team page UI**: "Invite pending" badge for unlinked rows, password-reset key icon
  (with loading + success states), warning banner when Auth0 mgmt is not configured.

---

## [2026-05-01 session]

### Platform admin + tenant/user management  *(migration 036)*
- **Platform admins** (`platform_admins` table, no RLS): users who manage all tenants.
  Auth middleware detects by `auth0_user_id`, bypasses all role gates.
- **`GET /api/me`**: current user profile + list of available tenants with `auth0_org_id`.
  Powers the org switcher and platform admin detection on the frontend.
- **Platform admin routes**: `GET/POST/PATCH /api/platform/tenants` + `/stats` endpoint.
  Create tenants, edit name/slug/plan/active status, view venue/user/booking counts.
- **Team management routes**: `GET/POST/PATCH/DELETE /api/team`. Invite users, change roles,
  deactivate. Owner-only mutations. Self-protection (can't demote/deactivate yourself).
- **Org switcher**: dropdown in AppShell sidebar when user has multiple tenants. Triggers
  `loginWithRedirect()` with the target Auth0 org_id for a full re-authentication.
- **`VITE_AUTH0_ORG_ID` now optional**: omitting lets Auth0 prompt for org selection.
- **Team page** (`/team`): invite card, role dropdown per member, deactivate/reactivate,
  RBAC reference table. Owner-only mutations.
- **Platform page** (`/platform`): stats overview (4 cards), tenant list with venue/user
  counts, create/edit tenant cards. Platform admin only.

### Visual email editor (TipTap)
- Replaced raw HTML textarea with TipTap WYSIWYG editor.
- Toolbar: bold, italic, underline, headings, lists, alignment, link, image, divider,
  text colour picker, CTA button insertion.
- Visual / HTML mode toggle — content syncs both ways.
- `<a class="btn">` preserved via extended Link extension with `class` attribute round-trip.
- URL sanitisation: `isSafeUrl()` rejects `javascript:`/`data:`/`vbscript:` URIs.
- `escapeAttr()` prevents attribute breakout in button insertion.

---

## [2026-04-30 session]

### Booking email system  *(migration 035)*
- **Pluggable email service** (`emailSvc.js`): 4 providers (SendGrid, Mailgun, AWS SES, SMTP)
  selectable per venue. SendGrid is the default, falls back to `SENDGRID_API_KEY` env var.
  Per-venue credentials supported for all providers.
- **Default HTML templates**: confirmation, reminder, modification, cancellation. Clean,
  mobile-responsive, professional. 16 merge fields (`{{guest_name}}`, `{{booking_date}}`,
  `{{manage_link}}`, etc). Work out of the box with no admin setup.
- **Guest manage page** at `/manage/{token}` (SSR via Eta): view booking details, modify
  (date/time/covers), cancel (double-confirm). Themed per-venue. No login — UUID token
  IS the auth. `manage_token` column added to bookings (backfilled).
- **Email worker** (BullMQ): loads booking+venue+template, renders fields, sends, logs to
  `email_log` table. Reminder scheduling via delayed jobs (configurable hours-before).
- **Triggers**: confirmation on booking create, cancellation on status change, reminder
  auto-scheduled on confirm.
- **Admin page** at `/email-templates` with 3 tabs:
    * Templates: per-type editor, merge field pills, live preview iframe, reset-to-default
    * Settings: provider picker, credentials, sender identity, reminder toggle + hours,
      guest self-service permissions (allow modify/cancel, cancel cutoff hours)
    * Sent emails: audit log with status badges
- **Migration 035**: `email_templates`, `email_log`, `venue_email_settings` tables +
  `manage_token`/`reminder_sent_at` on bookings.

### Cash recon — SC included in income  *(migrations 033 + 034)*
- Renamed `included_in_sales` to `included_in_income` (migration 034, idempotent rename).
- XOR variance adjustment: the two SC flags work independently so operators can model
  4 scenarios (SC retained as revenue + in till, SC in income but not till, SC in till
  but not income, SC tracked only).
- Admin: "Included in Income" toggle + emerald badges + signed "SC adjustment" line
  in the daily summary.

### Auto-deploy migrations
- New `api/scripts/migrate.js` runner with `schema_migrations` tracking table.
- GitHub Actions workflow runs migrations between `npm install` and `pm2 restart`.
- Auto-baseline: `AUTO_BASELINE_UP_TO=024` env detects servers built by hand and
  baselines on first run. Manual baseline workflow available in Actions UI.
- `deploy.sh` updated with same hook. `deploy.yml` switched from `git pull` to
  `git fetch + reset --hard` to handle dirty server working trees.

### CLAUDE.md session protocols
- SOS Checklist, EOS Protocol, Standard Design Rules (11 rules), Doc maintenance
  section adopted from the COGS template.
- Table of Contents added. Gotchas section marked append-only.

---

## [Unreleased / Current]

### Tenant Website Builder / CMS  *(migrations 025 + 026)*

A multi-section website builder. Each tenant gets a public website
hosted at `{slug}.macaroonie.com` (and optionally a custom domain like
`book.wingstop.co.uk`). Fully configurable via a new admin page.

**Database** *(migrations 025_website_cms.sql, 026_website_custom_domain_templates.sql)*
- `website_config` — singleton per tenant; 60+ columns covering identity,
  branding, hero, about, find-us, contact, social, ordering, delivery,
  booking widget, SEO, analytics, feature toggles.
- `website_opening_hours`, `website_gallery_images`, `website_pages`,
  `website_menu_documents`, `website_allergen_info` — ordered
  collections with their own RLS policies.
- Migration 026 adds `custom_domain` (UNIQUE lower index),
  `custom_domain_verified`, `template_key` (`classic` | `modern`),
  and `theme` (JSONB) for per-tenant theming independent of template.

**API** *(new routes)*
- `POST/GET/PATCH /api/website/config` — singleton config
- `POST /api/website/verify-domain` — DNS A + CNAME verification for
  custom domains (checks resolv against PUBLIC_ROOT_DOMAIN / APP_PUBLIC_IPS)
- `GET /api/website/slug-available` — global uniqueness check
- Gallery, pages, menus, opening-hours, allergens CRUD
- `POST /api/website/upload` — multipart image / PDF upload via
  pluggable storage service
- `GET /api/site/:slug` — public JSON bundle
- `GET /api/site/:slug/sitemap.xml` + `robots.txt`

**Pluggable storage** *(api/src/services/storageSvc.js)*
- `STORAGE_DRIVER=local` → writes to `UPLOAD_DIR`, served by
  `@fastify/static` at `/uploads/*`
- `STORAGE_DRIVER=s3` → AWS S3, DO Spaces (`S3_ENDPOINT`), Cloudflare R2
  via optional `@aws-sdk/client-s3` peer dep (lazy-loaded)

**SSR renderer** *(api/src/routes/siteRenderer.js)*
- Detects `{slug}.{PUBLIC_ROOT_DOMAIN}` OR verified `custom_domain` on
  the Host header; reserved subdomains (api, www, …) bypass.
- Templates live in `api/src/views/site/templates/{classic|modern}/`
  — `index.eta`, `menu.eta`, `page.eta`, `partials/{header,footer}.eta`
- Shared `views/site/shared/head.eta` converts the `theme` JSONB into
  CSS custom properties (`--c-*`, `--f-*`, `--r-*`, etc.) and loads
  Google Fonts automatically for known families.
- Both templates consume the same CSS variables so a theme change
  applies regardless of which template the tenant picks.
- Emits Restaurant JSON-LD, OG/Twitter meta, GA4 + Meta Pixel snippets,
  sitemap.xml, robots.txt.

**Admin portal** *(admin/src/pages/Website.jsx, new route `/website`)*
- Left-rail navigation with 18 sections:
  Setup & domain · Template · Theme · Branding · Hero · About · Gallery ·
  Menus · Allergens · Opening hours · Find us · Contact · Online ordering ·
  Delivery · Booking widget · Custom pages · SEO · Analytics.
- **Theme manager**: 7 colour pickers, heading + body font dropdowns
  (Google Fonts), sliders for base size, heading scale, weights, line
  height, container width, section padding, grid gap, 3 radius sliders,
  logo height, 4 button sliders, hero overlay opacity + min-height.
- **Gallery**: drag-to-reorder grid via `@dnd-kit/sortable` (new dep),
  inline captions, bulk save.
- **Allergens**: two-mode (PDF upload | dish-by-dish table) with
  pill-selectable allergens (14 common UK/EU allergens).
- **Opening hours**: 7-day grid with multiple sessions per day
  (e.g. "Lunch" / "Dinner"), closed toggle, native time pickers.
- **Custom pages**: in-place CRUD; URL slug live-sanitised; appears
  at `/p/{slug}` on the public site.
- All image/PDF uploads go through a shared `FileUpload` / `ImageField`
  component calling `api.upload()` (new method on `useApi()`).
- First-time visit shows an onboarding card that POSTs a subdomain slug
  to create the `website_config` row.

**Deployment follow-ups** *(not yet applied to the server)*
- Nginx: wildcard server block for `*.macaroonie.com` proxying to the
  Fastify API; wildcard SSL via Certbot DNS challenge.
- DNS: wildcard A record for `*.macaroonie.com`.
- Custom domains: per-domain SSL provisioning (e.g. Caddy on-demand TLS
  or per-domain certbot); the app just resolves the Host header — it
  doesn't provision certs.
- Migrations now run automatically via `api/scripts/migrate.js`, invoked
  from both the GitHub Actions workflow and `deploy.sh`. On first deploy
  after this change, SSH in and baseline the tracker once:
  `cd /home/ubuntu/app/api && set -a; source .env; set +a; node scripts/migrate.js --baseline-up-to 024`
  Subsequent pushes will auto-apply 025, 026, and future migrations.

---

### Slot availability — last-order-time start rule  *(migration 020)*
- **Changed:** `get_available_slots()` now generates a slot as long as it **starts** at or before
  `closes_at` (last order time), even if the booking duration would run past that time.
  Previously, only slots that *completed* before `closes_at` were shown, which caused the last
  several slots of a sitting to be hidden unnecessarily.
- `slot_result` composite type extended with two new nullable fields:
  - `sitting_closes_at time` — the sitting's last order time
  - `sitting_doors_close time` — the sitting's doors close time
- `GET /slots` API now returns both new fields per slot.
- **Frontend warning in New Booking modal:** when a slot is selected and
  `slot_start + slot_duration > sitting_doors_close`, a red warning banner is shown.
  When it exceeds `sitting_closes_at` only, an amber warning is shown.
  Both are informational — the booking can still be created.
- **Migration:** `020_slot_start_filter.sql`

### Booking drawer — end-time editor
- Added **End time** button in the Date & time section of the booking drawer alongside the
  existing Reschedule button.
- Tapping "End time" reveals a native `<input type="time">` (OS picker on tablet/mobile)
  pre-filled with the booking's current end time.
- Save button appears in the drawer header as "Save end time".
- Calls the existing `PATCH /bookings/:id/duration` API endpoint.
- Midnight crossover handled: if the chosen end time is before the start time, the end date
  is bumped to the following day.

---

## [Session — UI polish + settings]

### Settings page  *(new page `/settings`)*
- New **Settings** page in the sidebar (icon: SlidersHorizontal).
- **Appearance section:** native `<input type="color">` + hex text field + 6 preset brand
  swatches. Changes apply live (instant preview).
- **Timeline defaults section:** toggles for Panel mode, Section dividers, and Hide inactive —
  persisted to `localStorage` under key `maca_timeline_prefs`.
- Default theme colour changed from blue to **`#630812`** (dark maroon/red).
- Theme applied via CSS custom properties (`--primary`, `--primary-foreground`) at runtime.
- New `SettingsContext` (`src/contexts/SettingsContext.jsx`) stores `themeHex` and applies
  it to the document root on mount. Persisted to `localStorage` under key `maca_settings`.

### Timeline toolbar → sidebar
The following controls were removed from the Timeline toolbar and moved to the **AppShell
sidebar**, above the logout button. They appear when the current route is `/timeline`.

- Venue selector (shown only when the tenant has >1 venue)
- **Inactive** toggle (formerly labelled "Cancelled & no-show hide toggle")
- Section dividers toggle
- Panel/drawer mode toggle (Columns icon)
- Refresh button
- Fullscreen button

In collapsed-sidebar (icon-only) mode the same buttons are shown as icon-only rows.

### Timeline toolbar
After the above move, the Timeline toolbar contains only date navigation:
← arrow · date input · → arrow · Today button.

### New booking — FAB
The **+ New booking** button is now a round floating action button (FAB) positioned at the
bottom-right of the timeline canvas (`absolute bottom-6 right-6 z-30`).
Previously it was in the toolbar.
On touch devices the FAB is 56×56 px (w-14 h-14).

### Booking tile shape
Removed the CSS `clip-path` polygon that gave booking tiles a pointy right-arrow shape.
Tiles are now plain rounded rectangles (`border-radius: 3px`).

### checked_out tile colour
Changed from light green (`#d1fae5 / #34d399`) to grey:
- Background: `#e5e7eb`
- Left border: `3px solid #9ca3af`

### Mobile customer search in New Booking modal
- On screens narrower than the `sm` breakpoint the customer suggestions panel
  (previously a side-panel to the right of the modal) now appears **inline below the
  phone field**.
- An **× dismiss** button closes the inline panel without clearing the search field.
- Desktop behaviour (`sm:` and above) unchanged — side panel to the right.
- Uses pure CSS responsive prefixes (`sm:hidden` / `hidden sm:flex`) — no JS resize listener.

### TimelineSettingsContext — panelMode persistence
`panelMode` state added to `TimelineSettingsContext` (previously managed locally in
`Timeline.jsx`). All three toggles (`hideInactive`, `groupBySections`, `panelMode`) are
persisted together to `localStorage` key `maca_timeline_prefs` on change.

---

## [Customers & GDPR]  *(migration 018 + 019)*

### Customer database  *(migration 018)*
- New `customers` table with RLS. Columns: `tenant_id`, `name`, `email`, `phone`, `notes`,
  `visit_count`, `last_visit_at`, `is_anonymised`, `anonymised_at`, `created_at`.
- `customer_id` FK added to `bookings`.
- `upsertCustomer()` helper in `customers.js` — called fire-and-forget after every booking
  confirm (free path, Stripe webhook, and admin-override).
- Walk-in and TBC emails are skipped in the upsert.

### Visit count  *(migration 019)*
- `visit_count` and `last_visit_at` columns added to `customers`.

### Customer API  (`/api/customers`)
- `GET /customers?q=` — search by name/email/phone; returns 20 most-recent if query < 2 chars.
- `GET /customers/:id` — detail + full booking history.
- `PATCH /customers/:id` — update name, phone, notes.
- `POST /customers/:id/anonymise` — GDPR erasure: replaces all PII with placeholders,
  anonymises linked bookings, sets `is_anonymised = true`. Never deletes the row.
- `GET /customers/:id/export` — GDPR data export as JSON download.

### Customers page  (`/customers`)
- Searchable customer list.
- Resizable detail panel (click a row to open).
- GDPR anonymise with double-confirmation.
- GDPR export download via `api.download()`.

### Customer search in New Booking modal
- Debounced search while typing in name/email/phone fields during booking creation.
- Matching customer records shown in a suggestions panel; clicking pre-fills all three fields.
- iOS autoFocus suppressed (`autoFocus={!IS_TOUCH}`) to prevent keyboard popup on modal open.

---

## [New booking statuses]  *(migration 017)*

- **`arrived`** (cyan) — guest has arrived; sits between confirmed and seated.
- **`seated`** — renamed from `completed`; guest is at the table.
- **`checked_out`** (grey) — new status after seated; guest has left.
- `checked_out` excluded from capacity calculations (same as `cancelled` / `no_show`).
- All affected status queries, timeline colours, and BookingDrawer selectors updated.

---

## [Bookings page redesign]

- **Guestplan-style time-grouped list** — bookings grouped by slot time with a header showing
  the time and cover count for that group.
- **Stats bar** — reservations / tables / guests counts for active bookings only.
- **Inline status dropdown** — change status without opening the drawer.
- **Phone number visible** in the list row.
- **Permanent resizable right panel** (280–700 px) showing BookingDrawer in `inlineMode`.

---

## [Walk In bookings]

- **Walk In** button added to guest step of New Booking modal.
- Skips all guest-detail fields; books immediately as "Walk In" with email `walkin@walkin.com`.
- No confirmation email sent for walk-ins.

---

## [Timeline — canvas click to ManualAllocModal]

- Clicking an empty cell on the Timeline canvas now opens **ManualAllocModal** directly
  (previously opened the slot-selection step of the standard modal).
- The clicked time and table are pre-populated in the manual allocation panel.
- Props `openManual` and `initialTableIds` added to `NewBookingModal`.

---

## [Timeline — current-time indicator]

- Red vertical line across all table rows showing current time.
- Dot and time label in the header bar at the top of the line.
- Today only — hidden when viewing past or future dates.
- Updates every 30 seconds.

---

## [Schedule exceptions]  *(migration 014 + 015)*

### Migration 014
- New tables: `schedule_exceptions`, `exception_day_templates`, `exception_sittings`,
  `exception_sitting_slot_caps`.
- `doors_close_time` column added to `exception_sittings`.

### Migration 015
- Fixed PG 55000 "record not assigned yet" error in `get_available_slots()`.
- `v_exc_template` RECORD replaced with scalar `v_exc_template_id uuid := NULL`.

### API
- Full CRUD for exceptions: `GET|POST /venues/:id/schedule/exceptions`, plus nested endpoints
  for day templates, sittings, and slot caps.

### Admin portal
- `ExceptionsSection`, `ExceptionCard`, `ExceptionDayCard` components in `Schedule.jsx`.

---

## [Doors close time per sitting]  *(migration 013)*

- `doors_close_time` column moved from `venue_schedule_templates` down to `venue_sittings`
  and `override_sittings` (per-sitting control instead of per-day).
- Template-level column kept for backwards compatibility but no longer used.

---

## [Booking rules — reconfirmed status]  *(migration 012)*

- `enable_reconfirmed_status` column on `booking_rules`.
- When enabled, a "Re-confirmed" status option appears in the booking drawer dropdown.
- Toggle added to Rules page.

---

## [Booking rules — unconfirmed status]  *(migration 012 — second file)*

- `enable_unconfirmed_flow` column on `booking_rules`.
- When enabled, new bookings default to `unconfirmed` status (operator must call to confirm).
- Toggle added to Rules page.

---

## [Doors close time]  *(migration 011)*

- `doors_close_time` column added to `venue_schedule_templates` (later superseded by
  per-sitting column in migration 013).
- `allow_widget_bookings_after_doors_close` added to `booking_rules`.
- Widget filters out slots at or after `doors_close_time` unless the rule is enabled.
- Admin bookings always bypass this filter.
- **Rules page:** "Opening hours enforcement" section with the allow-past-doors toggle.

---

## [Smart allocation — disallowed pairs + adjacency rules]  *(migration 010)*

- `disallowed_table_pairs` table — specific table pairs the engine must never combine.
- `allow_cross_section_combo` and `allow_non_adjacent_combo` flags on `booking_rules`.
- All three enforced in `PATCH /bookings/:id/relocate`.
- **Tables page:** "Disallowed pairs" section with add/remove UI.
- **Rules page:** smart allocation toggle section.

---

## [Unallocated row]  *(migration 009)*

- System-managed `is_unallocated` pseudo-table (one per venue, auto-created on first use).
- `sort_order = −999`, `max_covers = 9999`, excluded from widget and slot queries.
- Timeline renders it as an orange row at the very top when it contains bookings.
- Bookings dragged to a table that conflicts and cannot be re-placed are cascaded here.

---

## [Table combinations]  *(migration 008)*

- `table_combinations` and `table_combination_members` tables.
- Slot resolver returns `combination_id` per slot.
- `PATCH /bookings/:id/relocate` — cross-table drag with smart allocation and cascade displacement.
- `PATCH /venues/:id/tables/reorder` — drag-to-reorder on Tables page (always-visible grip handles).

---

## [Core features]  *(migrations 001–007)*

### Migration 001 — Tenants, users, auth0_org_id
- `tenants`, `users` tables. `auth0_org_id` column for Auth0 Organisations multitenancy.

### Migration 002 — Venues
- `venues`, `venue_sections` tables with RLS.

### Migration 003 — Schedules
- `venue_schedule_templates`, `venue_sittings`, `schedule_date_overrides`,
  `override_sittings`, `sitting_slot_caps`, `override_slot_caps`.

### Migration 004 — Booking rules
- `booking_rules`, `deposit_rules` tables.

### Migration 005 — Bookings
- `booking_holds`, `bookings` tables. `UNIQUE (table_id, starts_at)` on holds.
- `confirm_hold()` PG function with `FOR UPDATE NOWAIT`.
- Booking status enum: `unconfirmed | confirmed | pending_payment | cancelled | no_show`.

### Migration 006 — Functions
- `sweep_expired_holds()` — pg_cron job every minute.
- `get_available_slots(venue_id, date, covers)` — slot resolver PG function.
  Returns `SETOF slot_result`; handles priority chain, slot caps, holds, and zero_cap_display.
- `slot_result` composite type.

### Migration 007 — Seed data
- Example tenant, venue, tables, and schedule for development testing.

### API routes
- `/api/bookings` — holds, free-booking confirm, admin-override, list, status, move,
  relocate, duration, guest, tables, notes, delete.
- `/api/slots` — public slot availability with widget filtering.
- `/api/venues` — venue CRUD, tables, combinations, rules, deposit rules, disallowed pairs, reorder.
- `/api/venues/:id/schedule` — template days, sittings, slot caps, date overrides, copy-day, exceptions.
- `/api/payments` — Stripe PI creation, webhook handler, refund.
- `/api/customers` — search, detail, update, anonymise, export.

### Admin portal — initial pages
- **Timeline** — Gantt view, @dnd-kit drag (mouse + touch sensors), grey column overlay,
  pixel-accurate booking card positioning, combination tile spanning.
- **Bookings** — redesigned (see Bookings page redesign section above).
- **Customers** — see Customers section above.
- **Venues** — venue CRUD.
- **Tables** — table list, sections, combinations, sort order, disallowed pairs.
- **Schedule** — weekly template, sittings, slot caps, date overrides, exceptions.
- **Rules** — booking rules, smart allocation toggles, deposit config, status flow toggles.
- **Widget test** — full guest booking flow embedded in the portal.
- **Documentation** — this system documentation page (`/docs`).
- **Help** — operator user guide (`/help`).

### Auth flow
- Auth0 organisation-scoped login; `tenant_id` and `role` injected into JWT via Login Action.
- API middleware validates JWT via JWKS, resolves `auth0_org_id → tenants.id`.
- `req.tenantId` and `req.user.role` attached to every request.

### Deployment
- GitHub Actions CI/CD — push to main triggers automated build and deploy.
- Ubuntu 24.04 Lightsail; Nginx reverse proxy; PM2 process manager.
- `setup.sh` — one-shot provisioning. `deploy.sh` — subsequent deploys (used by Actions).

---

## Common mistakes & gotchas  *(reference)*

- Never query tenant tables without `withTenant()` — RLS silently returns 0 rows.
- `slot_duration_mins` ≠ `slot_interval_mins` — duration is booking length; interval is slot frequency.
- `max_covers = 0` on a slot cap ≠ fully booked — it means intentionally blocked.
- `slot_time` from PG is `HH:MM:SS` — always `.slice(0, 5)` before using as a key or sending to the API.
- `combination_id` must be copied from hold to booking on all confirm paths.
- `table_combination_members` has no `tenant_id` — never pass it to INSERT on that table.
- `notificationQueue.add()` must never be awaited in request path — always fire-and-forget.
- Customer anonymise never deletes the row — GDPR erasure by overwrite only.
- `api.download()` in the admin frontend — use for auth-protected binary responses (JSON exports).
- `admin-override starts_at` is server-local time — future work: send IANA timezone and convert.
- `get_available_slots()` v_exc_template_id must be a scalar uuid (not a RECORD field) — PG 55000.
- Migration 020 changed slot_result type — must DROP FUNCTION then DROP TYPE before recreating.
