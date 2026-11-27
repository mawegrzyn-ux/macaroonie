// src/components/recipes/Coverage.jsx
//
// Coverage by sales (inventory phase 3, docs/INVENTORY.md 5.6, principle 7:
// effort follows value), at the top of the Recipes page: "Costed: 62% of the
// last 30 days' sales" at a venue or every venue, by channel (till, kiosk,
// online, other tills), and below it the dishes not costed yet, most sold
// first, each with how to fix it and a button to the place it is fixed: link
// a recipe (the dish's matrix), finish the recipe's gaps (the recipe), add an
// option rule (the Options tab), map another till's item (Item mapping).
// The rule is the API's (salesCoverage() in shared/costing.js, GET
// /api/recipes/coverage); pounds only for people with till reports view (as
// in the report subject Recipe coverage), the share of sales for everyone else.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, Loader2 } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { inputCls, ErrorNote, useVenues } from '@/components/staff/shared'
import { btn } from '@/components/purchasing/shared'
import { penceText } from './shared'
import { SALE_CHANNELS, FIX_KINDS } from '@shared/costing.js'

const SHOW = 8

const pctLook = p => (p == null ? 'text-muted-foreground' : p >= 80 ? 'text-emerald-700' : p >= 50 ? 'text-amber-700' : 'text-red-700')

export function CoverageCard({ onOpenDish, onOpenRecipe, onOpenOption }) {
  const api = useApi()
  const { data: venues = [] } = useVenues()
  const [venueId, setVenueId] = useState('')
  const [all, setAll] = useState(false)
  const [open, setOpen] = useState(true)
  const { data, isLoading, error } = useQuery({
    queryKey: ['recipe-coverage', venueId],
    queryFn: () => api.get('/recipes/coverage' + (venueId ? '?venue_id=' + venueId : '')),
    placeholderData: prev => prev,
  })
  const money = !!data?.can?.money
  const dishes = data?.dishes || []
  const shown = all ? dishes : dishes.slice(0, SHOW)
  return (
    <section className="rounded-xl border bg-background overflow-hidden" data-testid="recipe-coverage-card">
      <div className="section-head flex flex-wrap items-center gap-2 px-4 py-2 min-h-[56px]">
        <h3 className="text-sm font-semibold flex-1 min-w-[12rem]" data-testid="recipe-coverage-title">
          {isLoading || !data ? 'Costed by sales'
            : !data.sold ? 'Costed: no sales in the last ' + data.days + ' days'
              : <>Costed: <span className={cn('tabular-nums', pctLook(data.percent))}>{data.percent == null ? 'nothing' : data.percent + '%'}</span> of the last {data.days} days&apos; sales</>}
        </h3>
        <select className={cn(inputCls, 'h-12 w-52 bg-background')} value={venueId} onChange={e => setVenueId(e.target.value)} aria-label="Venue" data-testid="recipe-coverage-venue">
          <option value="">Every venue</option>
          {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        <button type="button" onClick={() => setOpen(o => !o)} aria-label={open ? 'Fold' : 'Open'} aria-expanded={open}
          className="w-12 h-12 shrink-0 rounded-lg border bg-background flex items-center justify-center touch-manipulation">
          <ChevronDown className={cn('w-4 h-4 transition-transform', open && 'rotate-180')} />
        </button>
      </div>
      {open && (
        <div className="p-4 space-y-3">
          <ErrorNote error={error} />
          {isLoading && <div className="py-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" /></div>}
          {data && !data.sold && (
            <p className="text-sm text-muted-foreground">Nothing was sold {data.venue ? 'at ' + data.venue.name + ' ' : ''}in the last {data.days} days on the till, kiosks, online or another till linked on the Integrations page (test till sales are left out). Coverage shows here once something sells.</p>
          )}
          {data?.sold && (
            <>
              <p className="text-sm text-muted-foreground">
                A dish sold counts as costed when its recipe where it was sold (the venue, revenue stream and order type) has no gaps and its options have rules.
                {money && <> {penceText(data.costed_pence)} of {penceText(data.total_pence - data.left_out_pence)} sold{data.left_out_pence > 0 ? ' (services, open items and dishes no longer on a menu left out)' : ''}.</>}
              </p>
              <div className="flex flex-wrap gap-2" data-testid="recipe-coverage-channels">
                {Object.entries(data.channels).map(([k, c]) => (
                  <span key={k} className="inline-flex items-center gap-1.5 rounded-full border px-3 h-12 text-sm">
                    {SALE_CHANNELS[k] || k} <span className={cn('font-semibold tabular-nums', pctLook(c.percent))}>{c.percent == null ? '-' : c.percent + '%'}</span>
                  </span>
                ))}
                {!venueId && data.venues.length > 1 && data.venues.map(v => (
                  <button key={v.id} type="button" onClick={() => setVenueId(v.id)} data-testid="recipe-coverage-venue-chip"
                    className="inline-flex items-center gap-1.5 rounded-full border px-3 h-12 text-sm bg-muted/40 hover:bg-muted touch-manipulation">
                    {v.name} <span className={cn('font-semibold tabular-nums', pctLook(v.percent))}>{v.percent == null ? '-' : v.percent + '%'}</span>
                  </button>
                ))}
              </div>
              {!dishes.length ? (
                <p className="text-sm text-emerald-800" data-testid="recipe-coverage-done">Every dish sold can be costed.</p>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Not costed yet, most sold first</p>
                  <ul className="rounded-lg border divide-y" data-testid="recipe-coverage-dishes">
                    {shown.map(d => (
                      <UncostedRow key={(d.dish_id || 'n:' + d.name)} d={d} money={money} onOpenDish={onOpenDish} onOpenRecipe={onOpenRecipe} onOpenOption={onOpenOption} />
                    ))}
                  </ul>
                  {dishes.length > SHOW && (
                    <button type="button" className={cn(btn.ghost, 'h-12')} onClick={() => setAll(a => !a)} data-testid="recipe-coverage-more">
                      {all ? 'Show the first ' + SHOW : 'Show all ' + dishes.length}
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  )
}

function UncostedRow({ d, money, onOpenDish, onOpenRecipe, onOpenOption }) {
  const kinds = [...new Set(d.fixes.map(f => f.kind))]
  const recipeFix = d.fixes.find(f => f.kind === 'recipe' && f.recipe_id)
  const optionFix = d.fixes.find(f => f.kind === 'option' && f.option_id && !String(f.option_id).startsWith('v:'))
  const partFix = d.fixes.find(f => f.kind === 'deal' && f.dish_id)
  return (
    <li className="px-3 py-2 space-y-1.5" data-testid="recipe-coverage-dish" data-name={d.name}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex-1 min-w-[12rem]">
          <span className="font-medium">{d.name}</span>
          <span className="block text-xs text-muted-foreground">
            {[d.menu, d.mapping ? 'another till, ' + (d.mapping === 'kept' ? 'kept as sold' : d.mapping === 'bucket' ? 'in a section' : 'not mapped') : null,
              d.where.length === 1 ? d.where[0] : d.where.length > 1 ? d.where.length + ' places' : null, d.qty + ' sold'].filter(Boolean).join(' · ')}
          </span>
        </span>
        <span className="text-sm tabular-nums font-semibold" data-testid="recipe-coverage-value">
          {money ? penceText(d.sales_pence) : d.share_pct != null ? d.share_pct + '% of sales' : ''}
        </span>
      </div>
      <ul className="text-xs text-muted-foreground space-y-0.5">
        {d.fixes.slice(0, 4).map((f, i) => <li key={i}><span className="font-medium text-foreground">{FIX_KINDS[f.kind]}:</span> {f.text}</li>)}
        {d.fixes.length > 4 && <li>and {d.fixes.length - 4} more</li>}
      </ul>
      <div className="flex flex-wrap gap-2">
        {d.dish_id && (kinds.includes('link') || kinds.includes('option')) && (
          <button type="button" className={cn(btn.outline, 'h-12')} onClick={() => onOpenDish(d.dish_id)} data-testid="recipe-coverage-open-dish">
            {kinds.includes('link') ? 'Link a recipe' : 'Open the dish'}
          </button>
        )}
        {recipeFix && <button type="button" className={cn(btn.outline, 'h-12')} onClick={() => onOpenRecipe(recipeFix.recipe_id)} data-testid="recipe-coverage-open-recipe">Open {d.recipe?.name || 'the recipe'}</button>}
        {optionFix && <button type="button" className={cn(btn.outline, 'h-12')} onClick={() => onOpenOption(optionFix.option_id)}>Give the option a rule</button>}
        {partFix && <button type="button" className={cn(btn.outline, 'h-12')} onClick={() => onOpenDish(partFix.dish_id)}>Open the dish in the deal</button>}
        {kinds.includes('map') && <Link to="/integrations/mapping" className={cn(btn.outline, 'h-12')}>Item mapping</Link>}
      </div>
    </li>
  )
}
