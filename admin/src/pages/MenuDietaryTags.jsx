// src/pages/MenuDietaryTags.jsx
//
// Standalone page for managing tenant-wide allergens and dietary tags
// (Menus > Allergens & dietary). Dishes attach these in the menu editor
// and the Allergen matrix.

import { Link } from 'react-router-dom'
import { ChevronLeft, Tag } from 'lucide-react'
import { DietaryTagsManager } from '@/components/menus/DietaryTagsManager'
import { usePermission } from '@/hooks/usePermission'
import { ReadOnlyNotice, ReadOnlyFieldset } from '@/components/ReadOnlyNotice'

export default function MenuDietaryTags() {
  // Menus = View: the tags and the allergen notice are shown, not editable.
  const { canManage } = usePermission('menus')
  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 max-w-3xl mx-auto space-y-5">
        <div>
          <Link to="/menus" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            <ChevronLeft className="w-3.5 h-3.5" /> All menus
          </Link>
          <h1 className="text-xl font-semibold mt-1 flex items-center gap-2">
            <Tag className="w-5 h-5 text-primary" /> Allergens &amp; dietary tags
          </h1>
          <p className="text-sm text-muted-foreground">
            Badges shown next to dishes, shared across all your menus. Tap one to edit it.
          </p>
        </div>
        {!canManage && <ReadOnlyNotice what="the allergens and dietary tags" />}
        <ReadOnlyFieldset disabled={!canManage}><DietaryTagsManager /></ReadOnlyFieldset>
      </div>
    </div>
  )
}
