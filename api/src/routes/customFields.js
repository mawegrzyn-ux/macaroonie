// src/routes/customFields.js
//
// A group's own fields (Pepper-first step 8B1, migration 285), mounted at
// /api/custom-fields. Definitions only: the values are written by each
// object's own routes (`custom` on its POST and PATCH), checked against these
// with shared/customFields.js.
//
//   GET    /?object=<key>   the definitions the person may see: View on each
//                           object's module (shared/customFields.js
//                           CUSTOM_OBJECTS); with object, that one only
//   POST   /                { object_key, label, type, options?, required?, help? }
//   PATCH  /:id             { label?, options?, required?, help? } (the type
//                           and key never change: values are stored by key)
//   DELETE /:id             the definition, and its value on every row
//
// Changes need Manage on the object's module. At most MAX_FIELDS per object.

import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, permissionLevels } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { permissionAtLeast } from '../config/modules.js'
import {
  CUSTOM_OBJECTS, CUSTOM_OBJECT_KEYS, CUSTOM_TYPES, MAX_FIELDS, fieldKeyOf, definitionProblem,
} from '../../../shared/customFields.js'
import { OBJECTS } from '../../../shared/registry/index.js'
import { loadDefinitions, tableOf } from '../services/customFields.js'

const NewBody = z.object({
  object_key: z.enum(CUSTOM_OBJECT_KEYS),
  label:      z.string().trim().min(1).max(60),
  type:       z.enum(CUSTOM_TYPES),
  options:    z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  required:   z.boolean().optional(),
  help:       z.string().trim().max(200).nullable().optional(),
})
const PatchBody = NewBody.pick({ label: true, options: true, required: true, help: true }).partial()

async function levelsOf(req) {
  return permissionLevels(req, [...new Set(Object.values(CUSTOM_OBJECTS).map(o => o.module))])
}

async function mayManage(req, objectKey) {
  const levels = await levelsOf(req)
  if (!permissionAtLeast(levels[CUSTOM_OBJECTS[objectKey].module], 'manage')) {
    throw httpError(403, 'Setting up fields on ' + OBJECTS[objectKey].plural.toLowerCase() + ' needs Manage on that area.')
  }
}

function problemOrThrow(def) {
  const p = definitionProblem(def)
  if (p) throw httpError(422, p)
}

export default async function customFieldRoutes(app) {
  app.addHook('preHandler', requireAuth)

  app.get('/', async req => {
    const want = typeof req.query?.object === 'string' ? req.query.object : null
    if (want && !CUSTOM_OBJECTS[want]) throw httpError(404, 'Those don\'t take fields of your own')
    const levels = await levelsOf(req)
    const objects = CUSTOM_OBJECT_KEYS
      .filter(k => !want || k === want)
      .filter(k => permissionAtLeast(levels[CUSTOM_OBJECTS[k].module], 'view'))
    if (want && !objects.length) throw httpError(403, 'You don\'t have access to ' + OBJECTS[want].plural.toLowerCase() + '.')
    const rows = await withTenant(req.tenantId, tx => loadDefinitions(tx, req.tenantId, want))
    return {
      objects: objects.map(k => ({
        key: k, label: OBJECTS[k].label, plural: OBJECTS[k].plural,
        can_manage: permissionAtLeast(levels[CUSTOM_OBJECTS[k].module], 'manage'),
      })),
      fields: rows.filter(r => objects.includes(r.object_key)),
      max: MAX_FIELDS,
    }
  })

  app.post('/', async (req, reply) => {
    const b = NewBody.parse(req.body || {})
    await mayManage(req, b.object_key)
    const field_key = fieldKeyOf(b.label)
    problemOrThrow({ ...b, field_key })
    const row = await withTenant(req.tenantId, async tx => {
      // One at a time per object, so two saves can't both pass the count or the key.
      await tx`SELECT pg_advisory_xact_lock(hashtext(${'custom_fields:' + req.tenantId + ':' + b.object_key}))`
      const have = await loadDefinitions(tx, req.tenantId, b.object_key)
      if (have.length >= MAX_FIELDS) throw httpError(422, 'At most ' + MAX_FIELDS + ' fields of your own on ' + OBJECTS[b.object_key].plural.toLowerCase())
      if (have.some(d => d.label.toLowerCase() === b.label.toLowerCase())) throw httpError(409, 'There is already a field called ' + b.label)
      // A key in use (a field since renamed) gets a number.
      let key = field_key
      for (let n = 2; have.some(d => d.field_key === key); n++) key = (field_key.slice(0, 36) + '_' + n)
      const [r] = await tx`
        INSERT INTO custom_fields (tenant_id, object_key, field_key, label, type, options, required, help)
        VALUES (${req.tenantId}, ${b.object_key}, ${key}, ${b.label}, ${b.type},
                ${b.type === 'choice' ? b.options : []}::text[], ${!!b.required}, ${b.help || null})
        RETURNING id, object_key, field_key, label, type, options, required, help, created_at, updated_at`
      return r
    })
    return reply.code(201).send(row)
  })

  app.patch('/:id', async req => {
    const b = PatchBody.parse(req.body || {})
    return withTenant(req.tenantId, async tx => {
      const [d] = await tx`SELECT * FROM custom_fields WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}`
      if (!d) throw httpError(404, 'Field not found')
      await mayManage(req, d.object_key)
      const next = {
        label: b.label ?? d.label,
        type: d.type,
        options: d.type === 'choice' ? (b.options ?? d.options) : [],
        required: b.required ?? d.required,
        help: b.help === undefined ? d.help : (b.help || null),
      }
      if (b.options && d.type !== 'choice') throw httpError(422, 'Only one of a list has choices')
      problemOrThrow(next)
      if (next.label.toLowerCase() !== d.label.toLowerCase()) {
        const [clash] = await tx`SELECT 1 FROM custom_fields WHERE tenant_id = ${req.tenantId} AND object_key = ${d.object_key}
                                    AND lower(label) = ${next.label.toLowerCase()} AND id <> ${d.id}`
        if (clash) throw httpError(409, 'There is already a field called ' + next.label)
      }
      const [r] = await tx`
        UPDATE custom_fields SET label = ${next.label}, options = ${next.options}::text[], required = ${next.required},
               help = ${next.help}, updated_at = now()
         WHERE id = ${d.id} AND tenant_id = ${req.tenantId}
        RETURNING id, object_key, field_key, label, type, options, required, help, created_at, updated_at`
      return r
    })
  })

  // The field and every row's value for it: nothing is left behind under a key nobody defines.
  app.delete('/:id', async req => withTenant(req.tenantId, async tx => {
    const [d] = await tx`SELECT * FROM custom_fields WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}`
    if (!d) throw httpError(404, 'Field not found')
    await mayManage(req, d.object_key)
    const table = tableOf(d.object_key)
    await tx`UPDATE ${tx(table)} SET custom = custom - ${d.field_key}::text WHERE tenant_id = ${req.tenantId} AND custom ? ${d.field_key}`
    await tx`DELETE FROM custom_fields WHERE id = ${d.id} AND tenant_id = ${req.tenantId}`
    return { ok: true }
  }))
}
