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

test('barcodes: GTIN-8, 12, 13 and 14 with a right check digit', async () => {
  const { barcodeProblem } = await import('../catalogue.js')
  for (const ok of ['5000112637922', '96385074', '036000291452', '10012345678902', '', null]) assert.equal(barcodeProblem(ok), null, String(ok))
  assert.match(barcodeProblem('5000112637923'), /check digit/)
  assert.match(barcodeProblem('12345'), /8, 12, 13 or 14/)
  assert.match(barcodeProblem('50001126379AB'), /digits only/)
})

test('codes are unique in a menu; a scan finds the item, or the item with its option', async () => {
  const { codeProblems, codeIndex, findByCode } = await import('../catalogue.js')
  const SIZE = 'g1', S = 'o-s', L = 'o-l'
  const shirt = {
    id: 'i1', name: 'T-shirt', sku: 'TEE', barcode: '5000112637922',
    variant_groups: [{ group_id: SIZE, options: [{ option_id: S, label: 'Small' }, { option_id: L, label: 'Large' }] }],
    option_codes: [{ option_id: L, sku: 'TEE-L', barcode: '96385074' }],
  }
  const mug = { id: 'i2', name: 'Mug', sku: 'tee' }   // the same product code, another case
  assert.deepEqual(codeProblems({ sections: [{ items: [shirt] }] }), [])
  assert.match(codeProblems({ sections: [{ items: [shirt, mug] }] })[0], /product code tee is on T-shirt and Mug/i)
  assert.match(codeProblems({ sections: [{ items: [{ ...mug, sku: null, barcode: '96385074' }, shirt] }] })[0], /barcode 96385074/)
  const index = codeIndex([shirt])
  assert.deepEqual(findByCode(index, '5000112637922'), { item_id: 'i1', option_id: null, group_id: null })
  assert.deepEqual(findByCode(index, '96385074'), { item_id: 'i1', option_id: L, group_id: SIZE })
  assert.deepEqual(findByCode(index, 'tee-l'), { item_id: 'i1', option_id: L, group_id: SIZE })
  assert.equal(findByCode(index, '0000'), null)
})

test('words: Menu or Catalogue, the group\'s word, and the main menu renamed only where standard', async () => {
  const { menuWord, groupWord, renameMenusLinks } = await import('../catalogue.js')
  assert.deepEqual(['food', 'goods', 'service', null].map(menuWord), ['Menu', 'Catalogue', 'Catalogue', 'Menu'])
  assert.equal(groupWord([]), 'Menus')
  assert.equal(groupWord(['food', null]), 'Menus')
  assert.equal(groupWord(['goods', 'service']), 'Catalogues')
  assert.equal(groupWord(['food', 'goods']), 'Menus & catalogues')
  assert.equal(groupWord(['food'], 'catalogues'), 'Catalogues')
  assert.equal(groupWord(['goods'], 'nonsense'), 'Catalogues')
  const tree = [
    { kind: 'section', label: 'Menus', children: [{ kind: 'link', label: 'Menus', route: '/menus' }, { kind: 'link', label: 'Tax', route: '/menus/tax' }] },
    { kind: 'link', label: 'Our dishes', route: '/menus' },
  ]
  const out = renameMenusLinks(tree, 'Catalogues')
  assert.deepEqual([out[0].label, out[0].children[0].label, out[0].children[1].label, out[1].label], ['Catalogues', 'Catalogues', 'Tax', 'Our dishes'])
  assert.equal(renameMenusLinks(tree, 'Menus'), tree)
})
