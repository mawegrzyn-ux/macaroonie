// src/demo/kiosk/demoStore.js
//
// What the kiosk designer demo (macaroonie.com/try/kiosk) keeps: the
// visitor's designs, the pictures they added and the pictures they gave
// dishes. In memory, and in this browser's localStorage so a reload keeps
// them (try/catch: a private window or a full store just keeps them in
// memory). Nothing ever leaves the browser.
//
// The menu, venue and order types are fixed (demoData.json, made by
// api/test/tools/kiosk-demo-data.mjs); pictures in it are /demo-img/<name>.svg,
// swapped for the built-in set by withPictures().

import { normaliseDesign } from '@shared/kiosk.js'
import data from './demoData.json'
import { pictureUrl, BUILT_IN } from './pictures.js'

const KEY = 'maca_kiosk_demo_v1'
// Pictures a visitor adds: at most this many, each at most this long once
// made smaller (a data: URL, about 1.37 characters a byte).
export const MAX_UPLOADS = 8
export const MAX_UPLOAD_CHARS = 300_000
export const MAX_SIDE = 900

const listeners = new Set()
let state = load()

function blank() {
  return {
    designs: [{ id: data.design.id, name: data.design.name, settings: withPictures(data.design.settings), share: null }],
    uploads: [],   // [{ id, filename, url, mimetype, width, height, bytes, created_at }]
    dishPics: {},  // { item id: url | null }: the visitor's own picture for a dish
    note: null,    // why the last change couldn't be kept after a reload
  }
}

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (raw && Array.isArray(raw.designs) && raw.designs.length) {
      return { ...blank(), ...raw, designs: raw.designs.map(d => ({ ...d, settings: normaliseDesign(d.settings) })), note: null }
    }
  } catch { /* private mode, or a broken copy: start again */ }
  return blank()
}

function save() {
  try {
    const { note, ...keep } = state // eslint-disable-line no-unused-vars
    localStorage.setItem(KEY, JSON.stringify(keep))
    if (state.note) state = { ...state, note: null }
  } catch {
    state = { ...state, note: 'This browser can\'t keep any more: your changes stay until you close the page.' }
  }
}

export function getDemo() { return state }
export function subscribeDemo(fn) { listeners.add(fn); return () => listeners.delete(fn) }

export function setDemo(patch) {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
  save()
  for (const l of listeners) l()
}

/** Back to the design and pictures the demo starts with. */
export function resetDemo() {
  try { localStorage.removeItem(KEY) } catch { /* nothing kept */ }
  state = blank()
  for (const l of listeners) l()
}

/** Every /demo-img/ picture in a value swapped for the built-in set's address. */
export function withPictures(value) {
  return JSON.parse(JSON.stringify(value), (k, v) => (typeof v === 'string' && v.startsWith('/demo-img/') ? pictureUrl(v) : v))
}

const MENU = withPictures({ setup: data.setup, config: data.config })

/** The dish's picture: the visitor's, else the menu's. */
function dishPicture(item) {
  const own = state.dishPics[item.id]
  return own === undefined ? item.image_url ?? null : own
}

/** Store tech's setup for the venue, with the visitor's dish pictures. */
export function demoSetup() {
  return {
    ...MENU.setup,
    items: MENU.setup.items.map(i => ({ ...i, image_url: dishPicture(MENU.config.items[i.id] || i) })),
    kiosk_designs: state.designs.map(d => ({ id: d.id, name: d.name })),
  }
}

/** The kiosk's config (without its design, which the designer sends), with the visitor's dish pictures. */
export function demoConfig() {
  const items = Object.fromEntries(Object.entries(MENU.config.items).map(([id, it]) => [id, { ...it, image_url: dishPicture(it) }]))
  return { ...MENU.config, items }
}

/** The dishes for the Dish pictures list: [{ id, name, section, image_url, menu_url }]. */
export function demoDishes() {
  const sections = Object.fromEntries(MENU.config.menus.flatMap(m => m.sections).map(s => [s.id, s.title]))
  return MENU.config.menus.flatMap(m => m.sections).flatMap(s => s.item_ids.map(id => MENU.config.items[id]))
    .map(it => ({ id: it.id, name: it.name, section: sections[it.section_id] || '', image_url: dishPicture(it), menu_url: it.image_url ?? null }))
}

export const demoVenue = data.venue

/** The pictures the media picker shows: the visitor's first, then the built-in set. */
export function demoMedia() {
  return [...state.uploads, ...BUILT_IN]
}
