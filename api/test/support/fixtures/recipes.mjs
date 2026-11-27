// Recipes (inventory phase 1, migrations 298 to 301): an item with a
// supplier price and a unit of its own, a prep recipe, a dish holding both,
// the dish saved whole, its live cost asked for, and a variation of it.
// Phase 2 (migrations 302, 303): the menu's dish linked to the recipe for
// every venue and at the venue, a goods link, an option rule for the menus'
// option group and a dish's own exception, the cost targets with the menu
// section's own; later (fillLate, after the till's order types) links for an
// order type, a revenue stream and both.
// Phase 3 (migration 304): drafts Pepper read in (a prep recipe of the same
// request inside a dish, a group's prep recipe, a line kept in the notes), a
// recipe made for the menu's dish, and coverage by sales at the venue.
// Phase 7a (migration 314, in fillLate): menu engineering read, a cost
// scenario at the stream and order type saved whole, previewed and copied,
// and its prices previewed and pushed into the menu's draft.
export const order = 85
// After the till (140): its order type.
export const lateOrder = 150

// The tenant sweep's id kinds for this area's tables (and the menu rows its routes take by plain id).
export const kinds = {
  recipeId: ['recipes'], unitId: ['inv_item_units'],
  dishId: ['menu_items'], recipeLinkId: ['recipe_links'], optionRuleId: ['recipe_option_rules'], optionId: ['menu_variant_options'],
}

const blankRule = { option_id: null, dish_id: null, option_label: null, item_id: null, sub_recipe_id: null, swap_item_id: null, qty: null, unit: null, factor: null, recipe_id: null, note: null }

export async function fill(ctx) {
  const { V, mark, ids, step, post, put, patch, get } = ctx
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
  if (variation) {
    await step('recipe switched on', () => patch(`/api/recipes/${variation.id}/active`, { is_active: true }))
    ctx.made.recipeVariation = variation
  }

  // Phase 2: the menu's dish (menus.mjs) linked for every venue, and the venue's own variation.
  const menuDish = ctx.made.dish
  if (menuDish) {
    await step('recipe link', () => put(`/api/recipe-links/dishes/${menuDish.id}/cell`, { recipe_id: dish.id, portions: 1 }))
    if (variation) await step('recipe link at a venue', () => put(`/api/recipe-links/dishes/${menuDish.id}/cell`, { venue_id: V, recipe_id: variation.id, portions: 2 }))
    // What its option does, for every dish and for this one (an exception).
    const option = ctx.made.vg?.options?.find(o => o.label === 'Large')
    if (option) {
      await step('option rule', () => put('/api/recipe-options/rules', { ...blankRule, option_id: option.id, action: 'scale', factor: 1.5, note: mark + ' bigger' }))
      await step('option rule for a dish', () => put('/api/recipe-options/rules', { ...blankRule, option_id: option.id, dish_id: menuDish.id, action: 'add', item_id: item.id, qty: 30, unit: 'g' }))
    }
  }
  // Phase 3: drafts read in (refs mapped back to the group's item and prep recipe; the other group's refused).
  const drafts = await step('recipe drafts', () => post('/api/recipes/drafts', { source: 'reader', recipes: [
    { key: 'd', name: mark + ' Read toastie', kind: 'dish', portions: 1, lines: [{ new_key: 'p', qty: 20, unit: 'ml' }, { sub_recipe_id: prep.id, qty: 10, unit: 'ml' }], left_out: [mark + ' 1 pinch salt'] },
    { key: 'p', name: mark + ' Read sauce', kind: 'prep', yield_qty: 1, yield_unit: 'l', lines: [{ item_id: item.id, qty: 100, unit: 'g' }] },
  ] }))
  if (drafts?.made?.[0]) ctx.made.readRecipe = drafts.made[0]
  if (menuDish) await step('recipe for a dish', () => post(`/api/recipe-links/dishes/${menuDish.id}/recipe`, { name: mark + ' Pad Thai recipe', code: null, category: null }))
  await step('recipe coverage', () => get('/api/recipes/coverage?venue_id=' + V))
  // The cost targets, with the menu section's own (migration 302).
  const section = ctx.made.menuSection
  await step('costing settings', () => put('/api/menu-margins/settings', {
    target_pct: 28, limit_pct: 33, sections: section ? [{ section_id: section.id, target_pct: 25, limit_pct: 30 }] : [],
  }))
}

/** Links that need the till's order type and a revenue stream of the venue. */
export async function fillLate(ctx) {
  const { V, mark, made, step, post, put } = ctx
  const menuDish = made.dish
  const recipe = made.recipeVariation || made.recipe
  if (!menuDish || !recipe) return
  const stream = await step('recipe link stream', () => post(`/api/pos/venues/${V}/revenue-streams`, { name: mark + ' Terrace' }))
  if (made.orderType) await step('recipe link for an order type', () => put(`/api/recipe-links/dishes/${menuDish.id}/cell`, { order_type_id: made.orderType.id, recipe_id: recipe.id }))
  if (stream) await step('recipe link for a stream', () => put(`/api/recipe-links/dishes/${menuDish.id}/cell`, { revenue_stream_id: stream.id, recipe_id: recipe.id }))
  if (stream && made.orderType) {
    await step('recipe link for a stream and order type', () => put(`/api/recipe-links/dishes/${menuDish.id}/cell`, { venue_id: V, revenue_stream_id: stream.id, order_type_id: made.orderType.id, recipe_id: recipe.id, portions: 1.5 }))
  }
  // Phase 7a (migration 314): menu engineering, and a cost scenario at the stream and order type with a
  // price change for the menu's dish and a cost change for its section, saved whole, copied, its prices
  // previewed and pushed into the menu's draft.
  await step('menu engineering', () => ctx.get('/api/menu-margins/engineering?venue_id=' + V + '&days=28'))
  const menu = made.menu
  const section = made.menuSection
  if (!menu) return
  const scenarioBody = {
    name: mark + ' Spring prices', menu_id: menu.id, venue_id: V, revenue_stream_id: stream?.id ?? null, order_type_id: made.orderType?.id ?? null,
    mix_days: 28, notes: mark + ' what if',
    changes: [
      { what: 'price', applies: 'dish', section_id: null, dish_id: menuDish.id, how: 'percent', value: 5, round_to: 10, round: 'up' },
      ...(section ? [{ what: 'cost', applies: 'section', section_id: section.id, dish_id: null, how: 'amount', value: 0.1, round_to: null, round: null }] : []),
    ],
  }
  const scenario = await step('cost scenario', () => post('/api/cost-scenarios', scenarioBody))
  if (!scenario) return
  made.scenario = scenario
  await step('cost scenario save', () => put('/api/cost-scenarios/' + scenario.id, { ...scenarioBody, name: mark + ' Spring prices, saved' }))
  await step('cost scenario preview', () => post('/api/cost-scenarios/preview', scenarioBody))
  await step('cost scenario copy', () => post(`/api/cost-scenarios/${scenario.id}/copy`, {}))
  const plan = await step('push prices preview', () => post(`/api/cost-scenarios/${scenario.id}/push/preview`, {}))
  if (plan?.prices?.length) await step('push prices', () => post(`/api/cost-scenarios/${scenario.id}/push`, { stamp: plan.stamp }))
}
