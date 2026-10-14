// src/components/cashRecon/reconShared.jsx
//
// The pieces every "fill Cash Recon from another system" link shares:
// Loyverse (Loyverse.jsx, migration 154) and GloriaFood (GloriaFood.jsx,
// migration 159).
//
//   Card, TermChip, SummaryRow     small UI parts
//   MappingGroups                  each income source, SC source and payment
//                                  channel with its +/- list of figures
//   ReconFillModal                 the fill window: the source's figures next
//                                  to what Cash Recon has, tick days, Fill
//
// Figures and their labels come from the source's own shared file
// (shared/loyverse.js, shared/gloriafood.js); the server works the figures
// out again on Fill, so nothing written comes from the browser.

import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { Loader2, Plus, X, Check, AlertTriangle, RefreshCw, Lock } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'

export const GROUPS = [
  { key: 'income',  label: 'Income',                 configKey: 'income_sources',   empty: 'No active income sources.' },
  { key: 'sc',      label: 'Service charges & tips', configKey: 'sc_sources',       empty: 'No active service charge sources.' },
  { key: 'takings', label: 'Takings',                configKey: 'payment_channels', empty: 'No active payment channels.' },
]

export const DAY_STARTS = Array.from({ length: 24 }, (_, i) => {
  const h = Math.floor(i / 2), m = i % 2 ? '30' : '00'
  return String(h).padStart(2, '0') + ':' + m
})

export function money(n, currency = 'GBP') {
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: currency || 'GBP' }).format(n ?? 0)
  } catch {
    return (n < 0 ? '-' : '') + '£' + Math.abs(n ?? 0).toFixed(2)
  }
}

/** Cash Recon permissions for these links: fill = manage; setup = manage + owner/admin. */
export function useReconLinkPerms() {
  const api = useApi()
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api.get('/me'), staleTime: 60_000 })
  const level = me?.is_platform_admin ? 'manage' : (me?.permissions?.cash_recon ?? 'none')
  const canFill = level === 'manage'
  const canSetup = canFill && (!!me?.is_platform_admin || ['owner', 'admin'].includes(me?.role))
  return { canFill, canSetup, ready: !!me }
}

export function Card({ title, action, children }) {
  return (
    <div className="rounded-2xl border shadow-sm overflow-hidden">
      <div className="px-4 py-3 flex items-center justify-between gap-3 section-head">
        <span className="text-sm font-semibold">{title}</span>
        {action}
      </div>
      <div className="p-4 bg-background space-y-3">{children}</div>
    </div>
  )
}

export const inputCls = 'h-12 w-full rounded-xl border bg-background px-3 text-base touch-manipulation focus:outline-none focus:ring-2 focus:ring-primary/40'
export const btn = 'min-h-[48px] px-4 rounded-xl text-sm font-medium touch-manipulation disabled:opacity-50 inline-flex items-center justify-center gap-2'
export const btnPrimary = cn(btn, 'bg-primary text-primary-foreground hover:bg-primary/90')
export const btnOutline = cn(btn, 'border hover:bg-muted')
export const btnDanger = cn(btn, 'bg-destructive text-destructive-foreground hover:bg-destructive/90')

export function TermChip({ term, label, onFlip, onRemove, readOnly }) {
  const neg = term.sign < 0
  return (
    <span className={cn('inline-flex items-stretch rounded-xl border overflow-hidden text-sm',
      neg ? 'border-red-200 bg-red-50 text-red-900' : 'border-green-200 bg-green-50 text-green-900')}>
      {readOnly
        ? <span className="px-3 flex items-center font-bold">{neg ? '−' : '+'}</span>
        : (
          <button type="button" onClick={onFlip}
            aria-label={neg ? 'Subtracted, tap to add' : 'Added, tap to subtract'}
            className="w-12 min-h-[48px] text-lg font-bold touch-manipulation hover:bg-black/5 border-r border-black/10">
            {neg ? '−' : '+'}
          </button>
        )}
      <span className="px-2 py-1 flex items-center">{label}</span>
      {!readOnly && (
        <button type="button" onClick={onRemove} aria-label="Remove"
          className="w-12 min-h-[48px] flex items-center justify-center touch-manipulation hover:bg-black/5">
          <X className="w-4 h-4" />
        </button>
      )}
    </span>
  )
}

/**
 * Every active Cash Recon field with its terms.
 *   mappings     { income: { id: [term] }, takings: {...}, sc: {...} }
 *   termLabel    term -> text
 *   onChange     (group, fieldId, terms) => void
 *   onAdd        (group, field) => void (opens the source's picker)
 *   emptyText    shown for a field with no terms
 *   groupAction  (group) => node, beside a group's heading
 */
export function MappingGroups({ config, mappings, termLabel, onChange, onAdd, readOnly, emptyText, groupAction }) {
  return GROUPS.map(g => {
    const fields = (config?.[g.configKey] ?? []).filter(f => f.is_active)
    return (
      <div key={g.key} className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
          <h4 className="text-sm font-semibold">{g.label}</h4>
          {groupAction?.(g.key)}
        </div>
        {fields.length === 0 && <p className="text-sm text-muted-foreground">{g.empty}</p>}
        <div className="divide-y rounded-xl border">
          {fields.map(f => {
            const terms = mappings?.[g.key]?.[f.id] || []
            return (
              <div key={f.id} className="p-3 flex flex-col sm:flex-row sm:items-center gap-2">
                <div className="sm:w-44 shrink-0 text-sm font-medium">{f.name}</div>
                <div className="flex-1 flex flex-wrap items-center gap-2">
                  {terms.length === 0 && <span className="text-sm text-muted-foreground">{emptyText}</span>}
                  {terms.map((t, i) => (
                    <TermChip key={i} term={t} label={termLabel(t)} readOnly={readOnly}
                      onFlip={() => onChange(g.key, f.id, terms.map((x, j) => j === i ? { ...x, sign: -x.sign } : x))}
                      onRemove={() => onChange(g.key, f.id, terms.filter((_, j) => j !== i))} />
                  ))}
                  {!readOnly && (
                    <button type="button" onClick={() => onAdd(g.key, f)} className={cn(btnOutline, 'border-dashed')}>
                      <Plus className="w-4 h-4" /> Add
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  })
}

export function SummaryRow({ label, days, render }) {
  return (
    <tr className="border-b">
      <td className="sticky left-0 z-[1] bg-background px-3 py-2 text-xs text-muted-foreground">{label}</td>
      {days.map(d => <td key={d.date} className="px-2 py-2 text-right text-xs tabular-nums align-top">{render(d)}</td>)}
    </tr>
  )
}

/**
 * The fill window for one source.
 *   source       { name ('Loyverse'), path ('/loyverse'), valueKey ('loyverse'),
 *                  settingsHint ('Cash Recon settings > Loyverse') }
 *   termLabel    term -> text
 *   subtitle     data -> text under the title
 *   hasSales     day -> bool (days ticked by default on a week)
 *   summary      (days, currency) -> <SummaryRow>s about the source's day
 *   notices      data -> node shown above the table (warnings)
 */
export function ReconFillModal({ source, venueId, dates, onClose, onApplied, termLabel, subtitle, hasSales, summary, notices }) {
  const api = useApi()
  const qc = useQueryClient()
  const from = dates[0], to = dates[dates.length - 1]
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: [source.path.slice(1) + '-preview', venueId, from, to],
    queryFn:  () => api.post(`${source.path}/venues/${venueId}/preview`, { from, to }),
    staleTime: 0, gcTime: 0, retry: false,
  })
  const [picked, setPicked] = useState(null)
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState(null)
  const [result, setResult] = useState(null)

  useEffect(() => {
    if (!data) return
    setPicked(new Set(data.days
      .filter(d => d.status !== 'submitted' && (dates.length === 1 || hasSales(d)))
      .map(d => d.date)))
  }, [data, dates.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const currency = data?.currency || 'GBP'
  const days = data?.days ?? []
  const fields = data?.fields ?? []
  const toggle = date => setPicked(p => { const n = new Set(p); n.has(date) ? n.delete(date) : n.add(date); return n })

  async function apply() {
    setApplying(true); setApplyError(null)
    try {
      const r = await api.post(`${source.path}/venues/${venueId}/apply`, { dates: [...picked].sort() })
      setResult(r)
      qc.invalidateQueries({ queryKey: ['cash-recon-daily', venueId] })
      qc.invalidateQueries({ queryKey: ['cash-recon-week-detail', venueId] })
      qc.invalidateQueries({ queryKey: ['cash-recon-week'] })
      onApplied?.(r)
    } catch (e) { setApplyError(e.message) }
    setApplying(false)
  }

  const dayLabel = date => format(parseISO(date), 'EEE d MMM')

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4"
      onClick={e => { if (e.target === e.currentTarget && !applying) onClose() }}>
      <div className={cn('bg-background rounded-2xl shadow-xl w-full max-h-[85vh] flex flex-col', dates.length === 1 ? 'max-w-xl' : 'max-w-5xl')}>
        <div className="p-4 border-b flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="font-semibold">Fill from {source.name}</div>
            <div className="text-xs text-muted-foreground">
              {data ? subtitle(data) : `Reading ${source.name}…`}
            </div>
          </div>
          <button type="button" onClick={() => refetch()} disabled={isFetching || applying} aria-label="Read again"
            className="w-12 h-12 flex items-center justify-center rounded-xl hover:bg-muted touch-manipulation disabled:opacity-40">
            <RefreshCw className={cn('w-5 h-5', isFetching && 'animate-spin')} />
          </button>
          <button type="button" onClick={onClose} disabled={applying} aria-label="Close"
            className="w-12 h-12 flex items-center justify-center rounded-xl hover:bg-muted touch-manipulation"><X className="w-5 h-5" /></button>
        </div>

        <div className="overflow-auto flex-1">
          {isLoading && <div className="p-8 flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /> Reading {source.name}…</div>}
          {error && <div className="m-4 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive flex items-start gap-2"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />{error.message}</div>}
          {data && notices?.(data)}
          {data && fields.length === 0 && (
            <div className="m-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              Nothing is mapped yet. Map fields in {source.settingsHint}.
            </div>
          )}
          {data && fields.length > 0 && (
            <table className="w-max min-w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-background">
                <tr>
                  <th className="sticky left-0 z-20 bg-background text-left px-3 py-2 border-b min-w-[170px]" />
                  {days.map(d => {
                    const locked = d.status === 'submitted'
                    const on = picked?.has(d.date)
                    return (
                      <th key={d.date} className="px-2 py-2 border-b text-center min-w-[112px] align-top">
                        <div className="text-xs font-semibold">{dayLabel(d.date)}</div>
                        {locked ? (
                          <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-green-700 min-h-[48px]"><Lock className="w-3 h-3" /> Submitted</div>
                        ) : (
                          <button type="button" onClick={() => toggle(d.date)} aria-pressed={!!on} disabled={!!result}
                            className={cn('mt-1 w-full min-h-[48px] rounded-xl border text-xs font-medium touch-manipulation flex items-center justify-center gap-1',
                              on ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted')}>
                            {on ? <><Check className="w-3.5 h-3.5" /> Fill</> : 'Skip'}
                          </button>
                        )}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {GROUPS.map(g => {
                  const gf = fields.filter(f => f.group === g.key)
                  if (!gf.length) return null
                  return [
                    <tr key={g.key}><td colSpan={days.length + 1} className="sticky left-0 bg-muted/40 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.label}</td></tr>,
                    ...gf.map(f => (
                      <tr key={f.key} className="border-b">
                        <td className="sticky left-0 z-[1] bg-background px-3 py-2 align-top">
                          <div className="font-medium">{f.name}</div>
                          <div className="text-[11px] text-muted-foreground leading-snug">
                            {f.terms.map((t, i) => (i === 0 ? (t.sign < 0 ? '− ' : '') : (t.sign < 0 ? ' − ' : ' + ')) + termLabel(t)).join('')}
                          </div>
                        </td>
                        {days.map(d => {
                          const v = d.values[f.key]
                          const val = v[source.valueKey]
                          const same = v.current != null && Math.abs(v.current - val) < 0.005
                          return (
                            <td key={d.date} className="px-2 py-2 text-right align-top tabular-nums">
                              <div className={cn('font-semibold', val < 0 && 'text-red-700')}>{money(val, currency)}</div>
                              <div className="text-[11px] text-muted-foreground">
                                {v.current == null ? 'empty now' : same ? 'same now' : 'now ' + money(v.current, currency)}
                              </div>
                            </td>
                          )
                        })}
                      </tr>
                    )),
                  ]
                })}
                <tr><td colSpan={days.length + 1} className="sticky left-0 bg-muted/40 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{source.name} day</td></tr>
                {summary(days, currency)}
              </tbody>
            </table>
          )}
        </div>

        <div className="p-4 border-t flex flex-wrap items-center gap-3">
          {result ? (
            <div className="text-sm flex-1 min-w-0">
              {result.filled.length > 0 && <span className="text-green-700">Filled {result.filled.map(dayLabel).join(', ')}.</span>}
              {result.skipped.length > 0 && <span className="text-muted-foreground"> Skipped {result.skipped.map(s => dayLabel(s.date)).join(', ')} (submitted).</span>}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground flex-1 min-w-0">
              Only mapped lines are written; their notes stay. Submitted days are never changed.
              {applyError && <div className="text-sm text-destructive mt-1">{applyError}</div>}
            </div>
          )}
          {result ? (
            <button type="button" onClick={onClose} className={btnPrimary}>Done</button>
          ) : (
            <>
              <button type="button" onClick={onClose} disabled={applying} className={btnOutline}>Cancel</button>
              <button type="button" onClick={apply} disabled={applying || !picked?.size || !fields.length} className={btnPrimary}>
                {applying && <Loader2 className="w-4 h-4 animate-spin" />}
                {picked?.size ? `Fill ${picked.size} ${picked.size === 1 ? 'day' : 'days'}` : 'Fill'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
