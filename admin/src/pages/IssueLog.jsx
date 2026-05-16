// src/pages/IssueLog.jsx
//
// Tenant-facing ITIL issue log.

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Plus, ChevronRight, ExternalLink } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { format } from 'date-fns'

// ── ITIL helpers ──────────────────────────────────────────────

const PRIORITY_MATRIX = {
  critical: { critical: 'p1', high: 'p1', medium: 'p2', low: 'p2' },
  high:     { critical: 'p1', high: 'p2', medium: 'p2', low: 'p3' },
  medium:   { critical: 'p2', high: 'p2', medium: 'p3', low: 'p3' },
  low:      { critical: 'p3', high: 'p3', medium: 'p4', low: 'p4' },
}

function calcPriority(impact, urgency) {
  return PRIORITY_MATRIX[impact]?.[urgency] ?? 'p4'
}

const PRIORITY_BADGE = {
  p1: 'bg-red-100 text-red-800',
  p2: 'bg-orange-100 text-orange-800',
  p3: 'bg-amber-100 text-amber-800',
  p4: 'bg-green-100 text-green-800',
}

const STATUS_BADGE = {
  new:          'bg-slate-100 text-slate-700',
  acknowledged: 'bg-blue-100 text-blue-800',
  in_progress:  'bg-amber-100 text-amber-800',
  resolved:     'bg-green-100 text-green-800',
  closed:       'bg-gray-100 text-gray-600',
}

const CATEGORY_LABELS = {
  incident:       'Incident',
  problem:        'Problem',
  change_request: 'Change Request',
  service_request:'Service Request',
}

const STATUS_TABS = ['all', 'new', 'acknowledged', 'in_progress', 'resolved', 'closed']
const STATUS_TAB_LABELS = {
  all: 'All', new: 'New', acknowledged: 'Acknowledged', in_progress: 'In Progress',
  resolved: 'Resolved', closed: 'Closed',
}

const IMPACTS   = ['critical', 'high', 'medium', 'low']
const URGENCIES = ['critical', 'high', 'medium', 'low']
const CATEGORIES = ['incident', 'problem', 'change_request', 'service_request']
const STATUSES   = ['new', 'acknowledged', 'in_progress', 'resolved', 'closed']

function Badge({ children, className }) {
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-xs font-medium', className)}>
      {children}
    </span>
  )
}

// ── New issue form ─────────────────────────────────────────────

function NewIssueModal({ onClose, onSave, isSaving }) {
  const [title,    setTitle]    = useState('')
  const [desc,     setDesc]     = useState('')
  const [category, setCategory] = useState('incident')
  const [impact,   setImpact]   = useState('low')
  const [urgency,  setUrgency]  = useState('low')

  const priority = calcPriority(impact, urgency)

  function handleSubmit(e) {
    e.preventDefault()
    if (!title.trim()) return
    onSave({ title: title.trim(), description: desc.trim() || null, category, impact, urgency })
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-background rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">New issue</h2>
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
              placeholder="Describe the issue"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <textarea
              value={desc}
              onChange={e => setDesc(e.target.value)}
              rows={3}
              className="w-full border rounded px-3 py-2 text-sm bg-background touch-manipulation resize-none"
              placeholder="Optional details"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Category</label>
            <select
              value={category}
              onChange={e => setCategory(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm bg-background touch-manipulation min-h-[44px]"
            >
              {CATEGORIES.map(c => (
                <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Impact</label>
              <select
                value={impact}
                onChange={e => setImpact(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm bg-background touch-manipulation min-h-[44px]"
              >
                {IMPACTS.map(i => (
                  <option key={i} value={i}>{i.charAt(0).toUpperCase() + i.slice(1)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Urgency</label>
              <select
                value={urgency}
                onChange={e => setUrgency(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm bg-background touch-manipulation min-h-[44px]"
              >
                {URGENCIES.map(u => (
                  <option key={u} value={u}>{u.charAt(0).toUpperCase() + u.slice(1)}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
            <span className="text-sm text-muted-foreground">Computed priority:</span>
            <Badge className={PRIORITY_BADGE[priority]}>{priority.toUpperCase()}</Badge>
          </div>
          <div className="flex gap-2 pt-2">
            <button
              type="submit"
              disabled={isSaving || !title.trim()}
              className="flex-1 bg-primary text-primary-foreground rounded px-4 py-2 text-sm font-medium touch-manipulation min-h-[44px] disabled:opacity-50"
            >
              {isSaving ? 'Saving…' : 'Submit issue'}
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

// ── Detail panel ──────────────────────────────────────────────

function DetailPanel({ issue, onClose, isPlatformAdmin, onUpdate, isUpdating }) {
  const [status,          setStatus]          = useState(issue.status)
  const [resolutionNotes, setResolutionNotes]  = useState(issue.resolution_notes ?? '')
  const [promoting,       setPromoting]        = useState(false)
  const api = useApi()
  const queryClient = useQueryClient()

  const promoteMut = useMutation({
    mutationFn: () => api.post(`/issues/${issue.id}/promote`),
    onSuccess:  () => {
      queryClient.invalidateQueries({ queryKey: ['issues'] })
      queryClient.invalidateQueries({ queryKey: ['backlog'] })
    },
  })

  function handleSave() {
    onUpdate({ status, resolution_notes: resolutionNotes || null })
  }

  const isResolved = issue.promoted_to_backlog_id || promoteMut.isSuccess

  return (
    <div className="fixed inset-y-0 right-0 z-40 w-[420px] bg-background border-l shadow-xl flex flex-col">
      <div className="flex items-center justify-between p-4 border-b shrink-0">
        <h2 className="font-semibold text-sm truncate pr-4">{issue.title}</h2>
        <button onClick={onClose} className="p-1.5 rounded hover:bg-accent touch-manipulation shrink-0">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Badges */}
        <div className="flex flex-wrap gap-2">
          <Badge className={PRIORITY_BADGE[issue.priority]}>{issue.priority.toUpperCase()}</Badge>
          <Badge className={STATUS_BADGE[issue.status]}>{STATUS_TAB_LABELS[issue.status] ?? issue.status}</Badge>
          <Badge className="bg-slate-100 text-slate-700">{CATEGORY_LABELS[issue.category] ?? issue.category}</Badge>
        </div>

        {/* Description */}
        {issue.description && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">Description</p>
            <p className="text-sm whitespace-pre-wrap">{issue.description}</p>
          </div>
        )}

        {/* ITIL metadata */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">Impact</p>
            <p className="font-medium capitalize">{issue.impact}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">Urgency</p>
            <p className="font-medium capitalize">{issue.urgency}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">Created</p>
            <p className="font-medium">{format(new Date(issue.created_at), 'd MMM yyyy')}</p>
          </div>
          {issue.resolved_at && (
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Resolved</p>
              <p className="font-medium">{format(new Date(issue.resolved_at), 'd MMM yyyy')}</p>
            </div>
          )}
          {issue.tenant_name && (
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Tenant</p>
              <p className="font-medium">{issue.tenant_name}</p>
            </div>
          )}
        </div>

        {/* Resolution notes (view) */}
        {issue.resolution_notes && !isPlatformAdmin && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">Resolution notes</p>
            <p className="text-sm whitespace-pre-wrap">{issue.resolution_notes}</p>
          </div>
        )}

        {/* Promoted chip */}
        {(issue.promoted_to_backlog_id || promoteMut.data) && (
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
                  <option key={s} value={s}>{STATUS_TAB_LABELS[s] ?? s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Resolution notes</label>
              <textarea
                value={resolutionNotes}
                onChange={e => setResolutionNotes(e.target.value)}
                rows={3}
                className="w-full border rounded px-3 py-2 text-sm bg-background touch-manipulation resize-none"
                placeholder="Resolution details…"
              />
            </div>
            <button
              onClick={handleSave}
              disabled={isUpdating}
              className="w-full bg-primary text-primary-foreground rounded px-4 py-2 text-sm font-medium touch-manipulation min-h-[44px] disabled:opacity-50"
            >
              {isUpdating ? 'Saving…' : 'Save changes'}
            </button>
            {!isResolved && (
              <button
                onClick={() => promoteMut.mutate()}
                disabled={promoteMut.isPending}
                className="w-full border rounded px-4 py-2 text-sm font-medium touch-manipulation min-h-[44px] hover:bg-accent disabled:opacity-50"
              >
                {promoteMut.isPending ? 'Promoting…' : 'Promote to backlog'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────

export default function IssueLog() {
  const api         = useApi()
  const queryClient = useQueryClient()

  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn:  () => api.get('/me'),
    staleTime: 120_000,
  })

  const [statusTab,  setStatusTab]  = useState('all')
  const [showCreate, setShowCreate] = useState(false)
  const [selected,   setSelected]   = useState(null)

  const { data: issues = [], isLoading } = useQuery({
    queryKey: ['issues', statusTab],
    queryFn:  () => api.get(`/issues${statusTab !== 'all' ? `?status=${statusTab}` : ''}`),
    enabled:  !!me,
  })

  const createMut = useMutation({
    mutationFn: body => api.post('/issues', body),
    onSuccess:  (data) => {
      queryClient.invalidateQueries({ queryKey: ['issues'] })
      setShowCreate(false)
    },
  })

  const patchMut = useMutation({
    mutationFn: ({ id, ...body }) => api.patch(`/issues/${id}`, body),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['issues'] })
      setSelected(data)
    },
  })

  const isPlatformAdmin = me?.is_platform_admin ?? false

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Issue log</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium touch-manipulation min-h-[44px]"
        >
          <Plus className="w-4 h-4" />
          New issue
        </button>
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-1 mb-4 overflow-x-auto pb-1">
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
            {STATUS_TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {/* Issues table */}
      <div className="border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground w-20">Priority</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground w-36">Category</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Title</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground w-32">Status</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground w-28">Created</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={6} className="text-center py-12 text-muted-foreground text-sm">Loading…</td>
              </tr>
            ) : issues.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-12 text-muted-foreground text-sm">No issues found.</td>
              </tr>
            ) : issues.map(issue => (
              <tr
                key={issue.id}
                onClick={() => setSelected(issue)}
                className="border-b last:border-0 hover:bg-muted/30 cursor-pointer touch-manipulation"
              >
                <td className="px-4 py-3">
                  <Badge className={PRIORITY_BADGE[issue.priority]}>{issue.priority.toUpperCase()}</Badge>
                </td>
                <td className="px-4 py-3">
                  <span className="text-muted-foreground">{CATEGORY_LABELS[issue.category] ?? issue.category}</span>
                </td>
                <td className="px-4 py-3 font-medium">{issue.title}</td>
                <td className="px-4 py-3">
                  <Badge className={STATUS_BADGE[issue.status]}>{STATUS_TAB_LABELS[issue.status] ?? issue.status}</Badge>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {format(new Date(issue.created_at), 'd MMM yyyy')}
                </td>
                <td className="px-4 py-3">
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modals */}
      {showCreate && (
        <NewIssueModal
          onClose={() => setShowCreate(false)}
          onSave={body => createMut.mutate(body)}
          isSaving={createMut.isPending}
        />
      )}

      {/* Detail panel backdrop */}
      {selected && (
        <>
          <div
            className="fixed inset-0 bg-black/20 z-30"
            onClick={() => setSelected(null)}
          />
          <DetailPanel
            issue={selected}
            onClose={() => setSelected(null)}
            isPlatformAdmin={isPlatformAdmin}
            onUpdate={body => patchMut.mutate({ id: selected.id, ...body })}
            isUpdating={patchMut.isPending}
          />
        </>
      )}
    </div>
  )
}
