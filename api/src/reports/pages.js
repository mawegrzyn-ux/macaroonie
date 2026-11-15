// src/reports/pages.js
//
// Page reports on the server (docs/REPORTS.md 6, 11; the rules are
// shared/reports/page.js). A page is a row of `reports` with subject 'page'
// and its blocks in `spec`: the list, sharing, stars, names and copies are
// the reports' own. Its blocks are references: every report is found and
// run as the person looking.
//
//   checkedPage(raw, person)        a page's definition ready to save: tidy,
//                                   with a report on it, every report one the
//                                   person can open, its venues the group's
//                                   own. Throws ReportError / 404
//   pageReports(spec, person)       what the page's viewer and editor need
//                                   to know of each report it names, by ref:
//                                   { name, description, kind, view, runs,
//                                   needs, problem } or { missing: true }
//   pageChoice(spec, body)          the period and venues a page is looked at
//                                   with: the visitor's, where the page has a
//                                   period or venues of its own to change
//   resolveBlocks(person, spec, body)
//                                   { blocks, choice }: each block as the
//                                   print page takes it, the reports found
//                                   and checked for the person: { type:
//                                   'report', id, title, show, ref, name,
//                                   description, spec, given } or, for one
//                                   that can't be shown, { type: 'report',
//                                   id, title, error }
//   runBlock(person, page, blockId, body, opts)
//                                   one report block found and checked for
//                                   the screen: { block, target, given, run }
//                                   (run() runs it; the route records it)

import { httpError } from '../middleware/error.js'
import { ReportError } from './compile.js'
import { checkedSpec, refuseOtherVenues, groupVenues, runsFor } from './access.js'
import { loadTargets } from './target.js'
import { runReport } from './run.js'
import { BLOCK_GONE } from './export/printPage.js'
import { normalisePage, pageProblems, pageRefs, blockGiven } from '../../../shared/reports/page.js'
import { normalisePeriod } from '../../../shared/reports/period.js'
import { cleanVenues } from '../../../shared/reports/spec.js'

// A venues choice names only the group's own venues (the app-wide check
// only sees keys called venue_id).
async function ownVenues(p, ids) {
  if (!Array.isArray(ids) || !ids.length) return
  const own = new Set((await groupVenues(p)).map(v => v.id))
  if (ids.some(id => !own.has(id))) throw httpError(404, 'Venue not found')
}

export async function checkedPage(raw, p) {
  const spec = normalisePage(raw)
  const problems = pageProblems(spec)
  if (problems.length) throw new ReportError(problems)
  await ownVenues(p, spec.venues)
  const targets = await loadTargets(pageRefs(spec), p)
  const lost = spec.blocks.filter(b => b.type === 'report' && !targets.get(b.ref)).length
  if (lost) {
    throw new ReportError((lost === 1 ? 'One of the page\'s reports isn\'t' : lost + ' of the page\'s reports aren\'t')
      + ' here any more, or ' + (lost === 1 ? 'isn\'t' : 'aren\'t') + ' shared with you. Take ' + (lost === 1 ? 'it' : 'them') + ' off the page')
  }
  return spec
}

export async function pageReports(spec, p) {
  const out = {}
  for (const [ref, t] of await loadTargets(pageRefs(spec), p)) {
    out[ref] = !t ? { missing: true } : {
      name: t.name,
      description: t.description || null,
      kind: t.spec?.kind || null,
      view: t.spec?.view?.kind || 'table',
      has_period: !!t.spec?.params.some(x => x.type === 'period'),
      has_venues: !!t.spec?.params.some(x => x.type === 'venues'),
      ...(t.spec ? runsFor(t.spec.subject, p.levels) : { runs: false, needs: null }),
      ...(t.problem ? { problem: t.problem } : {}),
    }
  }
  return out
}

export function pageChoice(spec, body = {}) {
  return {
    period: spec.period ? (normalisePeriod(body?.period) || spec.period) : null,
    venues: spec.venues != null ? (body?.venues != null ? cleanVenues(body.venues) : spec.venues) : null,
  }
}

const plainly = e => (e instanceof ReportError || (e?.statusCode && e.statusCode < 500) ? ((Array.isArray(e.problems) && e.problems.join(' ')) || e.message) : null)

export async function resolveBlocks(p, spec, body = {}) {
  const choice = pageChoice(spec, body)
  await ownVenues(p, choice.venues)
  const targets = await loadTargets(pageRefs(spec), p)
  const blocks = []
  for (const b of spec.blocks) {
    if (b.type === 'break') { blocks.push({ type: 'break' }); continue }
    if (b.type === 'text') { blocks.push({ type: 'text', title: b.title, text: b.text }); continue }
    const t = targets.get(b.ref)
    if (!t) { blocks.push({ type: 'report', id: b.id, title: b.title || 'Report', error: BLOCK_GONE }); continue }
    const title = b.title || t.name
    if (!t.spec) { blocks.push({ type: 'report', id: b.id, title, error: t.problem }); continue }
    const given = blockGiven(t.spec, choice)
    await refuseOtherVenues(p, t.spec, given)
    try {
      // Checked for the person now, so a refusal is said on the page in the report's place.
      checkedSpec(t.spec, p)
    } catch (e) {
      const words = plainly(e)
      if (!words) throw e
      blocks.push({ type: 'report', id: b.id, title, error: words })
      continue
    }
    blocks.push({ type: 'report', id: b.id, title, show: b.show, ref: t.ref, name: t.name, description: t.description || null, spec: t.spec, given })
  }
  return { blocks, choice }
}

export async function runBlock(p, spec, blockId, body = {}, opts = {}) {
  const block = spec.blocks.find(b => b.type === 'report' && b.id === blockId)
  if (!block) throw httpError(404, 'That report isn\'t on this page')
  const target = (await loadTargets([block.ref], p)).get(block.ref)
  if (!target) throw httpError(404, BLOCK_GONE)
  if (!target.spec) throw new ReportError(target.problem)
  const choice = pageChoice(spec, body)
  await ownVenues(p, choice.venues)
  const given = blockGiven(target.spec, choice)
  await refuseOtherVenues(p, target.spec, given)
  return { block, target, given, run: () => runReport(p.ctx, target.spec, given, opts) }
}
