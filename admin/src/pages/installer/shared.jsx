// src/pages/installer/shared.jsx
//
// The installer app's shared parts (installer.<domain>, /install; migration
// 184): the venue being set up (remembered on this phone), the venue's
// devices from GET /api/installer/venues/:id, what each kind of device is
// called, and the small pieces every page uses. Phone first: one column,
// big touch targets, nothing that needs hovering.
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { MonitorSmartphone, ChefHat, Tablet, Tv, ChevronRight, AlertTriangle } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'

export const VENUE_KEY = 'maca_installer_venue'

// A device's kind, in the words the pages use. 'screen' is a menu screen.
export const KINDS = {
  terminal: { label: 'Till', plural: 'Tills', a: 'a till', icon: MonitorSmartphone, address: 'terminal', area: 'devices' },
  kds:      { label: 'Kitchen screen', plural: 'Kitchen screens', a: 'a kitchen screen', icon: ChefHat, address: 'kds', area: 'devices' },
  kiosk:    { label: 'Kiosk', plural: 'Kiosks', a: 'a self-order kiosk', icon: Tablet, address: 'kiosk', area: 'devices' },
  screen:   { label: 'Menu screen', plural: 'Menu screens', a: 'a menu screen', icon: Tv, address: 'screen', area: 'screens' },
}
export const KIND_ORDER = ['terminal', 'kds', 'kiosk', 'screen']

export const InstallerContext = createContext(null)
/** { venues, venueId, venue, setVenueId, me } from InstallerShell. */
export function useInstaller() { return useContext(InstallerContext) }

/** The venues this person can see, and the one being set up (remembered on this phone). */
export function useInstallerVenues() {
  const api = useApi()
  const { data: venues, isLoading, error } = useQuery({ queryKey: ['venues'], queryFn: () => api.get('/venues') })
  const [picked, setPicked] = useState(() => {
    try { return localStorage.getItem(VENUE_KEY) || '' } catch { return '' }
  })
  const list = useMemo(() => (venues || []).filter(v => v.is_active !== false), [venues])
  const venueId = list.some(v => v.id === picked) ? picked : (list[0]?.id || '')
  const setVenueId = id => {
    setPicked(id)
    try { localStorage.setItem(VENUE_KEY, id) } catch { /* private mode */ }
  }
  return { venues: list, venueId, venue: list.find(v => v.id === venueId) || null, setVenueId, isLoading, error }
}

/** Everything at the venue the installer shows (refreshed every 10 s while open). */
export function useOverview(venueId) {
  const api = useApi()
  return useQuery({
    queryKey: ['installer', venueId],
    queryFn: () => api.get(`/installer/venues/${venueId}`),
    enabled: !!venueId,
    refetchInterval: 10_000,
    retry: (n, err) => err?.status !== 403 && n < 2,
  })
}

/** Can this person change devices of a kind? (`can` from the overview.) */
export function canChange(can, kind) {
  return (KINDS[kind]?.area === 'screens' ? can?.screens : can?.devices) === 'manage'
}

/** A device's state, in words and a colour: Online, Offline, Code waiting, Not linked. */
export function deviceState(d) {
  if (d.online) return { label: 'Online', tone: 'ok' }
  if (d.paired) return { label: 'Offline', tone: 'muted' }
  if (d.pairing_open) return { label: 'Code waiting', tone: 'warn' }
  return { label: 'Not linked', tone: 'warn' }
}

const TONES = {
  ok: 'bg-emerald-100 text-emerald-800',
  warn: 'bg-amber-100 text-amber-900',
  bad: 'bg-red-100 text-red-800',
  muted: 'bg-muted text-muted-foreground',
}
export function Pill({ tone = 'muted', children, className }) {
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap', TONES[tone], className)}>{children}</span>
}

export function KindIcon({ kind, className }) {
  const Icon = KINDS[kind]?.icon || MonitorSmartphone
  return (
    <span className={cn('w-11 h-11 shrink-0 rounded-xl bg-[#1f3a5f]/10 text-[#1f3a5f] flex items-center justify-center', className)}>
      <Icon className="w-5 h-5" />
    </span>
  )
}

/** A white card with an optional heading. */
export function Card({ title, children, className, action }) {
  return (
    <section className={cn('rounded-2xl border bg-background', className)}>
      {(title || action) && (
        <div className="flex items-center gap-2 px-4 pt-3.5 pb-1">
          {title && <h2 className="flex-1 min-w-0 text-sm font-semibold">{title}</h2>}
          {action}
        </div>
      )}
      <div className="p-4 pt-2">{children}</div>
    </section>
  )
}

/** One device in a list: icon, name, number, state; taps through to its page. */
export function DeviceRow({ kind, device, to }) {
  const st = deviceState(device)
  return (
    <Link to={to} className="flex items-center gap-3 rounded-xl border bg-background px-3 py-2.5 min-h-[64px] touch-manipulation active:bg-accent hover:bg-accent" data-testid={'device-' + device.id}>
      <KindIcon kind={kind} />
      <span className="flex-1 min-w-0">
        <span className="block font-semibold truncate">{device.name}</span>
        <span className="block text-xs text-muted-foreground truncate">
          {device.short_code}{kind === 'screen' && device.shows?.name ? ' · ' + device.shows.name : ''}
          {kind === 'screen' && device.wall ? ' · on wall ' + device.wall.name : ''}
        </span>
      </span>
      <Pill tone={st.tone}>{st.label}</Pill>
      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
    </Link>
  )
}

/** A full-width button, 56 px tall. */
export function BigButton({ as: As = 'button', className, primary, danger, children, ...rest }) {
  return (
    <As
      className={cn(
        'w-full min-h-[56px] rounded-xl px-4 flex items-center justify-center gap-2 font-semibold text-base touch-manipulation disabled:opacity-50',
        primary ? 'bg-[#1f3a5f] text-white active:bg-[#16304f]'
          : danger ? 'bg-red-600 text-white active:bg-red-700'
          : 'border bg-background active:bg-accent hover:bg-accent',
        className,
      )}
      {...(As === 'button' && !rest.type ? { type: 'button' } : {})}
      {...rest}
    >
      {children}
    </As>
  )
}

export function ErrorNote({ children }) {
  if (!children) return null
  return (
    <div className="rounded-xl bg-red-50 text-red-800 border border-red-200 p-3 text-sm font-medium flex gap-2" role="alert">
      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> <span className="min-w-0">{children}</span>
    </div>
  )
}

/** Chips to tick several of a list (kitchen stations). */
export function ChipPicker({ options, value, onChange, disabled, empty }) {
  if (!options?.length) return <p className="text-sm text-muted-foreground">{empty}</p>
  const on = new Set(value || [])
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(o => {
        const picked = on.has(o.id)
        return (
          <button key={o.id} type="button" disabled={disabled} aria-pressed={picked}
            onClick={() => onChange(picked ? (value || []).filter(id => id !== o.id) : [...(value || []), o.id])}
            className={cn('min-h-[44px] rounded-full px-4 text-sm font-semibold border touch-manipulation disabled:opacity-60',
              picked ? 'bg-[#1f3a5f] text-white border-[#1f3a5f]' : 'bg-background')}>
            {o.name}
          </button>
        )
      })}
    </div>
  )
}

/** One choice of a few (till mode, board or playlist). */
export function Choice({ options, value, onChange, disabled }) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(options.length, 3)}, minmax(0, 1fr))` }}>
      {options.map(o => (
        <button key={String(o.value)} type="button" disabled={disabled} aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn('min-h-[48px] rounded-xl px-3 text-sm font-semibold border touch-manipulation disabled:opacity-60',
            value === o.value ? 'bg-[#1f3a5f] text-white border-[#1f3a5f]' : 'bg-background')}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Field({ label, hint, children }) {
  return (
    <div className="space-y-1.5">
      <div className="text-sm font-semibold">{label}</div>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

export const inputClass = 'w-full min-h-[48px] rounded-xl border bg-background px-3 text-base outline-none focus:border-[#1f3a5f] touch-manipulation'

/** A code as typed: letters and digits only, upper case, ABC-DEF once six are in. */
export function tidyCode(text) {
  const raw = String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
  return raw.length > 3 && raw.length <= 6 ? raw.slice(0, 3) + '-' + raw.slice(3) : raw
}

/** The code inside a scanned link (…/link/ABC-DEF) or text that is a code. */
export function codeFromScan(text) {
  const s = String(text || '').trim()
  const m = /\/link\/([A-Za-z0-9-]{6,9})(?:[/?#]|$)/.exec(s)
  if (m) return tidyCode(m[1])
  const raw = s.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return raw.length === 6 ? tidyCode(raw) : null
}

/** Ticks once a second, for "new code in…" lines. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t) }, [ms])
  return now
}

/** The device's address without https://, for reading out. */
export function shortAddress(url) {
  return String(url || '').replace(/^https?:\/\//, '').replace(/\/$/, '')
}

/** A device kind's settings, edited the same way when linking and on its page. */
export function KindSettings({ kind, settings, onChange, overview, disabled }) {
  if (kind === 'terminal') {
    return (
      <Field label="Service" hint="Table service opens on the floor plan; counter service on a new order.">
        <Choice disabled={disabled} value={settings.mode || 'table'} onChange={mode => onChange({ ...settings, mode })}
          options={[{ value: 'table', label: 'Table service' }, { value: 'counter', label: 'Counter' }]} />
      </Field>
    )
  }
  if (kind === 'kds') {
    return (
      <Field label="Stations it shows" hint="None picked: it asks on the screen. Stations are set up in Till setup, Kitchen screens.">
        <ChipPicker disabled={disabled} options={overview?.stations} value={settings.station_ids || []}
          onChange={station_ids => onChange({ ...settings, station_ids })} empty="This venue has no kitchen stations yet." />
      </Field>
    )
  }
  if (kind === 'kiosk') {
    const designs = overview?.kiosk_designs || []
    if (!designs.length) return null
    return (
      <Field label="Design" hint="How the kiosk looks. Designs are made in Till setup, Kiosks.">
        <select className={inputClass} disabled={disabled} value={settings.design_id || ''}
          onChange={e => onChange({ ...settings, design_id: e.target.value || null })}>
          <option value="">{designs[0].name} (the first)</option>
          {designs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </Field>
    )
  }
  if (kind === 'screen') {
    const designs = overview?.designs || []
    const playlists = overview?.playlists || []
    const value = settings.playlist_id ? 'p:' + settings.playlist_id : settings.design_id ? 'd:' + settings.design_id : ''
    return (
      <Field label="Shows" hint="A board, or a playlist of boards. Made on the Screens page.">
        <select className={inputClass} disabled={disabled} value={value}
          onChange={e => {
            const v = e.target.value
            onChange({ ...settings, design_id: v.startsWith('d:') ? v.slice(2) : null, playlist_id: v.startsWith('p:') ? v.slice(2) : null })
          }}>
          <option value="">Nothing yet</option>
          {designs.length > 0 && <optgroup label="Boards">{designs.map(d => <option key={d.id} value={'d:' + d.id}>{d.name}</option>)}</optgroup>}
          {playlists.length > 0 && <optgroup label="Playlists">{playlists.map(p => <option key={p.id} value={'p:' + p.id}>{p.name}</option>)}</optgroup>}
        </select>
      </Field>
    )
  }
  return null
}

/** The next free name for a new device of a kind: "Kitchen screen 3". */
export function suggestName(kind, overview) {
  const list = kind === 'screen' ? overview?.screens || [] : (overview?.devices || []).filter(d => d.kind === kind)
  const base = KINDS[kind]?.label || 'Device'
  const names = new Set(list.map(d => d.name.toLowerCase()))
  for (let n = list.length + 1; n < 500; n++) if (!names.has((base + ' ' + n).toLowerCase())) return base + ' ' + n
  return base
}
