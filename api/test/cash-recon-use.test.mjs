// Use on Cash reconciliation: the everyday work (a day's figures, submitting
// it, expenses, the week's wage list and what was paid, fills from the till,
// Loyverse or GloriaFood) without the setup, which stays Manage.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, ok, closeApp, sql } from './support/app.mjs'
import { resetAndSeed, A } from './support/seed.mjs'
import { toolAllowed, audienceTools } from '../src/ai/tools/index.js'
import { levelsOf, workLevel } from '../src/config/modules.js'

const CASHIER = 'a-cashier'
const LOOKER = 'a-looker'
let ids, owner, cashier, looker, V, src

before(async () => {
  ids = await resetAndSeed()
  owner = as(A.owner, ids.a)
  V = (await ok(owner.post('/api/venues', { name: 'Ware', slug: 'cash-ware', timezone: 'Europe/London' }))).id
  src = await ok(owner.post(`/api/venues/${V}/cash-recon/config/income-sources`, { name: 'Food' }))
  const useRole = await ok(owner.post('/api/access/roles', { key: 'cashier', label: 'Cashier', permissions: { cash_recon: 'use' } }), 'cashier role')
  const viewRole = await ok(owner.post('/api/access/roles', { key: 'looker', label: 'Looker', permissions: { cash_recon: 'view' } }), 'looker role')
  for (const [sub, r] of [[CASHIER, useRole], [LOOKER, viewRole]]) {
    await sql`INSERT INTO users (tenant_id, email, role, auth0_user_id, custom_role_id)
              VALUES (${ids.a}, ${sub + '@test.local'}, 'operator', ${sub}, ${r.id})`
  }
  cashier = as(CASHIER, ids.a)
  looker = as(LOOKER, ids.a)
})
after(closeApp)

test('Cash reconciliation offers Use, and the role keeps it', async () => {
  assert.deepEqual(levelsOf('cash_recon'), ['none', 'view', 'use', 'manage'])
  assert.equal(workLevel('cash_recon'), 'use')
  const mods = await ok(owner.get('/api/access/modules'))
  assert.match(mods.find(m => m.key === 'cash_recon').use, /Fill in and submit days/)
  assert.equal((await ok(cashier.get('/api/me'))).permissions.cash_recon, 'use')
})

test('Use fills in, submits, adds expenses and pays wages; the setup needs Manage', async () => {
  const date = '2026-11-09', week = '2026-11-09'
  const day = await cashier.put(`/api/venues/${V}/cash-recon/daily/${date}`, { income: [{ source_id: src.id, gross_amount: 250 }] })
  assert.equal(day.status, 200, 'Use fills in a day: ' + day.body)
  const exp = await cashier.post(`/api/venues/${V}/cash-recon/expenses`, { date, description: 'Milk', amount: 4.5 })
  assert.equal(exp.status, 201, 'Use adds an expense: ' + exp.body)
  assert.equal((await cashier.put(`/api/venues/${V}/cash-recon/expenses/${exp.json.id}`, { description: 'Milk and eggs', amount: 6 })).status, 200)
  assert.equal((await cashier.delete(`/api/venues/${V}/cash-recon/expenses/${exp.json.id}`)).status, 204)
  const wages = await cashier.put(`/api/venues/${V}/cash-recon/wages/${week}`, { entries: [{ name: 'Sam', total: 100, cash_amount: 100, paid_date: date }] })
  assert.equal(wages.status, 200, 'Use records wages paid: ' + wages.body)
  const sub = await cashier.post(`/api/venues/${V}/cash-recon/daily/${date}/submit`, {})
  assert.equal(sub.status, 200, 'Use submits a day: ' + sub.body)

  // The setup, the default wage list and unsubmitting stay Manage (+ owner / admin).
  assert.equal((await cashier.post(`/api/venues/${V}/cash-recon/config/income-sources`, { name: 'Drinks' })).status, 403)
  assert.equal((await cashier.patch(`/api/venues/${V}/cash-recon/settings`, {})).status, 403)
  assert.equal((await cashier.post(`/api/venues/${V}/cash-recon/wages/${week}/set-default`, { entries: [] })).status, 403)
  assert.equal((await cashier.post(`/api/venues/${V}/cash-recon/daily/${date}/unsubmit`, {})).status, 403)

  // View reads only.
  assert.equal((await looker.get(`/api/venues/${V}/cash-recon/daily/${date}`)).status, 200)
  assert.equal((await looker.put(`/api/venues/${V}/cash-recon/daily/2026-11-10`, { income: [] })).status, 403)
  assert.equal((await looker.post(`/api/venues/${V}/cash-recon/expenses`, { date: '2026-11-10', description: 'Tea', amount: 2 })).status, 403)
  assert.equal((await looker.put(`/api/venues/${V}/cash-recon/wages/${week}`, { entries: [] })).status, 403)
})

test('Pepper: the cash change tools need Use, and Today lets Use do the cash-up', async () => {
  const cashChange = audienceTools('staff').filter(t => t.section === 'cash' && t.confirm)
  assert.ok(cashChange.length >= 5)
  assert.ok(cashChange.every(t => t.needs === 'use'), 'every cash change tool needs Use')
  assert.ok(cashChange.every(t => toolAllowed(t, { cash_recon: 'use' })), 'listed for Use')
  assert.ok(cashChange.every(t => !toolAllowed(t, { cash_recon: 'view' })), 'not for View')

  const feed = await ok(cashier.get(`/api/ops/today?venue_id=${V}&date=2026-11-10&time=23:00`))
  const cash = feed.tasks.filter(t => t.kind === 'cash_up')
  assert.ok(cash.length && cash.every(t => t.can_act === true), 'Use can do the cash-up')
  const vfeed = await ok(looker.get(`/api/ops/today?venue_id=${V}&date=2026-11-10&time=23:00`))
  assert.ok(vfeed.tasks.filter(t => t.kind === 'cash_up').every(t => t.can_act === false), 'View sees it, can\'t do it')
})
