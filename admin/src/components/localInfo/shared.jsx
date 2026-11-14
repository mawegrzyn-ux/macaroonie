// src/components/localInfo/shared.jsx
//
// Local info pieces shared by the page (pages/LocalInfo.jsx) and the
// dashboard widget (migration 240): the kind icons and severity colours, an
// item drawn as a row, items grouped by day, and the widget itself (the days
// around the dashboard's selected day, ahead or looking back, with kinds the
// widget's options hide). The rules (which items sit on a day, their order)
// are shared/localInfo.js, the same the API uses.

import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { CloudSun, TrafficCone, CalendarDays, AlertTriangle, EyeOff, ExternalLink, Loader2 } from 'lucide-react'
import { format } from 'date-fns'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { KIND_LABELS, addDays, itemOnDay, sortDayItems } from '@shared/localInfo.js'
import { webLink } from '@shared/links.js'

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

/** One item: kind icon, title, how loud, the details and where it came from. */
export function ItemRow({ item, venueNames = {}, actions = null, compact = false }) {
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
      </div>
      {actions && <div className="shrink-0 flex flex-col sm:flex-row gap-1">{actions}</div>}
    </div>
  )
}

/** Items grouped under their days, in reading order (shared sortDayItems). */
export function DayGroups({ items, from, to, venueNames, renderActions, emptyText = 'Nothing held for these days.', compact = false }) {
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
            {day.items.map(it => <ItemRow key={it.id} item={it} venueNames={venueNames} compact={compact} actions={renderActions?.(it)} />)}
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
