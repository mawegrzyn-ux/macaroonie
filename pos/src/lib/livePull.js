// How the till, the kiosk and the kitchen screen keep what they show up to
// date by asking (docs/POS.md 8.3). Each keeps its last config on the device
// (IndexedDB), so it opens with its menu straight away, with the internet
// down too; then it asks:
//
//   the whole config  every CONTENT_EVERY_MS (GET /pos-api/config?version=,
//                     answered "unchanged" when nothing changed), and at once
//                     on a pos.config push
//   prices and sold   every LIVE_EVERY_MS on a till or kiosk (GET /pos-api/live:
//   out               { sold_out, prices }). Dishes sold out change in place;
//                     a prices stamp other than the config's means prices
//                     changed (a menu published, a scheduled one gone live, an
//                     option or a promotion changed): the device fetches the config.
//
// Sold out and the prices stamp aren't in the config's version (liveFields()
// in api/src/services/posSvc.js), and every config reply carries them, an
// unchanged one too.

export const CONTENT_EVERY_MS = 3 * 60 * 1000
export const LIVE_EVERY_MS = 30 * 1000

const sameList = (a, b) => JSON.stringify(a || []) === JSON.stringify(b || [])

/**
 * The config with a reply's sold out list (and, when `prices` is passed,
 * its prices stamp) laid over it; null when that changes nothing.
 */
export function withLive(config, reply, { prices = true } = {}) {
  if (!config || !reply) return null
  const soldOut = Array.isArray(reply.sold_out) ? reply.sold_out : config.sold_out
  const stamp = prices && reply.prices ? reply.prices : config.prices
  if (sameList(soldOut, config.sold_out) && stamp === config.prices) return null
  return { ...config, sold_out: soldOut, ...(stamp ? { prices: stamp } : {}) }
}

/** True when a /live reply's prices stamp says the config's prices are out of date. */
export const pricesChanged = (config, reply) => !!(config && reply?.prices && reply.prices !== config.prices)

/**
 * Ask the browser to keep this address's storage (the config, the outbox,
 * the saved pictures and videos) when the device runs short of space.
 * Granted by itself to an installed app; elsewhere it may be refused, which
 * changes nothing.
 */
export function keepStorage() {
  try { navigator.storage?.persist?.().catch(() => {}) } catch { /* not offered */ }
}
