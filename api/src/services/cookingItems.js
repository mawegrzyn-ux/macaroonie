// src/services/cookingItems.js
//
// The dish buttons for cooking checks at a venue (migration 142). One
// loader, used by GET /food-safety/cooking/items (the picker) and the H&S
// test data generator, so both always offer the same dishes.
//
//   item_source  'menus' — dishes on the live versions of the venue's
//                          published menus (venue menus plus tenant-wide
//                          ones), one tab per section
//                'own'   — the venue's own list (fs_cooking_items), one tab
//                          per category, uncategorised under OWN_TAB
//                'both'  — menu tabs first, then own-list tabs
//
// Every item is { id, name, kind: 'menu' | 'own' }; a reading logs it as
// menu_item_id or cooking_item_id respectively.

import { loadMenuVersions } from './menuReleases.js'

export const ITEM_SOURCES = ['menus', 'own', 'both']
export const OWN_TAB = 'Our items'

export async function cookingItemSource(tx, tenantId, venueId) {
  const [row] = await tx`
    SELECT item_source FROM fs_cooking_settings
     WHERE tenant_id = ${tenantId} AND venue_id = ${venueId}
  `
  return row?.item_source ?? 'menus'
}

export async function loadCookingPicker(tx, tenantId, venueId) {
  const source = await cookingItemSource(tx, tenantId, venueId)
  const sections = []

  if (source !== 'own') {
    // The live menus (migration 165): a dish added to a draft shows up here
    // once its menu is published, the same moment guests see it.
    const menus = await loadMenuVersions(tx, tenantId, { venueId, publishedOnly: true })
    for (const m of menus) {
      for (const s of m.sections || []) {
        if (!(s.items || []).length) continue
        sections.push({
          id: s.id, title: s.title, kind: 'menu',
          items: s.items.map(i => ({ id: i.id, name: i.name, kind: 'menu' })),
        })
      }
    }
  }

  if (source !== 'menus') {
    const rows = await tx`
      SELECT id, name, category FROM fs_cooking_items
       WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND is_active = true
       ORDER BY sort_order, name
    `
    // Tabs in the order their first item appears in the own list.
    const byTab = new Map()
    for (const r of rows) {
      const title = r.category?.trim() || OWN_TAB
      if (!byTab.has(title)) {
        const sec = { id: `own:${title}`, title, kind: 'own', items: [] }
        byTab.set(title, sec)
        sections.push(sec)
      }
      byTab.get(title).items.push({ id: r.id, name: r.name, kind: 'own' })
    }
  }

  return { item_source: source, sections }
}
