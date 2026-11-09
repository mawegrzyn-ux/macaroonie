// Pepper's menu search (POST /api/ai/nav-search) against a stand-in Claude:
// the links Pepper is given are exactly the person's own menu (the same
// pruned tree /api/me sends), with each page's search words; refs come back
// as links (unknown refs and repeats dropped, at most five, reasons and the
// note trimmed); the everyday model answers and the usage is counted for
// the person; refusals for a role without Pepper, Pepper switched off, an
// empty or long query, and the tenant isolation of the menu.
import test from 'node:test'
import assert from 'node:assert/strict'
import { startFakeClaude } from './support/fake-claude.mjs'

const claude = await startFakeClaude()
const { as, ok, sql, closeApp } = await import('./support/app.mjs')
const { resetAndSeed, A, B, PLATFORM } = await import('./support/seed.mjs')
const { env } = await import('../src/config/env.js')

let ids
const lastBody = () => claude.requests[claude.requests.length - 1].body
const answer = obj => () => ({
  stop_reason: 'end_turn',
  content: [{ type: 'text', text: JSON.stringify(obj) }],
  usage: { input_tokens: 2400, output_tokens: 90 },
})

/** The link lines Pepper was sent: [{ ref, label, path, covers }]. */
function sentLinks(body) {
  const text = body.messages[0].content.map(b => b.text).join('\n')
  return text.split('\n').filter(l => /^L\d+ \| /.test(l)).map(l => {
    const [ref, label, ...rest] = l.split(' | ')
    const path = (rest.find(r => r.startsWith('in: ')) || '').slice(4)
    const covers = (rest.find(r => r.startsWith('covers: ')) || '').slice(8)
    return { ref, label, path, covers }
  })
}
function meLinks(tree) {
  const out = []
  const walk = list => { for (const n of list || []) { if (n.kind !== 'section' && n.route) out.push(n); walk(n.children) } }
  walk(tree)
  return out.filter((l, i) => out.findIndex(x => x.route === l.route) === i)
}

test.before(async () => { ids = await resetAndSeed() })
test.after(async () => { await claude.close(); await closeApp() })

test('Pepper is given the person\'s own menu and its picks come back as links', async () => {
  const opApi = as(A.operator, ids.a)
  const me = await ok(opApi.get('/api/me'))
  const mine = meLinks(me.nav_tree)
  assert.ok(mine.length > 5, 'the operator has a menu')

  let refOf = null
  claude.script.push(body => {
    const links = sentLinks(body)
    refOf = label => links.find(l => l.label === label)?.ref
    return answer({
      picks: [
        { ref: refOf('Rota'), why: '  Change who is on and   their hours  ' },
        { ref: 'L999', why: 'not a link' },
        { ref: 'X1', why: 'nonsense' },
        { ref: refOf('Rota'), why: 'twice' },
        { ref: refOf('Staff'), why: 'Pay rates are set on each person' },
      ],
      note: 'Open the Rota first. ' + 'x'.repeat(600),
    })()
  })
  const res = await opApi.post('/api/ai/nav-search', { query: '  how do I change staff pay  ' })
  assert.equal(res.status, 200, res.body)
  const body = lastBody()
  assert.equal(body.model, env.AI_MODEL_FAST, 'the everyday model answers')
  assert.equal(body.output_config.format.type, 'json_schema')
  assert.match(body.messages[0].content[1].text, /"how do I change staff pay"/, 'the words as typed (trimmed)')

  const sent = sentLinks(body)
  assert.deepEqual(sent.map(l => l.label).sort(), mine.map(l => l.label).sort(), 'exactly the links /api/me gives the operator')
  const rota = sent.find(l => l.label === 'Rota')
  assert.match(rota.covers, /wages/, 'each page\'s search words ride along')
  assert.ok(rota.path, 'with where it sits in the menu')

  const out = JSON.parse(res.body)
  assert.deepEqual(out.picks.map(p => p.route), ['/rota', '/staff'], 'unknown refs and repeats dropped')
  assert.equal(out.picks[0].why, 'Change who is on and their hours')
  assert.equal(out.picks[0].label, 'Rota')
  assert.ok(out.picks[0].icon)
  assert.ok(out.note.startsWith('Open the Rota first.'))
  assert.ok(out.note.length <= 400, 'the note is cut short')

  const [u] = await sql`SELECT requests, units FROM ai_usage_people WHERE tenant_id = ${ids.a} AND user_sub = ${A.operator}`
  assert.ok(u && u.requests >= 1 && Number(u.units) > 0, 'counted against the person')
})

test('a role sees only its own pages: the owner\'s list is longer and never leaks to the operator', async () => {
  claude.script.push(answer({ picks: [], note: '' }))
  await ok(as(A.owner, ids.a).post('/api/ai/nav-search', { query: 'team members' }))
  const ownerSent = sentLinks(lastBody()).map(l => l.label)
  claude.script.push(answer({ picks: [], note: '' }))
  await ok(as(A.operator, ids.a).post('/api/ai/nav-search', { query: 'team members' }))
  const opSent = sentLinks(lastBody()).map(l => l.label)
  assert.ok(ownerSent.length > opSent.length, 'the owner can open more pages')
  const onlyOwner = ownerSent.filter(l => !opSent.includes(l))
  assert.ok(onlyOwner.length, 'some pages only the owner sees')

  // A pick of a page the operator can't open can't happen: the refs are
  // the operator's own list, so the owner's extra pages have no ref.
  claude.script.push(body => answer({ picks: [{ ref: 'L' + (sentLinks(body).length + 1), why: '' }], note: 'n' })())
  const out = await ok(as(A.operator, ids.a).post('/api/ai/nav-search', { query: 'team' }))
  assert.deepEqual(out.picks, [])
})

test('no picks: the note comes back on its own; at most five picks', async () => {
  claude.script.push(body => answer({ picks: sentLinks(body).slice(0, 9).map(l => ({ ref: l.ref, why: 'x' })), note: 'Several fit.' })())
  const many = await ok(as(A.owner, ids.a).post('/api/ai/nav-search', { query: 'everything' }))
  assert.equal(many.picks.length, 5)

  claude.script.push(answer({ picks: [], note: 'None of your pages books a taxi. Ask Pepper in the chat.' }))
  const none = await ok(as(A.owner, ids.a).post('/api/ai/nav-search', { query: 'book a taxi' }))
  assert.deepEqual(none.picks, [])
  assert.match(none.note, /taxi/)
})

test('platform admins also get the platform pages', async () => {
  claude.script.push(body => answer({ picks: [{ ref: sentLinks(body).find(l => l.label === 'Backlog')?.ref || 'L0', why: 'Dev work' }], note: '' })())
  const out = await ok(as(PLATFORM, ids.a).post('/api/ai/nav-search', { query: 'dev backlog' }))
  assert.deepEqual(out.picks.map(p => p.route), ['/backlog'])
})

test('refusals: no Pepper for the role, Pepper off, bad queries, Claude errors', async () => {
  const before = claude.requests.length
  const viewer = await as(A.viewer, ids.a).post('/api/ai/nav-search', { query: 'rota' })
  assert.equal(viewer.status, 403, 'the viewer role has no Pepper')
  const empty = await as(A.owner, ids.a).post('/api/ai/nav-search', { query: '   ' })
  assert.equal(empty.status, 400)
  const long = await as(A.owner, ids.a).post('/api/ai/nav-search', { query: 'x'.repeat(201) })
  assert.equal(long.status, 400)

  const owner = as(A.owner, ids.a)
  await ok(owner.patch('/api/ai/settings', { staff_enabled: false }))
  try {
    const off = await owner.post('/api/ai/nav-search', { query: 'rota' })
    assert.equal(off.status, 403)
    assert.match(JSON.parse(off.body).error, /switched off/)
  } finally {
    await ok(owner.patch('/api/ai/settings', { staff_enabled: true }))
  }
  assert.equal(claude.requests.length, before, 'nothing reached Claude')

  claude.script.push(() => ({ status: 529, type: 'overloaded_error' }))
  claude.script.push(() => ({ status: 529, type: 'overloaded_error' }))
  claude.script.push(() => ({ status: 529, type: 'overloaded_error' }))
  const busy = await owner.post('/api/ai/nav-search', { query: 'rota' })
  assert.equal(busy.status, 503)
})

test('each group searches its own menu', async () => {
  // Rename a link in tenant B's menu; tenant A's search never sees it.
  await sql`UPDATE nav_items SET label = 'Bees only rota' WHERE tenant_id = ${ids.b} AND route = '/rota'`
  claude.script.push(answer({ picks: [], note: '' }))
  await ok(as(A.owner, ids.a).post('/api/ai/nav-search', { query: 'rota' }))
  assert.ok(!sentLinks(lastBody()).some(l => l.label === 'Bees only rota'))
  claude.script.push(answer({ picks: [], note: '' }))
  await ok(as(B.owner, ids.b).post('/api/ai/nav-search', { query: 'rota' }))
  assert.ok(sentLinks(lastBody()).some(l => l.label === 'Bees only rota'))
})
