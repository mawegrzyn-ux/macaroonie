// What on a till check clashes with the order's allergy flag
// (shared/pos/allergy.js): the dishes' tags (menu_dietary_tags codes, with
// their levels) against the flag's allergens and diets, read the way the
// kiosk reads a guest's picks (dishLevels() / mergeLevels() in
// shared/kiosk.js). A meal deal line counts the dishes picked in it.
//
// lineClash(config, line, allergy) -> null (suits, nothing known, or no
//   flag) | { avoid: [{ code, level }], removable: [code], missing: [code] }
//   avoid: an allergen the dish has (contains / may contain),
//   removable: one it has that can be left out on request,
//   missing: a diet the dish isn't (a meal deal keeps to a diet when every
//   dish in it does, or the deal itself is tagged with it).
// clashWords(clash, allergy) -> ['Contains Milk', 'May contain Peanuts', 'Not Vegan', ...]

import { dishLevels, mergeLevels } from '@shared/kiosk.js'
import { allergyOn, allergyPrefs } from '@shared/pos/allergy.js'

export function lineClash(config, line, allergy) {
  if (!allergyOn(allergy) || !line || line.status === 'voided') return null
  const items = config?.items || {}
  const own = line.item_id ? items[line.item_id] : null
  const parts = (line.combo || []).map(p => (p.item_id ? items[p.item_id] : null)).filter(Boolean)
  if (!own && !parts.length) return null // an item not on the menu: nothing known
  const ownLevels = dishLevels(own)
  const levels = mergeLevels([ownLevels, ...parts.map(dishLevels)])
  const { avoid, diet } = allergyPrefs(allergy)
  const hit = []
  const removable = []
  for (const code of avoid) {
    const lv = levels[code]
    if (lv === 'removable') removable.push(code)
    else if (lv) hit.push({ code, level: lv })
  }
  const dishes = parts.length ? parts : [own]
  const missing = diet.filter(code => !ownLevels[code] && !dishes.every(d => dishLevels(d)[code]))
  return hit.length || removable.length || missing.length ? { avoid: hit, removable, missing } : null
}

export function clashWords(clash, allergy) {
  if (!clash) return []
  const name = code => [...(allergy?.allergens || []), ...(allergy?.diets || [])].find(t => t.code === code)?.name || code
  return [
    ...clash.avoid.map(a => (a.level === 'may_contain' ? 'May contain ' : 'Contains ') + name(a.code)),
    ...clash.removable.map(code => name(code) + ' can be left out: ask'),
    ...clash.missing.map(code => 'Not ' + name(code)),
  ]
}
