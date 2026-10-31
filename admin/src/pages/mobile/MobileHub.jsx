// src/pages/mobile/MobileHub.jsx
// Landing screen for the /mobile PWA — a tile per registered mobile module,
// two to a row. A tile with things to do today shows how many (red when any
// is late), from the Today feed for the venue picked on the Today page.
import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { MOBILE_MODULES } from '@/mobile/registry'
import { readVenue } from '@/pages/OpsToday'
import { useTodayFeed, tileBadge, todayLine } from '@/mobile/today'

export default function MobileHub() {
  const { data: feed } = useTodayFeed(readVenue())
  return (
    <div className="p-4 space-y-3">
      <p className="text-sm text-muted-foreground px-0.5">
        Mobile-optimised tools. Add this page to your home screen for quick access.
      </p>
      <div className="grid grid-cols-2 gap-3">
        {MOBILE_MODULES.map(m => {
          const Icon = m.icon
          const badge = tileBadge(feed, m.areas)
          const line = m.key === 'today' && feed ? todayLine(feed) : m.description
          return (
            <Link
              key={m.key}
              to={m.path}
              data-testid={'mobile-tile-' + m.key}
              aria-label={m.label + (badge ? `, ${badge.count} to do${badge.late ? ', some late' : ''}` : '')}
              className="relative flex flex-col items-start gap-2 border rounded-xl p-3 bg-background hover:bg-accent active:bg-accent touch-manipulation min-h-[120px] min-w-0"
            >
              {badge && (
                <span data-testid="mobile-tile-badge" data-late={badge.late ? 'yes' : 'no'}
                  className={cn('absolute top-2.5 right-2.5 min-w-[26px] h-[26px] px-1.5 rounded-full text-white text-xs font-bold flex items-center justify-center',
                    badge.late ? 'bg-red-600' : 'bg-amber-500')}>
                  {badge.count}
                </span>
              )}
              <span className="w-11 h-11 shrink-0 rounded-lg bg-[#0f5c4f]/10 text-[#0f5c4f] flex items-center justify-center">
                <Icon className="w-5 h-5" />
              </span>
              <span className="block text-sm font-semibold leading-tight">{m.label}</span>
              <span className={cn('text-xs leading-snug line-clamp-2', m.key === 'today' && badge?.late ? 'text-red-700 font-medium' : 'text-muted-foreground')}
                data-testid={m.key === 'today' ? 'mobile-today-line' : undefined}>{line}</span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
