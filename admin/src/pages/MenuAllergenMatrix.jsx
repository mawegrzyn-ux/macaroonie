// src/pages/MenuAllergenMatrix.jsx
//
// Menus > Allergen matrix (/menus/allergens): every dish of a menu against
// every dietary / allergen tag, toggled cell by cell. The grid itself is
// AllergenMatrixEditor (components/menus/AllergenMatrix.jsx), shared code
// with the dashboard Allergen lookup.

import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, Grid3x3 } from 'lucide-react'
import { useApi } from '@/lib/api'
import { AllergenMatrixEditor } from '@/components/menus/AllergenMatrix'

export default function MenuAllergenMatrix() {
  const api = useApi()
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api.get('/me'), staleTime: 60_000 })
  const canEdit = !!me?.is_platform_admin || me?.permissions?.menus === 'manage'

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-4 sm:px-6 max-lg:notouch:pl-14 pt-4 pb-3 shrink-0">
        <Link to="/menus" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ChevronLeft className="w-3.5 h-3.5" /> All menus
        </Link>
        <h1 className="text-xl font-semibold mt-1 flex items-center gap-2">
          <Grid3x3 className="w-5 h-5 text-primary" /> Allergen matrix
        </h1>
        <p className="text-sm text-muted-foreground">
          {canEdit
            ? 'Tap an allergen box to step through Contains, May contain, Can be removed and back to No; tap a dietary box to switch it on or off. Then Save. Tags are managed under Allergens & dietary.'
            : 'Which dishes carry each allergen and dietary tag.'}
        </p>
      </div>
      <div className="flex-1 min-h-0 px-4 sm:px-6 pb-4">
        <AllergenMatrixEditor canEdit={canEdit} />
      </div>
    </div>
  )
}
