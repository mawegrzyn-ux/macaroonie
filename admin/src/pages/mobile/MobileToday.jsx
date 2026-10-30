// src/pages/mobile/MobileToday.jsx
//
// Today on the phone (/mobile/today): the office Today page's greeting, day
// at a glance and tasks grouped Late / Now / Next / Later (GET /api/ops/today,
// worked out from data and rules), one column. Forms open in a sheet with the
// same panels; other tasks open the phone's own page, or the office site when
// the phone has none (mobile/today.js). Pepper is its own tile on the phone.

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, Loader2, Sparkles, ChevronRight } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ASSISTANT_NAME } from '@shared/assistant.js'
import { readVenue, keepVenue, greeting, firstName, Glance, TaskBoard, FormSheet, Note } from '@/pages/OpsToday'
import { useTodayFeed, opsLink } from '@/mobile/today'

export default function MobileToday() {
  const api = useApi()
  const qc = useQueryClient()
  const [venueId, setVenueId] = useState(readVenue)
  const [form, setForm] = useState(null)
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api.get('/me'), staleTime: 60_000 })
  const feed = useTodayFeed(venueId)
  // A remembered venue that has gone: start again from the first one.
  const gone = feed.error?.status === 404 && !!venueId
  useEffect(() => { if (gone) { keepVenue(''); setVenueId('') } }, [gone])
  const d = feed.data

  function pickVenue(id) { keepVenue(id); setVenueId(id) }
  function closeForm() {
    setForm(null)
    qc.invalidateQueries({ queryKey: ['ops-today'] })
  }
  const { text: hello, Icon: HelloIcon } = greeting(d?.now)
  const name = firstName(me)
  const canPepper = (me?.permissions?.ai_assistant || 'none') !== 'none'

  return (
    <div className="p-3 space-y-3" data-testid="mobile-today">
      {d?.venues?.length > 1 && (
        <select value={d.venue.id} onChange={e => pickVenue(e.target.value)} data-testid="today-venue"
          className="w-full border rounded-md px-3 min-h-[48px] text-sm bg-background">
          {d.venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      )}

      <div className="rounded-lg border bg-background p-4" data-testid="today-greeting">
        <div className="flex items-start gap-3">
          <HelloIcon className="w-6 h-6 text-primary shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-lg font-semibold leading-tight">{hello}{name ? ', ' + name : ''}</p>
            <p className="text-sm text-muted-foreground mt-0.5">
              {d ? <>{d.day.replace(/,/g, '').replace(/ \d{4}$/, '')} · {d.now}</> : 'Working out your day...'}
            </p>
          </div>
          <button type="button" onClick={() => feed.refetch()} aria-label="Refresh" data-testid="today-refresh"
            className="w-12 h-12 -my-1 shrink-0 rounded-md border flex items-center justify-center hover:bg-accent touch-manipulation">
            <RefreshCw className={cn('w-4 h-4', feed.isFetching && 'animate-spin')} />
          </button>
        </div>
        {d && <Glance d={d} linkFor={opsLink} />}
      </div>

      {feed.isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading today's tasks
        </div>
      )}
      {feed.error && feed.error.status !== 404 && <Note tone="red">Couldn't load today's tasks: {feed.error.message}</Note>}
      {feed.error?.status === 404 && !venueId && <Note tone="amber">{feed.error.message}.</Note>}

      {d && <TaskBoard d={d} onForm={t => setForm({ ...t.action, task: t })} linkFor={opsLink} />}

      {canPepper && (
        <Link to="/mobile/assistant" data-testid="today-ask-pepper"
          className="flex items-center gap-3 rounded-lg border bg-background px-4 min-h-[56px] touch-manipulation hover:bg-accent">
          <Sparkles className="w-5 h-5 text-primary shrink-0" />
          <span className="flex-1 text-sm font-medium">Ask {ASSISTANT_NAME} about today</span>
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        </Link>
      )}

      {form && d && <FormSheet form={form} venueId={d.venue.id} date={d.date} onClose={closeForm} linkFor={opsLink} />}
    </div>
  )
}
