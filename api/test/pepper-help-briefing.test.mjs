// Pepper's help answers (how_do_i), the day briefing (day_briefing) and
// "ask about this page" (the drawer's page note), through the chat loop
// against a stand-in Claude (support/fake-claude.mjs).
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { startFakeClaude } from './support/fake-claude.mjs'

const claude = await startFakeClaude()
const { as, sql, ok, closeApp } = await import('./support/app.mjs')
const { resetAndSeed, A, B } = await import('./support/seed.mjs')
const { searchHelp, helpPassages } = await import('../src/ai/helpIndex.js')
const { helpSlug } = await import('../../shared/help.js')
const { longDate, localParts } = await import('../src/ai/tools/util.js')
// The app's first hidden line on every staff message (contextNote() in ai/chat.js).
const NOW_LINE = /^\[Now: [A-Z][a-z]+day,? \d{1,2} [A-Z][a-z]+ \d{4} \(\d{4}-\d{2}-\d{2}\), \d{2}:\d{2}\.\]$/

const text = s => [{ type: 'text', text: s }]
let ids, owner, venue, venueB

/** One chat turn in which the model calls `tool` with `input`; returns the tool's result. */
async function callTool(tool, input, { sub = A.owner, tenant = ids.a } = {}) {
  const before = claude.requests.length
  claude.script.push(
    () => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_' + tool, name: tool, input }] }),
    () => ({ stop_reason: 'end_turn', content: text('Done.') }),
  )
  const res = await as(sub, tenant).post('/api/ai/chat', { message: 'Use ' + tool })
  assert.equal(res.status, 200, res.body)
  const second = claude.requests[before + 1].body.messages
  const last = second[second.length - 1]
  const block = last.content.find(b => b.type === 'tool_result')
  return { result: block, json: block.is_error ? null : JSON.parse(block.content[0].text), reply: res.json }
}

test.before(async () => {
  ids = await resetAndSeed()
  owner = as(A.owner, ids.a)
  venue = await ok(owner.post('/api/venues', { name: 'Ware', slug: 'ware', timezone: 'Europe/London' }))
  venueB = await ok(as(B.owner, ids.b).post('/api/venues', { name: 'Elsewhere', slug: 'elsewhere', timezone: 'Europe/London' }))
})
test.after(async () => { await claude.close(); await closeApp() })

// ── Help answers ────────────────────────────────────────

test('the Help index: every section and subsection, links that exist on the page', () => {
  const src = fs.readFileSync(new URL('../../admin/src/pages/Help.jsx', import.meta.url), 'utf8')
  const passages = helpPassages()
  assert.ok(passages.length > 100, 'passages: ' + passages.length)
  const sectionIds = new Set([...src.matchAll(/<section id="([^"]+)" data-help="">/g)].map(m => m[1]))
  // The page gives an H3 an id only when its heading is plain text, so a
  // heading with markup inside would leave the link going nowhere.
  const h3 = [...src.matchAll(/<H3[^>]*>([\s\S]*?)<\/H3>/g)].map(m => m[1])
  assert.deepEqual(h3.filter(h => /[{<]/.test(h)), [], 'H3 headings must be plain text')
  for (const p of passages) {
    const anchor = p.link.slice('/help#'.length)
    assert.ok(sectionIds.has(anchor) || anchor === p.slug, p.link)
    // Help text may quote markup (<a href="#book-now">), never JSX itself.
    assert.ok(!/<\/?[A-Z]|className=|\{\/\*|\{'/.test(p.text), 'markup left in ' + p.heading)
  }
  assert.equal(helpSlug('Setting it up (H&S settings)'), 'setting-it-up-h-and-s-settings')
})

test('searchHelp finds the passage that answers the question', () => {
  assert.equal(searchHelp('How do I set up tip pots?')[0].link, '/help#tip-pots')
  assert.equal(searchHelp('what does variance mean?')[0].link, '/help#how-the-variance-works')
  assert.match(searchHelp('where do I add a fridge?')[0].heading, /H&S settings/)
  assert.deepEqual(searchHelp('xyzzy plugh'), [])
  // Long passages are cut at a word.
  for (const a of searchHelp('rota tips points pots shares', { limit: 5, maxChars: 200 })) assert.ok(a.text.length <= 202)
})

test('how_do_i in the chat: answers with in-app links', async () => {
  const { json } = await callTool('how_do_i', { question: 'How do I set up tip pots?' })
  assert.ok(json.answers.length >= 1 && json.answers.length <= 3)
  assert.equal(json.answers[0].heading, 'Tip pots')
  assert.equal(json.answers[0].link, '[Help: Tip pots](/help#tip-pots)')
  assert.match(json.answers[0].text, /pot/i)
  const none = await callTool('how_do_i', { question: 'xyzzy plugh frobnicate' })
  assert.deepEqual(none.json.answers, [])
  assert.match(none.json.note, /Nothing in the Help guide/)
})

test('how_do_i is loaded in every staff chat request, with day_briefing', () => {
  const tools = claude.requests[claude.requests.length - 1].body.tools
  for (const name of ['how_do_i', 'day_briefing']) {
    const t = tools.find(x => x.name === name)
    assert.ok(t, name)
    assert.equal(t.defer_loading, undefined, name + ' is a core tool')
  }
})

// ── Day briefing ────────────────────────────────────────

test('day_briefing for an owner: every part, for the venue\'s day', async () => {
  const { json } = await callTool('day_briefing', { venue: 'Ware', date: '2026-10-19' })
  assert.equal(json.venue, 'Ware')
  assert.equal(json.date, '2026-10-19')
  assert.equal(json.day, longDate('2026-10-19'))
  for (const part of ['bookings', 'staff', 'health_and_safety', 'deliveries_due', 'orders_to_approve', 'yesterdays_cash_up', 'online_orders', 'sold_out', 'failed_emails', 'screens_offline']) {
    assert.ok(part in json, part + ' missing')
    assert.equal(json[part]?.error, undefined, part + ': ' + json[part]?.error)
  }
  assert.equal(json.not_included, undefined)
  assert.equal(json.bookings.bookings, 0)
  assert.equal(json.yesterdays_cash_up.date, '2026-10-18')
})

test('day_briefing shows a booking and a big party', async () => {
  await ok(owner.post('/api/bookings/admin-override', {
    venue_id: venue.id, starts_at: '2026-10-19T19:00:00', covers: 9, table_ids: [],
    guest_name: 'Big Table', guest_email: 'big@example.test', guest_phone: '07000000000',
  }))
  const { json } = await callTool('day_briefing', { venue: 'Ware', date: '2026-10-19' })
  assert.equal(json.bookings.bookings, 1)
  assert.equal(json.bookings.covers, 9)
  assert.equal(json.bookings.big_parties?.[0]?.guest, 'Big Table')
})

test('day_briefing for an operator leaves out what their role can\'t see, and says so', async () => {
  const { json } = await callTool('day_briefing', { venue: 'Ware', date: '2026-10-19' }, { sub: A.operator })
  assert.ok(json.not_included, JSON.stringify(json))
  assert.ok(json.not_included.parts.includes('failed_emails'), json.not_included.parts.join(','))
  assert.ok(!('failed_emails' in json))
  assert.ok('bookings' in json && 'staff' in json)
})

test('day_briefing refuses a day that doesn\'t exist', async () => {
  const { result } = await callTool('day_briefing', { venue: 'Ware', date: '2026-02-31' })
  assert.equal(result.is_error, true)
  assert.match(result.content[0].text, /real date/i)
})

test('day_briefing never reaches another tenant\'s venue', async () => {
  const { result } = await callTool('day_briefing', { venue: 'Elsewhere' })
  assert.equal(result.is_error, true)
})

// ── Ask about this page ─────────────────────────────────

const lastUser = () => {
  const msgs = claude.requests[claude.requests.length - 1].body.messages
  return msgs[msgs.length - 1]
}
const storedLast = async conversationId => (await sql`
  SELECT content FROM ai_messages WHERE conversation_id = ${conversationId} AND role = 'user' ORDER BY seq DESC LIMIT 1
`)[0].content

test('the page goes to the model as a line before the message, hidden from the chat', async () => {
  claude.script.push(() => ({ stop_reason: 'end_turn', content: text('Jo is on.') }))
  const res = await owner.post('/api/ai/chat', {
    message: 'Who is on this week?', page: { path: '/rota', venue_id: venue.id, week: '2026-10-19' },
  })
  assert.equal(res.status, 200, res.body)
  const sent = lastUser().content
  assert.deepEqual(sent.map(b => b.type), ['text', 'text'])
  const [nowLine, pageLine] = sent[0].text.split('\n')
  assert.match(nowLine, NOW_LINE)
  assert.equal(pageLine, '[Sent from the Rota page (/rota), showing venue Ware (venue_id ' + venue.id +
    '), the week starting ' + longDate('2026-10-19') + ' (2026-10-19).]')
  assert.equal(sent[0]._context, undefined, 'our marker is not sent')
  assert.equal(sent[1].text, 'Who is on this week?')
  const out = res.json
  const stored = await storedLast(out.conversation_id)
  assert.equal(stored[0]._context, true)
  assert.deepEqual(out.items.filter(i => i.type === 'user').map(i => i.text), ['Who is on this week?'])
  const conv = await ok(owner.get('/api/ai/conversations/' + out.conversation_id))
  assert.ok(!conv.items.some(i => /Sent from/.test(i.text || '')))
  assert.equal(conv.title, 'Who is on this week?')
})

test('a day page, a subpage and the longest matching route', async () => {
  claude.script.push(() => ({ stop_reason: 'end_turn', content: text('Ok.') }))
  await ok(owner.post('/api/ai/chat', { message: 'What is missing?', page: { path: '/food-safety', venue_id: venue.id, date: '2026-10-19' } }))
  assert.equal(lastUser().content[0].text.split('\n')[1], '[Sent from the Food safety page (/food-safety), showing venue Ware (venue_id ' + venue.id +
    '), ' + longDate('2026-10-19') + ' (2026-10-19).]')
  claude.script.push(() => ({ stop_reason: 'end_turn', content: text('Ok.') }))
  await ok(owner.post('/api/ai/chat', { message: 'Explain this', page: { path: '/rota/setup' } }))
  assert.equal(lastUser().content[0].text.split('\n')[1], '[Sent from the Rota setup page (/rota/setup).]')
})

test('another tenant\'s venue id is refused; a page with nothing known adds no line', async () => {
  // refuseOtherTenantsVenues (middleware/venue.js) sees venue_id at any depth of the body.
  const before = claude.requests.length
  const res = await owner.post('/api/ai/chat', { message: 'Hi', page: { path: '/rota', venue_id: venueB.id, week: '2026-10-19' } })
  assert.equal(res.status, 404)
  assert.equal(claude.requests.length, before)
  claude.script.push(() => ({ stop_reason: 'end_turn', content: text('Ok.') }))
  await ok(owner.post('/api/ai/chat', { message: 'Hello there', page: { path: '/nowhere-known' } }))
  const texts = lastUser().content.map(b => b.text)
  assert.equal(texts.length, 2)
  assert.match(texts[0], NOW_LINE, 'only the date line, no page line')
  assert.equal(texts[1], 'Hello there')
})

test('pageNote never names another tenant\'s venue', async () => {
  const { pageNote } = await import('../src/ai/chat.js')
  const line = await pageNote(ids.a, { path: '/rota', venue_id: venueB.id, week: '2026-10-19' })
  assert.ok(!line.includes(venueB.id) && !line.includes('Elsewhere'), line)
  assert.equal(line, '[Sent from the Rota page (/rota), showing the week starting ' + longDate('2026-10-19') + ' (2026-10-19).]')
  assert.equal(await pageNote(ids.a, { path: '/nowhere' }), null)
  assert.equal(await pageNote(ids.a, null), null)
})

test('a bad page is refused before anything is stored', async () => {
  const before = claude.requests.length
  for (const page of [{ path: 'rota' }, { path: '/rota?x=1' }, { path: '/rota', date: '19/10/2026' }, { path: '/rota', date: '2026-02-31' }, { path: '/rota', week: '2026-13-01' }, { path: '/rota', venue_id: 'x' }]) {
    const res = await owner.post('/api/ai/chat', { message: 'Hi', page })
    assert.equal(res.status, 400, JSON.stringify(page))
  }
  assert.equal(claude.requests.length, before)
})

test('the page line is only in the staff chat\'s instructions', async () => {
  const system = claude.requests[claude.requests.length - 1].body.system
  const all = (Array.isArray(system) ? system.map(b => b.text).join('\n') : system)
  assert.match(all, /The page they are on/)
})

// ── Today's date ────────────────────────────────────────

test('every staff message starts with the date and time now at the venue, hidden from the chat', async () => {
  const before = localParts(new Date(), 'Europe/London')
  claude.script.push(() => ({ stop_reason: 'end_turn', content: text('Nothing booked.') }))
  const res = await owner.post('/api/ai/chat', { message: 'Anything on today?' })
  assert.equal(res.status, 200, res.body)
  const after = localParts(new Date(), 'Europe/London')
  const sent = lastUser().content
  const expected = p => '[Now: ' + longDate(p.date) + ' (' + p.date + '), ' + p.time + '.]'
  assert.ok([expected(before), expected(after)].includes(sent[0].text), sent[0].text)
  assert.equal(sent[1].text, 'Anything on today?')
  const conv = await ok(owner.get('/api/ai/conversations/' + res.json.conversation_id))
  assert.ok(!conv.items.some(i => /\[Now:/.test(i.text || '')), 'not shown in the chat')
  assert.equal(conv.title, 'Anything on today?')
  const system = claude.requests[claude.requests.length - 1].body.system
  const all = Array.isArray(system) ? system.map(b => b.text).join('\n') : system
  assert.match(all, /never guess a date/)
  assert.ok(!/\[Now: [A-Z]/.test(all), 'the system prompt holds no date (it is cached and replayed)')
})

test('day_overview without a date is today at the venue', async () => {
  const today = localParts(new Date(), 'Europe/London').date
  const { json } = await callTool('day_overview', { venue_id: venue.id })
  assert.equal(json.date, today)
  assert.equal(json.day, longDate(today))
})

test('venues in different time zones each get their own date', async () => {
  const { nowNote } = await import('../src/ai/chat.js')
  // 23:30 UTC on 17 Oct 2026: already Sunday in London (summer time), still Saturday in New York.
  const at = new Date('2026-10-17T23:30:00Z')
  assert.equal(await nowNote(ids.b, at), '[Now: ' + longDate('2026-10-18') + ' (2026-10-18), 00:30.]')
  await ok(as(B.owner, ids.b).post('/api/venues', { name: 'Brooklyn', slug: 'brooklyn', timezone: 'America/New_York' }))
  assert.equal(await nowNote(ids.b, at),
    '[Now: ' + longDate('2026-10-17') + ' (2026-10-17), 19:30 at Brooklyn; ' + longDate('2026-10-18') + ' (2026-10-18), 00:30 at Elsewhere.]')
})
