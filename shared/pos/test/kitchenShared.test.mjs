// Shared kitchen flows (migration 192) and the "sent from" filter.
// Run: node --test shared/pos/test/kitchenShared.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { ulid } from '../ids.js'
import { applyEvent } from '../checks.js'
import {
  kitchenForCheckEvent, itemRoute, linkRank, resolveSharedFlow, shareFlow, boxProblems, flowProblems, flowName,
} from '../kitchen.js'

const uuid = () => globalThis.crypto.randomUUID()
const ANNA = uuid()
const staffById = { [ANNA]: { id: ANNA, name: 'Anna', permissions: { void: true, transfer: true, discount_max_pct: 0 } } }
const EAT = uuid(), SIDES = uuid(), FOOD = uuid(), FRIES = uuid(), WINGS = uuid()

// The shared flow: Orders in > Grill (or Fryer for sides) > Pass, and the
// bar's till sends to the Bar station.
const box = (name, kind = 'prep') => ({ id: uuid(), name, kind })
const B = { grill: box('Grill'), fryer: box('Fryer'), bar: box('Bar'), pass: box('Pass', 'expo') }
const shared = {
  boxes: Object.values(B),
  links: [
    { id: uuid(), from: null, to: B.grill.id, targets: [] },
    { id: uuid(), from: null, to: B.fryer.id, targets: [{ kind: 'section', id: SIDES }] },
    { id: uuid(), from: null, to: B.bar.id, targets: [{ kind: 'device', name: 'Bar till' }] },
    { id: uuid(), from: B.grill.id, to: B.pass.id, targets: [] },
    { id: uuid(), from: B.fryer.id, to: B.pass.id, targets: [] },
  ],
}

// Two locations with their own stations and tills.
function location(names, tills) {
  const stations = names.map(([name, kind = 'prep']) => ({ id: uuid(), name, kind }))
  const devices = tills.map(name => ({ id: uuid(), name }))
  const st = n => stations.find(s => flowName(s.name) === flowName(n))
  const dev = n => devices.find(d => d.name === n)
  return { stations, devices, streams: [], st, dev }
}
const ware = location([['Grill'], ['FRYER '], ['Bar'], ['Pass', 'expo']], ['Till 1', 'Bar till'])
const hertford = location([['grill'], ['Pass', 'expo']], ['Till 1'])

test('the sent-from filter ranks between a section and a revenue stream', () => {
  const T1 = uuid(), RS = uuid()
  const target = { item_id: WINGS, section_id: FOOD, device_id: T1, revenue_stream_id: RS }
  const byDevice = { targets: [{ kind: 'device', id: T1 }] }
  const byStream = { targets: [{ kind: 'revenue_stream', id: RS }] }
  const bySection = { targets: [{ kind: 'section', id: FOOD }] }
  assert.ok(linkRank(byDevice, target) < linkRank(byStream, target))
  assert.ok(linkRank(bySection, target) < linkRank(byDevice, target))
  assert.equal(linkRank(byDevice, { ...target, device_id: uuid() }), Infinity)
  assert.equal(linkRank(byDevice, { ...target, device_id: null }), Infinity)
})

test('a shared flow resolves to each location\'s own stations by name', () => {
  const w = resolveSharedFlow(shared, ware)
  assert.equal(w.missing.length, 0)
  assert.equal(w.matches[B.fryer.id], ware.st('Fryer').id, 'names match whatever their case and spaces')
  assert.equal(w.links.length, 5)
  const barLink = w.links.find(l => l.to === ware.st('Bar').id)
  assert.deepEqual(barLink.targets, [{ kind: 'device', id: ware.dev('Bar till').id }])

  const h = resolveSharedFlow(shared, hertford)
  assert.deepEqual(h.missing.map(b => b.name).sort(), ['Bar', 'Fryer'])
  // Links touching a box Hertford has no station for are left out.
  assert.equal(h.links.length, 2)
  assert.ok(h.links.every(l => [hertford.st('Grill').id, hertford.st('Pass').id].includes(l.to)))

  // A kind that differs is reported, the location's station counts.
  const odd = location([['Grill', 'expo'], ['Pass', 'expo']], [])
  assert.equal(resolveSharedFlow(shared, odd).differs[0].station.kind, 'expo')
})

test('a stream or till a location doesn\'t have matches no dish there', () => {
  const flow = {
    boxes: [B.grill, B.bar],
    links: [
      { id: uuid(), from: null, to: B.grill.id, targets: [] },
      { id: uuid(), from: null, to: B.bar.id, targets: [{ kind: 'device', name: 'Bar till' }, { kind: 'revenue_stream', name: 'Bar' }] },
    ],
  }
  const place = location([['Grill'], ['Bar']], ['Till 1'])
  const r = resolveSharedFlow(flow, place)
  const target = { item_id: WINGS, section_id: FOOD, device_id: place.dev('Till 1').id, revenue_stream_id: uuid() }
  const route = itemRoute(target, { stations: Object.fromEntries(place.stations.map(s => [s.id, s])), flow: r.links })
  assert.deepEqual(Object.keys(route), [place.st('Grill').id], 'the bar link names nothing here, so wings go only to the grill')
})

test('till events at two locations follow one shared flow to their own stations; the bar till to the bar', () => {
  for (const place of [ware, hertford]) {
    const r = resolveSharedFlow(shared, place)
    const cfg = {
      enabled: true,
      stations: Object.fromEntries(place.stations.map(s => [s.id, { ...s, settings: {} }])),
      flow: r.links,
      order_types: { [EAT]: { name: 'Eat in' } },
    }
    for (const till of place.devices) {
      let checks = {}
      let orders = {}
      const t0 = Date.parse('2026-10-20T12:00:00Z')
      let n = 0
      const ev = (type, payload, check_id) => {
        const at = new Date(t0 + (++n) * 1000).toISOString()
        return { id: ulid(t0 + n * 1000), device_id: till.id, staff_id: ANNA, check_id, type, payload, client_at: at, received_at: at }
      }
      const send = e => {
        const before = checks
        const res = applyEvent(checks, e, { staffById })
        assert.ok(res.ok, res.error)
        checks = { ...checks, ...res.checks }
        orders = { ...orders, ...kitchenForCheckEvent(e, before, res.checks, orders, cfg) }
      }
      const id = ulid()
      send({ ...ev('check.opened', { mode: 'counter', order_type_id: EAT, number: 1, order_no: 1 }, id) })
      const wings = { id: ulid(), item_id: WINGS, section_id: FOOD, name: 'Wings', qty: 1, unit_price: 500, modifiers: [], vat_rate: 20 }
      const fries = { id: ulid(), item_id: FRIES, section_id: SIDES, name: 'Fries', qty: 1, unit_price: 300, modifiers: [], vat_rate: 20 }
      for (const l of [wings, fries]) send(ev('line.added', { line: l }, id))
      send(ev('lines.sent', { send_id: ulid(), line_ids: [wings.id, fries.id], held_course_ids: [] }, id))
      const o = orders[id]
      const way = lineId => Object.keys(o.items.find(i => i.id === lineId).route).sort()
      const own = n2 => place.st(n2)?.id
      if (till.name === 'Bar till') {
        // A till filter names it more closely than the default link: wings to the bar.
        assert.deepEqual(way(wings.id), [own('Bar')])
        // The section link wins over the till link for fries.
        assert.deepEqual(way(fries.id), [own('Fryer'), own('Pass')].sort())
      } else if (place === ware) {
        assert.deepEqual(way(wings.id), [own('Grill'), own('Pass')].sort())
        assert.deepEqual(way(fries.id), [own('Fryer'), own('Pass')].sort())
      } else {
        // Hertford has no fryer: its link is left out, so the fries take the
        // link for every dish, to the grill.
        assert.deepEqual(way(wings.id), [own('Grill'), own('Pass')].sort())
        assert.deepEqual(way(fries.id), [own('Grill'), own('Pass')].sort())
      }
      // Never a station of another location.
      const other = (place === ware ? hertford : ware).stations.map(s => s.id)
      for (const i of o.items) for (const sid of Object.keys(i.route)) assert.ok(!other.includes(sid))
    }
  }
})

test('a location\'s own flow becomes a shared one: boxes by name, streams and tills by name', () => {
  const RS = uuid(), T1 = uuid(), GONE = uuid()
  const st = [
    { id: uuid(), name: ' Grill ', kind: 'prep' },
    { id: uuid(), name: 'grill', kind: 'prep' },
    { id: uuid(), name: 'Pass', kind: 'expo' },
  ]
  const links = [
    { id: uuid(), from: null, to: st[0].id, targets: [{ kind: 'device', id: T1 }, { kind: 'section', id: FOOD }] },
    { id: uuid(), from: null, to: st[1].id, targets: [] },
    { id: uuid(), from: st[0].id, to: st[2].id, targets: [{ kind: 'revenue_stream', id: RS }] },
    { id: uuid(), from: st[2].id, to: st[0].id, targets: [{ kind: 'revenue_stream', id: GONE }] },
  ]
  const out = shareFlow(links, st, { revenue_stream: { [RS]: 'Restaurant' }, device: { [T1]: 'Till 1' } })
  assert.deepEqual(out.boxes.map(b => b.name), ['Grill', 'Pass'], 'the second "grill" is dropped')
  assert.equal(out.links.length, 2, 'the link to the dropped grill and the one whose only filter has gone go')
  assert.deepEqual(out.links[0].targets, [{ kind: 'device', name: 'Till 1' }, { kind: 'section', id: FOOD }])
  assert.deepEqual(out.links[1].targets, [{ kind: 'revenue_stream', name: 'Restaurant' }])
  // And back at a location with those names, it routes the same way.
  const place = { stations: st.slice(0, 1).concat(st.slice(2)), devices: [{ id: T1, name: 'Till 1' }], streams: [{ id: RS, name: 'Restaurant' }] }
  const r = resolveSharedFlow(out, place)
  assert.equal(r.links.length, 2)
  assert.deepEqual(r.links[0].targets, [{ kind: 'device', id: T1 }, { kind: 'section', id: FOOD }])
})

test('Except links in a shared flow: each location leaves out its own till of that name', () => {
  const flow = {
    boxes: [B.grill, B.bar],
    links: [
      { id: uuid(), from: null, to: B.grill.id, targets: [{ kind: 'device', name: 'Bar till' }], exclude: true },
      { id: uuid(), from: null, to: B.bar.id, targets: [{ kind: 'device', name: 'Bar till' }] },
    ],
  }
  const routeAt = (place, deviceName) => {
    const r = resolveSharedFlow(flow, place)
    const target = { item_id: WINGS, section_id: FOOD, device_id: place.dev(deviceName)?.id || null }
    return Object.keys(itemRoute(target, { stations: Object.fromEntries(place.stations.map(s => [s.id, s])), flow: r.links }))
  }
  assert.deepEqual(routeAt(ware, 'Till 1'), [ware.st('Grill').id])
  assert.deepEqual(routeAt(ware, 'Bar till'), [ware.st('Bar').id], 'the bar till\'s dishes skip the grill')
  // Hertford has no bar till: nothing is left out there, and it stays an Except link.
  const h = resolveSharedFlow(flow, hertford)
  assert.equal(h.links.length, 1)
  assert.equal(h.links[0].exclude, true)
  assert.deepEqual(routeAt(hertford, 'Till 1'), [hertford.st('Grill').id])

  // A venue's own Except link shared: its till by name, still Except; one whose
  // only entry has gone takes every dish (a plain link with no filter).
  const T1 = uuid(), GONE = uuid()
  const st = [{ id: uuid(), name: 'Grill', kind: 'prep' }, { id: uuid(), name: 'Pass', kind: 'expo' }]
  const out = shareFlow([
    { id: uuid(), from: null, to: st[0].id, targets: [{ kind: 'device', id: T1 }], exclude: true },
    { id: uuid(), from: st[0].id, to: st[1].id, targets: [{ kind: 'revenue_stream', id: GONE }], exclude: true },
  ], st, { device: { [T1]: 'Bar till' } })
  assert.deepEqual(out.links.map(l => [l.targets, l.exclude]), [[[{ kind: 'device', name: 'Bar till' }], true], [[], false]])
})

test('box problems: names must be there and differ; flow problems still apply to boxes', () => {
  assert.deepEqual(boxProblems([box('Grill'), box('Pass', 'expo')]), [])
  assert.match(boxProblems([box('Grill'), box(' grill ')])[0], /Two boxes are called/)
  assert.match(boxProblems([box('  ')])[0], /needs a name/)
  assert.match(boxProblems([{ id: uuid(), name: 'X', kind: 'oven' }])[0], /kind the kitchen doesn't know/)
  const g = box('Grill'), p = box('Pass', 'expo')
  assert.match(flowProblems([g, p], [{ from: g.id, to: p.id, targets: [] }, { from: p.id, to: g.id, targets: [] }])[0], /circle/)
})
