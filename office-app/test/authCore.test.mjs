// Sign-in rules (authCore.js): Auth0's endpoints, a token's claims, refreshing early.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { discoveryFor, claimsOf, needsRefresh, userOf, SCOPES, EARLY_SECS } from '../authCore.js'

const jwt = claims => 'h.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.s'

test('Auth0\'s endpoints, and offline access for a refresh token', () => {
  const d = discoveryFor('https://obscurekitty.uk.auth0.com/')
  assert.equal(d.authorizationEndpoint, 'https://obscurekitty.uk.auth0.com/authorize')
  assert.equal(d.tokenEndpoint, 'https://obscurekitty.uk.auth0.com/oauth/token')
  assert.ok(SCOPES.includes('offline_access'))
})

test('who is signed in, from the id token', () => {
  assert.deepEqual(userOf(jwt({ sub: 'auth0|1', email: 'jo@x.test', name: 'Jo' })), { sub: 'auth0|1', email: 'jo@x.test', name: 'Jo', picture: null })
  assert.equal(userOf('nonsense'), null)
  assert.equal(claimsOf(jwt({ name: 'Zoë' })).name, 'Zoë', 'non-ASCII names read right')
})

test('the access token is refreshed before it runs out', () => {
  const now = 1_000_000
  assert.equal(needsRefresh(null, now), true)
  assert.equal(needsRefresh({ accessToken: 'a', issuedAt: now, expiresIn: 3600 }, now), false)
  assert.equal(needsRefresh({ accessToken: 'a', issuedAt: now - 3600 + EARLY_SECS - 1, expiresIn: 3600 }, now), true)
  assert.equal(needsRefresh({ accessToken: jwt({ exp: now + 600 }) }, now), false, 'from the token when no lifetime was given')
  assert.equal(needsRefresh({ accessToken: jwt({ exp: now + 60 }) }, now), true)
})
