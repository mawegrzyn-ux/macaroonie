// src/pages/MenuDietaryGroups.jsx
//
// Standalone page for managing tenant-wide dietary / allergen tags.
// Split out from the menu editor — see AppShell's Menus > Dietary
// groups nav entry.

import { Link } from 'react-router-dom'
import { ChevronLeft, Tag } from 'lucide-react'
import { DietaryGroupsManager } from '@/components/menus/DietaryGroupsManager'

export default function MenuDietaryGroups() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 max-w-3xl mx-auto space-y-5">
        <div>
          <Link to="/menus" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            <ChevronLeft className="w-3.5 h-3.5" /> All menus
          </Link>
          <h1 className="text-xl font-semibold mt-1 inline-flex items-center gap-2">
            <Tag className="w-5 h-5 text-primary" /> Dietary groups
          </h1>
          <p className="text-sm text-muted-foreground">
            Allergen / dietary badges shown next to dishes. Shared across all your menus.
          </p>
        </div>
        <DietaryGroupsManager />
      </div>
    </div>
  )
}
