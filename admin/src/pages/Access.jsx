// src/pages/Access.jsx
//
// Access management: per-tenant module switches + custom roles
// with permission matrix.
//
// RBAC: owner only for mutations (the API enforces).
// Available to anyone for viewing the matrix.

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Shield, Plus, Loader2, X, Trash2, Lock,
} from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'

const LEVELS = ['none', 'view', 'manage']

const LEVEL_COLOURS = {
  none:   'bg-gray-100 text-gray-500',
  view:   'bg-amber-100 text-amber-700',
  manage: 'bg-emerald-100 text-emerald-700',
}

export default function Access() {
  const [tab, setTab] = useState('modules')

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-6 h-14 border-b shrink-0">
        <div>
          <h1 className="font-semibold flex items-center gap-2">
            <Shield className="w-4 h-4" /> Access
          </h1>
          <p className="text-xs text-muted-foreground">Modules + roles</p>
        </div>
        <div className="flex items-center gap-1 rounded-md border p-0.5">
          {[
            ['modules', 'Modules'],
            ['roles',   'Roles'],
          ].map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className={cn(
                'px-3 py-1.5 text-sm font-medium rounded touch-manipulation min-h-[36px]',
                tab === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              )}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-6">
          {tab === 'modules' && <ModulesPanel />}
          {tab === 'roles'   && <RolesPanel />}
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────
// Modules tab — master on/off switch per GROUP. Tightly-coupled
// modules (bookings, venues, tables, schedule, rules, customers,
// widget_test) all toggle together under one "Bookings" switch
// because they're operationally one product.
// ──────────────────────────────────────────────────────────

function ModulesPanel() {
  const api = useApi()
  const qc  = useQueryClient()
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api.get('/me'), staleTime: 60_000 })
  const isOwner = me?.role === 'owner' || me?.is_platform_admin

  const { data: groups = [], isLoading } = useQuery({
    queryKey: ['access-module-groups'],
    queryFn:  () => api.get('/access/module-groups'),
  })

  const { data: modules = [] } = useQuery({
    queryKey: ['access-modules'],
    queryFn:  () => api.get('/access/modules'),
  })

  const toggleGroup = useMutation({
    mutationFn: ({ key, is_enabled }) => api.patch(`/access/module-groups/${key}`, { is_enabled }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['access-module-groups'] })
      qc.invalidateQueries({ queryKey: ['access-modules'] })
      qc.invalidateQueries({ queryKey: ['me'] })  // refreshes nav gating
    },
  })

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>

  // Modules NOT in any group are core (always-on, no toggle).
  const groupModuleKeys = new Set(groups.flatMap(g => g.moduleKeys))
  const coreModules = modules.filter(m => !groupModuleKeys.has(m.key))

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Master on/off per product area. Disabling a group hides its nav entries for everyone
        in the tenant (including owners) and the API rejects mutations on routes belonging
        to that group. Granular per-role access is set on the <strong>Roles</strong> tab.
      </p>

      <div className="border rounded-xl overflow-hidden bg-background divide-y">
        {groups.map(g => (
          <div key={g.key} className="px-5 py-4">
            <div className="flex items-start gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{g.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{g.description}</p>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Includes:&nbsp;
                  {g.moduleKeys.map((k, i) => {
                    const m = modules.find(mm => mm.key === k)
                    return (
                      <span key={k} className="inline-block">
                        {i > 0 && ', '}
                        <span className="font-mono">{m?.label ?? k}</span>
                      </span>
                    )
                  })}
                </p>
              </div>
              <label className="inline-flex items-center cursor-pointer shrink-0 mt-1">
                <input type="checkbox"
                  checked={g.is_enabled}
                  disabled={!isOwner || toggleGroup.isPending}
                  onChange={e => toggleGroup.mutate({ key: g.key, is_enabled: e.target.checked })}
                  className="sr-only peer" />
                <div className="w-11 h-6 bg-gray-200 peer-checked:bg-primary rounded-full
                                relative after:content-[''] after:absolute after:top-0.5 after:left-0.5
                                after:bg-white after:rounded-full after:w-5 after:h-5 after:transition-all
                                peer-checked:after:translate-x-5" />
              </label>
            </div>
          </div>
        ))}
      </div>

      {coreModules.length > 0 && (
        <div className="border rounded-xl overflow-hidden bg-muted/30">
          <div className="px-5 py-3 border-b">
            <p className="text-sm font-semibold">Always-on</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Core modules — no master switch. Per-role access is still configurable on the Roles tab.
            </p>
          </div>
          <div className="divide-y">
            {coreModules.map(m => (
              <div key={m.key} className="px-5 py-3">
                <p className="text-sm font-medium">{m.label}</p>
                <p className="text-xs text-muted-foreground">{m.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {!isOwner && (
        <p className="text-xs text-muted-foreground italic">
          Only owners can change module switches.
        </p>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────
// Roles tab — list + permission matrix editor
// ──────────────────────────────────────────────────────────

function RolesPanel() {
  const api = useApi()
  const qc  = useQueryClient()
  const [editing, setEditing] = useState(null)
  const [creating, setCreating] = useState(false)

  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api.get('/me'), staleTime: 60_000 })
  const isOwner = me?.role === 'owner' || me?.is_platform_admin

  const { data: roles = [], isLoading } = useQuery({
    queryKey: ['access-roles'],
    queryFn:  () => api.get('/access/roles'),
  })

  const { data: modules = [] } = useQuery({
    queryKey: ['access-modules'],
    queryFn:  () => api.get('/access/modules'),
  })

  const remove = useMutation({
    mutationFn: (id) => api.delete(`/access/roles/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['access-roles'] }),
  })

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>

  if (editing || creating) {
    const role = editing ?? null
    return <RoleEditor role={role} modules={modules} onClose={() => { setEditing(null); setCreating(false) }} />
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          4 built-in roles ship with the platform. Edit their permissions or add custom roles
          for finer-grained access (e.g. &ldquo;Manager&rdquo;, &ldquo;Host&rdquo;).
        </p>
        {isOwner && (
          <button onClick={() => setCreating(true)}
            className="bg-primary text-primary-foreground text-sm font-medium rounded-md px-4 py-2 min-h-[40px] inline-flex items-center gap-2 touch-manipulation">
            <Plus className="w-4 h-4" /> New role
          </button>
        )}
      </div>

      <div className="border rounded-xl overflow-hidden bg-background divide-y">
        {roles.map(r => (
          <button key={r.id} onClick={() => setEditing(r)}
            className="w-full flex items-center gap-4 px-5 py-3 text-left hover:bg-accent/50 transition-colors touch-manipulation">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium truncate">{r.label}</p>
                {r.is_builtin && (
                  <span className="text-[10px] inline-flex items-center gap-0.5 rounded-full bg-blue-100 text-blue-700 px-1.5 py-0.5">
                    <Lock className="w-2.5 h-2.5" /> built-in
                  </span>
                )}
                {!r.is_active && (
                  <span className="text-[10px] rounded-full bg-gray-200 text-gray-600 px-1.5 py-0.5">inactive</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground truncate">
                {r.description || <span className="italic">(no description)</span>}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                key: <span className="font-mono">{r.key}</span>
              </p>
            </div>
            {isOwner && !r.is_builtin && (
              <button onClick={(e) => { e.stopPropagation(); if (confirm(`Delete role "${r.label}"?`)) remove.mutate(r.id) }}
                className="p-2 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 touch-manipulation">
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────
// Role editor — permission matrix per module
// ──────────────────────────────────────────────────────────

function RoleEditor({ role, modules, onClose }) {
  const api = useApi()
  const qc  = useQueryClient()
  const isNew = !role

  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api.get('/me'), staleTime: 60_000 })
  const isOwner = me?.role === 'owner' || me?.is_platform_admin

  const [label, setLabel]             = useState(role?.label || '')
  const [key, setKey]                 = useState(role?.key   || '')
  const [description, setDescription] = useState(role?.description || '')
  const [active, setActive]           = useState(role?.is_active ?? true)
  const [permissions, setPermissions] = useState(role?.permissions || {})
  const [error, setError]             = useState(null)

  const setPerm = (modKey, level) => setPermissions(p => ({ ...p, [modKey]: level }))

  const save = useMutation({
    mutationFn: () => isNew
      ? api.post('/access/roles', { key: key.trim(), label: label.trim(), description: description.trim() || null, is_active: active, sort_order: 99, permissions })
      : api.patch(`/access/roles/${role.id}`, { label: label.trim(), description: description.trim() || null, is_active: active, permissions }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['access-roles'] })
      qc.invalidateQueries({ queryKey: ['me'] })
      onClose()
    },
    onError: (e) => setError(e?.body?.error || e.message),
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={onClose}
          className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <X className="w-4 h-4" /> Back
        </button>
        {role?.is_builtin && (
          <span className="text-xs inline-flex items-center gap-1 rounded-full bg-blue-100 text-blue-700 px-2 py-1">
            <Lock className="w-3 h-3" /> Built-in role — permissions can be edited, key cannot
          </span>
        )}
      </div>

      <div className="border rounded-xl overflow-hidden bg-background">
        <div className="px-5 py-3 border-b bg-muted/40">
          <h2 className="text-sm font-semibold">{isNew ? 'New role' : `Edit: ${role.label}`}</h2>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-sm font-medium block mb-1">Label</label>
            <input value={label} onChange={e => setLabel(e.target.value)} disabled={!isOwner}
              placeholder="Manager"
              className="w-full border rounded-md px-3 py-2 text-sm min-h-[44px] touch-manipulation focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50" />
          </div>
          {isNew && (
            <div>
              <label className="text-sm font-medium block mb-1">Key</label>
              <p className="text-xs text-muted-foreground mb-1">
                Lowercase identifier (a-z, 0-9, _, -). Cannot be changed later.
              </p>
              <input value={key} onChange={e => setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
                placeholder="manager"
                className="w-full border rounded-md px-3 py-2 text-sm min-h-[44px] touch-manipulation focus:outline-none focus:ring-1 focus:ring-primary font-mono" />
            </div>
          )}
          <div>
            <label className="text-sm font-medium block mb-1">Description</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} disabled={!isOwner}
              rows={2}
              className="w-full border rounded-md px-3 py-2 text-sm touch-manipulation focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50" />
          </div>
          {!isNew && (
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} disabled={!isOwner} />
              Active
            </label>
          )}
        </div>
      </div>

      {/* Permission matrix */}
      <div className="border rounded-xl overflow-hidden bg-background">
        <div className="px-5 py-3 border-b bg-muted/40">
          <h2 className="text-sm font-semibold">Permissions</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Module-level access. <span className="font-mono">none</span> = hidden, <span className="font-mono">view</span> = read-only,
            <span className="font-mono"> manage</span> = full edit.
          </p>
        </div>
        <div className="divide-y">
          {modules.map(m => (
            <div key={m.key} className="px-5 py-3 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">{m.label}</p>
                  {!m.is_enabled && (
                    <span className="text-[10px] rounded-full bg-gray-200 text-gray-600 px-1.5 py-0.5">disabled at tenant</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{m.description}</p>
              </div>
              <div className="flex items-center gap-1 rounded-md border p-0.5 shrink-0">
                {LEVELS.map(lvl => (
                  <button key={lvl}
                    onClick={() => isOwner && setPerm(m.key, lvl)}
                    disabled={!isOwner}
                    className={cn(
                      'px-3 py-1.5 text-xs font-medium rounded capitalize touch-manipulation min-h-[32px] disabled:cursor-not-allowed',
                      permissions[m.key] === lvl
                        ? LEVEL_COLOURS[lvl]
                        : 'text-muted-foreground hover:bg-accent',
                    )}>
                    {lvl}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex justify-end gap-2 pb-6">
        <button onClick={onClose}
          className="text-sm text-muted-foreground px-4 py-2">Cancel</button>
        {isOwner && (
          <button onClick={() => save.mutate()}
            disabled={!label.trim() || (isNew && !key.trim()) || save.isPending}
            className="bg-primary text-primary-foreground text-sm font-medium rounded-md px-4 py-2 min-h-[40px] inline-flex items-center gap-2 disabled:opacity-50">
            {save.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {isNew ? 'Create role' : 'Save changes'}
          </button>
        )}
      </div>
    </div>
  )
}
