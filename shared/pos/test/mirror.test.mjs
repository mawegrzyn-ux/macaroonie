// The venue hub's mirror (shared/pos/mirror.js, docs/POS.md section 11):
// the cloud's state plus the hub's pending events, decided by the same
// sequencer. A second sequencer over an in-memory store stands in for the
// cloud, so every case is the real rules on both sides.
import test from 'node:test'
import assert from 'node:assert/strict'
import { ulid } from '../ids.js'
import { createSequencer } from '../sequencer.js'
import { createMirror, localDayId } from '../mirror.js'

const uuid = () => globalThis.crypto.randomUUID()
const VENUE = uuid()
const HUB = uuid()
const ANNA = uuid(), CARA = uuid()
const TABLE5 = uuid(), RC = uuid()
const staffById = {
  [ANNA]: { id: ANNA, name: 'Anna', permissions: { transfer: true } },
  [CARA]: { id: CARA, name: 'Cara', permissions: { void: true, refund: true, manager: true, close_day: true, reopen: true, open_drawer: true, transfer: true } },
}
const context = {
  staffById, print: { printers: {}, tables: { [TABLE5]: { label: '5' } }, staff: {}, courses: {}, settings: {}, venue: { name: 'Ware' }, devices: {} },
  settings: { day_starts_at: '04:00' }, timezone: 'Europe/London',
  devices: { T1: { short_code: 'T1', kind: 'terminal' }, T2: { short_code: 'T2', kind: 'terminal' }, C9: { short_code: 'T9', kind: 'terminal' } },
}

let clock = Date.parse('2026-10-30T12:00:00Z')
const now = () => new Date(clock)
function ev(type, payload, { check_id = null, staff_id = ANNA, device_id = 'T1' } = {}) {
  clock += 1000
  return { id: ulid(clock), venue_id: VENUE, device_id, staff_id, check_id, type, payload, client_at: new Date(clock).toISOString() }
}
const line = (name, price) => ({ id: ulid(), item_id: uuid(), section_id: null, name, qty: 1, unit_price: price, modifiers: [], vat_rate: 20 })

/** The cloud: a sequencer over memory, and what GET /pos-api/hub/sync would answer. */
function cloud() {
  const s = { events: [], byId: new Map(), rejections: new Map(), checks: new Map(), checkSeq: new Map(), state: { last_seq: 0, numbers: {}, day: null } }
  let queue = Promise.resolve()
  const store = {
    run: (_v, fn) => (queue = queue.then(fn, fn)),
    findEvent: id => s.byId.get(id) || null,
    findRejection: id => s.rejections.get(id) || null,
    context: () => context,
    venueState: () => ({ ...s.state }),
    openDay: ({ business_date }) => { const d = { id: uuid(), business_date }; s.state.day = d; return d },
    loadChecks: ids => Object.fromEntries(ids.filter(id => s.checks.has(id)).map(id => [id, structuredClone(s.checks.get(id))])),
    openCheckCount: () => [...s.checks.values()].filter(c => c.status === 'open').length,
    saveEvent: e => { s.events.push(e); s.byId.set(e.id, e) },
    saveChecks: (changed, e) => { for (const [id, c] of Object.entries(changed)) { s.checks.set(id, structuredClone(c)); s.checkSeq.set(id, e.seq) } },
    saveJobs: () => {},
    saveRejection: (e, error, code) => { s.rejections.set(e.id, { error, code }) },
    saveVenueState: v => { s.state.last_seq = v.last_seq; if (v.numbers) s.state.numbers = v.numbers },
    closeDay: () => { s.state.day = null },
  }
  const seq = createSequencer(store)
  return {
    data: s,
    submit: (e, at = now()) => seq.submit(structuredClone(e), { now: at }),
    /** What the hub's upload gets back: the cloud deciding each again, in the hub's order. */
    upload: async events => {
      const out = []
      for (const e of events) {
        const { hub_printed, hub_at, ...raw } = e
        const r = await seq.submit(raw, { now: new Date(hub_at) })
        out.push({ id: e.id, ok: r.ok, seq: r.seq, duplicate: !!r.duplicate, error: r.error, code: r.code })
      }
      return out
    },
    sync: since => ({
      reset: !since,
      seq: s.state.last_seq,
      events: s.events.filter(e => e.seq > since).map(e => ({ id: e.id, seq: e.seq })),
      checks: [...s.checks.values()].filter(c => !since || s.checkSeq.get(c.id) > since).map(c => structuredClone(c)),
      day: s.state.day,
      numbers: structuredClone(s.state.numbers),
    }),
  }
}

async function hubWith(c) {
  const m = createMirror({ hubId: HUB, context })
  await m.ready
  await m.applyCloud(c.sync(0))
  return m
}

/** The hub sends its pending events, the cloud decides them, the hub follows. */
async function roundTrip(m, c) {
  const before = m.cloudSeq
  await m.confirm(await c.upload(m.toSend()))
  await m.applyCloud(c.sync(before))
}

test('the hub decides at once; the cloud takes the same events and the hub follows it', async () => {
  const c = cloud()
  const m = await hubWith(c)
  const check = ulid()
  const opened = await m.submit(ev('check.opened', { mode: 'table', table_id: TABLE5, revenue_stream_id: RC, number: 1 }, { check_id: check }), { now: now() })
  assert.ok(opened.ok, opened.error)
  assert.equal(opened.event.assigned.number_code, 'T1')
  const l = line('Pad Thai', 1250)
  assert.ok((await m.submit(ev('line.added', { line: l }, { check_id: check }), { now: now() })).ok)
  // Another till on the network sees it straight away.
  const t2 = m.sync({ since: 0, deviceId: 'T2' })
  assert.equal(t2.source, 'hub:' + HUB)
  assert.equal(t2.checks.length, 1)
  assert.equal(t2.checks[0].lines.length, 1)
  assert.equal(m.status().to_send, 2)
  assert.equal(c.data.events.length, 0, 'nothing in the cloud yet')

  await roundTrip(m, c)
  assert.equal(c.data.events.length, 2, 'the cloud took both, in the hub\'s order')
  assert.equal(c.data.checks.get(check).lines[0].name, 'Pad Thai')
  assert.equal(m.status().pending, 0, 'once the cloud\'s state has them, nothing is pending')
  assert.equal(m.cloudSeq, 2)
  // The view is the cloud's state now.
  const again = m.sync({ since: 0 })
  assert.equal(again.checks[0].lines[0].id, l.id)
  assert.equal(again.day.id, c.data.state.day.id, 'the cloud\'s trading day')
})

test('a device sending an event again gets the same answer, before and after the cloud took it', async () => {
  const c = cloud()
  const m = await hubWith(c)
  const e = ev('check.opened', { mode: 'counter', revenue_stream_id: RC, number: 4, order_no: 104 }, { check_id: ulid() })
  const r1 = await m.submit(e, { now: now() })
  const r2 = await m.submit(e, { now: now() })
  assert.equal(r2.duplicate, true)
  assert.equal(m.status().pending, 1, 'kept once')
  await roundTrip(m, c)
  const r3 = await m.submit(e, { now: now() })
  assert.equal(r3.duplicate, true, 'known from the cloud: not decided twice')
  assert.equal(m.status().pending, 0)
  assert.ok(r1.ok)
})

test('internet down: the venue keeps trading on the hub; a change a cloud-only till made meanwhile wins, the hub\'s is a conflict', async () => {
  const c = cloud()
  const m = await hubWith(c)
  const check = ulid()
  await m.submit(ev('check.opened', { mode: 'table', table_id: TABLE5, revenue_stream_id: RC, number: 1 }, { check_id: check }), { now: now() })
  const cola = line('Cola', 300)
  await m.submit(ev('line.added', { line: cola }, { check_id: check }), { now: now() })
  await roundTrip(m, c)

  // The line goes. A till on 4G (straight to the cloud) takes cash and closes the check...
  const pay = ev('payment.added', { payment: { id: ulid(), tender: 'cash', amount: 300, tendered: 300 } }, { check_id: check, device_id: 'C9' })
  assert.ok((await c.submit(pay)).ok)
  assert.ok((await c.submit(ev('check.closed', {}, { check_id: check, device_id: 'C9' }))).ok)
  // ...while a till at the venue, on the hub, takes a card payment for it, and opens another check.
  const offline = ev('payment.added', { payment: { id: ulid(), tender: 'card_external', amount: 300 } }, { check_id: check, device_id: 'T2' })
  assert.ok((await m.submit(offline, { now: now() })).ok, 'the hub doesn\'t know yet: it takes it')
  const other = ulid()
  assert.ok((await m.submit(ev('check.opened', { mode: 'table', table_id: TABLE5, revenue_stream_id: RC, number: 2 }, { check_id: other, device_id: 'T2' }), { now: now() })).ok)
  assert.equal(m.status().to_send, 2)

  // The line comes back: the hub sees the cloud first and rebases.
  const refused = await m.applyCloud(c.sync(m.cloudSeq))
  assert.equal(refused.length, 1)
  assert.equal(refused[0].event.id, offline.id)
  assert.equal(refused[0].code, 'closed')
  const view = m.sync({ since: 0 })
  assert.equal(view.checks.find(x => x.id === check)?.status ?? 'closed', 'closed')
  assert.ok(view.checks.some(x => x.id === other), 'the other check is still there')
  assert.equal(m.status().conflicts.at(-1).id, offline.id, 'listed as a conflict')
  // What goes up: the other check, and the refusal for the cloud's list.
  assert.deepEqual(m.toSend().map(e => e.id), [view.checks.find(x => x.id === other) && m.toSend()[0].id])
  const out = m.refusalsOut()
  assert.equal(out.list[0].event.id, offline.id)
  out.drop()
  assert.equal(m.refusalsOut().list.length, 0)
  await roundTrip(m, c)
  assert.ok(c.data.checks.has(other))
  assert.equal(m.status().pending, 0)
  // Sending it again: refused again, without deciding.
  const again = await m.submit(offline, { now: now() })
  assert.equal(again.ok, false)
  assert.equal(again.duplicate, true)
})

test('the cloud refusing an uploaded event takes it out of the view at once', async () => {
  const c = cloud()
  const m = await hubWith(c)
  const check = ulid()
  // The cloud closed the day the hub doesn't know about... simplest: the cloud already has this check id.
  await c.submit(ev('check.opened', { mode: 'table', table_id: TABLE5, revenue_stream_id: RC, number: 9 }, { check_id: check, device_id: 'C9' }))
  const mine = ev('check.opened', { mode: 'table', table_id: TABLE5, revenue_stream_id: RC, number: 1 }, { check_id: check })
  assert.ok((await m.submit(mine, { now: now() })).ok, 'the hub hasn\'t seen the cloud\'s check')
  await m.confirm(await c.upload(m.toSend()))
  assert.equal(m.status().pending, 0)
  assert.equal(m.status().conflicts.at(-1).by, 'cloud')
  assert.equal(m.sync({ since: 0 }).checks.length, 0, 'not in the view until the cloud\'s check comes down')
  await m.applyCloud(c.sync(0))
  assert.equal(m.sync({ since: 0 }).checks[0].number, 9)
})

test('device cursors: changes since, and a cursor from the cloud or another hub starts again', async () => {
  const c = cloud()
  const m = await hubWith(c)
  const a = ulid(), b = ulid()
  await m.submit(ev('check.opened', { mode: 'table', table_id: TABLE5, revenue_stream_id: RC, number: 1 }, { check_id: a }), { now: now() })
  const first = m.sync({ since: 0 })
  assert.equal(first.reset, true)
  await m.submit(ev('check.opened', { mode: 'table', table_id: TABLE5, revenue_stream_id: RC, number: 2 }, { check_id: b }), { now: now() })
  const next = m.sync({ since: first.seq, source: first.source })
  assert.equal(next.reset, false)
  assert.deepEqual(next.checks.map(x => x.id), [b], 'only what changed')
  assert.equal(m.sync({ since: next.seq, source: first.source }).checks.length, 0, 'nothing new')
  assert.equal(m.sync({ since: next.seq, source: 'cloud' }).reset, true, 'a cloud cursor starts again')
  assert.equal(m.sync({ since: 9999, source: first.source }).reset, true, 'a cursor ahead (the hub was reset) starts again')
  // Each device gets its own numbers back.
  assert.equal(m.sync({ since: 0, deviceId: 'T1' }).numbers.check, 2)
  assert.equal(m.sync({ since: 0, deviceId: 'T2' }).numbers, null)
})

test('offline all day: the hub opens the day, closes it (Z) and opens the next; the cloud takes them all later', async () => {
  const c = cloud()
  const m = await hubWith(c)
  const check = ulid()
  await m.submit(ev('check.opened', { mode: 'counter', revenue_stream_id: RC, number: 1, order_no: 1 }, { check_id: check }), { now: now() })
  const day1 = m.dayReport().day
  assert.equal(day1.id, localDayId('2026-10-30', 1), 'a day of the hub\'s own')
  const l = line('Wings', 900)
  await m.submit(ev('line.added', { line: l }, { check_id: check }), { now: now() })
  await m.submit(ev('payment.added', { payment: { id: ulid(), tender: 'cash', amount: 900, tendered: 1000 } }, { check_id: check }), { now: now() })
  await m.submit(ev('check.closed', {}, { check_id: check }), { now: now() })
  assert.equal(m.dayReport().figures.sales.gross, 900)
  const z = await m.submit(ev('day.closed', { declared_cash: 900 }, { staff_id: CARA }), { now: now() })
  assert.ok(z.ok, z.error)
  assert.equal(m.dayReport().day, null)
  const next = ulid()
  await m.submit(ev('check.opened', { mode: 'counter', revenue_stream_id: RC, number: 2, order_no: 2 }, { check_id: next }), { now: now() })
  assert.equal(m.dayReport().day.id, localDayId('2026-10-30', 2), 'the next day gets another id')

  await roundTrip(m, c)
  assert.equal(c.data.events.length, 6)
  assert.equal(c.data.checks.get(check).status, 'closed')
  assert.ok(c.data.state.day, 'the cloud opened its own next day')
  assert.equal(m.status().pending, 0)
  assert.equal(m.dayReport().day.id, c.data.state.day.id)
})

test('a restart keeps the view and what is still to send', async () => {
  const c = cloud()
  const m = await hubWith(c)
  const check = ulid()
  await m.submit(ev('check.opened', { mode: 'table', table_id: TABLE5, revenue_stream_id: RC, number: 1 }, { check_id: check }), { now: now() })
  const snap = JSON.parse(JSON.stringify(m.snapshot()))
  const back = createMirror({ hubId: HUB, snapshot: snap })
  await back.ready
  assert.equal(back.sync({ since: 0 }).checks[0].id, check)
  assert.equal(back.toSend().length, 1)
  assert.ok(back.rev >= m.rev, 'the cursor only goes forward')
  const cur = back.sync({ since: m.rev, source: m.source })
  assert.equal(cur.reset, false, 'a device\'s cursor from before the restart still works')
  await roundTrip(back, c)
  assert.ok(c.data.checks.has(check))
})

test('card machine payments and loyalty rewards need the cloud', async () => {
  const c = cloud()
  const m = await hubWith(c)
  const check = ulid()
  await m.submit(ev('check.opened', { mode: 'table', table_id: TABLE5, revenue_stream_id: RC, number: 1 }, { check_id: check }), { now: now() })
  const card = ev('payment.added', { payment: { id: ulid(), tender: 'card_integrated', amount: 300, card_payment_id: uuid() } }, { check_id: check })
  assert.equal(m.needsCloud(card), true)
  assert.equal(m.needsCloud(ev('payment.added', { payment: { id: ulid(), tender: 'cash', amount: 300 } }, { check_id: check })), false)
  const reward = ev('discount.applied', { discount: { id: ulid(), kind: 'amount', amount: 100, loyalty_redemption_id: uuid() } }, { check_id: check })
  assert.equal(m.needsCloud(reward), true)
  // Decided by the hub anyway, they are refused (the hub's store can't check them).
  const r = await m.submit(card, { now: now() })
  assert.equal(r.code, 'card')
})

test('before the cloud has sent its set-up the hub refuses, and decides again with a new one', async () => {
  const m = createMirror({ hubId: HUB })
  await m.ready
  const e = ev('check.opened', { mode: 'table', table_id: TABLE5, revenue_stream_id: RC, number: 1 }, { check_id: ulid() })
  assert.equal((await m.submit(e, { now: now() })).code, 'hub_not_ready')
  await m.setContext(context)
  assert.ok((await m.submit(ev('check.opened', { mode: 'table', table_id: TABLE5, revenue_stream_id: RC, number: 2 }, { check_id: ulid() }), { now: now() })).ok)
  // A staff member taken off the till: their pending events are decided again and refused.
  const gone = ev('check.opened', { mode: 'table', table_id: TABLE5, revenue_stream_id: RC, number: 3 }, { check_id: ulid(), staff_id: CARA })
  assert.ok((await m.submit(gone, { now: now() })).ok)
  const refused = await m.setContext({ ...context, staffById: { [ANNA]: staffById[ANNA] } })
  assert.deepEqual(refused.map(x => x.event.id), [gone.id])
})

test('kitchen: a dish sent on a till reaches the kitchen screens through the hub, and their bumps come back', async () => {
  const GRILL = uuid()
  const kitchen = {
    enabled: true, courses: {}, tables: { [TABLE5]: { label: '5' } }, staff: { [ANNA]: { name: 'Anna' } }, order_types: {},
    stations: { [GRILL]: { id: GRILL, name: 'Grill', kind: 'prep', settings: {} } },
    flow: [{ id: uuid(), from: null, to: GRILL, targets: [] }],
  }
  const ctx = { ...context, kitchen }
  const m = createMirror({ hubId: HUB, context: ctx })
  await m.ready
  const check = ulid()
  await m.submit(ev('check.opened', { mode: 'table', table_id: TABLE5, revenue_stream_id: RC, number: 1 }, { check_id: check }), { now: now() })
  const l = line('Burger', 1000)
  await m.submit(ev('line.added', { line: l }, { check_id: check }), { now: now() })
  const before = m.kitchenSync({ since: 0 })
  const sent = await m.submit(ev('lines.sent', { send_id: ulid(), line_ids: [l.id] }, { check_id: check }), { now: now() })
  assert.ok(sent.ok, sent.error)
  const ks = m.kitchenSync({ since: before.seq, source: before.source })
  assert.equal(ks.orders.length, 1)
  assert.equal(ks.orders[0].items[0].name, 'Burger')
  // The kitchen screen bumps it (kitchen events need no staff).
  const bump = { id: ulid(clock += 1000), venue_id: VENUE, device_id: 'K1', staff_id: null, type: 'kitchen.bumped', payload: { order_id: check, station_id: GRILL }, client_at: now().toISOString() }
  const b = await m.submit(bump, { now: now() })
  assert.ok(b.ok, b.error)
  assert.equal(m.kitchenOrders()[0].status, 'ready', 'bumped at the grill (its only station): ready')
  assert.equal(m.kitchenOrders()[0].number, 'T1-1')
  const after = m.kitchenSync({ since: ks.seq, source: ks.source })
  assert.equal(after.orders[0].status, 'ready', 'other kitchen screens get it')
  assert.equal(m.toSend().at(-1).id, bump.id, 'the bump goes up to the cloud too')
})
