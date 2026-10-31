#!/usr/bin/env node
// hub/bin/launcher.js
//
// Keeps an installed hub running. The installer copies this file to
// <home>/launcher.mjs and the service (systemd on Linux, a scheduled task on
// Windows) runs it:
//
//   <home>/node/bin/node <home>/launcher.mjs
//
// It starts the version named in <home>/current.json and starts it again
// when it stops: straight away after an update (exit 75), else after a short
// wait that grows while it keeps stopping. When a new version stops three
// times within a minute of starting, it goes back to the version before it
// and lists the new one in bad_versions (the hub then doesn't update to it by
// itself). Only Node's own modules: it must run whatever the hub's code is.

import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const home = process.env.MACAROONIE_HUB_HOME || path.dirname(fileURLToPath(import.meta.url))
const QUICK_MS = Number(process.env.MACAROONIE_HUB_QUICK_MS) || 60_000
const UPDATED_EXIT = 75
const sleep = ms => new Promise(r => setTimeout(r, ms))

const argv = process.argv.slice(2)
const logAt = argv.indexOf('--log-file')
const logFile = logAt >= 0 ? argv[logAt + 1] : null
const hubArgs = logAt >= 0 ? [...argv.slice(0, logAt), ...argv.slice(logAt + 2)] : argv
const LOG_MAX = 5 * 1024 * 1024

let logStream = null
function openLog() {
  if (!logFile) return
  try {
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > LOG_MAX) fs.renameSync(logFile, logFile + '.1')
  } catch { /* keep writing to it */ }
  logStream?.end()
  logStream = fs.createWriteStream(logFile, { flags: 'a' })
}
openLog()
if (logFile) setInterval(openLog, 60 * 60_000).unref()

function write(chunk) {
  process.stdout.write(chunk)
  logStream?.write(chunk)
}
const log = line => write(new Date().toISOString() + '  launcher: ' + line + '\n')

const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null } }
function writeJson(file, data) {
  fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 2) + '\n')
  fs.renameSync(file + '.tmp', file)
}

let stopping = false
let child = null
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    stopping = true
    if (child) child.kill('SIGTERM')
    else process.exit(0)
  })
}

async function main() {
  let quickStops = 0
  for (;;) {
    const currentFile = path.join(home, 'current.json')
    const cur = readJson(currentFile)
    const entry = cur?.dir && path.join(home, cur.dir, 'hub', 'bin', 'hub.js')
    if (!entry || !fs.existsSync(entry)) {
      log('No hub installed in ' + home + ' (current.json): waiting')
      await sleep(30_000)
      continue
    }
    const started = Date.now()
    child = spawn(process.execPath, [entry, '--config', path.join(home, 'hub.json'), ...hubArgs], {
      stdio: ['ignore', 'pipe', 'pipe'],
      // The hub stops by itself when this launcher has gone (hub.js watchLauncher()).
      env: { ...process.env, MACAROONIE_HUB_HOME: home, MACAROONIE_HUB_LAUNCHER_PID: String(process.pid) },
      windowsHide: true,
    })
    child.stdout.on('data', write)
    child.stderr.on('data', write)
    const code = await new Promise(resolve => {
      child.on('exit', (c, signal) => resolve(c ?? (signal ? 1 : 0)))
      child.on('error', e => { log('Couldn\'t start the hub: ' + e.message); resolve(1) })
    })
    child = null
    if (stopping) process.exit(0)
    if (code === UPDATED_EXIT) {
      log('Updated: starting the new version')
      quickStops = 0
      continue
    }
    quickStops = code !== 0 && Date.now() - started < QUICK_MS ? quickStops + 1 : 0
    log(`The hub stopped (${code})` + (quickStops ? `, ${quickStops} time${quickStops > 1 ? 's' : ''} in a row soon after starting` : ''))
    if (quickStops >= 3 && cur.previous?.dir && fs.existsSync(path.join(home, cur.previous.dir, 'hub', 'bin', 'hub.js'))) {
      writeJson(currentFile, {
        version: cur.previous.version,
        dir: cur.previous.dir,
        previous: null,
        bad_versions: [...new Set([...(cur.bad_versions || []), cur.version])],
        rolled_back_from: cur.version,
        updated_at: new Date().toISOString(),
      })
      log(`Version ${cur.version} keeps stopping: went back to ${cur.previous.version}`)
      quickStops = 0
      continue
    }
    await sleep(Math.min(2000 * 2 ** Math.max(0, quickStops - 1), 30_000))
  }
}

main()
