// src/services/auth0MgmtSvc.js
//
// Thin wrapper around the Auth0 Management API.
// Currently used to send organization invitations from /team/invite.
//
// Auth: machine-to-machine (client credentials grant).
// Required env: AUTH0_MGMT_CLIENT_ID + AUTH0_MGMT_CLIENT_SECRET.
// To send invitations: AUTH0_INVITE_CLIENT_ID (the SPA client users land in).
//
// If creds are missing, isConfigured() returns false and callers should
// degrade gracefully (skip the Auth0 call, create the local row, log a
// warning).

import { env } from '../config/env.js'

let cachedToken = null
let cachedExpiresAt = 0  // epoch ms; refresh ~5min before expiry

export function isConfigured() {
  return !!(env.AUTH0_MGMT_CLIENT_ID && env.AUTH0_MGMT_CLIENT_SECRET)
}

export function canInvite() {
  return isConfigured() && !!env.AUTH0_INVITE_CLIENT_ID
}

async function getMgmtToken() {
  if (!isConfigured()) {
    throw new Error('Auth0 Management API not configured (AUTH0_MGMT_CLIENT_ID/SECRET missing)')
  }
  const now = Date.now()
  if (cachedToken && now < cachedExpiresAt - 5 * 60_000) {
    return cachedToken
  }
  const res = await fetch(`https://${env.AUTH0_DOMAIN}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type:    'client_credentials',
      client_id:     env.AUTH0_MGMT_CLIENT_ID,
      client_secret: env.AUTH0_MGMT_CLIENT_SECRET,
      audience:      `https://${env.AUTH0_DOMAIN}/api/v2/`,
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Auth0 token request failed (${res.status}): ${text}`)
  }
  const json = await res.json()
  cachedToken     = json.access_token
  cachedExpiresAt = now + (json.expires_in ?? 3600) * 1000
  return cachedToken
}

/**
 * Send an organization invitation via the Auth0 Management API.
 *
 *   POST /api/v2/organizations/{orgId}/invitations
 *
 * Auth0 emails the invitee a link that, when accepted, creates an
 * Auth0 user (or links an existing one) and adds them to the org.
 *
 * @param   {object} args
 * @param   {string} args.orgId         Auth0 organization ID (org_...)
 * @param   {string} args.email         invitee email
 * @param   {string} [args.role]        role to set as app_metadata.role
 * @param   {string} [args.inviterName] shown in the invitation email
 * @param   {number} [args.ttlSec]      invitation lifetime (default 7d)
 * @returns {Promise<{invitation_id, invitation_url, expires_at}>}
 */
export async function inviteUserToOrg({ orgId, email, role, inviterName, ttlSec }) {
  if (!canInvite()) {
    throw new Error('Auth0 invitation not configured (AUTH0_INVITE_CLIENT_ID missing)')
  }
  if (!orgId)  throw new Error('orgId is required')
  if (!email)  throw new Error('email is required')

  const token = await getMgmtToken()

  const res = await fetch(
    `https://${env.AUTH0_DOMAIN}/api/v2/organizations/${encodeURIComponent(orgId)}/invitations`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        inviter:                { name: inviterName || 'Macaroonie' },
        invitee:                { email },
        client_id:              env.AUTH0_INVITE_CLIENT_ID,
        ttl_sec:                ttlSec ?? 7 * 24 * 60 * 60,
        send_invitation_email:  true,
        ...(role ? { app_metadata: { role } } : {}),
      }),
    },
  )

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    let parsed
    try { parsed = JSON.parse(text) } catch { /* not json */ }
    const msg = parsed?.message || parsed?.error_description || text || `HTTP ${res.status}`
    const err = new Error(`Auth0 invitation failed: ${msg}`)
    err.status      = res.status
    err.auth0Detail = parsed ?? text
    throw err
  }

  return res.json()
}

/**
 * Remove a user from an Auth0 organization. Used by DELETE /team/:userId
 * when we have the user's auth0_user_id. Best-effort — failures are
 * surfaced but don't roll back the local deactivation.
 */
export async function removeUserFromOrg({ orgId, auth0UserId }) {
  if (!isConfigured()) {
    throw new Error('Auth0 Management API not configured')
  }
  if (!orgId || !auth0UserId) throw new Error('orgId and auth0UserId required')

  const token = await getMgmtToken()
  const res = await fetch(
    `https://${env.AUTH0_DOMAIN}/api/v2/organizations/${encodeURIComponent(orgId)}/members`,
    {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ members: [auth0UserId] }),
    },
  )
  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => '')
    throw new Error(`Auth0 member removal failed (${res.status}): ${text}`)
  }
}

/**
 * Patch app_metadata on an Auth0 user — used to keep role in sync
 * between our DB and the JWT claims. The Auth0 Login Action reads
 * `app_metadata.role` and injects it as a custom claim on every login.
 *
 * Auth0 deep-merges the supplied fields, so passing { role: 'admin' }
 * leaves other app_metadata keys intact.
 */
export async function updateUserAppMetadata({ auth0UserId, appMetadata }) {
  if (!isConfigured()) {
    throw new Error('Auth0 Management API not configured')
  }
  if (!auth0UserId) throw new Error('auth0UserId required')

  const token = await getMgmtToken()
  const res = await fetch(
    `https://${env.AUTH0_DOMAIN}/api/v2/users/${encodeURIComponent(auth0UserId)}`,
    {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ app_metadata: appMetadata }),
    },
  )
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Auth0 user patch failed (${res.status}): ${text}`)
  }
  return res.json()
}

/**
 * Send a password change email to a user — used by /team/:userId/reset-password
 * so operators can trigger a reset without touching the Auth0 dashboard.
 *
 * Auth0 sends an email with a one-time link to set a new password.
 */
export async function sendPasswordResetEmail({ email, connection }) {
  if (!env.AUTH0_DOMAIN) throw new Error('AUTH0_DOMAIN missing')
  if (!email) throw new Error('email required')

  // The /dbconnections/change_password endpoint does not need a Mgmt API
  // token — it is part of the Authentication API and works with the
  // SPA client_id (same one used for invitations).
  const clientId = env.AUTH0_INVITE_CLIENT_ID
  if (!clientId) throw new Error('AUTH0_INVITE_CLIENT_ID required for password reset')

  const res = await fetch(`https://${env.AUTH0_DOMAIN}/dbconnections/change_password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id:  clientId,
      email,
      connection: connection || 'Username-Password-Authentication',
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Auth0 password reset failed (${res.status}): ${text}`)
  }
  // Endpoint returns a plain-text confirmation, not JSON.
  return { ok: true }
}
