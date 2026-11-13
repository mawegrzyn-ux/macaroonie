// shared/reports/expr.js
//
// The report builder's small formula language (docs/REPORTS.md 6): a
// calculation is written as text, parsed into a tree here and worked out
// from that tree. The text itself never reaches the database.
//
//   net_sales / total(net_sales)        share of the whole
//   round(net_sales / checks, 2)        average per check
//   if(covers > 0, net_sales / covers, 0)
//
// Names are the keys of the report's other values (after grouping) or of
// number and money fields (before grouping, inside a sum). Arithmetic with
// an empty value gives an empty value, and dividing by nothing gives an
// empty cell, never an error.
//
// Two ways out of a tree: evalExpr() (the engine, after grouping) and
// exprToSql() (inside a sum, before grouping), where every name is turned
// into SQL by the caller from the catalogue and numbers are written as
// numbers; nothing a person typed is passed through.

export const MAX_EXPR_LENGTH = 300
const MAX_NODES = 120

/** What a calculation may call after grouping, with how many arguments. */
export const SUMMARY_FUNCTIONS = {
  round: [1, 2], abs: [1, 1], min: [2, 2], max: [2, 2], if: [3, 3],
  total: [1, 1], running: [1, 1], rank: [1, 1], change: [1, 1], previous: [1, 1],
}
/** What one may call inside a sum, before grouping. */
export const ROW_FUNCTIONS = { round: [1, 2], abs: [1, 1], min: [2, 2], max: [2, 2], if: [3, 3] }
/** Functions that take the name of a value, not a number. */
export const NAME_FUNCTIONS = ['total', 'running', 'rank', 'change', 'previous']

export class ExprError extends Error {
  constructor(message) { super(message); this.name = 'ExprError' }
}

const fail = message => { throw new ExprError(message) }

// ── Reading the text ──────────────────────────────────────────

function tokens(text) {
  const out = []
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i++; continue }
    if (ch >= '0' && ch <= '9' || (ch === '.' && text[i + 1] >= '0' && text[i + 1] <= '9')) {
      let j = i
      while (j < text.length && text[j] >= '0' && text[j] <= '9') j++
      if (text[j] === '.') { j++; while (j < text.length && text[j] >= '0' && text[j] <= '9') j++ }
      const raw = text.slice(i, j)
      if (raw.length > 18) fail('That number is too long')
      out.push({ t: 'num', v: Number(raw) })
      i = j
      continue
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i
      while (j < text.length && /[A-Za-z0-9_.]/.test(text[j])) j++
      let word = text.slice(i, j)
      // A name doesn't end in a dot or hold two in a row.
      if (word.endsWith('.') || word.includes('..')) fail('"' + word + '" isn\'t a name')
      word = word.toLowerCase()
      out.push(word === 'and' || word === 'or' || word === 'not' ? { t: word } : { t: 'name', v: word })
      i = j
      continue
    }
    const two = text.slice(i, i + 2)
    if (two === '<=' || two === '>=' || two === '!=' || two === '<>') { out.push({ t: 'cmp', v: two === '<>' ? '!=' : two }); i += 2; continue }
    if (ch === '<' || ch === '>' || ch === '=') { out.push({ t: 'cmp', v: ch }); i++; continue }
    if ('+-*/(),'.includes(ch)) { out.push({ t: ch }); i++; continue }
    fail('"' + ch + '" can\'t be used in a calculation')
  }
  return out
}

/**
 * The tree for a calculation's text. Throws ExprError with a sentence to
 * show the person when it can't be read.
 */
export function parseExpr(text) {
  if (typeof text !== 'string' || !text.trim()) fail('The calculation is empty')
  if (text.length > MAX_EXPR_LENGTH) fail('A calculation can be ' + MAX_EXPR_LENGTH + ' characters at most')
  const toks = tokens(text)
  let pos = 0
  let nodes = 0
  const peek = () => toks[pos]
  const take = t => (toks[pos]?.t === t ? toks[pos++] : null)
  const node = n => { if (++nodes > MAX_NODES) fail('That calculation is too long'); return n }

  function or() {
    let left = and()
    while (take('or')) left = node({ k: 'logic', op: 'or', a: left, b: and() })
    return left
  }
  function and() {
    let left = not()
    while (take('and')) left = node({ k: 'logic', op: 'and', a: left, b: not() })
    return left
  }
  function not() {
    if (take('not')) return node({ k: 'not', a: not() })
    return cmp()
  }
  function cmp() {
    const left = add()
    const op = take('cmp')
    if (!op) return left
    return node({ k: 'cmp', op: op.v, a: left, b: add() })
  }
  function add() {
    let left = mul()
    for (;;) {
      if (take('+')) left = node({ k: 'bin', op: '+', a: left, b: mul() })
      else if (take('-')) left = node({ k: 'bin', op: '-', a: left, b: mul() })
      else return left
    }
  }
  function mul() {
    let left = unary()
    for (;;) {
      if (take('*')) left = node({ k: 'bin', op: '*', a: left, b: unary() })
      else if (take('/')) left = node({ k: 'bin', op: '/', a: left, b: unary() })
      else return left
    }
  }
  function unary() {
    if (take('-')) return node({ k: 'neg', a: unary() })
    if (take('+')) return unary()
    return primary()
  }
  function primary() {
    const t = peek()
    if (!t) fail('The calculation stops too soon')
    if (t.t === 'num') { pos++; return node({ k: 'num', v: t.v }) }
    if (t.t === '(') {
      pos++
      const inner = or()
      if (!take(')')) fail('A bracket isn\'t closed')
      return inner
    }
    if (t.t === 'name') {
      pos++
      if (!take('(')) return node({ k: 'ref', name: t.v })
      const args = []
      if (!take(')')) {
        do { args.push(or()) } while (take(','))
        if (!take(')')) fail('A bracket isn\'t closed after ' + t.v + '(')
      }
      return node({ k: 'call', fn: t.v, args })
    }
    fail('"' + (t.v ?? t.t) + '" isn\'t expected there')
  }

  const tree = or()
  if (pos < toks.length) fail('"' + (toks[pos].v ?? toks[pos].t) + '" isn\'t expected there')
  return tree
}

function walk(ast, fn) {
  fn(ast)
  if (ast.a) walk(ast.a, fn)
  if (ast.b) walk(ast.b, fn)
  if (ast.args) for (const x of ast.args) walk(x, fn)
}

/** Every name a calculation reads (also inside total(), running() and the rest), each once. */
export function exprRefs(ast) {
  const out = new Set()
  walk(ast, n => { if (n.k === 'ref') out.add(n.name) })
  return [...out]
}

/** The functions a calculation calls, each once. */
export function exprCalls(ast) {
  const out = new Set()
  walk(ast, n => { if (n.k === 'call') out.add(n.fn) })
  return [...out]
}

/**
 * What is wrong with a calculation, as a sentence, or null. `context` is
 * 'summary' (after grouping: names are the report's values) or 'row'
 * (inside a sum: names are number fields); `known(name)` says whether a
 * name can be used.
 */
export function exprProblem(ast, { context = 'summary', known = () => true } = {}) {
  const fns = context === 'row' ? ROW_FUNCTIONS : SUMMARY_FUNCTIONS
  let problem = null
  walk(ast, n => {
    if (problem) return
    if (n.k === 'ref' && !known(n.name)) problem = '"' + n.name + '" isn\'t one of this report\'s ' + (context === 'row' ? 'number fields' : 'values')
    if (n.k === 'call') {
      const arity = fns[n.fn]
      if (!arity) { problem = n.fn + '() can\'t be used ' + (context === 'row' && SUMMARY_FUNCTIONS[n.fn] ? 'inside a sum' : 'in a calculation'); return }
      if (n.args.length < arity[0] || n.args.length > arity[1]) {
        problem = n.fn + '() takes ' + (arity[0] === arity[1] ? arity[0] : arity[0] + ' or ' + arity[1]) + ' value' + (arity[1] === 1 ? '' : 's')
        return
      }
      if (NAME_FUNCTIONS.includes(n.fn) && n.args[0].k !== 'ref') problem = n.fn + '() takes the name of one of the report\'s values'
      if (n.fn === 'round' && n.args[1] && !(n.args[1].k === 'num' && Number.isInteger(n.args[1].v) && n.args[1].v <= 6)) {
        problem = 'round() takes a whole number of decimal places, 6 at most'
      }
    }
  })
  return problem
}

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/**
 * Work a calculation out. `env` gives the numbers:
 *   value(name)     this row's value
 *   total(name)     the report's total of it
 *   running(name)   the running total down the rows to this one
 *   rank(name)      this row's place by it, 1 first
 *   change(name)    its change from the period compared with, as a fraction
 *   previous(name)  its value in the period compared with
 * Returns a number, true / false for a comparison on its own, or null.
 */
export function evalExpr(ast, env) {
  switch (ast.k) {
    case 'num': return ast.v
    case 'ref': return num(env.value(ast.name))
    case 'neg': { const a = num(evalExpr(ast.a, env)); return a == null ? null : -a }
    case 'bin': {
      const a = num(evalExpr(ast.a, env)), b = num(evalExpr(ast.b, env))
      if (a == null || b == null) return null
      if (ast.op === '+') return a + b
      if (ast.op === '-') return a - b
      if (ast.op === '*') return a * b
      return b === 0 ? null : a / b
    }
    case 'cmp': {
      const a = num(evalExpr(ast.a, env)), b = num(evalExpr(ast.b, env))
      if (a == null || b == null) return false
      switch (ast.op) {
        case '<': return a < b
        case '<=': return a <= b
        case '>': return a > b
        case '>=': return a >= b
        case '=': return a === b
        default: return a !== b
      }
    }
    case 'logic': {
      const a = truthy(evalExpr(ast.a, env))
      if (ast.op === 'and') return a && truthy(evalExpr(ast.b, env))
      return a || truthy(evalExpr(ast.b, env))
    }
    case 'not': return !truthy(evalExpr(ast.a, env))
    case 'call': {
      const arg = i => evalExpr(ast.args[i], env)
      switch (ast.fn) {
        case 'round': {
          const a = num(arg(0))
          if (a == null) return null
          const f = 10 ** places(ast.args[1])
          // Half away from zero, as people round money.
          return Math.sign(a) * Math.round(Math.abs(a) * f + 1e-9) / f
        }
        case 'abs': { const a = num(arg(0)); return a == null ? null : Math.abs(a) }
        case 'min': { const a = num(arg(0)), b = num(arg(1)); return a == null || b == null ? null : Math.min(a, b) }
        case 'max': { const a = num(arg(0)), b = num(arg(1)); return a == null || b == null ? null : Math.max(a, b) }
        case 'if': return truthy(arg(0)) ? result(arg(1)) : result(arg(2))
        case 'total': case 'running': case 'rank': case 'change': case 'previous':
          return num(env[ast.fn]?.(ast.args[0].name))
        default: return null
      }
    }
    default: return null
  }
}
// round()'s decimal places: a whole number from 0 to 6, whatever the tree holds.
const places = arg => (arg && arg.k === 'num' ? Math.max(0, Math.min(6, Math.trunc(Number(arg.v) || 0))) : 0)
const truthy = v => v === true || (typeof v === 'number' && v !== 0)
const result = v => (v === true ? 1 : v === false ? 0 : v)

/**
 * A calculation inside a sum as SQL. `ref(name)` gives the SQL for a name
 * (from the catalogue, already in everyday units). Numbers are written out
 * as numbers; the tree holds nothing else a person typed.
 */
export function exprToSql(ast, ref) {
  switch (ast.k) {
    case 'num': return '(' + String(ast.v) + ')::numeric'
    case 'ref': return '(' + ref(ast.name) + ')'
    case 'neg': return '(-' + exprToSql(ast.a, ref) + ')'
    case 'bin': {
      const a = exprToSql(ast.a, ref), b = exprToSql(ast.b, ref)
      if (ast.op === '/') return '(' + a + ' / NULLIF(' + b + ', 0))'
      return '(' + a + ' ' + ast.op + ' ' + b + ')'
    }
    case 'cmp': return '(' + exprToSql(ast.a, ref) + ' ' + (ast.op === '!=' ? '<>' : ast.op) + ' ' + exprToSql(ast.b, ref) + ')'
    case 'logic': return '(' + sqlBool(ast.a, ref) + ' ' + (ast.op === 'and' ? 'AND' : 'OR') + ' ' + sqlBool(ast.b, ref) + ')'
    case 'not': return '(NOT ' + sqlBool(ast.a, ref) + ')'
    case 'call': {
      const a = ast.args.map(x => exprToSql(x, ref))
      switch (ast.fn) {
        case 'round': return 'ROUND((' + a[0] + ')::numeric, ' + places(ast.args[1]) + ')'
        case 'abs': return 'ABS(' + a[0] + ')'
        case 'min': return 'LEAST(' + a[0] + ', ' + a[1] + ')'
        case 'max': return 'GREATEST(' + a[0] + ', ' + a[1] + ')'
        case 'if': return '(CASE WHEN ' + sqlBool(ast.args[0], ref) + ' THEN ' + a[1] + ' ELSE ' + a[2] + ' END)'
        default: throw new ExprError(ast.fn + '() can\'t be used inside a sum')
      }
    }
    default: throw new ExprError('That calculation can\'t be used inside a sum')
  }
}
// A condition: a comparison or and / or / not as it is, a number as "isn't 0".
function sqlBool(ast, ref) {
  if (ast.k === 'cmp' || ast.k === 'logic' || ast.k === 'not') return 'COALESCE(' + exprToSql(ast, ref) + ', false)'
  return 'COALESCE(' + exprToSql(ast, ref) + ' <> 0, false)'
}
