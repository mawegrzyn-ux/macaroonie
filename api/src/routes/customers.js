// src/routes/customers.js
//
// Customer profile management + GDPR endpoints.
//
// Routes:
//   GET  /customers                  search / list recent
//   GET  /customers/:id              detail + booking history
//   PATCH /customers/:id             update name / phone / notes
//   POST /customers/:id/anonymise    GDPR right to erasure (anonymises, never deletes)
//   GET  /customers/:id/export       GDPR data export (JSON download)
//
// upsertCustomer() is exported and called from bookings.js on every
// booking confirm so the customer DB grows automatically.

import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { requireRole } from '../middleware/auth.js'

function httpError(code, msg) {
  const e = new Error(msg)
  e.statusCode = code
  return e
}

// Emails that never map to a real customer
const SKIP_EMAILS = new Set(['walkin@walkin.com', 'tbc@placeholder.com'])

// ── Shared helper — call from inside an existing withTenant transaction ────────
// Upserts a customer by email (case-insensitive).
// Returns the customer UUID, or null if email is missing / a skip-email.
export async function upsertCustomer(tx, tenantId, { name, email, phone }) {
  if (!email || SKIP_EMAILS.has(email)) return null

  const [existing] = await tx`
    SELECT id FROM customers
     WHERE tenant_id     = ${tenantId}
       AND lower(email)  = lower(${email})
       AND is_anonymised = false
  `

  if (existing) {
    await tx`
      UPDATE customers
         SET name       = ${name},
             phone      = ${phone ?? null},
             updated_at = now()
       WHERE id = ${existing.id}
    `
    return existing.id
  }

  const [created] = await tx`
    INSERT INTO customers (tenant_id, name, email, phone)
    VALUES (${tenantId}, ${name}, ${email}, ${phone ?? null})
    RETURNING id
  `
  return created.id
}

// ── Route plugin ───────────────────────────────────────────────────────────────
export default async function customersRoutes(app) {

  // ── GET /customers?q=search&limit=20 ───────────────────────
  // q < 2 chars → return 20 most-recently-updated customers.
  // q >= 2 chars → full-text search across name, email, phone.
  app.get('/', { preHandler: requireRole('admin', 'owner', 'operator') }, async (req) => {
    const { q = '', limit = '20' } = req.query
    const lim = Math.min(parseInt(limit, 10) || 20, 100)

    if (q.length < 2) {
      return withTenant(req.tenantId, tx => tx`
        SELECT id, name, email, phone, is_anonymised, created_at, updated_at
          FROM customers
         WHERE is_anonymised = false
         ORDER BY updated_at DESC
         LIMIT ${lim}
      `)
    }

    return withTenant(req.tenantId, tx => tx`
      SELECT id, name, email, phone, is_anonymised, created_at, updated_at
        FROM customers
       WHERE is_anonymised = false
         AND (
               lower(name)                       LIKE lower(${'%' + q + '%'})
            OR lower(coalesce(email, ''))         LIKE lower(${'%' + q + '%'})
            OR         coalesce(phone, '')        LIKE ${'%' + q + '%'}
         )
       ORDER BY name
       LIMIT ${lim}
    `)
  })

  // ── GET /customers/:id ─────────────────────────────────────
  // Returns the customer + their full booking history.
  app.get('/:id', { preHandler: requireRole('admin', 'owner', 'operator') }, async (req) => {
    const [customer] = await withTenant(req.tenantId, tx => tx`
      SELECT id, name, email, phone, notes, is_anonymised, anonymised_at, created_at, updated_at
        FROM customers
       WHERE id = ${req.params.id}
    `)
    if (!customer) throw httpError(404, 'Customer not found')

    const bookings = await withTenant(req.tenantId, tx => tx`
      SELECT b.id, b.reference, b.starts_at, b.ends_at, b.covers, b.status,
             b.guest_notes, b.operator_notes, b.created_at,
             v.name                        AS venue_name,
             COALESCE(tc.name, t.label)    AS table_label
        FROM bookings b
        JOIN venues v ON v.id = b.venue_id
        LEFT JOIN tables t ON t.id = b.table_id
        LEFT JOIN table_combinations tc ON tc.id = b.combination_id
       WHERE b.customer_id = ${req.params.id}
       ORDER BY b.starts_at DESC
    `)

    return { ...customer, bookings }
  })

  // ── PATCH /customers/:id ───────────────────────────────────
  app.patch('/:id', { preHandler: requireRole('admin', 'owner', 'operator') }, async (req) => {
    const body = z.object({
      name:  z.string().min(1).max(200).optional(),
      phone: z.string().max(30).nullable().optional(),
      notes: z.string().max(2000).nullable().optional(),
    }).parse(req.body)

    const [updated] = await withTenant(req.tenantId, tx => tx`
      UPDATE customers
         SET name       = COALESCE(${body.name ?? null}, name),
             phone      = CASE WHEN ${body.phone !== undefined} THEN ${body.phone ?? null} ELSE phone END,
             notes      = CASE WHEN ${body.notes !== undefined} THEN ${body.notes ?? null} ELSE notes END,
             updated_at = now()
       WHERE id        = ${req.params.id}
         AND is_anonymised = false
      RETURNING id, name, email, phone, notes, updated_at
    `)
    if (!updated) throw httpError(404, 'Customer not found or already anonymised')
    return updated
  })

  // ── POST /customers/:id/anonymise ──────────────────────────
  // GDPR right to erasure. Does NOT delete the row — replaces all PII
  // with anonymised values and sets is_anonymised=true.
  // Also anonymises all linked booking guest fields + regenerates references.
  app.post('/:id/anonymise', { preHandler: requireRole('admin', 'owner') }, async (req, reply) => {
    // Deterministic anon ID derived from the customer UUID (stable across calls)
    const suffix   = req.params.id.replace(/-/g, '').slice(0, 12)
    const anonEmail = `anon-${suffix}@deleted.local`

    await withTenant(req.tenantId, async tx => {
      const [customer] = await tx`
        SELECT id FROM customers
         WHERE id = ${req.params.id}
           AND is_anonymised = false
      `
      if (!customer) throw httpError(404, 'Customer not found or already anonymised')

      // Wipe the customer record
      await tx`
        UPDATE customers
           SET name          = 'Anonymised',
               email         = ${anonEmail},
               phone         = null,
               notes         = null,
               is_anonymised = true,
               anonymised_at = now(),
               updated_at    = now()
         WHERE id = ${req.params.id}
      `

      // Wipe every booking linked to this customer
      await tx`
        UPDATE bookings
           SET guest_name  = 'Anonymised',
               guest_email = ${anonEmail},
               guest_phone = null,
               guest_notes = null,
               reference   = 'ANON-' || upper(substring(gen_random_uuid()::text, 1, 8))
         WHERE customer_id = ${req.params.id}
      `
    })

    return reply.code(204).send()
  })

  // ── GET /customers/:id/export ──────────────────────────────
  // GDPR data export — returns a JSON file download.
  app.get('/:id/export', { preHandler: requireRole('admin', 'owner') }, async (req, reply) => {
    const [customer] = await withTenant(req.tenantId, tx => tx`
      SELECT id, name, email, phone, notes, created_at, updated_at, is_anonymised
        FROM customers
       WHERE id = ${req.params.id}
    `)
    if (!customer) throw httpError(404, 'Customer not found')

    const bookings = await withTenant(req.tenantId, tx => tx`
      SELECT b.reference, b.starts_at, b.ends_at, b.covers, b.status,
             b.guest_notes, b.created_at,
             v.name                      AS venue_name,
             COALESCE(tc.name, t.label)  AS table_label
        FROM bookings b
        JOIN venues v ON v.id = b.venue_id
        LEFT JOIN tables t ON t.id = b.table_id
        LEFT JOIN table_combinations tc ON tc.id = b.combination_id
       WHERE b.customer_id = ${req.params.id}
       ORDER BY b.starts_at DESC
    `)

    const payload = {
      exported_at:  new Date().toISOString(),
      customer: {
        name:       customer.name,
        email:      customer.email,
        phone:      customer.phone,
        notes:      customer.notes,
        created_at: customer.created_at,
      },
      bookings: bookings.map(b => ({
        reference:  b.reference,
        venue:      b.venue_name,
        table:      b.table_label,
        date:       b.starts_at,
        ends_at:    b.ends_at,
        covers:     b.covers,
        status:     b.status,
        notes:      b.guest_notes,
        booked_at:  b.created_at,
      })),
    }

    const filename = `customer-${(customer.name ?? 'export').replace(/[^a-z0-9]/gi, '-').toLowerCase()}.json`
    reply
      .header('Content-Type', 'application/json')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
    return reply.send(JSON.stringify(payload, null, 2))
  })
}
