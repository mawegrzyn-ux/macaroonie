// The plain renderer's rules (shared/plainForm.js, Pepper-first step 8A3):
// what is drawn for a field list is decided here, so the same list and values
// always draw the same form, and what is sent is only what the schema takes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { layoutOf, controlOf, shown, startOf, problemOf, bodyOf, savedLine, pickOption, BUTTON_CHOICES } from '../plainForm.js'

// A field list as GET /api/forms/staff_member gives it (api/src/forms/rota.js).
const STAFF = [
  { key: 'name', label: 'Name', required: true, type: 'text', maxLength: 200, help: 'As it shows on the rota.' },
  { key: 'role_id', label: 'Role', required: false, type: 'choice', options: { path: '/rota/setup', list: 'roles', label: 'name' } },
  { key: 'pay_type', label: 'Pay type', required: false, type: 'choice', default: 'fixed', choices: [{ value: 'hourly', label: 'Hourly' }, { value: 'fixed', label: 'Fixed' }] },
  { key: 'pay_basis', label: 'Fixed pay is', required: false, type: 'choice', default: 'week', when: { pay_type: 'fixed' },
    choices: [{ value: 'week', label: 'A week' }, { value: 'day', label: 'A day' }, { value: 'shift', label: 'A shift' }] },
  { key: 'default_rate', label: 'Rate (£)', required: false, type: 'money', min: 0, max: 1000000 },
  { key: 'lead_days', label: 'Days', required: false, type: 'int', min: 0, max: 30 },
  { key: 'on', label: 'On', required: false, type: 'bool', default: true },
  { key: 'from', label: 'From', required: true, type: 'date' },
  { key: 'by', label: 'By', required: false, type: 'time' },
  { key: 'notes', label: 'Notes', required: false, type: 'textarea', maxLength: 1000 },
]

test('the layout: every field drawn once, in the list\'s order, each with its control', () => {
  const values = { pay_type: 'fixed' }
  const a = layoutOf(STAFF, values)
  assert.deepEqual(a.map(l => [l.key, l.control]), [
    ['name', 'input:text'], ['role_id', 'select'], ['pay_type', 'buttons'], ['pay_basis', 'buttons'],
    ['default_rate', 'input:text'], ['lead_days', 'input:text'], ['on', 'checkbox'], ['from', 'date'], ['by', 'input:time'],
    ['notes', 'textarea'],
  ])
  // Deterministic: the same list and values, the same form, whatever came before.
  assert.deepEqual(layoutOf(STAFF, values), a)
  assert.deepEqual(layoutOf(JSON.parse(JSON.stringify(STAFF)), { ...values }), a)
  assert.equal(a[0].required, true)
  assert.deepEqual(a[2].choices, ['hourly', 'fixed'])
  // A field shows only when its `when` holds.
  assert.deepEqual(layoutOf(STAFF, { pay_type: 'hourly' }).map(l => l.key).includes('pay_basis'), false)
  assert.equal(shown(STAFF[3], {}), false)
  // Many choices are a list, a few are buttons.
  const many = { key: 'x', type: 'choice', choices: Array.from({ length: BUTTON_CHOICES + 1 }, (_, i) => ({ value: 'v' + i, label: 'V' + i })) }
  assert.equal(controlOf(many), 'select')
  assert.equal(controlOf({ type: 'email' }), 'input:email')
  assert.equal(controlOf({ type: 'tel' }), 'input:tel')
})

test('start values: Pepper\'s (or a draft\'s), else the schema\'s default, else empty; a pick by name', () => {
  const roles = [{ value: 'r1', label: 'Head chef' }, { value: 'r2', label: 'Server' }]
  assert.equal(startOf(STAFF[0], 'Jo'), 'Jo')
  assert.equal(startOf(STAFF[2], undefined), 'fixed')
  assert.equal(startOf(STAFF[6], undefined), true)
  assert.equal(startOf(STAFF[1], 'server', roles), 'r2')
  assert.equal(startOf(STAFF[1], 'chef', roles), 'r1', 'contained')
  assert.equal(startOf(STAFF[1], 'r2', roles), 'r2', 'a draft keeps the id')
  assert.equal(startOf(STAFF[1], 'Barista', roles), '', 'a name that isn\'t there stays empty')
  assert.equal(pickOption(roles, ''), null)
})

test('problems by the field list; the body only what the schema takes', () => {
  assert.equal(problemOf(STAFF[0], ''), 'Needed')
  assert.equal(problemOf(STAFF[4], '-1'), 'At least 0')
  assert.equal(problemOf(STAFF[5], '2.5'), 'A whole number')
  assert.equal(problemOf(STAFF[5], '31'), 'At most 30')
  assert.equal(problemOf(STAFF[9], 'x'.repeat(1001)), 'At most 1000 characters')
  assert.equal(problemOf(STAFF[6], false), null)
  const body = bodyOf(STAFF, { name: ' Jo ', role_id: '', pay_type: 'hourly', pay_basis: 'week', default_rate: '11.5', on: false, from: '2026-12-01', by: '14:00:00' })
  assert.deepEqual(body, { name: 'Jo', pay_type: 'hourly', default_rate: 11.5, on: false, from: '2026-12-01', by: '14:00' },
    'empty and hidden fields left out, numbers as numbers, a time as HH:MM')
  assert.deepEqual(bodyOf([{ key: 'description', type: 'text' }], { description: 'Milk' }, { date: 'date' }, '2026-11-24'), { description: 'Milk', date: '2026-11-24' })
})

test('the saved line', () => {
  const roles = { role_id: [{ value: 'r1', label: 'Head chef' }] }
  assert.equal(savedLine('Added {name} as {role_id}, {default_rate}', STAFF, { name: 'Jo', role_id: 'r1', default_rate: '12' }, roles), 'Added Jo as Head chef, £12.00')
  assert.equal(savedLine('{name}, {pay_type}', STAFF, { name: 'Jo', pay_type: 'fixed' }), 'Jo, Fixed')
  assert.equal(savedLine(null, STAFF, {}), 'Saved')
})
