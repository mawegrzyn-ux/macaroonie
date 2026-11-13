// Helpers for the report tests: run a definition as someone, and read a
// result's rows by column key.
import { runReport } from '../../src/reports/run.js'

/** View on every module the catalogue asks for. */
export const LEVELS = { pos_reports: 'view', menus: 'view', customers: 'view', web_orders: 'view', bookings: 'view' }

/** runner(tenantId)(spec, given?, { levels, userKey, ...opts }?) -> the report's result, never from the kept results. */
export const runner = tenantId => (spec, given, { levels = LEVELS, userKey = 'u-test', ...opts } = {}) =>
  runReport({ tenantId, userKey, levels }, spec, given, { fresh: true, ...opts })

/** A result's rows of one kind ('row' | 'subtotal' | 'rest') as objects by column key. */
export function rowsOf(res, kind = 'row') {
  const keys = res.columns.map(c => c.key)
  return res.rows.filter(r => r.kind === kind).map(r => Object.fromEntries(keys.map((k, i) => [k, r.cells[i]])))
}
/** The totals row as an object by column key. */
export const totalsRow = res => Object.fromEntries(res.columns.map((c, i) => [c.key, res.totals?.cells[i]]))
/** Pounds to whole pence. */
export const p = v => Math.round(Number(v) * 100)
export const measures = list => list.map(m => ({ measure: m }))
/** What a refused report said: { status, problems } (throws when it ran). */
export async function refused(promise) {
  try { await promise } catch (e) {
    if (e?.name !== 'ReportError' && !Array.isArray(e?.problems)) throw e
    return { status: e.statusCode, problems: e.problems }
  }
  throw new Error('The report ran')
}
