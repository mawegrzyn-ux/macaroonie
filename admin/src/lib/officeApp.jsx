// src/lib/officeApp.jsx
//
// The admin's pages inside the Macaroonie Office app (office-app/,
// OUTSTANDING 44 item 13). The app signs in natively, through the phone's
// browser (Google refuses sign-in inside an app's web view), then shows the
// phone pages (ops.<domain>/mobile) in a web view and puts a bridge on the
// page before it loads: window.MacaroonieOffice, with
//   auth.token()        the access token, refreshed by the app   -> Promise<string>
//   auth.user()         { sub, email, name }                     -> Promise<object>
//   auth.signOut()      signs out in the app
//   push.token()        the app's Expo push token (lib/push.js)
//   speech.*            the phone's recognition and voice (lib/speech.js)
//   scanner.scan()      the camera's barcode scanner              -> Promise<string|null>
//   platform            'android' | 'ios' (step 6d: the iPhone build)
//
// OfficeAuthProvider stands in for Auth0Provider there: it fills Auth0's own
// context from the bridge, so every useAuth0() (useApi(), TenantGate, the
// shells' sign out) works unchanged.

import { useEffect, useMemo, useState } from 'react'
import { Auth0Context } from '@auth0/auth0-react'

export const officeBridge = () => (typeof window !== 'undefined' ? window.MacaroonieOffice || null : null)
export const inOfficeApp = () => !!officeBridge()?.auth?.token

export function OfficeAuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let live = true
    officeBridge().auth.user()
      .then(u => { if (live) setUser(u || null) })
      .catch(() => { if (live) setUser(null) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [])
  const value = useMemo(() => ({
    isAuthenticated: !!user,
    isLoading: loading,
    user: user || undefined,
    error: undefined,
    getAccessTokenSilently: () => officeBridge().auth.token(),
    getAccessTokenWithPopup: () => officeBridge().auth.token(),
    getIdTokenClaims: async () => user || undefined,
    // Signing in and out happen in the app, outside the page.
    loginWithRedirect: async () => officeBridge().auth.signIn?.(),
    loginWithPopup: async () => officeBridge().auth.signIn?.(),
    logout: () => officeBridge().auth.signOut(),
    handleRedirectCallback: async () => ({}),
    connectAccountWithRedirect: async () => {},
  }), [user, loading])
  return <Auth0Context.Provider value={value}>{children}</Auth0Context.Provider>
}

/** Scans a barcode with the app's camera; null when there is no app or nothing was scanned. */
export async function scanBarcode() {
  const s = officeBridge()?.scanner
  return s?.scan ? s.scan() : null
}
export const canScan = () => !!officeBridge()?.scanner?.scan
