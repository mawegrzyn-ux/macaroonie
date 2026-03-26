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
- `src/routes/slots.js` — Calls `get_available_slots()` PG function. Thin wrapper.
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
- `src/pages/Docs.jsx` — in-app technical documentation (auto-synced with codebase).
- `src/pages/Help.jsx` — operator user guide.
- `src/pages/Settings.jsx` — theme colour picker (live CSS var update) + timeline view defaults.
- `src/contexts/SettingsContext.jsx` — `themeHex` state + `hexToHsl`/`fgForHex`/`applyTheme` helpers. Default `#630812`. Persisted to `maca_settings` localStorage key.
- `src/contexts/TimelineSettingsContext.jsx` — `hideInactive`, `groupBySections`, `panelMode`, `venueId`, `refetchTrigger`. All three toggles persisted to `maca_timeline_prefs` localStorage.
- `src/components/bookings/BookingDrawer.jsx` — booking detail side-panel. Save button in header (contextual per edit mode). Table override: individual checkboxes only, pre-populated from member_table_ids; **single-table → `PATCH /relocate`** (cascade displacement), **multi-table → `PATCH /tables`** (direct), **unallocated → `PATCH /tables`**; "Unallocated" checkbox at top of picker (orange); unallocated bookings show orange badge in view mode. **Capacity warning** (amber) shown permanently in table section when `booking.covers` exceeds table/combination max. **End time editor**: "End time" button in Date & time section; `PATCH /bookings/:id/duration`; midnight crossover handled.
- `src/components/bookings/NewBookingModal.jsx` — admin new booking. Touch-optimised: 48px cover buttons, date-as-button (OS picker), tel input for phone, custom numeric keypad for covers on touch devices. Accepts `openManual`/`prefillTime`/`prefillTableId`. **Canvas click flow** opens ManualAllocModal directly. **Manual allocation** button bypasses slot resolver. Customer search: debounced suggestions panel (desktop: side panel; mobile: inline below phone field with × dismiss). Walk In button. autoFocus suppressed on touch. **Slot warnings**: amber when booking end > `sitting_closes_at`; red when > `sitting_doors_close`.
- `src/components/widget/BookingWidget.jsx` — Self-contained widget component. This is the reference implementation for the Ember.js widget.

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

---

## Outstanding items

### Build next (larger features)

**1. Ember.js booking widget**
`src/components/widget/BookingWidget.jsx` is the reference implementation.
Port the 5-step flow (covers → date → slot → details → confirm) to Ember.js.
Style via CSS custom properties (accent colour, theme) so it's white-labelable.
Deploy as an iframe embed with a `<script>` loader snippet.

**2. Team management page**
Route: `/team`. Uses Auth0 Management API to invite users to an organisation.
Pattern: POST to Auth0 `/api/v2/jobs/invitations` → user receives email → joins org.
Store role in `app_metadata.role` on the Auth0 user.

**3. Customer hard delete**
Customers page currently supports anonymise (GDPR erasure by overwrite) but not hard delete.
A double-confirmation hard delete (for internal test/demo data cleanup) is still outstanding.
Must cascade-delete linked bookings or reassign them. Requires `requireRole('owner')` guard.

**4. Test suite**
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

- **Never query tenant tables without `withTenant()`** — RLS silently returns empty rows, not an error.
- **Never trust client for payment confirmation** — booking only becomes permanent via Stripe webhook, not client-side resolve.
- **Never store slots** — they are always computed. Do not add a `slots` table.
- **`slot_duration_mins` ≠ `slot_interval_mins`** — duration is how long a booking lasts, interval is how often a new slot starts. Both live on different tables.
- **`max_covers = 0` on a slot cap ≠ fully booked** — it means intentionally blocked. The `zero_cap_display` venue setting controls whether it shows as hidden or unavailable.
- **Hold TTL is configurable per venue** — `booking_rules.hold_ttl_secs`. Default 300 (5 min). Widget countdown is driven by `expires_at` from the hold response, not a local timer.
- **pg_cron is a fallback** — the primary hold release is the explicit `DELETE /holds/:id` call. Don't rely on the sweep as the main path.
- **`slot_time` from DB is `HH:MM:SS`** — PostgreSQL `TIME` columns serialise to `HH:MM:SS` in JSON, but the API validation regex expects `HH:MM`. Always call `.slice(0, 5)` on slot_time values before using them as keys or sending them back to the API.
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
- **`timelineStart`/`timelineEnd` are integers, not strings** — stored in localStorage as numbers. When reading from `tlSettings`, do arithmetic directly: `const totalHours = endHour - startHour`. The `<select>` dropdowns in Settings use `Number(e.target.value)` on `onChange` to ensure the stored value is always a number, not a string.

---

## Deployment — CI/CD via GitHub Actions

**Deployment is fully automated on push.** A GitHub Actions workflow (`.yml`) handles build and
deploy automatically when changes are pushed from the developer's laptop. **Never suggest running
`deploy.sh` manually** — it is not needed and should not be referenced at the end of responses.

- **To deploy:** `git push` from the local laptop. The Actions workflow does the rest.
- **Migrations** still require a manual step: connect to the server via SSH then
  `psql` → `\i /home/ubuntu/app/migrations/NNN_name.sql`
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
