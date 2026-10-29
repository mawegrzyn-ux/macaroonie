// src/components/pos/DeviceUpdatesSection.jsx
//
// Store tech > Device updates (migration 216): how often this location's
// tills, kiosks, kitchen screens and menu screens ask the server for
// changes. Pushes bring most changes at once; these asks are the safety net,
// so asking less often eases the load on the server and a weak connection.
// One explicit Save; Use these at every location copies them to the rest.

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { PULL_TIMES, PULL_PRESETS, pullTimes, presetOf, asksPerHour, pullText } from '@shared/pos/pullTimes.js'
import { Section, ErrorNote, Btn } from './shared'

// The choices each time offers (seconds), always including its default.
const CHOICES = {
  content: [60, 120, 180, 300, 600, 900, 1800, 3600],
  live: [0, 10, 15, 30, 60, 120, 300, 600],
  screen: [30, 60, 120, 300, 600, 900, 1800, 3600],
  board: [5, 10, 15, 30, 60, 120, 300],
}
const short = secs => (!secs ? 'Off' : secs < 60 ? secs + ' s' : secs % 3600 === 0 ? secs / 3600 + ' h' : Math.round(secs / 60) + ' min')

export function DeviceUpdatesSection({ venueId, setup, canManage }) {
  const api = useApi()
  const qc = useQueryClient()
  const saved = useMemo(() => pullTimes(setup.settings?.pull), [setup.settings?.pull])
  const [form, setForm] = useState(saved)
  useEffect(() => setForm(saved), [saved])
  const [confirmAll, setConfirmAll] = useState(false)
  const [doneAll, setDoneAll] = useState(null)
  const dirty = JSON.stringify(form) !== JSON.stringify(saved)

  const save = useMutation({
    mutationFn: pull => api.patch(`/pos/venues/${venueId}/settings`, { pull }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pos-setup', venueId] }),
  })
  const everywhere = useMutation({
    mutationFn: pull => api.post('/pos/pull-times/everywhere', { pull }),
    onSuccess: r => {
      setConfirmAll(false)
      setDoneAll(r.venues)
      qc.invalidateQueries({ queryKey: ['pos-setup'] })
    },
  })

  // Menu screens of this location, for the estimate (needs Menu screens view;
  // without it the estimate leaves them out).
  const screens = useQuery({
    queryKey: ['screens-list'],
    queryFn: () => api.get('/screens/screens'),
    retry: false,
    staleTime: 60_000,
  })
  const venueScreens = (screens.data?.screens || []).filter(s => s.venue_id === venueId && s.paired).length
  const devices = (setup.devices || []).filter(d => d.paired && !d.revoked_at)
  const count = kind => devices.filter(d => (d.kind || 'terminal') === kind).length
  const rows = [
    { one: 'till', many: 'tills', n: count('terminal'), kind: 'terminal' },
    { one: 'kiosk', many: 'kiosks', n: count('kiosk'), kind: 'kiosk' },
    { one: 'kitchen screen', many: 'kitchen screens', n: count('kds'), kind: 'kds' },
    ...(screens.data ? [{ one: 'menu screen', many: 'menu screens', n: venueScreens, kind: 'screen' }] : []),
  ].filter(r => r.n > 0)
  const perHour = pull => rows.reduce((sum, r) => sum + r.n * asksPerHour(pull, r.kind), 0)
  const preset = presetOf(form)

  return (
    <Section title="Checking for changes" hint="How often this location's devices ask Macaroonie for changes.">
      <p className="text-sm text-muted-foreground">
        Devices are told about a change the moment it happens (a menu published, a dish sold out, a setting saved).
        They also ask now and then, in case they missed being told. Asking less often eases the load on the
        server and on a weak connection; a change they missed then takes longer to show.
      </p>

      <div>
        <p className="text-sm font-medium mb-2">Start from</p>
        <div className="grid sm:grid-cols-3 gap-2" role="group" aria-label="Start from">
          {PULL_PRESETS.map(p => (
            <button key={p.key} type="button" aria-pressed={preset === p.key} data-testid={'pull-preset-' + p.key}
              onClick={() => setForm({ ...p.values })}
              className={cn('text-left rounded-xl border p-3 min-h-[48px] touch-manipulation',
                preset === p.key ? 'border-primary ring-2 ring-primary/30 bg-primary/5' : 'hover:bg-muted')}>
              <span className="block font-medium">{p.label}</span>
              <span className="block text-xs text-muted-foreground mt-0.5">{p.hint}</span>
            </button>
          ))}
        </div>
        {!preset && <p className="text-xs text-muted-foreground mt-1">Your own times.</p>}
      </div>

      <div className="rounded-xl border divide-y">
        {PULL_TIMES.map(def => {
          const opts = [...new Set([...CHOICES[def.key], def.default, form[def.key]])].sort((a, b) => a - b)
          return (
            <div key={def.key} className="p-3 space-y-2" data-testid={'pull-' + def.key}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="font-medium">{def.label}</span>
                <span className="text-xs text-muted-foreground">{def.devices}</span>
              </div>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={def.label}>
                {opts.map(v => (
                  <button key={v} type="button" aria-pressed={form[def.key] === v}
                    onClick={() => setForm(f => ({ ...f, [def.key]: v }))}
                    className={cn('min-h-[44px] min-w-[56px] px-3 rounded-lg border text-sm touch-manipulation',
                      form[def.key] === v ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted')}>
                    {short(v)}{v === def.default ? ' *' : ''}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {form[def.key] === 0
                  ? 'Off: prices and sold out reach these devices when they are told of a change, and with the whole menu.'
                  : 'Every ' + pullText(form[def.key]) + '.'}
              </p>
            </div>
          )
        })}
      </div>
      <p className="text-xs text-muted-foreground">* the standard time.</p>

      {rows.length > 0 && (
        <div className="rounded-xl bg-muted/50 p-3 text-sm" data-testid="pull-estimate">
          <p>
            This location's {rows.map(r => r.n + ' ' + (r.n === 1 ? r.one : r.many)).join(', ')}{' '}
            ask about <b>{Math.round(perHour(form)).toLocaleString('en-GB')}</b> times an hour
            {dirty && <> (now {Math.round(perHour(saved)).toLocaleString('en-GB')})</>}.
          </p>
          <p className="text-xs text-muted-foreground mt-1">Not counting what they are told without asking, or orders, payments and kitchen taps, which go at once.</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 pt-2 border-t">
        <Btn variant="primary" disabled={!dirty || save.isPending} onClick={() => save.mutate(form)} data-testid="pull-save">
          {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save
        </Btn>
        {dirty && <Btn onClick={() => setForm(saved)}>Discard</Btn>}
        {canManage && !dirty && !confirmAll && (
          <Btn onClick={() => { setDoneAll(null); setConfirmAll(true) }} data-testid="pull-everywhere">Use these at every location</Btn>
        )}
        {confirmAll && (
          <span className="flex flex-wrap items-center gap-2 text-sm">
            Set every location's devices to these times?
            <Btn variant="primary" disabled={everywhere.isPending} onClick={() => everywhere.mutate(saved)} data-testid="pull-everywhere-yes">
              {everywhere.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Yes, every location
            </Btn>
            <Btn onClick={() => setConfirmAll(false)}>Cancel</Btn>
          </span>
        )}
        {doneAll != null && <span className="text-sm text-muted-foreground" data-testid="pull-everywhere-done">Done: {doneAll} {doneAll === 1 ? 'location' : 'locations'}.</span>}
        <ErrorNote error={save.error || everywhere.error} />
      </div>
      <p className="text-xs text-muted-foreground">Devices pick a change up the next time they hear from Macaroonie (straight away when they are online).</p>
    </Section>
  )
}
