// src/pages/Allergens.jsx
//
// Allergens (/allergens): the read-only Allergen lookup as a page of its own,
// for anyone with the Allergen lookup module (OUTSTANDING 44, item 1), so
// front-of-house can answer a guest's allergy question without Menus access.
// The same AllergenLookup as the dashboard widget, the Overview tile and
// /mobile/allergens, over the live menus (what guests are served). Setting
// a dish's allergens stays on the Allergen matrix (Menus manage).

import { Link } from 'react-router-dom'
import { Grid3x3, Wheat } from 'lucide-react'
import { usePermission } from '@/hooks/usePermission'
import { AllergenLookup } from '@/components/menus/AllergenMatrix'

export default function Allergens() {
  const { canView, loaded } = usePermission('allergens')
  const menus = usePermission('menus')

  return (
    <div className="h-full overflow-y-auto bg-page">
      <div className="px-4 sm:px-6 max-lg:notouch:pl-14 py-3 border-b bg-background flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <Wheat className="w-5 h-5 text-primary" /> Allergens
          </h1>
          <p className="text-sm text-muted-foreground">
            What guests are served: search a dish, or tap Allergens & diet to find the dishes that have or are free from a tag.
          </p>
        </div>
        {menus.canManage && (
          <Link to="/menus/allergens" data-testid="allergens-matrix-link"
            className="inline-flex items-center gap-2 px-3 min-h-[48px] rounded-md border bg-background text-sm touch-manipulation hover:bg-accent">
            <Grid3x3 className="w-4 h-4" /> Allergen matrix
          </Link>
        )}
      </div>

      <div className="p-4 sm:p-6 max-w-4xl">
        {loaded && !canView ? (
          <div className="rounded-lg border bg-background p-6 text-sm text-muted-foreground" data-testid="allergens-no-access">
            Your role doesn&apos;t have access to the Allergen lookup. Ask an owner to give your role View on it under Access.
          </div>
        ) : (
          <div className="rounded-lg border bg-background overflow-hidden">
            <div className="section-head px-4 py-2.5 text-sm font-semibold">Allergen lookup</div>
            <AllergenLookup storeKey="maca_allergen_lookup_page" />
          </div>
        )}
      </div>
    </div>
  )
}
