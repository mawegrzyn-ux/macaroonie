// hub/src/update.js
//
// The hub updates itself from the cloud it is linked to. The cloud serves
// the hub's code as one file (GET /pos-api/hub/release.tgz, its version and
// sha256 in the hub's config). An installed hub (bin/launcher.js running it,
// MACAROONIE_HUB_HOME set) keeps each version in its own folder:
//
//   <home>/releases/<version>/hub/...   <home>/releases/<version>/shared/...
//   <home>/current.json                 { version, dir, previous, bad_versions }
//   <home>/launcher.mjs                 the launcher (copied from the release)
//
// An update downloads the file, checks its sha256, unpacks it with `tar`,
// runs the new version's --self-test, then points current.json at it and
// exits with UPDATED_EXIT so the launcher starts the new one straight away.
// The launcher goes back to the previous version when the new one keeps
// stopping, and writes it into bad_versions so it isn't tried again by
// itself. A hub run from a copy of the code (no home) only reports that an
// update is out.

import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { VERSION } from './version.js'

export const UPDATED_EXIT = 75
const RETRY_MS = 30 * 60_000

const here = path.dirname(fileURLToPath(import.meta.url))

/** This copy's version: release.json beside hub/ in an installed copy, else the source's own. */
export function hubVersion(root = path.join(here, '..', '..')) {
  try {
    const r = JSON.parse(fs.readFileSync(path.join(root, 'release.json'), 'utf8'))
    if (r.version) return String(r.version)
  } catch { /* a copy of the repository */ }
  return VERSION + '-dev'
}

export function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

/** Write a JSON file so a reader never sees half of it. */
export function writeJsonAtomic(file, data, mode = 0o644) {
  const tmp = file + '.' + process.pid + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode })
  fs.renameSync(tmp, file)
}

/** A version as a folder name (1.1.0+ab12cd34 -> 1.1.0_ab12cd34). */
export const versionDir = v => String(v).replace(/[^\w.-]/g, '_')

const sha256 = buf => createHash('sha256').update(buf).digest('hex')

function runProcess(cmd, args, { timeoutMs = 60000, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env: env || process.env, windowsHide: true })
    let out = ''
    let err = ''
    const t = setTimeout(() => { child.kill(); reject(new Error(cmd + ' took too long')) }, timeoutMs)
    child.stdout.on('data', c => { out += c })
    child.stderr.on('data', c => { err += c })
    child.on('error', e => { clearTimeout(t); reject(e) })
    child.on('close', code => {
      clearTimeout(t)
      if (code === 0) resolve(out)
      else reject(new Error((err || out).trim().split('\n').slice(-1)[0] || cmd + ' stopped with ' + code))
    })
  })
}

/**
 * The updater. `home` null = not installed (reports only).
 *   check(release, { auto, requested })  resolves true when it switched (and exited)
 *   state()                               what it is doing, for the cloud and the status page
 */
export function createUpdater({
  home = process.env.MACAROONIE_HUB_HOME || null,
  version = hubVersion(),
  api,
  fetchImpl = fetch,
  log = () => {},
  exit = code => process.exit(code),
  tar = args => runProcess('tar', args),
  selfTest = file => runProcess(process.execPath, [file, '--self-test'], { timeoutMs: 30000 }),
} = {}) {
  const st = { version, updates: home ? 'auto' : 'manual', available: null, state: 'idle', error: null, at: null }
  const failed = new Map() // version -> when it last failed
  let busy = false

  async function install(release) {
    const dirName = versionDir(release.version)
    const rel = path.join('releases', dirName)
    const dest = path.join(home, rel)
    const tmp = dest + '.part'
    const tgz = dest + '.tgz'
    fs.mkdirSync(path.join(home, 'releases'), { recursive: true })

    st.state = 'downloading'
    const res = await fetchImpl(new URL(release.url, api).href)
    if (!res.ok) throw new Error('The cloud answered ' + res.status)
    const buf = Buffer.from(await res.arrayBuffer())
    if (sha256(buf) !== release.sha256) throw new Error('The download doesn\'t match its checksum')
    fs.writeFileSync(tgz, buf)

    fs.rmSync(tmp, { recursive: true, force: true })
    fs.mkdirSync(tmp, { recursive: true })
    try {
      await tar(['-xzf', tgz, '-C', tmp])
      const meta = readJson(path.join(tmp, 'release.json'))
      if (meta?.version !== release.version) throw new Error('The download is version ' + (meta?.version || 'unknown') + ', not ' + release.version)
      st.state = 'checking'
      const out = await selfTest(path.join(tmp, 'hub', 'bin', 'hub.js'))
      if (!/^ok\b/m.test(out)) throw new Error('The new version didn\'t pass its check')
      fs.rmSync(dest, { recursive: true, force: true })
      fs.renameSync(tmp, dest)
    } catch (e) {
      fs.rmSync(tmp, { recursive: true, force: true })
      throw e
    } finally {
      fs.rmSync(tgz, { force: true })
    }

    // The launcher from the new version, used from the next start of the service.
    const launcher = path.join(dest, 'hub', 'bin', 'launcher.js')
    if (fs.existsSync(launcher)) {
      const target = path.join(home, 'launcher.mjs')
      const next = fs.readFileSync(launcher)
      if (!fs.existsSync(target) || !next.equals(fs.readFileSync(target))) {
        fs.writeFileSync(target + '.tmp', next)
        fs.renameSync(target + '.tmp', target)
      }
    }

    const cur = readJson(path.join(home, 'current.json')) || {}
    writeJsonAtomic(path.join(home, 'current.json'), {
      version: release.version,
      dir: rel,
      previous: cur.version && cur.dir ? { version: cur.version, dir: cur.dir } : null,
      bad_versions: (cur.bad_versions || []).filter(v => v !== release.version),
      updated_at: new Date().toISOString(),
    })
    // Keep this version and the one before it.
    const keep = new Set([dirName, cur.dir ? path.basename(cur.dir) : null])
    for (const name of fs.readdirSync(path.join(home, 'releases'))) {
      if (!keep.has(name)) fs.rmSync(path.join(home, 'releases', name), { recursive: true, force: true })
    }
  }

  async function check(release, { auto = true, requested = false } = {}) {
    if (!release?.version || !release.url || !release.sha256) return false
    st.available = release.version !== version ? release.version : null
    if (!st.available || !home || busy) return false
    if (!auto && !requested) { st.state = 'waiting'; return false }
    const cur = readJson(path.join(home, 'current.json')) || {}
    if (!requested && (cur.bad_versions || []).includes(release.version)) {
      st.state = 'held_back'
      st.error = 'Went back from ' + release.version + ' after it kept stopping: press Update now in Till setup to try it again'
      return false
    }
    const lastFail = failed.get(release.version)
    // After a failure: try again in half an hour, or five minutes when asked for.
    if (lastFail && Date.now() - lastFail < (requested ? 5 * 60_000 : RETRY_MS)) return false
    busy = true
    try {
      log('Updating to ' + release.version)
      await install(release)
      st.state = 'restarting'
      st.error = null
      st.at = new Date().toISOString()
      log('Updated to ' + release.version + ': restarting')
      exit(UPDATED_EXIT)
      return true
    } catch (e) {
      failed.set(release.version, Date.now())
      st.state = 'failed'
      st.error = String(e.message || e).slice(0, 200)
      st.at = new Date().toISOString()
      log('Update to ' + release.version + ' failed: ' + st.error)
      return false
    } finally {
      busy = false
    }
  }

  return { check, state: () => ({ ...st }) }
}
