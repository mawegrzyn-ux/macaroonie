// src/pages/mobile/MobileHub.jsx
// Landing screen for the /mobile PWA — a tile per registered mobile module,
// two to a row.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeftRight } from 'lucide-react'
import { MOBILE_MODULES } from '@/mobile/registry'
import { useApi, setSelectedTenant } from '@/lib/api'
import TenantSwitcherModal from '@/components/TenantSwitcherModal'

// The restaurant this phone is working in, with a way to change it: the
// ops screens have no sidebar, so without this the only way to switch was
// the office site (same pick as AppShell's switcher: stored, then reload).
function TenantLine() {
  const api = useApi()
  const [open, setOpen] = useState(false)
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api.get('/me'), staleTime: 60_000 })
  const tenants = me?.available_tenants ?? []
  const current = me?.current_tenant
  if (!current || tenants.length < 2) return null
  return (
    <>
      <div className="flex items-center gap-3 border rounded-xl px-3 py-2 bg-background" data-testid="mobile-tenant">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">Working in</p>
          <p className="text-sm font-semibold truncate" data-testid="mobile-tenant-name">{current.name}</p>
        </div>
        <button type="button" onClick={() => setOpen(true)} data-testid="mobile-tenant-switch"
          className="min-h-[48px] px-3 rounded-lg border text-sm font-medium touch-manipulation hover:bg-muted flex items-center gap-1.5 shrink-0">
          <ArrowLeftRight className="w-4 h-4" /> Switch
        </button>
      </div>
      {open && (
        <TenantSwitcherModal
          tenants={tenants}
          currentTenantId={current.id}
          onPick={id => { if (!id) return; setSelectedTenant(id); window.location.reload() }}
          onClose={() => setOpen(false)}
          title="Switch restaurant"
          subtitle="Pick which restaurant to work in."
        />
      )}
    </>
  )
}

export default function MobileHub() {
  return (
    <div className="p-4 space-y-3">
      <TenantLine />
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
