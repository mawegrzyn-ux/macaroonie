// src/routes/cardSetup.js
//
// Card machines in Store tech, /api/pos (migration 193,
// services/cardMachines/, services/cardSvc.js). Store tech view to read;
// manage to add and change machines; accounts hold a provider key, so they
// also need an owner or admin.
//
//   GET    /card-accounts                    the tenant's accounts (no keys), and the providers
//   POST   /card-accounts                    { provider, name, secret, settings } checked with the provider first,
//                                            or { provider: 'stripe', name, connect: true }: no key, the group's
//                                            connected Stripe account (migration 215, services/stripeConnect.js)
//   PATCH  /card-accounts/:id                { name?, secret?, settings? } (a new key or settings is checked)
//   POST   /card-accounts/:id/locations      { venue_id }: a Stripe Terminal location from the venue's address
//   POST   /card-accounts/:id/check          ask the provider again (mode, Stripe locations)
//   DELETE /card-accounts/:id                key forgotten, its machines removed (past payments kept)
//   GET    /card-accounts/:id/readers        the provider's own list, each marked where it is added
//   GET    /venues/:venueId/card-readers     the venue's card machines, and which tills and kiosks use them
//   POST   /venues/:venueId/card-readers     { account_id, provider_reader_id, name } from the provider's list,
//                                            { account_id, code, name, location? } a code the machine shows,
//                                            or { provider: 'test', name } the test card machine
//   PATCH  /card-readers/:id                 { name }
//   DELETE /card-readers/:id                 removed; tills and kiosks using it go back to no card machine
//   GET    /venues/:venueId/card-payments?days=&status=   recent card attempts (sales and refunds;
//                                            Store tech or Till reports view)
//
// Changing a machine tells the venue's tills and kiosks to download their
// config again (pos.config).

import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requirePermission, requireRole, requireAnyPermission } from '../middleware/auth.js'
import { requireOwnVenue } from '../middleware/venue.js'
import { httpError } from '../middleware/error.js'
import { broadcast } from '../config/ws.js'
import { seal, unseal } from '../services/vault.js'
import { PROVIDERS, PROVIDER_KEYS, provider } from '../services/cardMachines/index.js'
import { paymentView, cardAccount } from '../services/cardSvc.js'
import { tenantStripe } from '../services/stripeConnect.js'

const canView = requirePermission('pos_setup', 'view')
// Card payments are takings too: Till reports can see them.
const canSeePayments = requireAnyPermission(['pos_setup', 'pos_reports'], 'view')
const canManage = requirePermission('pos_setup', 'manage')
const keyHolder = requireRole('admin', 'owner')
const UUID = z.string().uuid()
const by = req => req.user?.email ?? null

const AccountSettings = z.object({
  merchant_code:     z.string().trim().max(40).optional(),
  software_house_id: z.string().trim().max(80).optional(),
  reseller_id:       z.string().trim().max(80).optional(),
}).default({})

const hintOf = secret => secret ? '…' + String(secret).trim().slice(-4) : null

function venueChanged(venueId) {
  broadcast('pos:' + venueId, { type: 'pos.config' })
}

function accountView(a) {
  const s = a.settings || {}
  return {
    id: a.id, provider: a.provider, provider_label: PROVIDERS[a.provider]?.label || a.provider,
    name: a.name, hint: a.hint, mode: a.mode, connect: !!s.connect,
    settings: {
      merchant_code: s.merchant_code || null, merchant_name: s.merchant_name || null,
      software_house_id: s.software_house_id || null, reseller_id: s.reseller_id || null,
      locations: s.locations || [],
    },
    checked_at: a.checked_at, created_at: a.created_at, readers: Number(a.readers || 0),
  }
}

/** Ask the provider whether the key works; what it says goes into settings. `account` instead of a key: a connect-mode Stripe account (cardAccount()). */
async function checkAccount(providerKey, secret, settings, account = null) {
  const p = provider(providerKey)
  try {
    const r = await p.check(account || { provider: providerKey, secret: String(secret).trim(), settings })
    return {
      mode: r.mode ?? null,
      settings: {
        ...settings,
        ...(r.merchant_code ? { merchant_code: r.merchant_code, merchant_name: r.merchant_name || null } : {}),
        ...(r.locations ? { locations: r.locations } : {}),
      },
    }
  } catch (e) {
    throw httpError(422, e.message || 'The key didn\'t work', { code: e.code || 'card' })
  }
}

async function loadAccount(tx, tenantId, id) {
  const [a] = await tx`SELECT * FROM pos_card_accounts WHERE id = ${id} AND tenant_id = ${tenantId} AND removed_at IS NULL`
  if (!a) throw httpError(404, 'Card machine account not found')
  return a
}

export default async function cardSetupRoutes(app) {
  app.addHook('preHandler', requireAuth)

  app.get('/card-accounts', { preHandler: canView }, async req => {
    const rows = await withTenant(req.tenantId, tx => tx`
      SELECT a.*, (SELECT count(*) FROM pos_card_readers r WHERE r.account_id = a.id AND r.removed_at IS NULL) AS readers
        FROM pos_card_accounts a
       WHERE a.tenant_id = ${req.tenantId} AND a.removed_at IS NULL
       ORDER BY a.created_at`)
    return {
      accounts: rows.map(accountView),
      providers: PROVIDER_KEYS.map(k => ({ key: k, label: PROVIDERS[k].label, can_pair: !!PROVIDERS[k].canPair, needs_location: !!PROVIDERS[k].needsLocation })),
    }
  })

  app.post('/card-accounts', { preHandler: [canManage, keyHolder] }, async (req, reply) => {
    const b = z.object({
      provider: z.enum(PROVIDER_KEYS),
      name:     z.string().trim().min(1).max(60),
      secret:   z.string().trim().min(8).max(400).optional(),
      connect:  z.boolean().optional(),
      settings: AccountSettings,
    }).parse(req.body)
    if (b.connect) {
      // Stripe through the group's connected account: no key of its own.
      if (b.provider !== 'stripe') throw httpError(400, 'Only Stripe card machines can use your connected Stripe account')
      const t = await tenantStripe(req.tenantId)
      if (!t?.stripe_account_id) throw httpError(422, 'Connect your Stripe account first (Card machines, Your Stripe account)')
      if (!t.stripe_charges_enabled) throw httpError(422, 'Your Stripe account can\'t take payments yet: finish Stripe\'s sign-up first')
      const [dup] = await withTenant(req.tenantId, tx => tx`
        SELECT id FROM pos_card_accounts WHERE tenant_id = ${req.tenantId} AND removed_at IS NULL AND provider = 'stripe' AND (settings->>'connect')::boolean`)
      if (dup) throw httpError(409, 'Your connected Stripe account is already added')
      const settings = { connect: true }
      const checked = await checkAccount('stripe', null, settings, await cardAccount(req.tenantId, { provider: 'stripe', settings }))
      const [a] = await withTenant(req.tenantId, tx => tx`
        INSERT INTO pos_card_accounts (tenant_id, provider, name, secret, hint, mode, settings, checked_at, created_by)
        VALUES (${req.tenantId}, 'stripe', ${b.name}, NULL, NULL, ${checked.mode},
                ${tx.json({ ...checked.settings, connect: true })}, now(), ${by(req)})
        RETURNING *`)
      reply.code(201)
      return accountView(a)
    }
    if (!b.secret) throw httpError(400, 'Type the account\'s key')
    const checked = await checkAccount(b.provider, b.secret, b.settings)
    const [a] = await withTenant(req.tenantId, tx => tx`
      INSERT INTO pos_card_accounts (tenant_id, provider, name, secret, hint, mode, settings, checked_at, created_by)
      VALUES (${req.tenantId}, ${b.provider}, ${b.name}, ${seal(b.secret)}, ${hintOf(b.secret)}, ${checked.mode},
              ${tx.json(checked.settings)}, now(), ${by(req)})
      RETURNING *`)
    reply.code(201)
    return accountView(a)
  })

  app.patch('/card-accounts/:id', { preHandler: [canManage, keyHolder] }, async req => {
    const id = UUID.parse(req.params.id)
    const b = z.object({
      name:     z.string().trim().min(1).max(60).optional(),
      secret:   z.string().trim().min(8).max(400).optional(),
      settings: AccountSettings.optional(),
    }).parse(req.body)
    const before = await withTenant(req.tenantId, tx => loadAccount(tx, req.tenantId, id))
    if (before.settings?.connect && b.secret) throw httpError(422, 'This account is your connected Stripe account: it has no key of its own')
    let mode = before.mode
    let settings = before.settings || {}
    if (b.secret || b.settings) {
      const merged = { ...settings, ...(b.settings || {}) }
      const checked = before.settings?.connect
        ? await checkAccount('stripe', null, merged, await cardAccount(req.tenantId, { ...before, settings: merged }))
        : await checkAccount(before.provider, b.secret || unseal(before.secret), merged)
      mode = checked.mode
      settings = checked.settings
    }
    const [a] = await withTenant(req.tenantId, tx => tx`
      UPDATE pos_card_accounts
         SET name = COALESCE(${b.name ?? null}, name),
             secret = COALESCE(${b.secret ? seal(b.secret) : null}, secret),
             hint = COALESCE(${b.secret ? hintOf(b.secret) : null}, hint),
             mode = ${mode}, settings = ${tx.json(settings)},
             checked_at = CASE WHEN ${!!(b.secret || b.settings)} THEN now() ELSE checked_at END,
             updated_at = now()
       WHERE id = ${id} AND tenant_id = ${req.tenantId}
       RETURNING *`)
    return accountView(a)
  })

  app.post('/card-accounts/:id/check', { preHandler: canManage }, async req => {
    const id = UUID.parse(req.params.id)
    const a = await withTenant(req.tenantId, tx => loadAccount(tx, req.tenantId, id))
    const checked = await checkAccount(a.provider, null, a.settings || {}, await cardAccount(req.tenantId, a))
    const [row] = await withTenant(req.tenantId, tx => tx`
      UPDATE pos_card_accounts SET mode = ${checked.mode}, settings = ${tx.json(checked.settings)}, checked_at = now(), updated_at = now()
       WHERE id = ${id} AND tenant_id = ${req.tenantId} RETURNING *`)
    return accountView(row)
  })

  app.delete('/card-accounts/:id', { preHandler: [canManage, keyHolder] }, async req => {
    const id = UUID.parse(req.params.id)
    const venues = await withTenant(req.tenantId, async tx => {
      await loadAccount(tx, req.tenantId, id)
      const readers = await tx`
        UPDATE pos_card_readers SET removed_at = now()
         WHERE account_id = ${id} AND tenant_id = ${req.tenantId} AND removed_at IS NULL
         RETURNING id, venue_id`
      await forgetReaders(tx, req.tenantId, readers.map(r => r.id))
      await tx`UPDATE pos_card_accounts SET removed_at = now(), secret = NULL, updated_at = now() WHERE id = ${id} AND tenant_id = ${req.tenantId}`
      return [...new Set(readers.map(r => r.venue_id))]
    })
    venues.forEach(venueChanged)
    return { ok: true }
  })

  // A Stripe Terminal location for a venue, from its address (website
  // details); the new location joins the account's list.
  app.post('/card-accounts/:id/locations', { preHandler: canManage }, async (req, reply) => {
    const id = UUID.parse(req.params.id)
    const { venue_id } = z.object({ venue_id: UUID }).parse(req.body)
    const { a, v } = await withTenant(req.tenantId, async tx => {
      const acc = await loadAccount(tx, req.tenantId, id)
      const [venue] = await tx`
        SELECT v.id, v.name, wc.address_line1, wc.address_line2, wc.city, wc.postcode
          FROM venues v LEFT JOIN website_config wc ON wc.venue_id = v.id AND wc.tenant_id = v.tenant_id
         WHERE v.id = ${venue_id} AND v.tenant_id = ${req.tenantId}`
      return { a: acc, v: venue }
    })
    if (!v) throw httpError(404, 'Venue not found')
    const p = provider(a.provider)
    if (!p.createLocation) throw httpError(422, p.label + ' has no locations to make')
    if (!v.address_line1 || !v.city || !v.postcode) {
      throw httpError(422, 'Add ' + v.name + '\'s address first (Website, the location\'s Find us), or make the location in Stripe')
    }
    const account = await cardAccount(req.tenantId, a)
    let made
    try {
      made = await p.createLocation(account, {
        name: v.name,
        address: { line1: v.address_line1, line2: v.address_line2 || undefined, city: v.city, postal_code: v.postcode, country: 'GB' },
      })
    } catch (e) {
      throw httpError(422, e.message || 'Stripe didn\'t make the location', { code: e.code || 'card' })
    }
    const checked = await checkAccount(a.provider, null, a.settings || {}, account)
    const [row] = await withTenant(req.tenantId, tx => tx`
      UPDATE pos_card_accounts SET settings = ${tx.json(checked.settings)}, checked_at = now(), updated_at = now()
       WHERE id = ${id} AND tenant_id = ${req.tenantId} RETURNING *`)
    reply.code(201)
    return { location: made, account: accountView(row) }
  })

  app.get('/card-accounts/:id/readers', { preHandler: canManage }, async req => {
    const id = UUID.parse(req.params.id)
    const { a, added } = await withTenant(req.tenantId, async tx => ({
      a: await loadAccount(tx, req.tenantId, id),
      added: await tx`
        SELECT r.provider_reader_id, r.venue_id, v.name AS venue_name FROM pos_card_readers r
          JOIN venues v ON v.id = r.venue_id
         WHERE r.account_id = ${id} AND r.tenant_id = ${req.tenantId} AND r.removed_at IS NULL`,
    }))
    let list
    try {
      list = await provider(a.provider).listReaders(await cardAccount(req.tenantId, a))
    } catch (e) {
      throw httpError(422, e.message || 'The card machine list couldn\'t be read', { code: e.code || 'card' })
    }
    const at = Object.fromEntries(added.map(r => [r.provider_reader_id, { venue_id: r.venue_id, venue_name: r.venue_name }]))
    return list.map(r => ({ ...r, added_at: at[r.ref] || null }))
  })

  app.get('/venues/:venueId/card-readers', { preHandler: [canView, requireOwnVenue()] }, async req => {
    const venueId = UUID.parse(req.params.venueId)
    return withTenant(req.tenantId, async tx => {
      const readers = await tx`
        SELECT r.id, r.provider, r.provider_reader_id, r.name, r.model, r.serial, r.account_id, r.created_at,
               a.name AS account_name, a.mode
          FROM pos_card_readers r
          LEFT JOIN pos_card_accounts a ON a.id = r.account_id AND a.tenant_id = r.tenant_id
         WHERE r.tenant_id = ${req.tenantId} AND r.venue_id = ${venueId} AND r.removed_at IS NULL
         ORDER BY r.created_at`
      const devices = await tx`
        SELECT id, name, kind, settings->>'card_reader' AS card_reader FROM pos_devices
         WHERE tenant_id = ${req.tenantId} AND venue_id = ${venueId} AND revoked_at IS NULL AND kind IN ('terminal', 'kiosk')`
      return readers.map(r => ({
        ...r,
        provider_label: PROVIDERS[r.provider]?.label || r.provider,
        test: r.provider === 'test' || r.mode === 'test',
        devices: devices.filter(d => d.card_reader === r.id).map(d => ({ id: d.id, name: d.name, kind: d.kind })),
      }))
    })
  })

  app.post('/venues/:venueId/card-readers', { preHandler: [canManage, requireOwnVenue()] }, async (req, reply) => {
    const venueId = UUID.parse(req.params.venueId)
    const b = z.object({
      provider:           z.literal('test').optional(),
      account_id:         UUID.optional(),
      provider_reader_id: z.string().trim().min(1).max(120).optional(),
      code:               z.string().trim().min(3).max(40).optional(),
      location:           z.string().trim().max(80).optional(),
      name:               z.string().trim().min(1).max(60),
    }).parse(req.body)
    if (b.provider === 'test') {
      const [r] = await withTenant(req.tenantId, tx => tx`
        INSERT INTO pos_card_readers (tenant_id, venue_id, provider, name)
        VALUES (${req.tenantId}, ${venueId}, 'test', ${b.name}) RETURNING *`)
      venueChanged(venueId)
      reply.code(201)
      return r
    }
    if (!b.account_id || (!b.provider_reader_id && !b.code)) throw httpError(422, 'Pick the account and the card machine, or type the code it shows')
    const a = await withTenant(req.tenantId, tx => loadAccount(tx, req.tenantId, b.account_id))
    const p = provider(a.provider)
    const account = await cardAccount(req.tenantId, a)
    let found
    try {
      if (b.code) {
        if (!p.canPair) throw httpError(422, p.label + ' card machines are added from the list')
        found = await p.pairReader(account, { code: b.code, name: b.name, location: b.location })
      } else {
        found = (await p.listReaders(account)).find(r => r.ref === b.provider_reader_id)
        if (!found) throw httpError(422, 'That card machine isn\'t in the ' + p.label + ' account any more')
      }
    } catch (e) {
      if (e.statusCode) throw e
      throw httpError(422, e.message || 'The card machine couldn\'t be added', { code: e.code || 'card' })
    }
    const [r] = await withTenant(req.tenantId, async tx => {
      const [taken] = await tx`
        SELECT v.name FROM pos_card_readers r JOIN venues v ON v.id = r.venue_id
         WHERE r.account_id = ${a.id} AND r.provider_reader_id = ${found.ref} AND r.tenant_id = ${req.tenantId} AND r.removed_at IS NULL`
      if (taken) throw httpError(409, 'This card machine is already added at ' + taken.name)
      return tx`
        INSERT INTO pos_card_readers (tenant_id, venue_id, account_id, provider, provider_reader_id, name, model, serial, online, status_at)
        VALUES (${req.tenantId}, ${venueId}, ${a.id}, ${a.provider}, ${found.ref}, ${b.name}, ${found.model || null}, ${found.serial || null},
                ${found.online ?? null}, now())
        RETURNING *`
    })
    venueChanged(venueId)
    reply.code(201)
    return r
  })

  app.patch('/card-readers/:id', { preHandler: canManage }, async req => {
    const id = UUID.parse(req.params.id)
    const { name } = z.object({ name: z.string().trim().min(1).max(60) }).parse(req.body)
    const [r] = await withTenant(req.tenantId, tx => tx`
      UPDATE pos_card_readers SET name = ${name}
       WHERE id = ${id} AND tenant_id = ${req.tenantId} AND removed_at IS NULL RETURNING *`)
    if (!r) throw httpError(404, 'Card machine not found')
    venueChanged(r.venue_id)
    return r
  })

  app.delete('/card-readers/:id', { preHandler: canManage }, async req => {
    const id = UUID.parse(req.params.id)
    const r = await withTenant(req.tenantId, async tx => {
      const [r] = await tx`
        UPDATE pos_card_readers SET removed_at = now()
         WHERE id = ${id} AND tenant_id = ${req.tenantId} AND removed_at IS NULL RETURNING id, venue_id`
      if (!r) throw httpError(404, 'Card machine not found')
      await forgetReaders(tx, req.tenantId, [r.id])
      return r
    })
    venueChanged(r.venue_id)
    return { ok: true }
  })

  app.get('/venues/:venueId/card-payments', { preHandler: [canSeePayments, requireOwnVenue()] }, async req => {
    const venueId = UUID.parse(req.params.venueId)
    const q = z.object({
      days:   z.coerce.number().int().min(1).max(90).default(7),
      status: z.enum(['all', 'approved', 'problems', 'open']).default('all'),
    }).parse(req.query)
    const rows = await withTenant(req.tenantId, tx => tx`
      SELECT p.*, r.name AS reader_name, d.name AS device_name, s.name AS staff_name
        FROM pos_card_payments p
        JOIN pos_card_readers r ON r.id = p.reader_id
        LEFT JOIN pos_devices d ON d.id = p.device_id
        LEFT JOIN cash_staff s ON s.id = p.staff_id AND s.tenant_id = p.tenant_id
       WHERE p.tenant_id = ${req.tenantId} AND p.venue_id = ${venueId}
         AND p.created_at > now() - make_interval(days => ${q.days})
         ${q.status === 'approved' ? tx`AND p.status = 'approved'`
           : q.status === 'open' ? tx`AND p.status IN ('pending', 'signature')`
           : q.status === 'problems' ? tx`AND ((p.status = 'approved' AND p.used_event_id IS NULL) OR p.status IN ('pending', 'signature'))`
           : tx``}
       ORDER BY p.created_at DESC
       LIMIT 300`)
    return rows.map(p => ({
      ...paymentView(p),
      reader_name: p.reader_name, device_name: p.device_name, staff_name: p.staff_name,
      // Money taken that no check shows: settle it on the till or refund it on the machine.
      not_on_check: p.kind === 'sale' && p.status === 'approved' && !p.used_event_id,
    }))
  })
}

/** Tills and kiosks using these machines go back to none. */
async function forgetReaders(tx, tenantId, ids) {
  if (!ids.length) return
  await tx`
    UPDATE pos_devices SET settings = jsonb_set(settings, '{card_reader}', '"none"'::jsonb)
     WHERE tenant_id = ${tenantId} AND settings->>'card_reader' = ANY(${ids.map(String)}::text[])`
}
