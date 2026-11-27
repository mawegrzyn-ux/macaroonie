// src/components/recipes/OptionRules.jsx
//
// What options do to a dish's recipe (inventory phase 2, decision D3): the
// Recipes page's Options tab, one option's editor, and the rule form the
// dish matrix also uses for a dish's own exception or its own one-off
// options. A rule adds (an item or a prep recipe, how much), takes an item
// out, swaps one for another, scales the recipe, is a recipe of its own (a
// side) or changes nothing; an option with no rule follows its group's
// variation type, and an addition or a side with none is a gap. The till's
// No, Light, Extra and On the side act on the option's own lines.
// Each rule saves with its own button and is sent whole (rule 13).
// API: routes/recipeOptions.js.

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Loader2, AlertTriangle, CheckCircle2, CircleDashed } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Field, inputCls, ErrorNote, ConfirmDelete, Segmented } from '@/components/staff/shared'
import { Card, NumInput, btn } from '@/components/purchasing/shared'
import { RULE_ACTIONS } from '@shared/costing.js'
import { usePickers, SearchPick, penceText, unitLabel } from './shared'

const STATE_LOOK = {
  rule: { icon: CheckCircle2, label: 'Has a rule', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  default: { icon: CircleDashed, label: 'Follows its group', cls: 'bg-muted text-muted-foreground border-border' },
  gap: { icon: AlertTriangle, label: 'Needs a rule', cls: 'bg-amber-50 text-amber-900 border-amber-200' },
}
const TYPE_WORDS = { addition: 'Adds to the recipe', side: 'A side', modification: 'Changes the dish' }

export function StateBadge({ state }) {
  const look = STATE_LOOK[state] || STATE_LOOK.default
  const Icon = look.icon
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap', look.cls)} data-state={state}>
      <Icon className="w-3.5 h-3.5" />{look.label}
    </span>
  )
}

// ── The Options tab ───────────────────────────────────────────

export function OptionList({ onOpen }) {
  const api = useApi()
  const { data, isLoading, error } = useQuery({ queryKey: ['recipe-options'], queryFn: () => api.get('/recipe-options') })
  const [show, setShow] = useState('')
  if (isLoading) return <div className="py-12 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" /></div>
  if (error) return <ErrorNote error={error} />
  const c = data.counts
  return (
    <div className="space-y-4" data-testid="option-list">
      <p className="text-sm text-muted-foreground">
        What each option in your option groups does to a dish&apos;s recipe. A rule here is for every dish with the option; a dish can
        have its own (open the dish from the Dishes tab). An option with no rule follows its group&apos;s type: additions and sides need one.
      </p>
      <div className="flex flex-wrap gap-2" data-testid="option-states">
        {[['', 'Every option', c.options], ['gap', 'Need a rule', c.gap], ['rule', 'Have a rule', c.rule], ['default', 'Follow their group', c.default]].map(([k, label, n]) => (
          <button key={k || 'all'} type="button" onClick={() => setShow(k)} aria-pressed={show === k}
            className={cn('h-12 px-4 rounded-full border text-sm touch-manipulation', show === k ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted')}>
            {label} <span className="tabular-nums opacity-80">{n}</span>
          </button>
        ))}
      </div>
      {!data.groups.length && <Card title="No option groups yet"><p className="text-sm text-muted-foreground">Option groups are made on the Menus page (Option groups).</p></Card>}
      {data.groups.map(g => {
        const opts = g.options.filter(o => !show || o.state === show)
        if (!opts.length) return null
        return (
          <Card key={g.id} title={g.name + (g.variation_type ? ' · ' + TYPE_WORDS[g.variation_type] : '')} bodyClass="p-0">
            <ul className="divide-y">
              {opts.map(o => (
                <li key={o.id}>
                  <button type="button" onClick={() => onOpen(o.id)} data-testid="option-row" data-name={o.label}
                    className="w-full text-left px-4 py-2 min-h-[56px] flex flex-wrap items-center gap-x-3 gap-y-1 hover:bg-muted/50 touch-manipulation">
                    <span className="flex-1 min-w-[10rem]">
                      <span className="font-medium">{o.label}</span>
                      {o.price_pence > 0 && <span className="text-xs text-muted-foreground"> {penceText(o.price_pence)}</span>}
                      <span className="block text-xs text-muted-foreground">
                        {o.rule ? o.rule.text : o.default_text}
                        {o.exceptions ? ' · ' + o.exceptions + (o.exceptions === 1 ? ' dish has its own' : ' dishes have their own') : ''}
                      </span>
                    </span>
                    <StateBadge state={o.state} />
                  </button>
                </li>
              ))}
            </ul>
            <p className="px-4 py-2 text-xs text-muted-foreground border-t">{g.dishes} {g.dishes === 1 ? 'dish has' : 'dishes have'} this group</p>
          </Card>
        )
      })}
    </div>
  )
}

// ── One option ────────────────────────────────────────────────

export function OptionEditor({ optionId, onClose, onOpenDish, canManage }) {
  const api = useApi()
  const { data, isLoading, error } = useQuery({ queryKey: ['recipe-option', optionId], queryFn: () => api.get('/recipe-options/options/' + optionId) })
  const [editing, setEditing] = useState(null)
  if (isLoading) return <div className="py-12 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" /></div>
  if (error) return <ErrorNote error={error} />
  const o = data.option
  return (
    <div className="space-y-4" data-testid="option-editor">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={cn(btn.outline, 'h-12')} onClick={onClose} data-testid="option-back"><ArrowLeft className="w-4 h-4" />Options</button>
        <h2 className="text-lg font-semibold flex-1 min-w-[10rem]">{o.label}</h2>
        <StateBadge state={data.state} />
      </div>
      <p className="text-sm text-muted-foreground">
        In {o.group}{o.variation_type ? ' (' + TYPE_WORDS[o.variation_type].toLowerCase() + ')' : ''}{o.price_pence > 0 ? ', ' + penceText(o.price_pence) : ''}.
        {' '}With no rule: {String(data.default_text || '').toLowerCase()}.
      </p>
      <Card title="What it does to every dish">
        <RuleForm target={{ option_id: o.id, dish_id: null, option_label: null }} rule={data.rule} canManage={canManage}
          invalidate={[['recipe-option', optionId], ['recipe-options']]} testid="option-rule" />
      </Card>
      <Card title={'Dishes with ' + o.group} bodyClass="p-0">
        {!data.dishes.length ? <p className="p-4 text-sm text-muted-foreground">No dish has this option group yet.</p> : (
          <ul className="divide-y" data-testid="option-dishes">
            {data.dishes.map(d => (
              <li key={d.id} className="px-4 py-2 min-h-[56px] flex flex-wrap items-center gap-2">
                <span className="flex-1 min-w-[10rem]">
                  <span className="font-medium">{d.name}</span>
                  <span className="block text-xs text-muted-foreground">{[d.menu, d.section].filter(Boolean).join(' · ')} · {d.rule_from === 'dish' ? 'its own rule' : d.rule_from === 'option' ? 'the rule above' : 'its group\'s default'}</span>
                </span>
                {canManage && <button type="button" className={cn(btn.outline, 'h-12')} onClick={() => setEditing(d)} data-testid="option-dish-rule">{d.rule_from === 'dish' ? 'Change its own' : 'Give it its own'}</button>}
                <button type="button" className={cn(btn.ghost, 'h-12')} onClick={() => onOpenDish(d.id)}>Open dish</button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {editing && (
        <RuleModal title={o.label + ' on ' + editing.name} target={{ option_id: o.id, dish_id: editing.id, option_label: null }}
          rule={data.exceptions.find(x => x.dish_id === editing.id) || null} canManage={canManage}
          invalidate={[['recipe-option', optionId], ['recipe-options'], ['recipe-dish', editing.id]]} onClose={() => setEditing(null)} />
      )}
    </div>
  )
}

// ── A rule, edited ────────────────────────────────────────────

const blankRule = { action: 'nothing', item_id: null, sub_recipe_id: null, swap_item_id: null, qty: null, unit: null, factor: null, recipe_id: null, note: '' }
const ruleOf = r => (r ? {
  action: r.action, item_id: r.item_id, sub_recipe_id: r.sub_recipe_id, swap_item_id: r.swap_item_id, qty: r.qty == null ? null : Number(r.qty),
  unit: r.unit, factor: r.factor == null ? null : Number(r.factor), recipe_id: r.recipe_id, note: r.note || '',
} : blankRule)

/** The rule for one option (target: { option_id, dish_id, option_label }), saved whole with its own button. */
export function RuleForm({ target, rule, canManage, invalidate = [], onSaved, testid = 'rule-form' }) {
  const api = useApi()
  const qc = useQueryClient()
  const { data: pickers } = usePickers()
  const [d, setD] = useState(() => ruleOf(rule))
  useEffect(() => { setD(ruleOf(rule)) }, [rule?.id, rule?.updated_at])
  const dirty = JSON.stringify(d) !== JSON.stringify(ruleOf(rule))
  const set = patch => setD(x => ({ ...x, ...patch }))
  const items = useMemo(() => (pickers?.items || []).map(i => ({ id: i.id, name: i.name, hint: 'in ' + i.unit_choices.map(unitLabel).join(', '), units: i.unit_choices })), [pickers])
  const preps = useMemo(() => (pickers?.recipes || []).map(r => ({ id: r.id, name: r.name, hint: 'prep, made in ' + unitLabel(r.yield_unit), units: r.unit_choices })), [pickers])
  const dishes = useMemo(() => (pickers?.dishes || []).filter(r => r.is_active).map(r => ({ id: r.id, name: r.name, hint: 'dish recipe' })), [pickers])
  const after = () => { for (const k of invalidate) qc.invalidateQueries({ queryKey: k }); qc.invalidateQueries({ queryKey: ['menu-margins'] }) }
  const save = useMutation({
    mutationFn: () => api.put('/recipe-options/rules', {
      ...target, action: d.action, item_id: d.item_id || null, sub_recipe_id: d.sub_recipe_id || null, swap_item_id: d.swap_item_id || null,
      qty: d.qty ?? null, unit: d.unit || null, factor: d.factor ?? null, recipe_id: d.recipe_id || null, note: (d.note || '').trim() || null,
    }),
    onSuccess: r => { after(); onSaved?.(r) },
  })
  const del = useMutation({ mutationFn: () => api.delete('/recipe-options/rules/' + rule.id), onSuccess: () => { after(); onSaved?.(null) } })
  const lineUnits = d.action === 'swap' ? items.find(i => i.id === d.swap_item_id)?.units
    : d.sub_recipe_id ? preps.find(p => p.id === d.sub_recipe_id)?.units : items.find(i => i.id === d.item_id)?.units
  const edit = canManage
  const actionHint = RULE_ACTIONS.find(a => a.key === d.action)?.hint
  return (
    <div className="space-y-3" data-testid={testid}>
      {!rule && <p className="text-xs text-muted-foreground">No rule yet: it follows its group until one is saved.</p>}
      <Field label="What it does" group>
        <div className="flex flex-wrap gap-2" data-testid="rule-action">
          {RULE_ACTIONS.map(a => (
            <button key={a.key} type="button" disabled={!edit} aria-pressed={d.action === a.key} data-value={a.key}
              onClick={() => set({ ...blankRule, note: d.note, action: a.key, item_id: ['add', 'remove', 'swap'].includes(a.key) ? d.item_id : null })}
              className={cn('h-12 px-4 rounded-lg border text-sm touch-manipulation disabled:opacity-60', d.action === a.key ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted')}>
              {a.label}
            </button>
          ))}
        </div>
      </Field>
      {actionHint && <p className="text-xs text-muted-foreground">{actionHint}</p>}
      {d.action === 'add' && (
        <>
          <Field label="An item or a prep recipe" group>
            <Segmented value={d.sub_recipe_id ? 'prep' : 'item'} disabled={!edit} onChange={v => set({ item_id: null, sub_recipe_id: null, unit: null, ...(v === 'prep' ? { sub_recipe_id: '' } : {}) })}
              options={[{ value: 'item', label: 'Item' }, { value: 'prep', label: 'Prep recipe' }]} className="[&>button]:h-12" />
          </Field>
          {d.sub_recipe_id != null
            ? <SearchPick options={preps} value={d.sub_recipe_id || null} onChange={v => set({ sub_recipe_id: v ?? '', unit: null })} placeholder="Search prep recipes" disabled={!edit} testid="rule-prep" />
            : <SearchPick options={items} value={d.item_id} onChange={v => set({ item_id: v, unit: null })} placeholder="Search inventory items" disabled={!edit} testid="rule-item" />}
          <QtyUnit d={d} set={set} units={lineUnits} edit={edit} />
        </>
      )}
      {(d.action === 'remove' || d.action === 'swap') && (
        <Field label={d.action === 'remove' ? 'The item it takes out' : 'The item it swaps'} group>
          <SearchPick options={items} value={d.item_id} onChange={v => set({ item_id: v })} placeholder="Search inventory items" disabled={!edit} testid="rule-item" />
        </Field>
      )}
      {d.action === 'swap' && (
        <>
          <Field label="For" group>
            <SearchPick options={items} value={d.swap_item_id} onChange={v => set({ swap_item_id: v, unit: null })} placeholder="Search inventory items" disabled={!edit} testid="rule-swap" />
          </Field>
          <p className="text-xs text-muted-foreground">Leave the quantity empty to use as much as the recipe uses of the item swapped.</p>
          <QtyUnit d={d} set={set} units={lineUnits} edit={edit} optional />
        </>
      )}
      {d.action === 'scale' && (
        <Field label="The recipe times" hint="Large: 1.5; small: 0.75.">
          <NumInput value={d.factor} onChange={v => set({ factor: v })} disabled={!edit} className="h-12 w-32" aria-label="Scale" data-testid="rule-factor" />
        </Field>
      )}
      {d.action === 'recipe' && (
        <>
          <Field label="Its recipe" group>
            <SearchPick options={dishes} value={d.recipe_id} onChange={v => set({ recipe_id: v })} placeholder="Search dish recipes" disabled={!edit} testid="rule-recipe" />
          </Field>
          <Field label="Portions" hint="Empty is one portion.">
            <NumInput value={d.qty} onChange={v => set({ qty: v })} disabled={!edit} className="h-12 w-32" aria-label="Portions" />
          </Field>
        </>
      )}
      <Field label="Note">
        <input className={cn(inputCls, 'h-12')} value={d.note} maxLength={500} disabled={!edit} onChange={e => set({ note: e.target.value })} />
      </Field>
      <ErrorNote error={save.error || del.error} />
      {edit && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={cn(btn.primary, 'h-12')} disabled={!dirty || save.isPending} onClick={() => save.mutate()} data-testid="rule-save">
            {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />}Save rule
          </button>
          {rule && <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">Take the rule off <ConfirmDelete label="Delete rule" onConfirm={() => del.mutate()} disabled={del.isPending} big /></span>}
        </div>
      )}
    </div>
  )
}

function QtyUnit({ d, set, units = [], edit, optional = false }) {
  const list = units && units.length ? units : []
  return (
    <div className="flex flex-wrap gap-3 items-end">
      <Field label={optional ? 'Quantity (optional)' : 'Quantity'}>
        <NumInput value={d.qty} onChange={v => set({ qty: v })} disabled={!edit} className="h-12 w-32" aria-label="Quantity" data-testid="rule-qty" />
      </Field>
      <Field label="Unit">
        <select className={cn(inputCls, 'h-12 w-40')} value={d.unit || ''} disabled={!edit} onChange={e => set({ unit: e.target.value || null })} data-testid="rule-unit">
          <option value="">{list.length ? 'Pick a unit' : 'Pick the item first'}</option>
          {list.map(u => <option key={u} value={u}>{unitLabel(u)}</option>)}
          {d.unit && !list.includes(d.unit) && <option value={d.unit}>{d.unit}</option>}
        </select>
      </Field>
    </div>
  )
}

/** The rule form in a window (a dish's own rule, from the option editor or the dish matrix). */
export function RuleModal({ title, target, rule, canManage, invalidate, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full sm:max-w-xl bg-background rounded-t-2xl sm:rounded-2xl shadow-xl flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b">
          <h2 className="text-sm font-semibold truncate">{title}</h2>
          <button type="button" onClick={onClose} className="h-12 min-w-[48px] px-3 rounded-lg text-sm text-muted-foreground hover:bg-muted touch-manipulation">Close</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <RuleForm target={target} rule={rule} canManage={canManage} invalidate={invalidate} onSaved={onClose} testid="rule-modal" />
        </div>
      </div>
    </div>
  )
}
