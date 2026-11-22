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
import { printerState } from './PrintersSection'
import { deviceOnline, boardSummary } from '@shared/techBoard.js'

const DOT = { ok: 'bg-emerald-500', warn: 'bg-amber-500', bad: 'bg-red-600', muted: 'bg-muted-foreground/40' }
const WORDS = { ok: 'text-emerald-800', warn: 'text-amber-800', bad: 'text-red-700', muted: 'text-muted-foreground' }
const PLATFORM = {
  up: { tone: 'ok', text: 'Macaroonie is up' },
  degraded: { tone: 'warn', text: 'Macaroonie is running slow or partly: live updates or background work may be late' },
  down: { tone: 'bad', text: 'Macaroonie isn\'t answering properly: tills keep trading offline' },
}

const pence = p => '£' + (Number(p || 0) / 100).toFixed(2)

/** A till, kitchen screen, kiosk or hub as [text, tone]. */
function deviceState(d) {
  if (!d.paired) return ['Not linked yet', 'muted']
  if (deviceOnline(d)) return ['Online' + (d.app_version ? ' · ' + d.app_version : ''), 'ok']
  if (!d.last_seen_at) return ['Linked, not heard from yet', 'warn']
  return ['Offline · last seen ' + ago(d.last_seen_at), 'bad']
}

function lastAction(d) {
  const a = d.last_action
  if (d.kind === 'hub') {
    return [a ? 'Reported ' + ago(a.at) : null, d.backup_uploaded_at ? 'copy for trading offline uploaded ' + ago(d.backup_uploaded_at) : null].filter(Boolean).join(' · ') || 'Nothing reported yet'
  }
  if (!a) return d.kind === 'kiosk' ? 'No visits yet' : 'No activity lately'
  if (d.kind === 'kiosk') return (a.what === 'order' ? 'Last order ' : 'Last visit ') + ago(a.at)
  return 'Last activity ' + ago(a.at)
}

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

  const rows = useMemo(() => {
    if (!b) return null
    const dev = kind => b.devices.filter(d => d.kind === kind).map(d => {
      const [state, tone] = deviceState(d)
      return { id: d.id, kind, name: d.name, state, tone, detail: lastAction(d) }
    })
    const printers = b.printers.filter(p => p.is_active).map(p => {
      let [state, tone] = printerState(p, setup || { devices: b.devices })
      const parts = []
      if (p.jobs.waiting) parts.push(p.jobs.waiting + ' waiting')
      // Failed tickets today make a printer need looking at, whatever it last reported.
      if (p.jobs.failed) { state += ' · ' + p.jobs.failed + ' failed today'; if (tone === 'ok' || tone === 'muted') tone = 'warn' }
      if (p.last_job) parts.push(p.last_job.status === 'failed' ? 'last ticket failed ' + ago(p.last_job.at) + (p.last_job.error ? ': ' + p.last_job.error : '') : 'last ticket ' + ago(p.last_job.at))
      return { id: p.id, kind: 'printer', name: p.name, state, tone, detail: parts.join(' · ') || 'No tickets this week' }
    })
    const cards = b.card_readers.map(r => {
      const p = r.last_payment
      const tone = !p ? 'muted' : p.status === 'approved' ? 'ok' : (p.status === 'failed' || p.status === 'declined') ? 'warn' : 'muted'
      return {
        id: r.id, kind: 'card', name: r.name, tone,
        state: p ? 'Last ' + (p.kind === 'refund' ? 'refund' : 'payment') + ' ' + ago(p.at) + ': ' + p.status + ', ' + pence(p.amount) : 'No payments in 30 days',
        detail: [r.model, r.serial].filter(Boolean).join(' · ') || null,
      }
    })
    const screens = b.screens.map(s => ({
      id: s.id, kind: 'screen', name: s.name + (s.short_code ? ' (' + s.short_code + ')' : ''),
      tone: s.state === 'online' ? (s.error ? 'warn' : 'ok') : s.state === 'offline' ? 'bad' : 'muted',
      state: s.state === 'online' ? 'Online' + (s.app_version ? ' · ' + s.app_version : '') : s.state === 'offline' ? 'Offline · last seen ' + ago(s.last_seen_at) : 'Not linked yet',
      detail: [s.showing ? 'Showing ' + s.showing : null, s.error ? 'Problem: ' + s.error : null].filter(Boolean).join(' · ') || null,
    }))
    return { hubs: dev('hub'), tills: dev('terminal'), kitchen: dev('kds'), kiosks: dev('kiosk'), printers, cards, screens }
  }, [b, setup])

  const summary = useMemo(() => (rows ? boardSummary(Object.values(rows).flat()) : null), [rows])
  const platform = PLATFORM[light.data?.state] || null

  if (board.isLoading) return <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
  if (board.error) return <p className="text-sm text-red-700">Couldn&apos;t load the board: {board.error.message}</p>
  const empty = rows && !Object.values(rows).some(l => l.length)

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
              {summary.needs.map(n => <li key={n.kind + n.id}><span className={WORDS[n.tone]}>{n.name}</span>: {n.state}</li>)}
            </ul>
          )}
        </div>
      )}

      {empty ? (
        <p className="text-sm text-muted-foreground rounded-lg border bg-background px-4 py-6 text-center">
          No kit at this venue yet. Link tills on <Link to="/pos/tills" className="text-primary underline">Tills</Link>, or use the installer app.
        </p>
      ) : rows && (
        <div className="grid gap-4 lg:grid-cols-2">
          {rows.hubs.length > 0 && <Group icon={Server} title="Venue hub" testId="tech-hubs">{rows.hubs.map(r => <Row key={r.id} {...r} to="/pos/hub" testId="tech-item" />)}</Group>}
          {rows.tills.length > 0 && <Group icon={MonitorSmartphone} title="Tills" testId="tech-tills">{rows.tills.map(r => <Row key={r.id} {...r} to="/pos/tills" testId="tech-item" />)}</Group>}
          {rows.kitchen.length > 0 && <Group icon={CookingPot} title="Kitchen screens" testId="tech-kitchen">{rows.kitchen.map(r => <Row key={r.id} {...r} to="/pos/kitchen" testId="tech-item" />)}</Group>}
          {rows.kiosks.length > 0 && <Group icon={TabletSmartphone} title="Kiosks" testId="tech-kiosks">{rows.kiosks.map(r => <Row key={r.id} {...r} to="/pos/kiosks" testId="tech-item" />)}</Group>}
          {rows.printers.length > 0 && <Group icon={Printer} title="Printers" testId="tech-printers">{rows.printers.map(r => <Row key={r.id} {...r} to="/pos/printers" testId="tech-item" />)}</Group>}
          {rows.cards.length > 0 && (
            <Group icon={CreditCard} title="Card machines" testId="tech-cards" note="Card machines don't report whether they're on: the last payment shows they worked.">
              {rows.cards.map(r => <Row key={r.id} {...r} to="/pos/cards" testId="tech-item" />)}
            </Group>
          )}
          {rows.screens.length > 0 && <Group icon={Monitor} title="Menu screens" testId="tech-screens">{rows.screens.map(r => <Row key={r.id} {...r} to="/screens" testId="tech-item" />)}</Group>}
        </div>
      )}
    </div>
  )
}
