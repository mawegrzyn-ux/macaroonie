#!/usr/bin/env node
// Where the time went in a Claude Code session, between two moments, from the
// session's own log (docs/claude/estimates.md): every tool call with when it
// started and ended, the model's own time between calls, tokens and an
// estimate of what they cost, and what the commits in the window changed.
//
//   node scripts/session-timings.mjs --log <session.jsonl> --from <ISO> --to <ISO>
//        [--label "48.1 build"] [--commits <from>..<to>] [--json]
//
// The log is ~/.claude/projects/<project>/<session id>.jsonl. Times are UTC.
// Phases come from the tool and, for shell commands, the command itself
// (PHASES below): a guess from the words, good enough to see where time goes.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

const arg = (name, def = null) => {
  const i = process.argv.indexOf('--' + name)
  return i > 0 ? process.argv[i + 1] : def
}
const log = arg('log')
const from = new Date(arg('from')).getTime()
const to = new Date(arg('to')).getTime()
const label = arg('label', '')
const commits = arg('commits')
const asJson = process.argv.includes('--json')
if (!log || !from || !to) {
  console.error('usage: session-timings.mjs --log <jsonl> --from <ISO> --to <ISO> [--label x] [--commits a..b] [--json]')
  process.exit(2)
}

// $ per million tokens: input, output, cache read, cache write (5 minutes).
const PRICES = {
  'claude-opus-5-5': [4, 20, 0.2, 5],
  'claude-fable-5-2': [8, 40, 0.2, 10],
  'claude-sonnet-5-5': [2, 10, 0.1, 2.5],
  'claude-haiku-5-5': [0.1, 0.5, 0.01, 0.125],
}

// A tool call's phase. Shell commands by their words, first match wins.
const PHASES = [
  ['wait for CI or a deploy', /until .*gh api|check-runs|actions\/runs|get_check_runs/],
  ['wait for a background run', /^\s*until |tasks\/[a-z0-9]+\.output/],
  ['run tests', /node[^|]*--test|npm test|--test-reporter/],
  ['build (vite)', /vite build/],
  ['test database setup', /test-env\.sh|migrate\.js|pg_ctlcluster|redis-server/],
  ['git and push', /^\s*(cd [^&]+&& )?git (add|commit|push|merge|fetch|stash|checkout|log|status|diff|rev-parse)/],
  ['edit by script', /python3 - <<|sed -i|cat > |cat >> |tee /],
  ['check (syntax, areas, characters)', /node --check|check-areas|grep -nP|bad=\{/],
  ['find and read code', /\b(grep|sed -n|cat|head|tail|ls|find|wc|awk)\b/],
]
const TOOL_PHASE = {
  Read: 'find and read code', Grep: 'find and read code', Glob: 'find and read code',
  Edit: 'edit (Edit / Write)', Write: 'edit (Edit / Write)',
  Agent: 'agents', SendMessage: 'agents',
  ToolSearch: 'tool loading', TaskCreate: 'tracking', TaskUpdate: 'tracking',
}
function phaseOf(name, input) {
  if (name === 'Bash') {
    const cmd = String(input?.command || '')
    for (const [p, re] of PHASES) if (re.test(cmd)) return p
    return 'other shell'
  }
  if (name.startsWith('mcp__github__')) return /check_runs/.test(JSON.stringify(input || {})) ? 'wait for CI or a deploy' : 'pull request (GitHub)'
  if (name.startsWith('mcp__')) return 'other tools'
  return TOOL_PHASE[name] || 'other tools'
}

const calls = new Map()   // tool_use id -> { name, phase, what, start, end }
const turns = []          // assistant messages: { at, model, usage, effort, text }
let lastResultAt = null
const gaps = []           // model time: from a tool result (or user message) to the next assistant message

for (const line of fs.readFileSync(log, 'utf8').split('\n')) {
  if (!line) continue
  let r
  try { r = JSON.parse(line) } catch { continue }
  if (r.isSidechain) continue
  const at = r.timestamp ? new Date(r.timestamp).getTime() : null
  if (!at || at < from - 3600e3 || at > to + 3600e3) continue
  const content = r.message?.content
  if (r.type === 'assistant' && r.message) {
    if (at >= from && at <= to) {
      turns.push({ at, model: r.message.model, usage: r.message.usage || {}, effort: r.perTurnEffort || r.effort || null })
      if (lastResultAt && at - lastResultAt < 30 * 60e3) gaps.push({ at, ms: at - lastResultAt })
    }
    lastResultAt = null
    for (const c of Array.isArray(content) ? content : []) {
      if (c.type === 'tool_use') {
        const what = c.input?.description || c.input?.command?.slice(0, 80) || c.input?.file_path || c.input?.pattern || c.name
        calls.set(c.id, { name: c.name, phase: phaseOf(c.name, c.input), what, start: at, end: null })
      }
    }
  } else if (r.type === 'user') {
    for (const c of Array.isArray(content) ? content : []) {
      if (c.type === 'tool_result' && calls.has(c.tool_use_id)) calls.get(c.tool_use_id).end = at
    }
    lastResultAt = at
  }
}

const inWindow = [...calls.values()].filter(c => c.start >= from && c.start <= to)
const byPhase = {}
for (const c of inWindow) {
  const ms = Math.max(0, (c.end ?? c.start) - c.start)
  const p = (byPhase[c.phase] ||= { calls: 0, ms: 0 })
  p.calls++
  p.ms += ms
}
const toolMs = Object.values(byPhase).reduce((s, p) => s + p.ms, 0)
const modelMs = gaps.reduce((s, g) => s + g.ms, 0)
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }
const models = new Set(), efforts = new Set()
for (const t of turns) {
  const u = t.usage
  const add = { input: u.input_tokens || 0, output: u.output_tokens || 0, cacheRead: u.cache_read_input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0 }
  for (const k of Object.keys(add)) usage[k] += add[k]
  const p = PRICES[t.model]
  if (p) usage.cost += (add.input * p[0] + add.output * p[1] + add.cacheRead * p[2] + add.cacheWrite * p[3]) / 1e6
  if (t.model) models.add(t.model)
  if (t.effort) efforts.add(t.effort)
}

// What the commits changed, by kind of file.
let changed = null
if (commits) {
  const KINDS = [
    ['migration', /^migrations\//], ['test', /(^|\/)test\/|\.test\.m?js$/],
    ['docs and notes', /^docs\/|^changes\/|\/pages\/(help|docs)\/|^CHANGE\.md|^CLAUDE\.md|README/],
    ['code', /./],
  ]
  changed = {}
  const out = execFileSync('git', ['diff', '--numstat', commits], { encoding: 'utf8' })
  for (const l of out.split('\n').filter(Boolean)) {
    const [add, del, file] = l.split('\t')
    const kind = KINDS.find(([, re]) => re.test(file))[0]
    const k = (changed[kind] ||= { files: 0, added: 0, removed: 0 })
    k.files++
    k.added += Number(add) || 0
    k.removed += Number(del) || 0
  }
}

const slowest = inWindow
  .map(c => ({ what: c.what, phase: c.phase, s: Math.round(((c.end ?? c.start) - c.start) / 1000) }))
  .sort((a, b) => b.s - a.s).slice(0, 6)
const result = {
  label, from: new Date(from).toISOString(), to: new Date(to).toISOString(),
  minutes: +((to - from) / 60e3).toFixed(1),
  tool_calls: inWindow.length, assistant_messages: turns.length,
  tool_minutes: +(toolMs / 60e3).toFixed(1), model_minutes: +(modelMs / 60e3).toFixed(1),
  phases: Object.fromEntries(Object.entries(byPhase).sort((a, b) => b[1].ms - a[1].ms)
    .map(([k, v]) => [k, { calls: v.calls, minutes: +(v.ms / 60e3).toFixed(1) }])),
  slowest_calls: slowest,
  tokens: { input: usage.input, output: usage.output, cache_read: usage.cacheRead, cache_write: usage.cacheWrite },
  cost_usd_estimate: +usage.cost.toFixed(2),
  models: [...models], efforts: [...efforts],
  changed,
}
if (asJson) { console.log(JSON.stringify(result, null, 2)); process.exit(0) }
console.log(`${label || 'Window'}: ${result.minutes} min, ${result.tool_calls} tool calls, ${result.assistant_messages} model messages`)
console.log(`  in tools ${result.tool_minutes} min, the model's own time ${result.model_minutes} min`)
for (const [k, v] of Object.entries(result.phases)) console.log(`  ${k.padEnd(36)} ${String(v.calls).padStart(3)} calls  ${v.minutes} min`)
console.log('  slowest:', slowest.map(s => `${s.what} (${s.s}s)`).join('; '))
console.log(`  tokens: ${usage.output} out, ${usage.input + usage.cacheWrite} new in, ${usage.cacheRead} cached; about $${result.cost_usd_estimate}; ${[...models].join(', ')} ${[...efforts].join(', ')}`)
if (changed) for (const [k, v] of Object.entries(changed)) console.log(`  changed ${k}: ${v.files} files, +${v.added} -${v.removed}`)
