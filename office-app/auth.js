// Signing in to Macaroonie Office: Auth0 in the phone's own browser (a
// Custom Tab, through expo-auth-session with PKCE), never inside the web
// view, where Google refuses to sign in. The refresh token is kept in the
// phone's secure store, so the app stays signed in; the access token lives
// in memory and is refreshed shortly before it runs out. The pages get it
// through the bridge (auth.token), as the office gets its own from Auth0.
import * as AuthSession from 'expo-auth-session'
import * as WebBrowser from 'expo-web-browser'
import * as SecureStore from 'expo-secure-store'
import { discoveryFor, needsRefresh, userOf, SCOPES, REFRESH_KEY } from './authCore'

WebBrowser.maybeCompleteAuthSession()

export function createAuth({ domain, clientId, audience, scheme }) {
  const discovery = discoveryFor(domain)
  const redirectUri = AuthSession.makeRedirectUri({ scheme, path: 'callback' })
  let tokens = null   // { accessToken, idToken, refreshToken, issuedAt, expiresIn }
  let refreshing = null

  async function keep(t) {
    tokens = { accessToken: t.accessToken, idToken: t.idToken || tokens?.idToken || null,
      refreshToken: t.refreshToken || tokens?.refreshToken || null, issuedAt: t.issuedAt, expiresIn: t.expiresIn }
    if (tokens.refreshToken) await SecureStore.setItemAsync(REFRESH_KEY, tokens.refreshToken)
    return tokens
  }

  /** Signs in through the browser; resolves with the person, or null if they backed out. */
  async function signIn() {
    const request = new AuthSession.AuthRequest({
      clientId, redirectUri, scopes: SCOPES, usePKCE: true,
      extraParams: { audience },
    })
    const result = await request.promptAsync(discovery)
    if (result.type !== 'success') return null
    const t = await AuthSession.exchangeCodeAsync({
      clientId, code: result.params.code, redirectUri,
      extraParams: { code_verifier: request.codeVerifier },
    }, discovery)
    await keep(t)
    return userOf(tokens.idToken)
  }

  /** The kept refresh token turned into fresh tokens; null when there is none or it no longer works. */
  async function restore() {
    const refreshToken = tokens?.refreshToken || await SecureStore.getItemAsync(REFRESH_KEY)
    if (!refreshToken) return null
    try {
      const t = await AuthSession.refreshAsync({ clientId, refreshToken, extraParams: { audience } }, discovery)
      await keep({ ...t, refreshToken: t.refreshToken || refreshToken })
      return userOf(tokens.idToken)
    } catch {
      await SecureStore.deleteItemAsync(REFRESH_KEY).catch(() => {})
      tokens = null
      return null
    }
  }

  /** A current access token, refreshed first when it is about to run out. */
  async function token() {
    if (tokens && !needsRefresh(tokens)) return tokens.accessToken
    refreshing = refreshing || restore().finally(() => { refreshing = null })
    await refreshing
    if (!tokens?.accessToken) throw new Error('Signed out. Sign in again in the app.')
    return tokens.accessToken
  }

  async function signOut() {
    const refreshToken = tokens?.refreshToken || await SecureStore.getItemAsync(REFRESH_KEY)
    tokens = null
    await SecureStore.deleteItemAsync(REFRESH_KEY).catch(() => {})
    if (refreshToken) AuthSession.revokeAsync({ clientId, token: refreshToken }, discovery).catch(() => {})
    // End Auth0's own session too, so the next sign-in asks who it is.
    await WebBrowser.openAuthSessionAsync(
      discovery.endSessionEndpoint + '?client_id=' + encodeURIComponent(clientId) + '&returnTo=' + encodeURIComponent(redirectUri),
      redirectUri,
    ).catch(() => {})
  }

  return { signIn, restore, token, signOut, user: () => userOf(tokens?.idToken), redirectUri }
}
