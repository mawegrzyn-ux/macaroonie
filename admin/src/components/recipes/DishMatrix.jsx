// src/components/recipes/DishMatrix.jsx
//
// One menu dish's recipes, the variation matrix (inventory phase 2, the
// owner's ask: a recipe per revenue stream and order type, and per venue).
// Rows: every venue, then each venue with its revenue streams under it;
// columns: any order type, then each of the group's. Each cell shows the
// recipe in effect there and what a portion costs at that venue (Costing
// view): set in this cell (solid, can be cleared with a double confirm) or
// inherited (muted, naming the cell it comes from). The closest link wins,
// as taxFor() picks a tax rule: a stream, then an order type, then a venue
// (recipeFor() in shared/costing.js; the API decides, the page shows).
// Tapping a cell opens its picker: the recipe's own variations first, then
// any recipe, and portions; each cell has its own Save (design rule 5).
// The grid scrolls inside its card at 1015 px; on a phone it is a list per
// venue. Below it, the dish's options and the rule each follows, with the
// dish's own rule a tap away. API: routes/recipeLinks.js.

import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Loader2, Layers, AlertTriangle } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Field, inputCls, ErrorNote, ConfirmDelete, Modal } from '@/components/staff/shared'
import { Card, NumInput, btn } from '@/components/purchasing/shared'
import { pounds, penceText, BandBadge, CoverageBadge, cellWords, usePickers } from './shared'
import { RuleModal, StateBadge } from './OptionRules'
import { fmtNum } from '@shared/procurement.js'

const KIND_WORDS = { dish: 'Dish', deal: 'Meal deal', goods: 'Goods', service: 'Service' }

export function DishMatrix({ dishId, onClose, onOpenRecipe, canManage }) {
  const api = useApi()
  const { data, isLoading, error } = useQuery({ queryKey: ['recipe-dish', dishId], queryFn: () => api.get('/recipe-links/dishes/' + dishId) })
  const [picking, setPicking] = useState(null)
  const [ruleFor, setRuleFor] = useState(null)
  if (isLoading) return <div className="py-16 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" /></div>
  if (error) return <div className="space-y-3"><BackButton onClose={onClose} /><ErrorNote error={error} /></div>
  const d = data.dish
  const edit = canManage && data.can.manage
  const costs = data.can.costs
  const rowOf = key => data.rows.find(r => r.key === key)
  const colOf = key => data.cols.find(c => c.key === key)
  const open = c => setPicking({ cell: c, row: rowOf(c.key.split('|')[0]), col: colOf(c.key.split('|')[1]) })
  return (
    <div className="space-y-4" data-testid="dish-matrix">
      <div className="flex flex-wrap items-center gap-2">
        <BackButton onClose={onClose} />
        <div className="flex-1 min-w-[12rem]">
          <h2 className="text-lg font-semibold break-words" data-testid="dish-title">{d.name}</h2>
          <p className="text-xs text-muted-foreground">{[d.menu, d.section, KIND_WORDS[d.kind], d.price_pence != null ? penceText(d.price_pence) : null].filter(Boolean).join(' · ')}</p>
        </div>
      </div>
      {d.kind === 'deal' && (
        <Card title="A meal deal">
          <p className="text-sm">A meal deal has no recipe of its own: it costs the dishes picked in it, each with its own recipe and options.
            {costs && data.deal?.min != null && <> At the group&apos;s prices it costs <strong>{pounds(data.deal.min)}</strong> to <strong>{pounds(data.deal.max)}</strong> by what is picked.</>}
          </p>
          {data.deal?.gaps > 0 && <p className="text-xs text-amber-900 mt-2">{data.deal.gaps} of its choices can&apos;t be costed yet: link them to recipes.</p>}
        </Card>
      )}
      {d.kind === 'service' && <Card title="A service"><p className="text-sm">A service has no recipe and uses no stock: nothing to link.</p></Card>}
      {(d.kind === 'dish' || d.kind === 'goods') && (
        <>
          <Card title="Which recipe, where" bodyClass="p-0">
            <Legend />
            <MatrixGrid data={data} costs={costs} edit={edit} onPick={open} />
            <MatrixList data={data} costs={costs} edit={edit} onPick={open} />
          </Card>
          <OptionsCard data={data} edit={edit} onRule={setRuleFor} />
        </>
      )}
      {picking && (
        <CellPicker dish={d} pick={picking} data={data} edit={edit} onClose={() => setPicking(null)} onOpenRecipe={onOpenRecipe} />
      )}
      {ruleFor && (
        <RuleModal title={ruleFor.label + ' on ' + d.name} canManage={edit}
          target={ruleFor.own ? { option_id: null, dish_id: d.id, option_label: ruleFor.label } : { option_id: ruleFor.option_id, dish_id: d.id, option_label: null }}
          rule={ruleFor.rule_from === 'dish' ? ruleFor.rule : null}
          invalidate={[['recipe-dish', dishId], ['recipe-options']]} onClose={() => setRuleFor(null)} />
      )}
    </div>
  )
}

function BackButton({ onClose }) {
  return <button type="button" className={cn(btn.outline, 'h-12')} onClick={onClose} data-testid="dish-back"><ArrowLeft className="w-4 h-4" />Dishes</button>
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2 px-4 py-3 border-b text-xs" data-testid="matrix-legend">
      <span className="inline-flex items-center gap-2"><span className="w-5 h-5 rounded border-2 border-primary bg-primary/10" />Set here: tap to change or clear</span>
      <span className="inline-flex items-center gap-2"><span className="w-5 h-5 rounded border border-dashed bg-muted/40" />Inherited: from the cell it names</span>
      <span className="inline-flex items-center gap-2"><span className="w-5 h-5 rounded border border-amber-300 bg-amber-50" />None: no recipe here yet</span>
      <span className="text-muted-foreground">The closest wins: a revenue stream, then an order type, then a venue, then every venue.</span>
    </div>
  )
}

/** One cell's face: the recipe, set or inherited, its cost and margin. */
function CellFace({ c, costs, compact = false }) {
  if (!c.recipe) {
    return <span className="text-xs font-medium text-amber-900">No recipe</span>
  }
  return (
    <span className="block text-left">
      <span className={cn('block text-sm leading-tight line-clamp-2 break-words', c.set ? 'font-semibold' : 'text-muted-foreground')}>
        {c.recipe.variant_of && <Layers className="inline w-3 h-3 mr-1 -mt-0.5" aria-label="A variation" />}
        {c.recipe.name}{c.portions && Number(c.portions) !== 1 ? ' x ' + fmtNum(c.portions) : ''}
      </span>
      {!c.set && !compact && <span className="block text-[11px] text-muted-foreground leading-tight mt-0.5">from {c.from_name}</span>}
      {costs && (
        <span className="flex flex-wrap items-center gap-1 mt-1">
          <span className="text-xs tabular-nums">{c.cost != null ? pounds(c.cost) : 'No cost'}</span>
          {c.margin && <BandBadge band={c.margin.band} pct={c.margin.cost_pct} />}
          {c.coverage === 'partial' && <AlertTriangle className="w-3.5 h-3.5 text-amber-700" aria-label="Partly costed" />}
        </span>
      )}
      {!c.sold && <span className="block text-[11px] text-muted-foreground mt-0.5">not on its menus</span>}
    </span>
  )
}

const cellCls = c => cn('w-full h-full min-h-[64px] p-2 rounded-lg border text-left touch-manipulation transition-colors',
  !c.recipe ? 'border-amber-300 bg-amber-50 hover:bg-amber-100'
    : c.set ? 'border-2 border-primary bg-primary/5 hover:bg-primary/10' : 'border-dashed bg-muted/30 hover:bg-muted/60')

function MatrixGrid({ data, costs, edit, onPick }) {
  return (
    <div className="hidden sm:block overflow-x-auto" data-testid="matrix-grid">
      <table className="border-separate border-spacing-1 min-w-full">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-background text-left text-xs font-medium text-muted-foreground px-2 py-2 min-w-[150px]">Where</th>
            {data.cols.map(c => <th key={c.key} className="text-left text-xs font-medium text-muted-foreground px-2 py-2 min-w-[150px]">{c.name}</th>)}
          </tr>
        </thead>
        <tbody>
          {data.rows.map(r => (
            <tr key={r.key}>
              <th scope="row" className={cn('sticky left-0 z-10 bg-background text-left text-sm px-2 py-1 align-top', r.kind === 'stream' && 'pl-6 font-normal', r.kind === 'venue' && 'font-semibold', r.kind === 'every' && 'font-semibold')}>
                {r.name}
                {r.kind === 'stream' && <span className="block text-[11px] text-muted-foreground font-normal">revenue stream</span>}
              </th>
              {data.cols.map(col => {
                const c = data.cells[r.key + '|' + col.key]
                return (
                  <td key={col.key} className="align-top h-px">
                    <button type="button" className={cellCls(c)} onClick={() => onPick(c)} data-testid="matrix-cell" data-cell={c.key}
                      data-state={!c.recipe ? 'none' : c.set ? 'set' : 'inherited'} aria-label={cellWords(r, col) + ': ' + (c.recipe ? c.recipe.name : 'no recipe')}>
                      <CellFace c={c} costs={costs} />
                    </button>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** On a phone: each venue (and stream) as a list of its order types. */
function MatrixList({ data, costs, edit, onPick }) {
  return (
    <div className="sm:hidden divide-y" data-testid="matrix-list">
      {data.rows.map(r => (
        <div key={r.key} className={cn('p-3 space-y-2', r.kind === 'stream' && 'pl-6 bg-muted/20')}>
          <p className="text-sm font-semibold">{r.kind === 'stream' ? r.name + ' (' + r.venue_name + ')' : r.name}</p>
          {data.cols.map(col => {
            const c = data.cells[r.key + '|' + col.key]
            return (
              <button key={col.key} type="button" className={cn(cellCls(c), 'flex items-start gap-3')} onClick={() => onPick(c)} data-testid="matrix-row-cell" data-cell={c.key}>
                <span className="w-24 shrink-0 text-xs text-muted-foreground pt-0.5">{col.name}</span>
                <span className="flex-1 min-w-0"><CellFace c={c} costs={costs} /></span>
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}

/** A cell's picker: the recipe's variations first, then any recipe, and portions; its own Save. */
function CellPicker({ dish, pick, data, edit, onClose, onOpenRecipe }) {
  const api = useApi()
  const qc = useQueryClient()
  const { data: pickers } = usePickers()
  const { cell, row, col } = pick
  const [recipeId, setRecipeId] = useState(cell.set?.recipe_id || cell.recipe?.id || null)
  const [portions, setPortions] = useState(cell.set?.portions ?? cell.portions ?? 1)
  const [q, setQ] = useState('')
  const dishes = useMemo(() => (pickers?.dishes || []).filter(r => r.is_active || r.id === recipeId), [pickers, recipeId])
  // The family of the recipe in effect (or the dish's default): its head and its variations.
  const base = cell.recipe || data.cells['all|any']?.recipe
  const head = base ? (base.variant_of || base.id) : null
  const family = head ? dishes.filter(r => r.id === head || r.variant_of === head) : []
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const others = dishes.filter(r => !family.includes(r)).filter(r => words.every(w => (r.name + ' ' + (r.category || '') + ' ' + (r.code || '')).toLowerCase().includes(w)))
  const after = () => {
    qc.invalidateQueries({ queryKey: ['recipe-dish', dish.id] })
    qc.invalidateQueries({ queryKey: ['recipe-dishes'] })
    qc.invalidateQueries({ queryKey: ['recipe-dish-links'] })
    qc.invalidateQueries({ queryKey: ['menu-margins'] })
  }
  const save = useMutation({
    mutationFn: () => api.put('/recipe-links/dishes/' + dish.id + '/cell', { ...cell.scope, recipe_id: recipeId, portions: Number(portions) || 1 }),
    onSuccess: () => { after(); onClose() },
  })
  const clear = useMutation({ mutationFn: () => api.delete('/recipe-links/links/' + cell.set.link_id), onSuccess: () => { after(); onClose() } })
  const changed = recipeId && (recipeId !== cell.set?.recipe_id || Number(portions) !== Number(cell.set?.portions ?? NaN))
  const option = r => (
    <button key={r.id} type="button" disabled={!edit} onClick={() => setRecipeId(r.id)} aria-pressed={recipeId === r.id} data-testid="cell-recipe" data-name={r.name}
      className={cn('w-full text-left px-3 min-h-[48px] flex items-center gap-2 border-b last:border-b-0 touch-manipulation disabled:opacity-70',
        recipeId === r.id ? 'bg-primary/10 font-medium' : 'hover:bg-muted')}>
      {r.variant_of && <Layers className="w-3.5 h-3.5 text-muted-foreground" />}
      <span className="flex-1 text-sm">{r.name}</span>
      {r.status === 'draft' && <span className="text-xs rounded-full bg-muted px-2 py-0.5">Draft</span>}
    </button>
  )
  return (
    <Modal title={cellWords(row, col)} onClose={onClose}
      footer={edit && (
        <>
          <button type="button" className={cn(btn.primary, 'h-12')} disabled={!changed || save.isPending} onClick={() => save.mutate()} data-testid="cell-save">
            {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />}Save this cell
          </button>
          {cell.set && (
            <span className="inline-flex items-center gap-2 text-xs text-muted-foreground ml-auto" data-testid="cell-clear">
              Clear it: it then follows the next closest cell
              <ConfirmDelete label="Clear this cell" confirmLabel="Yes, clear it" onConfirm={() => clear.mutate()} disabled={clear.isPending} big />
            </span>
          )}
        </>
      )}>
      <p className="text-sm" data-testid="cell-now">
        {cell.recipe
          ? <>Now: <strong>{cell.recipe.name}</strong>{cell.set ? ', set in this cell.' : <>, inherited from {cell.from_name}.</>}</>
          : 'No recipe here yet: nothing applies to this venue and order type.'}
        {cell.recipe && onOpenRecipe && <button type="button" className="ml-2 underline text-xs min-h-[48px] touch-manipulation" onClick={() => onOpenRecipe(cell.recipe.id)}>Open the recipe</button>}
      </p>
      {family.length > 0 && (
        <Field label="Its variations" group>
          <div className="rounded-lg border overflow-hidden" data-testid="cell-family">{family.map(option)}</div>
        </Field>
      )}
      <Field label={family.length ? 'Any other recipe' : 'A recipe'} group>
        <input className={cn(inputCls, 'h-12 mb-1')} value={q} onChange={e => setQ(e.target.value)} placeholder="Search recipes" aria-label="Search recipes" data-testid="cell-search" />
        <div className="rounded-lg border overflow-hidden max-h-64 overflow-y-auto">{others.slice(0, 30).map(option)}</div>
      </Field>
      <Field label="Portions of it" hint="A dish that is two portions of a recipe (a double): 2.">
        <NumInput value={portions} onChange={setPortions} disabled={!edit} className="h-12 w-32" aria-label="Portions" data-testid="cell-portions" />
      </Field>
      <ErrorNote error={save.error || clear.error} />
    </Modal>
  )
}

function OptionsCard({ data, edit, onRule }) {
  if (!data.options.length) return null
  return (
    <Card title="Its options" bodyClass="p-0">
      <p className="px-4 pt-3 text-xs text-muted-foreground">What each option does to whichever recipe the cell above uses. A rule for this dish only beats the option&apos;s own (set on the Options tab).</p>
      <ul className="divide-y" data-testid="dish-options">
        {data.options.map(o => (
          <li key={(o.option_id || 'own') + ':' + o.label} className="px-4 py-2 min-h-[56px] flex flex-wrap items-center gap-2">
            <span className="flex-1 min-w-[10rem]">
              <span className="font-medium">{o.label}</span> <span className="text-xs text-muted-foreground">{o.group}</span>
              <span className="block text-xs text-muted-foreground">
                {o.rule ? o.rule.text + (o.rule_from === 'dish' ? ' (this dish\'s own)' : ' (the option\'s rule)') : o.default_text}
              </span>
            </span>
            {/* The API's state (optionDefault() in shared/costing.js), as dishCost() costs the option. */}
            <StateBadge state={o.state} />
            {edit && <button type="button" className={cn(btn.outline, 'h-12')} onClick={() => onRule(o)} data-testid="dish-option-rule">{o.rule_from === 'dish' ? 'Change this dish\'s rule' : 'Rule for this dish'}</button>}
          </li>
        ))}
      </ul>
    </Card>
  )
}
