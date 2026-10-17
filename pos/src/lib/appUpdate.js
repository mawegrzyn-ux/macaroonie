// New versions of the app on tills, kitchen screens and kiosks.
//
// The service worker keeps the whole app on the device so it opens with the
// internet down, which also means a device keeps running the copy it started
// with after a deploy until the page is loaded again. A till left open for
// days would never change, and a copy older than a feature can't run it (a
// copy from before kiosks ran a newly paired kiosk as a till).
//
// So the app asks for a new copy every 30 minutes and whenever the screen
// comes back, and once the new copy has taken over it reloads at the first
// quiet moment the screen on show allows: whatever the screen registered last
// with whenSafeToReload() decides (no one signed in on a till, the start
// screen on a kiosk, nobody touching a kitchen screen). Nothing is lost: what
// a device hasn't sent yet is kept on it (IndexedDB).

const CHECK_EVERY = 30 * 60 * 1000

let registration = null
let ready = false
let lastTouch = Date.now()
const checks = []

/** Register the service worker and watch for new copies (production builds only). */
export function startAppUpdates() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  const sw = navigator.serviceWorker
  // The first service worker on a device takes over a page that already runs
  // the newest copy: only a later change means a new version.
  let controlled = !!sw.controller
  sw.addEventListener('controllerchange', () => {
    if (!controlled) { controlled = true; return }
    ready = true
    tryReload()
  })
  sw.register('/sw.js', { scope: '/' }).then(r => { registration = r }).catch(() => { /* no service worker: always online copy */ })
  setInterval(checkForUpdate, CHECK_EVERY)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkForUpdate() })
  window.addEventListener('pointerdown', () => { lastTouch = Date.now() }, true)
  window.addEventListener('keydown', () => { lastTouch = Date.now() }, true)
  setInterval(tryReload, 5000)
}

/** Ask for a new copy now (it installs in the background). */
export function checkForUpdate() {
  if (navigator.onLine === false) return
  registration?.update().catch(() => { /* offline or the server is busy: next time */ })
}

/** True when nobody has touched the screen for ms. */
export const idleFor = ms => Date.now() - lastTouch >= ms

/**
 * The screen on show says when a reload wouldn't disturb anyone. The last
 * one registered counts; call the returned function when it goes away.
 */
export function whenSafeToReload(fn) {
  checks.push(fn)
  return () => {
    const i = checks.lastIndexOf(fn)
    if (i >= 0) checks.splice(i, 1)
  }
}

function tryReload() {
  if (!ready) return
  const safe = checks[checks.length - 1]
  let ok = false
  try { ok = !!safe?.() } catch { ok = false }
  if (!ok) return
  ready = false
  location.reload()
}
