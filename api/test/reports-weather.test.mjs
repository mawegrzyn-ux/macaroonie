// The weather at each venue as a report subject (local.weather, docs/REPORTS.md
// 7.1 and 20), and figures from another subject in plans (phase 3c):
//
//   - one row a venue's day: the forecast read last, from the venue's own
//     weather captures (a venue with two captures has two forecasts a day);
//     days hidden on the Local info page, items with no forecast in them,
//     other kinds and items for the whole group are left out
//   - the figures add up those rows as the Local info page's items say
//   - sales beside the weather (the starter): each subject counted on its
//     own and lined up by day or venue; a day with sales and no forecast
//     shows no weather, a day with weather and no sales shows 0 sales
//   - a role without Local info gets the sales and a note
//   - a plan can name another subject (also) and its figures (from), and a
//     plan naming one wrongly is answered with what is wrong
//
// The data: the fixtures' venue sells two till days moved to Monday 19 and
// Wednesday 21 October 2026; forecasts for both of the fixtures' venues are
// written as the weather capture writes them (services/localInfoSvc.js).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, ok, sql, closeApp } from './support/app.mjs'
import { resetAndSeed, A } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { sellTwoDays } from './support/tillDays.mjs'
import { runner, rowsOf, totalsRow, LEVELS } from './support/reports.mjs'
import { starterByKey } from '../src/reports/starters/index.js'
import { planOf, planProblems } from '../src/reports/plan.js'
import { catalogueView } from '../src/reports/catalogue/index.js'
import { weatherText, weatherSummary, weatherSeverity, weatherGroup, itemKey, WET_DAY_MM } from '../../shared/localInfo.js'

let ids, owner, run
let V0, V2, here, there, day2

const period = (from, to) => ({ field: 'date', op: 'in_period', value: { from, to } })
const WEEK = period('2026-10-19', '2026-10-25')
const GIVEN = { period: { from: '2026-10-19', to: '2026-10-25' } }
const num = v => (v == null ? 0 : Number(v))
const without = (...keys) => Object.fromEntries(Object.entries(LEVELS).filter(([k]) => !keys.includes(k)))
const slug = words => String(words).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')

function near(got, want, what) {
  assert.equal(typeof got, 'number', what + ' is a number (' + JSON.stringify(got) + ')')
  assert.ok(Math.abs(got - want) < 0.005, what + ': ' + got + ', expected ' + want)
}
const avg = list => list.reduce((s, x) => s + x, 0) / list.length

// A forecast as the weather capture writes it: one item per source and day,
// its words and how it shows worked out from the day's figures.
async function forecast(venue, source, day, d, { read, hidden = false } = {}) {
  await sql`
    INSERT INTO local_info_items (tenant_id, venue_id, source_id, kind, title, details, place, starts_on, severity,
                                  data, external_key, hidden, captured_at, updated_at)
    VALUES (${ids.a}, ${venue}, ${source}, 'weather', ${weatherText(d.weather_code)}, ${weatherSummary(d)}, 'Ware',
            ${day}, ${weatherSeverity(d)}, ${sql.json(d)}, ${itemKey('weather', day)}, ${hidden}, ${read}, ${read})`
}
const day = (weather_code, temp_min, temp_max, precip_mm, wind_kph) => ({ weather_code, temp_min, temp_max, precip_mm, wind_kph })

// What the Local info page holds for a venue, as the report should read it:
// its own weather items with a forecast in them, not hidden, the one read
// last each day.
async function pageForecasts(venue) {
  const page = await ok(owner.get(`/api/local-info/items?venue_id=${venue}&from=2026-10-19&to=2026-10-25&include_hidden=1`))
  const out = new Map()
  for (const it of page.items) {
    if (it.kind !== 'weather' || it.venue_id !== venue || it.hidden || typeof it.data?.weather_code !== 'number') continue
    const was = out.get(it.starts_on)
    if (!was || new Date(it.updated_at) > new Date(was.updated_at)) out.set(it.starts_on, it)
  }
  return out
}

before(async () => {
  ids = await resetAndSeed()
  owner = as(A.owner, ids.a)
  const filled = await fillTenant(A.owner, ids.a, { reports: false })
  assert.deepEqual(filled.failed, [])
  const sold = await sellTwoDays({ owner, tenantId: ids.a, filled })
  V0 = filled.ids.venue
  V2 = filled.ids.venue2
  await sql`UPDATE pos_days SET business_date = '2026-10-19'::date WHERE id = ${sold.day1}`
  await sql`UPDATE pos_days SET business_date = '2026-10-21'::date WHERE id = ${sold.day2}`
  day2 = sold.day2
  ;[{ name: here }] = await sql`SELECT name FROM venues WHERE id = ${V0}`
  ;[{ name: there }] = await sql`SELECT name FROM venues WHERE id = ${V2}`

  // Two weather captures at the fixtures' venue (two towns near it), one at the other.
  const source = async (venue, place) => (await ok(owner.post(`/api/local-info/venues/${venue}/sources`, { kind: 'weather', place, enabled: false }))).source.id
  const s1 = await source(V0, 'Ware')
  const s2 = await source(V0, 'Hertford')
  const s3 = await source(V2, 'Hertford')
  const at = hour => '2026-10-19T' + String(hour).padStart(2, '0') + ':00:00Z'

  // Monday: both captures; the second read an hour later is the one that counts.
  await forecast(V0, s1, '2026-10-19', day(61, 3, 9, 2.5, 20), { read: at(6) })
  await forecast(V0, s2, '2026-10-19', day(0, 5, 12, 0, 10), { read: at(7) })
  // Tuesday: overcast with 1.5 mm, a wet day; no sales.
  await forecast(V0, s1, '2026-10-20', day(3, 4, 11, 1.5, 15), { read: at(6) })
  // Wednesday: showers, blowy.
  await forecast(V0, s1, '2026-10-21', day(80, 6, 13, 7, 30), { read: at(6) })
  // Thursday: a thunderstorm someone hid on the Local info page.
  await forecast(V0, s1, '2026-10-22', day(95, 7, 14, 20, 60), { read: at(6), hidden: true })
  // Friday: an item with no forecast in it.
  await sql`
    INSERT INTO local_info_items (tenant_id, venue_id, source_id, kind, title, starts_on, data, external_key)
    VALUES (${ids.a}, ${V0}, ${s1}, 'weather', 'Forecast not read', '2026-10-23', ${sql.json({ note: 'nothing came back' })}, 'weather:2026-10-23')`
  // A weather item for the whole group (no venue), and an event, on the Monday.
  await sql`
    INSERT INTO local_info_items (tenant_id, venue_id, kind, title, starts_on, data)
    VALUES (${ids.a}, NULL, 'weather', 'Heavy snow', '2026-10-19', ${sql.json(day(75, -5, -1, 30, 70))})`
  await ok(owner.post('/api/local-info/items', { venue_id: V0, kind: 'events', title: 'Street fair', starts_on: '2026-10-19' }))
  // The other venue: light snow on the Monday.
  await forecast(V2, s3, '2026-10-19', day(71, -1, 2, 3.2, 40), { read: at(6) })
  run = runner(ids.a)
})
after(closeApp)

test('the weather alone: one row a venue day, the forecast read last, as the Local info page holds it', async () => {
  const res = await run({
    subject: 'local.weather', kind: 'list',
    rows: ['date', 'venue.name', 'conditions', 'kind', 'severity', 'temp_min', 'temp_max', 'rain', 'wind', 'wet'],
    filters: [WEEK], sort: [{ by: 'date', dir: 'asc' }, { by: 'venue.name', dir: 'asc' }],
  })
  const rows = rowsOf(res)
  const want = []
  for (const [venue, name] of [[V0, here], [V2, there]]) {
    for (const [d, it] of await pageForecasts(venue)) {
      const f = it.data
      want.push({
        date: d, 'venue.name': name, conditions: slug(weatherText(f.weather_code)), kind: weatherGroup(f.weather_code),
        severity: it.severity, temp_min: f.temp_min, temp_max: f.temp_max, rain: f.precip_mm, wind: f.wind_kph,
        wet: f.precip_mm >= WET_DAY_MM,
      })
    }
  }
  want.sort((a, b) => a.date.localeCompare(b.date) || a['venue.name'].localeCompare(b['venue.name']))
  assert.deepEqual(rows.map(r => ({ ...r, temp_min: num(r.temp_min), temp_max: num(r.temp_max), rain: num(r.rain), wind: num(r.wind) })), want)

  // As known: Monday's second forecast, no Thursday (hidden) or Friday (no forecast), the snow at the other venue.
  assert.deepEqual(rows.map(r => r.date + ' ' + r['venue.name'] + ' ' + r.conditions), [
    '2026-10-19 ' + [here, there].sort()[0] + ' ' + (here < there ? 'clear' : 'light_snow'),
    '2026-10-19 ' + [here, there].sort()[1] + ' ' + (here < there ? 'light_snow' : 'clear'),
    '2026-10-20 ' + here + ' overcast',
    '2026-10-21 ' + here + ' light_showers',
  ])
  const wed = rows.find(r => r.date === '2026-10-21')
  assert.deepEqual([wed.kind, wed.severity, wed.wet], ['rain', 'notice', true])
  assert.equal(rows.find(r => r.date === '2026-10-20').wet, true, '1.5 mm is a wet day')
  assert.equal(rows.find(r => r.date === '2026-10-19' && r['venue.name'] === here).wet, false)
})

test('the weather\'s figures add up its days', async () => {
  const res = await run({
    subject: 'local.weather', rows: ['venue.name'], filters: [WEEK],
    values: ['days', 'wet_days', 'dry_days', 'warning_days', 'wet_share', 'average_high', 'average_low', 'hottest', 'coldest', 'average_rain', 'wettest', 'windiest']
      .map(k => ({ key: k, measure: k })),
  })
  const rows = Object.fromEntries(rowsOf(res).map(r => [r['venue.name'], r]))
  for (const [venue, name] of [[V0, here], [V2, there]]) {
    const days = [...(await pageForecasts(venue)).values()].map(it => it.data)
    const r = rows[name]
    near(r.days, days.length, name + ': days')
    near(r.wet_days, days.filter(d => d.precip_mm >= WET_DAY_MM).length, name + ': wet days')
    near(r.dry_days, days.filter(d => d.precip_mm < WET_DAY_MM).length, name + ': dry days')
    near(r.warning_days, days.filter(d => weatherSeverity(d) === 'warning').length, name + ': warning days')
    near(r.wet_share, days.filter(d => d.precip_mm >= WET_DAY_MM).length / days.length, name + ': wet share')
    near(r.average_high, avg(days.map(d => d.temp_max)), name + ': average high')
    near(r.average_low, avg(days.map(d => d.temp_min)), name + ': average low')
    near(r.hottest, Math.max(...days.map(d => d.temp_max)), name + ': hottest')
    near(r.coldest, Math.min(...days.map(d => d.temp_min)), name + ': coldest')
    near(r.average_rain, avg(days.map(d => d.precip_mm)), name + ': average rain')
    near(r.wettest, Math.max(...days.map(d => d.precip_mm)), name + ': wettest')
    near(r.windiest, Math.max(...days.map(d => d.wind_kph)), name + ': windiest')
  }
  near(rows[here].days, 3, 'Monday to Wednesday')
  near(rows[here].wet_days, 2, 'Tuesday and Wednesday')
  near(rows[here].average_high, 12, '(12 + 11 + 13) / 3')
  // The total is over every venue day, not the venues' averages added up.
  const tot = totalsRow(res)
  near(tot.days, 4, 'four venue days')
  near(tot.average_high, (12 + 11 + 13 + 2) / 4, 'the average over every venue day')
  near(tot.coldest, -1, 'the snow at the other venue')
})

test('sales beside the weather (the starter): each counted on its own, lined up by day', async () => {
  const spec = starterByKey('till_sales_and_weather').spec
  const res = await run(spec, GIVEN)
  assert.deepEqual(res.columns.map(c => c.key), ['date', 'net_sales', 'checks', 'highest', 'rain'])
  const rows = Object.fromEntries(rowsOf(res).map(r => [r.date, r]))

  // The till on its own, the weather on its own, with the starter's filters.
  const till = Object.fromEntries(rowsOf(await run({
    subject: 'till.checks', rows: ['date'], filters: spec.filters.filter(f => !f.param).concat([WEEK]),
    values: [{ key: 'net_sales', measure: 'net_sales' }, { key: 'checks', measure: 'checks' }],
  })).map(r => [r.date, r]))
  const weather = Object.fromEntries(rowsOf(await run({
    subject: 'local.weather', rows: ['date'], filters: [WEEK],
    values: [{ key: 'highest', measure: 'average_high' }, { key: 'rain', measure: 'average_rain' }],
  })).map(r => [r.date, r]))

  assert.deepEqual(Object.keys(rows).sort(), [...new Set([...Object.keys(till), ...Object.keys(weather)])].sort(), 'a row for every day either has')
  assert.deepEqual(Object.keys(rows).sort(), ['2026-10-19', '2026-10-20', '2026-10-21'])
  for (const [d, r] of Object.entries(rows)) {
    near(r.net_sales, num(till[d]?.net_sales), d + ': net sales')
    near(r.checks, num(till[d]?.checks), d + ': checks')
    if (weather[d]) {
      near(r.highest, weather[d].highest, d + ': highest')
      near(r.rain, weather[d].rain, d + ': rain')
    }
  }
  // Monday: both venues' weather, averaged: (12 + 2) / 2 and (0 + 3.2) / 2.
  near(rows['2026-10-19'].highest, 7, 'Monday\'s highest over both venues')
  near(rows['2026-10-19'].rain, 1.6, 'Monday\'s rain over both venues')
  // Tuesday: weather, no sales.
  near(rows['2026-10-20'].net_sales, 0, 'nothing sold on the Tuesday')
  near(rows['2026-10-20'].highest, 11, 'Tuesday\'s weather')
  assert.ok(rows['2026-10-21'].net_sales > 0, 'Wednesday\'s sales')

  // Totals: each subject's own.
  const tot = totalsRow(res)
  near(tot.net_sales, Object.values(till).reduce((s, r) => s + num(r.net_sales), 0), 'the sales over the week')
  near(tot.highest, (12 + 2 + 11 + 13) / 4, 'the average highest over every venue day')
})

test('by venue: a venue with weather and no sales, and a day with sales and no forecast', async () => {
  const spec = { ...starterByKey('till_sales_and_weather').spec, rows: ['venue.name'], sort: [], view: { kind: 'table' } }
  const res = await run(spec, GIVEN)
  const rows = Object.fromEntries(rowsOf(res).map(r => [r['venue.name'], r]))
  assert.deepEqual(Object.keys(rows).sort(), [here, there].sort())
  near(rows[there].net_sales, 0, 'nothing sold at the other venue')
  near(rows[there].highest, 2, 'its Monday')
  near(rows[here].highest, 12, 'the fixtures\' venue: Monday to Wednesday')

  // A sales day with no forecast: the weather is empty, not 0.
  await sql`UPDATE pos_days SET business_date = '2026-10-24'::date WHERE id = ${day2}`
  try {
    const byDay = Object.fromEntries(rowsOf(await run(starterByKey('till_sales_and_weather').spec, GIVEN)).map(r => [r.date, r]))
    assert.ok(byDay['2026-10-24'].net_sales > 0, 'Saturday\'s sales')
    assert.equal(byDay['2026-10-24'].highest, null, 'no forecast that day')
    assert.equal(byDay['2026-10-24'].rain, null)
    near(byDay['2026-10-21'].net_sales, 0, 'Wednesday has its weather and no sales now')
    near(byDay['2026-10-21'].highest, 13, 'Wednesday\'s weather')
  } finally {
    await sql`UPDATE pos_days SET business_date = '2026-10-21'::date WHERE id = ${day2}`
  }
})

test('a role without Local info gets the sales and a note', async () => {
  const res = await run(starterByKey('till_sales_and_weather').spec, GIVEN, { levels: without('local_info') })
  assert.deepEqual(res.columns.map(c => c.key), ['date', 'net_sales', 'checks'])
  assert.ok((res.meta.notes || []).some(n => /weather/i.test(n) && /role/i.test(n)), 'a note says why: ' + JSON.stringify(res.meta.notes))
  assert.deepEqual(rowsOf(res).map(r => r.date).sort(), ['2026-10-19', '2026-10-21'], 'only the till\'s days')
})

test('a plan names another subject and its figures', async () => {
  const plan = {
    subject: 'till.checks',
    by: [{ field: 'date' }],
    also: [{ subject: 'local.weather', name: 'wx' }],
    figures: [
      { figure: 'net_sales' },
      { figure: 'average_high', from: 'wx', label: 'Highest' },
      { figure: 'wet_days', from: 'local.weather' },
      { calc: 'v1 / v3', label: 'Sales per wet day', format: 'money' },
    ],
    filters: [{ field: 'status', op: 'is', values: ['closed'] }],
    period: { from: '2026-10-19', to: '2026-10-25' },
    sort: [{ by: 'date', dir: 'asc' }],
    name: 'Sales and the weather',
  }
  const out = await ok(owner.post('/api/reports/plan', { plan }))
  assert.equal(out.problem, null, out.problem)
  assert.deepEqual(out.spec.also.map(a => [a.key, a.subject]), [['wx', 'local.weather']], 'a subject named by its key joins the one already there')
  assert.deepEqual(out.spec.values.filter(v => !v.calc).map(v => [v.measure, v.from || null]), [['net_sales', null], ['average_high', 'wx'], ['wet_days', 'wx']])
  const rows = Object.fromEntries(rowsOf(out.result).map(r => [r.date, r]))
  assert.deepEqual(Object.keys(rows).sort(), ['2026-10-19', '2026-10-20', '2026-10-21'])
  const high = out.spec.values.find(v => v.measure === 'average_high').key
  near(rows['2026-10-20'][high], 11, 'Tuesday\'s weather')

  // Said back: the plan of the report built has its other subject and the figures' from.
  const { plan: back, kept } = planOf(catalogueView(LEVELS), out.spec, [], out.name)
  assert.deepEqual(kept, [], 'nothing it can\'t say')
  assert.deepEqual(back.also.map(a => [a.subject, a.name]), [['local.weather', 'wx']])
  assert.deepEqual(back.figures.filter(f => !f.calc).map(f => [f.figure, f.from || null]), [['net_sales', null], ['average_high', 'wx'], ['wet_days', 'wx']])
})

test('a plan that names another subject wrongly is told what is wrong', async () => {
  const base = { subject: 'till.checks', by: [{ field: 'date' }], period: { from: '2026-10-19', to: '2026-10-25' } }
  // A subject that isn't one.
  let out = await ok(owner.post('/api/reports/plan', { plan: { ...base, also: [{ subject: 'local.wether' }], figures: [{ figure: 'net_sales' }] } }))
  assert.match(out.problem, /"local\.wether" isn't a subject/)
  assert.ok(out.unknown.subjects.some(x => x.subject === 'local.weather'), 'the near one: ' + JSON.stringify(out.unknown))
  // A from naming nothing.
  out = await ok(owner.post('/api/reports/plan', { plan: { ...base, also: [{ subject: 'local.weather', name: 'wx' }], figures: [{ figure: 'net_sales' }, { figure: 'average_high', from: 'sky' }] } }))
  assert.match(out.problem, /from names "sky"/)
  assert.deepEqual(out.unknown.froms, ['sky'])
  // Another subject's figure that it doesn't have.
  out = await ok(owner.post('/api/reports/plan', { plan: { ...base, also: [{ subject: 'local.weather', name: 'wx' }], figures: [{ figure: 'net_sales' }, { figure: 'sunshine', from: 'wx' }] } }))
  assert.match(out.problem, /Nothing called "sunshine" in Weather/)
  assert.deepEqual(out.unknown.paths.map(p => [p.path, p.subject]), [['sunshine', 'local.weather']])
  // Another subject a role can't see is one it can't build with.
  const why = planProblems(catalogueView(without('local_info')), { ...base, also: [{ subject: 'local.weather' }], figures: [{ figure: 'net_sales' }, { figure: 'average_high', from: 'local.weather' }] })
  assert.match(why.problem, /^"local\.weather" isn't a subject this role can build reports on \(it is one of the plan's other subjects\)/)
  assert.equal(why.unknown.subject, 'local.weather')
})
