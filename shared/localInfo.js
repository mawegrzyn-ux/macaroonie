// shared/localInfo.js — local information around each venue (8 Nov 2026).
//
// One set of rules for the API, the admin page, the dashboard widget and
// Pepper: the kinds (weather, traffic, events, incidents), how often a
// capture runs and when it runs next (nextRunAt, in the venue's time zone),
// the dedupe key a captured item keeps (itemKey, so re-running a capture
// updates rather than repeats), what a captured weather day says
// (weatherText / weatherSummary / weatherSeverity from Open-Meteo's WMO
// codes), which items sit on a day (itemOnDay), their order on a day
// (sortDayItems), the calendar's month of whole weeks (monthGrid) and the
// Today page's week ahead (weekAhead). Which links may be opened is
// webLink() in shared/links.js.

import { webLink } from './links.js'

export const KINDS = ['weather', 'traffic', 'events', 'incidents']
export const KIND_LABELS = { weather: 'Weather', traffic: 'Traffic', events: 'Events', incidents: 'Incidents' }
export const SEVERITIES = ['info', 'notice', 'warning']
export const FREQUENCIES = ['daily', 'hours', 'weekly']

// Scheduled captures run early morning, before the day's trade.
export const RUN_TIME = '05:30'

export function frequencyText(source = {}) {
  if (source.frequency === 'hours') return 'Every ' + everyHours(source) + ' hours'
  if (source.frequency === 'weekly') return 'Once a week (Monday morning)'
  return 'Once a day (early morning)'
}

export function everyHours(source = {}) {
  const n = Math.round(Number(source.every_hours) || 0)
  return Math.min(24, Math.max(1, n || 4))
}

function tzOffsetMs(date, tz) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date)
  const m = Object.fromEntries(parts.map(p => [p.type, p.value]))
  const asUtc = Date.UTC(+m.year, +m.month - 1, +m.day, +m.hour, +m.minute, +m.second)
  return asUtc - Math.floor(date.getTime() / 1000) * 1000
}

/** The instant a venue-local date and time happen ('2026-11-09', '05:30', tz). */
export function zonedInstant(dateStr, hhmm, tz) {
  const [y, mo, d] = String(dateStr).split('-').map(Number)
  const [h, mi] = String(hhmm).split(':').map(Number)
  const guess = Date.UTC(y, mo - 1, d, h, mi)
  const off = tzOffsetMs(new Date(guess), tz)
  let t = guess - off
  const off2 = tzOffsetMs(new Date(t), tz)
  if (off2 !== off) t = guess - off2
  return new Date(t)
}

/** The venue-local date, time and weekday (1 = Monday) at an instant. */
export function localDateTime(at, tz) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  }).formatToParts(at)
  const m = Object.fromEntries(parts.map(p => [p.type, p.value]))
  const date = m.year + '-' + m.month + '-' + m.day
  return { date, time: m.hour + ':' + m.minute, weekday: isoWeekday(date) }
}

function isoWeekday(dateStr) {
  return ((new Date(dateStr + 'T12:00:00Z').getUTCDay() + 6) % 7) + 1
}

export function addDays(dateStr, n) {
  const [y, m, d] = String(dateStr).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

/**
 * When a source runs next, from `now`: every N hours = now + N hours;
 * daily = the next early morning (RUN_TIME at the venue) strictly after now;
 * weekly = the next Monday morning strictly after now.
 */
export function nextRunAt(source, now = new Date(), tz = 'Europe/London') {
  if (source?.frequency === 'hours') return new Date(now.getTime() + everyHours(source) * 3600000)
  const local = localDateTime(now, tz)
  const after = local.time >= RUN_TIME
  let day = local.date
  if (source?.frequency === 'weekly') {
    let ahead = (8 - local.weekday) % 7
    if (ahead === 0 && after) ahead = 7
    day = addDays(day, ahead)
  } else if (after) {
    day = addDays(day, 1)
  }
  return zonedInstant(day, RUN_TIME, tz)
}

function slugWords(s) {
  return String(s || '').toLowerCase().replace(/['’]/g, '')
    .split(/[^a-z0-9]+/).filter(Boolean).join(' ')
}

/**
 * The dedupe key a captured item keeps (local_info_items.external_key): the
 * kind, the day and the title's words — never the wording of a date or the
 * capture time, so the same thing read again lands on its row.
 */
export function itemKey(kind, day, title) {
  return [kind, String(day || '').slice(0, 10), slugWords(title).slice(0, 120)].filter(Boolean).join(':')
}

// Open-Meteo's WMO weather codes, in plain words.
const WEATHER_WORDS = new Map([
  [0, 'Clear'], [1, 'Mostly clear'], [2, 'Partly cloudy'], [3, 'Overcast'],
  [45, 'Fog'], [48, 'Freezing fog'],
  [51, 'Light drizzle'], [53, 'Drizzle'], [55, 'Heavy drizzle'],
  [56, 'Freezing drizzle'], [57, 'Freezing drizzle'],
  [61, 'Light rain'], [63, 'Rain'], [65, 'Heavy rain'],
  [66, 'Freezing rain'], [67, 'Freezing rain'],
  [71, 'Light snow'], [73, 'Snow'], [75, 'Heavy snow'], [77, 'Snow grains'],
  [80, 'Light showers'], [81, 'Showers'], [82, 'Heavy showers'],
  [85, 'Snow showers'], [86, 'Heavy snow showers'],
  [95, 'Thunderstorm'], [96, 'Thunderstorm with hail'], [99, 'Thunderstorm with hail'],
])

export function weatherText(code) {
  return WEATHER_WORDS.get(Number(code)) || 'Weather'
}

/** Every weather code with its words, in code order (the report builder's choices). */
export const weatherCodes = () => [...WEATHER_WORDS.entries()]

// The kinds of weather a day can be put under, for reports that compare
// days by their weather. Every code above is in exactly one.
export const WEATHER_GROUPS = [
  { key: 'clear', label: 'Clear or bright', codes: [0, 1] },
  { key: 'cloudy', label: 'Cloudy', codes: [2, 3] },
  { key: 'fog', label: 'Fog', codes: [45, 48] },
  { key: 'drizzle', label: 'Drizzle', codes: [51, 53, 55, 56, 57] },
  { key: 'rain', label: 'Rain or showers', codes: [61, 63, 65, 66, 67, 80, 81, 82] },
  { key: 'snow', label: 'Snow', codes: [71, 73, 75, 77, 85, 86] },
  { key: 'thunder', label: 'Thunderstorm', codes: [95, 96, 99] },
]

/** The kind of weather a code is ('rain'), or null for a code we don't know. */
export function weatherGroup(code) {
  const n = Number(code)
  return WEATHER_GROUPS.find(g => g.codes.includes(n))?.key ?? null
}

// A wet day: 1 mm of rain or snow or more, the line weatherSummary() starts
// saying how much from.
export const WET_DAY_MM = 1

/** One line for a captured weather day: "Rain, 3 to 9°C, 12 mm". */
export function weatherSummary(d = {}) {
  const parts = [weatherText(d.weather_code)]
  if (d.temp_min != null && d.temp_max != null) parts.push(Math.round(d.temp_min) + ' to ' + Math.round(d.temp_max) + '°C')
  else if (d.temp_max != null) parts.push('up to ' + Math.round(d.temp_max) + '°C')
  if ((d.precip_mm || 0) >= WET_DAY_MM) parts.push(Math.round(d.precip_mm) + ' mm')
  if ((d.wind_kph || 0) >= 30) parts.push('wind ' + Math.round(d.wind_kph) + ' km/h')
  return parts.join(', ')
}

const BAD_WEATHER = new Set([65, 66, 67, 75, 82, 86, 95, 96, 99])

/** How loudly a weather day shows: warning (heavy rain / snow / thunder /
 * a gale), notice (fog, rain, snow, blowy), else info. */
export function weatherSeverity(d = {}) {
  const code = Number(d.weather_code ?? 0)
  if (BAD_WEATHER.has(code) || (d.wind_kph || 0) >= 60 || (d.precip_mm || 0) >= 20) return 'warning'
  if (code >= 45 || (d.wind_kph || 0) >= 45 || (d.precip_mm || 0) >= 5) return 'notice'
  return 'info'
}

/** Is an item on this day ('YYYY-MM-DD')? Multi-day items run starts_on to ends_on, both included. */
export function itemOnDay(item, day) {
  const from = String(item?.starts_on || '').slice(0, 10)
  const to = String(item?.ends_on || item?.starts_on || '').slice(0, 10)
  return !!from && from <= day && day <= to
}

const KIND_ORDER = { weather: 0, incidents: 1, traffic: 2, events: 3 }
const SEV_ORDER = { warning: 0, notice: 1, info: 2 }

/** A day's items in reading order: weather first, then incidents, traffic,
 * events; the loudest first within a kind. */
export function sortDayItems(items = []) {
  return [...items].sort((a, b) =>
    (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9)
    || (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9)
    || String(a.title || '').localeCompare(String(b.title || '')))
}

/**
 * The calendar's month ('2026-11') as whole weeks, Monday first:
 * [{ date: 'YYYY-MM-DD', inMonth }], from the Monday on or before the 1st to
 * the Sunday on or after the last day.
 */
export function monthGrid(month) {
  const [y, m] = String(month).split('-').map(Number)
  const monthStr = y + '-' + String(m).padStart(2, '0')
  const start = new Date(Date.UTC(y, m - 1, 1))
  start.setUTCDate(1 - ((start.getUTCDay() + 6) % 7))
  const end = new Date(Date.UTC(y, m, 0))
  end.setUTCDate(end.getUTCDate() + (7 - end.getUTCDay()) % 7)
  const out = []
  for (const d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10)
    out.push({ date: iso, inMonth: iso.slice(0, 7) === monthStr })
  }
  return out
}

const numOrNull = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) ? null : Number(v)

/** A captured forecast day (the weather capture's items carry the numbers). */
export const isForecast = it => it?.kind === 'weather' && it.data != null && it.data.weather_code != null

/**
 * The week ahead at a venue (the Today page): `days` days from `from`
 * ('YYYY-MM-DD'), out of the venue's items (its own and the whole group's,
 * hidden ones left out by the caller).
 *   weather    one forecast per day that has one, in date order (the loudest
 *              when two captures cover a day)
 *   headlines  everything else on those days, each once: by the first day it
 *              shows in the week (an item that began earlier shows from
 *              `from`), then the loudest, then kind (incidents, traffic,
 *              events, weather typed in) and title; at most `headlines`
 *   more       how many headlines were left out
 */
export function weekAhead(items = [], from, { days = 7, headlines = 5 } = {}) {
  const to = addDays(from, days - 1)
  const weather = []
  for (let i = 0; i < days; i++) {
    const day = addDays(from, i)
    const f = sortDayItems(items.filter(it => isForecast(it) && itemOnDay(it, day)))[0]
    if (!f) continue
    weather.push({
      date: day, title: f.title, details: f.details || null, severity: f.severity || 'info',
      code: numOrNull(f.data.weather_code), temp_min: numOrNull(f.data.temp_min), temp_max: numOrNull(f.data.temp_max),
      precip_mm: numOrNull(f.data.precip_mm), wind_kph: numOrNull(f.data.wind_kph),
    })
  }
  const news = []
  for (const it of items) {
    if (isForecast(it)) continue
    const start = String(it.starts_on || '').slice(0, 10)
    const end = String(it.ends_on || it.starts_on || '').slice(0, 10)
    if (!start || end < from || start > to) continue
    news.push({
      id: it.id, kind: it.kind, title: it.title, details: it.details || null, severity: it.severity || 'info',
      starts_on: start, ends_on: end !== start ? end : null, time_text: it.time_text || null,
      place: it.place || null, url: webLink(it.url), venue_wide: !it.venue_id, typed: !it.source_id,
      day: start < from ? from : start,
    })
  }
  news.sort((a, b) => a.day.localeCompare(b.day)
    || (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9)
    || (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9)
    || String(a.title || '').localeCompare(String(b.title || '')))
  return { from, to, weather, headlines: news.slice(0, headlines), more: Math.max(0, news.length - headlines) }
}
