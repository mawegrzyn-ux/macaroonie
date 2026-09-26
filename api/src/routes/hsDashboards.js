// src/routes/hsDashboards.js
//
// Customisable dashboards, per venue. The same plugin is mounted twice in
// app.js (migration 101):
//   /api/hs-dashboards   { kind: 'hs',   moduleKey: 'hs_dashboard' }
//   /api/cash-dashboards { kind: 'cash', moduleKey: 'cash_dashboard' }
// Each mount only sees dashboards of its own `kind`, only accepts that
// kind's widget types, and is gated by its own module, so a user with
// Cash dashboard access never touches H&S dashboards and vice versa.
//
// H&S widget types:
// A dashboard is a named tab holding an ordered set of widgets. Each
// widget is one of:
//   'checklist'        — embeds one existing checklist_templates row
//                         (the tick-list rendered by ChecklistRunPanel)
//   'temp_checks'      — embeds the venue's whole equipment x capture-time
//                         grid (rendered by TempChecksTable)
//   'delivery_checks'  — embeds the delivery-check log (DeliveryChecksPanel)
//   'hold_checks'      — embeds the hot/cold hold-check log (HoldChecksPanel)
//   'cooking_checks'   — embeds the cooking/reheat-check log (CookingChecksPanel)
//   'action_log'       — embeds the H&S Action Log (HSActionLogPanel)
// Cash widget types (rendered by components/cashRecon/widgets.jsx):
//   'cash_wages_paid', 'cash_petty_cash', 'cash_recon_grid',
//   'cash_week_balance', 'cash_day_balance', 'cash_day_tiles'
// Only 'checklist' carries a checklist_template_id — every other type is
// venue-wide, so there's always at most one meaningful instance of it per
// venue and it carries no template reference.
//
// Layout: `hs_dashboards.column_count` (1-6, default 4) sets the grid
// column count for the whole dashboard. Each widget's `col_span` (1-6,
// default 1) sets how many of those columns its card spans — clamped to
// column_count client-side so lowering the dashboard's column count later
// never orphans a wider card. `height_px` (240-1200, default 480) sets
// the card's height; the admin grid snaps it to whole rows
// (admin/src/lib/dashboardGrid.js) so tall widgets span several rows.
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

export const WIDGET_TYPES_BY_KIND = {
  hs:   ['checklist', 'temp_checks', 'delivery_checks', 'hold_checks', 'cooking_checks', 'action_log'],
  cash: ['cash_wages_paid', 'cash_petty_cash', 'cash_recon_grid', 'cash_week_balance', 'cash_day_balance', 'cash_day_tiles', 'cash_week_expenses', 'cash_week_summary_grid', 'cash_week_staff'],
}

const DashboardBody = z.object({
  venue_id:     z.string().uuid(),
  name:         z.string().min(1).max(200),
  sort_order:   z.number().int().optional(),
  column_count: z.number().int().min(1).max(6).optional(),
})

const DashboardPatch = DashboardBody.partial().omit({ venue_id: true }).extend({
  is_active: z.boolean().optional(),
})

// Per-widget display options (migration 105). Flat map of simple values;
// which keys mean anything is up to each widget type in the admin.
const WidgetSettings = z.record(z.union([z.boolean(), z.number(), z.string().max(200)]))
  .refine(o => Object.keys(o).length <= 20, { message: 'Too many widget settings' })

function widgetBodyFor(kind) {
  return z.object({
    widget_type:            z.enum(WIDGET_TYPES_BY_KIND[kind]),
    checklist_template_id:  z.string().uuid().nullable().optional(),
    title_override:         z.string().max(200).nullable().optional(),
    sort_order:             z.number().int().optional(),
    col_span:               z.number().int().min(1).max(6).optional(),
    height_px:              z.number().int().min(240).max(1200).optional(),
    settings:               WidgetSettings.optional(),
  }).refine(
    b => (b.widget_type === 'checklist') === !!b.checklist_template_id,
    { message: 'checklist_template_id is required for a checklist widget, and must be omitted for every other widget type' },
  )
}

const WidgetPatch = z.object({
  title_override: z.string().max(200).nullable().optional(),
  sort_order:     z.number().int().optional(),
  is_active:      z.boolean().optional(),
  col_span:       z.number().int().min(1).max(6).optional(),
  height_px:      z.number().int().min(240).max(1200).optional(),
  settings:       WidgetSettings.optional(),
})

/** Loads a dashboard (must belong to this tenant and kind) or throws 404. */
async function loadDashboard(tx, tenantId, dashboardId, kind) {
  const [d] = await tx`
    SELECT * FROM hs_dashboards
     WHERE id = ${dashboardId} AND tenant_id = ${tenantId} AND kind = ${kind}
  `
  if (!d) throw httpError(404, 'Dashboard not found')
  return d
}

export default async function hsDashboardsRoutes(app, opts) {
  const kind      = opts?.kind ?? 'hs'
  const moduleKey = opts?.moduleKey ?? 'hs_dashboard'
  const WidgetBody = widgetBodyFor(kind)

  app.addHook('preHandler', requireAuth)

  // ── Dashboards ────────────────────────────────────────────

  app.get('/dashboards', {
    preHandler: requirePermission(moduleKey, 'view'),
  }, async (req) => {
    const { venue_id, active } = req.query
    if (!venue_id) throw httpError(400, 'venue_id required')

    return withTenant(req.tenantId, tx => {
      const activeFilter = active === 'all' ? tx`` : tx`AND is_active = true`
      return tx`
        SELECT * FROM hs_dashboards
         WHERE tenant_id = ${req.tenantId}
           AND venue_id  = ${venue_id}
           AND kind      = ${kind}
           ${activeFilter}
         ORDER BY sort_order, name
      `
    })
  })

  app.post('/dashboards', {
    preHandler: requirePermission(moduleKey, 'manage'),
  }, async (req) => {
    const body = DashboardBody.parse(req.body)
    const [row] = await withTenant(req.tenantId, tx => tx`
      INSERT INTO hs_dashboards (tenant_id, venue_id, kind, name, sort_order, column_count)
      VALUES (${req.tenantId}, ${body.venue_id}, ${kind}, ${body.name}, ${body.sort_order ?? 0}, ${body.column_count ?? 4})
      RETURNING *
    `)
    return row
  })

  app.patch('/dashboards/:id', {
    preHandler: requirePermission(moduleKey, 'manage'),
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
         AND kind      = ${kind}
       RETURNING *
    `)
    if (!row) throw httpError(404, 'Dashboard not found')
    return row
  })

  app.delete('/dashboards/:id', {
    preHandler: requirePermission(moduleKey, 'manage'),
  }, async (req) => {
    const [row] = await withTenant(req.tenantId, tx => tx`
      UPDATE hs_dashboards
         SET is_active = false, updated_at = now()
       WHERE id = ${req.params.id}
         AND tenant_id = ${req.tenantId}
         AND kind      = ${kind}
       RETURNING *
    `)
    if (!row) throw httpError(404, 'Dashboard not found')
    return row
  })

  app.put('/dashboards/reorder', {
    preHandler: requirePermission(moduleKey, 'manage'),
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
             AND kind      = ${kind}
        `
      }
    })
    return { ok: true }
  })

  // ── Widgets ──────────────────────────────────────────────

  app.get('/dashboards/:id/widgets', {
    preHandler: requirePermission(moduleKey, 'view'),
  }, async (req) => {
    const { active } = req.query
    return withTenant(req.tenantId, async tx => {
      await loadDashboard(tx, req.tenantId, req.params.id, kind)
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
    preHandler: requirePermission(moduleKey, 'manage'),
  }, async (req) => {
    const body = WidgetBody.parse(req.body)
    return withTenant(req.tenantId, async tx => {
      const dashboard = await loadDashboard(tx, req.tenantId, req.params.id, kind)

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
          (tenant_id, dashboard_id, widget_type, checklist_template_id, title_override, sort_order, col_span, height_px, settings)
        VALUES
          (${req.tenantId}, ${req.params.id}, ${body.widget_type},
           ${body.checklist_template_id ?? null}, ${body.title_override ?? null}, ${body.sort_order ?? 0},
           ${body.col_span ?? 1}, ${body.height_px ?? 480}, ${tx.json(body.settings ?? {})})
        RETURNING *
      `
      return row
    })
  })

  app.patch('/dashboards/:id/widgets/:widgetId', {
    preHandler: requirePermission(moduleKey, 'manage'),
  }, async (req) => {
    const body = WidgetPatch.parse(req.body)
    const fields = Object.keys(body).filter(k => body[k] !== undefined)
    if (!fields.length) throw httpError(400, 'No fields to update')

    const [row] = await withTenant(req.tenantId, async tx => {
      await loadDashboard(tx, req.tenantId, req.params.id, kind)
      const values = Object.fromEntries(fields.map(k => [k, k === 'settings' ? tx.json(body[k]) : body[k]]))
      return tx`
        UPDATE hs_dashboard_widgets
           SET ${tx(values, ...fields)},
               updated_at = now()
         WHERE id = ${req.params.widgetId}
           AND dashboard_id = ${req.params.id}
           AND tenant_id    = ${req.tenantId}
         RETURNING *
      `
    })
    if (!row) throw httpError(404, 'Widget not found')
    return row
  })

  app.delete('/dashboards/:id/widgets/:widgetId', {
    preHandler: requirePermission(moduleKey, 'manage'),
  }, async (req) => {
    const [row] = await withTenant(req.tenantId, async tx => {
      await loadDashboard(tx, req.tenantId, req.params.id, kind)
      return tx`
        DELETE FROM hs_dashboard_widgets
         WHERE id = ${req.params.widgetId}
           AND dashboard_id = ${req.params.id}
           AND tenant_id    = ${req.tenantId}
         RETURNING *
      `
    })
    if (!row) throw httpError(404, 'Widget not found')
    return row
  })

  app.put('/dashboards/:id/widgets/reorder', {
    preHandler: requirePermission(moduleKey, 'manage'),
  }, async (req) => {
    const { ids } = z.object({ ids: z.array(z.string().uuid()) }).parse(req.body)

    await withTenant(req.tenantId, async tx => {
      await loadDashboard(tx, req.tenantId, req.params.id, kind)
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
