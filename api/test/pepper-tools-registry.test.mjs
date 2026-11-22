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
