// The object registry (shared/registry/, Pepper-first step 8A1): one record
// per business object, in its area's file, gathered by files.js. What can be
// checked without the API: the files, the fields, the pages and the forms
// (api/test/pepper-registry.test.mjs checks the tools, subjects and tables).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { FILES } from '../registry/files.js'
import { OBJECT_LIST, OBJECTS, NOT_OBJECTS, registryProblems, findObjects, openLink, objectOfSubject, objectsOfAction } from '../registry/index.js'

const DIR = new URL('../registry/', import.meta.url)
const AREAS = fs.readdirSync(new URL('../../docs/claude/areas/', import.meta.url)).filter(f => f.endsWith('.md')).map(f => f.slice(0, -3))

test('every file in shared/registry is an area of the notes, and files.js lists each one', () => {
  const files = fs.readdirSync(DIR).filter(f => f.endsWith('.js') && !['index.js', 'files.js'].includes(f)).map(f => f.slice(0, -3))
  for (const f of files) assert.ok(AREAS.includes(f), f + ' is not an area (docs/claude/areas/<area>.md)')
  assert.deepEqual(FILES.map(([a]) => a).sort(), files.sort(), 'files.js lists every area file in shared/registry, and only those')
  for (const [area, mod] of FILES) {
    assert.ok(Array.isArray(mod.objects) && mod.objects.length, area + ' exports its objects')
    for (const k of Object.keys(mod)) assert.ok(['objects', 'notObjects'].includes(k), area + ' exports ' + k)
  }
  // A gathered module never waits at its top level (two would deadlock).
  for (const f of fs.readdirSync(DIR)) assert.ok(!/^\s*await /m.test(fs.readFileSync(new URL(f, DIR), 'utf8')), f + ' has a top-level await')
})

test('the records name pages and forms that exist, each subject once', () => {
  assert.deepEqual(registryProblems(), [])
  assert.ok(OBJECT_LIST.length >= 40, OBJECT_LIST.length + ' objects')
  for (const k of ['bookings.bookings', 'guests.customers', 'venue', 'safety.fridges', 'safety.fridge_checks', 'safety.checklists',
    'safety.actions', 'staff.people', 'rota.entries', 'purchasing.suppliers', 'purchasing.items', 'purchasing.orders',
    'menu.dishes', 'menu.menus', 'cash.days', 'cash.expenses', 'online.orders', 'reports.reports', 'bookings.closures']) {
    assert.ok(OBJECTS[k], k)
  }
})

test('a broken record is caught: a page, a form, a field, a subject twice', () => {
  const o = OBJECT_LIST[0]
  const saved = { ...o }
  try {
    Object.assign(o, { page: '/no-such-page', forms: ['no_form'], colour: 'red', open: { page: '/rota', with: ['date'] } })
    const p = registryProblems().join('\n')
    assert.match(p, /\/no-such-page is not a page/)
    assert.match(p, /form no_form/)
    assert.match(p, /unknown field colour/)
    assert.match(p, /\/rota doesn't open at a date/)
  } finally {
    for (const k of Object.keys(o)) delete o[k]
    Object.assign(o, saved)
  }
  assert.deepEqual(registryProblems(), [])
})

test('with what the API knows: unknown tools, subjects and tables, a change tool or subject left out', () => {
  const tools = new Map(OBJECT_LIST.flatMap(o => o.actions).map(n => [n, { readOnly: false }]))
  const subjects = [...OBJECT_LIST.flatMap(o => o.subjects), ...Object.keys(NOT_OBJECTS)]
  const tables = OBJECT_LIST.map(o => o.table)
  assert.deepEqual(registryProblems({ tools, subjects, tables }), [])
  const p = registryProblems({
    tools: new Map([...tools, ['make_tea', { readOnly: false }], ['create_booking', { readOnly: true }]]),
    subjects: [...subjects, 'till.tea'].filter(s => s !== 'bookings.emails'),
    tables: tables.filter(t => t !== 'suppliers'),
  }).join('\n')
  assert.match(p, /The change tool make_tea belongs to no object/)
  assert.match(p, /create_booking only reads/)
  assert.match(p, /The report subject till\.tea belongs to no object/)
  assert.match(p, /bookings\.emails, which isn't in the report catalogue/)
  assert.match(p, /its table suppliers has no decision/)
})

test('finding an object by its words, and the address that opens one', () => {
  assert.equal(findObjects('suppliers')[0].key, 'purchasing.suppliers')
  assert.equal(findObjects('a supplier')[0].key, 'purchasing.suppliers')
  assert.equal(findObjects('purchasing.suppliers')[0].key, 'purchasing.suppliers')
  assert.equal(findObjects('fridge temps')[0].key, 'safety.fridge_checks')
  assert.equal(findObjects('reservations')[0].key, 'bookings.bookings')
  assert.equal(findObjects('the cash-up')[0].key, 'cash.days')
  assert.deepEqual(findObjects('unicorns'), [])
  const booking = OBJECTS['bookings.bookings']
  const v = '0b9f2a3e-1111-4222-8333-944455556666'
  assert.equal(openLink(booking, { venue: v, date: '2026-11-24', week: '2026-11-23' }), '/timeline?venue=' + v + '&date=2026-11-24')
  assert.equal(openLink(OBJECTS['purchasing.suppliers'], { venue: v }), '/suppliers')
  assert.equal(objectOfSubject('till.lines').key, 'till.checks')
  assert.deepEqual(objectsOfAction('add_corrective_action').map(o => o.key).sort(),
    ['safety.cooking_checks', 'safety.fridge_checks', 'safety.hold_checks'])
})
