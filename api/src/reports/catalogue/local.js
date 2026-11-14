// src/reports/catalogue/local.js
//
// Local info around each venue (migration 240; docs/REPORTS.md 20): the
// weather captured for each venue and day, to put beside sales, covers and
// labour. The weather rows are local_info_items of kind weather that hold a
// forecast (shared/localInfo.js isForecast()): a venue with two weather
// captures has two rows a day, so the subject keeps the one read last. The
// words and the kind of weather come from the code (weatherCodes(),
// WEATHER_GROUPS), never the row's title, which a capture never rewrites.
// Days someone hid on the Local info page are left out, as on that page and
// on Today. Traffic, events and incidents come with phase 3d.

import { subject, choice, number, yesno, moment, count, avg, min, max, ratio } from './define.js'
import { weatherCodes, WEATHER_GROUPS, WET_DAY_MM } from '../../../../shared/localInfo.js'

const slug = words => String(words).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')

// The weather's words by code: one choice per wording (two codes that read
// the same, freezing drizzle, are one choice).
const WORDS = {}
const WORD_OF_CODE = []
for (const [code, words] of weatherCodes()) {
  const key = slug(words)
  WORDS[key] = words
  WORD_OF_CODE.push([code, key])
}
const GROUPS = Object.fromEntries(WEATHER_GROUPS.map(g => [g.key, g.label]))
const GROUP_OF_CODE = WEATHER_GROUPS.flatMap(g => g.codes.map(code => [code, g.key]))

// Codes are whole numbers and keys lower case words: both are this file's
// own constants, so they can be written into the SQL as they are.
const caseOf = (col, pairs) => '(CASE ' + col + ' ' + pairs.map(([code, key]) => 'WHEN ' + Number(code) + " THEN '" + key + "'").join(' ') + ' END)'

// A number kept in the item's data, or nothing when it isn't one.
const num = key => "(CASE WHEN jsonb_typeof(i.data->'" + key + "') = 'number' THEN (i.data->>'" + key + "')::numeric END)"

const WEATHER_DAYS = `(
  SELECT DISTINCT ON (i.venue_id, i.starts_on)
         i.id, i.tenant_id, i.venue_id, i.starts_on AS day, i.severity, i.updated_at,
         ${num('weather_code')}::int AS weather_code,
         ${num('temp_min')} AS temp_min, ${num('temp_max')} AS temp_max,
         COALESCE(${num('precip_mm')}, 0) AS precip_mm, COALESCE(${num('wind_kph')}, 0) AS wind_kph
    FROM local_info_items i
   WHERE i.kind = 'weather' AND i.venue_id IS NOT NULL AND NOT i.hidden
     AND jsonb_typeof(i.data->'weather_code') = 'number'
   ORDER BY i.venue_id, i.starts_on, i.updated_at DESC, i.id
)`

const WET = '({t}.precip_mm >= ' + WET_DAY_MM + ')'

export default [
  subject({
    key: 'local.weather',
    label: 'Weather',
    one: 'weather day',
    area: 'local',
    module: 'local_info',
    about: 'The weather at each venue, one row a day, from the weather capture on the Local info page: the forecast as it was last read for that day. For a past day that is usually the forecast from that morning, not a measurement. Days someone hid on Local info are left out.',
    from: { sql: WEATHER_DAYS, tables: ['local_info_items'] },
    name: 'conditions',
    venue: 'venue_id',
    date: { sql: '{t}.day', label: 'Day' },
    fields: {
      conditions: choice({ sql: caseOf('{t}.weather_code', WORD_OF_CODE) }, WORDS, { label: 'Weather', empty: 'Not known' }),
      kind: choice({ sql: caseOf('{t}.weather_code', GROUP_OF_CODE) }, GROUPS, { label: 'Kind of weather', empty: 'Not known', about: 'Clear or bright, cloudy, fog, drizzle, rain or showers, snow, or a thunderstorm.' }),
      severity: choice('severity', { info: 'Info', notice: 'Worth knowing', warning: 'Warning' }, { label: 'How it shows', about: 'Warning for heavy rain or snow, thunder, a gale or a downpour; worth knowing for fog, rain, snow or a strong wind; else info. As on the Local info page.' }),
      temp_max: number('temp_max', { label: 'Highest (°C)', decimals: 1 }),
      temp_min: number('temp_min', { label: 'Lowest (°C)', decimals: 1 }),
      rain: number('precip_mm', { label: 'Rain and snow (mm)', decimals: 1, adds: true }),
      wind: number('wind_kph', { label: 'Strongest wind (km/h)', decimals: 0 }),
      wet: yesno({ sql: WET }, { label: 'Wet day', about: WET_DAY_MM + ' mm of rain or snow or more.' }),
      read_at: moment('updated_at', { label: 'Forecast last read' }),
    },
    measures: {
      days: count({ label: 'Days', about: 'How many venue days have a forecast.' }),
      wet_days: count({ label: 'Wet days', where: WET, about: 'Days with ' + WET_DAY_MM + ' mm of rain or snow or more.' }),
      dry_days: count({ label: 'Dry days', where: 'NOT ' + WET, about: 'Days with less than ' + WET_DAY_MM + ' mm of rain or snow.' }),
      warning_days: count({ label: 'Days with a weather warning', where: "{t}.severity = 'warning'", about: 'Days whose weather shows as a warning: heavy rain or snow, thunder, a gale or a downpour.' }),
      wet_share: ratio('wet_days', 'days', { type: 'percent', label: 'Share of days wet', about: 'Wet days divided by the days with a forecast.' }),
      average_high: avg('temp_max', { label: 'Average highest (°C)', decimals: 1, about: 'The average of each day\'s highest temperature.' }),
      average_low: avg('temp_min', { label: 'Average lowest (°C)', decimals: 1, about: 'The average of each day\'s lowest temperature.' }),
      hottest: max('temp_max', { label: 'Hottest (°C)', decimals: 1, about: 'The highest temperature of any of the days.' }),
      coldest: min('temp_min', { label: 'Coldest (°C)', decimals: 1, about: 'The lowest temperature of any of the days.' }),
      average_rain: avg('precip_mm', { label: 'Average rain and snow (mm)', decimals: 1, about: 'The average of each day\'s rain and snow.' }),
      wettest: max('precip_mm', { label: 'Wettest day (mm)', decimals: 1, about: 'The most rain or snow on any one of the days.' }),
      windiest: max('wind_kph', { label: 'Windiest (km/h)', decimals: 0, about: 'The strongest wind on any of the days.' }),
    },
    list: ['date', 'venue.name', 'conditions', 'temp_min', 'temp_max', 'rain', 'wind', 'severity'],
    sort: [{ by: 'date', dir: 'desc' }],
  }),
]
