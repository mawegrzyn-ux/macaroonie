// The order's allergy flag: shared/pos/allergy.js, its event on the check
// (check.allergy_set in checks.js), the kitchen order's header (kitchen.js)
// and the printed kitchen ticket (tickets.js).
import test from 'node:test'
import assert from 'node:assert/strict'
import { allergyProblem, cleanAllergy, allergyText, allergyPrefs, allergyOn, ALLERGY_TAGS_MAX, ALLERGY_NOTE_MAX } from '../allergy.js'

const MILK = { code: 'milk', name: 'Milk' }
const NUTS = { code: 'peanuts', name: 'Peanuts' }
const VEGAN = { code: 've', name: 'Vegan' }

test('allergyProblem: the flag\'s shape, its limits, and null for no flag', () => {
  assert.equal(allergyProblem(null), null)
  assert.equal(allergyProblem({ allergens: [MILK], diets: [VEGAN], note: 'No sesame oil' }), null)
  assert.equal(allergyProblem({ note: 'Coeliac' }), null)
  assert.equal(allergyProblem({}), null)
  assert.equal(allergyProblem('milk'), 'allergy')
  assert.equal(allergyProblem([MILK]), 'allergy')
  assert.equal(allergyProblem({ allergens: 'milk' }), 'allergy.allergens')
  assert.equal(allergyProblem({ allergens: ['milk'] }), 'allergy.allergens')
  assert.equal(allergyProblem({ allergens: [{ code: 'milk' }] }), 'allergy.allergens')
  assert.equal(allergyProblem({ diets: [{ code: '', name: 'Vegan' }] }), 'allergy.diets')
  assert.equal(allergyProblem({ diets: [{ code: 've', name: 'x'.repeat(61) }] }), 'allergy.diets')
  assert.equal(allergyProblem({ allergens: Array.from({ length: ALLERGY_TAGS_MAX + 1 }, (_, i) => ({ code: 'a' + i, name: 'A' + i })) }), 'allergy.allergens')
  assert.equal(allergyProblem({ note: 'x'.repeat(ALLERGY_NOTE_MAX + 1) }), 'allergy.note')
  assert.equal(allergyProblem({ note: 5 }), 'allergy.note')
})

test('cleanAllergy: trims, drops repeats and blanks, null when it says nothing', () => {
  assert.deepEqual(cleanAllergy({ allergens: [MILK, { code: ' milk ', name: 'Milk again' }, NUTS], diets: [VEGAN], note: '  No sesame oil  ', other: 1 }),
    { allergens: [MILK, NUTS], diets: [VEGAN], note: 'No sesame oil' })
  assert.equal(cleanAllergy({ allergens: [], diets: [], note: '   ' }), null)
  assert.equal(cleanAllergy(null), null)
  assert.equal(cleanAllergy('milk'), null)
  assert.deepEqual(cleanAllergy({ note: 'Coeliac' }), { allergens: [], diets: [], note: 'Coeliac' })
  assert.deepEqual(cleanAllergy({ allergens: [{ code: 'milk' }, MILK] }), { allergens: [MILK], diets: [], note: null })
})

test('allergyText and allergyPrefs: one line for the kitchen, the codes for the dish check', () => {
  const a = cleanAllergy({ allergens: [MILK, NUTS], diets: [VEGAN], note: 'No sesame oil' })
  assert.equal(allergyText(a), 'Milk, Peanuts · Vegan · No sesame oil')
  assert.equal(allergyText(cleanAllergy({ diets: [VEGAN] })), 'Vegan')
  assert.equal(allergyText(cleanAllergy({ note: 'Coeliac' })), 'Coeliac')
  assert.equal(allergyText(null), '')
  assert.deepEqual(allergyPrefs(a), { avoid: ['milk', 'peanuts'], diet: ['ve'] })
  assert.deepEqual(allergyPrefs(null), { avoid: [], diet: [] })
  assert.equal(allergyOn(a), true)
  assert.equal(allergyOn(null), false)
  assert.equal(allergyOn({ allergens: [], diets: [], note: null }), false)
})

// ── On the check, in the kitchen and on printed tickets ──────────────────
import { ulid } from '../ids.js'
import { applyEvent, replay } from '../checks.js'
import { kitchenForCheckEvent } from '../kitchen.js'
import { kitchenPrintJobs } from '../kitchenPrint.js'
import { toText } from '../tickets.js'

const uuid = () => globalThis.crypto.randomUUID()
const VENUE = uuid(), ANNA = uuid(), FOOD = uuid(), TABLE5 = uuid(), TABLE6 = uuid()
const staffById = { [ANNA]: { id: ANNA, name: 'Anna', permissions: { void: true, transfer: true } } }
const GRILL = uuid(), KP = uuid()
const kcfg = {
  enabled: true, courses: {}, order_types: {},
  tables: { [TABLE5]: { label: '5' }, [TABLE6]: { label: '6' } },
  staff: { [ANNA]: { name: 'Anna' } },
  stations: {
    [GRILL]: { id: GRILL, name: 'Grill', kind: 'prep', settings: {} },
    [KP]: { id: KP, name: 'Kitchen printer', kind: 'printer', settings: { printer_id: 'pK' } },
  },
  flow: [
    { id: uuid(), from: null, to: KP, targets: [{ kind: 'section', id: FOOD }] },
    { id: uuid(), from: null, to: GRILL, targets: [{ kind: 'section', id: FOOD }] },
  ],
}
let clock = Date.parse('2026-10-31T18:00:00Z')
function ev(type, payload, check_id) {
  clock += 1000
  const t = new Date(clock).toISOString()
  return { id: ulid(clock), venue_id: VENUE, device_id: 'T1', staff_id: ANNA, check_id, type, payload, client_at: t, received_at: t, assigned: { day_id: 'day-1' } }
}
const dish = name => ({ id: ulid(), item_id: uuid(), section_id: FOOD, name, qty: 1, unit_price: 900, modifiers: [], vat_rate: 20 })
const FLAG = { allergens: [MILK, NUTS], diets: [], note: 'Coeliac too' }

function till() {
  let checks = {}, orders = {}
  const jobs = []
  return {
    get checks() { return checks },
    get orders() { return orders },
    jobs,
    send(e) {
      const before = checks
      const r = applyEvent(checks, e, { staffById })
      if (!r.ok) return r
      checks = { ...checks, ...r.checks }
      const k = kitchenForCheckEvent(e, before, r.checks, orders, kcfg)
      orders = { ...orders, ...k }
      const out = kitchenPrintJobs(k, kcfg, new Date(clock).toISOString()).jobs
      jobs.push(...out)
      return { ...r, jobs: out }
    },
  }
}
function table(t, tableId = TABLE5, lines = [dish('Pad Thai')]) {
  const id = ulid()
  t.send(ev('check.opened', { mode: 'table', table_id: tableId, number: 7 }, id))
  for (const l of lines) t.send(ev('line.added', { line: l }, id))
  return { id, lines }
}
const sendAll = (t, c) => t.send(ev('lines.sent', { send_id: ulid(), line_ids: c.lines.map(l => l.id), held_course_ids: [] }, c.id))

test('check.allergy_set: stored cleaned, taken off with null, refused when wrong or on a closed check', () => {
  const t = till()
  const c = table(t)
  assert.equal(t.checks[c.id].allergy, null)
  let r = t.send(ev('check.allergy_set', { allergy: { allergens: [MILK, MILK, NUTS], diets: [VEGAN], note: '  Coeliac  ' } }, c.id))
  assert.ok(r.ok, r.error)
  assert.deepEqual(t.checks[c.id].allergy, { allergens: [MILK, NUTS], diets: [VEGAN], note: 'Coeliac' })
  for (const bad of [{}, { allergy: 'milk' }, { allergy: { allergens: ['milk'] } }, { allergy: { note: 'x'.repeat(ALLERGY_NOTE_MAX + 1) } }]) {
    r = t.send(ev('check.allergy_set', bad, c.id))
    assert.equal(r.ok, false, JSON.stringify(bad))
  }
  r = t.send(ev('check.allergy_set', { allergy: { allergens: [], diets: [], note: '' } }, c.id))
  assert.ok(r.ok)
  assert.equal(t.checks[c.id].allergy, null, 'a flag saying nothing is no flag')
  t.send(ev('check.allergy_set', { allergy: FLAG }, c.id))
  r = t.send(ev('check.allergy_set', { allergy: null }, c.id))
  assert.ok(r.ok)
  assert.equal(t.checks[c.id].allergy, null)
  // Closed: no changes.
  const e = table(t, TABLE6, [])
  t.send(ev('check.closed', {}, e.id))
  r = t.send(ev('check.allergy_set', { allergy: FLAG }, e.id))
  assert.equal(r.ok, false)
  // Replayed from scratch it comes out the same.
  const x = ulid()
  const events = [ev('check.opened', { mode: 'tab', tab_name: 'Sam' }, x), ev('check.allergy_set', { allergy: FLAG }, x)]
  const rp = replay({}, events, { staffById })
  assert.equal(rp.refused.length, 0, JSON.stringify(rp.refused))
  assert.deepEqual(rp.checks[x].allergy, cleanAllergy(FLAG))
})

test('the flag goes with dishes moved to another check and with a check merged into another', () => {
  const t = till()
  const a = table(t, TABLE5, [dish('Pad Thai'), dish('Salad')])
  const b = table(t, TABLE6, [dish('Rice')])
  t.send(ev('check.allergy_set', { allergy: { allergens: [MILK], diets: [], note: 'Table 5 guest' } }, a.id))
  t.send(ev('check.allergy_set', { allergy: { allergens: [NUTS], diets: [VEGAN], note: null } }, b.id))
  let r = t.send(ev('lines.moved', { to_check_id: b.id, line_ids: [a.lines[1].id] }, a.id))
  assert.ok(r.ok, r.error)
  assert.deepEqual(t.checks[b.id].allergy, { allergens: [NUTS, MILK], diets: [VEGAN], note: 'Table 5 guest' })
  assert.deepEqual(t.checks[a.id].allergy.allergens, [MILK], 'the check moved from keeps its own')
  const c = table(t, TABLE5, [dish('Soup')])
  t.send(ev('check.allergy_set', { allergy: { allergens: [], diets: [], note: 'Sesame' } }, c.id))
  r = t.send(ev('check.merged', { into_check_id: b.id }, c.id))
  assert.ok(r.ok, r.error)
  assert.equal(t.checks[b.id].allergy.note, 'Table 5 guest / Sesame')
  // A check without a flag moved into one keeps the one it has.
  const d = table(t, TABLE5, [dish('Bread')])
  t.send(ev('check.merged', { into_check_id: b.id }, d.id))
  assert.equal(t.checks[b.id].allergy.note, 'Table 5 guest / Sesame')
})

test('the kitchen order and its printed ticket carry the flag; a change after printing prints an update', () => {
  const t = till()
  const c = table(t, TABLE5, [dish('Pad Thai')])
  t.send(ev('check.allergy_set', { allergy: FLAG }, c.id))
  const sent = sendAll(t, c)
  const ko = t.orders[c.id]
  assert.equal(ko.allergy, 'Milk, Peanuts · Coeliac too')
  const ticket = toText(sent.jobs.find(j => j.printer_id === 'pK' && j.kind === 'kitchen').ops)
  assert.match(ticket, /ALLERGY: MILK, PEANUTS · COELIAC TOO/)
  assert.ok(ticket.indexOf('ALLERGY') < ticket.indexOf('Pad Thai'), 'above the dishes')
  assert.deepEqual(ko.allergy_printed, { [KP]: 'Milk, Peanuts · Coeliac too' })

  // Changed after printing: the kitchen order follows, the printer prints an update.
  let r = t.send(ev('check.allergy_set', { allergy: { allergens: [NUTS], diets: [VEGAN], note: null } }, c.id))
  assert.equal(t.orders[c.id].allergy, 'Peanuts · Vegan')
  assert.equal(r.jobs.length, 1)
  assert.equal(r.jobs[0].kind, 'allergy')
  assert.equal(r.jobs[0].printer_id, 'pK')
  const update = toText(r.jobs[0].ops)
  assert.match(update, /A L L E R G Y\s+U P D A T E/, 'big, across the top')
  assert.match(update, /ALLERGY: PEANUTS · VEGAN/)
  assert.doesNotMatch(update, /Pad Thai/, 'no dishes on the update')
  // Said again with nothing new: nothing prints.
  r = t.send(ev('check.allergy_set', { allergy: { allergens: [NUTS], diets: [VEGAN], note: '' } }, c.id))
  assert.equal(r.jobs.length, 0)
  // Taken off: the update says so.
  r = t.send(ev('check.allergy_set', { allergy: null }, c.id))
  assert.equal(t.orders[c.id].allergy, null)
  assert.match(toText(r.jobs[0].ops), /ALLERGY FLAG TAKEN OFF/)
  // A flag set on a check whose dishes haven't gone to the kitchen prints nothing yet.
  const d = table(t, TABLE6, [dish('Soup')])
  r = t.send(ev('check.allergy_set', { allergy: FLAG }, d.id))
  assert.equal(r.jobs.length, 0)
  assert.equal(t.orders[d.id], undefined)
})

test('a kitchen order printed before its flag existed gets no surprise update', () => {
  const t = till()
  const c = table(t, TABLE5, [dish('Pad Thai')])
  sendAll(t, c)
  const o = t.orders[c.id]
  delete o.allergy_printed // as orders printed before this change were kept
  o.allergy = 'An online guest\'s note'
  const out = kitchenPrintJobs({ [c.id]: o }, kcfg, new Date(clock).toISOString())
  assert.equal(out.jobs.length, 0)
})
