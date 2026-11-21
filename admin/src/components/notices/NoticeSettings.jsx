// src/components/notices/NoticeSettings.jsx
//
// A person's own push notices for the Today tasks (migration 262,
// /api/notices): turn them on for this device (browser push, or the
// Macaroonie Office app's push), what to send (due soon, late, which venues
// and areas, quiet hours: explicit Save), and the devices they go to.
// Shown on the phone app's Notices page and in the office's Settings.
// Notices only ever come for tasks the person can do.

import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Bell, BellOff, Loader2, Send, Smartphone, Monitor } from 'lucide-react'
import { format } from 'date-fns'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ConfirmDelete } from '@/components/staff/shared'
import { pushSupport, turnOnHere, turnOffHere } from '@/lib/push'

const DEVICE_KEY = 'maca_push_device'
const readDevice = () => { try { return localStorage.getItem(DEVICE_KEY) } catch { return null } }
const keepDevice = id => { try { id ? localStorage.setItem(DEVICE_KEY, id) : localStorage.removeItem(DEVICE_KEY) } catch { /* private mode */ } }
const errText = e => e?.body?.error || e?.message || 'Something went wrong'

const btn = 'inline-flex items-center justify-center gap-2 min-h-[48px] px-4 rounded-lg border text-sm font-medium touch-manipulation hover:bg-muted disabled:opacity-50'
const btnPrimary = 'inline-flex items-center justify-center gap-2 min-h-[48px] px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold touch-manipulation disabled:opacity-50'
const chip = on => cn('min-h-[44px] px-3 rounded-full border text-sm touch-manipulation', on ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted')

function Card({ title, children }) {
  return (
    <div className="rounded-xl border bg-background overflow-hidden">
      <div className="section-head px-4 py-2.5 text-sm font-semibold">{title}</div>
      <div className="p-4 space-y-3">{children}</div>
    </div>
  )
}

function Switch({ checked, onChange, label, hint, testId }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} data-testid={testId}
      className="w-full flex items-start gap-3 text-left min-h-[48px] touch-manipulation">
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground mt-0.5">{hint}</span>}
      </span>
      <span className={cn('relative w-11 h-6 mt-0.5 rounded-full transition-colors shrink-0', checked ? 'bg-primary' : 'bg-muted-foreground/30')}>
        <span className={cn('absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all', checked ? 'left-[22px]' : 'left-0.5')} />
      </span>
    </button>
  )
}

export default function NoticeSettings() {
  const api = useApi()
  const qc = useQueryClient()
  const { data, isLoading, error } = useQuery({ queryKey: ['notice-settings'], queryFn: () => api.get('/notices/settings') })
  const { data: venues = [] } = useQuery({ queryKey: ['venues'], queryFn: () => api.get('/venues') })
  const [draft, setDraft] = useState(null)
  const [hereId, setHereId] = useState(() => readDevice())
  const [message, setMessage] = useState(null)
  const support = pushSupport()

  useEffect(() => { if (data && !draft) setDraft(data.settings) }, [data, draft])
  // The device kept here was removed (from another device, or as gone).
  const here = data?.devices?.find(d => d.id === hereId) || null

  const refresh = () => qc.invalidateQueries({ queryKey: ['notice-settings'] })
  const on = useMutation({
    mutationFn: () => turnOnHere(api, data.vapid_public_key),
    onSuccess: d => { keepDevice(d.id); setHereId(d.id); setMessage({ ok: true, text: 'Notices are on for this device.' }); refresh() },
    onError: e => setMessage({ ok: false, text: errText(e) }),
  })
  const off = useMutation({
    mutationFn: () => turnOffHere(api, here?.id),
    onSuccess: () => { keepDevice(null); setHereId(null); setMessage({ ok: true, text: 'Notices are off for this device.' }); refresh() },
    onError: e => setMessage({ ok: false, text: errText(e) }),
  })
  const test = useMutation({
    mutationFn: () => api.post('/notices/test', {}),
    onSuccess: r => setMessage({ ok: r.sent > 0, text: r.sent ? 'Sent a test to ' + r.sent + ' device' + (r.sent === 1 ? '' : 's') + '.' : 'The test didn\'t reach any device. Turn notices off and on again here.' }),
    onError: e => setMessage({ ok: false, text: errText(e) }),
  })
  const save = useMutation({
    mutationFn: () => api.put('/notices/settings', draft),
    onSuccess: r => { setDraft(r.settings); setMessage({ ok: true, text: 'Saved.' }); refresh() },
    onError: e => setMessage({ ok: false, text: errText(e) }),
  })
  const remove = useMutation({
    mutationFn: id => api.delete('/notices/devices/' + id),
    onSuccess: (_, id) => { if (id === hereId) { keepDevice(null); setHereId(null) } refresh() },
  })

  if (isLoading || !draft) {
    return error
      ? <p className="text-sm text-destructive">{errText(error)}</p>
      : <div className="py-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
  }
  const dirty = JSON.stringify(draft) !== JSON.stringify(data.settings)
  const set = patch => setDraft(d => ({ ...d, ...patch }))
  const toggleIn = (key, value) => set({ [key]: draft[key].includes(value) ? draft[key].filter(x => x !== value) : [...draft[key], value] })

  return (
    <div className="space-y-4" data-testid="notice-settings">
      <Card title="This device">
        <p className="text-sm text-muted-foreground">
          A notice when one of today&apos;s tasks is due soon and when it goes late, each sent once, for tasks you can do.
        </p>
        {!support ? (
          <p className="text-sm text-amber-700" data-testid="notice-unsupported">
            This browser can&apos;t show notices. On a phone, add the app to the home screen first, or use the Macaroonie Office app.
          </p>
        ) : here ? (
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-2 text-sm font-medium text-green-700 min-h-[48px]" data-testid="notice-here-on">
              <Bell className="w-4 h-4" /> On for this device
            </span>
            <button type="button" className={btn} onClick={() => test.mutate()} disabled={test.isPending} data-testid="notice-test">
              {test.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send a test
            </button>
            <button type="button" className={btn} onClick={() => off.mutate()} disabled={off.isPending} data-testid="notice-off">
              <BellOff className="w-4 h-4" /> Turn off here
            </button>
          </div>
        ) : (
          <button type="button" className={btnPrimary} onClick={() => on.mutate()} disabled={on.isPending} data-testid="notice-on">
            {on.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bell className="w-4 h-4" />} Turn on notices here
          </button>
        )}
        {message && <p className={cn('text-sm', message.ok ? 'text-green-700' : 'text-destructive')} data-testid="notice-message">{message.text}</p>}
      </Card>

      <Card title="What to send">
        <Switch checked={draft.enabled} onChange={v => set({ enabled: v })} label="Notices" testId="notice-enabled"
          hint="Off: nothing is sent to any of your devices." />
        <Switch checked={draft.due_soon} onChange={v => set({ due_soon: v })} label="Due soon" testId="notice-due-soon"
          hint="Half an hour before a task with a time (a fridge check, a hold check)." />
        <Switch checked={draft.late} onChange={v => set({ late: v })} label="Late" testId="notice-late"
          hint="When a task goes late (a check missed, yesterday's cash-up not done)." />
        <div>
          <p className="text-sm font-medium mb-1.5">Venues</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Venues">
            <button type="button" className={chip(!draft.venue_ids.length)} onClick={() => set({ venue_ids: [] })} aria-pressed={!draft.venue_ids.length}>Every venue</button>
            {venues.map(v => (
              <button key={v.id} type="button" className={chip(draft.venue_ids.includes(v.id))} aria-pressed={draft.venue_ids.includes(v.id)}
                onClick={() => toggleIn('venue_ids', v.id)}>{v.name}</button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-sm font-medium mb-1.5">Areas</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Areas">
            <button type="button" className={chip(!draft.areas.length)} onClick={() => set({ areas: [] })} aria-pressed={!draft.areas.length}>Everything</button>
            {data.areas.map(a => (
              <button key={a.key} type="button" className={chip(draft.areas.includes(a.key))} aria-pressed={draft.areas.includes(a.key)}
                onClick={() => toggleIn('areas', a.key)} data-testid={'notice-area-' + a.key}>{a.label}</button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-sm font-medium mb-1.5">Quiet hours <span className="font-normal text-muted-foreground">(venue time: nothing is sent)</span></p>
          <div className="flex flex-wrap items-center gap-2">
            <input type="time" value={draft.quiet_from || ''} onChange={e => set({ quiet_from: e.target.value || null, quiet_to: draft.quiet_to || (e.target.value ? '07:00' : null) })}
              aria-label="Quiet from" data-testid="notice-quiet-from" className="min-h-[48px] border rounded-lg px-3 text-sm bg-background touch-manipulation" />
            <span className="text-sm">to</span>
            <input type="time" value={draft.quiet_to || ''} onChange={e => set({ quiet_to: e.target.value || null, quiet_from: draft.quiet_from || (e.target.value ? '22:00' : null) })}
              aria-label="Quiet to" data-testid="notice-quiet-to" className="min-h-[48px] border rounded-lg px-3 text-sm bg-background touch-manipulation" />
            {(draft.quiet_from || draft.quiet_to) && (
              <button type="button" className={btn} onClick={() => set({ quiet_from: null, quiet_to: null })}>No quiet hours</button>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          {dirty && <button type="button" className={btn} onClick={() => setDraft(data.settings)}>Discard</button>}
          <button type="button" className={btnPrimary} onClick={() => save.mutate()} disabled={!dirty || save.isPending} data-testid="notice-save">
            {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
          </button>
        </div>
      </Card>

      <Card title="Your devices">
        {!data.devices.length && <p className="text-sm text-muted-foreground">None yet. Turn notices on above, on each device you want them on.</p>}
        <ul className="divide-y" data-testid="notice-devices">
          {data.devices.map(d => (
            <li key={d.id} className="flex items-center gap-3 py-2">
              {d.kind === 'app' ? <Smartphone className="w-4 h-4 shrink-0 text-muted-foreground" /> : <Monitor className="w-4 h-4 shrink-0 text-muted-foreground" />}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{d.label || (d.kind === 'app' ? 'Macaroonie Office app' : 'Browser')}{d.id === hereId ? ' (this device)' : ''}</p>
                <p className={cn('text-xs', d.last_error ? 'text-amber-700' : 'text-muted-foreground')}>
                  {d.last_error ? 'Last notice not delivered: ' + d.last_error : 'Added ' + format(new Date(d.created_at), 'd MMM yyyy')}
                </p>
              </div>
              <ConfirmDelete label="Remove this device" confirmLabel="Yes, remove" onConfirm={() => remove.mutate(d.id)} />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
