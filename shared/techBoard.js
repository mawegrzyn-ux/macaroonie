// shared/techBoard.js
//
// When a venue's kit counts as online (22 Nov 2026, OUTSTANDING 44.7): the
// one set of rules for the Tech board, the installer app, the Screens page
// and the Printers section (printerState() says how a printer reads). Kit says it
// is alive by calling the API: tills, kitchen screens, kiosks and the venue
// hub at most once a minute (their last_seen_at), menu screens with a
// heartbeat every minute (written at most every 50 s). The cut-offs leave
// room for a missed call or two.
//
// The tile model (28 Nov 2026, the honeycomb board): the Tech board's data
// (GET /api/tech-board/venues/:venueId) as tiles, one per piece of kit, each
// with a tone (ok | warn | bad | muted), a one-word state, the words a list
// row shows and the facts its detail panel lists; then grouped by kind of kit
// with counts, the venue's health and what needs someone, worst first.
// techTiles() makes the tiles, techModel() the rest. Everything that draws
// the board (Store tech's honeycomb and list, the full screen view, the menu
// screen Store status block through shared/techHex.js) takes this model:
// nothing works a status out a second time.

/** A till, kitchen screen, kiosk or venue hub is online when it called this recently. */
export const DEVICE_ONLINE_MS = 5 * 60_000
/** A menu screen is online when its heartbeat came this recently. */
export const SCREEN_ONLINE_MS = 150_000
/** The venue hub's copy for trading offline counts as current this long after it last followed the cloud. */
export const HUB_COPY_FRESH_MS = 15 * 60_000
const ageOf = (at, now) => (at ? now - new Date(at).getTime() : Infinity)

/** 'online' | 'offline' | 'never' (never seen, or not linked). */
export function seenState(lastSeenAt, limitMs, { linked = true, now = Date.now() } = {}) {
  if (!linked || !lastSeenAt) return 'never'
  return ageOf(lastSeenAt, now) < limitMs ? 'online' : 'offline'
}

export const deviceOnline = (d, now = Date.now()) => seenState(d?.last_seen_at, DEVICE_ONLINE_MS, { linked: d?.paired ?? !!d?.secret_hash, now }) === 'online'

/** How long ago, in a few words: just now, 4 min ago, 2 h ago, 3 Nov; never. */
export function agoText(iso, now = Date.now()) {
  if (!iso) return 'never'
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return 'never'
  const s = Math.round((now - t) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return Math.round(s / 60) + ' min ago'
  if (s < 86400) return Math.round(s / 3600) + ' h ago'
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

// ── Printers (moved here from the Printers section, 28 Nov 2026) ──

/** Is this printer plugged into a venue hub's computer? setup: { devices }. */
export const onHub = (p, setup) => p.connection === 'device' && (setup?.devices || []).find(d => d.id === p.device_id)?.kind === 'hub'
export const liveHubs = setup => (setup?.devices || []).filter(d => d.kind === 'hub' && !d.revoked_at)

/**
 * What we know about a printer: [text, tone, word]. The text in a few words;
 * the word is what its hexagon and a menu screen show, and names the fix: a
 * printer on a venue hub that is down says Hub down (never Set up, or the
 * Paper low the hub last reported), one with no hub to print through No hub.
 * setup: { devices }.
 */
export function printerState(p, setup, now = Date.now()) {
  if (!p.is_active) return ['Switched off', 'muted', 'Off']
  const devices = setup?.devices || []
  if (onHub(p, setup)) {
    const hub = devices.find(d => d.id === p.device_id)
    if (hub.revoked_at) return [hub.name + ' was removed: pick another hub', 'warn', 'Set up']
    if (!p.local_id) return ['Pick which printer on the hub this is', 'warn', 'Set up']
    if (!deviceOnline(hub, now)) {
      return hub.paired
        ? [hub.name + ' is offline (seen ' + agoText(hub.last_seen_at, now) + ')', 'warn', 'Hub down']
        : [hub.name + ' isn\'t linked yet', 'warn', 'No hub']
    }
    return hubPrinterState(p, now)
  }
  if (p.connection === 'device') {
    const d = devices.find(x => x.id === p.device_id)
    if (!d) return ['Pick the till, kitchen screen or kiosk it is plugged into', 'warn', 'Set up']
    if (d.revoked_at) return [d.name + ' was removed: pick another device', 'warn', 'Set up']
    return d.paired
      ? ['Printed by ' + d.name + ', seen ' + agoText(d.last_seen_at, now), 'ok', 'Ready']
      : ['Printed by ' + d.name + ' (not linked yet)', 'warn', 'Set up']
  }
  if (!p.host) return ['Type its address on the network', 'warn', 'Set up']
  if (!liveHubs(setup).length) return ['Waiting for a venue hub: link one on the Venue hub page', 'warn', 'No hub']
  return hubPrinterState(p, now)
}

/** What the hub last said about a printer it prints to: [text, tone, word]. */
function hubPrinterState(p, now) {
  const s = p.status
  if (!s || !p.status_at) return ['The hub hasn\'t checked it yet', 'muted', 'Not checked']
  const when = ' (' + agoText(p.status_at, now) + ')'
  if (!s.online) return ['Not answering' + (s.error ? ': ' + s.error : '') + when, 'bad', 'Offline']
  if (s.paper_out) return ['Out of paper' + when, 'bad', 'No paper']
  if (s.cover_open) return ['Cover open' + when, 'bad', 'Cover open']
  if (s.paper_low) return ['Paper running low' + when, 'warn', 'Paper low']
  return ['Ready' + when, 'ok', 'Ready']
}

// ── The tile model ─────────────────────────────────────────

/**
 * The kinds of kit, in the board's order: each a group (one cluster of
 * hexagons) with its icon (shared/techHex.js TECH_ICONS), where it is set
 * up, and its border on the honeycomb (a colour and a line of its own, so
 * the kind reads without the colour too). Each colour is at least 3 : 1
 * against the light page and the dark boards (the tests check).
 */
export const TECH_KINDS = [
  { key: 'hub', label: 'Venue hub', one: 'Venue hub', icon: 'hub', link: '/pos/hub', line: 'double', colour: '#6366f1' },
  { key: 'till', label: 'Tills', one: 'Till', icon: 'till', link: '/pos/tills', line: 'solid', colour: '#2563eb' },
  { key: 'kitchen', label: 'Kitchen screens', one: 'Kitchen screen', icon: 'kitchen', link: '/pos/kitchen', line: 'dash', colour: '#db2777' },
  { key: 'kiosk', label: 'Kiosks', one: 'Kiosk', icon: 'kiosk', link: '/pos/kiosks', line: 'dot', colour: '#0891b2' },
  { key: 'printer', label: 'Printers', one: 'Printer', icon: 'printer', link: '/pos/printers', line: 'dashdot', colour: '#7c3aed' },
  { key: 'card', label: 'Card machines', one: 'Card machine', icon: 'card', link: '/pos/cards', line: 'short', colour: '#a16207' },
  { key: 'screen', label: 'Menu screens', one: 'Menu screen', icon: 'screen', link: '/screens', line: 'thick', colour: '#64748b' },
]
export const TECH_KIND = Object.fromEntries(TECH_KINDS.map(k => [k.key, k]))
/** pos_devices.kind -> the board's kind. */
export const DEVICE_KINDS = { hub: 'hub', terminal: 'till', kds: 'kitchen', kiosk: 'kiosk' }

/**
 * Tones, worst first. muted: nothing to judge, either not linked (the tile's
 * linked is false) or linked with nothing to go on yet (a printer the hub
 * hasn't checked, a card machine with no payments): "not checked".
 */
export const TONES = ['bad', 'warn', 'ok', 'muted']
const RANK = { bad: 0, warn: 1, ok: 2, muted: 3 }
/** Each tone's mark, so a state never reads by colour alone (shared/techHex.js MARKS). */
export const TONE_MARKS = { ok: 'tick', warn: 'bang', bad: 'cross', muted: 'dash' }
/** Each tone in the legend. */
export const TONE_LABELS = { ok: 'Working', warn: 'Needs a look', bad: 'Down', muted: 'Not linked or not checked' }

/** The platform's own light (GET /api/status/light). */
export const PLATFORM_LIGHT = {
  up: { tone: 'ok', word: 'Up', text: 'Macaroonie is up' },
  degraded: { tone: 'warn', word: 'Slow', text: 'Macaroonie is running slow or partly: live updates or background work may be late' },
  down: { tone: 'bad', word: 'Down', text: 'Macaroonie isn\'t answering properly: tills keep trading offline' },
}

const pence = p => '£' + (Number(p || 0) / 100).toFixed(2)
const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : s)

/** A till, kitchen screen, kiosk or hub: [text, tone, word]. */
export function deviceState(d, now = Date.now()) {
  if (!d.paired) return ['Not linked yet', 'muted', 'Not linked']
  if (deviceOnline(d, now)) return ['Online' + (d.app_version ? ' · ' + d.app_version : ''), 'ok', 'Online']
  if (!d.last_seen_at) return ['Linked, not heard from yet', 'warn', 'Waiting']
  return ['Offline · last seen ' + agoText(d.last_seen_at, now), 'bad', 'Offline']
}

/** The last thing a device did, in words. */
export function lastAction(d, now = Date.now()) {
  const a = d.last_action
  if (d.kind === 'hub') {
    return [a ? 'Reported ' + agoText(a.at, now) : null, d.backup_uploaded_at ? 'copy for trading offline uploaded ' + agoText(d.backup_uploaded_at, now) : null]
      .filter(Boolean).join(' · ') || 'Nothing reported yet'
  }
  if (!a) return d.kind === 'kiosk' ? 'No visits yet' : 'No activity lately'
  if (d.kind === 'kiosk') return (a.what === 'order' ? 'Last order ' : 'Last visit ') + agoText(a.at, now)
  return 'Last activity ' + agoText(a.at, now)
}

/**
 * The venue hub's copy for trading offline: how current it is, 0 (stale or
 * none) to 1 (just followed the cloud), or null when Hub first is off.
 */
export function hubCopy(d, now = Date.now()) {
  if (!d.copy_on) return null
  const age = ageOf(d.copy_at, now)
  const fresh = Number.isFinite(age) ? Math.max(0, Math.min(1, 1 - age / HUB_COPY_FRESH_MS)) : 0
  const text = d.copy_at ? 'Copy for trading offline: up to date as of ' + agoText(d.copy_at, now) : 'No copy for trading offline yet'
  return { fresh: Math.round(fresh * 100) / 100, text }
}

const fact = (label, value) => (value == null || value === '' ? null : { label, value: String(value) })

/**
 * The board's tiles: board = GET /api/tech-board/venues/:venueId. Each
 * { key, id, kind, name, tone, word, status, detail, seen_at, facts: [{ label,
 * value }], count (printers: failed tickets today), ring (hub: hubCopy()),
 * linked (false: not linked yet, so a muted tile counts as not linked rather
 * than not checked), link, icon }. setup: Store tech's setup (its devices),
 * else the board's.
 */
export function techTiles(board, { now = Date.now(), setup = null } = {}) {
  if (!board) return []
  const out = []
  const add = (kind, id, name, t) => {
    const k = TECH_KIND[kind]
    out.push({
      key: kind + ':' + id, id, kind, name: String(name ?? ''), count: 0, ring: null, seen_at: null, linked: true,
      link: k.link, icon: k.icon, ...t, facts: (t.facts || []).filter(Boolean),
    })
  }
  for (const d of board.devices || []) {
    const kind = DEVICE_KINDS[d.kind]
    if (!kind) continue
    const [status, tone, word] = deviceState(d, now)
    const did = lastAction(d, now)
    const ring = kind === 'hub' ? hubCopy(d, now) : null
    add(kind, d.id, d.name, {
      tone, word, status, detail: did, seen_at: d.last_seen_at || null, ring, linked: !!d.paired,
      facts: [
        fact('State', status), d.paired ? fact('Last seen', agoText(d.last_seen_at, now)) : null,
        fact(kind === 'hub' ? 'Last report' : 'Last activity', did), fact('App version', d.app_version),
        ring ? fact('Trading offline', ring.text) : null,
      ],
    })
  }
  const setupOf = setup || { devices: board.devices || [] }
  for (const p of (board.printers || []).filter(x => x.is_active)) {
    let [status, tone, word] = printerState(p, setupOf, now)
    const jobs = p.jobs || {}
    const parts = []
    if (jobs.waiting) parts.push(jobs.waiting + ' waiting')
    // Failed tickets today make a printer that seemed fine need looking at,
    // with the number; a printer with a problem of its own keeps its word
    // (Hub down, Set up, Paper low: the fix), the number in its state.
    if (jobs.failed) {
      status += ' · ' + jobs.failed + ' failed today'
      if (tone === 'ok' || tone === 'muted') { tone = 'warn'; word = jobs.failed + ' failed' }
    }
    const last = p.last_job
    const lastText = last ? (last.status === 'failed' ? 'last ticket failed ' + agoText(last.at, now) + (last.error ? ': ' + last.error : '') : 'last ticket ' + agoText(last.at, now)) : null
    if (lastText) parts.push(lastText)
    add('printer', p.id, p.name, {
      tone, word, status, detail: parts.join(' · ') || 'No tickets this week', seen_at: p.status_at || null, count: jobs.failed || 0,
      facts: [
        fact('State', status), fact('Tickets waiting', jobs.waiting || 0), fact('Failed today', jobs.failed || 0),
        fact('Last ticket', lastText ? cap(lastText) : 'None this week'),
      ],
    })
  }
  for (const r of board.card_readers || []) {
    const p = r.last_payment
    const tone = !p ? 'muted' : p.status === 'approved' ? 'ok' : (p.status === 'failed' || p.status === 'declined') ? 'warn' : 'muted'
    const paid = p ? 'Last ' + (p.kind === 'refund' ? 'refund' : 'payment') + ' ' + agoText(p.at, now) + ': ' + p.status + ', ' + pence(p.amount) : null
    add('card', r.id, r.name, {
      tone, word: tone === 'ok' ? 'Working' : tone === 'warn' ? cap(p.status) : p ? cap(p.status) : 'Quiet',
      status: paid || 'No payments in 30 days', detail: [r.model, r.serial].filter(Boolean).join(' · ') || null,
      seen_at: p?.at || null,
      facts: [fact('Last payment', paid || 'None in 30 days'), fact('Model', r.model), fact('Serial', r.serial)],
    })
  }
  for (const s of board.screens || []) {
    const tone = s.state === 'online' ? (s.error ? 'warn' : 'ok') : s.state === 'offline' ? 'bad' : 'muted'
    const status = s.state === 'online' ? 'Online' + (s.app_version ? ' · ' + s.app_version : '')
      : s.state === 'offline' ? 'Offline · last seen ' + agoText(s.last_seen_at, now)
        : s.paired ? 'Linked, not heard from yet' : 'Not linked yet'
    add('screen', s.id, s.name + (s.short_code ? ' (' + s.short_code + ')' : ''), {
      tone, word: tone === 'warn' ? 'Problem' : tone === 'ok' ? 'Online' : tone === 'bad' ? 'Offline' : s.paired ? 'Not seen' : 'Not linked',
      status, detail: [s.showing ? 'Showing ' + s.showing : null, s.error ? 'Problem: ' + s.error : null].filter(Boolean).join(' · ') || null,
      seen_at: s.last_seen_at || null, linked: !!s.paired,
      facts: [
        fact('State', status), s.paired ? fact('Last seen', agoText(s.last_seen_at, now)) : null, fact('App version', s.app_version),
        fact('Showing', s.showing), fact('Problem', s.error),
      ],
    })
  }
  return out
}

const byWorst = (a, b) => RANK[a.tone] - RANK[b.tone] || String(a.name).localeCompare(String(b.name))

export function countTones(tiles = []) {
  const c = { ok: 0, warn: 0, bad: 0, muted: 0 }
  for (const t of tiles) if (c[t.tone] != null) c[t.tone]++
  return c
}

/** The worst tone that counts (muted only when nothing else is there). */
export function worstTone(tiles = []) {
  let best = 'muted'
  for (const t of tiles) if (RANK[t.tone] < RANK[best]) best = t.tone
  return best
}

/**
 * The muted tiles in words: the ones not linked yet, and the linked ones with
 * nothing to go on (a printer the hub hasn't checked, a quiet card machine),
 * never all of them called not linked. -> ['1 not linked', '2 not checked'].
 */
export function mutedWords(tiles = []) {
  const muted = tiles.filter(t => t.tone === 'muted')
  const unlinked = muted.filter(t => t.linked === false).length
  const rest = muted.length - unlinked
  return [unlinked ? unlinked + ' not linked' : null, rest ? rest + ' not checked' : null].filter(Boolean)
}

/**
 * The venue's health: the worst tone of its kit and the platform's light,
 * the counts by tone, a title and the counts in words ("12 up, 1 down").
 */
export function techHealth(tiles = [], light = null) {
  const counts = countTones(tiles)
  const platform = PLATFORM_LIGHT[typeof light === 'string' ? light : light?.state] || null
  let tone = worstTone(tiles)
  if (platform && RANK[platform.tone] < RANK[tone]) tone = platform.tone
  const words = [
    counts.ok + ' up', counts.bad ? counts.bad + ' down' : null, counts.warn ? counts.warn + ' to check' : null,
    ...mutedWords(tiles),
  ].filter(Boolean).join(', ')
  const unlinked = tiles.filter(t => t.tone === 'muted' && t.linked === false).length
  const title = platform?.tone === 'bad' ? 'Macaroonie down'
    : !tiles.length ? 'No kit yet'
      : counts.bad ? counts.bad + ' down'
        : counts.warn ? counts.warn + ' to check'
          : counts.ok ? 'All working' : unlinked === tiles.length ? 'Nothing linked' : 'Not checked yet'
  return { tone, counts, unlinked, total: tiles.length, judged: tiles.length - counts.muted, title, words: tiles.length ? words : 'Link kit in Store tech', platform }
}

/**
 * The board from its tiles: { tiles, groups, health, attention }. groups: one
 * per kind of kit that has any, in TECH_KINDS order, its tiles worst first
 * (the honeycomb puts the first in the middle), with counts and a badge
 * ("3 of 4 up"); attention: what is down or needs a look, worst first.
 * Tiles without a key (a menu screen's payload) get one by place.
 */
export function techModel(tiles = [], { light = null } = {}) {
  const list = tiles.filter(t => t && TECH_KIND[t.kind] && RANK[t.tone] != null)
    .map((t, i) => (t.key ? t : { ...t, key: t.kind + ':' + i }))
  const groups = []
  for (const k of TECH_KINDS) {
    const mine = list.filter(t => t.kind === k.key).sort(byWorst)
    if (!mine.length) continue
    const counts = countTones(mine)
    const judged = mine.length - counts.muted
    groups.push({
      ...k, tiles: mine, counts, up: counts.ok, judged, tone: worstTone(mine),
      badge: judged ? counts.ok + ' of ' + judged + ' up' : mutedWords(mine).join(', '),
    })
  }
  return {
    tiles: list, groups, health: techHealth(list, light),
    attention: list.filter(t => t.tone === 'bad' || t.tone === 'warn').sort(byWorst),
  }
}

/**
 * When a down tile was last heard from ('' when it isn't down): "seen 4 min
 * ago" for the attention strip and a hexagon's label; short, "4 min ago",
 * for the line on the hexagon itself (the long words don't fit its width).
 */
export function seenText(tile, now = Date.now(), { short = false } = {}) {
  if (tile.tone !== 'bad' || !tile.seen_at) return ''
  return (short ? '' : tile.kind === 'printer' ? 'checked ' : 'seen ') + agoText(tile.seen_at, now)
}

/**
 * What a menu screen may know about the kit (GET /screen-api/tech): the
 * words the Store status block draws, nothing else (no ids, addresses,
 * serials, errors or versions).
 */
export function screenTiles(tiles = []) {
  return tiles.map(t => ({
    kind: t.kind, name: t.name, tone: t.tone, word: t.word, seen_at: t.seen_at || null,
    count: t.count || 0, ring: t.ring ? { fresh: t.ring.fresh } : null, linked: t.linked !== false,
  }))
}
