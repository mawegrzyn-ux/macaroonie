// src/reports/export/file.js
//
// A report as a file, made one way (docs/REPORTS.md 14-15): a download
// (POST /api/reports/:id/export, /export) sends it straight to the browser,
// a kept file (src/reports/files.js) writes it to the private store. Both
// make it here, so a kept file is what a download of the same report, with
// the same choices, would have been.
//
//   prepareFile(person, target, body)   checks before anything is run or
//                                       recorded (the drill steps, the
//                                       venues named): { format, steps,
//                                       given, params }
//   makeReportFile(person, target, prep, { finish })
//                                       { format, name, type, spec, buffer |
//                                       text | stream, done }. A list's CSV is
//                                       a stream, sent as it is read; `done`
//                                       resolves { rows, truncated, notes,
//                                       personal } once the whole file is
//                                       made, and `finish(r)` runs just before
//                                       a stream ends (a download's record)
//   venuesText(person, spec, params)    the venues a run was for, in words
//   errorText(e)                        what a failed run's record says
//
// `personal`: the file has a column the catalogue marks as people's details
// (pii: names, emails, phones), so a kept copy goes sooner.

import { withTenant } from '../../config/db.js'
import { refuseOtherVenues } from '../access.js'
import { drillSteps, drilled } from '../drilled.js'
import { csvExport } from './csv.js'
import { xlsxExport } from './xlsx.js'
import { fileName } from './table.js'
import { resolveParams } from '../../../../shared/reports/spec.js'

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
export const CSV_TYPE = 'text/csv; charset=utf-8'

export const errorText = e => (e?.statusCode && e.statusCode < 500 ? e.message : 'The report failed')

export async function venuesText(p, spec, params) {
  const param = spec.params.find(x => x.type === 'venues')
  if (!param) return null
  const ids = params[param.key]
  if (!Array.isArray(ids) || !ids.length) return 'All venues'
  const rows = await withTenant(p.tenantId, tx => tx`
    SELECT name FROM venues WHERE tenant_id = ${p.tenantId} AND id = ANY(${ids}::uuid[]) ORDER BY name`)
  return rows.length ? rows.map(r => r.name).join(', ') : 'All venues'
}

/** Checks a file asks for before anything is run or recorded. Throws. */
export async function prepareFile(p, target, body) {
  const steps = drillSteps(body.drill)
  const given = body.params || {}
  await refuseOtherVenues(p, target.spec, given)
  return { format: body.format === 'xlsx' ? 'xlsx' : 'csv', steps, given, params: resolveParams(target.spec, given) }
}

export async function makeReportFile(p, target, prep, { finish } = {}) {
  const spec = drilled(target.spec, prep.steps, p.levels)
  if (prep.format === 'xlsx') {
    const out = await xlsxExport(p.ctx, spec, prep.given, {
      name: target.name,
      description: target.description,
      by: p.email,
      venues: await venuesText(p, target.spec, prep.params),
    })
    return {
      format: 'xlsx', name: fileName(target.name, 'xlsx'), type: XLSX_TYPE, spec, buffer: out.buffer,
      done: Promise.resolve({ rows: out.rows, truncated: out.truncated, notes: out.notes, personal: out.personal }),
    }
  }
  const out = await csvExport(p.ctx, spec, prep.given, { finish })
  return { format: 'csv', name: fileName(target.name, 'csv'), type: CSV_TYPE, spec, ...out }
}
