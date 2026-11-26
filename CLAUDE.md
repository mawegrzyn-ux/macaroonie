# Macaroonie — Claude Code Context

> ⚠️ DEVELOPER ONLY — contains infra details, env var names, auth config.

**Multitenant restaurant platform for the F&B / QSR franchise sector.**

Each master-franchisee registers as a tenant (Auth0 org) and runs its venues from one admin
portal: table bookings and a website per tenant, online ordering, a till (POS) with kitchen
screens, self-order kiosks and menu screens, loyalty, cash reconciliation, staff rota, health
and safety, purchasing, reports, and Pepper (the staff AI assistant). Guests book through an
embeddable widget and browse the tenant's site at `{slug}.macaroonie.com`.

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

## How these notes are organised

This file is the index and the rules that apply everywhere. It is loaded in full at the start
of every session and sent again with every step, so it stays small. Everything about one area
lives in that area's file, which is read only when a task touches the area.

| Read | For |
|---|---|
| `docs/claude/areas/<area>.md` | The area's key files and its mistakes to avoid. **Read the file for every area a task touches before changing code there.** |
| `docs/claude/history/<area>.md` | What shipped in the area and when (the old Completed items). Reference only. |
| `docs/claude/outstanding/<area>.md` | What isn't built, known limits and follow-ups, one file per area (`OUTSTANDING.md` is only the index). |
| `docs/claude/estimates.md` | Each feature step's estimate against what it took (build, merge, model, effort). Add a row for every step you build. |
| `areas.json` | Which files belong to which area; checked by `scripts/check-areas.mjs` (see Working in parallel). |
| `docs/*.md` | Design documents: `POS.md`, `REPORTS.md`, `CHAT_FIRST.md`, `PEPPER_FIRST.md`, `ORDERING_APP.md`, `ANDROID_HUB.md`, `SALES_IMPORT.md`, `CATALOGUE.md`, `PARALLEL_WORK.md`, `INVENTORY.md`. |
| `docs/claude/backup/` | The whole CLAUDE.md as it was on 21 Nov 2026, before it was split. Never loaded; searches skip it (the root `.ignore`). |

The areas:

| Area file | Covers |
|---|---|
| `docs/claude/areas/core.md` | Multitenancy and RLS, Auth0 login and tenant selection, roles and module permissions (Access), team, platform admin, migrations, sealed secrets, environment variables, the dev tools (backlog, issue log, feature requests, changelog), the full repo structure |
| `docs/claude/areas/bookings.md` | Bookings, the timeline, schedule and slots, tables and combinations, booking rules, customers, the reservations widget, deposits, booking emails and email monitoring |
| `docs/claude/areas/website.md` | The website builder and page builder blocks, Eta templates, publish and staging, custom domains, brand and theme, the theme maker, the media library, reviews, SEO |
| `docs/claude/areas/menus.md` | Menus and publishing (releases), option groups, allergens and dietary tags, the print designer, tax rates, combos (meal deals), menu times, translations, the Deliveroo file |
| `docs/claude/areas/ordering.md` | Online ordering (collection), promotions, payment gateways, Stripe Connect |
| `docs/claude/areas/till.md` | Checks, events and the sequencer, PINs, till layouts, charges, discounts, order flows, the order prompt, order types and revenue streams, card machines, device addresses, the installer app, Store tech, test till sales |
| `docs/claude/areas/kitchen.md` | Kitchen screens (KDS), kitchen flows and their boxes (Splitter, Sleeper, Setter, printers), ticket colours, the packing check, the live view, the test bench |
| `docs/claude/areas/kiosk.md` | The kiosk app, kiosk designs and the designer, shared previews, kiosk analytics and journeys, the order done screen and receipts |
| `docs/claude/areas/screens.md` | Menu screens, the board designer, playlists, walls, the player, order ready boards |
| `docs/claude/areas/hub.md` | The venue hub and hub first, printers and print jobs, receipt and ticket designs, the Android app |
| `docs/claude/areas/loyalty.md` | The loyalty programme, rewards, stamp cards, members, the loyalty web app and card block, wallet cards |
| `docs/claude/areas/cash.md` | Cash Recon days and weeks, wages, expenses, the cash dashboard widgets, Loyverse and GloriaFood |
| `docs/claude/areas/rota.md` | Staff, roles, the rota, pay, tip pots and tips |
| `docs/claude/areas/hs.md` | Food safety logs, checklists, the H&S action log, H&S settings, H&S test data |
| `docs/claude/areas/dashboards.md` | The dashboards engine and its widgets, the Overview tiles |
| `docs/claude/areas/purchasing.md` | Inventory, suppliers and prices, order lists, restaurant and purchase orders, receiving, invoices |
| `docs/claude/areas/pepper.md` | The staff AI assistant, its tools and chat loop, the MCP connectors, the AI readers (menus, invoices, receipts), new locations with Pepper and the venue wizard |
| `docs/claude/areas/reports.md` | The report definition, catalogue, engine, builder, drill-downs, charts, print, files, schedules, data links, the smart builder and Pepper report tools |
| `docs/claude/areas/local-info.md` | Weather, traffic, events and incidents around each venue: captures, flags and learning, merging, bulk delete |
| `docs/claude/areas/shell.md` | AppShell and the sidebar, the navigation designer and menu search, the launcher, Settings, the phone app (/mobile, ops.), Today, platform hosts, shared UI parts, the in-app Help and Docs pages |
| `docs/claude/areas/infra.md` | Deployment and CI, nginx and certificates, WebSockets and Redis, uploads and storage, the API tests and browser checks |
| `docs/claude/areas/general.md` | React, JSX, CSS, Tailwind and SQL mistakes that are not about one area |

To find the notes on a function, table, route or page, search `docs/claude/areas` for its name.
The entries were sorted into areas by keyword on 21 Nov 2026, so one may sit in a neighbouring
area's file: search before deciding there is no note, and move a misfiled entry when you find one.

---

## SOS Checklist

When a new session begins:

**1. Orient:**
- This file is loaded automatically.
- If the conversation has a compacted summary, verify its claims against the actual codebase before referencing past items as "pending".

**2. Verify codebase state:**
- `git log --oneline -5` — what changed since last session?
- `git status` — pick up uncommitted WIP.
- `git branch -a` — confirm you're on the right branch.
- If the user mentions earlier work, grep to confirm it exists before assuming it's still pending.

**3. Read the notes for the task:**
- The area file for every area the task touches (table above).
- `docs/claude/outstanding/<area>.md` when the task is a follow-up or something listed as not built.

**4. Establish session context:**
- Ask the user what they want to work on; don't assume.
- For a multi-step task, create a TodoWrite immediately.
- Note today's date for changelog entries.

**Critical rule:** Never reference backlog items, bugs, or features from a session summary as "pending" without verifying. Session summaries go stale. Always grep / check live code.

---

## EOS Protocol

When the user signals end of session ("wrap up", "eos", "that's all", or naturally winds down):

**1. Update all docs** affected by this session:
- The area file (`docs/claude/areas/<area>.md`) — new key files, new mistakes to avoid (append-only).
- The history file (`docs/claude/history/<area>.md`) — one short entry per shipped feature: what shipped, the migration number, the date, where the code is. A few lines, no test tallies.
- `docs/claude/outstanding/<area>.md` — limits, follow-ups, anything left unfinished (a new item takes the next number after the highest in any file there).
- This file — only when a rule that applies everywhere changes, or an area is added.
- In-app Help — **always** add/update the operator-facing section (`admin/src/pages/help/<id>.jsx`, one file per section; a new section is a new file whose `order` slots it in) for any new or changed feature. This is the most user-visible doc and must never lag behind shipped code.
- In-app Docs — **always** add/update the technical section (`admin/src/pages/docs/<id>.jsx`) for any new API routes, DB tables, services, or architectural changes.
- `docs/claude/estimates.md` — a row for each feature step built: the estimate made before it, build and merge times, model and effort, and its detail from `node scripts/session-timings.mjs` (phases, model time, tokens, cost, lines changed).
- The changelog — add a file `changes/YYYY-MM-DD-<area>-<slug>.md` for shipped features (`changes/README.md`; `CHANGE.md` is the history before 22 Nov 2026).

**2. Impact analysis:**
- Files modified / created this session.
- Existing features that may be affected by changes.
- Cross-cutting concerns flagged (e.g. RLS implications, template include paths, CSS variable additions).

**3. Risk + gap assessment:**
- Untested edge cases.
- Incomplete bits left behind (mark them clearly in `docs/claude/outstanding/<area>.md`).
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
12. **Grey page, white cards, accent card headers.** Pages sit on `bg-page` (grey). Content goes in white bordered cards; a card's header row uses the `section-head` class (tenant website accent), never `border-b bg-muted/40`. Page title bars are `bg-background`. See `admin/src/index.css`.

---

## Repo structure

| Path | What it is |
|---|---|
| `api/` | Node.js API (Fastify): `src/routes`, `src/services`, `src/ai` (Pepper), `src/reports`, `src/views` (Eta templates), `test/`, `scripts/migrate.js` |
| `admin/` | React admin portal (Vite): the office, the phone app (`/mobile`, ops.), the installer app |
| `migrations/` | PostgreSQL migrations, applied in order by `api/scripts/migrate.js` |
| `shared/` | Plain ESM used by `api/`, `admin/`, `pos/`, `screen/` and `hub/`: the one implementation of each shared rule (prices, tax, combos, kiosk, loyalty, purchasing maths, `reports/`, `pos/` for the till's rules) |
| `pos/` | The till, kitchen screen and self-order kiosk apps (React PWA, own package.json), served by the API on pos. / kitchen. / kiosk. |
| `screen/` | The menu screens' player (plain files, no build), served on screens. |
| `hub/` | The venue hub (Node, no dependencies) for a mini PC: printing and hub-first trading on the venue network |
| `android-app/` | Macaroonie Player, the Android shell app (Expo) around the till, kitchen screen, kiosk and menu screen web apps |
| `office-app/` | Macaroonie Office, the staff phone app (Expo) around the phone pages: native sign-in, push, speech, scanner |
| `docs/` | Design documents, and `docs/claude/` (these notes) |
| `scripts/` | Server scripts the deploy runs (nginx, the domain sync) |
| `setup.sh`, `deploy.sh` | One-shot server setup; a fallback deploy script that isn't part of the normal flow |

The full listing, file by file for `shared/` and `docs/`, is in `docs/claude/areas/core.md`.

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

## Where the core lives

- `api/src/config/db.js`: `withTenant()`, `tenantSql()`, system mode (`systemSql`, `withSystem()`), the report builder's pool. Touch this carefully.
- `api/src/config/env.js`: Zod-validated env. The API won't start with a missing var.
- `api/src/app.js`: plugins, the error handler (set before the routes), the host sites, and loading every area's routes from `api/src/areas/<area>.js`. Background jobs: one file each in `api/src/jobs/`, started from `loadJobs()`.
- `api/src/middleware/auth.js`: JWT validation, tenant resolution per request, `requirePermission()` and the other guards.
- `api/src/middleware/error.js`: the global error handler (PG error codes mapped to HTTP codes).
- `api/src/middleware/venue.js`: `requireOwnVenue()`, `refuseOtherTenantsVenues`.
- `api/src/config/modules.js`: the module registry and permission levels, the single source of truth for both.
- `api/scripts/migrate.js`: the migration runner (`schema_migrations`).
- `admin/src/main.jsx`: the providers, the sign-in gate and the shells; each area's routes are in `admin/src/routes/<area>.jsx`, the menu records in `shared/nav/<area>.js`. `admin/src/components/layout/AppShell.jsx`: the office shell. `admin/src/components/mobile/MobileShell.jsx`: the phone app's shell.
- `admin/src/lib/api.js`: `useApi()`, which every API call goes through (it adds the Auth0 token and `X-Tenant-Id`). `admin/src/hooks/usePermission.js`: `usePermission(module)`.
- `admin/src/pages/Help.jsx` and `admin/src/pages/Docs.jsx`: the in-app operator guide and technical documentation, gathered from one file per section in `pages/help/` and `pages/docs/`.

---

## Multitenancy — the most important thing to understand

Every tenant table in the DB has:
- A `tenant_id uuid` column
- Row-level security (RLS) enabled **and forced** (migration 176: the app's role owns the tables, and an owner isn't held to RLS unless it is forced)
- One policy: `USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on')`

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

`withTenant()` wraps a transaction with `set_config('app.tenant_id', id, true)` (ends with the transaction).
`systemSql` / `withSystem()` (a second, small pool whose connections start with `app.bypass_rls = 'on'`) are **system mode**, only for work that crosses tenants on purpose: finding the tenant from a token, slug, device or id; background jobs and sweeps; the platform pages. `withTx()` is gone. A query on the bare `sql` pool sees no tenant rows. Every query still filters `tenant_id` itself (RLS is the backstop; system mode has none). Superusers skip RLS even when forced: production's `macaroonie_user` isn't one, and tests must not run as one.

**Connection pooling**: postgres.js pools straight to Postgres. `withTenant()` is safe with any pooling; `systemSql` relies on a connection startup parameter, so behind a transaction-mode pooler `withSystem()` would have to `set_config('app.bypass_rls', 'on', true)` per transaction instead.

---

## Auth flow

**Login is identity-only — tenant selection happens on our side, not via a second Auth0 org login.**
This superseded the original org-scoped-login design; the description below is what's actually
live. See the "Tenant selection" Completed item and Docs.jsx's Authentication section for the
full client-side mechanics (`TenantGate`, `TenantSwitcherModal`, `X-Tenant-Id`).

1. User logs in via Auth0 with no `organization` param (`RequireAuth` in `main.jsx`) — except an
   invitation link, which forwards its `invitation`/`organization` query params as-is.
2. API middleware (`src/middleware/auth.js`) validates the JWT via JWKS and checks `platform_admins`.
3. The active tenant is resolved **per request** from the `X-Tenant-Id` header (sent by every
   admin-portal call via `useApi()`), falling back to the JWT's `org_id` claim only when no header
   is sent. A header naming a tenant the caller isn't a member of is ignored (logged), never 401'd.
4. `req.tenantId` and `req.user.role` are attached to every request.
5. Every route handler passes `req.tenantId` to `withTenant()`.

Roles: `owner` > `admin` > `operator` > `viewer`
Use `requireRole('admin', 'owner')` for destructive/config operations.

**Auth0 Dashboard setting this depends on:** Applications → Macaroonie Admin → Login Experience →
**Types of Users = "Business Users"**. This is what actually makes the app invitation-only — see
the Common-mistakes entry below before ever touching this setting.

---

## Rules that apply everywhere

The detail and the reasons are in the area files. These are the ones that bite in every area.

**Tenant data and permissions**

1. Every query on tenant data goes through `withTenant(req.tenantId, tx => ...)` and still filters `tenant_id` itself. RLS is forced: on the bare `sql` pool a tenant table returns no rows, silently.
2. System mode (`systemSql`, `withSystem()`) is only for work that finds its tenant itself: a lookup by slug, token, device or webhook, background jobs, the platform pages. Filter by what was found. Anything outside the API that reads tenant tables (server scripts with psql, one-off node scripts) must use system mode too.
3. A new table with a `tenant_id` enables and forces RLS in its own migration, with the policy shown under Multitenancy.
4. Check that every id arriving in a URL, query or body is the caller's tenant's, not only the row being changed. Venue ids are covered by `requireOwnVenue()` and `refuseOtherTenantsVenues`; every other kind needs the route's own check.
5. Routes use module permissions: reads `requirePermission(module, 'view')`, changes `'manage'`, everyday work `'use'` on the modules that offer it. `requireRole()` only as an extra on top of that. Rank levels with `permissionAtLeast()`, never list them (`level === 'view' || level === 'manage'` hides things from Use).
6. An admin screen that changes data checks `usePermission(module)` (`canView`, `canUse`, `canManage`) and shows `ReadOnlyNotice` for View. The API's gate is the real check.
7. Fastify preHandler guards are `async function`s. A sync guard in a preHandler array hangs the request with no error.

**Database**

8. One numbered file per change in `migrations/` (check the highest number first). No `BEGIN` / `COMMIT` in the file: the runner wraps it. Seeds are idempotent. It must build on an empty Postgres without pg_cron (CI checks). Never change what an applied migration does. Name it `NNN_<area>_<slug>.sql`, NNN one more than the highest on `main` when the branch starts: two branches with the same number both apply (the runner tracks names), and a migration never depends on one in another open branch.
9. postgres.js returns `date` columns as JS `Date`s: select `col::text` wherever the value is a map key, compared with a `YYYY-MM-DD` string, sent to the UI as a day or written back. `time` columns arrive as `HH:MM:SS`. jsonb goes in with `tx.json()`.
10. A stored secret (API key, token, password) is sealed with `seal()` / `unseal()` (`api/src/services/vault.js`), its column added to `SEALED`, and never returned by a route.
11. Slots are never stored: `get_available_slots()` computes them at request time.

**One implementation of each rule**

12. A figure or a rule has one implementation, in `shared/` when more than one app needs it (prices, tax, combos, check rules, kiosk, loyalty, purchasing maths, cash variance, report rules). Find it in the area file and call it. Never work the same thing out again in a page, a report or a tool.
13. Whole-tree saves replace everything (a menu, a week's wages, a rota week, a checklist's ticks, a device's settings, a supplier's venues). A caller must send back every field, also the ones it doesn't edit.
14. Guests and devices read menus through `loadMenuVersion()` / `loadMenuVersions()` (the live release). The menu tables are the draft.
15. A till check changes only through an event and `applyEvent()` (`shared/pos/checks.js`). `pos_checks`, `pos_check_lines` and `pos_payments` are projections of the events.
16. The API runs as several PM2 processes: nothing another process must see lives in a module variable (use Postgres or Redis). Pushes go through `broadcast()` (`api/src/config/ws.js`).
17. Never await `notificationQueue.add()` in a request: Redis may be down. Fire and forget with `.catch()`.
18. A link someone typed or a client sent is checked and drawn through `webLink()` (`shared/links.js`), never Zod's `url()` alone.
19. Model calls go through `askForJson()` (`api/src/services/aiJson.js`) or the chat's `callModel()`, are counted with `addUsage()`, and their routes sit under `/api/ai/` (the 5 minute proxy timeout). A model is given refs, never ids, and tenant text in a prompt is data, never instructions.

**Admin UI**

20. Every page under `AppShell` brings its own scroll container (`h-full overflow-y-auto` around the content): the shell's `<main>` is `overflow-hidden`.
21. A new admin page needs its route in `admin/src/routes/<area>.jsx` (`{ path, shell, element }`), its record in `shared/nav/<area>.js` (path, label, icon, module, section, order, catalogOrder, keywords, description; `shared/nav/index.js` builds `ROUTE_CATALOG`, `DEFAULT_NAV_TREE`, `NAV_KEYWORDS` and `NAV_DESCRIPTIONS` from them, and an area's first nav file is added to its import list), and a migration that adds the link to existing menus. Its address must not start with a path nginx hands to the API (`/api/`, `/ws`, `/webhooks/`, `/manage`, `/reservations`, `/widget-api`, `/order-api`, `/uploads/`, `/template-assets/`).
22. TanStack Query v5: `useQuery` has no `onSuccess`, callbacks take the query, and a resolved `null` is not `undefined`. Declare every hook before any early return.
23. In JSX text `{...}` and `${...}` are code: put code samples in a string expression. In a Help section file an `<H3>` is plain text (Pepper links to its anchor). Check that a docs page renders, not only that it builds.
24. The admin's main bundle must stay under the service worker's 6 MiB precache limit, or the deploy's build fails. Run `npx vite build` in `admin/` after adding a big page or a lot of text, and load heavy pages with `React.lazy`.
25. Typographic quotes used as string delimiters, and invisible characters (a byte order mark, a no-break space), break builds and templates. Check edited files for them; write an invisible character as its escape.

**Eta templates (`api/src/views`)**

26. Inside `<% %>`: block comments only, no regex literals that hold quote characters, no template literals, no variable named `layout` or `include`, and a `.filter().join()` chain goes in a `const` first. A value that already holds CSS quotes is written with `<%~ %>`.

**Tests**

27. `npm test` in `api/` empties the database it runs against: `DATABASE_URL` must name a database with `test` in it, owned by a role that is not a superuser, and migrated first (`node scripts/migrate.js`). On a computer other runs share, use one of your own: `eval "$(scripts/test-env.sh <name>)"` makes and migrates `macaroonie_test_<name>` and sets its own Redis database, queue prefix and folders.
28. A new table, or a route that takes ids, gets a row made through the API in its area's `api/test/support/fixtures/<area>.mjs` (`fill(ctx)`, run by `order`; rows a later area needs go in `ctx.made`), so the cross-tenant sweep covers it. A named id parameter whose ids come from one table goes in that file's `kinds`.

---

**Working in parallel** (`docs/PARALLEL_WORK.md`)

29. One area per task: read its notes, change files in its paths (`areas.json`), and add its Help, Docs, changelog, notes and outstanding entries in the area's own files. Lists that every area used to edit are gathered from per-area files (Help and Docs sections, routes, menu records, route registration, jobs, Pepper's tools, report subjects and decisions, test fixtures, the object registry `shared/registry/<area>.js`, plain forms `api/src/forms/<area>.js`): add to your area's file, never to a central list.
30. A branch per task from the latest `main`; merge `main` in before opening the pull request. A change to a shared file (`shared/` rules another area owns, `api/src/config/`, `api/src/app.js`, `admin/src/main.jsx`, `CLAUDE.md`, `areas.json`) is named in the pull request's title, and a change another area needs goes first as its own small pull request.
31. An import into another area's private files fails CI (`node scripts/check-areas.mjs imports`): call a file the area lists as `public` in `areas.json`, or move the code to `shared/`. A new file in a folder no area claims is listed by `node scripts/check-areas.mjs`: add it to its area. A gathered list (`tools/index.js`, `catalogue/index.js`, `starters/index.js`, `jobs/queues.js`, `app.js`) is never imported back from the files it gathers; a new area file is added to the folder's `files.js` where there is one. Never gather a folder with a top-level await in a module others import: two of them deadlock silently.

## Environment variables

Both `.env.example` files document every var. The API refuses to start when a required one is missing (Zod validation in `api/src/config/env.js`). The list with notes is in `docs/claude/areas/core.md`. Docs hold names and where a value lives, never the value.

---

## Deployment

**Deployment is automatic on push to `main`.** A GitHub Actions workflow (`.github/workflows/deploy.yml`) builds and deploys. **Never suggest running `deploy.sh` manually**: it exists on the server as a fallback only.

- Migrations run automatically (`api/scripts/migrate.js`, tracked in `schema_migrations`, each file in a transaction). A failed migration aborts the deploy before the API restarts.
- Pull requests are checked by `.github/workflows/ci.yml`: every migration on an empty Postgres 16 (no pg_cron), twice, the API started against it, the shared unit tests and the API tests. It deploys nothing.
- The server is one Lightsail Ubuntu machine: nginx, PM2 (cluster), Postgres, Redis. OS user `ubuntu`, app at `/home/ubuntu/app`. Detail in `docs/claude/areas/infra.md`.

---

## Running locally and tests

Prerequisites: Postgres 16, Redis 7, Node 22.

```bash
# API
cd api
cp .env.example .env                               # fill in values
npm install
set -a; source .env; set +a; node scripts/migrate.js   # every migration, in order
npm run dev                                        # :3000, with --watch

# Admin portal (separate terminal)
cd admin
cp .env.example .env                               # fill in VITE_ values
npm install
npm run dev                                        # :5173, proxies /api to :3000
```

Tests:
- `npm test` in `api/` (rule 27; CI runs it as the `api-tests` job).
- `node --test shared/test/*.test.mjs shared/pos/test/*.test.mjs` from the repo root.
- `node --test hub/test/*.test.mjs` for the venue hub, `npm test` in `android-app/` and `office-app/` for the two phone apps' rules.
- `npx vite build` in `admin/` (and in `pos/` for the device apps) before shipping UI changes.

---

## Doc maintenance

- **Keep this file under about 40 KB.** It is loaded in full every session and sent again with every step. Anything about one area goes in that area's file.
- **Area files** hold key files, then mistakes to avoid. Mistakes are append-only: never delete an entry, only correct one that turns out to be wrong.
- **History entries stay short**: what shipped, the migration number, the date, where the code is. No test tallies and no account of how a bug was found.
- **A new area** gets `docs/claude/areas/<slug>.md`, `docs/claude/history/<slug>.md` and a row in the table above.
- **Split an area file that passes about 120 KB** (`till.md` and `reports.md` are the nearest).
- Don't duplicate what the code already says (table schemas, route lists). Reference it.
- No credentials, tokens or secret values: only their names and where they live.
- No time-sensitive status in this file: that is what `docs/claude/outstanding/` is for.
- Never write an at-sign path import in this file: Claude Code would load the named file into every session.
- Companion files: `changes/` (the changelog, one file per change; `CHANGE.md` before 22 Nov 2026) and `docs/<MODULE>.md` (design deep dives).
