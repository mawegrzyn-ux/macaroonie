// Kiosk journeys (migration 208): what a guest did at a self-order kiosk,
// recorded as it happened (pos/src/kiosk/journey.js), summed up when it
// reaches the API, reported on Store tech > Kiosk analytics and played back
// on the kiosk mock-up (the kiosk app in replay mode).
//
// A session is one guest's visit: from the first touch (or the order
// starting) until the kiosk is back on its start screen for the next guest.
// Its events, in order, each with t = ms since the session started:
//
//   v       { p: { key: value }, d: [keys] }   what the kiosk shows changed (d: keys gone)
//   tap     { x, y, el, id, ref, hit }         a touch, in the screen's CSS px; el is what was
//                                              touched in words, id its test id, ref the dish /
//                                              section / tag / language it is for; hit 0 = on
//                                              nothing that answers, 2 = on a button that is off
//   swipe   { x, y, x2, y2, ms, el, id }       a drag across the screen
//   scroll  { s, y, x }                        a scrolling box moved (s: its place in the kiosk)
//   vp      { w, h }                           the screen's size (also the first event's)
//   end     { why }                            the visit ended: done | guest | timeout | left |
//                                              interrupted | preview
//
// The first v holds the whole view. The view is flat: screen, section,
// orderType, lang, reach, prefs, basket, builder, details (name and tent as
// lengths only), detailStep, method, result, error, toast, link, value (the
// basket's total, pence), and 'ui:<key>' for what a screen keeps to itself
// (a dish being built, a combo's page, a sheet that is open, the "Are you
// still there?" countdown). Nothing a guest types is recorded, only how long
// it is; taps on the keyboard are recorded at the keyboard's middle.
//
// Everything here is plain functions on that data: the kiosk records it,
// the API sums it up with summariseJourney(), the admin lists the steps
// with journeySteps() and plays it back with frameAt().

export const JOURNEY_EVENT_KINDS = ['v', 'tap', 'swipe', 'scroll', 'vp', 'end']
export const END_REASONS = ['done', 'guest', 'timeout', 'left', 'interrupted', 'preview']

// What happened in the end. An order placed always counts as ordered.
export const OUTCOMES = ['ordered', 'started_again', 'timed_out', 'left', 'interrupted']
export const OUTCOME_LABELS = {
  ordered: 'Ordered',
  started_again: 'Started again',
  timed_out: 'Timed out',
  left: 'Walked away',
  interrupted: 'Cut short',
}
const OUTCOME_OF_END = { done: 'left', guest: 'started_again', timeout: 'timed_out', left: 'left', interrupted: 'interrupted', preview: 'interrupted' }

// How far a guest got, in order.
export const STAGES = ['start', 'menu', 'item', 'added', 'basket', 'details', 'pay', 'ordered']
export const STAGE_LABELS = {
  start: 'Touched the screen',
  menu: 'Opened the menu',
  item: 'Opened a dish',
  added: 'Added to the order',
  basket: 'Looked at the order',
  details: 'Name or number',
  pay: 'Paying',
  ordered: 'Ordered',
}

export const SCREEN_LABELS = {
  start: 'Start screen',
  menu: 'Menu',
  basket: 'Your order',
  details: 'Name or number',
  pay: 'How to pay',
  card: 'Card machine',
  placing: 'Sending the order',
  done: 'Order number',
  failed: 'Order didn\'t go through',
  allergens: 'Allergens',
  dish: 'A dish (choosing)',
}

const SECTION_PAGES = { home: 'Home page', tiles: 'Section tiles' }

// A tap followed this soon by a change on screen is what caused it (one step).
const TAP_JOIN_MS = 700

/** The view with one v event's changes made. */
export function applyPatch(view, ev) {
  const next = { ...view }
  if (ev?.p) for (const [k, v] of Object.entries(ev.p)) next[k] = v
  if (Array.isArray(ev?.d)) for (const k of ev.d) delete next[k]
  return next
}

/** The changes from one view to the next as a v event's body ({ p, d }), or null when nothing changed. */
export function diffView(prev, next) {
  const p = {}
  const d = []
  for (const [k, v] of Object.entries(next)) {
    if (v === undefined) continue
    if (!(k in prev) || JSON.stringify(prev[k]) !== JSON.stringify(v)) p[k] = v
  }
  for (const k of Object.keys(prev)) if (!(k in next) || next[k] === undefined) d.push(k)
  if (!Object.keys(p).length && !d.length) return null
  return d.length ? { p, d } : { p }
}

/**
 * What the kiosk showed at time t (ms into the session): { view, scroll
 * (place -> { x, y }), vp ({ w, h }), taps (touches in the last `window` ms,
 * with age), v (how many view changes so far: a new number means the view
 * changed) }.
 */
export function frameAt(events, t, { window: win = 900 } = {}) {
  let view = {}
  let v = 0
  let vp = null
  const taps = []
  for (const ev of events || []) {
    if (ev.t > t) break
    if (ev.k === 'v') { view = applyPatch(view, ev); v++ }
    else if (ev.k === 'vp') vp = { w: ev.w, h: ev.h }
    else if ((ev.k === 'tap' || ev.k === 'swipe') && t - ev.t <= win) taps.push({ ...ev, age: t - ev.t })
  }
  // A screen change starts its boxes at the top: older scrolls on boxes the
  // new screen also has would be wrong, so only scrolls since the last
  // screen (or dish) change count.
  return { view, scroll: scrollSince(events, t), vp, taps, v }
}

function scrollSince(events, t) {
  let from = 0
  let screen
  let builder
  for (let i = 0; i < (events || []).length; i++) {
    const ev = events[i]
    if (ev.t > t) break
    if (ev.k !== 'v' || !ev.p) continue
    const s = 'screen' in ev.p ? ev.p.screen : screen
    const b = 'builder' in ev.p ? builderKey(ev.p.builder) : builder
    if (i > 0 && (s !== screen || b !== builder)) from = i
    screen = s
    builder = b
  }
  const scroll = {}
  for (let i = from; i < (events || []).length; i++) {
    const ev = events[i]
    if (ev.t > t) break
    if (ev.k === 'scroll') scroll[ev.s] = { x: ev.x || 0, y: ev.y || 0 }
  }
  return scroll
}

const builderKey = b => (b ? b.key || b.item_id : null)

// The screen a guest is on, a dish being built counting as its own ('dish').
const screenOf = view => (view.builder && view.screen && view.screen !== 'start' ? 'dish' : view.screen || null)

/** The session's length: its last event's time. */
export const journeyLength = events => (events?.length ? events[events.length - 1].t || 0 : 0)

/** How the session ended (an order placed is always 'ordered'). */
export function outcomeOf(events) {
  let ordered = false
  let why = null
  for (const ev of events || []) {
    if (ev.k === 'v' && ev.p?.result && ev.p.result.order_no != null) ordered = true
    if (ev.k === 'v' && ev.p?.result?.provisional && ev.p.result.pending) ordered = true
    if (ev.k === 'end') why = ev.why
  }
  if (ordered) return 'ordered'
  return OUTCOME_OF_END[why] || 'interrupted'
}

const nameOf = (names, id, fallback = 'a dish') => (id && names?.[id]) || fallback
const sectionName = (names, id) => SECTION_PAGES[id] || nameOf(names, id, 'a section')
const qtyText = (n, name) => (n > 1 ? n + ' x ' : '') + name

/** A basket's entries by key: { key: { item_id, qty } }. */
function byKey(basket) {
  const m = new Map()
  for (const e of basket || []) m.set(e.key, e)
  return m
}

/**
 * The visit as steps a person reads, in order: [{ t, dwell (ms until the
 * next step), kind, label, detail?, item_id?, tap? (the touch that caused
 * it), dead? }]. Kinds: screen, section, open, left, add, change, remove,
 * qty, lang, reach, prefs, idle, idle_answered, restart_ask, restart_kept,
 * card_declined, ordered, tap, typing, scroll, end.
 */
export function journeySteps(events, names = {}) {
  const steps = []
  let view = {}
  let pendingTap = null
  const push = (t, step, { join = false } = {}) => {
    // A touch just before a change on screen is that change's cause (a touch
    // on nothing that answers caused nothing, and scrolling isn't a change).
    if (join && pendingTap && t - pendingTap.t <= TAP_JOIN_MS) {
      step.tap = pendingTap
      const i = steps.indexOf(pendingTap.step)
      if (i >= 0) steps.splice(i, 1)
      pendingTap = null
    }
    steps.push({ t, ...step })
    return steps[steps.length - 1]
  }
  for (const ev of events || []) {
    if (ev.k === 'v') {
      const prev = view
      view = applyPatch(view, ev)
      for (const s of viewSteps(prev, view, ev.p || {}, names)) push(ev.t, s, { join: true })
      continue
    }
    if (ev.k === 'tap') {
      const last = steps[steps.length - 1]
      if (ev.el === 'keyboard') {
        if (last?.kind === 'typing' && !last.closed) { last.count++; continue }
        push(ev.t, { kind: 'typing', label: 'Typed on the keyboard', count: 1 })
        continue
      }
      const label = ev.hit === 0 ? 'Touched nothing that answers' + (ev.el ? ' (' + ev.el + ')' : '')
        : ev.hit === 2 ? 'Touched ' + quote(ev.el) + ' (not available yet)' : 'Touched ' + quote(ev.el)
      const dead = ev.hit === 0 || ev.hit === 2
      const step = push(ev.t, { kind: 'tap', label, dead, tap: ev })
      pendingTap = dead ? null : { ...ev, step }
      continue
    }
    if (ev.k === 'swipe') {
      push(ev.t, { kind: 'swipe', label: 'Swiped' + (ev.el ? ' on ' + quote(ev.el) : '') })
      continue
    }
    if (ev.k === 'scroll') {
      const last = steps[steps.length - 1]
      if (last?.kind === 'scroll') continue
      push(ev.t, { kind: 'scroll', label: 'Scrolled' })
      continue
    }
    if (ev.k === 'end') push(ev.t, { kind: 'end', label: 'Ended: ' + (OUTCOME_LABELS[outcomeOf(events)] || 'ended').toLowerCase() })
  }
  for (let i = 0; i < steps.length; i++) {
    steps[i].dwell = (i + 1 < steps.length ? steps[i + 1].t : journeyLength(events)) - steps[i].t
    if (steps[i].kind === 'typing') steps[i].label = 'Typed on the keyboard (' + steps[i].count + (steps[i].count === 1 ? ' key)' : ' keys)')
  }
  return steps
}

const quote = s => (s ? '“' + String(s) + '”' : 'the screen')

function viewSteps(prev, view, changed, names) {
  const out = []
  if ('screen' in changed && prev.screen !== view.screen) {
    let label = SCREEN_LABELS[view.screen] || view.screen
    if (view.screen === 'done') label = 'Order number' + (view.result?.order_no != null ? ' ' + view.result.order_no : view.result?.provisional ? ' ' + view.result.provisional : '')
    if (view.screen === 'details') label = view.detailStep === 'tent' ? 'Tent or table number' : 'Name'
    out.push({ kind: 'screen', screen: view.screen, label })
  } else if ('detailStep' in changed && view.screen === 'details' && prev.detailStep !== view.detailStep) {
    out.push({ kind: 'screen', screen: 'details', label: view.detailStep === 'tent' ? 'Tent or table number' : 'Name' })
  }
  if ('section' in changed && view.section && prev.section !== view.section && view.screen === 'menu') {
    out.push({ kind: 'section', section: view.section, label: 'Opened ' + sectionName(names, view.section) })
  }
  if ('orderType' in changed && view.orderType && prev.orderType !== view.orderType) {
    out.push({ kind: 'type', label: 'Picked ' + nameOf(names, view.orderType, 'an order type') })
  }
  if ('lang' in changed && prev.lang !== undefined && prev.lang !== view.lang) {
    out.push({ kind: 'lang', label: 'Language: ' + (names?.['lang:' + view.lang] || view.lang) })
  }
  if ('reach' in changed && prev.reach !== undefined && !!prev.reach !== !!view.reach) {
    out.push({ kind: 'reach', label: view.reach ? 'Moved the screen down (reach)' : 'Moved the screen back up' })
  }
  if ('prefs' in changed && prev.prefs !== undefined) {
    const codes = [...(view.prefs?.avoid || []), ...(view.prefs?.diet || [])]
    out.push({ kind: 'prefs', label: codes.length ? 'Allergens and diets: ' + codes.map(c => names?.['tag:' + c] || c).join(', ') : 'Cleared allergens and diets' })
  }
  // The dish being built, and the order.
  const hadB = prev.builder || null
  const hasB = view.builder || null
  // Back on the start screen the order is cleared for the next guest: not removals.
  const reset = view.screen === 'start' && prev.screen && prev.screen !== 'start'
  const basketChanged = 'basket' in changed && prev.basket !== undefined && !reset
  const before = byKey(prev.basket)
  const after = byKey(view.basket)
  if (hasB && (!hadB || builderKey(hadB) !== builderKey(hasB))) {
    out.push({ kind: 'open', item_id: hasB.item_id, label: (hasB.key ? 'Changing ' : 'Opened ') + nameOf(names, hasB.item_id) })
  }
  if (basketChanged) {
    for (const [key, e] of after) {
      const was = before.get(key)
      if (!was) out.push({ kind: 'add', item_id: e.item_id, qty: e.qty, label: 'Added ' + qtyText(e.qty, nameOf(names, e.item_id)) })
      else if (JSON.stringify(was.selection || {}) !== JSON.stringify(e.selection || {})) out.push({ kind: 'change', item_id: e.item_id, label: 'Changed ' + nameOf(names, e.item_id) })
      else if (was.qty !== e.qty) {
        out.push({
          kind: e.qty > was.qty ? 'add' : 'qty', item_id: e.item_id, qty: e.qty - was.qty,
          label: e.qty > was.qty ? 'Added ' + qtyText(e.qty - was.qty, nameOf(names, e.item_id)) + ' (now ' + e.qty + ')' : 'Took off ' + qtyText(was.qty - e.qty, nameOf(names, e.item_id)) + ' (now ' + e.qty + ')',
        })
      }
    }
    for (const [key, e] of before) if (!after.has(key)) out.push({ kind: 'remove', item_id: e.item_id, qty: e.qty, label: 'Removed ' + qtyText(e.qty, nameOf(names, e.item_id)) })
  }
  if (hadB && (!hasB || builderKey(hadB) !== builderKey(hasB))) {
    // Closed without the order changing: left the dish without adding it.
    const added = basketChanged && out.some(s => ['add', 'change'].includes(s.kind) && s.item_id === hadB.item_id)
    if (!added && !reset) {
      out.push({ kind: 'left', item_id: hadB.item_id, label: 'Left ' + nameOf(names, hadB.item_id) + (hadB.key ? ' unchanged' : ' without adding it') })
    }
  }
  // What screens keep to themselves.
  if ('ui:idle' in changed || ('ui:idle' in prev && !('ui:idle' in view))) {
    const was = prev['ui:idle'] ?? null
    const now = view['ui:idle'] ?? null
    if (was == null && now != null) out.push({ kind: 'idle', label: 'Asked “Are you still there?”' })
    if (was != null && now == null && view.screen !== 'start') out.push({ kind: 'idle_answered', label: 'Answered “I\'m here”' })
  }
  if ('ui:restart.ask' in changed || ('ui:restart.ask' in prev && !('ui:restart.ask' in view))) {
    const was = !!prev['ui:restart.ask']
    const now = !!view['ui:restart.ask']
    if (!was && now) out.push({ kind: 'restart_ask', label: 'Asked to start again' })
    if (was && !now && view.screen !== 'start') out.push({ kind: 'restart_kept', label: 'Kept ordering' })
  }
  if ('ui:card' in changed && view['ui:card'] === 'declined' && prev['ui:card'] !== 'declined') {
    out.push({ kind: 'card_declined', label: 'Card declined' })
  }
  if ('ui:card' in changed && view['ui:card'] === 'unavailable' && prev['ui:card'] !== 'unavailable') {
    out.push({ kind: 'card_unavailable', label: 'Card machine not available' })
  }
  if ('result' in changed && view.result && !prev.result) {
    const r = view.result
    out.push({
      kind: 'ordered', label: r.pending ? 'Paid, order waiting to reach the till' : 'Order placed' + (r.order_no != null ? ' (' + r.order_no + ')' : ''),
      total: r.total ?? null,
    })
  }
  return out
}

/**
 * One visit summed up (stored with the session, migration 208): outcome,
 * how far the guest got, where the time went and what they did.
 */
export function summariseJourney(events, { names = {} } = {}) {
  const evs = Array.isArray(events) ? events : []
  const length = journeyLength(evs)
  const screens = {}
  const sections = {}
  const items = {}
  const reached = new Set(['start'])
  const cancels = { started_again: 0, timed_out: 0, left_items: 0, removed: 0, card_declined: 0, card_unavailable: 0, idle_asked: 0, idle_answered: 0, restart_asked: 0, kept_ordering: 0 }
  let taps = 0
  let dead = 0
  let swipes = 0
  let scrolls = 0
  let view = {}
  let segStart = 0
  let segScreen = null
  let segSection = null
  let openItem = null
  let openAt = 0
  let firstAdd = null
  let orderedAt = null
  let order = null
  let lastScreen = null
  let langs = new Set()
  let reach = false
  let allergens = false
  const item = id => (items[id] ||= { views: 0, view_ms: 0, adds: 0, qty: 0, removed: 0, left: 0 })
  const closeSegment = t => {
    if (segScreen) screens[segScreen] = (screens[segScreen] || 0) + Math.max(0, t - segStart)
    if (segScreen === 'menu' && segSection) sections[segSection] = (sections[segSection] || 0) + Math.max(0, t - segStart)
    segStart = t
  }
  for (const ev of evs) {
    if (ev.k === 'tap') { taps++; if (ev.hit === 0 || ev.hit === 2) dead++; continue }
    if (ev.k === 'swipe') { swipes++; continue }
    if (ev.k === 'scroll') { scrolls++; continue }
    if (ev.k === 'end') { if (ev.why === 'guest') cancels.started_again++; if (ev.why === 'timeout') cancels.timed_out++; continue }
    if (ev.k !== 'v') continue
    const prev = view
    view = applyPatch(view, ev)
    const ch = ev.p || {}
    // Time on each screen (and each section of the menu while no dish is open).
    const builderChange = builderKey(prev.builder) !== builderKey(view.builder)
    if (prev.screen !== view.screen || prev.section !== view.section || builderChange) {
      closeSegment(ev.t)
      segScreen = screenOf(view)
      segSection = view.section || null
    }
    if (view.screen && view.screen !== 'start') lastScreen = screenOf(view)
    if (view.screen === 'menu' || view.screen === 'allergens') reached.add('menu')
    if (['basket', 'details', 'pay', 'card', 'placing', 'done', 'failed'].includes(view.screen)) reached.add('basket')
    if (view.screen === 'details') reached.add('details')
    if (['pay', 'card', 'placing', 'done', 'failed'].includes(view.screen)) reached.add('pay')
    if (view.lang) langs.add(view.lang)
    if (view.reach) reach = true
    if ((view.prefs?.avoid?.length || 0) + (view.prefs?.diet?.length || 0) > 0) allergens = true
    // A dish opened, left or added.
    if (builderChange) {
      if (openItem) { item(openItem).view_ms += Math.max(0, ev.t - openAt); openItem = null }
      if (view.builder) {
        openItem = view.builder.item_id
        openAt = ev.t
        reached.add('item')
        item(openItem).views++
      }
    }
    const reset = view.screen === 'start' && prev.screen && prev.screen !== 'start'
    if ('basket' in ch && prev.basket !== undefined && !reset) {
      const before = byKey(prev.basket)
      const after = byKey(view.basket)
      for (const [key, e] of after) {
        const was = before.get(key)
        const more = was ? e.qty - was.qty : e.qty
        if (more > 0) {
          item(e.item_id).adds++
          item(e.item_id).qty += more
          reached.add('item'); reached.add('added')
          if (firstAdd == null) firstAdd = ev.t
        } else if (more < 0) { item(e.item_id).removed += -more; cancels.removed += -more }
      }
      for (const [key, e] of before) if (!after.has(key)) { item(e.item_id).removed += e.qty; cancels.removed += e.qty }
    }
    // Closed a new dish without the order changing: left it (not counted
    // when the kiosk went back to its start screen: that is the visit ending).
    if (builderChange && prev.builder && !prev.builder.key && !reset) {
      const changed = 'basket' in ch && JSON.stringify(prev.basket) !== JSON.stringify(view.basket)
      if (!changed) { item(prev.builder.item_id).left++; cancels.left_items++ }
    }
    if ('ui:idle' in ch && ch['ui:idle'] != null && prev['ui:idle'] == null) cancels.idle_asked++
    if (prev['ui:idle'] != null && view['ui:idle'] == null && view.screen !== 'start') cancels.idle_answered++
    if (ch['ui:restart.ask'] && !prev['ui:restart.ask']) cancels.restart_asked++
    if (prev['ui:restart.ask'] && !view['ui:restart.ask'] && view.screen !== 'start') cancels.kept_ordering++
    if (ch['ui:card'] === 'declined' && prev['ui:card'] !== 'declined') cancels.card_declined++
    if (ch['ui:card'] === 'unavailable' && prev['ui:card'] !== 'unavailable') cancels.card_unavailable++
    if (ch.result && !prev.result) {
      order = { order_no: ch.result.order_no ?? null, provisional: ch.result.provisional ?? null, pending: !!ch.result.pending, total: ch.result.total ?? null, check_id: ch.result.check ?? null }
      orderedAt = ev.t
      reached.add('ordered')
    }
  }
  if (openItem) item(openItem).view_ms += Math.max(0, length - openAt)
  closeSegment(length)
  const outcome = outcomeOf(evs)
  const furthest = [...STAGES].reverse().find(s => reached.has(s)) || 'start'
  const itemsAdded = Object.values(items).reduce((n, x) => n + x.qty, 0)
  return {
    outcome,
    duration_ms: length,
    furthest,
    stages: STAGES.filter(s => reached.has(s)),
    last_screen: outcome === 'ordered' ? 'done' : lastScreen || 'start',
    screens,
    sections,
    items,
    items_added: itemsAdded,
    basket_value: outcome === 'ordered' ? order?.total ?? view.value ?? 0 : lastValue(evs),
    order,
    first_add_ms: firstAdd,
    order_ms: orderedAt,
    cancels,
    taps,
    dead_taps: dead,
    swipes,
    scrolls,
    lang: view.lang || null,
    langs: [...langs],
    reach,
    allergens,
    names: Object.keys(names || {}).length,
  }
}

// The basket's value just before the guest gave up (a restart empties it).
function lastValue(events) {
  let value = 0
  for (const ev of events) if (ev.k === 'v' && ev.p && 'value' in ev.p && ev.p.value > 0) value = ev.p.value
  return value
}

const avg = (sum, n) => (n ? Math.round(sum / n) : 0)

/**
 * Many visits summed up for the report. rows: [{ summary, outcome,
 * duration_ms, total_pence, basket_value_pence, device_id, hour (0-23, the
 * venue's time), names }]. Returns the figures the Kiosk analytics page
 * shows.
 */
export function aggregateJourneys(rows) {
  const list = Array.isArray(rows) ? rows : []
  const outcomes = Object.fromEntries(OUTCOMES.map(o => [o, 0]))
  const funnel = Object.fromEntries(STAGES.map(s => [s, 0]))
  const gaveUp = {}
  const screens = {}
  const screenVisits = {}
  const items = {}
  const cancels = {}
  const byHour = Array.from({ length: 24 }, (_, h) => ({ hour: h, sessions: 0, ordered: 0, revenue: 0 }))
  const byDevice = {}
  const langs = {}
  const names = {}
  let ordered = 0
  let revenue = 0
  let durationAll = 0
  let orderMs = 0
  let orderMsN = 0
  let abandoned = 0
  let abandonedValue = 0
  let abandonedWithBasket = 0
  let bounced = 0
  let taps = 0
  let dead = 0
  let reach = 0
  let allergens = 0
  for (const r of list) {
    const s = r.summary || {}
    Object.assign(names, r.names || {})
    const outcome = r.outcome || s.outcome || 'interrupted'
    outcomes[outcome] = (outcomes[outcome] || 0) + 1
    for (const st of s.stages || ['start']) funnel[st] = (funnel[st] || 0) + 1
    const isOrder = outcome === 'ordered'
    const total = r.total_pence ?? s.order?.total ?? 0
    durationAll += r.duration_ms ?? s.duration_ms ?? 0
    if (isOrder) {
      ordered++
      revenue += total || 0
      if (s.order_ms != null) { orderMs += s.order_ms; orderMsN++ }
    } else {
      abandoned++
      const value = r.basket_value_pence ?? s.basket_value ?? 0
      if (value > 0) { abandonedValue += value; abandonedWithBasket++ }
      if (!(s.stages || []).includes('item')) bounced++
      const at = s.last_screen || 'start'
      gaveUp[at] = (gaveUp[at] || 0) + 1
    }
    for (const [k, ms] of Object.entries(s.screens || {})) {
      screens[k] = (screens[k] || 0) + ms
      screenVisits[k] = (screenVisits[k] || 0) + 1
    }
    for (const [id, x] of Object.entries(s.items || {})) {
      const a = (items[id] ||= { id, views: 0, view_ms: 0, adds: 0, qty: 0, removed: 0, left: 0, sessions: 0 })
      a.views += x.views || 0
      a.view_ms += x.view_ms || 0
      a.adds += x.adds || 0
      a.qty += x.qty || 0
      a.removed += x.removed || 0
      a.left += x.left || 0
      a.sessions++
    }
    for (const [k, n] of Object.entries(s.cancels || {})) cancels[k] = (cancels[k] || 0) + (n || 0)
    if (r.hour != null && byHour[r.hour]) {
      byHour[r.hour].sessions++
      if (isOrder) { byHour[r.hour].ordered++; byHour[r.hour].revenue += total || 0 }
    }
    const dev = r.device_id || 'unknown'
    const d = (byDevice[dev] ||= { device_id: r.device_id || null, sessions: 0, ordered: 0, revenue: 0, duration_ms: 0 })
    d.sessions++
    d.duration_ms += r.duration_ms ?? s.duration_ms ?? 0
    if (isOrder) { d.ordered++; d.revenue += total || 0 }
    taps += s.taps || 0
    dead += s.dead_taps || 0
    if (s.reach) reach++
    if (s.allergens) allergens++
    for (const l of s.langs || []) langs[l] = (langs[l] || 0) + 1
  }
  const n = list.length
  return {
    sessions: n,
    ordered,
    conversion: n ? ordered / n : 0,
    revenue,
    avg_order: avg(revenue, ordered),
    avg_duration_ms: avg(durationAll, n),
    avg_order_ms: avg(orderMs, orderMsN),
    abandoned,
    abandoned_value: abandonedValue,
    abandoned_with_basket: abandonedWithBasket,
    bounced,
    outcomes,
    funnel: STAGES.map(st => ({ stage: st, label: STAGE_LABELS[st], sessions: funnel[st] || 0 })),
    gave_up: Object.entries(gaveUp).map(([screen, count]) => ({ screen, label: SCREEN_LABELS[screen] || screen, count })).sort((a, b) => b.count - a.count),
    screens: Object.entries(screens).map(([screen, ms]) => ({ screen, label: SCREEN_LABELS[screen] || screen, visits: screenVisits[screen], avg_ms: avg(ms, screenVisits[screen]), total_ms: ms }))
      .sort((a, b) => b.total_ms - a.total_ms),
    items: Object.values(items).map(x => ({ ...x, name: names[x.id] || null, avg_view_ms: avg(x.view_ms, x.views) }))
      .sort((a, b) => b.views - a.views || b.qty - a.qty),
    cancels,
    by_hour: byHour,
    by_device: Object.values(byDevice).map(d => ({ ...d, avg_duration_ms: avg(d.duration_ms, d.sessions) })).sort((a, b) => b.sessions - a.sessions),
    taps_per_session: n ? taps / n : 0,
    dead_tap_share: taps ? dead / taps : 0,
    reach_sessions: reach,
    allergen_sessions: allergens,
    langs,
  }
}
