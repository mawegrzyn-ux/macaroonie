// Kitchen screen colours (shared/pos/kitchenColours.js): what is saved, the
// colours a ticket is drawn with, and dish names by menu section.
// Run: node --test shared/pos/test/

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  KITCHEN_COLOURS, KITCHEN_COLOUR_KEYS, KITCHEN_COLOUR_GROUPS, SECTION_COLOURS_MAX,
  normaliseKitchenColours, ticketColours, sectionColour, sectionColoursById, sectionKey, inkOn,
} from '../kitchenColours.js'

test('kitchen colours: every state has a standard look and a group', () => {
  assert.deepEqual(KITCHEN_COLOUR_KEYS, ['todo', 'ticked', 'upcoming', 'held', 'voided', 'head', 'head_new', 'head_rush', 'head_prepared', 'head_checked', 'timer_warn', 'timer_late'])
  const groups = new Set(KITCHEN_COLOUR_GROUPS.map(g => g.key))
  for (const c of KITCHEN_COLOURS) {
    assert.match(c.bg, /^#[0-9a-f]{6}$/, c.key)
    assert.match(c.ink, /^#[0-9a-f]{6}$/, c.key)
    assert.ok(groups.has(c.group), c.key)
    assert.ok(c.label, c.key)
  }
})

test('kitchen colours: what is saved is cleaned', () => {
  assert.deepEqual(normaliseKitchenColours(null), { states: {}, sections: [] })
  const n = normaliseKitchenColours({
    states: { todo: '#ABCDEF', ticked: 'red', nope: '#000000', head_rush: '#123456' },
    sections: [
      { name: '  Sides ', colour: '#FFCC00' },
      { name: 'sides', colour: '#000000' },
      { name: 'Drinks  menu', colour: '#00aaff' },
      { name: '', colour: '#ffffff' },
      { name: 'Burgers', colour: 'yellow' },
    ],
  })
  assert.deepEqual(n.states, { todo: '#abcdef', head_rush: '#123456' })
  assert.deepEqual(n.sections, [{ name: 'Sides', colour: '#ffcc00' }, { name: 'Drinks menu', colour: '#00aaff' }])
  const many = normaliseKitchenColours({ sections: Array.from({ length: SECTION_COLOURS_MAX + 20 }, (_, i) => ({ name: 'S' + i, colour: '#111111' })) })
  assert.equal(many.sections.length, SECTION_COLOURS_MAX)
})

test('kitchen colours: a set colour gets readable words; not set keeps the standard look', () => {
  const std = ticketColours(null)
  assert.deepEqual(std.todo, { bg: '#0e6b33', ink: '#ffffff', dim: 1, set: false })
  assert.deepEqual(std.held, { bg: '#27272a', ink: '#a1a1aa', dim: 1, set: false })
  assert.equal(std.ticked.dim, 0.55)
  const c = ticketColours({ states: { ticked: '#FFFF00', head: '#111111', held: '#ffffff' } })
  assert.deepEqual(c.ticked, { bg: '#ffff00', ink: '#000000', dim: 0.55, set: true })
  assert.deepEqual(c.head, { bg: '#111111', ink: '#ffffff', dim: 1, set: true })
  assert.equal(c.held.ink, '#000000')
  assert.equal(c.held.dim, 0.65, 'a held row with its own colour reads quieter')
  assert.equal(inkOn('#fbbf24'), '#000000')
  assert.equal(inkOn('#2563eb'), '#ffffff')
  assert.equal(inkOn('nope'), '#ffffff')
})

test('kitchen colours: dish names by section, matched by name in every menu', () => {
  const sections = [
    { id: 'a', title: 'Sides' }, { id: 'b', title: ' sides ' }, { id: 'c', title: 'Drinks' }, { id: 'd', title: 'Mains' },
  ]
  const byId = sectionColoursById({ sections: [{ name: 'SIDES', colour: '#ffcc00' }, { name: 'Drinks', colour: '#00aaff' }] }, sections)
  assert.deepEqual(byId, { a: '#ffcc00', b: '#ffcc00', c: '#00aaff' })
  assert.deepEqual(sectionColoursById({}, sections), {})
  const colours = { states: {}, sections: byId }
  assert.equal(sectionColour(colours, 'b'), '#ffcc00')
  assert.equal(sectionColour(colours, 'd'), null)
  assert.equal(sectionColour(colours, null), null)
  assert.equal(sectionKey('  Hot   Drinks '), 'hot drinks')
})
