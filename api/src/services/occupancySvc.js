// src/services/occupancySvc.js
// Shared table occupancy + auto-allocate used by admin bookings, the public
// widget, guest /manage modify, and the Stripe webhook confirm path.
//
// Physical availability is owned by the PG functions table_is_free() and
// combination_is_free() (migration 070). Do not re-implement the 4-way
// booking/hold × direct/combo NOT EXISTS predicates in route files.

import { httpError } from '../middleware/error.js'

function iso(v) {
  if (v instanceof Date) return v.toISOString()
  return new Date(v).toISOString()
}

export async function tableIsFree(tx, tableId, startsAt, endsAt, opts = {}) {
  const [row] = await tx`
    SELECT table_is_free(
      ${tableId}::uuid,
      ${iso(startsAt)}::timestamptz,
      ${iso(endsAt)}::timestamptz,
      ${opts.excludeBookingId ?? null}::uuid,
      ${opts.excludeHoldId ?? null}::uuid,
      ${opts.lock ?? false}::boolean
    ) AS free
  `
  return !!row?.free
}

export async function combinationIsFree(tx, combinationId, startsAt, endsAt, opts = {}) {
  const [row] = await tx`
    SELECT combination_is_free(
      ${combinationId}::uuid,
      ${iso(startsAt)}::timestamptz,
      ${iso(endsAt)}::timestamptz,
      ${opts.excludeBookingId ?? null}::uuid,
      ${opts.excludeHoldId ?? null}::uuid,
      ${opts.lock ?? false}::boolean
    ) AS free
  `
  return !!row?.free
}

/** Throw 409 unless the allocation is physically free. */
export async function assertAllocationFree(tx, {
  tableId = null,
  combinationId = null,
  startsAt,
  endsAt,
  excludeBookingId = null,
  excludeHoldId = null,
  lock = true,
} = {}) {
  const opts = { excludeBookingId, excludeHoldId, lock }
  if (combinationId) {
    const ok = await combinationIsFree(tx, combinationId, startsAt, endsAt, opts)
    if (!ok) throw httpError(409, 'Slot conflict — that table combination is occupied')
    return
  }
  if (tableId) {
    const ok = await tableIsFree(tx, tableId, startsAt, endsAt, opts)
    if (!ok) throw httpError(409, 'Slot conflict — that table is occupied')
  }
}

/**
 * Best-fit table or combination for a party.
 * Returns { tableId, combinationId, label, displaced, displacedIds } or null.
 */
export async function allocateBestFit(tx, {
  venueId,
  covers,
  startsAt,
  windowEnd,
  excludeBookingId = null,
  allowDisplace = false,
} = {}) {
  const startIso = iso(startsAt)
  const endIso   = iso(windowEnd)

  const [autoTable] = await tx`
    SELECT t.id, t.label
      FROM tables t
     WHERE t.venue_id       = ${venueId}
       AND t.is_active      = true
       AND t.is_unallocated = false
       AND t.min_covers    <= ${covers}
       AND t.max_covers    >= ${covers}
       AND table_is_free(
             t.id,
             ${startIso}::timestamptz,
             ${endIso}::timestamptz,
             ${excludeBookingId}::uuid,
             NULL::uuid,
             false
           )
     ORDER BY t.sort_order, t.max_covers
     LIMIT 1
  `
  if (autoTable) {
    return {
      tableId: autoTable.id,
      combinationId: null,
      label: autoTable.label,
      displaced: [],
      displacedIds: [],
    }
  }

  const [autoCombo] = await tx`
    SELECT c.id, c.name,
           (SELECT m.table_id FROM table_combination_members m
              JOIN tables t ON t.id = m.table_id
             WHERE m.combination_id = c.id
             ORDER BY t.sort_order, t.label LIMIT 1) AS first_table_id
      FROM table_combinations c
     WHERE c.venue_id   = ${venueId}
       AND c.is_active  = true
       AND c.min_covers <= ${covers}
       AND c.max_covers >= ${covers}
       AND combination_is_free(
             c.id,
             ${startIso}::timestamptz,
             ${endIso}::timestamptz,
             ${excludeBookingId}::uuid,
             NULL::uuid,
             false
           )
     ORDER BY c.max_covers
     LIMIT 1
  `
  if (autoCombo) {
    return {
      tableId: autoCombo.first_table_id,
      combinationId: autoCombo.id,
      label: autoCombo.name,
      displaced: [],
      displacedIds: [],
    }
  }

  if (allowDisplace) {
    const disp = await tryWidgetDisplace(tx, venueId, covers, startsAt, windowEnd)
    if (disp) {
      const [comboRow] = await tx`SELECT name FROM table_combinations WHERE id = ${disp.combinationId}`
      return {
        tableId: disp.tableId,
        combinationId: disp.combinationId,
        label: comboRow?.name ?? 'Combined table',
        displaced: disp.displaced,
        displacedIds: disp.displacedIds,
      }
    }
  }

  return null
}

export async function tryWidgetDisplace(tx, venueId, covers, startsAt, windowEnd) {
  const startIso = iso(startsAt)
  const endIso   = iso(windowEnd)

  const combos = await displaceableCombos(tx, venueId, covers, startIso, endIso)

  for (const combo of combos) {
    const result = await tryDisplaceCombo(tx, venueId, combo.id, startsAt, windowEnd)
    if (result) return result
  }
  return null
}

/** Dry-run: can we free a fitting combo by moving its occupants? Does not write. */
export async function canWidgetDisplace(tx, venueId, covers, startsAt, windowEnd) {
  const startIso = iso(startsAt)
  const endIso   = iso(windowEnd)
  const combos = await displaceableCombos(tx, venueId, covers, startIso, endIso)
  for (const combo of combos) {
    const plan = await planDisplaceCombo(tx, venueId, combo.id, startsAt, windowEnd)
    if (plan) return { combinationId: combo.id, tableId: plan.tableId }
  }
  return null
}

async function displaceableCombos(tx, venueId, covers, startIso, endIso) {
  return tx`
    SELECT c.id
      FROM table_combinations c
     WHERE c.venue_id   = ${venueId}
       AND c.is_active  = true
       AND c.min_covers <= ${covers}
       AND c.max_covers >= ${covers}
       AND EXISTS (
         SELECT 1 FROM table_combination_members m
          JOIN bookings b ON (
                b.table_id = m.table_id
                OR (b.combination_id IS NOT NULL AND EXISTS (
                      SELECT 1 FROM table_combination_members mx
                       WHERE mx.combination_id = b.combination_id
                         AND mx.table_id = m.table_id
                    ))
              )
         WHERE m.combination_id = c.id
           AND booking_is_occupying(b.status)
           AND b.starts_at < ${endIso}::timestamptz
           AND b.ends_at   > ${startIso}::timestamptz
       )
       AND NOT EXISTS (
         SELECT 1 FROM table_combination_members m
          JOIN bookings b ON (
                b.table_id = m.table_id
                OR (b.combination_id IS NOT NULL AND EXISTS (
                      SELECT 1 FROM table_combination_members mx
                       WHERE mx.combination_id = b.combination_id
                         AND mx.table_id = m.table_id
                    ))
              )
         WHERE m.combination_id = c.id
           AND booking_is_occupying(b.status)
           AND (b.table_locked = true OR b.status IN ('arrived', 'seated'))
           AND b.starts_at < ${endIso}::timestamptz
           AND b.ends_at   > ${startIso}::timestamptz
       )
     ORDER BY c.max_covers
     LIMIT 5
  `
}

/**
 * Plan how to free `combinationId` by moving overlapping unlocked bookings.
 * Returns null if any occupant cannot be placed elsewhere. Does not write.
 */
export async function planDisplaceCombo(tx, venueId, combinationId, startsAt, windowEnd) {
  const startIso = iso(startsAt)
  const endIso   = iso(windowEnd)

  const members = await tx`
    SELECT m.table_id FROM table_combination_members m
      JOIN tables t ON t.id = m.table_id
     WHERE m.combination_id = ${combinationId}
     ORDER BY t.sort_order, t.label
  `
  if (!members.length) return null
  const memberIds = members.map(m => m.table_id)

  const conflicts = await tx`
    SELECT DISTINCT b.id, b.covers, b.starts_at, b.ends_at
      FROM bookings b
     WHERE booking_is_occupying(b.status)
       AND b.status NOT IN ('arrived', 'seated')
       AND b.table_locked = false
       AND b.starts_at < ${endIso}::timestamptz
       AND b.ends_at   > ${startIso}::timestamptz
       AND (
             b.table_id = ANY(${memberIds}::uuid[])
             OR (b.combination_id IS NOT NULL AND EXISTS (
                   SELECT 1 FROM table_combination_members m
                    WHERE m.combination_id = b.combination_id
                      AND m.table_id = ANY(${memberIds}::uuid[])
                 ))
           )
  `
  if (!conflicts.length) return null

  const claimedTableIds = new Set(memberIds)
  const displacements   = []

  for (const conflict of conflicts) {
    const claimedArr = [...claimedTableIds]
    const cStart = iso(conflict.starts_at)
    const cEnd   = iso(conflict.ends_at)

    const [freeTable] = await tx`
      SELECT t.id FROM tables t
       WHERE t.venue_id       = ${venueId}
         AND t.is_active      = true
         AND t.is_unallocated = false
         AND t.min_covers    <= ${conflict.covers}
         AND t.max_covers    >= ${conflict.covers}
         AND t.id != ALL(${claimedArr}::uuid[])
         AND table_is_free(
               t.id,
               ${cStart}::timestamptz,
               ${cEnd}::timestamptz,
               ${conflict.id}::uuid,
               NULL::uuid,
               false
             )
       ORDER BY t.max_covers ASC
       LIMIT 1
    `
    if (freeTable) {
      claimedTableIds.add(freeTable.id)
      displacements.push({ bookingId: conflict.id, newTableId: freeTable.id, newComboId: null })
      continue
    }

    const [freeCombo] = await tx`
      SELECT c.id,
             (SELECT m2.table_id FROM table_combination_members m2
                JOIN tables t2 ON t2.id = m2.table_id
               WHERE m2.combination_id = c.id
               ORDER BY t2.sort_order, t2.label LIMIT 1) AS first_table_id
        FROM table_combinations c
       WHERE c.venue_id   = ${venueId}
         AND c.is_active  = true
         AND c.min_covers <= ${conflict.covers}
         AND c.max_covers >= ${conflict.covers}
         AND NOT EXISTS (
           SELECT 1 FROM table_combination_members mcx
            WHERE mcx.combination_id = c.id
              AND mcx.table_id = ANY(${memberIds}::uuid[])
         )
         AND NOT EXISTS (
           SELECT 1 FROM table_combination_members mc2
            WHERE mc2.combination_id = c.id
              AND (
                mc2.table_id = ANY(${claimedArr}::uuid[])
                OR NOT table_is_free(
                     mc2.table_id,
                     ${cStart}::timestamptz,
                     ${cEnd}::timestamptz,
                     ${conflict.id}::uuid,
                     NULL::uuid,
                     false
                   )
              )
         )
       ORDER BY c.max_covers
       LIMIT 1
    `
    if (!freeCombo) return null

    const comboMembers = await tx`
      SELECT table_id FROM table_combination_members WHERE combination_id = ${freeCombo.id}
    `
    for (const m of comboMembers) claimedTableIds.add(m.table_id)
    displacements.push({
      bookingId: conflict.id,
      newTableId: freeCombo.first_table_id,
      newComboId: freeCombo.id,
    })
  }

  return {
    tableId: members[0].table_id,
    combinationId,
    displacements,
  }
}

export async function tryDisplaceCombo(tx, venueId, combinationId, startsAt, windowEnd) {
  const plan = await planDisplaceCombo(tx, venueId, combinationId, startsAt, windowEnd)
  if (!plan) return null

  const displaced = []
  for (const { bookingId, newTableId, newComboId } of plan.displacements) {
    const [updated] = await tx`
      UPDATE bookings
         SET table_id       = ${newTableId},
             combination_id = ${newComboId ?? null},
             updated_at     = now()
       WHERE id = ${bookingId}
      RETURNING *
    `
    if (updated) displaced.push(updated)
  }

  return {
    tableId:      plan.tableId,
    combinationId: plan.combinationId,
    displacedIds: displaced.map(d => d.id),
    displaced,
  }
}

