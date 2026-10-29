// src/routes/stripe.js
//
// The group's own Stripe account, linked with Stripe Connect (migration 215,
// services/stripeConnect.js), used by online ordering's Card (Stripe)
// payment method and by Store tech's Stripe card machines in connect mode.
//
//   GET    /api/stripe            what Stripe last said (view on Ordering
//                                 setup or Store tech)
//   POST   /api/stripe/refresh    ask Stripe again, register the site's
//                                 addresses for Apple Pay / Google Pay
//   POST   /api/stripe/connect    { return_url } -> { url }: Stripe's sign-up
//                                 page (owner / admin with manage on either)
//   DELETE /api/stripe            unlink the account here (the account
//                                 itself stays at Stripe)
//
//   GET    /api/platform/stripe   the platform's keys: where each comes from
//                                 and its last four (platform admins)
//   PUT    /api/platform/stripe   { secret?, publishable?, webhook? }: save
//                                 (the secret key is checked with Stripe),
//                                 null removes, left out keeps

import { z } from 'zod'
import { requireAuth, requireRole, requireAnyPermission, requirePlatformAdmin } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import {
  tenantStripe, stripeView, refreshAccount, onboardingLink, forgetAccount, safeReturnUrl,
  platformKeysInfo, savePlatformKeys,
} from '../services/stripeConnect.js'

const MODULES = ['web_ordering_setup', 'pos_setup']
const PERM = {
  view:   requireAnyPermission(MODULES, 'view'),
  manage: [requireRole('admin', 'owner'), requireAnyPermission(MODULES, 'manage')],
}

const ConnectBody = z.object({ return_url: z.string().url().max(500) })
const KeysBody = z.object({
  secret:      z.string().trim().max(300).nullable().optional(),
  publishable: z.string().trim().max(300).nullable().optional(),
  webhook:     z.string().trim().max(300).nullable().optional(),
})

export default async function stripeRoutes(app) {
  app.get('/api/stripe', { preHandler: [requireAuth, PERM.view] }, async (req) =>
    stripeView(await tenantStripe(req.tenantId)))

  app.post('/api/stripe/refresh', {
    preHandler: [requireAuth, PERM.view],
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (req) => refreshAccount(req.tenantId))

  app.post('/api/stripe/connect', {
    preHandler: [requireAuth, ...PERM.manage],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req) => {
    const { return_url } = ConnectBody.parse(req.body)
    const back = safeReturnUrl(return_url)
    if (!back) throw httpError(400, 'Stripe can only send you back to this admin')
    const join = (u, flag) => { const x = new URL(u); x.searchParams.set('stripe', flag); return x.toString() }
    const link = await onboardingLink(req.tenantId, {
      email: req.user?.email || null,
      returnUrl: join(back, 'return'),
      refreshUrl: join(back, 'refresh'),
    })
    req.log.info({ tenant: req.tenantId, by: req.user?.email }, 'Stripe sign-up link made')
    return link
  })

  app.delete('/api/stripe', { preHandler: [requireAuth, ...PERM.manage] }, async (req) => {
    req.log.info({ tenant: req.tenantId, by: req.user?.email }, 'Stripe account unlinked')
    return forgetAccount(req.tenantId)
  })

  const admin = { preHandler: [requireAuth, requirePlatformAdmin] }
  app.get('/api/platform/stripe', admin, async () => platformKeysInfo())
  app.put('/api/platform/stripe', {
    ...admin,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req) => {
    const body = KeysBody.parse(req.body)
    const values = Object.fromEntries(Object.entries(body).map(([k, v]) => [k, v === '' ? undefined : v]).filter(([, v]) => v !== undefined))
    return savePlatformKeys(values, req.user?.email)
  })
}
