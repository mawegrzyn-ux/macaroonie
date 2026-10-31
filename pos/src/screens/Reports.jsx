// X report (today so far) and closing the day (Z report). Needs the "See
// reports" / "Close the day" till permissions, or a manager's PIN.

import { useEffect, useMemo, useState } from 'react'
import { Printer, Lock, RefreshCw, AlertTriangle } from 'lucide-react'
import { dayFigures } from '@shared/pos/reports.js'
import { dayReportTicket } from '@shared/pos/tickets.js'
import { useTill, useChecks, dispatch, toast, server, can, pull } from '../lib/store.js'
import { printTickets } from '../lib/print.js'
import { Keypad, cx, money, poundsToPence, useApproval } from '../components/ui.jsx'

export default function Reports() {
  const { config, day, online, outbox } = useTill()
  const checks = useChecks()
  const approve = useApproval()
  const [allowed, setAllowed] = useState(can('reports'))
  const [remote, setRemote] = useState(null)
  const [closing, setClosing] = useState(false)
  const [cash, setCash] = useState('')
  const [lastZ, setLastZ] = useState(null)
  const names = useMemo(() => ({
    staff: Object.fromEntries([...(config.devices || []).filter(d => d.kind === 'kiosk'), ...(config.staff || [])].map(s => [s.id, s.name])),
    revenue_streams: Object.fromEntries((config.revenue_streams || []).map(r => [r.id, r.name])),
    order_types: Object.fromEntries((config.order_types || []).map(r => [r.id, r.name])),
  }), [config])

  useEffect(() => {
    if (allowed) return
    approve('reports', null, 'Seeing the day\'s figures needs the reports permission.').then(a => { if (a !== false) setAllowed(true) })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const load = async () => { try { setRemote(await server.dayReport()) } catch { setRemote(null) } }
  useEffect(() => { if (allowed) load() }, [allowed])

  // Offline (or before the server answers): the till's own copy of today.
  const local = useMemo(() => (day ? dayFigures(Object.values(checks), day.id) : null), [checks, day])
  const f = remote?.figures || local
  if (!allowed) return <div className="p-6 text-muted">Reports need a manager.</div>

  const closeDay = async () => {
    const approver = await approve('close_day', null, 'Closing the day needs a manager.')
    if (approver === false) return
    const r = dispatch('day.closed', { declared_cash: cash ? poundsToPence(cash) : null }, { approved_by: approver })
    if (!r.ok) return toast(r.error, 'bad')
    const fig = f
    setLastZ({ figures: fig, declared: cash ? poundsToPence(cash) : null, date: day?.business_date })
    setClosing(false)
    setCash('')
    toast('Day closed', 'ok')
    setTimeout(() => { pull(); load() }, 1500)
  }

  const print = (kind, fig, declared, date) => printTickets([dayReportTicket(fig, {
    venue: config.venue?.name, kind, date, declaredCash: declared, names,
  })])

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="text-2xl font-bold flex-1">Today{day ? ' · ' + new Date(day.business_date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) : ''}</div>
          <button className="btn" onClick={load} disabled={!online}><RefreshCw size={18} /> Refresh</button>
          {f && <button className="btn" onClick={() => print('X', f, null, day?.business_date)}><Printer size={18} /> Print X</button>}
          <button className="btn btn-primary" onClick={() => setClosing(true)} disabled={!day}><Lock size={18} /> Close the day (Z)</button>
        </div>
        {!remote && <div className="rounded-xl bg-warn-soft text-warn p-3 text-sm font-semibold">Offline figures from this till: other tills' latest changes may be missing.</div>}
        {lastZ && (
          <div className="card p-4 flex items-center gap-3">
            <div className="flex-1 font-semibold">Day closed. Print the Z report for the cash-up.</div>
            <button className="btn btn-primary" onClick={() => print('Z', lastZ.figures, lastZ.declared, lastZ.date)}><Printer size={18} /> Print Z</button>
          </div>
        )}
        {closing && (
          <div className="card p-5 border-2 border-brand space-y-4">
            <div className="text-lg font-bold">Close the day</div>
            {(f?.open_checks || []).length > 0
              ? <div className="rounded-xl bg-bad-soft text-bad p-3 font-semibold flex gap-2"><AlertTriangle size={20} />{f.open_checks.length} check{f.open_checks.length > 1 ? 's are' : ' is'} still open. Close or pay them first.</div>
              : <div className="text-[15px]">Count the cash in the drawer (without the float) and type it in. The day's figures go to Cash Recon.</div>}
            <WaitingDevices waiting={remote?.waiting} own={(outbox || []).length} />
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="label">Cash counted</div>
                <div className="text-3xl font-bold tabular-nums">£{cash || '0'}</div>
                <div className="text-sm text-muted">Expected {money(f?.cash_expected || 0)}{cash ? ' · ' + (poundsToPence(cash) - (f?.cash_expected || 0) >= 0 ? 'over ' : 'short ') + money(Math.abs(poundsToPence(cash) - (f?.cash_expected || 0))) : ''}</div>
                <div className="flex gap-2 pt-2">
                  <button className="btn btn-primary" onClick={closeDay}><Lock size={18} /> Close the day</button>
                  <button className="btn" onClick={() => setClosing(false)}>Cancel</button>
                </div>
              </div>
              <Keypad value={cash} onChange={setCash} decimal max={8} />
            </div>
          </div>
        )}
        {f ? <Figures f={f} names={names} /> : <div className="text-muted">No trading yet today.</div>}
      </div>
    </div>
  )
}

/**
 * Devices that may hold changes not sent yet (migration 217): the day's
 * figures miss them until they are sent. A warning, not a stop: a device that
 * is broken or gone mustn't keep the day open.
 */
function WaitingDevices({ waiting, own }) {
  const list = [
    ...(own ? [{ id: 'self', text: 'This till has ' + own + ' change' + (own > 1 ? 's' : '') + ' it hasn\'t sent yet.' }] : []),
    ...(waiting || []).map(d => ({
      id: d.id,
      text: d.pending
        ? d.name + ' has ' + d.pending + ' change' + (d.pending > 1 ? 's' : '') + ' it hasn\'t sent yet.'
        : d.name + ' hasn\'t been in touch since ' + new Date(d.last_seen_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) + ': it may have changes it hasn\'t sent.',
    })),
  ]
  if (!list.length) return null
  return (
    <div className="rounded-xl bg-warn-soft text-warn p-3 text-sm font-semibold space-y-1" data-testid="z-waiting">
      <div className="flex gap-2"><AlertTriangle size={18} className="shrink-0" />Before closing: the day's figures won't include these until they are sent.</div>
      {list.map(x => <div key={x.id} className="pl-7">{x.text}</div>)}
    </div>
  )
}

function Figures({ f, names }) {
  const Box = ({ label, value, strong }) => (
    <div className="card p-4"><div className="label">{label}</div><div className={cx('tabular-nums mt-1', strong ? 'text-2xl font-bold' : 'text-xl font-semibold')}>{value}</div></div>
  )
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Box label="Sales" value={money(f.sales.total)} strong />
        <Box label="Checks" value={f.counts.closed} />
        <Box label="Covers" value={f.covers} />
        <Box label="Cash expected" value={money(f.cash_expected)} />
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <Table title="Takings" rows={f.tenders.map(t => [t.label + ' (' + t.count + ')', money(t.amount + t.tips - t.refunds)])} total={['Total', money(f.takings)]} />
        <Table title="Revenue streams" rows={(f.revenue_streams || []).map(r => [names.revenue_streams[r.id] || 'Other', money(r.net)])} />
        <Table title="Order types" rows={(f.order_types || []).map(r => [(names.order_types[r.id] || 'Other') + ' (' + r.checks + ')', money(r.net)])} />
        <Table title="Sales" rows={[
          ['Before discounts', money(f.sales.gross)], ['Discounts', '−' + money(f.sales.discounts)],
          ['Service charge', money(f.sales.service_charge)], ['Tips', money(f.tips)], ['Average check', money(f.sales.average_check)],
        ]} />
        <Table title="VAT" rows={f.vat.map(v => [v.rate + '% on ' + money(v.net), money(v.vat)])} />
        <Table title={'Voids (' + f.voids.count + ')'} rows={f.voids.lines.slice(0, 20).map(v => [v.qty + ' x ' + v.name + ' · ' + v.reason, money(v.value)])} />
        <Table title="Discounts and comps" rows={f.discounts.map(d => [d.name + ' x' + d.count, '−' + money(d.amount)])} />
        <Table title={'Refunds (' + f.refunds.count + ')'} rows={f.refunds.lines.map(r => [r.reason, '−' + money(r.amount)])} />
        {f.cancelled?.count > 0 && <Table title={'Cancelled orders (' + f.cancelled.count + ')'} rows={f.cancelled.lines.map(c => [(c.order_no != null ? '#' + c.order_no : c.number) + ' · ' + c.reason, money(c.value)])} />}
        <Table title="Staff" rows={f.staff.filter(s => s.checks || s.tips).map(s => [(names.staff[s.id] || 'Unknown') + ' (' + s.checks + ')', money(s.total) + (s.tips ? ' + tips ' + money(s.tips) : '')])} />
      </div>
    </div>
  )
}

function Table({ title, rows, total }) {
  return (
    <div className="card">
      <div className="px-4 py-3 border-b border-line font-bold">{title}</div>
      <div className="divide-y divide-line">
        {rows.map((r, i) => <div key={i} className="px-4 py-2 flex justify-between gap-3 text-[15px]"><span className="min-w-0 truncate">{r[0]}</span><span className="tabular-nums shrink-0">{r[1]}</span></div>)}
        {!rows.length && <div className="px-4 py-2 text-muted text-sm">None</div>}
        {total && <div className="px-4 py-2 flex justify-between font-bold"><span>{total[0]}</span><span className="tabular-nums">{total[1]}</span></div>}
      </div>
    </div>
  )
}
