// src/routes/ops.js
//
// The ops front door's data (docs/CHAT_FIRST.md). GET /api/ops/today: what
// needs doing at a venue today, from data and rules (services/opsToday.js),
// so the Today page works with the AI switched off or down (P1, Q1). Open to
// everyone signed in: each part checks its own module. With it come Home's
// suggestions for the person (step 7a, services/suggestions.js: rules over
// their own record, their feed and their menu, never the model).
//
// The task store (Pepper-first step 5a, migration 278, services/opsTasks.js):
//   POST /tasks            one change to a task: assign (owner_id, null to
//                          clear), snooze (minutes, or until HH:MM today) /
//                          unsnooze, skip (reason required) / unskip, done /
//                          undone (only kinds the feed can't see finish).
//                          The task is first found on the person's own feed
//                          for the day, so one they can't see can't be
//                          changed; then Use on its module where the module
//                          offers Use, else Manage (stateLevel()).
//   GET  /tasks/people     who a task can be assigned to: active team members
//                          who can do it (Use where offered, else Manage)
//   GET  /tasks/history    a task's changes, newest first
//   GET  /skips            the day's skips with their reasons, by site, for
//                          the areas the person manages (decision 8: by site,
//                          never by person)

import { z } from 'zod'
import { requireAuth, permissionLevels } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { tenantSql, withTenant } from '../config/db.js'
import { permissionAtLeast, workLevel } from '../config/modules.js'
import { makeContext, staffAuthOf, staffPrincipalOf } from '../ai/context.js'
import { opsToday, OPS_MODULES, AREAS, moduleOf } from '../services/opsToday.js'
import { changeTask, taskHistory, canChange, personName, localParts, TaskError } from '../services/opsTasks.js'
import { REASON_MAX, SNOOZE_MAX_MINUTES } from '../../../shared/todayTasks.js'
import { gatherFacts, suggestionsFor } from '../services/suggestions.js'

const realDay = d => { const t = Date.parse(d + 'T12:00:00Z'); return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d }
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(realDay, 'Not a real date')
const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
const Key = z.string().trim().min(1).max(200)

const TodayQuery = z.object({
  venue_id: z.string().uuid().optional(),
  date: Day.optional(),
  time: Time.optional(),
})

const TaskChange = z.object({
  venue_id: z.string().uuid(),
  key:      Key,
  date:     Day.optional(),
  action:   z.enum(['assign', 'snooze', 'unsnooze', 'skip', 'unskip', 'done', 'undone']),
  owner_id: z.string().uuid().nullable().optional(),
  minutes:  z.number().int().min(5).max(SNOOZE_MAX_MINUTES).optional(),
  until:    Time.optional(),
  reason:   z.string().max(REASON_MAX * 2).optional(),
})
const TASK_MODULES = [...new Set([...Object.values(AREAS), 'purchasing_approve'])]
const TaskQuery = z.object({ venue_id: z.string().uuid(), key: Key, date: Day.optional() })

export default async function opsRoutes(app) {
  app.addHook('preHandler', requireAuth)

  const contextFor = req => makeContext({
    app, channel: 'staff_chat', tenantId: req.tenantId, log: req.log,
    auth: staffAuthOf(req),
    principal: staffPrincipalOf(req),
    actor: req.user.email || req.user.sub,
  })

  async function activeVenues(req) {
    if (!req.tenantId) throw httpError(404, 'Choose a restaurant group first')
    return tenantSql(req.tenantId)`
      SELECT id, name, timezone FROM venues
       WHERE tenant_id = ${req.tenantId} AND is_active = true
       ORDER BY name
    `
  }

  /** The person's feed for a venue and day, and the task with this key on it (on the list or set aside). */
  async function findTask(req, venueId, key, date) {
    const venue = (await activeVenues(req)).find(v => v.id === venueId)
    if (!venue) throw httpError(404, 'Venue not found')
    const levels = await permissionLevels(req, OPS_MODULES)
    const feed = await opsToday(contextFor(req), venue, { date, levels })
    const task = feed.tasks.find(t => t.key === key) || feed.aside.find(t => t.key === key)
    if (!task) throw httpError(404, 'That task isn\'t on the list for this day')
    return { venue, feed, task, levels }
  }

  app.get('/today', async req => {
    const q = TodayQuery.parse(req.query || {})
    const venues = await activeVenues(req)
    const venue = q.venue_id ? venues.find(v => v.id === q.venue_id) : venues[0]
    if (!venue) throw httpError(404, q.venue_id ? 'Venue not found' : 'No venues yet')
    const levels = await permissionLevels(req, OPS_MODULES)
    const ctx = contextFor(req)
    // Home's suggestions (step 7a): their own reads run beside the feed's;
    // the rules then see the feed's tasks. A failure there never costs the feed.
    const here = localParts(new Date(), venue.timezone)
    const [today, facts] = await Promise.all([
      opsToday(ctx, venue, { date: q.date, time: q.time, levels }),
      gatherFacts(req, ctx, venue, { date: here.date, hour: Number(here.time.slice(0, 2)) }).catch(err => {
        req.log.warn({ err }, 'suggestions: facts not gathered')
        return null
      }),
    ])
    const suggestions = facts ? suggestionsFor(facts, today, levels) : []
    return { ...today, suggestions, venues: venues.map(v => ({ id: v.id, name: v.name })) }
  })

  // ── The task store ──────────────────────────────────────
  app.post('/tasks', async req => {
    const parsed = TaskChange.safeParse(req.body ?? {})
    if (!parsed.success) throw httpError(422, parsed.error.issues[0].message)
    const b = parsed.data
    const { venue, feed, task, levels } = await findTask(req, b.venue_id, b.key, b.date)
    if (!canChange(levels, moduleOf(task))) throw httpError(403, 'Your role can\'t change this task.')
    let owner = null
    if (b.action === 'assign' && b.owner_id) owner = await assignable(req, b.owner_id, moduleOf(task))
    if (b.action === 'snooze' && !b.minutes && !b.until) throw httpError(422, 'Say how long to snooze it for.')
    const [me] = await withTenant(req.tenantId, tx => tx`
      SELECT full_name, email FROM users WHERE tenant_id = ${req.tenantId} AND auth0_user_id = ${req.user.sub} LIMIT 1`)
    // On a shared device the task log names the person switched in (migration 280).
    const who = req.acting ? { sub: req.acting.sub, name: req.acting.name }
      : { sub: req.user.sub, name: me ? personName(me) : (req.user.email || null) }
    try {
      const saved = await changeTask(req.tenantId, who, venue, task, feed.date, feed.is_today, {
        action: b.action, owner, minutes: b.minutes, until: b.until, reason: b.reason,
      })
      return {
        ok: true, key: task.key, date: feed.date,
        owner: saved?.owner_id ? { id: saved.owner_id, name: personName(owner || {}) } : null,
        snoozed_until: saved?.snoozed_until ?? null,
        skipped: saved?.skipped_on === feed.date, reason: saved?.skipped_on === feed.date ? saved.skip_reason : null,
        done: saved?.done_on === feed.date,
      }
    } catch (err) {
      if (err instanceof TaskError) throw httpError(err.status, err.message)
      throw err
    }
  })

  /** A team member a task of `module` can be given to: active, signed in once, able to do it. */
  async function assignable(req, userId, module) {
    const [u] = await withTenant(req.tenantId, tx => tx`
      SELECT id, full_name, email, auth0_user_id FROM users
       WHERE id = ${userId} AND tenant_id = ${req.tenantId} AND is_active = true`)
    if (!u) throw httpError(404, 'Team member not found')
    if (!u.auth0_user_id) throw httpError(422, personName(u) + ' hasn\'t signed in yet, so can\'t be given tasks.')
    const lv = await permissionLevels({ tenantId: req.tenantId, user: { sub: u.auth0_user_id }, isPlatformAdmin: false }, [module])
    if (!permissionAtLeast(lv[module], workLevel(module))) throw httpError(422, personName(u) + '\'s role can\'t do this task.')
    return u
  }

  app.get('/tasks/people', async req => {
    const q = TaskQuery.safeParse(req.query ?? {})
    if (!q.success) throw httpError(422, 'Say which venue and task.')
    const { task, levels } = await findTask(req, q.data.venue_id, q.data.key, q.data.date)
    const module = moduleOf(task)
    if (!canChange(levels, module)) throw httpError(403, 'Your role can\'t change this task.')
    const users = await withTenant(req.tenantId, tx => tx`
      SELECT id, full_name, email, auth0_user_id FROM users
       WHERE tenant_id = ${req.tenantId} AND is_active = true AND auth0_user_id IS NOT NULL
       ORDER BY lower(COALESCE(NULLIF(full_name, ''), email))`)
    const people = []
    for (const u of users) {
      const lv = await permissionLevels({ tenantId: req.tenantId, user: { sub: u.auth0_user_id }, isPlatformAdmin: false }, [module])
      if (permissionAtLeast(lv[module], workLevel(module))) people.push({ id: u.id, name: personName(u), me: u.auth0_user_id === req.user.sub })
    }
    return { key: task.key, owner: task.owner ?? null, people }
  })

  app.get('/tasks/history', async req => {
    const q = TaskQuery.safeParse(req.query ?? {})
    if (!q.success) throw httpError(422, 'Say which venue and task.')
    const { venue, task } = await findTask(req, q.data.venue_id, q.data.key, q.data.date)
    return { key: task.key, title: task.title, history: await taskHistory(req.tenantId, venue.id, task.key) }
  })

  // The day's skips by site (decision 7: shown above the store), for the
  // areas the person manages. Each venue's own day unless a date is given.
  app.get('/skips', async req => {
    const q = z.object({ date: Day.optional() }).safeParse(req.query ?? {})
    if (!q.success) throw httpError(422, 'Pick a day (YYYY-MM-DD).')
    const venues = await activeVenues(req)
    const levels = await permissionLevels(req, OPS_MODULES)
    const manages = t => { const m = moduleOf(t); return !!m && permissionAtLeast(levels[m], 'manage') }
    const days = new Map(venues.map(v => [v.id, q.data.date || localParts(new Date(), v.timezone).date]))
    const rows = venues.length ? await withTenant(req.tenantId, tx => tx`
      SELECT venue_id, task_key, area, kind, title, skip_reason, skipped_at, skipped_on::text AS skipped_on
        FROM ops_task_states
       WHERE tenant_id = ${req.tenantId} AND skipped_on IS NOT NULL
         AND skipped_on >= ${[...days.values()].sort()[0]}::date
       ORDER BY skipped_at`) : []
    const sites = venues.map(v => ({
      venue_id: v.id, venue_name: v.name, date: days.get(v.id),
      skips: rows.filter(r => r.venue_id === v.id && r.skipped_on === days.get(v.id) && manages(r))
        .map(r => ({ key: r.task_key, title: r.title, area: r.area, kind: r.kind, reason: r.skip_reason, at: r.skipped_at })),
    }))
    return {
      can_see: TASK_MODULES.some(m => permissionAtLeast(levels[m], 'manage')),
      total: sites.reduce((n, s) => n + s.skips.length, 0),
      sites: sites.filter(s => s.skips.length),
    }
  })
}
