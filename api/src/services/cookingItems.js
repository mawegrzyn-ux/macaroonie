// src/services/cookingItems.js
//
// The dish buttons for cooking checks at a venue (migration 142). One
// loader, used by GET /food-safety/cooking/items (the picker) and the H&S
// test data generator, so both always offer the same dishes.
//
//   item_source  'menus' — dishes on the venue's published menus (venue
//                          menus plus tenant-wide ones), one tab per section
//                'own'   — the venue's own list (fs_cooking_items), one tab
//                          per category, uncategorised under OWN_TAB
//                'both'  — menu tabs first, then own-list tabs
//
// Every item is { id, name, kind: 'menu' | 'own' }; a reading logs it as
// menu_item_id or cooking_item_id respectively.

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
    const rows = await tx`
      SELECT s.id AS section_id, s.title AS section_title, i.id AS item_id, i.name AS item_name
        FROM menu_items i
        JOIN menu_sections s ON s.id = i.section_id
        JOIN menus m ON m.id = s.menu_id
       WHERE i.tenant_id = ${tenantId}
         AND m.tenant_id = ${tenantId}
         AND m.is_published = true
         AND (m.venue_id = ${venueId} OR m.venue_id IS NULL)
       ORDER BY m.sort_order, s.sort_order, i.sort_order
    `
    const byId = new Map()
    for (const r of rows) {
      if (!byId.has(r.section_id)) {
        const sec = { id: r.section_id, title: r.section_title, kind: 'menu', items: [] }
        byId.set(r.section_id, sec)
        sections.push(sec)
      }
      byId.get(r.section_id).items.push({ id: r.item_id, name: r.item_name, kind: 'menu' })
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
