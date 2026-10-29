// How the till, the kiosk and the kitchen screen keep what they show up to
// date by asking (docs/POS.md 8.3). Each keeps its last config on the device
// (IndexedDB), so it opens with its menu straight away, with the internet
// down too; then it asks:
//
//   the whole config  every `content` (GET /pos-api/config?version=,
//                     answered "unchanged" when nothing changed), and at once
//                     on a pos.config push
//   prices and sold   every `live` on a till or kiosk (GET /pos-api/live:
//   out               { sold_out, prices }), unless the location turned it
//                     off. Dishes sold out change in place; a prices stamp
//                     other than the config's means prices changed (a menu
//                     published, a scheduled one gone live, an option or a
//                     promotion changed): the device fetches the config.
//
// The times are the location's (Store tech -> Device updates, migration 216),
// in every config as `pull`; shared/pos/pullTimes.js has the defaults used
// until a config says otherwise. Sold out and the prices stamp aren't in the
// config's version (liveFields() in api/src/services/posSvc.js), and every
// config reply carries them, an unchanged one too.

import { pullMs } from '@shared/pos/pullTimes.js'

// A pull that is off is looked at again this often, in case it is turned on.
const OFF_RECHECK_MS = 60 * 1000

/**
 * Timers for a device's pulls. `tasks` maps a pull's key (content, live) to
 * the function that asks; each runs, then waits as long as the current
 * config's `pull` says (read again every time). Call check() after a new
 * config: when its times differ from the ones the timers were set with, they
 * start again with the new times (so a change from 30 minutes to 3 doesn't
 * wait out the 30). stop() ends them.
 */
export function createPullTimers(getConfig, tasks) {
  const timers = {}
  let key = null
  let stopped = false
  const msOf = name => pullMs(getConfig()?.pull)[name]
  const schedule = name => {
    clearTimeout(timers[name])
    if (stopped) return
    const ms = msOf(name)
    timers[name] = setTimeout(async () => {
      if (ms != null) { try { await tasks[name]() } catch { /* the task shows its own error */ } }
      schedule(name)
    }, ms ?? OFF_RECHECK_MS)
  }
  const start = () => {
    key = JSON.stringify(pullMs(getConfig()?.pull))
    for (const name of Object.keys(tasks)) schedule(name)
  }
  start()
  return {
    check() {
      if (stopped || JSON.stringify(pullMs(getConfig()?.pull)) === key) return
      start()
    },
    stop() {
      stopped = true
      for (const t of Object.values(timers)) clearTimeout(t)
    },
    /** What each pull waits now, in ms (null = off), for the settings panels. */
    times: () => pullMs(getConfig()?.pull),
  }
}

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
