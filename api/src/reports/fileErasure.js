// src/reports/fileErasure.js
//
// Kept report files (report_files, migration 250) taken off when people's
// details are erased (GDPR: a customer anonymised, a loyalty member erased).
//
// Kept apart from files.js on purpose: the erasure routes are reached from
// the report catalogue's own imports (catalogue/online.js -> onlineSalesSvc
// -> orderSvc -> routes/customers.js), and files.js imports the report
// engine (run.js -> work/index.js), which needs the catalogue loaded first.
// Imported from files.js, the catalogue could no longer be loaded on its
// own. This file imports nothing of the engine: keep it that way.
//
//   forgetPersonalFiles(tx, tenantId)
//                     inside an erasure's transaction: every live file of
//                     the group holding people's details taken off; their
//                     keys back
//   removeStored(keys)
//                     those files from the store, once the erasure has
//                     committed

import { remove } from '../services/privateStore.js'

/**
 * Every live file of the group that holds people's details is taken off now,
 * inside the erasing transaction, rather than when its time is up, since any
 * of them may name that person. Run the reports again for new ones. Returns
 * the files' keys: remove them from the store with removeStored() once the
 * transaction has committed (a rollback must leave them where they are).
 */
export async function forgetPersonalFiles(tx, tenantId) {
  const rows = await tx`
    UPDATE report_files SET removed_at = now(), spec = NULL, levels = NULL
     WHERE tenant_id = ${tenantId} AND personal AND removed_at IS NULL
     RETURNING storage_key`
  return rows.map(r => r.storage_key)
}

/** Files taken off in a transaction, from the store once it has committed. */
export async function removeStored(keys) {
  for (const key of keys || []) await remove(key).catch(() => {})
}
