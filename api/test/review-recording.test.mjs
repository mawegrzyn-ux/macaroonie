// Reviews recorded off the review sites' own pages (migration 239): the
// record route stores what a browser client read (no scraping), dedupes by
// fingerprint so re-sending a page is safe, and fills the To check inbox;
// a decision (on the website, or kept off) stamps checked and a dismissed
// review never resurfaces; the newest-held view per site; and the whole path
// through the staff connector, as Claude in Chrome uses it (tools/list,
// record_reviews, latest_reviews), including a read-only token.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, getApp, sql, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../src/middleware/auth.js'

let ids, owner, V, BV

const PAGE = 'https://maps.google.example/zqx-ware/reviews'
const rec = (over = {}) => ({ venue_id: V, platform: 'google', page_url: PAGE, ...over })

const FIRST = [
  { author: 'Tess W', rating: 5, text: 'Lovely pad thai, fast service.', date: '2026-11-01', date_text: 'a week ago' },
  { author: 'Ben K', rating: 3, text: 'Good food,\nslow on a Friday.', date_text: '2 weeks ago' },
  { author: 'Stars Only', rating: 4 },
]

before(async () => {
  ids = await resetAndSeed()
  owner = as(A.owner, ids.a)
  V  = (await ok(owner.post('/api/venues', { name: 'Zqx Ware', slug: 'zqx-ware-reviews', timezone: 'Europe/London' }))).id
  BV = (await ok(as(B.owner, ids.b).post('/api/venues', { name: 'Wvb Ware', slug: 'wvb-ware-reviews', timezone: 'Europe/London' }))).id
})
after(() => closeApp())

test('recording stores what the page showed, unapproved, in the To check inbox', async () => {
  const out = await ok(owner.post('/api/reviews/record', rec({ reviews: FIRST })))
  assert.deepEqual({ added: out.added, already: out.already, unusable: out.unusable, to_check: out.to_check },
    { added: 3, already: 0, unusable: 0, to_check: 3 })
  assert.equal(out.venue_name, 'Zqx Ware')
  assert.equal(String(out.newest_review).slice(0, 10), '2026-11-01')

  const rows = await sql`SELECT * FROM reviews WHERE tenant_id = ${ids.a} AND venue_id = ${V} ORDER BY reviewer_name`
  assert.equal(rows.length, 3)
  for (const r of rows) {
    assert.equal(r.source, 'recorded')
    assert.equal(r.is_approved, false)
    assert.equal(r.checked_at, null)
    assert.match(r.external_id, /^rec:[0-9a-f]{32}$/)
    assert.ok(r.raw_data.recorded_by, 'who recorded it is kept')
    assert.equal(r.raw_data.page_url, PAGE)
  }
  const tess = rows.find(r => r.reviewer_name === 'Tess W')
  assert.equal(tess.review_date.toISOString(), '2026-11-01T12:00:00.000Z', 'YYYY-MM-DD lands at midday UTC')
  const ben = rows.find(r => r.reviewer_name === 'Ben K')
  assert.equal(ben.review_date, null)
  assert.equal(ben.raw_data.date_text, '2 weeks ago')
  assert.equal(ben.review_text, 'Good food,\nslow on a Friday.', 'paragraphs kept')
  assert.equal(rows.find(r => r.reviewer_name === 'Stars Only').rating, 4)

  // The list's inbox filter and the stats count.
  const inbox = await ok(owner.get('/api/reviews?to_check=1&venue_id=' + V))
  assert.equal(inbox.length, 3)
  const stats = await ok(owner.get('/api/reviews/stats?venue_id=' + V))
  assert.deepEqual({ to_check: Number(stats.to_check), pending: Number(stats.pending) }, { to_check: 3, pending: 3 })
})

test('the same reviews again are "already": the fingerprint survives whitespace and case, and a reply fills in later', async () => {
  const out = await ok(owner.post('/api/reviews/record', rec({ reviews: [
    { author: '  tess   w ', rating: 5, text: 'LOVELY  pad thai,   fast service.' },           // same review, read a bit differently
    { author: 'Ben K', rating: 3, text: 'Good food,\nslow on a Friday.', reply: 'Sorry Ben — Fridays are busy!' },
    { author: 'Stars Only', rating: 4 },
    { author: 'Nia P', rating: 5, text: 'Best wings in Ware.', date: '2026-11-06' },
  ] })))
  assert.deepEqual({ added: out.added, already: out.already }, { added: 1, already: 3 })

  const rows = await sql`SELECT * FROM reviews WHERE tenant_id = ${ids.a} AND venue_id = ${V}`
  assert.equal(rows.length, 4, 'no duplicate rows')
  const ben = rows.find(r => r.reviewer_name === 'Ben K')
  assert.equal(ben.reply_text, 'Sorry Ben — Fridays are busy!', 'the reply arrived on the existing row')
  assert.equal(ben.checked_at, null, 'still waiting to be checked')
  assert.equal(String(out.newest_review).slice(0, 10), '2026-11-06')
})

test('decisions: on the website or kept off both stamp checked; a dismissed review never resurfaces', async () => {
  const rows = await sql`SELECT id, reviewer_name FROM reviews WHERE tenant_id = ${ids.a} AND venue_id = ${V}`
  const idOf = name => rows.find(r => r.reviewer_name === name).id

  // Show on the website.
  const tess = await ok(owner.patch('/api/reviews/' + idOf('Tess W'), { is_approved: true }))
  assert.equal(tess.is_approved, true)
  assert.ok(tess.checked_at, 'approving counts as checked')
  assert.ok(tess.checked_by, 'and says who')

  // Keep off the website: checked, still unapproved, still there for dedupe.
  const ben = await ok(owner.patch('/api/reviews/' + idOf('Ben K'), { checked: true }))
  assert.equal(ben.is_approved, false)
  assert.ok(ben.checked_at)

  const stats = await ok(owner.get('/api/reviews/stats?venue_id=' + V))
  assert.equal(Number(stats.to_check), 2)

  // Recording Ben's review again: already, and it stays out of the inbox.
  const again = await ok(owner.post('/api/reviews/record', rec({ reviews: [
    { author: 'Ben K', rating: 3, text: 'Good food,\nslow on a Friday.' },
  ] })))
  assert.deepEqual({ added: again.added, already: again.already }, { added: 0, already: 1 })
  const [benRow] = await sql`SELECT checked_at, is_approved FROM reviews WHERE id = ${idOf('Ben K')}`
  assert.ok(benRow.checked_at, 'kept checked')
  assert.equal(benRow.is_approved, false)

  // Bulk approve checks too; an empty patch is refused; checked alone is enough.
  await ok(owner.post('/api/reviews/bulk-approve', { ids: [idOf('Stars Only')], is_approved: true }))
  const [stars] = await sql`SELECT checked_at, is_approved FROM reviews WHERE id = ${idOf('Stars Only')}`
  assert.ok(stars.checked_at && stars.is_approved)
  assert.equal((await owner.patch('/api/reviews/' + idOf('Nia P'), {})).status, 400)

  // A manual entry is typed by the person, so it is born checked.
  const manual = await ok(owner.post('/api/reviews', { venue_id: V, platform: 'manual', reviewer_name: 'Typed In', rating: 5, review_text: 'From a comment card' }))
  assert.ok(manual.checked_at)
  const after = await ok(owner.get('/api/reviews/stats?venue_id=' + V))
  assert.equal(Number(after.to_check), 1, 'only Nia P is left to check')
})

test('latest: the newest review held per site, and when reviews were last recorded', async () => {
  await ok(owner.post('/api/reviews/record', rec({ platform: 'deliveroo', page_url: null, reviews: [
    { author: 'Rider Fan', rating: 5, text: 'Arrived hot.', date: '2026-10-20' },
  ] })))
  const rows = await ok(owner.get('/api/reviews/latest?venue_id=' + V))
  const by = Object.fromEntries(rows.map(r => [r.platform, r]))
  assert.equal(by.google.total, 4)
  assert.equal(String(by.google.newest_review).slice(0, 10), '2026-11-06')
  assert.equal(by.google.to_check, 1)
  assert.ok(by.google.last_recorded_at, 'recorded from the page')
  assert.equal(by.deliveroo.total, 1)
  assert.ok(by.manual, 'the typed-in review has its own row')
  assert.equal(by.manual.last_recorded_at, null, 'never recorded from a page')
  assert.equal(by.google.venue_name, 'Zqx Ware')

  const one = await ok(owner.get('/api/reviews/latest?venue_id=' + V + '&platform=deliveroo'))
  assert.equal(one.length, 1)
})

test('refusals: a review with nothing to hold, manual as a site, another tenant\'s venue, no access', async () => {
  const out = await ok(owner.post('/api/reviews/record', rec({ reviews: [
    { rating: 5, date: '2026-11-01' },                        // no author, no text: nothing to identify it
    { author: 'Real One', rating: 4, text: 'Fine.' },
  ] })))
  assert.deepEqual({ added: out.added, unusable: out.unusable }, { added: 1, unusable: 1 })

  assert.equal((await owner.post('/api/reviews/record', rec({ platform: 'manual', reviews: FIRST }))).status, 400, 'manual is not a review site')
  assert.equal((await owner.post('/api/reviews/record', rec({ reviews: [] }))).status, 400)
  assert.equal((await owner.post('/api/reviews/record', rec({ venue_id: BV, reviews: FIRST }))).status, 404, 'another tenant\'s venue')
  assert.equal((await owner.post('/api/reviews/record', rec({ venue_id: '00000000-0000-4000-8000-00000000dead', reviews: FIRST }))).status, 404)

  // The page is drawn as a link on the Reviews page: a web address only (Zod's url() takes these).
  for (const bad of ['javascript:alert(1)', 'data:text/html,<b>hi</b>', 'ftp://reviews.example/x']) {
    const r = await owner.post('/api/reviews/record', rec({ page_url: bad, reviews: [{ author: 'Link Test', rating: 5, text: 'Bad link' }] }))
    assert.equal(r.status, 400, bad)
  }
  const linkRows = await sql`SELECT COUNT(*)::int AS n FROM reviews WHERE reviewer_name = 'Link Test'`
  assert.equal(linkRows[0].n, 0, 'nothing stored with a bad page link')

  // The website module: operators and viewers have none by default.
  assert.equal((await as(A.operator, ids.a).post('/api/reviews/record', rec({ reviews: FIRST }))).status, 403)
  assert.equal((await as(A.viewer, ids.a).get('/api/reviews/latest?venue_id=' + V)).status, 403)

  // Nothing of tenant A's leaked into B.
  const bRows = await sql`SELECT COUNT(*)::int AS n FROM reviews WHERE tenant_id = ${ids.b}`
  assert.equal(bRows[0].n, 0)
})

// ── The staff connector, as Claude in Chrome uses it ─────────────────

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
const toolResult = r => JSON.parse(r.json.result.content[0].text)

test('the staff connector records and reads reviews (the Claude in Chrome path)', async () => {
  const { token } = await ok(owner.post('/api/ai/tokens', { name: 'Chrome' }))

  const names = (await mcp(token, 'tools/list')).json.result.tools.map(t => t.name)
  assert.ok(names.includes('record_reviews') && names.includes('latest_reviews'), 'both tools on the connector')

  const call = await mcp(token, 'tools/call', { name: 'record_reviews', arguments: {
    venue: 'Zqx Ware', site: 'tripadvisor', page_url: 'https://www.tripadvisor.example/zqx-ware',
    reviews: [
      { author: 'Trip Fan', rating: 5, text: 'A gem.', date: '2026-11-02', date_text: 'a week ago' },
      { author: 'Trip Crit', rating: 2, text: 'Too spicy for me.', date_text: '3 weeks ago' },
    ],
  } })
  assert.notEqual(call.json?.result?.isError, true, call.body.slice(0, 300))
  const out = toolResult(call)
  assert.deepEqual({ recorded_new: out.recorded_new, already: out.already_recorded }, { recorded_new: 2, already: 0 })
  assert.match(out.message, /waiting to be checked/)

  // A page address that isn't a web address is refused before anything is stored.
  const badLink = await mcp(token, 'tools/call', { name: 'record_reviews', arguments: {
    venue: 'Zqx Ware', site: 'tripadvisor', page_url: 'javascript:alert(1)',
    reviews: [{ author: 'Link Test', rating: 5, text: 'Bad link' }],
  } })
  assert.equal(badLink.json?.result?.isError, true, badLink.body.slice(0, 300))
  assert.match(badLink.json.result.content[0].text, /https/)

  // The same page read again: nothing new, and nothing duplicated.
  const again = toolResult(await mcp(token, 'tools/call', { name: 'record_reviews', arguments: {
    venue: 'Zqx Ware', site: 'tripadvisor',
    reviews: [{ author: 'Trip Fan', rating: 5, text: 'A gem.' }],
  } }))
  assert.deepEqual({ recorded_new: again.recorded_new, already: again.already_recorded }, { recorded_new: 0, already: 1 })
  assert.match(again.message, /already recorded/)

  const latest = toolResult(await mcp(token, 'tools/call', { name: 'latest_reviews', arguments: { venue: 'Zqx Ware', site: 'tripadvisor' } }))
  assert.deepEqual(
    { site: latest.held[0].site, held: latest.held[0].reviews_held, waiting: latest.held[0].waiting_to_check, newest: latest.held[0].newest_review },
    { site: 'TripAdvisor', held: 2, waiting: 2, newest: '2026-11-02' })
  assert.notEqual(latest.held[0].last_recorded, 'never')

  const rows = await sql`SELECT source, is_approved, checked_at FROM reviews WHERE tenant_id = ${ids.a} AND platform = 'tripadvisor'`
  assert.equal(rows.length, 2)
  assert.ok(rows.every(r => r.source === 'recorded' && !r.is_approved && !r.checked_at))

  // A read-only token can look but not record.
  const ro = await ok(owner.post('/api/ai/tokens', { name: 'Read', read_only: true }))
  const roNames = (await mcp(ro.token, 'tools/list')).json.result.tools.map(t => t.name)
  assert.ok(roNames.includes('latest_reviews') && !roNames.includes('record_reviews'))
})
