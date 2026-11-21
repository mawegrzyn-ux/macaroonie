// src/reports/export/json.js
//
// A report's result as JSON, for data links and pushes (docs/REPORTS.md 15,
// src/reports/dataLinks.js, src/reports/send.js). The cells are
// resultTable()'s, so they read as a CSV download does.

/**
 * A result as data links and pushes send it: the report's name, when it was
 * read, the period, the columns, rows offset..end of resultTable() (each
 * with its kind: row, subtotal, total, rest) and the notes.
 */
export function resultJson(result, table, { name, offset = 0, end = table.rows.length }) {
  const period = result.meta?.period
  return {
    report: { name },
    read_at: new Date().toISOString(),
    ...(period ? { period: { from: period.from, to: period.to, text: period.text || null } } : {}),
    columns: result.columns.map((c, i) => ({ heading: table.head[i], type: c.type || 'text', role: c.role || 'value' })),
    rows: table.rows.slice(offset, end).map((cells, i) => ({ kind: table.kinds[offset + i] || 'row', cells })),
    total_rows: table.rows.length,
    notes: (result.meta?.notes || []).map(n => (typeof n === 'string' ? n : n?.text)).filter(Boolean),
  }
}
