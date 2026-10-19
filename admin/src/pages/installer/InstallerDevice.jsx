// src/pages/installer/InstallerDevice.jsx
//
// One device's page in the installer (/install/device/:kind/:id): its state,
// name and settings (explicit Save: PATCH /api/pos/devices/:id, which takes
// the whole settings, or PATCH /api/screens/screens/:id), Identify and
// Reload for a menu screen, moving it to a new device (link one showing a
// code) and removing it (asks twice).
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNowStrict } from 'date-fns'
import { Save, Eye, RefreshCw, QrCode, Trash2 } from 'lucide-react'
import { useApi } from '@/lib/api'
import {
  useInstaller, useOverview, canChange, KINDS, KindIcon, Card, BigButton, ErrorNote, Field, Choice,
  KindSettings, inputClass, deviceState, Pill,
} from './shared'
import { Loading } from './InstallerHome'

const ROTATIONS = [0, 90, 180, 270]

export default function InstallerDevice() {
  const { kind, id } = useParams()
  const { venueId } = useInstaller()
  const { data: o, isLoading } = useOverview(venueId)
  if (!KINDS[kind]) return <ErrorNote>That isn't a kind of device.</ErrorNote>
  if (isLoading || !o) return <Loading />
  const list = kind === 'screen' ? o.screens || [] : (o.devices || []).filter(d => d.kind === kind)
  const device = list.find(d => d.id === id)
  if (!device) {
    return (
      <div className="space-y-3">
        <ErrorNote>That {KINDS[kind].label.toLowerCase()} isn't at this venue (it may have been removed, or another venue is picked).</ErrorNote>
        <BigButton as={Link} to="/install">Back to the list</BigButton>
      </div>
    )
  }
  const manage = canChange(o.can, kind)
  return (
    <div className="space-y-4" data-testid="installer-device">
      <About kind={kind} device={device} />
      {manage && <Edit key={device.id} kind={kind} device={device} overview={o} venueId={venueId} />}
      {kind === 'screen' && <FindScreen device={device} manage={manage} />}
      {manage && <NewDevice kind={kind} device={device} />}
      {manage && <Remove kind={kind} device={device} venueId={venueId} />}
    </div>
  )
}

function About({ kind, device }) {
  const st = deviceState(device)
  const seen = device.last_seen_at ? formatDistanceToNowStrict(new Date(device.last_seen_at), { addSuffix: true }) : null
  const rows = [
    ['Number', device.short_code],
    ['Last seen', seen || 'Not yet'],
    kind === 'screen' && ['Size', `${device.width} x ${device.height}${device.rotation ? ', turned ' + device.rotation + '°' : ''}`],
    kind === 'screen' && ['Shows', device.wall ? `The wall ${device.wall.name}` + (device.shows?.name ? ': ' + device.shows.name : '') : device.shows?.name || 'Nothing yet'],
    device.app_version && ['App', device.app_version],
  ].filter(Boolean)
  return (
    <Card>
      <div className="flex items-center gap-3">
        <KindIcon kind={kind} />
        <div className="flex-1 min-w-0">
          <div className="text-lg font-semibold truncate">{device.name}</div>
          <div className="text-xs text-muted-foreground">{KINDS[kind].label}</div>
        </div>
        <Pill tone={st.tone}>{st.label}</Pill>
      </div>
      <dl className="mt-3 divide-y text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-3 py-2"><dt className="w-24 shrink-0 text-muted-foreground">{k}</dt><dd className="min-w-0 break-words">{v}</dd></div>
        ))}
      </dl>
      {!device.paired && (
        <p className="mt-2 text-sm text-amber-900">No device is linked to it. Link one below.</p>
      )}
    </Card>
  )
}

function Edit({ kind, device, overview, venueId }) {
  const api = useApi()
  const qc = useQueryClient()
  const start = useMemo(() => (kind === 'screen'
    ? { name: device.name, settings: { design_id: device.design_id || null, playlist_id: device.playlist_id || null }, rotation: device.rotation || 0 }
    : { name: device.name, settings: device.settings || {} }), [kind, device])
  const [draft, setDraft] = useState(start)
  const [saved, setSaved] = useState(false)
  // The list refreshes every 10 s: take a change made elsewhere only while
  // nothing here is being edited.
  const startKey = JSON.stringify(start)
  const last = useRef(startKey)
  useEffect(() => {
    if (startKey === last.current) return
    setDraft(d => (JSON.stringify(d) === last.current ? JSON.parse(startKey) : d))
    last.current = startKey
  }, [startKey])
  const dirty = JSON.stringify(draft) !== startKey
  const save = useMutation({
    mutationFn: () => kind === 'screen'
      ? api.patch(`/screens/screens/${device.id}`, {
          name: draft.name.trim(), rotation: draft.rotation,
          ...(device.wall ? {} : { design_id: draft.settings.design_id || null, playlist_id: draft.settings.playlist_id || null }),
        })
      : api.patch(`/pos/devices/${device.id}`, { name: draft.name.trim(), settings: { ...(device.settings || {}), ...draft.settings } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['installer', venueId] })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    },
  })
  return (
    <Card title="Name and settings">
      <div className="space-y-4">
        <Field label="Name">
          <input className={inputClass} value={draft.name} maxLength={kind === 'screen' ? 80 : 60}
            onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} data-testid="device-name" />
        </Field>
        {kind === 'screen' && device.wall
          ? <p className="text-sm text-muted-foreground">It is part of the wall {device.wall.name}: the wall decides what it shows (Screens page, Walls).</p>
          : <KindSettings kind={kind} settings={draft.settings} overview={overview}
              onChange={settings => setDraft(d => ({ ...d, settings }))} />}
        {kind === 'screen' && (
          <Field label="Turned" hint="How the screen is mounted: 90 for a screen on its side.">
            <Choice value={draft.rotation} onChange={rotation => setDraft(d => ({ ...d, rotation }))}
              options={ROTATIONS.map(r => ({ value: r, label: r + '°' }))} />
          </Field>
        )}
        <ErrorNote>{save.error?.message}</ErrorNote>
        <BigButton primary disabled={!dirty || !draft.name.trim() || save.isPending} onClick={() => save.mutate()} data-testid="device-save">
          <Save className="w-5 h-5" /> {save.isPending ? 'Saving…' : saved ? 'Saved' : 'Save'}
        </BigButton>
      </div>
    </Card>
  )
}

function FindScreen({ device, manage }) {
  const api = useApi()
  const identify = useMutation({ mutationFn: () => api.post(`/screens/screens/${device.id}/identify`, {}) })
  const reload = useMutation({ mutationFn: () => api.post(`/screens/screens/${device.id}/reload`, {}) })
  return (
    <Card title="Find it">
      <div className="grid gap-2">
        <BigButton disabled={!device.paired || identify.isPending} onClick={() => identify.mutate()} data-testid="identify">
          <Eye className="w-5 h-5" /> {identify.isSuccess ? 'Showing its name for 20 seconds' : 'Show its name on the screen'}
        </BigButton>
        {manage && (
          <BigButton disabled={!device.paired || reload.isPending} onClick={() => reload.mutate()}>
            <RefreshCw className="w-5 h-5" /> {reload.isSuccess ? 'Reloading' : 'Reload the screen'}
          </BigButton>
        )}
        <ErrorNote>{identify.error?.message || reload.error?.message}</ErrorNote>
      </div>
    </Card>
  )
}

function NewDevice({ kind, device }) {
  return (
    <Card title={device.paired ? 'Move it to a new device' : 'Link a device to it'}>
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {device.paired
            ? 'For a broken or replaced device: the new one keeps this name and settings, and the old one stops working.'
            : 'The device keeps this name and settings.'}
        </p>
        <BigButton as={Link} to={`/install/link?replace=${device.id}&kind=${kind}`} data-testid="replace-link">
          <QrCode className="w-5 h-5" /> Link a device showing a code
        </BigButton>
      </div>
    </Card>
  )
}

function Remove({ kind, device, venueId }) {
  const api = useApi()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [asking, setAsking] = useState(false)
  const remove = useMutation({
    mutationFn: () => api.delete(kind === 'screen' ? `/screens/screens/${device.id}` : `/pos/devices/${device.id}`),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['installer', venueId] })
      navigate('/install', { replace: true })
    },
  })
  return (
    <Card title="Remove">
      {!asking ? (
        <BigButton onClick={() => setAsking(true)} className="text-red-700" data-testid="remove">
          <Trash2 className="w-5 h-5" /> Remove {device.name}
        </BigButton>
      ) : (
        <div className="space-y-3">
          <p className="text-sm font-medium">
            Remove {device.name}? {kind === 'screen'
              ? 'The screen goes back to showing a code.'
              : 'The device stops working at once' + (kind === 'terminal' ? '; sales it hasn\'t sent yet are lost' : '') + '.'}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <BigButton onClick={() => setAsking(false)}>Keep it</BigButton>
            <BigButton danger disabled={remove.isPending} onClick={() => remove.mutate()} data-testid="remove-yes">Yes, remove</BigButton>
          </div>
          <ErrorNote>{remove.error?.message}</ErrorNote>
        </div>
      )}
    </Card>
  )
}
