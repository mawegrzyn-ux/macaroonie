// src/routes/reportAi.js — mounted at /api/ai/reports
//
// The smart builder (docs/REPORTS.md 10): a report from a few words, or from
// a photo or PDF of a report the person has now. Under /api/ai so the longer
// proxy timeout for Pepper applies (scripts/ensure-nginx-ai-timeout.sh).
//
//   POST /build  { request, previous?: { spec, requests }, files?: [{ name?, data }] }
//                -> { spec, name, about, assumed, couldnt, questions, result, problem }
//                Pepper works the report out and it is run as the person (the
//                first 200 rows); nothing is saved. `previous` is a report
//                built before that the request changes ("only Fridays"),
//                with the requests that made it.     Reports Use + Pepper
//
// The answer's definition is the person's to keep: Save goes through
// POST /api/reports, a question's choice through POST /api/reports/preview,
// both of which check it again. Runs here aren't recorded (a preview isn't).
//
// Files: JPEG, PNG, WebP or GIF photos up to 5 MB each and PDFs up to 10 MB
// (checked from their first bytes), up to 10 files and 20 MB together.

import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requirePermission } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { detectFile } from '../ai/attachments.js'
import { pepperOn } from '../services/aiJson.js'
import { reportPerson, refuseOtherVenues } from '../reports/access.js'
import { smartBuild } from '../reports/smart.js'
import { normaliseReport } from '../../../shared/reports/spec.js'
import { todayIn } from '../../../shared/reports/period.js'

const MAX_FILES = 10
const MAX_IMAGE = 5 * 1024 * 1024
const MAX_PDF = 10 * 1024 * 1024
const MAX_TOTAL = 20 * 1024 * 1024
const b64 = n => Math.ceil(n / 3) * 4 + 4

const BuildBody = z.object({
  request: z.string().trim().min(1, 'Say what the report should show').max(2000, 'Say it in up to 2,000 characters'),
  previous: z.object({
    spec: z.record(z.any()),
    requests: z.array(z.string().max(2000)).max(10).default([]),
  }).nullable().optional(),
  files: z.array(z.object({
    name: z.string().max(200).optional(),
    data: z.string().min(8).max(b64(MAX_PDF)).regex(/^[A-Za-z0-9+/]+={0,2}$/, 'A file didn\'t arrive whole'),
  })).max(MAX_FILES, 'Up to ' + MAX_FILES + ' files at a time').default([]),
})

// The files as the model takes them, each checked from its first bytes.
function checkedFiles(list) {
  let total = 0
  const files = list.map((f, i) => {
    const buffer = Buffer.from(f.data, 'base64')
    const label = f.name || 'File ' + (i + 1)
    let kind = null
    try { kind = detectFile(buffer, f.name || '') } catch { kind = null }
    if (!kind || (kind.kind !== 'image' && kind.kind !== 'pdf')) throw httpError(422, label + ' isn\'t a photo or a PDF: use JPEG, PNG, WebP, GIF or PDF.')
    if (buffer.length > (kind.kind === 'pdf' ? MAX_PDF : MAX_IMAGE)) {
      throw httpError(413, label + ' is too big: photos up to 5 MB, PDFs up to 10 MB.')
    }
    total += buffer.length
    return { media_type: kind.media_type, data: f.data }
  })
  if (total > MAX_TOTAL) throw httpError(413, 'Those files are too big together: up to 20 MB at a time.')
  return files
}

export default async function reportAiRoutes(app) {
  app.addHook('preHandler', requireAuth)

  app.post('/build', {
    bodyLimit: b64(MAX_TOTAL) + 64 * 1024,
    preHandler: [requirePermission('reports', 'use'), requirePermission('ai_assistant', 'view')],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async req => {
    const body = BuildBody.parse(req.body)
    if (!req.tenantId) throw httpError(400, 'Pick a restaurant group first')
    await pepperOn(req.tenantId)
    const p = await reportPerson(req)
    const files = checkedFiles(body.files)

    let previous = null
    if (body.previous) {
      const spec = normaliseReport(body.previous.spec)
      await refuseOtherVenues(p, spec)
      previous = { spec, requests: body.previous.requests }
    }

    // Every venue of the group, the open ones first: a report can be about a
    // venue that has closed. Today is the date at the first open one.
    const venues = await withTenant(p.tenantId, tx => tx`
      SELECT id, name, timezone, is_active FROM venues
      WHERE tenant_id = ${p.tenantId}
      ORDER BY is_active DESC, name, id`)
    const today = todayIn(venues[0]?.timezone || 'Europe/London')

    req.log.info({ files: files.length, change: !!previous }, 'smart report build')
    return smartBuild(p, {
      request: body.request,
      previous,
      files,
      venues: venues.map(v => ({ id: v.id, name: v.name })),
      today,
    })
  })
}
