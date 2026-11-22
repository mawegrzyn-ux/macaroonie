// Menus: a menu with dishes, an option group (and its copy), a meal deal,
// published; dietary tags, the allergen notice, a translation. Hands on
// made.menu, made.vg (the option group), made.dish and made.menuSection.
import { randomUUID } from 'node:crypto'
import { menuSaveBody } from '../../../src/routes/menus.js'

export const order = 30

export const kinds = { menuId: ['menus'], releaseId: ['menu_releases'], itemId: ['menu_items'], designId: ['menu_print_designs'] }

export async function fill(ctx) {
  const { mark, slug, ids, made, step, post, put, patch, get } = ctx
  const menu = await step('menu', () => post('/api/menus', { name: mark + ' Lunch', slug: slug + '-lunch' }))
  ids.menu = menu?.id
  made.menu = menu
  await step('dietary tag', () => post('/api/menus/dietary', { label: mark + ' Spicy', code: slug, glyph: 'S', kind: 'dietary' }))
  // With its own kiosk look and a variation type (migration 206).
  const vg = await step('variant group', () => post('/api/menus/variant-groups', {
    name: mark + ' Size', kiosk_tiles: 'round', kiosk_entrance: 'slide', variation_type: 'side',
    options: [{ label: 'Small', price_pence: 0 }, { label: 'Large', price_pence: 200 }],
  }))
  made.vg = vg
  const vgCopy = vg ? await step('variant group copy', () => post(`/api/menus/variant-groups/${vg.id}/copy`, {})) : null
  let dish = null
  let menuSection = null
  if (menu) {
    const full = await step('menu load', () => get(`/api/menus/${menu.id}`))
    const large = vg?.options?.find(o => o.label === 'Large')
    await step('menu tree', () => patch(`/api/menus/${menu.id}`, {
      ...full,
      callouts: [{ kind: 'custom', title: mark + ' Ask us', body: mark + ' about spice' }],
      sections: [{ title: mark + ' Noodles', items: [
        { name: mark + ' Pad Thai', price_pence: 1250, is_orderable: true, description: mark + ' dish', dietary: [slug, 'gluten'], allergen_levels: { gluten: 'may_contain' },
          variant_groups: vg ? [{ group_id: vg.id, overrides: large ? [{ option_id: large.id, price_pence: 250 }] : [] }] : [],
          // Codes (migration 268): menu_item_option_codes gets a row.
          sku: 'PAD-THAI', barcode: '5000112637922',
          option_codes: large ? [{ option_id: large.id, sku: 'PAD-THAI-L', barcode: '96385074' }] : [] },
        { name: mark + ' Green Curry', price_pence: 1350, is_orderable: true, variants: [{ label: mark + ' Chicken', price_pence: 1350 }] },
      ] }],
    }))
    // A meal deal that asks the Pad Thai's size as the copy of its group,
    // with the deal's own charge for one of its options (options in the
    // deal, shared/combos.js dealChoices()).
    const tree = vg && vgCopy ? await step('menu load for the deal', () => get(`/api/menus/${menu.id}`)) : null
    const pad = tree?.sections?.[0]?.items?.[0]
    if (pad) {
      const body = menuSaveBody(tree)
      body.sections.push({ title: mark + ' Deals', items: [{
        name: mark + ' Lunch deal', kind: 'combo', price_pence: 1500, is_orderable: true,
        combo: { mode: 'manual', steps: [{ id: randomUUID(), name: mark + ' Main', min: 1, max: 1, options: [
          { id: randomUUID(), type: 'item', item_id: pad.id, groups: { [vg.id]: { use: 'swap', group_id: vgCopy.id,
            ...(vgCopy.options?.[0] ? { prices: { [vgCopy.options[0].id]: 75 } } : {}) } } },
        ] }] },
      }] })
      await step('meal deal', () => patch(`/api/menus/${menu.id}`, body))
    }
    await step('menu publish', () => post(`/api/menus/${menu.id}/publish`, {}))
    await step('menu design', () => post(`/api/menus/${menu.id}/designs`, { name: mark + ' A4', layout: { pages: [{ id: 'p1', blocks: [] }] } }))
    await step('menu preview link', () => post(`/api/menus/${menu.id}/preview-link`, {}))
    const reloaded = await step('menu reload', () => get(`/api/menus/${menu.id}`))
    menuSection = reloaded?.sections?.[0] ?? null
    dish = menuSection?.items?.[0] ?? null
  }
  made.menuSection = menuSection
  made.dish = dish
  await step('allergen notice', () => put('/api/menus/allergen-notice', { title: mark + ' Allergies', body: mark + ' ask staff', removable_note: '* on request', ordering_text: mark + ' tell us', used_only: true }))
  if (dish) await step('translation', () => put('/api/menus/translations', { lang: 'es', texts: { ['item:' + dish.id + ':name']: mark + ' Pad Thai (es)' } }))
}
