// shared/foodCost.js
//
// Food cost beyond one stock period (inventory phase 6b; docs/INVENTORY.md
// 8.1, 8.2, 10.3), plain ESM for the API, the admin and the tests. One rule
// (CLAUDE.md rule 12): Cash Recon's week line, the dashboard widgets, the
// Overview tile, Today and the rule triggers all call these functions, on top
// of shared/variance.js (a period's figures) and shared/costing.js (margins,
// costShare(): the one place pounds meet pence).
//
// Actual food cost needs a count at both ends, and a week rarely starts and
// ends on counts. So a week has a theoretical food cost of its own (what its
// sales should have used, from usage from sales: dish_cost_days), and an
// actual only as a stock period's: the stored period that covers the whole
// week (its figure is the period's, said so), else the latest closed period,
// named with its dates. Never an actual made up for a week without counts.
//
//   daysFoodCost(rows)                          theoretical food cost of some trading days
//   weekFoodCost({ week, period, covers, currency })   the week's line: theoretical, actual from a period, words
//   overTarget(rows)                            dishes over their cost target, one per dish at its worst
//   targetCrossings(states, now)                what went over (or worse) or rose since the last look, what came back
//   marginsByMenu(rows, settings)               sold margins by menu (soldMargins() per menu)
//   overviewWords(row)                          a venue's stock in a line, for the Overview tile
//   varianceEvent(period, frozen, venue)         the rule event for a period closed over the band
//
// Money: costs in pounds, sales in integer pence; they meet in costShare().

import { isFoodSale, periodWords } from './variance.js'
import { costShare, soldMargins } from './costing.js'

const num = v => (v == null || v === '' ? 0 : Number(v))
const round2 = n => (n == null ? null : Math.round(Number(n) * 100) / 100)
const round4 = n => (n == null ? null : Math.round(Number(n) * 10000) / 10000)
const plural = (n, one, many = one + 's') => n + ' ' + (n === 1 ? one : many)
const pct = n => (n == null ? '' : String(round2(n)) + '%')

/** Pence as money in the venue's currency ("£4,210.50"). */
export function penceWords(pence, currency = 'GBP') {
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: currency || 'GBP' }).format(num(pence) / 100)
  } catch {
    return '£' + (num(pence) / 100).toFixed(2)
  }
}

/**
 * The theoretical food cost of some trading days, from their sold rows
 * (dish_cost_days, or sums of them: item_type, left_out, net_pence, cost,
 * qty, uncosted_qty, day). Food is isFoodSale()'s (food and drink; retail
 * goods and services out), as a period's net food sales are. A dish with no
 * recipe has no cost, so its sales make the % read low: uncosted_units says
 * how many. So do sales left out of usage (left_out: an open item typed in on
 * the till, a line on no menu dish, a dish no longer on a menu): their net is
 * in the food sales with no cost and no uncosted units; left_out_units says
 * how many. -> { net_food_pence, theoretical_value, theoretical_pct, units, uncosted_units, left_out_units, days }
 */
export function daysFoodCost(rows = []) {
  let net = 0, cost = 0, costed = false, units = 0, uncosted = 0, leftOut = 0
  const days = new Set()
  for (const r of rows || []) {
    if (!isFoodSale(r)) continue
    if (r.day) days.add(String(r.day).slice(0, 10))
    net += Math.round(num(r.net_pence))
    if (r.cost != null) { cost += num(r.cost); costed = true }
    units += num(r.qty)
    uncosted += num(r.uncosted_qty)
    if (r.left_out) leftOut += num(r.qty)
  }
  const value = costed ? round2(cost) : null
  return {
    net_food_pence: net, theoretical_value: value, theoretical_pct: costShare(value, net),
    units: round4(units), uncosted_units: round4(uncosted), left_out_units: round4(leftOut), days: days.size,
  }
}

/** Why a theoretical % reads low, in words ('' when nothing does): units without a full recipe, units left out of usage. */
function readsLow(w) {
  const why = []
  if (w.uncosted_units > 0) why.push(plural(Math.round(w.uncosted_units), 'unit') + ' sold without a full recipe')
  if (w.left_out_units > 0) why.push(plural(Math.round(w.left_out_units), 'unit') + ' left out of usage (open items, dishes no longer on a menu)')
  return why.length ? ' (' + why.join(', ') + ', so it reads low)' : ''
}

/**
 * A week's food cost line (Cash Recon's week view, the food cost widget).
 *   week:    daysFoodCost() of the week's trading days
 *   period:  a stock period with its food cost, or null:
 *            { from_at, to_at, status, food_cost: periodVariance()'s food_cost }
 *   covers:  the period holds the whole week (else it is the latest closed one)
 * Actual comes only from the period, and only when its food cost is complete
 * (every item sales used was counted at both ends): never the week's own.
 * -> { theoretical, actual: { pct, theoretical_pct, gap_pts, complete, uncounted_used, covers, period } | null, lines }
 */
export function weekFoodCost({ week = null, period = null, covers = false, currency = 'GBP' } = {}) {
  const w = week || daysFoodCost([])
  const lines = []
  if (!(w.net_food_pence > 0)) {
    lines.push('No food sales worked out for this week yet (usage from sales works the days out as they trade).')
  } else if (w.theoretical_pct == null) {
    lines.push('Net food sales ' + penceWords(w.net_food_pence, currency) + ', but nothing sold has a recipe yet, so there is no theoretical food cost.')
  } else {
    lines.push('Theoretical food cost ' + pct(w.theoretical_pct) + ' of ' + penceWords(w.net_food_pence, currency) + ' net food sales' + readsLow(w) + '.')
  }
  let actual = null
  if (!period) {
    lines.push('No actual food cost: it needs a full stock count at both ends of a period, and no stock period covers this week or has been closed yet.')
  } else {
    const fc = period.food_cost || {}
    const words = periodWords(period)
    const complete = !!fc.complete && fc.actual_pct != null
    actual = {
      pct: complete ? fc.actual_pct : null, theoretical_pct: fc.theoretical_pct ?? null, gap_pts: complete ? fc.gap_pts ?? null : null,
      complete, uncounted_used: num(fc.uncounted_used), covers: !!covers,
      period: { id: period.id ?? null, from_at: period.from_at, to_at: period.to_at, status: period.status, words },
    }
    const missing = !complete
      ? (num(fc.uncounted_used) > 0 ? plural(num(fc.uncounted_used), 'item') + ' sales used weren\'t counted at both ends' : 'its net food sales aren\'t known')
      : null
    if (covers) {
      lines.push(complete
        ? 'Actual ' + pct(fc.actual_pct) + ' against theoretical ' + pct(fc.theoretical_pct) + ' for the stock period ' + words +
          ', which covers this week: actual is known only between two full counts, so this is the period\'s figure, not the week\'s.'
        : 'The stock period ' + words + ' covers this week, but its actual food cost isn\'t known yet: ' + missing + '.')
    } else {
      lines.push('No stock period covers this week (actual needs a full count at both ends). ' + (complete
        ? 'The latest closed period, ' + words + ', had actual ' + pct(fc.actual_pct) + ' against theoretical ' + pct(fc.theoretical_pct) + '.'
        : 'The latest closed period, ' + words + ', has no actual food cost: ' + missing + '.'))
    }
  }
  return { theoretical: w, actual, lines }
}

/**
 * Dishes over their cost target, from dishMargin() rows (menuMargins() of
 * each live menu at each order type, as the report work dish_margins walks
 * them), each carrying menu_id, menu, order_type_id and order_type. A dish
 * counts at its worst order type (a meal deal at its highest cost %), over
 * when its band is watch (over the target) or over (over the limit).
 * Dearest first. -> [{ dish_id, name, menu_id, menu, section, cost_pct, band,
 *                      target_pct, limit_pct, order_type_id, order_type, coverage }]
 */
export function overTarget(rows = []) {
  const worst = new Map()
  for (const r of rows || []) {
    if (r.band !== 'watch' && r.band !== 'over') continue
    const p = r.kind === 'deal' ? r.cost_pct_max : r.cost_pct
    if (p == null) continue
    const key = r.dish_id || (r.menu_id + ':' + r.name)
    const was = worst.get(key)
    if (!was || p > was.cost_pct) {
      worst.set(key, {
        dish_id: r.dish_id ?? null, name: r.name, menu_id: r.menu_id ?? null, menu: r.menu ?? null, section: r.section ?? null,
        cost_pct: round2(p), band: r.band, target_pct: r.thresholds?.target_pct ?? r.target_pct ?? null,
        limit_pct: r.thresholds?.limit_pct ?? r.limit_pct ?? null,
        order_type_id: r.order_type_id ?? null, order_type: r.order_type ?? null, coverage: r.coverage ?? null,
      })
    }
  }
  return [...worst.values()].sort((a, b) => b.cost_pct - a.cost_pct || String(a.name).localeCompare(String(b.name)))
}

const RANK = { watch: 1, over: 2 }

/**
 * What changed since the last look (the rule trigger "a dish goes over its
 * cost target"): states are the dishes kept as over last time ({ dish_id,
 * band, since, cost_pct }), now is overTarget()'s. A dish newly over, or
 * moved from over the target to over the limit, has crossed (an event of
 * its own); one no longer over is cleared (a later crossing is a new event);
 * the rest are kept with their `since`, and of those the ones whose cost %
 * went up have risen (an event too, but only for a rule with a percentage of
 * its own, which it may just have passed: matches() in shared/rules.js).
 * Every crossed and kept row carries the last look's prev_band and
 * prev_cost_pct (null for a dish new to the states).
 * -> { crossed: [now rows], cleared: [dish ids], kept: [now rows with since], rose: [the kept rows that rose] }
 */
export function targetCrossings(states = [], now = []) {
  const was = new Map((states || []).map(s => [s.dish_id, s]))
  const crossed = []
  const kept = []
  const rose = []
  for (const r of now || []) {
    if (!r.dish_id) continue
    const s = was.get(r.dish_id)
    const prev = { prev_band: s?.band ?? null, prev_cost_pct: s?.cost_pct == null ? null : Number(s.cost_pct) }
    if (!s || (RANK[r.band] || 0) > (RANK[s.band] || 0)) { crossed.push({ ...r, ...prev }); continue }
    const k = { ...r, ...prev, since: s.since }
    kept.push(k)
    if (r.cost_pct != null && prev.prev_cost_pct != null && Number(r.cost_pct) > prev.prev_cost_pct) rose.push(k)
  }
  const here = new Set((now || []).map(r => r.dish_id))
  const cleared = (states || []).filter(s => !here.has(s.dish_id)).map(s => s.dish_id)
  return { crossed, cleared, kept, rose }
}

/**
 * Sold margins by menu (the "margin by menu" widget): dish_cost_days rows
 * with their menu (menu_id, menu; null for a dish whose section is on no
 * menu now), each menu's total by soldMargins(). Biggest net sales first.
 * -> [{ menu_id, menu, qty, net_pence, cost_pence, gp_pence, cost_pct, gp_pct, uncosted_qty, ... }]
 */
export function marginsByMenu(rows = [], settings = null) {
  const by = new Map()
  for (const r of rows || []) {
    const key = r.menu_id || 'none'
    if (!by.has(key)) by.set(key, { menu_id: r.menu_id ?? null, menu: r.menu ?? null, rows: [] })
    by.get(key).rows.push(r)
  }
  return [...by.values()].map(m => ({ menu_id: m.menu_id, menu: m.menu, ...soldMargins(m.rows, settings).total }))
    .filter(m => m.qty > 0 || m.net_pence)
    .sort((a, b) => b.net_pence - a.net_pence || String(a.menu || '').localeCompare(String(b.menu || '')))
}

/**
 * A venue's stock in a line for the Overview tile: what needs doing first
 * (counts to approve, transfers to receive, flagged items to review), then
 * when it was last counted.
 *   row: { last_full_count_at, to_approve, incoming, flagged, unreviewed }
 */
export function overviewWords(row = {}) {
  const out = []
  if (num(row.to_approve)) out.push(plural(num(row.to_approve), 'count') + ' to approve')
  if (num(row.incoming)) out.push(plural(num(row.incoming), 'transfer') + ' to receive')
  if (num(row.unreviewed)) out.push(plural(num(row.unreviewed), 'flagged item') + ' to review')
  if (!row.last_full_count_at) out.push('no full count yet')
  return out.length ? out.join(' · ') : 'Nothing waiting'
}

/**
 * The rule event for a period just closed (variance_over_band), or null when
 * it is inside the band: the venue's unexplained loss over its band (band.over),
 * or items flagged by the item rule. Its key is the period and the moment it
 * was closed: closing it again after a reopen is a new event.
 */
export function varianceEvent(p, frozen, venueName = '') {
  const over = !!frozen.band?.over
  const flagged = Number(frozen.flagged) || 0
  if (!over && !flagged) return null
  const top = (frozen.rows || []).find(r => r.flagged && Number(r.unexplained_value) > 0) || (frozen.rows || []).find(r => r.flagged) || null
  const unexplained = frozen.totals?.unexplained_value
  return {
    trigger: 'variance_over_band', key: p.id + ':' + new Date(p.closed_at).getTime(), day: new Date(p.closed_at).toISOString().slice(0, 10),
    venue_id: p.venue_id, venue: venueName || '', period: periodWords(p), flagged,
    unexplained: unexplained == null ? '' : Number(unexplained).toFixed(2), unexplained_value: unexplained == null ? null : Number(unexplained),
    unexplained_pts: frozen.band?.unexplained_pct == null ? '' : String(frozen.band.unexplained_pct),
    band_pts: String(frozen.band?.band_pct ?? frozen.settings?.band_pct ?? ''), top_item: top?.name || '', over_band: over,
  }
}
