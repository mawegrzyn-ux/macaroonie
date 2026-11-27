// api/eval/run.mjs — runs Pepper's evaluation set (README.md beside it).
//
//   npm run eval                    every task's setup and check, no model
//                                   (a change task must fail, a nothing task
//                                   must pass: the checks aren't empty)
//   npm run eval -- --live          every task through Pepper's chat on the
//                                   real model (AI_MODEL / AI_MODEL_FAST): costs money
//   --only=book_table,sold_out      some tasks (by id, or every task of an area: --only=recipes)
//   --trials=3                      each task this many times (pass^k)
//   --out=eval/results/x.json       where the JSON result goes
//
// Runs against a test database only (it empties it for every trial):
// `eval "$(scripts/test-env.sh eval)"` from the repo root first. With
// --live it needs ANTHROPIC_API_KEY set to a real key; without --live it
// never calls a model, whatever key is set.

import fs from 'node:fs'
import path from 'node:path'

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = /^--([a-z]+)(?:=(.*))?$/.exec(a)
  if (!m) { console.error('Unknown argument: ' + a); process.exit(2) }
  return [m[1], m[2] ?? true]
}))
const live = args.live === true
const known = new Set(['live', 'only', 'trials', 'out'])
for (const k of Object.keys(args)) if (!known.has(k)) { console.error('Unknown option --' + k); process.exit(2) }

if (live) {
  const key = process.env.ANTHROPIC_API_KEY || ''
  if (!key || key === 'sk-ant-test') {
    console.error('--live needs ANTHROPIC_API_KEY set to a real Anthropic key (it is read from the environment only: the test database has no saved key).')
    process.exit(2)
  }
  if (process.env.ANTHROPIC_BASE_URL) console.warn('ANTHROPIC_BASE_URL is set (' + process.env.ANTHROPIC_BASE_URL + '): the calls go there.')
} else {
  // Without --live no model is called: the chat is never reached.
  delete process.env.ANTHROPIC_API_KEY
}

const { loadTasks, runTasks } = await import('./harness.mjs')
const { assertTestDatabase } = await import('../test/support/seed.mjs')
const { closeApp } = await import('../test/support/app.mjs')
const { env } = await import('../src/config/env.js')
assertTestDatabase()

let tasks = await loadTasks()
if (typeof args.only === 'string') {
  const want = new Set(args.only.split(',').map(s => s.trim()).filter(Boolean))
  const unknown = [...want].filter(id => !tasks.some(t => t.id === id || t.area === id))
  if (unknown.length) { console.error('No task or area called ' + unknown.join(', ')); process.exit(2) }
  tasks = tasks.filter(t => want.has(t.id) || want.has(t.area))
}
const trials = Math.max(1, Math.min(10, Number(args.trials) || 1))
const mode = live ? 'live' : 'baseline'
console.log('Pepper evaluation, ' + mode + ': ' + tasks.length + ' tasks x ' + trials + (live ? ', models ' + env.AI_MODEL + ' / ' + (env.AI_MODEL_FAST || '(none)') : ', no model'))

const pad = (s, n) => String(s).padEnd(n)
const run = await runTasks(tasks, {
  trials,
  baseline: !live,
  onResult(r) {
    // Baseline: a change task should fail (nothing was asked), a nothing task pass.
    const good = live ? r.pass : r.pass === (r.expect === 'nothing')
    console.log(pad(good ? (live ? 'PASS' : 'ok') : (live ? 'FAIL' : 'BAD'), 5) + pad(r.id, 26) + pad(r.trial, 3)
      + (live ? pad(r.requests + ' req', 8) + pad((r.input_tokens + r.cache_read_tokens + r.cache_write_tokens) + '/' + r.output_tokens + ' tok', 18) + pad('$' + r.cost_usd.toFixed(4), 10) : '')
      + pad((r.ms / 1000).toFixed(1) + ' s', 8) + (r.reason && (live || !good) ? r.reason : ''))
  },
})

const out = {
  mode, started_at: new Date(Date.now() - run.totals.ms).toISOString(), finished_at: new Date().toISOString(),
  models: live ? { main: env.AI_MODEL, fast: env.AI_MODEL_FAST || null } : null,
  totals: run.totals, results: run.results,
}
const file = typeof args.out === 'string' ? args.out : path.join('eval', 'results', mode + '-' + out.finished_at.replace(/[:.]/g, '-') + '.json')
fs.mkdirSync(path.dirname(file), { recursive: true })
fs.writeFileSync(file, JSON.stringify(out, null, 2))
const t = run.totals
if (live) {
  console.log(`\n${t.passed} of ${t.trials} trials passed (${t.tasks_always_passed} of ${t.tasks} tasks passed every trial); ${t.requests} model requests, $${t.cost_usd.toFixed(4)}, ${(t.ms / 1000).toFixed(0)} s. Written to ${file}`)
} else {
  const bad = run.results.filter(r => r.pass !== (r.expect === 'nothing'))
  console.log(`\nBaseline: ${run.results.length - bad.length} of ${run.results.length} checks behave (a change task fails before anything is done, a nothing task passes). Written to ${file}`)
  if (bad.length) process.exitCode = 1
}
if (live && t.failed) process.exitCode = 1
await closeApp()
process.exit(process.exitCode || 0)
