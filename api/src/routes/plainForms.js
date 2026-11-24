// src/routes/plainForms.js
//
// The plain forms' fields (Pepper-first step 8A3), mounted at /api/forms:
// a flat set-up form (shared/forms.js plain: true) is drawn by the admin's
// PlainForm from the field list its route's own schema gives
// (src/forms/plain.js fieldList()), so the form, Pepper's open_form and the
// route can't disagree about a field or its rules. Saving goes through the
// form's own route, never through here.
//
//   GET /:key   -> { key, title, by, read_only, fields, save, attach, from, saved }
//
// View on the form's module; below its `edit` level the form is read only
// (the route refuses a save anyway). The same schema and role give the same
// list, with the group's own fields on the form's object after them
// (Pepper-first step 8B1: their definitions, shared/customFields.js).

import { requireAuth, permissionLevel } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { permissionAtLeast } from '../config/modules.js'
import { FORMS } from '../../../shared/forms.js'
import { PLAIN_FORMS, plainFields, customObjectOf } from '../forms/index.js'
import { customFieldList } from '../forms/plain.js'
import { withTenant } from '../config/db.js'
import { loadDefinitions } from '../services/customFields.js'

async function customDefs(req) {
  const object = customObjectOf(req.params.key)
  return object ? withTenant(req.tenantId, tx => loadDefinitions(tx, req.tenantId, object)) : []
}

export default async function plainFormRoutes(app) {
  app.addHook('preHandler', requireAuth)

  app.get('/:key', async req => {
    const def = PLAIN_FORMS[req.params.key]
    if (!def) throw httpError(404, 'No such form')
    const meta = FORMS[req.params.key]
    const level = await permissionLevel(req, meta.module)
    if (!permissionAtLeast(level, 'view')) throw httpError(403, 'You don\'t have access to this form.')
    return {
      key: req.params.key,
      title: meta.title,
      by: meta.by,
      read_only: !permissionAtLeast(level, meta.edit),
      // The route's own fields, then the group's own (migration 285) on the object it adds.
      fields: [...plainFields(req.params.key), ...customFieldList(await customDefs(req))],
      save: def.save,
      attach: def.attach || null,
      from: def.from || {},
      saved: def.saved || null,
    }
  })
}
