// What a sold item is (migration 267, shared/catalogue.js): the most specific
// level wins, as tax does, and anything without a type is food.
import test from 'node:test'
import assert from 'node:assert/strict'
import { ITEM_TYPES, itemType, cleanItemType, needsAllergens, showsInKitchen, typeSwitches } from '../catalogue.js'

test('the dish beats its section, which beats the menu; nothing set is food', () => {
  assert.equal(itemType({ item_type: 'service' }, { item_type: 'goods' }, { item_type: 'food' }), 'service')
  assert.equal(itemType({ item_type: null }, { item_type: 'goods' }, { item_type: 'food' }), 'goods')
  assert.equal(itemType({}, {}, { item_type: 'service' }), 'service')
  assert.equal(itemType({}, {}, {}), 'food')
  assert.equal(itemType(null, null, null), 'food')
  // A food dish in a retail section stays food (a sandwich in the shop).
  assert.equal(itemType({ item_type: 'food' }, { item_type: 'goods' }, { item_type: 'goods' }), 'food')
})

test('only the three types are kept; anything else is "the level above"', () => {
  assert.deepEqual(ITEM_TYPES, ['food', 'goods', 'service'])
  for (const bad of ['drink', '', 'FOOD', undefined, null, 3]) assert.equal(cleanItemType(bad), null)
  assert.equal(itemType({ item_type: 'drink' }, { item_type: 'goods' }, null), 'goods')
})

test('allergens and kitchen screens are for food only', () => {
  assert.equal(needsAllergens('food'), true)
  assert.equal(needsAllergens('goods'), false)
  assert.equal(needsAllergens('service'), false)
  assert.equal(needsAllergens(null), true)
  assert.equal(showsInKitchen('food'), true)
  assert.equal(showsInKitchen('goods'), false)
  assert.equal(typeSwitches('goods').codes, 'yes')
  assert.equal(typeSwitches('service').duration, true)
})

test('what guests are served: each item resolved, non-food without allergen data', async () => {
  const { resolveItemTypes, isFoodItem } = await import('../catalogue.js')
  const menu = {
    item_type: 'goods',
    sections: [
      { item_type: null, items: [
        { name: 'Mug', dietary: ['gluten'], allergen_levels: { gluten: 'contains' }, calories: 5 },
        { name: 'Brownie', item_type: 'food', dietary: ['milk'], allergen_levels: {}, calories: 300 },
      ] },
      { item_type: 'service', items: [{ name: 'Class', dietary: [], calories: null }] },
    ],
  }
  resolveItemTypes(menu)
  const [mug, brownie] = menu.sections[0].items
  assert.equal(mug.item_type, 'goods')
  assert.deepEqual([mug.dietary, mug.allergen_levels, mug.calories], [[], {}, null])
  assert.equal(brownie.item_type, 'food')
  assert.deepEqual([brownie.dietary, brownie.calories], [['milk'], 300])
  assert.equal(menu.sections[1].items[0].item_type, 'service')
  assert.equal(isFoodItem(brownie), true)
  assert.equal(isFoodItem(mug), false)
  assert.equal(resolveItemTypes(null), null)
})
