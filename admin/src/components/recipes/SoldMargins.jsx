// src/components/recipes/SoldMargins.jsx
//
// Menu margins' Sold tab (inventory phase 5, docs/INVENTORY.md 7 and 8.2):
// what was really sold at a venue (or every venue) over some days, from
// usage from sales (dish_cost_days: each sale costed by the recipe its venue,
// revenue stream and order type used, with its options and a meal deal's
// picks), by section and dish: units, net of VAT, theoretical cost, GP and
// cost %, coloured against the targets only where every unit was costed.
// Worked out by soldMargins() in shared/costing.js on the server.
//
//   SoldMargins({ venues })   API GET /api/menu-margins/sold?venue_id=&from=&to=

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Field, inputCls, ErrorNote, Segmented, addDay } from '@/components/staff/shared'
import { Card, DateButton, btn } from '@/components/purchasing/shared'
import { penceText, pctText, BandBadge } from '@/components/recipes/shared'

const qtyText = n => (Number.isInteger(n) ? String(n) : Number(n).toFixed(1))

export default function SoldMargins({ venues = [] }) {
  const api = useApi()
  const [venueId, setVenueId] = useState('')
  const [range, setRange] = useState(null)
  const [by, setBy] = useState('dish')
  const q = new URLSearchParams({ ...(venueId ? { venue_id: venueId } : {}), ...(range ? range : {}) }).toString()
  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ['menu-margins', 'sold', q], queryFn: () => api.get('/menu-margins/sold' + (q ? '?' + q : '')), placeholderData: prev => prev,
  })
  useEffect(() => { if (data && !range) setRange({ from: data.from, to: data.to }) }, [data])
  const sections = useMemo(() => {
    const m = new Map()
    for (const d of data?.dishes || []) {
      const k = d.section_id || 'none'
      if (!m.has(k)) m.set(k, [])
      m.get(k).push(d)
    }
    return (data?.sections || []).map(s => ({ ...s, dishes: m.get(s.section_id || 'none') || [] }))
  }, [data])
  const t = data?.total
  return (
    <div className="space-y-4" data-testid="margins-sold">
      <Card title="What sold">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Venue">
            <select className={cn(inputCls, 'h-12 w-48')} value={venueId} onChange={e => setVenueId(e.target.value)} data-testid="sold-venue">
              <option value="">Every venue</option>
              {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </Field>
          <Field label="Days" group>
            <span className="flex flex-wrap items-center gap-2">
              <DateButton value={range?.from} max={range?.to} onChange={v => setRange(r => ({ ...r, from: v }))} label="From" />
              <span className="text-sm text-muted-foreground">to</span>
              <DateButton value={range?.to} min={range?.from} onChange={v => setRange(r => ({ ...r, to: v }))} label="To" />
            </span>
          </Field>
          {range && (
            <button type="button" className={cn(btn.outline, 'h-12')} onClick={() => { const y = addDay(new Date().toISOString().slice(0, 10), -1); setRange({ from: addDay(y, -6), to: y }) }}>Last 7 days</button>
          )}
          {isFetching && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground self-center" />}
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          Each dish sold is costed by the recipe its venue, revenue stream and order type used, with its options and a meal deal&apos;s
          picks, at what was paid for its items then (usage from sales, worked out every few minutes{data?.worked_out_at ? ', last ' + new Date(data.worked_out_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}).
          Net is after discounts, VAT out. A dish with units that couldn&apos;t be costed is coloured only once every unit is.
        </p>
      </Card>
      <ErrorNote error={error} />
      {isLoading ? <div className="py-12 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" /></div> : data && (
        <>
          {t && (
            <div className="flex flex-wrap gap-2" data-testid="sold-total">
              <Chip label="Units" value={qtyText(t.qty)} />
              <Chip label="Net" value={penceText(t.net_pence)} />
              <Chip label="Theoretical cost" value={t.cost_pence == null ? '-' : penceText(t.cost_pence)} />
              <Chip label="GP" value={t.gp_pence == null ? '-' : penceText(t.gp_pence)} />
              <Chip label="Cost %" value={t.cost_pct == null ? '-' : pctText(t.cost_pct)} />
              {t.uncosted_qty > 0 && <Chip label="Not costed" value={qtyText(t.uncosted_qty) + ' units'} cls="bg-amber-50 border-amber-200 text-amber-900" />}
            </div>
          )}
          <Segmented value={by} onChange={setBy} options={[{ value: 'dish', label: 'By dish' }, { value: 'section', label: 'By section' }]} className="[&>button]:h-12" testid="sold-by" />
          {by === 'section' ? (
            <SoldTable rows={data.sections.map(s => ({ ...s, key: s.section_id || 'none', name: s.section || 'No section' }))} first="Section" />
          ) : (
            <div className="space-y-4">
              {sections.map(s => (
                <SoldTable key={s.section_id || 'none'} title={(s.section || 'No section') + ' · ' + qtyText(s.qty) + ' sold'} first="Dish"
                  rows={s.dishes.map(d => ({ ...d, key: d.dish_id || d.name }))} />
              ))}
              {!sections.length && <Card title="Nothing sold"><p className="text-sm text-muted-foreground">No sales were worked out for these days{venueId ? ' here' : ''} yet.</p></Card>}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Chip({ label, value, cls }) {
  return <span className={cn('inline-flex items-center gap-1 h-10 px-3 rounded-full border text-sm bg-background', cls)}>{label} <strong className="tabular-nums">{value}</strong></span>
}

function SoldTable({ rows, title, first }) {
  return (
    <Card title={title || 'Every section'} bodyClass="p-0">
      <div className="overflow-x-auto" data-testid="sold-table">
        <table className="w-full text-sm min-w-[640px]">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="text-left font-medium px-4 py-2">{first}</th>
              <th className="text-right font-medium px-2 py-2">Units</th>
              <th className="text-right font-medium px-2 py-2">Net</th>
              <th className="text-right font-medium px-2 py-2">Cost</th>
              <th className="text-right font-medium px-2 py-2">GP</th>
              <th className="text-right font-medium px-4 py-2">Cost %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.key} className="border-b" data-testid="sold-row" data-name={r.name} data-band={r.band || 'none'}>
                <td className="px-4 py-2">
                  {r.dish_id
                    ? <Link to={'/recipes?tab=dishes&dish=' + r.dish_id} className="font-medium hover:underline min-h-[44px] inline-flex items-center">{r.name}</Link>
                    : <span className="font-medium">{r.name}</span>}
                  {(r.uncosted_qty > 0 || r.typical_qty > 0) && (
                    <span className="block text-xs text-muted-foreground">
                      {[r.uncosted_qty > 0 && qtyText(r.uncosted_qty) + ' not costed', r.typical_qty > 0 && qtyText(r.typical_qty) + ' at typical meal deal picks'].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{qtyText(r.qty)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{penceText(r.net_pence)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{r.cost_pence == null ? '-' : penceText(r.cost_pence)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{r.gp_pence == null ? '-' : penceText(r.gp_pence)}</td>
                <td className="px-4 py-2 text-right">
                  {r.band ? <BandBadge band={r.band} pct={r.cost_pct} /> : <span className="tabular-nums text-muted-foreground">{r.cost_pct == null ? '-' : pctText(r.cost_pct)}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
