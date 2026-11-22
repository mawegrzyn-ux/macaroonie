// src/pages/help/team.jsx
// The Help page's "Team Management" section. Help.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, InfoBox, DataTable } from './parts.jsx'

export const id = 'team'
export const label = 'Team Management'
export const order = 450

// ── TEAM MANAGEMENT ──────────────────────────────
export function Section() {
  return (
    <section id="team" data-help="">
      <H2>Team Management</H2>
      <P>
        Manage who has access to your restaurant's admin portal. Invite team members,
        assign roles, and control what each person can see and do.
      </P>

      <H3>Roles</H3>
      <DataTable
        head={['Role', 'What they can do']}
        rows={[
          ['Owner',    'Full access. Manage team, billing, brand defaults, all settings. Can invite other owners.'],
          ['Admin',    'Manage venues, rules, website, emails, schedule. Cannot manage team or billing.'],
          ['Operator', 'Front-of-house. Manage bookings, view timeline, handle walk-ins.'],
          ['Viewer',   'Read-only access to bookings and timeline. Cannot make changes.'],
        ]}
      />

      <H3>Inviting a team member</H3>
      <ol className="list-decimal ml-5 space-y-2 text-sm text-muted-foreground mb-4">
        <li>Go to <strong>Team</strong> in the sidebar.</li>
        <li>Click <strong>Invite</strong> (top right). Only owners see this button.</li>
        <li>Enter the team member's email, optional full name, and choose a role.</li>
        <li>Click <strong>Send invite</strong>.</li>
        <li>
          The team member receives an email with a link to set their password and
          join your restaurant. Once they accept, they can log in straight away with the
          role you chose. Their row shows an "Invite pending" badge until they first log in.
        </li>
      </ol>
      <InfoBox type="info">
        You no longer need to touch the Auth0 dashboard — invitations, role changes,
        deactivation, and password resets are all handled here. (If you see an amber
        banner saying "Auth0 invitations not configured", ask your platform admin to
        fill in the Auth0 management credentials on the API.)
      </InfoBox>

      <H3>Changing a role</H3>
      <P>
        Owners can change any team member's role using the dropdown next to their name.
        The change takes effect immediately for in-app permissions. The next time the user
        signs in, their session also reflects the new role at the Auth0 level. You cannot
        change your own role.
      </P>

      <H3>Resetting a password</H3>
      <P>
        Click the <strong>key icon</strong> next to a member to send them a password reset
        email. They get a one-time link to set a new password — you never see or handle
        the password yourself. The icon turns green for a moment to confirm the email was
        sent.
      </P>

      <H3>Deactivating a member</H3>
      <P>
        Click the <strong>X</strong> button next to a member to deactivate them. They are
        immediately removed from your restaurant's Auth0 organisation, so even an existing
        login session can no longer access the admin portal. Their record is kept, and you
        can reactivate them later from the "Deactivated" section at the bottom — they
        will need to be re-invited so they get a fresh login link.
      </P>

      <H3>Switching between tenants</H3>
      <P>
        If you have access to multiple restaurant brands (tenants), a <strong>tenant
        switcher</strong> dropdown appears at the top of the sidebar. Selecting a different
        tenant logs you out and back in under that tenant's context.
      </P>

      <H3>Platform admins</H3>
      <P>
        Platform admins are Macaroonie staff who can manage all tenants. They see a
        <strong> Platform</strong> link at the bottom of the sidebar (shield icon) and
        can create, edit, and deactivate tenants from the platform dashboard. Platform
        admins bypass all role restrictions within any tenant.
      </P>
      <P>
        The platform dashboard's <strong>Registered interest</strong> tab lists everyone who filled in
        the form on macaroonie.com (newest first, with a count of new ones on the tab). Tap the email or
        phone to get in touch, set each one to <strong>New</strong>, <strong>Contacted</strong> or{' '}
        <strong>Closed</strong>, keep a note (with its own Save), or delete it (it asks first).{' '}
        <strong>Open</strong> hides closed ones; <strong>All</strong> shows everything.
      </P>
      <P>
        The <strong>Services</strong> tab&apos;s Platform status shows whether Macaroonie is up, running slow or
        down, and why. Platform admins are emailed when it has been <strong>down</strong> for two minutes or
        <strong> slow</strong> for half an hour, and again when it is <strong>back up</strong>; each once a spell.
        The card says when the last one was sent. The emails go from the platform&apos;s own email account, so
        they need its email key set on the server.
      </P>

      <H3>Creating a new tenant (master franchisee)</H3>
      <ol className="list-decimal ml-5 space-y-2 text-sm text-muted-foreground mb-4">
        <li>Open <strong>Platform</strong> from the sidebar (platform admins only) and stay on its <strong>Tenants</strong> tab.</li>
        <li>Click <strong>+ New tenant</strong>.</li>
        <li>
          Enter the franchise name (e.g. "Wingstop UK"), a slug
          (lowercase, hyphenated — e.g. <code>wingstop-uk</code>), and pick a plan.
        </li>
        <li>
          Leave <strong>Auto-provision Auth0 organisation</strong> ticked (recommended).
          The API will create the Auth0 org, enable Username/Password + Google login,
          and turn on auto-membership — all the Auth0 dashboard work happens
          automatically.
        </li>
        <li>Click <strong>Create tenant</strong>. The tenant appears in the list immediately.</li>
        <li>
          Use the <strong>tenant switcher</strong> button in the top-left of the
          sidebar (opens a "Switch restaurant" picker) to enter the new tenant. Then go
          to <strong>Team</strong> and invite the franchise owner.
        </li>
      </ol>
      <InfoBox type="info">
        If auto-provisioning isn't available (the platform's Auth0 management
        credentials don't include the org-creation scopes) the form shows a warning
        and the Auth0 Org ID field becomes required — paste an org id you've
        created manually in the Auth0 dashboard.
      </InfoBox>
    </section>
  )
}
