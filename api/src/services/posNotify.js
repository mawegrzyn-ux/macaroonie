// src/services/posNotify.js
//
// Tell a tenant's open tills to download their config again (pos.config
// over the socket, see pos/src/lib/store.js) after something they show
// changed outside Store tech: menus, option groups, promotions. Tills also
// refresh every 10 minutes and when brought back to the screen, so this is
// only about speed. Fire-and-forget, at most once a second per tenant.
// Kept apart from posSvc.js, which imports routes/menus.js.

import { withTenant } from '../config/db.js'
import { broadcast } from '../config/ws.js'

const pending = new Map()   // tenantId -> timer

export function tillsMayNeedConfig(tenantId, log) {
  if (!tenantId || pending.has(tenantId)) return
  pending.set(tenantId, setTimeout(async () => {
    pending.delete(tenantId)
    try {
      const rows = await withTenant(tenantId, tx => tx`
        SELECT DISTINCT venue_id FROM pos_devices WHERE tenant_id = ${tenantId} AND revoked_at IS NULL`)
      for (const r of rows) broadcast('pos:' + r.venue_id, { type: 'pos.config' })
    } catch (e) {
      log?.warn?.({ err: e }, 'pos config notify failed')
    }
  }, 1000))
}

/** Fastify onResponse hook: any successful write in the plugin notifies the tills. */
export function notifyTillsOnWrite(req, reply, done) {
  if (req.method !== 'GET' && req.method !== 'HEAD' && reply.statusCode < 400 && req.tenantId) {
    tillsMayNeedConfig(req.tenantId, req.log)
  }
  done()
}
