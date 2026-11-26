// Combined tables (shared/pos/tables.js, migration 297): one party across
// several tables. The label, the two events in the check rules, who holds a
// table (the sequencer's store, the hub's mirror), and what frees them.
// Run: node --test shared/pos/test/

import test from 'node:test'
import assert from 'node:assert/strict'
import { ulid } from '../ids.js'
import { applyEvent, replay, CHECK_EVENTS, KIOSK_EVENTS } from '../checks.js'
import {
  tableLabel, tableTitle, tablesOf, joinedTables, holdsTable, tablesAsked, tableHolders, combinePlan, CHECK_TABLES_MAX,
} from '../tables.js'
import { createSequencer } from '../sequencer.js'
import { createMirror } from '../mirror.js'
import { billOps } from '../printing.js'
import { toText } from '../tickets.js'
import { kitchenForCheckEvent, KITCHEN_CHECK_EVENTS } from '../kitchen.js'
import { BUTTON_ACTIONS } from '../tillLayout.js'

const uuid = () => globalThis.crypto.randomUUID()
const VENUE = uuid()
const ANNA = uuid(), CARA = uuid(), KIOSK = uuid()
const T4 = uuid(), T5 = uuid(), T6 = uuid(), T7 = uuid()
const staffById = {
  // Anna's role allows nothing: combining tables asks for nothing, as moving a table does.
  [ANNA]: { id: ANNA, name: 'Anna', permissions: {} },
  [CARA]: { id: CARA, name: 'Cara', permissions: { transfer: true, reopen: true, manager: true } },
  [KIOSK]: { id: KIOSK, name: 'Kiosk', kiosk: true, permissions: {} },
}
const tables = { [T4]: { label: '4' }, [T5]: { label: '5' }, [T6]: { label: '6' }, [T7]: { label: '7' } }
const print = { printers: {}, tables, staff: { [ANNA]: { name: 'Anna' } }, courses: {}, settings: {}, venue: { name: 'Ware' }, devices: {} }

let clock = Date.parse('2026-11-26T18:00:00Z')
function ev(type, payload, { check_id = null, staff_id = ANNA, device_id = 'T1' } = {}) {
  clock += 1000
  return { id: ulid(clock), venue_id: VENUE, device_id, staff_id, check_id, type, payload, client_at: new Date(clock).toISOString() }
}
const line = (name, price) => ({ id: ulid(), item_id: uuid(), section_id: null, name, qty: 1, unit_price: price, modifiers: [], vat_rate: 20 })
const ok = r => { assert.ok(r.ok, r.error); return r }

/** A little venue: every open check is known, so the rules about held tables run as on the till. */
function venue() {
  let checks = {}
  const run = (type, payload, opts = {}) => {
    const e = ev(type, payload, opts)
    const ctx = { staffById, tables, holders: tableHolders(checks, tablesAsked(e, checks), e.check_id) }
    const r = applyEvent(checks, e, ctx)
    if (r.ok) checks = { ...checks, ...r.checks }
    return r
  }
  const open = (table_id, extra = {}) => {
    const id = ulid()
    ok(run('check.opened', { mode: table_id ? 'table' : 'tab', table_id, covers: 2, ...extra }, { check_id: id }))
    return id
  }
  return { run, open, get: id => checks[id], all: () => checks }
}

test('tableLabel: the main table first, then the joined ones; a title says Table or Tables', () => {
  assert.equal(tableLabel({ table_id: T4 }, tables), '4')
  assert.equal(tableLabel({ table_id: T5, joined_table_ids: [T4, T6] }, tables), '5 + 4 + 6')
  assert.equal(tableLabel({ table_id: T4, joined_table_ids: [T5] }, [{ id: T4, label: '4' }, { id: T5, label: 'Bar 2' }]), '4 + Bar 2')
  assert.equal(tableTitle({ table_id: T4 }, tables), 'Table 4')
  assert.equal(tableTitle({ table_id: T4, joined_table_ids: [T5] }, tables), 'Tables 4 + 5')
  // No table, a table the venue no longer has, joined ids without a main table.
  assert.equal(tableLabel({ table_id: null, tab_name: 'Smith' }, tables), null)
  assert.equal(tableTitle({ table_id: uuid() }, tables), null)
  assert.equal(tableLabel({ table_id: T4, joined_table_ids: [uuid()] }, tables), '4')
  assert.deepEqual(tablesOf({ table_id: null, joined_table_ids: [T5] }), [])
  assert.equal(tableLabel(null, tables), null)
  assert.equal(holdsTable({ table_id: T4, joined_table_ids: [T5] }, T5), true)
  assert.equal(holdsTable({ table_id: T4, joined_table_ids: [T5] }, T6), false)
})

test('the two events are check events the kitchen follows, kiosks can\'t send them, and a layout button opens Combine', () => {
  for (const type of ['check.tables_joined', 'check.tables_split']) {
    assert.ok(CHECK_EVENTS.includes(type))
    assert.ok(KITCHEN_CHECK_EVENTS.includes(type))
    assert.ok(!KIOSK_EVENTS.includes(type))
  }
  assert.deepEqual(BUTTON_ACTIONS.find(a => a.key === 'combine'), { key: 'combine', label: 'Combine tables', check: true, group: 'Order' })
})

test('join and split: tables join in order, the key goes when none are left, and no permission is asked', () => {
  const v = venue()
  const a = v.open(T4)
  ok(v.run('check.tables_joined', { table_ids: [T5] }, { check_id: a }))
  assert.deepEqual(v.get(a).joined_table_ids, [T5])
  ok(v.run('check.tables_joined', { table_ids: [T6, T5] }, { check_id: a }))
  assert.deepEqual(v.get(a).joined_table_ids, [T5, T6], 'one joined already is left as it is')
  assert.equal(v.get(a).table_id, T4)
  assert.equal(v.get(a).covers, 2, 'guests are whatever staff set')

  ok(v.run('check.tables_split', { table_ids: [T5] }, { check_id: a }))
  assert.deepEqual(v.get(a).joined_table_ids, [T6])
  const not = v.run('check.tables_split', { table_ids: [T5] }, { check_id: a })
  assert.equal(not.code, 'missing')
  assert.equal(v.run('check.tables_split', { table_ids: [T4] }, { check_id: a }).code, 'missing', 'the main table isn\'t split off: the order moves')
  ok(v.run('check.tables_split', { table_ids: [T6] }, { check_id: a }))
  assert.ok(!('joined_table_ids' in v.get(a)), 'no empty list is kept on the check')
  assert.deepEqual(joinedTables(v.get(a)), [])
})

test('join refuses: bad shapes, the main table, another venue\'s table, a tab, a counter order, a kiosk, a closed check, too many', () => {
  const v = venue()
  const a = v.open(T4)
  for (const table_ids of [undefined, [], 'x', [T5, T5], ['nope'], Array.from({ length: CHECK_TABLES_MAX }, uuid)]) {
    assert.equal(v.run('check.tables_joined', { table_ids }, { check_id: a }).code, 'invalid', JSON.stringify(table_ids))
    assert.equal(v.run('check.tables_split', { table_ids }, { check_id: a }).code, 'invalid', JSON.stringify(table_ids))
  }
  assert.equal(v.run('check.tables_joined', { table_ids: [T4] }, { check_id: a }).code, 'invalid')
  const other = v.run('check.tables_joined', { table_ids: [uuid()] }, { check_id: a })
  assert.equal(other.code, 'table')
  assert.match(other.error, /isn't one of this location's/)

  const tab = v.open(null, { tab_name: 'Smith' })
  assert.equal(v.run('check.tables_joined', { table_ids: [T5] }, { check_id: tab }).code, 'no_table')
  const counter = ulid()
  ok(v.run('check.opened', { mode: 'counter' }, { check_id: counter }))
  assert.equal(v.run('check.tables_joined', { table_ids: [T5] }, { check_id: counter }).code, 'no_table')
  const kiosk = ulid()
  ok(v.run('check.opened', { mode: 'counter' }, { check_id: kiosk, staff_id: KIOSK, device_id: KIOSK }))
  assert.equal(v.run('check.tables_joined', { table_ids: [T5] }, { check_id: kiosk, staff_id: KIOSK, device_id: KIOSK }).code, 'kiosk')

  ok(v.run('check.closed', {}, { check_id: a }))
  assert.equal(v.run('check.tables_joined', { table_ids: [T5] }, { check_id: a }).code, 'closed')

  // Twelve tables at most, the main one included.
  const many = Object.fromEntries(Array.from({ length: 13 }, (_, i) => [uuid(), { label: String(20 + i) }]))
  const ids = Object.keys(many)
  const big = ulid()
  const ctx = { staffById, tables: many, holders: [] }
  let state = ok(applyEvent({}, ev('check.opened', { mode: 'table', table_id: ids[0] }, { check_id: big }), ctx)).checks
  state = ok(applyEvent(state, ev('check.tables_joined', { table_ids: ids.slice(1, 12) }, { check_id: big }), ctx)).checks
  assert.equal(tablesOf(state[big]).length, CHECK_TABLES_MAX)
  assert.match(applyEvent(state, ev('check.tables_joined', { table_ids: [ids[12]] }, { check_id: big }), ctx).error, /12 tables at most/)
})

test('a table another open check holds is refused, by name; merged in first, it joins', () => {
  const v = venue()
  const a = v.open(T4), b = v.open(T5)
  ok(v.run('line.added', { line: line('Pad Thai', 1250) }, { check_id: b }))
  const held = v.run('check.tables_joined', { table_ids: [T5] }, { check_id: a })
  assert.equal(held.code, 'table_held')
  assert.equal(held.error, 'Table 5 has an open order: merge it into this one first')
  // What the till's Combine does: the other check comes in, then its table joins.
  const plan = combinePlan(v.get(a), [T5], v.all())
  assert.deepEqual(plan.join, [T5])
  assert.deepEqual(plan.merge.map(c => c.id), [b])
  assert.equal(v.run('check.merged', { into_check_id: a }, { check_id: b }).code, 'permission', 'merging keeps its own permission')
  ok(v.run('check.merged', { into_check_id: a }, { check_id: b, staff_id: CARA }))
  ok(v.run('check.tables_joined', { table_ids: plan.join }, { check_id: a }))
  assert.deepEqual(tablesOf(v.get(a)), [T4, T5])
  assert.equal(v.get(a).lines.length, 1)
  assert.equal(v.get(a).covers, 4, 'a merge adds the guests, as it always did')

  // A table joined to another check is as held as its main table.
  const c = v.open(T6)
  assert.equal(v.run('check.tables_joined', { table_ids: [T5] }, { check_id: c }).code, 'table_held')
  // A check that held two tables brings both when it is combined with.
  ok(v.run('check.tables_joined', { table_ids: [T7] }, { check_id: c }))
  const both = combinePlan(v.get(a), [T7], v.all())
  assert.deepEqual(both.join, [T7, T6])
  assert.deepEqual(both.merge.map(x => x.id), [c])
  assert.deepEqual(combinePlan(v.get(a), [T5], v.all()), { join: [], merge: [] }, 'nothing to do for a table it holds already')
})

test('no check opens on, or moves to, a table joined to another open check; its main table still takes a second check', () => {
  const v = venue()
  const a = v.open(T4)
  ok(v.run('check.tables_joined', { table_ids: [T5] }, { check_id: a }))
  const second = v.run('check.opened', { mode: 'table', table_id: T5 }, { check_id: ulid() })
  assert.equal(second.code, 'table_held')
  assert.equal(second.error, 'Table 5 is combined with another order: split it off that order first')
  // Another check on a main table is the till's "Another check on this table" (a split bill).
  const split = v.open(T4)
  assert.equal(v.get(split).table_id, T4)
  const b = v.open(T6)
  assert.equal(v.run('check.table_moved', { table_id: T5 }, { check_id: b }).code, 'table_held')
  ok(v.run('check.table_moved', { table_id: T4 }, { check_id: b }))
  // Split off, the table is anyone's again.
  ok(v.run('check.tables_split', { table_ids: [T5] }, { check_id: a }))
  ok(v.run('check.table_moved', { table_id: T5 }, { check_id: b }))
})

test('moving the party keeps its joined tables, but for one it moves to; a tab holds none', () => {
  const v = venue()
  const a = v.open(T4)
  ok(v.run('check.tables_joined', { table_ids: [T5, T6] }, { check_id: a }))
  ok(v.run('check.table_moved', { table_id: T7 }, { check_id: a }))
  assert.deepEqual(tablesOf(v.get(a)), [T7, T5, T6], 'table 4 is free, 5 and 6 stay joined')
  ok(v.run('check.table_moved', { table_id: T5 }, { check_id: a }))
  assert.deepEqual(tablesOf(v.get(a)), [T5, T6], 'moved to a joined table: it is the main one now, table 7 is free')
  ok(v.run('check.table_moved', { table_id: null }, { check_id: a }))
  assert.equal(v.get(a).mode, 'tab')
  assert.ok(!('joined_table_ids' in v.get(a)))
  assert.deepEqual(tableHolders(v.all(), [T4, T5, T6, T7]), [])
})

test('closing, cancelling and merging free every table; a closed check keeps its tables as a record', () => {
  const v = venue()
  const holders = () => tableHolders(v.all(), [T4, T5, T6, T7]).map(h => h.id)

  // Paid and closed.
  const a = v.open(T4)
  ok(v.run('check.tables_joined', { table_ids: [T5] }, { check_id: a }))
  ok(v.run('line.added', { line: line('Cola', 300) }, { check_id: a }))
  assert.deepEqual(holders(), [a])
  ok(v.run('payment.added', { payment: { id: ulid(), tender: 'cash', amount: 300 } }, { check_id: a }))
  ok(v.run('check.closed', {}, { check_id: a }))
  assert.deepEqual(holders(), [])
  assert.deepEqual(v.get(a).joined_table_ids, [T5], 'the receipt and reports still say 4 + 5')
  assert.ok(v.open(T5), 'table 5 takes a new check')

  // An empty check closed (void).
  const b = v.open(T6)
  ok(v.run('check.tables_joined', { table_ids: [T7] }, { check_id: b }))
  ok(v.run('check.closed', {}, { check_id: b }))
  assert.equal(v.get(b).status, 'void')
  assert.deepEqual(holders().includes(b), false)

  // Cancel order.
  const c = v.open(T6)
  ok(v.run('check.tables_joined', { table_ids: [T7] }, { check_id: c }))
  ok(v.run('check.closed', { cancel_reason: 'Walked out' }, { check_id: c }))
  assert.equal(v.get(c).status, 'void')
  assert.equal(holders().includes(c), false)

  // Merged into another check: it holds nothing any more, and the other keeps only its own.
  const d = v.open(T6), e = v.open(T4)
  ok(v.run('check.tables_joined', { table_ids: [T7] }, { check_id: d }))
  ok(v.run('check.merged', { into_check_id: e }, { check_id: d, staff_id: CARA }))
  assert.equal(v.get(d).status, 'merged')
  assert.ok(!('joined_table_ids' in v.get(d)))
  assert.deepEqual(tablesOf(v.get(e)), [T4])
  assert.equal(holders().includes(d), false)
})

test('a reopened check takes its joined tables back, but for the ones another open check has taken', () => {
  const v = venue()
  const a = v.open(T4)
  ok(v.run('check.tables_joined', { table_ids: [T5, T6] }, { check_id: a }))
  ok(v.run('check.closed', {}, { check_id: a }))
  const b = v.open(T5)
  ok(v.run('check.reopened', { reason: 'Wrong tender' }, { check_id: a, staff_id: CARA }))
  assert.deepEqual(tablesOf(v.get(a)), [T4, T6])
  assert.equal(v.get(b).table_id, T5)
})

test('without holders or tables in the context (a replay, the Test data page) the table rules are skipped', () => {
  const a = ulid(), b = ulid()
  const events = [
    ev('check.opened', { mode: 'table', table_id: T4 }, { check_id: a }),
    ev('check.opened', { mode: 'table', table_id: T5 }, { check_id: b }),
    ev('check.tables_joined', { table_ids: [T5] }, { check_id: a }),
  ]
  const r = replay({}, events, { staffById })
  assert.equal(r.refused.length, 0)
  assert.deepEqual(r.checks[a].joined_table_ids, [T5])
})

// ── The sequencer and the hub ───────────────────────────────────

function memoryStore({ withTables = true } = {}) {
  const s = { events: new Map(), rejections: new Map(), checks: new Map(), state: { last_seq: 0, numbers: {}, day: null }, asked: [] }
  let queue = Promise.resolve()
  const store = {
    data: s,
    run: (_venue, fn) => (queue = queue.then(fn, fn)),
    findEvent: id => s.events.get(id) || null,
    findRejection: id => s.rejections.get(id) || null,
    context: () => ({ staffById, print, timezone: 'Europe/London', settings: {}, devices: { T1: { short_code: 'T1', kind: 'terminal' } } }),
    venueState: () => ({ ...s.state }),
    openDay: ({ business_date }) => { const day = { id: uuid(), business_date }; s.state.day = day; return day },
    loadChecks: ids => Object.fromEntries(ids.filter(id => s.checks.has(id)).map(id => [id, s.checks.get(id)])),
    openCheckCount: () => [...s.checks.values()].filter(c => c.status === 'open').length,
    saveEvent: e => { s.events.set(e.id, e) },
    saveChecks: changed => { for (const [id, c] of Object.entries(changed)) s.checks.set(id, c) },
    saveJobs: () => {},
    saveRejection: (e, error, code) => { s.rejections.set(e.id, { error, code }) },
    saveVenueState: v => { Object.assign(s.state, v) },
    closeDay: () => { s.state.day = null },
  }
  if (withTables) {
    store.openChecksOnTables = ids => {
      s.asked.push(ids)
      return [...s.checks.values()].filter(c => c.status === 'open' && tablesOf(c).some(id => ids.includes(id)))
    }
  }
  return store
}

test('sequencer: asks its store who holds the tables, refuses a held one and keeps the refusal', async () => {
  const store = memoryStore()
  const seq = createSequencer(store)
  const a = ulid(), b = ulid()
  assert.ok((await seq.submit(ev('check.opened', { mode: 'table', table_id: T4, number: 1 }, { check_id: a }))).ok)
  assert.ok((await seq.submit(ev('check.opened', { mode: 'table', table_id: T5, number: 2 }, { check_id: b }))).ok)
  const join = ev('check.tables_joined', { table_ids: [T5] }, { check_id: a })
  const refused = await seq.submit(join)
  assert.equal(refused.ok, false)
  assert.equal(refused.code, 'table_held')
  assert.deepEqual(await seq.submit(join), { ok: false, duplicate: true, error: refused.error, code: 'table_held' })
  assert.deepEqual(store.data.asked.at(-1), [T5])
  // The venue's tables come from the print config the sequencer already has.
  assert.equal((await seq.submit(ev('check.tables_joined', { table_ids: [uuid()] }, { check_id: a }))).code, 'table')

  assert.ok((await seq.submit(ev('check.closed', {}, { check_id: b }))).ok)
  const joined = await seq.submit(ev('check.tables_joined', { table_ids: [T5, T6] }, { check_id: a }))
  assert.ok(joined.ok, joined.error)
  assert.deepEqual(joined.checks[a].joined_table_ids, [T5, T6])
  assert.equal((await seq.submit(ev('check.opened', { mode: 'table', table_id: T6, number: 3 }, { check_id: ulid() }))).code, 'table_held')
  // Events that ask for no table don't look anything up.
  const before = store.data.asked.length
  assert.ok((await seq.submit(ev('check.covers_set', { covers: 6 }, { check_id: a }))).ok)
  assert.ok((await seq.submit(ev('check.tables_split', { table_ids: [T6] }, { check_id: a }))).ok)
  assert.equal(store.data.asked.length, before)
})

test('sequencer: a store that can\'t say who holds a table still takes the events', async () => {
  const seq = createSequencer(memoryStore({ withTables: false }))
  const a = ulid(), b = ulid()
  assert.ok((await seq.submit(ev('check.opened', { mode: 'table', table_id: T4, number: 1 }, { check_id: a }))).ok)
  assert.ok((await seq.submit(ev('check.opened', { mode: 'table', table_id: T5, number: 2 }, { check_id: b }))).ok)
  assert.ok((await seq.submit(ev('check.tables_joined', { table_ids: [T5] }, { check_id: a }))).ok)
})

test('the hub decides combined tables as the cloud does (hub first)', async () => {
  const context = { staffById, print, settings: {}, timezone: 'Europe/London', devices: { T1: { short_code: 'T1', kind: 'terminal' } } }
  const m = createMirror({ hubId: uuid(), context })
  await m.ready
  const now = () => new Date(clock)
  const a = ulid(), b = ulid()
  assert.ok((await m.submit(ev('check.opened', { mode: 'table', table_id: T4, number: 1 }, { check_id: a }), { now: now() })).ok)
  assert.ok((await m.submit(ev('check.opened', { mode: 'table', table_id: T5, number: 2 }, { check_id: b }), { now: now() })).ok)
  assert.equal((await m.submit(ev('check.tables_joined', { table_ids: [T5] }, { check_id: a }), { now: now() })).code, 'table_held')
  const joined = await m.submit(ev('check.tables_joined', { table_ids: [T6] }, { check_id: a }), { now: now() })
  assert.ok(joined.ok, joined.error)
  assert.equal((await m.submit(ev('check.opened', { mode: 'table', table_id: T6, number: 3 }, { check_id: ulid() }), { now: now() })).code, 'table_held')
  // A till on the venue network gets the joined tables with the check.
  assert.deepEqual(m.sync({ since: 0, deviceId: 'T1' }).checks.find(c => c.id === a).joined_table_ids, [T6])
})

// ── Wherever the table is named ─────────────────────────────────

test('the bill and the kitchen name every table of a combined check', () => {
  const v = venue()
  const a = v.open(T4)
  ok(v.run('line.added', { line: line('Pad Thai', 1250) }, { check_id: a }))
  const single = toText(billOps(v.get(a), print, { preBill: true }))
  assert.match(single, /Table 4\b/)
  assert.doesNotMatch(single, /\+/)
  const before = v.all()
  const e = ev('check.tables_joined', { table_ids: [T5] }, { check_id: a })
  const r = ok(applyEvent(before, e, { staffById, tables, holders: [] }))
  assert.match(toText(billOps(r.checks[a], print, { preBill: true })), /Table 4 \+ 5\b/)

  // A kitchen order already on the screens follows the join (its header is refreshed).
  const cfg = { enabled: true, stations: {}, flow: [], courses: {}, tables, staff: {}, order_types: {} }
  const order = { id: a, source: 'till', check_id: a, status: 'open', table: '4', items: [], sends: [] }
  const changed = kitchenForCheckEvent(e, before, r.checks, { [a]: order }, cfg)
  assert.equal(changed[a].table, '4 + 5')
})
