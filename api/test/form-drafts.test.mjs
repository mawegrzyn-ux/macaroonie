// Form drafts (migration 275, Pepper-first step 3d, docs/CHAT_FIRST.md F6):
// a form's unsaved values per person, form, venue and day, through
// /api/form-drafts. Each person reads and writes only their own, the venue
// must be the group's, the form needs View on its module, only forms that
// keep drafts have one, and drafts older than a week go.
import test from 'node:test'
import assert from 'node:assert/strict'

const { as, ok, sql, closeApp } = await import('./support/app.mjs')
const { resetAndSeed, A, B } = await import('./support/seed.mjs')
const { fillTenant } = await import('./support/fixtures.mjs')

let ids, V, VB
const DAY = '2026-11-23'
const where = (venue = V, form = 'delivery', day = DAY) => `/api/form-drafts?form=${form}&venue_id=${venue}&day=${day}`

test.before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  V = filled.ids.venue
  VB = (await ok(as(B.owner, ids.b).post('/api/venues', { name: 'Draft Elsewhere', slug: 'draft-elsewhere', timezone: 'Europe/London' }))).id
})
test.after(async () => { await closeApp() })

test('a draft is kept, read back and replaced whole', async () => {
  const me = as(A.owner, ids.a)
  assert.equal((await ok(me.get(where()))).draft, null, 'none yet')
  await ok(me.put('/api/form-drafts', { form: 'delivery', venue_id: V, day: DAY, values: { supplier: 'Fresh Co', notes: 'two short' } }))
  assert.deepEqual((await ok(me.get(where()))).draft.values, { supplier: 'Fresh Co', notes: 'two short' })
  await ok(me.put('/api/form-drafts', { form: 'delivery', venue_id: V, day: DAY, values: { supplier: 'Fresh Co' } }))
  assert.deepEqual((await ok(me.get(where()))).draft.values, { supplier: 'Fresh Co' }, 'the whole draft is replaced')
  // Another day is another draft.
  assert.equal((await ok(me.get(where(V, 'delivery', '2026-11-24')))).draft, null)
  await ok(me.delete(where()))
  assert.equal((await ok(me.get(where()))).draft, null, 'deleted on Save')
})

test('each person only their own; another group gets nothing', async () => {
  const me = as(A.owner, ids.a)
  await ok(me.put('/api/form-drafts', { form: 'delivery', venue_id: V, day: DAY, values: { supplier: 'Mine' } }))
  // Another person in the same group reads (and deletes) only their own.
  assert.equal((await ok(as(A.admin, ids.a).get(where()))).draft, null)
  await ok(as(A.admin, ids.a).delete(where()))
  assert.equal((await ok(me.get(where()))).draft.values.supplier, 'Mine', 'their delete never touches mine')
  // Another group's venue: 404, for reading and writing.
  assert.equal((await me.get(where(VB))).status, 404)
  assert.equal((await me.put('/api/form-drafts', { form: 'delivery', venue_id: VB, day: DAY, values: { supplier: 'x' } })).status, 404)
  // Another group's person can't reach this group's venue or draft.
  assert.equal((await as(B.owner, ids.b).get(where())).status, 404)
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM form_drafts WHERE venue_id = ${VB}`
  assert.equal(n, 0)
})

test('the form\'s module at View; only forms that keep drafts; a day where the form has one', async () => {
  // The viewer has no Cash Recon by default.
  assert.equal((await as(A.viewer, ids.a).get(where(V, 'expense'))).status, 403)
  assert.equal((await as(A.viewer, ids.a).get(where(V, 'delivery'))).status, 200, 'food safety at View')
  assert.equal((await as(A.owner, ids.a).get(where(V, 'temps'))).status, 400, 'the grids save as they are typed: no drafts')
  assert.equal((await as(A.owner, ids.a).get(`/api/form-drafts?form=delivery&venue_id=${V}`)).status, 400, 'no day')
  assert.equal((await as(A.owner, ids.a).put('/api/form-drafts', { form: 'delivery', venue_id: V, day: DAY, values: { notes: 'x'.repeat(25_000) } })).status, 400, 'too big')
})

test('drafts older than a week are cleared when the person\'s drafts are next read', async () => {
  const me = as(A.owner, ids.a)
  await ok(me.put('/api/form-drafts', { form: 'expense', venue_id: V, day: DAY, values: { description: 'Milk' } }))
  await sql`UPDATE form_drafts SET updated_at = now() - interval '8 days' WHERE form = 'expense' AND venue_id = ${V}`
  assert.equal((await ok(me.get(where(V, 'expense')))).draft, null)
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM form_drafts WHERE form = 'expense' AND venue_id = ${V}`
  assert.equal(n, 0, 'gone from the table')
})
