// shared/pos/discounts.js
//
// Discounts set up in Store tech > Discounts (migration 225, pos_discounts):
// the company's list of discounts the till offers by name (Staff meal 50%,
// NHS 10%, £5 off), each saying whether it needs a manager every time. ONE
// set of rules for the till, the cloud's sequencer, the venue hub and the
// admin. The list reaches the rules in the venue's settings
// (settings.discounts, services/posSvc.js), so all three judge alike.
//
// A discount (settings.discounts[]):
//   { id: uuid, name, kind: 'percent' | 'amount', value: percent | pence,
//     scope: 'any' | 'check' | 'line'   on the whole check, on items, or either
//     needs_manager: bool }
//
// On the till a discount from the list goes on as discount.applied with its
// preset_id, the list's type, value and name (checks.js). Without a manager
// flag anyone signed in may use it (the business set it up; the role's
// discount limit is for discounts typed in). With one, a person who may
// approve does it, or types their PIN for whoever does. A discount typed in
// follows the role's limit, and the venue's "Discounts typed in" switch
// (permissions.js MANAGER_ACTIONS custom_discount).
//
// Pure: no I/O.

export const DISCOUNT_KINDS = ['percent', 'amount']
export const DISCOUNT_SCOPES = ['any', 'check', 'line']
export const DISCOUNTS_MAX = 50
export const DISCOUNT_AMOUNT_MAX = 100_000 // £1,000

const isUuid = v => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)

/** A discount from the database (or anywhere) in its full shape, or null when it can't be one. */
export function normaliseDiscount(x) {
  if (!x || !isUuid(x.id)) return null
  const kind = DISCOUNT_KINDS.includes(x.kind) ? x.kind : null
  const value = Number(x.value)
  if (!kind || !(value > 0)) return null
  if (kind === 'percent' && value > 100) return null
  if (kind === 'amount' && (!Number.isInteger(value) || value > DISCOUNT_AMOUNT_MAX)) return null
  return {
    id: x.id,
    name: String(x.name || '').trim() || 'Discount',
    kind,
    value: kind === 'percent' ? Math.round(value * 100) / 100 : value,
    scope: DISCOUNT_SCOPES.includes(x.scope) ? x.scope : 'any',
    needs_manager: !!x.needs_manager,
  }
}

/** The venue's list (settings.discounts), cleaned. */
export function discountList(settings) {
  return (Array.isArray(settings?.discounts) ? settings.discounts : []).map(normaliseDiscount).filter(Boolean)
}

/** Whether a discount from the list may go on the whole check ('check') or on items ('line'). */
export function fitsScope(preset, scope) {
  return preset.scope === 'any' || preset.scope === scope
}

/**
 * What is wrong with a discount.applied naming `preset` (the event's
 * discount, its scope, type and value), or null when it is the list's own.
 */
export function presetMismatch(preset, d) {
  if (!fitsScope(preset, d.scope)) return preset.scope === 'check' ? 'This discount is for the whole check' : 'This discount is for items, not the whole check'
  if (d.comp || d.type !== preset.kind) return 'This discount was changed: try again'
  const same = preset.kind === 'percent' ? Math.abs(Number(d.value) - preset.value) < 0.005 : Number(d.value) === preset.value
  return same ? null : 'This discount was changed: try again'
}

const pctText = v => String(Math.round((Number(v) || 0) * 100) / 100).replace(/\.0+$/, '')

/** "50%" or "£5.00" (shown beside the discount's name). */
export function discountValueText(p) {
  return p.kind === 'percent' ? pctText(p.value) + '%' : '£' + ((Number(p.value) || 0) / 100).toFixed(2)
}
