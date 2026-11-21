// Sign-in rules that need no React Native (auth.js does the sign-in itself
// with expo-auth-session): Auth0's endpoints, reading a token's claims, when
// to refresh, and who is signed in. Tested in test/authCore.test.mjs.

export const SCOPES = ['openid', 'profile', 'email', 'offline_access']
export const REFRESH_KEY = 'macaroonie.office.refresh'
// Refresh this long before the access token runs out.
export const EARLY_SECS = 120

export function discoveryFor(domain) {
  const base = 'https://' + String(domain).replace(/^https?:\/\//, '').replace(/\/+$/, '')
  return {
    authorizationEndpoint: base + '/authorize',
    tokenEndpoint: base + '/oauth/token',
    revocationEndpoint: base + '/oauth/revoke',
    endSessionEndpoint: base + '/v2/logout',
  }
}

/** A JWT's claims (no checking: the API checks the token itself), or null. */
export function claimsOf(token) {
  try {
    const part = String(token).split('.')[1]
    if (!part) return null
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (part.length % 4)) % 4)
    const text = typeof atob === 'function' ? decodeURIComponent(escape(atob(b64))) : Buffer.from(b64, 'base64').toString('utf8')
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** Whether tokens ({ accessToken, issuedAt, expiresIn }) need refreshing at `now` (seconds). */
export function needsRefresh(tokens, now = Math.floor(Date.now() / 1000)) {
  if (!tokens?.accessToken) return true
  if (!tokens.expiresIn) {
    const exp = claimsOf(tokens.accessToken)?.exp
    return !exp || exp - EARLY_SECS <= now
  }
  return (tokens.issuedAt || 0) + tokens.expiresIn - EARLY_SECS <= now
}

/** The person signed in, from the id token: { sub, email, name } or null. */
export function userOf(idToken) {
  const c = claimsOf(idToken)
  if (!c?.sub) return null
  return { sub: c.sub, email: c.email || null, name: c.name || c.nickname || c.email || null, picture: c.picture || null }
}
