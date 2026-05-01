// src/pages/Team.jsx
//
// In-app team management — invite users, set roles, deactivate.
// RBAC: admin/owner can view; only owner can invite/edit/remove.

import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  UserPlus, Shield, Loader2, X, Check, ChevronDown, KeyRound, AlertTriangle,
} from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'

const ROLE_COLOURS = {
  owner:    'bg-purple-100 text-purple-700',
  admin:    'bg-blue-100 text-blue-700',
  operator: 'bg-emerald-100 text-emerald-700',
  viewer:   'bg-gray-100 text-gray-600',
}

export default function Team() {
  const api = useApi()
  const qc  = useQueryClient()
  const [inviting, setInviting] = useState(false)

  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api.get('/me'), staleTime: 120_000 })
  const isOwner = me?.role === 'owner' || me?.is_platform_admin

  const { data: members = [], isLoading } = useQuery({
    queryKey: ['team'],
    queryFn:  () => api.get('/team'),
  })

  const { data: roles = [] } = useQuery({
    queryKey: ['team-roles'],
    queryFn:  () => api.get('/team/roles'),
  })

  const { data: auth0Status } = useQuery({
    queryKey: ['team-auth0-status'],
    queryFn:  () => api.get('/team/auth0-status'),
    staleTime: 300_000,
  })

  const resetPassword = useMutation({
    mutationFn: (id) => api.post(`/team/${id}/reset-password`, {}),
  })

  const updateRole = useMutation({
    mutationFn: ({ id, role }) => api.patch(`/team/${id}`, { role }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['team'] }),
  })

  const toggleActive = useMutation({
    mutationFn: ({ id, is_active }) => api.patch(`/team/${id}`, { is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['team'] }),
  })

  const remove = useMutation({
    mutationFn: (id) => api.delete(`/team/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['team'] }),
  })

  const activeMembers   = members.filter(m => m.is_active)
  const inactiveMembers = members.filter(m => !m.is_active)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-6 h-14 border-b shrink-0">
        <div>
          <h1 className="font-semibold">Team</h1>
          <p className="text-xs text-muted-foreground">{activeMembers.length} active member{activeMembers.length !== 1 ? 's' : ''}</p>
        </div>
        {isOwner && (
          <button onClick={() => setInviting(true)}
            className="bg-primary text-primary-foreground text-sm font-medium rounded-md px-4 py-2 min-h-[44px] inline-flex items-center gap-2 touch-manipulation">
            <UserPlus className="w-4 h-4" /> Invite
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto p-6 space-y-6">
          {auth0Status && !auth0Status.invitations_ready && (
            <div className="border border-amber-300 bg-amber-50 rounded-xl px-5 py-3 text-sm text-amber-900 flex gap-3">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">Auth0 invitations not configured</p>
                <p className="text-xs mt-1">Inviting a user will create a local row only — no email is sent. Set <code className="font-mono">AUTH0_MGMT_CLIENT_ID</code>, <code className="font-mono">AUTH0_MGMT_CLIENT_SECRET</code>, and <code className="font-mono">AUTH0_INVITE_CLIENT_ID</code> on the API to enable email invites and password resets.</p>
              </div>
            </div>
          )}

          {inviting && (
            <InviteCard roles={roles} onClose={() => setInviting(false)}
              onInvited={() => { setInviting(false); qc.invalidateQueries({ queryKey: ['team'] }) }} />
          )}

          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div className="border rounded-xl overflow-hidden bg-background">
                <div className="px-5 py-3 border-b bg-muted/40">
                  <h2 className="text-sm font-semibold">Active members</h2>
                </div>
                <div className="divide-y">
                  {activeMembers.map(m => (
                    <MemberRow key={m.id} member={m} roles={roles} isOwner={isOwner}
                      currentSub={me?.auth0_sub}
                      canResetPassword={!!auth0Status?.invitations_ready}
                      onRoleChange={(role) => updateRole.mutate({ id: m.id, role })}
                      onDeactivate={() => toggleActive.mutate({ id: m.id, is_active: false })}
                      onResetPassword={() => resetPassword.mutate(m.id)}
                      resetPending={resetPassword.isPending && resetPassword.variables === m.id}
                      resetSuccess={resetPassword.isSuccess && resetPassword.variables === m.id}
                      onRemove={() => remove.mutate(m.id)} />
                  ))}
                  {activeMembers.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-6">No team members yet.</p>
                  )}
                </div>
              </div>

              {inactiveMembers.length > 0 && (
                <div className="border rounded-xl overflow-hidden bg-background">
                  <div className="px-5 py-3 border-b bg-muted/40">
                    <h2 className="text-sm font-semibold text-muted-foreground">Deactivated</h2>
                  </div>
                  <div className="divide-y">
                    {inactiveMembers.map(m => (
                      <div key={m.id} className="flex items-center justify-between px-5 py-3 opacity-50">
                        <div>
                          <p className="text-sm font-medium">{m.full_name || m.email}</p>
                          <p className="text-xs text-muted-foreground">{m.email}</p>
                        </div>
                        {isOwner && (
                          <button onClick={() => toggleActive.mutate({ id: m.id, is_active: true })}
                            className="text-xs text-primary hover:underline">
                            Reactivate
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* RBAC reference */}
              <div className="border rounded-xl overflow-hidden bg-background">
                <div className="px-5 py-3 border-b bg-muted/40">
                  <h2 className="text-sm font-semibold">Role permissions</h2>
                </div>
                <div className="p-5">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-muted-foreground">
                        <th className="pb-2 pr-3">Role</th>
                        <th className="pb-2 pr-3">Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {roles.map(r => (
                        <tr key={r.value} className="border-t">
                          <td className="py-2 pr-3">
                            <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', ROLE_COLOURS[r.value])}>
                              {r.label}
                            </span>
                          </td>
                          <td className="py-2 text-muted-foreground">{r.description}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function MemberRow({
  member, roles, isOwner, currentSub, canResetPassword,
  onRoleChange, onDeactivate, onResetPassword, onRemove,
  resetPending, resetSuccess,
}) {
  const isSelf = member.auth0_user_id === currentSub
  const lastLogin = member.last_login_at
    ? new Date(member.last_login_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : 'Never'
  const pending = !member.auth0_user_id

  return (
    <div className="flex items-center gap-4 px-5 py-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium truncate">{member.full_name || member.email}</p>
          {isSelf && <span className="text-[10px] text-muted-foreground">(you)</span>}
          {pending && <span className="text-[10px] rounded-full bg-amber-100 text-amber-700 px-1.5 py-0.5">Invite pending</span>}
        </div>
        <p className="text-xs text-muted-foreground truncate">{member.email}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">Last login: {lastLogin}</p>
      </div>

      {isOwner && !isSelf ? (
        <select value={member.role}
          onChange={e => onRoleChange(e.target.value)}
          className={cn(
            'rounded-full px-3 py-1 text-xs font-medium border-0 cursor-pointer min-h-[32px] touch-manipulation',
            ROLE_COLOURS[member.role],
          )}>
          {roles.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      ) : (
        <span className={cn('rounded-full px-3 py-1 text-xs font-medium', ROLE_COLOURS[member.role])}>
          {member.role}
        </span>
      )}

      {isOwner && !isSelf && canResetPassword && (
        <button onClick={onResetPassword} disabled={resetPending}
          title={resetSuccess ? 'Password reset email sent' : 'Send password reset email'}
          className={cn(
            'p-2 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 touch-manipulation disabled:opacity-50',
            resetSuccess && 'text-emerald-600',
          )}>
          {resetPending ? <Loader2 className="w-4 h-4 animate-spin" />
           : resetSuccess ? <Check className="w-4 h-4" />
           : <KeyRound className="w-4 h-4" />}
        </button>
      )}

      {isOwner && !isSelf && (
        <button onClick={onDeactivate} title="Deactivate"
          className="p-2 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 touch-manipulation">
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}

function InviteCard({ roles, onClose, onInvited }) {
  const api = useApi()
  const [email, setEmail]       = useState('')
  const [name,  setName]        = useState('')
  const [role,  setRole]        = useState('operator')
  const [error, setError]       = useState(null)

  const invite = useMutation({
    mutationFn: () => api.post('/team/invite', {
      email: email.trim().toLowerCase(),
      full_name: name.trim() || undefined,
      role,
    }),
    onSuccess: () => onInvited?.(),
    onError: (e) => setError(e?.body?.error || e.message),
  })

  return (
    <div className="border rounded-xl overflow-hidden bg-background">
      <div className="px-5 py-3 border-b bg-muted/40 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Invite team member</h2>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="p-5 space-y-4">
        <div>
          <label className="text-sm font-medium block mb-1">Email</label>
          <input type="email" value={email} autoFocus
            onChange={e => setEmail(e.target.value)}
            placeholder="colleague@restaurant.com"
            className="w-full border rounded-md px-3 py-2 text-sm min-h-[44px] touch-manipulation focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <div>
          <label className="text-sm font-medium block mb-1">Full name (optional)</label>
          <input type="text" value={name}
            onChange={e => setName(e.target.value)}
            className="w-full border rounded-md px-3 py-2 text-sm min-h-[44px] touch-manipulation focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <div>
          <label className="text-sm font-medium block mb-1">Role</label>
          <select value={role} onChange={e => setRole(e.target.value)}
            className="w-full border rounded-md px-3 py-2 text-sm min-h-[44px] bg-background touch-manipulation">
            {roles.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          {roles.find(r => r.value === role) && (
            <p className="text-xs text-muted-foreground mt-1">
              {roles.find(r => r.value === role).description}
            </p>
          )}
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex justify-end gap-2 pt-2 border-t">
          <button onClick={onClose}
            className="text-xs text-muted-foreground px-3 py-1.5">Cancel</button>
          <button onClick={() => invite.mutate()} disabled={!email || invite.isPending}
            className="bg-primary text-primary-foreground text-sm font-medium rounded-md px-4 py-2 min-h-[40px] inline-flex items-center gap-2 disabled:opacity-50">
            {invite.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Send invite
          </button>
        </div>
      </div>
    </div>
  )
}
