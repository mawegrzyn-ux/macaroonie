// src/pages/Recipes.jsx
//
// Recipes (/recipes, module recipes; inventory phase 1, docs/INVENTORY.md
// 5.3): every dish and prep recipe of the group, with what each costs at a
// venue's supplier prices (Costing view) and how much of it can be costed:
// fully, partly (some lines have no price or no size for their unit) or not
// at all. Tapping one opens the editor (components/recipes/RecipeEditor.jsx).
// The venue, basis and open recipe are in the address (?venue= &basis=
// &recipe=), so a link opens the same view; ?q= starts the list's search
// (Pepper's link to a recipe, by name). API: routes/recipes.js.

import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChefHat, Plus, Search, Loader2, Layers } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { usePermission } from '@/hooks/usePermission'
import { ReadOnlyNotice } from '@/components/ReadOnlyNotice'
import { PageHeader, Segmented, inputCls, ErrorNote } from '@/components/staff/shared'
import { Card, btn } from '@/components/purchasing/shared'
import { CoverageBadge, KindBadge, CostAt, pounds, perLabel, makesText, COVERAGE, BASES } from '@/components/recipes/shared'
import { RecipeEditor } from '@/components/recipes/RecipeEditor'

export default function Recipes() {
  const { canView, canManage, loaded } = usePermission('recipes')
  const [params, setParams] = useSearchParams()
  const openId = params.get('recipe')
  const venueId = params.get('venue') || ''
  const basis = BASES.some(b => b.key === params.get('basis')) ? params.get('basis') : 'standard'
  const set = (changes) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(changes)) { if (v) next.set(k, v); else next.delete(k) }
    setParams(next, { replace: !('recipe' in changes) })
  }
  if (loaded && !canView) {
    return <div className="h-full overflow-y-auto bg-page p-6 text-sm text-muted-foreground">Your role can't see recipes.</div>
  }
  return (
    <div className="h-full overflow-y-auto bg-page" data-testid="recipes-page">
      <PageHeader icon={ChefHat} title="Recipes">
        {canManage && !openId && (
          <button type="button" className={cn(btn.primary, 'h-12')} onClick={() => set({ recipe: 'new' })} data-testid="recipe-new">
            <Plus className="w-4 h-4" />New recipe
          </button>
        )}
      </PageHeader>
      <div className="max-w-6xl mx-auto p-4 space-y-4">
        {loaded && !canManage && <ReadOnlyNotice what="recipes" />}
        {openId
          ? <RecipeEditor key={openId} id={openId === 'new' ? null : openId} venueId={venueId} basis={basis}
              onVenue={v => set({ venue: v })} onBasis={b => set({ basis: b === 'standard' ? '' : b })}
              onOpen={id => set({ recipe: id })} onClose={() => set({ recipe: '' })} canManage={canManage} />
          : <RecipeList venueId={venueId} basis={basis} startQ={params.get('q') || ''} onVenue={v => set({ venue: v })}
              onBasis={b => set({ basis: b === 'standard' ? '' : b })} onOpen={id => set({ recipe: id })} />}
      </div>
    </div>
  )
}

function RecipeList({ venueId, basis, startQ, onVenue, onBasis, onOpen }) {
  const api = useApi()
  const [q, setQ] = useState(startQ)
  const [kind, setKind] = useState('')
  const [coverage, setCoverage] = useState('')
  const [active, setActive] = useState('on')
  const query = new URLSearchParams({ active, ...(venueId ? { venue_id: venueId } : {}), ...(basis !== 'standard' ? { basis } : {}) })
  const { data, isLoading, error } = useQuery({
    queryKey: ['recipes', venueId, basis, active], queryFn: () => api.get('/recipes?' + query.toString()),
    placeholderData: prev => prev,
  })
  const costs = !!data?.can?.costs
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const rows = useMemo(() => (data?.recipes || [])
    .filter(r => !kind || r.kind === kind)
    .filter(r => !coverage || r.coverage === coverage)
    .filter(r => words.every(w => [r.name, r.category, r.code].some(x => (x || '').toLowerCase().includes(w)))),
  [data, kind, coverage, q])
  // A variation sits under the recipe it varies, when both are listed.
  const ordered = useMemo(() => {
    const ids = new Set(rows.map(r => r.id))
    const heads = rows.filter(r => !r.variant_of || !ids.has(r.variant_of))
    return heads.flatMap(h => [h, ...rows.filter(r => r.variant_of === h.id)])
  }, [rows])
  const counts = data?.counts || { full: 0, partial: 0, none: 0 }
  return (
    <>
      {costs && (
        <Card title="What costs are worked out at">
          <CostAt venueId={venueId} basis={basis} onVenue={onVenue} onBasis={onBasis} />
          <p className="text-xs text-muted-foreground mt-2">{BASES.find(b => b.key === basis)?.hint}</p>
        </Card>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex-1 min-w-[14rem]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input className={cn(inputCls, 'h-12 pl-9')} value={q} onChange={e => setQ(e.target.value)} placeholder="Search recipes, categories, codes"
            aria-label="Search recipes" data-testid="recipe-search" />
        </label>
        <Segmented value={kind} onChange={setKind} options={[{ value: '', label: 'All' }, { value: 'dish', label: 'Dishes' }, { value: 'prep', label: 'Prep' }]}
          className="[&>button]:h-12" testid="recipe-kind" />
        <Segmented value={active} onChange={setActive} options={[{ value: 'on', label: 'In use' }, { value: 'off', label: 'Switched off' }]}
          className="[&>button]:h-12" testid="recipe-active" />
      </div>
      <div className="flex flex-wrap gap-2" data-testid="recipe-coverage">
        {[['', 'Every recipe', counts.full + counts.partial + counts.none], ['full', COVERAGE.full, counts.full], ['partial', COVERAGE.partial, counts.partial], ['none', COVERAGE.none, counts.none]].map(([k, label, n]) => (
          <button key={k || 'all'} type="button" onClick={() => setCoverage(k)} aria-pressed={coverage === k}
            className={cn('h-12 px-4 rounded-full border text-sm touch-manipulation', coverage === k ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted')}>
            {label} <span className="tabular-nums opacity-80">{n}</span>
          </button>
        ))}
      </div>
      <ErrorNote error={error} />
      <Card title={isLoading ? 'Recipes' : ordered.length + (ordered.length === 1 ? ' recipe' : ' recipes')} bodyClass="p-0">
        {isLoading ? (
          <div className="py-12 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" /></div>
        ) : !ordered.length ? (
          <p className="p-4 text-sm text-muted-foreground">
            {(data?.recipes || []).length ? 'Nothing matches.' : 'No recipes yet. A recipe lists what goes into a dish or a prep batch; its cost comes from your supplier prices.'}
          </p>
        ) : (
          <ul className="divide-y" data-testid="recipe-list">
            {ordered.map(r => (
              <li key={r.id}>
                <button type="button" onClick={() => onOpen(r.id)} data-testid="recipe-row" data-name={r.name}
                  className={cn('w-full text-left px-4 py-3 min-h-[56px] flex flex-wrap items-center gap-x-3 gap-y-1 hover:bg-muted/50 touch-manipulation',
                    r.variant_of && 'pl-10')}>
                  <span className="flex-1 min-w-[12rem]">
                    <span className="flex items-center gap-2 flex-wrap">
                      {r.variant_of && <Layers className="w-3.5 h-3.5 text-muted-foreground" aria-label="A variation" />}
                      <span className="font-medium">{r.name}</span>
                      <KindBadge kind={r.kind} />
                      {r.status === 'draft' && <span className="text-xs rounded-full bg-muted px-2 py-0.5">Draft</span>}
                    </span>
                    <span className="block text-xs text-muted-foreground mt-0.5">
                      {[r.category, makesText(r), r.line_count + (r.line_count === 1 ? ' line' : ' lines'),
                        r.used_in ? 'in ' + r.used_in + (r.used_in === 1 ? ' recipe' : ' recipes') : null,
                        r.variant_of_name ? 'a variation of ' + r.variant_of_name : null].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <CoverageBadge coverage={r.coverage} />
                  {costs && (
                    <span className="w-28 text-right tabular-nums" data-testid="recipe-row-cost">
                      {r.per_unit != null ? <><span className="font-semibold">{pounds(r.per_unit)}</span> <span className="text-xs text-muted-foreground">{perLabel(r.unit)}</span></> : <span className="text-xs text-muted-foreground">No cost</span>}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  )
}
