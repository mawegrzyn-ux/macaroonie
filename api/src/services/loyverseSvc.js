// src/services/loyverseSvc.js
//
// Loyverse POS (migration 154): the API client, and turning a venue's
// receipts into trading-day figures for Cash Reconciliation. The figure
// maths lives in shared/loyverse.js (also used by the admin).
//
// Loyverse API v1.0: Bearer access token, JSON, money as decimal amounts
// in the account's currency, lists paged with `cursor` (limit up to 250).
// Endpoints used: /merchant, /stores, /payment_types, /categories, /items,
// /receipts. LOYVERSE_API_URL points somewhere else only for tests.

import { env } from '../config/env.js'
import { zonedToUtc } from './orderSvc.js'
import { summariseReceipts, needsCategories } from '../../../shared/loyverse.js'

export class LoyverseError extends Error {
  constructor(message, { tokenProblem = false } = {}) {
    super(message)
    this.status = 422            // 4xx so nginx passes the message through
    this.tokenProblem = tokenProblem
  }
}

const TIMEOUT_MS = 20000
const PAGE = 250
const MAX_PAGES = 200
// Receipts made offline reach Loyverse when the till next syncs, so their
// created_at can be later than the sale: read this much past the window and
// place each receipt by its receipt_date.
const LATE_SYNC_MS = 2 * 24 * 3600 * 1000

async function lvGet(token, path, query = {}) {
  const url = new URL(env.LOYVERSE_API_URL.replace(/\/+$/, '') + path)
  for (const [k, v] of Object.entries(query)) {
    if (v != null && v !== '') url.searchParams.set(k, String(v))
  }
  let res
  try {
    res = await fetch(url, {
      headers: { authorization: 'Bearer ' + token, accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (e) {
    throw new LoyverseError(e?.name === 'TimeoutError'
      ? 'Loyverse didn\'t answer in time. Try again.'
      : 'Couldn\'t reach Loyverse. Try again.')
  }
  if (res.status === 401 || res.status === 403) {
    throw new LoyverseError('Loyverse rejected the access token. Make a new one in Loyverse (Integrations > Access tokens) and save it in Cash reconciliation settings > Loyverse.', { tokenProblem: true })
  }
  if (res.status === 402) {
    throw new LoyverseError('Loyverse says API access isn\'t active on this account. Check the Integrations add-on in Loyverse.', { tokenProblem: true })
  }
  if (res.status === 429) throw new LoyverseError('Loyverse is limiting requests. Wait a minute and try again.')
  if (!res.ok) {
    let detail = ''
    try {
      const body = await res.json()
      const e = body?.errors?.[0]
      detail = e?.details || e?.code || body?.message || ''
    } catch { /* not JSON */ }
    throw new LoyverseError('Loyverse returned an error (' + res.status + ')' + (detail ? ': ' + detail : '') + '.')
  }
  try {
    return await res.json()
  } catch {
    throw new LoyverseError('Loyverse sent an answer that couldn\'t be read.')
  }
}

async function listAll(token, path, key, query = {}) {
  const out = []
  let cursor = null
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await lvGet(token, path, { ...query, limit: PAGE, cursor })
    out.push(...(Array.isArray(data?.[key]) ? data[key] : []))
    cursor = data?.cursor || null
    if (!cursor) return out
  }
  throw new LoyverseError('Too much to read from Loyverse at once. Pick fewer days.')
}

/** Check a token: { merchant_id, business_name, currency }. Throws LoyverseError. */
export async function checkToken(token) {
  const m = await lvGet(token, '/merchant')
  const currency = typeof m?.currency === 'string' ? m.currency : (m?.currency?.code || null)
  return { merchant_id: m?.id || null, business_name: m?.business_name || null, currency }
}

export const tokenHint = token => String(token).slice(-4)

const live = r => r && !r.deleted_at

/** What the mapping editor picks from: stores, payment types, categories, items. */
export async function loadCatalog(token) {
  const [stores, paymentTypes, categories, items] = await Promise.all([
    listAll(token, '/stores', 'stores'),
    listAll(token, '/payment_types', 'payment_types'),
    listAll(token, '/categories', 'categories'),
    listAll(token, '/items', 'items'),
  ])
  const byName = (a, b) => a.name.localeCompare(b.name)
  return {
    stores:        stores.filter(live).map(s => ({ id: s.id, name: s.name || 'Store' })).sort(byName),
    payment_types: paymentTypes.filter(live).map(p => ({ id: p.id, name: p.name || 'Payment', type: p.type || null })).sort(byName),
    categories:    categories.filter(live).map(c => ({ id: c.id, name: c.name || 'Category' })).sort(byName),
    items:         items.filter(live).map(i => ({ id: i.id, name: i.item_name || 'Item', category_id: i.category_id || null })).sort(byName),
  }
}

/** The stores on an account (link editor). */
export async function loadStores(token) {
  const stores = await listAll(token, '/stores', 'stores')
  return stores.filter(live).map(s => ({ id: s.id, name: s.name || 'Store' }))
}

function nextDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/** Every 'YYYY-MM-DD' from `from` to `to` inclusive. */
export function datesBetween(from, to) {
  const out = []
  for (let d = from; d <= to && out.length < 400; d = nextDate(d)) out.push(d)
  return out
}

/** A trading day in UTC: [day_starts_at on the date, day_starts_at the next day), venue time. */
export function tradingDay(dateStr, tz, dayStartsAt = '00:00') {
  return {
    start: zonedToUtc(dateStr, dayStartsAt, tz),
    end:   zonedToUtc(nextDate(dateStr), dayStartsAt, tz),
  }
}

/**
 * Day figures for each date (consecutive 'YYYY-MM-DD', oldest first) from
 * one store: { [date]: figures } (see summariseReceipts()). One receipts
 * read covers every date.
 */
export async function venueDays({ token, storeId, timezone, dayStartsAt, dates, mappings }) {
  const windows = dates.map(d => ({ date: d, ...tradingDay(d, timezone || 'UTC', dayStartsAt) }))
  const first = windows[0].start
  const last  = windows[windows.length - 1].end

  const [receipts, itemCategory] = await Promise.all([
    listAll(token, '/receipts', 'receipts', {
      store_id:       storeId,
      created_at_min: first.toISOString(),
      created_at_max: new Date(last.getTime() + LATE_SYNC_MS).toISOString(),
    }),
    needsCategories(mappings)
      ? listAll(token, '/items', 'items').then(items => Object.fromEntries(items.map(i => [i.id, i.category_id])))
      : Promise.resolve(null),
  ])

  const byDate = Object.fromEntries(dates.map(d => [d, []]))
  for (const r of receipts) {
    if (r.store_id && r.store_id !== storeId) continue
    const at = new Date(r.receipt_date || r.created_at)
    if (isNaN(at.getTime())) continue
    const w = windows.find(x => at >= x.start && at < x.end)
    if (w) byDate[w.date].push(r)
  }
  return Object.fromEntries(dates.map(d => [d, summariseReceipts(byDate[d], itemCategory)]))
}
