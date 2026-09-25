// src/components/TenantGate.jsx
// After Auth0 identity login, pick a restaurant. The pick is stored in
// localStorage and sent as X-Tenant-Id — no second Auth0 login.

import { useEffect, useRef, useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { useQuery } from '@tanstack/react-query'
import { useApi, getSelectedTenant, setSelectedTenant } from '@/lib/api'
import TenantSwitcherModal from '@/components/TenantSwitcherModal'

function Screen({ children }) {
  return (
    <div className="flex items-center justify-center min-h-screen bg-background px-4">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  )
}

export default function TenantGate({ children }) {
  const { user, logout } = useAuth0()
  const api = useApi()
  const [selected, setSelected] = useState(() => getSelectedTenant())
  const tried = useRef(new Set())

  const { data: me, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['me', selected ?? 'none'],
    queryFn:  () => api.get('/me'),
    retry:    1,
  })

  const tenants = me?.available_tenants ?? []
  const selectedIsValid = !!(selected && me?.current_tenant?.id === selected)

  // Same candidate logic the effect below acts on, computed at render time
  // too so we know — before the effect has had a chance to run — whether
  // this user is about to be auto-signed into a tenant. A single-tenant
  // user (or an invite-link org match) should never see the picker flash
  // on screen even for one frame; only a genuine "which one?" case (no
  // stored history, more than one tenant) should render the modal.
  const byOrgCandidate = me && user?.org_id
    ? tenants.find(t => t.auth0_org_id === user.org_id)
    : null
  const autoSelectCandidate = byOrgCandidate
    || (me && !me.is_platform_admin && tenants.length === 1 ? tenants[0] : null)
  const willAutoSelect = !selectedIsValid && !!autoSelectCandidate

  useEffect(() => {
    if (!me || selectedIsValid || !autoSelectCandidate) return
    if (tried.current.has(autoSelectCandidate.id)) return
    tried.current.add(autoSelectCandidate.id)
    setSelectedTenant(autoSelectCandidate.id)
    setSelected(autoSelectCandidate.id)
  }, [me, selectedIsValid, autoSelectCandidate])

  function pick(id) {
    tried.current.add(id)
    setSelectedTenant(id)
    setSelected(id)
  }

  function signOut() {
    logout({ logoutParams: { returnTo: window.location.origin } })
  }

  if (!error && !selectedIsValid && (isLoading || isFetching || !me || willAutoSelect)) {
    return (
      <Screen>
        <p className="text-sm text-muted-foreground animate-pulse text-center">Loading…</p>
      </Screen>
    )
  }

  if (error) {
    return (
      <Screen>
        <h1 className="text-lg font-semibold mb-1">Couldn’t load your restaurants</h1>
        <p className="text-sm text-muted-foreground mb-4">{error.message || 'Please try again.'}</p>
        <div className="flex gap-2">
          <button
            onClick={() => refetch()}
            className="flex-1 text-sm rounded px-3 py-2 bg-primary text-primary-foreground"
          >
            Retry
          </button>
          <button
            onClick={signOut}
            className="flex-1 text-sm rounded px-3 py-2 border"
          >
            Sign out
          </button>
        </div>
      </Screen>
    )
  }

  // Platform admin with no tenants yet — let them through to /platform.
  if (me.is_platform_admin && tenants.length === 0) return children

  if (tenants.length === 0) {
    return (
      <Screen>
        <h1 className="text-lg font-semibold mb-1">No restaurant yet</h1>
        <p className="text-sm text-muted-foreground mb-4">
          You’re signed in as {me.email || user?.email || 'this account'}, but you haven’t
          been invited to a restaurant. Ask your manager to invite you from Team.
        </p>
        <button onClick={signOut} className="w-full text-sm rounded px-3 py-2 border">
          Sign out
        </button>
      </Screen>
    )
  }

  // Genuine "which one?" case — more than one tenant and no valid stored
  // pick (first login on this browser, or a previously-picked tenant this
  // account no longer belongs to). Shown as a modal, not a full page —
  // there's nothing behind it yet, but it's still the same dismissible-free
  // component AppShell's "Change tenant" button reuses later.
  if (!selectedIsValid) {
    return (
      <TenantSwitcherModal
        tenants={tenants}
        currentTenantId={selected}
        onPick={pick}
        title="Choose a restaurant"
        subtitle={`Signed in as ${me.email || user?.email}. Pick where you want to work — you can switch later from the sidebar.`}
        footer={
          <button
            onClick={signOut}
            className="mt-4 w-full text-xs text-muted-foreground hover:underline touch-manipulation"
          >
            Sign out
          </button>
        }
      />
    )
  }

  return children
}
