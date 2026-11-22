// src/config/defaultNav.js
//
// The default main menu: what new tenants are seeded with (platform.js's
// tenant creation route) and what "Reset to defaults" in the nav designer
// restores. Grouped by job, each page once. Migration 196 put every tenant
// on this tree and migration 202 replaced Till setup and Menu screens with the
// Store tech section (later migrations add single links, e.g. 219's Venue
// hub, 221's Today, 228's Till layouts, 241's designers, 243's Reports, 258's Allergens);
// api/test/nav-default.test.mjs checks 196's tree with those changes applied
// matches this one, so change them together.
//
// Entries carry no description here: one left empty uses its page's standard
// description (shared/navSearch.js NAV_DESCRIPTIONS), so a change to the
// standard words reaches every group that hasn't written its own.
//
// The tree is built from each area's pages (shared/nav/<area>.js: each
// record's section, parent and order) and the sections in
// shared/nav/sections.js, by shared/nav/index.js (22 Nov 2026).

import { DEFAULT_NAV_TREE } from '../../../shared/nav/index.js'

export { DEFAULT_NAV_TREE }

/** Insert DEFAULT_NAV_TREE for one tenant. Caller decides whether to clear existing rows first. */
export async function seedDefaultNav(tx, tenantId) {
  async function insertNode(node, parentId, sortOrder) {
    const kind = node.route ? 'link' : 'section'
    const [row] = await tx`
      INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order)
      VALUES (${tenantId}, ${parentId}, ${kind}, ${node.label}, ${node.icon ?? null}, ${node.route ?? null}, ${node.module ?? null}, ${sortOrder})
      RETURNING id
    `
    for (let i = 0; i < (node.children ?? []).length; i++) {
      await insertNode(node.children[i], row.id, i)
    }
  }
  for (let i = 0; i < DEFAULT_NAV_TREE.length; i++) {
    await insertNode(DEFAULT_NAV_TREE[i], null, i)
  }
}
