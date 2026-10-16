// The Tax box on a menu, a section and a dish (migration 170; the rule is
// shared/tax.js). A setting is a rate (blank = what it sits under) plus
// exceptions: a rate for some order types, locations or revenue streams.
// The dish's setting wins over its section's, the section's over its menu's;
// within one setting the exception matching a sale most closely wins.

import { useQuery } from '@tanstack/react-query'
import { Plus, X } from 'lucide-react'
import { useApi } from '@/lib/api'
import { normTax, taxProblems, taxFor } from '@shared/tax.js'

/** The tenant's rates, order types, locations and revenue streams. */
export function useTaxLookups() {
  const api = useApi()
  const q = useQuery({ queryKey: ['tax-rates'], queryFn: () => api.get('/tax-rates'), staleTime: 60_000 })
  const d = q.data || {}
  return {
    loaded: !!q.data,
    rates: d.rates || [],
    activeRates: (d.rates || []).filter(r => r.is_active),
    types: (d.order_types || []).filter(t => t.is_active),
    allTypes: d.order_types || [],
    venues: d.venues || [],
    streams: (d.streams || []).filter(s => s.is_active),
    allStreams: d.streams || [],
  }
}

export const rateLabel = r => (r ? r.name + ' (' + Number(r.rate) + '%)' : '')

/** Problems with a setting, as sentences (shared/tax.js), against the tenant's lists. */
export function taxSettingProblems(tax, lk) {
  if (!lk.loaded) return []
  return taxProblems(tax, { rates: lk.rates, types: lk.allTypes, streams: lk.allStreams, venues: lk.venues })
}

/** "Standard 20%" for what a setting (with what it sits under) gives each order type, anywhere. */
export function taxSummary(levels, lk) {
  return lk.types.map(t => {
    const r = taxFor(levels, { venue_id: null, order_type_id: t.id, revenue_stream_id: null }, lk.rates)
    return { type: t, name: r.name, vat_rate: r.vat_rate, from: r.from }
  })
}

const chip = on => 'px-3 min-h-[40px] rounded-full border text-xs font-medium touch-manipulation '
  + (on ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-accent')

function Rule({ rule, lk, onChange, onRemove, readOnly }) {
  const venueOfStream = id => lk.allStreams.find(s => s.id === id)?.venue_id || ''
  const loc = rule.streams.length ? venueOfStream(rule.streams[0]) : (rule.venues[0] || '')
  const toggle = (key, id) => {
    const list = rule[key].includes(id) ? rule[key].filter(x => x !== id) : [...rule[key], id]
    if (key === 'streams') onChange({ ...rule, streams: list, venues: list.length ? [] : (loc ? [loc] : []) })
    else onChange({ ...rule, [key]: list })
  }
  const streamsHere = lk.streams.filter(s => s.venue_id === loc)
  return (
    <div className="rounded-md border p-2.5 space-y-2 bg-muted/30" data-testid="tax-rule">
      <div className="flex items-start gap-2">
        <div className="flex-1 space-y-2 min-w-0">
          <div>
            <p className="text-[11px] text-muted-foreground mb-1">Order types (none picked = any)</p>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Order types">
              {lk.types.map(t => (
                <button key={t.id} type="button" disabled={readOnly} className={chip(rule.types.includes(t.id))} onClick={() => toggle('types', t.id)}>{t.name}</button>
              ))}
            </div>
          </div>
          {lk.venues.length > 1 || lk.streams.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="block">
                <span className="text-[11px] text-muted-foreground">Location</span>
                <select disabled={readOnly} value={loc} aria-label="Location"
                  onChange={e => onChange({ ...rule, venues: e.target.value ? [e.target.value] : [], streams: [] })}
                  className="w-full text-sm border rounded-md px-2 bg-background min-h-[40px] touch-manipulation">
                  <option value="">Any location</option>
                  {lk.venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </label>
              {loc && streamsHere.length > 0 && (
                <div>
                  <p className="text-[11px] text-muted-foreground mb-1">Revenue streams (none = the whole location)</p>
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="Revenue streams">
                    {streamsHere.map(s => (
                      <button key={s.id} type="button" disabled={readOnly} className={chip(rule.streams.includes(s.id))} onClick={() => toggle('streams', s.id)}>{s.name}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : null}
          <label className="block">
            <span className="text-[11px] text-muted-foreground">Then charge</span>
            <select disabled={readOnly} value={rule.rate || ''} aria-label="Exception rate" onChange={e => onChange({ ...rule, rate: e.target.value || null })}
              className="w-full text-sm border rounded-md px-2 bg-background min-h-[40px] touch-manipulation">
              <option value="">Pick a rate</option>
              {lk.rates.filter(r => r.is_active || r.id === rule.rate).map(r => <option key={r.id} value={r.id}>{rateLabel(r)}{r.is_active ? '' : ' (removed)'}</option>)}
            </select>
          </label>
        </div>
        {!readOnly && (
          <button type="button" onClick={onRemove} aria-label="Remove exception"
            className="w-10 h-10 shrink-0 inline-flex items-center justify-center rounded-md hover:bg-accent touch-manipulation">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * value: the setting. under(value) -> [dish, section, menu] settings with
 * this one in its place (for the summary). inheritLabel: what blank means.
 */
export function TaxBox({ value, onChange, under, inheritLabel, readOnly = false, title = 'Tax' }) {
  const lk = useTaxLookups()
  const t = normTax(value)
  const set = next => onChange({ rate: next.rate ?? null, rules: next.rules })
  const problems = taxSettingProblems(t, lk)
  const summary = lk.loaded ? taxSummary(under(t), lk) : []
  const hasPlaceRules = t.rules.some(r => r.venues.length || r.streams.length)
  return (
    <div className="rounded-md border p-3 space-y-2" data-testid="tax-box">
      <p className="text-xs font-medium">{title}</p>
      <label className="block">
        <span className="text-[11px] text-muted-foreground">Rate</span>
        <select disabled={readOnly} value={t.rate || ''} aria-label="Tax rate" onChange={e => set({ ...t, rate: e.target.value || null })}
          className="w-full text-sm border rounded-md px-2 bg-background min-h-[44px] touch-manipulation">
          <option value="">{inheritLabel}</option>
          {lk.rates.filter(r => r.is_active || r.id === t.rate).map(r => <option key={r.id} value={r.id}>{rateLabel(r)}{r.is_active ? '' : ' (removed)'}</option>)}
        </select>
      </label>
      {t.rules.length > 0 && <p className="text-[11px] text-muted-foreground">Exceptions (the closest match wins: revenue stream, then order type, then location)</p>}
      {t.rules.map((r, i) => (
        <Rule key={i} rule={r} lk={lk} readOnly={readOnly}
          onChange={nr => set({ ...t, rules: t.rules.map((x, j) => (j === i ? nr : x)) })}
          onRemove={() => set({ ...t, rules: t.rules.filter((_, j) => j !== i) })} />
      ))}
      {!readOnly && (
        <button type="button" onClick={() => set({ ...t, rules: [...t.rules, { venues: [], streams: [], types: [], rate: null }] })}
          className="inline-flex items-center gap-1.5 text-xs border rounded-md px-3 min-h-[40px] hover:bg-accent touch-manipulation">
          <Plus className="w-3.5 h-3.5" /> Add an exception
        </button>
      )}
      {problems.length > 0 && (
        <ul className="text-xs text-destructive space-y-0.5" data-testid="tax-problems">{problems.map(p => <li key={p}>{p}</li>)}</ul>
      )}
      {summary.length > 0 && (
        <div className="text-[11px] text-muted-foreground" data-testid="tax-summary">
          {summary.map(x => (
            <span key={x.type.id} className="inline-block mr-3">{x.type.name}: <b className="text-foreground">{x.name || 'no rate'} {x.vat_rate}%</b></span>
          ))}
          {hasPlaceRules && <span className="block">Exceptions for particular locations or streams aren't shown here: see Menus, Tax rates, Check.</span>}
        </div>
      )}
    </div>
  )
}
