// src/services/pdfBrowser.js
//
// PDFs made by a headless browser on the server (docs/REPORTS.md 13,
// decision 3): the page it is given is printed exactly as a browser prints
// it, so a report's PDF is its print page. No npm package: the browser's own
// command line (--print-to-pdf).
//
//   pdfAvailable()     whether this server has a browser to make PDFs with
//   needPdf()          refuses (422) when it has none
//   htmlToPdf(html)    a Buffer. Throws 422 when there is no browser, 503
//                      when the machine is busy with another PDF for too
//                      long, or the browser failed or ran out of time
//   forgetPdfBrowser() looks for the browser again at the next call (tests)
//
// One PDF at a time on the machine. A browser takes about 300 MB while it
// works and the API runs as several processes, so the wait is a lock file
// (made with 'wx', stale after two minutes), with a short queue in each
// process in front of it.
//
// The page must fetch nothing: callers make it with printHtml({ pdf: true })
// (a Content-Security-Policy of its own: no scripts, pictures only as data).
// The browser is also started with every host name resolving to nothing, so
// a page that asked for something still couldn't reach it. Scripts are kept
// off by the page's policy, not by a browser switch: with
// --blink-settings=scriptEnabled=false the browser exits without writing a
// PDF.
//
// The browser: PDF_BROWSER_PATH when set, else Google Chrome or Chromium
// where their packages put them. Ubuntu's own `chromium-browser` is a snap,
// which can't write where it is told: scripts/ensure-pdf-browser.sh installs
// Google Chrome's package on the server.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { httpError } from '../middleware/error.js'

const CANDIDATES = [
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/opt/google/chrome/chrome',
  '/usr/bin/chromium',
  '/opt/pw-browsers/chromium',
]
const RECHECK_MS = 60_000
const PDF_MS = 30_000          // how long one PDF may take
const WAIT_MS = 60_000         // how long to wait for the machine's turn
const STALE_MS = 120_000       // a lock this old was left by a process that died
const POLL_MS = 250
const MAX_QUEUED = 4           // waiting in this process, beyond the one at work
const MAX_HTML = 12 * 1024 * 1024
const LOCK = path.join(os.tmpdir(), 'macaroonie-pdf.lock')

const NO_BROWSER = 'This server can\'t make PDFs yet. Print the report, or download it as CSV or Excel'
const BUSY = 'Another PDF is being made. Try again in a moment'
const FAILED = 'The PDF couldn\'t be made. Try again, or print the report'

let found = { path: null, at: 0, known: false }

function runnable(p) {
  try { fs.accessSync(p, fs.constants.X_OK); return fs.statSync(p).isFile() } catch { return false }
}

function browserPath() {
  if (found.known && (found.path || Date.now() - found.at < RECHECK_MS)) return found.path
  const named = (process.env.PDF_BROWSER_PATH || '').trim()
  const hit = named ? (runnable(named) ? named : null) : CANDIDATES.find(runnable) || null
  found = { path: hit, at: Date.now(), known: true }
  return hit
}

export const pdfAvailable = () => !!browserPath()
/** Refuses, in plain words, when this server has no browser to make PDFs with. */
export function needPdf() {
  if (!browserPath()) throw httpError(422, NO_BROWSER)
}
export const forgetPdfBrowser = () => { found = { path: null, at: 0, known: false } }

const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

// The machine's turn: the lock file, made only if it isn't there.
async function takeTurn() {
  const until = Date.now() + WAIT_MS
  for (;;) {
    try {
      const fh = await fsp.open(LOCK, 'wx', 0o600)
      await fh.writeFile(process.pid + ' ' + new Date().toISOString())
      await fh.close()
      return
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
    }
    try {
      const st = await fsp.stat(LOCK)
      if (Date.now() - st.mtimeMs > STALE_MS) { await fsp.rm(LOCK, { force: true }); continue }
    } catch { continue }   // gone in the meantime: try again at once
    if (Date.now() >= until) throw httpError(503, BUSY)
    await pause(POLL_MS)
  }
}

function printWith(bin, dir, page, out) {
  const args = [
    '--headless', '--disable-gpu', '--no-pdf-header-footer', '--print-to-pdf-no-header',
    '--print-to-pdf=' + out,
    '--user-data-dir=' + path.join(dir, 'profile'),
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking',
    '--disable-sync', '--disable-default-apps', '--disable-component-update', '--mute-audio', '--hide-scrollbars',
    '--disable-dev-shm-usage',
    '--host-resolver-rules=MAP * ~NOTFOUND',
    // A browser can't use its own sandbox as root (a container, CI); as the
    // server's own user it can, and does.
    ...(process.getuid?.() === 0 || process.env.PDF_BROWSER_NO_SANDBOX === '1' ? ['--no-sandbox'] : []),
    'file://' + page,
  ]
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { detached: true, stdio: 'ignore' })
    let done = false
    const end = (fn, v) => { if (!done) { done = true; clearTimeout(timer); fn(v) } }
    const timer = setTimeout(() => {
      // The whole group: a browser is several processes.
      try { process.kill(-child.pid, 'SIGKILL') } catch { try { child.kill('SIGKILL') } catch { /* gone */ } }
      end(reject, new Error('The browser took too long'))
    }, PDF_MS)
    child.on('error', e => end(reject, e))
    child.on('exit', code => (code === 0 ? end(resolve) : end(reject, new Error('The browser stopped with code ' + code))))
  })
}

async function make(html) {
  const bin = browserPath()
  if (!bin) throw httpError(422, NO_BROWSER)
  await takeTurn()
  let dir = null
  try {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'macaroonie-pdf-'))
    const page = path.join(dir, 'page.html'), out = path.join(dir, 'out.pdf')
    await fsp.writeFile(page, html, { mode: 0o600 })
    await printWith(bin, dir, page, out)
    const buffer = await fsp.readFile(out)
    if (buffer.length < 5 || buffer.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('The browser made no PDF')
    return buffer
  } catch (e) {
    if (e?.statusCode) throw e
    const err = httpError(503, FAILED)
    err.cause = e
    throw err
  } finally {
    if (dir) await fsp.rm(dir, { recursive: true, force: true }).catch(() => {})
    await fsp.rm(LOCK, { force: true }).catch(() => {})
  }
}

let queue = Promise.resolve()
let waiting = 0

/** A page's HTML as a PDF. One at a time: see the header. */
export function htmlToPdf(html) {
  if (!browserPath()) return Promise.reject(httpError(422, NO_BROWSER))
  if (typeof html !== 'string' || Buffer.byteLength(html) > MAX_HTML) {
    return Promise.reject(httpError(422, 'This report is too big for a PDF. Download it as CSV or Excel'))
  }
  if (waiting > MAX_QUEUED) return Promise.reject(httpError(503, BUSY))
  waiting += 1
  const turn = queue.then(() => make(html))
  queue = turn.catch(() => {}).finally(() => { waiting -= 1 })
  return turn
}
