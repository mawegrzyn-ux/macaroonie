// src/services/navTree.js — a person's own main menu.
//
// The menu (nav_items) as one person sees it: links whose module they can't
// open, or that are hidden from their role, are left out, and sections left
// empty go with them. /api/me sends it to the admin (nav_tree), and Pepper's
// menu search (routes/navAi.js) picks only from it, so it never offers a
// page the person can't open.
//
//   navItemVisible(item, permissions, roleId, isPlatformAdmin)
//   buildNavTree(items)                        flat nav_items rows -> tree
//   pruneNavTree(nodes, permissions, roleId, isPlatformAdmin)
//   navTreeFor(req)                            the caller's pruned tree
//   navLinksOf(tree)                           its links, flat, with where they sit

import { withTenant } from '../config/db.js'
import { MODULE_KEYS } from '../config/modules.js'
import { permissionLevels } from '../middleware/auth.js'
import { effectiveRoleId } from './roles.js'

// A link item is visible when its module (if any) isn't 'none' for this
// user AND their effective role isn't in hidden_role_ids. A section is
// pure grouping — always "passes" its own check — but is pruned if it
// ends up with no visible children. Platform admins bypass both checks
// (same as they bypass module permissions generally). A hidden link's
// children are unreachable and dropped too, not hoisted up.
export function navItemVisible(item, permissions, effectiveRoleId, isPlatformAdmin) {
  if (isPlatformAdmin) return true
  if (item.module && (permissions[item.module] ?? 'manage') === 'none') return false
  if (effectiveRoleId && item.hidden_role_ids?.includes(effectiveRoleId)) return false
  return true
}

export function buildNavTree(items, parentId = null) {
  return items
    .filter(i => i.parent_id === parentId)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(i => ({ ...i, children: buildNavTree(items, i.id) }))
}

export function pruneNavTree(nodes, permissions, effectiveRoleId, isPlatformAdmin) {
  const out = []
  for (const n of nodes) {
    const children = pruneNavTree(n.children, permissions, effectiveRoleId, isPlatformAdmin)
    if (n.kind === 'section') {
      if (children.length) out.push({ ...n, children })
      continue
    }
    if (navItemVisible(n, permissions, effectiveRoleId, isPlatformAdmin)) out.push({ ...n, children })
  }
  return out
}

/**
 * The caller's menu, pruned exactly as /api/me prunes it: a module switched
 * off for the group is 'none', else the caller's role decides; platform
 * admins see every link (navItemVisible()).
 */
export async function navTreeFor(req) {
  if (!req.tenantId) return []
  const isPlatformAdmin = !!req.isPlatformAdmin
  const { items, off } = await withTenant(req.tenantId, async tx => ({
    items: await tx`SELECT * FROM nav_items WHERE tenant_id = ${req.tenantId} AND is_active = true`,
    off: new Set((await tx`
      SELECT module_key FROM tenant_modules WHERE tenant_id = ${req.tenantId} AND NOT is_enabled
    `).map(r => r.module_key)),
  }))
  const levels = isPlatformAdmin
    ? Object.fromEntries(MODULE_KEYS.map(k => [k, 'manage']))
    : await permissionLevels(req, MODULE_KEYS)
  const permissions = {}
  for (const k of MODULE_KEYS) permissions[k] = off.has(k) ? 'none' : levels[k]
  const roleId = isPlatformAdmin ? null : await effectiveRoleId(req)
  return pruneNavTree(buildNavTree(items), permissions, roleId, isPlatformAdmin)
}

/** The tree's links, flat, in menu order: { label, route, icon, path }. */
export function navLinksOf(tree) {
  const out = []
  const walk = (list, path) => {
    for (const n of list || []) {
      if (n.kind !== 'section' && n.route) out.push({ label: n.label || '', route: n.route, icon: n.icon || null, path: path.join(' · ') })
      if (n.children?.length) walk(n.children, [...path, n.label || ''])
    }
  }
  walk(tree, [])
  return out
}
