// Every picture the kiosk can show, kept on the device, so the whole menu
// still shows with the internet down, not only the dishes someone happened
// to open. The service worker keeps pictures in its kiosk-images cache as
// they load (pos/vite.config.js); this loads the ones that aren't there yet,
// a few at a time, after each menu change. Same-origin pictures only
// (/uploads/...): the service worker doesn't keep other sites' pictures.
//
// Used by the kiosk store (store.js) only; previews and the kitchen test
// bench have no service worker and never call it.

import { configImages } from '@shared/kiosk.js'

const CACHE = 'kiosk-images'
const AT_ONCE = 3           // pictures loading at the same time
const LOAD_TIMEOUT_MS = 20000

let running = null
let next = null

/**
 * Load every picture in config that the device doesn't have yet. report()
 * gets { total, saved, busy }: saved is null where pictures can't be kept
 * (no service worker, e.g. the dev server). A call while a pass runs is
 * done after it, with the newest config.
 */
export function savePhotos(config, report) {
  next = { config, report }
  if (!running) {
    running = (async () => {
      try {
        while (next) {
          const job = next
          next = null
          await onePass(job.config, job.report)
        }
      } finally {
        running = null
      }
    })()
  }
  return running
}

async function onePass(config, report) {
  const urls = configImages(config, location.origin)
  if (!urls.length) return report({ total: 0, saved: 0, busy: false })
  if (typeof caches === 'undefined' || !(await controlled())) return report({ total: urls.length, saved: null, busy: false })
  const cache = await caches.open(CACHE)
  const kept = async () => new Set((await cache.keys()).map(r => r.url))
  const have = await kept()
  const missing = urls.filter(u => !have.has(u))
  let loaded = urls.length - missing.length
  report({ total: urls.length, saved: loaded, busy: missing.length > 0 })
  if (!missing.length) return
  let i = 0
  const worker = async () => {
    while (i < missing.length) {
      const url = missing[i++]
      if (await load(url)) report({ total: urls.length, saved: ++loaded, busy: true })
    }
  }
  await Promise.all(Array.from({ length: AT_ONCE }, worker))
  // The service worker stores each picture as it arrives: count what is
  // really there (a picture that failed to load isn't).
  await new Promise(r => setTimeout(r, 500))
  const after = await kept()
  report({ total: urls.length, saved: urls.filter(u => after.has(u)).length, busy: false })
}

// The page is controlled by the service worker (the first visit only once it
// has started; it claims the page as soon as it is active).
function controlled() {
  const sw = navigator.serviceWorker
  if (!sw) return Promise.resolve(false)
  if (sw.controller) return Promise.resolve(true)
  return new Promise(resolve => {
    const done = ok => { sw.removeEventListener('controllerchange', on); clearTimeout(timer); resolve(ok) }
    const on = () => done(true)
    sw.addEventListener('controllerchange', on)
    const timer = setTimeout(() => done(!!sw.controller), 60000)
  })
}

// An <img> load, so the service worker sees a picture request and keeps it
// (a fetch() wouldn't match its picture rule).
function load(url) {
  return new Promise(resolve => {
    const img = new Image()
    const done = ok => { clearTimeout(timer); img.onload = img.onerror = null; resolve(ok) }
    const timer = setTimeout(() => done(false), LOAD_TIMEOUT_MS)
    img.onload = () => done(true)
    img.onerror = () => done(false)
    img.decoding = 'async'
    try { img.fetchPriority = 'low' } catch { /* older browsers */ }
    img.src = url
  })
}
