// Six more Today sources (Pepper-first step 5d; docs/claude/outstanding/shell.md
// "Sources not covered yet"): failed booking emails, reviews to check, menu
// screens and tills offline while the venue trades, sold out dishes, next
// week's rota still empty. Each reads its page's own route as the person,
// gives one task per thing with one action, in the right group, and leaves
// the list by evidence (or by hand where the feed can't see it finish).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, ok, closeApp, sql } from './support/app.mjs'
import { resetAndSeed, A } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { addDays } from '../../shared/localInfo.js'

let ids, owner, viewer, V, today
const feed = (who, q = '') => ok(who.get(`/api/ops/today?venue_id=${V}${q}`))
const ofKind = (d, kind) => d.tasks.filter(t => t.kind === kind)
const weekday = date => new Date(date + 'T12:00:00Z').getUTCDay()
/** The first day on or after `date` that is weekday `n` (0 Sunday). */
const nextWeekday = (date, n) => { let d = date; while (weekday(d) !== n) d = addDays(d, 1); return d }

before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  owner = as(A.owner, ids.a)
  viewer = as(A.viewer, ids.a)
  V = filled.ids.venue
  today = (await feed(owner)).date
})
after(closeApp)

test('a failed booking email today: one task, now, done by hand', async () => {
  const [b] = await sql`SELECT id FROM bookings WHERE tenant_id = ${ids.a} AND venue_id = ${V} LIMIT 1`
  const [e] = await sql`INSERT INTO email_log (tenant_id, booking_id, template_type, recipient, subject, status, error)
                        VALUES (${ids.a}, ${b.id}, 'confirmation', 'guest@example.invalid', 'Your booking', 'failed', 'Mailbox full') RETURNING id`
  const d = await feed(owner)
  const t = d.tasks.find(x => x.key === 'email_failed:' + e.id)
  assert.ok(t, 'listed')
  assert.equal(t.group, 'now')
  assert.equal(t.action.path, '/email-monitoring')
  assert.match(t.detail, /Mailbox full/)
  // Done by hand (the log keeps it failed), for the day.
  await ok(owner.post('/api/ops/tasks', { venue_id: V, key: t.key, action: 'done' }))
  const after = await feed(owner)
  assert.ok(!after.tasks.some(x => x.key === t.key))
  assert.equal(after.aside.find(x => x.key === t.key).state, 'done')
})

test('reviews waiting to be checked: one each, a low rating now, gone once checked', async () => {
  const d = await feed(owner)
  const reviews = ofKind(d, 'review_to_check')
  assert.ok(reviews.length >= 1, 'the fixtures\' reviews')
  for (const r of reviews) assert.equal(r.action.path, '/reviews')
  const [low] = await sql`INSERT INTO reviews (tenant_id, venue_id, platform, reviewer_name, rating, review_text)
                          VALUES (${ids.a}, ${V}, 'google', 'Grumpy', 1, 'Cold food') RETURNING id`
  const withLow = await feed(owner)
  assert.equal(withLow.tasks.find(x => x.key === 'review:' + low.id)?.group, 'now', 'one star: now')
  assert.ok(reviews.every(r => r.group === 'later' || /[12] star/.test(r.title)))
  await sql`UPDATE reviews SET checked_at = now() WHERE id = ${low.id}`
  assert.ok(!(await feed(owner)).tasks.some(x => x.key === 'review:' + low.id), 'checked: gone')
})

test('a menu screen and a till that stopped answering while the venue trades', async () => {
  const [sc] = await sql`INSERT INTO screens (tenant_id, venue_id, name, short_code, secret_hash, paired_at, last_seen_at)
                         VALUES (${ids.a}, ${V}, 'Window board', 'S9', 'x', now() - interval '1 day', now() - interval '20 minutes') RETURNING id`
  const [dev] = await sql`SELECT id FROM pos_devices WHERE tenant_id = ${ids.a} AND venue_id = ${V} AND revoked_at IS NULL ORDER BY created_at LIMIT 1`
  assert.ok(dev, 'the fixtures\' till')
  await sql`UPDATE pos_devices SET secret_hash = 'x', paired_at = now() - interval '1 day', last_seen_at = now() - interval '20 minutes' WHERE id = ${dev.id}`
  // Judge at a time the venue trades when the day has sittings; else now (seen in the last three hours).
  const { sittings } = await ok(owner.get(`/api/venues/${V}/schedule/sittings-for-date?date=${today}`))
  const opens = (sittings || []).map(x => String(x.opens_at || '').slice(0, 5)).filter(Boolean).sort()[0]
  const at = opens ? '&time=' + String(Number(opens.slice(0, 2)) + 1).padStart(2, '0') + opens.slice(2) : ''
  const d = await feed(owner, at)
  const screen = d.tasks.find(t => t.key === 'screen_offline:' + sc.id)
  const till = d.tasks.find(t => t.key === 'device_offline:' + dev.id)
  assert.ok(screen, 'the screen')
  assert.ok(till, 'the till')
  assert.equal(screen.group, 'now')
  assert.equal(till.action.path, '/pos/board')
  assert.match(till.detail, /^Last seen \d\d:\d\d/)
  // Another day's feed: kit is judged only now.
  assert.ok(!(await feed(owner, '&date=' + addDays(today, 1))).tasks.some(t => t.kind === 'screen_offline'))
  // Answering again: gone.
  await sql`UPDATE screens SET last_seen_at = now() WHERE id = ${sc.id}`
  await sql`UPDATE pos_devices SET last_seen_at = now() WHERE id = ${dev.id}`
  const back = await feed(owner, at)
  assert.ok(!back.tasks.some(t => t.key === screen.key || t.key === till.key))
})

test('sold out dishes: one each, later, opened in the sold out window', async () => {
  const d = await feed(owner)
  const sold = ofKind(d, 'sold_out')
  assert.ok(sold.some(t => /Pad Thai/.test(t.title)), 'the fixtures\' Pad Thai')
  for (const t of sold) {
    assert.equal(t.group, 'later')
    assert.deepEqual(t.action, { form: 'sold_out', label: 'Put back on' })
  }
  assert.equal(new Set(sold.map(t => t.title)).size, sold.length, 'a dish on two menus is one task')
})

test('next week\'s rota still empty: from Thursday, late at the weekend, gone once someone is on it', async () => {
  const thu = nextWeekday(addDays(today, 1), 4)
  const nextMonday = addDays(thu, 4)
  const d = await feed(owner, '&date=' + thu)
  const t = d.tasks.find(x => x.key === 'rota_next_week:' + nextMonday)
  assert.ok(t, 'Thursday: next week is empty')
  assert.equal(t.group, 'now')
  assert.equal(t.action.path, `/rota?venue=${V}&week=${nextMonday}`)
  assert.equal(t.can_act, true)
  const sat = addDays(thu, 2)
  assert.equal((await feed(owner, '&date=' + sat)).tasks.find(x => x.key === t.key)?.group, 'late', 'Saturday: late')
  const tue = addDays(thu, -2)
  assert.ok(!(await feed(owner, '&date=' + tue)).tasks.some(x => x.kind === 'rota_not_ready'), 'not before Thursday')
  // Someone on it: gone.
  const week = await ok(owner.get(`/api/rota/venues/${V}/weeks/${nextMonday}`))
  const [staff] = week.staff
  const [shift] = week.shifts.filter(s => s.is_active !== false)
  await sql`INSERT INTO rota_entries (tenant_id, venue_id, staff_id, work_date, shift_id, start_time, end_time)
            VALUES (${ids.a}, ${V}, ${staff.id}, ${nextMonday}::date, ${shift?.id ?? null},
                    ${shift ? null : '10:00'}::time, ${shift ? null : '18:00'}::time)`
  assert.ok(!(await feed(owner, '&date=' + thu)).tasks.some(x => x.key === t.key), 'someone on it')
})

test('each source keeps its own module: a viewer sees but can\'t act; every source loads', async () => {
  const d = await feed(viewer)
  for (const t of d.tasks.filter(x => ['sold_out', 'review_to_check', 'failed_email'].includes(x.kind))) {
    assert.equal(t.can_act, false, t.kind + ': View can\'t act')
  }
  assert.deepEqual(d.errors || [], [], 'every source loaded or was left out')
  const own = await feed(owner)
  assert.deepEqual(own.errors || [], [], 'the owner: every source loaded')
  assert.equal(own.not_included, undefined, 'the owner sees every area')
})
