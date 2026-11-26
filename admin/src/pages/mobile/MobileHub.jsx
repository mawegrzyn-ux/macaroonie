// src/pages/mobile/MobileHub.jsx
// Landing screen for the /mobile PWA — a tile per registered mobile module,
// two to a row. A tile with things to do today shows how many (red when any
// is late), from the Today feed for the venue picked on the Today page (or on Home).
// Pepper sits at the bottom (AskPepperBar) for people who can chat with it.
// A picture shared to the Office app from the gallery (or a link or a note
// from another app) opens here in Capture once the person is known
// (useSharedItem(), lib/officeApp.jsx).
import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { MOBILE_MODULES } from '@/mobile/registry'
import { readVenue } from '@/pages/Home'
import { useTodayFeed, tileBadge, todayLine } from '@/mobile/today'
import { useQuery } from '@tanstack/react-query'
import { useApi } from '@/lib/api'
import { useAiStatus } from '@/components/ai/ChatView'
import AskPepperBar from '@/components/ai/AskPepperBar'
import CaptureButton from '@/components/ai/CaptureButton'
import { useSharedItem } from '@/lib/officeApp'
import { X } from 'lucide-react'
import { ASSISTANT_NAME } from '@shared/assistant.js'

export default function MobileHub() {
  const { data: feed } = useTodayFeed(readVenue())
  const api = useApi()
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api.get('/me'), staleTime: 60_000 })
  const { data: ai } = useAiStatus()
  const canCapture = !!me && (me.is_platform_admin || (me.permissions?.ai_assistant ?? 'none') !== 'none')
  const [shared, clearShared] = useSharedItem(!!me)
  // A tile with a module shows once /me says the role has it; hub: false has no tile.
  const shown = MOBILE_MODULES.filter(m => m.hub !== false).filter(m => !m.module || me?.is_platform_admin
    || (me?.permissions?.[m.module] ?? 'none') !== 'none')
  return (
    <div className="min-h-full flex flex-col">
      <div className="flex-1 p-4 space-y-3">
        {/* Capture to For review (migration 281): a photo, a voice note or a line. */}
        {canCapture && <CaptureButton venueId={readVenue()} shared={shared} onSharedDone={clearShared} />}
        {shared && !canCapture && (
          <div role="alert" data-testid="shared-no-capture" className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <span className="flex-1">
              {shared.kind === 'text' ? 'Something was shared' : 'A picture was shared'} to Macaroonie Office, but Capture is part of {ASSISTANT_NAME}, which your role
              doesn&apos;t have, so it wasn&apos;t kept. Ask a manager for access to {ASSISTANT_NAME}.
            </span>
            <button type="button" onClick={clearShared} aria-label="Dismiss" data-testid="shared-no-capture-dismiss"
              className="w-12 h-12 -my-2 -mr-2 flex items-center justify-center rounded-lg touch-manipulation hover:bg-amber-100">
              <X className="w-5 h-5" />
            </button>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          {shown.map(m => {
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
                {!badge && m.Badge && <m.Badge />}
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
    {ai?.can_chat && <AskPepperBar />}
    </div>
  )
}
