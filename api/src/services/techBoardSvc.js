// src/services/techBoardSvc.js
//
// A venue's kit as the Tech board reads it (22 Nov 2026, OUTSTANDING 44.7;
// moved out of routes/techBoard.js 28 Nov 2026 so the menu screen Store
// status block reads the same): loadTechBoard(tx, tenantId, venueId, can)
// inside the caller's withTenant(). can: { kit, screens } says what to read.
//
//   devices       the tills, kitchen screens, kiosks and venue hubs (as Store
//                 tech's setup shows them, deviceView()) with the last thing
//                 each did; a hub with its copy for trading offline (copy_on,
//                 copy_at: when it last followed the cloud)
//   printers      with the last day's waiting and failed tickets and the last ticket
//   card_readers  with the last payment (they report no live status)
//   screens       with Screens view (shared/techBoard.js says when each is online)
//
// The last thing a till or kitchen screen did is its newest event among the
// venue's last EVENT_WINDOW (pos_events by the venue's own sequence: there is
// no index on device_id); a kiosk's is its last visit (kiosk_sessions); a
// hub's is its last report and the last copy it uploaded. The tile model
// (shared/techBoard.js techTiles()) turns this into what the board draws.

import { deviceView } from '../routes/posSetup.js'
import { SCREEN_ONLINE_MS, seenState } from '../../../shared/techBoard.js'

const EVENT_WINDOW = 5000

export async function loadTechBoard(tx, tenantId, venueId, can = { kit: true, screens: true }) {
  const [venue] = await tx`SELECT name, timezone FROM venues WHERE id = ${venueId} AND tenant_id = ${tenantId}`
  const out = {
    venue_id: venueId, venue_name: venue?.name || null, timezone: venue?.timezone || 'Europe/London', checked_at: new Date().toISOString(), can,
    devices: [], printers: [], card_readers: [], screens: [],
  }

  if (can.kit) {
    const devices = await tx`
      SELECT * FROM pos_devices WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND revoked_at IS NULL
       ORDER BY kind, name`
    const ids = devices.map(d => d.id)
    const [events, visits, printers, jobs, lastJobs, readers, payments] = await Promise.all([
      ids.length ? tx`
        SELECT DISTINCT ON (e.device_id) e.device_id, e.type, e.created_at
          FROM (SELECT device_id, type, created_at, seq FROM pos_events
                 WHERE tenant_id = ${tenantId} AND venue_id = ${venueId}
                 ORDER BY seq DESC LIMIT ${EVENT_WINDOW}) e
         WHERE e.device_id = ANY(${ids.map(String)}::text[])
         ORDER BY e.device_id, e.seq DESC` : [],
      ids.length ? tx`
        SELECT DISTINCT ON (device_id) device_id, started_at, outcome FROM kiosk_sessions
         WHERE tenant_id = ${tenantId} AND device_id = ANY(${ids}::uuid[])
         ORDER BY device_id, started_at DESC` : [],
      tx`SELECT id, name, kind, connection, device_id, local_id, host, port, is_active, status, status_at
           FROM pos_printers WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} ORDER BY sort_order, name`,
      tx`SELECT printer_id, count(*) FILTER (WHERE status IN ('queued', 'printing'))::int AS waiting,
                count(*) FILTER (WHERE status = 'failed')::int AS failed
           FROM pos_print_jobs
          WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND created_at > now() - interval '1 day' AND printer_id IS NOT NULL
          GROUP BY printer_id`,
      tx`SELECT DISTINCT ON (printer_id) printer_id, status, error, created_at, printed_at
           FROM pos_print_jobs
          WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND created_at > now() - interval '7 days' AND printer_id IS NOT NULL
          ORDER BY printer_id, created_at DESC`,
      tx`SELECT id, name, provider, model, serial FROM pos_card_readers
          WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND removed_at IS NULL ORDER BY name`,
      tx`SELECT DISTINCT ON (reader_id) reader_id, kind, status, amount, created_at
           FROM pos_card_payments
          WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND created_at > now() - interval '30 days'
          ORDER BY reader_id, created_at DESC`,
    ])
    const eventOf = new Map(events.map(e => [e.device_id, e]))
    const visitOf = new Map(visits.map(v => [v.device_id, v]))
    out.devices = devices.map(d => {
      const view = deviceView(d)
      let last = null
      if (d.kind === 'kiosk') {
        const v = visitOf.get(d.id)
        if (v) last = { at: v.started_at, what: v.outcome === 'ordered' ? 'order' : 'visit' }
      } else if (d.kind === 'hub') {
        if (d.info_at) last = { at: d.info_at, what: 'report' }
      } else {
        const e = eventOf.get(String(d.id))
        if (e) last = { at: e.created_at, what: 'event', type: e.type }
      }
      const mirror = d.info?.mirror
      return {
        ...view,
        last_action: last,
        ...(d.kind === 'hub' ? {
          backup_uploaded_at: mirror?.last_upload_at || null,
          copy_on: !!mirror?.on, copy_at: mirror?.last_follow_at || null,
        } : {}),
      }
    })
    const jobsOf = new Map(jobs.map(j => [j.printer_id, j]))
    const lastJobOf = new Map(lastJobs.map(j => [j.printer_id, j]))
    out.printers = printers.map(p => {
      const j = lastJobOf.get(p.id)
      return {
        ...p,
        jobs: { waiting: jobsOf.get(p.id)?.waiting ?? 0, failed: jobsOf.get(p.id)?.failed ?? 0 },
        last_job: j ? { at: j.printed_at || j.created_at, status: j.status, error: j.error || null } : null,
      }
    })
    const payOf = new Map(payments.map(p => [p.reader_id, p]))
    out.card_readers = readers.map(r => {
      const p = payOf.get(r.id)
      return { ...r, last_payment: p ? { at: p.created_at, kind: p.kind, status: p.status, amount: p.amount } : null }
    })
  }

  if (can.screens) {
    const screens = await tx`
      SELECT id, name, short_code, secret_hash IS NOT NULL AS paired, last_seen_at, app_version, status
        FROM screens WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} ORDER BY sort_order, name`
    out.screens = screens.map(s => ({
      id: s.id, name: s.name, short_code: s.short_code, paired: s.paired,
      last_seen_at: s.last_seen_at, app_version: s.app_version,
      state: seenState(s.last_seen_at, SCREEN_ONLINE_MS, { linked: s.paired }),
      showing: s.status?.showing || null, error: s.status?.error || null, status_at: s.status?.at || null,
    }))
  }
  return out
}
