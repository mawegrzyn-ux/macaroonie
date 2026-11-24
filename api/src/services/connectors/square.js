// src/services/connectors/square.js
//
// The Square connector (docs/SALES_IMPORT.md 5, sales import phase 5), with
// the same face as connectors/loyverse.js, so the sync
// (services/salesImportSvc.js) runs it unchanged:
//
//   connector({ token, environment })   a client for one Square account, paced
//     .merchant()               { merchant_id, business_name, currency } (the token check)
//     .listLocations()          [{ id, name, currency, timezone }]: active locations
//     .fetchCatalog(since)      [doc]: ITEM, ITEM_VARIATION, MODIFIER_LIST / MODIFIER,
//                               CATEGORY, TAX, DISCOUNT and the locations; changed
//                               since then (deleted ones too), all when null
//     .fetchSales({ from, to, by, locationId, locationIds, cursor })
//                               one page of orders (SearchOrders), COMPLETED and
//                               CANCELED, by 'created' (history) or 'updated'
//                               (catch-up): { docs, cursor }
//     .registerWebhook(url)     { id, signature_key } (a webhook subscription; only
//                               works with a token that may manage the app's
//                               subscriptions, else throws and the address is pasted)
//     .deleteWebhook(id)
//   verifyWebhook({ token, storedHash, signatureKey, rawBody, headers, url })
//   normalise(doc, venue, refs), catalogRows(doc), hashToken(token)
//   OAuth: oauthConfig(), authorizeUrl(), signState() / readState(),
//   obtainToken(), refreshToken(), revokeToken(), prepare(conn, save)
//
// Square API v2 (the Square-Version below): Bearer token, JSON, lists paged by
// `cursor`. Money is { amount, currency } already in the smallest unit
// (pence): moneyPence() in shared/externalSales.js takes it as it is. An
// order line's catalog_object_id is the ITEM_VARIATION sold; the item is the
// variation's parent (refs.variantItem, from the stored catalogue). A return
// is an order of its own whose returns[] name the original
// (source_order_id). Square's developer site couldn't be reached when this
// was written: field names are as remembered from API v2
// (docs/claude/outstanding/cash.md item 47).

import { createHmac, randomBytes } from 'node:crypto'
import { env } from '../../config/env.js'
import { ConnectorError, hashToken, tokenMatches, sameSecret, sleep } from './common.js'
import { moneyPence, toQty, stripPersonal } from '../../../../shared/externalSales.js'
import { businessDate } from '../../../../shared/pos/reports.js'

export { ConnectorError, hashToken }
export const system = 'square'

// Production and sandbox (tests point both at a stand-in).
export const BASE_URLS = {
  production: 'https://connect.squareup.com',
  sandbox:    'https://connect.squareupsandbox.com',
}
export const ENVIRONMENTS = Object.keys(BASE_URLS)
export const SQUARE_VERSION = '2024-10-17'

// Tests set these lower.
export const timing = { paceMs: 250, backoffMs: 2000, maxRetries: 5, timeoutMs: 20000 }

const PAGE = 500
const CATALOG_PAGE = 1000
const MAX_PAGES = 400
// SearchOrders takes at most this many locations at once.
const LOCATIONS_PER_SEARCH = 10

const CATALOG_TYPES = ['ITEM', 'ITEM_VARIATION', 'MODIFIER_LIST', 'MODIFIER', 'CATEGORY', 'TAX', 'DISCOUNT']
const KIND_OF = {
  ITEM: 'item', ITEM_VARIATION: 'variant', MODIFIER_LIST: 'modifier', CATEGORY: 'category', TAX: 'tax', DISCOUNT: 'discount',
}
// The OAuth scopes the sync needs: read only.
export const OAUTH_SCOPES = ['MERCHANT_PROFILE_READ', 'ITEMS_READ', 'ORDERS_READ', 'PAYMENTS_READ']

const TENDER_LABELS = {
  CARD: 'Card', CASH: 'Cash', THIRD_PARTY_CARD: 'Card (other terminal)', SQUARE_GIFT_CARD: 'Gift card',
  NO_SALE: 'No sale', BANK_ACCOUNT: 'Bank account', WALLET: 'Wallet', BUY_NOW_PAY_LATER: 'Buy now pay later',
  SQUARE_ACCOUNT: 'Square account', OTHER: 'Other',
}
const TAX_TYPES = { ADDITIVE: 'ADDED', INCLUSIVE: 'INCLUDED' }

const baseOf = environment => (BASE_URLS[environment] || BASE_URLS.production).replace(/\/+$/, '')
const iso = v => (v ? new Date(v).toISOString() : null)

/** One request to Square, paced, retried on 429. auth: 'Bearer <token>' or 'Client <secret>'. */
function caller(environment, auth, label = 'Square') {
  let lastAt = 0
  return async function call(method, path, { query = {}, body = null } = {}) {
    const url = new URL(baseOf(environment) + path)
    for (const [k, v] of Object.entries(query)) if (v != null && v !== '') url.searchParams.set(k, String(v))
    for (let attempt = 0; ; attempt++) {
      const wait = lastAt + timing.paceMs - Date.now()
      if (wait > 0) await sleep(wait)
      lastAt = Date.now()
      let res
      try {
        res = await fetch(url, {
          method,
          headers: {
            ...(auth ? { authorization: auth } : {}), accept: 'application/json', 'square-version': SQUARE_VERSION,
            ...(body ? { 'content-type': 'application/json' } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(timing.timeoutMs),
        })
      } catch (e) {
        throw new ConnectorError(e?.name === 'TimeoutError' ? label + ' didn\'t answer in time.' : 'Couldn\'t reach ' + label + '.')
      }
      if (res.status === 429) {
        if (attempt >= timing.maxRetries) throw new ConnectorError('Square is limiting requests; the sync carries on later.', { rateLimited: true, status: 429 })
        const after = Number(res.headers.get('retry-after'))
        await sleep(Number.isFinite(after) && after > 0 ? Math.min(after * 1000, 60_000) : timing.backoffMs * 2 ** attempt)
        continue
      }
      let data = null
      try { data = res.status === 204 ? null : await res.json() } catch { data = null }
      if (res.status === 401) {
        throw new ConnectorError('Square rejected the access token. Make a new one (or sign in with Square again) on the Integrations page.', { tokenProblem: true, status: 401 })
      }
      if (res.status === 403) {
        throw new ConnectorError('Square says this token may not do that (' + (data?.errors?.[0]?.code || 'forbidden') + '). Check its permissions.', { tokenProblem: path.startsWith('/v2/') && !path.startsWith('/v2/webhooks'), status: 403 })
      }
      if (res.status === 404) throw new ConnectorError('Square has no ' + path + '.', { status: 404 })
      if (!res.ok) {
        const e = data?.errors?.[0]
        const detail = e?.detail || e?.code || data?.message || ''
        throw new ConnectorError('Square returned an error (' + res.status + ')' + (detail ? ': ' + detail : '') + '.', { status: res.status })
      }
      return data
    }
  }
}

/** A paced client for one Square account. environment: 'production' | 'sandbox'. */
export function connector({ token, environment = 'production' }) {
  const call = caller(environment, 'Bearer ' + token)

  async function searchCatalog(body) {
    const out = []
    let cursor = null
    for (let page = 0; page < MAX_PAGES; page++) {
      const data = await call('POST', '/v2/catalog/search', { body: { ...body, limit: CATALOG_PAGE, ...(cursor ? { cursor } : {}) } })
      out.push(...(Array.isArray(data?.objects) ? data.objects : []))
      cursor = data?.cursor || null
      if (!cursor) return out
    }
    throw new ConnectorError('Too much to read from Square at once.')
  }

  return {
    async merchant() {
      const data = await call('GET', '/v2/merchants/me')
      const m = data?.merchant || {}
      return { merchant_id: m.id || null, business_name: m.business_name || null, currency: m.currency || null }
    },

    async listLocations() {
      const data = await call('GET', '/v2/locations')
      return (data?.locations || []).filter(l => l.status !== 'INACTIVE')
        .map(l => ({ id: l.id, name: l.name || 'Location', currency: l.currency || null, timezone: l.timezone || null }))
    },

    /** Master data changed since `since` (deleted objects too), everything when null. */
    async fetchCatalog(since = null) {
      const body = since
        ? { object_types: CATALOG_TYPES, include_deleted_objects: true, begin_time: iso(since) }
        : { object_types: CATALOG_TYPES, include_deleted_objects: false }
      const objects = await searchCatalog(body)
      // One copy of each object (an item's variations come inside it and on their own).
      const byId = new Map()
      const keep = o => {
        if (!o?.id || !o.type) return
        const was = byId.get(o.id)
        if (!was || String(o.updated_at || '') >= String(was.updated_at || '')) byId.set(o.id, o)
      }
      for (const o of objects) {
        keep(o)
        if (o.type === 'ITEM') for (const v of o.item_data?.variations || []) keep(v)
      }
      // A modifier changed on its own: read its list again, so the list's
      // document (which carries its options) is current.
      const lists = new Set([...byId.values()].filter(o => o.type === 'MODIFIER').map(o => o.modifier_data?.modifier_list_id).filter(Boolean))
      const missing = [...lists].filter(id => !byId.has(id))
      for (let i = 0; i < missing.length; i += 1000) {
        const data = await call('POST', '/v2/catalog/batch-retrieve', { body: { object_ids: missing.slice(i, i + 1000), include_related_objects: false } })
        for (const o of data?.objects || []) keep(o)
      }
      const docs = []
      for (const o of byId.values()) {
        const kind = KIND_OF[o.type]
        if (kind) docs.push(catalogDoc(kind, o))
      }
      // The locations are the stores (short: always in full).
      const locs = await call('GET', '/v2/locations')
      for (const l of locs?.locations || []) {
        docs.push({ kind: 'store', external_id: String(l.id), external_updated_at: l.created_at || null, location_id: null,
          payload: stripPersonal(l, ['business_email', 'address', 'phone_number', 'coordinates', 'website_url',
            'twitter_username', 'instagram_username', 'facebook_url', 'tax_ids', 'description']) })
      }
      return docs
    },

    /**
     * One page of orders, oldest first, for the given locations (Square
     * needs them; at most 10 a search, so more are walked a group at a time
     * inside the cursor). by 'created' reads when orders were made
     * (history), 'updated' what changed (catch-up: completions,
     * cancellations). No location: nothing to read.
     */
    async fetchSales({ from, to = null, by = 'updated', locationId = null, locationIds = null, cursor = null }) {
      const locations = [...new Set(locationIds?.length ? locationIds : locationId ? [locationId] : [])]
      if (!locations.length) return { docs: [], cursor: null }
      const groups = []
      for (let i = 0; i < locations.length; i += LOCATIONS_PER_SEARCH) groups.push(locations.slice(i, i + LOCATIONS_PER_SEARCH))
      let [group, sqCursor] = readCursor(cursor)
      if (group >= groups.length) return { docs: [], cursor: null }
      const field = by === 'created' ? 'created_at' : 'updated_at'
      const data = await call('POST', '/v2/orders/search', { body: {
        location_ids: groups[group],
        limit: PAGE,
        return_entries: false,
        ...(sqCursor ? { cursor: sqCursor } : {}),
        query: {
          filter: {
            state_filter: { states: ['COMPLETED', 'CANCELED'] },
            date_time_filter: { [field]: { ...(from ? { start_at: iso(from) } : {}), ...(to ? { end_at: iso(to) } : {}) } },
          },
          sort: { sort_field: field.toUpperCase(), sort_order: 'ASC' },
        },
      } })
      const orders = Array.isArray(data?.orders) ? data.orders : []
      let next = null
      if (data?.cursor) next = group + ':' + data.cursor
      else if (group + 1 < groups.length) next = (group + 1) + ':'
      return { docs: orders.map(saleDoc), cursor: next }
    },

    async registerWebhook(url) {
      const r = await call('POST', '/v2/webhooks/subscriptions', { body: {
        idempotency_key: randomBytes(16).toString('hex'),
        subscription: {
          name: 'Macaroonie sales', enabled: true, notification_url: url, api_version: SQUARE_VERSION,
          event_types: ['order.created', 'order.updated', 'catalog.version.updated'],
        },
      } })
      const s = r?.subscription
      if (!s?.id) throw new ConnectorError('Square didn\'t give the webhook subscription an id.')
      return { id: s.id, signature_key: s.signature_key || null }
    },

    async deleteWebhook(id) {
      await call('DELETE', '/v2/webhooks/subscriptions/' + encodeURIComponent(id))
    },
  }
}

// "<group>:<square cursor>" (group 0 and no cursor when null).
function readCursor(c) {
  if (!c) return [0, null]
  const m = /^(\d+):(.*)$/s.exec(String(c))
  if (!m) return [0, String(c)]
  return [Number(m[1]), m[2] || null]
}

function catalogDoc(kind, o) {
  return { kind, external_id: String(o.id), external_updated_at: o.updated_at || null, location_id: null, payload: stripPersonal(o) }
}

/**
 * A sale document. Taken out before anything is stored (decision D3): the
 * ticket name (often the guest's), metadata, each fulfilment's details (the
 * recipient's name, phone, email and address, notes), and of a tender's card
 * everything but the brand. The customer is kept as Square's id only.
 */
function saleDoc(o) {
  const payload = stripPersonal(o, ['ticket_name', 'metadata'])
  payload.fulfillments = (payload.fulfillments || []).map(f => ({ uid: f.uid ?? null, type: f.type ?? null, state: f.state ?? null }))
  payload.tenders = (payload.tenders || []).map(t => {
    const { card_details: cd, note, ...rest } = t
    return cd ? { ...rest, card_details: { status: cd.status ?? null, entry_method: cd.entry_method ?? null, card: { card_brand: cd.card?.card_brand ?? null } } } : rest
  })
  payload.line_items = (payload.line_items || []).map(({ metadata, ...l }) => l)
  return { kind: 'sale', external_id: String(o.id), external_updated_at: o.updated_at || o.created_at || null, location_id: o.location_id || null, payload }
}

/**
 * The webhook: the address's token against its hash, then, when the
 * connection has Square's signature key, x-square-hmacsha256-signature =
 * base64(HMAC-SHA256(key, notification URL + raw body)), compared in
 * constant time. url is the address as Square was given it.
 */
export function verifyWebhook({ token, storedHash, signatureKey = null, rawBody = null, headers = {}, url = null }) {
  if (!tokenMatches(token, storedHash)) return false
  if (!signatureKey) return true
  return signatureMatches({ signatureKey, url, rawBody, signature: headers?.['x-square-hmacsha256-signature'] })
}

export function signatureOf({ signatureKey, url, rawBody }) {
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody ?? ''))
  return createHmac('sha256', String(signatureKey)).update(String(url)).update(body).digest('base64')
}

export function signatureMatches({ signatureKey, url, rawBody, signature }) {
  if (!signatureKey || !url || rawBody == null || !signature) return false
  return sameSecret(signatureOf({ signatureKey, url, rawBody }), String(signature))
}

// ── Normalising ─────────────────────────────────────────────────────────────

const m = moneyPence
const sum = (list, f) => (list || []).reduce((n, x) => n + f(x), 0)

function taxRow(t, line, amount) {
  return { line, tax_ref: t?.catalog_object_id || null, name: t?.name || 'Tax', type: TAX_TYPES[t?.type] || t?.type || null,
    rate: t?.percentage != null && t.percentage !== '' ? Number(t.percentage) : null, amount_pence: amount }
}
function discountRow(x, line, amount) {
  return { line, discount_ref: x?.catalog_object_id || null, name: x?.name || 'Discount', type: x?.type || null,
    percentage: x?.percentage != null && x.percentage !== '' ? Number(x.percentage) : null, amount_pence: amount }
}

/**
 * A sale document as our rows: { check, lines, payments, discounts, taxes }.
 * Money is the order's own, in pence (moneyPence), never worked out again.
 * An order with returns and no line items is a refund check linked to the
 * order it returns (source_order_id); its amounts are Square's, as positive
 * figures (dayFiguresFromStored() takes a refund's amounts as positive
 * either way). A cancelled order is kept, flagged. venue: { timezone,
 * day_starts_at }; refs: { variantItem: { variation id: item id },
 * optionGroupName: { modifier id: list name } } from the stored catalogue.
 * A line's net is its gross less its discounts (an added tax is not in it;
 * an included one is, as Loyverse's), its modifiers' money within it.
 */
export function normalise(d, venue, refs = {}) {
  const o = d.payload
  const returns = o.returns || []
  const refund = !(o.line_items || []).length && returns.length > 0
  const at = o.closed_at || o.updated_at || o.created_at
  const fulfilment = (o.fulfillments || [])[0]
  const amounts = refund ? (o.return_amounts || {}) : null
  const lines = [], discounts = [], taxes = []
  const orderTax = new Map((refund ? returns.flatMap(r => r.return_taxes || []) : o.taxes || []).map(t => [t.uid, t]))
  const orderDiscount = new Map((refund ? returns.flatMap(r => r.return_discounts || []) : o.discounts || []).map(x => [x.uid, x]))

  const itemLines = refund ? returns.flatMap(r => r.return_line_items || []) : (o.line_items || [])
  for (const l of itemLines) {
    const qty = toQty(l.quantity)
    const index = lines.length
    const gross = m(refund ? l.gross_return_money : l.gross_sales_money)
    const disc = m(l.total_discount_money)
    const variation = l.catalog_object_id || null
    lines.push({
      external_line_id: l.uid ? String(l.uid) : null,
      parent: null,
      line_kind: 'item',
      item_ref: (variation && refs.variantItem?.[variation]) || null,
      variant_ref: variation,
      option_ref: null,
      sku: (variation && refs.variantSku?.[variation]) || null,
      name: l.name || 'Item',
      variant_name: l.variation_name || null,
      group_name: null,
      prefix: null,
      qty,
      unit_price_pence: m(l.base_price_money),
      gross_pence: gross,
      discount_pence: disc,
      tax_pence: m(l.total_tax_money),
      net_pence: gross - disc,
      cost_pence: null,
      note: l.note || null,
    })
    for (const x of (refund ? l.return_modifiers : l.modifiers) || []) {
      const money = m(x.total_price_money)
      lines.push({
        external_line_id: x.uid ? String(x.uid) : null,
        parent: index,
        line_kind: 'modifier',
        item_ref: null, variant_ref: null,
        option_ref: x.catalog_object_id || null,
        sku: null,
        name: x.name || 'Modifier',
        variant_name: null,
        group_name: (x.catalog_object_id && refs.optionGroupName?.[x.catalog_object_id]) || null,
        prefix: null,
        qty: toQty(Number(x.quantity || 1) * qty),
        unit_price_pence: m(x.base_price_money),
        gross_pence: money, discount_pence: 0, tax_pence: 0, net_pence: money,
        cost_pence: null, note: null,
      })
    }
    for (const a of l.applied_discounts || []) discounts.push(discountRow(orderDiscount.get(a.discount_uid), index, m(a.applied_money)))
    for (const a of l.applied_taxes || []) taxes.push(taxRow(orderTax.get(a.tax_uid), index, m(a.applied_money)))
  }
  // Service charges are charge lines (no parent): their money is in the check's charges.
  const charges = refund ? returns.flatMap(r => r.return_service_charges || []) : (o.service_charges || [])
  for (const s of charges) {
    const money = m(s.applied_money || s.amount_money)
    lines.push({
      external_line_id: s.uid ? String(s.uid) : null, parent: null, line_kind: 'charge',
      item_ref: null, variant_ref: null, option_ref: s.catalog_object_id || null, sku: null,
      name: s.name || 'Service charge', variant_name: null, group_name: null, prefix: null,
      qty: 1, unit_price_pence: money, gross_pence: money, discount_pence: 0, tax_pence: m(s.total_tax_money), net_pence: money,
      cost_pence: null, note: null,
    })
  }
  for (const x of orderDiscount.values()) discounts.push(discountRow(x, null, m(x.applied_money)))
  for (const t of orderTax.values()) taxes.push(taxRow(t, null, m(t.applied_money)))

  const check = {
    external_id: d.external_id,
    number: o.reference_id ? String(o.reference_id) : String(o.id || d.external_id).slice(0, 8),
    kind: refund ? 'refund' : 'sale',
    refund_for: refund ? (returns.find(r => r.source_order_id)?.source_order_id || null) : null,
    business_date: businessDate(at, venue.timezone || 'Europe/London', venue.day_starts_at || '00:00'),
    opened_at: o.created_at || at,
    closed_at: o.closed_at || null,
    cancelled_at: o.state === 'CANCELED' ? (o.updated_at || at) : null,
    source: o.source?.name || null,
    order_type: fulfilment?.type || null,
    device_ref: null,
    employee_ref: null,
    customer_ref: o.customer_id || null,
    location_ref: o.location_id || null,
    gross_pence: sum(lines.filter(l => l.line_kind === 'item'), l => l.gross_pence),
    discount_pence: m(refund ? amounts.discount_money : o.total_discount_money),
    charge_pence: m(refund ? amounts.service_charge_money : o.total_service_charge_money),
    tax_pence: m(refund ? amounts.tax_money : o.total_tax_money),
    tip_pence: m(refund ? amounts.tip_money : o.total_tip_money),
    total_pence: m(refund ? amounts.total_money : o.total_money),
    external_updated_at: d.external_updated_at,
  }

  // Tenders (a tender's amount includes its tip, as Loyverse's payments do).
  // A return order carries its refunds instead, when Square gives them.
  const payments = refund
    ? (o.refunds || []).map(r => ({ payment_type_ref: null, name: 'Refund', type: 'REFUND', amount_pence: m(r.amount_money), card_brand: null, paid_at: r.created_at || null }))
    : (o.tenders || []).filter(t => t.type !== 'NO_SALE').map(t => ({
        payment_type_ref: t.type || null,
        name: TENDER_LABELS[t.type] || t.type || 'Payment',
        type: t.type || null,
        amount_pence: m(t.amount_money),
        card_brand: t.card_details?.card?.card_brand || null,
        paid_at: t.created_at || null,
      }))
  return { check, lines, payments, discounts, taxes }
}

/** A catalogue document (a Square CatalogObject) as ext_catalog rows. */
export function catalogRows(d) {
  const p = d.payload
  const deleted = p.is_deleted ? (p.updated_at || new Date().toISOString()) : null
  const base = { kind: d.kind, external_id: d.external_id, parent_ref: null, sku: null, price_pence: null, category_ref: null, deleted_at: deleted }
  switch (d.kind) {
    case 'item': {
      const it = p.item_data || {}
      const variations = (it.variations || []).filter(v => !v.is_deleted)
      return [{ ...base, name: it.name || 'Item',
        category_ref: it.reporting_category?.id || it.categories?.[0]?.id || it.category_id || null,
        // Named variations (Small, Large) are one axis, "Variation", so an
        // axis rule can map them to one of our option groups value by value.
        attrs: { option1_name: variations.length > 1 ? 'Variation' : null, option2_name: null, option3_name: null,
          modifier_ids: (it.modifier_list_info || []).filter(x => x.enabled !== false).map(x => x.modifier_list_id),
          tax_ids: it.tax_ids || [], product_type: it.product_type || null,
          item_option_ids: (it.item_options || []).map(x => x.item_option_id) } }]
    }
    case 'variant': {
      const v = p.item_variation_data || {}
      return [{ ...base, parent_ref: v.item_id || null, sku: v.sku || null, name: v.name || 'Regular',
        price_pence: v.price_money ? m(v.price_money) : null,
        attrs: { option1_value: v.name || null, option2_value: null, option3_value: null, barcode: v.upc || null,
          pricing_type: v.pricing_type || null,
          stores: (v.location_overrides || []).map(s => ({ store_id: s.location_id, price_pence: s.price_money ? m(s.price_money) : null, available: s.sold_out != null ? !s.sold_out : null })) } }]
    }
    case 'modifier': {
      const l = p.modifier_list_data || {}
      return [
        { ...base, name: l.name || 'Modifier', attrs: { position: l.ordinal ?? null, selection_type: l.selection_type || null } },
        ...(l.modifiers || []).map(x => ({
          ...base, kind: 'modifier_option', external_id: String(x.id), parent_ref: d.external_id,
          deleted_at: x.is_deleted ? (x.updated_at || deleted || new Date().toISOString()) : deleted,
          name: x.modifier_data?.name || 'Option', price_pence: x.modifier_data?.price_money ? m(x.modifier_data.price_money) : null,
          attrs: { position: x.modifier_data?.ordinal ?? null },
        })),
      ]
    }
    case 'category': return [{ ...base, name: p.category_data?.name || 'Category', attrs: {} }]
    case 'tax': return [{ ...base, name: p.tax_data?.name || 'Tax',
      attrs: { type: TAX_TYPES[p.tax_data?.inclusion_type] || p.tax_data?.inclusion_type || null, rate: p.tax_data?.percentage != null ? Number(p.tax_data.percentage) : null } }]
    case 'discount': return [{ ...base, name: p.discount_data?.name || 'Discount',
      price_pence: p.discount_data?.amount_money ? m(p.discount_data.amount_money) : null,
      attrs: { type: p.discount_data?.discount_type || null, percent: p.discount_data?.percentage != null ? Number(p.discount_data.percentage) : null } }]
    case 'store': return [{ ...base, name: p.name || 'Location', attrs: { currency: p.currency || null, timezone: p.timezone || null, status: p.status || null } }]
    default: return [{ ...base, name: p.name || d.kind, attrs: {} }]
  }
}

// ── OAuth (only when SQUARE_APPLICATION_ID and SQUARE_APPLICATION_SECRET are set) ──

/** The app's OAuth settings, or null when Sign in with Square is off. A sandbox app's id starts with "sandbox-". */
export function oauthConfig() {
  const id = env.SQUARE_APPLICATION_ID, secret = env.SQUARE_APPLICATION_SECRET
  if (!id || !secret) return null
  return { applicationId: id, secret, environment: String(id).startsWith('sandbox-') ? 'sandbox' : 'production' }
}

/**
 * Where Square sends the person back (the redirect URL registered on the
 * app): an API route that only renames ?code=&state= to ?square_code=&
 * square_state= on the Integrations page. The admin's Auth0 sign-in takes
 * any page's ?code=&state= as its own callback, so they can't land there.
 */
export const redirectPath = '/api/square/oauth/callback'
export const RETURN_PAGE = '/integrations'

// How long a state is good for.
export const STATE_MINUTES = 15

const b64 = s => Buffer.from(s).toString('base64url')
const stateMac = (secret, body) => createHmac('sha256', String(secret)).update('square-oauth:' + body).digest('base64url')

/** A state tied to the tenant and the person, signed with the app's secret. */
export function signState({ tenantId, userSub, name }, cfg = oauthConfig(), now = Date.now()) {
  const body = b64(JSON.stringify({ t: tenantId, u: userSub, n: name || null, e: now + STATE_MINUTES * 60_000, r: randomBytes(9).toString('base64url') }))
  return body + '.' + stateMac(cfg.secret, body)
}

/**
 * A state read back: null when it is not ours (bad signature), expired, or
 * for another tenant or person. Else { tenantId, userSub, name }.
 */
export function readState(state, { tenantId, userSub }, cfg = oauthConfig(), now = Date.now()) {
  if (!cfg || typeof state !== 'string' || state.length > 2000) return null
  const [body, mac, extra] = state.split('.')
  if (!body || !mac || extra !== undefined) return null
  if (!sameSecret(stateMac(cfg.secret, body), mac)) return null
  let v
  try { v = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) } catch { return null }
  if (!v || typeof v.e !== 'number' || v.e < now) return null
  if (v.t !== tenantId || v.u !== userSub) return null
  return { tenantId: v.t, userSub: v.u, name: v.n || null }
}

/** Square's authorize page for this app. */
export function authorizeUrl({ state, redirectUri }, cfg = oauthConfig()) {
  const q = new URLSearchParams({ client_id: cfg.applicationId, scope: OAUTH_SCOPES.join(' '), session: 'false', state, redirect_uri: redirectUri })
  return baseOf(cfg.environment) + '/oauth2/authorize?' + q.toString()
}

function tokenOut(r) {
  if (!r?.access_token) throw new ConnectorError('Square didn\'t give an access token.')
  return { access_token: r.access_token, refresh_token: r.refresh_token || null, expires_at: r.expires_at || null, merchant_id: r.merchant_id || null }
}

/** ObtainToken for the code Square sent back. */
export async function obtainToken({ code, redirectUri }, cfg = oauthConfig()) {
  const call = caller(cfg.environment, null, 'Square sign-in')
  return tokenOut(await call('POST', '/oauth2/token', { body: {
    client_id: cfg.applicationId, client_secret: cfg.secret, code, grant_type: 'authorization_code', redirect_uri: redirectUri,
  } }))
}

/** A new access token from the refresh token. */
export async function refreshToken(refresh, cfg = oauthConfig()) {
  const call = caller(cfg.environment, null, 'Square sign-in')
  return tokenOut(await call('POST', '/oauth2/token', { body: {
    client_id: cfg.applicationId, client_secret: cfg.secret, refresh_token: refresh, grant_type: 'refresh_token',
  } }))
}

/** Gives the access back to the merchant (on disconnect; best effort). */
export async function revokeToken(accessToken, cfg = oauthConfig()) {
  const call = caller(cfg.environment, 'Client ' + cfg.secret, 'Square sign-in')
  await call('POST', '/oauth2/revoke', { body: { client_id: cfg.applicationId, access_token: accessToken } })
}

/** On disconnect: an OAuth connection's grant revoked (a pasted token is the merchant's own to delete). */
export async function revoke(conn) {
  const cfg = oauthConfig()
  if (conn.auth_kind !== 'oauth' || !cfg || !conn.access_token) return false
  await revokeToken(conn.access_token, cfg)
  return true
}

// Refresh an OAuth token this long before it runs out (Square's last 30 days).
export const REFRESH_BEFORE_MS = 7 * 86400_000

/**
 * What the sync's client needs for a connection (`conn` with its tokens
 * already unsealed): an OAuth token due to run out is refreshed first and
 * the new tokens handed to `save` (which seals and stores them).
 */
export async function prepare(conn, save, now = Date.now()) {
  let token = conn.access_token
  const due = conn.auth_kind === 'oauth' && conn.refresh_token && conn.token_expires_at
    && new Date(conn.token_expires_at).getTime() - now < REFRESH_BEFORE_MS
  if (due) {
    const cfg = oauthConfig()
    if (!cfg) throw new ConnectorError('Sign in with Square is switched off on this server, so its token can\'t be renewed. Paste an access token instead.', { tokenProblem: true })
    const t = await refreshToken(conn.refresh_token, cfg)
    await save({ access_token: t.access_token, refresh_token: t.refresh_token || conn.refresh_token, token_expires_at: t.expires_at })
    token = t.access_token
  }
  return { token, environment: conn.environment || 'production' }
}
