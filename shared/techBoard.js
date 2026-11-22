// shared/techBoard.js
//
// When a venue's kit counts as online (22 Nov 2026, OUTSTANDING 44.7): the
// one set of rules for the Tech board, the installer app, the Screens page
// and the Printers section (whose printerState() says how a printer reads). Kit says it
// is alive by calling the API: tills, kitchen screens, kiosks and the venue
// hub at most once a minute (their last_seen_at), menu screens with a
// heartbeat every minute (written at most every 50 s). The cut-offs leave
// room for a missed call or two.

/** A till, kitchen screen, kiosk or venue hub is online when it called this recently. */
export const DEVICE_ONLINE_MS = 5 * 60_000
/** A menu screen is online when its heartbeat came this recently. */
export const SCREEN_ONLINE_MS = 150_000
const ageOf = (at, now) => (at ? now - new Date(at).getTime() : Infinity)

/** 'online' | 'offline' | 'never' (never seen, or not linked). */
export function seenState(lastSeenAt, limitMs, { linked = true, now = Date.now() } = {}) {
  if (!linked || !lastSeenAt) return 'never'
  return ageOf(lastSeenAt, now) < limitMs ? 'online' : 'offline'
}

export const deviceOnline = (d, now = Date.now()) => seenState(d?.last_seen_at, DEVICE_ONLINE_MS, { linked: d?.paired ?? !!d?.secret_hash, now }) === 'online'

/**
 * The board's summary: how many items are fine, and the ones that need
 * someone, loudest first. items: [{ kind, name, tone }], tone 'ok' | 'warn' |
 * 'bad' | 'muted' (muted: nothing to judge, as a printer not checked yet).
 */
export function boardSummary(items = []) {
  const counted = items.filter(i => i.tone !== 'muted')
  const good = counted.filter(i => i.tone === 'ok').length
  const needs = items.filter(i => i.tone === 'bad' || i.tone === 'warn')
    .sort((a, b) => (a.tone === 'bad' ? 0 : 1) - (b.tone === 'bad' ? 0 : 1) || String(a.name).localeCompare(String(b.name)))
  return { total: counted.length, good, needs }
}
