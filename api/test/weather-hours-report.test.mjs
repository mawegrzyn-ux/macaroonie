// Weather by the hour in the report builder (local.weather_hours): one row
// an hour of the weather day local.weather keeps (the row read last), with
// recorded hours' forecasts beside them, and the starter's hour columns.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, sql, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A } from './support/seed.mjs'

let ids, owner, V
const day = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10)

before(async () => {
  ids = await resetAndSeed()
  owner = as(A.owner, ids.a)
  V = (await ok(owner.post('/api/venues', { name: 'Hours venue', slug: 'hours-venue', timezone: 'Europe/London' }))).id
  const hours = [
    { h: 12, weather_code: 61, temp: 11.5, precip_mm: 1.2, precip_prob: null, wind_kph: 20, recorded: true, forecast: { weather_code: 3, temp: 13, precip_mm: 0, precip_prob: 10, wind_kph: 10 } },
    { h: 13, weather_code: 3, temp: 12.5, precip_mm: 0, precip_prob: null, wind_kph: 15, recorded: true, forecast: null },
    { h: 14, weather_code: 1, temp: 14, precip_mm: 0, precip_prob: 20, wind_kph: 8, recorded: false, forecast: null },
  ]
  const data = d => sql.json({ weather_code: 61, temp_min: 8, temp_max: 14, precip_mm: 1.2, wind_kph: 20, recorded: false, hours: d })
  // An older read of the same day with other hours: the newer one counts.
  await sql`INSERT INTO local_info_items (tenant_id, venue_id, kind, title, starts_on, data, updated_at)
            VALUES (${ids.a}, ${V}, 'weather', 'Old read', ${day(1)}, ${data([{ h: 9, weather_code: 0, temp: 5 }])}, now() - interval '1 day')`
  await sql`INSERT INTO local_info_items (tenant_id, venue_id, kind, title, starts_on, data)
            VALUES (${ids.a}, ${V}, 'weather', 'Rain', ${day(1)}, ${data(hours)})`
  // A day with no hours (read before hours were kept) adds none.
  await sql`INSERT INTO local_info_items (tenant_id, venue_id, kind, title, starts_on, data)
            VALUES (${ids.a}, ${V}, 'weather', 'Dry', ${day(2)}, ${sql.json({ weather_code: 0, temp_min: 5, temp_max: 9 })})`
})
after(closeApp)

test('one row an hour, from the day read last; recorded hours keep their forecast', async () => {
  const period = { from: day(3), to: day(0) }
  const list = await ok(owner.post('/api/reports/preview', {
    spec: { version: 1, subject: 'local.weather_hours', kind: 'list', rows: ['date', 'hour', 'conditions', 'temp', 'rain', 'chance_of_rain', 'recorded', 'forecast_temp'], sort: [{ by: 'hour', dir: 'asc' }],
      filters: [{ field: 'date', op: 'in_period', value: period }] },
  }))
  const rows = JSON.stringify(list.rows)
  assert.equal(list.rows.length, 3, 'the day read last, three hours; the day with none adds none: ' + rows)
  const cells = list.rows.map(r => r.cells)
  assert.deepEqual(cells.map(c => c[1]), ['12', '13', '14'], 'the older read\'s 09 is left out')
  assert.deepEqual(cells[0], [day(1), '12', 'light_rain', 11.5, 1.2, null, true, 13], 'recorded, with its forecast kept')
  assert.deepEqual(cells[2].slice(1, 8), ['14', 'mostly_clear', 14, 0, 0.2, false, null], 'a forecast hour with its chance of rain')
  const summary = await ok(owner.post('/api/reports/starter:local_weather_by_hour/run', { params: { period } }))
  const text = JSON.stringify(summary)
  assert.match(text, /13:00/, 'the hours as columns')
  assert.equal(summary.kind, 'matrix')
})
