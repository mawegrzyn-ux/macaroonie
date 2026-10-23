// src/routes/printDesigns.js
//
// Designs for printed kitchen tickets and receipts, /api/pos (migration 190;
// shared/pos/ticketLayout.js, services/printDesignSvc.js). Company wide, with
// which design prints where per location and each location's own words.
// Store tech view to read, manage to change.
//
//   GET    /print-designs?venue_id=            designs + which prints where (company, and that venue)
//   POST   /print-designs                      { kind, name, copy_from?, layout? }
//   GET    /print-designs/:id                  a design, every location's changes, where it is used
//   PUT    /print-designs/:id                  { name, layout }
//   DELETE /print-designs/:id                  places using it go back to the company's or the built-in one
//   PUT    /print-designs/:id/variations/:venueId   { texts, hidden } this location's words and hidden blocks
//   PUT    /print-design-uses                  { venue_id | null, use, design_id | null }
//
// A change tells every till and kiosk of the company to download its config
// again (pos.config), since designs and company choices reach every venue.

import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requirePermission } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { broadcast } from '../config/ws.js'
import { LAYOUT_KINDS, USE_KEYS, kindOfUse, normaliseLayout, normaliseVariation, defaultLayout } from '../../../shared/pos/ticketLayout.js'
import { designView, loadUses } from '../services/printDesignSvc.js'

const canView = requirePermission('pos_setup', 'view')
const canManage = requirePermission('pos_setup', 'manage')
const UUID = z.string().uuid()
const by = req => req.user?.email ?? null
const MAX_DESIGNS = 50
const Layout = z.object({ blocks: z.array(z.any()).max(60) }).passthrough()

async function ownDesignRow(tx, tenantId, id) {
  const [d] = await tx`SELECT * FROM print_designs WHERE id = ${id} AND tenant_id = ${tenantId}`
  if (!d) throw httpError(404, 'Print design not found')
  return d
}

async function ownVenueId(tx, tenantId, venueId) {
  const [v] = await tx`SELECT id FROM venues WHERE id = ${venueId} AND tenant_id = ${tenantId}`
  if (!v) throw httpError(404, 'Venue not found')
  return v.id
}

/** Every till and kiosk of the company downloads its config again. */
async function companyChanged(tx, tenantId) {
  const rows = await tx`SELECT id FROM venues WHERE tenant_id = ${tenantId}`
  for (const r of rows) broadcast('pos:' + r.id, { type: 'pos.config' })
}

export default async function printDesignRoutes(app) {
  app.addHook('preHandler', requireAuth)

  app.get('/print-designs', { preHandler: canView }, async req => {
    const venueId = req.query.venue_id ? UUID.parse(req.query.venue_id) : null
    return withTenant(req.tenantId, async tx => {
      if (venueId) await ownVenueId(tx, req.tenantId, venueId)
      const rows = await tx`SELECT * FROM print_designs WHERE tenant_id = ${req.tenantId} ORDER BY kind, lower(name), created_at`
      const uses = await loadUses(tx, req.tenantId)
      return {
        designs: rows.map(designView),
        uses: { company: uses.company, venue: venueId ? uses.venues[venueId] || {} : null },
        // Where each design is used, for the list and the delete confirm.
        used_at: Object.fromEntries(rows.map(d => [d.id, [
          ...Object.entries(uses.company).filter(([, id]) => id === d.id).map(([use]) => ({ venue_id: null, use })),
          ...Object.entries(uses.venues).flatMap(([vid, m]) => Object.entries(m).filter(([, id]) => id === d.id).map(([use]) => ({ venue_id: vid, use }))),
        ]])),
        defaults: Object.fromEntries(LAYOUT_KINDS.map(k => [k, defaultLayout(k)])),
      }
    })
  })

  app.post('/print-designs', { preHandler: canManage }, async (req, reply) => {
    const b = z.object({
      kind: z.enum(LAYOUT_KINDS),
      name: z.string().trim().min(1).max(80),
      copy_from: UUID.nullable().optional(),
      layout: Layout.optional(),
    }).parse(req.body || {})
    const row = await withTenant(req.tenantId, async tx => {
      const [{ n }] = await tx`SELECT count(*)::int AS n FROM print_designs WHERE tenant_id = ${req.tenantId}`
      if (n >= MAX_DESIGNS) throw httpError(422, 'A company can have up to ' + MAX_DESIGNS + ' print designs')
      let layout = b.layout ? normaliseLayout(b.kind, b.layout) : defaultLayout(b.kind)
      if (b.copy_from) {
        const src = await ownDesignRow(tx, req.tenantId, b.copy_from)
        if (src.kind !== b.kind) throw httpError(422, 'A ' + src.kind + ' design can\'t be copied into a ' + b.kind + ' design')
        layout = normaliseLayout(src.kind, src.layout)
      }
      const [d] = await tx`
        INSERT INTO print_designs (tenant_id, kind, name, layout, created_by, updated_by)
        VALUES (${req.tenantId}, ${b.kind}, ${b.name}, ${tx.json(layout)}, ${by(req)}, ${by(req)})
        RETURNING *`
      return d
    })
    return reply.code(201).send(designView(row))
  })

  app.get('/print-designs/:id', { preHandler: canView }, async req => {
    const id = UUID.parse(req.params.id)
    return withTenant(req.tenantId, async tx => {
      const d = await ownDesignRow(tx, req.tenantId, id)
      const view = designView(d)
      const [variations, uses] = await Promise.all([
        tx`SELECT venue_id, texts, hidden, updated_at, updated_by FROM print_design_variations WHERE tenant_id = ${req.tenantId} AND design_id = ${id}`,
        tx`SELECT venue_id, use FROM print_design_uses WHERE tenant_id = ${req.tenantId} AND design_id = ${id}`,
      ])
      return {
        ...view,
        variations: Object.fromEntries(variations.map(v => [v.venue_id, { ...normaliseVariation(view.layout, v), updated_at: v.updated_at, updated_by: v.updated_by }])),
        used_at: uses.map(u => ({ venue_id: u.venue_id, use: u.use })),
      }
    })
  })

  app.put('/print-designs/:id', { preHandler: canManage }, async req => {
    const id = UUID.parse(req.params.id)
    const b = z.object({ name: z.string().trim().min(1).max(80), layout: Layout }).parse(req.body || {})
    return withTenant(req.tenantId, async tx => {
      const d = await ownDesignRow(tx, req.tenantId, id)
      const layout = normaliseLayout(d.kind, b.layout)
      const [row] = await tx`
        UPDATE print_designs SET name = ${b.name}, layout = ${tx.json(layout)}, updated_at = now(), updated_by = ${by(req)}
         WHERE id = ${id} AND tenant_id = ${req.tenantId} RETURNING *`
      // Words and hidden blocks for blocks no longer in the design go.
      const vars = await tx`SELECT venue_id, texts, hidden FROM print_design_variations WHERE tenant_id = ${req.tenantId} AND design_id = ${id}`
      for (const v of vars) {
        const clean = normaliseVariation(layout, v)
        await tx`UPDATE print_design_variations SET texts = ${tx.json(clean.texts)}, hidden = ${clean.hidden}
                  WHERE tenant_id = ${req.tenantId} AND venue_id = ${v.venue_id} AND design_id = ${id}`
      }
      await companyChanged(tx, req.tenantId)
      return designView(row)
    })
  })

  app.delete('/print-designs/:id', { preHandler: canManage }, async req => {
    const id = UUID.parse(req.params.id)
    return withTenant(req.tenantId, async tx => {
      await ownDesignRow(tx, req.tenantId, id)
      await tx`DELETE FROM print_designs WHERE id = ${id} AND tenant_id = ${req.tenantId}`
      await companyChanged(tx, req.tenantId)
      return { ok: true }
    })
  })

  app.put('/print-designs/:id/variations/:venueId', { preHandler: canManage }, async req => {
    const id = UUID.parse(req.params.id)
    const venueId = UUID.parse(req.params.venueId)
    const b = z.object({
      texts: z.record(z.record(z.string().max(300))).default({}),
      hidden: z.array(z.string().max(40)).max(60).default([]),
    }).parse(req.body || {})
    return withTenant(req.tenantId, async tx => {
      const d = await ownDesignRow(tx, req.tenantId, id)
      await ownVenueId(tx, req.tenantId, venueId)
      const clean = normaliseVariation(normaliseLayout(d.kind, d.layout), b)
      if (!Object.keys(clean.texts).length && !clean.hidden.length) {
        await tx`DELETE FROM print_design_variations WHERE tenant_id = ${req.tenantId} AND venue_id = ${venueId} AND design_id = ${id}`
      } else {
        await tx`
          INSERT INTO print_design_variations (tenant_id, venue_id, design_id, texts, hidden, updated_by)
          VALUES (${req.tenantId}, ${venueId}, ${id}, ${tx.json(clean.texts)}, ${clean.hidden}, ${by(req)})
          ON CONFLICT (venue_id, design_id) DO UPDATE
            SET texts = EXCLUDED.texts, hidden = EXCLUDED.hidden, updated_at = now(), updated_by = EXCLUDED.updated_by`
      }
      broadcast('pos:' + venueId, { type: 'pos.config' })
      return clean
    })
  })

  app.put('/print-design-uses', { preHandler: canManage }, async req => {
    const b = z.object({
      venue_id: UUID.nullable(),
      use: z.enum(USE_KEYS),
      design_id: UUID.nullable(),
    }).parse(req.body || {})
    return withTenant(req.tenantId, async tx => {
      if (b.venue_id) await ownVenueId(tx, req.tenantId, b.venue_id)
      if (b.design_id) {
        const d = await ownDesignRow(tx, req.tenantId, b.design_id)
        if (d.kind !== kindOfUse(b.use)) throw httpError(422, 'Pick a ' + kindOfUse(b.use) + ' design for this')
      }
      if (b.venue_id) await tx`DELETE FROM print_design_uses WHERE tenant_id = ${req.tenantId} AND venue_id = ${b.venue_id} AND use = ${b.use}`
      else await tx`DELETE FROM print_design_uses WHERE tenant_id = ${req.tenantId} AND venue_id IS NULL AND use = ${b.use}`
      if (b.design_id) {
        await tx`INSERT INTO print_design_uses (tenant_id, venue_id, use, design_id, updated_by)
                 VALUES (${req.tenantId}, ${b.venue_id}, ${b.use}, ${b.design_id}, ${by(req)})`
      }
      if (b.venue_id) broadcast('pos:' + b.venue_id, { type: 'pos.config' })
      else await companyChanged(tx, req.tenantId)
      const uses = await loadUses(tx, req.tenantId, b.venue_id)
      return { company: uses.company, venue: b.venue_id ? uses.venues[b.venue_id] || {} : null }
    })
  })
}
