// Cash Recon submitted once a week (migration 259, OUTSTANDING 44 item 10):
// the venue setting, the week's submit and unsubmit routes, a day refused
// on its own at a weekly venue, the Today feed's tasks for a weekly venue,
// and Pepper's submit_cash_week (submit_cash_day refuses there).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, ok, closeApp, getApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { addDays } from '../../shared/localInfo.js'
import { makeContext } from '../src/ai/context.js'
import { audienceTools, parseInput } from '../src/ai/tools/index.js'

let ids, owner, operator, other, V, C, today, monday, lastMonday, src

const mondayOf = d => { const x = new Date(d + 'T12:00:00Z'); return addDays(d, -((x.getUTCDay() + 6) % 7)) }
const feed = (q = '') => ok(owner.get(`/api/ops/today?venue_id=${V}${q}`))

before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  owner = as(A.owner, ids.a)
  operator = as(A.operator, ids.a)
  other = as(B.owner, ids.b)
  V = filled.ids.venue
  C = `/api/venues/${V}/cash-recon`
  today = (await feed()).date
  monday = mondayOf(today)
  lastMonday = addDays(monday, -7)
  src = await ok(owner.post(`${C}/config/income-sources`, { name: 'Weekly test food' }))
})
after(closeApp)

const fill = (date, gross) => ok(owner.put(`${C}/daily/${date}`, { income: [{ source_id: src.id, gross_amount: gross }] }))

test('the setting: once a week or each day, a field left out kept, owner / admin only', async () => {
  await ok(owner.patch(`${C}/settings`, { allow_bulk_submit: true }))
  const row = await ok(owner.patch(`${C}/settings`, { submit_mode: 'weekly' }))
  assert.equal(row.submit_mode, 'weekly')
  assert.equal(row.allow_bulk_submit, true, 'the other setting kept')
  const cfg = await ok(owner.get(`${C}/config`))
  assert.equal(cfg.venue_settings.allow_bulk_submit, true)
  assert.equal(cfg.venue_settings.submit_mode, 'weekly')
  assert.equal((await owner.patch(`${C}/settings`, { submit_mode: 'monthly' })).status, 400)
  assert.equal((await operator.patch(`${C}/settings`, { submit_mode: 'daily' })).status, 403)
  assert.equal((await other.patch(`${C}/settings`, { submit_mode: 'daily' })).status, 404, 'another tenant\'s venue')
  await ok(owner.patch(`${C}/settings`, { allow_bulk_submit: false }))
  assert.equal((await ok(owner.get(`${C}/week/${monday}`))).submit_mode, 'weekly', 'the week says how the venue submits')
})

test('weekly: a day can\'t be submitted alone; the week submits its days with figures up to today', async () => {
  await fill(addDays(lastMonday, 0), 100)
  await fill(addDays(lastMonday, 2), 200)
  const alone = await operator.post(`${C}/daily/${addDays(lastMonday, 0)}/submit`, {})
  assert.equal(alone.status, 422)
  assert.match(alone.json.error, /once a week/)

  const res = await ok(operator.post(`${C}/week/${addDays(lastMonday, 3)}/submit`, {}), 'any day of the week names it')
  assert.equal(res.week_start, lastMonday)
  assert.deepEqual(res.submitted, [lastMonday, addDays(lastMonday, 2)])
  assert.equal(res.skipped.length, 5, 'days with no figures left alone (bulk is off)')
  const week = await ok(owner.get(`${C}/week/${lastMonday}`))
  assert.equal(week.days.find(d => d.date === lastMonday).status, 'submitted')
  assert.equal(week.days.find(d => d.date === addDays(lastMonday, 1)).status, null)

  const again = await operator.post(`${C}/week/${lastMonday}/submit`, {})
  assert.equal(again.status, 422, 'nothing left to submit')
  const future = await operator.post(`${C}/week/${addDays(monday, 14)}/submit`, {})
  assert.equal(future.status, 422, 'a week that hasn\'t started')
  assert.equal((await as(A.viewer, ids.a).post(`${C}/week/${monday}/submit`, {})).status, 403, 'View can\'t submit')
  assert.equal((await other.post(`${C}/week/${lastMonday}/submit`, {})).status, 404, 'another tenant')
})

test('the week unsubmits for owners and admins only', async () => {
  assert.equal((await operator.post(`${C}/week/${lastMonday}/unsubmit`, {})).status, 403)
  const res = await ok(owner.post(`${C}/week/${lastMonday}/unsubmit`, {}))
  assert.deepEqual(res.unsubmitted, [lastMonday, addDays(lastMonday, 2)])
  assert.equal((await owner.post(`${C}/week/${lastMonday}/unsubmit`, {})).status, 422, 'nothing submitted')
})

test('the Today feed at a weekly venue: a day with figures is done; last week is one task from the Monday', async () => {
  // Last week has two days with figures, not submitted (unsubmitted above).
  let d = await feed('&time=10:00')
  const week = d.tasks.find(t => t.kind === 'cash_week')
  assert.ok(week, 'last week to submit')
  assert.equal(week.key, 'cash_week:' + lastMonday)
  assert.equal(week.title, 'Submit last week\'s cash-up')
  assert.match(week.detail, /^2 days to submit/)
  assert.equal(week.group, today > monday ? 'late' : 'now')
  assert.deepEqual(week.action, { path: '/cash-recon', label: 'Open the week', ref: { week: lastMonday } })
  // A day of this week with figures isn't a task; one without is.
  const yesterday = addDays(today, -1)
  await fill(yesterday, 50)
  d = await feed('&time=10:00')
  const cash = d.tasks.filter(t => t.kind === 'cash_up')
  assert.ok(!cash.some(t => t.key === 'cash_up:' + yesterday), 'a day with figures is done')
  assert.ok(cash.some(t => t.key === 'cash_up:' + today), 'today still to do')
  // Submitted: the week task goes.
  await ok(owner.post(`${C}/week/${lastMonday}/submit`, {}))
  d = await feed('&time=10:00')
  assert.ok(!d.tasks.some(t => t.kind === 'cash_week'), 'gone once submitted')
})

const quiet = { info() {}, warn() {}, error() {}, debug() {} }
async function pepper(sub, name, input, { run = true } = {}) {
  const app = await getApp()
  const ctx = makeContext({
    app, channel: 'staff_mcp', tenantId: ids.a, log: quiet,
    auth: { authorization: 'Bearer test:' + sub }, principal: { sub, email: sub + '@test.local' }, actor: sub + '@test.local',
  })
  const tool = audienceTools('staff').find(t => t.name === name)
  assert.ok(tool, name)
  const parsed = parseInput(tool, input)
  const card = tool.describe ? await tool.describe(ctx, parsed) : null
  return { card, out: run ? await tool.run(ctx, parsed) : null }
}

test('Pepper: submit_cash_day refuses at a weekly venue; submit_cash_week submits the week', async () => {
  const venues = await ok(owner.get('/api/venues'))
  const name = venues.find(v => v.id === V).name
  await ok(owner.post(`${C}/week/${lastMonday}/unsubmit`, {}))
  await assert.rejects(pepper(A.operator, 'submit_cash_day', { venue: name, date: lastMonday }), /once a week/)
  const { card, out } = await pepper(A.operator, 'submit_cash_week', { venue: name, week: lastMonday })
  assert.match(card.title, /^Submit the week of /)
  assert.ok(card.lines.some(l => l.startsWith('To submit: ')))
  // On a Monday the day filled as yesterday above is last week's Sunday, a third day.
  assert.equal(out.submitted.length, today === monday ? 3 : 2)
  await assert.rejects(pepper(A.operator, 'submit_cash_week', { venue: name, week: lastMonday }), /already submitted/)
  // Back to each day: the day submit works again.
  await ok(owner.patch(`${C}/settings`, { submit_mode: 'daily' }))
  // On a Monday yesterday is in the week just submitted: open it again first.
  if (today === monday) await ok(owner.post(`${C}/week/${lastMonday}/unsubmit`, {}))
  await fill(addDays(today, -1), 60)
  await ok(operator.post(`${C}/daily/${addDays(today, -1)}/submit`, {}))
})

test('bulk on: the open days with no figures are submitted empty, never after today', async () => {
  await ok(owner.patch(`${C}/settings`, { allow_bulk_submit: true }))
  try {
    const res = await ok(owner.post(`${C}/week/${monday}/submit`, {}))
    assert.ok(res.submitted.every(d => d <= today), 'no day after today')
    assert.ok(res.submitted.includes(monday))
  } finally {
    await ok(owner.post(`${C}/week/${monday}/unsubmit`, {}))
    await ok(owner.patch(`${C}/settings`, { allow_bulk_submit: false }))
  }
})
