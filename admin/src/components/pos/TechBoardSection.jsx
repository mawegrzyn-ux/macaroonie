// src/components/pos/TechBoardSection.jsx
//
// Store tech → Tech board (/pos/board, 22 Nov 2026, OUTSTANDING 44.7; the
// honeycomb 28 Nov 2026): the venue's kit on one page. At the top the
// platform's own light (GET /api/status/light: up, degraded or down), the
// choice of Honeycomb or List, Full screen and Check now; then what needs
// someone, worst first; then the kit. Honeycomb (TechHoneycomb.jsx, loaded
// when shown): a hexagon per piece of kit, filled by its state with a mark
// for it, ringed by its kind, in a cluster per kind, the venue's health
// first; tap one for its details and the link to where it is set up. List:
// the same kit as rows, the accessible way to read the board. Read again
// every minute (every 30 seconds full screen); nothing is live.
// GET /api/tech-board/venues/:venueId (routes/techBoard.js); everything the
// board says comes from the tile model in shared/techBoard.js (techTiles(),
// techModel()).
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Loader2, RefreshCw, Server, MonitorSmartphone, CookingPot, TabletSmartphone, Printer, CreditCard, Monitor, ChevronRight, Activity,
  Maximize2, Hexagon, List, Moon, Sun, Check, AlertTriangle, X, Minus,
} from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ago } from './shared'
import { techTiles, techModel, PLATFORM_LIGHT } from '@shared/techBoard.js'

const HexBoard = lazy(() => import('./TechHoneycomb'))
const FullBoard = lazy(() => import('./TechHoneycomb').then(m => ({ default: m.FullBoard })))

const ICON = { hub: Server, till: MonitorSmartphone, kitchen: CookingPot, kiosk: TabletSmartphone, printer: Printer, card: CreditCard, screen: Monitor }
const DOT = { ok: 'bg-emerald-500', warn: 'bg-amber-500', bad: 'bg-red-600', muted: 'bg-muted-foreground/40' }
const WORDS = { ok: 'text-emerald-800', warn: 'text-amber-800', bad: 'text-red-700', muted: 'text-muted-foreground' }
// Each state's mark (as on the hexagons), so the list never reads by colour alone.
const MARK = { ok: Check, warn: AlertTriangle, bad: X, muted: Minus }
const MARK_FILL = { ok: 'bg-[#15803d] text-white', warn: 'bg-[#fbbf24] text-[#1c1917]', bad: 'bg-[#b91c1c] text-white', muted: 'bg-[#cbd5e1] text-[#1e293b]' }

function ToneMark({ tone, className }) {
  const Icon = MARK[tone] || Minus
  return (
    <span className={cn('inline-flex items-center justify-center w-5 h-5 rounded-full shrink-0', MARK_FILL[tone], className)} aria-hidden="true">
      <Icon className="w-3.5 h-3.5" strokeWidth={3} />
    </span>
  )
}

// A choice this person made on this device (the view, the theme); never anything that must last.
function useKept(key, initial) {
  const [value, setValue] = useState(() => {
    try { return localStorage.getItem(key) ?? initial } catch { return initial }
  })
  const keep = useCallback(v => {
    setValue(v)
    try { localStorage.setItem(key, v) } catch { /* private window: this visit only */ }
  }, [key])
  return [value, keep]
}

const darkQuery = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null)
function useDeviceDark() {
  const [dark, setDark] = useState(() => !!darkQuery()?.matches)
  useEffect(() => {
    const query = darkQuery()
    if (!query) return undefined
    const on = e => setDark(e.matches)
    query.addEventListener?.('change', on)
    return () => query.removeEventListener?.('change', on)
  }, [])
  return dark
}

// The time the board's "4 min ago" words are worked out from.
function useNow(every) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), every)
    return () => clearInterval(t)
  }, [every])
  return now
}

function Row({ tone, name, state, detail, to, testId, kind }) {
  return (
    <li className="flex items-center gap-3 px-4 py-2" data-testid={testId} data-tone={tone} data-kind={kind}>
      <ToneMark tone={tone} />
      <div className="min-w-0 flex-1 py-0.5">
        <p className="text-sm font-medium break-words">{name}</p>
        <p className={cn('text-xs', WORDS[tone])}>{state}</p>
        {detail && <p className="text-xs text-muted-foreground break-words">{detail}</p>}
      </div>
      {to && (
        <Link to={to} className="shrink-0 inline-flex items-center justify-center min-h-[48px] min-w-[48px] px-2 rounded-lg text-xs font-medium text-primary hover:bg-muted touch-manipulation" aria-label={'Set up ' + name}>
          Open <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
        </Link>
      )}
    </li>
  )
}

function Group({ icon: Icon, title, badge, note, children, testId }) {
  return (
    <section className="rounded-lg border bg-background overflow-hidden" data-testid={testId}>
      <div className="section-head px-4 py-2 flex items-center gap-2">
        <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
        <h3 className="font-semibold text-sm">{title}</h3>
        {badge && <span className="ml-auto text-xs text-muted-foreground">{badge}</span>}
      </div>
      {note && <p className="px-4 pt-2 text-xs text-muted-foreground">{note}</p>}
      <ul className="divide-y">{children}</ul>
    </section>
  )
}

/**
 * What needs someone, worst first (the model's attention), or that all is
 * well. onOpen: each entry opens its hexagon's details. big: the full screen.
 */
function Attention({ model, onOpen, big = false }) {
  const list = model.attention
  const h = model.health
  const worst = list[0]?.tone
  const box = big
    ? cn('rounded-lg px-4 py-2 border', worst === 'bad' ? 'border-red-400/60 bg-red-500/15' : worst ? 'border-amber-300/60 bg-amber-400/10' : 'border-emerald-400/50 bg-emerald-500/10')
    : cn('rounded-lg border px-4 py-3', worst === 'bad' ? 'border-red-300 bg-red-50' : worst ? 'border-amber-300 bg-amber-50' : 'border-emerald-300 bg-emerald-50')
  return (
    <div className={box} data-testid="tech-summary" role="status" style={big ? { fontSize: 'clamp(14px, 1.15vw, 24px)' } : undefined}>
      <p className={cn('font-semibold flex items-center gap-2 flex-wrap', !big && 'text-sm')}>
        <ToneMark tone={worst || (h.tone === 'ok' ? 'ok' : 'muted')} />
        {list.length ? list.length + ' need' + (list.length === 1 ? 's' : '') + ' looking at' : 'Everything is working'}
        <span className={cn('font-normal', big ? 'text-[#a3aebf]' : 'text-muted-foreground')}>· {h.counts.ok} of {h.judged} fine</span>
      </p>
      {list.length > 0 && (
        <ul className={cn('mt-1', big ? 'flex flex-wrap gap-x-6 gap-y-1' : 'text-sm space-y-0.5')}>
          {list.map(n => (
            <li key={n.key} data-testid="tech-attention" data-tone={n.tone}>
              {onOpen ? (
                <button type="button" onClick={() => onOpen(n.key)}
                  className={cn('text-left inline-flex items-center gap-2 min-h-[48px] rounded-md px-1 -mx-1 touch-manipulation', big ? 'hover:bg-white/10' : 'hover:bg-black/5')}>
                  <ToneMark tone={n.tone} className="w-4 h-4" />
                  <span><span className={cn('font-medium', !big && WORDS[n.tone])}>{n.name}</span>: {n.status}</span>
                </button>
              ) : (
                <span className="inline-flex items-start gap-2"><ToneMark tone={n.tone} className="w-4 h-4 mt-0.5" /><span><span className={WORDS[n.tone]}>{n.name}</span>: {n.status}</span></span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const Waiting = () => <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>

export function TechBoardSection({ venueId, setup }) {
  const api = useApi()
  const [view, setView] = useKept('mcrn_tech_board_view', 'hex')
  const [theme, setTheme] = useKept('mcrn_tech_board_theme', '')
  const deviceDark = useDeviceDark()
  const dark = theme ? theme === 'dark' : deviceDark
  const [full, setFull] = useState(false)
  const [openKey, setOpenKey] = useState(null)
  const every = full ? 30_000 : 60_000
  const board = useQuery({
    queryKey: ['tech-board', venueId], queryFn: () => api.get('/tech-board/venues/' + venueId),
    enabled: !!venueId, refetchInterval: every,
  })
  const light = useQuery({ queryKey: ['status-light'], queryFn: () => api.get('/status/light'), refetchInterval: every })
  const now = useNow(full ? 15_000 : 30_000)
  const b = board.data

  // The one tile model (shared/techBoard.js): tiles, groups, health, what needs someone.
  const model = useMemo(() => (b ? techModel(techTiles(b, { setup, now }), { light: light.data }) : null), [b, setup, light.data, now])
  const platform = PLATFORM_LIGHT[light.data?.state] || null
  const refresh = useCallback(() => { board.refetch(); light.refetch() }, [board, light])
  // Closing the details gives the focus back to the hexagon that opened them.
  const closeSheet = useCallback(() => {
    const key = openKey
    setOpenKey(null)
    if (key) requestAnimationFrame(() => document.querySelector('[data-tile="' + (window.CSS?.escape ? CSS.escape(key) : key) + '"]')?.focus())
  }, [openKey])
  const openTile = useCallback(key => setOpenKey(key), [])

  if (board.isLoading) return <Waiting />
  if (board.error) return <p className="text-sm text-red-700">Couldn&apos;t load the board: {board.error.message}</p>
  if (!model) return null
  const empty = !model.tiles.length
  const hex = view !== 'list'

  return (
    <div className="space-y-4" data-testid="tech-board" data-view={hex ? 'hex' : 'list'}>
      <div className="rounded-lg border bg-background px-4 py-3 flex flex-wrap items-center gap-3">
        {platform ? (
          <span className="inline-flex items-center gap-2 text-sm font-medium" data-testid="tech-platform" data-state={light.data.state}>
            <ToneMark tone={platform.tone} />
            <span className={WORDS[platform.tone]}>{platform.text}</span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-2 text-sm text-muted-foreground"><Activity className="w-4 h-4" /> Checking Macaroonie...</span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border overflow-hidden" role="group" aria-label="Show the board as" data-testid="tech-view">
            {[['hex', 'Honeycomb', Hexagon], ['list', 'List', List]].map(([v, label, Icon]) => (
              <button key={v} type="button" aria-pressed={(v === 'hex') === hex} onClick={() => setView(v)} data-value={v}
                className={cn('inline-flex items-center gap-1.5 h-12 px-3 text-sm font-medium touch-manipulation', (v === 'hex') === hex ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted')}>
                <Icon className="w-4 h-4" aria-hidden="true" /> {label}
              </button>
            ))}
          </div>
          {hex && (
            <button type="button" onClick={() => setTheme(dark ? 'light' : 'dark')} aria-pressed={dark} data-testid="tech-theme"
              className="inline-flex items-center gap-1.5 h-12 px-3 rounded-lg border text-sm touch-manipulation hover:bg-muted">
              {dark ? <Sun className="w-4 h-4" aria-hidden="true" /> : <Moon className="w-4 h-4" aria-hidden="true" />} {dark ? 'Light' : 'Dark'}
            </button>
          )}
          <button type="button" onClick={() => setFull(true)} disabled={empty} data-testid="tech-full-open"
            className="inline-flex items-center gap-1.5 h-12 px-3 rounded-lg border text-sm touch-manipulation hover:bg-muted disabled:opacity-50">
            <Maximize2 className="w-4 h-4" aria-hidden="true" /> Full screen
          </button>
          <button type="button" onClick={refresh} disabled={board.isFetching}
            className="inline-flex items-center gap-1.5 h-12 px-3 rounded-lg border text-sm touch-manipulation hover:bg-muted disabled:opacity-50">
            <RefreshCw className={cn('w-4 h-4', board.isFetching && 'animate-spin')} aria-hidden="true" /> Check now
          </button>
        </div>
        <p className="w-full text-xs text-muted-foreground">Checked {ago(b.checked_at)}; it checks again every minute.</p>
      </div>

      {!empty && <Attention model={model} onOpen={hex ? openTile : null} />}

      {empty ? (
        <p className="text-sm text-muted-foreground rounded-lg border bg-background px-4 py-6 text-center">
          No kit at this venue yet. Link tills on <Link to="/pos/tills" className="text-primary underline">Tills</Link>, or use the installer app.
        </p>
      ) : hex ? (
        <Suspense fallback={<Waiting />}>
          <HexBoard model={model} now={now} dark={dark} openKey={full ? null : openKey} setOpenKey={openTile} closeSheet={closeSheet} />
        </Suspense>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {model.groups.map(g => (
            <Group key={g.key} icon={ICON[g.key]} title={g.label} badge={g.badge} testId={'tech-' + g.key}
              note={g.key === 'card' ? 'Card machines don\'t report whether they\'re on: the last payment shows they worked.' : null}>
              {g.tiles.map(t => <Row key={t.key} tone={t.tone} name={t.name} state={t.status} detail={t.detail} kind={t.kind} to={t.link} testId="tech-item" />)}
            </Group>
          ))}
        </div>
      )}

      {full && (
        <Suspense fallback={null}>
          <FullBoard model={model} now={now} venueName={b.venue_name} timezone={b.timezone} checkedAt={b.checked_at}
            fetching={board.isFetching} onRefresh={refresh} onClose={() => { setFull(false); setOpenKey(null) }}
            openKey={openKey} setOpenKey={openTile} closeSheet={closeSheet}
            attention={<Attention model={model} onOpen={openTile} big />} />
        </Suspense>
      )}
    </div>
  )
}
