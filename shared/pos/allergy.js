// shared/pos/allergy.js
//
// The order's allergy flag: the allergens to keep out, the diets to keep to
// and a note, for the whole order (not one dish). Set on the till from More
// or a Buttons zone button (event check.allergy_set, shared/pos/checks.js);
// the kitchen screens and printed kitchen tickets show it on the order
// (headerFromCheck() in shared/pos/kitchen.js, kitchenTicket() in tickets.js).
//
// Stored on the check as the till saw the tags, code and name, so the
// kitchen, tickets and reports can show it without the menu's tag list:
//
//   { allergens: [{ code, name }], diets: [{ code, name }], note }
//
// or null (no flag). The codes are menu_dietary_tags codes, so the till can
// mark the dishes that don't suit with the kiosk's own rule (guestFit() in
// shared/kiosk.js, through allergyPrefs()).
//
//   allergyProblem(raw)   why a payload's flag can't be stored, or null
//   cleanAllergy(raw)     the flag tidied (duplicates and blanks dropped),
//                         or null when it says nothing
//   allergyText(a)        one line for the kitchen: "Milk, Peanuts · Vegan · No sesame oil"
//   allergyPrefs(a)       { avoid, diet } codes, the shape guestFit() takes
//   allergyOn(a)          has the order a flag?
//   mergeAllergy(a, b)    two flags as one (every tag of both, both notes):
//                         a check merged into another, or dishes moved to
//                         another check, take their flag with them

export const ALLERGY_TAGS_MAX = 30
export const ALLERGY_NOTE_MAX = 300
const CODE_MAX = 40
const NAME_MAX = 60

const text = v => (typeof v === 'string' ? v.trim() : '')

function tagProblem(t) {
  if (!t || typeof t !== 'object' || Array.isArray(t)) return true
  const code = text(t.code), name = text(t.name)
  return !code || code.length > CODE_MAX || !name || name.length > NAME_MAX
}

/** Why `raw` (an event payload's allergy) can't be stored, or null. null itself is fine (no flag). */
export function allergyProblem(raw) {
  if (raw === null) return null
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'allergy'
  for (const k of ['allergens', 'diets']) {
    const v = raw[k]
    if (v === undefined) continue
    if (!Array.isArray(v) || v.length > ALLERGY_TAGS_MAX || v.some(tagProblem)) return 'allergy.' + k
  }
  if (raw.note != null && (typeof raw.note !== 'string' || raw.note.length > ALLERGY_NOTE_MAX)) return 'allergy.note'
  return null
}

function tags(v) {
  const seen = new Set()
  const out = []
  for (const t of Array.isArray(v) ? v : []) {
    if (tagProblem(t)) continue
    const code = text(t.code)
    if (seen.has(code)) continue
    seen.add(code)
    out.push({ code, name: text(t.name) })
  }
  return out.slice(0, ALLERGY_TAGS_MAX)
}

/** The flag tidied, or null when it names nothing and has no note. */
export function cleanAllergy(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const allergens = tags(raw.allergens)
  const diets = tags(raw.diets)
  const note = text(raw.note).slice(0, ALLERGY_NOTE_MAX) || null
  if (!allergens.length && !diets.length && !note) return null
  return { allergens, diets, note }
}

export const allergyOn = a => !!(a && (a.allergens?.length || a.diets?.length || a.note))

/** "Milk, Peanuts · Vegan · No sesame oil" (allergens, then diets, then the note), '' for none. */
export function allergyText(a) {
  if (!allergyOn(a)) return ''
  return [
    (a.allergens || []).map(t => t.name).join(', '),
    (a.diets || []).map(t => t.name).join(', '),
    a.note || '',
  ].filter(Boolean).join(' · ')
}

/** The flag as the kiosk's guest picks ({ avoid, diet } tag codes) for guestFit(). */
export function allergyPrefs(a) {
  return {
    avoid: (a?.allergens || []).map(t => t.code),
    diet: (a?.diets || []).map(t => t.code),
  }
}

/** Two flags as one: every allergen and diet of both, both notes (once each). */
export function mergeAllergy(a, b) {
  if (!allergyOn(b)) return cleanAllergy(a)
  if (!allergyOn(a)) return cleanAllergy(b)
  const notes = [...new Set([a.note, b.note].map(text).filter(Boolean))]
  return cleanAllergy({
    allergens: [...(a.allergens || []), ...(b.allergens || [])],
    diets: [...(a.diets || []), ...(b.diets || [])],
    note: notes.join(' / '),
  })
}
