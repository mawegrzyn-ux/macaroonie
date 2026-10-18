// src/components/orders/TransactionsReport.jsx
//
// Online orders page, Transactions tab: every online order of the venue over
// a range of days, Macaroonie's own online ordering and GloriaFood together,
// each with its tender (how it was paid), totals by tender and by source, and
// a CSV of the same rows. All figures come from GET /api/orders/transactions
// (services/onlineSalesSvc.js); this file only shows them.

import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Download, ChevronDown, ChevronRight } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn, openPicker } from '@/lib/utils'
import { money, timeOf, GloriaFoodBadge } from '@/components/orders/shared'

const PAGE = 100
const MAX_DAYS = 366
const PRESETS = [[1, 'Today'], [7, '7 days'], [30, '30 days'], [90, '90 days'], ['custom', 'Choose days']]

function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}
const dayCount = (from, to) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000) + 1
const shortDay = date => new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(date + 'T12:00:00Z'))
const longDay = date => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(date + 'T12:00:00Z'))
const readyText = (iso, tz) => {
  if (!iso) return null
  const d = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
  return shortDay(d) + ', ' + timeOf(iso, tz)
}

function DateButton({ label, value, onChange }) {
  return (
    <div className="relative">
      <span className="inline-flex items-center min-h-[44px] px-3 border rounded-md text-sm">
        <span className="text-muted-foreground mr-1.5">{label}</span>{longDay(value)}
      </span>
      <input type="date" value={value} onChange={e => e.target.value && onChange(e.target.value)} onClick={openPicker}
        className="absolute inset-0 opacity-0 cursor-pointer" aria-label={label + ' day'} />
    </div>
  )
}

function Card({ title, right, children, className }) {
  return (
    <div className={cn('rounded-lg border bg-background overflow-hidden', className)}>
      <div className="px-4 py-3 section-head flex items-center justify-between gap-3">
        <h3 className="font-semibold text-sm">{title}</h3>
        {right}
      </div>
      {children}
    </div>
  )
}

export function TransactionsReport({ venueId, venue, today }) {
  const api = useApi()
  const tz = venue?.timezone || 'Europe/London'
  const [preset, setPreset] = useState(7)
  const [custom, setCustom] = useState(() => ({ from: addDays(today, -6), to: today }))
  const [source, setSource] = useState('')
  const [tender, setTender] = useState('')
  const [countedOnly, setCountedOnly] = useState(false)
  const [limit, setLimit] = useState(PAGE)
  const [openRow, setOpenRow] = useState(null)
  const [csv, setCsv] = useState({ busy: false, error: null })

  const from = preset === 'custom' ? custom.from : addDays(today, -(preset - 1))
  const to = preset === 'custom' ? custom.to : today
  const rangeProblem = from > to ? 'The first day is after the last day.'
    : dayCount(from, to) > MAX_DAYS ? `Pick at most ${MAX_DAYS} days.` : null

  const params = new URLSearchParams({ venue_id: venueId, from, to })
  if (source) params.set('source', source)
  if (tender) params.set('tender', tender)
  if (countedOnly) params.set('counted', '1')
  const qs = params.toString()

  const q = useQuery({
    queryKey: ['orders-transactions', qs],
    queryFn: () => api.get('/orders/transactions?' + qs),
    enabled: !!venueId && !rangeProblem,
    placeholderData: prev => prev,
  })
  useEffect(() => { setLimit(PAGE); setOpenRow(null) }, [qs])

  const r = rangeProblem ? null : q.data
  const cur = r?.currency || 'GBP'
  const twoSources = (r?.sources?.length || 0) > 1
  const tenderOptions = useMemo(() => {
    const list = r?.tenders || []
    return tender && !list.some(t => t.key === tender) ? [...list, { key: tender, label: tender.replace(/^other:/, '') }] : list
  }, [r, tender])

  async function downloadCsv() {
    setCsv({ busy: true, error: null })
    const slug = (venue?.name || 'venue').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'venue'
    try {
      await api.download('/orders/transactions.csv?' + qs, `online-sales-${slug}-${from}-to-${to}.csv`)
      setCsv({ busy: false, error: null })
    } catch (e) {
      console.error('Online sales CSV failed:', e)
      setCsv({ busy: false, error: e?.message || 'The CSV could not be made.' })
    }
  }

  const rows = r?.rows || []
  const shown = rows.slice(0, limit)

  return (
    <div className="space-y-5">
      {/* Range */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {PRESETS.map(([k, l]) => (
            <button key={k} onClick={() => {
              if (k === 'custom' && preset !== 'custom') setCustom({ from, to })
              setPreset(k)
            }}
              className={cn('min-h-[44px] px-4 rounded-md text-sm touch-manipulation', preset === k ? 'bg-primary text-primary-foreground' : 'border bg-background')}>{l}</button>
          ))}
        </div>
        {preset === 'custom' && (
          <div className="flex flex-wrap items-center gap-2">
            <DateButton label="From" value={custom.from} onChange={v => setCustom(c => ({ ...c, from: v }))} />
            <DateButton label="To" value={custom.to} onChange={v => setCustom(c => ({ ...c, to: v }))} />
          </div>
        )}
      </div>
      {rangeProblem && <p className="text-sm text-destructive">{rangeProblem}</p>}

      {/* Filters */}
      {!rangeProblem && (
        <div className="flex flex-wrap items-center gap-2">
          {(twoSources || source) && (
            <div className="flex flex-wrap gap-1" role="group" aria-label="Source">
              {[['', 'All sources'], ...(r?.sources || []).map(s => [s.key, s.label])].map(([k, l]) => (
                <button key={k || 'all'} onClick={() => setSource(k)} aria-pressed={source === k}
                  className={cn('min-h-[44px] px-3 rounded-md text-sm touch-manipulation', source === k ? 'bg-primary text-primary-foreground' : 'border bg-background')}>{l}</button>
              ))}
            </div>
          )}
          <select value={tender} onChange={e => setTender(e.target.value)} aria-label="Tender"
            className="border rounded-md px-3 min-h-[44px] text-sm bg-background touch-manipulation">
            <option value="">All tenders</option>
            {tenderOptions.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
          <button onClick={() => setCountedOnly(v => !v)} aria-pressed={countedOnly}
            className={cn('min-h-[44px] px-3 rounded-md text-sm touch-manipulation', countedOnly ? 'bg-primary text-primary-foreground' : 'border bg-background')}>
            Counted only
          </button>
          <button onClick={downloadCsv} disabled={csv.busy || !r}
            className="ml-auto inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-md border bg-background text-sm font-medium touch-manipulation disabled:opacity-50">
            {csv.busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Download CSV
          </button>
        </div>
      )}
      {csv.error && <p className="text-sm text-destructive">{csv.error}</p>}

      {!rangeProblem && q.isLoading && <Loader2 className="w-5 h-5 animate-spin" />}
      {!rangeProblem && q.error && <p className="text-sm text-destructive">{q.error.message}</p>}

      {r && (
        <div className={cn('space-y-5', q.isFetching && 'opacity-60 transition-opacity')}>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            {[
              ['Orders', r.totals.orders],
              ['Sales', money(r.totals.sales_pence, cur)],
              ['Refunded', money(r.totals.refunded_pence, cur)],
              ['Net', money(r.totals.net_pence, cur)],
              ['Tips', money(r.totals.tip_pence, cur)],
              ['Average order', money(r.totals.average_pence, cur)],
            ].map(([l, v]) => (
              <div key={l} className="rounded-lg border p-3" data-testid={'tx-total-' + l.toLowerCase().replace(/ /g, '-')}>
                <div className="text-xs text-muted-foreground">{l}</div>
                <div className="text-xl font-bold">{v}</div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Sales are the totals of counted orders (tips included, discounts taken off); net is sales less refunds.
            {r.totals.not_counted > 0 && <> {r.totals.not_counted} {r.totals.not_counted === 1 ? 'order is' : 'orders are'} listed but not counted (rejected or cancelled, or a GloriaFood test order).</>}
            {' '}Online orders still waiting for their online payment aren&apos;t listed.
            {r.gloriafood && <> GloriaFood orders are on the day of their {r.gloriafood.day_basis === 'accepted' ? 'accepted' : 'fulfil'} time, each day starting at {String(r.gloriafood.day_starts_at || '00:00').slice(0, 5)} (the GloriaFood link in Cash Recon settings), as Cash Recon fills them.</>}
          </p>

          <div className="grid lg:grid-cols-3 gap-5">
            <Card title="By tender" className="lg:col-span-2">
              {!r.by_tender.length && <p className="text-sm text-muted-foreground p-4">No counted orders.</p>}
              <div className="divide-y">
                {r.by_tender.map(t => (
                  <div key={t.key} className="px-4 py-2.5 text-sm" data-testid="tx-tender-row">
                    <div className="flex justify-between gap-3">
                      <span className="font-medium">{t.label}</span>
                      <span>
                        <span className="font-semibold">{money(t.net_pence, cur)}</span>
                        <span className="text-muted-foreground"> ({t.orders} {t.orders === 1 ? 'order' : 'orders'})</span>
                      </span>
                    </div>
                    {twoSources && !source && (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {[['web', 'Online ordering'], ['gloriafood', 'GloriaFood']]
                          .filter(([k]) => t[k]?.orders)
                          .map(([k, l]) => `${l} ${money(t[k].net_pence, cur)} (${t[k].orders})`).join(' · ')}
                      </div>
                    )}
                    {t.refunded_pence > 0 && <div className="text-xs text-muted-foreground mt-0.5">Refunded {money(t.refunded_pence, cur)} of {money(t.sales_pence, cur)}</div>}
                  </div>
                ))}
              </div>
            </Card>
            <Card title="By source">
              {!r.by_source.length && <p className="text-sm text-muted-foreground p-4">No counted orders.</p>}
              <div className="divide-y">
                {r.by_source.map(s => (
                  <div key={s.key} className="px-4 py-2.5 text-sm flex justify-between gap-3">
                    <span className="font-medium">{s.label}</span>
                    <span><span className="font-semibold">{money(s.net_pence, cur)}</span> <span className="text-muted-foreground">({s.orders})</span></span>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <Card title={`Transactions (${rows.length})`}
            right={r.truncated ? <span className="text-xs text-amber-800">Too many to list: pick fewer days</span> : null}>
            {!rows.length && <p className="text-sm text-muted-foreground p-4">No online orders on these days{source || tender || countedOnly ? ' with these filters' : ''}.</p>}
            {rows.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground border-b">
                      <th className="px-3 py-2 font-medium">When</th>
                      <th className="px-3 py-2 font-medium">Order</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium">Tender</th>
                      <th className="px-3 py-2 font-medium text-right">Total</th>
                      <th className="px-3 py-2 font-medium text-right">Refunded</th>
                      <th className="px-3 py-2 font-medium text-right">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map(t => {
                      const key = t.source + ':' + t.id
                      const open = openRow === key
                      return (
                        <TxRow key={key} t={t} tz={tz} cur={cur} open={open} onToggle={() => setOpenRow(open ? null : key)} />
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {rows.length > limit && (
              <div className="p-3 border-t flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">Showing {limit} of {rows.length}. The CSV has them all.</span>
                <button onClick={() => setLimit(l => l + PAGE)}
                  className="min-h-[44px] px-4 rounded-md border bg-background text-sm font-medium touch-manipulation">Show {Math.min(PAGE, rows.length - limit)} more</button>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  )
}

function TxRow({ t, tz, cur, open, onToggle }) {
  const muted = !t.counted
  const extras = [
    ['Type', t.type_label],
    ['Ready for', readyText(t.ready_at, tz)],
    ['Tips', t.tip_pence ? money(t.tip_pence, cur) : null],
    ['Discounts', t.discount_pence ? '-' + money(t.discount_pence, cur) : null],
    ['Delivery and fees', t.fees_pence ? money(t.fees_pence, cur) : null],
    ['VAT / tax', t.tax_pence ? money(t.tax_pence, cur) : null],
  ].filter(([, v]) => v)
  return (
    <>
      <tr onClick={onToggle} role="button" tabIndex={0} aria-expanded={open}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() } }}
        className={cn('border-b last:border-0 cursor-pointer touch-manipulation hover:bg-muted/40 align-top', muted && 'text-muted-foreground', open && 'bg-muted/30')}
        data-testid="tx-row" data-source={t.source} data-number={t.number}>
        <td className="px-3 py-2.5 whitespace-nowrap">
          <div className="flex items-start gap-1.5">
            {open ? <ChevronDown className="w-4 h-4 mt-0.5 shrink-0" /> : <ChevronRight className="w-4 h-4 mt-0.5 shrink-0" />}
            <div>
              <div className="font-medium">{shortDay(t.date)}</div>
              <div className="text-xs text-muted-foreground">{t.at ? timeOf(t.at, tz) : ''}</div>
            </div>
          </div>
        </td>
        <td className="px-3 py-2.5">
          <div className="font-medium whitespace-nowrap">#{t.number}</div>
          {t.source === 'gloriafood'
            ? <GloriaFoodBadge className="mt-0.5 inline-block" />
            : <span className="text-xs text-muted-foreground">Online ordering</span>}
        </td>
        <td className="px-3 py-2.5">
          <div>{t.status_label}</div>
          {!t.counted && <span className="inline-block mt-0.5 text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 font-medium">Not counted{t.note && t.note !== t.status_label ? ': ' + t.note : ''}</span>}
        </td>
        <td className="px-3 py-2.5">
          <div className={cn(!muted && 'text-foreground')}>{t.tender_label}</div>
          {t.tender_detail && <div className="text-xs text-muted-foreground">{t.tender_detail}</div>}
        </td>
        <td className="px-3 py-2.5 text-right whitespace-nowrap">{money(t.total_pence, cur)}</td>
        <td className="px-3 py-2.5 text-right whitespace-nowrap">{t.refunded_pence ? money(t.refunded_pence, cur) : ''}</td>
        <td className={cn('px-3 py-2.5 text-right whitespace-nowrap font-semibold', muted && 'font-normal line-through')}>{money(t.counted ? t.net_pence : t.total_pence, cur)}</td>
      </tr>
      {open && (
        <tr className="border-b bg-muted/30">
          <td colSpan={7} className="px-3 pb-3 pt-0">
            <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1 text-xs pl-6">
              {extras.map(([l, v]) => (
                <div key={l} className="flex justify-between gap-2 sm:block">
                  <dt className="text-muted-foreground">{l}</dt>
                  <dd className="font-medium">{v}</dd>
                </div>
              ))}
            </dl>
          </td>
        </tr>
      )}
    </>
  )
}
