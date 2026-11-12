// Web search in Pepper's chat (migration 242) against a stand-in Claude
// (support/fake-claude.mjs): the group's switch, the tool and its cap, the
// hidden line that tells the model, the search and its sources in the chat,
// searches counted in the allowance, the stored search sent back as it came,
// what is left out when the tool list changes (web search switched off or
// on, a deploy that changes a tool), Anthropic turning the tool down, and
// the website chat never having it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { startFakeClaude } from './support/fake-claude.mjs'

const claude = await startFakeClaude()
const { as, sql, ok, closeApp } = await import('./support/app.mjs')
const { resetAndSeed, A, B, PLATFORM } = await import('./support/seed.mjs')
const { usageUnits, SEARCH_UNITS } = await import('../src/ai/context.js')
const { forgetWebSearchRefusal, WEB_SEARCH_MAX } = await import('../src/ai/chat.js')
const { searchForJson } = await import('../src/services/aiJson.js')
const { staffInstructions } = await import('../src/ai/prompts.js')

let ids, owner

const text = s => [{ type: 'text', text: s }]
const say = s => () => ({ stop_reason: 'end_turn', content: text(s) })
const thought = (signature, words) => () => ({
  stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '', signature }, { type: 'text', text: words }],
})
const lastReq = () => claude.requests[claude.requests.length - 1].body
const webTool = body => (body.tools || []).find(t => t.name === 'web_search')
const blocks = (body, role) => body.messages.filter(m => !role || m.role === role)
  .flatMap(m => (Array.isArray(m.content) ? m.content : [{ type: 'text', text: m.content }]))
const ofType = (body, type) => blocks(body).filter(b => b.type === type)
const lines = (body, re) => blocks(body, 'user').filter(b => b.type === 'text' && re.test(b.text))
/** The text blocks of the newest message, which must be the person's. */
function lastUserTexts(body) {
  const m = body.messages[body.messages.length - 1]
  assert.equal(m.role, 'user')
  return m.content.filter(b => b.type === 'text').map(b => b.text)
}
const ON = /^\[Web search is on/, OFF = /^\[Web search is off now/
const NO_WEB = 'Web search wasn\'t available for this one, so I answered without it.'
const chat = (body, who = owner) => who.post('/api/ai/chat', body)
const convRow = async id => (await sql`SELECT tools_key, thinking_from_seq FROM ai_conversations WHERE id = ${id}`)[0]
async function usage() {
  const [u] = await sql`SELECT units, web_searches FROM ai_usage WHERE tenant_id = ${ids.a} AND channel = 'staff_chat'`
  return { units: Number(u?.units || 0), searches: Number(u?.web_searches || 0) }
}

function parseSse(body) {
  return body.split('\n\n').filter(Boolean).flatMap(chunk => {
    const data = chunk.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n')
    return data ? [JSON.parse(data)] : []
  })
}
async function streamChat(body) {
  const res = await owner.post('/api/ai/chat', body, { accept: 'text/event-stream' })
  assert.match(String(res.headers['content-type'] || ''), /event-stream/)
  return parseSse(res.body)
}

// One reply that searched: thinking, a line, the search, its results, then
// the answer in pieces, the cited ones carrying their citations.
const cite = (url, title, n) => ({ type: 'web_search_result_location', url, title, encrypted_index: 'IDX-' + n, cited_text: 'cited passage ' + n })
const FSA = 'https://www.food.gov.uk/news-alerts/alert/1'
const RESULT = {
  type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: [
    { type: 'web_search_result', url: FSA, title: 'Sesame recall', encrypted_content: 'ENCRYPTED-ONE', page_age: '2 days ago' },
    { type: 'web_search_result', url: 'https://example.com/b', title: 'Other', encrypted_content: 'ENCRYPTED-TWO', page_age: null },
  ],
}
const SEARCH = { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'sesame recall UK November 2026' } }
const CITED_1 = [cite(FSA, 'Sesame recall', 1)]
// The same page again, another page, and an address that isn't a web page.
const CITED_2 = [cite(FSA, 'Sesame recall', 2), cite('https://example.com/b', 'Other', 3), cite('javascript:alert(1)', 'Not a page', 4)]
const SEARCH_REPLY = [
  { type: 'thinking', thinking: '', signature: 'sig-web-1' },
  { type: 'text', text: 'Let me look that up.' },
  SEARCH,
  RESULT,
  { type: 'text', text: 'There is a recall on ' },
  { type: 'text', text: 'tahini from one supplier', citations: CITED_1 },
  { type: 'text', text: '. ' },
  { type: 'text', text: 'It covers batch 12', citations: CITED_2 },
  { type: 'text', text: '.' },
]
const SOURCES = [{ url: FSA, title: 'Sesame recall' }, { url: 'https://example.com/b', title: 'Other' }]

test.before(async () => {
  ids = await resetAndSeed()
  owner = as(A.owner, ids.a)
  await ok(owner.post('/api/venues', { name: 'Ware', slug: 'ware', timezone: 'Europe/London' }))
})
test.after(async () => { await claude.close(); await closeApp() })

test('off until the group switches it on: no tool, no line for the model, nothing counted', async () => {
  assert.equal((await ok(owner.get('/api/ai/status'))).web_search, false)
  assert.equal((await ok(owner.get('/api/ai/settings'))).settings.web_search, false)
  claude.script.push(say('Hello.'))
  const r = await ok(chat({ message: 'Hi Pepper' }))
  const body = lastReq()
  assert.equal(webTool(body), undefined)
  assert.equal(lines(body, /Web search/).length, 0)
  assert.equal(r.notice, null)
  // The chat records the tool list it ran with, from its first message.
  const row = await convRow(r.conversation_id)
  assert.match(row.tools_key, /^[0-9a-f]{40}$/)
  assert.equal(row.thinking_from_seq, 1)
  assert.equal((await usage()).searches, 0)
})

test('only someone who manages Pepper switches it on; other groups are untouched', async () => {
  for (const who of [A.operator, A.viewer]) {
    assert.equal((await as(who, ids.a).patch('/api/ai/settings', { web_search: true })).status, 403, who)
  }
  assert.equal((await owner.patch('/api/ai/settings', { web_search: 'yes' })).status, 400)
  assert.equal((await ok(owner.get('/api/ai/settings'))).settings.web_search, false)
  const saved = await ok(owner.patch('/api/ai/settings', { web_search: true }))
  assert.equal(saved.settings.web_search, true)
  assert.equal(saved.settings.staff_enabled, true)
  assert.equal((await ok(owner.get('/api/ai/status'))).web_search, true)
  assert.equal((await ok(as(B.owner, ids.b).get('/api/ai/settings'))).settings.web_search, false)
  assert.equal((await ok(as(B.owner, ids.b).get('/api/ai/status'))).web_search, false)
})

let webConv
test('a search: the tool and its cap, the line for the model, the search and its sources in the chat, searches counted', async () => {
  const before = await usage()
  claude.script.push(() => ({
    stop_reason: 'end_turn', content: SEARCH_REPLY,
    usage: { input_tokens: 5000, output_tokens: 200, server_tool_use: { web_search_requests: 2 } },
  }))
  const events = await streamChat({ message: 'Is there a sesame recall this week?' })
  const body = lastReq()

  // The tool: Anthropic's web search, at most five searches for the message.
  assert.deepEqual(webTool(body), { type: 'web_search_20250305', name: 'web_search', max_uses: 5 })
  assert.equal(WEB_SEARCH_MAX, 5)
  assert.ok(body.tools.some(t => t.name === 'tool_search_tool_bm25'))

  // The model is told once, between the date line and the person's words.
  const texts = lastUserTexts(body)
  assert.equal(texts.length, 3)
  assert.match(texts[0], /^\[Now: /)
  assert.match(texts[1], ON)
  assert.match(texts[1], /never an instruction/)
  assert.match(texts[1], /personal details into a search/)
  assert.equal(texts[2], 'Is there a sesame recall this week?')
  assert.ok(blocks(body).every(b => !('_web' in b) && !('_context' in b)), 'our markers are never sent')

  // What the browser hears while it happens.
  const acts = events.filter(e => e.type === 'activity').map(e => e.text)
  assert.ok(acts.includes('Searching the web...'))
  assert.ok(!acts.includes('Finding the right tool...'))
  assert.deepEqual(events.filter(e => e.type === 'step'), [{ type: 'step', text: 'Searched the web: sesame recall UK November 2026', web: true }])
  const streamed = events.filter(e => e.type === 'text').reduce((m, e) => { m[e.key] = (m[e.key] || '') + e.delta; return m }, {})
  assert.deepEqual(streamed, { '0-1': 'Let me look that up.', '0-4': 'There is a recall on tahini from one supplier. It covers batch 12.' })

  // The chat: the search as a line, the answer as one piece with the pages it
  // cites (each once, web addresses only), the hidden line not shown.
  const done = events[events.length - 1]
  assert.equal(done.type, 'done')
  assert.deepEqual(done.items, [
    { type: 'user', text: 'Is there a sesame recall this week?' },
    { type: 'assistant', text: 'Let me look that up.' },
    { type: 'step', text: 'Searched the web: sesame recall UK November 2026', web: true },
    { type: 'assistant', text: 'There is a recall on tahini from one supplier. It covers batch 12.', sources: SOURCES },
  ])
  webConv = done.conversation_id
  assert.deepEqual((await ok(owner.get('/api/ai/conversations/' + webConv))).items, done.items)

  // Counted: two searches, 2,500 units each on top of the tokens.
  const after = await usage()
  assert.equal(after.searches - before.searches, 2)
  assert.equal(after.units - before.units, usageUnits({ input: 5000, output: 200, searches: 2 }, body.model))
  assert.equal(usageUnits({ input: 5000, output: 200, searches: 2 }, body.model) - usageUnits({ input: 5000, output: 200 }, body.model), 5000)
  const info = await ok(owner.get('/api/ai/settings'))
  assert.equal(info.usage.web_searches, 2)
  assert.equal(info.usage.channels.staff_chat.web_searches, 2)
})

test('a search is 2,500 units whichever model answered', () => {
  assert.equal(SEARCH_UNITS, 2500)
  assert.equal(usageUnits({ searches: 1 }), 2500)
  assert.equal(usageUnits({ searches: 4 }, 'claude-haiku-5-5'), 10000)
  assert.equal(usageUnits({}), 0)
})

test('the next message sends the search back exactly as it came, and says nothing new about web search', async () => {
  claude.script.push(say('Anything else?'))
  await ok(chat({ conversation_id: webConv, message: 'Thanks' }))
  const body = lastReq()
  assert.ok(webTool(body))
  assert.equal(lines(body, ON).length, 1)
  assert.equal(lastUserTexts(body).length, 2)
  const reply = body.messages.find(m => m.role === 'assistant').content
  assert.deepEqual(reply.find(b => b.type === 'server_tool_use'), SEARCH)
  assert.deepEqual(reply.find(b => b.type === 'web_search_tool_result'), RESULT)
  assert.deepEqual(reply.filter(b => b.citations).map(b => b.citations), [CITED_1, CITED_2])
  assert.deepEqual(ofType(body, 'thinking').map(b => b.signature), ['sig-web-1'])
})

test('switched off mid-chat: no tool, the searches and citations not sent, earlier thinking left out, the model told', async () => {
  await ok(owner.patch('/api/ai/settings', { web_search: false }))
  const was = await convRow(webConv)
  claude.script.push(thought('sig-off-1', 'I can\'t search the web now.'))
  const r = await ok(chat({ conversation_id: webConv, message: 'Search again please' }))
  const body = lastReq()
  assert.equal(webTool(body), undefined)
  assert.equal(ofType(body, 'server_tool_use').length, 0)
  assert.equal(ofType(body, 'web_search_tool_result').length, 0)
  assert.ok(blocks(body).every(b => !('citations' in b)))
  assert.equal(ofType(body, 'thinking').length, 0)
  // The answer's own words are still there.
  assert.ok(blocks(body, 'assistant').some(b => b.type === 'text' && b.text === 'tahini from one supplier'))
  const texts = lastUserTexts(body)
  assert.match(texts[1], OFF)
  assert.equal(texts[2], 'Search again please')
  // Recorded: the new tool list, and the message thinking is sent from.
  const now = await convRow(webConv)
  assert.notEqual(now.tools_key, was.tools_key)
  const [{ seq }] = await sql`SELECT max(seq) AS seq FROM ai_messages WHERE conversation_id = ${webConv} AND role = 'user'`
  assert.equal(now.thinking_from_seq, seq)
  assert.ok(now.thinking_from_seq > was.thinking_from_seq)
  // Nothing stored changed: the chat still shows the earlier answer's sources.
  assert.deepEqual(r.items.find(i => i.sources).sources, SOURCES)
  const [stored] = await sql`SELECT content FROM ai_messages WHERE conversation_id = ${webConv} AND role = 'assistant' ORDER BY seq LIMIT 1`
  assert.deepEqual(stored.content.find(b => b.type === 'web_search_tool_result'), RESULT)

  // The same tool list on the next message: that turn's thinking goes back,
  // the earlier thinking stays out, and nothing more is said or recorded.
  claude.script.push(say('OK.'))
  await ok(chat({ conversation_id: webConv, message: 'Fine' }))
  const next = lastReq()
  assert.deepEqual(ofType(next, 'thinking').map(b => b.signature), ['sig-off-1'])
  assert.equal(lines(next, OFF).length, 1)
  assert.equal(lastUserTexts(next).length, 2)
  assert.deepEqual(await convRow(webConv), now)
})

test('switched on again: the stored searches go back as they came, thinking from before stays out', async () => {
  await ok(owner.patch('/api/ai/settings', { web_search: true }))
  claude.script.push(say('Searching is back.'))
  await ok(chat({ conversation_id: webConv, message: 'And now?' }))
  const body = lastReq()
  assert.ok(webTool(body))
  assert.deepEqual(ofType(body, 'web_search_tool_result'), [RESULT])
  assert.deepEqual(blocks(body).filter(b => b.citations).map(b => b.citations), [CITED_1, CITED_2])
  assert.equal(ofType(body, 'thinking').length, 0)
  assert.match(lastUserTexts(body)[1], ON)
  assert.equal(lines(body, ON).length, 2)
})

let plain
test('a deploy that changes a tool, or a chat from before this was recorded: earlier thinking is left out, once', async () => {
  claude.script.push(thought('sig-a', 'One.'))
  plain = (await ok(chat({ message: 'First' }))).conversation_id
  claude.script.push(thought('sig-b', 'Two.'))
  await ok(chat({ conversation_id: plain, message: 'Second' }))
  assert.deepEqual(ofType(lastReq(), 'thinking').map(b => b.signature), ['sig-a'], 'the same tool list: thinking goes back')

  await sql`UPDATE ai_conversations SET tools_key = 'the-list-before-a-deploy' WHERE id = ${plain}`
  claude.script.push(thought('sig-c', 'Three.'))
  await ok(chat({ conversation_id: plain, message: 'Third' }))
  assert.equal(ofType(lastReq(), 'thinking').length, 0)
  assert.match((await convRow(plain)).tools_key, /^[0-9a-f]{40}$/)
  claude.script.push(say('Four.'))
  await ok(chat({ conversation_id: plain, message: 'Fourth' }))
  assert.deepEqual(ofType(lastReq(), 'thinking').map(b => b.signature), ['sig-c'])

  await sql`UPDATE ai_conversations SET tools_key = NULL, thinking_from_seq = 0 WHERE id = ${plain}`
  claude.script.push(say('Five.'))
  await ok(chat({ conversation_id: plain, message: 'Fifth' }))
  assert.equal(ofType(lastReq(), 'thinking').length, 0)
  assert.ok((await convRow(plain)).thinking_from_seq > 1)
})

test('a message Claude can\'t take: tried once more without the tool, then taken back out, nothing recorded or remembered', async () => {
  await sql`UPDATE ai_conversations SET tools_key = 'stale', thinking_from_seq = 3 WHERE id = ${plain}`
  const n = claude.requests.length
  claude.script.push(() => ({ status: 400, message: 'bad message' }), () => ({ status: 400, message: 'bad message' }))
  const res = await chat({ conversation_id: plain, message: 'Refused by Claude' })
  assert.equal(res.status, 422)
  assert.match(res.json.error, /couldn't take that message \(bad message\)/)
  const [first, second] = claude.requests.slice(n).map(x => x.body)
  assert.equal(claude.requests.length - n, 2)
  assert.ok(webTool(first))
  assert.equal(webTool(second), undefined)
  assert.deepEqual(await convRow(plain), { tools_key: 'stale', thinking_from_seq: 3 })
  const rows = await sql`SELECT content::text AS c FROM ai_messages WHERE conversation_id = ${plain}`
  assert.ok(!rows.some(r => r.c.includes('Refused by Claude')))
  // Not put down to web search: the next message offers the tool again.
  claude.script.push(say('Six.'))
  await ok(chat({ conversation_id: plain, message: 'Sixth' }))
  assert.ok(webTool(lastReq()))
})

test('Anthropic turns the tool down: answered without it, said once, not offered again for a while', async () => {
  forgetWebSearchRefusal()
  const n = claude.requests.length
  claude.script.push(
    () => ({ status: 400, type: 'invalid_request_error', message: 'Web search is not enabled for this organization.' }),
    say('Answered from what I know.'),
  )
  const r = await ok(chat({ message: 'What is the minimum wage now?' }))
  assert.equal(claude.requests.length - n, 2)
  const [first, second] = claude.requests.slice(n).map(x => x.body)
  assert.ok(webTool(first))
  assert.equal(lines(first, ON).length, 1)
  assert.equal(webTool(second), undefined)
  assert.equal(lines(second, /Web search/).length, 0, 'the line is taken back out: the model never read it')
  assert.equal(lastUserTexts(second)[1], 'What is the minimum wage now?')
  assert.equal(r.notice, NO_WEB)
  assert.deepEqual(r.items.filter(i => i.type === 'assistant').map(i => i.text), ['Answered from what I know.'])
  const stored = await sql`SELECT content::text AS c FROM ai_messages WHERE conversation_id = ${r.conversation_id}`
  assert.ok(!stored.some(x => x.c.includes('Web search is on')))

  // Remembered: the next message isn't offered the tool, and nothing is said.
  claude.script.push(say('Still here.'))
  const again = await ok(chat({ conversation_id: r.conversation_id, message: 'OK' }))
  assert.equal(claude.requests.length - n, 3)
  assert.equal(webTool(lastReq()), undefined)
  assert.equal(again.notice, null)

  // Later: offered again, with its line.
  forgetWebSearchRefusal()
  claude.script.push(say('Searching again.'))
  await ok(chat({ conversation_id: r.conversation_id, message: 'Try now' }))
  assert.ok(webTool(lastReq()))
  assert.match(lastUserTexts(lastReq())[1], ON)

  // Turned down in a chat that was told it is on: the model is told it is
  // off. A refusal that doesn't name web search isn't remembered.
  claude.script.push(() => ({ status: 400, message: 'tools.1: unknown tool type' }), say('Without it.'))
  const off = await ok(chat({ conversation_id: r.conversation_id, message: 'And again' }))
  assert.equal(webTool(lastReq()), undefined)
  assert.match(lastUserTexts(lastReq())[1], OFF)
  assert.equal(off.notice, NO_WEB)
  claude.script.push(say('With it.'))
  await ok(chat({ conversation_id: r.conversation_id, message: 'Once more' }))
  assert.ok(webTool(lastReq()))
  assert.match(lastUserTexts(lastReq())[1], ON)
})

test('a search that didn\'t run says why; one whose results never came isn\'t shown', async () => {
  claude.script.push(() => ({ stop_reason: 'end_turn', content: [
    { type: 'server_tool_use', id: 'srvtoolu_9', name: 'web_search', input: { query: 'sixth search' } },
    { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_9', content: { type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' } },
    { type: 'server_tool_use', id: 'srvtoolu_10', name: 'web_search', input: { query: 'never ran' } },
    { type: 'text', text: 'That is all I could find.' },
  ] }))
  const r = await ok(chat({ message: 'Search a lot' }))
  assert.deepEqual(r.items.filter(i => i.type === 'step'), [
    { type: 'step', text: 'A web search didn\'t run: the limit of 5 searches for one message was reached (sixth search)', web: true },
  ])
  assert.deepEqual(r.items.filter(i => i.type === 'assistant'), [{ type: 'assistant', text: 'That is all I could find.' }])
})

test('a turn paused mid-search carries on: the search shows once its results come', async () => {
  const PAGE = 'https://ware.example/carnival'
  claude.script.push(
    () => ({ stop_reason: 'pause_turn', content: [
      { type: 'text', text: 'Searching.' },
      { type: 'server_tool_use', id: 'srvtoolu_20', name: 'web_search', input: { query: 'ware carnival 2026' } },
    ] }),
    () => ({ stop_reason: 'end_turn', content: [
      { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_20', content: [{ type: 'web_search_result', url: PAGE, title: 'Ware Carnival', encrypted_content: 'ENCRYPTED-3', page_age: null }] },
      { type: 'text', text: 'It is on 4 July.', citations: [cite(PAGE, 'Ware Carnival', 9)] },
    ] }),
  )
  const events = await streamChat({ message: 'When is the carnival?' })
  const second = lastReq()
  const tail = second.messages[second.messages.length - 1]
  assert.equal(tail.role, 'assistant', 'the paused reply goes back as it is')
  assert.equal(tail.content[tail.content.length - 1].id, 'srvtoolu_20')
  const line = { type: 'step', text: 'Searched the web: ware carnival 2026', web: true }
  assert.deepEqual(events.filter(e => e.type === 'step'), [line])
  assert.deepEqual(events[events.length - 1].items.slice(1), [
    { type: 'assistant', text: 'Searching.' },
    line,
    { type: 'assistant', text: 'It is on 4 July.', sources: [{ url: PAGE, title: 'Ware Carnival' }] },
  ])
})

test('the website chat never searches the web', async () => {
  await ok(owner.patch('/api/ai/settings', { guest_chat_enabled: true }))
  claude.script.push(say('Open from noon.'))
  const res = await as(null, null).post('/ai-api/chat', { tenant_id: ids.a, message: 'Is there a market on Saturday?' })
  assert.equal(res.status, 200)
  const body = lastReq()
  assert.equal(webTool(body), undefined)
  assert.equal(lines(body, /Web search/).length, 0)
  assert.ok(body.tools.length > 0)
})

test('the local info captures\' searches count too', async () => {
  const before = await usage()
  claude.script.push(() => ({
    stop_reason: 'end_turn', content: text('{"items":[]}'),
    usage: { input_tokens: 100, output_tokens: 10, server_tool_use: { web_search_requests: 3 } },
  }))
  const out = await searchForJson({ tenantId: ids.a, system: 'Find events.', schema: { type: 'object' }, prompt: 'Events in Ware this week' })
  assert.deepEqual(out, { items: [] })
  const after = await usage()
  assert.equal(after.searches - before.searches, 3)
  assert.equal(after.units - before.units, usageUnits({ input: 100, output: 10, searches: 3 }, lastReq().model))
})

test('the Platform page\'s list says which groups have web search on and how many searches each made', async () => {
  const { tenants } = await ok(as(PLATFORM, null).get('/api/ai/platform/tenants'))
  const a = tenants.find(t => t.id === ids.a), b = tenants.find(t => t.id === ids.b)
  assert.equal(a.web_search, true)
  assert.equal(a.web_searches, (await usage()).searches)
  assert.ok(a.web_searches >= 5)
  assert.equal(b.web_search, false)
  assert.equal(b.web_searches, 0)
  assert.equal((await owner.get('/api/ai/platform/tenants')).status, 403)
})

test('with Pepper switched off for the group, web search counts as off too', async () => {
  await ok(owner.patch('/api/ai/settings', { staff_enabled: false }))
  const info = await ok(owner.get('/api/ai/settings'))
  assert.equal(info.settings.web_search, true, 'the switch keeps its place')
  assert.equal((await ok(owner.get('/api/ai/status'))).web_search, false)
  await ok(owner.patch('/api/ai/settings', { staff_enabled: true }))
  assert.equal((await ok(owner.get('/api/ai/status'))).web_search, true)
})

test('new chats\' instructions explain the web search line; the connector\'s don\'t mention it', () => {
  assert.match(staffInstructions({ tenant: 'Thai House', chat: true }), /Web search: a message may also carry a bracketed line/)
  assert.doesNotMatch(staffInstructions({ tenant: 'Thai House', chat: false }), /Web search/)
})
