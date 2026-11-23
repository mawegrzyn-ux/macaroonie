// Pepper's open_page: pages found by the menu search's own matcher, only
// pages the person can open, links that open a page at a venue, a day or a
// week and a tab when the page takes them (on the staff connector, against
// the real routes); and in the staff chat, a nav card built from the
// server's own result (Pepper-first step 2c), streamed and kept with the
// conversation. Pepper's separate menu search (POST /api/ai/nav-search) was
// retired with step 2c: the ask bar hands the words to the chat instead.
import test from 'node:test'
import assert from 'node:assert/strict'
import { startFakeClaude } from './support/fake-claude.mjs'

const claude = await startFakeClaude()
const { as, ok, sql, getApp, closeApp } = await import('./support/app.mjs')
const { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } = await import('../src/middleware/auth.js')
const { resetAndSeed, A, B } = await import('./support/seed.mjs')
const { NAV_DESCRIPTIONS } = await import('../../shared/navSearch.js')
const { audienceTools } = await import('../src/ai/tools/index.js')

let ids

test.after(async () => { await claude.close(); await closeApp() })

// ── open_page on the staff connector: the designers' own pages ───────

async function mcp(token, method, params = {}) {
  const app = await getApp()
  const res = await app.inject({
    method: 'POST', url: '/mcp/staff/thai-house',
    headers: {
      'content-type': 'application/json', accept: 'application/json, text/event-stream',
      authorization: 'Bearer ' + token, [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET,
    },
    payload: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  let json = null
  try { json = res.json() } catch { json = null }
  return { status: res.statusCode, json, body: res.body }
}
const openPage = async (token, page) => {
  const r = await mcp(token, 'tools/call', { name: 'open_page', arguments: { page } })
  const text = r.json?.result?.content?.[0]?.text || ''
  let out = null
  try { out = JSON.parse(text) } catch { out = null }
  return { error: r.json?.result?.isError === true, text, out }
}

test('open_page finds a designer by its own name and says what the page is for', async () => {
  ids = await resetAndSeed()
  const { token } = await ok(as(A.owner, ids.a).post('/api/ai/tokens', { name: 'Pages' }))

  for (const [asked, route, label] of [
    ['kiosk designer', '/pos/kiosk-designs', 'Kiosk designer'],
    ['the kitchen flow designer page', '/pos/kitchen-flow', 'Kitchen flow designer'],
    ['receipt designer', '/pos/print-designs', 'Receipt & ticket designer'],
    ['screen board designer', '/screens/boards', 'Screen board designer'],
    ['screen playlists', '/screens/playlists', 'Screen playlists'],
    ['screen walls', '/screens/walls', 'Screen walls'],
    ['menu print designer', '/menus/print-designs', 'Menu print designer'],
    ['page builder', '/website/builder', 'Page builder'],
    ['reservations widget', '/website/reservations-widget', 'Reservations widget'],
  ]) {
    const { error, out, text } = await openPage(token, asked)
    assert.equal(error, false, asked + ': ' + text.slice(0, 200))
    assert.equal(out.page, label, asked)
    assert.ok(out.url.endsWith(route), asked + ' -> ' + out.url)
    assert.equal(out.about, NAV_DESCRIPTIONS[route], asked + ' says what the page is for')
  }

  // Two designers print things: both are offered, each with its words.
  const both = (await openPage(token, 'print designer')).out
  assert.deepEqual(both.choices.map(c => c.page).sort(), ['Menu print designer', 'Receipt & ticket designer'])
  assert.ok(both.choices.every(c => c.about && c.about.length <= 260))

  // The page they came out of is still found by its own name.
  assert.ok((await openPage(token, 'kiosks')).out.url.endsWith('/pos/kiosks'))
  assert.ok((await openPage(token, 'website')).out.url.endsWith('/website'))

  // A role that can't open Store tech isn't offered its designers.
  const op = await ok(as(A.operator, ids.a).post('/api/ai/tokens', { name: 'Op' }))
  const refused = await openPage(op.token, 'kiosk designer')
  assert.equal(refused.error, true)
  assert.match(refused.text, /No page called/)
  assert.ok(!/Kiosk designer/.test(refused.text.split('Pages:')[1] || ''), 'and it isn\'t in the list of pages they can open')
})

// ── open_page: links with context, and the menu search's matcher ─────

const openWith = async (token, args) => {
  const r = await mcp(token, 'tools/call', { name: 'open_page', arguments: args })
  const text = r.json?.result?.content?.[0]?.text || ''
  let out = null
  try { out = JSON.parse(text) } catch { out = null }
  return { error: r.json?.result?.isError === true, text, out }
}
const pathOf = url => url.replace(/^https?:\/\/[^/]+/, '')

test('open_page opens a page at a venue, a day or a week, and a tab, when the page takes them', async () => {
  ids = await resetAndSeed()
  const owner = as(A.owner, ids.a)
  const hertford = await ok(owner.post('/api/venues', { name: 'Hertford', slug: 'pages-hertford', timezone: 'Europe/London' }))
  const ware = await ok(owner.post('/api/venues', { name: 'Ware', slug: 'pages-ware', timezone: 'Europe/London' }))
  const bVenue = await ok(as(B.owner, ids.b).post('/api/venues', { name: 'Bees', slug: 'pages-bees', timezone: 'Europe/London' }))
  const { token } = await ok(owner.post('/api/ai/tokens', { name: 'Context' }))

  // "The rota for Ware next week": the week is its Monday, whichever day was given.
  let r = await openWith(token, { page: 'the rota', venue: 'ware', week: '2026-11-25' })
  assert.equal(r.error, false, r.text)
  assert.equal(pathOf(r.out.url), '/rota?venue=' + ware.id + '&week=2026-11-23')
  assert.equal(r.out.opens_at, 'Ware, week of Mon 23 Nov')
  assert.equal(r.out.page, 'Rota')
  assert.equal(r.out.note, undefined)
  // A day for a page that opens at a week: the day's week.
  r = await openWith(token, { page: 'rota', date: '2026-11-29' })
  assert.equal(pathOf(r.out.url), '/rota?week=2026-11-23')

  r = await openWith(token, { page: 'timeline', venue: 'Hertford', date: '2026-12-04' })
  assert.equal(pathOf(r.out.url), '/timeline?venue=' + hertford.id + '&date=2026-12-04')
  r = await openWith(token, { page: 'food safety', venue: 'Ware', date: '2026-12-04', tab: 'Holds' })
  assert.equal(pathOf(r.out.url), '/food-safety?venue=' + ware.id + '&date=2026-12-04&tab=holds')
  r = await openWith(token, { page: 'cash up', venue: 'Hertford', week: '2026-12-09', tab: 'wages' })
  assert.equal(pathOf(r.out.url), '/cash-recon?venue=' + hertford.id + '&week=2026-12-07&tab=wages')
  r = await openWith(token, { page: 'online orders', tab: 'transactions' })
  assert.equal(pathOf(r.out.url), '/orders?tab=transactions')

  // What a page doesn't take is left out, and the answer says so.
  r = await openWith(token, { page: 'menus', venue: 'Ware', date: '2026-12-04' })
  assert.equal(pathOf(r.out.url), '/menus')
  assert.match(r.out.note, /doesn't open at a venue or date/)
  assert.equal(r.out.opens_at, undefined)
  r = await openWith(token, { page: 'orders', tab: 'pay' })
  assert.equal(pathOf(r.out.url), '/orders')
  assert.match(r.out.note, /tab called "pay".*tabs: board, report, transactions/)
  r = await openWith(token, { page: 'bookings', date: '2026-02-30' })
  assert.equal(pathOf(r.out.url), '/bookings', 'a day that doesn\'t exist is left out')

  // A venue that isn't the group's is refused, by name or by another group's id.
  r = await openWith(token, { page: 'rota', venue: 'Leeds' })
  assert.equal(r.error, true)
  assert.match(r.text, /No venue called "Leeds"/)
  r = await openWith(token, { page: 'rota', venue: bVenue.id })
  assert.equal(r.error, true)
  assert.ok(!r.text.includes('venue=' + bVenue.id), 'no link to another group\'s venue')

  // Several pages: each link takes only what its own page accepts.
  r = await openWith(token, { page: 'holiday', venue: 'Ware', week: '2026-11-23' })
  const byPage = Object.fromEntries(r.out.choices.map(c => [c.page, pathOf(c.url)]))
  assert.equal(byPage.Rota, '/rota?venue=' + ware.id + '&week=2026-11-23')
  assert.equal(byPage.Staff, '/staff')
})

test('open_page uses the menu search\'s matcher: every word open_page used to keep of its own still finds its page', async () => {
  const { DEFAULT_NAV_TREE } = await import('../src/config/defaultNav.js')
  const { searchNavTree } = await import('../../shared/navSearch.js')
  const { pagesTree, pickPages } = await import('../src/ai/tools/general.js')
  const tree = pagesTree(DEFAULT_NAV_TREE, () => true)
  const offered = q => pickPages(searchNavTree(tree, q), q).map(p => p.route)
  // The synonyms open_page kept beside its own scorer until 22 Nov 2026, now
  // in the pages' search words (shared/nav/<area>.js).
  const FORMER = {
    '/timeline': ['bookings today', 'floor', 'reservations'],
    '/cash-recon': ['cash up', 'cashing up', 'takings', 'wages', 'expenses', 'petty cash', 'variance'],
    '/rota': ['shifts', 'who is working', 'schedule staff'],
    '/staff': ['people', 'employees', 'leaving', 'holiday'],
    '/food-safety': ['temperatures', 'fridges', 'hot holding', 'cooking checks', 'deliveries'],
    '/orders': ['takeaway', 'collection', 'sold out'],
    '/pos/reports': ['z report', 'x report', 'till takings', 'kitchen report'],
    '/schedule': ['opening times', 'opening hours', 'sittings', 'closures', 'christmas'],
    '/rules': ['booking rules', 'party size', 'cut off'],
    '/website': ['site', 'banner', 'publish'],
    '/menus': ['dishes', 'prices', 'menu'],
    // "allergens" is the whole name of the Allergens page (/allergens) now.
    '/menus/allergens': ['allergy'],
    '/purchasing': ['ordering stock', 'supplier orders', 'deliveries'],
    '/screens': ['menu boards', 'tv'],
    '/screens/boards': ['board designer', 'screen designer', 'menu board designer'],
    '/pos/kiosk-designs': ['kiosk design', 'kiosk designs'],
    '/pos/kitchen-flow': ['kitchen flow', 'flow designer', 'kds flow'],
    '/pos/print-designs': ['print designer', 'receipt designer', 'ticket designer', 'print designs'],
    '/menus/print-designs': ['menu designer', 'printed menu', 'print designer'],
    '/website/builder': ['website builder', 'website designer', 'page designer'],
    '/website/reservations-widget': ['booking widget', 'widget designer'],
    '/ai': ['pepper', 'assistant', 'connect'],
  }
  for (const [route, phrases] of Object.entries(FORMER)) {
    for (const q of phrases) assert.ok(offered(q).includes(route), q + ' offers ' + route + ' (got ' + offered(q).join(', ') + ')')
  }
  // One page when it is clearly the one: its whole name or address, or the
  // phrase word for word in its search words ("up" and "page" are filler).
  for (const [q, route] of [
    ['cash up', '/cash-recon'], ['the rota page', '/rota'], ['orders', '/orders'], ['menu', '/menus'],
    ['page designer', '/website/builder'], ['opening times', '/schedule'], ['x report', '/pos/reports'],
    ['kiosks', '/pos/kiosks'], ['kiosk designer', '/pos/kiosk-designs'],
  ]) assert.deepEqual(offered(q), [route], q)
  // A close second is offered beside the best, best first.
  assert.deepEqual(offered('print designer'), ['/menus/print-designs', '/pos/print-designs'])
  assert.deepEqual(offered('nothing like a page'), [])
})

// ── open_page in the staff chat: the nav card ───────────────────────

function parseSse(text) {
  return text.split('\n\n').filter(Boolean).flatMap(chunk => {
    const data = chunk.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n')
    return data ? [JSON.parse(data)] : []
  })
}

test('in the chat, a page Pepper offers is a nav card: the page, its place, what it opens at, from the server\'s result', async () => {
  ids = await resetAndSeed()
  const owner = as(A.owner, ids.a)
  const ware = await ok(owner.post('/api/venues', { name: 'Ware', slug: 'card-ware', timezone: 'Europe/London' }))
  claude.script.push(
    () => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_p1', name: 'open_page', input: { page: 'rota', venue: 'Ware', week: '2026-11-25' } }] }),
    () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Here is the rota.' }] }),
  )
  const res = await owner.post('/api/ai/chat', { message: 'open the rota for Ware next week' }, { accept: 'text/event-stream' })
  assert.equal(res.status, 200)
  const events = parseSse(res.body)
  const card = events.find(e => e.type === 'card')?.card
  assert.equal(card?.type, 'nav')
  assert.equal(card.pages.length, 1)
  const [p] = card.pages
  assert.equal(p.page, 'Rota')
  assert.equal(p.link, '/rota?venue=' + ware.id + '&week=2026-11-23')
  assert.equal(p.section, 'People')
  assert.equal(p.icon, 'CalendarRange')
  assert.deepEqual(p.opens_at, ['Ware', 'week of Mon 23 Nov'])
  // The model was told the page and given the link; the card came from the same result.
  const toolResult = claude.requests.at(-1).body.messages.at(-1).content.find(b => b.type === 'tool_result')
  const sent = JSON.parse(toolResult.content[0].text)
  assert.equal(sent.page, 'Rota')
  assert.deepEqual(sent.nav_card, card.pages)
  const done = events[events.length - 1]
  assert.deepEqual(done.items.find(i => i.type === 'nav'), card, 'the stored conversation shows the same card')
  assert.ok(!done.items.some(i => i.type === 'step' && /page/i.test(i.text)), 'no step line for it')

  // Several pages: one card with each.
  claude.script.push(
    () => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_p2', name: 'open_page', input: { page: 'print designer' } }] }),
    () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Two of them.' }] }),
  )
  const two = parseSse((await owner.post('/api/ai/chat', { message: 'print designer' }, { accept: 'text/event-stream' })).body)
  const card2 = two.find(e => e.type === 'card')?.card
  assert.deepEqual(card2.pages.map(x => x.page).sort(), ['Menu print designer', 'Receipt & ticket designer'])
})

test('the nav card shows only links into the app, and no card without pages', () => {
  const tool = audienceTools('staff').find(t => t.name === 'open_page')
  assert.equal(tool.display({ page: 'Rota' }), null, 'over the connector there is no card')
  assert.equal(tool.display({ nav_card: [] }), null)
  const shown = tool.display({ nav_card: [
    { page: 'Rota', link: '/rota' },
    { page: 'Elsewhere', link: 'https://evil.example/' },
    { page: 'Two slashes', link: '//evil.example' },
    { link: '/no-name' },
  ] })
  assert.deepEqual(shown, { type: 'nav', pages: [{ page: 'Rota', link: '/rota' }] })
})

// ── open_page and the person's own menu (the owner's choice, 23 Nov 2026) ──

test('open_page finds and shows a renamed page by its own name, and still offers a page hidden from the role', async () => {
  ids = await resetAndSeed()
  const owner = as(A.owner, ids.a)
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM nav_items WHERE tenant_id = ${ids.a}`
  assert.ok(n > 0, 'the group has a menu of its own')
  const [role] = await sql`SELECT id FROM tenant_roles WHERE tenant_id = ${ids.a} AND key = 'owner' AND is_builtin`
  await sql`UPDATE nav_items SET label = 'Staff planner' WHERE tenant_id = ${ids.a} AND route = '/rota'`
  await sql`UPDATE nav_items SET hidden_role_ids = ARRAY[${role.id}]::uuid[] WHERE tenant_id = ${ids.a} AND route = '/pos/kiosk-designs'`
  const { token } = await ok(owner.post('/api/ai/tokens', { name: 'Own menu' }))

  // Found by the group's own name, shown by it, the standard name beside it.
  const own = await openWith(token, { page: 'staff planner' })
  assert.equal(own.error, false, own.text)
  assert.equal(own.out.page, 'Staff planner')
  assert.equal(own.out.standard_name, 'Rota')
  assert.equal(pathOf(own.out.url), '/rota')
  // Asked by the standard name: still found, still shown by the group's name.
  const std = await openWith(token, { page: 'rota' })
  assert.equal(std.out.page, 'Staff planner')
  assert.equal(pathOf(std.out.url), '/rota')
  // Hidden from the role: still offered (they can open it), marked as not in their menu.
  const hidden = await openWith(token, { page: 'kiosk designer' })
  assert.equal(hidden.error, false, hidden.text)
  assert.equal(pathOf(hidden.out.url), '/pos/kiosk-designs')
  assert.equal(hidden.out.in_menu, false)
  assert.equal(own.out.in_menu, undefined, 'a page in the menu says nothing about it')

  // In the chat: the card carries the own name, the standard one, and "Not in your menu".
  claude.script.push(
    () => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_o1', name: 'open_page', input: { page: 'staff planner' } }] }),
    () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Here.' }] }),
  )
  const card = parseSse((await owner.post('/api/ai/chat', { message: 'staff planner' }, { accept: 'text/event-stream' })).body)
    .find(e => e.type === 'card')?.card
  assert.equal(card.pages[0].page, 'Staff planner')
  assert.equal(card.pages[0].standard, 'Rota')
  assert.equal(card.pages[0].section, 'People')
  claude.script.push(
    () => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_o2', name: 'open_page', input: { page: 'kiosk designer' } }] }),
    () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Here.' }] }),
  )
  const card2 = parseSse((await owner.post('/api/ai/chat', { message: 'kiosk designer' }, { accept: 'text/event-stream' })).body)
    .find(e => e.type === 'card')?.card
  assert.equal(card2.pages[0].section, 'Not in your menu')
})
