// src/components/recipes/RecipeEditor.jsx
//
// One recipe on the Recipes page (inventory phase 1): what it is and makes,
// its lines (inventory items and prep recipes, each a quantity in a unit the
// thing knows, an optional yield of its own, a note; dragged into order),
// its method and photo, and beside them what it costs at the venue picked:
// per portion or per unit, each line, the gaps with how to fix each, and the
// step by step explanation (Costing view). The cost follows the lines while
// they are changed (POST /recipes/preview), before anything is saved.
//
// Each part has its own Save; a save sends the whole recipe (PUT, rule 13):
// that part as changed, the rest as stored, so another part's changes not
// yet saved stay where they are. A new recipe starts with its details only.

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Loader2, Plus, Copy, Layers, AlertTriangle, Search, X, Package, ChefHat } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Field, inputCls, ErrorNote, ConfirmDelete, Segmented, SortableRows } from '@/components/staff/shared'
import { Card, NumInput, Toggle, btn } from '@/components/purchasing/shared'
import { PicturePick } from '@/components/media/PicturePick'
import { KINDS, YIELD_UNITS } from '@shared/costing.js'
import {
  CoverageBadge, KindBadge, CostAt, pounds, perLabel, unitLabel, makesText, usePickers, detailsOf, linesOf, methodOf, lineKey,
  saveBody, sameLines, sameObj, BASES,
} from './shared'

const NEW_DETAILS = {
  name: '', kind: 'dish', category: '', code: '', status: 'draft', yield_qty: null, yield_unit: '', portions: 1, loss_pct: 0,
  shelf_life_hours: null, variant_of: '', notes: '', is_active: true,
}

export function RecipeEditor({ id, venueId, basis, onVenue, onBasis, onOpen, onClose, canManage }) {
  const api = useApi()
  const qc = useQueryClient()
  const query = new URLSearchParams({ ...(venueId ? { venue_id: venueId } : {}), ...(basis !== 'standard' ? { basis } : {}) }).toString()
  const key = ['recipe', id, venueId, basis]
  const { data: server, isLoading, error } = useQuery({
    queryKey: key, queryFn: () => api.get('/recipes/' + id + (query ? '?' + query : '')), enabled: !!id, placeholderData: prev => prev,
  })
  const { data: pickers } = usePickers()

  // The three parts' drafts, each from the stored recipe until changed.
  const [details, setDetails] = useState(null)
  const [lines, setLines] = useState(null)
  const [method, setMethod] = useState(null)
  const [stored, setStored] = useState(null)
  useEffect(() => {
    if (!server) return
    // A part not changed follows what is stored; a changed one keeps its changes.
    setDetails(d => (!d || !stored || sameObj(d, detailsOf(stored)) ? detailsOf(server) : d))
    setLines(l => (!l || !stored || sameLines(l, linesOf(stored)) ? linesOf(server) : l))
    setMethod(m => (!m || !stored || sameObj(m, methodOf(stored)) ? methodOf(server) : m))
    setStored(server)
  }, [server])

  const detailsDirty = !!(server && details && !sameObj(details, detailsOf(server)))
  const linesDirty = !!(server && lines && !sameLines(lines, linesOf(server)))
  const methodDirty = !!(server && method && !sameObj(method, methodOf(server)))

  const save = useMutation({
    mutationFn: ({ parts }) => api.put('/recipes/' + id + (query ? '?' + query : ''), saveBody(server, parts)),
    onSuccess: (saved, { part }) => {
      // The saved part starts again from what is stored; the others keep their drafts.
      if (part === 'details') setDetails(detailsOf(saved))
      if (part === 'lines') setLines(linesOf(saved))
      if (part === 'method') setMethod(methodOf(saved))
      qc.setQueryData(key, saved)
      qc.invalidateQueries({ queryKey: ['recipes'] })
      qc.invalidateQueries({ queryKey: ['recipe-pickers'] })
    },
  })
  const saving = part => save.isPending && save.variables?.part === part

  // The live cost of the lines and details as changed (nothing saved).
  const draftBody = server && (linesDirty || detailsDirty) ? { id, ...saveBody(server, { details, lines }) } : null
  const draftKey = draftBody ? JSON.stringify(draftBody) : ''
  const [debounced, setDebounced] = useState('')
  useEffect(() => { const t = setTimeout(() => setDebounced(draftKey), 350); return () => clearTimeout(t) }, [draftKey])
  const preview = useQuery({
    queryKey: ['recipe-preview', venueId, basis, debounced], enabled: !!debounced,
    queryFn: () => api.post('/recipes/preview' + (query ? '?' + query : ''), JSON.parse(debounced)),
    placeholderData: prev => prev,
  })
  const live = draftBody && preview.data ? preview.data : server

  if (!id) return <NewRecipe onClose={onClose} onCreated={onOpen} />
  if (isLoading || !server || !details || !lines || !method) {
    return error ? <ErrorNote error={error} /> : <div className="py-16 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" /></div>
  }
  const costs = !!server.can?.costs
  const edit = canManage && !!server.can?.manage

  return (
    <div className="space-y-4" data-testid="recipe-editor">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={cn(btn.outline, 'h-12')} onClick={onClose} data-testid="recipe-back">
          <ArrowLeft className="w-4 h-4" />Recipes
        </button>
        <h2 className="text-lg font-semibold flex-1 min-w-[10rem] break-words" data-testid="recipe-title">{server.name}</h2>
        <KindBadge kind={server.kind} />
        <CoverageBadge coverage={live.coverage} />
        {edit && <CopyButtons recipe={server} onOpen={onOpen} />}
      </div>
      {costs && (
        <div className="rounded-xl border bg-background p-3">
          <CostAt venueId={venueId} basis={basis} onVenue={onVenue} onBasis={onBasis} testid="recipe-editor-cost-at" />
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px] items-start">
        <div className="space-y-4 min-w-0">
          <LinesCard value={lines} onChange={setLines} recipe={server} live={live} costs={costs} edit={edit} dirty={linesDirty}
            pickers={pickers} saving={saving('lines')} previewing={preview.isFetching}
            onSave={() => save.mutate({ part: 'lines', parts: { lines } })}
            error={save.variables?.part === 'lines' ? save.error : null} />
          <DetailsCard value={details} onChange={setDetails} recipe={server} edit={edit} dirty={detailsDirty} pickers={pickers}
            saving={saving('details')} onSave={() => save.mutate({ part: 'details', parts: { details } })}
            error={save.variables?.part === 'details' ? save.error : null} />
          <MethodCard value={method} onChange={setMethod} edit={edit} dirty={methodDirty} saving={saving('method')}
            onSave={() => save.mutate({ part: 'method', parts: { method } })}
            error={save.variables?.part === 'method' ? save.error : null} />
        </div>
        <div className="space-y-4 lg:sticky lg:top-4">
          <CostCard recipe={server} live={live} costs={costs} changed={!!draftBody} venueId={venueId} basis={basis} />
          <UsedCard recipe={server} onOpen={onOpen} />
          {edit && <EndCard recipe={server} onClose={onClose} />}
        </div>
      </div>
    </div>
  )
}

// ── A new recipe: its details, then the editor ─────────────────

function NewRecipe({ onClose, onCreated }) {
  const api = useApi()
  const qc = useQueryClient()
  const [d, setD] = useState(NEW_DETAILS)
  const create = useMutation({
    mutationFn: () => {
      const b = saveBody({ ...NEW_DETAILS, lines: [], method: null, photo_url: null }, { details: d })
      return api.post('/recipes', b)
    },
    onSuccess: r => { qc.invalidateQueries({ queryKey: ['recipes'] }); qc.invalidateQueries({ queryKey: ['recipe-pickers'] }); onCreated(r.id) },
  })
  return (
    <div className="space-y-4 max-w-3xl">
      <button type="button" className={cn(btn.outline, 'h-12')} onClick={onClose}><ArrowLeft className="w-4 h-4" />Recipes</button>
      <DetailsCard value={d} onChange={setD} recipe={null} edit dirty saving={create.isPending} onSave={() => create.mutate()}
        saveLabel="Create" error={create.error} />
      <p className="text-sm text-muted-foreground">Once it is made, add what goes into it, the method and a photo.</p>
    </div>
  )
}

function CopyButtons({ recipe, onOpen }) {
  const api = useApi()
  const qc = useQueryClient()
  const copy = useMutation({
    mutationFn: variant => api.post('/recipes/' + recipe.id + '/copy', { variant }),
    onSuccess: r => { qc.invalidateQueries({ queryKey: ['recipes'] }); onOpen(r.id) },
  })
  return (
    <span className="inline-flex flex-wrap gap-2">
      <button type="button" className={cn(btn.outline, 'h-12')} disabled={copy.isPending} onClick={() => copy.mutate(false)} data-testid="recipe-copy">
        <Copy className="w-4 h-4" />Copy
      </button>
      <button type="button" className={cn(btn.outline, 'h-12')} disabled={copy.isPending} onClick={() => copy.mutate(true)}
        title="A version of this recipe for another way of selling it or another venue (a takeaway, a smaller kitchen)" data-testid="recipe-variation">
        <Layers className="w-4 h-4" />Make a variation
      </button>
      {copy.error && <ErrorNote error={copy.error} />}
    </span>
  )
}

// ── Details ───────────────────────────────────────────────────

function SaveButton({ dirty, saving, onSave, disabled, label = 'Save', testid }) {
  return (
    <button type="button" className={cn(btn.primary, 'h-12')} disabled={!dirty || saving || disabled} onClick={onSave} data-testid={testid}>
      {saving && <Loader2 className="w-4 h-4 animate-spin" />}{label}
    </button>
  )
}

function DetailsCard({ value: d, onChange, recipe, edit, dirty, saving, onSave, error, pickers, saveLabel = 'Save' }) {
  const set = (k, v) => onChange({ ...d, [k]: v })
  const heads = (pickers?.heads || []).filter(r => r.id !== recipe?.id)
  const problem = !d.name.trim() ? 'Give it a name'
    : d.kind === 'prep' && d.yield_qty != null && !(d.yield_qty > 0) ? 'What it makes is more than nothing'
    : d.kind === 'prep' && d.yield_qty > 0 && !d.yield_unit ? 'Say what it is made in'
    : d.loss_pct != null && (d.loss_pct < 0 || d.loss_pct >= 100) ? 'Lost in cooking is under 100%'
    : null
  return (
    <Card title="Recipe" actions={edit && <SaveButton dirty={dirty} saving={saving} onSave={onSave} disabled={!!problem} label={saveLabel} testid="recipe-details-save" />}>
      <fieldset disabled={!edit} className="space-y-3 min-w-0">
        <Field label="Name">
          <input className={cn(inputCls, 'h-12')} value={d.name} maxLength={200} onChange={e => set('name', e.target.value)} data-testid="recipe-name" />
        </Field>
        <Field label="Kind" group hint={KINDS.find(k => k.key === d.kind)?.hint}>
          <Segmented value={d.kind} onChange={v => set('kind', v)} options={KINDS.map(k => ({ value: k.key, label: k.label }))}
            className="[&>button]:h-12" testid="recipe-kind-pick" />
        </Field>
        {d.kind === 'dish' ? (
          <Field label="Portions it makes" hint="Its cost is per portion">
            <NumInput value={d.portions} onChange={v => set('portions', v)} className="h-12 w-32" data-testid="recipe-portions" />
          </Field>
        ) : (
          <div className="grid sm:grid-cols-3 gap-3">
            <Field label="It makes">
              <NumInput value={d.yield_qty} onChange={v => set('yield_qty', v)} className="h-12" data-testid="recipe-yield-qty" />
            </Field>
            <Field label="Made in">
              <select className={cn(inputCls, 'h-12')} value={d.yield_unit} onChange={e => set('yield_unit', e.target.value)} data-testid="recipe-yield-unit">
                <option value="">Pick one</option>
                {YIELD_UNITS.map(u => <option key={u} value={u}>{unitLabel(u)}</option>)}
              </select>
            </Field>
            <Field label="Lost in cooking (%)" hint="A stock that reduces by a quarter: 25">
              <NumInput value={d.loss_pct} onChange={v => set('loss_pct', v)} className="h-12" data-testid="recipe-loss" />
            </Field>
          </div>
        )}
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Category">
            <input className={cn(inputCls, 'h-12')} value={d.category} maxLength={100} list="recipe-categories" onChange={e => set('category', e.target.value)} />
            <datalist id="recipe-categories">{(pickers?.categories || []).map(c => <option key={c} value={c} />)}</datalist>
          </Field>
          <Field label="Code" hint="Your own, optional">
            <input className={cn(inputCls, 'h-12')} value={d.code} maxLength={60} onChange={e => set('code', e.target.value)} />
          </Field>
          <Field label="Keeps for (hours)" hint="Once made, optional">
            <NumInput value={d.shelf_life_hours} onChange={v => set('shelf_life_hours', v == null ? null : Math.round(v))} className="h-12" />
          </Field>
        </div>
        <Field label="Status" group hint="A draft is still being worked on; live is the one the kitchen follows">
          <Segmented value={d.status} onChange={v => set('status', v)} options={[{ value: 'draft', label: 'Draft' }, { value: 'live', label: 'Live' }]}
            className="[&>button]:h-12" testid="recipe-status" />
        </Field>
        {recipe && (
          <Field label="A variation of" hint="A version for another way of selling it or another venue; listed under the recipe it varies">
            <select className={cn(inputCls, 'h-12')} value={d.variant_of} onChange={e => set('variant_of', e.target.value)} data-testid="recipe-variant-of">
              <option value="">None: its own recipe</option>
              {heads.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Notes">
          <textarea rows={2} className={cn(inputCls, 'h-auto py-2')} value={d.notes} maxLength={2000} onChange={e => set('notes', e.target.value)} />
        </Field>
        {recipe && <Toggle checked={d.is_active} onChange={v => set('is_active', v)} label="In use (off = kept, but out of the list)" />}
        {problem && dirty && <p className="text-xs text-destructive">{problem}</p>}
        <ErrorNote error={error} />
      </fieldset>
    </Card>
  )
}

// ── Lines ─────────────────────────────────────────────────────

function LinesCard({ value, onChange, recipe, live, costs, edit, dirty, pickers, saving, previewing, onSave, error }) {
  const items = useMemo(() => new Map((pickers?.items || []).map(i => [i.id, i])), [pickers])
  const preps = useMemo(() => new Map((pickers?.recipes || []).map(r => [r.id, r])), [pickers])
  const liveLines = live?.lines || []
  const nesting = live?.nesting
  const update = (key, changes) => onChange(value.map(l => (l.key === key ? { ...l, ...changes } : l)))
  const add = line => onChange([...value, { key: lineKey(), qty: 1, yield_pct: null, note: '', ...line }])
  const bad = value.some(l => !(Number(l.qty) > 0) || !l.unit)
  // SortableRows keeps its own order from these: the same list until the lines change.
  const rows = useMemo(() => value.map(l => ({ ...l, id: l.key })), [value])
  return (
    <Card title={'What goes into it' + (value.length ? ' (' + value.length + ')' : '')}
      actions={<span className="inline-flex items-center gap-2">
        {previewing && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" aria-label="Working out the cost" />}
        {edit && <SaveButton dirty={dirty} saving={saving} onSave={onSave} disabled={bad || !!nesting} testid="recipe-lines-save" />}
      </span>}
      bodyClass="p-0">
      {!value.length && <p className="p-4 text-sm text-muted-foreground">Nothing yet. Add the inventory items and prep recipes it uses.</p>}
      {value.length > 0 && (
        <div className="p-2" data-testid="recipe-lines">
          <SortableRows items={rows} locked={!edit}
            onReorder={keys => onChange(keys.map(k => value.find(l => l.key === k)))}
            renderItem={l => {
              const i = value.findIndex(x => x.key === l.key)
              return <LineRow line={l} live={liveLines[i]} item={items.get(l.item_id)} prep={preps.get(l.sub_recipe_id)} costs={costs} edit={edit}
                onChange={c => update(l.key, c)} onRemove={() => onChange(value.filter(x => x.key !== l.key))} />
            }} />
        </div>
      )}
      {nesting && <p className="mx-4 mb-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm px-3 py-2" data-testid="recipe-nesting">{nesting.message}</p>}
      {edit && <AddLine pickers={pickers} recipeId={recipe.id} onAdd={add} />}
      {dirty && <p className="px-4 pb-3 text-xs text-muted-foreground">Not saved yet: the cost beside shows the lines as changed.</p>}
      <div className="px-4 pb-3"><ErrorNote error={error} /></div>
    </Card>
  )
}

function LineRow({ line, live, item, prep, costs, edit, onChange, onRemove }) {
  const thing = item || prep
  const choices = item ? item.unit_choices : prep ? prep.unit_choices : []
  const units = choices.includes(line.unit) ? choices : [line.unit, ...choices]
  const known = choices.some(u => u.toLowerCase() === String(line.unit).toLowerCase())
  const name = thing?.name || live?.name || (line.item_id ? 'An item' : 'A recipe')
  return (
    <div className="flex-1 min-w-0 py-1 space-y-1" data-testid="recipe-line" data-name={name}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex-1 min-w-[9rem] flex items-center gap-1.5 text-sm font-medium">
          {line.sub_recipe_id ? <ChefHat className="w-4 h-4 text-sky-700 shrink-0" aria-label="A prep recipe" /> : <Package className="w-4 h-4 text-muted-foreground shrink-0" aria-label="An inventory item" />}
          <span className="break-words">{name}</span>
          {thing?.is_active === false && <span className="text-xs text-muted-foreground">(switched off)</span>}
        </span>
        <NumInput value={line.qty} onChange={v => onChange({ qty: v })} disabled={!edit} className="h-12 w-20" aria-label={'How much ' + name} data-testid="recipe-line-qty" />
        <select className={cn(inputCls, 'h-12 w-24', !known && 'border-amber-400')} value={line.unit} disabled={!edit} onChange={e => onChange({ unit: e.target.value })}
          aria-label={'Unit for ' + name} data-testid="recipe-line-unit">
          {units.map(u => <option key={u} value={u}>{unitLabel(u)}{choices.includes(u) ? '' : ' (no size)'}</option>)}
        </select>
        {line.item_id && (
          <NumInput value={line.yield_pct} onChange={v => onChange({ yield_pct: v })} disabled={!edit} className="h-12 w-20"
            placeholder={(item?.yield_pct ?? 100) + '%'} aria-label={'Yield for ' + name + ', usable %'} title="Usable %: leave empty for the item's own" />
        )}
        {costs && (
          <span className="w-20 text-right text-sm tabular-nums" data-testid="recipe-line-cost">
            {live?.cost != null ? pounds(live.cost) : <AlertTriangle className="w-4 h-4 text-amber-600 inline" aria-label="Not costed" />}
          </span>
        )}
        {edit && <ConfirmDelete label={'Take ' + name + ' out'} confirmLabel="Take out" onConfirm={onRemove} />}
      </div>
      {(edit || line.note) && (
        <input className={cn(inputCls, 'h-10 text-xs')} value={line.note} disabled={!edit} maxLength={500} placeholder="Note (optional): diced, to garnish"
          onChange={e => onChange({ note: e.target.value })} aria-label={'Note for ' + name} />
      )}
      {live?.problem && !costs && <p className="text-xs text-amber-800">Not costed: {problemWords(live.problem)}</p>}
    </div>
  )
}

const problemWords = p => ({
  no_price: 'no supplier price', no_receipts: 'nothing booked in here yet', no_unit: 'no size for that unit',
  missing: 'it is gone', empty: 'it has nothing in it', no_yield: 'it doesn\'t say what it makes', sub_partial: 'only partly costed',
  cycle: 'it is inside itself', too_deep: 'nested too deep',
}[p] || p)

function AddLine({ pickers, recipeId, onAdd }) {
  const [q, setQ] = useState('')
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const hits = !words.length ? [] : [
    ...(pickers?.items || []).filter(i => i.is_active !== false).map(i => ({ kind: 'item', ...i })),
    ...(pickers?.recipes || []).filter(r => r.id !== recipeId && r.is_active !== false).map(r => ({ kind: 'recipe', ...r })),
  ].filter(x => words.every(w => x.name.toLowerCase().includes(w))).slice(0, 8)
  const pick = x => {
    if (x.kind === 'item') onAdd({ item_id: x.id, sub_recipe_id: null, unit: x.recipe_unit || x.base_unit })
    else onAdd({ item_id: null, sub_recipe_id: x.id, unit: x.yield_unit || x.unit_choices?.[0] || 'portion' })
    setQ('')
  }
  return (
    <div className="px-4 pb-3 space-y-2">
      <label className="relative block">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input className={cn(inputCls, 'h-12 pl-9 pr-10')} value={q} onChange={e => setQ(e.target.value)} placeholder="Add an inventory item or a prep recipe"
          aria-label="Add an inventory item or a prep recipe" data-testid="recipe-add-search" />
        {q && <button type="button" onClick={() => setQ('')} aria-label="Clear" className="absolute right-0 top-0 h-12 w-12 flex items-center justify-center"><X className="w-4 h-4" /></button>}
      </label>
      {words.length > 0 && (
        <div className="rounded-lg border divide-y" data-testid="recipe-add-results">
          {!hits.length && <p className="p-3 text-sm text-muted-foreground">Nothing called that. Items are added on the Inventory page.</p>}
          {hits.map(x => (
            <button key={x.kind + x.id} type="button" onClick={() => pick(x)} data-testid="recipe-add-hit"
              className="w-full text-left px-3 min-h-[48px] flex items-center gap-2 hover:bg-muted touch-manipulation">
              {x.kind === 'recipe' ? <ChefHat className="w-4 h-4 text-sky-700" /> : <Package className="w-4 h-4 text-muted-foreground" />}
              <span className="flex-1 text-sm">{x.name}</span>
              <span className="text-xs text-muted-foreground">{x.kind === 'recipe' ? 'prep, made in ' + unitLabel(x.yield_unit) : 'item, in ' + x.unit_choices.map(unitLabel).join(', ')}</span>
              <Plus className="w-4 h-4" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Method and photo ──────────────────────────────────────────

function MethodCard({ value: m, onChange, edit, dirty, saving, onSave, error }) {
  return (
    <Card title="Method and photo" actions={edit && <SaveButton dirty={dirty} saving={saving} onSave={onSave} testid="recipe-method-save" />}>
      <div className="flex flex-wrap gap-4 items-start">
        <PicturePick url={m.photo_url} onChange={v => onChange({ ...m, photo_url: v || null })} scope="recipes" size="md" label="photo"
          disabled={!edit} testId="recipe-photo" />
        <Field label="Method">
          <textarea rows={8} className={cn(inputCls, 'h-auto py-2 w-full min-w-[16rem]')} value={m.method} disabled={!edit} maxLength={20000}
            onChange={e => onChange({ ...m, method: e.target.value })} placeholder="1. Melt the butter..." data-testid="recipe-method" />
        </Field>
      </div>
      <ErrorNote error={error} />
    </Card>
  )
}

// ── What it costs ─────────────────────────────────────────────

const FIX_LINK = { no_price: true, no_unit: true }

function CostCard({ recipe, live, costs, changed, venueId, basis }) {
  const where = venueId ? (recipe.venue?.name || 'the venue') : 'the group\'s prices'
  const itemOf = g => live.lines?.[g.line]?.item_id
  return (
    <Card title={changed ? 'What it costs (as changed)' : 'What it costs'}>
      <div className="space-y-3" data-testid="recipe-cost">
        {costs ? (
          <>
            <div>
              <p className="text-3xl font-semibold tabular-nums" data-testid="recipe-per-unit">
                {live.per_unit != null ? pounds(live.per_unit) : 'No cost yet'}
                {live.per_unit != null && <span className="text-sm font-normal text-muted-foreground"> {perLabel(live.unit)}</span>}
              </p>
              <p className="text-xs text-muted-foreground">
                {live.cost != null ? pounds(live.cost) + ' for all of it, ' : ''}{makesText(recipe)} at {where}
                {', ' + (BASES.find(b => b.key === basis)?.label || 'Standard').toLowerCase()}
              </p>
            </div>
            {!changed && recipe.bases && (
              <div className="grid grid-cols-3 gap-2 text-center" data-testid="recipe-bases">
                {BASES.map(b => (
                  <div key={b.key} className={cn('rounded-lg border p-2', b.key === basis && 'border-primary')}>
                    <p className="text-[11px] text-muted-foreground">{b.label}</p>
                    <p className="text-sm font-medium tabular-nums">{recipe.bases[b.key]?.per_unit != null ? pounds(recipe.bases[b.key].per_unit) : '-'}</p>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Costs are shown to people with Costing view.</p>
        )}
        <CoverageBadge coverage={live.coverage} />
        {live.gaps?.length > 0 && (
          <ul className="space-y-2" data-testid="recipe-gaps">
            {live.gaps.map((g, i) => (
              <li key={i} className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm">
                <p className="font-medium text-amber-900">{g.text}</p>
                <p className="text-amber-900/80 text-xs mt-0.5">{g.fix}</p>
                {FIX_LINK[g.reason] && itemOf(g) && (
                  <Link to={'/inventory?item=' + itemOf(g)} className="inline-flex items-center h-10 text-xs font-medium underline">Open it on the Inventory page</Link>
                )}
              </li>
            ))}
          </ul>
        )}
        {costs && live.explanation?.rows?.length > 0 && (
          <details className="group" open data-testid="recipe-explain">
            <summary className="cursor-pointer text-sm font-medium min-h-[44px] flex items-center">How it is worked out</summary>
            <ol className="space-y-2 text-sm">
              {live.explanation.rows.map((r, i) => (
                <li key={i} className={cn('rounded-lg border px-3 py-2', r.kind === 'gap' && 'border-amber-200 bg-amber-50', (r.kind === 'total' || r.kind === 'per_unit') && 'bg-muted/40')}>
                  <div className="flex items-baseline gap-2">
                    <span className="font-medium flex-1">{r.label}</span>
                    {r.amount != null && <span className="tabular-nums font-medium">{pounds(r.amount)}</span>}
                  </div>
                  {r.steps.map((s, j) => <p key={j} className="text-xs text-muted-foreground">{s}</p>)}
                </li>
              ))}
            </ol>
          </details>
        )}
      </div>
    </Card>
  )
}

function UsedCard({ recipe, onOpen }) {
  if (!recipe.used_in?.length && !recipe.variations?.length && !recipe.variant_of_name) return null
  const link = r => (
    <button key={r.id} type="button" onClick={() => onOpen(r.id)} className="text-sm px-3 h-11 rounded-full border hover:bg-muted touch-manipulation">{r.name}</button>
  )
  return (
    <Card title="Where it is used">
      <div className="space-y-3 text-sm">
        {recipe.used_in?.length > 0 && <div><p className="text-xs text-muted-foreground mb-1">Inside</p><div className="flex flex-wrap gap-2">{recipe.used_in.map(link)}</div></div>}
        {recipe.variations?.length > 0 && <div><p className="text-xs text-muted-foreground mb-1">{recipe.variant_of ? 'Its group' : 'Its variations'}</p><div className="flex flex-wrap gap-2">{recipe.variations.map(link)}</div></div>}
      </div>
    </Card>
  )
}

function EndCard({ recipe, onClose }) {
  const api = useApi()
  const qc = useQueryClient()
  const del = useMutation({
    mutationFn: () => api.delete('/recipes/' + recipe.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['recipes'] }); qc.invalidateQueries({ queryKey: ['recipe-pickers'] }); onClose() },
  })
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-1">
      <span className="text-xs text-muted-foreground">{recipe.used_in?.length ? 'Used inside other recipes: switch it off instead.' : 'Delete the recipe and its lines.'}</span>
      <ConfirmDelete label="Delete recipe" onConfirm={() => del.mutate()} disabled={del.isPending} big />
      <ErrorNote error={del.error} />
    </div>
  )
}

