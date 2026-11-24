// The plain renderer's forms (Pepper-first step 8A3): four flat set-up forms
// (a new supplier, staff member, expense, closure) drawn from the schema
// their route validates with. The field list per form, derived from that
// schema (never a copy); the same list for the same schema and role; the
// form saves through the route it names; and Pepper's values in open_form
// are checked by the route's own schema: a value outside it is refused.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { z } from 'zod'

const { as, getApp, ok, closeApp } = await import('./support/app.mjs')
const { resetAndSeed, A, B } = await import('./support/seed.mjs')
const { fillTenant } = await import('./support/fixtures.mjs')
const { makeContext } = await import('../src/ai/context.js')
const { audienceTools, parseInput } = await import('../src/ai/tools/index.js')
const { PLAIN_FORMS, plainFields } = await import('../src/forms/index.js')
const { FILES } = await import('../src/forms/files.js')
const { fieldList, checkPlainValues } = await import('../src/forms/plain.js')
const { SupplierBody } = await import('../src/routes/suppliers.js')
const { StaffBody } = await import('../src/routes/rota.js')
const { ExpenseBody } = await import('../src/routes/cashRecon.js')
const { ExceptionBody } = await import('../src/routes/schedules.js')
const { FORMS, PLAIN_FORM_KEYS } = await import('../../shared/forms.js')

let ids, owner, V, today, venue
const quiet = { info() {}, warn() {}, error() {}, debug() {} }
async function openForm(input, sub = A.owner) {
  const app = await getApp()
  const ctx = makeContext({
    app, channel: 'staff_chat', tenantId: ids.a, log: quiet,
    auth: { authorization: 'Bearer test:' + sub }, principal: { sub, email: sub + '@test.local' }, actor: sub + '@test.local',
  })
  const t = audienceTools('staff').find(x => x.name === 'open_form')
  return t.run(ctx, parseInput(t, input))
}
const shape = list => list.map(f => [f.key, f.type, !!f.required])

test.before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  owner = as(A.owner, ids.a)
  V = filled.ids.venue
  today = (await ok(owner.get(`/api/ops/today?venue_id=${V}`))).date
  venue = (await ok(owner.get('/api/venues'))).find(v => v.id === V).name
})
test.after(async () => { await closeApp() })

test('four plain forms, each in its area\'s file and in shared/forms.js, each the route\'s own schema', () => {
  assert.deepEqual(Object.keys(PLAIN_FORMS).sort(), ['closure', 'expense', 'staff_member', 'supplier'])
  assert.deepEqual(PLAIN_FORM_KEYS.sort(), Object.keys(PLAIN_FORMS).sort())
  assert.equal(PLAIN_FORMS.supplier.schema, SupplierBody, 'the route\'s schema itself, never a copy')
  assert.equal(PLAIN_FORMS.staff_member.schema, StaffBody)
  assert.equal(PLAIN_FORMS.expense.schema, ExpenseBody)
  assert.equal(PLAIN_FORMS.closure.schema, ExceptionBody)
  // The folder's files are all listed (no folder read, no top-level await).
  const dir = new URL('../src/forms/', import.meta.url)
  const areaFiles = fs.readdirSync(dir).filter(f => !['index.js', 'files.js', 'plain.js'].includes(f)).map(f => f.slice(0, -3))
  assert.deepEqual(FILES.map(([a]) => a).sort(), areaFiles.sort())
  for (const f of fs.readdirSync(dir)) assert.ok(!/^\s*await /m.test(fs.readFileSync(new URL(f, dir), 'utf8')), f)
  for (const k of PLAIN_FORM_KEYS) assert.deepEqual(FORMS[k].fields, {}, k + ': its fields are the API\'s, never listed in shared/forms.js')
})

test('the field list each form derives from its schema', () => {
  assert.deepEqual(shape(plainFields('supplier')), [
    ['name', 'text', true], ['contact_name', 'text', false], ['phone', 'tel', false], ['email', 'email', false],
    ['send_method', 'choice', false], ['account_ref', 'text', false], ['cutoff_time', 'time', false], ['lead_days', 'int', false],
    ['min_order', 'money', false], ['delivery_charge', 'money', false], ['website', 'url', false], ['notes', 'textarea', false],
  ])
  const sup = Object.fromEntries(plainFields('supplier').map(f => [f.key, f]))
  assert.deepEqual(sup.send_method.choices.map(c => c.value), ['email', 'print', 'excel', 'pdf'])
  assert.deepEqual([sup.lead_days.min, sup.lead_days.max], [0, 30])
  assert.equal(sup.name.maxLength, 200)
  assert.ok(sup.name.help && sup.name.examples.length)

  assert.deepEqual(shape(plainFields('staff_member')), [
    ['name', 'text', true], ['role_id', 'choice', false], ['pay_type', 'choice', false], ['pay_basis', 'choice', false],
    ['default_rate', 'money', false], ['pay_method', 'choice', false], ['bank_amount', 'money', false],
  ])
  const staff = Object.fromEntries(plainFields('staff_member').map(f => [f.key, f]))
  assert.equal(staff.pay_type.default, 'fixed', 'the schema\'s default')
  assert.deepEqual(staff.pay_basis.when, { pay_type: 'fixed' })
  assert.equal(staff.role_id.options.path, '/rota/setup')

  assert.deepEqual(shape(plainFields('expense')), [
    ['description', 'text', true], ['amount', 'money', false], ['vat_amount', 'money', false], ['category_id', 'choice', false],
    ['paid_by_card', 'bool', false], ['notes', 'textarea', false],
  ])
  assert.deepEqual(PLAIN_FORMS.expense.from, { date: 'date' }, 'the day comes from the sheet')

  assert.deepEqual(shape(plainFields('closure')), [['name', 'text', true], ['date_from', 'date', true], ['date_to', 'date', true], ['is_closed', 'bool', false]])
  assert.equal(plainFields('closure')[3].default, true)
})

test('a definition the schema doesn\'t back is refused at start-up', () => {
  const S = z.object({ name: z.string().min(1), tags: z.array(z.string()), when: z.string().optional() })
  assert.throws(() => fieldList('t1', { schema: S, fields: { name: {}, tags: {} }, leave: { when: 'x' } }), /tags: a ZodArray isn't a flat field/)
  assert.throws(() => fieldList('t2', { schema: S, fields: { name: {}, colour: {} }, leave: { tags: 'x', when: 'x' } }), /colour: isn't in the route's schema/)
  assert.throws(() => fieldList('t3', { schema: S, fields: { name: {} }, leave: { tags: 'x' } }), /the schema's when is neither drawn/)
  assert.throws(() => fieldList('t4', { schema: S, fields: { name: { kind: 'money' } }, leave: { tags: 'x', when: 'x' } }), /kind money doesn't fit/)
  assert.throws(() => fieldList('t5', { schema: S, fields: { name: { when: { nope: 1 } } }, leave: { tags: 'x', when: 'x' } }), /when names nope/)
  assert.throws(() => fieldList('t6', { schema: z.object({ on: z.boolean() }), fields: { on: { start: 'yes' } } }), /start "yes" isn't a value the schema takes/)
})

test('GET /api/forms/:key: the same list for the same schema and role; read only below the form\'s level', async () => {
  const a = await ok(owner.get('/api/forms/supplier'))
  const b = await ok(owner.get('/api/forms/supplier'))
  assert.deepEqual(a, b)
  assert.equal(a.read_only, false)
  assert.deepEqual(a.fields, plainFields('supplier'))
  assert.deepEqual(a.save, { method: 'POST', path: '/suppliers' })
  // Another group's owner: the same form.
  const other = await ok(as(B.owner, ids.b).get('/api/forms/supplier'))
  assert.deepEqual(other, a)
  const ex = await ok(owner.get('/api/forms/expense'))
  assert.deepEqual(ex.from, { date: 'date' })
  assert.match(ex.attach.path, /:id\/receipt$/)
  // A viewer reads the same fields, read only.
  const viewer = await as(A.viewer, ids.a).get('/api/forms/closure')
  if (viewer.status === 200) {
    assert.equal(viewer.json.read_only, true)
    assert.deepEqual(viewer.json.fields, plainFields('closure'))
  } else assert.equal(viewer.status, 403)
  assert.equal((await owner.get('/api/forms/cash_up')).status, 404, 'only plain forms')
  assert.equal((await owner.get('/api/forms/nope')).status, 404)
})

test('each form saves through the route it names, with a body made from its fields', async () => {
  const post = (def, body) => owner.post('/api' + def.save.path.replace(':venue', V), body)
  const s = await post(PLAIN_FORMS.supplier, { name: 'Plain Greens', send_method: 'print', lead_days: 2, cutoff_time: '14:00', min_order: 50, phone: '01234 567890' })
  assert.equal(s.status, 200, s.body)
  assert.equal(s.json.name, 'Plain Greens')
  assert.equal(s.json.cutoff_time.slice(0, 5), '14:00')
  const st = await post(PLAIN_FORMS.staff_member, { name: 'Plain Person', pay_type: 'hourly', default_rate: 11.5, pay_method: 'cash' })
  assert.equal(st.status, 200, st.body)
  assert.ok(st.json.id)
  const e = await post(PLAIN_FORMS.expense, { description: 'Plain milk', amount: 3.2, paid_by_card: false, date: today })
  assert.equal(e.status, 201, e.body)
  const c = await post(PLAIN_FORMS.closure, { name: 'Plain closure', date_from: '2027-01-05', date_to: '2027-01-05', is_closed: true })
  assert.equal(c.status, 201, c.body)
  assert.equal(c.json.is_closed, true)
})

test('open_form fills a plain form: values the schema takes are placed, one it refuses refuses the call', async () => {
  const out = await openForm({ form: 'supplier', values: { name: 'Fresh Fields', send_method: 'email', email: 'orders@fresh.test', lead_days: 1, colour: 'green' } })
  assert.deepEqual(out.form_card.values, { name: 'Fresh Fields', send_method: 'email', email: 'orders@fresh.test', lead_days: 1 })
  assert.equal(out.form_card.title, 'New supplier')
  assert.match(out.message, /colour \(not a field of this form\)/)
  await assert.rejects(openForm({ form: 'supplier', values: { name: 'X', send_method: 'fax' } }), /values\.send_method/)
  await assert.rejects(openForm({ form: 'supplier', values: { lead_days: 99 } }), /values\.lead_days/)
  await assert.rejects(openForm({ form: 'supplier', values: { email: 'not an email' } }), /values\.email: Enter a valid email address/)
  await assert.rejects(openForm({ form: 'closure', venue, values: { date_from: '24/12/2026' } }), /values\.date_from/)
  // A pick from the group's list is by its name (rule 19), found by the form.
  const staff = await openForm({ form: 'staff_member', venue, values: { name: 'Sam', role_id: 'Head chef', pay_type: 'hourly' } })
  assert.deepEqual(staff.form_card.values, { name: 'Sam', role_id: 'Head chef', pay_type: 'hourly' })
  // The expense's day is the form's own.
  const ex = await openForm({ form: 'expense', venue, values: { description: 'Milk', amount: 2.5, date: '2026-01-01' } })
  assert.deepEqual(ex.form_card.values, { description: 'Milk', amount: 2.5 })
  assert.match(ex.message, /date \(the form takes it from its day\)/)
  // The checks by themselves.
  assert.deepEqual(checkPlainValues('closure', PLAIN_FORMS.closure, { name: 'Xmas', is_closed: true }).values, { name: 'Xmas', is_closed: true })
})
