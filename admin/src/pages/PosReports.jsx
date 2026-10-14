// src/pages/PosReports.jsx
//
// Till reports (/pos/reports, pos_reports): trading days with their X / Z
// figures and the Cash Recon fill, every check with its full history
// (event by event), changes the till made that the server refused
// (conflicts), and the print queue. Figures come from dayFigures() in
// shared/pos/reports.js, the same code the till's X / Z report uses.

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { BarChart3, Loader2, ChevronLeft, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { usePermission } from '@/hooks/usePermission'
import { checkTotals, modifierText } from '@shared/pos/pricing.js'
import { TENDERS } from '@shared/pos/checks.js'
import { PageHeader, VenueSelect, usePosVenue, ErrorNote, Btn, Segmented, money, inputCls } from '@/components/pos/shared'

const TABS = [
  { value: 'days', label: 'Days' },
  { value: 'checks', label: 'Checks' },
  { value: 'conflicts', label: 'Refused changes' },
  { value: 'print', label: 'Print queue' },
]
const tenderLabel = k => TENDERS.find(t => t.key === k)?.label || k
const when = iso => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')
const time = iso => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '')
const dayLabel = d => new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })

function Card({ title, children, actions }) {
  return (
    <section className="rounded-xl border bg-background overflow-hidden">
      <div className="px-4 py-3 section-head flex items-center gap-3">
        <h2 className="text-sm font-semibold flex-1">{title}</h2>
        {actions}
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}

function Rows({ rows }) {
  return (
    <dl className="divide-y text-sm">
      {rows.filter(Boolean).map(([k, v, strong]) => (
        <div key={k} className={cn('flex justify-between gap-3 py-1.5', strong && 'font-semibold')}>
          <dt className="text-muted-foreground">{k}</dt><dd className="tabular-nums text-right">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

// ── Days ─────────────────────────────────────────────────────────

function DayDetail({ venueId, dayId, onBack, onShowChecks }) {
  const api = useApi()
  const qc = useQueryClient()
  const { canManage } = usePermission('pos_reports')
  const { data: day, isLoading, error } = useQuery({
    queryKey: ['pos-day', venueId, dayId], queryFn: () => api.get(`/pos/venues/${venueId}/days/${dayId}`),
  })
  const fill = useMutation({
    mutationFn: () => api.post(`/pos/venues/${venueId}/days/${dayId}/fill-recon`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pos-day', venueId, dayId] }); qc.invalidateQueries({ queryKey: ['pos-days', venueId] }) },
  })
  if (isLoading) return <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mx-auto my-10" />
  if (error) return <ErrorNote error={error} />
  const f = day.figures
  const staffName = id => day.names.staff[id] || 'Unknown'
  const rcName = id => day.names.revenue_centres[id] || 'No revenue centre'
  const diff = day.declared_cash != null ? day.declared_cash - f.cash_expected : null
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Btn onClick={onBack}><ChevronLeft className="w-4 h-4" /> Days</Btn>
        <h2 className="text-base font-semibold flex-1">
          {dayLabel(day.business_date)} · {day.live ? 'open now (X)' : 'Z ' + day.z_number}
        </h2>
        <Btn onClick={onShowChecks}>Checks</Btn>
      </div>
      {day.live && <p className="text-sm text-muted-foreground">The day is still open: these figures are as of now. They're fixed when the day is closed on a till.</p>}
      <div className="grid md:grid-cols-2 gap-4">
        <Card title="Sales">
          <Rows rows={[
            ['Before discounts', money(f.sales.gross)],
            f.sales.discounts ? ['Discounts', '−' + money(f.sales.discounts)] : null,
            ['Sales', money(f.sales.net)],
            f.sales.service_charge ? ['Service charge', money(f.sales.service_charge)] : null,
            ['Total', money(f.sales.total), true],
            ['Of which VAT', money(f.sales.vat_total)],
            ['Checks', f.counts.closed + (f.counts.open ? ' (+' + f.counts.open + ' open)' : '')],
            ['Covers', f.covers],
            ['Average check', money(f.sales.average_check)],
            f.covers ? ['Per cover', money(f.sales.per_cover)] : null,
          ]} />
        </Card>
        <Card title="Payments">
          <Rows rows={[
            ...f.tenders.map(t => [t.label + ' (' + t.count + ')', money(t.amount) + (t.refunds ? ' − ' + money(t.refunds) : '')]),
            f.tips ? ['Tips', money(f.tips)] : null,
            ['Takings', money(f.takings), true],
            ['Cash expected', money(f.cash_expected)],
            day.declared_cash != null ? ['Cash counted', money(day.declared_cash)] : null,
            diff != null ? ['Difference', (diff > 0 ? '+' : '') + money(diff), true] : null,
          ]} />
        </Card>
        <Card title="Revenue centres">
          <Rows rows={f.revenue_centres.length ? f.revenue_centres.map(r => [rcName(r.id), money(r.net)]) : [['None yet', '']]} />
        </Card>
        <Card title="VAT">
          <Rows rows={f.vat.length ? f.vat.map(v => [v.rate + '% on ' + money(v.net), money(v.vat)]) : [['None yet', '']]} />
        </Card>
        <Card title="Staff">
          <Rows rows={f.staff.length ? f.staff.map(s => [staffName(s.id), money(s.total) + (s.tips ? ' + ' + money(s.tips) + ' tips' : '')]) : [['None yet', '']]} />
        </Card>
        <Card title="Discounts and comps">
          <Rows rows={f.discounts.length ? f.discounts.map(d => [d.name + (d.comp && !/^comp/i.test(d.name) ? ' (comp)' : '') + ' × ' + d.count, money(d.amount)]) : [['None', '']]} />
        </Card>
        <Card title={'Voids (' + f.voids.count + ')'}>
          {f.voids.lines.length ? (
            <ul className="divide-y text-sm">
              {f.voids.lines.map((v, i) => (
                <li key={i} className="py-1.5">
                  <div className="flex justify-between gap-2"><span>{v.qty} × {v.name}</span><span className="tabular-nums">{money(v.value)}</span></div>
                  <p className="text-xs text-muted-foreground">Check {v.number} · {v.reason}{v.waste ? ' · wasted' : ''} · {staffName(v.by)}{v.approved_by ? ', approved by ' + staffName(v.approved_by) : ''}</p>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted-foreground">None</p>}
        </Card>
        <Card title={'Refunds (' + f.refunds.count + ')'}>
          {f.refunds.lines.length ? (
            <ul className="divide-y text-sm">
              {f.refunds.lines.map((r, i) => (
                <li key={i} className="py-1.5">
                  <div className="flex justify-between gap-2"><span>Check {r.number} · {tenderLabel(r.tender)}</span><span className="tabular-nums">{money(r.amount)}</span></div>
                  <p className="text-xs text-muted-foreground">{r.reason} · {staffName(r.by)}{r.approved_by ? ', approved by ' + staffName(r.approved_by) : ''}</p>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted-foreground">None</p>}
        </Card>
        <Card title="Best sellers">
          <Rows rows={f.items.length ? f.items.slice(0, 15).map(i => [i.qty + ' × ' + i.name, money(i.net)]) : [['None yet', '']]} />
        </Card>
        {!!f.open_checks.length && (
          <Card title={'Open checks (' + f.open_checks.length + ')'}>
            <Rows rows={f.open_checks.map(c => ['Check ' + (c.order_no != null ? '#' + c.order_no : c.number) + (c.tab_name ? ' · ' + c.tab_name : ''), money(c.balance) + ' to pay'])} />
          </Card>
        )}
      </div>
      {!day.live && (
        <Card title="Cash Recon">
          <div className="space-y-3 text-sm">
            {day.recon_filled_at
              ? <p className="flex items-center gap-2 text-green-700"><CheckCircle2 className="w-4 h-4" /> Filled {when(day.recon_filled_at)}.</p>
              : day.recon_error
                ? <p className="flex items-center gap-2 text-amber-700"><AlertTriangle className="w-4 h-4" /> Not filled: {day.recon_error}.</p>
                : <p className="text-muted-foreground">Not filled yet.</p>}
            <p className="text-xs text-muted-foreground">Writes the mapped figures (Till setup, Cash Recon) into the Cash Recon day for {dayLabel(day.business_date)}. Fields that aren't mapped are left alone; a submitted Cash Recon day isn't changed.</p>
            {canManage && (
              <Btn variant="primary" disabled={fill.isPending} onClick={() => fill.mutate()}>
                {fill.isPending && <Loader2 className="w-4 h-4 animate-spin" />} {day.recon_filled_at ? 'Fill Cash Recon again' : 'Fill Cash Recon'}
              </Btn>
            )}
            {fill.data && !fill.data.filled && (
              <p className="text-amber-700">{fill.data.skipped === 'not_mapped' ? 'Nothing is mapped to Cash Recon yet.' : 'The Cash Recon day is already submitted: unsubmit it first.'}</p>
            )}
            <ErrorNote error={fill.error} />
          </div>
        </Card>
      )}
    </div>
  )
}

function DaysTab({ venueId, onShowChecks }) {
  const api = useApi()
  const [dayId, setDayId] = useState(null)
  const { data: days = [], isLoading, error } = useQuery({ queryKey: ['pos-days', venueId], queryFn: () => api.get(`/pos/venues/${venueId}/days`) })
  if (dayId) return <DayDetail venueId={venueId} dayId={dayId} onBack={() => setDayId(null)} onShowChecks={() => onShowChecks(dayId)} />
  if (isLoading) return <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mx-auto my-10" />
  return (
    <div className="space-y-3">
      <ErrorNote error={error} />
      {!days.length && <p className="text-sm text-muted-foreground">No trading days yet. A day starts with the first sale on a till.</p>}
      {!!days.length && (
        <div className="rounded-xl border bg-background divide-y">
          {days.map(d => (
            <button key={d.id} type="button" onClick={() => setDayId(d.id)}
              className="w-full text-left flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-muted touch-manipulation">
              <div className="flex-1 min-w-[160px]">
                <p className="text-sm font-medium">{dayLabel(d.business_date)}</p>
                <p className="text-xs text-muted-foreground">
                  {d.closed_at ? 'Z ' + d.z_number + ' · closed ' + time(d.closed_at) : 'Open now'} · {d.checks} checks
                </p>
              </div>
              {d.closed_at && (
                <span className={cn('text-xs rounded-full px-2 py-0.5 border', d.recon_filled_at ? 'text-green-700 border-green-300 bg-green-50' : d.recon_error ? 'text-amber-700 border-amber-300 bg-amber-50' : 'text-muted-foreground')}>
                  {d.recon_filled_at ? 'In Cash Recon' : d.recon_error ? 'Cash Recon not filled' : 'Cash Recon not filled'}
                </span>
              )}
              <span className="text-sm font-semibold tabular-nums w-24 text-right">{d.closed_at ? money(d.total) : ''}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Checks ───────────────────────────────────────────────────────

function eventText(e, lines, names) {
  const p = e.payload || {}
  const lineName = id => lines[id]?.name || 'an item'
  switch (e.type) {
    case 'check.opened': return 'Opened' + (p.covers ? ' for ' + p.covers : '') + (p.tab_name ? ' as ' + p.tab_name : '')
    case 'check.covers_set': return 'Covers set to ' + p.covers
    case 'check.table_moved': return 'Moved to another table'
    case 'check.server_changed': return 'Given to ' + (names[p.server_id] || 'someone else')
    case 'check.rc_set': return 'Revenue centre changed'
    case 'check.renamed': return 'Renamed ' + (p.tab_name || '(no name)')
    case 'check.note_set': return 'Note: ' + (p.note || '(removed)')
    case 'line.added': return 'Added ' + p.line.qty + ' × ' + p.line.name + ' ' + money(p.line.unit_price * p.line.qty)
    case 'line.changed': return 'Changed ' + lineName(p.line_id) + (p.qty != null ? ' to ' + p.qty : '')
    case 'line.deleted': return 'Deleted ' + lineName(p.line_id) + ' (not sent)'
    case 'lines.sent': return 'Sent ' + p.line_ids.length + ' item' + (p.line_ids.length === 1 ? '' : 's') + (p.held_course_ids?.length ? ', some courses held' : '')
    case 'course.fired': return 'Fired a course'
    case 'line.voided': return 'Voided ' + (p.qty ? p.qty + ' × ' : '') + lineName(p.line_id) + ': ' + p.reason
    case 'discount.applied': return (p.discount.comp ? 'Comp ' : 'Discount ') + (p.discount.name || '') + (p.discount.type === 'percent' ? ' ' + p.discount.value + '%' : p.discount.type === 'amount' ? ' ' + money(p.discount.value) : '') + (p.discount.reason ? ': ' + p.discount.reason : '')
    case 'discount.removed': return 'Discount removed'
    case 'promotions.set': return p.promotions.length ? 'Offers: ' + p.promotions.map(x => x.name).join(', ') : 'Offers removed'
    case 'service_charge.set': return p.removed ? 'Service charge taken off' + (p.reason ? ': ' + p.reason : '') : 'Service charge set'
    case 'lines.moved': return 'Moved ' + p.line_ids.length + ' item' + (p.line_ids.length === 1 ? '' : 's') + ' to another check'
    case 'check.merged': return 'Merged into another check'
    case 'bill.printed': return 'Bill printed'
    case 'payment.added': return 'Paid ' + money(p.payment.amount) + ' ' + tenderLabel(p.payment.tender) + (p.payment.tip ? ' + ' + money(p.payment.tip) + ' tip' : '')
    case 'payment.voided': return 'Payment taken back: ' + p.reason
    case 'check.closed': return 'Closed'
    case 'check.reopened': return 'Reopened: ' + p.reason
    case 'refund.added': return 'Refund ' + money(p.refund.amount) + ' ' + tenderLabel(p.refund.tender) + ': ' + p.refund.reason
    default: return e.type
  }
}

function CheckDetail({ checkId, onBack, staffNames }) {
  const api = useApi()
  const { data, isLoading, error } = useQuery({ queryKey: ['pos-check', checkId], queryFn: () => api.get(`/pos/checks/${checkId}`) })
  if (isLoading) return <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mx-auto my-10" />
  if (error) return <ErrorNote error={error} />
  const c = data.check
  const t = checkTotals(c)
  const lines = Object.fromEntries(c.lines.map(l => [l.id, l]))
  for (const e of data.events) if (e.type === 'line.added') lines[e.payload.line.id] = lines[e.payload.line.id] || e.payload.line
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Btn onClick={onBack}><ChevronLeft className="w-4 h-4" /> Checks</Btn>
        <h2 className="text-base font-semibold flex-1">Check {c.order_no != null ? '#' + c.order_no : c.number} · {c.status}</h2>
      </div>
      <div className="grid md:grid-cols-2 gap-4 items-start">
        <Card title="Items">
          <ul className="divide-y text-sm">
            {c.lines.map(l => (
              <li key={l.id} className={cn('py-1.5', l.status === 'voided' && 'text-muted-foreground line-through')}>
                <div className="flex justify-between gap-2"><span>{l.qty} × {l.name}</span><span className="tabular-nums">{money(l.qty * l.unit_price)}</span></div>
                {!!l.modifiers?.length && <p className="text-xs text-muted-foreground">{l.modifiers.map(modifierText).filter(Boolean).join(', ')}</p>}
                {l.note && <p className="text-xs text-muted-foreground">Note: {l.note}</p>}
              </li>
            ))}
            {!c.lines.length && <li className="py-1.5 text-muted-foreground">No items</li>}
          </ul>
          <div className="mt-3 pt-3 border-t">
            <Rows rows={[
              t.discount ? ['Discounts', '−' + money(t.discount)] : null,
              t.service_charge ? ['Service charge', money(t.service_charge)] : null,
              ['Total', money(t.total), true],
              ['Paid', money(t.paid)],
              t.tips ? ['Tips', money(t.tips)] : null,
              t.refunded ? ['Refunded', money(t.refunded)] : null,
              t.balance ? ['To pay', money(t.balance), true] : null,
            ]} />
          </div>
        </Card>
        <Card title="History">
          <ol className="space-y-2 text-sm">
            {data.events.map(e => (
              <li key={e.id} className="flex gap-3">
                <span className="text-xs text-muted-foreground tabular-nums w-12 shrink-0 pt-0.5">{time(e.client_at || e.created_at)}</span>
                <span className="flex-1">
                  {eventText(e, lines, staffNames)}
                  <span className="block text-xs text-muted-foreground">{e.staff_name || 'Unknown'}{e.approver_name ? ', approved by ' + e.approver_name : ''}</span>
                </span>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </div>
  )
}

function ChecksTab({ venueId, dayId, setDayId }) {
  const api = useApi()
  const [status, setStatus] = useState('')
  const [checkId, setCheckId] = useState(null)
  const { data: days = [] } = useQuery({ queryKey: ['pos-days', venueId], queryFn: () => api.get(`/pos/venues/${venueId}/days`) })
  const effectiveDay = dayId || days[0]?.id || ''
  const qs = new URLSearchParams({ ...(effectiveDay ? { day_id: effectiveDay } : {}), ...(status ? { status } : {}) }).toString()
  const { data: checks = [], isLoading, error } = useQuery({
    queryKey: ['pos-checks', venueId, effectiveDay, status], queryFn: () => api.get(`/pos/venues/${venueId}/checks?${qs}`),
  })
  const staffNames = Object.fromEntries(checks.map(c => [c.server_id, c.server_name]))
  if (checkId) return <CheckDetail checkId={checkId} onBack={() => setCheckId(null)} staffNames={staffNames} />
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <select className={cn(inputCls, 'w-auto')} value={effectiveDay} onChange={e => setDayId(e.target.value)} aria-label="Day">
          {days.map(d => <option key={d.id} value={d.id}>{dayLabel(d.business_date)}{d.closed_at ? '' : ' (open)'}</option>)}
        </select>
        <select className={cn(inputCls, 'w-auto')} value={status} onChange={e => setStatus(e.target.value)} aria-label="Status">
          <option value="">Every check</option>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
          <option value="void">Void</option>
          <option value="merged">Merged</option>
        </select>
      </div>
      <ErrorNote error={error} />
      {isLoading ? <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mx-auto my-10" /> : !checks.length
        ? <p className="text-sm text-muted-foreground">No checks.</p>
        : (
          <div className="rounded-xl border bg-background divide-y">
            {checks.map(c => (
              <button key={c.id} type="button" onClick={() => setCheckId(c.id)}
                className="w-full text-left flex items-center gap-3 px-4 py-2.5 hover:bg-muted touch-manipulation min-h-[52px]">
                <span className="w-14 text-sm font-semibold tabular-nums">{c.order_no != null ? '#' + c.order_no : c.number}</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm truncate">{c.table_label ? 'Table ' + c.table_label : c.tab_name || (c.mode === 'counter' ? 'Counter' : 'Tab')}</span>
                  <span className="block text-xs text-muted-foreground truncate">{c.server_name || ''} · {time(c.opened_at)}{c.closed_at ? '–' + time(c.closed_at) : ''}</span>
                </span>
                <span className={cn('text-xs rounded-full px-2 py-0.5 border', c.status === 'open' ? 'text-blue-700 border-blue-300 bg-blue-50' : c.status === 'closed' ? 'text-muted-foreground' : 'text-amber-700 border-amber-300 bg-amber-50')}>{c.status}</span>
                <span className="w-20 text-right text-sm tabular-nums">{money(c.total)}</span>
              </button>
            ))}
          </div>
        )}
    </div>
  )
}

// ── Refused changes ──────────────────────────────────────────────

function ConflictRow({ c, onResolved }) {
  const api = useApi()
  const { canManage } = usePermission('pos_reports')
  const [note, setNote] = useState('')
  const resolve = useMutation({ mutationFn: () => api.patch(`/pos/conflicts/${c.id}`, { resolution: note.trim() }), onSuccess: onResolved })
  const p = c.payload || {}
  const what = c.type === 'line.added' ? 'Add ' + p.line?.qty + ' × ' + p.line?.name : eventText({ type: c.type, payload: p }, {}, {})
  return (
    <div className="px-4 py-3 space-y-2">
      <div className="flex flex-wrap items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0 text-sm">
          <p className="font-medium">{what}</p>
          <p className="text-xs text-muted-foreground">
            {c.check_number ? 'Check ' + c.check_number + ' (' + c.check_status + ') · ' : ''}{c.staff_name || 'Unknown'} · {when(c.client_at || c.created_at)}
          </p>
          <p className="text-xs text-amber-800 mt-0.5">Refused: {c.error}</p>
        </div>
      </div>
      {c.resolved_at ? (
        <p className="text-xs text-green-700">Dealt with {when(c.resolved_at)}{c.resolved_by ? ' by ' + c.resolved_by : ''}: {c.resolution}</p>
      ) : !canManage ? (
        <p className="text-xs text-muted-foreground">Not dealt with yet.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <input className={cn(inputCls, 'flex-1 min-w-[200px]')} value={note} maxLength={300} onChange={e => setNote(e.target.value)} placeholder="What was done, e.g. added to the next check" aria-label="What was done" />
          <Btn disabled={!note.trim() || resolve.isPending} onClick={() => resolve.mutate()}>Mark dealt with</Btn>
          <ErrorNote error={resolve.error} />
        </div>
      )}
    </div>
  )
}

function ConflictsTab({ venueId }) {
  const api = useApi()
  const qc = useQueryClient()
  const [all, setAll] = useState(false)
  const { data = [], isLoading, error } = useQuery({
    queryKey: ['pos-conflicts', venueId, all], queryFn: () => api.get(`/pos/venues/${venueId}/conflicts${all ? '?all=1' : ''}`),
  })
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Changes a till made while it couldn't reach the others, and that couldn't be applied when it caught up: e.g. an item added to a check another till had already closed. The till showed "Not saved"; here you can see what to sort out.
      </p>
      <Segmented value={all ? 'all' : 'open'} options={[{ value: 'open', label: 'To deal with' }, { value: 'all', label: 'All' }]} onChange={v => setAll(v === 'all')} />
      <ErrorNote error={error} />
      {isLoading ? <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mx-auto my-10" /> : !data.length
        ? <p className="text-sm text-muted-foreground">Nothing to deal with.</p>
        : <div className="rounded-xl border bg-background divide-y">{data.map(c => <ConflictRow key={c.id} c={c} onResolved={() => qc.invalidateQueries({ queryKey: ['pos-conflicts', venueId] })} />)}</div>}
    </div>
  )
}

// ── Print queue ──────────────────────────────────────────────────

function PrintTab({ venueId }) {
  const api = useApi()
  const { data = [], isLoading, error } = useQuery({ queryKey: ['pos-print-jobs', venueId], queryFn: () => api.get(`/pos/venues/${venueId}/print-jobs`) })
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Kitchen tickets and other jobs for the venue's network printers. They print through the venue hub, which isn't set up yet, so they wait here as "queued". Tills print bills and receipts in their own browser meanwhile.
      </p>
      <ErrorNote error={error} />
      {isLoading ? <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mx-auto my-10" /> : !data.length
        ? <p className="text-sm text-muted-foreground">Nothing in the queue.</p>
        : (
          <div className="rounded-xl border bg-background divide-y">
            {data.map(j => (
              <div key={j.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="w-14 text-xs text-muted-foreground tabular-nums">{time(j.created_at)}</span>
                <span className="flex-1 min-w-0">
                  <span className="block truncate">{j.title || j.kind}</span>
                  <span className="block text-xs text-muted-foreground">{j.printer_name || 'Printer removed'}{j.attempts ? ' · ' + j.attempts + ' tries' : ''}{j.error ? ' · ' + j.error : ''}</span>
                </span>
                <span className={cn('text-xs rounded-full px-2 py-0.5 border', j.status === 'printed' ? 'text-green-700 border-green-300 bg-green-50' : j.status === 'failed' ? 'text-red-700 border-red-300 bg-red-50' : 'text-muted-foreground')}>{j.status}</span>
              </div>
            ))}
          </div>
        )}
    </div>
  )
}

export default function PosReports() {
  const { venues, venueId, setVenueId, isLoading } = usePosVenue()
  const [tab, setTab] = useState('days')
  const [dayId, setDayId] = useState(null)
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader icon={BarChart3} title="Till reports">
        <VenueSelect venues={venues} venueId={venueId} onChange={setVenueId} />
      </PageHeader>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto p-4 space-y-4">
          <div className="overflow-x-auto"><Segmented value={tab} options={TABS} onChange={setTab} /></div>
          {isLoading && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mx-auto my-10" />}
          {!isLoading && !venues.length && <p className="text-sm text-muted-foreground">Add a venue first.</p>}
          {venueId && tab === 'days' && <DaysTab key={venueId} venueId={venueId} onShowChecks={id => { setDayId(id); setTab('checks') }} />}
          {venueId && tab === 'checks' && <ChecksTab key={venueId} venueId={venueId} dayId={dayId} setDayId={setDayId} />}
          {venueId && tab === 'conflicts' && <ConflictsTab venueId={venueId} />}
          {venueId && tab === 'print' && <PrintTab venueId={venueId} />}
        </div>
      </div>
    </div>
  )
}
