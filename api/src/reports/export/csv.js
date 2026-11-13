// src/reports/export/csv.js
//
// A report as a CSV file (docs/REPORTS.md 15): UTF-8 with a byte order mark
// (so Excel reads accents and currency signs), CRLF line ends, text cells
// made safe against spreadsheet formulas. A list is sent as it is read, a
// thousand rows at a time, so a long one never sits in memory; a summary or
// a matrix is small and is written from its result.

import { PassThrough } from 'node:stream'
import { csvCell } from '../../../../shared/reports/format.js'
import { runReport, streamList } from '../run.js'
import { headings, plainCells, resultTable } from './table.js'

const BOM = '\uFEFF'       // tells Excel the file is UTF-8
const EOL = '\r\n'
// A download that takes longer than this is given up on: it is holding one
// of the report builder's few database connections.
const STREAM_MS = 5 * 60 * 1000

const line = cells => cells.map(csvCell).join(',') + EOL

/** A shaped result (a summary or a matrix) as CSV text. */
export function csvOf(result) {
  const t = resultTable(result)
  return BOM + line(t.head) + t.rows.map(line).join('')
}

// Resolves when the stream can take more, or has gone.
const drained = out => new Promise(resolve => {
  const done = () => { out.off('drain', done); out.off('close', done); resolve() }
  out.on('drain', done)
  out.on('close', done)
})

/**
 * A definition as a CSV: { text | stream, done }. `done` resolves with
 * { rows, truncated, notes } once the whole file is written, and rejects if
 * it breaks off part way (the stream is destroyed with the error, so the
 * download fails rather than looking complete). A refusal (the definition,
 * the person's role, too heavy) is thrown before anything is sent.
 * `finish(r)` runs when the last row is written, before the stream ends.
 */
export async function csvExport(ctx, spec, given, { finish } = {}) {
  if (spec.kind !== 'list') {
    const result = await runReport(ctx, spec, given, { mode: 'export' })
    return {
      text: csvOf(result),
      done: Promise.resolve({ rows: result.meta.row_count, truncated: result.meta.truncated, notes: result.meta.notes }),
    }
  }

  const out = new PassThrough()
  // Whoever reads the stream hears of an error too; this keeps one with no
  // reader yet from stopping the process.
  out.on('error', () => {})
  const started = Date.now()
  let columns = null
  let notes = []
  let begun = false
  let ready
  const begin = new Promise((resolve, reject) => { ready = { resolve, reject } })

  const done = streamList(ctx, spec, given, {
    start: s => {
      columns = s.columns
      notes = s.meta.notes
      out.write(BOM + line(headings(columns, s.meta)))
      begun = true
      ready.resolve()
    },
    rows: async batch => {
      // Nobody is reading any more, or too slowly: stop reading the database too.
      if (out.destroyed) throw new Error('The download was cancelled')
      if (Date.now() - started > STREAM_MS) throw new Error('The download took too long')
      let text = ''
      for (const cells of batch) text += line(plainCells(columns, cells))
      if (!out.write(text)) await drained(out)
    },
  }).then(async r => {
    // A file that stops at the ceiling says so on its last line: the only
    // place a streamed file can.
    if (r.truncated) out.write(line(['This file holds the first ' + r.rows.toLocaleString('en-GB') + ' rows of the report. Narrow the report down for the rest']))
    // The caller's own last step (the run's record) before the file is done.
    try { await finish?.(r) } catch { /* the file is whole either way */ }
    out.end()
    return { ...r, notes }
  }, e => {
    if (begun) out.destroy(e)
    else { out.destroy(); ready.reject(e) }
    throw e
  })
  // A rejection is for whoever awaits `done`; nobody has to.
  done.catch(() => {})

  await begin
  return { stream: out, done }
}
