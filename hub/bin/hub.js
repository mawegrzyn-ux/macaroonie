#!/usr/bin/env node
// hub/bin/hub.js
//
// The venue hub. Run it on a PC (or a small box) on the restaurant's network
// next to the printers:
//
//   node hub/bin/hub.js                          link it (first time), then print
//   node hub/bin/hub.js --api https://pos.macaroonie.com
//   node hub/bin/hub.js --config C:\macaroonie\hub.json
//   node hub/bin/hub.js --forget                 unlink: show a new code
//
// The first time it shows a six-letter code: type it in Till setup →
// Printers → Link a venue hub. The link (the device id and its secret) is kept
// in hub.json beside this folder (or --config); keep that file private.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { requestCode, codeStatus, cloudClient } from '../src/cloud.js'
import { startHub, VERSION } from '../src/service.js'

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const i = args.indexOf('--' + name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const here = path.dirname(fileURLToPath(import.meta.url))
const configPath = option('config', process.env.HUB_CONFIG || path.join(here, '..', 'hub.json'))
const log = line => console.log(new Date().toLocaleTimeString('en-GB') + '  ' + line)

function readConfig() {
  try { return JSON.parse(fs.readFileSync(configPath, 'utf8')) } catch { return {} }
}
function writeConfig(c) {
  fs.writeFileSync(configPath, JSON.stringify(c, null, 2) + '\n', { mode: 0o600 })
}

async function link(api) {
  for (;;) {
    const pairing = await requestCode(api, { version: VERSION })
    console.log('')
    console.log('  Link this hub: in Till setup → Printers → Link a venue hub, type')
    console.log('')
    console.log('        ' + pairing.code)
    console.log('')
    console.log('  The code works for 15 minutes; a new one comes after that.')
    console.log('')
    for (;;) {
      await new Promise(r => setTimeout(r, 4000))
      let s
      try { s = await codeStatus(api, pairing) } catch (e) { log('Couldn\'t reach the cloud: ' + e.message); continue }
      if (s.status === 'paired') {
        log(`Linked as ${s.name} at ${s.venue_name}`)
        return { api, device_id: s.device_id, secret: pairing.secret, name: s.name, venue_name: s.venue_name }
      }
      if (s.status === 'expired') break
    }
  }
}

async function main() {
  let c = readConfig()
  const api = (option('api', c.api || process.env.HUB_API || 'https://pos.macaroonie.com')).replace(/\/+$/, '')
  if (args.includes('--forget')) c = {}
  if (!c.device_id || !c.secret || c.api !== api) {
    c = await link(api)
    writeConfig(c)
  }
  log(`Macaroonie hub ${VERSION}: ${c.name || 'hub'} at ${c.venue_name || 'the venue'}, ${api}`)
  const cloud = cloudClient({ api, deviceId: c.device_id, secret: c.secret })
  try {
    await cloud.config()
  } catch (e) {
    if (e.status === 401) {
      log('This hub was unlinked or removed in Till setup: run again with --forget to link it.')
      process.exit(1)
    }
    log('Couldn\'t reach the cloud yet (' + e.message + '): carrying on, it tries again.')
  }
  startHub({ cloud, log })
}

main().catch(e => { console.error(e); process.exit(1) })
