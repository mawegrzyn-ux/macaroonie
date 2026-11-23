// Pepper's tools are gathered from the files in src/ai/tools (docs/PARALLEL_WORK.md
// 3.8): each tool file exports its tools, its order, its areas and its lines in
// the system prompt, and each tool its activity words. These check the
// gathering: the prompt holds every file's lines in the files' order, the
// order depends only on the files (the prompt is cached), helper files are
// skipped, and the chat's activity lines come from the tools.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const idx = await import('../src/ai/tools/index.js')
const { staffInstructions } = await import('../src/ai/prompts.js')
const { ACTIVITY } = await import('../src/ai/chat.js')

const DIR = new URL('../src/ai/tools/', import.meta.url)
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.js') && f !== 'index.js').sort()
const mods = Object.fromEntries(await Promise.all(files.map(async f => [f, await import(new URL(f, DIR).href)])))
const toolFiles = files.filter(f => mods[f].tools)
  .sort((a, b) => mods[a].order - mods[b].order || (a < b ? -1 : 1))

test('a file is a tool file when it exports tools; helpers and the guest tools are not gathered', () => {
  assert.ok(!mods['util.js'].tools, 'util.js is a helper')
  assert.ok(!mods['guest.js'].tools, 'guest.js has the guest tools (guestTools), not staff ones')
  const staff = idx.audienceTools('staff')
  const gathered = toolFiles.flatMap(f => mods[f].tools.map(t => t.name))
  assert.deepEqual(staff.map(t => t.name), gathered, 'the staff tools, file by file in order')
  for (const f of toolFiles) assert.ok(Number.isFinite(mods[f].order), f + ' has an order')
  const listed = mods['files.js'].FILES.map(([f]) => f)
  for (const f of toolFiles) assert.ok(listed.includes(f), f + ' is missing from src/ai/tools/files.js')
})

test('every staff tool has a known area, and the areas come from the files', () => {
  const fromFiles = Object.assign({}, ...toolFiles.map(f => mods[f].sections || {}))
  assert.deepEqual(Object.keys(idx.SECTIONS).sort(), Object.keys(fromFiles).sort())
  for (const t of idx.audienceTools('staff')) assert.ok(idx.SECTIONS[t.section], t.name + ' has a known section')
  for (const [key, s] of Object.entries(fromFiles)) {
    if (s.open) assert.equal(idx.SECTION_MODULES[key], undefined, key + ' is open to all')
    else assert.deepEqual(idx.SECTION_MODULES[key], s.modules, key + "'s modules")
  }
})

test('the prompt holds every file\'s lines and notes, in the files\' order, the same every time', () => {
  const prompt = staffInstructions({ tenant: 'Thai House', person: 'Sam Lee', chat: true })
  assert.equal(prompt, staffInstructions({ tenant: 'Thai House', person: 'Sam Lee', chat: true }))
  const lines = toolFiles.flatMap(f => mods[f].promptLines || [])
  const notes = toolFiles.flatMap(f => mods[f].promptNotes || [])
  assert.deepEqual(idx.PROMPT_LINES, lines)
  assert.deepEqual(idx.PROMPT_NOTES, notes)
  assert.ok(prompt.includes(lines.map(l => '- ' + l).join('\n')), 'the list, in order')
  assert.ok(prompt.includes(notes.join('\n\n')), 'the notes, in order')
  for (const s of [...lines, ...notes]) assert.ok(!s.includes('\n') && s === s.trim(), 'one line each: ' + s.slice(0, 40))
  // The chat says which tools are loaded at the start.
  assert.ok(prompt.includes('Only a few tools are loaded at the start (' + [...idx.CORE_TOOLS].join(', ') + ').'))
  assert.ok(!staffInstructions({ tenant: 'Thai House' }).includes('Only a few tools are loaded'))
})

test('core tools and activity words come from the tools', () => {
  const staff = idx.audienceTools('staff')
  assert.deepEqual([...idx.CORE_TOOLS], staff.filter(t => t.core).map(t => t.name))
  assert.ok(idx.CORE_TOOLS.has('list_venues') && idx.CORE_TOOLS.has('open_page'))
  for (const t of [...staff, ...idx.audienceTools('guest')]) {
    assert.equal(ACTIVITY.get(t.name), t.activity, t.name + "'s activity")
  }
  assert.equal(ACTIVITY.get('kitchen_report'), 'Looked at kitchen speed')
  assert.equal(ACTIVITY.get('find_restaurants'), 'Searched restaurants')
})

// Pepper-first step 4a: every change tool says what a mistake would cost
// (reports/AI first back office strategy.md, "The Confirm card"), and the
// owner's never-list (docs/PEPPER_FIRST.md 13, decisions 4 and 9) holds:
// pay, tips, prices, allergens, deletions and a person's details are never
// 'reversible', the only class that may ever skip a card.
const DESTRUCTIVE_NAMES = /(^|_)(pay|tips?|wages|delete|remove|anonymise|staff_member|staff_leaving|guest_details)(_|$)|^update_customer$/
const NEVER_REVERSIBLE = /price|refund|customer|allergen|guest|staff|pay|tip|wage|delete|remove|anonymis/

test('every tool has a known class: reads are read, every change tool declares one', () => {
  const staff = idx.audienceTools('staff')
  for (const t of [...staff, ...idx.audienceTools('guest')]) {
    assert.ok(idx.CLASSES.includes(t.class), t.name + ' has a known class: ' + t.class)
    if (t.readOnly) assert.equal(t.class, 'read', t.name + ' only reads')
    else assert.ok(idx.CHANGE_CLASSES.includes(t.class), t.name + ' changes something, so it is reversible, consequential or destructive')
  }
  // Every confirm tool (a Confirm card) is a change tool: 97 of them.
  const confirm = staff.filter(t => t.confirm)
  assert.ok(confirm.length >= 97, 'the change tools: ' + confirm.length)
  assert.ok(confirm.every(t => t.class !== 'read'))
  // The guest chat has no typed word on its cards: nothing destructive there.
  assert.ok(idx.audienceTools('guest').every(t => t.class !== 'destructive'))
})

test('a change tool without a class, or with an unknown one, stops start-up', async () => {
  // The registry's own check, run on a copy of the registry with one tool broken.
  const src = fs.readFileSync(new URL('index.js', DIR), 'utf8')
  assert.match(src, /changes something but has no class/)
  const check = src.match(/function checkClass\(t\) \{[\s\S]*?\n\}\n/)[0]
  const run = new Function('CHANGE_CLASSES', 'EDIT_KINDS', check + '; return checkClass')(idx.CHANGE_CLASSES, idx.EDIT_KINDS)
  assert.throws(() => run({ name: 'x', confirm: true }), /no class/)
  assert.throws(() => run({ name: 'x', confirm: true, class: 'risky' }), /no class/)
  assert.throws(() => run({ name: 'x', readOnly: true, class: 'reversible' }), /only reads/)
  assert.throws(() => run({ name: 'x', confirm: true, class: 'consequential', inverse: () => {} }), /only a reversible tool/)
  assert.equal(run({ name: 'x', readOnly: true }).class, 'read')
  assert.equal(run({ name: 'x', confirm: true, class: 'reversible' }).class, 'reversible')
})

test('the never-list: pay, tips, prices, allergens, deletions and a person\'s details are never reversible', () => {
  const staff = idx.audienceTools('staff').filter(t => !t.readOnly)
  const named = staff.filter(t => DESTRUCTIVE_NAMES.test(t.name))
  assert.ok(named.length >= 15, 'the destructive names found: ' + named.map(t => t.name).join(', '))
  for (const t of named) assert.equal(t.class, 'destructive', t.name + ' is about pay, tips, a deletion or a person')
  for (const t of staff.filter(t => NEVER_REVERSIBLE.test(t.name))) assert.notEqual(t.class, 'reversible', t.name)
  // Every tool MCP marks destructive is destructive here too.
  for (const t of staff.filter(t => t.destructive)) assert.equal(t.class, 'destructive', t.name)
  // A menu change that carries allergen data (even "none") is destructive for
  // that call: a named sign-off (decision 9). Without allergens it isn't.
  const tool = n => idx.audienceTools('staff').find(t => t.name === n)
  assert.equal(idx.classFor(tool('update_dish'), { menu: 'Lunch', dish: 'Pad thai', price: 12 }), 'consequential')
  assert.equal(idx.classFor(tool('update_dish'), { menu: 'Lunch', dish: 'Pad thai', add_allergens: ['Peanuts'] }), 'destructive')
  assert.equal(idx.classFor(tool('update_dish'), { menu: 'Lunch', dish: 'Pad thai', allergens: [] }), 'destructive')
  assert.equal(idx.classFor(tool('add_dishes'), { menu: 'Lunch', sections: [{ section: 'Mains', dishes: [{ name: 'Curry', allergens: ['Milk'] }] }] }), 'destructive')
  assert.equal(idx.classFor(tool('create_menu'), { name: 'Lunch', sections: [{ section: 'Mains', dishes: [{ name: 'Curry', price: 9 }] }] }), 'consequential')
  // A class only ever goes up for a call.
  assert.equal(idx.classFor({ class: 'destructive', escalate: () => 'reversible' }, {}), 'destructive')
  // Only reversible tools can be undone; Undo is never on the never-list.
  for (const name of idx.UNDO_TOOLS) {
    assert.equal(tool(name).class, 'reversible', name)
    assert.ok(!NEVER_REVERSIBLE.test(name), name)
  }
})

test('preconditions and editable fields are declared in plain words, and reach the tool\'s description', () => {
  const staff = idx.audienceTools('staff')
  const withPre = staff.filter(t => t.preconditions)
  assert.ok(withPre.length >= 5, 'some tools say their checks up front')
  for (const t of withPre) {
    for (const p of t.preconditions) {
      assert.match(p, /^[A-Z].*\.$/, t.name + ': a sentence: ' + p)
      assert.ok(!/[{}<>]|_id\b/.test(p), t.name + ': plain words, no ids or code: ' + p)
    }
    assert.ok(idx.toolDescription(t).startsWith(t.description) && idx.toolDescription(t).includes(t.preconditions[0]), t.name)
  }
  for (const t of staff.filter(t => t.editable)) {
    assert.ok(t.confirm, t.name + ' has a card')
    for (const [key, f] of Object.entries(t.editable)) {
      assert.ok(t.input.shape[key], t.name + '.' + key + ' is an input field')
      assert.ok(idx.EDIT_KINDS.includes(f.kind) && f.label, t.name + '.' + key)
    }
  }
  assert.equal(idx.toolDescription({ description: 'Does it.' }), 'Does it.')
})

test('a result\'s undo data never reaches the model or a connector', () => {
  assert.deepEqual(idx.shownResult({ message: 'Done.', _undo: { ids: ['x'] } }), { message: 'Done.' })
  assert.deepEqual(idx.shownResult({ message: 'Done.' }), { message: 'Done.' })
  assert.equal(idx.shownResult(null), null)
})
