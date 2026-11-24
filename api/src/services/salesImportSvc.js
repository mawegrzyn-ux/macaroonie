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
