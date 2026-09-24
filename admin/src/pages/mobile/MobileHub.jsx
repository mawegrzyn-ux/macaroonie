// src/pages/mobile/MobileHub.jsx
// Landing screen for the /mobile PWA — a tile per registered mobile module.
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { MOBILE_MODULES } from '@/mobile/registry'

export default function MobileHub() {
  return (
    <div className="p-4 space-y-3">
      <p className="text-sm text-muted-foreground px-0.5">
        Mobile-optimised tools. Add this page to your home screen for quick access.
      </p>
      {MOBILE_MODULES.map(m => {
        const Icon = m.icon
        return (
          <Link
            key={m.key}
            to={m.path}
            className="flex items-center gap-3 border rounded-xl p-4 bg-background hover:bg-accent touch-manipulation min-h-[64px]"
          >
            <span className="w-11 h-11 shrink-0 rounded-lg bg-[#0f5c4f]/10 text-[#0f5c4f] flex items-center justify-center">
              <Icon className="w-5 h-5" />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-semibold">{m.label}</span>
              <span className="block text-xs text-muted-foreground truncate">{m.description}</span>
            </span>
            <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
          </Link>
        )
      })}
    </div>
  )
}
