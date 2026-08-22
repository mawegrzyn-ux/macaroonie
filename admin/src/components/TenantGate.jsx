// src/components/TenantGate.jsx
// After Auth0 identity login, pick a restaurant. The pick is stored in
// localStorage and sent as X-Tenant-Id — no second Auth0 login.

import { useEffect, useRef, useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { useQuery } from '@tanstack/react-query'
import { useApi, getSelectedTenant, setSelectedTenant } from '@/lib/api'

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

  useEffect(() => {
    if (!me || selectedIsValid) return
    const byOrg = user?.org_id
      ? tenants.find(t => t.auth0_org_id === user.org_id)
      : null
    const candidate = byOrg || (!me.is_platform_admin && tenants.length === 1 ? tenants[0] : null)
    if (!candidate || tried.current.has(candidate.id)) return
    tried.current.add(candidate.id)
    setSelectedTenant(candidate.id)
    setSelected(candidate.id)
  }, [me, selectedIsValid, user?.org_id, tenants])

  function pick(id) {
    tried.current.add(id)
    setSelectedTenant(id)
    setSelected(id)
  }

  function signOut() {
    logout({ logoutParams: { returnTo: window.location.origin } })
  }

  if (!error && !selectedIsValid && (isLoading || isFetching || !me)) {
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

  if (!selectedIsValid) {
    return (
      <Screen>
        <h1 className="text-lg font-semibold mb-1">Choose a restaurant</h1>
        <p className="text-sm text-muted-foreground mb-4">
          Signed in as {me.email || user?.email}. Pick where you want to work —
          you can switch later from the sidebar.
        </p>
        <ul className="space-y-2">
          {tenants.map(t => (
            <li key={t.id}>
              <button
                onClick={() => pick(t.id)}
                className="w-full text-left text-sm rounded border px-3 py-2.5 hover:bg-accent touch-manipulation"
              >
                <span className="font-medium">{t.name}</span>
                {t.slug && (
                  <span className="block text-xs text-muted-foreground">{t.slug}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
        <button
          onClick={signOut}
          className="mt-4 w-full text-xs text-muted-foreground hover:underline"
        >
          Sign out
        </button>
      </Screen>
    )
  }

  return children
}
