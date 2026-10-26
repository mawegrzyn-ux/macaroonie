// src/routes/loyaltyApi.js
//
// The loyalty web app's API and Apple Wallet's pass web service (migration
// 211), mounted at /loyalty-api. Public: a tenant is found by its website
// slug (system mode), a member by their sign-in (Authorization: Loyalty
// <session>), a pass by its serial and token.
//
//   GET  /t/:slug                      the programme as guests see it
//   POST /t/:slug/code                 { email } email a 6-digit sign-in code
//   POST /t/:slug/verify               { email, code } -> { session, member } | { join_ticket }
//   POST /t/:slug/join                 { join_ticket, email, name, phone, agreed, marketing } -> { session, member }
//   GET  /t/:slug/me                   the member's card, points, stamps, rewards, history
//   PATCH /t/:slug/me                  { name, phone, marketing }
//   POST /t/:slug/me/new-card          a new card code (the old one stops working)
//   GET  /t/:slug/me/export            everything kept about me (GDPR)
//   POST /t/:slug/me/delete            { confirm: 'DELETE' } leave and erase (GDPR)
//   POST /t/:slug/me/signout
//   POST /t/:slug/me/wallet/apple      -> { url } a 15-minute download link for the pass
//   POST /t/:slug/me/wallet/google     -> { url } the Add to Google Wallet link
//   GET  /pass/loyalty.pkpass?t=       the .pkpass for a download link
//   /apple/v1/...                      Apple's pass web service (register, list, fetch, log)
//   GET  /qr.js                         shared/qr.js, for the page to draw the card's QR code

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { systemSql, withTenant } from '../config/db.js'
import { httpError } from '../middleware/error.js'
import { rewardSummary } from '../../../shared/loyalty.js'
import {
  ensureProgramme, loadRewards, loadStampCards, joinMember, memberSummary, requestSignInCode, verifySignInCode,
  readJoinTicket, newSession, sessionMember, endSession, exportMember, eraseMember, newToken, emailHash, looksLikeEmail,
  tenantSite, loadMember, ensureWalletToken, walletToken,
} from '../services/loyaltySvc.js'
import { applePass, googleSaveUrl, walletStatus, appleAccount } from '../services/walletSvc.js'
import { makeLink, readLink } from '../services/previewLinks.js'
import { seal, unseal } from '../services/vault.js'

const uuid = z.string().uuid()
const QR_JS = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../shared/qr.js'), 'utf8')

/** The tenant a site slug belongs to (active), or 404. */
export async function tenantBySlug(slug) {
  const s = String(slug || '').toLowerCase()
  if (!/^[a-z0-9-]{1,63}$/.test(s)) throw httpError(404, 'Not found')
  const [row] = await systemSql`
    SELECT ts.tenant_id FROM tenant_site ts JOIN tenants t ON t.id = ts.tenant_id AND t.is_active
     WHERE ts.subdomain_slug = ${s} LIMIT 1`
  if (!row) throw httpError(404, 'Not found')
  return row.tenant_id
}

async function programmeOf(tenantId, { requireWebApp = true } = {}) {
  const p = await withTenant(tenantId, tx => ensureProgramme(tx, tenantId))
  if (!p.enabled || (requireWebApp && !p.settings.features.web_app)) throw httpError(404, 'Loyalty isn\'t open here')
  return p
}

async function signedIn(req, tenantId) {
  const m = /^Loyalty (\S+)$/.exec(req.headers.authorization || '')
  const member = m ? await sessionMember(tenantId, m[1]) : null
  if (!member) throw httpError(401, 'Please sign in again', { code: 'signed_out' })
  return { member, token: m[1] }
}

async function itemNames(tx, tenantId) {
  return Object.fromEntries((await tx`SELECT id, name FROM menu_items WHERE tenant_id = ${tenantId}`).map(r => [r.id, r.name]))
}

/** What the member's own pages show (their card code included). */
async function meView(tx, member, programme) {
  const names = await itemNames(tx, member.tenant_id)
  const summary = await memberSummary(tx, member, programme, { withToken: true, names })
  const history = await tx`
    SELECT l.kind, l.points, l.stamps, l.note, l.channel, l.created_at, v.name AS venue_name, sc.data->>'name' AS card_name
      FROM loyalty_ledger l
      LEFT JOIN venues v ON v.id = l.venue_id
      LEFT JOIN loyalty_stamp_cards sc ON sc.id = l.stamp_card_id
     WHERE l.tenant_id = ${member.tenant_id} AND l.member_id = ${member.id} AND (l.points <> 0 OR l.stamps <> 0)
     ORDER BY l.created_at DESC LIMIT 50`
  return { ...summary, history }
}

const EmailBody = z.object({ email: z.string().trim().min(3).max(200) })

export default async function loyaltyApiRoutes(app) {
  app.get('/qr.js', async (req, reply) => {
    reply.header('Cache-Control', 'public, max-age=300')
    return reply.type('application/javascript; charset=utf-8').send(QR_JS)
  })

  // ── The programme as guests see it ──────────────────────────────────────
  app.get('/t/:slug', async (req, reply) => {
    const tenantId = await tenantBySlug(req.params.slug)
    const programme = await programmeOf(tenantId, { requireWebApp: false })
    reply.header('Cache-Control', 'no-store')
    return withTenant(tenantId, async tx => {
      const s = programme.settings
      const [rewards, cards, names, site, wallet] = await Promise.all([
        loadRewards(tx, tenantId, { activeOnly: true }), loadStampCards(tx, tenantId, { activeOnly: true }),
        itemNames(tx, tenantId), tenantSite(tx, tenantId), walletStatus(tx, tenantId),
      ])
      return {
        name: s.name,
        web_app: s.features.web_app,
        points: s.features.points ? { label: s.points.label, per_pound: s.points.per_pound, welcome: s.points.welcome, expiry_months: s.points.expiry_months } : null,
        rewards: s.features.rewards ? rewards.filter(r => r.points_cost).map(r => ({ id: r.id, name: r.name, description: r.description, image_url: r.image_url, summary: rewardSummary(r, names), points_cost: r.points_cost })) : [],
        stamp_cards: s.features.stamps ? cards.map(c => ({ id: c.id, name: c.name, description: c.description, stamps_needed: c.stamps_needed })) : [],
        signup: { ask_phone: s.signup.ask_phone, terms_text: s.signup.terms_text, marketing_text: s.signup.marketing_text, welcome_text: s.signup.welcome_text },
        brand: { name: site?.name || null, logo_url: site?.logo_url || null },
        wallet: { apple: s.features.wallet_apple && wallet.apple.available, google: s.features.wallet_google && wallet.google.available },
      }
    })
  })

  // ── Sign in with an emailed code ────────────────────────────────────────
  app.post('/t/:slug/code', { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, async req => {
    const tenantId = await tenantBySlug(req.params.slug)
    await programmeOf(tenantId)
    const { email } = EmailBody.parse(req.body || {})
    if (!looksLikeEmail(email)) throw httpError(400, 'Enter a valid email address')
    const site = await withTenant(tenantId, tx => tenantSite(tx, tenantId))
    await requestSignInCode({ tenantId, brandName: site?.name, email, log: req.log })
    // The same reply whether or not the address is a member.
    return { ok: true }
  })

  app.post('/t/:slug/verify', { config: { rateLimit: { max: 12, timeWindow: '1 minute' } } }, async req => {
    const tenantId = await tenantBySlug(req.params.slug)
    const programme = await programmeOf(tenantId)
    const body = z.object({ email: z.string().trim().max(200), code: z.string().trim().max(12) }).parse(req.body || {})
    const out = await verifySignInCode({ tenantId, email: body.email, code: body.code })
    if (out.join_ticket) return { join_ticket: out.join_ticket }
    return { session: out.session, member: await withTenant(tenantId, tx => meView(tx, out.member, programme)) }
  })

  app.post('/t/:slug/join', { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, async (req, reply) => {
    const tenantId = await tenantBySlug(req.params.slug)
    const programme = await programmeOf(tenantId)
    const body = z.object({
      join_ticket: z.string().max(800),
      email: z.string().trim().max(200),
      name: z.string().trim().min(1, 'Enter your name').max(120),
      phone: z.string().trim().max(30).nullable().optional(),
      agreed: z.literal(true, { errorMap: () => ({ message: 'Tick the box to agree to join' }) }),
      marketing: z.boolean().default(false),
    }).parse(req.body || {})
    const hash = await readJoinTicket(tenantId, body.join_ticket)
    if (!hash || hash !== emailHash(body.email)) throw httpError(422, 'That sign-in has run out: ask for a new code')
    const out = await withTenant(tenantId, async tx => {
      const { member } = await joinMember(tx, {
        tenantId, programme, name: body.name, email: body.email, phone: programme.settings.signup.ask_phone ? body.phone : null,
        marketing: body.marketing, channel: 'web',
      })
      return { session: await newSession(tx, member), member: await meView(tx, member, programme) }
    })
    return reply.code(201).send(out)
  })

  // ── The member's own pages ──────────────────────────────────────────────
  app.get('/t/:slug/me', async (req, reply) => {
    const tenantId = await tenantBySlug(req.params.slug)
    const programme = await programmeOf(tenantId, { requireWebApp: false })
    const { member } = await signedIn(req, tenantId)
    reply.header('Cache-Control', 'no-store')
    return withTenant(tenantId, tx => meView(tx, member, programme))
  })

  // Rewards to spend online (the ordering page) at a venue.
  app.get('/t/:slug/me/rewards', async (req, reply) => {
    const tenantId = await tenantBySlug(req.params.slug)
    const programme = await programmeOf(tenantId, { requireWebApp: false })
    const { member } = await signedIn(req, tenantId)
    reply.header('Cache-Control', 'no-store')
    return withTenant(tenantId, async tx => {
      const s = await memberSummary(tx, member, programme, { channel: 'online', names: await itemNames(tx, tenantId) })
      return { member: { id: s.id, name: s.name, member_no: s.member_no, points: s.points }, rewards: s.rewards, points_label: programme.settings.points.label }
    })
  })

  app.patch('/t/:slug/me', async req => {
    const tenantId = await tenantBySlug(req.params.slug)
    const programme = await programmeOf(tenantId, { requireWebApp: false })
    const { member } = await signedIn(req, tenantId)
    const body = z.object({
      name: z.string().trim().min(1).max(120).optional(),
      phone: z.string().trim().max(30).nullable().optional(),
      marketing: z.boolean().optional(),
    }).parse(req.body || {})
    return withTenant(tenantId, async tx => {
      const set = {}
      if (body.name !== undefined) set.name = body.name
      if (body.phone !== undefined) set.phone = body.phone || null
      if (body.marketing !== undefined && body.marketing !== member.marketing_opt_in) {
        set.marketing_opt_in = body.marketing
        set.marketing_opt_in_at = body.marketing ? new Date() : null
        set.consent = tx.json({ ...(member.consent || {}), marketing: body.marketing ? { text: programme.settings.signup.marketing_text, at: new Date().toISOString() } : null })
      }
      if (Object.keys(set).length) {
        set.wallet_updated_at = new Date()
        await tx`UPDATE loyalty_members SET ${tx(set)}, updated_at = now() WHERE id = ${member.id} AND tenant_id = ${tenantId}`
      }
      return meView(tx, await loadMember(tx, tenantId, member.id), programme)
    })
  })

  app.post('/t/:slug/me/new-card', async req => {
    const tenantId = await tenantBySlug(req.params.slug)
    const programme = await programmeOf(tenantId, { requireWebApp: false })
    const { member } = await signedIn(req, tenantId)
    return withTenant(tenantId, async tx => {
      await tx`UPDATE loyalty_members SET card_token = ${newToken()}, wallet_updated_at = now(), updated_at = now() WHERE id = ${member.id} AND tenant_id = ${tenantId}`
      return meView(tx, await loadMember(tx, tenantId, member.id), programme)
    })
  })

  app.get('/t/:slug/me/export', async (req, reply) => {
    const tenantId = await tenantBySlug(req.params.slug)
    const { member } = await signedIn(req, tenantId)
    const data = await withTenant(tenantId, tx => exportMember(tx, member))
    reply.header('Content-Disposition', 'attachment; filename="my-loyalty-data.json"')
    reply.header('Cache-Control', 'no-store')
    return data
  })

  app.post('/t/:slug/me/delete', async req => {
    const tenantId = await tenantBySlug(req.params.slug)
    const { member } = await signedIn(req, tenantId)
    z.object({ confirm: z.literal('DELETE', { errorMap: () => ({ message: 'Type DELETE to confirm' }) }) }).parse(req.body || {})
    await withTenant(tenantId, tx => eraseMember(tx, tenantId, member.id))
    return { ok: true }
  })

  app.post('/t/:slug/me/signout', async req => {
    const tenantId = await tenantBySlug(req.params.slug)
    const m = /^Loyalty (\S+)$/.exec(req.headers.authorization || '')
    if (m) await endSession(tenantId, m[1])
    return { ok: true }
  })

  // ── Wallet cards ────────────────────────────────────────────────────────
  app.post('/t/:slug/me/wallet/apple', async req => {
    const tenantId = await tenantBySlug(req.params.slug)
    const programme = await programmeOf(tenantId, { requireWebApp: false })
    if (!programme.settings.features.wallet_apple) throw httpError(404, 'Apple Wallet isn\'t switched on')
    const { member } = await signedIn(req, tenantId)
    const ok = await withTenant(tenantId, tx => appleAccount(tx, tenantId))
    if (!ok) throw httpError(422, 'Apple Wallet isn\'t set up yet')
    const link = await makeLink('loyalty_pass', { t: tenantId, m: member.id }, 0.25)
    // The signed link is longer than a route parameter may be: it goes in the query.
    return { url: '/loyalty-api/pass/loyalty.pkpass?t=' + encodeURIComponent(link) }
  })

  app.get('/pass/loyalty.pkpass', async (req, reply) => {
    const d = await readLink('loyalty_pass', String(req.query?.t || ''))
    if (!d) throw httpError(410, 'This link has run out: open your card again')
    const out = await withTenant(d.t, async tx => {
      const member = await loadMember(tx, d.t, d.m)
      if (!member || member.status !== 'active') return null
      const programme = await ensureProgramme(tx, d.t)
      const site = await tenantSite(tx, d.t)
      const auth = await ensureWalletToken(tx, member)
      const pass = await applePass(tx, member, programme, site, auth)
      await tx`UPDATE loyalty_members SET apple_saved_at = COALESCE(apple_saved_at, now()) WHERE id = ${member.id} AND tenant_id = ${d.t}`
      return pass
    })
    if (!out) throw httpError(404, 'Card not found')
    reply.header('Content-Type', 'application/vnd.apple.pkpass')
    reply.header('Content-Disposition', 'attachment; filename="loyalty.pkpass"')
    reply.header('Cache-Control', 'no-store')
    return reply.send(out.bytes)
  })

  app.post('/t/:slug/me/wallet/google', async req => {
    const tenantId = await tenantBySlug(req.params.slug)
    const programme = await programmeOf(tenantId, { requireWebApp: false })
    if (!programme.settings.features.wallet_google) throw httpError(404, 'Google Wallet isn\'t switched on')
    const { member } = await signedIn(req, tenantId)
    return withTenant(tenantId, async tx => {
      const site = await tenantSite(tx, tenantId)
      const url = await googleSaveUrl(tx, member, programme, site)
      await tx`UPDATE loyalty_members SET google_saved_at = COALESCE(google_saved_at, now()) WHERE id = ${member.id} AND tenant_id = ${tenantId}`
      return { url }
    })
  })

  // ── Apple Wallet's pass web service ─────────────────────────────────────
  // Apple's devices call these with "Authorization: ApplePass <token>"; the
  // serial is the member id. https://developer.apple.com/documentation/walletpasses

  async function passMember(req) {
    const serial = req.params.serial
    if (!uuid.safeParse(serial).success) return null
    const m = /^ApplePass (\S+)$/.exec(req.headers.authorization || '')
    if (!m) return null
    const [row] = await systemSql`SELECT * FROM loyalty_members WHERE id = ${serial} AND status = 'active'`
    if (!row || !row.wallet_token) return null
    const want = Buffer.from(unseal(row.wallet_token))
    const got = Buffer.from(m[1])
    if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null
    return row
  }
  const deviceOk = id => /^[A-Za-z0-9]{8,128}$/.test(String(id || ''))

  app.post('/apple/v1/devices/:device/registrations/:passType/:serial', async (req, reply) => {
    const member = await passMember(req)
    if (!member || !deviceOk(req.params.device)) return reply.code(401).send()
    const pushToken = String(req.body?.pushToken || '')
    if (!/^[A-Za-z0-9]{8,200}$/.test(pushToken)) return reply.code(400).send()
    const made = await withTenant(member.tenant_id, async tx => {
      const [had] = await tx`
        SELECT id FROM loyalty_wallet_devices
         WHERE tenant_id = ${member.tenant_id} AND member_id = ${member.id} AND device_library_id = ${req.params.device} AND pass_type_id = ${req.params.passType}`
      if (had) {
        await tx`UPDATE loyalty_wallet_devices SET push_token = ${seal(pushToken)} WHERE id = ${had.id} AND tenant_id = ${member.tenant_id}`
        return false
      }
      await tx`
        INSERT INTO loyalty_wallet_devices (tenant_id, member_id, device_library_id, pass_type_id, push_token)
        VALUES (${member.tenant_id}, ${member.id}, ${req.params.device}, ${req.params.passType}, ${seal(pushToken)})`
      return true
    })
    return reply.code(made ? 201 : 200).send()
  })

  app.delete('/apple/v1/devices/:device/registrations/:passType/:serial', async (req, reply) => {
    const member = await passMember(req)
    if (!member) return reply.code(401).send()
    await withTenant(member.tenant_id, tx => tx`
      DELETE FROM loyalty_wallet_devices
       WHERE tenant_id = ${member.tenant_id} AND member_id = ${member.id} AND device_library_id = ${req.params.device} AND pass_type_id = ${req.params.passType}`)
    return reply.code(200).send()
  })

  // The serials of a device's passes that changed since passesUpdatedSince
  // (the lastUpdated tag we gave it: ms since 1970).
  app.get('/apple/v1/devices/:device/registrations/:passType', async (req, reply) => {
    if (!deviceOk(req.params.device)) return reply.code(404).send()
    const since = /^\d{1,16}$/.test(String(req.query?.passesUpdatedSince || '')) ? new Date(Number(req.query.passesUpdatedSince)) : new Date(0)
    const rows = await systemSql`
      SELECT m.id, m.wallet_updated_at FROM loyalty_wallet_devices d
        JOIN loyalty_members m ON m.id = d.member_id AND m.status = 'active'
       WHERE d.device_library_id = ${req.params.device} AND d.pass_type_id = ${req.params.passType}
         AND m.wallet_updated_at > ${since}`
    if (!rows.length) return reply.code(204).send()
    const last = Math.max(...rows.map(r => new Date(r.wallet_updated_at).getTime()))
    return { serialNumbers: rows.map(r => r.id), lastUpdated: String(last) }
  })

  app.get('/apple/v1/passes/:passType/:serial', async (req, reply) => {
    const member = await passMember(req)
    if (!member) return reply.code(401).send()
    const since = req.headers['if-modified-since'] ? new Date(req.headers['if-modified-since']) : null
    const updated = new Date(member.wallet_updated_at)
    if (since && !isNaN(since) && Math.floor(updated.getTime() / 1000) <= Math.floor(since.getTime() / 1000)) return reply.code(304).send()
    const pass = await withTenant(member.tenant_id, async tx => {
      const programme = await ensureProgramme(tx, member.tenant_id)
      const site = await tenantSite(tx, member.tenant_id)
      return applePass(tx, member, programme, site, walletToken(member))
    })
    if (pass.pass_type_id !== req.params.passType) return reply.code(401).send()
    reply.header('Content-Type', 'application/vnd.apple.pkpass')
    reply.header('Last-Modified', updated.toUTCString())
    return reply.send(pass.bytes)
  })

  app.post('/apple/v1/log', async (req, reply) => {
    const logs = Array.isArray(req.body?.logs) ? req.body.logs.slice(0, 20) : []
    for (const l of logs) req.log.info({ wallet: String(l).slice(0, 300) }, 'apple wallet log')
    return reply.code(200).send()
  })
}

