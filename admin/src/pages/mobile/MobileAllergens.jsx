// src/pages/mobile/MobileAllergens.jsx
//
// Allergen lookup on a phone (/mobile/allergens): the same read-only
// AllergenLookup as the H&S dashboard widget and the Overview tile, in its
// phone layout (sticky menu + search, fold-away tag filter).

import { AllergenLookup } from '@/components/menus/AllergenMatrix'

export default function MobileAllergens() {
  return <AllergenLookup storeKey="maca_allergen_lookup_mobile" phone />
}
