// src/routes/reports.js
//
// The report builder's API (docs/REPORTS.md 18, migration 243), mounted at
// /api/reports. A report runs as the person looking at it: what data they
// see is decided by the engine (src/reports/run.js) from the modules their
// role has; who may open, change and share a report is src/reports/access.js.
//
//   GET    /catalogue        the subjects, fields, measures and links the
//                            person may report on (no SQL)
//   GET    /                 the reports the person can open, and the starters
//   POST   /                 save a new one (Use)
//   POST   /preview          run a definition that isn't saved (Use; the builder)
//   POST   /plan             a report from a plan (src/reports/plan.js: paths,
//                            not a definition), built through the builder's
//                            edits and run, nothing saved (Use; Pepper's
//                            report tools)
//   POST   /export           a file of a definition that isn't saved (Use)
//   GET    /:id              one report with its definition
//   PUT    /:id              change it (its owner with Use, or Manage)
//   DELETE /:id              delete it (the same)
//   PATCH  /:id/sharing      who it is shared with; a starter for the team (Manage)
//   POST   /:id/run          run it, or a drill-down of it (View)
//   POST   /:id/export       a CSV or Excel file of it (Use)
//   POST   /:id/print-link   a link to its print page that lasts a few minutes (View)
//   GET    /print/:linkId    the print page (no login: the link is the key;
//                            reportPrintRoutes, its own plugin)
//   POST   /:id/copy         a copy of it, or of a starter, as the person's own (Use)
//   POST   /:id/star         star it       DELETE /:id/star   take the star off
//
// `:id` is a saved report's id, or 'starter:<key>' for a starter report in
// code (src/reports/starters). A drill-down is made by the server from the
// report's own definition (shared/reports/drill.js), so someone who may only
// run a report can drill into it without running a definition of their own.
//
// Printing (docs/REPORTS.md 13): a new browser tab can't send the admin's
// login, so Print makes a link (report_print_links, migration 244) holding
// what is on the person's screen (the definition, their choices, the rows
// they opened up, what their role may see), and the page it opens runs the
// report as that person. The same way a draft menu's print preview works.

import crypto from 'node:crypto'
import { z } from 'zod'
import { withTenant, systemSql } from '../config/db.js'
import { requireAuth, requirePermission } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { ownRoleIds } from '../services/roles.js'
import { AREAS, CATALOGUE, catalogueView, listColumns } from '../reports/catalogue/index.js'
import { STARTERS, STARTER_PREFIX, starterByKey } from '../reports/starters/index.js'
import { ReportError } from '../reports/compile.js'
import { runReport, currencyPath } from '../reports/run.js'
import { reportPerson, rightsOn, openTo, runsFor, checkedSpec, recordRun, refuseOtherVenues, groupVenues } from '../reports/access.js'
import { PLAN, planReport } from '../reports/plan.js'
import { csvExport } from '../reports/export/csv.js'
import { xlsxExport } from '../reports/export/xlsx.js'
import { fileName } from '../reports/export/table.js'
import { printHtml, messageHtml } from '../reports/export/print.js'
import { brandColours } from '../services/themeColours.js'
import { normaliseReport, reportProblems, resolveParams, LIMITS } from '../../../shared/reports/spec.js'
import { cleanDrill, drillSpec } from '../../../shared/reports/drill.js'
import { paramInputs, paramWords } from '../../../shared/reports/build.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_OWN = 300        // saved reports per person
const MAX_LIST = 1000      // saved reports listed
const MAX_DRILL = 10       // drill steps in one request
const PREVIEW_ROWS = 200
const PRINT_MINUTES = 15   // how long a print link works
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const Name = z.string().trim().min(1).max(LIMITS.name)
const Description = z.string().trim().max(1000).nullable()
const Tags = z.array(z.string().trim().min(1).max(30)).max(LIMITS.tags)
// A definition is tidied and checked by normaliseReport(), not by its shape here.
const Spec = z.record(z.any())
const Params = z.record(z.any())
const Drill = z.array(z.record(z.any())).max(MAX_DRILL)

const NewReport = z.object({
  name: Name,
  description: Description.optional(),
  spec: Spec,
  tags: Tags.optional(),
  starter_key: z.string().max(60).nullable().optional(),
})
const EditReport = z.object({
  name: Name.optional(),
  description: Description.optional(),
  spec: Spec.optional(),
  tags: Tags.optional(),
})
const Sharing = z.object({
  shared: z.enum(['private', 'roles', 'everyone']).optional(),
  role_ids: z.array(z.string().uuid()).max(50).optional(),
  is_starter: z.boolean().optional(),
})
const RunBody = z.object({
  params: Params.optional(),
  drill: Drill.optional(),
  fresh: z.boolean().optional(),
})
const PreviewBody = RunBody.extend({
  spec: Spec,
  rows: z.number().int().min(1).max(5000).optional(),
})
// A plan, and the definition it changes (what a plan can't say is kept from it).
const PlanBody = z.object({
  plan: PLAN,
  report: Spec.nullable().optional(),
  rows: z.number().int().min(1).max(PREVIEW_ROWS).optional(),
})
const Format = z.enum(['csv', 'xlsx'])
const ExportBody = z.object({ format: Format, params: Params.optional(), drill: Drill.optional() })
const ExportUnsaved = ExportBody.extend({ spec: Spec, name: Name.optional() })
const CopyBody = z.object({ name: Name.optional() })
// What is on the person's screen: their choices, the rows they opened up
// (with the trail's words for the page's heading), whether the table is
// showing under a chart, and the series switched off in the chart's legend.
const PrintBody = z.object({
  params: Params.optional(),
  drill: Drill.optional(),
  trail: z.array(z.object({
    label: z.string().max(200).optional(),
    by: z.string().max(80).optional(),
    of: z.string().max(80).optional(),
  })).max(MAX_DRILL).optional(),
  table: z.boolean().optional(),
  hidden: z.array(z.string().min(1).max(200)).max(40).optional(),
})

const cleanTags = tags => [...new Set((tags || []).map(t => t.toLowerCase()))]

// ── What the browser gets ────────────────────────────────────

function savedView(row, p, starred, withSpec = false) {
  const rights = rightsOn(row, p)
  const spec = withSpec ? normaliseReport(row.spec) : null
  return {
    id: row.id,
    kind: 'saved',
    name: row.name,
    description: row.description,
    subject: row.subject,
    area: CATALOGUE.subjects[row.subject]?.area || null,
    report_kind: spec ? spec.kind : row.report_kind,
    view: spec ? spec.view.kind : row.view_kind || 'table',
    mine: row.owner_sub === p.sub,
    owner_email: row.owner_email,
    shared: row.shared,
    shared_role_ids: row.shared_role_ids || [],
    is_starter: row.is_starter,
    starter_key: row.starter_key,
    tags: row.tags || [],
    last_run_at: row.last_run_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    starred: !!starred,
    can_edit: rights.edit,
    can_delete: rights.edit,
    can_share: rights.share,
    ...runsFor(row.subject, p.levels),
    ...(spec ? { spec } : {}),
  }
}

function starterView(s, p, starred, withSpec = false) {
  return {
    id: s.ref,
    kind: 'starter',
    name: s.name,
    description: s.about,
    subject: s.subject,
    area: s.area,
    report_kind: s.spec.kind,
    view: s.spec.view.kind,
    mine: false,
    owner_email: null,
    shared: 'everyone',
    shared_role_ids: [],
    is_starter: true,
    starter_key: s.key,
    tags: [],
    last_run_at: null,
    created_at: null,
    updated_at: null,
    starred: !!starred,
    can_edit: false,
    can_delete: false,
    can_share: false,
    ...runsFor(s.subject, p.levels),
    ...(withSpec ? { spec: s.spec } : {}),
  }
}

// ── Finding a report ─────────────────────────────────────────

const notFound = () => httpError(404, 'Report not found')
const BUILT_IN = 'This starter report comes with Macaroonie. Make a copy to change it'

const starterOf = id => (typeof id === 'string' && id.startsWith(STARTER_PREFIX) ? starterByKey(id.slice(STARTER_PREFIX.length)) : null)

async function savedRow(tx, id, p) {
  if (!UUID_RE.test(id)) return null
  const [row] = await tx`SELECT r.* FROM reports r WHERE r.tenant_id = ${p.tenantId} AND r.id = ${id}`
  return row && rightsOn(row, p).open ? row : null
}

// A saved report the person can open (a starter in code is refused with `why`, else 404).
async function loadSaved(id, p, why = BUILT_IN) {
  if (starterOf(id)) throw httpError(422, why)
  const row = await withTenant(p.tenantId, tx => savedRow(tx, String(id), p))
  if (!row) throw notFound()
  return row
}

// What a run, a file or a copy starts from: a saved report or a starter.
async function loadTarget(id, p) {
  const starter = starterOf(id)
  if (starter) return { ref: starter.ref, starter, name: starter.name, description: starter.about, spec: starter.spec }
  const saved = await withTenant(p.tenantId, tx => savedRow(tx, String(id), p))
  if (!saved) throw notFound()
  return { ref: saved.id, saved, name: saved.name, description: saved.description, spec: checkedForRun(saved.spec) }
}

// A stored definition as it is today (the tidying may have moved on since it was saved).
function checkedForRun(raw) {
  const spec = normaliseReport(raw)
  const problems = reportProblems(spec)
  if (problems.length) throw new ReportError(problems)
  return spec
}

const isStarred = (tx, p, ref) => tx`
  SELECT 1 FROM report_stars WHERE tenant_id = ${p.tenantId} AND user_sub = ${p.sub} AND report_ref = ${ref}`.then(r => r.length > 0)

// ── Running ──────────────────────────────────────────────────

const drillSteps = raw => (raw || []).map(step => {
  const d = cleanDrill(step)
  if (!d) throw new ReportError('That isn\'t something this report can open')
  return d
})

// The definition a chain of drill steps leads to, each made from the one before.
function drilled(spec, steps, levels) {
  let cur = spec
  for (const step of steps) {
    const next = drillSpec(cur, step, { listColumns: listColumns(cur.subject, levels), also: [currencyPath(cur.subject)] })
    if (next.problem) throw new ReportError(next.problem)
    cur = next.spec
  }
  return cur
}

const errorText = e => (e?.statusCode && e.statusCode < 500 ? e.message : 'The report failed')

// The venues a run was for, in words (for a file's About sheet).
async function venuesText(p, spec, params) {
  const param = spec.params.find(x => x.type === 'venues')
  if (!param) return null
  const ids = params[param.key]
  if (!Array.isArray(ids) || !ids.length) return 'All venues'
  const rows = await withTenant(p.tenantId, tx => tx`
    SELECT name FROM venues WHERE tenant_id = ${p.tenantId} AND id = ANY(${ids}::uuid[]) ORDER BY name`)
  return rows.length ? rows.map(r => r.name).join(', ') : 'All venues'
}

async function sendFile(req, reply, p, target, body) {
  const started = Date.now()
  const steps = drillSteps(body.drill)
  const given = body.params || {}
  await refuseOtherVenues(p, target.spec, given)
  const base = { kind: 'export', format: body.format, saved: target.saved, starter: target.starter, name: target.name, spec: target.spec, drill: steps }
  const record = extra => recordRun(p, { ...base, params: resolveParams(target.spec, given), ms: Date.now() - started, ...extra }, req.log)
  const attach = ext => reply.header('content-disposition', 'attachment; filename="' + fileName(target.name, ext) + '"')
  try {
    const spec = drilled(target.spec, steps, p.levels)
    if (body.format === 'xlsx') {
      const out = await xlsxExport(p.ctx, spec, given, {
        name: target.name,
        description: target.description,
        by: p.email,
        venues: await venuesText(p, target.spec, resolveParams(target.spec, given)),
      })
      await record({ rows: out.rows })
      return attach('xlsx').header('content-type', XLSX_TYPE).send(out.buffer)
    }
    const out = await csvExport(p.ctx, spec, given, { finish: r => record({ rows: r.rows }) })
    if (out.stream) out.done.catch(e => record({ error: errorText(e) }))
    else await record({ rows: (await out.done).rows })
    return attach('csv').header('content-type', 'text/csv; charset=utf-8').send(out.stream || out.text)
  } catch (e) {
    await record({ error: errorText(e) })
    throw e
  }
}

// ── Printing ─────────────────────────────────────────────────

const lowerFirst = s => (s && /^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s || '')
const upperFirst = s => (s ? s[0].toUpperCase() + s.slice(1) : '')

// Where the person had got to, as the trail on the page says it: "All, then
// Mains (by dish), then Pad Thai (dishes sold behind Net sales)".
function trailText(steps, trail) {
  if (!steps.length) return null
  return ['All', ...steps.map((s, i) => {
    const t = trail[i] || {}
    const how = s.to === 'rows' ? lowerFirst(t.by) || 'the rows' : 'by ' + (lowerFirst(t.by) || 'another field')
    return (t.label || 'A row') + ' (' + how + (s.to === 'rows' && t.of ? ' behind ' + t.of : '') + ')'
  })].join(', then ')
}

// What the page says the report was run for: its period, what it is
// compared with, its venues and other choices, and the rows opened up.
function printFacts({ base, result, levels, values, venues, steps, trail }) {
  const meta = result.meta || {}
  const facts = [['Period', meta.period?.text || 'Every date']]
  if (meta.compare?.text) facts.push(['Compared with', meta.compare.text])
  // The report's own period is said above with its dates: not again as a choice.
  let own = !!meta.period
  const catalogue = catalogueView(levels)
  for (const input of paramInputs(catalogue, base)) {
    if (own && input.type === 'period' && input.path === 'date' && !input.bucket && input.subject === base.subject) { own = false; continue }
    const words = paramWords(catalogue, input, values[input.key], { venues, currency: meta.currency })
    // The words are made to follow the choice's name in a sentence ("every venue"): here they stand alone.
    if (words) facts.push([input.label, upperFirst(words)])
  }
  const opened = trailText(steps, trail)
  if (opened) facts.push(['Opened up', opened])
  const rows = meta.row_count ?? result.rows.length
  facts.push(['Rows', rows.toLocaleString('en-GB')])
  return facts
}

// A page nobody should keep, pass on or put in a frame, that loads nothing
// but its own logo and runs nothing but its own print button.
function printHeaders(reply, nonce = null) {
  return reply
    .header('Cache-Control', 'private, no-store')
    .header('Referrer-Policy', 'no-referrer')
    .header('X-Robots-Tag', 'noindex, nofollow')
    .header('Content-Security-Policy', 'default-src \'none\'; style-src \'unsafe-inline\'; '
      + (nonce ? 'script-src \'nonce-' + nonce + '\'; ' : '') + 'img-src \'self\' https: data:; base-uri \'none\'; form-action \'none\'; frame-ancestors \'none\'')
    .type('text/html; charset=utf-8')
}

/**
 * The print page: GET /api/reports/print/:linkId. Its own plugin, without
 * the login the other report routes ask for: a new tab can't send it, so the
 * link (a random id that works for a few minutes) is the key. The report is
 * run as the person who pressed Print, with what their role could see then.
 */
export async function reportPrintRoutes(app) {
  app.get('/print/:linkId', async (req, reply) => {
    const say = (code, title, text) => printHeaders(reply.code(code)).send(messageHtml(title, text))
    const gone = () => say(410, 'This print page has run out', 'A print page works for ' + PRINT_MINUTES + ' minutes. Go back to the report and press Print again.')
    const id = String(req.params.linkId || '')
    // System mode: the link says which group it belongs to.
    const [link] = UUID_RE.test(id) ? await systemSql`SELECT * FROM report_print_links WHERE id = ${id}` : []
    if (!link) return say(404, 'This print page isn\'t there', 'Go back to the report and press Print again.')
    if (new Date(link.expires_at).getTime() <= Date.now()) return gone()

    const p = {
      tenantId: link.tenant_id, sub: link.user_sub, email: link.user_email, levels: link.levels || {},
      ctx: { tenantId: link.tenant_id, userKey: link.user_sub, levels: link.levels || {} },
    }
    const started = Date.now()
    const base = normaliseReport(link.spec)
    const steps = Array.isArray(link.drill) ? link.drill : []
    const given = link.params || {}
    const values = resolveParams(base, given)
    const record = extra => recordRun(p, {
      kind: 'export', format: 'print', name: link.name, spec: base, drill: steps, params: values,
      saved: UUID_RE.test(link.report_ref) ? { id: link.report_ref } : null, starter: starterOf(link.report_ref),
      ms: Date.now() - started, ...extra,
    }, req.log)
    try {
      const result = await runReport(p.ctx, drilled(base, steps, p.levels), given)
      const about = await withTenant(p.tenantId, async tx => {
        const [group] = await tx`
          SELECT t.name, ts.brand_name, ts.logo_url
            FROM tenants t LEFT JOIN tenant_site ts ON ts.tenant_id = t.id
           WHERE t.id = ${p.tenantId}`
        const venues = await tx`SELECT id, name FROM venues WHERE tenant_id = ${p.tenantId} ORDER BY name`
        return { group, venues, colours: await brandColours(tx, p.tenantId) }
      })
      const nonce = crypto.randomBytes(16).toString('base64')
      const html = printHtml({
        group: about.group?.brand_name || about.group?.name || '',
        logo: about.group?.logo_url || null,
        brand: about.colours.primary,
        name: link.name,
        description: link.description,
        facts: printFacts({ base, result, levels: p.levels, values, venues: about.venues, steps, trail: Array.isArray(link.trail) ? link.trail : [] }),
        result,
        table: link.show_table,
        hidden: Array.isArray(link.hidden) ? link.hidden : [],
        by: link.user_email,
        expires: link.expires_at,
        nonce,
      })
      await record({ rows: result.meta.row_count })
      return printHeaders(reply, nonce).send(html)
    } catch (e) {
      await record({ error: errorText(e) })
      if (e?.statusCode && e.statusCode < 500) {
        return say(e.statusCode, 'This report can\'t be printed', (Array.isArray(e.problems) && e.problems.length ? e.problems.join(' ') : e.message) || 'Go back to the report and try again.')
      }
      throw e
    }
  })
}

// ── Routes ───────────────────────────────────────────────────

export default async function reportRoutes(app) {
  app.addHook('preHandler', requireAuth)

  const view = { preHandler: requirePermission('reports', 'view') }
  const use = { preHandler: requirePermission('reports', 'use') }
  const manage = { preHandler: requirePermission('reports', 'manage') }

  app.get('/catalogue', view, async req => {
    const p = await reportPerson(req)
    return { level: p.level, can_use: p.canUse, can_manage: p.canManage, ...catalogueView(p.levels) }
  })

  app.get('/', view, async req => {
    const p = await reportPerson(req)
    const { rows, stars } = await withTenant(p.tenantId, async tx => {
      const rows = await tx`
        SELECT r.id, r.name, r.description, r.subject, r.spec->>'kind' AS report_kind, r.spec->'view'->>'kind' AS view_kind,
               r.owner_sub, r.owner_email, r.shared, r.shared_role_ids, r.is_starter, r.starter_key, r.tags,
               r.last_run_at, r.created_at, r.updated_at
          FROM reports r
         WHERE r.tenant_id = ${p.tenantId} AND ${openTo(tx, p)}
         ORDER BY r.updated_at DESC, r.id
         LIMIT ${MAX_LIST}`
      const stars = await tx`SELECT report_ref FROM report_stars WHERE tenant_id = ${p.tenantId} AND user_sub = ${p.sub}`
      return { rows, stars: new Set(stars.map(s => s.report_ref)) }
    })
    return {
      level: p.level,
      can_use: p.canUse,
      can_manage: p.canManage,
      areas: AREAS,
      reports: rows.map(r => savedView(r, p, stars.has(r.id))),
      starters: STARTERS.map(s => starterView(s, p, stars.has(s.ref))),
    }
  })

  app.post('/', use, async (req, reply) => {
    const body = NewReport.parse(req.body)
    const p = await reportPerson(req)
    const { spec } = checkedSpec(body.spec, p)
    await refuseOtherVenues(p, spec)
    const starterKey = body.starter_key && starterByKey(body.starter_key) ? body.starter_key : null
    const row = await withTenant(p.tenantId, async tx => {
      const [{ n }] = await tx`SELECT count(*)::int AS n FROM reports WHERE tenant_id = ${p.tenantId} AND owner_sub = ${p.sub}`
      if (n >= MAX_OWN) throw httpError(422, 'You have ' + MAX_OWN + ' reports. Delete one you no longer need first')
      const [r] = await tx`
        INSERT INTO reports (tenant_id, name, description, subject, spec, owner_sub, owner_email, starter_key, tags)
        VALUES (${p.tenantId}, ${body.name}, ${body.description || null}, ${spec.subject}, ${tx.json(spec)},
                ${p.sub}, ${p.email}, ${starterKey}, ${cleanTags(body.tags)}::text[])
        RETURNING *`
      return r
    })
    return reply.code(201).send({ report: savedView(row, p, false, true) })
  })

  app.post('/preview', use, async req => {
    const body = PreviewBody.parse(req.body)
    const p = await reportPerson(req)
    const base = checkedForRun(body.spec)
    await refuseOtherVenues(p, base, body.params || {})
    const spec = drilled(base, drillSteps(body.drill), p.levels)
    return runReport(p.ctx, spec, body.params || {}, { cap: body.rows ?? PREVIEW_ROWS, fresh: !!body.fresh })
  })

  app.post('/plan', use, async req => {
    const body = PlanBody.parse(req.body)
    const p = await reportPerson(req)
    let report = null
    if (body.report) {
      report = normaliseReport(body.report)
      await refuseOtherVenues(p, report)
    }
    const venues = await groupVenues(p)
    return planReport(p, {
      plan: body.plan,
      report,
      venues: venues.map(v => ({ id: v.id, name: v.name })),
      cap: body.rows ?? PREVIEW_ROWS,
    })
  })

  app.post('/export', use, async (req, reply) => {
    const body = ExportUnsaved.parse(req.body)
    const p = await reportPerson(req)
    const spec = checkedForRun(body.spec)
    return sendFile(req, reply, p, { name: body.name || 'Report', description: null, spec }, body)
  })

  app.get('/:id', view, async req => {
    const p = await reportPerson(req)
    const starter = starterOf(req.params.id)
    if (starter) {
      const starred = await withTenant(p.tenantId, tx => isStarred(tx, p, starter.ref))
      return { report: starterView(starter, p, starred, true) }
    }
    const out = await withTenant(p.tenantId, async tx => {
      const row = await savedRow(tx, String(req.params.id), p)
      return row ? { row, starred: await isStarred(tx, p, row.id) } : null
    })
    if (!out) throw notFound()
    return { report: savedView(out.row, p, out.starred, true) }
  })

  app.put('/:id', use, async req => {
    const body = EditReport.parse(req.body)
    const p = await reportPerson(req)
    const before = await loadSaved(req.params.id, p)
    if (!rightsOn(before, p).edit) throw httpError(403, 'Only the person who made this report, or someone with Manage on Reports, can change it')
    const spec = body.spec ? checkedSpec(body.spec, p).spec : null
    if (spec) await refuseOtherVenues(p, spec)
    const out = await withTenant(p.tenantId, async tx => {
      const [row] = await tx`
        UPDATE reports
           SET name = ${body.name ?? before.name},
               description = ${body.description === undefined ? before.description : body.description || null},
               subject = ${spec ? spec.subject : before.subject},
               spec = ${spec ? tx.json(spec) : tx.json(before.spec)},
               tags = ${body.tags ? cleanTags(body.tags) : before.tags}::text[],
               updated_at = now()
         WHERE tenant_id = ${p.tenantId} AND id = ${before.id}
         RETURNING *`
      return row ? { row, starred: await isStarred(tx, p, row.id) } : null
    })
    if (!out) throw notFound()
    return { report: savedView(out.row, p, out.starred, true) }
  })

  app.delete('/:id', use, async (req, reply) => {
    const p = await reportPerson(req)
    const before = await loadSaved(req.params.id, p, 'This starter report comes with Macaroonie and can\'t be deleted')
    if (!rightsOn(before, p).edit) throw httpError(403, 'Only the person who made this report, or someone with Manage on Reports, can delete it')
    await withTenant(p.tenantId, async tx => {
      await tx`DELETE FROM report_stars WHERE tenant_id = ${p.tenantId} AND report_ref = ${before.id}`
      await tx`DELETE FROM reports WHERE tenant_id = ${p.tenantId} AND id = ${before.id}`
    })
    return reply.code(204).send()
  })

  app.patch('/:id/sharing', manage, async req => {
    const body = Sharing.parse(req.body)
    const p = await reportPerson(req)
    const before = await loadSaved(req.params.id, p, 'This starter report comes with Macaroonie and is already open to everyone with Reports')
    const shared = body.shared ?? before.shared
    const out = await withTenant(p.tenantId, async tx => {
      let roleIds = []
      if (shared === 'roles') {
        roleIds = await ownRoleIds(tx, p.tenantId, body.role_ids ?? before.shared_role_ids ?? [])
        if (!roleIds.length) throw httpError(422, 'Pick at least one role to share this report with')
      }
      const [row] = await tx`
        UPDATE reports
           SET shared = ${shared}, shared_role_ids = ${roleIds}::uuid[],
               is_starter = ${body.is_starter ?? before.is_starter}, updated_at = now()
         WHERE tenant_id = ${p.tenantId} AND id = ${before.id}
         RETURNING *`
      return row ? { row, starred: await isStarred(tx, p, row.id) } : null
    })
    if (!out) throw notFound()
    return { report: savedView(out.row, p, out.starred, true) }
  })

  app.post('/:id/run', view, async req => {
    const body = RunBody.parse(req.body || {})
    const p = await reportPerson(req)
    const target = await loadTarget(req.params.id, p)
    const started = Date.now()
    const steps = drillSteps(body.drill)
    const given = body.params || {}
    await refuseOtherVenues(p, target.spec, given)
    const base = { kind: 'run', saved: target.saved, starter: target.starter, name: target.name, spec: target.spec, drill: steps, params: resolveParams(target.spec, given) }
    try {
      const result = await runReport(p.ctx, drilled(target.spec, steps, p.levels), given, { fresh: !!body.fresh })
      await recordRun(p, { ...base, rows: result.meta.row_count, ms: Date.now() - started }, req.log)
      return { report: { id: target.ref, name: target.name }, ...result }
    } catch (e) {
      await recordRun(p, { ...base, ms: Date.now() - started, error: errorText(e) }, req.log)
      throw e
    }
  })

  app.post('/:id/export', use, async (req, reply) => {
    const body = ExportBody.parse(req.body)
    const p = await reportPerson(req)
    return sendFile(req, reply, p, await loadTarget(req.params.id, p), body)
  })

  // A link to the report's print page, as it is on the person's screen.
  app.post('/:id/print-link', view, async req => {
    const body = PrintBody.parse(req.body || {})
    const p = await reportPerson(req)
    const target = await loadTarget(req.params.id, p)
    const steps = drillSteps(body.drill)
    const given = body.params || {}
    await refuseOtherVenues(p, target.spec, given)
    // Refused here, in the app, not on a page in a new tab: rows that can't
    // be opened that way, a report the person's role can't run.
    checkedSpec(drilled(target.spec, steps, p.levels), p)
    const trail = body.trail?.length === steps.length ? body.trail : []
    const [link] = await withTenant(p.tenantId, async tx => {
      // Links that ran out go: the person's own at once, anyone's after a day.
      await tx`
        DELETE FROM report_print_links
         WHERE tenant_id = ${p.tenantId}
           AND (expires_at < now() - interval '1 day' OR (user_sub = ${p.sub} AND expires_at < now()))`
      return tx`
        INSERT INTO report_print_links (tenant_id, report_ref, name, description, spec, params, drill, trail, show_table, hidden,
                                        user_sub, user_email, levels, expires_at)
        VALUES (${p.tenantId}, ${target.ref}, ${target.name}, ${target.description || null}, ${tx.json(target.spec)},
                ${tx.json(given)}, ${tx.json(steps)}, ${tx.json(trail)}, ${body.table ?? null}, ${tx.json([...new Set(body.hidden || [])])},
                ${p.sub}, ${p.email}, ${tx.json(p.levels)}, now() + make_interval(mins => ${PRINT_MINUTES}))
        RETURNING id, expires_at`
    })
    return { path: '/api/reports/print/' + link.id, expires_at: link.expires_at }
  })

  app.post('/:id/copy', use, async (req, reply) => {
    const body = CopyBody.parse(req.body || {})
    const p = await reportPerson(req)
    const target = await loadTarget(req.params.id, p)
    // Checked as the person copying: it becomes theirs to run and change.
    const { spec } = checkedSpec(target.spec, p)
    const name = (body.name || (target.starter ? target.name : target.name + ' (copy)')).slice(0, LIMITS.name)
    const row = await withTenant(p.tenantId, async tx => {
      const [{ n }] = await tx`SELECT count(*)::int AS n FROM reports WHERE tenant_id = ${p.tenantId} AND owner_sub = ${p.sub}`
      if (n >= MAX_OWN) throw httpError(422, 'You have ' + MAX_OWN + ' reports. Delete one you no longer need first')
      const [r] = await tx`
        INSERT INTO reports (tenant_id, name, description, subject, spec, owner_sub, owner_email, starter_key, tags)
        VALUES (${p.tenantId}, ${name}, ${target.description || null}, ${spec.subject}, ${tx.json(spec)},
                ${p.sub}, ${p.email}, ${target.starter?.key ?? target.saved?.starter_key ?? null},
                ${target.saved?.tags || []}::text[])
        RETURNING *`
      return r
    })
    return reply.code(201).send({ report: savedView(row, p, false, true) })
  })

  app.post('/:id/star', view, async req => {
    const p = await reportPerson(req)
    const target = await loadTarget(req.params.id, p)
    await withTenant(p.tenantId, tx => tx`
      INSERT INTO report_stars (tenant_id, user_sub, report_ref) VALUES (${p.tenantId}, ${p.sub}, ${target.ref})
      ON CONFLICT DO NOTHING`)
    return { starred: true }
  })

  app.delete('/:id/star', view, async req => {
    const p = await reportPerson(req)
    // No look-up: a star on a report since deleted or unshared comes off too.
    const ref = starterOf(req.params.id)?.ref ?? (UUID_RE.test(String(req.params.id)) ? String(req.params.id).toLowerCase() : null)
    if (!ref) throw notFound()
    await withTenant(p.tenantId, tx => tx`
      DELETE FROM report_stars WHERE tenant_id = ${p.tenantId} AND user_sub = ${p.sub} AND report_ref = ${ref}`)
    return { starred: false }
  })
}
