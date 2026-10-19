// shared/pos/kitchenPrint.js
//
// Kitchen printers in the kitchen flow (migration 191): a station of kind
// 'printer' (settings.printer_id = a pos_printers row) is a box in the flow
// like a kitchen screen. Every dish whose way goes through it prints there
// once, when it reaches it: straight from Orders in that is when it is fired
// (sent, its held course fired, or its time come); after a kitchen screen it
// is when that screen bumps it (a runner's ticket from the pass). A dish
// voided after printing prints a VOID ticket. One ticket per order, printer
// and kind, by course, drawn with the venue's kitchen ticket design
// (cfg.ticket_layout, shared/pos/ticketLayout.js). Nobody bumps a printer:
// the kitchen counts a dish as done there when it reaches it (noBump in
// kitchen.js).
//
// A printer straight after Orders in also lists a held course under HOLD on
// the ticket that goes when the order is sent (so the kitchen knows what's
// coming), then prints it again as FIRE when the course is fired, as kitchen
// printers always have.
//
// Run by the sequencer after every kitchen change (and for the minute sweep's
// kitchen.print_due, for dishes whose time has come) and by the test bench.
// The item keeps what was printed: item.printed / item.hold_printed /
// item.void_printed = { [stationId]: at }.

import { kitchenTicket } from './tickets.js'
import { isFired, flowTimes, START } from './kitchen.js'

const SOURCE_NAMES = { online: 'ONLINE', gloriafood: 'GLORIAFOOD' }

const isPrinter = (cfg, id) => cfg.stations?.[id]?.kind === 'printer' && !!cfg.stations[id].settings?.printer_id

/** The printer stations on a way (a dish's or a meal part's). */
function printersOn(route, cfg) {
  return Object.keys(route || {}).filter(id => isPrinter(cfg, id))
}

/** Whether the kitchen config has a printer in it (nothing to do otherwise). */
export function hasPrinters(cfg) {
  return Object.keys(cfg?.stations || {}).some(id => isPrinter(cfg, id))
}

/** A ticket's header from a kitchen order (as printing.js does for till checks). */
function sendHeader(o, at) {
  const counterNo = o.counter && o.number ? 'ORDER ' + o.number : null
  const outside = SOURCE_NAMES[o.source]
  const tab = o.table ? null : outside ? outside + ' ' + o.number : (counterNo || o.tab || 'TAB')
  return {
    table: o.table || null,
    tab,
    // Counter and online orders show their number big; the name taken goes under it.
    name: o.table ? null : (outside ? o.guest : counterNo ? o.tab : null) || null,
    tabName: o.tab || o.guest || null,
    number: o.number || null,
    type: o.type_name || null,
    tent: o.tent || null,
    covers: o.covers || null,
    server: o.server || null,
    checkNo: o.number || null,
    sentAt: at ? new Date(at) : new Date(),
  }
}

const modLine = (m, depth = 0) => ({ kind: m.kind === 'remove' ? 'remove' : 'add', text: m.text || m.label, depth: (m.depth || 0) + depth })

/** One dish as a ticket line; with `parts`, only the meal parts going to this printer. */
function ticketLine(item, parts) {
  const mods = (item.mods || []).filter(m => m.kind !== 'base' || m.label).map(m => modLine(m))
  const groups = []
  for (const p of parts || []) {
    const key = p.name + '|' + (p.mods || []).map(m => m.text).join(',')
    const g = groups.find(x => x.key === key)
    if (g) g.count++
    else groups.push({ key, part: p, count: 1 })
  }
  for (const { part, count } of groups) {
    mods.push({ kind: 'part', text: (count > 1 ? count + ' x ' : '') + part.name })
    for (const m of part.mods || []) mods.push(modLine(m, 1))
  }
  return { qty: item.qty, name: item.name, seat: item.seat ?? null, note: item.note || null, allergies: item.allergies || [], modifiers: mods }
}

/** Ticket courses from [{ item, line, hold }], in course order. */
function courses(entries, fire) {
  const byCourse = new Map()
  for (const { item, line, hold } of entries) {
    const key = (item.course || '') + '|' + (hold ? 'hold' : '')
    if (!byCourse.has(key)) byCourse.set(key, { name: item.course || '', sort: item.course_sort ?? -1, hold: !!hold, fire: fire && !!item.course, lines: [] })
    byCourse.get(key).lines.push(line)
  }
  return [...byCourse.values()]
    .sort((a, b) => a.sort - b.sort || Number(a.hold) - Number(b.hold))
    .map(({ name, hold, fire: f, lines }) => ({ name, hold, fire: f, lines }))
}

// A dish waiting for its course to be fired (not one waiting for its time).
const isHeld = item => !item.fired_at && !item.fire_at

/**
 * Print jobs for the kitchen printers, marking what they print on the items
 * (the orders are changed in place). orders: { [id]: kitchen order }.
 * -> { jobs: [{ printer_id, station_id, kind: 'kitchen' | 'fire' | 'void', title, ops, check_id, kitchen_order_id }], changed: [orderId] }
 */
export function kitchenPrintJobs(orders, cfg, at) {
  const jobs = []
  const changed = new Set()
  if (!hasPrinters(cfg)) return { jobs, changed: [] }
  const mark = (item, key, sid) => { item[key] = { ...(item[key] || {}), [sid]: at } }
  for (const o of Object.values(orders || {})) {
    if (!o || o.status === 'merged') continue
    // station -> kind -> [{ item, line, hold }]
    const groups = new Map()
    const add = (sid, kind, entry) => {
      const g = groups.get(sid) || new Map()
      g.set(kind, [...(g.get(kind) || []), entry])
      groups.set(sid, g)
    }
    const holds = []
    for (const item of o.items || []) {
      const stations = new Set([...printersOn(item.route, cfg), ...(item.parts || []).flatMap(p => printersOn(p.route, cfg))])
      if (!stations.size) continue
      const times = flowTimes(item, cfg, at)
      for (const sid of stations) {
        const parts = item.parts ? item.parts.filter(p => printersOn(p.route, cfg).includes(sid)) : null
        const entry = { item, line: ticketLine(item, parts) }
        if (item.voided_at) {
          if ((item.printed?.[sid] || item.hold_printed?.[sid]) && !item.void_printed?.[sid]) {
            add(sid, 'void', entry)
            mark(item, 'void_printed', sid)
            changed.add(o.id)
          }
          continue
        }
        if (item.printed?.[sid]) continue
        const fromStart = (item.route?.[sid] || []).includes(START)
        if (isHeld(item)) {
          if (fromStart && !item.hold_printed?.[sid]) holds.push({ sid, entry: { ...entry, hold: true } })
          continue
        }
        if (!isFired(item, at) || !times.arrived(sid)) continue
        // A held course fired later prints as FIRE (only where the hold was printed).
        add(sid, item.hold_printed?.[sid] ? 'fire' : 'kitchen', entry)
        mark(item, 'printed', sid)
        changed.add(o.id)
      }
    }
    // Held courses go on the order's ticket for that printer, or a ticket of
    // their own when only held courses were sent.
    for (const { sid, entry } of holds) {
      add(sid, 'kitchen', entry)
      mark(entry.item, 'hold_printed', sid)
      changed.add(o.id)
    }
    for (const [sid, kinds] of groups) {
      const st = cfg.stations[sid]
      for (const [kind, entries] of kinds) {
        const send = { ...sendHeader(o, at), station: st.name, void: kind === 'void', courses: courses(entries, kind === 'fire') }
        jobs.push({
          printer_id: st.settings.printer_id, station_id: sid, kind,
          title: (kind === 'void' ? 'Void ' : kind === 'fire' ? 'Fire ' : '') + (o.table ? 'Table ' + o.table : 'Order ' + (o.number || '')).trim(),
          ops: kitchenTicket(send, cfg.ticket_layout || null),
          check_id: o.check_id || null, kitchen_order_id: o.id,
        })
      }
    }
  }
  return { jobs, changed: [...changed] }
}

/** Whether any of these orders has something for a printer now (the minute sweep asks before sending kitchen.print_due). */
export function printsDue(orders, cfg, at) {
  if (!hasPrinters(cfg)) return false
  return kitchenPrintJobs(structuredClone(orders || {}), cfg, at).jobs.length > 0
}
