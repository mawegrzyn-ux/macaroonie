// src/demo/kiosk/demoApi.js
//
// The kiosk designer demo's stand-in for src/lib/api.js: the same exports,
// with useApi() answering the routes the designer, the media picker and the
// theme maker call from the demo's own data (demoStore.js) instead of the
// API. vite.demo.config.js puts this module in place of src/lib/api.js for
// the demo build only, so the designer's own code is what runs (rule 12).
// Nothing is sent anywhere: there is no fetch in here.
//
// A route the demo has no answer for is refused the way the API refuses
// (an error with status and body), with words saying why.

import { normaliseDesign } from '@shared/kiosk.js'
import {
  getDemo, setDemo, demoSetup, demoVenue, demoMedia, MAX_UPLOADS, MAX_UPLOAD_BYTES, MAX_SIDE,
} from './demoStore.js'
import { keepPicture, forgetPicture, picturesReady } from './demoPictures.js'

export const DEMO_NOTE = 'In the demo this isn\'t sent anywhere.'
const KIOSK_APP = import.meta.env.VITE_DEMO_KIOSK_APP || '/site/demo/kiosk-app/demo-kiosk.html'

class ApiError extends Error {
  constructor(status, body) {
    super(body?.error ?? `HTTP ${status}`)
    this.status = status
    this.body = body
  }
}
const refuse = (error, status = 400) => { throw new ApiError(status, { error }) }

// The few site-wide colours the colour picker offers as swatches.
const ME = {
  role: 'owner', is_platform_admin: false, full_name: 'Demo visitor', email: null,
  permissions: { pos_setup: 'manage', menus: 'manage', website: 'manage', screens: 'manage' },
  site_theme: { primary: '#0b5d7a', accent: '#f2b134', background: '#f4f1ea', surface: '#ffffff', text: '#12263a', muted: '#5b6b7a' },
}
const AI_STATUS = { configured: false, enabled: false, can_chat: false }
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2))

function designRow(d) { return { id: d.id, name: d.name, settings: d.settings, share: null } }

function saveDesign(id, body) {
  const name = String(body?.name || '').trim().slice(0, 80)
  if (!name) refuse('Give the design a name')
  const settings = normaliseDesign(body?.settings || {})
  const row = { id, name, settings, share: null }
  setDemo(s => ({ designs: [...s.designs.filter(x => x.id !== id), row] }))
  return designRow(row)
}

function mediaList(query) {
  const q = new URLSearchParams(query || '')
  const kind = q.get('kind')
  // Only pictures: the demo has no videos of its own and takes none.
  if (kind === 'video') return []
  return demoMedia()
}

// A picture from the visitor's computer: drawn smaller on a canvas (so only
// a picture goes in, never the file as it came) and kept in this browser
// (demoPictures.js), never sent anywhere.
async function shrink(file) {
  if (!/^image\/(png|jpeg|webp|gif|avif)$/.test(file?.type || '')) refuse('In the demo you can add a JPEG, PNG, WebP or GIF picture.')
  if (file.size > 15 * 1024 * 1024) refuse('That picture is over 15 MB: pick a smaller one.')
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = () => reject(new ApiError(400, { error: 'That picture couldn\'t be read. Try another one.' }))
      i.src = url
    })
    const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight))
    const w = Math.max(1, Math.round(img.naturalWidth * k))
    const h = Math.max(1, Math.round(img.naturalHeight * k))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d').drawImage(img, 0, 0, w, h)
    // WebP keeps a cut-out's see-through background; smaller until it fits.
    for (const quality of [0.86, 0.75, 0.62, 0.5]) {
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality))
      if (blob && blob.size <= MAX_UPLOAD_BYTES) return { blob, w, h }
    }
    refuse('That picture is too detailed to keep in the demo. Try a smaller one.')
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function upload(path, file) {
  if (path !== '/media/items/upload') refuse(DEMO_NOTE)
  if (getDemo().uploads.length >= MAX_UPLOADS) refuse('The demo keeps up to ' + MAX_UPLOADS + ' of your pictures: delete one in the picker first.')
  try { await picturesReady() } catch { refuse('This browser can\'t keep your own pictures here (a private window, perhaps). The demo\'s own pictures still work.') }
  const { blob, w, h } = await shrink(file)
  const id = newId()
  const url = await keepPicture(id, blob)
  const item = {
    id: 'upload-' + id, filename: String(file.name || 'Picture').slice(0, 120), url, mimetype: blob.type || 'image/webp', kind: 'image',
    width: w, height: h, bytes: blob.size, scope: 'kiosk', category_id: null, category_name: null,
    created_at: new Date().toISOString(),
  }
  setDemo(s => ({ uploads: [item, ...s.uploads] }))
  return item
}

async function call(method, path, body) {
  const [route, query] = path.split('?')
  const p = route.split('/').filter(Boolean)
  const s = getDemo()
  if (method === 'GET') {
    if (route === '/me') return ME
    if (route === '/venues') return [{ id: demoVenue.id, name: demoVenue.name, timezone: 'Europe/London' }]
    if (p[0] === 'pos' && p[1] === 'venues' && p[3] === 'setup') return demoSetup()
    if (route === '/pos/kiosk-designs') return s.designs.map(designRow)
    if (route === '/media/categories') return []
    if (route === '/media/items/scopes') return ['kiosk']
    if (route === '/media/items') return mediaList(query)
    if (route === '/ai/status') return AI_STATUS
    if (route === '/website/tenant-site') return {}
  }
  if (method === 'POST') {
    if (route === '/pos/kiosk-designs') return saveDesign(newId(), body)
    if (p[0] === 'pos' && p[1] === 'kiosk-designs' && p[3] === 'preview') {
      return { url: new URL(KIOSK_APP, location.href).href, token: 'demo', menus_changed: [], unpriced: [] }
    }
    if (route === '/media/items/check-duplicate') return []
  }
  if (method === 'PUT' && p[0] === 'pos' && p[1] === 'kiosk-designs' && p.length === 3) {
    if (!s.designs.some(d => d.id === p[2])) refuse('Kiosk design not found', 404)
    return saveDesign(p[2], body)
  }
  if (p[0] === 'media' && p[1] === 'items' && p[2] && (method === 'DELETE' || method === 'PATCH')) {
    const item = s.uploads.find(x => x.id === p[2])
    if (!item) refuse('The demo\'s own pictures stay: only pictures you added can be changed or deleted.')
    if (method === 'DELETE') {
      setDemo(x => ({ uploads: x.uploads.filter(u => u.id !== item.id) }))
      forgetPicture(item.url)
      return null
    }
    const filename = String(body?.filename || item.filename).slice(0, 120)
    setDemo(x => ({ uploads: x.uploads.map(u => (u.id === item.id ? { ...u, filename } : u)) }))
    return { ...item, filename }
  }
  if (p[0] === 'pos' && p[1] === 'kiosk-designs' && p[3] === 'share') {
    refuse(DEMO_NOTE + ' A share link sends the design to people outside your group: it needs a Macaroonie account.')
  }
  refuse(DEMO_NOTE)
}

const API = {
  get: path => call('GET', path),
  post: (path, body) => call('POST', path, body),
  patch: (path, body) => call('PATCH', path, body),
  put: (path, body) => call('PUT', path, body),
  delete: (path, body) => call('DELETE', path, body),
  upload: (path, file) => upload(path, file),
  download: async () => refuse(DEMO_NOTE),
  blob: async () => refuse(DEMO_NOTE),
  postBlob: async () => refuse(DEMO_NOTE),
  postDownload: async () => refuse(DEMO_NOTE),
  stream: async () => refuse(DEMO_NOTE),
}

export function useApi() { return API }
export async function publicGet() { return refuse(DEMO_NOTE) }
export function getSelectedTenant() { return null }
export function setSelectedTenant() {}
export function getPlatformTenantOverride() { return null }
export function setPlatformTenantOverride() {}
