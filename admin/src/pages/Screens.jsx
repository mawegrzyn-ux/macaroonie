// src/pages/Screens.jsx
//
// Menu screens (/screens, module `screens`, migration 166). Three tabs:
//   Screens    the paired screens: add one by the code it shows, what it
//              shows (a board or a playlist), size, rotation, online state,
//              identify / reload / remove
//   Boards     the board designs (opened in the designer, /screens/boards/:id)
//   Playlists  boards taking turns, each for some seconds at the times of
//              day it is set for
// The player runs on screens.<domain> (screen/ + routes/screenSite.js).

import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Monitor, Plus, Loader2, Pencil, RefreshCw, ScanEye, Copy, ListVideo, LayoutTemplate, Save, Clock,
} from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { usePermission } from '@/hooks/usePermission'
import { ReadOnlyNotice, ReadOnlyFieldset } from '@/components/ReadOnlyNotice'
import { PageHeader, Modal, ConfirmDelete, SortableRows } from '@/components/staff/shared'
import { ScheduleEditor } from '@/components/orders/ScheduleEditor'
import {
  BoardPreview, useScreenData, relTime, useTick, ROTATIONS, FITS, PxBox, errorText,
} from '@/components/screens/shared'
import { BOARD_SIZES, itemsOnAt, localParts } from '@shared/screenLayout.js'
import { isScheduled } from '@shared/menuSchedule.js'

const TABS = [
  { key: 'screens', label: 'Screens', icon: Monitor },
  { key: 'boards', label: 'Boards', icon: LayoutTemplate },
  { key: 'playlists', label: 'Playlists', icon: ListVideo },
]

const inputCls = 'w-full h-11 rounded-lg border bg-background px-3 text-sm touch-manipulation focus:outline-none focus:ring-2 focus:ring-primary/40'

function useVenues() {
  const api = useApi()
  return useQuery({ queryKey: ['venues'], queryFn: () => api.get('/venues') }).data || []
}
function useDesigns() {
  const api = useApi()
  return useQuery({ queryKey: ['screen-designs'], queryFn: () => api.get('/screens/designs') })
}
function usePlaylists() {
  const api = useApi()
  return useQuery({ queryKey: ['screen-playlists'], queryFn: () => api.get('/screens/playlists') })
}

export default function Screens() {
  const [params, setParams] = useSearchParams()
  const tab = TABS.find(t => t.key === params.get('tab')) || TABS[0]
  const { canManage } = usePermission('screens')

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader icon={Monitor} title="Screens" />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto p-4 space-y-4">
          <nav className="flex flex-wrap gap-1.5" aria-label="Screens sections">
            {TABS.map(t => (
              <button key={t.key} type="button" onClick={() => setParams({ tab: t.key }, { replace: true })}
                aria-current={t.key === tab.key ? 'page' : undefined}
                className={cn('min-h-[44px] px-3 rounded-lg border text-sm font-medium touch-manipulation inline-flex items-center gap-1.5',
                  t.key === tab.key ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted')}>
                <t.icon className="w-4 h-4" /> {t.label}
              </button>
            ))}
          </nav>
          {!canManage && <ReadOnlyNotice what="the screens" />}
          {tab.key === 'screens' && <ScreensTab canManage={canManage} />}
          {tab.key === 'boards' && <BoardsTab canManage={canManage} />}
          {tab.key === 'playlists' && <PlaylistsTab canManage={canManage} />}
        </div>
      </div>
    </div>
  )
}

function Card({ title, hint, actions, children, className }) {
  return (
    <section className={cn('rounded-xl border bg-background overflow-hidden', className)}>
      {(title || actions) && (
        <div className="px-4 py-3 section-head flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold">{title}</h2>
            {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
          </div>
          {actions}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  )
}

function Btn({ children, onClick, primary, disabled, title, className, type = 'button' }) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title} aria-label={title}
      className={cn('inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3 rounded-lg text-sm font-medium touch-manipulation disabled:opacity-50 shrink-0',
        primary ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'border bg-background hover:bg-muted', className)}>
      {children}
    </button>
  )
}

function ErrorLine({ error }) {
  if (!error) return null
  return <p className="text-sm text-destructive">{errorText(error)}</p>
}

// ── Screens ─────────────────────────────────────────────────────────

function ScreensTab({ canManage }) {
  const api = useApi()
  const qc = useQueryClient()
  useTick(30_000)
  const { data, isLoading } = useQuery({
    queryKey: ['screens'], queryFn: () => api.get('/screens/screens'), refetchInterval: 30_000,
  })
  const screens = useMemo(() => data?.screens || [], [data])
  const venues = useVenues()
  const { data: designs = [] } = useDesigns()
  const { data: playlists = [] } = usePlaylists()
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(null)
  const [flash, setFlash] = useState(null)

  const refresh = () => qc.invalidateQueries({ queryKey: ['screens'] })
  const reorder = useMutation({ mutationFn: ids => api.patch('/screens/screens/reorder', { ids }), onSuccess: refresh })
  const remove = useMutation({ mutationFn: id => api.delete(`/screens/screens/${id}`), onSuccess: refresh })
  const identify = useMutation({
    mutationFn: id => api.post(`/screens/screens/${id}/identify`, {}),
    onSuccess: () => setFlash('The screen shows its name for 20 seconds.'),
  })
  const reload = useMutation({
    mutationFn: id => api.post(`/screens/screens/${id}/reload`, {}),
    onSuccess: () => setFlash('The screen is reloading.'),
  })

  return (
    <div className="space-y-4">
      <Card title="Add a screen" hint="Any Android TV box, smart TV or tablet with Chrome (or Fully Kiosk Browser).">
        <ol className="text-sm space-y-1.5 list-decimal pl-5">
          <li>On the screen, open <a href={data?.player_url} target="_blank" rel="noreferrer" className="font-medium text-primary break-all">{data?.player_url || 'the screens address'}</a>{' '}
            in Chrome and choose <span className="font-medium">Install app</span> (or <span className="font-medium">Add to Home screen</span>) so it opens full screen,
            or set it as the start page in Fully Kiosk.</li>
          <li>The screen shows a six-letter code.</li>
          <li>Press <span className="font-medium">Add screen</span> here and type the code.</li>
        </ol>
        {canManage && (
          <div className="mt-3">
            <Btn primary onClick={() => setAdding(true)}><Plus className="w-4 h-4" /> Add screen</Btn>
          </div>
        )}
      </Card>

      {flash && (
        <div className="rounded-lg border bg-emerald-50 text-emerald-900 px-3 py-2 text-sm flex items-center gap-2">
          <span className="flex-1">{flash}</span>
          <button type="button" onClick={() => setFlash(null)} className="text-xs underline min-h-[36px] px-2">OK</button>
        </div>
      )}
      <ErrorLine error={identify.error || reload.error || remove.error || reorder.error} />

      {isLoading ? (
        <div className="flex justify-center py-10 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : !screens.length ? (
        <p className="text-sm text-muted-foreground text-center py-8">No screens yet.</p>
      ) : (
        <SortableRows items={screens} locked={!canManage} onReorder={ids => reorder.mutate(ids)}
          renderItem={s => (
            <ScreenRow s={s} canManage={canManage}
              onIdentify={() => identify.mutate(s.id)} onReload={() => reload.mutate(s.id)}
              onEdit={() => setEditing(s)} onRemove={() => remove.mutate(s.id)} />
          )} />
      )}

      {adding && (
        <AddScreenModal venues={venues} designs={designs} playlists={playlists} onClose={() => setAdding(false)}
          onAdded={() => { setAdding(false); refresh(); setFlash('Screen added. It shows its board in a few seconds.') }} />
      )}
      {editing && (
        <EditScreenModal screen={editing} venues={venues} designs={designs} playlists={playlists} canManage={canManage}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh() }} />
      )}
    </div>
  )
}

function ScreenRow({ s, canManage, onIdentify, onReload, onEdit, onRemove }) {
  const showing = s.status?.showing?.name
  return (
    <div className="flex flex-wrap items-center gap-3 py-1" data-testid="screen-row">
      <div className="flex-1 min-w-[200px]">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn('w-2.5 h-2.5 rounded-full shrink-0', s.online ? 'bg-emerald-500' : 'bg-muted-foreground/40')}
            title={s.online ? 'Online' : 'Offline'} />
          <span className="font-medium">{s.name}</span>
          <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-muted">{s.short_code}</span>
          {s.venue_name && <span className="text-xs text-muted-foreground">{s.venue_name}</span>}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
          <span>{s.width} x {s.height}{s.rotation ? `, turned ${s.rotation}°` : ''}</span>
          <span>{s.shows ? `${s.shows.kind === 'playlist' ? 'Playlist' : 'Board'}: ${s.shows.name || '?'}` : 'Nothing picked yet'}</span>
          <span>{s.online ? (showing ? `Showing ${showing}` : 'Online') : `Last seen ${relTime(s.last_seen_at)}`}</span>
          {s.status?.offline_secs > 120 && <span className="text-amber-700">Was offline {Math.round(s.status.offline_secs / 60)} min</span>}
          {s.status?.error && <span className="text-destructive">{s.status.error}</span>}
        </div>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <Btn onClick={onIdentify} title="Show the screen's name on it"><ScanEye className="w-4 h-4" /><span className="hidden sm:inline">Identify</span></Btn>
        {canManage && <Btn onClick={onReload} title="Reload the screen"><RefreshCw className="w-4 h-4" /></Btn>}
        {canManage && <Btn onClick={onEdit} title="Change this screen"><Pencil className="w-4 h-4" /><span className="hidden sm:inline">Edit</span></Btn>}
        {canManage && <ConfirmDelete onConfirm={onRemove} label="Remove screen" confirmLabel="Yes, remove" />}
      </div>
    </div>
  )
}

// What a screen shows: a board, a playlist or nothing yet.
function ContentPicker({ designs, playlists, value, onChange }) {
  const kind = value.playlist_id ? 'playlist' : value.design_id ? 'board' : 'none'
  return (
    <div className="space-y-2">
      <div className="inline-flex rounded-lg border overflow-hidden">
        {[['board', 'One board'], ['playlist', 'A playlist'], ['none', 'Nothing yet']].map(([k, l]) => (
          <button key={k} type="button" onClick={() => {
            if (k === 'board') onChange({ design_id: designs[0]?.id || null, playlist_id: null })
            else if (k === 'playlist') onChange({ design_id: null, playlist_id: playlists[0]?.id || null })
            else onChange({ design_id: null, playlist_id: null })
          }}
            className={cn('h-11 px-3 text-sm font-medium touch-manipulation', kind === k ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted')}>
            {l}
          </button>
        ))}
      </div>
      {kind === 'board' && (
        designs.length ? (
          <select className={inputCls} value={value.design_id || ''} onChange={e => onChange({ design_id: e.target.value, playlist_id: null })} aria-label="Board">
            {designs.map(d => <option key={d.id} value={d.id}>{d.name} ({d.width} x {d.height})</option>)}
          </select>
        ) : <p className="text-xs text-muted-foreground">No boards yet: make one on the Boards tab.</p>
      )}
      {kind === 'playlist' && (
        playlists.length ? (
          <select className={inputCls} value={value.playlist_id || ''} onChange={e => onChange({ design_id: null, playlist_id: e.target.value })} aria-label="Playlist">
            {playlists.map(p => <option key={p.id} value={p.id}>{p.name} ({p.items.length} board{p.items.length === 1 ? '' : 's'})</option>)}
          </select>
        ) : <p className="text-xs text-muted-foreground">No playlists yet: make one on the Playlists tab.</p>
      )}
    </div>
  )
}

function Field({ label, hint, children }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
    </label>
  )
}

function AddScreenModal({ venues, designs, playlists, onClose, onAdded }) {
  const api = useApi()
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [venueId, setVenueId] = useState(venues[0]?.id || '')
  const [content, setContent] = useState({ design_id: designs[0]?.id || null, playlist_id: null })
  const add = useMutation({
    mutationFn: () => api.post('/screens/screens/claim', { code, name: name.trim(), venue_id: venueId || venues[0]?.id, ...content }),
    onSuccess: onAdded,
  })
  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return (
    <Modal title="Add screen" onClose={onClose}
      footer={<>
        <Btn primary disabled={clean.length !== 6 || !name.trim() || add.isPending} onClick={() => add.mutate()}>
          {add.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add screen
        </Btn>
        <Btn onClick={onClose}>Cancel</Btn>
      </>}>
      <Field label="Code on the screen">
        <input value={code} onChange={e => setCode(e.target.value.toUpperCase().slice(0, 9))} autoFocus placeholder="ABC-DEF"
          autoCapitalize="characters" autoComplete="off" spellCheck={false}
          className="w-full h-14 rounded-lg border bg-background px-3 text-2xl font-mono tracking-widest text-center uppercase touch-manipulation" />
      </Field>
      <Field label="Name" hint="Where it is, e.g. Counter left.">
        <input className={inputCls} value={name} onChange={e => setName(e.target.value)} maxLength={80} />
      </Field>
      {venues.length > 1 && (
        <Field label="Venue" hint="Sold out dishes come from this venue.">
          <select className={inputCls} value={venueId} onChange={e => setVenueId(e.target.value)}>
            {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </Field>
      )}
      <Field label="Shows">
        <ContentPicker designs={designs} playlists={playlists} value={content} onChange={setContent} />
      </Field>
      <ErrorLine error={add.error} />
    </Modal>
  )
}

function EditScreenModal({ screen, venues, designs, playlists, canManage, onClose, onSaved }) {
  const api = useApi()
  const [f, setF] = useState({
    name: screen.name, venue_id: screen.venue_id, width: screen.width, height: screen.height,
    rotation: screen.rotation, fit: screen.fit, design_id: screen.design_id, playlist_id: screen.playlist_id,
  })
  const [code, setCode] = useState('')
  const set = patch => setF(x => ({ ...x, ...patch }))
  const save = useMutation({ mutationFn: () => api.patch(`/screens/screens/${screen.id}`, f), onSuccess: onSaved })
  const replace = useMutation({ mutationFn: () => api.post('/screens/screens/claim', { code, screen_id: screen.id }), onSuccess: onSaved })
  const preset = BOARD_SIZES.find(s => s.width === f.width && s.height === f.height)?.key || 'custom'
  const dev = screen.device_info || {}
  return (
    <Modal title={`${screen.name} (${screen.short_code})`} onClose={onClose}
      footer={canManage ? <>
        <Btn primary disabled={!f.name.trim() || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
        </Btn>
        <Btn onClick={onClose}>Cancel</Btn>
      </> : null}>
      <ReadOnlyFieldset disabled={!canManage} className="space-y-4">
        <Field label="Name"><input className={inputCls} value={f.name} onChange={e => set({ name: e.target.value })} maxLength={80} /></Field>
        {venues.length > 1 && (
          <Field label="Venue" hint="Sold out dishes come from this venue.">
            <select className={inputCls} value={f.venue_id} onChange={e => set({ venue_id: e.target.value })}>
              {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Shows">
          <ContentPicker designs={designs} playlists={playlists} value={f} onChange={set} />
        </Field>
        <Field label="Screen size" hint={dev.width ? `The device reported ${Math.round(dev.width * (dev.dpr || 1))} x ${Math.round(dev.height * (dev.dpr || 1))} when it was paired.` : null}>
          <select className={inputCls} value={preset} onChange={e => {
            const p = BOARD_SIZES.find(s => s.key === e.target.value)
            if (p) set({ width: p.width, height: p.height })
          }}>
            {BOARD_SIZES.map(s => <option key={s.key} value={s.key}>{s.label} ({s.width} x {s.height})</option>)}
            <option value="custom">Other size</option>
          </select>
          <div className="grid grid-cols-2 gap-2 mt-2">
            <PxBox label="Width" value={f.width} min={240} max={8192} onChange={v => set({ width: v })} />
            <PxBox label="Height" value={f.height} min={240} max={8192} onChange={v => set({ height: v })} />
          </div>
        </Field>
        <Field label="Mounted" hint="Turn the board when the screen hangs on its side (for TVs that can't turn the picture themselves).">
          <select className={inputCls} value={f.rotation} onChange={e => set({ rotation: Number(e.target.value) })}>
            {ROTATIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </Field>
        <Field label="When the board's shape differs from the screen">
          <select className={inputCls} value={f.fit} onChange={e => set({ fit: e.target.value })}>
            {FITS.map(x => <option key={x.value} value={x.value}>{x.label}</option>)}
          </select>
        </Field>
        <ErrorLine error={save.error} />
        {canManage && (
          <div className="rounded-lg border p-3 space-y-2">
            <p className="text-sm font-medium">New device for this screen</p>
            <p className="text-xs text-muted-foreground">Swapped the box or the TV? Open the screens address on the new one and type its code. The old device stops showing boards.</p>
            <div className="flex gap-2">
              <input value={code} onChange={e => setCode(e.target.value.toUpperCase().slice(0, 9))} placeholder="ABC-DEF" aria-label="Code on the new device"
                className="flex-1 min-w-0 h-11 rounded-lg border bg-background px-3 font-mono tracking-widest uppercase touch-manipulation" />
              <Btn disabled={code.replace(/[^A-Z0-9]/gi, '').length !== 6 || replace.isPending} onClick={() => replace.mutate()}>Pair</Btn>
            </div>
            <ErrorLine error={replace.error} />
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Paired {screen.paired_at ? new Date(screen.paired_at).toLocaleString('en-GB') : 'never'}
          {screen.app_version ? ` · player ${screen.app_version}` : ''}{dev.kiosk ? ' · Fully Kiosk' : ''}
        </p>
      </ReadOnlyFieldset>
    </Modal>
  )
}

// ── Boards ──────────────────────────────────────────────────────────

function BoardsTab({ canManage }) {
  const api = useApi()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { data: list = [], isLoading } = useDesigns()
  const { data: screenData } = useScreenData()
  const [creating, setCreating] = useState(false)
  const full = useQuery({
    queryKey: ['screen-designs-full', list.map(d => d.id + d.updated_at).join()],
    queryFn: () => Promise.all(list.map(d => api.get(`/screens/designs/${d.id}`))),
    enabled: list.length > 0,
  })
  const byId = useMemo(() => Object.fromEntries((full.data || []).map(d => [d.id, d])), [full.data])
  const refresh = () => { qc.invalidateQueries({ queryKey: ['screen-designs'] }); qc.invalidateQueries({ queryKey: ['screens'] }); qc.invalidateQueries({ queryKey: ['screen-playlists'] }) }
  const copy = useMutation({
    mutationFn: d => api.post('/screens/designs', { name: `${d.name} copy`, copy_from: d.id }),
    onSuccess: refresh,
  })
  const remove = useMutation({ mutationFn: id => api.delete(`/screens/designs/${id}`), onSuccess: refresh })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted-foreground flex-1 min-w-[220px]">A board is one screen's worth of menu: sections, dishes, prices, photos and text, placed where you want them. Prices come from the published menus.</p>
        {canManage && <Btn primary onClick={() => setCreating(true)}><Plus className="w-4 h-4" /> New board</Btn>}
      </div>
      <ErrorLine error={copy.error || remove.error} />
      {isLoading ? (
        <div className="flex justify-center py-10 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : !list.length ? (
        <p className="text-sm text-muted-foreground text-center py-8">No boards yet.</p>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))' }}>
          {list.map(d => {
            const used = d.screen_count + d.playlist_count
            return (
              <div key={d.id} className="rounded-xl border bg-background overflow-hidden flex flex-col" data-testid="board-card">
                <Link to={`/screens/boards/${d.id}`} className="block bg-black/90 p-3 touch-manipulation">
                  <div className="flex justify-center">
                    {byId[d.id] ? <BoardPreview design={byId[d.id]} data={screenData} width={d.width >= d.height ? 250 : 120} />
                      : <div className="h-[140px] flex items-center justify-center text-white/50"><Loader2 className="w-4 h-4 animate-spin" /></div>}
                  </div>
                </Link>
                <div className="p-3 flex-1 flex flex-col gap-2">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{d.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {d.width} x {d.height} · {d.block_count} block{d.block_count === 1 ? '' : 's'}
                      {used ? ` · on ${d.screen_count} screen${d.screen_count === 1 ? '' : 's'}, ${d.playlist_count} playlist${d.playlist_count === 1 ? '' : 's'}` : ' · not used yet'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 mt-auto">
                    <Btn onClick={() => navigate(`/screens/boards/${d.id}`)}><Pencil className="w-4 h-4" /> {canManage ? 'Design' : 'Open'}</Btn>
                    {canManage && <Btn title="Copy this board" onClick={() => copy.mutate(d)} disabled={copy.isPending}><Copy className="w-4 h-4" /></Btn>}
                    <span className="flex-1" />
                    {canManage && <ConfirmDelete onConfirm={() => remove.mutate(d.id)} label="Delete board"
                      confirmLabel={used ? 'Delete (in use)' : 'Yes, delete'} />}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
      {creating && <NewBoardModal onClose={() => setCreating(false)} onMade={d => { refresh(); navigate(`/screens/boards/${d.id}`) }} />}
    </div>
  )
}

function NewBoardModal({ onClose, onMade }) {
  const api = useApi()
  const [name, setName] = useState('')
  const [size, setSize] = useState('fhd')
  const [w, setW] = useState(1920)
  const [h, setH] = useState(1080)
  const make = useMutation({
    mutationFn: () => {
      const p = BOARD_SIZES.find(s => s.key === size)
      return api.post('/screens/designs', { name: name.trim(), width: p ? p.width : w, height: p ? p.height : h })
    },
    onSuccess: onMade,
  })
  return (
    <Modal title="New board" onClose={onClose}
      footer={<>
        <Btn primary disabled={!name.trim() || make.isPending} onClick={() => make.mutate()}>
          {make.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Make board
        </Btn>
        <Btn onClick={onClose}>Cancel</Btn>
      </>}>
      <Field label="Name"><input className={inputCls} value={name} onChange={e => setName(e.target.value)} autoFocus maxLength={120} placeholder="e.g. Lunch, left screen" /></Field>
      <Field label="Size" hint="The screen's resolution. Portrait sizes are for screens hung on their side.">
        <div className="grid grid-cols-2 gap-2">
          {[...BOARD_SIZES, { key: 'custom', label: 'Other size' }].map(s => (
            <button key={s.key} type="button" onClick={() => setSize(s.key)}
              className={cn('min-h-[48px] rounded-lg border px-3 text-left text-sm touch-manipulation',
                size === s.key ? 'border-primary ring-2 ring-primary/30 bg-primary/5' : 'bg-background hover:bg-muted')}>
              <span className="font-medium block">{s.label}</span>
              {s.width && <span className="text-xs text-muted-foreground">{s.width} x {s.height}</span>}
            </button>
          ))}
        </div>
        {size === 'custom' && (
          <div className="grid grid-cols-2 gap-2 mt-2">
            <PxBox label="Width" value={w} min={240} max={8192} onChange={setW} />
            <PxBox label="Height" value={h} min={240} max={8192} onChange={setH} />
          </div>
        )}
      </Field>
      <ErrorLine error={make.error} />
    </Modal>
  )
}

// ── Playlists ───────────────────────────────────────────────────────

let tmpId = 0
const newKey = () => 'n' + (++tmpId)

function PlaylistsTab({ canManage }) {
  const api = useApi()
  const qc = useQueryClient()
  const { data: playlists = [], isLoading } = usePlaylists()
  const { data: designs = [] } = useDesigns()
  const [openId, setOpenId] = useState(null)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const make = useMutation({
    mutationFn: () => api.post('/screens/playlists', { name: name.trim() }),
    onSuccess: p => { qc.invalidateQueries({ queryKey: ['screen-playlists'] }); setNaming(false); setName(''); setOpenId(p.id) },
  })
  const open = playlists.find(p => p.id === openId)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted-foreground flex-1 min-w-[220px]">Boards take turns on a screen, each for some seconds. Set times of day for a board to show only then (a lunch board until 15:00, a dinner board after).</p>
        {canManage && !naming && <Btn primary onClick={() => setNaming(true)}><Plus className="w-4 h-4" /> New playlist</Btn>}
      </div>
      {naming && (
        <div className="flex flex-wrap gap-2 items-center">
          <input className={cn(inputCls, 'flex-1 min-w-[200px]')} value={name} onChange={e => setName(e.target.value)} placeholder="Playlist name" autoFocus maxLength={120} aria-label="Playlist name" />
          <Btn primary disabled={!name.trim() || make.isPending} onClick={() => make.mutate()}>Make</Btn>
          <Btn onClick={() => { setNaming(false); setName('') }}>Cancel</Btn>
          <ErrorLine error={make.error} />
        </div>
      )}
      {isLoading ? (
        <div className="flex justify-center py-10 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : !playlists.length ? (
        <p className="text-sm text-muted-foreground text-center py-8">No playlists yet.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
          <div className="space-y-1.5">
            {playlists.map(p => (
              <button key={p.id} type="button" onClick={() => setOpenId(p.id)} data-testid="playlist-pick"
                className={cn('w-full text-left rounded-lg border px-3 py-2 min-h-[52px] touch-manipulation',
                  p.id === open?.id ? 'border-primary ring-2 ring-primary/30 bg-primary/5' : 'bg-background hover:bg-muted')}>
                <span className="font-medium block truncate">{p.name}</span>
                <span className="text-xs text-muted-foreground">{p.items.length} board{p.items.length === 1 ? '' : 's'} · on {p.screen_count} screen{p.screen_count === 1 ? '' : 's'}</span>
              </button>
            ))}
          </div>
          {open ? (
            <PlaylistEditor key={open.id + open.updated_at} playlist={open} designs={designs} canManage={canManage} onDeleted={() => setOpenId(null)} />
          ) : (
            <p className="text-sm text-muted-foreground py-6">Pick a playlist to change it.</p>
          )}
        </div>
      )}
    </div>
  )
}

function PlaylistEditor({ playlist, designs, canManage, onDeleted }) {
  const api = useApi()
  const qc = useQueryClient()
  const [name, setName] = useState(playlist.name)
  const [items, setItems] = useState(() => playlist.items.map(i => ({ ...i, key: i.id })))
  const saved = JSON.stringify({ name: playlist.name, items: playlist.items.map(({ design_id, duration_secs, schedule }) => ({ design_id, duration_secs, schedule })) })
  const body = { name: name.trim(), items: items.map(({ design_id, duration_secs, schedule }) => ({ design_id, duration_secs, schedule: isScheduled(schedule) ? schedule : null })) }
  const dirty = JSON.stringify(body) !== saved
  const refresh = () => { qc.invalidateQueries({ queryKey: ['screen-playlists'] }); qc.invalidateQueries({ queryKey: ['screens'] }) }
  const save = useMutation({ mutationFn: () => api.put(`/screens/playlists/${playlist.id}`, body), onSuccess: refresh })
  const remove = useMutation({ mutationFn: () => api.delete(`/screens/playlists/${playlist.id}`), onSuccess: () => { refresh(); onDeleted() } })
  const setItem = (key, patch) => setItems(list => list.map(i => (i.key === key ? { ...i, ...patch } : i)))
  const designName = id => designs.find(d => d.id === id)?.name || 'A deleted board'
  const onNow = itemsOnAt(items, localParts(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone))
  // SortableRows keeps its own order from `items`: give it a stable array.
  const sortable = useMemo(() => items.map(i => ({ ...i, id: i.key })), [items])

  return (
    <Card title={playlist.name} hint={`On ${playlist.screen_count} screen${playlist.screen_count === 1 ? '' : 's'}`}
      actions={canManage && <ConfirmDelete onConfirm={() => remove.mutate()} label="Delete playlist" confirmLabel={playlist.screen_count ? 'Delete (in use)' : 'Yes, delete'} />}>
      <ReadOnlyFieldset disabled={!canManage} className="space-y-4">
        <Field label="Name"><input className={inputCls} value={name} onChange={e => setName(e.target.value)} maxLength={120} /></Field>
        <div className="space-y-2">
          <p className="text-sm font-medium">Boards, in order</p>
          {!items.length && <p className="text-sm text-muted-foreground">No boards yet.</p>}
          {items.length > 0 && (
            <SortableRows items={sortable} locked={!canManage}
              onReorder={keys => setItems(list => keys.map(k => list.find(i => i.key === k)))}
              renderItem={it => (
                <div className="py-1.5 space-y-1" data-testid="playlist-item">
                  <div className="flex flex-wrap items-center gap-2">
                    <select value={it.design_id} onChange={e => setItem(it.key, { design_id: e.target.value })} aria-label="Board"
                      className="flex-1 min-w-[160px] h-11 rounded-lg border bg-background px-2 text-sm touch-manipulation">
                      {!designs.some(d => d.id === it.design_id) && <option value={it.design_id}>{designName(it.design_id)}</option>}
                      {designs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                    <span className="inline-flex items-center gap-1 text-sm">
                      <Clock className="w-4 h-4 text-muted-foreground" />
                      <PxBox value={it.duration_secs} min={3} max={3600} suffix="s" onChange={v => setItem(it.key, { duration_secs: v })} className="w-24" />
                    </span>
                    {canManage && (
                      <button type="button" onClick={() => setItems(list => list.filter(i => i.key !== it.key))}
                        className="h-11 px-3 rounded-lg border text-xs hover:bg-muted touch-manipulation">Remove</button>
                    )}
                  </div>
                  <ScheduleEditor value={it.schedule} onChange={sc => setItem(it.key, { schedule: sc })} alwaysLabel="All the time" />
                </div>
              )} />
          )}
          {canManage && (
            designs.length ? (
              <Btn onClick={() => setItems(list => [...list, { key: newKey(), design_id: designs[0].id, duration_secs: 15, schedule: null }])}>
                <Plus className="w-4 h-4" /> Add a board
              </Btn>
            ) : <p className="text-xs text-muted-foreground">Make a board first (Boards tab).</p>
          )}
        </div>
        <p className="text-xs text-muted-foreground" data-testid="playlist-on-now">
          On now (your time): {onNow.length ? onNow.map(i => designName(i.design_id)).join(', ') : 'nothing: the screen is black'}.
          {' '}Times use the venue's time zone; a time ends just before its end (Lunch 11:00 to 15:00 hands over to Dinner 15:00 to 22:00).
        </p>
        <ErrorLine error={save.error || remove.error} />
        {canManage && (
          <div className="flex gap-2">
            <Btn primary disabled={!dirty || !name.trim() || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} {dirty ? 'Save playlist' : 'Saved'}
            </Btn>
            {dirty && <Btn onClick={() => { setName(playlist.name); setItems(playlist.items.map(i => ({ ...i, key: i.id }))) }}>Discard changes</Btn>}
          </div>
        )}
      </ReadOnlyFieldset>
    </Card>
  )
}
