// src/services/customFields.js
//
// A group's own fields on customers, staff members, suppliers and inventory
// items (Pepper-first step 8B1, migration 285). The rules are
// shared/customFields.js; this file reads the definitions and writes values
// onto an object's row, for the four objects' routes, the plain forms, the
// report catalogue and Pepper's tools.
//
//   CustomInput                 the zod schema of a request's `custom` (any
//                               route of the four objects): { key: value }
//   loadDefinitions(tx, tenantId, objectKey?)   the group's definitions,
//                               oldest first (one object, or all)
//   definitionsFor(tenantId)    every definition, by object (its own
//                               transaction): { object_key: [def] }
//   customValues(tx, tenantId, objectKey, raw, { create, byLabel })
//                               raw checked against the definitions; throws
//                               a 422 naming each problem. -> { field: value | null }.
//                               No raw: nothing (a row made where they aren't
//                               drawn starts without; `create` then asks
//                               nothing). With raw and `create`, every
//                               required field is needed
//   writeCustom(tx, tenantId, objectKey, id, values)
//                               the values onto the row (null takes a field off)
//   customLines(defs, custom)   [{ label, text }] of the fields a row has

import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { httpError } from '../middleware/error.js'
import { CUSTOM_OBJECTS, checkValues, valueText, MAX_TEXT } from '../../../shared/customFields.js'
import { OBJECTS } from '../../../shared/registry/index.js'

export const CustomInput = z.record(
  z.string().trim().min(1).max(60),
  z.union([z.string().max(MAX_TEXT + 100), z.number(), z.boolean(), z.null()]),
).refine(o => Object.keys(o).length <= 40, 'Too many fields')

/** The table an object's rows live in: the registry's record, never a copy. */
export function tableOf(objectKey) {
  if (!CUSTOM_OBJECTS[objectKey]) throw new Error('No custom fields on ' + objectKey)
  return OBJECTS[objectKey].table
}

const COLS = tx => tx`id, object_key, field_key, label, type, options, required, help, created_at, updated_at`

export function loadDefinitions(tx, tenantId, objectKey = null) {
  return tx`
    SELECT ${COLS(tx)} FROM custom_fields
     WHERE tenant_id = ${tenantId} ${objectKey ? tx`AND object_key = ${objectKey}` : tx``}
     ORDER BY object_key, created_at, id`
}

export async function definitionsFor(tenantId) {
  const rows = await withTenant(tenantId, tx => loadDefinitions(tx, tenantId))
  const out = {}
  for (const r of rows) (out[r.object_key] ??= []).push(r)
  return out
}

export async function customValues(tx, tenantId, objectKey, raw, { create = false, byLabel = false } = {}) {
  // Rows made without them (a booking's guest, an import, a page that doesn't
  // draw them) start without: a required field is required of a form that
  // draws the group's fields, which always sends `custom`.
  if (raw == null) return {}
  const defs = await loadDefinitions(tx, tenantId, objectKey)
  const { values, problems } = checkValues(defs, raw || {}, { create, byLabel })
  if (problems.length) throw httpError(422, 'Your own fields: ' + problems.join('; '), { code: 'custom_fields', problems })
  return values
}

export async function writeCustom(tx, tenantId, objectKey, id, values) {
  const keys = Object.keys(values || {})
  if (!keys.length) return
  const set = Object.fromEntries(keys.filter(k => values[k] !== null).map(k => [k, values[k]]))
  const off = keys.filter(k => values[k] === null)
  const table = tableOf(objectKey)
  await tx`
    UPDATE ${tx(table)} SET custom = (custom || ${tx.json(set)}::jsonb) - ${off}::text[]
     WHERE id = ${id} AND tenant_id = ${tenantId}`
}

export function customLines(defs, custom) {
  return (defs || [])
    .filter(d => custom && custom[d.field_key] !== undefined && custom[d.field_key] !== null)
    .map(d => ({ label: d.label, text: valueText(d, custom[d.field_key]) }))
}
