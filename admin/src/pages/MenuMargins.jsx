// src/pages/MenuMargins.jsx
//
// Menu margins (/menu-margins, module costing View; inventory phase 2,
// docs/INVENTORY.md 8.2). Pick a menu, a venue, a revenue stream of it
// (optional) and an order type, live (what is sold now, the default) or the
// draft: every dish with its price there, net of VAT, what it costs (the
// recipe the links pick there), GP in pounds and cost %, coloured against the
// targets; priced options with their own margin, meal deals with the range
// their picks give. Dishes that can't be costed are listed first with how to
// fix each, never hidden. Sort by cost %, GP, name or section. Tapping a dish
// opens its explanation: which recipe and why, the cost steps, the price and
// VAT steps, and a link to its matrix. The targets (Costing manage) are a
// card of their own with its Save. Export CSV. Everything is worked out on
// the server by menuMargins() in shared/costing.js; the page shows it.
// The choices are in the address (?menu= &venue= &stream= &type= &version=).
// API: routes/menuMargins.js, routes/recipeLinks.js (a dish's steps).

import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { BadgePercent, Loader2, Download, AlertTriangle, ChevronRight, Layers, Plus } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { usePermission } from '@/hooks/usePermission'
import { ReadOnlyNotice } from '@/components/ReadOnlyNotice'
import { PageHeader, Segmented, Field, inputCls, ErrorNote, ConfirmDelete } from '@/components/staff/shared'
import { Card, NumInput, Drawer, btn } from '@/components/purchasing/shared'
import { pounds, penceText, pctText, BandBadge, bandWord, CoverageBadge } from '@/components/recipes/shared'

const SORTS = [
  { value: 'cost_pct', label: 'Cost %' }, { value: 'gp', label: 'GP' }, { value: 'name', label: 'Name' }, { value: 'section', label: 'Section' },
]
const KIND_WORDS = { deal: 'Meal deal', goods: 'Goods', service: 'Service' }

export default function MenuMargins() {
  const { canView, canManage, loaded } = usePermission('costing')
  const api = useApi()
  const [params, setParams] = useSearchParams()
  const set = changes => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(changes)) { if (v) next.set(k, v); else next.delete(k) }
    setParams(next, { replace: true })
  }
  const menuId = params.get('menu') || ''
  const venueId = params.get('venue') || ''
  const streamId = params.get('stream') || ''
  const typeId = params.get('type') || ''
  const version = params.get('version') === 'draft' ? 'draft' : 'live'
  const [sort, setSort] = useState('cost_pct')
  const [open, setOpen] = useState(null)
  const choices = useQuery({ queryKey: ['menu-margins', 'choices'], queryFn: () => api.get('/menu-margins'), enabled: !!canView })
  const c = choices.data?.choices
  // Start on the first menu, venue and order type.
  useEffect(() => {
    if (!c) return
    const first = {}
    if (!menuId && c.menus[0]) first.menu = c.menus[0].id
    if (!venueId && c.venues[0]) first.venue = c.venues[0].id
    if (!typeId && c.order_types[0]) first.type = c.order_types[0].id
    if (Object.keys(first).length) set(first)
  }, [c])
  const q = new URLSearchParams({
    ...(menuId ? { menu_id: menuId } : {}), ...(venueId ? { venue_id: venueId } : {}), ...(streamId ? { revenue_stream_id: streamId } : {}),
    ...(typeId ? { order_type_id: typeId } : {}), version,
  }).toString()
  const margins = useQuery({
    queryKey: ['menu-margins', q], queryFn: () => api.get('/menu-margins?' + q), enabled: !!canView && !!menuId, placeholderData: prev => prev,
  })
  const data = margins.data
  const rows = useMemo(() => sortRows(data?.rows || [], sort), [data, sort])
  if (loaded && !canView) {
    return <div className="h-full overflow-y-auto bg-page p-6 text-sm text-muted-foreground">Your role can&apos;t see menu margins: they need Costing view.</div>
  }
  const venue = c?.venues.find(v => v.id === venueId)
  return (
    <div className="h-full overflow-y-auto bg-page" data-testid="margins-page">
      <PageHeader icon={BadgePercent} title="Menu margins">
        {data?.rows?.length > 0 && (
          <button type="button" className={cn(btn.outline, 'h-12')} onClick={() => downloadCsv(data, rows)} data-testid="margins-csv">
            <Download className="w-4 h-4" />Export CSV
          </button>
        )}
      </PageHeader>
      <div className="max-w-6xl mx-auto p-4 space-y-4">
        {loaded && !canManage && <ReadOnlyNotice what="the cost targets" />}
        <Card title="What and where">
          {!c ? <Loader2 className="w-5 h-5 animate-spin" /> : (
            <div className="flex flex-wrap items-end gap-3" data-testid="margins-choices">
              <Field label="Menu">
                <select className={cn(inputCls, 'h-12 w-56')} value={menuId} onChange={e => set({ menu: e.target.value })} data-testid="margins-menu">
                  {c.menus.map(m => <option key={m.id} value={m.id}>{m.name}{m.live ? '' : ' (not live yet)'}</option>)}
                </select>
              </Field>
              <Field label="Venue">
                <select className={cn(inputCls, 'h-12 w-48')} value={venueId} onChange={e => set({ venue: e.target.value, stream: '' })} data-testid="margins-venue">
                  <option value="">The group&apos;s prices</option>
                  {c.venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </Field>
              {venue?.streams?.length > 0 && (
                <Field label="Revenue stream">
                  <select className={cn(inputCls, 'h-12 w-44')} value={streamId} onChange={e => set({ stream: e.target.value })} data-testid="margins-stream">
                    <option value="">Any</option>
                    {venue.streams.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </Field>
              )}
              <Field label="Order type">
                <select className={cn(inputCls, 'h-12 w-40')} value={typeId} onChange={e => set({ type: e.target.value })} data-testid="margins-type">
                  <option value="">Any</option>
                  {c.order_types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </Field>
              <Field label="Menu version" group>
                <Segmented value={version} onChange={v => set({ version: v === 'live' ? '' : v })} options={[{ value: 'live', label: 'Live' }, { value: 'draft', label: 'Draft' }]}
                  className="[&>button]:h-12" testid="margins-version" />
              </Field>
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-3">
            Live is what tills and online sell now; Draft is the menu as it is being edited. A dish has one price on a menu: only its VAT
            changes with the venue, revenue stream and order type, and the recipe it uses can too (its matrix on the Recipes page).
          </p>
        </Card>
        <ErrorNote error={choices.error || margins.error} />
        {data?.message && <Card title="Nothing to show"><p className="text-sm">{data.message}</p></Card>}
        {data?.uncosted?.length > 0 && <UncostedCard list={data.uncosted} />}
        {data?.rows && !data.message && (
          <>
            <Summary data={data} />
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Sort by</span>
              <Segmented value={sort} onChange={setSort} options={SORTS} className="[&>button]:h-12" testid="margins-sort" />
            </div>
            <MarginTable rows={rows} onOpen={setOpen} loading={margins.isFetching} />
          </>
        )}
        {c && <TargetsCard settings={choices.data.settings} sections={data?.sections || []} canManage={canManage} />}
      </div>
      {open && <DishExplain row={open} q={{ venue_id: data?.scope?.venue_id, revenue_stream_id: data?.scope?.revenue_stream_id, order_type_id: data?.scope?.order_type_id, version }}
        where={data?.where} onClose={() => setOpen(null)} />}
    </div>
  )
}

function sortRows(rows, sort) {
  const pct = r => (r.kind === 'deal' ? r.cost_pct_max : r.cost_pct)
  const gp = r => (r.kind === 'deal' ? r.gp_min_pence : r.gp_pence)
  const list = [...rows]
  const nulls = (a, b, f) => (f(a) == null) - (f(b) == null)
  if (sort === 'cost_pct') list.sort((a, b) => nulls(a, b, pct) || (pct(b) ?? 0) - (pct(a) ?? 0))
  else if (sort === 'gp') list.sort((a, b) => nulls(a, b, gp) || (gp(b) ?? 0) - (gp(a) ?? 0))
  else if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name))
  return list
}

function Summary({ data }) {
  const n = data.counts
  const chip = (label, value, cls) => (
    <span className={cn('inline-flex items-center gap-1 h-10 px-3 rounded-full border text-sm', cls)}>{label} <strong className="tabular-nums">{value}</strong></span>
  )
  return (
    <div className="flex flex-wrap gap-2" data-testid="margins-summary">
      {chip('Dishes', n.dishes, 'bg-background')}
      {chip('Over the limit', n.over, 'bg-red-50 border-red-200 text-red-800')}
      {chip('Over target', n.watch, 'bg-amber-50 border-amber-200 text-amber-900')}
      {chip('Partly costed', n.partial, 'bg-background')}
      {chip('Not costed', n.uncosted, 'bg-background')}
      <span className="text-xs text-muted-foreground self-center">{data.where}, {data.menu.version === 'draft' ? 'the draft' : 'live'}</span>
    </div>
  )
}

function UncostedCard({ list }) {
  return (
    <Card title={list.length + (list.length === 1 ? ' dish can\'t be costed yet' : ' dishes can\'t be costed yet')} className="border-amber-300" bodyClass="p-0">
      <ul className="divide-y" data-testid="margins-uncosted">
        {list.map(u => (
          <li key={u.dish_id}>
            <Link to={'/recipes?tab=dishes&dish=' + u.dish_id} className="px-4 py-2 min-h-[56px] flex items-center gap-3 hover:bg-muted/50 touch-manipulation">
              <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
              <span className="flex-1 min-w-0">
                <span className="text-sm font-medium">{u.name}</span> <span className="text-xs text-muted-foreground">{u.section}</span>
                <span className="block text-xs text-muted-foreground">{u.text ? u.text + '. ' : ''}{u.fix}</span>
              </span>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function MarginTable({ rows, onOpen, loading }) {
  return (
    <Card title={loading ? 'Every dish (updating)' : 'Every dish'} bodyClass="p-0">
      <div className="overflow-x-auto" data-testid="margins-table">
        <table className="w-full text-sm min-w-[720px]">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="text-left font-medium px-4 py-2">Dish</th>
              <th className="text-right font-medium px-2 py-2">Price</th>
              <th className="text-right font-medium px-2 py-2">Net of VAT</th>
              <th className="text-right font-medium px-2 py-2">Cost</th>
              <th className="text-right font-medium px-2 py-2">GP</th>
              <th className="text-right font-medium px-4 py-2">Cost %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => <MarginRow key={r.dish_id} r={r} onOpen={onOpen} />)}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function MarginRow({ r, onOpen }) {
  const deal = r.kind === 'deal'
  return (
    <>
      <tr className="border-b hover:bg-muted/40 cursor-pointer" onClick={() => onOpen(r)} data-testid="margins-row" data-name={r.name} data-band={r.band || 'none'}>
        <td className="px-4 py-2">
          <button type="button" className="text-left min-h-[44px] touch-manipulation" onClick={e => { e.stopPropagation(); onOpen(r) }}>
            <span className="font-medium">{r.name}</span>
            {KIND_WORDS[r.kind] && <span className="ml-2 text-xs rounded-full bg-muted px-2 py-0.5">{KIND_WORDS[r.kind]}</span>}
            <span className="block text-xs text-muted-foreground">
              {[r.section, r.recipe ? r.recipe.name + (r.why && r.why !== 'every venue' ? ' (' + r.why + ')' : '') : null].filter(Boolean).join(' · ')}
            </span>
          </button>
        </td>
        <td className="px-2 py-2 text-right tabular-nums">{r.price_pence != null ? (r.price_varies ? 'from ' : '') + penceText(r.price_pence) : '-'}</td>
        <td className="px-2 py-2 text-right tabular-nums">{penceText(r.net_pence)}<span className="block text-[11px] text-muted-foreground">{r.vat_rate}% VAT</span></td>
        <td className="px-2 py-2 text-right tabular-nums">
          {deal ? (r.cost_min != null ? pounds(r.cost_min) + ' to ' + pounds(r.cost_max) : '-')
            : r.cost != null ? pounds(r.cost) : r.coverage === 'not_needed' ? 'Service' : '-'}
          {r.coverage === 'partial' && <span className="block text-[11px] text-amber-800">partly costed</span>}
        </td>
        <td className="px-2 py-2 text-right tabular-nums">{deal ? (r.gp_min_pence != null ? penceText(r.gp_min_pence) + ' to ' + penceText(r.gp_max_pence) : '-') : r.gp_pence != null ? penceText(r.gp_pence) : '-'}</td>
        <td className="px-4 py-2 text-right">
          {deal && r.cost_pct_min != null
            ? <span className="inline-flex flex-wrap justify-end gap-1"><span className="text-xs tabular-nums">{pctText(r.cost_pct_min)} to</span><BandBadge band={r.band} pct={r.cost_pct_max} /></span>
            : <BandBadge band={r.band} pct={r.cost_pct} />}
        </td>
      </tr>
      {(r.options || []).map(o => (
        <tr key={o.key} className="border-b bg-muted/20 text-xs" data-testid="margins-option">
          <td className="pl-10 pr-4 py-1.5"><span className="text-muted-foreground">{o.group}: </span>{o.label}{o.mode === 'base' ? '' : ' (extra)'}
            {o.gaps?.length > 0 && <span className="block text-amber-800">{o.gaps[0].text}</span>}</td>
          <td className="px-2 py-1.5 text-right tabular-nums">{(o.mode === 'extra' ? '+' : '') + penceText(o.price_pence)}</td>
          <td className="px-2 py-1.5 text-right tabular-nums">{penceText(o.net_pence)}</td>
          <td className="px-2 py-1.5 text-right tabular-nums">{o.cost != null ? pounds(o.cost) : '-'}</td>
          <td className="px-2 py-1.5 text-right tabular-nums">{o.gp_pence != null ? penceText(o.gp_pence) : '-'}</td>
          <td className="px-4 py-1.5 text-right"><BandBadge band={o.band} pct={o.cost_pct} /></td>
        </tr>
      ))}
    </>
  )
}

/** One dish's explanation: which recipe and why, the cost steps, the price and VAT steps. */
function DishExplain({ row, q, where, onClose }) {
  const api = useApi()
  const query = new URLSearchParams(Object.fromEntries(Object.entries(q).filter(([, v]) => v))).toString()
  const { data, isLoading, error } = useQuery({ queryKey: ['menu-margins', 'dish', row.dish_id, query], queryFn: () => api.get('/recipe-links/dishes/' + row.dish_id + '/cost?' + query) })
  return (
    <Drawer title={row.name} subtitle={where} onClose={onClose}
      footer={<Link to={'/recipes?tab=dishes&dish=' + row.dish_id} className={cn(btn.outline, 'h-12')} data-testid="explain-matrix"><Layers className="w-4 h-4" />Open its recipes by venue and order type</Link>}>
      {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : error ? <ErrorNote error={error} /> : (
        <div className="space-y-4" data-testid="margins-explain">
          <Card title="Which recipe">
            {data.recipe ? (
              <p className="text-sm"><strong>{data.recipe.name}</strong>{Number(data.portions) !== 1 ? ' x ' + data.portions : ''}, because its link for <strong>{data.why}</strong> is the closest here.</p>
            ) : <p className="text-sm">{data.kind === 'deal' ? 'A meal deal: the dishes picked in it, each with its own recipe.' : data.kind === 'service' ? 'A service: no recipe.' : 'No recipe is linked.'}</p>}
            <div className="mt-2"><CoverageBadge coverage={data.coverage === 'not_needed' ? 'full' : data.coverage} /></div>
            {data.gaps?.length > 0 && (
              <ul className="mt-2 space-y-2">
                {data.gaps.map((g, i) => <li key={i} className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm"><p className="font-medium text-amber-900">{g.text}</p><p className="text-xs text-amber-900/80">{g.fix}</p></li>)}
              </ul>
            )}
          </Card>
          {data.steps?.length > 0 && <Steps title="What it costs" rows={data.steps.map(s => ({ label: s.label, text: s.text, amount: s.amount != null ? pounds(s.amount) : null }))} />}
          {data.recipe_explanation?.rows?.length > 0 && <Steps title={'Inside ' + data.recipe.name + ' (one recipe)'} rows={data.recipe_explanation.rows.map(r => ({ label: r.label, text: r.steps.join('; '), amount: r.amount != null ? pounds(r.amount) : null }))} />}
          {data.margin?.steps && <Steps title="Price, VAT and margin" rows={data.margin.steps.map(s => ({ label: s.label, text: s.text, amount: s.amount_pence != null ? penceText(s.amount_pence) : null }))} />}
          {data.margin?.band && <p className="text-sm">Cost % <BandBadge band={data.margin.band} pct={data.margin.cost_pct} />: {bandWord(data.margin.band).toLowerCase()}.</p>}
        </div>
      )}
    </Drawer>
  )
}

function Steps({ title, rows }) {
  return (
    <Card title={title}>
      <ol className="space-y-2 text-sm">
        {rows.map((r, i) => (
          <li key={i} className="rounded-lg border px-3 py-2">
            <div className="flex items-baseline gap-2"><span className="font-medium flex-1">{r.label}</span>{r.amount && <span className="tabular-nums font-medium">{r.amount}</span>}</div>
            {r.text && <p className="text-xs text-muted-foreground">{r.text}</p>}
          </li>
        ))}
      </ol>
    </Card>
  )
}

/** The target and limit cost %, with sections' own; one Save for the card, sent whole. */
function TargetsCard({ settings, sections, canManage }) {
  const api = useApi()
  const qc = useQueryClient()
  const from = s => ({ target_pct: s.target_pct, limit_pct: s.limit_pct, sections: (s.sections || []).map(x => ({ section_id: x.section_id, target_pct: x.target_pct, limit_pct: x.limit_pct })) })
  const [d, setD] = useState(() => from(settings))
  useEffect(() => { setD(from(settings)) }, [settings?.updated_at, settings?.target_pct, settings?.limit_pct])
  const dirty = JSON.stringify(d) !== JSON.stringify(from(settings))
  const [adding, setAdding] = useState('')
  const save = useMutation({
    mutationFn: () => api.put('/menu-margins/settings', d),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['menu-margins'] }),
  })
  const titleOf = id => sections.find(s => s.id === id)?.title || 'A section of another menu'
  const free = sections.filter(s => !d.sections.some(x => x.section_id === s.id))
  const setSection = (i, patch) => setD(x => ({ ...x, sections: x.sections.map((s, j) => (j === i ? { ...s, ...patch } : s)) }))
  return (
    <Card title="Cost targets" actions={canManage && (
      <button type="button" className={cn(btn.primary, 'h-12')} disabled={!dirty || save.isPending} onClick={() => save.mutate()} data-testid="targets-save">
        {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />}Save
      </button>
    )}>
      <div className="space-y-3" data-testid="targets">
        <p className="text-xs text-muted-foreground">At or below the target is on target (green); up to the limit is over target (amber); above the limit is over the limit (red).</p>
        <div className="flex flex-wrap gap-3">
          <Field label="Target cost %"><NumInput value={d.target_pct} onChange={v => setD({ ...d, target_pct: v })} disabled={!canManage} className="h-12 w-28" data-testid="targets-target" /></Field>
          <Field label="Limit cost %"><NumInput value={d.limit_pct} onChange={v => setD({ ...d, limit_pct: v })} disabled={!canManage} className="h-12 w-28" data-testid="targets-limit" /></Field>
        </div>
        {d.sections.length > 0 && (
          <ul className="space-y-2">
            {d.sections.map((s, i) => (
              <li key={s.section_id} className="flex flex-wrap items-end gap-3 rounded-lg border p-2">
                <span className="flex-1 min-w-[10rem] text-sm font-medium self-center">{titleOf(s.section_id)}</span>
                <Field label="Target %"><NumInput value={s.target_pct} onChange={v => setSection(i, { target_pct: v })} disabled={!canManage} className="h-12 w-24" /></Field>
                <Field label="Limit %"><NumInput value={s.limit_pct} onChange={v => setSection(i, { limit_pct: v })} disabled={!canManage} className="h-12 w-24" /></Field>
                {canManage && <ConfirmDelete label="Take the section's own off" onConfirm={() => setD(x => ({ ...x, sections: x.sections.filter((_, j) => j !== i) }))} big />}
              </li>
            ))}
          </ul>
        )}
        {canManage && free.length > 0 && (
          <div className="flex flex-wrap items-end gap-2">
            <Field label="A section of this menu with its own">
              <select className={cn(inputCls, 'h-12 w-56')} value={adding} onChange={e => setAdding(e.target.value)} data-testid="targets-section">
                <option value="">Pick a section</option>
                {free.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
              </select>
            </Field>
            <button type="button" className={cn(btn.outline, 'h-12')} disabled={!adding} onClick={() => { setD(x => ({ ...x, sections: [...x.sections, { section_id: adding, target_pct: x.target_pct, limit_pct: x.limit_pct }] })); setAdding('') }}>
              <Plus className="w-4 h-4" />Add
            </button>
          </div>
        )}
        <ErrorNote error={save.error} />
      </div>
    </Card>
  )
}

/** The rows as a CSV file, as the page shows them (the options under their dish). */
function downloadCsv(data, rows) {
  const cell = v => (v == null ? '' : /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v))
  const money = p => (p == null ? '' : (p / 100).toFixed(2))
  const head = ['Dish', 'Option', 'Section', 'Kind', 'Recipe', 'Why', 'Price', 'VAT %', 'Net', 'Cost', 'Cost (lowest)', 'Cost (highest)', 'GP', 'Cost %', 'Cost % (highest)', 'Band', 'Costed']
  const out = [head]
  for (const r of rows) {
    out.push([r.name, '', r.section, KIND_WORDS[r.kind] || 'Dish', r.recipe?.name || '', r.why || '', money(r.price_pence), r.vat_rate, money(r.net_pence),
      r.cost != null ? Number(r.cost).toFixed(2) : '', r.cost_min != null ? Number(r.cost_min).toFixed(2) : '', r.cost_max != null ? Number(r.cost_max).toFixed(2) : '',
      money(r.gp_pence ?? r.gp_min_pence), r.cost_pct ?? r.cost_pct_min ?? '', r.cost_pct_max ?? '', bandWord(r.band), r.coverage])
    for (const o of r.options || []) {
      out.push([r.name, o.group + ': ' + o.label, r.section, 'Option', '', '', money(o.price_pence), r.vat_rate, money(o.net_pence),
        o.cost != null ? Number(o.cost).toFixed(2) : '', '', '', money(o.gp_pence), o.cost_pct ?? '', '', bandWord(o.band), o.gaps?.length ? 'partial' : 'full'])
    }
  }
  const blob = new Blob([out.map(r => r.map(cell).join(',')).join('\n') + '\n'], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'menu-margins-' + String(data.menu?.name || 'menu').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.csv'
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
