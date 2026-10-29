// src/services/loyaltySvc.js
//
// Loyalty (migration 211): the one place members join, points and stamps are
// written, rewards are taken out and put back, and a member's data is
// exported or erased. The rules (what a sale earns, what a reward takes off)
// are shared/loyalty.js; this file only applies them.
//
//   ensureProgramme(tx, tenantId)       the tenant's programme (made on first use)
//   joinMember(tx, ...)                 a new member (or the existing one for that email)
//   memberView() / memberSummary()      what the web app, tills and the admin show
//   addPoints(tx, ...)                  every points change goes through here
//   settleCheck(tenantId, venueId, id)  a till check's points, stamps and rewards,
//   settleOrder(tenantId, orderId)      an online order's, worked out again (idempotent)
//   reserveReward(tx, ...)              take a reward out for a check or an order
//   releaseRedemption(tx, row, why)     put it back (points returned)
//   sweepLoyalty({ log })               the minute sweep: unused reservations,
//                                       sales to settle, points past their expiry
//   requestSignInCode() / verifySignInCode() / sessionMember()  the web app's sign-in
//   exportMember() / eraseMember()      GDPR

import crypto from 'node:crypto'
import { withTenant, systemSql } from '../config/db.js'
import { env } from '../config/env.js'
import { httpError } from '../middleware/error.js'
import {
  normaliseProgramme, normaliseReward, normaliseStampCard, pointsFor, stampsFor, stampProgress,
  memberNo, parseCardCode, cardCode, channelOn, rewardSummary, earnText, LOYALTY_CHANNELS,
} from '../../../shared/loyalty.js'
import { checkTotals, isActiveLine } from '../../../shared/pos/pricing.js'
import { upsertCustomer } from '../routes/customers.js'
import { sendEmail, emailCredentials } from './emailSvc.js'
import { seal, unseal } from './vault.js'
import { makeLink, readLink } from './previewLinks.js'
import { cardColours } from './walletSvc.js'

export const CODE_MINUTES = 15
const MAX_ATTEMPTS = 5
const MAX_CODES_PER_HOUR = 4
export const SESSION_DAYS = 120
const JOIN_TICKET_HOURS = 0.5

const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex')
export const emailHash = email => sha256(String(email || '').trim().toLowerCase())
export const newToken = (bytes = 18) => crypto.randomBytes(bytes).toString('base64url')
const cleanEmail = e => String(e || '').trim().toLowerCase().slice(0, 200)
export const looksLikeEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e || '').trim())

// ── Programme, rewards, stamp cards ─────────────────────────────────────────

export function programmeView(row) {
  if (!row) return null
  return { id: row.id, enabled: !!row.enabled, settings: normaliseProgramme(row.settings), updated_at: row.updated_at }
}

/** The tenant's programme row (made switched off on first use). */
export async function ensureProgramme(tx, tenantId) {
  const [row] = await tx`SELECT * FROM loyalty_programmes WHERE tenant_id = ${tenantId} AND scope = 'tenant'`
  if (row) return programmeView(row)
  await tx`
    INSERT INTO loyalty_programmes (tenant_id, scope, enabled, settings)
    VALUES (${tenantId}, 'tenant', false, ${tx.json(normaliseProgramme({}))})
    ON CONFLICT DO NOTHING`
  const [made] = await tx`SELECT * FROM loyalty_programmes WHERE tenant_id = ${tenantId} AND scope = 'tenant'`
  return programmeView(made)
}

export const rewardView = r => ({ id: r.id, ...normaliseReward(r.data), is_active: !!r.is_active, sort_order: r.sort_order })
export const stampCardView = c => ({ id: c.id, ...normaliseStampCard({ ...c.data, reward_id: c.reward_id }), is_active: !!c.is_active, sort_order: c.sort_order })

export async function loadRewards(tx, tenantId, { activeOnly = false } = {}) {
  const rows = await tx`
    SELECT * FROM loyalty_rewards WHERE tenant_id = ${tenantId} ${activeOnly ? tx`AND is_active` : tx``}
     ORDER BY sort_order, created_at`
  return rows.map(rewardView)
}

export async function loadStampCards(tx, tenantId, { activeOnly = false } = {}) {
  const rows = await tx`
    SELECT * FROM loyalty_stamp_cards WHERE tenant_id = ${tenantId} ${activeOnly ? tx`AND is_active` : tx``}
     ORDER BY sort_order, created_at`
  return rows.map(stampCardView)
}

// ── Members ─────────────────────────────────────────────────────────────────

const MEMBER_COLS = ['id', 'member_no', 'card_token', 'status', 'name', 'email', 'phone', 'points', 'points_earned', 'points_spent',
  'joined_at', 'joined_venue_id', 'joined_channel', 'last_activity_at', 'last_visit_at', 'visits', 'spend_pence',
  'marketing_opt_in', 'marketing_opt_in_at', 'consent', 'notes', 'tags', 'customer_id', 'created_at', 'updated_at']

async function loadMember(tx, tenantId, id, { lock = false } = {}) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return null
  const [m] = lock
    ? await tx`SELECT * FROM loyalty_members WHERE tenant_id = ${tenantId} AND id = ${id} FOR UPDATE`
    : await tx`SELECT * FROM loyalty_members WHERE tenant_id = ${tenantId} AND id = ${id}`
  return m || null
}
export { loadMember }

/** A member found by a scanned / typed card code (shared/loyalty.js parseCardCode). */
export async function memberByCode(tx, tenantId, raw) {
  const code = parseCardCode(raw)
  if (!code) return null
  const [m] = code.token
    ? await tx`SELECT * FROM loyalty_members WHERE tenant_id = ${tenantId} AND card_token = ${code.token} AND status = 'active'`
    : await tx`SELECT * FROM loyalty_members WHERE tenant_id = ${tenantId} AND member_no = ${code.member_no} AND status = 'active'`
  return m || null
}

/** Staff look-up by email, phone, member number or name (a few matches). */
export async function searchMembers(tx, tenantId, q, limit = 8) {
  const s = String(q || '').trim().slice(0, 100)
  if (s.length < 2) return []
  const byCode = await memberByCode(tx, tenantId, s)
  if (byCode) return [byCode]
  const digits = s.replace(/\D/g, '')
  const like = '%' + s.replace(/[%_\\]/g, m => '\\' + m) + '%'
  return tx`
    SELECT * FROM loyalty_members
     WHERE tenant_id = ${tenantId} AND status = 'active'
       AND (email_hash = ${emailHash(s)}
            OR (${digits.length >= 6} AND regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') LIKE ${'%' + digits.slice(-9)})
            OR name ILIKE ${like}
            OR member_no LIKE ${digits.length >= 4 ? digits + '%' : '-'})
     ORDER BY last_activity_at DESC
     LIMIT ${limit}`
}

async function ensureIdentity(tx, hash) {
  const [row] = await tx`
    INSERT INTO loyalty_identities (email_hash) VALUES (${hash})
    ON CONFLICT (email_hash) DO UPDATE SET email_hash = EXCLUDED.email_hash
    RETURNING id`
  return row.id
}

/**
 * A new member, or the active member with that email (returned as is).
 * consent: { terms: true (required), marketing: bool }; the words agreed to
 * are stored with the time.
 */
export async function joinMember(tx, { tenantId, programme, name, email, phone = null, marketing = false, channel = 'web', venueId = null, by = null }) {
  if (!programme?.enabled) throw httpError(422, 'Loyalty isn\'t switched on here')
  const mail = cleanEmail(email)
  if (!looksLikeEmail(mail)) throw httpError(400, 'Enter a valid email address')
  const nm = String(name || '').trim().slice(0, 120)
  if (!nm) throw httpError(400, 'Enter a name')
  const hash = emailHash(mail)
  const [existing] = await tx`SELECT * FROM loyalty_members WHERE tenant_id = ${tenantId} AND email_hash = ${hash}`
  if (existing && existing.status === 'active') return { member: existing, created: false }
  const s = programme.settings
  const [{ member_seq: seq }] = await tx`
    UPDATE loyalty_programmes SET member_seq = member_seq + 1, updated_at = now()
     WHERE id = ${programme.id} AND tenant_id = ${tenantId} RETURNING member_seq`
  const identityId = await ensureIdentity(tx, hash)
  const customerId = await upsertCustomer(tx, tenantId, { name: nm, email: mail, phone: phone || null })
  const now = new Date().toISOString()
  const consent = {
    terms: { text: s.signup.terms_text, at: now },
    marketing: marketing ? { text: s.signup.marketing_text, at: now } : null,
    channel, by: by || null,
  }
  const values = {
    tenant_id: tenantId, programme_id: programme.id, identity_id: identityId, customer_id: customerId,
    member_no: memberNo(Number(seq)), card_token: newToken(), status: 'active',
    name: nm, email: mail, email_hash: hash, phone: phone ? String(phone).trim().slice(0, 30) : null,
    joined_venue_id: venueId, joined_channel: channel,
    marketing_opt_in: !!marketing, marketing_opt_in_at: marketing ? now : null, consent: tx.json(consent),
    wallet_token: seal(newToken(24)),
  }
  let member
  if (existing) {
    // A closed membership comes back (same number, its old points stay gone).
    ;[member] = await tx`
      UPDATE loyalty_members SET ${tx(values, 'identity_id', 'customer_id', 'card_token', 'status', 'name', 'email', 'phone',
        'marketing_opt_in', 'marketing_opt_in_at', 'consent', 'wallet_token')}, joined_at = now(), updated_at = now()
       WHERE id = ${existing.id} AND tenant_id = ${tenantId} RETURNING *`
  } else {
    ;[member] = await tx`INSERT INTO loyalty_members ${tx(values)} RETURNING *`
  }
  if (customerId && marketing) {
    await tx`
      UPDATE customers SET marketing_opt_in = true, marketing_opt_in_at = now(), marketing_opt_in_source = 'loyalty', updated_at = now()
       WHERE id = ${customerId} AND tenant_id = ${tenantId}`
  }
  if (!existing && s.features.points && s.points.welcome > 0) {
    member = await addPoints(tx, member, { kind: 'welcome', points: s.points.welcome, source_kind: 'join', source_id: member.id, venue_id: venueId, channel, note: 'Welcome' })
  }
  return { member, created: true }
}

/**
 * Add (or take) points: a ledger row and the member's balance, together.
 * row: { kind, points, stamps?, stamp_card_id?, source_kind, source_id, venue_id, channel, spend_pence, note, created_by }
 * Returns the member as it is now.
 */
export async function addPoints(tx, member, row) {
  const points = Math.round(Number(row.points) || 0)
  const earned = ['earn', 'welcome', 'adjust'].includes(row.kind) && points > 0 ? points : 0
  const spent = row.kind === 'redeem' ? -points : row.kind === 'release' ? -points : 0
  // Spending can't take the balance below 0 (a sale's points worked out
  // again after a refund can).
  const [m] = await tx`
    UPDATE loyalty_members
       SET points = points + ${points}, points_earned = points_earned + ${earned}, points_spent = points_spent + ${spent},
           last_activity_at = now(), wallet_updated_at = CASE WHEN ${points !== 0 || (row.stamps || 0) !== 0} THEN now() ELSE wallet_updated_at END,
           updated_at = now()
     WHERE id = ${member.id} AND tenant_id = ${member.tenant_id}
       AND (${row.kind !== 'redeem'} OR points + ${points} >= 0)
     RETURNING *`
  if (!m) throw httpError(409, 'Not enough points for this reward')
  await tx`
    INSERT INTO loyalty_ledger (tenant_id, member_id, kind, points, stamps, stamp_card_id, source_kind, source_id, venue_id,
                                channel, spend_pence, note, created_by)
    VALUES (${member.tenant_id}, ${member.id}, ${row.kind}, ${points}, ${row.stamps || 0}, ${row.stamp_card_id || null},
            ${row.source_kind}, ${row.source_id ?? null}, ${row.venue_id || null}, ${row.channel || null},
            ${row.spend_pence ?? null}, ${row.note || null}, ${row.created_by || null})`
  return m
}

/** Stamps on each active card: [{ card, total, count, needed, left }]. */
export async function memberStamps(tx, member, cards) {
  if (!cards.length) return []
  const rows = await tx`
    SELECT stamp_card_id, COALESCE(sum(stamps), 0)::int AS total FROM loyalty_ledger
     WHERE tenant_id = ${member.tenant_id} AND member_id = ${member.id} AND stamp_card_id IS NOT NULL
     GROUP BY stamp_card_id`
  const by = Object.fromEntries(rows.map(r => [r.stamp_card_id, r.total]))
  return cards.map(c => ({ card: c, total: by[c.id] || 0, ...stampProgress(c, Math.max(0, by[c.id] || 0)) }))
}

/** Rewards a member holds (available, not past their date). */
export async function heldRewards(tx, member) {
  return tx`
    SELECT mr.*, r.data, r.is_active
      FROM loyalty_member_rewards mr
      JOIN loyalty_rewards r ON r.id = mr.reward_id AND r.tenant_id = mr.tenant_id
     WHERE mr.tenant_id = ${member.tenant_id} AND mr.member_id = ${member.id}
       AND mr.status = 'available' AND (mr.expires_at IS NULL OR mr.expires_at > now())
     ORDER BY mr.issued_at`
}

/**
 * What a member can spend now on a channel: rewards they hold, and rewards
 * on offer for points (with can_afford). [{ key, reward, member_reward_id, points_cost, can_afford, expires_at }]
 */
export async function spendableRewards(tx, member, programme, channel = null) {
  const s = programme.settings
  const rewards = await loadRewards(tx, member.tenant_id, { activeOnly: true })
  const byId = Object.fromEntries(rewards.map(r => [r.id, r]))
  const out = []
  for (const h of await heldRewards(tx, member)) {
    const r = byId[h.reward_id]
    if (!r || (channel && !r.channels.includes(channel))) continue
    out.push({ key: 'held:' + h.id, reward: r, member_reward_id: h.id, points_cost: null, can_afford: true, expires_at: h.expires_at })
  }
  if (s.features.points && s.features.rewards) {
    for (const r of rewards) {
      if (!r.points_cost || (channel && !r.channels.includes(channel))) continue
      out.push({ key: 'points:' + r.id, reward: r, member_reward_id: null, points_cost: r.points_cost, can_afford: member.points >= r.points_cost, expires_at: null })
    }
  }
  return out
}

/** A member in the shape every screen uses (no card token unless asked). */
export async function memberSummary(tx, member, programme, { channel = null, withToken = false, names = {} } = {}) {
  const cards = programme.settings.features.stamps ? await loadStampCards(tx, member.tenant_id, { activeOnly: true }) : []
  const stamps = await memberStamps(tx, member, cards)
  const rewards = await spendableRewards(tx, member, programme, channel)
  return {
    id: member.id,
    member_no: member.member_no,
    name: member.name,
    email: member.email,
    phone: member.phone,
    status: member.status,
    points: member.points,
    joined_at: member.joined_at,
    marketing_opt_in: member.marketing_opt_in,
    ...(withToken ? { card_code: cardCode(member.card_token) } : {}),
    stamps: stamps.map(x => ({ card_id: x.card.id, name: x.card.name, description: x.card.description, count: x.count, needed: x.needed, reward_id: x.card.reward_id })),
    rewards: rewards.map(x => ({
      key: x.key, reward_id: x.reward.id, member_reward_id: x.member_reward_id, name: x.reward.name, description: x.reward.description,
      image_url: x.reward.image_url, kind: x.reward.kind, value: x.reward.value, summary: rewardSummary(x.reward, names),
      points_cost: x.points_cost, can_afford: x.can_afford, expires_at: x.expires_at, min_spend_pence: x.reward.min_spend_pence,
      item_ids: x.reward.item_ids, section_ids: x.reward.section_ids,
    })),
  }
}

// ── Taking rewards out and putting them back ────────────────────────────────

/** What a reward lets a check or an order take off, stored on the redemption. */
function allowedDiscount(r) {
  if (r.kind === 'percent_off') return { scope: 'check', type: 'percent', value: r.value }
  if (r.kind === 'amount_off') return { scope: 'check', type: 'amount', value: r.value }
  return { scope: 'line', type: 'amount', value: r.value ?? null, item_ids: r.item_ids, section_ids: r.section_ids }
}

/**
 * Take a reward out for a sale: points taken now (or a held reward
 * reserved). want: { reward_id } (bought with points) or { member_reward_id }.
 * where: { channel, venue_id, check_id, order_id, device_id, staff_id }
 */
export async function reserveReward(tx, { member, programme, want, where }) {
  if (!member || member.status !== 'active') throw httpError(404, 'Member not found')
  if (!channelOn(programme, where.channel, 'redeem', where.venue_id)) throw httpError(422, 'Rewards can\'t be used here')
  const s = programme.settings
  let reward
  let memberRewardId = null
  let points = 0
  if (want.member_reward_id) {
    const [h] = await tx`
      SELECT mr.*, r.data, r.is_active FROM loyalty_member_rewards mr
        JOIN loyalty_rewards r ON r.id = mr.reward_id AND r.tenant_id = mr.tenant_id
       WHERE mr.tenant_id = ${member.tenant_id} AND mr.member_id = ${member.id} AND mr.id = ${want.member_reward_id}
       FOR UPDATE OF mr`
    if (!h || h.status !== 'available' || (h.expires_at && new Date(h.expires_at) <= new Date())) throw httpError(409, 'This reward isn\'t available any more')
    reward = { id: h.reward_id, ...normaliseReward(h.data) }
    if (!h.is_active) throw httpError(409, 'This reward has been switched off')
    memberRewardId = h.id
  } else {
    const [r] = await tx`SELECT * FROM loyalty_rewards WHERE tenant_id = ${member.tenant_id} AND id = ${want.reward_id} AND is_active`
    if (!r) throw httpError(404, 'Reward not found')
    reward = rewardView(r)
    if (!(s.features.points && s.features.rewards) || !reward.points_cost) throw httpError(422, 'This reward isn\'t on offer for points')
    points = reward.points_cost
  }
  if (!reward.channels.includes(where.channel)) throw httpError(422, 'This reward can\'t be used here')
  const [red] = await tx`
    INSERT INTO loyalty_redemptions (tenant_id, member_id, reward_id, member_reward_id, points, venue_id, channel, status, name,
                                     discount, check_id, order_id, device_id, staff_id)
    VALUES (${member.tenant_id}, ${member.id}, ${reward.id}, ${memberRewardId}, ${points}, ${where.venue_id || null}, ${where.channel},
            'reserved', ${reward.name}, ${tx.json(allowedDiscount(reward))}, ${where.check_id || null}, ${where.order_id || null},
            ${where.device_id || null}, ${where.staff_id || null})
    RETURNING *`
  if (points) {
    await addPoints(tx, member, { kind: 'redeem', points: -points, source_kind: 'redemption', source_id: red.id, venue_id: where.venue_id, channel: where.channel, note: reward.name })
  }
  if (memberRewardId) {
    await tx`UPDATE loyalty_member_rewards SET status = 'reserved', updated_at = now() WHERE id = ${memberRewardId} AND tenant_id = ${member.tenant_id}`
  }
  return { redemption: red, reward }
}

export function redemptionView(r) {
  return {
    id: r.id, member_id: r.member_id, reward_id: r.reward_id, member_reward_id: r.member_reward_id, name: r.name, points: r.points,
    channel: r.channel, status: r.status, discount: r.discount, check_id: r.check_id, order_id: r.order_id,
    discount_pence: r.discount_pence, reserved_at: r.reserved_at, expires_at: r.expires_at, used_at: r.used_at,
    released_at: r.released_at, release_reason: r.release_reason,
  }
}

/** Put a reward back: points returned, a held reward available again. */
export async function releaseRedemption(tx, red, reason) {
  if (!red || red.status === 'released') return red
  const [row] = await tx`
    UPDATE loyalty_redemptions SET status = 'released', released_at = now(), release_reason = ${reason}, updated_at = now()
     WHERE id = ${red.id} AND tenant_id = ${red.tenant_id} AND status <> 'released' RETURNING *`
  if (!row) return red
  if (row.points > 0) {
    const member = await loadMember(tx, row.tenant_id, row.member_id, { lock: true })
    if (member) {
      await addPoints(tx, member, { kind: 'release', points: row.points, source_kind: 'redemption', source_id: row.id, venue_id: row.venue_id, channel: row.channel, note: row.name + ' put back' })
    }
  }
  if (row.member_reward_id) {
    await tx`
      UPDATE loyalty_member_rewards SET status = CASE WHEN expires_at IS NOT NULL AND expires_at <= now() THEN 'expired' ELSE 'available' END,
             used_at = NULL, updated_at = now()
       WHERE id = ${row.member_reward_id} AND tenant_id = ${row.tenant_id} AND status IN ('reserved', 'used')`
  }
  return row
}

async function useRedemption(tx, red, { discount_pence = null } = {}) {
  const [row] = await tx`
    UPDATE loyalty_redemptions SET status = 'used', used_at = COALESCE(used_at, now()),
           discount_pence = COALESCE(${discount_pence}, discount_pence), updated_at = now()
     WHERE id = ${red.id} AND tenant_id = ${red.tenant_id} RETURNING *`
  if (row?.member_reward_id) {
    await tx`UPDATE loyalty_member_rewards SET status = 'used', used_at = COALESCE(used_at, now()), updated_at = now()
              WHERE id = ${row.member_reward_id} AND tenant_id = ${row.tenant_id}`
  }
  return row
}

// ── Earning: points and stamps for a sale, worked out again on every change ─

/**
 * Bring a source's points and stamps to `targets` ({ [memberId]: { points,
 * stamps: { [cardId]: n }, spend } }): the difference from what the ledger
 * already holds for the source is added. Members no longer on it go to 0.
 */
async function settleSource(tx, tenantId, { sourceKind, sourceId, venueId, channel, targets, programme, cards }) {
  const rows = await tx`
    SELECT member_id, kind, stamp_card_id, COALESCE(sum(points), 0)::int AS points, COALESCE(sum(stamps), 0)::int AS stamps
      FROM loyalty_ledger
     WHERE tenant_id = ${tenantId} AND source_kind = ${sourceKind} AND source_id = ${sourceId} AND kind IN ('earn', 'stamps')
     GROUP BY member_id, kind, stamp_card_id`
  const have = {}
  for (const r of rows) {
    const h = have[r.member_id] ||= { points: 0, stamps: {} }
    if (r.kind === 'earn') h.points += r.points
    else if (r.stamp_card_id) h.stamps[r.stamp_card_id] = (h.stamps[r.stamp_card_id] || 0) + r.stamps
  }
  const memberIds = new Set([...Object.keys(have), ...Object.keys(targets)])
  for (const memberId of memberIds) {
    const want = targets[memberId] || { points: 0, stamps: {}, spend: 0 }
    const got = have[memberId] || { points: 0, stamps: {} }
    let member = await loadMember(tx, tenantId, memberId, { lock: true })
    if (!member || member.status === 'erased') continue
    const firstTime = !have[memberId] && targets[memberId]
    const dp = want.points - got.points
    if (dp !== 0) {
      member = await addPoints(tx, member, { kind: 'earn', points: dp, source_kind: sourceKind, source_id: sourceId, venue_id: venueId, channel, spend_pence: want.spend ?? null })
    }
    const cardIds = new Set([...Object.keys(got.stamps), ...Object.keys(want.stamps || {})])
    for (const cardId of cardIds) {
      const ds = (want.stamps?.[cardId] || 0) - (got.stamps[cardId] || 0)
      if (!ds) continue
      member = await addPoints(tx, member, { kind: 'stamps', points: 0, stamps: ds, stamp_card_id: cardId, source_kind: sourceKind, source_id: sourceId, venue_id: venueId, channel })
      const card = cards.find(c => c.id === cardId)
      if (card && ds > 0) await fillStampCard(tx, member, card)
    }
    if (firstTime && (want.points > 0 || Object.values(want.stamps || {}).some(n => n > 0) || want.spend > 0)) {
      await tx`
        UPDATE loyalty_members SET visits = visits + 1, last_visit_at = now(), spend_pence = spend_pence + ${Math.max(0, want.spend || 0)}
         WHERE id = ${member.id} AND tenant_id = ${tenantId}`
    }
  }
}

/** A full card gives its reward and starts again (the rest carry on). */
async function fillStampCard(tx, member, card) {
  if (!card.reward_id) return
  const [{ total }] = await tx`
    SELECT COALESCE(sum(stamps), 0)::int AS total FROM loyalty_ledger
     WHERE tenant_id = ${member.tenant_id} AND member_id = ${member.id} AND stamp_card_id = ${card.id}`
  let left = total
  let [{ n }] = await tx`
    SELECT count(*)::int AS n FROM loyalty_ledger
     WHERE tenant_id = ${member.tenant_id} AND member_id = ${member.id} AND stamp_card_id = ${card.id} AND kind = 'card_full'`
  const [reward] = await tx`SELECT * FROM loyalty_rewards WHERE tenant_id = ${member.tenant_id} AND id = ${card.reward_id}`
  if (!reward) return
  const valid = normaliseReward(reward.data).valid_days
  while (left >= card.stamps_needed && n < 1000) {
    n += 1
    await addPoints(tx, member, { kind: 'card_full', points: 0, stamps: -card.stamps_needed, stamp_card_id: card.id, source_kind: 'stamp_card', source_id: card.id + ':' + n, note: card.name + ' full' })
    await tx`
      INSERT INTO loyalty_member_rewards (tenant_id, member_id, reward_id, source, source_id, expires_at, note)
      VALUES (${member.tenant_id}, ${member.id}, ${card.reward_id}, 'stamp_card', ${card.id + ':' + n},
              ${valid ? new Date(Date.now() + valid * 86400_000) : null}, ${card.name})
      ON CONFLICT DO NOTHING`
    left -= card.stamps_needed
  }
}

/** What a sale earns for its member: { points, stamps: { cardId: n }, spend }. */
function saleTarget(programme, cards, sale, channel, venueId) {
  const s = programme.settings
  if (!channelOn(programme, channel, 'earn', venueId)) return { points: 0, stamps: {}, spend: sale.spend_pence }
  const points = s.features.points ? pointsFor(sale.spend_pence, s) : 0
  const stamps = {}
  if (s.features.stamps) for (const c of cards) {
    const n = stampsFor(c, sale)
    if (n) stamps[c.id] = n
  }
  return { points, stamps, spend: sale.spend_pence }
}

const lockSource = (tx, key) => tx`SELECT pg_advisory_xact_lock(hashtextextended(${'loyalty:' + key}, 0))`

/**
 * A till check's loyalty, after any change (and from the sweep): rewards on
 * it marked used, rewards that came off put back, and its member's points
 * and stamps worked out from what was paid (after discounts, without tips
 * or service charge, less refunds). Idempotent.
 */
export async function settleCheck(tenantId, venueId, checkId) {
  return withTenant(tenantId, async tx => {
    await lockSource(tx, 'check:' + checkId)
    const [row] = await tx`
      SELECT id, venue_id, status, state, last_seq, loyalty_member_id FROM pos_checks
       WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND id = ${checkId}`
    if (!row) return null
    const c = row.state || {}
    const programme = await ensureProgramme(tx, tenantId)
    const reds = await tx`SELECT * FROM loyalty_redemptions WHERE tenant_id = ${tenantId} AND check_id = ${checkId} AND status <> 'released'`
    const onCheck = new Map((c.discounts || []).filter(d => d.loyalty_redemption_id).map(d => [d.loyalty_redemption_id, d]))
    const t = checkTotals(c)
    for (const r of reds) {
      const d = onCheck.get(r.id)
      if (d && (row.status === 'void' || row.status === 'merged')) await releaseRedemption(tx, r, 'Check ' + row.status)
      else if (!d) {
        // On the check before and taken off: put back. Taken out but not on
        // the check yet: kept while the check is open (the till is about
        // to send it), put back once it is closed.
        if (r.status === 'used') await releaseRedemption(tx, r, 'Taken off the check')
        else if (row.status !== 'open') await releaseRedemption(tx, r, 'Not used')
      } else {
        const off = (t.discounts || []).find(x => x.id === d.id)?.amount ?? null
        await useRedemption(tx, r, { discount_pence: off })
      }
    }
    let channel = 'till'
    if (c.opened_device_id) {
      const [dev] = await tx`SELECT kind FROM pos_devices WHERE id = ${c.opened_device_id} AND tenant_id = ${tenantId}`
      if (dev?.kind === 'kiosk') channel = 'kiosk'
    }
    const memberId = c.loyalty?.member_id || null
    const targets = {}
    if (memberId && row.status === 'closed') {
      const cards = programme.settings.features.stamps ? await loadStampCards(tx, tenantId, { activeOnly: true }) : []
      const spend = Math.max(0, t.net - (t.refunded || 0))
      const fullyRefunded = t.paid > 0 && t.refunded >= t.paid
      const sale = {
        spend_pence: spend,
        lines: fullyRefunded ? [] : (c.lines || []).filter(isActiveLine).map(l => ({
          item_id: l.item_id, section_id: l.section_id, qty: l.qty,
          parts: (l.combo || []).map(p => ({ item_id: p.item_id || null, section_id: p.section_id || null, qty: p.qty || 1 })),
        })),
      }
      const target = saleTarget(programme, cards, sale, channel, venueId)
      targets[memberId] = target
      await settleSource(tx, tenantId, { sourceKind: 'check', sourceId: checkId, venueId, channel, targets, programme, cards })
    } else {
      await settleSource(tx, tenantId, { sourceKind: 'check', sourceId: checkId, venueId, channel, targets, programme, cards: [] })
    }
    await tx`
      UPDATE pos_checks SET loyalty_settled_key = ${row.status + ':' + row.last_seq}
       WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND id = ${checkId}`
    return { member_id: memberId, status: row.status }
  })
}

const ORDER_LIVE = ['placed', 'accepted', 'preparing', 'ready', 'completed']

/** An online order's loyalty (same idea as settleCheck). */
export async function settleOrder(tenantId, orderId) {
  return withTenant(tenantId, async tx => {
    await lockSource(tx, 'order:' + orderId)
    const [o] = await tx`
      SELECT id, venue_id, status, payment_status, subtotal_pence, discount_pence, refunded_pence, paid_pence, loyalty_member_id
        FROM orders WHERE tenant_id = ${tenantId} AND id = ${orderId}`
    if (!o) return null
    const programme = await ensureProgramme(tx, tenantId)
    const reds = await tx`SELECT * FROM loyalty_redemptions WHERE tenant_id = ${tenantId} AND order_id = ${orderId} AND status <> 'released'`
    const live = ORDER_LIVE.includes(o.status)
    for (const r of reds) {
      if (['rejected', 'cancelled', 'expired'].includes(o.status)) await releaseRedemption(tx, r, 'Order ' + o.status)
      else if (live) await useRedemption(tx, r)
    }
    const counts = live && (['paid', 'partially_refunded'].includes(o.payment_status) || o.status === 'completed')
    const targets = {}
    let cards = []
    if (o.loyalty_member_id && counts) {
      cards = programme.settings.features.stamps ? await loadStampCards(tx, tenantId, { activeOnly: true }) : []
      const items = await tx`
        SELECT menu_item_id, qty, parts, (SELECT section_id FROM menu_items mi WHERE mi.id = oi.menu_item_id AND mi.tenant_id = oi.tenant_id) AS section_id
          FROM order_items oi WHERE oi.tenant_id = ${tenantId} AND oi.order_id = ${orderId}`
      const spend = Math.max(0, o.subtotal_pence - o.discount_pence - (o.refunded_pence || 0))
      const fullyRefunded = o.paid_pence > 0 && o.refunded_pence >= o.paid_pence
      const sale = {
        spend_pence: spend,
        lines: fullyRefunded ? [] : items.map(i => ({
          item_id: i.menu_item_id, section_id: i.section_id, qty: i.qty,
          parts: (Array.isArray(i.parts) ? i.parts : []).map(p => ({ item_id: p.item_id || null, section_id: p.section_id || null, qty: p.qty || 1 })),
        })),
      }
      targets[o.loyalty_member_id] = saleTarget(programme, cards, sale, 'online', o.venue_id)
    }
    await settleSource(tx, tenantId, { sourceKind: 'order', sourceId: orderId, venueId: o.venue_id, channel: 'online', targets, programme, cards })
    await tx`
      UPDATE orders SET loyalty_settled_key = ${o.status + ':' + o.payment_status + ':' + (o.refunded_pence || 0)}
       WHERE tenant_id = ${tenantId} AND id = ${orderId}`
    return { member_id: o.loyalty_member_id, status: o.status }
  })
}

/** After till events: settle each changed check that has loyalty on it. */
export function settleChangedChecks(tenantId, venueId, changed, log) {
  for (const c of Object.values(changed || {})) {
    if (!c?.loyalty?.member_id && !(c?.discounts || []).some(d => d.loyalty_redemption_id)) continue
    settleCheck(tenantId, venueId, c.id).catch(err => log?.warn({ err }, 'loyalty settle after till events failed'))
  }
}

/**
 * The minute sweep: reservations nobody used (past their time) put back,
 * checks and orders that changed since they were last settled settled
 * again, and points of members who haven't earned or spent for the
 * programme's expiry time taken off.
 */
export async function sweepLoyalty({ log } = {}) {
  let done = 0
  try {
    const stale = await systemSql`
      SELECT r.* FROM loyalty_redemptions r
       WHERE r.status = 'reserved' AND r.expires_at < now()
         AND NOT EXISTS (SELECT 1 FROM pos_checks c WHERE c.tenant_id = r.tenant_id AND c.id = r.check_id
                         AND c.state->'discounts' @> jsonb_build_array(jsonb_build_object('loyalty_redemption_id', r.id::text)))
       LIMIT 200`
    for (const r of stale) {
      await withTenant(r.tenant_id, tx => releaseRedemption(tx, r, 'Not used')).then(() => done++).catch(err => log?.warn({ err }, 'loyalty release failed'))
    }
    const checks = await systemSql`
      SELECT tenant_id, venue_id, id FROM pos_checks
       WHERE (loyalty_member_id IS NOT NULL OR state->'discounts' @? '$[*] ? (exists(@.loyalty_redemption_id))')
         AND updated_at > now() - interval '30 days'
         AND loyalty_settled_key IS DISTINCT FROM (status || ':' || last_seq)
       LIMIT 200`
    for (const c of checks) await settleCheck(c.tenant_id, c.venue_id, c.id).then(() => done++).catch(err => log?.warn({ err }, 'loyalty check settle failed'))
    const orders = await systemSql`
      SELECT o.tenant_id, o.id FROM orders o
       WHERE (o.loyalty_member_id IS NOT NULL OR EXISTS (SELECT 1 FROM loyalty_redemptions r WHERE r.tenant_id = o.tenant_id AND r.order_id = o.id))
         AND o.created_at > now() - interval '60 days'
         AND o.loyalty_settled_key IS DISTINCT FROM (o.status || ':' || o.payment_status || ':' || COALESCE(o.refunded_pence, 0))
       LIMIT 200`
    for (const o of orders) await settleOrder(o.tenant_id, o.id).then(() => done++).catch(err => log?.warn({ err }, 'loyalty order settle failed'))
    // Points expiry: whole balance after the programme's months with nothing earned or spent.
    const expiring = await systemSql`
      SELECT m.tenant_id, m.id FROM loyalty_members m
        JOIN loyalty_programmes p ON p.id = m.programme_id AND p.enabled
       WHERE m.status = 'active' AND m.points > 0
         AND (p.settings->'points'->>'expiry_months') ~ '^[0-9]+$'
         AND m.last_activity_at < now() - make_interval(months => (p.settings->'points'->>'expiry_months')::int)
       LIMIT 200`
    for (const e of expiring) {
      await withTenant(e.tenant_id, async tx => {
        const m = await loadMember(tx, e.tenant_id, e.id, { lock: true })
        if (m && m.points > 0) await addPoints(tx, m, { kind: 'expire', points: -m.points, source_kind: 'expiry', source_id: new Date().toISOString().slice(0, 10), note: 'Points expired' })
      }).then(() => done++).catch(err => log?.warn({ err }, 'loyalty expiry failed'))
    }
    await systemSql`DELETE FROM loyalty_codes WHERE expires_at < now() - interval '1 day'`
    await systemSql`DELETE FROM loyalty_sessions WHERE expires_at < now()`
    await systemSql`
      UPDATE loyalty_member_rewards SET status = 'expired', updated_at = now()
       WHERE status = 'available' AND expires_at IS NOT NULL AND expires_at <= now()`
  } catch (err) {
    log?.warn({ err }, 'loyalty sweep failed')
  }
  return done
}

// ── The web app's sign-in: an emailed 6-digit code ──────────────────────────

/** The venue whose email settings send loyalty emails: the default widget venue, else one with settings. */
async function mailVenue(tx, tenantId) {
  const [v] = await tx`
    SELECT v.id, v.name FROM venues v
      LEFT JOIN venue_email_settings s ON s.venue_id = v.id AND s.tenant_id = v.tenant_id
      LEFT JOIN tenant_site ts ON ts.tenant_id = v.tenant_id
     WHERE v.tenant_id = ${tenantId}
     ORDER BY (v.id = ts.default_widget_venue_id) DESC NULLS LAST, (s.email_provider IS NOT NULL) DESC, v.created_at
     LIMIT 1`
  if (!v) return { venue: null, settings: null }
  const [settings] = await tx`SELECT * FROM venue_email_settings WHERE venue_id = ${v.id} AND tenant_id = ${tenantId}`
  return { venue: v, settings: settings || null }
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * Email a sign-in code. The reply is the same whether or not the email is a
 * member (joining needs the code too). At most a few codes an hour per address.
 */
export async function requestSignInCode({ tenantId, brandName, email, log }) {
  const mail = cleanEmail(email)
  if (!looksLikeEmail(mail)) throw httpError(400, 'Enter a valid email address')
  const hash = emailHash(mail)
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
  const mailParts = await withTenant(tenantId, async tx => {
    const programme = await ensureProgramme(tx, tenantId)
    if (!programme.enabled) throw httpError(422, 'Loyalty isn\'t switched on here')
    const [{ n }] = await tx`
      SELECT count(*)::int AS n FROM loyalty_codes WHERE tenant_id = ${tenantId} AND email_hash = ${hash} AND created_at > now() - interval '1 hour'`
    if (n >= MAX_CODES_PER_HOUR) return null
    await tx`
      INSERT INTO loyalty_codes (tenant_id, email_hash, code_hash, expires_at)
      VALUES (${tenantId}, ${hash}, ${sha256(hash + ':' + code)}, now() + make_interval(mins => ${CODE_MINUTES}))`
    return { ...(await mailVenue(tx, tenantId)), name: programme.settings.name }
  })
  if (!mailParts) return { sent: false }
  const business = brandName || mailParts.venue?.name || 'us'
  const html =
    '<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1f2937">' +
    '<p>Your code for ' + esc(mailParts.name) + ' at ' + esc(business) + ':</p>' +
    '<p style="font-size:32px;font-weight:700;letter-spacing:6px;margin:24px 0">' + code + '</p>' +
    '<p>It works for ' + CODE_MINUTES + ' minutes. If you didn\'t ask for it, ignore this email: nothing happens without the code.</p>' +
    '</div>'
  const { provider, credentials } = emailCredentials(mailParts.settings, env)
  const from = { name: mailParts.settings?.from_name || business, email: mailParts.settings?.from_email || env.EMAIL_FROM }
  sendEmail({ provider, credentials, from, to: mail, replyTo: mailParts.settings?.reply_to || null, subject: 'Your ' + mailParts.name + ' code: ' + code, html })
    .catch(err => log?.warn({ err: err?.message }, 'loyalty code email failed'))
  return { sent: true }
}

/**
 * Check a code. A member gets a session; an address that isn't a member
 * gets a join ticket (30 minutes) to join with.
 * -> { session, member } | { join_ticket }
 */
export async function verifySignInCode({ tenantId, email, code }) {
  const mail = cleanEmail(email)
  const clean = String(code || '').replace(/\s+/g, '')
  const wrong = () => httpError(422, 'That code is wrong or has run out. Ask for a new one.')
  if (!looksLikeEmail(mail) || !/^\d{6}$/.test(clean)) throw wrong()
  const hash = emailHash(mail)
  const out = await withTenant(tenantId, async tx => {
    const [row] = await tx`
      SELECT id, code_hash, attempts FROM loyalty_codes
       WHERE tenant_id = ${tenantId} AND email_hash = ${hash} AND used_at IS NULL AND expires_at > now()
       ORDER BY created_at DESC LIMIT 1 FOR UPDATE`
    if (!row || row.attempts >= MAX_ATTEMPTS) return { error: true }
    const ok = crypto.timingSafeEqual(Buffer.from(row.code_hash, 'hex'), Buffer.from(sha256(hash + ':' + clean), 'hex'))
    if (!ok) {
      await tx`UPDATE loyalty_codes SET attempts = attempts + 1 WHERE id = ${row.id}`
      return { error: true }
    }
    await tx`UPDATE loyalty_codes SET used_at = now() WHERE id = ${row.id}`
    const [m] = await tx`SELECT * FROM loyalty_members WHERE tenant_id = ${tenantId} AND email_hash = ${hash} AND status = 'active'`
    if (!m) return { join: true }
    return { member: m, session: await newSession(tx, m) }
  })
  if (out.error) throw wrong()
  if (out.join) return { join_ticket: await makeLink('loyalty_join', { t: tenantId, h: hash }, JOIN_TICKET_HOURS) }
  return out
}

/** The email hash a join ticket was made for (this tenant), else null. */
export async function readJoinTicket(tenantId, ticket) {
  const d = await readLink('loyalty_join', ticket)
  return d && d.t === tenantId ? d.h : null
}

export async function newSession(tx, member) {
  const token = 'ls_' + newToken(24)
  await tx`
    INSERT INTO loyalty_sessions (token_hash, tenant_id, member_id, expires_at)
    VALUES (${sha256(token)}, ${member.tenant_id}, ${member.id}, now() + make_interval(days => ${SESSION_DAYS}))`
  return token
}

/** The member a web app session belongs to (this tenant, active), else null. */
export async function sessionMember(tenantId, token) {
  const t = String(token || '')
  if (!/^ls_[A-Za-z0-9_-]{30,40}$/.test(t)) return null
  return withTenant(tenantId, async tx => {
    const [s] = await tx`
      UPDATE loyalty_sessions SET last_used_at = now()
       WHERE token_hash = ${sha256(t)} AND tenant_id = ${tenantId} AND expires_at > now()
       RETURNING member_id`
    if (!s) return null
    const m = await loadMember(tx, tenantId, s.member_id)
    return m && m.status === 'active' ? m : null
  })
}

export async function endSession(tenantId, token) {
  await withTenant(tenantId, tx => tx`DELETE FROM loyalty_sessions WHERE token_hash = ${sha256(String(token || ''))} AND tenant_id = ${tenantId}`)
}

// ── GDPR: export and erasure ────────────────────────────────────────────────

/** Everything kept about a member, as one object (the guest's download, the admin's export). */
export async function exportMember(tx, member) {
  const ledger = await tx`
    SELECT kind, points, stamps, stamp_card_id, source_kind, source_id, venue_id, channel, spend_pence, note, created_at
      FROM loyalty_ledger WHERE tenant_id = ${member.tenant_id} AND member_id = ${member.id} ORDER BY created_at`
  const rewards = await tx`
    SELECT mr.reward_id, mr.source, mr.status, mr.expires_at, mr.issued_at, mr.used_at, r.data->>'name' AS name
      FROM loyalty_member_rewards mr JOIN loyalty_rewards r ON r.id = mr.reward_id
     WHERE mr.tenant_id = ${member.tenant_id} AND mr.member_id = ${member.id} ORDER BY mr.issued_at`
  const redemptions = await tx`
    SELECT name, points, channel, status, discount_pence, reserved_at, used_at, released_at
      FROM loyalty_redemptions WHERE tenant_id = ${member.tenant_id} AND member_id = ${member.id} ORDER BY reserved_at`
  const [{ n: devices }] = await tx`SELECT count(*)::int AS n FROM loyalty_wallet_devices WHERE tenant_id = ${member.tenant_id} AND member_id = ${member.id}`
  return {
    exported_at: new Date().toISOString(),
    member: Object.fromEntries(MEMBER_COLS.filter(k => !['card_token', 'customer_id'].includes(k)).map(k => [k, member[k]])),
    points_history: ledger,
    rewards,
    redemptions,
    wallet_devices: devices,
  }
}

/**
 * Erase a member: name, email, phone, notes, tags, consents and wallet
 * cleared; sessions, codes and wallet devices deleted; the card stops
 * working. The ledger keeps its numbers (no personal data in it). Rewards
 * taken out and not used are put back first.
 */
export async function eraseMember(tx, tenantId, memberId) {
  const m = await loadMember(tx, tenantId, memberId, { lock: true })
  if (!m) throw httpError(404, 'Member not found')
  if (m.status === 'erased') return m
  for (const r of await tx`SELECT * FROM loyalty_redemptions WHERE tenant_id = ${tenantId} AND member_id = ${m.id} AND status = 'reserved'`) {
    await releaseRedemption(tx, r, 'Member erased')
  }
  await tx`DELETE FROM loyalty_sessions WHERE tenant_id = ${tenantId} AND member_id = ${m.id}`
  await tx`DELETE FROM loyalty_wallet_devices WHERE tenant_id = ${tenantId} AND member_id = ${m.id}`
  if (m.email_hash) await tx`DELETE FROM loyalty_codes WHERE tenant_id = ${tenantId} AND email_hash = ${m.email_hash}`
  await tx`UPDATE loyalty_member_rewards SET status = 'cancelled', note = NULL, updated_at = now()
            WHERE tenant_id = ${tenantId} AND member_id = ${m.id} AND status IN ('available', 'reserved')`
  await tx`UPDATE loyalty_ledger SET note = NULL, created_by = NULL WHERE tenant_id = ${tenantId} AND member_id = ${m.id} AND source_kind = 'staff'`
  const [erased] = await tx`
    UPDATE loyalty_members
       SET status = 'erased', name = NULL, email = NULL, email_hash = NULL, phone = NULL, notes = NULL, tags = '{}',
           consent = '{}'::jsonb, marketing_opt_in = false, marketing_opt_in_at = NULL, customer_id = NULL, identity_id = NULL,
           card_token = ${newToken(24)}, wallet_token = NULL, points = 0, erased_at = now(), updated_at = now()
     WHERE id = ${m.id} AND tenant_id = ${tenantId} RETURNING *`
  // The identity goes when no tenant's member uses it any more.
  if (m.identity_id) {
    await systemSql`
      DELETE FROM loyalty_identities i WHERE i.id = ${m.identity_id}
         AND NOT EXISTS (SELECT 1 FROM loyalty_members x WHERE x.identity_id = i.id)`
  }
  return erased
}

/** Erase the loyalty memberships of a customer (Customers > Anonymise). */
export async function eraseMembersOfCustomer(tx, tenantId, customerId, emails = []) {
  const hashes = emails.filter(Boolean).map(emailHash)
  const rows = await tx`
    SELECT id FROM loyalty_members
     WHERE tenant_id = ${tenantId} AND status <> 'erased'
       AND (customer_id = ${customerId} OR email_hash = ANY(${hashes}::text[]))`
  for (const r of rows) await eraseMember(tx, tenantId, r.id)
  return rows.length
}

// ── Wallet token (sealed): the pass web service's key for a member ──────────

export function walletToken(member) {
  return member?.wallet_token ? unseal(member.wallet_token) : null
}

export async function ensureWalletToken(tx, member) {
  if (member.wallet_token) return unseal(member.wallet_token)
  const token = newToken(24)
  await tx`UPDATE loyalty_members SET wallet_token = ${seal(token)} WHERE id = ${member.id} AND tenant_id = ${member.tenant_id}`
  return token
}

export { LOYALTY_CHANNELS }

// ── Addresses and what devices are told ─────────────────────────────────────

/** The tenant's site: { slug, origin, name, brand } (origin = the verified custom domain, else the subdomain). */
export async function tenantSite(tx, tenantId) {
  const [s] = await tx`
    SELECT ts.subdomain_slug, ts.custom_domain, ts.custom_domain_verified, ts.brand_name, ts.site_name, ts.logo_url,
           ts.favicon_url, ts.theme, t.name AS tenant_name
      FROM tenants t LEFT JOIN tenant_site ts ON ts.tenant_id = t.id
     WHERE t.id = ${tenantId}`
  if (!s) return null
  const root = env.PUBLIC_ROOT_DOMAIN.toLowerCase()
  const origin = s.custom_domain && s.custom_domain_verified
    ? 'https://' + s.custom_domain
    : s.subdomain_slug ? `${env.PUBLIC_SITE_SCHEME}://${s.subdomain_slug}.${root}` : null
  return {
    slug: s.subdomain_slug || null,
    origin,
    name: s.brand_name || s.site_name || s.tenant_name,
    logo_url: s.logo_url || null,
    favicon_url: s.favicon_url || null,
    colors: s.theme?.colors || {},
  }
}

/**
 * What the website's Loyalty block shows (blocks/loyalty_cta.eta, and the
 * builder's canvas through GET /api/loyalty/teaser): the programme's name,
 * how points are earned, the cheapest rewards for points and the stamp cards.
 * null while loyalty or its web app is off (the block then shows nothing).
 */
export async function loyaltyTeaser(tx, tenantId) {
  // Read only (a site render never makes the programme row).
  const [row] = await tx`SELECT * FROM loyalty_programmes WHERE tenant_id = ${tenantId} AND scope = 'tenant'`
  if (!row) return null
  const programme = programmeView(row)
  const s = programme.settings
  if (!programme.enabled || !s.features.web_app) return null
  const [rewards, cards] = await Promise.all([
    s.features.rewards ? loadRewards(tx, tenantId, { activeOnly: true }) : [],
    s.features.stamps ? loadStampCards(tx, tenantId, { activeOnly: true }) : [],
  ])
  const forPoints = rewards.filter(r => r.points_cost).sort((a, b) => a.points_cost - b.points_cost).slice(0, 6)
  const names = forPoints.some(r => r.kind === 'free_item')
    ? Object.fromEntries((await tx`SELECT id, name FROM menu_items WHERE tenant_id = ${tenantId}`).map(r => [r.id, r.name]))
    : {}
  return {
    name: s.name,
    points: s.features.points ? { label: s.points.label, per_pound: s.points.per_pound, welcome: s.points.welcome } : null,
    how: s.features.points ? earnText(s) : '',
    rewards: forPoints.map(r => ({ id: r.id, name: r.name, summary: rewardSummary(r, names), points_cost: r.points_cost })),
    stamp_cards: cards.map(c => ({ id: c.id, name: c.name, stamps_needed: c.stamps_needed })),
    link: '/loyalty',
    // The card's colours, for the Loyalty card block (blocks/loyalty_card.eta).
    card: cardColours(s, (await tenantSite(tx, tenantId))?.colors || {}),
  }
}

/** The loyalty block in a till's or kiosk's config (null when off for the channel). */
export async function deviceLoyalty(tx, tenantId, venueId, channel) {
  const programme = await ensureProgramme(tx, tenantId)
  if (!programme.enabled) return null
  const earn = channelOn(programme, channel, 'earn', venueId)
  const redeem = channelOn(programme, channel, 'redeem', venueId)
  if (!earn && !redeem) return null
  const s = programme.settings
  const site = await tenantSite(tx, tenantId)
  return {
    name: s.name,
    points: s.features.points, points_label: s.points.label, per_pound: s.points.per_pound, min_spend_pence: s.points.min_spend_pence,
    stamps: s.features.stamps,
    earn, redeem,
    join_url: s.features.web_app && site?.origin ? site.origin + '/loyalty' : null,
    // What a guest agrees to when staff add them at the till (tills only use it).
    signup: { ask_phone: s.signup.ask_phone, terms_text: s.signup.terms_text, marketing_text: s.signup.marketing_text },
  }
}

// ── Online ordering ─────────────────────────────────────────────────────────

/**
 * The rewards a signed-in guest picked for an online basket, checked: each
 * spendable online at this venue, points rewards affordable together.
 * -> [{ want, reward }] (reward = normaliseReward() + id)
 */
export async function onlineRewardPicks(tx, member, programme, venueId, wants = []) {
  if (!wants.length) return []
  if (!channelOn(programme, 'online', 'redeem', venueId)) throw httpError(422, 'Rewards can\'t be used for online orders here', { code: 'reward_invalid' })
  const spendable = await spendableRewards(tx, member, programme, 'online')
  const out = []
  let points = 0
  const seen = new Set()
  for (const w of wants) {
    const key = w.member_reward_id ? 'held:' + w.member_reward_id : 'points:' + w.reward_id
    if (seen.has(key)) continue
    seen.add(key)
    const s = spendable.find(x => x.key === key)
    if (!s) throw httpError(422, 'That reward isn\'t available any more', { code: 'reward_invalid' })
    points += s.points_cost || 0
    out.push({ want: w.member_reward_id ? { member_reward_id: w.member_reward_id } : { reward_id: w.reward_id }, reward: s.reward })
  }
  if (points > member.points) throw httpError(422, 'Not enough ' + programme.settings.points.label + ' for those rewards', { code: 'reward_invalid' })
  return out
}
