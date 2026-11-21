// push-sw.js: loaded into the admin's service worker (vite.config.js,
// workbox importScripts). Shows the Today task notices sent by the API
// (services/notices.js, migration 262) and opens the page a notice names
// when it is tapped, in a tab of the app that is already open if there is one.
self.addEventListener('push', event => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch (e) { data = { title: 'Macaroonie', body: event.data && event.data.text() } }
  const title = data.title || 'Macaroonie'
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    tag: data.tag || undefined,
    data: { url: data.url || '/today' },
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
  }))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const path = (event.notification.data && event.notification.data.url) || '/today'
  // On the phone app's own host the Today page is /mobile/today.
  const mobile = /^ops\./.test(self.location.hostname)
  const url = new URL(mobile && path === '/today' ? '/mobile/today' : path, self.location.origin).href
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) {
      if (c.url.startsWith(self.location.origin) && 'focus' in c) { c.navigate(url); return c.focus() }
    }
    return self.clients.openWindow(url)
  }))
})
