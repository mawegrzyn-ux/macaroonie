// src/routes/loyalty.js
//
// Loyalty admin (migration 211), mounted at /api/loyalty. The rules are
// shared/loyalty.js; writes of points and members go through
// services/loyaltySvc.js.
//
//   GET    /programme                 the programme, its rewards and stamp cards, figures
//   PUT    /programme                 { enabled, settings } (loyalty manage)
//   GET    /catalog                   dishes, sections and venues for the pickers
//   POST   /rewards  PUT /rewards/:id  DELETE /rewards/:id  PATCH /rewards/reorder
//   POST   /stamp-cards  PUT /stamp-cards/:id  DELETE /stamp-cards/:id
//   GET    /members                   ?q= &status= &marketing= &sort= &limit= &offset=  (loyalty_members view)
//   GET    /members.csv               the list as a spreadsheet (loyalty_members manage)
//   POST   /members                   staff add a member who agreed in person
//   GET    /members/:id               detail: profile, points, stamps, rewards, history
//   PATCH  /members/:id               name, phone, email, notes, tags, marketing off, status
//   POST   /members/:id/adjust        { points, note }
//   POST   /members/:id/rewards       { reward_id, note, valid_days }  give a reward
//   DELETE /members/:id/rewards/:rid  take a given reward back
//   POST   /members/:id/new-card      a new card code (the old one stops working)
//   GET    /members/:id/export        GDPR: everything kept, as JSON
//   POST   /members/:id/erase         GDPR erasure { confirm: 'ERASE' } (owner / admin)
//   GET    /wallet                    which Apple / Google accounts the cards use
//   PUT    /wallet/:kind              { own: false } or the tenant's own account (apple | google; owner / admin)
//   GET    /platform/wallet           Macaroonie's accounts (platform admins)
//   PUT    /platform/wallet/:kind     save one   DELETE /platform/wallet/:kind  remove it
//
// Modules: loyalty (the programme), loyalty_members (the members list).

import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requirePermission, requireRole, requirePlatformAdmin } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import {
  normaliseProgramme, normaliseReward, normaliseStampCard, rewardProblems, stampCardProblems, rewardSummary,
} from '../../../shared/loyalty.js'
import {
  ensureProgramme, loadRewards, loadStampCards, rewardView, stampCardView, loadMember, joinMember, addPoints,
  memberSummary, exportMember, eraseMember, newToken, redemptionView, releaseRedemption, tenantSite, emailHash, looksLikeEmail,
} from '../services/loyaltySvc.js'
import { loyaltyOrigin } from '../services/platformHost.js'
import { walletStatus, saveTenantWallet, platformWalletStatus, savePlatformWallet, removePlatformWallet } from '../services/walletSvc.js'

const uuid = z.string().uuid()
const PERM = {
  view: requirePermission('loyalty', 'view'),
  manage: requirePermission('loyalty', 'manage'),
  members: requirePermission('loyalty_members', 'view'),
  membersManage: requirePermission('loyalty_members', 'manage'),
}

const ProgrammeBody = z.object({ enabled: z.boolean(), settings: z.record(z.any()) })
const RewardBody = z.object({}).passthrough()
const MemberPatch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(20).optional(),
  marketing_opt_in: z.literal(false).optional(),
  status: z.enum(['active', 'closed']).optional(),
})

const csvCell = v => {
  let s = v == null ? '' : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

/** Dish / section / venue ids kept only when they are this tenant's own. */
async function ownIds(tx, tenantId, { item_ids = [], section_ids = [], venue_ids = null } = {}) {
  const items = item_ids.length ? (await tx`SELECT id FROM menu_items WHERE tenant_id = ${tenantId} AND id = ANY(${item_ids}::uuid[])`).map(r => r.id) : []
  const sections = section_ids.length ? (await tx`SELECT id FROM menu_sections WHERE tenant_id = ${tenantId} AND id = ANY(${section_ids}::uuid[])`).map(r => r.id) : []
  const venues = Array.isArray(venue_ids)
    ? (venue_ids.length ? (await tx`SELECT id FROM venues WHERE tenant_id = ${tenantId} AND id = ANY(${venue_ids}::uuid[])`).map(r => r.id) : [])
    : null
  return {
    item_ids: item_ids.filter(i => items.includes(i)),
    section_ids: section_ids.filter(i => sections.includes(i)),
    venue_ids: venues === null ? null : venue_ids.filter(i => venues.includes(i)),
  }
}

async function itemNames(tx, tenantId) {
  const rows = await tx`SELECT id, name FROM menu_items WHERE tenant_id = ${tenantId}`
  return Object.fromEntries(rows.map(r => [r.id, r.name]))
}

function memberRow(m) {
  return {
    id: m.id, member_no: m.member_no, status: m.status, name: m.name, email: m.email, phone: m.phone, points: m.points,
    points_earned: m.points_earned, points_spent: m.points_spent, visits: m.visits, spend_pence: Number(m.spend_pence) || 0,
    joined_at: m.joined_at, joined_channel: m.joined_channel, last_activity_at: m.last_activity_at, last_visit_at: m.last_visit_at,
    marketing_opt_in: m.marketing_opt_in, tags: m.tags || [], erased_at: m.erased_at,
  }
}

export default async function loyaltyRoutes(app) {
  app.addHook('preHandler', requireAuth)

  // ── Programme ───────────────────────────────────────────────────────────

  app.get('/programme', { preHandler: PERM.view }, async req => withTenant(req.tenantId, async tx => {
    const programme = await ensureProgramme(tx, req.tenantId)
    const [rewards, cards, names, [figures], site, wallet] = await Promise.all([
      loadRewards(tx, req.tenantId), loadStampCards(tx, req.tenantId), itemNames(tx, req.tenantId),
      tx`
        SELECT (SELECT count(*)::int FROM loyalty_members WHERE tenant_id = ${req.tenantId} AND status = 'active') AS members,
               (SELECT count(*)::int FROM loyalty_members WHERE tenant_id = ${req.tenantId} AND status = 'active' AND joined_at > now() - interval '30 days') AS joined_30d,
               (SELECT COALESCE(sum(points), 0)::int FROM loyalty_members WHERE tenant_id = ${req.tenantId} AND status = 'active') AS points_out,
               (SELECT COALESCE(sum(points), 0)::int FROM loyalty_ledger WHERE tenant_id = ${req.tenantId} AND kind = 'earn' AND created_at > now() - interval '30 days') AS earned_30d,
               (SELECT count(*)::int FROM loyalty_redemptions WHERE tenant_id = ${req.tenantId} AND status = 'used' AND used_at > now() - interval '30 days') AS redeemed_30d`,
      tenantSite(tx, req.tenantId),
      walletStatus(tx, req.tenantId),
    ])
    return {
      programme,
      rewards: rewards.map(r => ({ ...r, summary: rewardSummary(r, names), problems: rewardProblems(r) })),
      stamp_cards: cards.map(c => ({ ...c, problems: stampCardProblems(c) })),
      figures,
      web_app_url: site?.origin ? site.origin + '/loyalty' : null,
      // The same app on Macaroonie's loyalty address (services/loyaltyPage.js).
      hub_url: site?.slug ? loyaltyOrigin() + '/' + site.slug : null,
      wallet,
    }
  }))

  app.put('/programme', { preHandler: PERM.manage }, async req => {
    const body = ProgrammeBody.parse(req.body || {})
    return withTenant(req.tenantId, async tx => {
      const programme = await ensureProgramme(tx, req.tenantId)
      const settings = normaliseProgramme(body.settings)
      settings.venue_ids = (await ownIds(tx, req.tenantId, { venue_ids: settings.venue_ids })).venue_ids
      // The Macaroonie-wide programme isn't open yet.
      settings.features.network = false
      const [row] = await tx`
        UPDATE loyalty_programmes SET enabled = ${body.enabled}, settings = ${tx.json(settings)}, updated_at = now()
         WHERE id = ${programme.id} AND tenant_id = ${req.tenantId} RETURNING *`
      return { id: row.id, enabled: row.enabled, settings: normaliseProgramme(row.settings) }
    })
  })

  app.get('/catalog', { preHandler: PERM.view }, async req => withTenant(req.tenantId, async tx => {
    // The same shape as the Promotions catalog (components/menus/DishPicker.jsx).
    const [menus, sections, items, venues] = await Promise.all([
      tx`SELECT id, name FROM menus WHERE tenant_id = ${req.tenantId} ORDER BY name`,
      tx`SELECT id, menu_id, title FROM menu_sections WHERE tenant_id = ${req.tenantId} ORDER BY menu_id, sort_order`,
      tx`SELECT id, section_id, name FROM menu_items WHERE tenant_id = ${req.tenantId} ORDER BY section_id, sort_order`,
      tx`SELECT id, name FROM venues WHERE tenant_id = ${req.tenantId} AND is_active = true ORDER BY name`,
    ])
    const bySection = {}
    for (const i of items) (bySection[i.section_id] ||= []).push({ id: i.id, name: i.name })
    const byMenu = {}
    for (const s of sections) (byMenu[s.menu_id] ||= []).push({ id: s.id, title: s.title, items: bySection[s.id] || [] })
    return { menus: menus.map(m => ({ id: m.id, name: m.name, sections: byMenu[m.id] || [] })), venues }
  }))

  // ── Rewards ─────────────────────────────────────────────────────────────

  async function cleanReward(tx, tenantId, raw) {
    const r = normaliseReward(raw)
    const own = await ownIds(tx, tenantId, { item_ids: r.item_ids, section_ids: r.section_ids })
    return { ...r, item_ids: own.item_ids, section_ids: own.section_ids }
  }

  app.post('/rewards', { preHandler: PERM.manage }, async (req, reply) => {
    const raw = RewardBody.parse(req.body || {})
    const row = await withTenant(req.tenantId, async tx => {
      const programme = await ensureProgramme(tx, req.tenantId)
      const r = await cleanReward(tx, req.tenantId, raw)
      const [{ next }] = await tx`SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM loyalty_rewards WHERE tenant_id = ${req.tenantId}`
      const [made] = await tx`
        INSERT INTO loyalty_rewards (tenant_id, programme_id, data, points_cost, is_active, sort_order)
        VALUES (${req.tenantId}, ${programme.id}, ${tx.json(r)}, ${r.points_cost}, ${r.is_active}, ${next}) RETURNING *`
      return rewardView(made)
    })
    return reply.code(201).send(row)
  })

  app.put('/rewards/:id', { preHandler: PERM.manage }, async req => {
    if (!uuid.safeParse(req.params.id).success) throw httpError(404, 'Reward not found')
    const raw = RewardBody.parse(req.body || {})
    return withTenant(req.tenantId, async tx => {
      const r = await cleanReward(tx, req.tenantId, raw)
      const [row] = await tx`
        UPDATE loyalty_rewards SET data = ${tx.json(r)}, points_cost = ${r.points_cost}, is_active = ${r.is_active}, updated_at = now()
         WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId} RETURNING *`
      if (!row) throw httpError(404, 'Reward not found')
      return rewardView(row)
    })
  })

  app.patch('/rewards/reorder', { preHandler: PERM.manage }, async req => {
    const { ids } = z.object({ ids: z.array(uuid).max(500) }).parse(req.body || {})
    await withTenant(req.tenantId, async tx => {
      for (const [i, id] of ids.entries()) await tx`UPDATE loyalty_rewards SET sort_order = ${i} WHERE id = ${id} AND tenant_id = ${req.tenantId}`
    })
    return { ok: true }
  })

  app.delete('/rewards/:id', { preHandler: PERM.manage }, async req => {
    if (!uuid.safeParse(req.params.id).success) throw httpError(404, 'Reward not found')
    return withTenant(req.tenantId, async tx => {
      const [card] = await tx`SELECT data->>'name' AS name FROM loyalty_stamp_cards WHERE tenant_id = ${req.tenantId} AND reward_id = ${req.params.id} LIMIT 1`
      if (card) throw httpError(409, 'The stamp card "' + card.name + '" gives this reward: change the card first')
      const [{ n }] = await tx`
        SELECT count(*)::int AS n FROM loyalty_member_rewards
         WHERE tenant_id = ${req.tenantId} AND reward_id = ${req.params.id} AND status IN ('available', 'reserved')`
      if (n) throw httpError(409, n + (n === 1 ? ' member holds' : ' members hold') + ' this reward: switch it off instead')
      const [r] = await tx`DELETE FROM loyalty_rewards WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId} RETURNING id`
      if (!r) throw httpError(404, 'Reward not found')
      return { ok: true }
    }).catch(err => {
      if (err?.code === '23503') throw httpError(409, 'This reward has been used: switch it off instead')
      throw err
    })
  })

  // ── Stamp cards ─────────────────────────────────────────────────────────

  async function cleanCard(tx, tenantId, raw) {
    const c = normaliseStampCard(raw)
    const own = await ownIds(tx, tenantId, { item_ids: c.earn.item_ids, section_ids: c.earn.section_ids })
    c.earn.item_ids = own.item_ids
    c.earn.section_ids = own.section_ids
    if (c.reward_id) {
      const [r] = await tx`SELECT id FROM loyalty_rewards WHERE tenant_id = ${tenantId} AND id = ${c.reward_id}`
      if (!r) c.reward_id = null
    }
    return c
  }

  app.post('/stamp-cards', { preHandler: PERM.manage }, async (req, reply) => {
    const raw = RewardBody.parse(req.body || {})
    const row = await withTenant(req.tenantId, async tx => {
      const programme = await ensureProgramme(tx, req.tenantId)
      const c = await cleanCard(tx, req.tenantId, raw)
      const [{ next }] = await tx`SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM loyalty_stamp_cards WHERE tenant_id = ${req.tenantId}`
      const [made] = await tx`
        INSERT INTO loyalty_stamp_cards (tenant_id, programme_id, reward_id, data, is_active, sort_order)
        VALUES (${req.tenantId}, ${programme.id}, ${c.reward_id}, ${tx.json(c)}, ${c.is_active}, ${next}) RETURNING *`
      return stampCardView(made)
    })
    return reply.code(201).send(row)
  })

  app.put('/stamp-cards/:id', { preHandler: PERM.manage }, async req => {
    if (!uuid.safeParse(req.params.id).success) throw httpError(404, 'Stamp card not found')
    const raw = RewardBody.parse(req.body || {})
    return withTenant(req.tenantId, async tx => {
      const c = await cleanCard(tx, req.tenantId, raw)
      const [row] = await tx`
        UPDATE loyalty_stamp_cards SET data = ${tx.json(c)}, reward_id = ${c.reward_id}, is_active = ${c.is_active}, updated_at = now()
         WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId} RETURNING *`
      if (!row) throw httpError(404, 'Stamp card not found')
      return stampCardView(row)
    })
  })

  app.delete('/stamp-cards/:id', { preHandler: PERM.manage }, async req => {
    if (!uuid.safeParse(req.params.id).success) throw httpError(404, 'Stamp card not found')
    return withTenant(req.tenantId, async tx => {
      const [r] = await tx`DELETE FROM loyalty_stamp_cards WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId} RETURNING id`
      if (!r) throw httpError(404, 'Stamp card not found')
      return { ok: true }
    })
  })

  // ── Members (basic CRM) ─────────────────────────────────────────────────

  const ListQuery = z.object({
    q: z.string().trim().max(100).optional(),
    status: z.enum(['active', 'closed', 'erased', 'all']).default('active'),
    marketing: z.enum(['1', '0']).optional(),
    tag: z.string().trim().max(30).optional(),
    sort: z.enum(['recent', 'joined', 'points', 'name', 'visits']).default('recent'),
    limit: z.coerce.number().int().min(1).max(500).default(50),
    offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  })

  function listWhere(tx, tenantId, q) {
    const like = q.q ? '%' + q.q.replace(/[%_\\]/g, m => '\\' + m) + '%' : null
    const digits = (q.q || '').replace(/\D/g, '')
    return tx`
      tenant_id = ${tenantId}
      ${q.status === 'all' ? tx`` : tx`AND status = ${q.status}`}
      ${q.marketing === '1' ? tx`AND marketing_opt_in` : q.marketing === '0' ? tx`AND NOT marketing_opt_in` : tx``}
      ${q.tag ? tx`AND ${q.tag} = ANY(tags)` : tx``}
      ${like ? tx`AND (name ILIKE ${like} OR email ILIKE ${like} OR member_no LIKE ${digits ? digits + '%' : '-'}
                      OR (${digits.length >= 6} AND regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') LIKE ${'%' + digits.slice(-9)}))` : tx``}`
  }
  const ORDER = {
    recent: 'last_activity_at DESC', joined: 'joined_at DESC', points: 'points DESC', name: 'name ASC NULLS LAST', visits: 'visits DESC',
  }

  app.get('/members', { preHandler: PERM.members }, async req => {
    const q = ListQuery.parse(req.query || {})
    return withTenant(req.tenantId, async tx => {
      const rows = await tx`
        SELECT *, count(*) OVER () AS total FROM loyalty_members
         WHERE ${listWhere(tx, req.tenantId, q)}
         ORDER BY ${tx.unsafe(ORDER[q.sort])}, id
         LIMIT ${q.limit} OFFSET ${q.offset}`
      const tags = await tx`SELECT DISTINCT unnest(tags) AS tag FROM loyalty_members WHERE tenant_id = ${req.tenantId} ORDER BY 1 LIMIT 200`
      return { members: rows.map(memberRow), total: Number(rows[0]?.total || 0), tags: tags.map(t => t.tag) }
    })
  })

  app.get('/members.csv', { preHandler: PERM.membersManage }, async (req, reply) => {
    const q = ListQuery.parse({ ...(req.query || {}), limit: 500 })
    const rows = await withTenant(req.tenantId, tx => tx`
      SELECT * FROM loyalty_members WHERE ${listWhere(tx, req.tenantId, q)} ORDER BY joined_at LIMIT 100000`)
    const head = ['Member number', 'Name', 'Email', 'Phone', 'Status', 'Points', 'Points earned', 'Points spent', 'Visits',
      'Spend', 'Joined', 'Last activity', 'Newsletter', 'Tags']
    const lines = [head.join(',')]
    for (const m of rows) {
      lines.push([m.member_no, m.name, m.email, m.phone, m.status, m.points, m.points_earned, m.points_spent, m.visits,
        ((Number(m.spend_pence) || 0) / 100).toFixed(2), m.joined_at?.toISOString?.() || m.joined_at,
        m.last_activity_at?.toISOString?.() || m.last_activity_at, m.marketing_opt_in ? 'yes' : 'no', (m.tags || []).join(' ')].map(csvCell).join(','))
    }
    reply.header('Content-Type', 'text/csv; charset=utf-8')
    reply.header('Content-Disposition', 'attachment; filename="loyalty-members.csv"')
    return lines.join('\r\n') + '\r\n'
  })

  app.post('/members', { preHandler: PERM.membersManage }, async (req, reply) => {
    const body = z.object({
      name: z.string().trim().min(1).max(120),
      email: z.string().trim().max(200),
      phone: z.string().trim().max(30).nullable().optional(),
      marketing: z.boolean().default(false),
      agreed: z.literal(true, { errorMap: () => ({ message: 'The guest must agree to join' }) }),
      venue_id: uuid.nullable().optional(),
    }).parse(req.body || {})
    if (!looksLikeEmail(body.email)) throw httpError(400, 'Enter a valid email address')
    const out = await withTenant(req.tenantId, async tx => {
      const programme = await ensureProgramme(tx, req.tenantId)
      const { member, created } = await joinMember(tx, {
        tenantId: req.tenantId, programme, name: body.name, email: body.email, phone: body.phone, marketing: body.marketing,
        channel: 'staff', venueId: body.venue_id || null, by: req.user?.email || req.user?.sub || null,
      })
      if (!created) throw httpError(409, 'That email is already a member (' + member.member_no + ')')
      return memberRow(member)
    })
    return reply.code(201).send(out)
  })

  async function ownMember(tx, tenantId, id) {
    if (!uuid.safeParse(id).success) throw httpError(404, 'Member not found')
    const m = await loadMember(tx, tenantId, id)
    if (!m) throw httpError(404, 'Member not found')
    return m
  }

  app.get('/members/:id', { preHandler: PERM.members }, async req => withTenant(req.tenantId, async tx => {
    const m = await ownMember(tx, req.tenantId, req.params.id)
    const programme = await ensureProgramme(tx, req.tenantId)
    const names = await itemNames(tx, req.tenantId)
    const [summary, ledger, held, redemptions, venues, devices] = await Promise.all([
      m.status === 'erased' ? null : memberSummary(tx, m, programme, { names }),
      tx`SELECT l.id, l.kind, l.points, l.stamps, l.stamp_card_id, l.source_kind, l.source_id, l.channel, l.spend_pence, l.note,
                l.created_by, l.created_at, v.name AS venue_name, sc.data->>'name' AS card_name
           FROM loyalty_ledger l
           LEFT JOIN venues v ON v.id = l.venue_id
           LEFT JOIN loyalty_stamp_cards sc ON sc.id = l.stamp_card_id
          WHERE l.tenant_id = ${req.tenantId} AND l.member_id = ${m.id} ORDER BY l.created_at DESC LIMIT 200`,
      tx`SELECT mr.id, mr.reward_id, mr.source, mr.status, mr.expires_at, mr.issued_at, mr.used_at, mr.note, r.data->>'name' AS name
           FROM loyalty_member_rewards mr JOIN loyalty_rewards r ON r.id = mr.reward_id
          WHERE mr.tenant_id = ${req.tenantId} AND mr.member_id = ${m.id} ORDER BY mr.issued_at DESC LIMIT 100`,
      tx`SELECT * FROM loyalty_redemptions WHERE tenant_id = ${req.tenantId} AND member_id = ${m.id} ORDER BY reserved_at DESC LIMIT 100`,
      tx`SELECT id, name FROM venues WHERE tenant_id = ${req.tenantId}`,
      tx`SELECT count(*)::int AS n FROM loyalty_wallet_devices WHERE tenant_id = ${req.tenantId} AND member_id = ${m.id}`,
    ])
    return {
      member: { ...memberRow(m), notes: m.notes, consent: m.consent, joined_venue_id: m.joined_venue_id, customer_id: m.customer_id,
        apple_saved_at: m.apple_saved_at, google_saved_at: m.google_saved_at, wallet_devices: devices[0].n },
      summary, ledger, rewards: held, redemptions: redemptions.map(redemptionView),
      venues: Object.fromEntries(venues.map(v => [v.id, v.name])),
    }
  }))

  app.patch('/members/:id', { preHandler: PERM.membersManage }, async req => {
    const body = MemberPatch.parse(req.body || {})
    return withTenant(req.tenantId, async tx => {
      const m = await ownMember(tx, req.tenantId, req.params.id)
      if (m.status === 'erased') throw httpError(409, 'This member was erased')
      const set = {}
      if (body.name !== undefined) set.name = body.name
      if (body.phone !== undefined) set.phone = body.phone || null
      if (body.notes !== undefined) set.notes = body.notes || null
      if (body.tags !== undefined) set.tags = [...new Set(body.tags)]
      if (body.status !== undefined) set.status = body.status
      if (body.marketing_opt_in === false) { set.marketing_opt_in = false; set.marketing_opt_in_at = null }
      if (body.email !== undefined && body.email.toLowerCase() !== (m.email || '')) {
        if (!looksLikeEmail(body.email)) throw httpError(400, 'Enter a valid email address')
        const hash = emailHash(body.email)
        const [other] = await tx`SELECT member_no FROM loyalty_members WHERE tenant_id = ${req.tenantId} AND email_hash = ${hash} AND id <> ${m.id}`
        if (other) throw httpError(409, 'That email belongs to member ' + other.member_no)
        set.email = body.email.toLowerCase()
        set.email_hash = hash
      }
      if (!Object.keys(set).length) return memberRow(m)
      if (set.status === 'closed') await tx`DELETE FROM loyalty_sessions WHERE tenant_id = ${req.tenantId} AND member_id = ${m.id}`
      const [row] = await tx`UPDATE loyalty_members SET ${tx(set)}, updated_at = now() WHERE id = ${m.id} AND tenant_id = ${req.tenantId} RETURNING *`
      return memberRow(row)
    })
  })

  app.post('/members/:id/adjust', { preHandler: PERM.membersManage }, async req => {
    const body = z.object({ points: z.number().int().min(-1_000_000).max(1_000_000).refine(n => n !== 0, 'Enter some points'), note: z.string().trim().min(1).max(200) }).parse(req.body || {})
    return withTenant(req.tenantId, async tx => {
      const m = await ownMember(tx, req.tenantId, req.params.id)
      if (m.status !== 'active') throw httpError(409, 'This member isn\'t active')
      const locked = await loadMember(tx, req.tenantId, m.id, { lock: true })
      if (locked.points + body.points < 0) throw httpError(422, 'That would take the balance below 0 (it is ' + locked.points + ')')
      const after = await addPoints(tx, locked, { kind: 'adjust', points: body.points, source_kind: 'staff', source_id: null, note: body.note, created_by: req.user?.email || req.user?.sub })
      return { points: after.points }
    })
  })

  app.post('/members/:id/rewards', { preHandler: PERM.membersManage }, async (req, reply) => {
    const body = z.object({ reward_id: uuid, note: z.string().trim().max(200).nullable().optional(), valid_days: z.number().int().min(1).max(3650).nullable().optional() }).parse(req.body || {})
    const row = await withTenant(req.tenantId, async tx => {
      const m = await ownMember(tx, req.tenantId, req.params.id)
      if (m.status !== 'active') throw httpError(409, 'This member isn\'t active')
      const [r] = await tx`SELECT * FROM loyalty_rewards WHERE tenant_id = ${req.tenantId} AND id = ${body.reward_id}`
      if (!r) throw httpError(404, 'Reward not found')
      const days = body.valid_days ?? normaliseReward(r.data).valid_days
      const [made] = await tx`
        INSERT INTO loyalty_member_rewards (tenant_id, member_id, reward_id, source, source_id, expires_at, note, created_by)
        VALUES (${req.tenantId}, ${m.id}, ${r.id}, 'staff', NULL, ${days ? new Date(Date.now() + days * 86400_000) : null},
                ${body.note || null}, ${req.user?.email || req.user?.sub || null})
        RETURNING id`
      await tx`UPDATE loyalty_members SET wallet_updated_at = now() WHERE id = ${m.id} AND tenant_id = ${req.tenantId}`
      return made
    })
    return reply.code(201).send(row)
  })

  app.delete('/members/:id/rewards/:rid', { preHandler: PERM.membersManage }, async req => {
    if (!uuid.safeParse(req.params.rid).success) throw httpError(404, 'Reward not found')
    return withTenant(req.tenantId, async tx => {
      const m = await ownMember(tx, req.tenantId, req.params.id)
      const [r] = await tx`
        UPDATE loyalty_member_rewards SET status = 'cancelled', updated_at = now()
         WHERE tenant_id = ${req.tenantId} AND member_id = ${m.id} AND id = ${req.params.rid} AND status = 'available' RETURNING id`
      if (!r) throw httpError(409, 'Only a reward the member still holds can be taken back')
      return { ok: true }
    })
  })

  app.post('/members/:id/new-card', { preHandler: PERM.membersManage }, async req => withTenant(req.tenantId, async tx => {
    const m = await ownMember(tx, req.tenantId, req.params.id)
    if (m.status !== 'active') throw httpError(409, 'This member isn\'t active')
    await tx`UPDATE loyalty_members SET card_token = ${newToken()}, wallet_updated_at = now(), updated_at = now() WHERE id = ${m.id} AND tenant_id = ${req.tenantId}`
    return { ok: true }
  }))

  app.post('/members/:id/redemptions/:rid/release', { preHandler: PERM.membersManage }, async req => {
    if (!uuid.safeParse(req.params.rid).success) throw httpError(404, 'Redemption not found')
    return withTenant(req.tenantId, async tx => {
      const m = await ownMember(tx, req.tenantId, req.params.id)
      const [r] = await tx`SELECT * FROM loyalty_redemptions WHERE tenant_id = ${req.tenantId} AND member_id = ${m.id} AND id = ${req.params.rid} FOR UPDATE`
      if (!r) throw httpError(404, 'Redemption not found')
      if (r.status !== 'reserved') throw httpError(409, r.status === 'used' ? 'This reward was used: take its discount off the check instead' : 'Already put back')
      return redemptionView(await releaseRedemption(tx, r, 'Put back by staff'))
    })
  })

  app.get('/members/:id/export', { preHandler: PERM.membersManage }, async (req, reply) => {
    const data = await withTenant(req.tenantId, async tx => exportMember(tx, await ownMember(tx, req.tenantId, req.params.id)))
    reply.header('Content-Disposition', 'attachment; filename="loyalty-member-' + data.member.member_no + '.json"')
    return data
  })

  app.post('/members/:id/erase', { preHandler: [PERM.membersManage, requireRole('admin', 'owner')] }, async req => {
    z.object({ confirm: z.literal('ERASE', { errorMap: () => ({ message: 'Type ERASE to confirm' }) }) }).parse(req.body || {})
    return withTenant(req.tenantId, async tx => {
      const m = await ownMember(tx, req.tenantId, req.params.id)
      return memberRow(await eraseMember(tx, req.tenantId, m.id))
    })
  })

  // ── Wallet accounts ─────────────────────────────────────────────────────

  const WalletKind = z.enum(['apple', 'google'])
  const WalletBody = z.object({
    own: z.boolean().optional(),
    pass_type_id: z.string().max(200).optional(), team_id: z.string().max(20).optional(),
    cert_pem: z.string().max(20000).optional(), key_pem: z.string().max(20000).optional(), wwdr_pem: z.string().max(20000).optional(),
    issuer_id: z.string().max(40).optional(), service_account: z.union([z.string().max(20000), z.record(z.any())]).optional(),
  })

  app.get('/wallet', { preHandler: PERM.view }, async req => withTenant(req.tenantId, tx => walletStatus(tx, req.tenantId)))

  app.put('/wallet/:kind', { preHandler: [PERM.manage, requireRole('admin', 'owner')] }, async req => {
    const kind = WalletKind.parse(req.params.kind)
    const body = WalletBody.parse(req.body || {})
    return withTenant(req.tenantId, tx => saveTenantWallet(tx, req.tenantId, kind, body, req.user?.email || req.user?.sub || null))
  })

  app.get('/platform/wallet', { preHandler: requirePlatformAdmin }, async () => platformWalletStatus())

  app.put('/platform/wallet/:kind', { preHandler: requirePlatformAdmin }, async req => {
    const kind = WalletKind.parse(req.params.kind)
    return savePlatformWallet(kind, WalletBody.parse(req.body || {}), req.user?.email || req.user?.sub || null)
  })

  app.delete('/platform/wallet/:kind', { preHandler: requirePlatformAdmin }, async req => removePlatformWallet(WalletKind.parse(req.params.kind)))
}
