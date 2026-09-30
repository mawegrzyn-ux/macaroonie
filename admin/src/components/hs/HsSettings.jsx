// src/components/hs/HsSettings.jsx
//
// Tenant-wide H&S settings (/api/hs-settings, migration 124), shared by
// Food safety, Checklists and the H&S Dashboards.
//
//   HsSettingsButton   button + settings window: General (tenant-wide
//                      switches, owner/admin, explicit Save) and the
//                      per-venue food safety setup from HsSetup.jsx
//                      (food safety manage). Optional venueId / section
//                      open it on a venue and section.
//   ClosedDayNotice    banner when checks aren't required at a venue on a
//                      date (setting on + venue closed per its schedule)
//
// The API decides "closed" (services/openDays.js); this file only shows it.

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Settings2, X, Loader2, DoorClosed } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { SETUP_SECTIONS, HsSetupSection } from '@/components/hs/HsSetup'

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

export function HsSettingsButton({ venueId = null, section = null, label = 'H&S settings', className }) {
  const api = useApi()
  const [open, setOpen] = useState(false)
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api.get('/me'), staleTime: 60_000 })
  const access = hsAccess(me)
  if (!access.general && !access.setup) return null
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className={className || 'inline-flex items-center gap-1.5 rounded-lg border hover:bg-accent px-3 py-2 text-sm font-medium min-h-[44px] touch-manipulation'}>
        <Settings2 className="w-4 h-4" /> {label}
      </button>
      {open && <HsSettingsModal access={access} initialVenueId={venueId} initialSection={section} onClose={() => setOpen(false)} />}
    </>
  )
}

// General (tenant-wide) needs owner/admin, as the API does; the venue
// setup lists need food safety manage.
function hsAccess(me) {
  const admin = !!(me?.is_platform_admin || me?.role === 'owner' || me?.role === 'admin')
  return { general: admin, setup: admin || me?.permissions?.food_safety === 'manage' }
}

function HsSettingsModal({ access, initialVenueId, initialSection, onClose }) {
  const api = useApi()
  const sections = [
    ...(access.general ? [{ key: 'general', label: 'General' }] : []),
    ...(access.setup ? SETUP_SECTIONS : []),
  ]
  const [section, setSection] = useState(() =>
    sections.some(s => s.key === initialSection) ? initialSection : sections[0].key)
  const { data: venues = [] } = useQuery({ queryKey: ['venues'], queryFn: () => api.get('/venues'), enabled: access.setup })
  const [picked, setPicked] = useState(initialVenueId || '')
  const venueId = picked || venues[0]?.id || ''

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-background rounded-xl shadow-xl w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b shrink-0">
          <h2 className="text-lg font-semibold">H&amp;S settings</h2>
          <button type="button" onClick={onClose} className="w-11 h-11 flex items-center justify-center rounded hover:bg-accent touch-manipulation" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 min-h-0 flex flex-col md:flex-row">
          <nav className="shrink-0 md:w-52 border-b md:border-b-0 md:border-r p-2 flex md:flex-col gap-1 overflow-x-auto">
            {sections.map(s => (
              <button key={s.key} type="button" onClick={() => setSection(s.key)} aria-pressed={section === s.key}
                className={cn(
                  'shrink-0 text-left rounded-lg px-3 min-h-[44px] text-sm font-medium whitespace-nowrap touch-manipulation',
                  section === s.key ? 'bg-primary text-primary-foreground' : 'hover:bg-accent text-muted-foreground',
                )}>
                {s.label}
              </button>
            ))}
          </nav>
          <div className="flex-1 min-w-0 overflow-y-auto p-5">
            {section === 'general' ? (
              <GeneralSettings onClose={onClose} />
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                  <h3 className="font-semibold">{sections.find(s => s.key === section)?.label}</h3>
                  {venues.length > 1 && (
                    <select value={venueId} onChange={e => setPicked(e.target.value)} aria-label="Venue"
                      className="border rounded-lg px-3 text-sm bg-background min-h-[44px] touch-manipulation">
                      {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                    </select>
                  )}
                </div>
                <HsSetupSection key={section + venueId} section={section} venueId={venueId} />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// Tenant-wide switches. Explicit Save.
function GeneralSettings({ onClose }) {
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
      setFollow(null)
    },
  })

  if (isLoading) return <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
  return (
    <div className="max-w-xl">
      <h3 className="font-semibold mb-4">General</h3>
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

      {save.error && <p className="text-sm text-destructive mt-3">{save.error.message}</p>}

      <div className="flex justify-end gap-2 mt-6">
        <button type="button" onClick={onClose}
          className="px-4 py-2 rounded-lg border text-sm min-h-[44px] touch-manipulation">Close</button>
        <button type="button" onClick={() => save.mutate()} disabled={!dirty || save.isPending}
          className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium min-h-[44px] touch-manipulation disabled:opacity-50">
          {save.isPending ? 'Saving…' : save.isSuccess && !dirty ? 'Saved' : 'Save'}
        </button>
      </div>
    </div>
  )
}
