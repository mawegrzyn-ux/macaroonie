// The kitchen walkthrough on macaroonie.com/try/kitchen-flow
// (views/platform/site/try-kitchen-flow.eta). A module, no build.
//
// A guided Friday service at an invented restaurant: the story (chapters,
// steps, what each step does) is kitchen-story.js, replayed on the real
// kitchen rules served by the API at /site/shared/<version>/
// (services/platformSite/sharedModules.js): the test bench's pretend kitchen
// (shared/pos/kitchenBench.js) stands in for the sequencer, and every
// ticket, wake, split, print, status and timer drawn here comes from
// shared/pos/kitchen.js, kitchenPrint.js, kitchenTimers.js and
// kitchenColours.js (rule 12). This file only draws: the kitchen map, the
// screens a step needs (station screens as the kitchen screen app draws
// them, a printer's paper, the order ready board, the flow timers) and the
// narration. A step is shown by replaying the story to it from nothing, so
// Back and deep links (#step-7) always show the same kitchen. Nothing is
// sent or kept.

const root = document.getElementById('kw')
const base = root.dataset.shared
const [K, Bench, Print, Html, Timers, Colours, Story] = await Promise.all([
  import(base + 'pos/kitchen.js'),
  import(base + 'pos/kitchenBench.js'),
  import(base + 'pos/kitchenPrint.js'),
  import(base + 'pos/ticketHtml.js'),
  import(base + 'pos/kitchenTimers.js'),
  import(base + 'pos/kitchenColours.js'),
  import(root.dataset.story),
])

const story = Story.kitchenStory({ K, Bench, Print, Timers })
const { steps, chapters, boxes, links } = story
const LAST = steps.length
const BOX = Object.fromEntries(boxes.map(b => [b.key, b]))
const KEY_OF = Object.fromEntries(boxes.filter(b => b.id).map(b => [b.id, b.key]))
const LOOK = Colours.ticketColours({})
const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
const narrowQuery = window.matchMedia('(max-width: 699px)')
const NS = 'http://www.w3.org/2000/svg'
// The designer's box colours (admin KitchenFlow.jsx KIND_STRIP).
const STRIP = { start: '#71717a', prep: '#0ea5e9', expo: '#f59e0b', runner: '#8b5cf6', board: '#059669', balance: '#f43f5e', printer: '#57534e', sleeper: '#6366f1', setter: '#f97316' }
const KIND_NAMES = { prep: 'Kitchen screen', expo: 'Pass screen', runner: 'Runners\' screen', board: 'Order ready board', balance: 'Splitter', printer: 'Kitchen printer', sleeper: 'Sleeper', setter: 'Setter' }
const SOURCE_NAMES = { online: 'Online', gloriafood: 'GloriaFood' }
// Ticket badge colours by order type position, as the kitchen screen's TYPE_COLOURS.
const TYPE_COLOURS = [['#9be7a1', '#000'], ['#25a7a7', '#fff'], ['#7c5cd6', '#fff'], ['#e0a33a', '#000'], ['#d6577c', '#fff']]
const TYPE_INDEX = Object.fromEntries(story.data.order_types.map((t, i) => [t.id, i]))

const S = { n: 1, playing: false, timer: 0, moreScreens: false, raf: 0 }

// ── Small helpers ─────────────────────────────────────────────

const $ = sel => root.querySelector(sel)
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue
    if (k === 'class') e.className = v
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v)
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v)
    else e.setAttribute(k, v === true ? '' : v)
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)))
  return e
}
function svg(tag, attrs = {}) {
  const e = document.createElementNS(NS, tag)
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v)
  return e
}
const hhmm = iso => Story.hhmm(iso)
const plural = (n, one, many = one + 's') => n + ' ' + (n === 1 ? one : many)
const reduce = () => motionQuery.matches

// ── The map ───────────────────────────────────────────────────

const size = b => ({ w: Story.BOX_W, h: b.h || Story.BOX_H })
const outPt = b => ({ x: b.x + size(b).w, y: b.y + size(b).h / 2 })
const inPt = b => ({ x: b.x, y: b.y + size(b).h / 2 })
function curve(a, b) {
  const dx = Math.max(28, (b.x - a.x) / 2)
  return 'C' + (a.x + dx) + ',' + a.y + ' ' + (b.x - dx) + ',' + b.y + ' ' + b.x + ',' + b.y
}
const linkKey = (from, to) => from + '>' + to
const LINK_KEYS = new Set(links.map(l => linkKey(KEY_OF[l.from] || 'start', KEY_OF[l.to])))

// The way a move took on the map: its link, or through the Splitter that
// decided it (a dish's way never names the Splitter once it is decided).
function wayOf(from, to) {
  if (LINK_KEYS.has(linkKey(from, to))) return [[from, to]]
  const via = boxes.find(b => b.kind === 'balance' && LINK_KEYS.has(linkKey(from, b.key)) && LINK_KEYS.has(linkKey(b.key, to)))
  return via ? [[from, via.key], [via.key, to]] : []
}
function pathOf(way) {
  let d = ''
  for (const [from, to] of way) {
    const a = outPt(BOX[from])
    const b = inPt(BOX[to])
    d += (d ? ' L' : 'M') + a.x + ',' + a.y + ' ' + curve(a, b)
  }
  return d
}

let mapSvg = null
function buildMap() {
  mapSvg = svg('svg', { viewBox: '-16 -16 ' + (Story.MAP_W + 32) + ' ' + (Story.MAP_H + 32), class: 'kw-svg', 'aria-hidden': 'true', focusable: 'false' })
  mapSvg.innerHTML = '<defs>'
    + '<marker id="kw-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" fill="#a8a29e"/></marker>'
    + '<marker id="kw-arrow-lit" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" fill="#630812"/></marker>'
    + '</defs>'
  const wires = svg('g', { class: 'kw-wires' })
  for (const l of links) {
    const from = KEY_OF[l.from] || 'start'
    const to = KEY_OF[l.to]
    wires.append(svg('path', { d: pathOf([[from, to]]), class: 'kw-wire', 'data-link': linkKey(from, to), 'marker-end': 'url(#kw-arrow)' }))
  }
  mapSvg.append(wires)
  const nodes = svg('g', { class: 'kw-nodes' })
  for (const b of boxes) {
    const { w, h } = size(b)
    const g = svg('g', { class: 'kw-node kind-' + b.kind, 'data-box': b.key, transform: 'translate(' + b.x + ',' + b.y + ')' })
    g.append(svg('rect', { class: 'kw-node-bg', width: w, height: h, rx: 10 }))
    g.append(svg('rect', { width: 7, height: h, rx: 3, fill: STRIP[b.kind] }))
    const name = svg('text', { x: 16, y: b.kind === 'start' ? 34 : 25, class: 'kw-node-name' })
    name.textContent = b.name
    g.append(name)
    const roleLines = b.kind === 'start' ? ['Till, kiosk,', 'website and', 'GloriaFood'] : [b.role]
    roleLines.forEach((t, i) => {
      const r = svg('text', { x: 16, y: (b.kind === 'start' ? 58 : 45) + i * 18, class: 'kw-node-role' })
      r.textContent = t
      g.append(r)
    })
    const badge = svg('g', { class: 'kw-badge', transform: 'translate(' + (w - 4) + ',2)' })
    badge.append(svg('circle', { r: 14 }))
    badge.append(svg('text', { y: 5 }))
    g.append(badge)
    nodes.append(g)
  }
  mapSvg.append(nodes)
  mapSvg.append(svg('g', { class: 'kw-movers' }))
  $('.kw-map').replaceChildren(mapSvg)
}

// What each box holds now, for its badge.
function boxCounts(s) {
  const out = {}
  for (const b of boxes) {
    if (!b.id) continue
    const st = s.cfg.stations[b.id]
    if (K.isBumpKind(b.kind)) out[b.key] = K.stationTickets(s.orders, st, s.at, s.cfg).length
    else if (b.kind === 'sleeper') out[b.key] = sleeping(s, b).length
    else if (b.kind === 'printer') out[b.key] = s.printed.filter(p => p.box === b.key).length
    else if (b.kind === 'board') out[b.key] = board(s).ready.length
    else if (b.kind === 'setter') out[b.key] = Object.values(s.orders).filter(o => ['active', 'ready'].includes(o.status) && K.orderStatus(o, s.cfg, s.at)?.id === b.id).length
  }
  return out
}

function drawMap(s, step, animate) {
  const lit = new Set()
  const ways = []
  const seen = new Set()
  for (const m of s.moves) {
    const way = wayOf(m.from, m.to)
    if (!way.length) continue
    for (const [a, b] of way) lit.add(linkKey(a, b))
    const k = m.order + '|' + m.label + '|' + m.from + '|' + m.to
    if (!seen.has(k)) { seen.add(k); ways.push({ way, label: m.label }) }
  }
  const on = new Set([...(step.lit || []), ...s.moves.flatMap(m => [m.from, m.to])])
  for (const p of mapSvg.querySelectorAll('.kw-wire')) {
    const isLit = lit.has(p.dataset.link)
    p.classList.toggle('kw-lit', isLit)
    p.setAttribute('marker-end', isLit ? 'url(#kw-arrow-lit)' : 'url(#kw-arrow)')
  }
  // Lit wires on top of the others.
  const wires = mapSvg.querySelector('.kw-wires')
  for (const p of [...wires.querySelectorAll('.kw-lit')]) wires.append(p)
  const counts = boxCounts(s)
  for (const g of mapSvg.querySelectorAll('.kw-node')) {
    const key = g.dataset.box
    g.classList.toggle('kw-on', on.has(key))
    const n = counts[key] || 0
    const badge = g.querySelector('.kw-badge')
    badge.style.display = n ? '' : 'none'
    badge.querySelector('text').textContent = n > 99 ? '99+' : String(n)
  }
  const movers = mapSvg.querySelector('.kw-movers')
  movers.replaceChildren()
  cancelAnimationFrame(S.raf)
  if (!animate || reduce() || !ways.length) return
  const list = ways.slice(0, 28)
  const runs = list.map((w, k) => {
    const path = svg('path', { d: pathOf(w.way), fill: 'none', stroke: 'none' })
    movers.append(path)
    const label = w.label.length > 18 ? w.label.slice(0, 17) + '.' : w.label
    const width = label.length * 8.4 + 18
    const dot = svg('g', { class: 'kw-dish', opacity: '0' })
    dot.append(svg('rect', { x: -width / 2, y: -13, width, height: 26, rx: 13 }))
    const t = svg('text', { y: 5 })
    t.textContent = label
    dot.append(t)
    movers.append(dot)
    return { path, dot, len: path.getTotalLength(), delay: k * 140, dur: 1100 * w.way.length }
  })
  const start = performance.now()
  const frame = now => {
    let busy = false
    for (const r of runs) {
      const f = Math.min(1, Math.max(0, (now - start - r.delay) / r.dur))
      if (f < 1) busy = true
      const pt = r.path.getPointAtLength(r.len * f)
      r.dot.setAttribute('transform', 'translate(' + pt.x + ',' + pt.y + ')')
      r.dot.setAttribute('opacity', f <= 0 || f >= 1 ? '0' : '1')
    }
    if (busy) S.raf = requestAnimationFrame(frame)
    else movers.replaceChildren()
  }
  S.raf = requestAnimationFrame(frame)
}

// ── The screens ───────────────────────────────────────────────

const sleeping = (s, b) => Object.values(s.orders).flatMap(o => o.items.flatMap(i =>
  K.itemSleeps(i, s.cfg, s.at).filter(x => x.station_id === b.id).map(x => ({ o, i, until: x.until }))))
const board = s => K.boardNumbers(s.orders, s.at, { boardId: BOX.board.id, cfg: s.cfg })
const orderTitle = o => (o.table ? 'Tbl ' + o.table : o.tab || o.guest || SOURCE_NAMES[o.source] || 'Counter')
const focusIds = (s, step) => new Set((step.focus || []).map(k => s.ids[k]).filter(Boolean))

function screenFrame(b, sub, body, extra = '') {
  return el('section', { class: 'kw-screen kw-screen-' + b.kind + extra, 'aria-label': b.name + ', ' + sub },
    el('header', { class: 'kw-screen-head' },
      el('span', { class: 'kw-strip', style: { background: STRIP[b.kind] } }),
      el('b', {}, b.name), el('span', { class: 'kw-screen-sub' }, sub)),
    body)
}

function stationScreen(s, step, b) {
  const st = s.cfg.stations[b.id]
  const list = K.stationTickets(s.orders, st, s.at, s.cfg)
  // NEW: dishes reached this screen in the last 30 seconds (the screen's own alert).
  const fresh = t => t.items.some(i => {
    const reached = K.flowTimes(i, s.cfg, s.at).arrived(b.id)
    return reached && Date.parse(s.at) - Date.parse(reached) < 30000
  })
  const focus = focusIds(s, step)
  const max = narrowQuery.matches ? 3 : 6
  const shown = list.slice(0, max)
  const body = el('div', { class: 'kw-tickets' },
    shown.length ? shown.map((t, k) => ticketEl(s, b, st, t, k + 1, fresh(t), focus.has(t.order.id))) : el('p', { class: 'kw-empty' }, 'No tickets'),
    list.length > max ? el('p', { class: 'kw-more-tickets' }, '+ ' + plural(list.length - max, 'more ticket')) : null)
  return screenFrame(b, KIND_NAMES[b.kind] + ', ' + plural(list.length, 'ticket'), body)
}

function groupByCourse(items) {
  const map = new Map()
  for (const i of items) {
    const key = (i.state === 'held' ? 'h:' : '') + (i.course_id || '')
    if (!map.has(key)) map.set(key, { key, title: i.course || (i.state === 'held' && i.fire_at ? 'Later' : null), held: i.state === 'held', sort: i.course_sort ?? -1, items: [] })
    map.get(key).items.push(i)
  }
  return [...map.values()].sort((a, b) => (a.held ? 1 : 0) - (b.held ? 1 : 0) || a.sort - b.sort)
}

// One ticket, laid out as the kitchen screen app's Ticket (pos/src/kitchen/KitchenApp.jsx).
function ticketEl(s, b, st, t, n, fresh, focus) {
  const o = t.order
  const asleep = !!t.sleeping_until
  const tone = asleep ? 'ok' : K.ageTone(t.since, s.at, st)
  const look = Colours.ticketLook(t, st, fresh)
  const head = LOOK[look.key]
  const timer = tone === 'late' ? LOOK.timer_late : tone === 'warn' ? LOOK.timer_warn : null
  const names = id => BOX[KEY_OF[id]]?.name || 'another station'
  const typeIndex = TYPE_INDEX[o.type] ?? 2
  const [typeBg, typeInk] = TYPE_COLOURS[typeIndex % TYPE_COLOURS.length]
  const orderLevel = K.isOrderLevel(st)
  const toneWords = { ok: '', warn: ', past its target time', late: ', late' }
  const label = orderTitle(o) + (o.number ? ', order ' + o.number : '') + ', ' + (asleep ? 'waiting until ' + hhmm(t.sleeping_until) : K.clockSince(t.since, s.at) + ' minutes') + toneWords[tone]
  return el('article', { class: 'kw-ticket' + (focus ? ' kw-focus' : ''), 'aria-label': label, 'data-look': look.key, 'data-tone': tone },
    el('div', { class: 'kw-thead', style: { background: head.bg, color: head.ink } },
      el('div', { class: 'kw-trow' },
        el('span', { class: 'kw-ttitle' }, orderTitle(o)),
        o.number ? el('span', { class: 'kw-tbadge' }, o.number) : null,
        el('span', { class: 'kw-ttimer' + (timer ? '' : ' kw-tquiet'), style: timer ? { background: timer.bg, color: timer.ink } : null },
          asleep ? 'at ' + hhmm(t.sleeping_until) : K.clockSince(t.since, s.at))),
      el('div', { class: 'kw-trow kw-tsub' },
        el('span', { class: 'kw-tn' }, '#' + n),
        o.priority ? el('b', {}, 'RUSH') : null,
        fresh && !o.priority ? el('b', {}, 'NEW') : null,
        o.source === 'gloriafood' ? el('span', { class: 'kw-tsrc' }, 'GloriaFood') : null,
        look.checked ? el('b', {}, 'CHECKED') : look.prepared ? el('b', {}, 'PREPARED') : null,
        orderLevel && !look.checked && t.ticked > 0 ? el('span', {}, t.ticked + ' ticked') : null,
        o.type_name ? el('span', { class: 'kw-ttype', style: { background: typeBg, color: typeInk } }, o.type_name) : null,
        o.promised_at ? el('span', {}, 'for ' + hhmm(o.promised_at)) : null,
        o.covers ? el('span', { class: 'kw-tcvr' }, o.covers + ' cvr') : null)),
    o.allergy ? el('div', { class: 'kw-tallergy' }, 'Allergy: ' + o.allergy) : null,
    o.note ? el('div', { class: 'kw-tnote' }, o.note) : null,
    t.elsewhere?.length ? el('div', { class: 'kw-telse' }, 'Also on this order: ' + t.elsewhere.map(x => x.count + ' via ' + names(x.station_id)).join(', ')) : null,
    groupByCourse(t.items).map(g => [
      g.title ? el('div', { class: 'kw-tcourse' + (g.held ? ' kw-theld' : '') }, (g.held ? 'Hold \u00b7 ' : '') + g.title) : null,
      g.items.map(i => rowEl(i, orderLevel, names)),
    ]))
}

function rowEl(i, orderLevel, names) {
  const key = Colours.rowLook(i)
  const c = LOOK[key]
  const ticked = key === 'ticked'
  const info = (cls, text) => el('div', { class: 'kw-tinfo ' + cls }, text)
  const from = (i.from || []).map(id => names(id))
  return el('div', { class: 'kw-titem', 'data-look': key, style: { background: c.bg, color: c.ink } },
    el('div', { style: c.dim < 1 ? { opacity: c.dim } : null },
      el('div', { class: 'kw-tline' + (i.state === 'voided' ? ' kw-tvoid' : '') },
        el('span', { class: 'kw-tq' }, String(i.qty)),
        el('span', { class: 'kw-tname' }, i.name),
        !ticked && i.parts_ticked > 0 ? el('span', { class: 'kw-tchip' }, i.parts_ticked + '/' + i.parts.length) : null,
        ticked ? el('span', { class: 'kw-ttick', 'aria-label': orderLevel ? 'ticked off' : 'done' }, '\u2713') : null,
        i.state === 'voided' ? el('span', { class: 'kw-tchip kw-tchip-void' }, 'VOID') : null,
        i.remakes > 0 ? el('span', { class: 'kw-tchip kw-tchip-remake' }, 'REMAKE') : null),
      i.state === 'upcoming' && i.sleeps?.length ? info('kw-tsleeps', 'Waiting at ' + i.sleeps.map(x => names(x.station_id)).join(', ') + ' until ' + hhmm(i.sleeps.map(x => x.until).sort().pop())) : null,
      i.state === 'upcoming' && i.where?.length ? info('kw-twhere', 'At ' + i.where.map(names).join(', ')) : null,
      i.state === 'active' && !orderLevel && from.length ? info('kw-tfrom', 'From ' + from.join(', ')) : null,
      (i.mods || []).map(m => el('div', { class: 'kw-tmod kw-tmod-' + m.kind }, m.text)),
      i.parts ? K.partRows(i.parts).map(r => el('div', { class: 'kw-tpart' + (r.ticked && !ticked ? ' kw-tpart-done' : '') },
        el('span', {}, '\u203a ' + (r.count > 1 ? r.count + ' x ' : '') + r.part.name), r.ticked ? el('span', { class: 'kw-ttick' }, '\u2713') : null)) : null,
      i.note ? el('div', { class: 'kw-tnote kw-tnote-item' }, i.note) : null))
}

function printerScreen(s, step, b) {
  const all = s.printed.filter(p => p.box === b.key)
  const recent = all.slice(-3).reverse()
  const body = el('div', { class: 'kw-papers' },
    recent.length ? recent.map(p => {
      const paper = el('div', { class: 'tk kw-paper' + (p.step === s.n ? ' kw-paper-new' : ''), 'aria-label': 'Printed at ' + hhmm(p.at) + ': ' + p.title })
      paper.innerHTML = Html.previewHtml(p.ops, 32)
      return el('figure', {}, paper, el('figcaption', {}, (p.step === s.n ? 'Just printed, ' : 'Printed ') + hhmm(p.at)))
    }) : el('p', { class: 'kw-empty' }, 'Nothing printed yet'))
  return screenFrame(b, 'Kitchen printer, ' + plural(all.length, 'ticket') + ' tonight', body)
}

function sleeperScreen(s, step, b) {
  const held = sleeping(s, b)
  const body = el('div', { class: 'kw-plain' },
    el('p', { class: 'kw-plain-note' }, 'No screen: it holds dishes for ' + b.settings.delay_mins + ' minutes, then sends them on by itself.'),
    held.length
      ? el('ul', { class: 'kw-held' }, held.map(h => el('li', {},
        el('b', {}, h.i.parts ? h.i.parts.filter(p => p.route?.[b.id]).map(p => p.name).join(', ') + ' (' + h.i.name + ')' : h.i.qty + ' ' + h.i.name),
        ' for ' + orderTitle(h.o) + ', wakes at ' + hhmm(h.until))))
      : el('p', { class: 'kw-empty' }, 'Holding nothing now'))
  return screenFrame(b, 'Sleeper', body, ' kw-screen-plain')
}

function boardScreen(s, step, b) {
  const nums = board(s)
  const focus = focusIds(s, step)
  const tile = (x, ready) => el('li', { class: 'kw-num' + (focus.has(x.id) ? ' kw-focus' : '') + (ready ? ' kw-num-ready' : '') },
    el('span', { class: 'kw-num-n' }, x.number),
    x.name ? el('span', { class: 'kw-num-name' }, x.name) : null,
    x.status && !ready ? el('span', { class: 'kw-num-status', style: { background: x.status.colour } }, x.status.text) : null)
  const col = (title, list, ready) => el('div', { class: 'kw-board-col' },
    el('h3', {}, title),
    list.length ? el('ul', {}, list.map(x => tile(x, ready))) : el('p', { class: 'kw-empty' }, 'None'))
  const body = el('div', { class: 'kw-board' }, col('Preparing', nums.preparing, false), col('Ready', nums.ready, true))
  return screenFrame(b, 'Order ready board', body)
}

function mins(secs) {
  if (secs == null) return '-'
  return K.clockSecs(secs)
}

function timersScreen(s) {
  const rows = s.timers.map(t => el('tr', {},
    el('th', { scope: 'row' }, t.name, el('span', { class: 'kw-timer-target' }, 'target ' + t.target_mins + ' min, ' + (t.per === 'ticket' ? 'per order' : 'per dish'))),
    el('td', {}, String(t.result.count)),
    el('td', {}, mins(t.result.avg_secs)),
    el('td', {}, mins(t.result.max_secs)),
    el('td', { class: t.result.on_time_pct >= 80 ? 'kw-good' : t.result.on_time_pct >= 50 ? 'kw-meh' : 'kw-bad' }, t.result.on_time_pct == null ? '-' : t.result.on_time_pct + '%')))
  const stats = boxes.filter(b => K.isBumpKind(b.kind)).map(b => ({ b, x: K.stationStats(s.orders, s.cfg.stations[b.id]) })).filter(r => r.x.done)
  const slow = s.timers.find(t => t.id === 'tm-bag')?.result.slowest || []
  const body = el('div', { class: 'kw-plain' },
    el('div', { class: 'kw-table-wrap' }, el('table', { class: 'kw-table' },
      el('caption', {}, 'Flow timers, 6:25 to ' + hhmm(s.at)),
      el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Timer'), el('th', { scope: 'col' }, 'Count'), el('th', { scope: 'col' }, 'Average'), el('th', { scope: 'col' }, 'Slowest'), el('th', { scope: 'col' }, 'On time'))),
      el('tbody', {}, rows))),
    slow.length ? el('p', { class: 'kw-plain-note' }, 'Slowest bags: ' + slow.slice(0, 3).map(r => r.number + ' (' + mins(r.seconds) + ')').join(', ') + '.') : null,
    el('div', { class: 'kw-table-wrap' }, el('table', { class: 'kw-table' },
      el('caption', {}, 'Each screen tonight'),
      el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Screen'), el('th', { scope: 'col' }, 'Bumps'), el('th', { scope: 'col' }, 'Average'), el('th', { scope: 'col' }, 'On time'))),
      el('tbody', {}, stats.map(r => el('tr', {}, el('th', { scope: 'row' }, r.b.name), el('td', {}, String(r.x.done)), el('td', {}, mins(r.x.avg_secs)), el('td', {}, r.x.on_time_pct + '%')))))))
  return el('section', { class: 'kw-screen kw-screen-timers kw-screen-plain', 'aria-label': 'Flow timers' },
    el('header', { class: 'kw-screen-head' }, el('span', { class: 'kw-strip', style: { background: '#7c3aed' } }), el('b', {}, 'Flow timers'), el('span', { class: 'kw-screen-sub' }, 'The kitchen report\'s figures')),
    body)
}

function screenFor(s, step, key) {
  if (key === 'timers') return timersScreen(s)
  const b = BOX[key]
  if (K.isBumpKind(b.kind)) return stationScreen(s, step, b)
  if (b.kind === 'printer') return printerScreen(s, step, b)
  if (b.kind === 'sleeper') return sleeperScreen(s, step, b)
  if (b.kind === 'board') return boardScreen(s, step, b)
  return null
}

function drawScreens(s, step) {
  const wrap = $('.kw-screens')
  const keys = step.show || []
  const one = narrowQuery.matches && !S.moreScreens
  const shown = one ? keys.slice(0, 1) : keys
  const kids = shown.map(k => screenFor(s, step, k)).filter(Boolean)
  if (narrowQuery.matches && keys.length > 1) {
    kids.push(el('button', {
      type: 'button', class: 'btn btn-ghost kw-more', 'aria-expanded': String(!one),
      onclick: () => { S.moreScreens = !S.moreScreens; drawScreens(s, step) },
    }, one ? 'Show ' + plural(keys.length - 1, 'more screen') : 'Show only the first screen'))
  }
  wrap.replaceChildren(...kids)
  wrap.dataset.count = String(shown.length)
}

// ── Narration, chapters, controls ─────────────────────────────

function drawChapters() {
  const list = el('ol', { class: 'kw-chlist' }, chapters.map((c, ci) => {
    const mine = steps.filter(x => x.chapter === c.id)
    return el('li', { class: 'kw-ch', 'data-chapter': c.id },
      el('button', { type: 'button', class: 'kw-chbtn', onclick: () => go(mine[0].n, { manual: true }) },
        el('span', { class: 'kw-chno' }, String(ci + 1)), c.title),
      el('ol', { class: 'kw-dots' }, mine.map(x => el('li', {},
        el('button', { type: 'button', class: 'kw-dot', 'data-step': x.n, 'aria-label': 'Step ' + x.n + ': ' + x.title, title: x.title, onclick: () => go(x.n, { manual: true }) }, String(x.n))))))
  }))
  $('.kw-chapters').replaceChildren(list)
}

function drawNarration(s, step) {
  const ch = chapters.find(c => c.id === step.chapter)
  $('.kw-count').textContent = 'Step ' + step.n + ' of ' + LAST + ' \u00b7 ' + ch.title
  $('.kw-clock').textContent = 'Friday ' + hhmm(s.at)
  $('.kw-title').textContent = step.title
  $('.kw-text').replaceChildren(...step.text.map(t => el('p', {}, t)))
  const names = (step.show || []).map(k => (k === 'timers' ? 'the flow timers' : BOX[k].name))
  const look = $('.kw-look')
  look.hidden = !names.length
  look.textContent = names.length ? 'Look at: ' + names.join(', ') + '.' : ''
  for (const d of root.querySelectorAll('.kw-dot')) {
    const n = Number(d.dataset.step)
    if (n === step.n) d.setAttribute('aria-current', 'step')
    else d.removeAttribute('aria-current')
    d.classList.toggle('kw-seen', n < step.n)
  }
  for (const c of root.querySelectorAll('.kw-ch')) c.classList.toggle('kw-ch-on', c.dataset.chapter === step.chapter)
  $('.kw-back').disabled = step.n <= 1
  $('.kw-next').disabled = step.n >= LAST
  $('.kw-restart').disabled = step.n <= 1 && !S.playing
}

function say(step) {
  const live = $('.kw-live')
  live.textContent = ''
  setTimeout(() => { live.textContent = 'Step ' + step.n + ' of ' + LAST + ': ' + step.title + '. ' + step.text.join(' ') }, 40)
}

function show(n, { animate = false } = {}) {
  const step = steps[n - 1]
  const s = story.play(n)
  s.n = n
  drawNarration(s, step)
  drawMap(s, step, animate)
  drawScreens(s, step)
}

function go(n, { manual = false, from = 'button' } = {}) {
  const to = Math.min(LAST, Math.max(1, n))
  if (manual) stop()
  const forward = to === S.n + 1
  S.n = to
  S.moreScreens = false
  try {
    if (from !== 'hash') history.replaceState(null, '', '#step-' + to)
  } catch { /* the address isn't updated: the page still works */ }
  show(to, { animate: forward })
  say(steps[to - 1])
  if (S.playing) schedule()
}

// Play: each step stays long enough to read, then the next one comes.
function dwell(step) {
  const words = (step.title + ' ' + step.text.join(' ')).split(/\s+/).length
  return Math.max(7000, Math.min(16000, words * 230))
}
function schedule() {
  clearTimeout(S.timer)
  if (!S.playing) return
  if (S.n >= LAST) { stop(); return }
  S.timer = setTimeout(() => {
    if (!S.playing) return
    go(S.n + 1)
  }, dwell(steps[S.n - 1]))
}
function setPlay(on) {
  S.playing = on
  const b = $('.kw-play')
  b.setAttribute('aria-pressed', String(on))
  b.textContent = on ? 'Pause' : 'Play'
  $('.kw-restart').disabled = S.n <= 1 && !on
  if (on) {
    if (S.n >= LAST) go(1)
    schedule()
  } else clearTimeout(S.timer)
}
function stop() { if (S.playing) setPlay(false) }

const stepFromHash = () => {
  const m = /^#step-(\d+)$/.exec(location.hash || '')
  return m ? Math.min(LAST, Math.max(1, Number(m[1]))) : null
}

// ── Start ─────────────────────────────────────────────────────

const style = document.createElement('style')
style.textContent = Html.PREVIEW_CSS
document.head.append(style)

buildMap()
drawChapters()
$('.kw-back').addEventListener('click', () => go(S.n - 1, { manual: true }))
$('.kw-next').addEventListener('click', () => go(S.n + 1, { manual: true }))
$('.kw-play').addEventListener('click', () => setPlay(!S.playing))
$('.kw-restart').addEventListener('click', () => { stop(); go(1) })
for (const b of root.querySelectorAll('.kw-controls button')) b.disabled = false
window.addEventListener('hashchange', () => {
  const n = stepFromHash()
  if (n && n !== S.n) { stop(); go(n, { from: 'hash' }) }
})
document.addEventListener('keydown', e => {
  if (e.altKey || e.ctrlKey || e.metaKey) return
  const t = e.target
  if (t.closest && t.closest('input, select, textarea, [contenteditable]')) return
  const onControl = t.closest && t.closest('button, a, summary')
  if (e.key === 'ArrowRight' && S.n < LAST) { e.preventDefault(); go(S.n + 1, { manual: true }) }
  else if (e.key === 'ArrowLeft' && S.n > 1) { e.preventDefault(); go(S.n - 1, { manual: true }) }
  else if ((e.key === ' ' || e.key === 'Spacebar') && !onControl) { e.preventDefault(); setPlay(!S.playing) }
})
// The phone shows one screen at a time and keeps the map folded away.
if (narrowQuery.matches) $('.kw-mapwrap').open = false
narrowQuery.addEventListener('change', () => show(S.n))
motionQuery.addEventListener('change', () => { if (reduce()) cancelAnimationFrame(S.raf) })

S.n = stepFromHash() || 1
show(S.n)
root.classList.add('kw-ready')
