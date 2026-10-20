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
//   installScript(kind, api)  the Linux (sh) or Windows (ps1) installer with
//                   the cloud's address filled in
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

/** The installer for a platform, with the cloud's address (the device address hubs use) filled in. */
export function installScript(kind, api, { root = ROOT } = {}) {
  const file = kind === 'ps1' ? 'hub/install/install.ps1' : 'hub/install/install.sh'
  return fs.readFileSync(path.join(root, file), 'utf8').replaceAll('__MACAROONIE_API__', api.replace(/\/+$/, ''))
}
