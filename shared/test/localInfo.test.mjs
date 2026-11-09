import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  everyHours, frequencyText, nextRunAt, zonedInstant, itemKey,
  weatherText, weatherSummary, weatherSeverity, itemOnDay, sortDayItems,
  monthGrid, addDays,
} from '../localInfo.js'

const iso = d => d.toISOString().slice(0, 16) + 'Z'

test('how often a source runs, in words and clamped hours', () => {
  assert.equal(everyHours({ every_hours: 4 }), 4)
  assert.equal(everyHours({ every_hours: 0 }), 4)
  assert.equal(everyHours({}), 4)
  assert.equal(everyHours({ every_hours: 99 }), 24)
  assert.equal(everyHours({ every_hours: 0.6 }), 1)
  assert.equal(frequencyText({ frequency: 'hours', every_hours: 6 }), 'Every 6 hours')
  assert.equal(frequencyText({ frequency: 'weekly' }), 'Once a week (Monday morning)')
  assert.equal(frequencyText({ frequency: 'daily' }), 'Once a day (early morning)')
})

test('nextRunAt: every N hours is from now, daily and weekly are the venue morning', () => {
  const tz = 'Europe/London'
  // Every 4 hours: exactly now + 4 hours.
  assert.equal(iso(nextRunAt({ frequency: 'hours', every_hours: 4 }, new Date('2026-11-09T10:12:00Z'), tz)), '2026-11-09T14:12Z')
  // Daily, before 05:30 local: this morning. London is on GMT in November.
  assert.equal(iso(nextRunAt({ frequency: 'daily' }, new Date('2026-11-09T04:00:00Z'), tz)), '2026-11-09T05:30Z')
  // Daily, at 05:30 exactly: tomorrow (a run at 05:30 must not re-run itself).
  assert.equal(iso(nextRunAt({ frequency: 'daily' }, new Date('2026-11-09T05:30:00Z'), tz)), '2026-11-10T05:30Z')
  // Weekly from a Wednesday: next Monday morning.
  assert.equal(iso(nextRunAt({ frequency: 'weekly' }, new Date('2026-11-11T10:00:00Z'), tz)), '2026-11-16T05:30Z')
  // Weekly early on a Monday: that same morning; after it, the Monday after.
  assert.equal(iso(nextRunAt({ frequency: 'weekly' }, new Date('2026-11-09T04:00:00Z'), tz)), '2026-11-09T05:30Z')
  assert.equal(iso(nextRunAt({ frequency: 'weekly' }, new Date('2026-11-09T06:00:00Z'), tz)), '2026-11-16T05:30Z')
  // Across the clock change (BST starts 29 Mar 2026): 05:30 local is 04:30Z.
  assert.equal(iso(nextRunAt({ frequency: 'daily' }, new Date('2026-03-28T06:00:00Z'), tz)), '2026-03-29T04:30Z')
  // Another time zone: 05:30 in New York is 10:30Z in November.
  assert.equal(iso(nextRunAt({ frequency: 'daily' }, new Date('2026-11-09T02:00:00Z'), 'America/New_York')), '2026-11-09T10:30Z')
  assert.equal(iso(zonedInstant('2026-07-01', '05:30', tz)), '2026-07-01T04:30Z')
})

test('itemKey: the kind, the day and the title words, never the wording around them', () => {
  assert.equal(itemKey('events', '2026-11-14', 'Christmas Lights switch-on!'), 'events:2026-11-14:christmas lights switch on')
  // The same story written differently lands on the same row.
  assert.equal(
    itemKey('traffic', '2026-11-14', "A10 closed at Ware — roadworks"),
    itemKey('traffic', '2026-11-14T00:00:00.000Z', 'a10 closed at ware,  roadworks'),
  )
  // A weather day has no title: kind + day alone.
  assert.equal(itemKey('weather', '2026-11-14', ''), 'weather:2026-11-14')
  // Long titles are cut so the key stays indexable.
  assert.ok(itemKey('events', '2026-11-14', 'word '.repeat(60)).length <= 140)
  // Different days are different keys.
  assert.notEqual(itemKey('events', '2026-11-14', 'Market'), itemKey('events', '2026-11-15', 'Market'))
})

test('weather words, the one-line summary and how loud a day shows', () => {
  assert.equal(weatherText(63), 'Rain')
  assert.equal(weatherText(999), 'Weather')
  assert.equal(weatherSummary({ weather_code: 63, temp_min: 3.4, temp_max: 9.2, precip_mm: 11.6 }), 'Rain, 3 to 9°C, 12 mm')
  assert.equal(weatherSummary({ weather_code: 0, temp_max: 21, precip_mm: 0.2 }), 'Clear, up to 21°C')
  assert.equal(weatherSummary({ weather_code: 1, temp_min: 2, temp_max: 8, wind_kph: 52 }), 'Mostly clear, 2 to 8°C, wind 52 km/h')
  // Heavy rain, a gale or a downpour is a warning; fog or ordinary rain a notice; clear is info.
  assert.equal(weatherSeverity({ weather_code: 65 }), 'warning')
  assert.equal(weatherSeverity({ weather_code: 95 }), 'warning')
  assert.equal(weatherSeverity({ weather_code: 1, wind_kph: 60 }), 'warning')
  assert.equal(weatherSeverity({ weather_code: 61, precip_mm: 20 }), 'warning')
  assert.equal(weatherSeverity({ weather_code: 45 }), 'notice')
  assert.equal(weatherSeverity({ weather_code: 61, precip_mm: 2 }), 'notice')
  assert.equal(weatherSeverity({ weather_code: 2, wind_kph: 45 }), 'notice')
  assert.equal(weatherSeverity({ weather_code: 2, wind_kph: 30, precip_mm: 0 }), 'info')
  assert.equal(weatherSeverity({}), 'info')
})

test('which days an item is on, and a day’s reading order', () => {
  const oneDay = { starts_on: '2026-11-14' }
  assert.ok(itemOnDay(oneDay, '2026-11-14'))
  assert.ok(!itemOnDay(oneDay, '2026-11-13'))
  assert.ok(!itemOnDay(oneDay, '2026-11-15'))
  const fair = { starts_on: '2026-11-13', ends_on: '2026-11-15' }
  assert.ok(itemOnDay(fair, '2026-11-13'))
  assert.ok(itemOnDay(fair, '2026-11-14'))
  assert.ok(itemOnDay(fair, '2026-11-15'))
  assert.ok(!itemOnDay(fair, '2026-11-16'))
  // Dates straight from Postgres (a Date serialised long) still match.
  assert.ok(itemOnDay({ starts_on: '2026-11-14T00:00:00.000Z' }, '2026-11-14'))

  const items = [
    { kind: 'events', severity: 'info', title: 'B market' },
    { kind: 'events', severity: 'warning', title: 'Road race' },
    { kind: 'weather', severity: 'notice', title: 'Rain' },
    { kind: 'traffic', severity: 'info', title: 'A10 works' },
    { kind: 'incidents', severity: 'info', title: 'Power cut' },
    { kind: 'events', severity: 'info', title: 'A fair' },
  ]
  assert.deepEqual(sortDayItems(items).map(i => i.title),
    ['Rain', 'Power cut', 'A10 works', 'Road race', 'A fair', 'B market'])
})

test('monthGrid: whole weeks, Monday first', () => {
  // November 2026 starts on a Sunday and ends on a Monday.
  const nov = monthGrid('2026-11')
  assert.equal(nov[0].date, '2026-10-26')
  assert.equal(nov.at(-1).date, '2026-12-06')
  assert.equal(nov.length, 42)
  assert.equal(nov.filter(d => d.inMonth).length, 30)
  assert.equal(nov.find(d => d.inMonth).date, '2026-11-01')
  // June 2026 starts on a Monday: no padding at the front.
  const jun = monthGrid('2026-06')
  assert.equal(jun[0].date, '2026-06-01')
  assert.equal(jun.at(-1).date, '2026-07-05')
  assert.equal(jun.length % 7, 0)
  assert.equal(addDays('2026-11-30', 1), '2026-12-01')
})
