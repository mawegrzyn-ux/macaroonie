// src/routes/notices.js
//
// Each person's own push notices (migration 262, services/notices.js),
// mounted at /api/notices. Open to everyone signed in: a person only ever
// reads and changes their own settings and devices, and only gets notices
// for the tasks they can act on.
//
//   GET    /settings        { settings, devices, vapid_public_key, areas, kinds }
//   PUT    /settings        the whole settings (a whole save)
//   POST   /devices         { kind: web | app, token, label } -> { id }
//   DELETE /devices/:id
//   POST   /test            a test notice to this person's devices

import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { seal } from '../services/vault.js'
import {
  vapidKeys, settingsOf, tokenHash, sendToDevices, AREA_LABELS, DEFAULT_SETTINGS,
} from '../services/notices.js'

const UUID = z.string().uuid()
const TIME = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'A time like 22:00')

const SettingsBody = z.object({
  enabled:    z.boolean(),
  venue_ids:  z.array(UUID).max(200),
  areas:      z.array(z.enum(Object.keys(AREA_LABELS))).max(20),
  due_soon:   z.boolean(),
  late:       z.boolean(),
  quiet_from: TIME.nullable(),
  quiet_to:   TIME.nullable(),
}).refine(b => (b.quiet_from == null) === (b.quiet_to == null), { message: 'Give both ends of the quiet hours, or neither' })

// A browser's push subscription (PushSubscription.toJSON()), or the app's Expo token.
const WebSubscription = z.object({
  endpoint: z.string().url().max(1000).refine(u => u.startsWith('https://'), 'A push address starts with https://'),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(10).max(100) }),
})
const DeviceBody = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('web'), token: WebSubscription, label: z.string().trim().max(80).optional() }),
  z.object({ kind: z.literal('app'), token: z.string().regex(/^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,200}\]$/, 'An Expo push token'), label: z.string().trim().max(80).optional() }),
])

const deviceView = d => ({ id: d.id, kind: d.kind, label: d.label, created_at: d.created_at, last_seen_at: d.last_seen_at, last_error: d.last_error })

export default async function noticesRoutes(app) {
  app.addHook('preHandler', requireAuth)
  app.addHook('preHandler', async req => {
    if (!req.tenantId) throw httpError(400, 'Choose a restaurant group first')
  })

  app.get('/settings', async req => {
    const sub = req.user.sub
    const [row, devices] = await withTenant(req.tenantId, async tx => [
      (await tx`SELECT * FROM user_notify WHERE tenant_id = ${req.tenantId} AND user_sub = ${sub}`)[0],
      await tx`SELECT * FROM push_devices WHERE tenant_id = ${req.tenantId} AND user_sub = ${sub} ORDER BY created_at`,
    ])
    return {
      settings: settingsOf(row ? { ...row, quiet_from: row.quiet_from, quiet_to: row.quiet_to } : null),
      devices: devices.map(deviceView),
      vapid_public_key: (await vapidKeys()).publicKey,
      areas: Object.entries(AREA_LABELS).map(([key, label]) => ({ key, label })),
    }
  })

  app.put('/settings', async req => {
    const b = SettingsBody.parse(req.body)
    return withTenant(req.tenantId, async tx => {
      // Every venue named must be this group's.
      if (b.venue_ids.length) {
        const found = await tx`SELECT id FROM venues WHERE tenant_id = ${req.tenantId} AND id = ANY(${b.venue_ids}::uuid[])`
        if (found.length !== new Set(b.venue_ids).size) throw httpError(404, 'Venue not found')
      }
      const [row] = await tx`
        INSERT INTO user_notify (tenant_id, user_sub, enabled, venue_ids, areas, due_soon, late, quiet_from, quiet_to)
        VALUES (${req.tenantId}, ${req.user.sub}, ${b.enabled}, ${b.venue_ids}::uuid[], ${b.areas}::text[], ${b.due_soon}, ${b.late},
                ${b.quiet_from}::time, ${b.quiet_to}::time)
        ON CONFLICT (tenant_id, user_sub) DO UPDATE SET
          enabled = EXCLUDED.enabled, venue_ids = EXCLUDED.venue_ids, areas = EXCLUDED.areas,
          due_soon = EXCLUDED.due_soon, late = EXCLUDED.late,
          quiet_from = EXCLUDED.quiet_from, quiet_to = EXCLUDED.quiet_to, updated_at = now()
        RETURNING *`
      return { settings: settingsOf(row) }
    })
  })

  app.post('/devices', async (req, reply) => {
    const b = DeviceBody.parse(req.body)
    const raw = b.kind === 'web' ? JSON.stringify(b.token) : b.token
    const hash = tokenHash(b.kind === 'web' ? b.token.endpoint : b.token)
    const [row] = await withTenant(req.tenantId, tx => tx`
      INSERT INTO push_devices (tenant_id, user_sub, kind, token, token_hash, label)
      VALUES (${req.tenantId}, ${req.user.sub}, ${b.kind}, ${seal(raw)}, ${hash}, ${b.label ?? null})
      ON CONFLICT (tenant_id, token_hash) DO UPDATE SET
        user_sub = EXCLUDED.user_sub, token = EXCLUDED.token, label = COALESCE(EXCLUDED.label, push_devices.label),
        last_seen_at = now(), last_error = NULL
      RETURNING *`)
    reply.code(201)
    return deviceView(row)
  })

  app.delete('/devices/:id', async req => {
    const id = UUID.parse(req.params.id)
    const [row] = await withTenant(req.tenantId, tx => tx`
      DELETE FROM push_devices WHERE id = ${id} AND tenant_id = ${req.tenantId} AND user_sub = ${req.user.sub}
      RETURNING id`)
    if (!row) throw httpError(404, 'Device not found')
    return { ok: true }
  })

  app.post('/test', async req => {
    const devices = await withTenant(req.tenantId, tx => tx`
      SELECT id, kind, token FROM push_devices WHERE tenant_id = ${req.tenantId} AND user_sub = ${req.user.sub}`)
    if (!devices.length) throw httpError(422, 'Turn notices on on this device first.')
    const reached = await sendToDevices(req.tenantId, devices, {
      title: 'Notices are working', body: 'Late and due-soon tasks will come here.', url: '/today', tag: 'test',
    })
    return { sent: reached, devices: devices.length }
  })
}

export { DEFAULT_SETTINGS }
