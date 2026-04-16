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
  { id: 'customers',    label: 'Customers & GDPR' },
  { id: 'website-cms',  label: 'Website CMS' },
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
├── migrations/   PostgreSQL migration files (001–021, run in order)
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
                ['Timeline', '/timeline', 'Gantt view. Drag-to-reschedule, drag-to-relocate, resize, canvas click → ManualAllocModal. Grey columns = closed or cap=0. Red current-time line (today only). FAB (+ button) bottom-right for new bookings. Two tile modes: compact (configurable S/M/L row height, 3px inner padding) and extensive (3-line). Hour column width: 80 px (standard) or 120 px (wide). Session-start lines: one per sitting (sessionStartXs array), configurable colour, toggleable. Header shading: closed-area background optionally extended to the hours header row. Per-sitting stats bar in top bar (hidden on mobile): shows count, covers, and name per sitting with at least one active booking. Overlap detection: ⛔ badge + red ring-2 ring-red-500 ring-inset on tiles that share a table at the same time (overlappingIds useMemo, frontend-only). Date displayed as full weekday + date (EEEE d MMMM yyyy) via styled button with invisible <input type="date"> overlay. All controlled via TimelineSettingsContext + SettingsContext.'],
                ['Bookings', '/bookings', 'Guestplan-style time-grouped list. Per-sitting stats bar in top bar (hidden on mobile, mirrors Timeline stats). Date displayed as full weekday + date (EEEE d MMMM yyyy) via styled button with invisible date input overlay. Inline status change. Phone visible. Permanent resizable right panel (BookingDrawer inlineMode).'],
                ['Customers', '/customers', 'Customer profiles. Search by name/email/phone. GDPR anonymise and export. Auto-populated from booking confirms.'],
                ['Venues', '/venues', 'Create and manage restaurant locations.'],
                ['Tables', '/tables', 'Add tables, define sections, create combinations, set sort order, manage disallowed pairs.'],
                ['Schedule', '/schedule', 'Weekly template sittings, slot caps, date overrides, schedule exceptions.'],
                ['Rules', '/rules', 'Booking window, covers limits, hold TTL, smart allocation flags, deposit config, unconfirmed/reconfirmed flow toggles, opening hours enforcement.'],
                ['Settings', '/settings', 'Appearance: theme colour, per-status booking colours (9 statuses, CSS custom properties), timeline background colour, closed-area shading colour, opening hour line (toggle + colour), shade header row toggle, sidebar expanded by default (sidebarExpandedDefault). Timeline defaults: tile mode, compact font size, wide columns toggle, panel mode, section dividers, hide inactive, timeline start/end hour range. All persisted to localStorage.'],
                ['Team', '/team', 'Invite staff via Auth0 Management API (in development).'],
                ['Widget test', '/widget-test', 'Runs the full guest booking flow in the portal for testing.'],
                ['Documentation', '/docs', 'This page.'],
                ['Help', '/help', 'Operator user guide.'],
              ]}
            />

            <H3>New booking — FAB &amp; two paths</H3>
            <P>
              A round <strong>floating action button (FAB)</strong> sits at the bottom-right of the Timeline canvas
              (<Mono>absolute bottom-6 right-6</Mono>). Tapping it opens the new booking modal.
              Clicking an empty canvas cell opens <strong>ManualAllocModal</strong> directly with that time and table
              pre-populated. There are two paths through the modal:
            </P>
            <DataTable
              head={['Path', 'How to trigger', 'Behaviour']}
              rows={[
                ['Automatic allocation', 'Select a slot → Continue', 'Slot resolver assigns the best available table/combination. Obeys all schedule, capacity, and booking-window rules.'],
                ['Manual allocation', 'Click "Manual allocation" button', 'Opens ManualAllocModal. Admin freely picks date, time, and any table(s) — or Unallocated. No schedule or capacity checks. POST /bookings/admin-override.'],
                ['Walk In', 'Click "Walk In" button in guest step', 'Skips all guest details. Books immediately as "Walk In". No email sent. Useful for same-day walk-up guests.'],
              ]}
            />
            <InfoBox type="warn">
              Manual allocation bypasses all rules. Use it for walk-ins, VIP overrides, or bookings outside normal hours.
              The booking is still broadcast to all timeline clients via WebSocket.
            </InfoBox>

            <H3>Customer search in booking modal</H3>
            <P>
              When the admin reaches the guest details step, typing in the name, email, or phone field
              triggers a debounced search against the customer database (<Mono>GET /customers?q=</Mono>).
              If matching records are found, a suggestions panel appears to the right of the modal. Clicking
              a suggestion pre-fills all three fields. The customer database is populated automatically — a
              customer record is upserted on every booking confirmation.
            </P>

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
              stays white so operators can see the time is structurally open even though capacity is used up.
            </P>

            <H3>Booking statuses</H3>
            <DataTable
              head={['Status', 'Colour', 'Meaning']}
              rows={[
                ['unconfirmed', 'Orange (#fed7aa / #f97316)', 'Guest booked online; venue must call to confirm (enable_unconfirmed_flow).'],
                ['confirmed', 'Blue (#bfdbfe / #3b82f6)', 'Booking confirmed.'],
                ['reconfirmed', 'Indigo (#c7d2fe / #6366f1)', 'Operator has called and re-confirmed (enable_reconfirmed_status).'],
                ['pending_payment', 'Amber (#fde68a / #d97706)', 'Hold awaiting Stripe payment. Set by webhook — not manually selectable.'],
                ['arrived', 'Cyan (#a5f3fc / #0891b2)', 'Guest has arrived at the venue.'],
                ['seated', 'Green (#86efac / #16a34a)', 'Guest is seated at their table.'],
                ['checked_out', 'Grey (#e5e7eb / #9ca3af)', 'Guest has left. Excluded from capacity (same as cancelled / no_show).'],
                ['cancelled', 'Red (#fca5a5 / #ef4444, opacity 0.45)', 'Booking cancelled. Excluded from capacity.'],
                ['no_show', 'Grey (#d1d5db / #9ca3af, opacity 0.45)', 'Guest did not arrive. Excluded from capacity.'],
              ]}
            />

            <H3>Timeline current-time indicator</H3>
            <P>
              When viewing today's date, a red vertical line spans all table rows at the current time.
              A dot and time label appear in the header bar above the line. The position updates every 30 seconds.
              The indicator is hidden when viewing any date other than today.
            </P>

            <H3>Timeline sidebar controls</H3>
            <P>
              All Timeline view controls live in the <strong>AppShell sidebar</strong> above the logout button,
              only visible when the current route is <Mono>/timeline</Mono>. Controls:
            </P>
            <DataTable
              head={['Control', 'Description']}
              rows={[
                ['Venue selector', 'Shown only when the tenant has more than one venue. Stored in TimelineSettingsContext (venueId).'],
                ['Inactive toggle', 'Hides cancelled/no-show/checked-out bookings from the canvas. Persisted to localStorage.'],
                ['Sections toggle', 'Shows/hides section divider rows between table groups. Persisted to localStorage.'],
                ['Panel toggle', 'Switches BookingDrawer between docked right-panel mode and overlay mode. Persisted to localStorage.'],
                ['Refresh button', 'Triggers an immediate refetch of bookings for the current date.'],
                ['Fullscreen button', 'Calls document.documentElement.requestFullscreen() / exitFullscreen(). Icon updates on fullscreenchange event.'],
              ]}
            />

            <H3>Settings page</H3>
            <P>
              Route <Mono>/settings</Mono>. All values persist across sessions via localStorage.
            </P>
            <DataTable
              head={['Setting group', 'Storage', 'Details']}
              rows={[
                ['Theme colour', 'maca_settings (SettingsContext)', 'Hex → HSL conversion writes --primary / --primary-foreground CSS vars on :root. Foreground auto-chosen by relative luminance.'],
                ['Booking status colours', 'maca_settings (SettingsContext)', '9 statuses. Each stores a bg hex. Border auto-derived via deriveBorderFromBg() (HSL lightness −30pp). Written as --status-{name}-bg/bd CSS custom properties. applyStatusColours() called on mount + on every change.'],
                ['Timeline background colour', 'maca_settings (SettingsContext)', 'Applied as backgroundColor on the Timeline rows wrapper div. Default #ffffff.'],
                ['Closed/unavailable area colour', 'maca_settings (SettingsContext)', 'Applied at 38% opacity via hexToRgba() inside the greyBackground CSS linear-gradient. Default #8c8c8c.'],
                ['Default tile mode', 'maca_timeline_prefs (TimelineSettingsContext)', "'compact' | 'extensive'. Compact = single-row tile with configurable font size. Extensive = 3-line tile (name+covers, phone, table). Row height: compact sm=36, md=44, lg=52; extensive=72."],
                ['Compact tile size', 'maca_timeline_prefs (TimelineSettingsContext)', "'sm' | 'md' | 'lg'. Only applies in compact mode. Controls font sizes and row height via ROW_HEIGHT_MAP."],
                ['Wide time columns', 'maca_timeline_prefs (TimelineSettingsContext)', 'Boolean. hourWidth = wideColumns ? 120 : 80. All pixel calculations (timeToX, durationToWidth, sittingTimeToX, canvas width, drag/resize deltas) use hourWidth at runtime.'],
                ['Side panel mode', 'maca_timeline_prefs (TimelineSettingsContext)', 'BookingDrawer rendered as docked panel (inlineMode) vs floating overlay.'],
                ['Section dividers', 'maca_timeline_prefs (TimelineSettingsContext)', 'Show/hide section label rows in Timeline.'],
                ['Hide inactive', 'maca_timeline_prefs (TimelineSettingsContext)', 'Filter out cancelled/no_show/checked_out bookings from canvas.'],
                ['Opening hour line (showStartLine)', 'maca_settings (SettingsContext)', 'Boolean toggle. When true, a 3px vertical line is rendered at firstOpenX + LABEL_WIDTH as a position:absolute full-height overlay on the Timeline wrapper div (z=2, pointer-events:none). Colour configurable via startLineColour. Default: enabled, colour #630812.'],
                ['Opening hour line colour (startLineColour)', 'maca_settings (SettingsContext)', 'Hex colour for the opening hour line. Applied as backgroundColor on the overlay div. Default #630812 (matches theme default).'],
                ['Shade header row (headerBgStrips)', 'maca_settings (SettingsContext)', 'Boolean toggle. When true, backgroundStyle (closed-area grey + diagonal stripe CSS backgrounds) is also applied to the TimelineHeader outer div via inline style, replacing bg-background. Sticky label cell keeps its own bg-background. Default: false.'],
                ['Sidebar expanded by default (sidebarExpandedDefault)', 'maca_settings (SettingsContext)', 'Boolean (default true). Controls the initial open state of the AppShell sidebar on desktop. Mobile always starts collapsed regardless. Applied as the initial value of the useState in AppShell — subsequent manual toggles work normally per-session.'],
                ['Timeline start hour (timelineStart)', 'maca_timeline_prefs (TimelineSettingsContext)', 'Integer hour (0–23, default 9). Combined with timelineEnd to derive startHour, endHour, totalHours in Timeline component. All pixel calculations (timeToX, sittingTimeToX, nowX, grey strips, drag/resize) use startHour instead of the module constant START_HOUR. Settings → Timeline defaults shows hour dropdowns.'],
                ['Timeline end hour (timelineEnd)', 'maca_timeline_prefs (TimelineSettingsContext)', 'Integer hour (1–24, default 24). Combined with timelineStart to determine totalHours = endHour − startHour. Drives canvas totalWidth = totalHours * hourWidth. TimelineHeader renders totalHours column labels starting at startHour.'],
              ]}
            />
            <H3>sessionStartXs computation</H3>
            <P>
              <Mono>sessionStartXs</Mono> is a useMemo in Timeline.jsx that returns an array of canvas
              x-pixel positions — one per sitting — at each sitting's <Mono>opens_at</Mono> time for
              the selected date. Replaces the former scalar <Mono>firstOpenX</Mono>. A 3px vertical
              line is rendered for each entry so venues with both lunch and dinner sessions each get
              their own opening-hour line. Depends on <Mono>[sittingsForDate, hourWidth, startHour]</Mono>.
            </P>
            <H3>ColourPickerRow sync pattern</H3>
            <P>
              <Mono>ColourPickerRow</Mono> uses local <Mono>hexInput</Mono> state for the colour wheel and hex input.
              A <Mono>useEffect(() =&gt; setHexInput(value), [value])</Mono> syncs it whenever the context value
              changes externally (e.g. clicking a swatch button rendered outside the component).
              Without this, external swatch clicks update the context but the picker circle shows the stale colour.
            </P>

            <H3>startHour threading in Timeline</H3>
            <P>
              <Mono>startHour</Mono> and <Mono>endHour</Mono> are derived from{' '}
              <Mono>TimelineSettingsContext.timelineStart/timelineEnd</Mono> in the Timeline component.
              They replace the module-level constants <Mono>START_HOUR</Mono> and <Mono>END_HOUR</Mono>{' '}
              in all runtime calculations. Both <Mono>timeToX(iso, hw, sh)</Mono> and{' '}
              <Mono>sittingTimeToX(t, hw, sh)</Mono> accept <Mono>sh</Mono> as a third optional param
              (defaults to <Mono>START_HOUR</Mono>). <Mono>startHour</Mono> is passed as a prop to{' '}
              <Mono>TableRow</Mono>, <Mono>BookingCard</Mono>, and <Mono>TimelineHeader</Mono> — the same
              threading pattern as <Mono>hourWidth</Mono>. All useMemos that call these functions include{' '}
              <Mono>startHour</Mono> in their dep arrays.
            </P>

            <H3>Session names on sittings</H3>
            <P>
              Migration <Mono>023_sitting_names.sql</Mono> adds a nullable <Mono>name text</Mono> column
              to <Mono>venue_sittings</Mono>, <Mono>override_sittings</Mono>, and{' '}
              <Mono>exception_sittings</Mono>. Set via the Schedule page sitting editor.
              Returned by <Mono>sittings-for-date</Mono> and all schedule GET endpoints.
              Frontend always falls back to the time-range string when name is null:{' '}
              <Mono>sitting.name ?? `{'${sitting.opens_at.slice(0,5)}–${sitting.closes_at.slice(0,5)}'}`</Mono>.
            </P>

            <H3>Per-sitting stats bar</H3>
            <P>
              <Mono>sittingStats</Mono> useMemo in <Mono>Timeline.jsx</Mono> (and a parallel pattern in{' '}
              <Mono>Bookings.jsx</Mono>) maps active bookings to their sitting by comparing the booking's
              local-time HH:MM string against each sitting's <Mono>opens_at</Mono>/<Mono>closes_at</Mono>.
              Returns <Mono>{'{ totalCount, totalCovers, bySitting }'}</Mono>.
              Rendered as a <Mono>hidden sm:flex</Mono> row in the top bar alongside the date navigator.
              Only sittings with at least one active booking are shown.
            </P>
            <InfoBox type="warn">
              The HH:MM comparison uses <Mono>new Date(b.starts_at).getHours()</Mono> (local browser time).
              If the server timezone differs from the browser, bookings near sitting boundaries may be
              assigned to the wrong sitting in the stats display. This is cosmetic — no business logic depends on it.
            </InfoBox>

            <H3>Overlap detection</H3>
            <P>
              <Mono>overlappingIds</Mono> useMemo performs an O(n²) pairwise scan of all active bookings.
              Two bookings overlap when they share at least one table (checking both{' '}
              <Mono>member_table_ids</Mono> and <Mono>table_id</Mono>) and their time windows intersect
              (<Mono>aStart {'<'} bEnd && bStart {'<'} aEnd</Mono>).
              Overlapping tiles receive a red <Mono>ring-2 ring-red-500 ring-inset</Mono> border and a{' '}
              <Mono>⛔</Mono> badge in the top-right corner.
              Detection is frontend-only — it operates on the in-memory <Mono>bookingsRes</Mono> array
              and does not call the API.
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
                ['venue_sittings', 'Sitting within a weekly template day. name column (nullable) holds an optional session label (e.g. "Lunch", "Dinner") added in migration 023_sitting_names.sql.', 'template_id, opens_at, closes_at, default_max_covers, doors_close_time, sort_order, name text nullable'],
                ['override_sittings', 'Sitting for a specific date override. Also has name (nullable) from migration 023.', 'override_id, opens_at, closes_at, default_max_covers, doors_close_time, sort_order, name text nullable'],
                ['schedule_overrides', 'Replaces sittings for a specific date (bank holidays, closures).', 'venue_id, override_date, is_closed'],
                ['slot_caps', 'Per-slot cover cap overrides. Sparse — only stored when different from sitting default.', 'sitting_id, slot_time, max_covers'],
                ['schedule_exceptions', 'Named date-range exception with optional alternative weekly schedule. is_closed=true closes the period entirely.', 'venue_id, name, date_from, date_to, is_closed, priority'],
                ['exception_day_templates', 'Per-DOW schedule within an exception. Overrides weekly template for that day.', 'exception_id, day_of_week, is_open, slot_interval_mins'],
                ['exception_sittings', 'Sittings for an exception day template. Also has name (nullable) from migration 023.', 'template_id, opens_at, closes_at, default_max_covers, doors_close_time, sort_order, name text nullable'],
                ['exception_sitting_slot_caps', 'Sparse per-slot cover cap overrides within exception sittings.', 'sitting_id, slot_time, max_covers'],
                ['booking_rules', 'Per-venue booking constraints. Smart-allocation flags, status-flow toggles (unconfirmed, reconfirmed, arrived).', 'venue_id, hold_ttl_secs, min_covers, max_covers, cutoff_before_mins, slot_duration_mins, allow_cross_section_combo, allow_non_adjacent_combo, allow_widget_bookings_after_doors_close, enable_unconfirmed_flow, enable_reconfirmed_status, enable_arrived_status'],
                ['deposit_rules', 'Per-venue deposit configuration.', 'venue_id, requires_deposit, amount_pence, stripe_account_id'],
                ['booking_holds', 'Temporary slot reservations. UNIQUE (table_id, starts_at).', 'venue_id, table_id, combination_id, starts_at, ends_at, expires_at, guest_name, guest_email'],
                ['bookings', 'Confirmed bookings.', 'venue_id, table_id, combination_id, starts_at, ends_at, covers, status, reference, guest_name, guest_email, guest_phone, guest_notes, operator_notes, customer_id'],
                ['customers', 'Customer profiles with GDPR support. Auto-created on booking confirm. is_anonymised flag for GDPR erasure.', 'tenant_id, name, email, phone, notes, is_anonymised, anonymised_at, created_at'],
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
                ['GET | PATCH', '/:id/rules', 'any | admin', 'Get or update booking rules (includes allow_cross_section_combo, allow_non_adjacent_combo, enable_arrived_status flags)'],
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
                ['GET', '/sittings-for-date', 'any', 'Returns the resolved sittings for a specific date (applying exceptions → overrides → weekly template priority). Each sitting includes name (nullable) for use in the stats bar and Timeline session-start lines.'],
                ['PUT', '/template/:dow', 'admin', 'Upsert day template. Accepts is_open, slot_interval_mins, doors_close_time.'],
                ['POST', '/sittings', 'admin', 'Create sitting'],
                ['PATCH', '/sittings/:id', 'admin', 'Update sitting. Accepts name (nullable string) to set the session label shown in the stats bar and Timeline header.'],
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

            <H3>Customers — <span className="font-mono font-normal text-sm">/api/customers</span></H3>
            <DataTable
              head={['Method', 'Path', 'Min role', 'Description']}
              rows={[
                ['GET', '/', 'operator', 'Search customers by name/email/phone (?q=term). Returns 20 most-recent if q < 2 chars.'],
                ['GET', '/:id', 'operator', 'Customer detail including full booking history.'],
                ['PATCH', '/:id', 'operator', 'Update name, phone, or notes.'],
                ['POST', '/:id/anonymise', 'admin', 'GDPR erasure — replaces all PII with placeholders, anonymises linked bookings. Never deletes the row.'],
                ['GET', '/:id/export', 'admin', 'GDPR data export — returns a JSON file download with customer + all booking records.'],
              ]}
            />
          </section>

          {/* ── WEBSITE CMS ───────────────────────────────── */}
          <section id="website-cms" data-doc="">
            <H2>Website CMS</H2>
            <P>
              Multi-tenant website builder. Each tenant gets a branded public site served
              server-side by the Fastify API at <Mono>{'{slug}.macaroonie.com'}</Mono> or a
              verified custom domain. All content is tenant-scoped via the existing RLS model.
            </P>

            <H3>Database schema</H3>
            <P>Six tables introduced across migrations 025 + 026. All RLS-enabled:</P>
            <DataTable
              head={['Table', 'Purpose']}
              rows={[
                ['website_config',         'Singleton per tenant (UNIQUE tenant_id). 60+ columns covering identity, branding, hero, about, find-us, contact, social, ordering, delivery, SEO, analytics, feature toggles, + custom_domain, custom_domain_verified, template_key, theme (JSONB).'],
                ['website_opening_hours',  '7-day grid with multiple sessions per day (day_of_week, opens_at, closes_at, is_closed, label, sort_order).'],
                ['website_gallery_images', 'Ordered gallery images (image_url, caption, sort_order).'],
                ['website_pages',          'Custom CMS pages — UNIQUE (website_config_id, slug). Content is free HTML.'],
                ['website_menu_documents', 'PDF menu uploads with labels.'],
                ['website_allergen_info',  'Singleton per config; info_type = document | structured. Structured data is a JSONB array of {dish, allergens[], notes}.'],
              ]}
            />
            <InfoBox type="info">
              The subdomain slug is a <strong>global</strong> namespace (UNIQUE on
              website_config.subdomain_slug). Separate from tenants.slug (Auth0 lookup).
              Use <Mono>GET /api/website/slug-available?slug=...</Mono> before POSTing.
            </InfoBox>

            <H3>Theme JSONB shape</H3>
            <P>
              <Mono>website_config.theme</Mono> stores per-tenant styling. Any missing key
              falls back to defaults hard-coded in <Mono>views/site/shared/head.eta</Mono>.
            </P>
            <Code>{`{
  "colors":     { primary, accent, background, surface, text, muted, border },
  "typography": { heading_font, body_font, base_size_px, heading_scale,
                  heading_weight, body_weight, line_height, letter_spacing },
  "spacing":    { container_max_px, section_y_px, section_y_mobile_px, gap_px },
  "radii":      { sm_px, md_px, lg_px },
  "logo":       { height_px, show_name_beside },
  "buttons":    { radius_px, padding_y_px, padding_x_px, weight },
  "hero":       { overlay_opacity, min_height_px }
}`}</Code>
            <InfoBox type="warn">
              PATCH semantics are <strong>column overwrite</strong>, not deep-merge.
              The admin's ThemeSection holds the FULL merged theme in local state and PATCHes
              the whole object. Never PATCH a partial theme — missing keys become null.
            </InfoBox>

            <H3>API routes</H3>
            <DataTable
              head={['Method + Path', 'Auth', 'Purpose']}
              rows={[
                ['GET /api/website/config',             'auth',  'Fetch singleton config for the current tenant. Returns {} when no row exists yet.'],
                ['POST /api/website/config',            'admin', 'Create config row (first-time setup). Requires subdomain_slug.'],
                ['PATCH /api/website/config',           'admin', 'Partial update. Mutating custom_domain clears custom_domain_verified.'],
                ['GET /api/website/slug-available',     'auth',  'Global uniqueness check across ALL tenants. Does NOT use withTenant().'],
                ['POST /api/website/verify-domain',     'admin', 'DNS-resolves custom_domain, matches A records to APP_PUBLIC_IPS and/or CNAME suffix to PUBLIC_ROOT_DOMAIN. Updates the verified flag.'],
                ['GET/POST/PATCH/DELETE /api/website/gallery',    'auth/admin', 'Gallery CRUD + /gallery/reorder.'],
                ['GET/POST/PATCH/DELETE /api/website/pages',      'auth/admin', 'Custom pages CRUD.'],
                ['GET/POST/DELETE /api/website/menus',            'auth/admin', 'PDF menu docs CRUD.'],
                ['GET/POST /api/website/opening-hours',           'auth/admin', 'Bulk upsert (POST replaces the whole set).'],
                ['GET/POST /api/website/allergens',                'auth/admin', 'Upsert allergen info (document or structured).'],
                ['POST /api/website/upload',            'admin', 'multipart/form-data. Fields: file, kind (images | menus | docs). Delegates to storageSvc.'],
                ['GET /api/site/:slug',                 'public', 'Full site bundle (JSON). 404 when not published. Short cache headers.'],
                ['GET /api/site/:slug/sitemap.xml',     'public', 'Dynamic sitemap.'],
                ['GET /api/site/:slug/robots.txt',      'public', 'robots.txt pointing at the sitemap.'],
              ]}
            />

            <H3>SSR renderer &amp; templates</H3>
            <P>
              <Mono>src/routes/siteRenderer.js</Mono> activates on requests whose Host header
              matches <em>either</em> <Mono>{'{slug}.{PUBLIC_ROOT_DOMAIN}'}</Mono> with a
              non-reserved slug, <em>or</em> a verified <Mono>custom_domain</Mono>. Everything
              else falls through to <Mono>/api/*</Mono>.
            </P>
            <Code>{`// host resolution
resolveSiteHost(host) → { slug, customDomain } | null

// reserved subdomains bypass the renderer entirely
www, api, admin, app, mail, static, assets, cdn, ws,
stripe, webhook, webhooks

// routes (relative to the matched host)
GET /                  → site/templates/{template_key}/index.eta
GET /menu              → templates/{key}/menu.eta   (list)
GET /menu/:id          → templates/{key}/menu.eta   (active PDF)
GET /p/:pageSlug       → templates/{key}/page.eta
GET /sitemap.xml
GET /robots.txt`}</Code>

            <H3>Template &amp; theme structure</H3>
            <Code>{`api/src/views/site/
├── shared/
│   └── head.eta            ← converts theme JSONB → CSS vars
├── not-found.eta            ← 404 for missing / unpublished sites
└── templates/
    ├── classic/             ← warm, traditional layout
    │   ├── index.eta  menu.eta  page.eta
    │   └── partials/{header,footer}.eta
    └── modern/              ← full-bleed editorial layout
        ├── index.eta  menu.eta  page.eta
        └── partials/{header,footer}.eta`}</Code>
            <P>
              Both templates consume the same CSS custom properties
              (<Mono>--c-*</Mono> colours, <Mono>--f-*</Mono> fonts, <Mono>--r-*</Mono> radii,
              etc.) emitted by <Mono>shared/head.eta</Mono>. A theme change applies regardless
              of which template the tenant picks.
            </P>
            <InfoBox type="tip">
              To add a new theme knob: update <Mono>ThemeSchema</Mono> in
              <Mono>routes/website.js</Mono>, the <Mono>DEFAULT_THEME</Mono> constant in
              <Mono>admin/src/pages/Website.jsx</Mono>, and the CSS-variable block in
              <Mono>shared/head.eta</Mono> together.
            </InfoBox>

            <H3>Pluggable storage</H3>
            <P>
              <Mono>src/services/storageSvc.js</Mono> exposes a single{' '}
              <Mono>getStorage().put(tenantId, kind, ext, mimetype, buffer)</Mono> contract.
              Driver is selected via <Mono>STORAGE_DRIVER</Mono> env var.
            </P>
            <DataTable
              head={['Driver', 'Behaviour', 'Env vars']}
              rows={[
                ['local (default)', 'Writes to UPLOAD_DIR. Served at /uploads/* by @fastify/static.', 'UPLOAD_DIR'],
                ['s3',              'Writes to any S3-compatible bucket. Lazy-imports @aws-sdk/client-s3 (optionalDependencies).', 'S3_BUCKET, S3_REGION, S3_ENDPOINT (opt., DO Spaces / R2), S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_PUBLIC_URL_BASE, S3_FORCE_PATH_STYLE'],
              ]}
            />
            <InfoBox type="warn">
              Switching driver mid-flight <strong>orphans existing upload URLs</strong>.
              Migrate files between backends first if needed.
            </InfoBox>

            <H3>Admin page</H3>
            <P>
              <Mono>admin/src/pages/Website.jsx</Mono> at the <Mono>/website</Mono> route.
              Left-rail nav with 18 sections. First-time tenants see an onboarding card that
              POSTs a subdomain slug to create the config row.
            </P>
            <P>Shared primitives in the same file:</P>
            <ul className="list-disc ml-5 space-y-1 text-sm text-muted-foreground mb-4">
              <li><Mono>SectionCard</Mono>, <Mono>FormRow</Mono>, <Mono>Toggle</Mono>, <Mono>SaveBar</Mono> — layout</li>
              <li><Mono>FileUpload</Mono>, <Mono>ImageField</Mono> — wrap <Mono>api.upload()</Mono></li>
              <li><Mono>useConfigFields(config, fields)</Mono> — hook used by simple sections to stage edits and PATCH a subset of config fields on save</li>
              <li>
                Gallery uses <Mono>@dnd-kit/sortable</Mono> (new dep). Touch-drag requires a
                200ms delay to avoid conflict with page scroll.
              </li>
            </ul>

            <H3>Custom domain lifecycle</H3>
            <Code>{`1. Tenant sets website_config.custom_domain via PATCH
   → custom_domain_verified auto-set to false by the server.
2. Tenant configures DNS:
     CNAME @ → macaroonie.com     (preferred)
     OR
     A     @ → <APP_PUBLIC_IP>    (requires APP_PUBLIC_IPS env set)
3. Tenant clicks "Verify DNS" in admin
   → POST /api/website/verify-domain
   → Node resolves A + CNAME records, compares to expected values.
   → On match, sets custom_domain_verified = true.
4. Out-of-band: SSL cert provisioned (Nginx + certbot,
   Caddy on-demand TLS, etc). The app does NOT provision certs.
5. Site is now reachable at the custom domain. siteRenderer
   matches the Host header to website_config.custom_domain.`}</Code>

            <H3>Deployment follow-ups</H3>
            <ul className="list-disc ml-5 space-y-1.5 text-sm text-muted-foreground mb-4">
              <li>Nginx: wildcard server block for <Mono>*.macaroonie.com</Mono> proxying to the API.</li>
              <li>DNS: wildcard A record for <Mono>*.macaroonie.com</Mono> → app IP.</li>
              <li>SSL: wildcard cert via Certbot DNS-01 (requires DNS at Cloudflare/Route53/etc).</li>
              <li>Migrations 025 + 026 are auto-applied by the deploy workflow — see the Deployment section below.</li>
              <li>Set <Mono>APP_PUBLIC_IPS=1.2.3.4,5.6.7.8</Mono> env var for the verify-domain endpoint to accept A-record matches.</li>
            </ul>
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
  5. Return per-slot: {
       slot_time, available, available_covers, reason,
       table_id, combination_id,
       sitting_closes_at,   ← last order time for this sitting
       sitting_doors_close  ← doors close time (nullable)
     }

Note: a slot is generated if slot_time < closes_at, even if
slot_time + duration would run past closes_at. The frontend
shows a warning in the booking modal when the booking end
time would exceed sitting_closes_at or sitting_doors_close.`}</Code>

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
                ['Session-start line overlays', '2', 'One position:absolute full-height div per sitting at LABEL_WIDTH + x (from sessionStartXs array). pointer-events:none. Renders behind booking cards. TimelineHeader renders matching lines inside its canvas div when headerBgStrips is on.'],
                ['Overlap stop-sign badge', '10 (within tile)', 'position:absolute span inside BookingCard. Rendered when overlappingIds.has(booking.id). Tile also gets ring-2 ring-red-500 ring-inset. Detection is frontend-only — computed from bookingsRes in-memory array.'],
                ['Normal booking card', '1', 'CSS .timeline-slot default'],
                ['Spanning combo card', '5', 'Inline override — above row borders'],
                ['Canvas with spanning card', '3', 'Creates stacking context above subsequent rows'],
                ['Secondary combo row canvas', '4 + pointer-events:none', 'Paints gradient background above primary z=3; transparent holes let spanning card show through; pointer-events:none passes click/drag to primary card'],
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

# Apply migrations in order (001 → 023)
psql $DATABASE_URL -f migrations/001_tenants_users.sql
psql $DATABASE_URL -f migrations/002_venues.sql
psql $DATABASE_URL -f migrations/003_schedules.sql
psql $DATABASE_URL -f migrations/004_booking_rules.sql
psql $DATABASE_URL -f migrations/005_bookings.sql
psql $DATABASE_URL -f migrations/006_functions.sql
psql $DATABASE_URL -f migrations/007_seed_example.sql
psql $DATABASE_URL -f migrations/008_table_combinations.sql
psql $DATABASE_URL -f migrations/009_unallocated.sql
psql $DATABASE_URL -f migrations/010_allocation_rules.sql
psql $DATABASE_URL -f migrations/011_doors_close_time.sql
psql $DATABASE_URL -f migrations/012_reconfirmed_status.sql
psql $DATABASE_URL -f migrations/013_doors_close_per_sitting.sql
psql $DATABASE_URL -f migrations/014_schedule_exceptions.sql
psql $DATABASE_URL -f migrations/015_fix_get_available_slots.sql
psql $DATABASE_URL -f migrations/016_noslot_noshow_cancelled.sql
psql $DATABASE_URL -f migrations/017_seated_checked_out.sql
psql $DATABASE_URL -f migrations/018_customers.sql
psql $DATABASE_URL -f migrations/019_customer_visit_count.sql
psql $DATABASE_URL -f migrations/020_slot_start_filter.sql
psql $DATABASE_URL -f migrations/021_enable_arrived_status.sql
psql $DATABASE_URL -f migrations/022_slot_inclusive_last_order.sql
psql $DATABASE_URL -f migrations/023_sitting_names.sql

# API
cd api && cp .env.example .env   # fill in values
npm install && npm run dev        # :3000 with --watch

# Admin portal (separate terminal)
cd admin && cp .env.example .env  # fill in VITE_ values
npm install && npm run dev        # :5173, proxies /api → :3000`}</Code>
            <H3>Production deploy</H3>
            <P>
              Deployment is automated via <strong>GitHub Actions</strong> on every push. To deploy: run{' '}
              <Mono>git push</Mono> from the local laptop — the Actions workflow builds and restarts the
              API and admin portal automatically.
            </P>
            <InfoBox type="tip">
              Migrations are <strong>applied automatically</strong> by the deploy workflow
              via <Mono>api/scripts/migrate.js</Mono>. The runner tracks applied files in a
              <Mono>schema_migrations</Mono> table and only applies new ones — each in its
              own transaction. A failing migration aborts the deploy before the API restarts.
            </InfoBox>
            <H3>Migration runner</H3>
            <P>
              <Mono>api/scripts/migrate.js</Mono> is idempotent. Flags:
            </P>
            <DataTable
              head={['Flag / env', 'Effect']}
              rows={[
                ['--list',                  'Print applied/pending status for every file. No writes.'],
                ['--baseline',              'Mark ALL existing migration files as applied without running any SQL. Use once on a server whose schema was built manually.'],
                ['--baseline-up-to NNN',    'Same, but only mark files up to and including NNN.'],
                ['AUTO_BASELINE_UP_TO=NNN', 'Env var. On first run only (schema_migrations empty) AND with a pre-existing "tenants" table, auto-baseline up to NNN. No-op on every subsequent run. The deploy workflow sets this to 024 as a safety net for existing Lightsail deployments.'],
              ]}
            />
            <H3>Typical deployment flow</H3>
            <Code>{`# From the developer's laptop:
git push origin main
# The GitHub Actions workflow then:
#   1. SSH to Lightsail
#   2. git fetch + hard reset to origin/main
#   3. npm install (api)
#   4. node scripts/migrate.js   (auto-baselines then applies pending)
#   5. npm install + build (admin)
#   6. pm2 restart macaroonie-api
#   7. health check on /api/health`}</Code>
            <H3>First-time baselining</H3>
            <P>
              On a server whose schema was built with hand-run <Mono>psql</Mono> before the
              runner existed, the auto-baseline env var handles this transparently — the first
              deploy populates <Mono>schema_migrations</Mono> with 001–024 and then applies 025
              onwards. You can also trigger this explicitly from the Actions UI:
            </P>
            <Code>{`# Option 1 — auto on next deploy (already wired in deploy.yml)
#   AUTO_BASELINE_UP_TO=024 is set by the workflow; nothing to do.

# Option 2 — manual (GitHub Actions UI)
#   Actions → "DB — baseline migration tracker" → Run workflow
#   up_to = 024 (default)

# Option 3 — via SSH
cd /home/ubuntu/app/api && set -a; source .env; set +a
node scripts/migrate.js --baseline-up-to 024`}</Code>
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
