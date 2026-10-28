// The hidden corner (corner.js): five quick taps in the top left corner open
// the device type picker. Two copies of the same rule, so both are checked
// with the same taps: nextTaps() (the app, while a page loads) and
// CORNER_SCRIPT (injected into the web page), run here in a stand-in window.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { CORNER_DP, CORNER_SCRIPT, CORNER_TAPS, CORNER_WINDOW_MS, inCorner, nextTaps } from '../corner.js'

// The page side: a window with a clock we set, a scale and the app bridge.
function page({ scale = 1 } = {}) {
  let now = 0
  const sent = []
  const listeners = []
  const ctx = {
    addEventListener: (type, fn, capture) => listeners.push({ type, fn, capture }),
    visualViewport: { scale },
    ReactNativeWebView: { postMessage: m => sent.push(JSON.parse(m)) },
    JSON,
    Date: { now: () => now },
  }
  ctx.window = ctx
  vm.createContext(ctx)
  const result = vm.runInContext(CORNER_SCRIPT, ctx)
  return {
    result, sent, listeners,
    at: ms => { now = ms },
    tap: (x, y, extra = {}) => listeners
      .filter(l => l.type === 'pointerdown')
      .forEach(l => l.fn({ clientX: x, clientY: y, isPrimary: true, ...extra })),
    again: () => vm.runInContext(CORNER_SCRIPT, ctx),
  }
}

// The app side, driven the same way.
function app() {
  let taps = []
  let opened = 0
  let now = 0
  return {
    get opened() { return opened },
    at: ms => { now = ms },
    tap: (x, y) => {
      const next = nextTaps(taps, now, inCorner(x, y))
      taps = next.taps
      if (next.open) opened++
    },
  }
}

const both = () => {
  const p = page()
  const a = app()
  return {
    p, a,
    at: ms => { p.at(ms); a.at(ms) },
    tap: (x, y) => { p.tap(x, y); a.tap(x, y) },
    opened: () => [p.sent.length, a.opened],
  }
}

test('five quick taps in the corner open the menu, once', () => {
  const t = both()
  for (let i = 0; i < CORNER_TAPS - 1; i++) { t.at(i * 300); t.tap(10, 10) }
  assert.deepEqual(t.opened(), [0, 0], 'four taps do nothing')
  t.at(1200); t.tap(CORNER_DP, CORNER_DP)
  assert.deepEqual(t.opened(), [1, 1])
  assert.deepEqual(t.p.sent[0], { type: 'macaroonie:device-menu' })
  // Counting starts again after it opens.
  for (let i = 0; i < CORNER_TAPS - 1; i++) { t.at(1500 + i * 100); t.tap(5, 5) }
  assert.deepEqual(t.opened(), [1, 1])
})

test('a tap elsewhere or a slow tap starts the count again', () => {
  const t = both()
  for (let i = 0; i < 4; i++) { t.at(i * 100); t.tap(20, 20) }
  t.at(500); t.tap(CORNER_DP + 1, 10)
  t.at(600); t.tap(20, 20)
  assert.deepEqual(t.opened(), [0, 0], 'the tap outside the corner started again')
  for (let i = 0; i < 4; i++) { t.at(700 + i * 100); t.tap(20, 20) }
  assert.deepEqual(t.opened(), [1, 1], 'five in a row after it')

  const s = both()
  for (let i = 0; i < 5; i++) { s.at(i * 1000); s.tap(20, 20) }
  assert.deepEqual(s.opened(), [0, 0], `five taps over ${4000} ms is more than ${CORNER_WINDOW_MS} ms`)
  s.at(4100); s.tap(20, 20)
  s.at(4200); s.tap(20, 20)
  assert.deepEqual(s.opened(), [1, 1], 'the last five fit in the time')
})

test('the page counts in screen dp, whatever its zoom', () => {
  // A kiosk zoomed out to half: a CSS pixel is half a dp, so the corner is twice as many CSS pixels.
  const half = page({ scale: 0.5 })
  for (let i = 0; i < 5; i++) { half.at(i); half.tap(CORNER_DP * 2 - 1, 3) }
  assert.equal(half.sent.length, 1)
  for (let i = 0; i < 5; i++) { half.at(10 + i); half.tap(CORNER_DP * 2 + 1, 3) }
  assert.equal(half.sent.length, 1, 'just outside it')
  // Zoomed in: fewer CSS pixels.
  const big = page({ scale: 2 })
  for (let i = 0; i < 5; i++) { big.at(i); big.tap(CORNER_DP / 2 + 1, 3) }
  assert.equal(big.sent.length, 0)
  for (let i = 0; i < 5; i++) { big.at(10 + i); big.tap(CORNER_DP / 2, 3) }
  assert.equal(big.sent.length, 1)
})

test('the page script: capture phase, other fingers ignored, safe to inject twice', () => {
  const p = page()
  assert.equal(p.result, true, 'react-native-webview wants injected code to end with true')
  assert.deepEqual(p.listeners.map(l => [l.type, l.capture]), [['pointerdown', true]])
  for (let i = 0; i < 5; i++) { p.at(i); p.tap(1, 1, { isPrimary: false }) }
  assert.equal(p.sent.length, 0, 'a second finger is not a tap')
  p.again()
  assert.equal(p.listeners.length, 1, 'a page that loads it again keeps one listener')
  for (let i = 0; i < 5; i++) { p.at(10 + i); p.tap(1, 1) }
  assert.equal(p.sent.length, 1)
})

test('the page script works with no bridge and no visual viewport', () => {
  const ctx = { addEventListener: (t, fn) => { ctx.fn = fn }, JSON, Date }
  ctx.window = ctx
  vm.createContext(ctx)
  vm.runInContext(CORNER_SCRIPT, ctx)
  for (let i = 0; i < 5; i++) ctx.fn({ clientX: 1, clientY: 1, isPrimary: true })
  assert.ok(ctx.fn, 'listening, and the fifth tap without a bridge threw nothing')
})
