// src/services/cardMachines/http.js
//
// What the card machine providers share: the error staff see, one HTTP
// call with a timeout, Stripe's form encoding, card names.

/** A refusal from a provider, worded for staff. 422 so nginx passes it through. */
export class CardMachineError extends Error {
  constructor(message, { code = 'card', status = 422, retry = false } = {}) {
    super(message)
    this.status = status
    this.code = code
    this.retry = retry
  }
}

const TIMEOUT_MS = 20_000

/**
 * One HTTP call to a provider. `form` sends application/x-www-form-urlencoded
 * (Stripe), else JSON. Network trouble throws a CardMachineError with retry:
 * true (the payment may or may not have reached the machine: the caller
 * keeps it pending and asks again).
 */
export async function call(name, base, path, { method = 'GET', headers = {}, body, form, query, auth } = {}) {
  const url = new URL(base.replace(/\/+$/, '') + path)
  for (const [k, v] of Object.entries(query || {})) {
    if (Array.isArray(v)) v.forEach(x => url.searchParams.append(k, x))
    else if (v != null) url.searchParams.set(k, v)
  }
  const h = { Accept: 'application/json', ...headers }
  if (auth) h.Authorization = auth
  let data
  if (form) { h['Content-Type'] = 'application/x-www-form-urlencoded'; data = formEncode(form) }
  else if (body !== undefined) { h['Content-Type'] = 'application/json'; data = JSON.stringify(body) }
  let res
  try {
    res = await fetch(url, { method, headers: h, body: data, signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch {
    throw new CardMachineError(name + ' can\'t be reached just now', { code: 'unreachable', retry: true })
  }
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { json = null }
  if (res.status === 401 || res.status === 403) {
    throw new CardMachineError(name + ' refused the key: check it in Store tech, Card machines', { code: 'auth' })
  }
  if (res.status === 429) throw new CardMachineError(name + ' is limiting requests: try again in a moment', { code: 'busy', retry: true })
  if (res.status >= 500) throw new CardMachineError(name + ' had a problem (' + res.status + '): try again', { code: 'provider', retry: true })
  return { status: res.status, ok: res.ok, json, text }
}

/** Stripe's form encoding: nested objects as a[b]=, arrays as a[]= . */
export function formEncode(obj, prefix = '') {
  const out = []
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue
    const key = prefix ? prefix + '[' + k + ']' : k
    if (Array.isArray(v)) v.forEach(x => out.push(encodeURIComponent(key + '[]') + '=' + encodeURIComponent(x)))
    else if (typeof v === 'object') out.push(formEncode(v, key))
    else out.push(encodeURIComponent(key) + '=' + encodeURIComponent(v))
  }
  return out.filter(Boolean).join('&')
}

/** The first error message a provider put in its reply. */
export function providerMessage(json, fallback) {
  if (!json || typeof json !== 'object') return fallback
  const e = json.error ?? json.errors
  const msg = typeof e === 'string' ? e
    : e?.message || e?.detail || (Array.isArray(e) ? e[0]?.message || e[0]?.detail : null)
      || json.message || json.detail || json.title
  return msg ? String(msg).slice(0, 200) : fallback
}

/** Last four digits from a masked card number or a last4 field. */
export function last4(...values) {
  for (const v of values) {
    const m = /(\d{4})\s*$/.exec(String(v ?? ''))
    if (m) return m[1]
  }
  return null
}

const BRANDS = { visa: 'Visa', mastercard: 'Mastercard', amex: 'Amex', american_express: 'Amex', maestro: 'Maestro', discover: 'Discover', diners: 'Diners', jcb: 'JCB', unionpay: 'UnionPay', interac: 'Interac', vpay: 'V Pay', electron: 'Visa Electron' }

/** A card scheme name for receipts: 'visa' -> 'Visa'. */
export function brandName(v) {
  if (!v) return null
  const k = String(v).toLowerCase().replace(/[\s-]+/g, '_')
  return BRANDS[k] || String(v).slice(0, 20)
}
