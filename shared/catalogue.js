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
