// src/routes/orderApi.js
//
// Public web-ordering API (migration 122). Mounted at /order-api. No
// auth: the venue id in the URL decides the tenant, and an order is only
// reachable by its public token (like a booking's manage_token). CORS is
// open so the ordering page works on custom domains too.
//
//   GET  /pricing.js                                shared/orderPricing.js for the ordering page
//   GET  /promotions.js, /menuSchedule.js           the shared files pricing.js imports
//   POST /venues/:venueId/promo-code                check a promo code (migration 131)
//   GET  /venues/:venueId                           menu, settings, dates, payment methods
//   GET  /venues/:venueId/slots?date=YYYY-MM-DD     collection times for a day
//   POST /venues/:venueId/quote                     price a basket (display only)
//   POST /venues/:venueId/orders                    place an order, start its payment
//   GET  /orders/:token                             order status for the guest
//   POST /orders/:token/pay                         restart an unpaid order's payment
//   POST /orders/:token/payments/:paymentId/confirm the browser finished a payment step
//
// Every price is recalculated on the server (orderSvc.createOrder); the
// quote route is only a convenience for showing totals.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { sql, withTenant } from '../config/db.js'
import { httpError } from '../middleware/error.js'
import { getGateway, checkoutGateways } from '../services/paymentGateways/index.js'
import {
  loadSettings, loadOrderingMenu, loadPrivacy, publicItem, computeSlots, orderingDates, itemOffAt,
  createOrder, startPayment, applyPaymentResult, loadPublicOrderByToken, publicOrder, localParts,
} from '../services/orderSvc.js'
import { priceBasket } from '../../../shared/orderPricing.js'
import { venuePromotions, publicPromotion, findByCode } from '../services/promoSvc.js'
import { loadAllergenNotice } from './menus.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// shared/orderPricing.js imports ./promotions.js, which imports
// ./menuSchedule.js: all three are served side by side under /order-api,
// with ./menuTags.js (the allergen notice's key, migration 147).
const SHARED_JS = Object.fromEntries(['orderPricing', 'promotions', 'menuSchedule', 'menuTags'].map(n =>
  [n, readFileSync(path.join(__dirname, '../../../shared/' + n + '.js'), 'utf8')]))

const uuid = z.string().uuid()

const LineBody = z.object({
  item_id: uuid,
  qty:     z.number().int().min(1).max(99),
  choices: z.record(z.array(z.string().max(160)).max(20)).default({}),
  note:    z.string().max(300).nullable().optional(),
})

// Promotions the guest asked for: codes typed, manual offers tapped.
const PromoFields = {
  promo_codes: z.array(z.string().trim().min(1).max(40)).max(5).default([]),
  promo_ids:   z.array(uuid).max(20).default([]),
}

const QuoteBody = z.object({
  lines:       z.array(LineBody).max(100),
  tip_percent: z.number().int().min(0).max(50).default(0),
  ...PromoFields,
})

const OrderBody = z.object({
  lines:            z.array(LineBody).min(1).max(100),
  when:             z.union([z.literal('asap'), z.string().datetime()]),
  customer: z.object({
    name:  z.string().trim().min(1).max(120),
    email: z.string().trim().email().max(200),
    phone: z.string().trim().min(5).max(40),
  }),
  notes:            z.string().max(500).nullable().optional(),
  allergy_note:     z.string().max(500).nullable().optional(),
  // GDPR (migration 125): the guest must agree to the order-only use of
  // their details; the newsletter stays optional.
  data_consent:     z.literal(true, { errorMap: () => ({ message: 'Please agree to how we use your details for this order' }) }),
  marketing_opt_in: z.boolean().default(false),
  tip_percent:      z.number().int().min(0).max(50).default(0),
  payment_method:   z.string().min(1).max(40),
  ...PromoFields,
})

async function resolveVenue(venueId) {
  if (!uuid.safeParse(venueId).success) return null
  const [venue] = await sql`
    SELECT v.id, v.tenant_id, v.name, v.timezone, v.currency, v.slug,
           wc.address_line1, wc.city, wc.postcode, wc.phone
      FROM venues v
      JOIN tenants t ON t.id = v.tenant_id AND t.is_active = true
      LEFT JOIN website_config wc ON wc.venue_id = v.id
     WHERE v.id = ${venueId} AND v.is_active = true
     LIMIT 1
  `
  return venue ?? null
}

async function requireOrderingVenue(venueId) {
  const venue = await resolveVenue(venueId)
  if (!venue) throw httpError(404, 'Venue not found')
  const settings = await withTenant(venue.tenant_id, tx => loadSettings(tx, venue.id))
  if (!settings.is_enabled) throw httpError(404, 'Online ordering is not available here')
  return { venue, settings }
}

function publicStatus(res, venue) {
  const { order, items, promotions } = res
  return publicOrder(order, items, venue, promotions)
}

export default async function orderApiRoutes(app) {
  app.addHook('onRequest', async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*')
    reply.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    reply.header('Access-Control-Allow-Headers', 'Content-Type')
    reply.header('Cache-Control', 'no-store')
  })
  app.options('/*', async (req, reply) => reply.code(204).send())

  const serveJs = name => async (req, reply) => {
    reply.header('Cache-Control', 'public, max-age=300')
    reply.type('application/javascript; charset=utf-8')
    return SHARED_JS[name]
  }
  app.get('/pricing.js', serveJs('orderPricing'))
  app.get('/promotions.js', serveJs('promotions'))
  app.get('/menuSchedule.js', serveJs('menuSchedule'))
  app.get('/menuTags.js', serveJs('menuTags'))

  app.get('/venues/:venueId', async (req) => {
    const { venue, settings } = await requireOrderingVenue(req.params.venueId)
    const today = localParts(new Date(), venue.timezone).date
    const [menu, privacy, promos, allergenNotice] = await withTenant(venue.tenant_id, async tx => [
      await loadOrderingMenu(tx, venue, settings, { dates: orderingDates(venue, settings), now: new Date() }),
      await loadPrivacy(tx, venue.tenant_id),
      await venuePromotions(tx, venue, today),
      await loadAllergenNotice(tx, venue.tenant_id),
    ])
    const gateways = checkoutGateways(settings, { venue })
    return {
      venue: {
        id: venue.id, name: venue.name, slug: venue.slug, timezone: venue.timezone, currency: venue.currency || 'GBP',
        address_line1: venue.address_line1, city: venue.city, postcode: venue.postcode, phone: venue.phone,
      },
      ordering: {
        is_paused: settings.is_paused,
        pause_message: settings.is_paused ? (settings.pause_message || null) : null,
        allow_asap: settings.allow_asap,
        min_order_pence: settings.min_order_pence,
        tips_enabled: settings.tips_enabled,
        tip_percents: settings.tips_enabled ? settings.tip_percents : [],
        collection_instructions: settings.collection_instructions,
        dates: orderingDates(venue, settings),
        today: localParts(new Date(), venue.timezone).date,
        payment_methods: gateways.map(g => ({ key: g.key, label: g.label, online: !!g.online })),
      },
      menus: menu.menus.map(m => ({ ...m, sections: m.sections.map(s => ({ ...s, items: s.items.map(publicItem) })) })),
      dietary_tags: menu.dietary_tags,
      allergen_notice: allergenNotice,   // migration 147
      privacy,
      // Automatic and tap-to-apply offers; a code offer only reaches the
      // guest through /promo-code, once they have typed its code.
      promotions: promos.filter(p => p.apply_mode !== 'code').map(p => publicPromotion(p)),
      has_promo_codes: promos.some(p => p.apply_mode === 'code'),
    }
  })

  // A promo code typed at the basket: the offer it opens, so the page can
  // show the discount (the server applies it again when the order is placed).
  app.post('/venues/:venueId/promo-code', async (req) => {
    const { venue } = await requireOrderingVenue(req.params.venueId)
    const { code } = z.object({ code: z.string().trim().min(1).max(40) }).parse(req.body || {})
    const today = localParts(new Date(), venue.timezone).date
    const promos = await withTenant(venue.tenant_id, tx => venuePromotions(tx, venue, today))
    const p = findByCode(promos, code)
    if (!p) throw httpError(404, "That code isn't valid")
    return { promotion: publicPromotion(p, { withCode: true }) }
  })

  app.get('/venues/:venueId/slots', async (req) => {
    const { venue, settings } = await requireOrderingVenue(req.params.venueId)
    const date = String(req.query?.date || localParts(new Date(), venue.timezone).date)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw httpError(400, 'date must be YYYY-MM-DD')
    // ?items=id,id (the basket): only times when every dish is on its menu.
    const itemIds = String(req.query?.items || '').split(',').filter(id => uuid.safeParse(id).success).slice(0, 100)
    return withTenant(venue.tenant_id, async tx => {
      let isOn = null
      if (itemIds.length) {
        const { itemMenus } = await loadOrderingMenu(tx, venue, settings)
        const dow = new Date(date + 'T00:00:00Z').getUTCDay()
        isOn = minutes => !itemOffAt(itemIds.filter(id => itemMenus[id]), itemMenus, settings, { date, dow, minutes })
      }
      return computeSlots(tx, { venue, settings, date, isOn })
    })
  })

  app.post('/venues/:venueId/quote', async (req) => {
    const { venue, settings } = await requireOrderingVenue(req.params.venueId)
    const body = QuoteBody.parse(req.body)
    const at = localParts(new Date(), venue.timezone)
    const [{ itemsById }, promos] = await withTenant(venue.tenant_id, async tx => [
      await loadOrderingMenu(tx, venue, settings),
      await venuePromotions(tx, venue, at.date),
    ])
    const tip = settings.tips_enabled && settings.tip_percents.includes(body.tip_percent) ? body.tip_percent : 0
    const unlocked = body.promo_codes.map(c => findByCode(promos, c)?.id).filter(Boolean)
    const q = priceBasket(itemsById, body.lines, {
      tipPercent: tip, promos, promoCtx: { at, venueId: venue.id, unlocked, chosen: body.promo_ids },
    })
    return { ...q, min_order_pence: settings.min_order_pence }
  })

  app.post('/venues/:venueId/orders', async (req, reply) => {
    const venue = await resolveVenue(req.params.venueId)
    if (!venue) throw httpError(404, 'Venue not found')
    const parsed = OrderBody.safeParse(req.body)
    if (!parsed.success) {
      const first = parsed.error.issues[0]
      const msg = !first ? 'Invalid order' : first.path[0] === 'data_consent' ? first.message : `${first.path.join('.')}: ${first.message}`
      throw httpError(400, msg)
    }
    const res = await createOrder({ venue, body: parsed.data })
    return reply.code(201).send({
      token: res.order.public_token,
      order_number: res.order.order_number,
      status: res.order.status,
      payment: res.client,
    })
  })

  app.get('/orders/:token', async (req) => {
    if (!uuid.safeParse(req.params.token).success) throw httpError(404, 'Order not found')
    const res = await loadPublicOrderByToken(req.params.token)
    if (!res) throw httpError(404, 'Order not found')
    return publicStatus(res, res.venue)
  })

  // Try the payment again (e.g. after a declined card).
  app.post('/orders/:token/pay', async (req) => {
    if (!uuid.safeParse(req.params.token).success) throw httpError(404, 'Order not found')
    const res = await loadPublicOrderByToken(req.params.token)
    if (!res) throw httpError(404, 'Order not found')
    if (res.order.status !== 'pending_payment') throw httpError(409, 'This order does not need paying')
    const venue = await resolveVenue(res.order.venue_id)
    const settings = await withTenant(venue.tenant_id, tx => loadSettings(tx, venue.id))
    const gateway = getGateway(res.order.payment_method)
    if (!gateway) throw httpError(422, 'That payment method is not available')
    const started = await startPayment(venue, res.order, settings, gateway)
    return { status: started.order.status, payment: started.client }
  })

  app.post('/orders/:token/payments/:paymentId/confirm', async (req) => {
    if (!uuid.safeParse(req.params.token).success || !uuid.safeParse(req.params.paymentId).success) {
      throw httpError(404, 'Payment not found')
    }
    const res = await loadPublicOrderByToken(req.params.token)
    if (!res) throw httpError(404, 'Order not found')
    const [payment] = await withTenant(res.order.tenant_id, tx => tx`
      SELECT * FROM order_payments WHERE id = ${req.params.paymentId} AND order_id = ${res.order.id}
    `)
    if (!payment) throw httpError(404, 'Payment not found')
    const gateway = getGateway(payment.gateway)
    if (!gateway?.confirmFromClient) throw httpError(409, 'This payment is confirmed by the payment provider')
    const result = await gateway.confirmFromClient({ payment, body: req.body || {} })
    await applyPaymentResult(res.order.tenant_id, payment.id, result)
    const fresh = await loadPublicOrderByToken(req.params.token)
    return publicStatus(fresh, fresh.venue)
  })
}

// Webhooks from payment providers: POST /webhooks/payments/:gateway.
// Registered at the root with a raw-body parser so a gateway can check
// the provider's signature over the exact bytes it sent.
export async function paymentWebhookRoutes(app) {
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => done(null, body))

  app.post('/webhooks/payments/:gateway', async (req, reply) => {
    const gateway = getGateway(req.params.gateway)
    if (!gateway?.parseWebhook) return reply.code(404).send({ error: 'Unknown gateway' })
    let event
    try {
      event = await gateway.parseWebhook({ rawBody: req.body, headers: req.headers })
    } catch (err) {
      req.log.warn({ err, gateway: gateway.key }, 'Payment webhook rejected')
      return reply.code(400).send({ error: 'Invalid webhook' })
    }
    if (!event?.ref) return { received: true }
    const [payment] = await sql`
      SELECT id, tenant_id FROM order_payments WHERE gateway = ${gateway.key} AND gateway_ref = ${event.ref} LIMIT 1
    `
    if (!payment) {
      req.log.warn({ gateway: gateway.key, ref: event.ref }, 'Payment webhook for an unknown payment')
      return { received: true }
    }
    await applyPaymentResult(payment.tenant_id, payment.id, { status: event.status, raw: event.raw || {} })
    return { received: true }
  })
}
