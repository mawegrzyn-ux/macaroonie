// src/reports/dataLinks.js
//
// Data links (docs/REPORTS.md 15, migration 256): an address that returns a
// saved or starter report's current figures as JSON or CSV, for Google
// Sheets, Power BI, Looker Studio or an accountant's own tools.
//
//   makeLink(p, target, body)    a new link for the report: { row, key } (the
//                                key is shown once; only its sha256 is kept)
//   linkView(row)                a link as the admin lists it (never the key)
//   newKey()                     { key, hash, hint }
//   serveLink(args)              answers GET /api/report-data/:linkId
//
// A link is made by an owner or admin with Manage on Reports and runs as
// them, loaded afresh at every call (ownerPerson()): it stops when they
// leave, lose Manage or stop being an owner or admin, or can't open the
// report any more. Its choices are fixed when it is made; the ones named in
// open_params can be set by the caller (?period=, ?venues=). People's
// details are left out unless an owner turned them on for the link (and is
// still an owner). Calls an hour are counted on the row (window_start,
// window_uses); every call is a report run (kind 'link').

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { systemSql, withTenant } from '../config/db.js'
import { httpError } from '../middleware/error.js'
import { runsFor, refuseOtherVenues, recordRun } from './access.js'
import { runReport } from './run.js'
import { loadTarget } from './target.js'
import { ownerPerson, outsideCopy, PII_HELD } from './send.js'
import { resultTable } from './export/table.js'
import { resultJson } from './export/json.js'
import { csvOf } from './export/csv.js'
import { errorText } from './export/file.js'
import { CATALOGUE, ownRecordOnly } from './catalogue/index.js'
import { normalisePeriod, RELATIVE_PERIODS } from '../../../shared/reports/period.js'

export const LINK_LIMITS = { name: 80, perReport: 10, perGroup: 100, rate: 3600, rows: 50000, page: 5000, years: 2 }
export const KEY_PREFIX = 'mrd_'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const YMD = /^\d{4}-\d{2}-\d{2}$/
const sha = text => createHash('sha256').update(text).digest('hex')

export function newKey() {
  const key = KEY_PREFIX + randomBytes(24).toString('base64url')
  return { key, hash: sha(key), hint: key.slice(-4) }
}

const refOf = row => (row.report_id ? row.report_id : 'starter:' + row.starter_key)

export function linkView(row) {
  const expired = !!row.expires_at && new Date(row.expires_at) <= new Date()
  return {
    id: row.id,
    report: refOf(row),
    report_name: row.report_name ?? null,
    name: row.name,
    key_hint: row.key_hint,
    params: row.params || {},
    open_params: row.open_params || [],
    personal: row.personal,
    rate_per_hour: row.rate_per_hour,
    expires_at: row.expires_at,
    enabled: row.enabled,
    state: !row.enabled ? 'off' : expired ? 'expired' : 'on',
    owner_email: row.owner_email,
    uses: row.uses,
    last_used_at: row.last_used_at,
    created_at: row.created_at,
  }
}

/** The day a link stops: the end of that day (UTC); null = it doesn't. */
export function expiryOf(day, now = new Date()) {
  if (day == null || day === '') return null
  if (!YMD.test(String(day))) throw httpError(422, 'Give the last day as a date')
  const at = new Date(day + 'T23:59:59Z')
  if (Number.isNaN(at.getTime()) || at <= now) throw httpError(422, 'The last day has to be today or later')
  const max = new Date(now); max.setUTCFullYear(max.getUTCFullYear() + LINK_LIMITS.years)
  if (at > max) throw httpError(422, 'A link can last ' + LINK_LIMITS.years + ' years at most')
  return at
}

/** Who may make and manage data links: an owner or admin with Manage on Reports. */
export function assertLinkMaker(p) {
  if (!p.canManage || !p.isOwnerOrAdmin) throw httpError(403, 'Data links are made by owners and admins with Manage on Reports')
}

/** A new link for a report the person can run. */
export async function makeLink(p, target, body) {
  assertLinkMaker(p)
  const spec = target.spec
  if (!runsFor(spec.subject, p.levels).runs) {
    throw httpError(403, 'Your role can\'t report on ' + (CATALOGUE.subjects[spec.subject]?.label || 'this'))
  }
  if (body.personal && !p.isOwner) throw httpError(403, 'Only an owner can let a data link show people\'s details')
  if (ownRecordOnly(spec)) throw httpError(422, 'This report is your own record: it can\'t be a data link')
  const keys = new Set(spec.params.map(x => x.key))
  const params = Object.fromEntries(Object.entries(body.params || {}).filter(([k]) => keys.has(k)))
  await refuseOtherVenues(p, spec, params)
  const open = [...new Set((body.open_params || []).filter(k => keys.has(k)))]
  const expires = expiryOf(body.expires_on)
  const { key, hash, hint } = newKey()
  const row = await withTenant(p.tenantId, async tx => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${'report-links:' + p.tenantId}))`
    const [{ group, report }] = await tx`
      SELECT count(*)::int AS group,
             count(*) FILTER (WHERE report_id IS NOT DISTINCT FROM ${target.saved?.id ?? null}::uuid
                                AND starter_key IS NOT DISTINCT FROM ${target.starter?.key ?? null})::int AS report
        FROM report_data_links WHERE tenant_id = ${p.tenantId}`
    if (group >= LINK_LIMITS.perGroup) throw httpError(422, 'Your group has ' + LINK_LIMITS.perGroup + ' data links. Delete one first')
    if (report >= LINK_LIMITS.perReport) throw httpError(422, 'This report has ' + LINK_LIMITS.perReport + ' data links. Delete one first')
    const [r] = await tx`
      INSERT INTO report_data_links (tenant_id, report_id, starter_key, name, key_hash, key_hint, params, open_params,
                                     personal, rate_per_hour, expires_at, owner_sub, owner_email)
      VALUES (${p.tenantId}, ${target.saved?.id ?? null}, ${target.starter?.key ?? null}, ${body.name}, ${hash}, ${hint},
              ${tx.json(params)}, ${open}, ${!!body.personal}, ${body.rate_per_hour ?? 60}, ${expires},
              ${p.sub}, ${p.email})
      RETURNING *`
    return r
  })
  return { row: { ...row, report_name: target.name }, key }
}

/* ------------------------------------------------------------------ serving */

// A choice the caller set in the address, as the report takes it.
function paramFrom(def, raw) {
  const v = String(raw).trim()
  if (def.type === 'period') {
    const range = v.match(/^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/)
    const days = v.match(/^(last|next)_n_days:(\d{1,4})$/)
    const period = range ? normalisePeriod({ from: range[1], to: range[2] })
      : days ? normalisePeriod({ relative: days[1] + '_n_days', n: Number(days[2]) })
        : RELATIVE_PERIODS.includes(v) ? normalisePeriod({ relative: v }) : null
    if (!period) throw httpError(400, def.key + ' must be a period name (last_week), last_n_days:30, or two dates: 2026-11-01..2026-11-30')
    return period
  }
  if (def.type === 'venues') {
    if (v === 'all') return 'all'
    const ids = v.split(',').map(x => x.trim()).filter(Boolean)
    if (!ids.length || ids.some(x => !UUID_RE.test(x))) throw httpError(400, def.key + ' must be all, or venue ids with commas between them')
    return ids
  }
  return v.slice(0, 200)
}

// A short fingerprint of a result's table, for ETags and cursors.
const fingerprint = table => sha(JSON.stringify([table.head, table.rows, table.kinds])).slice(0, 16)

function cursorOf(offset, print) {
  return Buffer.from(offset + '.' + print).toString('base64url')
}

function readCursor(raw, print) {
  if (raw == null || raw === '') return 0
  const m = Buffer.from(String(raw), 'base64url').toString().match(/^(\d{1,7})\.([0-9a-f]{16})$/)
  if (!m) throw httpError(400, 'That cursor isn\'t one this link gave')
  if (m[2] !== print) throw httpError(409, 'The figures changed since the first page. Start again without a cursor')
  return Number(m[1])
}

const keyMatches = (key, hash) => {
  if (typeof key !== 'string' || !key.startsWith(KEY_PREFIX) || key.length > 100) return false
  const a = Buffer.from(sha(key), 'hex'), b = Buffer.from(String(hash), 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * GET /api/report-data/:linkId. Returns { status, headers, body }; throws
 * httpError for refusals. `query` holds format, cursor, limit and the open
 * choices; `key` comes from a header or the address.
 */
export async function serveLink({ linkId, key, query = {}, ifNoneMatch = null, log = null }) {
  if (!UUID_RE.test(String(linkId))) throw httpError(404, 'Data link not found')
  const [link] = await systemSql`SELECT * FROM report_data_links WHERE id = ${linkId}`
  if (!link) throw httpError(404, 'Data link not found')
  if (!keyMatches(key, link.key_hash)) throw httpError(401, 'This data link needs its key: in an Authorization: Bearer header, an X-Report-Key header, or ?key=')
  if (!link.enabled) throw httpError(410, 'This data link has been switched off')
  if (link.expires_at && new Date(link.expires_at) <= new Date()) throw httpError(410, 'This data link has run out')

  // Count the call, and keep to its calls an hour.
  const [w] = await systemSql`
    UPDATE report_data_links SET
      window_uses  = CASE WHEN window_start > now() - interval '1 hour' THEN window_uses + 1 ELSE 1 END,
      window_start = CASE WHEN window_start > now() - interval '1 hour' THEN window_start ELSE now() END,
      uses = uses + 1, last_used_at = now()
     WHERE id = ${link.id} AND tenant_id = ${link.tenant_id}
    RETURNING window_uses, window_start`
  if (w.window_uses > link.rate_per_hour) {
    const wait = Math.max(1, Math.ceil((new Date(w.window_start).getTime() + 3600e3 - Date.now()) / 1000))
    const e = httpError(429, 'This data link has had its ' + link.rate_per_hour + ' calls this hour. Try again later')
    e.retryAfter = wait
    throw e
  }

  // As the person who made it, as they are now.
  const owner = await ownerPerson(link.tenant_id, link.owner_sub)
  if (!owner) throw httpError(403, 'The person who made this data link isn\'t on the team any more')
  if (!owner.canManage || !owner.isOwnerOrAdmin) throw httpError(403, 'The person who made this data link can\'t make data links any more')
  const target = await loadTarget(refOf(link), owner)
  const spec = target.spec
  if (!runsFor(spec.subject, owner.levels).runs) throw httpError(403, 'The person who made this data link can\'t run this report any more')

  const format = query.format === 'csv' ? 'csv' : 'json'
  const given = { ...(link.params || {}) }
  for (const k of link.open_params || []) {
    const def = spec.params.find(x => x.key === k)
    if (def && query[k] != null && query[k] !== '') given[k] = paramFrom(def, query[k])
  }
  await refuseOtherVenues(owner, spec, given)

  const started = Date.now()
  const run = { kind: 'link', via: 'link', format, saved: target.saved, starter: target.starter, name: target.name, spec, params: given, link_id: link.id }
  let result
  try {
    result = await runReport(owner.ctx, spec, given, { mode: 'export', cap: LINK_LIMITS.rows })
  } catch (e) {
    await recordRun(owner, { ...run, ms: Date.now() - started, error: errorText(e) }, log)
    throw e
  }
  if (!(link.personal && owner.isOwner)) {
    const copy = outsideCopy(result)
    if (!copy.result) {
      await recordRun(owner, { ...run, ms: Date.now() - started, error: PII_HELD }, log)
      throw httpError(422, PII_HELD + '. An owner can let this link show people\'s details')
    }
    result = copy.result
  }
  const table = resultTable(result)
  const print = fingerprint(table)
  await recordRun(owner, { ...run, ms: Date.now() - started, rows: table.rows.length }, log)

  const etag = 'W/"' + print + (format === 'csv' ? 'c' : 'j') + '"'
  const headers = {
    'cache-control': 'private, no-cache',
    etag,
    'referrer-policy': 'no-referrer',
    'x-robots-tag': 'noindex',
  }
  if (ifNoneMatch && ifNoneMatch.split(',').map(s => s.trim()).includes(etag)) return { status: 304, headers, body: null }
  if (format === 'csv') {
    return { status: 200, headers: { ...headers, 'content-type': 'text/csv; charset=utf-8' }, body: csvOf(result) }
  }
  const limit = Math.min(LINK_LIMITS.page, Math.max(1, Math.round(Number(query.limit) || LINK_LIMITS.page)))
  const offset = readCursor(query.cursor, print)
  const end = Math.min(table.rows.length, offset + limit)
  return {
    status: 200,
    headers: { ...headers, 'content-type': 'application/json; charset=utf-8' },
    body: {
      link: { name: link.name },
      ...resultJson(result, table, { name: target.name, offset, end }),
      next_cursor: end < table.rows.length ? cursorOf(end, print) : null,
    },
  }
}

