#!/usr/bin/env node
// hub/bin/hub.js
//
// The venue hub. Installed on a mini PC by the printers (the installer from
// Store tech → Venue hub sets it up as a service), or run by hand:
//
//   node hub/bin/hub.js                          link it (first time), then print
//   node hub/bin/hub.js --api https://pos.macaroonie.com
//   node hub/bin/hub.js --config /opt/macaroonie-hub/hub.json
//   node hub/bin/hub.js --http-port 9180         the status page's port (0 = none)
//   node hub/bin/hub.js --lan-port 9181          hub first: the port tills, kiosks and kitchen
//                                                screens on the venue network use (0 = none)
//   node hub/bin/hub.js status                   what the running hub shows (state.json)
//   node hub/bin/hub.js link-info [--api URL]    what it is linked to, one line of JSON (the installer)
//   node hub/bin/hub.js unlink [--force]         take it off its venue (src/link.js): sends what
//                                                waits, tells the cloud, deletes the venue's files;
//                                                refuses (exit 2) while sales wait to go up and the
//                                                cloud doesn't answer, unless --force. Stop the hub first.
//   node hub/bin/hub.js --self-test              checks this copy works (used by updates)
//
// Until it is linked it shows a six-letter code (here, on its status page
// at http://<this computer>:9180 and as a QR code there): type it in Store
// tech → Venue hub → Link a hub, or scan it with the installer app. The link
// (the device id and its secret) is kept in hub.json beside this folder (or
// --config); keep that file private. Removed in Store tech, it shows a new
// code by itself, and forgets that venue's files. To move the computer to
// another venue or restaurant group, run the installer again and pick Link it
// to another (it runs `unlink`).
//
// Hub first (docs/POS.md section 11): once linked it also keeps a copy of
// the venue (venue.js, venue.json and venue.log beside hub.json) and serves
// the venue network on --lan-port (lan.js): the venue keeps trading on the
// hub with the internet down, and everything goes up when it is back.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { requestCode, codeStatus, cloudClient } from '../src/cloud.js'
import { startHub, newState } from '../src/service.js'
import { createUpdater, hubVersion, writeJsonAtomic } from '../src/update.js'
import { startStatusPage, publicState, STATUS_PORT } from '../src/statusPage.js'
import { findPrinters } from '../src/usb.js'
import { startVenue } from '../src/venue.js'
import { startLan, LAN_PORT } from '../src/lan.js'
import { readLink, writeLink, forgetVenue, linkInfo, unlink } from '../src/link.js'

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const i = args.indexOf('--' + name)
  return i >= 0 && args[i + 1] != null ? args[i + 1] : fallback
}
const here = path.dirname(fileURLToPath(import.meta.url))
const configPath = option('config', process.env.HUB_CONFIG || path.join(here, '..', 'hub.json'))
const statePath = path.join(path.dirname(configPath), 'state.json')
const log = line => console.log(new Date().toLocaleTimeString('en-GB') + '  ' + line)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const version = hubVersion()

const readConfig = () => readLink(configPath)
const writeConfig = c => writeLink(configPath, c)

/** `hub.js --self-test`: everything loads and a ticket renders. Prints "ok <version>". */
async function selfTest() {
  const { render } = await import('../src/escpos.js')
  const { kitchenTicket } = await import('../../shared/pos/tickets.js')
  const { renderPage } = await import('../src/statusPage.js')
  await import('../src/usb.js')
  await import('../src/lan.js')
  const { createMirror } = await import('../../shared/pos/mirror.js')
  await createMirror({ hubId: 'self-test' }).ready
  const bytes = render(kitchenTicket({ station: 'Test', table: '1', sentAt: new Date(), courses: [{ name: '', lines: [{ qty: 1, name: 'Test dish' }] }] }))
  if (!bytes.length || !renderPage(newState()).includes('Macaroonie hub')) throw new Error('self test failed')
  console.log('ok ' + version)
}

/** `hub.js status`: what the running hub last wrote. */
function printStatus() {
  let s
  try { s = JSON.parse(fs.readFileSync(statePath, 'utf8')) } catch {
    console.log('The hub isn\'t running yet (no ' + statePath + ').')
    process.exit(1)
  }
  console.log(`Macaroonie hub ${s.version}: ${s.phase}${s.name ? ', ' + s.name : ''}${s.venue_name ? ' at ' + s.venue_name : ''}${s.tenant_name ? ' (' + s.tenant_name + ')' : ''}`)
  if (s.phase === 'linking' && s.link?.code) {
    console.log('')
    console.log('  Link code: ' + s.link.code)
    if (s.link.link_url) console.log('  Or open:   ' + s.link.link_url)
    console.log('')
  }
  if (s.cloud?.ok === false) console.log('Cloud: can\'t reach it: ' + s.cloud.error)
  else if (s.cloud?.ok) console.log('Cloud: connected')
  const port = s.computer?.status_port
  if (port) for (const a of s.computer?.addresses || []) console.log(`Status page: http://${a}:${port}`)
  for (const p of s.printers || []) console.log(`Printer ${p.name}: ${p.error ? 'not answering: ' + p.error : p.state ? (p.state.online ? 'ready' : 'offline') : 'not checked yet'}`)
  for (const p of s.local_printers || []) console.log(`Plugged in: ${p.name} (${p.path || p.id})`)
}

async function link(api, state) {
  for (;;) {
    let pairing
    try {
      pairing = await requestCode(api, { version })
    } catch (e) {
      state.cloud = { ok: false, at: state.cloud?.at || null, error: e.message }
      log('Couldn\'t reach the cloud for a link code (' + e.message + '): trying again')
      await sleep(10000)
      continue
    }
    state.phase = 'linking'
    state.cloud = { ok: true, at: new Date().toISOString(), error: null }
    state.link = { code: pairing.code, link_url: pairing.link_url || null, expires_at: pairing.expires_at || null }
    console.log('')
    console.log('  Link this hub: in Store tech → Venue hub → Link a hub, type')
    console.log('')
    console.log('        ' + pairing.code)
    console.log('')
    if (pairing.link_url) console.log('  or open ' + pairing.link_url + ' on a phone.')
    console.log('  The code works for 15 minutes; a new one comes after that.')
    console.log('')
    for (;;) {
      await sleep(4000)
      let s
      try { s = await codeStatus(api, pairing) } catch (e) {
        state.cloud = { ok: false, at: state.cloud.at, error: e.message }
        log('Couldn\'t reach the cloud: ' + e.message)
        continue
      }
      state.cloud = { ok: true, at: new Date().toISOString(), error: null }
      if (s.status === 'paired') {
        log(`Linked as ${s.name} at ${s.venue_name}${s.tenant_name ? ' (' + s.tenant_name + ')' : ''}`)
        state.link = null
        return { api, device_id: s.device_id, secret: pairing.secret, name: s.name, venue_name: s.venue_name, tenant_name: s.tenant_name || null }
      }
      if (s.status === 'expired') break
    }
  }
}

// Started by the launcher (bin/launcher.js): stop when it has gone. On
// Windows, ending the scheduled task ends the launcher only, and a hub left
// running would keep its ports and its link while a new copy starts.
function watchLauncher() {
  const pid = Number(process.env.MACAROONIE_HUB_LAUNCHER_PID)
  if (!pid || pid === process.pid) return
  setInterval(() => {
    try { process.kill(pid, 0) } catch (e) {
      if (e.code === 'ESRCH') { log('The launcher has stopped: stopping too'); process.exit(0) }
    }
  }, 5000).unref()
}

async function main() {
  if (args.includes('--self-test')) return selfTest()
  if (args[0] === 'status') return printStatus()
  if (args[0] === 'link-info') {
    const api = option('api', null)
    console.log(JSON.stringify(await linkInfo({ configPath, api: api ? api.replace(/\/+$/, '') : null })))
    return
  }
  if (args[0] === 'unlink') {
    const r = await unlink({ configPath, force: args.includes('--force') })
    console.log(JSON.stringify(r))
    if (!r.ok) process.exitCode = 2
    return
  }
  watchLauncher()

  let c = readConfig()
  const api = (option('api', c.api || process.env.HUB_API || 'https://pos.macaroonie.com')).replace(/\/+$/, '')

  const state = newState({ api, version })
  let written = ''
  const saveState = () => {
    const json = JSON.stringify(publicState(state))
    if (json === written) return
    try { writeJsonAtomic(statePath, JSON.parse(json)); written = json } catch { /* a read-only folder: the page still works */ }
  }
  setInterval(saveState, 2000).unref()

  const port = Number(option('http-port', process.env.HUB_HTTP_PORT ?? STATUS_PORT))
  const lanPortWanted = Number(option('lan-port', process.env.HUB_LAN_PORT ?? LAN_PORT))
  const dir = path.dirname(configPath)
  const printersFile = path.join(dir, 'printers.json')
  const page = await startStatusPage({ port, getState: () => state, log })
  state.computer.status_port = page?.port || null

  const updater = createUpdater({ api, version, log })
  state.update = updater.state()

  // The USB printers plugged in, for the page while it isn't linked yet
  // (once linked, the print loop checks them every minute).
  const lookForPrinters = async () => {
    if (state.phase === 'running') return
    state.local_printers = (await findPrinters()).map(({ id, name, make, model, escpos, path: p }) => ({ id, name, make, model, escpos, path: p }))
  }
  lookForPrinters()
  setInterval(lookForPrinters, 15000).unref()

  for (;;) {
    if (!c.device_id || !c.secret || c.api !== api) {
      // A new link starts clean: nothing of a venue this computer served before.
      if (forgetVenue(dir).some(f => f !== 'state.json')) log('Forgot the files of the venue this hub was linked to before')
      c = await link(api, state)
      writeConfig(c)
    }
    const cloud = cloudClient({ api, deviceId: c.device_id, secret: c.secret })
    try {
      await cloud.config()
      // The names as they are now (renamed in Store tech, or linked before hub.json kept the group's name).
      const me = await cloud.me().catch(() => null)
      if (me && (me.name !== c.name || me.venue_name !== c.venue_name || (me.tenant_name || null) !== (c.tenant_name || null))) {
        c = { ...c, name: me.name, venue_name: me.venue_name, tenant_name: me.tenant_name || null }
        writeConfig(c)
      }
    } catch (e) {
      if (e.status === 401) {
        log('This hub was unlinked or removed in Store tech: showing a new code.')
        forgetVenue(dir)
        c = {}
        writeConfig(c)
        continue
      }
      log('Couldn\'t reach the cloud yet (' + e.message + '): carrying on, it tries again.')
    }
    state.name = c.name || null
    state.venue_name = c.venue_name || null
    state.tenant_name = c.tenant_name || null
    log(`Macaroonie hub ${version}: ${c.name || 'hub'} at ${c.venue_name || 'the venue'}${c.tenant_name ? ' (' + c.tenant_name + ')' : ''}, ${api}`)
    // Hub first: the venue's copy, and the venue network served from it.
    let hub = null
    const venue = startVenue({
      cloud, hubId: c.device_id, dir, log,
      onJobs: jobs => {
        for (const j of jobs) {
          const p = venue.printerOf(j.printer_id)
          // A printer plugged into a till or kitchen screen: it collects the ticket here.
          if (p?.connection === 'device' && p.device_id && p.device_id !== c.device_id) venue.queueForDevice(j, p.device_id)
          else if (!hub?.printOwn(j)) log(`Not printed: ${j.title || j.kind} (this hub doesn't know the printer yet)`)
        }
      },
    })
    const lan = lanPortWanted ? await startLan({ venue, port: lanPortWanted, log }) : null
    let savedConfig = null
    try { savedConfig = JSON.parse(fs.readFileSync(printersFile, 'utf8')) } catch { /* none yet */ }
    // Runs until the cloud says the hub was removed, then links again.
    await new Promise(resolve => {
      hub = startHub({
        cloud, log, state, updater, version, statusPort: state.computer.status_port,
        venue, lanPort: lan?.port || null, savedConfig,
        onConfig: cfg => { try { writeJsonAtomic(printersFile, cfg, 0o600) } catch { /* the folder is read-only: prints once the cloud answers */ } },
        onUnlinked: () => { hub.stop(); resolve() },
      })
      venue.started.catch(e => { if (e.status === 401) { hub.stop(); resolve() } })
    })
    await venue.stop()
    await lan?.close()
    log('This hub was unlinked or removed in Store tech: showing a new code.')
    state.phase = 'unlinked'
    state.tenant_name = null
    forgetVenue(dir)
    c = {}
    writeConfig(c)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
