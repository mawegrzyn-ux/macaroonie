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
// list: nothing in it depends on anything else.

import { requireAuth, permissionLevel } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { permissionAtLeast } from '../config/modules.js'
import { FORMS } from '../../../shared/forms.js'
import { PLAIN_FORMS, plainFields } from '../forms/index.js'

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
      fields: plainFields(req.params.key),
      save: def.save,
      attach: def.attach || null,
      from: def.from || {},
      saved: def.saved || null,
    }
  })
}
