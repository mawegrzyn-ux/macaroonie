// shared/catalogue.js
//
// Menus as catalogues (migration 267, docs/CATALOGUE.md): what a sold item
// is, and what that switches on or off. The one implementation (rule 12):
// the API, the admin, the till, kiosks and the website all ask here.
//
//   ITEM_TYPES                 ['food', 'goods', 'service']
//   itemType(item, section, menu)
//       the item's own type, else its section's, else its menu's, else
//       'food' (menus made before migration 267, and releases published
//       before it, carry no type: they are food)
//   cleanItemType(value)       a stored value: one of ITEM_TYPES or null
//   typeSwitches(type)         what the type turns on (TYPE_SWITCHES)
//   needsAllergens(type)       allergens, diet tags and calories apply
//   showsInKitchen(type)       goes to kitchen screens and tickets by default
//   resolveItemTypes(menu)     what guests and devices read (step 2): every
//       item's item_type set to its resolved type, and an item that isn't
//       food served with no allergens, diet tags or calories (the draft keeps
//       them). Mutates and returns the menu: call it on a copy.
//   isFoodItem(item)           an item from a resolved menu is food
//   cleanSku(v) / cleanBarcode(v)   a product code or barcode as stored, or null
//   barcodeProblem(code)       why a barcode isn't a GTIN-8, 12, 13 or 14 with
//                              a right check digit, or null
//   codeProblems(menu)         the first few problems with a menu's codes:
//                              bad barcodes, and a code used twice in one menu
//   codeIndex(items)           code (barcode, or product code in lower case)
//                              -> { item_id, option_id, group_id }, for a scan
//
// A combo's type is its own (a meal deal of food is food; a gift bundle is
// goods). Nothing is deleted when a type changes: hidden fields keep their
// values, so switching back loses nothing.

export const ITEM_TYPES = ['food', 'goods', 'service']

export const TYPE_LABELS = { food: 'Food and drink', goods: 'Retail goods', service: 'Services' }

// What each type switches (docs/CATALOGUE.md 4.2). Steps 2 to 6 read these;
// step 1 (the editor) hides the allergen, diet and calorie fields by them.
export const TYPE_SWITCHES = {
  food:    { allergens: true,  calories: true,  kitchen: true,  codes: 'optional', duration: false },
  goods:   { allergens: false, calories: false, kitchen: false, codes: 'yes',      duration: false },
  service: { allergens: false, calories: false, kitchen: false, codes: 'optional', duration: true },
}

export function cleanItemType(value) {
  return ITEM_TYPES.includes(value) ? value : null
}

export function itemType(item, section, menu) {
  return cleanItemType(item?.item_type) || cleanItemType(section?.item_type) || cleanItemType(menu?.item_type) || 'food'
}

export const typeSwitches = type => TYPE_SWITCHES[cleanItemType(type) || 'food']
export const needsAllergens = type => typeSwitches(type).allergens
export const showsInKitchen = type => typeSwitches(type).kitchen

export function resolveItemTypes(menu) {
  if (!menu) return menu
  for (const section of menu.sections || []) {
    for (const item of section.items || []) {
      item.item_type = itemType(item, section, menu)
      if (!needsAllergens(item.item_type)) {
        item.dietary = []
        item.allergen_levels = {}
        item.calories = null
      }
    }
  }
  return menu
}

export const isFoodItem = item => needsAllergens(itemType(item))

// ── Codes (migration 268, step 4) ─────────────────────────────

export function cleanSku(v) {
  const t = typeof v === 'string' ? v.trim() : ''
  return t ? t.slice(0, 40) : null
}

export function cleanBarcode(v) {
  const t = typeof v === 'string' || typeof v === 'number' ? String(v).replace(/\s+/g, '') : ''
  return t || null
}

/** GTIN check digit: from the right, odd places weigh 3, even 1. */
export function barcodeProblem(code) {
  const c = cleanBarcode(code)
  if (!c) return null
  if (!/^[0-9]+$/.test(c)) return 'A barcode has digits only'
  if (![8, 12, 13, 14].includes(c.length)) return 'A barcode has 8, 12, 13 or 14 digits'
  const digits = c.split('').map(Number)
  const check = digits.pop()
  let sum = 0
  digits.reverse().forEach((d, i) => { sum += d * (i % 2 === 0 ? 3 : 1) })
  return (10 - (sum % 10)) % 10 === check ? null : 'The barcode\'s last digit doesn\'t match (check digit)'
}

function codesOf(menu) {
  const out = []
  for (const s of menu?.sections || []) {
    for (const it of s.items || []) {
      const name = it.name || 'A dish'
      if (cleanSku(it.sku)) out.push({ kind: 'product code', code: cleanSku(it.sku).toLowerCase(), shown: cleanSku(it.sku), where: name })
      if (cleanBarcode(it.barcode)) out.push({ kind: 'barcode', code: cleanBarcode(it.barcode), shown: cleanBarcode(it.barcode), where: name })
      for (const oc of it.option_codes || []) {
        const where = name + ' (an option)'
        if (cleanSku(oc.sku)) out.push({ kind: 'product code', code: cleanSku(oc.sku).toLowerCase(), shown: cleanSku(oc.sku), where })
        if (cleanBarcode(oc.barcode)) out.push({ kind: 'barcode', code: cleanBarcode(oc.barcode), shown: cleanBarcode(oc.barcode), where })
      }
    }
  }
  return out
}

export function codeProblems(menu, max = 5) {
  const problems = []
  const seen = new Map()
  for (const c of codesOf(menu)) {
    if (problems.length >= max) break
    if (c.kind === 'barcode') {
      const p = barcodeProblem(c.code)
      if (p) { problems.push(c.where + ': ' + p); continue }
    }
    const key = c.kind + ':' + c.code
    if (seen.has(key)) problems.push('The ' + c.kind + ' ' + c.shown + ' is on ' + seen.get(key) + ' and ' + c.where + ': each one is used once in a menu')
    else seen.set(key, c.where)
  }
  return problems
}

/** For a scan at the till: items as the till has them (variant_groups with options). */
export function codeIndex(items) {
  const index = new Map()
  const add = (code, hit) => { if (code && !index.has(code)) index.set(code, hit) }
  for (const it of items || []) {
    const hit = { item_id: it.id, option_id: null, group_id: null }
    add(cleanBarcode(it.barcode), hit)
    add(cleanSku(it.sku)?.toLowerCase(), hit)
    for (const oc of it.option_codes || []) {
      const g = (it.variant_groups || []).find(x => (x.options || []).some(o => (o.option_id ?? o.id) === oc.option_id))
      const h = { item_id: it.id, option_id: oc.option_id, group_id: g ? (g.group_id ?? g.id) : null }
      add(cleanBarcode(oc.barcode), h)
      add(cleanSku(oc.sku)?.toLowerCase(), h)
    }
  }
  return index
}

/** What a scanned code finds: { item_id, option_id, group_id } or null. */
export function findByCode(index, code) {
  const c = String(code || '').trim()
  if (!c) return null
  return index.get(c.replace(/\s+/g, '')) || index.get(c.toLowerCase()) || null
}

