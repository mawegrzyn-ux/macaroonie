// src/pages/Platform.jsx
//
// Platform admin dashboard — tenant list, create, edit, stats.
// Only accessible to platform admins (gated in API + hidden in nav).

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Building2, Plus, Loader2, X, Check, Users, MapPin,
  Calendar, Globe, ChevronRight,
} from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'

const PLAN_COLOURS = {
  starter:    'bg-gray-100 text-gray-600',
  pro:        'bg-blue-100 text-blue-700',
  enterprise: 'bg-purple-100 text-purple-700',
}

export default function Platform() {
  const api = useApi()
  const qc  = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [editing,  setEditing]  = useState(null)

  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api.get('/me'), staleTime: 120_000 })

  const isPlatformAdmin = !!me?.is_platform_admin

  const { data: tenants = [], isLoading } = useQuery({
    queryKey: ['platform-tenants'],
    queryFn:  () => api.get('/platform/tenants'),
    enabled:  isPlatformAdmin,
  })

  const activeTenants   = tenants.filter(t => t.is_active)
  const inactiveTenants = tenants.filter(t => !t.is_active)

  if (!isPlatformAdmin) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        Platform admin access required.
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-6 h-14 border-b shrink-0">
        <div>
          <h1 className="font-semibold">Platform</h1>
          <p className="text-xs text-muted-foreground">
            {activeTenants.length} active tenant{activeTenants.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button onClick={() => setCreating(true)}
          className="bg-primary text-primary-foreground text-sm font-medium rounded-md px-4 py-2 min-h-[44px] inline-flex items-center gap-2 touch-manipulation">
          <Plus className="w-4 h-4" /> New tenant
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-6 space-y-6">
          {/* Stats overview */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard icon={Building2} label="Active tenants" value={activeTenants.length} />
            <StatCard icon={MapPin} label="Total venues"
              value={tenants.reduce((s, t) => s + Number(t.venue_count || 0), 0)} />
            <StatCard icon={Users} label="Total users"
              value={tenants.reduce((s, t) => s + Number(t.user_count || 0), 0)} />
            <StatCard icon={Calendar} label="Tenants on Pro+"
              value={tenants.filter(t => t.plan !== 'starter').length} />
          </div>

          {creating && (
            <CreateTenantCard onClose={() => setCreating(false)}
              onCreated={() => { setCreating(false); qc.invalidateQueries({ queryKey: ['platform-tenants'] }) }} />
          )}

          {editing && (
            <EditTenantCard tenant={editing} onClose={() => setEditing(null)}
              onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['platform-tenants'] }) }} />
          )}

          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div className="border rounded-xl overflow-hidden bg-background">
                <div className="px-5 py-3 border-b bg-muted/40">
                  <h2 className="text-sm font-semibold">Active tenants</h2>
                </div>
                <div className="divide-y">
                  {activeTenants.map(t => (
                    <TenantRow key={t.id} tenant={t} onEdit={() => setEditing(t)} />
                  ))}
                  {activeTenants.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-6">No tenants yet.</p>
                  )}
                </div>
              </div>

              {inactiveTenants.length > 0 && (
                <div className="border rounded-xl overflow-hidden bg-background">
                  <div className="px-5 py-3 border-b bg-muted/40">
                    <h2 className="text-sm font-semibold text-muted-foreground">Inactive tenants</h2>
                  </div>
                  <div className="divide-y">
                    {inactiveTenants.map(t => (
                      <TenantRow key={t.id} tenant={t} onEdit={() => setEditing(t)} inactive />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function StatCard({ icon: Icon, label, value }) {
  return (
    <div className="border rounded-xl p-4 bg-background">
      <div className="flex items-center gap-2 text-muted-foreground mb-1">
        <Icon className="w-4 h-4" />
        <span className="text-xs">{label}</span>
      </div>
      <p className="text-2xl font-bold">{value}</p>
    </div>
  )
}

function TenantRow({ tenant, onEdit, inactive }) {
  return (
    <button onClick={onEdit}
      className={cn(
        'w-full flex items-center gap-4 px-5 py-3 text-left hover:bg-accent/50 transition-colors touch-manipulation',
        inactive && 'opacity-50',
      )}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium truncate">{tenant.name}</p>
          <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', PLAN_COLOURS[tenant.plan])}>
            {tenant.plan}
          </span>
          {!tenant.is_active && (
            <span className="rounded-full px-2 py-0.5 text-[10px] font-medium bg-red-100 text-red-700">inactive</span>
          )}
        </div>
        <p className="text-xs text-muted-foreground truncate">{tenant.slug}</p>
      </div>
      <div className="flex items-center gap-4 text-xs text-muted-foreground shrink-0">
        <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {tenant.venue_count}</span>
        <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {tenant.user_count}</span>
      </div>
      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
    </button>
  )
}

function CreateTenantCard({ onClose, onCreated }) {
  const api = useApi()
  const [name, setName]               = useState('')
  const [slug, setSlug]               = useState('')
  const [plan, setPlan]               = useState('starter')
  const [orgId, setOrgId]             = useState('')
  const [autoProvision, setAutoProvision] = useState(true)
  const [error, setError]             = useState(null)
  const [result, setResult]           = useState(null)

  const create = useMutation({
    mutationFn: () => api.post('/platform/tenants', {
      name: name.trim(),
      slug: slug.trim().toLowerCase(),
      plan,
      auth0_org_id: orgId.trim() || undefined,
      auto_provision: autoProvision && !orgId.trim(),
    }),
    onSuccess: (data) => {
      // Stay open briefly to show provisioning result (or call onCreated immediately).
      const prov = data?.auth0_provisioning
      if (prov?.error) {
        setResult(data)   // surface partial failure inline
      } else {
        onCreated?.()
      }
    },
    onError: (e) => setError(e?.body?.error || e.message),
  })

  return (
    <div className="border rounded-xl overflow-hidden bg-background">
      <div className="px-5 py-3 border-b bg-muted/40 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Create tenant</h2>
        <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
      </div>
      <div className="p-5 space-y-4">
        <div>
          <label className="text-sm font-medium block mb-1">Name</label>
          <input value={name} autoFocus onChange={e => setName(e.target.value)} placeholder="Wingstop UK"
            className="w-full border rounded-md px-3 py-2 text-sm min-h-[44px] touch-manipulation focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <div>
          <label className="text-sm font-medium block mb-1">Slug</label>
          <input value={slug} onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} placeholder="wingstop-uk"
            className="w-full border rounded-md px-3 py-2 text-sm min-h-[44px] touch-manipulation focus:outline-none focus:ring-1 focus:ring-primary font-mono" />
        </div>
        <div>
          <label className="text-sm font-medium block mb-1">Plan</label>
          <select value={plan} onChange={e => setPlan(e.target.value)}
            className="w-full border rounded-md px-3 py-2 text-sm min-h-[44px] bg-background touch-manipulation">
            <option value="starter">Starter</option>
            <option value="pro">Pro</option>
            <option value="enterprise">Enterprise</option>
          </select>
        </div>
        {!orgId.trim() && (
          <label className="flex items-start gap-3 p-3 rounded-md border bg-muted/30 cursor-pointer">
            <input type="checkbox" checked={autoProvision}
              onChange={e => setAutoProvision(e.target.checked)}
              className="mt-0.5 w-4 h-4" />
            <div className="text-sm">
              <p className="font-medium">Auto-provision Auth0 organisation</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Recommended. Creates the Auth0 org, enables Username/Password
                + Google connections, and turns on auto-membership — no Auth0
                dashboard work needed. Requires <code className="font-mono">create:organizations</code>
                {' '}and <code className="font-mono">create:organization_connections</code> scopes
                on the M2M app.
              </p>
            </div>
          </label>
        )}
        <div>
          <label className="text-sm font-medium block mb-1">
            Auth0 Org ID {autoProvision && !orgId.trim() ? '(filled automatically)' : '(paste existing)'}
          </label>
          <p className="text-xs text-muted-foreground mb-1">
            Leave empty to auto-create. Paste an existing <code className="font-mono">org_…</code> id
            to link a tenant to an org you already created in Auth0.
          </p>
          <input value={orgId} onChange={e => setOrgId(e.target.value)} placeholder="org_xxxxxxxxx"
            className="w-full border rounded-md px-3 py-2 text-sm min-h-[44px] touch-manipulation focus:outline-none focus:ring-1 focus:ring-primary font-mono" />
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        {result?.auth0_provisioning?.error && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
            <p className="font-medium">Tenant created, but Auth0 provisioning failed:</p>
            <p className="mt-1 font-mono">{result.auth0_provisioning.error}</p>
            <p className="mt-2">
              The tenant exists in the database. To finish setup: create the org manually
              in Auth0, then click the tenant row and paste the org id.
            </p>
            <button onClick={() => { setResult(null); onCreated?.() }}
              className="mt-2 text-xs text-primary underline">Continue</button>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2 border-t">
          <button onClick={onClose} className="text-xs text-muted-foreground px-3 py-1.5">Cancel</button>
          <button onClick={() => create.mutate()} disabled={!name || !slug || create.isPending}
            className="bg-primary text-primary-foreground text-sm font-medium rounded-md px-4 py-2 min-h-[40px] inline-flex items-center gap-2 disabled:opacity-50">
            {create.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Create tenant
          </button>
        </div>
      </div>
    </div>
  )
}

function EditTenantCard({ tenant, onClose, onSaved }) {
  const api = useApi()
  const [name, setName]       = useState(tenant.name)
  const [slug, setSlug]       = useState(tenant.slug)
  const [plan, setPlan]       = useState(tenant.plan)
  const [orgId, setOrgId]     = useState(tenant.auth0_org_id || '')
  const [active, setActive]   = useState(tenant.is_active)
  const [error, setError]     = useState(null)

  const save = useMutation({
    mutationFn: () => api.patch(`/platform/tenants/${tenant.id}`, {
      name: name.trim(),
      slug: slug.trim().toLowerCase(),
      plan,
      auth0_org_id: orgId.trim() || null,
      is_active: active,
    }),
    onSuccess: () => onSaved?.(),
    onError: (e) => setError(e?.body?.error || e.message),
  })

  return (
    <div className="border rounded-xl overflow-hidden bg-background">
      <div className="px-5 py-3 border-b bg-muted/40 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Edit: {tenant.name}</h2>
        <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
      </div>
      <div className="p-5 space-y-4">
        <div>
          <label className="text-sm font-medium block mb-1">Name</label>
          <input value={name} onChange={e => setName(e.target.value)}
            className="w-full border rounded-md px-3 py-2 text-sm min-h-[44px] touch-manipulation focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <div>
          <label className="text-sm font-medium block mb-1">Slug</label>
          <input value={slug} onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
            className="w-full border rounded-md px-3 py-2 text-sm min-h-[44px] touch-manipulation focus:outline-none focus:ring-1 focus:ring-primary font-mono" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium block mb-1">Plan</label>
            <select value={plan} onChange={e => setPlan(e.target.value)}
              className="w-full border rounded-md px-3 py-2 text-sm min-h-[44px] bg-background touch-manipulation">
              <option value="starter">Starter</option>
              <option value="pro">Pro</option>
              <option value="enterprise">Enterprise</option>
            </select>
          </div>
          <div>
            <label className="text-sm font-medium block mb-1">Status</label>
            <select value={active ? 'active' : 'inactive'} onChange={e => setActive(e.target.value === 'active')}
              className="w-full border rounded-md px-3 py-2 text-sm min-h-[44px] bg-background touch-manipulation">
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </div>
        <div>
          <label className="text-sm font-medium block mb-1">Auth0 Org ID</label>
          <input value={orgId} onChange={e => setOrgId(e.target.value)}
            className="w-full border rounded-md px-3 py-2 text-sm min-h-[44px] touch-manipulation focus:outline-none focus:ring-1 focus:ring-primary font-mono" />
        </div>
        <div className="text-xs text-muted-foreground space-y-1">
          <p>Venues: {tenant.venue_count} · Users: {tenant.user_count}</p>
          <p>Created: {new Date(tenant.created_at).toLocaleDateString('en-GB')}</p>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex justify-end gap-2 pt-2 border-t">
          <button onClick={onClose} className="text-xs text-muted-foreground px-3 py-1.5">Cancel</button>
          <button onClick={() => save.mutate()} disabled={!name || !slug || save.isPending}
            className="bg-primary text-primary-foreground text-sm font-medium rounded-md px-4 py-2 min-h-[40px] inline-flex items-center gap-2 disabled:opacity-50">
            {save.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Save changes
          </button>
        </div>
      </div>
    </div>
  )
}
