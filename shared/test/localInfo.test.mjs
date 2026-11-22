import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  everyHours, frequencyText, nextRunAt, zonedInstant, itemKey,
  weatherText, weatherSummary, weatherSeverity, itemOnDay, sortDayItems,
  monthGrid, addDays, weekAhead, isWeatherDay, weatherCodes, WEATHER_GROUPS, weatherGroup,
  mergeWeatherDay, hourText, WEATHER_PAST_DAYS,
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

test('every weather code is in exactly one kind of weather', () => {
  const codes = weatherCodes().map(([code]) => code)
  assert.ok(codes.length > 20)
  for (const code of codes) {
    const groups = WEATHER_GROUPS.filter(g => g.codes.includes(code))
    assert.equal(groups.length, 1, 'code ' + code + ' is in ' + groups.length + ' kinds of weather')
  }
  // No group names a code the words don't know.
  for (const g of WEATHER_GROUPS) for (const code of g.codes) assert.ok(codes.includes(code), g.key + ' names ' + code)
  assert.equal(weatherGroup(63), 'rain')
  assert.equal(weatherGroup('81'), 'rain')
  assert.equal(weatherGroup(1), 'clear')
  assert.equal(weatherGroup(96), 'thunder')
  assert.equal(weatherGroup(999), null)
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

test('weekAhead: a forecast per day and the headlines in order', () => {
  const w = (day, code, extra = {}) => ({
    id: 'w' + day, kind: 'weather', source_id: 's1', venue_id: 'v1', title: weatherText(code),
    details: 'details ' + day, starts_on: day, severity: 'info',
    data: { weather_code: code, temp_min: 3.4, temp_max: 9.6, precip_mm: 0, wind_kph: 10 }, ...extra,
  })
  const items = [
    w('2026-11-13', 0),                                   // the day before: not this week
    w('2026-11-14', 61),
    w('2026-11-14', 65, { id: 'w2', severity: 'warning', title: 'Heavy rain' }),  // two captures: the loudest
    w('2026-11-16', 3),
    w('2026-11-21', 0),                                   // after the week
    { id: 'e1', kind: 'events', title: 'Christmas market', starts_on: '2026-11-17', ends_on: '2026-11-17', severity: 'info', venue_id: null, source_id: null },
    { id: 'e2', kind: 'traffic', title: 'Roadworks High St', starts_on: '2026-11-10', ends_on: '2026-11-28', severity: 'notice', venue_id: 'v1', source_id: 's2', url: 'javascript:alert(1)' },
    { id: 'e3', kind: 'incidents', title: 'Water off', starts_on: '2026-11-14', severity: 'warning', venue_id: 'v1', source_id: 's3', url: 'https://news.test/a', time_text: '09:00', place: 'Ware' },
    { id: 'e4', kind: 'events', title: 'Next week fair', starts_on: '2026-11-21', severity: 'warning', venue_id: 'v1', source_id: null },
    { id: 'e5', kind: 'weather', title: 'Heat warning', starts_on: '2026-11-15', severity: 'warning', venue_id: null, source_id: null },
    { id: 'e6', kind: 'events', title: 'A gig', starts_on: '2026-11-15', severity: 'info', venue_id: 'v1', source_id: 's2' },
    { id: 'e7', kind: 'events', title: 'B gig', starts_on: '2026-11-15', severity: 'info', venue_id: 'v1', source_id: 's2' },
  ]
  assert.ok(isWeatherDay(items[0]))
  assert.ok(!isWeatherDay(items[9]), 'a weather item typed in is a headline')
  const out = weekAhead(items, '2026-11-14')
  assert.equal(out.from, '2026-11-14')
  assert.equal(out.to, '2026-11-20')
  assert.deepEqual(out.weather.map(x => [x.date, x.title, x.severity]),
    [['2026-11-14', 'Heavy rain', 'warning'], ['2026-11-16', 'Overcast', 'info']])
  assert.equal(out.weather[0].code, 65)
  assert.equal(out.weather[0].temp_max, 9.6)
  assert.equal(out.weather[0].details, 'details 2026-11-14')
  // By the day it first shows (roadworks from before: shown from today),
  // then the loudest, kind and title; five at most.
  assert.deepEqual(out.headlines.map(x => [x.day, x.title]), [
    ['2026-11-14', 'Water off'], ['2026-11-14', 'Roadworks High St'],
    ['2026-11-15', 'Heat warning'], ['2026-11-15', 'A gig'], ['2026-11-15', 'B gig'],
  ])
  assert.equal(out.more, 1, 'the market is left over')
  const road = out.headlines[1]
  assert.equal(road.url, null, 'a javascript: link never goes out')
  assert.equal(road.starts_on, '2026-11-10')
  assert.equal(road.ends_on, '2026-11-28')
  const water = out.headlines[0]
  assert.equal(water.url, 'https://news.test/a')
  assert.equal(water.ends_on, null, 'one day: no end')
  assert.equal(water.time_text, '09:00')
  assert.equal(water.place, 'Ware')
  assert.equal(water.typed, false)
  assert.equal(out.headlines[2].venue_wide, true)
  assert.equal(out.headlines[2].typed, true)
  // A bigger limit shows them all; nothing outside the week.
  const all = weekAhead(items, '2026-11-14', { headlines: 20 })
  assert.equal(all.more, 0)
  assert.deepEqual(all.headlines.map(x => x.id), ['e3', 'e2', 'e5', 'e6', 'e7', 'e1'])
  // Fewer days: only those.
  const two = weekAhead(items, '2026-11-14', { days: 2 })
  assert.equal(two.to, '2026-11-15')
  assert.deepEqual(two.weather.map(x => x.date), ['2026-11-14'])
  assert.deepEqual(two.headlines.map(x => x.id), ['e3', 'e2', 'e5', 'e6', 'e7'])
  assert.deepEqual(weekAhead([], '2026-11-14'), { from: '2026-11-14', to: '2026-11-20', weather: [], headlines: [], more: 0 })
})

test('a flag\'s note is one tidy line', async () => {
  const { cleanFlagNote, FLAG_NOTE_MAX } = await import('../localInfo.js')
  assert.equal(FLAG_NOTE_MAX, 200)
  assert.equal(cleanFlagNote('  Too far away:\n nobody\twalks   from Hertford '), 'Too far away: nobody walks from Hertford')
  assert.equal(cleanFlagNote('line one\r\nline two\u0000\u007f end'), 'line one line two end')
  assert.equal(cleanFlagNote('   '), '')
  for (const v of [null, undefined, 7, {}, ['a']]) assert.equal(cleanFlagNote(v), '', String(v))
})

test('hourly and recorded weather: a day read before, on and after it', () => {
  const hour = (h, code, temp, precip, prob) => ({ h, weather_code: code, temp, precip_mm: precip, precip_prob: prob, wind_kph: 10 })
  const day = (code, min, max, mm) => ({ weather_code: code, temp_min: min, temp_max: max, precip_mm: mm, wind_kph: 20 })
  assert.equal(hourText(7), '07:00')
  assert.equal(WEATHER_PAST_DAYS, 7)

  // Read the day before: all forecast, nothing recorded.
  const d1 = mergeWeatherDay(null, { date: '2026-11-22', today: '2026-11-21', nowHour: 20,
    day: day(61, 3, 9, 4), hours: [hour(0, 3, 4, 0, 10), hour(12, 61, 8, 1.2, 70), hour(13, 61, 9, 0.8, 60)], readAt: 'r1' })
  assert.equal(d1.recorded, false)
  assert.equal(d1.forecast, null, 'not recorded yet: the day itself is the forecast')
  assert.deepEqual(d1.hours.map(x => [x.h, x.recorded, x.precip_prob]), [[0, false, 10], [12, false, 70], [13, false, 60]])
  assert.equal(d1.weather_code, 61)
  assert.equal(d1.read_at, 'r1')

  // Read on the day at 13:00: hours before 13 recorded, each with its forecast kept.
  const d2 = mergeWeatherDay(d1, { date: '2026-11-22', today: '2026-11-22', nowHour: 13,
    day: day(63, 3, 10, 6), hours: [hour(0, 2, 5, 0, 5), hour(12, 63, 9, 3, 90), hour(13, 63, 9, 2, 80)], readAt: 'r2' })
  assert.equal(d2.recorded, false, 'the day is not over')
  const [h0, h12, h13] = d2.hours
  assert.deepEqual([h0.recorded, h0.weather_code, h0.precip_prob], [true, 2, null], 'a past hour: recorded, no chance of rain')
  assert.deepEqual(h0.forecast, { weather_code: 3, temp: 4, precip_mm: 0, precip_prob: 10, wind_kph: 10 }, 'what was forecast for it')
  assert.deepEqual([h12.recorded, h12.precip_mm, h12.forecast.precip_mm], [true, 3, 1.2])
  assert.deepEqual([h13.recorded, h13.precip_prob, h13.forecast], [false, 80, null], 'the hour now is still a forecast')

  // Read the day after: the day recorded, its forecast the last one read before it was over.
  const d3 = mergeWeatherDay(d2, { date: '2026-11-22', today: '2026-11-23', nowHour: 6,
    day: day(65, 2, 11, 22), hours: [hour(0, 2, 5, 0, 5), hour(12, 63, 9, 3.4, 90), hour(13, 65, 8, 9, 99)], readAt: 'r3' })
  assert.equal(d3.recorded, true)
  assert.deepEqual(d3.forecast, { weather_code: 63, temp_min: 3, temp_max: 10, precip_mm: 6, wind_kph: 20 })
  assert.deepEqual([d3.weather_code, d3.precip_mm], [65, 22], 'the day is what was recorded')
  assert.ok(d3.hours.every(x => x.recorded && x.precip_prob === null))
  assert.equal(d3.hours[0].forecast.weather_code, 3, 'an hour recorded earlier keeps the forecast it had')
  assert.equal(d3.hours[2].forecast.precip_prob, 80, 'the hour that was still ahead keeps its last forecast')

  // Read again later: nothing forecast is lost.
  const d4 = mergeWeatherDay(d3, { date: '2026-11-22', today: '2026-11-24', day: day(65, 2, 11, 21), hours: [hour(13, 65, 8, 9, 0)] })
  assert.deepEqual(d4.forecast, d3.forecast)
  assert.equal(d4.hours.find(x => x.h === 13).forecast.precip_prob, 80)

  // A day first read after it was over: recorded, no forecast.
  const late = mergeWeatherDay(null, { date: '2026-11-15', today: '2026-11-22', day: day(0, 1, 8, 0), hours: [hour(9, 0, 4, 0, 0)] })
  assert.deepEqual([late.recorded, late.forecast, late.hours[0].forecast], [true, null, null])
  // No hours read: the hours held are kept; an hour outside 0..23 is left out.
  assert.equal(mergeWeatherDay(d2, { date: '2026-11-22', today: '2026-11-22', nowHour: 14, day: day(63, 3, 10, 6) }).hours.length, 3)
  assert.equal(mergeWeatherDay(null, { date: '2026-11-22', today: '2026-11-22', hours: [hour(24, 0, 1, 0, 0), hour('x', 0, 1, 0, 0)] }).hours.length, 0)
})

test('weekAhead carries a weather day\'s hours and whether it is recorded', () => {
  const it = { id: 'w', kind: 'weather', source_id: 's', venue_id: 'v', title: 'Rain', starts_on: '2026-11-22', severity: 'info',
    data: { weather_code: 63, temp_min: 3, temp_max: 9, precip_mm: 6, wind_kph: 10, recorded: false, hours: [{ h: 9, weather_code: 63, temp: 5, recorded: false }] } }
  const out = weekAhead([it], '2026-11-22')
  assert.equal(out.weather[0].recorded, false)
  assert.equal(out.weather[0].hours.length, 1)
})
