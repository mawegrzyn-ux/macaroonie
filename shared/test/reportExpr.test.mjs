import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseExpr, evalExpr, exprToSql, exprRefs, exprCalls, exprProblem, ExprError, MAX_EXPR_LENGTH,
} from '../reports/expr.js'

const env = (values, extra = {}) => ({ value: n => values[n], ...extra })
const calc = (text, values = {}, extra = {}) => evalExpr(parseExpr(text), env(values, extra))
const fails = (text, re) => assert.throws(() => parseExpr(text), e => e instanceof ExprError && re.test(e.message), text)

test('arithmetic reads like a calculator', () => {
  assert.equal(calc('1 + 2 * 3'), 7)
  assert.equal(calc('(1 + 2) * 3'), 9)
  assert.equal(calc('10 - 4 - 3'), 3)
  assert.equal(calc('-3 + 5'), 2)
  assert.equal(calc('--3'), 3)
  assert.equal(calc('+4'), 4)
  assert.equal(calc('.5 * 4'), 2)
  assert.equal(calc('8 / 4 / 2'), 1)
  assert.equal(calc('net - cost', { net: 100, cost: 35 }), 65)
  assert.equal(calc('Net_Sales / checks', { net_sales: 250, checks: 4 }), 62.5)
  // Names may hold dots (a field through a link).
  assert.equal(calc('check.covers * 2', { 'check.covers': 4 }), 8)
})

test('empty values and dividing by nothing give an empty cell, never an error', () => {
  assert.equal(calc('a / b', { a: 10, b: 0 }), null)
  assert.equal(calc('a / b', { a: 10 }), null)
  assert.equal(calc('a + 1', { a: null }), null)
  assert.equal(calc('a + 1', { a: 'ten' }), null)
  assert.equal(calc('-a', {}), null)
  assert.equal(calc('round(a)', {}), null)
  assert.equal(calc('abs(a)', {}), null)
  assert.equal(calc('min(a, 1)', {}), null)
  // A comparison with an empty value is false.
  assert.equal(calc('if(a > 0, 1, 2)', {}), 2)
})

test('rounding is half away from zero, as people round money', () => {
  assert.equal(calc('round(2.5)'), 3)
  assert.equal(calc('round(-2.5)'), -3)
  assert.equal(calc('round(1.005, 2)'), 1.01)
  assert.equal(calc('round(1234.5678, 2)'), 1234.57)
  assert.equal(calc('round(0.1 + 0.2, 1)'), 0.3)
  assert.equal(calc('abs(-4)'), 4)
  assert.equal(calc('min(3, 5)'), 3)
  assert.equal(calc('max(3, 5)'), 5)
})

test('conditions', () => {
  assert.equal(calc('if(covers > 0, net / covers, 0)', { covers: 4, net: 100 }), 25)
  assert.equal(calc('if(covers > 0, net / covers, 0)', { covers: 0, net: 100 }), 0)
  assert.equal(calc('if(a >= 10 and b < 5, 1, 0)', { a: 10, b: 4 }), 1)
  assert.equal(calc('if(a >= 10 and b < 5, 1, 0)', { a: 10, b: 5 }), 0)
  assert.equal(calc('if(a = 1 or b = 1, 1, 0)', { a: 0, b: 1 }), 1)
  assert.equal(calc('if(not a = 1, 1, 0)', { a: 2 }), 1)
  assert.equal(calc('if(a != b, 1, 0)', { a: 1, b: 2 }), 1)
  assert.equal(calc('if(a <> b, 1, 0)', { a: 1, b: 1 }), 0)
  assert.equal(calc('if(a <= 1, 1, 0)', { a: 1 }), 1)
  // A number on its own is true when it isn't 0.
  assert.equal(calc('if(a, 1, 0)', { a: 5 }), 1)
  assert.equal(calc('if(a, 1, 0)', { a: 0 }), 0)
  // A comparison on its own comes out as true or false.
  assert.equal(calc('a > 1', { a: 2 }), true)
})

test('the whole, the running total, the rank and the period before come from the report', () => {
  const extra = {
    total: n => ({ net: 400 })[n],
    running: n => ({ net: 150 })[n],
    rank: n => ({ net: 2 })[n],
    change: n => ({ net: 0.25 })[n],
    previous: n => ({ net: 80 })[n],
  }
  assert.equal(calc('net / total(net)', { net: 100 }, extra), 0.25)
  assert.equal(calc('running(net)', { net: 100 }, extra), 150)
  assert.equal(calc('rank(net)', { net: 100 }, extra), 2)
  assert.equal(calc('change(net)', { net: 100 }, extra), 0.25)
  assert.equal(calc('net - previous(net)', { net: 100 }, extra), 20)
  // Without them (a matrix cell has no running total) the cell is empty.
  assert.equal(calc('running(net)', { net: 100 }), null)
  const ast = parseExpr('net / total(net) + rank(checks)')
  assert.deepEqual(exprRefs(ast).sort(), ['checks', 'net'])
  assert.deepEqual(exprCalls(ast).sort(), ['rank', 'total'])
})

test('what can\'t be read says why in a sentence', () => {
  fails('', /empty/)
  fails('   ', /empty/)
  fails('1 +', /stops too soon/)
  fails('(1 + 2', /bracket isn't closed/)
  fails('round(1, 2', /bracket isn't closed after round/)
  fails('1 2', /isn't expected there/)
  fails('a ; drop', /can't be used in a calculation/)
  fails("a + 'x'", /can't be used in a calculation/)
  fails('a..b', /isn't a name/)
  fails('a.', /isn't a name/)
  fails('1234567890123456789012', /too long/)
  fails('a + '.repeat(100) + 'a', /characters at most|too long/)
  fails('x'.repeat(MAX_EXPR_LENGTH + 1), /characters at most/)
  fails(Array(70).fill('a').join(' + '), /too long/)
  assert.throws(() => parseExpr(null), ExprError)
})

test('what a calculation may use depends on where it is', () => {
  const known = n => ['net', 'checks'].includes(n)
  const problem = (text, opts) => exprProblem(parseExpr(text), opts)
  assert.equal(problem('net / checks', { known }), null)
  assert.match(problem('net / covers', { known }), /"covers" isn't one of this report's values/)
  assert.match(problem('gross - tips', { context: 'row', known: n => n === 'gross' }), /"tips" isn't one of this report's number fields/)
  assert.match(problem('sqrt(net)', { known }), /sqrt\(\) can't be used in a calculation/)
  assert.match(problem('total(net)', { context: 'row', known }), /total\(\) can't be used inside a sum/)
  assert.match(problem('round(net, 1, 2)', { known }), /round\(\) takes 1 or 2 values/)
  assert.match(problem('if(net, 1)', { known }), /if\(\) takes 3 values/)
  assert.match(problem('abs()', { known }), /abs\(\) takes 1 value$/)
  assert.match(problem('total(net + 1)', { known }), /takes the name of one of the report's values/)
  assert.match(problem('round(net, 9)', { known }), /whole number of decimal places/)
  assert.match(problem('round(net, checks)', { known }), /whole number of decimal places/)
  assert.equal(problem('round(net, 2)', { known }), null)
})

test('inside a sum a calculation becomes SQL with nothing a person typed in it', () => {
  const ref = n => '"' + n + '"'
  assert.equal(exprToSql(parseExpr('gross - discount'), ref), '(("gross") - ("discount"))')
  assert.equal(exprToSql(parseExpr('gross / qty'), ref), '(("gross") / NULLIF(("qty"), 0))')
  assert.equal(exprToSql(parseExpr('-gross'), ref), '(-("gross"))')
  assert.equal(exprToSql(parseExpr('gross * 1.2'), ref), '(("gross") * (1.2)::numeric)')
  assert.equal(exprToSql(parseExpr('round(gross / 3, 2)'), ref), 'ROUND(((("gross") / NULLIF((3)::numeric, 0)))::numeric, 2)')
  assert.equal(exprToSql(parseExpr('min(gross, 10)'), ref), 'LEAST(("gross"), (10)::numeric)')
  assert.equal(exprToSql(parseExpr('max(gross, 0)'), ref), 'GREATEST(("gross"), (0)::numeric)')
  assert.equal(exprToSql(parseExpr('abs(gross)'), ref), 'ABS(("gross"))')
  assert.equal(
    exprToSql(parseExpr('if(gross > 0 and qty != 2, gross, 0)'), ref),
    '(CASE WHEN COALESCE((COALESCE((("gross") > (0)::numeric), false) AND COALESCE((("qty") <> (2)::numeric), false)), false) THEN ("gross") ELSE (0)::numeric END)',
  )
  assert.equal(exprToSql(parseExpr('if(qty, 1, 0)'), ref), '(CASE WHEN COALESCE(("qty") <> 0, false) THEN (1)::numeric ELSE (0)::numeric END)')
  assert.equal(exprToSql(parseExpr('if(not qty > 1, 1, 0)'), ref), '(CASE WHEN COALESCE((NOT COALESCE((("qty") > (1)::numeric), false)), false) THEN (1)::numeric ELSE (0)::numeric END)')
  assert.throws(() => exprToSql(parseExpr('total(gross)'), ref), /can't be used inside a sum/)
  // Round's places are a clamped whole number whatever the tree holds.
  const tree = parseExpr('round(gross, 2)')
  tree.args[1].v = '2); DROP TABLE x; --'
  assert.equal(exprToSql(tree, ref), 'ROUND((("gross"))::numeric, 0)')
  // Only the caller's own SQL stands in for a name.
  const seen = []
  exprToSql(parseExpr('a + b.c'), n => { seen.push(n); return 'x' })
  assert.deepEqual(seen, ['a', 'b.c'])
})
