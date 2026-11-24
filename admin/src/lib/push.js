// src/lib/push.js
//
// This device's push notices for the Today tasks (migration 262,
// api/src/services/notices.js). In the Macaroonie Office app the app's own
// push token is used (window.MacaroonieOffice.push); in a browser, a Web
// Push subscription on the admin's service worker (public/push-sw.js),
// signed for the platform's VAPID key. Nothing is sent to the API until the
// person turns notices on for the device, and the browser asks them first.
//
//   pushSupport()            'app' | 'web' | null
//   turnOnHere(api, publicKey, label)   asks, subscribes, registers -> the device row
//   turnOffHere(api, deviceId)          unsubscribes here and removes the row
//   currentSubscription()    this browser's subscription, if any

const bridge = () => (typeof window !== 'undefined' ? window.MacaroonieOffice : null)

export function pushSupport() {
  if (bridge()?.push?.token) return 'app'
  if (typeof window === 'undefined') return null
  return ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window) ? 'web' : null
}

/** base64url -> Uint8Array, for applicationServerKey. */
function keyBytes(base64url) {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4)
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, c => c.charCodeAt(0))
}

async function registration() {
  const reg = await navigator.serviceWorker.getRegistration()
  if (!reg) throw new Error('Notices need the app installed or opened from its own address (no service worker here yet). Reload the page and try again.')
  return reg
}

export async function currentSubscription() {
  if (pushSupport() !== 'web') return null
  try { return await (await registration()).pushManager.getSubscription() } catch { return null }
}

export async function turnOnHere(api, publicKey, label) {
  const kind = pushSupport()
  if (kind === 'app') {
    const token = await bridge().push.token()
    if (!token) throw new Error('The app couldn\'t get a push token. Allow notifications for Macaroonie Office in the phone\'s settings.')
    // The same Expo push token kind on Android and an iPhone (Expo sends to FCM or APNs).
    const phone = bridge().platform === 'ios' ? 'iPhone' : bridge().platform === 'android' ? 'Android' : null
    return api.post('/notices/devices', { kind: 'app', token, label: label || ('Macaroonie Office app' + (phone ? ' on ' + phone : '')) })
  }
  if (kind !== 'web') throw new Error('This browser can\'t show notices.')
  const allowed = await Notification.requestPermission()
  if (allowed !== 'granted') throw new Error('Notices are blocked for this site. Allow them in the browser\'s settings.')
  const reg = await registration()
  const sub = (await reg.pushManager.getSubscription())
    || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) })
  return api.post('/notices/devices', { kind: 'web', token: sub.toJSON(), label: label || browserLabel() })
}

export async function turnOffHere(api, deviceId) {
  if (pushSupport() === 'web') {
    const sub = await currentSubscription()
    try { await sub?.unsubscribe() } catch { /* already gone */ }
  }
  if (deviceId) await api.delete('/notices/devices/' + deviceId)
}

function browserLabel() {
  const ua = navigator.userAgent || ''
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'this device'
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  return br + ' on ' + os
}
