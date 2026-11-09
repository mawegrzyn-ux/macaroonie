// src/services/localInfoSvc.js
//
// Local information around each venue (migration 240): weather, traffic,
// events and incidents, captured on each source's own schedule by the
// few-minutes sweep in jobs/queues.js (sweepLocalInfo), or on demand from
// the page and Pepper (claimSource + runClaimed).
//
// Weather reads Open-Meteo (keyless): the source's place is geocoded once
// (/v1/search) and the lat/lon cached on the row until the place changes,
// then /v1/forecast gives seven days, one item per day. The other kinds run
// a web search through Pepper's model (searchForJson in aiJson.js,
// optionally narrowed to one site), which answers a JSON list of findings.
//
// Every captured item keeps a dedupe key (shared/localInfo.js itemKey), so a
// capture run again updates its rows instead of repeating them, and an item
// the operator hid stays hidden. Scheduled runs have no person: they count
// the tenant's monthly AI allowance only.

import { env } from '../config/env.js'
import { withTenant, systemSql } from '../config/db.js'
import { searchForJson, obj, str, arr, oneOf, clip } from './aiJson.js'
import {
  KINDS, SEVERITIES, nextRunAt, itemKey, addDays, localDateTime,
  weatherText, weatherSummary, weatherSeverity,
} from '../../../shared/localInfo.js'

const TIMEOUT_MS = 20000
const MAX_FOUND = 20
const CLAIM_MINS = 5
// Captured and typed-in items alike go after this long (the hourly AI
// clean-up): the retrospective view reaches back a year.
const KEEP_DAYS = 400

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error('HTTP ' + res.status)
  return res.json()
}

/** The due, enabled sources the sweep should run now, claimed across API processes. */
export async function claimDue(limit = 4) {
  return systemSql`
    UPDATE local_info_sources s SET running_until = now() + make_interval(mins => ${CLAIM_MINS})
    WHERE s.id IN (
      SELECT id FROM local_info_sources
      WHERE enabled AND next_run_at IS NOT NULL AND next_run_at <= now()
        AND (running_until IS NULL OR running_until < now())
      ORDER BY next_run_at
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED)
    RETURNING s.*`
}

/** Claim one source for a run-now (null when another run holds it). */
export async function claimSource(tenantId, id) {
  const rows = await withTenant(tenantId, tx => tx`
    UPDATE local_info_sources SET running_until = now() + make_interval(mins => ${CLAIM_MINS})
    WHERE id = ${id} AND tenant_id = ${tenantId}
      AND (running_until IS NULL OR running_until < now())
    RETURNING *`)
  return rows[0] || null
}

/** Run a claimed source and write the outcome. Never throws. */
export async function runClaimed(source, log = null) {
  const venues = await systemSql`
    SELECT timezone FROM venues WHERE id = ${source.venue_id} AND tenant_id = ${source.tenant_id}`
  const tz = venues[0]?.timezone || 'Europe/London'
  let error = null
  try {
    if (!clip(source.place, 200)) throw new Error('Type the place first (a town or postcode).')
    if (source.kind === 'weather') await captureWeather(source, tz)
    else await captureSearch(source, tz)
  } catch (err) {
    error = clip(err?.message || String(err), 300) || 'The capture failed.'
    log?.warn({ err, sourceId: source.id }, 'local info capture failed')
  }
  const next = nextRunAt(source, new Date(), tz)
  await withTenant(source.tenant_id, tx => tx`
    UPDATE local_info_sources
       SET last_run_at = now(), next_run_at = ${next}, last_error = ${error},
           running_until = NULL, updated_at = now()
     WHERE id = ${source.id} AND tenant_id = ${source.tenant_id}`)
  return { error }
}

/** The repeat job: run whatever is due, one source after another. */
export async function sweepLocalInfo(log = null) {
  const due = await claimDue()
  for (const source of due) await runClaimed(source, log)
  return due.length
}

async function captureWeather(source, tz) {
  let { lat, lon } = source
  const place = clip(source.place, 200)
  if (lat == null || lon == null || source.geocoded_place !== place) {
    const geo = await getJson(env.OPEN_METEO_GEOCODE_URL.replace(/\/+$/, '')
      + '/v1/search?count=1&language=en&format=json&name=' + encodeURIComponent(place))
    const hit = geo?.results?.[0]
    if (!hit) throw new Error('Couldn\'t find "' + place + '" on the map. Try the town with its county, or a postcode.')
    lat = hit.latitude; lon = hit.longitude
    await withTenant(source.tenant_id, tx => tx`
      UPDATE local_info_sources SET lat = ${lat}, lon = ${lon}, geocoded_place = ${place}
       WHERE id = ${source.id} AND tenant_id = ${source.tenant_id}`)
  }
  const data = await getJson(env.OPEN_METEO_URL.replace(/\/+$/, '') + '/v1/forecast'
    + '?latitude=' + encodeURIComponent(lat) + '&longitude=' + encodeURIComponent(lon)
    + '&daily=weather_code,temperature_2m_min,temperature_2m_max,precipitation_sum,wind_speed_10m_max'
    + '&forecast_days=7&timezone=' + encodeURIComponent(tz))
  const days = data?.daily?.time || []
  for (let i = 0; i < days.length; i++) {
    const day = {
      weather_code: data.daily.weather_code?.[i] ?? 0,
      temp_min: data.daily.temperature_2m_min?.[i],
      temp_max: data.daily.temperature_2m_max?.[i],
      precip_mm: data.daily.precipitation_sum?.[i] ?? 0,
      wind_kph: data.daily.wind_speed_10m_max?.[i] ?? 0,
    }
    await upsertItem(source, {
      kind: 'weather',
      title: weatherText(day.weather_code),
      details: weatherSummary(day),
      place,
      starts_on: days[i],
      severity: weatherSeverity(day),
      data: day,
      external_key: itemKey('weather', days[i]),
    })
  }
}

const SEARCH_SYSTEM = 'You find local information for a restaurant’s operations team. Search the web '
  + 'and report only real, dated findings for the place given — never invent an event, a closure or an '
  + 'incident, and leave out anything you can’t date. Dates are YYYY-MM-DD. severity is "warning" for '
  + 'anything that will materially affect trade or travel (a road closed, a big event crowding the area), '
  + '"notice" for things worth knowing ahead, "info" for the rest. ends_on is "" for one-day findings; '
  + 'time_text is the time as the page gives it ("19:00", "evening") or ""; url is the page the finding '
  + 'came from, or "". An empty items list is a fine answer when nothing is on.'

const SEARCH_ASKS = {
  traffic: 'road closures, roadworks, diversions and major traffic or public transport disruption over the next few weeks',
  events: 'events that could bring people past the restaurant or keep them away: festivals, markets, concerts, matches, parades and school holidays over the next few weeks',
  incidents: 'recent or ongoing local incidents that could affect trade: flooding, power cuts, police incidents, closures, severe weather warnings',
}

const SEARCH_SCHEMA = obj({
  items: arr(obj({
    title: str, details: str, place: str, url: str,
    starts_on: str, ends_on: str, time_text: str,
    severity: oneOf(SEVERITIES),
  })),
})

async function captureSearch(source, tz) {
  const today = localDateTime(new Date(), tz).date
  const place = clip(source.place, 200)
  const prompt = 'Today is ' + today + '. Find ' + (SEARCH_ASKS[source.kind] || SEARCH_ASKS.events)
    + ' in and around ' + place + '.'
    + (clip(source.query, 300) ? ' Also look for: ' + clip(source.query, 300) + '.' : '')
    + (source.site ? ' Search only ' + source.site + '.' : '')
  const out = await searchForJson({
    tenantId: source.tenant_id, system: SEARCH_SYSTEM, schema: SEARCH_SCHEMA,
    prompt, site: clip(source.site, 100) || undefined, what: source.kind + ' search',
  })
  const from = addDays(today, -14), to = addDays(today, 90)
  const dateOk = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && s >= from && s <= to
  for (const raw of (Array.isArray(out?.items) ? out.items : []).slice(0, MAX_FOUND)) {
    const title = clip(raw?.title, 200)
    const starts = clip(raw?.starts_on, 10)
    if (!title || !dateOk(starts)) continue
    const ends = clip(raw?.ends_on, 10)
    await upsertItem(source, {
      kind: source.kind,
      title,
      details: clip(raw?.details, 1000) || null,
      place: clip(raw?.place, 200) || place,
      url: /^https?:\/\//.test(raw?.url || '') ? clip(raw.url, 500) : null,
      starts_on: starts,
      ends_on: dateOk(ends) && ends > starts ? ends : null,
      time_text: clip(raw?.time_text, 40) || null,
      severity: SEVERITIES.includes(raw?.severity) ? raw.severity : 'info',
      external_key: itemKey(source.kind, starts, title),
    })
  }
}

// A capture lands on its row by (source_id, external_key): details freshen,
// a hidden item stays hidden, the title keeps the key's own words.
async function upsertItem(source, it) {
  await withTenant(source.tenant_id, tx => tx`
    INSERT INTO local_info_items (tenant_id, venue_id, source_id, kind, title, details, place, url,
                                  starts_on, ends_on, time_text, severity, data, external_key)
    VALUES (${source.tenant_id}, ${source.venue_id}, ${source.id}, ${it.kind}, ${it.title},
            ${it.details ?? null}, ${it.place ?? null}, ${it.url ?? null}, ${it.starts_on},
            ${it.ends_on ?? null}, ${it.time_text ?? null}, ${it.severity}, ${it.data ? tx.json(it.data) : null},
            ${it.external_key})
    ON CONFLICT (source_id, external_key) WHERE source_id IS NOT NULL AND external_key IS NOT NULL
    DO UPDATE SET details = EXCLUDED.details, place = EXCLUDED.place, url = EXCLUDED.url,
                  ends_on = EXCLUDED.ends_on, time_text = EXCLUDED.time_text,
                  severity = EXCLUDED.severity, data = EXCLUDED.data, updated_at = now()`)
}

/**
 * The items between two days ('YYYY-MM-DD', both included), for one venue
 * (its own plus whole-group items) or the whole group (venueId null).
 * Multi-day items count on every day they cover. Dates go out as text
 * (the date-column-as-Date trap).
 */
export async function listItems(tx, tenantId, { venueId = null, from, to, kinds = null, includeHidden = false }) {
  return tx`
    SELECT id, venue_id, source_id, kind, title, details, place, url,
           starts_on::text AS starts_on, ends_on::text AS ends_on, time_text, severity, data,
           external_key, hidden, created_by, captured_at, updated_at
      FROM local_info_items
     WHERE tenant_id = ${tenantId}
       AND starts_on <= ${to} AND COALESCE(ends_on, starts_on) >= ${from}
       ${venueId ? tx`AND (venue_id IS NULL OR venue_id = ${venueId})` : tx``}
       ${kinds?.length ? tx`AND kind = ANY(${kinds})` : tx``}
       ${includeHidden ? tx`` : tx`AND NOT hidden`}
     ORDER BY starts_on, kind, title`
}

/** The hourly clean-up: items older than a year and a bit go. */
export async function cleanUpLocalInfo() {
  await systemSql`DELETE FROM local_info_items WHERE COALESCE(ends_on, starts_on) < current_date - ${KEEP_DAYS}::int`
}

export { KINDS }
