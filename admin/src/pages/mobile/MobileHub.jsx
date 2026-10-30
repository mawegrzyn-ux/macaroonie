// src/pages/mobile/MobileHub.jsx
// Landing screen for the /mobile PWA — a tile per registered mobile module,
// two to a row.
import { Link } from 'react-router-dom'
import { MOBILE_MODULES } from '@/mobile/registry'

export default function MobileHub() {
  return (
    <div className="p-4 space-y-3">
      <p className="text-sm text-muted-foreground px-0.5">
        Mobile-optimised tools. Add this page to your home screen for quick access.
      </p>
      <div className="grid grid-cols-2 gap-3">
        {MOBILE_MODULES.map(m => {
          const Icon = m.icon
          return (
            <Link
              key={m.key}
              to={m.path}
              className="flex flex-col items-start gap-2 border rounded-xl p-3 bg-background hover:bg-accent active:bg-accent touch-manipulation min-h-[120px] min-w-0"
            >
              <span className="w-11 h-11 shrink-0 rounded-lg bg-[#0f5c4f]/10 text-[#0f5c4f] flex items-center justify-center">
                <Icon className="w-5 h-5" />
              </span>
              <span className="block text-sm font-semibold leading-tight">{m.label}</span>
              <span className="text-xs text-muted-foreground leading-snug line-clamp-2">{m.description}</span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
