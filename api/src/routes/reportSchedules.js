// src/routes/reportSchedules.js
//
// Report schedules and Email it now (docs/REPORTS.md 14, 18; migration 251),
// mounted at /api/reports beside src/routes/reports.js. Who may send what to
// whom, and the sending itself, is src/reports/send.js; the minute sweep that
// sends what is due is src/reports/schedules.js.
//
//   GET    /recipients               who the person can send a report to:
//                                    their own address, the team (Manage),
//                                    and whether addresses outside the team
//                                    are allowed (Use)
//   GET    /schedules                the person's schedules, or everyone's
//                                    (scope=all, Manage); report=<id> for one
//                                    report's (View)
//   GET    /:id/schedules            one report's schedules: the person's
//                                    own, every one with Manage (View)
//   POST   /:id/schedules            schedule a report (Use; to anyone else,
//                                    Manage; outside the team, an owner or
//                                    an admin with Manage)
//   GET    /schedules/:scheduleId    one schedule (its owner, or Manage)
//   PATCH  /schedules/:scheduleId    change it (its owner, or Manage: someone
//                                    else's becomes the changer's own)
//   DELETE /schedules/:scheduleId    delete it (its owner, or Manage)
//   POST   /schedules/:scheduleId/pause    stop it until someone resumes it
//   POST   /schedules/:scheduleId/resume   start it again, checked as its owner
//   POST   /schedules/:scheduleId/send     send it now, whatever its
//                                    condition, as its owner; its next run
//                                    stays as it was
//   POST   /:id/send                 Email it now: run the report and email
//                                    it once, as the person asking (Use)
//
// A schedule runs as its owner, checked at every run (the sweep). Saving one
// checks it as it will run, so a schedule that would pause at its first run
// is refused instead; and changing someone else's makes it the changer's
// own, because it then sends what the changer's role sees (`takes_over`
// says so beforehand). A send that went to nobody answers 422 (code
// not_sent) with why; one that reached anyone answers its status and counts.
// Every send is recorded in Past runs either way.
//
// Saving, changing, resuming and both sends take `dry_run: true`: every
// check runs as for real and the answer is what would be saved or sent
// (`{ dry_run: true, schedule }`, or `{ dry_run: true, send }` for Email it
// now), so a confirm card (Pepper's) can name who it goes to. Nothing is
// written or sent, and a dry run of Send now takes no hold.

import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requirePermission } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { CATALOGUE, catalogueView } from '../reports/catalogue/index.js'
import { STARTER_PREFIX, starterByKey } from '../reports/starters/index.js'
import { limitPepperRuns, runsFor } from '../reports/access.js'
import { loadTarget, loadTargets } from '../reports/target.js'
import { reportZone } from '../reports/run.js'
import { requestPerson, ownerPerson, prepareSend, deliver, pushOf } from '../reports/send.js'
import { seal } from '../services/vault.js'
import { newPushSecret } from '../services/webPush.js'
import { pdfAvailable } from '../services/pdfBrowser.js'
import { viaPepper } from './reports.js'
import { normaliseReport, resolveParams, venueScope } from '../../../shared/reports/spec.js'
import { paramInputs, paramWords, valueName, valueType } from '../../../shared/reports/build.js'
import { NUMERIC_TYPES } from '../../../shared/reports/format.js'
import { periodName } from '../../../shared/reports/period.js'
import {
  normaliseTiming, timingProblem, nextRunAt, timingText, normaliseDelivery, deliveryText,
  normaliseCondition, conditionText, normaliseRecipients, MAX_RECIPIENTS,
} from '../../../shared/reports/schedule.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STARTER_KEY = /^[a-z0-9_]{1,60}$/
export const MAX_SCHEDULES = 50      // schedules per person
const MAX_LISTED = 1000
const MAX_PARAMS_TEXT = 20000        // a schedule's choices, as JSON
const LEASE_MINUTES = 10             // as the sweep holds one it sends
const BUSY = 'It is being sent right now. Try again in a minute'

const Part = z.record(z.any())
const Name = z.string().trim().max(120).nullable().optional()
const Message = z.string().max(1000).nullable().optional()
const Recipients = z.array(Part).max(200)
const AlertsQuery = z.object({ venue_id: z.string().uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
const DryRun = z.boolean().optional()
const ScheduleBody = z.object({
  dry_run: DryRun,
  name: Name,
  message: Message,
  timing: Part,
  params: Part.optional(),
  delivery: Part.optional(),
  condition: Part.optional(),
  recipients: Recipients,
  personal_outside: z.boolean().optional(),
  push_url: z.string().trim().max(500).nullable().optional(),
  new_push_secret: z.boolean().optional(),
})
const ScheduleEdit = ScheduleBody.partial()
const SendBody = z.object({
  dry_run: DryRun,
  name: Name,
  message: Message,
  params: Part.optional(),
  delivery: Part.optional(),
  recipients: Recipients,
  personal_outside: z.boolean().optional(),
})
const ActionBody = z.object({ dry_run: DryRun })
const ListQuery = z.object({
  scope: z.enum(['mine', 'all']).optional(),
  report: z.string().max(80).optional(),
})

const upperFirst = s => (s ? s[0].toUpperCase() + s.slice(1) : '')
const lowerFirst = s => (s ? s[0].toLowerCase() + s.slice(1) : '')
const humanKey = key => upperFirst(String(key || '').replace(/_/g, ' ').trim())
const notFound = () => httpError(404, 'Schedule not found')
const refOfRow = row => row.report_id || STARTER_PREFIX + row.starter_key

// A report id as the schedules' own columns: { report_id } or { starter_key }.
function refFilter(id) {
  const s = String(id || '')
  if (s.startsWith(STARTER_PREFIX) && STARTER_KEY.test(s.slice(STARTER_PREFIX.length))) return { starter_key: s.slice(STARTER_PREFIX.length) }
  if (UUID_RE.test(s)) return { report_id: s.toLowerCase() }
  throw httpError(404, 'Report not found')
}
const refOfTarget = target => (target.starter ? { starter_key: target.starter.key } : { report_id: target.saved.id })

// The choices a schedule keeps: only those the report asks for.
function ownParams(spec, raw) {
  const given = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const out = {}
  for (const p of spec.params || []) if (given[p.key] !== undefined) out[p.key] = given[p.key]
  if (JSON.stringify(out).length > MAX_PARAMS_TEXT) throw httpError(422, 'The report\'s choices are too long to keep with a schedule')
  return out
}

// The schedule rows, each with its saved report's name and definition.
function listRows(p, { all = false, ref = null } = {}) {
  return withTenant(p.tenantId, tx => tx`
    SELECT s.*, r.name AS report_name, r.spec AS report_spec
      FROM report_schedules s
 LEFT JOIN reports r ON r.id = s.report_id AND r.tenant_id = s.tenant_id
     WHERE s.tenant_id = ${p.tenantId}
       ${all ? tx`` : tx`AND s.owner_sub = ${p.sub}`}
       ${ref?.report_id ? tx`AND s.report_id = ${ref.report_id}` : tx``}
       ${ref?.starter_key ? tx`AND s.starter_key = ${ref.starter_key}` : tx``}
     ORDER BY s.enabled DESC, s.next_run_at NULLS LAST, s.created_at, s.id
     LIMIT ${MAX_LISTED}`)
}

// One schedule the person may see: their own, or any with Manage. 404 else.
async function visibleRow(p, sid) {
  if (!UUID_RE.test(String(sid || ''))) throw notFound()
  const [row] = await withTenant(p.tenantId, tx => tx`
    SELECT s.*, r.name AS report_name, r.spec AS report_spec
      FROM report_schedules s
 LEFT JOIN reports r ON r.id = s.report_id AND r.tenant_id = s.tenant_id
     WHERE s.tenant_id = ${p.tenantId} AND s.id = ${sid}`)
  if (!row || (row.owner_sub !== p.sub && !p.canManage)) throw notFound()
  return row
}

// A schedule's choices in words: [{ key, label, text }]. A period as its
// name (its days move with each send), the venues by name in the group's
// order, anything else as the report's filter says it.
function choicesOf(spec, given, { catalogue, venues }) {
  const resolved = resolveParams(spec, given)
  const inputs = new Map(paramInputs(catalogue, spec).map(x => [x.key, x]))
  return (spec.params || []).map(prm => {
    const value = resolved[prm.key]
    const input = inputs.get(prm.key)
    const label = input?.label || prm.label || (prm.type === 'period' ? 'Period' : prm.type === 'venues' ? 'Venues' : humanKey(prm.key))
    let text = ''
    if (prm.type === 'period') text = (value ? periodName(value) : '') || 'Any time'
    else if (prm.type === 'venues') {
      const ids = Array.isArray(value) ? value : []
      const names = venues.filter(v => ids.includes(v.id)).map(v => v.name)
      text = !ids.length ? 'Every venue' : names.length ? names.join(', ') : ids.length + (ids.length === 1 ? ' venue' : ' venues')
    } else {
      text = (input ? upperFirst(paramWords(catalogue, input, value, { venues })) : '') || 'Anything'
    }
    return { key: prm.key, label, text }
  })
}

function scheduleView(row, p, { venues, byId, byEmail, catalogue }) {
  const starter = row.starter_key ? starterByKey(row.starter_key) : null
  const spec = row.report_id ? (row.report_spec ? normaliseReport(row.report_spec) : null) : starter?.spec || null
  const given = row.params && typeof row.params === 'object' ? row.params : {}
  const scope = spec ? venueScope(venues, spec, resolveParams(spec, given)) : { tz: venues[0]?.timezone || 'Europe/London', scope: venues }
  const currency = scope.scope?.[0]?.currency || 'GBP'
  const condition = normaliseCondition(row.condition)
  const watched = condition.when === 'figure' && spec ? (spec.values || []).find(v => v.key === condition.value) : null
  const type = watched ? valueType(CATALOGUE, spec, watched) : 'number'
  const mine = row.owner_sub === p.sub
  return {
    id: row.id,
    report: {
      id: refOfRow(row),
      kind: row.report_id ? 'saved' : 'starter',
      name: row.report_id ? row.report_name || 'A report' : starter?.name || 'A starter report that is gone',
      subject: spec?.subject || null,
    },
    name: row.name,
    message: row.message,
    timing: normaliseTiming(row.timing),
    timing_text: timingText(row.timing),
    params: given,
    choices: spec ? choicesOf(spec, given, { catalogue, venues }) : [],
    delivery: normaliseDelivery(row.delivery),
    delivery_text: deliveryText(row.delivery),
    condition,
    condition_text: conditionText(condition, watched
      ? { label: valueName(CATALOGUE, spec, watched), type: NUMERIC_TYPES.includes(type) ? type : 'number' }
      : null, currency),
    recipients: normaliseRecipients(row.recipients).map(r => {
      if (r.user_id) {
        const u = byId.get(r.user_id)
        return u
          ? { user_id: r.user_id, name: u.full_name || null, email: u.email || null, on_team: !!u.is_active, outside: false }
          : { user_id: r.user_id, name: null, email: null, on_team: false, outside: false }
      }
      const u = byEmail.get(r.email)
      return u
        ? { email: r.email, user_id: u.id, name: u.full_name || null, on_team: true, outside: false }
        : { email: r.email, user_id: null, name: null, on_team: false, outside: true }
    }),
    personal_outside: !!row.personal_outside,
    push_url: row.push_url || null,
    enabled: !!row.enabled,
    paused_reason: row.enabled ? null : row.paused_reason,
    // A paused schedule has no next run until it is resumed.
    next_run_at: row.enabled ? row.next_run_at : null,
    time_zone: scope.tz,
    sending: !!row.running_until && new Date(row.running_until).getTime() > Date.now(),
    last_run_at: row.last_run_at,
    last_sent_at: row.last_sent_at,
    last_status: row.last_status,
    last_error: row.last_error,
    failures: row.failures || 0,
    owner_email: row.owner_email,
    mine,
    can_change: (mine && p.canUse) || p.canManage,
    can_pause: mine || p.canManage,
    can_delete: mine || p.canManage,
    can_send: (mine && p.canUse) || p.canManage,
    takes_over: !mine && p.canManage,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

/** The views of schedule rows: venues and recipients looked up once for them all. */
async function views(p, rows) {
  if (!rows.length) return []
  const recips = rows.flatMap(r => normaliseRecipients(r.recipients))
  const ids = [...new Set(recips.filter(r => r.user_id).map(r => r.user_id))]
  const emails = [...new Set(recips.filter(r => r.email).map(r => r.email))]
  const { venues, people } = await withTenant(p.tenantId, async tx => ({
    venues: await tx`
      SELECT id::text AS id, name, COALESCE(NULLIF(timezone, ''), 'Europe/London') AS timezone,
             COALESCE(NULLIF(btrim(currency::text), ''), 'GBP') AS currency
        FROM venues WHERE tenant_id = ${p.tenantId} ORDER BY created_at, id`,
    people: ids.length || emails.length ? await tx`
      SELECT id::text AS id, full_name, lower(btrim(email)) AS email, is_active
        FROM users
       WHERE tenant_id = ${p.tenantId}
         AND (id = ANY(${ids}::uuid[]) OR lower(btrim(email)) = ANY(${emails}::text[]))` : [],
  }))
  const byId = new Map(people.map(u => [u.id, u]))
  // An address is someone on the team only while they are an active member (as the sender decides).
  const byEmail = new Map(people.filter(u => u.is_active && u.email).map(u => [u.email, u]))
  const catalogue = catalogueView(p.levels)
  return rows.map(row => scheduleView(row, p, { venues, byId, byEmail, catalogue }))
}

const viewOf = async (p, sid) => (await views(p, [await visibleRow(p, sid)]))[0]

// A schedule row as it would be saved: what a dry run shows, through the
// same view as a saved one.
function draftRow(base, fields) {
  return {
    id: null, report_id: null, starter_key: null, report_name: null, report_spec: null,
    name: null, message: null, timing: null, params: {}, delivery: null, condition: null, recipients: [],
    personal_outside: false, push_url: null, enabled: true, paused_reason: null, next_run_at: null, running_until: null,
    last_run_at: null, last_sent_at: null, last_status: null, last_error: null, failures: 0,
    owner_sub: null, owner_email: null, created_at: null, updated_at: null,
    ...base, ...fields,
  }
}
const targetRow = target => ({ ...refOfTarget(target), report_name: target.saved?.name ?? null, report_spec: target.saved?.spec ?? null })
const draftView = async (p, row) => (await views(p, [row]))[0]

// What Email it now would send, in the schedule view's words.
const SEND_KEYS = ['report', 'name', 'message', 'params', 'choices', 'delivery', 'delivery_text', 'recipients', 'personal_outside', 'time_zone']
const sendView = v => Object.fromEntries(SEND_KEYS.map(k => [k, v[k]]))

// The person saving a schedule, as it will run: the sweep runs it as its
// owner's users row, so a schedule saved by someone without one (a platform
// admin outside the group) would pause at its first run.
async function asOwner(p) {
  const me = await ownerPerson(p.tenantId, p.sub)
  if (!me) throw httpError(422, 'A schedule sends as someone on the group\'s team, and you aren\'t on it')
  return me
}

// A refusal found while checking someone else's schedule as its owner says whose it is.
function asTheirs(e, row, owner, p) {
  if (row.owner_sub !== p.sub && e?.statusCode && e.statusCode < 500 && typeof e.message === 'string') {
    e.message = (owner?.email || row.owner_email || 'Its owner') + ' can\'t send it: ' + lowerFirst(e.message)
  }
  return e
}

// What a send answers: its counts. A send that reached nobody is refused with why.
function sendAnswer(r) {
  if (r.status === 'failed') {
    throw httpError(422, 'It wasn\'t sent: ' + lowerFirst(r.error || 'the email service refused it'), { code: 'not_sent', run_id: r.runId })
  }
  return { status: r.status, to: r.to, sent: r.sent, failed: r.failed, held: r.held, kept: r.kept, error: r.error, run_id: r.runId }
}

// A schedule's send as its owner, checked as the sweep checks it: { owner, target, plan }.
async function sendPlan(row, p) {
  const owner = await ownerPerson(p.tenantId, row.owner_sub)
  if (!owner) {
    throw httpError(422, (row.owner_sub === p.sub ? 'You aren\'t' : (row.owner_email || 'Its owner') + ' is no longer')
      + ' on the team, so it can\'t send. Save the schedule to make it yours first')
  }
  try {
    const target = await loadTarget(refOfRow(row), owner)
    const plan = await prepareSend(owner, target, {
      kind: 'scheduled', recipients: row.recipients, delivery: row.delivery, condition: row.condition,
      params: row.params, personalOutside: !!row.personal_outside, name: row.name, message: row.message,
      push: pushOf(row),
    })
    return { owner, target, plan }
  } catch (e) {
    throw asTheirs(e, row, owner, p)
  }
}

export default async function reportScheduleRoutes(app) {
  app.addHook('preHandler', requireAuth)

  const view = { preHandler: requirePermission('reports', 'view') }
  const use = { preHandler: requirePermission('reports', 'use') }
  // A send runs a report and emails it: a few a minute.
  const sending = { ...use, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }

  // Who the person can send a report to. Static, so never taken for a report's id.
  app.get('/recipients', use, async req => {
    const p = await requestPerson(req)
    const { me, team } = await withTenant(p.tenantId, async tx => {
      const [me] = await tx`
        SELECT id::text AS id, full_name, lower(btrim(email)) AS email FROM users
         WHERE tenant_id = ${p.tenantId} AND auth0_user_id = ${p.sub} AND is_active = true
         LIMIT 1`
      const team = p.canManage ? await tx`
        SELECT id::text AS id, full_name, lower(btrim(email)) AS email FROM users
         WHERE tenant_id = ${p.tenantId} AND is_active = true AND email IS NOT NULL AND btrim(email) <> ''
         ORDER BY lower(COALESCE(NULLIF(btrim(full_name), ''), email)), id
         LIMIT ${MAX_LISTED}` : []
      return { me: me || null, team }
    })
    return {
      me: me
        ? { user_id: me.id, name: me.full_name || null, email: me.email }
        : p.email ? { user_id: null, name: null, email: String(p.email).trim().toLowerCase() } : null,
      team: team.map(u => ({ user_id: u.id, name: u.full_name || null, email: u.email })),
      can_others: p.canManage,
      can_outside: p.canManage && p.isOwnerOrAdmin,
      can_personal_outside: p.isOwnerOrAdmin,
      can_push: p.canManage && p.isOwnerOrAdmin,
      can_pdf: pdfAvailable(),
      max: MAX_RECIPIENTS,
    }
  })

  app.get('/schedules', view, async req => {
    const q = ListQuery.parse(req.query || {})
    const p = await requestPerson(req)
    const all = q.scope === 'all'
    if (all && !p.canManage) throw httpError(403, 'Seeing everyone\'s schedules needs Manage on Reports')
    const rows = await listRows(p, { all, ref: q.report ? refFilter(q.report) : null })
    return { schedules: await views(p, rows), can_use: p.canUse, can_manage: p.canManage, max: MAX_SCHEDULES }
  })

  // Alerts for the Today feed (phase 5, docs/REPORTS.md 15): the venue's
  // day's scheduled runs that raised a task on Today (delivery.today, the
  // condition met), of reports the person may open and run, whose venues
  // include this one. The feed reads it as the person (services/opsToday.js).
  app.get('/alerts', view, async req => {
    const q = AlertsQuery.parse(req.query || {})
    const p = await requestPerson(req)
    const venues = await withTenant(p.tenantId, tx => tx`
      SELECT id, timezone FROM venues WHERE tenant_id = ${p.tenantId} AND is_active = true ORDER BY created_at, id`)
    const venue = venues.find(v => v.id === q.venue_id)
    if (!venue) throw httpError(404, 'Venue not found')
    const rows = await withTenant(p.tenantId, tx => tx`
      SELECT DISTINCT ON (r.schedule_id) r.id, r.created_at, r.row_count, r.report_id, r.starter_key, r.report_name,
             s.id AS sid, s.name AS schedule_name, s.condition, s.params AS schedule_params
        FROM report_runs r
        JOIN report_schedules s ON s.id = r.schedule_id AND s.tenant_id = r.tenant_id
       WHERE r.tenant_id = ${p.tenantId} AND r.kind = 'scheduled' AND r.error IS NULL
         AND (r.delivery->>'today')::boolean IS TRUE
         AND r.created_at >= (${q.date}::date)::timestamp AT TIME ZONE ${venue.timezone || 'Europe/London'}
         AND r.created_at < (${q.date}::date + 1)::timestamp AT TIME ZONE ${venue.timezone || 'Europe/London'}
       ORDER BY r.schedule_id, r.created_at DESC
       LIMIT 200`)
    const targets = await loadTargets(rows.map(refOfRow), p)
    const alerts = []
    for (const r of rows) {
      const t = targets.get(refOfRow(r))
      if (!t?.spec || !runsFor(t.spec.subject, p.levels).runs) continue
      const { ids } = venueScope(venues, t.spec, resolveParams(t.spec, r.schedule_params || {}))
      if (ids && !ids.has(venue.id)) continue
      const condition = normaliseCondition(r.condition)
      const watched = condition.when === 'figure' ? (t.spec.values || []).find(v => v.key === condition.value) : null
      alerts.push({
        run_id: r.id, schedule_id: r.sid, at: r.created_at, rows: r.row_count,
        report: { id: refOfRow(r), name: t.name || r.report_name || 'A report' },
        name: r.schedule_name || t.name || r.report_name || 'A report',
        condition_text: conditionText(condition, watched ? { label: valueName(CATALOGUE, t.spec, watched), type: 'number' } : null),
      })
    }
    alerts.sort((a, b) => String(b.at).localeCompare(String(a.at)))
    return { alerts }
  })

  app.get('/schedules/:scheduleId', view, async req => {
    const p = await requestPerson(req)
    return { schedule: await viewOf(p, req.params.scheduleId) }
  })

  app.get('/:id/schedules', view, async req => {
    const p = await requestPerson(req)
    const target = await loadTarget(req.params.id, p)
    const rows = await listRows(p, { all: p.canManage, ref: refOfTarget(target) })
    return { schedules: await views(p, rows), can_use: p.canUse, can_manage: p.canManage, max: MAX_SCHEDULES }
  })

  app.post('/:id/schedules', use, async (req, reply) => {
    const body = ScheduleBody.parse(req.body || {})
    const p = await requestPerson(req)
    const me = await asOwner(p)
    const target = await loadTarget(req.params.id, me)
    const bad = timingProblem(body.timing)
    if (bad) throw httpError(422, bad)
    const timing = normaliseTiming(body.timing)
    const params = ownParams(target.spec, body.params)
    const plan = await prepareSend(me, target, {
      kind: 'scheduled', recipients: body.recipients, delivery: body.delivery, condition: body.condition,
      params, personalOutside: body.personal_outside === true, name: body.name, message: body.message,
      push: body.push_url ? { url: body.push_url } : null,
    })
    const next = nextRunAt(timing, new Date(), await reportZone(p.tenantId, target.spec, params))
    if (!next) throw httpError(422, 'Pick at least one day of the week')
    const ref = refOfTarget(target)
    // The push's secret: shown once, in this answer.
    const pushSecret = plan.push && !body.dry_run ? newPushSecret() : null
    const fields = {
      owner_sub: me.sub, owner_email: me.email, name: plan.name, message: plan.message, timing, params,
      delivery: plan.delivery, condition: plan.condition, recipients: normaliseRecipients(body.recipients),
      personal_outside: plan.personalOutside, next_run_at: next, push_url: plan.push?.url ?? null,
    }
    const row = await withTenant(p.tenantId, async tx => {
      const [{ n }] = await tx`SELECT count(*)::int AS n FROM report_schedules WHERE tenant_id = ${p.tenantId} AND owner_sub = ${me.sub}`
      if (n >= MAX_SCHEDULES) throw httpError(422, 'You have ' + MAX_SCHEDULES + ' schedules. Delete one you no longer need first')
      if (body.dry_run) return null
      const [r] = await tx`
        INSERT INTO report_schedules (tenant_id, report_id, starter_key, owner_sub, owner_email, name, message,
                                      timing, params, delivery, condition, recipients, personal_outside, next_run_at,
                                      push_url, push_secret)
        VALUES (${p.tenantId}, ${ref.report_id ?? null}, ${ref.starter_key ?? null}, ${me.sub}, ${me.email},
                ${plan.name}, ${plan.message}, ${tx.json(timing)}, ${tx.json(params)}, ${tx.json(plan.delivery)},
                ${tx.json(plan.condition)}, ${tx.json(normaliseRecipients(body.recipients))}, ${plan.personalOutside}, ${next},
                ${plan.push?.url ?? null}, ${pushSecret ? seal(pushSecret) : null})
        RETURNING id`
      return r
    })
    if (body.dry_run) {
      return { dry_run: true, schedule: await draftView(p, draftRow(targetRow(target), fields)), skipped: plan.skipped }
    }
    return reply.code(201).send({ schedule: await viewOf(p, row.id), ...(pushSecret ? { push_secret: pushSecret } : {}) })
  })

  // Change it. Someone with Manage changing someone else's makes it their own.
  app.patch('/schedules/:scheduleId', use, async req => {
    const body = ScheduleEdit.parse(req.body || {})
    const p = await requestPerson(req)
    const row = await visibleRow(p, req.params.scheduleId)
    if (row.running_until && new Date(row.running_until).getTime() > Date.now()) throw httpError(409, BUSY)
    const me = await asOwner(p)
    const target = await loadTarget(refOfRow(row), me)
    const has = k => Object.prototype.hasOwnProperty.call(body, k) && body[k] !== undefined
    if (has('timing')) {
      const bad = timingProblem(body.timing)
      if (bad) throw httpError(422, bad)
    }
    const timing = normaliseTiming(has('timing') ? body.timing : row.timing)
    const params = ownParams(target.spec, has('params') ? body.params : row.params)
    const recipients = has('recipients') ? body.recipients : row.recipients
    const pushUrl = Object.prototype.hasOwnProperty.call(body, 'push_url') ? body.push_url || null : row.push_url
    const plan = await prepareSend(me, target, {
      push: pushUrl ? { url: pushUrl } : null,
      kind: 'scheduled',
      recipients,
      delivery: has('delivery') ? body.delivery : row.delivery,
      condition: has('condition') ? body.condition : row.condition,
      params,
      personalOutside: has('personal_outside') ? body.personal_outside : !!row.personal_outside,
      name: Object.prototype.hasOwnProperty.call(body, 'name') ? body.name : row.name,
      message: Object.prototype.hasOwnProperty.call(body, 'message') ? body.message : row.message,
    })
    const next = nextRunAt(timing, new Date(), await reportZone(p.tenantId, target.spec, params))
    if (!next) throw httpError(422, 'Pick at least one day of the week')
    if (body.dry_run) {
      const after = draftRow(row, {
        owner_sub: me.sub, owner_email: me.email, name: plan.name, message: plan.message, timing, params,
        delivery: plan.delivery, condition: plan.condition, recipients: normaliseRecipients(recipients),
        personal_outside: plan.personalOutside, next_run_at: next, failures: 0, push_url: plan.push?.url ?? null,
      })
      return { dry_run: true, schedule: await draftView(p, after), takes_over: row.owner_sub !== me.sub, skipped: plan.skipped }
    }
    // A new address, or asked for, makes a new secret (shown once); none, none.
    const freshSecret = plan.push && (plan.push.url !== row.push_url || body.new_push_secret || !row.push_secret) ? newPushSecret() : null
    const storedSecret = !plan.push ? null : freshSecret ? seal(freshSecret) : row.push_secret
    // Not while the sweep or a Send now holds it: that send would finish with the old settings.
    const [done] = await withTenant(p.tenantId, tx => tx`
      UPDATE report_schedules
         SET owner_sub = ${me.sub}, owner_email = ${me.email}, name = ${plan.name}, message = ${plan.message},
             timing = ${tx.json(timing)}, params = ${tx.json(params)}, delivery = ${tx.json(plan.delivery)},
             condition = ${tx.json(plan.condition)}, recipients = ${tx.json(normaliseRecipients(recipients))},
             personal_outside = ${plan.personalOutside}, next_run_at = ${next}, retry_of = NULL, failures = 0,
             push_url = ${plan.push?.url ?? null}, push_secret = ${storedSecret}, updated_at = now()
       WHERE tenant_id = ${p.tenantId} AND id = ${row.id}
         AND (running_until IS NULL OR running_until < now())
   RETURNING id`)
    if (!done) throw httpError(409, BUSY)
    return { schedule: await viewOf(p, row.id), ...(freshSecret ? { push_secret: freshSecret } : {}) }
  })

  // Its owner, or Manage. View is enough: someone who has lost Use can still stop their own.
  app.delete('/schedules/:scheduleId', view, async (req, reply) => {
    const p = await requestPerson(req)
    const row = await visibleRow(p, req.params.scheduleId)
    const gone = await withTenant(p.tenantId, tx => tx`
      DELETE FROM report_schedules
       WHERE tenant_id = ${p.tenantId} AND id = ${row.id}
         AND (running_until IS NULL OR running_until < now())
   RETURNING id`)
    if (!gone.length) throw httpError(409, BUSY)
    return reply.code(204).send()
  })

  app.post('/schedules/:scheduleId/pause', view, async req => {
    const p = await requestPerson(req)
    const row = await visibleRow(p, req.params.scheduleId)
    if (row.enabled) {
      await withTenant(p.tenantId, tx => tx`
        UPDATE report_schedules
           SET enabled = false, paused_reason = ${'Paused by ' + (p.email || 'someone on the team')},
               retry_of = NULL, updated_at = now()
         WHERE tenant_id = ${p.tenantId} AND id = ${row.id}`)
    }
    return { schedule: await viewOf(p, row.id) }
  })

  // Start it again: checked as its owner, as the sweep will run it.
  app.post('/schedules/:scheduleId/resume', use, async req => {
    const body = ActionBody.parse(req.body || {})
    const p = await requestPerson(req)
    const row = await visibleRow(p, req.params.scheduleId)
    if (row.enabled) return body.dry_run ? { dry_run: true, schedule: await draftView(p, row) } : { schedule: await viewOf(p, row.id) }
    const owner = await ownerPerson(p.tenantId, row.owner_sub)
    if (!owner) {
      throw httpError(422, (row.owner_sub === p.sub ? 'You aren\'t' : (row.owner_email || 'Its owner') + ' is no longer')
        + ' on the team, so it can\'t send. Save the schedule to make it yours, then resume it')
    }
    let target
    let plan
    try {
      target = await loadTarget(refOfRow(row), owner)
      plan = await prepareSend(owner, target, {
        kind: 'scheduled', recipients: row.recipients, delivery: row.delivery, condition: row.condition,
        params: row.params, personalOutside: !!row.personal_outside, name: row.name, message: row.message,
        push: pushOf(row),
      })
    } catch (e) {
      throw asTheirs(e, row, owner, p)
    }
    const next = nextRunAt(row.timing, new Date(), await reportZone(p.tenantId, target.spec, plan.params))
    if (!next) throw httpError(422, 'Its timing has no day to run on. Change it first')
    if (body.dry_run) {
      const after = draftRow(row, { enabled: true, paused_reason: null, failures: 0, next_run_at: next })
      return { dry_run: true, schedule: await draftView(p, after), skipped: plan.skipped }
    }
    await withTenant(p.tenantId, tx => tx`
      UPDATE report_schedules
         SET enabled = true, paused_reason = NULL, failures = 0, retry_of = NULL, next_run_at = ${next}, updated_at = now()
       WHERE tenant_id = ${p.tenantId} AND id = ${row.id}`)
    return { schedule: await viewOf(p, row.id) }
  })

  // Send it now, whatever its condition, as its owner (paused or not). Held
  // as the sweep holds one, so the two never send it at once; its next run
  // stays where it was.
  app.post('/schedules/:scheduleId/send', sending, async req => {
    const body = ActionBody.parse(req.body || {})
    const p = await requestPerson(req)
    const seen = await visibleRow(p, req.params.scheduleId)
    if (body.dry_run) {
      if (seen.running_until && new Date(seen.running_until).getTime() > Date.now()) throw httpError(409, BUSY)
      const plan = await sendPlan(seen, p)
      return { dry_run: true, schedule: await draftView(p, seen), skipped: plan.skipped }
    }
    const via = viaPepper(req)
    if (via) await limitPepperRuns(p)
    const [row] = await withTenant(p.tenantId, tx => tx`
      UPDATE report_schedules SET running_until = now() + make_interval(mins => ${LEASE_MINUTES})
       WHERE tenant_id = ${p.tenantId} AND id = ${seen.id}
         AND (running_until IS NULL OR running_until < now())
   RETURNING *`)
    if (!row) throw httpError(409, BUSY)
    let r
    try {
      const { owner, target, plan } = await sendPlan(row, p)
      r = await deliver(owner, target, plan, { schedule: row, log: req.log, ignoreCondition: true, via })
      const sent = r.status === 'sent' || r.status === 'partly'
      await withTenant(p.tenantId, tx => tx`
        UPDATE report_schedules
           SET last_status = ${r.status}, last_error = ${r.error ? String(r.error).slice(0, 500) : null},
               last_run_at = now(), last_sent_at = CASE WHEN ${sent} THEN now() ELSE last_sent_at END,
               failures = CASE WHEN ${sent} THEN 0 ELSE failures END
         WHERE tenant_id = ${p.tenantId} AND id = ${row.id}`)
    } finally {
      await withTenant(p.tenantId, tx => tx`
        UPDATE report_schedules SET running_until = NULL WHERE tenant_id = ${p.tenantId} AND id = ${row.id}`)
        .catch(err => req.log.warn({ err }, 'A report schedule wasn\'t let go'))
    }
    return { ...sendAnswer(r), schedule: await viewOf(p, row.id) }
  })

  // Email it now: the report run as the person asking and emailed once. The
  // same rules as a schedule's send, without a condition or a period check.
  app.post('/:id/send', sending, async req => {
    const body = SendBody.parse(req.body || {})
    const p = await requestPerson(req)
    const target = await loadTarget(req.params.id, p)
    const params = ownParams(target.spec, body.params)
    const plan = await prepareSend(p, target, {
      kind: 'emailed', recipients: body.recipients, delivery: body.delivery, condition: { when: 'always' },
      params, personalOutside: body.personal_outside === true, name: body.name, message: body.message,
    })
    if (body.dry_run) {
      const draft = draftRow(targetRow(target), {
        owner_sub: p.sub, owner_email: p.email || null, name: plan.name, message: plan.message, params,
        delivery: plan.delivery, condition: plan.condition, recipients: normaliseRecipients(body.recipients),
        personal_outside: plan.personalOutside,
      })
      return { dry_run: true, send: sendView(await draftView(p, draft)), skipped: plan.skipped }
    }
    // A dry run sends nothing, so only a real send counts towards Pepper's runs.
    const via = viaPepper(req)
    if (via) await limitPepperRuns(p)
    return sendAnswer(await deliver(p, target, plan, { log: req.log, via, ignoreCondition: true }))
  })
}
