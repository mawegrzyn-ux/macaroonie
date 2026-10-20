#!/usr/bin/env node
// hub/bin/hub.js
//
// The venue hub. Installed on a mini PC by the printers (the installer from
// Till setup → Printers sets it up as a service), or run by hand:
//
//   node hub/bin/hub.js                          link it (first time), then print
//   node hub/bin/hub.js --api https://pos.macaroonie.com
//   node hub/bin/hub.js --config /opt/macaroonie-hub/hub.json
//   node hub/bin/hub.js --http-port 9180         the status page's port (0 = none)
//   node hub/bin/hub.js --forget                 unlink: show a new code
//   node hub/bin/hub.js status                   what the running hub shows (state.json)
//   node hub/bin/hub.js --self-test              checks this copy works (used by updates)
//
// Until it is linked it shows a six-letter code (here, on its status page
// at http://<this computer>:9180 and as a QR code there): type it in Till
// setup → Printers → Link a hub, or scan it with the installer app. The link
// (the device id and its secret) is kept in hub.json beside this folder (or
// --config); keep that file private. Removed in Till setup, it shows a new
// code by itself.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { requestCode, codeStatus, cloudClient } from '../src/cloud.js'
import { startHub, newState } from '../src/service.js'
import { createUpdater, hubVersion, writeJsonAtomic } from '../src/update.js'
import { startStatusPage, publicState, STATUS_PORT } from '../src/statusPage.js'
import { findPrinters } from '../src/usb.js'

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

function readConfig() {
  try { return JSON.parse(fs.readFileSync(configPath, 'utf8')) } catch { return {} }
}
function writeConfig(c) {
  fs.writeFileSync(configPath, JSON.stringify(c, null, 2) + '\n', { mode: 0o600 })
}

/** `hub.js --self-test`: everything loads and a ticket renders. Prints "ok <version>". */
async function selfTest() {
  const { render } = await import('../src/escpos.js')
  const { kitchenTicket } = await import('../../shared/pos/tickets.js')
  const { renderPage } = await import('../src/statusPage.js')
  await import('../src/usb.js')
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
  console.log(`Macaroonie hub ${s.version}: ${s.phase}${s.name ? ', ' + s.name : ''}${s.venue_name ? ' at ' + s.venue_name : ''}`)
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
    console.log('  Link this hub: in Till setup → Printers → Link a hub, type')
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
        log(`Linked as ${s.name} at ${s.venue_name}`)
        state.link = null
        return { api, device_id: s.device_id, secret: pairing.secret, name: s.name, venue_name: s.venue_name }
      }
      if (s.status === 'expired') break
    }
  }
}

async function main() {
  if (args.includes('--self-test')) return selfTest()
  if (args[0] === 'status') return printStatus()

  let c = readConfig()
  const api = (option('api', c.api || process.env.HUB_API || 'https://pos.macaroonie.com')).replace(/\/+$/, '')
  if (args.includes('--forget')) c = {}

  const state = newState({ api, version })
  let written = ''
  const saveState = () => {
    const json = JSON.stringify(publicState(state))
    if (json === written) return
    try { writeJsonAtomic(statePath, JSON.parse(json)); written = json } catch { /* a read-only folder: the page still works */ }
  }
  setInterval(saveState, 2000).unref()

  const port = Number(option('http-port', process.env.HUB_HTTP_PORT ?? STATUS_PORT))
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
      c = await link(api, state)
      writeConfig(c)
    }
    state.name = c.name || null
    state.venue_name = c.venue_name || null
    log(`Macaroonie hub ${version}: ${c.name || 'hub'} at ${c.venue_name || 'the venue'}, ${api}`)
    const cloud = cloudClient({ api, deviceId: c.device_id, secret: c.secret })
    try {
      await cloud.config()
    } catch (e) {
      if (e.status === 401) {
        log('This hub was unlinked or removed in Till setup: showing a new code.')
        c = {}
        writeConfig(c)
        continue
      }
      log('Couldn\'t reach the cloud yet (' + e.message + '): carrying on, it tries again.')
    }
    // Runs until the cloud says the hub was removed, then links again.
    await new Promise(resolve => {
      const hub = startHub({
        cloud, log, state, updater, version, statusPort: state.computer.status_port,
        onUnlinked: () => { hub.stop(); resolve() },
      })
    })
    log('This hub was unlinked or removed in Till setup: showing a new code.')
    state.phase = 'unlinked'
    c = {}
    writeConfig(c)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
