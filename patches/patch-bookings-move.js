// =============================================================
// PATCH 1: Add to api/src/routes/bookings.js
// Inside the bookingsRoutes plugin, after PATCH /:id/notes
// =============================================================

// ── PATCH /bookings/:id/move ──────────────────────────────────
// Admin drag-and-drop reschedule from the timeline.
// Validates no conflict at target slot before updating.
app.patch('/:id/move', { preHandler: requireRole('admin', 'owner', 'operator') }, async (req) => {
  const { table_id, starts_at } = z.object({
    table_id:  z.string().uuid(),
    starts_at: z.string().datetime(),
  }).parse(req.body)

  return withTenant(req.tenantId, async tx => {
    // Load booking + its venue's slot duration in one query
    const [booking] = await tx`
      SELECT b.*, r.slot_duration_mins, r.buffer_after_mins
        FROM bookings b
        JOIN booking_rules r ON r.venue_id = b.venue_id
       WHERE b.id        = ${req.params.id}
         AND b.tenant_id = ${req.tenantId}
         AND b.status NOT IN ('cancelled')
    `
    if (!booking) throw httpError(404, 'Booking not found')

    // Verify target table belongs to same tenant + venue
    const [table] = await tx`
      SELECT id FROM tables
       WHERE id        = ${table_id}
         AND venue_id  = ${booking.venue_id}
         AND tenant_id = ${req.tenantId}
         AND is_active = true
    `
    if (!table) throw httpError(404, 'Table not found in this venue')

    const newStart = new Date(starts_at)
    const newEnd   = new Date(
      newStart.getTime()
      + (booking.slot_duration_mins + booking.buffer_after_mins) * 60_000
    )

    // Check for overlapping confirmed bookings at new slot
    // (exclude this booking itself)
    const [conflict] = await tx`
      SELECT id FROM bookings
       WHERE table_id  = ${table_id}
         AND tenant_id = ${req.tenantId}
         AND id       != ${req.params.id}
         AND status NOT IN ('cancelled')
         AND starts_at < ${newEnd.toISOString()}
         AND ends_at   > ${newStart.toISOString()}
      LIMIT 1
    `
    if (conflict) throw httpError(409, 'Slot conflict — another booking exists at the target time')

    // Check for active holds at new slot
    const [holdConflict] = await tx`
      SELECT id FROM booking_holds
       WHERE table_id  = ${table_id}
         AND tenant_id = ${req.tenantId}
         AND expires_at > now()
         AND starts_at  < ${newEnd.toISOString()}
         AND ends_at    > ${newStart.toISOString()}
      LIMIT 1
    `
    if (holdConflict) throw httpError(409, 'Slot conflict — a hold exists at the target time')

    const [updated] = await tx`
      UPDATE bookings
         SET table_id   = ${table_id},
             starts_at  = ${newStart.toISOString()},
             ends_at    = ${newEnd.toISOString()},
             updated_at = now()
       WHERE id        = ${req.params.id}
         AND tenant_id = ${req.tenantId}
      RETURNING *
    `
    return updated
  })
})
