// src/components/purchasing/units.jsx
//
// An inventory item's units and yield (inventory phase 1, migration 298), a
// card in the Inventory page's item drawer:
//   - Yield: the usable share after trimming (an onion 88%). Recipes divide
//     what they use by it to say what has to be bought.
//   - Usual units: the unit recipes usually give it in and the unit it is
//     counted in (a standard unit of its kind, or one of its own).
//   - Its own units: "1 slice = 20 g", "1 each = 150 g" for an item kept in
//     grams. Recipes cost it through them (toBase() in shared/costing.js);
//     a unit a recipe uses can't be deleted (the API says which recipes).
// Each part saves with its own button. The card stays put while the drawer's
// other cards save: a part not changed here follows the item as stored, a
// changed one keeps its changes until its own Save. API: routes/inventory.js.

import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Loader2, Plus, Sparkles } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Field, inputCls, ErrorNote, ConfirmDelete } from '@/components/staff/shared'
import { NumInput, Card, btn } from '@/components/purchasing/shared'
import { UNITS, fmtNum } from '@shared/procurement.js'
import { unitChoices, unitNameProblem, asBought } from '@shared/costing.js'
import { ASSISTANT_NAME } from '@shared/assistant.js'

const baseLabel = u => UNITS[u]?.label ?? u

export function UnitsCard({ item, canEdit, onSaved }) {
  return (
    <Card title="Units and yield" bodyClass="p-0">
      <YieldForm item={item} canEdit={canEdit} onSaved={onSaved} />
      <OwnUnits item={item} canEdit={canEdit} onSaved={onSaved} />
    </Card>
  )
}

const yieldOfItem = i => ({ yield_pct: i.yield_pct ?? 100, recipe_unit: i.recipe_unit || '', count_unit: i.count_unit || '' })
const yieldDiffers = (a, b) => Number(a.yield_pct) !== Number(b.yield_pct) || a.recipe_unit !== b.recipe_unit || a.count_unit !== b.count_unit

function YieldForm({ item, canEdit, onSaved }) {
  const api = useApi()
  const initial = yieldOfItem(item)
  const [f, setF] = useState(initial)
  // The item as stored changed (another card saved, a unit renamed): follow it unless changed here.
  const [was, setWas] = useState(initial)
  if (yieldDiffers(was, initial)) {
    setWas(initial)
    if (!yieldDiffers(f, was)) setF(initial)
  }
  const choices = unitChoices(item)
  const dirty = yieldDiffers(f, initial)
  const wrong = f.yield_pct == null || f.yield_pct < 1 || f.yield_pct > 100
  const save = useMutation({
    mutationFn: () => api.patch('/inventory/items/' + item.id, {
      yield_pct: Number(f.yield_pct), recipe_unit: f.recipe_unit || null, count_unit: f.count_unit || null,
    }),
    onSuccess: saved => { setF(yieldOfItem(saved)); setWas(yieldOfItem(saved)); onSaved(saved) },
  })
  return (
    <div className="p-4 space-y-3 border-b" data-testid="inv-yield">
      <div className="grid sm:grid-cols-3 gap-3">
        <Field label="Yield (usable %)" hint={wrong ? 'Between 1 and 100' : 'What is left after trimming: an onion about 88'}>
          <NumInput value={f.yield_pct} disabled={!canEdit} onChange={v => setF(x => ({ ...x, yield_pct: v }))}
            className={cn(wrong && 'border-destructive')} data-testid="inv-yield-pct" />
        </Field>
        <Field label="Used in recipes in">
          <select className={inputCls} value={f.recipe_unit} disabled={!canEdit} onChange={e => setF(x => ({ ...x, recipe_unit: e.target.value }))}
            data-testid="inv-recipe-unit">
            <option value="">Not set</option>
            {choices.map(u => <option key={u} value={u}>{baseLabel(u)}</option>)}
          </select>
        </Field>
        <Field label="Counted in">
          <select className={inputCls} value={f.count_unit} disabled={!canEdit} onChange={e => setF(x => ({ ...x, count_unit: e.target.value }))}>
            <option value="">Not set</option>
            {choices.map(u => <option key={u} value={u}>{baseLabel(u)}</option>)}
          </select>
        </Field>
      </div>
      {canEdit && <YieldSuggestion item={item} onUse={pct => setF(x => ({ ...x, yield_pct: pct }))} />}
      {Number(f.yield_pct) < 100 && !wrong && (
        <p className="text-xs text-muted-foreground">
          A recipe using {fmtNum(100)} {baseLabel(item.base_unit)} needs {fmtNum(asBought(100, Number(f.yield_pct)))} {baseLabel(item.base_unit)} bought.
        </p>
      )}
      {canEdit && (
        <div className="flex justify-end">
          <button type="button" className={btn.primary} disabled={!dirty || wrong || save.isPending} onClick={() => save.mutate()} data-testid="inv-yield-save">
            {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />}Save
          </button>
        </div>
      )}
      <ErrorNote error={save.error} />
    </div>
  )
}

/**
 * A typical yield for the item, asked of Pepper (inventory phase 3; POST
 * /api/ai/recipes/yield): shown as a suggestion with its words, put in the
 * yield field only when the person taps Use it, and saved only with the
 * card's own Save.
 */
function YieldSuggestion({ item, onUse }) {
  const api = useApi()
  const { data: ai } = useQuery({ queryKey: ['ai-status'], queryFn: () => api.get('/ai/status'), staleTime: 60_000 })
  const ask = useMutation({ mutationFn: () => api.post('/ai/recipes/yield', { item_id: item.id }) })
  if (!ai?.can_chat) return null
  const s = ask.data
  return (
    <div className="space-y-2" data-testid="inv-yield-suggest">
      {!s && (
        <button type="button" className={cn(btn.outline, 'h-12')} disabled={ask.isPending} onClick={() => ask.mutate()} data-testid="inv-yield-ask">
          {ask.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}Suggest a typical yield
        </button>
      )}
      {s && (
        <div className="rounded-lg border border-sky-200 bg-sky-50 text-sky-900 px-3 py-2 text-sm flex flex-wrap items-center gap-2" data-testid="inv-yield-suggestion">
          <span className="flex-1 min-w-[12rem]">
            <span className="font-medium">{ASSISTANT_NAME} suggests {fmtNum(s.yield_pct)}%</span>
            {s.low != null && s.high != null && s.low !== s.high && <span> (usually {fmtNum(s.low)} to {fmtNum(s.high)}%)</span>}
            {s.words && <span className="block text-xs">{s.words}</span>}
            {!s.sure && <span className="block text-xs">Only a guess: the name doesn&apos;t say enough.</span>}
            <span className="block text-xs text-sky-800">A suggestion: weigh one before and after trimming to know yours.</span>
          </span>
          <button type="button" className={cn(btn.outline, 'h-12')} onClick={() => onUse(s.yield_pct)} data-testid="inv-yield-use">Use {fmtNum(s.yield_pct)}%</button>
          <button type="button" className={cn(btn.ghost, 'h-12')} onClick={() => ask.reset()}>Dismiss</button>
        </div>
      )}
      <ErrorNote error={ask.error} />
    </div>
  )
}

function OwnUnits({ item, canEdit, onSaved }) {
  const api = useApi()
  const [name, setName] = useState('')
  const [qty, setQty] = useState(null)
  const problem = name.trim() ? unitNameProblem(name, item) : null
  const add = useMutation({
    mutationFn: () => api.post('/inventory/items/' + item.id + '/units', { name: name.trim(), base_qty: qty }),
    onSuccess: saved => { setName(''); setQty(null); onSaved(saved) },
  })
  const units = item.units || []
  return (
    <div className="p-4 space-y-3" data-testid="inv-units">
      <p className="text-sm">
        <span className="font-medium">Its own units</span>
        <span className="text-muted-foreground"> · besides {unitChoices({ base_unit: item.base_unit }).map(baseLabel).join(', ')}: a slice, a portion, one of them in {baseLabel(item.base_unit)}.</span>
      </p>
      {!units.length && <p className="text-sm text-muted-foreground">None yet.</p>}
      {units.length > 0 && (
        <div className="rounded-lg border divide-y">
          {units.map(u => <UnitRow key={u.id + u.name + u.base_qty} unit={u} item={item} canEdit={canEdit} onSaved={onSaved} />)}
        </div>
      )}
      {canEdit && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="New unit">
            <input className={cn(inputCls, 'w-36', problem && 'border-destructive')} value={name} placeholder="portion" maxLength={30}
              onChange={e => setName(e.target.value)} data-testid="inv-unit-name" />
          </Field>
          <Field label={'One is (' + baseLabel(item.base_unit) + ')'}>
            <NumInput value={qty} onChange={setQty} className="w-28" data-testid="inv-unit-qty" />
          </Field>
          <button type="button" className={btn.outline} disabled={!name.trim() || !!problem || !(qty > 0) || add.isPending}
            onClick={() => add.mutate()} data-testid="inv-unit-add">
            {add.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}Add unit
          </button>
        </div>
      )}
      {problem && <p className="text-xs text-destructive">{problem}</p>}
      <ErrorNote error={add.error} />
    </div>
  )
}

function UnitRow({ unit, item, canEdit, onSaved }) {
  const api = useApi()
  const [name, setName] = useState(unit.name)
  const [qty, setQty] = useState(unit.base_qty)
  const dirty = name.trim() !== unit.name || Number(qty) !== Number(unit.base_qty)
  const problem = name.trim().toLowerCase() !== unit.name.toLowerCase() ? unitNameProblem(name, item, { except: unit.id }) : (!name.trim() ? 'Give the unit a name' : null)
  const save = useMutation({
    mutationFn: () => api.patch('/inventory/units/' + unit.id, { name: name.trim(), base_qty: qty }),
    onSuccess: onSaved,
  })
  const del = useMutation({ mutationFn: () => api.delete('/inventory/units/' + unit.id), onSuccess: onSaved })
  return (
    <div className="p-2 space-y-1" data-testid="inv-unit-row">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">1</span>
        <input className={cn(inputCls, 'w-32', problem && 'border-destructive')} value={name} disabled={!canEdit} maxLength={30}
          onChange={e => setName(e.target.value)} aria-label="Unit name" />
        <span className="text-sm text-muted-foreground">=</span>
        <NumInput value={qty} onChange={setQty} disabled={!canEdit} className="w-24" aria-label={'How many ' + baseLabel(item.base_unit)} />
        <span className="text-sm text-muted-foreground">{baseLabel(item.base_unit)}</span>
        <span className="flex-1" />
        {canEdit && dirty && (
          <button type="button" className={btn.outline} disabled={!!problem || !(qty > 0) || save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />}Save
          </button>
        )}
        {canEdit && <ConfirmDelete label={'Delete ' + unit.name} onConfirm={() => del.mutate()} disabled={del.isPending} />}
      </div>
      {problem && <p className="text-xs text-destructive">{problem}</p>}
      <ErrorNote error={save.error || del.error} />
    </div>
  )
}
