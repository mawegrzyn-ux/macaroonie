// src/services/suggestions.js
//
// Suggestions on Home (Pepper-first step 7a, docs/PEPPER_FIRST.md 4.4,
// reports/AI first back office strategy.md "Home: the day comes to the
// person"): after the person's pins, up to MAX_SUGGESTIONS pages (or a
// report) worked out by rules, never by the model, each with a one-line
// reason. Sent with the Today feed (GET /api/ops/today, routes/ops.js), so
// they are for the venue Home shows and the tasks the person sees there.
//
// Every rule is a small function in RULES that reads `facts` (gathered once
// per request by gatherFacts()) and returns candidates. Only data the person
// may see goes in: their own usage record (pages they opened, decision 8:
// nobody else's), their own report runs, the tasks of their own feed (worked
// out as them), the feed's set-up gaps for modules they manage, and the
// team suggestions made for their role (step 7b).
//
// Ranking, stated once: a candidate's rule's place in RULES first (what needs
// doing now beats what was picked for the team, beats a gap in the set-up,
// beats habit), then the rule's own score (higher first), then the label.
// One suggestion per key. Then the filter every rule goes through: never a
// page the person can't open (their own menu, navTreeFor()), never one
// they've pinned, never Home itself, never one they dismissed (for HIDE_DAYS;
// a team suggestion for good). The first MAX_SUGGESTIONS are shown.

import { withTenant } from '../config/db.js'
import { permissionAtLeast } from '../config/modules.js'
import { callApi } from '../ai/context.js'
import { navTreeFor, navLinksOf } from './navTree.js'
import { pageLink } from '../../../shared/nav/links.js'

export const MAX_SUGGESTIONS = 4
export const HIDE_DAYS = 14
// Habit: opened within HOURS_EITHER_SIDE of this hour on at least MIN_DAYS of
// the last WEEKS same weekdays. Often: opened on at least MIN_DAYS of the
// last DAYS days. Weekly report: run in at least MIN_WEEKS of the last WEEKS
// weeks (Monday to Sunday, this one included).
export const HABIT = { weeks: 6, minDays: 3, hoursEitherSide: 1 }
export const OFTEN = { days: 14, minDays: 5 }
export const WEEKLY = { weeks: 4, minWeeks: 3 }
export const NOTE_MAX = 140

// The page a task of an area points at, and the tab some kinds open at.
export const TASK_PAGES = {
  food_safety: '/food-safety', checklists: '/checklists', hs_actions: '/hs-action-log', purchasing: '/purchasing',
  cash: '/cash-recon', wages: '/cash-recon', online_orders: '/orders', sold_out: '/orders',
  report_alerts: '/reports', failed_emails: '/email-monitoring', reviews: '/reviews', screens: '/screens',
  devices: '/pos/board', rota: '/rota',
}
const KIND_TABS = { hold_check: 'holds', cooking_check: 'cooking', wages_to_pay: 'wages' }

const WEEKDAYS = ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays']
const plural = (n, one, many = one + 's') => n + ' ' + (n === 1 ? one : many)
const addDays = (date, n) => { const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
/** 1 Monday .. 7 Sunday. */
const isoDay = date => ((new Date(date + 'T12:00:00Z').getUTCDay() + 6) % 7) + 1
const mondayOf = date => addDays(date, 1 - isoDay(date))

/** The key a page suggestion is dismissed by: its page and tab (whichever rule found it). */
export const pageKey = (path, tab = null) => path + (tab ? '#' + tab : '')

// ── The rules ─────────────────────────────────────────────────
// Each: (facts) -> [{ key, path, tab?, ref?, label?, reason, score }]

/** Due: a page the person's late or skipped tasks point at. */
export function dueRule(f) {
  const pages = new Map()
  const add = (t, field) => {
    const path = TASK_PAGES[t.area]
    if (!path) return
    const tab = KIND_TABS[t.kind] || null
    const k = pageKey(path, tab)
    const p = pages.get(k) || { key: k, path, tab, late: 0, skipped: 0 }
    p[field]++
    pages.set(k, p)
  }
  for (const t of f.tasks || []) if (t.group === 'late') add(t, 'late')
  for (const t of f.aside || []) if (t.state === 'skipped') add(t, 'skipped')
  return [...pages.values()].map(p => ({
    key: p.key, path: p.path, tab: p.tab,
    reason: [p.late && plural(p.late, 'task') + ' late here', p.skipped && plural(p.skipped, 'task') + ' skipped today']
      .filter(Boolean).join(', '),
    score: p.late * 2 + p.skipped,
  }))
}

/** Team: what a manager suggested to the person's role (step 7b), until pinned or dismissed. */
export function teamRule(f) {
  return (f.team || []).map(t => ({
    key: 'team:' + t.id, path: t.path, tab: t.tab || null, venue: t.venue_id || null, team_id: t.id,
    reason: 'Suggested by ' + (t.by_label || 'your manager') + (t.note ? ': ' + t.note : ''),
    score: Date.parse(t.created_at) || 0,
  }))
}

/** Set-up: a gap the feed found (no fridges yet), for someone who can set it up. */
export function setupRule(f) {
  return (f.gaps || []).filter(g => permissionAtLeast(f.levels?.[g.module], 'manage')).map(g => ({
    key: 'setup:' + g.key, path: g.path, tab: g.tab || null, reason: g.reason, score: 1,
  }))
}

/** The same weekdays as `date` before it, `weeks` of them, newest first. */
export function sameWeekdays(date, weeks) {
  return Array.from({ length: weeks }, (_, i) => addDays(date, -7 * (i + 1)))
}

/** Habit: a page opened around this hour on most of the last same weekdays. */
export function habitRule(f) {
  const days = new Set(sameWeekdays(f.now.date, HABIT.weeks))
  const seen = new Map()
  for (const u of f.usage || []) {
    if (!days.has(u.day) || Math.abs(u.hour - f.now.hour) > HABIT.hoursEitherSide) continue
    if (!seen.has(u.path)) seen.set(u.path, new Set())
    seen.get(u.path).add(u.day)
  }
  const weekday = WEEKDAYS[isoDay(f.now.date) - 1]
  return [...seen].filter(([, d]) => d.size >= HABIT.minDays).map(([path, d]) => ({
    key: pageKey(path), path, reason: 'You open this most ' + weekday + ' around now', score: d.size,
  }))
}

/** Often: a page opened on most of the last days (today not counted). */
export function oftenRule(f) {
  const from = addDays(f.now.date, -OFTEN.days)
  const seen = new Map()
  for (const u of f.usage || []) {
    if (u.day < from || u.day >= f.now.date) continue
    if (!seen.has(u.path)) seen.set(u.path, new Set())
    seen.get(u.path).add(u.day)
  }
  return [...seen].filter(([, d]) => d.size >= OFTEN.minDays).map(([path, d]) => ({
    key: pageKey(path), path, reason: 'You open this most days', score: d.size,
  }))
}

/** Weekly report: a report the person runs most weeks (one they can still open). */
export function weeklyReportRule(f) {
  const first = addDays(mondayOf(f.now.date), -7 * (WEEKLY.weeks - 1))
  const weeks = new Map()
  for (const r of f.runs || []) {
    if (r.day < first || r.day > f.now.date) continue
    if (!weeks.has(r.ref)) weeks.set(r.ref, new Set())
    weeks.get(r.ref).add(mondayOf(r.day))
  }
  return [...weeks].filter(([ref, w]) => w.size >= WEEKLY.minWeeks && f.reports?.has(ref)).map(([ref, w]) => ({
    key: 'report:' + ref, path: '/reports', ref, label: f.reports.get(ref),
    reason: 'You run this most weeks', score: w.size,
  }))
}

/** The rules, in the order they rank (a rule's place first, then its score). */
export const RULES = [
  { key: 'due', fn: dueRule },
  { key: 'team', fn: teamRule },
  { key: 'setup', fn: setupRule },
  { key: 'habit', fn: habitRule },
  { key: 'often', fn: oftenRule },
  { key: 'weekly_report', fn: weeklyReportRule },
]

/**
 * Every rule over `facts`, ranked, filtered and cut to MAX_SUGGESTIONS:
 * [{ key, rule, path, link, label, icon, reason, pin }]. `facts.menu`: Map of the
 * person's menu links by route; `pinned`: Set of pinned paths; `hidden`: Set
 * of dismissed keys; `venueId`: the venue Home shows (a page that takes a
 * venue opens at it).
 */
export function suggest(facts, { max = MAX_SUGGESTIONS } = {}) {
  const all = []
  RULES.forEach((r, rank) => {
    for (const c of r.fn(facts)) all.push({ ...c, rule: r.key, rank })
  })
  all.sort((a, b) => a.rank - b.rank || b.score - a.score || String(a.label || a.path).localeCompare(String(b.label || b.path)))
  const out = []
  const keys = new Set()
  const pages = new Set()
  for (const c of all) {
    if (out.length >= max) break
    const page = facts.menu?.get(c.path)
    if (!page || c.path === '/' || c.path.startsWith('/mobile')) continue
    if (!c.ref && facts.pinned?.has(c.path)) continue
    if (facts.hidden?.has(c.key) || keys.has(c.key)) continue
    // A page once, whichever rule found it first (a report is its own).
    const pageId = c.ref ? 'report:' + c.ref : pageKey(c.path, c.tab)
    if (pages.has(pageId)) continue
    keys.add(c.key)
    pages.add(pageId)
    const link = c.ref
      ? '/reports/' + encodeURIComponent(c.ref)
      : pageLink(c.path, { venue: c.venue || facts.venueId, tab: c.tab })
    out.push({
      key: c.key, rule: c.rule, path: c.path, link,
      label: c.label || page.label, icon: c.ref ? 'FileBarChart' : page.icon, reason: c.reason,
      // What a pin of it would hold (PUT /api/pins keeps only what the page takes); a report can't be pinned.
      pin: c.ref ? null : { path: c.path, venue_id: c.venue || facts.venueId || null, tab: c.tab || null },
      ...(c.team_id ? { team_id: c.team_id } : {}),
    })
  }
  return out
}

// ── Gathering the facts (one request) ─────────────────────────

/**
 * What the rules read that doesn't come from the feed, for the person `req`
 * at `venue`: their menu, pins, dismissals, own pages opened, own report
 * runs, and the team suggestions for their role. Run beside the feed.
 * `now`: { date, hour } at the venue.
 */
export async function gatherFacts(req, ctx, venue, now) {
  const tz = venue.timezone || 'UTC'
  const me = req.user.sub
  const since = addDays(now.date, -Math.max(HABIT.weeks * 7, OFTEN.days) - 1)
  const runsFrom = addDays(mondayOf(now.date), -7 * (WEEKLY.weeks - 1))
  const [tree, rows] = await Promise.all([
    navTreeFor(req),
    withTenant(req.tenantId, async tx => ({
      pins: await tx`SELECT path FROM home_pins WHERE tenant_id = ${req.tenantId} AND user_sub = ${me}`,
      hides: await tx`
        SELECT key FROM home_suggestion_hides
         WHERE tenant_id = ${req.tenantId} AND user_sub = ${me} AND (hidden_until IS NULL OR hidden_until > now())`,
      // The person's own pages, by day and hour at the venue (decision 8: only their own).
      usage: await tx`
        SELECT path, ((at AT TIME ZONE ${tz})::date)::text AS day, extract(hour FROM at AT TIME ZONE ${tz})::int AS hour
          FROM usage_events
         WHERE tenant_id = ${req.tenantId} AND user_sub = ${me} AND kind = 'page'
           AND at >= (${since}::date - 1)::timestamp AT TIME ZONE ${tz}
         GROUP BY 1, 2, 3`,
      // The reports the person ran themselves (not schedules), by day.
      runs: await tx`
        SELECT DISTINCT COALESCE(report_id::text, 'starter:' || starter_key) AS ref, ((created_at AT TIME ZONE ${tz})::date)::text AS day
          FROM report_runs
         WHERE tenant_id = ${req.tenantId} AND user_sub = ${me} AND kind IN ('run', 'export')
           AND (report_id IS NOT NULL OR starter_key IS NOT NULL)
           AND created_at >= (${runsFrom}::date - 1)::timestamp AT TIME ZONE ${tz}`,
    })),
  ])
  const team = []
  const menu = new Map(navLinksOf(tree).map(l => [l.route, l]))
  // A report run most weeks: only one the person can still open (the
  // reports route's own list, as them), and only worth asking when one qualifies.
  const facts = { now, venueId: venue.id, menu, team, runs: rows.runs, usage: rows.usage, reports: new Map() }
  if (menu.has('/reports') && weeklyReportRule({ ...facts, reports: { has: () => true, get: () => '' } }).length) {
    const list = await callApi(ctx, 'GET', '/api/reports').catch(() => null)
    for (const r of [...(list?.reports || []), ...(list?.starters || [])]) facts.reports.set(String(r.id), r.name)
  }
  facts.pinned = new Set(rows.pins.map(p => p.path))
  facts.hidden = new Set(rows.hides.map(h => h.key))
  return facts
}

/** The suggestions for a feed: `facts` from gatherFacts(), the feed's tasks, set-aside tasks and gaps, the person's levels. */
export function suggestionsFor(facts, feed, levels) {
  return suggest({ ...facts, tasks: feed.tasks, aside: feed.aside, gaps: feed.gaps || [], levels })
}

/** Dismiss a suggestion for the person: for HIDE_DAYS, a team suggestion for good. */
export async function hideSuggestion(tenantId, userSub, key) {
  const forGood = key.startsWith('team:')
  await withTenant(tenantId, tx => tx`
    INSERT INTO home_suggestion_hides (tenant_id, user_sub, key, hidden_until)
    VALUES (${tenantId}, ${userSub}, ${key}, ${forGood ? null : new Date(Date.now() + HIDE_DAYS * 86400_000)})
    ON CONFLICT (tenant_id, user_sub, key) DO UPDATE SET hidden_until = EXCLUDED.hidden_until, created_at = now()`)
}
