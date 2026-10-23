// src/services/hubRelease.js
//
// The venue hub's code as one file, for the installer and the hub's own
// updates (hub/src/update.js). Built once per API process from the files on
// disk: everything hub/bin/*.js loads (followed through its imports, so the
// shared ticket code comes along), hub/package.json, hub/README.md and
// shared/package.json, plus a release.json naming the version. The tar.gz is
// made the same way by every process (sorted names, fixed times), so its
// sha256 is the same whichever process answers.
//
//   hubRelease()    { version, sha256, size, buffer, files }
//   installScript(kind, api)  the Linux (sh) or Windows (ps1) installer, or
//                   the Windows setup file people download (cmd), with the
//                   cloud's address filled in
//   hubSetupPage({ api, windowsFirst })  pos.<domain>/hub: the page a mini PC
//                   opens to download the setup file
//
// Version: hub/src/version.js's VERSION + '+' + the first 8 of a hash of the
// files, so any change to the hub's code (or the shared code it uses) is a
// new version the hubs install.

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const ENTRIES = ['hub/bin/hub.js', 'hub/bin/launcher.js', 'hub/bin/test-print.js']
const EXTRA = ['hub/package.json', 'hub/README.md', 'shared/package.json']
const MTIME = 1735689600 // 1 Jan 2025: every file gets the same time

const sha256 = buf => createHash('sha256').update(buf).digest('hex')

/** Every file `entries` load, following relative imports (static and import()). */
export function importClosure(entries, root = ROOT) {
  const seen = new Set()
  const todo = [...entries]
  while (todo.length) {
    const rel = todo.pop()
    if (seen.has(rel)) continue
    const abs = path.join(root, rel)
    if (!fs.existsSync(abs)) throw new Error('The hub needs ' + rel + ', which is missing')
    seen.add(rel)
    const src = fs.readFileSync(abs, 'utf8')
    const re = /(?:import|export)\s[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]|import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)|^\s*import\s+['"](\.{1,2}\/[^'"]+)['"]/gm
    let m
    while ((m = re.exec(src))) {
      const spec = m[1] || m[2] || m[3]
      const next = path.relative(root, path.resolve(path.dirname(abs), spec)).split(path.sep).join('/')
      if (next.startsWith('..')) throw new Error(rel + ' imports ' + spec + ', outside the repository')
      todo.push(next)
    }
  }
  return [...seen]
}

// ── tar (ustar) ──────────────────────────────────────────────────────

function header(name, size, type, mode) {
  const h = Buffer.alloc(512)
  const put = (s, off, len) => h.write(String(s), off, Math.min(len, Buffer.byteLength(String(s))), 'utf8')
  const oct = (n, len) => n.toString(8).padStart(len - 1, '0') + '\0'
  let prefix = ''
  let base = name
  if (Buffer.byteLength(name) > 100) {
    const cut = name.lastIndexOf('/', 154)
    prefix = name.slice(0, cut)
    base = name.slice(cut + 1)
    if (Buffer.byteLength(base) > 100 || Buffer.byteLength(prefix) > 155) throw new Error('Path too long for tar: ' + name)
  }
  put(base, 0, 100)
  put(oct(mode, 8), 100, 8)
  put(oct(0, 8), 108, 8)
  put(oct(0, 8), 116, 8)
  put(oct(size, 12), 124, 12)
  put(oct(MTIME, 12), 136, 12)
  h.fill(0x20, 148, 156)          // checksum counted as spaces
  put(type, 156, 1)
  put('ustar\0', 257, 6)
  put('00', 263, 2)
  put('root', 265, 32)
  put('root', 297, 32)
  put(prefix, 345, 155)
  let sum = 0
  for (const b of h) sum += b
  put(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8)
  return h
}

/** A tar of [{ name, data }] (directories made for every folder). */
export function makeTar(files) {
  const out = []
  const dirs = new Set()
  for (const f of files) {
    const parts = f.name.split('/')
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/') + '/')
  }
  for (const d of [...dirs].sort()) out.push(header(d, 0, '5', 0o755))
  for (const f of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    out.push(header(f.name, f.data.length, '0', f.mode || 0o644))
    out.push(f.data)
    const pad = (512 - (f.data.length % 512)) % 512
    if (pad) out.push(Buffer.alloc(pad))
  }
  out.push(Buffer.alloc(1024))
  return Buffer.concat(out)
}

let cached = null

/** The release (built once per process). */
export function hubRelease({ root = ROOT, fresh = false } = {}) {
  if (cached && !fresh && root === ROOT) return cached
  const names = [...new Set([...importClosure(ENTRIES, root), ...EXTRA])].sort()
  const files = names.map(name => ({
    name,
    data: fs.readFileSync(path.join(root, name)),
    mode: name.startsWith('hub/bin/') ? 0o755 : 0o644,
  }))
  const hash = createHash('sha256')
  for (const f of files) hash.update(f.name + '\0').update(f.data).update('\0')
  const base = (/VERSION\s*=\s*'([^']+)'/.exec(fs.readFileSync(path.join(root, 'hub/src/version.js'), 'utf8')) || [])[1] || '0.0.0'
  const version = base + '+' + hash.digest('hex').slice(0, 8)
  files.push({ name: 'release.json', data: Buffer.from(JSON.stringify({ version, files: names.length }, null, 2) + '\n') })
  const buffer = zlib.gzipSync(makeTar(files), { level: 9 })
  const release = { version, sha256: sha256(buffer), size: buffer.length, buffer, files: files.map(f => f.name).sort() }
  if (root === ROOT) cached = release
  return release
}

const INSTALL_FILES = { sh: 'hub/install/install.sh', ps1: 'hub/install/install.ps1', cmd: 'hub/install/setup.cmd' }

/** The installer for a platform, with the cloud's address (the device address
 *  hubs use) filled in. The .cmd gets Windows line endings: cmd.exe misreads
 *  some lines of a file without them. */
export function installScript(kind, api, { root = ROOT } = {}) {
  const text = fs.readFileSync(path.join(root, INSTALL_FILES[kind] || INSTALL_FILES.sh), 'utf8')
    .replaceAll('__MACAROONIE_API__', api.replace(/\/+$/, ''))
  return kind === 'cmd' ? text.replace(/\r?\n/g, '\r\n') : text
}

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

/** pos.<domain>/hub: what a mini PC opens to set up the hub. The download for
 *  its own system comes first. No scripts; the API address is ours. */
export function hubSetupPage({ api, windowsFirst }) {
  const a = escapeHtml(api.replace(/\/+$/, ''))
  const win = `
  <section class="card${windowsFirst ? ' first' : ''}" id="windows">
    <h2>Windows 10 or 11</h2>
    <a class="btn" href="/pos-api/hub/setup.cmd" download="macaroonie-hub-setup.cmd">Download the installer</a>
    <ol>
      <li>Open <b>macaroonie-hub-setup.cmd</b> from your downloads. If the browser asks, choose <b>Keep</b>.</li>
      <li>If Windows says <i>Windows protected your PC</i>, press <b>More info</b>, then <b>Run anyway</b>.</li>
      <li>Answer <b>Yes</b> when Windows asks to allow changes.</li>
      <li>When it has finished, the hub's page opens with a six-letter code.</li>
    </ol>
  </section>`
  const linux = `
  <section class="card${windowsFirst ? '' : ' first'}" id="linux">
    <h2>Linux (Ubuntu or Debian)</h2>
    <a class="btn" href="/pos-api/hub/setup.sh" download="macaroonie-hub-setup.sh">Download the installer</a>
    <ol>
      <li>Open a terminal and run <code>sh ~/Downloads/macaroonie-hub-setup.sh</code></li>
      <li>Type this computer's password when it asks.</li>
      <li>When it has finished, it shows a six-letter code.</li>
    </ol>
    <p class="muted">Or without downloading: <code>curl -fsSL ${a}/pos-api/hub/install.sh | sudo sh</code></p>
  </section>`
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Set up the Macaroonie hub</title>
<style>
  body { margin: 0; background: #eceef1; color: #1a1a1a; font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 640px; margin: 0 auto; padding: 32px 16px 48px; }
  h1 { font-size: 26px; line-height: 1.25; margin: 0 0 8px; }
  h2 { font-size: 19px; margin: 0 0 12px; }
  p { margin: 0 0 10px; }
  .lead { color: #4b5563; margin-bottom: 20px; }
  .card { background: #fff; border: 1px solid #d1d5db; border-radius: 14px; padding: 20px; margin-bottom: 16px; }
  .first { border: 2px solid #630812; }
  .btn { display: inline-flex; align-items: center; min-height: 48px; padding: 0 22px; margin-bottom: 14px; border-radius: 10px; background: #630812; color: #fff; font-weight: 600; text-decoration: none; touch-action: manipulation; }
  .btn:focus-visible { outline: 3px solid #f4a7b9; outline-offset: 2px; }
  ol { margin: 0; padding-left: 22px; }
  li { margin-bottom: 6px; }
  code { background: #f3f4f6; border-radius: 6px; padding: 2px 6px; font-size: 14px; word-break: break-all; }
  .muted { color: #6b7280; font-size: 14px; margin: 12px 0 0; }
</style></head>
<body><main>
  <h1>Set up the Macaroonie hub</h1>
  <p class="lead">Do this on the mini PC that stays at the venue, with the internet on. The installer puts the hub on this computer and starts it with the computer from then on.</p>
  ${windowsFirst ? win + linux : linux + win}
  <section class="card" id="link">
    <h2>Then link it</h2>
    <p>Type the six-letter code in Store tech &rarr; Printers &rarr; <b>Link a hub</b>, or scan the QR code on the hub's page with the installer app.</p>
    <p class="muted">The hub's page is <code>http://localhost:9180</code> on this computer. Running the installer again updates the hub and keeps its link.</p>
  </section>
</main></body></html>
`
}
