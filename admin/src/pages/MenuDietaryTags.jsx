// src/pages/MenuDietaryTags.jsx
//
// Standalone page for managing tenant-wide dietary / allergen tags
// (Menus > Dietary tags). Dishes attach these in the menu editor.

import { Link } from 'react-router-dom'
import { ChevronLeft, Tag } from 'lucide-react'
import { DietaryTagsManager } from '@/components/menus/DietaryTagsManager'

export default function MenuDietaryTags() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 max-w-3xl mx-auto space-y-5">
        <div>
          <Link to="/menus" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            <ChevronLeft className="w-3.5 h-3.5" /> All menus
          </Link>
          <h1 className="text-xl font-semibold mt-1 inline-flex items-center gap-2">
            <Tag className="w-5 h-5 text-primary" /> Dietary tags
          </h1>
          <p className="text-sm text-muted-foreground">
            Allergen / dietary badges shown next to dishes. Shared across all your menus. Tap a tag to edit it.
          </p>
        </div>
        <DietaryTagsManager />
      </div>
    </div>
  )
}
