// shared/pos/kitchenColours.js
//
// Kitchen screen colours (Store tech > Kitchen screens > Ticket colours,
// pos_settings.kds_colours, migration 207): the background a dish row and a
// ticket's top take in each state, the timer's amber and late colours, and
// dish names coloured by their menu section. ONE implementation used by:
//   - the API: what is saved (normaliseKitchenColours()) and the kitchen
//     screen's config, where section names become section ids
//     (sectionColoursById(), kdsConfig() in api/src/services/kitchenSvc.js)
//   - the kitchen screen and the test bench (pos/src/kitchen/KitchenApp.jsx):
//     ticketColours() and sectionColour()
//   - the admin's preview ticket (components/pos/KitchenColours.jsx)
//
// Saved: { states: { [key]: '#rrggbb' }, sections: [{ name, colour }] }.
// A state not set keeps the standard look (KITCHEN_COLOURS' bg and ink); a
// colour that is set gets black or white words, whichever reads better.
// Sections go by name (case and spaces ignored), so "Sides" in every menu
// takes the one colour, and a copied or new menu keeps it.

// dim: how strongly a dish row's words show in that state (ticked off and on
// its way read as quieter); customDim: the same once a colour is set (held
// rows are dim grey words in the standard look).
export const KITCHEN_COLOURS = [
  { key: 'todo', group: 'dish', label: 'To do', hint: 'A dish still to make here, or to tick off at the pass.', bg: '#0e6b33', ink: '#ffffff', dim: 1 },
  { key: 'ticked', group: 'dish', label: 'Ticked off', hint: 'Done at a prep station; ticked off at the pass or by a runner.', bg: '#0d371e', ink: '#ffffff', dim: 0.55 },
  { key: 'upcoming', group: 'dish', label: 'On its way', hint: 'Still at an earlier station (stations that show dishes before they arrive).', bg: '#163d27', ink: '#ffffff', dim: 0.75 },
  { key: 'held', group: 'dish', label: 'Held', hint: 'Its course hasn\'t been fired yet.', bg: '#27272a', ink: '#a1a1aa', dim: 1, customDim: 0.65 },
  { key: 'voided', group: 'dish', label: 'Voided', hint: 'Taken off the order (struck through).', bg: '#3b0d0d', ink: '#fca5a5', dim: 1 },
  { key: 'head', group: 'head', label: 'Ticket', hint: 'An order being made.', bg: '#2b7a4b', ink: '#ffffff' },
  { key: 'head_new', group: 'head', label: 'New', hint: 'For 30 seconds after new dishes arrive.', bg: '#8f8a4b', ink: '#ffffff' },
  { key: 'head_rush', group: 'head', label: 'Rush', hint: 'An order made a rush.', bg: '#b45309', ink: '#ffffff' },
  { key: 'head_prepared', group: 'head', label: 'Prepared', hint: 'At the pass or a runner: every dish has reached it.', bg: '#1d9a52', ink: '#ffffff' },
  { key: 'head_checked', group: 'head', label: 'All ticked off', hint: 'At the pass or a runner: every dish ticked off, waiting for READY or DONE.', bg: '#2563eb', ink: '#ffffff' },
  { key: 'timer_warn', group: 'timer', label: 'Amber', hint: 'The timer from the station\'s amber time.', bg: '#fbbf24', ink: '#000000' },
  { key: 'timer_late', group: 'timer', label: 'Late', hint: 'The timer from the station\'s red time.', bg: '#dc2626', ink: '#ffffff' },
]
export const KITCHEN_COLOUR_KEYS = KITCHEN_COLOURS.map(c => c.key)
export const KITCHEN_COLOUR_GROUPS = [
  { key: 'dish', label: 'Dishes' },
  { key: 'head', label: 'Ticket tops' },
  { key: 'timer', label: 'Timer' },
]
export const SECTION_COLOURS_MAX = 100

const HEX = /^#[0-9a-f]{6}$/i
const isHex = v => typeof v === 'string' && HEX.test(v)

/** A section name as matched: case and spaces ignored. */
export const sectionKey = name => String(name ?? '').trim().replace(/\s+/g, ' ').toLowerCase()

/** Black or white, whichever reads better on the colour. */
export function inkOn(hex) {
  if (!isHex(hex)) return '#ffffff'
  const n = parseInt(hex.slice(1), 16)
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
  return lum > 0.6 ? '#000000' : '#ffffff'
}

/** What is saved, cleaned: known states with colour codes, sections by name once each. */
export function normaliseKitchenColours(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}
  const states = {}
  for (const k of KITCHEN_COLOUR_KEYS) if (isHex(r.states?.[k])) states[k] = r.states[k].toLowerCase()
  const sections = []
  const seen = new Set()
  for (const s of Array.isArray(r.sections) ? r.sections : []) {
    const name = String(s?.name ?? '').trim().replace(/\s+/g, ' ').slice(0, 80)
    const key = sectionKey(name)
    if (!key || seen.has(key) || !isHex(s?.colour)) continue
    seen.add(key)
    sections.push({ name, colour: s.colour.toLowerCase() })
    if (sections.length >= SECTION_COLOURS_MAX) break
  }
  return { states, sections }
}

/**
 * The colours a ticket is drawn with, from the kitchen screen's config
 * colours ({ states, sections }): { [key]: { bg, ink, dim, set } }.
 */
export function ticketColours(colours) {
  const states = colours?.states || {}
  const out = {}
  for (const c of KITCHEN_COLOURS) {
    const v = isHex(states[c.key]) ? states[c.key].toLowerCase() : null
    out[c.key] = v
      ? { bg: v, ink: inkOn(v), dim: c.customDim ?? c.dim ?? 1, set: true }
      : { bg: c.bg, ink: c.ink, dim: c.dim ?? 1, set: false }
  }
  return out
}

/** A dish's name colour on the screen: its section's (config colours.sections, by id), or null. */
export function sectionColour(colours, sectionId) {
  const v = sectionId ? colours?.sections?.[sectionId] : null
  return isHex(v) ? v.toLowerCase() : null
}

/**
 * Section colours by section id for a kitchen screen: every section
 * ({ id, title }) whose name is one of the saved ones.
 */
export function sectionColoursById(saved, sections) {
  const want = new Map(normaliseKitchenColours(saved).sections.map(s => [sectionKey(s.name), s.colour]))
  const out = {}
  if (!want.size) return out
  for (const s of sections || []) {
    const c = want.get(sectionKey(s.title))
    if (c && s.id) out[s.id] = c
  }
  return out
}
