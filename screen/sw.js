// The menu screens' service worker (served by api/src/routes/screenSite.js,
// which writes the player version in below).
//
//   the player itself (pages, player.js, /lib, manifest, icons)
//       network first, so a screen that's online always runs the latest
//       player; the cached copy when offline, so a screen restarted without
//       internet still starts and shows its last boards
//   images (uploads, other sites) and Google Fonts
//       cache first: they never change at the same address
//   /screen-api and the socket
//       never cached here (the player keeps its last config itself)

const VERSION = '__PLAYER_VERSION__'
const SHELL = 'screen-shell-' + VERSION
const MEDIA = 'screen-media-v1'
const MEDIA_MAX = 400
const SHELL_FILES = [
  '/', '/player.js', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png',
  '/lib/screenLayout.js', '/lib/fonts.js', '/lib/menuTags.js', '/lib/orderPricing.js', '/lib/promotions.js', '/lib/menuSchedule.js',
]

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).catch(() => {}).then(() => self.skipWaiting()))
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('screen-shell-') && k !== SHELL).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

async function trimMedia() {
  const cache = await caches.open(MEDIA)
  const keys = await cache.keys()
  for (let i = 0; i < keys.length - MEDIA_MAX; i++) await cache.delete(keys[i])
}

async function cacheFirst(req) {
  const cache = await caches.open(MEDIA)
  const hit = await cache.match(req)
  if (hit) return hit
  const res = await fetch(req)
  if (res && (res.ok || res.type === 'opaque')) {
    cache.put(req, res.clone()).then(trimMedia).catch(() => {})
  }
  return res
}

async function networkFirst(req, fallbackPath) {
  const cache = await caches.open(SHELL)
  try {
    const res = await fetch(req)
    if (res && res.ok) cache.put(fallbackPath || req, res.clone()).catch(() => {})
    return res
  } catch (err) {
    const hit = await cache.match(fallbackPath || req, { ignoreSearch: true })
    if (hit) return hit
    throw err
  }
}

self.addEventListener('fetch', event => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  const same = url.origin === self.location.origin
  if (same && (url.pathname.startsWith('/screen-api') || url.pathname.startsWith('/ws'))) return

  if (same && url.pathname.startsWith('/uploads/')) { event.respondWith(cacheFirst(req)); return }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') { event.respondWith(cacheFirst(req)); return }
  if (!same && req.destination === 'image') { event.respondWith(cacheFirst(req)); return }
  if (!same) return

  if (req.mode === 'navigate') { event.respondWith(networkFirst(req, '/')); return }
  event.respondWith(networkFirst(req))
})
