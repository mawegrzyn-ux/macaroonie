// =============================================================
// PATCH 2: Add to api/src/routes/venues.js
// Inside the venuesRoutes plugin, after DELETE /:id/tables/:tid
// =============================================================

// ── Booking rules schemas ─────────────────────────────────────
const BookingRulesBody = z.object({
  slot_duration_mins:  z.number().int().min(15).max(480).optional(),
  buffer_after_mins:   z.number().int().min(0).max(120).optional(),
  min_covers:          z.number().int().min(1).optional(),
  max_covers:          z.number().int().min(1).optional(),
  book_from_days:      z.number().int().min(0).optional(),
  book_until_days:     z.number().int().min(1).optional(),
  cutoff_before_mins:  z.number().int().min(0).optional(),
  hold_ttl_secs:       z.number().int().min(60).max(1800).optional(),
})

const DepositRulesBody = z.object({
  requires_deposit:    z.boolean().optional(),
  deposit_type:        z.enum(['fixed', 'per_cover']).nullable().optional(),
  deposit_amount:      z.number().positive().nullable().optional(),
  currency:            z.string().length(3).optional(),
  refund_hours_before: z.number().int().min(0).nullable().optional(),
})

// ── GET /venues/:id/rules ─────────────────────────────────────
app.get('/:id/rules', async (req) => {
  const [rules] = await withTenant(req.tenantId, tx => tx`
    SELECT * FROM booking_rules
     WHERE venue_id  = ${req.params.id}
       AND tenant_id = ${req.tenantId}
  `)
  if (!rules) throw httpError(404, 'Booking rules not configured for this venue')
  return rules
})

// ── POST /venues/:id/rules ────────────────────────────────────
// Creates rules row if it doesn't exist yet (initial setup)
app.post('/:id/rules', { preHandler: requireRole('admin', 'owner') }, async (req, reply) => {
  const body = BookingRulesBody.required().parse(req.body)

  const [rules] = await withTenant(req.tenantId, tx => tx`
    INSERT INTO booking_rules
      (venue_id, tenant_id, slot_duration_mins, buffer_after_mins,
       min_covers, max_covers, book_from_days, book_until_days,
       cutoff_before_mins, hold_ttl_secs)
    VALUES
      (${req.params.id}, ${req.tenantId},
       ${body.slot_duration_mins  ?? 90},
       ${body.buffer_after_mins   ?? 0},
       ${body.min_covers          ?? 1},
       ${body.max_covers          ?? 20},
       ${body.book_from_days      ?? 0},
       ${body.book_until_days     ?? 90},
       ${body.cutoff_before_mins  ?? 60},
       ${body.hold_ttl_secs       ?? 300})
    ON CONFLICT (venue_id) DO UPDATE
       SET slot_duration_mins = EXCLUDED.slot_duration_mins,
           buffer_after_mins  = EXCLUDED.buffer_after_mins,
           min_covers         = EXCLUDED.min_covers,
           max_covers         = EXCLUDED.max_covers,
           book_from_days     = EXCLUDED.book_from_days,
           book_until_days    = EXCLUDED.book_until_days,
           cutoff_before_mins = EXCLUDED.cutoff_before_mins,
           hold_ttl_secs      = EXCLUDED.hold_ttl_secs,
           updated_at         = now()
    RETURNING *
  `)
  return reply.code(201).send(rules)
})

// ── PATCH /venues/:id/rules ───────────────────────────────────
app.patch('/:id/rules', { preHandler: requireRole('admin', 'owner') }, async (req) => {
  const body   = BookingRulesBody.parse(req.body)
  const fields = Object.keys(body)
  if (!fields.length) throw httpError(400, 'No fields to update')

  // Validate covers constraint client-side before hitting DB check constraint
  if (body.min_covers && body.max_covers && body.min_covers > body.max_covers) {
    throw httpError(422, 'min_covers cannot exceed max_covers')
  }

  const [rules] = await withTenant(req.tenantId, tx => tx`
    UPDATE booking_rules
       SET ${tx(body, ...fields)}, updated_at = now()
     WHERE venue_id  = ${req.params.id}
       AND tenant_id = ${req.tenantId}
    RETURNING *
  `)
  if (!rules) throw httpError(404, 'Booking rules not found — POST to create them first')
  return rules
})

// ── GET /venues/:id/deposit-rules ────────────────────────────
app.get('/:id/deposit-rules', async (req) => {
  const [rules] = await withTenant(req.tenantId, tx => tx`
    SELECT * FROM deposit_rules
     WHERE venue_id  = ${req.params.id}
       AND tenant_id = ${req.tenantId}
  `)
  if (!rules) throw httpError(404, 'Deposit rules not configured for this venue')
  return rules
})

// ── POST /venues/:id/deposit-rules ───────────────────────────
// Creates deposit rules row if it doesn't exist yet
app.post('/:id/deposit-rules', { preHandler: requireRole('admin', 'owner') }, async (req, reply) => {
  const body = DepositRulesBody.parse(req.body)

  // Validate: if requires_deposit, type + amount must be set
  if (body.requires_deposit && (!body.deposit_type || !body.deposit_amount)) {
    throw httpError(422, 'deposit_type and deposit_amount are required when requires_deposit is true')
  }

  const [rules] = await withTenant(req.tenantId, tx => tx`
    INSERT INTO deposit_rules
      (venue_id, tenant_id, requires_deposit, deposit_type,
       deposit_amount, currency, refund_hours_before)
    VALUES
      (${req.params.id}, ${req.tenantId},
       ${body.requires_deposit    ?? false},
       ${body.deposit_type        ?? null},
       ${body.deposit_amount      ?? null},
       ${body.currency            ?? 'GBP'},
       ${body.refund_hours_before ?? null})
    ON CONFLICT (venue_id) DO UPDATE
       SET requires_deposit    = EXCLUDED.requires_deposit,
           deposit_type        = EXCLUDED.deposit_type,
           deposit_amount      = EXCLUDED.deposit_amount,
           currency            = EXCLUDED.currency,
           refund_hours_before = EXCLUDED.refund_hours_before,
           updated_at          = now()
    RETURNING *
  `)
  return reply.code(201).send(rules)
})

// ── PATCH /venues/:id/deposit-rules ──────────────────────────
app.patch('/:id/deposit-rules', { preHandler: requireRole('admin', 'owner') }, async (req) => {
  const body   = DepositRulesBody.parse(req.body)
  const fields = Object.keys(body)
  if (!fields.length) throw httpError(400, 'No fields to update')

  // If setting requires_deposit to true, ensure type + amount are either
  // in this patch or already exist in the DB
  if (body.requires_deposit === true) {
    const [existing] = await withTenant(req.tenantId, tx => tx`
      SELECT deposit_type, deposit_amount FROM deposit_rules
       WHERE venue_id = ${req.params.id} AND tenant_id = ${req.tenantId}
    `)
    const type   = body.deposit_type   ?? existing?.deposit_type
    const amount = body.deposit_amount ?? existing?.deposit_amount
    if (!type || !amount) {
      throw httpError(422, 'deposit_type and deposit_amount must be set before enabling deposit requirement')
    }
  }

  const [rules] = await withTenant(req.tenantId, tx => tx`
    UPDATE deposit_rules
       SET ${tx(body, ...fields)}, updated_at = now()
     WHERE venue_id  = ${req.params.id}
       AND tenant_id = ${req.tenantId}
    RETURNING *
  `)
  if (!rules) throw httpError(404, 'Deposit rules not found — POST to create them first')
  return rules
})
