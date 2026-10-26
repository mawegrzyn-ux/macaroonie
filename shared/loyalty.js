// shared/loyalty.js
//
// Loyalty (migration 211): the rules the API, the admin, the till, the kiosk,
// the online ordering page and the guest web app share. No I/O.
//
//   normaliseProgramme()  a programme's settings: which features are on,
//                         how points are earned, which channels earn and
//                         redeem, sign-up wording
//   normaliseReward()     a reward: amount off, percent off or a free dish,
//                         bought with points or given by a stamp card
//   normaliseStampCard()  a stamp card: stamps per dish or per visit, how
//                         many fill it, the reward it gives
//   pointsFor()           points for a spend
//   stampsFor()           stamps a sale gives on one card
//   rewardDiscount()      what a reward takes off a basket's lines (online
//                         ordering, through priceBasket's `rewards`)
//   tillDiscount()        the discount a reward makes on a till check
//                         (discount.applied with loyalty_redemption_id)
//   loyaltyNeed() /       the sequencer's check of a check event that
//   loyaltyProblem()      redeems a reward (like shared/pos/cards.js)
//   memberNo() / parseCardCode()  the member number and the card's QR code
//
// Scope: a programme is a tenant's (scope 'tenant', earned and redeemed at
// every venue taking part) or Macaroonie's own network programme (scope
// 'network', tenant_id NULL, members across tenants linked by
// loyalty_identities). Only tenant programmes are built so far; the
// network one exists in the data model and stays switched off.

export const LOYALTY_CHANNELS = ['till', 'kiosk', 'online']
export const CHANNEL_LABELS = { till: 'Tills', kiosk: 'Self-order kiosks', online: 'Online ordering' }

export const FEATURES = [
  { key: 'points',       label: 'Points',               hint: 'Guests earn points on what they spend.' },
  { key: 'stamps',       label: 'Stamp cards',          hint: 'Buy a set number of dishes or visit a set number of times to fill a card.' },
  { key: 'rewards',      label: 'Spend points on rewards', hint: 'Guests swap points for rewards from your list.' },
  { key: 'wallet_apple', label: 'Apple Wallet',         hint: 'The card in Apple Wallet, with its balance kept up to date.' },
  { key: 'wallet_google', label: 'Google Wallet',       hint: 'The card in Google Wallet, with its balance kept up to date.' },
  { key: 'web_app',      label: 'Loyalty web app',      hint: 'Guests join, sign in and see their card at /loyalty on your website.' },
  { key: 'network',      label: 'Macaroonie loyalty',   hint: 'Also take part in the Macaroonie-wide programme (not available yet).' },
]
export const FEATURE_KEYS = FEATURES.map(f => f.key)

export const REWARD_KINDS = [
  { key: 'amount_off',  label: 'Money off' },
  { key: 'percent_off', label: 'Percent off' },
  { key: 'free_item',   label: 'A free dish' },
]
export const REWARD_KIND_KEYS = REWARD_KINDS.map(k => k.key)

export const STAMP_PER = [
  { key: 'item',  label: 'A stamp for each dish' },
  { key: 'visit', label: 'A stamp for each visit' },
]

export const POINTS_MAX_PER_POUND = 1000
export const STAMPS_MAX = 50

const isUuid = v => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
const int = (v, min, max, dflt) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt
}
const optInt = (v, min, max) => (v == null || v === '' ? null : int(v, min, max, null))
const text = (v, max, dflt = '') => (typeof v === 'string' ? v.trim().slice(0, max) : dflt)
const ids = v => [...new Set((Array.isArray(v) ? v : []).filter(isUuid))].slice(0, 500)
const bool = (v, dflt) => (typeof v === 'boolean' ? v : dflt)

export const DEFAULT_TERMS =
  'I agree to join the loyalty programme. My name, email and what I buy are used to keep my points, stamps and rewards. I can leave and delete my account at any time.'
export const DEFAULT_MARKETING =
  'Send me occasional emails with offers and news. Optional. I can unsubscribe at any time.'

/** A programme's settings, every field checked. Unknown keys are dropped. */
export function normaliseProgramme(raw = {}) {
  const r = raw && typeof raw === 'object' ? raw : {}
  const f = r.features && typeof r.features === 'object' ? r.features : {}
  const features = Object.fromEntries(FEATURE_KEYS.map(k => [k, bool(f[k], k === 'points' || k === 'rewards' || k === 'web_app')]))
  const p = r.points && typeof r.points === 'object' ? r.points : {}
  const c = r.channels && typeof r.channels === 'object' ? r.channels : {}
  const channels = Object.fromEntries(LOYALTY_CHANNELS.map(k => {
    const x = c[k] && typeof c[k] === 'object' ? c[k] : {}
    return [k, { earn: bool(x.earn, true), redeem: bool(x.redeem, true) }]
  }))
  const s = r.signup && typeof r.signup === 'object' ? r.signup : {}
  const card = r.card && typeof r.card === 'object' ? r.card : {}
  const hex = v => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null)
  return {
    name: text(r.name, 60) || 'Loyalty',
    points: {
      label: text(p.label, 20) || 'points',
      per_pound: int(p.per_pound, 1, POINTS_MAX_PER_POUND, 1),
      min_spend_pence: int(p.min_spend_pence, 0, 1_000_000, 0),
      welcome: int(p.welcome, 0, 100_000, 0),
      // Points go when a member hasn't earned or spent any for this long.
      expiry_months: optInt(p.expiry_months, 1, 60),
    },
    features,
    channels,
    // Venues taking part: null = every venue.
    venue_ids: Array.isArray(r.venue_ids) ? ids(r.venue_ids) : null,
    signup: {
      ask_phone: bool(s.ask_phone, false),
      terms_text: text(s.terms_text, 600) || DEFAULT_TERMS,
      marketing_text: text(s.marketing_text, 400) || DEFAULT_MARKETING,
      welcome_text: text(s.welcome_text, 300),
    },
    // The card's colours; null = the brand's (tenant_site theme).
    card: { background: hex(card.background), text: hex(card.text), accent: hex(card.accent) },
  }
}

/** Does this channel earn / redeem at this venue? */
export function channelOn(programme, channel, what, venueId = null) {
  const p = programme
  if (!p?.enabled) return false
  if (!LOYALTY_CHANNELS.includes(channel)) return false
  if (!p.settings?.channels?.[channel]?.[what]) return false
  if (venueId && Array.isArray(p.settings.venue_ids) && !p.settings.venue_ids.includes(venueId)) return false
  return true
}

/** A reward, every field checked. */
export function normaliseReward(raw = {}) {
  const r = raw && typeof raw === 'object' ? raw : {}
  const kind = REWARD_KIND_KEYS.includes(r.kind) ? r.kind : 'amount_off'
  return {
    name: text(r.name, 80) || 'Reward',
    description: text(r.description, 400),
    image_url: typeof r.image_url === 'string' && r.image_url.length <= 1000 ? r.image_url : null,
    kind,
    // amount_off: pence; percent_off: 1-100; free_item: the most a free dish takes off (null = its price).
    value: kind === 'percent_off' ? int(r.value, 1, 100, 10)
      : kind === 'amount_off' ? int(r.value, 1, 100_000, 500)
      : optInt(r.value, 1, 100_000),
    item_ids: kind === 'free_item' ? ids(r.item_ids) : [],
    section_ids: kind === 'free_item' ? ids(r.section_ids) : [],
    // null = not on offer for points (only given by stamp cards or staff).
    points_cost: optInt(r.points_cost, 1, 10_000_000),
    min_spend_pence: int(r.min_spend_pence, 0, 1_000_000, 0),
    channels: Array.isArray(r.channels) ? LOYALTY_CHANNELS.filter(c => r.channels.includes(c)) : [...LOYALTY_CHANNELS],
    // A reward a member holds (bought or given) lasts this many days; null = no end.
    valid_days: optInt(r.valid_days, 1, 3650),
    is_active: bool(r.is_active, true),
  }
}

/** Problems that make a reward unusable, in words (empty = fine). */
export function rewardProblems(r) {
  const out = []
  if (r.kind === 'free_item' && !r.item_ids.length && !r.section_ids.length) out.push('Pick the dishes (or sections) that can be free')
  if (!r.channels.length) out.push('Pick at least one place it can be used')
  return out
}

/** A stamp card, every field checked. */
export function normaliseStampCard(raw = {}) {
  const r = raw && typeof raw === 'object' ? raw : {}
  const e = r.earn && typeof r.earn === 'object' ? r.earn : {}
  const per = e.per === 'visit' ? 'visit' : 'item'
  return {
    name: text(r.name, 80) || 'Stamp card',
    description: text(r.description, 300),
    stamps_needed: int(r.stamps_needed, 2, STAMPS_MAX, 8),
    earn: {
      per,
      item_ids: per === 'item' ? ids(e.item_ids) : [],
      section_ids: per === 'item' ? ids(e.section_ids) : [],
      min_spend_pence: int(e.min_spend_pence, 0, 1_000_000, 0),
      // The most stamps one sale gives on this card (null = no cap).
      max_per_sale: optInt(e.max_per_sale, 1, STAMPS_MAX),
    },
    reward_id: isUuid(r.reward_id) ? r.reward_id : null,
    is_active: bool(r.is_active, true),
  }
}

export function stampCardProblems(c) {
  const out = []
  if (!c.reward_id) out.push('Pick the reward a full card gives')
  if (c.earn.per === 'item' && !c.earn.item_ids.length && !c.earn.section_ids.length) out.push('Pick the dishes (or sections) that earn a stamp')
  return out
}

/** Points for a spend (pence, after discounts, without tips or service charge). */
export function pointsFor(spendPence, settings) {
  const s = Math.max(0, Math.round(Number(spendPence) || 0))
  const p = settings?.points || {}
  if (s < (p.min_spend_pence || 0)) return 0
  return Math.floor(s * (Number(p.per_pound) || 0) / 100)
}

const covered = (card, itemId, sectionId) =>
  (itemId && card.earn.item_ids.includes(itemId)) || (sectionId && card.earn.section_ids.includes(sectionId))

/**
 * Stamps one sale gives on a card.
 *   sale  { spend_pence, lines: [{ item_id, section_id, qty, parts: [{ item_id, section_id, qty }] }] }
 * A meal deal counts its parts (a burger meal earns a burger stamp); a dish
 * counts once per unit.
 */
export function stampsFor(card, sale) {
  if (!card?.is_active) return 0
  const spend = Math.max(0, Math.round(Number(sale?.spend_pence) || 0))
  if (spend < card.earn.min_spend_pence) return 0
  let n = 0
  if (card.earn.per === 'visit') n = spend > 0 || (sale?.lines || []).length ? 1 : 0
  else {
    for (const l of sale?.lines || []) {
      const qty = Math.max(0, Math.round(Number(l.qty) || 0))
      if (covered(card, l.item_id, l.section_id)) n += qty
      for (const pt of l.parts || []) if (covered(card, pt.item_id, pt.section_id)) n += qty * Math.max(1, Math.round(Number(pt.qty) || 1))
    }
  }
  return card.earn.max_per_sale ? Math.min(n, card.earn.max_per_sale) : n
}

/** Where a member is on a card: { count (0..needed-1), needed, left }. */
export function stampProgress(card, total) {
  const needed = card?.stamps_needed || 1
  const count = Math.max(0, Math.round(Number(total) || 0)) % needed
  return { count, needed, left: needed - count }
}

// Split `amount` over `weights` in whole pence, the rounding left on the largest.
export function spread(amount, weights) {
  const total = weights.reduce((s, w) => s + Math.max(0, w), 0)
  if (total <= 0 || amount <= 0) return weights.map(() => 0)
  const out = weights.map(w => Math.floor(amount * Math.max(0, w) / total))
  let rest = amount - out.reduce((s, x) => s + x, 0)
  const order = weights.map((w, i) => i).sort((a, b) => weights[b] - weights[a])
  for (let k = 0; rest > 0 && k < order.length * 2; k++) {
    const i = order[k % order.length]
    if (out[i] < weights[i]) { out[i] += 1; rest -= 1 }
  }
  return out
}

const money = p => '£' + ((Number(p) || 0) / 100).toFixed(2)

/** Can this reward go on a free dish line? */
export function rewardCovers(reward, line) {
  return reward.kind === 'free_item'
    && ((line.item_id && reward.item_ids.includes(line.item_id)) || (line.section_id && reward.section_ids.includes(line.section_id)))
}

/**
 * What a reward takes off a basket.
 *   lines  [{ item_id, section_id, qty, left_pence }]  left_pence = what is
 *          left on the line after combos, promotions and earlier rewards
 * Returns { ok: true, discount_pence, lines: [pence per line] } or
 * { ok: false, error }.
 */
export function rewardDiscount(reward, lines) {
  const left = lines.map(l => Math.max(0, Math.round(Number(l.left_pence) || 0)))
  const total = left.reduce((s, x) => s + x, 0)
  if (total <= 0) return { ok: false, error: 'There is nothing left to take ' + reward.name + ' off' }
  if (total < (reward.min_spend_pence || 0)) return { ok: false, error: 'Spend ' + money(reward.min_spend_pence) + ' to use ' + reward.name }
  if (reward.kind === 'amount_off') {
    const amount = Math.min(total, reward.value)
    return { ok: true, discount_pence: amount, lines: spread(amount, left) }
  }
  if (reward.kind === 'percent_off') {
    const amount = Math.min(total, Math.round(total * reward.value / 100))
    return { ok: true, discount_pence: amount, lines: spread(amount, left) }
  }
  // A free dish: one of the cheapest covered dish, up to the reward's cap.
  let best = -1
  let bestUnit = Infinity
  lines.forEach((l, i) => {
    if (!rewardCovers(reward, l) || left[i] <= 0) return
    const unit = left[i] / Math.max(1, Number(l.qty) || 1)
    if (unit < bestUnit) { bestUnit = unit; best = i }
  })
  if (best < 0) return { ok: false, error: 'Add one of the dishes ' + reward.name + ' is for' }
  const amount = Math.min(left[best], Math.round(bestUnit), reward.value || Infinity)
  const out = lines.map(() => 0)
  out[best] = amount
  return { ok: true, discount_pence: amount, lines: out }
}

/**
 * The discount a reward makes on a till check, for discount.applied.
 *   totals  checkTotals(check) (shared/pos/pricing.js): its lines' net
 * Returns { ok: true, discount: { scope, line_ids, type, value, name } } or
 * { ok: false, error }. The till adds id and loyalty_redemption_id.
 */
export function tillDiscount(reward, check, totals) {
  const net = totals?.net ?? 0
  if (net <= 0) return { ok: false, error: 'There is nothing left to take ' + reward.name + ' off' }
  if (net < (reward.min_spend_pence || 0)) return { ok: false, error: 'Spend ' + money(reward.min_spend_pence) + ' to use ' + reward.name }
  const name = reward.name.slice(0, 80)
  if (reward.kind === 'amount_off') return { ok: true, discount: { scope: 'check', line_ids: [], type: 'amount', value: Math.min(net, reward.value), name } }
  if (reward.kind === 'percent_off') return { ok: true, discount: { scope: 'check', line_ids: [], type: 'percent', value: reward.value, name } }
  const byId = Object.fromEntries((check?.lines || []).map(l => [l.id, l]))
  let best = null
  for (const t of totals?.lines || []) {
    const l = byId[t.id]
    if (!l || !rewardCovers(reward, l) || t.net <= 0) continue
    const unit = Math.round(t.net / Math.max(1, l.qty || 1))
    if (!best || unit < best.unit) best = { id: l.id, unit }
  }
  if (!best) return { ok: false, error: 'Add one of the dishes ' + reward.name + ' is for' }
  return { ok: true, discount: { scope: 'line', line_ids: [best.id], type: 'amount', value: Math.min(best.unit, reward.value || Infinity), name } }
}

// ── The sequencer's check (shared/pos/sequencer.js) ─────────────────────────
//
// A discount.applied whose discount names a loyalty_redemption_id spends a
// reward. The redemption (loyalty_redemptions) was reserved by the server
// for this member and venue with the discount it allows; the event may take
// off at most that, once. A store without loadLoyaltyRedemption (the venue
// hub, offline) refuses it.

export function loyaltyNeed(event, checks) {
  if (event.type !== 'discount.applied') return null
  const d = event.payload?.discount
  if (!d?.loyalty_redemption_id) return null
  const c = checks?.[event.check_id]
  return { id: d.loyalty_redemption_id, discount: d, member_id: c?.loyalty?.member_id || null, check: c || null }
}

/** What is wrong with the redemption `row` for this event (null = fine). */
export function loyaltyProblem(event, need, row) {
  if (!row) return 'This reward wasn\'t found: look the member up again'
  if (row.venue_id && event.venue_id && row.venue_id !== event.venue_id) return 'This reward was taken out at another venue'
  if (row.used_event_id && row.used_event_id !== event.id) return 'This reward has already been used'
  if (row.status !== 'reserved' && !(row.status === 'used' && row.used_event_id === event.id)) {
    return row.status === 'released' ? 'This reward was put back: take it out again' : 'This reward can\'t be used now'
  }
  if (!need.member_id) return 'Add the member to the check first'
  if (row.member_id !== need.member_id) return 'This reward belongs to another member'
  if (row.check_id && row.check_id !== event.check_id) return 'This reward was taken out for another check'
  const d = need.discount
  if (d.comp) return 'A reward can\'t be a comp'
  const allowed = row.discount || {}
  if (allowed.type === 'percent') {
    if (d.type !== 'percent' || d.scope !== 'check' || d.value !== allowed.value) return 'The discount doesn\'t match the reward'
    return null
  }
  if (d.type !== 'amount' || !(d.value > 0)) return 'The discount doesn\'t match the reward'
  if (allowed.scope === 'line') {
    if (d.scope !== 'line' || (d.line_ids || []).length !== 1) return 'The discount doesn\'t match the reward'
    const line = (need.check?.lines || []).find(l => l.id === d.line_ids[0])
    if (!line || !rewardCovers({ kind: 'free_item', item_ids: allowed.item_ids || [], section_ids: allowed.section_ids || [] }, line)) {
      return 'The reward isn\'t for this dish'
    }
    const unit = (Number(line.unit_price) || 0) + (line.modifiers || []).reduce((s, m) => s + (Number(m.price) || 0), 0)
    if (d.value > unit) return 'The reward takes off more than the dish costs'
    if (allowed.value && d.value > allowed.value) return 'The reward takes off at most ' + money(allowed.value)
    return null
  }
  if (d.scope !== 'check') return 'The discount doesn\'t match the reward'
  if (d.value > (allowed.value || 0)) return 'The reward takes off at most ' + money(allowed.value)
  return null
}

// ── Member numbers and card codes ───────────────────────────────────────────
//
// A member number is 9 digits: 8 from the member's sequence and a Luhn check
// digit, so a typo is caught before a lookup. The card's QR code carries
// CARD_PREFIX + the card token (random, changed when the member asks); the
// web app's card link ends in /c/<token> too.

export const CARD_PREFIX = 'ML1.'

function luhnDigit(digits) {
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i])
    if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9 }
    sum += d
  }
  return String((10 - (sum % 10)) % 10)
}

export function memberNo(seq) {
  const body = String(Math.max(1, Math.floor(Number(seq) || 1)) % 100_000_000).padStart(8, '0')
  return body + luhnDigit(body)
}

export function validMemberNo(v) {
  const s = String(v || '').replace(/[\s-]/g, '')
  return /^\d{9}$/.test(s) && luhnDigit(s.slice(0, 8)) === s[8]
}

export const formatMemberNo = no => String(no || '').replace(/^(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3')

export const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/

/** What a scanned or typed code is: { token } | { member_no } | null. */
export function parseCardCode(raw) {
  const s = String(raw || '').trim()
  if (!s) return null
  if (s.startsWith(CARD_PREFIX) && TOKEN_RE.test(s.slice(CARD_PREFIX.length))) return { token: s.slice(CARD_PREFIX.length) }
  const url = /\/c\/([A-Za-z0-9_-]{20,64})(?:[?#].*)?$/.exec(s)
  if (url) return { token: url[1] }
  const digits = s.replace(/[\s-]/g, '')
  if (validMemberNo(digits)) return { member_no: digits }
  return null
}

export const cardCode = token => CARD_PREFIX + token

/** "1,250 points" with the programme's word. */
export function pointsText(n, settings) {
  const label = settings?.points?.label || 'points'
  const v = Math.round(Number(n) || 0)
  return v.toLocaleString('en-GB') + ' ' + (v === 1 ? label.replace(/s$/, '') : label)
}

/** A reward in a few words: "£5 off", "10% off", "A free Latte". */
export function rewardSummary(r, names = {}) {
  if (r.kind === 'amount_off') return money(r.value).replace(/\.00$/, '') + ' off'
  if (r.kind === 'percent_off') return r.value + '% off'
  const first = (r.item_ids || []).map(id => names[id]).filter(Boolean)
  if (first.length === 1 && !(r.section_ids || []).length) return 'A free ' + first[0]
  return 'A free dish'
}
