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
//   POST   /:id/blocks/:blockId/run
//                            one report of a page, run with the page's period
//                            and venues or the visitor's own (View)
//   POST   /:id/export       a CSV, Excel or PDF file of it (Use); a page
//                            takes PDF only
//   POST   /:id/print-link   a link to its print page that lasts a few minutes
//                            (View). With `layout` (a layout being tried out)
//                            or `preview`: the Layouts page's preview (Manage)
//   GET    /print/:linkId    the print page (no login: the link is the key;
//                            reportPrintRoutes, its own plugin)
//   POST   /:id/copy         a copy of it, or of a starter, as the person's own (Use)
//   POST   /:id/star         star it       DELETE /:id/star   take the star off
//   GET    /runs             Past runs: the person's runs, downloads, prints
//                            and kept files, newest first; everyone's with
//                            Manage (View; src/reports/runs.js)
//   POST   /:id/files        keep a CSV, Excel or PDF file of it for the person
//                            who makes it (Use; src/reports/files.js, Past runs)
//   GET    /files/:fileId    a kept file, to the person who made it (Use)
//   DELETE /files/:fileId    take a kept file off before its time (its maker)
//
// `:id` is a saved report's id, or 'starter:<key>' for a starter report in
// code (src/reports/starters). A saved report may be a page (migration 253:
// subject 'page', its blocks in `spec`; shared/reports/page.js and
// src/reports/pages.js): it is listed, shared, starred, renamed, copied and
// deleted like any report, read block by block, and printed or made into a
// PDF as one; running, keeping a file of and scheduling it are refused (its
// reports are run one by one). Layout templates are src/routes/reportLayouts.js.
// A drill-down is made by the server from the
// report's own definition (shared/reports/drill.js), so someone who may only
// run a report can drill into it without running a definition of their own.
//
// Printing (docs/REPORTS.md 13): a new browser tab can't send the admin's
// login, so Print makes a link (report_print_links, migration 244) holding
// what is on the person's screen (the definition, their choices, the rows
// they opened up, what their role may see), and the page it opens runs the
// report as that person. The same way a draft menu's print preview works.
// The page is put together by src/reports/export/printPage.js, which a PDF
// (src/services/pdfBrowser.js: a browser on the server) is made from too.

import crypto from 'node:crypto'
import { z } from 'zod'
import { withTenant, systemSql } from '../config/db.js'
import { requireAuth, requirePermission, INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { FREE } from '../middleware/sharedDevice.js'
import { ownRoleIds } from '../services/roles.js'
import { AREAS, CATALOGUE, catalogueView } from '../reports/catalogue/index.js'
import { STARTERS, starterByKey } from '../reports/starters/index.js'
import { runReport } from '../reports/run.js'
import { reportPerson, rightsOn, openTo, runsFor, checkedSpec, recordRun, refuseOtherVenues, groupVenues, limitPepperRuns, PEPPER_HEADER } from '../reports/access.js'
import { PLAN, planReport } from '../reports/plan.js'
import { drillSteps, drilled } from '../reports/drilled.js'
import { prepareFile, makeReportFile, errorText } from '../reports/export/file.js'
import { keepReportFile, openFile, countDownload, removeFile, fileView } from '../reports/files.js'
import { pastRuns, RUNS_MAX } from '../reports/runs.js'
import { starterOf, savedRow, loadTarget, checkedForRun } from '../reports/target.js'
import { checkedPage, pageReports, resolveBlocks, runBlock } from '../reports/pages.js'
import { layoutFor } from '../reports/layouts.js'
import { readStream, sizeOf } from '../services/privateStore.js'
import { pdfAvailable, needPdf, htmlToPdf } from '../services/pdfBrowser.js'
import { messageHtml } from '../reports/export/print.js'
import { groupAbout, reportPrint, pagePrint } from '../reports/export/printPage.js'
import { fileName } from '../reports/export/table.js'
import { normaliseReport, resolveParams, LIMITS } from '../../../shared/reports/spec.js'
import { isPage, normalisePage, PAGE_SUBJECT } from '../../../shared/reports/page.js'
import { normaliseLayout } from '../../../shared/reports/layout.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_OWN = 300        // saved reports per person
const MAX_LIST = 1000      // saved reports listed
const MAX_DRILL = 10       // drill steps in one request
const PREVIEW_ROWS = 200
const PRINT_MINUTES = 15   // how long a print link works

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
const Format = z.enum(['csv', 'xlsx', 'pdf'])
// What is on the person's screen, for paper: the trail's words for the rows
// they opened up, whether the table is showing under a chart, and the series
// switched off in the chart's legend.
const Shown = {
  trail: z.array(z.object({
    label: z.string().max(200).optional(),
    by: z.string().max(80).optional(),
    of: z.string().max(80).optional(),
  })).max(MAX_DRILL).optional(),
  table: z.boolean().optional(),
  hidden: z.array(z.string().min(1).max(200)).max(40).optional(),
}
// A page's period and venues as the visitor has them (tidied by pageChoice()).
const PageChoice = {
  period: z.record(z.any()).nullable().optional(),
  venues: z.union([z.literal('all'), z.array(z.string().uuid()).max(500)]).nullable().optional(),
}
const ExportBody = z.object({ format: Format, params: Params.optional(), drill: Drill.optional(), ...Shown, ...PageChoice })
const BlockRunBody = z.object({ ...PageChoice, fresh: z.boolean().optional() })
const ExportUnsaved = ExportBody.extend({ spec: Spec, name: Name.optional() })
const CopyBody = z.object({ name: Name.optional() })
const RunsQuery = z.object({
  scope: z.enum(['mine', 'all']).optional(),
  report: z.string().max(80).optional(),
  file: z.string().max(40).optional(),
  schedule: z.string().max(40).optional(),
  files: z.enum(['1', '0', 'true', 'false']).optional(),
  before: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(RUNS_MAX).optional(),
})
// What is on the person's screen: their choices and the rows they opened up,
// or a page's period and venues. `layout` is a layout being tried out and
// `preview` a page for the Layouts page's frame (both Manage).
const PrintBody = z.object({
  params: Params.optional(),
  drill: Drill.optional(),
  ...Shown,
  ...PageChoice,
  layout: z.record(z.any()).optional(),
  preview: z.boolean().optional(),
})

const cleanTags = tags => [...new Set((tags || []).map(t => t.toLowerCase()))]

// A run asked for by Pepper's report tools (src/ai/tools/reports.js): they
// call these routes in-process, as the person, with PEPPER_HEADER beside the
// internal-call secret. Every in-process call carries the secret (and so does
// every API test request), so the secret alone doesn't mean Pepper; the
// header alone isn't believed, so a browser can't mark its runs as Pepper's.
// Recorded as Pepper's and held to limitPepperRuns().
export const viaPepper = req => (req.headers[INTERNAL_CALL_HEADER] === INTERNAL_CALL_SECRET && req.headers[PEPPER_HEADER] === 'pepper' ? 'pepper' : null)

// ── What the browser gets ────────────────────────────────────

function savedView(row, p, starred, withSpec = false) {
  const rights = rightsOn(row, p)
  const page = row.subject === PAGE_SUBJECT
  const spec = !withSpec ? null : page ? normalisePage(row.spec) : normaliseReport(row.spec)
  return {
    id: row.id,
    kind: 'saved',
    name: row.name,
    description: row.description,
    subject: row.subject,
    area: page ? null : CATALOGUE.subjects[row.subject]?.area || null,
    report_kind: page ? 'page' : spec ? spec.kind : row.report_kind,
    view: page ? 'table' : spec ? spec.view.kind : row.view_kind || 'table',
    layout_id: row.layout_id || null,
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
    // A page is open to whoever it is shared with: each report on it says for itself whether it runs.
    ...(page ? { runs: true, needs: null } : runsFor(row.subject, p.levels)),
    ...(spec ? { spec, can_pdf: pdfAvailable() } : {}),
  }
}

// One saved report with its definition. A page also says what it knows of
// each report on it, for the person looking.
async function fullView(row, p, starred) {
  const report = savedView(row, p, starred, true)
  if (row.subject === PAGE_SUBJECT) report.reports = await pageReports(report.spec, p)
  return report
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
    layout_id: null,
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
    ...(withSpec ? { spec: s.spec, can_pdf: pdfAvailable() } : {}),
  }
}

// ── Finding a report ─────────────────────────────────────────

const notFound = () => httpError(404, 'Report not found')
const BUILT_IN = 'This starter report comes with Macaroonie. Make a copy to change it'

// A saved report the person can open (a starter in code is refused with `why`, else 404).
async function loadSaved(id, p, why = BUILT_IN) {
  if (starterOf(id)) throw httpError(422, why)
  const row = await withTenant(p.tenantId, tx => savedRow(tx, String(id), p))
  if (!row) throw notFound()
  return row
}

const isStarred = (tx, p, ref) => tx`
  SELECT 1 FROM report_stars WHERE tenant_id = ${p.tenantId} AND user_sub = ${p.sub} AND report_ref = ${ref}`.then(r => r.length > 0)

// ── Running ──────────────────────────────────────────────────

// A download: the file made as a kept one would be (src/reports/export/file.js),
// sent to the browser. Refusals found before the report runs (a drill step,
// another group's venue) aren't recorded; anything after is, as a failed run.
async function sendFile(req, reply, p, target, body) {
  const started = Date.now()
  const prep = await prepareFile(p, target, body)
  const base = {
    kind: 'export', format: prep.format, saved: target.saved, starter: target.starter,
    name: target.name, spec: target.spec, drill: prep.steps, params: prep.params,
  }
  const record = extra => recordRun(p, { ...base, ms: Date.now() - started, ...extra }, req.log)
  try {
    const file = await makeReportFile(p, target, prep, { finish: r => record({ rows: r.rows }) })
    reply.header('content-disposition', 'attachment; filename="' + file.name + '"').header('content-type', file.type)
    if (file.stream) {
      file.done.catch(e => record({ error: errorText(e) }))
      return reply.send(file.stream)
    }
    await record({ rows: (await file.done).rows })
    return reply.send(file.buffer ?? file.text)
  } catch (e) {
    await record({ error: errorText(e) })
    throw e
  }
}

// One run recorded for each report a page's print or PDF ran: the reports
// are what ran, never the page.
async function recordBlocks(p, runs, format, log, failed = null) {
  for (const r of runs) {
    await recordRun(p, {
      kind: 'export', format, name: r.name, spec: r.spec, drill: [], params: r.params,
      saved: UUID_RE.test(String(r.ref)) ? { id: r.ref } : null, starter: starterOf(r.ref),
      rows: r.rows, ms: r.ms, error: r.error || (failed ? errorText(failed) : null),
    }, log)
  }
}

// A page as a PDF: its print page, made into a file by a browser on the
// server. Every report on it is run as the person asking.
async function sendPagePdf(req, reply, p, target, body) {
  needPdf()
  const { blocks, choice } = await resolveBlocks(p, target.spec, body)
  const [about, layout] = await Promise.all([groupAbout(p, { pdf: true }), layoutFor(p, target.saved)])
  const out = await pagePrint(p, about, { name: target.name, description: target.description, blocks, choice },
    { layout, by: p.email, byLabel: 'Made by', pdf: true })
  let buffer = null, failed = null
  try {
    buffer = await htmlToPdf(out.html)
  } catch (e) {
    failed = e
  }
  await recordBlocks(p, out.runs, 'pdf', req.log, failed)
  if (failed) throw failed
  return reply
    .header('content-disposition', 'attachment; filename="' + fileName(target.name, 'pdf') + '"')
    .header('content-type', 'application/pdf')
    .send(buffer)
}

// ── Printing ─────────────────────────────────────────────────

// A page nobody should keep, pass on or put in a frame, that loads nothing
// but its own logo and runs nothing but its own print button. The Layouts
// page's preview is the one page that may sit in a frame, of the admin's own.
function printHeaders(reply, nonce = null, framed = false) {
  return reply
    .header('Cache-Control', 'private, no-store')
    .header('Referrer-Policy', 'no-referrer')
    .header('X-Robots-Tag', 'noindex, nofollow')
    .header('Content-Security-Policy', 'default-src \'none\'; style-src \'unsafe-inline\'; '
      + (nonce ? 'script-src \'nonce-' + nonce + '\'; ' : '') + 'img-src \'self\' https: data:; base-uri \'none\'; form-action \'none\'; frame-ancestors '
      + (framed ? '\'self\'' : '\'none\''))
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
    // A layout's preview (the Layouts page's frame) has no bar and no script, and isn't a run to record.
    const preview = !!link.preview
    const nonce = preview ? null : crypto.randomBytes(16).toString('base64')
    const opts = { layout: link.layout || null, by: link.user_email, expires: link.expires_at, nonce, preview }

    // A page: each report on it, as it was found for the person when the link was made.
    if (Array.isArray(link.blocks)) {
      const out = await pagePrint(p, await groupAbout(p),
        { name: link.name, description: link.description, blocks: link.blocks, choice: link.params || {} }, opts)
      if (!preview) await recordBlocks(p, out.runs, 'print', req.log)
      return printHeaders(reply, nonce, preview).send(out.html)
    }

    const started = Date.now()
    const base = normaliseReport(link.spec)
    const steps = Array.isArray(link.drill) ? link.drill : []
    const given = link.params || {}
    const values = resolveParams(base, given)
    const record = extra => (preview ? null : recordRun(p, {
      kind: 'export', format: 'print', name: link.name, spec: base, drill: steps, params: values,
      saved: UUID_RE.test(link.report_ref) ? { id: link.report_ref } : null, starter: starterOf(link.report_ref),
      ms: Date.now() - started, ...extra,
    }, req.log))
    try {
      const result = await runReport(p.ctx, drilled(base, steps, p.levels), given)
      const html = reportPrint(await groupAbout(p), {
        name: link.name, description: link.description, base, result, values, steps,
        trail: Array.isArray(link.trail) ? link.trail : [], levels: p.levels,
        table: link.show_table, hidden: Array.isArray(link.hidden) ? link.hidden : [],
      }, opts)
      await record({ rows: result.meta.row_count })
      return printHeaders(reply, nonce, preview).send(html)
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
  // Runs and exports only read: no person needed on a shared device (middleware/sharedDevice.js).
  const reads = level => ({ preHandler: requirePermission('reports', level), config: { sharedDevice: FREE } })
  const use = { preHandler: requirePermission('reports', 'use') }
  const manage = { preHandler: requirePermission('reports', 'manage') }

  app.get('/catalogue', view, async req => {
    const p = await reportPerson(req)
    return { level: p.level, can_use: p.canUse, can_manage: p.canManage, ...catalogueView(p.levels, p.catalogue) }
  })

  // Past runs (src/reports/runs.js). A static path, so it is never taken for a report's id.
  app.get('/runs', view, async req => {
    const q = RunsQuery.parse(req.query || {})
    const p = await reportPerson(req)
    return pastRuns(p, { ...q, files: q.files === '1' || q.files === 'true' })
  })

  app.get('/', view, async req => {
    const p = await reportPerson(req)
    const { rows, stars } = await withTenant(p.tenantId, async tx => {
      const rows = await tx`
        SELECT r.id, r.name, r.description, r.subject, r.spec->>'kind' AS report_kind, r.spec->'view'->>'kind' AS view_kind,
               r.owner_sub, r.owner_email, r.shared, r.shared_role_ids, r.is_starter, r.starter_key, r.tags,
               r.layout_id, r.last_run_at, r.created_at, r.updated_at
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
      can_pdf: pdfAvailable(),
      areas: AREAS,
      reports: rows.map(r => savedView(r, p, stars.has(r.id))),
      starters: STARTERS.map(s => starterView(s, p, stars.has(s.ref))),
    }
  })

  app.post('/', use, async (req, reply) => {
    const body = NewReport.parse(req.body)
    const p = await reportPerson(req)
    const page = isPage(body.spec)
    const spec = page ? await checkedPage(body.spec, p) : checkedSpec(body.spec, p, { strict: true }).spec
    if (!page) await refuseOtherVenues(p, spec)
    const starterKey = !page && body.starter_key && starterByKey(body.starter_key) ? body.starter_key : null
    const row = await withTenant(p.tenantId, async tx => {
      const [{ n }] = await tx`SELECT count(*)::int AS n FROM reports WHERE tenant_id = ${p.tenantId} AND owner_sub = ${p.sub}`
      if (n >= MAX_OWN) throw httpError(422, 'You have ' + MAX_OWN + ' reports. Delete one you no longer need first')
      const [r] = await tx`
        INSERT INTO reports (tenant_id, name, description, subject, spec, owner_sub, owner_email, starter_key, tags)
        VALUES (${p.tenantId}, ${body.name}, ${body.description || null}, ${page ? PAGE_SUBJECT : spec.subject}, ${tx.json(spec)},
                ${p.sub}, ${p.email}, ${starterKey}, ${cleanTags(body.tags)}::text[])
        RETURNING *`
      return r
    })
    return reply.code(201).send({ report: await fullView(row, p, false) })
  })

  app.post('/preview', reads('use'), async req => {
    const body = PreviewBody.parse(req.body)
    const p = await reportPerson(req)
    const base = checkedForRun(body.spec)
    await refuseOtherVenues(p, base, body.params || {})
    const spec = drilled(base, drillSteps(body.drill), p.levels)
    return runReport(p.ctx, spec, body.params || {}, { cap: body.rows ?? PREVIEW_ROWS, fresh: !!body.fresh })
  })

  app.post('/plan', reads('use'), async req => {
    const body = PlanBody.parse(req.body)
    const p = await reportPerson(req)
    const via = viaPepper(req)
    if (via) await limitPepperRuns(p)
    let report = null
    if (body.report) {
      report = normaliseReport(body.report)
      await refuseOtherVenues(p, report)
    }
    const venues = await groupVenues(p)
    const started = Date.now()
    const out = await planReport(p, {
      plan: body.plan,
      report,
      venues: venues.map(v => ({ id: v.id, name: v.name })),
      cap: body.rows ?? PREVIEW_ROWS,
    })
    // Like the builder's preview, a plan run is recorded only when Pepper
    // asked for it (so limitPepperRuns() counts it); one that names nothing
    // there ran nothing.
    if (out.spec && via) {
      await recordRun(p, {
        kind: 'run', via, name: out.name || 'A report from a plan', spec: out.spec, params: resolveParams(out.spec, {}),
        rows: out.result?.meta?.row_count, ms: Date.now() - started, error: out.result ? null : out.problem,
      }, req.log)
    }
    return out
  })

  app.post('/export', reads('use'), async (req, reply) => {
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
    return { report: await fullView(out.row, p, out.starred) }
  })

  app.put('/:id', use, async req => {
    const body = EditReport.parse(req.body)
    const p = await reportPerson(req)
    const before = await loadSaved(req.params.id, p)
    if (!rightsOn(before, p).edit) throw httpError(403, 'Only the person who made this report, or someone with Manage on Reports, can change it')
    const page = before.subject === PAGE_SUBJECT
    if (body.spec && isPage(body.spec) !== page) {
      throw httpError(422, page ? 'A page of reports can\'t be turned into a single report. Make a new report instead'
        : 'A report can\'t be turned into a page. Make a new page and put this report on it')
    }
    const spec = !body.spec ? null : page ? await checkedPage(body.spec, p) : checkedSpec(body.spec, p, { strict: true }).spec
    if (spec && !page) await refuseOtherVenues(p, spec)
    const out = await withTenant(p.tenantId, async tx => {
      const [row] = await tx`
        UPDATE reports
           SET name = ${body.name ?? before.name},
               description = ${body.description === undefined ? before.description : body.description || null},
               subject = ${spec && !page ? spec.subject : before.subject},
               spec = ${spec ? tx.json(spec) : tx.json(before.spec)},
               tags = ${body.tags ? cleanTags(body.tags) : before.tags}::text[],
               updated_at = now()
         WHERE tenant_id = ${p.tenantId} AND id = ${before.id}
         RETURNING *`
      return row ? { row, starred: await isStarred(tx, p, row.id) } : null
    })
    if (!out) throw notFound()
    return { report: await fullView(out.row, p, out.starred) }
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
    return { report: await fullView(out.row, p, out.starred) }
  })

  app.post('/:id/run', reads('view'), async req => {
    const body = RunBody.parse(req.body || {})
    const p = await reportPerson(req)
    const target = await loadTarget(req.params.id, p)
    const via = viaPepper(req)
    if (via) await limitPepperRuns(p)
    const started = Date.now()
    const steps = drillSteps(body.drill)
    const given = body.params || {}
    await refuseOtherVenues(p, target.spec, given)
    const base = { kind: 'run', via, saved: target.saved, starter: target.starter, name: target.name, spec: target.spec, drill: steps, params: resolveParams(target.spec, given) }
    try {
      const result = await runReport(p.ctx, drilled(target.spec, steps, p.levels), given, { fresh: !!body.fresh })
      await recordRun(p, { ...base, rows: result.meta.row_count, ms: Date.now() - started }, req.log)
      return { report: { id: target.ref, name: target.name }, ...result }
    } catch (e) {
      await recordRun(p, { ...base, ms: Date.now() - started, error: errorText(e) }, req.log)
      throw e
    }
  })

  // One report of a page, run for the screen with the page's period and
  // venues, or the visitor's own. Recorded as a run of that report.
  app.post('/:id/blocks/:blockId/run', reads('view'), async req => {
    const body = BlockRunBody.parse(req.body || {})
    const p = await reportPerson(req)
    const page = await loadTarget(req.params.id, p, { page: true })
    if (!page.page) throw httpError(404, 'That isn\'t a page of reports')
    const { target, given, run } = await runBlock(p, page.spec, String(req.params.blockId), body, { fresh: !!body.fresh })
    const started = Date.now()
    const base = { kind: 'run', saved: target.saved, starter: target.starter, name: target.name, spec: target.spec, drill: [], params: resolveParams(target.spec, given) }
    try {
      const result = await run()
      await recordRun(p, { ...base, rows: result.meta.row_count, ms: Date.now() - started }, req.log)
      return { report: { id: target.ref, name: target.name }, ...result }
    } catch (e) {
      await recordRun(p, { ...base, ms: Date.now() - started, error: errorText(e) }, req.log)
      throw e
    }
  })

  app.post('/:id/export', reads('use'), async (req, reply) => {
    const body = ExportBody.parse(req.body)
    const p = await reportPerson(req)
    // A page is one file only as a PDF: its reports' own files are theirs to download.
    const target = await loadTarget(req.params.id, p, { page: body.format === 'pdf' })
    return target.page ? sendPagePdf(req, reply, p, target, body) : sendFile(req, reply, p, target, body)
  })

  // Keep a file of it for the person who makes it, to download later from
  // Past runs (src/reports/files.js). Made as a download would be.
  app.post('/:id/files', use, async (req, reply) => {
    const body = ExportBody.parse(req.body)
    const p = await reportPerson(req)
    const target = await loadTarget(req.params.id, p)
    const via = viaPepper(req)
    if (via) await limitPepperRuns(p)
    const row = await keepReportFile(p, target, body, { log: req.log, via })
    return reply.code(201).send({ file: fileView(row, p) })
  })

  // A kept file, to the person who made it, while their role still sees the
  // report the same way (openFile() says why not, else).
  app.get('/files/:fileId', use, async (req, reply) => {
    const p = await reportPerson(req)
    const row = await openFile(p, req.params.fileId)
    const bytes = await sizeOf(row.storage_key)
    if (bytes == null) throw httpError(410, 'This file isn\'t kept any more. Run the report again for a new one')
    await countDownload(p, row.id)
    return reply
      .header('content-type', row.content_type)
      .header('content-disposition', 'attachment; filename="' + row.file_name + '"')
      .header('cache-control', 'private, no-store')
      .header('content-length', bytes)
      .send(readStream(row.storage_key))
  })

  // Its maker takes a file off before its time. View is enough: someone who
  // has lost Use can still clear away files they made.
  app.delete('/files/:fileId', view, async (req, reply) => {
    const p = await reportPerson(req)
    await removeFile(p, req.params.fileId)
    return reply.code(204).send()
  })

  // A link to the report's print page, as it is on the person's screen.
  app.post('/:id/print-link', view, async req => {
    const body = PrintBody.parse(req.body || {})
    const p = await reportPerson(req)
    // Trying a layout out is part of making layouts.
    if ((body.layout || body.preview) && !p.canManage) throw httpError(403, 'Trying a layout out needs Manage on Reports')
    const preview = !!body.preview
    const target = await loadTarget(req.params.id, p, { page: true })
    // The layout as it is now: the one being tried, else the report's own, else the group's default.
    const layout = body.layout ? normaliseLayout(body.layout) : await layoutFor(p, target.saved)
    let on
    if (target.page) {
      // Each report on the page is found and checked for the person now; the page runs them with the levels kept on the link.
      const { blocks, choice } = await resolveBlocks(p, target.spec, body)
      on = { params: choice, steps: [], trail: [], table: null, hidden: [], blocks }
    } else {
      const steps = drillSteps(body.drill)
      const given = body.params || {}
      await refuseOtherVenues(p, target.spec, given)
      // Refused here, in the app, not on a page in a new tab: rows that can't
      // be opened that way, a report the person's role can't run.
      checkedSpec(drilled(target.spec, steps, p.levels), p)
      on = {
        params: given, steps, trail: body.trail?.length === steps.length ? body.trail : [],
        table: body.table ?? null, hidden: [...new Set(body.hidden || [])], blocks: null,
      }
    }
    const [link] = await withTenant(p.tenantId, async tx => {
      // Links that ran out go: the person's own at once, anyone's after a day.
      // A new preview takes the person's earlier previews with it.
      await tx`
        DELETE FROM report_print_links
         WHERE tenant_id = ${p.tenantId}
           AND (expires_at < now() - interval '1 day'
                OR (user_sub = ${p.sub} AND (expires_at < now() OR (${preview} AND preview))))`
      return tx`
        INSERT INTO report_print_links (tenant_id, report_ref, name, description, spec, params, drill, trail, show_table, hidden,
                                        user_sub, user_email, levels, layout, preview, blocks, expires_at)
        VALUES (${p.tenantId}, ${target.ref}, ${target.name}, ${target.description || null}, ${tx.json(target.spec)},
                ${tx.json(on.params)}, ${tx.json(on.steps)}, ${tx.json(on.trail)}, ${on.table}, ${tx.json(on.hidden)},
                ${p.sub}, ${p.email}, ${tx.json(p.levels)}, ${layout ? tx.json(layout) : null}, ${preview},
                ${on.blocks ? tx.json(on.blocks) : null}, now() + make_interval(mins => ${PRINT_MINUTES}))
        RETURNING id, expires_at`
    })
    return { path: '/api/reports/print/' + link.id, expires_at: link.expires_at }
  })

  app.post('/:id/copy', use, async (req, reply) => {
    const body = CopyBody.parse(req.body || {})
    const p = await reportPerson(req)
    const target = await loadTarget(req.params.id, p, { page: true })
    // Checked as the person copying: it becomes theirs to run and change.
    const spec = target.page ? await checkedPage(target.spec, p) : checkedSpec(target.spec, p).spec
    const name = (body.name || (target.starter ? target.name : target.name + ' (copy)')).slice(0, LIMITS.name)
    const row = await withTenant(p.tenantId, async tx => {
      const [{ n }] = await tx`SELECT count(*)::int AS n FROM reports WHERE tenant_id = ${p.tenantId} AND owner_sub = ${p.sub}`
      if (n >= MAX_OWN) throw httpError(422, 'You have ' + MAX_OWN + ' reports. Delete one you no longer need first')
      const [r] = await tx`
        INSERT INTO reports (tenant_id, name, description, subject, spec, owner_sub, owner_email, starter_key, tags)
        VALUES (${p.tenantId}, ${name}, ${target.description || null}, ${target.page ? PAGE_SUBJECT : spec.subject}, ${tx.json(spec)},
                ${p.sub}, ${p.email}, ${target.starter?.key ?? target.saved?.starter_key ?? null},
                ${target.saved?.tags || []}::text[])
        RETURNING *`
      return r
    })
    return reply.code(201).send({ report: await fullView(row, p, false) })
  })

  app.post('/:id/star', view, async req => {
    const p = await reportPerson(req)
    const target = await loadTarget(req.params.id, p, { page: true })
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
