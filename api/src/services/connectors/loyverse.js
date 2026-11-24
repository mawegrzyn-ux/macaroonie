// src/services/connectors/loyverse.js
//
// The Loyverse connector (docs/SALES_IMPORT.md 3.1, phase 1). Every
// connector has the same face, so the sync (services/salesImportSvc.js)
// works for any system:
//
//   connector({ token })        a client for one account, paced
//     .listLocations()          [{ id, name }]: the stores
//     .fetchCatalog(since)      [doc]: master data changed since then (all when null)
//     .fetchSales({ from, to, by, locationId, cursor })
//                               one page of receipts: { docs: [doc], cursor }
//                               by 'created' (history) or 'updated' (catch-up)
//     .registerWebhook(url)     { id } or throws (receipts.update to our address)
//     .deleteWebhook(id)
//   verifyWebhook({ token, storedHash, ... })   the address's token against its hash
//                               (Square also checks a signature over the body)
//   normalise(doc, venue, refs) a sale document as our rows (check, lines, ...);
//                               refs: what the stored catalogue knows (Square
//                               needs a variation's item; Loyverse sends it)
//   catalogRows(doc)            a catalogue document as ext_catalog rows
//   hashToken(token)            the webhook token's sha256 (common.js)
//
// A doc is { kind, external_id, external_updated_at, location_id, payload },
// the payload with personal data already taken out (decision D3,
// stripPersonal()); location_id is a sale's store, which venue it is for.
// The other connector is connectors/square.js.
//
// Loyverse API v1.0: Bearer access token, money as decimals in the account's
// currency, lists paged by `cursor` with `limit` up to 250. The receipt and
// catalogue field names here are the ones services/loyverseSvc.js already
// reads, plus the plan's section 2; Loyverse's documentation site couldn't be
// reached when this was written, so `updated_at_min` on /receipts and
// /items, `show_deleted`, /dining_options and POST /webhooks are as remembered
// from it (docs/claude/outstanding/cash.md item 47). On 429 the client waits
// (Retry-After, else doubling) and tries again; between requests it keeps a
// gap (timing.paceMs), so a history import stays under the limit.

import { env } from '../../config/env.js'
import { ConnectorError, hashToken, tokenMatches, sleep } from './common.js'
import { toPence, toQty, stripPersonal } from '../../../../shared/externalSales.js'
import { businessDate } from '../../../../shared/pos/reports.js'

export const system = 'loyverse'

// Tests set these lower.
export const timing = { paceMs: 300, backoffMs: 2000, maxRetries: 5, timeoutMs: 20000 }

const PAGE = 250
const MAX_PAGES = 400

export { ConnectorError, hashToken }
const live = r => r && !r.deleted_at

/** A paced client for one Loyverse account. */
export function connector({ token }) {
  let lastAt = 0

  async function call(method, path, { query = {}, body = null } = {}) {
    const url = new URL(env.LOYVERSE_API_URL.replace(/\/+$/, '') + path)
    for (const [k, v] of Object.entries(query)) {
      if (v != null && v !== '') url.searchParams.set(k, String(v))
    }
    for (let attempt = 0; ; attempt++) {
      const wait = lastAt + timing.paceMs - Date.now()
      if (wait > 0) await sleep(wait)
      lastAt = Date.now()
      let res
      try {
        res = await fetch(url, {
          method,
          headers: { authorization: 'Bearer ' + token, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(timing.timeoutMs),
        })
      } catch (e) {
        throw new ConnectorError(e?.name === 'TimeoutError' ? 'Loyverse didn\'t answer in time.' : 'Couldn\'t reach Loyverse.')
      }
      if (res.status === 429) {
        if (attempt >= timing.maxRetries) throw new ConnectorError('Loyverse is limiting requests; the sync carries on later.', { rateLimited: true, status: 429 })
        const after = Number(res.headers.get('retry-after'))
        await sleep(Number.isFinite(after) && after > 0 ? Math.min(after * 1000, 60_000) : timing.backoffMs * 2 ** attempt)
        continue
      }
      if (res.status === 401 || res.status === 403) {
        throw new ConnectorError('Loyverse rejected the access token. Make a new one in Loyverse (Integrations > Access tokens) and save it on the Integrations page.', { tokenProblem: true, status: res.status })
      }
      if (res.status === 402) throw new ConnectorError('Loyverse says API access isn\'t active on this account.', { tokenProblem: true, status: 402 })
      if (res.status === 404) throw new ConnectorError('Loyverse has no ' + path + '.', { status: 404 })
      if (!res.ok) {
        let detail = ''
        try { const b = await res.json(); detail = b?.errors?.[0]?.details || b?.errors?.[0]?.code || b?.message || '' } catch { /* not JSON */ }
        throw new ConnectorError('Loyverse returned an error (' + res.status + ')' + (detail ? ': ' + detail : '') + '.', { status: res.status })
      }
      if (res.status === 204) return null
      try { return await res.json() } catch { throw new ConnectorError('Loyverse sent an answer that couldn\'t be read.') }
    }
  }

  async function listAll(path, key, query = {}) {
    const out = []
    let cursor = null
    for (let page = 0; page < MAX_PAGES; page++) {
      const data = await call('GET', path, { query: { ...query, limit: PAGE, cursor } })
      out.push(...(Array.isArray(data?.[key]) ? data[key] : []))
      cursor = data?.cursor || null
      if (!cursor) return out
    }
    throw new ConnectorError('Too much to read from Loyverse at once.')
  }

  return {
    async listLocations() {
      const stores = await listAll('/stores', 'stores')
      return stores.filter(live).map(s => ({ id: s.id, name: s.name || 'Store' }))
    },

    /** Master data. Items and modifiers changed since `since` (all when null); the short lists in full. */
    async fetchCatalog(since = null) {
      const changed = since ? { updated_at_min: new Date(since).toISOString() } : {}
      const docs = []
      const items = await listAll('/items', 'items', { ...changed, show_deleted: true })
      for (const it of items) {
        docs.push(doc('item', it.id, it.updated_at, { ...it, variants: undefined }))
        for (const v of it.variants || []) {
          docs.push(doc('variant', v.variant_id || v.id, v.updated_at || it.updated_at, { ...v, item_id: it.id, deleted_at: v.deleted_at || it.deleted_at || null }))
        }
      }
      for (const m of await listAll('/modifiers', 'modifiers', { ...changed, show_deleted: true })) docs.push(doc('modifier', m.id, m.updated_at, m))
      const lists = [
        ['category', '/categories', 'categories'], ['tax', '/taxes', 'taxes'], ['discount', '/discounts', 'discounts'],
        ['payment_type', '/payment_types', 'payment_types'], ['store', '/stores', 'stores'],
        ['employee', '/employees', 'employees'], ['pos_device', '/pos_devices', 'pos_devices'],
        ['dining_option', '/dining_options', 'dining_options'],
      ]
      for (const [kind, path, key] of lists) {
        let rows
        try { rows = await listAll(path, key, { show_deleted: true }) } catch (e) {
          if (e instanceof ConnectorError && e.upstreamStatus === 404) continue   // not every account has every list
          throw e
        }
        for (const r of rows) docs.push(doc(kind, r.id, r.updated_at, r))
      }
      return docs
    },

    /**
     * One page of receipts, oldest first. by 'created' reads a window of
     * when receipts reached Loyverse (history; a late-synced receipt is
     * placed by its receipt_date when normalised); by 'updated' reads what
     * changed (catch-up: refunds, cancellations).
     */
    async fetchSales({ from, to = null, by = 'updated', locationId = null, cursor = null }) {
      const field = by === 'created' ? 'created_at' : 'updated_at'
      const data = await call('GET', '/receipts', { query: {
        store_id: locationId,
        [field + '_min']: from ? new Date(from).toISOString() : null,
        [field + '_max']: to ? new Date(to).toISOString() : null,
        limit: PAGE, cursor,
      } })
      const receipts = Array.isArray(data?.receipts) ? data.receipts : []
      return { docs: receipts.map(saleDoc), cursor: data?.cursor || null }
    },

    async registerWebhook(url) {
      const r = await call('POST', '/webhooks', { body: { url, type: 'receipts.update', status: 'ENABLED' } })
      if (!r?.id) throw new ConnectorError('Loyverse didn\'t give the webhook an id.')
      return { id: r.id }
    },

    async deleteWebhook(id) {
      await call('DELETE', '/webhooks/' + encodeURIComponent(id))
    },
  }
}

function doc(kind, id, updatedAt, payload) {
  return { kind, external_id: String(id), external_updated_at: updatedAt || null, payload: stripPersonal(payload) }
}

// A receipt's `order` (the ticket name: often a guest's name), its note and
// the card details beside a payment are left out with the customer details.
function saleDoc(r) {
  const payload = stripPersonal(r, ['order', 'note'])
  payload.payments = (payload.payments || []).map(p => {
    const { payment_details: d, ...rest } = p
    return d?.card_company ? { ...rest, payment_details: { card_company: d.card_company } } : rest
  })
  return { kind: 'sale', external_id: String(r.receipt_number), external_updated_at: r.updated_at || r.created_at || null,
    location_id: r.store_id || null, payload }
}

/** The address's token against the stored sha256 (Loyverse signs nothing). */
export function verifyWebhook({ token, storedHash }) {
  return tokenMatches(token, storedHash)
}

const sum = (list, f) => (list || []).reduce((n, x) => n + f(x), 0)

/**
 * A sale document as our rows: { check, lines, payments, discounts, taxes }.
 * Money is the receipt's own, in pence (toPence), never worked out again;
 * a refund receipt's amounts are kept as Loyverse signs them. venue:
 * { timezone, day_starts_at }. Lines are in receipt order; a modifier line
 * names its item line by `parent` (an index into lines) and its money is
 * part of the item line's (Loyverse's line totals include modifiers).
 */
export function normalise(d, venue) {
  const r = d.payload
  const at = r.receipt_date || r.created_at
  const check = {
    external_id: d.external_id,
    number: r.receipt_number != null ? String(r.receipt_number) : null,
    kind: r.receipt_type === 'REFUND' ? 'refund' : 'sale',
    refund_for: r.refund_for ? String(r.refund_for) : null,
    business_date: businessDate(at, venue.timezone || 'Europe/London', venue.day_starts_at || '00:00'),
    opened_at: r.created_at || at,
    closed_at: at,
    cancelled_at: r.cancelled_at || null,
    source: r.source || null,
    order_type: r.dining_option || null,
    device_ref: r.pos_device_id || null,
    employee_ref: r.employee_id || null,
    customer_ref: r.customer_id || null,
    location_ref: r.store_id || null,
    gross_pence: sum(r.line_items, l => toPence(l.gross_total_money)),
    discount_pence: toPence(r.total_discount),
    charge_pence: toPence(r.surcharge),
    tax_pence: toPence(r.total_tax),
    tip_pence: toPence(r.tip),
    total_pence: toPence(r.total_money),
    external_updated_at: d.external_updated_at,
  }

  const lines = [], discounts = [], taxes = []
  for (const l of r.line_items || []) {
    const qty = toQty(l.quantity)
    const index = lines.length
    lines.push({
      external_line_id: l.id ? String(l.id) : null,
      parent: null,
      line_kind: 'item',
      item_ref: l.item_id || null,
      variant_ref: l.variant_id || null,
      option_ref: null,
      sku: l.sku || null,
      name: l.item_name || 'Item',
      variant_name: l.variant_name || null,
      group_name: null,
      prefix: null,
      qty,
      unit_price_pence: toPence(l.price),
      gross_pence: toPence(l.gross_total_money),
      discount_pence: toPence(l.total_discount),
      tax_pence: sum(l.line_taxes, t => toPence(t.money_amount)),
      net_pence: toPence(l.total_money),
      cost_pence: l.cost_total != null ? toPence(l.cost_total) : (l.cost != null ? Math.round(toPence(l.cost) * qty) : null),
      note: l.line_note || null,
    })
    for (const m of l.line_modifiers || []) {
      const money = m.money_amount != null ? toPence(m.money_amount) : Math.round(toPence(m.price) * qty)
      lines.push({
        external_line_id: m.id ? String(m.id) : null,
        parent: index,
        line_kind: 'modifier',
        item_ref: null, variant_ref: null,
        option_ref: m.modifier_option_id || null,
        sku: null,
        name: m.option || m.name || 'Modifier',
        variant_name: null,
        group_name: m.name || null,
        prefix: null,
        qty,
        unit_price_pence: toPence(m.price),
        gross_pence: money, discount_pence: 0, tax_pence: 0, net_pence: money,
        cost_pence: null, note: null,
      })
    }
    for (const x of l.line_discounts || []) {
      discounts.push({ line: index, discount_ref: x.id || null, name: x.name || 'Discount', type: x.type || null,
        percentage: x.percentage ?? null, amount_pence: toPence(x.money_amount) })
    }
    for (const t of l.line_taxes || []) {
      taxes.push({ line: index, tax_ref: t.id || null, name: t.name || 'Tax', type: t.type || null,
        rate: t.rate ?? null, amount_pence: toPence(t.money_amount) })
    }
  }
  for (const x of r.total_discounts || []) {
    discounts.push({ line: null, discount_ref: x.id || null, name: x.name || 'Discount', type: x.type || null,
      percentage: x.percentage ?? null, amount_pence: toPence(x.money_amount) })
  }
  for (const t of r.total_taxes || []) {
    taxes.push({ line: null, tax_ref: t.id || null, name: t.name || 'Tax', type: t.type || null,
      rate: t.rate ?? null, amount_pence: toPence(t.money_amount) })
  }
  const payments = (r.payments || []).map(p => ({
    payment_type_ref: p.payment_type_id || null,
    name: p.name || 'Payment',
    type: p.type || null,
    amount_pence: toPence(p.money_amount),
    card_brand: p.payment_details?.card_company || null,
    paid_at: p.paid_at || null,
  }))
  return { check, lines, payments, discounts, taxes }
}

/** A catalogue document as ext_catalog rows: [{ kind, external_id, parent_ref, name, sku, price_pence, category_ref, attrs, deleted_at }]. */
export function catalogRows(d) {
  const p = d.payload
  const base = { kind: d.kind, external_id: d.external_id, parent_ref: null, sku: null, price_pence: null, category_ref: null, deleted_at: p.deleted_at || null }
  switch (d.kind) {
    case 'item':
      return [{ ...base, name: p.item_name || 'Item', category_ref: p.category_id || null,
        attrs: { option1_name: p.option1_name ?? null, option2_name: p.option2_name ?? null, option3_name: p.option3_name ?? null,
          modifier_ids: p.modifier_ids || [], tax_ids: p.tax_ids || [], track_stock: p.track_stock ?? null } }]
    case 'variant':
      return [{ ...base, parent_ref: p.item_id || null, sku: p.sku || null,
        name: [p.option1_value, p.option2_value, p.option3_value].filter(Boolean).join(' / ') || 'Default',
        price_pence: p.default_price != null ? toPence(p.default_price) : null,
        attrs: { option1_value: p.option1_value ?? null, option2_value: p.option2_value ?? null, option3_value: p.option3_value ?? null,
          barcode: p.barcode ?? null, stores: (p.stores || []).map(s => ({ store_id: s.store_id, price_pence: s.price != null ? toPence(s.price) : null, available: s.available_for_sale ?? null })) } }]
    case 'modifier':
      return [
        { ...base, name: p.name || 'Modifier', attrs: { position: p.position ?? null } },
        ...(p.modifier_options || []).map(o => ({
          ...base, kind: 'modifier_option', external_id: String(o.id), parent_ref: d.external_id,
          name: o.name || 'Option', price_pence: o.price != null ? toPence(o.price) : null, attrs: { position: o.position ?? null },
        })),
      ]
    case 'tax':      return [{ ...base, name: p.name || 'Tax', attrs: { type: p.type ?? null, rate: p.rate ?? null } }]
    case 'discount': return [{ ...base, name: p.name || 'Discount', price_pence: p.discount_amount != null ? toPence(p.discount_amount) : null,
      attrs: { type: p.type ?? null, percent: p.discount_percent ?? null } }]
    case 'payment_type': return [{ ...base, name: p.name || 'Payment', attrs: { type: p.type ?? null } }]
    case 'pos_device':   return [{ ...base, name: p.name || 'Device', parent_ref: p.store_id || null, attrs: {} }]
    case 'employee':     return [{ ...base, name: p.name || 'Employee', attrs: { stores: p.stores || [] } }]
    default:             return [{ ...base, name: p.name || d.kind, attrs: {} }]
  }
}
