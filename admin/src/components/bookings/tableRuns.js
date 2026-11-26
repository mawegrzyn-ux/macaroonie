// src/components/bookings/tableRuns.js
//
// Where a booking's tables sit on a list of table rows: runs of rows next to
// each other. A booking on a table combination is drawn as one box per run
// (the office Timeline's tall card, the phone timeline's spanning box), so
// tables side by side in the list read as one booking and tables apart as
// linked pieces. "Next to each other" is the list as drawn: the tables' sort
// order with the rows that aren't shown left out. No imports: plain rules.

/**
 * @param {string[]} tableIds            the booking's tables
 * @param {Map<string, number>} rowIndex table id -> its row's place in the list
 * @returns {{ start: number, ids: string[] }[]} the runs, top to bottom; tables
 *   with no row are left out
 */
export function tableRuns(tableIds, rowIndex) {
  const placed = [...new Set(tableIds ?? [])]
    .filter(id => rowIndex.has(id))
    .map(id => ({ id, i: rowIndex.get(id) }))
    .sort((a, b) => a.i - b.i)
  const runs = []
  for (const t of placed) {
    const last = runs[runs.length - 1]
    if (last && t.i === last.start + last.ids.length) last.ids.push(t.id)
    else runs.push({ start: t.i, ids: [t.id] })
  }
  return runs
}

/** The tables a booking sits at: a combination's, else its one table. */
export function tableIdsOf(booking) {
  return booking.member_table_ids?.length ? booking.member_table_ids : booking.table_id ? [booking.table_id] : []
}
