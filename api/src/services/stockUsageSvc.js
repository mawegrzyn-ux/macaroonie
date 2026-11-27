// src/services/stockUsageSvc.js
//
// Usage from sales (inventory phase 5, migration 311; docs/INVENTORY.md 7,
// decisions D9 and D10): each venue's trading day of sales broken into the
// items they took off stock, kept in stock_usage_days (per item, with how
// much came from each channel and the cost then) and dish_cost_days (per
// dish, revenue stream, order type and channel: units, sales, net,
// theoretical cost and what couldn't be costed). Stock on hand takes the
// first off (services/stockSvc.js MOVE_SOURCES); Menu margins' Sold tab, the
// reports and Pepper read the second.
//
// The rules:
//   - What was sold is read once, by loadSoldLines() in
//     services/recipeCoverageSvc.js (the same channels coverage reads: till
//     and kiosk on the till's own trading day, online orders on their
//     service date, other tills' receipts through the item mapping, GloriaFood
//     by name; test till sales and voids left out: a void marked wasted is
//     waste by itself). Each sold dish is broken in by usageOf() in
//     shared/costing.js at its venue, revenue stream and order type.
//   - A day is replaced whole, in one transaction (computeDays()).
//   - The job (jobs/stock-usage.js, every few minutes) claims each venue with
//     a lease (stock_usage_venues.running_until, FOR UPDATE SKIP LOCKED), so
//     two API processes never work one venue out at once, and works out again
//     each of the last USAGE_DAYS trading days whose sales changed since (a
//     fingerprint per channel: lines, quantity, the last change, and for other
//     tills how their lines are mapped), or that a recipe, link, option rule
//     or setting marked (dirty_from), or that has never been worked out.
//     Today is worked out too, so on hand takes sales off "up to the last
//     run" (the time shown beside it).
//   - Closed periods never change (D9): isDayClosed() is the hook phase 6
//     fills; until then no day is closed.
//   - Costs are pounds per base unit at the day's last sale: the average paid
//     at the venue over the 90 days before, else the last paid (costLookup()),
//     else the standard price (chooseQuote()); none is a gap, the dish is
//     uncosted.
//
//   USAGE_DAYS, RECOMPUTE_MAX_DAYS, usageHooks, isDayClosed(venueId, day)
//   markUsageDirty(tx, tenantId, { venueIds, from })   a recipe, link, rule or
//                         setting changed: work the open days out again
//   venueToday(tx, tenantId, venueId, now)   the venue's trading day and zone
//   dayFingerprints(tx, tenantId, venueId, from, to, { refunds })
//   computeDays(tx, tenantId, venueId, days, { fingerprints, now })
//   runVenueUsage(tx, tenantId, venueId, { days, force, now })
//   claimVenue(tx, tenantId, venueId) / releaseVenue(...)   a manual Recompute's lease
//   sweepStockUsage(log, { now })   the job

import { systemSql, withSystem, withTenant } from '../config/db.js'
import { usageOf, pickMix, itemCost, COVERAGE_DAYS } from '../../../shared/costing.js'
import { isCombo } from '../../../shared/combos.js'
import { businessDate } from '../../../shared/pos/reports.js'
import { loadSoldLines, loadPickMix, coverageCtx, SOLD_FROM, gloriaDayRows } from './recipeCoverageSvc.js'
import { costLookup, DAY_STARTS_AT } from './stockSvc.js'

export const USAGE_DAYS = 14
export const RECOMPUTE_MAX_DAYS = 31
const LEASE_MINUTES = 10
const CLAIM = 25
// A venue is looked at again after this many minutes (sooner when something marked it).
const AGAIN_MINUTES = 4
const MAX_GAPS = 5

/** Phase 6 fills this: a day inside a closed period is never worked out again (D9). */
export function isDayClosed(venueId, day) { // eslint-disable-line no-unused-vars
  return false
}
// The hooks the run calls (a test can watch them).
export const usageHooks = { isDayClosed }

const DAY = 86400000
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10)
export function daysBetween(from, to) {
  const out = []
  for (let d = from; d <= to && out.length <= 400; d = addDays(d, 1)) out.push(d)
  return out
}
const round4 = n => Math.round(Number(n) * 10000) / 10000
const round6 = n => Math.round(Number(n) * 1e6) / 1e6

/**
 * Mark venues' open days to be worked out again (a recipe, a link, an option
 * rule or a setting changed): from the first day the job looks at (today
 * less USAGE_DAYS) unless `from` says later. venueIds null: every venue of
 * the group. Kept in stock_usage_venues.dirty_from; the next run clears it.
 */
export async function markUsageDirty(tx, tenantId, { venueIds = null, from = null } = {}) {
  const ids = venueIds?.filter(Boolean)
  if (ids && !ids.length) return 0
  const rows = await tx`
    INSERT INTO stock_usage_venues (venue_id, tenant_id, dirty_from, dirty_at)
    SELECT v.id, v.tenant_id, COALESCE(${from}::date, current_date - ${USAGE_DAYS}::int), now()
      FROM venues v
     WHERE v.tenant_id = ${tenantId} ${ids ? tx`AND v.id = ANY(${ids}::uuid[])` : tx``}
    ON CONFLICT (venue_id) DO UPDATE
       SET dirty_from = LEAST(COALESCE(stock_usage_venues.dirty_from, EXCLUDED.dirty_from), EXCLUDED.dirty_from),
           dirty_at = now()
     WHERE stock_usage_venues.tenant_id = ${tenantId}
    RETURNING venue_id`
  return rows.length
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Mark usage for recomputing after every change a route plugin answers (a
 * recipe, a link, an option rule saved or deleted: routes/recipes.js,
 * recipeLinks.js, recipeOptions.js call it), before the answer goes out, so
 * the next run works the open days out again. A change for one venue (a body
 * naming venue_id) marks that venue; anything else every venue of the group.
 * skip: paths whose writes change no recipe (a preview). Never fails the change.
 */
export function marksUsageOnChange(app, { skip = [] } = {}) {
  app.addHook('onSend', async (req, reply, payload) => {
    if (req.method === 'GET' || req.method === 'HEAD' || reply.statusCode >= 300 || !req.tenantId) return payload
    const path = String(req.routeOptions?.url || req.url || '')
    if (skip.some(s => path.endsWith(s))) return payload
    const venue = typeof req.body?.venue_id === 'string' && UUID.test(req.body.venue_id) ? [req.body.venue_id] : null
    await withTenant(req.tenantId, tx => markUsageDirty(tx, req.tenantId, { venueIds: venue }))
      .catch(err => req.log?.warn?.({ err: err?.message }, 'Usage not marked for recomputing'))
    return payload
  })
}

/** The venue's trading day now (its till's day start, else 04:00, in its time zone): { today, timezone, day_starts_at }. */
export async function venueToday(tx, tenantId, venueId, now = new Date()) {
  const [v] = await tx`
    SELECT v.timezone, ps.day_starts_at FROM venues v
      LEFT JOIN pos_settings ps ON ps.venue_id = v.id AND ps.tenant_id = v.tenant_id
     WHERE v.id = ${venueId} AND v.tenant_id = ${tenantId}`
  const timezone = v?.timezone || 'Europe/London'
  const start = v?.day_starts_at || DAY_STARTS_AT
  return { today: businessDate(now, timezone, start), timezone, day_starts_at: start }
}

/**
 * Each day's fingerprint of what sold (from the same channel fragments as
 * the sold lines): per channel the lines, their quantity and the last change;
 * other tills' lines with how they are mapped, GloriaFood's orders. Map day -> text.
 */
export async function dayFingerprints(tx, tenantId, venueId, from, to, { refunds = false } = {}) {
  const v = [venueId]
  const [till, online, imported, gloria] = await Promise.all([
    tx`SELECT d.business_date::text AS day, count(*)::int AS n, sum(l.qty)::float8 AS q, max(c.updated_at) AS t
       ${SOLD_FROM.till(tx, tenantId, v, from, to)} GROUP BY 1`,
    tx`SELECT o.service_date::text AS day, count(*)::int AS n, sum(i.qty)::float8 AS q, max(o.updated_at) AS t
       ${SOLD_FROM.online(tx, tenantId, v, from, to)} GROUP BY 1`,
    tx`SELECT e.business_date::text AS day, count(*)::int AS n, sum(l.qty)::float8 AS q, max(e.updated_at) AS t,
              sum((SELECT COALESCE(sum(hashtext(concat_ws('|', p.role, p.item_id, p.option_id, p.combo_id, p.qty))), 0)
                     FROM ext_line_parts p WHERE p.line_id = l.id AND p.tenant_id = l.tenant_id))::text AS h
       ${SOLD_FROM.imported(tx, tenantId, v, from, to, { refunds })} GROUP BY 1`,
    gloriaDayRows(tx, tenantId, venueId, from, to),
  ])
  const by = new Map()
  const put = (day, k, val) => { if (!by.has(day)) by.set(day, {}); by.get(day)[k] = val }
  const ms = t => (t ? new Date(t).getTime() : 0)
  for (const r of till) put(r.day, 'till', [r.n, round4(r.q), ms(r.t)])
  for (const r of online) put(r.day, 'online', [r.n, round4(r.q), ms(r.t)])
  for (const r of imported) put(r.day, 'imported', [r.n, round4(r.q), ms(r.t), r.h])
  const g = new Map()
  for (const r of gloria) {
    const e = g.get(r.day) || [0, 0]
    g.set(r.day, [e[0] + 1, Math.max(e[1], ms(r.updated_at))])
  }
  for (const [day, val] of g) put(day, 'gloriafood', val)
  const out = new Map()
  for (const day of daysBetween(from, to)) out.set(day, JSON.stringify({ refunds: !!refunds, ...(by.get(day) || {}) }))
  return out
}

async function loadSettings(tx, tenantId) {
  const [s] = await tx`SELECT refunds_return_stock FROM stock_settings WHERE tenant_id = ${tenantId}`
  return { refunds: !!s?.refunds_return_stock }
}

const gapOf = g => ({ reason: g.reason, text: g.text, fix: g.fix ?? null, ...(g.recipe_id ? { recipe_id: g.recipe_id } : {}), ...(g.option_id ? { option_id: g.option_id } : {}) })
const NO_DISH = {
  open: { reason: 'open', text: 'An open item typed in on the till: not a menu dish, so it has no recipe', fix: null },
  online: { reason: 'open', text: 'An online line with no menu dish: nothing to cost', fix: null },
  map: m => ({ reason: 'map', text: m === 'kept' ? 'Another till\'s line kept as sold, not on a menu dish' : m === 'bucket' ? 'Another till\'s line counted under a section, not on a menu dish' : 'Another till\'s line not mapped to a menu dish', fix: 'Map it to a menu dish on the Item mapping page, then link the dish to its recipe.' }),
  gloriafood: { reason: 'gloriafood', text: 'A GloriaFood order names its dishes only, so no recipe can be found for it', fix: 'GloriaFood orders aren\'t mapped to menu dishes yet: their sales take nothing off stock.' },
}
const NO_COST = name => ({ reason: 'no_cost', text: name + ' has no price here: nothing paid at this venue and no supplier price', fix: 'Add a supplier price for ' + name + ' on the Inventory page, or book a delivery in.' })

/**
 * Work out these days at one venue and replace what was kept for them, in
 * the caller's transaction: stock_usage_days, dish_cost_days and each day's
 * mark (its fingerprint, the lines read, how many couldn't be costed).
 * fingerprints: Map day -> text (dayFingerprints()). Returns { days, lines, items, dishes }.
 */
export async function computeDays(tx, tenantId, venueId, days, { fingerprints = null, settings = null, now = new Date() } = {}) {
  if (!days.length) return { days: 0, lines: 0, items: 0, dishes: 0 }
  const set = settings || await loadSettings(tx, tenantId)
  const want = new Set(days)
  const from = days.reduce((a, b) => (a < b ? a : b))
  const to = days.reduce((a, b) => (a > b ? a : b))
  const [sold, { ctxFor }] = await Promise.all([
    loadSoldLines(tx, tenantId, { venueId, from, to, refunds: set.refunds }),
    coverageCtx(tx, tenantId),
  ])
  const lines = sold.filter(l => want.has(l.day))
  const ctx = ctxFor(venueId)
  // A meal deal sold with no picks (another till's) takes its typical picks: what guests picked in the last 30 days.
  const dealIds = [...new Set(lines.filter(l => l.dish_id && l.picks == null && isCombo(ctx.dishes.get(l.dish_id))).map(l => l.dish_id))]
  if (dealIds.length) {
    ctx.pickMix = pickMix(await loadPickMix(tx, tenantId, dealIds, { from: addDays(to, -COVERAGE_DAYS), to }))
  }

  // Each line broken in; items per day (with each channel's part), dishes per day and scope.
  const usage = new Map() // day|item -> { day, item_id, qty, channels, at }
  const dishes = new Map() // key -> row
  const lastAt = new Map() // day -> the day's last sale
  const counts = new Map() // day -> { lines, uncosted }
  for (const l of lines) {
    const t = l.at ? new Date(l.at) : now
    if (!lastAt.has(l.day) || t > lastAt.get(l.day)) lastAt.set(l.day, t)
    const c = counts.get(l.day) || counts.set(l.day, { lines: 0, uncosted: 0 }).get(l.day)
    c.lines++
    const scope = { venue_id: venueId, revenue_stream_id: l.revenue_stream_id ?? null, order_type_id: l.order_type_id ?? null }
    let u = null
    let gaps = []
    let leftOut = null
    if (!l.dish_id) {
      if (l.channel === 'gloriafood') gaps = [NO_DISH.gloriafood]
      else if (l.channel === 'imported') gaps = [NO_DISH.map(l.mapping)]
      else { leftOut = 'open'; gaps = [l.channel === 'online' ? NO_DISH.online : NO_DISH.open] }
    } else {
      u = usageOf({ dish_id: l.dish_id, qty: l.qty, options: l.options || [], picks: l.picks ?? null }, scope, ctx)
      gaps = u.uncosted.map(gapOf)
      if (u.kind === 'service') leftOut = 'service'
      else if (!ctx.dishes.get(l.dish_id)) leftOut = 'gone'
    }
    if (gaps.length && !leftOut) c.uncosted++
    for (const i of u?.items || []) {
      const k = l.day + '|' + i.item_id
      const row = usage.get(k) || usage.set(k, { day: l.day, item_id: i.item_id, qty: 0, channels: {} }).get(k)
      row.qty += i.qty_base
      row.channels[l.channel] = round4((row.channels[l.channel] || 0) + i.qty_base)
    }
    const dish = l.dish_id ? ctx.dishes.get(l.dish_id) : null
    const key = [l.day, l.channel, l.dish_id || 'name:' + String(l.name).toLowerCase(), scope.revenue_stream_id, scope.order_type_id].join('|')
    const d = dishes.get(key) || dishes.set(key, {
      day: l.day, channel: l.channel, dish_id: l.dish_id ?? null, name: dish?.name || l.name || 'A dish',
      section_id: dish?.section_id ?? null, section: dish?.section ?? null,
      revenue_stream_id: scope.revenue_stream_id, order_type_id: scope.order_type_id,
      recipe_id: u?.recipe?.id ?? null, recipe_name: u?.recipe?.name ?? null,
      qty: 0, sales_pence: 0, net_pence: 0, items: new Map(), uncosted_qty: 0, typical_qty: 0, left_out: leftOut, gaps: [],
    }).get(key)
    d.qty += Number(l.qty) || 0
    d.sales_pence += Number(l.sales_pence) || 0
    d.net_pence += Number(l.net_pence) || 0
    if (!d.recipe_id && u?.recipe) { d.recipe_id = u.recipe.id; d.recipe_name = u.recipe.name }
    for (const i of u?.items || []) d.items.set(i.item_id, (d.items.get(i.item_id) || 0) + i.qty_base)
    if (gaps.length && !leftOut) d.uncosted_qty += Number(l.qty) || 0
    if (u?.typical) d.typical_qty += Number(l.qty) || 0
    for (const g of gaps) if (d.gaps.length < MAX_GAPS && !d.gaps.some(x => x.text === g.text)) d.gaps.push(g)
  }

  // What each item cost at the day's last sale: the average paid there, else the last paid, else the standard price.
  const itemIds = [...new Set([...usage.values()].map(r => r.item_id))]
  const latest = lastAt.size ? new Date(Math.max(...[...lastAt.values()].map(d => d.getTime()))) : now
  const paid = itemIds.length ? await costLookup(tx, tenantId, [venueId], itemIds, latest, { how: true }) : () => null
  const costs = new Map() // day|item -> { per_base, how }
  const costOf = (day, itemId) => {
    const k = day + '|' + itemId
    if (!costs.has(k)) {
      const p = paid(venueId, itemId, lastAt.get(day) || now)
      if (p) costs.set(k, p)
      else {
        const item = ctx.items?.get ? ctx.items.get(itemId) : ctx.items?.[itemId]
        const s = item ? itemCost(item, venueId, ctx, 'standard').per_base : null
        costs.set(k, s == null ? null : { per_base: s, how: 'standard' })
      }
    }
    return costs.get(k)
  }
  const usageRows = [...usage.values()].map(r => ({ ...r, qty: round4(r.qty) })).filter(r => r.qty !== 0).map(r => {
    const c = costOf(r.day, r.item_id)
    return {
      tenant_id: tenantId, venue_id: venueId, day: r.day, item_id: r.item_id, qty_base: r.qty,
      cost_per_base: c?.per_base ?? null, cost_how: c?.how ?? null, channels: r.channels, at: lastAt.get(r.day) || now,
    }
  })
  const dishRows = [...dishes.values()].map(d => {
    let cost = 0
    let missing = false
    for (const [itemId, q] of d.items) {
      const c = costOf(d.day, itemId)
      if (c?.per_base == null) {
        missing = true
        const item = ctx.items?.get ? ctx.items.get(itemId) : null
        const g = NO_COST(item?.name || 'An item')
        if (d.gaps.length < MAX_GAPS && !d.gaps.some(x => x.text === g.text)) d.gaps.push(g)
      } else cost += q * c.per_base
    }
    // An item with no price at all leaves the dish uncosted too.
    if (missing && !d.left_out) d.uncosted_qty = d.qty
    return {
      tenant_id: tenantId, venue_id: venueId, day: d.day, channel: d.channel, dish_id: d.dish_id, name: String(d.name).slice(0, 300),
      section_id: d.section_id, section: d.section, revenue_stream_id: d.revenue_stream_id, order_type_id: d.order_type_id,
      recipe_id: d.recipe_id, recipe_name: d.recipe_name, qty: round4(d.qty), sales_pence: Math.round(d.sales_pence),
      net_pence: Math.round(d.net_pence), cost: d.items.size ? round6(cost) : null, uncosted_qty: round4(d.uncosted_qty),
      typical_qty: round4(d.typical_qty), left_out: d.left_out, gaps: d.gaps,
    }
  })

  // Replaced whole: the days' rows go and come back in this one transaction.
  await tx`DELETE FROM stock_usage_days WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND day = ANY(${days}::date[])`
  await tx`DELETE FROM dish_cost_days WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND day = ANY(${days}::date[])`
  for (let i = 0; i < usageRows.length; i += 500) {
    const chunk = usageRows.slice(i, i + 500).map(r => ({ ...r, channels: tx.json(r.channels) }))
    await tx`INSERT INTO stock_usage_days ${tx(chunk, 'tenant_id', 'venue_id', 'day', 'item_id', 'qty_base', 'cost_per_base', 'cost_how', 'channels', 'at')}`
  }
  for (let i = 0; i < dishRows.length; i += 500) {
    const chunk = dishRows.slice(i, i + 500).map(r => ({ ...r, gaps: tx.json(r.gaps) }))
    await tx`INSERT INTO dish_cost_days ${tx(chunk, 'tenant_id', 'venue_id', 'day', 'channel', 'dish_id', 'name', 'section_id', 'section',
      'revenue_stream_id', 'order_type_id', 'recipe_id', 'recipe_name', 'qty', 'sales_pence', 'net_pence', 'cost', 'uncosted_qty', 'typical_qty', 'left_out', 'gaps')}`
  }
  const fps = fingerprints || await dayFingerprints(tx, tenantId, venueId, from, to, { refunds: set.refunds })
  const marks = days.map(day => ({
    tenant_id: tenantId, venue_id: venueId, day, fingerprint: fps.get(day) || '{}',
    lines: counts.get(day)?.lines || 0, uncosted_lines: counts.get(day)?.uncosted || 0, last_sale_at: lastAt.get(day) || null,
  }))
  await tx`
    INSERT INTO stock_usage_marks ${tx(marks, 'tenant_id', 'venue_id', 'day', 'fingerprint', 'lines', 'uncosted_lines', 'last_sale_at')}
    ON CONFLICT (tenant_id, venue_id, day) DO UPDATE
       SET fingerprint = EXCLUDED.fingerprint, lines = EXCLUDED.lines, uncosted_lines = EXCLUDED.uncosted_lines,
           last_sale_at = EXCLUDED.last_sale_at, computed_at = now()`
  return { days: days.length, lines: lines.length, items: usageRows.length, dishes: dishRows.length }
}

/**
 * One venue's run: the days to work out (asked for, else the last
 * USAGE_DAYS trading days up to today), closed ones left alone, and of the
 * rest those whose sales changed, that were marked, or never worked out
 * (all of them with force). In the caller's transaction.
 */
export async function runVenueUsage(tx, tenantId, venueId, { days = null, force = false, now = new Date(), dirtyFrom = undefined } = {}) {
  const { today } = await venueToday(tx, tenantId, venueId, now)
  const window = (days || daysBetween(addDays(today, -(USAGE_DAYS - 1)), today)).filter(d => d <= today)
  const open = window.filter(d => !usageHooks.isDayClosed(venueId, d))
  if (!open.length) return { venue_id: venueId, today, days: 0, worked: [] }
  const settings = await loadSettings(tx, tenantId)
  const from = open[0], to = open[open.length - 1]
  const [fps, marks, state] = await Promise.all([
    dayFingerprints(tx, tenantId, venueId, from, to, { refunds: settings.refunds }),
    tx`SELECT day::text AS day, fingerprint FROM stock_usage_marks WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND day BETWEEN ${from}::date AND ${to}::date`,
    dirtyFrom !== undefined ? [{ dirty_from: dirtyFrom }] : tx`SELECT dirty_from::text AS dirty_from FROM stock_usage_venues WHERE tenant_id = ${tenantId} AND venue_id = ${venueId}`,
  ])
  const markOf = new Map(marks.map(m => [m.day, m.fingerprint]))
  const dirty = state[0]?.dirty_from || null
  const todo = force ? open : open.filter(d => !markOf.has(d) || markOf.get(d) !== fps.get(d) || (dirty && d >= dirty))
  const r = await computeDays(tx, tenantId, venueId, todo, { fingerprints: fps, settings, now })
  return { venue_id: venueId, today, ...r, worked: todo }
}

/**
 * A manual Recompute's lease on a venue, in the caller's transaction: the
 * venue's row locked and held (null when the job is working it out now).
 */
export async function claimVenue(tx, tenantId, venueId) {
  await tx`
    INSERT INTO stock_usage_venues (venue_id, tenant_id) VALUES (${venueId}, ${tenantId})
    ON CONFLICT (venue_id) DO NOTHING`
  const [row] = await tx`
    UPDATE stock_usage_venues SET running_until = now() + make_interval(mins => ${LEASE_MINUTES})
     WHERE tenant_id = ${tenantId} AND venue_id = ${venueId}
       AND (running_until IS NULL OR running_until < now())
    RETURNING venue_id, dirty_from::text AS dirty_from, extract(epoch FROM dirty_at)::text AS dirty_at`
  return row || null
}

/** A lease let go after a run: when, any error, and the mark cleared when nothing marked it again meanwhile. */
export async function releaseVenue(tx, tenantId, venueId, { error = null, dirtyAt = null, clearDirty = false } = {}) {
  await tx`
    UPDATE stock_usage_venues
       SET running_until = NULL, last_run_at = now(), last_error = ${error ? String(error).slice(0, 500) : null},
           dirty_from = CASE WHEN ${clearDirty} AND extract(epoch FROM dirty_at)::text IS NOT DISTINCT FROM ${dirtyAt}::text THEN NULL ELSE dirty_from END,
           dirty_at = CASE WHEN ${clearDirty} AND extract(epoch FROM dirty_at)::text IS NOT DISTINCT FROM ${dirtyAt}::text THEN NULL ELSE dirty_at END
     WHERE tenant_id = ${tenantId} AND venue_id = ${venueId}`
}

/**
 * The job (jobs/stock-usage.js): every active venue of a group that has
 * recipes gets a row; the ones due (not looked at for AGAIN_MINUTES, or
 * marked) are claimed under FOR UPDATE SKIP LOCKED with a lease, each run in
 * its own transaction in system mode (every query filtered by the venue's
 * group), and let go. { venues, days, failed }.
 */
export async function sweepStockUsage(log = null, { now = new Date(), limit = CLAIM, again = AGAIN_MINUTES } = {}) {
  await systemSql`
    INSERT INTO stock_usage_venues (venue_id, tenant_id)
    SELECT v.id, v.tenant_id FROM venues v
     WHERE v.is_active AND EXISTS (SELECT 1 FROM recipes r WHERE r.tenant_id = v.tenant_id)
    ON CONFLICT (venue_id) DO NOTHING`
  const claimed = await systemSql`
    UPDATE stock_usage_venues s SET running_until = now() + make_interval(mins => ${LEASE_MINUTES})
     WHERE s.venue_id IN (
       SELECT u.venue_id FROM stock_usage_venues u
         JOIN venues v ON v.id = u.venue_id AND v.tenant_id = u.tenant_id AND v.is_active
        WHERE (u.running_until IS NULL OR u.running_until < now())
          AND (u.last_run_at IS NULL OR u.last_run_at <= now() - make_interval(mins => ${again}) OR u.dirty_from IS NOT NULL)
        ORDER BY u.dirty_from IS NULL, u.last_run_at NULLS FIRST
        LIMIT ${limit}
        FOR UPDATE OF u SKIP LOCKED)
    RETURNING s.venue_id, s.tenant_id, s.dirty_from::text AS dirty_from, extract(epoch FROM s.dirty_at)::text AS dirty_at`
  const total = { venues: claimed.length, days: 0, failed: 0, ran: claimed.map(c => c.venue_id) }
  for (const c of claimed) {
    let error = null
    try {
      const r = await withSystem(tx => runVenueUsage(tx, c.tenant_id, c.venue_id, { now, dirtyFrom: c.dirty_from }))
      total.days += r.days
    } catch (err) {
      error = err?.message || String(err)
      total.failed++
      log?.warn?.({ err: error, venueId: c.venue_id, tenantId: c.tenant_id }, 'Stock usage failed for a venue')
    }
    await withSystem(tx => releaseVenue(tx, c.tenant_id, c.venue_id, { error, dirtyAt: c.dirty_at, clearDirty: !error }))
      .catch(err => log?.warn?.({ err: err?.message, venueId: c.venue_id }, 'Stock usage lease not let go'))
  }
  return total
}
