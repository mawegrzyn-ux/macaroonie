// src/components/recipes/Scenarios.jsx
//
// Menu margins' Scenarios tab (inventory phase 7a, docs/INVENTORY.md 8.2):
// what if prices or costs changed? A scenario is a menu at a venue (and
// revenue stream) and order type with changes in order: prices or costs up
// or down by a percentage or a figure, or set, for a dish, a section or every
// dish. Its figures come from the server (scenarioFigures() in
// shared/scenarios.js on the menu's draft): every dish before and after, and
// the weighted cost % and GP at the real mix (units sold over the last days,
// from usage from sales). The builder works the figures out as it is changed
// (POST /api/cost-scenarios/preview, a read); Save keeps it (Costing manage).
// Saved scenarios reopen, copy and delete (asked twice). Export CSV.
//
// Push prices writes a saved scenario's new prices into the menu's DRAFT:
// a preview of every price that will change first (and where the menu is
// sold), then a confirm. Publishing stays a separate step on the Menus page.
// It needs Menus manage as well as Costing manage. Net sales and GP at the
// mix need till reports view as well (the server leaves them out).
//
//   Scenarios({ choices, canManage })   choices: GET /api/menu-margins's

import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Plus, Copy, Download, Upload, FolderOpen, X, ArrowRight, CheckCircle2 } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { usePermission } from '@/hooks/usePermission'
import { ReadOnlyNotice, ReadOnlyFieldset } from '@/components/ReadOnlyNotice'
import { Field, inputCls, ErrorNote, Segmented, ConfirmDelete, SortableRows, Modal } from '@/components/staff/shared'
import { Card, NumInput, btn } from '@/components/purchasing/shared'
import { penceText, pctText, pounds, BandBadge } from '@/components/recipes/shared'
import { CHANGE_HOW, MIX_DAY_CHOICES, MIX_DAYS, ROUND_TO, changeProblem, scenarioCsvRows } from '@shared/scenarios.js'

let keySeq = 0
const newKey = () => 'c' + (++keySeq)
const blank = () => ({ name: '', menu_id: '', venue_id: null, revenue_stream_id: null, order_type_id: null, mix_days: MIX_DAYS, changes: [], notes: null })
const toLocal = c => ({
  key: newKey(), what: c.what, applies: c.applies, section_id: c.section_id ?? null, dish_id: c.dish_id ?? null, how: c.how,
  dir: c.how !== 'set' && Number(c.value) < 0 ? 'down' : 'up', amount: c.value == null ? null : Math.abs(Number(c.value)),
  round_to: c.round_to ?? 1, round: c.round ?? 'nearest',
})
const toApi = c => ({
  what: c.what, applies: c.applies, section_id: c.applies === 'section' ? c.section_id : null, dish_id: c.applies === 'dish' ? c.dish_id : null,
  how: c.how, value: c.amount == null ? null : (c.how !== 'set' && c.dir === 'down' ? -c.amount : c.amount),
  round_to: c.what === 'price' && c.how !== 'set' ? Number(c.round_to || 1) : null, round: c.what === 'price' && c.how !== 'set' ? (c.round || 'nearest') : null,
})
const fromServer = s => ({
  name: s.name, menu_id: s.menu_id, venue_id: s.venue_id ?? null, revenue_stream_id: s.revenue_stream_id ?? null, order_type_id: s.order_type_id ?? null,
  mix_days: s.mix_days, changes: (s.changes || []).map(toLocal), notes: s.notes ?? null,
})
const bodyOf = d => ({ ...d, name: d.name.trim(), changes: d.changes.map(toApi) })
const sameBody = (a, b) => JSON.stringify(bodyOf(a)) === JSON.stringify(bodyOf(b))
const qtyText = n => (Number.isInteger(n) ? String(n) : Number(n).toFixed(1))
const ROUND_WORDS = { 1: '1p', 5: '5p', 10: '10p', 50: '50p', 100: '£1' }

export default function Scenarios({ choices, canManage }) {
  const api = useApi()
  const qc = useQueryClient()
  const menusPerm = usePermission('menus')
  const [params, setParams] = useSearchParams()
  const openId = params.get('scenario') || ''
  const setOpen = id => {
    const next = new URLSearchParams(params)
    if (id) next.set('scenario', id); else next.delete('scenario')
    setParams(next, { replace: true })
  }
  const list = useQuery({ queryKey: ['cost-scenarios'], queryFn: () => api.get('/cost-scenarios') })
  const saved = useQuery({ queryKey: ['cost-scenarios', openId], queryFn: () => api.get('/cost-scenarios/' + openId), enabled: !!openId && openId !== 'new' })
  const [draft, setDraft] = useState(null)
  const [server, setServer] = useState(null)
  useEffect(() => {
    if (openId === 'new') {
      const d = { ...blank(), menu_id: choices.menus[0]?.id || '', venue_id: choices.venues[0]?.id || null, order_type_id: choices.order_types[0]?.id || null }
      setDraft(d)
      setServer(null)
    } else if (!openId) {
      setDraft(null)
      setServer(null)
    }
  }, [openId])
  useEffect(() => {
    if (saved.data?.scenario && openId && openId !== 'new') {
      const d = fromServer(saved.data.scenario)
      setDraft(d)
      setServer(d)
    }
  }, [saved.data?.scenario?.updated_at, openId])
  const dirty = draft && (!server || !sameBody(draft, server))
  const del = useMutation({
    mutationFn: id => api.delete('/cost-scenarios/' + id),
    onSuccess: (_, id) => { qc.invalidateQueries({ queryKey: ['cost-scenarios'] }); if (id === openId) setOpen('') },
  })
  const copy = useMutation({
    mutationFn: id => api.post('/cost-scenarios/' + id + '/copy', {}),
    onSuccess: s => { qc.invalidateQueries({ queryKey: ['cost-scenarios'] }); setOpen(s.id) },
  })
  return (
    <div className="space-y-4" data-testid="margins-scenarios">
      {!canManage && <ReadOnlyNotice what="scenarios" />}
      <Card title="Scenarios" actions={canManage && (
        <button type="button" className={cn(btn.primary, 'h-12')} onClick={() => setOpen('new')} data-testid="scenario-new"><Plus className="w-4 h-4" />New scenario</button>
      )}>
        <p className="text-xs text-muted-foreground mb-3">
          Try price and cost changes on a menu and see the cost % and gross profit at what really sold. Nothing changes on the menu until
          you push a saved scenario&apos;s prices into its draft, and nothing is live until the menu is published.
        </p>
        {list.isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : !list.data?.scenarios?.length ? (
          <p className="text-sm text-muted-foreground" data-testid="scenario-none">No scenarios saved yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border" data-testid="scenario-list">
            {list.data.scenarios.map(s => (
              <li key={s.id} className={cn('flex flex-wrap items-center gap-2 px-3 py-2', s.id === openId && 'bg-muted/50')} data-testid="scenario-row" data-name={s.name}>
                <button type="button" className="flex-1 min-w-[12rem] text-left min-h-[48px] touch-manipulation" onClick={() => setOpen(s.id)}>
                  <span className="font-medium text-sm">{s.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {[s.menu, s.venue || 'the group\'s prices', s.stream, s.order_type || 'any order type', s.changes + (s.changes === 1 ? ' change' : ' changes'),
                      s.pushed_at ? 'pushed ' + new Date(s.pushed_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : null].filter(Boolean).join(' · ')}
                  </span>
                </button>
                <button type="button" className={btn.outline} onClick={() => setOpen(s.id)} aria-label={'Open ' + s.name}><FolderOpen className="w-4 h-4" />Open</button>
                {canManage && <button type="button" className={btn.outline} disabled={copy.isPending} onClick={() => copy.mutate(s.id)} data-testid="scenario-copy"><Copy className="w-4 h-4" />Copy</button>}
                {canManage && <ConfirmDelete label={'Delete ' + s.name} confirmLabel="Yes, delete it" onConfirm={() => del.mutate(s.id)} />}
              </li>
            ))}
          </ul>
        )}
        <ErrorNote error={list.error || del.error || copy.error} />
      </Card>
      {openId && openId !== 'new' && saved.isLoading && <div className="py-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" /></div>}
      <ErrorNote error={saved.error} />
      {draft && (
        <Builder key={openId} id={openId === 'new' ? null : openId} draft={draft} setDraft={setDraft} dirty={dirty} choices={choices}
          canManage={canManage} canPush={canManage && menusPerm.canManage} pushedAt={saved.data?.scenario?.pushed_at}
          onSaved={s => { qc.invalidateQueries({ queryKey: ['cost-scenarios'] }); const d = fromServer(s); setServer(d); setDraft(d); if (openId === 'new') setOpen(s.id) }}
          onClose={() => setOpen('')} />
      )}
    </div>
  )
}

function Builder({ id, draft, setDraft, dirty, choices, canManage, canPush, pushedAt, onSaved, onClose }) {
  const api = useApi()
  const set = patch => setDraft(d => ({ ...d, ...patch }))
  // The figures follow the builder, a moment after the last change (a read: nothing is saved).
  const ready = draft.changes.filter(c => !changeProblem(toApi(c)))
  const previewBody = useMemo(() => ({ ...bodyOf({ ...draft, changes: ready }), name: draft.name.trim() || 'Scenario' }), [JSON.stringify(draft)])
  const [asked, setAsked] = useState(previewBody)
  useEffect(() => { const t = setTimeout(() => setAsked(previewBody), 400); return () => clearTimeout(t) }, [JSON.stringify(previewBody)])
  const preview = useQuery({
    queryKey: ['cost-scenarios', 'preview', JSON.stringify(asked)], queryFn: () => api.post('/cost-scenarios/preview', asked),
    enabled: !!asked.menu_id, placeholderData: prev => prev,
  })
  const save = useMutation({
    mutationFn: () => (id ? api.put('/cost-scenarios/' + id, bodyOf(draft)) : api.post('/cost-scenarios', bodyOf(draft))),
    onSuccess: onSaved,
  })
  const venue = choices.venues.find(v => v.id === draft.venue_id)
  const fig = preview.data?.figures
  const sales = !!preview.data?.sees_sales
  const sections = fig?.sections || []
  const dishes = fig?.dishes || []
  const incomplete = draft.changes.length - ready.length
  const priceChanges = draft.changes.some(c => c.what === 'price')
  const items = useMemo(() => draft.changes.map(c => ({ id: c.key, c })), [draft.changes])
  return (
    <>
      <Card title={id ? 'Scenario' : 'New scenario'} actions={(
        <span className="flex items-center gap-2">
          {canManage && (
            <button type="button" className={cn(btn.primary, 'h-12')} disabled={!dirty || !draft.name.trim() || incomplete > 0 || save.isPending} onClick={() => save.mutate()} data-testid="scenario-save">
              {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />}Save
            </button>
          )}
          <button type="button" className={cn(btn.ghost, 'h-12 w-12')} onClick={onClose} aria-label="Close the scenario"><X className="w-4 h-4" /></button>
        </span>
      )}>
        <ReadOnlyFieldset disabled={!canManage}>
          <div className="flex flex-wrap items-end gap-3" data-testid="scenario-details">
            <Field label="Name">
              <input className={cn(inputCls, 'h-12 w-60')} value={draft.name} maxLength={120} onChange={e => set({ name: e.target.value })} placeholder="Spring prices" data-testid="scenario-name" />
            </Field>
            <Field label="Menu">
              <select className={cn(inputCls, 'h-12 w-52')} value={draft.menu_id} onChange={e => set({ menu_id: e.target.value, changes: draft.changes.filter(c => c.applies === 'all') })} data-testid="scenario-menu">
                {choices.menus.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </Field>
            <Field label="Venue">
              <select className={cn(inputCls, 'h-12 w-48')} value={draft.venue_id || ''} onChange={e => set({ venue_id: e.target.value || null, revenue_stream_id: null })} data-testid="scenario-venue">
                <option value="">The group&apos;s prices, every venue&apos;s sales</option>
                {choices.venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </Field>
            {venue?.streams?.length > 0 && (
              <Field label="Revenue stream">
                <select className={cn(inputCls, 'h-12 w-44')} value={draft.revenue_stream_id || ''} onChange={e => set({ revenue_stream_id: e.target.value || null })} data-testid="scenario-stream">
                  <option value="">Any</option>
                  {venue.streams.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
            )}
            <Field label="Order type">
              <select className={cn(inputCls, 'h-12 w-40')} value={draft.order_type_id || ''} onChange={e => set({ order_type_id: e.target.value || null })} data-testid="scenario-type">
                <option value="">Any</option>
                {choices.order_types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
            <Field label="Mix from the last" group>
              <Segmented value={String(draft.mix_days)} onChange={v => set({ mix_days: Number(v) })} options={MIX_DAY_CHOICES.map(n => ({ value: String(n), label: n + ' days' }))}
                className="[&>button]:h-12" testid="scenario-days" />
            </Field>
          </div>
          <Field label="Notes">
            <input className={cn(inputCls, 'h-12 mt-1')} value={draft.notes || ''} maxLength={1000} onChange={e => set({ notes: e.target.value || null })} placeholder="What this is for" />
          </Field>
        </ReadOnlyFieldset>
        <p className="text-xs text-muted-foreground mt-3">
          Prices are the menu&apos;s draft (what Push prices changes). A dish has one price on a menu wherever it is sold; the venue, revenue
          stream and order type decide the VAT, the recipe and which sales make the mix.
          {preview.data?.mix ? ' The mix is what sold from ' + preview.data.mix.from + ' to ' + preview.data.mix.to + (preview.data.where ? ' (' + preview.data.where + ')' : '') + '.' : ''}
        </p>
        <ErrorNote error={save.error} />
      </Card>

      <Card title="Changes" actions={canManage && (
        <button type="button" className={cn(btn.outline, 'h-12')} onClick={() => set({ changes: [...draft.changes, toLocal({ what: 'price', applies: 'all', how: 'percent', value: 5, round_to: 1, round: 'nearest' })] })} data-testid="scenario-add-change">
          <Plus className="w-4 h-4" />Add a change
        </button>
      )}>
        {!draft.changes.length ? <p className="text-sm text-muted-foreground">No changes yet: add one to see what it does. Each applies on top of the ones above it.</p> : (
          <div data-testid="scenario-changes">
            <SortableRows items={items} locked={!canManage}
              onReorder={ids => set({ changes: ids.map(k => draft.changes.find(c => c.key === k)) })}
              renderItem={({ c }) => (
                <ChangeRow c={c} sections={sections} dishes={dishes} disabled={!canManage}
                  onChange={patch => set({ changes: draft.changes.map(x => (x.key === c.key ? { ...x, ...patch } : x)) })}
                  onRemove={() => set({ changes: draft.changes.filter(x => x.key !== c.key) })} />
              )} />
            {incomplete > 0 && <p className="text-xs text-amber-800 mt-2">{incomplete === 1 ? 'A change isn\'t finished' : incomplete + ' changes aren\'t finished'}: the figures leave it out and it can&apos;t be saved yet.</p>}
          </div>
        )}
      </Card>

      <ErrorNote error={preview.error} />
      {fig && (
        <>
          <MixCard total={fig.total} sales={sales} loading={preview.isFetching} leftOut={fig.left_out} />
          <div className="flex flex-wrap gap-2">
            <button type="button" className={cn(btn.outline, 'h-12')} onClick={() => downloadCsv(draft.name || 'scenario', fig, sales)} data-testid="scenario-csv"><Download className="w-4 h-4" />Export CSV</button>
            {pushedAt && <span className="text-xs text-muted-foreground self-center">Last pushed {new Date(pushedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.</span>}
          </div>
          {sections.filter(s => dishes.some(d => d.section_id === s.section_id)).map(s => (
            <SectionResult key={s.section_id} section={s} dishes={dishes.filter(d => d.section_id === s.section_id)} sales={sales} />
          ))}
        </>
      )}
    </>
  )
}

function ChangeRow({ c, sections, dishes, disabled, onChange, onRemove }) {
  const problem = changeProblem(toApi(c))
  return (
    <div className="flex flex-wrap items-end gap-2 py-1" data-testid="scenario-change">
      <Field label="What" group>
        <Segmented value={c.what} onChange={v => onChange({ what: v })} disabled={disabled} options={[{ value: 'price', label: 'Price' }, { value: 'cost', label: 'Cost' }]} className="[&>button]:h-11" />
      </Field>
      <Field label="Of">
        <select className={cn(inputCls, 'w-40')} value={c.applies} disabled={disabled} onChange={e => onChange({ applies: e.target.value })} data-testid="change-applies">
          <option value="all">Every dish</option>
          <option value="section">A section</option>
          <option value="dish">A dish</option>
        </select>
      </Field>
      {c.applies === 'section' && (
        <Field label="Section">
          <select className={cn(inputCls, 'w-44')} value={c.section_id || ''} disabled={disabled} onChange={e => onChange({ section_id: e.target.value || null })} data-testid="change-section">
            <option value="">Pick a section</option>
            {sections.map(s => <option key={s.section_id} value={s.section_id}>{s.section}</option>)}
          </select>
        </Field>
      )}
      {c.applies === 'dish' && (
        <Field label="Dish">
          <select className={cn(inputCls, 'w-52')} value={c.dish_id || ''} disabled={disabled} onChange={e => onChange({ dish_id: e.target.value || null })} data-testid="change-dish">
            <option value="">Pick a dish</option>
            {dishes.map(d => <option key={d.dish_id} value={d.dish_id}>{d.name}{d.section ? ' (' + d.section + ')' : ''}</option>)}
          </select>
        </Field>
      )}
      <Field label="How">
        <select className={cn(inputCls, 'w-40')} value={c.how} disabled={disabled} onChange={e => onChange({ how: e.target.value })} data-testid="change-how">
          {Object.entries(CHANGE_HOW).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      {c.how !== 'set' && (
        <Field label="Up or down" group>
          <Segmented value={c.dir} onChange={v => onChange({ dir: v })} disabled={disabled} options={[{ value: 'up', label: 'Up' }, { value: 'down', label: 'Down' }]} className="[&>button]:h-11" />
        </Field>
      )}
      <Field label={c.how === 'percent' ? '%' : '£'}>
        <NumInput value={c.amount} onChange={v => onChange({ amount: v })} disabled={disabled} className="w-24" data-testid="change-value" />
      </Field>
      {c.what === 'price' && c.how !== 'set' && (
        <Field label="Round to">
          <span className="flex gap-1">
            <select className={cn(inputCls, 'w-20')} value={String(c.round_to || 1)} disabled={disabled} onChange={e => onChange({ round_to: Number(e.target.value) })} aria-label="Round to">
              {ROUND_TO.map(n => <option key={n} value={n}>{ROUND_WORDS[n]}</option>)}
            </select>
            <select className={cn(inputCls, 'w-28')} value={c.round || 'nearest'} disabled={disabled} onChange={e => onChange({ round: e.target.value })} aria-label="Round which way">
              <option value="up">up</option><option value="nearest">nearest</option><option value="down">down</option>
            </select>
          </span>
        </Field>
      )}
      {!disabled && <ConfirmDelete label="Take this change out" confirmLabel="Take it out" onConfirm={onRemove} />}
      {problem && <p className="basis-full text-xs text-amber-800">{problem}</p>}
    </div>
  )
}

function Move({ label, b, a, money = false, pct = false, highlight = true }) {
  const fmt = v => (v == null ? '-' : pct ? pctText(v) : money ? penceText(v) : v)
  const changed = b !== a
  return (
    <div className="rounded-lg border bg-background px-3 py-2 min-w-[9rem]">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm tabular-nums">
        <span>{fmt(b)}</span>
        <ArrowRight className="inline w-3.5 h-3.5 mx-1 text-muted-foreground" aria-label="becomes" />
        <strong className={cn(changed && highlight && 'text-primary')}>{fmt(a)}</strong>
      </p>
    </div>
  )
}

function MixCard({ total, sales, loading, leftOut }) {
  const b = total.before, a = total.after
  return (
    <Card title={loading ? 'At the real mix (updating)' : 'At the real mix'}>
      <div className="flex flex-wrap gap-2" data-testid="scenario-total">
        <Move label="Cost %, weighted by what sold" b={b.cost_pct} a={a.cost_pct} pct />
        {sales && <Move label="Gross profit at the mix" b={b.gp_pence} a={a.gp_pence} money />}
        {sales && <Move label="Net sales at the mix" b={b.net_pence} a={a.net_pence} money />}
        <Move label="Cost at the mix" b={b.cost_pence} a={a.cost_pence} money />
        {sales && total.change.gp_pence != null && (
          <div className={cn('rounded-lg border px-3 py-2 min-w-[9rem]', total.change.gp_pence >= 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200')} data-testid="scenario-gp-change">
            <p className="text-xs text-muted-foreground">GP change</p>
            <p className="text-sm font-semibold tabular-nums">{total.change.gp_pence >= 0 ? '+' : ''}{penceText(total.change.gp_pence)}</p>
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground mt-3">
        {qtyText(b.units)} units sold are in these figures, each dish at its menu price net of VAT and its cost now.
        {total.left_out_units > 0 && ' ' + qtyText(total.left_out_units) + ' units of dishes with no cost (or no price) are left out of both sides, never counted at nothing'}
        {leftOut?.length > 0 && ': ' + leftOut.slice(0, 6).map(l => l.name + ' (' + qtyText(l.units) + ', ' + l.why + ')').join(', ') + (leftOut.length > 6 ? ' and more' : '')}
        {total.left_out_units > 0 ? '.' : ''}
        {!sales && ' Net sales and GP at the mix are the till\'s sales in pounds: they need till reports view as well.'}
      </p>
    </Card>
  )
}

function SectionResult({ section, dishes, sales }) {
  return (
    <Card title={(section.section || 'A section') + (section.units ? ' · ' + qtyText(section.units) + ' sold' : '')} bodyClass="p-0">
      <div className="overflow-x-auto" data-testid="scenario-table">
        <table className="w-full text-sm min-w-[760px]">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="text-left font-medium px-4 py-2">Dish</th>
              <th className="text-right font-medium px-2 py-2">Units</th>
              <th className="text-right font-medium px-2 py-2">Price</th>
              <th className="text-right font-medium px-2 py-2">Cost</th>
              <th className="text-right font-medium px-2 py-2">GP a dish</th>
              <th className="text-right font-medium px-4 py-2">Cost %</th>
            </tr>
          </thead>
          <tbody>
            {dishes.map(d => (
              <tr key={d.dish_id} className="border-b" data-testid="scenario-row-dish" data-name={d.name} data-changed={d.price_changed || d.cost_changed ? 'yes' : 'no'}>
                <td className="px-4 py-2">
                  <span className="font-medium">{d.name}</span>
                  {d.kind === 'deal' && <span className="ml-2 text-xs rounded-full bg-muted px-2 py-0.5">Meal deal</span>}
                  {(d.typical_picks?.length > 0 || d.why_out || d.skipped?.length > 0) && (
                    <span className="block text-xs text-muted-foreground">
                      {[d.typical_picks?.length ? 'at its usual picks: ' + d.typical_picks.join(', ') : null, d.why_out ? 'left out: ' + d.why_out : null, ...(d.skipped || [])].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{qtyText(d.units)}</td>
                <Cell b={d.before.price_pence} a={d.after.price_pence} f={penceText} />
                <Cell b={d.before.cost} a={d.after.cost} f={v => pounds(v)} />
                <Cell b={d.before.gp_pence} a={d.after.gp_pence} f={penceText} />
                <td className="px-4 py-2 text-right">
                  <span className="inline-flex flex-wrap justify-end items-center gap-1">
                    {d.before.cost_pct != null && d.before.cost_pct !== d.after.cost_pct && <span className="text-xs tabular-nums text-muted-foreground">{pctText(d.before.cost_pct)} to</span>}
                    {d.after.cost_pct != null ? <BandBadge band={d.after.band} pct={d.after.cost_pct} /> : '-'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sales && section.before.gp_pence != null && (
        <p className="px-4 py-2 text-xs text-muted-foreground">
          At the mix: cost % {pctText(section.before.cost_pct)} to {pctText(section.after.cost_pct)}, GP {penceText(section.before.gp_pence)} to {penceText(section.after.gp_pence)}.
        </p>
      )}
    </Card>
  )
}

function Cell({ b, a, f }) {
  const changed = b !== a
  return (
    <td className="px-2 py-2 text-right tabular-nums">
      {b == null && a == null ? '-' : changed ? (
        <span><span className="text-muted-foreground line-through decoration-1">{b == null ? '-' : f(b)}</span> <strong className="text-primary">{a == null ? '-' : f(a)}</strong></span>
      ) : f(b)}
    </td>
  )
}

function downloadCsv(name, fig, sales) {
  const cell = v => (v == null ? '' : /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v))
  const rows = scenarioCsvRows(fig, { sales })
  const blob = new Blob([rows.map(r => r.map(cell).join(',')).join('\n') + '\n'], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'scenario-' + String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.csv'
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
