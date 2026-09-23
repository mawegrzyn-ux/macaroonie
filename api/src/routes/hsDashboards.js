// src/routes/hsDashboards.js
//
// Customisable Health & Safety dashboards, per venue. Mounted at
// /api/hs-dashboards in app.js.
//
// A dashboard is a named tab holding an ordered set of widgets. Each
// widget is either:
//   'checklist'    — embeds one existing checklist_templates row
//                     (the tick-list rendered by ChecklistRunPanel)
//   'temp_checks'  — embeds the venue's whole equipment x capture-time
//                     grid (rendered by TempChecksTable) — there is
//                     always at most one meaningful instance of this
//                     per venue, so it carries no template reference
//
// Dashboards:
//   GET    /dashboards?venue_id=&active=
//   POST   /dashboards
//   PATCH  /dashboards/:id
//   DELETE /dashboards/:id                 (soft — is_active=false)
//   PUT    /dashboards/reorder              { venue_id, ids }
//
// Widgets:
//   GET    /dashboards/:id/widgets
//   POST   /dashboards/:id/widgets
//   PATCH  /dashboards/:id/widgets/:widgetId
//   DELETE /dashboards/:id/widgets/:widgetId (hard delete — widgets have
//                                              no downstream data of their
//                                              own, they only reference it)
//   PUT    /dashboards/:id/widgets/reorder   { ids }

import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requirePermission } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'

const DashboardBody = z.object({
  venue_id:   z.string().uuid(),
  name:       z.string().min(1).max(200),
  sort_order: z.number().int().optional(),
})

const DashboardPatch = DashboardBody.partial().omit({ venue_id: true }).extend({
  is_active: z.boolean().optional(),
})

const WidgetBody = z.object({
  widget_type:            z.enum(['checklist', 'temp_checks']),
  checklist_template_id:  z.string().uuid().nullable().optional(),
  title_override:         z.string().max(200).nullable().optional(),
  sort_order:             z.number().int().optional(),
}).refine(
  b => (b.widget_type === 'checklist') === !!b.checklist_template_id,
  { message: 'checklist_template_id is required for a checklist widget, and must be omitted for a temp_checks widget' },
)

const WidgetPatch = z.object({
  title_override: z.string().max(200).nullable().optional(),
  sort_order:     z.number().int().optional(),
  is_active:      z.boolean().optional(),
})

/** Loads a dashboard (must belong to this tenant) or throws 404. */
async function loadDashboard(tx, tenantId, dashboardId) {
  const [d] = await tx`
    SELECT * FROM hs_dashboards
     WHERE id = ${dashboardId} AND tenant_id = ${tenantId}
  `
  if (!d) throw httpError(404, 'Dashboard not found')
  return d
}

export default async function hsDashboardsRoutes(app) {
  app.addHook('preHandler', requireAuth)

  // ── Dashboards ────────────────────────────────────────────

  app.get('/dashboards', {
    preHandler: requirePermission('hs_dashboard', 'view'),
  }, async (req) => {
    const { venue_id, active } = req.query
    if (!venue_id) throw httpError(400, 'venue_id required')

    return withTenant(req.tenantId, tx => {
      const activeFilter = active === 'all' ? tx`` : tx`AND is_active = true`
      return tx`
        SELECT * FROM hs_dashboards
         WHERE tenant_id = ${req.tenantId}
           AND venue_id  = ${venue_id}
           ${activeFilter}
         ORDER BY sort_order, name
      `
    })
  })

  app.post('/dashboards', {
    preHandler: requirePermission('hs_dashboard', 'manage'),
  }, async (req) => {
    const body = DashboardBody.parse(req.body)
    const [row] = await withTenant(req.tenantId, tx => tx`
      INSERT INTO hs_dashboards (tenant_id, venue_id, name, sort_order)
      VALUES (${req.tenantId}, ${body.venue_id}, ${body.name}, ${body.sort_order ?? 0})
      RETURNING *
    `)
    return row
  })

  app.patch('/dashboards/:id', {
    preHandler: requirePermission('hs_dashboard', 'manage'),
  }, async (req) => {
    const body = DashboardPatch.parse(req.body)
    const fields = Object.keys(body).filter(k => body[k] !== undefined)
    if (!fields.length) throw httpError(400, 'No fields to update')

    const [row] = await withTenant(req.tenantId, tx => tx`
      UPDATE hs_dashboards
         SET ${tx(Object.fromEntries(fields.map(k => [k, body[k]])), ...fields)},
             updated_at = now()
       WHERE id = ${req.params.id}
         AND tenant_id = ${req.tenantId}
       RETURNING *
    `)
    if (!row) throw httpError(404, 'Dashboard not found')
    return row
  })

  app.delete('/dashboards/:id', {
    preHandler: requirePermission('hs_dashboard', 'manage'),
  }, async (req) => {
    const [row] = await withTenant(req.tenantId, tx => tx`
      UPDATE hs_dashboards
         SET is_active = false, updated_at = now()
       WHERE id = ${req.params.id}
         AND tenant_id = ${req.tenantId}
       RETURNING *
    `)
    if (!row) throw httpError(404, 'Dashboard not found')
    return row
  })

  app.put('/dashboards/reorder', {
    preHandler: requirePermission('hs_dashboard', 'manage'),
  }, async (req) => {
    const { venue_id, ids } = z.object({
      venue_id: z.string().uuid(),
      ids:      z.array(z.string().uuid()),
    }).parse(req.body)

    await withTenant(req.tenantId, async tx => {
      for (let i = 0; i < ids.length; i++) {
        await tx`
          UPDATE hs_dashboards
             SET sort_order = ${i}
           WHERE id = ${ids[i]}
             AND venue_id  = ${venue_id}
             AND tenant_id = ${req.tenantId}
        `
      }
    })
    return { ok: true }
  })

  // ── Widgets ──────────────────────────────────────────────

  app.get('/dashboards/:id/widgets', {
    preHandler: requirePermission('hs_dashboard', 'view'),
  }, async (req) => {
    const { active } = req.query
    return withTenant(req.tenantId, async tx => {
      await loadDashboard(tx, req.tenantId, req.params.id)
      const activeFilter = active === 'all' ? tx`` : tx`AND w.is_active = true`
      return tx`
        SELECT w.*, t.name AS checklist_name, t.frequency AS checklist_frequency
          FROM hs_dashboard_widgets w
          LEFT JOIN checklist_templates t ON t.id = w.checklist_template_id
         WHERE w.dashboard_id = ${req.params.id}
           AND w.tenant_id    = ${req.tenantId}
           ${activeFilter}
         ORDER BY w.sort_order, w.created_at
      `
    })
  })

  app.post('/dashboards/:id/widgets', {
    preHandler: requirePermission('hs_dashboard', 'manage'),
  }, async (req) => {
    const body = WidgetBody.parse(req.body)
    return withTenant(req.tenantId, async tx => {
      const dashboard = await loadDashboard(tx, req.tenantId, req.params.id)

      if (body.checklist_template_id) {
        const [t] = await tx`
          SELECT id FROM checklist_templates
           WHERE id = ${body.checklist_template_id}
             AND tenant_id = ${req.tenantId}
             AND venue_id  = ${dashboard.venue_id}
        `
        if (!t) throw httpError(400, 'Checklist template not found for this venue')
      }

      const [row] = await tx`
        INSERT INTO hs_dashboard_widgets
          (tenant_id, dashboard_id, widget_type, checklist_template_id, title_override, sort_order)
        VALUES
          (${req.tenantId}, ${req.params.id}, ${body.widget_type},
           ${body.checklist_template_id ?? null}, ${body.title_override ?? null}, ${body.sort_order ?? 0})
        RETURNING *
      `
      return row
    })
  })

  app.patch('/dashboards/:id/widgets/:widgetId', {
    preHandler: requirePermission('hs_dashboard', 'manage'),
  }, async (req) => {
    const body = WidgetPatch.parse(req.body)
    const fields = Object.keys(body).filter(k => body[k] !== undefined)
    if (!fields.length) throw httpError(400, 'No fields to update')

    const [row] = await withTenant(req.tenantId, tx => tx`
      UPDATE hs_dashboard_widgets
         SET ${tx(Object.fromEntries(fields.map(k => [k, body[k]])), ...fields)},
             updated_at = now()
       WHERE id = ${req.params.widgetId}
         AND dashboard_id = ${req.params.id}
         AND tenant_id    = ${req.tenantId}
       RETURNING *
    `)
    if (!row) throw httpError(404, 'Widget not found')
    return row
  })

  app.delete('/dashboards/:id/widgets/:widgetId', {
    preHandler: requirePermission('hs_dashboard', 'manage'),
  }, async (req) => {
    const [row] = await withTenant(req.tenantId, tx => tx`
      DELETE FROM hs_dashboard_widgets
       WHERE id = ${req.params.widgetId}
         AND dashboard_id = ${req.params.id}
         AND tenant_id    = ${req.tenantId}
       RETURNING *
    `)
    if (!row) throw httpError(404, 'Widget not found')
    return row
  })

  app.put('/dashboards/:id/widgets/reorder', {
    preHandler: requirePermission('hs_dashboard', 'manage'),
  }, async (req) => {
    const { ids } = z.object({ ids: z.array(z.string().uuid()) }).parse(req.body)

    await withTenant(req.tenantId, async tx => {
      await loadDashboard(tx, req.tenantId, req.params.id)
      for (let i = 0; i < ids.length; i++) {
        await tx`
          UPDATE hs_dashboard_widgets
             SET sort_order = ${i}
           WHERE id = ${ids[i]}
             AND dashboard_id = ${req.params.id}
             AND tenant_id    = ${req.tenantId}
        `
      }
    })
    return { ok: true }
  })
}
