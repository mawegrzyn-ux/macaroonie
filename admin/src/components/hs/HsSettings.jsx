// src/components/hs/HsSettings.jsx
//
// Tenant-wide H&S settings (/api/hs-settings, migration 124), shared by
// Food safety, Checklists and the H&S Dashboards.
//
//   HsSettingsButton   gear button + modal (owner/admin only), explicit Save
//   ClosedDayNotice    banner when checks aren't required at a venue on a
//                      date (setting on + venue closed per its schedule)
//
// The API decides "closed" (services/openDays.js); this file only shows it.

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Settings2, X, Loader2, DoorClosed } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'

export function useHsDay(venueId, date) {
  const api = useApi()
  return useQuery({
    queryKey: ['hs-settings', venueId ?? null, date ?? null],
    queryFn: () => api.get(venueId && date ? `/hs-settings?venue_id=${venueId}&date=${date}` : '/hs-settings'),
    staleTime: 60_000,
  })
}

export function ClosedDayNotice({ venueId, date, className }) {
  const { data } = useHsDay(venueId, date)
  if (!data?.closed) return null
  return (
    <div className={cn('flex items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-700 px-3 py-2.5 text-sm', className)}>
      <DoorClosed className="w-4 h-4 mt-0.5 shrink-0" />
      <p>
        <span className="font-medium">Closed on this day.</span>{' '}
        Food safety checks and daily checklists aren&apos;t needed. Anything you record still counts.
      </p>
    </div>
  )
}

export function HsSettingsButton() {
  const api = useApi()
  const [open, setOpen] = useState(false)
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api.get('/me'), staleTime: 60_000 })
  const canEdit = me?.is_platform_admin || me?.role === 'owner' || me?.role === 'admin'
  if (!canEdit) return null
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border hover:bg-accent px-3 py-2 text-sm font-medium min-h-[44px] touch-manipulation">
        <Settings2 className="w-4 h-4" /> H&amp;S settings
      </button>
      {open && <HsSettingsModal onClose={() => setOpen(false)} />}
    </>
  )
}

function HsSettingsModal({ onClose }) {
  const api = useApi()
  const qc = useQueryClient()
  const { data, isLoading } = useHsDay(null, null)
  const [follow, setFollow] = useState(null)
  const value = follow ?? data?.follow_opening_days ?? false
  const dirty = follow !== null && follow !== data?.follow_opening_days

  const save = useMutation({
    mutationFn: () => api.patch('/hs-settings', { follow_opening_days: value }),
    onSuccess: () => {
      for (const key of ['hs-settings', 'checklists-due', 'dashboard-hs-status-today', 'dashboard-hs-status-week']) {
        qc.invalidateQueries({ queryKey: [key] })
      }
      onClose()
    },
  })

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-background rounded-xl shadow-xl w-full max-w-md max-h-[85vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">H&amp;S settings</h2>
          <button type="button" onClick={onClose} className="w-11 h-11 flex items-center justify-center rounded hover:bg-accent touch-manipulation" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <label className="flex items-start gap-3 cursor-pointer touch-manipulation">
            <input type="checkbox" checked={value} onChange={e => setFollow(e.target.checked)}
              className="mt-1 w-5 h-5 shrink-0" />
            <span>
              <span className="block text-sm font-medium">Follow restaurant opening days</span>
              <span className="block text-sm text-muted-foreground mt-1">
                On days a venue is closed, food safety checks (fridges and freezers, hot/cold
                holding, cooking) and daily checklists aren&apos;t expected, and the Overview shows
                the day as Closed. Weekly and monthly checklists are still due. Opening days come
                from each venue&apos;s booking schedule (Setup, Schedule), including closures and
                special dates. A venue with no schedule counts as open every day. Applies to all
                venues.
              </span>
            </span>
          </label>
        )}

        {save.error && <p className="text-sm text-destructive mt-3">{save.error.message}</p>}

        <div className="flex justify-end gap-2 mt-6">
          <button type="button" onClick={onClose}
            className="px-4 py-2 rounded-lg border text-sm min-h-[44px] touch-manipulation">Cancel</button>
          <button type="button" onClick={() => save.mutate()} disabled={!dirty || save.isPending}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium min-h-[44px] touch-manipulation disabled:opacity-50">
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
