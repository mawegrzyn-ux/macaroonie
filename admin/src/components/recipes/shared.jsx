// src/components/recipes/shared.jsx
//
// What the Recipes page's parts share (inventory phase 1): money and units in
// words, the coverage badge, the editor's pickers and the save body. The
// costs themselves come from the API (shared/costing.js on the server); the
// page never works a cost out (rule 12).

import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, CircleDashed, AlertTriangle } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Field, inputCls, Segmented, useVenues } from '@/components/staff/shared'
import { UNITS, fmtNum } from '@shared/procurement.js'
import { COVERAGE, BASES } from '@shared/costing.js'

export { COVERAGE, BASES }

/** Pounds: £0.26, £12.50; below a penny to four places. */
export function pounds(n) {
  if (n == null || n === '' || !Number.isFinite(Number(n))) return ''
  const v = Number(n)
  return (v < 0 ? '-£' : '£') + (Math.abs(v) > 0 && Math.abs(v) < 0.01 ? Math.abs(v).toFixed(4) : Math.abs(v).toFixed(2))
}

export const unitLabel = u => (u === 'portion' ? 'portion' : UNITS[u]?.label ?? u ?? '')

/** "a portion", "a l", "each" */
export function perLabel(unit) {
  if (!unit) return ''
  if (unit === 'each') return 'each'
  return 'a ' + unitLabel(unit)
}

/** What a recipe makes, in words: "2 portions", "1.5 l". */
export function makesText(r) {
  if (!r) return ''
  if (r.kind === 'prep') return r.yield_qty ? fmtNum(r.yield_qty) + ' ' + unitLabel(r.yield_unit) : 'Not set'
  const p = Number(r.portions || 1)
  return fmtNum(p) + (p === 1 ? ' portion' : ' portions')
}

const COVERAGE_LOOK = {
  full: { icon: CheckCircle2, cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  partial: { icon: AlertTriangle, cls: 'bg-amber-50 text-amber-900 border-amber-200' },
  none: { icon: CircleDashed, cls: 'bg-muted text-muted-foreground border-border' },
}

export function CoverageBadge({ coverage, className }) {
  const look = COVERAGE_LOOK[coverage] || COVERAGE_LOOK.none
  const Icon = look.icon
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap', look.cls, className)}
      data-coverage={coverage}>
      <Icon className="w-3.5 h-3.5" />{COVERAGE[coverage] || COVERAGE.none}
    </span>
  )
}

export function KindBadge({ kind }) {
  return (
    <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium',
      kind === 'prep' ? 'bg-sky-50 text-sky-800' : 'bg-violet-50 text-violet-800')}>
      {kind === 'prep' ? 'Prep' : 'Dish'}
    </span>
  )
}

/** Items (names and units, no prices) and prep recipes for the line pickers. */
export function usePickers() {
  const api = useApi()
  return useQuery({ queryKey: ['recipe-pickers'], queryFn: () => api.get('/recipes/pickers'), staleTime: 30_000 })
}

// The three parts of the editor, each saved with its own button. A save
// sends the whole recipe (rule 13): this part's draft and the rest as stored.
export const detailsOf = r => ({
  name: r.name, kind: r.kind, category: r.category || '', code: r.code || '', status: r.status,
  yield_qty: r.yield_qty, yield_unit: r.yield_unit || '', portions: r.portions, loss_pct: r.loss_pct ?? 0,
  shelf_life_hours: r.shelf_life_hours, variant_of: r.variant_of || '', notes: r.notes || '', is_active: r.is_active,
})
let keySeq = 0
export const lineKey = () => 'l' + (++keySeq)
export const linesOf = r => (r.lines || []).map(l => ({
  key: lineKey(), item_id: l.item_id || null, sub_recipe_id: l.sub_recipe_id || null, qty: l.qty, unit: l.unit,
  yield_pct: l.yield_pct ?? null, note: l.note || '',
}))
export const methodOf = r => ({ method: r.method || '', photo_url: r.photo_url || null })

const blank = v => (v === '' || v === undefined ? null : v)
const lineOut = l => ({
  item_id: l.item_id || null, sub_recipe_id: l.sub_recipe_id || null, qty: Number(l.qty), unit: l.unit,
  yield_pct: l.yield_pct == null || l.yield_pct === '' ? null : Number(l.yield_pct), note: blank((l.note || '').trim()),
})

/** The whole recipe as PUT wants it: every field, the stored ones with `parts` over them. */
export function saveBody(server, parts = {}) {
  const d = { ...detailsOf(server), ...(parts.details || {}) }
  const m = { ...methodOf(server), ...(parts.method || {}) }
  const lines = parts.lines || linesOf(server)
  return {
    name: d.name.trim(), kind: d.kind, category: blank(d.category.trim()), code: blank(d.code.trim()), status: d.status,
    yield_qty: d.kind === 'prep' ? blank(d.yield_qty) : null,
    yield_unit: d.kind === 'prep' ? blank(d.yield_unit) : null,
    portions: d.kind === 'dish' ? blank(d.portions) : null,
    loss_pct: d.kind === 'prep' ? Number(d.loss_pct || 0) : 0,
    shelf_life_hours: blank(d.shelf_life_hours), variant_of: blank(d.variant_of), notes: blank(d.notes.trim()), is_active: d.is_active,
    method: blank(m.method.trim()), photo_url: m.photo_url || null,
    lines: lines.map(lineOut),
  }
}

export const sameLines = (a, b) => JSON.stringify(a.map(lineOut)) === JSON.stringify(b.map(lineOut))
export const sameObj = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/** The venue whose prices costs are at, and on which basis (Costing view only). */
export function CostAt({ venueId, basis, onVenue, onBasis, testid = 'recipe-cost-at' }) {
  const { data: venues = [] } = useVenues()
  return (
    <div className="flex flex-wrap items-end gap-3" data-testid={testid}>
      <Field label="Costs at">
        <select className={cn(inputCls, 'h-12 w-56')} value={venueId} onChange={e => onVenue(e.target.value)} data-testid="recipe-venue">
          <option value="">The group's prices</option>
          {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </Field>
      <Field label="Priced by" group>
        <Segmented value={basis} onChange={onBasis} options={BASES.map(b => ({ value: b.key, label: b.label }))} className="[&>button]:h-12" testid="recipe-basis" />
      </Field>
    </div>
  )
}
