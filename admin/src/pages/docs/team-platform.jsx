// src/pages/docs/team-platform.jsx
// The Docs page's "Team & Platform Admin" section. Docs.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, Mono, DataTable } from './parts.jsx'

export const id = 'team-platform'
export const label = 'Team & Platform Admin'
export const order = 80

// ── TEAM & PLATFORM ADMIN ─────────────────────
export function Section() {
  return (
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
  )
}
