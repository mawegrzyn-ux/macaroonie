// Menu tags (migration 145): every tag is either a dietary tag (vegan,
// gluten-free, spicy...) or an allergen. A dish has a dietary tag or not;
// an allergen has a level per dish:
//   contains     the dish has it
//   may_contain  it may be present (cross-contact)
//   removable    the dish has it but can be made without it
// (no row = the dish doesn't have it). On menus all three show the same
// badge; "removable" gets a small asterisk, explained by the allergen
// notice's removable_note (REMOVABLE_NOTE by default).
//
// Dishes carry `dietary` (codes of every tag they show, both kinds) and
// `allergen_levels` ({ code: level }, only for levels other than contains).
// Used by the API (seeding), shared/menuLayout.js and the admin.

export const ALLERGEN_LEVELS = ['contains', 'may_contain', 'removable']

export const LEVEL_LABELS = {
  contains:    'Contains',
  may_contain: 'May contain',
  removable:   'Can be removed',
}

export const REMOVABLE_NOTE = 'Can be removed on request'

// The 14 allergens UK law requires food businesses to declare.
// `key` is stored as menu_dietary_tags.standard_key (one tag per key per
// tenant) and is also the code a new tag gets.
export const STANDARD_ALLERGENS = [
  { key: 'celery',      label: 'Celery',      glyph: 'Ce', colour: '#4d7c0f' },
  { key: 'gluten',      label: 'Gluten',      glyph: 'Gl', colour: '#a16207' },
  { key: 'crustaceans', label: 'Crustaceans', glyph: 'Cr', colour: '#b91c1c' },
  { key: 'eggs',        label: 'Eggs',        glyph: 'E',  colour: '#ca8a04' },
  { key: 'fish',        label: 'Fish',        glyph: 'F',  colour: '#1d4ed8' },
  { key: 'lupin',       label: 'Lupin',       glyph: 'L',  colour: '#7c3aed' },
  { key: 'milk',        label: 'Milk',        glyph: 'Mi', colour: '#0369a1' },
  { key: 'molluscs',    label: 'Molluscs',    glyph: 'Mo', colour: '#0f766e' },
  { key: 'mustard',     label: 'Mustard',     glyph: 'Mu', colour: '#b45309' },
  { key: 'nuts',        label: 'Nuts',        glyph: 'N',  colour: '#9a3412' },
  { key: 'peanuts',     label: 'Peanuts',     glyph: 'P',  colour: '#92400e' },
  { key: 'sesame',      label: 'Sesame',      glyph: 'Se', colour: '#57534e' },
  { key: 'soya',        label: 'Soya',        glyph: 'So', colour: '#15803d' },
  { key: 'sulphites',   label: 'Sulphites',   glyph: 'Su', colour: '#6d28d9' },
]

/** A dish's level for a tag code: 'contains' | 'may_contain' | 'removable' | null. */
export function levelOf(item, code) {
  if (!(item?.dietary || []).includes(code)) return null
  return (item.allergen_levels || {})[code] || 'contains'
}

export function isRemovable(item, code) {
  return (item?.allergen_levels || {})[code] === 'removable'
}

/** Tags guests see: a tag with show_on_menu off (migration 146) stays in
 *  the Allergen matrix and lookup only. Renderers look dishes' codes up in
 *  this list and skip codes that aren't in it. */
export function menuTags(tags) {
  return (tags || []).filter(t => t.show_on_menu !== false)
}

/** Whether a dish shows a removable allergen among these (shown) tags. */
export function hasRemovable(item, tags) {
  const levels = item?.allergen_levels || {}
  return (tags || []).some(t => levels[t.code] === 'removable')
}

// The allergen notice (migration 147, one per tenant, built on Menus >
// Allergens & dietary). Loaders send the stored row; renderers read it
// through noticeOf() so a tenant without one gets these words.
export const DEFAULT_NOTICE = {
  title:          'Allergies & Diet',
  body:           'Please tell us about any allergies or dietary needs before you order.',
  removable_note: REMOVABLE_NOTE,
  ordering_text:  'Use the allergy note at checkout to tell us what we need to know.',
  used_only:      true,
}

export function noticeOf(notice) {
  const n = notice || {}
  return {
    title:          typeof n.title === 'string' ? n.title : DEFAULT_NOTICE.title,
    body:           typeof n.body === 'string' ? n.body : DEFAULT_NOTICE.body,
    removable_note: (n.removable_note || '').trim() || DEFAULT_NOTICE.removable_note,
    ordering_text:  typeof n.ordering_text === 'string' ? n.ordering_text : DEFAULT_NOTICE.ordering_text,
    used_only:      n.used_only !== false,
  }
}

/** The notice's key for these sections: its words plus the tags to list,
 *  in the tags' own order. A tag is listed when it shows on menus, is
 *  ticked for the key (in_key) and, with used_only, a dish here uses it.
 *  `removable` = a dish here shows a removable allergen, so the key
 *  explains the asterisk (whatever the key lists, since the asterisk is
 *  on the dish). */
export function allergenKey(tags, sections, notice) {
  const n = noticeOf(notice)
  const shown = menuTags(tags)
  const used = new Set()
  let removable = false
  for (const s of sections || []) {
    for (const it of s.items || []) {
      for (const c of it.dietary || []) used.add(c)
      if (hasRemovable(it, shown)) removable = true
    }
  }
  return {
    ...n,
    tags: shown.filter(t => t.in_key !== false && (!n.used_only || used.has(t.code))),
    removable,
  }
}
