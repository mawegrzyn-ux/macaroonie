// The object registry joined with what the API knows (Pepper-first step 8A1):
// every record names tools, report subjects and tables that exist; every
// change tool Pepper has belongs to an object; every report subject belongs
// to an object or is listed as none with a reason. And what_can_i_do: what
// can be done with a thing and what this person may do, from the registry and
// their permissions, with a tool's preconditions as the "why not".
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const { getApp, closeApp } = await import('./support/app.mjs')
const { resetAndSeed, A } = await import('./support/seed.mjs')
const { makeContext } = await import('../src/ai/context.js')
const { audienceTools, parseInput } = await import('../src/ai/tools/index.js')
const { registryKnown, objectActions } = await import('../src/ai/registry.js')
const { registryProblems, OBJECTS, OBJECT_LIST } = await import('../../shared/registry/index.js')

let ids
const quiet = { info() {}, warn() {}, error() {}, debug() {} }
async function ask(sub, input, channel = 'staff_chat') {
  const app = await getApp()
  const ctx = makeContext({
    app, channel, tenantId: ids.a, log: quiet,
    auth: { authorization: 'Bearer test:' + sub }, principal: { sub, email: sub + '@test.local' }, actor: sub + '@test.local',
  })
  const t = audienceTools('staff').find(x => x.name === 'what_can_i_do')
  return t.run(ctx, parseInput(t, input))
}

test.before(async () => { ids = await resetAndSeed() })
test.after(async () => { await closeApp() })

test('the registry against the tools, the report catalogue and its tables', () => {
  assert.deepEqual(registryProblems(registryKnown()), [])
  const known = registryKnown()
  // Every change tool belongs to an object; every subject to one or to a reason.
  const change = [...known.tools].filter(([, t]) => !t.readOnly).map(([n]) => n)
  assert.ok(change.length >= 90, change.length + ' change tools')
  for (const n of change) assert.ok(OBJECT_LIST.some(o => o.actions.includes(n)), n)
})

test('a tool, subject or table that doesn\'t exist fails the check', () => {
  const known = registryKnown()
  const o = OBJECTS['purchasing.suppliers']
  const saved = { actions: o.actions, subjects: o.subjects, table: o.table }
  try {
    Object.assign(o, { actions: [...o.actions, 'add_unicorn'], subjects: [...o.subjects, 'purchasing.unicorns'], table: 'unicorns' })
    const p = registryProblems(known).join('\n')
    assert.match(p, /names the tool add_unicorn, which Pepper doesn't have/)
    assert.match(p, /names the subject purchasing\.unicorns/)
    assert.match(p, /its table unicorns has no decision/)
    // A change tool taken out of every record belongs to no object.
    Object.assign(o, { ...saved, actions: o.actions.filter(a => a !== 'add_supplier') })
    assert.match(registryProblems(known).join('\n'), /The change tool add_supplier belongs to no object/)
    o.subjects = []
    assert.match(registryProblems(known).join('\n'), /The report subject purchasing\.suppliers belongs to no object/)
  } finally { Object.assign(o, saved) }
  assert.deepEqual(registryProblems(known), [])
})

test('an action\'s class, preconditions and undo come from the tool, never the record', () => {
  const tools = new Map(audienceTools('staff').map(t => [t.name, t]))
  for (const o of OBJECT_LIST) {
    for (const a of objectActions(o)) {
      const t = tools.get(a.name)
      assert.equal(a.class, t.class, a.name)
      assert.deepEqual(a.preconditions, t.preconditions || [], a.name)
      assert.equal(a.undo, typeof t.inverse === 'function', a.name)
    }
  }
  for (const [area, list] of Object.entries({ x: OBJECT_LIST })) {
    for (const o of list) for (const k of ['class', 'preconditions', 'inverse']) assert.ok(!(k in o), area + ' ' + o.key + ' copies ' + k)
  }
  // The tool file loads the registry only when it runs (it reads every tool).
  const src = fs.readFileSync(new URL('../src/ai/tools/general.js', import.meta.url), 'utf8')
  assert.ok(!/^import .*registry\.js'/m.test(src.replace(/shared\/registry\/index\.js/g, '')), 'general.js imports ../registry.js at load time')
  assert.equal(audienceTools('staff').find(t => t.name === 'what_can_i_do').class, 'read')
})

test('what_can_i_do: the owner can add and change suppliers, with each card\'s kind', async () => {
  const out = await ask(A.owner, { object: 'suppliers' })
  assert.equal(out.object, 'Supplier')
  assert.match(out.link, /^\[.+\]\(\/suppliers\)$/)
  assert.deepEqual(out.you_can.map(a => a.tool).sort(), ['add_supplier', 'update_supplier'])
  assert.ok(out.you_can.every(a => /card/.test(a.card)))
  assert.equal(out.you_cant, undefined)
})

test('what_can_i_do: a viewer is told which permission each change needs', async () => {
  const out = await ask(A.viewer, { object: 'a supplier' })
  assert.equal(out.you_can, undefined)
  assert.ok(out.you_cant.length >= 2)
  for (const a of out.you_cant) assert.match(a.why_not, /^Needs Manage on .+ \(this person has .+\)\. An owner or admin/)
})

test('what_can_i_do: a precondition is the "why not" of a change the person may make', async () => {
  const out = await ask(A.owner, { object: 'the cash-up', action: 'submit' })
  const submit = out.you_can.find(a => a.tool === 'submit_cash_day')
  assert.ok(submit, JSON.stringify(out))
  assert.ok(submit.before_it_runs.length >= 1, 'submit_cash_day declares its checks')
  assert.ok(!out.you_can.some(a => a.tool === 'record_cash_day'), 'only the change asked about')
  // An undo where the tool has an inverse, the form that edits it.
  const sold = await ask(A.owner, { object: 'sold out dishes' })
  assert.match(sold.you_can.find(a => a.tool === 'set_sold_out').undo, /undone/)
  assert.deepEqual(sold.forms.map(f => f.form), ['sold_out'])
})

test('what_can_i_do: a change Pepper has no tool for, a thing it doesn\'t know, the address on the connector', async () => {
  const del = await ask(A.owner, { object: 'booking', action: 'delete' })
  assert.match(del.note, /can't "delete" bookings/)
  assert.equal(del.you_can, undefined)
  const anon = await ask(A.owner, { object: 'customers', action: 'erase' })
  assert.deepEqual(anon.you_can.map(a => a.tool), ['anonymise_customer'])
  assert.match(anon.you_can[0].card, /typed word/)
  const tables = await ask(A.owner, { object: 'tables' })
  assert.match(tables.note, /no tool that changes tables/)
  await assert.rejects(ask(A.owner, { object: 'unicorns' }), /Nothing in the app called "unicorns"/)
  // Over the staff connector the page is a full address.
  const mcp = await ask(A.owner, { object: 'suppliers' }, 'staff_mcp')
  assert.match(mcp.url, /^https?:\/\/.+\/suppliers$/)
})
