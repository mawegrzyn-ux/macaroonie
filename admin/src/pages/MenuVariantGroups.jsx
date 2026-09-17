// src/pages/MenuVariantGroups.jsx
//
// Standalone page for managing tenant-wide menu variant groups
// (Protein, Size…). Split out from the menu editor so groups can be
// curated without a specific menu open — see AppShell's Menus > Variant
// groups nav entry.

import { Link } from 'react-router-dom'
import { ChevronLeft, Layers } from 'lucide-react'
import { VariantGroupsManager } from '@/components/menus/VariantGroupsManager'

export default function MenuVariantGroups() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 max-w-3xl mx-auto space-y-5">
        <div>
          <Link to="/menus" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            <ChevronLeft className="w-3.5 h-3.5" /> All menus
          </Link>
          <h1 className="text-xl font-semibold mt-1 inline-flex items-center gap-2">
            <Layers className="w-5 h-5 text-primary" /> Variant groups
          </h1>
          <p className="text-sm text-muted-foreground">
            Reusable option sets (Protein, Size…) you can attach to any dish across any menu.
            Options are always predefined here — default prices can be overridden per dish.
          </p>
        </div>
        <VariantGroupsManager />
      </div>
    </div>
  )
}
