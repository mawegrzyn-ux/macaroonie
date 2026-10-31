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
  { id: 'stored-keys', label: 'Stored keys' },
  { id: 'auth',         label: 'Authentication' },
  { id: 'team-platform', label: 'Team & Platform Admin' },
  { id: 'rbac',          label: 'RBAC: Modules & Roles' },
  { id: 'email-system',  label: 'Email System' },
  { id: 'database',     label: 'Database Schema' },
  { id: 'api',          label: 'API Reference' },
  { id: 'customers',    label: 'Customers & GDPR' },
  { id: 'cash-recon',   label: 'Cash Reconciliation' },
  { id: 'food-safety',  label: 'Food Safety Logs' },
  { id: 'checklists',   label: 'Checklists' },
  { id: 'dashboards', label: 'Dashboards (shared widgets)' },
  { id: 'hs-dashboard', label: 'H&S Dashboard' },
  { id: 'cash-dashboard', label: 'Cash Dashboard' },
  { id: 'staff-rota', label: 'Staff & Rota' },
  { id: 'mobile-app', label: 'Mobile App (/mobile)' },
  { id: 'hs-action-log', label: 'H&S Action Log' },
  { id: 'navigation',   label: 'Navigation & Launcher' },
  { id: 'overview-tiles', label: 'Overview Tiles' },
  { id: 'purchasing', label: 'Purchasing' },
  { id: 'pos', label: 'Till (POS)' },
  { id: 'kds', label: 'Kitchen screens (KDS)' },
  { id: 'kiosks', label: 'Self-order kiosks' },
  { id: 'kiosk-analytics', label: 'Kiosk analytics & journeys' },
  { id: 'installer', label: 'Installer app & link codes' },
  { id: 'android-app', label: 'Android app' },
  { id: 'web-ordering', label: 'Web Ordering' },
  { id: 'loyalty', label: 'Loyalty' },
  { id: 'ai-assistant', label: 'Pepper (AI assistant) & MCP' },
  { id: 'ops-today', label: 'Today (the ops front door)' },
  { id: 'store-openings', label: 'New locations (store openings)' },
  { id: 'menus',        label: 'Menus' },
  { id: 'combos',       label: 'Combos' },
  { id: 'tax',          label: 'Tax, Order Types & Streams' },
  { id: 'screens',      label: 'Menu Screens' },
  { id: 'website-cms',  label: 'Website CMS' },
  { id: 'media-library', label: 'Media Library' },
  { id: 'services',     label: 'Services & Jobs' },
  { id: 'data-flows',   label: 'Data Flows' },
  { id: 'test-data',    label: 'Test Data Tools' },
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
                ['Realtime', 'ws (WebSocket) + Redis pub/sub', 'Timeline, orders and till live updates; rooms keyed by venue_id, relayed between API processes through Redis'],
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
              Every tenant table has a <Mono>tenant_id uuid</Mono> column, row-level security enabled{' '}
              <strong>and forced</strong> (migration 176), and one policy:
            </P>
            <Code>{`USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
       OR current_setting('app.bypass_rls', true) = 'on')`}</Code>
            <P>
              The app&apos;s database role owns the tables, and a table&apos;s owner isn&apos;t held to RLS
              unless the table forces it: before 176 the policies stopped nothing. Now a query sees only the
              rows of its transaction&apos;s tenant, or every row in <strong>system mode</strong>, and a
              query with neither (one on the bare <Mono>sql</Mono> pool) sees no tenant rows and can&apos;t
              write one. <Mono>NULLIF</Mono> is there because a pooled connection that had the setting in an
              earlier transaction returns <Mono>&apos;&apos;</Mono>, not NULL. Superusers skip RLS even when
              forced: production connects as <Mono>macaroonie_user</Mono> (not a superuser, owner of the
              tables), and the tests and CI run as a role that isn&apos;t one either.
            </P>
            <DataTable
              head={['Helper (config/db.js)', 'Use it for']}
              rows={[
                ['withTenant(tenantId, fn)', 'Everything that knows its tenant (every admin route, req.tenantId): a transaction with app.tenant_id set (set_config(..., true), so it ends with the transaction).'],
                ['tenantSql(tenantId)`...`', 'One statement in a tenant\'s transaction, as a tagged template (same as withTenant(tenantId, tx => tx`...`)).'],
                ['systemSql / withSystem(fn)', 'A second, small pool (5 connections) whose connections start in system mode (app.bypass_rls = \'on\' as a connection startup parameter). Only for work that crosses tenants on purpose: finding the tenant from a token, slug, device, push address or id (public pages, widget, ordering, MCP, access tokens, devices, webhooks, memberships in auth.js); background jobs and sweeps; the platform pages. A system query still filters tenant_id where it can.'],
                ['sql', 'The main pool. No tenant rows: only for global tables (platform_admins, platform_secrets, platform_interest, backlog_items) or inside withTenant().'],
              ]}
            />
            <Code>{`// A route: the caller's tenant
const rows = await withTenant(req.tenantId, tx =>
  tx\`SELECT * FROM venues WHERE id = \${venueId} AND tenant_id = \${req.tenantId}\`
)

// Finding the tenant first (a push address, a slug): system mode
const [link] = await systemSql\`SELECT tenant_id, venue_id FROM gloriafood_venue_links WHERE push_token = \${token}\`

// WRONG: no tenant, no system mode -> 0 rows, silently
const rows = await sql\`SELECT * FROM venues WHERE id = \${venueId}\``}</Code>
            <InfoBox type="warn">
              RLS failures are <strong>silent</strong>: the query returns 0 rows (or an UPDATE changes
              none), not an error. A path that finds its tenant itself and forgot system mode simply finds
              nothing. <Mono>api/test/system-paths.test.mjs</Mono> covers every such path (public pages,
              widget, ordering, website, till and screen pairing, MCP and access tokens, memberships,
              GloriaFood push, the feature board, platform pages, background jobs).
            </InfoBox>
            <DataTable
              head={['Special case', 'Policy']}
              rows={[
                ['feature_requests, feature_request_upvotes', 'One board every tenant reads and upvotes: a read-all policy (board_read) beside the tenant one; writes are still per tenant.'],
                ['screen_pairings', 'An unclaimed pairing (tenant_id NULL) is any tenant\'s to find by its code; routes/screens.js claims it inside the claiming tenant\'s transaction.'],
                ['table_combination_members', 'No tenant_id: a row is visible when its combination is (EXISTS on table_combinations).'],
                ['sweep_expired_holds()', 'pg_cron calls it with no tenant: it switches system mode on for its DELETE and back (a function\'s SET clause can\'t name a custom setting without superuser).'],
                ['Global tables', 'platform_admins, platform_secrets, platform_interest, backlog_items, schema_migrations: no tenant_id, no RLS; access is gated in the API.'],
              ]}
            />
            <P>
              Migrations run in system mode (<Mono>scripts/migrate.js</Mono> connects with{' '}
              <Mono>app.bypass_rls = on</Mono>), so a data migration sees every tenant&apos;s rows. A new
              table with a <Mono>tenant_id</Mono> must enable and force RLS with the same{' '}
              <Mono>tenant_isolation</Mono> policy in its own migration (176 only covered the tables that
              existed then; see 177&apos;s <Mono>kds_flows</Mono>). Only a table&apos;s owner can force RLS:
              176 refuses to run, listing them, when some tenant tables belong to another role (fix: as
              postgres, <Mono>ALTER TABLE ... OWNER TO macaroonie_user</Mono>).
            </P>
            <H3>Still filter tenant_id yourself</H3>
            <P>
              RLS is the backstop, not the filter. Every query still says{' '}
              <Mono>tenant_id = $&#123;req.tenantId&#125;</Mono> itself (it also helps the planner), and a
              row loaded by an id from the request must be checked to be the caller&apos;s, so another
              tenant&apos;s id is a clean 404. Routes whose URL carries a venue id
              (<Mono>/api/venues/:id/...</Mono>: schedules, venue settings, test data) register{' '}
              <Mono>requireOwnVenue(param)</Mono> from <Mono>middleware/venue.js</Mono> after{' '}
              <Mono>requireAuth</Mono>. System-mode code has no backstop at all, so its filters are the
              only ones. Test any route you touch with a second tenant&apos;s rows in the database, as a
              role that isn&apos;t a superuser.
            </P>
            <H3>Ids in the body: the venue guard and the route's own checks</H3>
            <P>
              A tenant filter on the row being changed isn't enough: a request can also name other
              rows in its body (a venue, a section, a staff member, an option group), and a route that
              inserts those ids as given makes the caller's rows point at another tenant's (and an
              override's sittings, or a wage default's staff names, could cross over). The
              cross-tenant sweep (Testing below), and a read of the routes it pointed at, found this in
              eight routes taking a venue id in the body and ten taking other ids. Two layers now
              stop it:
            </P>
            <DataTable
              head={['Layer', 'What it checks']}
              rows={[
                ['refuseOtherTenantsVenues (middleware/venue.js)', 'Added to every route by app.js (onRoute, last in the route\'s preHandlers, so after requireAuth). Any key venue_id / *_venue_id or venue_ids / *_venue_ids in the query string or JSON body, at any depth, naming a venue of another tenant: 404 "Venue not found". An id that is no venue at all passes (the route deals with it; a stale id in saved page blocks mustn\'t stop a save). Requests without a tenant (public pages) are left alone.'],
                ['The route', 'Every other id in a body: a table\'s section (venues.js), a combination\'s tables, a staff member\'s role (rota.js), a Cash Recon day\'s income sources, payment channels and SC sources and a wage week\'s staff (cashRecon.js assertVenueRows()), online ordering\'s menus (orders.js), a dish\'s option groups and options (upsertMenuTree() drops ids that aren\'t the tenant\'s, like unknown dietary codes), an override\'s sittings (schedules.js), translation keys (saveTranslations() skips keys for words the tenant hasn\'t got).'],
              ]}
            />
            <P>
              The venue guard can't know what a <Mono>design_id</Mono> or a <Mono>staff_id</Mono> is,
              so a new route that takes another kind of id in its body must check it itself, and the
              sweep only covers it once the fixtures make a row with that id.
            </P>
            <H3>Connection pooling</H3>
            <P>
              The API connects straight to Postgres (postgres.js pools, no pooler in front).{' '}
              <Mono>withTenant()</Mono> sets the tenant for its transaction only, so it is safe with any
              pooling. <Mono>systemSql</Mono> relies on a connection startup parameter: behind a
              transaction-mode pooler (PgBouncer) that wouldn&apos;t reach Postgres per transaction, and{' '}
              <Mono>withSystem()</Mono> would have to set <Mono>app.bypass_rls</Mono> with{' '}
              <Mono>set_config(..., true)</Mono> at the start of each transaction instead.
            </P>
          </section>

          {/* ── STORED KEYS ───────────────────────────────── */}
          <section id="stored-keys" data-doc="">
            <H2>Stored keys</H2>
            <P>
              Integration keys saved in the database are sealed (migration 179,{' '}
              <Mono>services/vault.js</Mono>): AES-256-GCM with a master key from the environment,{' '}
              <Mono>SECRETS_KEY</Mono> (32 bytes, base64 or hex), so a leaked dump or backup doesn&apos;t
              hand them over. A sealed value is <Mono>v1:</Mono> + base64(iv | tag | ciphertext), a fresh
              iv every time. Hints (last four characters) sit beside them in plain text for display, and no
              route ever returns a key.
            </P>
            <DataTable
              head={['Column', 'Sealed on save in', 'Unsealed in']}
              rows={[
                ['platform_secrets.value (anthropic_api_key)', 'saveKey() (ai/apiKey.js)', 'activeKey()'],
                ['platform_secrets.value (kiosk_preview_key)', 'previewSecret() (kioskSvc.js)', 'previewSecret()'],
                ['loyverse_connections.access_token', 'POST / PATCH /api/loyverse/connections', 'ownConnection(), loadLink() (routes/loyverse.js)'],
                ['gloriafood_venue_links.poll_key', 'PUT /api/gloriafood/venues/:id/link', 'pollVenue() (gloriafoodSvc.js); the link route compares a typed key with the unsealed one'],
                ['venue_email_settings.provider_api_key, provider_secret, smtp_pass', 'POST / PATCH /api/email-templates/settings/:venueId', 'emailCredentials() (emailSvc.js), loadSendgridKey() (emailMonitoring.js)'],
                ['pos_card_accounts.secret', 'POST / PATCH /api/pos/card-accounts', 'the card machine adapters (services/cardSvc.js)'],
                ['pos_receipts.email_to (a guest\'s address until their counter order is paid, migration 210)', 'kioskReceipt() (receiptSvc.js)', 'sendWaitingReceipts(), then cleared'],
              ]}
            />
            <P>
              <Mono>unseal()</Mono> returns a value without the prefix as it is: keys saved before 179 are
              sealed by <Mono>sealStoredSecrets()</Mono>, run at API start in system mode (each row is
              updated only if it still holds the plain value, so several processes doing it at once is
              harmless). <Mono>checkVault()</Mono> runs first: in production the API exits without a valid{' '}
              <Mono>SECRETS_KEY</Mono>; in development and tests a fixed key derived from a constant is used,
              so every process agrees. Every deploy runs <Mono>scripts/ensure-secrets-key.sh</Mono> before
              migrating: it adds a random <Mono>SECRETS_KEY</Mono> to <Mono>api/.env</Mono> when there is none
              (chmod 600) and never changes an existing one. The preload (<Mono>src/preload.js</Mono>) reads{' '}
              <Mono>api/.env</Mono> on every start, so PM2 picks it up without a restart flag.
            </P>
            <InfoBox type="warn">
              Back up <Mono>api/.env</Mono> with the key in it. Changing or losing <Mono>SECRETS_KEY</Mono>{' '}
              makes every stored key unreadable: <Mono>unseal()</Mono> throws &quot;A stored key could not be
              read&quot;, and the keys have to be typed in again where they were set up (Platform page, Cash Recon
              settings, Booking emails). There is no rotation yet; the <Mono>v1:</Mono> prefix leaves room for one.
            </InfoBox>
          </section>

          {/* ── AUTH ──────────────────────────────────────── */}
          <section id="auth" data-doc="">
            <H2>Authentication</H2>
            <ol className="space-y-3 text-sm mb-6">
              {[
                'User logs in via Auth0 — identity only, no organisation param on the everyday login path. RequireAuth (main.jsx) calls loginWithRedirect() with no organization, except when the URL carries invitation + organization query params (an Auth0 invite-acceptance link), which are forwarded as-is.',
                "The JWT carries the user's identity (sub, email via a Login Action custom claim) but does not by itself select a restaurant — org_id on the token (when present, e.g. from an invite login) is only used as a same-browser hint, never as the source of truth.",
                'API middleware (src/middleware/auth.js) validates the JWT via the Auth0 JWKS endpoint and checks platform_admins.',
                "Middleware resolves the active tenant per REQUEST from the X-Tenant-Id header (sent by every admin-portal API call, see TenantGate below) — falling back to the JWT's org_id claim only when no header is sent. A header naming a tenant the caller isn't a member of is ignored (logged, not 401'd) rather than failing the request, so a stale localStorage pick can never cause a login loop.",
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
            <H3>Tenant selection (client-side, not Auth0)</H3>
            <P>
              Which restaurant a session is working in is resolved entirely in the admin portal,
              not via a second Auth0 login. <Mono>TenantGate</Mono> (src/components/TenantGate.jsx)
              sits inside <Mono>RequireAuth</Mono> and, once identity is established, decides
              which tenant (if any) to send as <Mono>X-Tenant-Id</Mono>:
            </P>
            <ul className="list-disc pl-5 space-y-1.5 text-sm text-muted-foreground mb-4">
              <li>The pick is a plain id string in <Mono>localStorage</Mono> (key <Mono>maca_selected_tenant</Mono>), read by <Mono>getSelectedTenant()</Mono> / written by <Mono>setSelectedTenant()</Mono> in <Mono>src/lib/api.js</Mono>. <Mono>useApi()</Mono> attaches it as <Mono>X-Tenant-Id</Mono> on every call.</li>
              <li><strong>A user with exactly one tenant</strong> (and not a platform admin) is auto-signed into it — no picker is ever shown, not even for a single frame (the loading state is held until the auto-select effect has run).</li>
              <li><strong>A returning multi-tenant user</strong> whose stored pick is still valid for their account (<Mono>{'GET /me'}</Mono>'s <Mono>current_tenant.id</Mono> matches the stored id) is signed straight back into that tenant — this is the "last one" behaviour, and it's just localStorage persistence plus the existing membership check, no separate "last used" column.</li>
              <li><strong>A login with an organisation</strong> (the person picked a restaurant on Auth0's organisation screen, or came through an invitation): the ID token's <Mono>org_id</Mono> wins over the stored pick once per login. <Mono>getIdTokenClaims()</Mono> gives <Mono>org_id</Mono> and the session <Mono>sid</Mono>; when <Mono>{"'<org_id>|<sid>'"}</Mono> differs from <Mono>localStorage.maca_login_org</Mono>, the tenant with that <Mono>auth0_org_id</Mono> becomes the stored pick and the key is saved, so a refreshed token doesn't count as a new login and switching in the sidebar afterwards sticks. Before this, a person with two restaurants who picked one at login kept working in the one this browser used last.</li>
              <li><strong>The phone app (<Mono>/mobile</Mono>)</strong> has no sidebar: <Mono>MobileShell</Mono>&apos;s header shows <Mono>me.current_tenant.name</Mono> next to the page&apos;s title on every page, and, with more than one tenant, a switch button next to sign out that opens <Mono>TenantSwitcherModal</Mono>. A pick stores the tenant (<Mono>setSelectedTenant()</Mono>) and opens the module&apos;s own path with <Mono>window.location.assign()</Mono>, dropping the query (an order or PO id there would be the other tenant&apos;s).</li>
              <li><strong>A multi-tenant user with no valid stored pick</strong> (first login on this browser, or their stored tenant was revoked) sees a mandatory <Mono>TenantSwitcherModal</Mono> — no close button, no backdrop dismiss, just the tenant list plus a Sign out link.</li>
              <li>Once inside the app, <Mono>AppShell</Mono>'s expanded-sidebar header shows the
              current tenant's name in place of a static "Macaroonie" wordmark, with a small
              chevron next to it whenever <Mono>{'GET /me'}</Mono>'s <Mono>available_tenants</Mono>{' '}
              has more than one entry; tapping the name or the chevron opens the same{' '}
              <Mono>TenantSwitcherModal</Mono> (dismissible this time) — picking a tenant calls{' '}
              <Mono>setSelectedTenant()</Mono> then reloads the page so every query re-fetches under
              the new <Mono>X-Tenant-Id</Mono>. A single-tenant user sees their tenant's name as
              plain (non-interactive) text; the collapsed icon-rail sidebar keeps its own separate
              chevron button below the logo for the same modal.</li>
            </ul>
            <InfoBox type="info">
              An Auth0 org switch (re-authenticating with a different Auth0 organisation) is a
              separate, older mechanism still used only for invitation-link acceptance — everyday
              tenant switching never triggers a second Auth0 login or loses TanStack Query cache.
            </InfoBox>
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

          {/* ── TEAM & PLATFORM ADMIN ───────────────────── */}
          <section id="team-platform" data-doc="">
            <H2>Team & Platform Admin</H2>
            <P>
              Tenant operators manage their team entirely from the admin portal — no Auth0
              dashboard required. Platform admins (Macaroonie staff) sit above all tenants
              and manage the global tenant list.
            </P>

            <H3>RBAC matrix</H3>
            <DataTable
              head={['Capability', 'platform_admin', 'owner', 'admin', 'operator', 'viewer']}
              rows={[
                ['Manage tenants',          '✓', '',  '',  '',  ''],
                ['Switch tenant context',   '✓', '✓', '✓', '✓', '✓'],
                ['Invite/remove users',     '✓', '✓', '',  '',  ''],
                ['Change user roles',       '✓', '✓', '',  '',  ''],
                ['Reset user passwords',    '✓', '✓', '',  '',  ''],
                ['View team list',          '✓', '✓', '✓', '',  ''],
                ['Edit brand/rules/site',   '✓', '✓', '✓', '',  ''],
                ['Manage bookings',         '✓', '✓', '✓', '✓', ''],
                ['View timeline',           '✓', '✓', '✓', '✓', '✓'],
              ]}
            />

            <H3>Platform admin (<Mono>platform_admins</Mono>)</H3>
            <P>
              Global table, no RLS — access is gated in <Mono>auth.js</Mono> via
              <Mono>requirePlatformAdmin</Mono>. Add a row with the user's Auth0 sub
              (<Mono>auth0_user_id</Mono>) to grant access. Platform admins bypass every
              <Mono>requireRole()</Mono> check by design — to restrict an action to
              tenant-level owners only, write a custom guard checking
              <Mono>req.user.role === 'owner' && !req.isPlatformAdmin</Mono>.
            </P>

            <H3>Team API</H3>
            <DataTable
              head={['Method', 'Path', 'Role', 'Purpose']}
              rows={[
                ['GET',    '/api/team',                          'admin',  'List members'],
                ['GET',    '/api/team/roles',                    'any',    'Role catalogue with descriptions'],
                ['GET',    '/api/team/auth0-status',             'any',    'Feature flags (mgmt configured / invitations ready)'],
                ['POST',   '/api/team/invite',                   'owner',  'Create local row + send Auth0 invitation email'],
                ['PATCH',  '/api/team/:userId',                  'owner',  'Change role/name/active. Role syncs to Auth0 app_metadata.'],
                ['DELETE', '/api/team/:userId',                  'owner',  'Soft-deactivate locally + remove from Auth0 org membership'],
                ['POST',   '/api/team/:userId/reset-password',   'owner',  'Trigger Auth0 password change email'],
              ]}
            />

            <H3>Platform API</H3>
            <DataTable
              head={['Method', 'Path', 'Purpose']}
              rows={[
                ['GET',   '/api/me',                                'Current user + list of available tenants (drives org switcher)'],
                ['GET',   '/api/platform/tenants',                  'List all tenants (active + inactive)'],
                ['GET',   '/api/platform/tenants/stats',            'Aggregate counts (tenants, venues, users, plans)'],
                ['POST',  '/api/platform/tenants',                  'Create a tenant'],
                ['PATCH', '/api/platform/tenants/:id',              'Update name/slug/plan/auth0_org_id/is_active'],
              ]}
            />

            <H3>Auth0 Management API integration</H3>
            <P>
              Wrapped by <Mono>src/services/auth0MgmtSvc.js</Mono>. Uses the client-credentials
              grant against the Auth0 Management API; tokens are cached in-memory with a 5-minute
              refresh buffer. Required env vars (all optional in dev):
              <Mono>AUTH0_MGMT_CLIENT_ID</Mono>, <Mono>AUTH0_MGMT_CLIENT_SECRET</Mono>,
              <Mono>AUTH0_INVITE_CLIENT_ID</Mono>. When unset,
              <Mono>auth0MgmtSvc.isConfigured()</Mono> returns false and the team routes
              degrade to local-only operations with a warning banner in the UI.
            </P>

            <H3>Auth0 dashboard setup (one-time, current Auth0 UI)</H3>
            <P>
              The Auth0 dashboard layout has shifted over time. These are the exact paths and
              labels that work as of May 2026 — official Auth0 docs sometimes describe older
              flows. Each step blocks the next; if invitations 404 / loop / "user not in org",
              the cause is always one of these.
            </P>
            <ol className="list-decimal ml-5 space-y-2 text-sm text-muted-foreground mb-4">
              <li>
                <strong>Create the M2M application.</strong> Applications → Applications →
                <strong> Create Application</strong> → "Machine to Machine Applications" →
                pick <strong>Auth0 Management API</strong> as the API.
                Tick scopes for team management: <Mono>read:users</Mono>, <Mono>update:users</Mono>,
                <Mono>read:organization_invitations</Mono>, <Mono>create:organization_invitations</Mono>,
                <Mono>read:organization_members</Mono>, <Mono>delete:organization_members</Mono>.
                Plus, for tenant auto-provisioning: <Mono>create:organizations</Mono>,
                <Mono>read:organizations</Mono>, <Mono>update:organizations</Mono>,
                <Mono>read:connections</Mono>, <Mono>create:organization_connections</Mono>,
                <Mono>update:organization_connections</Mono>.
                Copy the Client ID + Secret → <Mono>AUTH0_MGMT_CLIENT_ID</Mono> /
                <Mono>AUTH0_MGMT_CLIENT_SECRET</Mono> on the API.
              </li>
              <li>
                <strong>Set the SPA Client ID.</strong> The same value as
                <Mono>VITE_AUTH0_CLIENT_ID</Mono> on the admin portal goes into
                <Mono>AUTH0_INVITE_CLIENT_ID</Mono> on the API. Invitations issued by the M2M
                client land users at this SPA.
              </li>
              <li>
                <strong>Application Login URI on the SPA app.</strong>
                Applications → Macaroonie Admin → Settings → Application URIs →
                <strong> Application Login URI</strong> = <Mono>https://office.macaroonie.com</Mono>{' '}
                (the admin's address since migration 138; it was <Mono>https://macaroonie.com</Mono>).
                Without this, every <Mono>POST /api/v2/organizations/.../invitations</Mono> returns 400
                "A default login route is required to generate the invitation url".
              </li>
              <li>
                <strong>Allowed Callback / Logout / Web Origins on the SPA app.</strong>
                Same Settings page → all three must include <Mono>https://office.macaroonie.com</Mono>{' '}
                and <Mono>https://ops.macaroonie.com</Mono> (the phone app signs in on its own origin;
                the SDK's <Mono>redirect_uri</Mono> is <Mono>window.location.origin</Mono>). Keep{' '}
                <Mono>https://macaroonie.com</Mono> until the apex has been switched to the platform page.
              </li>
              <li>
                <strong>Connections enabled at the application level.</strong>
                Applications → Macaroonie Admin → <strong>Connections</strong> tab → toggle
                <Mono>google-oauth2</Mono> and <Mono>Username-Password-Authentication</Mono> ON.
              </li>
              <li>
                <strong>Connections added at the organization level.</strong>
                Organizations → your org → <strong>Connections</strong> tab → Add Connections →
                tick <Mono>google-oauth2</Mono> and <Mono>Username-Password-Authentication</Mono>.
              </li>
              <li>
                <strong>Auto-Membership enabled per connection.</strong>
                Click into each connection (still in Org → Connections) → scroll to
                <strong> Authentication → Membership On Authentication</strong> → switch from
                "Disable Auto-Membership" to <strong>"Enable Auto-Membership"</strong> → Save.
                If left disabled, invited users authenticate but never become org members,
                producing a Google-picker loop with no error visible to the operator.
              </li>
              <li>
                <strong>Login Action for role claim.</strong> Auth0 → Actions → Library →
                add a Login Action that reads <Mono>event.user.app_metadata.role</Mono> and
                writes it as <Mono>accessToken['https://macaroonie.com/claims/role']</Mono>.
                Required for role-sync writes via <Mono>updateUserAppMetadata</Mono> to surface
                in JWTs (the API still works without it because local <Mono>users.role</Mono>
                is authoritative — but the in-token role would lag).
              </li>
            </ol>

            <H3>First-login reconciliation</H3>
            <P>
              <Mono>requireAuth</Mono> in <Mono>auth.js</Mono> reconciles the Auth0 sub
              with the local <Mono>users</Mono> row on every request. Three cases:
              (1) already linked → bump <Mono>last_login_at</Mono> and use
              <Mono>users.role</Mono> as authoritative; (2) <Mono>auth0_user_id IS NULL</Mono>
              but email matches an invited row → link sub, bump login; (3) local
              <Mono>is_active=false</Mono> → reject with 403 even if Auth0 still trusts
              the user. The local DB is the source of truth for <Mono>req.user.role</Mono>,
              so role changes take effect immediately without waiting for an Auth0 token refresh.
            </P>
          </section>

          {/* ── RBAC: MODULES & ROLES ──────────────────── */}
          <section id="rbac" data-doc="">
            <H2>RBAC: Modules &amp; Roles</H2>
            <P>
              Two layers of access control, introduced by migration 038. The model in
              <Mono>api/src/config/modules.js</Mono> is the single source of truth for
              every module the platform knows about (<Mono>MODULES</Mono>).
            </P>

            <H3>Schema (migration 038)</H3>
            <DataTable
              head={['Table', 'Purpose', 'Key columns']}
              rows={[
                ['tenant_modules', 'Per-tenant on/off switch per module. Disabled modules are hidden from nav AND rejected at the API.', 'tenant_id, module_key, is_enabled, config jsonb. UNIQUE(tenant_id, module_key).'],
                ['tenant_roles',   'Custom roles per tenant. permissions JSONB maps module_key → "manage" | "use" | "view" | "none" ("use" only on modules that offer it, migration 229).', 'tenant_id, key, label, is_builtin, is_active, permissions, sort_order. UNIQUE(tenant_id, key).'],
                ['users.custom_role_id (added)', 'Optional FK to tenant_roles. When NULL, the legacy users.role enum is used + mapped to a built-in role with the same key.', 'nullable uuid, ON DELETE SET NULL'],
              ]}
            />

            <H3>Module groups</H3>
            <P>
              <Mono>MODULE_GROUPS</Mono> in <Mono>modules.js</Mono> bundles tightly-coupled
              modules under one master switch. The Modules tab in <Mono>/access</Mono> toggles
              GROUPS, not individual modules — so disabling Bookings hides every booking-related
              nav entry at once.
            </P>
            <DataTable
              head={['Group', 'Modules in the group']}
              rows={[
                ['bookings',        'bookings, venues, tables, schedule, rules, customers, widget_test'],
                ['email_templates', 'email_templates'],
                ['website',         'website'],
                ['cash_recon',      'cash_recon'],
                ['pepper',          'ai_assistant (was in bookings until migration 173; Pepper covers every area, so it has its own switch)'],
                ['(core, no group)', 'dashboard, team, settings, documentation — always-on'],
              ]}
            />

            <H3>API</H3>
            <DataTable
              head={['Method', 'Path', 'Role', 'Purpose']}
              rows={[
                ['GET',    '/api/access/modules',           'any auth',     'List modules with per-tenant enabled state'],
                ['GET',    '/api/access/module-groups',     'any auth',     'List groups with derived enabled state (AND of members)'],
                ['PATCH',  '/api/access/module-groups/:key', 'owner',        'Toggle every member module in one transaction'],
                ['PATCH',  '/api/access/modules/:key',      'owner',        'Toggle a single module (internal use)'],
                ['GET',    '/api/access/roles',             'any auth',     'List tenant_roles with permissions'],
                ['POST',   '/api/access/roles',             'owner',        'Create custom role'],
                ['PATCH',  '/api/access/roles/:id',         'owner',        'Edit role label/description/active/permissions'],
                ['DELETE', '/api/access/roles/:id',         'owner',        'Delete custom role (built-ins protected, refuses if users still reference)'],
              ]}
            />

            <H3>Permission gating</H3>
            <P>
              Use <Mono>requirePermission(moduleKey, &apos;view&apos; | &apos;manage&apos;)</Mono> on routes
              that should respect both the tenant module switch AND the user&apos;s role
              permissions. Platform admins bypass automatically. The middleware checks tenant
              module enablement first (rejects with 403 if disabled even for owner), then the
              user&apos;s role permission level.
            </P>
            <P>
              <Mono>/api/me</Mono> returns <Mono>enabled_modules: string[]</Mono> and
              <Mono> permissions: {`{ [module]: level }`}</Mono>, computed from the union of
              tenant_modules + role permissions. The frontend uses this to gate nav entries
              in <Mono>AppShell.jsx</Mono>.
            </P>

            <H3>View uses, Manage changes (Oct 2026 rollout)</H3>
            <P>
              Every module&apos;s routes now go through module permissions: reads need{' '}
              <Mono>view</Mono>, changes need <Mono>manage</Mono>. Route files that used the old
              <Mono> requireRole(&apos;admin&apos;, &apos;owner&apos;)</Mono> gates (Cash Recon, bookings,
              venues, schedules, customers, menus, website, media, reviews, emails, email monitor,
              payments, issue log, feature requests) define a <Mono>PERM</Mono> object after their
              imports (<Mono>PERM.view</Mono>, <Mono>PERM.manage</Mono>, and where the old gate was
              owner/admin and the operator default is already manage, <Mono>PERM.adminManage</Mono>{' '}
              = <Mono>[requireRole(&apos;admin&apos;, &apos;owner&apos;), requirePermission(module, &apos;manage&apos;)]</Mono>:
              Cash Recon settings and unsubmit, deleting a booking, refunds; removing an email
              suppression is owner + manage). Uploads to the website store accept any of website,
              promotions or menus manage; media changes website or menus manage
              (<Mono>requireAnyPermission</Mono>).
            </P>
            <P>
              Reads other modules depend on stay open to every tenant member: the venue list and
              venue detail, tables, sections, combinations, booking rules, schedules,{' '}
              <Mono>GET /website/tenant-site</Mono>, menu reads and the media library list. Only
              their writes are gated. A refusal reads &ldquo;Your role can view X but not change
              it.&rdquo; / &ldquo;Your role doesn&apos;t have access to X.&rdquo; (<Mono>permissionMessage()</Mono>{' '}
              in <Mono>auth.js</Mono>). <Mono>GET /email-templates/settings/:venueId</Mono> returns
              the provider key, SMTP password and SES secret as <Mono>null</Mono> with{' '}
              <Mono>secrets_hidden: true</Mono> below manage.
            </P>
            <P>
              Built-in roles: tenants created after migration 038 had no <Mono>tenant_roles</Mono>{' '}
              rows, so a user&apos;s role resolved to nothing. Migration 160 inserts the four
              built-in roles for every tenant (<Mono>ON CONFLICT DO NOTHING</Mono>), new tenants get
              them from <Mono>seedBuiltinRoles()</Mono> (<Mono>modules.js</Mono>, called by{' '}
              <Mono>POST /api/platform/tenants</Mono>), and the role key falls back to{' '}
              <Mono>users.role</Mono> when no role row matches. An empty built-in permissions map
              means the module defaults; <Mono>GET /api/access/roles</Mono> returns every module&apos;s
              resolved level (<Mono>resolvePermission()</Mono>).
            </P>
            <P>
              Admin side: <Mono>usePermission(moduleKey)</Mono> (<Mono>hooks/usePermission.js</Mono>)
              returns <Mono>{'{ level, canView, canUse, canManage, isOwnerOrAdmin, isOwner, loaded }'}</Mono>{' '}
              from <Mono>/me</Mono>. Screens hide or disable their change controls when{' '}
              <Mono>canManage</Mono> is false and show <Mono>ReadOnlyNotice</Mono>; a settings form
              is wrapped in <Mono>ReadOnlyFieldset</Mono> (a native{' '}
              <Mono>{'<fieldset disabled>'}</Mono>, which disables every input, select and button
              inside, but not links or clickable divs). Deep component trees pass the state through
              a small context (<Mono>CashReadOnly</Mono> in CashRecon.jsx, <Mono>TimelineReadOnly</Mono>,
              <Mono> MenuReadOnly</Mono>). Dashboards use the page config&apos;s{' '}
              <Mono>moduleKey</Mono> (see H&amp;S Dashboard). The API refuses the change regardless,
              so the admin only decides what is shown.
            </P>

            <H3>Use: a level between View and Manage (migration 229)</H3>
            <P>
              <Mono>PERMISSION_LEVELS</Mono> is <Mono>none, view, use, manage</Mono> (lowest first)
              and <Mono>PERMISSION_RANK</Mono> its order, shared by <Mono>auth.js</Mono>,{' '}
              <Mono>ai/context.js</Mono> and <Mono>routes/installer.js</Mono>. Only a module whose{' '}
              <Mono>MODULES</Mono> entry has a <Mono>use</Mono> text offers it: checklists,
              food_safety, hs_action_log. <Mono>levelsOf(key)</Mono> lists a module&apos;s levels
              (<Mono>GET /api/access/modules</Mono> sends them as <Mono>levels</Mono>, with the{' '}
              <Mono>use</Mono> text for the Access page), <Mono>workLevel(key)</Mono> is the level that
              does its everyday work (<Mono>use</Mono> where offered, else <Mono>manage</Mono>), and{' '}
              <Mono>permissionAtLeast()</Mono> compares by rank. The role routes refuse a level a
              module doesn&apos;t offer (400 &ldquo;Cash reconciliation has no use level: pick None,
              View or Manage.&rdquo;), and <Mono>resolvePermission()</Mono> reads a stored{' '}
              <Mono>use</Mono> on any other module as <Mono>view</Mono>.
            </P>
            <DataTable
              head={['Module', 'Use (requirePermission(m, \'use\'))', 'Manage only']}
              rows={[
                ['checklists', 'PUT /checklists/instance', 'templates and their items'],
                ['food_safety', 'POST / PATCH of temp-logs, deliveries, holds and cooking', 'equipment, capture times, hold stations and times, cooking sessions, settings and items; DELETE /cooking/:id'],
                ['hs_action_log', 'POST /entries, PATCH /entries/:id and /complete', 'DELETE /entries/:id, the categories'],
              ]}
            />
            <P>
              Elsewhere: the Today feed&apos;s <Mono>can_act</Mono> is{' '}
              <Mono>permissionAtLeast(level, workLevel(module))</Mono> (<Mono>services/opsToday.js</Mono>);
              Pepper&apos;s eight H&amp;S change tools check <Mono>use</Mono> and say{' '}
              <Mono>needs: &apos;use&apos;</Mono>, which <Mono>toolAllowed()</Mono> reads for the
              connector&apos;s list (other change tools still need manage). In the admin,{' '}
              <Mono>canUse</Mono> (use or manage) unlocks the check panels in{' '}
              <Mono>components/checklists</Mono>, <Mono>foodSafety</Mono> and{' '}
              <Mono>hsActionLog</Mono>; their setup, deleting and category controls stay on{' '}
              <Mono>canManage</Mono>. Anything that asks whether someone can see a module must test{' '}
              <Mono>level !== &apos;none&apos;</Mono> (or the rank), never{' '}
              <Mono>level === &apos;view&apos; || level === &apos;manage&apos;</Mono>, which hides it
              from Use (the dashboards&apos; <Mono>canUseWidget()</Mono> did).
            </P>
          </section>

          {/* ── EMAIL SYSTEM ──────────────────────────── */}
          <section id="email-system" data-doc="">
            <H2>Email System</H2>
            <P>
              Pluggable email delivery with five providers, per-venue settings, monitoring,
              and a guest manage page. All bookings emails (confirmation, reminder,
              modification, cancellation) flow through one BullMQ queue.
            </P>

            <H3>Providers</H3>
            <DataTable
              head={['Provider', 'When to use', 'Config fields used']}
              rows={[
                ['sendgrid', 'Default. Free 100/day for trial. Provides Email Activity API for monitoring.', 'provider_api_key (or SENDGRID_API_KEY env)'],
                ['postmark', 'Recommended for transactional. Strong deliverability, $15/10k. Click tracking via shared click.pstmrk.it (no custom tracking domains supported by Postmark).', 'provider_api_key (Server Token), provider_domain (message stream, defaults to "outbound")'],
                ['mailgun',  'High-volume option. EU/US regions are different endpoints — use the dropdown.', 'provider_api_key, provider_domain (sending domain), provider_region (us|eu)'],
                ['ses',      'Cheapest at scale. AWS Lightsail account already in place. Production access required.', 'provider_api_key (access key id), provider_secret (secret access key; it was kept in provider_domain until migration 179), provider_region'],
                ['smtp',     'Fallback / self-hosted.', 'smtp_host, smtp_port, smtp_user, smtp_pass, smtp_secure'],
              ]}
            />
            <P>
              provider_api_key, provider_secret and smtp_pass are stored sealed (migration 179, see Stored keys)
              and never sent back: <Mono>GET .../settings/:venueId</Mono> returns them as null with{' '}
              <Mono>*_hint</Mono> (last four) for Manage, nothing for View (<Mono>secrets_hidden</Mono>). On
              save a string replaces the key, null removes it, empty or left out keeps it.{' '}
              <Mono>emailCredentials()</Mono> in <Mono>emailSvc.js</Mono> is the one place they are
              unsealed (booking, order and purchase order emails, the test send).
            </P>
            <P>
              The <Mono>provider_domain</Mono> column is overloaded across providers (Mailgun
              sending domain, Postmark message stream name, SES secret access key). The UI
              gates input fields by provider so users never see the overloading.
            </P>

            <H3>Routes</H3>
            <DataTable
              head={['Method', 'Path', 'Purpose']}
              rows={[
                ['GET',    '/api/email-templates/settings/:venueId',         'Read venue email settings'],
                ['POST',   '/api/email-templates/settings/:venueId',         'Upsert venue email settings (creates row if missing, updates all body fields)'],
                ['PATCH',  '/api/email-templates/settings/:venueId',         'Same as POST — both go through the same upsert helper'],
                ['POST',   '/api/email-templates/preview',                   'Render template with sample merge fields (no send)'],
                ['POST',   '/api/email-templates/send-test',                 'Send real test email through venue provider, no booking. Logged in email_log with template_type suffix _test.'],
                ['GET',    '/api/email-monitoring/summary?venue_id&days',    'One-shot: SendGrid stats + suppression lists + local log totals'],
                ['GET',    '/api/email-monitoring/suppressions/:type',       'Bounces / blocks / spam_reports / invalid_emails'],
                ['DELETE', '/api/email-monitoring/suppressions/:type/:email', 'Owner-only: clear a suppression so retries can flow'],
              ]}
            />

            <H3>Monitoring (SendGrid only)</H3>
            <P>
              <Mono>src/services/sendgridSvc.js</Mono> wraps the SendGrid Web API:
              <Mono> getStats</Mono> (daily breakdown), <Mono>getSuppressions</Mono>,
              <Mono> removeSuppression</Mono>, <Mono>pingApiKey</Mono>. <Mono>/email-monitoring</Mono>
              admin page combines the SendGrid data with the local <Mono>email_log</Mono> table
              for a complete &ldquo;what went out / what&apos;s in&rdquo; view. Other providers
              show a graceful banner; local log still works.
            </P>

            <H3>Guest manage page</H3>
            <P>
              SSR page at <Mono>/manage/{`{token}`}</Mono> via <Mono>src/routes/manageBooking.js</Mono>
              + Eta template. Guest authenticates via the <Mono>manage_token</Mono> UUID
              embedded in the email link. Allows modify date/time/covers OR cancel, gated by
              the venue&apos;s <Mono>allow_guest_modify</Mono> /
              <Mono> allow_guest_cancel</Mono> flags.
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
                ['deposit_rules', 'Per-venue deposit for online bookings (Booking rules page). refund_hours_before NULL = kept when the guest cancels (CHECK >= 0, migration 220).', 'venue_id, requires_deposit, deposit_type fixed | per_cover, deposit_amount (pounds), currency, refund_hours_before'],
                ['booking_holds', 'Temporary slot reservations. UNIQUE (table_id, starts_at). A deposit hold carries its PaymentIntent and lives at least 15 minutes (migration 220).', 'venue_id, table_id, combination_id, starts_at, ends_at, expires_at, guest_name, guest_email, guest_notes, stripe_pi_id, stripe_account, deposit_pence'],
                ['bookings', 'Confirmed bookings.', 'venue_id, table_id, combination_id, starts_at, ends_at, covers, status, reference, guest_name, guest_email, guest_phone, guest_notes, operator_notes, customer_id'],
                ['customers', 'Customer profiles with GDPR support. Auto-created on booking confirm. is_anonymised flag for GDPR erasure.', 'tenant_id, name, email, phone, notes, is_anonymised, anonymised_at, created_at'],
                ['payments', 'Booking deposits, one row per paid booking (UNIQUE stripe_pi_id). status succeeded | partially_refunded | refunded; refund_hours_before copied from the rule when paid; refund_ids are Stripe refund ids already counted (migration 220).', 'booking_id, stripe_pi_id, stripe_account, amount, currency, status, refunded_amount, refund_hours_before, refund_ids'],
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

            <P>
              <strong>Errors.</strong> <Mono>errorHandler()</Mono> in <Mono>middleware/error.js</Mono>{' '}
              (set before the route plugins in <Mono>app.js</Mono>) answers every thrown error as{' '}
              <Mono>{'{ error, code?, errors? }'}</Mono>: <Mono>httpError(status, message)</Mono> as
              given, Zod 400 with <Mono>issues</Mono>, Postgres 23505 / 23P01 / 55P03 / 23503 as 409,
              and 22P02 (text that isn&apos;t a valid value for its type) as 404 "Not found" when it is
              a uuid (a malformed id in the address or body is a record that doesn&apos;t exist) else
              400. Anything else is a 500. Only 500s are logged as errors with the stack; a 4xx is one
              warn line (<Mono>Request refused</Mono> with the status, message and code), so refusals
              don&apos;t flood the error log.
            </P>

            <H3>Holds &amp; Bookings — <span className="font-mono font-normal text-sm">/api/bookings</span></H3>
            <DataTable
              head={['Method', 'Path', 'Min role', 'Description']}
              rows={[
                ['POST', '/holds', 'any', 'Create a hold. UNIQUE (table_id, starts_at) guards concurrent requests.'],
                ['DELETE', '/holds/:id', 'any', 'Release a hold immediately. Cancels attached Stripe PI.'],
                ['POST', '/', 'any', 'Make a booking from a staff hold. Staff bookings take no deposit, even at a deposit venue.'],
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
                ['POST', '/:id/refund', 'owner / admin + bookings manage', "Refund a booking deposit: { amount_pence? } (left out = all that is left). 422 over what is left or already refunded. Returns { ok, status, refunded_pence }."],
              ]}
            />

            <H3>Booking deposits (migration 220)</H3>
            <P>
              Guests booking online at a venue whose <Mono>deposit_rules.requires_deposit</Mono> is on pay by card in the
              reservations widget, on the group&apos;s own Stripe account (Connect direct charge, no platform fee). The
              server never books on the browser&apos;s word: it reads the PaymentIntent back from Stripe. Staff bookings
              (<Mono>POST /api/bookings</Mono>, admin-override) take no deposit. The old platform-account flow
              (<Mono>services/paymentService.js</Mono>, <Mono>/api/payments/intent</Mono>, <Mono>/api/payments/webhook</Mono>,{' '}
              <Mono>STRIPE_WEBHOOK_SECRET</Mono>) is gone.
            </P>
            <DataTable
              head={['Piece', 'What it does']}
              rows={[
                ['GET /widget-api/venues/:id', "deposit: { required, online, type, amount_pence, currency, refund_hours_before } from depositPublic(); online = the group's Stripe account can take payments (depositsOnline())."],
                ['POST /widget-api/venues/:id/holds', 'At a deposit venue: 422 when Stripe isn\'t ready ("call them to book") or without an email (the receipt goes there); stores guest_notes on the hold.'],
                ['POST .../holds/:holdId/deposit', "startDeposit(): a PaymentIntent on the group's account (automatic_payment_methods, allow_redirects never, metadata kind deposit + hold, tenant, venue, receipt_email), reused while payable for the same amount; the hold gets stripe_pi_id, stripe_account, deposit_pence and lives at least DEPOSIT_HOLD_SECS (900). Returns client_secret, publishable_key, account, amount_pence, currency, expires_at. 410 hold gone."],
                ['POST .../holds/:holdId/deposit/confirm', "{ payment_intent }: confirmDeposit() reads it from Stripe (404 for another venue's), settleDeposit() books it. 201 booking (+ deposit_pence), 202 still processing (the widget asks again), 402 not paid, 409 { refunded: true } when it can't be booked."],
                ['POST .../holds/:holdId/confirm', '422 at a deposit venue: pay first.'],
                ['settleDeposit()', "Advisory lock per PaymentIntent, then: a payments row already there = booked (idempotent, never refunds); the hold locked FOR UPDATE and booked with confirm_hold(..., p_allow_expired true) (paid but expired still books if the table is free); a hold gone or its table taken = refund with key mcrn-deposit-unbooked-<pi>; an amount or account that doesn't match = mismatch, nothing booked. bookFromHold() + afterNewBooking() (customer, email, reminder, Timeline push) in services/holdBooking.js."],
                ['Webhook', 'POST /webhooks/payments/stripe (the Connect endpoint): parseWebhook() hands PaymentIntents with metadata.kind deposit to depositWebhook(), which books on payment_intent.succeeded only when the metadata venue belongs to the metadata tenant. So a guest who closes the tab after paying still gets the booking.'],
                ['Refunds', "refundDeposit() (services/depositSvc.js) on payments.stripe_account, idempotency key mcrn-deposit-refund-<id>-<refunded so far>-<amount>, refund_ids so a retry isn't counted twice. Guest cancel (guestBookingSvc.cancelBooking()) refunds in full while refundRule() allows (refund_hours_before set and starts_at minus that many hours still ahead), else keeps it; the manage page says which before and after. The booking drawer's Deposit part refunds all or part (owners and admins)."],
                ['Giving up', 'DELETE of a hold (widget or staff) cancels its PaymentIntent (cancelDepositIntent()).'],
                ['Admin', "Rules page Deposit card (deposit-not-ready / deposit-ready from GET /api/venues/:id/deposit-rules' card_payments_ready); BookingDrawer's Deposit part (payment_currency, payment_refunded, payment_refund_hours_before on GET /api/bookings)."],
                ['Widget', "views/site/reservations_widget.eta step 6 (#rpay): Stripe.js with the group's account, the Payment Element, confirmPayment({ redirect: 'if_required' }), then deposit/confirm (finishDeposit() asks again on 202)."],
              ]}
            />

            <H3>Customers — <span className="font-mono font-normal text-sm">/api/customers</span></H3>
            <DataTable
              head={['Method', 'Path', 'Min role', 'Description']}
              rows={[
                ['GET', '/', 'operator', 'Search customers by name/email/phone (?q=term). Returns 20 most-recent if q < 2 chars.'],
                ['GET', '/:id', 'operator', 'Customer detail including full booking history.'],
                ['PATCH', '/:id', 'operator', 'Update name, phone, or notes.'],
                ['POST', '/:id/unsubscribe', 'operator', 'Newsletter off: marketing_opt_in = false, marketing_opt_out_at = now() (migration 125). There is no staff subscribe; only the guest opts in, at online checkout.'],
                ['POST', '/:id/anonymise', 'admin', 'GDPR erasure — replaces all PII with placeholders, anonymises linked bookings and web orders (guest fields, notes, allergy_note, consent, order line notes), clears the newsletter fields, and in the same transaction removes their name, email and phone from Pepper\'s chats and audit (eraseFromAi(), see Pepper → Erasure and retention). Never deletes the row.'],
                ['GET', '/:id/export', 'admin', 'GDPR data export — returns a JSON file download with customer, newsletter status, all booking records and all web orders (with items and the consent recorded at checkout).'],
              ]}
            />
            <P>
              Every query filters <Mono>tenant_id</Mono> itself (customers, and the bookings, orders and
              order lines it reads or anonymises), not only through RLS: another tenant's customer id
              returns 404 and is never listed.
            </P>

            <H3>Reviews — <span className="font-mono font-normal text-sm">/api/reviews</span></H3>
            <P>
              Tenant-scoped via RLS. Three ingestion paths: Apify Google scraper, manual entry, CSV
              import. Requires <Mono>APIFY_API_TOKEN</Mono> env var for scraping. Google Place ID
              stored on the venue row (<Mono>google_place_id</Mono>). Migration 056.
            </P>
            <DataTable
              head={['Method', 'Path', 'Min role', 'Description']}
              rows={[
                ['GET', '/', 'operator', 'List reviews. Filter by venue_id, platform, is_approved, is_featured, source, rating.'],
                ['GET', '/stats', 'operator', 'Aggregate stats — total/approved/featured counts + average rating, broken down by venue.'],
                ['GET', '/scrape-jobs', 'admin', 'Recent Apify scrape jobs and their status.'],
                ['GET', '/:id', 'operator', 'Single review detail.'],
                ['POST', '/', 'operator', 'Create a manual review.'],
                ['PATCH', '/:id', 'operator', 'Update review fields (approve, feature, edit text, add reply).'],
                ['DELETE', '/:id', 'admin', 'Delete a review permanently.'],
                ['POST', '/bulk-approve', 'admin', 'Approve multiple reviews by ID array.'],
                ['POST', '/scrape', 'admin', 'Enqueue an Apify Google scrape job for a venue. Requires google_place_id on the venue.'],
                ['POST', '/import-csv', 'admin', 'Import reviews from a CSV upload (reviewer_name, rating, review_text, review_date columns).'],
              ]}
            />

            <H3>Dev tools — <span className="font-mono font-normal text-sm">/api/backlog | /api/issues | /api/feature-requests | /api/changelog</span></H3>
            <P>
              Platform-internal tools for tracking development work and communicating with tenants.
              Migration 057. New modules: <Mono>issue_log</Mono> + <Mono>feature_requests</Mono>
              (group: support), <Mono>changelog</Mono> (core).
            </P>
            <DataTable
              head={['Route', 'Auth', 'Description']}
              rows={[
                ['/api/backlog GET /', 'platform admin', 'List all backlog items grouped by status column.'],
                ['/api/backlog POST /', 'platform admin', 'Create backlog item (title, type, priority, story_points, labels).'],
                ['/api/backlog PATCH /:id', 'platform admin', 'Update item fields.'],
                ['/api/backlog DELETE /:id', 'platform admin', 'Delete item.'],
                ['/api/backlog PATCH /:id/move', 'platform admin', 'Move item to a new status column (Kanban drag).'],
                ['/api/issues GET /', 'tenant', 'List issues for tenant. A platform admin in a tenant\'s view sees that tenant\'s issues like everyone else; ?scope=all (the page\'s All restaurant groups button, platform admins only) or no tenant lists every tenant\'s, with tenant_name. scope is ignored for anyone else.'],
                ['/api/issues POST /', 'tenant', 'Create issue. Priority auto-derived from impact × urgency matrix.'],
                ['/api/issues PATCH /:id', 'tenant / platform', 'Update issue. Platform admin can update status, resolution_notes, promoted_to_backlog_id.'],
                ['/api/issues POST /:id/promote', 'platform admin', 'Promote issue to backlog — creates a backlog_item and links it.'],
                ['/api/feature-requests GET /', 'tenant', 'List feature requests. Includes upvoted_by_me flag per request.'],
                ['/api/feature-requests POST /', 'tenant', 'Submit a feature request.'],
                ['/api/feature-requests PATCH /:id', 'platform admin', 'Update status, admin_notes.'],
                ['/api/feature-requests POST /:id/upvote', 'tenant', 'Toggle upvote (insert or delete from feature_request_upvotes). user_id holds the Auth0 user id as text (migration 161; it was uuid, so every list and upvote failed).'],
                ['/api/feature-requests POST /:id/promote', 'platform admin', 'Promote to backlog item.'],
                ['/api/changelog GET /', 'any', 'List changelog entries. Tenants see published only; platform admin sees all.'],
                ['/api/changelog POST /', 'platform admin', 'Create a changelog entry (draft by default).'],
                ['/api/changelog PATCH /:id', 'platform admin', 'Update entry fields.'],
                ['/api/changelog DELETE /:id', 'platform admin', 'Delete entry.'],
                ['/api/changelog PATCH /:id/publish', 'platform admin', 'Publish or unpublish a changelog entry.'],
              ]}
            />
          </section>

          {/* ── CASH RECONCILIATION ──────────────────────────── */}
          <section id="cash-recon" data-doc="">
            <H2>Cash Reconciliation</H2>
            <P>
              Daily till declaration + weekly reconciliation, per venue (migration 027). Config
              tables (income sources, payment channels, SC sources, expense categories, staff)
              are all drag-reorderable lists scoped by <Mono>venue_id</Mono>; daily figures live
              on <Mono>cash_daily_reports</Mono> + child entry tables; wages are a separate weekly
              cycle.
            </P>
            <H3>Service charge sources — signed Takings/Income effect</H3>
            <P>
              Migration 096. <Mono>cash_sc_sources.takings_effect</Mono> and{' '}
              <Mono>income_effect</Mono> are each <Mono>'none' | 'add' | 'subtract'</Mono> (replacing
              the earlier <Mono>included_in_takings</Mono>/<Mono>included_in_income</Mono>{' '}
              booleans from migrations 033/034, which only supported a fixed direction per flag —
              see the shared <Mono>scEffectAmount(effect, amount)</Mono> helper in{' '}
              <Mono>CashRecon.jsx</Mono>: <Mono>'add'</Mono> → <Mono>+amount</Mono>,{' '}
              <Mono>'subtract'</Mono> → <Mono>-amount</Mono>, <Mono>'none'</Mono> → <Mono>0</Mono>.
            </P>
            <P>
              The variance adjustment for one source is{' '}
              <Mono>scEffectAmount(takings_effect, amount) + scEffectAmount(income_effect,
              amount)</Mono>, summed across all active SC sources — computed identically in{' '}
              <Mono>variance(date)</Mono> (the week spreadsheet grid) and the{' '}
              <Mono>scAdjustment</Mono> useMemo (the day-declaration summary), both in{' '}
              <Mono>CashRecon.jsx</Mono>. There is no server-side duplicate of this math —{' '}
              <Mono>week-detail</Mono> returns raw <Mono>cash_sc_entries</Mono> rows only, the
              frontend computes variance client-side against the loaded{' '}
              <Mono>config.sc_sources</Mono>.
            </P>
            <InfoBox type="info">
              Migration 096's data migration maps the old booleans onto the new columns so every
              existing source computes an IDENTICAL adjustment number before and after:{' '}
              <Mono>included_in_takings = true</Mono> → <Mono>takings_effect = 'add'</Mono>;{' '}
              <Mono>included_in_income = true</Mono> → <Mono>income_effect = 'subtract'</Mono>. This
              looks asymmetric (why does "income" default to subtract, not add?) because the OLD
              hardcoded formula was itself asymmetric — see migration 034's comment table. The new
              model has no such asymmetry: both effects use the same <Mono>add</Mono>/{' '}
              <Mono>subtract</Mono> vocabulary and either can go either way per source.
            </InfoBox>
            <H3>Variance sign (migration 097 fix)</H3>
            <P>
              Variance is <Mono>Takings − (Income + scAdjustment)</Mono> — actual minus expected, the
              standard reconciliation convention. Positive means a surplus (took in more than
              declared), negative means a shortfall (took in less). This is computed independently
              in three places that must stay in sync: <Mono>variance(date)</Mono> in{' '}
              <Mono>SpreadsheetView</Mono> (week grid), the day-view's <Mono>const variance</Mono>,
              and <Mono>WeekView</Mono>'s 7-day cards, which now reads the{' '}
              <Mono>variance</Mono> field the <Mono>GET /:venueId/cash-recon/week/:week_start</Mono>{' '}
              route already returns (<Mono>total_takings − total_income</Mono>) instead of
              recomputing its own.
            </P>
            <InfoBox type="warn">
              Before migration 097 the formula was inverted (<Mono>Income − Takings</Mono>) in all
              three places — a surplus showed as negative and a shortfall as positive. The amber/red
              colour thresholds (<Mono>variance &gt; 0</Mono> → amber, <Mono>&lt; 0</Mono> → red)
              were left unchanged; flipping the underlying number's sign alone was enough to make
              them read correctly (shortfall → red, surplus → amber).
            </InfoBox>
            <H3>Variance with till payouts (supersedes the formula above)</H3>
            <P>
              Staff pay the day's expenses and the week's cash wages out of the till before counting,
              so counted cash is what is banked and is already short by those payouts. Variance adds
              them back. Day: <Mono>Takings + cash expenses + cash wages paid that day − (Income +
              scAdjustment)</Mono>. Week: sum of day variances <Mono>+ weekUnassignedWages()</Mono>{' '}
              (cash wages with no <Mono>paid_date</Mono>, or one outside the visible days).
              <Mono>cash_wage_entries.paid_date</Mono> (migration 112) is the day a wage came out of
              the till; <Mono>GET .../week-detail</Mono> returns <Mono>wages_cash_by_date</Mono>{' '}
              (<Mono>reconCalc().dayWages()</Mono>), <Mono>GET .../week</Mono> returns each day's{' '}
              <Mono>wages_cash</Mono> and <Mono>wages.unassigned_cash_wages</Mono> (wages on a day
              with no daily report count as unassigned there, since that route only has variances for
              reported days). The day view reads the same week-detail query. Paid date is validated to
              the week (422 otherwise) on the whole-list <Mono>PUT /wages/:week_start</Mono>, the only
              wage write route since migration 137 (the per-entry <Mono>/paid</Mono> and{' '}
              <Mono>/paid-date</Mono> PATCHes and wage submit/unsubmit were removed).{' '}
              <Mono>PaidDaySelect</Mono> is exported from <Mono>CashRecon.jsx</Mono> and used by{' '}
              <Mono>WeekWagesEditor</Mono>; rota fill-wages never touches <Mono>paid_date</Mono>.
              Implemented
              once in <Mono>reconCalc()</Mono> (<Mono>variance(date)</Mono>,{' '}
              <Mono>weekVariance()</Mono>), mirrored by the day view's <Mono>const variance</Mono>{' '}
              and by the <Mono>GET .../week/:week_start</Mono> route's per-day <Mono>variance</Mono>{' '}
              (used by <Mono>WeekView</Mono> and <Mono>MobileCashUp.jsx</Mono>, which adds{' '}
              <Mono>wages.unassigned_cash_wages</Mono> for its week figure). That route now computes each
              total in its own subquery with the same filters as <Mono>reconCalc()</Mono> (active
              sources/channels, <Mono>exclude_from_recon</Mono> income left out, SC effects,{' '}
              <Mono>!paid_by_card</Mono> expenses); the old version joined income and takings entries
              together and summed, which multiplied both totals whenever a day had more than one row
              of each. Net Cash and Cash to bank were removed: the grid, the day view and the
              dashboard balance widgets end at the variance.
            </P>
            <H3>Net Cash / Cash to bank — cash-only channels (removed)</H3>
            <P>
              <Mono>cash_payment_channels.counts_as_cash</Mono> (migration 097, boolean, default{' '}
              <Mono>true</Mono> only where <Mono>type = 'cash'</Mono>) flags which Takings channels
              actually become physical cash in the till. <Mono>Net Cash</Mono> and the week-grid's
              final row (relabelled <Mono>Cash to bank</Mono>, was "Net Position") sum only channels
              where <Mono>counts_as_cash !== false</Mono> — see <Mono>cashChannels</Mono> /{' '}
              <Mono>cashTakingsTotal(date)</Mono> in <Mono>CashRecon.jsx</Mono>.{' '}
              <Mono>Total Takings</Mono> and <Mono>Variance</Mono> are unaffected and still sum every
              active channel regardless of the flag — only the two cash-specific rows are filtered. A
              "Non-cash" badge renders next to any such channel in both the week-grid row label and
              the day-view Takings list.
            </P>
            <H3>Wages schema</H3>
            <DataTable
              head={['Table', 'Purpose']}
              rows={[
                ['cash_staff', 'Per-venue staff list with a default_rate, pay_type (hourly | fixed, migration 104), and since migration 106 role_id (staff_roles) and pay_basis (week | day | shift, used by fixed staff). default_rate is £/hr for hourly, £ per week/day/shift for fixed. pay_type seeds entry_type when the person is added to a week. CRUD and reorder moved to /api/rota/venues/:venueId/staff* (see Staff & Rota); GET /cash-recon/config still returns the rows.'],
                ['cash_wage_reports', 'One per venue per ISO week (week_start) plus notes. status / submitted_at were dropped in migration 137: wages are never submitted or locked (days are).'],
                ['cash_wage_entries', 'One per staff member per report. total is the full wage cost; bank_amount (migration 140) is the part paid by bank transfer; cash_amount is the cash actually handed over. Cash due = total − bank_amount. A part-paid row (cash_amount > 0 and cash_amount + bank_amount < total) carries total − bank_amount − cash_amount into next week\'s rota pay (carried_owed, see Staff & Rota). Only cash_amount counts in Cash Recon variance. The whole-list PUT keeps an entry\'s id when the client sends one that was already in that week (anything else gets a new id).'],
                ['cash_wage_defaults', "(migration 093) tenant_id, venue_id, staff_id, entry_type, sort_order — UNIQUE(venue_id, staff_id). The venue's saved default staff list for 'Set as default'; entries without a staff_id (ad-hoc) are never included since there's no stable identity to carry over week to week."],
              ]}
            />
            <H3>WeekWagesEditor (one wages editor)</H3>
            <P>
              <Mono>components/cashRecon/WagesTable.jsx</Mono> exports <Mono>WeekWagesEditor</Mono>{' '}
              (<Mono>{'{ venueId, weekStart, defaultPaidDay, showWeekNotes, layout }'}</Mono>), used by
              the Cash Recon Wages page (<Mono>WagesView</Mono>), both Cash Dashboard wage widgets
              (<Mono>cash_wages_paid</Mono> and <Mono>cash_week_staff</Mono> render the same editor,
              with <Mono>defaultPaidDay = ctx.selectedDay</Mono>) and <Mono>MobileWages.jsx</Mono>{' '}
              (<Mono>layout="cards"</Mono>). Columns: Name, Total, Paid (<Mono>cash_amount</Mono>, with a
              Full button), Paid on, Notes. Pay type, hours and rate are not shown: <Mono>toRow()</Mono>{' '}
              / <Mono>toPayload()</Mono> carry them through unchanged, except that typing a Total sets{' '}
              <Mono>entry_type = 'fixed'</Mono> and clears hours/rate. Edits live in a local draft
              (reset when venue or week changes) and are written by Save with the whole-list PUT;
              Discard drops them. A payment defaults its <Mono>paid_date</Mono> to{' '}
              <Mono>defaultPaidDay</Mono>, else today when it is in the week; a row with no cash paid
              is sent with <Mono>paid_date: null</Mono>. Set as default posts each staff member's own{' '}
              <Mono>cash_staff.pay_type</Mono> as the entry_type (types aren't edited here). Layout is
              a table row per person from 640px of its own width (<Mono>ResizeObserver</Mono>), cards
              below. Save invalidates the wages, week, week-detail and <Mono>rota-pay</Mono> queries
              (a part-paid row changes next week's rota pay).
            </P>
            <H3>Filling a week's wage entries</H3>
            <P>
              <Mono>CashRecon.jsx</Mono> exports the one implementation used by{' '}
              <Mono>WagesView</Mono>, <Mono>MobileWages.jsx</Mono> and the Cash Dashboard's{' '}
              <Mono>cash_week_staff</Mono> widget: <Mono>wageEntryForStaff(staff, entryType)</Mono>{' '}
              (hourly puts <Mono>default_rate</Mono> in <Mono>rate</Mono>, fixed puts it in{' '}
              <Mono>total</Mono>; <Mono>entryType</Mono> defaults to the staff member's{' '}
              <Mono>pay_type</Mono>), <Mono>defaultWageEntries(config, weekStart)</Mono> (the{' '}
              <Mono>wage_defaults</Mono> list with its own entry_type, else every active staff member
              by pay_type; both leave out people whose <Mono>left_on</Mono> is before{' '}
              <Mono>weekStart</Mono>, via <Mono>leftBeforeWeek()</Mono>, which the Add person list uses
              too), plus <Mono>PAY_TYPES</Mono> and <Mono>staffRateLabel()</Mono>. Change how a
              new week is filled there, not in a page.
            </P>
            <H3>Cash-only net balance</H3>
            <P>
              Both wage-total queries in <Mono>cashRecon.js</Mono> (<Mono>week-detail</Mono> and{' '}
              <Mono>week</Mono> routes) select <Mono>SUM(total)</Mono> AND{' '}
              <Mono>SUM(cash_amount)</Mono> side by side. The frontend's net-position calculations
              (<Mono>weekNetPosition()</Mono> in <Mono>SpreadsheetView</Mono>, the Wages card in{' '}
              <Mono>WeekView</Mono>) subtract only the cash-amount sum. Wherever wages are shown,
              an <Mono>AlertTriangle</Mono> flag appears when the two sums don't match.
            </P>
            <P>
              <Mono>POST /:venueId/cash-recon/wages/:week_start/set-default</Mono> replaces the
              venue's <Mono>cash_wage_defaults</Mono> rows from the current week's entries
              (staff_id + entry_type only, filtering out entries with no staff_id). The wages{' '}
              <Mono>GET /config</Mono> response includes the resolved default list (joined with
              staff name/rate) as <Mono>wage_defaults</Mono>; the frontend's auto-populate{' '}
              <Mono>useEffect</Mono> falls through defaults → full active-staff roster → empty, in
              that order, whenever a week has no saved entries yet.
            </P>
            <InfoBox type="warn">
              A resolved <Mono>null</Mono> from a TanStack Query is not the same as{' '}
              <Mono>undefined</Mono>. <Mono>GET .../wages/:week_start</Mono> returns{' '}
              <Mono>null</Mono> (not 404) when no wage report exists yet for that week — a guard
              like <Mono>if (!wagesData || !config) return</Mono> treats that confirmed-empty{' '}
              <Mono>null</Mono> the same as "still loading" (<Mono>undefined</Mono>), so a
              brand-new week never reached the auto-populate branch. Check{' '}
              <Mono>wagesData === undefined</Mono> specifically when a query's success value can
              legitimately be <Mono>null</Mono>.
            </InfoBox>
            <H3>Expense VAT amount (migration 099)</H3>
            <P>
              <Mono>cash_expenses.vat_amount</Mono> (numeric, default 0) is a second figure
              alongside the existing <Mono>amount</Mono> — purely informational. <Mono>amount</Mono>{' '}
              is, and remains, the gross (VAT-inclusive) figure every reconciliation calculation
              already uses (<Mono>total_expenses</Mono>, <Mono>Net Cash</Mono>/<Mono>Cash to
              bank</Mono>); <Mono>vat_amount</Mono> is never added to or subtracted from anything —
              it's recorded purely so the VAT portion is available for bookkeeping. All three
              write paths accept it identically: the whole-day <Mono>PUT /daily/:date</Mono> (via{' '}
              <Mono>ExpenseEntrySchema</Mono>), and the individual{' '}
              <Mono>POST /:venueId/cash-recon/expenses</Mono> /{' '}
              <Mono>PUT /:venueId/cash-recon/expenses/:expenseId</Mono> routes. Shown as a small
              "VAT £x" line under the gross amount wherever an expense is listed, and as a second
              "VAT amount" input next to "Gross amount" in both the add/edit forms
              (<Mono>CashRecon.jsx</Mono>'s <Mono>ExpensesSection</Mono> and{' '}
              <Mono>MobileExpenses.jsx</Mono>'s <Mono>ExpenseModal</Mono>).
            </P>
            <H3>Reading a receipt (migration 197)</H3>
            <P>
              The expense forms (<Mono>ExpensesSection</Mono> in <Mono>CashRecon.jsx</Mono>,{' '}
              <Mono>ExpenseModal</Mono> in <Mono>MobileExpenses.jsx</Mono>) show{' '}
              <Mono>ReadReceiptButton</Mono> (<Mono>components/cashRecon/ReceiptRead.jsx</Mono>) when Pepper
              can be used: the photo or PDF goes to <Mono>POST /api/ai/receipts/read</Mono>{' '}
              (<Mono>services/receiptReadAi.js</Mono>, effort low, the venue's active expense category names
              sent along), which returns the form's fields; <Mono>applyReceipt()</Mono> lays them over the form
              and the photo becomes the pending receipt (uploaded by the usual receipt route on save). VAT is
              kept only when printed and not above the total; a category only when Pepper names one of the
              venue's exactly. <Mono>ReceiptNote</Mono> says when the receipt has another date; the phone
              form can create the expense on that day (<Mono>onSave(body, photo, date)</Mono>). Nothing is saved
              by reading.
            </P>
            <H3>Expense paid by card (migration 100)</H3>
            <P>
              <Mono>cash_expenses.paid_by_card</Mono> (boolean, default false) marks an expense
              paid by card instead of from the till. Card-paid rows are still stored in full
              (receipt, VAT, category) but are excluded from every cash figure: the week-detail
              route's per-day <Mono>total_expenses</Mono> now sums only{' '}
              <Mono>!paid_by_card</Mono> rows and returns the card sum separately as{' '}
              <Mono>total_card_expenses</Mono>. Because <Mono>SpreadsheetView</Mono>'s{' '}
              <Mono>dayExpenses()</Mono> reads <Mono>total_expenses</Mono>, the variance drops card
              expenses with no further change. The day view's{' '}
              <Mono>totalExpenses</Mono> memo filters the same way client-side, and so does{' '}
              <Mono>MobileExpenses.jsx</Mono>'s day total. All three write paths accept the flag
              (<Mono>ExpenseEntrySchema</Mono> for the whole-day PUT, plus the individual POST/PUT
              expense routes). Shared UI lives in <Mono>CashRecon.jsx</Mono>:{' '}
              <Mono>PaidByCardToggle</Mono> (form checkbox) and <Mono>CardBadge</Mono> (list tag),
              both reused by the mobile page. Card totals are shown as a separate "Paid by card
              (not in recon)" line in the day summary, the week grid and the mobile day total.
            </P>
            <P>
              <strong>Expenses on a submitted day.</strong> Adding (<Mono>POST .../expenses</Mono>) and
              the whole-day PUT already refused a submitted report; changing and deleting one expense
              didn&apos;t, so a submitted day&apos;s figures could move after sign-off.{' '}
              <Mono>assertExpenseOpen()</Mono> in <Mono>cashRecon.js</Mono> (the expense must be the
              venue&apos;s and its report not submitted, else 404 / 422 "unsubmit first") now runs
              before <Mono>PUT</Mono> and <Mono>DELETE .../expenses/:expenseId</Mono>. A receipt can
              still be added or removed on a submitted day (it changes no figure).
            </P>
            <H3>Admin theming — SectionCard</H3>
            <P>
              <Mono>SectionCard</Mono> (used by every Cash Recon section — Income, Service
              Charges &amp; Tips, Takings, Wages, Expenses) has a coloured <Mono>header</Mono> bar
              using the <Mono>--site-accent</Mono> CSS variable (see <Mono>/api/me:
              site_theme</Mono> in the Navigation &amp; Launcher section). The optional{' '}
              <Mono>footer</Mono> prop (the "Total ..." row in each daily-declaration section) is
              deliberately plain (<Mono>bg-muted/30</Mono>, no accent) — an earlier version
              coloured it to match the header, but two accent bars per card (top and bottom) read
              as too heavy/repetitive for a running total; header-only is the current design.
            </P>
            <InfoBox type="warn">
              <Mono>SectionCard</Mono>'s own <Mono>mb-4</Mono> margin was removed — spacing between
              stacked cards on the daily-declaration page now comes entirely from{' '}
              <Mono>space-y-4</Mono> on the page's outer wrapper (it had been{' '}
              <Mono>space-y-0</Mono>, relying on each card's own margin, which visually produced
              zero gap between a section's footer and the next section's header — colour-matched
              accent bars touching directly with no visible seam). Two sources of spacing for the
              same layout (a component's own margin + a parent's <Mono>space-y</Mono>) is exactly
              the kind of thing that looks fine until one of the two silently stops applying —
              pick one mechanism per layout and keep spacing there, not split across both.
            </InfoBox>
            <H3>Fields filled by other systems</H3>
            <P>
              <Mono>GET /api/venues/:venueId/cash-recon/links</Mono> (Cash Recon view) returns,
              from <Mono>reconLinks()</Mono> in <Mono>services/reconLinks.js</Mono>,{' '}
              <Mono>{'{ sources: [{ key, label, where, note, fields }], fields: { "income:<id>": [{ source, label, terms: [{ label, sign }] }] } }'}</Mono>.
              Groups are <Mono>income</Mono>, <Mono>takings</Mono> (payment channels) and{' '}
              <Mono>sc</Mono>, the same keys every filler maps by. <Mono>LINK_SOURCES</Mono> holds one
              entry per system: <Mono>pos</Mono> (<Mono>pos_settings.recon_map</Mono>, revenue
              streams and tenders by name, set in Store tech, <Mono>where.route</Mono>),{' '}
              <Mono>loyverse</Mono> and <Mono>gloriafood</Mono> (<Mono>*_venue_links.mappings</Mono>,
              worded by each one's <Mono>termLabel()</Mono>, <Mono>where.tab</Mono>). A system not set
              up at the venue is left out; a field nothing fills has no entry. The settings tabs
              (<Mono>useReconLinks()</Mono>, <Mono>LinkedFrom</Mono>, <Mono>LinkedSystems</Mono> in{' '}
              <Mono>CashRecon.jsx</Mono>) read it on every visit, since the Loyverse and GloriaFood
              tabs change it. A new system that fills Cash Recon through <Mono>fillReconDay()</Mono>{' '}
              adds its entry to <Mono>LINK_SOURCES</Mono>; the tabs show it with no other change.
            </P>
            <H3>Loyverse (migration 154)</H3>
            <P>
              Fills a day's income, SC and takings rows from the venue's Loyverse POS sales. Two
              tables: <Mono>loyverse_connections</Mono> (a tenant's Loyverse account: an access token
              stored as typed and never returned by any route, <Mono>token_hint</Mono> = last 4,
              business name / currency from <Mono>GET /merchant</Mono>, <Mono>last_error</Mono> when
              Loyverse rejects it) and <Mono>loyverse_venue_links</Mono> (one per venue: connection,
              <Mono>store_id</Mono>, <Mono>day_starts_at</Mono> HH:MM, <Mono>mappings</Mono> jsonb).
              <Mono>cash_daily_reports.loyverse_filled_at</Mono> / <Mono>loyverse_filled_by</Mono>{' '}
              record the last fill; <Mono>GET .../week-detail/:week</Mono> returns them (and
              GloriaFood's) per day as <Mono>days[date].filled</Mono>{' '}
              <Mono>{'{ loyverse, gloriafood }'}</Mono>, each <Mono>{'{ at, by }'}</Mono> or null,
              for the dashboard's import widget (<Mono>cash_import</Mono>, migration 212).
            </P>
            <P>
              Mapping: <Mono>{'{ income: { sourceId: [term] }, takings: { channelId: [term] }, sc: { sourceId: [term] } }'}</Mono>,
              term <Mono>{'{ sign: 1 | -1, kind, ref?, label? }'}</Mono>. A field's value is the signed
              sum of its terms; a field with no terms is never written. All figure maths is in{' '}
              <Mono>shared/loyverse.js</Mono> (<Mono>summariseReceipts()</Mono>, <Mono>sumTerms()</Mono>,{' '}
              <Mono>termLabel()</Mono>, <Mono>TOTAL_KINDS</Mono>, <Mono>REF_KINDS</Mono>), in pence.
            </P>
            <DataTable
              head={['kind', 'Value for a trading day']}
              rows={[
                ['gross_sales', 'Sum of line gross_total_money on SALE receipts.'],
                ['refunds', 'Sum of line gross_total_money on REFUND receipts (positive).'],
                ['discounts / taxes / tips / surcharges', 'Receipt total_discount / total_tax / tip / surcharge: sales minus refunds.'],
                ['net_sales', 'gross_sales - refunds - discounts (the Loyverse sales summary definition).'],
                ['total_collected', 'Receipt total_money: sales minus refunds.'],
                ['item (ref = item_id)', 'Line total_money (after discounts) for that item: sales minus refunds.'],
                ['category (ref = category_id)', 'Same, for every item whose category is ref (item to category from GET /items, only read when a mapping uses a category).'],
                ['payment_type (ref = payment_type_id)', 'payments[].money_amount for that type: sales minus refunds.'],
              ]}
            />
            <P>
              Receipts: <Mono>services/loyverseSvc.js</Mono> <Mono>venueDays()</Mono> reads{' '}
              <Mono>GET /receipts?store_id=&amp;created_at_min=&amp;created_at_max=</Mono> once for the
              whole run of days (cursor paging, 250 a page), with <Mono>created_at_max</Mono> two days past
              the last day so receipts a till synced late are found, then places each receipt by{' '}
              <Mono>receipt_date</Mono> in a trading day: <Mono>[day_starts_at on the date,
              day_starts_at the next day)</Mono> in the venue time zone (<Mono>tradingDay()</Mono>, via{' '}
              <Mono>zonedToUtc()</Mono>). Cancelled receipts (<Mono>cancelled_at</Mono>) are left out;
              refunds count on the day they were refunded; refund amounts are taken as positive
              whichever way they are signed. Base URL <Mono>LOYVERSE_API_URL</Mono> (default{' '}
              <Mono>https://api.loyverse.com/v1.0</Mono>, changed only for tests). Loyverse failures become
              a 422 with a plain message (<Mono>LoyverseError</Mono>); a rejected token also sets the
              connection's <Mono>last_error</Mono>.
            </P>
            <DataTable
              head={['Route (/api/loyverse)', 'Access', 'What it does']}
              rows={[
                ['GET /connections', 'cash_recon view', 'Accounts without tokens, with venue_count.'],
                ['POST /connections, PATCH /connections/:id', 'owner/admin + cash_recon manage', 'Add / rename / replace token. A new token is checked with GET /merchant first and refused if Loyverse rejects it.'],
                ['POST /connections/:id/test, DELETE /connections/:id', 'owner/admin + manage', 'Check the saved token (sets last_error); remove the account and its venue links.'],
                ['GET /connections/:id/catalog', 'owner/admin + manage', 'Stores, payment types, categories, items (deleted ones left out) for the mapping editor.'],
                ['GET /venues/:venueId/link', 'cash_recon view', 'The link and mapping, or null (also decides whether Fill buttons show).'],
                ['PUT /venues/:venueId/link', 'owner/admin + manage', 'Store must be on the account (checked with Loyverse); mapping keeps only this venue\'s active fields and valid terms.'],
                ['DELETE /venues/:venueId/link', 'owner/admin + manage', 'Unlink.'],
                ['POST /venues/:venueId/preview', 'cash_recon view', 'from/to (31 days max): per day the Loyverse value and current Cash Recon value of each mapped field, totals, payments with a mapped flag, status.'],
                ['POST /venues/:venueId/apply', 'cash_recon manage', 'dates[]: reads Loyverse again (never takes figures from the browser), then per day creates the report if needed, skips submitted days, replaces only each mapped field\'s entry (keeping its notes; income VAT split by the source\'s rate as the day view does) and sets loyverse_filled_*.'],
              ]}
            />
            <P>
              Income, takings and SC entry amounts may be negative (a day where refunds beat sales);
              the day PUT's Zod schemas no longer have <Mono>min(0)</Mono>, and the day view's amount
              input has no <Mono>min</Mono>. Expenses and wages stay at 0 or more. Admin:{' '}
              <Mono>components/cashRecon/Loyverse.jsx</Mono> (<Mono>LoyverseSettings</Mono> as the
              Loyverse tab of Cash Recon settings, <Mono>LoyverseFillButton</Mono> /{' '}
              <Mono>LoyverseFillModal</Mono> on the day view (body row in <Mono>hideHeader</Mono> mode for{' '}
              <Mono>/mobile/cash-up</Mono>), the week grid and the week cards). After a fill the modal
              invalidates <Mono>cash-recon-daily</Mono>, <Mono>cash-recon-week-detail</Mono> and{' '}
              <Mono>cash-recon-week</Mono>; the grid clears its local overrides.
            </P>
            <InfoBox type="warn">
              The Loyverse API was built from its documented v1.0 shape and tested against a stand-in
              server, not a live Loyverse account. Check the first real fill against the Loyverse
              Back Office sales summary for the same day and store.
            </InfoBox>
            <H3>GloriaFood (migration 159)</H3>
            <P>
              Stores the venue&apos;s accepted GloriaFood online orders, fills a day&apos;s income, SC and
              takings rows from them like Loyverse, and can show them on the Online orders board.
              GloriaFood&apos;s Accepted Orders API v2 only hands an order over when it is accepted (push to
              our URL, or a pop that returns each order once), so every order is stored on arrival in{' '}
              <Mono>gloriafood_orders</Mono> (upserted by <Mono>(tenant_id, gf_order_id)</Mono>; an older{' '}
              <Mono>updated_at</Mono> never overwrites a newer one; money in pence; dishes in{' '}
              <Mono>items</Mono> for the board; <Mono>payload</Mono> is the order as sent minus guest
              details). <Mono>gloriafood_venue_links</Mono> is one per venue: <Mono>method</Mono> push |
              poll, <Mono>push_token</Mono> (24 random bytes, the URL&apos;s only check, never in the link
              view), <Mono>poll_key</Mono> (never returned, <Mono>poll_key_hint</Mono>), the restaurant
              learned from the first order (<Mono>gf_restaurant_id</Mono>; other restaurants&apos; orders
              are refused with <Mono>last_error</Mono>), <Mono>day_basis</Mono> fulfill | accepted,{' '}
              <Mono>day_starts_at</Mono>, <Mono>show_on_board</Mono>, <Mono>mappings</Mono> (Loyverse&apos;s
              shape). Filled days record <Mono>cash_daily_reports.gloriafood_filled_at</Mono> /{' '}
              <Mono>_by</Mono> through <Mono>fillReconDay()</Mono>.
            </P>
            <P>
              <Mono>shared/gloriafood.js</Mono>: <Mono>orderFromPayload()</Mono> (items = type item rows;
              discounts = item_discount of promo_cart / promo_item / promo_cart_item rows, so children are not
              counted twice; delivery, tip, service fees net of cash_discount; checked against both GloriaFood
              sample orders: items - discounts = sub_total_price), <Mono>summariseOrders()</Mono> (only{' '}
              <Mono>status = &apos;accepted&apos;</Mono>, never <Mono>source = &apos;admin&apos;</Mono> test
              orders; counts cancelled and split payments), <Mono>sumTerms()</Mono>. Figures: total,
              net_total, subtotal, items, discounts, delivery_fees, tips, service_fees, tax; refs payment
              (GloriaFood&apos;s <Mono>payment</Mono>: ONLINE, CASH, CARD, CARD_PHONE or others) and order_type.
              An order paid two ways (<Mono>used_payment_methods</Mono> has 2) counts under{' '}
              <Mono>payment</Mono>: GloriaFood doesn&apos;t send the split amounts.
            </P>
            <DataTable
              head={['Piece', 'What it does']}
              rows={[
                ['POST /webhooks/gloriafood/:token', 'gloriafoodWebhookRoutes (root, no auth, 240/min per token). Looks the venue up by push_token, takes { count, orders }, an array or one order, ingests, answers { ok, stored, updated, refused }. XML or text: 415 and last_error says to switch the integration to JSON. Unknown token: 404.'],
                ['services/gloriafoodSvc.js', 'popOrders(key) (POST {GLORIAFOOD_API_URL}/pos/order/pop, Authorization = key, Glf-Api-Version 2; 401/403 = key problem), ingestWithTx() (locks the link row, learns / checks the restaurant, upserts, sets last_order_at / last_error), pollVenue() (pop and store in one transaction under pg_try_advisory_xact_lock per link; orders popped but not stored are written to the log), pollAll() (every poll venue, then clears client_name / phone / address older than 30 days), venueDays() (trading-day windows from tradingDay(), by fulfill_at or accepted_at), boardOrders() / boardOrder().'],
                ['jobs/queues.js', 'gloriafood-poll queue, repeat every 60 s, worker started in server.js (every API process; one run per tick).'],
                ['GET|PUT|DELETE /api/gloriafood/venues/:venueId/link', 'View (no token or key), save (owner/admin + cash_recon manage; a new poll key is checked by polling with it, waiting orders are stored, a rejected key restores the old one or removes a new link), unlink (orders kept).'],
                ['GET .../push-url, POST .../push-url/new, POST .../restaurant/reset, POST .../poll', 'The address (setup only), a new token, forget the learned restaurant, check GloriaFood now (cash_recon manage, poll venues only).'],
                ['GET .../orders, GET .../seen', 'Latest stored orders (view), payment methods and order types known plus seen (setup).'],
                ['POST .../preview, POST .../apply', 'As Loyverse (31 days max). Preview polls a poll venue first (poll_error on failure, never thrown) and returns values[key].source; apply works only from stored orders, skips submitted days, keeps notes.'],
                ['Board', 'GET /api/orders appends boardOrders() (status accepted or canceled, fulfill_at on the board day in venue time) when show_on_board, sorted by promised_at, and returns gloriafood.show_on_board. For a day before today (venue time) it passes includeImported, so imported orders come too, with imported: true, import_file / import_line and is_asap false. POST /api/orders/gloriafood/:id/status { to: accepted | preparing | ready | completed } (web_orders manage) changes board_status only; a cancelled or imported order is 422. Broadcasts order.created / order.updated with source gloriafood.'],
                ['GET .../day?date=YYYY-MM-DD', 'dayOrders(): every stored order (any status, live or imported) whose fulfill_at or accepted_at (link day_basis) falls in that trading day (tradingDay() with day_starts_at, as venueDays()), up to 2,000, ordered by time. Returns { date, timezone, day_basis, day_starts_at, currency, figures, orders }: figures from summariseOrders() (orders, cancelled, test_orders, not_counted, total / subtotal / tips / delivery / service fees / tax in pence, payments and types with counts), so they match the fill preview; each order has its pence columns, status_label, counts (countsInRecon()), labels, used_payment_labels, received_via, imported + import_file / import_line and its dishes. No guest details or notes. cash_recon view; 422 when the venue isn\'t linked.'],
              ]}
            />
            <P>
              Admin: <Mono>components/cashRecon/GloriaFood.jsx</Mono> (<Mono>GloriaFoodSettings</Mono> = the
              GloriaFood tab of Cash Recon settings, <Mono>GloriaFoodFillButton</Mono> next to every Loyverse
              button). The mapping editor and the fill window are shared with Loyverse in{' '}
              <Mono>components/cashRecon/reconShared.jsx</Mono> (<Mono>MappingGroups</Mono>,{' '}
              <Mono>ReconFillModal</Mono> with a <Mono>source</Mono> config, <Mono>TermChip</Mono>,{' '}
              <Mono>useReconLinkPerms()</Mono>). Board: <Mono>isGloriaFood()</Mono>,{' '}
              <Mono>GloriaFoodBadge</Mono>, <Mono>ImportedBadge</Mono>, <Mono>GloriaFoodOrderModal</Mono> (imported
              orders: a note, no guest block, print or status buttons) and the <Mono>gfStatus</Mono> action in{' '}
              <Mono>components/orders/shared.jsx</Mono>; on a past day the board opens Done by itself, and its
              order count leaves out <Mono>is_test</Mono> orders. A day&apos;s orders:{' '}
              <Mono>GloriaFoodOrdersButton</Mono> (day view header, and the button strip of the header-less day view
              in <Mono>/mobile/cash-up</Mono>; shown whenever the venue has a link, also on submitted days and to
              cash_recon view) opens <Mono>GloriaFoodDayOrders</Mono>: day arrows, figure tiles, payments, one
              expandable row per order (<Mono>DayOrderRow</Mono>).
            </P>
            <InfoBox type="warn">
              Built from GloriaFood&apos;s published Accepted Orders API v2 and its two sample orders, and
              tested against a stand-in server, not a live GloriaFood restaurant. Check the first real
              orders (amounts, payment, fulfil time) against GloriaFood&apos;s own order list, and that the
              integration accepts our address.
            </InfoBox>
            <H3>GloriaFood: importing past orders (migration 162)</H3>
            <P>
              The API has no history, so days before the link come from the order list GloriaFood&apos;s
              admin exports. Imported orders go into <Mono>gloriafood_orders</Mono> with{' '}
              <Mono>received_via = &apos;import&apos;</Mono> (migration 162 widens the CHECK) and{' '}
              <Mono>board_status = &apos;completed&apos;</Mono>, no <Mono>items</Mono> and a{' '}
              <Mono>payload</Mono> of only <Mono>{'{ imported: { file, line } }'}</Mono>, so{' '}
              <Mono>venueDays()</Mono> / <Mono>summariseOrders()</Mono> fill Cash Recon from them unchanged.
              They are left out of today&apos;s board (<Mono>boardOrders()</Mono> takes them only with{' '}
              <Mono>includeImported</Mono>, for past days, view only), the settings tab&apos;s latest orders and its
              Orders received count; <Mono>GET .../day</Mono> lists them with the live ones.{' '}
              <Mono>gloriafood_venue_links.last_import_at</Mono> /{' '}
              <Mono>_by</Mono> / <Mono>_file</Mono> record the last import.
            </P>
            <P>
              <Mono>shared/gloriafood.js</Mono>: <Mono>IMPORT_COLUMNS</Mono> (key, header, need: required |
              date | recommended | optional, heading aliases), <Mono>matchImportColumns()</Mono> (headings
              matched by <Mono>importHeading()</Mono>: lower case, letters and digits only; order doesn&apos;t
              matter; required = Order ID, Outcome, Total plus a Fulfillment or Confirmed date + time pair),{' '}
              <Mono>importOrderFromRow()</Mono> (amounts with or without £ and thousands commas; dates
              YYYY-MM-DD or DD/MM/YYYY; times with or without AM/PM; an id in Excel&apos;s 1.25E+09 form is a
              row problem; service fees = on subtotal + on total - cash discounts; the day is the fulfilment
              time, else confirmed, else placed; <Mono>accepted_at</Mono> = confirmed),{' '}
              <Mono>importMissingFigures()</Mono> (items and discounts are never in the export). Guest
              columns are never read.
            </P>
            <DataTable
              head={['Piece', 'What it does']}
              rows={[
                ['importExport(tx, { tenantId, venueId, timezone, cells, fileName, apply, by })', 'Needs a link (locked FOR UPDATE when applying). Finds the header row, refuses a file missing a needed column (422 naming them) or over 50,000 rows, converts local times with zonedToUtc() in the venue time zone, last row wins for a repeated id. Each order is new, update (already imported for this venue), live (sent by push / poll: never touched), after_live (at or after the earliest push / poll order: left out so nothing counts twice) or other_venue (the id belongs to another venue: left out). Returns counts, the accepted total by payment and type, mapping_gaps (mapped figures the file lacks), not_in_file and the first 50 problems with row numbers. With apply, upserts in batches of 500; ON CONFLICT updates only rows still received_via import.'],
                ['ingestWithTx()', 'A pushed or polled copy of an imported order replaces it and switches received_via to push / poll.'],
                ['GET /api/gloriafood/venues/:venueId/import', 'Imported count and date range plus the last import (cash_recon view).'],
                ['POST .../import { file_name, data (base64), apply }', 'Preview (apply false, writes nothing) or import. CSV or .xlsx up to 16 MB, read by readFile() from routes/deliveroo.js. Owner/admin + cash_recon manage.'],
                ['DELETE .../import', 'Removes the venue\'s imported orders only (owner/admin + cash_recon manage).'],
                ['GET /api/gloriafood/import-template', 'A CSV with every IMPORT_COLUMNS heading (cash_recon view).'],
                ['POST .../preview', 'Also returns imported { count, from, to }, so the fill window doesn\'t claim no orders exist when only imported ones do.'],
              ]}
            />
            <P>
              Admin: <Mono>ImportPastOrders</Mono> in <Mono>components/cashRecon/GloriaFood.jsx</Mono>, below
              the mapping on the GloriaFood tab: columns it needs, Template, choose file, preview, Import,
              Remove imported orders (inline confirm). <Mono>checkImportReply()</Mono> turns a reply without
              <Mono>counts</Mono> / <Mono>summary</Mono> (an HTML page from a proxy, an empty body) into an error in the
              card, and a file the browser can&apos;t read (cloud placeholder, aborted read) says so; both are also
              logged to the console.
            </P>
            <InfoBox type="warn">
              Built from one real export (478 orders, all read). It assumes the export&apos;s Order ID is the
              id the API sends; if it isn&apos;t, the live cutoff still stops imported and live orders
              overlapping, except for orders a poll venue&apos;s queue still holds from before the import.
            </InfoBox>
            <H3>Day PUT and the week grid</H3>
            <P>
              <Mono>PUT /:venueId/cash-recon/daily/:date</Mono> only changes the day note when the body
              has a <Mono>notes</Mono> key: the week grid saves a day without loading its note and used to
              wipe it. The grid now also sends each expense's <Mono>vat_amount</Mono> and{' '}
              <Mono>paid_by_card</Mono> (they were reset to 0 / false on every grid save).{' '}
              <Mono>GET .../week-detail/:week_start</Mono> uses <Mono>openDatesOrNull()</Mono>, so a venue
              with no booking schedule shows every day (it showed none).
            </P>
          </section>

          {/* ── FOOD SAFETY ───────────────────────────────── */}
          <section id="food-safety" data-doc="">
            <H2>Food Safety Logs</H2>
            <P>
              SFBB-style due-diligence logging, per venue and per day. Migration 076 (core
              tables), 077 (equipment capture times), 090 (hold stations + cooking sessions as
              their own reorderable/manageable entities rather than fixed enums), 142 (cooking
              items: where the cooking-check dish buttons come from).
            </P>
            <H3>Schema</H3>
            <DataTable
              head={['Table', 'Purpose']}
              rows={[
                ['fs_equipment', 'Fridges/freezers being monitored. sort_order for drag-reorder.'],
                ['fs_capture_times', 'Named capture times for equipment checks (e.g. AM/PM) — one column per row in the Equipment grid.'],
                ['fs_temp_logs', 'One row per equipment reading per capture time per day. Out-of-range readings carry a nullable corrective_action.'],
                ['fs_delivery_checks', 'One row per delivery logged: supplier, temp, condition, notes.'],
                ['fs_hold_stations', 'Named hot/cold hold stations (migration 090). sort_order for drag-reorder — replaces an earlier fixed set.'],
                ['fs_hold_capture_times', 'Named capture times for hold checks, same pattern as fs_capture_times.'],
                ['fs_hold_checks', 'One row per hold-station reading per capture time per day.'],
                ['fs_cooking_sessions', 'Named cooking-check sessions (migration 090) — e.g. "Lunch service" — with a required_items_count target and optional time_of_day. sort_order for drag-reorder; a new session goes to the end (max + 1).'],
                ['fs_cooking_settings', 'Migration 142. One row per venue: item_source menus | own | both (no row = menus). Edited in H&S settings, Cooking items (GET/PUT /cooking-settings).'],
                ['fs_cooking_items', 'Migration 142. The venue\'s own cooking-check list: name, optional category (its tab; none = "Our items"), sort_order (drag), is_active (soft delete). /cooking-items CRUD + /cooking-items/reorder.'],
                ['fs_cooking_checks', 'One row per dish checked: menu_item_id (a menu dish) or cooking_item_id (an own-list item, migration 142), or neither for a typed one-off; dish_name always holds the name at the time. core_temp_c, corrective_action.'],
              ]}
            />
            <H3>API</H3>
            <P>
              Mounted at <Mono>/api/food-safety</Mono>, gated by <Mono>requirePermission('food_safety', …)</Mono>.
              Every collection follows the same shape: <Mono>GET</Mono> list for a venue/date,
              <Mono> POST</Mono> create, <Mono>PATCH</Mono> update by id, plus a
              <Mono> /reorder</Mono> endpoint for the three drag-reorderable lists
              (equipment, hold stations, cooking sessions). <Mono>PATCH /cooking/:id</Mono>{' '}
              also takes <Mono>session_id</Mono> (checked against the reading's venue) so a
              reading can be moved to another session. See <Mono>src/routes/foodSafety.js</Mono> for the full
              route list — it mirrors the schema above one-for-one (equipment, capture-times,
              temp-logs, deliveries, hold-stations, hold-capture-times, holds, cooking-sessions,
              cooking, plus a <Mono>GET /defaults</Mono> for the built-in target/min/max per
              equipment type).
            </P>
            <P>
              The cooking picker's tabs and dish buttons come from{' '}
              <Mono>GET /cooking/items?venue_id=</Mono>, which returns{' '}
              <Mono>{'{ item_source, sections: [{ id, title, kind, items: [{ id, name, kind }] }] }'}</Mono>{' '}
              from <Mono>loadCookingPicker()</Mono> in <Mono>services/cookingItems.js</Mono>: menu
              sections of the venue's published menus (venue and tenant-wide), then own-list items
              grouped by category, per <Mono>fs_cooking_settings.item_source</Mono>. The H&amp;S
              test data generator calls the same loader. <Mono>POST /cooking</Mono> takes{' '}
              <Mono>menu_item_id</Mono>, <Mono>cooking_item_id</Mono> or a typed{' '}
              <Mono>dish_name</Mono>, and copies the name into <Mono>dish_name</Mono>.
            </P>
            <H3>Key files</H3>
            <DataTable
              head={['File', 'Purpose']}
              rows={[
                ['api/src/routes/foodSafety.js', 'All food-safety routes.'],
                ['admin/src/pages/FoodSafety.jsx', 'Recording only. Tabs: Today (fridge checks + counts), Deliveries (entry-form + current-week list with click-to-edit), Holds, Cooking. Empty states open H&S settings on the right section.'],
                ['admin/src/components/hs/HsSetup.jsx', 'All food safety setup, shown as sections of the H&S settings window (HsSettings.jsx): SETUP_SECTIONS + HsSetupSection. Fridges & freezers and Hold stations (sortable lists), Fridge check times (/capture-times) and Hold check times (/hold-capture-times, kept separate), Cooking sessions (CookingSessionsSettings from shared.jsx, sortable). Remove/deactivate confirms inline. After any change it invalidates every fs-* query key so open check pages refresh.'],
                ['admin/src/components/foodSafety/shared.jsx', 'Shared panels reused by both FoodSafety.jsx and HSDashboard.jsx widgets — TempChecksTable, DeliveryChecksPanel/Board, HoldChecksTable, CookingChecksPanel, EndOfDayReview. One implementation of each check type, not two. CookingChecksPanel: the session is picked in CookingEntryModal (default: last picked in this panel, else sessionForNow(): on today, the latest session whose time_of_day has passed, else the first); Today\'s checks is grouped by session in sort order with n/required per group, readings without a (live) session last.'],
              ]}
            />
            <InfoBox type="info">
              The Cooking tab's menu-category tabs and dish buttons are deliberately styled like
              till/POS buttons (fixed height, tighter width, distinct <Mono>bg-muted/60</Mono> fill)
              since this is used mid-service on a tablet, not a form to fill in at a desk.
            </InfoBox>
            <H3>Reading pre-fill + touch keypad</H3>
            <P>
              <Mono>TempCell</Mono> / <Mono>HoldCell</Mono> initialise their local <Mono>value</Mono>{' '}
              state from <Mono>equipment.min_temp_c</Mono> / <Mono>station.min_temp_c</Mono>{' '}
              (the lower end of that equipment's configured range) when no reading exists yet,
              instead of an empty string behind a placeholder. This is display-only — the existing
              autosave path (<Mono>onChange</Mono> / <Mono>onBlur</Mono> / stepper tap) is what
              actually persists a log row, so an untouched cell never fakes a reading.
            </P>
            <P>
              On touch devices (<Mono>navigator.maxTouchPoints &gt; 0</Mono>, the same{' '}
              <Mono>IS_TOUCH</Mono> detection pattern as <Mono>NewBookingModal</Mono>'s covers
              stepper), the temp cell renders as a button instead of a native{' '}
              <Mono>&lt;input&gt;</Mono>; tapping it opens <Mono>TempKeypadModal</Mono> — a
              full-screen centred modal (never clipped by the check table's own scroll container)
              supporting one decimal place and a <Mono>±</Mono> sign toggle for negative freezer
              readings. This exists because some touch platforms (confirmed on at least one
              Linux/Chrome tablet) never surface their on-screen keyboard for a text/number input
              — a platform limitation <Mono>inputMode="decimal"</Mono> can't fix, so the app
              stops depending on it entirely for this field. Applied to{' '}
              <Mono>TempCell</Mono>, <Mono>HoldCell</Mono>, and <Mono>CookingEntryModal</Mono>'s
              core-temp field.
            </P>
            <P>
              Each row in the Cooking tab's "Today's checks" list is a button; tapping it opens{' '}
              <Mono>CookingEntryModal</Mono> with <Mono>target.existingCheck</Mono> set, which
              seeds <Mono>checkId</Mono>/<Mono>temp</Mono>/<Mono>note</Mono> from that row —{' '}
              <Mono>persist()</Mono> already routed to <Mono>onUpdate</Mono> whenever{' '}
              <Mono>checkId</Mono> is set, so this only needed the initialisation path, not new
              save logic. The dish name is shown as the modal title but isn't editable, matching{' '}
              <Mono>CookingPatch</Mono>'s schema (only <Mono>core_temp_c</Mono> /{' '}
              <Mono>corrective_action</Mono> can change once a check exists).
            </P>
            <P>
              <Mono>DELETE /api/food-safety/cooking/:id</Mono> hard-deletes a{' '}
              <Mono>fs_cooking_checks</Mono> row (no soft-delete flag on this table, and nothing
              else references its id, unlike the config entities above which use{' '}
              <Mono>is_active</Mono>). The <Mono>CookingEntryModal</Mono>'s "Delete this reading"
              control only renders when <Mono>checkId</Mono> is set (i.e. editing an existing
              check, not logging a new one) and requires an inline double-confirm (Standard
              Design Rule #6) before calling it.
            </P>
          </section>

          {/* ── CHECKLISTS ────────────────────────────────── */}
          <section id="checklists" data-doc="">
            <H2>Checklists</H2>
            <P>
              Operator-defined recurring checklists (migration 083) — unlike Food safety, there
              is no fixed set of built-in checks. Tenants build their own templates with any
              number of tasks and a daily/weekly/monthly due schedule.
            </P>
            <H3>Schema</H3>
            <DataTable
              head={['Table', 'Purpose']}
              rows={[
                ['checklist_templates', 'One row per checklist definition: name, department, frequency (daily/weekly/monthly), due_day_of_week / due_day_of_month, sort_order.'],
                ['checklist_template_items', 'Ordered tasks belonging to a template. sort_order for drag-reorder.'],
                ['checklist_instances', 'One row per template per calendar occurrence (a specific day/week/month) — created on first interaction, not pre-generated. Records completed_by / completed_at.'],
                ['checklist_instance_items', 'Tick state per instance per template item.'],
              ]}
            />
            <H3>API</H3>
            <P>
              Mounted at <Mono>/api/checklists</Mono>, gated by <Mono>requirePermission('checklists', …)</Mono>.
              <Mono> GET /due</Mono> returns every template due for a venue/date. <Mono>GET
              /instance</Mono> + <Mono>PUT /instance</Mono> load/save the tick state for one
              template on one date — the instance row is created lazily on first PUT. There is
              no complete action: <Mono>PUT /instance</Mono> sets status{' '}
              <Mono>completed</Mono> when every active template item is ticked (keeping the first{' '}
              <Mono>completed_by</Mono>/<Mono>completed_at</Mono> while it stays complete) and{' '}
              <Mono>in_progress</Mono> with both cleared otherwise. Tick all is the client sending
              every item checked. Template
              CRUD and item CRUD/reorder live under <Mono>/templates</Mono> and
              <Mono> /templates/:id/items</Mono>.
            </P>
            <H3>Closed days: follow opening days (migration 124)</H3>
            <P>
              <Mono>tenants.hs_follow_opening_days</Mono> (boolean, default false) is one switch for
              all H&amp;S: when on, a venue's closed days expect no daily checklists and no fridge,
              hold or cooking checks. "Closed" comes only from{' '}
              <Mono>services/openDays.js</Mono> (the same resolver Cash Recon and the Rota use:
              exception, then date override, then weekly template). <Mono>openDatesOrNull()</Mono>{' '}
              returns null for a venue with no weekly template (treated as open every day) and{' '}
              <Mono>hsClosedDates()</Mono> returns the closed subset of a date list, empty when the
              setting is off.
            </P>
            <DataTable
              head={['Where', 'Effect']}
              rows={[
                ['GET/PATCH /api/hs-settings', 'routes/hsSettings.js. GET ?venue_id=&date= returns { follow_opening_days, closed } (view on any of food_safety, checklists, hs_dashboard, dashboard); PATCH { follow_opening_days } is owner/admin.'],
                ['GET /api/checklists/due', 'Each row gains not_required: true for daily templates when the venue is closed that day. Weekly and monthly rows are never not_required.'],
                ['GET /api/dashboard-tiles/hs-status', 'computeHsStatus() drops daily checklists and fridge/hold/cooking from expected (and completed) on a closed venue-day; unresolved out-of-range readings still count. Venue-days and days gain closed; status is \'closed\' when nothing is expected or unresolved, future days included. Checklist breakdown rows carry not_required.'],
                ['Admin', 'components/hs/HsSettings.jsx: HsSettingsButton({ venueId, section, label }) opens the H&S settings window (General = this switch, owner/admin; the food safety setup sections from HsSetup.jsx need food_safety manage) on the page\'s venue. Used by Food safety, Checklists and the H&S Dashboard header (config.HeaderExtra, now passed venueId). ClosedDayNotice (those pages, config.Notice, MobileHSDashboard). Checklists Today groups not_required rows; Dashboard.jsx has a closed status style.'],
              ]}
            />
            <H3>Key files</H3>
            <DataTable
              head={['File', 'Purpose']}
              rows={[
                ['api/src/routes/checklists.js', 'All checklist routes.'],
                ['admin/src/pages/Checklists.jsx', 'Two tabs: Today (tick off what\'s due) and Checklists (the template builder).'],
                ['admin/src/components/checklists/shared.jsx', 'ChecklistRunPanel — the tick-list UI, reused as-is by both Checklists.jsx and the H&S Dashboard\'s checklist widget, with a Tick all button. Accepts a hideHeader + onStateChange mode ({ isCompleted, isPending, hasItems, tickAll, untickAll }) so the host renders ChecklistHeaderAction (Tick all, then an All done badge that offers a confirmed Untick all) in its own header.'],
              ]}
            />
            <InfoBox type="info">
              Completion used to be a separate step (a Complete button, then Reopen with a
              double confirm). Since October 2026 it follows the ticks only, so the dashboard
              widgets and the Checklists page can never disagree about it, and fixing a task is
              just unticking it.
            </InfoBox>
            <H3>Legacy spreadsheet import</H3>
            <P>
              <Mono>services/legacyImportSvc.js</Mono> (used by <Mono>routes/legacyImport.js</Mono>, the
              Legacy data import page, and <Mono>scripts/import-legacy-checklists.js</Mono>) reads the old
              CAFE_MANAGER workbook into checklist instances and food-safety logs. It never creates
              checklist templates: each checklist sheet is matched to an existing template of the same
              frequency whose task labels cover at least half of the sheet's columns. Preview and
              commit run the same code; only the transaction outcome differs. Reruns only fill gaps.
            </P>
            <DataTable
              head={['Sheet', 'Goes to']}
              rows={[
                ['KitchenDayChecklist, KitchenDayClosingChecklist', 'Daily templates, matched by exact task label'],
                ['KitchenWeekChecklist', 'Weekly template, matched by exact task label'],
                ['KitchenMonthChecklist', 'Monthly template, matched by exact task label'],
                ['Monthly Audit', 'Monthly H&S audit template. Questions matched by their number (1.1.0 ... 3.2.6) at the start of the task label, else by exact text; per-question Notes columns go to checklist_instance_items.notes; Completed By to completed_by'],
                ['FridgeFreezerChecksAM / PM', 'fs_temp_logs (creates equipment + AM/PM capture times if missing)'],
                ['HotFoodCheck', 'fs_cooking_checks'],
                ['DeliveryCheck', 'fs_delivery_checks'],
              ]}
            />
          </section>

          {/* ── DASHBOARDS (SHARED WIDGETS) ─────────────────── */}
          <section id="dashboards" data-doc="">
            <H2>Dashboards (shared widgets)</H2>
            <P>
              Migration 152. Every dashboard, whatever its kind, can hold every widget type, and a
              fourth kind, <Mono>'custom'</Mono>, gives blank dashboards on the Dashboards page
              (<Mono>/dashboards</Mono>, <Mono>pages/Dashboards.jsx</Mono>). The kinds still keep
              dashboards apart (each page lists only its own) and each is gated by its own module;
              only the widget lists were merged.
            </P>
            <DataTable
              head={['Kind', 'Page', 'API mount', 'Module']}
              rows={[
                ['hs', '/hs-dashboard (HSDashboard.jsx)', '/api/hs-dashboards', 'hs_dashboard'],
                ['cash', '/cash-dashboard (CashDashboard.jsx)', '/api/cash-dashboards', 'cash_dashboard'],
                ['rota', '/rota-dashboard (RotaDashboard.jsx)', '/api/rota-dashboards', 'rota_dashboard'],
                ['custom', '/dashboards (Dashboards.jsx; not on the phone)', '/api/custom-dashboards', 'custom_dashboard (core, no tenant switch)'],
              ]}
            />
            <H3>API (routes/hsDashboards.js)</H3>
            <P>
              <Mono>WIDGET_MODULE</Mono> maps every widget type to the module whose data it shows,
              and <Mono>WIDGET_TYPES</Mono> (its keys) replaced <Mono>WIDGET_TYPES_BY_KIND</Mono>:
              every mount accepts every type. <Mono>POST /dashboards/:id/widgets</Mono> also needs
              at least view on that module (<Mono>permissionLevel()</Mono> from{' '}
              <Mono>middleware/auth.js</Mono>), else 403 "You don't have access to ..., so you can't
              add that widget.". This is a convenience check only: the widget's data comes from
              that module's own routes, which check it on every read. <Mono>POST /dashboards</Mono>{' '}
              now checks the venue belongs to the tenant (404) and puts a new dashboard after the
              venue's others of that kind. The <Mono>widget_type</Mono> CHECK already listed every
              type, so the migration only widens the <Mono>kind</Mono> CHECK.
            </P>
            <DataTable
              head={['Module', 'Widget types']}
              rows={[
                ['checklists', 'checklist'],
                ['food_safety', 'temp_checks, delivery_checks, hold_checks, cooking_checks'],
                ['hs_action_log', 'action_log'],
                ['menus', 'allergen_lookup'],
                ['cash_recon', 'every cash_* type except cash_tips_payout'],
                ['rota_tips', 'cash_tips_payout, rota_tips'],
                ['rota', 'rota_grid, rota_today'],
                ['rota_pay', 'rota_week_pay'],
              ]}
            />
            <P>
              Migration 152 also adds <Mono>custom_dashboard</Mono> to every role's{' '}
              <Mono>permissions</Mono> (built-in: viewer view, others manage; custom roles copy their{' '}
              <Mono>hs_dashboard</Mono> level, else view) and a Dashboards nav link straight after
              the Overview link (<Mono>route = '/'</Mono>), or at the end of the top level when a
              tenant has no Overview link. <Mono>ROUTE_CATALOG</Mono>, <Mono>defaultNav.js</Mono>,
              the Overview <Mono>SHORTCUT_OPTIONS</Mono> and the mobile registry include it.
            </P>
            <H3>Dashboards per role (migration 229)</H3>
            <P>
              <Mono>hs_dashboards.hidden_role_ids</Mono> (uuid[], default empty) lists the roles a
              dashboard is hidden from, as <Mono>nav_items</Mono> and <Mono>dashboard_tiles</Mono>{' '}
              do. <Mono>GET /dashboards</Mono> leaves out those hidden from the caller&apos;s role{' '}
              (<Mono>effectiveRoleId()</Mono> in <Mono>services/roles.js</Mono>: the custom role, else
              the built-in row for <Mono>users.role</Mono>); with <Mono>?all=1</Mono> someone with
              Manage on the page gets every dashboard (the admin asks for it while editing the
              layout), and platform admins always do. <Mono>GET /dashboards/:id/widgets</Mono> is 404
              for a hidden dashboard to anyone below Manage. <Mono>POST</Mono> and{' '}
              <Mono>PATCH /dashboards</Mono> take <Mono>hidden_role_ids</Mono>, checked by{' '}
              <Mono>ownRoleIds()</Mono> (the tenant&apos;s own roles, duplicates dropped, else 400),
              which the nav item and Overview tile routes now use too (they stored any uuid before;
              the nav PATCH also checks <Mono>parent_id</Mono> is the tenant&apos;s). Hiding is not
              access control for data: every widget still reads its own module&apos;s routes.
            </P>
            <P>
              Admin: <Mono>components/dashboards/RoleVisibilityModal.jsx</Mono>{' '}
              (<Mono>RoleVisibilityModal</Mono>, a tick per role; <Mono>visibilityText()</Mono>) is
              shared by the Overview tiles and <Mono>DashboardPage</Mono> (<Mono>HSDashboard.jsx</Mono>):
              the edit strip&apos;s <Mono>Seen by</Mono> button (<Mono>dash-roles</Mono>), tabs marked
              with an eye while editing (<Mono>data-hidden</Mono>, <Mono>data-hidden-from-me</Mono>),
              the list query keyed by edit mode with <Mono>placeholderData</Mono> kept for the same
              venue so the open tab survives the switch.
            </P>
            <H3>Admin: one catalog, one navigator</H3>
            <P>
              <Mono>components/dashboards/widgetTypes.jsx</Mono> is the only widget catalog:{' '}
              <Mono>WIDGET_TYPES</Mono> (H&amp;S and Menus types defined there, plus{' '}
              <Mono>CASH_WIDGET_TYPES</Mono> from <Mono>cashRecon/widgets.jsx</Mono> and{' '}
              <Mono>ROTA_WIDGET_TYPES</Mono> from <Mono>staff/rotaWidgets.jsx</Mono>), each with{' '}
              <Mono>group</Mono> (Add widget heading, <Mono>WIDGET_GROUPS</Mono>),{' '}
              <Mono>module</Mono> (same map as the API) and <Mono>nav</Mono> (<Mono>'day'</Mono> |{' '}
              <Mono>'week'</Mono> | <Mono>null</Mono>). <Mono>renderWidget()</Mono> draws any type;{' '}
              <Mono>canUseWidget(meta, me)</Mono> decides whether a viewer sees it (from{' '}
              <Mono>/me</Mono>'s <Mono>permissions</Mono>); <Mono>NoAccess</Mono> is shown in its
              place otherwise, and the header figure and checklist action are left out.
            </P>
            <P>
              <Mono>DashboardPage</Mono> no longer takes <Mono>widgetTypes</Mono>,{' '}
              <Mono>renderWidget</Mono> or <Mono>useNav</Mono>. A config now gives{' '}
              <Mono>apiBase</Mono>, <Mono>keyPrefix</Mono>, <Mono>title</Mono>, <Mono>icon</Mono>,{' '}
              <Mono>primaryGroup</Mono> (listed first in <Mono>AddWidgetModal</Mono>),{' '}
              <Mono>defaultNav</Mono> (navigator mode while no widget needs a date), the optional{' '}
              <Mono>HeaderExtra</Mono>, the empty-state texts and <Mono>moduleKey</Mono> (the
              page&apos;s dashboard module, the same one the API mount uses). Every layout control
              (Edit layout, New dashboard, Create dashboard, Add widget, and everything inside Edit
              layout) shows only when <Mono>canEditLayout</Mono>: platform admin or{' '}
              <Mono>me.permissions[moduleKey] === &apos;manage&apos;</Mono>, matching the API, which
              refuses every layout write without Manage. View users get read-only empty-state
              wording instead of the buttons. <Mono>AddWidgetModal</Mono> lists
              every type the person can use, grouped, and says how many it left out. The header has
              a <Mono>New dashboard</Mono> button (no need to enter Edit layout).{' '}
              <Mono>ClosedDayNotice</Mono> shows on any dashboard with an H&amp;S day widget (
              <Mono>hasHsDayWidget()</Mono>), not only the H&amp;S one.
            </P>
            <P>
              <Mono>components/dashboards/nav.jsx</Mono>: <Mono>useDashboardNav()</Mono> keeps one
              selected day; <Mono>ctx = {'{ date, weekStart, selectedDay, setSelectedDay }'}</Mono>{' '}
              (<Mono>selectedDay</Mono> is <Mono>date</Mono>, <Mono>weekStart</Mono> its Monday),
              so H&amp;S widgets (<Mono>ctx.date</Mono>) and cash/rota widgets (
              <Mono>ctx.weekStart</Mono> + <Mono>ctx.selectedDay</Mono>) share it.{' '}
              <Mono>navModeFor(widgets, WIDGET_TYPE_BY_KEY, fallback)</Mono> picks{' '}
              <Mono>'day'</Mono>, <Mono>'week'</Mono> (week step keeps today if it's in that week,
              else the Monday, as <Mono>useWeekNav()</Mono> did) or <Mono>'both'</Mono> (day arrows
              inside week arrows, two-line label): day widgets and week widgets together, or one
              widget whose own <Mono>nav</Mono> is <Mono>'both'</Mono> (the import widget).{' '}
              <Mono>DashboardNav</Mono> draws it, with the
              invisible <Mono>input[type=date]</Mono> over the label in every mode;{' '}
              <Mono>mobile</Mono> makes it full width. Today is the browser's local date (the old
              H&amp;S navigator used UTC). <Mono>useWeekNav()</Mono> stays in{' '}
              <Mono>cashRecon/widgets.jsx</Mono> for the Rota page only.
            </P>
            <P>
              Phone: <Mono>pages/mobile/MobileDashboard.jsx</Mono> exports{' '}
              <Mono>MobileDashboardPage({'{ apiBase, keyPrefix, defaultNav, emptyText, emptyWidgetsText }'})</Mono>{' '}
              (read-only layout, any widget, same navigator); <Mono>MobileHSDashboard.jsx</Mono> is
              that page for the H&amp;S kind. The blank (custom) dashboards aren&apos;t on the phone
              (<Mono>/mobile/dashboards</Mono> was removed; old links land on the hub through the
              mobile routes&apos; catch-all). <Mono>PayHeader</Mono>/<Mono>TipsHeader</Mono> moved from{' '}
              <Mono>RotaDashboard.jsx</Mono> to <Mono>staff/rotaWidgets.jsx</Mono> (the Rota page
              imports them from there).
            </P>
            <InfoBox type="warn">
              Adding a widget type now means: the <Mono>widget_type</Mono> CHECK (migration),{' '}
              <Mono>WIDGET_MODULE</Mono> in <Mono>hsDashboards.js</Mono>, and the type in its group's
              list plus its renderer (reached through <Mono>renderWidget()</Mono> in{' '}
              <Mono>widgetTypes.jsx</Mono>) with a <Mono>module</Mono> and <Mono>nav</Mono>. It is
              then offered on every dashboard, desktop and phone.
            </InfoBox>
          </section>

          {/* ── H&S DASHBOARD ─────────────────────────────── */}
          <section id="hs-dashboard" data-doc="">
            <H2>H&amp;S Dashboard</H2>
            <P>
              Customisable dashboards (migrations 086–088) combining any mix of checklist and
              food-safety check widgets behind one date navigator. Deliberately built as a thin
              layout layer over the existing Food safety / Checklists data and components — there
              is no separate data model per widget type, just a reference to which
              template/venue/check-type to render.
            </P>
            <H3>Schema</H3>
            <DataTable
              head={['Table', 'Purpose']}
              rows={[
                ['hs_dashboards', 'One row per named dashboard (shown as a tab). venue_id, kind (hs | cash | rota | custom), name, column_count, sort_order.'],
                ['hs_dashboard_widgets', 'One row per widget on a dashboard. widget_type enum (checklist / temp_checks / delivery_checks / hold_checks / cooking_checks / action_log), checklist_template_id (nullable, only for widget_type=checklist), title_override, col_span, height_px, sort_order.'],
              ]}
            />
            <H3>API</H3>
            <P>
              Mounted at <Mono>/api/hs-dashboards</Mono>, gated by <Mono>requirePermission('hs_dashboard', …)</Mono>.
              CRUD + <Mono>PUT /reorder</Mono> for dashboards, and CRUD + <Mono>PUT
              /:id/widgets/reorder</Mono> for widgets. Widget resize (col_span, height_px) goes
              through the same widget <Mono>PATCH</Mono>.
            </P>
            <H3>Rendering</H3>
            <P>
              <Mono>admin/src/pages/HSDashboard.jsx</Mono> renders each widget by
              <Mono> widget_type</Mono> using the exact same shared components as the Food safety
              and Checklists pages (<Mono>ChecklistRunPanel</Mono>, <Mono>TempChecksTable</Mono>,
              <Mono> DeliveryChecksPanel</Mono>, <Mono>HoldChecksTable</Mono>,
              <Mono> CookingChecksPanel</Mono>) — one implementation of each check type reused in
              three places (its own page, this dashboard, and nowhere else). The container is
              full width (<Mono>w-full</Mono> plus <Mono>p-4 md:p-6</Mono>); it used to be{' '}
              <Mono>w-[90%] mx-auto</Mono>, which left a visible empty strip down the left on a
              tablet.
            </P>
            <P>
              <strong>Columns shrink, never drop.</strong> The grid is always exactly{' '}
              <Mono>column_count</Mono> columns: <Mono>repeat(column_count, minmax(0, 1fr))</Mono>.
              On a narrower screen, each column gets narrower, so the layout the operator built is
              kept. Two half-width widgets stay side by side on a portrait iPad instead of
              stacking. Content wider than its card (e.g. a temperature table) scrolls inside the
              card body. This replaced <Mono>repeat(column_count, minmax(240px, 1fr))</Mono>{' '}
              inside <Mono>overflow-x-auto</Mono>, which overflowed sideways. It also replaced a
              short-lived <Mono>ResizeObserver</Mono> version that dropped to fewer columns on
              narrow screens, which broke the side-by-side layout.
            </P>
            <P>
              <strong>Date and tabs row.</strong> The date navigator and the dashboard tabs share
              one row that wraps only below <Mono>sm</Mono> (<Mono>flex-wrap sm:flex-nowrap</Mono>).
              From <Mono>sm</Mono> up, the tabs strip is <Mono>flex-1 min-w-0 overflow-x-auto</Mono>,
              so it scrolls sideways instead of dropping to a second line. The date label is{' '}
              <Mono>w-44</Mono>, with the shorter <Mono>EEE d MMM yyyy</Mono> format.
            </P>
            <P>
              <strong>Full screen.</strong> <Mono>toggleFullscreen()</Mono> uses{' '}
              <Mono>requestFullscreen</Mono> or <Mono>webkitRequestFullscreen</Mono> (iPad
              Safari) and listens to both <Mono>fullscreenchange</Mono> and{' '}
              <Mono>webkitfullscreenchange</Mono>. If neither API exists, or the request promise
              rejects, it falls back to a "pseudo" full screen instead. That pins the container
              over the whole app (<Mono>fixed inset-0 z-50</Mono>) and is tracked in{' '}
              <Mono>pseudoFullscreen</Mono> state. This is the only mode that works on an iPad
              home-screen (standalone) app, which has no Fullscreen API at all.
            </P>
            <InfoBox type="info">
              The date navigator (prev/next day, Today, click-to-open native date picker) uses a
              fixed-width label button plus an invisible <Mono>input[type=date]</Mono> overlay —
              the same "styled button + native picker" pattern used on Timeline and Bookings, not
              a custom calendar component.
            </InfoBox>
            <InfoBox type="warn">
              A card's size is fixed by the grid, never by its content. It spans a whole
              number of fixed-height rows (see "Row spanning" under Cash Dashboard), and the body
              is <Mono>flex-1 min-h-0 overflow-auto</Mono>, so taller content scrolls and shorter
              content leaves blank space instead of collapsing the card. This replaced an explicit{' '}
              <Mono>height: heightPx</Mono> on the body, which in turn had replaced{' '}
              <Mono>maxHeight</Mono> (a max-height let short content shrink the card below the
              chosen size). The Overview tiles (<Mono>Dashboard.jsx</Mono>'s <Mono>TileCard</Mono>)
              use the same grid.
            </InfoBox>
            <P>
              Each widget's header bar uses <Mono>var(--site-accent-soft)</Mono> background /{' '}
              <Mono>var(--site-accent)</Mono> border, the same theming Cash Reconciliation's{' '}
              <Mono>SectionCard</Mono> header uses (see the Cash Reconciliation section) — applied
              inline via <Mono>style</Mono>, not a Tailwind class, since the value comes from a CSS
              variable set at runtime by <Mono>SettingsContext.applySiteTheme()</Mono>. This only
              works if something in the current route tree has actually called{' '}
              <Mono>applySiteTheme()</Mono> — see the Mobile App section for why{' '}
              <Mono>MobileShell.jsx</Mono> needed its own copy of that fetch-and-apply effect.
            </P>
          </section>

          {/* ── CASH DASHBOARD ─────────────────────────────── */}
          <section id="cash-dashboard" data-doc="">
            <H2>Cash Dashboard</H2>
            <P>
              <Mono>/cash-dashboard</Mono> (<Mono>pages/CashDashboard.jsx</Mono>) runs on the same
              engine as the H&amp;S Dashboard. <Mono>HSDashboard.jsx</Mono> exports{' '}
              <Mono>DashboardPage({'{ config }'})</Mono>, which owns tabs, edit mode, widget CRUD,
              the grid and full screen. Since migration 152 the widget catalog, renderers and
              navigator are shared by every dashboard (see Dashboards (shared widgets)); a config
              only gives the API mount, title, <Mono>primaryGroup</Mono> and{' '}
              <Mono>defaultNav</Mono>. Cash widgets read <Mono>ctx.weekStart</Mono>,{' '}
              <Mono>ctx.selectedDay</Mono> and <Mono>ctx.setSelectedDay</Mono>. A widget type with{' '}
              <Mono>flush: true</Mono> renders without body padding (the grid widget).
            </P>
            <H3>Storage and API (migration 101)</H3>
            <P>
              No new tables. <Mono>hs_dashboards.kind</Mono> (<Mono>'hs' | 'cash'</Mono>, default{' '}
              <Mono>'hs'</Mono>) splits the two. <Mono>routes/hsDashboards.js</Mono> is registered
              twice in <Mono>app.js</Mono>: <Mono>/api/hs-dashboards</Mono> with{' '}
              <Mono>{"{ kind: 'hs', moduleKey: 'hs_dashboard' }"}</Mono> and{' '}
              <Mono>/api/cash-dashboards</Mono> with{' '}
              <Mono>{"{ kind: 'cash', moduleKey: 'cash_dashboard' }"}</Mono>. Each mount filters
              every query by its kind (including widget PATCH/DELETE, which load the parent
              dashboard first) and is gated by its own module. Until migration 152 each mount also
              accepted only its own <Mono>WIDGET_TYPES_BY_KIND[kind]</Mono>; now every mount accepts
              every type. The <Mono>widget_type</Mono> CHECK constraint lists every type.
            </P>
            <P>
              New module <Mono>cash_dashboard</Mono> in the <Mono>cash_recon</Mono> group (one tenant
              switch covers both). The migration copies each tenant's <Mono>cash_recon</Mono>{' '}
              switch and each role's <Mono>cash_recon</Mono> permission onto it, and inserts a{' '}
              <Mono>/cash-dashboard</Mono> nav link straight after <Mono>/cash-recon</Mono>.{' '}
              <Mono>ROUTE_CATALOG</Mono>, <Mono>defaultNav.js</Mono> and the Overview{' '}
              <Mono>SHORTCUT_OPTIONS</Mono> include it too.
            </P>
            <H3>Widgets</H3>
            <DataTable
              head={['widget_type', 'Source']}
              rows={[
                ['cash_day_tiles', 'useReconWeek() — tile per date, status, dayTotal(income), variance(). Tap sets ctx.selectedDay and opens DayView (exported from CashRecon.jsx) in a fixed inset-0 z-50 overlay rendered inline, so it stays inside the dashboard\'s full-screen element; closing invalidates cash-recon-week-detail. Options (settings): hide_closed (filter to calc.visibleDates), compact (76px tiles, status dot + variance)'],
                ['cash_day_balance', 'useReconWeek() — day figures for ctx.selectedDay'],
                ['cash_week_balance', 'useReconWeek() — weekDayTotal, weekExpenses, weekCardExpenses, weekCashWages, weekVariance'],
                ['cash_recon_grid', 'SpreadsheetView with hideHeader (editable; saves through PUT /daily/:date)'],
                ['cash_wages_paid', 'WeekWagesEditor (GET /wages/:week_start + config, Save = PUT /wages/:week_start); HeaderValue: cash paid. Widget options (WAGES_OPTIONS in widgets.jsx, widget.settings): hide_manage → hideManage (no add/copy/set default/remove), hide_bulk → hideBulk (no Pay everyone in full / Paid on for all), paid_only → paidOnly (Name + Paid columns, Paid total only), show_bank → showBank (Bank column; the Wages page and /mobile/wages always show it). Hidden fields still round-trip through toRow()/toPayload(). Bank refills from splitPay() with the person\'s pay_method when a Total is typed; Full pays cashDueOf() = total − bank.'],
                ['cash_petty_cash', 'PettyCashPanel (exported from MobileExpenses.jsx) for ctx.selectedDay'],
                ['cash_week_expenses', 'useReconWeek() — detail.days[date].expenses grouped by day (read-only), dayExpenses/weekExpenses/weekCardExpenses totals; day heading sets ctx.selectedDay. Added in migration 102 (CHECK constraint only)'],
                ['cash_week_staff', 'Same WeekWagesEditor and the same options as cash_wages_paid (both keys kept so existing dashboards keep working). Added in migration 104; standardised in migration 137.'],
                ['cash_week_summary_grid', 'useReconWeek() — the SpreadsheetView row set with only the WEEK column (weekTotal per source/SC/channel, weekDayTotal, weekExpenses, weekCardExpenses, weekCashWages, weekVariance); read-only. ScEffectBadge exported from CashRecon.jsx for it. Added in migration 103 (CHECK constraint only)'],
                ['cash_tips_payout', 'useRotaPay(venueId, ctx.weekStart) — the rota pay payload (GET /api/rota/venues/:venueId/weeks/:week/pay, computeRotaWeek()), so it needs rota_tips view (useRotaPerms().canSeeTips; without it the widget says so and makes no request). Shows totals.tips_cash / tips_bank as tiles, non-house pots (paid_to_people ?? total, how paid from payout_method / payout_to / payees) and kept_by_house, then tipRows() with tip_share / tip_bank / tip_cash (TipMoneyCell for "hands on"). HeaderValue: totals.tips_shared. Read-only. Options (TIPS_PAYOUT_OPTIONS): hide_pots, hide_people, hide_share, hide_empty (rows with no tip_cash or tip_bank), hide_notes (handed on, unallocated, pots with nobody picked). Added in migration 144 (CHECK constraint only).'],
                ['cash_import', 'useLoyverseLink() + useGloriaFoodLink() (GET /api/loyverse|gloriafood/venues/:id/link) and useReconWeek(). One card per linked source not left out (detail from the link: store and trading day; restaurant and last_order_at, when the last order was received); Fill <day> opens LoyverseFillModal / GloriaFoodFillModal (ReconFillModal: preview + apply, which invalidates cash-recon-week-detail) with [ctx.selectedDay], disabled for a future or submitted day or when nothing is mapped; Fill this week passes calc.dates up to today. The days list reads week-detail\'s days[date].filled.{loyverse,gloriafood} = { at, by } | null (cash_daily_reports.<source>_filled_at / _by) and sets ctx.selectedDay. Fill buttons need useReconLinkPerms().canFill (cash_recon manage); the API checks it again on apply. nav: \'both\' (its CASH_WIDGET_TYPES entry; widgetTypes.jsx keeps t.nav ?? \'week\'). Options (IMPORT_OPTIONS): hide_days, hide_week, hide_loyverse, hide_gloriafood. Added in migration 212 (CHECK constraint only).'],
              ]}
            />
            <InfoBox type="warn">
              <Mono>reconCalc()</Mono> in <Mono>CashRecon.jsx</Mono> is the single implementation of
              the week grid maths (totals and the variance). SpreadsheetView calls
              it with its override-aware cell reader; <Mono>useReconWeek(venueId, weekStart)</Mono>{' '}
              calls it with saved values for the widgets, using the same{' '}
              <Mono>cash-recon-config</Mono> / <Mono>cash-recon-week-detail</Mono> query keys, so an
              edit in the grid refreshes every balance widget. Change a formula there, never in a
              widget.
            </InfoBox>
            <H3>Renaming widgets and tiles</H3>
            <P>
              <Mono>components/dashboards/TitleRename.jsx</Mono> is the Edit-layout name row used by{' '}
              <Mono>WidgetCard</Mono> (H&amp;S and Cash dashboards) and the Overview&apos;s{' '}
              <Mono>TileCard</Mono>. It PATCHes <Mono>title_override</Mono> on explicit Save; an empty
              name, a name equal to the default, or <strong>Use default</strong> sends{' '}
              <Mono>null</Mono>, so the built-in title (or the checklist name) shows again. Both PATCH
              routes already accepted <Mono>title_override</Mono>; there was just no UI for it.
            </P>
            <H3>Header figures</H3>
            <P>
              A widget type can set <Mono>HeaderValue</Mono> (a component) in its type list;{' '}
              <Mono>WidgetCard</Mono> renders it in the title bar outside Edit layout with{' '}
              <Mono>{'{ widget, venueId, ctx }'}</Mono>. The cash widgets use a shared{' '}
              <Mono>HeaderFigure</Mono> (label + amount): Week summary grid shows{' '}
              <Mono>calc.weekVariance()</Mono> (coloured like the grid), Week expenses shows{' '}
              <Mono>calc.weekExpenses()</Mono> (cash only), Wages paid shows the sum of{' '}
              <Mono>cash_amount</Mono>. They read the same query keys as the widget bodies
              (<Mono>useReconWeek</Mono>, <Mono>useWeekWages</Mono>), so they add no requests and
              refresh with them.
            </P>
            <H3>Per-widget options (all dashboards)</H3>
            <P>
              <Mono>hs_dashboard_widgets.settings</Mono> (jsonb, default <Mono>{'{}'}</Mono>, migration
              105) holds a widget's display options. A widget type declares them in its type list
              (<Mono>{"options: [{ key, label, hint }]"}</Mono> on <Mono>CASH_WIDGET_TYPES</Mono> /
              the H&amp;S list); <Mono>WidgetCard</Mono> renders one toggle per option in Edit layout
              and saves the whole object through <Mono>PATCH /dashboards/:id/widgets/:widgetId</Mono>{' '}
              (<Mono>{'{ settings }'}</Mono>). The API accepts a flat map of booleans, numbers and short
              strings (at most 20 keys) and writes it with <Mono>tx.json()</Mono>; it does not know what
              any key means. The renderer receives <Mono>widget.settings</Mono>. Options are
              boolean toggles only for now.
            </P>
            <H3>Row spanning (all dashboards)</H3>
            <P>
              <Mono>lib/dashboardGrid.js</Mono> gives the H&amp;S Dashboard, the Cash Dashboard and
              the Overview tiles one grid model: fixed-height implicit rows (<Mono>ROW_UNIT</Mono>{' '}
              120px, <Mono>GRID_GAP</Mono> 16px) with <Mono>grid-auto-flow: row dense</Mono>. A
              card spans <Mono>rowSpanFor(height_px)</Mono> rows (2 to 8) as well as its{' '}
              <Mono>col_span</Mono> columns, and its body is <Mono>flex-1 min-h-0</Mono>, filling
              the card and scrolling inside it. The height controls step one row at a time and write{' '}
              <Mono>heightForRows(n)</Mono> back to the existing <Mono>height_px</Mono> column, so
              no migration was needed and older free-form values snap to the nearest row count.
              Dense packing lets shorter cards fill the space beside a tall one, so on-screen
              order can differ slightly from sort order.
            </P>
          </section>

          {/* ── STAFF & ROTA ────────────────────────────── */}
          <section id="staff-rota" data-doc="">
            <H2>Staff &amp; Rota</H2>
            <P>
              Migration 106. Pages: <Mono>/staff</Mono> (<Mono>Staff.jsx</Mono>),{' '}
              <Mono>/staff/roles</Mono> (<Mono>StaffRoles.jsx</Mono>), <Mono>/rota</Mono>{' '}
              (<Mono>Rota.jsx</Mono>), <Mono>/rota/setup</Mono> (<Mono>RotaSetup.jsx</Mono>),{' '}
              <Mono>/rota-dashboard</Mono> (<Mono>RotaDashboard.jsx</Mono>). Shared UI in{' '}
              <Mono>components/staff/shared.jsx</Mono> (venue choice, sortable rows, modal, time
              select) and <Mono>components/staff/rota.jsx</Mono> (<Mono>RotaGrid</Mono>,{' '}
              <Mono>RotaDayList</Mono>, <Mono>RotaPayTable</Mono>, <Mono>RotaTipsTable</Mono>), used
              unchanged by both the Rota page and the dashboard widgets. API:{' '}
              <Mono>routes/rota.js</Mono> at <Mono>/api/rota</Mono>; maths in{' '}
              <Mono>services/rotaCalc.js</Mono> (<Mono>computeRotaWeek()</Mono>, pure, the one
              implementation used by GET pay and fill-wages).
            </P>
            <H3>Scope</H3>
            <P>
              Tenant-wide: roles, shifts, rota settings (one company, one set of rules; a new tenant
              starts empty). Per venue: staff (<Mono>cash_staff</Mono>, the same rows Cash Recon wages
              use), rota entries, weekly pay/points adjustments.
            </P>
            <H3>Leaving and off-rota periods (migration 164)</H3>
            <P>
              A person is off the rota on a day when it is after their <Mono>cash_staff.left_on</Mono>{' '}
              (last working day) or inside one of their <Mono>staff_rota_off</Mono> periods.{' '}
              <Mono>loadOffDays(tx, tenantId, venueId, dates)</Mono> in <Mono>routes/rota.js</Mono> is
              the one place that works this out, and every reader goes through it: GET week (blocked{' '}
              <Mono>off_days</Mono> per row, no row for someone off all seven days, the{' '}
              <Mono>away_staff</Mono> list), the entries PUT (422 on those days), copy (skips them) and{' '}
              <Mono>computeWeek()</Mono> (no pay row unless they have money that week). Only the days
              themselves change: weeks before a leaving date or outside a period are untouched, so old
              rotas, pay and tips still show the person. Setting a leaving date or adding a period deletes
              the person&apos;s entries on those days (a <Mono>dry_run</Mono> call counts them first, and
              the Staff page asks before going ahead); clearing the date or removing the period
              doesn&apos;t bring them back. People who left before a week are also left out of new wage
              weeks and the wages Add person list (<Mono>leftBeforeWeek()</Mono> in{' '}
              <Mono>CashRecon.jsx</Mono>), and from the day after their last day they drop out of the
              till&apos;s sign-in list (<Mono>loadTillStaff(..., {'{ signIn: true }'})</Mono> in{' '}
              <Mono>posSvc.js</Mono>, used by <Mono>tillConfig()</Mono>; the sequencer still knows them,
              so a late-synced sale from their last day is accepted). <Mono>is_active</Mono> is separate:
              off hides someone from every week. Admin: <Mono>LeavingSection</Mono> and{' '}
              <Mono>OffPeriodsSection</Mono> in <Mono>pages/Staff.jsx</Mono>, <Mono>AwayCell</Mono> and
              the Off the rota all week strip in <Mono>RotaGrid</Mono>, Left / Off rota cells in{' '}
              <Mono>buildRotaSheet()</Mono>.
            </P>
            <H3>Schema</H3>
            <DataTable
              head={['Table', 'Purpose']}
              rows={[
                ['staff_roles', 'Tenant job titles: name, points_multiplier numeric(5,2) default 1, sort_order, is_active. cash_staff.role_id references it ON DELETE SET NULL.'],
                ['rota_settings', 'One row per tenant: mode (day_parts | hourly), slot_minutes (15 | 30 | 60), tip_round_to (numeric, null = to the penny) and tip_round_mode (nearest | up | down), migration 107; hide_closed_on_rota and hide_closed_on_print (booleans, default false), migration 110 (hide_totals_on_print, migration 114, dropped by 194). Missing row = day_parts / 30 / no rounding / show every day.'],
                ['rota_shifts', 'Day parts: name, start_time, end_time (end <= start runs past midnight), points, sort_order, is_active. Deleting a shift used by any entry only hides it.'],
                ['staff_shift_rates', 'Per staff per shift rate (PK staff_id, shift_id): hourly rate for hourly staff, amount per shift for fixed/shift staff. Replaced wholesale by the staff PATCH shift_rates array.'],
                ['rota_entries', 'venue_id, staff_id, work_date, and either shift_id (day-part tick) or start_time + end_time (hourly period); CHECK enforces one or the other. Partial unique index on (staff_id, work_date, shift_id). status (text, default on, CHECK on | sick | pto | uto | abs), migration 129: working or a kind of time off.'],
                ['tip_pots', 'Migration 108. Tenant-wide pots: name, distribution (house | points | manual), sort_order, is_active; surcharges (jsonb array of { name, pct 0-100 }, in the order applied, default []), migration 116; it replaced the single surcharge_name + surcharge_pct, which 116 copied into the array and dropped. PotBody takes surcharges (max 10); blank names are stored as null and 0% rows dropped (cleanSurcharges), written with tx.json. cash_sc_sources.tip_pot_id (ON DELETE SET NULL) says which pot a Cash Recon source feeds; it replaced cash_sc_sources.distribution (house/staff/split), which only ever fed the old single rota pot. Migration 143 adds payout_method (cash | bank) and payout_to (shares | people), both in PotBody.'],
                ['tip_pot_lines', 'Named manual lines per pot (cascade). kind (amount | percent, migration 115). Values per venue week in rota_week_pot_lines (PK venue_id, week_start, line_id): £ for amount lines, % for percent lines; either may be negative (migration 115 dropped the amount >= 0 check).'],
                ['rota_week_pot_payees', 'Migration 143. Who a payout_to = people pot is paid to: one row per venue, week_start and pot (PK), staff_ids uuid[]. computeWeek() uses the latest row with week_start <= the week (DISTINCT ON pot_id ... ORDER BY week_start DESC), so a pick carries forward and older weeks keep theirs; an empty array means nobody. Set by PUT .../pots/:potId/payees { staff_ids } (rota_tips manage, staff must belong to the venue). Payees are added to the staff loaded for the week so a deactivated payee still shows.'],
                ['rota_week_pot_manual', 'Manual distribution: amount per venue, week, pot and staff. Replaced per pot by PUT .../pots/:potId/manual.'],
                ['rota_week_staff', 'Per venue, week, staff: pay_override; tip_unallocated (numeric(10,2) default 0, migration 119) is the person\'s net +/- nudge in £ (negative = given to the unallocated pot); points_nudge (numeric(8,2) default 0, migration 151) is their net +/- point tap; removed (boolean default false, migration 155) takes the person off that venue week\'s rota. (points_adjustment and tip_adjustment were dropped in migration 113.)'],
                ['cash_staff.left_on / left_note', 'Migration 164. left_on (date, null = still on the staff) is the person\'s last working day; left_note (text) the reason. From left_on + 1 they are off the rota: loadOffDays() marks those days { kind: \'left\' }, and a person off every day of a week has no row in it. Earlier weeks are untouched.'],
                ['staff_rota_off', 'Migration 164. Periods a person is off the rota: tenant_id, staff_id (cascade), from_date, to_date (both included, CHECK to >= from), note, created_by. RLS. Periods for one person never overlap (the POST refuses it); at most 731 days each. loadOffDays() marks the days { kind: \'off\', from, until, note }; a leaving date wins on a day both cover.'],
                ['rota_tip_moves / rota_tip_move_lines', 'Migration 113. One row per move: venue, week_start, kind (points | money), from_staff_id, note, created_by, created_at; lines: to_staff_id + amount (> 0, 2 decimals). ON DELETE CASCADE from the move. Migration 117 added action (move | add | remove; from_staff_id is set only for a move, CHECK-enforced): add gives each line its amount, remove takes it off, with no counterpart. computeRotaWeek() sums them into each person\'s points_adjustment / tip_adjustment, and totals.tips_added / tips_taken_out (money only).'],
              ]}
            />
            <H3>API</H3>
            <DataTable
              head={['Route', 'Module', 'Notes']}
              rows={[
                ['GET /setup', 'any signed-in user', 'settings + shifts + roles'],
                ['PATCH /settings; POST/PATCH/DELETE /shifts[/:id]; PUT /shifts/reorder; same for /roles', 'staff manage', ''],
                ['GET/POST/PATCH/DELETE /venues/:venueId/staff[/:id]; PUT .../staff/reorder', 'staff', 'Staff with wage or rota history are deactivated, not deleted. GET returns left_on, left_note and off_periods [{ id, from_date, to_date, note }] (loadStaff withPeriods).'],
                ['PUT .../staff/:id/leaving { left_on: date | null, note?, dry_run? }', 'staff manage', 'Migration 164. dry_run returns { entries }: the person\'s rota_entries after left_on. Otherwise sets left_on / left_note, deletes those entries and returns { left_on, removed_entries }. null clears the date (deleted entries stay deleted). 404 for someone not in that venue.'],
                ['POST .../staff/:id/off-periods { from_date, to_date, note?, dry_run? }; DELETE .../off-periods/:periodId', 'staff manage', 'Migration 164. 400 when to is before from or the period is over 731 days; 422 when it overlaps one of the person\'s periods (names it). dry_run returns { entries } inside the dates; otherwise inserts, deletes those entries and returns the row + removed_entries. DELETE only removes the period.'],
                ['GET /venues/:venueId/weeks/:week', 'rota view', 'week_start, dates, open_dates, settings, shifts, staff (active plus anyone with entries, less people removed from the week who have none and people off the rota all week; each with sort_order, left_on and off_days { date: { kind: left, left_on, note } | { kind: off, from, until, note } }), entries, removed_staff (active people removed from this week with no entries: id, name, role_name, is_active, sort_order), away_staff (migration 164: active people off the rota every day of the week with no entries, other than those who left before it: id, name, sort_order plus the first day\'s off fields). :week may be any date; it snaps to Monday. open_dates is null when the venue has no venue_schedule_templates rows (nothing is hidden), otherwise the open dates from resolveOpenDaysForWeek().'],
                ['PUT .../weeks/:week/entries', 'rota manage', 'Whole-week replace (both modes). Each entry takes status (default on). The Clear rota button just saves an empty list. Optional removed_staff_ids (migration 155): the whole list of people off this week\'s rota; sent, it sets rota_week_staff.removed for them and clears it for everyone else in the venue week; absent, removals stay as they are. 400 for a date outside the week or a staff id not in the venue, 422 for overlapping periods for one person on one day, for entries belonging to someone in removed_staff_ids, or (migration 164) for an entry on a day the person is off the rota (after their leaving date, or in an off-rota period); the message names the person and the dates. Duplicate shift ticks are dropped. The grid drops entries on those days before saving, so an old draft still saves.'],
                ['POST .../weeks/:week/copy { from_week }', 'rota manage', 'Replaces the week with another week\'s worked (status on) entries, shifted by whole weeks. Time off is never copied, and nor are the shifts of people removed from this week or shifts landing on a day the person is off the rota (migration 164) (the response gives copied and skipped counts); 422 when the source week has nobody working, or only people removed from this week (nothing is replaced).'],
                ['GET .../weeks/:week/pay', 'rota_pay or rota_tips view', 'computeRotaWeek result: rows (incl. pot_shares / pot_shares_exact by pot id, tip_share total), pots (sources, lines, total, distributed, difference, kept_by_house), totals (hours, pay, points, tips_in, tips_shared, kept_by_house), tip_rounding. computeWeek() leaves out people removed from the week (rota_week_staff.removed), and people off the rota all week (migration 164: left before it or in an off-rota period), unless they have something that week: entries, a pay override, a pay adjustment, carried_owed, a manual pot amount, a tip move, a nudge or tap, or a people pot paid to them.'],
                ['GET /setup pots; GET /sc-sources; POST/PATCH/DELETE /pots[/:id]; PUT /pots/reorder; PUT /pots/:id/sources { source_ids }; POST /pots/:id/lines; PATCH/DELETE /pot-lines/:id; PUT /pots/:id/lines/reorder', 'staff', 'Tip pot setup. Listing a source in PUT sources moves it from any other pot; sources no longer listed are unassigned. Deleting a pot unassigns its sources and cascades its lines and weekly amounts.'],
                ['PUT .../weeks/:week/pot-lines { amounts: [{ line_id, amount }] }; PUT .../weeks/:week/pots/:potId/manual { amounts: [{ staff_id, amount }] }', 'rota_tips manage', 'Weekly manual line values (null clears; may be negative; percent lines 400 outside -100..100) and manual shares (422 unless the pot is manual). Both return the recomputed pay payload. POST /pots/:id/lines takes { name, kind }.'],
                ['PATCH .../staff/:staffId { pay_override }, POST .../tip-moves { kind, action (move | add | remove, default move), from_staff_id (move only), lines: [{ to_staff_id, amount }], note (required for add / remove) }, DELETE .../tip-moves/:id, POST .../reset-moves { kind: points | money | all }', 'rota_pay manage (pay override); rota_tips manage (moves, reset)', 'Each returns the recomputed pay payload (which includes moves: each with from_name, lines with names, total). A move whose lines add up to more than the giver has now (points, or tip_share for money) is 422, and so is a remove line bigger than that person\'s balance; moving to yourself or listing a person twice is 400. The UI (TipMoveModal in rota.jsx) turns equal / by amount / by % into final amounts with splitEvenly() / splitByPercent(), which work in hundredths so the lines add up exactly.'],
                ['POST .../tip-nudge { staff_id, direction: plus | minus }; POST .../reset-unallocated', 'rota_tips manage', 'Moves 0.50 (NUDGE_STEP in rota.js) between the person\'s tip total and the week\'s unallocated pot by adding -0.50 / +0.50 to rota_week_staff.tip_unallocated. Minus is 422 when the person\'s tip_share is under 0.50, plus is 422 when totals.tips_unallocated is under 0.50. A pg_advisory_xact_lock on the venue week serialises rapid taps so two can\'t pass the same balance check. reset-unallocated sets every nudge back to 0. computeRotaWeek() adds tip_unallocated into tip_share and reports totals.tips_unallocated = -sum of nudges; the UI is NudgeCells in rota.jsx (the -/+ buttons get a column each so the total lines up under its heading).'],
                ['POST .../points-nudge { staff_id, direction: plus | minus }; POST .../reset-points-nudges', 'rota_tips manage', 'Migration 151. Moves 0.5 (POINTS_STEP in rota.js) between the person\'s points and the week\'s spare points (rota_week_staff.points_nudge, net per person; spare points = -sum). Minus is 422 when the person\'s points are under 0.5, plus is 422 when totals.points_unallocated is under 0.5. Same advisory lock as tip-nudge. computeRotaWeek() adds points_nudge to the person\'s points (with point moves, floored at 0) and shares each points pot over everyone\'s points plus the spare points, so a minus tap changes nobody else\'s share; the spare points\' part is pot.unallocated (the remainder after people\'s exact shares, so it takes the odd penny), totals.tips_unallocated_points. A people pot pays its payees total - unallocated. reset-points-nudges sets every tap back to 0. UI: PointsCells in rota.jsx (+ disabled without a spare point); the Changed column shows points_adjustment + points_nudge.'],
                ['Carry-over', '—', 'What a week leaves unallocated carries into the next week: carriedIn() in rota.js = -sum(tip_unallocated) over every earlier week of the venue plus, for each earlier week with spare points left (sum(points_nudge) < 0), that week\'s totals.tips_unallocated_points (computeWeek(..., { carry: false }), so no recursion; usually no such weeks). computeRotaWeek({ carriedIn }) returns totals.tips_carried_in, tips_unallocated = carriedIn - sum(this week\'s tip_unallocated) (what + £ taps can hand out), points_unallocated, tips_unallocated_points and tips_carry_out = tips_unallocated + tips_unallocated_points. Changing an earlier week changes every later week\'s carry. Pay, fill-wages and the tip-move balance check call computeWeek with carry: false.'],
                ['POST .../pay-adjustments { staff_id, kind: extra | deduction | advance, amount > 0, note }; PATCH .../pay-adjustments/:id { amount?, note? }; DELETE .../pay-adjustments/:id', 'rota_pay manage', 'Migration 137. Each returns the recomputed pay payload. The staff member must belong to the venue. An advance also inserts an advance_repay row (same amount and note, source_id = the advance) in the following week; changing the advance\'s amount changes its repayment too if the repayment still equals the old amount; deleting the advance cascades to it. advance_repay can\'t be created directly but can be edited or deleted like any row.'],
                ['POST .../fill-wages', 'rota_pay manage', 'Upserts the cash_wage_reports header, updates rostered people\'s cash_wage_entries by staff_id (fully paid rows stay fully paid at the new total), inserts the rest, leaves other rows alone. Rostered includes anyone with pay adjustments or carried_owed. The total written is pay (after adjustments); hourly people get hours = paid_hours (worked + PTO) and rate = base_pay / paid_hours. Notes list the adjustments (new rows, or existing rows with empty notes). bank_amount = the row\'s bank_pay; a row whose cash due was fully paid stays fully paid at the new cash_pay. Tips are not written.'],
              ]}
            />
            <H3>Calculation (services/rotaCalc.js)</H3>
            <P>
              Times are minutes from the start of the work date; an end at or before the start adds
              24h. A day-part entry counts its whole shift. An hourly period counts its own minutes
              and, for each shift it overlaps, that shift in proportion (overlap / shift length);
              minutes outside every shift count as hours but earn no points.
            </P>
            <P>
              Entry status (migration 129): only <Mono>on</Mono> entries count as hours worked, days
              worked, shift fractions and points. <Mono>pto</Mono> is paid exactly like working it
              (hourly minutes, and it counts as a day for fixed / day and as having an entry for fixed /
              week). <Mono>sick</Mono>, <Mono>uto</Mono> and <Mono>abs</Mono> are unpaid. Each row
              reports hours (worked), paid_hours (on + pto), paid_days and absence_hours{' '}
              <Mono>{'{ sick, pto, uto, abs }'}</Mono>; totals add paid_hours.
            </P>
            <DataTable
              head={['Figure', 'Rule']}
              rows={[
                ['Hourly pay', 'Minutes in a shift at that shift\'s staff_shift_rates rate (else default_rate); minutes outside any shift at default_rate.'],
                ['Fixed / week', 'default_rate if the person has any on or pto entry that week.'],
                ['Fixed / day', 'default_rate x distinct days with an on or pto entry.'],
                ['Fixed / shift', 'Sum of (shift amount x fraction worked); shift amount = staff_shift_rates rate, else default_rate.'],
                ['Pay override', 'rota_week_staff.pay_override replaces the computed pay for that week (base_pay).'],
                ['Tip payout', 'Migration 143. computeRotaWeek() works out, per person, tip_cash and tip_bank (totals tips_cash = cash paid out, tips_bank, tips_handed_on) after tip_share. Pots paid to shares pay each person their pot share in the pot\'s payout_method. A people pot with payees for the week pays its whole amount to them (split equally in pence, splitPence()): its real total for a points pot, distributed for a manual one; each pot reports payout_method, payout_to, payees [{ staff_id, name, amount }], paid_to_people, no_payees (people pot with nobody picked, paid as shares) and payees_week. Then tip_balance = tip_share − what the pots paid the person is added to their cash (tip_settled_in = cash), or to bank when no shared pot is paid in cash; that also pays out tip moves and nudges. A negative tip_cash / tip_bank means the person was paid more than their share and hands that much on. The new row and total fields are in TIP_ROW_FIELDS / TIP_TOTAL_FIELDS. UI: PotPayout + PayeesModal on each pot card and Bank / Cash columns (hasPayoutSplit()) in RotaTipsTable; Paid in / Paid to in the pot editor (TipPotsSetup.jsx).'],
                ['Pay adjustments', 'rota_pay_adjustments (migration 137): venue, staff, week_start, kind extra | deduction | advance | advance_repay, amount > 0, note, source_id (repay → its advance, ON DELETE CASCADE). computeRotaWeek({ payAdjustments, carriedOwed }) returns base_pay, adjustments[], extra_pay, deductions, advance, advance_repay, carried_owed, pay = max(0, base_pay + extra − deductions + advance − advance_repay + carried_owed) and pay_shortfall (the part below 0, not carried). carried_owed comes from last week\'s Cash Recon wage rows with cash_amount > 0 and cash_amount + bank_amount < total (sum of total − bank_amount − cash_amount per staff_id), loaded in computeWeek(). Pay method (migration 140): cash_staff.pay_method cash | bank | split + bank_amount (split: that much by bank each week, the rest cash); computeRotaWeek() splits pay with splitPay() in shared/payMethod.js into bank_pay / cash_pay (rows) and pay_bank / pay_cash (totals), all redacted without rota_pay. RotaPayTable shows Bank and Cash columns when showSplit (the Rota page: auto, when anyone has bank_pay; the Hours and pay widget: its show_bank option). All these fields are in PAY_ROW_FIELDS, so redactWeek() strips them without rota_pay. UI: the Adjustments column and PayAdjustModal in rota.jsx.'],
                ['Points', 'Sum of shift.points x fraction x role multiplier (1 with no role), plus points_adjustment (sum of point moves in minus out), plus points_nudge (the +/- half-point taps, migration 151), floored at 0.'],
                ['Pot total', 'gross = sum of the venue\'s week cash_sc_entries for sources with that tip_pot_id, plus the pot\'s manual lines for the week: base = sources + £ lines (floored at 0), each percent line adds round2(base x pct / 100), so % lines never compound; gross = max(0, sources + every line\'s value). Each line in the summary carries value (its £ effect). surcharges apply in order, each amount = round2(remaining x pct / 100) where remaining starts at gross and drops by each amount, so they compound; surcharge = gross - remaining; total (what is shared, and what difference is measured against) = remaining. Pot summaries return gross, surcharges ([{ name, pct, amount }]), surcharge (their sum) and total; totals add tips_gross and surcharges (tips_in stays after surcharges). Active pots are listed, plus inactive ones still holding money that week.'],
                ['Points pot share', 'pot total x person points / total points (pot_shares_exact), rounded to a multiple of rota_settings.tip_round_to with tip_round_mode nearest | up | down (migration 107; roundTip() works in whole pence).'],
                ['Manual pot share', 'rota_week_pot_manual amount for the person (staff with an amount are loaded even if inactive).'],
                ['House pot', 'No shares; its total is reported as kept_by_house.'],
                ['Per pot', 'distributed = sum of shares; difference = distributed - total (rounding over/under for points, still to share for manual). A person\'s tip_share is the sum across pots (tip_share_from_pots) plus tip_adjustment, floored at 0.'],
              ]}
            />
            <H3>Frontend</H3>
            <P>
              <Mono>RotaGrid</Mono> holds a local draft of the week in the current mode only and
              saves it with one PUT. Drafts are kept in a module-level <Mono>draftCache</Mono> keyed
              by venue, week and mode, so switching weeks does not lose edits; saving or discarding
              clears it. Entries from the other mode are counted in a notice and are replaced on
              save. Each name has a <Mono>ModeButton</Mono> (per-person tap mode, module-level{' '}
              <Mono>modeCache</Mono>, menu portalled to body so the sticky name cells don't cover it);
              a day-part tap adds an entry with that status, removes one already in that status, or
              switches another status to it. Status codes, names and the colours the printout and image
              use live in <Mono>ENTRY_STATUSES</Mono> in rotaExport.js (<Mono>solid</Mono> for tiles,{' '}
              <Mono>soft</Mono> for hourly boxes); the grid's own Tailwind classes are{' '}
              <Mono>STATUS_CLS</Mono> / <Mono>STATUS_SOFT</Mono> in rota.jsx, and the two must stay the
              same colours. Hourly cells open <Mono>PeriodEditor</Mono>, which validates overlap client-side
              with the same rule as the API (<Mono>periodProblem()</Mono>). Permissions come from{' '}
              <Mono>/me</Mono> via <Mono>useRotaPerms()</Mono>.
            </P>
            <P>
              Export: <Mono>components/staff/rotaExport.js</Mono>, no libraries.{' '}
              <Mono>buildRotaSheet()</Mono> turns the grid's current entries (the draft, flagged as such
              when unsaved) into the sheet the grid shows, without its buttons, roles and totals: a row
              per person (name only), the days across with the shifts under each day (the grid's own
              columns: active shifts plus any old one the week uses), and per cell an ON / status tile
              or OFF per shift (day parts), the periods in a tinted box with a status badge (hourly), or
              one hatched LEFT / AWAY tile for a day off the rota. <Mono>printRota()</Mono> writes{' '}
              <Mono>rotaHtml(sheet)</Mono> (A4 landscape <Mono>@page</Mono>) into a hidden{' '}
              <Mono>srcdoc</Mono> iframe and calls its <Mono>print()</Mono>, so the PDF comes from the
              browser's "Save as PDF". <Mono>saveRotaImage()</Mono> draws the same sheet on a 2x canvas
              (<Mono>drawRotaCanvas()</Mono>, white background, rounded tiles) and downloads a JPG
              (<Mono>image/jpeg</Mono>, quality 0.92), or on touch devices uses{' '}
              <Mono>navigator.share</Mono> with the file when <Mono>canShare</Mono> allows it.
            </P>
            <P>
              Closed days: <Mono>services/openDays.js</Mono> exports{' '}
              <Mono>resolveOpenDaysForWeek(tx, tenantId, venueId, dates)</Mono> (exception, then date
              override, then weekly template), shared by Cash Recon's week-detail and the rota's{' '}
              <Mono>GET .../weeks/:week</Mono> so both agree on which days are closed.{' '}
              <Mono>visibleRotaDates({'{'} week, entries, hideClosed {'}'})</Mono> in rotaExport.js drops
              dates not in <Mono>open_dates</Mono> unless an entry falls on them; <Mono>RotaGrid</Mono> calls
              it with <Mono>hide_closed_on_rota</Mono> and <Mono>buildRotaSheet()</Mono> with{' '}
              <Mono>hide_closed_on_print</Mono>. A closed day that stays visible is labelled Closed.
            </P>
            <P>
              Totals: the printout and image never have them (the Week column and the On shift row
              are on the grid only). Migration 194 dropped <Mono>rota_settings.hide_totals_on_print</Mono>{' '}
              (migration 114), the Rota setup switch that used to leave them out.
            </P>
            <H3>Modules, nav, dashboard</H3>
            <P>
              New module group <Mono>staff</Mono> ("Staff &amp; rota"): <Mono>staff</Mono>,{' '}
              <Mono>rota</Mono>, <Mono>rota_pay</Mono> and <Mono>rota_tips</Mono> (owner/admin only by
              default), <Mono>rota_dashboard</Mono>. Migration 118 split tips out of{' '}
              <Mono>rota_pay</Mono>: each role's <Mono>rota_tips</Mono> started equal to its{' '}
              <Mono>rota_pay</Mono>. Every pay-payload response goes through{' '}
              <Mono>redactWeek()</Mono> (<Mono>rota.js</Mono>), which uses{' '}
              <Mono>permissionLevel(req, key)</Mono> (<Mono>middleware/auth.js</Mono>, also behind{' '}
              <Mono>requirePermission</Mono> and the new <Mono>requireAnyPermission</Mono>) to drop row
              pay fields and <Mono>totals.pay</Mono> without <Mono>rota_pay</Mono>, or tip fields, tip
              totals, <Mono>pots</Mono> and <Mono>moves</Mono> without <Mono>rota_tips</Mono>, and adds{' '}
              <Mono>access: {'{'} pay, tips {'}'}</Mono>. <Mono>useRotaPerms()</Mono> exposes{' '}
              <Mono>canSeePay/canEditPay</Mono> and <Mono>canSeeTips/canEditTips</Mono>. The migration adds a "Staff" nav section after "Service"
              for tenants that already have a nav tree; <Mono>defaultNav.js</Mono> has the same tree
              for new tenants; <Mono>ROUTE_CATALOG</Mono> lists the five routes. The dashboard is a
              third <Mono>DashboardPage</Mono> config: <Mono>hs_dashboards.kind = 'rota'</Mono>,
              mounted at <Mono>/api/rota-dashboards</Mono>, widget types <Mono>rota_grid</Mono>,{' '}
              <Mono>rota_today</Mono>, <Mono>rota_week_pay</Mono>, <Mono>rota_tips</Mono>{' '}
              (CHECK constraint and <Mono>ROTA_WIDGET_TYPES</Mono>, now in{' '}
              <Mono>components/staff/rotaWidgets.jsx</Mono>; since migration 152 any dashboard
              can hold them, see Dashboards (shared widgets)). Navigation is the shared dashboard
              navigator. The
              tips widget has three widget options (<Mono>hs_dashboard_widgets.settings</Mono>):{' '}
              <Mono>hide_pots</Mono>, <Mono>hide_shares</Mono>, <Mono>hide_moves</Mono>, passed to{' '}
              <Mono>RotaTipsTable</Mono> as <Mono>sections</Mono> (the Rota page shows all three).
            </P>
          </section>

          {/* ── MOBILE APP ────────────────────────────── */}
          <section id="mobile-app" data-doc="">
            <H2>Mobile App (/mobile)</H2>
            <P>
              A phone-portrait section of the same admin SPA at <Mono>/mobile/*</Mono>, chosen
              over a separate Vite project / subdomain so it shares the existing Auth0 session,
              API, and GitHub Actions deploy pipeline with zero new infra (no new Nginx server
              block, no new DNS record, no second Auth0 application). It gets its own installable
              identity ("Macaroonie Ops") purely through a second static PWA manifest swapped in
              at runtime — everything else about the app is unchanged.
            </P>
            <H3>Routing and layout</H3>
            <P>
              <Mono>main.jsx</Mono> mounts a second top-level route tree,{' '}
              <Mono>{`<Route path="mobile" element={<MobileShell />}>`}</Mono>, as a sibling of the
              existing <Mono>{`<Route element={<AppShell />}>`}</Mono> tree — both still sit inside
              the same <Mono>RequireAuth</Mono> + <Mono>TenantGate</Mono> wrappers, so login and
              restaurant selection are identical to the desktop app.
              <Mono> admin/src/components/mobile/MobileShell.jsx</Mono> replaces
              <Mono> AppShell</Mono>'s sidebar entirely with a minimal header (back arrow / title /
              sign out, safe-area aware) — there is no shared chrome between the two shells by
              design; the desktop sidebar assumes a ≥1015px tablet per the Standard Design Rules,
              which is the wrong shape for a phone.
            </P>
            <H3>Module registry</H3>
            <P>
              <Mono>admin/src/mobile/registry.js</Mono> exports <Mono>MOBILE_MODULES</Mono> — the
              same "one array drives a picker" pattern as <Mono>modules.js</Mono> /{' '}
              <Mono>defaultNav.js</Mono>. <Mono>MobileHub.jsx</Mono> (the <Mono>/mobile</Mono>{' '}
              index route) renders one tile per entry, in a two-column grid. Shipping a new mobile-optimised page is:
              add an entry here, add the route in <Mono>main.jsx</Mono>, build the page — no
              changes to the shell or hub. An entry&apos;s <Mono>areas</Mono> (the Today feed&apos;s task
              areas, or <Mono>'all'</Mono>) give its tile a badge: <Mono>tileBadge()</Mono> in{' '}
              <Mono>mobile/today.js</Mono> counts that area&apos;s tasks from <Mono>GET /api/ops/today</Mono>{' '}
              for the venue picked on Today (<Mono>maca_today_venue</Mono>), red when one is late;{' '}
              <Mono>todayLine()</Mono> words the Today tile. The hub and the Today page share one query
              (<Mono>useTodayFeed()</Mono>, key <Mono>['ops-today', venueId]</Mono>, the office Today
              page&apos;s key).
            </P>
            <H3>Today on the phone</H3>
            <P>
              <Mono>pages/mobile/MobileToday.jsx</Mono> (<Mono>/mobile/today</Mono>, the first tile) is the office
              Today page in one column, built from its exported parts (<Mono>Glance</Mono>,{' '}
              <Mono>TaskBoard</Mono>, <Mono>FormSheet</Mono>, <Mono>greeting()</Mono>, <Mono>readVenue()</Mono>{' '}
              in <Mono>pages/OpsToday.jsx</Mono>), which take <Mono>linkFor</Mono>: <Mono>opsLink(path)</Mono>{' '}
              sends an office path to the phone&apos;s own page (<Mono>/purchasing</Mono> to{' '}
              <Mono>/mobile/purchasing</Mono> with its query, <Mono>/cash-recon</Mono> to{' '}
              <Mono>/mobile/cash-up</Mono>, <Mono>/orders</Mono>, <Mono>/food-safety</Mono> and{' '}
              <Mono>/checklists</Mono> to their phone pages), else to the office site on{' '}
              <Mono>ops.</Mono> (<Mono>standardHref()</Mono>, an <Mono>&lt;a href&gt;</Mono>). Pepper is its
              own tile; the page links to it. The mobile routes end with a catch-all to the hub, so
              links to pages the phone no longer has (<Mono>/mobile/dashboards</Mono>) land there.
            </P>
            <H3>Service worker</H3>
            <P>
              <Mono>vite-plugin-pwa</Mono> (<Mono>admin/vite.config.js</Mono>) builds <Mono>sw.js</Mono> with Workbox. It
              precaches only the built JS, CSS, fonts and images, never <Mono>index.html</Mono>, so a new deploy can&apos;t
              boot from an old cached page; nginx sends <Mono>index.html</Mono> for every app route with no-cache headers.
              Because of that there is no navigation fallback (<Mono>navigateFallback: null</Mono>): a fallback to a page
              that isn&apos;t precached makes Workbox throw <Mono>non-precached-url</Mono> each time the worker starts, which
              showed in every console from 22 Aug to 14 Oct 2026.
            </P>
            <H3>Page crash message</H3>
            <P>
              <Mono>PageErrorBoundary</Mono> (<Mono>components/PageErrorBoundary.jsx</Mono>) wraps the page outlet in
              both <Mono>AppShell</Mono> and <Mono>MobileShell</Mono>, keyed by the path. A page that throws while it renders
              shows &quot;This page stopped working&quot; with the error text and a Reload button, and logs the error with its
              component stack (<Mono>Page crashed:</Mono>), instead of unmounting the whole admin to a blank screen. The
              sidebar and header stay usable, and moving to another page clears it. It doesn&apos;t catch errors in event
              handlers or promises; those still need their own try/catch and a visible message.
            </P>
            <H3>Hidden inputs (sr-only)</H3>
            <P>
              A file, colour or switch input hidden with Tailwind&apos;s <Mono>sr-only</Mono> is absolutely positioned. The
              admin&apos;s shell is a full-height box that never scrolls; pages scroll inside their own panes. An{' '}
              <Mono>sr-only</Mono> input with no positioned parent inside such a pane was placed where it would be with the
              pane unscrolled, below the screen. That made the window itself scrollable, and when the input got focus the
              window scrolled to it and the whole app moved off screen. The browser focuses a file input as its dialog
              closes, so on the GloriaFood import (at the bottom of a long settings pane) picking a file left a blank page.
              The address didn&apos;t change, nothing was logged, and Back fixed it. <Mono>index.css</Mono> now pins{' '}
              <Mono>.sr-only</Mono> to <Mono>top: 0; left: 0</Mono> of its containing block, so it stays on screen. Also give
              the label or wrapper of a hidden input <Mono>relative</Mono>, so the input sits inside it.
            </P>
            <H3>Scoped second PWA manifest</H3>
            <P>
              <Mono>vite-plugin-pwa</Mono> already generates the main app's manifest (
              <Mono>manifest.webmanifest</Mono>, scope <Mono>/</Mono>) and injects its{' '}
              <Mono>{'<link rel="manifest">'}</Mono> tag into <Mono>index.html</Mono> at build
              time. Rather than configure a second plugin instance (this is a single-page SPA —
              there's only one <Mono>index.html</Mono> to inject into), a hand-written static file{' '}
              <Mono>admin/public/mobile.webmanifest</Mono> ships alongside it (scope{' '}
              <Mono>/mobile/</Mono>, <Mono>start_url: /mobile</Mono>, its own name/icons/theme
              colour). <Mono>MobileShell</Mono>'s <Mono>useMobileManifest()</Mono> effect swaps
              the existing <Mono>{'<link rel="manifest">'}</Mono>'s <Mono>href</Mono>, the{' '}
              <Mono>{'<link rel="apple-touch-icon">'}</Mono>'s <Mono>href</Mono>, the{' '}
              <Mono>{'<meta name="theme-color">'}</Mono>, and{' '}
              <Mono>{'<meta name="apple-mobile-web-app-title">'}</Mono> on mount, and restores the
              originals on unmount. iOS reads the apple-touch-icon/title meta tags from whatever
              page is current when "Add to Home Screen" runs (Safari doesn't consult the manifest
              for pre-17.4 behaviour), so swapping those tags — not just the manifest link — is
              what actually changes the installed icon/name on iPhone.
            </P>
            <InfoBox type="warn">
              This swap only takes effect while a <Mono>/mobile</Mono> route is mounted — a user
              who installs from the desktop routes still gets the main "Macaroonie" identity, and
              vice versa. There is no server-side content negotiation involved; both manifests and
              both icon sets ship in every build and are just static files under{' '}
              <Mono>admin/public/</Mono> (<Mono>mobile.webmanifest</Mono>,{' '}
              <Mono>mobile-pwa-192.png</Mono>, <Mono>mobile-pwa-512.png</Mono>,{' '}
              <Mono>mobile-apple-touch-icon.png</Mono>).
            </InfoBox>
            <P>
              <Mono>MobileShell</Mono> also fetches <Mono>GET /me</Mono> and calls{' '}
              <Mono>applySiteTheme(me.site_theme)</Mono> itself, duplicating the effect{' '}
              <Mono>AppShell.jsx</Mono> runs for the desktop app. <Mono>/mobile</Mono> never
              mounts <Mono>AppShell</Mono>, so without this the <Mono>--site-accent</Mono>/{' '}
              <Mono>--site-primary</Mono> CSS variables would never be set on a session that opens
              straight into <Mono>/mobile</Mono> (e.g. the installed PWA's own start URL) — any
              mobile UI that themes itself with those variables (the H&S Dashboard widget headers)
              would silently show the hardcoded fallback colour instead of the tenant's actual
              brand accent.
            </P>
            <H3>Mobile H&amp;S Dashboard</H3>
            <P>
              <Mono>admin/src/pages/mobile/MobileHSDashboard.jsx</Mono> is a parallel
              implementation of <Mono>HSDashboard.jsx</Mono> for logging only — same dashboards-as-tabs
              (<Mono>DashboardTabs</Mono>: framed strip, arrow buttons that scroll it, shown while there
              is more that way), same widget types, same underlying{' '}
              <Mono>/api/hs-dashboards/*</Mono> endpoints and the same shared body components (
              <Mono>ChecklistRunPanel</Mono>, <Mono>TempChecksTable</Mono>,{' '}
              <Mono>DeliveryChecksPanel</Mono>, <Mono>HoldChecksTable</Mono>,{' '}
              <Mono>CookingChecksPanel</Mono>, <Mono>HSActionLogPanel</Mono>) — full interactivity,
              for checks. Layout editing (dashboards and widgets) was removed from the Ops app: it is
              done on the desktop page. <Mono>WIDGET_TYPE_BY_KEY</Mono> is imported from{' '}
              <Mono>HSDashboard.jsx</Mono>.
            </P>
            <P>
              The one deliberate difference: mobile ignores <Mono>col_span</Mono> and{' '}
              <Mono>height_px</Mono> entirely and always renders one full-width column at natural
              content height, so the page itself is the only scroll container — no nested
              scroll-within-scroll widget regions, which is a common mobile UX papercut. Those two
              fields still exist on the shared <Mono>hs_dashboard_widgets</Mono> rows and still
              drive the desktop grid; a widget resized on desktop is unaffected on mobile and vice
              versa, same "one data model, per-surface rendering rules" approach already used for
              website-CMS data blocks.
            </P>
            <InfoBox type="info">
              This first mobile module reuses the existing food-safety/checklist body components
              unmodified — they already use responsive Tailwind classes (
              <Mono>{'hidden sm:table-cell'}</Mono>, <Mono>{'overflow-x-auto'}</Mono> table
              wrappers, <Mono>{'sm:grid-cols-2'}</Mono>) rather than a fixed min-width, so they
              hold up reasonably at phone width without a mobile-specific rewrite. If a future
              mobile module's body component doesn't already reflow this way, redesign that
              component rather than assuming the mobile shell alone will fix it.
            </InfoBox>
            <H3>Mobile Expenses</H3>
            <P>
              <Mono>admin/src/pages/mobile/MobileExpenses.jsx</Mono> — the second mobile module.
              Venue picker + a week navigator (prev / next, a date overlay that jumps to that
              date's Monday via <Mono>getMonday()</Mono>, Back to this week). <Mono>WeekExpensesPanel</Mono>{' '}
              reads the week through <Mono>useReconWeek()</Mono> (week-detail, which now also returns
              each expense's <Mono>receipt_url</Mono>): week cash / card / VAT totals, then one card per
              day (Mon-Sun, closed days labelled from <Mono>open_dates</Mono>, submitted days locked)
              with a per-day Add and tap-to-edit rows. <Mono>useExpenseActions(venueId)</Mono> holds the
              create / update / delete mutations (date passed per call; each invalidates that day
              and week-detail) and is shared with <Mono>PettyCashPanel</Mono>, the single-day panel the
              Cash Dashboard's petty cash widget still uses. The Add/Edit modal has a
              category chip picker and a <Mono>capture="environment"</Mono> file input for
              snapping a receipt photo straight from the phone camera. Reuses the exact same API
              surface as <Mono>CashRecon.jsx</Mono>'s <Mono>ExpensesSection</Mono> (
              <Mono>GET config</Mono> for categories, <Mono>GET/POST/PUT/DELETE
              .../cash-recon/expenses[/:id]</Mono>, <Mono>POST .../expenses/:id/receipt</Mono>) —
              no new backend surface for this feature beyond the bug fix below. Blocked (no Add
              button, inline banner instead) when the day's report is already{' '}
              <Mono>submitted</Mono>, matching what the API now enforces server-side.
            </P>
            <InfoBox type="warn">
              Building this surfaced a live bug in <Mono>POST /:venueId/cash-recon/expenses</Mono>:
              the Zod schema required a <Mono>report_id</Mono> (a UUID for an existing{' '}
              <Mono>cash_daily_reports</Mono> row), but <Mono>ExpensesSection.handleAdd()</Mono> —
              the ONLY caller — has only ever sent <Mono>date</Mono>, never{' '}
              <Mono>report_id</Mono> (it doesn't have one in scope; see its props). Every "Add
              expense" click via that inline form has been failing Zod validation (400) since it
              shipped, silently swallowed by an empty <Mono>catch {'{}'}</Mono>. Fixed by changing
              the endpoint to take <Mono>date</Mono> and find-or-create the daily report row itself
              (the same <Mono>INSERT … ON CONFLICT (tenant_id, venue_id, report_date) DO
              UPDATE … RETURNING *</Mono> upsert <Mono>PUT /daily/:date</Mono> already uses for its
              header row) — this also blocks adding to a submitted report, matching that PUT's
              guard. Both the desktop "Add expense" form and the new mobile page call this same,
              now-working endpoint. Deliberately NOT reusing <Mono>PUT /daily/:date</Mono> itself
              for single-expense writes — that endpoint replaces the day's income/takings/SC
              entries wholesale from the request body, so a caller that only wants to add one
              expense would need to round-trip the entire day's state first to avoid wiping it.
            </InfoBox>
            <H3>Mobile Purchasing</H3>
            <P>
              <Mono>admin/src/pages/mobile/MobilePurchasing.jsx</Mono> (replaced Mobile Order Sheets): a venue
              picker over the same <Mono>PurchasingApp</Mono> as the desktop page with <Mono>phone</Mono> set
              (single column, smaller padding). The order form's header and totals bar are sticky inside
              <Mono> MobileShell</Mono>'s scrolling main. See the Purchasing section.
            </P>
            <H3>Suggesting the mobile view from desktop</H3>
            <P>
              <Mono>admin/src/components/MobileSuggestModal.jsx</Mono>, mounted at the bottom of{' '}
              <Mono>AppShell</Mono> (never rendered under <Mono>MobileShell</Mono> itself, so it
              can't offer to send someone already on <Mono>/mobile</Mono> back to <Mono>/mobile</Mono>).
              Detects a touch device in portrait — <Mono>IS_TOUCH</Mono> (the same{' '}
              <Mono>{'navigator.maxTouchPoints > 0'}</Mono> module-load check used elsewhere) plus a{' '}
              <Mono>{"matchMedia('(max-width: 700px) and (orientation: portrait)')"}</Mono> query,
              checked on mount and on that query's own <Mono>change</Mono> listener so rotating a
              phone into portrait mid-session also triggers it, not just page load. On a match it
              shows a large centred modal pointing at <Mono>/mobile</Mono>. Either button —{' '}
              <Mono>Open mobile view</Mono> (navigates there) or <Mono>Stay on this page</Mono>{' '}
              (dismiss) — sets <Mono>maca_mobile_prompt_dismissed</Mono> in localStorage, so it's a
              one-time offer per browser rather than a repeating nag.
            </P>
            <H3>Persistent mobile / standard toggle</H3>
            <P>
              <Mono>admin/src/components/MobileViewToggle.jsx</Mono> is a separate, always-on
              counterpart to the suggestion modal above — a small floating pill button fixed at{' '}
              <Mono>bottom-4 left-4</Mono>, shown any time the viewport matches{' '}
              <Mono>{"IS_TOUCH && matchMedia('(max-width: 700px)')"}</Mono> (no portrait
              requirement, no dismissal — it reappears on every visit rather than offering once).
              It takes a <Mono>target</Mono> prop: <Mono>{"target=\"mobile\""}</Mono> (mounted in{' '}
              <Mono>AppShell.jsx</Mono>, next to <Mono>MobileSuggestModal</Mono>) navigates to{' '}
              <Mono>/mobile</Mono>. The <Mono>{"target=\"standard\""}</Mono> copy in{' '}
              <Mono>MobileShell.jsx</Mono> was removed once the Ops app had its own host (ops.):
              the phone app has no link back to the standard view.
            </P>
            <H3>Mobile Cash Up</H3>
            <P>
              <Mono>admin/src/pages/mobile/MobileCashUp.jsx</Mono> (<Mono>/mobile/cash-up</Mono>).
              Venue picker + week nav over a plain vertical list of the week's 7 days, each row
              showing the day name/date, a <Mono>StatusBadge</Mono>, total income, and variance —
              fetched from the same <Mono>GET /venues/:id/cash-recon/week/:week_start</Mono>{' '}
              endpoint the desktop <Mono>WeekView</Mono>'s day cards already use. Tapping a day
              opens the module-local <Mono>MobileDayDeclaration</Mono> for the complete daily
              declaration — the same "list, then a full-page detail" shape the other mobile modules use. A "Week variance"
              tile below the list sums the days' variances plus the week's cash wages.
            </P>
            <H3>Single header on the day-detail view</H3>
            <P>
              <Mono>CashRecon.jsx</Mono>'s <Mono>DayView</Mono> renders its own sticky header
              (back arrow, full date, status/save indicator, Submit/Unsubmit) — fine on desktop,
              but under <Mono>MobileShell</Mono> it stacked directly underneath the shell's own
              header, producing two back arrows and two bars. Fixed with a small mechanism rather
              than a rebuild: <Mono>MobileShell.jsx</Mono> exports{' '}
              <Mono>useHideMobileHeader()</Mono> — called by <Mono>MobileDayDeclaration</Mono> to
              suppress the shell's header for as long as it's mounted — and{' '}
              <Mono>MobileLogoutButton</Mono>, the same sign-out button the shell header uses, so
              the replacement header can fold sign-out back in. <Mono>DayView</Mono> itself gained
              a <Mono>hideHeader</Mono> + <Mono>onStateChange</Mono> prop pair (the same shape as{' '}
              <Mono>ChecklistRunPanel</Mono>'s existing <Mono>hideHeader</Mono>/
              <Mono>onStateChange</Mono>): with <Mono>hideHeader</Mono>, it skips its own header
              div entirely and instead reports <Mono>{'{ status, saving, saved, saveErr, isSubmitted, submitPending, submit, unsubmit }'}</Mono>{' '}
              via <Mono>onStateChange</Mono> on every change, so <Mono>MobileDayDeclaration</Mono>{' '}
              can render one unified header — back arrow (to the day list), an{' '}
              <Mono>EEE, dd MMM</Mono> date (e.g. "Mon, 21 Sep") with the autosave indicator
              underneath, a Submit/Unsubmit button, and sign-out — with <Mono>DayView</Mono>'s
              body rendered underneath it, header-less. No <Mono>StatusBadge</Mono> pill here —
              the Submit/Unsubmit button's own label and colour already say submitted-vs-not, so
              a separate status pill next to the date was redundant (the week-list view above
              keeps its own <Mono>StatusBadge</Mono> per day, since that view has no per-day
              submit button to read the state off instead). The
              underlying visibility toggle is a plain boolean context (mount sets it, unmount
              clears it) — no page content passed through context, so there's no render-loop risk
              from passing JSX/objects through it.
            </P>
            <H3>Mobile Wages</H3>
            <P>
              <Mono>admin/src/pages/mobile/MobileWages.jsx</Mono> (<Mono>/mobile/wages</Mono>) is a venue
              picker and week navigator over <Mono>WeekWagesEditor</Mono> with{' '}
              <Mono>layout="cards"</Mono> (see Cash Reconciliation), so it shows exactly what the
              desktop Wages page and the dashboard widgets show. The earlier Paid checkbox, the
              per-entry <Mono>/paid</Mono> endpoint and the submitted-report lock are gone with wage
              submission (migration 137). It passes <Mono>showBank={'{false}'}</Mono> and{' '}
              <Mono>hidePaidOnForAll</Mono> (Bank is still filled from the pay method; Paid on is set by{' '}
              <Mono>setPaid()</Mono> / <Mono>payInFull()</Mono> to today when today is in the week). In
              the cards layout each person has a header strip with the name in a larger font. The day
              declaration (<Mono>DayView</Mono>) has a read-only Wages paid today card from{' '}
              <Mono>['cash-recon-wages', venueId, week]</Mono>: entries with <Mono>paid_date</Mono> = the
              day, plus a warning for cash paid with no day (counts in the week only).
            </P>
            <H3>Mobile Allergens</H3>
            <P>
              <Mono>admin/src/pages/mobile/MobileAllergens.jsx</Mono> (<Mono>/mobile/allergens</Mono>,
              registry key <Mono>allergens</Mono>) renders <Mono>AllergenLookup</Mono> from{' '}
              <Mono>components/menus/AllergenMatrix.jsx</Mono> with <Mono>phone</Mono>: menu picker and
              search in a <Mono>sticky top-0</Mono> bar inside <Mono>MobileShell</Mono>&apos;s scrolling{' '}
              <Mono>main</Mono>, the tag filter folded behind one button that names the active filters,
              bottom padding so the Standard view pill doesn&apos;t cover the last rows. Menu choice in
              localStorage <Mono>maca_allergen_lookup_mobile</Mono>. Read-only, same{' '}
              <Mono>GET /api/menus/:id/allergens</Mono> as the dashboard widget; no new API.
            </P>
          </section>

          {/* ── H&S ACTION LOG ────────────────────────────── */}
          <section id="hs-action-log" data-doc="">
            <H2>H&amp;S Action Log</H2>
            <P>
              Migration 092. A general facilities/compliance to-do list per venue — migrated from
              the legacy spreadsheet's "ActionLog" tab (Date, Category, Task, Details, Assigned To,
              Due Date, Priority, Completed, Notes, Attachments). Not date-scoped like the other
              food-safety checks — an entry stays open across days until completed.
            </P>
            <H3>Schema</H3>
            <DataTable
              head={['Table', 'Purpose']}
              rows={[
                ['hs_action_categories', 'Tenant-managed, reorderable named list (same pattern as fs_hold_stations — soft-deleted via is_active, not a fixed enum). Seeded with the spreadsheet\'s four categories (Repairs, Records, Training, Cleaning) for every tenant.'],
                ['hs_action_log', 'One row per action item. category_id (nullable FK, ON DELETE SET NULL), logged_date, task, details, assigned_to (free text — historical assignee names were inconsistent nicknames, not a clean FK target), due_date, priority enum (low/medium/high/critical), is_completed + completed_by + completed_at, notes, attachment_media_id (nullable FK to media_items), created_by.'],
              ]}
            />
            <InfoBox type="warn">
              <Mono>completed_by</Mono> / <Mono>created_by</Mono> are plain <Mono>text</Mono> columns
              storing <Mono>req.user.email</Mono>, not a FK to <Mono>users(id)</Mono> — matching
              <Mono> checklist_instances.completed_by</Mono>'s existing convention exactly. Don't
              "fix" these to a uuid FK without also changing that convention everywhere else.
            </InfoBox>
            <H3>API</H3>
            <P>
              Mounted at <Mono>/api/hs-action-log</Mono>, gated by <Mono>requirePermission('hs_action_log', …)</Mono>.
              Category CRUD + <Mono>PATCH /categories/reorder</Mono> follows the exact
              fs_hold_stations pattern. Entries: <Mono>GET /entries?venue_id=&amp;status=open|completed|all&amp;category_id=</Mono>,
              <Mono> POST</Mono>, generic <Mono>PATCH /entries/:id</Mono>, and a dedicated
              <Mono> PATCH /entries/:id/complete</Mono> that always sets
              <Mono> completed_by</Mono>/<Mono>completed_at</Mono> server-side from the caller's
              JWT — never trust a client-supplied value for who completed something.
            </P>
            <H3>Attachments</H3>
            <P>
              Reuses the existing Media library rather than a bespoke upload path.
              <Mono> MediaLibraryModal</Mono> in <Mono>picker</Mono> mode returns
              <Mono> (url, item)</Mono> to <Mono>onPick</Mono>; the entry stores
              <Mono> item.id</Mono> as <Mono>attachment_media_id</Mono> (a real FK) and keeps the
              URL only for display. Media library uploads are image-only
              (<Mono>ALLOWED_MIMES</Mono> in <Mono>media.js</Mono>) — matches the spreadsheet's
              observed use case (photo evidence), not PDFs.
            </P>
            <H3>Key files</H3>
            <DataTable
              head={['File', 'Purpose']}
              rows={[
                ['api/src/routes/hsActionLog.js', 'All Action Log routes.'],
                ['admin/src/components/hsActionLog/shared.jsx', 'HSActionLogPanel — the one implementation, reused by the standalone page and the H&S Dashboard\'s action_log widget. Also the category-management modal.'],
                ['admin/src/pages/HSActionLog.jsx', 'Standalone page at /hs-action-log — just a venue picker + HSActionLogPanel.'],
              ]}
            />
          </section>

          {/* ── NAVIGATION & LAUNCHER ─────────────────────── */}
          <section id="navigation" data-doc="">
            <H2>Navigation &amp; Launcher</H2>
            <P>
              Migration 091 replaces the previously-hardcoded <Mono>NAV_SECTIONS</Mono> array in
              <Mono> AppShell.jsx</Mono> with an admin-configurable, arbitrary-depth tree per
              tenant, plus a tenant-wide toggle to swap the sidebar for a quick-access tile
              launcher instead.
            </P>
            <H3>Schema</H3>
            <DataTable
              head={['Table / column', 'Purpose']}
              rows={[
                ['nav_items', 'Self-referencing tree (parent_id → nav_items.id, ON DELETE CASCADE). kind is \'section\' (pure grouping label, no route) or \'link\' (route required). module ties an item to the existing tenant_modules/tenant_roles permission system. hidden_role_ids uuid[] is an ADDITIONAL hide on top of module gating. show_in_launcher + launcher_sort_order mark items that also appear as quick-access tiles.'],
                ['tenants.nav_style', "'sidebar' (default) or 'launcher' — tenant-wide, toggled via PATCH /api/nav/style."],
              ]}
            />
            <H3>API — /api/nav</H3>
            <P>
              Every route requires <Mono>requirePermission('nav_designer', 'view' | 'manage')</Mono>
              — owner-only <Mono>manage</Mono> by default (see <Mono>modules.js</Mono>).
            </P>
            <DataTable
              head={['Method', 'Path', 'Purpose']}
              rows={[
                ['GET', '/route-catalog', 'Static list of every real admin-portal route + a suggested icon/label/module — the designer can only ever point a link at a known page, never an arbitrary URL.'],
                ['GET', '/items', 'Flat list of active nav_items for the tenant.'],
                ['POST', '/items', 'Create a section or link. New items land at the end of their sibling list.'],
                ['PATCH', '/items/reorder', 'Body { parent_id, ids } — re-sequences sort_order for one sibling list (move up/down).'],
                ['PATCH', '/items/:id/reparent', 'Body { parent_id, index } — moves an item to a new parent at a position. Used for both "indent" (new parent = previous sibling) and "outdent" (new parent = grandparent) from the frontend.'],
                ['PATCH', '/items/:id', 'Generic field update (label, icon, route, module, hidden_role_ids, show_in_launcher, is_active, …).'],
                ['DELETE', '/items/:id', 'Hard delete — children cascade via the FK.'],
                ['POST', '/reset', 'Deletes every nav_items row for the tenant and re-seeds via seedDefaultNav().'],
                ['PATCH', '/style', 'Body { nav_style } — sidebar ↔ launcher.'],
              ]}
            />
            <H3>The outline editor, not drag-and-drop reparenting</H3>
            <P>
              Free-form drag-and-drop tree reparenting (dropping a node onto an arbitrary other
              node at an arbitrary position) is fragile to build correctly. Instead the designer
              is an outline editor — move up/down, indent, outdent — which still supports
              arbitrary depth. <Mono>reparent()</Mono> computes the old-siblings list (excluding
              the moved item), computes the new-siblings list under the target parent (reusing
              the same list if the parent didn't change), splices the item in at the requested
              index, persists the new <Mono>parent_id</Mono>, then re-sequences
              <Mono> sort_order</Mono> for the new-siblings list and — if the parent actually
              changed — also re-sequences the old-siblings list to close the gap left behind.
            </P>
            <H3>/api/me: nav_tree and launcher_tiles</H3>
            <P>
              <Mono>platform.js</Mono>'s <Mono>/api/me</Mono> handler fetches the tenant's active
              <Mono> nav_items</Mono>, builds the tree, and prunes it against the caller's
              effective permissions and role id (<Mono>pruneNavTree()</Mono>): a link is dropped
              if its module is disabled/unpermitted or its own id is in
              <Mono> hidden_role_ids</Mono> for the caller's role; a section is dropped only if
              every child was pruned. Platform admins bypass all of it. The response also
              includes <Mono>launcher_tiles</Mono> — the flat set of visible link items with
              <Mono> show_in_launcher = true</Mono>, sorted by <Mono>launcher_sort_order</Mono>.
              <Mono> AppShell.jsx</Mono> renders <Mono>nav_tree</Mono> directly instead of a
              hardcoded array (superseding the note about static gating in the RBAC section
              above); when <Mono>nav_style === 'launcher'</Mono> it renders a single "Quick
              access" link to <Mono>/launcher</Mono> instead of the tree.
            </P>
            <H3>/api/me: site_theme</H3>
            <P>
              The same handler also returns <Mono>site_theme</Mono> — the tenant's public-website
              brand colours (<Mono>tenant_site.theme.colors</Mono>), resolved with the same
              default fallbacks <Mono>head.eta</Mono> uses so every tenant gets a value even
              before touching the Website builder. Piggybacks on the existing{' '}
              <Mono>/api/me</Mono> round-trip (already fetched on every admin page load) rather
              than adding a new one. <Mono>SettingsContext.applySiteTheme()</Mono> writes it as{' '}
              <Mono>--site-primary</Mono> / <Mono>--site-accent</Mono> / etc CSS variables on{' '}
              <Mono>:root</Mono> — a namespace deliberately separate from <Mono>--primary</Mono>{' '}
              (the operator's own admin colour pick, Settings page) and <Mono>--accent</Mono> (a
              neutral hover-state grey used pervasively via <Mono>hover:bg-accent</Mono>), so
              borrowing the tenant's brand colour for admin UI (e.g. Cash Recon's{' '}
              <Mono>SectionCard</Mono> header/footer bars) never repaints the app's own hover
              surfaces.
            </P>
            <H3>Page colours and card headers (admin/src/index.css)</H3>
            <P>
              The admin uses the Rota dashboard's look everywhere: a light grey page canvas,
              white cards, and an accent header bar on each card. The pieces:
            </P>
            <DataTable
              head={['Piece', 'What it does']}
              rows={[
                ['--page / bg-page', 'The grey canvas (220 16% 95%). Set on body, AppShell\'s and MobileShell\'s root, TenantGate and the H&S / Cash / Rota dashboard root.'],
                ['--background / bg-background', 'White surfaces: cards, page title bars, sidebar, modals, and the list-and-detail workspaces (Bookings, Timeline, Customers, Cash Recon\'s week grid).'],
                ['--border, --muted, --muted-foreground, --accent', 'Darker than before (border 86%, muted 94%, muted text 40%, hover 92%) so lines, fills and secondary text read on both white and grey.'],
                ['.border:where(...) rule', 'Any element with the plain border class and no bg-* class gets a white background (one-class specificity, in @layer components): lists, table frames, inputs and outlined buttons turn white on the grey page with no per-page edits. bg-* utilities and hover:/disabled: variants still win. An element that must stay see-through over a coloured parent sets bg-transparent.'],
                ['.section-head', 'The card header bar: --site-accent-soft background and a 2px --site-accent bottom border (the tenant\'s website accent, default pink). Used by every shared SectionCard / Card / Section component, dashboard widget and Overview tile header, the Rota page panels and Cash Recon\'s SectionCard. Don\'t combine it with border-b (that resets the border width to 1px).'],
                ['bg-card', 'Mapped to --background in tailwind.config.js (it was used but never defined).'],
              ]}
            />
            <H3>Seeding</H3>
            <P>
              <Mono>api/src/config/defaultNav.js</Mono> exports <Mono>DEFAULT_NAV_TREE</Mono> +
              <Mono> seedDefaultNav(tx, tenantId)</Mono>, used both for brand-new tenants
              (<Mono>POST /api/platform/tenants</Mono>) and the designer's <Mono>POST
              /api/nav/reset</Mono>. Migration 091 also seeds this same tree once, directly in
              SQL, for every tenant that existed at migration time — that one-time seed is never
              re-run, so <Mono>defaultNav.js</Mono> is the only copy that matters going forward;
              keep them in sync by hand if the default tree ever changes.
            </P>
            <P>
              Migration 196 (20 Oct 2026) replaced every tenant's menu with the new default tree once: it
              deletes every <Mono>nav_items</Mono> row, sets <Mono>tenants.nav_style = 'sidebar'</Mono> and
              re-seeds each tenant from a JSON copy of <Mono>DEFAULT_NAV_TREE</Mono> through a temporary{' '}
              <Mono>pg_temp.seed_nav()</Mono> function (so launcher tiles and designer edits went). The tree has
              eleven sections grouped by job (Home, Service, Money, Health &amp; safety, Stock, People, Menus,
              Brand &amp; web, Venues, Admin, Help) and names every <Mono>ROUTE_CATALOG</Mono> route exactly once.{' '}
              <Mono>api/test/nav-default.test.mjs</Mono> fails when the migration's JSON and{' '}
              <Mono>DEFAULT_NAV_TREE</Mono> differ, when a catalogue route is missing or doubled, or when a new
              tenant's <Mono>/api/me</Mono> tree doesn't match: change both together.
            </P>
            <P>
              Migration 202 (23 Oct 2026) added the <strong>Store tech</strong> section after Venues: the old
              Till setup page's tabs became pages of their own (<Mono>/pos/tills</Mono>, <Mono>/pos/kiosks</Mono>,{' '}
              <Mono>/pos/kitchen</Mono>, <Mono>/pos/printers</Mono>, <Mono>/pos/printing</Mono>,{' '}
              <Mono>/pos/cards</Mono>, <Mono>/pos/types</Mono>, <Mono>/pos/streams</Mono>, <Mono>/pos/courses</Mono>,{' '}
              <Mono>/pos/staff</Mono>, <Mono>/pos/roles</Mono>, <Mono>/pos/receipts</Mono>, <Mono>/pos/recon</Mono>),
              each a catalogue route, with Floor plan and Menu screens beside them. Unlike 196 it edits each
              tenant's menu in place: it deletes the <Mono>/pos</Mono> link (with its Floor plan child) and the{' '}
              <Mono>/screens</Mono> link wherever they are, inserts the section after the top-level item holding{' '}
              <Mono>/venues</Mono> (else at the end), gives the new links the roles the old ones were hidden from,
              and moves a quick-access tile to Tills / Menu screens. Other Navigation changes stay; a tenant that
              already has <Mono>/pos/tills</Mono> is skipped. The nav test applies 202's change to 196's JSON and
              compares the result with <Mono>DEFAULT_NAV_TREE</Mono>.
            </P>
            <P>
              Later migrations add single links the same way (insert beside a known route, copy its{' '}
              <Mono>hidden_role_ids</Mono>, skip tenants that already have the route): 208 Kiosk analytics, 211 Loyalty,
              216 Device updates, and 219 <strong>Venue hub</strong> (<Mono>/pos/hub</Mono>, just before{' '}
              <Mono>/pos/printers</Mono>, 30 Oct 2026: the hub moved off the Printers page onto its own,{' '}
              <Mono>components/pos/HubSection.jsx</Mono>). The nav test applies each of them too.
            </P>
            <H3>Launcher personalisation (admin/src/pages/Launcher.jsx)</H3>
            <P>
              Tile order and visibility are per-user, per-tenant, stored in
              <Mono> localStorage</Mono> under <Mono>maca_launcher_prefs_&#123;tenantId&#125;</Mono> —
              the same pattern as <Mono>maca_settings</Mono> / <Mono>maca_timeline_prefs</Mono>,
              not a DB table. The admin's <Mono>launcher_tiles</Mono> order from <Mono>/api/me</Mono>
              is the default; a viewer's local <Mono>order</Mono>/<Mono>hidden</Mono> arrays are
              merged on top (<Mono>applyPrefs()</Mono>), and any tile the admin removed (or the
              viewer no longer has access to) is dropped even if still named in the stored
              override. "Reset to admin defaults" just clears the localStorage key.
            </P>
            <InfoBox type="warn">
              Switching a tenant to <Mono>nav_style: 'launcher'</Mono> before any nav item has
              <Mono> show_in_launcher</Mono> set hides the entire sidebar with nothing to replace
              it. <Mono>Launcher.jsx</Mono>'s header always shows a "Back to full menu" button
              (visible to <Mono>nav_designer:manage</Mono>) whenever <Mono>nav_style ===
              'launcher'</Mono> — deliberately NOT conditioned on the tile count, after an earlier
              version that only showed it in the empty state left a tenant with one tile
              configured stranded in production.
            </InfoBox>
          </section>

          {/* ── OVERVIEW TILES ────────────────────────────── */}
          <section id="overview-tiles" data-doc="">
            <H2>Overview Tiles</H2>
            <P>
              Migration 093 turns the home page ("Dashboard", renamed "Overview") into a
              tile-based layout. Simpler than <Mono>hs_dashboards</Mono>/<Mono>hs_dashboard_widgets</Mono> —
              there's no multiple-named-dashboards concept, since Overview is tenant-wide (not
              per-venue). Layout control (<Mono>col_span</Mono>/<Mono>height_px</Mono>/<Mono>sort_order</Mono>)
              mirrors <Mono>hs_dashboard_widgets</Mono>; per-role visibility
              (<Mono>hidden_role_ids</Mono>) mirrors <Mono>nav_items</Mono>. Gated by the existing
              <Mono> dashboard</Mono> module (relabelled "Overview") — no new module was needed.
            </P>
            <H3>Schema</H3>
            <DataTable
              head={['Table / column', 'Purpose']}
              rows={[
                ['dashboard_tiles', "One row per tile. tile_type (CHECK-constrained enum), title_override, hidden_role_ids uuid[], col_span, height_px, sort_order. UNIQUE(tenant_id, tile_type) — a tenant can't add the same tile twice."],
              ]}
            />
            <H3>Tile types</H3>
            <DataTable
              head={['tile_type', 'Source']}
              rows={[
                ['quick_access', "Renders the existing per-user Shortcuts component — unchanged, a separate personalisation axis from tile layout."],
                ['stats_today', 'The 4 stat cards (bookings/covers/deposit revenue/upcoming), computed client-side from GET /api/bookings for today.'],
                ['upcoming_bookings', "Today's remaining bookings, same data source as stats_today."],
                ['venues_status', 'One row per venue from GET /api/venues.'],
                ['hs_today_status', "Combined Checklists + Food safety status for today, from GET /api/dashboard-tiles/hs-status."],
                ['hs_week_status', 'Same endpoint, Monday-to-Sunday range for the current week.'],
                ['allergen_lookup', 'AllergenLookup from components/menus/AllergenMatrix.jsx over GET /api/menus/:id/allergens (migration 141). Menu choice in localStorage maca_allergen_lookup_overview.'],
              ]}
            />
            <H3>API — /api/dashboard-tiles</H3>
            <P>
              Gated by <Mono>requirePermission('dashboard', 'view' | 'manage')</Mono>. Standard
              CRUD + <Mono>PATCH /reorder</Mono> follow the same shape as every other reorderable
              list in this codebase (fs_hold_stations, hs_action_categories, …).
              <Mono> POST /</Mono> rejects with 422 if the tenant already has that
              <Mono> tile_type</Mono>.
            </P>
            <H3>GET /hs-status — the combined status computation</H3>
            <P>
              Query params: <Mono>from</Mono>, <Mono>to</Mono> (both YYYY-MM-DD), optional
              <Mono> today</Mono> (client-supplied "today" — the server never assumes its own
              timezone matches the viewer's). For each date in range and each active venue, sums:
            </P>
            <DataTable
              head={['Component', 'Expected', 'Completed']}
              rows={[
                ['Checklists', 'Count of active checklist_templates for the venue (every template counts every day — see the Checklists section on why due_day is advisory, not filtering).', "Templates whose current period's checklist_instances.status = 'completed' (period computed via the same periodStartFor() used by checklists.js — factored into utils/checklistPeriod.js so the two can never drift)."],
                ['Equipment temp checks', '(active fs_equipment) × (active fs_capture_times) for the venue.', 'Distinct (equipment_id, capture_time_id) pairs logged in fs_temp_logs for that date (capture_time_id IS NOT NULL only — ad-hoc logs don\'t count toward a slot).'],
                ['Hold checks', 'Same pattern with fs_hold_stations × fs_hold_capture_times.', 'Same pattern against fs_hold_checks.'],
                ['Cooking checks', 'SUM(required_items_count) across active fs_cooking_sessions.', 'Per session, MIN(checks logged for that session+date, required_items_count), summed.'],
              ]}
            />
            <P>
              <Mono>unresolved</Mono> is computed separately: any row in fs_temp_logs /
              fs_hold_checks / fs_cooking_checks for that date with
              <Mono> is_within_range = false AND corrective_action IS NULL</Mono> — the exact same
              predicate <Mono>EndOfDayReview</Mono> already uses client-side. Deliveries are logged
              ad hoc (no schedule, so no "expected count"), so they never count toward
              expected/completed — but a <Mono>fs_delivery_checks</Mono> row for that date that
              failed any check (<Mono>NOT (packaging_ok AND damage_ok AND quality_ok AND temp_ok AND
              accepted)</Mono>) with <Mono>corrective_action IS NULL</Mono> does count toward{' '}
              <Mono>unresolved</Mono>, so a rejected delivery nobody dealt with turns the day red.
            </P>
            <P>
              Each venue result also carries a per-check-type breakdown, used by the{' '}
              <Mono>hs_today_status</Mono> tile's expanded list (not by <Mono>hs_week_status</Mono>,
              which only shows the day's overall dot): <Mono>checklists: [{'{'}id, name, frequency,
              completed{'}'}]</Mono> — one entry per active template, checklists don't have an{' '}
              <Mono>unresolved</Mono> concept so it's a plain done/not-done boolean — and{' '}
              <Mono>categories: [{'{'}key, label, expected, completed, unresolved, status{'}'}]</Mono>{' '}
              — one aggregate entry each for equipment/hold/cooking, included only when that
              category has <Mono>expected &gt; 0</Mono> for the venue (skips clutter for check
              types the venue hasn't configured). A fourth <Mono>delivery</Mono> category appears
              only when at least one delivery was logged that day; its expected/completed both equal
              the number logged, it carries a <Mono>summary</Mono> string ("3 logged · 1 issue")
              that the tile shows instead of the usual <Mono>completed/expected</Mono> fraction, and
              its status is simply red (any unresolved) or green.
            </P>
            <H3>Status derivation</H3>
            <DataTable
              head={['Status', 'Condition']}
              rows={[
                ['red', 'unresolved > 0 (checked first — an outstanding food-safety issue always outranks the completion count), OR expected > 0 and completed === 0.'],
                ['amber', '0 < completed < expected, no unresolved issues.'],
                ['green', 'completed >= expected, expected > 0, no unresolved issues.'],
                ['grey', 'expected === 0 (nothing configured/due that day).'],
                ['upcoming', "date > today, overriding every other branch — standing configuration (equipment, sessions, etc.) doesn't vary by date, so a future date would otherwise compute a real (and misleadingly red) expected/completed pair."],
              ]}
            />
            <InfoBox type="warn">
              postgres.js deserialises <Mono>date</Mono> columns to JS <Mono>Date</Mono> objects,
              not strings. The <Mono>checklist_instances.period_start</Mono> query MUST cast to
              <Mono> ::text</Mono> (matching the existing <Mono>log_date::text</Mono> /
              <Mono> check_date::text</Mono> casts on the food-safety queries) or the
              <Mono>{' `${template_id}|${period_start}`'}</Mono> map-key lookup silently never matches
              — a weekly/monthly checklist marked complete would never show as complete in this
              aggregation. Caught by a direct test against a disposable Postgres before shipping;
              see <Mono>api/src/routes/dashboardTiles.js</Mono>.
            </InfoBox>
            <H3>Responsive layout</H3>
            <P>
              The tile grid is <Mono>grid-cols-1 sm:grid-cols-2 lg:grid-cols-4</Mono> — it only
              actually has 4 columns at the <Mono>lg</Mono> breakpoint. Each tile's stored{' '}
              <Mono>col_span</Mono> (1-4 "quarters") maps through a <Mono>SPAN_CLASSES</Mono>{' '}
              lookup on <Mono>TileCard</Mono> (<Mono>{"{1: 'col-span-1', 2: 'col-span-1 sm:col-span-2', 3: '... lg:col-span-3', 4: '... lg:col-span-4'}"}</Mono>)
              instead of a raw <Mono>{"style={{ gridColumn: `span ${colSpan}` }}"}</Mono>, so a
              tile configured 4-wide degrades to full-width on a 1- or 2-column grid rather than
              overflowing it. The page header also reserves{' '}
              <Mono>max-lg:notouch:pl-14</Mono> so its title doesn't sit under{' '}
              <Mono>AppShell</Mono>'s floating hamburger button. See "Hamburger placement" in the
              Admin portal layout notes for the general pattern every new page header under{' '}
              <Mono>AppShell</Mono> should follow.
            </P>
            <H3>Hamburger placement (AppShell)</H3>
            <P>
              The collapsed-sidebar menu button behaves differently on touch and non-touch
              devices, matching <Mono>AppShell</Mono>'s <Mono>IS_TOUCH</Mono> check{' '}
              (<Mono>navigator.maxTouchPoints &gt; 0</Mono>):
            </P>
            <ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground mb-3">
              <li><strong>Touch devices (any width):</strong> the button sits in a{' '}
              <Mono>w-14</Mono> in-flow rail at the left edge of the shell, centred in an{' '}
              <Mono>h-14</Mono> cell so it lines up with the standard <Mono>h-14</Mono> page
              headers. Page content starts to the right of the rail, so no page needs to reserve
              space for the button. The sidebar itself still opens as a <Mono>fixed</Mono>{' '}
              overlay with a backdrop.</li>
              <li><strong>Non-touch devices below <Mono>lg</Mono>:</strong> a floating{' '}
              <Mono>fixed top-2.5 left-3.5 z-40</Mono> button. Page headers reserve room for it
              with <Mono>max-lg:notouch:pl-14</Mono>.</li>
              <li><strong>Non-touch devices at <Mono>lg</Mono> and up:</strong> the{' '}
              <Mono>w-14</Mono> icon-rail sidebar. There's no floating button.</li>
            </ul>
            <P>
              <Mono>notouch:</Mono> is a custom Tailwind variant (<Mono>tailwind.config.js</Mono>,{' '}
              <Mono>{":root:not([data-touch]) &"}</Mono>). <Mono>main.jsx</Mono> sets{' '}
              <Mono>{'<html data-touch>'}</Mono> before first render using the same{' '}
              <Mono>maxTouchPoints</Mono> test. Its selector specificity also beats a header's own
              responsive padding such as <Mono>sm:px-6</Mono>. The old <Mono>pl-14 lg:pl-6</Mono>{' '}
              on the Overview lost to <Mono>sm:px-6</Mono>, which is why "Overview" sat under the
              button.
            </P>
          </section>

          {/* ── PURCHASING ──────────────────────────────── */}
          <section id="purchasing" data-doc="">
            <H2>Purchasing</H2>
            <P>
              Ordering from suppliers (migration 153), replacing order sheets (their tables and data were
              dropped: pre-prod, start fresh). Modelled on the COGS tool's inventory: an item never stores a
              cost; what it costs comes from its supplier quotes. Three API files, every query filtering{' '}
              <Mono>tenant_id</Mono> itself: <Mono>routes/inventory.js</Mono> (<Mono>/api/inventory</Mono>:
              categories, items, quotes, venue prices, preferred quotes, price history, import),{' '}
              <Mono>routes/suppliers.js</Mono> (<Mono>/api/suppliers</Mono>) and{' '}
              <Mono>routes/purchasing.js</Mono> (<Mono>/api/purchasing</Mono>: lists, orders, purchase
              orders, receiving). Shared logic in <Mono>services/purchasingSvc.js</Mono>; the pack maths,
              quote choice, totals and delivery dates in <Mono>shared/procurement.js</Mono>, used by the API
              and the admin alike.
            </P>
            <DataTable
              head={['Table', 'What it holds']}
              rows={[
                ['inv_categories', 'Tenant-wide, reorderable. 12 defaults (migration 153 for existing tenants, seedInventoryCategories() for new ones).'],
                ['inv_items', 'name, category, base_unit (g | ml | each), storage (ambient | chilled | frozen), code, notes, is_active. No price.'],
                ['suppliers', 'Contact, email + cc_emails, account_ref, send_method (email | print | excel | pdf), email_attachment (none | pdf | excel), cutoff_time, lead_days, delivery_days int[] (0 = Sunday), min_order, delivery_charge.'],
                ['supplier_venues', 'Per-venue account_ref, delivery_days, cutoff_time; null = the supplier\'s own.'],
                ['inv_quotes', 'An item as one supplier sells it: supplier_code, product_name (the supplier\'s own name or brand, migration 197; copied onto PO lines and printed on the supplier\'s copy), pack_name, pack_count x pack_qty pack_unit, pack_base_qty (base units per pack, computed by packBaseQty()), price per pack ex VAT, vat_rate, min_qty, order_multiple, is_active. Several per supplier allowed (two brands = two quotes).'],
                ['inv_quote_venue_prices', 'A venue\'s own price for a quote.'],
                ['inv_price_history', 'Every price a quote had (venue_id null = company price), source manual | import | invoice; po_id for a change made from a delivery\'s invoice (migration 197).'],
                ['inv_preferred', 'Chosen quote per item: venue_id null = company default, else per venue. Partial unique indexes.'],
                ['order_lists / order_list_venues / order_list_items / order_list_pars', 'Mixed-supplier lists, the venues on each, items in order, par per venue in BASE units (so a pack change keeps it).'],
                ['supply_orders / supply_order_lines', 'A venue filling in a list: draft, requested (waiting for approval, migration 180) or submitted. requested_by / requested_at, requested_lines ({ item_id: { qty, quote_id } }: what was asked for), supplier_options ({ supplier_id: { delivery_date, notes } } wanted), returned_by / returned_at / return_note (last sent back), split_from. Lines keep qty in packs of quote_id (null = the resolved choice).'],
                ['purchase_orders', 'One per supplier per submitted order. number (per tenant, PO-00012), status to_send | sent | received | cancelled, delivery_date, totals, sent_at/by/via/to, send_error, received_at/by, is_generated; requested_by (who asked, when it went through approval), amended_at / amended_by (changed after sending: a split), split_from (migration 180).'],
                ['purchase_order_lines', 'Copies of name, category, storage, product_name, pack label, pack_base_qty, price, VAT at ordering time; qty; received_qty, receive_status, receive_note. Migration 197: invoice_id, invoice_name, invoice_code, invoice_pack, invoice_price (per pack ex VAT), invoice_vat_rate (what the invoice said); added_on_receipt (arrived but not ordered: qty 0, the qty CHECK allows 0 only for these); pack_spec { name, count, qty, unit } (the pack as invoiced, for adding it to the price list).'],
                ['purchase_invoices', 'An invoice read by Pepper while booking in (migration 197, forced RLS): po_id, files [{ name, url, media_type, bytes }] (storage kind invoices), supplier_name, invoice_number, invoice_date, prices_include_vat, subtotal, vat, delivery_charge, total, lines (jsonb, toInvoice() output), notes, read_by / read_at, applied_by / applied_at (set when a receive uses it).'],
                ['fs_delivery_checks.purchase_order_id', 'The H&S delivery check written by receiving (unique per PO).'],
              ]}
            />
            <H3>Which quote is ordered</H3>
            <P>
              <Mono>chooseQuote(quotes, venueId, preferred)</Mono>: the venue's preferred quote, else the
              company default, else the cheapest per base unit at that venue (<Mono>quotePrice()</Mono>: a
              venue price wins over the company price). Only active quotes of active suppliers count
              (<Mono>loadItemQuotes()</Mono>). A draft line can pin another quote (<Mono>quote_id</Mono>);
              <Mono> resolveQuotes()</Mono> does the rest.
            </P>
            <H3>Placing an order</H3>
            <P>
              <Mono>POST /orders</Mono> reuses an open draft for the same venue and list. Lines save through{' '}
              <Mono>PUT /orders/:id/lines</Mono> (autosave, changed lines only; leaving <Mono>quote_id</Mono>{' '}
              out keeps the stored one). <Mono>POST /orders/:id/submit</Mono> groups the lines with a quantity
              by their supplier, rounds each up with <Mono>fitQty()</Mono> (minimum and step), and creates one
              purchase order per supplier via <Mono>createPurchaseOrder()</Mono> (number from{' '}
              <Mono>nextPoNumber()</Mono> under an advisory lock) for the delivery date sent, else{' '}
              <Mono>nextDeliveryDate()</Mono>: at or past the cutoff counts as ordering tomorrow, then lead days,
              then the next delivery day (venue override first). The Place order window offers the next four
              delivery days as one-tap choices (<Mono>deliveryDateChoices()</Mono> in{' '}
              <Mono>shared/procurement.js</Mono>, starting from <Mono>next_delivery</Mono>) next to the date
              button for any other date from today on. After the transaction commits, suppliers
              with <Mono>send_method = email</Mono> are emailed (<Mono>emailPo()</Mono>); a failure is kept
              in <Mono>send_error</Mono> and the PO stays <Mono>to_send</Mono>. <Mono>orderLines()</Mono>{' '}
              (lines with a quantity, each with its quote, grouped by supplier) and <Mono>emailNew()</Mono>{' '}
              (email after commit) are shared by submit, request and split.
            </P>
            <H3>Approval (migration 180)</H3>
            <P>
              Module <Mono>purchasing_approve</Mono> (Purchasing approval; owner, admin and operator manage by
              default; the migration gave every role with its own Purchasing level the same level here).{' '}
              <Mono>POST /orders/:id/submit</Mono> needs it. Without it, <Mono>POST /orders/:id/request</Mono>{' '}
              (Purchasing manage, draft only) sets status <Mono>requested</Mono> with <Mono>requested_lines</Mono>,{' '}
              <Mono>supplier_options</Mono> (days must not be past) and the note (<Mono>notes</Mono>).
              A request changes only through an approver: <Mono>assertEditable()</Mono> on{' '}
              <Mono>PUT /orders/:id/lines</Mono>, <Mono>PATCH</Mono>, line and order <Mono>DELETE</Mono> (draft:
              Purchasing manage; requested: Purchasing approval). <Mono>POST /orders/:id/return</Mono>{' '}
              (approval, a reason is required) makes it a draft with <Mono>return_note</Mono>;{' '}
              <Mono>POST /orders/:id/withdraw</Mono> (the person who asked, or an approver) makes it a draft
              without one. Placing a request starts from its <Mono>supplier_options</Mono> (the body's days
              and notes win) and copies <Mono>requested_by</Mono> onto the POs. <Mono>orderActions()</Mono>{' '}
              puts <Mono>can_edit</Mono>, <Mono>can_request</Mono>, <Mono>can_place</Mono>,{' '}
              <Mono>can_return</Mono>, <Mono>can_split</Mono>, <Mono>can_withdraw</Mono>,{' '}
              <Mono>can_delete</Mono> on every order the API returns; the admin shows only those.{' '}
              <Mono>GET /orders?status=requested</Mono> lists them oldest first; <Mono>/meta</Mono> has{' '}
              <Mono>can_approve</Mono>. On POs: <Mono>PUT /pos/:id/lines</Mono>, <Mono>/cancel</Mono> and{' '}
              <Mono>/split</Mono> need approval; <Mono>PATCH /pos/:id</Mono> (date, notes),{' '}
              <Mono>/send</Mono>, <Mono>/mark-sent</Mono> and <Mono>/receive</Mono> take Purchasing or
              Purchasing approval (manage).
            </P>
            <H3>Splitting (migration 180)</H3>
            <P>
              <Mono>POST /orders/:id/split</Mono> (a request only; approval):{' '}
              <Mono>{'{ lines: [{ item_id, qty }], suppliers: { [supplier_id]: { delivery_date, notes? } } }'}</Mono>,
              a day for every supplier of a moved line, not past and not the first order's day (its{' '}
              <Mono>supplier_options</Mono> date, else <Mono>next_delivery</Mono>). Refuses moving more than a
              line holds or the whole order. The moved quantities become a new <Mono>requested</Mono> order
              (same list, notes, <Mono>requested_by</Mono> / <Mono>_at</Mono>, <Mono>split_from</Mono>); both
              orders' <Mono>requested_lines</Mono> are split the same way. <Mono>POST /pos/:id/split</Mono>{' '}
              (<Mono>to_send</Mono> or <Mono>sent</Mono>; approval): <Mono>{'{ lines: [{ id, qty }], delivery_date }'}</Mono>{' '}
              makes a new PO (new number, same supplier, supply order, notes, delivery charge,{' '}
              <Mono>requested_by</Mono>, the lines' copied prices, <Mono>split_from</Mono>) and takes the
              quantities off the original (a line moved in full is deleted); both totals are recalculated. A{' '}
              <Mono>sent</Mono> original goes back to <Mono>to_send</Mono> with <Mono>amended_at</Mono> /{' '}
              <Mono>amended_by</Mono>, and when the supplier takes email both are emailed after commit
              (<Mono>results</Mono>). <Mono>poChangeNotes()</Mono> puts "Amended ... replaces any earlier copy"
              and "Split off PO-..." on the HTML, PDF and Excel copies; <Mono>emailPo()</Mono>'s subject says
              Amended order. <Mono>GET /pos/:id</Mono> adds <Mono>delivery_choices</Mono>,{' '}
              <Mono>split_from_po</Mono> and <Mono>split_into</Mono>.
            </P>
            <H3>Sending and documents</H3>
            <P>
              <Mono>poFile(tenantId, poId, format)</Mono> renders the same document as HTML (print, through a
              hidden iframe in the admin), Excel (<Mono>xlsx</Mono> package) or PDF (<Mono>services/pdfDoc.js</Mono>,
              a small dependency-free writer with the standard Helvetica fonts). <Mono>GET /pos/:id/file?format=</Mono>.
              Emails go through the venue's provider (<Mono>venue_email_settings</Mono>,{' '}
              <Mono>emailCredentials()</Mono>); <Mono>sendEmail()</Mono> now takes <Mono>cc</Mono> and{' '}
              <Mono>attachments</Mono> for every provider (SES switches to a raw MIME message when there are
              attachments). <Mono>POST /pos/:id/mark-sent</Mono> records print / PDF / Excel / phone sends.
            </P>
            <H3>Changing an order not yet sent</H3>
            <P>
              <Mono>PUT /pos/:id/lines</Mono> (approval; <Mono>to_send</Mono> only, else 409):{' '}
              <Mono>{'{ lines: [{ id, qty }], add: [{ quote_id, qty }] }'}</Mono>. <Mono>lines</Mono> sets
              quantities (0 deletes the line). <Mono>add</Mono> takes only active prices of active suppliers
              (<Mono>loadItemQuotes()</Mono>) from the PO's own supplier (422 otherwise, also for another
              tenant's or a switched-off price) and refuses an item switched off in the inventory (422). A new
              line copies the item and the quote like <Mono>createPurchaseOrder()</Mono> does (name, category,
              storage, base unit, code, product name, pack label and base quantity,{' '}
              <Mono>quotePrice(q, venue)</Mono>, VAT) at <Mono>fitQty(qty)</Mono>, after the lines already
              there. A product already on the order (same quote, not added on receipt, after the{' '}
              <Mono>lines</Mono> changes) tops its line up to <Mono>fitQty(qty + added)</Mono> instead of
              making a second line; the same product twice in one add counts twice. An order left with no lines
              is refused (cancel it instead). Totals are recalculated; nothing is marked amended (the supplier
              hasn't had it). <Mono>GET /venues/:id/catalog?supplier_id=</Mono> lists only items that supplier
              sells (<Mono>all</Mono> is ignored with it), each with all its active quotes, so callers filter
              the quotes to the supplier.
            </P>
            <P>
              Admin: Change quantities and Add items on <Mono>PoDetail</Mono> (approvers, To send) open one edit
              mode (<Mono>editQty</Mono> per line, <Mono>added</Mono> = <Mono>{'{ item, quote, qty }'}</Mono>).
              While it is open the send buttons are hidden, and with prices the totals come from the draft
              (<Mono>orderTotals()</Mono>) with the saved total as "Before these changes".{' '}
              <Mono>AddPoItemsModal</Mono> lists one row per quote of the supplier, shows quotes already on the
              order as not pickable and toggles picks; a new line starts at <Mono>fitQty(1)</Mono>, steps by{' '}
              <Mono>order_multiple</Mono> and warns with <Mono>qtyProblem()</Mono>. Save sends{' '}
              <Mono>lines</Mono> and <Mono>add</Mono> together. Pepper's <Mono>change_purchase_order</Mono>{' '}
              searches with <Mono>supplier_id</Mono> and its card says when an add tops up a line already on
              the order. Tests: <Mono>api/test/po-add-items.test.mjs</Mono>.
            </P>
            <H3>Receiving</H3>
            <P>
              <Mono>POST /pos/:id/receive</Mono> (also on a received PO, to correct it): received quantity and
              status per line (<Mono>receiveStatusFor()</Mono> when not given), packaging / damage / quality,
              a chilled and a frozen probe reading (required when such goods arrived;{' '}
              <Mono>DELIVERY_TEMP_MAX</Mono> 8 / -15°C), accepted, corrective action. It upserts the
              venue's <Mono>fs_delivery_checks</Mono> row by <Mono>purchase_order_id</Mono>: vendor, items
              (name, qty received, pack, category, ordered, status, temp_c by storage),{' '}
              <Mono>product_temp_c</Mono> = chilled else frozen, <Mono>temp_ok</Mono>, and a notes summary, so
              the Food safety page, the H&S status tiles and the AI tools see it like any other delivery.
            </P>
            <H3>Invoices on receiving (migration 197)</H3>
            <P>
              <Mono>POST /api/ai/invoices/read</Mono> (<Mono>routes/documentRead.js</Mono>; Purchasing or
              Purchasing approval manage + <Mono>ai_assistant</Mono> view, Pepper on) takes the PO and up to 6
              photos / PDFs. <Mono>services/invoiceReadAi.js</Mono> sends them to the main model with the
              order's lines as refs <Mono>L1..</Mono> and the supplier's other active quotes as{' '}
              <Mono>C1..</Mono> (up to 300), structured output <Mono>INVOICE_SCHEMA</Mono>, through{' '}
              <Mono>askForJson()</Mono> (<Mono>services/aiJson.js</Mono>: allowance and daily share checked,
              usage counted). <Mono>toInvoice()</Mono> turns refs back into ids (a ref not on the lists is
              ignored), matches lines Pepper left unmatched by supplier code then exact name, converts prices
              to ex VAT when the invoice includes it, and gives each line <Mono>qty_packs</Mono> /{' '}
              <Mono>price_pack</Mono> in the matched pack. The files are stored and the reading saved in{' '}
              <Mono>purchase_invoices</Mono>; the response hides prices without <Mono>purchasing_setup</Mono>{' '}
              view (<Mono>invoiceView()</Mono>).
            </P>
            <P>
              The receive body gains <Mono>invoice_id</Mono>, per line <Mono>invoice_idx</Mono> (null clears the
              invoice fields) and <Mono>invoice_price</Mono> (taken only from people who see prices; otherwise
              the reading's price is used), and <Mono>add[]</Mono>: <Mono>{'{ item_id, quote_id | pack, received_qty, invoice_idx, invoice_price, status, note }'}</Mono>,
              lines with ordered qty 0 (<Mono>added_on_receipt</Mono>). An added line booked in again with 0 is
              deleted. Ordered prices and PO totals never change. The PO detail returns{' '}
              <Mono>invoices</Mono> (applied, without lines) and, for price viewers, <Mono>price_list</Mono>{' '}
              (<Mono>priceListRows()</Mono>: kind <Mono>price</Mono> = the line's quote differs from the invoice
              at this venue, <Mono>new</Mono> = no quote, <Mono>product</Mono> = a substitute whose code or name
              differs from the ordered quote's). <Mono>POST /pos/:id/price-list</Mono> (Purchasing setup manage):{' '}
              <Mono>company</Mono> sets the quote's price, <Mono>venue</Mono> the venue price,{' '}
              <Mono>add</Mono> makes a quote for the line's item (product name, code, pack from the body, else
              the invoice, else the ordered quote's pack; refused if the supplier already has it) and points
              the line at it, <Mono>usual</Mono> venue | company sets <Mono>inv_preferred</Mono>; history source{' '}
              <Mono>invoice</Mono> with <Mono>po_id</Mono>. The supplier's copy (<Mono>documentData()</Mono>)
              leaves added lines out. Admin: <Mono>components/purchasing/invoice.jsx</Mono> (InvoiceReader,
              readingToForm(), ExtrasSection, PriceListModal, InvoiceList) used by ReceiveForm and PoDetail;{' '}
              <Mono>GET /purchasing/venues/:id/catalog?all=1</Mono> also lists items without a supplier price.
              Tests: <Mono>api/test/invoice-reading.test.mjs</Mono>.
            </P>
            <H3>Permissions and prices</H3>
            <P>
              Module group <Mono>purchasing</Mono>: <Mono>purchasing</Mono> (fill in orders, send, receive;
              operators manage by default), <Mono>purchasing_approve</Mono> (place orders and change, split or
              cancel them; see Approval) and <Mono>purchasing_setup</Mono> (inventory, suppliers, order
              lists; owner/admin). Restaurant staff see prices only with <Mono>purchasing_setup</Mono> view:
              the order form, PO list and detail strip <Mono>price</Mono> and totals otherwise (
              <Mono>showPrices()</Mono>, <Mono>hideMoney()</Mono>). The PO files always carry prices: they
              are the supplier's document. <Mono>GET /purchasing/meta</Mono> tells the admin what the
              person can do.
            </P>
            <H3>Import</H3>
            <P>
              <Mono>POST /inventory/import</Mono> takes a base64 CSV or Excel file (route body limit 6 MB, up
              to 5000 rows) with the template's headings (<Mono>GET /inventory/import-template</Mono>; aliases
              in <Mono>HEADERS</Mono>). Items match by item code, else name; suppliers by name; quotes by
              supplier code, else pack name and size. Each row is checked in full before anything is written,
              so a bad row adds nothing. <Mono>dry_run</Mono> runs everything and rolls back.
            </P>
            <H3>Admin</H3>
            <DataTable
              head={['Page', 'File']}
              rows={[
                ['/inventory', 'pages/Inventory.jsx: list, item drawer (item form, supplier prices with star, venue prices, which price each venue orders, history), import, categories.'],
                ['/suppliers', 'pages/Suppliers.jsx: cards, drawer with Supplier, Ordering, Per venue, Products.'],
                ['/purchasing/lists', 'pages/OrderLists.jsx: lists (drag), venues, items grouped by category (drag within a category), pars per venue in packs.'],
                ['/purchasing, /mobile/purchasing', 'pages/Purchasing.jsx, pages/mobile/MobilePurchasing.jsx around PurchasingApp in components/purchasing/ordering.jsx (Order and Deliveries tabs, OrderForm, PoDetail, ReceiveForm; approval: RequestCard, RequestPanel, ReviewModal mode request / place, SplitRequestModal, SendBackModal, SplitPoModal, DeliveryDayPicker). View in the URL: ?order=, ?po=, ?tab=deliveries.'],
              ]}
            />
            <P>
              Shared UI in <Mono>components/purchasing/shared.jsx</Mono> (<Mono>NumInput</Mono>,{' '}
              <Mono>QtyStepper</Mono>, <Mono>DayPicker</Mono>, <Mono>DateButton</Mono>, <Mono>Drawer</Mono>,{' '}
              <Mono>printHtml()</Mono>). The test data tool's past orders are now purchase orders (see Test Data Tools).
            </P>
            <H3>Order form lines</H3>
            <P>
              Each <Mono>OrderRow</Mono> shows the item, then the pack next to the quantity (<Mono>PackLabel</Mono>:
              the quote's <Mono>pack_name</Mono> large with <Mono>pack_size</Mono> under it, both from{' '}
              <Mono>packParts()</Mono> in <Mono>shared/procurement.js</Mono> via <Mono>quoteView()</Mono>). With more
              than one quote the pack is the button that opens the supplier switch. Supplier, price per pack, the
              last order line and the last quantity column (<Mono>LastQty</Mono>, from the item's <Mono>last</Mono>{' '}
              purchase order line; another pack name under the figure when the last order was a different pack) are
              off by default and switched on with <strong>Show</strong>, stored per device in{' '}
              <Mono>maca_purchasing_show</Mono> (<Mono>{'{ supplier, price, last, last_qty }'}</Mono>). Price is
              offered only when the order has <Mono>show_prices</Mono>; supplier is left out while grouped by
              supplier. Below <Mono>sm</Mono> Par and remove move beside the item name so the pack, quantity and last
              figure stay on one line.
            </P>
          </section>

          {/* ── MENUS ─────────────────────────────────────── */}
          <section id="pos" data-doc="">
            <H2>Till (POS)</H2>
            <P>
              Migration 156. Design and decisions in <Mono>docs/POS.md</Mono>. Four parts:{' '}
              <Mono>shared/pos/</Mono> (the rules, pricing, printing and report maths, plain ESM used by the
              till, the API and the admin), <Mono>pos/</Mono> (the till app, a React PWA served on{' '}
              <Mono>pos.&lt;domain&gt;</Mono>), <Mono>routes/posApi.js</Mono> (<Mono>/pos-api</Mono>, the till's
              API, device auth) and <Mono>routes/posSetup.js</Mono> (<Mono>/api/pos</Mono>, the admin pages,
              modules <Mono>pos_setup</Mono> and <Mono>pos_reports</Mono>, group <Mono>pos</Mono>). Shared
              server code: <Mono>services/posSvc.js</Mono>. Every query filters <Mono>tenant_id</Mono> itself.
            </P>
            <H3>Checks are events</H3>
            <P>
              A check is never edited in place. The till records events (<Mono>{'{ id: ULID, venue_id, device_id, staff_id, approved_by, check_id, type, payload, client_at }'}</Mono>,
              26 check types in <Mono>CHECK_EVENTS</Mono> plus venue events <Mono>drawer.opened</Mono> and{' '}
              <Mono>day.closed</Mono>) and <Mono>applyEvent(checks, event, {'{ staffById }'})</Mono> in{' '}
              <Mono>shared/pos/checks.js</Mono> turns them into check state, refusing what the rules don't allow
              (closed check, overpayment, missing permission, line already sent, ...). The till applies its own
              events at once (optimistic) from an IndexedDB outbox; the server's sequencer
              (<Mono>shared/pos/sequencer.js</Mono>, <Mono>createSequencer(store)</Mono>) applies them again in
              arrival order under <Mono>pg_advisory_xact_lock(hashtext('pos:' || venue_id))</Mono>, gives each a
              venue sequence number, the check number / counter order number and the trading day
              (<Mono>assigned</Mono>), and stores refusals in <Mono>pos_event_rejections</Mono> (Till reports,
              Refused changes). The same sequencer will run on the venue hub with a SQLite store: only the
              store object differs.
            </P>
            <DataTable
              head={['Table', 'What it holds']}
              rows={[
                ['pos_events', 'Every accepted event (id ULID text, seq per venue, assigned jsonb). The source of truth.'],
                ['pos_event_rejections', 'Refused events with error + code; resolved_at / by / resolution from Till reports.'],
                ['pos_checks', 'Projection: state jsonb (the whole check) plus number, number_code (the opening device\'s short code, migration 217: the check is T2-47), order_no, status, table, server, totals, day_id for queries.'],
                ['pos_check_lines / pos_payments', 'Projections for reporting (payments kind payment | refund).'],
                ['pos_days', 'Trading days: business_date (from day_starts_at), z_number, figures jsonb at Z, declared_cash, recon_filled_at / recon_error. One open per venue.'],
                ['pos_venue_state', 'last_seq, next_z_number, device_numbers jsonb { device_id: { date, check, order } } (each till\'s or kiosk\'s highest numbers per trading day, migration 217; next_check_no / next_order_no dropped).'],
                ['pos_print_jobs', 'Print queue (ops jsonb from tickets.js), status queued | printing | printed | failed, for the hub.'],
                ['pos_devices', 'Tills, kitchen screens, kiosks and venue hubs: kind terminal | kds | kiosk | hub, short_code, secret_hash, pairing_code_hash + pairing_expires_at (only the move hand-over code of POST /pos-api/move), settings jsonb (mode, revenue_stream_id, receipt_printer_id, floor_area_id, order_numbers { from, to } for tills and kiosks (migration 217), receipt_mode venue | ask | always | never (224) and order_prompt venue | one | two (226) for tills; a hub\'s auto_update), pending_changes + pending_at (changes the device says it hasn\'t sent, X-Pos-Pending), revoked_at; a hub\'s info + info_at (what it says about itself) and update_requested_at (migration 195).'],
                ['pos_settings', 'Per venue: pin_salt, day_starts_at, receipt texts, tenders jsonb, tips, require_covers, auto_logout_secs, recon_map, recon_auto_fill, approvals jsonb and receipt_mode ask | always | never (224), order_prompt one | two (226: how the till asks a new order\'s type, name and tent number). (Migration 170 dropped the VAT defaults and counter_revenue_centre_id.)'],
                ['pos_revenue_streams', 'Migration 170 (was pos_revenue_centres): name, menu_ids, colour, sort_order, is_active, default_order_type_id (its single service charge went to the order types\' charges, migration 225). Which order types it offers and what each asks for: pos_stream_order_types (stream_id, order_type_id, enabled, ask_name / ask_tent off | ask | required; no row = off). See Tax, Order Types & Streams.'],
                ['order_types.charges', 'Migration 225: jsonb array, the charges a till check of the type gets (shared/pos/charges.js): { id, name, kind percent | amount, value (percent to 50, or pence to 100000), optional, min_covers 0-100, tax_rate_id | null }, at most 6, in order. See Charges and discounts.'],
                ['pos_discounts', 'Migration 225, tenant-wide, forced RLS: the discounts the till offers by name: name, kind percent | amount, value numeric(10,2) (percent 0.01-100, or whole pence 1-100000, CHECK), scope any | check | line, needs_manager, sort_order. Reaches every rule runner as settings.discounts.'],
                ['pos_roles / pos_courses', 'Tenant-wide. Role permissions jsonb (shared/pos/permissions.js); courses with hold_by_default.'],
                ['pos_printers', 'Printers (host, port, columns, backup); connection hub | device + device_id; status / status_at from the hub (migration 191); local_id: a USB printer on the venue hub\'s computer (migration 195). pos_print_routes was dropped: kitchen tickets come from the kitchen flow.'],
                ['floor_areas', 'name, width x height in units, revenue_stream_id, decor jsonb. tables gains floor_area_id, pos_x/y/w/h, shape, rotation.'],
                ['cash_staff', 'pos_pin_hash (unique per venue), pos_role_id.'],
                ['menus', 'menu_items kind (dish | combo), kitchen_name, pos_course_id, pos_colour, combo jsonb (steps since migration 171, see Combos); menu_sections pos_course_id, pos_colour; menu_variant_groups pos_prefixes; menu_variant_options child_group_id; promotions channels text[] (online | pos).'],
              ]}
            />
            <H3>Sync</H3>
            <P>
              <Mono>POST /pos-api/events</Mono> takes up to 200 events and answers per event (accepted with
              seq + assigned, duplicate, or refused); the server forces <Mono>venue_id</Mono> and{' '}
              <Mono>device_id</Mono> from the device. <Mono>GET /pos-api/sync?since=seq</Mono> returns newer events
              and the checks they touched (<Mono>reset: true</Mono> with every open check when the till is too far
              behind). Tills join the WebSocket room <Mono>pos:&lt;venueId&gt;</Mono>
              (<Mono>/ws?pos_device=&amp;secret=</Mono>) for <Mono>pos.seq</Mono>, <Mono>pos.config</Mono>{' '}
              (download config again), <Mono>pos.presence</Mono> and <Mono>pos.revoked</Mono>, and poll every
              4 s without the socket (30 s with it). Derived state on the till = confirmed state from the server
              + the outbox replayed on top; a refused outbox event is dropped with a toast.
            </P>
            <H3>Pulling the config, prices and sold out</H3>
            <P>
              Pushes bring changes at once, but devices never depend on them: <Mono>pos/src/lib/livePull.js</Mono>{' '}
              sets the timers the till, kiosk and kitchen screen stores use (<Mono>createPullTimers()</Mono>). The
              whole config every <Mono>pull.content</Mono> seconds (standard 3 minutes;{' '}
              <Mono>GET /pos-api/config?version=</Mono>, answered <Mono>unchanged</Mono> when nothing changed), and
              on a till or kiosk prices and sold out every <Mono>pull.live</Mono> (standard 30 s, 0 = off;{' '}
              <Mono>GET /pos-api/live</Mono> → <Mono>{'{ sold_out, prices }'}</Mono>, tills and kiosks only, 403
              code <Mono>kind</Mono> otherwise). The times are the location's (migration 216, below). <Mono>liveFields()</Mono> in{' '}
              <Mono>services/posSvc.js</Mono> works both out: the venue's <Mono>soldOutRows()</Mono>, and{' '}
              <Mono>prices</Mono>, an md5 stamp over the tenant's live menu release ids (a scheduled publish
              changes it the moment it goes live, with no write), every option group and option row, every
              promotion row and the venue's local date. <Mono>tillConfig()</Mono> and <Mono>kioskConfig()</Mono>{' '}
              compute <Mono>version</Mono> before adding them, and every till or kiosk reply carries them (an
              unchanged one too: <Mono>{'{ unchanged, version, sold_out, prices }'}</Mono>). On the device,{' '}
              <Mono>withLive()</Mono> lays a reply's sold out list (and an unchanged reply's stamp) over the saved
              config and writes it to IndexedDB; <Mono>pricesChanged()</Mono> on a <Mono>/live</Mono> reply means
              fetch the config, whose reply brings the new stamp. A stamp change for another venue's menu costs one
              unchanged config reply. <Mono>keepStorage()</Mono> asks for persistent storage
              (<Mono>navigator.storage.persist()</Mono>) at boot. The till's settings and the kiosk's staff panel
              show when each last ran (<Mono>state.checked</Mono> {'{ content, live }'}).
            </P>
            <H3>Device updates (pull times, migration 216)</H3>
            <P>
              <Mono>pos_settings.pull_content_secs</Mono> (60-3600, standard 180), <Mono>pull_live_secs</Mono>{' '}
              (0 or 10-600, 30), <Mono>pull_screen_secs</Mono> (30-3600, 60) and <Mono>pull_board_secs</Mono>{' '}
              (5-300, 15), CHECK constraints in the migration. <Mono>shared/pos/pullTimes.js</Mono> is the one rule:{' '}
              <Mono>PULL_TIMES</Mono> (key, column, label, limits, which may be off), <Mono>pullTimes(row)</Mono>{' '}
              (from columns or keys, defaults, clamped), <Mono>pullMs()</Mono> (device waits, live off = null),{' '}
              <Mono>PULL_PRESETS</Mono> / <Mono>presetOf()</Mono>, <Mono>asksPerHour()</Mono>,{' '}
              <Mono>pullText()</Mono>. <Mono>settingsView()</Mono> returns <Mono>pull</Mono>;{' '}
              <Mono>PATCH /api/pos/venues/:id/settings</Mono> takes <Mono>pull</Mono> (only the keys sent change;
              Zod refuses out-of-range values) and broadcasts <Mono>pos.config</Mono> and, for menu screens,{' '}
              <Mono>screens.changed</Mono> to <Mono>screens:&lt;venue&gt;</Mono>.{' '}
              <Mono>POST /api/pos/pull-times/everywhere</Mono> (pos_setup manage) writes the times to every venue
              of the tenant (<Mono>ensureSettings()</Mono> first) and tells each. Every device config carries{' '}
              <Mono>pull</Mono>: <Mono>tillConfig()</Mono>, <Mono>kioskConfig()</Mono>, <Mono>kdsConfig()</Mono>{' '}
              (all four) and <Mono>screenConfig()</Mono> (<Mono>{'{ screen, board }'}</Mono>, from a LEFT JOIN on
              the screen's venue's pos_settings, defaults without a row); a change changes the config's version, so
              devices download it. <Mono>createPullTimers(getConfig, tasks)</Mono> runs each task, then waits as
              long as the current config says (read every time; an off pull is looked at again every 60 s);{' '}
              <Mono>check()</Mono>, called by each store after a new config, restarts the timers when the times
              differ from the ones they were set with. The player (<Mono>screen/player.js</Mono>) has its own copy
              of the two limits (<Mono>pullEvery()</Mono>, <Mono>setPullTimers()</Mono> from{' '}
              <Mono>applyConfig()</Mono>). Admin: <Mono>components/pos/DeviceUpdatesSection.jsx</Mono> (Store tech →
              Device updates, <Mono>/pos/updates</Mono>; nav link added by the migration after Card machines):
              presets, a row of times per pull, the asks-an-hour estimate from <Mono>setup.devices</Mono> (and the
              Screens list when the person may see it), Save, Use these at every location with a confirm. The
              till's settings (<Mono>till-pull</Mono>), the kiosk's staff panel (<Mono>k-staff-pull</Mono>) and
              the player's settings panel show the times. Tests: <Mono>shared/pos/test/pullTimes.test.mjs</Mono>,
              the last test in <Mono>api/test/live-pull.test.mjs</Mono>.
            </P>
            <H3>Devices, PINs and permissions</H3>
            <P>
              A till is a linked device, not an Auth0 user: the device shows a code of its own
              (<Mono>POST /pos-api/pairings</Mono>, see Installer app &amp; link codes), someone signed in links it
              with <Mono>POST /api/pos/venues/:id/link</Mono> (Store tech or the installer, the only way a device
              is added), the device keeps the secret it was given with its code, and every call sends <Mono>Authorization: Device &lt;id&gt;.&lt;secret&gt;</Mono> (device rows
              cached 30 s; revoking or switching the module off stops it). People sign in on the till with a PIN:
              <Mono> hashPin()</Mono> (<Mono>shared/pos/pin.js</Mono>, PBKDF2-SHA256, 60000 rounds, the venue's
              salt, so the PIN alone finds the person) is checked on the till, offline. Events carry the person's
              staff id; anything their role lacks needs <Mono>approved_by</Mono> (someone with{' '}
              <Mono>manager</Mono> typed their PIN), checked by <Mono>permissionProblem()</Mono> on both sides.
            </P>
            <P>
              A till learns of a new or changed PIN from its config. Setup changes push <Mono>pos.config</Mono>{' '}
              (cross-process through the Redis relay in <Mono>config/ws.js</Mono>); on top of that,{' '}
              <Mono>staffForPin(pin, &#123; final &#125;)</Mono> in <Mono>pos/src/lib/store.js</Mono> fetches the config
              when a typed PIN matches nobody and looks again, so a PIN set a moment ago works even if the push was
              missed: one request at a time (tries while it is out wait for it), a quiet try (<Mono>PinPad</Mono> tries
              at 4 and 5 digits without a word) at most every <Mono>PIN_REFRESH_GAP_MS</Mono> (1.5 s), a final one (OK,
              or 6 digits) always. <Mono>PinPad</Mono> shows "Checking" and "PIN not recognised" only for final tries,
              and its <Mono>Keypad</Mono> is a <Mono>code</Mono> keypad: every digit stays as typed (a number keypad
              drops a lone leading 0, so a PIN like 0482 used to arrive as 482 and never match). WebCrypto only exists
              on https:// (and localhost): <Mono>hashPin()</Mono> throws a clear message without it, <Mono>PinPad</Mono>{' '}
              shows any error instead of hanging on "Checking", and <Mono>routes/posSite.js</Mono> sends the pos host
              from http:// (X-Forwarded-Proto) to https://.
            </P>
            <P>
              Saving a PIN (<Mono>PUT /api/pos/venues/:id/staff/:staffId/pos</Mono>) refuses a weak one
              (<Mono>weakPin()</Mono>), one someone else at the venue has, and one that overlaps someone else&apos;s:{' '}
              <Mono>pinOverlaps(pin)</Mono> lists its shorter starts (from 4 digits) and every longer PIN starting with
              it (to 6 digits: 110 for a 4-digit PIN), and the route compares their hashes with the venue&apos;s, 422
              when one matches. The till signs in as soon as the digits typed match someone, so 1234 beside 123456 would
              sign the second person in as the first. A person&apos;s own old PIN never blocks their new one. Each
              candidate is a PBKDF2 hash (60,000 rounds), so saving a 4-digit PIN costs 110 hashes, about a third of a
              second on four cores (5 digits 11, 6 digits 2). PINs saved before this check aren&apos;t looked at again
              until one of them is changed. Tests:{' '}
              <Mono>shared/pos/test/pin.test.mjs</Mono>, <Mono>api/test/till-pins.test.mjs</Mono>.
            </P>
            <H3>Manager switches, Cancel order and the receipt choice (migration 224)</H3>
            <P>
              <Mono>pos_settings.approvals</Mono> (jsonb, one boolean per key of <Mono>MANAGER_ACTIONS</Mono> in{' '}
              <Mono>shared/pos/permissions.js</Mono>: <Mono>delete_unsent</Mono>, <Mono>void_sent</Mono>,{' '}
              <Mono>cancel_order</Mono>, <Mono>refund</Mono>; <Mono>normaliseApprovals()</Mono> fills the rest with
              false) are the venue&apos;s "needs a manager every time" switches. <Mono>managerProblem(staffById, event,
              action, settings)</Mono> is the one rule: off = no problem; on = the person or the event&apos;s{' '}
              <Mono>approved_by</Mono> must have <Mono>manager</Mono> plus the action&apos;s own permission (void, refund).
              <Mono> applyEvent()</Mono> now takes <Mono>ctx.settings</Mono> beside <Mono>staffById</Mono> and checks it
              on <Mono>line.changed</Mono> (a lower qty), <Mono>line.deleted</Mono> (not when <Mono>replaced_by</Mono>{' '}
              names a new line on the check: Make it a combo), <Mono>line.voided</Mono>, <Mono>refund.added</Mono> and the
              cancel; refusal code <Mono>manager</Mono>. Every place that applies events passes the venue&apos;s settings:
              the till store (<Mono>state.config.settings</Mono>), the cloud sequencer (<Mono>settingsView()</Mono> in its
              context) and the venue hub&apos;s mirror (<Mono>sequencerContext()</Mono>). On the till,{' '}
              <Mono>can(key, amount, actions)</Mono> / <Mono>approverFor(pin, key, amount, actions)</Mono> in{' '}
              <Mono>pos/src/lib/store.js</Mono> and <Mono>useApproval()(key, amount, label, actions)</Mono> in{' '}
              <Mono>components/ui.jsx</Mono> take the actions an event falls under, so the PIN pad shows before the
              sequencer would refuse.
            </P>
            <P>
              <strong>Cancel order</strong> (<Mono>CancelOrderModal</Mono> in <Mono>CheckActions.jsx</Mono>) is one{' '}
              <Mono>dispatchMany()</Mono> batch: <Mono>line.voided</Mono> for every sent line and{' '}
              <Mono>line.deleted</Mono> for every new one, both with <Mono>cancel: true</Mono>, then{' '}
              <Mono>check.closed &#123; cancel_reason &#125;</Mono>. The close is refused while an active line is left
              (<Mono>items</Mono>) or a payment is on (<Mono>paid</Mono>), and from kiosks; it sets status{' '}
              <Mono>void</Mono> and <Mono>c.cancelled = &#123; reason, value, by, approved_by, at, day_id &#125;</Mono>, where{' '}
              <Mono>value</Mono> is the gross of the lines the cancel took off (summed on the check as{' '}
              <Mono>c.cancelling</Mono> by the flagged void / delete events), so a line voided earlier for another reason
              isn&apos;t counted. <Mono>check.reopened</Mono> clears both. <Mono>dayFigures()</Mono> lists them as{' '}
              <Mono>cancelled</Mono> (<Mono>value</Mono> falls back to the lines left on the check for any without one);
              Till reports shows a Cancelled orders card, the Checks list marks them (<Mono>cancel_reason</Mono> from{' '}
              <Mono>state</Mono> in <Mono>GET /api/pos/venues/:id/checks</Mono>) and the history says "Order cancelled".
            </P>
            <P>
              <strong>Receipts</strong>: <Mono>pos_settings.receipt_mode</Mono> (<Mono>ask</Mono> default,{' '}
              <Mono>always</Mono>, <Mono>never</Mono>, CHECK) and a till&apos;s own{' '}
              <Mono>pos_devices.settings.receipt_mode</Mono> (<Mono>venue</Mono> = follow it); <Mono>receiptModeOf(config)</Mono>{' '}
              in <Mono>pos/src/lib/checkOps.js</Mono> decides. <Mono>PayModal</Mono> closes a paid-off check at once with{' '}
              <Mono>print_receipt</Mono> set unless it is <Mono>ask</Mono>. <Mono>Exact cash</Mono> / <Mono>Exact card</Mono>{' '}
              pay the amount shown in one tap (card: <Mono>card_integrated</Mono> through the till&apos;s card machine when
              it has one, else <Mono>card_external</Mono>).
            </P>
            <P>
              <strong>The check list</strong> (<Mono>components/CheckPanel.jsx</Mono>): <Mono>useSwipe()</Mono> (pointer
              events on the row with <Mono>touch-action: pan-y</Mono>, window listeners, pointer capture once it is a swipe;
              past half the row it acts, past half the button it stays open; the click after a swipe is swallowed) shows
              Delete (new) or Void (sent): Delete goes through <Mono>swipeAction</Mono> in <Mono>Check.jsx</Mono> with a
              5 s toast whose Undo adds <Mono>copyOfLine()</Mono> back; Void opens <Mono>LineModal</Mono> with{' '}
              <Mono>initialMode: 'void'</Mono>. <Mono>useDrag()</Mono> (the grip, <Mono>touch-action: none</Mono>) shows
              every course (or seat) as a <Mono>data-drop</Mono> target while dragging, a floating copy, and scrolls the
              list near its edges; a drop sends <Mono>line.changed &#123; course_id &#125;</Mono> (new lines only,{' '}
              <Mono>canRegroup()</Mono>) or <Mono>&#123; seat &#125;</Mono>. At a table (<Mono>atTable()</Mono>: a{' '}
              <Mono>table_id</Mono> or mode table) <Mono>checkPrompts()</Mono> never asks for a tent number;{' '}
              <Mono>missingDetails()</Mono> and the order type window use it.
            </P>
            <H3>Charges and discounts (migration 225)</H3>
            <P>
              <strong>Charges</strong> (<Mono>shared/pos/charges.js</Mono>, one implementation for the till, the cloud&apos;s
              sequencer, the venue hub, the API and the admin) belong to the order type: <Mono>order_types.charges</Mono>,
              saved through <Mono>PATCH /api/order-types/:id</Mono> (<Mono>charges</Mono> = the whole list; left out =
              unchanged; <Mono>cleanCharges()</Mono> in <Mono>routes/taxSetup.js</Mono> gives a new charge an id, checks the
              raw values with <Mono>chargeProblem()</Mono> before <Mono>cleanTypeCharge()</Mono> (an amount is whole pence),
              refuses the same id twice and any tax rate that isn&apos;t the tenant&apos;s, 422). They reach tills with the
              order types in the config; <Mono>chargesFor(config, typeId)</Mono> (<Mono>pos/src/lib/checkOps.js</Mono>, over{' '}
              <Mono>chargesForType()</Mono>) adds each tax rate&apos;s % at the venue (<Mono>vat_rate</Mono>). The till puts
              them in <Mono>check.opened</Mono> (<Mono>charges</Mono>) and in <Mono>check.order_type_set</Mono> /{' '}
              <Mono>check.stream_set</Mono>&apos;s type change; <Mono>switchCharges(current, next, off)</Mono> keeps a charge
              taken off off (also through a round trip: <Mono>check.charges_off</Mono> remembers, by id, ones taken off that
              left with the old type) and keeps charges typed on the till. Events: <Mono>charge.added</Mono> (typed on the
              till: always optional, from 0 covers, no VAT; refused twice or over 12), <Mono>charge.removed</Mono>{' '}
              <Mono>&#123; charge_id, reason &#125;</Mono> (an optional one needs the venue&apos;s <Mono>remove_charge</Mono>{' '}
              switch&apos;s manager, one that isn&apos;t optional <Mono>MANAGER_ALWAYS</Mono>) and <Mono>charge.restored</Mono>;{' '}
              <Mono>service_charge.set</Mono> is gone. Kiosks can&apos;t send charges.
            </P>
            <P>
              <Mono>checkTotals()</Mono> gives <Mono>charges</Mono> (each with <Mono>amount</Mono>, <Mono>would_be</Mono>,{' '}
              <Mono>removed</Mono>, <Mono>waiting</Mono> for a <Mono>min_covers</Mono> not reached) and{' '}
              <Mono>service_charge</Mono>, the sum that counts (still <Mono>pos_checks.service_charge</Mono>). A percent is
              of the net after every discount and offer; an amount counts only while the check has lines; each charge&apos;s
              VAT is added to the VAT table at its own rate. <Mono>billOps()</Mono> prints each charge by{' '}
              <Mono>chargeLabel()</Mono>; <Mono>dayFigures()</Mono> lists <Mono>charges</Mono> by name (<Mono>count</Mono>,{' '}
              <Mono>amount</Mono>, <Mono>removed</Mono>, <Mono>removed_value</Mono>), printed on the Z and shown in Till
              reports. Admin: <Mono>ChargesEditor</Mono> in <Mono>components/pos/OrderTypesSection.jsx</Mono>; till:{' '}
              <Mono>ChargesModal</Mono> in <Mono>CheckActions.jsx</Mono> (More → Charges).
            </P>
            <P>
              <strong>Discounts</strong> (<Mono>shared/pos/discounts.js</Mono>): <Mono>pos_discounts</Mono>, company-wide,
              through <Mono>GET/POST /api/pos/discounts</Mono>, <Mono>PATCH/DELETE /api/pos/discounts/:id</Mono>,{' '}
              <Mono>PUT /api/pos/discounts/order</Mono> (Store tech view / manage; at most 50). <Mono>loadDiscounts()</Mono>{' '}
              puts the list in <Mono>settings.discounts</Mono> of the till config and of <Mono>printConfig()</Mono>, so the
              sequencer and the hub (<Mono>sequencerContext()</Mono>) judge with it. A discount from the list is{' '}
              <Mono>discount.applied</Mono> with <Mono>preset_id</Mono>: the rules find it in <Mono>ctx.settings</Mono>{' '}
              (<Mono>discountList()</Mono>), refuse a changed type, value or scope (<Mono>presetMismatch()</Mono>, code{' '}
              <Mono>preset</Mono>), need no discount permission, and need a manager every time when{' '}
              <Mono>needs_manager</Mono>. A discount typed in follows the role&apos;s <Mono>discount_max_pct</Mono> and the
              venue&apos;s <Mono>custom_discount</Mono> switch. The checks keep the discount as it was (name, value). Admin:{' '}
              <Mono>components/pos/DiscountsSection.jsx</Mono> (Store tech → Discounts, <Mono>/pos/discounts</Mono>); till:
              the presets on top of <Mono>DiscountModal</Mono> (<Mono>fitsScope()</Mono> for check or items).
            </P>
            <P>
              <Mono>MANAGER_ACTIONS</Mono> gained <Mono>remove_charge</Mono> and <Mono>custom_discount</Mono>;{' '}
              <Mono>MANAGER_ALWAYS</Mono> (<Mono>'always'</Mono>) in an <Mono>actions</Mono> list asks a manager whatever the
              switches say (<Mono>approverProblem()</Mono>). Migration 225 moved a stream service charge to its tenant&apos;s
              Eat in type when every active stream charged the same, dropped{' '}
              <Mono>pos_revenue_streams.service_charge_percent</Mono> / <Mono>_min_covers</Mono> and{' '}
              <Mono>pos_settings.service_charge_label</Mono>, and added the Discounts menu link after Order types. Tests:{' '}
              <Mono>shared/pos/test/charges.test.mjs</Mono>, <Mono>api/test/till-charges.test.mjs</Mono>.
            </P>
            <H3>The order prompt (migration 226)</H3>
            <P>
              <Mono>pos/src/components/OrderPrompt.jsx</Mono> is the one place the till asks for a check&apos;s order type,
              customer name and tent number. It covers the screen (<Mono>fixed inset-0 z-50</Mono>) and brings its own keys:{' '}
              <Mono>Keyboard</Mono> in <Mono>components/ui.jsx</Mono> (letters, digits, Shift once, &apos; and -, Space,
              Clear, Delete; a capital at the start and after a space, hyphen or apostrophe, Shift turning that round for
              one letter) for the name and the big <Mono>Keypad</Mono> (6 digits) for the tent number. The inputs are{' '}
              <Mono>inputMode=&quot;none&quot;</Mono> (no tablet keyboard) but keep the DOM focus, so a keyboard plugged in
              types there too (Enter: the next empty field, else Done); the keys&apos; wrapper cancels{' '}
              <Mono>mousedown</Mono> so tapping a key never takes the focus. Props: <Mono>types</Mono> (the stream&apos;s{' '}
              <Mono>streamTypes()</Mono>), <Mono>promptsOf(typeId)</Mono> (off | ask | required per field, usually{' '}
              <Mono>promptsFor()</Mono>), <Mono>style</Mono>, <Mono>start</Mono> (<Mono>details</Mono> skips step 1),{' '}
              <Mono>onDone(&#123; typeId, name, tent &#125;)</Mono> (a field the type doesn&apos;t ask keeps the value it came
              with), <Mono>noteFor</Mono>. The field the keys type into is state picked when the type is picked (its first
              empty field) or a field is tapped, never moved by typing; the style is frozen when the prompt opens, so a
              setting pushed meanwhile can&apos;t change the screen under the person&apos;s finger. Tapping a type that asks
              for nothing calls <Mono>onDone</Mono> straight away; with nothing to choose or ask it never shows.
            </P>
            <P>
              <Mono>pos_settings.order_prompt</Mono> (<Mono>one</Mono> default | <Mono>two</Mono>, CHECK) and a till&apos;s
              own <Mono>pos_devices.settings.order_prompt</Mono> (<Mono>venue</Mono> | <Mono>one</Mono> | <Mono>two</Mono>,
              Zod in <Mono>routes/posSetup.js</Mono>); <Mono>orderPromptOf(config)</Mono> in{' '}
              <Mono>pos/src/lib/checkOps.js</Mono> decides. One screen shows the types as a row above the fields; two steps
              shows big type buttons first, then the fields with Back. Callers: <Mono>screens/Counter.jsx</Mono> (New order,
              or the first dish when <Mono>newOrderAsks()</Mono>: more than one type, or the only type asks something; the
              answers wait on the left with Change / clear until a dish opens the check), <Mono>NewTabModal</Mono> in{' '}
              <Mono>screens/Floor.jsx</Mono> (the name is at least <Mono>ask</Mono>: it is how a tab is found),{' '}
              <Mono>OrderTypeModal</Mono> / <Mono>NameModal</Mono> in <Mono>components/CheckActions.jsx</Mono> (More → Order
              type, Tent number, Name; the events and the re-rating are unchanged) and <Mono>Check.jsx</Mono>&apos;s missing
              details at Send / Pay (<Mono>start: &apos;details&apos;</Mono>). Tests:{' '}
              <Mono>api/test/till-order-prompt.test.mjs</Mono>.
            </P>
            <H3>Till layouts (migration 228)</H3>
            <P>
              <Mono>shared/pos/tillLayout.js</Mono> is the one set of rules for the till, the designer and the API. A
              layout is <Mono>&#123; cols, rows, zones &#125;</Mono> (4-24 x 3-16 cells, 12 x 8 at first); each zone is{' '}
              <Mono>&#123; id, type, x, y, w, h &#125;</Mono> on that grid. The zones with buttons (<Mono>GRID_ZONES</Mono>:
              categories, items, buttons, modifiers) add their own <Mono>cols</Mono> x <Mono>rows</Mono> (1-12),{' '}
              <Mono>font</Mono> (12-36 px), <Mono>bold</Mono> and <Mono>overflow</Mono> (<Mono>scroll</Mono> |{' '}
              <Mono>pages</Mono> | <Mono>more</Mono> | <Mono>hide</Mono>). Categories carry <Mono>sections</Mono> (ids in
              order; null = every section of the till&apos;s menus), dishes <Mono>search</Mono> and <Mono>price</Mono>,
              buttons zones <Mono>buttons</Mono> (<Mono>&#123; id, action, label, colour, w, h &#125;</Mono>, with{' '}
              <Mono>item_id</Mono>, <Mono>preset_id</Mono> or <Mono>tender</Mono> for the actions that name one;{' '}
              <Mono>BUTTON_ACTIONS</Mono>, where <Mono>check: true</Mono> means it needs an order on screen), modifiers{' '}
              <Mono>kind</Mono> (all | required | optional), <Mono>cover</Mono> (zone | screen),{' '}
              <Mono>show_name</Mono>, <Mono>show_description</Mono>, <Mono>show_prices</Mono> (default true) and{' '}
              <Mono>auto_add</Mono> (default false). The layout has <Mono>top_bar</Mono> (default true; false = the
              order screens without the till&apos;s top bar), and the Order zone <Mono>font</Mono> (12-36, 16 = the
              standard size), <Mono>hide</Mono> (keys of <Mono>CHECK_BUTTONS</Mono>: back, cancel, more, send, bill, pay,
              kept in that order) and <Mono>colours</Mono> (<Mono>&#123; cancel, more, send, bill, pay &#125;</Mono>, a
              colour code or null). Each of the Order zone&apos;s buttons has a button action that does its job
              (<Mono>CHECK_BUTTONS[].action</Mono>; Pay is also done by exact_cash, exact_card and tender), and{' '}
              <Mono>layoutWarnings()</Mono> gives <Mono>hidden_button</Mono> (with <Mono>button</Mono>) for one left out
              with no such button. Button actions <Mono>till_menu</Mono>, <Mono>sign_out</Mono> and <Mono>menus</Mono>{' '}
              (which menus show, migration 230: see Menus &gt; Menu times) work without an order.{' '}
              <Mono>normaliseTillLayout()</Mono> is the only way a layout is read (unknown zones and buttons dropped, every
              number inside its limits, repeated ids renamed). <Mono>layoutProblems()</Mono> stops a save (no Order zone,
              more zones of a type than its <Mono>max</Mono>, two Dish choices zones that don&apos;t split Must pick and
              Optional, zones other than Dish choices overlapping); <Mono>layoutWarnings()</Mono> only advises.{' '}
              <Mono>packCells(cells, zone)</Mono> places a zone&apos;s buttons (the first free place row by row; a button
              bigger than the grid is cut down) and returns <Mono>&#123; pages, rest, hidden, rows, cols &#125;</Mono>. The
              till&apos;s <Mono>ZoneGrid.jsx</Mono> and the designer&apos;s <Mono>GridPreview</Mono> both use it, so a button
              lands in the same place in both.
            </P>
            <P>
              API (<Mono>routes/tillLayouts.js</Mono>; Store tech view to read, manage to change): <Mono>GET</Mono> and{' '}
              <Mono>POST /api/pos/till-layouts</Mono> (a new one from <Mono>template</Mono> standard | quick or{' '}
              <Mono>copy_from</Mono>; 30 per company), <Mono>GET</Mono>, <Mono>PUT</Mono> and{' '}
              <Mono>DELETE /api/pos/till-layouts/:id</Mono>. <Mono>PUT</Mono> stores <Mono>ownTillLayout()</Mono>&apos;s output
              (sections, dishes and discounts that aren&apos;t the company&apos;s dropped) and answers 422 with code{' '}
              <Mono>layout</Mono> and the problems. <Mono>DELETE</Mono> takes the layout off every till that picked it and
              the foreign key puts <Mono>pos_settings.till_layout_id</Mono> back to null. Every change broadcasts{' '}
              <Mono>pos.config</Mono> to each venue of the company. Which layout a till draws:{' '}
              <Mono>pos_settings.till_layout_id</Mono> (venue settings PATCH, null = the standard screen) and a till&apos;s{' '}
              <Mono>settings.till_layout</Mono> (<Mono>venue</Mono> | <Mono>standard</Mono> | a layout id; device PATCH,
              checked to be the company&apos;s). <Mono>tillConfig()</Mono> carries the layouts in use at the venue
              (<Mono>till_layouts</Mono> by id, <Mono>venueTillLayouts()</Mono>), so a till draws its layout offline too.
            </P>
            <P>
              Till: <Mono>tillLayoutOf(config)</Mono> (<Mono>pos/src/lib/tillLayout.js</Mono>) picks the till&apos;s own,
              else the venue&apos;s, else none; a layout missing from the config or without an Order zone means the standard
              screen. <Mono>screens/Check.jsx</Mono> and <Mono>screens/Counter.jsx</Mono> then draw{' '}
              <Mono>components/LayoutScreen.jsx</Mono> instead of the check panel and <Mono>MenuPanel</Mono>, giving it the
              Order zone&apos;s content (the check panel, or the counter&apos;s New order and waiting orders), dishes to their
              usual <Mono>pick()</Mono> and every other button to <Mono>runButton()</Mono>: the same windows and{' '}
              <Mono>PayModal</Mono>, with <Mono>autoExact</Mono> for Exact cash and Exact card and{' '}
              <Mono>initialTender</Mono> for Pay by. Last receipt prints <Mono>lastReceiptCheck()</Mono> (<Mono>prefs.last_closed</Mono>,
              set as <Mono>PayModal</Mono> closes a check, else the latest check this till closed today). A dish with choices
              goes into the Dish choices zones when the layout has one (<Mono>choiceZones()</Mono>;{' '}
              <Mono>components/LayoutChoices.jsx</Mono>: <Mono>useChoiceBuilder()</Mono> with the choices window&apos;s own
              picking rules, exported from <Mono>ItemModal.jsx</Mono>, and <Mono>priceItem()</Mono>), else into the window.
              With the must-pick zone&apos;s <Mono>auto_add</Mono>, <Mono>useChoiceBuilder(item, config, initial, &#123;
              onAutoAdd &#125;)</Mono> adds the dish on a tap that picks a choice taking exactly one pick
              (<Mono>min &gt;= 1</Mono>, <Mono>max === 1</Mono>, a group or a combo step) once <Mono>priceItem()</Mono> is
              happy with the whole selection; its picks are read through a ref (<Mono>commit()</Mono>), so the tap that
              completes the dish adds what is on screen. <Mono>ChoiceZone</Mono> drops the dish&apos;s name, description
              and the choices&apos; prices by the zone&apos;s switches (a sold out choice keeps its words). With the
              layout&apos;s <Mono>top_bar</Mono> false, <Mono>Main</Mono> in <Mono>App.jsx</Mono> leaves the bar off the
              check and counter views (<Mono>hideBar</Mono>), and <Mono>TillNav</Mono> (<Mono>components/TillMenu.jsx</Mono>:
              <Mono>go</Mono>, <Mono>view</Mono>, <Mono>counterMode</Mono>, <Mono>hideBar</Mono>, <Mono>openMenu</Mono>)
              carries the till menu down: <Mono>TillMenuSection</Mono> (details, <Mono>tillPages()</Mono>, Sign out) at the
              top of More (<Mono>ActionsMenu</Mono>), <Mono>TillMenuModal</Mono> from the counter&apos;s Till menu button
              and the <Mono>till_menu</Mono> button. <Mono>Check.jsx</Mono> leaves the Order zone&apos;s hidden buttons out
              (the footer grid takes as many columns as buttons left), colours them with <Mono>fillStyle()</Mono>{' '}
              (<Mono>ui.jsx</Mono>, black or white words by <Mono>inkOn()</Mono>) and passes <Mono>font</Mono> to{' '}
              <Mono>CheckPanel</Mono>, whose line sizes are in em. No event changed: a layout only arranges the screen.
            </P>
            <P>
              Admin: <Mono>components/pos/TillLayoutsSection.jsx</Mono> (Store tech → Till layouts, <Mono>/pos/layouts</Mono>)
              and <Mono>pages/TillLayoutDesigner.jsx</Mono> (<Mono>/pos/layouts/:id</Mono>). The canvas draws each zone at the
              chosen screen&apos;s size (the till&apos;s 64 px top bar first), moves and resizes zones on whole cells (pointer
              events; a ghost committed on pointer up), previews each zone&apos;s buttons with the venue&apos;s menus,
              discounts and ways to pay (<Mono>usePosSetup()</Mono>, <Mono>/api/pos/discounts</Mono>), turns to the page of
              the button being edited, and draws the Dish choices zones as outlines (<Mono>data-outline</Mono>:
              pointer-events none, so taps reach the zone under them; their name tab <Mono>tl-zone-tab</Mono> selects and
              drags them; selected, or with <Mono>Show a dish being added</Mono>, they fill). The canvas fits the
              column&apos;s width and the window&apos;s height, and its scroller keeps <Mono>scrollbar-gutter: stable</Mono>:
              without it a scrollbar appearing narrowed the canvas, which shortened the page, which hid the scrollbar, round
              and round (the shake with some zones selected). The draft is normalised after every edit; Save sends <Mono>&#123; name, layout &#125;</Mono> and stays off while{' '}
              <Mono>layoutProblems()</Mono> finds any. The till window on Tills has the till&apos;s own choice
              (<Mono>till-layout</Mono>). Tests: <Mono>shared/pos/test/tillLayout.test.mjs</Mono>,{' '}
              <Mono>api/test/till-layouts.test.mjs</Mono>.
            </P>
            <H3>The order&apos;s allergy flag</H3>
            <P>
              <Mono>shared/pos/allergy.js</Mono> holds the rules: a check&apos;s <Mono>allergy</Mono> is{' '}
              <Mono>&#123; allergens: [&#123; code, name &#125;], diets: [&#123; code, name &#125;], note &#125;</Mono> or null,
              the codes being <Mono>menu_dietary_tags</Mono> codes and the names as the till showed them, so the kitchen,
              tickets and reports read it without the tag list (up to <Mono>ALLERGY_TAGS_MAX</Mono> 30 tags of each kind, a
              note of <Mono>ALLERGY_NOTE_MAX</Mono> 300). <Mono>allergyProblem()</Mono> checks an event&apos;s payload,{' '}
              <Mono>cleanAllergy()</Mono> tidies it (codes once each, words trimmed, null when it says nothing),{' '}
              <Mono>allergyText()</Mono> is the one line the kitchen shows (allergens, then diets, then the note, joined by
              a middle dot), <Mono>allergyPrefs()</Mono> gives the kiosk&apos;s <Mono>&#123; avoid, diet &#125;</Mono> shape
              and <Mono>mergeAllergy()</Mono> joins two flags.
            </P>
            <P>
              Event <Mono>check.allergy_set</Mono> (<Mono>&#123; allergy &#125;</Mono>, null takes it off; open checks only)
              in <Mono>shared/pos/checks.js</Mono> stores <Mono>cleanAllergy(p.allergy)</Mono> on the check (in{' '}
              <Mono>pos_checks.state</Mono>, no column). <Mono>lines.moved</Mono> and <Mono>check.merged</Mono> merge the
              flag into the check that gets the dishes. The kitchen: <Mono>check.allergy_set</Mono> is in{' '}
              <Mono>KITCHEN_CHECK_EVENTS</Mono>; <Mono>headerFromCheck()</Mono> puts <Mono>allergyText()</Mono> in the kitchen
              order&apos;s <Mono>allergy</Mono> (the field online orders&apos; allergy note already used), and{' '}
              <Mono>refreshHeader()</Mono> follows changes, so kitchen screens show it in red at the top of the ticket
              (<Mono>kds-allergy</Mono>). Printing (<Mono>shared/pos/kitchenPrint.js</Mono>): a kitchen ticket carries it as
              an <Mono>ALLERGY</Mono> line above the dishes (<Mono>kitchenTicket()</Mono>, inside the required items part so
              no print design can leave it out), each printer box remembers what it printed in{' '}
              <Mono>o.allergy_printed[stationId]</Mono>, and a later change prints a job of kind <Mono>allergy</Mono> (ALLERGY
              UPDATE, the flag or ALLERGY FLAG TAKEN OFF) to the printers that already printed the order.
            </P>
            <P>
              Till: <Mono>pos/src/components/AllergyModal.jsx</Mono> (chips from <Mono>config.dietary_tags</Mono>: allergens
              and the other kinds as diets; a tag the flag holds that the menu no longer lists stays; a note; the dishes that
              clash as you pick; Take the flag off asks first), opened from More (<Mono>action-allergy</Mono> in{' '}
              <Mono>ActionsMenu</Mono>), the bar on the check (<Mono>check-allergy</Mono>, <Mono>onAllergy</Mono> on{' '}
              <Mono>CheckPanel</Mono>) and the till layout button action <Mono>allergy</Mono> (<Mono>check: true</Mono>,{' '}
              <Mono>runButton()</Mono> in <Mono>Check.jsx</Mono>). <Mono>pos/src/lib/allergyFit.js</Mono>:{' '}
              <Mono>lineClash(config, line, allergy)</Mono> reads a line&apos;s dish and its meal deal parts with the
              kiosk&apos;s <Mono>dishLevels()</Mono> / <Mono>mergeLevels()</Mono> (<Mono>shared/kiosk.js</Mono>): an allergen at
              contains or may contain clashes, removable is &quot;can be left out: ask&quot;, a diet is missing unless the dish
              (or the deal itself) has it or every dish in the deal does; a line not on the menu gives nothing.{' '}
              <Mono>clashWords()</Mono> words it for <Mono>line-clash</Mono> under the line. Till reports names the event in a
              check&apos;s history (<Mono>PosReports.jsx</Mono>). Tests: <Mono>shared/pos/test/allergy.test.mjs</Mono>,{' '}
              <Mono>api/test/till-allergy.test.mjs</Mono>.
            </P>
            <H3>Device kinds and app updates</H3>
            <P>
              One app at <Mono>pos.&lt;domain&gt;</Mono> serves tills, kitchen screens and kiosks;{' '}
              <Mono>boot()</Mono> in <Mono>pos/src/lib/store.js</Mono> picks by the saved device's kind
              (<Mono>openOtherApp()</Mono>: <Mono>kds</Mono> the kitchen app, <Mono>kiosk</Mono> the kiosk app, any
              other kind but <Mono>terminal</Mono> the "Getting the latest app" screen, never the till). The server
              has the last word: every <Mono>/pos-api/config</Mono> reply carries <Mono>device.kind</Mono>, and when it
              (or a cached config's) differs from the saved kind, <Mono>relabel()</Mono> saves the right kind, drops the
              till's cached config and opens that app. A copy of the app from before kiosks (17 Oct 2026) ran a newly
              paired kiosk as a till: its PIN screen failed with "Cannot read properties of undefined (reading
              'find')" because a kiosk's config has no staff (<Mono>staffForPin()</Mono> now reads{' '}
              <Mono>cfg.staff || []</Mono>).
            </P>
            <P>
              The service worker (<Mono>vite-plugin-pwa</Mono>, <Mono>pos/vite.config.js</Mono>, autoUpdate +
              skipWaiting) keeps the app on the device, so a device runs the copy it started with until the page
              loads again. <Mono>pos/src/lib/appUpdate.js</Mono> registers <Mono>/sw.js</Mono> itself (the plugin's{' '}
              <Mono>injectRegister</Mono> is off), asks for a new copy every 30 minutes and when the page becomes
              visible, and after a <Mono>controllerchange</Mono> (not the first one on a device) reloads when the
              screen on show says it's safe: <Mono>whenSafeToReload(fn)</Mono>, last registered wins. The till: pair,
              update, or nobody signed in and 10 s without a touch (<Mono>idleFor()</Mono>); the kiosk: start screen,
              empty basket, no dish open, 10 s; a kitchen screen: 30 s without a touch. Unsent events stay in
              IndexedDB. Kiosk design previews and the kitchen test bench never register or reload
              (<Mono>pos/src/main.jsx</Mono>).
            </P>
            <H3>Prices, VAT and offers</H3>
            <P>
              <Mono>shared/pos/pricing.js</Mono>: <Mono>priceItem()</Mono> (unit price + modifiers: prefixes No /
              Light free, Extra / On the side priced, nested groups always extra; combos through shared/combos.js),{' '}
              <Mono>posTax(item, check, config)</Mono> (the dish's tax levels resolved by{' '}
              <Mono>taxFor()</Mono> in <Mono>shared/tax.js</Mono> for the venue, the check's order type and
              revenue stream: <Mono>{'{ vat_rate, tax_rate_id }'}</Mono>, stored on each line) and <Mono>checkTotals()</Mono> (line discounts and comps, then promotions, then check
              discounts, then the check&apos;s charges, each at its own VAT rate; VAT inclusive per line rate). Promotions with channel{' '}
              <Mono>pos</Mono> are worked out by the till with <Mono>applyPromotions()</Mono> from{' '}
              <Mono>shared/promotions.js</Mono> and stored as a <Mono>promotions.set</Mono> event, so the server
              and reports never recompute them.
            </P>
            <H3>Printing</H3>
            <P>
              Migration 191. Two sources of print jobs, both stored by the sequencer in{' '}
              <Mono>pos_print_jobs</Mono> (with <Mono>station_id</Mono> and <Mono>kitchen_order_id</Mono> for kitchen
              tickets): <Mono>jobsForEvent()</Mono> in <Mono>shared/pos/printing.js</Mono> makes the till&apos;s own (bills,
              receipts, drawer kicks) for the device&apos;s receipt printer; <Mono>kitchenPrintJobs()</Mono> in{' '}
              <Mono>shared/pos/kitchenPrint.js</Mono> makes kitchen tickets from the kitchen orders after every kitchen
              change: a station of kind <Mono>printer</Mono> (<Mono>settings.printer_id</Mono>) prints each dish once when
              the dish reaches it (<Mono>flowTimes().arrived()</Mono>; straight from Orders in that is when it fires),
              grouped per order, printer and kind (<Mono>kitchen</Mono> | <Mono>fire</Mono> | <Mono>void</Mono>) by course,
              with the venue&apos;s kitchen design (<Mono>cfg.ticket_layout</Mono>). A printer straight after Orders in also
              lists held courses under HOLD (<Mono>item.hold_printed</Mono>), then prints FIRE; a voided dish that printed
              prints VOID (<Mono>item.void_printed</Mono>); <Mono>item.printed</Mono> stops a second print. Printer boxes
              never bump (<Mono>noBump()</Mono>): dishes reaching only printers are done there. Orders for later:
              the minute sweep (<Mono>kitchenPrintsDue()</Mono> in <Mono>services/kitchenSvc.js</Mono>, from the hold sweep)
              asks <Mono>printsDue()</Mono> and sends <Mono>kitchen.print_due</Mono>, a server event the sequencer
              answers by printing from <Mono>loadOpenKitchenOrders()</Mono> (nothing due: no event stored).
            </P>
            <P>
              Who prints: <Mono>pos_printers.connection</Mono> <Mono>hub</Mono> (a network printer) is collected by the
              venue hub (<Mono>hub/</Mono>: <Mono>bin/hub.js</Mono>, <Mono>src/cloud.js</Mono>, <Mono>src/service.js</Mono>; a
              device of kind <Mono>hub</Mono> linked by the code it shows, <Mono>POST /pos-api/pairings</Mono> with{' '}
              <Mono>app: 'hub'</Mono>; its routes are only <Mono>/config</Mono> (<Mono>hubConfig()</Mono>: its printers),
              claim, status, <Mono>POST /pos-api/hub/status</Mono> (each printer&apos;s state, shown in Store tech) and
              disconnect); <Mono>device</Mono> (<Mono>device_id</Mono>) by that till or kitchen screen
              (<Mono>pos/src/lib/devicePrint.js</Mono>: on <Mono>pos.print</Mono> and every 20 s, prints through the
              browser). <Mono>POST /pos-api/print-jobs/claim</Mono> hands each device only its own printers&apos; jobs and takes
              back a job collected over two minutes ago and never reported (<Mono>claimed_at</Mono>); only the collector
              reports on it (a till may mark a waiting one printed by hand). A device prints its own bills and receipts in its
              browser when its receipt printer is none or plugged into it (<Mono>receiptHere()</Mono> /{' '}
              <Mono>printsHere()</Mono>: no job is queued then). A kiosk&apos;s printer prints its own receipts only (refused as a
              printer box). Failed jobs: <Mono>POST /api/pos/print-jobs/:id/again</Mono>. Browser printing: a hidden iframe
              (<Mono>pos/src/lib/print.js</Mono>, HTML from <Mono>opsHtml()</Mono> in <Mono>shared/pos/ticketHtml.js</Mono>);
              the hub turns the same operations into ESC/POS (<Mono>hub/src/escpos.js</Mono>) and tries the printer&apos;s
              backup when it doesn&apos;t answer.
            </P>
            <H3>The venue hub on a mini PC</H3>
            <P>
              Migration 195. The hub (<Mono>hub/</Mono>, Node 22, no packages) installs on a Linux or Windows mini PC from one
              command, prints to network printers and to USB printers plugged into it, serves a status page on the venue&apos;s
              network and updates itself from the cloud.
            </P>
            <DataTable
              head={['Part', 'What it does']}
              rows={[
                ['Release', 'services/hubRelease.js: hubRelease() builds one tar.gz per API process from the files hub/bin/*.js load (importClosure() follows relative imports, so the shared ticket code comes along) plus hub/package.json, hub/README.md, shared/package.json and a release.json. Sorted names and fixed times: every process makes the same bytes. Version = hub/src/version.js VERSION + "+" + 8 hex of a hash of the files, so any change to the hub or the shared code it uses is a new version. Public routes (no auth): GET /pos-api/hub/release ({ version, sha256, size, url }), /pos-api/hub/release.tgz, /pos-api/hub/install.sh and install.ps1 (installScript(): __MACAROONIE_API__ replaced by the till address, or the request\'s own address on localhost).'],
                ['Install (Linux)', 'hub/install/install.sh: Node 22 from nodejs.org/dist/latest-v22.x checked against SHASUMS256.txt into /opt/macaroonie-hub/node; a system user macaroonie-hub in lp and dialout; the release checked against its sha256, unpacked to releases/<version>, --self-test; launcher.mjs and current.json; a systemd unit (Restart=always, ProtectSystem=full, ReadWritePaths the home); ufw opens 9180 when active; prints the code from state.json. On a computer already linked (hub.json), after the self test it runs the new hub.js link-info and asks on /dev/tty (piped from curl too): keep, switch (systemctl stop, hub.js unlink, then the usual install: a new code) or remove (unlink, then everything goes); --keep / --switch / --uninstall answer it, --force passes --force to unlink, no terminal = keep. A refused unlink (sales waiting, no cloud) chowns the home back and starts the service again. --uninstall leaves the venue with the installed hub.js when it has unlink, then removes it all. Environment overrides for tests (MACAROONIE_HUB_HOME, MACAROONIE_SYSTEMCTL, ...).'],
                ['Install (Windows)', 'hub/install/install.ps1 (irm ... | iex; everything inside Install-MacaroonieHub so errors return to the prompt): Node 22 zip checked by Get-FileHash into C:\\ProgramData\\Macaroonie\\Hub\\node, the release unpacked with tar.exe, then the Windows service MacaroonieHub (Install-HubService): the source of hub/install/HubService.cs travels in the installer ($global:MacaroonieHubServiceSource, a here-string the API fills in: installScript() replaces the __MACAROONIE_HUB_SERVICE_CS__ line), written to hub-service.cs and compiled with the .NET Framework 4 csc.exe Windows ships (C# 5 only) into hub-service.exe; service-args.txt holds the launcher\'s arguments one per line (--api, --http-port 9180, --lan-port 9181, --log-file hub.log); New-Service (or Win32_Service Change) automatic as LocalSystem, sc failure restart 5 s / 10 s / 30 s (reset after a day) and failureflag 1. hub-service.exe runs node\\node.exe launcher.mjs in a job object with KILL_ON_JOB_CLOSE: OnStop / OnShutdown terminate the job (launcher, hub and anything they started), the program dying closes the handle and does the same; a launcher that stops is started again after 5 s growing to 60 s; its log is service.log (1 MB, then service.log.1); hub-service.exe --console [--home DIR] runs the same loop in a terminal. Any failure (no compiler, the service won\'t start, Smart App Control) falls back to the scheduled task (Install-HubTask: at start-up as SYSTEM, restart on failure), as does MACAROONIE_HUB_RUN_AS=task; installing the service removes the task of older hubs. Set-HubPower (unless MACAROONIE_HUB_POWER=leave): powercfg standby and hibernate on AC 0, USB selective suspend off. Firewall rules for 9180 and 9181 (private and domain networks). Stop-Hub stops the service, the task, then every node.exe or hub-service.exe running from the hub\'s folder; Start-Hub starts whichever is installed. Already linked: the same link-info / keep / switch / remove choice as Linux (Read-Host when interactive; MACAROONIE_HUB_CHOICE keep | switch | remove, MACAROONIE_HUB_FORCE=1), LOSE typed to go ahead with sales waiting. MACAROONIE_HUB_UNINSTALL=1 leaves the venue, then removes the service, the task, the firewall rules and the folder. Sets $global:MacaroonieHubFailed and $global:MacaroonieHubRemoved for the setup file. Tested on windows-latest by .github/workflows/hub-windows.yml (hub/test/windows: standin.mjs, a stand-in cloud serving this checkout\'s installer and release; install-test.ps1: install, restarts, the program killed, stop, reinstall, task and back, moving a linked hub, uninstall), with Windows PowerShell 5.1 and PowerShell 7.'],
                ['Download to install', 'pos.<domain>/hub (posSite.js, till host only; the till app\'s service worker leaves /hub alone) redirects to GET /pos-api/hub/setup: hubSetupPage(), plain HTML with its own CSP (no scripts), the download for the user agent\'s system first. GET /pos-api/hub/setup.cmd (attachment macaroonie-hub-setup.cmd): hub/install/setup.cmd with \\r\\n line endings, plain ASCII. Not elevated (fltmc fails) it starts itself again with Start-Process -Verb RunAs (path and argument through environment variables, so a "(1)" or an apostrophe in the path is safe); elevated it downloads install.ps1 to %TEMP% with Invoke-WebRequest and runs it (no iex), exits 1 when $global:MacaroonieHubFailed (3 when removed), else opens http://localhost:9180/. "uninstall", "keep" or "switch" as its argument answers the question without asking. GET /pos-api/hub/setup.sh (attachment macaroonie-hub-setup.sh) is install.sh, which run from a file (*.sh) as a user other than root runs itself again with sudo. Store tech and the installer app\'s Add a hub show the address; Store tech also has both downloads and the commands under Or run a command. Unsigned: Windows SmartScreen and the browser ask before running it.'],
                ['Launcher', 'hub/bin/launcher.js, copied to <home>/launcher.mjs: runs the version in current.json, starts it again at once after exit 75 (an update), else after 2 s growing to 30 s; three stops within a minute of starting go back to current.previous and add the version to bad_versions (rolled_back_from). --log-file writes a log kept under 5 MB.'],
                ['Updates', 'hub/src/update.js createUpdater(): the hub\'s config (hubConfig()) carries release and update { auto: settings.auto_update !== false, requested: update_requested_at set }. At a quiet moment (a claim with no jobs, at most every 30 s) it downloads, checks the sha256 and release.json\'s version, unpacks with tar into releases/<v>.part, runs --self-test, renames, copies the launcher, writes current.json (keeping the version before) and exits 75. Not again for 30 minutes after a failure (5 when asked); a version in bad_versions only when asked. A copy run from the repository (no MACAROONIE_HUB_HOME) only reports updates: manual. POST /api/pos/devices/:id/update sets update_requested_at; a report with the latest version clears it.'],
                ['USB printers', 'hub/src/usb.js. Linux: /sys/class/usbmisc/lp*/device (ieee1284_id, and the USB device\'s idVendor, idProduct, serial or port) gives { id: usb:<vendor>:<product>:<serial | port-…>, name, escpos, path: /dev/usb/lpN }; printing writes the device file non-blocking (EAGAIN = wait), status asks DLE EOT and reads the answer back (no answer = unknown). Windows: Get-Printer (virtual printers left out), id win:<name>; a RAW job through winspool (OpenPrinter / StartDocPrinter RAW / WritePrinter) in an encoded PowerShell command, the name and a temp file in environment variables; status from PrinterStatus. Printers are found again by id at every print, never by device file. Prints and status questions to one printer are queued together.'],
                ['Printers in the cloud', 'A USB printer on the hub is pos_printers connection device, device_id = the hub, local_id = its id (checkPrinterDevice() needs local_id for a hub, clears it otherwise; host is null). hubConfig() sends network printers and the hub\'s own USB printers with interface network | usb; the claim already matches device printers by device_id. POST /pos-api/hub/status (HubReport) stores info (computer, addresses, status_port, local_printers, update) and info_at on pos_devices and updates state for its network printers and its own USB printers. Store tech → Venue hub (components/pos/HubSection.jsx, /pos/hub since migration 219) shows info, hub_release, Update now, Add it (the printer window from PrintersSection.jsx); the Printers page links to it (HubNote); the installer app lists hubs (KINDS.hub) with info.'],
                ['Status page', 'hub/src/statusPage.js on port 9180 (--http-port, 0 = none): GET / (refreshes every 5 s, CSP default-src none) and /status.json. Linking: the code and qrSvg() of the installer link; then cloud, version, update state, printers in words, USB printers found, the last 20 tickets as kind, printer, printed or the reason (never titles or contents). publicState() never includes a secret. The hub also writes state.json beside hub.json for hub.js status and the installers.'],
                ['Linking', 'bin/hub.js shows a code until linked (console, page, state.json); a 401 from the cloud (removed in Store tech) clears hub.json and the venue\'s files and shows a new code instead of stopping (a stop would make the launcher go back a version). hub.json keeps name, venue_name and tenant_name (from the pairing status, refreshed from GET /pos-api/me at start); the page and hub.js status name the restaurant group.'],
                ['Moving a hub', 'hub/src/link.js: one computer is one hub for one venue. linkInfo() (hub.js link-info [--api]): linked, same_api, the names, status linked | removed (401) | offline | other_api. unlink() (hub.js unlink [--force], one line of JSON, exit 2 when refused): starts the venue copy from venue.json / venue.log with the old link, runs one round (upload, follow), counts to_send plus lines left in venue.log; with any and no cloud (and no --force) refuses and changes nothing; else POST /pos-api/disconnect (Store tech shows Not linked; 401 = removed already) and forgetVenue() deletes hub.json, venue.json, venue.log, printers.json, state.json and their .tmp copies. A new link also starts by forgetting them. venue.log lines carry the hub id; replay skips another hub\'s lines (and unmarked ones unless venue.json is this hub\'s), so a computer linked elsewhere never decides the last venue\'s events. The launcher passes MACAROONIE_HUB_LAUNCHER_PID; hub.js exits when that process has gone (checked every 5 s).'],
              ]}
            />
            <H3>Print designs</H3>
            <P>
              Migration 190. A design is a layout <Mono>{'{ blocks: [{ id, type, opts }] }'}</Mono> of kind kitchen or
              receipt (<Mono>shared/pos/ticketLayout.js</Mono>: <Mono>BLOCK_TYPES</Mono> per kind with option
              defaults, <Mono>normaliseLayout()</Mono> (known types and options only, unique ids, the dishes and a
              receipt&apos;s totals added back: <Mono>REQUIRED_BLOCKS</Mono>), <Mono>defaultLayout()</Mono> (what
              tickets printed before designs), <Mono>normaliseVariation()</Mono> / <Mono>applyVariation()</Mono>,{' '}
              <Mono>SAMPLES</Mono> + <Mono>sampleTicket()</Mono> for the preview). <Mono>kitchenTicket(send,
              layout)</Mono> and <Mono>receipt(bill, layout)</Mono> in <Mono>tickets.js</Mono> draw from it (no layout
              = the built-in one; a title block uses <Mono>orderInfo()</Mono> and falls back to the usual title).{' '}
              <Mono>jobsForEvent()</Mono> passes <Mono>cfg.layouts.kitchen</Mono>; <Mono>billOps()</Mono> uses{' '}
              <Mono>cfg.layouts.receipt</Mono>, or <Mono>kiosk_receipt</Mono> for events from a kiosk device.
            </P>
            <DataTable
              head={['Table / route', 'What']}
              rows={[
                ['print_designs', 'tenant, kind kitchen | receipt, name, layout jsonb (normalised on save), created / updated by. Up to 50 per company.'],
                ['print_design_uses', 'tenant, venue_id (NULL = company), use kitchen | receipt | kiosk_receipt, design_id (ON DELETE CASCADE: deleting a design sends places back). Unique per company use and per venue use.'],
                ['print_design_variations', 'tenant, venue_id, design_id (PK venue + design), texts { blockId: { text | receipt_text | bill_text } }, hidden [blockId]. Words only for text / heading / footer parts; the dishes and totals can\'t be hidden. A design save drops words for parts no longer in it.'],
                ['printLayouts(tx, tenantId, venueId)', 'services/printDesignSvc.js: { kitchen, receipt, kiosk_receipt } for a venue: venue choice, else company; kiosk_receipt falls back to receipt; the venue\'s variation applied; null = built-in. In tillConfig() (print_layouts), the sequencer\'s printConfig() (layouts) and kioskConfig() (print_layouts.receipt = kiosk_receipt).'],
                ['GET /api/pos/print-designs?venue_id=', 'pos_setup view: designs, uses { company, venue }, used_at per design, defaults.'],
                ['POST /api/pos/print-designs', 'pos_setup manage: { kind, name, copy_from?, layout? } (copy only within a kind).'],
                ['GET / PUT / DELETE /api/pos/print-designs/:id', 'View: the design with variations per venue and used_at. Manage: { name, layout }; delete.'],
                ['PUT /api/pos/print-designs/:id/variations/:venueId', 'Manage: { texts, hidden }; empty deletes the row.'],
                ['PUT /api/pos/print-design-uses', 'Manage: { venue_id | null, use, design_id | null }; the design\'s kind must fit the use (422).'],
              ]}
            />
            <P>
              Every change broadcasts <Mono>pos.config</Mono> (a company change to every venue). Admin: Store tech →
              Printing (<Mono>components/pos/PrintingSection.jsx</Mono>) and the designer{' '}
              <Mono>pages/PrintDesigner.jsx</Mono> (<Mono>/pos/print-designs/:id</Mono>): parts in a sortable list,
              options per part, <em>Only at</em> a venue for its variation, explicit Save, a column-exact preview from{' '}
              <Mono>previewHtml(ops, cols)</Mono> in <Mono>ticketHtml.js</Mono> (wrapping as <Mono>toText()</Mono>,
              double width and height by CSS transforms). The receipt and bill footers left Store tech&apos;s settings
              (<Mono>pos_settings.receipt_footer</Mono> / <Mono>bill_footer</Mono> dropped): the migration made a
              design named Receipt for tenants that had any, used company wide, with each venue&apos;s footers as its
              variation. New locations copy the template venue&apos;s uses and variations (<Mono>storeSetup.js</Mono>).
              Tests: <Mono>shared/pos/test/tickets.test.mjs</Mono>, <Mono>api/test/print-designs.test.mjs</Mono>.
            </P>
            <H3>Card machines</H3>
            <P>
              Migration 193. A card machine payment is started by the server, never by the device: the till or
              kiosk asks <Mono>POST /pos-api/card/payments</Mono>, the server writes a <Mono>pos_card_payments</Mono>{' '}
              row (pending) and asks the provider (<Mono>services/cardMachines/</Mono>: <Mono>dojo.js</Mono>,{' '}
              <Mono>stripe.js</Mono>, <Mono>sumup.js</Mono>, <Mono>test.js</Mono>; one interface in{' '}
              <Mono>index.js</Mono>, the HTTP call and errors in <Mono>http.js</Mono>) to show the amount on the
              machine; the device then polls <Mono>GET /pos-api/card/payments/:id</Mono>, which asks the provider at
              most every 1.2 s (<Mono>refreshPayment()</Mono> in <Mono>services/cardSvc.js</Mono>). Provider calls
              never run inside a database transaction. Statuses: pending, signature (Dojo asks staff to check a
              signature), approved, declined, cancelled, failed. A sale left pending is asked about by the minute
              sweep (<Mono>sweepPending()</Mono>) and given up after 15 minutes.
            </P>
            <P>
              A payment reaches a check only as <Mono>payment.added</Mono> with tender <Mono>card_integrated</Mono>{' '}
              and <Mono>card_payment_id</Mono> (the shape check requires one and refuses it on any other tender).
              The sequencer (<Mono>shared/pos/cards.js</Mono>: <Mono>cardNeed()</Mono>, <Mono>cardProblem()</Mono>)
              loads the attempt with the store&apos;s <Mono>loadCardPayment()</Mono> (FOR UPDATE) and refuses it unless
              it is an approved sale of this venue, for exactly the payment&apos;s amount and tip, for this check (or no
              check yet: a kiosk pays before its order exists), for this payment id, not used by another event; then{' '}
              <Mono>useCardPayment()</Mono> records the event. A refund (<Mono>refund.added</Mono> with{' '}
              <Mono>card_refund_id</Mono>) needs an approved refund of a card payment on the check, for its amount;
              taking a card machine payment off (<Mono>payment.voided</Mono>) needs <Mono>card_refund_id</Mono> for the
              whole amount and tip (<Mono>applyEvent()</Mono> refuses it without one: <Mono>card_refund</Mono>). A store
              without these methods (the hub) refuses card machine events.
            </P>
            <DataTable
              head={['Table / route', 'What']}
              rows={[
                ['pos_card_accounts', 'tenant, provider dojo | stripe | sumup, name, secret (sealed, services/vault.js SEALED), hint (last 4), mode test | live, settings { merchant_code, merchant_name (SumUp, learned from the key), software_house_id, reseller_id (Dojo, else env), locations (Stripe) }, checked_at, removed_at (key cleared, machines removed; payments keep pointing at it).'],
                ['pos_card_readers', 'tenant, venue, account_id (NULL only for provider test), provider, provider_reader_id (Dojo terminalId, Stripe tmr_, SumUp reader id), name, model, serial, removed_at. pos_devices.settings.card_reader = its id (or none) on a till or kiosk.'],
                ['pos_card_payments', 'tenant, venue, reader, account, provider, kind sale | refund (sale_id), device, staff, check_id, payment_id (the ULID the event will carry; unique per venue), amount, tip, status, message, provider_ref / provider_ref2 (payment intent + session / checkout / charge / transaction), card_brand, card_last4, refunded, used_event_id / used_at, checked_at, finished_at.'],
                ['POST /pos-api/card/payments', 'Till or kiosk: { check_id? (till: open, on the server, amount ≤ what is left, so the till sends its outbox first; 409 not_synced), payment_id, amount, tip (till only), staff_id }. One open payment per machine (409 busy with payment_id).'],
                ['GET /pos-api/card/payments[/:id]', '?check_id= lists a check\'s attempts (Pay picks up a pending one and offers approved ones not on the bill). /:id refreshes from the provider.'],
                ['POST /pos-api/card/payments/:id/cancel | /signature | /test', 'Cancel on the machine (the provider has the last word: a card tapped just before counts); answer a Dojo signature check; a test card (the test machine, or Stripe test mode\'s present_payment_method).'],
                ['POST /pos-api/card/refunds', 'Till only: { sale_id, check_id, refund_id, amount, staff_id, approved_by?, purpose refund | void }, role permission refund or void (or a manager). The sale must be approved, on this check, with enough left; the refund is approved or failed when it returns.'],
                ['/api/pos/card-accounts[...]', 'Store tech view to list; manage + owner/admin to add, change (a new key or settings is checked first), remove. POST /:id/check asks again; GET /:id/readers is the provider\'s list, each marked where it is added.'],
                ['/api/pos/venues/:venueId/card-readers', 'View: the venue\'s machines and which tills and kiosks use them. Manage: add from the list ({ account_id, provider_reader_id, name }), by code ({ account_id, code, name, location? }: SumUp Solo pairing, Stripe registration code), or { provider: \'test\', name }.'],
                ['PATCH / DELETE /api/pos/card-readers/:id', 'Rename; remove (devices using it go back to none).'],
                ['GET /api/pos/venues/:venueId/card-payments?days=&status=', 'Store tech or Till reports view: attempts with machine, device and staff names; not_on_check flags an approved sale no event used.'],
              ]}
            />
            <P>
              Providers. <strong>Stripe Terminal</strong> (server-driven, from the shapes in Stripe&apos;s own Node SDK
              23.0.0): a PaymentIntent (card_present, automatic capture, idempotency key per attempt), then{' '}
              <Mono>POST /v1/terminal/readers/:id/process_payment_intent</Mono> with <Mono>skip_tipping</Mono> (tips are
              taken on the till); the result is the intent&apos;s status, or the reader&apos;s action (failed with a
              failure message = declined); cancel = cancel_action + cancel the intent; refunds through{' '}
              <Mono>POST /v1/refunds</Mono>. A Stripe card account is either the tenant&apos;s own key, or (migration 215)
              the group&apos;s connected Stripe account: <Mono>settings.connect = true</Mono>, no secret stored,{' '}
              <Mono>cardAccount(tenantId, row)</Mono> in <Mono>cardSvc.js</Mono> builds the provider account with the
              platform&apos;s key and <Mono>connect</Mono> = the tenant&apos;s <Mono>stripe_account_id</Mono>, and{' '}
              <Mono>cardMachines/stripe.js</Mono> adds the <Mono>Stripe-Account</Mono> header to every call. Adding one
              needs the account linked with charges on (409 for a second); a key can&apos;t be put on it. No platform fee
              on card machine sales. <Mono>POST /api/pos/card-accounts/:id/locations {'{ venue_id }'}</Mono> makes a
              Terminal location from the venue&apos;s website address (<Mono>createLocation()</Mono>; 422 when the venue
              has no address line and postcode).{' '}
              <strong>SumUp</strong> (Cloud API, from SumUp&apos;s TypeScript SDK 0.2.0): merchant code from{' '}
              <Mono>GET /v0.1/memberships</Mono>, readers paired by the Solo&apos;s code, a reader checkout, its state from{' '}
              <Mono>GET .../readers/:id/checkout/:checkout_id</Mono> and the transaction by{' '}
              <Mono>client_transaction_id</Mono> (card, and the id refunds need); terminate to cancel; refunds{' '}
              <Mono>POST /v1.0/merchants/:code/payments/:txn/refunds</Mono> (a full refund sends no amount, a part one
              sends pounds). <strong>Dojo</strong>: payment intent + terminal session (sessionType Sale), the session&apos;s
              status, signature answers, cancel, refunds on the payment intent; built from Dojo&apos;s API as known
              (docs.dojo.tech and an SDK weren&apos;t reachable), replies read loosely: check against a Dojo sandbox
              first. Base URLs <Mono>STRIPE_API_URL</Mono>, <Mono>SUMUP_API_URL</Mono>, <Mono>DOJO_API_URL</Mono>{' '}
              (tests point them at <Mono>api/test/support/fake-card-providers.mjs</Mono>); Dojo&apos;s{' '}
              <Mono>DOJO_SOFTWARE_HOUSE_ID</Mono> / <Mono>DOJO_RESELLER_ID</Mono> are the platform&apos;s.
            </P>
            <P>
              Devices. The till&apos;s config carries <Mono>card_machine</Mono> ({'{ id, name, provider, test, can_simulate, signature }'}, part of
              its version) from <Mono>cardMachineOf()</Mono>; the kiosk&apos;s too (<Mono>kioskConfig()</Mono>; previews
              none, they keep the pretend reader). Till: <Mono>cardStart()</Mono> / <Mono>cardCheck()</Mono> /{' '}
              <Mono>cardRefund()</Mono> in <Mono>pos/src/lib/store.js</Mono> (sends the check&apos;s outbox first),{' '}
              <Mono>CardPanel</Mono> in <Mono>PayModal.jsx</Mono>, refunds to the card in <Mono>Closed.jsx</Mono>. Kiosk:{' '}
              <Mono>MachineCard</Mono> in <Mono>pos/src/kiosk/Checkout.jsx</Mono> starts a payment for the order&apos;s total
              with the payment id it will use, then <Mono>placeOrder(&apos;card&apos;, {'{ id, card_payment_id }'})</Mono>{' '}
              (<Mono>kioskOrder()</Mono> makes the payment card_integrated); leaving the step cancels it; the idle
              timer waits while the guest pays (<Mono>card_waiting</Mono>). Admin: Store tech → Card machines
              (<Mono>components/pos/CardMachinesSection.jsx</Mono>, <Mono>CardMachinePick</Mono> in the till and kiosk
              windows). Tender <Mono>card_integrated</Mono> (&quot;Card machine&quot;) is on by default; the migration
              added it wherever Cash Recon&apos;s takings mapping had <Mono>card_external</Mono>, and moved kiosks
              that used the old on-screen test reader to a test card machine. Tests:{' '}
              <Mono>shared/pos/test/cards.test.mjs</Mono>, <Mono>api/test/card-machines.test.mjs</Mono>.
            </P>
            <H3>Check and order numbers (per device)</H3>
            <P>
              Migration 217: every till and kiosk numbers its own checks, so the cloud, the venue hub and a
              device working alone can all accept checks without handing numbers out. Rules in{' '}
              <Mono>shared/pos/numbers.js</Mono>: a check is the device's <Mono>short_code</Mono> and its own
              count for the trading day (<Mono>numberText()</Mono>: T2-47); a counter order (till or kiosk) also
              takes the next <Mono>order_no</Mono> in the device's <Mono>settings.order_numbers</Mono>{' '}
              <Mono>{'{ from, to }'}</Mono>, going round (<Mono>nextNumbers()</Mono>). The device puts{' '}
              <Mono>number</Mono> / <Mono>order_no</Mono> in the <Mono>check.opened</Mono> payload
              (<Mono>takeNumbers()</Mono> in <Mono>pos/src/lib/numbers.js</Mono>, its last numbers in localStorage{' '}
              <Mono>pos_numbers_&lt;device id&gt;</Mono>); the sequencer stamps <Mono>assigned.number_code</Mono>{' '}
              from the device's own code (never the payload's) and keeps each device's highest numbers per day
              (<Mono>noteNumbers()</Mono> into <Mono>pos_venue_state.device_numbers</Mono>), returned as{' '}
              <Mono>numbers</Mono> in <Mono>GET /pos-api/sync</Mono> and every <Mono>/pos-api/config</Mono> reply
              (an unchanged one too) and merged in by <Mono>keepServerNumbers()</Mono> /{' '}
              <Mono>mergeNumbers()</Mono> (later day, then higher check number), so a device that lost its
              storage carries on. The trading day a device counts under: the open day's date when the server
              said one (the till's sync <Mono>day</Mono>, the config's <Mono>trading_day</Mono>), else{' '}
              <Mono>businessDate()</Mono> by its own clock.
            </P>
            <P>
              Ranges: <Mono>POST /api/pos/venues/:id/link</Mono> gives a new till or kiosk the first free block of
              a hundred (<Mono>freeOrderRange()</Mono>: 1-99, 100-199, ...), a device brought back keeps its own
              unless another took it; <Mono>PATCH /api/pos/devices/:id</Mono> keeps the range when the settings
              leave it out and answers 422 <Mono>order_numbers</Mono> naming the device whose range it overlaps.
              Store tech's till and kiosk windows edit it (<Mono>OrderNumbersField</Mono> in{' '}
              <Mono>TillsSection.jsx</Mono>). Unsent changes: devices send <Mono>X-Pos-Pending: n</Mono> on every
              request (<Mono>createTransport(device, {'{ pending }'})</Mono>), stored in{' '}
              <Mono>pos_devices.pending_changes</Mono>; <Mono>GET /pos-api/reports/day</Mono> returns{' '}
              <Mono>waiting</Mono> (devices with changes, or not heard from for 10 minutes but seen today), shown by
              the till's Close the day (<Mono>WaitingDevices</Mono> in <Mono>pos/src/screens/Reports.jsx</Mono>).
              Tests: <Mono>shared/pos/test/numbers.test.mjs</Mono>, <Mono>api/test/device-numbers.test.mjs</Mono>.
            </P>
            <H3>Hub first (migration 218)</H3>
            <P>
              At a location with a linked venue hub and <Mono>pos_settings.hub_first</Mono> on (the default), tills,
              kiosks, kitchen screens and order ready boards send their events to the hub on the venue network; the hub
              decides them over its copy of the venue with the same sequencer, answers at LAN speed with or without the
              internet, and sends them on to the cloud, which decides them again and stays the one record
              (<Mono>pos_events</Mono>, <Mono>seq</Mono>). Design and limits: <Mono>docs/POS.md</Mono> section 11.
            </P>
            <DataTable
              head={['Part', 'What it does']}
              rows={[
                ['The copy', 'shared/pos/mirror.js createMirror(): the cloud\'s state (checks, kitchen orders, the trading day, device numbers, Splitter turns) as the base plus the hub\'s pending events. submit() decides an event with createSequencer() over that view; applyCloud() takes the cloud\'s new events and states and rebases (pending replayed at their own times; one that no longer applies goes to conflicts); sync() / kitchenSync() serve devices with the hub\'s own rev and source hub:<id>; dayReport(), listChecks(), getCheck(); needsCloud() for card machine and loyalty events; snapshot() / createMirror({ snapshot }) for the disk.'],
                ['Device rules', 'shared/pos/deviceRules.js deviceEvent(raw, device, venueId, kioskIds): what POST /pos-api/events allows a device (seq / assigned / hub fields stripped, server-only kitchen events refused, a kiosk only its own counter orders as itself). Used by the cloud for devices and for the hub\'s uploads, and by the hub for its devices.'],
                ['Cloud routes', 'services/hubFirstSvc.js + routes/posApi.js, hub devices only: GET /pos-api/hub/context (sequencer context without PIN hashes, devices and screens with key_hash, hub_first, primary, board_clear_mins, version; ?version= answers unchanged), GET /pos-api/hub/sync?since= (reset with checks open or of the day, kitchen orders and recent event ids; else event ids + seqs and changed checks / kitchen orders since; seq, day, numbers, turns, presence; a shared advisory lock on the venue so a reply is never half way through a decision), POST /pos-api/hub/events ({ events: [{ ...event, hub_at, hub_printed }], rejections }: each event checked with deviceEvent() for its own device, decided by the cloud\'s sequencer at hubTime(hub_at) (the future and older than 3 days clamp to now), pos_events.hub_id set, jobs saved printed by the hub when hub_printed, a device removed before hub_at refused; rejections the hub made are stored with hub_id).'],
                ['Which hub', 'primaryHub(): linked, not removed, its last report has info.lan_port, seen in the last 15 minutes; the oldest such. hubFor(tx, tenantId, venueId, device) gives a device { id, urls: http://<IPv4>:<lan_port> per address the hub reported, lan_key }, or null (hub first off, no primary). In every till / kiosk / kitchen screen /pos-api/config reply and every /screen-api/config reply, unchanged ones too (outside the version).'],
                ['LAN keys', 'deriveKey(\'lan:\' + kind + \':\' + id + \':\' + secret_hash) in services/vault.js (HMAC of SECRETS_KEY): nothing stored, a device linked again gets a new key. The hub only gets sha256 of each key in its context; devices send Authorization: Lan <id>.<key>.'],
                ['Cursors', '/pos-api/sync and /pos-api/kitchen/sync take source; anything but cloud starts the cursor again (reset), and replies say source: cloud. The hub\'s replies say hub:<id>. Devices keep seqSource and send it back.'],
                ['The hub', 'hub/src/venue.js startVenue(): the context every 30 s and after the first report; follow every 5 s, upload every 2 s while pending; venue.json (atomic, every 10 s and when the set-up loads) and venue.log (each accepted event appended + fsync before the answer), replayed on start (held while there is no set-up); tickets for the hub\'s printers to printOwn(), for a printer plugged into a device queued for that device (hub-<ulid>). hub/src/lan.js startLan(): port 9181 (--lan-port, HUB_LAN_PORT; the installers open it), CORS + Access-Control-Allow-Private-Network, GET /lan/ping, the device calls, /screen-api/orders for screen keys; 409 hub_off while not taking events; an unknown key loads the context again (at most every 10 s). service.js reports info.lan_port and info.mirror (on, rev, cloud_seq, pending, to_send, conflicts, devices, last upload / follow, error) every minute and when taking starts or stops.'],
                ['Devices', 'pos/src/lib/transport.js createTransport(device, { pending, hub, onHub }): HUB_PATHS (events, sync, kitchen sync, day report, checks, presence) to the hub first with HUB_TIMEOUT_MS 2500, then the cloud on no answer / 409 / 401; then a quiet /lan/ping every HUB_RETRY_MS 30 s (HUB_RETRY_UNKNOWN_MS 5 s after a 401). hubAllowed(): inside the Android app (IN_APP) or a page on http. Tills and kitchen screens poll every 2 s on the hub; the kiosk\'s reachable() counts the hub; screen/player.js fetchOrders() reads the hub first. StatusDot / kds-link / the kiosk staff panel / the till settings say venue hub. Android app 1.3: mixedContentMode always, plugins/withVenueNetwork.js (usesCleartextTraffic).'],
                ['Admin', 'components/pos/HubSection.jsx (Store tech → Venue hub, /pos/hub, migration 219): HubFirstSetting (the switch, PATCH /api/pos/venues/:id/settings { hub_first }, which also tells screens), HubFirstLine on each hub\'s row from info.mirror.'],
              ]}
            />

            <H3>Trading days, Z and Cash Recon</H3>
            <P>
              The first event after a Z opens a day (<Mono>business_date</Mono> by <Mono>day_starts_at</Mono> in
              the venue time zone); devices start their numbers again for it (below). <Mono>day.closed</Mono> needs no open checks; the
              server stores <Mono>dayFigures()</Mono> (<Mono>shared/pos/reports.js</Mono>, also the till's X / Z)
              and, with <Mono>recon_auto_fill</Mono>, calls <Mono>fillReconFromDay()</Mono>:{' '}
              <Mono>reconValues()</Mono> maps figures through <Mono>recon_map</Mono> (income: revenue stream ids
              / all / -refunds; takings: tender keys, amount + tips − refunds; SC: <Mono>service_charge</Mono> = every
              charge, <Mono>charge:&lt;name&gt;</Mono> = one charge by name from <Mono>figures.charges</Mono>, never both
              counted, and <Mono>tips</Mono>) and{' '}
              <Mono>fillReconDay()</Mono> (<Mono>services/reconFill.js</Mono>, shared with Loyverse) writes only
              mapped fields and skips a submitted Cash Recon day.
            </P>
            <H3>Admin pages</H3>
            <DataTable
              head={['Page', 'Files']}
              rows={[
                ['Store tech /pos/:tab', 'pages/PosSetup.jsx (TABS: one page per part, the key is the address; /pos, /pos?tab=<key> and unknown keys redirect, so store opening follow-ups saved with ?tab= links still work; kiosk and print designers at /pos/kiosks/designs/:id and /pos/printing/designs/:id so the menu link stays lit) + components/pos/*Section.jsx; GET /api/pos/venues/:id/setup is the one read (includes device_urls { terminal, kds, kiosk } from deviceOrigin(), till_url = the till\'s, sections and items for routing, recon_fields). deviceUrl(setup, kind) in TillsSection.jsx; ShownCodeField (the device steps with the kind\'s address + the code box), LinkDeviceModal / LinkDeviceButton (New device / Link a device on a row; Bring back for a removed one) and linkShownCode() there too, used by the Tills, Kitchen screens and Kiosks tabs. Reusing a device: ReusePick (Link it as A new … / One already here, under the code in every Add window: Add a till, Add a screen, Add a kiosk, Link a hub), reusable() (the kind\'s devices: not linked, linked, removed), defaultReuse() (the one not linked when there is exactly one), reuseLabel() (Link as … / Bring back …), RemovedDevices (the Removed line with Bring back). With a device picked, the window sends { code, device_id } and hides name and settings. The Screens page\'s AddScreenModal has the same choice over the location\'s screens (not paired first) and claims with screen_id.'],
                ['Floor plan /pos/floor', 'pages/PosFloor.jsx: snap 0.5 unit, pointer drag / resize, explicit Save per area (PUT /api/pos/floor-areas/:id/layout replaces tables on the area + decor).'],
                ['Till reports /pos/reports', 'pages/PosReports.jsx: days (+ fill-recon, needs cash_recon manage too), checks with events, conflicts, print queue.'],
                ['Menus, Variant groups, Promotions', 'components/menus/TillFields.jsx (section / dish Till box), components/menus/ComboEditor.jsx (Dish / Combo, steps, comboPayload()); VariantGroupsManager pos_prefixes + child_group_id + allow_repeat / on_request; Promotions Where (channels).'],
              ]}
            />
            <H3>Hosting: one build, three addresses</H3>
            <P>
              <Mono>routes/posSite.js</Mono> (fastify-plugin, registered after the apex hook) serves{' '}
              <Mono>pos/dist</Mono> for host kinds <Mono>pos</Mono> (tills), <Mono>kitchen</Mono> (kitchen screens)
              and <Mono>kiosk</Mono> (kiosks) (<Mono>platformHostKind()</Mono>), forwards <Mono>kds.</Mono> to{' '}
              <Mono>kitchen.</Mono> (301), and lets <Mono>/pos-api</Mono>, <Mono>/ws</Mono>, <Mono>/uploads/</Mono>{' '}
              and <Mono>/api/</Mono> through, so the existing <Mono>*.&lt;domain&gt;</Mono> nginx block and wildcard
              certificate cover all three. <Mono>/manifest.webmanifest</Mono> is the build&apos;s with the name for
              the host (Macaroonie Till / Kitchen / Kiosk), so each installs as its own app (Android ties an installed
              app to its address). The deploy builds <Mono>pos/</Mono> after the admin. <Mono>pos</Mono>,{' '}
              <Mono>kitchen</Mono>, <Mono>kds</Mono> and <Mono>kiosk</Mono> are in <Mono>RESERVED_SUBDOMAINS</Mono>.{' '}
              <Mono>deviceOrigin(kind)</Mono> and <Mono>DEVICE_KIND_OF_HOST</Mono> in{' '}
              <Mono>services/platformHost.js</Mono>; kiosk previews are made on the kiosk address and the kitchen
              test bench on the kitchen address.
            </P>
            <DataTable
              head={['Part', 'How']}
              rows={[
                ['pos/src/lib/appHost.js', 'HOST_APP from the address (pos -> terminal, kitchen / kds -> kds, kiosk -> kiosk, anything else null = any kind, for local and test addresses), addressFor(kind) (same scheme and port), belongsHere(kind), takePairCode() (#pair=CODE, removed from the address at once), movedTo() / setMovedTo() (localStorage maca_moved_to), moveDevice(), tellDisconnect(); sets the page title for the address.'],
                ['POST /pos-api/pair { code, app? }', 'Only the move hand-over: the one-time code POST /pos-api/move makes, typed by the app at the new address itself (#pair=CODE). app = HOST_APP; a code for another kind is refused before it is used (422 code wrong_address). Nothing else makes these codes since Store tech\'s were removed (19 Oct 2026).'],
                ['POST /pos-api/disconnect', 'Device auth (kiosks too: KIOSK_ROUTES). secret_hash, pairing_code_hash, pairing_expires_at = NULL: the device row stays (name, settings, short code), Store tech shows Not linked, Link a device on its row links the code the device then shows.'],
                ['POST /pos-api/move', 'Device auth. openPairing(tx, tenantId, deviceId, 10) (moved to services/posSvc.js) -> { code, kind, url = deviceOrigin(kind)/#pair=code }. The old copy\'s secret works until the code is used (pairing replaces it), so a move that never arrives can be tried again.'],
                ['Disconnect on the devices', 'Till: TillSettings Disconnect this till (manager approval, refused with unsent events) -> disconnect() in lib/store.js. Kitchen: SettingsPanel DisconnectBox -> disconnect() in kitchen/store.js (unsent taps dropped, counted first). Kiosk: StaffPanel DisconnectBox -> disconnect() in kiosk/store.js (waiting paid orders sent first, refused while any are left). Offline, the device still forgets itself and says Macaroonie couldn\'t be told.'],
                ['Move on the devices', 'MoveNotice (components/MoveNotice.jsx) when belongsHere() is false: the till app (above its screens), the kitchen app (top) and the kiosk (top of the start screen and in the staff panel). moveTill() / moveScreen() / moveKiosk() send what is waiting, call /pos-api/move, forget the device here, set maca_moved_to and open the new address. The old address then shows MovedAway (opens the new one after 5 s; Set up another device here clears it).'],
              ]}
            />
            <InfoBox type="info">
              Provisioned for later, not built: the venue hub (a <Mono>hub</Mono> device kind, the print-job claim
              routes, <Mono>device.hub_url</Mono> in <Mono>pos/src/lib/transport.js</Mono>, which tries the hub
              before the cloud) and card payment adapters (tenders are external for now). Kitchen screens: next
              section. Tests: <Mono>node --test shared/pos/test/*.test.mjs</Mono> (rules, pricing, printing,
              reports, kitchen, the sequencer against an in-memory store).
            </InfoBox>
          </section>

          {/* ── KITCHEN SCREENS ──────────────────────────────── */}
          <section id="kds" data-doc="">
            <H2>Kitchen screens (KDS)</H2>
            <P>
              Migrations 168, 169 (kitchen flow), 177 (several kitchen flows), 182 (stations out of a flow), 183 (Splitters), 200 (Sleepers), 191 (kitchen printers) and 207 (ticket colours). Design in <Mono>docs/POS.md</Mono> section 9. A kitchen screen is a till device of
              kind <Mono>kds</Mono> (<Mono>pos_devices</Mono>, short code K1, K2 ...), paired with a one-time
              code like a till. The same app at <Mono>pos.&lt;domain&gt;</Mono> boots{' '}
              <Mono>pos/src/kitchen/KitchenApp.jsx</Mono> (lazy) when the device's kind is <Mono>kds</Mono>.
              Kitchen events live in the venue's <Mono>pos_events</Mono> log and go through the same sequencer,
              so the venue hub can run them later with no change.
            </P>
            <H3>Kitchen orders</H3>
            <P>
              <Mono>shared/pos/kitchen.js</Mono> is the one implementation of the kitchen's rules, run by the
              sequencer and by the screen. A kitchen order is a till check (id = check id) or an online order
              (id <Mono>web-&lt;orders.id&gt;</Mono>). <Mono>kitchenForCheckEvent()</Mono> turns till events
              (<Mono>KITCHEN_CHECK_EVENTS</Mono>: lines.sent, course.fired, line.voided, lines.moved,
              check.merged, table / name / covers / server / note changes) into kitchen orders;{' '}
              <Mono>applyKitchenEvent()</Mono> applies kitchen events and returns <Mono>{'{ ok, orders, log }'}</Mono>.
              Held courses and online orders with a <Mono>fire_at</Mono> wait (<Mono>isFired()</Mono>); orders
              untouched for <Mono>STALE_HOURS</Mono> (16) drop off.
            </P>
            <H3>The kitchen flow</H3>
            <P>
              Station kinds (<Mono>STATION_KINDS</Mono>): <Mono>prep</Mono> makes dishes, <Mono>expo</Mono>{' '}
              checks whole orders, <Mono>runner</Mono> takes them out, <Mono>board</Mono> is an order ready board
              (nothing to bump, never on a kitchen screen), <Mono>balance</Mono> a Splitter (called Balance box before migration 200), <Mono>sleeper</Mono> a Sleeper (migration 200) and <Mono>printer</Mono> a
              kitchen printer (migration 191: prints the dishes that reach it, see Till (POS) → Printing; nothing to bump,
              never on a kitchen screen, links out allowed; a venue with only printer boxes still has a kitchen,{' '}
              <Mono>KITCHEN_KINDS</Mono> in <Mono>services/kitchenSvc.js</Mono>). The flow is links{' '}
              <Mono>{'{ from: stationId | null (Orders in), to, targets: [{ kind, id }], exclude }'}</Mono>; targets are
              item, section, device (the till or kiosk it was sent from, migration 192), revenue_stream,
              order_type (an <Mono>order_types</Mono> id, migration 170) or default, and empty targets mean every
              dish. <Mono>exclude</Mono> (migration 204, All except these in the designer) turns the filter round:
              the link takes every dish none of its targets names (<Mono>isExcept()</Mono>: exclude with at least
              one target; with none it is a link for every dish, and the API saves it as one). From each node a
              dish takes every link whose filter names it most specifically (<Mono>linkRank()</Mono>: item 0,
              section 1, device 2, revenue stream 3, order type 4, an Except link that doesn&apos;t leave the dish
              out 5, every dish 6; ties all apply;{' '}
              <Mono>nextStations()</Mono>). When a dish is sent, <Mono>itemRoute()</Mono> works out its whole way
              and stores it on the item as <Mono>{'route: { [node]: [the nodes before it, \'start\' = Orders in] }'}</Mono>{' '}
              (combo parts each get their own way, merged for the item), so a flow change only affects
              dishes sent after it. Stations left out of the config (switched off or deleted) are passed
              straight through; links to them are ignored, so the next most specific link applies.
            </P>
            <P>
              <strong>Several flows</strong> (migration 177): a venue has one or more named flows
              (<Mono>kds_flows</Mono>, each with its links and layout); one is in use,{' '}
              <Mono>pos_settings.kds_active_flow_id</Mono>, else the first by sort order
              (<Mono>activeFlowOf()</Mono> in <Mono>services/kitchenSvc.js</Mono>). The sequencer's kitchen
              config (<Mono>loadKitchenConfig()</Mono>) carries only the links of the flow in use as{' '}
              <Mono>cfg.flow</Mono>, with <Mono>flow_id</Mono> and <Mono>active_setting</Mono> (the setting as
              read): nothing in <Mono>shared/pos/kitchen.js</Mono> knows there is more than one flow.{' '}
              <Mono>switchFlow()</Mono> takes the venue's till lock (<Mono>pg_advisory_xact_lock</Mono> on{' '}
              <Mono>pos:&lt;venue&gt;</Mono>, the sequencer's), so a switch falls between two events; the
              Postgres store's <Mono>context()</Mono> re-reads the setting per event
              (<Mono>activeFlowSetting()</Mono>) and reloads the kitchen config when it changed, so a switch in
              the middle of another device's batch counts from its next event. A switch never touches dishes
              already sent: they keep <Mono>item.route</Mono>.
            </P>
            <P>
              <strong>Shared flows</strong> (migration 192): a flow with <Mono>kds_flows.venue_id</Mono> NULL is
              shared by every location. Its boxes are named stations, <Mono>boxes</Mono> jsonb{' '}
              <Mono>{'[{ id, name, kind }]'}</Mono>, and its links are <Mono>box_links</Mono> jsonb{' '}
              <Mono>{'[{ id, from: box id | null, to: box id, targets, exclude }]'}</Mono> (not{' '}
              <Mono>kds_flow_edges</Mono>). <Mono>resolveSharedFlow(flow, place)</Mono> in{' '}
              <Mono>shared/pos/kitchen.js</Mono> turns it into one location&apos;s links: each box is the
              location&apos;s station with the same <Mono>flowName()</Mono> (trimmed, spaces collapsed, lower case;
              the first of two), links touching a box the location lacks are left out (so the next closest link
              applies), and its revenue stream and device filters, stored by name, become the location&apos;s ids
              of those names (none: <Mono>{'{ kind, id: null }'}</Mono>, which matches no dish, so an Except link
              there leaves nothing out and stays an Except link, ranked as at the other locations). Dish, section and
              order type filters stay ids (the company&apos;s). It returns <Mono>{'{ links, matches, missing, differs }'}</Mono>{' '}
              (a station of a different kind works as its own kind there). <Mono>loadFlows()</Mono> lists a
              venue&apos;s own flows, then the shared ones (each by sort order); <Mono>loadFlow()</Mono> resolves a
              shared one at the venue (<Mono>flowPlace()</Mono>: its stations, revenue streams, tills and kiosks),
              so the sequencer, kitchen screens (<Mono>kdsConfig()</Mono>, flows with <Mono>shared</Mono>) and the
              test bench get ordinary links and nothing else changes. Because the flow in use falls back to the
              first, <Mono>pinActiveFlows()</Mono> writes each venue&apos;s flow in use down before shared flows
              are made, reordered or deleted; <Mono>ensureFlows()</Mono> makes Main flow only for a venue with no
              flows at all. <Mono>shareFlow(links, stations, names)</Mono> turns a venue&apos;s flow into a shared
              one (box id = station id, so the layout carries over; a duplicate name&apos;s links and filters on
              streams or tills that have gone are dropped, and an Except link left with none takes every dish; a
              shared flow copied to a venue does the same with the names the venue lacks),{' '}
              <Mono>boxProblems()</Mono> checks boxes (a name each,
              no two alike, a known kind).
            </P>
            <P>
              <strong>Sent from</strong> (migration 192): link filter kind <Mono>device</Mono> names the till or
              kiosk that sent the order (<Mono>pos_devices</Mono> of kind terminal | kiosk at the venue, by id; in
              a shared flow by name). <Mono>RANK</Mono>: item 0, section 1, device 2, revenue_stream 3,
              order_type 4, default 5. <Mono>itemFromLine()</Mono> passes the <Mono>lines.sent</Mono>{' '}
              event&apos;s <Mono>device_id</Mono> into the route target; online and GloriaFood orders have no
              device, so a device link never takes them. The test bench&apos;s Test order has a Sent from choice
              (<Mono>spec.device_id</Mono>, checked against <Mono>data.devices</Mono>).
            </P>
            <P>
              <strong>Setters</strong> (migration 203): a station of kind <Mono>setter</Mono> sets the order&apos;s status
              as a dish passes it. Like a board it is done as soon as a dish reaches it (<Mono>noBump()</Mono>), so dishes
              go straight on; no kitchen screen (not in <Mono>BUMP_KINDS</Mono>; Store tech drops it from screens when a
              station becomes one), bumps refused. Its name is the status: the API refuses a second Setter of the same
              name at a venue (<Mono>checkSetterName()</Mono>, case and spaces ignored, 409). Its look is in
              settings (<Mono>status_look</Mono> from <Mono>STATUS_LOOKS</Mono>, <Mono>status_colour</Mono>,{' '}
              <Mono>status_text</Mono> (empty = the name), <Mono>status_anim</Mono> from <Mono>STATUS_ANIMS</Mono>,{' '}
              <Mono>status_lamp</Mono> 1-3), read through <Mono>statusOf()</Mono>. <Mono>orderStatus(o, cfg, at)</Mono>{' '}
              is the Setter the order&apos;s live, fired dishes reached last (by <Mono>flowTimes().arrived()</Mono>), so it
              is worked out, never stored; <Mono>boardNumbers()</Mono> puts it on each entry as <Mono>status</Mono> when
              given <Mono>cfg</Mono> (<Mono>boardFor()</Mono> passes it for the all-orders feed and every board). The
              screen designer gets the list as <Mono>order_statuses</Mono> from <Mono>designerData()</Mono> (one per name,
              the first location&apos;s look).
            </P>
            <P>
              <strong>Sleepers</strong> (migration 200): a station of kind <Mono>sleeper</Mono> holds the dishes that
              reach it for <Mono>settings.delay_mins</Mono> (1-240, <Mono>SLEEP_MINS_MAX</Mono>; Zod in{' '}
              <Mono>StationSettings</Mono>), then passes them on by itself. Which dishes it holds is decided by the
              links into it like any station, so filters by order type, revenue stream, till, dish or section (or
              none) need nothing new; links out may have filters. It is time based: <Mono>flowTimes(item, cfg, at)</Mono>{' '}
              counts a Sleeper done at <Mono>wakes(id)</Mono> = arrived + delay, and only once <Mono>at</Mono> is that
              late (no <Mono>at</Mono>: not done), so the next station&apos;s <Mono>arrived()</Mono> is null until then
              and the screen, the bench and the board see the dish arrive as their clocks pass the time, with no event.{' '}
              <Mono>nodeState()</Mono> at the Sleeper is <Mono>sleeping</Mono>; <Mono>itemWhere()</Mono> includes it (so
              refusals say Still at it) and <Mono>itemSleeps()</Mono> gives <Mono>{'[{ station_id, until }]'}</Mono>;{' '}
              <Mono>stationTickets()</Mono> puts <Mono>sleeps</Mono> on each upcoming item (and leaves the Sleeper out of{' '}
              <Mono>where</Mono>) and <Mono>sleeping_until</Mono> on a ticket whose only dishes are asleep, and times
              the pass with <Mono>workSince()</Mono> (first arrival at a bump station, else the wake time) instead of{' '}
              <Mono>liveSince()</Mono>. A forced finish (the pass bumping dishes still on their way, an order set ready
              from outside) marks the Sleeper done too; a remake records the Sleepers already passed in{' '}
              <Mono>item.slept</Mono>, which pass straight through afterwards. No kitchen screen (<Mono>BUMP_KINDS</Mono>),
              bumps refused, never a Splitter&apos;s output. Kitchen printers after a Sleeper print through the minute
              sweep (<Mono>kitchenPrintsDue()</Mono> asks <Mono>printsDue()</Mono> with the time now, so a wake is
              printed within a minute). Order status only changes on events, so a dish whose way ends at a Sleeper
              (no station after it) makes no difference to when an order is ready. A shared flow&apos;s Sleeper box
              takes each location&apos;s own station of that name and its own minutes.
            </P>
            <P>
              <strong>Splitters</strong> (migration 183; the kind stays <Mono>balance</Mono>, and the code keeps the balance names: <Mono>balanceTicket()</Mono>, <Mono>kds_balance_turns</Mono>): a station of kind <Mono>balance</Mono> shares work
              between the stations it links to (prep, expo or runner only, links out without filters:{' '}
              <Mono>flowProblems()</Mono>; fewer than two is a warning). <Mono>itemRoute()</Mono> still walks
              through it (so Check a dish shows both); <Mono>resolveBalances(route, cfg, pick)</Mono> then takes
              each box out of a dish&apos;s way, keeping only the picked station and what follows it
              (<Mono>collapseBalance()</Mono>, also used by the tests). <Mono>balanceTicket(items, cfg, at)</Mono>{' '}
              decides every box on the dishes one event sends or fires, upstream boxes first
              (<Mono>flowBoxes()</Mono>), changing their ways in place: by default the whole ticket goes to the
              output with the lowest <Mono>stationLoad()</Mono> (every fired dish on its way to that station not
              yet done, counted with the box&apos;s <Mono>settings.pieces</Mono>, the same member shape and{' '}
              <Mono>memberCount()</Mono> as On order counts; a dish no member names counts its quantity), a tie
              going to the first after the box&apos;s last pick. With <Mono>settings.split_above = N</Mono> and
              more than N pieces of the ticket reaching the box, each unit (a dish line, or a meal deal part; the
              deal&apos;s own options count with its first part there; <Mono>unitPieces()</Mono>) goes, biggest
              first, to the output with the lowest load plus what this ticket already put there, ties taking
              turns; a line&apos;s quantity is never split. A meal deal&apos;s way is its parts&apos; ways merged.
              It runs in <Mono>lines.sent</Mono> (held lines keep the box until <Mono>course.fired</Mono>{' '}
              decides them) and <Mono>kitchen.order_in</Mono> (online and GloriaFood orders, later ones too). The sequencer gives
              those events <Mono>cfg.balance = {'{ open, last, picks }'}</Mono> through the store&apos;s{' '}
              <Mono>loadOpenKitchenOrders()</Mono> / <Mono>loadBalanceTurns()</Mono> and saves{' '}
              <Mono>picks</Mono> with <Mono>saveBalanceTurns()</Mono> (<Mono>kds_balance_turns</Mono>); the test
              bench keeps both in memory. A box is never on a kitchen screen (<Mono>BUMP_KINDS</Mono> everywhere
              stations are listed for screens), refuses bumps, and is passed straight through by{' '}
              <Mono>flowTimes()</Mono> like a board. Making a station a box drops its links to non-bumping
              stations and its links&apos; filters (<Mono>tidyBalanceBox()</Mono>); pieces must name the
              tenant&apos;s dishes.
            </P>
            <P>
              <strong>Splitter modes</strong> (no migration: settings jsonb). <Mono>settings.share_mode</Mono>{' '}
              (<Mono>SHARE_MODES</Mono>: <Mono>pieces</Mono> | <Mono>speed</Mono>) and the busy order type rule{' '}
              <Mono>rush_type_id</Mono> / <Mono>rush_count</Mono> (1 to <Mono>RUSH_COUNT_MAX</Mono> 99, default 5) /{' '}
              <Mono>rush_station_id</Mono> (both ids or neither; off = no type). <Mono>balanceTicket(items, cfg, at, ko)</Mono>{' '}
              now takes the kitchen order (its <Mono>type</Mono>; the three call sites pass it) and picks the
              output with the lowest score, <Mono>(load + pieces added) x pace</Mono>, a tie (within 1e-6) to the
              first after the last pick. Pace is 1 everywhere for <Mono>pieces</Mono> (so it is the old rule);
              for <Mono>speed</Mono> it is <Mono>stationPace(orders, stationId, members, cfg, at)</Mono> over{' '}
              <Mono>cfg.balance.recent</Mono> (else <Mono>open</Mono>): seconds per piece over the station&apos;s
              last <Mono>PACE_TICKETS</Mono> (8) bumps in the <Mono>PACE_MINUTES</Mono> (30) before{' '}
              <Mono>at</Mono>, each counted from the later of its <Mono>started_at</Mono> and the station&apos;s
              bump before it (queueing time isn&apos;t counted twice), pieces by <Mono>piecesAt()</Mono> (the
              same count as <Mono>stationLoad()</Mono>), recalled bumps left out, null with fewer than two
              bumps, never under 1 s a piece; unknown paces take the others&apos; average (<Mono>fillPaces()</Mono>).
              The busy rule (<Mono>busyTypeStations()</Mono>) applies when the box links to{' '}
              <Mono>rush_station_id</Mono> and has two or more outputs: <Mono>typeWaiting()</Mono> counts
              open orders of the type (not the order itself) with a live dish active or upcoming at any output,
              plus one when the order is of that type; at <Mono>rush_count</Mono> or more the order&apos;s
              tickets may go only to the rush station (type) or only to the others (any other order), big
              tickets shared among those. The sequencer adds <Mono>recent</Mono> only when a box uses{' '}
              <Mono>speed</Mono>, from the store&apos;s <Mono>loadRecentKitchenOrders(PACE_MINUTES * 2)</Mono>{' '}
              (kds_orders of any status changed in that many minutes, bounded by <Mono>created_at</Mono> for
              the index); the test bench passes its own orders. API: <Mono>StationSettings</Mono> (refine: type
              and station together), <Mono>checkSplitterRule()</Mono> (the tenant&apos;s order type; a bumping
              station of the venue, not the box; other kinds keep no Splitter settings),{' '}
              <Mono>dropBusyStation()</Mono> clears the rule from Splitters when its station is deleted or stops
              bumping. <Mono>flowWarnings()</Mono> warns when a box&apos;s rule names a station it doesn&apos;t
              link to (the flow PUT now loads station settings for it). Admin: <Mono>StationModal</Mono>{' '}
              (How it shares, <Mono>BusyTypeRule</Mono> with <Mono>linkedFrom()</Mono> putting linked stations
              first), the station row, and <Mono>balanceRule()</Mono> / <Mono>busyRule()</Mono> in{' '}
              <Mono>KitchenFlow.jsx</Mono> (box note, link panel, Check a dish).
            </P>
            <P>
              <strong>Stations out of a flow</strong> (migration 182): <Mono>kds_flows.off_station_ids</Mono>{' '}
              (uuid[], default empty) are the venue&apos;s stations a flow leaves out. The designer doesn&apos;t
              draw them (Not in this flow lists them with Put back) and{' '}
              <Mono>PUT /api/pos/kds-flows/:id</Mono> refuses a link to or from one (422 &quot;X is out of this
              flow: put it back before linking it&quot;) and any id that isn&apos;t one of the venue&apos;s stations,
              so routing needs no change: with no link reaching it, <Mono>itemRoute()</Mono> never sends a dish
              there, and the kitchen screen&apos;s flow list (<Mono>station_ids</Mono>, from the links) leaves it
              out. <Mono>flowWarnings()</Mono> is given only the stations in the flow, so an out station
              isn&apos;t reported as off every dish&apos;s way. Copying a flow copies the list; ids of stations
              deleted later are ignored when read. A station out of every flow is simply never reached; it
              keeps its screens and settings.
            </P>
            <P>
              A dish <em>arrives</em> at a node when every node before it is done (<Mono>flowTimes()</Mono>;{' '}
              <Mono>item.reset[node]</Mono> moves the arrival on after a remake) and is <em>done</em> there when
              that station bumps it (<Mono>item.done[node]</Mono>); a board is done when reached.{' '}
              <Mono>nodeState()</Mono> gives held | upcoming | active | done | voided. Prep stations bump only
              arrived dishes; an expo or runner with <Mono>show_upcoming</Mono> (default on for expo) also
              finishes dishes still at earlier stations. Undoing a dish or bringing a bump back is refused with{' '}
              <Mono>moved_on</Mono> once a later station has done it. A remake at a prep station clears that
              station and everything after it; at an expo or runner it starts the dish again from Orders in.
            </P>
            <P>
              <strong>The packing check</strong> (no migration: kitchen order state and station settings). At an
              expo or runner (<Mono>isOrderLevel()</Mono>) a tap sends <Mono>kitchen.item_checked</Mono>{' '}
              <Mono>{'{ order_id, station_id, item_id, checked }'}</Mono> instead of <Mono>kitchen.item_done</Mono>:
              it sets or clears <Mono>item.checked[stationId]</Mono> (the time) and changes nothing about where the
              dish is, so the ticket stays until READY / DONE (<Mono>kitchen.bumped</Mono>). Refused at prep
              stations (<Mono>station</Mono>: they mark dishes done), for voided and held dishes, dishes not on
              their way to the station, dishes already done there (<Mono>nothing</Mono>: Prev brings the ticket
              back), the same value twice (<Mono>nothing</Mono>) and, without <Mono>show_upcoming</Mono>, a dish still
              at an earlier station (<Mono>upcoming</Mono>). Ticking a dish that is still upcoming marks it done at
              every station before (<Mono>finishBefore()</Mono>: it is in front of the pass), without a bump
              record there. With the station setting <Mono>bump_when_checked</Mono> (default false;{' '}
              <Mono>STATION_DEFAULTS</Mono>, <Mono>StationSettings</Mono>, expo / runner only in the admin), the tick
              that leaves every dish the station would bump (<Mono>bumpable()</Mono>) ticked runs the same bump as
              READY (<Mono>bumpStation()</Mono>, now shared with <Mono>kitchen.bumped</Mono>) with{' '}
              <Mono>by_items: true</Mono> on the bump record and a <Mono>kds_log</Mono> bump row. Ticks go with a
              remake (<Mono>delete item.checked</Mono>) and when the dish is sent back before the station: an
              undone dish or a recalled bump at an earlier station clears the ticks at every station after it
              (<Mono>untickAfter()</Mono>), so a stale tick never counts towards the last-tick bump. Recalling the
              pass&apos;s own bump keeps its ticks. <Mono>stationTickets()</Mono> gives each item{' '}
              <Mono>ticked</Mono> and each ticket <Mono>ticked</Mono> (a count) and <Mono>all_ticked</Mono>{' '}
              (every dish to bump there, active or upcoming with <Mono>show_upcoming</Mono>, ticked); the screen
              shows CHECKED and the All ticked off top. Devices still on an older copy of the app send{' '}
              <Mono>kitchen.item_done</Mono> at the pass, which keeps working (done, and the last one bumps).
            </P>
            <P>
              <strong>Ticket colours</strong> (migration 207): <Mono>pos_settings.kds_colours</Mono> jsonb{' '}
              <Mono>{'{ states: { [key]: \'#rrggbb\' }, sections: [{ name, colour }] }'}</Mono>, per venue, written by{' '}
              <Mono>PATCH /api/pos/venues/:id/settings</Mono> (<Mono>kds_colours</Mono>: Zod checks keys and codes,
              then <Mono>normaliseKitchenColours()</Mono> stores it cleaned: lower case, names trimmed and spaces
              collapsed, each section name once ignoring case, at most <Mono>SECTION_COLOURS_MAX</Mono> 100;{' '}
              <Mono>configChanged()</Mono> tells the screens). <Mono>shared/pos/kitchenColours.js</Mono> is the one
              implementation: <Mono>KITCHEN_COLOURS</Mono> (12 keys in groups dish / head / timer, each with the
              standard <Mono>bg</Mono>, <Mono>ink</Mono> and <Mono>dim</Mono>: todo, ticked, upcoming, held, voided,
              head, head_new, head_rush, head_prepared, head_checked, timer_warn, timer_late),{' '}
              <Mono>ticketColours(colours)</Mono> (a set colour gets <Mono>inkOn()</Mono> words: black when its
              luminance is over 0.6, else white; a held row with its own colour dims to 0.65),{' '}
              <Mono>sectionColour()</Mono>, <Mono>sectionColoursById()</Mono>, <Mono>sectionKey()</Mono>.{' '}
              <Mono>kdsConfig()</Mono> sends <Mono>colours: {'{ states, sections: { [sectionId]: colour } }'}</Mono>:
              sections match by name over the venue&apos;s menus (draft tables and the live versions, so a section
              renamed before publishing keeps the colour of either name). Kitchen items and meal deal parts carry{' '}
              <Mono>section_id</Mono> (<Mono>itemFromLine()</Mono> / <Mono>itemFromOnline()</Mono>; a typed-in part
              takes the combo&apos;s section). The kitchen screen draws rows, tops, the RUSH chip and the timer from
              these with inline styles (<Mono>rowLook()</Mono>, the head key rush &gt; new &gt; checked &gt;
              prepared &gt; head), names and parts in their section colour except on voided rows. The test bench
              passes the venue&apos;s colours to its screens (<Mono>kitchenTestData()</Mono>). A new location
              copies them (<Mono>storeSetup.js</Mono>). Admin: <Mono>components/pos/KitchenColours.jsx</Mono>{' '}
              (<Mono>TicketColoursCard</Mono> on Store tech → Kitchen screens with <Mono>TicketPreview</Mono>, one
              Save) and the station window&apos;s Ticking off dishes choice.
            </P>
            <P>
              An order is <Mono>ready</Mono> (<Mono>orderFacts()</Mono>) when every dish has reached every board
              and runner on its way, and dishes with neither are done everywhere; it becomes{' '}
              <Mono>collected</Mono> by itself when everything is done and every dish's way ends at a runner
              (the runner handed it over), else when Collected is tapped. <Mono>boardState()</Mono> and{' '}
              <Mono>boardNumbers({'{ boardId, cfg }'})</Mono> give each board's own preparing / ready lists.{' '}
              <Mono>flowProblems()</Mono> (blocks saving: links to missing stations, out of a board, to itself,
              twice, unknown filters, circles) and <Mono>flowWarnings()</Mono> (nothing comes in, stations on no
              dish's way) are shared by the API and the designer.
            </P>
            <DataTable
              head={['Event', 'Payload', 'From']}
              rows={[
                ['kitchen.item_done', '{ order_id, station_id, item_id, done }', 'screen (a prep station: the dish goes on; the last one done bumps the ticket)'],
                ['kitchen.item_checked', '{ order_id, station_id, item_id, checked }', 'screen at an expo or runner: the packing check (ticks a dish off; nothing moves unless the station bumps when every dish is ticked)'],
                ['kitchen.bumped / kitchen.recalled', '{ order_id, station_id }', 'screen (the dishes go on to the next station; an expo / runner bump can make the order ready; recall undoes the last bump unless a later station has done its dishes)'],
                ['kitchen.remake', '{ order_id, station_id, item_id, reason? }', 'screen (item active again, logged)'],
                ['kitchen.priority', '{ order_id, on }', 'screen (rush)'],
                ['kitchen.collected', '{ order_id }', 'screen (pass, after ready)'],
                ['kitchen.order_in', '{ order }', 'server only: an online order (refused from devices)'],
                ['kitchen.order_status', '{ order_id, status: ready | collected | cancelled }', 'server only: the online order changed on the orders board'],
              ]}
            />
            <P>
              Kitchen events need no staff member, don't open a trading day, and are refused with code{' '}
              <Mono>kitchen_off</Mono> at a venue with no stations. Refusals stay out of Till reports' Refused
              changes. The sequencer's store gains <Mono>loadKitchenOrders()</Mono>,{' '}
              <Mono>saveKitchenOrders()</Mono> and <Mono>saveKitchenLog()</Mono> (Postgres in{' '}
              <Mono>services/posSvc.js</Mono>; the in-memory test store and the future SQLite one do the same).
            </P>
            <DataTable
              head={['Table', 'What it holds']}
              rows={[
                ['kds_stations', 'Per venue: name, kind prep | expo | runner | board | balance (183, a Splitter) | printer (191) | sleeper (200), colour, settings jsonb { target_mins, late_mins, show_held, show_upcoming, summary_groups: [{ id, name, members: [{ kind dish | option, id | label, qty }] }], pieces (a Splitter: members, same shape), split_above (a Splitter: null = each ticket on one station, N = share a ticket with more than N pieces), share_mode (a Splitter: pieces | speed), rush_type_id / rush_count / rush_station_id (a Splitter\'s busy order type rule), printer_id (a printer box), delay_mins (a Sleeper, 1-240), bump_when_checked (an expo or runner: the last dish ticked off bumps the ticket) }, sort_order, is_active.'],
                ['kds_balance_turns', 'Each Splitter\'s last pick (183): station_id (the box, PK, ON DELETE CASCADE), last_station_id, updated_at. Written by the sequencer (saveBalanceTurns()) so a tie goes to the next station. Forced RLS.'],
                ['kds_flows', 'A venue\'s kitchen flows (177): name (1-40, unique per venue ignoring case and spaces), layout jsonb { [stationId | start]: { x, y } } (where the designer draws each box), sort_order (the kitchen screen\'s list), off_station_ids uuid[] (182: the venue\'s stations this flow leaves out). Forced RLS like every tenant table. The migration made one "Main flow" per venue with stations or links, holding its links and layout, in use. A venue without any flow gets it from GET .../setup (ensureFlows()). Shared flows (192): venue_id NULL, boxes jsonb [{ id, name, kind }], box_links jsonb [{ id, from, to, targets }] (layout keys are box ids), names unique per tenant (index kds_flows_shared_name); a venue\'s own flow can\'t take a shared flow\'s name, a shared one can\'t take any flow\'s.'],
                ['kds_flow_edges', 'A flow\'s links (169, flow_id NOT NULL since 177, ON DELETE CASCADE with the flow): from_station_id (NULL = Orders in), to_station_id (both ON DELETE CASCADE), targets jsonb, exclude boolean (204: All except these, the link takes every dish its targets don\'t name; kept false when targets is empty), sort_order. One link per pair per flow (unique index on flow_id, from, to). Read them by flow_id, never by venue alone. Replaced kds_routes: each station\'s routes became one link from Orders in, every prep station got a link to every expo.'],
                ['kds_orders', 'Projection (like pos_checks): id text (a check id, web-<orders.id> or gf-<gloriafood_orders.id>), source till | online | gloriafood (178; taken from the id prefix by applyKitchenEvent(), never from the payload), check_id / order_id, status active | ready | collected | cancelled, state jsonb (the whole kitchen order), last_seq.'],
                ['kds_log', 'One row per bump and remake: station (id, name, kind), seconds since the dishes arrived or were fired, items, order source / type / number, reason, recalled_at (a recalled bump is left out of the report). Feeds the Kitchen report and its CSV.'],
                ['pos_devices', 'kind kds; settings { station_ids, view tickets | on_order, columns, text_size, sound, can_switch_flow (absent = true: its flow button may put another flow in use), ticket_main auto | number | tent | table | name (the ticket header\'s title: ticketTitle() in pos/src/kitchen/KitchenApp.jsx; auto or absent = table, tab or guest name with the order number beside it; another field falls back to auto when the order lacks it) }.'],
                ['pos_settings', 'kds_online_orders (send accepted online orders), kds_online_ready (ready in the kitchen marks the online order ready, collected completes it; for GloriaFood orders: their board status), kds_gloriafood (178, default off: send GloriaFood orders), kds_gloriafood_types jsonb ({ pickup | delivery | dine_in | order_ahead | table_reservation: order type id | null }; a key left out is matched by name by gloriaFoodTypes()), kds_gloriafood_lead_mins (0-240, default 20: an order for later comes on this long before its time), kds_active_flow_id (the flow in use, ON DELETE SET NULL; NULL = the first), kds_flow_switched_at / kds_flow_switched_by (the last switch: a screen\'s name or a person\'s email). kds_flow_layout moved to kds_flows.layout (177).'],
              ]}
            />
            <H3>API</H3>
            <DataTable
              head={['Route', 'What it does']}
              rows={[
                ['GET /pos-api/config (kds device)', 'kdsConfig(): stations (active only, boards too), flow (the links of the flow in use, a shared one resolved at the venue), flows [{ id, name, shared, station_ids (the stations its links send dishes to, in station order) }], active_flow_id, flow_switched_at / flow_switched_by, the device\'s settings, courses, venue name and time zone. No staff, PINs or menus. version changes with any of them, so a switch reaches every screen through pos.config.'],
                ['PUT /pos-api/kitchen/flow', '{ flow_id } from a kds device\'s flow button: switchFlow() with the screen\'s name as switched_by; returns { flow_id, name, switched_at, switched_by, changed } (changed false: already in use). 403 for any other device kind or a screen with can_switch_flow false (read fresh from pos_devices), 404 for a flow not at its venue. Broadcasts pos.config. Online only (the screen says so offline).'],
                ['GET /pos-api/kitchen/sync?since=', 'Kitchen orders changed since a seq (reset with every live order when far behind) and server_time for the screen\'s clock.'],
                ['POST /pos-api/events', 'Takes kitchen events from kds devices (server-only types refused). The answer has kitchen (orders touched). Broadcasts pos.seq with kinds [checks | kitchen] (tills skip kitchen-only changes) and kitchen.board to screens:<venue>.'],
                ['/api/pos/venues/:id/kds-stations, /kds-stations/:id, .../kds-stations/order', 'Stations (pos_setup manage). Turning a station into a board drops its links onward and takes it off kitchen screens; a kitchen screen can\'t show a board (422).'],
                ['PUT /api/pos/kds-flows/:id', '{ links: [{ from, to, targets, exclude }], layout, off_station_ids } replaces one flow\'s links, layout and the stations it leaves out (182; no list = none out; a link touching one is 422) (pos_setup manage). 422 with the first flowProblems() message (links name the flow\'s venue\'s stations); dish / section / revenue stream / order type ids must be the tenant\'s; layout keys that aren\'t start or a station are dropped. Returns { id, links, layout, off_station_ids, warnings }. Device filters name the venue\'s tills and kiosks. A shared flow takes { boxes, links, layout } instead (box ids are uuids, boxProblems() and flowProblems() on the boxes, links only between boxes, stream and device filters by name, menu ids checked) and returns { id, shared, boxes, links, layout, warnings }, warnings including each location that lacks a box\'s station or has one of another kind; it broadcasts pos.config to every venue. GET /api/pos/venues/:id/setup returns kds_flows (own then shared: [{ id, name, sort_order, layout, shared, off_station_ids, links, boxes? }]), kds_active_flow_id, kds_flow_switched_at / _by, kds_locations [{ id, name, active_flow_id, stations }] (every venue, for matching boxes) and kds_shared_names { revenue_stream, device } (every active name, once). Deleting a revenue centre takes it out of every filter of every own flow (a link left with no filter goes; an Except link left with none becomes a link for every dish); shared flows name streams, so nothing to drop. exclude without targets is saved as false; an Except link can\'t name every dish (default) and links out of a Splitter can\'t be Except (they take no filter).'],
                ['POST /api/pos/venues/:id/kds-flows', '{ name, copy_from?, shared? } a new flow at the end of its list: empty, or a copy of copy_from (one of this venue\'s flows or a shared one, else 404). shared true makes it shared (pinActiveFlows() first). Copies go either way: own to shared with shareFlow(); shared to own with resolveSharedFlow() (links whose stream / till filters all name nothing here are dropped, unmatched stations go to off_station_ids, the layout follows the matches). 422 when the name is taken.'],
                ['PATCH / DELETE /api/pos/kds-flows/:id', 'Rename ({ name }, 422 when taken); delete (422 for the flow in use: put another in use first; takes the till lock so it can\'t race a switch). A shared flow: 422 "in use at X" while any venue has it in use (after pinActiveFlows()); both broadcast to every venue.'],
                ['PUT /api/pos/kds-flows/shared/order', '{ ids } the shared flows\' order, the same at every location (pos_setup manage; pinActiveFlows() first).'],
                ['PUT /api/pos/venues/:id/kds-flows/order, .../kds-flows/active', 'order: { ids } sort order (keeps the flow in use in use, writing its id down if it was only "the first"); active: { flow_id } switchFlow() with the person\'s email as switched_by. Both pos_setup manage; both broadcast pos.config.'],
                ['GET /api/pos/venues/:id/kitchen-report[.csv]?from=&to=', 'Per station: tickets, items, average, median, p90, max, on time (within target_mins), late; by hour; remakes. CSV: every bump and remake (pos_reports view).'],
                ['POST /api/pos/venues/:id/kitchen-test', 'A signed link to the kitchen test bench (pos_setup view): { token, url } (8 hours). See The kitchen test bench below.'],
                ['GET /pos-api/kitchen-test?token=', 'The bench\'s data (kitchenTestData()): stations, courses, order types, flows with their links, kitchen screens, tables, revenue streams, the live menus\' dishes (no prices) and expires_at. 401 for a bad, run out or other-kind link; 404 when the link\'s venue isn\'t its tenant\'s. Reads only.'],
                ['GET /screen-api/orders', 'boardFor(): { preparing, ready } for every counter and online order, and boards: { [board station name, lower case]: { preparing, ready } } per order ready board, for the Order status block (opts.board picks one by name; screens with one get needs_orders in their config, poll every 15 s and refetch on kitchen.board).'],
              ]}
            />
            <H3>Online orders</H3>
            <P>
              <Mono>orderSvc.js</Mono> calls <Mono>kitchenOnOnlineOrder()</Mono> (<Mono>services/kitchenSvc.js</Mono>)
              after an order is placed or changes status. Accepted (or auto-accepted) orders go in through{' '}
              <Mono>submitServerEvent('kitchen.order_in')</Mono> with <Mono>onlineSnapshot()</Mono> (items routed
              like till dishes; <Mono>fire_at</Mono> = collection time minus the ordering lead time for later
              orders); ready / completed / rejected / cancelled on the orders board follow as{' '}
              <Mono>kitchen.order_status</Mono>. The other way, a pass bump or collect calls{' '}
              <Mono>changeStatus()</Mono> (actor "Kitchen screen &lt;name&gt;") when{' '}
              <Mono>kds_online_ready</Mono> is on, so the guest gets the ready email.
            </P>
            <H3>GloriaFood orders (migration 178)</H3>
            <P>
              <Mono>kitchenOnGloriaFood(tenantId, venueId, ids)</Mono> (<Mono>services/kitchenSvc.js</Mono>) runs
              after <Mono>gloriafood_orders</Mono> rows are stored or updated (<Mono>ingestWithTx()</Mono> returns
              their <Mono>ids</Mono>; <Mono>ingestOrders()</Mono> and <Mono>pollVenue()</Mono> call it once the
              transaction has committed, not awaited, since GloriaFood wants its answer within 15 s) and after{' '}
              <Mono>POST /api/orders/gloriafood/:id/status</Mono>. It holds an advisory lock per venue
              (<Mono>gf-kitchen:&lt;venue&gt;</Mono>) while it reads the rows and submits, so an order and its
              cancellation pushed together land in that order; the rows are read fresh by id, never taken from
              the push. For a row not yet in the kitchen: only when <Mono>kds_gloriafood</Mono> is on, the
              status is accepted, the board status isn&apos;t ready / completed, the order isn&apos;t imported
              (<Mono>received_via = 'import'</Mono>) and its fulfil (or accepted) time is less than two hours
              past, <Mono>kitchen.order_in</Mono> with <Mono>gloriaFoodSnapshot()</Mono>: id{' '}
              <Mono>gf-&lt;uuid&gt;</Mono>, number = GloriaFood&apos;s order id, guest first name, table number,
              type from <Mono>gloriaFoodTypes()</Mono> (type_name = our type&apos;s name, else GloriaFood&apos;s
              label), note = instructions (test orders, <Mono>source = 'admin'</Mono>, get &quot;GloriaFood test
              order&quot;), <Mono>fire_at</Mono> = fulfil time minus <Mono>kds_gloriafood_lead_mins</Mono> for{' '}
              <Mono>for_later</Mono> orders. Dishes keep GloriaFood&apos;s options (&quot;2 x Extra egg&quot;)
              and are matched by name to the venue&apos;s live menus (<Mono>dishMatcher()</Mono>: lower case,
              spaces collapsed, first match wins), which gives them <Mono>item_id</Mono> / <Mono>section_id</Mono>{' '}
              for the flow&apos;s dish and section links and the menu&apos;s name (kitchen name if set); no match
              routes by order type and default links. For a row already in the kitchen:{' '}
              <Mono>kitchen.order_status</Mono> cancelled (status canceled in GloriaFood), ready (board ready) or
              collected (board completed). The other way, <Mono>onlineMoves()</Mono> returns GloriaFood moves too
              and <Mono>afterKitchen()</Mono> in <Mono>posApi.js</Mono> sets <Mono>board_status</Mono> ready (from
              accepted / preparing) or completed, <Mono>board_status_by</Mono> &quot;Kitchen screen &lt;name&gt;&quot;,
              and broadcasts <Mono>order.updated</Mono> (source gloriafood) when <Mono>kds_online_ready</Mono> is
              on. GloriaFood itself is never told. A change to an order&apos;s dishes after it reached the kitchen
              isn&apos;t copied. Store tech: <Mono>GET .../setup</Mono> returns <Mono>gloriafood</Mono>{' '}
              (<Mono>{'{ show_on_board, types }'}</Mono>, null without a link); the PATCH checks type ids are the
              tenant&apos;s (422). Tests: <Mono>api/test/gloriafood-kitchen.test.mjs</Mono>.
            </P>
            <H3>The screen</H3>
            <P>
              <Mono>pos/src/kitchen/store.js</Mono> keeps confirmed kitchen orders (last sync), an IndexedDB
              outbox of this screen's taps, and shows confirmed + outbox applied with{' '}
              <Mono>applyKitchenEvent()</Mono>, like the till's store. It syncs over the socket and a poll,
              keeps a clock offset from <Mono>server_time</Mono> for the timers, and goes through{' '}
              <Mono>lib/transport.js</Mono> (hub first when one is set). <Mono>kitchenCfg()</Mono> /{' '}
              <Mono>useCfg()</Mono> give the shared rules the stations and flow. <Mono>KitchenApp.jsx</Mono>:
              tickets in columns (<Mono>stationTickets(orders, station, now, cfg)</Mono>: each item with state,
              where (stations it is at now), from, next, and per ticket elsewhere = dishes going through another
              expo or runner), BUMP / READY (expo) / DONE (runner), the Ready panel at expos and runners
              (<Mono>readyOrders()</Mono>), the On order counts
              (<Mono>onOrderCounts()</Mono>), speed figures (<Mono>stationStats()</Mono>), Prev / bring back
              (<Mono>recentBumps()</Mono>), orders for later (<Mono>laterOrders()</Mono>), bump bar keys, wake
              lock and full screen.
            </P>
            <InfoBox type="info">
              Offline between the till and the kitchen needs the venue hub: a web app can't accept connections
              or find other devices on the LAN, so two tablets can't talk to each other without a server they
              both reach. With the hub, tills and kitchen screens point at it (<Mono>hub_url</Mono>) and it runs
              the same sequencer and kitchen rules. Admin: <Mono>components/pos/KitchenSection.jsx</Mono> (Till
              setup → Kitchen screens: stations, screens, online and GloriaFood orders (<Mono>OnlineCard</Mono>); <Mono>StationModal</Mono>),{' '}
              <Mono>components/pos/KitchenFlow.jsx</Mono> (the flow designer), Kitchen tab in{' '}
              <Mono>pages/PosReports.jsx</Mono>, Order status block in <Mono>shared/screenLayout.js</Mono> +{' '}
              <Mono>ScreenDesigner.jsx</Mono>.
            </InfoBox>
            <H3>Flow designer</H3>
            <P>
              <Mono>KitchenFlow.jsx</Mono>: a scrolling canvas of boxes (<Mono>[data-node]</Mono>, Orders in +
              every station) and links (SVG curves with a label button at the middle, above the boxes). Drag a
              box by its grip (pointer events with capture; the canvas scrolls when dragging near its edge),
              drag its dot onto another box (<Mono>elementFromPoint</Mono> on release) or tap the dot then the
              box. The panel edits a link's filter (the tenant's order types, revenue streams, a section / dish search)
              and its Only these / All except these switch (<Mono>exclude</Mono>; Except labels are red and read
              Except ..., <Mono>data-except</Mono>), shows a box's links, or <Mono>Check a dish</Mono> (<Mono>itemRoute()</Mono> on the draft, its
              links and boxes highlighted). <Mono>placeMissing()</Mono> gives boxes without a saved place their{' '}
              <Mono>tidyLayout()</Mono> place (columns by the longest way from Orders in, else by kind) so boxes
              never jump; a flow with no saved layout re-tidies as links change until a box is moved by hand.
              Explicit Save flow / Discard, problems block Save, Full screen (Escape leaves). View only: no
              grips, dots or Save; links and boxes still open their panels.
            </P>
            <H3>Order status block</H3>
            <P>
              <Mono>orderStatusHtml()</Mono> in <Mono>shared/screenLayout.js</Mono>. Options: <Mono>board</Mono>{' '}
              (a board station's name; <Mono>orderBoardData()</Mono>), <Mono>tile_main</Mono> number | tent |
              table | name and <Mono>tile_lines</Mono> (any of number, tent, table, name, type, source; what each
              tile shows, migration 189 turned the old <Mono>show_names</Mono> into <Mono>tile_lines</Mono>{' '}
              [&apos;name&apos;]), <Mono>layout</Mono> side | stacked,{' '}
              <Mono>ready_first</Mono>, <Mono>preparing_bg</Mono>, <Mono>change_anim</Mono> none | float | fade
              | pop | zoom (<Mono>ORDER_CHANGE_ANIMS</Mono>) and <Mono>change_ms</Mono>. The player keeps the
              changes between fetches (<Mono>orderChanges()</Mono>: numbers in and out of each column, per
              board, kept for <Mono>ORDER_CHANGE_KEEP_MS</Mono> by <Mono>keepOrderChanges()</Mono>) and passes
              them as <Mono>orders.changes</Mono>; the block draws numbers coming in with{' '}
              <Mono>sl-och-in</Mono> and numbers going out in their old place with <Mono>sl-och-out</Mono>, a
              negative animation-delay keeping a redraw mid-animation in step, then draws plain once it is over.
              The designer's Play shows an example change.
            </P>
            <P>
              A tile is drawn by <Mono>orderInfo(order, {'{ main, lines }'})</Mono> in{' '}
              <Mono>shared/orderInfo.js</Mono> (also loaded by the player from <Mono>/lib/orderInfo.js</Mono>):
              the big value (the chosen field, else the first of number, tent, table, name the order has; the
              tile&apos;s <Mono>data-main</Mono> says which), a caption over a tent or table (<Mono>sl-ocap</Mono>),
              then the lines that have a value, never the big one again (<Mono>sl-oline</Mono>, Order 57 / Tent
              12 / Table 4 / the name / the order type / Online or GloriaFood). A name as the big value is drawn
              smaller. The numbers come from <Mono>boardNumbers()</Mono> in <Mono>shared/pos/kitchen.js</Mono>,
              whose entries carry <Mono>number, name</Mono> (online guest, else the till or kiosk name),{' '}
              <Mono>tent, table, type_name, source</Mono>. <Mono>normaliseOrderInfo()</Mono> tidies a saved
              choice; the designer&apos;s Each tile section (<Mono>TileSection</Mono> in{' '}
              <Mono>ScreenDesigner.jsx</Mono>) keeps lines in field order.
            </P>
            <P>
              How tiles look (<Mono>TileLook</Mono> in <Mono>ScreenDesigner.jsx</Mono>, the Tile look section) is
              stored on the block as <Mono>tile_*</Mono> options: <Mono>tile_font</Mono> / <Mono>tile_line_font</Mono>
              (a font role or a listed font; added to <Mono>boardFonts()</Mono>), <Mono>tile_weight</Mono>,{' '}
              <Mono>tile_italic</Mono>, <Mono>tile_upper</Mono>, <Mono>tile_shape</Mono> (<Mono>TILE_SHAPES</Mono>:
              rounded with <Mono>tile_radius</Mono> px, square, pill, circle), <Mono>tile_padding</Mono> (% of the
              number size), <Mono>tile_border_width</Mono> / <Mono>tile_border_color</Mono>, <Mono>tile_shadow</Mono>{' '}
              (<Mono>TILE_SHADOWS</Mono>), <Mono>tile_ready_image</Mono> / <Mono>tile_prep_image</Mono> with{' '}
              <Mono>tile_image_fit</Mono> and <Mono>tile_image_dim</Mono> (a dark layer, <Mono>::before</Mono>), and small
              pictures: <Mono>tile_icon</Mono>, <Mono>tile_type_icons</Mono> (order type name to picture, matched in any
              case; <Mono>tileIcon()</Mono>), <Mono>tile_icon_pos</Mono> (<Mono>TILE_ICON_POSITIONS</Mono>) and{' '}
              <Mono>tile_icon_size</Mono>. <Mono>tileLook()</Mono> in <Mono>shared/screenLayout.js</Mono> turns them into
              custom properties on <Mono>.sl-orders</Mono> (<Mono>--otf</Mono>, <Mono>--otr</Mono>, <Mono>--orimg</Mono>,
              <Mono>--ordim</Mono>, <Mono>--otis</Mono> ...), so a tile is one CSS rule set; each tile wraps its words in{' '}
              <Mono>.sl-otext</Mono> beside an optional <Mono>img.sl-oicon</Mono> (<Mono>data-icon</Mono> on the tile).
              <Mono>tileImageUrls()</Mono> adds the pictures to <Mono>boardImageUrls()</Mono>, so screens load them before
              showing the board and keep them offline.
            </P>
            <P>
              Statuses on tiles: <Mono>shownStatus(o, status)</Mono> merges an entry&apos;s <Mono>status</Mono> with the
              block&apos;s <Mono>status_looks[name]</Mono> (any case; <Mono>hide</Mono>, <Mono>look</Mono>,{' '}
              <Mono>colour</Mono>, <Mono>text</Mono>, <Mono>anim</Mono>, <Mono>lamp</Mono>) unless <Mono>show_status</Mono> is
              false; <Mono>statusHtml()</Mono> draws words inside <Mono>.sl-otext</Mono> and the flag, border, traffic
              light, square and dot over the tile, each a <Mono>.sl-ostat</Mono> with <Mono>--osc</Mono> and{' '}
              <Mono>sl-osa-*</Mono> movement that runs only under <Mono>.sl-board.sl-play</Mono>. With no live orders
              (the designer) the example numbers take <Mono>ctx.statuses</Mono> (designer data) in turn.
              Admin: <Mono>StatusSection</Mono> in <Mono>ScreenDesigner.jsx</Mono>; the Setter&apos;s own look in{' '}
              <Mono>StationModal</Mono> (<Mono>KitchenSection.jsx</Mono>).
            </P>
            <H3>The kitchen test bench</H3>
            <P>
              Store tech → Kitchen screens → Test the kitchen (<Mono>TestCard</Mono> in{' '}
              <Mono>KitchenSection.jsx</Mono>, a <Mono>div role=&quot;button&quot;</Mono> so it works in the View
              only fieldset) calls <Mono>POST /api/pos/venues/:venueId/kitchen-test</Mono> (pos_setup view) for a
              signed link and opens <Mono>pos.&lt;domain&gt;/?kitchen_test=&lt;token&gt;</Mono> in a new window
              (opened blank before the request, so pop-up blockers allow it). Links come from{' '}
              <Mono>services/previewLinks.js</Mono> (<Mono>makeLink(kind, data, hours)</Mono> /{' '}
              <Mono>readLink(kind, token)</Mono>, HMAC-SHA256 with the sealed <Mono>kiosk_preview_key</Mono> in{' '}
              <Mono>platform_secrets</Mono>), shared with kiosk previews; a link carries its kind, so a kiosk
              preview link never opens the bench and back. Kitchen links last 8 hours.{' '}
              <Mono>GET /pos-api/kitchen-test?token=</Mono> (rate limited, no device) returns{' '}
              <Mono>kitchenTestData()</Mono> (<Mono>services/kitchenSvc.js</Mono>): the kitchen screen config
              (stations, courses, order types), every flow with its links, the venue&apos;s kitchen screens,
              tables, revenue streams and the live menus&apos; dishes (no prices). It only reads.
            </P>
            <P>
              The page (<Mono>pos/src/kitchen/Bench.jsx</Mono>) runs a pretend kitchen in the browser:{' '}
              <Mono>createBench(data)</Mono> in <Mono>shared/pos/kitchenBench.js</Mono> stands in for the
              sequencer and <Mono>/pos-api</Mono> with the same rules (<Mono>kitchenForCheckEvent()</Mono> for
              test till orders as <Mono>lines.sent</Mono> / <Mono>course.fired</Mono> / <Mono>line.voided</Mono>,{' '}
              <Mono>applyKitchenEvent()</Mono> for <Mono>kitchen.order_in</Mono> online orders and the
              screens&apos; taps), its own sequence numbers, sync with reset after Clear all, an activity log, and
              its own flow in use (<Mono>switchFlow()</Mono>, refusing screens with{' '}
              <Mono>can_switch_flow: false</Mono>). Test orders are made with <Mono>sendOrder(spec)</Mono> (spec <Mono>tent</Mono>{' '}
              on counter till orders, <Mono>name</Mono> as the till name or the online guest) or made up by{' '}
              <Mono>randomSpec()</Mono> (some counter orders get a tent); a combo&apos;s parts come from{' '}
              <Mono>randomComboParts()</Mono> (<Mono>resolveSteps()</Mono>). Each screen is the real kitchen app
              in a same-origin frame (<Mono>?kitchen_test=&amp;screen=&lt;id&gt;</Mono>,{' '}
              <Mono>BenchScreen.jsx</Mono>), scaled with a CSS transform from a fixed size (tablet 1280 x 800,
              TV 1920 x 1080, upright 800 x 1280). It gets <Mono>window.parent.kdsBench.connect(screenId)</Mono>:
              a transport answering <Mono>GET /pos-api/config</Mono>, <Mono>GET /pos-api/kitchen/sync</Mono>,{' '}
              <Mono>POST /pos-api/events</Mono> and <Mono>PUT /pos-api/kitchen/flow</Mono> from the bench, and{' '}
              <Mono>subscribe()</Mono> in place of the socket (<Mono>pos.seq</Mono>, <Mono>pos.config</Mono>).{' '}
              <Mono>bootKitchen(device, benchLink)</Mono> in <Mono>pos/src/kitchen/store.js</Mono> switches the
              store to bench mode: no IndexedDB (<Mono>keep</Mono>), its choices in <Mono>sessionStorage</Mono>{' '}
              (<Mono>maca_kds_bench_&lt;id&gt;</Mono>), no forgetting the device on a 401, so a test never
              touches a real kitchen screen&apos;s data on the same browser. Online / Offline per screen makes its
              transport throw an offline error and fires <Mono>offline</Mono> / <Mono>online</Mono> in its
              frame, so taps wait in the screen&apos;s outbox as they would on Wi-Fi.
            </P>
          </section>

          {/* ── SELF-ORDER KIOSKS ────────────────────────────── */}
          <section id="kiosks" data-doc="">
            <H2>Self-order kiosks</H2>
            <P>
              Migration 172. Design in <Mono>docs/POS.md</Mono> section 10. A kiosk is a till device of kind{' '}
              <Mono>kiosk</Mono> (<Mono>pos_devices</Mono>, short code KS1, KS2 ...), linked by the code it shows
              like a till. The same app at <Mono>pos.&lt;domain&gt;</Mono> boots{' '}
              <Mono>pos/src/kiosk/KioskApp.jsx</Mono> (lazy) when the device's kind is <Mono>kiosk</Mono>, or with{' '}
              <Mono>?kiosk_preview=&lt;signed link&gt;</Mono> for the design editor's preview. A kiosk order is a
              counter check made from the till's own events, so it reaches the Counter list, the kitchen, Till
              reports and Cash Recon with no special case; the kiosk is its server (<Mono>server_id</Mono> = the
              device id).
            </P>
            <H3>Orders: the till's events, the kiosk rules</H3>
            <P>
              <Mono>shared/kiosk.js</Mono> is the one place for what the kiosk app, the API and the admin share.{' '}
              <Mono>kioskOrder(config, basket, opts)</Mono> turns a basket into events, checked with{' '}
              <Mono>replay()</Mono> (the sequencer's rules): <Mono>check.opened</Mono> (counter, the kiosk's
              stream, the order type, <Mono>tab_name</Mono>, <Mono>tent</Mono>, the kiosk's own <Mono>number</Mono> and <Mono>order_no</Mono>), one{' '}
              <Mono>line.added</Mono> per entry (<Mono>kioskLine()</Mono>: <Mono>priceItem()</Mono> and{' '}
              <Mono>posTax()</Mono>), <Mono>promotions.set</Mono> when <Mono>checkOffers()</Mono>{' '}
              (<Mono>shared/pos/offers.js</Mono>: automatic combos and automatic till promotions) finds any, then
              for a card payment <Mono>payment.added</Mono> (<Mono>card_external</Mono>, the whole total),{' '}
              <Mono>lines.sent</Mono> and <Mono>check.closed</Mono>; for pay at the counter{' '}
              <Mono>lines.sent</Mono> only when <Mono>checkout.send_counter</Mono> is on (else staff send it when
              they take payment).
            </P>
            <P>
              The sequencer knows each kiosk as <Mono>kioskStaff(device)</Mono>{' '}
              (<Mono>{'{ kiosk: true, permissions: {} }'}</Mono>, in <Mono>staffById</Mono> next to the staff,{' '}
              <Mono>services/posSvc.js</Mono>). <Mono>kioskProblem()</Mono> in <Mono>shared/pos/checks.js</Mono>{' '}
              refuses (code <Mono>kiosk</Mono>) anything but <Mono>KIOSK_EVENTS</Mono>, approvals, events sent by
              another device in the kiosk's name, table orders, other servers' checks, lines not from the menu
              (price override, open item) and payments other than <Mono>card_external</Mono> without tip or
              tendered cash.
            </P>
            <H3>API</H3>
            <DataTable
              head={['Route', 'What it does']}
              rows={[
                ['GET /pos-api/config (kiosk)', 'kioskConfig() in services/kioskSvc.js: venue, settings, the kiosk\'s stream and its order types (ask_name / ask_tent), all order types, tax rates, menus / items / section_items (tillMenuData guest view: a section\'s item_ids leave out dishes isPriced() in shared/orderPricing.js says can\'t be priced, as online ordering does; they stay in items and section_items for combos), option groups with their kiosk fields, guest-visible dietary tags, the allergen notice, automatic till promotions, the design (normalised), translations for the design\'s languages, the device. No staff, no PINs. version = a hash of it; then sold_out and the prices stamp (liveFields(), not in the version, also in an unchanged reply; GET /pos-api/live sends just those).'],
                ['Kiosk device routes', 'A kiosk may only call GET /pos-api/me, GET /pos-api/config, GET /pos-api/live, POST /pos-api/events, its card machine routes, POST /pos-api/kiosk/journeys and POST /pos-api/kiosk/receipts (KIOSK_ROUTES); anything else is 403 code kiosk.'],
                ['POST /pos-api/kiosk/receipts', 'Kiosks only (migration 209, services/receiptSvc.js kioskReceipt()). { check_id, email? }: the order must be one this kiosk placed at its venue (pos_checks.server_id = the kiosk, else 404). Makes the order\'s pos_receipts row once (token: 24 random bytes, base64url) -> { url (deviceOrigin(\'kiosk\') + /receipt/<token>), sent_to }. With email (isEmail() in shared/kiosk.js, else 400): 422 for a void check, 429 after MAX_EMAILS (3), counted before sending. A paid check: the receipt goes through the venue\'s provider (emailCredentials()) after the transaction, the kiosk waiting; 422 when the provider refuses; only emailHint() (first letter and domain) and emailed_at are stored; sent_to is the hint. An open check (to pay at the counter, migration 210): the address is kept sealed until the till takes payment (sendWaitingReceipts()), -> will_send_to (the hint), sent_to null. 60 a minute.'],
                ['GET /receipt/:token', 'No login, device hosts only (pos., kitchen., kiosk.; else 404), served by routes/posSite.js (\'/receipt/\' in PASS_PREFIXES; the pos app\'s service worker leaves it to the network). receiptPage(): the token found in system mode (rows under 400 days), then the check in its tenant, drawn with billOps() in the kiosk receipt design (printConfig().layouts.kiosk_receipt) and previewHtml() at DEFAULT_COLS; an open check is a bill with a Not paid yet note. Cache-Control no-store, Referrer-Policy no-referrer, X-Robots-Tag noindex, a CSP of its own. Counts views. 120 a minute.'],
                ['GET /pos-api/kiosk-preview?token=', 'The preview\'s config: kioskConfig() with previewDevice() (the editor\'s stream and design, the test card reader) and the token\'s menu version (m: \'draft\' = the menus with changes not published yet; menu_version in the config). The token is the key: readPreviewToken(), HMAC with platform_secrets kiosk_preview_key, 12 hours.'],
                ['GET /api/pos/kiosk-designs', 'pos_setup view. Normalised settings.'],
                ['POST /api/pos/kiosk-designs', 'pos_setup manage. { name, settings, copy_from? } (copy_from: another design of the tenant). Up to 50 per tenant. The design editor\'s Save as sends the editor\'s normalised draft as settings (unsaved changes included); the new row has no share.'],
                ['PUT /api/pos/kiosk-designs/:id', 'pos_setup manage. { name, settings }, stored as ownDesign(settings) (services/kioskSvc.js: normaliseDesign(), then only the tenant\'s own sections (left off, section tiles, banner and tile links), dishes (links, "Anything else?") and order types (type buttons) are kept; another tenant\'s ids are dropped, a link becomes none). POST does the same. Broadcasts pos.config to every venue with a kiosk (kiosksChanged()).'],
                ['DELETE /api/pos/kiosk-designs/:id', 'pos_setup manage. Refused (422, names the kiosks) while a kiosk picks it.'],
                ['POST /api/pos/kiosk-designs/:id/preview', 'pos_setup view. { venue_id, revenue_stream_id?, menu? \'live\' | \'draft\' } (both the tenant\'s, the stream at that venue) -> { token, url (deviceOrigin(\'kiosk\') + ?kiosk_preview=), menu, menus_changed [{ id, name }], unpriced [{ id, name, menu }] } (menuChanges() in services/kioskSvc.js: the menus this preview shows, published or draft, whose draft differs from what is published, contentKey() from shared/menuDiff.js; unpricedDishes(): the dishes the kiosk leaves off for having no price, shown above the editor\'s preview as kd-unpriced).'],
                ['PUT /api/pos/kiosk-designs/:id/share', 'pos_setup manage. Migrations 187, 188: a lasting link for people outside the group. { venue_id, revenue_stream_id?, menu? \'live\' | \'draft\' (kiosk_designs.share_menu, absent = live), expires_on? } (the tenant\'s venue, a stream at it, a date after today). Makes the token once (24 random bytes, base64url, kiosk_designs.share_token, unique), then only moves it. -> share { url (deviceOrigin(\'kiosk\') + ?kiosk_share=), venue_id, revenue_stream_id, menu, expires_at, expired, views, last_viewed_at, created_at, created_by }. GET /kiosk-designs carries share on each design; the setup snapshot carries shared.'],
                ['POST /api/pos/kiosk-designs/:id/share/new-link', 'pos_setup manage. A new token (the old link stops), views back to 0. 422 when not shared.'],
                ['DELETE /api/pos/kiosk-designs/:id/share', 'pos_setup manage. Clears every share column.'],
                ['GET /pos-api/kiosk-share?token=', 'No login: the token is the key, looked up in system mode, then kioskConfig() in the design\'s tenant with previewDevice() (the share\'s stream, the test card reader) and the share\'s menu version, plus share { design, venue, company, expires_at, menu }. 404 when unknown or the venue is gone, 410 when past its end. Counts the view.'],
                ['GET /api/menus/translations?lang=', 'menus view. lang optional (the first kiosk language besides the menu\'s own). -> { lang, source, designs, languages [{ code, name, on_a_kiosk }], sources [{ key, group, context, text }], texts, builtin (the kiosk\'s own words and standard allergen names in that language), ai }.'],
                ['PUT /api/menus/translations', 'menus manage. { lang, texts: { key: text | \'\' } }: upserts, \'\' deletes; keys must match KEY_PATTERN. -> { saved, removed }.'],
                ['POST /api/menus/translations/ai', 'menus manage. { lang, source, keys?, skip? } -> { texts, left }: Claude\'s suggestions for words without a translation, AI_BATCH (120) a call, structured output (json_schema), counted in the tenant\'s monthly AI allowance. Nothing is saved.'],
              ]}
            />
            <P>
              A kiosk itself always gets the published menu: <Mono>kioskConfig()</Mono> takes{' '}
              <Mono>menuVersion: 'draft'</Mono> only together with <Mono>preview</Mono>, and passes it to{' '}
              <Mono>tillMenuData()</Mono> / <Mono>tillMenus()</Mono> (<Mono>services/posSvc.js</Mono>,{' '}
              <Mono>loadMenuVersions(&#123; version &#125;)</Mono>). Option groups and their pictures are tenant-wide
              and live in every version, so only dish and section changes (photos, prices, names, new dishes) differ.
              The design editor's preview toolbar has <strong>Published menu</strong> / <strong>Menu with unpublished
              changes</strong> (remembered in <Mono>maca_kiosk_preview_menu</Mono>), a note naming{' '}
              <Mono>menus_changed</Mono>, and Reload (a new preview link, so the frame loads the menu again).{' '}
              <Mono>routes/posSite.js</Mono> lets a <Mono>?kiosk_preview=</Mono> page be framed by the platform's
              own hosts (<Mono>frame-ancestors</Mono>, no <Mono>X-Frame-Options</Mono>); the app's service worker
              leaves those pages to the network. Media changes need Website, Menus, Menu screens or Store tech
              manage (<Mono>routes/media.js</Mono>); kiosk pictures use scope <Mono>kiosk</Mono>. Till reports'
              checks list, check history, refused changes and day names show the kiosk's name (a{' '}
              <Mono>pos_devices</Mono> join on the server / staff id).
            </P>
            <H3>Shared preview links</H3>
            <P>
              Migration 187. Each design can have one lasting link (Share in the design editor:{' '}
              <Mono>ShareDialog</Mono> in <Mono>KioskDesigner.jsx</Mono>, with a QR code from <Mono>shared/qr.js</Mono>).{' '}
              <Mono>?kiosk_share=&lt;token&gt;</Mono> on the kiosk address opens <Mono>pos/src/kiosk/SharePage.jsx</Mono>:
              the kiosk in a frame at the design's screen size (upright or turned: <Mono>share.screen</Mono> in{' '}
              <Mono>kiosk.ready</Mono>, 1080 x 1920 until it arrives), scaled to fit, with Upright / Wide, Start again
              (postMessage <Mono>kiosk.restart</Mono> to its own origin) and Full screen (the frame's own address).
              The frame (<Mono>&amp;frame=1</Mono>) runs <Mono>KioskApp</Mono> with <Mono>shareToken</Mono>:{' '}
              <Mono>bootShare()</Mono> in <Mono>pos/src/kiosk/store.js</Mono> is <Mono>bootPreview()</Mono>'s twin
              (both <Mono>bootPreviewFrom()</Mono>) that ignores <Mono>kiosk.design</Mono> messages, so the page shows
              the design as saved, and posts <Mono>kiosk.ready</Mono> with the names (or an error) to the share page.
              Nothing is sent from either: it is a preview. Neither registers for app updates; the service worker
              leaves both to the network.
            </P>
            <P>
              The preview notice (<Mono>previewBand</Mono> in <Mono>KioskApp.jsx</Mono>): in a frame
              (<Mono>window.parent !== window</Mono>: the design editor, the share page) the kiosk shows none, since the
              page around it says orders aren't sent (the editor's toolbar line, the share page's footer). Opened in its own
              tab (Full screen, or a preview link pasted into the address bar), <Mono>.k-preview-band</Mono> (30 px,
              kiosk.css) runs along the top and <Mono>.k-root.k-has-preview-band</Mono> starts <Mono>.k-frame</Mono> (and
              the reach band, with reach on: <Mono>calc(30px + 38%)</Mono> for the frame) below it. It used to be a pill
              absolutely positioned at the top right, over the top bar's running price and language button.
            </P>
            <H3>Screens of another shape or size</H3>
            <P>
              A design is made for one screen: <Mono>design.screen</Mono> = <Mono>{'{ short, long, shape, bars }'}</Mono>{' '}
              (<Mono>normaliseDesign()</Mono>: its size upright in CSS px, 320 to 7680, swapped if given the wrong way
              round, default 1080 x 1920; <Mono>shape</Mono> <Mono>keep</Mono> | <Mono>fill</Mono>; <Mono>bars</Mono>{' '}
              <Mono>black</Mono> | <Mono>page</Mono>; presets <Mono>KIOSK_SCREENS</Mono>). Two pure rules in{' '}
              <Mono>shared/kiosk.js</Mono>, both unit-tested:
            </P>
            <DataTable
              head={['Function', 'What it gives']}
              rows={[
                ['kioskBox(w, h, screen)', 'Where the kiosk sits on a w x h window: { x, y, w, h, portrait, bars }. Portrait when h >= w (the design upright, else turned). keep and more than SHAPE_SLACK (3%) off the shape: the shape as big as fits, centred; else the whole window.'],
                ['kioskZoom(w, h, screen)', 'The page scale for a screen of w x h CSS px before any zoom: min(box / design size) for the box kioskBox() gives there, 1 within ZOOM_SLACK (10%) of the design, else rounded down to 3 decimals, between ZOOM_MIN 0.1 and ZOOM_MAX 4. The same either way round (a turned screen swaps both sides).'],
                ['screenSize(w, h, screen)', 'The design\'s size the way round a window is ({ w, h }).'],
              ]}
            />
            <P>
              The kiosk (<Mono>pos/src/kiosk/viewport.js</Mono>): <Mono>useKioskViewport(design.screen)</Mono> (a layout
              effect in <Mono>KioskApp</Mono>, top window only, once the design is known) reads <Mono>window.screen</Mono>{' '}
              and sets <Mono>meta[name=viewport]</Mono>: zoomed out{' '}
              <Mono>width=device-width, initial-scale=k, minimum-scale=k, maximum-scale=k, user-scalable=no, viewport-fit=cover</Mono>,
              zoomed in the same with <Mono>width=round(screen.width / k)</Mono> (with <Mono>device-width</Mono> the layout
              viewport would stay the screen's width, wider than what shows), at 1 the tag from <Mono>pos/index.html</Mono>.
              The browser lays the page out at the visible size / k: a 412 x 915 phone with the Full HD design is laid out
              1081 wide at 0.381; a 768 x 1024 tablet 1441 x 1921 at 0.533; an 810 x 1440 tablet 1080 x 1920 at 0.75; a
              1440 x 2560 screen 1080 x 1920 at 1.333. Never a CSS transform or zoom (vh / vw / container units, fixed
              positions and touches must match the page). A resize (turned, a folding phone opened) applies again. Every way
              out of the kiosk reloads or leaves the page, which brings the original tag back; the cleanup puts it back too.
              Computers' browsers and frames ignore the tag: there the shape is kept at the window's own size.
            </P>
            <P>
              <Mono>useKioskBox(screen, fixed)</Mono> (every window, frames included) places <Mono>.k-root</Mono>: its
              style gets <Mono>left / top / width / height</Mono> from <Mono>kioskBox(innerWidth, innerHeight)</Mono>{' '}
              (re-read on resize) and <Mono>--k-unit</Mono> (a hundredth of the box's short side), with{' '}
              <Mono>data-boxed</Mono>; with bars, a fixed <Mono>.k-bars</Mono> (<Mono>k-bars</Mono>) behind it in black or
              the design's Page colour. <Mono>.k-root</Mono> is <Mono>container-type: size</Mono>, and kiosk.css and the
              kiosk's Tailwind classes size from the box (<Mono>cqmin</Mono>, <Mono>cqh</Mono>, <Mono>cqw</Mono>; they
              used vmin / vh / vw, the window's); the root's own font size uses <Mono>--k-unit</Mono>, since container units
              on the container itself read a container outside it. Code that sizes from the screen in JS (the honeycombs'
              target size in <Mono>Menu.jsx</Mono> and <Mono>displays.jsx</Mono>) uses <Mono>boxShort()</Mono>. Pop-up
              sheets are absolute in the root, so they cover the kiosk and not the bars. <Mono>container-type</Mono> does
              not make the root the containing block for fixed elements in Chrome: the flying picture
              (<Mono>fly.js</Mono>, <Mono>position: fixed</Mono>) stays in window coordinates. Media queries on orientation
              still work: the box always has the window's orientation. The staff panel's Screen line
              (<Mono>k-staff-screen</Mono>) gives the screen's size, the design's, the zoom and where the bars are; its Card
              machine line (<Mono>k-staff-card</Mono>) names <Mono>config.card_machine</Mono>.
            </P>
            <P>
              The design editor's preview frame is the design's size (upright or turned); <Mono>Try on</Mono>{' '}
              (<Mono>kd-try-on</Mono>, <Mono>TRY_ON</Mono> in <Mono>KioskDesigner.jsx</Mono>, remembered in{' '}
              <Mono>maca_kiosk_preview_screen</Mono>) draws a frame of the window that screen would lay out (its size /{' '}
              <Mono>kioskZoom()</Mono>), in which the kiosk boxes itself, with a note (<Mono>kd-try-note</Mono>). The share
              page frames the kiosk at <Mono>share.screen</Mono> from <Mono>kiosk.ready</Mono>. A visit's{' '}
              <Mono>vp</Mono> events carry the box (<Mono>b</Mono>, below), and a replay uses it rather than working it out
              again (<Mono>useReplayBox()</Mono>), so a playback matches what the guest saw even after the design's screen
              changed.
            </P>
            <H3>Designs</H3>
            <P>
              <Mono>normaliseDesign()</Mono> fills every default and checks every value (unknown keys dropped,
              colours hex, numbers clamped, ids checked); the API stores only its output and the kiosk and the
              editor run it again. Empty words mean the kiosk's own words (<Mono>shared/kioskText.js</Mono>{' '}
              <Mono>UI_TEXT</Mono>, 140 words in 9 languages); typed words are translated under{' '}
              <Mono>{"TK.design(id, path)"}</Mono>. <Mono>designProblems(design, kiosk?)</Mono> lists what stops a
              design taking orders (no way to pay; a kiosk without a card reader and no pay at the counter).
            </P>
            <DataTable
              head={['Part', 'Fields']}
              rows={[
                ['brand', 'logo_url, colors { background, surface, text, muted, primary, primary_text, accent, accent_text, bar, bar_text, rail, rail_text }, font_heading / font_body (System or KIOSK_FONTS: the website fonts plus Oswald, Bebas Neue, Anton, Barlow Condensed, Archivo Black), radius 0-32, heading_case upper | normal. bar / bar_text / rail / rail_text (PART_COLORS) are the bottom bar\'s and the side menu\'s own colours: a colour code, else null (not set: never See-through); see Bottom bar and side menu colours below.'],
                ['layout', 'tiles (dishes: the menu, section tiles, the dish\'s photo, basket thumbs) and option_tiles (choices: option groups and combo steps; a group can have its own, groupLook()), each cards | round | oval | hexagon | plain (TILE_STYLES; plain = No frame: the picture whole and as it is, object-fit contain, no card, corners, shadow or background, for PNGs on a see-through background; a picked plain choice gets a drop-shadow glow in --k-primary, its name in that colour and the tick; option_tiles defaults to tiles when not set). hero beside | stacked (HERO_LAYOUTS: the top of a dish\'s page, Builder.jsx Hero; stacked puts the photo on top, min(64%, 560px) wide) with hero_image_align and hero_text_align left | center | right (HERO_ALIGNS, default center; on a wide screen the photo is always above the words in its own column and only hero_text_align applies there, also to a combo\'s pages, which draw the same Hero: heroTextAlign()). Hexagon dishes also give the whole kiosk the hexagon look. header (the bar along the top; default on), icon_buttons (Back and Start again as icons), option_pictures (default on; off = choices show only their words, in option_tiles\' shape; the split photo still uses the pictures), option_align left | center (OPTION_ALIGNS: a grid or honeycomb of choices and its heading). hero_backdrop (default on; data-hero-backdrop on the root: kiosk.css gives .k-hero-img and the order line\'s .k-thumb var(--k-shade), No frame ones the design\'s corners, and off clears the split photo\'s shade there too). combo_build (default on; data-combo-build on the root: a meal deal\'s picture from its picks, bundleParts() / bundleLayout() / BundlePhoto, see below). fly_to_order (default on; data-fly-to-order on the root: Add to order\'s picture flies into the order button, fly.js below). The editor sets tiles in the Menu panel, option_tiles, option_pictures and option_align in the Choices panel, and the rest in the Layout panel.'],
                ['start', 'layout split | full, media [{ id, type image | video, url, fit }] (8; fit: see Fitting pictures below), media_secs 3-30, headline, question, type_cards { [orderTypeId]: { label, icon eat_in | take_away | delivery | none, image_url } }, show_allergens'],
                ['see-through pictures', 'Not a setting: pos/src/kiosk/clear.js useClear(src) draws a picture at 48 x 48 on a canvas once per session and reports whether any pixel has alpha under 250 (another origin is loaded with crossOrigin anonymous; a picture that can\'t be read counts as opaque). Every kiosk picture of a dish, choice, section or pick goes through Pic in parts.jsx (Photo, SplitPhoto, CornerPicks, HexTile, the rail, bundle step tabs), which adds .k-clear and data-clear="1": kiosk.css then drops the picture\'s background, shows it whole (object-fit contain) and, for .k-corner-pick, drops the badge (radius, ring, clip) for a drop-shadow on the outline. Banners, featured tiles, start screen and reach media go through FitPicture (see Fitting pictures below), which uses the same check for Automatic; its inline object-fit wins over img.k-clear, so Fill crops a see-through picture when asked. The logo is left as it is.'],
                ['languages', 'source, enabled (KIOSK_LANGUAGES: en es ca fr de it pt nl pl; the source always on)'],
                ['menu', 'home, banners [{ id, image_url, title, link { kind none | item | section, id }, fit }] (10), banner_secs 3-20, banner_shape wide | short | tall | picture (BANNER_SHAPES, BANNER_RATIOS), featured [{ id, image_url, title, subtitle, size normal | wide, link, fit }] (12), rail images | text | none (RAIL_KINDS), section_tiles [{ section_id, image_url, title, size normal | wide }] (rail none: the tiles page order, deduped, 200), columns auto | 2-4, show_calories, show_descriptions, show_tags, quick_add, hidden_section_ids'],
                ['options', 'group_looks [{ group_id, display, tiles, pictures, entrance }] (option groups this design shows their own way, each part null = not set here; groupLook(), see Menus > Option group looks and types), entrance none | appear | slide | bubble | deal (CHOICE_ENTRANCES; the root\'s data-enter, a group\'s own on its choices: kiosk.css animates each grid / honeycomb / list / slider choice in turn, --k-ei from nth-child times --k-enter-step, backwards fill so the slider\'s own scale comes back, the wheel whole, off under prefers-reduced-motion; set in the Choices panel), display grid | list | slider | wheel (where a group or step has none), level_icon flame | star | dot, wheel_spin (the Spin button; default on), wheel_spin_picks (a spin stops on a choice that can be picked and picks it) (picks on the dish\'s photo are set per option group and combo step since migration 201, not in the design)'],
                ['checkout', 'pay_card, pay_counter, send_counter, counter_note, upsell, upsell_title, upsell_item_ids (8), number_kind tent | table (what the number asked for when the stream\'s ask_tent is on is called: tent_number / tent_hint and the Done screen\'s tent_done line, or table_number / table_hint; the value goes as check.tent either way), receipt off | ask | always, thanks'],
                ['done', 'The order done screen (migration 209\'s change; see The order done screen and receipts below): main auto | number | tent | name (DONE_MAIN; auto = the tent when one was typed, else the order number), lines (DONE_LINES number | tent | name | type, in order; default [number, tent]; [] is no lines), message, types [{ order_type_id, main, lines, message }] (50; each part null = as for every type; another tenant\'s order types dropped by ownDesign()), receipt_qr, receipt_email.'],
                ['behaviour', 'idle_secs 20-600, warn_secs 5-60, done_secs 5-120, reach, reach_media [{ id, type image | video, url, fit }] (up to 4: filling .k-reach-band while reach mode has slid the kiosk down, with Start.jsx Media taking turns every start.media_secs and k-reach-back at the foot; empty = the brand colour and the reach sign; pictures kept offline by configImages())'],
              ]}
            />
            <H3>The order done screen and receipts</H3>
            <P>
              What the screen after paying shows comes from three rules in <Mono>shared/kiosk.js</Mono> (unit-tested in{' '}
              <Mono>shared/test/kiosk.test.mjs</Mono>): <Mono>doneLook(design, orderTypeId)</Mono> (the type's row in{' '}
              <Mono>done.types</Mono> part by part, else <Mono>done</Mono>), <Mono>doneInfo(design, {'{ orderTypeId, number, tent, name, type }'})</Mono>{' '}
              (<Mono>{'{ main, value, lines: [{ key, value }], message }'}</Mono>: auto is the tent when one was typed,
              else the order number; a value the order hasn't got falls back to the first of number, tent, name it has;
              lines leave out the big one and empty ones) and <Mono>doneGaps(design, orderType)</Mono> (what a type's
              screen would show that its stream never asks for: <Mono>ask_name</Mono> / <Mono>ask_tent</Mono>{' '}
              <Mono>off</Mono>, <Mono>{'[{ key, big }]'}</Mono>; auto never counts). <Mono>Done</Mono> in{' '}
              <Mono>pos/src/kiosk/Checkout.jsx</Mono> draws it: <Mono>k-done-caption</Mono> (order_number, tent_number
              or table_number, order_for), <Mono>k-done-main</Mono> with <Mono>data-key</Mono>, <Mono>k-done-put</Mono>{' '}
              under a big tent (tent_put / table_put), a <Mono>k-done-line</Mono> each (order_line, tent_done / table_done,
              name_line, the type's name), <Mono>k-done-note</Mono> (paid_pending; card: none when a tent was typed,
              paid_note_name with the name big, else paid_note; counter: the design's counter note or counter_note(_sent)),{' '}
              <Mono>k-done-message</Mono> (<Mono>TK.design(id, 'done_message')</Mono> or{' '}
              <Mono>'done_message:' + typeId</Mono>). The countdown stops in a replay, for the editor's example
              (<Mono>state.doneHold</Mono>) and while the email sheet is open or sending, and starts again after.
            </P>
            <P>
              Receipts: <Mono>ReceiptQr</Mono> asks <Mono>receiptLink()</Mono> (store.js; a preview gets an example
              address and never calls the server) and draws <Mono>qrSvg()</Mono> (<Mono>k-receipt-qr</Mono>,{' '}
              <Mono>data-state</Mono> waiting | ready | failed); <Mono>EmailSheet</Mono> takes the address on{' '}
              <Mono>EmailKeyboard</Mono> (<Mono>parts.jsx</Mono>: digits, lower case, @ once, endings such as
              @gmail.com) inside <Mono>data-jprivate</Mono>, and <Mono>emailReceipt()</Mono> sends it. Neither is
              offered for an order still in the outbox (<Mono>result.pending</Mono>). Email is offered whatever the
              payment: a card order's reply has <Mono>sent_to</Mono>; a counter order's has{' '}
              <Mono>will_send_to</Mono> instead, and the screen says it goes once paid (<Mono>receipt.sent</Mono>{' '}
              = <Mono>waiting</Mono>, words <Mono>receipt_waiting</Mono>; the sheet's <Mono>receipt_email_hint_counter</Mono>).
              The visit's record (journey.js) keeps the sheet's state and the address's length
              (<Mono>receipt.mail</Mono>, <Mono>receipt.sent</Mono>, <Mono>receipt.mail_len</Mono>), never the
              address or its hint; a playback shows dots. The designer's <Mono>DonePanel</Mono> lists the preview
              stream's order types with their asks and <Mono>doneGaps()</Mono> notes (<Mono>kd-done-type</Mono>,{' '}
              <Mono>kd-done-gap</Mono>); <Mono>Show</Mono> and the toolbar's <Mono>kd-show-done</Mono> post{' '}
              <Mono>{"{ type: 'kiosk.show', screen: 'done', order_type_id }"}</Mono> to the frame, which shows an
              example order (<Mono>showDoneExample()</Mono>: Sam and tent 12 only where the type asks).
            </P>
            <P>
              <Mono>pos_receipts</Mono> (migration 209, RLS forced): one row per order whose receipt was asked for
              (<Mono>UNIQUE (tenant_id, check_id)</Mono>), its token, the kiosk, <Mono>emails</Mono>,{' '}
              <Mono>email_hint</Mono>, <Mono>emailed_at</Mono>, <Mono>views</Mono>, <Mono>last_viewed_at</Mono>. The
              page is drawn from the check as it is when opened, so a counter order paid later shows its receipt.
              The hourly AI clean-up job also runs <Mono>cleanUpReceipts()</Mono> (rows after 400 days). Tests:{' '}
              <Mono>api/test/kiosk-receipts.test.mjs</Mono> (a real kiosk order through the device routes, the page,
              a stand-in SendGrid, refusals, clean-up, counter orders paid at the till, cancelled, unpaid, refused
              by the provider, another tenant's sweep) and the receipt page in <Mono>system-paths.test.mjs</Mono>.
            </P>
            <P>
              Counter orders (migration 210): <Mono>kioskReceipt()</Mono> on an open check counts the email,
              stores the address sealed (<Mono>pos_receipts.email_to</Mono>, <Mono>seal()</Mono> in{' '}
              <Mono>services/vault.js</Mono>, in its <Mono>SEALED</Mono> list) with <Mono>email_hint</Mono> and{' '}
              <Mono>email_wanted_at</Mono>, and answers <Mono>{'{ url, sent_to: null, will_send_to }'}</Mono>; a
              later address replaces it. <Mono>sendWaitingReceipts({'{ tenantId, venueId, log }'})</Mono> runs after{' '}
              <Mono>POST /pos-api/events</Mono> whenever a changed check isn't open (not awaited) and from the
              minute hold sweep with no venue. In system mode it claims up to 25 rows whose check isn't open
              (<Mono>email_claimed_at</Mono>, <Mono>FOR UPDATE OF w SKIP LOCKED</Mono>, a claimed row waits 2
              minutes per failed try), then per row: a void check, a missing one or one with no active line
              clears it (<Mono>email_error</Mono> 'Order cancelled'); else <Mono>unseal()</Mono>, send through the
              venue's provider outside any transaction, and clear <Mono>email_to</Mono> with{' '}
              <Mono>emailed_at</Mono>. A failure counts <Mono>email_tries</Mono> and keeps the claim; at{' '}
              <Mono>MAX_TRIES</Mono> (6) the address goes. The sweep first clears addresses older than{' '}
              <Mono>WAIT_HOURS</Mono> (24, 'Not paid within a day'). A void check can't ask (422), and a direct
              send on a paid check clears any address still waiting for it. Partial index{' '}
              <Mono>pos_receipts_waiting</Mono>.
            </P>

            <H3>Bottom bar and side menu colours</H3>
            <P>
              <Mono>partColours(colors)</Mono> (<Mono>shared/kiosk.js</Mono>) is the one rule for what the bottom bar
              (every <Mono>.k-bar</Mono>: the menu, the order, details, paying, the allergens screen) and the sections
              down the side (<Mono>.k-rail</Mono> in <Mono>Menu.jsx</Mono>) are drawn in: each of{' '}
              <Mono>bar</Mono> / <Mono>bar_text</Mono> / <Mono>rail</Mono> / <Mono>rail_text</Mono> as set, else what
              it follows (<Mono>PART_FOLLOWS</Mono>): the bar follows <Mono>text</Mono> and the side menu{' '}
              <Mono>surface</Mono> (See-through when the cards are), and words not set take whichever of{' '}
              <Mono>background</Mono> and <Mono>text</Mono> has the higher contrast on their part
              (<Mono>contrast()</Mono> from <Mono>shared/themeKit.js</Mono>; a see-through part counts as the page; a
              tie keeps what each used before, Page on the bar and Text on the side menu). With nothing set it gives
              exactly the look from before these existed (bar in Text with Page words, side menu in Cards with Text
              words). <Mono>KioskApp.jsx</Mono> turns it into <Mono>--k-bar</Mono>, <Mono>--k-bar-text</Mono>,{' '}
              <Mono>--k-rail</Mono> and <Mono>--k-rail-text</Mono>; kiosk.css draws <Mono>.k-bar</Mono> and{' '}
              <Mono>.k-rail</Mono> with them, Back on a bar (<Mono>.k-bar .k-btn-back</Mono>) solid in the words colour
              with the bar colour for its words, the outlined bar buttons (<Mono>.k-btn-onbar</Mono>, the hexagon
              tint) from the words colour, and the picked section with <Mono>--k-rail-on</Mono> (12% of the Buttons
              colour on the side menu&apos;s colour). A dish&apos;s own page (<Mono>AddBar</Mono>, the combo bar) keeps
              its bar in Cards, and the top bar stays in Cards.
            </P>
            <P>
              The designer (Brand card) lists them under the main colours (<Mono>ColourPicker</Mono>{' '}
              <Mono>optional</Mono>, placeholder Same as Text / Same as Cards / Automatic, <Mono>fallback</Mono> = the
              colour in use for the colour box, Reset), warns on <Mono>PART_PAIRS</Mono> only once either colour of a
              pair is set (and on the side menu only when the design has one), and the Brand summary says own bottom
              bar / own side menu. The colour sets and <Mono>kioskBrandFromKit()</Mono> (the theme maker, Use the
              brand) don&apos;t carry them, so they follow the new colours. Not part of any menu release.
            </P>
            <H3>Fitting pictures</H3>
            <P>
              Each home page banner, featured tile, start screen picture or video and reach picture carries a{' '}
              <Mono>fit</Mono>, read by <Mono>pictureFit()</Mono> (<Mono>shared/kiosk.js</Mono>):{' '}
              <Mono>{"{ mode auto | cover | contain, focus, size, bg }"}</Mono>. <Mono>mode</Mono>{' '}
              (<Mono>PICTURE_FITS</Mono>, default auto) is cover (fill the space, cropped, <Mono>focus</Mono> kept
              in view), contain (the whole picture, <Mono>size</Mono> % of the space, placed at <Mono>focus</Mono>,
              on <Mono>bg</Mono>) or auto (contain for a picture with a see-through background, cover for anything
              else, so a design saved before this looks as it did, a see-through featured picture included).{' '}
              <Mono>focus</Mono> is one of <Mono>PICTURE_FOCUS</Mono> (the nine CSS object-position keywords, default
              center), <Mono>size</Mono> 30-100 (<Mono>PICTURE_SIZE_MIN</Mono>, default 100; only for a whole
              picture), <Mono>bg</Mono> none | surface | primary | accent | text (<Mono>PICTURE_BGS</Mono>, a design
              colour behind a whole picture; none lets the page show through).{' '}
              <Mono>fitLayout(fit, clear)</Mono> turns it into styles: <Mono>whole</Mono>, <Mono>box</Mono> (flex
              alignment for the focus), <Mono>media</Mono> (width and height as %, object-fit, object-position) and{' '}
              <Mono>bg</Mono>. <Mono>FitPicture</Mono> in <Mono>pos/src/kiosk/parts.jsx</Mono> draws it (an absolute
              box over its parent, the picture or video inside, <Mono>useClear()</Mono> for Automatic,{' '}
              <Mono>--k-surface</Mono> / <Mono>--k-primary</Mono> / <Mono>--k-accent</Mono> / <Mono>--k-text</Mono>{' '}
              behind it; <Mono>data-whole</Mono> and <Mono>data-focus</Mono> for tests). Banners, featured tiles
              (<Mono>Menu.jsx</Mono>), start screen media and the reach band (<Mono>Media</Mono> in{' '}
              <Mono>Start.jsx</Mono>, used by both) all use it; its inline object-fit beats{' '}
              <Mono>img.k-clear</Mono>&apos;s contain, so Fill crops a see-through picture when asked.
            </P>
            <P>
              <Mono>menu.banner_shape</Mono> (<Mono>BANNER_SHAPES</Mono>, default wide) sets the banner&apos;s
              width to height: <Mono>BANNER_RATIOS</Mono> wide 16/7 (as before), short 3, tall 16/9, or picture
              (each banner the ratio of its own picture, measured on load in <Mono>Banners</Mono>; wide until it
              loads). The banner keeps its <Mono>max-h-[36vh]</Mono> cap, so on a wide screen it is usually the cap
              that sets the height and the fit decides how the picture sits in the wider box. The designer
              (<Mono>KioskDesigner.jsx</Mono>) has <Mono>PictureFit</Mono> under each banner, featured tile with a
              picture, start screen and reach item (a Fit summary, <Mono>fitSummary()</Mono>, that opens the mode,
              a 3 x 3 position grid, Size and Behind it), and the Banner shape row in the Menu panel once there is a
              banner; the Menu summary names a shape other than wide. Not part of any menu release; old designs read
              as auto and wide.
            </P>
            <H3>Menus</H3>
            <P>
              <Mono>menu_variant_groups</Mono> gains <Mono>kiosk_display</Mono> (NULL = the design's),{' '}
              <Mono>scale_low</Mono> / <Mono>scale_high</Mono>; <Mono>menu_variant_options</Mono> gains{' '}
              <Mono>image_url</Mono>, <Mono>description</Mono>, <Mono>level</Mono> (0-5). Like the rest of the
              group library they change straight away, not per publish. An option's <Mono>sort_order</Mono> in
              the group body is now optional (left out = its place in the list; a default of 0 had sorted new
              groups by name). A combo step has <Mono>display</Mono>; a typed-in choice has{' '}
              <Mono>image_url</Mono> and <Mono>description</Mono> (<Mono>normaliseCombo()</Mono>,{' '}
              <Mono>stepChoices()</Mono> passes them, and a dish choice its own photo and description).{' '}
              <Mono>comboItemIds()</Mono> lists every dish a combo can hold: the kiosk shows a combo's allergens as
              the strongest level of each over all of them ("Depends on what you choose"), and the order page the
              allergens of what was picked.
            </P>
            <H3>Allergens and diets a guest picks</H3>
            <P>
              <Mono>shared/kiosk.js</Mono> holds the rules: <Mono>dishLevels()</Mono>, <Mono>mergeLevels()</Mono>,{' '}
              <Mono>itemLevels(config, item, ctx)</Mono> (moved from the kiosk store), <Mono>cleanPrefs()</Mono>,{' '}
              <Mono>prefsOn()</Mono>, <Mono>guestFit(config, item, prefs, ctx)</Mono> and{' '}
              <Mono>countFits(config, itemIds, prefs, ctx)</Mono>. <Mono>guestFit()</Mono> returns null with no
              picks, else <Mono>{'{ ok, avoid: [{ code, level }], removable, missing, some }'}</Mono>: a dish is
              judged on its own tags (contains and may contain don't suit; removable suits, with a note; a diet it
              isn't tagged with doesn't suit). A combo: its own tags, then each step with <Mono>min &gt; 0</Mono> and
              no <Mono>when</Mono> needs a choice, not sold out, that suits (a typed-in choice has no tags: fine for
              allergens, never a diet); a diet also needs such a step or the combo's own tag; its avoid list is the
              guest's allergens on any dish it can hold, and <Mono>some</Mono> is true when it suits anyway.{' '}
              <Mono>countFits()</Mono> counts the kiosk's dishes once each, sold out ones left out. The picks are
              the kiosk's state only (never sent, never stored); the menu reads them through{' '}
              <Mono>fitOf()</Mono> / <Mono>countFor()</Mono> in <Mono>store.js</Mono>. Words: <Mono>avoid_title</Mono>,{' '}
              <Mono>diet_title</Mono>, <Mono>tap_all</Mono>, <Mono>pick_prompt</Mono>, <Mono>suits_count</Mono>,{' '}
              <Mono>suits_one</Mono>, <Mono>suits_none</Mono>, <Mono>marked_note</Mono>, <Mono>see_menu</Mono>,{' '}
              <Mono>clear_all</Mono>, <Mono>marked_for_you</Mono>, <Mono>change</Mono>, <Mono>not_marked</Mono>,{' '}
              <Mono>some_choices_contain</Mono>, <Mono>check_this</Mono> in nine languages (the old free_from,
              show_all, no_dishes and allergens_intro are gone).
            </P>
            <P>
              A meal deal's picture from its picks (<Mono>design.layout.combo_build</Mono>, default on):{' '}
              <Mono>bundleParts(config, item, picks, own)</Mono> in <Mono>shared/kiosk.js</Mono> lists the parts in step
              order: every step's picks with a picture (the choice's <Mono>photo_url</Mono>, else the picked dish's photo or a
              typed-in choice's <Mono>image_url</Mono>; none = left out), then the deal's own option groups' picks where the group
              has <Mono>kiosk_pick_photo</Mono>. Sizes: the first step with a picture that isn't <Mono>pick_photo: 'corner'</Mono>{' '}
              gives <Mono>main</Mono>; corner steps and every corner pick (a picked dish's own and the deal's) <Mono>small</Mono>;
              the rest <Mono>side</Mono>. A picked dish keeps its own split picks on its picture (<Mono>pickImages()</Mono>).
              Each part's <Mono>sig</Mono> changes with its picture; at most <Mono>BUNDLE_MAX</Mono> (8); none = the deal's own
              photo. <Mono>bundleLayout(parts, bundleBox(tiles, square))</Mono> gives each part a square: mains in the middle of
              a row, sides in the order picked taking turns left then right (the first left, the second right, the third
              further left, the fourth further right) at 0.72 of the main's size, overlapping by 28% of the narrower, each
              step out <Mono>BUNDLE_DEPTH</Mono> (8% of the main) further back up and behind; smalls (0.36) in front under
              the mains, in the order picked. Across, the middle of the main(s) is the middle of the box (no main: the
              middle of the whole), so the scale comes from the wider half (<Mono>halfW</Mono>: with one side, the picture
              is as big as with one each way); top to bottom the whole is centred; all as big as fits the box
              (<Mono>bundleBox()</Mono>: the dish picture style's shape, 4:3, round 1:1,
              hexagon .866, and the share kept clear at the edges, round and oval 15%, hexagon 17%, cards 3%, No frame 0).{' '}
              <Mono>BundlePhoto</Mono> (<Mono>parts.jsx</Mono>) draws each part with <Mono>PickPhoto</Mono> keyed by its{' '}
              <Mono>sig</Mono> (cut-outs as they are with a drop shadow, photos in a small frame: <Mono>.k-bundle-pic</Mono>); with{' '}
              <Mono>seen</Mono> (a ref <Mono>ComboBuilder</Mono> keeps across its pages, sig to when first shown) a part first
              shown under 900 ms ago gets <Mono>k-bundle-new</Mono> (a pop; none with reduced motion) while the others slide
              over (a transition on left / top / width / height). Used by <Mono>HeroPhoto</Mono> on the deal's pages (a picked
              dish's options page shows that dish) and by the order line (square, no pop). On a wide screen the combo's
              picture sits in a sticky <Mono>k-combo-photo</Mono> block at the top of the side column, the hero's words under it
              (<Mono>Hero photo={'{false}'}</Mono>), and the steps rail brings the active step into the space below it, no
              further than needed, also after a pick changes the tab's size.
            </P>
            <P>
              Picks on the dish's photo (migration 201, replacing 185's on / off switch and the design's{' '}
              <Mono>options.pick_photos</Mono>): <Mono>menu_variant_groups.kiosk_pick_photo</Mono> (NULL | split |
              corner; live like the rest of the library, in <Mono>kioskConfig()</Mono>'s groups) and a combo
              step's <Mono>pick_photo</Mono> (in <Mono>menu_items.combo</Mono>, published with the menu; the Zod{' '}
              <Mono>ComboStep</Mono> takes it, <Mono>cleanCombo()</Mono> stores it only when set and the
              editor's <Mono>comboPayload()</Mono> sends it only when set, so steps without it don't read
              as changed; <Mono>normaliseCombo()</Mono> fills <Mono>null</Mono>). The migration gave groups and
              steps that had the switch on <Mono>corner</Mono> where every kiosk design of the tenant said corner,
              else <Mono>split</Mono>, rewrote release snapshots the same way (re-hashed at start) and dropped{' '}
              <Mono>pick_photos</Mono> from designs.{' '}
              <Mono>pickImages(config, item, selection)</Mono> in <Mono>shared/kiosk.js</Mono> is the one
              rule, returning <Mono>{'{ split: [src], corner: [{ src, scale }] }'}</Mono>: steps (a choice's <Mono>photo_url</Mono>, else a picked dish's photo or a typed-in choice's picture), then groups
              (the library option's <Mono>photo_url</Mono>, else its <Mono>image_url</Mono>), each into the list its group or step names, in pick order, an option once, at most <Mono>SPLIT_MAX</Mono> (6) each; both empty = the dish's photo.
              Two pictures per choice (migration 199): <Mono>image_url</Mono> is the choice's own tile (every
              display, the bundle's step tabs), <Mono>photo_url</Mono> the one on the dish's photo
              (<Mono>menu_variant_options.photo_url</Mono>, in <Mono>loadVariantGroups()</Mono>, the group POST / PATCH
              (a PATCH without it clears it, the editor always sends it), the copy route and <Mono>kioskConfig()</Mono>'s groups;
              a combo choice's <Mono>photo_url</Mono> in <Mono>menu_items.combo</Mono>, any type but section, stored only when set
              by <Mono>cleanCombo()</Mono>, <Mono>normaliseCombo()</Mono> and <Mono>comboPayload()</Mono>, passed on by{' '}
              <Mono>stepChoices()</Mono>). <Mono>configImages()</Mono> keeps both on the kiosk. Admin: <Mono>OptionPicture</Mono>{' '}
              (Tile / On dish / On meal) in <Mono>VariantGroupsManager.jsx</Mono>, used by <Mono>ComboEditor.jsx</Mono>.{' '}
              <Mono>PickPhoto</Mono> (<Mono>parts.jsx</Mono>, prop <Mono>picks</Mono>) draws both: the split ones
              as one picture in place of the photo or, two or more, with <Mono>SplitPhoto</Mono>; then the corner
              ones with <Mono>CornerPicks</Mono> on top of whatever that is (<Mono>.k-corner-main</Mono>) with the pictures small (<Mono>.k-corner-pick</Mono>, the choices' picture
              style, lined up along the bottom keeping their own shape) along its bottom right, in the middle of the bottom on a
              round, oval or hexagon photo. Their size (migration 205): <Mono>menu_variant_groups.kiosk_pick_scale</Mono>{' '}
              and a combo step's <Mono>pick_scale</Mono> (a whole % of the photo's width, 10 to 70, kept only with corner:
              the group routes null it otherwise, <Mono>cleanCombo()</Mono> and <Mono>comboPayload()</Mono> store it only when
              set; <Mono>pickScale()</Mono> and <Mono>PICK_SCALE_MIN</Mono> / <Mono>MAX</Mono> in <Mono>shared/combos.js</Mono>);
              NULL = automatic. <Mono>cornerWidths(corner)</Mono> in <Mono>shared/kiosk.js</Mono> turns them into widths along the
              strip (92% of the photo, 2% gaps): a size is scale / 0.92, automatic min(26, 92 / n - 3), and when they
              don't fit all shrink by one factor with the gaps kept. Admin: <Mono>PickScale</Mono> in{' '}
              <Mono>components/menus/shared.jsx</Mono> (Automatic / Set a size, slider, - / +, a sketch of the photo),
              under Small in the corner in <Mono>VariantGroupsManager.jsx</Mono> and each <Mono>ComboEditor.jsx</Mono> step. <Mono>SplitPhoto</Mono>: every picture covers the whole box
              (object-fit cover) and is clipped to its part with a percent <Mono>polygon()</Mono>; the tears are
              seeded jagged lines (the same for the same number of parts), the parts overlap 0.4% under a paper
              band of 0.44% to 1.45% with a drop shadow, so no gap shows. Used on the dish page's photo, a
              combo's photo (and its review page when upright) and the order line's thumbnail.
            </P>
            <P>
              <Mono>menu_translations</Mono> (tenant, lang, key, text) holds the menu's words in other languages.
              Keys come from <Mono>TK</Mono> (item / variant / section / group / option / combo step and choice /
              order type / tag / notice / design / ui) and point at stable ids, so a translation follows its dish
              through edits and publishes. <Mono>translationSources()</Mono> lists every word a kiosk can show
              (from the drafts, so a new dish can be translated before it is published).
            </P>
            <H3>The kiosk app (pos/src/kiosk)</H3>
            <DataTable
              head={['File', 'What it does']}
              rows={[
                ['store.js', 'State (section: a section id, \'home\', or \'tiles\' for the section tiles page; startOrder() opens the tiles when the design has no rail); bootKiosk() (IndexedDB kiosk_config, kiosk_outbox), bootPreview() (listens for kiosk.design, kiosk.restart, kiosk.show { screen: menu } from the parent window, then posts kiosk.ready); loadConfig() with version (fetchConfig(): true when the server answered, a 4xx counts, 5xx and no reply don\'t); the connection: link up | checking | down (state.link, state.online = not down). A dropped or failed live link, a heartbeat with no pong (a ping every 15 s on the socket, 6 s to answer; only once the server\'s connected message says heartbeat: true, answered in config/ws.js), a request with no reply or the browser\'s offline event: linkTrouble() makes two quick tries (after 1 s and 2 s more, 4 s timeout each) and only then link down (ordering paused), then keepChecking() every 5 s until linkOk(); the online event checks at once; socket pos.config reloads, pos.revoked forgets; placeOrder(); the outbox for card orders paid but not sent (sent again until accepted; the guest gets the order number at once: the kiosk numbers its own orders, takeNumbers() with tradingDay from the config\'s trading_day); textsFor() (translations, then UI_TEXT, money with narrowSymbol); allergen levels (itemLevels(): a combo is the union of its dishes).'],
                ['fly.js', 'flyToBasket(from): Add to order\'s flight. A copy of the picture (from.cloneNode(true): the dish page\'s .k-hero-img, a card\'s .k-item-img, a hexagon\'s .k-hex without its band, marks and fit badge, an upsell card\'s photo) goes into .k-root (so the root\'s picture style classes and --k-* colours still apply) as .k-fly, fixed, its place and size inline, then animates (Web Animations, FLY_MS 700) to the middle of the first visible [data-fly-target=basket] (the menu\'s View order, the order page\'s Checkout): a small lift, then faster and smaller into it (end scale about the button\'s icon), fading to 0.55; on landing it is removed and the button found again (the bar may have been drawn again) gets a scale(1.12) bounce. Returns false (no flight) without a picture, a target or animate(), with prefers-reduced-motion or the design\'s layout.fly_to_order off (data-fly-to-order on the root). Callers pass the result to addToBasket(entry, key, { flew }), which then leaves the order button\'s own k-bump (state.added) to the landing. Wired in DishBuilder and ComboBuilder (heroPicture(), not when editing: builder.key), tapItem(item, ..., { from }) for + and plain dishes in Menu.jsx (and banners / featured tiles that add a dish), and the order page\'s "Anything else?".'],
                ['photos.js', 'savePhotos(config, report): every picture the config can show (configImages() in shared/kiosk.js: logo, start pictures (not videos), every image_url / logo_url, own origin only, each once, at most MAX_SAVED_PICTURES) that the kiosk-images cache (service worker, StaleWhileRevalidate, 2000 entries, a year) doesn\'t have yet, loaded as <img> three at a time (a fetch() wouldn\'t match the picture rule); counted again from the cache after. Run after each config change, at boot and when the link comes back; previews never run it. state.photos { total, saved, busy } for the staff panel (saved null = no service worker). Then saveVideos(config, report): the design\'s videos (configVideos(): start screen and reach band, own origin, at most MAX_SAVED_VIDEOS) downloaded whole with fetch() one at a time (status 200 and a video type only, 10 minute limit) into the kiosk-videos cache; the service worker\'s video route (request.destination video, CacheFirst, rangeRequests, cacheableResponse 200, matchOptions ignoreVary) slices the Range requests a video element makes out of the saved file, and a video not saved plays from the network. Videos the design no longer plays are deleted. state.videos for the staff panel.'],
                ['KioskApp.jsx', 'The design as CSS variables (--k-*), fonts, the idle warning and restart, reach, wake lock (not in the preview), the small-screen zoom (useKioskViewport(), viewport.js), the staff panel (Screen and Card machine lines among others), screens. Root classes k-tiles-<style> (data-tiles) and k-icons drive the layout options in kiosk.css; data-option-pictures and data-option-align say how choices show (for tests; the displays read the design themselves).'],
                ['Start / Menu / Builder / OptionGroup / Checkout / Allergens', 'Start screen; menu with rail (or SectionTiles: the home page above a tile per section, the design\'s order first; a section opened from it gets Back in the order bar), home page and dish cards (ItemHex in a HexGrid for hexagons); TopBar (logo and LanguageButton, none with layout.header off: the language button moves to the bottom bar), RestartButton (Start again with its confirm sheet, after Back in the bottom bars of the menu, basket, name / table number and pay; not on the card reader or in the builder); the dish and combo builder (the Add / Continue button points at the first choice still missing; Hero: the dish page\'s top, beside or stacked with the photo SELF-aligned and the words in a k-align-<left|center|right> column, data-hero / data-image-align / data-text-align / data-item, props price (undefined = the dish\'s priceLabel(), null = none, or a node) and note (k-hero-note); a combo draws one Hero per page from its subject (a part page: the picked dish with its own pickImages() and the note ui(\'in_deal\'); else the combo with the steps\' picks), in the page upright, in the side column above the step tabs on a wide screen, and shows the running price once: the TopBar, or with the header off the combo hero\'s k-combo-price, or k-combo-head (the combo\'s name and price) above a picked dish\'s hero; a combo: the step page\'s heading is the step name right above its choices (no ruleText line; a step with max > 1 shows got/max beside it, k-step-picked), Step n of N (k-step-count, the big button\'s 1.2em / 700) beside Continue but not on the review page, and a done step\'s tab (data-picked) shows pickedOf(): its picks\' pictures (k-opt-thumb k-step-thumb, up to three, overlapping) with the names under them upright or beside them on a wide screen; a part or own-options page shows its groups\' picks the same way (groupPicks())); one option group in its display; basket, upsell, name and table number (keyboard / number pad), pay, test card reader, order number; the allergens screen (Allergens.jsx, below).'],
                ['Allergens.jsx / fit.jsx', 'The allergens screen: the allergen notice (noticeOf(config.allergen_notice), TK.notice words), TagPicks for the allergens to avoid (every allergen tag) and the diets (dietary tags some kiosk dish carries), the count from countFor() (k-fit-result, data-fits / data-total), Clear all, See the menu (go(\'menu\') when ordering, else the order type sheet, or startOrder() with one type; hidden while ordering is paused, orderingClosed() in Start.jsx). The picks are state.prefs { avoid, diet } (setPrefs(), cleared by restart()). fit.jsx: needsCheck(fit), FitMark (the yellow mark, k-fit-mark / k-fit-badge), FitNote (Contains / May contain / Some choices contain / Can be removed / Not marked, names in mark.k-fit-hl), PrefsStrip (top of the menu, Change), tagName(). Menu.jsx passes fitOf(config, item) to ItemCard / ItemHex (data-fit check | ok); Builder.jsx: AllergenLine highlights prefs.avoid, HeroFit on the dish page and a combo\'s side column, step choices carry mark / note / check for the displays (data-fit on each option).'],
                ['displays.jsx', 'GridDisplay (a compact HexGrid of HexOption when the choices\' style, layout.option_tiles, is hexagon), ListDisplay, SliderDisplay (sorted by level when a scale shows), WheelDisplay (up to 16 on the wheel, the rest in a grid below; Spin only with wheel.spin; with wheel.picks a spin turns to a random choice that can be picked and calls onTap when it stops, the card under the pointer hidden while it spins); the same props (plus wheel), so any group or step can use any. choiceLook(design, group) gives every display tiles and pictures (groupLook(): the design\'s look for the group, else the group\'s own, else layout.option_tiles / option_pictures) and center (layout.option_align === \'center\'); OptionGroup and Builder spread it into the display and centre their heading with it. Without pictures a card is a Face (name, level marks, description) above the price, round / oval / hexagon cards draw the face in that shape (.k-opt-face in kiosk.css), a hexagon grid uses HexTile words (.k-hex-words: no photo, the name in the middle), and the list, slider and wheel leave their thumbnails and photos out. Centred: the compact HexGrid takes center (justify-content), cards wrap in a centred flex row of fixed-width cards instead of the grid.'],
                ['parts.jsx / kiosk.css', 'Sheets (close on a click of the backdrop), number pad, level marks, photos; :where(.k-root) button keeps button colour inheritance at the lowest weight. BackButton: every screen\'s way back, a solid button (.k-btn-back: the text colour on a light bar, the page colour on the dark .k-bar) first in the screen\'s bottom bar; no screen has a Back at the top (the builder\'s top bar is the item name and a combo\'s price). Back and Start again put their words in .k-btn-label with aria-label (.k-icons hides the label and makes them square). SplitPhoto / PickPhoto (the split photo). HexGrid: measured width, n columns (a number or as many as fit at about target px), positions from hexLayout() in shared/kiosk.js (half-hexagon columns; every other row moved over half a hexagon, a row only moved by whole hexagons): dishes fill the width with rows of n and n - 1; compact (choices) makes two rows from three hexagons on (3 = 2 + 1, 4 = 2 + 2, 5 = 3 + 2) while they fit, else rows of n and n - 1 with the last one centred, cells at most maxCell px in fixed columns; cells w wide and w / 0.866 high with -h/4 bottom margin so rows lock together; HexTile: a clip-path hexagon (the ring in the button colour when picked) with the photo, a band of words, marks at the top and extra buttons outside the shape. Round / oval / hexagon in kiosk.css, on two root classes: .k-tiles-<style> for dishes (.k-item, .k-item-img, .k-thumb in the basket, .k-hero-img, .k-rail-img) and .k-opts-<style> for choices (.k-opt, .k-opt-img, .k-opt-thumb in the list and wheel, .k-opt-tick / .k-opt-less): no card behind, photos in a circle, ellipse or hexagon; hexagon dishes also give buttons, chips and cards hexagon ends, round buttons and badges flat hexagons, and a faint honeycomb behind the screens (a masked ::before).'],
              ]}
            />
            <P>
              A pay-at-counter order whose reply is lost keeps its events: Try again sends the very same ones,
              the server skips event ids it already has and returns the order number for the duplicate, so the
              till never gets the order twice.
            </P>
            <H3>Admin</H3>
            <P>
              Store tech → Kiosks: <Mono>components/pos/KiosksSection.jsx</Mono> (kiosks with their design,
              stream, card reader, receipt printer and problems; designs with copy / delete;{' '}
              <Mono>kioskDesign()</Mono>). Design editor: <Mono>pages/KioskDesigner.jsx</Mono>{' '}
              (<Mono>/pos/kiosks/designs/:id</Mono>): panels over the raw draft (text) and the normalised design
              (everything else), the preview frame at 1080 x 1920 or 1920 x 1080 scaled to fit, the design posted
              to the frame's own origin after <Mono>kiosk.ready</Mono>, Save / Discard / leave confirm, view only.
              Save as (<Mono>SaveAsDialog</Mono>, manage only): <Mono>POST /api/pos/kiosk-designs</Mono> with the
              typed name and the normalised draft, so the same <Mono>ownDesign()</Mono> checks and 50-design limit
              apply; <Mono>savedAs()</Mono> puts the new row into the <Mono>['kiosk-designs']</Mono> query, resets
              the save mutation and the leave confirm, and navigates to it. The editor stays mounted across the id
              change: its load effect keys on the row id (<Mono>loadedFor</Mono>), so the draft, the saved copy and
              the dirty check move to the new design, and the preview link is made again (its query key has the
              id). The original keeps its saved settings and its share.
              Panels: Brand, Layout (<Mono>LayoutPanel</Mono>: tile style, top bar, icon buttons), Start screen,
              Languages, Menu (rail with <Mono>SectionTilesList</Mono> for none: every section the kiosk shows,
              drag order, picture, words, width), Choices (display, wheel spin, level marks), Paying, Timing.
              Translations: <Mono>pages/MenuTranslations.jsx</Mono> (<Mono>/menus/translations</Mono>, nav link
              from migration 172). Option groups: <Mono>components/menus/VariantGroupsManager.jsx</Mono>; combo
              steps: <Mono>components/menus/ComboEditor.jsx</Mono> (both with a Picks on the dish's photo choice: No, Split the photo, Small in the corner); pictures in those rows:{' '}
              <Mono>components/media/PicturePick.jsx</Mono> (pick from Media or drop a file).
            </P>
          </section>

          <section id="kiosk-analytics" data-doc="">
            <H2>Kiosk analytics &amp; journeys</H2>
            <P>
              Migration 208. Each kiosk records every guest visit as a stream of events with enough in it to play the
              visit back, step by step, on the kiosk app itself; the API sums each visit up on arrival and the admin
              page (Store tech → Kiosk analytics, <Mono>/pos/kiosk-analytics</Mono>, Till reports view) reports on
              them and plays them back. The rules live once in <Mono>shared/kioskJourney.js</Mono>, used by the
              kiosk, the API and the admin.
            </P>
            <H3>The event stream</H3>
            <P>
              A visit is <Mono>{'{ id (ULID), started_at, design_id, stream_id, config_version, app_version, truncated, names, events }'}</Mono>.
              Every event has <Mono>t</Mono> (ms since the start, in order) and a kind <Mono>k</Mono>:
            </P>
            <DataTable
              head={['Kind', 'Fields', 'Meaning']}
              rows={[
                ['v', 'p (patch), d (keys removed)', 'What the kiosk shows changed: a patch of the flat view (diffView() / applyPatch()). The first v holds the whole view.'],
                ['tap', 'x, y, el, id, ref, hit', 'A touch at x, y (CSS px of the kiosk\'s viewport) on el (the element\'s aria-label or words, after the change), id (data-testid), ref (an item, section or option id). hit 1 = something answered, 0 = nothing answers there, 2 = it was disabled.'],
                ['swipe', 'x, y, x2, y2, ms, el, id', 'A drag of 24 px or more.'],
                ['scroll', 's, x, y', 'A scrolling box moved: s is its path of child indexes from .k-root (boxPath() / boxAt()), recorded at most every 150 ms.'],
                ['vp', 'w, h, b', 'The kiosk\'s viewport size (at the start and on a resize), and b: the kiosk\'s box in it, [x, y, w, h] (bars on a screen of another shape; kept inside the window by cleanVisit(), left off when broken). A replay places the kiosk by it (useReplayBox()).'],
                ['end', 'why', 'done (the order number screen), guest (Start again), timeout ("Still there?" unanswered), left (45 s untouched on the start screen), interrupted (reloaded mid-visit), preview.'],
              ]}
            />
            <P>
              The flat view (<Mono>viewOf()</Mono> in <Mono>pos/src/kiosk/journey.js</Mono>): <Mono>screen</Mono>,{' '}
              <Mono>section</Mono>, <Mono>orderType</Mono>, <Mono>lang</Mono>, <Mono>reach</Mono>, <Mono>prefs</Mono>,{' '}
              <Mono>basket</Mono> (entries with item_id, qty, selection, key), <Mono>builder</Mono>,{' '}
              <Mono>details</Mono> (the name and tent number as lengths only), <Mono>detailStep</Mono>,{' '}
              <Mono>method</Mono>, <Mono>result</Mono> (order number, provisional, pending, total, check id),{' '}
              <Mono>error</Mono>, <Mono>toast</Mono>, <Mono>link</Mono>, <Mono>value</Mono> (the basket in pence) and{' '}
              <Mono>ui:&lt;key&gt;</Mono> for what screens keep to themselves. <Mono>names</Mono> maps ids to the
              names the guest saw (dishes, sections, order types, tags, languages) so steps read in words after the
              menu changes.
            </P>
            <H3>Recording on the kiosk</H3>
            <P>
              <Mono>startJourneys()</Mono> (from <Mono>KioskApp.jsx</Mono>, never in a preview, a share link or a
              replay, and not when the design's <Mono>behaviour.record_journeys</Mono> is false) subscribes to the
              store (<Mono>subscribeKiosk()</Mono>) and records the difference after every change, plus touch, drag
              and scroll listeners on the document (capture). A visit starts at the first touch or an order starting
              and ends at <Mono>restart(why)</Mono> (the store keeps <Mono>{'ended: { why, n }'}</Mono>; every caller
              passes its reason), or after 45 s untouched on the start screen. The visit being recorded is kept in{' '}
              <Mono>localStorage</Mono> <Mono>kiosk_journey_open</Mono> so a reload sends it as interrupted;
              finished visits wait in <Mono>kiosk_journeys</Mono> (up to 40 or 2.5M characters, oldest dropped) and go
              in batches of 5 (1.5M characters) to <Mono>POST /pos-api/kiosk/journeys</Mono> a second after a visit
              finishes, 5 s after the kiosk opens and every 60 s (kept on any other failure, so an offline kiosk sends them later). A 400 or 413 drops the batch (it would be refused again). Past 6000
              events a visit keeps only its view changes (<Mono>truncated</Mono>).
            </P>
            <P>
              Screens' own state that changes what the guest sees goes through{' '}
              <Mono>useJourneyState(key, init, {'{ save, load }'})</Mono> instead of <Mono>useState</Mono>: the
              dish being built (<Mono>dish.sel</Mono>, <Mono>dish.qty</Mono>), a combo's picks, page and opened steps
              (<Mono>combo.*</Mono>), option groups (<Mono>og.&lt;item&gt;.&lt;choice&gt;.&lt;depth&gt;</Mono>), the
              Start again and language sheets, the allergens sheet, the idle warning, the card step. Privacy: the
              kiosk's keyboard and number pad carry <Mono>data-jprivate</Mono>, so a touch there is recorded at the
              keyboard's middle with el <Mono>keyboard</Mono>; nothing typed is ever in a view.
            </P>
            <H3>Storing and summing up</H3>
            <P>
              <Mono>kiosk_sessions</Mono> (primary key tenant_id + id, forced RLS): venue, device, design and
              revenue stream (kept only when they are the tenant's, the stream also the venue's), started / ended,
              the summary columns (outcome, furthest, last_screen, order_no, check_id, total_pence,
              basket_value_pence, items_added, taps, dead_taps, lang, event_count, truncated), and{' '}
              <Mono>summary</Mono>, <Mono>names</Mono>, <Mono>viewport</Mono>, <Mono>events</Mono> (jsonb).{' '}
              <Mono>services/kioskJourneySvc.js</Mono>: <Mono>cleanVisit()</Mono> checks the shape (a ULID id,
              started within the last 31 days, at most 8000 events and 3M characters, times clamped into order, at
              most 6 hours), <Mono>saveVisits()</Mono> stores with <Mono>ON CONFLICT DO NOTHING</Mono> (a visit sent
              twice is stored once; the reply lists every id the kiosk may forget) and works the summary out itself
              with <Mono>summariseJourney()</Mono>. The device, venue and tenant come from the kiosk's pairing, never
              the body. The device route is kiosk only (403 for other kinds), 8 MB body, 60 a minute.{' '}
              <Mono>cleanUpJourneys()</Mono> (the hourly AI clean-up job): events cleared after 90 days
              (<Mono>events_cleared_at</Mono>), rows deleted after 400.
            </P>
            <DataTable
              head={['Function (shared/kioskJourney.js)', 'Does']}
              rows={[
                ['applyPatch() / diffView()', 'The view stream both ways.'],
                ['frameAt(events, t)', 'The view at a moment, the scroll places since the last screen or dish change, the viewport (with the recorded box, b) and the touches shortly before (the player draws them, and sends the box with kiosk.replay).'],
                ['journeySteps(events, names)', 'The visit as steps in words: opened a section or a dish, added / changed / removed / took off, left a dish without adding it, asked / answered "Still there?", asked to start again and kept ordering, card declined, order placed; touches (a touch is folded into the change it caused within 700 ms; a touch on nothing never is), typing on the keyboard and scrolling each folded into one step. Going back to the start screen clears the order without counting removals.'],
                ['summariseJourney(events, { names })', 'outcome, duration_ms, furthest (STAGES), last_screen, time per screen (a dish being built counts as its own screen, dish), sections, items (views, view time, adds, qty, removed, left), the order, first_add_ms, order_ms, cancels, taps, dead_taps, swipes, scrolls, languages, reach, allergens.'],
                ['aggregateJourneys(rows)', 'The overview: tiles, the funnel, outcomes, where guests gave up, time per screen, changes of mind, dishes, by hour, by kiosk.'],
              ]}
            />
            <H3>Report and playback API (/api/pos/kiosk-analytics, routes/kioskAnalytics.js)</H3>
            <DataTable
              head={['Route', 'Returns']}
              rows={[
                ['GET /venues/:venueId?from&to&device_id&design_id', 'The overview for the days in the venue\'s time (at most 92 days, 20,000 visits; truncated says when there were more), with the venue\'s kiosks and the designs.'],
                ['GET /venues/:venueId/sessions?...&outcome&limit&offset', 'The visits newest first without events; total from the same statement (count(*) OVER ()).'],
                ['GET /sessions/:id', 'One visit: session, summary, names, viewport, events, notes, and replay { url, design_id, design_name }: a kiosk preview link (previewToken(), menu live) with &replay=1 for the visit\'s design at its venue and stream, or the kiosk\'s design now when it was deleted; null when the events are cleared or no design is left.'],
              ]}
            />
            <H3>Playback</H3>
            <P>
              The kiosk app with <Mono>&amp;replay=1</Mono> boots with <Mono>bootReplay()</Mono> (no service worker,
              no recording, posted designs ignored) and <Mono>listenForReplay()</Mono>: the player posts{' '}
              <Mono>{'{ type: \'kiosk.replay\', view, scroll }'}</Mono>, the kiosk writes the view into its store
              (<Mono>replayView()</Mono>: the name and tent as dots), hands <Mono>ui:</Mono> values back through{' '}
              <Mono>useJourneyState()</Mono>, puts scroll boxes where they were, and answers{' '}
              <Mono>{'kiosk.replayed { missing }'}</Mono> (dishes no longer on the menu). Timers that would move the
              screen on by themselves (the order number countdown, the idle warning) check <Mono>s.replay</Mono>; a
              cover (<Mono>k-replay-cover</Mono>) takes every touch. The admin player
              (<Mono>pages/KioskAnalytics.jsx</Mono>: <Mono>VisitPlayer</Mono>, <Mono>KioskFrame</Mono>,{' '}
              <Mono>StepList</Mono>) scales the frame to the visit's viewport, posts a frame whenever the view or the
              scroll places change, draws touches in an SVG over it, and plays at 1x to 8x with long pauses (over
              2.5 s) shortened.
            </P>
          </section>

          <section id="installer" data-doc="">
            <H2>Installer app &amp; link codes</H2>
            <P>
              Migration 184. A till, kitchen screen, kiosk or menu screen that isn't set up shows a code of its
              own and a QR code; someone signed in links it from a phone (the installer app,{' '}
              <Mono>installer.&lt;domain&gt;</Mono>) or from the admin (Store tech's Add windows, Screens). That
              is the only way a device is set up: since 19 Oct 2026 Store tech and the installer no longer make
              codes to type into a device (<Mono>POST /api/pos/venues/:id/devices</Mono> and{' '}
              <Mono>POST /api/pos/devices/:id/pairing-code</Mono> are gone).
            </P>
            <H3>Link codes</H3>
            <DataTable
              head={['Piece', 'What it does']}
              rows={[
                ['pos_pairings', 'A code a till / kitchen screen / kiosk shows: code_hash (sha256 of the normalised code, unique), secret_hash, app (the address it was shown on: terminal | kds | kiosk, null on a test address), device_info, expires_at (15 minutes), claimed_at, device_id, tenant_id. No tenant until linked; forced RLS lets anyone see unclaimed rows (like screen_pairings).'],
                ['services/linkCodes.js', 'LINK_MINUTES, newLinkCode() (the screen alphabet, ABC-DEF), linkCodeHash(), linkUrl(code) = installerOrigin() + /link/<code>, linkCodeTaken() (a code is never live in both tables, so a typed code finds one device), findLinkCode() (screen first, then device).'],
                ['POST /pos-api/pairings', 'No auth, 30/min per address. { app?, device? } -> { id, code, secret, expires_at, link_url }. The secret stays on the device; only its hash is kept.'],
                ['GET /pos-api/pairings/:id', 'Authorization: Pairing <secret>, 240/min per address (a venue\'s devices share one). waiting | expired | paired (with device_id, name, kind, short_code, venue). Paired only while the device row still holds this code\'s secret_hash and isn\'t removed.'],
                ['POST /api/pos/venues/:id/link', 'Store tech manage. { code, device_id? | name, kind?, settings? }. Locks the code row, refuses run-out and used codes, a kind other than the code\'s app (422), another venue\'s or tenant\'s device (404). New device: 201 with a short code; device_id: 200, the existing row takes the code\'s secret_hash (the old device stops, forgetDevice() + the 30 s device cache), keeps name and settings. A removed device (revoked_at) is brought back: revoked_at cleared, its settings through cleanDeviceSettings() (ids of streams, printers, floor areas, stations, kiosk designs or card machines that no longer exist dropped instead of refused, since nobody could edit a removed device first). Marks the code claimed with the tenant.'],
                ['POST /screen-api/pairings', 'Menu screens, as before, now also returns link_url and skips codes live in pos_pairings. Linked by POST /api/screens/screens/claim.'],
              ]}
            />
            <H3>The devices</H3>
            <P>
              Till app <Mono>pos/src/screens/Pair.jsx</Mono>: <Mono>useLinkCode()</Mono> asks for a code on
              mount (<Mono>requestLinkCode()</Mono> in <Mono>pos/src/lib/store.js</Mono>, with the screen size and
              the address's kind), shows it with a QR code (<Mono>qrSvg()</Mono> from{' '}
              <Mono>shared/qr.js</Mono>) and checks it every 4 s (<Mono>checkLinkCode()</Mono>, which saves the
              device through <Mono>startPaired()</Mono>, the same as <Mono>pair()</Mono>); a run-out code is
              replaced. There is no typed-code form; a device moved from another address brings a hand-over code
              in <Mono>#pair=</Mono> and pairs with it by itself (<Mono>pair-moving</Mono>, or{' '}
              <Mono>pair-error</Mono> above the shown code if it fails). The menu screen player
              (<Mono>screen/player.js</Mono> <Mono>showCode()</Mono>) draws the QR code beside its code;{' '}
              <Mono>qr.js</Mono> is in <Mono>PLAYER_LIBS</Mono> and the player's <Mono>SHELL_FILES</Mono>.
            </P>
            <P>
              <Mono>shared/qr.js</Mono>: a dependency-free QR encoder (Model 2, byte mode, versions 1-10, levels L
              / M / Q / H, Reed-Solomon over GF(256), all 8 masks with the standard's penalty).{' '}
              <Mono>qrMatrix(text, {'{ ecc }'})</Mono> and <Mono>qrSvg(text, {'{ margin, dark, light, title }'})</Mono>.
              Tests: <Mono>shared/test/qr.test.mjs</Mono> (capacities, patterns, format bits, a known code);
              checked against a QR reader when written.
            </P>
            <H3>The installer app</H3>
            <P>
              The admin build on <Mono>installer.&lt;domain&gt;</Mono>: <Mono>routes/installerSite.js</Mono>{' '}
              (fastify-plugin onRequest hook, host kind <Mono>installer</Mono> from{' '}
              <Mono>platformHostKind()</Mono>) serves <Mono>admin/dist</Mono> with <Mono>/manifest.webmanifest</Mono>{' '}
              answered by <Mono>installer.webmanifest</Mono> (start <Mono>/install</Mono>), redirects http to https,
              lets <Mono>/api/</Mono>, <Mono>/ws</Mono> and <Mono>/uploads/</Mono> through. The wildcard nginx block
              already sends the host to the API; <Mono>installer</Mono> is in <Mono>RESERVED_SUBDOMAINS</Mono>.
              Auth0 must list the address in Allowed Callback URLs, Logout URLs and Web Origins.
            </P>
            <DataTable
              head={['Route', 'Page', 'Calls']}
              rows={[
                ['/install', 'pages/installer/InstallerHome.jsx: venue (maca_installer_venue), Link / Add, the four lists with state', 'GET /api/installer/venues/:id (pos_setup or screens view; devices with their whole settings, removed_devices (revoked ones, which a code can bring back), stations, kiosk designs, menu screens, boards, playlists, can, addresses), every 10 s'],
                ['/install/link[/:code]', 'pages/installer/InstallerLink.jsx: code box, Scan (components/installer/QrScanner.jsx, BarcodeDetector), what the code is, new or one already here (?replace=&kind=; reusable(): not linked first, then linked, then removed; guessReuse(): the one not linked when there is exactly one is picked), name and settings', 'POST /api/installer/lookup (pos_setup or screens manage), POST /api/pos/venues/:id/link, POST /api/screens/screens/claim'],
                ['/link/:code', 'LinkRedirect in main.jsx: what a device\'s QR code opens', '-'],
                ['/install/add', 'pages/installer/InstallerAdd.jsx: kind, the address (with a QR code), then on to Link', '-'],
                ['/install/device/:kind/:id', 'pages/installer/InstallerDevice.jsx: state, name and settings (Save sends the whole settings), Identify / Reload (menu screens), move to a new device, remove (asks twice)', 'PATCH /api/pos/devices/:id, PATCH /api/screens/screens/:id, identify, reload, DELETE; a new device goes through /install/link?replace='],
              ]}
            />
            <P>
              <Mono>components/installer/InstallerShell.jsx</Mono> (header with back, the restaurant group switch and
              sign out; swaps the apple-touch-icon, theme colour and title while mounted).{' '}
              <Mono>pages/installer/shared.jsx</Mono>: <Mono>KINDS</Mono>, <Mono>useInstallerVenues()</Mono>,{' '}
              <Mono>useOverview()</Mono>, <Mono>deviceState()</Mono>, <Mono>KindSettings</Mono>,{' '}
              <Mono>tidyCode()</Mono> / <Mono>codeFromScan()</Mono>. <Mono>lib/hosts.js</Mono>:{' '}
              <Mono>IS_INSTALLER_HOST</Mono> (the AppShell and /mobile trees go to /install there),{' '}
              <Mono>installerHref()</Mono>. In the admin: <Mono>ShownCodeField</Mono>,{' '}
              <Mono>LinkDeviceModal</Mono> and <Mono>InstallerLine</Mono> in <Mono>components/pos/TillsSection.jsx</Mono>, on the Tills, Kitchen
              screens and Kiosks tabs. Tests: <Mono>api/test/installer.test.mjs</Mono>, the system-paths test and
              the sweep's fixtures link a kitchen screen and a till; every API test adds devices through{' '}
              <Mono>linkDevice()</Mono> in <Mono>api/test/support/devices.mjs</Mono> (show a code, link it).
            </P>
          </section>

          <section id="android-app" data-doc="">
            <H2>Android app</H2>
            <P>
              <Mono>android-app/</Mono> (27 Oct 2026) is one Android app, <Mono>com.macaroonie.app</Mono>, for the
              till, the kitchen screen, the self-order kiosk and (version 1.2, 29 Oct 2026) menu screens: an Expo
              (SDK 58) shell around the <Mono>pos/</Mono> web apps and the <Mono>screen/</Mono> player, built and signed by EAS (project{' '}
              <Mono>@gomono-london/macaroonie</Mono>, GitHub base directory <Mono>android-app</Mono>). The apps
              themselves stay web pages, so a deploy changes them on every device and the app only needs a new build
              when the shell changes. Continuous Native Generation: there is no <Mono>android/</Mono> folder in the
              repository; native settings live in <Mono>app.json</Mono> and its plugins.
            </P>
            <DataTable
              head={['Part', 'How']}
              rows={[
                ['App.js + roles.js', 'First start: Picker (Till / Kitchen screen / Self-order kiosk / Menu screen), saved in AsyncStorage (macaroonie.kind). Then a WebView of https://{pos|kitchen|kiosk|screens}.<root>/ (ROLES, urlFor() in roles.js, tested by android-app/test/roles.test.mjs). useKeepAwake(), <StatusBar hidden />, <NavigationBar hidden /> (and the expo-navigation-bar plugin with hidden), BackHandler always consumed while the WebView shows. The Picker\'s choices and buttons are focusable with onFocus / onBlur drawing a white ring (roleFocus, buttonFocus) and hasTVPreferredFocus on the current (or first) choice, so a TV remote\'s arrows and OK work.'],
                ['Where it may go', 'onShouldStartLoadWithRequest: our domain and its subdomains load; anything else is refused, and a till or kitchen screen opens it in the browser (Linking); a kiosk or menu screen stays put (staysPut()). Landing on a device address (pos., kitchen. / kds., kiosk., screens.: kindOfUrl()) saves that kind (onFollow), so moveDevice() and the setup screen\'s address links change what the app opens next time without reloading the page (the WebView\'s source only changes when someone picks in the Picker).'],
                ['Menu screens (screen/player.js)', 'IN_APP = !!window.ReactNativeWebView, tellApp(). In the app the pairing screen has a Change device type button (data-app-choose, a document click listener) and the settings panel (five taps or five OK presses) a Change device type button (data-act app): both post macaroonie:choose-app. A TV with no touch reaches it with the remote (focusable buttons, Tab / arrows, OK).'],
                ['Android TV (plugins/withTvLauncher.js)', 'A config plugin in app.json: withAndroidManifest adds LEANBACK_LAUNCHER to the main activity\'s launcher intent filter, android:banner @drawable/tv_banner on the application, and uses-feature android.software.leanback, android.hardware.touchscreen, android.hardware.camera(.autofocus) with required false (one APK for tablets and TV boxes); withDangerousMod copies assets/tv-banner.png (320 x 180) to res/drawable-xhdpi/tv_banner.png. Checked with expo prebuild in a scratch copy.'],
                ['Bridge (pos/src/lib/nativeApp.js)', 'IN_APP = !!window.ReactNativeWebView; tellApp(message) posts JSON. printTickets() (lib/print.js) posts { type: macaroonie:print, html } (the same page it would print in a frame) and the app calls expo-print printAsync({ html }), Android\'s print dialog. Pair.jsx shows Change device type (posts macaroonie:choose-app, the app shows the Picker) instead of the links to the other addresses. The hidden corner posts macaroonie:device-menu (below).'],
                ['The hidden corner (corner.js)', "Five taps in the top left corner (CORNER_DP 56 dp square, CORNER_TAPS 5 within CORNER_WINDOW_MS 3000) open the Picker over the running app. CORNER_SCRIPT is the WebView's injectedJavaScript (each page load, main frame only, guarded by window.__macaroonieCorner): a capture-phase pointerdown listener that never stops the touch, measures the corner in CSS pixels as CORNER_DP / visualViewport.scale (so a zoomed kiosk's corner is the same size on the glass), and posts { type: macaroonie:device-menu }. While the page is still loading, Loading's onTouchStart counts the same way with nextTaps() / inCorner() (pageX / pageY in dp). Two copies of one rule because Hermes keeps no function source; android-app/test/corner.test.mjs (npm test, in the workflow) runs the same taps against both. App keeps the Shell mounted under the Picker (an absolute-fill View), so Back to the till doesn't reload it; opened from the corner (fromCorner) it shows Reload the till and goes back after AUTO_BACK_SECS (60) untouched (any touch on it starts the minute again). Each kind has its own origin, so its pairing (localStorage, IndexedDB) stays while another kind shows."],
                ['When it goes wrong', 'onError (main frame) or onHttpError 5xx: Unreachable, trying again every RETRY_SECS (5) by remounting the WebView, with Try now and Change device type. onRenderProcessGone (Android stopped the page): remount. The web apps\' own service workers keep working inside the WebView, so a device that has loaded its app once opens it offline.'],
                ['WebView settings', 'domStorageEnabled, textZoom 100 (the phone\'s font size never resizes the till), no zoom controls, overScrollMode never, mediaPlaybackRequiresUserAction false (kiosk start videos), setSupportMultipleWindows false, mixedContentMode never, allowFileAccess false, user agent + MacaroonieApp/<version>. scalesPageToFit (default) keeps the viewport tag working, so the kiosk\'s zoom (useKioskViewport()) works as in Chrome.'],
                ['app.json / app.config.js', 'Package com.macaroonie.app, orientation default (the device\'s mount decides), CAMERA permission (QR scanning; the WebView asks at runtime), RECORD_AUDIO and SYSTEM_ALERT_WINDOW blocked, splash and adaptive icons from the till icon\'s macaroon. app.config.js adds extra.rootDomain (MACAROONIE_ROOT_DOMAIN, default macaroonie.com) and extra.webDebug (MACAROONIE_WEB_DEBUG=1: chrome://inspect).'],
                ['eas.json', 'development: APK with web debugging. preview: APK for installing by hand. production: also an APK for installing by hand (distribution internal), autoIncrement, because Build from GitHub on expo.dev builds every platform with production and asks nothing; switch it to an app bundle when the app goes on Google Play. appVersionSource remote: EAS keeps the version code.'],
                ['Download (migration 213)', "platform_settings (global, no RLS) row android_app holds the copy: { url, key, bytes, sha256, source_url, file_url }. services/androidAppSvc.js: saveAndroidApp(link) fetches the pasted link (https; http too outside production) with one 45 s budget (under nginx's 60 s on /api/), reads a web page (expo.dev's build page) for the first .apk address in it (apkLinkIn(), JSON escapes undone), caps the file at 250 MB, checks it is an APK (apkProblem(): zip with AndroidManifest.xml, no BundleConfig.pb, so an .aab is refused), puts it through storageSvc (platform/android/<uuid>.apk) and removes the previous copy. routes/androidApp.js: GET / PUT { link } / DELETE /api/platform/android-app (platform admins; the Platform page's Android app tab, components/platform/AndroidAppCard.jsx) and public GET /pos-api/android-app ({ available, path, bytes, updated_at }, nothing else). routes/posSite.js: /android on pos., kitchen. and kiosk. streams the local copy as macaroonie.apk (no-store) or redirects to an S3 copy; 404 page when there is none or the file is missing. Pair.jsx (useAndroidApp(), AndroidApp): not in the app, a button on an Android browser, elsewhere \"Android device? ... open <address> on it\" with the address as a download link. pos/vite.config.js: /android in navigateFallbackDenylist, so the service worker never answers it with the app."],
                ['Checks', '.github/workflows/android-app.yml on pull requests touching android-app/: npm ci, npm test (the corner\'s tests), expo config, expo export --platform android. deploy.yml ignores android-app/**. android-app/package-lock.json is tracked (the root .gitignore ignores lockfiles; !android-app/package-lock.json) so EAS installs what was tested.'],
              ]}
            />
            <InfoBox type="info">
              Not built: a native QR scanner (the web apps use <Mono>BarcodeDetector</Mono> where the WebView has
              it, else a USB / Bluetooth scanner), silent printing (Android shows its print dialog; USB and network
              ticket printers belong on the venue hub), locking a kiosk in (use Android&apos;s app pinning or a
              device manager), and an iPhone / iPad build (<Mono>platforms</Mono> is android only).
            </InfoBox>
          </section>

          <section id="web-ordering" data-doc="">
            <H2>Web Ordering</H2>
            <P>
              Collection orders from the tenant website (migration 122) with pluggable payment
              gateways. Modules <Mono>web_orders</Mono> (board, actions, sold out, pause) and{' '}
              <Mono>web_ordering_setup</Mono> (settings), group <Mono>web_ordering</Mono>. The{' '}
              <Mono>orders</Mono> table has a <Mono>channel</Mono> column (<Mono>web</Mono> |{' '}
              <Mono>pos</Mono> | <Mono>table_qr</Mono>) so the POS and table ordering can reuse it.
            </P>
            <H3>Tables</H3>
            <DataTable
              head={['Table', 'Notes']}
              rows={[
                ['ordering_settings', "One row per venue (PK venue_id): is_enabled, is_paused + pause_message, hours jsonb [{ day 0-6 (0 = Sunday), windows: [{ open, close }] }], menu_ids uuid[] (which menus are online, written by Menus > Menu times since migration 230; the column menu_schedules went with that migration, see Menu times online below), allow_asap, lead_time_mins, slot_interval_mins, max_orders_per_slot (NULL = no limit), max_days_ahead, min_order_pence, auto_accept, order_type_ids jsonb { collection, delivery, eat_in } + revenue_stream_id (migration 170: the sale context for tax and the kitchen; a fulfilment with no type uses the tenant's type of that name, fillOrderTypes() in loadSettings()), tips_enabled + tip_percents int[], payment_methods text[] (gateway keys, checkout order), collection_instructions, confirmation_note, hours_extension jsonb (migration 223: today's hours later than usual, see Collection slots). No row = defaults (disabled); GET fills hours from loadOpeningHours()."],
                ['ordering_item_availability', "Per-venue sold out: (venue_id, item_id, sold_out_until). NULL until = until turned back on. item_id has no FK because menu saves re-insert items (with the same ids since migration 121)."],
                ['orders', "service_date (venue-local collection day) + order_number (1, 2, 3 per venue per day, UNIQUE) under pg_advisory_xact_lock on venue + day. public_token is the guest key (status page, like manage_token). status: pending_payment, placed, accepted, preparing, ready, completed, rejected, cancelled, expired. promised_at is the ready time (ASAP or the chosen slot). Money in pence: subtotal, tip, total, vat (VAT-inclusive), paid, refunded; payment_status unpaid | pending | paid | failed | partially_refunded | refunded."],
                ['order_items', "Copies name, options [{ group, label, price_pence, mode }], unit and line totals, vat_rate and vat_pence at the time of ordering. menu_item_id is a plain uuid (no FK), for reports only."],
                ['order_events', "Status history and audit: type status | payment | refund | time | note, from/to status, detail jsonb, actor (staff email, guest, system)."],
                ['order_payments', "One row per payment attempt: gateway (a gateway key, or cash / card_terminal for counter payments), gateway_ref (UNIQUE per gateway), amount, refunded, status, raw jsonb."],
                ['platform fee', "tenants.ordering_fee_percent (0-20, platform admin only: Platform page, PATCH /api/platform/tenants/:id). Each order stores platform_fee_percent and platform_fee_pence = subtotal x percent (tips excluded) when it is created. Shown in the report. The Stripe gateway will pass it as application_fee_amount on online payments; pay-at-counter fees are for invoicing."],
                ['menu additions', "menu_items.is_orderable, min_order_qty (migration 133: NULL or 2-99; loaded as item.min_qty by loadOrderingMenu(); priceBasket() adds a min_qty error per dish when the qty over all its lines is below it; the guest page's openItem() starts at the shortfall and changeQty() removes a line rather than go below); menu_variant_groups.price_mode (base | extra), min_select, max_select. email_log.order_id."],
              ]}
            />
            <H3>Menu times online (migrations 130, 230)</H3>
            <P>
              Which menus are online and when each is on are set on Menus &gt; Menu times (see Menus &gt;
              Menu times), not here. <Mono>loadSettings()</Mono> fills <Mono>settings.menu_schedules</Mono>{' '}
              from <Mono>webSchedules(tx, venueId)</Mono> (<Mono>services/menuTimesSvc.js</Mono>):{' '}
              <Mono>{'{ menuId: schedule }'}</Mono> for the menus whose Website cell gives them times
              (the menu&apos;s own, or the website&apos;s own); a menu with none is on whenever ordering is
              open. The <Mono>ordering_settings.menu_schedules</Mono> column was dropped by migration 230,
              which moved its schedules into <Mono>menu_times</Mono> rows (the menu&apos;s times, the website
              following them, kiosks and tills at any time, as they were). A schedule is{' '}
              <Mono>shared/menuSchedule.js</Mono>&apos;s:{' '}
              <Mono>{'{ from, until, times: [{ days: [0-6], start, end }] }'}</Mono> (0 = Sunday). No
              times = all day on its dates; no schedule = always on. <Mono>menuOnAt()</Mono> includes a
              window&apos;s end minute (a 15:00 slot is in 11:00–15:00, like ordering hours), windows that
              only touch don&apos;t overlap, and a window must end after it starts (no overnight). Two online
              menus on at once are allowed now (both are listed); Menu times shows them as a note.{' '}
              <Mono>GET /api/orders/settings/:venueId</Mono> returns <Mono>online_menus</Mono>{' '}
              <Mono>[{'{ id, name, times }'}]</Mono> (in <Mono>menu_ids</Mono> order, the times in words or
              null) and leaves <Mono>menu_ids</Mono> out of <Mono>settings</Mono>;{' '}
              <Mono>PUT /settings/:venueId</Mono> no longer takes menus, so an older copy of the page
              can&apos;t put a menu back online.
            </P>
            <P>
              <Mono>loadOrderingMenu(tx, venue, settings, {'{ dates, now }'})</Mono>: with dates (the
              ordering dates) a menu on none of them is left out; each menu carries{' '}
              <Mono>schedule</Mono> (scheduleLabel() text or null) and <Mono>on_now</Mono>. It always
              returns <Mono>itemMenus</Mono> (dish id to menu ids). <Mono>createOrder()</Mono> calls{' '}
              <Mono>itemOffAt()</Mono> at the promised time and returns 422{' '}
              <Mono>slot_unavailable</Mono> naming the dish. The guest page opens on the first menu on
              now, shows the schedule under the menu tabs, passes the basket to /slots, and resets a
              picked time that is no longer offered.
            </P>
            <H3>Prices: one implementation</H3>
            <P>
              <Mono>shared/orderPricing.js</Mono> (itemChoices, priceLine, priceBasket, vatIncluded)
              prices every basket. The server runs it in <Mono>orderSvc.createOrder()</Mono> against
              the live menu; the guest page imports the same file from{' '}
              <Mono>/order-api/pricing.js</Mono> only to show totals. A dish's choices: its ad-hoc
              variants (one required base choice, option ids <Mono>v:label</Mono> because variant
              rows are re-inserted on every menu save) plus attached variant groups. Unit price =
              chosen base options (or the dish's own price when none) + chosen extras. A base option
              with no price counts as the dish's own price. The menu's variant display settings apply
              via <Mono>variantRules(menu)</Mono>, passed to <Mono>itemChoices()</Mono> by{' '}
              <Mono>loadOrderingMenu()</Mono>: <Mono>hide_unpriced_variants</Mono> drops null/£0
              options from the choices (so the server rejects them too),{' '}
              <Mono>hide_zero_priced_variants</Mono> sets <Mono>hide_zero_price</Mono> on each choice
              and <Mono>optionPriceText()</Mono> shows no price for £0 options. Kiosks follow the same
              settings: <Mono>tillMenuData(..., {'{ guest: true }'})</Mono> puts the menu's{' '}
              <Mono>variant_rules</Mono> on each dish and <Mono>posChoices()</Mono> passes them to{' '}
              <Mono>itemChoices()</Mono> (tills get no rules: staff see every option). VAT comes from the dish's
              tax levels (dish, section, menu) resolved by <Mono>taxFor()</Mono> (<Mono>shared/tax.js</Mono>)
              for the order's context, <Mono>orderContext(venueId, settings, fulfilment)</Mono>: the order
              type Ordering setup gives that fulfilment and its revenue stream. <Mono>loadOrderingMenu()</Mono>{' '}
              sets each item's <Mono>vat_rate</Mono>; orders store <Mono>order_type_id</Mono> and{' '}
              <Mono>revenue_stream_id</Mono>. Tips are a percentage from{' '}
              <Mono>tip_percents</Mono>, outside VAT.
            </P>
            <H3>GDPR consent (migration 125)</H3>
            <P>
              Checkout has a required "order-only use of my details" box (it covers allergy notes,
              which are health data) and an optional, unticked newsletter box.{' '}
              <Mono>loadPrivacy(tx, tenantId)</Mono> in <Mono>orderSvc.js</Mono> owns the wording
              (business name = <Mono>tenant_site.brand_name</Mono>, then <Mono>site_name</Mono>, then{' '}
              <Mono>tenants.name</Mono>) and finds the privacy policy link (a published tenant-level{' '}
              <Mono>website_pages</Mono> row with slug <Mono>privacy</Mono>, else a legal page whose slug
              contains "privacy"). <Mono>GET /order-api/venues/:id</Mono> returns it as{' '}
              <Mono>privacy</Mono> for the page to show; <Mono>createOrder()</Mono> records the same text.
              <Mono>OrderBody.data_consent</Mono> must be <Mono>true</Mono> (400 otherwise).
            </P>
            <DataTable
              head={['Column', 'Notes']}
              rows={[
                ['orders.data_consent_at', "When the guest agreed to the order-only use (order creation time)."],
                ['orders.consent', "jsonb { data: { text, at }, marketing: { text, at } | null, policy_url } as shown at checkout. Cleared to {} on anonymise."],
                ['customers.marketing_opt_in (+ _at, _source, marketing_opt_out_at)', "Newsletter status. Set on order creation when the box is ticked (source web_order); an unticked box never clears it. Cleared by POST /customers/:id/unsubscribe or anonymise. GET /customers?offset=…&newsletter=1 lists subscribers."],
              ]}
            />
            <H3>Ordering page and block (migration 126)</H3>
            <P>
              <Mono>website_pages.system_key</Mono> (<Mono>'order'</Mono>, unique per tenant, tenant-level; also{' '}
              <Mono>'loyalty'</Mono> since migration 214, see Loyalty)
              marks the built-in ordering page. Migration 126 seeds one per tenant with a website;{' '}
              <Mono>ensureTenantSite()</Mono> calls <Mono>ensureSystemPages()</Mono> (<Mono>services/systemPages.js</Mono>) for new sites. The
              pages API ignores slug / kind / is_published changes on it and refuses to delete it,
              unpublish it or make it a modal (422). <Mono>publishSvc</Mono> includes{' '}
              <Mono>system_key</Mono> in the snapshot. The <Mono>online_ordering</Mono> block picks its
              venue from: the route&apos;s <Mono>orderView</Mono>, then <Mono>data.venue_id</Mono>, then the
              location page&apos;s venue, then the only ordering venue, else a location picker, using{' '}
              <Mono>ordering_venues</Mono>, which <Mono>loadOrRender404()</Mono> attaches to every site
              bundle. Block data: <Mono>heading</Mono>, <Mono>hide_title</Mono> (hides the venue name),
              <Mono> venue_id</Mono>, plus the display options below. One per page: the app&apos;s script finds <Mono>#mo-app</Mono> by id.
              LinkPicker, sitemap and llms.txt link the page as <Mono>/order</Mono>.
            </P>
            <H3>Online ordering block options</H3>
            <P>
              <Mono>blocks/online_ordering.eta</Mono> turns the block data into{' '}
              <Mono>orderOptions</Mono> for <Mono>shared/ordering.eta</Mono>, which has a default for each
              (the status page passes none). Colours are theme role names mapped to{' '}
              <Mono>var(--c-*)</Mono>; ordering.eta only lets a <Mono>var(--c-x)</Mono> or #hex through.
              Layout switches are classes on <Mono>#mo-root</Mono> (<Mono>mo--modal-basket</Mono>,{' '}
              <Mono>mo--static-basket</Mono>, <Mono>mo--static-nav</Mono>); values are CSS variables on{' '}
              <Mono>.mo</Mono> and <Mono>.mo-sheet-back</Mono> (<Mono>--mo-offset</Mono>,{' '}
              <Mono>--mo-basket-bg</Mono>, <Mono>--mo-basket-fg</Mono>), so the pop-ups appended to body get
              them too. The sticky element is <Mono>.mo-basket-col</Mono> (the grid item), not the basket
              inside it, and the search box and tabs share one sticky <Mono>.mo-nav</Mono>. Search typing
              redraws only <Mono>#mo-nav-tabs</Mono> and <Mono>#mo-menu-body</Mono> so the box keeps focus.
              Category jumps and the scroll highlight use <Mono>barBottom()</Mono> (offset + bar height).
            </P>
            <DataTable
              head={['Block data', 'Default', 'Effect']}
              rows={[
                ['title_text, subtitle_text, hide_subtitle', "'' / '' / false", '{venue} and {address} are filled in; a new line in the subtitle becomes a line break.'],
                ['basket_mode', "'side'", "'modal': no basket column; the floating basket bar shows at every width."],
                ['basket_sticky', 'true', 'Sticky basket column (side mode), max-height with its own scroll.'],
                ['basket_bg, basket_text', "''", 'Theme roles. With a text colour the basket gets .mo-fg: muted text inherits and buttons invert to the basket colours.'],
                ['show_vat', 'true', 'Includes VAT under the basket subtotal and the checkout total.'],
                ['sticky_nav, sticky_offset', 'true, 0', 'Sticky .mo-nav at top: --mo-offset; the basket column sticks at offset + 16. sticky_offset > 0 sets --mo-offset; at 0 the page script measures the site header (findTopBars(): header, nav, .mc-header and body children that are sticky/fixed at top 0-8px, at least half the screen wide, under 40% of its height) and re-measures on resize (ResizeObserver).'],
                ['show_search', 'false', 'Accent-insensitive match on name, native name and description across all menus.'],
                ['search_style', "'bar'", "bar | icon_phone | icon. Icon: .mo-navrow with an absolute .mo-search-btn over the tab strip (tabs padded past it, ::before/::after mask what scrolls under); data-open-search swaps the row for .mo-search--open (state.searchOpen) via redrawNav(); data-close-search / Escape run closeSearch(). icon_phone = max-width 900px (phoneMq), re-rendered when the width crosses it."],
                ['highlight_favourites, favourite_label', "false, ''", 'is-fav card class and badge (default text House favourite) from the item featured flag.'],
                ['favourite_bg, favourite_text', "'', ''", 'Theme roles for the is-fav card: --mo-fav-bg / --mo-fav-fg; a text colour adds mo--fav-fg so the badge and description inherit it.'],
                ['item_notes', 'true', 'false hides the per-dish note field in the dish sheet.'],
              ]}
            />
            <P>
              Sticky only works because <Mono>head.eta</Mono> sets <Mono>overflow-x: clip</Mono> on{' '}
              <Mono>html, body</Mono>. With <Mono>hidden</Mono> on both, body became a scroll container and no
              sticky element on a tenant site worked, including the header block&apos;s sticky header.
            </P>
            <P>
              Dish cards already in the basket get <Mono>is-in</Mono> (primary outline) and a{' '}
              <Mono>.mo-in-basket</Mono> badge with the quantity summed over every basket line for that dish
              (<Mono>inBasket()</Mono> in <Mono>itemCardHtml()</Mono>). Every basket change calls{' '}
              <Mono>draw()</Mono>, so the cards update with it; no option, always on.
            </P>
            <P>
              Add in the dish sheet flies the dish&apos;s picture into the basket: <Mono>pictureSpot()</Mono>{' '}
              takes the sheet&apos;s <Mono>.mo-hero</Mono> while more than 30% of it shows in the sheet, else a
              square (at most 160 px) over the Add button (a combo&apos;s last page has no picture), measured
              before the sheet closes; after <Mono>draw()</Mono>, <Mono>flyToBasket(src, from)</Mono> puts an{' '}
              <Mono>img.mo-fly</Mono> (fixed, on <Mono>document.body</Mono>) there and animates it (Web
              Animations, 700 ms) to <Mono>basketSpot()</Mono>: the words of the side basket&apos;s{' '}
              <Mono>.mo-basket-title</Mono> (a Range around its text, not the whole heading) or the{' '}
              <Mono>.mo-bar .mo-btn</Mono> on phones and in pop-up basket mode, whichever shows in the
              window; on landing the copy goes and the spot gets a <Mono>scale(1.08)</Mono> bounce (the title
              from its left edge). No dish picture, no spot in sight or <Mono>prefers-reduced-motion</Mono>:
              no flight.
            </P>
            <H3>Collection slots</H3>
            <P>
              Computed, never stored (<Mono>computeSlots()</Mono>): slot times every{' '}
              <Mono>slot_interval_mins</Mono> across each window (close time included), available
              when at least <Mono>lead_time_mins</Mono> away and under{' '}
              <Mono>max_orders_per_slot</Mono>. Orders count against the first slot at or after
              their promised time; active statuses plus unpaid orders under 30 minutes old.
              ASAP: today, while a window is open (or opens within the lead time), promised at the
              later of now + lead time and the opening, rounded up to 5 minutes. Venue-local times
              go through <Mono>zonedToUtc()</Mono> / <Mono>localParts()</Mono> (Intl, DST-safe).
            </P>
            <P>
              A day&apos;s windows come only from <Mono>dayWindows(settings, date)</Mono> (sorted,{' '}
              <Mono>HH:MM</Mono>). Migration 223&apos;s <Mono>ordering_settings.hours_extension</Mono>{' '}
              (<Mono>{'{ date, until, open, by, at }'}</Mono>, set by <Mono>POST /api/orders/hours/:venueId</Mono>{' '}
              from the board&apos;s clock button) applies on its date only: the last window closes at{' '}
              <Mono>until</Mono>, or a day with no windows opens at <Mono>open</Mono> (when it was set,
              to 5 minutes) until <Mono>until</Mono>. <Mono>extensionFor()</Mono> checks a new one (later
              than now and than the usual close, a real time up to 23:59: windows don&apos;t cross
              midnight); a stored value that isn&apos;t a real time is ignored. Nothing clears it the next
              day: another date simply doesn&apos;t match. <Mono>todayHours()</Mono> is the board&apos;s{' '}
              <Mono>ordering.hours_today</Mono> (<Mono>usual</Mono>, <Mono>windows</Mono>,{' '}
              <Mono>extended</Mono>); Ordering setup&apos;s save leaves the column alone. Admin:{' '}
              <Mono>HoursButton</Mono> / <Mono>HoursModal</Mono> / <Mono>HoursNotice</Mono> in{' '}
              <Mono>components/orders/shared.jsx</Mono>.
            </P>
            <H3>Payment gateways</H3>
            <P>
              <Mono>api/src/services/paymentGateways/</Mono>. The order flow only calls the gateway
              interface, documented in <Mono>index.js</Mono>: <Mono>start()</Mono> returns{' '}
              <Mono>none</Mono> (pay later), <Mono>succeeded</Mono> or <Mono>pending</Mono> with a
              public <Mono>client</Mono> object for the browser; optional{' '}
              <Mono>confirmFromClient()</Mono>, <Mono>parseWebhook()</Mono> (route{' '}
              <Mono>POST /webhooks/payments/:gateway</Mono>, raw body for signature checks),{' '}
              <Mono>refund()</Mono>, <Mono>cancel()</Mono>, <Mono>isAvailable(ctx)</Mono>. Shipping:{' '}
              <Mono>pay_at_venue</Mono>, <Mono>stripe</Mono> (below) and <Mono>demo</Mono> (a pretend card payment
              for pre-production; it trusts the browser, which a real gateway must never do). The context a gateway
              sees comes only from <Mono>paymentContext(venue)</Mono> in <Mono>index.js</Mono>
              ({'{ tenant: { id, stripe_account_id, stripe_ready } }'}): <Mono>createOrder()</Mono>,{' '}
              <Mono>startPayment()</Mono> (a retry) and <Mono>GET /order-api/venues/:id</Mono>{' '}
              (<Mono>checkoutGateways()</Mono>) all load it, so a method guests can&apos;t use is never offered or
              started (422 &quot;That payment method is not available now&quot;).
            </P>
            <H3>Card payments with Stripe (Stripe Connect)</H3>
            <P>
              Migration 215. One Stripe platform account (Macaroonie&apos;s); each restaurant group connects its own
              Stripe account (Standard, country GB) and charges are <em>direct charges</em> on it: the group is the
              merchant of record, Stripe&apos;s fees are on its account, and the platform&apos;s online ordering fee
              (<Mono>orders.platform_fee_pence</Mono>, <Mono>tenants.ordering_fee_percent</Mono>) is taken as{' '}
              <Mono>application_fee_amount</Mono> (never the whole total). Every call is the platform&apos;s key with a{' '}
              <Mono>Stripe-Account</Mono> header (<Mono>stripeCall()</Mono> in{' '}
              <Mono>services/stripeConnect.js</Mono>, base <Mono>STRIPE_API_URL</Mono>, Stripe-Version 2024-06-20;
              network errors and 5xx are 502).
            </P>
            <DataTable
              head={['Piece', 'What']}
              rows={[
                ['Platform keys', "platform_secrets stripe_secret_key, stripe_publishable_key, stripe_webhook_secret (sealed with vault seal(); env fallback STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_CONNECT_WEBHOOK_SECRET; the saved key wins). platformKeys() caches 15 s per process; savePlatformKeys() checks the secret with GET /v1/account, the publishable key's shape and that both are the same mode, then saves (null removes). platformReady() = a secret (sk_ / rk_) and a publishable key of the same mode. Platform page > Payments tab (components/platform/StripeKeysCard.jsx), GET/PUT /api/platform/stripe (platform admins); the reply never holds a key, only hints, the mode and the webhook address (officeOrigin() + /webhooks/payments/stripe)."],
                ['The group\'s account', "tenants.stripe_account_id + stripe_charges_enabled, stripe_details_submitted, stripe_account_name, stripe_checked_at, stripe_domains. POST /api/stripe/connect { return_url } (owner/admin + manage on web_ordering_setup or pos_setup): makes the account the first time (POST /v1/accounts, idempotency key per tenant per minute, so a double click makes one but connecting again after Unlink makes a new one) and returns an account link (account_onboarding); return_url must be https on the root domain (localhost outside production, safeReturnUrl()). GET /api/stripe (view, stripeView()), POST /api/stripe/refresh (GET /v1/accounts/:id; 403 / 404 = the account was disconnected: charges off, 422), DELETE /api/stripe (forget the link; nothing is deleted at Stripe)."],
                ['Apple Pay / Google Pay', "refreshAccount() registers the group's site addresses (subdomain, staging, a verified custom domain) with POST /v1/payment_method_domains on the account once charges are on, recorded in stripe_domains so each goes once."],
                ['Gateway', "paymentGateways/stripe.js: isAvailable = tenant.stripe_ready (account linked and charges_enabled, platform ready). start() makes a PaymentIntent on the account (automatic_payment_methods, metadata.order_id / tenant_id / venue_id / order_number, application fee) and returns client { type: 'stripe', publishable_key, account, client_secret, amount_pence, currency }. confirmFromClient() reads the PaymentIntent back (never the browser's word; an order_id that differs = failed). piStatus(): succeeded, canceled -> cancelled, requires_payment_method with last_payment_error -> failed, else pending. refund() with refund_application_fee and an idempotency key per payment, refunded so far and amount; cancel() cancels the intent."],
                ['Webhook', "Connect endpoint on the platform account, address POST /webhooks/payments/stripe, events payment_intent.succeeded / payment_failed / canceled, account.updated, account.application.deauthorized. parseWebhook() checks Stripe-Signature (t=, v1= HMAC-SHA256 of t.body with the webhook secret, 300 s tolerance; verifySignature()), applies account events to the tenant (applyAccountEvent()), hands booking deposits (metadata.kind deposit) to depositWebhook() in services/depositSvc.js, and passes only PaymentIntents with metadata.order_id on as order payments (card machine sales come to the same endpoint). applyPaymentResult() is idempotent, so a webhook after the page confirmed does nothing."],
                ['Guest page', "views/site/shared/ordering.eta: when the payment's client.type is stripe, draw() hands over to showStripe(), which loads https://js.stripe.com/v3/ once (loadStripeJs()), mounts the Payment Element once per payment (draw() never redraws it, or what the guest typed is lost) with colorPrimary from --c-primary, and confirmPayment({ redirect: 'if_required', return_url: status page ?pay=<payment id> }). Success or processing: POST .../payments/:id/confirm, then the status page. A bank redirect comes back to the status page, which confirms the ?pay= payment, cleans the address and loads. The status page offers the same form while an order is still pending_payment."],
                ['Admin', "components/orders/StripeAccountCard.jsx (useStripeAccount(); Connect / Continue on Stripe, Check again (automatic when over 5 minutes old and after ?stripe=return), Stripe dashboard, Unlink with a confirm; the platform-not-ready note): in Ordering setup under Payment methods and in Store tech > Card machines' account window."],
              ]}
            />
            <H3>Flow</H3>
            <DataTable
              head={['Step', 'Code']}
              rows={[
                ['Guest places order', "POST /order-api/venues/:venueId/orders (OrderBody). createOrder(): settings, gateway, slot check and order number under the advisory lock, server pricing, min order, customer upsert, INSERT as pending_payment. Then startPayment() outside the transaction (the gateway may call a provider)."],
                ['Payment result', "none: placeOrder() at once. pending: order_payments row + client action. applyPaymentResult() is idempotent; a second success for an already-paid order (a retry and a late earlier attempt both going through) is refunded automatically, never counted twice. A failed payment leaves the order pending_payment; POST /orders/:token/pay starts a new attempt."],
                ['Placed', "placed (or accepted when auto_accept). WS broadcast order.created to the venue room; order_confirmation email."],
                ['Staff', "changeStatus() with TRANSITIONS; accept can push promised_at by prep minutes. Reject/cancel of a paid order refunds through refundOrder(). markPaid() records cash / card_terminal. refundOrder() refunds online payments through their gateway and records counter refunds."],
                ['Expiry', "expireStaleOrders() runs with the hold sweep (queues.js, every 60 s): pending_payment older than 30 minutes becomes expired, pending payments are cancelled through the gateway."],
                ['Emails', "notificationQueue job order_email -> jobs/orderEmailWorker.js: order_confirmation, order_ready, order_cancelled (built-in templates, same venue email provider as bookings via emailCredentials()). Logged to email_log with order_id."],
              ]}
            />
            <H3>Routes</H3>
            <DataTable
              head={['Route', 'Notes']}
              rows={[
                ['GET /order-api/venues/:id', "Menu (publicItem: prepared choices, no raw variant rows; keeps vat_rate so the page can show Includes VAT, and featured = menu_items.is_featured), ordering settings, dates, payment methods. 404 when ordering is off."],
                ['GET /order-api/venues/:id/slots?date=&items=', "computeSlots(). items (the basket's dish ids, comma separated) drops times when a dish is not on any of its menus (isOn predicate from itemOffAt()); off_menu counts the dropped times, and ASAP is off when its promised time is dropped."],
                ['POST /order-api/venues/:id/quote', "priceBasket() for display."],
                ['POST /order-api/venues/:id/orders', "Place an order; returns token, status and the payment client action."],
                ['GET /order-api/orders/:token; POST .../pay; POST .../payments/:id/confirm', "Guest status, retry, browser confirmation."],
                ['/api/orders (admin)', "GET / (board: venue + day), GET /:id (events, payments), POST /:id/status | promised | mark-paid | refund, GET|PUT /settings/:venueId, POST /pause/:venueId (web_orders manage, no setup rights needed), POST /hours/:venueId ({ until: 'HH:MM' | null }, web_orders manage: today's hours later than usual, migration 223), GET|PUT /availability/:venueId[/:itemId], GET /report, GET /transactions[.csv] (see Transactions below), GET /gateways."],
                ['Site', "/order (sole ordering venue, or a location picker) and /locations/:slug/order render the tenant's built-in ordering page (website_pages.system_key = 'order', migration 126) through page.eta, passing orderView/orderVenue(s); its online_ordering block (blocks/online_ordering.eta) includes shared/ordering.eta. Sites published before 126 use DEFAULT_ORDER_PAGE (services/systemPages.js) until republished. /p/<slug> of that page redirects to /order. /order/status/:token still renders each template's order.eta around shared/ordering.eta."],
              ]}
            />
            <H3>Admin</H3>
            <P>
              <Mono>pages/Orders.jsx</Mono> (board, report, transactions), <Mono>pages/OrderingSettings.jsx</Mono>,{' '}
              <Mono>pages/mobile/MobileOrders.jsx</Mono>, all built on{' '}
              <Mono>components/orders/shared.jsx</Mono>: OrderBoard, OrderDetailModal,
              AvailabilityModal, PauseButton, useRealtimeOrders (venue WebSocket), printTicket
              (80mm browser print). Menus.jsx sends is_orderable / vat_rate_* in its save payload;
              VariantGroupsManager sends price_mode / min_select / max_select. A base option's price comes
              only from <Mono>basePrice()</Mono> in <Mono>shared/orderPricing.js</Mono>: empty or £0 = none, the
              dish's own price stands (used by <Mono>priceChoiceSet()</Mono>, <Mono>fromPrice()</Mono>,{' '}
              <Mono>priceVaries()</Mono> (only when the base prices differ), <Mono>isPriced()</Mono>,{' '}
              <Mono>optionPriceText()</Mono>, the till's <Mono>priceChoices()</Mono> and the menu screens'{' '}
              <Mono>dishPriceText()</Mono>).
              <Mono> components/orders/ScheduleEditor.jsx</Mono> (date range + times of day) is shared by
              Ordering setup and Promotions.
            </P>
            <P>
              GloriaFood orders (migration 159) join the board list when the venue&apos;s GloriaFood link has{' '}
              <Mono>show_on_board</Mono> on: same shape with <Mono>source: &apos;gloriafood&apos;</Mono>, a
              GloriaFood label, our own board status only (never paid, refunded or told to GloriaFood). On days
              before today, orders imported from GloriaFood&apos;s export (migration 162) come too, marked{' '}
              <Mono>imported</Mono>, in Done and view only. See Cash Reconciliation, GloriaFood. A board move
              to ready / completed also reaches the kitchen screens, and the kitchen moves the board status
              (migration 178, see Kitchen screens → GloriaFood orders).
            </P>
            <H3>Transactions: online sales with tender</H3>
            <P>
              <Mono>services/onlineSalesSvc.js</Mono> is the one implementation of the online sales list:{' '}
              <Mono>onlineTransactions(tx, {'{ tenantId, venue, from, to, source, tender, countedOnly }'})</Mono>{' '}
              reads <Mono>orders</Mono> + <Mono>order_payments</Mono> (succeeded / partially_refunded /
              refunded) and <Mono>gloriafood_orders</Mono> for one venue, and{' '}
              <Mono>transactionsCsv(report)</Mono> writes the same rows as CSV. Routes in{' '}
              <Mono>routes/orders.js</Mono>, both <Mono>web_orders</Mono> view, venue checked by{' '}
              <Mono>venueOf()</Mono>, at most 366 days (<Mono>MAX_DAYS</Mono>), at most 20,000 rows per
              source (<Mono>truncated</Mono>). Admin: <Mono>components/orders/TransactionsReport.jsx</Mono>{' '}
              (the Transactions tab in <Mono>pages/Orders.jsx</Mono>), which only shows what the route returns.
            </P>
            <DataTable
              head={['Part', 'Rule']}
              rows={[
                ['GET /api/orders/transactions?venue_id&from&to[&source=web|gloriafood&tender=<key>&counted=1]', "{ venue, currency, from, to, gloriafood: { day_basis, day_starts_at } | null, totals { orders, not_counted, sales_pence, refunded_pence, net_pence, tip_pence, discount_pence, fees_pence, tax_pence, average_pence }, by_tender [{ key, label, orders, sales_pence, refunded_pence, net_pence, web { orders, net_pence }, gloriafood { ... } }], by_source, tenders, sources, rows, truncated }. tenders / sources list the whole range whatever the filters (the page's pickers); totals and rows follow the filters."],
                ['GET /api/orders/transactions.csv', "Same query, text/csv, filename online-sales-<venue>-<from>-to-<to>.csv. Columns Date, Time, Ready for, Source, Order, Type, Status, Counted, Tender, Tender detail, Total, Tips, Discounts, Delivery and fees, VAT / tax, Refunded, Net; pounds with two decimals; times at the venue; text cells starting with = + - @ get a leading ' so spreadsheets don't run them."],
                ['Days', "Own orders by service_date. GloriaFood orders by the venue's GloriaFood link: day_basis fulfill (fulfill_at) or accepted (accepted_at), each trading day from day_starts_at (tradingDay() from loyverseSvc.js, dayOf() binary search), so a day matches Cash Recon's Fill from GloriaFood."],
                ['Counted', "Own: placed / accepted / preparing / ready / completed; rejected and cancelled listed as not counted; pending_payment and expired left out. GloriaFood: countsInRecon() (accepted, source not admin); cancelled and test orders listed as not counted. Sales = counted totals (tips in, discounts off); net = total - refunded (GloriaFood refunded is always 0: refunds stay in GloriaFood)."],
                ['Tenders', "One list for both sources (TENDERS): cash, card_counter, card_phone, online, test, unpaid, plus other:<raw>. Own orders: the largest successful payment's gateway (ownTenderKey(): cash, card_terminal, demo, a gateway with online = true), several payments named in tender_detail; no payment = unpaid with the order's payment method as detail. GloriaFood: gfTenderKey(payment) (CASH, CARD, CARD_PHONE, ONLINE; export wording kept as other:<wording>), detail = split methods, card type, Imported."],
                ['Privacy', "No guest names, emails, phones or addresses in the rows or the CSV."],
              ]}
            />
            <H3>Promotions (migration 131)</H3>
            <P>
              Module <Mono>promotions</Mono> (group <Mono>web_ordering</Mono>), page{' '}
              <Mono>pages/Promotions.jsx</Mono> (<Mono>/promotions</Mono>), API{' '}
              <Mono>routes/promotions.js</Mono> (<Mono>/api/promotions</Mono>: GET list with uses and
              discount given, GET /catalog, POST, PUT /:id, PATCH /:id/active, PATCH /reorder, DELETE).
              The discount rules are one file, <Mono>shared/promotions.js</Mono>:{' '}
              <Mono>priceBasket(itemsById, lines, {'{ tipPercent, promos, promoCtx }'})</Mono> calls{' '}
              <Mono>applyPromotions()</Mono>, so the server (<Mono>createOrder()</Mono>, the quote
              route) and the guest page (served as <Mono>/order-api/promotions.js</Mono>, which imports{' '}
              <Mono>/order-api/menuSchedule.js</Mono>) take off exactly the same amounts.
            </P>
            <DataTable
              head={['Table / column', 'Notes']}
              rows={[
                ['promotions', "Tenant-wide. kind basket | item | bogo | free_item | bundle | tiered (132); discount_type percent | amount + discount_value (% or pence); item_ids + section_ids (item/bogo scope, both empty = every dish); buy_qty, get_qty, get_percent (bogo); min_subtotal_pence, required_item_ids (any one), max_discount_pence; apply_mode auto | manual | code + code (unique per tenant, case-insensitive); max_uses; schedule jsonb (menu schedule shape); venue_ids (empty = all); exclusive; sort_order = priority; badge_text, description."],
                ['bundle, bundle_price_pence, tiers (migration 132)', "bundle jsonb [{ label, item_ids, section_ids, qty }] (max 8) + bundle_price_pence for meal deals; tiers jsonb [{ min_pence, value }] (max 10, stored sorted, distinct min_pence) for tiered offers, value in discount_type. routes/promotions.js clean() clears the fields a kind doesn't use (e.g. discount_value = 0 for bogo / free_item / bundle / tiered)."],
                ['order_promotions', "One row per promotion an order used: promotion_id (SET NULL on delete), copied name and code, discount_pence."],
                ['orders.discount_pence, order_items.discount_pence', "subtotal_pence stays the full price; total = subtotal - discount + tip. Line VAT is on line_total - line discount. The tip % and the platform fee are on the discounted subtotal; the minimum order is checked on the full subtotal."],
              ]}
            />
            <DataTable
              head={['Rule', 'Where / how']}
              rows={[
                ['In play', "Automatic ones; manual ones in promoCtx.chosen (OrderBody.promo_ids); code ones in promoCtx.unlocked (ids found from OrderBody.promo_codes by findByCode()). Each must pass isLiveAt(): is_active, venue_ids, menuOnAt(schedule, at) with at = venue-local time of ordering."],
                ['Conditions', "unmet(): min_subtotal (before discounts), required_item, no_items (item/bogo with no covered dish), bogo_qty (fewer than buy + get covered units)."],
                ['Order', "sort_order ascending. Each promotion discounts what is left on each line (rem[]). Exclusive: applies only when nothing has yet, then closes the list; skipped ones get a not_combinable notice."],
                ['New kinds (132)', "free_item: the get_qty cheapest covered units (item_ids / section_ids) are get_percent off; its min spend excludes the value of those units (freeUnits()); none covered = free_item_missing. bundle: bundleFill() forms as many complete deals as the basket allows, each part filled with the dearest matching units not used yet; each deal's discount = its units' value - bundle_price_pence, spread over its units; nothing formed = bundle_missing with missing: [{ index, label, qty }] (no_items when no unit matches any part). tiered: tierFor() picks the highest tier with min_pence <= the full subtotal, applied like a basket discount; below the first tier, or after applying with a higher tier left = next_tier { short_pence, value, discount_type }. Auto promotions nudge on min_subtotal, bogo_qty, free_item_missing, bundle_missing, next_tier (NUDGES)."],
                ['Rounding', "Fractional per-unit discounts (bogo, free_item, bundle) go through settle(): the total is rounded once and split by allocate(), so a £15 meal deal costs exactly £15.00 (rounding each line separately could take a penny too many)."],
                ['Maths', "basket: % of the remaining total, or min(amount, remaining), spread over lines by allocate() (largest remainder, whole pence). item: per covered line, % of remaining or amount x qty. bogo: covered units sorted dearest first, in each group of buy + get the get cheapest are get_percent off. max_discount_pence scales the lines down with allocate()."],
                ['Guest feedback', "offers (manual ones that would apply, with saving_pence), notices (min_subtotal with short_pence, bogo_qty with more, required_item, no_items, not_now, not_combinable). Automatic ones only produce min_subtotal / bogo_qty notices. noticeText() words them."],
                ['Tenant scoping', "Every promotions query filters tenant_id itself (as well as RLS, forced since migration 176): listPromotions(tx, tenantId), venuePromotions(tx, venue, today) (uses venue.tenant_id), lockUses(tx, tenantId, ids), codeTaken(tx, tenantId, ...), and /catalog's menus, sections, dishes and venues. Update, switch, reorder and delete add AND tenant_id, so another tenant's id is a 404. orders.js venueOf() checks the venue belongs to the tenant (current_setting('app.tenant_id'))."],
                ['Dish picker (admin)', "DishPicker shows the chosen dishes and sections as removable chips plus a Choose / Change dishes button; the menu tree is DishPickerModal (z-[60], above the editor), which edits a copy: Done writes it back, Cancel drops it. Names come from the catalog; ids no longer on a menu show as Removed dish / Removed section."],
                ['Uses', "Orders not rejected / cancelled / expired (promoSvc FREE_STATUSES). venuePromotions() drops used-up and ended ones; createOrder() calls lockUses() (FOR UPDATE on limited promotions, then a count) inside its transaction and returns 422 code promo_invalid when one has just run out. An unknown code is also 422 promo_invalid."],
              ]}
            />
            <DataTable
              head={['Route', 'Notes']}
              rows={[
                ['GET /order-api/venues/:id', "Adds promotions (running, non-code, publicPromotion(): no code) and has_promo_codes."],
                ['POST /order-api/venues/:id/promo-code', "{ code } -> { promotion } including its code, or 404 \"That code isn't valid\". The page keeps unlocked promotions and chosen offer ids in localStorage maca_promos_<venueId> and re-checks saved codes on load."],
                ['POST .../quote, POST .../orders', "promo_codes (max 5) and promo_ids (max 20) in the body."],
                ['GET /order-api/orders/:token, admin order detail and board', "promotions: [{ name, code, discount_pence }] (loadOrderPromotions())."],
                ['GET /api/orders/report', "totals.discount_pence, days[].discount_pence, promotions: [{ name, orders, discount_pence }]."],
              ]}
            />
            <P>
              Guest page (<Mono>shared/ordering.eta</Mono>): discount rows in the basket, checkout and
              status page; offers with Apply; notices (free_item_missing and bundle_missing carry a
              Choose / Add &lt;part&gt; button, data-promo-dish + data-part, handled by showPromoDish():
              one matching dish opens its sheet, several jump to the first one&apos;s section, switching
              menu tab if needed; coversIds() is exported for this); the promo code box; badge_text on
              dishes an item / bogo / free_item / bundle promotion covers (<Mono>promoBadges()</Mono>, live ones only); the promo box
              (migration 134: <Mono>promotions.show_in_box</Mono>, <Mono>box_bg</Mono> / <Mono>box_text</Mono> theme role or #hex,{' '}
              <Mono>box_image_url</Mono>; never for code promotions, forced off by <Mono>clean()</Mono> and{' '}
              <Mono>publicPromotion()</Mono>). <Mono>boxPromos()</Mono> / <Mono>promoCardHtml()</Mono> /{' '}
              <Mono>promoBoxHtml()</Mono> draw it twice, <Mono>.mo-promos--side</Mono> at the top of the basket column
              (the column then stops sticking and the basket sticks inside it, <Mono>.has-promos</Mono>) and{' '}
              <Mono>.mo-promos--top</Mono> under the title (phones, pop-up basket); one card at a time in a
              scroll-snap track with dot buttons, both kept on <Mono>state.promoIdx</Mono> by{' '}
              <Mono>syncPromoBoxes()</Mono>. Automatic text colour reads the role's real colour and picks dark
              text on a light background (<Mono>isLight()</Mono>). Card actions: Apply offer / Remove (manual),
              Applied −£x or the promotion's notice, See dishes / Start your deal (<Mono>showPromoDish()</Mono>).
              The Online ordering block's <Mono>show_promo_box</Mono> (default on) hides it. The old offers strip
              under the title is gone. Deep links: <Mono>?promo=CODE</Mono> checks and applies a code,{' '}
              <Mono>?offer=&lt;id&gt;</Mono> chooses a manual offer; both are then removed from the
              address. On a <Mono>promo_invalid</Mono> error the page re-reads the venue&apos;s
              promotions and re-checks its codes. Staff: the order detail, printed ticket and
              confirmation email show one line per promotion.
            </P>
            <H3>Promo block (promo_cta)</H3>
            <P>
              <Mono>blocks/promo_cta.eta</Mono>, editor <Mono>PromoCtaEditor.jsx</Mono>, canvas{' '}
              <Mono>PromoCtaCanvas</Mono> in <Mono>canvas/dataBlocks.jsx</Mono> (same markup; keep in
              step). Data: promo_id, heading, text, show_code, show_terms, button_text, button_link,
              style banner | card, bg / fg (theme roles), container. <Mono>loadOrRender404()</Mono>{' '}
              attaches <Mono>site_promotions</Mono> (<Mono>sitePromotions()</Mono> in siteRenderer.js:
              running today per <Mono>promoRunning()</Mono>, with summary, terms and link from{' '}
              <Mono>promoSummary()</Mono> / <Mono>promoTerms()</Mono> / <Mono>promoLink()</Mono>). Live
              data, not in the published snapshot, so the block hides as soon as the promotion stops.
              A one-venue promotion links to <Mono>/locations/:slug/order</Mono> when there are several
              ordering venues. The site bundle now carries <Mono>tenant_id</Mono> for this.
            </P>
          </section>

          <section id="loyalty" data-doc="">
            <H2>Loyalty</H2>
            <P>
              Migration 211. Points, stamp cards and rewards, earned and spent at every venue of a tenant taking part,
              on the till, the self-order kiosks and online ordering; a guest web app with an emailed sign-in code;
              Apple Wallet and Google Wallet cards; a members list (basic CRM) with export and erasure. The rules live
              once in <Mono>shared/loyalty.js</Mono> (used by the API, the till, the kiosk, the guest ordering page and
              the admin); the service is <Mono>api/src/services/loyaltySvc.js</Mono>, the wallet cards{' '}
              <Mono>api/src/services/walletSvc.js</Mono>. Admin: <Mono>pages/Loyalty.jsx</Mono> (<Mono>/loyalty</Mono>,
              tabs Overview, Programme, Rewards, Stamp cards, Members, Wallet), Platform → Wallet
              (<Mono>components/platform/WalletCard.jsx</Mono>).
            </P>
            <H3>Tenant programmes and the network programme</H3>
            <P>
              A programme is a <Mono>loyalty_programmes</Mono> row with a scope: <Mono>tenant</Mono> (one per tenant,
              made on first read by <Mono>ensureProgramme()</Mono>, starts switched off) or <Mono>network</Mono>{' '}
              (Macaroonie&apos;s own, <Mono>tenant_id</Mono> NULL, seeded switched off). Members of different tenants
              with the same email are linked by <Mono>loyalty_identities</Mono> (only the sha-256 of the email, global,
              system mode only), so a network programme can later count across tenants without copying anyone&apos;s
              details. Only tenant programmes are built: the network row, the identities and the{' '}
              <Mono>network</Mono> feature switch are there, nothing reads them yet.
            </P>
            <H3>Tables</H3>
            <DataTable
              head={['Table', 'Holds']}
              rows={[
                ['loyalty_programmes', 'enabled, settings (normaliseProgramme(): name, points { label, per_pound, min_spend_pence, welcome, expiry_months }, features { points, stamps, rewards, wallet_apple, wallet_google, web_app, network }, channels { till | kiosk | online: { earn, redeem } }, venue_ids (null = every venue), signup { ask_phone, terms_text, marketing_text, welcome_text }, card colours), member_seq.'],
                ['loyalty_rewards', 'data (normaliseReward(): kind amount_off | percent_off | free_item, value, item_ids / section_ids, min_spend_pence, channels, valid_days, image), points_cost (null = not for points), is_active, sort_order.'],
                ['loyalty_stamp_cards', 'data (normaliseStampCard(): stamps_needed, earn { per item | visit, item_ids, section_ids, min_spend_pence, max_per_sale }), reward_id (ON DELETE RESTRICT).'],
                ['loyalty_members', 'member_no (9 digits, Luhn), card_token (the QR code, unique), status active | closed | erased, name, email, email_hash, phone, points, points_earned / spent, visits, spend_pence, consents, notes, tags, customer_id, identity_id, wallet_token (sealed) and wallet times.'],
                ['loyalty_ledger', 'Every change of points or stamps: kind earn | redeem | release | adjust | welcome | expire | stamps | card_full, points, stamps, stamp_card_id, source (check | order | redemption | staff | join | expiry | stamp_card + source_id), venue, channel, spend. A redemption takes and gives back points once (partial unique index).'],
                ['loyalty_member_rewards', 'Rewards a member holds (from a full stamp card or given by staff): available | reserved | used | expired | cancelled, expires_at.'],
                ['loyalty_redemptions', 'A reward taken out to spend: reserved (points taken at once) → used (on a check or an order) or released (points / held reward back). channel, venue, check_id or order_id, discount (what it may take off), used_event_id, expires_at (2 hours; an online order\'s 1 day).'],
                ['loyalty_codes / loyalty_sessions', 'The web app\'s emailed codes (hash of email + code, attempts, 15 minutes) and sign-ins (hash of the token, 120 days).'],
                ['loyalty_wallet_settings / loyalty_wallet_devices', 'A tenant\'s own Apple / Google accounts (sealed) and the Apple devices holding a member\'s pass (push tokens sealed).'],
                ['pos_checks / orders', 'loyalty_member_id and loyalty_settled_key (what settling last saw).'],
              ]}
            />
            <P>
              Every table has forced RLS. Modules <Mono>loyalty</Mono> (programme, rewards, stamp cards, wallet) and{' '}
              <Mono>loyalty_members</Mono> (the members list: personal data), group <Mono>loyalty</Mono>; the
              migration adds a Loyalty link after Customers in every tenant&apos;s main menu.
            </P>
            <H3>Earning: settling a sale</H3>
            <P>
              Points and stamps are never added by the device. <Mono>settleCheck(tenantId, venueId, checkId)</Mono>{' '}
              and <Mono>settleOrder(tenantId, orderId)</Mono> work out what a sale should give its member now
              (<Mono>pointsFor()</Mono> on the spend after discounts, without tips or charges, less refunds;{' '}
              <Mono>stampsFor()</Mono> per active card; nothing while the channel doesn&apos;t earn at the venue) and
              add the difference from what the ledger already holds for that source (<Mono>settleSource()</Mono>,
              under an advisory lock per source). So a refund, a member put on after paying, or a member changed on
              the check all settle by themselves, and running it twice changes nothing. A till check earns once{' '}
              <Mono>closed</Mono>; an online order once paid (or completed). A full stamp card gives its reward
              (<Mono>fillStampCard()</Mono>, one held reward per filling, keyed so it is given once) and the extra
              stamps carry on.
            </P>
            <P>
              Calls: <Mono>settleChangedChecks()</Mono> after <Mono>POST /pos-api/events</Mono> (checks with a member
              or a reward), <Mono>settleLoyalty()</Mono> after every online order change in{' '}
              <Mono>orderSvc.js</Mono>, both not awaited. <Mono>sweepLoyalty()</Mono> in the minute hold sweep
              settles anything whose <Mono>loyalty_settled_key</Mono> is behind (checks of the last 30 days, orders
              of 60), releases reservations past their time that are on no check, takes off points past the
              programme&apos;s expiry (the whole balance after the months with no activity), marks held rewards past
              their date expired, and deletes old codes and sessions; then <Mono>pushWalletUpdates()</Mono>.
            </P>
            <H3>Spending: reserve, use, release</H3>
            <P>
              <Mono>reserveReward()</Mono> takes a reward out for a member at a venue and channel: points off now
              (ledger <Mono>redeem</Mono>) or the held reward reserved, and a <Mono>loyalty_redemptions</Mono> row
              with the discount it may give. The till and kiosk then put the member on the check (event{' '}
              <Mono>check.member_set</Mono>) and the reward on it (<Mono>discount.applied</Mono> with{' '}
              <Mono>loyalty_redemption_id</Mono>, made by <Mono>tillDiscount()</Mono>). The sequencer asks{' '}
              <Mono>loyaltyNeed()</Mono> / <Mono>loyaltyProblem()</Mono> against the store&apos;s{' '}
              <Mono>loadLoyaltyRedemption()</Mono> (same venue, same member, not used by another event, not
              released, the discount no bigger than allowed and on a dish it covers) and marks it used once with{' '}
              <Mono>useLoyaltyRedemption()</Mono>. A store without them (the venue hub) refuses: rewards need the
              internet. A member can&apos;t be taken off a check while a reward is on it. Settling releases a
              redemption whose discount came off, whose check was voided or merged, or that never made it onto a
              closed check (<Mono>releaseRedemption()</Mono>: points or held reward back, once).
            </P>
            <P>
              Kiosk orders are built by <Mono>kioskOrder()</Mono> with <Mono>opts.loyalty</Mono>{' '}
              (<Mono>{'{ member, rewards: [{ redemption_id, reward }] }'}</Mono>): the member event, then a discount per
              reward; one that no longer fits the basket is left off (<Mono>skipped</Mono>) and goes back when the
              order closes. <Mono>KIOSK_EVENTS</Mono> takes <Mono>check.member_set</Mono> and only loyalty discounts.
              Online, the quote prices picked rewards with <Mono>rewardDiscount()</Mono> inside{' '}
              <Mono>priceBasket()</Mono> (last, on what combos and promotions left; error code <Mono>reward</Mono>),
              and <Mono>createOrder()</Mono> reserves them in the order&apos;s transaction (all rolled back if
              anything refuses), with the order&apos;s <Mono>loyalty_member_id</Mono>; cancelling, rejecting or
              expiring releases them.
            </P>
            <H3>Device routes (routes/loyaltyPos.js, inside the /pos-api device scope)</H3>
            <DataTable
              head={['Route', 'Does']}
              rows={[
                ['POST /pos-api/loyalty/lookup', '{ code } (a scanned card, ML1.<token>, or a member number) or { q } (tills only: exact email by hash, phone, name, member number). Returns members (memberSummary(): points, stamps, rewards to spend; a kiosk gets the first name only, no email or phone) and whether earn / redeem are on here.'],
                ['POST /pos-api/loyalty/members', 'Tills only: join a guest (agreed: true required), 201 new or 200 the existing member.'],
                ['POST /pos-api/loyalty/redemptions', '{ member_id, reward_id | member_reward_id, check_id }: reserve a reward for this device\'s venue and channel.'],
                ['POST /pos-api/loyalty/redemptions/:id/release', 'Put back a reward that never went on the check.'],
              ]}
            />
            <P>
              <Mono>deviceLoyalty(tx, tenantId, venueId, channel)</Mono> puts <Mono>loyalty</Mono> (null = off here)
              into <Mono>tillConfig()</Mono>, <Mono>kioskConfig()</Mono> and the ordering page&apos;s venue reply.
              Till: <Mono>pos/src/components/LoyaltyModal.jsx</Mono> (check actions → the programme&apos;s name;{' '}
              <Mono>QrScan.jsx</Mono> uses <Mono>BarcodeDetector</Mono> where the browser has it, else a scanner
              typing into the box). Kiosk: <Mono>pos/src/kiosk/Loyalty.jsx</Mono> (<Mono>LoyaltyBlock</Mono> on the
              order page, the scan sheet, the join QR code), <Mono>state.loyalty</Mono> and{' '}
              <Mono>loyaltyForOrder()</Mono> in <Mono>kiosk/store.js</Mono>, words <Mono>loyalty_*</Mono> in{' '}
              <Mono>shared/kioskText.js</Mono> (nine languages). Previews show the block but never take a reward out.
            </P>
            <H3>The guest web app and its API (routes/loyaltyApi.js, /loyalty-api)</H3>
            <P>
              The guest&apos;s card, sign-in and join are one module, <Mono>api/src/assets/loyaltyApp.js</Mono>,
              served as <Mono>/loyalty-api/app.js</Mono>: <Mono>mountLoyalty(el, opts)</Mono> draws into any element
              (styles scoped to <Mono>.mloy</Mono>, coloured by <Mono>--mloy-*</Mono> variables the host sets; opts{' '}
              <Mono>slug</Mono>, <Mono>title</Mono>, <Mono>alwaysTitle</Mono>, <Mono>intro</Mono>, <Mono>titleTag</Mono>,{' '}
              <Mono>parts</Mono> {'{ how, stamps, rewards, history, settings, wallet }'}, <Mono>autofocus</Mono>). Two
              hosts use it: the stand-alone web app <Mono>views/site/loyalty.eta</Mono> (served by{' '}
              <Mono>serveLoyaltyApp()</Mono> in <Mono>services/loyaltyPage.js</Mono> with its own manifest and a small
              service worker) at <Mono>loyalty.{'{root}'}/&lt;site slug&gt;</Mono> (<Mono>routes/loyaltySite.js</Mono>,
              platform host kind <Mono>loyalty</Mono>, reserved subdomain), and the website&apos;s{' '}
              <Mono>loyalty_card</Mono> block (below) on the built-in Loyalty page <Mono>/loyalty</Mono> or any page.
              The session is kept in <Mono>localStorage</Mono> <Mono>mcrn_loyalty_&lt;slug&gt;</Mono>; the ordering page
              reads the same key, so one sign-in covers both on the tenant&apos;s site. A sign-in or sign-out
              dispatches <Mono>mcrn-loyalty-session</Mono> on <Mono>window</Mono> (and other tabs see the storage
              event), so every card block and the ordering page on the page follow it.
            </P>
            <DataTable
              head={['Route', 'Does']}
              rows={[
                ['GET /t/:slug', 'The programme in public words: name, points (label, per pound, welcome), how (earnText()), rewards for points, stamp cards, the sign-up words, web_app and which wallets are on. 404 while loyalty is off. Signing in needs the web app on, or online ordering earning or spending.'],
                ['POST /t/:slug/code', 'Email a six-digit code (15 minutes; the reply is the same for members and others; at most 4 an hour per address, 6 a minute per IP).'],
                ['POST /t/:slug/verify', 'A member gets { session, member }; anyone else a join ticket (30 minutes). Five wrong tries end the code.'],
                ['POST /t/:slug/join', 'With the join ticket, a name and agreed: true (the words stored with the time), optional phone and newsletter: 201, welcome points.'],
                ['GET /t/:slug/me, /me/rewards', 'The card (Authorization: Loyalty <session>): points, stamps, held rewards, history, the QR code. /me/rewards (the ordering page) also returns the member\'s name, email and phone to fill checkout.'],
                ['GET /app.js, /qr.js', 'assets/loyaltyApp.js (the card for the web app and the Loyalty card block) and shared/qr.js. Public, cached 5 minutes.'],
                ['PATCH /t/:slug/me, POST /me/new-card, GET /me/export, POST /me/delete, POST /me/signout', 'Their details and newsletter, a new card token, their data as JSON, erase themselves, sign out.'],
                ['POST /t/:slug/me/wallet/apple, GET /pass/loyalty.pkpass', 'A signed link (15 minutes) to the member\'s .pkpass (applePass(): pass.json, icons drawn in the brand\'s colours, manifest, PKCS#7 signature by openssl, zipped without dependencies).'],
                ['POST /t/:slug/me/wallet/google', 'The Add to Google Wallet link (googleSaveUrl(): a loyalty class and object in an RS256 JWT).'],
                ['/apple/v1/...', 'Apple\'s pass web service: register / unregister a device, the serials updated since, the latest pass, the log. The pass\'s serial is the member id; its authenticationToken is the sealed wallet_token.'],
              ]}
            />
            <H3>Wallet accounts</H3>
            <P>
              Macaroonie&apos;s Apple Pass Type ID (certificate, key, Apple WWDR) and Google Wallet issuer (service
              account) are saved on the Platform page (<Mono>platform_secrets</Mono> <Mono>wallet_apple</Mono> /{' '}
              <Mono>wallet_google</Mono>, sealed JSON; <Mono>/api/loyalty/platform/wallet[/:kind]</Mono>). A tenant may
              save its own instead (<Mono>PUT /api/loyalty/wallet/:kind</Mono>, owner or admin;{' '}
              <Mono>loyalty_wallet_settings</Mono>), checked before saving (the key belongs to the certificate, not
              run out). Cards are always in the tenant&apos;s brand (<Mono>cardColours()</Mono>: the programme&apos;s
              card colours, else <Mono>tenant_site.theme.colors</Mono>). <Mono>pushWalletUpdates()</Mono> sends an
              APNs push (HTTP/2, the pass certificate) to the devices of members whose{' '}
              <Mono>wallet_updated_at</Mono> is after <Mono>wallet_pushed_at</Mono>, and patches their Google object.
              Env (only changed for stand-in servers): <Mono>APPLE_APNS_URL</Mono>, <Mono>GOOGLE_WALLET_API_URL</Mono>,{' '}
              <Mono>GOOGLE_OAUTH_TOKEN_URL</Mono>.
            </P>
            <H3>Staff API (routes/loyalty.js, /api/loyalty)</H3>
            <DataTable
              head={['Route', 'Permission']}
              rows={[
                ['GET /programme, /catalog, /wallet', 'loyalty view'],
                ['PUT /programme; POST / PUT / DELETE /rewards[/:id], PATCH /rewards/reorder; /stamp-cards', 'loyalty manage (a reward someone used can\'t be deleted: switch it off)'],
                ['GET /teaser', 'website or loyalty view (the Loyalty block\'s preview: loyaltyTeaser())'],
                ['GET /members, /members/:id', 'loyalty_members view'],
                ['POST /members, PATCH /members/:id, POST .../adjust, .../rewards, DELETE .../rewards/:rid, POST .../new-card, .../redemptions/:rid/release, GET .../export, /members.csv', 'loyalty_members manage'],
                ['POST /members/:id/erase', 'loyalty_members manage + owner or admin'],
                ['PUT /wallet/:kind', 'loyalty manage + owner or admin'],
                ['/platform/wallet[/:kind]', 'platform admin'],
              ]}
            />
            <P>
              Reward and stamp card dishes are kept only when they are the tenant&apos;s (another tenant&apos;s
              ids are dropped), and so is a stamp card&apos;s reward that isn&apos;t the tenant&apos;s.
            </P>
            <H3>The Loyalty page and the Loyalty card block (migration 214)</H3>
            <P>
              <Mono>website_pages.system_key</Mono> takes <Mono>'loyalty'</Mono> beside <Mono>'order'</Mono>: the
              built-in Loyalty page, seeded for every site by migration 214 and by <Mono>ensureSystemPages()</Mono>{' '}
              (<Mono>services/systemPages.js</Mono>, which replaced <Mono>orderPage.js</Mono>) for new ones, with one{' '}
              <Mono>loyalty_card</Mono> block. <Mono>/loyalty</Mono> on the tenant&apos;s site renders it through{' '}
              <Mono>page.eta</Mono> with <Mono>loyaltyPwa</Mono> (the head links <Mono>/loyalty/manifest.webmanifest</Mono>{' '}
              and marks it noindex), 404 while <Mono>bundle.site_loyalty</Mono> is null; a snapshot from before 214
              uses <Mono>DEFAULT_LOYALTY_PAGE</Mono>. The pages API guards it like the ordering page (no delete,
              unpublish, modal or slug change, 422). Addresses of built-in pages come only from{' '}
              <Mono>pagePath()</Mono> / <Mono>SYSTEM_PAGES</Mono> in <Mono>shared/sitePages.js</Mono> (site routes,
              sitemap and llms.txt, LinkPicker, the Pages list); the sitemap leaves <Mono>/loyalty</Mono> out.
            </P>
            <P>
              The block: <Mono>views/site/blocks/loyalty_card.eta</Mono> renders a container and a module script calling{' '}
              <Mono>mountLoyalty()</Mono> with its options as JSON (<Mono>&lt;</Mono> escaped); nothing while{' '}
              <Mono>site_loyalty</Mono> is null. Data: heading (blank: the programme name, signed out only; set:
              also on the card, <Mono>alwaysTitle</Mono>), intro, show_how / show_stamps / show_rewards /
              show_wallet / show_history / show_settings (on unless false), container narrow | boxed | wide,
              boxed_step, accent (buttons) and panel (boxes) as theme roles or codes, card_bg / card_text (blank:
              the programme&apos;s card colours, <Mono>loyaltyTeaser().card</Mono> from <Mono>cardColours()</Mono>).
              Canvas <Mono>LoyaltyCardCanvas</Mono> in <Mono>canvas/dataBlocks.jsx</Mono> (a signed out / signed in
              sample, its own QR code), editor <Mono>editors/LoyaltyCardEditor.jsx</Mono>.
            </P>
            <H3>Checkout: member or guest</H3>
            <P>
              In <Mono>views/site/shared/ordering.eta</Mono>, checkout with loyalty on (<Mono>data.loyalty</Mono>) and
              nobody signed in starts with <Mono>whoHtml()</Mono> (Sign in or join, with what the order earns, or
              Continue as a guest) and the order summary only. <Mono>loy.who</Mono> is <Mono>member</Mono> |{' '}
              <Mono>guest</Mono> | null: a guest pick is kept in <Mono>sessionStorage</Mono>{' '}
              <Mono>mcrn_order_who_&lt;slug&gt;</Mono> for the visit; member shows the sign-in steps (gated
              <Mono> loyaltyHtml(q, true)</Mono> with Continue as a guest instead) until signed in; a session already
              in <Mono>localStorage</Mono> skips the question. <Mono>loadLoyalty()</Mono> fills empty name, email and
              phone from <Mono>/me/rewards</Mono> and remembers what it filled (<Mono>loy.filled</Mono>); sign out
              clears those fields (unless the guest changed them) and asks again.
            </P>
            <H3>The Loyalty website block (loyalty_cta)</H3>
            <P>
              <Mono>views/site/blocks/loyalty_cta.eta</Mono>, canvas <Mono>LoyaltyCtaCanvas</Mono> in{' '}
              <Mono>canvas/dataBlocks.jsx</Mono>, editor <Mono>editors/LoyaltyCtaEditor.jsx</Mono>. Data: heading,
              text, show_rewards, button_text, style banner | card, bg / fg (theme roles or a code), container. The
              words come from <Mono>bundle.site_loyalty</Mono> (<Mono>loyaltyTeaser()</Mono>, added to every site
              render in <Mono>loadOrRender404()</Mono>, live like promotions), null while loyalty or the web app is
              off, and then the block renders nothing.
            </P>
            <H3>GDPR</H3>
            <P>
              <Mono>exportMember()</Mono>: the member&apos;s columns (not the card token), points history, rewards,
              redemptions. <Mono>eraseMember()</Mono>: releases reserved rewards, deletes sessions, codes and wallet
              devices, cancels held rewards, clears staff notes on the ledger and the member&apos;s name, email,
              email_hash, phone, notes, tags, consents, newsletter, customer and identity links; a new random card
              token stops the card; status <Mono>erased</Mono>. The ledger keeps its numbers. The identity row goes
              when no member uses it. Customers → Anonymise calls <Mono>eraseMembersOfCustomer()</Mono> in the same
              transaction (by customer id or any of the emails it anonymises). The newsletter is set only by the
              guest (joining, the web app); staff can only take it off.
            </P>
          </section>

          <section id="ai-assistant" data-doc="">
            <H2>Pepper (AI assistant) &amp; MCP</H2>
            <P>
              Booking by chat started with migration 148; the staff side is now{' '}
              <strong>Pepper</strong>, with tools for every area of the app (migration 173 renamed
              the nav link and moved the module into its own group). The name is one constant,{' '}
              <Mono>ASSISTANT_NAME</Mono> in <Mono>shared/assistant.js</Mono>, used by the staff
              prompt, the MCP server metadata and messages, and the admin (sidebar button, drawer,
              Pepper page, phone tile, shortcut). The guest chat and guest connector stay neutral
              ("the booking assistant on the website of ..."). One tool layer, <Mono>api/src/ai/tools</Mono>, serves
              four front ends, each a <Mono>channel</Mono>:
            </P>
            <DataTable
              head={['Channel', 'Entry point', 'Who / scope', 'Model']}
              rows={[
                ['staff_chat', 'POST /api/ai/chat (Ask Pepper drawer, /ai page, /mobile/assistant)', 'A logged-in staff member, their tenant', 'Ours (Claude, platform pays)'],
                ['staff_mcp', 'POST /mcp/staff/:tenantSlug (routes/mcp.js)', 'Bearer access token (mcp_..., expires; can be read only) or Auth0 JWT, one tenant. Lists only the tools the person can use: toolAllowed() in tools/index.js (View on one of the area\'s SECTION_MODULES, Manage for a change tool, via permissionLevels() in auth.js), and for a read-only token no change tools (a call to one is refused)', 'The client\'s own AI app'],
                ['guest_chat', 'POST /ai-api/chat (website ai_chat block, routes/aiApi.js)', 'A guest on one tenant\'s site', 'Ours'],
                ['guest_mcp', 'POST /mcp (routes/mcp.js)', 'Anyone, every tenant with guest_mcp_enabled', 'The guest\'s own AI app'],
              ]}
            />
            <H3>Tools</H3>
            <P>
              <Mono>tools/guest.js</Mono>: find_restaurants, get_restaurant (includes today's date at
              the venue), check_availability, hold_table, confirm_booking, release_hold,
              request_booking_code, verify_booking_code, get_booking, change_booking, cancel_booking.{' '}
              <Mono>tools/staff.js</Mono>: list_venues, find_bookings, get_booking, day_overview,
              check_availability, create_booking, change_booking, set_booking_status,
              update_guest_details, add_booking_note.{' '}
              <Mono>tools/hs.js</Mono> (staff, health &amp; safety): hs_status, food_safety_day,
              log_temperature, log_hold_check, log_cooking_check, log_delivery, add_corrective_action,
              checklists_due, get_checklist, tick_checklist, list_hs_actions, add_hs_action,
              complete_hs_action. <Mono>tools/purchasing.js</Mono> (staff, purchasing): 5 reads and 17
              change tools, below. <Mono>tools/menus.js</Mono> (staff, menus): 3 reads and 9 change
              tools, below. <Mono>pickByName()</Mono> (id, exact, starts with, contains, every
              word; ambiguous asks, at most 20 choices listed) is in <Mono>tools/util.js</Mono>, shared by
              the staff tools. The other areas are in <Mono>tools/rota.js</Mono>,{' '}
              <Mono>cash.js</Mono>, <Mono>orders.js</Mono>, <Mono>venue.js</Mono>,{' '}
              <Mono>site.js</Mono> and <Mono>general.js</Mono> (below). A tool is{' '}
              <Mono>{'{ name, section, title, description, input (Zod), run(ctx, input), readOnly, confirm, destructive, describe() }'}</Mono>{' '}
              (<Mono>tools/index.js</Mono>); the Zod schema goes to the model and MCP clients as JSON
              Schema via zod-to-json-schema.
            </P>
            <P>
              <Mono>section</Mono> is the area (<Mono>SECTIONS</Mono> in <Mono>tools/index.js</Mono>:
              general, bookings, customers, venue, hs, rota, cash, orders, till, menus, purchasing,
              website, support). The older files don&apos;t set it; <Mono>withSection()</Mono> tags
              their tools by file. The registry throws at start-up on a staff tool without a known
              section, two staff tools with one name, or a missing core tool, so a mistake fails the
              deploy instead of a chat. <Mono>CORE_TOOLS</Mono> (list_venues, find_bookings,
              day_overview, check_availability, hs_status, whos_working, open_page, how_do_i,
              day_briefing) are loaded in
              every staff chat request; the rest are found with tool search (The chat loop, below).
              Over MCP every tool is listed in full.
            </P>
            <P>
              Helpers in <Mono>tools/util.js</Mono> for the newer tools: <Mono>VenueText</Mono> +{' '}
              <Mono>venueFor()</Mono> (a venue by name or id, or the only venue; several and none
              named is a 422 listing them), <Mono>venueToday()</Mono>, <Mono>addDays()</Mono>,{' '}
              <Mono>mondayOf()</Mono>, <Mono>shortDate()</Mono> ("Fri 12 Oct"),{' '}
              <Mono>money()</Mono> / <Mono>pence()</Mono>, <Mono>plural()</Mono> and{' '}
              <Mono>audited(ctx, tool, input, fn)</Mono> (runs a change and writes its{' '}
              <Mono>ai_actions</Mono> row, failure included). <Mono>requireStaffPermission()</Mono>{' '}
              (<Mono>context.js</Mono>) words a refusal per module (<Mono>DENIED</Mono>, falling back
              to the module label from <Mono>config/modules.js</Mono>), e.g. "You don&apos;t have
              permission to see rota pay".
            </P>
            <P>
              Staff tools never write bookings with their own SQL when an admin route does the job:
              they call the route in-process with <Mono>callApi()</Mono> (<Mono>app.inject</Mono>, the
              caller's own Authorization header plus <Mono>X-Tenant-Id</Mono>), so role checks, RLS,
              emails and timeline pushes are the admin portal's. Each tool also checks{' '}
              <Mono>permissionLevel(req, 'bookings')</Mono> (view to read, manage to change), so custom
              roles apply. Reads are direct SQL with an explicit <Mono>tenant_id</Mono> filter. Guest
              tools call the public <Mono>/widget-api</Mono> the same way (slots, hold, confirm), so an
              AI booking follows the booking widget's rules. Moving a booking (both audiences) is{' '}
              <Mono>rescheduleBooking()</Mono> in <Mono>services/guestBookingSvc.js</Mono>, shared with
              the guest manage page: party size, cutoff (guests only), the slot grid, keep the table
              if it still fits else <Mono>allocateBestFit</Mono> with no displacement.
            </P>
            <P>
              In-process calls carry <Mono>x-maca-internal: INTERNAL_CALL_SECRET</Mono> (random per
              process, <Mono>middleware/auth.js</Mono>). It lets an access token through on the admin
              API (tokens are refused there otherwise) and keeps the calls out of the global rate limit
              (<Mono>allowList</Mono> in app.js).
            </P>
            <H3>Staff: booking past the usual limits</H3>
            <P>
              <Mono>create_booking</Mono> and <Mono>change_booking</Mono> take{' '}
              <Mono>override_limits</Mono>, and staff party sizes go up to 300 (<Mono>StaffPartySize</Mono>;
              guests stay at 50). The limits it covers are the venue's party-size range (
              <Mono>booking_rules.min_covers</Mono>/<Mono>max_covers</Mono>) and the time slot's covers
              limit (the sitting or slot cap, <Mono>reason = 'full'</Mono> from{' '}
              <Mono>get_available_slots()</Mono>). Without the flag the tool refuses with a ToolError
              that names the limit and says to call again with <Mono>override_limits: true</Mono>, so
              the model asks first. With it, the card gets <Mono>warningTitle</Mono> +{' '}
              <Mono>warnings</Mono> (an amber box in <Mono>ActionCard</Mono>) and the audit row's
              result carries <Mono>overridden_limits</Mono>.
            </P>
            <DataTable
              head={['', 'New booking (newBookingPlan() in tools/staff.js)', 'Move (rescheduleBooking(..., { staff, overrideLimits }))']}
              rows={[
                ['Inside the limits', 'Normal hold + confirm on the free table from the slots route', 'Unchanged'],
                ['Past a limit', 'POST /api/bookings/admin-override with table_ids from allocateBestFit({ ignoreMinCovers: true }) (a combination sends its member tables)', 'Skips the party-size and covers checks, keeps the table if it fits ignoring its minimum, else allocateBestFit({ ignoreMinCovers })'],
                ['No free table fits', 'table_ids: [] → the Unallocated row', 'ensureUnallocatedTable() → the Unallocated row'],
                ['Still refused', 'A time that isn\'t a booking time (outside sittings, past the cutoff or booking window), a blocked time (cap 0), or within the limits with no free table', 'Same'],
              ]}
            />
            <P>
              The card is built from the same code as the run: <Mono>describe()</Mono> calls{' '}
              <Mono>newBookingPlan()</Mono>, and for a move <Mono>rescheduleBooking()</Mono> with{' '}
              <Mono>dryRun: true</Mono> (every check, no UPDATE, returns{' '}
              <Mono>{'{ limits, unallocated, table }'}</Mono>). <Mono>overrideLimits</Mono> only takes
              effect with <Mono>staff: true</Mono>; the guest manage page and guest tools never pass
              it. <Mono>ensureUnallocatedTable()</Mono> (<Mono>occupancySvc.js</Mono>) finds or makes
              the venue's Unallocated row; <Mono>admin-override</Mono> now uses it (it used to 422
              when the row didn't exist) and checks that <Mono>venue_id</Mono> and{' '}
              <Mono>table_ids</Mono> belong to the caller's tenant. A slot with no covers limit (
              <Mono>available_covers</Mono> NULL) no longer fails a move.
            </P>
            <H3>Staff: health &amp; safety tools</H3>
            <P>
              <Mono>tools/hs.js</Mono>. Same rules as the booking tools: each tool checks the
              module the admin page uses (<Mono>checklists</Mono>, <Mono>food_safety</Mono>,{' '}
              <Mono>hs_action_log</Mono>; view to read, manage to change) with{' '}
              <Mono>requireStaffPermission()</Mono>; reads go through the admin GET routes or SQL
              with an explicit <Mono>tenant_id</Mono>; every change goes through the admin route with{' '}
              <Mono>callApi()</Mono>, is a confirm tool with a card, and is audited in{' '}
              <Mono>ai_actions</Mono> (<Mono>booking_id</Mono> null).{' '}
              <Mono>hs_status</Mono> calls <Mono>computeHsStatus()</Mono>, moved from{' '}
              <Mono>routes/dashboardTiles.js</Mono> to <Mono>services/hsStatus.js</Mono> so the
              Overview tiles and the assistant share it; it needs view on checklists or food safety and
              shows only the parts the person can see (the overall status only with both).
            </P>
            <DataTable
              head={['Tool', 'Route(s)', 'Notes']}
              rows={[
                ['food_safety_day', 'GET equipment, capture-times, temp-logs, hold-stations, hold-capture-times, holds, cooking-sessions, cooking, deliveries; GET /api/hs-settings', 'Missing checks split into missing (time passed) and later_today; out_of_range_without_action lists reading_ids'],
                ['log_temperature / log_hold_check', 'POST /food-safety/temp-logs | /holds', 'Unit by name (pickByName); check time named, or today the latest started (pickCheckTime); another day with several times must name one. Card shows a reading it replaces and an Out of range box'],
                ['log_cooking_check', 'POST /food-safety/cooking', 'Dish matched against loadCookingPicker() (GET /cooking/items) → menu_item_id or cooking_item_id, else dish_name; session like the Cooking tab\'s sessionForNow'],
                ['log_delivery', 'POST /food-safety/deliveries', ''],
                ['add_corrective_action', 'PATCH /food-safety/temp-logs|holds|cooking|deliveries/:id', 'The reading is loaded with a tenant filter for the card'],
                ['checklists_due / get_checklist', 'GET /checklists/due, /checklists/instance', ''],
                ['tick_checklist', 'GET then PUT /checklists/instance', 'Sends every active task with its new tick and existing note, and the instance notes (the PUT replaces them all); completion still comes from the route'],
                ['list_hs_actions / add_hs_action / complete_hs_action', 'GET, POST /hs-action-log/entries, PATCH .../:id/complete', 'Category by name from GET /hs-action-log/categories'],
              ]}
            />
            <P>
              Dates default to today in the venue's time zone and are always sent to the routes (the
              food safety POSTs would otherwise default to the server's UTC date).
            </P>
            <H3>Staff: purchasing tools</H3>
            <P>
              <Mono>tools/purchasing.js</Mono>. Every read and change goes through the purchasing
              routes with <Mono>callApi()</Mono> (<Mono>/api/inventory</Mono>, <Mono>/api/suppliers</Mono>,{' '}
              <Mono>/api/purchasing</Mono>), so the routes' permission gates and price hiding apply
              unchanged: without <Mono>purchasing_setup</Mono> view the routes strip prices, and the
              tools only print prices the route returned. Direct SQL (each with an explicit{' '}
              <Mono>tenant_id</Mono>) is used only for venues, a PO number to id, suppliers' delivery
              settings for the place-order card (<Mono>supplierInfo()</Mono>: the same{' '}
              <Mono>supplierForVenue()</Mono> + <Mono>nextDeliveryDate()</Mono> as the route) and the
              chat's attachments. Change tools are confirm tools; <Mono>describe()</Mono> and{' '}
              <Mono>run()</Mono> share one plan function each (<Mono>newItemPlan</Mono>,{' '}
              <Mono>priceChangePlan</Mono>, <Mono>planOrder</Mono>, <Mono>receivePlan</Mono>, ...), so the
              card shows what the run does. Every change is audited in <Mono>ai_actions</Mono>.
            </P>
            <DataTable
              head={['Tool', 'Permission', 'Route(s)', 'Notes']}
              rows={[
                ['find_inventory_items', 'setup view', 'GET /inventory/items, /quotes/:id/history', 'Search name/code words, category, supplier; venue_id adds ordered_at_venue (chooseQuote); history when 5 or fewer match. 40 shown'],
                ['list_suppliers', 'setup view', 'GET /suppliers, /suppliers/:id', 'One supplier: venue settings and up to 150 products'],
                ['order_lists', 'either view (a list\'s items: setup view)', 'GET /purchasing/lists, /lists/:id', 'Pars shown in packs of the company-choice quote'],
                ['order_form', 'either view', 'GET /orders?status=draft, GET /orders/:id, POST /orders', 'Opens the venue\'s draft for the list (named, the venue\'s only list, or without_list); makes an empty draft only with purchasing manage, like opening the list on the page. Not a confirm tool'],
                ['purchase_orders', 'either view', 'GET /pos, /pos/:id', 'po = PO-00012, 12 or an id (resolved with a tenant filter); status open = to_send,sent'],
                ['add_inventory_item', 'setup manage', 'POST /categories, /items, /items/:id/quotes', 'Up to 5 prices; base unit from counted_in or the first pack unit; unknown category is made, unknown supplier refused'],
                ['update_inventory_item', 'setup manage', 'PATCH /items/:id', 'Only changed fields are sent; counted_in refused while it has quotes'],
                ['add_supplier_price / update_supplier_price', 'setup manage', 'POST /items/:id/quotes, PATCH /quotes/:id, PUT /quotes/:id/venue-prices', 'A price is item + supplier (+ which: supplier code or pack words); a same-pack duplicate is refused; 20% or bigger price changes warn on the card'],
                ['set_preferred_supplier', 'setup manage', 'PUT /items/:id/preferred', 'venue_id or company; clear: true'],
                ['add_supplier / update_supplier', 'setup manage', 'POST, PATCH /suppliers, PUT /suppliers/:id/venues', 'Days as names; a venue setting is merged into the full PUT list (the route replaces all)'],
                ['create_order_list / update_order_list / set_pars', 'setup manage', 'POST, PATCH /lists, PUT /lists/:id/venues|items|pars', 'Items by name or code, every unknown name in one error; pars in packs (company-choice quote) or g/kg/ml/cl/l/each, stored in base units'],
                ['import_price_list', 'setup manage', 'POST /inventory/import (dry_run on the card)', 'rows (up to 100 per call, read by the model from a PDF, photo or email; a longer list is one call and one card per 100) become a CSV with the template headings; attached_file is a text/CSV ai_attachments row of this conversation and this user (chat only). All rows bad = refused'],
                ['update_order', 'purchasing or approve manage', 'PUT /orders/:id/lines', 'planOrder(): the venue\'s draft, or order_id (orderVenue(), openOrder()); lines (on the order by code/name, else GET /venues/:id/catalog), supplier/pack switch (quote_id sent only then), fill_to_par (packsToPar), clear_all; only changed lines are sent. assertCanEdit(): a request waiting for approval only for an approver'],
                ['request_order', 'purchasing manage', 'PUT /orders/:id/lines, POST /orders/:id/request', 'Card per supplier: the day wanted (deliveries[].date, else "next delivery day when placed": only given days are stored), lines, note for the manager'],
                ['order_requests', 'any view', 'GET /orders?status=requested|draft, /orders/:id', 'Waiting orders (up to 15 in full: lines with asked_for), sent-back drafts with the reason, you_can_approve. Also a day_briefing part (orders_to_approve)'],
                ['send_back_order', 'approve manage', 'POST /orders/:id/return', 'order_id + reason'],
                ['split_order', 'approve manage', 'POST /pos/:id/split | /orders/:id/split', 'po or order_id; lines (item, packs) to move; delivery_date (deliveries[] per supplier for a request); splitPlan() refuses the same day, a past day, more than a line holds and the whole order; the card warns when the supplier already has the PO'],
                ['place_order', 'approve manage (requirePlace(): else "use request_order")', 'PUT /orders/:id/lines, POST /orders/:id/submit', 'The draft, or order_id for a request. Card per supplier: delivery date (deliveries[].date, else the day the request asked for, "(as asked)", else next delivery), how it is sent, lines at fitQty(); warns on rounding, minimum order, a missed cutoff, a date off the delivery days, no email address. Only overrides and notes are sent, so the route still picks the date at run time. The card pins planned_delivery { supplierId: date } for suppliers without a date given; run() refuses (409) when a supplier\'s first delivery day has moved since (a cutoff passed), so the order is never placed for a day the card didn\'t show'],
                ['send_purchase_order', 'purchasing or approve manage', 'POST /pos/:id/send | /mark-sent', 'email needs an address (resend allowed, warned); other ways need To send'],
                ['change_purchase_order', 'purchasing or approve manage; lines and add: approve', 'PATCH /pos/:id, PUT /pos/:id/lines', 'Lines and add only while To send; add only from the PO\'s supplier (GET /venues/:id/catalog?supplier_id=); a product already on the order tops its line up, and the card says so; an empty order is refused'],
                ['cancel_purchase_order', 'approve manage', 'POST /pos/:id/cancel', 'Warns to tell the supplier when already sent'],
                ['receive_delivery', 'purchasing or approve manage', 'POST /pos/:id/receive', 'Lines not named arrived as ordered (or keep what an earlier booking-in recorded); chilled/frozen temperature asked for when such goods arrived; writes fs_delivery_checks'],
              ]}
            />
            <P>
              Quantities on orders are packs of the chosen quote, as on the Purchasing page. Both
              chat (<Mono>TOOL_LABELS</Mono> in <Mono>chat.js</Mono>) and Activity (
              <Mono>AiAssistant.jsx</Mono>, <Mono>changeDetail()</Mono>) label the new tools. The
              staff prompt (<Mono>prompts.js</Mono>) says to prefer <Mono>receive_delivery</Mono>{' '}
              over <Mono>log_delivery</Mono> when a delivery has a purchase order.
            </P>
            <H3>Staff: menu tools</H3>
            <P>
              <Mono>tools/menus.js</Mono>. Reads need <Mono>menus</Mono> view; changes and publishing
              need <Mono>menus</Mono> manage (<Mono>requireEdit()</Mono>, the menu write routes&apos;
              own rule since the View / Manage rollout). Change tools write the draft and say so
              (<Mono>SAVED</Mono> / <Mono>REMOVED</Mono> messages); <Mono>publish_menu</Mono> makes
              it live (migration 165, see Menus &rarr; Publishing). Every menu read goes through <Mono>GET /api/menus</Mono> /{' '}
              <Mono>GET /api/menus/:id</Mono> (<Mono>loadMenuFull()</Mono>), tags through{' '}
              <Mono>GET /menus/dietary/all</Mono>, option groups through{' '}
              <Mono>GET /menus/variant-groups</Mono>; <Mono>list_menus</Mono> counts dishes with SQL
              filtered by <Mono>tenant_id</Mono>.
            </P>
            <P>
              Every change is the menu&apos;s own whole-tree save (<Mono>PATCH /api/menus/:id</Mono>,{' '}
              <Mono>upsertMenuTree()</Mono>). The body comes from <Mono>menuSaveBody(full)</Mono>,
              exported from <Mono>routes/menus.js</Mono>: it turns <Mono>loadMenuFull()</Mono> output
              back into the PATCH body with every menu, section, dish and footer-note field and their
              ids, so an untouched save changes nothing (tested by a round trip) and print designs,
              combos and till fields keep pointing at the same rows. <Mono>/duplicate</Mono> uses
              it too (with fresh ids). A tool edits that body and <Mono>saveBody()</Mono> renumbers{' '}
              <Mono>sort_order</Mono> by position and PATCHes. <Mono>describe()</Mono> and{' '}
              <Mono>run()</Mono> share one plan function each (<Mono>planCreate</Mono>,{' '}
              <Mono>planAdd</Mono>, <Mono>planUpdateDish</Mono>, <Mono>planPrices</Mono>, ...); the run
              reloads the menu and re-applies the plan, so an edit made on the Menus page between the
              card and Confirm is kept.
            </P>
            <DataTable
              head={['Tool', 'Route(s)', 'Notes']}
              rows={[
                ['list_menus', 'GET /menus?status=1 + SQL counts', 'Venue, shown_to_guests, publish (live / draft changes not published / never published, scheduled publish), sections, dishes'],
                ['get_menu', 'GET /menus/:id[?version=live], /menus/variant-groups', 'The draft unless version live (404 text when never published); dishes with price or option prices (the dish\'s own, from loadMenuFull options[]), allergens with level, dietary, calories, online off, a combo\'s steps; descriptions with details or one section; lists tags and option groups; publish status'],
                ['find_dishes', 'GET /menus, /menus/:id?version=live, /menus/dietary/all', 'search words, has (all tags), free_from (allergens; removable listed as ask_for_it_without, may_contain blocks); live versions shown to guests unless include_unpublished (adds hidden menus, and drafts of menus never published, marked not_published) or version draft; 60 shown'],
                ['create_menu', 'POST /menus, PATCH /menus/:id (DELETE on failure)', 'Sections and up to 50 dishes in one call (BATCH_DISHES); unpublished unless published: true. A bigger menu: the rest with add_dishes, see Batches below'],
                ['update_menu', 'PATCH /menus/:id', 'Name, venue / all venues, published, tagline, service times, intro'],
                ['duplicate_menu', 'POST /menus/:id/duplicate (+ PATCH to rename)', 'Copy is unpublished; designs remapped by the route'],
                ['add_dishes', 'PATCH /menus/:id', 'Existing or new sections, up to 50 dishes per call; same-name dish in that section skipped unless update_existing. May name a menu this chat\'s create_menu card is still waiting to make (loadForAdd())'],
                ['update_dish', 'PATCH /menus/:id', 'Fields, allergens / add / remove (with level), dietary the same, options / remove_options, move_to_section, position, after_dish. Name the section when the dish is in several (409 otherwise). Warns on allergen changes and on a price change over 50%'],
                ['remove_dishes', 'PATCH /menus/:id', 'Destructive; warns when a combo offers a removed dish (it loses that choice)'],
                ['update_section', 'PATCH /menus/:id', 'Title, subtitle, visibility, VAT takeaway / eat in, position or after_section'],
                ['remove_section', 'PATCH /menus/:id', 'Destructive; its dishes go too'],
                ['change_prices', 'PATCH /menus/:id', 'Whole menu, sections or dishes; percent / amount / set; round_to 1/5/10/50/100p up, nearest or down; include_options (default on) writes per-dish option overrides'],
                ['publish_menu', 'GET /menus/:id/publish, POST /menus/:id/publish', 'Now, or date + time (venue local via zonedInstant(), menuTz() = the menu\'s venue else the first); card lists diffMenus() changes, warns on price changes, a later scheduled publish and shown_to_guests off; 422 nothing to publish, past time or over 400 days'],
                ['cancel_menu_publish', 'GET /menus/:id/publish, DELETE /menus/:id/releases/:id', 'The one scheduled publish, or the one on date when there are several (409 lists them)'],
              ]}
            />
            <P>
              Options: dishes only use the tenant&apos;s variant groups (<Mono>menu_item_variant_groups</Mono>{' '}
              with per-dish <Mono>overrides</Mono>); the tools never write ad-hoc{' '}
              <Mono>variants</Mono> and never change a group or its options. A choice the group
              doesn&apos;t have is refused with the group&apos;s choices; an unknown group name makes a new
              group (<Mono>POST /menus/variant-groups</Mono>, prices from the first dish that gives
              them) at run time, named in the card&apos;s warnings. Allergens and dietary tags are
              matched to the tenant&apos;s tags by label, code or common names (soy, shellfish, dairy,
              wheat ...); an unknown tag is left off and listed on the card, never created. Prices
              in and out are pounds. Not covered: dish photos, combo steps, print designs and
              print options, till fields, deleting a menu, the tag list.
            </P>
            <P>
              <strong>Batches.</strong> A tool call is written by the model in one reply, and a reply
              stops at <Mono>MAX_TOKENS</Mono> (16,000) in <Mono>chat.js</Mono>; a whole menu read from
              a photo (hundreds of dishes with options and allergens) was cut off and came back as
              "Not done". So <Mono>create_menu</Mono> and <Mono>add_dishes</Mono> take at most{' '}
              <Mono>BATCH_DISHES</Mono> (50) dishes per call, and <Mono>import_price_list</Mono> 100
              rows. The prompt has the model make the menu with its first sections, then call{' '}
              <Mono>add_dishes</Mono> for the rest straight away, a section or two at a time, without
              waiting for the first card. <Mono>loadForAdd()</Mono> makes that work before the menu
              exists: when the named menu isn&apos;t there, it looks for this chat&apos;s latest{' '}
              <Mono>create_menu</Mono> card for that exact name (<Mono>createCardFor()</Mono>). A card
              still waiting: the add card is planned against the menu as that card would make it
              (<Mono>planCreate()</Mono> of its stored input), titled "(new menu)" with a "Confirm ...
              first" line, and its run refuses (409) until the create card has been confirmed. A
              create card cancelled or expired: refused, with "make it again". The exact name match
              stops dishes landing in another menu whose name merely starts the same. A tool call cut
              off anyway gets a result (<Mono>CUT_OFF</Mono>) telling the model to split it.
            </P>
            <H3>Staff: the rest of Pepper (rota, cash, orders, till, customers, venue, website)</H3>
            <P>
              Same rules as the other staff tools: <Mono>requireStaffPermission(ctx, module, level)</Mono>{' '}
              with the page&apos;s own module, every read and change through the admin route with{' '}
              <Mono>callApi()</Mono> (so the route&apos;s gates, figures and redaction apply), confirm
              tools for every change with <Mono>describe()</Mono> and <Mono>run()</Mono> sharing one
              plan function (re-planned at run time, so a change made on the page between the card
              and Confirm is seen), and an <Mono>ai_actions</Mono> row per change through{' '}
              <Mono>audited()</Mono>. Venues are named (<Mono>venueFor()</Mono>); dates default to
              today at the venue. Figures (pay, tips, variance, till totals) are always the
              route&apos;s own: the tools never add them up.
            </P>
            <DataTable
              head={['Tool', 'Permission', 'Route(s)', 'Notes']}
              rows={[
                ['list_staff / whos_working / rota_week', 'staff view / rota view', 'GET /api/rota/venues/:v/staff, /weeks/:monday', 'Working, sick or off, away (off_days), closed days; rota_week also lists removed and away staff'],
                ['set_rota', 'rota manage', 'GET then PUT /api/rota/venues/:v/weeks/:monday/entries', 'rotaPlan(): one week, many changes; people from staff + removed_staff + away_staff; refused on off days with the reason; day_parts takes a shift (the only active one when there is one), hourly takes periods (a shift name gives its times; an overlapping period replaces the old one); status off without shift/times clears the day; an absence status without them marks the day\'s entries. Sends the whole week (the PUT replaces it) and removed_staff_ids only when someone is put back on'],
                ['copy_rota_week', 'rota manage', 'POST .../weeks/:to/copy { from_week }', 'Default last week onto this week; card counts entries replaced'],
                ['rota_pay / rota_tips', 'rota_pay view / rota_tips view', 'GET .../weeks/:monday/pay', 'The redacted pay payload (redactWeek()); a refusal says if the other half is visible'],
                ['add_pay_adjustment / fill_wages_from_rota', 'rota_pay manage', 'POST .../pay-adjustments, .../fill-wages', 'Card warns when the week\'s wages were already filled (SQL with a tenant filter)'],
                ['adjust_tips / set_tip_pot_amounts', 'rota_tips manage', 'POST .../tip-moves, PUT .../pot-lines', 'move / add / remove in points or £; a total split equally to 2dp (remainder to the first person) or per person; pot lines named "Line" or "Pot: Line"'],
                ['add_staff_member / update_staff_member / set_staff_leaving / add_time_off / remove_time_off', 'staff manage', 'POST, PATCH .../staff[/:id], PUT .../leaving, POST / DELETE .../off-periods', 'Leaving and off periods dry-run first so the card counts the rota entries that come off'],
                ['cash_day / cash_week / wages_week', 'cash_recon view', 'GET /api/venues/:v/cash-recon/config, /daily/:date, /week/:monday, /week-detail/:monday, /wages/:monday', 'Variance from the /week route only (the same figure as the page); fields not entered listed'],
                ['record_cash_day', 'cash_recon manage', 'GET then PUT .../daily/:date', 'recordPlan() rebuilds the whole-day body: existing entries kept, every expense with vat_amount and paid_by_card, notes only when given (the PUT keeps the note when the key is absent); income split with splitIncome() from services/reconFill.js, the same split Loyverse / GloriaFood fills use'],
                ['add_expense / submit_cash_day', 'cash_recon manage', 'POST .../expenses, POST .../daily/:date/submit', 'A submitted day refuses a new expense (card and route); the submit card shows the totals and variance'],
                ['mark_wages_paid', 'cash_recon manage', 'GET then PUT .../wages/:monday', 'wagesPlan() rebuilds the whole-week body, changing only cash_amount and paid_date; header notes kept'],
                ['fill_cash_from_till', 'cash_recon manage', 'POST /api/loyverse|gloriafood/venues/:v/preview, /apply', 'Up to 14 days; submitted days skipped; card per day plus payments not mapped'],
                ['online_orders / online_orders_report', 'web_orders view', 'GET /api/orders?venue_id&date, /api/orders/report', 'findOrder(): the day\'s number ("12", "#12", "GF 3"), the guest\'s name, or an id'],
                ['update_online_order', 'web_orders manage', 'POST /api/orders/:id/status | /promised | /mark-paid, /api/orders/gloriafood/:id/status', 'accept (prep_minutes), preparing, ready, collected, reject / cancel (reason; a paid order is refunded by the route), retime, paid_cash, paid_card'],
                ['refund_online_order / pause_online_orders', 'web_orders manage', 'POST /api/orders/:id/refund, /api/orders/pause/:v', ''],
                ['sold_out / set_sold_out', 'web_orders view / manage', 'loadMenuVersions(..., publishedOnly) + soldOutRows(); PUT /api/orders/availability/:v/:itemId', 'Dishes by name on the live menus; every item id with that name is marked (today | indefinite | back on)'],
                ['till_day / till_checks / kitchen_report', 'pos_reports view', 'GET /api/pos/venues/:v/days, /days/:id, /checks, /kitchen-report', 'Default the latest trading day; live X while open, else the Z'],
                ['find_customers / customer_details', 'customers view', 'GET /api/customers?q=, /api/customers/:id', 'find_customers adds each customer\'s next booking (one SQL query, tenant filter)'],
                ['update_customer / unsubscribe_customer / anonymise_customer', 'customers manage', 'PATCH /api/customers/:id, POST .../unsubscribe, .../anonymise', 'anonymise is destructive (MCP destructiveHint); the card says it can\'t be undone'],
                ['opening_times / close_dates / remove_closure', 'schedule view / manage', 'GET /api/venues/:v/schedule, /schedule/exceptions, /schedule/overrides; POST / DELETE /schedule/exceptions', 'A closure is an exception with is_closed and priority 10; the card counts bookings already in the dates (they stay)'],
                ['list_tables', 'tables view', 'GET /api/venues/:v/tables, /combinations', ''],
                ['booking_rules / update_booking_rules', 'rules view / manage', 'GET, POST, PATCH /api/venues/:v/rules', 'PATCH when the venue has rules, else POST the defaults merged with the change (then PATCH the table-joining flags the POST doesn\'t take); hold_minutes → hold_ttl_secs'],
                ['website_status / publish_website / set_website_banner', 'website view / manage', 'GET /api/website/tenant-site[/publish-status], POST .../publish, PATCH /api/website/tenant-site', 'The banner needs no publish; turning it on with no text reuses the last text'],
                ['list_promotions / switch_promotion', 'promotions view / manage', 'GET /api/promotions, PATCH /api/promotions/:id/active', 'Described with promoSummary() / promoTerms() / promoRunning() from shared/promotions.js'],
                ['list_reviews / moderate_review', 'website view / manage', 'GET /api/reviews, /reviews/stats, PATCH /api/reviews/:id', 'A review by id, reviewer name or words from it'],
                ['screens_status / reload_screen', 'screens view / manage', 'GET /api/screens/screens, POST .../:id/reload', ''],
                ['email_log', 'email_templates view', 'GET /api/email-templates/log?limit=200', 'search by guest name or email; only_failed'],
                ['report_issue / list_issues / request_feature', 'issue_log manage / view, feature_requests manage', 'POST, GET /api/issues, POST /api/feature-requests', 'list_issues keeps only this tenant\'s rows (the route lists every tenant only for a platform admin asking with ?scope=all)'],
                ['open_page', 'the page\'s own module, view', 'ROUTE_CATALOG (routes/nav.js) + ALSO synonyms', 'Scored match (exact, starts with, word, synonym); only pages the person can view; staff_chat gets a markdown link [Label](/route) that ChatView renders as an in-app Link (only paths starting with one /), MCP gets the full address on officeOrigin(); several matches return choices'],
                ['how_do_i', 'none (anyone with Pepper; OPEN_TOOLS)', 'searchHelp() in ai/helpIndex.js', 'Up to three Help passages, each with [Help: heading](/help#anchor) in the chat or the full address over MCP; nothing found = answers [] and a note to say so'],
                ['day_briefing', 'each part its own (the reading tools it calls)', 'day_overview, whos_working, hs_status, purchase_orders, cash_day, online_orders, sold_out, email_log, screens_status (tools/briefing.js PARTS)', 'One venue, default today; a part refused with 403 goes in not_included, any other failure is an error line for that part only'],
              ]}
            />
            <H3>Help answers, the day briefing and the page note</H3>
            <P>
              <Mono>how_do_i</Mono> (<Mono>tools/general.js</Mono>) searches the Help page itself:{' '}
              <Mono>ai/helpIndex.js</Mono> reads <Mono>admin/src/pages/Help.jsx</Mono> from the
              checkout (or <Mono>HELP_SOURCE_FILE</Mono>), cuts it at each{' '}
              <Mono>{'<section id data-help>'}</Mono>, H2 and H3, turns the JSX into plain text
              (DataTable rows become lines) and ranks passages with BM25, headings counting three
              times. The index is built on first use and again when the file&apos;s mtime changes, so
              a deploy refreshes it; no database, no embeddings. The Pepper section scores lower
              unless the question is about Pepper. Links go to the subsection:{' '}
              <Mono>helpSlug()</Mono> (<Mono>shared/help.js</Mono>) makes the same anchor on both
              sides, the page&apos;s <Mono>H3</Mono> giving itself that id (only when its heading is
              plain text) and <Mono>Help.jsx</Mono> scrolling to the hash after it renders. A heading
              used twice links to its section instead.
            </P>
            <P>
              <Mono>day_briefing</Mono> (<Mono>tools/briefing.js</Mono>) runs the reading tools in{' '}
              <Mono>PARTS</Mono> side by side as the person asking, so each keeps its own permission
              check, and trims what they return (big parties are 8 or more, lists capped at 10-15).
              A new part is one line in <Mono>PARTS</Mono> calling an existing tool&apos;s{' '}
              <Mono>run()</Mono>; never query tables there.
            </P>
            <P>
              The page note: pages that show one venue and day or week call{' '}
              <Mono>usePepperPage({'{ venueId, date | week }'})</Mono> (<Mono>lib/pepperPage.js</Mono>:
              Timeline, Bookings, Rota, Food safety, Online orders, Cash Recon). The drawer&apos;s{' '}
              <Mono>ChatView pageAware</Mono> sends <Mono>page: {'{ path, venue_id, date, week }'}</Mono>{' '}
              with each message (not from /ai or /mobile) and shows it as a chip the person can turn
              off. <Mono>pageNote()</Mono> in <Mono>ai/chat.js</Mono> names the page from{' '}
              <Mono>ROUTE_CATALOG</Mono> (longest matching route) and the venue from the
              tenant&apos;s own venues. Another tenant&apos;s venue id in{' '}
              <Mono>page</Mono> is refused by <Mono>refuseOtherTenantsVenues</Mono> like any body.
            </P>
            <P>
              The date line: every staff chat message, from any screen, starts with{' '}
              <Mono>nowNote()</Mono>: <Mono>{'[Now: <weekday day month year> (YYYY-MM-DD), HH:MM.]'}</Mono>{' '}
              at the tenant&apos;s active venues (one line per time zone, with the venue names when there
              are several). The model has no clock: without it, a tool that needs a date (then{' '}
              <Mono>day_overview</Mono>, whose date is now optional and defaults to today at the venue)
              got a guessed one, and the model blamed &quot;the app&apos;s clock&quot; (17 Oct 2026).{' '}
              <Mono>contextNote()</Mono> joins the date line and the page line into one text block with{' '}
              <Mono>_context: true</Mono> before the message (older messages carry{' '}
              <Mono>_page: true</Mono>): sent to the model (marker stripped by <Mono>clean()</Mono>),
              left out of the display items and the chat title. The staff chat&apos;s instructions say
              how to use both lines. The date never goes into the system prompt, which is stored once
              per chat and replayed with the cache. MCP clients get no line (their own app knows the
              date); their tools default to today where a date is optional.
            </P>
            <P>
              Every change tool has a chat label (<Mono>TOOL_LABELS</Mono> in <Mono>chat.js</Mono> for
              reads, the card title for changes) and an Activity label and detail
              (<Mono>AiAssistant.jsx</Mono>: <Mono>TOOL_LABELS</Mono>, <Mono>changeDetail()</Mono>).
            </P>
            <H3>Confirm cards (chats)</H3>
            <P>
              A tool with <Mono>confirm: true</Mono> does not run when the model calls it in a chat:{' '}
              <Mono>handleToolUse()</Mono> in <Mono>ai/chat.js</Mono> stores an{' '}
              <Mono>ai_pending_actions</Mono> row (tool, input, the card from{' '}
              <Mono>describe()</Mono>, the model's tool_use_id, expiry: 30 minutes or the hold's
              expiry) and tells the model a card is waiting. <Mono>POST .../actions/:id/confirm</Mono>{' '}
              claims the row (no double run), runs the tool with the stored input, and appends the
              outcome to the conversation as a user note (<Mono>_note: 'action'</Mono>, stripped
              before sending) that the model reads next turn. Cancel on a booking card releases its
              hold. Over MCP, run() is called directly; the client's own app asks the person.
            </P>
            <P>
              <Mono>run()</Mono> re-plans from the stored input, so the run sees anything changed on
              the pages since the card. Inputs that mean "now" would also be worked out again (today,
              this week, the check due now, the day's order 12), which after midnight or a check time
              is a different day, check or order. So <Mono>describe()</Mono> returns{' '}
              <Mono>pin</Mono>: the values the card was built with (<Mono>date</Mono>,{' '}
              <Mono>week</Mono>, <Mono>from</Mono> / <Mono>to</Mono>, an order or check time by id,
              a refund&apos;s amount). <Mono>handleToolUse()</Mono> merges it into the input,
              re-validates it with the tool&apos;s schema and stores that; the card itself never holds
              it. A pinned refund amount that is no longer available fails at Confirm instead of
              refunding a different sum.
            </P>
            <H3>Guest change / cancel: emailed code</H3>
            <P>
              <Mono>ai/codes.js</Mono>. <Mono>request_booking_code(reference, email)</Mono> finds the
              booking by its 8-character reference (<Mono>upper(left(id::text, 8))</Mono>) and email,
              stores a sha256 of a 6-digit code (15 minutes, 5 tries, at most 3 codes per booking per
              hour), emails it through the venue's provider (<Mono>email_log.template_type =
              'ai_access_code'</Mono>) and always gives the same answer, so bookings can't be probed.{' '}
              <Mono>verify_booking_code</Mono> returns an access key (<Mono>bk_...</Mono>, hashed in{' '}
              <Mono>ai_booking_grants</Mono>, 30 minutes) for that booking only. The AI never sees
              the manage token.
            </P>
            <H3>The chat loop</H3>
            <P>
              <Mono>runTurn()</Mono>: every model call is <Mono>callModel()</Mono>, a stream
              (<Mono>client.beta.messages.stream</Mono>, the whole message from{' '}
              <Mono>finalMessage()</Mono>) with the chat&apos;s model (<Mono>modelOf()</Mono>, see
              Model routing), <Mono>output_config.effort</Mono> (<Mono>AI_EFFORT</Mono>, default
              medium), adaptive thinking (the default), top-level <Mono>cache_control</Mono>,{' '}
              <Mono>max_tokens</Mono> 32,000, and server-side fallbacks (<Mono>fallbacks:
              'default'</Mono>, beta <Mono>server-side-fallback-2026-07-01</Mono>) on every model
              that offers them (<Mono>NO_FALLBACK()</Mono> leaves them off the everyday model). Up
              to 12 model calls per turn (<Mono>MAX_STEPS</Mono>).
              Messages are stored exactly as returned and only appended, with the system prompt the
              conversation started with (<Mono>ai_conversations.system_prompt</Mono>), so every
              request replays the history unchanged: thinking blocks stay valid and the prompt cache
              hits. Back-to-back user rows (a confirm note, then the next message) are merged when
              sent. Every response's usage goes to <Mono>ai_usage</Mono> (and the person's day, see
              Usage below). Claude's own errors after the SDK's two retries (overloaded, rate
              limited, down, cut off mid-reply) become a 503 "Claude is busy" with the cause logged
              at warn.
            </P>
            <P>
              <strong>Refusals.</strong> A refused reply is never stored. On the everyday model the
              chat moves to the main model and the step runs again (it has no server-side fallback).
              On the main model, if nothing of the turn&apos;s reply was stored yet, the person&apos;s
              message is withdrawn too (<Mono>withdrawMessage()</Mono>, as for a file Claude can&apos;t
              take): left in, it would be sent again merged with the next message and most likely
              refused again. The turn returns a <Mono>notice</Mono> saying so; a new chat whose only
              message was refused is deleted, and the reply&apos;s <Mono>conversation_id</Mono> is
              null.
            </P>
            <P>
              <strong>Streaming (server-sent events).</strong> <Mono>POST /api/ai/chat</Mono> and{' '}
              <Mono>POST /ai-api/chat</Mono> stream when the request says{' '}
              <Mono>Accept: text/event-stream</Mono> (<Mono>ai/sse.js</Mono>; without it they answer
              JSON once, as before). The stream opens with the first event, so anything refused before
              the message is stored (no access, allowance used up, the chat busy) is still a plain JSON
              error. Events, each <Mono>event: type</Mono> + <Mono>data: JSON</Mono>:{' '}
              <Mono>start</Mono> (conversation_id, title; the website chat adds guest_key),{' '}
              <Mono>text</Mono> (key = step-block, delta), <Mono>activity</Mono> (Thinking...,
              Finding the right tool..., Looking it up..., Getting a card ready...),{' '}
              <Mono>step</Mono> (a lookup&apos;s line), <Mono>card</Mono> (a pending card as{' '}
              <Mono>actionView()</Mono>), <Mono>discard</Mono> (drop the text of a refused step), then{' '}
              <Mono>done</Mono> (the same body as the JSON reply: conversation_id, title,
              stop_reason, notice, items) or <Mono>error</Mono> (status, error, conversation_id,{' '}
              <Mono>withdrawn</Mono> when the message was taken back out). A comment line goes out
              every 15 s, and <Mono>X-Accel-Buffering: no</Mono> stops nginx holding events back
              (needed on the tenant-site server blocks, which buffer). Closing the page doesn&apos;t stop
              the turn: writes after that are dropped and the reply is in the chat later.{' '}
              <Mono>runTurn(ctx, conv, text, &#123; emit &#125;)</Mono> sends the events;{' '}
              <Mono>streamEvents()</Mono> turns the SDK&apos;s stream events into text and activity,{' '}
              <Mono>handleToolUse()</Mono> sends steps and cards. A listener error never stops a turn.
            </P>
            <P>
              Admin side: <Mono>api.stream(path, body, onEvent)</Mono> in <Mono>lib/api.js</Mono>{' '}
              (fetch with the auth headers, <Mono>readEvents()</Mono> parses the stream, resolves with
              done, throws the error event as an <Mono>ApiError</Mono>, or one with status 0 and{' '}
              <Mono>lost</Mono> when the stream ends without either; 45 s without a byte aborts it,
              since the server writes every 15 s). <Mono>ChatView.jsx</Mono> keeps the live items
              (text by key, steps, cards) and the activity line until done replaces them with the
              stored conversation. Cards that arrive during the turn can&apos;t be pressed until it
              ends. After a drop the chat reloads the conversation; <Mono>GET
              /api/ai/conversations/:id</Mono> returns <Mono>running</Mono> (the hold is taken) and the
              chat asks again every 3 s while it is. Notices (the turn stopped early, a refusal) show
              in italics under the conversation. The website chat block (<Mono>ai_chat.eta</Mono>) does
              the same in plain script.
            </P>
            <P>
              <strong>Model routing (migration 175).</strong> A chat starts on the everyday model{' '}
              (<Mono>AI_MODEL_FAST</Mono>) and moves to the main one (<Mono>AI_MODEL</Mono>) for good
              when it needs it (<Mono>upgradeChat()</Mono>, <Mono>ai_conversations.model_tier</Mono>{' '}
              'fast' to 'main'): a file is attached (before the first call), the everyday model calls
              a <Mono>HEAVY_TOOLS</Mono> tool (create_menu, add_dishes, import_price_list: its call is
              answered "Not run yet" and the main model makes it again, so the card is the main
              model&apos;s), a request&apos;s prompt reaches <Mono>LONG_CHAT_TOKENS</Mono> (60,000:
              the steps after it), or the everyday model refuses. A chat never moves back down: the
              main model reads the everyday model&apos;s thinking blocks, the other way round they
              would be dropped. Chats from before routing (tier NULL) stay on the main model.{' '}
              <Mono>AI_MODEL_FAST</Mono> empty, or the same as <Mono>AI_MODEL</Mono>, puts every
              chat on the main model. The move costs one full cache write on the main model. The
              Platform page&apos;s key card shows both models.
            </P>
            <P>
              <strong>One writer per chat (migration 174).</strong> The API runs one process per CPU,
              so an in-memory "running" set only stopped a second message reaching the same process.
              A turn, a Confirm and a Cancel each take <Mono>holdConversation()</Mono>: an UPDATE that
              sets <Mono>ai_conversations.running_until</Mono> to now + 90 s only where it is empty or
              past, so exactly one caller gets the row; the others get a 409 ("Still working on your
              last message"). The hold is renewed every 30 s while the work runs (only while it is
              still ours: <Mono>running_until = held</Mono>) and cleared at the end; if the process
              dies mid-turn it lapses by itself within 90 s. <Mono>withHold()</Mono> wraps{' '}
              <Mono>runTurn()</Mono>, <Mono>confirmAction()</Mono> and <Mono>cancelAction()</Mono>.
              Without it, a Confirm pressed while the model was mid-step could append its note
              between a tool call and its result, and every later request in the chat would fail.
            </P>
            <P>
              <strong>Turn budget.</strong> nginx gives <Mono>/api/ai/</Mono> 300 s (see Deployment,{' '}
              <Mono>ensure-nginx-ai-timeout.sh</Mono>); before that the general 60 s cut long turns
              off with a 504 while they kept running. A turn answered as JSON starts no new step
              after <Mono>TURN_MS</Mono> (240 s); a streamed one, which keeps the connection busy,
              after <Mono>STREAM_TURN_MS</Mono> (600 s). It stops once every tool call of the last step has its
              result stored, replies that it stopped and the person can say "carry on" (stop reason{' '}
              <Mono>time</Mono>). Never after a paused server step, so the history stays valid.
              Before calling the model, the turn refuses a closed chat (see Erasure), a tenant past
              its monthly allowance (<Mono>chatUnitsLeft()</Mono>, 429) and, for staff, a person past
              their daily share (<Mono>personUnitsLeft()</Mono>, 429).
            </P>
            <P>
              <strong>Tool search (staff chat).</strong> Pepper has well over 100 tools; sending them
              all in full every request would cost tokens and blur the model&apos;s choice.{' '}
              <Mono>toolDefs(ctx)</Mono> in <Mono>chat.js</Mono> sends, for{' '}
              <Mono>staff_chat</Mono> only, the server-side search tool{' '}
              <Mono>{'{ type: \'tool_search_tool_bm25_20251119\', name: \'tool_search_tool_bm25\' }'}</Mono>{' '}
              first, the <Mono>CORE_TOOLS</Mono> in full, and every other tool with{' '}
              <Mono>defer_loading: true</Mono> (name and description indexed, schema loaded only when
              a search returns it). No beta header is needed. The response then holds{' '}
              <Mono>server_tool_use</Mono> (id <Mono>srvtoolu_...</Mono>) and{' '}
              <Mono>tool_search_tool_result</Mono> blocks: they are stored and replayed unchanged like
              everything else, and get no <Mono>tool_result</Mono> from us (the API answered them
              itself). A response with <Mono>stop_reason: 'pause_turn'</Mono> (a long server-side
              step paused) is sent back as it is to carry on. The staff prompt lists every area with
              its tool names, so searches hit; the guest chat sends its few tools in full. Not yet
              checked against the live API: an old conversation whose stored blocks name a tool a
              later deploy removed or changed (the tool list is part of what replayed thinking is
              checked against).
            </P>
            <H3>Attached files (migration 150)</H3>
            <P>
              Staff chats only (Ask Pepper, /ai, /mobile/assistant); the website chat and MCP don't take
              files. <Mono>src/ai/attachments.js</Mono> is the one place that handles them:
            </P>
            <DataTable
              head={['Step', 'What happens']}
              rows={[
                ['Upload', 'POST /api/ai/attachments (multipart, field file, one file). saveUpload() works out the kind from the first bytes (JPEG, PNG, GIF, WebP, %PDF-), or from the extension for text (txt, csv, tsv, md, json, log; must be UTF-8 with no NUL bytes), never from the browser\'s Content-Type. Word / Excel / PowerPoint and HEIC get a 422 saying what to attach instead. Size limits per kind (MAX_BYTES: image 5 MB, PDF 10 MB, text 1 MB), 413 over them. Stored in ai_attachments with conversation_id NULL; the same call deletes the caller\'s unsent uploads older than 24 hours.'],
                ['Send', 'POST /api/ai/chat { message, attachments: [ids] }; message may be empty when files are sent. claimAttachments() sets conversation_id on the caller\'s own unsent files only (same tenant, same user_sub), in one transaction with the limits: MAX_PER_MESSAGE 5, MAX_PER_CONVERSATION 10, MAX_CONVERSATION_BYTES 20 MB (keeps every request well under the API\'s 32 MB once base64 adds a third). A file already sent, or someone else\'s, is a 422.'],
                ['Store', 'The user message is stored with attachmentBlocks(): image / document blocks carrying _attachment { id, name, kind, bytes } and a source with no data, files before the text. ai_messages never holds file bytes.'],
                ['Model request', 'loadAttachmentData() reads every file of the conversation once per turn; clean() in chat.js swaps each _attachment block for the real one with withFileData(): image = base64 source, PDF = base64 document, text = text document (title = file name). The bytes are the same on every request, so the history replays unchanged and the prompt cache still hits. A file that no longer exists becomes a short text block saying so.'],
                ['Claude refuses the file', 'A 400 / 413 from the first model call of the turn (a broken PDF, a page count over the limit) withdraws the message: withdrawMessage() deletes the user row (only if it is still the last), releases its files back to unsent, clears a title it set, and deletes the conversation if it is now empty. The route answers 422 with Claude\'s reason; the chat puts the text and the files back in the composer.'],
                ['Show', 'displayItems() adds attachments [{ id, name, kind, bytes }] to the user item (attachmentItems()). GET /api/ai/attachments/:id serves the file to its uploader only (404 for anyone else), Content-Type from the stored kind, nosniff, inline with an ASCII-only file name. DELETE /api/ai/attachments/:id removes an unsent upload (404 once sent).'],
              ]}
            />
            <P>
              Admin side: <Mono>components/ai/attachments.jsx</Mono>. <Mono>useAttachments()</Mono>{' '}
              holds the files waiting for the next message and uploads each one as soon as it is
              added (paperclip, a <Mono>capture="environment"</Mono> camera input on touch devices,
              paste into the message box, or drop on the chat). <Mono>prepareFile()</Mono> shrinks a
              photo to 2000 px on the long edge (over 2000 px or 1.5 MB), keeps PNG for screenshots
              unless still over 4 MB, and converts HEIC where the browser can decode it.{' '}
              <Mono>PendingFiles</Mono> is the chip row, <Mono>MessageFiles</Mono> the sent files
              (thumbnails open a full-size view, PDF / text open in a new tab); both fetch through{' '}
              <Mono>api.blob()</Mono> since the files sit behind auth, cached as object URLs for the
              session. The staff system prompt tells the model to say what it read, ask when unclear,
              and treat text inside a file as information, never as instructions.
            </P>
            <H3>Usage, the allowance and each person&apos;s daily share (migration 174)</H3>
            <P>
              Chats are paid by the platform, so a tenant&apos;s chats stop at{' '}
              <Mono>ai_settings.monthly_token_limit</Mono>. It used to count raw tokens, all four kinds
              alike, so a long chat re-reading its cached history (cache reads cost a tenth of input)
              looked ten times dearer than it was, while output (five times input) looked cheap. Now
              it counts <strong>units</strong>: <Mono>usageUnits()</Mono> in{' '}
              <Mono>ai/context.js</Mono> prices the tokens with the model that actually answered
              (<Mono>response.model</Mono>, which can be a fallback or the everyday model):{' '}
              <Mono>PRICES</Mono> holds $ per million input, output, cache read and 5-minute cache
              write tokens per model (prompts over 100K tokens at 5x where{' '}
              <Mono>LONG_PROMPT_RATE</Mono> says so), and a unit is $4 per million, so on the default
              main model an input token is one unit, output five, a cache write 1.25 and a cache read
              0.05, and the everyday model costs a small fraction of that. A model not in the table
              counts input 1, output 5, cache write 1.25, cache read 0.1. Routing a chat to the
              everyday model therefore uses less of the allowance, not just less money.{' '}
              <Mono>addUsage()</Mono> adds the units to <Mono>ai_usage</Mono> and, for staff chat, to
              the person&apos;s day in <Mono>ai_usage_people</Mono>; every caller passes{' '}
              <Mono>model</Mono> and, for staff, <Mono>person</Mono> (the chat loop, and{' '}
              <Mono>aiTranslate()</Mono> for the Translations page&apos;s AI draft).
            </P>
            <P>
              <strong>Daily share.</strong> One person shouldn&apos;t be able to use a whole
              restaurant group&apos;s month in a day. <Mono>person_daily_pct</Mono> (default 25) gives
              each person that % of the monthly allowance per day (<Mono>dailyShare()</Mono>);{' '}
              <Mono>personUnitsLeft()</Mono> is checked before every staff turn and every AI
              translation draft, 429 with a message saying it starts again tomorrow. null = no daily
              share. The Settings tab (<Mono>AiAssistant.jsx</Mono>) shows the month as a share of the
              allowance, a people card (<Mono>PeopleCard</Mono>: each person&apos;s units this month,
              their share of the month and today against the daily share) and the Fair use and
              privacy card (<Mono>FairUseCard</Mono>: daily share, how long chats are kept; draft,
              Save and Discard). Someone without ai_assistant manage sees only their own line.
            </P>
            <H3>Erasure and retention (migration 174)</H3>
            <P>
              <Mono>src/ai/erase.js</Mono>. Chats and the audit hold guests&apos; names, emails and
              phone numbers (a booking made by chat, a guest looked up), so a GDPR erasure must reach
              them, and chats must not be kept for ever.
            </P>
            <DataTable
              head={['Part', 'What happens']}
              rows={[
                ['eraseFromAi(tx, tenantId, values)', 'Called by POST /api/customers/:id/anonymise inside its own transaction, with every name, email and phone on the customer row and on their bookings and orders (collected before they are overwritten). Identifiers under 3 characters are skipped. Candidate chats are found by text (ILIKE on messages, cards and titles); a chat is only touched when something in it matches as a whole word (case ignored, no letter, digit or _ either side), so erasing a guest called Tom leaves a chat about tomatoes alone. In a matching chat: every message has the identifiers replaced with [removed], thinking blocks dropped (they can\'t be edited and still replay) and file blocks replaced with "[File removed]"; cards scrubbed, and open ones cancelled (result { error: erased }); its files deleted; the title scrubbed; closed_at set with closed_reason erased. ai_actions rows that match get input and result scrubbed and redacted_at. A first name alone, or a phone written another way, isn\'t matched.'],
                ['Closed chats', 'The stored history is replayed to the model unchanged, so an edited one can\'t carry on: runTurn() refuses it (409), the conversation responses carry closed, ChatView shows a notice and a Start a new chat button instead of the composer, and the chat list marks it. anonymise_customer, run from a chat, closes that chat too (the Confirm reply carries closed); its audit row is written by customer id, and the Confirm note uses the card title as it is after the erasure (titleNow()).'],
                ['cleanUpAi(log)', 'The hourly ai-cleanup BullMQ job (startAiCleanupWorker() in jobs/queues.js, started by server.js). Per tenant: chats idle (updated_at) longer than chat_retention_days are deleted with their messages, cards and files (cascade), never one held by a running turn; ai_actions input and result cleared after 365 days (redacted_at); unsent uploads after a day; used or expired guest codes and grants after a day; ai_usage_people rows after 400 days. Idempotent, a failure on one tenant is logged and the rest carry on. Needs Redis (the repeat job), like the hold sweep.'],
              ]}
            />
            <H3>Tables</H3>
            <DataTable
              head={['Table', 'Notes']}
              rows={[
                ['ai_settings', 'One per tenant (no row = defaults): guest_mcp_enabled (true), guest_chat_enabled (false), staff_enabled (true), monthly_token_limit (2,000,000 units; platform admin only), person_daily_pct (25; 1-100 or null = no daily share; migration 174), chat_retention_days (90; 30 | 90 | 180 | 365; migration 174).'],
                ['ai_usage', 'Per tenant, month (first day, UTC), channel: requests, input / output / cache read / cache write tokens, and units (migration 174: the tokens weighted by price, usageUnits()). The allowance counts units of staff_chat + guest_chat; MCP channels count calls only. Migration 174 backfilled units with the default weights.'],
                ['ai_usage_people (migration 174)', 'Per tenant, day (UTC), user_sub: user_email, requests, units. Staff chat only (written by addUsage() with a person). The daily share and the Settings tab\'s people card read it; rows older than 400 days are deleted by the hourly clean-up. RLS, every query filters tenant_id.'],
                ['ai_conversations / ai_messages', 'Chats. channel staff_chat (user_sub) or guest_chat (guest_key, a random secret the browser keeps). Messages: seq, role, content jsonb (API content blocks). Migration 174: running_until (the one-writer hold), closed_at + closed_reason (erased: read only, see Erasure), index (tenant_id, updated_at) for the retention clean-up. Migration 175: model_tier fast | main (NULL = main; see Model routing).'],
                ['ai_pending_actions', 'Confirm cards: tool_use_id, tool, input, card {title, lines, confirmLabel, destructive}, status pending | done | cancelled | failed, result, expires_at, decided_at (claim).'],
                ['ai_actions', 'Audit log of every change through AI (all channels): tool, input, ok, result, booking_id (null for anything but bookings), actor. Shown on /ai Activity. redacted_at (migration 174): input and result cleared after a year, or the guest\'s details replaced on erasure.'],
                ['ai_booking_codes / ai_booking_grants', 'Emailed codes and access keys (hashes only).'],
                ['ai_access_tokens', 'Staff MCP tokens: sha256 of mcp_ + 40 hex, prefix, user_id, revoked_at, expires_at (migration 179: 30, 90, 180 or 365 days from making it; 90 by default) and read_only (the connector lists and runs only tools without confirm). Forced RLS like every tenant table: auth.js finds the token in system mode; every query filters tenant_id.'],
                ['bookings.source', 'Which AI channel made the booking (NULL = not AI).'],
                ['platform_secrets (migration 149)', 'Global, no RLS: name, value (sealed since migration 179), hint (last 4), updated_by, updated_at. Rows: anthropic_api_key = the chat key saved on the Platform page; kiosk_preview_key = the key kiosk preview links are signed with. value is never returned by any route.'],
                ['ai_attachments (migration 150)', 'Files attached in staff chats: tenant_id, conversation_id (NULL until sent; ON DELETE CASCADE), user_sub (uploader, the only one who can see or send it), kind image | pdf | text, media_type, filename, bytes, data bytea. Every query filters tenant_id.'],
              ]}
            />
            <H3>Routes</H3>
            <DataTable
              head={['Route', 'Notes']}
              rows={[
                ['GET /api/ai/status', 'configured, enabled, permission, can_chat, units_left (the tenant\'s month), share_left (the caller\'s day; null = no daily share). Drives the Ask Pepper button.'],
                ['POST /api/ai/themes', 'The theme maker: { target, prompt, image, palette, current, like, count } -> { kits, notes }. ai_assistant view + Manage on the target\'s page; counts like a chat. See Website CMS -> Theme maker.'],
                ['POST /api/ai/menus/read', 'Photos or a PDF of a menu (multipart, up to 10 files) -> { menu, notes } to review; nothing saved. Menus manage + ai_assistant view; counts like a chat. See Menus -> Reading a menu from files.'],
                ['POST /api/ai/menus/import', 'The reviewed menu -> an unpublished menu through createMenuFromSections() (Pepper\'s create_menu plan, up to 600 dishes). Menus manage.'],
                ['POST /api/ai/invoices/read', 'A supplier invoice while booking a delivery in: { po_id, files } -> { invoice, catalogue }; the files and reading kept in purchase_invoices. Purchasing or Purchasing approval manage + ai_assistant view. See Purchasing -> Invoices on receiving.'],
                ['POST /api/ai/receipts/read', 'A petty cash receipt: { venue_id, file } -> { merchant, description, date, amount, vat_amount, paid_by_card, category_id, notes }; nothing saved. Cash reconciliation manage + ai_assistant view (services/receiptReadAi.js). See Cash Reconciliation.'],
                ['POST /api/ai/store-openings/wizard, /:id/describe', 'The venue setup wizard: a draft without Pepper; Pepper filling the steps from a description. See New locations.'],
                ['GET/DELETE /api/ai/conversations[/:id], POST /api/ai/chat', 'The caller\'s own chats (user_sub); the list and a chat carry closed (erased, read only), a chat also running (a turn or card holds it). chat { conversation_id?, message, attachments?, page? } returns the whole conversation as display items plus stop_reason and notice; with Accept: text/event-stream it streams (see Streaming above). conversation_id null = a new chat\'s only message was refused and the chat removed. 409 while another turn or a card holds the chat, or when it is closed.'],
                ['POST /api/ai/attachments, GET/DELETE /api/ai/attachments/:id', 'Upload one file (multipart field file) -> { id, name, kind, media_type, bytes }; the file itself, uploader only; remove an unsent upload. See Attached files above.'],
                ['POST /api/ai/actions/:id/confirm | cancel', 'Confirm cards; hold the chat like a turn (409 while it is busy). The reply carries closed: an anonymise card closes the chat it ran in.'],
                ['GET/PATCH /api/ai/settings', 'GET: settings, usage (channels + chat_units), daily_share (units or null), people (peopleUsage(): name or email, requests, units this month, today; everyone for ai_assistant manage, else only the caller\'s own line), MCP addresses. PATCH (ai_assistant manage): the switches, person_daily_pct (1-100 or null), chat_retention_days (30 | 90 | 180 | 365).'],
                ['GET/POST/DELETE /api/ai/tokens[/:id]', 'Own tokens; ai_assistant manage sees and revokes everyone\'s. POST returns the token once.'],
                ['GET /api/ai/activity', 'ai_actions, last 100 (manage).'],
                ['GET/PATCH /api/ai/platform/tenants[/:id]', 'Platform admin: chat_units, mcp_calls and monthly_token_limit (an allowance in units; Platform page, AI usage tab).'],
                ['GET/PUT/DELETE /api/ai/platform/key, POST /api/ai/platform/key/test', 'Platform admin: the Anthropic key. GET = source (platform | env | null), saved hint/by/at, env_hint, model, fast_model (null when routing is off). PUT { api_key } checks it with Anthropic (models.retrieve of AI_MODEL and AI_MODEL_FAST, free) and saves it, 422 with the reason if rejected, warning naming the setting if the key can\'t use a model. DELETE goes back to .env. Never returns the key.'],
                ['/ai-api/*', 'Website chat: tenants/:id/status, chat (streams with Accept: text/event-stream; the start event carries guest_key), conversations/:id?key= (with running), actions/:id/confirm | cancel. Rate limited per IP.'],
                ['POST /mcp, POST /mcp/staff/:tenantSlug', 'MCP Streamable HTTP, stateless (a server per request, JSON responses). GET/DELETE 405. Staff: route config allowAccessToken; a JWT gets X-Tenant-Id from the slug; ai_assistant view + staff_enabled.'],
                ['GET /.well-known/oauth-protected-resource/mcp/staff/:slug', 'RFC 9728 metadata: authorization_servers is the connector\'s own origin (Macaroonie signs apps in itself, migration 181).'],
                ['GET /.well-known/oauth-authorization-server (also openid-configuration, and with a path after it)', 'RFC 8414 metadata from routes/mcpOauth.js: issuer = the origin the app used (publicOrigin()), code flow only, S256 PKCE, public clients (auth method none), scope pepper.'],
                ['POST /oauth/register', 'Dynamic client registration (RFC 7591): redirect_uris (1-10, https, or http on localhost / 127.0.0.1 / [::1], no fragment), client_name; a secret-based auth method is refused. ai_oauth_clients (global, no tenant). 20 a minute per IP.'],
                ['GET /oauth/authorize', 'Unknown client_id or a redirect_uri it didn\'t register: a plain page (never a redirect). Then errors go back to the app (unsupported_response_type, invalid_request without S256 PKCE, invalid_target for a resource that isn\'t /mcp/staff/<an active slug>). Otherwise an ai_oauth_grants row (15 minutes; tenant from resource) and 302 to office /connect-ai?request=<id>.'],
                ['GET /api/ai/oauth/requests/:id, POST .../allow | .../deny', 'The Connect page, as the person (requireAuth). GET: client_name, redirect_host, tenant, member (an active users row in the grant\'s tenant), needs_switch (the selected tenant is another one), problem (Pepper off, no ai_assistant, not a team member), days. allow { read_only, expires_in_days 30 | 90 | 180 | 365 } (409 for another tenant, 403 with problem) stores the person, a code hash and a 5-minute expiry and returns the redirect with code, state and iss (RFC 9207). deny returns error=access_denied. A request is answered once (409), expires (410).'],
                ['POST /oauth/token', 'Form or JSON; grant_type authorization_code only. client_id, redirect_uri and the code must match, code_verifier must hash (S256) to the challenge, the person and tenant must still be active. Makes an ordinary ai_access_tokens row (name "<app> (connected app)", the chosen days and read only, oauth_client_id, oauth_grant_id) and returns it as access_token with expires_in. A code used twice gets invalid_grant and revokes the token the first use made. No refresh tokens: the app signs in again when the token expires. Cache-Control no-store.'],
              ]}
            />
            <H3>Admin and site</H3>
            <P>
              <Mono>components/ai/ChatView.jsx</Mono> (chat, cards, <Mono>useAiStatus()</Mono>, the
              page chip with <Mono>pageAware</Mono>),{' '}
              <Mono>AssistantDrawer.jsx</Mono> (Ask Pepper panel from the sidebar, earlier chats,{' '}
              <Mono>maca_ai_conversation</Mono>), <Mono>pages/AiAssistant.jsx</Mono> (/ai, the
              Pepper page: Chat, Connect, Settings, Activity), <Mono>pages/mobile/MobileAssistant.jsx</Mono>,{' '}
              <Mono>components/platform/AiLimitsPanel.jsx</Mono> with <Mono>AiKeyCard.jsx</Mono>. Website block{' '}
              <Mono>ai_chat</Mono>: <Mono>views/site/blocks/ai_chat.eta</Mono> (vanilla JS, hides
              itself unless /ai-api status is enabled, <Mono>maca_ai_chat_[tenantId]</Mono>), editor{' '}
              <Mono>AiChatEditor.jsx</Mono>, canvas <Mono>AiChatCanvas</Mono> (a still mock).
            </P>
            <H3>Setup</H3>
            <P>
              The key: a platform admin saves it on the Platform page (AI usage tab, migration 149,{' '}
              <Mono>AiKeyCard.jsx</Mono>), or it comes from <Mono>ANTHROPIC_API_KEY</Mono> in{' '}
              <Mono>api/.env</Mono>. A saved key wins. <Mono>src/ai/apiKey.js</Mono> is the one
              place that decides: <Mono>activeKey()</Mono> (cached 15 seconds per process, since PM2
              runs several), <Mono>chatConfigured()</Mono> (async), <Mono>checkKey()</Mono>,{' '}
              <Mono>saveKey()</Mono>, <Mono>removeKey()</Mono>. The chat client is rebuilt when the
              key changes; an authentication error from Anthropic during a chat becomes a 503 telling
              staff the key needs updating. Without any key the chats are off and MCP still works.
            </P>
            <Code>{'# api/.env (optional fallback; a key saved on the Platform page wins)\nANTHROPIC_API_KEY=sk-ant-...\n# AI_MODEL=...        (the main model; default in src/config/env.js)\n# AI_MODEL_FAST=...   (the everyday model chats start on; empty = all on AI_MODEL)\nAI_EFFORT=medium'}</Code>
            <P>
              The connectors live on the apex (<Mono>https://macaroonie.com/mcp</Mono>), which is
              proxied to the API (<Mono>/mcp</Mono>, <Mono>/ai-api</Mono>,{' '}
              <Mono>/.well-known/oauth-protected-resource</Mono>,{' '}
              <Mono>/.well-known/oauth-authorization-server</Mono>,{' '}
              <Mono>/.well-known/openid-configuration</Mono> and <Mono>/oauth/</Mono> are in platformSite.js's{' '}
              <Mono>PASS_PREFIXES</Mono>). Tenant sites proxy everything, so the website chat calls{' '}
              <Mono>/ai-api</Mono> on its own host. Apps that can only connect with OAuth (Claude's
              custom connectors, ChatGPT) sign in through Macaroonie itself (migration 181, see the
              routes above): the app is sent to <Mono>office/connect-ai</Mono>{' '}
              (<Mono>pages/ConnectAi.jsx</Mono>, outside the app shell, inside the login and tenant
              gate), the person taps Allow, and the app gets an ordinary access token. A login that
              starts there comes back there: <Mono>RequireAuth</Mono> passes{' '}
              <Mono>appState.returnTo</Mono> and <Mono>onRedirectCallback</Mono> in{' '}
              <Mono>main.jsx</Mono> goes to it. Expired and used sign-in requests are deleted by the
              hourly <Mono>cleanUpAi()</Mono>. A client that sends headers (Claude Code, Cursor)
              connects with an access token, for example:
            </P>
            <Code>{'claude mcp add --transport http macaroonie https://macaroonie.com/mcp/staff/<slug> \\\n  --header "Authorization: Bearer mcp_..."'}</Code>
          </section>

          <section id="ops-today" data-doc="">
            <H2>Today (the ops front door)</H2>
            <P>
              The first slice of the chat-first front door in <Mono>docs/CHAT_FIRST.md</Mono> (requirement ids in
              brackets). <Mono>/today</Mono> (<Mono>admin/src/pages/OpsToday.jsx</Mono>, nav link at the top of Home,
              migration 221) shows the day at a glance, the tasks for a venue grouped
              Late / Now / Next / Later, the person's menu as tiles and Pepper beside them. The tasks come from data and
              rules, never the model (P1, Q1), so the page works with Pepper off.
            </P>
            <H3>Who has the link</H3>
            <P>
              Everyone signed in, like the feed itself (<Mono>GET /api/ops/today</Mono> has no module gate; each area
              is read as the person, so their permissions decide what is on it). The link has no <Mono>module</Mono> in{' '}
              <Mono>ROUTE_CATALOG</Mono> or <Mono>DEFAULT_NAV_TREE</Mono>. Migration 221 had given it the Overview&apos;s
              module (<Mono>dashboard</Mono>) and copied the Overview link&apos;s <Mono>hidden_role_ids</Mono>, so a role
              without the Overview lost Today too: a custom role resolves every module it doesn&apos;t name to{' '}
              <Mono>none</Mono> (<Mono>resolvePermission()</Mono>). Migration 227 clears both on every group&apos;s{' '}
              <Mono>/today</Mono> link; the Navigation designer can still hide it from a role.
            </P>
            <H3>GET /api/ops/today</H3>
            <P>
              <Mono>routes/ops.js</Mono> (<Mono>?venue_id=&amp;date=&amp;time=</Mono>; no venue = the tenant's first
              active venue by name; <Mono>time</Mono> HH:MM judges the groups at another moment, default the venue's time
              now, a past day = 23:59, a future day = 00:00). Open to anyone signed in; it builds a staff tool context
              (<Mono>makeContext()</Mono>) and calls <Mono>opsToday()</Mono> in <Mono>services/opsToday.js</Mono>, which
              reads every source through the admin routes in-process as the person (<Mono>callApi()</Mono>), so each
              part keeps its route's permission check and tenant filter. Areas the person has no level on (from{' '}
              <Mono>permissionLevels()</Mono>) or that answer 403 are listed in <Mono>not_included</Mono>, other
              failures in <Mono>errors</Mono>; the rest still loads.
            </P>
            <DataTable
              head={['Area (module)', 'Tasks (kind)', 'Read from']}
              rows={[
                ['food_safety (food_safety)', 'fridge_check and hold_check per check time with units not logged; cooking_check per session short of required_items_count; corrective_action per out-of-range reading or failed delivery with no action', '/api/food-safety equipment, capture-times, temp-logs, hold-stations, hold-capture-times, holds, cooking-sessions, cooking, deliveries'],
                ['checklists (checklists)', 'checklist per template not completed (daily = now, weekly / monthly = later)', '/api/checklists/due'],
                ['hs_actions (hs_action_log)', 'hs_action per open entry due today or overdue', '/api/hs-action-log/entries'],
                ['purchasing (purchasing)', 'po_to_send; delivery_due (sent, delivery today); orders_to_approve (only with purchasing_approve manage)', '/api/purchasing/pos, /api/purchasing/orders'],
                ['cash (cash_recon)', "cash_up when yesterday's report isn't submitted and the venue was open (openDatesOrNull())", '/api/venues/:id/cash-recon/daily/:date'],
                ['online_orders (web_orders)', 'online_orders when orders are placed but not accepted', '/api/orders'],
              ]}
            />
            <P>
              Every task: <Mono>{'{ key, area, kind, compliance, title, detail, due, group, action, can_act }'}</Mono>.{' '}
              <Mono>key</Mono> is stable (one card per thing to do, C6), <Mono>action</Mono> is{' '}
              <Mono>{'{ form, label, ref }'}</Mono> (temps, holds, cooking, checklist) or{' '}
              <Mono>{'{ path, label }'}</Mono>, and <Mono>can_act</Mono> is Manage on the task's module (U1).
              <Mono> groupFor()</Mono> decides the group (<Mono>GRACE_MINS</Mono> 30, <Mono>NEXT_MINS</Mono> 120) and{' '}
              <Mono>sortTasks()</Mono> the order: group, compliance first, then time (S1). A closed day
              (<Mono>/api/hs-settings</Mono> <Mono>closed</Mono>) expects no check rounds (R4). There is no task store
              yet: tasks are worked out on every request, done when their record exists (R2). The response also carries{' '}
              <Mono>summary</Mono> (bookings and big parties from <Mono>day_overview</Mono>, people on the rota from{' '}
              <Mono>whos_working</Mono>), <Mono>counts</Mono> and the <Mono>venues</Mono> for the switch.
            </P>
            <H3>The page</H3>
            <P>
              Forms open in a sheet on the page with the shared panels (<Mono>TempChecksTable</Mono>,{' '}
              <Mono>HoldChecksTable</Mono>, <Mono>CookingChecksPanel</Mono>, <Mono>ChecklistRunPanel</Mono>), so they save
              through the same routes and keep their own read-only rules (F1, F3, F5); Done refetches the feed. The tiles
              are <Mono>/api/me</Mono>'s <Mono>nav_tree</Mono> links, pages with tasks first (<Mono>AREA_ROUTES</Mono>).
              Pepper is <Mono>ChatView</Mono> with <Mono>pageAware</Mono> (the page calls <Mono>usePepperPage()</Mono>
              with the venue and day) and a <Mono>suggestions</Mono> list for the day; the conversation is the drawer's
              remembered one (<Mono>useRememberedConversation()</Mono>). The venue choice is kept in{' '}
              <Mono>maca_today_venue</Mono>. Tests: <Mono>api/test/ops-today.test.mjs</Mono>.
            </P>
            <InfoBox type="info">
              Not built yet from <Mono>docs/CHAT_FIRST.md</Mono>: a task store with owners, snooze, skip and escalation
              (sections 3 and 5), manual and learned tasks (C3, L1-L6), watchers and push (M1-M7), forms inside the chat
              itself (F1 in the conversation, F6, F7), the shared-device person switch (U2) and the per-group chat-first
              switch (G1). Adding a source: a function in <Mono>SOURCES</Mono> with its module in <Mono>AREAS</Mono>,
              reading through the routes with <Mono>callApi()</Mono>, and a row in this table.
            </InfoBox>
          </section>

          <section id="store-openings" data-doc="">
            <H2>New locations (store openings)</H2>
            <P>
              Migration 186. The New venue page (<Mono>/new-location</Mono>, <Mono>pages/NewLocation.jsx</Mono>) and
              five Pepper tools (<Mono>ai/tools/locations.js</Mono>) set up a new venue and create it in one
              transaction. Since 20 Oct 2026 the page is a step-by-step wizard (below) and Pepper is optional; it
              replaced the Venues page's Add venue form. Pepper only plans: its answer is a structured JSON plan the
              server checks, and the venue is made by plain code from the checked plan.
            </P>
            <H3>The setup wizard</H3>
            <P>
              Steps (<Mono>STEPS</Mono> in <Mono>NewLocation.jsx</Mono>, current step in <Mono>?step=</Mono>): venue,
              brand, menu, hours, tables, rest, check; each step is a component in{' '}
              <Mono>components/venueSetup/steps.jsx</Mono> with its own Save (a PATCH of the opening). A step registers{' '}
              <Mono>{'{ dirty, save }'}</Mono> through <Mono>useGuard()</Mono>; moving to another step while dirty shows the
              pending bar (Save and go / Don&apos;t save / Stay here). Pepper's questions render with{' '}
              <Mono>QuestionsCard</Mono> (<Mono>questions.jsx</Mono>); shared buttons and <Mono>ModePick</Mono> are in{' '}
              <Mono>ui.jsx</Mono>.
            </P>
            <DataTable
              head={['Piece', 'What it does']}
              rows={[
                ['POST /wizard', '{ template_venue_id? } (venues manage): an opening with no description (title "New venue", input empty) and overrides.wizard = true. From scratch it also sets WIZARD_NEW (booking_rules, website, ordering, till, cash) to new; like a venue, normalisePlan() copies every area it can. No model call.'],
                ['POST /:id/describe', '{ input } (the planning permissions + Pepper on): stores the description and runs the scope step on a draft, questions or ready opening. Pepper fills only what the person hasn\'t set.'],
                ['PATCH /:id overrides.settings', 'Per-area settings the steps write, keyed by SETTING_KEYS (hours, tables, booking_rules, ordering, till, devices, food_safety, checklists, purchasing, staff, emails, menus, brand), up to 60 KB; a null value deletes one. normalisePlan()\'s pick() takes the override before Pepper\'s raw plan for each.'],
                ['overrides.modes null', 'A mode set to null deletes the person\'s choice, so the area goes back to its default (the venue step does this to WIZARD_NEW when the template changes).'],
                ['plan.menus', '{ ids, made, only_here }: ids go on the venue\'s online ordering (planMenus(): the tenant\'s menus with no venue or this one; added to copied menu_ids or set on a new ordering_settings row); with only_here, the menus made in the wizard (made) get venue_id = the new venue before the areas run (needs menus manage). A menus follow-up asks to check and publish them.'],
                ['plan.brand', '{ kit }: a theme kit for the venue\'s own web page. ownLook() (website area, copy or new) sets use_brand_override, the theme from websiteThemeFromKit(kit, tenant theme), the identity from tenant_site, primary_colour and font_family.'],
                ['create', 'Allowed for wizard drafts (not only ready openings). view() returns wizard.'],
              ]}
            />
            <H3>Pieces</H3>
            <DataTable
              head={['File', 'What it holds']}
              rows={[
                ['shared/storeOpening.js', 'OPENING_AREAS (key, label, icon, modules needed with Manage, admin flag, the ways allowed: copy / new / skip), normalisePlan(raw, overrides, { templates, today }) (never throws; the person\'s overrides win; copy without a location to copy from becomes new where allowed, else skip; new with nothing to set up becomes skip), planProblems(), previewPlan(plan, templateSummary) (one line per area), buildFollowups() (the Still to do list), AREA_LINKS, hoursText(), slugify(), MAX_ROUNDS (3).'],
                ['services/storeSetup.js', 'venueSummary() (what a location has, area by area: counts and words, used for the preview and for Pepper), tenantContext() (every location\'s summary and the company-wide lists Pepper reads), freeSlug(), createStore(tx, { tenantId, plan, by, allowed, allowedModule, today }).'],
                ['services/storeOpeningAi.js', 'askPepper(): one model call per step (AI_MODEL, output_config.format json_schema ANSWER_SCHEMA, streamed, cached system prompt and context block); the answer\'s questions trimmed and numbered r<round>-<id>; on a 400 about the schema it asks again for the same JSON as text. Counted in the AI allowance and the person\'s daily share (addUsage staff_chat).'],
                ['routes/storeOpenings.js', '/api/ai/store-openings (under /api/ai for the 5-minute proxy timeout). Reads need venues view; steps venues manage + ai_assistant view + Pepper on for the tenant; creating venues manage.'],
              ]}
            />
            <H3>API</H3>
            <DataTable
              head={['Route', 'What it does']}
              rows={[
                ['GET /', 'The openings (title, status, the location made, who, when, busy).'],
                ['GET /:id', 'One opening: the checked plan (venue.slug_final = the address it will get), area cards (mode, chosen by the person, Pepper\'s note, deep_dive, preview, can_set_up, result), questions, brief, problems, history, results, followups.'],
                ['POST /', '{ input, template_venue_id? }: makes the row and runs the scope step. A failed step keeps the draft (status draft) and returns it with error.'],
                ['POST /:id/scope', 'Runs the scope step again on a draft.'],
                ['POST /:id/answers', '{ answers: { id: text } } (empty = leave it to Pepper). A round: the last round (MAX_ROUNDS) always ends ready.'],
                ['POST /:id/deep-dive', '{ area }: questions about one area (not a round).'],
                ['POST /:id/change', '{ request }: Pepper changes the plan.'],
                ['PATCH /:id', '{ title?, overrides: { venue, location, opening_date, template_venue_id, modes } }: the person\'s own choices, merged into overrides.'],
                ['POST /:id/create', 'createStore() in one transaction with the row update (status created, venue_id, plan, results, followups). Any area failing rolls everything back (422 naming the area).'],
                ['PATCH /:id/followups/:key', '{ done }.'],
                ['DELETE /:id', 'A draft only.'],
              ]}
            />
            <H3>Copying a location</H3>
            <P>
              <Mono>copyTable()</Mono> copies whole rows of the location copied from: every column but its id,
              tenant, venue and timestamps. Ids are moved: uuid columns, uuid arrays and every uuid inside jsonb
              (values and keys) go to the copy's new id (<Mono>remapDeep()</Mono>); an id of something that belongs
              to the location copied from (<Mono>OWNED_TABLES</Mono>, plus its menus) but wasn't copied is dropped
              (null, or left out of its array or object); company-wide ids (menus, dishes, order types, tip pots,
              kiosk designs, suppliers) stay. Areas run in an order that lets later ones point at earlier ones
              (<Mono>AREA_ORDER</Mono>: tax, cash, till, tables, hours, booking rules, kitchen, devices, ordering,
              Deliveroo, website, emails, food safety, checklists, dashboards, purchasing, team). Never copied:
              the PIN salt (new), receipt address (the new one), printers' place in the floor plan is kept but
              their addresses need checking, supplier account numbers (blank), paired devices (copies are unpaired,
              ready for the installer; menu screens get new short codes), the location's address and map (from
              the plan), Loyverse / GloriaFood links, staff. Before the opening date a "Not open yet" closure
              covers today to the day before, and online ordering is off.
            </P>
            <H3>Pepper tools</H3>
            <P>
              <Mono>plan_new_location</Mono>, <Mono>answer_location_questions</Mono>,{' '}
              <Mono>change_location_plan</Mono> (direct overrides, a closer look, or a change in words),{' '}
              <Mono>location_openings</Mono> (read) and <Mono>create_location</Mono> (a card; its describe() shows the
              areas being set up and those the person can't). Section <Mono>locations</Mono>, module{' '}
              <Mono>venues</Mono>. They call the routes above with <Mono>callApi()</Mono>, so a planning step in a chat
              is a model call inside a tool call.
            </P>
          </section>

          <section id="menus" data-doc="">
            <H2>Menus</H2>
            <P>
              Structured menu manager (migration 048) — <Mono>menus</Mono> →{' '}
              <Mono>menu_sections</Mono> → <Mono>menu_items</Mono>, with an admin bulk-upsert
              PATCH rewriting the whole tree per save (delete + re-insert under the{' '}
              <Mono>menu_id</Mono> — acceptable since only one admin edits a menu at a time).
              Renders on the website via the <Mono>menu_inline</Mono> block, and standalone as a
              printable page at <Mono>GET /api/menus/:id/print</Mono>.
            </P>
            <P>
              <Mono>DELETE /api/menus/:id</Mono> calls <Mono>forgetMenu()</Mono> in the same
              transaction: the id comes out of <Mono>ordering_settings.menu_ids</Mono>,{' '}
              <Mono>pos_revenue_streams.menu_ids</Mono> and{' '}
              <Mono>deliveroo_settings.menu_ids</Mono> (uuid arrays with no foreign key); its{' '}
              <Mono>menu_times</Mono> rows go by their foreign key (migration 230). Before
              migration 222, which cleared the ids left behind, a stale id was sent back unseen by
              Ordering setup and every save failed with "A chosen menu wasn't found". The ordering
              and Deliveroo settings reads also return only menus their page lists, and the
              revenue stream window drops ids it doesn't list.
            </P>
            <H3>Reading a menu from files</H3>
            <P>
              <Mono>/api/ai/menus</Mono> (<Mono>routes/menuImport.js</Mono>, under /api/ai for the 5-minute proxy timeout).{' '}
              <Mono>POST /read</Mono> (menus manage + ai_assistant view, Pepper on) takes up to 10 files (multipart, kind
              from the first bytes: images up to 5 MB each, PDFs up to 10 MB, 20 MB in all), an optional hint and{' '}
              <Mono>venue_id</Mono> (the tenant's, else 404), and calls <Mono>readMenu()</Mono> in{' '}
              <Mono>services/menuReadAi.js</Mono>: one streamed call to the main model (<Mono>AI_MODEL</Mono>, effort
              medium, <Mono>max_tokens</Mono> 32,000) with the files as image / document blocks, the tenant's allergen and
              dietary tags, option groups and currency, and structured output (<Mono>MENU_SCHEMA</Mono>: sections, dishes
              with a price string, calories, allergens with a level, dietary, options by group with base or extra prices).
              Counted with <Mono>addUsage()</Mono> after <Mono>chatUnitsLeft()</Mono> / <Mono>personUnitsLeft()</Mono>.
              A refusal, a cut-off answer (max_tokens: "a few pages at a time") or no dishes is a 422; Claude busy is a 503.{' '}
              <Mono>toSections()</Mono> turns the answer into <Mono>create_menu</Mono>'s sections (<Mono>readPrice()</Mono>{' '}
              reads "£12.50" and "12,50"; a dish priced by base options loses its own price). Nothing is saved.
            </P>
            <P>
              <Mono>POST /import</Mono> (menus manage) takes the reviewed menu (<Mono>{'{ name, venue_id?, tagline?, service_times?, sections }'}</Mono>,
              up to <Mono>MAX_IMPORT_DISHES</Mono> 600 dishes) and runs <Mono>createMenuFromSections()</Mono> from{' '}
              <Mono>ai/tools/menus.js</Mono> in process with a staff context (<Mono>staffContext()</Mono> in the route, built with <Mono>makeContext()</Mono>): the same plan as
              Pepper's <Mono>create_menu</Mono> without its 50-dish batch limit (<Mono>planCreate(ctx, input, {'{ batch: false }'})</Mono>).
              Tags are matched to existing ones only; an option group whose existing choices don't cover the menu's gets a new group
              named "group (menu name)". The menu is made unpublished through <Mono>POST /api/menus</Mono> + the whole-tree PATCH,
              audited as <Mono>import_menu</Mono>. Admin: <Mono>components/menus/MenuImport.jsx</Mono> (files, review, done;{' '}
              <Mono>MenuImportModal</Mono> on the Menus page, embedded in the wizard's Menu step). Tests:{' '}
              <Mono>api/test/menu-import.test.mjs</Mono>.
            </P>
            <H3>Option group display names</H3>
            <P>
              <Mono>menu_variant_groups.display_name</Mono> (migration 198, text, NULL = the name): what guests and the tills
              see. The body's <Mono>display_name</Mono> is trimmed, empty = NULL, left out of a PATCH = unchanged, copied
              by <Mono>/copy</Mono>. <Mono>attachVariantGroupsToItems()</Mono> puts it on an attached group only when
              set; <Mono>releaseContent()</Mono> stores it as the group's <Mono>name</Mono> (<Mono>shownGroup()</Mono> in{' '}
              <Mono>shared/menuDiff.js</Mono>), so every reader of a published menu (online ordering, website blocks, print,
              screens, tills, kiosks) shows it with no change of its own, and menus whose groups have none hash as before.
              Draft reads for guests (<Mono>loadMenuVersion(s)</Mono> with version draft: staging, preview links, kiosk
              draft previews) map it with <Mono>withShownGroupNames()</Mono>; the editor's <Mono>GET /api/menus/:id</Mono>{' '}
              reads <Mono>loadMenuFull()</Mono> straight (the group's own name, <Mono>display_name</Mono> beside it). The
              live group library (<Mono>tillConfig()</Mono>, <Mono>kioskConfig()</Mono> groups: nested groups) and the
              translation sources select <Mono>COALESCE(display_name, name) AS name</Mono>, so <Mono>group:&lt;id&gt;:name</Mono>{' '}
              translates the display name.
            </P>
            <H3>Option group looks and types</H3>
            <P>
              Migration 206 adds to <Mono>menu_variant_groups</Mono> the group's own kiosk look,{' '}
              <Mono>kiosk_tiles</Mono> (NULL | cards | round | oval | hexagon | plain, <Mono>TILE_STYLES</Mono>),{' '}
              <Mono>kiosk_pictures</Mono> (NULL | true | false: words only) and <Mono>kiosk_entrance</Mono> (NULL | none |
              appear | slide | bubble | deal, <Mono>ENTRANCE_KEYS</Mono>), beside <Mono>kiosk_display</Mono>; and{' '}
              <Mono>variation_type</Mono> (NULL | modification | side | addition, <Mono>VARIATION_TYPES</Mono> in{' '}
              <Mono>shared/procurement.js</Mono>): what the group does to the dish's recipe, for stock counts later (nothing
              reads it yet). <Mono>VariantGroupBody</Mono> takes all four as nullable enums; a PATCH that leaves one out keeps
              it (POST: NULL); <Mono>loadVariantGroups()</Mono> (<Mono>g.*</Mono>) lists them and <Mono>/copy</Mono> copies
              them. They aren't in <Mono>attachVariantGroupsToItems()</Mono>, so they never reach menu releases: like the
              rest of the group library they change straight away. <Mono>kioskConfig()</Mono>'s groups carry the three kiosk
              ones; <Mono>GET /api/pos/venues/:id/setup</Mono> returns <Mono>option_groups</Mono> (id, name,{' '}
              <Mono>display_name</Mono>, the four kiosk columns) for the kiosk design editor.
            </P>
            <P>
              A kiosk design can give groups a look of its own: <Mono>options.group_looks</Mono>,{' '}
              <Mono>[{'{ group_id, display, tiles, pictures, entrance }'}]</Mono>, each part NULL = not set here
              (<Mono>normaliseDesign()</Mono>: one row per group, up to 200, unknown values NULL, a row with nothing set
              kept; <Mono>ownDesign()</Mono> keeps only the tenant's own groups). <Mono>groupLook(design, group)</Mono> in{' '}
              <Mono>shared/kiosk.js</Mono> is the one rule, part by part: the design's look for the group, else the group's
              own, else the design's for every choice (<Mono>options.display</Mono>, <Mono>layout.option_tiles</Mono>,{' '}
              <Mono>layout.option_pictures</Mono>, <Mono>options.entrance</Mono>); a null group (combo steps, a dish's
              one-off options) gets the design's. The kiosk: <Mono>OptionGroup.jsx</Mono> takes the display and entrance from
              it and <Mono>choiceLook(design, group)</Mono> (<Mono>displays.jsx</Mono>) the display's tiles and pictures, and
              wraps the display in <Mono>.k-choices.k-opts-&lt;tiles&gt;</Mono> with <Mono>data-enter</Mono> and{' '}
              <Mono>data-tiles</Mono>; a combo step's page and its tab's thumbs carry the design's (the tab's: the first
              picked group's). The root no longer has <Mono>.k-opts-*</Mono> (it keeps <Mono>data-option-tiles</Mono> and
              the design's <Mono>data-enter</Mono>): a choice's picture style comes from the one choices container above it
              (a group an option opens renders after its parent's container, not in it). Entrances: every{' '}
              <Mono>[data-enter]</Mono> sets <Mono>--k-enter-name</Mono>, <Mono>--k-enter-ms</Mono> and{' '}
              <Mono>--k-enter-step</Mono>, which the choices inherit, so the nearest one wins. Corner pictures carry their
              group's style themselves: <Mono>pickImages()</Mono>' corner entries are{' '}
              <Mono>{'{ src, scale, tiles }'}</Mono> and <Mono>CornerPicks</Mono> sets <Mono>data-tiles</Mono>, which kiosk.css
              keys on. Admin: <Mono>GroupLooks</Mono> in <Mono>KioskDesigner.jsx</Mono> (Choices: add a group, a select per
              part whose empty choice names the default, Group: or Design:), <Mono>LookRow</Mono> and the Recipe and
              stock box in <Mono>VariantGroupsManager.jsx</Mono>. Tests: <Mono>shared/test/kiosk.test.mjs</Mono>,{' '}
              <Mono>api/test/option-group-look.test.mjs</Mono>.
            </P>
            <H3>Copying dishes, sections and option groups</H3>
            <P>
              Dishes and sections are copied in the editor's draft (<Mono>Menus.jsx</Mono>), nothing on the server until
              Save changes: <Mono>copyOfDish(item, {'{ id, rename, map }'})</Mono> is a <Mono>structuredClone</Mono> with a
              new uuid and "(copy)" on the name, a combo's step and choice ids made fresh with <Mono>when</Mono> following
              them (as <Mono>remapCombo()</Mono> does for <Mono>/duplicate</Mono>), and choices' <Mono>item_id</Mono> /{' '}
              <Mono>section_id</Mono> moved through <Mono>map</Mono>. <Mono>copyOfSection()</Mono> maps the section and
              each dish to new ids first, so a combo in a copied section offers the copy's dishes and section; dish names
              stay. The copy goes just after the original (<Mono>copyItem()</Mono> in <Mono>SectionEditor</Mono>,{' '}
              <Mono>copySection()</Mono> in <Mono>SectionsPanel</Mono>, <Mono>copyItemAt()</Mono> /{' '}
              <Mono>copySectionAt()</Mono> in <Mono>MenuEditor</Mono> for the panels' Copy) and is selected. Per-dish
              option prices come along in either shape (<Mono>overridesOf()</Mono> reads both). Not copied: translations
              (keyed by id), sold out, print design placement. The dish panel's <Mono>copy-options-from</Mono> list
              (<Mono>copyOptionsFrom()</Mono>) takes another dish's <Mono>variant_groups</Mono> with its overrides: groups
              this dish has keep their place and take the other dish's prices, new ones follow.
            </P>
            <H3>A dish's own options (menu_item_variants) on the Menus page</H3>
            <P>
              Options added to one dish directly (<Mono>menu_item_variants</Mono>: the sample menus in{' '}
              <Mono>services/menuSeeds.js</Mono>, older menus, imports, the API) are asked first, as the choice
              {' '}<Mono>key: 'variants'</Mono>, name Choose, base price, pick one (<Mono>itemChoices()</Mono>), with ids{' '}
              <Mono>v:&lt;label&gt;</Mono> (<Mono>variantOptionId()</Mono>) because the rows are re-inserted with new ids
              on every save. Until Oct 2026 the Menus page's save payload sent <Mono>variants: []</Mono> for every dish,
              so saving a menu deleted them, and with them any meal deal rule on them (<Mono>cleanDealGroups()</Mono>{' '}
              keeps a choice's <Mono>groups.variants</Mono> only while the dish has own options). The payload now sends
              them back (label, price, place), as <Mono>menuSaveBody()</Mono> does; <Mono>contentKey()</Mono> ignores
              their ids, so this is never a change to publish.
            </P>
            <P>
              They can't be edited on the page (new options come from option groups). <Mono>OwnOptionsCard</Mono> lists them
              in the dish panel above the attached groups; <Mono>ItemRow</Mono> shows an amber badge
              (<Mono>dish-own-options</Mono>). <strong>Turn into an option group</strong>: <Mono>sameAsOwnOptions()</Mono>{' '}
              looks for a library group asking the same thing (base, min 1 / max 1, no repeat, not on request, no nested
              groups, the same labels ignoring case and spaces) that isn't on the dish, the one with the fewest price
              differences; else <Mono>POST /api/menus/variant-groups</Mono> makes one (name: the labels joined with " / ",
              cut to 80; <Mono>display_name</Mono> Choose, so tills, kiosks and online ordering show the same heading;
              the website and print now show a group heading above them), added to the{' '}
              <Mono>['menu-variant-groups']</Mono> cache at once. <Mono>ownOptionPrices()</Mono> gives the dish's prices as
              overrides and a map <Mono>v:&lt;label&gt;</Mono> {'->'} the group's option id, and{' '}
              <Mono>withOwnOptionsAsGroup()</Mono> (in the draft) puts the group first among the dish's groups (own options
              were asked first), clears the own options and moves meal deal rules on them with{' '}
              <Mono>moveDealGroup()</Mono> (<Mono>shared/combos.js</Mono>): a choice of the dish loses its{' '}
              <Mono>variants</Mono> entry, a choice of its whole section keeps it too for the section's other dishes.{' '}
              <strong>Remove</strong> (inline confirm) sets <Mono>variants: []</Mono>. Tests:{' '}
              <Mono>api/test/own-options.test.mjs</Mono>, the <Mono>moveDealGroup</Mono> test in{' '}
              <Mono>shared/test/dealOptions.test.mjs</Mono>.
            </P>
            <P>
              <strong>Phone layout.</strong> A dish row's name has <Mono>min-w-[7rem]</Mono> and a section heading's title{' '}
              <Mono>min-w-[8rem]</Mono> in rows that wrap (<Mono>flex-wrap</Mono>), with the badges, price and buttons in one
              group (<Mono>ml-auto</Mono>): where the row is too narrow for both (a phone, a tablet with a panel open), the
              group goes onto a second line instead of squeezing the name to nothing. The dish and section panels
              (<Mono>SIDE_PANEL</Mono>) sit beside the list from md up and are full-screen sheets below
              (<Mono>max-md:fixed inset-0 z-50</Mono>). The top bar wraps, its buttons are icons only below sm
              (<Mono>TOP_BTN</Mono>) and the top Save is hidden there (the bottom bar saves). The menus{' '}
              <Mono>Card</Mono> (<Mono>components/menus/shared.jsx</Mono>) wraps its header button under the title and has
              less padding on a phone.
            </P>
            <P>
              <Mono>POST /api/menus/variant-groups/:id/copy</Mono> (menus manage, tenant filtered, 404 otherwise) copies the
              group row and its options generically (every column but id and timestamps, so a new column comes along without
              a code change), names it "name (copy)" (name cut to fit 80), moves later groups' <Mono>sort_order</Mono> down
              one and puts the copy right after the original. An option whose <Mono>child_group_id</Mono> is the group itself
              points at the copy. <Mono>menu_translations</Mono> rows for the options (<Mono>option:&lt;id&gt;:label</Mono>,{' '}
              <Mono>:description</Mono>) and the scale words (<Mono>group:&lt;id&gt;:scale_low</Mono> / <Mono>scale_high</Mono>)
              are copied to the new ids; the name's isn't (the name changed). No dish is attached. The Variant groups page
              opens the copy in its editor (<Mono>VariantGroupsManager.jsx</Mono>). Tests:{' '}
              <Mono>api/test/variant-group-copy.test.mjs</Mono>; the sweep's fixtures copy a group.
            </P>
            <P>
              <Mono>GET /api/menus/print-designs</Mono> (open to signed-in staff, like the other menu reads) lists every print design of the tenant with its menu
              (id, name, layout, menu_id, menu_name), for Brand &amp; theme's Use the brand on other designs.
            </P>
            <H3>Publishing: draft and live (migration 165)</H3>
            <P>
              The menu tables are the <strong>draft</strong>: the Menus page, the allergen matrix, the
              menu designer and the AI change tools read and write them as before. What guests and
              devices see is the <strong>live</strong> version: the newest row of{' '}
              <Mono>menu_releases</Mono> for the menu whose <Mono>goes_live_at</Mono> has passed and
              that wasn&apos;t cancelled. A release is a frozen copy made by{' '}
              <Mono>releaseContent(loadMenuFull())</Mono> (<Mono>shared/menuDiff.js</Mono>) and never
              changes after insert, so <Mono>services/menuReleases.js</Mono> caches release content
              in memory by id.
            </P>
            <DataTable
              head={['Piece', 'What it does']}
              rows={[
                ['menu_releases', 'tenant_id, menu_id (cascade), snapshot jsonb, content_hash, goes_live_at, note, published_by, created_at, cancelled_at / cancelled_by, announced_at. A future goes_live_at = scheduled. Live = DISTINCT ON (menu_id) ... ORDER BY goes_live_at DESC, created_at DESC among non-cancelled rows with goes_live_at <= now(). RLS.'],
                ['menu_preview_links', 'An hour-long link (id) to print the draft (release_id null) or a given release on the public print page, which has no login. POST /api/menus/:id/preview-link returns the path; GET /:id/print?preview=<id> prints it (410 once expired, Cache-Control private).'],
                ['menus.needs_first_release', 'Set by the migration for every menu that existed. backfillFirstReleases() (server.js, at start-up) publishes their current draft once, so nothing disappears on deploy. New menus start without a release: not live anywhere until published.'],
                ['releaseContent() / contentKey()', 'What a release keeps (sections, dishes, prices, option prices with variant_groups resolved, dietary codes, allergen_levels, till fields, footer notes, menu settings incl. is_published and venue_id) and a stable string to compare two versions. Left out (tenant-wide, always current): the tag list, the allergen notice, print designs and print_design_id, timestamps. An attached group goes in by its display name (shownGroup(): display_name as name, migration 198), so a new display name is a change to publish; diffMenus() lists a group renamed that way as the dish\'s options changing. contentKey ignores one-off option ids (re-made on every save), nested sort_order numbers (the array order says it), key order, null vs missing and numeric strings.'],
                ['diffMenus(live, draft)', 'The change list the editor and the AI publish card show: [{ kind, text }], kind menu | section | added | removed | price | options | dish | notes.'],
                ['loadMenuVersion() / loadMenuVersions()', 'The one way to read what guests see: loadMenuFull()-shaped, version live (default), draft, or a releaseId; with the tenant\'s current tags, notice and print design attached. loadMenuVersions() filters on the version\'s own venue_id and is_published (publishedOnly).'],
                ['publishMenu()', 'Snapshot the draft. at empty or within 30 seconds = now; at most 400 days ahead. 422 when the hash equals the live one. Immediate publishes set announced_at and the route calls announceMenus().'],
                ['announceDueReleases()', 'Run every minute by the hold sweep (jobs/queues.js): marks releases that went live since the last run as announced and calls announceMenus(): tillsMayNeedConfig() plus a menus.live broadcast on the menus:<tenantId> room for screens.'],
                ['Routes', 'GET /api/menus?status=1 (publish per menu: live_at, scheduled_at, scheduled_count, changed); GET /:id?version=live; GET /:id/publish (live, scheduled, in_sync, changes, history); POST /:id/publish { at?, note? } (manage); DELETE /:id/releases/:releaseId (cancel a future one, manage); POST /:id/releases/:releaseId/restore (copy a release into the draft with restorableBody() + writeMenu(), manage); POST /:id/preview-link { release_id? }; GET /:id/allergens?version=live.'],
                ['Admin (components/menus/MenuPublish.jsx)', 'PublishButton, beside Save in the menu editor\'s top bar: a badge with the number of changes in GET /:id/publish (a dot when there is no live version, a clock when one is scheduled), filled while changes wait and the editor is saved; it opens PublishWindow (portal into document.body: the bar\'s backdrop blur would make a fixed window fixed to the bar), whose PublishContent is the old card: changes, Publish now / Schedule / Preview print / Discard changes, scheduled publishes, history. Both read the query [\'menu-publish\', id], which the editor\'s Save invalidates. PublishBadges on the Menus list.'],
              ]}
            />
            <DataTable
              head={['Reader', 'Version']}
              rows={[
                ['Website menu_inline block (loadInlineMenus in siteDataSvc.js)', 'Live; a staging host passes draft: true. Shown-to-guests and section visibility come from the version.'],
                ['GET /api/menus/public/:menuId', 'Live, 404 unless the live version is shown to guests.'],
                ['GET /api/menus/:id/print (incl. ?view=dietary, ?design=)', 'Live; ?preview=<link> prints the draft or a release. The Menus list prints live (or a draft preview for a menu never published); the editor and the designer print the draft through preview links.'],
                ['Online ordering (loadOrderingMenu in orderSvc.js)', 'Live, so order prices and dishes match what is published.'],
                ['Till config (tillMenus in posSvc.js)', 'Live: the menus named by revenue streams, else the venue\'s live menus shown to guests. Each item carries its tax levels [dish, section, menu] trimmed to the venue.'],
                ['Deliveroo (loadDishes / loadSetup in routes/deliveroo.js)', 'Live; no menus picked = live menus shown to guests. Matches to a live dish removed from the draft still save.'],
                ['Cooking check dish buttons (loadCookingPicker)', 'Live. POST /food-safety/cooking with a live dish gone from the draft logs its name with menu_item_id null.'],
                ['Allergen lookup (AllergenLookup)', 'Live (menus with a live version only). The Allergen matrix editor stays on the draft.'],
                ['AI menu tools', 'get_menu draft unless version live; find_dishes live (draft with include_unpublished for menus never published); change tools write the draft; publish_menu and cancel_menu_publish publish.'],
                ['Draft readers (unchanged)', 'Menus page, allergen matrix editor, menu designer (GET /:id/design), Promotions and Store tech dish pickers, Ordering setup and sold-out lists.'],
              ]}
            />
            <InfoBox type="warn">
              A new place that shows a menu to guests or devices must read it through{' '}
              <Mono>loadMenuVersion()</Mono> / <Mono>loadMenuVersions()</Mono>, never{' '}
              <Mono>loadMenuFull()</Mono> or its own SQL on the menu tables, or it shows unpublished
              changes. Option groups (the Variant groups library), tags, the allergen notice and print
              designs are tenant-wide and stay live: a dish&apos;s own option prices are in the
              release, but the till reads nested option groups from the library.
            </InfoBox>
            <H3>Menu times (migration 230)</H3>
            <P>
              One table per venue of when each menu is on, on the website (online ordering), the self-order
              kiosks and the tills: Menus &gt; Menu times (<Mono>pages/MenuTimes.jsx</Mono>,{' '}
              <Mono>/menus/times</Mono>; the migration adds the link first under every group&apos;s Menus,
              with the same hidden roles). <Mono>shared/menuTimes.js</Mono> is the one set of rules for the
              API, the page, the till and the kiosk; the schedules themselves are{' '}
              <Mono>shared/menuSchedule.js</Mono>&apos;s (<Mono>menuOnAt()</Mono>, <Mono>scheduleLabel()</Mono>,
              the new <Mono>scheduleError()</Mono>).
            </P>
            <DataTable
              head={['Piece', 'What it does']}
              rows={[
                ['menu_times', 'PK (venue_id, menu_id), tenant_id (forced RLS), times jsonb (the menu\'s own schedule, NULL = any time), web / kiosk / till jsonb cells { use: off | menu | always | own, times }, updated_at, updated_by. Menu or venue deleted: the rows go (foreign keys). No row: the menu is on the tills and kiosks at any time. The website\'s on / off is ordering_settings.menu_ids, so a stored web cell is never off (switched off, it keeps what it said for when it goes back online).'],
                ['Cells', "use menu = the menu's own times, always = any time on that channel, own = the cell's own times, off = not on that channel. channelTimes(row, channel) is the only reader: a schedule, null for any time, false for off."],
                ['GET /api/menu-times/venues/:venueId', 'Menus view. { venue, menus, rows, ordering, streams, devices, warnings }: menus the venue can use (shared ones and its own, with own, is_published and live: a release already live), a row for each with the usual cells filled in (web.use off when the menu isn\'t online), whether online ordering is set up and on, the active revenue streams with their menu_ids, how many tills and kiosks the venue has ({ till, kiosk }), menuTimesWarnings().'],
                ['PUT /api/menu-times/venues/:venueId', "Menus manage. { rows: [{ menu_id, times, web, kiosk, till }] }, the rows sent only (others left alone). A menu the venue can't use 422, twice 400; menuTimesProblems() 422 with code menu_times and problems; a row that says nothing beyond the usual is deleted. The web cells rewrite ordering_settings.menu_ids (the menus already online that stay on in their order, then the new ones; at most 20). Broadcasts pos.config to the venue's tills and kiosks."],
                ['shared/menuTimes.js', 'CHANNELS, USES, cleanSchedule() / cleanCell() / cleanRow(), isDefaultRow(), channelTimes(), channelLabel(), timesLabel(), menusOnNow(menus, parts) (menus as { id, times } at venue-local parts), tillMenusShown(menus, parts, pick), nextStart(menus, parts), menuTimesProblems(rows, names) (what stops a save: a bad date range, a time with no days or ending before it starts, a schedule\'s own times overlapping), menuTimesWarnings(rows, names, today) (two menus on at once on a channel, from today on: notes only, both show).'],
                ['services/menuTimesSvc.js', 'loadMenuTimes(tx, tenantId, venueId) (stored rows, tidied), channelMenuTimes(tx, tenantId, venueId, channel) ({ menuId: times | false }, menus with no row left out: read it with ?? null), webSchedules(tx, venueId) (online ordering\'s schedules, see Web Ordering > Menu times online).'],
                ['Device configs', "tillMenuData(..., { channel }) with 'till' in tillConfig() and 'kiosk' in kioskConfig(): a menu off there is left out, every other menu carries times (null = any time). The times are part of the config (not liveFields()), so a change reaches devices through the pos.config push or the content pull."],
                ['Store openings', 'A copied location\'s online ordering (storeSetup.js) copies the template\'s menu_times rows for the shared menus.'],
              ]}
            />
            <P>
              <strong>The till</strong> (<Mono>pos/src/lib/tillMenus.js</Mono>): <Mono>useShownMenus(config, menuIds)</Mono>{' '}
              takes the check&apos;s revenue stream menus (<Mono>streamMenus()</Mono>), works out the venue-local time
              (<Mono>tillNow()</Mono>, the venue&apos;s time zone) every 30 s (<Mono>useTick</Mono>) and returns{' '}
              <Mono>{'{ menus, shown, ids, auto, onNow, basis, none, pick(ids), follow() }'}</Mono> from{' '}
              <Mono>tillMenusShown()</Mono>: the menus on now, every menu when none is on, or the till&apos;s pick (prefs{' '}
              <Mono>menu_pick</Mono> <Mono>{'{ ids, basis }'}</Mono>; the basis is the day and the ids on now, so the
              pick lapses by itself when they change, and the hook clears it). <Mono>MenuPanel</Mono> has no menu chips
              any more (its tabs are the sections of the menus shown), and <Mono>LayoutScreen</Mono> takes{' '}
              <Mono>menus</Mono> (shown) and <Mono>tillMenus</Mono> (all of them): a categories zone with sections picked
              shows those of the menus shown, falling back to the picked ones when none of them is.{' '}
              <Mono>components/MenusModal.jsx</Mono> is the pick, opened from More (<Mono>ActionsMenu</Mono>&apos;s{' '}
              <Mono>menus</Mono> prop and <Mono>menusHint()</Mono>, only with more than one menu), the counter&apos;s{' '}
              <Mono>counter-menus</Mono> button and the till layout button action <Mono>menus</Mono>{' '}
              (<Mono>BUTTON_ACTIONS</Mono>, no order needed, group Till) in <Mono>runButton()</Mono> of Check.jsx and
              Counter.jsx.
            </P>
            <P>
              <strong>The kiosk</strong> (<Mono>pos/src/kiosk/store.js</Mono>): <Mono>state.menuIds</Mono> holds the
              visit&apos;s menus (null = every menu: previews, share links and replays), set at boot,{' '}
              <Mono>startOrder()</Mono> and <Mono>restart()</Mono> from <Mono>menusOnNowFor(config, preview)</Mono>;{' '}
              <Mono>refreshMenus()</Mono> runs every 30 s and after a new config, on the start screen only, so a guest
              mid-order keeps their menus. <Mono>kioskSections(config, menuIds = state.menuIds)</Mono>,{' '}
              <Mono>kioskItemIds()</Mono> and <Mono>itemOffNow(config, id, menuIds)</Mono> (home page featured tiles,
              banner links, &ldquo;Anything else?&rdquo; dishes) and <Mono>countFor(config, prefs, menuIds)</Mono>{' '}
              (the allergens count) all use it. <Mono>noMenuOn(s)</Mono> closes ordering (<Mono>orderingClosed()</Mono>{' '}
              in Start.jsx shows the <Mono>k-closed</Mono> card with <Mono>data-why=&quot;menus&quot;</Mono>) and{' '}
              <Mono>nextMenuAt(config)</Mono> says when it opens; words <Mono>no_menu_title</Mono>,{' '}
              <Mono>no_menu_back_at</Mono>, <Mono>no_menu_later</Mono> in the nine languages. A journey&apos;s playback
              uses <Mono>kioskSections(config, null)</Mono>.
            </P>
            <P>
              <strong>Admin</strong>: <Mono>MenuTimes.jsx</Mono> keeps the whole venue as a draft (venue in{' '}
              <Mono>maca_menu_times_venue</Mono>), a table from md (<Mono>mt-table</Mono>) and cards below
              (<Mono>mt-cards</Mono>), a select per cell (<Mono>mt-cell</Mono>, Own times opening the times window,
              which is <Mono>ScheduleEditor</Mono> with <Mono>alwaysOpen</Mono>), problems that disable Save and notes
              that don&apos;t, and one Save for the table. Ordering setup&apos;s Menus card only lists{' '}
              <Mono>online_menus</Mono> with a link to Menu times.
            </P>
            <H3>Schema (relevant to this section)</H3>
            <DataTable
              head={['Table / column', 'Purpose']}
              rows={[
                ['menu_items.calories', 'Migration 094. Nullable int (kcal), CHECK >= 0. Shown next to the price wherever price is shown — website block, print, and the page-builder canvas preview.'],
                ['menus.print_settings', 'Migration 120. jsonb, default {}. Optional keys: font_scale (int 70-150, %), margin_mm (3-25, null = 8mm/12mm), repeat_header (first | compact | full), repeat_footer, page_numbers, keep_sections (bools), variant_columns (1-3: variant label + price pairs per row, .variants grid of .variant pairs). Zod PrintSettings in menus.js strips unknown keys; written with tx.json(). A missing key keeps the original layout.'],
                ['menu_sections.print_break_before / print_keep_together', 'Migration 120. none | column | page (CHECK), and a boolean. Print only: the website menu_inline block and the canvas ignore them.'],
                ['menus.tax / menu_sections.tax / menu_items.tax', 'Migration 170 (replaced the dish and section vat_rate_takeaway / vat_rate_eat_in columns of migrations 122 and 127). jsonb { rate, rules: [{ venues, streams, types, rate }] }, {} = not set. Edited with TaxBox (components/menus/TaxBox.jsx) in the menu Settings, SectionDrawer and ItemDrawer; checked by checkMenuTax() on save (422 on the first problem) and by taxSettingProblems() in the page (Save off). Part of the release (menuDiff.js), so a tax change goes live on publish. See Tax, Order Types & Streams.'],
                ['menu_dietary_tags (admin page)', 'Route /menus/dietary-tags (MenuDietaryTags.jsx, DietaryTagsManager.jsx), titled Allergens & dietary tags since migration 145 (which also renames the default nav label from Dietary tags). Two Cards, Allergens and Dietary tags, each a drag-sortable list (SortableRows, PATCH /menus/dietary/reorder { ids }). Add and edit use one modal (TagModal: type, label, glyph, code, colour) calling POST /menus/dietary and PATCH /menus/dietary/:id; merge (POST /menus/dietary/:id/merge { into_id }) and delete are in the modal with inline confirms. An amber bar offers POST /menus/dietary/standard-allergens when any of the 14 is missing.'],
                ['menu_dietary_tags.kind / standard_key', 'Migration 145. kind dietary | allergen (default dietary). standard_key = which of the 14 UK allergens the tag is (celery, gluten, crustaceans, eggs, fish, lupin, milk, molluscs, mustard, nuts, peanuts, sesame, soya, sulphites), unique per tenant, only on allergens. The migration turns existing tags that match one by code or exact label (n / Nuts, Dairy, Soy...) into that allergen, then inserts the ones each tenant is missing. A standard allergen cannot become a dietary tag (PATCH 422).'],
                ['menu_dietary_tags.show_on_menu', 'Migration 146. Boolean, default true. Off = staff-only: left out of every guest surface, kept in the matrix, lookup and menu editor. TagModal On menus Show / Hide; the tags page marks the row Not on menus.'],
                ['menu_dietary_tags.in_key', 'Migration 147. Boolean, default true (new tags are in the key). Whether the allergen notice key lists the tag. Written only by PUT /menus/allergen-notice (key_tag_ids sets every tag of the tenant). A tag with show_on_menu off is never listed, whatever in_key says.'],
                ['menu_allergen_notice', 'Migration 147. One row per tenant (tenant_id PK, RLS): title, body, removable_note (explains the asterisk), ordering_text (online ordering only), used_only (key lists only ticked tags the dishes use). No row = DEFAULT_NOTICE in shared/menuTags.js. Seeded from each tenant\'s first allergens footer note.'],
                ['menu_item_dietary.level', 'Migration 145. contains | may_contain | removable (default contains); no row = the dish does not have it. Dietary tags are always contains: tagLevel() in menus.js forces it on every write, and turning an allergen into a dietary tag resets its links to contains.'],
                ['menu_sections.image_url', 'Migration 095. Nullable text (a Media library URL). A small category icon/image next to the section heading — capped at 1.3em (website block / canvas) or 1.6em (print) so it never renders larger than the heading font next to it, regardless of the uploaded image\'s actual resolution.'],
              ]}
            />
            <InfoBox type="info">
              Both are plain nullable columns with no companion "show/hide" toggle — they render
              automatically whenever set, the same way <Mono>notes</Mono> and{' '}
              <Mono>image_url</Mono> (dish photo) already work. Don't add a per-menu visibility
              toggle unless asked; that would be new scope, not what these migrations do.
            </InfoBox>
            <InfoBox type="warn">
              Printing drops background colours unless an element opts in with{' '}
              <Mono>print-color-adjust: exact</Mono> (plus the <Mono>-webkit-</Mono> form). Both print
              layouts set it on the dietary tag chips and the tinted boxes: <Mono>.tag-chip</Mono>,{' '}
              <Mono>.section.highlight</Mono>, <Mono>.item.featured</Mono>, <Mono>.menu-intro</Mono> in{' '}
              <Mono>menu_print.eta</Mono>, and <Mono>.ml-tag</Mono>, <Mono>.ml-item.featured</Mono>,{' '}
              <Mono>.ml-box-tint</Mono>, <Mono>.ml-intro</Mono> in <Mono>shared/menuLayout.js</Mono>. The
              page background is left out on purpose. A new coloured element meant to print needs the
              same rule; the on-screen preview always shows colours, so only a real print or PDF shows
              the problem.
            </InfoBox>
            <H3>Touch points for any new menu_items / menu_sections field</H3>
            <P>
              Because the whole tree is rewritten on every save, a new column needs updating in
              (all in <Mono>api/src/routes/menus.js</Mono> unless noted): the Zod{' '}
              <Mono>ItemBody</Mono>/<Mono>SectionBody</Mono> schema, the{' '}
              <Mono>loadMenuFull()</Mono> SELECT's <Mono>jsonb_build_object</Mono> (items only —
              sections use <Mono>SELECT s.*</Mono> so a new section column needs no query change),
              the <Mono>upsertMenuTree()</Mono> INSERT, and <Mono>menuSaveBody()</Mono> (the
              loaded-menu-to-PATCH-body copy used by <Mono>/:id/duplicate</Mono> and every AI menu
              tool: a field missing there is wiped whenever the assistant changes that menu). On the
              frontend (<Mono>admin/src/pages/Menus.jsx</Mono>):
              the new-item/new-section default object, the editor form field, and the explicit
              field whitelist in the save-payload builder (it does not spread <Mono>...item</Mono>
              — omitting a field there silently drops it on save even though the editor state has
              it). On the render side: <Mono>api/src/views/site/blocks/menu_inline.eta</Mono>{' '}
              (website), <Mono>api/src/views/menu_print.eta</Mono> (print), and{' '}
              <Mono>admin/src/components/website-builder/canvas/dataBlocks.jsx</Mono>'s{' '}
              <Mono>MenuInlineCanvas</Mono> (page-builder live preview) — the canvas/SSR-parity
              gotcha applies here same as the variant-visibility toggles: grep all three render
              sites, not just one, before considering a menu-item display change done.
            </P>
            <P>
              Pictures on the website block: block data <Mono>show_dish_photos</Mono> and{' '}
              <Mono>show_section_images</Mono> (default on, read as <Mono>!== false</Mono> so blocks
              saved before them keep their pictures; editor toggles Show dish photos / Show section
              pictures under Display, defaults in <Mono>blockRegistry.js</Mono>). Off, the{' '}
              <Mono>menu_inline.eta</Mono> partial and <Mono>MenuInlineCanvas</Mono> skip the dish{' '}
              <Mono>image_url</Mono> and the section heading picture. Block data only: no migration, the
              menu, online ordering, kiosks and print are unchanged.
            </P>
            <P>
              Dish order: each <Mono>SectionEditor</Mono> wraps its items in its own{' '}
              <Mono>DndContext</Mono> + <Mono>SortableContext</Mono> (Pointer, Touch and Keyboard
              sensors, <Mono>restrictToVerticalAxis</Mono> + <Mono>restrictToParentElement</Mono>),
              so a dish can only be dropped within its own section. <Mono>ItemRow</Mono> uses{' '}
              <Mono>useSortable</Mono> with the grip button as the activator, so tapping the row
              still opens the dish panel. The drop reorders the draft with <Mono>arrayMove</Mono>;
              the save payload's <Mono>sort_order</Mono> is the array index, so nothing server-side
              changed.
            </P>
            <P>
              A dish&apos;s option groups in the dish panel: <Mono>AttachedGroups</Mono> (its own{' '}
              <Mono>DndContext</Mono> + <Mono>SortableContext</Mono>, the same sensors and modifiers) and{' '}
              <Mono>AttachedGroupCard</Mono> (<Mono>useSortable</Mono> on the group id, the grip as the
              activator, <Mono>disabled</Mono> for View; <Mono>CSS.Translate</Mono> so cards of different
              heights aren&apos;t stretched). A drop reorders <Mono>item.variant_groups</Mono> with{' '}
              <Mono>arrayMove</Mono>; the save sends the index as <Mono>sort_order</Mono>{' '}
              (<Mono>menu_item_variant_groups</Mono>), which <Mono>attachVariantGroupsToItems()</Mono> orders
              by, so the order reaches the release (<Mono>menuDiff.js</Mono> compares{' '}
              <Mono>variant_groups</Mono> by position: &quot;options or option prices changed&quot;) and{' '}
              <Mono>itemChoices()</Mono> / <Mono>posChoices()</Mono> ask the groups in it. Cards start
              closed: <Mono>ItemDrawer</Mono> keeps <Mono>openGroups</Mono> (a Set of group ids) and the page
              keys it by the dish id, so every dish opens with all closed; <Mono>attachGroup()</Mono> opens
              the new group. The card&apos;s name is a <Mono>div role=&quot;button&quot;</Mono>{' '}
              (<Mono>aria-expanded</Mono>, Enter and Space), not a button: the panel is a disabled fieldset
              for View users, who must still open it to see the prices. Test ids <Mono>dish-groups</Mono>,{' '}
              <Mono>dish-group</Mono> (<Mono>data-group</Mono>, <Mono>data-open</Mono>),{' '}
              <Mono>dish-group-toggle</Mono>, <Mono>dish-group-summary</Mono>.
            </P>
            <H3>Print layout (menu_print.eta)</H3>
            <P>
              The print page is built from designed pages: sections are split into page groups
              wherever a section has <Mono>print_break_before = 'page'</Mono>, and each group
              renders as its own <Mono>.page</Mono> sheet (paper-sized, the same padding on screen
              and in print) with its header (full on page 1; later pages per{' '}
              <Mono>repeat_header</Mono>), its own multi-column <Mono>.cols</Mono>, and a{' '}
              <Mono>.page-bottom</Mono> pushed to the bottom by flex (callouts + footer line on the
              last page, or every page with <Mono>repeat_footer</Mono>, plus "Page x of y"). Column
              breaks are <Mono>break-before: column</Mono> (not on a page group's first section);
              keep-together is <Mono>break-inside: avoid</Mono> on the section. Font scale is a{' '}
              <Mono>--fs</Mono> CSS variable multiplied into every font size after the print bar.
            </P>
            <P>
              A small inline script measures each sheet after fonts load: a page taller than the
              paper gets a red <Mono>.fit-note</Mono> (screen only) with the excess in mm, the
              print bar shows a summary, and the page gets class <Mono>spills</Mono>, which drops
              its flex layout so the print engine can break it onto a second sheet (header and
              footer then only appear once). The check is skipped when the window is narrower than
              the page, since the screen layout then differs from print. Tested by rendering the
              template in headless Chromium and counting PDF pages: fitting designed pages give
              exactly one sheet each.
            </P>
            <H3>Allergens and dietary tags (migration 145)</H3>
            <P>
              Every tag is a dietary tag (on a dish or not) or an allergen (on a dish at a level:
              Contains, May contain, Can be removed). <Mono>shared/menuTags.js</Mono> holds the
              rules: <Mono>STANDARD_ALLERGENS</Mono> (the 14, also used by{' '}
              <Mono>ensureStandardAllergens()</Mono> in <Mono>services/menuSeeds.js</Mono>, called for
              new tenants in <Mono>POST /api/platform/tenants</Mono>, by the menu seed route and by the
              tags page button), <Mono>ALLERGEN_LEVELS</Mono>, <Mono>LEVEL_LABELS</Mono>,{' '}
              <Mono>REMOVABLE_NOTE</Mono>, <Mono>levelOf()</Mono>, <Mono>isRemovable()</Mono>,{' '}
              <Mono>menuTags()</Mono>, <Mono>hasRemovable()</Mono> and the allergen notice helpers{' '}
              <Mono>DEFAULT_NOTICE</Mono>, <Mono>noticeOf()</Mono> and <Mono>allergenKey()</Mono>{' '}
              (migration 147, below).
            </P>
            <P>
              In the menu tree a dish keeps <Mono>dietary</Mono> (codes of every tag it shows, both
              kinds, in tag order) and gains <Mono>allergen_levels</Mono>{' '}
              (<Mono>{'{ code: level }'}</Mono>, only levels other than contains).{' '}
              <Mono>loadMenuFull()</Mono>, the website loader (<Mono>loadInlineMenus()</Mono> in
              siteDataSvc.js) and <Mono>loadOrderingMenu()</Mono> all return it; <Mono>ItemBody</Mono>,{' '}
              <Mono>upsertMenuTree()</Mono>, <Mono>/duplicate</Mono> and the Menus.jsx save payload
              carry it. <Mono>upsertMenuTree()</Mono> also resolves a standard key as a code, so the
              seeds can say <Mono>nuts</Mono> for a tenant whose nuts tag is code <Mono>n</Mono>. Tag
              order: dietary tags first, then allergens, each by <Mono>sort_order</Mono> (the matrix
              API lists allergens first).
            </P>
            <P>
              On menus May contain looks the same as Contains and Can be removed adds a small
              asterisk inside the badge, with <Mono>* Can be removed on request</Mono> in the key.
              Six places draw the badges and must stay in step: <Mono>menu_print.eta</Mono>,{' '}
              <Mono>menu_print_dietary.eta</Mono>, <Mono>shared/menuLayout.js</Mono> (designed print
              and designer canvas), <Mono>blocks/menu_inline.eta</Mono>, <Mono>MenuInlineCanvas</Mono>{' '}
              in <Mono>dataBlocks.jsx</Mono>, and <Mono>shared/ordering.eta</Mono>. What the key
              under a menu lists, and the asterisk note&apos;s words, come from the allergen notice
              (below).
            </P>
            <P>
              Staff tools show the levels apart with <Mono>LevelChip</Mono> (AllergenMatrix.jsx):
              filled = Contains, outlined on a pale tint = May contain, filled with an asterisk = Can
              be removed. The dish panel in Menus.jsx (<Mono>AllergenPicker</Mono>) and the matrix
              cycle an allergen No, Contains, May contain, Can be removed; dietary tags toggle.
            </P>
            <P>
              Tags with <Mono>show_on_menu</Mono> off (migration 146) are dropped where guest data is
              loaded, so the six renderers above skip their codes (each already ignores a code with no
              tag): <Mono>loadPrintMenu()</Mono> (automatic and designed print, dietary list, and the
              designer, which draws what prints) and <Mono>GET /menus/public/:menuId</Mono> filter{' '}
              <Mono>dietary_tags</Mono> through <Mono>menuTags()</Mono>; <Mono>loadInlineMenus()</Mono>{' '}
              filters tags, dish codes and levels in SQL; <Mono>loadOrderingMenu()</Mono> filters tags,
              codes and levels; <Mono>MenuInlineCanvas</Mono> uses <Mono>menuTags()</Mono> itself because
              it reads the admin menu route. <Mono>allergenKey()</Mono> / <Mono>hasRemovable()</Mono> only
              count shown tags, so the asterisk note goes when the only removable allergen is hidden.{' '}
              <Mono>loadMenuFull()</Mono> and the matrix keep every tag.
            </P>
            <H3>Allergen notice (migration 147)</H3>
            <P>
              One notice per tenant, built in the <Mono>AllergenNoticeCard</Mono> on the Allergens &amp;
              dietary page (<Mono>DietaryTagsManager.jsx</Mono>): title, body, which tags its key lists
              (<Mono>menu_dietary_tags.in_key</Mono>), <Mono>used_only</Mono>, the asterisk note and an
              online-ordering line, with a preview and explicit Save / Discard. The draft keeps key ticks
              as changes over each tag&apos;s <Mono>in_key</Mono>, so a tag added meanwhile keeps its own
              value. API: <Mono>GET /api/menus/allergen-notice</Mono> (the notice through{' '}
              <Mono>noticeOf()</Mono>) and <Mono>PUT /api/menus/allergen-notice</Mono>{' '}
              (<Mono>requireRole(&apos;admin&apos;, &apos;owner&apos;)</Mono>, body{' '}
              <Mono>{'{ title, body, removable_note, ordering_text, used_only, key_tag_ids? }'}</Mono>; upserts the
              row and sets <Mono>in_key = id = ANY(key_tag_ids)</Mono> for every tag of the tenant in one
              transaction; <Mono>removable_note</Mono> can&apos;t be blank).
            </P>
            <P>
              <Mono>loadAllergenNotice(tx, tenantId)</Mono> in <Mono>routes/menus.js</Mono> loads it;{' '}
              <Mono>loadMenuFull()</Mono> attaches it as <Mono>allergen_notice</Mono> (so print, the
              designer, the public menu JSON and the builder canvas have it), <Mono>loadInlineMenus()</Mono>{' '}
              attaches it to each website menu, and <Mono>GET /order-api/venues/:id</Mono> returns it.
              Every renderer builds the key with{' '}
              <Mono>allergenKey(tags, sections, notice)</Mono>: the notice&apos;s words plus the tags shown
              on menus, ticked for the key and (with <Mono>used_only</Mono>) used by those sections&apos;
              dishes, and <Mono>removable</Mono> when a dish shows a removable allergen.
            </P>
            <DataTable
              head={['Surface', 'How the notice shows']}
              rows={[
                ['menu_print.eta', 'A footer note of kind allergens prints the notice (title, body, key, asterisk note) instead of its own title/body. The print route passes it.key = allergenKey(...) for the printed sections.'],
                ['shared/menuLayout.js', 'buildContext() sets ctx.key from allergenKey(). The callouts block prints the notice for an allergens note; the key block prints only the key (empty when it has nothing to list). Chip tooltips use removable_note.'],
                ['menu_print_dietary.eta', 'Notice title/body above the key. The key div carries data-used-only when used_only is on; only then does the Choose dishes script hide key pairs no ticked dish uses.'],
                ['blocks/menu_inline.eta + MenuInlineCanvas', 'Under the menu unless block data show_allergen_notice is false (editor toggle Show allergen notice); then only the asterisk note shows when needed. The .eta gets allergenKey through it.siteBlocks (siteRenderer.js SITE_BLOCKS), for the sections and dishes the block keeps.'],
                ['shared/ordering.eta', 'Imports allergenKey / noticeOf from /order-api/menuTags.js (shared/menuTags.js served by orderApi.js). The notice, then ordering_text plus the venue phone, under the menu; replaced the fixed allergy sentence.'],
                ['Menus.jsx CalloutsPanel / MenuDesigner.jsx', 'An Allergies & Diet note has no title/body inputs, just a link to the Allergens & dietary page; its stored title stays (CalloutBody needs one). The designer picker names it after the notice.'],
              ]}
            />
            <H3>Allergen matrix (migration 141)</H3>
            <P>
              No new data tables: the matrix edits <Mono>menu_item_dietary</Mono> (dish to tag links)
              against the tenant&apos;s <Mono>menu_dietary_tags</Mono>. <Mono>GET /api/menus/:id/allergens</Mono>{' '}
              (any signed-in user) returns{' '}
              <Mono>{'{ menu: { id, name, venue_name }, tags, sections: [{ id, title, visibility, items: [{ id, name, native_name, description, levels: { tagId: level } }] }] }'}</Mono>{' '}
              from <Mono>loadAllergenMatrix()</Mono> in <Mono>routes/menus.js</Mono>, every section
              included, tags with <Mono>kind</Mono> and <Mono>standard_key</Mono>, allergens first.{' '}
              <Mono>PUT /api/menus/:id/allergens</Mono>{' '}
              (<Mono>requirePermission(&apos;menus&apos;, &apos;manage&apos;)</Mono>) takes{' '}
              <Mono>{'{ items: [{ item_id, levels: { tagId: level } }] }'}</Mono> for the changed dishes only: 422 if any
              dish isn&apos;t on that menu, tag ids not belonging to the tenant are dropped, then each
              sent dish&apos;s links are replaced and <Mono>menus.updated_at</Mono> bumped. It never
              goes through the whole-tree <Mono>PATCH /:id</Mono>, so it can&apos;t disturb sections,
              prices or designs; but a menu editor draft loaded before the save will write its own
              (older) tags back on its next save.
            </P>
            <P>
              Every dish row in <Mono>AllergenLookup</Mono> is a button that expands to the description
              and each tag by name, grouped Contains / May contain / Can be removed / Dietary (one open
              at a time). Its free-from filter keeps dishes the allergen can be removed from, flagged
              &quot;Ask for it without ...&quot;; May contain never counts as free from. Admin: <Mono>pages/MenuAllergenMatrix.jsx</Mono> (<Mono>/menus/allergens</Mono>, nav link
              under Menus, seeded by the migration for existing tenants and by{' '}
              <Mono>defaultNav.js</Mono>) renders <Mono>AllergenMatrixEditor</Mono>;{' '}
              <Mono>AllergenLookup</Mono> is the read-only widget body (search, and a tag filter that
              cycles any / contains / free from; sections with <Mono>visibility = &apos;hidden&apos;</Mono>{' '}
              left out). The tags sit in <Mono>TagFilterModal</Mono>, a pop-up grid (allergens, then
              dietary) opened by the Allergens &amp; diet button; only the filters in use show in the
              widget, as chips that remove themselves. The pop-up is rendered inline, not in a portal,
              so it stays visible inside a dashboard in full screen. Both live in <Mono>components/menus/AllergenMatrix.jsx</Mono> and share{' '}
              <Mono>useMenuChoice()</Mono> (menu choice in localStorage) and{' '}
              <Mono>useAllergenMatrix()</Mono> (query key <Mono>['allergen-matrix', menuId]</Mono>).
              The lookup passes <Mono>live: true</Mono> to both (migration 165): it lists only menus
              with a live version (<Mono>GET /menus?status=1</Mono>) and reads{' '}
              <Mono>GET /menus/:id/allergens?version=live</Mono> (key{' '}
              <Mono>['allergen-matrix', menuId, 'live']</Mono>); the matrix editor stays on the draft.
              Migration 141 adds <Mono>allergen_lookup</Mono> to the{' '}
              <Mono>hs_dashboard_widgets.widget_type</Mono> CHECK (any dashboard since migration
              152; the widget remembers its menu as{' '}
              <Mono>maca_allergen_lookup_&lt;widgetId&gt;</Mono>) and to the{' '}
              <Mono>dashboard_tiles.tile_type</Mono> CHECK (<Mono>TILE_CATALOG</Mono>).
            </P>
            <H3>Menu designer (menu_print_designs)</H3>
            <P>
              A menu can have any number of print designs. Migration 121 stored one layout on{' '}
              <Mono>menus.print_layout</Mono>; migration 135 moved it into{' '}
              <Mono>menu_print_designs</Mono> (id, tenant_id, menu_id, name, layout jsonb, ordered
              by created_at; existing layouts became "Design 1") and dropped the column.{' '}
              <Mono>menus.print_design_id</Mono> (FK, ON DELETE SET NULL) is the design{' '}
              <Mono>GET /api/menus/:id/print</Mono> renders with{' '}
              <Mono>menu_print_designed.eta</Mono>, so the admin Print button and the website{' '}
              <Mono>menu_inline</Mono> block's PDF link show it; NULL = the automatic{' '}
              <Mono>menu_print.eta</Mono>. <Mono>?design=&lt;id&gt;</Mono> prints any of the menu's
              designs, <Mono>?auto=1</Mono> the automatic layout. <Mono>?view=dietary</Mono> renders{' '}
              <Mono>menu_print_dietary.eta</Mono> instead, whatever design is chosen: dish name and its
              dietary tag chips (glyph + colour, icons only) per row, grouped by section, sections with{' '}
              <Mono>visibility = 'hidden'</Mono> dropped, portrait on the menu's paper size, the
              allergen notice and its key (from <Mono>allergenKey()</Mono>, plus the asterisk note; rows with a
              removable allergen carry <Mono>data-removable</Mono> so the note hides with them). Its <strong>Choose dishes</strong> mode is screen-side only: each row
              carries <Mono>data-id</Mono> / <Mono>data-tags</Mono>, unticked ids are kept in
              localStorage <Mono>maca_dietary_skip_&lt;menuId&gt;</Mono> (left-out ids, so new dishes
              show), and the <Mono>.off</Mono> class hides rows, empty section rows and unused key
              entries in print. Linked from the Menus list and editor (<Mono>Dietary list</Mono>).
            </P>
            <DataTable
              head={['Piece', 'Detail']}
              rows={[
                ['Layout shape', '{ paper_size, orientation, margin_mm, cols (6|12|24), row_mm (2.5|5|10), font_scale, master: [block], pages: [{ id, hide_master, blocks: [block] }] }. block = { id, type, ref, x, y, w, h, opts }, x/w in grid columns, y/h in grid rows. master blocks draw on every page (under the page\'s own blocks) unless the page has hide_master.'],
                ['Fold', 'layout.fold (none | vertical | horizontal), fold_gap_mm (0-40, default 10), fold_line. layoutGeometry() keeps the column count (or an even row count) but splits it in half with the gap between: colMm = (contentW - gap) / cols, and colStart/colEnd (rowStart/rowEnd) add the gap to any grid line past the middle, so a block on either side stays clear of it and one spanning the middle includes it. A top / bottom fold centres the content vertically so the gap sits on the sheet\'s centre line. colAtMm()/rowAtMm() map a mm position back to the grid for the designer\'s drag and resize; crossesFold() keeps new blocks off the fold; foldGapBox() gives the strip the designer shades and the optional dashed .ml-fold-line printed in it.'],
                ['Variant columns', 'layout.variant_columns (1-3, default 1) sets how many variant label + price pairs sit in a row; item and full-section blocks can override it with opts.variant_columns (unset = the layout default). itemHtml() builds .ml-variants as a grid of .ml-v pairs.'],
                ['Fonts', 'layout.font_body / font_heading / font_script (defaults Inter / Fraunces / Caveat) and per-block opts.font, all z.enum(FONT_OPTIONS) from shared/fonts.js (the website builder\'s list, now shared with Website.jsx, SiteBlockEditors.jsx, ReservationsWidget.jsx and FontPicker.jsx). pageStyle() sets --ml-body / --ml-heading / --ml-script; a block with opts.font sets all three on itself, and .ml-block re-reads font-family so the override takes. layoutFontsUrl(layout) builds one Google Fonts URL for the fonts in use (googleFontsUrl() requests only each font\'s real weights, plus Fraunces\' opsz axis); the print route and the designer both load it. GET /:id/design also returns site_fonts { heading, body } from tenant_site.theme.typography for Page setup\'s "Use website fonts" (a copy, not a live link).'],
                ['Block types', 'header, intro, section (opts.mode title | full, columns), item, text, image, divider, callouts, key, footer, page_number. ref = menu_sections.id or menu_items.id for section / item.'],
                ['Validation', 'LayoutBody in menus.js: every block inside the grid (x + w <= cols, y + h <= rows for the paper, margin and row height), section/item need a ref, opts is a whitelisted object (unknown keys stripped). Max 20 pages, 400 blocks a page, 100 repeated.'],
                ['Routes', 'GET /api/menus/:id/design (the menu with designs[] and print header details: tenant name, logo, brand colour, venue address; shared loadPrintMenu() with the print route). POST /:id/designs { name, layout } (201; a menu\'s first design also becomes print_design_id), PUT /:id/designs/:designId { name?, layout? }, DELETE /:id/designs/:designId, PUT /:id/print-design { design_id | null } (the design must belong to the menu, else 404). Menu GETs return design_count. The whole-tree PATCH never touches designs.'],
                ['Designer designs bar', 'MenuDesigner.jsx: a pill per design (Printing badge on print_design_id), Copy (new unsaved design from the current one), New design. The open design is kept in the URL (?design=<id>); first load picks the URL one, else the printing one, else the first. Switching is disabled while there are unsaved changes. A new design has designId null and saves with POST; after that PUT. The Page panel\'s "This design" section renames, chooses the design for printing (or the automatic layout), and deletes it (inline confirm; deleting the printing design sends printing back to automatic).'],
                ['Section visibility', 'menu_sections.visibility (migration 136): show | website_hidden | hidden. website_hidden = printed menus only. Left out by loadInlineMenus() in siteDataSvc.js (menu_inline block), GET /api/menus/public/:menuId, loadOrderingMenu() in orderSvc.js (online ordering counts as the website, so those dishes can\'t be ordered) and the builder canvas (MenuInlineCanvas). hidden = also not printed: the print route filters it before menu_print.eta, and buildContext() / placementSummary() in shared/menuLayout.js leave it out, so a designer block on it draws nothing in print and the designer explains why (missingText()) rather than calling it deleted. Edited in the Menus section panel ("Where it shows"), with Hidden / Print only row badges.'],
                ['One renderer', 'shared/menuLayout.js (repo root, plain ESM, own package.json with type module). The print view calls renderPageHtml(); MenuDesigner.jsx draws its own draggable wrappers but fills them with renderBlockInner() and positions them with blockStyle(), and injects the same MENU_LAYOUT_CSS. Admin imports it through the @shared Vite alias; the API by relative path.'],
                ['Dish option prices', 'A dish\'s per-option prices live in menu_item_variant_prices (item, option, price). loadMenuFull() returns each attached group as options[] with overridden + price_pence; Menus.jsx edits them as overrides[]. overridesOf() in Menus.jsx reads either shape, and both setOverride() and the save payload use it, so editing one option keeps the others.'],
                ['Stable ids', 'upsertMenuTree() still deletes and re-inserts the tree, but inserts sections and items under the ids the client sends (Menus.jsx sends s.id / it.id; new ones are crypto.randomUUID()). A duplicate id in one save is a 23505, 409. /duplicate gives the copy fresh ids and copies every print design with remapLayout(), which remaps block refs (dropping blocks whose section or dish is gone) and callout_ids; the copy\'s print_design_id points at the copy of the printing design. Footer notes (menu_callouts) keep their ids the same way (Menus.jsx ensureIds() gives new notes an id), because a callouts block can pick notes by id.'],
                ['Positions', 'A save that leaves sort_order out of a section, dish, dish option, attached option group or footer note gets its place in the list (the Zod bodies have no default, so upsertMenuTree()\'s fallback to the index applies). loadMenuFull() puts dishes with the same position in name order, then id order: its json_agg(DISTINCT ...) hands them back in no useful order (by the jsonb, so by random id), which once made a test pass or fail by chance.'],
                ['Footer notes pick', 'A callouts block\'s opts.callout_ids (uuid array, max 50, LayoutBody) limits it to those notes, in the menu\'s order; absent = every note, new ones included; ids of deleted notes are ignored. pickedCallouts(menu, opts) in shared/menuLayout.js is used by the renderer and the designer panel (Show all notes + a tick box per note). /duplicate maps callout_ids to the copy\'s new note ids.'],
                ['Stays linked', 'Blocks store only a ref and grid position; content is read from the live menu. A ref that no longer exists renders nothing in print and a red "deleted" placeholder in the designer. A full section leaves out dishes that have their own item block (ctx.placedItemIds). placementSummary() drives the designer\'s "Not placed yet" tray.'],
                ['Print CSS', 'Each .ml-page is the paper size, blocks are absolutely positioned in mm inside .ml-content, overflow hidden. In print each page box is the printable area (100vw x 100vh, minus 0.5mm) with break-after: page, and .ml-content is translated by half the difference from the paper size, so a printer that keeps its own margins neither adds a blank sheet per page nor moves the design on the paper. A screen-only script outlines blocks whose content is taller than the block and lists the pages in the print bar.'],
              ]}
            />
            <P>
              Designer interaction uses pointer events, not @dnd-kit (a free 2D canvas with snap,
              cross-page moves and corner resizing is not an ordered list). The page is drawn at
              real mm size inside a <Mono>transform: scale()</Mono> wrapper; pointer maths divides
              by the zoom. On touch the first tap selects a block and only a selected block has{' '}
              <Mono>touch-action: none</Mono>, so the canvas still scrolls. Newly dropped
              text-bearing blocks (FITTABLE) are measured after render and set to their content
              height. Tested: API routes against Postgres, the designed print as a PDF in headless
              Chromium (one sheet per designed page), and the designer driven in Chromium with a
              mocked API (tap-add, tray drag with snap preview, move, resize, repeat on every page,
              add page, save payload).
            </P>

            <H3>Deliveroo menu file (migration 157)</H3>
            <P>
              <Mono>/menus/deliveroo</Mono> (<Mono>pages/MenuDeliveroo.jsx</Mono>, pieces in{' '}
              <Mono>components/menus/DeliverooParts.jsx</Mono>) reads the Deliveroo Hub bulk-management
              file, fills it from our menus, lets staff review and edit it, and writes it back with the
              same columns, order, item ids and line endings. The file is never stored on the server:
              the page keeps it in sessionStorage (<Mono>maca_deliveroo_file_&lt;venueId&gt;</Mono>).
              What is stored, per venue, is how to fill it.
            </P>
            <DataTable
              head={['Piece', 'Detail']}
              rows={[
                ['shared/deliveroo.js', 'All the rules, used by the page and the API: parseCsv() (text kept exactly, quotes, CRLF, BOM; returns eol + trailing), readSheet() (header check: item_id, item_name, delivery_price; duplicate ids), tidyRows(), toCsv(columns, rows, { eol, trailing }), priceRule(), dishPrice(), dishValues(), nameScore() / rankDishes() / matchRow(), buildRow(), rowProblems(), defaultMaps(), FILL_FIELDS, DELIVEROO_ALLERGENS, DELIVEROO_DIETARY. Tests: node --test shared/test/deliveroo.test.mjs.'],
                ['deliveroo_settings', 'One per venue: menu_ids (empty = every published menu of the venue or the company), price_uplift_pct, price_round_pence (1|5|10|50|100), price_round_mode (up|nearest), fill { column: bool } over defaultFill(), allergen_map / dietary_map { tag code: [Deliveroo codes] } over defaultMaps() (standard_key: gluten -> gluten_wheat, sesame -> sesame_seeds, soya -> soybeans, sulphites -> sulphur_dioxide_sulphites, nuts -> none), include_may_contain, include_removable.'],
                ['deliveroo_item_links', 'One per venue per Deliveroo item_id: menu_item_id (no FK, upsertMenuTree() re-inserts dishes) or skip, keep text[] (columns where Deliveroo\'s value stays), overrides { column: text } (typed values). Only FILL_FIELDS columns can be kept or overridden.'],
                ['Matching', 'A saved link wins (linked / skipped / missing when the dish is gone). Else rankDishes() over name, native_name, kitchen_name: 1 = same normalised name, 0.95 = same without brackets, without pack words (can, bottle, 330ml) or without spaces, else word overlap capped at 0.89 (0.75 when one name contains the other). auto when the best is >= 0.9 and not tied; else suggested (top 3) or none.'],
                ['Filling', 'dishValues(): delivery_price = priceRule(dishPrice(dish), pct, round, mode); dishPrice() = price_pence, else the cheapest base-mode option or ad-hoc variant. tax_rate = dish.vat, worked out by the API with taxFor() for the settings\' order_type_id (default: the tenant\'s type named Delivery) and revenue_stream_id (deliveroo_settings, migration 170). allergens = the mapped codes of the dish\'s allergen tags (May contain / Can be removed per settings); an allergen tag with no code is an error, so the CSV can\'t silently drop it. buildRow(): override, then keep, then the menu value; an empty menu value never blanks Deliveroo\'s; columns outside FILL_FIELDS are never touched.'],
                ['Checks', 'rowProblems(): errors = what Deliveroo would refuse (no item_id or one Excel turned into 1.23E+15, delivery price not a positive amount with up to 2 decimals, VAT not 0/5/12.5/20, calories not a whole number, no_allergens with others, booleans not true/false); warnings = price change over 30%, unknown allergen or dietary code. The CSV download is disabled while any error is left.'],
                ['Routes (/api/deliveroo)', 'POST /read { file_name, data base64 } (menus view; CSV decoded as UTF-8, else Windows-1252; .xlsx/.xls via xlsx with formatted text; 8 MB file limit, bodyLimit 12 MB; 5000 rows). GET /venues/:venueId (view; settings with defaults, links, menus, menu_ids_used, dishes with dietary, allergen_levels, variant_groups, variants, vat and vat_name for the settings\' order type and stream, order_types, revenue_streams, tags). PUT /venues/:venueId/settings and PUT /venues/:venueId/links (menus manage; links upsert the items sent, delete the ones sent with nothing to remember, leave others alone; menu ids and dish ids are checked to be the tenant\'s). POST /xlsx { columns, rows, file_name } (view; every cell a text cell so Excel keeps ids and prices as typed). Every query filters tenant_id.'],
                ['Page', 'Settings draft applies to the review live and is saved with Save settings (menus picked only change the dish list after saving). Save matches sends only rows whose effective link (auto matches included, so they become stable) differs from the saved one. CSV is built in the browser with toCsv() using the file\'s own eol / trailing newline; the API test checks a file read and written back unchanged is byte for byte the same. api.postBlob() (lib/api.js) downloads the .xlsx.'],
              ]}
            />
            <P>
              Deliveroo's allergen codes were taken from Deliveroo's bulk-management and Menu API
              guides and are only offered as suggestions (the map is editable, and unknown codes are a
              warning, not an error). Tested: shared tests, the API against Postgres with two tenants
              and the real One Thai Ware export (round trip, Windows-1252, xlsx in and out, permissions),
              and the page in Chromium at 1280, 1015 and 390 px (match, skip, keep, typed prices, code
              map, save, download and reload).
            </P>
          </section>

          {/* ── COMBOS ─────────────────────────────────────── */}
          <section id="combos" data-doc="">
            <H2>Combos</H2>
            <P>
              Migration 171. A combo is a <Mono>menu_items</Mono> row with <Mono>kind = 'combo'</Mono> and a{' '}
              <Mono>combo</Mono> jsonb: steps with choices, conditions and repeats, used by the till, online
              ordering, the kitchen, the website, printed menus and menu screens. It replaced the till-only meal
              deal slots (<Mono>{'{ slots: [...] }'}</Mono>), which the migration turned into steps in the menu
              tables and in every <Mono>menu_releases</Mono> snapshot (choice ids from{' '}
              <Mono>md5(slot id + dish / section id)</Mono>, so drafts and releases match; hashes blanked and
              recomputed at start by <Mono>rehashReleases()</Mono>).
            </P>
            <Code>{`menu_items.combo = {
  mode: 'manual' | 'auto',
  steps: [{
    id, name, min, max,          // min 0 = optional; max up to 20
    repeat,                      // the same choice more than once
    auto,                        // fill (and skip) a step with one open choice
    ask: 'always' | 'button',    // 'button' only when min = 0
    when: null | { step_id, option_ids },   // an EARLIER step; [] = anything picked there
    options: [{ id, type: 'item' | 'section' | 'custom',
                item_id, section_id, label, kitchen_name, price_pence,
                photo_url,               // only when set (the meal's picture, migration 199)
                groups }],               // only when set: the dish's options in this deal (below)
  }],
}
selection.combo = { [stepId]: [{ option_id, item_id, choices }] }   // item_id null for a custom choice`}</Code>
            <H3>One set of rules: shared/combos.js</H3>
            <DataTable
              head={['Function', 'What it does']}
              rows={[
                ['normaliseCombo(raw), comboOf(item)', 'The stored shape, cleaned; comboOf caches it on the item (non-enumerable _combo).'],
                ['menuCtx(menu), sectionItemsOf(menus)', 'ctx = { itemsById, sectionItems } that every function below takes to find a step\'s dishes.'],
                ['stepChoices(step, ctx)', 'A step\'s choices: items, every dish of a section (key option.id + ":" + itemId), custom ones; never a combo or the combo itself; sold out flagged.'],
                ['resolveSteps(item, picks, ctx)', '{ picks, steps: [{ step, choices, shown, auto }] }: drops picks on steps whose condition no longer holds (in step order), fills single-choice auto steps.'],
                ['priceCombo(item, selection, ctx, partPrice)', '{ ok, parts, upcharge, extras, picks } or { ok: false, error, step_id }. partPrice(part, choices) is the caller\'s option engine; a part\'s base options never change the deal price, its extras do.'],
                ['comboFromPrice(item, base, ctx)', '{ pence, varies }: own price + cheapest picks of unconditional required steps; varies when any choice has a charge. Wrapped by fromPrice() / priceVaries() / comboMenuPrice() in shared/orderPricing.js.'],
                ['comboGuide(item, ctx)', 'The steps in words for a menu screen\'s How to order view.'],
                ['findAutoCombos(lines, combos, ctx, base)', 'Automatic combos in a set of separate lines: greedy, biggest saving first, only when cheaper than the lines; a line with picks ({ groupKey: [optionId] }) only fills a choice whose deal options it fits (dealFits(), the cheapest such choice); returns [{ combo_id, name, count, saving, lines: { key: pence } }] with the saving spread by spreadCapped() (never more than a line\'s own price).'],
                ['combosWithItem(), stepWithItem()', 'Which combos offer a dish and where it goes (the till\'s Make it a combo).'],
                ['comboProblems(combo, { itemIds, sectionIds })', 'What stops a combo working (the editor\'s amber list).'],
                ['countParts(parts)', 'For display only: the same pick twice in a step as one entry with a count ("2 x Ketchup pot"). Works on till, online and kitchen part shapes.'],
                ['normaliseDealGroups(raw), dealChoices(choices, groups, swap), dealSwapIds(item), dealFits(groups, picks)', 'A dish choice\'s options in the deal (next heading): the stored shape cleaned, the rule applied to a dish\'s choice list, the library groups a combo swaps in, and whether a dish ordered on its own could have been asked that way.'],
              ]}
            />
            <H3>A dish&apos;s options in a deal</H3>
            <P>
              A dish or section choice can change what its dish asks inside the deal, one option group at a
              time (Edit steps &rarr; Options in this deal). The choice keeps <Mono>item_id</Mono> /{' '}
              <Mono>section_id</Mono>, so routing, stock, allergens, photos and sold out still follow the menu
              dish; only the dish&apos;s choice list changes. No migration: <Mono>groups</Mono> lives in the
              combo jsonb, stored only when set (never on a custom choice), so a plain save publishes nothing.
            </P>
            <Code>{`option.groups = {
  [groupKey]: {                  // a library group id, or 'variants' for the dish's own one-off options ('v:<label>' ids)
    use: 'all' | 'off' | 'only' | 'swap',
    option_ids,                  // 'only': the options kept (none left = 'off')
    group_id,                    // 'swap': the library group asked instead (not itself)
    max, min,                    // optional limits in the deal
    prices,                      // optional { optionId: pence } (0-100000): the deal's own extra charge per option
  },                             // 'all' with no limits and no prices is dropped
}`}</Code>
            <P>
              <Mono>dealChoices(choices, groups, swap)</Mono> in shared/combos.js is the one rule, applied to a
              dish&apos;s choice list in the caller&apos;s shape: off drops the group, only filters its options,
              swap asks <Mono>swap(groupId, choice)</Mono> for the other group in the same shape (null = left
              out), then the limits (max capped at the options left unless the group repeats; a group with min
              &gt; 0 is never on request). A group with no options left is dropped. A group the deal changes
              that ends with one option and needs a pick (min &ge; 1; a repeating group only when min = max;
              not an option with a child_group_id) comes back with <Mono>fixed</Mono> (that option&apos;s id,
              min times for a repeating group): the deal picks it and nobody is asked. A group with{' '}
              <Mono>prices</Mono> is asked as extras (<Mono>withDealPrices()</Mono>: <Mono>mode: 'extra'</Mono>,
              each option at its deal price, else its own price in an extra group or 0 in a base group, whose
              prices are dish prices the deal&apos;s price replaces), so every engine charges it with no code of
              its own and <Mono>optionPriceText()</Mono> shows &ldquo;+£0.50&rdquo;. Each surface wraps it:
            </P>
            <DataTable
              head={['Where', 'How']}
              rows={[
                ['Pricing', 'priceCombo() passes the choice\'s groups as partPrice(part, picks, groups); priceItem() (till, kiosk) prices with partChoices(part, groups, groupsById) and priceLine() (online) with partOptions(combo, part, groups), so a pick the deal doesn\'t ask is refused and another group charges its own prices.'],
                ['Till and kiosk', 'partChoices() in shared/pos/pricing.js builds a swapped group as if attached (posChoices with variant_rules); dealItem(config, id, groups) in shared/pos/offers.js is the part with deal pos_choices, used by ItemModal ComboSteps, the kiosk Builder (comboPages), bundleParts() and comboStartFrom(). Make it a combo trims carried picks with picksWithin().'],
                ['Online', 'loadOrderingMenu() loads dealSwapIds() of the live combos from the library (COALESCE(display_name, name)) and gives each combo deal_groups { id: choice } (itemChoices with the menu\'s variant rules); ordering.eta asks partOptions() for every part page and the summary.'],
                ['What the deal picks (fixed)', 'withDealPicks(choices, picks) in shared/combos.js fills each fixed group in, replacing whatever was sent; the part callbacks of priceItem() and priceLine() call it, so the pick is priced and is in the part\'s modifiers / options and on kitchen tickets whatever a device sent. Surfaces ask only askedChoices(choices): the till\'s ComboSteps shows the pick as text (combo-fixed); the kiosk makes no part page for a dish with nothing left to ask and fills its picks with fillDealPicks(config, steps, picks) (shared/pos/offers.js) before its pictures and the basket line, so the meal\'s picture shows the deal\'s flavour; online, partChoices() is askedChoices(dealOptions()) and the summary lists withDealPicks(). The admin window says "always X" (deal-asked data-fixed) and, for an optional group left with one option, how to include it (deal-one-optional).'],
                ['Automatic combos', 'findAutoCombos() fills a choice with a separate dish only when dealFits(choice.groups, picks): picks in a group the deal narrows must be its options and within its how many; groups it leaves out or swaps don\'t count (those picks stay paid on the dish). The till passes each line\'s top-level picks from its modifiers (linePicks() in shared/pos/offers.js, not "No" or nested ones), online priceBasket() each line\'s choices.'],
                ['Saving', 'cleanCombo() in upsertMenuTree() keeps, per choice, only groups its dishes have (a section: any of its dishes), only option ids those dishes offer, and a swap group in the tenant\'s library (cleanDealGroups()); prices only for options the deal asks (only: the kept ids; swap: the other group\'s options); another tenant\'s ids are dropped. A group taken off the dish drops out on the next save. moveDealGroup() (own options turned into a group) carries prices to the new option ids.'],
                ['Extra charges', 'DealPrices in ComboEditor.jsx (Extra charges in the deal, folded until one is set; a div toggle so View users can open it), a PriceInput per option of the group as asked (empty = as on the dish, the placeholder its own charge; 0.00 = free); askedText() and dealSummary() (pricesText()) name the charges. comboFromPrice() says varies when any choice has a deal price over 0. A step that picks itself shows its choice\'s charge beside Included (ItemModal ComboSteps, ordering.eta stepHtml autoCharge).'],
                ['Releases, copies, AI', 'releaseContent() keeps the combo whole and contentKey() sorts keys, so a draft and a release compare equal; menuSaveBody() and /duplicate carry it; Pepper\'s get_menu says "(its options changed for this deal)".'],
                ['Admin', 'ComboEditor.jsx: DealOptionsButton (summary from dealSummary()) under each dish / section choice, DealOptionsModal / DealGroupRow (modes, option chips, swap select with Make a copy through POST /menus/variant-groups/:id/copy, how many), comboPayload() normalises.'],
              ]}
            />
            <P>
              Tested: 16 shared unit tests (shared/test/dealOptions.test.mjs, automatic combos on the till and
              online included, and the deal&apos;s own picks: when a group is fixed, filling, asking, the kiosk&apos;s
              picks and picture, till and online prices), 5 API tests
              (api/test/deal-options.test.mjs: cleaning, section unions, detached groups, publish, copy, kiosk
              config and pricing, the online menu and quote, another tenant), the fixtures&apos; meal deal in
              the tenant sweep, 67 browser checks (the window at 1280, 1015 and 390 px and for a viewer, the
              kiosk upright and wide, a real till with Make it a combo, online ordering at 1280 and 390 px) and
              34 more for a group left with one option (the window and its hint, the kiosk upright and wide, a
              real till, online ordering at 1280 and 390 px). Extra charges: 6 more shared tests (stored shape,
              the rule, till and kiosk, online, from, moveDealGroup), an API test (kept only for asked options,
              400 for a bad price, nothing to publish after a plain save, the kiosk config and online quote
              charging it), the fixtures&apos; meal deal with a charge in the sweep, 63 browser checks (the window
              at 1280 and 390 px and for a viewer, the kiosk upright and wide, a real till, online ordering at
              1280 and 390 px).
            </P>
            <H3>Where combos are read</H3>
            <DataTable
              head={['Surface', 'How']}
              rows={[
                ['Menus API', 'routes/menus.js: ComboBody Zod; cleanCombo() inside upsertMenuTree() drops choices for dishes / sections not on the menu, combos and itself, and conditions on later or unknown steps; remapCombo() on /duplicate; menuSaveBody() carries kind + combo.'],
                ['Till', 'posSvc tillConfig(): items carry kind + combo, config.section_items. shared/pos/pricing.js priceItem() prices through priceCombo(); line.combo = parts { step_id, step, option_id, item_id, name, kitchen_name, section_id, course_id, upcharge, modifiers, extras, custom }. pos/src/lib/checkOps.js: comboCtx(), autoCombosFor() (refreshed on every line change by Check.jsx), combosForLine() / comboStartFrom() (Make it a combo).'],
                ['Automatic combos on the till', 'Stored as promotions.set entries { promotion_id: comboItemId, name, kind: "combo", count, lines } (checks.js accepts kind combo and count). checkTotals() names them "X x N" and flags combo: true. promotionsFor() applies combos first, promotions on what is left.'],
                ['Online ordering', 'orderSvc loadOrderingMenu(): items carry kind, combo, from_pence, from_varies; partsById (every dish of the menus in shown sections, orderable or not) as combo_parts and section_items in GET /order-api/venues/:id; basketCombos(menu) gives priceBasket() its combos. priceBasket() applies automatic combos before promotions (promotions run on line_total minus the combo saving) and returns combos[] + combo_discount_pence. order_items.parts; order_promotions rows with promotion_id NULL and combo_item_id for automatic combos. /order-api/combos.js serves shared/combos.js to the guest page.'],
                ['Kitchen', 'shared/pos/kitchen.js: a combo line is the header with parts; each part routes by its own dish (a custom part like the combo), the item route is mergeRoutes(parts); stations see only their own parts. kitchenSvc onlineSnapshot() sends parts for online orders. printing.js: parts print on their own printers under the combo\'s name; a custom part prints where the combo does.'],
                ['Website, print, canvas', 'comboMenuPrice(item, menu) in menu_inline.eta (it.siteBlocks), menu_print.eta, shared/menuLayout.js and MenuInlineCanvas: the description and the price, "from" when it varies; no steps.'],
                ['Menu screens', 'screenSvc slimItem() keeps kind + combo; shared/screenLayout.js menu and dish blocks take opts.combo_view: "menu" | "steps" (comboStepsHtml(), .sl-steps); combos.js is in PLAYER_LIBS and the player\'s sw.js shell.'],
                ['AI menu tools', 'get_menu shows a combo\'s steps (comboText()); removing dishes or a section lists the combos that lose those choices (comboRefs()). The tools don\'t edit steps.'],
              ]}
            />
            <H3>Option groups: repeat and on request</H3>
            <P>
              <Mono>menu_variant_groups.allow_repeat</Mono> (the same option more than once; max is not capped
              at the number of options) and <Mono>on_request</Mono> (an optional group waits behind a button;
              ignored when min &gt; 0). Both reach the till through <Mono>posChoices()</Mono> /{' '}
              <Mono>groupChoice()</Mono> and online through <Mono>itemChoices()</Mono> as{' '}
              <Mono>choice.repeat</Mono> / <Mono>choice.on_request</Mono>; <Mono>menuDiff.js</Mono> drops them
              when false so existing releases don&apos;t read as changed. The till keeps one modifier per pick
              and groups them for display with <Mono>groupModifiers()</Mono> (shared/pos/pricing.js,{' '}
              <Mono>modifierText()</Mono> prints &ldquo;2 x Cheese&rdquo;); online orders store a repeated pick
              once with the count in its label and the summed price (<Mono>priceChoiceSet()</Mono>).
            </P>
            <P>
              Tested: 92 shared unit tests (combos, pricing, auto matching, kitchen, grouping), 30 API checks
              against Postgres (save, clean, copy, publish, migration, ordering menu, quote, order, print), the
              admin editor in Chromium at 1280 and 1015 px, the till (steps, repeats, on-request groups, auto
              combo, Make it a combo, send, kitchen screen), the guest ordering page at 1280 and 390 px, a menu
              screen board in both views and the website Menu block.
            </P>
          </section>

          {/* ── TAX, ORDER TYPES & REVENUE STREAMS ───────────── */}
          <section id="tax" data-doc="">
            <H2>Tax, Order Types &amp; Revenue Streams</H2>
            <P>
              Migration 170. Tax rates are a tenant list with values per location; order types are a tenant
              list; revenue streams (renamed from revenue centres) are per-venue till groupings that decide
              which order types a till offers and what each asks for, never tax. A dish&apos;s tax is a setting
              on its menu, section and dish with exceptions per order type, location and revenue stream. One
              resolver, <Mono>shared/tax.js</Mono>, is used by the till, online ordering, the Deliveroo file,
              the admin Tax box and the Tax rates check.
            </P>
            <DataTable
              head={['Table', 'What it holds']}
              rows={[
                ['tax_rates', 'Tenant list: name, rate numeric(5,2), is_default (one per tenant, partial unique index), is_active (removing archives; the default or a rate a draft menu uses can\'t be removed), sort_order. Seeded Standard 20 (default) and Zero 0 by the migration and ensureTaxDefaults() (new tenants: POST /api/platform/tenants).'],
                ['tax_rate_values', 'A location\'s own % for a rate: (tax_rate_id, venue_id, rate). ratePercent(rate, venueId) = values[venueId] ?? rate.rate.'],
                ['order_types', 'Tenant list: name, colour, sort_order, is_active (archived, never deleted: checks, orders and kitchen orders point at them). Seeded Eat in, Take out, Delivery, Collection.'],
                ['pos_revenue_streams', 'Renamed from pos_revenue_centres; vat_mode dropped, default_order_type_id added (from vat_mode: eat_in -> Eat in, takeaway -> Take out).'],
                ['pos_stream_order_types', '(stream_id, order_type_id, enabled, ask_name, ask_tent), ask_* off | ask | required. No row = the stream doesn\'t offer the type. Migrated streams offer Eat in and Take out, asking for a name.'],
                ['menus.tax, menu_sections.tax, menu_items.tax', 'jsonb { rate: tax_rate_id | null, rules: [{ venues: [], streams: [], types: [], rate }] }, {} = not set. The migration turned each eat-in % into the rate and each takeaway % into an exception for Take out, Delivery and Collection (making "VAT x%" rates for %s not in the list), rewrote published release snapshots the same way and set their content_hash to \'\' so rehashReleases() (backfillFirstReleases at API start) re-hashes them.'],
                ['pos_checks / pos_check_lines', 'Checks: revenue_stream_id (renamed), order_type_id, tent (customer name stays tab_name). Lines: revenue_stream_id (renamed), tax_rate_id next to vat_rate.'],
                ['orders, ordering_settings, deliveroo_settings', 'orders.order_type_id + revenue_stream_id; ordering_settings.order_type_ids { collection, delivery, eat_in } + revenue_stream_id (VAT defaults dropped); deliveroo_settings.order_type_id + revenue_stream_id.'],
                ['kds_orders.state, kds_flow_edges.targets, pos_print_routes', 'Kitchen orders: type = order type id, type_name, tent. Flow targets kind revenue_stream / order_type (an id). Print route target_kind revenue_stream.'],
              ]}
            />
            <H3>Resolving a rate (shared/tax.js)</H3>
            <P>
              <Mono>taxFor(levels, ctx, rates)</Mono> takes the levels <Mono>[dish, section, menu]</Mono> and the
              sale context <Mono>{'{ venue_id, order_type_id, revenue_stream_id }'}</Mono> and returns{' '}
              <Mono>{'{ tax_rate_id, vat_rate, name, from, rule }'}</Mono>. Level first: the first level whose
              setting gives a rate for the context wins (a matching exception, else its own rate); a blank level
              passes up; nothing anywhere = the default rate (<Mono>FALLBACK_PERCENT</Mono> 20 if a tenant has
              none). Within a setting the matching exception with the highest weight wins
              (<Mono>RULE_WEIGHTS</Mono>: streams 4, types 2, venues 1; a rule names venues or streams, not
              both). <Mono>taxProblems(tax, lookups)</Mono> refuses unknown ids, a rule with no rate, a stream
              of another location next to a venue, and two rules of the same weight that can match the same sale
              at different rates, so the winner is never ambiguous. <Mono>cleanTax()</Mono> normalises before
              saving (sorted, de-duplicated, empty = <Mono>{'{}'}</Mono>).
            </P>
            <H3>Where it is used</H3>
            <DataTable
              head={['Surface', 'How']}
              rows={[
                ['Till', 'tillConfig() sends revenue_streams (with order_types and prompts), order_types, tax_rates (values trimmed to the venue) and each item\'s tax levels (rules for other venues dropped by taxForVenue()). posTax(item, check, config) sets vat_rate + tax_rate_id on every line. check.order_type_set and check.stream_set carry a lines map { lineId: { vat_rate, tax_rate_id } } (rerateLines() in pos/src/lib/checkOps.js) that applyEvent() writes to the lines; check.tent_set sets the tent. Required prompts are enforced on the till at counter start, Send and Pay (missingDetails()).'],
                ['Online ordering', 'loadOrderingMenu() resolves each dish with orderContext(venueId, settings, fulfilment); createOrder() stores order_type_id and revenue_stream_id.'],
                ['Deliveroo file', 'loadDishes() resolves each dish for the settings\' order type (default: the type named Delivery) and stream; dishValues() writes dish.vat.'],
                ['Kitchen', 'headerFromCheck() / onlineSnapshot() put type, type_name and tent on the kitchen order; flow links can name order types and revenue streams (linkRank()); the kitchen screen\'s filter tabs are the tenant\'s types (kdsConfig().order_types).'],
                ['Reports', 'dayFigures() adds revenue_streams and order_types [{ id, checks, net, total }]; GET /api/pos/venues/:id/days/:dayId names them (names.revenue_streams / order_types / tax_rates); the checks list joins order_type_name and tent; GET /api/pos/checks/:id returns names for its events. Z tickets print both.'],
                ['Admin', 'components/menus/TaxBox.jsx (menu Settings, SectionDrawer, ItemDrawer; useTaxLookups() = GET /api/tax-rates), pages/MenuTax.jsx (/menus/tax: rates + Check), components/pos/OrderTypesSection.jsx and RevenueStreamsSection.jsx (Store tech tabs types and streams), OrderingSettings.jsx and MenuDeliveroo.jsx selects, KitchenFlow.jsx chips.'],
                ['AI menu tools', 'New sections and dishes carry tax; update_section takes tax_rate (a rate name) and sets the section\'s rate.'],
              ]}
            />
            <H3>API</H3>
            <DataTable
              head={['Route', 'Notes']}
              rows={[
                ['GET /api/tax-rates', '{ rates (with values), venues, order_types, streams }: what a tax setting may name. Open to readers (menus pages, Tax box).'],
                ['POST / PATCH / DELETE /api/tax-rates[/:id], PUT /api/tax-rates/order, PUT /api/tax-rates/:id/values', 'Menus manage. PATCH takes name, rate, is_default (moves the default), is_active. DELETE archives; refused for the default and for a rate a draft menu uses (names the menus). values: { venueId: % | null }.'],
                ['GET /api/tax-rates/check?venue_id&stream_id&menu_id', 'Every draft dish\'s rate per active order type in that context (the Check card).'],
                ['GET / POST / PATCH / DELETE /api/order-types[/:id], PUT /api/order-types/order', 'Changes need pos_setup or web_ordering_setup manage. DELETE archives, keeps at least one active, clears stream defaults pointing at it. POST / PATCH take charges (the whole list, migration 225; left out of a PATCH = unchanged): each { id?, name, kind, value, optional, min_covers, tax_rate_id }, checked by chargeProblem(), 422 for the same id twice or another tenant\'s tax rate.'],
                ['POST /api/pos/venues/:id/revenue-streams, PATCH / DELETE /api/pos/revenue-streams/:id, PUT /api/pos/venues/:id/revenue-streams/order', 'Body: name, menu_ids, colour, is_active, default_order_type_id, order_types [{ order_type_id, enabled, ask_name, ask_tent }]. A new stream offers every active type. The default must be an enabled type (422). DELETE archives a stream with sales. Charges are on the order types (migration 225).'],
                ['GET / POST /api/pos/discounts, PATCH / DELETE /api/pos/discounts/:id, PUT /api/pos/discounts/order', 'Migration 225: the company\'s till discounts. Body: name, kind percent | amount, value (percent to 100, two decimals; amount in whole pence to 100000), scope any | check | line, needs_manager. Store tech view to read, manage to change; at most 50. Changes tell the tills (config).'],
              ]}
            />
            <InfoBox type="info">
              Every tax-rate, order-type and stream query filters <Mono>tenant_id</Mono>; ids in a tax setting are
              checked to be the tenant&apos;s (<Mono>checkMenuTax()</Mono> on every menu save). Setup changes push{' '}
              <Mono>pos.config</Mono> to the tills (<Mono>notifyTillsOnWrite</Mono> on the tax routes).
            </InfoBox>
          </section>

          {/* ── WEBSITE CMS ───────────────────────────────── */}
          <section id="screens" data-doc="">
            <H2>Menu Screens</H2>
            <P>
              Digital menu boards (migration 166, module <Mono>screens</Mono>, page{' '}
              <Mono>/screens</Mono>). A <strong>board</strong> (<Mono>screen_designs</Mono>) is a canvas
              of a fixed size in pixels with positioned blocks; a <strong>playlist</strong> rotates boards
              with optional times of day; a <strong>screen</strong> is a paired device showing a board or
              a playlist. The player is a plain-files PWA on <Mono>screens.&lt;root&gt;</Mono>; boards are
              drawn by one renderer, <Mono>shared/screenLayout.js</Mono>, in the player and in the admin
              designer. Prices are the <strong>live</strong> menus (<Mono>menu_releases</Mono>), so a
              publish changes every screen; sold out comes from <Mono>ordering_item_availability</Mono>.
              Boards and playlists are tenant-wide (every location uses them; each screen shows its own
              venue&apos;s sold out dishes and order ready board); screens and walls have a{' '}
              <Mono>venue_id</Mono>. The page&apos;s Location picker (Screens and Walls tabs,{' '}
              <Mono>useScreensPlace()</Mono>, localStorage <Mono>maca_screens_venue</Mono>, empty = every
              location) only filters what is shown and sets the location a new screen or wall starts at;
              reordering one location&apos;s screens sends the whole order with the others in place
              (<Mono>mergeOrder()</Mono>). No API change.
            </P>
            <DataTable
              head={['Table', 'Purpose']}
              rows={[
                ['screen_designs', 'tenant_id, name, width / height (240-8192 px), layout jsonb (board settings + blocks), created_by / updated_by. RLS.'],
                ['screen_playlists / screen_playlist_items', 'A playlist and its boards in order: design_id (cascade), duration_secs (3-3600), schedule jsonb (the menuSchedule.js shape { from, until, times: [{ days, start, end }] }, null = always), sort_order. RLS.'],
                ['screens', 'venue_id, name, short_code (S1, S2 ... unique per tenant), width / height, rotation (0 / 90 / 180 / 270), fit (contain / cover / stretch), playlist_id or design_id (CHECK not both; SET NULL on delete), secret_hash, paired_at, last_seen_at, app_version, device_info and status jsonb (from heartbeats). RLS.'],
                ['screen_pairings', 'Global, no RLS: code_hash (sha256 of the normalised code), secret_hash, device_info, expires_at (15 min), then claimed_at / screen_id / tenant_id. Never holds the code or the secret. Rows expired over a day are deleted when a new code is asked for.'],
                ['pos_roles.permissions.sold_out', 'Till permission "Mark dishes sold out" (shared/pos/permissions.js); the migration sets it on existing Supervisor and Manager roles.'],
                ['screen_walls (migration 167)', 'venue_id, name, cols / rows (1-6), gap (0-400 board px hidden behind the frames), design_id or playlist_id (CHECK not both; SET NULL on delete). RLS.'],
                ['screens.wall_id / wall_col / wall_row (167)', 'A screen\'s place on a wall (FK ON DELETE SET NULL, col / row 0-5, unique partial index on (wall_id, wall_col, wall_row)). A screen on a wall shows the wall\'s board or playlist, not its own.'],
                ['screen_playlist_items.transition / transition_ms (167)', 'How the board comes on: none | fade | slide_left | slide_right | slide_up | slide_down | zoom | wipe (default fade), 0-5000 ms (default 800).'],
              ]}
            />
            <H3>Pairing and device auth</H3>
            <P>
              The screen asks for a code (<Mono>POST /screen-api/pairings</Mono>, no auth, 10 a minute):
              the API makes a six-character code (no 0/O/1/I/L) and a 32-byte secret, stores their
              hashes and returns both. The screen shows the code and polls{' '}
              <Mono>GET /screen-api/pairings/:id</Mono> with <Mono>Authorization: Pairing &lt;secret&gt;</Mono>.
              Someone types the code into Screens (<Mono>POST /api/screens/screens/claim</Mono>, manage):
              the pairing&apos;s secret hash becomes the screen&apos;s <Mono>secret_hash</Mono> (a new
              screen, or <Mono>screen_id</Mono> for a new device on an existing one, which locks the old
              device out). The poll then answers <Mono>paired</Mono> with the screen id, and the device
              signs in with <Mono>Authorization: Screen &lt;id&gt;.&lt;secret&gt;</Mono> from then on: the
              secret never travels again and the API never stores it. <Mono>services/screenAuth.js</Mono>{' '}
              (<Mono>verifyScreen()</Mono>, 15 s cache, <Mono>forgetScreen()</Mono>) checks it for the
              screen API and the WebSocket; a switched-off module answers 403 <Mono>screens_off</Mono>.
            </P>
            <P>
              The player&apos;s own settings: five taps within 3 s (document click), or five presses of Enter /
              Space / Select (a remote&apos;s OK), open <Mono>#settings</Mono> in <Mono>screen/index.html</Mono>{' '}
              (<Mono>openSettings()</Mono> in <Mono>player.js</Mono>; the opening key press is
              preventDefault-ed, or it would press the panel&apos;s first button too). Arrows move between the
              buttons, Escape / Back closes, 60 s idle closes. <strong>Disconnect this screen</strong> (asked
              twice) calls <Mono>POST /screen-api/disconnect</Mono> (screen auth: <Mono>secret_hash = NULL</Mono>,{' '}
              <Mono>forgetScreen()</Mono>), then <Mono>unpair()</Mono> shows a new code; offline it forgets itself
              anyway. The screen row keeps its name, boards and wall place; New device for this screen pairs it
              again.
            </P>
            <H3>Screen API (/screen-api) and live updates</H3>
            <DataTable
              head={['Route', 'What it does']}
              rows={[
                ['GET /config?version=', 'screenConfig() in services/screenSvc.js: player_version, screen (size, rotation, fit), venue (timezone), wall { id, name, cols, rows, col, row, gap } when the screen is on one (its board / playlist then comes from the wall), playlist (items with schedules and transitions) or design_id, designs { id: { width, height, layout } }, the LIVE versions of the menus the boards point at (boardMenuIds(), slimmed by slimMenu(), sections hidden everywhere left out), tags shown on menus, the allergen notice, sold_out item ids, version (sha256 of all of it). { unchanged: true } when the version matches.'],
                ['POST /disconnect', 'The screen forgets its pairing (its settings panel): secret_hash = NULL; the row keeps its name, boards and wall place.'],
                ['POST /heartbeat', 'Every minute: app_version, showing { design_id, name, playlist_item_id }, viewport, error, config_version, offline_secs, clock { offset_ms, rtt_ms }. Written at most once per 50 s per screen; the admin shows a screen online when last_seen_at is under 150 s old.'],
                ['GET /time', '{ now } (server ms), no-store, no auth, 120 a minute. The player takes five samples and keeps the quickest round trip (offset = now + rtt / 2 - received), again every 10 minutes; a jump over 250 ms reschedules the boards.'],
                ['/ws?screen=<id>&secret=<secret>', 'Joins screen:<id> (screens.changed, screen.identify, screen.reload, screen.removed), screens:<venueId> (screens.sold_out with the item ids), screens-t:<tenantId> (screens.changed after a board or playlist save) and menus:<tenantId> (menus.live from publishing and the minute sweep). Everything except identify / reload / sold out makes the player fetch the config again; so does the socket reopening after a drop (changes meanwhile were pushed to nobody) and the browser coming back online; it also polls every 60 s. A wall change tells each screen it touched.'],
              ]}
            />
            <H3>Admin API (/api/screens)</H3>
            <P>
              Reads need <Mono>screens</Mono> view, changes manage; identify is allowed with view. Every
              query filters <Mono>tenant_id</Mono>; a screen can only point at the tenant&apos;s own
              venue, board and playlist, and a playlist only holds the tenant&apos;s boards.
            </P>
            <DataTable
              head={['Route', 'Notes']}
              rows={[
                ['GET /screens', '{ screens, player_url } (screensOrigin()); each screen with online, shows { kind, name }, status.'],
                ['POST /screens/claim', '{ code, name, venue_id, design_id | playlist_id, width?, height?, rotation? } or { code, screen_id }. Size defaults to the device report (CSS px x devicePixelRatio). 20 a minute.'],
                ['PATCH /screens/:id, PATCH /screens/reorder, DELETE /screens/:id, POST /screens/:id/identify | reload', 'Showing a board clears the playlist and the other way round; both at once is a 422.'],
                ['GET / POST /designs, GET / PUT / DELETE /designs/:id', 'POST takes copy_from, or layout (normalised: the Walls tab sends the guide lines). PUT stores normalizeBoard(layout) (unknown block types dropped, positions clamped), at most 500 KB. The list adds wall_count and video_secs (longest video block, from opts.duration). Delete removes the board from playlists, screens and walls.'],
                ['GET / POST /playlists, PUT / DELETE /playlists/:id', 'PUT replaces the items (transition from TRANSITION_KEYS, transition_ms 0-5000); a time must end after it starts and have days (no overnight times). The list adds wall_count.'],
                ['GET / POST /walls, PUT / DELETE /walls/:id', 'PUT { name, venue_id, cols, rows, gap, design_id | playlist_id, places: [{ col, row, screen_id }] }: refuses a screen twice, two screens in one place, a screen at another venue or another tenant\'s; places outside the grid are dropped; screens taken off are cleared. Moving a screen to another venue (PATCH /screens/:id) takes it off its wall. Delete clears its screens\' places.'],
                ['GET /menu-data?version=live|draft&venue_id=', 'designerData(): every menu (live, or the drafts), unpublished (menus with no live version), tags, notice, and the venue\'s sold out ids.'],
              ]}
            />
            <H3>Renderer (shared/screenLayout.js)</H3>
            <P>
              Blocks: heading, text, menu (a section or picked dishes), dish (featured), price (one dish
              or one option), image, box, clock, allergen_key. Positions are board pixels; later blocks
              sit on top. <Mono>boardContext(layout, data)</Mono> indexes the menus (sections hidden
              everywhere skipped, tags through <Mono>menuTags()</Mono>), the sold out set and the dishes
              shown on the board (for the allergen key); <Mono>renderBlockInner()</Mono> returns HTML,
              <Mono> null</Mono> when the block points at a menu, section or dish that isn&apos;t live
              (the designer explains, the player leaves the space empty), or <Mono>&apos;&apos;</Mono>{' '}
              for nothing to show. Prices go through <Mono>shared/orderPricing.js</Mono>{' '}
              (<Mono>itemChoices()</Mono> with the menu&apos;s variant rules, <Mono>fromPrice()</Mono>),
              so &quot;from&quot; prices match online ordering. <Mono>boardOnAt()</Mono> is{' '}
              <Mono>menuOnAt()</Mono> with the end NOT included (11:00-15:00 hands over at 15:00) and
              23:59 meaning midnight. Fonts: the website list plus Oswald, Bebas Neue, Anton, Barlow
              Condensed, Archivo Black, Pacifico and Permanent Marker (<Mono>SCREEN_FONT_WEIGHTS</Mono>,
              kept apart so the website pickers don&apos;t change). Tests:{' '}
              <Mono>node --test shared/test/screenLayout.test.mjs</Mono>.
            </P>
            <P>
              Migration 167 adds: <strong>video</strong> (a muted, playsinline video, <Mono>data-sl-video</Mono>{' '}
              with loop / sound; with <Mono>still: true</Mono> in the context it is a frame at 0.5 s and
              plays nothing: admin thumbnails and the designer until Play) and <strong>ticker</strong>{' '}
              (scrolling text: copies of the text in a track moved by the <Mono>sl-loop-ticker</Mono>{' '}
              keyframes). Any block can have <Mono>opts.anim_in</Mono> (ANIM_IN: fade, rise, drop, left,
              right, zoom, pop, wipe; <Mono>anim_in_ms</Mono>, <Mono>anim_in_delay</Mono>) and{' '}
              <Mono>opts.anim_loop</Mono> (ANIM_LOOP: pulse, float, swing, zoom, blink;{' '}
              <Mono>anim_loop_ms</Mono>); <Mono>wrapMotion()</Mono> wraps the block&apos;s HTML in{' '}
              <Mono>.sl-in</Mono> / <Mono>.sl-loop</Mono>, whose CSS animations run only under{' '}
              <Mono>.sl-board.sl-play</Mono>. <Mono>startBoardMotion(board, {'{ startMs, nowMs }'})</Mono>{' '}
              sizes the tickers, adds <Mono>sl-play</Mono> and sets each animation&apos;s clock: entrances
              from <Mono>startMs</Mono> (<Mono>replayStart()</Mono> with the board&apos;s{' '}
              <Mono>replay_secs</Mono>), movements from 1 January 1970, so every screen of a wall is at the
              same point. <Mono>playlistPosition(list, nowMs)</Mono> works out which board is on from the
              clock alone (rotation from the epoch, at least 3 s per board); <Mono>wallRegion()</Mono>{' '}
              is the part of a board one wall screen shows, <Mono>wallBoardSize()</Mono> the board size
              for a wall, <Mono>transitionFrames(kind, W, H)</Mono> the Web Animations keyframes in board
              pixels (a slide crosses the whole wall). The board&apos;s <Mono>guide_cols</Mono> /{' '}
              <Mono>guide_rows</Mono> / <Mono>guide_gap</Mono> only draw the designer&apos;s dashed lines.
            </P>
            <H3>Player (screen/, routes/screenSite.js)</H3>
            <P>
              Plain files, no build: <Mono>index.html</Mono>, <Mono>player.js</Mono> (ES module),{' '}
              <Mono>sw.js</Mono>, <Mono>manifest.webmanifest</Mono> (display fullscreen), icons.{' '}
              <Mono>routes/screenSite.js</Mono> serves them on host kind <Mono>screens</Mono> (a global
              onRequest hook like posSite), the shared files the player imports as{' '}
              <Mono>/lib/&lt;name&gt;</Mono> (allow-list <Mono>PLAYER_LIBS</Mono>), redirects http to
              https, and writes <Mono>playerVersion()</Mono> (a hash of the player and library files)
              into the page and the service worker. The player keeps its device id and secret and the
              last config in localStorage, so it starts offline; the service worker serves the player
              network-first (cached copy offline) and images and Google Fonts cache-first. It rotates
              the playlist&apos;s boards that are on now (venue time, clock corrected by the server
              time), preloads a board&apos;s images before showing it, scales the board to the screen
              (rotation and fit from the screen), updates clocks every 5 s, asks for a wake lock, hides
              the cursor, and reloads itself when a config names a newer player version (at most once
              in 5 minutes). Works installed from Chrome or in Fully Kiosk (detected by{' '}
              <Mono>window.fully</Mono>, reported in the device info).
            </P>
            <P>
              Since migration 167 screens keep in step without talking to each other: the clock comes
              from <Mono>/screen-api/time</Mono>, the board on now from <Mono>playlistPosition()</Mono>,
              and the next board is drawn hidden (<Mono>.layer.prep</Mono>) 3 s early so its images and
              videos load and its transition starts on time; a late timer jumps into the transition at
              the elapsed point. A screen on a wall crops its part in <Mono>fit()</Mono> (translate,
              then scale and turn). <Mono>syncVideos()</Mono> runs every second: elapsed time from the
              board&apos;s start in a playlist, else from the epoch; small drift is caught up with
              playbackRate 0.9-1.1, big drift (0.5 s on a wall, 1.5 s otherwise) by seeking. A sold out
              push redraws in place (<Mono>redraw()</Mono>, skipped when the HTML is unchanged); a new
              config also re-fits what is on screen (rotation, fit, wall place). The service worker keeps
              every video the boards play in <Mono>screen-video-v1</Mono> (the player posts{' '}
              <Mono>{'{ type: \'videos\', urls }'}</Mono>; one download at a time, videos no board plays
              are deleted) and answers the video element&apos;s byte ranges by slicing the cached file
              (206, or 416), from the network until the copy is there.
            </P>
            <H3>Sold out</H3>
            <P>
              <Mono>services/soldOut.js</Mono> is the one writer: <Mono>setSoldOut()</Mono> (today =
              next venue-local midnight, indefinite = null, false = delete) and{' '}
              <Mono>announceSoldOut()</Mono> (ordering.availability to the venue room, pos.config to the
              tills, screens.sold_out with the ids to the screens). Used by the orders board route and
              the new till route <Mono>PUT /pos-api/sold-out/:itemId</Mono>{' '}
              (<Mono>{'{ sold_out, staff_id, approved_by? }'}</Mono>, checked with{' '}
              <Mono>permissionProblem(..., &apos;sold_out&apos;)</Mono>). <Mono>tillConfig()</Mono>{' '}
              includes <Mono>sold_out: [{'{ item_id, until }'}]</Mono>; the till greys the dish, holding
              a dish (550 ms) or tapping a sold out one opens <Mono>SoldOutModal</Mono>{' '}
              (CheckActions.jsx). <Mono>setSoldOut()</Mono> only marks the tenant&apos;s own dishes: one
              in a menu&apos;s draft, or on a release that isn&apos;t cancelled (a dish taken out of the
              draft is still on the live menu until publish), else 404 "Dish not found". Putting a
              dish back on (false) is allowed for any id, so a stray row can always be cleared.
            </P>
            <InfoBox type="warn">
              A new place that marks dishes sold out must go through <Mono>setSoldOut()</Mono> and{' '}
              <Mono>announceSoldOut()</Mono>, or tills and screens keep showing the dish until their
              next config refresh (up to 10 minutes on a till, a minute on a screen).
            </InfoBox>

            <H3>Designer grid and colours</H3>
            <P>
              <Mono>GridLines</Mono> in <Mono>ScreenDesigner.jsx</Mono> draws the snap grid as an SVG
              beside the board, in screen pixels (one line every <Mono>grid</Mono> board px, times the
              smallest whole number that keeps lines 10 px apart at the current zoom; every fifth line
              darker; <Mono>z-index</Mono> 3, under the wall guides and the selection, no pointer
              events). It used to be a 1px CSS gradient inside the scaled board, which shrank to a
              fraction of a pixel at the usual 20-50% zoom and never showed. On / off is
              per device (<Mono>localStorage maca_screen_grid</Mono>).
            </P>
            <P>
              Board and block colours are <Mono>ColourField</Mono> (<Mono>components/screens/shared.jsx</Mono>),
              now a wrapper of the shared <Mono>ColourPicker</Mono> (<Mono>components/ColourPicker.jsx</Mono>):
              the website theme&apos;s colours from <Mono>GET /api/me</Mono>&apos;s{' '}
              <Mono>site_theme</Mono> (<Mono>useThemeColours()</Mono>, one swatch per distinct colour),
              then a custom colour (native colour input + typed <Mono>#rrggbb</Mono>). Boards store
              colour codes, so a theme pick is copied as its code: changing the website theme later
              doesn&apos;t change a board.
            </P>
            <P>
              See-through: <Mono>ColourPicker</Mono> / <Mono>ColourField</Mono> take <Mono>clear</Mono>, which
              adds <Mono>ClearSwatch</Mono> (a <Mono>CHECKER</Mono> background, <Mono>data-testid=&quot;colour-clear&quot;</Mono>)
              storing the word <Mono>transparent</Mono> (the code box takes it typed too). Used only on
              background fields: the board background (the designer frame shows <Mono>CHECKER</Mono> behind it),
              box colour, scrolling text background, order board <Mono>ready_bg</Mono> / <Mono>preparing_bg</Mono>
              (<Mono>colour()</Mono> in <Mono>shared/screenLayout.js</Mono> already passes <Mono>transparent</Mono>,
              and <Mono>withAlpha()</Mono> keeps it); kiosk design colours in <Mono>CLEAR_COLORS</Mono>
              (<Mono>surface</Mono>, <Mono>primary</Mono>, <Mono>accent</Mono>; <Mono>normaliseDesign()</Mono> drops
              <Mono>transparent</Mono> on any other colour, including the bottom bar and side menu colours, which
              follow when not set). The kiosk sets <Mono>--k-sheet</Mono> (the page colour
              when cards are see-through) for <Mono>.k-sheet</Mono>, and the designer&apos;s readability check
              reads a see-through colour as the page (<Mono>solidColours()</Mono>).
            </P>
          </section>

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
                ['website_menu_documents', 'PDF menu uploads with labels, per location (website_config_id). website_config.show_menu (default true) gates them: off, the venue bundle loads none, so the menu_pdfs block renders nothing, /locations/:slug/menu is 404 and JSON-LD hasMenu is left out. The page builder hides the block from its picker (BlockAvailabilityContext in canvas/BlockInserter.jsx, computed in PageBuilder.jsx from the page\'s venue or the only venue) and its canvas shows a Hidden placeholder. Every PAGE_TEMPLATES starter except From scratch includes the block.'],
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
  "colors":     { primary, accent, background, background_image, surface, text, muted, border },
  "typography": { heading_font, body_font, base_size_px, heading_scale,
                  heading_weight, body_weight, line_height, letter_spacing },
  "spacing":    { container_max_px, section_y_px, section_y_mobile_px, gap_px,
                  boxed_step, boxed_step_mobile, boxed_steps },
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

            <H3>Boxed-inset step values (theme.spacing.boxed_steps)</H3>
            <P>
              <Mono>boxed_step</Mono> (theme-wide default) and <Mono>boxed_step_mobile</Mono>{' '}
              (mobile-portrait-only override — swap to a <em>different step index</em> on
              mobile) — plus every block's own per-block <Mono>boxed_step</Mono> override — are
              step <em>numbers</em> (1-5) that index into <Mono>boxed_steps</Mono>: an array of
              exactly 5{' '}
              <Mono>{'{ value, unit: \'px\' | \'%\', mobile_value?, mobile_unit? }'}</Mono>{' '}
              entries, Zod-validated with <Mono>.length(5)</Mono>. Falls back to the standard
              16/24/40/64/96px scale (<Mono>DEFAULT_BOXED_STEPS</Mono> in{' '}
              <Mono>boxedLayout.js</Mono> / <Mono>head.eta</Mono>) when a tenant hasn't
              customised it. Units can be mixed freely per step — e.g. step 1 = 20px, step 3 = 5%.
            </P>
            <P>
              <Mono>mobile_value</Mono>/<Mono>mobile_unit</Mono> are optional per-step overrides —
              a step can resolve to a different length on phone portrait (≤600px) without
              touching any other step, e.g. step 1 = 16px desktop, 8px mobile. This is distinct
              from <Mono>boxed_step_mobile</Mono> (which points the theme DEFAULT at a different
              step index on mobile) — both can be used together. Both fields have to be listed
              in <Mono>ThemeSchema</Mono>'s <Mono>boxed_steps</Mono> entry in{' '}
              <Mono>routes/website.js</Mono>: Zod strips unknown keys, and until they were added
              every save silently dropped them (the Layout card saved, then reverted). The step
              value fields in <Mono>BrandLayoutFields.jsx</Mono> use <Mono>StepNumberInput</Mono>,
              which keeps the typed text while focused (same idea as the menu{' '}
              <Mono>PriceInput</Mono>). The step pickers under it (default step, mobile override,
              and the block inspector's Boxed inset) show each step's phone value next to or
              instead of its desktop value; the mobile override row shows only the phone value,
              since that is the only place it applies.
            </P>
            <P>
              Every consumer resolves through 5 shared CSS variables (
              <Mono>--boxed-step-1</Mono> … <Mono>--boxed-step-5</Mono>) emitted once in{' '}
              <Mono>head.eta</Mono>'s <Mono>:root</Mono>, with a single{' '}
              <Mono>@media (max-width: 600px) and (orientation: portrait)</Mono> block overriding
              whichever steps have a <Mono>mobile_value</Mono> set. The theme default (
              <Mono>--boxed-pad</Mono>) is just <Mono>var(--boxed-step-N)</Mono>, and all 19{' '}
              <Mono>api/src/views/site/blocks/*.eta</Mono> partials resolve their own per-block{' '}
              <Mono>boxed_step</Mono> override the same way (
              <Mono>{"pad = 'var(--boxed-step-' + step + ')'"}</Mono>) instead of computing a
              literal px/% value — so a per-step mobile value applies everywhere that step is
              used, block overrides included, with no per-block media query needed. On the admin
              canvas, <Mono>boxedLayout.js</Mono> exports the matching{' '}
              <Mono>boxedStepVarCss</Mono>/<Mono>boxedStepVarsCss</Mono>/
              <Mono>boxedStepMobileVarsCss</Mono> helpers, called from{' '}
              <Mono>themeResolver.js</Mono> and emitted by <Mono>ThemeFrame.jsx</Mono>.
            </P>
            <InfoBox type="info">
              The canvas's "Approximate mobile preview" toggle (<Mono>PageBuilder.jsx</Mono>)
              narrows a container div, not the real browser viewport, so it does not retrigger{' '}
              <Mono>@media</Mono> rules — a per-step mobile value only visibly differs in the
              canvas if the admin's actual browser window is narrowed below 600px. This is a
              pre-existing limitation of the preview mode, unrelated to boxed-step resolution.
            </InfoBox>
            <P>
              The canvas's template and theme come from <Mono>brandConfig</Mono> in{' '}
              <Mono>PageBuilder.jsx</Mono>, not from the record being edited: the tenant home
              uses <Mono>tenant_site</Mono>; every other page (location page, extra page or
              modal) uses <Mono>tenant_site</Mono> too, with the venue's{' '}
              <Mono>BRAND_OVERRIDE_FIELDS</Mono> laid over it when that venue's{' '}
              <Mono>website_config.use_brand_override</Mono> is on (a venue-level page fetches
              the venue's config as <Mono>['website-config', venueId]</Mono>). This mirrors{' '}
              <Mono>mergeLocationConfig()</Mono> in <Mono>siteDataSvc.js</Mono>; keep the field
              list in both files the same.
            </P>
            <InfoBox type="warn">
              <Mono>boxedLayout.js</Mono>'s current step values live in a module-level variable
              (<Mono>currentBoxedSteps</Mono>), not React Context — deliberate, since there is
              only ever one <Mono>&lt;ThemeFrame&gt;</Mono> mounted at a time (the page-builder
              canvas). If a second concurrent canvas is ever added, this needs to become a
              Context instead or two tenants' step values will collide.
            </InfoBox>
            <InfoBox type="warn">
              Every canvas component under <Mono>admin/src/components/website-builder/canvas/</Mono>{' '}
              is a second, independent implementation of what its matching SSR{' '}
              <Mono>.eta</Mono> partial renders — there's no shared renderer between them. Any
              conditional-display data flag added to a block (a menu-level toggle, a per-block
              option, a venue setting) must be ported into the canvas version too, or the
              editor's preview silently drifts from the published page. Caught once already:{' '}
              <Mono>MenuInlineCanvas</Mono> (<Mono>dataBlocks.jsx</Mono>) ignored a menu's{' '}
              <Mono>hide_zero_priced_variants</Mono> / <Mono>hide_unpriced_variants</Mono> toggles
              for a while after <Mono>menu_inline.eta</Mono> already had them.
            </InfoBox>

            <H3>The Brand &amp; theme page (/brand)</H3>
            <P>
              Since 20 Oct 2026 the group's brand has its own page, <Mono>pages/Brand.jsx</Mono> (route{' '}
              <Mono>/brand</Mono>, catalogue entry with module <Mono>website</Mono>), because kiosks, menu screens,
              printed menus and the admin's card headers use it too. It renders{' '}
              <Mono>BrandIdentitySection part="brand"</Mono> (brand_name, tagline, logo_url, favicon_url) and{' '}
              <Mono>BrandThemeSection</Mono> (Theme ideas, Colours, Fonts) from <Mono>Website.jsx</Mono>, inside a{' '}
              <Mono>ReadOnlyFieldset</Mono> for people without Website manage. Storage is unchanged:{' '}
              <Mono>tenant_site</Mono> through <Mono>/website/brand-defaults</Mono>, so the public site shows a change
              after Publish, while <Mono>/api/me</Mono>'s <Mono>site_theme</Mono> (swatches, card headers) and the
              designers' Use the brand read the saved draft straight away. Each identity part saves only its own fields
              (<Mono>IDENTITY_PARTS</Mono>: brand, site, all). <Mono>BrandThemeSection</Mono> also writes the legacy{' '}
              <Mono>primary_colour</Mono> / <Mono>font_family</Mono> columns from the theme.
            </P>
            <P>
              <Mono>components/brand/ApplyBrand.jsx</Mono> (<Mono>ApplyBrandCard</Mono>, "Use the brand on other designs")
              lists kiosk designs (Store tech manage), menu screen boards (Menu screens manage) and printed menu designs
              (Menus manage, from <Mono>GET /api/menus/print-designs</Mono>); the ticked ones take{' '}
              <Mono>kitFromBrand(tenant_site)</Mono> (<Mono>shared/themeKit.js</Mono>, source <Mono>brand</Mono>)
              through the mappers <Mono>kioskBrandFromKit()</Mono> / <Mono>boardFromKit()</Mono> /{' '}
              <Mono>printFromKit()</Mono>, saved with each design's own PUT (a board is read first: its list row has no
              layout). In the designers, <Mono>ThemeMakerButton</Mono> shows Use the brand (<Mono>useBrandKit()</Mono>)
              and the theme maker lists Your brand first for every target but the website.
            </P>
            <H3>Brand & theme — tenant default + per-venue site overrides</H3>
            <P>
              <Mono>website_config.use_brand_override</Mono> (migration 098, boolean, default{' '}
              <Mono>false</Mono>) is the single switch deciding whether a venue's own brand/theme
              fields apply. When <Mono>false</Mono> (the default, and the only state for
              single-venue tenants), every field in{' '}
              <Mono>BRAND_OVERRIDE_FIELDS</Mono> (<Mono>siteDataSvc.js</Mono>) — site_name,
              tagline, logo_url, favicon_url, primary_colour, secondary_colour, font_family,
              template_key, theme — is read from <Mono>tenant_site</Mono> only; the venue's own
              stored values (if any, from a previously-removed override) are ignored entirely.
              When <Mono>true</Mono>, the venue's own values replace the tenant's wholesale — no
              per-field blending. <Mono>mergeLocationConfig()</Mono> in <Mono>siteDataSvc.js</Mono>{' '}
              is the one place this resolves.
            </P>
            <P>
              Admin UI: <Mono>BrandSection</Mono> in <Mono>Website.jsx</Mono> (rendered under{' '}
              <Mono>tenant-brand</Mono>, labelled Look &amp; layout) shows a pill selector — "Whole website"
              plus one pill per venue with an active override — only when the tenant has more than one venue.
              Whole website shows a card pointing at <Mono>/brand</Mono>, <Mono>BrandIdentitySection part="site"</Mono>{' '}
              (site name, social picture) and <Mono>BrandLayoutSection</Mono>; a venue pill shows identity (part all),
              theme and layout for that venue.{' '}
              <Mono>Give a location its own look</Mono> calls <Mono>POST /website/config</Mono> (ensures the
              venue's row exists) then <Mono>PATCH /website/config?venue_id=X</Mono> with{' '}
              <Mono>use_brand_override: true</Mono> and every override field COPIED from the
              tenant's current values at that moment — a snapshot, not a live link; editing the
              tenant default afterwards does not change an already-created override.{' '}
              <Mono>Remove override</Mono> just flips the flag back to <Mono>false</Mono> (inline
              double-confirm); the venue's stored values are left in place in case the operator
              re-adds the override later. <Mono>BrandIdentitySection</Mono>,{' '}
              <Mono>BrandThemeSection</Mono>, and <Mono>BrandLayoutSection</Mono> all take an
              optional <Mono>venueId</Mono> prop — <Mono>null</Mono> (default) edits{' '}
              <Mono>tenant_site</Mono> via <Mono>/website/brand-defaults</Mono> exactly as before;
              a venue id edits that venue's <Mono>website_config</Mono> via{' '}
              <Mono>/website/config?venue_id=X</Mono> instead, using the identical form fields.
            </P>
            <P>
              Saving the tenant default (<Mono>PATCH /website/tenant-site</Mono>,{' '}
              <Mono>PATCH</Mono> / <Mono>POST /website/brand-defaults</Mono>) writes{' '}
              <Mono>tenant_site</Mono> only and never touches a venue's{' '}
              <Mono>website_config</Mono>. Until 20 Oct 2026 both routes also stripped{' '}
              <Mono>colors</Mono> / <Mono>typography</Mono> from every venue's theme and set its{' '}
              <Mono>template_key</Mono> to NULL (left over from before migration 098). The column is
              NOT NULL, so every save that sent a template (Brand identity always does) failed with
              a 500 once a venue had website settings, and theme saves emptied overrides' colours
              and fonts.
            </P>
            <InfoBox type="warn">
              This replaces an earlier per-field sparse-inheritance model (
              <Mono>BRAND_INHERITABLE</Mono>, and a <Mono>brandTheme.js</Mono> helper that forced
              tenant colours/typography to always win regardless of what a venue had stored) that
              let a stale, half-filled venue theme silently bleed into the live site. Both are
              deleted — there is no code path left that blends tenant and venue brand/theme
              field-by-field. A venue's brand/theme is either the tenant's, in full, or its own,
              in full.
            </InfoBox>
            <InfoBox type="info">
              The standalone per-venue "Identity" page (site name/tagline/logo/favicon only, no
              theme) that used to sit under the venue Pages nav is gone (2026-09-25). It never
              actually had any effect beyond logo/favicon — <Mono>mergeLocationConfig()</Mono>{' '}
              never read its site_name/tagline back out for rendering — and is now fully
              superseded by the Brand & theme override above, which covers strictly more (theme,
              typography, layout too) with an explicit on/off switch instead of silent
              per-field inheritance.
            </InfoBox>

            <H3>API routes</H3>
            <DataTable
              head={['Method + Path', 'Auth', 'Purpose']}
              rows={[
                ['GET /api/website/config',             'auth',  'Fetch singleton config for the current tenant. Returns {} when no row exists yet.'],
                ['POST /api/website/config',            'admin', 'Create config row (first-time setup). Requires subdomain_slug.'],
                ['PATCH /api/website/config',           'admin', 'Partial update. Mutating custom_domain clears custom_domain_verified.'],
                ['GET /api/website/slug-available',     'auth',  'Global uniqueness check across ALL tenants. Does NOT use withTenant().'],
                ['POST /api/website/tenant-site/verify-domain', 'admin', 'DNS-resolves custom_domain, matches A records to platformIps() (what the site\'s own address and the root resolve to, plus APP_PUBLIC_IPS) and/or a CNAME ending in PUBLIC_ROOT_DOMAIN. Updates the verified flag (verified also writes the domain sync\'s kick file); returns server_status, server_auto, server_state and a hint.'],
                ['GET/POST/PATCH/DELETE /api/website/gallery',    'auth/admin', 'Gallery CRUD + /gallery/reorder.'],
                ['GET/POST/PATCH/DELETE /api/website/pages',      'auth/admin', 'Custom pages CRUD.'],
                ['GET/POST/DELETE /api/website/menus',            'auth/admin', 'PDF menu docs CRUD. GET and POST need ?venue_id= (without it GET returns [] and POST 404s, which is why the admin page could never upload before it sent one).'],
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

            <H3>Block colours: theme roles or a custom code</H3>
            <P>
              <Mono>ThemeColourPicker</Mono> (<Mono>components/website-builder/ThemeColourPicker.jsx</Mono>)
              stores a theme role name (<Mono>primary</Mono>, <Mono>accent</Mono>, <Mono>background</Mono>,{' '}
              <Mono>surface</Mono>, <Mono>text</Mono>, <Mono>muted</Mono>, <Mono>border</Mono>) for a
              swatch, or <Mono>#rrggbb</Mono> for its custom colour (the rainbow swatch, with a code box
              while one is in use; <Mono>allowCustom</Mono> turns it off). Every reader resolves both: a
              role to <Mono>var(--c-*)</Mono> (background is <Mono>--c-bg</Mono>), a code as it is.
              Readers: <Mono>shared/headingBlock.js</Mono> <Mono>roleColour()</Mono>,{' '}
              <Mono>tabs.eta</Mono> / <Mono>tabColour()</Mono>, <Mono>ai_chat.eta</Mono>,{' '}
              <Mono>promo_cta.eta</Mono> / <Mono>promoColour()</Mono> (dark text on a light custom
              background too), <Mono>online_ordering.eta</Mono> <Mono>_colour()</Mono>,{' '}
              <Mono>ordering.eta</Mono> <Mono>boxColour()</Mono>, <Mono>scrolling_text.eta</Mono>,{' '}
              <Mono>footer.eta</Mono> (custom codes since this change; the canvas in{' '}
              <Mono>siteBlocks.jsx</Mono> too) and the reservations widget (<Mono>resolveRoleHex()</Mono>,
              in the block and in <Mono>resolveWidgetDefaults()</Mono> in <Mono>siteRenderer.js</Mono>,
              which now also resolves the tenant default confirmation buttons; a role there used to
              reach the page as <Mono>#primary</Mono>).
            </P>
            <InfoBox type="warn">
              A new block colour field that uses <Mono>ThemeColourPicker</Mono> must accept both
              shapes in its SSR partial and its canvas (or pass <Mono>allowCustom={'{false}'}</Mono>):
              a reader that only maps role names silently drops a custom colour on the live site.
            </InfoBox>

            <H3>Theme maker (a picture and words to a theme)</H3>
            <P>
              One look for four designers: Website &gt; Brand &amp; theme (Theme ideas card), the kiosk
              designer&apos;s Brand panel, the menu screen designer&apos;s board panel and the printed
              menu designer&apos;s Page setup (Colours). <Mono>shared/themeKit.js</Mono> holds the
              rules; a <strong>kit</strong> is <Mono>{'{ name, about, colors: { background, surface, text, muted, border, primary, primary_text, accent, accent_text }, fonts: { heading, body, script, display }, shape: square | soft | round, heading_case: upper | normal, source }'}</Mono>.
            </P>
            <DataTable
              head={['Piece', 'What it does']}
              rows={[
                ['normaliseKit(raw)', 'The only way a kit is made: unknown fonts replaced (website list, display faces DISPLAY_FONTS), and contrast fixed by readableOn() (moves lightness, keeps the hue): text 4.5 on page and surface, muted 3, primary_text / accent_text 4.5, primary 3 against the page.'],
                ['extractPalette(rgba)', 'A picture\'s main colours from canvas pixels: median cut to 16 boxes, colours closer than 26 merged, see-through pixels (alpha < 128) ignored; [{ hex, share, h, s, l }].'],
                ['kitsFromPalette(palette)', 'Light, dark and bold kits from the palette alone (no AI): used when Pepper isn\'t available and shown at once while it works.'],
                ['websiteThemeFromKit / kioskBrandFromKit / boardFromKit / printFromKit', 'A kit into each designer\'s own settings, keeping everything a kit doesn\'t cover (background picture, spacing, logo...). Website: the primary carries white button text (head.eta .btn) and stands out 3:1 from the page when any shade can (websitePrimary()). Board: a light kit gets a deep background with words at 7:1. Print: inks readable on the paper (PRINT_PAPER) at 7 / 4.5.'],
                ['kitFrom*(current) / kitFromCurrent(target, current)', 'A designer\'s current look as a kit, sent to Pepper so "make it warmer" starts from it.'],
              ]}
            />
            <P>
              <Mono>POST /api/ai/themes</Mono> (<Mono>routes/themes.js</Mono>, under /api/ai for the longer
              proxy timeout): body <Mono>{'{ target: website | kiosk | board | print, prompt, image: { media_type, data (base64) }, palette: [{ hex, share }], current, like, count (1-4) }'}</Mono>,
              answer <Mono>{'{ kits, notes }'}</Mono>. Needs Pepper (ai_assistant view, staff_enabled, a key)
              and Manage on the target&apos;s page (<Mono>TARGET_MODULE</Mono>: website, pos_setup, screens,
              menus). The picture is checked by its bytes (<Mono>detectFile()</Mono>, 5 MB) and never stored.{' '}
              <Mono>services/themeAi.js</Mono> <Mono>suggestThemes()</Mono>: one call to the main model with the
              picture, the measured colours (exact, so the model doesn&apos;t guess them), the brand name,
              current / liked kits; structured output (<Mono>THEMES_SCHEMA</Mono>, every property required,
              fonts as enums), falling back to plain JSON if the schema is refused; counted with{' '}
              <Mono>addUsage()</Mono> (channel staff_chat, the person&apos;s daily share); every theme goes
              through <Mono>normaliseKit()</Mono>.
            </P>
            <P>
              Admin: <Mono>components/themes/ThemeMaker.jsx</Mono>. <Mono>ThemeMakerButton</Mono> (shown only
              with Manage) opens <Mono>ThemeMaker</Mono> in a portal in <Mono>{'<body>'}</Mono> (designers sit in
              fieldsets and scrolled panels). <Mono>readPicture()</Mono> shrinks the picture to 1024 px on a
              canvas, measures the palette before a white backing, sends a JPEG; From Media and Use my logo
              fetch the file first (same origin). Previews per place (<Mono>KitPreview</Mono>) draw through the
              same mappers, so a preview is what Use this gives. Use this calls the designer&apos;s{' '}
              <Mono>onApply(kit)</Mono>, which fills its form; Save stays the designer&apos;s. Kits used are kept
              in <Mono>maca_theme_kits</Mono> (8, this device) for the other designers.
            </P>
            <P>
              Alongside: the website <Mono>ThemeSchema</Mono> now keeps <Mono>colors.background_image</Mono> (Zod
              dropped it on every theme save); Brand &amp; theme shows the ready-made themes and the live preview
              (the unreferenced <Mono>ThemeSection</Mono> that held them was removed); printed menu designs take{' '}
              <Mono>ink_color</Mono> / <Mono>accent_color</Mono> / <Mono>muted_color</Mono> (null = standard),
              which <Mono>pageStyle()</Mono> in <Mono>shared/menuLayout.js</Mono> writes as <Mono>--ink</Mono>,{' '}
              <Mono>--plum</Mono> (+ <Mono>--plum-soft</Mono>, <Mono>--line</Mono>) and <Mono>--muted</Mono>.
            </P>
            <InfoBox type="warn">
              A new designer that takes themes needs a mapper and a <Mono>kitFrom*</Mono> in{' '}
              <Mono>themeKit.js</Mono> (checked against that designer&apos;s own normaliser in{' '}
              <Mono>shared/test/themeKit.test.mjs</Mono>), a target in <Mono>KIT_TARGETS</Mono>,{' '}
              <Mono>TARGET_MODULE</Mono> and the prompt&apos;s <Mono>TARGETS</Mono>, and a preview in{' '}
              <Mono>KitPreview</Mono>.
            </InfoBox>

            <H3>Heading block (heading)</H3>
            <P>
              <Mono>blocks/heading.eta</Mono>, editor <Mono>HeadingEditor.jsx</Mono>, canvas{' '}
              <Mono>HeadingCanvas</Mono> (<Mono>canvas/blockCanvas.jsx</Mono>). Every style comes from one
              file, <Mono>shared/headingBlock.js</Mono>: <Mono>headingLayout(data)</Mono> returns the tag, the
              decoration flags and objects of CSS properties; the partial writes them with{' '}
              <Mono>styleString()</Mono>, the canvas with <Mono>styleObject()</Mono>. The partial reaches it as{' '}
              <Mono>it.siteBlocks</Mono>, which <Mono>renderSite()</Mono> in <Mono>siteRenderer.js</Mono> adds to
              every site render (<Mono>headingLayout</Mono>, <Mono>styleString</Mono>,{' '}
              <Mono>googleFontsUrl</Mono>); a new block can share its styles the same way instead of keeping a
              second copy in the canvas. Data: heading, eyebrow, subheading, level h1-h4, size auto | sm | md |
              lg | xl | xxl (lg and up capped by vw), align, font_family (empty = theme heading font, @body =
              theme body font, else a font from shared/fonts.js, loaded by the block's own stylesheet link so
              it works in columns, pages and modals), font_weight, italic, uppercase, colour / sub_colour /
              decoration_colour / background (theme roles; background maps to --c-bg), decoration none | bar |
              rules, spacing sm | md | lg, container, boxed_step. Defaults: <Mono>HEADING_DEFAULTS</Mono>. The
              block renders nothing when heading, eyebrow and subheading are all empty.
            </P>

            <H3>Container blocks: Columns and Tabs</H3>
            <P>
              A container holds other blocks in slots. <Mono>SLOT_FIELD</Mono> in{' '}
              <Mono>website-builder/blockTree.js</Mono> names each container's slot list (<Mono>columns</Mono> →{' '}
              <Mono>data.columns</Mono>, <Mono>tabs</Mono> → <Mono>data.tabs</Mono>); each slot is{' '}
              <Mono>{'{ id, blocks, ...extra }'}</Mono> (a tab adds <Mono>label</Mono> and <Mono>anchor</Mono>). Every
              tree helper (find, map, remove, duplicate, insert, move, reorder) goes through{' '}
              <Mono>slotsOf()</Mono>, and a block's parent inside any container is{' '}
              <Mono>{"{ kind: 'column', blockId, columnId }"}</Mono>. Drop ids: <Mono>col:block:slot</Mono> is a slot
              body, <Mono>tab:block:slot</Mono> (<Mono>tabKey()</Mono>) a tab button, which drops the block at the end
              of that tab; <Mono>parseParentKey()</Mono> reads both. No container inside a container: enforced in{' '}
              <Mono>PageBuilder.jsx</Mono>'s drag end, <Mono>addInColumn</Mono> / <Mono>insertAfter</Mono>, and{' '}
              <Mono>BlockInserter</Mono>'s <Mono>nested</Mono> prop (hides <Mono>isContainer</Mono> blocks).
            </P>
            <P>
              Tabs: editor <Mono>TabsEditor.jsx</Mono> (tab list via <Mono>SortableRows</Mono>, style underline |
              pills | boxed, align left | center | stretch, active_colour theme role, mobile tabs | accordion,
              background), canvas <Mono>TabsCanvas</Mono> in <Mono>canvas/blockCanvas.jsx</Mono> (shows one slot at a
              time), SSR <Mono>blocks/tabs.eta</Mono>: ARIA tablist with arrow keys, accordion at 700px and below
              when mobile = accordion, first panel visible without JS, and a URL hash matching a tab's anchor or any
              element inside a panel opens that panel. Server code that walks blocks for data (the three loaders in{' '}
              <Mono>siteDataSvc.js</Mono>, <Mono>collectBlockFonts</Mono> in <Mono>head.eta</Mono>) walks{' '}
              <Mono>data.columns</Mono> and <Mono>data.tabs</Mono>; a new container type must be added there and to{' '}
              <Mono>SLOT_FIELD</Mono>, and <Mono>collectAnchors()</Mono> in <Mono>blockRegistry.js</Mono> lists tab
              anchors for the link picker.
            </P>
            <P>
              Full screen: <Mono>PageBuilder.jsx</Mono> state in localStorage <Mono>maca_builder_fullscreen</Mono>.
              The root becomes <Mono>fixed inset-0 z-[45]</Mono> (above the AppShell burger at z-40, below modals at
              z-50), the canvas and <Mono>BlockInspector</Mono> (<Mono>fullHeight</Mono>) each scroll on their own.
            </P>

            <H3>Guestplan block (guestplan_widget)</H3>
            <P>
              Embeds Guestplan&apos;s own loader (<Mono>cdn.guestplan.com/widget.js</Mono>, <Mono>window._gstpln.accessKey</Mono>),
              loaded with the page. Guestplan mounts its own floating button and booking form outside the block (on a desktop
              it may open the form by itself); we don&apos;t draw a button. With no heading the block outputs only the script
              (and the optional custom CSS), so it adds no empty band; with a heading it renders a section holding just the
              heading. A second Guestplan block on a page only re-sets the access key.
            </P>
            <P>
              The earlier &quot;Start closed&quot; option (<Mono>data.launcher_mode</Mono>: our own floating button that loaded
              Guestplan on the first tap and then clicked Guestplan&apos;s launcher for the visitor) is gone: on the live site the
              click never opened the form, so visitors had to tap twice. Migration 163 removes <Mono>launcher_mode</Mono> from
              every stored and published block, and clears <Mono>heading</Mono> on blocks that had it on (it was the button&apos;s
              label there).
            </P>

            <H3>Publishing (admin)</H3>
            <P>
              <Mono>Website.jsx</Mono>: <Mono>PublishButton</Mono> sits at the top of the builder's left menu
              (above the Site / location switcher and Home) and shows <Mono>tenant_site.published_at</Mono> or{' '}
              <Mono>scheduled_publish_at</Mono>, with a Staging link beside it (<Mono>staging-{'{subdomain_slug}'}</Mono>,
              new tab, only when a subdomain is set); it opens <Mono>PublishModal</Mono> (staging link,{' '}
              <Mono>POST /website/tenant-site/publish</Mono>, <Mono>POST|DELETE /website/tenant-site/schedule-publish</Mono>,{' '}
              <Mono>POST /website/tenant-site/override-staging</Mono>, all invalidating <Mono>['tenant-site']</Mono>).
              The <Mono>tenant-domain</Mono> section (<Mono>TenantDomainSection</Mono>, now labelled Domain) keeps the
              subdomain, custom domain, DNS verify and the <Mono>is_published</Mono> switch with their own Save.
            </P>
            <P>
              Publish status: <Mono>GET /website/tenant-site/publish-status</Mono> → <Mono>publishStatus()</Mono> in{' '}
              <Mono>services/publishSvc.js</Mono> builds the snapshot Publish would save (<Mono>buildPublishSnapshot()</Mono>)
              and compares it with <Mono>published_snapshot</Mono> through <Mono>canonical()</Mono> (keys sorted, null and
              missing keys dropped, so jsonb key order and fields added to the lists since don&apos;t count). It returns{' '}
              <Mono>{'{ published_at, never_published, in_sync, changes: [{ label, kind }] }'}</Mono>: tenant fields
              grouped by <Mono>TENANT_AREAS</Mono> (Home page, Header, Footer, Brand &amp; theme, SEO, …, anything else
              Site settings), pages by id (added / changed / removed or hidden), per location its page
              (<Mono>page_blocks</Mono>, header/footer switches), its own brand (only while <Mono>use_brand_override</Mono>{' '}
              is on, since a tenant theme save strips colours from every location) and other details.{' '}
              <Mono>usePublishStatus()</Mono> in <Mono>Website.jsx</Mono> refetches 600 ms after any successful mutation
              (mutation cache subscription), every 30 s and on focus; <Mono>PublishButton</Mono> shows the line and a count
              badge, <Mono>PendingChanges</Mono> the list in the publish window. Fixed alongside:{' '}
              <Mono>use_brand_override</Mono> was missing from <Mono>WEBSITE_CONFIG_CONTENT_FIELDS</Mono>, so a
              location&apos;s own Brand &amp; theme never showed on production (it does after the next publish), and
              Override staging re-created pages without their ids or <Mono>system_key</Mono>.
            </P>

            <H3>Staging password</H3>
            <P>
              Migration 158: <Mono>staging_access</Mono> (one row per tenant: <Mono>password_hash</Mono>,{' '}
              <Mono>updated_by</Mono>, <Mono>updated_at</Mono>, RLS). No row = staging is open as before. Kept out of{' '}
              <Mono>tenant_site</Mono> because that row is read with <Mono>SELECT *</Mono> by the renderer and returned whole
              by the admin routes. <Mono>services/stagingAccess.js</Mono>: <Mono>hashPassword()</Mono> /{' '}
              <Mono>checkPassword()</Mono> (scrypt, random salt, <Mono>s1$salt$hash</Mono>), <Mono>cookieValue()</Mono> /{' '}
              <Mono>cookieOk()</Mono> (cookie <Mono>mcrn_staging</Mono> = issued-at + HMAC, 30 days, host-only, HttpOnly,
              SameSite=Lax, Secure on https), <Mono>previewKey()</Mono> / <Mono>previewKeyOk()</Mono> (expiry + HMAC, 10
              minutes), <Mono>safeNext()</Mono> (same-host paths only). Every HMAC is keyed by the stored hash, so changing
              or removing the password ends all cookies and links, and one tenant&apos;s cookie means nothing on another
              tenant&apos;s staging host.
            </P>
            <P>
              Gate: the <Mono>onRequest</Mono> hook in <Mono>routes/siteRenderer.js</Mono>, staging hosts only, every route
              in that plugin except <Mono>/robots.txt</Mono>, <Mono>/bimi.svg</Mono> and the login route. No valid cookie:
              a <Mono>?staging_key=</Mono> that checks out sets the cookie and 302s to the same URL without the key;
              otherwise 401 with <Mono>views/site/staging_login.eta</Mono> (noindex, <Mono>no-store</Mono>).{' '}
              <Mono>POST /_staging/login</Mono> (form <Mono>password</Mono> + <Mono>next</Mono>, 10 a minute per IP) sets the
              cookie and 303s back. Staging pages are sent <Mono>Cache-Control: private, no-cache</Mono>. Other plugins on the
              same host (<Mono>/order-api</Mono>, <Mono>/widget-api</Mono>, <Mono>/uploads</Mono>) aren&apos;t gated: they
              serve the same live data as production.
            </P>
            <P>
              Admin API (<Mono>routes/website.js</Mono>): <Mono>GET /website/tenant-site/staging-access</Mono> →{' '}
              <Mono>{'{ protected, updated_at, updated_by, url }'}</Mono> (never the hash);{' '}
              <Mono>PUT</Mono> the same with <Mono>{'{ password }'}</Mono> (6-200 characters, not blank) or{' '}
              <Mono>{'{ password: null }'}</Mono> to remove, owner/admin; <Mono>POST /website/tenant-site/staging-link</Mono>{' '}
              → the staging URL, with a preview key when protected. Admin UI in <Mono>Website.jsx</Mono>:{' '}
              <Mono>useStagingAccess()</Mono>, <Mono>StagingPassword</Mono> in the publish window&apos;s Staging card, and{' '}
              <Mono>useOpenStaging()</Mono> on both Staging links (opens the tab during the click, then sends it to the
              signed link, opener cleared).
            </P>

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
            <Code>{`1. Tenant saves tenant_site.custom_domain (PATCH /website/tenant-site).
   cleanCustomDomain(): lower case, no scheme / path / port / trailing dot,
   must be a hostname, refuses our own root and *.root (422), and another
   tenant's domain (409). Only a CHANGED domain sets
   custom_domain_verified = false (the Domain section sends the domain
   with every save).
2. Tenant adds DNS:
     CNAME www → {slug}.{root}
     OR
     A     @   → the IPs platformIps() returns: what {slug}.{root} and
                 the root resolve to, plus APP_PUBLIC_IPS if set.
3. Verify DNS → POST /website/tenant-site/verify-domain: resolves the
   domain's CNAME / A records, compares, sets custom_domain_verified,
   and when verified writes /var/lib/macaroonie-domains/kick.
4. The domain sync (scripts/custom-domains-sync.sh, a systemd timer every
   minute, started at once by the kick) runs the domain script:
     scripts/nginx-custom-domain.sh <domain> [www / bare twin]
   which writes sites-available/macaroonie-domain-<domain> (everything
   proxied to the API) and gets a certificate (certbot certonly --webroot).
5. siteRenderer matches the Host header to tenant_site.custom_domain
   (verified, site published).`}</Code>
            <P>
              Step 4 is what makes the domain reach the site: nginx only sends a host to the API when a
              server block names it. Without one a request for the domain lands on nginx&apos;s default
              server for the port, which on this server is certbot&apos;s port-80 block for the apex (
              <Mono>return 404</Mono>), so the guest gets a bare nginx 404 however the app is set up.
            </P>
            <H3>The domain sync</H3>
            <P>
              <Mono>scripts/install-domain-sync.sh</Mono> runs on every deploy (deploy.yml, with sudo). It
              copies both scripts to root-owned <Mono>/usr/local/sbin/macaroonie-domains-sync</Mono> and{' '}
              <Mono>/usr/local/sbin/macaroonie-domain</Mono>, makes <Mono>/var/lib/macaroonie-domains</Mono>{' '}
              (its <Mono>kick</Mono> file owned by the app user) and enables{' '}
              <Mono>macaroonie-domains.timer</Mono> (every minute) and <Mono>macaroonie-domains.path</Mono>{' '}
              (runs the service when <Mono>kick</Mono> is written). The API never runs anything as root: it
              only reads the state directory and writes <Mono>kick</Mono>.
            </P>
            <DataTable
              head={['Each run', 'What happens']}
              rows={[
                ['Reads', 'SELECT lower(custom_domain), custom_domain_verified FROM tenant_site (psql, api/.env\'s DATABASE_URL) in system mode (PGOPTIONS -c app.bypass_rls=on, as systemSql: tenant_site has forced row-level security, migration 176, and without it the query sees no rows). If that fails, or tenant_site has no rows at all, it exits 1 and changes nothing.'],
                ['Removes', 'Every macaroonie-domain-* block whose domain no tenant has saved (any verification state), with its certificate (REMOVE=1 DELETE_CERT=1) and state. The database decides, so a block made by hand for a domain nobody saved goes too.'],
                ['Switches on', 'Each verified domain without a 443 block: DNS must point only at this server (every A record in what the root resolves to plus APP_PUBLIC_IPS; any AAAA record too). Otherwise state waiting_dns with the reason, checked again every run (no certificate request, so no Let\'s Encrypt attempt). Then the domain script with the domain and its www / bare twin when the twin points here and no other tenant saved it.'],
                ['Twin later', 'For a domain already on https, the twin is added once its DNS points here. The domain script keeps https on for the main name while it asks for the bigger certificate and if that fails.'],
                ['Retries', 'A failed certificate waits 5 min, 15 min, 1 h, 6 h, then a day (Let\'s Encrypt allows 5 failed checks per name per hour). A kick retries sooner, but not within 2 minutes of the last try. Twins keep their own backoff in twins/<name>.'],
                ['Reports', '<domain>.json (status working | waiting_dns | http | error | https, message: certbot\'s Detail line or the DNS reason, attempts, last_try, next_try) and last-run, all world-readable.'],
                ['Stops', 'touch /var/lib/macaroonie-domains/disabled. One run at a time (flock); logs: journalctl -u macaroonie-domains.'],
              ]}
            />
            <P>
              <Mono>GET /website/tenant-site/dns-setup</Mono> and the verify response carry{' '}
              <Mono>server_status</Mono> from <Mono>domainServerStatus()</Mono> (reads{' '}
              <Mono>/etc/nginx/sites-enabled/macaroonie-domain-&lt;domain&gt;</Mono>: <Mono>https</Mono> when it
              listens on 443, <Mono>http</Mono> before the certificate, <Mono>none</Mono> without the file,
              null when the API isn&apos;t on the nginx server), plus <Mono>server_auto</Mono> (the sync&apos;s{' '}
              <Mono>last-run</Mono> is under 5 minutes old) and <Mono>server_state</Mono> (its{' '}
              <Mono>&lt;domain&gt;.json</Mono>, <Mono>next_try</Mono> in ms). The Domain section shows the
              progress while <Mono>server_auto</Mono> is on (refetching every 10 seconds until https), the
              manual command for platform admins when it is off, and links the domain only once it is{' '}
              <Mono>https</Mono>. <Mono>DOMAIN_SYNC_DIR</Mono> and <Mono>NGINX_SITES_ENABLED</Mono> override
              the paths (tests).
            </P>
            <DataTable
              head={['scripts/nginx-custom-domain.sh', 'What it does']}
              rows={[
                ['Arguments', 'The site\'s address first (as saved in Website > Domain), then any names that redirect to it (the www or bare version). All names need DNS pointing at the server. Run by the sync; by hand only to add a name the sync doesn\'t, or with the sync off.'],
                ['Certificate', 'CERT_NAME if given, else an existing certificate in /etc/letsencrypt/live covering every name, else certbot certonly --webroot (cert name = the first name; renewed by certbot\'s timer with a nginx reload). Certbot never edits the file.'],
                ['No certificate yet', 'If certbot fails (DNS not here yet, Cloudflare orange cloud), the HTTP-only block stays on, so the site works on http://, and the script exits 1 saying why. When a certificate for the main name already exists (adding a twin), https stays on with it and only the new name is left out.'],
                ['Checks', 'Warns (doesn\'t stop) when no tenant has the first name saved, when it isn\'t verified, or when the site isn\'t live (psql with api/.env\'s DATABASE_URL).'],
                ['REMOVE=1 / DRY_RUN=1', 'Take the domain off (DELETE_CERT=1 also deletes the certificate) / print the config.'],
                ['Lock', 'One run at a time (flock on /run/lock/macaroonie-domain.lock); children get the lock closed so a restarted nginx never holds it.'],
              ]}
            />
            <P>
              Tested against a local nginx, Postgres and the API with certbot stubbed: saved but not
              verified left alone, a failed certificate (http:// only, backoff, kick), https, the twin added
              later, a twin that fails keeping https, DNS pointing elsewhere and a stray AAAA record, removal
              when the domain changes or nobody saved it, the API&apos;s kick and status fields, a bad
              database URL, the off switch, the lock, and the installer (systemd-analyze verify).
            </P>
            <H3>Wildcard pieces (tenant subdomains)</H3>
            <ul className="list-disc ml-5 space-y-1.5 text-sm text-muted-foreground mb-4">
              <li>Nginx: wildcard server block for <Mono>*.macaroonie.com</Mono> proxying to the API.</li>
              <li>DNS: wildcard A record for <Mono>*.macaroonie.com</Mono> → app IP.</li>
              <li>SSL: wildcard cert via Certbot DNS-01 (Lightsail DNS hook scripts; see CLAUDE.md).</li>
            </ul>
          </section>

          <section id="media-library" data-doc="">
            <H2>Media Library</H2>
            <P>
              One component, <Mono>MediaLibraryModal</Mono> in{' '}
              <Mono>components/media/MediaLibrary.jsx</Mono>, serves three uses. As a picker (
              <Mono>mode="picker"</Mono>) it opens as a modal from any image field and returns{' '}
              <Mono>(url, item)</Mono> through <Mono>onPick</Mono>. As a modal manager (
              <Mono>mode="manager"</Mono>) it has no insert action. With <Mono>inline</Mono> it
              fills its container as a page: no backdrop, no close or fullscreen buttons, no footer,
              no Escape handler, and the header gets the <Mono>max-lg:notouch:pl-14</Mono> spacer.
              The sidebar Media link (<Mono>pages/Media.jsx</Mono>, <Mono>/media</Mono>) renders{' '}
              <Mono>{'<MediaLibraryModal open inline mode="manager" />'}</Mono>.
            </P>
            <P>
              The duplicate-upload dialog is <Mono>absolute inset-0</Mono> inside the panel, so the
              panel is <Mono>relative</Mono> in page and fullscreen modes. The image editor is its own{' '}
              <Mono>fixed</Mono> overlay in every mode. API routes live in{' '}
              <Mono>routes/media.js</Mono> (<Mono>/api/media</Mono>).
            </P>
            <P>
              Uploads need website, menus or screens manage. Pictures up to 12 MB; MP4 / WebM videos up
              to 150 MB (migration 167, for menu screens): <Mono>req.parts()</Mono> gets a 150 MB limit
              per call and each part is checked against its own type&apos;s limit, and sharp only reads
              pictures. <Mono>GET /items?kind=image|video</Mono> filters; the picker takes a{' '}
              <Mono>kind</Mono> prop (picker default image, manager all). nginx caps request bodies at
              30 MB, so every deploy runs <Mono>scripts/ensure-nginx-media-upload.sh</Mono>: a regex
              location for the two upload routes (160 MB, request buffering off, 300 s timeouts) before
              each <Mono>location /api/</Mono> block, with that block&apos;s proxy_pass and limit_req;
              idempotent, <Mono>nginx -t</Mono> or restore. <Mono>POST /items/check-duplicate</Mono>{' '}
              returns <Mono>hash</Mono> too.
            </P>
            <P>
              <Mono>.ico</Mono> pictures (favicons) are taken by <Mono>/api/media/items/upload</Mono>,{' '}
              <Mono>/items/:id/replace</Mono> and <Mono>/website/upload</Mono> (kind images):{' '}
              <Mono>utils/icon.js</Mono> takes a file as an icon when the browser calls it{' '}
              <Mono>image/x-icon</Mono> or <Mono>image/vnd.microsoft.icon</Mono>, or gives no useful type
              (<Mono>application/octet-stream</Mono>) and the name ends <Mono>.ico</Mono>
              (<Mono>mayBeIcon()</Mono>); the first bytes must then be an ICO header
              (<Mono>isIcon()</Mono>, else 422) and it is stored as <Mono>image/x-icon</Mono> /{' '}
              <Mono>.ico</Mono>. Media reads its size from the header (<Mono>iconSize()</Mono>, sharp
              can&apos;t read ICO). <Mono>readUpload()</Mono> / <Mono>pictureSize()</Mono> in{' '}
              <Mono>media.js</Mono> serve both of its upload routes. In the admin, the Media
              library&apos;s file filter and <Mono>isImageFile()</Mono> (dropped files) take a typeless
              file named <Mono>.ico</Mono>; the Favicon field&apos;s file picker accepts{' '}
              <Mono>image/*,.ico</Mono>.
            </P>
            <H3>Files dropped onto the editors</H3>
            <P>
              <Mono>lib/fileDrop.js</Mono>: <Mono>useFileDrop()</Mono> (handlers that react only to file
              drags; the innermost area takes the drop), <Mono>uploadMedia()</Mono> (sha-256 in the
              browser, reuses the item with the same hash in that scope through check-duplicate, else
              uploads), <Mono>mediaSize()</Mono> (a picture&apos;s or video&apos;s size, a video&apos;s
              length), <Mono>noImageDrag</Mono> and <Mono>installDropGuard()</Mono> (main.jsx: a drop
              nothing takes is cancelled with dropEffect none, so the browser never opens the file over
              the admin; inputs and contenteditable keep their own drops).{' '}
              <Mono>components/FileDropArea.jsx</Mono> wraps a picture field. Where it is used: the board
              designer canvas (onto an image / video block replaces its url, else a new block at the drop
              point the file&apos;s shape; videos get <Mono>opts.duration</Mono>), the menu designer pages
              (onto an image block, else a new image block at the grid cell), the page builder canvas
              (onto image / hero / story_with_stamp, <Mono>PICTURE_FIELD</Mono> in PageBuilder.jsx, else
              a new Image block after the block dropped on; uploads through <Mono>/website/upload</Mono>),
              both website <Mono>ImageField</Mono>s, the designers&apos; picture panels and the Menus
              page dish / section pictures. In both designers the canvas cancels <Mono>dragstart</Mono>{' '}
              and the blocks are <Mono>user-select: none</Mono> / <Mono>-webkit-touch-callout: none</Mono>:
              the browser&apos;s own picture drag used to start on a mouse press on a picture, cancel the
              pointer move (pointercancel) and leave the block where it was.
            </P>
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
                  desc: 'Runs on the same HTTP server. Auth via ?token= query param (Auth0 JWT), or ?pos_device=&secret= for a till (room pos:<venueId>). Rooms keyed by venue_id. The API runs as several PM2 processes and a socket belongs to one of them, so broadcast() delivers locally and publishes on Redis (channel macaroonie:ws); the other processes relay it to their sockets (each message carries its origin, so none is delivered twice). With Redis down only the sending process\'s clients hear it; the pages also poll.',
                  code: "// Client subscribes:\n{ type: 'subscribe', venue_id: '<uuid>' }\n\n// Server pushes after mutations:\n{ type: 'booking.created' | 'booking.updated', booking: { ... } }",
                },
                {
                  name: 'BullMQ queues',
                  path: 'src/jobs/queues.js',
                  desc: 'Redis-backed queues, a worker each, started by server.js in every API process: notifications (booking and order emails), hold-sweep (every minute: expired holds, online orders past their time, due menu releases), review-scrape (Apify reviews, jobs/reviewScrapeWorker.js), website-publish (scheduled publishes, jobs/publishWorker.js), gloriafood-poll (every minute), ai-cleanup (hourly: Pepper chat retention and audit clean-up, ai/erase.js cleanUpAi()). Repeat jobs are added at start-up and need Redis; BullMQ keeps one repeat per name however many processes add it.',
                  code: null,
                },
                {
                  name: 'DB helpers',
                  path: 'src/config/db.js',
                  desc: 'Core database abstraction. Handle carefully.',
                  code: "// withTenant — transaction with RLS context\nawait withTenant(tenantId, async tx => {\n  const [row] = await tx`SELECT * FROM bookings WHERE id = ${id} AND tenant_id = ${tenantId}`\n  return row\n})\n\n// withSystem — system mode (migration 176), only to find the tenant first\nawait withSystem(async tx => {\n  const [t] = await tx`SELECT tenant_id FROM tenant_site WHERE subdomain_slug = ${slug}`\n  return t\n})",
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

── Deposit venues (widget only) ───────────────────────────
  → POST /widget-api/venues/:id/holds/:hold/deposit
      PaymentIntent on the group's Stripe account, hold kept 15 min
  → Guest pays in the widget (Payment Element, 3DS in place)
  → POST .../deposit/confirm  (or the Connect webhook, whichever first)
      Stripe asked → settleDeposit()
        confirm_hold(hold_id, tenant_id, allow_expired)
        → INSERT bookings + payments, DELETE booking_holds
        (table gone → deposit refunded, guest picks another time)
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
              A deposit booking is only made once the server has read the PaymentIntent back from Stripe
              (the widget&apos;s confirm or the Connect webhook, through <Mono>settleDeposit()</Mono>), never on the
              browser&apos;s word. <Mono>confirm_hold()</Mono> uses{' '}
              <Mono>FOR UPDATE NOWAIT</Mono> to prevent double-booking under concurrent requests.
            </InfoBox>
          </section>

          {/* ── DEPLOYMENT ────────────────────────────────── */}
          <section id="test-data" data-doc="">
            <H2>Test data tools</H2>
            <P>
              Pre-prod QA tooling on the Test data page, routes in <Mono>routes/testData.js</Mono>
              (mounted at <Mono>/api/venues</Mono>, all gated by <Mono>test_data</Mono> manage).
              Bookings: <Mono>POST /:venueId/test-data/seed</Mono> and <Mono>/clear</Mono>.
              Health &amp; safety logs (migration 139): <Mono>services/hsTestDataSvc.js</Mono>.
            </P>
            <DataTable
              head={['Route', 'Body', 'Notes']}
              rows={[
                ['POST /:venueId/test-data/hs/generate', 'date_from, date_to, kinds[], issue_pct (0-30), skip_closed, checklist_template_ids (null = all), dry_run', 'date_to may not be after the venue local today; at most 366 days. Returns counts per kind, days_filled, out_of_range, checklists_completed_existing and notes (e.g. no hold stations set up).'],
                ['POST /:venueId/test-data/hs/clear', 'date_from, date_to, kinds[], dry_run, confirm', 'Deletes rows with is_generated = true only. confirm: true required unless dry_run.'],
              ]}
            />
            <H3>What each kind writes</H3>
            <DataTable
              head={['Kind', 'Table', 'Rule']}
              rows={[
                ['temps', 'fs_temp_logs', 'Per active equipment x active fs_capture_times (one 09:00 reading a day when there are none). Cold units: up to 1.5°C below max; hot: 1.5-13.5°C above min; defaults by type when a limit is missing. is_within_range from the row limits, as POST /temp-logs does.'],
                ['holds', 'fs_hold_checks', 'Per active station x fs_hold_capture_times, same value rule.'],
                ['cooking', 'fs_cooking_checks', 'Per session: required_items_count minus checks already logged (a fresh session sometimes gets one extra). Dishes from loadCookingPicker() (services/cookingItems.js), the same list the cooking picker shows: menus, the venue\'s own list or both. Core 76-92°C.'],
                ['orders', 'purchase_orders + purchase_order_lines', 'Items on the venue\'s active order lists, each on its chooseQuote() pick, grouped by supplier; one PO per supplier per delivery day (venue override first; suppliers without delivery days are skipped), 60-85% of that supplier\'s items, qty = par packs x 0.7-1.3 (else 1-4), fitQty(). Status received (sent when deliveries are not generated), numbers continue the tenant\'s sequence.'],
                ['deliveries', 'fs_delivery_checks', 'One per received purchase order in range with no check yet (purchase_order_id, unique). vendor_name = supplier; items jsonb = the lines that arrived with temp_c by storage; chilled 1-5°C, frozen -22 to -18°C, product_temp_c = chilled else frozen.'],
                ['checklists', 'checklist_instances + checklist_instance_items', 'Every period the range touches (daily skips closed days), status completed, all active items ticked, completed_at on the last day of the period in range. An in_progress instance is completed and ticked but keeps is_generated = false.'],
              ]}
            />
            <P>
              <Mono>issue_pct</Mono> moves that share of readings 0.5-3°C past the limit that
              matters (or a core temp of 68-74.5°C, or a warm delivery, which is then not
              accepted) and writes a corrective action. Existing readings are never overwritten:
              slots with a row are skipped. <Mono>recorded_by</Mono> is a random active
              <Mono>cash_staff</Mono> name for the venue, else the caller email. Times are
              venue local (<Mono>zonedToUtc()</Mono>). Rows are bulk inserted in chunks of 500
              inside the request transaction; dry_run builds the same rows and inserts nothing,
              so its counts are exact except for the random extra cooking check.
            </P>
          </section>

          <section id="deployment" data-doc="">
            <H2>Deployment</H2>
            <H3>Hosts</H3>
            <DataTable
              head={['Host', 'Serves', 'Where']}
              rows={[
                ['office.macaroonie.com', 'The admin portal (admin/dist) plus the API paths', 'nginx: scripts/nginx-office-ops.sh'],
                ['ops.macaroonie.com', 'The same admin build; / goes to /mobile/, the SPA sends any non-/mobile route to /mobile (IS_OPS_HOST in lib/hosts.js), and the page links /ops.webmanifest (scope /) so Android installs it as its own app', 'nginx: scripts/nginx-office-ops.sh'],
                ['macaroonie.com (and www.)', 'The platform page: features, franchises, who it is for, roadmap (EPOS, kitchen screens, kiosks, loyalty; AI insights, AI assistant, MCP), how we build, team and the register-interest form (routes/platformSite.js, views/platform/landing.eta, plain HTML, edit the copy there). Other GETs 301 to the same path on office.; API paths (/api, /manage, /reservations, /widget-api, /ws, /webhooks, /uploads, /order-api) pass through; /sw.js is a service worker that removes itself so an admin installed on the apex stops showing', 'nginx: scripts/nginx-apex-landing.sh'],
                ['screens.macaroonie.com', 'The menu screens\' player (screen/, routes/screenSite.js), /screen-api and /ws', 'wildcard server block (nothing to set up)'],
                ['{slug}.macaroonie.com', 'Tenant sites (routes/siteRenderer.js). office, ops, pos and screens are in RESERVED_SUBDOMAINS', 'wildcard server block'],
                ['Custom domains (www.yourrestaurant.com)', 'Tenant sites, matched by tenant_site.custom_domain', 'nginx: the domain sync (scripts/custom-domains-sync.sh, systemd timer installed by the deploy) runs scripts/nginx-custom-domain.sh per verified domain (Website CMS → Custom domain lifecycle)'],
              ]}
            />
            <P>
              <Mono>services/platformHost.js</Mono> (<Mono>platformHostKind(host)</Mono>,{' '}
              <Mono>officeOrigin()</Mono>, <Mono>opsOrigin()</Mono>) is the API's one host check; the
              admin's is <Mono>lib/hosts.js</Mono> (<Mono>IS_OPS_HOST</Mono>, <Mono>IS_OFFICE_HOST</Mono>,{' '}
              <Mono>mobileHref()</Mono>, <Mono>standardHref()</Mono>), used by{' '}
              <Mono>MobileViewToggle</Mono> and <Mono>MobileSuggestModal</Mono> to switch host instead of
              route on office./ops. On any other host (localhost) both views stay in one origin.
              The platform page hook is global (<Mono>fastify-plugin</Mono>) and registered before every
              route plugin in <Mono>app.js</Mono>.
            </P>
            <H3>Moving to office / ops (one-off, in order)</H3>
            <ol className="list-decimal pl-5 space-y-1.5 text-sm mb-4">
              <li>DNS: the wildcard <Mono>*</Mono> record covers office and ops; without one, add A records for both.</li>
              <li><Mono>sudo DOMAIN=macaroonie.com bash scripts/nginx-office-ops.sh</Mono>: writes <Mono>sites-available/macaroonie-office</Mono> with HTTPS for both names (port 80 only answers ACME challenges and redirects). Certificate: <Mono>CERT_NAME</Mono> if given, else any certificate in <Mono>/etc/letsencrypt/live</Mono> covering both names (the <Mono>*.macaroonie.com</Mono> wildcard does), else <Mono>certbot certonly --webroot</Mono> on the existing certbot account (<Mono>CERTBOT_EMAIL</Mono> only if there is none). Certbot never edits the file. <Mono>DRY_RUN=1</Mono> prints the config.</li>
              <li>Auth0 (Applications → Macaroonie Admin → Settings): add office and ops to Allowed Callback URLs, Allowed Logout URLs and Allowed Web Origins; set Application Login URI to office.</li>
              <li>Check sign-in on office. and ops.</li>
              <li><Mono>sudo bash scripts/nginx-apex-landing.sh</Mono>: the apex <Mono>location /</Mono> and sw.js locations proxy to the API (backup kept; restored if <Mono>nginx -t</Mono> fails).</li>
            </ol>
            <P>
              Browser storage is per origin, so each person signs in once on the new address and their
              saved view settings (theme colour, timeline, last restaurant, shortcuts, launcher order) start
              from defaults once.
            </P>
            <P>
              If office returns the API's JSON 404 (<Mono>Route GET:/ not found</Mono>), the office block has no{' '}
              <Mono>listen 443</Mono> and the <Mono>*.macaroonie.com</Mono> tenant block is answering:{' '}
              <Mono>sudo nginx -T | grep -n "server_name\|listen"</Mono> shows it. If office redirects to itself,
              certbot's <Mono>if ($host = office…) {'{'} return 301 https://… {'}'}</Mono> sits in a block that now
              also serves 443. Both happened on the first run (Oct 2026, with <Mono>certbot --nginx</Mono>); running
              the current script again rewrites the file cleanly.
            </P>
            <H3>Register interest</H3>
            <P>
              <Mono>platform_interest</Mono> (migration 138): global, no RLS, like <Mono>backlog_items</Mono>.
              Written by <Mono>POST /api/platform-interest</Mono> (public, 5 per 10 minutes per IP,{' '}
              <Mono>consent: true</Mono> required, a filled <Mono>website</Mono> honeypot gets 204 and is not
              stored); read and changed by platform admins through <Mono>GET/PATCH/DELETE
              /api/platform/interest[/:id]</Mono> (status new | contacted | closed, notes). Admin UI:
              Platform page → Registered interest (<Mono>components/platform/InterestPanel.jsx</Mono>).
              With <Mono>INTEREST_NOTIFY_EMAIL</Mono> and <Mono>SENDGRID_API_KEY</Mono> set, each form is
              also emailed there (reply-to the sender).
            </P>
            <H3>Environment variables</H3>
            <DataTable
              head={['Variable', 'App', 'Description']}
              rows={[
                ['DATABASE_URL', 'API', 'postgres.js connection string (set by setup.sh)'],
                ['REDIS_URL', 'API', 'BullMQ + hold sweep. Update password to match Redis config.'],
                ['AUTH0_DOMAIN', 'API + Admin', 'Auth0 tenant domain'],
                ['AUTH0_AUDIENCE', 'API', 'JWT audience identifier'],
                ['STRIPE_SECRET_KEY', 'API', "Optional fallback for the platform's Stripe secret key (the Platform page's Payments tab wins). STRIPE_WEBHOOK_SECRET is gone (migration 220): the Connect webhook's secret is STRIPE_CONNECT_WEBHOOK_SECRET or the Payments tab."],
                ['VITE_AUTH0_DOMAIN', 'Admin', 'Auth0 domain for SPA login'],
                ['VITE_AUTH0_CLIENT_ID', 'Admin', 'Auth0 SPA client ID'],
                ['VITE_AUTH0_AUDIENCE', 'Admin', 'JWT audience (same as API)'],
                ['INTEREST_NOTIFY_EMAIL', 'API', 'Optional. Receives an email for each register-interest form on the platform page.'],
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
            <H3>Building from empty (CI)</H3>
            <P>
              The live server&apos;s schema was built up one deploy at a time, so nothing showed that
              the migrations no longer ran on an empty database: 062 and 063 truncated the order sheet
              tables one statement at a time, and 090 truncated <Mono>fs_hold_checks</Mono> on its own.
              Postgres refuses to truncate a table that another table references (even an empty one)
              unless both are in the same statement or <Mono>CASCADE</Mono> is given; all three now use
              one <Mono>TRUNCATE ... CASCADE</Mono>. 001 made{' '}
              <Mono>pg_cron</Mono> a hard requirement, which most hosted and CI Postgres don&apos;t have:
              001 now creates the extension only if it can (a notice otherwise), and 006 schedules the
              hold sweep with <Mono>cron.schedule()</Mono> only when the extension is there. The app&apos;s
              own BullMQ hold sweep (<Mono>holdSweepQueue</Mono>) is the primary sweep either way.
            </P>
            <P>
              <Mono>.github/workflows/ci.yml</Mono> runs on every pull request and every push to main:
              job <Mono>database</Mono> migrates an empty Postgres 16 (no pg_cron) from 001, runs the
              migrations a second time expecting "up to date", then starts the API against it with
              Redis and waits for <Mono>/api/health</Mono>; job <Mono>shared-tests</Mono> runs{' '}
              <Mono>node --test shared/test/*.test.mjs shared/pos/test/*.test.mjs</Mono>; job{' '}
              <Mono>api-tests</Mono> migrates its own empty <Mono>macaroonie_test</Mono> database and
              runs <Mono>npm test</Mono> in <Mono>api/</Mono> (below). Separate from the deploy
              workflow; a failing check doesn&apos;t block a push to main on its own (set up a branch
              rule in GitHub for that).
            </P>
            <H3>Testing: the API tests (api/test)</H3>
            <P>
              <Mono>npm test</Mono> in <Mono>api/</Mono> runs <Mono>api/test/*.test.mjs</Mono> with
              Node&apos;s test runner, one file at a time, against the real app (<Mono>buildApp()</Mono>,{' '}
              <Mono>app.inject()</Mono>, no network port). They empty the database first, so they
              refuse to run unless the database name in <Mono>DATABASE_URL</Mono> contains{' '}
              <Mono>test</Mono>; migrate it first (<Mono>node scripts/migrate.js</Mono>). They need
              Redis like the API. <Mono>LOG_LEVEL=info npm test</Mono> shows the API&apos;s log (silent
              otherwise). A run takes about four minutes. It uses the spec reporter, which ends with
              every failing test and its error, so the end of the CI job&apos;s log says what failed:
              the job also turns the Postgres service&apos;s log down to FATAL, because GitHub prints
              that log after the tests and the sweep makes thousands of expected errors.
            </P>
            <DataTable
              head={['File', 'What it is']}
              rows={[
                ['test/support/register.mjs + loader.mjs', 'Loaded with --import: every import of src/middleware/auth.js gets auth-stub.mjs instead.'],
                ['test/support/auth-stub.mjs', 'The real auth module with one change: requireAuth takes "Authorization: Bearer test:<auth0 sub>" plus X-Tenant-Id (no Auth0) and checks the person against users / platform_admins like the real one. Permissions, roles and modules are the real code.'],
                ['test/support/app.mjs', 'getApp(), as(sub, tenantId) (a client per person: get / post / put / patch / delete / request, with the internal-call header so tests aren\'t rate limited), ok() (throws with the API\'s message), closeApp().'],
                ['test/support/seed.mjs', 'resetAndSeed(): empties the tenants and the platform tables, makes the platform admin, then two tenants through POST /api/platform/tenants (Thai House = A, Other Co = B) with one person per role in A and an owner in B.'],
                ['test/support/fixtures.mjs', 'fillTenant(sub, tenantId, { mark, slug }): a tenant\'s data in every area, made through the API as its owner (venues, tables, schedule incl. overrides, exceptions and caps, bookings, holds, customers, menus with options, allergens and a release, rota and tips, Cash Recon days and wages, food safety, checklists, dashboards, purchasing, website, promotions, till, kitchen, screens, Pepper). Returns { ids, failed, writes }: writes is every write that worked (the sweep sends them again as the other tenant). The mark goes in names and notes.'],
                ['test/support/fake-claude.mjs', 'A stand-in Claude API: answers POST /v1/messages from a script, as a stream of server-sent events when asked; sets ANTHROPIC_BASE_URL.'],
                ['test/tenant-sweep.test.mjs', 'The cross-tenant sweep (below).'],
                ['test/ai-chat.test.mjs', 'Pepper\'s chat loop against the stand-in Claude: streamed turns, the JSON reply, busy chats, errors after the stream opened, withdrawn and refused messages, model routing.'],
                ['test/menu-order.test.mjs', 'A menu saved without positions keeps the order it was sent in (sections, dishes, options, groups, notes, the published copy too); dishes with equal positions come back by name.'],
              ]}
            />
            <H3>The cross-tenant sweep</H3>
            <P>
              Both tenants are filled with <Mono>fillTenant()</Mono> (B with its own mark, so A&apos;s
              mark <Mono>Zqx</Mono> appears only in A&apos;s data). Then, as B&apos;s owner:
            </P>
            <DataTable
              head={['Test', 'Fails when']}
              rows={[
                ['Every route that takes a parameter', 'Called with A\'s ids, and with B\'s own ids mixed in (B\'s venue with A\'s sitting): about 53,000 calls. A reply holds A\'s mark or an id of A\'s it wasn\'t sent; any of A\'s rows changes (an md5 per table over A\'s rows after each route); a 500. Ids come from every table with a tenant_id, one per table per tenant; named parameters (KINDS: venueId, sid, ...) get ids from their tables, :id gets all of them.'],
                ['Every write A made, sent again', 'Each write in fixtures\' writes, as A sent it and with each of A\'s ids in the address swapped for B\'s id from the same table (valid bodies, so the route gets past its validation): A\'s rows change, a record of A\'s named in the address is accepted, a reply holds an id of A\'s it wasn\'t sent, or a 500. Accepted with A\'s ids in the body only is listed, and left to the last test.'],
                ['None of B\'s rows point at A\'s', 'Any row of B\'s, as text (jsonb included), holds an id of A\'s; or a link table without a tenant_id (table_combination_members) joins two tenants\' rows.'],
              ]}
            />
            <P>
              Public routes (widget, ordering, website, devices, webhooks, MCP) are left out: they are
              reached by an id or token by design. A deliberate exception is listed with its reason:{' '}
              <Mono>ALLOWED_CHANGES</Mono> (B upvoting A&apos;s feature request: one shared board) and{' '}
              <Mono>ALLOWED_REFERENCES</Mono> (that upvote&apos;s row). A new table is swept as soon as
              the fixtures make a row in it; a new route as soon as it is registered. When you add a
              table or a route that takes ids, add a fixture step that makes a row (through the API) so
              its ids are tried. Statuses 503 (no Auth0 or AI key on the test server) aren&apos;t
              failures.
            </P>
            <H3>Typical deployment flow</H3>
            <Code>{`# From the developer's laptop:
git push origin main
# The GitHub Actions workflow then:
#   1. SSH to Lightsail
#   2. git fetch + hard reset to origin/main
#   3. npm install (api)
#   4. node scripts/migrate.js   (auto-baselines then applies pending)
#   5. npm install + build (admin, then the till app in pos/)
#   6. pm2 restart macaroonie-api
#   7. nginx patches (sudo): /manage on the apex, SPA cache headers,
#      http2 on every https listen (ensure-nginx-http2.sh), big media
#      uploads (ensure-nginx-media-upload.sh), 5 minutes for Pepper's
#      chat (ensure-nginx-ai-timeout.sh), domain sync
#   8. health check on /api/health: tries every 2 s for up to 30 s,
#      then fails the deploy with the last 30 PM2 log lines`}</Code>
            <P>
              <Mono>scripts/ensure-nginx-http2.sh</Mono>: nginx 1.24 warns{' '}
              <Mono>protocol options redefined for 0.0.0.0:443</Mono> when server blocks on one address disagree about{' '}
              <Mono>http2</Mono> (certbot writes <Mono>listen 443 ssl;</Mono>, the custom domain script{' '}
              <Mono>listen 443 ssl http2;</Mono>). http2 belongs to the listening socket, so once one block on an
              address has it every name there is served over HTTP/2 already; the script adds <Mono>http2</Mono> to the
              other <Mono>listen ... ssl</Mono> lines on that address (in the files <Mono>sites-enabled</Mono> points at),
              runs <Mono>nginx -t</Mono> (restores every file and fails if it doesn&apos;t pass) and reloads. It never
              removes http2 and leaves addresses where no block has it alone.
            </P>
            <P>
              <Mono>scripts/ensure-nginx-ai-timeout.sh</Mono>: every admin server block proxies{' '}
              <Mono>/api/</Mono> with <Mono>proxy_read_timeout 60s</Mono>, and a Pepper turn (several
              model calls, a photo to read, a menu to build) replies only at the end, so a turn over a
              minute showed a 504 while the API carried on and saved the reply. Rather than raise the
              timeout for every route, the script puts{' '}
              <Mono>{'location ^~ /api/ai/ { ... }'}</Mono> in front of each{' '}
              <Mono>location /api/</Mono> block, with that block&apos;s proxy_pass and limit_req,{' '}
              <Mono>proxy_read_timeout</Mono> / <Mono>proxy_send_timeout 300s</Mono> and buffering off.{' '}
              <Mono>^~</Mono> makes the prefix final, so no regex location can take those paths. The
              chat loop stops starting new steps after 240 s to answer inside that. Same safety as the
              other scripts (idempotent, <Mono>nginx -t</Mono> or restore). It and{' '}
              <Mono>ensure-nginx-media-upload.sh</Mono> both insert before the same{' '}
              <Mono>location /api/</Mono> line, so each looks for its own block in the text since the
              previous <Mono>/api/</Mono> block (that server block&apos;s locations), not in a fixed
              number of characters, or the other&apos;s insert would hide it and it would add itself
              again on every deploy.
            </P>
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
