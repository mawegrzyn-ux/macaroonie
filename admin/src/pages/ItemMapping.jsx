// src/pages/ItemMapping.jsx
//
// Item mapping (/integrations/mapping): what another till's items are on our
// menus (sales from other tills, phase 2, docs/SALES_IMPORT.md 4, migration
// 292). Per connection, with a venue picker:
//   - Coverage: the share of the last 30 days' item sales value decided
//     (mapped or kept as sold), by venue, and the unmapped items by value;
//   - the other till's catalogue (category, item, variants; modifier groups
//     and options), each with its state under the rules (worked out by
//     shared/itemMapping.js on the server) and its sales in the last 30 days;
//   - the rules, and a rule editor (a sheet): map to a dish (with options and
//     more dishes) or a combo, a combination (item + modifiers), an axis
//     (a variant option or modifier group to one of our option groups, value
//     to value), ignore or keep as sold; its scope and effective_from;
//     Preview shows what the last 30 days' lines would become before saving.
// Saving or deleting re-maps the stored sales in the background.
// Phase 3 (components/cashRecon/MappingTools.jsx), for the venue picked:
// Suggestions, Pepper's proposals, pattern offers after accepting, Create
// missing dishes and Copy from another venue.
//
// Permissions (Cash reconciliation): View sees it and previews; Manage
// saves and deletes rules (the API's guards are the real check).

import { useState, useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { ArrowLeft, Loader2, Plus, Search, Check, Trash2, Eye, Pencil, Shuffle, Layers, X, Wand2 } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { usePermission } from '@/hooks/usePermission'
import { ReadOnlyNotice } from '@/components/ReadOnlyNotice'
import { Modal } from '@/components/staff/shared'
import { Card, inputCls, btnPrimary, btnOutline, btnDanger } from '@/components/cashRecon/reconShared'
import { Suggestions, PepperProposals, PatternEditor, patternWords, CreateMissing, CopyFromVenue } from '@/components/cashRecon/MappingTools'

const pence = p => (p < 0 ? '-' : '') + '£' + (Math.abs(Number(p) || 0) / 100).toFixed(2)
const dayLabel = d => (d ? format(new Date(d + 'T12:00:00'), 'd MMM yyyy') : '')

const STATE_STYLE = {
  mapped:   'bg-green-100 text-green-800',
  kept:     'bg-sky-100 text-sky-800',
  ignored:  'bg-muted text-muted-foreground',
  note:     'bg-muted text-muted-foreground',
  in_combo: 'bg-violet-100 text-violet-800',
  bucket:   'bg-violet-100 text-violet-800',
  unmapped: 'bg-amber-100 text-amber-800',
}
const KINDS = [
  { key: 'exact', label: 'Map to a dish', short: 'Map' },
  { key: 'combination', label: 'Combination', short: 'Combination' },
  { key: 'axis', label: 'Option axis', short: 'Axis' },
  { key: 'ignore', label: 'Ignore', short: 'Ignore' },
  { key: 'keep', label: 'Keep as sold', short: 'Keep' },
  { key: 'pattern', label: 'Pattern', short: 'Pattern' },
  { key: 'bucket', label: 'Category to a section', short: 'Section' },
]
const kindLabel = k => KINDS.find(x => x.key === k)?.label || k

function StateBadge({ s }) {
  if (!s) return null
  return <span className={cn('text-[11px] font-semibold rounded-full px-2 py-0.5 whitespace-nowrap', STATE_STYLE[s.state] || '')}>{s.label}</span>
}

export default function ItemMapping() {
  const api = useApi()
  const perm = usePermission('cash_recon')
  const menusPerm = usePermission('menus')
  const [params, setParams] = useSearchParams()
  const { data: conns } = useQuery({ queryKey: ['integrations'], queryFn: () => api.get('/integrations/connections') })
  const connections = conns?.connections || []
  const connectionId = params.get('connection') || connections[0]?.id || ''
  const venueId = params.get('venue') || ''
  const setParam = (k, v) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p, { replace: true }) }
  const q = venueId ? '?venue_id=' + venueId : ''

  const view = useQuery({
    queryKey: ['item-mapping', connectionId, venueId],
    queryFn: () => api.get(`/integrations/mapping/${connectionId}${q}`),
    enabled: !!connectionId && perm.canView,
    refetchInterval: qq => (qq.state.data?.remap_pending ? 3000 : false),
  })
  const pending = !!view.data?.remap_pending
  const menu = useQuery({
    queryKey: ['item-mapping-menu', connectionId, venueId],
    queryFn: () => api.get(`/integrations/mapping/${connectionId}/menu${q}`),
    enabled: !!connectionId && perm.canView,
  })
  const cov = useQuery({
    queryKey: ['item-mapping-coverage', connectionId, venueId, pending],
    queryFn: () => api.get(`/integrations/mapping/${connectionId}/coverage${q}`),
    enabled: !!connectionId && perm.canView,
  })
  const [editing, setEditing] = useState(null)   // a draft rule
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')

  const data = view.data
  const rulesById = useMemo(() => Object.fromEntries((data?.rules || []).map(r => [r.id, r])), [data])

  /** Open the editor for one thing on the other till: its deciding rule at this scope, else a new exact rule. */
  function editThing(thing, state) {
    const rule = state?.rule_id && rulesById[state.rule_id]
    const scopeMatches = rule && (rule.venue_id || '') === venueId
    if (rule && scopeMatches && rule.kind !== 'axis' && rule.kind !== 'combination') { setEditing({ ...rule }); return }
    setEditing({ kind: 'exact', venue_id: venueId || null, ...thing, option_refs: [], target_option_ids: [], target_item_ids: [], axis_values: [] })
  }

  return (
    <div className="h-full overflow-y-auto bg-page">
      <div className="bg-background border-b px-4 max-lg:notouch:pl-14 py-4">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center gap-3">
          <Link to="/integrations" className={cn(btnOutline, 'px-3')} aria-label="Back to Integrations"><ArrowLeft className="w-4 h-4" /></Link>
          <Shuffle className="w-5 h-5 text-muted-foreground" />
          <h1 className="text-xl font-bold flex-1 min-w-[10rem]">Item mapping</h1>
          {connections.length > 1 && (
            <select value={connectionId} onChange={e => setParam('connection', e.target.value)} className={cn(inputCls, 'w-auto')} aria-label="Connection">
              {connections.map(c => <option key={c.id} value={c.id}>{c.system_label}: {c.name}</option>)}
            </select>
          )}
          {data && (
            <select value={venueId} onChange={e => setParam('venue', e.target.value)} className={cn(inputCls, 'w-auto')} aria-label="Venue">
              <option value="">Every venue on the connection</option>
              {data.venues.map(v => <option key={v.venue_id} value={v.venue_id}>{v.venue_name}</option>)}
            </select>
          )}
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-4 space-y-4">
        {perm.loaded && !perm.canView && (
          <p className="text-sm text-muted-foreground">Your role doesn&apos;t have access to Cash reconciliation, which these connections belong to.</p>
        )}
        {perm.loaded && perm.canView && !perm.canManage && <ReadOnlyNotice what="the item mapping" />}
        {conns && !connections.length && (
          <Card title="No tills connected"><p className="text-sm text-muted-foreground">Connect a till on the Integrations page first.</p></Card>
        )}
        <p className="text-sm text-muted-foreground leading-relaxed">
          Say what the other till&apos;s items are on your menus, so its sales count as your dishes and options. A rule
          never changes money: each receipt keeps the till&apos;s amounts, shared out over the dish and its options by
          your list prices. Saved rules apply to the stored sales in the background.
        </p>
        {(view.isLoading || menu.isLoading) && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />}
        {view.error && <p className="text-sm text-destructive">{view.error.message}</p>}

        {data && (
          <>
            <Coverage cov={cov.data} pending={pending} onPick={u => {
              const item = data.items.find(i => i.ref === u.item_ref)
              const variant = item?.variants.find(v => v.ref === u.variant_ref)
              if (variant && item.variants.length > 1) editThing({ item_ref: item.ref, variant_ref: variant.ref }, variant.state)
              else if (item) editThing({ item_ref: item.ref }, item.state)
            }} />
            <Suggestions connectionId={connectionId} venueId={venueId} canManage={perm.canManage} />
            <PepperProposals connectionId={connectionId} venueId={venueId} canManage={perm.canManage} />
            <CreateMissing connectionId={connectionId} venueId={venueId} menu={menu.data} canManage={perm.canManage} canMenus={menusPerm.canManage} />
            <CopyFromVenue connectionId={connectionId} venueId={venueId} venues={data.venues} canManage={perm.canManage} describe={r => matchLabel(r, data)} />
            <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] items-start">
              <Catalogue data={data} filter={filter} setFilter={setFilter} search={search} setSearch={setSearch} onEdit={editThing} />
              <Rules data={data} canManage={perm.canManage} venueId={venueId}
                onEdit={r => setEditing({ ...r })}
                onNew={kind => setEditing({ kind, venue_id: venueId || null, option_refs: [], target_option_ids: [], target_item_ids: [], axis_values: [], axis_kind: kind === 'axis' ? 'variant' : null })} />
            </div>
          </>
        )}
      </div>

      {editing && data && menu.data && (editing.kind === 'pattern' || editing.kind === 'bucket'
        ? <PatternEditor key={editing.id || 'new'} draft={editing} data={data} menu={menu.data} connectionId={connectionId}
            venueId={venueId} canManage={perm.canManage} onClose={() => setEditing(null)} />
        : <RuleEditor key={editing.id || 'new'} draft={editing} data={data} menu={menu.data} connectionId={connectionId}
            venueId={venueId} canManage={perm.canManage} onClose={() => setEditing(null)} />
      )}
    </div>
  )
}

// ── Coverage ─────────────────────────────────────────────────────────────────

function Coverage({ cov, pending, onPick }) {
  if (!cov) return null
  const rows = cov.venues
  return (
    <Card title={'Coverage, last ' + cov.days + ' days'}
      action={pending && <span className="text-xs flex items-center gap-1"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Applying rules to stored sales</span>}>
      {!rows.length && <p className="text-sm text-muted-foreground">No sales in the last {cov.days} days yet.</p>}
      {rows.map(v => (
        <div key={v.venue_id} className="space-y-1" data-testid="coverage-venue">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
            <span className="font-medium flex-1 min-w-[8rem]">{v.venue_name}</span>
            <span className="text-lg font-bold tabular-nums" data-testid="coverage-percent">{v.percent == null ? 'n/a' : v.percent + '%'}</span>
          </div>
          <div className="h-3 rounded-full bg-muted overflow-hidden flex" aria-hidden="true">
            {v.total > 0 && <>
              <div className="bg-green-500" style={{ width: Math.max(0, v.mapped / v.total * 100) + '%' }} />
              <div className="bg-sky-400" style={{ width: Math.max(0, v.kept / v.total * 100) + '%' }} />
              <div className="bg-violet-400" style={{ width: Math.max(0, (v.bucket || 0) / v.total * 100) + '%' }} />
              <div className="bg-gray-300" style={{ width: Math.max(0, v.ignored / v.total * 100) + '%' }} />
            </>}
          </div>
          <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3">
            <span>Mapped {pence(v.mapped)}</span><span>Kept as sold {pence(v.kept)}</span>
            {v.bucket > 0 && <span>In a section {pence(v.bucket)}</span>}
            <span>Ignored {pence(v.ignored)}</span><span>Not mapped {pence(v.unmapped)}</span><span>Of {pence(v.total)}</span>
          </div>
        </div>
      ))}
      {cov.unmapped.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Not mapped yet, biggest first</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {cov.unmapped.slice(0, 10).map(u => (
              <button key={(u.item_ref || '') + ':' + (u.variant_ref || '')} type="button" onClick={() => onPick(u)}
                className="min-h-[48px] px-3 py-2 rounded-xl border bg-background hover:bg-muted text-left touch-manipulation flex items-center gap-2">
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium truncate">{u.name}{u.variant_name ? ' · ' + u.variant_name : ''}</span>
                  <span className="block text-xs text-muted-foreground">{u.lines} {u.lines === 1 ? 'line' : 'lines'}</span>
                </span>
                <span className="text-sm tabular-nums">{pence(u.net_pence)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Coverage is the share of item sales (each item line with its modifiers, refunds and cancelled sales left out)
        that is mapped or kept as sold, of everything not ignored.
      </p>
    </Card>
  )
}

// ── The other till's catalogue ───────────────────────────────────────────────

function Row({ name, sub, state, sales, onClick, indent }) {
  return (
    <button type="button" onClick={onClick} data-testid="catalogue-row"
      className={cn('w-full min-h-[48px] px-3 py-2 rounded-xl border bg-background hover:bg-muted text-left touch-manipulation flex items-center gap-2', indent && 'ml-4 w-[calc(100%-1rem)]')}>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium truncate">{name}</span>
        <span className="block text-xs text-muted-foreground truncate">
          {state?.target ? '→ ' + state.target : sub}
        </span>
      </span>
      <StateBadge s={state} />
      <span className="text-xs tabular-nums text-muted-foreground w-16 text-right shrink-0">{sales?.net_pence ? pence(sales.net_pence) : ''}</span>
    </button>
  )
}

function Catalogue({ data, filter, setFilter, search, setSearch, onEdit }) {
  const t = search.trim().toLowerCase()
  const shows = s => filter === 'all' || (filter === 'open' ? ['unmapped', 'note'].includes(s?.state) : s?.state === filter)
  const items = data.items.filter(i => !t || i.name.toLowerCase().includes(t) || i.variants.some(v => v.name.toLowerCase().includes(t)))
  const byCategory = []
  for (const i of items) {
    const showItem = shows(i.state) || i.variants.some(v => shows(v.state))
    if (!showItem) continue
    let g = byCategory.find(x => x.name === i.category)
    if (!g) byCategory.push(g = { name: i.category, items: [] })
    g.items.push(i)
  }
  const mods = data.modifiers.map(m => ({ ...m, options: m.options.filter(o => shows(o.state) && (!t || o.name.toLowerCase().includes(t) || m.name.toLowerCase().includes(t))) }))
    .filter(m => m.options.length)
  return (
    <Card title={data.connection.name + ': catalogue'}>
      <div className="flex flex-wrap gap-2">
        <label className="relative flex-1 min-w-[12rem]">
          <Search className="w-4 h-4 absolute left-3 top-4 text-muted-foreground" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search items" aria-label="Search items" className={cn(inputCls, 'pl-9')} />
        </label>
        <select value={filter} onChange={e => setFilter(e.target.value)} className={cn(inputCls, 'w-auto')} aria-label="Show">
          <option value="all">Everything</option>
          <option value="open">Not mapped</option>
          <option value="mapped">Mapped</option>
          <option value="kept">Kept as sold</option>
          <option value="ignored">Ignored</option>
        </select>
      </div>
      <p className="text-xs text-muted-foreground">Sales are the last {data.days} days{data.venue_id ? ' at this venue' : ''}. Tap anything to map it.</p>
      {byCategory.map(g => (
        <div key={g.name} className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.name}</p>
          {g.items.map(i => (
            <div key={i.ref} className="space-y-1.5">
              <Row name={i.name} sub={i.axes.length ? 'Variants by ' + i.axes.join(', ') : 'Every variant'} state={i.state} sales={i.sales}
                onClick={() => onEdit({ item_ref: i.ref }, i.state)} />
              {i.variants.length > 1 && i.variants.filter(v => shows(v.state) || shows(i.state)).map(v => (
                <Row key={v.ref} indent name={v.name} sub={[v.sku, v.price_pence != null && pence(v.price_pence)].filter(Boolean).join(' · ')}
                  state={v.state} sales={v.sales} onClick={() => onEdit({ item_ref: i.ref, variant_ref: v.ref }, v.state)} />
              ))}
            </div>
          ))}
        </div>
      ))}
      {mods.length > 0 && <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground pt-2">Modifiers</p>}
      {mods.map(m => (
        <div key={m.ref} className="space-y-1.5">
          <p className="text-sm font-medium">{m.name}</p>
          {m.options.map(o => (
            <Row key={o.ref} indent name={o.name} sub={o.price_pence != null ? pence(o.price_pence) : ''} state={o.state} sales={o.sales}
              onClick={() => onEdit({ option_ref: o.ref }, o.state)} />
          ))}
        </div>
      ))}
      {!byCategory.length && !mods.length && <p className="text-sm text-muted-foreground">Nothing matches.</p>}
    </Card>
  )
}

// ── Rules ────────────────────────────────────────────────────────────────────

/** A rule's match in words, from the catalogue. */
function matchLabel(r, data) {
  if (r.kind === 'pattern' || r.kind === 'bucket') return patternWords(r, data.categories)
  const item = data.items.find(i => i.ref === r.item_ref)
  const variant = item?.variants.find(v => v.ref === r.variant_ref)
  const option = ref => {
    for (const m of data.modifiers) { const o = m.options.find(x => x.ref === ref); if (o) return o.name }
    return 'a modifier no longer on the till'
  }
  const itemName = item ? item.name + (variant && item.variants.length > 1 ? ' · ' + variant.name : '') : (r.ext_name || 'an item no longer on the till')
  if (r.kind === 'axis') {
    const what = r.axis_kind === 'variant' ? 'Variant option ' + r.axis_name : 'Modifier group ' + (data.modifiers.find(m => m.ref === r.axis_group_ref)?.name || '?')
    return what + (r.item_ref ? ' on ' + (item?.name || '?') : '')
  }
  if (r.kind === 'combination') return itemName + ' with ' + r.option_refs.map(option).join(', ')
  if (r.option_ref) return option(r.option_ref)
  return itemName
}

function Rules({ data, canManage, venueId, onEdit, onNew }) {
  const venueName = id => data.venues.find(v => v.venue_id === id)?.venue_name || 'a venue'
  const rules = data.rules.filter(r => !venueId || !r.venue_id || r.venue_id === venueId)
  return (
    <Card title={'Rules (' + rules.length + ')'}>
      {canManage && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btnOutline} onClick={() => onNew('combination')}><Plus className="w-4 h-4" /> Combination</button>
          <button type="button" className={btnOutline} onClick={() => onNew('axis')}><Layers className="w-4 h-4" /> Option axis</button>
          <button type="button" className={btnOutline} onClick={() => onNew('pattern')} data-testid="new-pattern"><Wand2 className="w-4 h-4" /> Pattern</button>
        </div>
      )}
      {!rules.length && <p className="text-sm text-muted-foreground">No rules yet. Tap an item in the catalogue to map it.</p>}
      <div className="space-y-2">
        {rules.map(r => (
          <button key={r.id} type="button" onClick={() => onEdit(r)} data-testid="rule-row"
            className="w-full min-h-[48px] px-3 py-2 rounded-xl border bg-background hover:bg-muted text-left touch-manipulation">
            <span className="flex items-center gap-2">
              <span className="text-[11px] font-semibold rounded-full px-2 py-0.5 bg-muted">{KINDS.find(k => k.key === r.kind)?.short}</span>
              <span className="text-sm font-medium truncate flex-1">{matchLabel(r, data)}</span>
              {canManage ? <Pencil className="w-4 h-4 text-muted-foreground shrink-0" /> : <Eye className="w-4 h-4 text-muted-foreground shrink-0" />}
            </span>
            <span className="block text-xs text-muted-foreground truncate mt-0.5">→ {r.target}</span>
            <span className="block text-[11px] text-muted-foreground">
              {r.venue_id ? venueName(r.venue_id) : 'Every venue'} · from {dayLabel(r.effective_from)}
            </span>
          </button>
        ))}
      </div>
    </Card>
  )
}

// ── The rule editor ──────────────────────────────────────────────────────────

function Segmented({ value, options, onChange, disabled }) {
  return (
    <div className="flex flex-wrap gap-2" role="group">
      {options.map(o => (
        <button key={o.key} type="button" disabled={disabled} onClick={() => onChange(o.key)} aria-pressed={value === o.key}
          className={cn('min-h-[48px] px-3 rounded-xl border text-sm touch-manipulation', value === o.key ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted')}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

function DishPicker({ dishes, value, onPick, placeholder = 'Search dishes', disabled }) {
  const [q, setQ] = useState('')
  const chosen = dishes.find(d => d.id === value)
  const t = q.trim().toLowerCase()
  const list = (t ? dishes.filter(d => d.name.toLowerCase().includes(t) || (d.section || '').toLowerCase().includes(t)) : dishes).slice(0, 30)
  return (
    <div className="space-y-2">
      {chosen && (
        <div className="flex items-center gap-2 rounded-xl border border-primary bg-primary/5 px-3 min-h-[48px]">
          <Check className="w-4 h-4 text-primary" />
          <span className="flex-1 text-sm font-medium truncate">{chosen.name}</span>
          <span className="text-xs text-muted-foreground">{chosen.price_pence != null ? pence(chosen.price_pence) : ''}</span>
          {!disabled && <button type="button" onClick={() => onPick(null)} className="h-12 w-12 -mr-3 flex items-center justify-center touch-manipulation" aria-label="Clear"><X className="w-4 h-4" /></button>}
        </div>
      )}
      {!disabled && (
        <>
          <label className="relative block">
            <Search className="w-4 h-4 absolute left-3 top-4 text-muted-foreground" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder={placeholder} aria-label={placeholder} className={cn(inputCls, 'pl-9')} />
          </label>
          <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
            {list.map(d => (
              <button key={d.id} type="button" onClick={() => { onPick(d.id); setQ('') }} data-testid="dish-option"
                className={cn('w-full min-h-[48px] px-3 py-1.5 rounded-xl border text-left touch-manipulation flex items-center gap-2 hover:bg-muted', d.id === value && 'ring-2 ring-primary')}>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm truncate">{d.name}</span>
                  <span className="block text-[11px] text-muted-foreground truncate">{d.menu} · {d.section}</span>
                </span>
                <span className="text-xs text-muted-foreground">{d.price_pence != null ? pence(d.price_pence) : ''}</span>
              </button>
            ))}
            {!list.length && <p className="text-sm text-muted-foreground">No dish matches.</p>}
          </div>
        </>
      )}
    </div>
  )
}

/** Our options for a dish: one per group, from the dish's own groups (others under More groups). */
function OptionPicker({ groups, dishGroupIds, value, onChange, disabled, single }) {
  const [more, setMore] = useState(false)
  const shown = groups.filter(g => more || !dishGroupIds || dishGroupIds.includes(g.id))
  const toggle = (g, o) => {
    if (single) { onChange(value.includes(o.id) ? [] : [o.id]); return }
    const others = value.filter(id => !g.options.some(x => x.id === id))
    onChange(value.includes(o.id) ? others : [...others, o.id])
  }
  return (
    <div className="space-y-2">
      {shown.map(g => (
        <div key={g.id} className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">{g.name}</p>
          <div className="flex flex-wrap gap-2">
            {g.options.map(o => (
              <button key={o.id} type="button" disabled={disabled} onClick={() => toggle(g, o)} aria-pressed={value.includes(o.id)}
                className={cn('min-h-[48px] px-3 rounded-xl border text-sm touch-manipulation', value.includes(o.id) ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted')}>
                {o.label}{o.price_pence ? ' +' + pence(o.price_pence) : ''}
              </button>
            ))}
          </div>
        </div>
      ))}
      {dishGroupIds && !more && groups.length > shown.length && (
        <button type="button" className={btnOutline} onClick={() => setMore(true)} disabled={disabled}>More option groups</button>
      )}
      {!groups.length && <p className="text-sm text-muted-foreground">No option groups yet.</p>}
    </div>
  )
}

function RuleEditor({ draft, data, menu, connectionId, venueId, canManage, onClose }) {
  const api = useApi()
  const qc = useQueryClient()
  const [r, setR] = useState(() => ({
    option_refs: [], target_option_ids: [], target_item_ids: [], axis_values: [], ...draft,
    venue_id: draft.id ? draft.venue_id : (draft.venue_id ?? (venueId || null)),
  }))
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [preview, setPreview] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const set = patch => { setR(x => ({ ...x, ...patch })); setPreview(null) }
  const ro = !canManage

  const dishes = useMemo(() => {
    const out = []
    for (const m of menu.menus) for (const s of m.sections) for (const i of s.items) {
      if (!out.some(d => d.id === i.id)) out.push({ ...i, menu: m.name, section: s.title })
    }
    return out
  }, [menu])
  const plain = dishes.filter(d => d.kind !== 'combo')
  const combos = dishes.filter(d => d.kind === 'combo')
  const item = data.items.find(i => i.ref === r.item_ref)
  const variant = item?.variants.find(v => v.ref === r.variant_ref)
  const option = r.option_ref ? data.modifiers.flatMap(m => m.options.map(o => ({ ...o, group: m.name }))).find(o => o.ref === r.option_ref) : null
  const dish = dishes.find(d => d.id === r.target_item_id)
  const fixedThing = !r.id && (r.item_ref || r.option_ref) && r.kind !== 'combination' && r.kind !== 'axis'
  const kinds = r.option_ref ? KINDS.filter(k => ['exact', 'ignore', 'keep'].includes(k.key)) : KINDS
  const allModifierOptions = data.modifiers.flatMap(m => m.options.map(o => ({ ...o, group: m.name })))

  // Axis: the values to match, from the catalogue.
  const axisNames = [...new Set(data.items.flatMap(i => i.axes))]
  const axisValues = useMemo(() => {
    if (r.kind !== 'axis') return []
    if (r.axis_kind === 'modifier') return (data.modifiers.find(m => m.ref === r.axis_group_ref)?.options || []).map(o => ({ from: o.ref, label: o.name }))
    const seen = new Set()
    for (const i of data.items) {
      if (r.item_ref && i.ref !== r.item_ref) continue
      const at = i.axes.findIndex(a => a.toLowerCase() === String(r.axis_name || '').toLowerCase())
      if (at < 0) continue
      for (const v of i.variants) if (v.values[at]) seen.add(v.values[at])
    }
    return [...seen].sort().map(v => ({ from: v, label: v }))
  }, [r.kind, r.axis_kind, r.axis_name, r.axis_group_ref, r.item_ref, data])
  const targetGroup = menu.groups.find(g => g.id === r.target_group_id)
  const axisOption = from => r.axis_values.find(v => v.from === from)?.option_id || ''
  const setAxisOption = (from, optionId) => set({ axis_values: [...r.axis_values.filter(v => v.from !== from), ...(optionId ? [{ from, option_id: optionId }] : [])] })

  const body = () => {
    const b = {
      kind: r.kind, venue_id: r.venue_id || null, effective_from: r.effective_from || null, note: r.note || null,
      item_ref: r.item_ref || null, variant_ref: r.variant_ref || null, option_ref: r.option_ref || null,
    }
    if (r.kind === 'combination') b.option_refs = r.option_refs
    if (r.kind === 'axis') Object.assign(b, { axis_kind: r.axis_kind, axis_name: r.axis_name || null, axis_group_ref: r.axis_group_ref || null, target_group_id: r.target_group_id || null, axis_values: r.axis_values })
    if (r.kind === 'exact' || r.kind === 'combination') {
      Object.assign(b, { target_item_id: r.target_item_id || null, target_combo_id: r.target_combo_id || null, target_option_ids: r.target_option_ids, target_item_ids: r.target_item_ids })
    }
    return b
  }

  async function run(what, fn) {
    setBusy(what); setError(null)
    try { await fn() } catch (e) { setError(e.message) }
    setBusy(null)
  }
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['item-mapping'] })
    qc.invalidateQueries({ queryKey: ['item-mapping-coverage'] })
  }
  const save = () => run('save', async () => {
    if (r.id) await api.put(`/integrations/mapping/${connectionId}/rules/${r.id}`, body())
    else await api.post(`/integrations/mapping/${connectionId}/rules`, body())
    refresh(); onClose()
  })
  const remove = () => run('delete', async () => {
    await api.delete(`/integrations/mapping/${connectionId}/rules/${r.id}`)
    refresh(); onClose()
  })
  const runPreview = () => run('preview', async () => {
    setPreview(await api.post(`/integrations/mapping/${connectionId}/preview`, { venue_id: venueId || null, rules: [{ ...body(), id: r.id || null }] }))
  })

  const thingName = option ? option.group + ': ' + option.name
    : item ? item.name + (variant && item.variants.length > 1 ? ' · ' + variant.name : r.kind === 'exact' && item.variants.length > 1 ? ' (every variant)' : '') : ''

  return (
    <Modal title={(r.id ? (ro ? 'Rule' : 'Change rule') : 'New rule') + (thingName ? ': ' + thingName : '')} onClose={onClose}
      footer={<>
        <button type="button" className={btnOutline} onClick={runPreview} disabled={!!busy}>
          {busy === 'preview' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />} Preview
        </button>
        {canManage && <button type="button" className={btnPrimary} onClick={save} disabled={!!busy} data-testid="rule-save">
          {busy === 'save' && <Loader2 className="w-4 h-4 animate-spin" />} Save rule
        </button>}
        {canManage && r.id && !confirmDelete && (
          <button type="button" className={cn(btnOutline, 'ml-auto text-destructive')} onClick={() => setConfirmDelete(true)} disabled={!!busy}>
            <Trash2 className="w-4 h-4" /> Delete
          </button>
        )}
        {confirmDelete && (
          <span className="ml-auto flex flex-wrap items-center gap-2">
            <span className="text-sm">Delete this rule?</span>
            <button type="button" className={btnOutline} onClick={() => setConfirmDelete(false)}>Keep it</button>
            <button type="button" className={btnDanger} onClick={remove} disabled={!!busy} data-testid="rule-delete-confirm">
              {busy === 'delete' && <Loader2 className="w-4 h-4 animate-spin" />} Yes, delete
            </button>
          </span>
        )}
      </>}>
      {ro && <ReadOnlyNotice what="the rules" />}
      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">What happens to it</p>
        <Segmented value={r.kind} disabled={ro || (!!r.id && ['combination', 'axis'].includes(r.kind))}
          options={r.id && ['combination', 'axis'].includes(r.kind) ? KINDS.filter(k => k.key === r.kind) : (fixedThing || r.id ? kinds.filter(k => !['combination', 'axis'].includes(k.key)) : kinds)}
          onChange={kind => set({ kind, axis_kind: kind === 'axis' ? (r.axis_kind || 'variant') : r.axis_kind })} />
        <p className="text-xs text-muted-foreground">
          {r.kind === 'exact' && (r.option_ref ? 'The modifier becomes one of your options, or a dish of its own (a side sold as a modifier).' : 'The item (or this variant) becomes your dish, with options and more dishes if it is a bundle, or a combo.')}
          {r.kind === 'combination' && 'The item sold with these modifiers becomes a combo or a dish; the modifiers are part of it.'}
          {r.kind === 'axis' && 'A variant option (Size) or a modifier group becomes one of your option groups, value by value, on whichever dish the item maps to.'}
          {r.kind === 'ignore' && 'Not a sale (a gift card, a deposit): left out of what was sold and of coverage.'}
          {r.kind === 'keep' && 'Reported under its own name, not as one of your dishes.'}
        </p>
      </div>

      {/* The match */}
      {r.kind === 'combination' && (
        <div className="space-y-2">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Item</span>
            <select value={r.item_ref || ''} disabled={ro} onChange={e => set({ item_ref: e.target.value || null, variant_ref: null })} className={inputCls}>
              <option value="">Choose the item</option>
              {data.items.map(i => <option key={i.ref} value={i.ref}>{i.name}</option>)}
            </select>
          </label>
          {item && item.variants.length > 1 && (
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Variant</span>
              <select value={r.variant_ref || ''} disabled={ro} onChange={e => set({ variant_ref: e.target.value || null })} className={inputCls}>
                <option value="">Any variant</option>
                {item.variants.map(v => <option key={v.ref} value={v.ref}>{v.name}</option>)}
              </select>
            </label>
          )}
          <p className="text-xs font-medium text-muted-foreground">Sold with every one of these modifiers</p>
          <div className="flex flex-wrap gap-2">
            {allModifierOptions.map(o => (
              <button key={o.ref} type="button" disabled={ro} aria-pressed={r.option_refs.includes(o.ref)}
                onClick={() => set({ option_refs: r.option_refs.includes(o.ref) ? r.option_refs.filter(x => x !== o.ref) : [...r.option_refs, o.ref] })}
                className={cn('min-h-[48px] px-3 rounded-xl border text-sm touch-manipulation', r.option_refs.includes(o.ref) ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted')}>
                {o.group}: {o.name}
              </button>
            ))}
          </div>
        </div>
      )}
      {r.kind === 'axis' && (
        <div className="space-y-2">
          <Segmented value={r.axis_kind} disabled={ro || !!r.id} onChange={k => set({ axis_kind: k, axis_values: [] })}
            options={[{ key: 'variant', label: 'A variant option' }, { key: 'modifier', label: 'A modifier group' }]} />
          {r.axis_kind === 'variant' ? (
            <select value={r.axis_name || ''} disabled={ro} onChange={e => set({ axis_name: e.target.value || null, axis_values: [] })} className={inputCls} aria-label="Variant option">
              <option value="">Choose the variant option</option>
              {axisNames.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          ) : (
            <select value={r.axis_group_ref || ''} disabled={ro} onChange={e => set({ axis_group_ref: e.target.value || null, axis_values: [] })} className={inputCls} aria-label="Modifier group">
              <option value="">Choose the modifier group</option>
              {data.modifiers.map(m => <option key={m.ref} value={m.ref}>{m.name}</option>)}
            </select>
          )}
          <select value={r.item_ref || ''} disabled={ro} onChange={e => set({ item_ref: e.target.value || null })} className={inputCls} aria-label="Limit to one item">
            <option value="">On every item</option>
            {data.items.map(i => <option key={i.ref} value={i.ref}>Only on {i.name}</option>)}
          </select>
          <select value={r.target_group_id || ''} disabled={ro} onChange={e => set({ target_group_id: e.target.value || null, axis_values: [] })} className={inputCls} aria-label="Our option group">
            <option value="">Choose your option group</option>
            {menu.groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          {targetGroup && axisValues.map(v => (
            <label key={v.from} className="flex items-center gap-2">
              <span className="text-sm w-32 shrink-0 truncate">{v.label}</span>
              <span className="text-muted-foreground">→</span>
              <select value={axisOption(v.from)} disabled={ro} onChange={e => setAxisOption(v.from, e.target.value)} className={inputCls} aria-label={'Option for ' + v.label}>
                <option value="">Nothing</option>
                {targetGroup.options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </label>
          ))}
        </div>
      )}

      {/* The target */}
      {(r.kind === 'exact' || r.kind === 'combination') && (
        <div className="space-y-3">
          {!r.option_ref && (
            <Segmented value={r.target_combo_id != null || r.as_combo ? 'combo' : 'dish'} disabled={ro}
              options={[{ key: 'dish', label: 'A dish' }, { key: 'combo', label: 'A combo' }]}
              onChange={k => set(k === 'combo' ? { as_combo: true, target_item_id: null, target_option_ids: [], target_item_ids: [] } : { as_combo: false, target_combo_id: null })} />
          )}
          {r.option_ref ? (
            <>
              <Segmented value={r.target_item_id || r.as_dish ? 'dish' : 'option'} disabled={ro}
                options={[{ key: 'option', label: 'One of your options' }, { key: 'dish', label: 'A dish of its own' }]}
                onChange={k => set(k === 'dish' ? { as_dish: true, target_option_ids: [] } : { as_dish: false, target_item_id: null })} />
              {r.target_item_id || r.as_dish
                ? <DishPicker dishes={plain} value={r.target_item_id} onPick={id => set({ target_item_id: id })} disabled={ro} />
                : <OptionPicker groups={menu.groups} value={r.target_option_ids} single onChange={ids => set({ target_option_ids: ids })} disabled={ro} />}
            </>
          ) : (r.target_combo_id != null || r.as_combo) ? (
            <DishPicker dishes={combos} value={r.target_combo_id} placeholder="Search combos" onPick={id => set({ target_combo_id: id })} disabled={ro} />
          ) : (
            <>
              <DishPicker dishes={plain} value={r.target_item_id} onPick={id => set({ target_item_id: id })} disabled={ro} />
              {dish && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">With these options (any left out can come from an axis rule)</p>
                  <OptionPicker groups={menu.groups} dishGroupIds={dish.group_ids} value={r.target_option_ids} onChange={ids => set({ target_option_ids: ids })} disabled={ro} />
                </div>
              )}
              {dish && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">And more dishes (a bundle)</p>
                  {r.target_item_ids.map(id => (
                    <div key={id} className="flex items-center gap-2 rounded-xl border px-3 min-h-[48px]">
                      <span className="flex-1 text-sm">{dishes.find(d => d.id === id)?.name || 'A dish'}</span>
                      {!ro && <button type="button" className="h-12 w-12 -mr-3 flex items-center justify-center touch-manipulation" aria-label="Remove" onClick={() => set({ target_item_ids: r.target_item_ids.filter(x => x !== id) })}><X className="w-4 h-4" /></button>}
                    </div>
                  ))}
                  {!ro && <BundleAdd dishes={plain.filter(d => d.id !== r.target_item_id && !r.target_item_ids.includes(d.id))} onAdd={id => set({ target_item_ids: [...r.target_item_ids, id] })} />}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Scope and date */}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Where</span>
          <select value={r.venue_id || ''} disabled={ro || !!r.id} onChange={e => set({ venue_id: e.target.value || null })} className={inputCls}>
            <option value="">Every venue on the connection</option>
            {data.venues.map(v => <option key={v.venue_id} value={v.venue_id}>Only {v.venue_name}</option>)}
          </select>
        </label>
        <div className="space-y-1">
          <span className="block text-xs font-medium text-muted-foreground">From</span>
          <div className="relative">
            <div className={cn(inputCls, 'flex items-center')}>{r.effective_from ? dayLabel(r.effective_from) : 'The start of stored sales'}</div>
            <input type="date" value={r.effective_from || ''} disabled={ro} onChange={e => set({ effective_from: e.target.value || null })}
              className="absolute inset-0 opacity-0 w-full h-full cursor-pointer touch-manipulation" aria-label="Effective from" />
          </div>
          {r.effective_from && !ro && <button type="button" className="text-xs underline min-h-[48px] touch-manipulation" onClick={() => set({ effective_from: null })}>From the start of stored sales</button>}
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {preview && <PreviewResult p={preview} />}
    </Modal>
  )
}

function BundleAdd({ dishes, onAdd }) {
  const [open, setOpen] = useState(false)
  if (!open) return <button type="button" className={btnOutline} onClick={() => setOpen(true)}><Plus className="w-4 h-4" /> Add a dish</button>
  return <DishPicker dishes={dishes} value={null} onPick={id => { if (id) onAdd(id); setOpen(false) }} />
}

function PreviewResult({ p }) {
  const delta = (p.after.mapped || 0) - (p.before.mapped || 0)
  return (
    <div className="rounded-xl border bg-muted/30 p-3 space-y-2" data-testid="preview-result">
      <p className="text-sm font-medium">
        Last {p.days} days: {p.changed} line{p.changed === 1 ? '' : 's'} would change.
        {delta !== 0 && ' Mapped sales ' + (delta > 0 ? 'up ' : 'down ') + pence(Math.abs(delta)) + '.'}
      </p>
      <p className="text-xs text-muted-foreground">Nothing is saved until you tap Save rule.</p>
      {p.changes.slice(0, 12).map((c, i) => (
        <div key={i} className="text-xs flex flex-wrap gap-x-2 border-t pt-1.5">
          <span className="font-medium">{c.name}</span>
          <span className="text-muted-foreground">{dayLabel(c.business_date)} · {pence(c.net_pence)}</span>
          <span className="w-full">{c.before.target || c.before.state} → <strong>{c.after.target || c.after.state}</strong></span>
        </div>
      ))}
      {p.by_target.length > 0 && (
        <div className="space-y-1 border-t pt-2">
          <p className="text-xs font-medium text-muted-foreground">Sales by your dish, option or combo after the change</p>
          {p.by_target.slice(0, 8).map(t => (
            <div key={t.kind + t.id} className="text-xs flex justify-between gap-2"><span className="truncate">{t.name}</span><span className="tabular-nums">{pence(t.net_pence)}</span></div>
          ))}
        </div>
      )}
    </div>
  )
}
