// shared/forecast.js
//
// The forecast and the suggested order (inventory phase 9a, migrations 319
// and 320; docs/INVENTORY.md 9 and 10.4), plain ESM for the API, the admin,
// reports and Pepper. One rule (CLAUDE.md rule 12): the order form's
// Suggest, the stock route Pepper's suggested_order reads and the report on
// how good the suggestions were all go through these functions.
//
// The forecast, first version: what an item uses on a trading day at a venue
// is the average of what usage from sales took off on the same weekday over
// the last FORECAST_WEEKS weeks (stock_usage_days, on the days the usage job
// worked out: stock_usage_marks; a day it worked out with no use of the item
// counts as none), scaled by the covers booked for that day against the
// usual for that weekday by the same point (coversFactor(): booked so far
// against what had been booked as far ahead on each of those weekdays). A
// weekday never worked out in those weeks takes the average day of those
// that were. An item sales took nothing of in those weeks has no history:
// its suggestion is up to its par instead (suggestedOrder()).
//
// The suggested order for an item of a supplier:
//
//   forecast use from now until the delivery after next (today's rest: what
//     is left of today's forecast after what sales took off so far)
//   + the buffer (stock_settings.buffer_pct, BUFFER_PCT_DEFAULT when not set)
//   - on hand (none when never counted)
//   - on order (placed orders arriving before the delivery after next)
//
// in packs of the price it is ordered on, rounded up to the price's minimum
// and steps (packsToPar() and fitQty() in shared/procurement.js: the rule
// Fill to par uses). The day an order arrives is the supplier's next delivery
// (nextDeliveryDate(), with its delivery days, cutoff and days' notice at the
// venue), and the delivery after next is the supplier's delivery day after it.
//
//   FORECAST_WEEKS, BUFFER_PCT_DEFAULT, BUFFER_PCT_MAX, COVERS_MIN_USUAL, COVERS_FACTOR_MIN, COVERS_FACTOR_MAX
//   SUGGEST_BASES, bufferPct(v), bufferProblem(v)
//   historyDays(today, weeks)                    the trading days the forecast looks back over
//   deliveryAfter(settings, date)                the supplier's delivery day after `date`
//   windowDays(today, after)                     the trading days from today up to the delivery after next
//   bookedCovers(bookings, { days, now, weeks }) booked and usual covers by the same point, per day
//   coversFactor({ booked, usual })              the scaling and its words
//   weekdayUsage(history, weekday)               an item's usual use on a weekday
//   hasHistory(history)                          whether sales used the item in those weeks
//   forecastDay({ history, day, covers, used })  one day's forecast
//   forecastUsage({ history, days, unit })       the forecast over a window, with its words
//   suggestedOrder({ forecast, par_base, stock, quote, buffer_pct, unit, after })
//   quantityWords(qty, unit)                     "6.2 kg", "350 g", "12 each"
//
// Quantities are in the item's base unit (g, ml or each); days are trading
// days 'YYYY-MM-DD' (the till's day start, 04:00 when none is set: a day's
// weekday is its trading day's).

import { addDays, weekdayOf, dayText, deliveryDateChoices, packsToPar, parPacks, packLabel, fmtNum } from './procurement.js'

export const FORECAST_WEEKS = 4
export const BUFFER_PCT_DEFAULT = 10
export const BUFFER_PCT_MAX = 200
// Below this many covers booked on average by the same point, there is too little to compare with.
export const COVERS_MIN_USUAL = 4
// The covers scaling is held between half and twice the usual.
export const COVERS_FACTOR_MIN = 0.5
export const COVERS_FACTOR_MAX = 2

export const SUGGEST_BASES = {
  forecast: { label: 'From sales', hint: 'What sales used on the same weekdays over the last four weeks, scaled by covers booked.' },
  par: { label: 'Up to par', hint: 'Sales used none of it in the last four weeks, so the par is the target.' },
  none: { label: 'Not suggested', hint: 'No sales use in the last four weeks and no par on the venue\'s order lists.' },
}

const PLURALS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays']
const DAY = 86400000
const num = v => (v == null || v === '' ? 0 : Number(v))
const round4 = n => Math.round(Number(n) * 10000) / 10000

/** The group's buffer: a number from 0 to BUFFER_PCT_MAX, else the default. */
export function bufferPct(v) {
  const n = Number(v)
  return v != null && v !== '' && Number.isFinite(n) && n >= 0 && n <= BUFFER_PCT_MAX ? n : BUFFER_PCT_DEFAULT
}

/** Why a buffer can't be saved, or null. */
export function bufferProblem(v) {
  const n = Number(v)
  if (v == null || v === '' || !Number.isFinite(n)) return 'Give the buffer as a percentage'
  if (n < 0 || n > BUFFER_PCT_MAX) return `The buffer is from 0 to ${BUFFER_PCT_MAX}%`
  return null
}

/** A quantity in the item's unit, readable: 6234 g -> "6.2 kg", 350 g -> "350 g", 2.25 each -> "2.3 each". */
export function quantityWords(qty, unit) {
  const v = num(qty)
  const one = n => fmtNum(n, 1)
  if (unit === 'g') return Math.abs(v) >= 1000 ? `${one(v / 1000)} kg` : `${fmtNum(v, 0)} g`
  if (unit === 'ml') return Math.abs(v) >= 1000 ? `${one(v / 1000)} l` : `${fmtNum(v, 0)} ml`
  return `${one(v)} each`
}

/** The trading days before `today` the forecast looks back over: weeks x 7 of them, oldest first. */
export function historyDays(today, weeks = FORECAST_WEEKS) {
  const out = []
  for (let i = weeks * 7; i >= 1; i--) out.push(addDays(today, -i))
  return out
}

/**
 * The supplier's delivery day after `date` (the delivery after next when
 * `date` is its next delivery): its next delivery day, any day when it lists
 * none. settings: supplierForVenue()'s ({ delivery_days }).
 */
export function deliveryAfter(settings, date) {
  if (!date) return null
  const days = deliveryDateChoices({ delivery_days: settings?.delivery_days || [], next_delivery: addDays(date, 1) }, 1)
  return days[0] || addDays(date, 1)
}

/** The trading days from `today` up to the day before `after` (at least today). */
export function windowDays(today, after) {
  const out = [today]
  for (let d = addDays(today, 1); after && d < after && out.length < 62; d = addDays(d, 1)) out.push(d)
  return out
}

/**
 * Covers booked per day, and the usual for that weekday by the same point:
 * bookings = [{ day (its trading day), covers, created_at }] (not cancelled);
 * for each day of `days`, booked = every booking for it now, usual = the
 * average over the same weekday each of the last `weeks` weeks before it of
 * what had been booked for that day by the same point before it (created at
 * or before `now` less those weeks), so a day a week off is compared with
 * what was booked a week off before, not with how those days ended.
 * -> Map day -> { booked, usual } (usual null when none of those days had any).
 */
export function bookedCovers(bookings, { days, now, weeks = FORECAST_WEEKS }) {
  const at = new Date(now).getTime()
  const byDay = new Map()
  for (const b of bookings || []) {
    if (!byDay.has(b.day)) byDay.set(b.day, [])
    byDay.get(b.day).push({ covers: num(b.covers), at: new Date(b.created_at).getTime() })
  }
  const out = new Map()
  for (const day of days || []) {
    const booked = (byDay.get(day) || []).reduce((n, b) => n + b.covers, 0)
    let total = 0, any = false
    for (let k = 1; k <= weeks; k++) {
      const past = byDay.get(addDays(day, -7 * k)) || []
      const by = at - 7 * k * DAY
      if (past.length) any = true
      total += past.filter(b => b.at <= by).reduce((n, b) => n + b.covers, 0)
    }
    out.set(day, { booked, usual: any ? round4(total / weeks) : null })
  }
  return out
}

/**
 * How a day's forecast is scaled by covers: booked against the usual by the
 * same point, held between COVERS_FACTOR_MIN and COVERS_FACTOR_MAX. No
 * scaling (factor 1) when the usual is under COVERS_MIN_USUAL (a venue that
 * takes few or no bookings). -> { factor, pct, scaled, held, words }
 */
export function coversFactor(c = {}) {
  const usual = c?.usual == null ? null : Number(c.usual)
  if (usual == null || !(usual >= COVERS_MIN_USUAL)) return { factor: 1, pct: null, scaled: false, held: false, words: null }
  const ratio = num(c.booked) / usual
  const factor = Math.min(COVERS_FACTOR_MAX, Math.max(COVERS_FACTOR_MIN, ratio))
  const pct = Math.round((ratio - 1) * 100)
  const held = factor !== ratio
  let words = pct > 0 ? `${pct}% more covers booked` : pct < 0 ? `${-pct}% fewer covers booked` : 'as many covers booked as usual'
  if (held) words += factor === COVERS_FACTOR_MAX ? ' (counted as twice the usual at most)' : ' (counted as half the usual at least)'
  return { factor: round4(factor), pct, scaled: true, held, words }
}

/**
 * history = { marked: ['YYYY-MM-DD', ...] the days the usage job worked out
 * in the weeks looked back over, usage: { [day]: qty } what sales took off
 * the item on them }.
 */
const markedDays = history => [...new Set(history?.marked || [])]
const usedOn = (history, day) => num(history?.usage?.[day])

/** Whether sales used the item on any day worked out in the weeks looked back over. */
export function hasHistory(history) {
  return markedDays(history).some(d => usedOn(history, d) !== 0)
}

/**
 * An item's usual use on a weekday (0 Sunday to 6 Saturday): the average
 * over the days of that weekday the usage job worked out (none taken off on
 * one is 0), else the average of every day it worked out ('average_day').
 * -> { qty, days, how: 'weekday' | 'average_day' }, or null when it worked out none.
 */
export function weekdayUsage(history, weekday) {
  const marked = markedDays(history)
  if (!marked.length) return null
  const same = marked.filter(d => weekdayOf(d) === weekday)
  const days = same.length ? same : marked
  const qty = days.reduce((n, d) => n + usedOn(history, d), 0) / days.length
  return { qty: round4(qty), days: days.length, how: same.length ? 'weekday' : 'average_day' }
}

/**
 * One trading day's forecast for an item: its weekday's usual use scaled by
 * covers. used: what sales took off so far that day (today), so `rest` is
 * what is left of it to use; later days have used null and rest = qty.
 * -> { day, weekday, usual, how, days_seen, factor, covers_pct, covers_words, qty, used, rest, words } or null.
 */
export function forecastDay({ history, day, covers = null, used = null, unit = 'g', today = false }) {
  const weekday = weekdayOf(day)
  const base = weekdayUsage(history, weekday)
  if (!base) return null
  const f = coversFactor(covers || {})
  const qty = round4(base.qty * f.factor)
  const rest = used == null ? qty : round4(Math.max(0, qty - num(used)))
  const usual = base.how === 'weekday'
    ? `${PLURALS[weekday]} use ${quantityWords(base.qty, unit)}`
    : `no ${PLURALS[weekday]} worked out yet: an average day uses ${quantityWords(base.qty, unit)}`
  const parts = [usual, f.words].filter(Boolean)
  const head = today ? `Today (${dayText(day)})` : dayText(day)
  const tail = used == null
    ? `: ${quantityWords(qty, unit)}`
    : `: ${quantityWords(qty, unit)}, ${quantityWords(used, unit)} used so far, ${quantityWords(rest, unit)} left`
  return {
    day, weekday, usual: base.qty, how: base.how, days_seen: base.days,
    factor: f.factor, covers_pct: f.pct, covers_words: f.words,
    qty, used: used == null ? null : round4(num(used)), rest,
    summary: parts.join('; '),
    words: `${head}: ${parts.join('; ')}${tail}`,
  }
}

/**
 * The forecast over a window of trading days: days = [{ day, covers, used? }]
 * (the first is today, with what sales took off so far). An item with no
 * history (hasHistory()) has none: { has_history: false, total: null }.
 * -> { has_history, total, days: [forecastDay()], summary, words: [] }
 */
export function forecastUsage({ history, days = [], unit = 'g', todayDay = null }) {
  if (!hasHistory(history)) {
    return { has_history: false, total: null, days: [], summary: `Sales used none of it in the last ${FORECAST_WEEKS} weeks`, words: [] }
  }
  const rows = days.map(d => forecastDay({ history, day: d.day, covers: d.covers, used: d.used ?? null, unit, today: d.day === todayDay }))
    .filter(Boolean)
  const total = round4(rows.reduce((n, r) => n + r.rest, 0))
  // The day the summary names: the first whole day, else today.
  const lead = rows.find(r => r.used == null) || rows[0]
  return { has_history: true, total, days: rows, summary: lead?.summary || '', words: rows.map(r => r.words) }
}

/**
 * The suggested order for one item: the forecast to the delivery after next
 * plus the buffer, else (no history) its par, less on hand and on order, in
 * packs of `quote` up to its minimum and steps (packsToPar()).
 * stock = { on_hand (null: never counted), on_order (arriving before `after`) }.
 * -> { basis: 'forecast' | 'par' | 'none', qty (packs, null when none), suggested_base,
 *      forecast_base, buffer_pct, buffer_base, target_base, need_base, on_hand, on_order,
 *      pack_base_qty, raised, summary, words }
 */
export function suggestedOrder({ forecast, par_base = null, stock = {}, quote, buffer_pct = BUFFER_PCT_DEFAULT, unit = 'g', after = null }) {
  const pct = bufferPct(buffer_pct)
  const onHand = stock?.on_hand == null ? null : num(stock.on_hand)
  const onOrder = num(stock?.on_order)
  const q = quantity => quantityWords(quantity, unit)
  const until = after ? ` until ${dayText(after)}, the delivery after next` : ''
  const base = { buffer_pct: pct, on_hand: onHand, on_order: round4(onOrder), forecast_base: forecast?.has_history ? forecast.total : null }
  let basis, target, buffer = 0
  if (forecast?.has_history) {
    basis = 'forecast'
    buffer = round4(num(forecast.total) * pct / 100)
    target = round4(num(forecast.total) + buffer)
  } else if (par_base != null) {
    basis = 'par'
    target = round4(num(par_base))
  } else {
    return {
      ...base, basis: 'none', qty: null, suggested_base: null, buffer_base: null, target_base: null, need_base: null,
      pack_base_qty: quote ? num(quote.pack_base_qty) : null, raised: null,
      summary: `${forecast?.summary || 'No sales history'} and no par: nothing suggested`,
      words: [`${forecast?.summary || 'No sales history'}, and the item has no par on this venue's order lists: nothing is suggested.`],
    }
  }
  const need = round4(target - Math.max(0, onHand ?? 0) - Math.max(0, onOrder))
  const packBase = num(quote?.pack_base_qty)
  const qty = quote && packBase > 0 ? packsToPar(target, quote, { on_hand: onHand, on_order: onOrder }) : null
  const whole = need > 0 && quote ? Math.ceil((parPacks(need, quote) ?? 0) - 1e-9) : 0
  const raised = qty != null && qty > whole
    ? (num(quote.min_qty) > whole ? { kind: 'min', value: num(quote.min_qty) } : { kind: 'step', value: num(quote.order_multiple) })
    : null
  const words = []
  if (basis === 'forecast') {
    words.push(`Forecast ${q(forecast.total)}${until}.`)
    for (const w of forecast.words) words.push(w)
    words.push(`Plus a ${fmtNum(pct, 1)}% buffer: ${q(buffer)}, ${q(target)} in all.`)
  } else {
    words.push(`${forecast?.summary || 'No sales history'}, so the par is the target: ${q(target)}.`)
  }
  words.push(onHand == null ? 'Never counted here: nothing on hand is taken off.' : `On hand ${q(onHand)}.`)
  if (onOrder > 0) words.push(`On order ${q(onOrder)}, arriving before then.`)
  const packs = quote ? `${fmtNum(qty)} x ${quote.pack_label || packLabel(quote)}` : null
  if (need <= 0) words.push('Nothing more needed: on hand and on order cover it.')
  else if (qty != null) {
    words.push(`Needed ${q(need)}: ${packs}${raised ? (raised.kind === 'min' ? `, the minimum of ${fmtNum(raised.value)}` : `, in steps of ${fmtNum(raised.value)}`) : ''}.`)
  }
  const lead = basis === 'forecast' ? `${q(forecast.total)} forecast${after ? ` to ${dayText(after)}` : ''} (${forecast.summary})` : `Up to par ${q(target)} (no sales use in ${FORECAST_WEEKS} weeks)`
  const summary = need <= 0 ? `${lead}: on hand and on order cover it` : `${lead}: ${q(need)} needed${packs ? `, ${packs}` : ''}`
  return {
    ...base, basis, qty, suggested_base: qty == null ? null : round4(qty * packBase),
    buffer_base: buffer, target_base: target, need_base: need, pack_base_qty: packBase || null, raised,
    summary, words,
  }
}
