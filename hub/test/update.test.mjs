// The hub updating itself (src/update.js) and the launcher keeping it
// running (bin/launcher.js), against a stand-in cloud serving the hub's real
// release (api/src/services/hubRelease.js, built from this repository):
// download, checksum, unpack, self test, switch, keep the version before;
// refusals (wrong checksum, wrong version inside, updates off, held back);
// a copy run from the repository only reports. The launcher starts the
// version in current.json, starts it again after an update, and goes back
// to the version before when the new one keeps stopping. Run: cd hub && npm test

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import zlib from 'node:zlib'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createUpdater, hubVersion, UPDATED_EXIT, versionDir } from '../src/update.js'
import { hubRelease, makeTar } from '../../api/src/services/hubRelease.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const sha = buf => createHash('sha256').update(buf).digest('hex')

function serve(files) {
  const hits = []
  const server = http.createServer((req, res) => {
    hits.push(req.url)
    const body = files[req.url]
    if (!body) { res.writeHead(404); return res.end() }
    res.writeHead(200, { 'content-type': 'application/gzip' })
    res.end(body)
  })
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ server, hits, api: 'http://127.0.0.1:' + server.address().port })))
}

function newHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-home-'))
  for (const v of ['0.9.0', '0.8.0']) {
    fs.mkdirSync(path.join(home, 'releases', v, 'hub', 'bin'), { recursive: true })
    fs.writeFileSync(path.join(home, 'releases', v, 'hub', 'bin', 'hub.js'), '')
  }
  fs.writeFileSync(path.join(home, 'current.json'), JSON.stringify({ version: '0.9.0', dir: 'releases/0.9.0', previous: { version: '0.8.0', dir: 'releases/0.8.0' }, bad_versions: [] }))
  return home
}

test('a copy run from the repository reports its source version', () => {
  assert.match(hubVersion(), /-dev$/)
})

test('updates: downloaded, checked, unpacked, tested, switched; the version before kept', async () => {
  const rel = hubRelease()
  const wrongInside = zlib.gzipSync(makeTar([{ name: 'release.json', data: Buffer.from('{"version":"0.0.1"}') }]))
  const cloud = await serve({ '/pos-api/hub/release.tgz': rel.buffer, '/other.tgz': wrongInside })
  const release = { version: rel.version, sha256: rel.sha256, size: rel.size, url: '/pos-api/hub/release.tgz' }
  const home = newHome()
  const exits = []
  const lines = []
  const updater = createUpdater({ home, version: '0.9.0', api: cloud.api, exit: c => exits.push(c), log: l => lines.push(l) })

  // Updates off: it waits for Update now.
  assert.equal(await updater.check(release, { auto: false }), false)
  assert.equal(updater.state().state, 'waiting')
  assert.equal(updater.state().available, rel.version)
  assert.equal(cloud.hits.length, 0)

  // A wrong checksum: refused, nothing switched, not tried again for half an hour.
  assert.equal(await updater.check({ ...release, sha256: 'f'.repeat(64) }, { auto: true }), false)
  assert.equal(updater.state().state, 'failed')
  assert.match(updater.state().error, /checksum/)
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, 'current.json'))).version, '0.9.0')
  assert.equal(await updater.check({ ...release, sha256: 'f'.repeat(64) }, { auto: true }), false)
  assert.equal(cloud.hits.length, 1, 'not downloaded again straight away')

  // The right checksum but another version inside: refused, the half-made folder removed.
  const other = createUpdater({ home, version: '0.9.0', api: cloud.api, exit: c => exits.push(c) })
  assert.equal(await other.check({ version: '7.7.7', sha256: sha(wrongInside), url: '/other.tgz' }, { auto: true }), false)
  assert.match(other.state().error, /version 0\.0\.1, not 7\.7\.7/)
  assert.deepEqual(fs.readdirSync(path.join(home, 'releases')).sort(), ['0.8.0', '0.9.0'])

  // The real thing.
  const fresh = createUpdater({ home, version: '0.9.0', api: cloud.api, exit: c => exits.push(c), log: l => lines.push(l) })
  assert.equal(await fresh.check(release, { auto: true }), true)
  assert.deepEqual(exits, [UPDATED_EXIT], 'it exits for the launcher to start the new one')
  const cur = JSON.parse(fs.readFileSync(path.join(home, 'current.json')))
  assert.equal(cur.version, rel.version)
  assert.equal(cur.dir, path.join('releases', versionDir(rel.version)))
  assert.deepEqual(cur.previous, { version: '0.9.0', dir: 'releases/0.9.0' })
  assert.deepEqual(fs.readdirSync(path.join(home, 'releases')).sort(), ['0.9.0', versionDir(rel.version)].sort(), 'only this version and the one before kept')
  assert.ok(fs.existsSync(path.join(home, cur.dir, 'hub', 'bin', 'hub.js')))
  assert.equal(fs.readFileSync(path.join(home, 'launcher.mjs'), 'utf8'), fs.readFileSync(path.join(here, '..', 'bin', 'launcher.js'), 'utf8'))
  assert.equal(hubVersion(path.join(home, cur.dir)), rel.version, 'the new copy knows its version')
  assert.ok(lines.some(l => l.startsWith('Updated to ' + rel.version)))
  fs.rmSync(home, { recursive: true, force: true })
  cloud.server.close()
})

test('held back after going back from a version, unless asked; a copy run from the repository only reports', async () => {
  const rel = hubRelease()
  const cloud = await serve({ '/pos-api/hub/release.tgz': rel.buffer })
  const release = { version: rel.version, sha256: rel.sha256, size: rel.size, url: '/pos-api/hub/release.tgz' }
  const home = newHome()
  const cur = JSON.parse(fs.readFileSync(path.join(home, 'current.json')))
  fs.writeFileSync(path.join(home, 'current.json'), JSON.stringify({ ...cur, bad_versions: [rel.version] }))
  const exits = []
  const updater = createUpdater({ home, version: '0.9.0', api: cloud.api, exit: c => exits.push(c) })
  assert.equal(await updater.check(release, { auto: true }), false)
  assert.equal(updater.state().state, 'held_back')
  assert.equal(cloud.hits.length, 0)
  assert.equal(await updater.check(release, { auto: true, requested: true }), true, 'Update now tries it again')
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, 'current.json'))).bad_versions, [], 'and clears it once it installed')

  const manual = createUpdater({ home: null, version: '1.0.0-dev', api: cloud.api, exit: c => exits.push(c) })
  assert.equal(await manual.check(release, { auto: true, requested: true }), false)
  assert.deepEqual([manual.state().updates, manual.state().available], ['manual', rel.version])
  assert.equal(cloud.hits.length, 1)
  fs.rmSync(home, { recursive: true, force: true })
  cloud.server.close()
})

/** A fake installed hub version: a script run as hub.js. */
function fakeVersion(home, version, body) {
  const dir = path.join(home, 'releases', version, 'hub', 'bin')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'hub.js'), body)
  return 'releases/' + version
}

function waitFor(check, ms = 20000) {
  const until = Date.now() + ms
  return new Promise((resolve, reject) => {
    const t = setInterval(() => {
      let ok = false
      try { ok = check() } catch { ok = false }
      if (ok) { clearInterval(t); resolve() } else if (Date.now() > until) { clearInterval(t); reject(new Error('timed out')) }
    }, 100)
  })
}

test('the launcher: starts again after an update, goes back when a new version keeps stopping', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-launch-'))
  const marker = path.join(home, 'ran.txt')
  // 1.0: writes "1.0" and keeps running. 2.0: stops at once (a broken version).
  const v1 = fakeVersion(home, '1.0', `require('fs').appendFileSync(${JSON.stringify(marker)}, '1.0 ' + process.argv.slice(2).join(' ') + '\\n'); setInterval(() => {}, 1000)`)
  const v2 = fakeVersion(home, '2.0', `require('fs').appendFileSync(${JSON.stringify(marker)}, '2.0\\n'); process.exit(3)`)
  // 1.5: the first run exits 75 (as after an update), the second keeps running.
  const v15 = fakeVersion(home, '1.5', `const fs = require('fs'); const n = fs.existsSync(${JSON.stringify(marker)}) ? fs.readFileSync(${JSON.stringify(marker)}, 'utf8').split('1.5').length - 1 : 0; fs.appendFileSync(${JSON.stringify(marker)}, '1.5\\n'); if (n === 0) process.exit(75); setInterval(() => {}, 1000)`)
  for (const v of ['1.0', '2.0', '1.5']) fs.writeFileSync(path.join(home, 'releases', v, 'package.json'), '{"type":"commonjs"}')

  const launcher = path.join(here, '..', 'bin', 'launcher.js')
  const logFile = path.join(home, 'hub.log')
  const run = () => spawn(process.execPath, [launcher, '--api', 'http://x', '--log-file', logFile], {
    env: { ...process.env, MACAROONIE_HUB_HOME: home, MACAROONIE_HUB_QUICK_MS: '60000' }, stdio: 'ignore',
  })

  // An update (exit 75) starts it again at once.
  fs.writeFileSync(path.join(home, 'current.json'), JSON.stringify({ version: '1.5', dir: v15, previous: { version: '1.0', dir: v1 } }))
  let child = run()
  await waitFor(() => fs.readFileSync(marker, 'utf8').split('\n').filter(Boolean).length === 2)
  assert.deepEqual(fs.readFileSync(marker, 'utf8').trim().split('\n'), ['1.5', '1.5'])
  child.kill('SIGTERM')
  await new Promise(r => child.on('exit', r))

  // 2.0 keeps stopping: after three quick stops, back to 1.0, with 2.0 held back.
  fs.writeFileSync(marker, '')
  fs.writeFileSync(path.join(home, 'current.json'), JSON.stringify({ version: '2.0', dir: v2, previous: { version: '1.0', dir: v1 }, bad_versions: [] }))
  child = run()
  await waitFor(() => fs.readFileSync(marker, 'utf8').includes('1.0'), 30000)
  const runs = fs.readFileSync(marker, 'utf8').trim().split('\n')
  assert.deepEqual(runs.slice(0, 3), ['2.0', '2.0', '2.0'])
  assert.match(runs[3], /^1\.0 --config .*hub\.json --api http:\/\/x$/, 'the hub gets its config and arguments, not --log-file')
  const cur = JSON.parse(fs.readFileSync(path.join(home, 'current.json')))
  assert.deepEqual([cur.version, cur.dir, cur.previous, cur.bad_versions, cur.rolled_back_from], ['1.0', v1, null, ['2.0'], '2.0'])
  assert.match(fs.readFileSync(logFile, 'utf8'), /Version 2\.0 keeps stopping: went back to 1\.0/)
  child.kill('SIGTERM')
  await new Promise(r => child.on('exit', r))
  fs.rmSync(home, { recursive: true, force: true })
})
