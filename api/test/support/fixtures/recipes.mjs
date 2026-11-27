// Recipes (inventory phase 1, migrations 298 to 301): an item with a
// supplier price and a unit of its own, a prep recipe, a dish holding both,
// the dish saved whole, its live cost asked for, and a variation of it.
export const order = 85

// The tenant sweep's id kinds for this area's tables.
export const kinds = { recipeId: ['recipes'], unitId: ['inv_item_units'] }

export async function fill(ctx) {
  const { mark, ids, step, post, put, patch } = ctx
  const supplier = await step('recipe supplier', () => post('/api/suppliers', { name: mark + ' Dairy Co', send_method: 'print' }))
  const item = await step('recipe item', () => post('/api/inventory/items', { name: mark + ' Cheddar', base_unit: 'g', yield_pct: 95 }))
  if (!item) return
  if (supplier) await step('recipe item price', () => post(`/api/inventory/items/${item.id}/quotes`, { supplier_id: supplier.id, pack_name: 'Block', pack_qty: 5, pack_unit: 'kg', price: 40 }))
  // An item's own unit (migration 298), changed once so the sweep sends that again as the other group.
  const withUnit = await step('item unit', () => post(`/api/inventory/items/${item.id}/units`, { name: 'slice', base_qty: 20 }))
  const unit = withUnit?.units?.[0]
  if (unit) {
    ids.itemUnit = unit.id
    await step('item unit change', () => patch(`/api/inventory/units/${unit.id}`, { base_qty: 21 }))
  }
  const prep = await step('prep recipe', () => post('/api/recipes', {
    name: mark + ' Cheese sauce', kind: 'prep', yield_qty: 1, yield_unit: 'l', loss_pct: 10,
    lines: [{ item_id: item.id, qty: 200, unit: 'g' }],
  }))
  if (!prep) return
  ids.prepRecipe = prep.id
  const lines = [{ item_id: item.id, qty: 2, unit: 'slice', yield_pct: null, note: mark + ' grated' }, { sub_recipe_id: prep.id, qty: 50, unit: 'ml', yield_pct: null, note: null }]
  const dish = await step('dish recipe', () => post('/api/recipes', { name: mark + ' Toastie', kind: 'dish', portions: 1, status: 'live', lines }))
  if (!dish) return
  ids.recipe = dish.id
  ctx.made.recipe = dish
  // The whole recipe saved (every field, lines replaced), as the page saves it.
  await step('recipe save', () => put('/api/recipes/' + dish.id, {
    name: dish.name, kind: 'dish', category: mark + ' Lunch', code: null, status: 'live', yield_qty: null, yield_unit: null,
    portions: 1, loss_pct: 0, method: mark + ' Toast both sides.', photo_url: null, shelf_life_hours: null, variant_of: null,
    notes: null, is_active: true, lines,
  }))
  // The editor's live cost: nothing written, the other group's ids refused.
  await step('recipe preview', () => post('/api/recipes/preview', { id: dish.id, name: dish.name, kind: 'dish', portions: 2, lines }))
  const variation = await step('recipe variation', () => post(`/api/recipes/${dish.id}/copy`, { name: mark + ' Toastie to take away', variant: true }))
  if (variation) await step('recipe switched on', () => patch(`/api/recipes/${variation.id}/active`, { is_active: true }))
}
