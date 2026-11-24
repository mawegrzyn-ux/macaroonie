// api/eval/harness.mjs — Pepper's evaluation set (Pepper-first step 0c).
//
// Each task is something a person types to Pepper, the data it needs, and a
// check of the database afterwards: graded by the end state, never by what
// Pepper says (Anthropic, "Demystifying evals for AI agents", quoted in
// reports/AI first back office strategy.md). Every trial starts from a clean
// tenant: the test database is emptied and filled again through the API by
// the test support (support/seed.mjs, support/fixtures.mjs), then the task's
// own setup runs.
//
// A task (tasks/<area>.mjs, `export const tasks = [...]`):
//
//   id          unique, lower case words joined by _
//   area        the Pepper tool area it exercises (bookings, safety, ...)
//   why         where it comes from: a real failure, a rule, a common job
//   as          who types it: 'owner' (default), 'admin' or 'operator'
//   setup(ctx)  optional: rows it needs, through the API (ctx.owner) where it
//               can; ctx.made holds what later steps need
//   say(ctx)    the message(s) typed, a string or a list (one turn each)
//   cards       what the person does with each card: 'confirm' (default:
//               a person who asked for it presses Confirm, typing the
//               card's word on a destructive one, step 4b) or 'cancel'
//   expect      'change' (something must be done), 'nothing' (Pepper must
//               ask first, or refuse: the tables in `watch` must not change)
//               or 'answer' (a question answered from Pepper's reading
//               tools: graded by what the tools returned, still never by
//               Pepper's words; Pepper-first step 8A2)
//   watch       for 'nothing': the tables whose rows must stay as they were
//               ('bookings', or 'bookings:id,status,starts_at' for some columns)
//   check(ctx, chat)  for 'change' and 'answer': resolves to true, or to a
//               sentence saying what is wrong (false = "the end state is
//               wrong"). chat: { calls: [{ name, input, result }] }, the
//               trial's tool calls in order with what each returned (the
//               parsed JSON, or { error } when it refused)
//   reference(ctx)  the tool calls a right answer makes, [{ tool, input }]:
//               the stand-in model replays them in the tests, which proves
//               the setup and the check (not the model); [] for 'nothing'
//
// ctx: { tenantId, ids, venue: { id, name }, venue2, day(n), today, owner,
//        client(role), sql, made, run }

import { as, ok, sql } from '../test/support/app.mjs'
import { resetAndSeed, A } from '../test/support/seed.mjs'
import { fillTenant } from '../test/support/fixtures.mjs'

export const MARK = 'Oak'
export const SLUG = 'oak'
const TZ = 'Europe/London'
const PEOPLE = { owner: A.owner, admin: A.admin, operator: A.operator, viewer: A.viewer }
// Days the fixtures' schedule is closed (support/fixtures/bookings.mjs).
const CLOSED = ['12-25', '12-26']

/** A day at the venue (Europe/London) n days from today, as YYYY-MM-DD. */
export function venueDay(n = 0, from = new Date()) {
  const d = new Date(from.getTime() + n * 86400000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}
/** The first day n or more days ahead on which the venue takes bookings. */
export function openDay(n = 1) {
  for (let i = n; i < n + 10; i++) if (!CLOSED.includes(venueDay(i).slice(5))) return venueDay(i)
  return venueDay(n)
}
/** 'Monday 23 November' for a YYYY-MM-DD, as a person would say it. */
export const spoken = ymd => new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
/** A timestamptz as HH:MM at the venue. */
export const localTime = d => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(d))
/** A timestamptz as YYYY-MM-DD at the venue. */
export const localDay = d => venueDay(0, new Date(d))

/**
 * One md5 per watched table over the tenant's rows: what "nothing changed"
 * compares. An entry is a table ('fs_temp_logs': every column) or a table
 * and the columns that matter ('bookings:id,status,starts_at'), for a table
 * that work in the background touches (a booking's emails and reminders).
 */
export async function fingerprint(tenantId, watch) {
  const out = {}
  for (const w of watch) {
    const [t, cols] = w.split(':')
    const list = cols ? cols.split(',').map(c => c.trim()) : []
    if (![t, ...list].every(n => /^[a-z_][a-z0-9_]*$/.test(n))) throw new Error('Not a table and columns: ' + w)
    const row = list.length ? 'row(' + list.map(c => 'x."' + c + '"').join(', ') + ')::text' : 'x::text'
    const [r] = await sql.unsafe(`SELECT md5(coalesce(string_agg(${row}, ',' ORDER BY ${row}), '')) AS h, count(*)::int AS n FROM "${t}" x WHERE tenant_id = $1`, [tenantId])
    out[w] = r.h + ':' + r.n
  }
  return out
}

/** A clean tenant, filled through the API, with Pepper on for staff. */
export async function cleanTenant() {
  const seeded = await resetAndSeed()
  const filled = await fillTenant(A.owner, seeded.a, { mark: MARK, slug: SLUG, loyalty: false, reports: false })
  if (filled.failed.length) throw new Error('Filling the tenant failed: ' + filled.failed.join('; '))
  const tenantId = seeded.a
  const owner = as(A.owner, tenantId)
  await ok(owner.patch('/api/ai/settings', { staff_enabled: true }), 'switch Pepper on')
  const venues = await sql`SELECT id, name FROM venues WHERE tenant_id = ${tenantId} ORDER BY created_at, name`
  return {
    tenantId,
    ids: filled.ids,
    venue: venues.find(v => v.id === filled.ids.venue),
    venue2: venues.find(v => v.id === filled.ids.venue2),
    today: venueDay(0),
    day: openDay,
    owner,
    client: role => as(PEOPLE[role] || role, tenantId),
    sql,
    made: {},
  }
}

const textOf = items => (items || []).filter(i => i.type === 'assistant').map(i => i.text).filter(Boolean).join('\n')

/** The tool calls Pepper made in the chat, in order: [{ name, input, result }]
 *  (the result as stored for the model: its JSON, or { error } when it refused). */
async function toolCalls(tenantId, conversationId) {
  if (!conversationId) return []
  const rows = await sql`SELECT role, content FROM ai_messages WHERE tenant_id = ${tenantId} AND conversation_id = ${conversationId} ORDER BY seq`
  const blocks = role => rows.filter(r => r.role === role).flatMap(r => (Array.isArray(r.content) ? r.content : []))
  const results = new Map(blocks('user').filter(b => b.type === 'tool_result').map(b => [b.tool_use_id, b]))
  const parsed = b => {
    if (!b) return null
    const text = (Array.isArray(b.content) ? b.content : []).filter(c => c.type === 'text').map(c => c.text).join('')
    if (b.is_error) return { error: text }
    try { return JSON.parse(text) } catch { return { text } }
  }
  return blocks('assistant').filter(b => b.type === 'tool_use').map(b => ({ name: b.name, input: b.input, result: parsed(results.get(b.id)) }))
}

/** What the trial's model requests added up to (ai_requests, migration 271), since its first message. */
async function usageOf(tenantId, since) {
  const [u] = await sql`
    SELECT count(*)::int AS requests,
           COALESCE(sum(input_tokens), 0)::int AS input_tokens, COALESCE(sum(output_tokens), 0)::int AS output_tokens,
           COALESCE(sum(cache_read_tokens), 0)::int AS cache_read_tokens, COALESCE(sum(cache_write_tokens), 0)::int AS cache_write_tokens,
           COALESCE(sum(cost_usd), 0)::float8 AS cost_usd, COALESCE(sum(ms), 0)::int AS model_ms,
           COALESCE(array_agg(DISTINCT model) FILTER (WHERE model IS NOT NULL), '{}') AS models
      FROM ai_requests WHERE tenant_id = ${tenantId} AND use = 'chat' AND created_at >= ${since}
  `
  return u
}

/**
 * Runs one trial of a task from a clean tenant. `before(task, ctx)` runs
 * after the setup and before the first message (the tests give the stand-in
 * model its script there). Resolves to the trial's result; never throws for
 * a task that fails, only for a harness that can't run.
 */
export async function runTask(task, { baseline = false, before } = {}) {
  const started = Date.now()
  const ctx = await cleanTenant()
  const result = { id: task.id, area: task.area, expect: task.expect, pass: false, reason: '', reply: '', tools: [], cards: [] }
  let calls = []
  let since = new Date()
  try {
    await task.setup?.(ctx)
    const watched = task.expect === 'nothing' ? await fingerprint(ctx.tenantId, task.watch) : null
    await before?.(task, ctx)
    since = new Date()
    const client = ctx.client(task.as || 'owner')
    let conversationId = null
    if (!baseline) {
      const said = task.say(ctx)
      for (const message of Array.isArray(said) ? said : [said]) {
        const res = await client.post('/api/ai/chat', { message, ...(conversationId ? { conversation_id: conversationId } : {}) })
        if (res.status >= 400) { result.reason = 'the chat refused the message: ' + res.status + ' ' + (res.json?.error || ''); break }
        conversationId = res.json.conversation_id || conversationId
        result.reply = textOf(res.json.items)
        // Each card waiting for an answer, as the person would answer it.
        for (const card of (res.json.items || []).filter(i => i.type === 'action' && i.status === 'pending')) {
          const how = task.cards === 'cancel' ? 'cancel' : 'confirm'
          // A destructive card (a person's details, pay, a deletion) wants its word typed, as the person would.
          const body = how === 'confirm' && card.class === 'destructive' ? { word: card.confirm_word } : {}
          const r = await client.post('/api/ai/actions/' + card.id + '/' + how, body)
          const settled = (r.json?.items || []).find(i => i.type === 'action' && i.id === card.id)
          result.cards.push({ tool: card.tool, title: card.title, class: card.class, pressed: how, status: settled?.status || 'unknown', error: settled?.error || (r.status >= 400 ? r.json?.error : null) || null })
        }
      }
      calls = await toolCalls(ctx.tenantId, conversationId)
      result.tools = calls.map(c => c.name)
    }
    if (!result.reason) {
      if (task.expect === 'nothing') {
        const after = await fingerprint(ctx.tenantId, task.watch)
        const changed = task.watch.filter(t => after[t] !== watched[t])
        result.pass = changed.length === 0
        result.reason = result.pass ? '' : 'changed: ' + changed.join(', ')
      } else {
        const verdict = await task.check(ctx, { calls })
        result.pass = verdict === true
        result.reason = result.pass ? '' : (typeof verdict === 'string' ? verdict : 'the end state is wrong')
      }
    }
  } catch (err) {
    result.pass = false
    result.reason = 'the task broke: ' + (err?.message || String(err))
  }
  Object.assign(result, await usageOf(ctx.tenantId, since), { ms: Date.now() - started })
  return result
}

/** Every trial of every task, one after another; the run's totals. */
export async function runTasks(tasks, { trials = 1, baseline = false, before, onResult } = {}) {
  const results = []
  for (const task of tasks) {
    for (let n = 1; n <= trials; n++) {
      const r = { ...(await runTask(task, { baseline, before })), trial: n }
      results.push(r)
      await onResult?.(r)
    }
  }
  const sum = k => results.reduce((a, r) => a + (Number(r[k]) || 0), 0)
  const byTask = {}
  for (const r of results) (byTask[r.id] ||= []).push(r.pass)
  return {
    results,
    totals: {
      trials: results.length,
      passed: results.filter(r => r.pass).length,
      failed: results.filter(r => !r.pass).length,
      // pass^k: a task counts only when every one of its trials passed.
      tasks_always_passed: Object.values(byTask).filter(p => p.every(Boolean)).length,
      tasks: Object.keys(byTask).length,
      requests: sum('requests'), input_tokens: sum('input_tokens'), output_tokens: sum('output_tokens'),
      cache_read_tokens: sum('cache_read_tokens'), cache_write_tokens: sum('cache_write_tokens'),
      cost_usd: Math.round(sum('cost_usd') * 1e6) / 1e6, model_ms: sum('model_ms'), ms: sum('ms'),
    },
  }
}

/** Every task in tasks/, checked: unique ids, a known expectation, what each needs. */
export async function loadTasks() {
  const files = ['bookings', 'safety', 'people', 'menus', 'group', 'today', 'reports']
  const tasks = []
  for (const f of files) tasks.push(...(await import('./tasks/' + f + '.mjs')).tasks)
  const seen = new Set()
  for (const t of tasks) {
    const fail = msg => { throw new Error('Evaluation task ' + (t.id || '(no id)') + ': ' + msg) }
    if (!/^[a-z][a-z0-9_]*$/.test(t.id || '')) fail('needs an id of lower case words joined by _')
    if (seen.has(t.id)) fail('the id is used twice')
    seen.add(t.id)
    if (!t.area || typeof t.say !== 'function' || typeof t.reference !== 'function') fail('needs an area, say(ctx) and reference(ctx)')
    if (['change', 'answer'].includes(t.expect) && typeof t.check !== 'function') fail('a change or an answer needs check(ctx, chat)')
    if (t.expect === 'nothing' && !(Array.isArray(t.watch) && t.watch.length)) fail('nothing changing needs the tables to watch')
    if (!['change', 'nothing', 'answer'].includes(t.expect)) fail('expect is change, nothing or answer')
    if (t.as && !PEOPLE[t.as]) fail('as is owner, admin, operator or viewer')
  }
  return tasks
}
