// Look at a view of the mock-ups: node tools/shot.mjs <view> [out dir]
// Serves this folder (index.html wrapped in the document skeleton an
// Artifact gets when published), opens #<view> in Chromium at desk and phone
// width and in dark, saves PNGs and prints console errors and any sideways
// overflow. Missing view files are served as empty scripts, so one view can
// be checked before the others exist.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const view = process.argv[2] || 'strategy'
const out = path.resolve(process.argv[3] || path.join(process.env.TMPDIR || '/tmp', 'pepper-first-shots'))
fs.mkdirSync(out, { recursive: true })
const TYPES = { '.css': 'text/css', '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml' }
const SKELETON = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">' +
  '<style>:root{color-scheme:light;padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}</style></head><body>'
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0])
  if (p === '/' || p === '/index.html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(SKELETON + fs.readFileSync(path.join(root, 'index.html'), 'utf8') + '</body></html>') }
  const file = path.join(root, p)
  if (!file.startsWith(root)) { res.writeHead(403); return res.end() }
  if (!fs.existsSync(file)) { if (p.endsWith('.js')) { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end('') } res.writeHead(404); return res.end() }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }); res.end(fs.readFileSync(file))
})
await new Promise(r => server.listen(0, r))
const base = 'http://localhost:' + server.address().port + '/#' + view
const browser = await chromium.launch()
let bad = 0
for (const [name, width, height, scheme] of [['desk', 1280, 900, 'light'], ['phone', 400, 800, 'light'], ['dark', 1280, 900, 'dark']]) {
  const page = await browser.newPage({ viewport: { width, height }, colorScheme: scheme, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|ERR_|Failed to load resource/.test(m.text())) errors.push(m.text()) })
  await page.goto(base); await page.waitForTimeout(900)
  const info = await page.evaluate(v => ({
    sideways: document.documentElement.scrollWidth - window.innerWidth,
    empty: !document.querySelector('#view-' + v) || document.querySelector('#view-' + v).children.length === 0,
    failed: !!document.querySelector('#view-' + v + ' > p.note'),
  }), view)
  const file = path.join(out, view + '-' + name + '.png')
  await page.screenshot({ path: file, fullPage: true })
  const problems = [...errors, info.sideways > 1 ? 'page scrolls sideways by ' + info.sideways + 'px' : null, info.empty ? 'view is empty' : null, info.failed ? 'view failed to draw' : null].filter(Boolean)
  bad += problems.length
  console.log(name + ' ' + width + 'px ' + scheme + ': ' + (problems.length ? 'PROBLEMS: ' + problems.join(' | ') : 'ok') + '  ' + file)
  await page.close()
}
await browser.close(); server.close()
process.exit(bad ? 1 : 0)
