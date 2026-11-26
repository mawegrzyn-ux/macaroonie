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
//   camera.permission() asks for the camera once                  -> Promise<boolean>
//   share.take(), share.onShared(fn)  what was shared to the app (below)
//   platform            'android' | 'ios' (step 6d: the iPhone build)
//
// OfficeAuthProvider stands in for Auth0Provider there: it fills Auth0's own
// context from the bridge, so every useAuth0() (useApi(), TenantGate, the
// shells' sign out) works unchanged.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

// A photo input's capture attribute (photoCapture()): in a browser the
// camera opens straight away. Inside the app it does so only once the app
// has the camera: Android refuses the camera to an app that declares it until
// it is granted, so a Photo button did nothing at all (25 Nov 2026). The app
// is asked once, when the page loads; until it says yes, or in a build of the
// app without camera.permission, a photo input opens the phone's picker
// (camera or gallery) instead.
let cameraOk = null
if (typeof window !== 'undefined') {
  const ask = officeBridge()?.camera?.permission
  if (ask) Promise.resolve().then(ask).then(ok => { cameraOk = !!ok }, () => { cameraOk = false })
}
export const photoCapture = () => (!officeBridge() ? 'environment' : cameraOk ? 'environment' : undefined)

// Sharing to the app (26 Nov 2026): a picture shared from the gallery (or a
// link or a note from another app) waits in the app (office-app/shareCore.js)
// until the phone hub takes it into Capture. Builds of the app made before
// this have no share part: everything here is feature-detected, so the page
// works the same in them and in a browser.
//   share.take()       the waiting item, once -> Promise<{ kind: 'image', name, type, dataBase64, more } | { kind: 'text', text } | { kind: 'refused', message } | null>
//   share.onShared(fn) fn() when something arrives while the page is open -> unsubscribe
export const SHARED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
const SHARED_MAX_BASE64 = Math.ceil(6 * 1024 * 1024 * 4 / 3)   // above the server's 5 MB photo limit; the app sends 5 MB at most
const NOT_KEPT = 'Capture keeps a photo or a few words. That was another kind of file, so it wasn\'t kept.'

export const canTakeShared = () => typeof officeBridge()?.share?.take === 'function'

/** Listens for a share arriving while the page is open; a no-op outside the app or in an older build. */
export function onShared(fn) {
  const on = officeBridge()?.share?.onShared
  return typeof on === 'function' ? on(fn) || (() => {}) : () => {}
}

/** What the app handed over, for Capture: { kind: 'image', file, more } | { kind: 'text', text } | { kind: 'refused', message } | null. */
export function sharedItem(got) {
  if (!got || typeof got !== 'object') return null
  if (got.kind === 'text') {
    const text = typeof got.text === 'string' ? got.text.trim().slice(0, 2000) : ''
    return text ? { kind: 'text', text } : null
  }
  if (got.kind === 'image') {
    const data = typeof got.dataBase64 === 'string' ? got.dataBase64 : ''
    if (!SHARED_TYPES.includes(got.type) || !data || data.length > SHARED_MAX_BASE64) return { kind: 'refused', message: NOT_KEPT }
    try {
      const bin = atob(data)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const name = (typeof got.name === 'string' && got.name.trim().slice(0, 100)) || 'shared-picture.jpg'
      return { kind: 'image', file: new File([bytes], name, { type: got.type }), more: Math.max(0, Number(got.more) || 0) }
    } catch {
      return { kind: 'refused', message: 'That picture couldn\'t be read. Try Photo or From phone instead.' }
    }
  }
  if (got.kind === 'refused') return { kind: 'refused', message: (typeof got.message === 'string' && got.message.slice(0, 300)) || NOT_KEPT }
  return null
}

/** Takes the waiting item from the app, once; null when there is none (or no app). */
export async function takeShared() {
  if (!canTakeShared()) return null
  try {
    return sharedItem(await officeBridge().share.take())
  } catch {
    return null
  }
}

/**
 * The phone hub's side: once ready (signed in, the person's permissions
 * known), takes what was shared, now and whenever something arrives while
 * the hub is open. Returns [item, clear].
 */
export function useSharedItem(ready) {
  const [item, setItem] = useState(null)
  const taking = useRef(false)
  useEffect(() => {
    if (!ready || !canTakeShared()) return undefined
    const take = () => {
      if (taking.current) return
      taking.current = true
      takeShared().then(got => { if (got) setItem({ ...got, key: Date.now() }) }).finally(() => { taking.current = false })
    }
    take()
    return onShared(take)
  }, [ready])
  return [item, useCallback(() => setItem(null), [])]
}

/** The phone shell's side: a share arriving on any other phone page goes to the hub, which takes it. */
export function useSharedGoesToHub(isHub, goToHub) {
  const where = useRef({ isHub, goToHub })
  where.current = { isHub, goToHub }
  useEffect(() => onShared(() => { if (!where.current.isHub) where.current.goToHub() }), [])
}

