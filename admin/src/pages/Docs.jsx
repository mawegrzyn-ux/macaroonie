// src/pages/Docs.jsx
// Technical system documentation — architecture, DB schema, API reference, data flows.
import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'

const SECTIONS = [
  { id: 'overview',     label: 'Overview' },
  { id: 'architecture', label: 'Architecture' },
  { id: 'tech-stack',   label: 'Tech Stack' },
  { id: 'admin-portal', label: 'Admin Portal' },
  { id: 'multitenancy', label: 'Multitenancy & RLS' },
  { id: 'auth',         label: 'Authentication' },
  { id: 'database',     label: 'Database Schema' },
  { id: 'api',          label: 'API Reference' },
  { id: 'services',     label: 'Services & Jobs' },
  { id: 'data-flows',   label: 'Data Flows' },
  { id: 'deployment',   label: 'Deployment' },
]

export default function Docs() {
  const [activeId, setActiveId] = useState('overview')

  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        const visible = entries.filter(e => e.isIntersecting)
        if (visible.length) setActiveId(visible[0].target.id)
      },
      { rootMargin: '-10% 0px -75% 0px' },
    )
    document.querySelectorAll('section[data-doc]').forEach(el => observer.observe(el))
    return () => observer.disconnect()
  }, [])

  return (
    <div className="flex h-full overflow-hidden">
      {/* TOC */}
      <aside className="w-52 shrink-0 border-r overflow-y-auto py-6 px-3 hidden md:block">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-2 mb-3">
          Contents
        </p>
        <nav className="space-y-0.5">
          {SECTIONS.map(s => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className={cn(
                'block px-2 py-1.5 rounded text-sm transition-colors',
                activeId === s.id
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent',
              )}
            >
              {s.label}
            </a>
          ))}
        </nav>
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-8 space-y-16">
          <div>
            <h1 className="text-2xl font-bold">System Documentation</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Technical reference for developers and system administrators.
            </p>
          </div>

          {/* ── OVERVIEW ──────────────────────────────────── */}
          <section id="overview" data-doc="">
            <H2>Overview</H2>
            <P>
              Macaroonie is a multitenant restaurant table booking platform for the F&amp;B / QSR franchise sector.
              Operators register their restaurant as a tenant. Each tenant configures venues, tables, opening schedules,
              booking rules, and deposit requirements via this admin portal. Guests book through an embeddable booking
              widget (iframe / Ember.js). Owner: Obscure Kitty.
            </P>
            <H3>Repo structure</H3>
            <Code>{`/
├── api/          Node.js API (Fastify)
├── admin/        React admin portal (Vite)
├── migrations/   PostgreSQL migration files (001–015, run in order)
├── setup.sh      One-shot Lightsail server setup
├── deploy.sh     Subsequent deployments
└── CLAUDE.md     Developer context and outstanding items`}</Code>
          </section>

          {/* ── ARCHITECTURE ──────────────────────────────── */}
          <section id="architecture" data-doc="">
            <H2>Architecture</H2>
            <Code>{`┌──────────────────────────────────────────────────────────┐
│                    Guest / Operator                       │
└──────────────┬───────────────────────────┬───────────────┘
               │ Booking Widget             │ Admin Portal
               │ (iframe / Ember.js)        │ (React / Vite)
               ▼                            ▼
┌──────────────────────────────────────────────────────────┐
│                   Fastify API  (:3000)                   │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐  │
│  │ /slots  │  │/bookings │  │/payments │  │/venues  │  │
│  └────┬────┘  └────┬─────┘  └────┬─────┘  └────┬────┘  │
│       └────────────┴─────────────┴──────────────┘       │
│               withTenant() / Row-Level Security          │
└──────────────┬──────────────────────────┬───────────────┘
               │                          │
   ┌───────────▼──────────┐  ┌────────────▼──────────┐
   │  PostgreSQL 16        │  │  Redis 7 / BullMQ     │
   │  RLS per tenant       │  │  Email & hold sweep   │
   └──────────────────────┘  └───────────────────────┘
               │
   ┌───────────▼──────────┐
   │  Auth0 (JWT / JWKS)  │
   │  Org-scoped tokens   │
   └──────────────────────┘`}</Code>
            <P>
              Infrastructure: single AWS Lightsail instance (Ubuntu 24.04). Nginx reverse-proxies{' '}
              <Mono>/api</Mono> to port 3000 and serves the admin SPA as static files.
              PM2 manages the Fastify process with auto-restart.
            </P>
          </section>

          {/* ── TECH STACK ────────────────────────────────── */}
          <section id="tech-stack" data-doc="">
            <H2>Tech Stack</H2>
            <DataTable
              head={['Layer', 'Technology', 'Purpose']}
              rows={[
                ['API runtime', 'Node.js 22, ESM', 'Native ES modules, no build step'],
                ['API framework', 'Fastify 4', 'Low overhead, built-in schema validation'],
                ['DB client', 'postgres.js (raw SQL)', 'Direct SQL — matches migrations exactly, no ORM magic'],
                ['Auth', 'Auth0 JWT + JWKS', 'Offloads auth entirely; multitenancy via Auth0 Organisations'],
                ['Payments', 'Stripe Connect', 'Each restaurant is a Connect account; platform takes fee'],
                ['Queue', 'BullMQ + Redis', 'Email jobs, hold expiry sweep fallback'],
                ['Validation', 'Zod', 'API request bodies and admin portal form schemas'],
                ['Admin UI', 'React 18, Vite', 'SPA with hot module replacement in dev'],
                ['Data / cache', 'TanStack Query v5', 'Server state, cache invalidation, background refetch'],
                ['Drag & drop', '@dnd-kit/core', 'Timeline drag-to-reschedule (mouse + touch sensors)'],
                ['Realtime', 'ws (WebSocket)', 'Timeline live updates; rooms keyed by venue_id'],
                ['Deployment', 'Ubuntu 24.04, Nginx, PM2', 'Single Lightsail instance'],
              ]}
            />
          </section>

          {/* ── ADMIN PORTAL ──────────────────────────────── */}
          <section id="admin-portal" data-doc="">
            <H2>Admin Portal</H2>
            <H3>Design principles</H3>
            <P>
              The admin portal is optimised for <strong>tablet-sized touch screens</strong> at a host stand
              or service counter (target width: 1015 px). Every interactive element must be finger-usable.
            </P>
            <DataTable
              head={['Principle', 'Implementation']}
              rows={[
                ['Touch targets ≥ 48 × 48 px', 'Cover selector buttons (w-12 h-12), slot tiles (py-2), grip handles'],
                ['touch-manipulation on all buttons', 'Eliminates 300 ms iOS tap delay. Applied via className on every interactive element.'],
                ['No hover-only affordances', 'All UI discoverable by tap. Hover states are additive, not primary.'],
                ['Phone inputs use type="tel"', 'Triggers numeric keypad on iOS/Android without custom code.'],
                ['Custom numeric keypad', 'IS_TOUCH = navigator.maxTouchPoints > 0 at module load. inputMode="none" suppresses native keyboard; 3×4 grid overlay renders instead.'],
                ['Date as styled button', 'Invisible <input type="date"> overlays a styled label — OS date picker on mobile, native on desktop.'],
                ['Modals: max-h-[85vh] overflow-y-auto', 'Content never clips on smaller tablet screens in landscape.'],
              ]}
            />

            <H3>Key pages</H3>
            <DataTable
              head={['Page', 'Route', 'Purpose']}
              rows={[
                ['Timeline', '/timeline', 'Gantt view. Drag-to-reschedule, drag-to-relocate, resize, canvas click to create booking. Grey columns = closed or cap=0.'],
                ['Bookings', '/bookings', 'Flat list of all bookings. Opens BookingDrawer for detail/edit.'],
                ['Venues', '/venues', 'Create and manage restaurant locations.'],
                ['Tables', '/tables', 'Add tables, define sections, create combinations, set sort order, manage disallowed pairs.'],
                ['Schedule', '/schedule', 'Weekly template sittings, slot caps, date overrides, schedule exceptions.'],
                ['Rules', '/rules', 'Booking window, covers limits, hold TTL, smart allocation flags, deposit config, unconfirmed/reconfirmed flow toggles.'],
                ['Team', '/team', 'Invite staff via Auth0 Management API (in development).'],
                ['Widget test', '/widget-test', 'Runs the full guest booking flow in the portal for testing.'],
                ['Documentation', '/docs', 'This page.'],
                ['Help', '/help', 'Operator user guide.'],
              ]}
            />

            <H3>New booking modal — two paths</H3>
            <P>
              The <strong>+ New booking</strong> button (and canvas click on the Timeline) opens the new booking modal.
              There are two paths through it:
            </P>
            <DataTable
              head={['Path', 'How to trigger', 'Behaviour']}
              rows={[
                ['Automatic allocation', 'Select a slot → Continue', 'Slot resolver assigns the best available table/combination. Obeys all schedule, capacity, and booking-window rules.'],
                ['Manual allocation', 'Click "Manual allocation" button', 'Opens ManualAllocModal. Admin freely picks date, time, and any table(s) — or Unallocated. No schedule or capacity checks. POST /bookings/admin-override.'],
              ]}
            />
            <InfoBox type="warn">
              Manual allocation bypasses all rules. Use it for walk-ins, VIP overrides, or bookings outside normal hours.
              The booking is still broadcast to all timeline clients via WebSocket.
            </InfoBox>

            <H3>Timeline — grey column overlay</H3>
            <P>
              The Timeline fetches <Mono>GET /slots?covers=1</Mono> for the displayed date and renders grey vertical
              strips behind booking cards. A time column is grey when:
            </P>
            <ul className="list-disc list-inside text-sm text-muted-foreground ml-2 space-y-1">
              <li>No sitting covers that time (before first sitting, between sittings, after last sitting)</li>
              <li>A slot cap is explicitly set to 0 for that interval (<Mono>reason = 'unavailable'</Mono>)</li>
            </ul>
            <P>
              Fully-booked slots (<Mono>reason = 'full'</Mono>) are <strong>not</strong> greyed — the column
              stays white so operators can distinguish "capacity used" from "venue closed".
            </P>
          </section>

          {/* ── MULTITENANCY ──────────────────────────────── */}
          <section id="multitenancy" data-doc="">
            <H2>Multitenancy &amp; RLS</H2>
            <P>
              Every table in the database (except <Mono>tenants</Mono>) has a <Mono>tenant_id uuid</Mono> column,
              row-level security enabled, and a policy:
            </P>
            <Code>{`USING (tenant_id = current_setting('app.tenant_id', true)::uuid)`}</Code>
            <P>
              The <Mono>withTenant()</Mono> helper wraps every DB call in a transaction, sets the session
              variable, then runs the provided function. RLS automatically scopes every query.
            </P>
            <Code>{`// CORRECT — RLS context set; queries scoped to this tenant
const rows = await withTenant(req.tenantId, tx =>
  tx\`SELECT * FROM venues WHERE id = \${venueId}\`
)

// WRONG — RLS returns 0 rows silently (no error thrown)
const rows = await sql\`SELECT * FROM venues WHERE id = \${venueId}\``}</Code>
            <InfoBox type="warn">
              RLS failures are <strong>silent</strong>. The query returns 0 rows, not an error.
              Always use <Mono>withTenant()</Mono> for any query touching tenant data.
            </InfoBox>
            <H3>withTx() vs withTenant()</H3>
            <P>
              <Mono>withTx(fn)</Mono> opens a plain transaction without setting tenant context. Use it only
              for tenant-resolution queries that run before the tenant ID is known
              (e.g. slug → tenant UUID lookup).
            </P>
            <H3>Connection pooling</H3>
            <P>
              Must use <strong>transaction-mode pooling</strong> (PgBouncer transaction mode).
              Session mode leaks <Mono>app.tenant_id</Mono> between requests because{' '}
              <Mono>SET LOCAL</Mono> persists for the life of the session.
            </P>
          </section>

          {/* ── AUTH ──────────────────────────────────────── */}
          <section id="auth" data-doc="">
            <H2>Authentication</H2>
            <ol className="space-y-3 text-sm mb-6">
              {[
                'User logs in via Auth0 (organisation-scoped login).',
                "Auth0 Login Action injects tenant_id (Auth0 org ID) and role into the access token under the https://${AUTH0_DOMAIN}/claims/ namespace.",
                'API middleware (src/middleware/auth.js) validates the JWT via the Auth0 JWKS endpoint.',
                'Middleware resolves auth0_org_id → tenants.id (internal UUID).',
                'req.tenantId and req.user.role are attached to every request.',
                'Every route handler passes req.tenantId to withTenant().',
              ].map((text, i) => (
                <li key={i} className="flex gap-3">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-medium mt-0.5">
                    {i + 1}
                  </span>
                  <span className="text-muted-foreground">{text}</span>
                </li>
              ))}
            </ol>
            <H3>Roles</H3>
            <DataTable
              head={['Role', 'Privilege', 'Capabilities']}
              rows={[
                ['owner', 'Highest', 'Full access including tenant configuration and billing'],
                ['admin', 'High', 'All booking and venue configuration operations'],
                ['operator', 'Medium', 'Booking creation, management, and status changes'],
                ['viewer', 'Lowest', 'Read-only access to bookings and schedules'],
              ]}
            />
            <P>
              Use <Mono>requireRole('admin', 'owner')</Mono> as a route <Mono>preHandler</Mono> for
              destructive or configuration operations.
            </P>
          </section>

          {/* ── DATABASE ──────────────────────────────────── */}
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
                ['schedule_overrides', 'Replaces sittings for a specific date (bank holidays, closures).', 'venue_id, override_date, is_closed'],
                ['slot_caps', 'Per-slot cover cap overrides. Sparse — only stored when different from sitting default.', 'sitting_id, slot_time, max_covers'],
                ['schedule_exceptions', 'Named date-range exception with optional alternative weekly schedule. is_closed=true closes the period entirely.', 'venue_id, name, date_from, date_to, is_closed, priority'],
                ['exception_day_templates', 'Per-DOW schedule within an exception. Overrides weekly template for that day.', 'exception_id, day_of_week, is_open, slot_interval_mins'],
                ['exception_sittings', 'Sittings for an exception day template.', 'template_id, opens_at, closes_at, default_max_covers, doors_close_time, sort_order'],
                ['exception_sitting_slot_caps', 'Sparse per-slot cover cap overrides within exception sittings.', 'sitting_id, slot_time, max_covers'],
                ['booking_rules', 'Per-venue booking constraints. Includes smart-allocation rule flags.', 'venue_id, hold_ttl_secs, min_covers, max_covers, cutoff_before_mins, slot_duration_mins, allow_cross_section_combo, allow_non_adjacent_combo, allow_widget_bookings_after_doors_close, enable_unconfirmed_flow, enable_reconfirmed_status'],
                ['deposit_rules', 'Per-venue deposit configuration.', 'venue_id, requires_deposit, amount_pence, stripe_account_id'],
                ['booking_holds', 'Temporary slot reservations. UNIQUE (table_id, starts_at).', 'venue_id, table_id, combination_id, starts_at, ends_at, expires_at, guest_name, guest_email'],
                ['bookings', 'Confirmed bookings.', 'venue_id, table_id, combination_id, starts_at, ends_at, covers, status, reference, guest_name, guest_email, guest_phone, guest_notes, operator_notes'],
                ['payments', 'Stripe payment records.', 'booking_id, stripe_pi_id, amount, currency, status'],
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

          {/* ── API REFERENCE ─────────────────────────────── */}
          <section id="api" data-doc="">
            <H2>API Reference</H2>

            <H3>Holds &amp; Bookings — <span className="font-mono font-normal text-sm">/api/bookings</span></H3>
            <DataTable
              head={['Method', 'Path', 'Min role', 'Description']}
              rows={[
                ['POST', '/holds', 'any', 'Create a hold. UNIQUE (table_id, starts_at) guards concurrent requests.'],
                ['DELETE', '/holds/:id', 'any', 'Release a hold immediately. Cancels attached Stripe PI.'],
                ['POST', '/', 'any', 'Confirm a free booking (no deposit path).'],
                ['GET', '/', 'any', 'List bookings — filter by venue_id, date, status. Returns member_table_ids for combos.'],
                ['GET', '/:id', 'any', 'Single booking detail.'],
                ['PATCH', '/:id/status', 'operator', 'Transition booking status.'],
                ['PATCH', '/:id/move', 'operator', 'Same-table time shift. Preserves actual booking duration.'],
                ['PATCH', '/:id/relocate', 'operator', 'Cross-table drag. Finds best allocation anchored to target table (single → combo → adjacency expansion). Applies allow_cross_section_combo, allow_non_adjacent_combo rules and disallowed_table_pairs. If adjacency expansion finds a multi-table set but no pre-configured combo exists, returns 422 — operator must create the combination first. Cascades conflicts to free tables or Unallocated. Returns { moved, displaced[] }.'],
                ['PATCH', '/:id/duration', 'operator', 'Resize — change ends_at independently of slot_duration_mins.'],
                ['PATCH', '/:id/guest', 'operator', 'Edit guest name, email, phone, covers.'],
                ['PATCH', '/:id/tables', 'operator', 'Reassign table or combination. Pass table_ids[] for ad-hoc multi-table; auto-creates combination if no exact match exists.'],
                ['PATCH', '/:id/notes', 'any', 'Update internal operator notes.'],
                ['POST', '/admin-override', 'operator', 'Create booking directly — bypasses slot resolver, capacity, booking-window, and cutoff checks. Accepts table_ids[] (empty = unallocated row, one = single table, many = auto-creates combination). Fires confirmation email + WS broadcast.'],
              ]}
            />

            <H3>Slots — <span className="font-mono font-normal text-sm">/api/slots</span></H3>
            <DataTable
              head={['Method', 'Path', 'Auth', 'Description']}
              rows={[
                ['GET', '/', 'public', 'Available slots for venue_id + date + covers. Returns table_id or combination_id per slot. Computed by PG function — never from a stored table. Widget calls (unauthenticated) automatically hide slots at/after venue doors_close_time when allow_widget_bookings_after_doors_close rule is off.'],
              ]}
            />

            <H3>Venues — <span className="font-mono font-normal text-sm">/api/venues</span></H3>
            <DataTable
              head={['Method', 'Path', 'Min role', 'Description']}
              rows={[
                ['GET', '/', 'any', 'List venues for tenant'],
                ['POST', '/', 'admin', 'Create venue'],
                ['PATCH', '/:id', 'admin', 'Update venue settings'],
                ['DELETE', '/:id', 'owner', 'Delete venue'],
                ['GET', '/:id/tables', 'any', 'List tables for venue (includes is_unallocated flag)'],
                ['POST', '/:id/tables', 'admin', 'Create table'],
                ['PATCH', '/:id/tables/reorder', 'admin', 'Set table sort order. Accepts { ids: [uuid,...] } — full ordered array. Sets sort_order = array index. Drives Timeline row order and smart-allocate adjacency.'],
                ['GET', '/:id/combinations', 'any', 'List table combinations with member table IDs'],
                ['POST', '/:id/combinations', 'admin', 'Create combination'],
                ['PATCH', '/:id/combinations/:cid', 'admin', 'Update combination name / covers'],
                ['DELETE', '/:id/combinations/:cid', 'admin', 'Delete combination'],
                ['GET | PATCH', '/:id/rules', 'any | admin', 'Get or update booking rules (includes allow_cross_section_combo, allow_non_adjacent_combo flags)'],
                ['GET | PATCH', '/:id/deposit-rules', 'any | admin', 'Get or update deposit rules'],
                ['GET', '/:id/disallowed-pairs', 'any', 'List disallowed table pairs for smart allocation'],
                ['POST', '/:id/disallowed-pairs', 'admin', 'Add a disallowed pair { table_id_a, table_id_b }'],
                ['DELETE', '/:id/disallowed-pairs/:pid', 'admin', 'Remove a disallowed pair'],
              ]}
            />

            <H3>Schedules — <span className="font-mono font-normal text-sm">/api/venues/:id/schedule</span></H3>
            <DataTable
              head={['Method', 'Path', 'Min role', 'Description']}
              rows={[
                ['GET', '/', 'any', 'Full schedule (template + sittings + slot caps + overrides)'],
                ['PUT', '/template/:dow', 'admin', 'Upsert day template. Accepts is_open, slot_interval_mins, doors_close_time.'],
                ['POST', '/sittings', 'admin', 'Create sitting'],
                ['PATCH', '/sittings/:id', 'admin', 'Update sitting'],
                ['DELETE', '/sittings/:id', 'admin', 'Delete sitting'],
                ['POST', '/caps', 'admin', 'Set slot cap override for a specific time'],
                ['POST', '/overrides', 'admin', 'Create date override (e.g. bank holiday closure)'],
                ['DELETE', '/overrides/:date', 'admin', 'Remove date override'],
                ['POST', '/copy-day', 'admin', 'Copy all sittings from source_dow to target_dow'],
                ['GET', '/:venueId/schedule/exceptions', 'any', 'List all exceptions with nested day templates, sittings, and caps'],
                ['POST', '/:venueId/schedule/exceptions', 'admin', 'Create exception (name, date_from, date_to, is_closed, priority)'],
                ['PATCH', '/:venueId/schedule/exceptions/:eid', 'admin', 'Update exception header'],
                ['DELETE', '/:venueId/schedule/exceptions/:eid', 'admin', 'Delete exception and all nested data'],
                ['PUT', '/:venueId/schedule/exceptions/:eid/template/:dow', 'admin', 'Upsert DOW template within exception'],
                ['POST', '/:venueId/schedule/exceptions/:eid/template/:dow/sittings', 'admin', 'Add sitting to exception DOW template'],
                ['PATCH', '/:venueId/schedule/exceptions/:eid/sittings/:sid', 'admin', 'Edit exception sitting'],
                ['DELETE', '/:venueId/schedule/exceptions/:eid/sittings/:sid', 'admin', 'Remove exception sitting'],
                ['PUT', '/:venueId/schedule/exceptions/:eid/sittings/:sid/caps', 'admin', 'Replace slot caps for exception sitting'],
              ]}
            />

            <H3>Payments — <span className="font-mono font-normal text-sm">/api/payments</span></H3>
            <DataTable
              head={['Method', 'Path', 'Auth', 'Description']}
              rows={[
                ['POST', '/intent', 'any', 'Create Stripe PaymentIntent for a hold'],
                ['POST', '/webhook', 'Stripe sig', 'Stripe webhook — confirms booking on payment_intent.succeeded'],
                ['POST', '/:id/refund', 'admin', 'Issue refund via Stripe for a payment'],
              ]}
            />
          </section>

          {/* ── SERVICES ──────────────────────────────────── */}
          <section id="services" data-doc="">
            <H2>Services &amp; Jobs</H2>
            <div className="space-y-4">
              {[
                {
                  name: 'broadcastSvc.js',
                  path: 'src/services/broadcastSvc.js',
                  desc: 'Sends a WebSocket message to all admin clients subscribed to the venue. Call after every booking mutation.',
                  code: "broadcastBooking('booking.created', booking)\nbroadcastBooking('booking.updated', booking)",
                },
                {
                  name: 'WebSocket server',
                  path: 'src/config/ws.js',
                  desc: 'Runs on the same HTTP server. Auth via ?token= query param (Auth0 JWT). Rooms keyed by venue_id.',
                  code: "// Client subscribes:\n{ type: 'subscribe', venue_id: '<uuid>' }\n\n// Server pushes after mutations:\n{ type: 'booking.created' | 'booking.updated', booking: { ... } }",
                },
                {
                  name: 'BullMQ queues',
                  path: 'src/jobs/queues.js',
                  desc: 'Two Redis-backed queues: notificationQueue → email confirmation / cancellation jobs. holdSweepQueue → fallback cleanup for holds not released via DELETE /holds/:id.',
                  code: null,
                },
                {
                  name: 'DB helpers',
                  path: 'src/config/db.js',
                  desc: 'Core database abstraction. Handle carefully.',
                  code: "// withTenant — transaction with RLS context\nawait withTenant(tenantId, async tx => {\n  const [row] = await tx`SELECT * FROM bookings WHERE id = ${id}`\n  return row\n})\n\n// withTx — plain transaction, no tenant context\nawait withTx(async tx => {\n  const [t] = await tx`SELECT id FROM tenants WHERE slug = ${slug}`\n  return t\n})",
                },
              ].map(item => (
                <div key={item.name} className="border rounded-lg p-4">
                  <div className="flex flex-wrap items-baseline gap-2 mb-1">
                    <span className="font-semibold text-sm">{item.name}</span>
                    <code className="text-xs text-muted-foreground">{item.path}</code>
                  </div>
                  <p className="text-sm text-muted-foreground mb-3">{item.desc}</p>
                  {item.code && <Code>{item.code}</Code>}
                </div>
              ))}
            </div>
          </section>

          {/* ── DATA FLOWS ────────────────────────────────── */}
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

── Payment flow (deposit venues) ──────────────────────────
  → POST /payments/intent → Stripe PaymentIntent created
  → Guest completes 3DS / card in widget
  → Stripe fires webhook → POST /payments/webhook
      confirm_hold(hold_id, tenant_id)
        → SELECT ... FOR UPDATE NOWAIT   (second race guard)
        → INSERT bookings  (copies combination_id + guest_notes from hold)
        → DELETE booking_holds
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
  5. Return: { slot_time, available, table_id, combination_id }`}</Code>

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
                ['Normal booking card', '1', 'CSS .timeline-slot default'],
                ['Spanning combo card', '5', 'Inline override — above row borders'],
                ['Canvas with spanning card', '3', 'Creates stacking context above subsequent rows'],
                ['Sticky label column', '10', 'Always above all booking cards'],
                ['Sticky header row', '12', 'Topmost sticky element'],
                ['DragOverlay ghost', '999', 'Portal-rendered — always on top of everything'],
              ]}
            />

            <InfoBox type="warn">
              Bookings only become permanent via the Stripe webhook.
              Never trust client-side payment confirmation. <Mono>confirm_hold()</Mono> uses{' '}
              <Mono>FOR UPDATE NOWAIT</Mono> to prevent double-booking under concurrent requests.
            </InfoBox>
          </section>

          {/* ── DEPLOYMENT ────────────────────────────────── */}
          <section id="deployment" data-doc="">
            <H2>Deployment</H2>
            <H3>Environment variables</H3>
            <DataTable
              head={['Variable', 'App', 'Description']}
              rows={[
                ['DATABASE_URL', 'API', 'postgres.js connection string (set by setup.sh)'],
                ['REDIS_URL', 'API', 'BullMQ + hold sweep. Update password to match Redis config.'],
                ['AUTH0_DOMAIN', 'API + Admin', 'Auth0 tenant domain'],
                ['AUTH0_AUDIENCE', 'API', 'JWT audience identifier'],
                ['STRIPE_SECRET_KEY', 'API', 'Stripe secret key'],
                ['STRIPE_WEBHOOK_SECRET', 'API', 'Stripe webhook signing secret (whsec_...)'],
                ['VITE_AUTH0_DOMAIN', 'Admin', 'Auth0 domain for SPA login'],
                ['VITE_AUTH0_CLIENT_ID', 'Admin', 'Auth0 SPA client ID'],
                ['VITE_AUTH0_AUDIENCE', 'Admin', 'JWT audience (same as API)'],
              ]}
            />
            <H3>Running locally</H3>
            <Code>{`# Prerequisites: Postgres 16, Redis 7, Node 22

# Apply migrations in order
psql $DATABASE_URL -f migrations/001_tenants_users.sql
# ... through 015_fix_get_available_slots.sql

# API
cd api && cp .env.example .env   # fill in values
npm install && npm run dev        # :3000 with --watch

# Admin portal (separate terminal)
cd admin && cp .env.example .env  # fill in VITE_ values
npm install && npm run dev        # :5173, proxies /api → :3000`}</Code>
            <H3>Production deploy</H3>
            <Code>{`bash setup.sh    # first time only — installs Node, Redis, Postgres, Nginx, PM2
bash deploy.sh   # subsequent — git pull, npm ci, pm2 reload api`}</Code>
            <InfoBox type="info">
              <Mono>setup.sh</Mono> provisions a fresh Ubuntu 24.04 Lightsail instance from scratch.
              Run it once. Use <Mono>deploy.sh</Mono> for all subsequent updates.
            </InfoBox>
          </section>

        </div>
      </main>
    </div>
  )
}

// ── Shared primitives ─────────────────────────────────────────

function H2({ children }) {
  return <h2 className="text-xl font-bold mb-4 pb-2 border-b">{children}</h2>
}
function H3({ children, className }) {
  return <h3 className={cn('text-base font-semibold mt-6 mb-3', className)}>{children}</h3>
}
function P({ children }) {
  return <p className="text-sm text-muted-foreground leading-relaxed mb-3">{children}</p>
}
function Mono({ children }) {
  return <code className="bg-muted px-1 py-0.5 rounded text-xs font-mono">{children}</code>
}
function Code({ children }) {
  return (
    <pre className="bg-gray-900 text-green-300 text-xs rounded-lg p-4 overflow-x-auto mb-4 leading-relaxed whitespace-pre">
      {children}
    </pre>
  )
}
function DataTable({ head, rows }) {
  return (
    <div className="overflow-x-auto mb-4 rounded-lg border">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-muted">
            {head.map(h => (
              <th key={h} className="text-left px-3 py-2 font-semibold text-muted-foreground border-b">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className={i % 2 === 1 ? 'bg-muted/20' : ''}>
              {row.map((cell, j) => (
                <td key={j} className="px-3 py-2 border-b border-border/50 text-muted-foreground align-top">
                  {j === 0 ? <code className="font-semibold text-foreground text-xs">{cell}</code> : cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
function InfoBox({ type = 'info', children }) {
  const s = {
    info: 'bg-blue-50 border-blue-200 text-blue-900',
    warn: 'bg-amber-50 border-amber-200 text-amber-900',
    tip:  'bg-green-50 border-green-200 text-green-900',
  }
  const icons = { info: 'ℹ️', warn: '⚠️', tip: '💡' }
  return (
    <div className={cn('border rounded-lg p-3 text-sm flex gap-2 mb-4', s[type])}>
      <span className="shrink-0 mt-0.5">{icons[type]}</span>
      <span>{children}</span>
    </div>
  )
}
