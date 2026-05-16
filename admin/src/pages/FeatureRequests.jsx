// src/pages/FeatureRequests.jsx
//
// Cross-tenant feature request board with upvoting.

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Plus, ThumbsUp, ExternalLink } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { format } from 'date-fns'

// ── Constants ─────────────────────────────────────────────────

const STATUS_BADGE = {
  submitted:    'bg-slate-100 text-slate-700',
  under_review: 'bg-blue-100 text-blue-800',
  planned:      'bg-purple-100 text-purple-800',
  in_progress:  'bg-amber-100 text-amber-800',
  shipped:      'bg-green-100 text-green-800',
  declined:     'bg-red-100 text-red-800',
}

const STATUS_LABELS = {
  submitted:    'Submitted',
  under_review: 'Under Review',
  planned:      'Planned',
  in_progress:  'In Progress',
  shipped:      'Shipped',
  declined:     'Declined',
}

const STATUS_TABS = ['all', 'submitted', 'under_review', 'planned', 'in_progress', 'shipped', 'declined']
const STATUSES = ['submitted', 'under_review', 'planned', 'in_progress', 'shipped', 'declined']

function Badge({ children, className }) {
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-xs font-medium', className)}>
      {children}
    </span>
  )
}

// ── New request form ──────────────────────────────────────────

function NewRequestModal({ onClose, onSave, isSaving }) {
  const [title, setTitle] = useState('')
  const [desc,  setDesc]  = useState('')

  function handleSubmit(e) {
    e.preventDefault()
    if (!title.trim()) return
    onSave({ title: title.trim(), description: desc.trim() || null })
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-background rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">New feature request</h2>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-accent touch-manipulation">
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Title *</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              required
              className="w-full border rounded px-3 py-2 text-sm bg-background touch-manipulation min-h-[44px]"
              placeholder="What would you like to see?"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <textarea
              value={desc}
              onChange={e => setDesc(e.target.value)}
              rows={4}
              className="w-full border rounded px-3 py-2 text-sm bg-background touch-manipulation resize-none"
              placeholder="Describe the feature and why it would be valuable…"
            />
          </div>
          <div className="flex gap-2 pt-2">
            <button
              type="submit"
              disabled={isSaving || !title.trim()}
              className="flex-1 bg-primary text-primary-foreground rounded px-4 py-2 text-sm font-medium touch-manipulation min-h-[44px] disabled:opacity-50"
            >
              {isSaving ? 'Submitting…' : 'Submit request'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border rounded text-sm touch-manipulation min-h-[44px]"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Detail modal ──────────────────────────────────────────────

function DetailModal({ request, onClose, isPlatformAdmin, onUpdate, isUpdating, onPromote, isPromoting }) {
  const [status,     setStatus]     = useState(request.status)
  const [adminNotes, setAdminNotes] = useState(request.admin_notes ?? '')

  function handleSave() {
    onUpdate({ status, admin_notes: adminNotes || null })
  }

  const isPromoted = request.promoted_to_backlog_id

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-background rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-6">
        <div className="flex items-start justify-between mb-4 gap-3">
          <h2 className="text-lg font-semibold leading-snug">{request.title}</h2>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-accent touch-manipulation shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 items-center">
            <Badge className={STATUS_BADGE[request.status]}>{STATUS_LABELS[request.status]}</Badge>
            {request.tenant_name && (
              <span className="text-xs text-muted-foreground">{request.tenant_name}</span>
            )}
            <span className="ml-auto text-sm text-muted-foreground flex items-center gap-1">
              <ThumbsUp className="w-3.5 h-3.5" />
              {request.upvotes} vote{request.upvotes !== 1 ? 's' : ''}
            </span>
          </div>

          {request.description && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Description</p>
              <p className="text-sm whitespace-pre-wrap">{request.description}</p>
            </div>
          )}

          {request.admin_notes && !isPlatformAdmin && (
            <div className="p-3 rounded-lg bg-blue-50 border border-blue-200">
              <p className="text-xs font-medium text-blue-700 mb-1">Admin notes</p>
              <p className="text-sm text-blue-900">{request.admin_notes}</p>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Submitted {format(new Date(request.created_at), 'd MMM yyyy')}
          </p>

          {isPromoted && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-blue-50 border border-blue-200">
              <ExternalLink className="w-4 h-4 text-blue-600 shrink-0" />
              <span className="text-sm text-blue-800">Promoted to backlog</span>
            </div>
          )}

          {/* Platform admin controls */}
          {isPlatformAdmin && (
            <div className="space-y-3 border-t pt-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Admin controls</p>
              <div>
                <label className="block text-sm font-medium mb-1">Status</label>
                <select
                  value={status}
                  onChange={e => setStatus(e.target.value)}
                  className="w-full border rounded px-3 py-2 text-sm bg-background touch-manipulation min-h-[44px]"
                >
                  {STATUSES.map(s => (
                    <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Admin notes</label>
                <textarea
                  value={adminNotes}
                  onChange={e => setAdminNotes(e.target.value)}
                  rows={3}
                  className="w-full border rounded px-3 py-2 text-sm bg-background touch-manipulation resize-none"
                  placeholder="Visible to all tenants…"
                />
              </div>
              <button
                onClick={handleSave}
                disabled={isUpdating}
                className="w-full bg-primary text-primary-foreground rounded px-4 py-2 text-sm font-medium touch-manipulation min-h-[44px] disabled:opacity-50"
              >
                {isUpdating ? 'Saving…' : 'Save changes'}
              </button>
              {!isPromoted && (
                <button
                  onClick={onPromote}
                  disabled={isPromoting}
                  className="w-full border rounded px-4 py-2 text-sm font-medium touch-manipulation min-h-[44px] hover:bg-accent disabled:opacity-50"
                >
                  {isPromoting ? 'Promoting…' : 'Promote to backlog'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────

export default function FeatureRequests() {
  const api         = useApi()
  const queryClient = useQueryClient()

  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn:  () => api.get('/me'),
    staleTime: 120_000,
  })

  const [statusTab,  setStatusTab]  = useState('all')
  const [sortMode,   setSortMode]   = useState('votes')
  const [showCreate, setShowCreate] = useState(false)
  const [selected,   setSelected]   = useState(null)

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ['feature-requests', statusTab, sortMode],
    queryFn:  () => {
      const params = new URLSearchParams()
      if (statusTab !== 'all') params.set('status', statusTab)
      params.set('sort', sortMode)
      return api.get(`/feature-requests?${params}`)
    },
    enabled: !!me,
  })

  const createMut = useMutation({
    mutationFn: body => api.post('/feature-requests', body),
    onSuccess:  () => {
      queryClient.invalidateQueries({ queryKey: ['feature-requests'] })
      setShowCreate(false)
    },
  })

  const patchMut = useMutation({
    mutationFn: ({ id, ...body }) => api.patch(`/feature-requests/${id}`, body),
    onSuccess:  (data) => {
      queryClient.invalidateQueries({ queryKey: ['feature-requests'] })
      setSelected(data)
    },
  })

  const upvoteMut = useMutation({
    mutationFn: id => api.post(`/feature-requests/${id}/upvote`),
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: ['feature-requests'] }),
  })

  const promoteMut = useMutation({
    mutationFn: id => api.post(`/feature-requests/${id}/promote`),
    onSuccess:  () => {
      queryClient.invalidateQueries({ queryKey: ['feature-requests'] })
      queryClient.invalidateQueries({ queryKey: ['backlog'] })
    },
  })

  const isPlatformAdmin = me?.is_platform_admin ?? false

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Feature requests</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium touch-manipulation min-h-[44px]"
        >
          <Plus className="w-4 h-4" />
          New request
        </button>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex gap-1 overflow-x-auto">
          {STATUS_TABS.map(tab => (
            <button
              key={tab}
              onClick={() => setStatusTab(tab)}
              className={cn(
                'px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap touch-manipulation transition-colors',
                statusTab === tab
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent',
              )}
            >
              {STATUS_LABELS[tab] ?? 'All'}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-1">
          <button
            onClick={() => setSortMode('votes')}
            className={cn(
              'px-3 py-1.5 rounded-md text-sm touch-manipulation transition-colors',
              sortMode === 'votes' ? 'bg-muted font-medium' : 'text-muted-foreground hover:bg-accent',
            )}
          >
            Top votes
          </button>
          <button
            onClick={() => setSortMode('newest')}
            className={cn(
              'px-3 py-1.5 rounded-md text-sm touch-manipulation transition-colors',
              sortMode === 'newest' ? 'bg-muted font-medium' : 'text-muted-foreground hover:bg-accent',
            )}
          >
            Newest
          </button>
        </div>
      </div>

      {/* Card grid */}
      {isLoading ? (
        <div className="text-center py-20 text-muted-foreground text-sm">Loading…</div>
      ) : requests.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground text-sm">No feature requests found.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {requests.map(req => (
            <div
              key={req.id}
              className="border rounded-xl p-4 space-y-3 hover:border-primary/40 cursor-pointer touch-manipulation transition-colors"
              onClick={() => setSelected(req)}
            >
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-sm leading-snug line-clamp-2">{req.title}</h3>
                  {req.tenant_name && (
                    <p className="text-xs text-muted-foreground mt-0.5">{req.tenant_name}</p>
                  )}
                </div>
                <Badge className={cn('shrink-0', STATUS_BADGE[req.status])}>{STATUS_LABELS[req.status]}</Badge>
              </div>
              {req.description && (
                <p className="text-sm text-muted-foreground line-clamp-3">{req.description}</p>
              )}
              <div className="flex items-center gap-3">
                <button
                  onClick={e => { e.stopPropagation(); upvoteMut.mutate(req.id) }}
                  disabled={upvoteMut.isPending}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border touch-manipulation transition-colors min-h-[44px]',
                    req.has_upvoted
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'text-muted-foreground border-border hover:bg-accent',
                  )}
                >
                  <ThumbsUp className="w-3.5 h-3.5" />
                  {req.upvotes}
                </button>
                <span className="text-xs text-muted-foreground ml-auto">
                  {format(new Date(req.created_at), 'd MMM yyyy')}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modals */}
      {showCreate && (
        <NewRequestModal
          onClose={() => setShowCreate(false)}
          onSave={body => createMut.mutate(body)}
          isSaving={createMut.isPending}
        />
      )}

      {selected && (
        <DetailModal
          request={selected}
          onClose={() => setSelected(null)}
          isPlatformAdmin={isPlatformAdmin}
          onUpdate={body => patchMut.mutate({ id: selected.id, ...body })}
          isUpdating={patchMut.isPending}
          onPromote={() => promoteMut.mutate(selected.id)}
          isPromoting={promoteMut.isPending}
        />
      )}
    </div>
  )
}
