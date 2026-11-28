// src/components/pos/TechBoardSection.jsx
//
// Store tech → Tech board (/pos/board, 22 Nov 2026, OUTSTANDING 44.7): the
// venue's kit on one page. At the top the platform's own light (GET
// /api/status/light: up, degraded or down) and a summary of what needs
// someone; then the venue hub, tills, kitchen screens, kiosks, printers, card
// machines and menu screens, each with whether it is up, the last thing it
// did and a link to where it is set up. Read again every minute; nothing is
// live. GET /api/tech-board/venues/:venueId (routes/techBoard.js); when kit
// counts as online is shared/techBoard.js, and a printer reads as on the
// Printers page (printerState() there).
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Loader2, RefreshCw, Server, MonitorSmartphone, CookingPot, TabletSmartphone, Printer, CreditCard, Monitor, ChevronRight, Activity } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ago } from './shared'
import { techTiles, techModel, PLATFORM_LIGHT } from '@shared/techBoard.js'

const ICON = { hub: Server, till: MonitorSmartphone, kitchen: CookingPot, kiosk: TabletSmartphone, printer: Printer, card: CreditCard, screen: Monitor }

const DOT = { ok: 'bg-emerald-500', warn: 'bg-amber-500', bad: 'bg-red-600', muted: 'bg-muted-foreground/40' }
const WORDS = { ok: 'text-emerald-800', warn: 'text-amber-800', bad: 'text-red-700', muted: 'text-muted-foreground' }

function Row({ tone, name, state, detail, to, testId, kind }) {
  return (
    <li className="flex items-center gap-3 px-4 py-2" data-testid={testId} data-tone={tone} data-kind={kind}>
      <span className={cn('w-3 h-3 rounded-full shrink-0', DOT[tone])} aria-hidden="true" />
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

function Group({ icon: Icon, title, note, children, testId }) {
  return (
    <section className="rounded-lg border bg-background overflow-hidden" data-testid={testId}>
      <div className="section-head px-4 py-2 flex items-center gap-2">
        <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
        <h3 className="font-semibold text-sm">{title}</h3>
      </div>
      {note && <p className="px-4 pt-2 text-xs text-muted-foreground">{note}</p>}
      <ul className="divide-y">{children}</ul>
    </section>
  )
}

export function TechBoardSection({ venueId, setup }) {
  const api = useApi()
  const board = useQuery({
    queryKey: ['tech-board', venueId], queryFn: () => api.get('/tech-board/venues/' + venueId),
    enabled: !!venueId, refetchInterval: 60_000,
  })
  const light = useQuery({ queryKey: ['status-light'], queryFn: () => api.get('/status/light'), refetchInterval: 60_000 })
  const b = board.data

  // The one tile model (shared/techBoard.js): tiles, groups, health, what needs someone.
  const model = useMemo(() => (b ? techModel(techTiles(b, { setup }), { light: light.data }) : null), [b, setup, light.data])
  const summary = model && { needs: model.attention, good: model.health.counts.ok, total: model.health.judged }
  const platform = PLATFORM_LIGHT[light.data?.state] || null

  if (board.isLoading) return <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
  if (board.error) return <p className="text-sm text-red-700">Couldn&apos;t load the board: {board.error.message}</p>
  const empty = model && !model.tiles.length

  return (
    <div className="space-y-4" data-testid="tech-board">
      <div className="rounded-lg border bg-background px-4 py-3 flex flex-wrap items-center gap-3">
        {platform ? (
          <span className="inline-flex items-center gap-2 text-sm font-medium" data-testid="tech-platform" data-state={light.data.state}>
            <span className={cn('w-3 h-3 rounded-full', DOT[platform.tone])} aria-hidden="true" />
            <span className={WORDS[platform.tone]}>{platform.text}</span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-2 text-sm text-muted-foreground"><Activity className="w-4 h-4" /> Checking Macaroonie...</span>
        )}
        <button type="button" onClick={() => { board.refetch(); light.refetch() }} disabled={board.isFetching}
          className="ml-auto inline-flex items-center gap-1.5 min-h-[48px] px-3 rounded-lg border text-sm touch-manipulation hover:bg-muted disabled:opacity-50">
          <RefreshCw className={cn('w-4 h-4', board.isFetching && 'animate-spin')} /> Check now
        </button>
        <p className="w-full text-xs text-muted-foreground">Checked {ago(b.checked_at)}; it checks again every minute.</p>
      </div>

      {summary && !empty && (
        <div className={cn('rounded-lg border px-4 py-3', summary.needs.some(n => n.tone === 'bad') ? 'border-red-300 bg-red-50' : summary.needs.length ? 'border-amber-300 bg-amber-50' : 'border-emerald-300 bg-emerald-50')} data-testid="tech-summary">
          <p className="text-sm font-semibold">
            {summary.needs.length ? summary.needs.length + ' need' + (summary.needs.length === 1 ? 's' : '') + ' looking at' : 'Everything is working'}
            <span className="font-normal text-muted-foreground"> · {summary.good} of {summary.total} fine</span>
          </p>
          {summary.needs.length > 0 && (
            <ul className="mt-1 text-sm space-y-0.5">
              {summary.needs.map(n => <li key={n.key}><span className={WORDS[n.tone]}>{n.name}</span>: {n.status}</li>)}
            </ul>
          )}
        </div>
      )}

      {empty ? (
        <p className="text-sm text-muted-foreground rounded-lg border bg-background px-4 py-6 text-center">
          No kit at this venue yet. Link tills on <Link to="/pos/tills" className="text-primary underline">Tills</Link>, or use the installer app.
        </p>
      ) : model && (
        <div className="grid gap-4 lg:grid-cols-2">
          {model.groups.map(g => (
            <Group key={g.key} icon={ICON[g.key]} title={g.label} testId={'tech-' + g.key}
              note={g.key === 'card' ? 'Card machines don\'t report whether they\'re on: the last payment shows they worked.' : null}>
              {g.tiles.map(t => <Row key={t.key} tone={t.tone} name={t.name} state={t.status} detail={t.detail} kind={t.kind} to={t.link} testId="tech-item" />)}
            </Group>
          ))}
        </div>
      )}
    </div>
  )
}
