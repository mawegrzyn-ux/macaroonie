# Macaroonie — Change Log

All notable changes to this project, most recent first.
Migrations are listed where a database change is required.

---

## [Unreleased / Current]

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
