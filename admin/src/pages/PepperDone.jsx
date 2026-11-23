// src/pages/PepperDone.jsx
//
// Done by Pepper (/pepper/done, Pepper-first step 4e; reports/AI first back
// office strategy.md "For review"): the changes Pepper made, from its audit
// (GET /api/ai/done). Each row says who and when, what it was and how much a
// mistake would cost (its class), what the card showed (before and after
// where the tool could say), how it went, and Undo while it is still open on
// the person's own reversible changes (POST /api/ai/actions/:id/undo, the
// chat card's own Undo). Filtered by venue and day; the person's own by
// default, everyone's for a manager of Pepper. Listed by time only: Pepper
// doesn't rank or count people (docs/PEPPER_FIRST.md 13, decision 8).
// Loaded on demand (rule 24): admin/src/routes/pepper.jsx.
import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { ListChecks, ChevronLeft, ChevronRight, Loader2, Undo2, CircleAlert, Sparkles } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { usePermission } from '@/hooks/usePermission'
import { ASSISTANT_NAME } from '@shared/assistant.js'
import { BeforeAfter } from '@/components/ai/ActionCard'

const CLASS_TEXT = {
  reversible:    { label: 'Can be undone', tone: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  consequential: { label: 'Checked before it ran', tone: 'bg-sky-50 text-sky-800 border-sky-200' },
  destructive:   { label: 'Signed off with a typed word', tone: 'bg-rose-50 text-rose-800 border-rose-200' },
}
const CHANNEL_TEXT = { staff_chat: 'in the chat', staff_mcp: 'from an AI app' }

const todayIso = () => format(new Date(), 'yyyy-MM-dd')
const shiftDay = (d, n) => { const x = parseISO(d); x.setDate(x.getDate() + n); return format(x, 'yyyy-MM-dd') }

export default function PepperDone() {
  const api = useApi()
  const qc = useQueryClient()
  const { canManage } = usePermission('ai_assistant')
  const [venueId, setVenueId] = useState('')
  const [day, setDay] = useState(todayIso)
  const [who, setWho] = useState('mine')
  const [now, setNow] = useState(() => Date.now())
  // Undo buttons go when their time is up.
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t) }, [])

  const { data: venues = [] } = useQuery({ queryKey: ['venues'], queryFn: () => api.get('/venues') })
  const params = new URLSearchParams({ who, ...(venueId ? { venue_id: venueId } : {}), ...(day ? { day } : {}) })
  const { data, isLoading, error } = useQuery({
    queryKey: ['pepper-done', who, venueId, day],
    queryFn: () => api.get('/ai/done?' + params.toString()),
  })
  const undo = useMutation({
    mutationFn: id => api.post(`/ai/actions/${id}/undo`, {}),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['pepper-done'] })
      qc.invalidateQueries({ queryKey: ['ai-conversation'] })
    },
  })
  const rows = data?.rows ?? []
  const everyone = who === 'all'

  return (
    <div className="h-full overflow-y-auto bg-page">
      <div className="flex items-center justify-between gap-3 px-4 sm:px-6 min-h-14 py-2 border-b bg-background max-lg:notouch:pl-14">
        <div className="min-w-0">
          <h1 className="font-semibold flex items-center gap-2"><ListChecks className="w-4 h-4" /> Done by {ASSISTANT_NAME}</h1>
          <p className="text-xs text-muted-foreground truncate">What {ASSISTANT_NAME} changed, who confirmed it, and Undo while it is still open</p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-4">
        <div className="rounded-lg border bg-background p-3 flex flex-wrap items-center gap-2" data-testid="done-filters">
          <select value={venueId} onChange={e => setVenueId(e.target.value)} aria-label="Venue"
            className="min-h-[44px] rounded-md border bg-background px-3 text-sm touch-manipulation" data-testid="done-venue">
            <option value="">All venues</option>
            {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setDay(d => shiftDay(d || todayIso(), -1))} aria-label="Day before"
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-md border touch-manipulation">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="relative">
              <button type="button" className="min-h-[44px] px-3 rounded-md border text-sm font-medium touch-manipulation min-w-[150px]">
                {!day ? 'Any day' : day === todayIso() ? 'Today' : format(parseISO(day), 'EEE d MMM yyyy')}
              </button>
              <input type="date" value={day} onChange={e => setDay(e.target.value)} aria-label="Day" data-testid="done-day"
                className="absolute inset-0 opacity-0 cursor-pointer w-full touch-manipulation" />
            </div>
            <button type="button" onClick={() => setDay(d => shiftDay(d || todayIso(), 1))} aria-label="Day after"
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-md border touch-manipulation">
              <ChevronRight className="w-4 h-4" />
            </button>
            {day && (
              <button type="button" onClick={() => setDay('')} className="min-h-[44px] px-3 rounded-md text-sm text-muted-foreground touch-manipulation">
                Any day
              </button>
            )}
          </div>
          {canManage && (
            <div className="ml-auto flex items-center gap-1 rounded-md border p-0.5" role="group" aria-label="Whose changes">
              {[['mine', 'Mine'], ['all', 'Everyone']].map(([k, label]) => (
                <button key={k} type="button" onClick={() => setWho(k)} data-testid={'done-who-' + k}
                  className={cn('px-3 min-h-[40px] text-sm font-medium rounded touch-manipulation',
                    who === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}>
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

        {undo.error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive flex items-start gap-2">
            <CircleAlert className="w-4 h-4 mt-0.5 shrink-0" /> {undo.error.message || 'Undo didn\'t go through'}
          </div>
        )}

        <section className="rounded-lg border bg-background overflow-hidden">
          <div className="px-4 py-3 section-head font-semibold text-sm">
            {everyone ? 'Everyone\'s changes' : 'Your changes'}{day ? ', ' + (day === todayIso() ? 'today' : format(parseISO(day), 'd MMMM')) : ''}
          </div>
          {isLoading ? (
            <div className="p-6 text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading</div>
          ) : error ? (
            <div className="p-6 text-sm text-destructive">{error.message || 'Couldn\'t load the changes.'}</div>
          ) : !rows.length ? (
            <div className="p-6 text-sm text-muted-foreground flex items-center gap-2" data-testid="done-empty">
              <Sparkles className="w-4 h-4" /> Nothing {ASSISTANT_NAME} changed {everyone ? '' : 'for you '}{day ? 'on this day' : 'yet'}{venueId ? ' at this venue' : ''}.
            </div>
          ) : (
            <ul className="divide-y" data-testid="done-list">
              {rows.map(r => <DoneRow key={r.id} row={r} everyone={everyone} now={now} undo={undo} />)}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}

function DoneRow({ row, everyone, now, undo }) {
  const cls = CLASS_TEXT[row.class]
  const open = row.card_id && row.undo_until && new Date(row.undo_until).getTime() > now
  const busy = undo.isPending && undo.variables === row.card_id
  return (
    <li className="px-4 py-3 space-y-1.5" data-testid="done-row" data-tool={row.tool}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="font-medium">{row.label}</span>
        {cls && !row.undo && <span className={cn('text-xs rounded-full border px-2 py-0.5', cls.tone)}>{cls.label}</span>}
        {!row.ok && <span className="text-xs rounded-full border border-destructive/40 bg-destructive/10 text-destructive px-2 py-0.5">Didn't go through</span>}
        {row.undone && <span className="text-xs rounded-full border px-2 py-0.5 text-muted-foreground">Undone</span>}
        <span className="ml-auto text-xs text-muted-foreground whitespace-nowrap">
          {format(parseISO(row.at), 'HH:mm')}{row.venue ? ' · ' + row.venue : ''}
        </span>
      </div>
      <div className="text-xs text-muted-foreground">
        {everyone ? (row.mine ? 'You' : (row.who || 'Someone')) : 'You'} {CHANNEL_TEXT[row.channel] || ''}
      </div>
      {row.title && <div className="text-sm">{row.title}</div>}
      {row.lines?.length > 0 && (
        <div className="text-sm text-muted-foreground space-y-0.5">{row.lines.slice(0, 6).map((l, i) => <div key={i} className="break-words">{l}</div>)}</div>
      )}
      <BeforeAfter before={row.before} after={row.after} />
      {row.message && <div className={cn('text-sm', row.ok ? 'text-emerald-700' : 'text-destructive')}>{row.message}</div>}
      {open && (
        <button type="button" disabled={busy} onClick={() => undo.mutate(row.card_id)} data-testid="done-undo"
          className="min-h-[44px] px-4 rounded-md border text-sm font-medium flex items-center gap-2 touch-manipulation disabled:opacity-50">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Undo2 className="w-4 h-4" />}
          Undo <span className="text-xs font-normal text-muted-foreground">until {format(parseISO(row.undo_until), 'HH:mm')}</span>
        </button>
      )}
    </li>
  )
}
