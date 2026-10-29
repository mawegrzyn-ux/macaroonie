// How often a location's devices ask the server for changes (migration 216,
// docs/POS.md 8.3). Pushes (a socket message the moment something changes)
// do most of the work; these pulls are the safety net for a push that never
// arrived. Asking less often eases the load on the server and a weak
// connection, at the cost of a missed push taking longer to show.
//
//   content  tills, kiosks, kitchen screens: the whole config (menus,
//            pictures, staff, layout), answered "unchanged" when nothing changed
//   live     tills and kiosks: prices and sold out (0 = off: pushes and the
//            whole config only)
//   screen   menu screens: their boards, playlist and menus
//   board    menu screens with an order ready board: the order numbers
//
// Stored per location in pos_settings as seconds; every device config
// carries them as `pull`, and the devices fall back to the defaults when an
// older server doesn't send them.

export const PULL_TIMES = [
  { key: 'content', column: 'pull_content_secs', label: 'Menus, pictures and settings', devices: 'Tills, kiosks and kitchen screens', default: 180, min: 60, max: 3600 },
  { key: 'live',    column: 'pull_live_secs',    label: 'Prices and sold out',          devices: 'Tills and kiosks',                  default: 30,  min: 10, max: 600, canBeOff: true },
  { key: 'screen',  column: 'pull_screen_secs',  label: 'Menu screen boards',           devices: 'Menu screens',                      default: 60,  min: 30, max: 3600 },
  { key: 'board',   column: 'pull_board_secs',   label: 'Order ready board numbers',    devices: 'Menu screens showing order numbers', default: 15, min: 5,  max: 300 },
]

export const PULL_KEYS = PULL_TIMES.map(p => p.key)
export const PULL_DEFAULTS = Object.fromEntries(PULL_TIMES.map(p => [p.key, p.default]))

// Ready-made sets for the Store tech page.
export const PULL_PRESETS = [
  { key: 'standard', label: 'Standard', hint: 'Changes show within a minute or two, even on a device that missed being told.', values: { content: 180, live: 30, screen: 60, board: 15 } },
  { key: 'lighter',  label: 'Less often', hint: 'About a quarter of the asks. A change a device missed can take a few minutes to show.', values: { content: 600, live: 120, screen: 300, board: 30 } },
  { key: 'lightest', label: 'Least often', hint: 'For a busy location on a weak connection: prices and sold out only when devices are told.', values: { content: 1800, live: 0, screen: 900, board: 60 } },
]

/** One time in seconds, within its limits; 0 only where it can be off. */
export function cleanPull(def, value) {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return def.default
  if (n <= 0) return def.canBeOff ? 0 : def.min
  return Math.min(def.max, Math.max(def.min, n))
}

/** The four times in seconds from a pos_settings row (or a config's `pull`). */
export function pullTimes(row = {}) {
  const out = {}
  for (const def of PULL_TIMES) {
    const v = row?.[def.column] ?? row?.[def.key]
    out[def.key] = v == null ? def.default : cleanPull(def, v)
  }
  return out
}

/** What a device waits between asks, in ms; live null = don't ask. */
export function pullMs(pull) {
  const s = pullTimes(pull || {})
  return {
    content: s.content * 1000,
    live: s.live ? s.live * 1000 : null,
    screen: s.screen * 1000,
    board: s.board * 1000,
  }
}

/** The preset these times match, or null (set by hand). */
export function presetOf(pull) {
  const s = pullTimes(pull || {})
  return PULL_PRESETS.find(p => PULL_KEYS.every(k => p.values[k] === s[k]))?.key ?? null
}

/** How many times an hour one device asks with these times. */
export function asksPerHour(pull, kind) {
  const s = pullTimes(pull || {})
  const per = secs => (secs ? 3600 / secs : 0)
  if (kind === 'kds') return per(s.content)
  if (kind === 'screen') return per(s.screen)
  if (kind === 'board') return per(s.screen) + per(s.board)
  return per(s.content) + per(s.live)  // till, kiosk
}

/** "30 seconds", "3 minutes", "1 hour 30 minutes", "Off". */
export function pullText(secs) {
  if (!secs) return 'Off'
  if (secs < 60) return secs + (secs === 1 ? ' second' : ' seconds')
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  const parts = []
  if (h) parts.push(h + (h === 1 ? ' hour' : ' hours'))
  if (m) parts.push(m + (m === 1 ? ' minute' : ' minutes'))
  if (s) parts.push(s + ' seconds')
  return parts.join(' ')
}
