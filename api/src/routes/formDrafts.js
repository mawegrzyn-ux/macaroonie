// src/routes/formDrafts.js
//
// Form drafts (migration 275, Pepper-first step 3d, docs/CHAT_FIRST.md F6),
// mounted at /api/form-drafts. A form's unsaved values, kept per person so
// they survive a reload or another device. Each person reads and writes only
// their own (user_sub from the login); a form needs View on its module
// (shared/forms.js), and only forms that keep drafts (drafts: true) have one.
//
//   GET    /?form=&venue_id=&day=   -> { draft: { values, updated_at } | null }
//   PUT    /  { form, venue_id, day?, values }   the whole draft (rule 13)
//                                   -> { draft: { values, updated_at } }
//   DELETE /?form=&venue_id=&day=   -> { ok: true } (gone or never there)
//
// day: the form's day (YYYY-MM-DD), or its week's Monday; left out for a
// form with no day. A draft is not the record: the record is saved by the
// page's own Save through the page's own route, after which the sheet
// deletes the draft. Drafts older than DRAFT_DAYS are deleted whenever the
// person's drafts are read or written, so no job is needed.

import { z } from 'zod'
import { requireAuth, permissionLevel } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { withTenant } from '../config/db.js'
import { permissionAtLeast } from '../config/modules.js'
import { FORMS } from '../../../shared/forms.js'

export const DRAFT_DAYS = 7
export const DRAFT_MAX_BYTES = 20_000

const DRAFT_FORMS = Object.keys(FORMS).filter(k => FORMS[k].drafts)
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(s => !Number.isNaN(Date.parse(s + 'T12:00:00Z')) && new Date(s + 'T12:00:00Z').toISOString().slice(0, 10) === s, 'Not a real date')
const Where = z.object({
  form:     z.enum(DRAFT_FORMS),
  venue_id: z.string().uuid(),
  day:      Day.nullable().optional(),
})
const Body = Where.extend({
  values: z.record(z.string(), z.unknown())
    .refine(v => JSON.stringify(v).length <= DRAFT_MAX_BYTES, 'The draft is too big.'),
})

/** The form's module at View for the caller, and the venue theirs. */
async function check(req, where) {
  const f = FORMS[where.form]
  if (!permissionAtLeast(await permissionLevel(req, f.module), 'view')) throw httpError(403, 'You don\'t have access to this form.')
  const [v] = await withTenant(req.tenantId, tx => tx`
    SELECT 1 FROM venues WHERE id = ${where.venue_id} AND tenant_id = ${req.tenantId}
  `)
  if (!v) throw httpError(404, 'Venue not found')
  // A form with no day keeps none; one by day or week needs it.
  if (!f.by) return { ...where, day: null }
  if (!where.day) throw httpError(400, 'Which day is the draft for?')
  return where
}

/** The person's drafts older than DRAFT_DAYS go. */
const clearOld = (tx, req) => tx`
  DELETE FROM form_drafts
   WHERE tenant_id = ${req.tenantId} AND user_sub = ${req.user.sub}
     AND updated_at < now() - make_interval(days => ${DRAFT_DAYS})
`

const view = r => (r ? { values: r.form_values, updated_at: r.updated_at } : null)

export default async function formDraftRoutes(app) {
  app.addHook('preHandler', requireAuth)

  app.get('/', async req => {
    const w = await check(req, Where.parse(req.query ?? {}))
    const [row] = await withTenant(req.tenantId, async tx => {
      await clearOld(tx, req)
      return tx`
        SELECT form_values, updated_at FROM form_drafts
         WHERE tenant_id = ${req.tenantId} AND user_sub = ${req.user.sub} AND form = ${w.form}
           AND venue_id = ${w.venue_id} AND day IS NOT DISTINCT FROM ${w.day ?? null}::date
      `
    })
    return { draft: view(row) }
  })

  app.put('/', async req => {
    const body = Body.parse(req.body ?? {})
    const w = await check(req, body)
    const [row] = await withTenant(req.tenantId, async tx => {
      await clearOld(tx, req)
      return tx`
        INSERT INTO form_drafts (tenant_id, user_sub, form, venue_id, day, form_values, updated_at)
        VALUES (${req.tenantId}, ${req.user.sub}, ${w.form}, ${w.venue_id}, ${w.day ?? null}, ${tx.json(body.values)}, now())
        ON CONFLICT (tenant_id, user_sub, form, venue_id, day)
        DO UPDATE SET form_values = EXCLUDED.form_values, updated_at = now()
        RETURNING form_values, updated_at
      `
    })
    return { draft: view(row) }
  })

  app.delete('/', async req => {
    const w = await check(req, Where.parse(req.query ?? {}))
    await withTenant(req.tenantId, tx => tx`
      DELETE FROM form_drafts
       WHERE tenant_id = ${req.tenantId} AND user_sub = ${req.user.sub} AND form = ${w.form}
         AND venue_id = ${w.venue_id} AND day IS NOT DISTINCT FROM ${w.day ?? null}::date
    `)
    return { ok: true }
  })
}
