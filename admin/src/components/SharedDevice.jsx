// src/components/SharedDevice.jsx
//
// Shared devices in the admin (Pepper-first step 6a, migration 280;
// lib/sharedDevice.js holds the state, the API is the judge):
//
//   SharedDeviceLayer     mounted by AppShell and MobileShell: asks "Who is
//                         this?" (a name, then a PIN on a pad) when a change
//                         comes back asking, shows who is switched in with a
//                         one-tap Lock, locks after IDLE_MS without a tap,
//                         and checks the device is still shared.
//   SharedDeviceSettings  Settings and the phone's This device page: mark this
//                         device shared for a venue (Settings Manage), stop
//                         it, and the group's other shared devices.
//   OfficePinSettings     the person's own office PIN (never on a shared device).

import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Lock, UserRound, X, Delete, Loader2, Tablet, KeyRound, Check } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { usePermission } from '@/hooks/usePermission'
import { inOfficeApp } from '@/lib/officeApp'
import {
  useSharedDevice, setWhoHandler, setServerCalls, startPerson, endPerson, personToken, touched,
  keepDevice, forgetDevice,
} from '@/lib/sharedDevice'

// A keyboard for the PIN only where there is no touch screen (a desk computer).
const IS_TOUCH = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0
const errText = e => e?.body?.error || e?.message || 'Something went wrong'
const btn = 'inline-flex items-center justify-center gap-2 min-h-[48px] px-4 rounded-lg border text-sm font-medium touch-manipulation hover:bg-muted disabled:opacity-50'
const btnPrimary = 'inline-flex items-center justify-center gap-2 min-h-[48px] px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold touch-manipulation disabled:opacity-50'

// ── The layer: Who is this?, the person's pill, Lock ─────────────

export function SharedDeviceLayer() {
  const api = useApi()
  const qc = useQueryClient()
  const { device, person } = useSharedDevice()
  const [asking, setAsking] = useState(null)   // { code, resolve, reject }

  // How lib/sharedDevice.js reaches the server and the PIN pad.
  useEffect(() => {
    setServerCalls({
      // Idle: the person is already gone here; with no person token the server ends whoever is on this device.
      lock: () => api.post('/shared-devices/lock', {}).catch(() => {}),
      stillHere: () => api.post('/shared-devices/still-here', {}).then(r => { if (!r?.person) endPerson() }).catch(() => {}),
    })
    setWhoHandler(code => new Promise((resolve, reject) => setAsking({ code, resolve, reject })))
    return () => setWhoHandler(null)
  }, [api])

  // Still shared? (Stopped from another device: forget it here.)
  useEffect(() => {
    if (!device) return
    api.get('/shared-devices/this').catch(e => { if (e?.status === 404) forgetDevice() })
  }, [api, device?.token])   // eslint-disable-line react-hooks/exhaustive-deps

  // Every tap or key keeps the person switched in.
  useEffect(() => {
    if (!person) return
    const on = () => touched()
    window.addEventListener('pointerdown', on, true)
    window.addEventListener('keydown', on, true)
    return () => { window.removeEventListener('pointerdown', on, true); window.removeEventListener('keydown', on, true) }
  }, [person])

  async function lock() {
    const token = personToken()
    endPerson()
    if (token) await api.post('/shared-devices/lock', {}).catch(() => {})
    qc.invalidateQueries()
  }

  if (!device) return null
  return (
    <>
      <div className="fixed z-[60] right-3 bottom-3 touch:max-[700px]:bottom-[4.5rem] flex items-center gap-1 rounded-full border bg-background shadow-lg pl-3 pr-1 py-1"
        data-testid="shared-pill">
        <Tablet className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden />
        {person ? (
          <>
            <span className="text-sm font-medium max-w-[10rem] truncate" data-testid="shared-person">{person.name}</span>
            <span className="text-[11px] text-muted-foreground">{person.kind === 'till' ? 'till PIN' : 'office PIN'}</span>
            <button type="button" onClick={lock} data-testid="shared-lock"
              className="ml-1 inline-flex items-center gap-1.5 min-h-[48px] px-4 rounded-full bg-primary text-primary-foreground text-sm font-semibold touch-manipulation">
              <Lock className="w-4 h-4" /> Lock
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setAsking({ code: 'person_needed', resolve: () => {}, reject: () => {} })}
            data-testid="shared-who"
            className="inline-flex items-center gap-1.5 min-h-[48px] px-3 rounded-full text-sm font-medium touch-manipulation hover:bg-muted">
            <UserRound className="w-4 h-4" /> {device.name}: who is this?
          </button>
        )}
      </div>
      {asking && (
        <WhoIsThis code={asking.code}
          onDone={() => { const a = asking; setAsking(null); qc.invalidateQueries({ queryKey: ['me'] }); a.resolve() }}
          onClose={() => {
            const a = asking
            setAsking(null)
            const err = new Error('Nobody said who they are, so nothing was saved.')
            err.body = { error: err.message, code: 'person_cancelled' }
            a.reject(err)
          }} />
      )}
    </>
  )
}

/** "Who is this?": a name, then a PIN on a pad. code office_pin_needed lists office PINs only. */
function WhoIsThis({ code, onDone, onClose }) {
  const api = useApi()
  const officeOnly = code === 'office_pin_needed'
  const { data, isLoading, error } = useQuery({ queryKey: ['shared-people'], queryFn: () => api.get('/shared-devices/people'), staleTime: 30_000 })
  const [who, setWho] = useState(null)
  const [pin, setPin] = useState('')
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(false)
  const people = (data?.people || []).filter(p => !officeOnly || p.pin === 'office')

  async function go(value = pin) {
    if (!who || value.length < 4 || busy) return
    setBusy(true)
    setMessage(null)
    try {
      const r = await api.post('/shared-devices/act', { person: who.key, pin: value })
      startPerson(r.token, r.person)
      onDone()
    } catch (e) {
      setPin('')
      setMessage(errText(e) + (e?.body?.tries_left ? ' ' + e.body.tries_left + (e.body.tries_left === 1 ? ' try' : ' tries') + ' left.' : ''))
    } finally {
      setBusy(false)
    }
  }
  const press = d => { if (pin.length < 6) setPin(pin + d) }

  return (
    <div className="fixed inset-0 z-[70] bg-black/40 flex items-end sm:items-center justify-center p-3" data-testid="who-modal">
      <div className="w-full max-w-md bg-background rounded-2xl shadow-xl max-h-[85vh] overflow-y-auto">
        <div className="section-head px-4 py-3 flex items-center gap-2">
          <h2 className="text-base font-semibold flex-1">{who ? 'PIN for ' + who.name : 'Who is this?'}</h2>
          <button type="button" onClick={onClose} aria-label="Close" data-testid="who-close"
            className="w-12 h-12 -mr-2 flex items-center justify-center rounded-lg touch-manipulation hover:bg-muted">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            {officeOnly
              ? 'A till PIN is enough for logging checks only. For this change, pick yourself and type your office PIN.'
              : 'This is a shared device. Pick your name and type your PIN before making a change. A till PIN logs checks; anything else needs your office PIN.'}
          </p>
          {!who && (
            isLoading ? <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading names</p>
              : error ? <p className="text-sm text-destructive">{errText(error)}</p>
              : people.length === 0 ? (
                <p className="text-sm" data-testid="who-nobody">
                  {officeOnly ? 'Nobody has set an office PIN yet. Each person sets their own in Settings on their own phone or computer.'
                    : 'Nobody here has a till PIN or an office PIN yet.'}
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {people.map(p => (
                    <button key={p.key} type="button" onClick={() => { setWho(p); setPin(''); setMessage(null) }}
                      data-testid="who-person" data-pin={p.pin}
                      className="min-h-[56px] px-3 rounded-xl border text-left touch-manipulation hover:bg-muted">
                      <span className="block text-sm font-medium truncate">{p.name}</span>
                      <span className="block text-[11px] text-muted-foreground">{p.pin === 'till' ? 'Till PIN' : 'Office PIN'}</span>
                    </button>
                  ))}
                </div>
              )
          )}
          {who && (
            <div className="space-y-3">
              <div className="flex justify-center gap-2" aria-label={pin.length + ' digits typed'} data-testid="who-dots">
                {[0, 1, 2, 3, 4, 5].map(i => (
                  <span key={i} className={cn('w-3.5 h-3.5 rounded-full border-2', i < pin.length ? 'bg-primary border-primary' : 'border-muted-foreground/40')} />
                ))}
              </div>
              {/* Typed from a keyboard too (a desk computer). */}
              {!IS_TOUCH && (
                <input type="password" inputMode="numeric" autoComplete="off" value={pin} autoFocus
                  onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  onKeyDown={e => { if (e.key === 'Enter') go() }}
                  aria-label="PIN" data-testid="who-pin"
                  className="sr-only" />
              )}
              {message && <p className="text-sm text-destructive text-center" data-testid="who-error">{message}</p>}
              <div className="grid grid-cols-3 gap-2">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => (
                  <button key={d} type="button" onClick={() => press(d)} data-testid={'who-key-' + d}
                    className="h-14 rounded-xl border text-xl font-semibold touch-manipulation hover:bg-muted">{d}</button>
                ))}
                <button type="button" onClick={() => setPin(pin.slice(0, -1))} aria-label="Delete a digit"
                  className="h-14 rounded-xl border flex items-center justify-center touch-manipulation hover:bg-muted"><Delete className="w-5 h-5" /></button>
                <button type="button" onClick={() => press('0')} data-testid="who-key-0"
                  className="h-14 rounded-xl border text-xl font-semibold touch-manipulation hover:bg-muted">0</button>
                <button type="button" onClick={() => go()} disabled={pin.length < 4 || busy} data-testid="who-ok"
                  className="h-14 rounded-xl bg-primary text-primary-foreground font-semibold touch-manipulation disabled:opacity-50 flex items-center justify-center">
                  {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : 'OK'}
                </button>
              </div>
              <button type="button" onClick={() => { setWho(null); setPin(''); setMessage(null) }} className={cn(btn, 'w-full')}>
                Not {who.name}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Settings: this device, and the group's shared devices ────────

function Card({ title, children, testId }) {
  return (
    <div className="rounded-xl border bg-background overflow-hidden" data-testid={testId}>
      <div className="section-head px-4 py-2.5 text-sm font-semibold">{title}</div>
      <div className="p-4 space-y-3">{children}</div>
    </div>
  )
}

function Confirmed({ label, confirmLabel, onConfirm, disabled, testId }) {
  const [asking, setAsking] = useState(false)
  if (asking) {
    return (
      <span className="inline-flex flex-wrap gap-2">
        <button type="button" disabled={disabled} onClick={() => { setAsking(false); onConfirm() }} data-testid={testId + '-yes'}
          className="min-h-[48px] px-4 rounded-lg bg-destructive text-destructive-foreground text-sm font-medium touch-manipulation disabled:opacity-50">{confirmLabel}</button>
        <button type="button" onClick={() => setAsking(false)} className={btn}>Cancel</button>
      </span>
    )
  }
  return <button type="button" disabled={disabled} onClick={() => setAsking(true)} className={btn} data-testid={testId}>{label}</button>
}

export function SharedDeviceSettings() {
  const api = useApi()
  const qc = useQueryClient()
  const { device } = useSharedDevice()
  const { canView, canManage } = usePermission('settings')
  const { data: venues = [] } = useQuery({ queryKey: ['venues'], queryFn: () => api.get('/venues') })
  const { data: devices = [] } = useQuery({ queryKey: ['shared-devices'], queryFn: () => api.get('/shared-devices'), enabled: canView })
  const [venueId, setVenueId] = useState('')
  const [name, setName] = useState('')
  const [message, setMessage] = useState(null)
  useEffect(() => { if (!venueId && venues.length) setVenueId(venues[0].id) }, [venues, venueId])

  const mark = useMutation({
    mutationFn: () => api.post('/shared-devices', { venue_id: venueId, name: name.trim(), kind: inOfficeApp() ? 'office_app' : 'browser' }),
    onSuccess: r => { keepDevice(r.device, r.token); setName(''); setMessage('This device is now shared for ' + r.device.venue_name + '.'); qc.invalidateQueries({ queryKey: ['shared-devices'] }) },
    onError: e => setMessage(errText(e)),
  })
  const stop = useMutation({
    mutationFn: id => api.delete('/shared-devices/' + id),
    onSuccess: (_, id) => {
      if (device?.id === id) { endPerson(); forgetDevice() }
      setMessage('Stopped.')
      qc.invalidateQueries({ queryKey: ['shared-devices'] })
    },
    onError: e => setMessage(errText(e)),
  })

  return (
    <Card title="Shared device" testId="shared-settings">
      {device ? (
        <div className="space-y-2">
          <p className="text-sm" data-testid="shared-this">
            This device is shared for <strong>{device.venue_name}</strong> as <strong>{device.name}</strong>. Before
            any change on it, people say who they are with their PIN, and Lock is always one tap.
          </p>
          {canManage && <Confirmed label="Stop sharing this device" confirmLabel="Yes, stop sharing" testId="shared-stop"
            disabled={stop.isPending} onConfirm={() => stop.mutate(device.id)} />}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            A tablet in the kitchen or a phone at the pass that several people use: mark it as shared and
            each change on it is made as the person who typed their PIN, not as you.
          </p>
          {canManage ? (
            <>
              <label className="block text-sm font-medium">Venue
                <select value={venueId} onChange={e => setVenueId(e.target.value)} data-testid="shared-venue"
                  className="mt-1 w-full min-h-[48px] rounded-lg border bg-background px-3 text-sm touch-manipulation">
                  {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </label>
              <label className="block text-sm font-medium">This device's name
                <input value={name} onChange={e => setName(e.target.value.slice(0, 60))} placeholder="Kitchen tablet" data-testid="shared-name"
                  className="mt-1 w-full min-h-[48px] rounded-lg border bg-background px-3 text-sm touch-manipulation" />
              </label>
              <button type="button" className={btnPrimary} disabled={!venueId || !name.trim() || mark.isPending}
                onClick={() => mark.mutate()} data-testid="shared-mark">
                {mark.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Tablet className="w-4 h-4" />} Mark this device as shared
              </button>
            </>
          ) : <p className="text-sm">An owner or admin (Settings Manage) marks a device as shared.</p>}
        </div>
      )}
      {message && <p className="text-sm" data-testid="shared-message">{message}</p>}
      {canView && devices.length > 0 && (
        <div className="border-t pt-3 space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">The group's shared devices</p>
          {devices.map(d => (
            <div key={d.id} className="flex items-center gap-2 min-h-[48px]" data-testid="shared-device-row">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{d.name}{device?.id === d.id ? ' (this one)' : ''}</p>
                <p className="text-xs text-muted-foreground truncate">{d.venue_name}{d.person_name ? ' · ' + d.person_name + ' is on it' : ''}</p>
              </div>
              {canManage && device?.id !== d.id && (
                <Confirmed label="Stop" confirmLabel="Yes, stop" testId="shared-device-stop" disabled={stop.isPending} onConfirm={() => stop.mutate(d.id)} />
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

export function OfficePinSettings() {
  const api = useApi()
  const qc = useQueryClient()
  const { device } = useSharedDevice()
  const { data } = useQuery({ queryKey: ['office-pin'], queryFn: () => api.get('/shared-devices/my-pin'), enabled: !device })
  const [pin, setPin] = useState('')
  const [again, setAgain] = useState('')
  const [message, setMessage] = useState(null)
  const save = useMutation({
    mutationFn: () => api.put('/shared-devices/my-pin', { pin }),
    onSuccess: () => { setPin(''); setAgain(''); setMessage('Your office PIN is saved.'); qc.invalidateQueries({ queryKey: ['office-pin'] }) },
    onError: e => setMessage(errText(e)),
  })
  const remove = useMutation({
    mutationFn: () => api.delete('/shared-devices/my-pin'),
    onSuccess: () => { setMessage('Your office PIN is removed.'); qc.invalidateQueries({ queryKey: ['office-pin'] }) },
    onError: e => setMessage(errText(e)),
  })
  const field = 'mt-1 w-full min-h-[48px] rounded-lg border bg-background px-3 text-lg tracking-widest touch-manipulation'
  const ok = /^\d{4,6}$/.test(pin) && pin === again

  return (
    <Card title="Your office PIN" testId="office-pin">
      {device ? (
        <p className="text-sm">Set your own PIN on your own phone or computer, not on a shared device.</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            On a shared device you say who you are with this PIN before a change. It lets you do what your own role
            may do there, never more. Your till PIN is enough for logging checks only. 4 to 6 digits, kept only as a hash.
          </p>
          <p className="text-sm flex items-center gap-2" data-testid="office-pin-state">
            {data?.set ? <><Check className="w-4 h-4 text-green-600" /> You have an office PIN.</> : <><KeyRound className="w-4 h-4" /> No office PIN yet.</>}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-sm font-medium">{data?.set ? 'New PIN' : 'PIN'}
              <input type="password" inputMode="numeric" autoComplete="new-password" value={pin} data-testid="office-pin-input"
                onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} className={field} />
            </label>
            <label className="text-sm font-medium">Again
              <input type="password" inputMode="numeric" autoComplete="new-password" value={again} data-testid="office-pin-again"
                onChange={e => setAgain(e.target.value.replace(/\D/g, '').slice(0, 6))} className={field} />
            </label>
          </div>
          {pin.length >= 4 && again.length >= pin.length && pin !== again && <p className="text-sm text-destructive">The two PINs differ.</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnPrimary} disabled={!ok || save.isPending} onClick={() => save.mutate()} data-testid="office-pin-save">
              {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save PIN
            </button>
            {data?.set && <Confirmed label="Remove my PIN" confirmLabel="Yes, remove it" testId="office-pin-remove" disabled={remove.isPending} onConfirm={() => remove.mutate()} />}
          </div>
        </>
      )}
      {message && <p className="text-sm" data-testid="office-pin-message">{message}</p>}
    </Card>
  )
}
