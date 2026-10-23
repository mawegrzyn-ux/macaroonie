// src/pages/installer/InstallerLink.jsx
//
// Link a device showing a code (/install/link, /install/link/:code; the QR
// code on a till, kitchen screen, kiosk or menu screen opens
// installer.<domain>/link/<code>, which lands here). Looks the code up
// (POST /api/installer/lookup), then links it at the venue being set up as
// a new device or as a new device for one already there:
// POST /api/pos/venues/:id/link (tills, kitchen screens, kiosks) or
// POST /api/screens/screens/claim (menu screens). Explicit Link button.
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, CheckCircle2, Link2, RotateCcw, Loader2 } from 'lucide-react'
import { useApi } from '@/lib/api'
import QrScanner, { CAN_SCAN } from '@/components/installer/QrScanner'
import {
  useInstaller, useOverview, canChange, KINDS, KindIcon, Card, BigButton, ErrorNote, Field, Choice,
  KindSettings, inputClass, tidyCode, suggestName, deviceState, Pill,
} from './shared'
import { VenueButton } from './InstallerHome'

const POS_KINDS = ['terminal', 'kds', 'kiosk']

export default function InstallerLink() {
  const api = useApi()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const params = useParams()
  const [search] = useSearchParams()
  const { venueId, venue } = useInstaller()
  const { data: o } = useOverview(venueId)
  const [typed, setTyped] = useState(() => tidyCode(params.code || ''))
  const [scanning, setScanning] = useState(false)
  const code = /^[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(typed) ? typed : null

  // A code from a scanned link changes the page's address too.
  useEffect(() => { if (params.code) setTyped(tidyCode(params.code)) }, [params.code])

  const look = useQuery({
    queryKey: ['installer-lookup', code],
    queryFn: () => api.post('/installer/lookup', { code }),
    enabled: !!code,
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
  })
  const found = look.data
  // Once linked, the code reads as linked: the page keeps what it linked.
  const [linked, setLinked] = useState(null)
  const another = () => { setLinked(null); setTyped(''); navigate('/install/link', { replace: true }) }

  if (linked) return <Done linked={linked} onAnother={another} />

  return (
    <div className="space-y-4" data-testid="installer-link">
      <VenueButton />
      <Card title="The code on the device">
        <div className="space-y-3">
          <input className={inputClass + ' text-center text-3xl font-extrabold tracking-[0.2em] uppercase h-16'}
            value={typed} onChange={e => setTyped(tidyCode(e.target.value))} placeholder="ABC-DEF"
            autoCapitalize="characters" autoComplete="off" spellCheck={false} inputMode="text" aria-label="Code on the device"
            data-testid="link-code-input" />
          {CAN_SCAN && (
            <BigButton onClick={() => setScanning(true)} data-testid="scan">
              <Camera className="w-5 h-5" /> Scan the QR code
            </BigButton>
          )}
          <p className="text-xs text-muted-foreground">
            A till, kitchen screen or kiosk that isn't set up shows a code and a QR code; so does a menu screen.
            {!CAN_SCAN && ' Scan the QR code with the phone\'s camera, or type the code here.'}
          </p>
        </div>
      </Card>

      {code && look.isLoading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Looking the code up…</div>}
      {code && look.error && <ErrorNote>{look.error.status === 403 ? 'Linking devices needs Manage on Store tech or Menu screens.' : look.error.message}</ErrorNote>}

      {found && found.status === 'linked' && <ErrorNote>That device is already linked. If it still shows a code, it has made a new one: type that.</ErrorNote>}
      {found && found.status === 'expired' && <ErrorNote>That code ran out. The device shows a new one by itself: type that.</ErrorNote>}
      {found && found.status === 'waiting' && !found.can_link && (
        <ErrorNote>That is {found.kind ? KINDS[found.kind].a : 'a till, kitchen screen or kiosk'}: linking it needs Manage on {found.kind === 'screen' ? 'Menu screens' : 'Store tech'}.</ErrorNote>
      )}
      {found && found.status === 'waiting' && found.can_link && o && venue && (
        <LinkForm key={code} code={code} found={found} overview={o} venueId={venueId}
          preset={{ replace: search.get('replace'), kind: search.get('kind') }}
          onLinked={async d => {
            setLinked(d)
            qc.removeQueries({ queryKey: ['installer-lookup', code] })
            await qc.invalidateQueries({ queryKey: ['installer', venueId] })
          }} />
      )}

      {scanning && <QrScanner onClose={() => setScanning(false)} onCode={c => { setScanning(false); navigate('/install/link/' + c, { replace: true }) }} />}
    </div>
  )
}

function Done({ linked, onAnother }) {
  const { kind } = linked
  return (
    <Card>
      <div className="text-center space-y-3 py-2" data-testid="link-done">
        <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto" />
        <div className="text-lg font-semibold">{linked.name} is linked</div>
        <p className="text-sm text-muted-foreground">The {KINDS[kind].label.toLowerCase()} sets itself up in a few seconds{kind === 'screen' ? ' and shows what it was given' : ''}.</p>
        <div className="grid gap-2 pt-1">
          <BigButton as={Link} to={`/install/device/${kind}/${linked.id}`} primary>Open its page</BigButton>
          <BigButton onClick={onAnother} data-testid="link-another"><RotateCcw className="w-4 h-4" /> Link another device</BigButton>
          <BigButton as={Link} to="/install">Done</BigButton>
        </div>
      </div>
    </Card>
  )
}

function LinkForm({ code, found, overview, venueId, preset, onLinked }) {
  const api = useApi()
  const fixed = found.kind   // null: a code from a test address, any of the three
  const [kind, setKind] = useState(fixed || (POS_KINDS.includes(preset.kind) ? preset.kind : 'terminal'))
  const same = useMemo(() => kind === 'screen'
    ? (overview.screens || [])
    : (overview.devices || []).filter(d => d.kind === kind), [overview, kind])
  const presetReplace = same.some(d => d.id === preset.replace) ? preset.replace : null
  const [mode, setMode] = useState(presetReplace ? 'replace' : 'new')
  const [replaceId, setReplaceId] = useState(presetReplace)
  const [name, setName] = useState(() => suggestName(fixed || kind, overview))
  const [settings, setSettings] = useState({})

  useEffect(() => { if (!fixed) setName(suggestName(kind, overview)) }, [kind]) // eslint-disable-line react-hooks/exhaustive-deps

  const link = useMutation({
    mutationFn: async () => {
      if (kind === 'screen') {
        const body = mode === 'replace'
          ? { code, screen_id: replaceId }
          : { code, name: name.trim(), venue_id: venueId, design_id: settings.design_id || null, playlist_id: settings.playlist_id || null }
        const s = await api.post('/screens/screens/claim', body)
        return { id: s.id, name: s.name, kind }
      }
      const body = mode === 'replace'
        ? { code, device_id: replaceId }
        : { code, name: name.trim(), ...(fixed ? {} : { kind }), settings: { ...settings } }
      const res = await api.post(`/pos/venues/${venueId}/link`, body)
      return { id: res.device.id, name: res.device.name, kind }
    },
    onSuccess: d => onLinked(d),
  })

  const canLink = canChange(overview.can, kind)
  const size = found.device?.width && found.device?.height ? `${found.device.width} x ${found.device.height}` : null
  const ready = mode === 'replace' ? !!replaceId : name.trim().length > 0
  return (
    <Card>
      <div className="space-y-5" data-testid="link-form">
        <div className="flex items-center gap-3">
          <KindIcon kind={kind} />
          <div className="min-w-0">
            <div className="font-semibold">{fixed ? 'This is ' + KINDS[fixed].a : 'A till, kitchen screen or kiosk'}</div>
            <div className="text-xs text-muted-foreground">{[size && 'Screen ' + size, 'code ' + code].filter(Boolean).join(' · ')}</div>
          </div>
        </div>

        {!fixed && (
          <Field label="It is" hint="The code came from a test address, so pick what the device is.">
            <Choice value={kind} onChange={setKind} options={POS_KINDS.map(k => ({ value: k, label: KINDS[k].label }))} />
          </Field>
        )}

        {same.length > 0 && (
          <Field label="Link it as">
            <Choice value={mode} onChange={setMode} options={[
              { value: 'new', label: 'A new ' + KINDS[kind].label.toLowerCase() },
              { value: 'replace', label: 'One already here' },
            ]} />
          </Field>
        )}

        {mode === 'replace' ? (
          <Field label={'Which ' + KINDS[kind].label.toLowerCase()} hint="It keeps its name and settings. The device it was linked to before stops working.">
            <div className="space-y-2">
              {same.map(d => {
                const st = deviceState(d)
                return (
                  <button key={d.id} type="button" aria-pressed={replaceId === d.id} onClick={() => setReplaceId(d.id)}
                    className={'w-full flex items-center gap-3 rounded-xl border px-3 min-h-[56px] text-left touch-manipulation ' + (replaceId === d.id ? 'border-[#1f3a5f] ring-2 ring-[#1f3a5f]/30 bg-[#1f3a5f]/5' : 'bg-background')}>
                    <span className="flex-1 min-w-0"><span className="block font-semibold truncate">{d.name}</span><span className="text-xs text-muted-foreground">{d.short_code}</span></span>
                    <Pill tone={st.tone}>{st.label}</Pill>
                  </button>
                )
              })}
            </div>
          </Field>
        ) : (
          <>
            <Field label="Name" hint="As staff will know it: Bar till, Grill screen, Window screen.">
              <input className={inputClass} value={name} maxLength={kind === 'screen' ? 80 : 60}
                onChange={e => setName(e.target.value)} data-testid="link-name" />
            </Field>
            <KindSettings kind={kind} settings={settings} onChange={setSettings} overview={overview} />
          </>
        )}

        {!canLink && <ErrorNote>Linking {KINDS[kind].plural.toLowerCase()} needs Manage on {kind === 'screen' ? 'Menu screens' : 'Store tech'}.</ErrorNote>}
        <ErrorNote>{link.error?.message}</ErrorNote>
        <BigButton primary disabled={!canLink || !ready || link.isPending} onClick={() => link.mutate()} data-testid="link-submit">
          <Link2 className="w-5 h-5" /> {link.isPending ? 'Linking…' : mode === 'replace' ? 'Link as this ' + KINDS[kind].label.toLowerCase() : 'Link ' + (name.trim() || 'it')}
        </BigButton>
      </div>
    </Card>
  )
}
