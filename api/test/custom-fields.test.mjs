// A group's own fields (Pepper-first step 8B1, migration 285): definitions per
// object (customers, staff, suppliers, inventory items) with Manage on the
// object's module; values on the object's row, checked against them (type,
// required, choices) by every route that writes one; another group's
// definition is never found; the report catalogue offers them as fields of the
// object's subject, for that group only; the plain form draws them after the
// route's own fields; Pepper's tools take them by their names.
import test from 'node:test'
import assert from 'node:assert/strict'

const { as, getApp, ok, sql, closeApp } = await import('./support/app.mjs')
const { resetAndSeed, A, B } = await import('./support/seed.mjs')
const { fillTenant } = await import('./support/fixtures.mjs')
const { makeContext } = await import('../src/ai/context.js')
const { audienceTools, parseInput } = await import('../src/ai/tools/index.js')
const { CATALOGUE, customCatalogue, catalogueView } = await import('../src/reports/catalogue/index.js')
const { checkValues, fieldKeyOf, definitionProblem, fieldSql } = await import('../../shared/customFields.js')
const { bodyOf } = await import('../../shared/plainForm.js')

let ids, owner, viewer, operator, bOwner, V
const quiet = { info() {}, warn() {}, error() {}, debug() {} }
function ctxOf(sub = A.owner, tenantId = ids.a) {
  return getApp().then(app => makeContext({
    app, channel: 'staff_chat', tenantId, log: quiet,
    auth: { authorization: 'Bearer test:' + sub }, principal: { sub, email: sub + '@test.local' }, actor: sub + '@test.local',
  }))
}
const toolOf = name => audienceTools('staff').find(t => t.name === name)
async function describe(name, input, sub) { const t = toolOf(name); return t.describe(await ctxOf(sub), parseInput(t, input)) }
async function run(name, input, sub) { const t = toolOf(name); return t.run(await ctxOf(sub), parseInput(t, input)) }

test.before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  V = filled.ids.venue
  owner = as(A.owner, ids.a)
  viewer = as(A.viewer, ids.a)
  operator = as(A.operator, ids.a)
  bOwner = as(B.owner, ids.b)
})
test.after(async () => { await closeApp() })

test('the shared rules: keys from names, definitions, values by type, required and choices', () => {
  assert.equal(fieldKeyOf('Payment terms'), 'payment_terms')
  assert.equal(fieldKeyOf('2nd phone!'), 'f_2nd_phone')
  assert.equal(definitionProblem({ label: 'Halal', type: 'yesno' }), null)
  assert.match(definitionProblem({ label: 'Grade', type: 'choice', options: [] }), /choices/)
  assert.match(definitionProblem({ label: 'Grade', type: 'choice', options: ['A', 'a'] }), /twice/)
  assert.match(definitionProblem({ label: 'X', type: 'colour' }), /text, a number/)
  const defs = [
    { field_key: 'grade', label: 'Grade', type: 'choice', options: ['A', 'B'], required: true },
    { field_key: 'shelf_days', label: 'Shelf days', type: 'number' },
    { field_key: 'halal', label: 'Halal', type: 'yesno' },
    { field_key: 'audit', label: 'Last audit', type: 'date' },
  ]
  assert.deepEqual(checkValues(defs, { grade: 'b', shelf_days: '12', halal: 'yes', audit: '2026-11-02' }, { create: true }),
    { values: { grade: 'B', shelf_days: 12, halal: true, audit: '2026-11-02' }, problems: [] })
  const bad = checkValues(defs, { grade: 'C', shelf_days: 'twelve', halal: 'maybe', audit: '2026-02-30', colour: 'red' })
  assert.equal(bad.problems.length, 5, bad.problems.join(' | '))
  assert.deepEqual(checkValues(defs, { shelf_days: 3 }, { create: true }).problems, ['Grade: needed'], 'a required field on a new row')
  assert.deepEqual(checkValues(defs, { 'shelf DAYS': 3 }, { byLabel: true }).values, { shelf_days: 3 }, 'by name, any case')
  assert.deepEqual(checkValues(defs, { halal: null }).values, { halal: null }, 'null clears')
  assert.throws(() => fieldSql({ field_key: 'x\'; drop table', type: 'text' }), /safe/)
  // The plain form's body nests them under custom.
  assert.deepEqual(bodyOf([{ key: 'name', type: 'text' }, { key: 'custom.grade', in: 'custom', name: 'grade', type: 'choice' }],
    { name: 'Fresh Co', 'custom.grade': 'A' }), { name: 'Fresh Co', custom: { grade: 'A' } })
})

let terms, grade, allergy
test('definitions: Manage on the object\'s module makes them; View reads them; nothing else', async () => {
  // The fixtures made Payment terms on suppliers.
  const list = await ok(owner.get('/api/custom-fields?object=purchasing.suppliers'))
  terms = list.fields.find(f => f.label === 'Payment terms')
  assert.ok(terms, 'the fixture\'s field')
  grade = await ok(owner.post('/api/custom-fields', { object_key: 'purchasing.items', label: 'Grade', type: 'choice', options: ['A', 'B'], required: true }))
  assert.equal(grade.field_key, 'grade')
  allergy = await ok(owner.post('/api/custom-fields', { object_key: 'guests.customers', label: 'Allergy notes', type: 'text', help: 'What the guest told us' }))
  await ok(owner.post('/api/custom-fields', { object_key: 'staff.people', label: 'Food hygiene level', type: 'number' }))
  assert.equal((await owner.post('/api/custom-fields', { object_key: 'purchasing.items', label: 'grade', type: 'text' })).status, 409, 'one name per object')
  assert.equal((await owner.post('/api/custom-fields', { object_key: 'purchasing.items', label: 'Colour', type: 'choice' })).status, 422, 'a list needs choices')
  assert.equal((await owner.post('/api/custom-fields', { object_key: 'bookings.bookings', label: 'X', type: 'text' })).status, 400, 'only the four objects')
  // The module of each object decides: an operator has View on Customers and none on Purchasing setup.
  assert.equal((await operator.post('/api/custom-fields', { object_key: 'purchasing.items', label: 'Origin', type: 'text' })).status, 403)
  assert.equal((await operator.post('/api/custom-fields', { object_key: 'guests.customers', label: 'Origin', type: 'text' })).status, 403)
  assert.equal((await operator.patch('/api/custom-fields/' + grade.id, { label: 'Quality' })).status, 403)
  assert.equal((await viewer.delete('/api/custom-fields/' + allergy.id)).status, 403)
  const seen = await ok(operator.get('/api/custom-fields'))
  assert.ok(seen.fields.some(f => f.id === allergy.id), 'View on Customers reads its fields')
  assert.ok(!seen.fields.some(f => f.id === grade.id), 'none on Purchasing setup: not its fields')
  assert.ok(seen.objects.every(o => !o.can_manage))
  assert.equal((await operator.get('/api/custom-fields?object=purchasing.items')).status, 403)
  // The type and key never change; the name, choices and help can.
  const renamed = await ok(owner.patch('/api/custom-fields/' + grade.id, { label: 'Quality grade', options: ['A', 'B', 'C'] }))
  assert.deepEqual([renamed.label, renamed.field_key, renamed.type, renamed.options], ['Quality grade', 'grade', 'choice', ['A', 'B', 'C']])
})

test('another group\'s definition is never found, read, changed or deleted', async () => {
  assert.equal((await bOwner.patch('/api/custom-fields/' + grade.id, { label: 'Mine now' })).status, 404)
  assert.equal((await bOwner.delete('/api/custom-fields/' + grade.id)).status, 404)
  const theirs = await ok(bOwner.get('/api/custom-fields'))
  assert.ok(!theirs.fields.some(f => f.id === grade.id || f.label === 'Quality grade'))
  const [row] = await sql`SELECT label FROM custom_fields WHERE id = ${grade.id}`
  assert.equal(row.label, 'Quality grade')
  // B's own item takes no value for A's field (B has none).
  const r = await bOwner.post('/api/inventory/items', { name: 'B Flour', custom: { grade: 'A' } })
  assert.equal(r.status, 422)
})

test('values are checked on every write: type, required, choices; null clears; the row keeps them', async () => {
  assert.equal((await owner.post('/api/inventory/items', { name: 'Basmati', custom: {} })).status, 422, 'Quality grade is required on a new item from a form that draws it')
  const plain = await ok(owner.post('/api/inventory/items', { name: 'Plain flour' }))
  assert.deepEqual(plain.custom, {}, 'a row made where they aren\'t drawn (a page, an import, a booking\'s guest) starts without')
  const bad = await owner.post('/api/inventory/items', { name: 'Basmati', custom: { grade: 'Z' } })
  assert.equal(bad.status, 422)
  assert.match(bad.json.error, /Quality grade: one of: A, B, C/)
  const item = await ok(owner.post('/api/inventory/items', { name: 'Basmati', custom: { grade: 'b' } }))
  assert.deepEqual(item.custom, { grade: 'B' })
  assert.equal((await owner.patch('/api/inventory/items/' + item.id, { custom: { grade: null } })).status, 422, 'a required field can\'t be cleared')
  assert.equal((await owner.patch('/api/inventory/items/' + item.id, { custom: { nope: 1 } })).status, 422, 'a field nobody defined')
  const sup = (await ok(owner.get('/api/suppliers')))[0]
  assert.equal((await owner.patch('/api/suppliers/' + sup.id, { custom: { payment_terms: '60 days' } })).status, 422)
  const cust = await ok(owner.post('/api/customers', { name: 'Ann Allergy', custom: { allergy_notes: '  Nuts  ' } }))
  assert.deepEqual(cust.custom, { allergy_notes: 'Nuts' })
  const cleared = await ok(owner.patch('/api/customers/' + cust.id, { custom: { allergy_notes: null } }))
  assert.deepEqual(cleared.custom, {})
  await ok(owner.patch('/api/customers/' + cust.id, { custom: { allergy_notes: 'Shellfish' } }))
  // Anonymising a customer clears their own fields with the rest.
  await ok(owner.post('/api/customers/' + cust.id + '/anonymise', {}))
  const [after] = await sql`SELECT custom FROM customers WHERE id = ${cust.id}`
  assert.deepEqual(after.custom, {})
  // Staff: a number.
  const staff = await ok(owner.get(`/api/rota/venues/${V}/staff`))
  assert.equal((await owner.patch(`/api/rota/venues/${V}/staff/${staff[0].id}`, { custom: { food_hygiene_level: 'two' } })).status, 422)
  await ok(owner.patch(`/api/rota/venues/${V}/staff/${staff[0].id}`, { custom: { food_hygiene_level: 2 } }))
  const again = await ok(owner.get(`/api/rota/venues/${V}/staff`))
  assert.deepEqual(again.find(s => s.id === staff[0].id).custom, { food_hygiene_level: 2 })
})

test('the report catalogue offers them on the object\'s subject, for this group only, and a report reads them', async () => {
  const mine = await ok(owner.get('/api/reports/catalogue'))
  const f = mine.subjects['purchasing.items'].fields.cf_grade
  assert.deepEqual([f.label, f.type, f.custom], ['Quality grade', 'choice', true])
  assert.ok(mine.subjects['guests.customers'].fields.cf_allergy_notes, 'customers too')
  const theirs = await ok(bOwner.get('/api/reports/catalogue'))
  assert.ok(!theirs.subjects['purchasing.items'].fields.cf_grade, 'never in another group\'s catalogue')
  assert.ok(!CATALOGUE.subjects['purchasing.items'].fields.cf_grade, 'the built-in catalogue is never changed')
  // A list of items by grade, and a count per grade.
  await ok(owner.post('/api/inventory/items', { name: 'Jasmine', custom: { grade: 'A' } }))
  const list = await ok(owner.post('/api/reports/preview', { spec: { subject: 'purchasing.items', kind: 'list', rows: ['name', 'cf_grade'] } }))
  const byName = Object.fromEntries(list.rows.map(r => [r.cells[0], r.cells[1]]))
  assert.equal(byName.Basmati, 'B')
  assert.equal(byName.Jasmine, 'A')
  const counts = await ok(owner.post('/api/reports/preview', { spec: { subject: 'purchasing.items', kind: 'summary', rows: ['cf_grade'], values: [{ measure: 'items' }] } }))
  const byGrade = Object.fromEntries(counts.rows.map(r => [r.cells[0], r.cells[1]]))
  assert.equal(byGrade.A, 1)
  assert.equal(byGrade.B, 1)
  assert.notEqual((await bOwner.post('/api/reports/preview', { spec: { subject: 'purchasing.items', kind: 'list', rows: ['name', 'cf_grade'] } })).status, 200,
    'another group can\'t name the field')
  // The view built from definitions adds fields only.
  const cat = customCatalogue({ 'purchasing.items': [{ field_key: 'origin', label: 'Origin', type: 'text' }] })
  const view = catalogueView({ purchasing_setup: 'manage' }, cat)
  assert.equal(view.subjects['purchasing.items'].fields.cf_origin.label, 'Origin')
})

test('the plain form draws them after the route\'s own fields, and saves them through the route', async () => {
  const form = await ok(owner.get('/api/forms/supplier'))
  const own = form.fields.filter(f => f.in === 'custom')
  assert.deepEqual(own.map(f => [f.key, f.type, f.label]), [['custom.payment_terms', 'choice', 'Payment terms']])
  assert.deepEqual(own[0].choices.map(c => c.value), ['7 days', '30 days'])
  assert.equal(form.fields.at(-1).key, 'custom.payment_terms', 'after the route\'s own')
  const staffForm = await ok(owner.get('/api/forms/staff_member'))
  assert.ok(staffForm.fields.some(f => f.key === 'custom.food_hygiene_level' && f.type === 'number'))
  const expense = await ok(owner.get('/api/forms/expense'))
  assert.ok(!expense.fields.some(f => f.in), 'a form whose object takes none has none')
  // What the renderer sends is what the route takes.
  const body = bodyOf(form.fields, { name: 'Brakes', 'custom.payment_terms': '7 days' })
  const saved = await ok(owner.post('/api/suppliers', body))
  assert.deepEqual(saved.custom, { payment_terms: '7 days' })
  // B's form has none of A's.
  const bForm = await ok(bOwner.get('/api/forms/supplier'))
  assert.ok(!bForm.fields.some(f => f.in), 'B has no fields of its own')
})

test('Pepper\'s tools take them by name, refuse a wrong name or value, and show them on the card', async () => {
  const card = await describe('update_supplier', { supplier: 'Brakes', custom: { 'payment TERMS': '30 days' } })
  assert.ok(card.lines.includes('Payment terms: 7 days to 30 days'), card.lines.join(' | '))
  await assert.rejects(describe('update_supplier', { supplier: 'Brakes', custom: { 'Payment window': '30 days' } }), /no such field \(the fields are Payment terms\)/)
  await assert.rejects(describe('update_supplier', { supplier: 'Brakes', custom: { 'Payment terms': 'net 90' } }), /one of: 7 days, 30 days/)
  await run('update_supplier', { supplier: 'Brakes', custom: { 'Payment terms': '30 days' } })
  const [row] = await sql`SELECT custom FROM suppliers WHERE tenant_id = ${ids.a} AND name = 'Brakes'`
  assert.deepEqual(row.custom, { payment_terms: '30 days' })
  // A new item without its required field is refused before the card.
  await assert.rejects(describe('add_inventory_item', { name: 'Arborio' }), /Quality grade: needed/)
  const add = await describe('add_inventory_item', { name: 'Arborio', custom: { 'Quality grade': 'C' } })
  assert.ok(add.lines.includes('Quality grade: C'))
  // A customer's own field: the details tool shows it, the change tool sets it.
  const c = await ok(owner.post('/api/customers', { name: 'Bea Guest' }))
  await run('update_customer', { customer: c.id, custom: { 'Allergy notes': 'Sesame' } })
  const details = await run('customer_details', { customer: c.id })
  assert.deepEqual(details.own_fields, [{ label: 'Allergy notes', text: 'Sesame' }])
  // what_can_i_do names them.
  const what = await run('what_can_i_do', { object: 'suppliers' })
  assert.deepEqual(what.own_fields.map(f => f.name), ['Payment terms'])
  // open_form places them in the plain form, marked, by their key.
  const opened = await run('open_form', { form: 'supplier', values: { name: 'Bidfood', custom: { 'Payment terms': '7 days' } } })
  assert.equal(opened.form_card.values['custom.payment_terms'], '7 days')
  assert.ok(opened.form_card.labels.includes('Payment terms'))
})

test('deleting a definition takes its value off every row', async () => {
  const before = await sql`SELECT count(*)::int AS n FROM suppliers WHERE tenant_id = ${ids.a} AND custom ? 'payment_terms'`
  assert.ok(before[0].n >= 2)
  await ok(owner.delete('/api/custom-fields/' + terms.id))
  const after = await sql`SELECT count(*)::int AS n FROM suppliers WHERE tenant_id = ${ids.a} AND custom ? 'payment_terms'`
  assert.equal(after[0].n, 0)
  const bSup = await sql`SELECT count(*)::int AS n FROM custom_fields WHERE tenant_id = ${ids.b}`
  assert.equal(bSup[0].n, 0, 'nothing of B\'s touched (B has none here)')
})
