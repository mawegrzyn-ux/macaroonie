// hub/src/statusPage.js
//
// A small page the hub serves on the venue's network (http://<hub>:9180),
// for a mini PC with no screen: open it from any phone or computer on the
// same network. While the hub isn't linked it shows the link code and a QR
// code to scan with the installer app; once linked, the cloud connection,
// the version and updates, each printer and how it is, the printers plugged
// into this computer and the last tickets (kind, printer, printed or not:
// never what was on them, since guests may share the network).
//
//   GET /             the page (refreshes itself every 5 s)
//   GET /status.json  the same as JSON
//
// It only reads: nothing on it changes the hub. The hub's secret is never in it.

import http from 'node:http'
import { qrSvg } from '../../shared/qr.js'

export const STATUS_PORT = 9180

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

function ago(iso) {
  if (!iso) return 'never'
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return s + ' s ago'
  if (s < 3600) return Math.round(s / 60) + ' min ago'
  return Math.round(s / 3600) + ' h ago'
}

function time(iso) {
  return iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''
}

/** A printer's state in words and a colour. */
export function printerWords(p) {
  const s = p.state
  if (p.error) return ['Not answering: ' + p.error, 'bad']
  if (!s) return [p.checked_at ? 'Reachable (it doesn\'t say how it is)' : 'Not checked yet', 'muted']
  if (!s.online) return ['Not answering' + (s.error ? ': ' + s.error : ''), 'bad']
  if (s.paperOut) return ['Out of paper', 'bad']
  if (s.coverOpen) return ['Cover open', 'bad']
  if (s.paperNearEnd) return ['Paper running low', 'warn']
  return ['Ready', 'ok']
}

const UPDATE_WORDS = {
  idle: 'Up to date', waiting: 'Waits for Update now in Till setup', downloading: 'Downloading the update',
  checking: 'Checking the update', restarting: 'Starting the new version', failed: 'The update failed', held_back: 'Held back',
}

/** What /status.json returns: the state, never the link secret. */
export function publicState(state) {
  const { secret, ...rest } = state || {}
  return { ...rest, link: rest.link ? { code: rest.link.code, link_url: rest.link.link_url, expires_at: rest.link.expires_at } : null }
}

export function renderPage(state) {
  const s = publicState(state)
  const row = (label, value, tone = '') => `<tr><th>${esc(label)}</th><td class="${tone}">${value}</td></tr>`
  const parts = []
  parts.push(`<header><h1>Macaroonie hub</h1><p>${esc(s.name || 'Not linked yet')}${s.venue_name ? ' · ' + esc(s.venue_name) : ''}</p></header>`)

  if (s.phase === 'linking' && s.link?.code) {
    parts.push(`<section class="link">
      <h2>Link this hub</h2>
      <p>Scan the code with a phone (the installer app), or in Macaroonie open <b>Till setup → Printers → Link a hub</b> and type:</p>
      <p class="code" data-testid="link-code">${esc(s.link.code)}</p>
      ${s.link.link_url ? `<div class="qr">${qrSvg(s.link.link_url, { title: 'Link code ' + s.link.code })}</div>` : ''}
      <p class="muted">The code works until ${esc(time(s.link.expires_at))}; a new one comes after that.</p>
    </section>`)
  } else if (s.phase === 'unlinked') {
    parts.push('<section><h2>Unlinked</h2><p>This hub was removed or unlinked in Till setup. Run the installer again, or restart it with --forget, to link it with a new code.</p></section>')
  }

  const cloud = s.cloud || {}
  const update = s.update || {}
  const upd = update.available
    ? (update.updates === 'manual' ? 'Version ' + esc(update.available) + ' is out: this copy updates by hand' : esc(UPDATE_WORDS[update.state] || update.state) + ' (' + esc(update.available) + ')')
    : 'Up to date'
  parts.push(`<section><h2>This hub</h2><table>
    ${row('Cloud', cloud.ok === true ? 'Connected (' + ago(cloud.at) + ')' : cloud.ok === false ? 'Can\'t reach it: ' + esc(cloud.error) : 'Starting', cloud.ok === false ? 'bad' : cloud.ok ? 'ok' : 'muted')}
    ${row('Version', esc(s.version) + ' · ' + upd + (update.error ? ' · ' + esc(update.error) : ''), update.state === 'failed' || update.state === 'held_back' ? 'warn' : '')}
    ${row('Computer', esc([s.computer?.hostname, s.computer?.os, s.computer?.arch].filter(Boolean).join(' · ')))}
    ${row('Addresses', esc((s.computer?.addresses || []).join(', ') || 'none'))}
  </table></section>`)

  if (s.phase === 'running') {
    const printers = s.printers || []
    parts.push(`<section><h2>Printers</h2>${printers.length ? `<table>${printers.map(p => {
      const [words, tone] = printerWords(p)
      return row(p.name, esc(p.interface === 'usb' ? 'USB on this hub' : (p.address || 'no address')) + ' · <span class="' + tone + '">' + esc(words) + '</span>')
    }).join('')}</table>` : '<p class="muted">No printers for this hub yet: add them in Till setup → Printers.</p>'}</section>`)
  }

  const local = s.local_printers || []
  parts.push(`<section><h2>Plugged into this computer</h2>${local.length
    ? `<table>${local.map(p => row(p.name, esc(p.path || '') + (p.escpos ? '' : ' · <span class="warn">may not be a receipt printer</span>'))).join('')}</table>`
    : '<p class="muted">No USB printers found. Plug one in and switch it on; it shows here within a minute.</p>'}</section>`)

  const recent = s.recent || []
  if (s.phase === 'running') {
    parts.push(`<section><h2>Last tickets</h2>${recent.length ? `<table>${recent.map(r =>
      row(time(r.at), esc(r.kind === 'receipt' ? 'Receipt' : r.kind === 'bill' ? 'Bill' : 'Kitchen ticket') + ' · ' + esc(r.printer) + ' · ' + (r.ok ? '<span class="ok">Printed</span>' : '<span class="bad">Didn\'t print: ' + esc(r.error) + '</span>'))).join('')}</table>`
      : '<p class="muted">Nothing printed since the hub started.</p>'}</section>`)
  }

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="5">
<title>Macaroonie hub</title>
<style>
  :root { color-scheme: light dark; --bg: #f3f4f6; --card: #fff; --ink: #111827; --muted: #6b7280; --line: #e5e7eb; }
  @media (prefers-color-scheme: dark) { :root { --bg: #111827; --card: #1f2937; --ink: #f9fafb; --muted: #9ca3af; --line: #374151; } }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 16px; background: var(--bg); color: var(--ink); font: 15px/1.45 system-ui, sans-serif; }
  header, section { max-width: 720px; margin: 0 auto 12px; }
  section { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 14px 16px; }
  h1 { font-size: 20px; margin: 0; } h2 { font-size: 15px; margin: 0 0 8px; }
  header p { margin: 2px 0 0; color: var(--muted); }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 6px 0; border-top: 1px solid var(--line); vertical-align: top; overflow-wrap: anywhere; }
  tr:first-child th, tr:first-child td { border-top: 0; }
  th { width: 34%; font-weight: 600; padding-right: 12px; }
  .code { font: 700 40px/1.2 ui-monospace, monospace; letter-spacing: 4px; margin: 8px 0; }
  .qr svg { width: 220px; height: 220px; display: block; }
  .ok { color: #15803d; } .warn { color: #b45309; } .bad { color: #b91c1c; } .muted { color: var(--muted); }
</style></head><body>${parts.join('\n')}</body></html>`
}

/**
 * Serve the page. Resolves to { port, close() }, or null when the port is
 * taken or switched off (port 0): the hub carries on without it.
 */
export function startStatusPage({ port = STATUS_PORT, host = '0.0.0.0', getState, log = () => {} }) {
  if (!port) return Promise.resolve(null)
  const server = http.createServer((req, res) => {
    const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer' }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, headers); return res.end() }
    const url = (req.url || '/').split('?')[0]
    if (url === '/status.json') {
      res.writeHead(200, { ...headers, 'content-type': 'application/json; charset=utf-8' })
      return res.end(JSON.stringify(publicState(getState())))
    }
    if (url === '/') {
      res.writeHead(200, { ...headers, 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:" })
      return res.end(renderPage(getState()))
    }
    res.writeHead(404, { ...headers, 'content-type': 'text/plain' })
    res.end('Not found')
  })
  return new Promise(resolve => {
    server.once('error', e => {
      log(`Status page not started (port ${port}: ${e.code || e.message})`)
      resolve(null)
    })
    server.listen(port, host, () => {
      log(`Status page on port ${server.address().port}: open http://<this computer's address>:${server.address().port} on the venue's network`)
      resolve({ port: server.address().port, close: () => new Promise(r => server.close(() => r())) })
    })
  })
}
