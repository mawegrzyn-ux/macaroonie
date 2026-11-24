// src/services/salesImportSvc.js
//
// Sales from other tills, phase 1 (docs/SALES_IMPORT.md, migrations 288 to
// 290): what a connector reads is stored raw (ext_documents), then
// normalised into one shape for every system (ext_checks and its lines,
// payments, discounts and taxes; ext_catalog for master data).
//
//   storeDocuments(tx, ...)   upsert raw copies; returns the ones that changed
//   saveSale(), saveCatalog() write the normalised rows
//   syncConnection()          one connection's sync: master data, the
//                             catch-up by updated time, then each linked
//                             venue's history import, within a time budget;
//                             claimed so only one process runs it at a time
//   sweepDue()                the sync job: every connection whose catch-up is
//                             due (CATCH_UP_MINUTES), was asked for, or has
//                             history left; and the raw copies' clean-up
//   requestSync()             queue a connection's sync now (Sync now, the
//                             webhook, a new link); never awaited in a request
//   startHistory()            a venue's history import, HISTORY_MONTHS back
//   setupWebhook(), webhookPoke()   the webhook address and what it does
//   RAW_KEEP_DAYS             how long a raw copy is kept after its last fetch

import { createHash, randomBytes } from 'node:crypto'
import { systemSql, withTenant } from '../config/db.js'
import { unseal } from './vault.js'
import { officeOrigin } from './platformHost.js'
import * as loyverse from './connectors/loyverse.js'
import { queue as syncQueue } from '../jobs/sales-sync.js'
import { mappingContext, mapChecks, sweepRemaps } from './itemMappingSvc.js'
import { stableJson, CATCH_UP_MINUTES, HISTORY_MONTHS } from '../../../shared/externalSales.js'

const CONNECTORS = { loyverse }
export const connectorFor = system => CONNECTORS[system] || null

export const RAW_KEEP_DAYS = 400

const hashOf = payload => createHash('sha256').update(stableJson(payload)).digest('hex')

/**
 * Upserts raw documents by (connection, kind, external id). A copy whose
 * payload hasn't changed only has fetched_at moved on. Returns the documents
 * that are new or changed (each with its stored id), for normalising.
 */
export async function storeDocuments(tx, { tenantId, connectionId, docs }) {
  const changed = []
  for (const d of docs) {
    const hash = hashOf(d.payload)
    const [row] = await tx`
      WITH old AS (
        SELECT hash FROM ext_documents
         WHERE tenant_id = ${tenantId} AND connection_id = ${connectionId} AND kind = ${d.kind} AND external_id = ${d.external_id}
      )
      INSERT INTO ext_documents (tenant_id, connection_id, kind, external_id, external_updated_at, payload, hash)
      VALUES (${tenantId}, ${connectionId}, ${d.kind}, ${d.external_id}, ${d.external_updated_at}, ${tx.json(d.payload)}, ${hash})
      ON CONFLICT (connection_id, kind, external_id) DO UPDATE SET
        external_updated_at = EXCLUDED.external_updated_at,
        payload = EXCLUDED.payload, hash = EXCLUDED.hash, fetched_at = now()
      WHERE ext_documents.tenant_id = ${tenantId}
      RETURNING id, (SELECT hash FROM old) AS old_hash
    `
    if (row && row.old_hash !== hash) changed.push({ ...d, id: row.id, hash })
  }
  return changed
}

/**
 * Raw copies not fetched again for RAW_KEEP_DAYS go (the sync job, once an
 * hour is plenty; system mode: it crosses tenants on purpose). The
 * normalised rows stay. Returns how many went.
 */
export async function sweepRawDocuments() {
  const gone = await systemSql`
    DELETE FROM ext_documents WHERE fetched_at < now() - make_interval(days => ${RAW_KEEP_DAYS})`
  return gone.count
}

/**
 * Writes one normalised receipt (connector normalise()) for a venue: the
 * check upserted by (connection, external id), its lines, payments,
 * discounts and taxes replaced. A refund is linked to the check it refunds,
 * and a sale that arrives after its refund is linked from it. Returns the
 * check's id.
 */
export async function saveSale(tx, { tenantId, connectionId, venueId, documentId = null, currency = null, sale }) {
  const c = sale.check
  const [row] = await tx`
    INSERT INTO ext_checks (tenant_id, connection_id, venue_id, document_id, external_id, number, kind, refund_for_ref,
                            business_date, opened_at, closed_at, cancelled, cancelled_at, source, order_type,
                            device_ref, employee_ref, customer_ref, location_ref,
                            gross_pence, discount_pence, charge_pence, tax_pence, tip_pence, total_pence, currency, external_updated_at)
    VALUES (${tenantId}, ${connectionId}, ${venueId}, ${documentId}, ${c.external_id}, ${c.number}, ${c.kind}, ${c.refund_for},
            ${c.business_date}, ${c.opened_at}, ${c.closed_at}, ${!!c.cancelled_at}, ${c.cancelled_at}, ${c.source}, ${c.order_type},
            ${c.device_ref}, ${c.employee_ref}, ${c.customer_ref}, ${c.location_ref},
            ${c.gross_pence}, ${c.discount_pence}, ${c.charge_pence}, ${c.tax_pence}, ${c.tip_pence}, ${c.total_pence}, ${currency}, ${c.external_updated_at})
    ON CONFLICT (connection_id, external_id) DO UPDATE SET
      venue_id = EXCLUDED.venue_id, document_id = EXCLUDED.document_id, number = EXCLUDED.number, kind = EXCLUDED.kind,
      refund_for_ref = EXCLUDED.refund_for_ref, business_date = EXCLUDED.business_date,
      opened_at = EXCLUDED.opened_at, closed_at = EXCLUDED.closed_at,
      cancelled = EXCLUDED.cancelled, cancelled_at = EXCLUDED.cancelled_at, source = EXCLUDED.source, order_type = EXCLUDED.order_type,
      device_ref = EXCLUDED.device_ref, employee_ref = EXCLUDED.employee_ref, customer_ref = EXCLUDED.customer_ref,
      location_ref = EXCLUDED.location_ref, gross_pence = EXCLUDED.gross_pence, discount_pence = EXCLUDED.discount_pence,
      charge_pence = EXCLUDED.charge_pence, tax_pence = EXCLUDED.tax_pence, tip_pence = EXCLUDED.tip_pence,
      total_pence = EXCLUDED.total_pence, currency = EXCLUDED.currency, external_updated_at = EXCLUDED.external_updated_at,
      updated_at = now()
    WHERE ext_checks.tenant_id = ${tenantId}
    RETURNING id
  `
  if (!row) throw new Error('ext_checks upsert found another tenant\'s row')
  const checkId = row.id

  await tx`DELETE FROM ext_check_payments  WHERE tenant_id = ${tenantId} AND check_id = ${checkId}`
  await tx`DELETE FROM ext_check_discounts WHERE tenant_id = ${tenantId} AND check_id = ${checkId}`
  await tx`DELETE FROM ext_check_taxes     WHERE tenant_id = ${tenantId} AND check_id = ${checkId}`
  await tx`DELETE FROM ext_check_lines     WHERE tenant_id = ${tenantId} AND check_id = ${checkId}`

  const lineIds = []
  for (const [i, l] of sale.lines.entries()) {
    const [ln] = await tx`
      INSERT INTO ext_check_lines (tenant_id, check_id, line_no, external_line_id, parent_line_id, line_kind,
                                   item_ref, variant_ref, option_ref, sku, name, variant_name, group_name, prefix,
                                   qty, unit_price_pence, gross_pence, discount_pence, tax_pence, net_pence, cost_pence, note)
      VALUES (${tenantId}, ${checkId}, ${i + 1}, ${l.external_line_id}, ${l.parent != null ? lineIds[l.parent] : null}, ${l.line_kind},
              ${l.item_ref}, ${l.variant_ref}, ${l.option_ref}, ${l.sku}, ${l.name}, ${l.variant_name}, ${l.group_name}, ${l.prefix},
              ${l.qty}, ${l.unit_price_pence}, ${l.gross_pence}, ${l.discount_pence}, ${l.tax_pence}, ${l.net_pence}, ${l.cost_pence}, ${l.note})
      RETURNING id`
    lineIds.push(ln.id)
  }
  for (const p of sale.payments) {
    await tx`
      INSERT INTO ext_check_payments (tenant_id, check_id, payment_type_ref, name, type, amount_pence, card_brand, paid_at)
      VALUES (${tenantId}, ${checkId}, ${p.payment_type_ref}, ${p.name}, ${p.type}, ${p.amount_pence}, ${p.card_brand}, ${p.paid_at})`
  }
  for (const x of sale.discounts) {
    await tx`
      INSERT INTO ext_check_discounts (tenant_id, check_id, line_id, discount_ref, name, type, percentage, amount_pence)
      VALUES (${tenantId}, ${checkId}, ${x.line != null ? lineIds[x.line] : null}, ${x.discount_ref}, ${x.name}, ${x.type}, ${x.percentage}, ${x.amount_pence})`
  }
  for (const t of sale.taxes) {
    await tx`
      INSERT INTO ext_check_taxes (tenant_id, check_id, line_id, tax_ref, name, type, rate, amount_pence)
      VALUES (${tenantId}, ${checkId}, ${t.line != null ? lineIds[t.line] : null}, ${t.tax_ref}, ${t.name}, ${t.type}, ${t.rate}, ${t.amount_pence})`
  }

  // Refunds and the sales they refund, whichever came in first.
  if (c.refund_for) {
    await tx`
      UPDATE ext_checks r SET refund_for_id = s.id
        FROM ext_checks s
       WHERE r.id = ${checkId} AND r.tenant_id = ${tenantId}
         AND s.tenant_id = ${tenantId} AND s.connection_id = ${connectionId} AND s.external_id = ${c.refund_for}`
  }
  await tx`
    UPDATE ext_checks SET refund_for_id = ${checkId}
     WHERE tenant_id = ${tenantId} AND connection_id = ${connectionId} AND refund_for_ref = ${c.external_id}
       AND refund_for_id IS DISTINCT FROM ${checkId}`
  return checkId
}

/** Master data documents into ext_catalog (connector catalogRows()). Returns how many rows. */
export async function saveCatalog(tx, { tenantId, connectionId, docs, catalogRows }) {
  let n = 0
  for (const d of docs) {
    for (const r of catalogRows(d)) {
      await tx`
        INSERT INTO ext_catalog (tenant_id, connection_id, kind, external_id, parent_ref, name, sku, price_pence, category_ref,
                                 attrs, deleted_at, external_updated_at)
        VALUES (${tenantId}, ${connectionId}, ${r.kind}, ${r.external_id}, ${r.parent_ref}, ${r.name}, ${r.sku}, ${r.price_pence},
                ${r.category_ref}, ${tx.json(r.attrs || {})}, ${r.deleted_at}, ${d.external_updated_at})
        ON CONFLICT (connection_id, kind, external_id) DO UPDATE SET
          parent_ref = EXCLUDED.parent_ref, name = EXCLUDED.name, sku = EXCLUDED.sku, price_pence = EXCLUDED.price_pence,
          category_ref = EXCLUDED.category_ref, attrs = EXCLUDED.attrs, deleted_at = EXCLUDED.deleted_at,
          external_updated_at = EXCLUDED.external_updated_at, updated_at = now()
        WHERE ext_catalog.tenant_id = ${tenantId}`
      n++
    }
  }
  return n
}

// ── Sync ────────────────────────────────────────────────────────────────────

// Each run stops starting new pages after this long; history carries on in
// the next run (queued straight away). The claim outlasts it.
export const RUN_BUDGET_MS = 4 * 60_000
const CLAIM_MINUTES = 10
// The catch-up reads back this far before its last high-water mark, so a
// receipt changed while the last run read is not missed.
const OVERLAP_MS = 5 * 60_000
// A first catch-up (before any history) starts this far back.
const FIRST_CATCH_UP_MS = 2 * 24 * 3600_000
// History is read in windows of this many days (one cursor each).
const HISTORY_WINDOW_DAYS = 31

const errorText = e => String(e?.message || e || 'Something went wrong').slice(0, 500)

/**
 * Queue a sync of this connection now. Fire and forget (rule 17). Asks
 * within the same 5 seconds are one job (BullMQ ignores a job id it already
 * has; an id may not hold a colon); a later ask, also one made from inside a
 * running sync once it has let go of the claim, is a job of its own (one that
 * finds the connection claimed skips, and the sweep catches what it asked).
 */
export function requestSync(tenantId, connectionId, log = null) {
  syncQueue.add('sync', { tenantId, connectionId }, {
    jobId: 'sync-' + connectionId + '-' + Math.floor(Date.now() / 5000), removeOnComplete: true, removeOnFail: 20,
  }).catch(err => log?.warn?.({ err: err?.message, connectionId }, 'Sales sync not queued (Redis?)'))
}

/** Mark a connection as wanting a sync (the job's next minute picks it up if the queue add is lost). */
export async function markRequested(tx, tenantId, connectionId) {
  await tx`UPDATE pos_connections SET sync_requested_at = now() WHERE id = ${connectionId} AND tenant_id = ${tenantId}`
}

/** A venue's history import, from HISTORY_MONTHS back to now. */
export async function startHistory(tx, tenantId, venueId) {
  await tx`
    UPDATE pos_connection_venues
       SET history_from = now() - make_interval(months => ${HISTORY_MONTHS}),
           history_to = now(),
           history_next_from = now() - make_interval(months => ${HISTORY_MONTHS}),
           history_cursor = NULL, history_count = 0, history_done_at = NULL, updated_at = now()
     WHERE tenant_id = ${tenantId} AND venue_id = ${venueId}`
}

/** A fresh webhook token: { token, hash, hint }. The token goes in the address only. */
export function newWebhookToken() {
  const token = randomBytes(24).toString('base64url')
  return { token, hash: loyverse.hashToken(token), hint: token.slice(-4) }
}

async function linkedVenues(tx, tenantId, connectionId) {
  return tx`
    SELECT l.venue_id, l.location_id, l.day_starts_at, v.timezone,
           l.history_from, l.history_to, l.history_next_from, l.history_cursor, l.history_count, l.history_done_at
      FROM pos_connection_venues l
      JOIN venues v ON v.id = l.venue_id AND v.tenant_id = l.tenant_id
     WHERE l.tenant_id = ${tenantId} AND l.connection_id = ${connectionId}`
}

/**
 * One page of sale documents: raw copies stored; for linked stores, the ones
 * that are new, changed or not yet normalised become checks, mapped to our
 * menus in the same transaction (the item mapping, `mc` =
 * itemMappingSvc.mappingContext()). Returns counts.
 */
async function savePage(tenantId, conn, mod, docs, byLocation, mc) {
  return withTenant(tenantId, async tx => {
    const changed = await storeDocuments(tx, { tenantId, connectionId: conn.id, docs })
    const changedIds = new Set(changed.map(d => d.external_id))
    const ids = docs.map(d => d.external_id)
    const have = new Set((await tx`
      SELECT external_id FROM ext_checks
       WHERE tenant_id = ${tenantId} AND connection_id = ${conn.id} AND external_id = ANY(${ids}::text[])`).map(r => r.external_id))
    const stored = new Map(changed.map(d => [d.external_id, d.id]))
    let checks = 0
    const saved = []
    for (const d of docs) {
      const venue = byLocation.get(d.payload.store_id)
      if (!venue) continue
      if (!changedIds.has(d.external_id) && have.has(d.external_id)) continue
      let documentId = stored.get(d.external_id)
      if (!documentId) {
        const [row] = await tx`SELECT id FROM ext_documents WHERE tenant_id = ${tenantId} AND connection_id = ${conn.id} AND kind = 'sale' AND external_id = ${d.external_id}`
        documentId = row?.id ?? null
      }
      saved.push(await saveSale(tx, { tenantId, connectionId: conn.id, venueId: venue.venue_id, documentId, currency: conn.currency, sale: mod.normalise(d, venue) }))
      checks++
    }
    await mapChecks(tx, tenantId, conn.id, saved, mc)
    return { docs: docs.length, changed: changed.length, checks }
  })
}

/**
 * Syncs one connection (historyPages: stop the history after that many pages,
 * for tests). Returns { skipped } when another process holds it or
 * it is paused, else its counts and `more` (history left for the next run);
 * on failure the error is kept on the connection and returned as `error`.
 */
export async function syncConnection(tenantId, connectionId, { log = null, budgetMs = RUN_BUDGET_MS, historyPages = Infinity } = {}) {
  const started = Date.now()
  const [conn] = await withTenant(tenantId, tx => tx`
    UPDATE pos_connections
       SET sync_claimed_until = now() + make_interval(mins => ${CLAIM_MINUTES}), last_sync_at = now()
     WHERE id = ${connectionId} AND tenant_id = ${tenantId} AND status <> 'paused'
       AND (sync_claimed_until IS NULL OR sync_claimed_until < now())
    RETURNING *, now() AS run_at`)
  if (!conn) return { skipped: 'busy or paused' }
  const mod = connectorFor(conn.system)
  const counts = { catalog: 0, sales: 0, checks: 0, history: 0 }
  let more = false
  try {
    if (!mod) throw new Error('No connector for ' + conn.system)
    const client = mod.connector({ token: unseal(conn.access_token) })
    const venues = await withTenant(tenantId, tx => linkedVenues(tx, tenantId, conn.id))
    const byLocation = new Map(venues.map(v => [v.location_id, v]))
    let pages = 0
    const outOfTime = () => Date.now() - started > budgetMs || pages >= historyPages

    // Master data: what changed since the last run (everything the first time).
    const catalogFrom = new Date()
    const catalogDocs = await client.fetchCatalog(conn.catalog_synced_to)
    await withTenant(tenantId, async tx => {
      const changed = await storeDocuments(tx, { tenantId, connectionId: conn.id, docs: catalogDocs })
      counts.catalog = await saveCatalog(tx, { tenantId, connectionId: conn.id, docs: changed, catalogRows: mod.catalogRows })
      await tx`UPDATE pos_connections SET catalog_synced_to = ${new Date(catalogFrom.getTime() - OVERLAP_MS)} WHERE id = ${conn.id} AND tenant_id = ${tenantId}`
    })
    // The item mapping's rules, catalogue and our prices, once for the run.
    const mc = await withTenant(tenantId, tx => mappingContext(tx, tenantId, conn.id))

    // Catch-up: receipts changed since the last high-water mark, every store.
    const salesTo = new Date(conn.run_at)
    const salesFrom = conn.sales_synced_to
      ? new Date(new Date(conn.sales_synced_to).getTime() - OVERLAP_MS)
      : new Date(salesTo.getTime() - FIRST_CATCH_UP_MS)
    let cursor = null
    do {
      const page = await client.fetchSales({ from: salesFrom, to: salesTo, by: 'updated', cursor })
      const r = await savePage(tenantId, conn, mod, page.docs, byLocation, mc)
      counts.sales += r.docs; counts.checks += r.checks
      cursor = page.cursor
    } while (cursor)
    await withTenant(tenantId, tx => tx`
      UPDATE pos_connections SET sales_synced_to = ${salesTo} WHERE id = ${conn.id} AND tenant_id = ${tenantId}`)

    // History: each linked venue's store, a window at a time, resumable.
    for (const v of venues) {
      if (!v.history_from || v.history_done_at) continue
      let next = new Date(v.history_next_from || v.history_from)
      const to = new Date(v.history_to)
      let pageCursor = v.history_cursor
      let count = v.history_count || 0
      while (next < to) {
        if (outOfTime()) { more = true; break }
        const end = new Date(Math.min(to.getTime(), next.getTime() + HISTORY_WINDOW_DAYS * 86400_000))
        const page = await client.fetchSales({ from: next, to: end, by: 'created', locationId: v.location_id, cursor: pageCursor })
        pages++
        const r = await savePage(tenantId, conn, mod, page.docs, byLocation, mc)
        counts.history += r.docs; counts.checks += r.checks; count += r.docs
        pageCursor = page.cursor
        if (!pageCursor) next = end
        const done = next >= to
        await withTenant(tenantId, tx => tx`
          UPDATE pos_connection_venues
             SET history_next_from = ${next}, history_cursor = ${pageCursor}, history_count = ${count},
                 history_done_at = ${done ? new Date() : null}
           WHERE tenant_id = ${tenantId} AND venue_id = ${v.venue_id} AND connection_id = ${conn.id}`)
      }
      if (more) break
    }

    const [after] = await withTenant(tenantId, tx => tx`
      UPDATE pos_connections
         SET last_sync_ok_at = now(), last_sync_error = NULL, status = 'active', last_sync_counts = ${tx.json(counts)},
             sync_claimed_until = NULL
       WHERE id = ${conn.id} AND tenant_id = ${tenantId}
      RETURNING sync_requested_at > ${conn.run_at} AS asked_again`)
    if (more || after?.asked_again) requestSync(tenantId, conn.id, log)
    return { ...counts, more }
  } catch (e) {
    const message = errorText(e)
    log?.warn?.({ err: message, connectionId: conn.id }, 'Sales sync failed')
    await withTenant(tenantId, tx => tx`
      UPDATE pos_connections
         SET last_sync_error = ${message}, sync_claimed_until = NULL,
             status = ${e?.tokenProblem ? 'error' : conn.status},
             last_sync_counts = ${tx.json(counts)}
       WHERE id = ${conn.id} AND tenant_id = ${tenantId}`).catch(() => {})
    return { ...counts, error: message }
  }
}

/**
 * The sync job (every minute): each connection whose catch-up is due, that
 * was asked for since its last run, or has history left, synced in turn.
 * System mode only finds them; each sync runs as its tenant. Also clears
 * old raw copies. Returns how many connections ran.
 */
export async function sweepDue(log = null) {
  const due = await systemSql`
    SELECT c.id, c.tenant_id FROM pos_connections c
     WHERE c.status <> 'paused'
       AND (c.sync_claimed_until IS NULL OR c.sync_claimed_until < now())
       AND (c.last_sync_at IS NULL
            OR c.last_sync_at < now() - make_interval(mins => ${CATCH_UP_MINUTES})
            OR c.sync_requested_at > c.last_sync_at
            OR EXISTS (SELECT 1 FROM pos_connection_venues l
                        WHERE l.connection_id = c.id AND l.tenant_id = c.tenant_id
                          AND l.history_from IS NOT NULL AND l.history_done_at IS NULL))
     ORDER BY c.last_sync_at NULLS FIRST
     LIMIT 50`
  let ran = 0
  for (const c of due) {
    const r = await syncConnection(c.tenant_id, c.id, { log })
    if (!r.skipped) ran++
  }
  await sweepRawDocuments().catch(err => log?.warn?.({ err: err?.message }, 'Raw sales copies not cleared'))
  // Re-maps asked for by a rule change whose queued job was lost.
  ran += await sweepRemaps(log).catch(err => { log?.warn?.({ err: err?.message }, 'Item re-maps not run'); return 0 })
  return ran
}

// ── Webhook ─────────────────────────────────────────────────────────────────

export const webhookUrl = (system, token) => officeOrigin() + '/webhooks/' + system + '/' + token

/**
 * A new webhook address for a connection: a fresh token (its sha256 stored,
 * the address returned this once), registered with the other till when its
 * API allows (the old registration removed first). Returns { url, registered,
 * error }. Called from requests: the other till is asked at most twice.
 */
export async function setupWebhook(tenantId, connectionId) {
  const conn = await withTenant(tenantId, async tx => {
    const [c] = await tx`SELECT * FROM pos_connections WHERE id = ${connectionId} AND tenant_id = ${tenantId}`
    return c
  })
  if (!conn) return null
  const mod = connectorFor(conn.system)
  const { token, hash, hint } = newWebhookToken()
  const url = webhookUrl(conn.system, token)
  let webhookId = null, error = null
  if (mod) {
    const client = mod.connector({ token: unseal(conn.access_token) })
    if (conn.webhook_id) await client.deleteWebhook(conn.webhook_id).catch(() => {})
    try { webhookId = (await client.registerWebhook(url)).id } catch (e) { error = errorText(e) }
  }
  await withTenant(tenantId, tx => tx`
    UPDATE pos_connections
       SET webhook_token_hash = ${hash}, webhook_token_hint = ${hint}, webhook_id = ${webhookId}, updated_at = now()
     WHERE id = ${connectionId} AND tenant_id = ${tenantId}`)
  return { url, registered: !!webhookId, error }
}

/**
 * The webhook: the token in the address finds the connection (system mode:
 * the token is how the tenant is found), checked in constant time. The body
 * is never read: the call only asks for a sync, which reads the other till
 * with our own token. Returns true when a sync was asked for.
 */
export async function webhookPoke(system, token, log = null) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(String(token || ''))) return false
  const mod = connectorFor(system)
  if (!mod) return false
  const [c] = await systemSql`
    SELECT id, tenant_id, webhook_token_hash FROM pos_connections
     WHERE system = ${system} AND webhook_token_hash = ${mod.hashToken(token)}`
  if (!c || !mod.verifyWebhook({ token, storedHash: c.webhook_token_hash })) return false
  await withTenant(c.tenant_id, tx => tx`
    UPDATE pos_connections SET sync_requested_at = now(), webhook_last_at = now()
     WHERE id = ${c.id} AND tenant_id = ${c.tenant_id}`)
  requestSync(c.tenant_id, c.id, log)
  return true
}
