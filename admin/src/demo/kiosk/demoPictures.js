// src/demo/kiosk/demoPictures.js
//
// The visitor's own pictures in the kiosk designer demo: kept in this
// browser's Cache Storage under /site/demo/my/<id>.webp and answered from
// there by the demo's service worker (public-demo/pictures-sw.js, scope
// /site/demo/, so the kiosk in the preview frame sees them too). Nothing is
// uploaded. A short path, not a data: URL, because the kiosk's design rules
// (normaliseDesign() in shared/kiosk.js) take only http(s) addresses and
// paths, and so a design in localStorage stays small.

const CACHE = 'kiosk-demo-pictures'
const BASE = import.meta.env.BASE_URL || '/site/demo/kiosk-designer/'
const SCOPE = '/site/demo/'
export const MINE = '/site/demo/my/'

let ready = null

/** The worker in charge of this page (registered once); rejects where a browser has none (a private window). */
export function picturesReady() {
  if (ready) return ready
  ready = (async () => {
    if (!('serviceWorker' in navigator) || !('caches' in window)) throw new Error('no worker')
    await navigator.serviceWorker.register(BASE + 'pictures-sw.js', { scope: SCOPE })
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) {
      await new Promise(resolve => {
        navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true })
        setTimeout(resolve, 3000)
      })
    }
    if (!navigator.serviceWorker.controller) throw new Error('no worker')
    // A kiosk frame that opened before the worker took over (the first visit)
    // would ask the server for the pictures: open it again under the worker.
    for (const f of document.querySelectorAll('iframe')) {
      try {
        const w = f.contentWindow
        if (w && w.location.pathname.startsWith(SCOPE) && !w.navigator.serviceWorker?.controller) w.location.reload()
      } catch { /* not ours */ }
    }
  })()
  ready.catch(() => { ready = null })
  return ready
}

/** Keeps a picture (a Blob) and gives its address. */
export async function keepPicture(id, blob) {
  await picturesReady()
  const path = MINE + id + '.webp'
  const cache = await caches.open(CACHE)
  await cache.put(path, new Response(blob, { headers: { 'Content-Type': blob.type || 'image/webp' } }))
  return path
}

export async function forgetPicture(url) {
  try { await (await caches.open(CACHE)).delete(url) } catch { /* not kept */ }
}

export async function forgetAllPictures() {
  try { await caches.delete(CACHE) } catch { /* none */ }
}
