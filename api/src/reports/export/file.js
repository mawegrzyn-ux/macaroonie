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
//
// Three formats: csv, xlsx and pdf. A PDF is the report's print page by its
// layout (src/reports/layouts.js), printed by the server's own browser
// (src/services/pdfBrowser.js): it holds what the print page holds (a list's
// first rows, as the screen has them), with the chart and the rows opened
// up; prep.print carries what the page was showing. Without a browser on the
// server, prepareFile() refuses a PDF before anything is run.

import { withTenant } from '../../config/db.js'
import { refuseOtherVenues } from '../access.js'
import { drillSteps, drilled } from '../drilled.js'
import { runReport } from '../run.js'
import { layoutFor } from '../layouts.js'
import { needPdf, htmlToPdf } from '../../services/pdfBrowser.js'
import { csvExport, hasPersonal } from './csv.js'
import { xlsxExport } from './xlsx.js'
import { fileName } from './table.js'
import { groupAbout, reportPrint } from './printPage.js'
import { resolveParams } from '../../../../shared/reports/spec.js'

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
export const CSV_TYPE = 'text/csv; charset=utf-8'
export const PDF_TYPE = 'application/pdf'
const FORMATS = ['csv', 'xlsx', 'pdf']

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
  const format = FORMATS.includes(body.format) ? body.format : 'csv'
  // A server with no browser can't make a PDF: said before anything runs.
  if (format === 'pdf') needPdf()
  return {
    format, steps, given, params: resolveParams(target.spec, given),
    // What a PDF shows, as the print page takes it: the trail's words for
    // the rows opened up, the table under a chart, the series switched off.
    print: {
      trail: Array.isArray(body.trail) && body.trail.length === steps.length ? body.trail : [],
      table: typeof body.table === 'boolean' ? body.table : null,
      hidden: Array.isArray(body.hidden) ? [...new Set(body.hidden)] : [],
    },
  }
}

export async function makeReportFile(p, target, prep, { finish } = {}) {
  const spec = drilled(target.spec, prep.steps, p.levels)
  if (prep.format === 'pdf') {
    // The print page as a file (./printPage.js), made by a browser on the
    // server: what the screen holds, so a list's first rows, with the
    // report's own layout. The page says when its figures were read.
    const [about, layout, result] = await Promise.all([
      groupAbout(p, { pdf: true }),
      layoutFor(p, target.saved),
      runReport(p.ctx, spec, prep.given),
    ])
    const html = reportPrint(about, {
      name: target.name, description: target.description, base: target.spec, result, values: prep.params,
      steps: prep.steps, trail: prep.print?.trail, levels: p.levels, table: prep.print?.table, hidden: prep.print?.hidden,
    }, { layout, by: p.email, byLabel: 'Made by', pdf: true })
    const buffer = await htmlToPdf(html)
    return {
      format: 'pdf', name: fileName(target.name, 'pdf'), type: PDF_TYPE, spec, buffer,
      done: Promise.resolve({
        rows: result.meta.row_count ?? result.rows.length, truncated: !!result.meta.truncated,
        notes: [], personal: hasPersonal(result.columns),
      }),
    }
  }
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
