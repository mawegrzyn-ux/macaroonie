// src/pages/docs/auth.jsx
// The Docs page's "Authentication" section. Docs.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, Mono, DataTable, InfoBox } from './parts.jsx'

export const id = 'auth'
export const label = 'Authentication'
export const order = 70

// ── AUTH ────────────────────────────────────────
export function Section() {
  return (
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
      <H3>Internal act-as (migration 262) and the Office app</H3>
      <P>
        <Mono>Bearer internal-as:&lt;users.id&gt;</Mono> with <Mono>X-Tenant-Id</Mono> signs a request in as that
        person, only when it carries <Mono>INTERNAL_CALL_SECRET</Mono> (random per process, sent only by{' '}
        <Mono>app.inject</Mono>): background work that reads routes as someone (the task notices) uses it through{' '}
        <Mono>callApi()</Mono>. Without the header it is a 401.
      </P>
      <P>
        Inside the Macaroonie Office app (see Android app) the pages sign in through the app:{' '}
        <Mono>lib/officeApp.jsx</Mono>&apos;s <Mono>OfficeAuthProvider</Mono> replaces <Mono>Auth0Provider</Mono>{' '}
        when <Mono>window.MacaroonieOffice</Mono> is there and fills Auth0&apos;s own context from the bridge
        (token, person, sign out), so <Mono>useAuth0()</Mono> everywhere works unchanged. The app&apos;s access token
        is for the same audience and issuer, so the API checks it like any other.
      </P>
    </section>
  )
}
