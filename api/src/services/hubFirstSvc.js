// src/services/hubFirstSvc.js
//
// Hub-first locations (docs/POS.md section 11, migration 218): at a location
// whose venue hub is linked, tills, kiosks, kitchen screens and order ready
// boards on the venue network talk to the hub first. The hub keeps a copy of
// the venue (shared/pos/mirror.js), decides events over it with the same
// sequencer, and sends them up; the cloud decides them again and stays the
// one record. This file is the cloud's side:
//
//   lanKey()        the key a device shows the hub (Authorization: Lan <id>.<key>),
//                   worked out from its pairing (vault.js deriveKey()), so nothing
//                   is stored and pairing a device again changes it. The hub only
//                   gets its sha256, so a key read off the venue network opens the
//                   hub and nothing in the cloud.
//   primaryHubId()  the venue's hub devices use: linked, reporting its LAN port
//                   lately, the first linked if there are several (another hub
//                   still prints, it just doesn't take events)
//   hubFor()        the `hub` block of a device's config: { id, urls, lan_key }, or
//                   null (hub first switched off, no hub, or it hasn't said where it is)
//   hubContext()    what the hub decides with (GET /pos-api/hub/context)
//   hubSync()       the cloud's log and state since a seq (GET /pos-api/hub/sync)

import { deriveKey } from './vault.js'
import { sha256, sequencerContext, ensureSettings } from './posSvc.js'
import { STALE_HOURS } from '../../../shared/pos/kitchen.js'

// A hub that reported within this long (with its LAN port) is offered to devices.
export const HUB_FRESH_MINUTES = 15
// A hub further behind than this starts again from the cloud's state.
export const HUB_SYNC_WINDOW = 2000
// On a fresh start, the event ids the hub remembers (so a device sending an
// event again after the cloud took it gets the cloud's answer, not a second one).
const RECENT_IDS = 5000
// Device kinds that talk to the hub.
export const HUB_DEVICE_KINDS = ['terminal', 'kiosk', 'kds']
// Every order ready board shows orders ready in the last two hours.
const BOARD_CLEAR_MINS = 120

/** A device's or menu screen's key for the venue hub (null when it isn't paired). */
export function lanKey(kind, id, secretHash) {
  return secretHash ? deriveKey('lan:' + kind + ':' + id + ':' + secretHash) : null
}

const ipv4 = a => /^(\d{1,3}\.){3}\d{1,3}$/.test(String(a || ''))

/**
 * The venue's hub devices use: linked, not removed, reporting its LAN port
 * within HUB_FRESH_MINUTES (or `selfId`, the hub asking), the first linked.
 */
export async function primaryHub(tx, tenantId, venueId, selfId = null) {
  const [h] = await tx`
    SELECT id, info FROM pos_devices
     WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND kind = 'hub'
       AND revoked_at IS NULL AND secret_hash IS NOT NULL
       AND (id = ${selfId} OR ((info->>'lan_port') IS NOT NULL AND last_seen_at > now() - make_interval(mins => ${HUB_FRESH_MINUTES})))
     ORDER BY created_at, id LIMIT 1`
  return h || null
}

/** Whether the location is set to hub first (on unless switched off). */
async function hubFirstOn(tx, tenantId, venueId) {
  const [s] = await tx`SELECT hub_first FROM pos_settings WHERE venue_id = ${venueId} AND tenant_id = ${tenantId}`
  return s?.hub_first !== false
}

/**
 * The `hub` block of a device's or menu screen's config: where the venue hub
 * is and the key to show it, or null. kind: 'device' (a till, kiosk or
 * kitchen screen) or 'screen' (an order ready board's player).
 */
export async function hubFor(tx, tenantId, venueId, { kind, id, secretHash }) {
  if (!(await hubFirstOn(tx, tenantId, venueId))) return null
  const h = await primaryHub(tx, tenantId, venueId)
  const port = Number(h?.info?.lan_port) || 0
  const urls = (h?.info?.addresses || []).filter(ipv4).map(a => 'http://' + a + ':' + port)
  const key = lanKey(kind, id, secretHash)
  if (!h || !port || !urls.length || !key) return null
  return { id: h.id, urls, lan_key: key }
}

/**
 * What the hub decides with: the sequencer's context (staff and their
 * permissions without PIN hashes, printing and kitchen config, device codes),
 * the devices and menu screens that may use it (with their keys' sha256),
 * whether this hub is the one devices use and whether hub first is on.
 * `version` changes when any of it does.
 */
export async function hubContext(tx, tenantId, venueId, hubId) {
  await ensureSettings(tx, tenantId, venueId)
  const context = await sequencerContext(tx, tenantId, venueId)
  // PIN hashes stay with the cloud and the tills: the hub never checks a PIN.
  for (const s of Object.values(context.staffById)) delete s.pin_hash
  const [devices, screens, primary, on] = await Promise.all([
    tx`
      SELECT id, kind, name, short_code, secret_hash FROM pos_devices
       WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND kind = ANY(${HUB_DEVICE_KINDS}::text[])
         AND revoked_at IS NULL AND secret_hash IS NOT NULL
       ORDER BY created_at, id`,
    tx`
      SELECT id, name, secret_hash FROM screens
       WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND secret_hash IS NOT NULL
       ORDER BY created_at, id`,
    primaryHub(tx, tenantId, venueId, hubId),
    hubFirstOn(tx, tenantId, venueId),
  ])
  const body = {
    venue_id: venueId,
    hub_id: hubId,
    hub_first: on,
    primary: primary?.id === hubId,
    context,
    devices: devices.map(d => ({ id: d.id, kind: d.kind, name: d.name, short_code: d.short_code, key_hash: sha256(lanKey('device', d.id, d.secret_hash)) })),
    screens: screens.map(s => ({ id: s.id, name: s.name, key_hash: sha256(lanKey('screen', s.id, s.secret_hash)) })),
    board_clear_mins: BOARD_CLEAR_MINS,
  }
  return { ...body, version: sha256(JSON.stringify(body)).slice(0, 16) }
}

/**
 * The cloud's log since `since` for the hub's copy (shared/pos/mirror.js
 * applyCloud()): the new events' ids, the checks and kitchen orders they
 * changed, the trading day, every device's numbers, the Splitters' last
 * picks and who has which check open. Read under the venue's sequencer lock
 * (shared), so the states and seq agree. A hub that is new, ahead (the
 * cloud's log was reset) or too far behind starts again (reset: true) with
 * the open checks, the day's checks, the kitchen and recent event ids.
 */
export async function hubSync(tx, tenantId, venueId, since, presence = []) {
  await tx`SELECT pg_advisory_xact_lock_shared(hashtext(${'pos:' + venueId}))`
  const [[st], [day], turns] = await Promise.all([
    tx`SELECT last_seq, device_numbers FROM pos_venue_state WHERE venue_id = ${venueId} AND tenant_id = ${tenantId}`,
    tx`SELECT id, business_date::text AS business_date FROM pos_days WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND closed_at IS NULL LIMIT 1`,
    tx`SELECT station_id, last_station_id FROM kds_balance_turns WHERE tenant_id = ${tenantId} AND venue_id = ${venueId}`,
  ])
  const seq = Number(st?.last_seq || 0)
  const common = {
    seq,
    day: day || null,
    numbers: st?.device_numbers || {},
    turns: Object.fromEntries(turns.map(r => [r.station_id, r.last_station_id])),
    presence,
    server_time: new Date().toISOString(),
  }
  const kitchenRow = r => ({ state: r.state, updated_at: r.updated_at })
  if (!since || since > seq || seq - since > HUB_SYNC_WINDOW) {
    const [checks, kitchen, ids] = await Promise.all([
      tx`
        SELECT state FROM pos_checks
         WHERE tenant_id = ${tenantId} AND venue_id = ${venueId}
           AND (status = 'open' ${day ? tx`OR day_id = ${day.id}` : tx``})`,
      tx`
        SELECT state, updated_at FROM kds_orders
         WHERE tenant_id = ${tenantId} AND venue_id = ${venueId}
           AND (status IN ('active', 'ready') OR updated_at > now() - make_interval(hours => ${STALE_HOURS}))
         ORDER BY created_at DESC LIMIT 800`,
      tx`
        SELECT id FROM pos_events
         WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND seq > ${Math.max(0, seq - RECENT_IDS)}
         ORDER BY seq DESC LIMIT ${RECENT_IDS}`,
    ])
    return { reset: true, events: [], event_ids: ids.map(r => r.id), checks: checks.map(r => r.state), kitchen: kitchen.map(kitchenRow), ...common }
  }
  if (since === seq) return { events: [], checks: [], kitchen: [], ...common }
  const [events, checks, kitchen] = await Promise.all([
    tx`
      SELECT id, seq FROM pos_events
       WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND seq > ${since}
       ORDER BY seq LIMIT ${HUB_SYNC_WINDOW}`,
    tx`SELECT state FROM pos_checks WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND last_seq > ${since}`,
    tx`SELECT state, updated_at FROM kds_orders WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND last_seq > ${since}`,
  ])
  return {
    events: events.map(e => ({ id: e.id, seq: Number(e.seq) })),
    checks: checks.map(r => r.state),
    kitchen: kitchen.map(kitchenRow),
    ...common,
  }
}

/**
 * The time a hub-decided event happened, for the cloud's sequencer (its
 * trading day, the kitchen's clock): the hub's time, unless it is missing,
 * in the future or more than three days old.
 */
export function hubTime(at, now = Date.now()) {
  const t = Date.parse(at || '')
  if (!Number.isFinite(t) || t > now || t < now - 3 * 86400_000) return new Date(now)
  return new Date(t)
}
