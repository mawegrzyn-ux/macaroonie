// src/routes/nav.js
//
// Admin-configurable navigation. GET /api/me returns the *effective* tree
// for the caller's own role (see platform.js) — everything here is the
// designer's own CRUD surface, gated on the nav_designer module (owner
// only by default, see migration 091).
//
// The tree editor is an outline (indent/outdent/move-up/move-down)
// rather than free-form drag-and-drop reparenting — reorder() handles
// "move up/down among siblings", reparent() handles "indent" (become a
// child of the previous sibling) and "outdent" (become a sibling of the
// current parent), both from the frontend computing the right
// parent_id/index and calling the one endpoint that fits.
//
// Mounted at /api/nav in app.js.

import { z } from 'zod'
import { withTenant, sql } from '../config/db.js'
import { requireAuth, requirePermission } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { seedDefaultNav } from '../config/defaultNav.js'

// Every route the admin portal actually has, so the designer can only
// point nav items at real pages — never an arbitrary URL. `module`, where
// set, is just a suggestion pre-fill; the admin can still leave it unset
// or pick a different one (e.g. to gate an item more/less strictly than
// its page's own default guard).
const ROUTE_CATALOG = [
  { route: '/', label: 'Overview', icon: 'LayoutDashboard', module: 'dashboard' },
  { route: '/timeline', label: 'Timeline', icon: 'CalendarDays', module: 'bookings' },
  { route: '/bookings', label: 'Bookings', icon: 'BookOpen', module: 'bookings' },
  { route: '/customers', label: 'Customers', icon: 'UserRound', module: 'customers' },
  { route: '/order-sheets', label: 'Order sheets', icon: 'ClipboardList', module: 'order_sheets' },
  { route: '/order-sheets/templates', label: 'Order sheet templates', icon: 'ClipboardList', module: 'order_sheet_setup' },
  { route: '/order-sheets/categories', label: 'Order sheet categories', icon: 'Tag', module: 'order_sheet_setup' },
  { route: '/cash-recon', label: 'Cash recon', icon: 'Wallet', module: 'cash_recon' },
  { route: '/food-safety', label: 'Food safety', icon: 'Thermometer', module: 'food_safety' },
  { route: '/checklists', label: 'Checklists', icon: 'ListChecks', module: 'checklists' },
  { route: '/hs-dashboard', label: 'H&S Dashboard', icon: 'LayoutGrid', module: 'hs_dashboard' },
  { route: '/hs-action-log', label: 'Action log', icon: 'ClipboardCheck', module: 'hs_action_log' },
  { route: '/website', label: 'Website', icon: 'Globe', module: 'website' },
  { route: '/menus', label: 'Menus', icon: 'ChefHat', module: 'menus' },
  { route: '/menus/variant-groups', label: 'Menu variant groups', icon: 'Layers', module: 'menus' },
  { route: '/menus/dietary-groups', label: 'Menu dietary groups', icon: 'Tag', module: 'menus' },
  { route: '/media', label: 'Media', icon: 'FolderOpen', module: 'website' },
  { route: '/reviews', label: 'Reviews', icon: 'MessageSquare', module: 'website' },
  { route: '/venues', label: 'Venues', icon: 'Building2', module: 'venues' },
  { route: '/tables', label: 'Tables', icon: 'Table2', module: 'tables' },
  { route: '/schedule', label: 'Schedule', icon: 'Clock', module: 'schedule' },
  { route: '/rules', label: 'Rules', icon: 'Settings', module: 'rules' },
  { route: '/email-templates', label: 'Emails', icon: 'Mail', module: 'email_templates' },
  { route: '/email-monitoring', label: 'Email monitor', icon: 'Activity', module: 'email_templates' },
  { route: '/team', label: 'Team', icon: 'Users', module: 'team' },
  { route: '/access', label: 'Access', icon: 'Shield', module: 'team' },
  { route: '/settings', label: 'Settings', icon: 'SlidersHorizontal', module: 'settings' },
  { route: '/widget-test', label: 'Widget test', icon: 'LayoutTemplate', module: 'widget_test' },
  { route: '/test-data', label: 'Test data', icon: 'FlaskConical', module: 'test_data' },
  { route: '/legacy-import', label: 'Legacy import', icon: 'FileSpreadsheet', module: 'test_data' },
  { route: '/nav-designer', label: 'Navigation', icon: 'Compass', module: 'nav_designer' },
  { route: '/issues', label: 'Issues', icon: 'AlertCircle', module: 'issue_log' },
  { route: '/feature-requests', label: 'Feature requests', icon: 'Lightbulb', module: 'feature_requests' },
  { route: '/changelog', label: "What's new", icon: 'Newspaper', module: 'changelog' },
  { route: '/docs', label: 'Documentation', icon: 'BookMarked', module: 'documentation' },
  { route: '/help', label: 'Help', icon: 'HelpCircle', module: 'documentation' },
]

const NavItemBody = z.object({
  parent_id:          z.string().uuid().nullable().optional(),
  kind:               z.enum(['section', 'link']).default('link'),
  label:              z.string().min(1).max(100),
  icon:               z.string().max(60).nullable().optional(),
  route:              z.string().max(200).nullable().optional(),
  module:             z.string().max(60).nullable().optional(),
  hidden_role_ids:    z.array(z.string().uuid()).optional(),
  show_in_launcher:   z.boolean().optional(),
  sort_order:         z.number().int().optional(),
}).refine(b => b.kind === 'section' || !!b.route, { message: 'route is required for a link item' })

const NavItemPatch = z.object({
  parent_id:          z.string().uuid().nullable().optional(),
  label:              z.string().min(1).max(100).optional(),
  icon:               z.string().max(60).nullable().optional(),
  route:              z.string().max(200).nullable().optional(),
  module:             z.string().max(60).nullable().optional(),
  hidden_role_ids:    z.array(z.string().uuid()).optional(),
  show_in_launcher:   z.boolean().optional(),
  launcher_sort_order: z.number().int().optional(),
  is_active:          z.boolean().optional(),
})

export default async function navRoutes(app) {
  app.addHook('preHandler', requireAuth)

  app.get('/route-catalog', { preHandler: requirePermission('nav_designer', 'view') }, async () => ROUTE_CATALOG)

  app.get('/items', { preHandler: requirePermission('nav_designer', 'view') }, async (req) => {
    return withTenant(req.tenantId, tx => tx`
      SELECT * FROM nav_items WHERE tenant_id = ${req.tenantId} AND is_active = true
       ORDER BY parent_id NULLS FIRST, sort_order
    `)
  })

  app.post('/items', { preHandler: requirePermission('nav_designer', 'manage') }, async (req) => {
    const body = NavItemBody.parse(req.body)

    return withTenant(req.tenantId, async tx => {
      if (body.parent_id) {
        const [parent] = await tx`SELECT id FROM nav_items WHERE id = ${body.parent_id} AND tenant_id = ${req.tenantId}`
        if (!parent) throw httpError(404, 'Parent nav item not found')
      }
      // New items land at the end of their sibling list.
      const [{ max_sort }] = await tx`
        SELECT COALESCE(MAX(sort_order), -1) AS max_sort FROM nav_items
         WHERE tenant_id = ${req.tenantId} AND parent_id IS NOT DISTINCT FROM ${body.parent_id ?? null}
      `
      const [row] = await tx`
        INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, hidden_role_ids, show_in_launcher, sort_order)
        VALUES (${req.tenantId}, ${body.parent_id ?? null}, ${body.kind}, ${body.label}, ${body.icon ?? null},
                ${body.kind === 'section' ? null : body.route}, ${body.module ?? null},
                ${body.hidden_role_ids ?? []}, ${body.show_in_launcher ?? false}, ${max_sort + 1})
        RETURNING *
      `
      return row
    })
  })

  app.patch('/items/reorder', { preHandler: requirePermission('nav_designer', 'manage') }, async (req) => {
    const { parent_id, ids } = z.object({
      parent_id: z.string().uuid().nullable(),
      ids: z.array(z.string().uuid()).min(1),
    }).parse(req.body)

    await withTenant(req.tenantId, async tx => {
      const owned = await tx`
        SELECT id FROM nav_items
         WHERE id = ANY(${ids}::uuid[]) AND tenant_id = ${req.tenantId}
           AND parent_id IS NOT DISTINCT FROM ${parent_id}
      `
      if (owned.length !== ids.length) throw httpError(404, 'One or more nav items not found under that parent')
      for (let i = 0; i < ids.length; i++) {
        await tx`UPDATE nav_items SET sort_order = ${i}, updated_at = now() WHERE id = ${ids[i]} AND tenant_id = ${req.tenantId}`
      }
    })
    return { ok: true }
  })

  // Move an item to a new parent at a specific position among that
  // parent's children — used for indent (new parent = previous sibling)
  // and outdent (new parent = current grandparent). Re-sequences both the
  // source and destination sibling lists so sort_order stays gap-free.
  app.patch('/items/:id/reparent', { preHandler: requirePermission('nav_designer', 'manage') }, async (req) => {
    const { parent_id, index } = z.object({
      parent_id: z.string().uuid().nullable(),
      index: z.number().int().min(0),
    }).parse(req.body)

    await withTenant(req.tenantId, async tx => {
      const [item] = await tx`SELECT * FROM nav_items WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}`
      if (!item) throw httpError(404, 'Nav item not found')
      if (parent_id) {
        if (parent_id === item.id) throw httpError(400, 'An item cannot be its own parent')
        const [parent] = await tx`SELECT id, kind FROM nav_items WHERE id = ${parent_id} AND tenant_id = ${req.tenantId}`
        if (!parent) throw httpError(404, 'Parent nav item not found')
      }

      const oldParentId = item.parent_id
      const oldSiblings = (await tx`
        SELECT id FROM nav_items WHERE tenant_id = ${req.tenantId}
         AND parent_id IS NOT DISTINCT FROM ${oldParentId} AND id != ${item.id}
         ORDER BY sort_order
      `).map(r => r.id)

      const newSiblings = oldParentId === parent_id
        ? oldSiblings
        : (await tx`
            SELECT id FROM nav_items WHERE tenant_id = ${req.tenantId}
             AND parent_id IS NOT DISTINCT FROM ${parent_id}
             ORDER BY sort_order
          `).map(r => r.id)

      const insertAt = Math.min(index, newSiblings.length)
      newSiblings.splice(insertAt, 0, item.id)

      await tx`UPDATE nav_items SET parent_id = ${parent_id}, updated_at = now() WHERE id = ${item.id} AND tenant_id = ${req.tenantId}`
      for (let i = 0; i < newSiblings.length; i++) {
        await tx`UPDATE nav_items SET sort_order = ${i}, updated_at = now() WHERE id = ${newSiblings[i]} AND tenant_id = ${req.tenantId}`
      }
      if (oldParentId !== parent_id) {
        for (let i = 0; i < oldSiblings.length; i++) {
          await tx`UPDATE nav_items SET sort_order = ${i}, updated_at = now() WHERE id = ${oldSiblings[i]} AND tenant_id = ${req.tenantId}`
        }
      }
    })
    return { ok: true }
  })

  app.patch('/items/:id', { preHandler: requirePermission('nav_designer', 'manage') }, async (req) => {
    const body = NavItemPatch.parse(req.body)
    const fields = Object.keys(body).filter(k => body[k] !== undefined)
    if (!fields.length) throw httpError(400, 'No fields to update')

    return withTenant(req.tenantId, async tx => {
      if (body.parent_id !== undefined && body.parent_id === req.params.id) {
        throw httpError(400, 'An item cannot be its own parent')
      }
      const [row] = await tx`
        UPDATE nav_items
           SET ${tx(Object.fromEntries(fields.map(k => [k, body[k]])), ...fields)}
         WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}
         RETURNING *
      `
      if (!row) throw httpError(404, 'Nav item not found')
      return row
    })
  })

  app.delete('/items/:id', { preHandler: requirePermission('nav_designer', 'manage') }, async (req) => {
    const [row] = await withTenant(req.tenantId, tx => tx`
      DELETE FROM nav_items WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId} RETURNING id
    `)
    if (!row) throw httpError(404, 'Nav item not found')
    return { ok: true }
  })

  app.post('/reset', { preHandler: requirePermission('nav_designer', 'manage') }, async (req) => {
    await withTenant(req.tenantId, async tx => {
      await tx`DELETE FROM nav_items WHERE tenant_id = ${req.tenantId}`
      await seedDefaultNav(tx, req.tenantId)
    })
    return { ok: true }
  })

  app.patch('/style', { preHandler: requirePermission('nav_designer', 'manage') }, async (req) => {
    const { nav_style } = z.object({ nav_style: z.enum(['sidebar', 'launcher']) }).parse(req.body)
    const [row] = await withTenant(req.tenantId, tx => tx`
      UPDATE tenants SET nav_style = ${nav_style}, updated_at = now()
       WHERE id = ${req.tenantId} RETURNING id, nav_style
    `)
    if (!row) throw httpError(404, 'Tenant not found')
    return row
  })
}
