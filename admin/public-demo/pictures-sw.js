// The kiosk designer demo's own pictures (macaroonie.com/try/kiosk): a
// visitor's pictures never leave the browser. The demo keeps each in this
// browser's Cache Storage under /site/demo/my/<id>.webp
// (admin/src/demo/kiosk/demoPictures.js) and this worker answers those
// addresses from there, for the designer and for the kiosk in its preview
// (scope /site/demo/, allowed by the Service-Worker-Allowed header the API
// sends with this file). Every other request goes to the network untouched.
// A design keeps those short addresses, which the kiosk's design rules take
// like any picture path.

const CACHE = 'kiosk-demo-pictures'
const MINE = '/site/demo/my/'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin || !url.pathname.startsWith(MINE) || event.request.method !== 'GET') return
  event.respondWith((async () => {
    const cache = await caches.open(CACHE)
    const hit = await cache.match(url.pathname)
    return hit || new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain' } })
  })())
})
