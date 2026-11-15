// src/reports/send.js
//
// Emailing a report (docs/REPORTS.md 14): a schedule's send (the minute
// sweep, src/reports/schedules.js) and Email it now, a report sent once by
// hand. One sender for both, so who may send what, where people's details
// go and what is recorded are decided in one place.
//
// The report runs as one person: the schedule's owner, or whoever pressed
// Email it now. Sending it to themselves needs Use on Reports; to anyone else
// on the team, Manage; to addresses outside the team, Manage and being an
// owner or an admin. Everyone it goes to sees the report as that person's
// role sees it, team members whose own role sees less included (the
// schedule window says so, and so does the email), except that addresses
// outside the team never get people's details (columns the catalogue marks
// pii) unless the schedule says so (personal_outside, owners and admins
// only): a list leaves those columns out, and a summary grouped by people
// isn't sent outside at all.
//
// Each send is one report_runs row: kind 'scheduled' (by a schedule) or
// 'emailed' (by hand), format the file attached or 'email', and in
// `delivery` how many it went to, how many failed and why, with every
// address masked (s***@example.com). A kept file is a report_files row on
// that run (keepMadeFile()). Nothing here throws once the checks are done:
// deliver() answers with a status the sweep and the routes act on.
//
//   requestPerson(req)            reportPerson() plus whether they are an
//                                 owner or an admin (Email it now, saving a
//                                 schedule)
//   ownerPerson(tenantId, sub)    the same for a schedule's owner, or null
//                                 when they aren't an active member any more
//   prepareSend(person, target, opts)
//                                 the checks before anything runs; throws
//                                 403 / 404 / 422; the plan deliver() takes
//   deliver(person, target, plan, opts)
//                                 run, check the condition, email, keep the
//                                 file, record: { status, error, ... }
//   tellPaused(schedule, reason)  email the schedule's owner and the group's
//                                 owners that it has paused, and why
//   maskEmail(email)              s***@example.com
//
// An email holds at most EMAIL_ROWS rows of the table; an attached list at
// most LIST_CAP rows (a file over MAX_ATTACH_MB isn't attached, but can
// still be kept).

import { withTenant } from '../config/db.js'
import { env } from '../config/env.js'
import { httpError } from '../middleware/error.js'
import { reportPerson, runsFor, refuseOtherVenues, insertRun } from './access.js'
import { runReport, reportZone } from './run.js'
import { csvOf, hasPersonal } from './export/csv.js'
import { xlsxOf, XLSX_CELLS } from './export/xlsx.js'
import { fileName } from './export/table.js'
import { CSV_TYPE, XLSX_TYPE, errorText, venuesText } from './export/file.js'
import { keepMadeFile } from './files.js'
import { sendEmail, emailCredentials } from '../services/emailSvc.js'
import { officeOrigin } from '../services/platformHost.js'
import { CATALOGUE } from './catalogue/index.js'
import { tableModel, listCount } from '../../../shared/reports/table.js'
import { resolvePath } from '../../../shared/reports/paths.js'
import { resolveParams } from '../../../shared/reports/spec.js'
import { todayIn } from '../../../shared/reports/period.js'
import {
  normaliseDelivery, deliveryProblem, normaliseCondition, conditionProblem, conditionMet,
  normaliseRecipients, recipientsProblem, periodProblem, timingText,
} from '../../../shared/reports/schedule.js'

export const EMAIL_ROWS = 100
export const LIST_CAP = 20000
export const MAX_ATTACH_MB = 5
const SEND_BATCH = 5
const SEND_MS = 20000
const OWNER_ADMIN = new Set(['owner', 'admin'])
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const REF_RE = /^[A-Za-z0-9:_-]+$/
const PII_HELD = 'This report shows people\'s details, which aren\'t sent to addresses outside the team'

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const plural = (n, one, many) => n.toLocaleString('en-GB') + ' ' + (n === 1 ? one : many)

/** An address with its name hidden: s***@example.com. */
export function maskEmail(email) {
  const s = String(email || '')
  const at = s.lastIndexOf('@')
  if (at < 1) return s ? s[0] + '***' : ''
  return s[0] + '***' + s.slice(at)
}
// Any address in a provider's error words, masked.
const maskEmails = text => String(text || '').replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, maskEmail)

/* ------------------------------------------------------------------ people */

// An active member's address and the role their access comes from: a custom
// role's key (never owner or admin, which are the built-in rows' keys), else
// the built-in role.
async function member(tenantId, sub) {
  if (!tenantId || !sub) return null
  const [row] = await withTenant(tenantId, tx => tx`
    SELECT u.email, COALESCE(r.key, u.role::text) AS role_key
      FROM users u
 LEFT JOIN tenant_roles r ON r.id = u.custom_role_id AND r.tenant_id = u.tenant_id
     WHERE u.tenant_id = ${tenantId} AND u.auth0_user_id = ${sub} AND u.is_active = true
     LIMIT 1`)
  return row || null
}

/** The person asking, as a report sender: reportPerson() and isOwnerOrAdmin. */
export async function requestPerson(req) {
  const p = await reportPerson(req)
  if (req.isPlatformAdmin) return { ...p, isOwnerOrAdmin: true }
  const m = await member(req.tenantId, req.user?.sub)
  return { ...p, isOwnerOrAdmin: !!m && OWNER_ADMIN.has(m.role_key) }
}

/**
 * A schedule's owner as a report sender, from their users row: what their
 * role can see now. Null when they aren't an active member of the group any
 * more (the schedule then pauses).
 */
export async function ownerPerson(tenantId, sub) {
  const m = await member(tenantId, sub)
  if (!m) return null
  const p = await reportPerson({ tenantId, user: { sub, email: m.email }, isPlatformAdmin: false })
  return { ...p, isOwnerOrAdmin: OWNER_ADMIN.has(m.role_key) }
}

// Who a list of recipients is now: team members by their user id or their
// address (each address once), and addresses outside the team. People no
// longer on the team are counted, never sent to.
async function resolveRecipients(tenantId, list) {
  const recips = normaliseRecipients(list)
  const ids = recips.filter(r => r.user_id).map(r => r.user_id)
  const emails = recips.filter(r => r.email).map(r => r.email)
  const team = await withTenant(tenantId, tx => tx`
    SELECT id::text AS id, lower(btrim(email)) AS email, auth0_user_id AS sub
      FROM users
     WHERE tenant_id = ${tenantId} AND is_active = true AND email IS NOT NULL
       AND (id = ANY(${ids}::uuid[]) OR lower(btrim(email)) = ANY(${emails}::text[]))`)
  const byId = new Map(team.map(u => [u.id, u]))
  const byEmail = new Map(team.map(u => [u.email, u]))
  const to = []
  const seen = new Set()
  let skipped = 0
  for (const r of recips) {
    const u = r.user_id ? byId.get(r.user_id) : byEmail.get(r.email)
    if (r.user_id && !u) { skipped++; continue }
    const item = u ? { email: u.email, outside: false, user_id: u.id, sub: u.sub } : { email: r.email, outside: true }
    if (seen.has(item.email)) continue
    seen.add(item.email)
    to.push(item)
  }
  return { to, skipped }
}

const isSelf = (p, r) => (!!r.sub && r.sub === p.sub) || (!!p.email && r.email === String(p.email).trim().toLowerCase())

// Whether a report can't go outside the team without people's details: a
// summary or a table across grouped by people, or a list of nothing else.
const piiField = (spec, path) => !!resolvePath(CATALOGUE, spec.subject, path)?.def?.pii
function heldOutside(spec) {
  if (spec.kind === 'list') return spec.rows.length > 0 && spec.rows.every(r => piiField(spec, r.field))
  return [...spec.rows, ...(spec.columns || [])].some(r => piiField(spec, r.field))
}

/* ------------------------------------------------------------------ checks */

/**
 * The checks before a send, as the person it runs as: what they may send to
 * whom, what the report asks for, and for a schedule that its period moves
 * with the date. `opts` { kind 'scheduled' | 'emailed', recipients,
 * delivery, condition, params, personalOutside, name, message }. Throws 403
 * / 404 / 422 with a sentence; returns the plan deliver() takes.
 */
export async function prepareSend(p, target, opts = {}) {
  const kind = opts.kind === 'scheduled' ? 'scheduled' : 'emailed'
  const spec = target.spec
  if (!p.canUse) throw httpError(403, (kind === 'scheduled' ? 'Scheduling' : 'Emailing') + ' reports needs Use on Reports')
  if (!runsFor(spec.subject, p.levels).runs) {
    throw httpError(403, 'Your role can\'t report on ' + (CATALOGUE.subjects[spec.subject]?.label || 'this'))
  }
  const delivery = normaliseDelivery(opts.delivery)
  const condition = normaliseCondition(opts.condition)
  const bad = deliveryProblem(delivery) || conditionProblem(condition, spec.kind, spec.values) || recipientsProblem(opts.recipients)
  if (bad) throw httpError(422, bad)
  const { to, skipped } = await resolveRecipients(p.tenantId, opts.recipients)
  if (!to.length) throw httpError(422, 'None of the people picked are on the team any more')
  if (to.some(r => !isSelf(p, r)) && !p.canManage) {
    throw httpError(403, 'Sending a report to other people needs Manage on Reports. You can send it to yourself')
  }
  if (to.some(r => r.outside) && !(p.canManage && p.isOwnerOrAdmin)) {
    throw httpError(403, 'Only an owner or an admin can send reports to addresses outside the team')
  }
  const personalOutside = opts.personalOutside === true
  if (personalOutside && !p.isOwnerOrAdmin) {
    throw httpError(403, 'Only an owner or an admin can send people\'s details outside the team')
  }
  if (to.every(r => r.outside) && !personalOutside && heldOutside(spec)) {
    throw httpError(422, PII_HELD + '. Send it to someone on the team as well, or let people\'s details go outside the team')
  }
  const params = opts.params && typeof opts.params === 'object' ? opts.params : {}
  await refuseOtherVenues(p, spec, params)
  if (kind === 'scheduled') {
    const why = periodProblem(spec, params, todayIn(await reportZone(p.tenantId, spec, params)))
    if (why) throw httpError(422, why)
  }
  return {
    kind, to, skipped, delivery, condition, params, personalOutside,
    name: typeof opts.name === 'string' ? opts.name.trim().slice(0, 120) || null : null,
    message: typeof opts.message === 'string' ? opts.message.trim().slice(0, 1000) || null : null,
  }
}

/* ------------------------------------------------------------------ sender */

// Whose email settings send it: the report's venue with email set up (for a
// report across venues, the first chosen venue with email set up, then any
// venue with it, then the group's main one); and the group's name. No
// report (a notice): any venue with email set up.
export async function mailSender(tenantId, spec = null, params = {}) {
  const vp = (spec?.params || []).find(x => x.type === 'venues')
  const chosen = vp && Array.isArray(params?.[vp.key]) ? params[vp.key].filter(id => UUID_RE.test(String(id))) : []
  const all = chosen.length === 0
  return withTenant(tenantId, async tx => {
    const [v] = await tx`
      SELECT v.id FROM venues v
   LEFT JOIN venue_email_settings s ON s.venue_id = v.id AND s.tenant_id = v.tenant_id
   LEFT JOIN tenant_site ts ON ts.tenant_id = v.tenant_id
       WHERE v.tenant_id = ${tenantId}
    ORDER BY ((${all} OR v.id = ANY(${chosen}::uuid[])) AND s.email_provider IS NOT NULL) DESC,
             (s.email_provider IS NOT NULL) DESC,
             (${all} OR v.id = ANY(${chosen}::uuid[])) DESC,
             (v.id = ts.default_widget_venue_id) DESC NULLS LAST,
             v.created_at, v.id
       LIMIT 1`
    const [settings] = v ? await tx`SELECT * FROM venue_email_settings WHERE tenant_id = ${tenantId} AND venue_id = ${v.id}` : []
    const [names] = await tx`
      SELECT COALESCE(NULLIF(btrim(ts.brand_name), ''), NULLIF(btrim(ts.site_name), ''), t.name) AS business
        FROM tenants t LEFT JOIN tenant_site ts ON ts.tenant_id = t.id
       WHERE t.id = ${tenantId}`
    return { settings: settings || null, business: names?.business || 'Macaroonie' }
  })
}

// How many rows of a list the run reads: what the email shows, or what the
// file holds (an Excel file kept under its cells).
function capOf(spec, delivery) {
  if (spec.kind !== 'list') return null
  if (delivery.attach === 'none') return EMAIL_ROWS
  if (delivery.attach === 'csv') return LIST_CAP
  return Math.min(LIST_CAP, Math.max(1000, Math.floor(XLSX_CELLS / Math.max(1, spec.rows.length + 1))))
}

// The copy for addresses outside the team: a list without the columns with
// people's details; a summary grouped by them can't go at all.
function outsideCopy(result) {
  const spec = result.spec
  if (result.kind === 'list') {
    const keep = result.columns.map((c, i) => (c.pii ? -1 : i)).filter(i => i >= 0)
    if (keep.length === result.columns.length) return { result, note: null }
    if (!keep.length) return { result: null, note: PII_HELD }
    const pick = cells => (Array.isArray(cells) ? keep.map(i => cells[i]) : cells)
    return {
      result: {
        ...result,
        columns: keep.map(i => result.columns[i]),
        rows: result.rows.map(r => ({ ...r, cells: pick(r.cells) })),
        totals: result.totals ? { ...result.totals, cells: pick(result.totals.cells) } : result.totals,
      },
      note: 'Columns with people\'s details are left out of copies sent outside the team',
    }
  }
  const rowPii = result.columns.some(c => c.role === 'row' && c.pii)
  const acrossPii = (spec?.columns || []).some(c => resolvePath(CATALOGUE, spec.subject, c.field)?.def?.pii)
  return rowPii || acrossPii ? { result: null, note: PII_HELD } : { result, note: null }
}

// A file of a result for the email (and to keep): { buffer, format, type,
// name } or { note } when it can't be made.
function fileOf(result, attach, about, when) {
  if (attach === 'csv') return { buffer: Buffer.from(csvOf(result), 'utf8'), format: 'csv', type: CSV_TYPE, name: fileName(about.name, 'csv', when) }
  if (result.rows.length * Math.max(1, result.columns.length) > XLSX_CELLS * 2) {
    return { note: 'The report is too big for an Excel file, so none is attached. Download it as CSV in Macaroonie' }
  }
  return { buffer: xlsxOf(result, about), format: 'xlsx', type: XLSX_TYPE, name: fileName(about.name, 'xlsx', when) }
}

// The report's own notes say "your role": to anyone but the person it runs
// as, that is the sender's role.
const notesFor = (notes, own) => (own ? notes : notes.map(n => n
  .replace(/\bYour role\b/g, 'The sender\'s role').replace(/\byour role\b/g, 'the sender\'s role')))

function tableHtml(model) {
  const th = 'padding:6px 8px;border-bottom:2px solid #d4d4d8;background:#fafafa;font-weight:bold;color:#18181b;'
  const head = model.head.map(row => '<tr>' + row.map(c => '<th'
    + (c.span > 1 ? ' colspan="' + c.span + '"' : '') + (c.depth > 1 ? ' rowspan="' + c.depth + '"' : '')
    + ' style="' + th + 'text-align:' + (c.banner ? 'center' : model.align[c.i]) + '">' + esc(c.label) + '</th>').join('') + '</tr>').join('')
  const td = (i, extra) => ' style="padding:5px 8px;border-bottom:1px solid #e4e4e7;text-align:' + model.align[i] + ';'
    + (model.align[i] === 'right' ? 'white-space:nowrap;' : '') + extra + '"'
  const body = model.rows.map(row => {
    const look = row.kind === 'subtotal' ? 'font-weight:bold;background:#f4f4f5;' : row.kind === 'rest' ? 'color:#52525b;font-style:italic;' : ''
    return '<tr>' + row.cells.map((t, i) => '<td' + td(i, look) + '>' + esc(t) + '</td>').join('') + '</tr>'
  }).join('')
  const total = model.total
    ? '<tr>' + model.total.map((t, i) => '<td' + td(i, 'font-weight:bold;border-top:2px solid #a1a1aa;border-bottom:none;') + '>' + esc(t) + '</td>').join('') + '</tr>'
    : ''
  return '<div style="overflow-x:auto;margin:0 0 12px"><table cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;color:#27272a">'
    + '<thead>' + head + '</thead><tbody>' + body + total + '</tbody></table></div>'
}

function emailHtml(v) {
  const p = (text, style = '') => '<p style="margin:0 0 12px;font-size:14px;line-height:1.5;' + style + '">' + text + '</p>'
  const facts = v.facts.length
    ? '<table role="presentation" cellpadding="0" cellspacing="0" style="font-size:13px;color:#3f3f46;margin:0 0 16px">'
      + v.facts.map(([k, t]) => '<tr><td style="padding:2px 16px 2px 0;color:#71717a;vertical-align:top">' + esc(k) + '</td><td style="padding:2px 0">' + esc(t) + '</td></tr>').join('')
      + '</table>'
    : ''
  return '<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f5">'
    + '<div style="max-width:760px;margin:0 auto;padding:24px 16px;font-family:Arial,Helvetica,sans-serif;color:#18181b">'
    + '<div style="background:#ffffff;border:1px solid #e4e4e7;border-radius:8px;padding:20px">'
    + '<p style="margin:0 0 4px;font-size:13px;color:#52525b">' + esc(v.business) + '</p>'
    + '<h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;color:#18181b">' + esc(v.title) + '</h1>'
    + (v.message ? p(esc(v.message).replace(/\r?\n/g, '<br>')) : '')
    + facts
    + (v.table || '')
    + (v.lines || []).map(t => p(esc(t), 'color:#3f3f46')).join('')
    + (v.notes.length
      ? '<ul style="margin:0 0 12px;padding-left:18px;font-size:13px;color:#52525b;line-height:1.5">' + v.notes.map(n => '<li>' + esc(n) + '</li>').join('') + '</ul>'
      : '')
    + (v.link
      ? '<p style="margin:16px 0 12px"><a href="' + esc(v.link) + '" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px;font-size:14px">' + esc(v.linkText || 'Open the report') + '</a></p>'
      : '')
    + '</div>'
    + v.footer.map(t => '<p style="margin:12px 4px 0;font-size:12px;line-height:1.5;color:#71717a">' + esc(t) + '</p>').join('')
    + '</div></body></html>'
}

const withTimeout = (promise, ms) => {
  let timer
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const e = new Error('The email service didn\'t answer in time')
      e.timeout = true
      reject(e)
    }, ms)
  })
  return Promise.race([promise, late]).finally(() => clearTimeout(timer))
}

// Whether a failed send may work if tried again: a time-out, a provider that
// is busy or down (429, 5xx), or the network. A refusal (a bad key, a bad
// address) won't.
export function transientSend(e) {
  if (!e) return false
  if (e.timeout) return true
  const m = /\b(?:SendGrid|Postmark|Mailgun) (\d{3})\b/.exec(String(e.message || ''))
  if (m) return m[1] === '429' || m[1].startsWith('5')
  const status = e.$metadata?.httpStatusCode ?? e.statusCode ?? e.status
  if (Number.isInteger(status)) return status === 429 || status >= 500
  if (Number.isInteger(e.responseCode)) return e.responseCode >= 400 && e.responseCode < 500
  return e.name === 'TypeError'
    || ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET'].includes(e.code || e.cause?.code)
}

// One email per address, a few at a time, each with a time limit.
async function sendAll(list, make) {
  const out = []
  for (let i = 0; i < list.length; i += SEND_BATCH) {
    const batch = list.slice(i, i + SEND_BATCH)
    const done = await Promise.allSettled(batch.map(r => withTimeout(Promise.resolve().then(() => make(r)), SEND_MS)))
    done.forEach((x, j) => out.push({ r: batch[j], ok: x.status === 'fulfilled', err: x.status === 'rejected' ? x.reason : null }))
  }
  return out
}

/* --------------------------------------------------------------- deliver */

/**
 * Run the report as `p` (at `due`, a schedule's due time: its "today"),
 * check the condition (unless `ignoreCondition`, Send now), email it to
 * each address and keep the file when asked. Records one report_runs row
 * whatever happens. Never throws. Returns { status: 'sent' | 'partly' |
 * 'failed' | 'not_met', error, transient (worth trying again), refused (the
 * owner can't run it: pause), runId, to, sent, failed, held, kept, why }.
 */
export async function deliver(p, target, plan, { schedule = null, due = null, log = null, ignoreCondition = false } = {}) {
  const started = Date.now()
  const spec = target.spec
  const when = due instanceof Date ? due : new Date()
  const base = {
    kind: plan.kind,
    format: plan.delivery.attach === 'none' ? 'email' : plan.delivery.attach,
    saved: target.saved, starter: target.starter, name: target.name, spec,
    params: resolveParams(spec, plan.params),
    schedule_id: schedule?.id ?? null,
  }
  const counts = { to: plan.to.length, outside: plan.to.filter(r => r.outside).length, skipped: plan.skipped || 0 }
  const record = async run => {
    try {
      return await withTenant(p.tenantId, tx => insertRun(tx, p, run))
    } catch (err) {
      log?.warn({ err }, 'A report send wasn\'t recorded')
      return null
    }
  }

  // The run.
  let result
  try {
    const cap = capOf(spec, plan.delivery)
    result = await runReport({ ...p.ctx, at: due || null }, spec, plan.params, { mode: 'export', fresh: true, ...(cap ? { cap } : {}) })
  } catch (e) {
    const error = errorText(e)
    const code = e?.statusCode
    const runId = await record({ ...base, ms: Date.now() - started, error, delivery: { ...counts, sent: 0, failed: 0, not_run: true } })
    return {
      status: 'failed', error, runId, to: counts.to, sent: 0, failed: 0, held: 0, kept: false,
      transient: !code || code === 429 || code >= 500, refused: code === 403,
    }
  }
  const rows = result.kind === 'list' ? listCount(result) : result.rows.length
  const meta = result.meta || {}

  // The condition.
  const forced = ignoreCondition && plan.condition.when !== 'always'
  if (!ignoreCondition) {
    const c = conditionMet(plan.condition, result)
    if (!c.met) {
      const runId = await record({ ...base, rows, ms: Date.now() - started, delivery: { ...counts, sent: 0, failed: 0, not_met: true, why: c.why } })
      return { status: 'not_met', error: null, why: c.why, runId, to: counts.to, sent: 0, failed: 0, held: 0, kept: false, transient: false, refused: false }
    }
  }

  // What is sent: the team's copy, and the copy for addresses outside the team.
  const sender = await mailSender(p.tenantId, spec, plan.params)
  const title = plan.name || target.name || 'Report'
  const venues = await venuesText(p, spec, base.params).catch(() => null)
  const outside = counts.outside && !plan.personalOutside ? outsideCopy(result) : { result, note: null }
  const sendNotes = []
  const shown = (r, total) => (r.kind === 'list' ? listCount(r) : total)

  const copyOf = (res, extraNotes) => {
    if (!res) return null
    const fileNotes = []
    if (res.kind === 'list' && meta.truncated && plan.delivery.attach !== 'none') {
      fileNotes.push('The file holds the first ' + plural(res.rows.length, 'row', 'rows') + ' of ' + listCount(res).toLocaleString('en-GB') + '. Download the report in Macaroonie for them all')
    }
    let file = null
    if (plan.delivery.attach !== 'none') {
      file = fileOf(res, plan.delivery.attach, { name: title, description: target.description, venues, by: p.email, notes: [...extraNotes, ...fileNotes] }, when)
      if (file.note) { fileNotes.push(file.note); file = null }
    }
    const attach = file && file.buffer.length <= MAX_ATTACH_MB * 1024 * 1024
    if (file && !attach) {
      fileNotes.push('The file is over ' + MAX_ATTACH_MB + ' MB, so it isn\'t attached' + (plan.delivery.keep_file ? ': it is kept in Past runs in Macaroonie' : ': open the report in Macaroonie to download it'))
    }
    return { result: res, file, attach, extraNotes, fileNotes }
  }
  const team = copyOf(result, [])
  const outCopy = counts.outside
    ? (outside.result === result ? team : copyOf(outside.result, outside.note ? [outside.note] : []))
    : null
  const held = counts.outside && !outCopy ? plan.to.filter(r => r.outside) : []
  if (held.length) sendNotes.push(plural(held.length, 'address', 'addresses') + ' outside the team got nothing: ' + PII_HELD.charAt(0).toLowerCase() + PII_HELD.slice(1))
  if (counts.skipped) sendNotes.push(plural(counts.skipped, 'person is', 'people are') + ' no longer on the team, so they weren\'t sent it')

  const link = REF_RE.test(String(target.ref || '')) ? officeOrigin() + '/reports/' + target.ref : null
  const facts = [
    ...(meta.period ? [['Period', meta.period.text || meta.period.from + ' to ' + meta.period.to]] : []),
    ...(meta.compare ? [['Compared with', meta.compare.text || meta.compare.from + ' to ' + meta.compare.to]] : []),
    ...(venues ? [['Venues', venues]] : []),
  ]
  const subject = title + (meta.period?.text ? ': ' + meta.period.text : '')
  const schedText = schedule ? 'Schedule: ' + timingText(schedule.timing) + '.' : null
  const owner = p.email || 'Someone at ' + sender.business

  const htmlFor = (variant, copy) => {
    const res = copy.result
    let table = null
    const lines = []
    const notes = [...notesFor(meta.notes || [], variant === 'owner'), ...copy.extraNotes]
    if (plan.delivery.in_message) {
      if (!res.rows.length) {
        lines.push('There was nothing to report for this period.')
      } else {
        const model = tableModel({ ...res, rows: res.rows.slice(0, EMAIL_ROWS) })
        table = tableHtml(model)
        const total = shown(res, res.rows.length)
        if (total > model.rows.length) {
          notes.push('The email shows the first ' + plural(model.rows.length, 'row', 'rows') + ' of ' + total.toLocaleString('en-GB')
            + (copy.attach ? '. The attached file has more' : '. Open the report in Macaroonie for the rest'))
        }
      }
    } else if (copy.attach) {
      lines.push('The report is attached as ' + (copy.file.format === 'csv' ? 'a CSV file' : 'an Excel file') + '.')
    }
    notes.push(...copy.fileNotes)
    const footer = []
    if (variant === 'owner') {
      footer.push(schedule ? 'You get this report by email. ' + schedText + ' Change or stop it on the report\'s page in Macaroonie.' : 'You sent this from Macaroonie.')
    } else if (variant === 'team') {
      footer.push(owner + (schedule ? ' set this up in Macaroonie. ' + schedText : ' sent this from Macaroonie.') + ' It shows the report as their role sees it.')
    } else {
      footer.push(owner + ' at ' + sender.business + (schedule ? ' sends you this report from Macaroonie. ' + schedText : ' sent you this report from Macaroonie.'))
    }
    return emailHtml({
      business: sender.business, title, message: plan.message, facts, table, lines, notes,
      link: variant === 'outside' ? null : link, footer,
    })
  }

  // The emails.
  const { provider, credentials } = emailCredentials(sender.settings, env)
  const from = { name: sender.settings?.from_name || sender.business, email: sender.settings?.from_email || env.EMAIL_FROM }
  const replyTo = p.email || sender.settings?.reply_to || null
  const pages = new Map()
  const variantOf = r => (r.outside ? 'outside' : isSelf(p, r) ? 'owner' : 'team')
  const targets = plan.to.filter(r => !held.includes(r))
  const outcome = await sendAll(targets, r => {
    const variant = variantOf(r)
    const copy = variant === 'outside' ? outCopy : team
    if (!pages.has(variant)) pages.set(variant, htmlFor(variant, copy))
    return sendEmail({
      provider, credentials, from, to: r.email, replyTo, subject, html: pages.get(variant),
      ...(copy.attach ? { attachments: [{ filename: copy.file.name, contentType: copy.file.type, content: copy.file.buffer }] } : {}),
    })
  })
  const failures = outcome.filter(o => !o.ok)
  for (const f of failures) log?.warn({ err: f.err }, 'A report email wasn\'t sent')
  const sent = outcome.length - failures.length
  const firstError = failures.length ? maskEmails(failures[0].err?.message || 'The email wasn\'t sent').slice(0, 300) : null
  let status
  let error = null
  if (!targets.length) {
    status = 'failed'
    error = PII_HELD
  } else if (!sent) {
    status = 'failed'
    error = firstError
  } else if (failures.length || held.length) {
    status = 'partly'
    error = failures.length
      ? 'Sent to ' + sent + ' of ' + plan.to.length + ': ' + firstError
      : 'Sent to ' + sent + ' of ' + plan.to.length + ': ' + PII_HELD.charAt(0).toLowerCase() + PII_HELD.slice(1)
  } else {
    status = 'sent'
  }
  const transient = status === 'failed' && !!targets.length && failures.every(f => transientSend(f.err))

  const deliveryRec = {
    ...counts,
    sent,
    failed: failures.length,
    held: held.length,
    to_hint: plan.to.slice(0, 10).map(r => maskEmail(r.email)),
    failed_to: failures.slice(0, 10).map(f => maskEmail(f.r.email)),
    attach: plan.delivery.attach,
    in_message: plan.delivery.in_message,
    kept: false,
    notes: [...sendNotes, ...team.fileNotes].slice(0, 10),
    ...(forced ? { forced: true } : {}),
  }
  const run = { ...base, rows, ms: Date.now() - started, error: status === 'sent' ? null : error }

  // The file, kept with its run.
  let runId = null
  let kept = false
  if (plan.delivery.keep_file && team.file && sent) {
    try {
      const made = await keepMadeFile(p, { ...run, delivery: { ...deliveryRec, kept: true } }, {
        buffer: team.file.buffer, name: team.file.name, format: team.file.format, type: team.file.type,
        rows, truncated: !!meta.truncated, personal: hasPersonal(result.columns), spec,
      })
      runId = made.runId
      kept = true
    } catch (e) {
      if (e?.statusCode === 422) deliveryRec.notes.push('The file wasn\'t kept: ' + e.message)
      else {
        log?.warn({ err: e }, 'A report file wasn\'t kept')
        deliveryRec.notes.push('The file couldn\'t be kept')
      }
    }
  }
  if (!kept) runId = await record({ ...run, delivery: deliveryRec })
  return {
    status, error: status === 'sent' ? null : error, transient,
    // Nothing could go to anyone: it won't go next time either.
    refused: !targets.length,
    runId, to: plan.to.length, sent, failed: failures.length, held: held.length, kept, why: null,
  }
}

/* ------------------------------------------------------------- notices */

/**
 * Tell the schedule's owner (while they are on the team) and the group's
 * owners that a schedule has paused and why, so someone can put it right.
 * Best effort: never throws. Returns how many were told.
 */
export async function tellPaused(schedule, reason, { title = null, log = null } = {}) {
  try {
    const people = await withTenant(schedule.tenant_id, tx => tx`
      SELECT DISTINCT lower(btrim(u.email)) AS email
        FROM users u
   LEFT JOIN tenant_roles r ON r.id = u.custom_role_id AND r.tenant_id = u.tenant_id
       WHERE u.tenant_id = ${schedule.tenant_id} AND u.is_active = true AND u.email IS NOT NULL
         AND (COALESCE(r.key, u.role::text) = 'owner' OR u.auth0_user_id = ${schedule.owner_sub})`)
    if (!people.length) return 0
    const sender = await mailSender(schedule.tenant_id)
    const name = schedule.name || title || 'A report schedule'
    const html = emailHtml({
      business: sender.business,
      title: 'A report schedule has paused',
      message: null,
      facts: [
        ['Schedule', name],
        ...(schedule.owner_email ? [['Set up by', schedule.owner_email]] : []),
        ['When', timingText(schedule.timing)],
        ['Why', reason],
      ],
      table: null,
      lines: ['It won\'t send again until someone puts it right and resumes it in Macaroonie.'],
      notes: [],
      link: officeOrigin() + '/reports/schedules',
      linkText: 'Open report schedules',
      footer: ['You get this because you are an owner of ' + sender.business + ' in Macaroonie, or you set this schedule up.'],
    })
    const { provider, credentials } = emailCredentials(sender.settings, env)
    const from = { name: sender.settings?.from_name || sender.business, email: sender.settings?.from_email || env.EMAIL_FROM }
    const outcome = await sendAll(people, r => sendEmail({
      provider, credentials, from, to: r.email, subject: 'Report schedule paused: ' + name, html,
    }))
    for (const o of outcome) if (!o.ok) log?.warn({ err: o.err }, 'A paused schedule notice wasn\'t sent')
    return outcome.filter(o => o.ok).length
  } catch (err) {
    log?.warn({ err }, 'A paused schedule notice wasn\'t sent')
    return 0
  }
}

