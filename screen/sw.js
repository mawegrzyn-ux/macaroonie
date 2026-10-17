// The menu screens' service worker (served by api/src/routes/screenSite.js,
// which writes the player version in below).
//
//   the player itself (pages, player.js, /lib, manifest, icons)
//       network first, so a screen that's online always runs the latest
//       player; the cached copy when offline, so a screen restarted without
//       internet still starts and shows its last boards
//   images (uploads, other sites) and Google Fonts
//       cache first: they never change at the same address
//   videos (migration 167)
//       the player sends the list its boards play ({ type: 'videos', urls });
//       each is downloaded whole into its own cache, videos no board plays
//       any more are let go. A video element asks for byte ranges, which a
//       cache can't store, so they are cut from the whole copy here; until
//       the copy is there the video plays from the network
//   /screen-api and the socket
//       never cached here (the player keeps its last config itself)

const VERSION = '__PLAYER_VERSION__'
const SHELL = 'screen-shell-' + VERSION
const MEDIA = 'screen-media-v1'
const MEDIA_MAX = 400
const VIDEO = 'screen-video-v1'
const VIDEO_RE = /\.(mp4|webm|m4v)(?:$|[?#])/i
const SHELL_FILES = [
  '/', '/player.js', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png',
  '/lib/screenLayout.js', '/lib/fonts.js', '/lib/menuTags.js', '/lib/orderPricing.js', '/lib/promotions.js', '/lib/menuSchedule.js',
  '/lib/combos.js',
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

// ── Videos ───────────────────────────────────────────────────────

const fetching = new Map()
function keyOf(url) { const u = new URL(url); u.hash = ''; return u.href }

// The whole file, once, into the video cache.
function warm(url) {
  const key = keyOf(url)
  if (fetching.has(key)) return fetching.get(key)
  const job = (async () => {
    const cache = await caches.open(VIDEO)
    if (await cache.match(key)) return
    const res = await fetch(key, { mode: new URL(key).origin === self.location.origin ? 'same-origin' : 'cors', credentials: 'omit' })
    if (res.ok && res.status === 200) await cache.put(key, res)
  })().catch(() => {}).finally(() => fetching.delete(key))
  fetching.set(key, job)
  return job
}

async function keepVideos(urls) {
  const want = new Set(urls.map(keyOf))
  const cache = await caches.open(VIDEO)
  for (const req of await cache.keys()) if (!want.has(keyOf(req.url))) await cache.delete(req)
  // One at a time: a screen's connection is shared with what it shows.
  for (const u of want) await warm(u)
}

// A video request: the bytes asked for, cut from the cached copy.
async function videoResponse(req) {
  const key = keyOf(req.url)
  const cache = await caches.open(VIDEO)
  const hit = await cache.match(key)
  if (!hit) {
    warm(key)
    return fetch(req)
  }
  const blob = await hit.blob()
  const type = hit.headers.get('Content-Type') || 'video/mp4'
  const size = blob.size
  const range = req.headers.get('Range')
  const m = range && /bytes=(\d*)-(\d*)/.exec(range)
  if (!m || (!m[1] && !m[2])) {
    return new Response(blob, { status: 200, headers: { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' } })
  }
  let start, end
  if (!m[1]) { start = Math.max(0, size - Number(m[2])); end = size - 1 }   // the last n bytes
  else { start = Number(m[1]); end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1 }
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } })
  }
  const part = blob.slice(start, end + 1)
  return new Response(part, {
    status: 206,
    headers: {
      'Content-Type': type, 'Content-Length': String(part.size), 'Accept-Ranges': 'bytes',
      'Content-Range': 'bytes ' + start + '-' + end + '/' + size,
    },
  })
}

self.addEventListener('message', event => {
  const m = event.data || {}
  if (m.type === 'videos' && Array.isArray(m.urls)) {
    event.waitUntil(keepVideos(m.urls.filter(u => typeof u === 'string' && /^https?:/.test(u)).slice(0, 50)))
  }
})

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

  if (req.destination === 'video' || VIDEO_RE.test(url.pathname)) { event.respondWith(videoResponse(req)); return }
  if (same && url.pathname.startsWith('/uploads/')) { event.respondWith(cacheFirst(req)); return }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') { event.respondWith(cacheFirst(req)); return }
  if (!same && req.destination === 'image') { event.respondWith(cacheFirst(req)); return }
  if (!same) return

  if (req.mode === 'navigate') { event.respondWith(networkFirst(req, '/')); return }
  event.respondWith(networkFirst(req))
})
