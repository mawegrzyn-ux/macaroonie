// src/components/localInfo/shared.jsx
//
// Local info pieces shared by the page (pages/LocalInfo.jsx) and the
// dashboard widget (migration 240): the kind icons and severity colours, an
// item drawn as a row, items grouped by day, and the widget itself (the days
// around the dashboard's selected day, ahead or looking back, with kinds the
// widget's options hide). The rules (which items sit on a day, their order)
// are shared/localInfo.js, the same the API uses.
//
// What a capture found carries Relevant / Not relevant flags (migration 248):
// each person's own, tapped again to take it off, with everyone's counts.
// Pepper learns from them to tune that capture's search
// (services/localInfoSvc.js); typed-in events take none.
// A flag can carry a short note saying why (migration 252): the box opens
// when a flag is put on, the person's own note shows under the buttons with
// everyone else's, and Pepper reads the notes when it learns.
//
// The same event found under other names is one entry (migration 249): the
// other reports of it come with the item as `also`, shown under it, each
// with its source; Not the same (Manage) makes one its own entry again.

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CloudSun, TrafficCone, CalendarDays, AlertTriangle, EyeOff, ExternalLink, Loader2, ThumbsUp, ThumbsDown, ChevronDown, Layers, MessageSquarePlus, Pencil } from 'lucide-react'
import { format } from 'date-fns'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { KIND_LABELS, addDays, itemOnDay, sortDayItems, FLAG_NOTE_MAX, cleanFlagNote } from '@shared/localInfo.js'
import { webLink } from '@shared/links.js'

// No keyboard popping up by itself on a tablet when the note box opens.
const IS_TOUCH = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0

export const KIND_ICONS = { weather: CloudSun, traffic: TrafficCone, events: CalendarDays, incidents: AlertTriangle }

// How loudly an item shows: warning red, notice amber, info quiet.
export const SEV_CHIP = {
  warning: 'bg-red-100 text-red-800 border-red-200',
  notice:  'bg-amber-100 text-amber-900 border-amber-200',
  info:    'bg-muted text-foreground border-transparent',
}
export const SEV_DOT = { warning: 'bg-red-500', notice: 'bg-amber-500', info: 'bg-muted-foreground/50' }

export const dayText = d => {
  const today = new Date().toISOString().slice(0, 10)
  if (d === today) return 'Today'
  if (d === addDays(today, 1)) return 'Tomorrow'
  return format(new Date(d + 'T12:00:00'), 'EEE d MMM')
}

const rangeText = it => it.ends_on && it.ends_on !== it.starts_on
  ? dayText(it.starts_on) + ' to ' + dayText(it.ends_on)
  : dayText(it.starts_on)

/** The items between two days ('YYYY-MM-DD', both included). */
export function useLocalInfoItems({ venueId, from, to, includeHidden = false, enabled = true }) {
  const api = useApi()
  return useQuery({
    queryKey: ['local-info-items', venueId || 'all', from, to, includeHidden],
    queryFn: () => api.get(`/local-info/items?from=${from}&to=${to}`
      + (venueId ? `&venue_id=${venueId}` : '') + (includeHidden ? '&include_hidden=1' : '')),
    enabled: enabled && !!from && !!to,
  })
}

const errText = e => e?.body?.error || e?.message || 'Something went wrong'

/**
 * The person's own flag on a captured item: { id, relevant: true | false |
 * null, note? }. `note` left out keeps the note the flag has (the server
 * clears it when the flag turns the other way); '' takes it off. The reply is
 * the item's flags as they are now, put straight into every list holding the
 * item; the captures' counts are read again.
 */
export function useItemFlag() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, relevant, note }) => api.put(`/local-info/items/${id}/feedback`, note === undefined ? { relevant } : { relevant, note }),
    onSuccess: (res, { id }) => {
      qc.setQueriesData({ queryKey: ['local-info-items'] }, old => old?.items
        ? { ...old, items: old.items.map(it => it.id === id ? { ...it, feedback: res.feedback } : it) }
        : old)
      qc.invalidateQueries({ queryKey: ['local-info-sources'] })
    },
  })
}

/**
 * Relevant / Not relevant on what a capture found: the person's own flag lit
 * (tap it again to take it off) and how many people flagged each way. Open to
 * anyone who can see Local info: a flag says what was useful, it changes
 * nothing on the calendar. Typed-in events have none.
 */
export function FlagButtons({ item, compact = false }) {
  const flag = useItemFlag()
  // The note box: closed, or open with what is being typed. It opens by
  // itself when a flag is put on, so the reason can be said there and then.
  const [draft, setDraft] = useState(null)
  const fb = item.feedback
  if (!item.source_id || !fb) return null
  const mine = fb.mine === true ? 'yes' : fb.mine === false ? 'no' : ''
  const tap = want => {
    const off = fb.mine === want
    flag.mutate({ id: item.id, relevant: off ? null : want }, { onSuccess: () => setDraft(off ? null : '') })
  }
  const typed = cleanFlagNote(draft || '')
  const saveNote = () => flag.mutate({ id: item.id, relevant: fb.mine, note: typed }, { onSuccess: () => setDraft(null) })
  const notes = (fb.notes || []).filter(n => !n.mine)
  const shown = notes.slice(0, compact ? 2 : 5)
  const button = (want, Icon, label, count, on) => (
    <button type="button" onClick={() => tap(want)} disabled={flag.isPending}
      aria-pressed={fb.mine === want} title={label}
      aria-label={label + (count ? ' (' + count + ' so far)' : '')}
      data-testid={want ? 'li-flag-yes' : 'li-flag-no'} data-count={count || 0}
      className={cn('inline-flex items-center justify-center gap-1 min-h-[48px] min-w-[48px] px-2.5 rounded-lg border text-xs font-medium touch-manipulation disabled:opacity-60',
        fb.mine === want ? on : 'bg-background text-muted-foreground hover:bg-muted')}>
      <Icon className="w-4 h-4 shrink-0" />
      {!compact && <span className="hidden sm:inline">{label}</span>}
      {count > 0 && <span className="tabular-nums">{count}</span>}
    </button>
  )
  return (
    <div className="mt-1.5" data-testid="li-flags" data-mine={mine}>
      <div className="flex flex-wrap items-center gap-1.5">
        {button(true, ThumbsUp, 'Relevant', fb.relevant, 'bg-emerald-50 border-emerald-300 text-emerald-800')}
        {button(false, ThumbsDown, 'Not relevant', fb.not_relevant, 'bg-rose-50 border-rose-300 text-rose-800')}
        {fb.mine !== null && draft === null && (
          <button type="button" onClick={() => setDraft(fb.mine_note || '')} disabled={flag.isPending}
            data-testid="li-why-open" title={fb.mine_note ? 'Change your note' : 'Say why'}
            className="inline-flex items-center justify-center gap-1 min-h-[48px] min-w-[48px] px-2.5 rounded-lg border bg-background text-xs font-medium text-muted-foreground hover:bg-muted touch-manipulation disabled:opacity-60">
            {fb.mine_note ? <Pencil className="w-4 h-4 shrink-0" /> : <MessageSquarePlus className="w-4 h-4 shrink-0" />}
            <span className={compact ? 'sr-only' : ''}>{fb.mine_note ? 'Change your note' : 'Say why'}</span>
          </button>
        )}
        {flag.isPending && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
        {flag.error && <span className="text-xs text-destructive" role="alert" data-testid="li-flag-error">{errText(flag.error)}</span>}
      </div>
      {fb.mine !== null && draft !== null && (
        <form className="mt-1.5 flex flex-wrap items-start gap-1.5" data-testid="li-why-form"
          onSubmit={e => { e.preventDefault(); if (!flag.isPending) saveNote() }}>
          <div className="flex-[1_1_12rem] min-w-0">
            <input type="text" value={draft} onChange={e => setDraft(e.target.value.slice(0, FLAG_NOTE_MAX))} maxLength={FLAG_NOTE_MAX}
              autoFocus={!IS_TOUCH} data-testid="li-why-input"
              aria-label={fb.mine ? 'Why it is relevant' : 'Why it isn\u2019t relevant'}
              placeholder={fb.mine ? 'Why is it relevant? (optional)' : 'Why isn\u2019t it relevant? (optional)'}
              className="w-full h-12 px-3 rounded-lg border bg-background text-sm touch-manipulation" />
            <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums" data-testid="li-why-count">{typed.length} of {FLAG_NOTE_MAX}</p>
          </div>
          <button type="submit" disabled={flag.isPending || typed === (fb.mine_note || '')} data-testid="li-why-save"
            className="h-12 min-w-[48px] px-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium touch-manipulation disabled:opacity-50">
            {typed || !fb.mine_note ? 'Save note' : 'Take the note off'}
          </button>
          <button type="button" onClick={() => setDraft(null)} disabled={flag.isPending} data-testid="li-why-cancel"
            className="h-12 min-w-[48px] px-3 rounded-lg border bg-background text-sm touch-manipulation disabled:opacity-50">
            {fb.mine_note ? 'Cancel' : 'No note'}
          </button>
        </form>
      )}
      {fb.mine !== null && fb.mine_note && draft === null && (
        <p className="mt-1 text-xs text-muted-foreground break-words" data-testid="li-why-mine">
          <span className="font-medium text-foreground">Your note:</span> {fb.mine_note}
        </p>
      )}
      {shown.length > 0 && (
        <ul className="mt-1 space-y-0.5" data-testid="li-why-list" data-count={notes.length}>
          {shown.map((n, i) => (
            <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground break-words" data-testid="li-why-item" data-relevant={n.relevant ? '1' : '0'}>
              {n.relevant
                ? <ThumbsUp className="w-3.5 h-3.5 mt-0.5 shrink-0 text-emerald-700" aria-label="Relevant" />
                : <ThumbsDown className="w-3.5 h-3.5 mt-0.5 shrink-0 text-rose-700" aria-label="Not relevant" />}
              <span className="min-w-0"><span className="font-medium text-foreground">{n.by || 'Someone'}:</span> {n.note}</span>
            </li>
          ))}
          {notes.length > shown.length && <li className="text-[11px] text-muted-foreground" data-testid="li-why-more">and {notes.length - shown.length} more</li>}
        </ul>
      )}
    </div>
  )
}

/**
 * Not the same (migration 249): a finding merged into an entry becomes its own
 * entry again, and is never put together with another again.
 */
export function useSeparateItem() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: id => api.post(`/local-info/items/${id}/separate`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['local-info-items'] })
      qc.invalidateQueries({ queryKey: ['local-info-sources'] })
    },
  })
}

const otherReports = n => n + (n === 1 ? ' other report' : ' other reports')

/**
 * The same event found under other names, put into this entry: how many,
 * and (opened) each report with its source. Someone who can manage Local
 * info can say one isn't the same; the widget only says how many.
 */
function AlsoReported({ item, compact, canSeparate }) {
  const [open, setOpen] = useState(false)
  const [asking, setAsking] = useState(null)
  const separate = useSeparateItem()
  const also = item.also || []
  if (!also.length) return null
  if (compact) {
    return (
      <p className="text-xs text-muted-foreground mt-0.5 inline-flex items-center gap-1" data-testid="li-also-count" data-count={also.length}>
        <Layers className="w-3 h-3" /> {otherReports(also.length)} of this
      </p>
    )
  }
  return (
    <div className="mt-1" data-testid="li-also" data-count={also.length}>
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} data-testid="li-also-toggle"
        className="inline-flex items-center gap-1.5 min-h-[48px] px-2.5 -ml-2.5 rounded-lg text-xs font-medium text-muted-foreground hover:bg-muted touch-manipulation">
        <Layers className="w-3.5 h-3.5" /> {otherReports(also.length)} of this
        <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="mt-1 space-y-1.5 border-l-2 border-muted pl-3" data-testid="li-also-list">
          <p className="text-[11px] text-muted-foreground">Pepper found the same {item.kind === 'traffic' ? 'news' : item.kind === 'incidents' ? 'incident' : 'event'} under these names too.</p>
          {also.map(a => (
            <div key={a.id} className="text-xs" data-testid="li-also-item" data-id={a.id}>
              <p className="font-medium">{a.title}</p>
              {a.details && <p className="text-muted-foreground line-clamp-2">{a.details}</p>}
              <p className="text-muted-foreground">
                {[rangeText(a), a.time_text, a.place].filter(Boolean).join(' · ')}
                {webLink(a.url) && (
                  <a href={webLink(a.url)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-primary underline underline-offset-2 ml-2">
                    Source <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </p>
              {canSeparate && (asking === a.id ? (
                <div className="flex flex-wrap items-center gap-1.5 mt-1">
                  <span className="font-medium" data-testid="li-also-sure">Show it as its own entry? It won't be put together with others again.</span>
                  <button type="button" data-testid="li-also-separate-yes" disabled={separate.isPending}
                    onClick={() => separate.mutate(a.id, { onSuccess: () => setAsking(null) })}
                    className="inline-flex items-center gap-1.5 min-h-[48px] px-3 rounded-lg bg-primary text-primary-foreground text-xs font-semibold touch-manipulation disabled:opacity-50">
                    {separate.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Yes, on its own
                  </button>
                  <button type="button" data-testid="li-also-separate-no" onClick={() => setAsking(null)}
                    className="inline-flex items-center min-h-[48px] px-3 rounded-lg border bg-background text-xs font-medium touch-manipulation hover:bg-muted">
                    Keep together
                  </button>
                </div>
              ) : (
                <button type="button" data-testid="li-also-separate" onClick={() => { separate.reset(); setAsking(a.id) }}
                  className="inline-flex items-center min-h-[48px] px-2.5 -ml-2.5 rounded-lg text-xs font-medium text-primary hover:bg-muted touch-manipulation">
                  Not the same
                </button>
              ))}
            </div>
          ))}
          {separate.error && <p className="text-xs text-destructive" role="alert" data-testid="li-also-error">{errText(separate.error)}</p>}
        </div>
      )}
    </div>
  )
}

/** One item: kind icon, title, how loud, the details and where it came from. */
export function ItemRow({ item, venueNames = {}, actions = null, compact = false, canSeparate = false }) {
  const Icon = KIND_ICONS[item.kind] || CalendarDays
  const where = item.venue_id ? (venueNames[item.venue_id] || null) : 'Every venue'
  return (
    <div className={cn('flex items-start gap-3 rounded-lg border bg-background', compact ? 'p-2.5' : 'p-3', item.hidden && 'opacity-60')}
      data-testid="li-item" data-kind={item.kind} data-severity={item.severity} data-hidden={item.hidden ? '1' : '0'}>
      <span className={cn('mt-0.5 inline-flex items-center justify-center w-8 h-8 rounded-full shrink-0 border', SEV_CHIP[item.severity] || SEV_CHIP.info)}>
        <Icon className="w-4 h-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-sm font-medium">{item.title}</span>
          {item.severity !== 'info' && (
            <span className={cn('text-[11px] px-1.5 py-0.5 rounded border font-medium', SEV_CHIP[item.severity])}>
              {item.severity === 'warning' ? 'Warning' : 'Worth knowing'}
            </span>
          )}
          {item.hidden && <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground"><EyeOff className="w-3 h-3" />Hidden</span>}
          {!item.source_id && <span className="text-[11px] px-1.5 py-0.5 rounded bg-sky-100 text-sky-800">Typed in</span>}
        </div>
        {item.details && <p className="text-xs text-muted-foreground mt-0.5 whitespace-pre-wrap">{item.details}</p>}
        <p className="text-xs text-muted-foreground mt-0.5">
          {[rangeText(item), item.time_text, item.place, where].filter(Boolean).join(' · ')}
          {webLink(item.url) && (
            <a href={webLink(item.url)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-primary underline underline-offset-2 ml-2">
              Source <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </p>
        <AlsoReported item={item} compact={compact} canSeparate={canSeparate} />
        <FlagButtons item={item} compact={compact} />
      </div>
      {actions && <div className="shrink-0 flex flex-col sm:flex-row gap-1">{actions}</div>}
    </div>
  )
}

/** Items grouped under their days, in reading order (shared sortDayItems). */
export function DayGroups({ items, from, to, venueNames, renderActions, emptyText = 'Nothing held for these days.', compact = false, canSeparate = false }) {
  const days = useMemo(() => {
    const out = []
    // Each item once, under its first visible day (a multi-day one says "to <day>").
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const on = sortDayItems((items || []).filter(it =>
        it.starts_on === d || (d === from && it.starts_on < from && itemOnDay(it, d))))
      if (on.length) out.push({ date: d, items: on })
    }
    return out
  }, [items, from, to])
  if (!days.length) return <p className="text-sm text-muted-foreground py-4 text-center">{emptyText}</p>
  return (
    <div className="space-y-4">
      {days.map(day => (
        <div key={day.date} data-testid="li-day" data-date={day.date}>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">{dayText(day.date)}</h3>
          <div className="space-y-1.5">
            {day.items.map(it => <ItemRow key={it.id} item={it} venueNames={venueNames} compact={compact} canSeparate={canSeparate} actions={renderActions?.(it)} />)}
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * The dashboard widget: the week from the selected day (or the week up to it
 * with Look back on), for the dashboard's venue. Options hide kinds.
 */
export function LocalInfoWidget({ widget, venueId, ctx }) {
  const s = widget.settings || {}
  const date = ctx?.date || new Date().toISOString().slice(0, 10)
  const from = s.look_back ? addDays(date, -7) : date
  const to = s.look_back ? date : addDays(date, 7)
  const { data, isLoading } = useLocalInfoItems({ venueId, from, to })
  const items = (data?.items || []).filter(it => !s['hide_' + it.kind])
  if (isLoading) return <div className="py-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
  return (
    <div className="space-y-3" data-testid="li-widget" data-from={from} data-to={to}>
      <DayGroups items={items} from={from} to={to} compact
        emptyText={s.look_back ? 'Nothing held for the past week.' : 'Nothing held for the week ahead.'} />
      <Link to="/local-info" className="inline-flex items-center min-h-[36px] text-xs text-primary underline underline-offset-2 touch-manipulation">
        Open Local info
      </Link>
    </div>
  )
}
