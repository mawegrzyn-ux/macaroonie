// withDraftTags(): a live menu with only its dishes' allergens and dietary
// tags taken from the draft (allergen-only publishing).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withDraftTags, contentKey } from '../menuDiff.js'

const live = {
  id: 'm1', name: 'Lunch',
  sections: [{
    id: 's1', title: 'Mains',
    items: [
      { id: 'a', name: 'Pad Thai', price_pence: 1000, dietary: ['gl'], allergen_levels: {} },
      { id: 'b', name: 'Green Curry', price_pence: 1100, dietary: ['mi', 'se'], allergen_levels: { se: 'removable' } },
      { id: 'c', name: 'Old dish', price_pence: 500, dietary: ['mi'], allergen_levels: {} },
    ],
  }],
  callouts: [],
}
const draft = {
  id: 'm1', name: 'Lunch (new)',
  sections: [
    {
      id: 's1', title: 'Mains (renamed)',
      items: [
        { id: 'a', name: 'Pad Thai', price_pence: 1250, dietary: ['mi', 'gl'], allergen_levels: { gl: 'may_contain' } },
        // same tags in another order: not a change
        { id: 'b', name: 'Green Curry (hot)', price_pence: 1100, dietary: ['se', 'mi'], allergen_levels: { se: 'removable' } },
        { id: 'n', name: 'New dish', price_pence: 700, dietary: ['se'], allergen_levels: {} },
      ],
    },
    { id: 's2', title: 'New section', items: [] },
  ],
  callouts: [{ kind: 'custom', title: 'New note', body: '' }],
}

test('only dish tags come from the draft', () => {
  const { content, dishes } = withDraftTags(live, draft)
  assert.deepEqual(dishes, [{ id: 'a', name: 'Pad Thai' }])
  const [a, b, c] = content.sections[0].items
  assert.deepEqual(a.dietary, ['mi', 'gl'])
  assert.deepEqual(a.allergen_levels, { gl: 'may_contain' })
  assert.equal(a.price_pence, 1000, 'price stays live')
  assert.equal(b.name, 'Green Curry', 'name stays live')
  assert.equal(c.name, 'Old dish', 'a dish only live stays, with its tags')
  assert.deepEqual(c.dietary, ['mi'])
  assert.equal(content.name, 'Lunch')
  assert.equal(content.sections.length, 1, 'no new section')
  assert.equal(content.sections[0].title, 'Mains')
  assert.equal(content.sections[0].items.length, 3, 'no new dish')
  assert.deepEqual(content.callouts, [])
  // Live itself isn't changed.
  assert.deepEqual(live.sections[0].items[0].dietary, ['gl'])
})

test('tags taken off, levels changed, and nothing changed', () => {
  const off = { sections: [{ items: [{ id: 'b', dietary: [], allergen_levels: {} }] }] }
  const r = withDraftTags(live, off)
  assert.deepEqual(r.dishes.map(d => d.id), ['b'])
  assert.deepEqual(r.content.sections[0].items[1].dietary, [])
  assert.deepEqual(r.content.sections[0].items[1].allergen_levels, {})

  const level = { sections: [{ items: [{ id: 'b', dietary: ['mi', 'se'], allergen_levels: { se: 'may_contain' } }] }] }
  assert.deepEqual(withDraftTags(live, level).dishes.map(d => d.id), ['b'])

  const none = withDraftTags(live, { sections: [] })
  assert.deepEqual(none.dishes, [])
  assert.equal(contentKey(none.content), contentKey(live))
  // A dish whose live copy has no tag fields counts the same as empty.
  const bare = { sections: [{ items: [{ id: 'x', name: 'X' }] }] }
  assert.deepEqual(withDraftTags(bare, { sections: [{ items: [{ id: 'x', dietary: [], allergen_levels: {} }] }] }).dishes, [])
})
