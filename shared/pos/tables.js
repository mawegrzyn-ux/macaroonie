// shared/pos/tables.js
//
// Combined tables (migration 297): one party sits across several tables, and
// the till treats them as one. A check keeps its main table (table_id) and
// holds the others in joined_table_ids, in the order they were joined (the
// key is absent when it holds none). ONE set of rules, used by the check
// rules (shared/pos/checks.js), the sequencer (which looks up who holds the
// tables an event asks for), the till's floor and windows, and everything
// that names a check's table: kitchen screens and tickets, bills and
// receipts (tableLabel()).
//
// A table is held by a check only while the check is open: closing,
// cancelling or merging it frees every table. A closed check keeps its
// joined tables as a record (its receipt and reports still say "4 + 5").
//
// Pure: no I/O.

/** The most tables one check holds, its main table included. */
export const CHECK_TABLES_MAX = 12

/** The other tables a check holds, beside its main one. */
export const joinedTables = c => (c?.table_id && Array.isArray(c.joined_table_ids) ? c.joined_table_ids : [])

/** Every table a check holds: its main table first, then the ones joined to it. */
export const tablesOf = c => (c?.table_id ? [c.table_id, ...joinedTables(c)] : [])

/** Does the check hold this table (as its main table or a joined one)? */
export const holdsTable = (c, tableId) => !!tableId && tablesOf(c).includes(tableId)

const labelOf = (tables, id) => {
  if (!tables) return null
  const t = Array.isArray(tables) ? tables.find(x => x.id === id) : tables[id]
  const s = t?.label
  return s == null || s === '' ? null : String(s)
}

/**
 * What a check's tables are called: "4", or "4 + 5" with tables joined (the
 * main table first). null without a table, or when none of them is known.
 *   tables  the venue's tables: [{ id, label }] or { [id]: { label } }
 */
export function tableLabel(check, tables) {
  const names = tablesOf(check).map(id => labelOf(tables, id)).filter(Boolean)
  return names.length ? names.join(' + ') : null
}

/**
 * tableLabel() in SQL, for a pos_checks row (migration 297's
 * joined_table_ids beside table_id): "4", "4 + 5", or NULL without a table.
 * `c`: the pos_checks alias. One text, for the routes that list checks
 * (tx.unsafe()) and the report catalogue's Tables field.
 */
export const tableLabelSql = (c = 'c') => `(SELECT string_agg(jt.label, ' + ' ORDER BY j.ord)
   FROM unnest(array_prepend(${c}.table_id, ${c}.joined_table_ids)) WITH ORDINALITY AS j(id, ord)
   JOIN tables jt ON jt.id = j.id AND jt.tenant_id = ${c}.tenant_id)`

/** "Table 4", "Tables 4 + 5", or null (tableLabel()). */
export function tableTitle(check, tables) {
  const label = tableLabel(check, tables)
  if (!label) return null
  return (label.includes(' + ') ? 'Tables ' : 'Table ') + label
}

/**
 * The tables an event asks for that another open check may hold: what the
 * sequencer looks up (the store's openChecksOnTables()) before the check
 * rules decide it. checks: the checks the event touches, as loaded.
 */
export function tablesAsked(e, checks = {}) {
  const p = e?.payload || {}
  switch (e?.type) {
    case 'check.opened':
    case 'check.table_moved':
      return p.table_id ? [p.table_id] : []
    case 'check.tables_joined':
      return Array.isArray(p.table_ids) ? [...new Set(p.table_ids)] : []
    case 'check.reopened':
      return [...joinedTables(checks[e.check_id])]
    default:
      return []
  }
}

/**
 * The open checks, out of `checks` (a list or a map), that hold any of the
 * tables, without the check `exceptId`: as small as the rules need
 * ({ id, table_id, joined_table_ids }). The till works this out from the
 * checks it has; the sequencer's stores from theirs.
 */
export function tableHolders(checks, tableIds, exceptId = null) {
  const ids = new Set(tableIds || [])
  if (!ids.size) return []
  const list = Array.isArray(checks) ? checks : Object.values(checks || {})
  return list
    .filter(c => c && c.status === 'open' && c.id !== exceptId && tablesOf(c).some(id => ids.has(id)))
    .map(c => ({ id: c.id, table_id: c.table_id, ...(joinedTables(c).length ? { joined_table_ids: [...joinedTables(c)] } : {}) }))
}

/** Out of the holders, another check that has the table joined to it (not as its main table). */
export const joinedElsewhere = (holders, tableId, exceptId) =>
  (holders || []).find(h => h.id !== exceptId && joinedTables(h).includes(tableId)) || null

/** Out of the holders, another check that holds the table at all. */
export const heldElsewhere = (holders, tableId, exceptId) =>
  (holders || []).find(h => h.id !== exceptId && tablesOf(h).includes(tableId)) || null

/** A check with its joined tables set (the key goes when there are none). */
export function withJoined(c, ids) {
  if (ids && ids.length) c.joined_table_ids = ids
  else delete c.joined_table_ids
  return c
}

/**
 * The till's Combine: what joining `tableIds` to `check` takes, from the
 * open checks the till has. Tables another open check holds bring that
 * check with them (it is merged into this one, and every table it held
 * joins too).
 *   -> { join: [table ids to join], merge: [checks to merge in first] }
 */
export function combinePlan(check, tableIds, checks) {
  const mine = new Set(tablesOf(check))
  const join = []
  const merge = []
  const add = id => { if (!mine.has(id) && !join.includes(id)) join.push(id) }
  const list = (Array.isArray(checks) ? checks : Object.values(checks || {})).filter(c => c && c.status === 'open' && c.id !== check.id)
  for (const id of tableIds || []) {
    add(id)
    for (const other of list) {
      if (!tablesOf(other).includes(id)) continue
      if (!merge.some(m => m.id === other.id)) merge.push(other)
      for (const t of tablesOf(other)) add(t)
    }
  }
  return { join, merge }
}
