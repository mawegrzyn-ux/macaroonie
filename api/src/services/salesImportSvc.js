// src/services/salesImportSvc.js
//
// Sales from other tills, phase 1 (docs/SALES_IMPORT.md, migrations 288 to
// 290): what a connector reads is stored raw (ext_documents), then
// normalised into one shape for every system (ext_checks and its lines,
// payments, discounts and taxes; ext_catalog for master data).
//
//   storeDocuments(tx, ...)   upsert raw copies; returns the ones that changed
//   RAW_KEEP_DAYS             how long a raw copy is kept after its last fetch

import { createHash } from 'node:crypto'
import { systemSql } from '../config/db.js'
import { stableJson } from '../../../shared/externalSales.js'

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
