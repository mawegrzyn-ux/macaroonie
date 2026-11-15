// src/reports/runs.js
//
// Past runs (docs/REPORTS.md 14): the reports a person ran, downloaded,
// printed or kept a file of, newest first, with the files they kept. Read
// from report_runs (every run and file is recorded there, migration 243)
// and report_files (migration 250).
//
// Someone with Reports View sees their own runs; Manage can also see
// everyone's (scope 'all'). A kept file can only ever be downloaded by the
// person who made it, so another person's file is listed without a way to
// download it.
//
//   pastRuns(person, query)   { runs, next, can_manage }
//
// query: { scope: 'mine' | 'all', report (a saved report's id or
// 'starter:<key>'), file (a kept file's id: that file's run), files (only
// runs that kept a file), before (the `next` an earlier page gave), limit }.
//
// The choices a run was made with are said in words as the record keeps
// them (access.js recordable()): the period as the dates it meant that day,
// the venues by name, anything typed into a filter only as "a value typed
// in" (the record never keeps typed words).

import { withTenant } from '../config/db.js'
import { httpError } from '../middleware/error.js'
import { CATALOGUE, catalogueView } from './catalogue/index.js'
import { STARTER_PREFIX, starterByKey } from './starters/index.js'
import { rightsOn } from './access.js'
import { fileView } from './files.js'
import { normaliseReport } from '../../../shared/reports/spec.js'
import { paramInputs, paramWords } from '../../../shared/reports/build.js'
import { normalisePeriod, periodText, todayIn } from '../../../shared/reports/period.js'

export const RUNS_PAGE = 50
export const RUNS_MAX = 200

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// A run's created_at as Postgres writes it as text (microseconds kept): the
// page cursor carries it so the next page starts exactly after the last row.
// It goes back as a text parameter (`::text::timestamptz`): a parameter the
// database takes as a timestamptz is written by postgres.js through a JS
// Date, which keeps milliseconds only, and runs made within one millisecond
// of the cursor's would drop off the next page.
const AT_TEXT = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?$/

const FILE_COLUMNS = 'id, run_id, file_name, format, content_type, storage_key, bytes, row_count, truncated, personal, user_sub, user_email, downloads, last_downloaded_at, expires_at, removed_at, created_at'

/** A page cursor: the last row's time and id, so no two runs in one millisecond are skipped. */
const cursorOf = row => Buffer.from(row.at_text + '|' + row.id, 'utf8').toString('base64url')

function readCursor(s) {
  if (s == null || s === '') return null
  let text = ''
  try { text = Buffer.from(String(s), 'base64url').toString('utf8') } catch { text = '' }
  const i = text.lastIndexOf('|')
  const at = i > 0 ? text.slice(0, i) : ''
  const id = i > 0 ? text.slice(i + 1) : ''
  if (!AT_TEXT.test(at) || !UUID_RE.test(id)) throw httpError(400, 'That page of past runs isn\'t one this list gave')
  return { at, id }
}

// What a run did, for the page's words: Ran, Downloaded, File kept, Printed.
function whatOf(run, file) {
  if (run.kind === 'run') return 'ran'
  if (run.format === 'print') return 'printed'
  return file ? 'kept' : 'downloaded'
}

const humanKey = key => {
  const s = String(key || '').replace(/_/g, ' ').trim()
  return s ? s[0].toUpperCase() + s.slice(1) : ''
}
const upperFirst = s => (s ? s[0].toUpperCase() + s.slice(1) : '')
const isVenueList = v => Array.isArray(v) && v.length > 0 && v.every(x => typeof x === 'string' && UUID_RE.test(x))

/**
 * One run's choices in words: [{ key, label, text }]. `inputs` are the
 * report's own choices as it is now (labels, and words for a value the
 * record kept as a number or yes / no), when the report is still there.
 */
function choicesOf(run, { inputs, catalogue, venues }) {
  const kept = run.params?.params || {}
  const byKey = new Map((inputs || []).map(x => [x.key, x]))
  // The day the run was made on, where its venues were: the day its period
  // was worked out from (run.js scopeOf()).
  const ids = Object.values(kept).find(isVenueList)
  const chosen = ids ? venues.filter(v => ids.includes(v.id)) : []
  const tz = (chosen[0] || venues[0])?.timezone || 'Europe/London'
  let today
  try { today = todayIn(tz, new Date(run.created_at)) } catch { today = todayIn('Europe/London', new Date(run.created_at)) }
  const out = []
  for (const [key, value] of Object.entries(kept)) {
    if (value == null) continue
    const input = byKey.get(key)
    let text = ''
    let label = input?.label || null
    if (value && typeof value === 'object' && !Array.isArray(value) && value.set === true) {
      text = 'a value typed in'
    } else if (value === 'all' || isVenueList(value) || input?.type === 'venues') {
      label = label || 'Venues'
      if (!Array.isArray(value) || !value.length) text = 'Every venue'
      else {
        const names = value.map(id => venues.find(v => v.id === id)?.name).filter(Boolean)
        text = names.length ? names.join(', ') : value.length + (value.length === 1 ? ' venue' : ' venues')
      }
    } else if (normalisePeriod(value)) {
      label = label || 'Period'
      text = periodText(value, today)
    } else if (input && (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string')) {
      text = upperFirst(paramWords(catalogue, input, value, { venues }))
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      text = typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)
    }
    if (!text) continue
    out.push({ key, label: label || humanKey(key), text })
  }
  return out
}

/**
 * A page of past runs. Throws 403 for everyone's runs without Manage, 400
 * for a cursor this list didn't give, 404 for another group's report.
 */
export async function pastRuns(p, q = {}) {
  const scope = q.scope === 'all' ? 'all' : 'mine'
  if (scope === 'all' && !p.canManage) throw httpError(403, 'Only people who manage reports can see everyone\'s runs')
  const limit = Math.max(1, Math.min(RUNS_MAX, Math.round(Number(q.limit)) || RUNS_PAGE))
  const before = readCursor(q.before)

  // Which report's runs: a saved report (by its id) or a starter in code.
  let reportId = null
  let starterKey = null
  if (q.report != null && q.report !== '') {
    const ref = String(q.report)
    if (ref.startsWith(STARTER_PREFIX)) {
      starterKey = ref.slice(STARTER_PREFIX.length)
      if (!/^[a-z0-9_]{1,60}$/.test(starterKey)) throw httpError(404, 'Report not found')
    } else if (UUID_RE.test(ref)) reportId = ref.toLowerCase()
    else throw httpError(404, 'Report not found')
  }
  let fileId = null
  if (q.file != null && q.file !== '') {
    if (!UUID_RE.test(String(q.file))) throw httpError(404, 'File not found')
    fileId = String(q.file).toLowerCase()
  }
  const filesOnly = q.files === true || q.files === '1' || q.files === 'true'

  return withTenant(p.tenantId, async tx => {
    const rows = await tx`
      SELECT r.id, r.report_id, r.starter_key, r.report_name, r.subject, r.kind, r.format,
             r.user_sub, r.user_email, r.params, r.row_count, r.ms, r.error, r.created_at,
             r.created_at::text AS at_text
        FROM report_runs r
       WHERE r.tenant_id = ${p.tenantId}
         ${scope === 'mine' ? tx`AND r.user_sub = ${p.sub}` : tx``}
         ${reportId ? tx`AND r.report_id = ${reportId}` : tx``}
         ${starterKey ? tx`AND r.report_id IS NULL AND r.starter_key = ${starterKey}` : tx``}
         ${fileId ? tx`AND r.id = (SELECT f.run_id FROM report_files f WHERE f.tenant_id = ${p.tenantId} AND f.id = ${fileId})` : tx``}
         ${filesOnly ? tx`AND EXISTS (SELECT 1 FROM report_files f WHERE f.tenant_id = ${p.tenantId} AND f.run_id = r.id)` : tx``}
         ${before ? tx`AND (r.created_at, r.id) < (${before.at}::text::timestamptz, ${before.id}::uuid)` : tx``}
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT ${limit + 1}`
    const page = rows.slice(0, limit)
    const runIds = page.map(r => r.id)

    const files = runIds.length ? await tx`
      SELECT ${tx.unsafe(FILE_COLUMNS)} FROM report_files
       WHERE tenant_id = ${p.tenantId} AND run_id = ANY(${runIds}::uuid[])` : []
    const fileOf = new Map(files.map(f => [f.run_id, f]))

    // The saved reports the page names, as they are now: whether the person
    // may open them, and their choices' names.
    const savedIds = [...new Set(page.map(r => r.report_id).filter(Boolean))]
    const saved = savedIds.length ? await tx`
      SELECT id, name, spec, owner_sub, shared, shared_role_ids, is_starter FROM reports
       WHERE tenant_id = ${p.tenantId} AND id = ANY(${savedIds}::uuid[])` : []
    const savedOf = new Map(saved.map(r => [r.id, r]))

    const venues = await tx`
      SELECT id::text AS id, name, COALESCE(NULLIF(timezone, ''), 'Europe/London') AS timezone
        FROM venues WHERE tenant_id = ${p.tenantId} ORDER BY created_at, id`

    const catalogue = catalogueView(p.levels)
    const inputsOf = new Map()
    const inputs = (key, spec) => {
      if (!inputsOf.has(key)) {
        let list = []
        try { list = spec ? paramInputs(catalogue, normaliseReport(spec)) : [] } catch { list = [] }
        inputsOf.set(key, list)
      }
      return inputsOf.get(key)
    }

    const out = page.map(run => {
      const file = fileOf.get(run.id) || null
      const row = run.report_id ? savedOf.get(run.report_id) : null
      const starter = !run.report_id && run.starter_key ? starterByKey(run.starter_key) : null
      const ref = row ? row.id : starter ? starter.ref : null
      const open = row ? rightsOn(row, p).open : !!starter
      const spec = row ? row.spec : starter ? starter.spec : null
      return {
        id: run.id,
        at: run.created_at,
        kind: run.kind,
        format: run.format,
        what: whatOf(run, file),
        report: {
          ref,
          name: run.report_name || row?.name || starter?.name || null,
          // No link for a definition never saved, or a saved report deleted
          // since (its runs keep their name; report_id was cleared with it).
          open,
          subject: run.subject,
          subject_label: CATALOGUE.subjects[run.subject]?.label || null,
          area: CATALOGUE.subjects[run.subject]?.area || null,
        },
        person: { email: run.user_email, mine: run.user_sub === p.sub },
        via: run.params?.via || null,
        rows: run.row_count,
        ms: run.ms,
        error: run.error,
        choices: choicesOf(run, { inputs: ref ? inputs(ref, spec) : [], catalogue, venues }),
        opened_up: Array.isArray(run.params?.drill) && run.params.drill.length > 0,
        file: file ? fileView(file, p) : null,
      }
    })
    return {
      runs: out,
      next: rows.length > limit ? cursorOf(page[page.length - 1]) : null,
      can_manage: p.canManage,
    }
  })
}
