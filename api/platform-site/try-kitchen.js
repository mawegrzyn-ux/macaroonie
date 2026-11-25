// The kitchen flow sandbox on macaroonie.com/try/kitchen-flow
// (views/platform/site/try-kitchen-flow.eta). A module, no build.
//
// The visitor's boxes and links are a kitchen flow in the real shape
// (shared/pos/kitchen.js: stations { id, name, kind, settings }, links
// { from, to, targets }). The test order runs through the kitchen test bench
// (shared/pos/kitchenBench.js), the same pretend kitchen the office's Test the
// kitchen page uses: the dishes' ways, Splitters, Sleepers, the tickets each
// screen shows and what each printer prints all come from the real rules,
// served by the API at /site/shared/<version>/ (services/platformSite/
// sharedModules.js). Nothing leaves the page; the visitor's own flow is kept
// in this browser's localStorage only.

const root = document.getElementById('kf')
const base = root.dataset.shared
const [K, Bench, Print, Html, Ids] = await Promise.all([
  import(base + 'pos/kitchen.js'),
  import(base + 'pos/kitchenBench.js'),
  import(base + 'pos/kitchenPrint.js'),
  import(base + 'pos/ticketHtml.js'),
  import(base + 'pos/ids.js'),
])

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
const STORE = 'macaroonie-try-kitchen-flow'
const MAX_BOXES = 12

function uuid() {
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('')
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20)
}

// The menu of the test order: four sections, five dishes.
const SECTIONS = [
  { id: '5ec70000-0000-4000-8000-000000000001', name: 'Mains' },
  { id: '5ec70000-0000-4000-8000-000000000002', name: 'Sides' },
  { id: '5ec70000-0000-4000-8000-000000000003', name: 'Drinks' },
  { id: '5ec70000-0000-4000-8000-000000000004', name: 'Desserts' },
]
const SEC = Object.fromEntries(SECTIONS.map(s => [s.name, s.id]))
const ITEM_LIST = [
  { name: 'Burger', section_id: SEC.Mains },
  { name: 'Fries', section_id: SEC.Sides },
  { name: 'Cola', section_id: SEC.Drinks },
  { name: 'Brownie', section_id: SEC.Desserts },
].map((x, i) => ({ ...x, id: 'd1500000-0000-4000-8000-00000000000' + (i + 1) }))
const ORDER = [{ n: 0, qty: 2 }, { n: 1, qty: 1 }, { n: 2, qty: 1 }, { n: 3, qty: 1 }]

const KINDS = {
  prep: { label: 'Station', what: 'Kitchen screen' },
  expo: { label: 'Pass', what: 'Checks whole orders' },
  balance: { label: 'Splitter', what: 'Shares tickets' },
  sleeper: { label: 'Sleeper', what: 'Holds dishes back' },
  printer: { label: 'Printer', what: 'Prints tickets' },
}
const ADDABLE = ['prep', 'expo', 'balance', 'sleeper', 'printer']

function defaultFlow() {
  const id = n => 'b0c5' + String(n).padStart(4, '0') + '-0000-4000-8000-000000000000'
  const box = (n, name, kind, settings = {}) => ({ id: id(n), name, kind, settings })
  const boxes = [
    box(1, 'Grill', 'prep'), box(2, 'Fryer', 'prep'), box(3, 'Bar', 'prep'),
    box(4, 'Hold desserts', 'sleeper', { delay_mins: 10 }),
    box(5, 'Pass', 'expo'), box(6, 'Ticket printer', 'printer'),
  ]
  const link = (from, to, section) => ({ id: uuid(), from: from ? id(from) : null, to: id(to), targets: section ? [{ kind: 'section', id: SEC[section] }] : [] })
  const links = [
    link(null, 1, 'Mains'), link(null, 2, 'Sides'), link(null, 3, 'Drinks'), link(null, 4, 'Desserts'),
    link(null, 6, null),
    link(1, 5), link(2, 5), link(3, 5), link(4, 5),
  ]
  return { boxes, links }
}

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) || 'null')
    if (raw && Array.isArray(raw.boxes) && Array.isArray(raw.links)) {
      const boxes = raw.boxes.filter(b => b && KINDS[b.kind] && typeof b.id === 'string').slice(0, MAX_BOXES)
        .map(b => ({ id: b.id, name: String(b.name || KINDS[b.kind].label).slice(0, 30), kind: b.kind, settings: b.kind === 'sleeper' ? { delay_mins: clampMins(b.settings?.delay_mins) } : {} }))
      const ids = new Set(boxes.map(b => b.id))
      const links = raw.links.filter(l => l && ids.has(l.to) && (l.from == null || ids.has(l.from)))
        .map(l => ({ id: uuid(), from: l.from || null, to: l.to, targets: (l.targets || []).filter(t => t.kind === 'section' && SECTIONS.some(s => s.id === t.id)).slice(0, 1) }))
      if (boxes.length) return { boxes, links }
    }
  } catch { /* storage blocked or bad: start from the default */ }
  return defaultFlow()
}
function save() {
  try { localStorage.setItem(STORE, JSON.stringify({ boxes: S.boxes, links: S.links })) } catch { /* not kept */ }
}
function clampMins(v) { return Math.min(60, Math.max(1, Math.round(Number(v) || 10))) }

// ── State ─────────────────────────────────────────────────────

const S = {
  ...load(),
  selected: null,     // box id whose settings show
  connecting: null,   // box id (or 'start') a link is being drawn from
  offset: 0,          // the pretend clock's lead over the real one (Fire now)
  printed: [],        // [{ station, title, html }]
  arrived: new Set(), // 'itemId|node' seen, for the animation
}
const now = () => new Date(Date.now() + S.offset).toISOString()

const data = {
  venue: { id: uuid(), name: 'Sandbox' }, settings: {},
  stations: [], flows: [], active_flow_id: null,
  items: Object.fromEntries(ITEM_LIST.map(i => [i.id, i])), section_items: {},
  courses: [], tables: [], order_types: [], streams: [], devices: [],
}
let bench = null
let flowN = 0

function stationsFor() {
  return S.boxes.map(b => ({
    id: b.id, name: b.name, kind: b.kind, colour: null,
    settings: b.kind === 'printer' ? { printer_id: b.id } : b.kind === 'sleeper' ? { delay_mins: b.settings.delay_mins } : {},
  }))
}

// A change to the flow is a new flow put in use, as on a kitchen screen's
// flow button: dishes already sent keep their way, new ones take the new one.
function useFlow() {
  data.stations = stationsFor()
  const id = uuid()
  data.flows = [...data.flows.slice(-5), { id, name: 'Flow ' + (++flowN), links: S.links.map(l => ({ ...l })) }]
  if (!bench) { data.active_flow_id = id; bench = Bench.createBench(data, { now }) }
  else bench.switchFlow(id, 'Sandbox')
  save()
}

// ── Drawing ───────────────────────────────────────────────────

const $ = sel => root.querySelector(sel)
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue
    if (k === 'class') e.className = v
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v)
    else e.setAttribute(k, v === true ? '' : v)
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)))
  return e
}
const nameOf = id => (id ? S.boxes.find(b => b.id === id)?.name || '?' : 'Orders in')
const filterName = l => (l.targets.length ? SECTIONS.find(s => s.id === l.targets[0].id)?.name || 'Some dishes' : 'Every dish')

// Columns by how far a box is from Orders in (the longest way there).
function lanes() {
  const depth = {}
  const ins = id => S.links.filter(l => l.to === id)
  const d = (id, seen = new Set()) => {
    if (depth[id] != null) return depth[id]
    if (seen.has(id)) return 1
    seen.add(id)
    const preds = ins(id)
    const v = preds.length ? Math.max(...preds.map(l => (l.from ? d(l.from, seen) : 0))) + 1 : 1
    depth[id] = v
    return v
  }
  const cols = [[{ id: null }]]
  for (const b of S.boxes) {
    const n = d(b.id)
    ;(cols[n] = cols[n] || []).push(b)
  }
  return cols.filter(Boolean)
}

function counts() {
  const out = {}
  if (!bench) return out
  const cfg = bench.cfg()
  const at = now()
  for (const b of S.boxes) {
    if (b.kind === 'sleeper') {
      out[b.id] = Object.values(bench.orders()).reduce((n, o) => n + o.items.filter(i => K.nodeState(i, b.id, cfg, at) === 'sleeping').length, 0)
    } else if (b.kind === 'printer') {
      out[b.id] = S.printed.filter(p => p.station_id === b.id).length
    } else if (K.isBumpKind(b.kind)) {
      out[b.id] = K.stationTickets(bench.orders(), cfg.stations[b.id], at, cfg).length
    }
  }
  return out
}

function drawFlow() {
  const canvas = $('.kf-canvas')
  const n = counts()
  const lanesEl = el('div', { class: 'kf-lanes' }, lanes().map(col => el('div', { class: 'kf-lane' }, col.map(b => boxEl(b, n)))))
  const wires = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  wires.setAttribute('class', 'kf-wires')
  wires.setAttribute('aria-hidden', 'true')
  canvas.replaceChildren(wires, lanesEl)
  requestAnimationFrame(drawWires)
  const msg = $('.kf-connect')
  if (S.connecting) {
    msg.hidden = false
    msg.querySelector('span').textContent = 'Tap the box that dishes from ' + nameOf(S.connecting === 'start' ? null : S.connecting) + ' go to next.'
  } else msg.hidden = true
  drawChecks()
}

function boxEl(b, n) {
  if (!b.kind) {
    return el('div', { class: 'kf-box kf-start' + (S.connecting === 'start' ? ' kf-from' : ''), 'data-id': 'start' },
      el('div', { class: 'kf-main kf-static' }, el('span', { class: 'kf-name' }, 'Orders in'), el('span', { class: 'kf-what' }, 'Tills, kiosks, online')),
      el('button', { type: 'button', class: 'kf-out', 'aria-label': 'Link Orders in to a box', 'aria-pressed': String(S.connecting === 'start'), onclick: () => startConnect('start') }, arrow()))
  }
  const target = S.connecting && S.connecting !== b.id
  const count = n[b.id]
  return el('div', { class: 'kf-box kind-' + b.kind + (S.selected === b.id ? ' kf-on' : '') + (target ? ' kf-target' : '') + (S.connecting === b.id ? ' kf-from' : ''), 'data-id': b.id },
    el('button', {
      type: 'button', class: 'kf-main', 'aria-pressed': String(S.selected === b.id),
      'aria-label': target ? 'Send dishes to ' + b.name : b.name + ', ' + KINDS[b.kind].what + ': settings',
      onclick: () => tapBox(b.id),
    },
    el('span', { class: 'kf-name' }, b.name),
    el('span', { class: 'kf-what' }, b.kind === 'sleeper' ? 'Holds ' + b.settings.delay_mins + ' min' : KINDS[b.kind].what),
    gets(b.id),
    count ? el('span', { class: 'kf-count', title: count + ' waiting' }, String(count)) : null),
    b.kind === 'printer' ? null : el('button', { type: 'button', class: 'kf-out', 'aria-label': 'Link ' + b.name + ' to a box', 'aria-pressed': String(S.connecting === b.id), onclick: () => startConnect(b.id) }, arrow()))
}

// Which dishes reach a box, for a phone (where the wires' labels would crowd).
function gets(id) {
  const ins = S.links.filter(l => l.to === id)
  if (!ins.length) return el('span', { class: 'kf-gets' }, 'Not linked yet')
  const names = [...new Set(ins.map(l => (l.targets.length ? filterName(l).toLowerCase() : 'every dish')))]
  return el('span', { class: 'kf-gets' }, 'Gets ' + (names.includes('every dish') ? 'every dish' : names.join(', ')))
}

function arrow() {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  s.setAttribute('viewBox', '0 0 24 24')
  s.setAttribute('aria-hidden', 'true')
  s.innerHTML = '<path d="M5 12h12m-5-5 5 5-5 5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>'
  return s
}

// The wires: from a box's right side to the next one's left (side by side),
// or from its foot to the next one's top (stacked on a phone).
function geometry() {
  const canvas = $('.kf-canvas')
  const box = canvas.getBoundingClientRect()
  const stacked = getComputedStyle($('.kf-lanes')).flexDirection === 'column'
  const rect = id => {
    const e = canvas.querySelector('[data-id="' + (id || 'start') + '"]')
    if (!e) return null
    const r = e.getBoundingClientRect()
    return { l: r.left - box.left, t: r.top - box.top, r: r.right - box.left, b: r.bottom - box.top, w: r.width, h: r.height }
  }
  return { stacked, rect, w: box.width, h: box.height }
}

function wirePath(g, from, to) {
  const a = g.rect(from), b = g.rect(to)
  if (!a || !b) return null
  if (g.stacked) {
    const x1 = a.l + a.w / 2, y1 = a.b, x2 = b.l + b.w / 2, y2 = b.t
    const dy = Math.max(24, (y2 - y1) / 2)
    return { d: `M${x1},${y1} C${x1},${y1 + dy} ${x2},${y2 - dy} ${x2},${y2}`, mx: (x1 + x2) / 2, my: (y1 + y2) / 2 }
  }
  const x1 = a.r, y1 = a.t + a.h / 2, x2 = b.l, y2 = b.t + b.h / 2
  const dx = Math.max(30, (x2 - x1) / 2)
  return { d: `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`, mx: (x1 + x2) / 2, my: (y1 + y2) / 2 }
}

function drawWires() {
  const svg = $('.kf-wires')
  if (!svg) return
  const g = geometry()
  svg.setAttribute('viewBox', '0 0 ' + g.w + ' ' + g.h)
  svg.setAttribute('width', g.w)
  svg.setAttribute('height', g.h)
  const parts = ['<defs><marker id="kf-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" fill="currentColor"/></marker></defs>']
  const labels = []
  for (const l of S.links) {
    const p = wirePath(g, l.from, l.to)
    if (!p) continue
    parts.push('<path class="kf-wire' + (l.targets.length ? ' kf-wire-some' : '') + '" d="' + p.d + '" marker-end="url(#kf-arrow)"/>')
    if (g.stacked) continue
    const t = filterName(l)
    const w = t.length * 7 + 14
    labels.push('<g class="kf-label"><rect x="' + (p.mx - w / 2) + '" y="' + (p.my - 11) + '" width="' + w + '" height="22" rx="11"/><text x="' + p.mx + '" y="' + (p.my + 4) + '">' + t + '</text></g>')
  }
  svg.innerHTML = parts.join('') + labels.join('')
}

// ── Editing ───────────────────────────────────────────────────

function startConnect(id) {
  S.connecting = S.connecting === id ? null : id
  S.selected = null
  drawFlow()
  drawPanel()
  if (S.connecting) root.querySelector('.kf-target .kf-main')?.focus()
}

function tapBox(id) {
  if (S.connecting) {
    const from = S.connecting === 'start' ? null : S.connecting
    S.connecting = null
    if (from !== id && !S.links.some(l => l.from === from && l.to === id)) {
      S.links.push({ id: uuid(), from, to: id, targets: [] })
      useFlow()
      S.selected = from
      say('Linked ' + nameOf(from) + ' to ' + nameOf(id) + '.')
    }
    drawAll()
    root.querySelector('[data-id="' + (from || 'start') + '"] .kf-out')?.focus()
    return
  }
  S.selected = S.selected === id ? null : id
  drawFlow()
  drawPanel()
}

function addBox(kind) {
  if (S.boxes.length >= MAX_BOXES) { say('That\'s plenty of boxes for a sandbox.'); return }
  const label = KINDS[kind].label
  let name = kind === 'prep' ? label + ' 1' : label
  for (let n = 2; S.boxes.some(b => b.name === name); n++) name = label + ' ' + n
  const b = { id: uuid(), name, kind, settings: kind === 'sleeper' ? { delay_mins: 10 } : {} }
  S.boxes.push(b)
  S.selected = b.id
  S.connecting = null
  useFlow()
  drawAll()
  say(name + ' added. Use its arrow to link it on, and the arrow of the box before it to send it dishes.')
}

function removeBox(id) {
  const name = nameOf(id)
  S.boxes = S.boxes.filter(b => b.id !== id)
  S.links = S.links.filter(l => l.from !== id && l.to !== id)
  S.selected = null
  useFlow()
  drawAll()
  say(name + ' removed.')
  $('.kf-add button')?.focus()
}

// The settings of the box tapped (or of Orders in's links).
function drawPanel() {
  const panel = $('.kf-panel')
  const b = S.boxes.find(x => x.id === S.selected)
  if (!b) {
    panel.replaceChildren(el('p', { class: 'kf-hint' }, 'Tap a box to rename it, choose which dishes each of its links takes, or remove it. Tap a box\'s arrow, then another box, to link them.'),
      linksEl(null))
    return
  }
  const name = el('input', { type: 'text', id: 'kf-name', value: b.name, maxlength: '30', autocomplete: 'off' })
  name.addEventListener('change', () => {
    b.name = name.value.trim().slice(0, 30) || KINDS[b.kind].label
    useFlow()
    drawAll()
  })
  const rows = [
    el('div', { class: 'kf-panel-head' }, el('h3', {}, b.name), el('span', { class: 'kf-what' }, KINDS[b.kind].label)),
    el('label', { for: 'kf-name' }, 'Name'), name,
  ]
  if (b.kind === 'sleeper') {
    const mins = el('input', { type: 'number', id: 'kf-mins', min: '1', max: '60', value: String(b.settings.delay_mins), inputmode: 'numeric' })
    mins.addEventListener('change', () => {
      b.settings.delay_mins = clampMins(mins.value)
      useFlow()
      drawAll()
    })
    rows.push(el('label', { for: 'kf-mins' }, 'Holds dishes for (minutes)'), mins)
  }
  rows.push(linksEl(b.id))
  rows.push(el('button', { type: 'button', class: 'btn kf-remove', onclick: () => removeBox(b.id) }, 'Remove ' + b.name))
  panel.replaceChildren(...rows)
}

function linksEl(from) {
  const out = S.links.filter(l => l.from === from)
  const box = from ? S.boxes.find(b => b.id === from) : null
  const wrap = el('div', { class: 'kf-links' }, el('h4', {}, 'Dishes from ' + nameOf(from) + ' go to'))
  if (!out.length) wrap.append(el('p', { class: 'kf-hint' }, box?.kind === 'printer' ? 'A printer is the end of the line.' : 'Nowhere yet: tap the arrow on ' + nameOf(from) + ', then a box.'))
  for (const l of out) {
    const id = 'kf-l-' + l.id
    const row = el('div', { class: 'kf-link' }, el('label', { for: id }, nameOf(l.to)))
    if (box?.kind === 'balance') {
      row.append(el('span', { class: 'kf-what' }, 'Shares every dish'))
    } else {
      const sel = el('select', { id }, el('option', { value: '' }, 'Every dish'), SECTIONS.map(s => el('option', { value: s.id, selected: l.targets[0]?.id === s.id }, 'Only ' + s.name.toLowerCase())))
      sel.addEventListener('change', () => {
        l.targets = sel.value ? [{ kind: 'section', id: sel.value }] : []
        useFlow()
        drawFlow()
      })
      row.append(sel)
    }
    row.append(el('button', { type: 'button', class: 'kf-x', 'aria-label': 'Remove the link to ' + nameOf(l.to), onclick: () => {
      S.links = S.links.filter(x => x !== l)
      useFlow()
      drawAll()
    } }, '×'))
    wrap.append(row)
  }
  return wrap
}

// The flow rules' own checks: problems stop the test order, warnings show.
function drawChecks() {
  const st = stationsFor()
  const problems = K.flowProblems(st, S.links)
  const warnings = K.flowWarnings(st, S.links)
  const list = $('.kf-checks')
  // Boxes the test order's dishes never reach, by the flow's own routing.
  if (!problems.length) {
    const cfg = { stations: Object.fromEntries(st.map(x => [x.id, x])), flow: S.links }
    const reached = new Set(ITEM_LIST.flatMap(i => Object.keys(K.itemRoute({ item_id: i.id, section_id: i.section_id }, cfg))))
    for (const b of S.boxes) {
      if (!reached.has(b.id) && S.links.some(l => l.to === b.id)) warnings.push('No dish in the test order reaches ' + b.name + ': a dish takes the links that name it most closely, so a link for only mains wins over one for every dish.')
    }
  }
  list.replaceChildren(...problems.map(p => el('li', { class: 'kf-bad' }, p)), ...warnings.map(w => el('li', {}, w)))
  list.hidden = !problems.length && !warnings.length
  $('.kf-send').disabled = problems.length > 0
  $('.kf-send').title = problems.length ? 'Fix the flow first' : ''
}

// ── The test order ────────────────────────────────────────────

function send() {
  const r = bench.sendOrder({
    source: 'till', tent: null,
    lines: ORDER.map(x => ({ item_id: ITEM_LIST[x.n].id, qty: x.qty })),
  })
  if (!r.ok) { say(r.error); return }
  afterChange()
  const where = Object.values(bench.orders()).find(o => o.id === r.id)?.items.some(i => Object.keys(i.route || {}).length)
  say('Order ' + r.number + ' sent: 2 Burger, Fries, Cola, Brownie.' + (where ? '' : ' Nothing in the flow takes these dishes yet.'))
}

function bump(stationId, orderId) {
  const e = { id: Ids.ulid(), type: 'kitchen.bumped', payload: { order_id: orderId, station_id: stationId }, client_at: now() }
  const res = bench.submit({ id: uuid(), name: nameOf(stationId), settings: {} }, [e]).results[0]
  if (!res.ok) say(res.error)
  afterChange()
}

// Fire now: the pretend clock jumps to when the next sleeping dish wakes.
function fire() {
  const cfg = bench.cfg()
  const at = now()
  const wakes = Object.values(bench.orders()).flatMap(o => o.items.flatMap(i => K.itemSleeps(i, cfg, at).map(s => s.until))).filter(Boolean)
  if (!wakes.length) return
  const first = Math.min(...wakes.map(w => Date.parse(w)))
  S.offset += Math.max(0, first - Date.parse(at)) + 1000
  afterChange()
  say('Fired: the dishes the Sleeper held have gone on.')
}

function afterChange() {
  const cfg = bench.cfg()
  const at = now()
  const { jobs } = Print.kitchenPrintJobs(bench.orders(), cfg, at)
  for (const j of jobs) S.printed.unshift({ station_id: j.station_id, title: j.title, html: Html.previewHtml(j.ops, 32) })
  S.printed = S.printed.slice(0, 8)
  const moves = []
  for (const o of Object.values(bench.orders())) {
    for (const i of o.items) {
      const t = K.flowTimes(i, cfg, at)
      for (const [node, preds] of Object.entries(i.route || {})) {
        const key = i.id + '|' + node
        if (S.arrived.has(key) || !t.arrived(node)) continue
        S.arrived.add(key)
        for (const p of preds) moves.push({ from: p === K.START ? null : p, to: node, label: (i.qty > 1 ? i.qty + ' ' : '') + i.name })
      }
    }
  }
  drawAll()
  animate(moves)
}

// Dishes travelling along the wires they just took.
function animate(moves) {
  const svg = $('.kf-wires')
  if (!svg || !moves.length || reduce) return
  const g = geometry()
  const ns = 'http://www.w3.org/2000/svg'
  moves.slice(0, 24).forEach((m, k) => {
    const p = wirePath(g, m.from, m.to)
    if (!p) return
    const path = document.createElementNS(ns, 'path')
    path.setAttribute('d', p.d)
    path.setAttribute('fill', 'none')
    svg.append(path)
    const len = path.getTotalLength()
    const dot = document.createElementNS(ns, 'g')
    dot.setAttribute('class', 'kf-dish')
    const w = m.label.length * 7 + 16
    dot.innerHTML = '<rect x="' + (-w / 2) + '" y="-12" width="' + w + '" height="24" rx="12"/><text y="4">' + m.label.replace(/[<&]/g, '') + '</text>'
    svg.append(dot)
    const start = performance.now() + k * 120
    const dur = 900
    const step = t => {
      const f = Math.min(1, Math.max(0, (t - start) / dur))
      const pt = path.getPointAtLength(len * f)
      dot.setAttribute('transform', 'translate(' + pt.x + ',' + pt.y + ')')
      dot.style.opacity = f >= 1 ? '0' : '1'
      if (f < 1) requestAnimationFrame(step)
      else { dot.remove(); path.remove() }
    }
    requestAnimationFrame(step)
  })
}

// ── What each screen shows ────────────────────────────────────

function drawScreens() {
  const wrap = $('.kf-screens')
  const cfg = bench.cfg()
  const at = now()
  const cards = []
  for (const b of S.boxes) {
    const st = cfg.stations[b.id]
    if (!st) continue
    if (K.isBumpKind(b.kind)) {
      const tickets = K.stationTickets(bench.orders(), st, at, cfg)
      cards.push(el('section', { class: 'kf-screen', 'aria-label': b.name + ' kitchen screen' },
        el('h3', {}, b.name, el('span', { class: 'kf-what' }, b.kind === 'expo' ? 'The pass' : 'Kitchen screen')),
        tickets.length ? tickets.map(t => ticketEl(b, t, at)) : el('p', { class: 'kf-empty' }, 'No tickets')))
    } else if (b.kind === 'sleeper') {
      const held = Object.values(bench.orders()).flatMap(o => o.items.flatMap(i => K.itemSleeps(i, cfg, at).filter(s => s.station_id === b.id).map(s => ({ i, o, until: s.until }))))
      cards.push(el('section', { class: 'kf-screen kf-sleeper', 'aria-label': b.name },
        el('h3', {}, b.name, el('span', { class: 'kf-what' }, 'Sleeper, ' + b.settings.delay_mins + ' min')),
        held.length
          ? [el('ul', { class: 'kf-held' }, held.map(h => el('li', {}, h.i.qty + ' ' + h.i.name + ' (order ' + h.o.number + '), wakes in ', el('span', { 'data-until': h.until }, minsLeft(h.until, at))))),
              el('button', { type: 'button', class: 'btn btn-primary kf-fire', onclick: fire }, 'Fire now')]
          : el('p', { class: 'kf-empty' }, 'Holding nothing')))
    } else if (b.kind === 'printer') {
      const mine = S.printed.filter(p => p.station_id === b.id).slice(0, 3)
      cards.push(el('section', { class: 'kf-screen kf-printer', 'aria-label': b.name },
        el('h3', {}, b.name, el('span', { class: 'kf-what' }, 'Printer')),
        mine.length ? mine.map(p => { const d = el('div', { class: 'tk kf-paper', 'aria-label': 'Printed ticket ' + p.title }); d.innerHTML = p.html; return d }) : el('p', { class: 'kf-empty' }, 'Nothing printed')))
    }
  }
  wrap.replaceChildren(...cards)
}

function minsLeft(until, at) {
  const s = Math.max(0, Math.round((Date.parse(until) - Date.parse(at)) / 1000))
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')
}

function ticketEl(b, t, at) {
  const o = t.order
  const states = { active: '', upcoming: 'Not here yet', held: 'Held', sleeping: 'Sleeping', done: 'Done', voided: 'Void' }
  const live = t.items.some(i => i.state === 'active')
  return el('article', { class: 'kf-ticket' },
    el('header', {}, el('b', {}, 'Order ' + o.number), el('span', {}, K.clockSince(t.since, at))),
    el('ul', {}, t.items.map(i => el('li', { class: 'st-' + i.state },
      el('span', { class: 'q' }, String(i.qty)), el('span', { class: 'n' }, i.name),
      i.state !== 'active' ? el('em', {}, i.sleeps?.length ? 'Sleeping' : states[i.state] || '') : null))),
    t.sleeping_until ? el('p', { class: 'kf-note' }, 'Wakes in ', el('span', { 'data-until': t.sleeping_until }, minsLeft(t.sleeping_until, at))) : null,
    el('button', { type: 'button', class: 'btn kf-bump', disabled: !live, onclick: () => bump(b.id, o.id) }, b.kind === 'expo' ? 'Ready' : 'Done'))
}

// ── Everything ────────────────────────────────────────────────

let live = $('.kf-live')
function say(text) { live.textContent = ''; setTimeout(() => { live.textContent = text }, 30) }

function drawAll() {
  drawFlow()
  drawPanel()
  drawScreens()
}

function reset() {
  const d = defaultFlow()
  S.boxes = d.boxes
  S.links = d.links
  S.selected = null
  S.connecting = null
  S.offset = 0
  S.printed = []
  S.arrived = new Set()
  bench = null
  data.flows = []
  useFlow()
  drawAll()
  say('Back to the starting kitchen, with no orders.')
}

const style = document.createElement('style')
style.textContent = Html.PREVIEW_CSS
document.head.append(style)

$('.kf-add').replaceChildren(...ADDABLE.map(k => el('button', { type: 'button', class: 'btn kf-addbtn', onclick: () => addBox(k) }, '+ ' + KINDS[k].label)))
$('.kf-send').addEventListener('click', send)
$('.kf-reset').addEventListener('click', reset)
$('.kf-connect button').addEventListener('click', () => startConnect(S.connecting))
document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.connecting) startConnect(S.connecting) })
let raf = 0
window.addEventListener('resize', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(drawWires) })
// The Sleepers' clocks tick; when one wakes, its dishes go on.
setInterval(() => {
  if (!bench || document.hidden) return
  const at = now()
  let woke = false
  for (const span of root.querySelectorAll('[data-until]')) {
    span.textContent = minsLeft(span.dataset.until, at)
    if (Date.parse(span.dataset.until) <= Date.parse(at)) woke = true
  }
  if (woke) afterChange()
}, 1000)

useFlow()
drawAll()
root.classList.add('kf-ready')
