// src/components/mobile/MobileMenu.jsx
//
// The phone app's three-dot menu, at the right of its header (MobileShell,
// and a page that draws its own header, like the cash-up day): one place for
// what used to float or sit as separate buttons.
//
//   On a shared device   which device it is, who said who they are (till or
//                        office PIN) with Lock and Switch person, or Who is
//                        this? when nobody has (components/SharedDevice.jsx).
//   This device          /mobile/device: the office PIN, share this device or
//                        stop sharing it.
//   Switch location      2+ groups: TenantSwitcherModal, then the same page
//                        opened fresh in the other one.
//   Notices              /mobile/notices.
//   Sign out
//
// Every row is 48 px; the menu closes on a pick, a tap outside or Escape.

import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth0 } from '@auth0/auth0-react'
import { useQuery } from '@tanstack/react-query'
import { MoreVertical, Lock, UserRound, Tablet, ArrowLeftRight, Bell, LogOut, ChevronRight } from 'lucide-react'
import { useApi, setSelectedTenant } from '@/lib/api'
import { cn } from '@/lib/utils'
import TenantSwitcherModal from '@/components/TenantSwitcherModal'
import { MOBILE_MODULES } from '@/mobile/registry'
import { useSharedDevice } from '@/lib/sharedDevice'
import { useSharedLock, askWhoNow } from '@/components/SharedDevice'

const ROW = 'w-full flex items-center gap-3 min-h-[48px] px-4 text-left text-sm touch-manipulation hover:bg-muted active:bg-muted'

export function signOut(logout) {
  try { localStorage.removeItem('maca_auth0_org_hint') } catch { /* ignore */ }
  logout({ logoutParams: { returnTo: window.location.origin } })
}

export default function MobileMenu({ className }) {
  const api = useApi()
  const { logout } = useAuth0()
  const location = useLocation()
  const navigate = useNavigate()
  const { device, person } = useSharedDevice()
  const lock = useSharedLock()
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api.get('/me'), staleTime: 120_000 })
  const [open, setOpen] = useState(false)
  const [top, setTop] = useState(64)
  const [switching, setSwitching] = useState(false)
  const buttonRef = useRef(null)

  const tenant = me?.current_tenant
  const canSwitch = !!tenant && (me?.available_tenants?.length ?? 0) > 1

  useEffect(() => {
    if (!open) return
    const onKey = e => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  function toggle() {
    const r = buttonRef.current?.getBoundingClientRect()
    if (r) setTop(Math.round(r.bottom + 4))
    setOpen(o => !o)
  }
  const pick = fn => () => { setOpen(false); fn() }

  // A switch opens the same page fresh (no query: an order or PO id in the
  // address would be the other group's).
  function switchTenant(id) {
    if (!id) return
    if (id === tenant?.id) { setSwitching(false); return }
    setSelectedTenant(id)
    const isHub = location.pathname === '/mobile' || location.pathname === '/mobile/'
    const active = MOBILE_MODULES.find(m => location.pathname.startsWith(m.path))
    window.location.assign(isHub ? '/mobile' : (active?.path ?? '/mobile'))
  }

  const who = me?.full_name || me?.email

  return (
    <>
      <button type="button" ref={buttonRef} onClick={toggle} aria-label="Menu" aria-expanded={open} aria-haspopup="menu"
        data-testid="mobile-menu"
        className={className ?? 'relative w-12 h-12 flex items-center justify-center rounded-lg hover:bg-accent text-muted-foreground shrink-0 touch-manipulation'}>
        <MoreVertical className="w-5 h-5" />
        {/* A shared device with nobody switched in: a dot, so it shows without opening the menu. */}
        {device && !person && <span className="absolute top-2.5 right-2.5 w-2.5 h-2.5 rounded-full bg-amber-500" aria-hidden />}
      </button>
      {open && (
        <div className="fixed inset-0 z-[65]" data-testid="mobile-menu-panel">
          <button type="button" aria-label="Close the menu" className="absolute inset-0 w-full h-full bg-black/20 cursor-default"
            onClick={() => setOpen(false)} />
          <div role="menu" style={{ top }}
            className="absolute right-2 w-[min(20rem,calc(100vw-1rem))] max-h-[85vh] overflow-y-auto rounded-xl border bg-background shadow-xl py-1">
            {who && (
              <p className="px-4 pt-2 pb-1 text-xs text-muted-foreground truncate" data-testid="mobile-menu-account">
                Signed in as {who}{tenant ? ' · ' + tenant.name : ''}
              </p>
            )}
            {device && (
              <div className="mx-2 my-1 rounded-lg border bg-muted/40 px-3 py-2 space-y-2" data-testid="mobile-menu-shared">
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Tablet className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">Shared device: {device.name}{device.venue_name ? ' · ' + device.venue_name : ''}</span>
                </p>
                {person ? (
                  <>
                    <p className="text-sm" data-testid="shared-person">
                      <span className="font-semibold">{person.name}</span>
                      <span className="text-muted-foreground"> · {person.kind === 'till' ? 'till PIN' : 'office PIN'}</span>
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" onClick={pick(lock)} data-testid="shared-lock"
                        className="inline-flex items-center justify-center gap-1.5 min-h-[48px] px-3 rounded-lg bg-primary text-primary-foreground text-sm font-semibold touch-manipulation">
                        <Lock className="w-4 h-4" /> Lock
                      </button>
                      <button type="button" onClick={pick(askWhoNow)} data-testid="shared-switch"
                        className="inline-flex items-center justify-center gap-1.5 min-h-[48px] px-3 rounded-lg border bg-background text-sm font-medium whitespace-nowrap touch-manipulation hover:bg-muted">
                        <UserRound className="w-4 h-4" /> Switch person
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">Nobody has said who they are.</p>
                    <button type="button" onClick={pick(askWhoNow)} data-testid="shared-who"
                      className="w-full inline-flex items-center justify-center gap-1.5 min-h-[48px] px-3 rounded-lg bg-primary text-primary-foreground text-sm font-semibold touch-manipulation">
                      <UserRound className="w-4 h-4" /> Who is this?
                    </button>
                  </>
                )}
              </div>
            )}
            <button type="button" role="menuitem" className={ROW} onClick={pick(() => navigate('/mobile/device'))} data-testid="mobile-menu-device">
              <Tablet className="w-5 h-5 text-muted-foreground shrink-0" />
              <span className="flex-1 min-w-0">
                <span className="block font-medium">This device</span>
                <span className="block text-xs text-muted-foreground truncate">
                  {device ? 'Shared: stop sharing it, your office PIN' : 'Your office PIN, share this device'}
                </span>
              </span>
              <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
            </button>
            {canSwitch && (
              <button type="button" role="menuitem" className={ROW} onClick={pick(() => setSwitching(true))} data-testid="mobile-tenant-switch">
                <ArrowLeftRight className="w-5 h-5 text-muted-foreground shrink-0" />
                <span className="flex-1 font-medium">Switch location</span>
              </button>
            )}
            <button type="button" role="menuitem" className={ROW} onClick={pick(() => navigate('/mobile/notices'))} data-testid="mobile-menu-notices">
              <Bell className="w-5 h-5 text-muted-foreground shrink-0" />
              <span className="flex-1 font-medium">Notices</span>
              <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
            </button>
            <div className="border-t my-1" />
            <button type="button" role="menuitem" className={cn(ROW, 'text-destructive')} onClick={pick(() => signOut(logout))} data-testid="mobile-menu-signout">
              <LogOut className="w-5 h-5 shrink-0" />
              <span className="flex-1 font-medium">Sign out</span>
            </button>
          </div>
        </div>
      )}
      {switching && (
        <TenantSwitcherModal
          tenants={me?.available_tenants ?? []}
          currentTenantId={tenant?.id}
          onPick={switchTenant}
          onClose={() => setSwitching(false)}
          title="Switch location"
          subtitle="Pick which location to work in."
        />
      )}
    </>
  )
}
