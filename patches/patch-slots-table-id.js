// =============================================================
// PATCH 3: Replace the slots query in api/src/routes/slots.js
//
// The booking widget needs a table_id per available slot so it
// can create a hold. This subquery picks the first available
// table that fits the requested covers for each slot time.
//
// Replace the existing `slots` query block with this:
// =============================================================

const slots = await withTenant(venue.tenant_id, async tx => {
  // First get the slot duration so we can calculate the window
  const [rules] = await tx`
    SELECT slot_duration_mins, buffer_after_mins
      FROM booking_rules
     WHERE venue_id = ${venue.id}
  `
  const slotMins   = rules?.slot_duration_mins ?? 90
  const bufferMins = rules?.buffer_after_mins  ?? 0
  const windowMins = slotMins + bufferMins

  return tx`
    SELECT
      s.slot_time,
      s.available,
      s.available_covers,
      s.reason,
      -- Pick the first available table that fits the requested covers.
      -- Excludes tables blocked by active bookings or non-expired holds
      -- within the slot window (starts_at → starts_at + slot_duration + buffer).
      (
        SELECT t.id
          FROM tables t
         WHERE t.venue_id  = ${venue.id}
           AND t.tenant_id = ${venue.tenant_id}
           AND t.is_active = true
           AND t.max_covers >= ${covers}
           AND t.min_covers <= ${covers}
           -- No confirmed booking overlaps this slot window
           AND NOT EXISTS (
             SELECT 1 FROM bookings b
              WHERE b.table_id  = t.id
                AND b.status NOT IN ('cancelled')
                AND b.starts_at < s.slot_time + (${windowMins} || ' minutes')::interval
                AND b.ends_at   > s.slot_time
           )
           -- No active hold overlaps this slot window
           AND NOT EXISTS (
             SELECT 1 FROM booking_holds h
              WHERE h.table_id  = t.id
                AND h.expires_at > now()
                AND h.starts_at  < s.slot_time + (${windowMins} || ' minutes')::interval
                AND h.ends_at    > s.slot_time
           )
         ORDER BY t.sort_order, t.label
         LIMIT 1
      ) AS table_id
    FROM get_available_slots(
      ${venue.id}::uuid,
      ${date}::date,
      ${covers}::int
    ) s
    ORDER BY s.slot_time
  `
})

// A slot is only truly available if it has an assignable table.
// Mark as unavailable (not hidden) if no table could be found
// even though the sitting cap said there was capacity.
const enriched = slots.map(s => ({
  ...s,
  available:     s.available && s.table_id !== null,
  reason:        s.available && s.table_id === null ? 'no_table' : s.reason,
}))

return {
  venue_id:  venue.id,
  date,
  covers,
  timezone:  venue.timezone,
  slots:     enriched,
}
