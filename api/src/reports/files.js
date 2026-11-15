// src/reports/files.js
//
// Report files kept for the person who made them (docs/REPORTS.md 14;
// report_files, migration 250): Keep a file on a report's page, Pepper's
// export_report, and later the files schedules make. A kept file is made
// exactly as a download is (export/file.js), then written to the private
// store (services/privateStore.js) instead of the browser. Its row points at
// the run that made it (report_runs), recorded in the same transaction, so
// Past runs lists the two together.
//
// Only the person who made a file can download it, and only while their role
// would still see the same report: the file was made with what their role
// could see then, so if their access has gone down since (a column or a
// figure their role can no longer see, an area gone), the file is refused
// rather than handing them figures they can't see any more. A file with
// people's details in it (a column the catalogue marks pii) is kept
// PERSONAL_DAYS, any other FILE_DAYS; a group keeps GROUP_MB of live files.
//
//   keepReportFile(person, target, body, { log, via })
//                                 make, store and record one: the file's row
//   openFile(person, id)          a file row ready to send, after the checks;
//                                 throws 404 (not theirs), 410 (gone), 403
//   countDownload(person, id)     one more download on the row
//   removeFile(person, id)        the maker takes one off before its time
//   fileView(row, person)         what the browser gets
//   cleanUpReportFiles()          hourly: files past their time, and day
//                                 folders a crash left behind
//
// Erasing people's details takes their files off through fileErasure.js
// (forgetPersonalFiles, removeStored), which the erasure routes import
// instead of this file: this file imports the report engine, and those
// routes are reached from the report catalogue's own imports.

import { pipeline } from 'node:stream/promises'
import { withTenant, systemSql } from '../config/db.js'
import { httpError } from '../middleware/error.js'
import { compileReport } from './compile.js'
import { insertRun, recordRun } from './access.js'
import { prepareFile, makeReportFile, errorText } from './export/file.js'
import { newKey, putBuffer, writeStream, sizeOf, remove, removeDaysBefore } from '../services/privateStore.js'
import { normaliseReport, resolveParams } from '../../../shared/reports/spec.js'
import { todayIn, addDays } from '../../../shared/reports/period.js'

export const FILE_DAYS = 30
export const PERSONAL_DAYS = 7
export const GROUP_MB = 500
const AREA = 'reports'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const notFound = () => httpError(404, 'File not found')
const GONE = 'This file isn\'t kept any more. Run the report again for a new one'
const CHANGED = 'What your role can see has changed since you made this file, so it can\'t be downloaded. Run the report again for a new one'
const CANT_CHECK = 'This file can\'t be checked against what your role can see now: the report can\'t be run the same way any more. Run it again for a new one'

const FILE_COLUMNS = 'id, run_id, file_name, format, content_type, storage_key, bytes, row_count, truncated, personal, user_sub, user_email, downloads, last_downloaded_at, expires_at, removed_at, created_at'

export function fileView(row, p) {
  const gone = !!row.removed_at || new Date(row.expires_at).getTime() <= Date.now()
  return {
    id: row.id,
    run_id: row.run_id,
    name: row.file_name,
    format: row.format,
    bytes: Number(row.bytes) || 0,
    rows: row.row_count,
    truncated: !!row.truncated,
    personal: !!row.personal,
    made_at: row.created_at,
    expires_at: row.expires_at,
    removed: gone,
    removed_at: row.removed_at || (gone ? row.expires_at : null),
    mine: row.user_sub === p.sub,
    by: row.user_email,
    downloads: row.downloads || 0,
    last_downloaded_at: row.last_downloaded_at,
    path: '/api/reports/files/' + row.id,
  }
}

// A group's live files may not hold more than GROUP_MB between them.
async function roomLeft(p) {
  const [{ bytes }] = await withTenant(p.tenantId, tx => tx`
    SELECT COALESCE(sum(bytes), 0)::bigint AS bytes FROM report_files
     WHERE tenant_id = ${p.tenantId} AND removed_at IS NULL AND expires_at > now()`)
  if (Number(bytes) >= GROUP_MB * 1024 * 1024) {
    throw httpError(422, 'Your group keeps ' + GROUP_MB + ' MB of report files already. Remove some on Past runs, or wait for old ones to go')
  }
}

/**
 * Make a file of a report, keep it and record its run. `target` is what
 * loadTarget() gives (a saved report or a starter, or an unsaved definition
 * with a name); `body` { format, params, drill } as a download's. Refusals
 * found before the report runs (a drill step, another group's venue) are
 * thrown before anything is recorded, as for a download; anything after is
 * recorded as a failed run, and nothing is kept.
 */
export async function keepReportFile(p, target, body, { log, via = null } = {}) {
  const started = Date.now()
  const prep = await prepareFile(p, target, body)
  await roomLeft(p)
  const base = {
    kind: 'export', format: prep.format, via, saved: target.saved, starter: target.starter,
    name: target.name, spec: target.spec, drill: prep.steps, params: prep.params,
  }
  const key = newKey(AREA, prep.format)
  let written = false
  try {
    const file = await makeReportFile(p, target, prep)
    if (file.stream) {
      const out = await writeStream(key)
      written = true
      await pipeline(file.stream, out)
    } else {
      written = true
      await putBuffer(key, file.buffer ?? Buffer.from(file.text, 'utf8'))
    }
    const made = await file.done
    const bytes = await sizeOf(key)
    const days = made.personal ? PERSONAL_DAYS : FILE_DAYS
    const row = await withTenant(p.tenantId, async tx => {
      const runId = await insertRun(tx, p, { ...base, rows: made.rows, ms: Date.now() - started })
      const [f] = await tx`
        INSERT INTO report_files (tenant_id, run_id, file_name, format, content_type, storage_key, bytes, row_count,
                                  truncated, personal, user_sub, user_email, spec, levels, expires_at)
        VALUES (${p.tenantId}, ${runId}, ${file.name}, ${file.format}, ${file.type}, ${key}, ${bytes ?? 0},
                ${Number.isFinite(made.rows) ? Math.round(made.rows) : null}, ${!!made.truncated}, ${!!made.personal},
                ${p.sub}, ${p.email}, ${tx.json(file.spec)}, ${tx.json(p.levels || {})},
                now() + make_interval(days => ${days}))
        RETURNING ${tx.unsafe(FILE_COLUMNS)}`
      return f
    })
    return row
  } catch (e) {
    // A file left half written, or written with no row to say whose it is, goes.
    if (written && e?.code !== 'EEXIST') await remove(key).catch(() => {})
    await recordRun(p, { ...base, ms: Date.now() - started, error: errorText(e) }, log)
    throw e
  }
}

// What a definition shows a role: the columns it keeps and the notes on what
// it leaves out. Compiled as checkedSpec() does: the day and time zone only
// decide which dates a period means, the same for both sides of a check.
function reachOf(spec, levels, tenantId) {
  try {
    const plan = compileReport(spec, {
      tenantId,
      levels: levels || {},
      params: resolveParams(spec, {}),
      today: todayIn('Europe/London'),
      tz: 'Europe/London',
    })
    const keys = plan.kind === 'list'
      ? (plan.columns || []).map(c => c.key)
      : [
          ...(plan.rows || []).map(r => r.col?.key),
          ...(plan.cols || []).map(c => c.col?.key),
          ...(plan.values || []).filter(v => !v.hidden).map(v => v.key),
        ]
    return JSON.stringify({ keys, notes: [...(plan.notes || [])].sort() })
  } catch {
    return null
  }
}

/**
 * The file row for a download, after the checks: someone else's file is
 * "not found" (it isn't theirs to know about), one past its time or removed
 * is gone (410), and one their role would now see differently is refused
 * (403). Doesn't count the download: the route does that once it can send.
 */
export async function openFile(p, id) {
  if (!UUID_RE.test(String(id || ''))) throw notFound()
  const [row] = await withTenant(p.tenantId, tx => tx`
    SELECT * FROM report_files WHERE tenant_id = ${p.tenantId} AND id = ${String(id)}`)
  if (!row || row.user_sub !== p.sub) throw notFound()
  if (row.removed_at || new Date(row.expires_at).getTime() <= Date.now() || !row.spec) throw httpError(410, GONE)
  const spec = normaliseReport(row.spec)
  const then = reachOf(spec, row.levels, p.tenantId)
  const now = reachOf(spec, p.levels, p.tenantId)
  if (then == null || now == null) throw httpError(403, now == null && then != null ? CHANGED : CANT_CHECK)
  if (then !== now) throw httpError(403, CHANGED)
  return row
}

export async function countDownload(p, id) {
  await withTenant(p.tenantId, tx => tx`
    UPDATE report_files SET downloads = downloads + 1, last_downloaded_at = now()
     WHERE tenant_id = ${p.tenantId} AND id = ${id}`)
}

/** The maker takes their file off before its time: the row stays as a record. */
export async function removeFile(p, id) {
  if (!UUID_RE.test(String(id || ''))) throw notFound()
  const row = await withTenant(p.tenantId, async tx => {
    const [r] = await tx`SELECT id, user_sub, storage_key, removed_at FROM report_files WHERE tenant_id = ${p.tenantId} AND id = ${String(id)}`
    if (!r || r.user_sub !== p.sub) return null
    if (!r.removed_at) {
      await tx`UPDATE report_files SET removed_at = now(), spec = NULL, levels = NULL WHERE tenant_id = ${p.tenantId} AND id = ${r.id}`
    }
    return r
  })
  if (!row) throw notFound()
  await remove(row.storage_key).catch(() => {})
}

/**
 * Hourly: files past their time are removed (the row stays as a record, with
 * the definition and access it was made with cleared), and the store's day
 * folders older than any file is kept: files a crash left with no row.
 */
export async function cleanUpReportFiles() {
  // System mode: every group's files.
  const rows = await systemSql`
    UPDATE report_files SET removed_at = now(), spec = NULL, levels = NULL
     WHERE removed_at IS NULL AND expires_at <= now()
     RETURNING storage_key`
  for (const r of rows) await remove(r.storage_key).catch(() => {})
  const before = addDays(new Date().toISOString().slice(0, 10), -(FILE_DAYS + 2))
  const folders = await removeDaysBefore(AREA, before)
  return { removed: rows.length, folders }
}
