// api/src/services/tillSalesGen.js
//
// Test till sales for a past trading day (the Test data page, docs/REPORTS.md
// phase 1c): checks made the way the till makes them. Every change is a till
// event run through the till's own check rules (shared/pos/checks.js
// applyEvent), priced with the venue's till config (shared/pos/pricing.js:
// dishes, options, meal deals), taxed for each check's order type and revenue
// stream (posTax), with the location's charges matrix, its discounts list and
// its promotions (shared/pos/offers.js), so a stored check holds what a real
// till would have stored and every report reads it as it reads real sales.
//
// What a day looks like: orders through the day with a lunch and a dinner
// peak; tables with guests (two rounds, a bill, sometimes split payments and
// tips), counter orders with order numbers, kiosk orders when the venue has
// kiosks; now and then a void, a comp, a discount, an optional charge taken
// off, a promotion, a cancelled order or a refund. People whose role can't do
// something get a manager's approval, as on the till.
//
// Not made: kitchen orders, print jobs, events, loyalty, order flows' prompts
// and dishes, card machine payments (card payments are the hand-entered kind).
//
// Pure: no database and no clock (times come from the day asked for); random
// numbers from a seeded generator, so the same day comes out the same again
// (ids apart). tillTestDataSvc.js loads the config and stores the result.

import { ulid } from '../../../shared/pos/ids.js'
import { applyEvent } from '../../../shared/pos/checks.js'
import { priceItem, posTax, checkTotals, isActiveLine, lineGross, spread, groupChoice } from '../../../shared/pos/pricing.js'
import { configItem, dealItem, checkOffers } from '../../../shared/pos/offers.js'
import { chargesWhere } from '../../../shared/pos/charges.js'
import { discountList, fitsScope } from '../../../shared/pos/discounts.js'
import { has, normalisePermissions, PERMISSION_KEYS, MANAGER_ACTIONS } from '../../../shared/pos/permissions.js'
import { nextNumbers, defaultOrderRange, cleanOrderRange } from '../../../shared/pos/numbers.js'
import { dayFigures } from '../../../shared/pos/reports.js'
import { resolveSteps, askedChoices, isCombo } from '../../../shared/combos.js'
import { menusOnNow } from '../../../shared/menuTimes.js'
import { venueNow } from '../../../shared/promotions.js'
import { kioskStaff } from '../../../shared/kiosk.js'

// ── Random numbers ──────────────────────────────────────────────

function hashText(s) {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

/** A random number generator (0 <= x < 1) that gives the same numbers for the same seed (mulberry32). */
export function seededRandom(seed) {
  let a = hashText(String(seed)) || 1
  return () => {
    a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pick = (list, rng) => list[Math.floor(rng() * list.length)]
const between = (lo, hi, rng) => lo + Math.floor(rng() * (hi - lo + 1))
function weighted(list, rng, w = x => x.weight) {
  let total = 0
  for (const x of list) total += w(x)
  let r = rng() * total
  for (const x of list) { r -= w(x); if (r < 0) return x }
  return list[list.length - 1]
}

// How popular a dish is: fixed by its id, so every day (and every request of
// a long range) sells the same dishes most. A few sell far more than the rest.
const popularity = id => 0.2 + Math.pow(hashText(String(id)) / 4294967296, 3) * 4

// ── How many orders, and when ─────────────────────────────────

// Sunday to Saturday: Fridays and Saturdays busiest, Mondays quietest.
const WEEKDAY = [1.1, 0.75, 0.8, 0.9, 1.0, 1.3, 1.45]
const WEEKDAY_MEAN = WEEKDAY.reduce((s, x) => s + x, 0) / 7

/**
 * How many orders a day gets, around `average`: by the day of the week, the
 * time of year (a little busier in December, quieter in summer) and a little
 * chance. The same average, date and seed always give the same number.
 */
export function dayCount(average, date, seed = '') {
  const avg = Math.max(0, Number(average) || 0)
  const rng = seededRandom('count|' + seed + '|' + date)
  const [y, m, d] = date.split('-').map(Number)
  const at = Date.UTC(y, m - 1, d)
  const dow = new Date(at).getUTCDay()
  const doy = (at - Date.UTC(y, 0, 1)) / 864e5
  const season = 1 + 0.1 * Math.cos(2 * Math.PI * (doy - 350) / 365)
  const chance = 0.88 + rng() * 0.24
  return Math.max(0, Math.round(avg * (WEEKDAY[dow] / WEEKDAY_MEAN) * season * chance))
}

// The day's shape in the venue's clock time: [from, to, how busy] (minutes).
const PROFILE = [
  [11 * 60, 12 * 60, 0.5], [12 * 60, 14 * 60, 1.7], [14 * 60, 17 * 60, 0.45],
  [17 * 60, 18 * 60, 0.9], [18 * 60, 21 * 60, 1.8], [21 * 60, 22 * 60 + 30, 0.55],
]

const formatters = new Map()
function wallClock(ms, tz) {
  let f = formatters.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    formatters.set(tz, f)
  }
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map(x => [x.type, x.value]))
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second)
}

/** The moment a venue's clock shows `minutes` past midnight on `date` (YYYY-MM-DD). */
export function zonedMs(date, minutes, tz) {
  const [y, m, d] = date.split('-').map(Number)
  const guess = Date.UTC(y, m - 1, d, 0, minutes)
  const off = wallClock(guess, tz) - guess
  let t = guess - off
  const off2 = wallClock(t, tz) - t
  if (off2 !== off) t = guess - off2
  return t
}

export function nextDate(date, n = 1) {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

// A table is laid again this long after its party has paid.
const TABLE_TURN_MS = 5 * 60_000

const clockMins = hhmm => { const [h, m] = String(hhmm || '00:00').split(':').map(Number); return (h || 0) * 60 + (m || 0) }

// ── The venue's set-up, as the till reads it ───────────────────

const streamOf = (config, id) => (config.revenue_streams || []).find(r => r.id === id) || null

function streamTypes(config, streamId) {
  const stream = streamOf(config, streamId)
  const active = (config.order_types || []).filter(t => t.is_active !== false)
  if (!stream) return active.map(type => ({ type, ask_name: 'off', ask_tent: 'off' }))
  const set = Object.fromEntries((stream.order_types || []).filter(x => x.enabled).map(x => [x.order_type_id, x]))
  return active.filter(t => set[t.id]).map(type => ({ type, ask_name: set[type.id].ask_name || 'off', ask_tent: set[type.id].ask_tent || 'off' }))
}

function coversFor(device, stream) {
  const own = device?.settings?.covers
  if (own === 'off' || own === 'ask' || own === 'must') return own
  const v = stream?.covers
  return v === 'off' || v === 'must' ? v : 'ask'
}

function coursesFor(device, stream) {
  const own = device?.settings?.courses
  if (own === 'on') return true
  if (own === 'off') return false
  return stream?.courses !== false
}

const DRINK = /\b(drinks?|beers?|wines?|cocktails?|mocktails?|softs?|soft drinks?|coffees?|teas?|juices?|spirits?|beverages?|lagers?|ciders?|shakes?|milkshakes?|smoothies?|sodas?|waters?|bar)\b/i
const DESSERT = /\b(desserts?|sweets?|puddings?|cakes?|ice ?creams?)\b/i
const SIDE = /\b(starters?|sides?|small plates?|snacks?|nibbles|appeti[sz]ers?|extras?|dips?|sauces?|soups?)\b/i
const sectionKind = title => (DRINK.test(title || '') ? 'drink' : DESSERT.test(title || '') ? 'dessert' : SIDE.test(title || '') ? 'side' : 'main')

const FIRST_NAMES = ['Sam', 'Alex', 'Jo', 'Chris', 'Priya', 'Tom', 'Aisha', 'Ben', 'Chloe', 'Dan', 'Ella', 'Finn', 'Grace', 'Hassan',
  'Isla', 'Jack', 'Kate', 'Leo', 'Maya', 'Nina', 'Omar', 'Poppy', 'Raj', 'Sophie', 'Theo', 'Uma', 'Will', 'Zara', 'Mia', 'Noah']
const VOID_REASONS = ['Guest changed their mind', 'Wrong item rung in', 'Kitchen error', 'Took too long', 'Not as described']
const COMP_REASONS = ['Wrong order', 'Long wait', 'Birthday', 'Complaint']
const DISCOUNT_REASONS = ['Regular', 'Staff', 'Local business', 'Manager\'s call']
const CANCEL_REASONS = ['Guests left', 'Wrong table', 'Order put in twice', 'Kitchen couldn\'t make it']
const REFUND_REASONS = ['Guest complaint', 'Item not served', 'Charged twice', 'Overcharged']

// Everyone in memory may do anything (the check rules then never refuse
// for want of a role); approved_by comes from the real roles (approverFor).
const ALL = normalisePermissions({ ...Object.fromEntries(PERMISSION_KEYS.map(k => [k, true])), discount_max_pct: 100 })

/**
 * Random picks for a dish's till choices, as the till sends them:
 * { [groupKey]: [{ id, prefix?, children? }] }. Each group gets at least its
 * minimum, sometimes more; nested groups (an option's own question) too.
 */
export function randomPicks(choices, groupsById, rng, depth = 0) {
  const out = {}
  for (const c of choices || []) {
    if (c.fixed) continue
    const opts = c.options || []
    if (!opts.length) continue
    let n = Math.min(c.min, c.max)
    if (c.max > n && rng() < (n === 0 ? (c.on_request ? 0.12 : 0.35) : 0.2)) n += 1 + Math.floor(rng() * Math.min(2, c.max - n))
    n = Math.min(n, c.max)
    const list = []
    const pool = [...opts]
    for (let i = 0; i < n; i++) {
      const src = c.repeat ? opts : pool
      if (!src.length) break
      const o = pick(src, rng)
      if (!c.repeat) pool.splice(pool.indexOf(o), 1)
      const e = { id: o.id }
      const g = o.child_group_id && depth < 2 ? groupsById?.[o.child_group_id] : null
      if (g) {
        const kids = randomPicks([groupChoice(g, { nested: true })], groupsById, rng, depth + 1)
        if (Object.keys(kids).length) e.children = kids
      }
      list.push(e)
    }
    // Now and then "No <something>" on a group that takes No / Light / Extra.
    if (c.prefixes && depth === 0 && rng() < 0.08) {
      const left = opts.filter(o => !list.some(e => e.id === o.id))
      if (left.length) list.push({ id: pick(left, rng).id, prefix: 'no' })
    }
    if (list.length) out[c.key] = list
  }
  return out
}

/**
 * A meal deal's picks: every step it needs, sometimes an optional one; each
 * picked dish with its own options as the deal asks them. A step the deal
 * picks itself (one choice) still needs its dish's options picked.
 */
function comboSelection(config, ctx, item, rng) {
  const groups = config.groups || {}
  const partPicks = c => {
    const part = c.item_id ? dealItem(config, c.item_id, c.groups) : null
    return part ? randomPicks(askedChoices(part.pos_choices), groups, rng) : {}
  }
  let picks = {}
  const offered = new Set()
  for (let n = 0; n < 40; n++) {
    const r = resolveSteps(item, picks, ctx)
    picks = r.picks
    const open = s => s.choices.filter(c => !c.sold_out)
    let st = r.steps.find(s => s.shown && (picks[s.step.id] || []).length < s.step.min && open(s).length)
    if (!st) {
      // An optional step, once: sometimes a pick.
      st = r.steps.find(s => s.shown && !offered.has(s.step.id) && s.step.min === 0 && s.step.max > 0 && open(s).length)
      if (!st) break
      offered.add(st.step.id)
      if (rng() >= 0.4) continue
    }
    const c = pick(open(st), rng)
    picks = { ...picks, [st.step.id]: [...(picks[st.step.id] || []), { option_id: c.option_id, item_id: c.item_id || null, choices: partPicks(c) }] }
  }
  const r = resolveSteps(item, picks, ctx)
  const combo = {}
  for (const s of r.steps) {
    if (!r.picks[s.step.id]) continue
    combo[s.step.id] = r.picks[s.step.id].map(e => {
      if (!e.item_id || Object.keys(e.choices || {}).length) return e
      const c = s.choices.find(x => x.option_id === e.option_id && (x.item_id || null) === (e.item_id || null))
      return c ? { ...e, choices: partPicks(c) } : e
    })
  }
  return { choices: randomPicks(item.pos_choices, groups, rng), combo }
}

/**
 * The person who approves `staffId` doing something, from the real roles:
 * null when their own role allows it (and, where the venue's switch says a
 * manager, they may approve themselves), else a manager who can, else null.
 * need: { key, amount, action, always } (shared/pos/permissions.js).
 */
function approverFor(real, managers, settings, staffId, need, rng) {
  const actionPerm = need.action ? MANAGER_ACTIONS.find(a => a.key === need.action)?.permission || null : null
  const mgrNeeded = !!need.always || !!(need.action && settings?.approvals?.[need.action])
  const ok = s => !!s && (!need.key || has(s, need.key, need.amount)) && (!mgrNeeded || (has(s, 'manager') && (!actionPerm || has(s, actionPerm))))
  if (ok(real[staffId])) return null
  const pool = managers.filter(m => m.id !== staffId && has(m, 'manager') && ok(m))
  return pool.length ? pick(pool, rng).id : null
}

class Refused extends Error {
  constructor(type, r) { super(type + ': ' + r.error); this.code = r.code }
}

// ── A day ──────────────────────────────────────────────────────

/**
 * One trading day of test sales.
 *   config  the venue's till config (services/posSvc.js tillConfig()), its
 *           promotions as they were on the day
 *   date    the trading day, YYYY-MM-DD; dayId its pos_days id
 *   staff   [{ id, name, permissions }] working that day, with their real roles
 *   count   how many orders (dayCount())
 *   seed    for the random numbers
 * Returns { checks (check states, as the sequencer stores them), refused
 * (events the rules refused: none, unless the set-up changed under it),
 * skipped (orders left out: nothing on the menu could be priced), day:
 * { opened_at, closed_at, closed_by, declared_cash, close_notes, figures } }.
 */
export function generateDay({ config: given, date, dayId, staff, count, seed = '' }) {
  // Nothing was sold out on a past day (automatic meal deals check it).
  const config = { ...given, sold_out: [] }
  const rng = seededRandom('day|' + seed + '|' + (config.venue?.id || '') + '|' + date)
  const tz = config.venue?.timezone || 'Europe/London'
  const venueId = config.venue?.id || null
  const settings = config.settings || {}
  const startMins = clockMins(settings.day_starts_at)
  const dayStart = zonedMs(date, startMins, tz)
  const dayEnd = zonedMs(nextDate(date), startMins, tz) - 60_000
  // Whole milliseconds (a ULID's time is a whole number), inside the trading day.
  const clamp = ms => Math.max(dayStart, Math.min(dayEnd, Math.floor(ms)))

  // Prices and choices once for every dish; nothing sold out on a past day.
  const items = config.items || {}
  for (const id of Object.keys(items)) configItem(config, id)
  const ctx = { itemsById: items, groupsById: config.groups || {}, sectionItems: config.section_items || {}, soldOut: null }

  const real = Object.fromEntries((staff || []).map(s => [s.id, s]))
  const managers = (staff || []).filter(s => has(s, 'manager'))
  // Tills are pos_devices of kind 'terminal'.
  const tills = (config.devices || []).filter(d => d.kind === 'terminal')
  // Copies: each device counts its own numbers for the day here.
  const kiosks = (config.devices || []).filter(d => d.kind === 'kiosk').map(k => ({ ...k, mode: 'counter' }))
  const staffById = {
    ...Object.fromEntries((staff || []).map(s => [s.id, { id: s.id, name: s.name, is_active: true, permissions: ALL }])),
    ...Object.fromEntries(kiosks.map(k => [k.id, kioskStaff(k)])),
  }
  const evCtx = { staffById, settings }

  // The venue's tills, or two stand-ins (a counter and a table till) when it
  // has none yet; kiosks take about a third of the orders when there are any.
  const devices = tills.length ? tills.map(d => ({ ...d, mode: d.settings?.mode === 'counter' ? 'counter' : 'table' }))
    : [{ id: null, kind: 'terminal', short_code: 'T1', settings: {}, mode: 'counter' }, { id: null, kind: 'terminal', short_code: 'T2', settings: {}, mode: 'table' }]
  let counterIndex = 0
  for (const d of [...devices, ...kiosks]) {
    const own = cleanOrderRange(d.settings?.order_numbers)
    d.range = own || defaultOrderRange(counterIndex)
    if (d.kind === 'kiosk' || d.mode === 'counter') counterIndex++
    d.numbers = null
  }
  const staffList = staff || []
  const kioskShare = !kiosks.length ? 0 : staffList.length ? 0.3 : 1
  const choosers = [
    ...(staffList.length ? devices.map(d => ({ device: d, weight: (1 - kioskShare) / devices.length })) : []),
    ...kiosks.map(k => ({ device: k, weight: kioskShare / kiosks.length })),
  ]

  const tables = (config.tables || []).filter(t => t.id)
  const busy = new Map()
  const areaStream = Object.fromEntries((config.floor_areas || []).map(a => [a.id, a.revenue_stream_id || null]))
  const discounts = discountList(settings)
  const nonAutoPromos = (config.promotions || []).filter(p => p.apply_mode && p.apply_mode !== 'auto')

  // A dish with random picks priced at least once in a few tries: a dish the
  // till couldn't sell (a required question with no answers) stays off the pools.
  const sellable = new Map()
  function canSell(id) {
    if (!sellable.has(id)) {
      const it = configItem(config, id)
      let ok = false
      for (let i = 0; it && !ok && i < 8; i++) ok = priceItem(it, selectionFor(it), ctx).ok
      sellable.set(id, ok)
    }
    return sellable.get(id)
  }
  const selectionFor = it => (isCombo(it) ? comboSelection(config, ctx, it, rng) : { choices: randomPicks(it.pos_choices, config.groups || {}, rng) })

  // Dishes on sale: the stream's menus that are on at the time, by kind of section.
  const poolCache = new Map()
  function poolsAt(streamId, at) {
    const stream = streamOf(config, streamId)
    const all = config.menus || []
    const ids = stream?.menu_ids || []
    const own = ids.length ? all.filter(m => ids.includes(m.id)) : all
    const menus = own.length ? own : all
    const on = menusOnNow(menus, venueNow(tz, new Date(at)))
    const list = on.length ? menus.filter(m => on.includes(m.id)) : menus
    const key = list.map(m => m.id).join(',')
    if (poolCache.has(key)) return poolCache.get(key)
    const pools = { main: [], side: [], dessert: [], drink: [] }
    const seen = new Set()
    for (const m of list) for (const s of m.sections || []) {
      const kind = sectionKind(s.title)
      for (const id of s.item_ids || []) {
        if (!items[id] || seen.has(kind + id) || !canSell(id)) continue
        seen.add(kind + id)
        pools[kind].push({ id, weight: popularity(id) })
      }
    }
    // Every kind of thing falls back to the rest of the menu.
    const food = [...pools.main, ...pools.side]
    if (!pools.main.length) pools.main = food.length ? food : [...pools.dessert, ...pools.drink]
    poolCache.set(key, pools)
    return pools
  }

  // A dish as a check line, priced with random choices; null when it can't be.
  function dishLine(id, check, { qty = 1, seat = null, courses = true, at }) {
    const it = configItem(config, id)
    if (!it) return null
    for (let tries = 0; tries < 4; tries++) {
      const priced = priceItem(it, selectionFor(it), ctx)
      if (!priced.ok) continue
      const tax = posTax(it, check, config)
      return {
        id: ulid(at), item_id: it.id, section_id: it.section_id || null, name: it.name, kitchen_name: it.kitchen_name || null,
        qty, unit_price: priced.unit_price, modifiers: priced.modifiers, combo: priced.combo,
        seat, course_id: courses ? it.course_id || null : null, note: null, allergies: [],
        vat_rate: tax.vat_rate, tax_rate_id: tax.tax_rate_id, revenue_stream_id: check.revenue_stream_id,
      }
    }
    return null
  }
  function lineFrom(pool, check, opts) {
    for (let tries = 0; tries < 6 && pool.length; tries++) {
      const line = dishLine(weighted(pool, rng).id, check, opts)
      if (line) return line
    }
    return null
  }

  // When each order starts: by the day's shape, in time order.
  const bandWeight = b => (b[1] - b[0]) * b[2]
  const starts = []
  for (let i = 0; i < count; i++) {
    const b = weighted(PROFILE, rng, bandWeight)
    const mins = b[0] + rng() * (b[1] - b[0])
    const whole = Math.floor(mins)
    const cal = whole >= startMins ? date : nextDate(date)
    starts.push(clamp(zonedMs(cal, whole, tz) + Math.floor((mins - whole) * 60_000)))
  }
  starts.sort((a, b) => a - b)

  const checks = []
  const refused = []
  let skipped = 0

  for (const t0 of starts) {
    if (!choosers.length) { skipped++; continue }
    const device = weighted(choosers, rng).device
    const kiosk = device.kind === 'kiosk'
    const server = kiosk ? device.id : pick(staffList, rng).id
    let mode = kiosk || device.mode === 'counter' ? 'counter' : 'table'
    let covers = null
    let table = null
    let streamId = device.settings?.revenue_stream_id || null
    if (streamId && !streamOf(config, streamId)) streamId = null
    const guests = mode === 'table' ? Math.min(12, Math.max(1, Math.round(1 + rng() * 2.2 + (rng() < 0.15 ? rng() * 5 : 0)))) : null
    const stay = mode === 'table' ? Math.round((40 + (guests || 2) * 8 + rng() * 40) * 60_000) : 0
    if (mode === 'table') {
      const free = tables.filter(t => (busy.get(t.id) || 0) <= t0 && (t.max_covers == null || t.max_covers >= guests))
      if (free.length) {
        const best = Math.min(...free.map(t => t.max_covers ?? 99))
        table = pick(free.filter(t => (t.max_covers ?? 99) === best), rng)
        streamId = areaStream[table.floor_area_id] || streamId
      } else {
        mode = 'tab'
      }
    }
    if (!streamId) streamId = config.revenue_streams?.[0]?.id || null
    const stream = streamOf(config, streamId)
    const types = streamTypes(config, streamId)
    const defaultType = types.find(x => x.type.id === stream?.default_order_type_id) || types[0] || null
    const typeRow = mode === 'counter' && types.length > 1 && rng() < 0.4 ? pick(types, rng) : defaultType
    const typeId = typeRow?.type.id || null
    const coversRule = coversFor(kiosk ? null : device, stream)
    if (mode !== 'counter' && coversRule !== 'off' && (coversRule === 'must' || rng() < 0.9)) covers = guests
    const courses = coursesFor(kiosk ? null : device, stream)
    const ask = (rule, chance) => rule === 'required' || (rule === 'ask' && rng() < chance)
    const tabName = mode === 'tab' || (mode === 'counter' && ask(typeRow?.ask_name, 0.6)) ? pick(FIRST_NAMES, rng) : null
    const tent = mode === 'counter' && ask(typeRow?.ask_tent, 0.4) ? String(between(1, 40, rng)) : null

    // What they have, priced before anything is rung in.
    const probe = { revenue_stream_id: streamId, order_type_id: typeId }
    const lines = []
    let tLine = t0 + between(20, 90, rng) * 1000
    const pools = poolsAt(streamId, t0)
    const add = (pool, opts = {}) => {
      const l = lineFrom(pool, probe, { courses, at: tLine, ...opts })
      if (l) { lines.push({ line: l, at: tLine }); tLine += between(4, 25, rng) * 1000 }
      return l
    }
    const seatFor = () => (covers && rng() < 0.5 ? between(1, covers, rng) : null)
    if (mode === 'counter') {
      const n = 1 + (rng() < 0.5 ? 1 : 0) + (rng() < 0.2 ? 1 : 0)
      for (let i = 0; i < n; i++) add(i === 0 ? pools.main : rng() < 0.6 ? pools.main : pools.side.length ? pools.side : pools.main)
      if (pools.drink.length && rng() < 0.55) add(pools.drink, { qty: rng() < 0.2 ? 2 : 1 })
    } else {
      const g = guests || 2
      if (pools.drink.length) for (let i = 0; i < g; i++) if (rng() < 0.8) add(pools.drink, { seat: seatFor() })
      if (pools.side.length) for (let i = 0; i < Math.round(g * 0.5 * rng() * 2); i++) add(pools.side, { seat: null })
      for (let i = 0; i < g; i++) add(pools.main, { seat: seatFor() })
    }
    const round2 = []
    if (mode !== 'counter' && pools.dessert.length && rng() < 0.4) {
      tLine = t0 + Math.round(stay * 0.6)
      for (let i = 0; i < Math.max(1, Math.round((guests || 2) * 0.6)); i++) {
        const l = lineFrom(pools.dessert, probe, { courses, at: tLine, seat: seatFor() })
        if (l) { round2.push({ line: l, at: tLine }); tLine += between(4, 20, rng) * 1000 }
      }
    }
    if (!lines.length) { skipped++; continue }

    // The check, event by event through the till's rules.
    const checkId = ulid(t0)
    let check = null
    const run = (type, payload, when, { by = server, approved_by = null, numberCode = null, dev = device } = {}) => {
      const at = clamp(when)
      const e = {
        id: ulid(at), venue_id: venueId, device_id: dev.id || null, staff_id: by, approved_by, check_id: checkId,
        type, payload, client_at: new Date(at).toISOString(),
        assigned: { day_id: dayId, ...(numberCode ? { number_code: numberCode } : {}) },
      }
      const r = applyEvent(check ? { [checkId]: check } : {}, e, evCtx)
      if (!r.ok) throw new Refused(type, r)
      check = r.checks[checkId]
      return e
    }
    const approval = (need, by = server) => (kiosk ? null : approverFor(real, managers, settings, by, need, rng))

    try {
      const nums = nextNumbers(device.numbers, { date, counter: mode === 'counter', range: device.range })
      device.numbers = nums.numbers
      run('check.opened', {
        mode, table_id: table?.id || null, tab_name: tabName, covers, revenue_stream_id: streamId, order_type_id: typeId, tent,
        number: nums.number, ...(nums.order_no ? { order_no: nums.order_no } : {}),
        // No charges on kiosk orders (shared/pos/checks.js).
        charges: kiosk ? [] : chargesWhere(settings.charges, { streamId, typeId }, venueId, config.tax_rates || []),
        ...(kiosk ? {} : { server_id: server }),
      }, t0, { numberCode: device.short_code || null })
      for (const x of lines) run('line.added', { line: x.line }, x.at)
      let tNow = tLine + between(10, 60, rng) * 1000
      run('lines.sent', { send_id: ulid(tNow), line_ids: check.lines.filter(l => l.status === 'new').map(l => l.id) }, tNow)

      // Cancel order: now and then a table or counter order called off.
      if (!kiosk && rng() < 0.005) {
        tNow += between(3, 15, rng) * 60_000
        const reason = pick(CANCEL_REASONS, rng)
        for (const l of check.lines.filter(isActiveLine)) {
          if (l.status === 'new') run('line.deleted', { line_id: l.id, cancel: true }, tNow, { approved_by: approval({ action: 'delete_unsent' }) })
          else run('line.voided', { line_id: l.id, reason, waste: rng() < 0.5, cancel: true }, tNow, { approved_by: approval({ key: 'void', action: 'void_sent' }) })
          tNow += 1000
        }
        run('check.closed', { cancel_reason: reason }, tNow, { approved_by: approval({ action: 'cancel_order' }) })
        if (table) busy.set(table.id, clamp(tNow) + TABLE_TURN_MS)
        checks.push(check)
        continue
      }

      if (!kiosk) {
        // A void of something the kitchen has.
        if (rng() < 0.03) {
          const sent = check.lines.filter(l => l.status === 'sent')
          if (sent.length) {
            tNow += between(4, 20, rng) * 60_000
            run('line.voided', { line_id: pick(sent, rng).id, reason: pick(VOID_REASONS, rng), waste: rng() < 0.7 }, tNow, { approved_by: approval({ key: 'void', action: 'void_sent' }) })
          }
        }
        // Puddings, later.
        if (round2.length) {
          for (const x of round2) run('line.added', { line: x.line }, clamp(x.at))
          tNow = clamp(round2[round2.length - 1].at + between(10, 60, rng) * 1000)
          run('lines.sent', { send_id: ulid(tNow), line_ids: check.lines.filter(l => l.status === 'new').map(l => l.id) }, tNow)
        }
        // A comp.
        const comping = check.lines.filter(isActiveLine)
        if (comping.length && rng() < 0.01) {
          tNow += 60_000
          run('discount.applied', { discount: { id: ulid(tNow), scope: 'line', line_ids: [pick(comping, rng).id], comp: true, name: 'Comp', reason: pick(COMP_REASONS, rng) } }, tNow, { approved_by: approval({ key: 'comp' }) })
        }
        // A discount: one from the list when the venue has some, else typed in.
        if (rng() < 0.04) {
          tNow += 60_000
          const preset = discounts.length && rng() < 0.75 ? pick(discounts, rng) : null
          const active = check.lines.filter(isActiveLine)
          const scope = preset && fitsScope(preset, 'check') ? 'check' : 'line'
          if (preset && (scope === 'check' || active.length)) {
            run('discount.applied', { discount: {
              id: ulid(tNow), scope, line_ids: scope === 'line' ? [pick(active, rng).id] : [], type: preset.kind, value: preset.value,
              name: preset.name, preset_id: preset.id, reason: '',
            } }, tNow, { approved_by: preset.needs_manager ? approval({ always: true }) : null })
          } else if (!preset) {
            const pct = pick([10, 10, 15, 20, 25, 50], rng)
            run('discount.applied', { discount: { id: ulid(tNow), scope: 'check', type: 'percent', value: pct, name: 'Discount', reason: pick(DISCOUNT_REASONS, rng) } },
              tNow, { approved_by: approval({ key: 'discount', amount: pct, action: 'custom_discount' }) })
          }
        }
        // An optional charge taken off.
        const optional = (check.charges || []).filter(x => x.optional && !x.removed)
        if (optional.length && rng() < 0.05) {
          tNow += 30_000
          run('charge.removed', { charge_id: pick(optional, rng).id, reason: 'Guest asked' }, tNow, { approved_by: approval({ action: 'remove_charge' }) })
        }
      }

      // The offers that apply (automatic meal deals, promotions), as the till works them out before the bill.
      const tPay = clamp(mode === 'counter' ? tNow + between(20, 120, rng) * 1000 : t0 + stay)
      const promo = !kiosk && nonAutoPromos.length && rng() < 0.03 ? pick(nonAutoPromos, rng).id : null
      const offers = checkOffers(check, config, { at: tPay, add: promo })
      if (offers?.changed) run('promotions.set', offers.payload, tPay - 2000)
      if (mode !== 'counter') run('bill.printed', {}, tPay - 1000)

      // Paying: card mostly, some cash, now and then split between guests. A
      // kiosk guest pays on the kiosk by card, or now and then at the counter,
      // where someone on a till takes it.
      let t = checkTotals(check)
      let tp = tPay + between(60, 360, rng) * 1000 * (mode === 'counter' ? 0.2 : 1)
      const atCounter = kiosk && staffList.length && rng() < 0.2
      const payer = atCounter ? { by: pick(staffList, rng).id, dev: devices.find(d => d.mode === 'counter') || devices[0] } : {}
      if (t.balance > 0) {
        const split = mode !== 'counter' && (covers || guests || 1) > 1 && rng() < 0.15 ? Math.min(between(2, 3, rng), covers || guests || 2) : 1
        const parts = split > 1 ? spread(t.balance, Array(split).fill(1)) : [t.balance]
        for (const amount of parts) {
          if (amount <= 0) continue
          const r = rng()
          const tender = kiosk && !atCounter ? 'card_external' : atCounter ? (r < 0.5 ? 'card_external' : 'cash') : r < 0.72 ? 'card_external' : r < 0.95 ? 'cash' : r < 0.97 ? 'voucher' : 'other'
          let tip = 0
          if (!kiosk && tender === 'card_external' && rng() < (mode === 'counter' ? 0.05 : 0.4)) tip = Math.round(amount * (0.05 + rng() * 0.075) / 10) * 10
          // Cash: the note or notes handed over, now and then the exact money.
          const note = pick([500, 1000, 2000], rng)
          const payment = {
            id: ulid(clamp(tp)), tender, amount,
            ...(tip > 0 ? { tip } : {}),
            ...(tender === 'cash' && rng() < 0.7 ? { tendered: Math.ceil(amount / note) * note } : {}),
            ...(tender === 'voucher' ? { label: 'Gift voucher' } : tender === 'other' ? { label: 'Bank transfer' } : {}),
          }
          run('payment.added', { payment }, clamp(tp), payer)
          tp += between(20, 90, rng) * 1000
        }
      }
      run('check.closed', { print_receipt: rng() < 0.3 }, clamp(tp), payer)
      // The table is free a few minutes after the party has paid.
      if (table) busy.set(table.id, clamp(tp) + TABLE_TURN_MS)

      // A refund, now and then, later the same day.
      if (!kiosk && check.status === 'closed' && rng() < 0.004) {
        t = checkTotals(check)
        const paid = t.paid - t.refunded
        const p = (check.payments || []).find(x => !x.voided)
        const refundable = check.lines.filter(isActiveLine)
        if (paid > 0 && p && refundable.length) {
          const line = pick(refundable, rng)
          const amount = rng() < 0.2 ? paid : Math.min(paid, Math.max(1, lineGross(line)))
          const tr = clamp(tp + between(10, 60, rng) * 60_000)
          run('refund.added', { refund: { id: ulid(tr), tender: p.tender, amount, reason: pick(REFUND_REASONS, rng), line_ids: [line.id] } },
            tr, { approved_by: approval({ key: 'refund', action: 'refund' }) })
        }
      }
      checks.push(check)
    } catch (err) {
      // A refusal (the set-up changed under it), or a fault in this file:
      // that order is left out and said, the day carries on.
      refused.push({ check_id: checkId, error: err.message, code: err instanceof Refused ? err.code || null : 'error' })
    }
  }

  // The day: opened before the first order, closed after the last, the cash
  // counted (most days exactly what the till expected).
  const figures = dayFigures(checks, dayId)
  const times = checks.flatMap(c => [c.opened_at, c.closed_at, ...(c.refunds || []).map(r => r.at)]).filter(Boolean).map(x => Date.parse(x))
  const first = times.length ? Math.min(...times) : zonedMs(date, 11 * 60, tz)
  const last = times.length ? Math.max(...times) : zonedMs(date, 22 * 60, tz)
  const closers = staffList.filter(s => has(s, 'close_day'))
  const counted = figures.cash_expected + (rng() < 0.75 ? 0 : between(-1500, 1500, rng))
  const day = {
    opened_at: new Date(clamp(first - between(20, 60, rng) * 60_000)).toISOString(),
    closed_at: new Date(clamp(last + between(15, 45, rng) * 60_000)).toISOString(),
    closed_by: (closers.length ? pick(closers, rng) : staffList.length ? pick(staffList, rng) : null)?.id || null,
    declared_cash: Math.max(0, counted),
    close_notes: counted !== figures.cash_expected && rng() < 0.3 ? 'Counted twice' : null,
    figures,
  }
  return { checks, refused, skipped, day }
}
