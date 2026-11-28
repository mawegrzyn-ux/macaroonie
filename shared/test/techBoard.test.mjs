import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEVICE_ONLINE_MS, SCREEN_ONLINE_MS, seenState, deviceOnline, agoText, printerState, deviceState,
  techTiles, techModel, techHealth, screenTiles, seenText, TECH_KINDS, TONES, TONE_MARKS, hubCopy,
} from '../techBoard.js'

const now = Date.parse('2026-11-22T12:00:00Z')
const ago = ms => new Date(now - ms).toISOString()

test('online: seen within the cut-off; never seen or not linked is neither', () => {
  assert.equal(seenState(ago(60_000), DEVICE_ONLINE_MS, { now }), 'online')
  assert.equal(seenState(ago(DEVICE_ONLINE_MS + 1), DEVICE_ONLINE_MS, { now }), 'offline')
  assert.equal(seenState(null, DEVICE_ONLINE_MS, { now }), 'never')
  assert.equal(seenState(ago(1000), DEVICE_ONLINE_MS, { linked: false, now }), 'never', 'not linked')
  assert.equal(seenState(ago(149_000), SCREEN_ONLINE_MS, { now }), 'online')
  assert.equal(seenState(ago(151_000), SCREEN_ONLINE_MS, { now }), 'offline', 'screens have the shorter cut-off')
  assert.equal(deviceOnline({ paired: true, last_seen_at: ago(1000) }, now), true)
  assert.equal(deviceOnline({ paired: false, last_seen_at: ago(1000) }, now), false)
  assert.equal(deviceOnline({ secret_hash: 'x', last_seen_at: ago(1000) }, now), true, 'a raw row: linked by its secret')
})

test('how long ago, in words', () => {
  assert.equal(agoText(null, now), 'never')
  assert.equal(agoText(ago(20_000), now), 'just now')
  assert.equal(agoText(ago(4 * 60_000), now), '4 min ago')
  assert.equal(agoText(ago(2 * 3600_000), now), '2 h ago')
  assert.equal(agoText(ago(3 * 86400_000), now), '19 Nov')
})

// A venue's board as GET /api/tech-board/venues/:venueId gives it.
function board() {
  const hub = { id: 'h1', kind: 'hub', name: 'Hub', paired: true, last_seen_at: ago(30_000), app_version: '2.1', last_action: { at: ago(60_000), what: 'report' }, copy_on: true, copy_at: ago(3 * 60_000) }
  return {
    devices: [
      hub,
      { id: 't1', kind: 'terminal', name: 'Till 1', paired: true, last_seen_at: ago(20 * 60_000), last_action: null },
      { id: 't2', kind: 'terminal', name: 'Till 2', paired: true, last_seen_at: ago(10_000), app_version: '1.4', last_action: { at: ago(60_000), what: 'event' } },
      { id: 't3', kind: 'terminal', name: 'Till 3', paired: false, last_seen_at: null, last_action: null },
      { id: 'k1', kind: 'kds', name: 'Grill', paired: true, last_seen_at: null, last_action: null },
      { id: 'q1', kind: 'kiosk', name: 'Kiosk', paired: true, last_seen_at: ago(5000), last_action: { at: ago(9 * 60_000), what: 'order' } },
    ],
    printers: [
      { id: 'p1', name: 'Kitchen', is_active: true, connection: 'hub', host: '10.0.0.9', status: { online: true }, status_at: ago(60_000), jobs: { waiting: 1, failed: 3 }, last_job: { at: ago(120_000), status: 'failed', error: 'Paper jam' } },
      { id: 'p2', name: 'Bar', is_active: true, connection: 'hub', host: '10.0.0.8', status: { online: false, error: 'ECONNREFUSED 10.0.0.8' }, status_at: ago(4 * 60_000), jobs: { waiting: 0, failed: 0 }, last_job: null },
      { id: 'p3', name: 'Old', is_active: false, connection: 'hub', host: '10.0.0.7', jobs: { waiting: 0, failed: 0 } },
    ],
    card_readers: [
      { id: 'c1', name: 'Card A', model: 'S700', serial: 'SER-1', last_payment: { at: ago(60_000), kind: 'payment', status: 'approved', amount: 1250 } },
      { id: 'c2', name: 'Card B', model: null, serial: null, last_payment: null },
    ],
    screens: [
      { id: 's1', name: 'Menu', short_code: 'AB12', paired: true, state: 'online', last_seen_at: ago(30_000), app_version: '1.5.0', error: null, showing: 'Lunch' },
      { id: 's2', name: 'Board', short_code: null, paired: true, state: 'offline', last_seen_at: ago(30 * 60_000), error: null },
    ],
  }
}

test('tiles: each piece of kit with its tone, its word and where it is set up', () => {
  const tiles = techTiles(board(), { now })
  const t = Object.fromEntries(tiles.map(x => [x.key, x]))
  assert.equal(tiles.length, 12, 'the switched-off printer is left out')
  assert.deepEqual([t['till:t1'].tone, t['till:t1'].word], ['bad', 'Offline'])
  assert.deepEqual([t['till:t2'].tone, t['till:t2'].word], ['ok', 'Online'])
  assert.deepEqual([t['till:t3'].tone, t['till:t3'].word], ['muted', 'Not linked'])
  assert.deepEqual([t['kitchen:k1'].tone, t['kitchen:k1'].word], ['warn', 'Waiting'], 'linked, never heard from')
  assert.equal(t['kiosk:q1'].detail, 'Last order 9 min ago')
  // Failed tickets today: a printer that reports Ready needs a look, with the number.
  assert.deepEqual([t['printer:p1'].tone, t['printer:p1'].word, t['printer:p1'].count], ['warn', '3 failed', 3])
  assert.match(t['printer:p1'].status, /3 failed today/)
  assert.deepEqual([t['printer:p2'].tone, t['printer:p2'].word], ['bad', 'Offline'])
  assert.deepEqual([t['card:c1'].tone, t['card:c1'].word], ['ok', 'Working'])
  assert.deepEqual([t['card:c2'].tone, t['card:c2'].word], ['muted', 'Quiet'])
  assert.deepEqual([t['screen:s1'].tone, t['screen:s2'].tone], ['ok', 'bad'])
  assert.equal(t['screen:s1'].name, 'Menu (AB12)')
  assert.equal(t['till:t2'].link, '/pos/tills')
  assert.equal(t['screen:s1'].link, '/screens')
  // The detail panel's facts.
  const facts = x => Object.fromEntries(x.facts.map(f => [f.label, f.value]))
  assert.equal(facts(t['till:t2'])['App version'], '1.4')
  assert.equal(facts(t['printer:p1'])['Failed today'], '3')
  assert.match(facts(t['card:c1'])['Last payment'], /approved, £12\.50/)
  // The hub's copy for trading offline: 3 of 15 minutes old.
  assert.deepEqual(t['hub:h1'].ring, hubCopy(board().devices[0], now))
  assert.equal(t['hub:h1'].ring.fresh, 0.8)
  assert.equal(hubCopy({ copy_on: false }, now), null, 'Hub first off: no ring')
})

test('a printer reads the same on the Printers page and the board', () => {
  const b = board()
  const setup = { devices: b.devices }
  assert.deepEqual(printerState(b.printers[1], setup, now), ['Not answering: ECONNREFUSED 10.0.0.8 (4 min ago)', 'bad'])
  assert.deepEqual(printerState({ is_active: true, connection: 'hub', host: '' }, setup, now), ['Type its address on the network', 'warn'])
  assert.deepEqual(printerState({ is_active: true, connection: 'hub', host: 'x' }, { devices: [] }, now)[1], 'warn', 'no hub')
  assert.deepEqual(printerState({ is_active: false }, setup, now), ['Switched off', 'muted'])
  assert.deepEqual(deviceState({ paired: true, last_seen_at: ago(10_000), app_version: '3' }, now), ['Online · 3', 'ok', 'Online'])
})

test('groups: one per kind of kit, in the board\'s order, worst first, with a badge', () => {
  const m = techModel(techTiles(board(), { now }), { light: 'up' })
  assert.deepEqual(m.groups.map(g => g.key), ['hub', 'till', 'kitchen', 'kiosk', 'printer', 'card', 'screen'])
  const tills = m.groups.find(g => g.key === 'till')
  assert.deepEqual(tills.tiles.map(x => x.name), ['Till 1', 'Till 2', 'Till 3'], 'down first, not linked last')
  assert.equal(tills.badge, '1 of 2 up', 'not linked is not counted')
  assert.equal(tills.tone, 'bad')
  assert.equal(m.groups.find(g => g.key === 'card').badge, '1 of 1 up')
  assert.deepEqual(m.attention.map(x => x.name), ['Bar', 'Board', 'Till 1', 'Grill', 'Kitchen'], 'down then needs a look, by name')
  assert.ok(m.groups.every(g => TECH_KINDS.some(k => k.key === g.key && k.colour === g.colour && k.line === g.line)))
})

test('health: the worst tone, the counts in words, the platform\'s light', () => {
  const tiles = techTiles(board(), { now })
  const h = techHealth(tiles, 'up')
  assert.equal(h.tone, 'bad')
  assert.deepEqual(h.counts, { ok: 5, warn: 2, bad: 3, muted: 2 })
  assert.equal(h.words, '5 up, 3 down, 2 to check, 2 not linked')
  assert.equal(h.title, '3 down')
  const fine = tiles.filter(x => x.tone === 'ok')
  assert.deepEqual([techHealth(fine, 'up').tone, techHealth(fine, 'up').title, techHealth(fine, 'up').words], ['ok', 'All working', '5 up'])
  assert.equal(techHealth(fine, 'degraded').tone, 'warn', 'the platform running slow makes the venue need a look')
  assert.deepEqual([techHealth(fine, { state: 'down' }).tone, techHealth(fine, 'down').title], ['bad', 'Macaroonie down'])
  assert.deepEqual([techHealth([]).title, techHealth([]).tone], ['No kit yet', 'muted'])
})

test('every tone has its own mark', () => {
  assert.deepEqual(TONES, ['bad', 'warn', 'ok', 'muted'])
  const marks = TONES.map(t => TONE_MARKS[t])
  assert.ok(marks.every(Boolean))
  assert.equal(new Set(marks).size, TONES.length, 'no two tones share a mark')
})

test('a menu screen gets the words to draw and nothing else', () => {
  const tiles = techTiles(board(), { now })
  const pub = screenTiles(tiles)
  assert.equal(pub.length, tiles.length)
  for (const p of pub) assert.deepEqual(Object.keys(p).sort(), ['count', 'kind', 'name', 'ring', 'seen_at', 'tone', 'word'])
  const text = JSON.stringify(pub)
  for (const secret of ['10.0.0', 'SER-1', 'S700', 'ECONNREFUSED', 'Paper jam', '1.5.0', 'h1', 't1', 'p1', 'c1', 's1']) {
    assert.ok(!text.includes(secret), 'no ' + secret)
  }
  // The block builds the same model from them, its keys by place.
  const m = techModel(pub, { light: 'up' })
  assert.deepEqual(m.health.counts, techHealth(tiles).counts)
  assert.ok(m.tiles.every(t => t.key))
  assert.equal(seenText(m.tiles.find(t => t.name === 'Till 1'), now), 'seen 20 min ago')
  assert.equal(seenText(m.tiles.find(t => t.name === 'Bar'), now), 'checked 4 min ago')
  assert.equal(seenText(m.tiles.find(t => t.name === 'Till 2'), now), '', 'only offline tiles say when')
})
