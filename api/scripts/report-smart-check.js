#!/usr/bin/env node
// scripts/report-smart-check.js
//
// The smart builder against the live model: each request in
// scripts/report-requests.js goes to Pepper as one person of one group, and
// each answer is checked for what a right one must contain. Run it by hand
// before each release of the smart builder (docs/REPORTS.md 10). Every
// request is a real model call: it costs money and counts towards the
// group's monthly AI allowance (and the person's daily share).
//
//   cd api && set -a; source .env; set +a
//   node scripts/report-smart-check.js --tenant <slug or id> [options]
//
//   --tenant <slug|id>   the group (it needs Pepper switched on and data:
//                        Test data > Generate past till sales gives a test
//                        group a year of sales to report on)
//   --email <address>    run as this person of the group (default: its
//                        first owner); their role decides what Pepper sees
//   --platform           run as a platform admin: every area at Manage,
//                        counted towards the group but no person's share
//   --only 3,7,12        these requests only (numbers as --list shows them)
//   --area <area>        till | online | bookings | kitchen | kiosks | loyalty |
//                        purchasing | safety | other
//   --no-changes         skip the follow-up changes ("only weekends")
//   --out <file.json>    write every answer, with what it missed
//   --list               print the requests (with the group's names filled
//                        in when --tenant is given) and stop; no model calls
//
// Exits 1 when an answer misses something. The checks are deliberately
// loose (a figure, a grouping, a period): read the `look` notes and the
// misses, then open the request on /reports/new to see the whole answer.

import fs from 'node:fs'
import { sql, systemSql, withTenant, reportSql } from '../src/config/db.js'
import { smartBuild } from '../src/reports/smart.js'
import { reportPerson } from '../src/reports/access.js'
import { runReport } from '../src/reports/run.js'
import { CATALOGUE_MODULES } from '../src/reports/catalogue/index.js'
import { pepperOn } from '../src/services/aiJson.js'
import { monthUsage } from '../src/ai/settings.js'
import { normaliseReport, newReport } from '../../shared/reports/spec.js'
import { todayIn } from '../../shared/reports/period.js'
import { REQUESTS, fill, fillsOf, checkAnswer } from './report-requests.js'

const argv = process.argv.slice(2)
const opt = name => {
  const at = argv.indexOf(name)
  return at >= 0 ? argv[at + 1] : undefined
}
const has = name => argv.includes(name)

async function end(code) {
  await Promise.allSettled([sql, systemSql, reportSql].map(pool => pool.end({ timeout: 2 })))
  process.exit(code)
}

const only = opt('--only') ? new Set(opt('--only').split(',').map(n => Number(n.trim())).filter(Boolean)) : null
const area = opt('--area')
const chosen = REQUESTS.map((r, i) => ({ ...r, n: i + 1 }))
  .filter(r => (!only || only.has(r.n)) && (!area || r.area === area))

// ── The group, the person and the group's own names ──

async function findGroup(key) {
  const [t] = await systemSql`
    SELECT id, name, slug FROM tenants
     WHERE slug = ${key} OR id::text = ${key}
     LIMIT 1`
  return t || null
}

async function findPerson(t) {
  if (has('--platform')) {
    const levels = Object.fromEntries([...CATALOGUE_MODULES, 'reports'].map(k => [k, 'manage']))
    return { tenantId: t.id, sub: null, email: null, level: 'manage', levels, roleId: null, canUse: true, canManage: true,
      ctx: { tenantId: t.id, userKey: 'report-smart-check', levels } }
  }
  const email = opt('--email') || null
  const [u] = await withTenant(t.id, tx => tx`
    SELECT auth0_user_id, email FROM users
     WHERE tenant_id = ${t.id} AND is_active AND auth0_user_id IS NOT NULL
       AND (${email}::text IS NULL OR lower(email) = lower(${email}))
     ORDER BY (role::text = 'owner') DESC, created_at
     LIMIT 1`)
  if (!u) return null
  return reportPerson({ tenantId: t.id, user: { sub: u.auth0_user_id, email: u.email }, isPlatformAdmin: false })
}

// The most used value of a field over the last 90 days, else today (a
// report, so it sees only what the person may see), or null.
async function mostUsed(p, subject, field, measure) {
  for (const period of [{ relative: 'last_n_days', n: 90 }, { relative: 'today' }]) {
    const spec = normaliseReport({
      ...newReport(subject),
      params: [{ key: 'period', type: 'period', default: period }, { key: 'venues', type: 'venues', default: 'all' }],
      kind: 'summary', rows: [{ field }], values: [{ key: 'n', measure }],
      sort: [{ by: 'n', dir: 'desc' }], limit: { top: 1 },
    })
    try {
      const res = await runReport(p.ctx, spec, {}, { cap: 5 })
      const v = res.rows.find(r => r.kind === 'row')?.k?.[0]
      if (typeof v === 'string' && v.trim()) return v
    } catch {
      return null
    }
  }
  return null
}

async function groupNames(p, t, venues) {
  const open = venues.filter(v => v.is_active)
  let dish = await mostUsed(p, 'till.lines', 'name', 'qty_sold')
  if (!dish) {
    const [d] = await withTenant(t.id, tx => tx`
      SELECT name FROM menu_items WHERE tenant_id = ${t.id} AND name <> '' ORDER BY name LIMIT 1`)
    dish = d?.name || null
  }
  return {
    venue: open[0]?.name || null,
    venue2: open[1]?.name || null,
    dish,
    server: await mostUsed(p, 'till.checks', 'server.name', 'checks'),
  }
}

// ── Running and checking ──

const short = (s, n = 70) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s))
const secs = ms => (ms / 1000).toFixed(1) + 's'
const totalUnits = u => Object.values(u?.channels || {}).reduce((a, c) => a + (c.units || 0), 0)

async function ask(p, ctx, request, previous = null) {
  const started = Date.now()
  try {
    const out = await smartBuild(p, { request, previous, venues: ctx.venues, today: ctx.today })
    return { out, ms: Date.now() - started }
  } catch (e) {
    return { out: null, ms: Date.now() - started, error: (e.statusCode ? e.statusCode + ' ' : '') + e.message }
  }
}

function report(n, label, request, res, misses) {
  const ok = !res.error && !misses.length
  const rows = res.out?.result?.rows?.filter(r => r.kind === 'row').length
  console.log((ok ? 'PASS' : 'MISS') + ' ' + String(label).padStart(4) + '  ' + short(request, 60).padEnd(60)
    + '  ' + (res.out?.spec?.subject || '-').padEnd(18) + ' ' + secs(res.ms).padStart(6) + (rows != null ? '  ' + rows + ' rows' : ''))
  if (res.error) console.log('        error: ' + res.error)
  for (const m of misses) console.log('        - ' + m)
  return ok
}

async function main() {
  const key = opt('--tenant')
  if (has('--list') && !key) {
    for (const r of chosen) console.log(String(r.n).padStart(3) + '  [' + r.area + '] ' + r.request + (r.then ? '  -> then: ' + r.then.request : ''))
    return end(0)
  }
  if (!key) {
    console.error('Name the group: --tenant <slug or id> (or --list to see the requests).')
    return end(2)
  }
  const t = await findGroup(key)
  if (!t) { console.error('No group ' + key); return end(2) }
  const p = await findPerson(t)
  if (!p) { console.error('No active person' + (opt('--email') ? ' with that email' : '') + ' in ' + t.name + ': pass --email, or --platform.'); return end(2) }
  if (!p.canUse) { console.error('That person can\'t build reports (Reports Use).'); return end(2) }

  const venues = await withTenant(t.id, tx => tx`
    SELECT id, name, timezone, is_active FROM venues
     WHERE tenant_id = ${t.id}
     ORDER BY is_active DESC, name, id`)
  const today = todayIn(venues[0]?.timezone || 'Europe/London')
  const names = await groupNames(p, t, venues)
  const venueIds = Object.fromEntries(venues.map(v => [v.name, v.id]))
  const ctx = { venues: venues.map(v => ({ id: v.id, name: v.name })), today }

  if (has('--list')) {
    for (const r of chosen) {
      const missing = fillsOf(r.request).filter(k => !names[k])
      console.log(String(r.n).padStart(3) + '  [' + r.area + '] ' + fill(r.request, names) + (missing.length ? '  (skipped: no ' + missing.join(', ') + ')' : ''))
    }
    return end(0)
  }

  try {
    await pepperOn(t.id)
  } catch (e) {
    console.error(e.message)
    return end(2)
  }

  console.log('Group ' + t.name + ', as ' + (p.email || 'a platform admin') + ', today ' + today)
  console.log('Names: ' + Object.entries(names).map(([k, v]) => k + ' = ' + (v || '(none)')).join(', '))
  console.log(chosen.length + ' requests' + (has('--no-changes') ? '' : ' (and their changes)') + ': every one is a real model call.\n')

  const before = await monthUsage(t.id)
  const log = []
  let passed = 0, missed = 0, skipped = 0
  const times = []
  for (const r of chosen) {
    const missing = fillsOf(r.request).filter(k => !names[k])
    if (missing.length) {
      skipped++
      console.log('SKIP ' + String(r.n).padStart(4) + '  ' + short(r.request, 60) + '  (the group has no ' + missing.join(', ') + ')')
      continue
    }
    const request = fill(r.request, names)
    const res = await ask(p, ctx, request)
    times.push(res.ms)
    const misses = res.error ? [] : checkAnswer(r.expect, res.out, { names, venueIds })
    if (report(r.n, r.n, request, res, misses)) passed++; else missed++
    if (r.look) console.log('        look: ' + r.look)
    const entry = { n: r.n, request, ms: res.ms, error: res.error || null, misses, answer: slim(res.out) }

    if (r.then && !has('--no-changes') && res.out?.spec) {
      const change = await ask(p, ctx, r.then.request, { spec: res.out.spec, requests: [request], name: res.out.name || '' })
      times.push(change.ms)
      const changeMisses = change.error ? [] : checkAnswer(r.then.expect, change.out, { names, venueIds })
      if (report(r.n, r.n + '+', 'then: ' + r.then.request, change, changeMisses)) passed++; else missed++
      entry.then = { request: r.then.request, ms: change.ms, error: change.error || null, misses: changeMisses, answer: slim(change.out) }
    }
    log.push(entry)
  }

  const after = await monthUsage(t.id)
  const units = totalUnits(after) - totalUnits(before)
  times.sort((a, b) => a - b)
  console.log('\n' + passed + ' passed, ' + missed + ' missed' + (skipped ? ', ' + skipped + ' skipped' : '')
    + '. Time: median ' + secs(times[Math.floor(times.length / 2)] || 0) + ', slowest ' + secs(times[times.length - 1] || 0)
    + '. Allowance used: ' + units.toLocaleString('en-GB') + ' units (about $' + (units * 4 / 1e6).toFixed(2) + ').')

  const out = opt('--out')
  if (out) {
    fs.writeFileSync(out, JSON.stringify({ group: t.name, today, names, passed, missed, skipped, units, requests: log }, null, 2))
    console.log('Answers written to ' + out)
  }
  return end(missed ? 1 : 0)
}

// What is kept of an answer: the definition and the words, not the rows.
const slim = out => out && {
  name: out.name, about: out.about, assumed: out.assumed, couldnt: out.couldnt,
  questions: (out.questions || []).map(q => ({ question: q.question, choices: q.choices.map(c => c.label) })),
  problem: out.problem, spec: out.spec,
  rows: out.result?.rows?.filter(r => r.kind === 'row').length ?? null,
}

main().catch(async e => {
  console.error(e)
  await end(1)
})
