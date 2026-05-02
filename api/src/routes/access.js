// src/routes/access.js
//
// Tenant-scoped access management:
//   - module on/off switches
//   - custom roles + permission matrix
//   - role catalogue for admin pickers
//
// Mounted at /api/access. All routes require auth; mutating
// routes require the tenant's `team` module to permit "manage"
// (which by default is owner-only).

import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { MODULES, MODULE_KEYS, MODULE_GROUPS, PERMISSION_LEVELS } from '../config/modules.js'

const PermissionSchema = z.record(
  z.string(),
  z.enum(PERMISSION_LEVELS),
)

const ModuleToggleBody = z.object({
  is_enabled: z.boolean().optional(),
  config:     z.record(z.string(), z.any()).optional(),
})

const RoleBody = z.object({
  key:         z.string().min(1).max(50).regex(/^[a-z0-9_-]+$/),
  label:       z.string().min(1).max(100),
  description: z.string().max(500).nullable().optional(),
  is_active:   z.boolean().default(true),
  sort_order:  z.number().int().default(99),
  permissions: PermissionSchema.default({}),
})

const RolePatch = z.object({
  label:       z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  is_active:   z.boolean().optional(),
  sort_order:  z.number().int().optional(),
  permissions: PermissionSchema.optional(),
})

export default async function accessRoutes(app) {
  app.addHook('preHandler', requireAuth)

  // ── GET /api/access/modules ────────────────────────────
  // Returns the catalogue of all known modules merged with each
  // tenant's enabled state. Available to anyone authenticated —
  // the frontend uses this to render the role permission matrix
  // and to compute nav gating.
  app.get('/modules', async (req) => {
    if (!req.tenantId) return MODULES.map(m => ({ ...m, is_enabled: true, config: {} }))
    const rows = await withTenant(req.tenantId, tx => tx`
      SELECT module_key, is_enabled, config
        FROM tenant_modules
       WHERE tenant_id = ${req.tenantId}
    `)
    const byKey = Object.fromEntries(rows.map(r => [r.module_key, r]))
    return MODULES.map(m => ({
      ...m,
      is_enabled: byKey[m.key]?.is_enabled ?? true,
      config:     byKey[m.key]?.config ?? {},
    }))
  })

  // ── GET /api/access/module-groups ──────────────────────
  // Returns module groups merged with their enabled state. A group's
  // is_enabled is the AND of all member modules — if ANY member is
  // disabled in tenant_modules, the group reports disabled.
  app.get('/module-groups', async (req) => {
    if (!req.tenantId) return MODULE_GROUPS.map(g => ({ ...g, is_enabled: true }))
    const rows = await withTenant(req.tenantId, tx => tx`
      SELECT module_key, is_enabled
        FROM tenant_modules
       WHERE tenant_id = ${req.tenantId}
    `)
    const enabled = Object.fromEntries(rows.map(r => [r.module_key, r.is_enabled]))
    return MODULE_GROUPS.map(g => ({
      ...g,
      is_enabled: g.moduleKeys.every(k => enabled[k] !== false),
    }))
  })

  // ── PATCH /api/access/module-groups/:key ───────────────
  // Toggle every module in a group on/off in one round-trip.
  // Owner-only. Body: { is_enabled: boolean }.
  app.patch('/module-groups/:key', {
    preHandler: requireRole('owner'),
  }, async (req) => {
    if (!req.tenantId) throw httpError(400, 'No tenant context')
    const group = MODULE_GROUPS.find(g => g.key === req.params.key)
    if (!group) throw httpError(400, 'Unknown module group')
    const body = ModuleToggleBody.parse(req.body)
    if (typeof body.is_enabled !== 'boolean') throw httpError(400, 'is_enabled is required')

    await withTenant(req.tenantId, async tx => {
      for (const moduleKey of group.moduleKeys) {
        await tx`
          INSERT INTO tenant_modules (tenant_id, module_key, is_enabled)
          VALUES (${req.tenantId}, ${moduleKey}, ${body.is_enabled})
          ON CONFLICT (tenant_id, module_key) DO UPDATE
             SET is_enabled = ${body.is_enabled}, updated_at = now()
        `
      }
    })

    return { key: group.key, is_enabled: body.is_enabled, modules: group.moduleKeys }
  })

  // ── PATCH /api/access/modules/:key ─────────────────────
  // Toggle a single module on/off. Used internally for granular
  // per-module overrides; the UI normally uses the group endpoint
  // above. Owner only.
  app.patch('/modules/:key', {
    preHandler: requireRole('owner'),
  }, async (req) => {
    if (!req.tenantId) throw httpError(400, 'No tenant context')
    if (!MODULE_KEYS.includes(req.params.key)) throw httpError(400, 'Unknown module')
    const body = ModuleToggleBody.parse(req.body)

    const [row] = await withTenant(req.tenantId, tx => tx`
      INSERT INTO tenant_modules (tenant_id, module_key, is_enabled, config)
      VALUES (${req.tenantId}, ${req.params.key},
              ${body.is_enabled ?? true},
              ${tx.json(body.config ?? {})})
      ON CONFLICT (tenant_id, module_key) DO UPDATE
         SET is_enabled = COALESCE(${body.is_enabled ?? null}, tenant_modules.is_enabled),
             config     = COALESCE(${tx.json(body.config ?? null)}, tenant_modules.config),
             updated_at = now()
      RETURNING module_key, is_enabled, config
    `)
    return row
  })

  // ── GET /api/access/roles ──────────────────────────────
  // Lists the tenant's roles with permissions. Role admin reads
  // it to render the matrix; team admin reads it to populate
  // the role dropdown.
  app.get('/roles', async (req) => {
    if (!req.tenantId) return []
    return withTenant(req.tenantId, tx => tx`
      SELECT id, key, label, description, is_builtin, is_active,
             permissions, sort_order, created_at, updated_at
        FROM tenant_roles
       WHERE tenant_id = ${req.tenantId}
       ORDER BY sort_order, label
    `)
  })

  // ── POST /api/access/roles ─────────────────────────────
  // Create a custom role.
  app.post('/roles', {
    preHandler: requireRole('owner'),
  }, async (req, reply) => {
    if (!req.tenantId) throw httpError(400, 'No tenant context')
    const body = RoleBody.parse(req.body)

    // Reject permission keys that aren't real modules
    for (const k of Object.keys(body.permissions)) {
      if (!MODULE_KEYS.includes(k)) throw httpError(400, `Unknown module: ${k}`)
    }

    const [row] = await withTenant(req.tenantId, tx => tx`
      INSERT INTO tenant_roles (tenant_id, key, label, description, is_builtin, is_active, sort_order, permissions)
      VALUES (${req.tenantId}, ${body.key}, ${body.label},
              ${body.description ?? null}, false, ${body.is_active},
              ${body.sort_order}, ${tx.json(body.permissions)})
      RETURNING *
    `)
    return reply.code(201).send(row)
  })

  // ── PATCH /api/access/roles/:id ────────────────────────
  // Update a role's label/description/permissions/active state.
  // Built-in roles can have permissions edited but their key cannot
  // be changed.
  app.patch('/roles/:id', {
    preHandler: requireRole('owner'),
  }, async (req) => {
    if (!req.tenantId) throw httpError(400, 'No tenant context')
    const body = RolePatch.parse(req.body)
    const fields = Object.keys(body)
    if (!fields.length) throw httpError(400, 'No fields to update')

    if (body.permissions) {
      for (const k of Object.keys(body.permissions)) {
        if (!MODULE_KEYS.includes(k)) throw httpError(400, `Unknown module: ${k}`)
      }
    }

    const [row] = await withTenant(req.tenantId, tx => tx`
      UPDATE tenant_roles
         SET ${tx(body, ...fields)}, updated_at = now()
       WHERE id = ${req.params.id}
         AND tenant_id = ${req.tenantId}
      RETURNING *
    `)
    if (!row) throw httpError(404, 'Role not found')
    return row
  })

  // ── DELETE /api/access/roles/:id ───────────────────────
  // Built-in roles are protected (is_builtin = true).
  // Custom roles can be removed only if no users reference them.
  app.delete('/roles/:id', {
    preHandler: requireRole('owner'),
  }, async (req) => {
    if (!req.tenantId) throw httpError(400, 'No tenant context')

    const [target] = await withTenant(req.tenantId, tx => tx`
      SELECT id, is_builtin FROM tenant_roles
       WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}
    `)
    if (!target) throw httpError(404, 'Role not found')
    if (target.is_builtin) throw httpError(422, 'Built-in roles cannot be deleted')

    const [{ user_count }] = await withTenant(req.tenantId, tx => tx`
      SELECT COUNT(*)::int AS user_count FROM users
       WHERE custom_role_id = ${req.params.id}
    `)
    if (user_count > 0) {
      throw httpError(422, `Reassign ${user_count} user${user_count > 1 ? 's' : ''} before deleting this role`)
    }

    await withTenant(req.tenantId, tx => tx`
      DELETE FROM tenant_roles WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}
    `)
    return { ok: true }
  })
}
