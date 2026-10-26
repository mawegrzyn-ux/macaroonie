// src/routes/loyaltyPos.js
//
// Loyalty on tills and kiosks (migration 211): registered inside posApi.js's
// device scope, so every route has req.posDevice (a paired till or kiosk).
//
//   POST /pos-api/loyalty/lookup                 { code } a scanned / typed card, or { q } (tills only)
//   POST /pos-api/loyalty/members                { name, email, phone, marketing, agreed } join at the till
//   POST /pos-api/loyalty/redemptions            { member_id, reward_id | member_reward_id, check_id, staff_id }
//   POST /pos-api/loyalty/redemptions/:id/release  put a reward back that never went on the check
//
// The device then puts the member on the check (check.member_set) and the
// reward's discount on it (discount.applied with loyalty_redemption_id); the
// sequencer checks the redemption (shared/loyalty.js loyaltyProblem()).

import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { httpError } from '../middleware/error.js'
import {
  ensureProgramme, memberByCode, searchMembers, memberSummary, joinMember, reserveReward, releaseRedemption,
  redemptionView, loadMember, looksLikeEmail,
} from '../services/loyaltySvc.js'
import { channelOn } from '../../../shared/loyalty.js'

const uuid = z.string().uuid()
const channelOf = d => (d.kind === 'kiosk' ? 'kiosk' : 'till')

// A kiosk is a public screen: it shows a member's first name only.
function forDevice(summary, d) {
  if (d.kind !== 'kiosk') return summary
  const { email, phone, ...rest } = summary
  return { ...rest, name: String(summary.name || '').split(/\s+/)[0] || null }
}

export function loyaltyDeviceRoutes(scoped) {
  scoped.post('/loyalty/lookup', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async req => {
    const d = req.posDevice
    if (!['terminal', 'kiosk'].includes(d.kind)) throw httpError(403, 'Only tills and kiosks look members up')
    const body = z.object({ code: z.string().trim().max(300).optional(), q: z.string().trim().max(100).optional() }).parse(req.body || {})
    if (d.kind === 'kiosk' && !body.code) throw httpError(403, 'A kiosk finds a member by their card only')
    const channel = channelOf(d)
    return withTenant(d.tenant_id, async tx => {
      const programme = await ensureProgramme(tx, d.tenant_id)
      if (!programme.enabled) throw httpError(422, 'Loyalty isn\'t switched on')
      const earn = channelOn(programme, channel, 'earn', d.venue_id)
      const redeem = channelOn(programme, channel, 'redeem', d.venue_id)
      if (!earn && !redeem) throw httpError(422, 'Loyalty isn\'t used at this venue')
      const found = body.code ? [await memberByCode(tx, d.tenant_id, body.code)].filter(Boolean) : await searchMembers(tx, d.tenant_id, body.q || '')
      const members = []
      for (const m of found) members.push(forDevice(await memberSummary(tx, m, programme, { channel }), d))
      return { members, earn, redeem }
    })
  })

  scoped.post('/loyalty/members', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const d = req.posDevice
    if (d.kind !== 'terminal') throw httpError(403, 'Guests join on a till, the website or their phone')
    const body = z.object({
      name: z.string().trim().min(1).max(120), email: z.string().trim().max(200), phone: z.string().trim().max(30).nullable().optional(),
      marketing: z.boolean().default(false),
      agreed: z.literal(true, { errorMap: () => ({ message: 'The guest must agree to join' }) }),
      staff_id: uuid.nullable().optional(),
    }).parse(req.body || {})
    if (!looksLikeEmail(body.email)) throw httpError(400, 'Enter a valid email address')
    const out = await withTenant(d.tenant_id, async tx => {
      const programme = await ensureProgramme(tx, d.tenant_id)
      const { member, created } = await joinMember(tx, {
        tenantId: d.tenant_id, programme, name: body.name, email: body.email, phone: body.phone, marketing: body.marketing,
        channel: 'till', venueId: d.venue_id, by: 'device:' + d.id,
      })
      return { created, member: await memberSummary(tx, member, programme, { channel: 'till' }) }
    })
    return reply.code(out.created ? 201 : 200).send(out)
  })

  scoped.post('/loyalty/redemptions', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const d = req.posDevice
    if (!['terminal', 'kiosk'].includes(d.kind)) throw httpError(403, 'Only tills and kiosks take rewards out')
    const body = z.object({
      member_id: uuid,
      reward_id: uuid.optional(),
      member_reward_id: uuid.optional(),
      check_id: z.string().min(10).max(40),
      staff_id: uuid.nullable().optional(),
    }).refine(b => !!b.reward_id !== !!b.member_reward_id, 'Name one reward').parse(req.body || {})
    const out = await withTenant(d.tenant_id, async tx => {
      const programme = await ensureProgramme(tx, d.tenant_id)
      const member = await loadMember(tx, d.tenant_id, body.member_id, { lock: true })
      if (!member) throw httpError(404, 'Member not found')
      const { redemption, reward } = await reserveReward(tx, {
        member, programme,
        want: body.member_reward_id ? { member_reward_id: body.member_reward_id } : { reward_id: body.reward_id },
        where: { channel: channelOf(d), venue_id: d.venue_id, check_id: body.check_id, device_id: d.id, staff_id: d.kind === 'kiosk' ? null : body.staff_id || null },
      })
      const after = await loadMember(tx, d.tenant_id, member.id)
      return { redemption: redemptionView(redemption), reward, points: after.points }
    })
    return reply.code(201).send(out)
  })

  scoped.post('/loyalty/redemptions/:id/release', async req => {
    const d = req.posDevice
    if (!uuid.safeParse(req.params.id).success) throw httpError(404, 'Reward not found')
    return withTenant(d.tenant_id, async tx => {
      const [r] = await tx`SELECT * FROM loyalty_redemptions WHERE id = ${req.params.id} AND tenant_id = ${d.tenant_id} AND venue_id = ${d.venue_id} FOR UPDATE`
      if (!r) throw httpError(404, 'Reward not found')
      if (r.status === 'used') throw httpError(409, 'This reward is on the check: take its discount off instead')
      const out = await releaseRedemption(tx, r, 'Put back at the ' + channelOf(d))
      return { redemption: redemptionView(out) }
    })
  })
}
