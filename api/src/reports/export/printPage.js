// src/reports/export/printPage.js
//
// A report, or a Page report, put together for paper: what the print page
// (GET /api/reports/print/:linkId), a PDF download, a kept PDF and a
// schedule's PDF attachment all draw from, so they are the same page.
// The drawing itself is ./print.js; this is what it is told.
//
//   groupAbout(person, { pdf })   { group, logo, brand, venues } for the
//                                 page's top. With `pdf`, the logo is data
//                                 (a file of ours under /uploads/) or left
//                                 out: a PDF's page fetches nothing
//   printFacts(...)               what the page says a report was run for:
//                                 [[label, words, kind]]
//   reportPrint(about, r, opts)   one report's page from a result already
//                                 run: the HTML
//   pagePrint(person, about, doc, opts)
//                                 a Page report: runs each block as the
//                                 person and draws them in order.
//                                 { html, runs, rows }; `runs` is one entry a
//                                 report block run ({ ref, name, spec, params,
//                                 rows, ms, error }) for the caller to record
//
// A page's blocks come resolved (src/reports/pages.js resolveBlocks()): who
// may see which report was decided for the person when the page was asked
// for, and each report is still run here with that person's own levels.

import fs from 'node:fs/promises'
import path from 'node:path'
import { withTenant } from '../../config/db.js'
import { env } from '../../config/env.js'
import { brandColours } from '../../services/themeColours.js'
import { catalogueView } from '../catalogue/index.js'
import { runReport } from '../run.js'
import { printHtml } from './print.js'
import { normaliseReport, resolveParams } from '../../../../shared/reports/spec.js'
import { paramInputs, paramWords } from '../../../../shared/reports/build.js'
import { printShow } from '../../../../shared/reports/page.js'

export const BLOCK_GONE = 'This report isn\'t here any more, or isn\'t shared with you'
const BLOCK_FAILED = 'This report couldn\'t be run'

const LOGO_BYTES = 512 * 1024
const LOGO_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' }

// A logo of ours as data. Only a file under the upload folder: the server's
// browser never fetches an address a group typed.
async function logoData(url) {
  if (typeof url !== 'string' || !url.startsWith('/uploads/')) return null
  const type = LOGO_TYPES[path.extname(url).toLowerCase()]
  if (!type) return null
  try {
    const base = path.resolve(env.UPLOAD_DIR)
    const abs = path.resolve(base, decodeURIComponent(url.slice('/uploads/'.length)))
    if (!abs.startsWith(base + path.sep)) return null
    const stat = await fs.stat(abs)
    if (!stat.isFile() || stat.size > LOGO_BYTES) return null
    return 'data:' + type + ';base64,' + (await fs.readFile(abs)).toString('base64')
  } catch {
    return null
  }
}

export async function groupAbout(p, { pdf = false } = {}) {
  const about = await withTenant(p.tenantId, async tx => {
    const [group] = await tx`
      SELECT t.name, ts.brand_name, ts.logo_url
        FROM tenants t LEFT JOIN tenant_site ts ON ts.tenant_id = t.id
       WHERE t.id = ${p.tenantId}`
    const venues = await tx`SELECT id, name FROM venues WHERE tenant_id = ${p.tenantId} ORDER BY name`
    return { group, venues, colours: await brandColours(tx, p.tenantId) }
  })
  const logo = about.group?.logo_url || null
  return {
    group: about.group?.brand_name || about.group?.name || '',
    logo: pdf ? await logoData(logo) : logo,
    brand: about.colours.primary,
    venues: about.venues,
  }
}

const lowerFirst = s => (s && /^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s || '')
const upperFirst = s => (s ? s[0].toUpperCase() + s.slice(1) : '')

// Where the person had got to, as the trail on the page says it: "All, then
// Mains (by dish), then Pad Thai (dishes sold behind Net sales)".
function trailText(steps, trail) {
  if (!steps.length) return null
  return ['All', ...steps.map((s, i) => {
    const t = trail[i] || {}
    const how = s.to === 'rows' ? lowerFirst(t.by) || 'the rows' : 'by ' + (lowerFirst(t.by) || 'another field')
    return (t.label || 'A row') + ' (' + how + (s.to === 'rows' && t.of ? ' behind ' + t.of : '') + ')'
  })].join(', then ')
}

/**
 * What the page says a report was run for: its period, what it is compared
 * with, its venues and other choices, and the rows opened up. Each fact is
 * [label, words, kind]: kind 'period' for the period and what it is compared
 * with, 'venues' for a venues choice, none for the rest (a layout can leave
 * the period or the choices out).
 */
export function printFacts({ base, result, levels, values, venues, steps = [], trail = [] }) {
  const meta = result.meta || {}
  const facts = [['Period', meta.period?.text || 'Every date', 'period']]
  if (meta.compare?.text) facts.push(['Compared with', meta.compare.text, 'period'])
  // The report's own period is said above with its dates: not again as a choice.
  let own = !!meta.period
  const catalogue = catalogueView(levels)
  for (const input of paramInputs(catalogue, base)) {
    if (own && input.type === 'period' && input.path === 'date' && !input.bucket && input.subject === base.subject) { own = false; continue }
    const words = paramWords(catalogue, input, values[input.key], { venues, currency: meta.currency })
    // The words are made to follow the choice's name in a sentence ("every venue"): here they stand alone.
    if (words) facts.push(input.type === 'venues' ? [input.label, upperFirst(words), 'venues'] : [input.label, upperFirst(words)])
  }
  const opened = trailText(steps, trail)
  if (opened) facts.push(['Opened up', opened])
  const rows = meta.row_count ?? result.rows.length
  facts.push(['Rows', rows.toLocaleString('en-GB'), 'rows'])
  return facts
}

/**
 * One report's page from a result already run.
 *   r     { name, description, base, result, values, steps, trail, levels, table, hidden,
 *           outside (a copy for outside the team: its header says the period,
 *           venues and rows only, since any other choice can be words someone
 *           typed into a filter) }
 *   opts  { layout, by, byLabel, expires, nonce, preview, pdf }
 */
export function reportPrint(about, r, opts = {}) {
  const facts = printFacts({ base: r.base, result: r.result, levels: r.levels, values: r.values, venues: about.venues, steps: r.steps || [], trail: r.trail || [] })
  return printHtml({
    group: about.group,
    logo: about.logo,
    brand: about.brand,
    name: r.name,
    description: r.description,
    facts: r.outside ? facts.filter(f => f[2]) : facts,
    result: r.result,
    table: r.table,
    hidden: r.hidden || [],
    layout: opts.layout,
    by: opts.by,
    byLabel: opts.byLabel,
    expires: opts.expires,
    nonce: opts.nonce,
    preview: opts.preview,
    pdf: opts.pdf,
  })
}

function venueWords(choice, venues) {
  if (!Array.isArray(choice) || !choice.length) return 'Every venue'
  const names = venues.filter(v => choice.includes(v.id)).map(v => v.name)
  return names.length ? names.join(', ') : 'Every venue'
}

/**
 * A Page report's page.
 *   doc   { name, description, blocks, choice }   blocks as resolveBlocks()
 *         left them; choice: the page's { period, venues } (null: each
 *         report's own)
 *   opts  as reportPrint's
 */
export async function pagePrint(p, about, doc, opts = {}) {
  const choice = doc.choice || {}
  const sections = [], runs = []
  let rows = 0, asOf = null, tz = null, periodWords = null, tookVenues = false
  for (const b of Array.isArray(doc.blocks) ? doc.blocks : []) {
    if (b.type === 'break') { sections.push({ type: 'break' }); continue }
    if (b.type === 'text') { sections.push({ type: 'text', title: b.title, text: b.text }); continue }
    if (b.type !== 'report') continue
    const title = b.title || b.name || 'Report'
    if (!b.spec) { sections.push({ type: 'report', title, error: b.error || BLOCK_GONE }); continue }
    const started = Date.now()
    const base = normaliseReport(b.spec)
    const given = b.given && typeof b.given === 'object' ? b.given : {}
    const values = resolveParams(base, given)
    const run = { ref: b.ref, name: b.name, spec: base, params: values }
    try {
      const result = await runReport(p.ctx, base, given)
      const meta = result.meta || {}
      // What the page says once at its top isn't said again under each report.
      const periodKey = base.params.find(x => x.type === 'period')?.key
      const venuesKey = base.params.find(x => x.type === 'venues')?.key
      const took = {
        period: !!choice.period && !!periodKey && periodKey in given && !!meta.period,
        venues: choice.venues != null && !!venuesKey && venuesKey in given,
      }
      if (took.period && !periodWords) periodWords = meta.period.text
      if (took.venues) tookVenues = true
      const facts = printFacts({ base, result, levels: p.levels, values, venues: about.venues })
        .filter(f => !(took.period && f[0] === 'Period') && !(took.venues && f[2] === 'venues'))
      sections.push({ type: 'report', title, about: b.description, facts, result, ...printShow(b.show) })
      const read = meta.cached_at || meta.generated_at
      if (read && (!asOf || read < asOf)) asOf = read
      tz = tz || meta.tz || null
      const n = meta.row_count ?? result.rows.length
      rows += n
      runs.push({ ...run, rows: n, ms: Date.now() - started })
    } catch (e) {
      const plain = e?.statusCode && e.statusCode < 500
      sections.push({ type: 'report', title, error: plain ? ((Array.isArray(e.problems) && e.problems.join(' ')) || e.message) : BLOCK_FAILED })
      runs.push({ ...run, ms: Date.now() - started, error: plain ? e.message : 'The report failed' })
    }
  }
  const facts = []
  if (periodWords) facts.push(['Period', periodWords, 'period'])
  if (tookVenues) facts.push(['Venues', venueWords(choice.venues, about.venues), 'venues'])
  const html = printHtml({
    group: about.group,
    logo: about.logo,
    brand: about.brand,
    name: doc.name,
    description: doc.description,
    facts,
    sections,
    asOf: asOf || new Date().toISOString(),
    tz: tz || undefined,
    layout: opts.layout,
    by: opts.by,
    byLabel: opts.byLabel,
    expires: opts.expires,
    nonce: opts.nonce,
    preview: opts.preview,
    pdf: opts.pdf,
  })
  return { html, runs, rows }
}
