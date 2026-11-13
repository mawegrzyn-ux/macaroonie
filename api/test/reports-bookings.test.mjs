// The report builder's booking figures against the app's own (docs/REPORTS.md
// 5.4, 19): the bookings list (GET /api/bookings) counted the way the
// Bookings page counts it (reservations and guests leave out cancelled
// bookings and no-shows), and the deposits it shows on each booking.
//
// Two sets of bookings at one venue: the fixtures' own (a booking and three
// days of test bookings, whatever the generator made), and eight made here on
// four fixed days with known sizes, statuses, sources, guests who come back,
// lead times and deposits (plus one after midnight, on days of its own).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, sql, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { runner, rowsOf, totalsRow, p, measures, refused, LEVELS } from './support/reports.mjs'

let ids, owner, V, run, bk = {}, table

// The days made here (a Monday to Wednesday, and the Monday after).
const MON = '2026-09-14', TUE = '2026-09-15', WED = '2026-09-16', NEXT = '2026-09-21'
const MADE = { from: MON, to: NEXT }
// A Thursday, for the booking after midnight.
const LATE = '2026-09-24'
// The fixtures' days.
const SEEDED = { from: '2026-10-19', to: '2026-10-21' }
const DAYS = { made: [MON, TUE, WED, NEXT], seeded: ['2026-10-19', '2026-10-20', '2026-10-21'] }

const period = r => ({ field: 'date', op: 'in_period', value: { from: r.from, to: r.to } })
const here = () => ({ field: 'venue', op: 'in', value: [V] })
const base = r => [period(r), here()]
const starter = (key, r, who = owner) => who.post(`/api/reports/${encodeURIComponent('starter:' + key)}/run`, { params: { period: { from: r.from, to: r.to }, venues: [V] }, fresh: true })
const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400_000).toISOString().slice(0, 10)

// A day's bookings as the Bookings page gets them, counted by its own rule.
async function pageDay(date) {
  const list = await ok(owner.get(`/api/bookings?venue_id=${V}&date=${date}&limit=200`))
  assert.ok(list.length < 200, 'the whole day fits one page')
  const active = list.filter(b => !['cancelled', 'no_show'].includes(b.status))
  return {
    list,
    made: list.length,
    reservations: active.length,
    guests: active.reduce((s, b) => s + (b.covers ?? 0), 0),
    cancelled: list.filter(b => b.status === 'cancelled').length,
    no_shows: list.filter(b => b.status === 'no_show').length,
  }
}

before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  await fillTenant(B.owner, ids.b, { mark: 'Yyc', slug: 'yyc' })
  owner = as(A.owner, ids.a)
  V = filled.ids.venue
  table = (await ok(owner.get(`/api/venues/${V}/tables`))).find(t => !t.is_unallocated)

  // key: [day, time (UTC: an hour later at the venue in September), guests, status, booked through, guest, days booked ahead]
  const plan = {
    a: [MON, '18:00', 2, 'confirmed', null, 'ann', 0],
    b: [MON, '19:00', 4, 'seated', 'staff_chat', 'ben', 1],
    c: [MON, '19:00', 6, 'cancelled', null, 'cat', 3],
    d: [TUE, '18:00', 9, 'confirmed', 'guest_chat', 'dan', 10],
    e: [TUE, '19:30', 2, 'no_show', null, 'eve', 20],
    f: [WED, '18:00', 3, 'checked_out', null, 'ann', 2],      // Ann again: returning
    g: [WED, '20:00', 2, 'confirmed', null, 'cat', 5],        // Cat's first booking was cancelled: still new
    h: [NEXT, '18:00', 8, 'confirmed', 'guest_mcp', 'ben', 14], // Ben again: returning
    w: [NEXT, '19:00', 2, 'confirmed', null, null, 0],        // a walk-in: no customer record
  }
  for (const [k, [day, time, covers, status, source, guest, ahead]] of Object.entries(plan)) {
    const made = await ok(owner.post('/api/bookings/admin-override', {
      venue_id: V, starts_at: `${day}T${time}:00`, covers, table_ids: k === 'a' ? [table.id] : [],
      guest_name: guest ? guest[0].toUpperCase() + guest.slice(1) + ' Guest' : 'Walk In',
      guest_email: guest ? guest + '@example.test' : 'walkin@walkin.com',
    }), 'booking ' + k)
    bk[k] = made.id
    if (status !== 'confirmed') await ok(owner.patch(`/api/bookings/${made.id}/status`, { status }), 'status ' + k)
    // When it was booked, and through what: neither can be chosen through the routes.
    await sql`UPDATE bookings SET created_at = ${addDays(day, -ahead) + 'T11:00:00Z'}, source = ${source} WHERE id = ${made.id}`
  }
  // One more, outside those days: 23:30 on Thursday for the server is 00:30 on
  // Friday at the venue. Booked twenty minutes before, which is Friday there too.
  const late = await ok(owner.post('/api/bookings/admin-override', {
    venue_id: V, starts_at: LATE + 'T23:30:00', covers: 2, table_ids: [], guest_name: 'Zoe Guest', guest_email: 'zoe@example.test',
  }), 'the late booking')
  bk.z = late.id
  await sql`UPDATE bookings SET created_at = ${LATE + 'T23:10:00Z'} WHERE id = ${late.id}`
  // Deposits: Dan's £45 kept, Ben's £40 with £15 back, Cat's £30 all back, Ann's never paid.
  const deposit = (k, amount, status, refunded, paidOn) => sql`
    INSERT INTO payments (booking_id, tenant_id, stripe_pi_id, amount, currency, status, refunded_amount, refunded_at, created_at)
    VALUES (${bk[k]}, ${ids.a}, ${'pi_test_' + k}, ${amount}, 'GBP', ${status}, ${refunded}, ${refunded ? paidOn + 'T15:00:00Z' : null}, ${paidOn + 'T11:00:00Z'})`
  await deposit('d', 45, 'succeeded', 0, '2026-09-05')
  await deposit('h', 40, 'partially_refunded', 15, '2026-09-07')
  await deposit('c', 30, 'refunded', 30, '2026-09-11')
  await deposit('a', 10, 'pending', 0, '2026-09-14')
  run = runner(ids.a)
})
after(closeApp)

test('bookings, guests, cancellations and no-shows are the Bookings page\'s own, day by day', async () => {
  for (const [r, days, what] of [[MADE, DAYS.made, 'the bookings made here'], [SEEDED, DAYS.seeded, 'the fixtures\' bookings']]) {
    const res = await run({
      subject: 'bookings.bookings', rows: ['date'], values: measures(['bookings', 'guests', 'made', 'cancelled', 'no_shows']),
      filters: base(r), sort: [{ by: 'date', dir: 'asc' }],
    })
    const mine = Object.fromEntries(rowsOf(res).map(x => [x.date, [x.made, x.bookings, x.guests ?? 0, x.cancelled, x.no_shows]]))
    let total = 0
    for (const day of days) {
      const d = await pageDay(day)
      total += d.made
      if (!d.made) { assert.equal(mine[day], undefined, what + ': no row for a day without bookings'); continue }
      assert.deepEqual(mine[day], [d.made, d.reservations, d.guests, d.cancelled, d.no_shows], what + ': ' + day)
    }
    assert.ok(total >= 3, what + ': there are bookings to compare')
    assert.equal(totalsRow(res).made, total, what + ': the days add up')
  }
})

test('the bookings made here, as known: counts, rates, averages', async () => {
  const res = await run({
    subject: 'bookings.bookings',
    values: measures(['made', 'bookings', 'guests', 'cancelled', 'no_shows', 'expected', 'no_show_rate', 'cancel_rate', 'average_party', 'average_lead']),
    filters: base(MADE),
  })
  const [m] = rowsOf(res)
  // Nine made; Cat's was cancelled and Eve didn't turn up: seven stood, with 30 guests.
  assert.deepEqual([m.made, m.bookings, m.guests, m.cancelled, m.no_shows, m.expected], [9, 7, 30, 1, 1, 8])
  assert.equal(m.no_show_rate, Number((1 / 8).toFixed(6)), 'no-shows out of the bookings that weren\'t cancelled')
  assert.equal(m.cancel_rate, Number((1 / 9).toFixed(6)))
  assert.equal(m.average_party, Number((30 / 7).toFixed(6)))
  // Days ahead of the seven that stood: 0, 1, 10, 2, 5, 14, 0.
  assert.equal(m.average_lead, Number((32 / 7).toFixed(6)))

  const list = await run({
    subject: 'bookings.bookings', kind: 'list',
    rows: ['date', 'starts_at', 'covers', 'status', 'source', 'party_size', 'booked_ahead', 'lead_days', 'guest_kind', 'table.name', 'guest_name', 'length'],
    filters: base(MADE), sort: [{ by: 'starts_at', dir: 'asc' }, { by: 'covers', dir: 'asc' }],
  })
  assert.deepEqual(rowsOf(list).map(x => [x.date, x.covers, x.status, x.source, x.party_size, x.booked_ahead, x.lead_days, x.guest_kind, x.guest_name]), [
    [MON, 2, 'confirmed', 'direct', '1_2', 'same_day', 0, 'new', 'Ann Guest'],
    [MON, 4, 'seated', 'staff_chat', '3_4', 'day_before', 1, 'new', 'Ben Guest'],
    [MON, 6, 'cancelled', 'direct', '5_6', 'week', 3, 'new', 'Cat Guest'],
    [TUE, 9, 'confirmed', 'guest_chat', '9_up', 'two_weeks', 10, 'new', 'Dan Guest'],
    [TUE, 2, 'no_show', 'direct', '1_2', 'longer', 20, 'new', 'Eve Guest'],
    [WED, 3, 'checked_out', 'direct', '3_4', 'week', 2, 'returning', 'Ann Guest'],
    [WED, 2, 'confirmed', 'direct', '1_2', 'week', 5, 'new', 'Cat Guest'],
    [NEXT, 8, 'confirmed', 'guest_mcp', '7_8', 'longer', 14, 'returning', 'Ben Guest'],
    [NEXT, 2, 'confirmed', 'direct', '1_2', 'same_day', 0, 'unknown', 'Walk In'],
  ])
  const first = rowsOf(list)[0]
  assert.equal(first['table.name'], table.label, 'the table by its name')
  assert.ok(first.length > 0, 'a booking has a length')
  // A moment is shown at the venue's own time: 18:00 UTC is 19:00 in London in September.
  assert.equal(first.starts_at, MON + 'T19:00:00')
  assert.equal(list.columns.find(c => c.key === 'guest_name').pii, true, 'a guest\'s name is marked as personal')
  assert.equal(list.columns.find(c => c.key === 'party_size').labels['9_up'], '9 or more')

  // A booking after midnight is on the venue's day: Friday there, though the
  // server (and the bookings list) has it on Thursday. It was booked on the
  // Friday too, by the venue's clock: on the day, not the day before.
  const friday = addDays(LATE, 1)
  const late = await run({
    subject: 'bookings.bookings', kind: 'list', rows: ['date', 'starts_at', 'lead_days', 'booked_ahead'],
    filters: base({ from: LATE, to: friday }),
  })
  assert.deepEqual(rowsOf(late).map(x => [x.date, x.starts_at, x.lead_days, x.booked_ahead]), [[friday, friday + 'T00:30:00', 0, 'same_day']])
  const thursday = await run({ subject: 'bookings.bookings', values: measures(['made']), filters: base({ from: LATE, to: LATE }) })
  assert.equal(rowsOf(thursday)[0]?.made ?? 0, 0, 'none on the Thursday')
})

test('the booking starter reports, run as the Reports page runs them', async () => {
  const cellsBy = (res, key = 0) => Object.fromEntries(res.rows.filter(x => x.kind === 'row').map(x => [x.cells[key], x.cells.slice(1)]))

  // Guests by day and time: a column for each hour bookings start (the venue's hours).
  const guests = await ok(starter('bookings_guests_by_day', MADE))
  assert.equal(guests.kind, 'matrix')
  assert.deepEqual(guests.columns.map(c => [c.key, c.group || null]), [['date', null], ['guests|0', '19:00'], ['guests|1', '20:00'], ['guests|2', '21:00'], ['guests|total', 'Total']])
  // Empty: nothing was booked then. 0: something was (Eve's no-show at 20:30 on Tuesday), but nobody came.
  assert.deepEqual(guests.rows.map(x => x.cells), [
    [MON, 2, 4, null, 6],
    [TUE, 9, 0, null, 9],
    [WED, 3, null, 2, 5],
    [NEXT, 8, 2, null, 10],
  ])
  assert.deepEqual(guests.totals.cells, [null, 22, 6, 2, 30])
  assert.equal(guests.meta.period.text, '14 to 21 Sep 2026')

  // By source.
  const source = await ok(starter('bookings_by_source', MADE))
  assert.deepEqual(source.columns.map(c => c.label), ['Booked through', 'Bookings made', 'Bookings', 'Guests', 'Cancelled', 'No-shows'])
  assert.deepEqual(cellsBy(source), {
    direct: [6, 4, 9, 1, 1],
    staff_chat: [1, 1, 4, 0, 0],
    guest_chat: [1, 1, 9, 0, 0],
    guest_mcp: [1, 1, 8, 0, 0],
  })
  assert.equal(source.rows[0].cells[0], 'direct', 'most bookings made first')
  assert.deepEqual(source.totals.cells, [null, 9, 7, 30, 1, 1])

  // No-shows and cancellations, week by week.
  const lost = await ok(starter('bookings_no_shows', MADE))
  assert.deepEqual(lost.columns.map(c => [c.label, c.type]), [['Week', 'date'], ['Bookings made', 'number'], ['Cancelled', 'number'], ['Cancelled rate', 'percent'], ['No-shows', 'number'], ['No-show rate', 'percent']])
  assert.equal(lost.columns[0].bucket, 'week')
  assert.deepEqual(lost.rows.map(x => x.cells), [
    [MON, 7, 1, Number((1 / 7).toFixed(6)), 1, Number((1 / 6).toFixed(6))],
    [NEXT, 2, 0, 0, 0, 0],
  ])

  // How far ahead people book: each band's share of the bookings that stood.
  const ahead = await ok(starter('bookings_lead_time', MADE))
  assert.deepEqual(ahead.columns.map(c => c.label), ['Booked ahead', 'Bookings', 'Guests', 'Average days ahead', 'Share of bookings'])
  const share = n => Number((n / 7).toFixed(6))
  assert.deepEqual(cellsBy(ahead), {
    same_day: [2, 4, 0, share(2)],
    day_before: [1, 4, 1, share(1)],
    week: [2, 5, 3.5, share(2)],
    two_weeks: [1, 9, 10, share(1)],
    longer: [1, 8, 14, share(1)],
  })
  assert.deepEqual(ahead.rows.map(x => x.cells[0]), ['same_day', 'day_before', 'week', 'two_weeks', 'longer'], 'in the bands\' own order')

  // Party sizes. A size only a cancelled booking had still has its row.
  const sizes = await ok(starter('bookings_party_sizes', MADE))
  assert.deepEqual(cellsBy(sizes), {
    '1_2': [3, 6, share(3)],
    '3_4': [2, 7, share(2)],
    '5_6': [0, 0, 0],
    '7_8': [1, 8, share(1)],
    '9_up': [1, 9, share(1)],
  })

  // New and returning guests.
  const kinds = await ok(starter('bookings_new_returning', MADE))
  assert.deepEqual(cellsBy(kinds), {
    new: [4, 17, share(4)],
    returning: [2, 11, share(2)],
    unknown: [1, 2, share(1)],
  })
  assert.equal(kinds.columns[0].labels.unknown, 'No customer record')

  // Deposits, by the week each was paid: the one never paid isn't one.
  const paid = { from: '2026-09-01', to: '2026-09-20' }
  const deposits = await ok(starter('bookings_deposits', paid))
  assert.deepEqual(deposits.columns.map(c => c.label), ['Week paid', 'Deposits', 'Deposits taken', 'Refunded', 'Kept'])
  assert.deepEqual(deposits.rows.map(x => x.cells), [
    ['2026-08-31', 1, 45, 0, 45],
    ['2026-09-07', 2, 70, 45, 25],
    // The week with only the unpaid one: a row, with nothing counted in it.
    ['2026-09-14', 0, 0, 0, 0],
  ])
  assert.deepEqual(deposits.totals.cells, [null, 3, 115, 45, 70])
})

test('deposits are the ones the bookings list shows on each booking', async () => {
  let taken = 0, refunded = 0, count = 0
  for (const day of DAYS.made) {
    for (const b of (await pageDay(day)).list) {
      if (!['succeeded', 'refunded', 'partially_refunded'].includes(b.payment_status)) continue
      count++
      taken += Math.round(Number(b.payment_amount) * 100)
      refunded += Math.round(Number(b.payment_refunded) * 100)
    }
  }
  const res = await run({
    subject: 'bookings.deposits', values: measures(['deposits', 'taken', 'refunded_total', 'kept_total']),
    filters: [{ field: 'booking.date', op: 'in_period', value: MADE }, here()],
  })
  const [m] = rowsOf(res)
  assert.deepEqual([m.deposits, p(m.taken), p(m.refunded_total), p(m.kept_total)], [count, taken, refunded, taken - refunded])
  assert.deepEqual([count, taken, refunded], [3, 11500, 4500])

  // Each deposit with its booking: looked up through the link, by the booking's own day.
  const list = await run({
    subject: 'bookings.deposits', kind: 'list', rows: ['date', 'booking.date', 'reference', 'booking.guest_name', 'status', 'amount', 'refunded', 'kept'],
    filters: [here()], sort: [{ by: 'date', dir: 'asc' }],
  })
  assert.deepEqual(rowsOf(list).map(x => [x.date, x['booking.date'], x['booking.guest_name'], x.status, p(x.amount), p(x.refunded), p(x.kept)]), [
    ['2026-09-05', TUE, 'Dan Guest', 'succeeded', 4500, 0, 4500],
    ['2026-09-07', NEXT, 'Ben Guest', 'partially_refunded', 4000, 1500, 2500],
    ['2026-09-11', MON, 'Cat Guest', 'refunded', 3000, 3000, 0],
    ['2026-09-14', MON, 'Ann Guest', 'pending', 1000, 0, 1000],
  ])
  const [ref] = await sql`SELECT reference FROM bookings WHERE id = ${bk.d}`
  assert.equal(rowsOf(list)[0].reference, ref.reference)
})

test('who sees them: Bookings access, and each group its own bookings only', async () => {
  for (const [subject, measure] of [['bookings.bookings', 'made'], ['bookings.deposits', 'deposits'], ['bookings.tables', 'tables'], ['bookings.sections', 'sections']]) {
    const no = await refused(run({ subject, values: measures([measure]) }, null, { levels: { ...LEVELS, bookings: 'none' } }))
    assert.equal(no.status, 403, subject)
  }
  // A guest's customer record needs Customers. Without it a list leaves the
  // column out and says so; grouping or filtering by it is refused.
  const noCustomers = { levels: { ...LEVELS, customers: 'none' } }
  const without = await run({ subject: 'bookings.bookings', kind: 'list', rows: ['reference', 'customer.name'], filters: base(MADE) }, null, noCustomers)
  assert.deepEqual(without.columns.map(c => c.key), ['reference'])
  assert.deepEqual(without.meta.notes, ['Customer is left out: your role can\'t see it'])
  assert.equal(rowsOf(without).length, 9)
  for (const spec of [
    { subject: 'bookings.bookings', rows: ['customer.name'], values: measures(['made']) },
    { subject: 'bookings.bookings', values: measures(['made']), filters: [{ field: 'customer.name', op: 'contains', value: 'Ann' }] },
  ]) assert.equal((await refused(run(spec, null, noCustomers))).status, 403)
  const withThem = await run({ subject: 'bookings.bookings', kind: 'list', rows: ['reference', 'customer.name'], filters: base(MADE), sort: [{ by: 'starts_at', dir: 'asc' }] })
  assert.equal(rowsOf(withThem)[0]['customer.name'], 'Ann Guest')

  const theirs = runner(ids.b)
  const every = await theirs({ subject: 'bookings.bookings', kind: 'list', rows: ['reference', 'guest_name'], filters: [period(MADE)] })
  assert.deepEqual(rowsOf(every), [], 'none of the first group\'s bookings on those days')
  const [own] = await sql`SELECT count(*)::int AS n FROM bookings WHERE tenant_id = ${ids.b}`
  const all = await theirs({ subject: 'bookings.bookings', values: measures(['made']) })
  assert.equal(rowsOf(all)[0].made, own.n, 'only its own')
  const deposits = await theirs({ subject: 'bookings.deposits', kind: 'list', rows: ['date', 'amount'] })
  assert.deepEqual(rowsOf(deposits), [], 'no deposits of the first group')
  const asked = await as(B.owner, ids.b).post('/api/reports/preview', { spec: { subject: 'bookings.bookings', values: measures(['made']), filters: [{ field: 'venue', op: 'in', value: [V] }] } })
  assert.equal(asked.status, 404)
})
