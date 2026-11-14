// src/ai/tools/reports.js
//
// Reports (the report builder, docs/REPORTS.md 16) for Pepper (staff
// assistant and staff MCP). Permissions are the Reports module's:
//
//   find_fields     what a report can be built from: the subjects, their
//                   figures and fields, as the paths a plan takes        reports, view
//   explain_figure  what a figure (or a field) counts, by its rule       reports, view
//   list_reports    the reports the person can open, starters too        reports, view
//   get_report      one report: what it shows, what it asks, its plan    reports, view
//   run_report      run a saved report or a starter, as it is or for
//                   another period and other venues                      reports, view
//   ask_data        a question answered from the data: a plan built and
//                   run as the person, nothing saved                     reports, use
//   build_report    save a report from a plan                            reports, use
//   change_report   change a saved report (its plan, name or about)      reports, use
//   copy_report     a copy of a report or a starter as the person's own  reports, use
//   delete_report   delete a saved report                                reports, use
//   share_report    who a report is shared with; offer it as a starter   reports, manage
//
// Everything goes through the report routes (callApi), as the person: a
// plan (src/reports/plan.js) names the catalogue's own paths, never SQL, and
// POST /api/reports/plan makes the definition through the builder's edits
// and runs it with the person's role, so Pepper sees what they may see and
// nothing more. Runs Pepper asks for are recorded as Pepper's and limited
// per person per minute (limitPepperRuns() in src/reports/access.js).

import { z } from 'zod'
import { ToolError, callApi, requireStaffPermission } from '../context.js'
import { pickByName, tenantVenueList, audited } from './util.js'
import { officeOrigin } from '../../services/platformHost.js'
import { CATALOGUE } from '../../reports/catalogue/index.js'
import { PEPPER_HEADER } from '../../reports/access.js'
import { PLAN, planOf } from '../../reports/plan.js'
import { rankSubjects, typeText, usesText, stem, indexWords } from '../../reports/smart.js'
import { dataTree, treeNodes, paramInputs, paramWords } from '../../../../shared/reports/build.js'
import { describeReport } from '../../../../shared/reports/describe.js'
import { tableModel } from '../../../../shared/reports/table.js'
import { LIMITS } from '../../../../shared/reports/spec.js'
import { RELATIVE_PERIODS } from '../../../../shared/reports/period.js'

const SHOWN_ROWS = 40          // rows of a result Pepper is given, unless it asks for more
const MAX_ROWS = 200
const CARD_ROWS = 3            // rows of a result on a confirm card
const FIELD_LINES = 14         // matching figures and fields per subject in a search
const SUBJECTS_FOUND = 5

const clip = (t, n) => {
  const s = String(t || '').replace(/\s+/g, ' ').trim()
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s
}
const lowerFirst = s => (s && /^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s || '')

const reportPath = id => '/reports/' + encodeURIComponent(id)
// Runs Pepper asks for carry this mark: recorded as Pepper's and limited per
// person per minute (limitPepperRuns()).
const AS_PEPPER = { [PEPPER_HEADER]: 'pepper' }

const linkTo = (ctx, label, path) => (ctx.channel === 'staff_chat'
  ? { link: '[' + label + '](' + path + ')' }
  : { url: officeOrigin() + path })

// ── The catalogue, as the person may see it ──────────────────

async function catalogueFor(ctx, level = 'view') {
  await requireStaffPermission(ctx, 'reports', level)
  return callApi(ctx, 'GET', '/api/reports/catalogue')
}

const baseSubjects = cat => Object.values(cat.subjects).filter(s => s.base)

function subjectOf(cat, text) {
  const t = String(text || '').trim().toLowerCase()
  const base = baseSubjects(cat)
  if (!base.length) throw new ToolError('Your role can\'t report on anything yet: each kind of report needs its own area (till reports, online orders, bookings).', 403)
  const byKey = base.find(s => s.key === t)
  if (byKey) return byKey
  return pickByName(base.map(s => ({ ...s, id: s.key })), text, s => s.label, 'report subject')
}

const areaLabel = (cat, key) => (cat.areas || []).find(a => a.key === key)?.label || key

function subjectView(cat, s) {
  return {
    subject: s.key,
    label: s.label,
    area: areaLabel(cat, s.area),
    rows: 'Each row is one ' + (s.one || 'row')
      + (s.dated ? ', with a day of its own (a period applies)' : ', with no day of its own (no period)')
      + (s.venue ? ', at a venue' : ''),
    about: clip(s.about, 260),
  }
}

// One line per figure or field: path | name | kind | what it can be | about.
function nodeLine(cat, subjectKey, n) {
  const parts = [n.path, n.full, typeText(cat, subjectKey, n)]
  const uses = usesText(n.uses)
  if (uses) parts.push(uses)
  if (n.about && !n.trail.length) parts.push(clip(n.about, 160))
  return parts.join(' | ')
}

const STOP = new Set(['a', 'an', 'the', 'of', 'by', 'per', 'for', 'and', 'or', 'in', 'on', 'at', 'to', 'from', 'with',
  'each', 'every', 'how', 'many', 'much', 'what', 'which', 'who', 'show', 'me', 'us', 'list', 'report', 'reports', 'our', 'we', 'is', 'are', 'was', 'were', 'did', 'do'])

// Figures and fields whose words hold the topic's words, best first.
function matchNodes(tree, topic) {
  const words = [...new Set(indexWords(topic).filter(w => !STOP.has(w)).map(stem))]
  if (!words.length) return []
  return treeNodes(tree)
    .map((n, i) => {
      const have = new Set(indexWords([n.label, n.full, n.trail.join(' '), n.about].join(' ')).map(stem))
      const hits = words.filter(w => have.has(w)).length
      return { n, i, hits, figure: n.what === 'measure' ? 1 : 0 }
    })
    .filter(x => x.hits > 0)
    .sort((a, b) => b.hits - a.hits || b.figure - a.figure || a.i - b.i)
    .map(x => x.n)
}

function subjectInFull(cat, s, topic) {
  const tree = dataTree(cat, s.key, { depth: 2 })
  const line = n => nodeLine(cat, s.key, n)
  const out = {
    ...subjectView(cat, s),
    how_many: 'count: true | how many ' + lowerFirst(s.label) + ' | number',
    figures: tree.figures.map(line),
    fields: tree.fields.map(line),
    linked: [],
  }
  const folder = (fo, trail) => {
    const name = [...trail, fo.label].join(' > ')
    out.linked.push({
      through: fo.many
        ? 'A list of ' + name + ' (each ' + (s.one || 'row') + ' has several: only their totals)'
        : name + ' (each ' + (trail.length ? 'of these' : s.one || 'row') + ' has one)',
      lines: [...(fo.node ? [fo.node] : []), ...fo.figures, ...fo.fields].map(line),
    })
    fo.folders.forEach(x => folder(x, [...trail, fo.label]))
  }
  tree.folders.forEach(x => folder(x, []))
  if (topic) {
    const hits = matchNodes(tree, topic).slice(0, FIELD_LINES).map(line)
    if (hits.length) out.best_for_the_topic = hits
  }
  return out
}

// ── Reports ──────────────────────────────────────────────────

async function reportList(ctx) {
  return callApi(ctx, 'GET', '/api/reports')
}

// A report by its id or name: an id first, then a name, the person's own
// report before others when a copy and its starter share a name.
function pickReport(list, text) {
  const rows = [...(list.reports || []), ...(list.starters || [])]
  const raw = String(text ?? '').trim()
  const byId = rows.find(r => r.id === raw)
  if (byId) return byId
  const same = rows.filter(r => r.name.toLowerCase() === raw.toLowerCase())
  if (same.length > 1) {
    const mine = same.filter(r => r.kind === 'saved' && r.mine)
    if (mine.length === 1) return mine[0]
    const saved = same.filter(r => r.kind === 'saved')
    if (saved.length === 1) return saved[0]
    throw new ToolError('More than one report is called "' + raw + '": '
      + same.map(r => r.id + ' (' + ownerWords(r) + ')').join(', ') + '. Which one? Give its id.', 409)
  }
  return pickByName(rows, raw, r => r.name, 'report', 'There are no reports yet.')
}

const ownerWords = r => (r.kind === 'starter' ? 'a starter that comes with Macaroonie'
  : r.mine ? 'yours' : 'made by ' + (r.owner_email || 'someone else'))

const SHARED_WORDS = { private: 'only its owner (and people with Manage on Reports)', roles: 'some roles', everyone: 'everyone with Reports' }

async function loadReport(ctx, text) {
  const list = await reportList(ctx)
  const found = pickReport(list, text)
  const { report } = await callApi(ctx, 'GET', '/api/reports/' + encodeURIComponent(found.id))
  return report
}

function venueNames(venues) {
  return venues.map(v => ({ id: v.id, name: v.name }))
}

// A result as Pepper reads it: the headings, then each row's cells in words.
function tableOf(result, max) {
  const t = tableModel(result)
  const columns = (result.columns || []).map(c => (c.group ? c.group + ': ' + c.label : c.label))
  const rows = t.rows.slice(0, max).map(r => r.cells)
  const meta = result.meta || {}
  return {
    ...(meta.period?.text ? { period: meta.period.text } : {}),
    ...(meta.compare?.text ? { compared_with: meta.compare.text } : {}),
    columns,
    rows,
    ...(t.total ? { total: t.total } : {}),
    ...(t.rows.length > max ? { more_rows: t.rows.length - max + ' more rows on the report itself' } : {}),
    ...(meta.truncated ? { cut: 'The list has more rows than a run holds (' + meta.row_count + ' in all): open the report or download it' } : {}),
    ...(meta.notes?.length ? { notes: meta.notes } : {}),
  }
}

function cardRows(result) {
  if (!result?.columns?.length) return []
  const t = tableModel(result)
  const head = result.columns.map(c => (c.group ? c.group + ': ' + c.label : c.label)).join(' | ')
  const rows = t.rows.slice(0, CARD_ROWS).map(r => r.cells.join(' | '))
  return rows.length ? ['First rows:', head, ...rows] : ['It shows no rows for its period at the moment.']
}

// A plan built and run as the person (POST /api/reports/plan): its answer,
// or a ToolError saying what in the plan isn't there, with the near ones.
async function runPlan(ctx, plan, { report = null, rows = SHOWN_ROWS } = {}) {
  const out = await callApi(ctx, 'POST', '/api/reports/plan', { body: { plan, report, rows }, headers: AS_PEPPER })
  if (!out.spec) {
    const near = []
    const u = out.unknown || {}
    if (u.subjects?.length) near.push('Subjects there are: ' + u.subjects.map(s => s.subject + ' (' + s.label + ')').join(', '))
    for (const p of u.paths || []) {
      near.push('"' + p.path + '" isn\'t there' + (p.subject ? ' in ' + p.subject : '') + (p.near?.length ? '; near: ' + p.near.join(', ') : ''))
    }
    if (u.names?.length) near.push('Not a figure of the plan: ' + u.names.join(', '))
    if (u.froms?.length) near.push('Not another subject of the plan: ' + u.froms.join(', '))
    throw new ToolError((out.problem || 'That plan can\'t be built') + (near.length ? '. ' + near.join('. ') : '')
      + '. find_fields lists what each subject has.', 422)
  }
  return out
}

// A plan made into a definition that runs, for run() when no card pinned one
// (the staff connector calls run() straight away).
async function plannedSpec(ctx, plan, report = null) {
  const out = await runPlan(ctx, plan, { report, rows: 1 })
  if (!out.result) throw new ToolError(out.problem || 'The report couldn\'t be run, so nothing was saved', 422)
  return out.spec
}

const answerWords = out => ({
  ...(out.about ? { shows: out.about } : {}),
  ...(out.assumed?.length ? { assumed: out.assumed } : {}),
  ...(out.couldnt?.length ? { couldnt: out.couldnt } : {}),
  ...(out.questions?.length ? {
    questions: out.questions.map(q => ({ question: q.question, choices: (q.choices || []).map(c => c.label) })),
  } : {}),
})

// The values a run of a saved report or a starter is given: its period and
// its venues, from what the person said; its other choices stay as saved.
async function runParams(ctx, spec, input) {
  const params = {}
  const period = (spec.params || []).find(p => p.type === 'period')
  if (input.period) {
    if (!period) throw new ToolError('This report has no period to change: it isn\'t about days.', 422)
    const pd = input.period
    if (pd.relative) params[period.key] = { relative: pd.relative, ...(pd.n ? { n: pd.n } : {}) }
    else if (pd.from && pd.to) params[period.key] = { from: pd.from, to: pd.to }
    else throw new ToolError('Give a period as relative (last_week, last_n_days with n) or as from and to (YYYY-MM-DD).', 422)
  }
  const venues = (spec.params || []).find(p => p.type === 'venues')
  if (input.venues) {
    if (!venues) throw new ToolError('This report has no venues to pick.', 422)
    const all = await tenantVenueList(ctx)
    params[venues.key] = [...new Set(input.venues.map(v => pickByName(all, v, x => x.name, 'venue').id))]
  }
  return params
}

// ── Words and checks the tools share ──────────────────────────

const KIND_WORDS = { money: 'money', number: 'a number', percent: 'a percentage', duration: 'a length of time', text: 'words', choice: 'one of a list', yesno: 'yes or no', date: 'a day', moment: 'a moment (day and time)' }

const ADDS_UP = {
  sum: 'A total: it adds up across rows, groups and the total row.',
  count: 'A count of rows.',
  count_distinct: 'How many different ones: the total row counts each once, so it can be less than its groups added up.',
  avg: 'An average: each group\'s from its own rows, and the total row\'s from every row (not an average of the groups).',
  min: 'The smallest value.',
  max: 'The largest value.',
}

// change_report with nothing to change: refused on the card and, since the
// staff connector calls run() straight away, in run() too.
function somethingToChange(input) {
  if (!input.plan && input.name === undefined && input.description === undefined) {
    throw new ToolError('Say what to change: the plan (from get_report, changed), the name or the description.', 422)
  }
}

// A saved report the person may change (or delete), else why not.
async function editable(ctx, text, what = 'change') {
  const r = await savedOnly(ctx, text, what === 'delete'
    ? ' comes with Macaroonie and can\'t be deleted.'
    : ' comes with Macaroonie: copy it first (copy_report), then change the copy.')
  if (!(what === 'delete' ? r.can_delete : r.can_edit)) {
    throw new ToolError('Only the person who made "' + r.name + '", or someone with Manage on Reports, can ' + what + ' it.'
      + (what === 'change' ? ' copy_report makes your own copy to change.' : ''), 403)
  }
  return r
}

async function savedOnly(ctx, text, starterWhy = ' comes with Macaroonie and is already open to everyone with Reports.') {
  const r = await loadReport(ctx, text)
  if (r.kind === 'starter') throw new ToolError('"' + r.name + '" is a starter report: it' + starterWhy, 422)
  return r
}

async function rolesFor(ctx, names) {
  if (!names?.length) throw new ToolError('Name the roles to share it with.', 422)
  const roles = await callApi(ctx, 'GET', '/api/access/roles')
  const live = (roles || []).filter(x => x.is_active !== false)
  return [...new Map(names.map(n => pickByName(live, n, x => x.label, 'role')).map(x => [x.id, x])).values()]
}

// ── The tools ─────────────────────────────────────────────────

const PeriodInput = z.object({
  relative: z.enum(RELATIVE_PERIODS).optional(),
  n: z.number().int().min(1).max(3660).optional().describe('With last_n_days and next_n_days'),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})
const Rows = z.number().int().min(1).max(MAX_ROWS).optional()
  .describe('How many rows to read back (' + SHOWN_ROWS + ' unless asked; ' + MAX_ROWS + ' at most)')
const ReportRef = z.string().trim().min(1).max(200).describe('The report\'s name, or its id from list_reports')
const Pinned = z.record(z.any()).optional().describe('Leave out: the confirm card pins it')

export const reportTools = [
  {
    name: 'find_fields',
    section: 'reports',
    title: 'Reports: what a report can be built from',
    description:
      'What the person\'s reports can be about (subjects: dishes sold, checks, payments, voids, online orders, bookings, guests, ' +
      'deposits...) and each subject\'s figures and fields, as the paths ask_data and build_report take. Give a topic in words ' +
      '("dishes sold by hour", "tips by server", "no-shows") to find the subject and the paths that fit, or a subject to list ' +
      'everything it has. Lines read: path | name | kind | what it can be (figure, group by day/week/..., filter) | about. ' +
      'Prefer a subject\'s figures over adding up a field (figures carry the app\'s rules: net sales leaves voided dishes out); ' +
      'explain_figure says exactly what one counts.',
    input: z.object({
      topic: z.string().trim().max(200).optional().describe('What the report or question is about, in words'),
      subject: z.string().trim().max(80).optional().describe('A subject key (till.lines) or name, to list everything it has'),
    }),
    readOnly: true,
    async run(ctx, input) {
      const cat = await catalogueFor(ctx)
      if (input.subject) return subjectInFull(cat, subjectOf(cat, input.subject), input.topic)
      if (!input.topic) throw new ToolError('Give a topic in words, or a subject to list.', 422)
      const base = baseSubjects(cat)
      if (!base.length) return { subjects: [], note: 'Your role can\'t report on anything yet.' }
      const ranked = rankSubjects(cat, input.topic).slice(0, SUBJECTS_FOUND)
      const subjects = ranked.map(r => cat.subjects[r.key]).filter(Boolean)
      return {
        subjects: subjects.map((s, i) => {
          const view = subjectView(cat, s)
          if (i > 1) return view
          const tree = dataTree(cat, s.key, { depth: 2 })
          const hits = matchNodes(tree, input.topic).slice(0, FIELD_LINES).map(n => nodeLine(cat, s.key, n))
          return { ...view, ...(hits.length ? { matching: hits } : {}), figures: tree.figures.map(n => n.path + ' | ' + n.full) }
        }),
        note: 'One subject per report. find_fields with a subject lists all of it, linked things included (a dish line\'s check, server, venue).',
      }
    },
  },

  {
    name: 'explain_figure',
    section: 'reports',
    title: 'Reports: what a figure counts',
    description:
      'Exactly what one of a subject\'s figures (or fields) counts, from the app\'s own rules: which rows it takes (closed checks ' +
      'only, voided dishes left out, cancelled bookings left out...), how it adds up, and for a rate or an average what it divides. ' +
      'Use it to answer "does net sales include tips?", "why is this different from takings?", or to pick the right figure.',
    input: z.object({
      subject: z.string().trim().min(1).max(80).describe('The subject key (till.lines) or name'),
      figure: z.string().trim().min(1).max(160).describe('Its path from find_fields (net_sales, check.server.name), or its name'),
    }),
    readOnly: true,
    async run(ctx, input) {
      const cat = await catalogueFor(ctx)
      const s = subjectOf(cat, input.subject)
      const asked = input.figure.trim().toLowerCase()
      if (asked === 'count' || asked === 'count: true' || asked === 'how many') {
        return {
          name: 'How many ' + lowerFirst(s.label),
          kind: 'a number',
          counts: 'Every ' + (s.one || 'row') + ' the report takes counts once, after its filters (and its period).',
          adds_up: ADDS_UP.count,
        }
      }
      const nodes = treeNodes(dataTree(cat, s.key, { depth: 2 }))
      const node = pickByName(nodes.map(n => ({ ...n, id: n.path })), input.figure, n => n.full, 'figure or field of ' + s.label)
      const parts = node.path.split('.')
      // The subject the figure or field belongs to, through its links.
      let owner = s
      for (const k of parts.slice(0, -1)) owner = cat.subjects[owner.links?.[k]?.to] || owner
      const key = parts[parts.length - 1]
      const out = { name: node.full, path: node.path, of: owner.label }
      if (node.what === 'link') {
        const to = cat.subjects[owner.links?.[key]?.to]
        out.kind = 'the ' + lowerFirst(to?.one || node.label) + ' each ' + (parts.length > 1 ? 'of these' : s.one || 'row') + ' belongs to'
        out.about = node.about || to?.about || ''
        out.can_be = usesText(node.uses) || 'a folder of its own fields'
        return out
      }
      out.kind = KIND_WORDS[node.type] || node.type
      const measure = node.what === 'measure' ? owner.measures?.[key] : null
      if (measure) {
        out.counts = measure.about || (measure.agg === 'count' ? 'How many ' + lowerFirst(owner.label) + ' there are.' : measure.label + '.')
        const raw = CATALOGUE.subjects[owner.key]?.measures?.[key]
        if (raw?.ratio) {
          const [a, b] = raw.ratio.map(k => owner.measures?.[k])
          out.adds_up = a && b
            ? 'A rate: ' + lowerFirst(a.label) + ' divided by ' + lowerFirst(b.label) + '. Each group\'s is worked out from its own totals, never as an average of rows.'
            : 'A rate worked out from two other figures.'
          if (a && b) out.parts = [a, b].map(m => ({ figure: m.label, counts: m.about || m.label }))
        } else {
          out.adds_up = ADDS_UP[measure.agg] || ''
        }
        if (parts.length > 1) out.through = 'Added up over each ' + (s.one || 'row') + '\'s ' + lowerFirst(node.trail.join(' > '))
      } else {
        const field = owner.fields?.[key]
        out.about = field?.about || node.about || ''
        if (field?.labels) out.choices = Object.values(field.labels)
        out.can_be = usesText(node.uses) || 'shown in a list'
        if (field?.pii) out.personal = 'A guest\'s or a person\'s details: shown only to roles that may see them.'
      }
      return out
    },
  },

  {
    name: 'list_reports',
    section: 'reports',
    title: 'Reports: the ones you can open',
    description:
      'The saved reports the person can open (their own, the team\'s shared with them) and the starter reports that come with ' +
      'Macaroonie, with a link to each. Filter by words in the name or description, by area (till, online, bookings), or to ' +
      'starred, yours or the starters only. run_report runs one; get_report says what it shows.',
    input: z.object({
      search: z.string().trim().max(120).optional(),
      area: z.string().trim().max(40).optional().describe('An area\'s name or key: till, online, bookings'),
      only: z.enum(['starred', 'mine', 'starters', 'saved']).optional(),
    }),
    readOnly: true,
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'reports', 'view')
      const list = await reportList(ctx)
      const areas = list.areas || []
      const area = input.area
        ? (areas.find(a => a.key === input.area.toLowerCase()) || pickByName(areas.map(a => ({ ...a, id: a.key })), input.area, a => a.label, 'area')).key
        : null
      const words = indexWords(input.search || '').filter(w => !STOP.has(w))
      const keep = r => (!area || r.area === area)
        && (!words.length || words.every(w => (r.name + ' ' + (r.description || '')).toLowerCase().includes(w)))
        && (input.only !== 'starred' || r.starred)
        && (input.only !== 'mine' || (r.kind === 'saved' && r.mine))
        && (input.only !== 'starters' || r.kind === 'starter')
        && (input.only !== 'saved' || r.kind === 'saved')
      const rows = [...(list.reports || []), ...(list.starters || [])].filter(keep)
      const shown = rows.slice(0, 30)
      return {
        reports: shown.map(r => ({
          name: r.name,
          id: r.id,
          whose: ownerWords(r),
          area: areaLabel({ areas }, r.area),
          ...(r.description ? { about: clip(r.description, 200) } : {}),
          ...(r.starred ? { starred: true } : {}),
          ...(r.runs === false ? { cant_run: 'Needs ' + (r.needs || 'another area') } : {}),
          ...linkTo(ctx, r.name, reportPath(r.id)),
        })),
        ...(rows.length > shown.length ? { more: rows.length - shown.length + ' more: narrow the search' } : {}),
        ...(!rows.length ? { note: 'No report matches. ask_data answers a question from the data without a saved report.' } : {}),
      }
    },
  },

  {
    name: 'get_report',
    section: 'reports',
    title: 'Reports: what one shows and asks',
    description:
      'One report in full: what it shows in a sentence, the choices it asks for (period, venues, others) and what they are set to, ' +
      'whose it is and who can change it, and its plan: the report written the way ask_data, build_report and change_report take it. ' +
      'To run a report with other choices than its period and venues, change them in the plan and use ask_data.',
    input: z.object({ report: ReportRef }),
    readOnly: true,
    async run(ctx, input) {
      const cat = await catalogueFor(ctx)
      const r = await loadReport(ctx, input.report)
      if (r.runs === false) {
        return {
          name: r.name, id: r.id, whose: ownerWords(r),
          ...(r.description ? { about: r.description } : {}),
          cant_run: 'Your role can\'t run it: it needs ' + (r.needs || 'another area') + '. An owner or admin can give access.',
        }
      }
      const venues = venueNames(await tenantVenueList(ctx))
      const { plan, kept } = planOf(cat, r.spec, venues, r.name)
      const choices = paramInputs(cat, r.spec).map(i => i.label + ': ' + (paramWords(cat, i, i.default, { venues }) || 'anything'))
      return {
        name: r.name,
        id: r.id,
        whose: ownerWords(r),
        ...(r.description ? { about: r.description } : {}),
        shows: describeReport(cat, r.spec, { venues }),
        ...(choices.length ? { choices } : {}),
        ...(r.kind === 'saved' ? { shared_with: SHARED_WORDS[r.shared] || r.shared, ...(r.is_starter ? { offered_as_starter: true } : {}) } : {}),
        can_change: !!r.can_edit,
        ...(r.can_share ? { can_share: true } : {}),
        plan,
        ...(kept.length ? { kept_when_changed: kept } : {}),
        ...linkTo(ctx, r.name, reportPath(r.id)),
      }
    },
  },

  {
    name: 'run_report',
    section: 'reports',
    title: 'Reports: run one',
    description:
      'Runs a saved report or a starter as it is, or for another period and other venues, and reads the figures back (the rows ' +
      'as on the page, with its total). Use list_reports to find one. For other changes (another filter, a figure added), take ' +
      'its plan from get_report and use ask_data. Give the link when the person should look at it themselves.',
    input: z.object({
      report: ReportRef,
      period: PeriodInput.optional().describe('Another period: relative (last_week, last_n_days with n) or from and to'),
      venues: z.array(z.string().trim().min(1).max(120)).max(50).optional().describe('Venue names; leave out to keep the report\'s own'),
      rows: Rows,
    }),
    readOnly: true,
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'reports', 'view')
      const r = await loadReport(ctx, input.report)
      if (r.runs === false) throw new ToolError('Your role can\'t run "' + r.name + '": it needs ' + (r.needs || 'another area') + '. Ask an owner or admin.', 403)
      const params = await runParams(ctx, r.spec, input)
      const result = await callApi(ctx, 'POST', '/api/reports/' + encodeURIComponent(r.id) + '/run', { body: { params }, headers: AS_PEPPER })
      return {
        report: r.name,
        ...tableOf(result, input.rows ?? SHOWN_ROWS),
        ...linkTo(ctx, r.name, reportPath(r.id)),
      }
    },
  },

  {
    name: 'ask_data',
    section: 'reports',
    title: 'Reports: answer a question from the data',
    description:
      'Answers a question about the figures (sales, dishes sold, takings by tender, tips, voids, discounts, covers, online orders, ' +
      'bookings, no-shows, deposits...) by building a report from a plan and running it as the person: nothing is saved. Find the ' +
      'subject and paths with find_fields first. A plan: subject; by (groupings, outer first; a day with a bucket: day, week, ' +
      'month, weekday, hour); figures (figure paths, or count: true; a calc over them as v1, v2); filters; period (left out: last ' +
      'week); venues by name; sort, top, compare, chart; also (other subjects whose figures go beside, lined up by the rows: sales ' +
      'against the hours on the rota or the weather; such a figure names its subject in from). Answer from the rows, say what was ' +
      'assumed, and offer build_report to keep it.',
    input: z.object({ plan: PLAN, rows: Rows }),
    readOnly: true,
    needs: 'use',
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'reports', 'use')
      const out = await runPlan(ctx, input.plan, { rows: input.rows ?? SHOWN_ROWS })
      if (!out.result) throw new ToolError(out.problem || 'The report couldn\'t be run', 422)
      return {
        name: out.name,
        ...answerWords(out),
        ...tableOf(out.result, input.rows ?? SHOWN_ROWS),
        keep_it: 'Not saved. build_report saves it with the same plan.',
      }
    },
  },

  {
    name: 'build_report',
    section: 'reports',
    title: 'Reports: save a report',
    description:
      'Saves a report from a plan (as ask_data takes it) under a name, as the person\'s own, private until shared. The confirm card ' +
      'shows what it shows and its first rows. Use after the person likes what ask_data answered, or asks for a report to keep.',
    input: z.object({
      plan: PLAN,
      name: z.string().trim().min(1).max(LIMITS.name),
      description: z.string().trim().max(1000).optional().describe('What it is for, in a sentence'),
      spec: Pinned,
    }),
    confirm: true,
    needs: 'use',
    async describe(ctx, input) {
      await requireStaffPermission(ctx, 'reports', 'use')
      const out = await runPlan(ctx, input.plan, { rows: CARD_ROWS })
      if (!out.result) throw new ToolError(out.problem || 'The report couldn\'t be run, so it isn\'t saved', 422)
      return {
        title: 'Save the report "' + input.name + '"?',
        lines: [
          out.about,
          ...(input.description ? ['About: ' + input.description] : []),
          ...(out.assumed?.length ? ['Assumed: ' + out.assumed.join('; ')] : []),
          ...(out.couldnt?.length ? ['Couldn\'t: ' + out.couldnt.join('; ')] : []),
          ...cardRows(out.result),
          'It will be yours, shared with nobody until you share it.',
        ],
        confirmLabel: 'Save it',
        pin: { spec: out.spec },
      }
    },
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'reports', 'use')
      const spec = input.spec || await plannedSpec(ctx, input.plan)
      return audited(ctx, 'build_report', { name: input.name, subject: spec.subject }, async () => {
        const { report } = await callApi(ctx, 'POST', '/api/reports', {
          body: { name: input.name, ...(input.description ? { description: input.description } : {}), spec },
        })
        return { saved: report.name, id: report.id, ...linkTo(ctx, report.name, reportPath(report.id)) }
      })
    },
  },

  {
    name: 'change_report',
    section: 'reports',
    title: 'Reports: change a saved report',
    description:
      'Changes a saved report: its plan (take it from get_report and change what was asked: a figure, a grouping, a filter, the ' +
      'period, a chart), its name or its description. Only the person who made it, or someone with Manage on Reports, can change ' +
      'it; a starter is copied first (copy_report). What a plan can\'t say (get_report\'s kept_when_changed) is kept.',
    input: z.object({
      report: ReportRef,
      plan: PLAN.optional().describe('The report\'s plan from get_report, changed'),
      name: z.string().trim().min(1).max(LIMITS.name).optional(),
      description: z.string().trim().max(1000).nullable().optional().describe('null clears it'),
      spec: Pinned,
    }),
    confirm: true,
    needs: 'use',
    async describe(ctx, input) {
      somethingToChange(input)
      const cat = await catalogueFor(ctx, 'use')
      const r = await editable(ctx, input.report)
      const venues = venueNames(await tenantVenueList(ctx))
      const out = input.plan ? await runPlan(ctx, input.plan, { report: r.spec, rows: CARD_ROWS }) : null
      if (out && !out.result) throw new ToolError(out.problem || 'The changed report couldn\'t be run, so it isn\'t changed', 422)
      return {
        title: 'Change the report "' + r.name + '"?',
        lines: [
          ...(out ? ['Now: ' + describeReport(cat, r.spec, { venues }), 'After: ' + out.about] : []),
          ...(input.name && input.name !== r.name ? ['Name: ' + input.name] : []),
          ...(input.description !== undefined ? ['About: ' + (input.description || '(none)')] : []),
          ...(out?.assumed?.length ? ['Assumed: ' + out.assumed.join('; ')] : []),
          ...(out?.couldnt?.length ? ['Couldn\'t: ' + out.couldnt.join('; ')] : []),
          ...(out ? cardRows(out.result) : []),
          ...(r.mine ? [] : ['It is ' + ownerWords(r) + ': they will see the change.']),
        ],
        confirmLabel: 'Change it',
        pin: { report: r.id, ...(out ? { spec: out.spec } : {}) },
      }
    },
    async run(ctx, input) {
      somethingToChange(input)
      await requireStaffPermission(ctx, 'reports', 'use')
      const r = await editable(ctx, input.report)
      const spec = input.spec || (input.plan ? await plannedSpec(ctx, input.plan, r.spec) : null)
      const body = {
        ...(spec ? { spec } : {}),
        ...(input.name && input.name !== r.name ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description || null } : {}),
      }
      return audited(ctx, 'change_report', { report: r.name, changed: Object.keys(body) }, async () => {
        const { report } = await callApi(ctx, 'PUT', '/api/reports/' + encodeURIComponent(r.id), { body })
        return { changed: report.name, ...linkTo(ctx, report.name, reportPath(report.id)) }
      })
    },
  },

  {
    name: 'copy_report',
    section: 'reports',
    title: 'Reports: copy one as your own',
    description:
      'Makes a copy of a report, or of a starter that comes with Macaroonie, as the person\'s own (private until shared), to change ' +
      'it without touching the original.',
    input: z.object({
      report: ReportRef,
      name: z.string().trim().min(1).max(LIMITS.name).optional().describe('Left out: the same name, with (copy) for a saved report'),
    }),
    confirm: true,
    needs: 'use',
    async describe(ctx, input) {
      await requireStaffPermission(ctx, 'reports', 'use')
      const r = await loadReport(ctx, input.report)
      const name = input.name || (r.kind === 'starter' ? r.name : r.name + ' (copy)')
      return {
        title: 'Copy "' + r.name + '" as your own?',
        lines: ['The copy: "' + name.slice(0, LIMITS.name) + '", yours, shared with nobody until you share it.'],
        confirmLabel: 'Copy it',
        pin: { report: r.id },
      }
    },
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'reports', 'use')
      const r = await loadReport(ctx, input.report)
      return audited(ctx, 'copy_report', { report: r.name }, async () => {
        const { report } = await callApi(ctx, 'POST', '/api/reports/' + encodeURIComponent(r.id) + '/copy', {
          body: input.name ? { name: input.name } : {},
        })
        return { copied: r.name, as: report.name, id: report.id, ...linkTo(ctx, report.name, reportPath(report.id)) }
      })
    },
  },

  {
    name: 'delete_report',
    section: 'reports',
    title: 'Reports: delete one',
    description:
      'Deletes a saved report for good. Only the person who made it, or someone with Manage on Reports, can; starters can\'t be deleted.',
    input: z.object({ report: ReportRef }),
    confirm: true,
    destructive: true,
    needs: 'use',
    async describe(ctx, input) {
      await requireStaffPermission(ctx, 'reports', 'use')
      const r = await editable(ctx, input.report, 'delete')
      return {
        title: 'Delete the report "' + r.name + '"?',
        lines: [
          'This can\'t be undone.',
          ...(r.shared !== 'private' ? ['It is shared with ' + (SHARED_WORDS[r.shared] || r.shared) + ': they lose it too.'] : []),
          ...(r.mine ? [] : ['It is ' + ownerWords(r) + '.']),
        ],
        confirmLabel: 'Delete it',
        pin: { report: r.id },
      }
    },
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'reports', 'use')
      const r = await editable(ctx, input.report, 'delete')
      return audited(ctx, 'delete_report', { report: r.name }, async () => {
        await callApi(ctx, 'DELETE', '/api/reports/' + encodeURIComponent(r.id))
        return { deleted: r.name }
      })
    },
  },

  {
    name: 'share_report',
    section: 'reports',
    title: 'Reports: who sees a report',
    description:
      'Shares a saved report with nobody (only its owner), some roles, or everyone with Reports, and can offer it to the team as a ' +
      'starter. Needs Manage on Reports.',
    input: z.object({
      report: ReportRef,
      with: z.enum(['only_owner', 'roles', 'everyone']),
      roles: z.array(z.string().trim().min(1).max(80)).max(20).optional().describe('Role names, with "roles"'),
      starter: z.boolean().optional().describe('true: offered to the team among the starters; false: not'),
      role_ids: z.array(z.string().uuid()).max(50).optional().describe('Leave out: the confirm card pins them'),
    }),
    confirm: true,
    needs: 'manage',
    async describe(ctx, input) {
      await requireStaffPermission(ctx, 'reports', 'manage')
      const r = await savedOnly(ctx, input.report)
      const roles = input.with === 'roles' ? await rolesFor(ctx, input.roles) : []
      return {
        title: 'Share the report "' + r.name + '"?',
        lines: [
          input.with === 'everyone' ? 'With everyone who has Reports.'
            : input.with === 'roles' ? 'With: ' + roles.map(x => x.label).join(', ') + '.'
            : 'With nobody: only its owner (and people with Manage on Reports).',
          ...(input.starter === true ? ['Offered to the team among the starters.'] : []),
          ...(input.starter === false ? ['No longer offered among the starters.'] : []),
        ],
        confirmLabel: 'Share it',
        pin: { report: r.id, ...(roles.length ? { role_ids: roles.map(x => x.id) } : {}) },
      }
    },
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'reports', 'manage')
      const r = await savedOnly(ctx, input.report)
      const roleIds = input.with === 'roles' ? (input.role_ids || (await rolesFor(ctx, input.roles)).map(x => x.id)) : []
      return audited(ctx, 'share_report', { report: r.name, with: input.with }, async () => {
        const { report } = await callApi(ctx, 'PATCH', '/api/reports/' + encodeURIComponent(r.id) + '/sharing', {
          body: {
            shared: input.with === 'only_owner' ? 'private' : input.with,
            ...(input.with === 'roles' ? { role_ids: roleIds } : {}),
            ...(input.starter !== undefined ? { is_starter: input.starter } : {}),
          },
        })
        return { report: report.name, shared_with: SHARED_WORDS[report.shared] || report.shared, ...(report.is_starter ? { offered_as_starter: true } : {}) }
      })
    },
  },
]
