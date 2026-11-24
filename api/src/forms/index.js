// src/forms/index.js
//
// The plain forms (Pepper-first step 8A3): flat set-up forms drawn by one
// renderer from the schema their route validates with. Each area keeps its
// own in src/forms/<area>.js, listed in files.js; plain.js holds the helpers.
// Each form is also a form of shared/forms.js (plain: true), so the sheet and
// Pepper's open_form know it; its fields are only ever the ones listed here.
//
//   PLAIN_FORMS            { key: definition }
//   plainForm(key)         one, or null
//   plainFields(key)       its field list (fieldList()), for the route and Pepper

import { FILES } from './files.js'
import { fieldList } from './plain.js'
import { FORMS } from '../../../shared/forms.js'

export const PLAIN_FORMS = {}
for (const [area, mod] of FILES) {
  for (const [key, def] of Object.entries(mod.forms || {})) {
    if (PLAIN_FORMS[key]) throw new Error('Two areas have a plain form called ' + key)
    if (!FORMS[key]?.plain) throw new Error('Plain form ' + key + ' (' + area + ') needs plain: true in shared/forms.js')
    if (!['POST', 'PUT', 'PATCH'].includes(def.save?.method) || !/^\/[a-z0-9/:_-]+$/.test(def.save?.path || '')) {
      throw new Error('Plain form ' + key + ': save is { method, path }')
    }
    PLAIN_FORMS[key] = { ...def, area }
    fieldList(key, PLAIN_FORMS[key])   // checked at start-up: a field that isn't flat stops it
  }
}
for (const [key, f] of Object.entries(FORMS)) {
  if (f.plain && !PLAIN_FORMS[key]) throw new Error('shared/forms.js says ' + key + ' is plain, but no area defines it (src/forms/)')
}

export const plainForm = key => PLAIN_FORMS[key] || null
export const plainFields = key => (PLAIN_FORMS[key] ? fieldList(key, PLAIN_FORMS[key]) : null)
