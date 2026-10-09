// src/components/platform/InterestPanel.jsx
//
// Register-interest forms from the platform page (macaroonie.com, apex;
// api/src/routes/platformSite.js, table platform_interest, migration 138).
// Platform admins only: GET/PATCH/DELETE /api/platform/interest[/:id].
// Status (new / contacted / closed) saves on tap; notes have their own Save;
// delete asks first.

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { Loader2, Mail, Phone, Trash2, Check } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'

const STATUSES = [
  { value: 'new',       label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'closed',    label: 'Closed' },
]

function InterestRow({ row }) {
  const api = useApi()
  const qc = useQueryClient()
  const [notes, setNotes] = useState(row.notes ?? '')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const refresh = () => qc.invalidateQueries({ queryKey: ['platform-interest'] })

  const patch = useMutation({
    mutationFn: body => api.patch(`/platform/interest/${row.id}`, body),
    onSuccess: refresh,
  })
  const remove = useMutation({
    mutationFn: () => api.delete(`/platform/interest/${row.id}`),
    onSuccess: refresh,
  })
  const notesDirty = notes !== (row.notes ?? '')

  return (
    <div className="px-5 py-4 space-y-3">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-1">
        <div className="flex-1 min-w-[12rem]">
          <p className="text-sm font-semibold">
            {row.name}{row.company ? <span className="font-normal text-muted-foreground"> · {row.company}</span> : null}
          </p>
          <p className="text-xs text-muted-foreground">
            {format(parseISO(row.created_at), 'd MMM yyyy, HH:mm')}
            {row.sites ? ` · ${row.sites} site${row.sites === '1' ? '' : 's'}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={`mailto:${row.email}`}
            className="h-11 px-3 rounded-lg border text-sm inline-flex items-center gap-1.5 hover:bg-muted touch-manipulation">
            <Mail className="w-4 h-4" /> {row.email}
          </a>
          {row.phone && (
            <a href={`tel:${row.phone}`}
              className="h-11 px-3 rounded-lg border text-sm inline-flex items-center gap-1.5 hover:bg-muted touch-manipulation">
              <Phone className="w-4 h-4" /> {row.phone}
            </a>
          )}
        </div>
      </div>

      {row.message && <p className="text-sm whitespace-pre-wrap bg-muted/40 rounded-lg px-3 py-2">{row.message}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border overflow-hidden">
          {STATUSES.map(s => (
            <button key={s.value} type="button" disabled={patch.isPending}
              onClick={() => row.status !== s.value && patch.mutate({ status: s.value })}
              className={cn(
                'h-11 px-3 text-sm font-medium touch-manipulation transition-colors',
                row.status === s.value ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted',
              )}>
              {s.label}
            </button>
          ))}
        </div>
        <div className="ml-auto">
          {confirmDelete ? (
            <span className="inline-flex gap-1">
              <button type="button" onClick={() => remove.mutate()} disabled={remove.isPending}
                className="h-11 px-3 rounded-lg bg-destructive text-destructive-foreground text-sm font-medium touch-manipulation disabled:opacity-50">
                Yes, delete
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)}
                className="h-11 px-3 rounded-lg border text-sm touch-manipulation hover:bg-muted">Cancel</button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirmDelete(true)} aria-label={`Delete ${row.name}`}
              className="w-11 h-11 inline-flex items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 touch-manipulation">
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-2">
        <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes (who called, next step…)"
          aria-label={`Notes for ${row.name}`}
          className="h-11 flex-1 min-w-0 rounded-lg border bg-background px-3 text-sm touch-manipulation focus:outline-none focus:ring-2 focus:ring-primary/40" />
        {notesDirty && (
          <button type="button" onClick={() => patch.mutate({ notes: notes.trim() || null })} disabled={patch.isPending}
            className="h-11 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium touch-manipulation disabled:opacity-50 inline-flex items-center gap-1.5">
            {patch.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Save
          </button>
        )}
      </div>
      {(patch.error || remove.error) && (
        <p className="text-xs text-red-700">{(patch.error || remove.error).message}</p>
      )}
    </div>
  )
}

export default function InterestPanel({ rows, isLoading }) {
  const [show, setShow] = useState('open')
  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
  }
  const list = show === 'open' ? rows.filter(r => r.status !== 'closed') : rows
  return (
    <div className="border rounded-xl overflow-hidden bg-background">
      <div className="px-5 py-3 section-head flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold">Registered interest</h2>
        <span className="text-xs text-muted-foreground">From the form on the platform page</span>
        <div className="ml-auto inline-flex rounded-lg border overflow-hidden">
          {[['open', 'Open'], ['all', 'All']].map(([v, l]) => (
            <button key={v} type="button" onClick={() => setShow(v)}
              className={cn('h-11 px-3 text-sm touch-manipulation', show === v ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted')}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="divide-y">
        {list.map(r => <InterestRow key={r.id} row={r} />)}
        {list.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">
            {rows.length === 0 ? 'Nobody has registered interest yet.' : 'Nothing open.'}
          </p>
        )}
      </div>
    </div>
  )
}
