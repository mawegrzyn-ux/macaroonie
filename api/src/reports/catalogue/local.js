// src/reports/catalogue/local.js
//
// Local info around each venue (migration 240; docs/REPORTS.md 20): the
// weather captured for each venue and day, to put beside sales, covers and
// labour; everything else on the Local info page (traffic, events,
// incidents, and what staff typed in); and the captures that find it.
//
// The weather rows are local_info_items of kind weather that hold a
// weather day (shared/localInfo.js isWeatherDay()): the day as recorded once
// it is over, else the forecast, with what was forecast kept beside a
// recorded day (data.forecast). A venue with two weather
// captures has two rows a day, so the subject keeps the one read last. The
// words and the kind of weather come from the code (weatherCodes(),
// WEATHER_GROUPS), never the row's title, which a capture never rewrites.
// local.items is every other item. Items someone hid on the Local info page
// are left out of both, as on that page and on Today; an item for the whole
// group (no venue) shows only with every venue picked. Each item says how
// many staff flagged it relevant or not, and each capture what Pepper
// learned from those flags (migration 248). A finding merged into another
// entry (migration 249) is left out like a hidden one: the entry counts it
// once, and says how many other reports it holds.

import { subject, text, choice, number, percent, yesno, date, moment, count, sum, avg, min, max, ratio, one, many } from './define.js'
import { weatherCodes, WEATHER_GROUPS, WET_DAY_MM, KIND_LABELS } from '../../../../shared/localInfo.js'

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

// A number kept in the item's data under `obj` (the forecast kept for a recorded day).
const numIn = (obj, key) => "(CASE WHEN jsonb_typeof(i.data->'" + obj + "'->'" + key + "') = 'number' THEN (i.data->'" + obj + "'->>'" + key + "')::numeric END)"
const RECORDED = "COALESCE(i.data->>'recorded' = 'true', false)"
// What was forecast for the day: the day itself until it is recorded, then the forecast kept for it.
const forecast = key => '(CASE WHEN ' + RECORDED + ' THEN ' + numIn('forecast', key) + ' ELSE ' + num(key) + ' END)'

const WEATHER_DAYS = `(
  SELECT DISTINCT ON (i.venue_id, i.starts_on)
         i.id, i.tenant_id, i.venue_id, i.starts_on AS day, i.severity, i.updated_at,
         ${num('weather_code')}::int AS weather_code,
         ${num('temp_min')} AS temp_min, ${num('temp_max')} AS temp_max,
         COALESCE(${num('precip_mm')}, 0) AS precip_mm, COALESCE(${num('wind_kph')}, 0) AS wind_kph,
         ${RECORDED} AS recorded,
         ${forecast('weather_code')}::int AS forecast_code, ${forecast('temp_min')} AS forecast_min,
         ${forecast('temp_max')} AS forecast_max, ${forecast('precip_mm')} AS forecast_mm
    FROM local_info_items i
   WHERE i.kind = 'weather' AND i.venue_id IS NOT NULL AND NOT i.hidden AND i.merged_into IS NULL
     AND jsonb_typeof(i.data->'weather_code') = 'number'
   ORDER BY i.venue_id, i.starts_on, i.updated_at DESC, i.id
)`

// The weather hour by hour (22 Nov 2026): each weather day's hours
// (data.hours, mergeWeatherDay() in shared/localInfo.js), one row an hour,
// from the same row a day local.weather keeps.
const hnum = (obj, key) => "(CASE WHEN jsonb_typeof(" + obj + "->'" + key + "') = 'number' THEN (" + obj + "->>'" + key + "')::numeric END)"
const WEATHER_HOURS = `(
  SELECT d.id::text || ':' || (x->>'h') AS id, d.tenant_id, d.venue_id, d.day, (x->>'h')::int AS hour, d.updated_at,
         ${hnum('x', 'weather_code')}::int AS weather_code, ${hnum('x', 'temp')} AS temp,
         COALESCE(${hnum('x', 'precip_mm')}, 0) AS precip_mm, ${hnum('x', 'precip_prob')} AS precip_prob,
         COALESCE(${hnum('x', 'wind_kph')}, 0) AS wind_kph, COALESCE(x->>'recorded' = 'true', false) AS recorded,
         ${hnum("(x->'forecast')", 'weather_code')}::int AS forecast_code, ${hnum("(x->'forecast')", 'temp')} AS forecast_temp,
         ${hnum("(x->'forecast')", 'precip_mm')} AS forecast_mm
    FROM (SELECT DISTINCT ON (i.venue_id, i.starts_on) i.id, i.tenant_id, i.venue_id, i.starts_on AS day, i.updated_at, i.data
            FROM local_info_items i
           WHERE i.kind = 'weather' AND i.venue_id IS NOT NULL AND NOT i.hidden AND i.merged_into IS NULL
             AND jsonb_typeof(i.data->'weather_code') = 'number'
           ORDER BY i.venue_id, i.starts_on, i.updated_at DESC, i.id) d
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(d.data->'hours') = 'array' THEN d.data->'hours' ELSE '[]'::jsonb END) x
   WHERE x->>'h' ~ '^[0-9]{1,2}$'
)`
// An hour that had rain or snow: 0.1 mm or more.
const WET_HOUR = '({t}.precip_mm >= 0.1)'
const HOURS = Object.fromEntries(Array.from({ length: 24 }, (_, h) => [String(h).padStart(2, '0'), String(h).padStart(2, '0') + ':00']))

const WET = '({t}.precip_mm >= ' + WET_DAY_MM + ')'
const SEVERITY = { info: 'Info', notice: 'Worth knowing', warning: 'Warning' }
const KINDS = { ...KIND_LABELS, other: 'Other' }

// An item that is a weather forecast (local.weather's rows) and one that
// isn't (local.items'): the same test, so every item is in exactly one.
const FORECAST = "({t}.kind = 'weather' AND COALESCE(jsonb_typeof({t}.data->'weather_code') = 'number', false))"

// How often a capture runs, worded as the Local info page words it
// (frequencyText() and everyHours()).
const HOW_OFTEN = `(CASE {t}.frequency
   WHEN 'hours' THEN 'Every ' || LEAST(24, GREATEST(1, COALESCE(NULLIF({t}.every_hours, 0), 4))) || ' hours'
   WHEN 'weekly' THEN 'Once a week (Monday morning)'
   ELSE 'Once a day (early morning)' END)`
const FAILING = "(COALESCE({t}.last_error, '') <> '')"

// How many staff flagged an item relevant or not on the Local info page
// (migration 248): one flag a person, a flag taken off is no row. Only what
// a capture found takes flags, so a typed-in event's counts are 0.
const FLAGS = cond => '(SELECT count(*) FROM local_info_feedback f WHERE f.item_id = {t}.id AND f.tenant_id = {t}.tenant_id AND ' + cond + ')'
// How many other findings were put into an entry as the same event.
const ALSO = '(SELECT count(*) FROM local_info_items c WHERE c.merged_into = {t}.id AND c.tenant_id = {t}.tenant_id)'
const LEARNS = "({t}.learn_auto AND {t}.kind <> 'weather')"

export default [
  subject({
    key: 'local.weather',
    label: 'Weather',
    one: 'weather day',
    area: 'local',
    module: 'local_info',
    about: 'The weather at each venue, one row a day, from the weather capture on the Local info page: once the day is over, the weather that was recorded (Open-Meteo\'s values for the venue\'s spot, from weather models run on what was observed, not a station on the street); before that, the latest forecast. What was forecast is kept beside a recorded day. Days someone hid on Local info are left out.',
    from: { sql: WEATHER_DAYS, tables: ['local_info_items'] },
    name: 'conditions',
    venue: 'venue_id',
    date: { sql: '{t}.day', label: 'Day' },
    fields: {
      conditions: choice({ sql: caseOf('{t}.weather_code', WORD_OF_CODE) }, WORDS, { label: 'Weather', empty: 'Not known' }),
      kind: choice({ sql: caseOf('{t}.weather_code', GROUP_OF_CODE) }, GROUPS, { label: 'Kind of weather', empty: 'Not known', about: 'Clear or bright, cloudy, fog, drizzle, rain or showers, snow, or a thunderstorm.' }),
      severity: choice('severity', SEVERITY, { label: 'How it shows', about: 'Warning for heavy rain or snow, thunder, a gale or a downpour; worth knowing for fog, rain, snow or a strong wind; else info. As on the Local info page.' }),
      temp_max: number('temp_max', { label: 'Highest (°C)', decimals: 1 }),
      temp_min: number('temp_min', { label: 'Lowest (°C)', decimals: 1 }),
      rain: number('precip_mm', { label: 'Rain and snow (mm)', decimals: 1, adds: true }),
      wind: number('wind_kph', { label: 'Strongest wind (km/h)', decimals: 0 }),
      wet: yesno({ sql: WET }, { label: 'Wet day', about: WET_DAY_MM + ' mm of rain or snow or more.' }),
      recorded: yesno({ sql: '{t}.recorded' }, { label: 'Recorded', about: 'Yes once the day is over and its weather was recorded; no while it is still the forecast.' }),
      forecast_conditions: choice({ sql: caseOf('{t}.forecast_code', WORD_OF_CODE) }, WORDS, { label: 'Weather forecast', empty: 'No forecast', about: 'What was forecast for the day, as last read before it was over. A day first read after it was over has none.' }),
      forecast_high: number('forecast_max', { label: 'Forecast highest (°C)', decimals: 1 }),
      forecast_low: number('forecast_min', { label: 'Forecast lowest (°C)', decimals: 1 }),
      forecast_rain: number('forecast_mm', { label: 'Forecast rain and snow (mm)', decimals: 1, adds: true }),
      read_at: moment('updated_at', { label: 'Last read' }),
    },
    measures: {
      days: count({ label: 'Days', about: 'How many venue days have weather, recorded or forecast.' }),
      recorded_days: count({ label: 'Recorded days', where: '{t}.recorded', about: 'Days whose weather was recorded once they were over.' }),
      wet_days: count({ label: 'Wet days', where: WET, about: 'Days with ' + WET_DAY_MM + ' mm of rain or snow or more.' }),
      dry_days: count({ label: 'Dry days', where: 'NOT ' + WET, about: 'Days with less than ' + WET_DAY_MM + ' mm of rain or snow.' }),
      warning_days: count({ label: 'Days with a weather warning', where: "{t}.severity = 'warning'", about: 'Days whose weather shows as a warning: heavy rain or snow, thunder, a gale or a downpour.' }),
      wet_share: ratio('wet_days', 'days', { type: 'percent', label: 'Share of days wet', about: 'Wet days divided by the days with weather.' }),
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

  subject({
    key: 'local.weather_hours',
    label: 'Weather by the hour',
    one: 'weather hour',
    area: 'local',
    module: 'local_info',
    about: 'The weather at each venue hour by hour (in the venue\'s time), from the weather capture on the Local info page: an hour that has passed is recorded (Open-Meteo\'s values for the venue\'s spot), a later one the latest forecast with its chance of rain; what was forecast is kept beside a recorded hour. Hours are kept from the capture\'s first run on, and only as fresh as its last run.',
    from: { sql: WEATHER_HOURS, tables: ['local_info_items'] },
    idType: 'text',
    name: 'conditions',
    venue: 'venue_id',
    date: { sql: '{t}.day', label: 'Day' },
    fields: {
      hour: choice({ sql: "lpad({t}.hour::text, 2, '0')" }, HOURS, { label: 'Hour', about: 'The hour of the day, in the venue\'s time (14:00 is 14:00 to 15:00).' }),
      conditions: choice({ sql: caseOf('{t}.weather_code', WORD_OF_CODE) }, WORDS, { label: 'Weather', empty: 'Not known' }),
      kind: choice({ sql: caseOf('{t}.weather_code', GROUP_OF_CODE) }, GROUPS, { label: 'Kind of weather', empty: 'Not known' }),
      temp: number('temp', { label: 'Temperature (°C)', decimals: 1 }),
      rain: number('precip_mm', { label: 'Rain and snow (mm)', decimals: 1, adds: true }),
      chance_of_rain: percent('precip_prob', { label: 'Chance of rain', about: 'A forecast hour\'s chance of rain or snow; none once the hour is recorded.' }),
      wind: number('wind_kph', { label: 'Wind (km/h)', decimals: 0 }),
      wet: yesno({ sql: WET_HOUR }, { label: 'Wet hour', about: '0.1 mm of rain or snow or more in the hour.' }),
      recorded: yesno({ sql: '{t}.recorded' }, { label: 'Recorded' }),
      forecast_conditions: choice({ sql: caseOf('{t}.forecast_code', WORD_OF_CODE) }, WORDS, { label: 'Weather forecast', empty: 'No forecast' }),
      forecast_temp: number('forecast_temp', { label: 'Forecast temperature (°C)', decimals: 1 }),
      forecast_rain: number('forecast_mm', { label: 'Forecast rain and snow (mm)', decimals: 1, adds: true }),
      read_at: moment('updated_at', { label: 'Last read' }),
    },
    measures: {
      hours: count({ label: 'Hours' }),
      wet_hours: count({ label: 'Wet hours', where: WET_HOUR, about: 'Hours with 0.1 mm of rain or snow or more.' }),
      wet_hour_share: ratio('wet_hours', 'hours', { type: 'percent', label: 'Share of hours wet' }),
      average_temp: avg('temp', { label: 'Average temperature (°C)', decimals: 1 }),
      warmest: max('temp', { label: 'Warmest (°C)', decimals: 1 }),
      coldest_hour: min('temp', { label: 'Coldest (°C)', decimals: 1 }),
      rain_total: sum('precip_mm', { label: 'Rain and snow (mm)', decimals: 1 }),
      average_wind: avg('wind_kph', { label: 'Average wind (km/h)', decimals: 0 }),
    },
    list: ['date', 'hour', 'venue.name', 'conditions', 'temp', 'rain', 'chance_of_rain', 'wind', 'recorded'],
    sort: [{ by: 'date', dir: 'desc' }, { by: 'hour', dir: 'asc' }],
  }),

  subject({
    key: 'local.items',
    label: 'Local news and events',
    one: 'local item',
    area: 'local',
    module: 'local_info',
    about: 'Traffic, events and incidents around each venue on the Local info page: what the captures found and what staff typed in. Weather forecasts are in Weather. Items someone hid are left out; an item for the whole group shows only with every venue picked. The same event found under other names is one item, as on the page.',
    from: 'local_info_items',
    where: 'NOT {t}.hidden AND {t}.merged_into IS NULL AND NOT ' + FORECAST,
    name: 'title',
    venue: 'venue_id',
    date: { sql: '{t}.starts_on', label: 'Day it starts' },
    fields: {
      title: text('title', { label: 'Title' }),
      details: text('details', { label: 'Details' }),
      kind: choice('kind', KINDS, { label: 'Kind' }),
      severity: choice('severity', SEVERITY, { label: 'How it shows' }),
      place: text('place', { label: 'Where' }),
      last_day: date({ sql: 'COALESCE({t}.ends_on, {t}.starts_on)' }, { label: 'Last day' }),
      days: number({ sql: '(COALESCE({t}.ends_on, {t}.starts_on) - {t}.starts_on + 1)' }, { label: 'Days it runs', decimals: 0 }),
      time: text('time_text', { label: 'Time' }),
      link: text('url', { label: 'Web address' }),
      came_from: choice({ sql: "(CASE WHEN {t}.source_id IS NULL THEN 'typed' ELSE 'captured' END)" }, { typed: 'Typed in', captured: 'Found by a capture' }, { label: 'How it came in' }),
      typed_by: text('created_by', { label: 'Typed in by', pii: true }),
      found_at: moment('captured_at', { label: 'Found' }),
      flagged_relevant: number({ sql: FLAGS('f.relevant') }, { label: 'Flagged relevant', decimals: 0, adds: true, about: 'How many staff flagged it relevant on the Local info page. Only what a capture found takes flags.' }),
      flagged_not_relevant: number({ sql: FLAGS('NOT f.relevant') }, { label: 'Flagged not relevant', decimals: 0, adds: true, about: 'How many staff flagged it not relevant on the Local info page. Only what a capture found takes flags.' }),
      other_reports: number({ sql: ALSO }, { label: 'Other reports of it', decimals: 0, adds: true, about: 'How many other findings Pepper put into it as the same event or incident, shown under it as Also reported as.' }),
      kept_apart: yesno('keep_separate', { label: 'Kept apart', about: 'Someone said it isn\'t the same as the entry it was put into, so it is never put into another.' }),
    },
    measures: {
      items: count({ label: 'Items' }),
      warnings: count({ label: 'Warnings', where: "{t}.severity = 'warning'" }),
      events: count({ label: 'Events', where: "{t}.kind = 'events'" }),
      traffic: count({ label: 'Traffic', where: "{t}.kind = 'traffic'" }),
      incidents: count({ label: 'Incidents', where: "{t}.kind = 'incidents'" }),
      typed: count({ label: 'Typed in', where: '{t}.source_id IS NULL' }),
      captured: count({ label: 'Found by a capture', where: '{t}.source_id IS NOT NULL' }),
    },
    links: {
      capture: one('local.captures', 'source_id', { label: 'Capture' }),
    },
    list: ['date', 'venue.name', 'kind', 'title', 'place', 'severity'],
    sort: [{ by: 'date', dir: 'desc' }],
    // The capture's own copy of what it found and its duplicate check, and
    // when a merge pass last looked at a finding. merged_into is read by the
    // subject's rule (findings put into another entry aren't rows here) and
    // by Other reports of it.
    skip: ['external_key', 'updated_at', 'merge_checked_at'],
  }),

  subject({
    key: 'local.captures',
    label: 'Local info captures',
    one: 'capture',
    area: 'local',
    module: 'local_info',
    about: 'The captures on the Local info page that find the weather, traffic, events and incidents around each venue: how often each runs, when it ran last, and whether it ran into a problem.',
    from: 'local_info_sources',
    name: 'kind',
    venue: 'venue_id',
    fields: {
      kind: choice('kind', KINDS, { label: 'What it captures' }),
      enabled: yesno('enabled', { label: 'Switched on' }),
      how_often: text({ sql: HOW_OFTEN }, { label: 'How often' }),
      place: text('place', { label: 'Place' }),
      site: text('site', { label: 'Site searched', empty: 'Any site' }),
      query: text('query', { label: 'Search words' }),
      found_as: text('geocoded_place', { label: 'Found on the map as', about: 'Where a weather capture found the place on the map.' }),
      last_ran: moment('last_run_at', { label: 'Last ran' }),
      next_run: moment('next_run_at', { label: 'Next run' }),
      running: yesno({ sql: '(COALESCE({t}.running_until > now(), false))' }, { label: 'Running now' }),
      failing: yesno({ sql: FAILING }, { label: 'Ran into a problem', about: 'Its last run ended with a problem, shown on its row on the Local info page.' }),
      problem: text('last_error', { label: 'The problem' }),
      made_at: moment('created_at', { label: 'Added' }),
      learns: yesno({ sql: LEARNS }, { label: 'Learns from staff flags', about: 'Before it runs, Pepper reads the staff flags on what it found and adds what it learned to its search. A weather capture has no search, so never learns.' }),
      learned: text({ sql: "({t}.learned->>'summary')" }, { label: 'What Pepper learned', empty: 'Nothing yet', about: 'Pepper\'s sentence on what the staff flags say to look for and to leave out. The search uses it while the capture learns from staff flags.' }),
      learned_at: moment('learned_at', { label: 'Last learned from flags' }),
      learn_problem: text('learn_error', { label: 'Problem learning from flags', about: 'Why Pepper couldn\'t learn from the flags before its last run; the run went ahead with what it had learned before.' }),
      merge_problem: text('merge_error', { label: 'Problem merging duplicates', about: 'Why Pepper couldn\'t put the same events together after its last run; what it found is looked at again after the next run.' }),
    },
    measures: {
      captures: count({ label: 'Captures' }),
      switched_on: count({ label: 'Switched on', where: '{t}.enabled' }),
      failing_captures: count({ label: 'Ran into a problem', where: FAILING }),
    },
    links: {
      items: many('local.items', 'source_id', { label: 'What it found', about: 'Traffic, events and incidents it found; a weather capture\'s forecasts are in Weather.' }),
    },
    list: ['venue.name', 'kind', 'how_often', 'enabled', 'last_ran', 'failing'],
    sort: [{ by: 'kind', dir: 'asc' }],
    // Where a weather capture found the place, as numbers (found_as says it
    // in words); when the flags on its findings last changed, kept only to
    // decide when to learn again (Last learned from flags says when they
    // were read).
    skip: ['lat', 'lon', 'updated_at', 'flags_at'],
  }),
]
