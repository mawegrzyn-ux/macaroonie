// src/routes/storeOpenings.js — mounted at /api/ai/store-openings
//
// Opening a new location with Pepper (migration 186). Under /api/ai so the
// longer proxy timeout for Pepper applies (scripts/ensure-nginx-ai-timeout.sh):
// a step can take a minute.
//
//   GET    /                     the tenant's openings                       venues view
//   GET    /:id                  one opening: plan, area cards, questions,
//                                brief, results, follow-ups                  venues view
//   POST   /                     { input, template_venue_id? } start: Pepper
//                                scopes it and asks its first questions      venues manage + Pepper
//   POST   /:id/answers          { answers: { questionId: text } }           venues manage + Pepper
//   POST   /:id/deep-dive        { area }  more questions on one area        venues manage + Pepper
//   POST   /:id/change           { request }  change a finished brief        venues manage + Pepper
//   PATCH  /:id                  { title?, overrides? }  the person's own
//                                choices (name, address, date, the location
//                                to copy from, each area's way)              venues manage
//   POST   /:id/create           creates the location (one transaction)      venues manage
//   PATCH  /:id/followups/:key   { done }                                    venues manage
//   DELETE /:id                  a draft (not one already created)           venues manage
//
// Each area is set up only when the person has Manage on its page's module
// (OPENING_AREAS.modules; Cash Recon also an owner or admin login), else it is
// left out and listed as someone else's to do.

import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requirePermission, permissionLevels } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { chatConfigured } from '../ai/apiKey.js'
import { getAiSettings } from '../ai/settings.js'
import { askPepper } from '../services/storeOpeningAi.js'
import { createStore, venueSummary, tenantContext, freeSlug } from '../services/storeSetup.js'
import {
  OPENING_AREAS, AREA_KEYS, MODES, MAX_ROUNDS, normalisePlan, planProblems, previewPlan, buildFollowups,
} from '../../../shared/storeOpening.js'
import { ASSISTANT_NAME } from '../../../shared/assistant.js'

const UUID = z.string().uuid()
const LEASE_SECS = 300

const canView = requirePermission('venues', 'view')
const canManage = requirePermission('venues', 'manage')
const canPlan = [canManage, requirePermission('ai_assistant', 'view')]

const MODULES = [...new Set(OPENING_AREAS.flatMap(a => a.modules).concat(['screens']))]

/** Which areas this person can set up, and which modules they manage. */
async function access(req) {
  const levels = await permissionLevels(req, MODULES)
  const manages = m => levels[m] === 'manage'
  const admin = req.isPlatformAdmin || ['owner', 'admin'].includes(req.user?.role)
  const areas = OPENING_AREAS.filter(a =>
    (a.any ? a.modules.some(manages) : a.modules.every(manages)) && (!a.admin || admin)).map(a => a.key)
  return { areas, allowed: k => areas.includes(k), allowedModule: manages }
}

function validZone(tz) {
  try { new Intl.DateTimeFormat('en-GB', { timeZone: tz }); return true } catch { return false }
}
const todayIn = tz => new Intl.DateTimeFormat('en-CA', { timeZone: validZone(tz) ? tz : 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

async function ownOpening(tx, tenantId, id, lock = false) {
  const [o] = lock
    ? await tx`SELECT * FROM store_openings WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`
    : await tx`SELECT * FROM store_openings WHERE id = ${id} AND tenant_id = ${tenantId}`
  if (!o) throw httpError(404, 'Opening not found')
  return o
}

async function templateIds(tx, tenantId) {
  return new Set((await tx`SELECT id FROM venues WHERE tenant_id = ${tenantId}`).map(r => r.id))
}

/** The plan from Pepper's last plan and the person's own choices. */
async function planOf(tx, tenantId, o) {
  const templates = await templateIds(tx, tenantId)
  const tz = o.overrides?.venue?.timezone || o.ai?.raw_plan?.venue?.timezone
  return normalisePlan(o.ai?.raw_plan || {}, o.overrides || {}, { templates, today: todayIn(tz) })
}

/** Everything the page shows for an opening. */
async function view(tx, req, o, acc = null) {
  acc ||= await access(req)
  const plan = o.status === 'created' && o.plan ? o.plan : await planOf(tx, req.tenantId, o)
  const template = plan.template_venue_id ? await venueSummary(tx, req.tenantId, plan.template_venue_id) : null
  const preview = previewPlan(plan, template)
  const notes = Object.fromEntries((o.ai?.areas || []).map(a => [a.key, a]))
  const problems = planProblems(plan)
  if (!validZone(plan.venue.timezone)) problems.push('"' + plan.venue.timezone + '" isn\'t a time zone we know: pick one.')
  const slug = o.status === 'created' ? plan.venue.slug : await freeSlug(tx, req.tenantId, plan.venue.slug)
  const [venue] = o.venue_id ? await tx`SELECT id, name, slug FROM venues WHERE id = ${o.venue_id} AND tenant_id = ${req.tenantId}` : []
  const busy = !!o.busy_until && new Date(o.busy_until) > new Date()
  return {
    id: o.id,
    title: o.title,
    status: o.status,
    busy,
    input: o.input,
    rounds: o.rounds,
    max_rounds: MAX_ROUNDS,
    summary: o.ai?.summary || '',
    questions: o.status === 'questions' ? o.ai?.questions || [] : [],
    brief: o.ai?.brief || null,
    plan: { ...plan, venue: { ...plan.venue, slug_final: slug } },
    template: template ? { id: template.id, name: template.name } : null,
    overrides: o.overrides || {},
    areas: OPENING_AREAS.map(a => ({
      key: a.key,
      label: a.label,
      icon: a.icon,
      modes: a.modes,
      mode: plan.modes[a.key],
      chosen: !!o.overrides?.modes?.[a.key],
      note: notes[a.key]?.note || '',
      deep_dive: !!notes[a.key]?.deep_dive,
      preview: preview[a.key],
      can_set_up: acc.allowed(a.key),
      result: o.results?.[a.key] || null,
    })),
    problems,
    history: (o.steps || []).map(s => ({
      kind: s.kind, at: s.at, by: s.by_email || null, area: s.area || null, request: s.request || null,
      answers: s.answers || null, questions: s.questions || [], summary: s.summary || '',
    })),
    results: o.results || null,
    followups: o.followups || [],
    venue: venue || null,
    created_by_email: o.created_by_email,
    created_at: o.created_at,
    updated_at: o.updated_at,
    opened_at: o.opened_at,
    can: { plan: true, create: o.status !== 'created' && !busy && !problems.length, areas: acc.areas },
  }
}

/** Takes the opening for a step (a lease, so two tabs can't run one at once). */
async function lease(req, id, statuses) {
  return withTenant(req.tenantId, async tx => {
    const o = await ownOpening(tx, req.tenantId, id, true)
    if (o.busy_until && new Date(o.busy_until) > new Date()) throw httpError(409, ASSISTANT_NAME + ' is still working on this. Wait a moment and try again.')
    if (!statuses.includes(o.status)) throw httpError(422, o.status === 'created' ? 'This location has already been created.' : 'That can\'t be done at this step.')
    await tx`UPDATE store_openings SET busy_until = now() + make_interval(secs => ${LEASE_SECS}) WHERE id = ${id} AND tenant_id = ${req.tenantId}`
    return o
  })
}
const release = (req, id) => withTenant(req.tenantId, tx => tx`UPDATE store_openings SET busy_until = NULL WHERE id = ${id} AND tenant_id = ${req.tenantId}`)

const person = req => ({ sub: req.user?.sub, email: req.user?.email })

/** Runs one Pepper step on an opening and stores what comes back. */
async function runStep(req, o, step, extra = {}) {
  const acc = await access(req)
  const context = await withTenant(req.tenantId, tx => tenantContext(tx, req.tenantId))
  const plan = await withTenant(req.tenantId, tx => planOf(tx, req.tenantId, o))
  const tz = plan.venue.timezone
  const ans = await askPepper({
    tenantId: req.tenantId, person: person(req), step,
    opening: { ...o, plan: o.ai?.raw_plan ? plan : null },
    context, canSetUp: acc.areas, today: todayIn(tz), extra,
  })
  const status = ans.questions.length ? 'questions' : 'ready'
  const brief = ans.ready || status === 'ready'
    ? { ...ans.brief, headline: ans.brief.headline || ans.title || o.title, summary: ans.brief.summary || ans.summary }
    : (o.ai?.brief || null)
  const entry = {
    kind: step, at: new Date().toISOString(), by: req.user?.sub || null, by_email: req.user?.email || null,
    ...(step === 'answers' ? { answers: extra.answers } : {}),
    ...(step === 'deep_dive' ? { area: extra.area } : {}),
    ...(step === 'change' ? { request: extra.request } : {}),
    questions: ans.questions, summary: ans.summary,
  }
  // Address details are never cleared by a later step: Pepper sometimes
  // leaves out what it was told earlier.
  const before = o.ai?.raw_plan?.location || {}
  const location = { ...(ans.rawPlan.location || {}) }
  for (const [k, v] of Object.entries(before)) if (v && !String(location[k] || '').trim()) location[k] = v
  return withTenant(req.tenantId, async tx => {
    const ai = { summary: ans.summary, questions: ans.questions, brief, areas: ans.areas, raw_plan: { ...ans.rawPlan, location } }
    const [row] = await tx`
      UPDATE store_openings
         SET ai = ${tx.json(ai)}, status = ${status},
             title = ${o.overrides?.title ? o.title : (ans.title || o.title)},
             steps = steps || ${tx.json([entry])}::jsonb,
             rounds = ${step === 'scope' || step === 'answers' ? Math.min(MAX_ROUNDS, ans.round) : o.rounds},
             busy_until = NULL, updated_at = now()
       WHERE id = ${o.id} AND tenant_id = ${req.tenantId}
       RETURNING *`
    if (!row) throw httpError(404, 'Opening not found')
    return view(tx, req, row, acc)
  })
}

/** Pepper must be set up on the server and switched on for the group. */
async function pepperReady(tenantId) {
  if (!(await chatConfigured())) throw httpError(503, ASSISTANT_NAME + ' isn\'t set up on this server: a platform admin adds the AI key on the Platform page.')
  if (!(await getAiSettings(tenantId)).staff_enabled) throw httpError(403, ASSISTANT_NAME + ' is switched off for your group (' + ASSISTANT_NAME + ' > Settings).')
}

async function stepRoute(req, id, statuses, step, extra) {
  await pepperReady(req.tenantId)
  const o = await lease(req, id, statuses)
  try {
    return await runStep(req, o, step, extra)
  } catch (err) {
    await release(req, id).catch(() => {})
    throw err
  }
}

const OverridesBody = z.object({
  title: z.string().trim().min(1).max(80).optional(),
  overrides: z.object({
    venue: z.object({
      name: z.string().trim().min(1).max(120).optional(),
      slug: z.string().trim().min(1).max(60).regex(/^[a-z0-9-]+$/, 'Use lower case letters, numbers and hyphens').optional(),
      timezone: z.string().trim().min(1).max(60).optional(),
      currency: z.string().trim().length(3).optional(),
    }).optional(),
    location: z.object(Object.fromEntries(['address_line1', 'address_line2', 'city', 'postcode', 'country', 'phone', 'email']
      .map(k => [k, z.string().trim().max(120).optional()]))).optional(),
    opening_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal('')).nullable().optional(),
    template_venue_id: UUID.nullable().optional(),
    modes: z.record(z.enum(AREA_KEYS), z.enum(MODES)).optional(),
  }).optional(),
})

export default async function storeOpeningRoutes(app) {
  app.addHook('preHandler', requireAuth)

  app.get('/', { preHandler: canView }, async req => {
    return withTenant(req.tenantId, tx => tx`
      SELECT o.id, o.title, o.status, o.venue_id, v.name AS venue_name, o.created_by_email, o.created_at, o.updated_at, o.opened_at,
             (o.busy_until IS NOT NULL AND o.busy_until > now()) AS busy
        FROM store_openings o LEFT JOIN venues v ON v.id = o.venue_id AND v.tenant_id = o.tenant_id
       WHERE o.tenant_id = ${req.tenantId}
       ORDER BY o.updated_at DESC
       LIMIT 100`)
  })

  app.get('/:id', { preHandler: canView }, async req => {
    const id = UUID.parse(req.params.id)
    return withTenant(req.tenantId, async tx => view(tx, req, await ownOpening(tx, req.tenantId, id)))
  })

  app.post('/', { preHandler: canPlan, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = z.object({
      input: z.string().trim().min(10, 'Tell ' + ASSISTANT_NAME + ' a little about the new location (a sentence or two)').max(6000),
      template_venue_id: UUID.nullable().optional(),
    }).parse(req.body)
    await pepperReady(req.tenantId)
    const o = await withTenant(req.tenantId, async tx => {
      if (body.template_venue_id && !(await templateIds(tx, req.tenantId)).has(body.template_venue_id)) throw httpError(404, 'Location not found')
      const overrides = body.template_venue_id ? { template_venue_id: body.template_venue_id } : {}
      const [row] = await tx`
        INSERT INTO store_openings (tenant_id, input, overrides, created_by, created_by_email, busy_until)
        VALUES (${req.tenantId}, ${body.input}, ${tx.json(overrides)}, ${req.user?.sub || null}, ${req.user?.email || null},
                now() + make_interval(secs => ${LEASE_SECS}))
        RETURNING *`
      return row
    })
    try {
      return reply.code(201).send(await runStep(req, o, 'scope'))
    } catch (err) {
      // The draft stays, with what went wrong: the page shows it with a Try again.
      await release(req, o.id).catch(() => {})
      if (!err.statusCode || err.statusCode >= 500) req.log.warn({ err: err.message }, 'Store opening scope failed')
      const out = await withTenant(req.tenantId, async tx => view(tx, req, await ownOpening(tx, req.tenantId, o.id)))
      return reply.code(201).send({ ...out, error: err.statusCode ? err.message : ASSISTANT_NAME + ' couldn\'t look at this just now. Try again in a moment.' })
    }
  })

  // A draft whose first look failed (Claude busy): try it again.
  app.post('/:id/scope', { preHandler: canPlan }, async req => {
    const id = UUID.parse(req.params.id)
    return stepRoute(req, id, ['draft'], 'scope')
  })

  app.post('/:id/answers', { preHandler: canPlan }, async req => {
    const id = UUID.parse(req.params.id)
    const { answers } = z.object({
      answers: z.record(z.string().max(60), z.string().max(2000)).refine(a => Object.keys(a).length <= 30, 'Too many answers'),
    }).parse(req.body)
    return stepRoute(req, id, ['questions', 'ready'], 'answers', { answers })
  })

  app.post('/:id/deep-dive', { preHandler: canPlan }, async req => {
    const id = UUID.parse(req.params.id)
    const { area } = z.object({ area: z.enum([...AREA_KEYS, 'basics']) }).parse(req.body)
    return stepRoute(req, id, ['questions', 'ready'], 'deep_dive', { area })
  })

  app.post('/:id/change', { preHandler: canPlan }, async req => {
    const id = UUID.parse(req.params.id)
    const { request } = z.object({ request: z.string().trim().min(3).max(2000) }).parse(req.body)
    return stepRoute(req, id, ['questions', 'ready'], 'change', { request })
  })

  app.patch('/:id', { preHandler: canManage }, async req => {
    const id = UUID.parse(req.params.id)
    const body = OverridesBody.parse(req.body)
    return withTenant(req.tenantId, async tx => {
      const o = await ownOpening(tx, req.tenantId, id, true)
      if (o.status === 'created') throw httpError(422, 'This location has already been created.')
      const next = { ...(o.overrides || {}) }
      const ov = body.overrides || {}
      if (ov.venue) next.venue = { ...(next.venue || {}), ...ov.venue }
      if (ov.location) next.location = { ...(next.location || {}), ...ov.location }
      if (ov.opening_date !== undefined) next.opening_date = ov.opening_date || null
      if (ov.template_venue_id !== undefined) {
        if (ov.template_venue_id && !(await templateIds(tx, req.tenantId)).has(ov.template_venue_id)) throw httpError(404, 'Location not found')
        next.template_venue_id = ov.template_venue_id
      }
      if (ov.modes) next.modes = { ...(next.modes || {}), ...ov.modes }
      if (body.title) next.title = true
      const [row] = await tx`
        UPDATE store_openings SET overrides = ${tx.json(next)}, title = ${body.title || o.title}, updated_at = now()
         WHERE id = ${id} AND tenant_id = ${req.tenantId} RETURNING *`
      return view(tx, req, row)
    })
  })

  app.post('/:id/create', { preHandler: canManage }, async req => {
    const id = UUID.parse(req.params.id)
    const acc = await access(req)
    return withTenant(req.tenantId, async tx => {
      const o = await ownOpening(tx, req.tenantId, id, true)
      if (o.status === 'created') throw httpError(422, 'This location has already been created.')
      if (o.busy_until && new Date(o.busy_until) > new Date()) throw httpError(409, ASSISTANT_NAME + ' is still working on this. Wait a moment and try again.')
      if (o.status === 'draft' || !o.ai?.raw_plan) throw httpError(422, ASSISTANT_NAME + ' hasn\'t scoped this location yet.')
      const plan = await planOf(tx, req.tenantId, o)
      const problems = planProblems(plan)
      if (!validZone(plan.venue.timezone)) problems.push('"' + plan.venue.timezone + '" isn\'t a time zone we know.')
      if (problems.length) throw httpError(422, problems.join(' '))
      const today = todayIn(plan.venue.timezone)
      const { venue, results } = await createStore(tx, {
        tenantId: req.tenantId, plan, by: req.user?.email || req.user?.sub || null,
        allowed: acc.allowed, allowedModule: acc.allowedModule, today,
      })
      const template = plan.template_venue_id ? await venueSummary(tx, req.tenantId, plan.template_venue_id) : null
      const finalPlan = { ...plan, venue: { ...plan.venue, slug: venue.slug } }
      const followups = buildFollowups({ plan: finalPlan, results, template, brief: o.ai?.brief, venueName: venue.name })
      const [row] = await tx`
        UPDATE store_openings
           SET status = 'created', venue_id = ${venue.id}, plan = ${tx.json(finalPlan)}, results = ${tx.json(results)},
               followups = ${tx.json(followups)}, opened_at = now(), opened_by = ${req.user?.email || req.user?.sub || null},
               updated_at = now()
         WHERE id = ${id} AND tenant_id = ${req.tenantId}
         RETURNING *`
      req.log.info({ opening: id, venue: venue.id }, 'New location created from a store opening')
      return view(tx, req, row, acc)
    })
  })

  app.patch('/:id/followups/:key', { preHandler: canManage }, async req => {
    const id = UUID.parse(req.params.id)
    const key = z.string().min(1).max(60).parse(req.params.key)
    const { done } = z.object({ done: z.boolean() }).parse(req.body)
    return withTenant(req.tenantId, async tx => {
      const o = await ownOpening(tx, req.tenantId, id, true)
      const list = o.followups || []
      if (!list.some(f => f.key === key)) throw httpError(404, 'That follow-up isn\'t on the list')
      const next = list.map(f => (f.key === key ? { ...f, done, done_at: done ? new Date().toISOString() : null, done_by: done ? req.user?.email || null : null } : f))
      const [row] = await tx`UPDATE store_openings SET followups = ${tx.json(next)}, updated_at = now() WHERE id = ${id} AND tenant_id = ${req.tenantId} RETURNING *`
      return view(tx, req, row)
    })
  })

  app.delete('/:id', { preHandler: canManage }, async req => {
    const id = UUID.parse(req.params.id)
    return withTenant(req.tenantId, async tx => {
      const o = await ownOpening(tx, req.tenantId, id, true)
      if (o.status === 'created') throw httpError(422, 'A location that was created stays on the list. Remove the location itself on the Venues page.')
      await tx`DELETE FROM store_openings WHERE id = ${id} AND tenant_id = ${req.tenantId}`
      return { ok: true }
    })
  })
}
