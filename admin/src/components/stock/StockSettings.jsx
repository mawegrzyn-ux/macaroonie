// src/components/stock/StockSettings.jsx
//
// The Stock page's Settings tab (inventory phase 4a; Stock manage, read
// only below it): the venue's storage areas (drag to order, each with its
// items in shelf order: an item can be in two areas and the count adds
// them), the group's key-item lists, how counts are approved (a second
// person) and counted (blind), and the venue's count day for Today; the
// group's waste reasons in WRAP's kinds (phase 4b: drag to order, switched
// off once used), the variance band (phase 6a) and the suggested order's
// buffer (phase 9a). Each card saves on its own (the areas' and reasons'
// order as it is dropped).
//
//   StockSettings({ venueId, canManage })
//   API routes/stockSetup.js: /api/stock/venues/:id/areas, /areas/:id, /key-lists, /settings;
//       routes/stockWaste.js: /api/stock/waste-reasons; routes/stockForecast.js: /api/stock/forecast-settings

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ListChecks, Loader2, Pencil, Plus, Search, X } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Field, inputCls, ErrorNote, SortableRows, ConfirmDelete, Segmented } from '@/components/staff/shared'
import { Card, Drawer, Toggle, btn } from '@/components/purchasing/shared'
import { ReadOnlyNotice, ReadOnlyFieldset } from '@/components/ReadOnlyNotice'
import { useStockList, matchItem, KindBadge } from '@/components/stock/shared'
import { WEEKDAYS, WASTE_KINDS, WASTE_KIND_KEYS } from '@shared/stock.js'
import { PAR_MODES } from '@shared/procurement.js'
import { bufferProblem, BUFFER_PCT_MAX } from '@shared/forecast.js'

/** Items in order, with a search to add more and a cross to take one off; Save sends the whole list. */
function ItemsEditor({ title, subtitle, venueId, initial, name, onSave, saving, error, onClose, canManage, onDelete }) {
  const { data } = useStockList(venueId)
  const all = useMemo(() => data?.items || [], [data])
  const [ids, setIds] = useState(initial)
  const [label, setLabel] = useState(name ?? null)
  const [search, setSearch] = useState('')
  const byId = useMemo(() => new Map(all.map(i => [i.item_id, i])), [all])
  const rows = useMemo(() => ids.map(id => ({ id, name: byId.get(id)?.name || 'An item no longer in use' })), [ids, byId])
  const found = search.trim() ? all.filter(i => !ids.includes(i.item_id) && matchItem(i, search)).slice(0, 8) : []
  return (
    <Drawer title={title} subtitle={subtitle} onClose={onClose}
      footer={canManage && <>
        <button type="button" className={btn.primary + ' h-12'} disabled={saving || (label !== null && !label.trim())}
          onClick={() => onSave({ item_ids: ids, ...(label !== null ? { name: label.trim() } : {}) })} data-testid="stock-items-save">
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}Save
        </button>
        <button type="button" className={btn.outline + ' h-12'} onClick={onClose}>Close</button>
        {onDelete && <span className="ml-auto"><ConfirmDelete onConfirm={onDelete} label="Delete this list" big /></span>}
      </>}>
      <ReadOnlyFieldset disabled={!canManage} className="space-y-3">
        {label !== null && (
          <Field label="Name"><input value={label} onChange={e => setLabel(e.target.value)} maxLength={60} className={cn(inputCls, 'h-12')} data-testid="stock-list-name" /></Field>
        )}
        <Field label="Add an item">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Name, code or barcode" className={cn(inputCls, 'pl-9 h-12')} data-testid="stock-items-search" />
          </div>
          {found.length > 0 && (
            <div className="mt-1 rounded-lg border divide-y bg-background">
              {found.map(i => (
                <button key={i.item_id} type="button" onClick={() => { setIds(x => [...x, i.item_id]); setSearch('') }} data-testid="stock-items-add"
                  className="w-full text-left px-3 py-2 text-sm hover:bg-muted min-h-[48px] touch-manipulation flex items-center gap-2">
                  <Plus className="w-4 h-4" />{i.name}
                </button>
              ))}
            </div>
          )}
        </Field>
        <p className="text-xs text-muted-foreground">{ids.length} item{ids.length === 1 ? '' : 's'}, in the order they are counted. Drag to put them in shelf order.</p>
        <SortableRows items={rows} locked={!canManage} onReorder={order => setIds(order)} renderItem={r => (
          <div className="flex items-center gap-2 min-h-[44px]" data-testid="stock-items-row" data-item={r.name}>
            <span className="flex-1 text-sm">{r.name}</span>
            {canManage && (
              <button type="button" onClick={() => setIds(x => x.filter(id => id !== r.id))} aria-label={'Take ' + r.name + ' off'}
                className="w-11 h-11 flex items-center justify-center rounded-lg hover:bg-muted touch-manipulation"><X className="w-4 h-4" /></button>
            )}
          </div>
        )} />
        <ErrorNote error={error} />
      </ReadOnlyFieldset>
    </Drawer>
  )
}

function AreasCard({ venueId, canManage }) {
  const api = useApi()
  const qc = useQueryClient()
  const key = ['stock', venueId, 'areas']
  const { data: areas = [], isLoading, error } = useQuery({ queryKey: key, queryFn: () => api.get(`/stock/venues/${venueId}/areas`), enabled: !!venueId })
  const [name, setName] = useState('')
  const [renaming, setRenaming] = useState(null)
  const [editing, setEditing] = useState(null)
  const done = () => qc.invalidateQueries({ queryKey: ['stock', venueId] })
  const add = useMutation({ mutationFn: () => api.post(`/stock/venues/${venueId}/areas`, { name: name.trim() }), onSuccess: () => { setName(''); done() } })
  const rename = useMutation({ mutationFn: ({ id, name: n }) => api.patch('/stock/areas/' + id, { name: n }), onSuccess: () => { setRenaming(null); done() } })
  const remove = useMutation({ mutationFn: id => api.delete('/stock/areas/' + id), onSuccess: done })
  const order = useMutation({ mutationFn: ids => api.put(`/stock/venues/${venueId}/areas/order`, { ids }), onSuccess: done })
  const saveItems = useMutation({ mutationFn: ({ id, item_ids }) => api.put(`/stock/areas/${id}/items`, { item_ids }), onSuccess: () => { setEditing(null); done() } })
  const rows = useMemo(() => areas, [areas])
  return (
    <Card title="Storage areas">
      <div className="space-y-3" data-testid="stock-areas">
        <p className="text-xs text-muted-foreground">Walk-in, dry store, bar: the count sheet goes area by area. Stock is the venue&apos;s, not the area&apos;s: an item kept in two areas is counted in both and the count adds them.</p>
        {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : (
          <SortableRows items={rows} locked={!canManage} onReorder={ids => order.mutate(ids)} renderItem={a => (
            <div className="flex flex-wrap items-center gap-2 min-h-[44px]" data-testid="stock-area-row" data-area={a.name}>
              {renaming?.id === a.id ? (
                <>
                  <input value={renaming.name} onChange={e => setRenaming({ ...renaming, name: e.target.value })} maxLength={60} className={cn(inputCls, 'flex-1 min-w-[8rem]')} aria-label="Area name" />
                  <button type="button" className={btn.primary} disabled={!renaming.name.trim()} onClick={() => rename.mutate({ id: a.id, name: renaming.name.trim() })}>Save</button>
                  <button type="button" className={btn.ghost} onClick={() => setRenaming(null)}>Cancel</button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm font-medium">{a.name} <span className="text-xs text-muted-foreground font-normal">{a.items.length} item{a.items.length === 1 ? '' : 's'}</span></span>
                  <button type="button" className={btn.outline} onClick={() => setEditing(a)} data-testid="stock-area-items"><ListChecks className="w-4 h-4" />Items</button>
                  {canManage && <button type="button" className={btn.ghost} aria-label={'Rename ' + a.name} onClick={() => setRenaming({ id: a.id, name: a.name })}><Pencil className="w-4 h-4" /></button>}
                  {canManage && <ConfirmDelete onConfirm={() => remove.mutate(a.id)} label={'Delete ' + a.name} />}
                </>
              )}
            </div>
          )} />
        )}
        {!isLoading && !areas.length && <p className="text-sm text-muted-foreground">No storage areas yet: a count then lists the venue&apos;s items in one go.</p>}
        {canManage && (
          <div className="flex gap-2">
            <input value={name} onChange={e => setName(e.target.value)} maxLength={60} placeholder="A new area, e.g. Walk-in" className={cn(inputCls, 'h-12 flex-1')} data-testid="stock-area-name" />
            <button type="button" className={btn.primary + ' h-12'} disabled={!name.trim() || add.isPending} onClick={() => add.mutate()} data-testid="stock-area-add"><Plus className="w-4 h-4" />Add</button>
          </div>
        )}
        <ErrorNote error={error || add.error || rename.error || remove.error || order.error} />
      </div>
      {editing && (
        <ItemsEditor title={editing.name} subtitle="Items in this area" venueId={venueId} initial={editing.items.map(i => i.item_id)}
          canManage={canManage} saving={saveItems.isPending} error={saveItems.error}
          onSave={b => saveItems.mutate({ id: editing.id, item_ids: b.item_ids })} onClose={() => setEditing(null)} />
      )}
    </Card>
  )
}

function KeyListsCard({ venueId, canManage }) {
  const api = useApi()
  const qc = useQueryClient()
  const { data: lists = [], isLoading, error } = useQuery({ queryKey: ['stock', 'key-lists'], queryFn: () => api.get('/stock/key-lists') })
  const [editing, setEditing] = useState(null)
  const done = () => { setEditing(null); qc.invalidateQueries({ queryKey: ['stock', 'key-lists'] }) }
  const save = useMutation({
    mutationFn: b => (editing.id ? api.put('/stock/key-lists/' + editing.id, b) : api.post('/stock/key-lists', b)),
    onSuccess: done,
  })
  const remove = useMutation({ mutationFn: id => api.delete('/stock/key-lists/' + id), onSuccess: done })
  return (
    <Card title="Key-item lists" actions={canManage && (
      <button type="button" className={btn.outline} onClick={() => setEditing({ id: null, name: '', items: [] })} data-testid="stock-list-new"><Plus className="w-4 h-4" />New list</button>
    )}>
      <div className="space-y-2" data-testid="stock-key-lists">
        <p className="text-xs text-muted-foreground">A short list for a quick count (proteins, cheese, what goes missing). Items not on it keep their figures.</p>
        {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : lists.map(l => (
          <button key={l.id} type="button" onClick={() => setEditing(l)} data-testid="stock-list-row" data-list={l.name}
            className="w-full flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm hover:bg-muted min-h-[48px] touch-manipulation">
            <span className="flex-1 font-medium">{l.name}</span><span className="text-xs text-muted-foreground">{l.items.length} item{l.items.length === 1 ? '' : 's'}</span>
          </button>
        ))}
        {!isLoading && !lists.length && <p className="text-sm text-muted-foreground">No key-item lists yet.</p>}
        <ErrorNote error={error || remove.error} />
      </div>
      {editing && (
        <ItemsEditor title={editing.id ? editing.name : 'New key-item list'} subtitle="Key items" venueId={venueId} initial={editing.items.map(i => i.item_id)}
          name={editing.name} canManage={canManage} saving={save.isPending} error={save.error}
          onSave={b => save.mutate(b)} onClose={() => setEditing(null)} onDelete={editing.id ? () => remove.mutate(editing.id) : null} />
      )}
    </Card>
  )
}

function ApprovalCard({ canManage }) {
  const api = useApi()
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['stock', 'settings'], queryFn: () => api.get('/stock/settings') })
  const [draft, setDraft] = useState(null)
  useEffect(() => { if (data) setDraft({ second_person_approves: data.second_person_approves, blind_count: data.blind_count, refunds_return_stock: data.refunds_return_stock }) }, [data])
  const save = useMutation({
    mutationFn: () => api.put('/stock/settings', draft),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stock'] }),
  })
  const dirty = data && draft && (draft.second_person_approves !== data.second_person_approves || draft.blind_count !== data.blind_count
    || draft.refunds_return_stock !== data.refunds_return_stock)
  return (
    <Card title="Approving and counting">
      {!draft ? <Loader2 className="w-5 h-5 animate-spin" /> : (
        <ReadOnlyFieldset disabled={!canManage} className="space-y-3" data-testid="stock-approval">
          <div>
            <Toggle checked={draft.second_person_approves} onChange={v => setDraft({ ...draft, second_person_approves: v })} label="A second person approves" />
            <p className="text-xs text-muted-foreground">Whoever approves a count (Stock manage) must be someone who didn&apos;t count or submit it.</p>
          </div>
          <div>
            <Toggle checked={draft.blind_count} onChange={v => setDraft({ ...draft, blind_count: v })} label="Blind counts" />
            <p className="text-xs text-muted-foreground">What is expected stays hidden while counting, so people count what is there. It shows once the count is submitted.</p>
          </div>
          <div>
            <Toggle checked={draft.refunds_return_stock} onChange={v => setDraft({ ...draft, refunds_return_stock: v })} label="Refunds on other tills give stock back" />
            <p className="text-xs text-muted-foreground">Off: a refund from Loyverse or Square gives nothing back to stock (the food was usually made and eaten). On: what the refunded dishes used goes back on.</p>
          </div>
          {canManage && (
            <button type="button" className={btn.primary + ' h-12'} disabled={!dirty || save.isPending} onClick={() => save.mutate()} data-testid="stock-approval-save">
              {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />}Save
            </button>
          )}
          <ErrorNote error={save.error} />
        </ReadOnlyFieldset>
      )}
    </Card>
  )
}

function CountDayCard({ venueId, canManage }) {
  const api = useApi()
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['stock', 'settings'], queryFn: () => api.get('/stock/settings') })
  const lists = useQuery({ queryKey: ['stock', 'key-lists'], queryFn: () => api.get('/stock/key-lists') })
  const mine = data?.venues?.find(v => v.venue_id === venueId)
  const [draft, setDraft] = useState(null)
  useEffect(() => { if (mine) setDraft({ count_weekday: mine.count_weekday, count_kind: mine.count_kind, key_list_id: mine.key_list_id, par_mode: mine.par_mode ?? null }) }, [mine?.venue_id, data])
  const save = useMutation({
    mutationFn: () => api.put(`/stock/venues/${venueId}/settings`, {
      ...draft, key_list_id: draft.count_kind === 'key' ? (draft.key_list_id || lists.data?.[0]?.id || null) : null,
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stock', 'settings'] }),
  })
  return (
    <Card title={'Count day and pars' + (mine ? ' at ' + mine.name : '')}>
      {!draft ? <Loader2 className="w-5 h-5 animate-spin" /> : (
        <ReadOnlyFieldset disabled={!canManage} className="space-y-3" data-testid="stock-count-day">
          <p className="text-xs text-muted-foreground">On this day Today shows a count due until one is submitted.</p>
          <div className="flex flex-wrap gap-3 items-end">
            <Field label="Day">
              <select className={cn(inputCls, 'h-12 w-44')} value={draft.count_weekday ?? ''} data-testid="stock-count-weekday"
                onChange={e => setDraft({ ...draft, count_weekday: e.target.value === '' ? null : Number(e.target.value) })}>
                <option value="">No count day</option>
                {[1, 2, 3, 4, 5, 6, 0].map(d => <option key={d} value={d}>{WEEKDAYS[d]}</option>)}
              </select>
            </Field>
            <Field label="Kind of count" group>
              <Segmented value={draft.count_kind} onChange={v => setDraft({ ...draft, count_kind: v })}
                options={[{ value: 'full', label: 'Full' }, { value: 'key', label: 'Key items' }]} />
            </Field>
            {draft.count_kind === 'key' && (
              <Field label="List">
                <select className={cn(inputCls, 'h-12 w-48')} value={draft.key_list_id || lists.data?.[0]?.id || ''} onChange={e => setDraft({ ...draft, key_list_id: e.target.value })}>
                  {(lists.data || []).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </Field>
            )}
          </div>
          <Field label="Pars on order lists">
            <select className={cn(inputCls, 'h-12 w-full sm:w-80')} value={draft.par_mode ?? ''} data-testid="stock-par-mode"
              onChange={e => setDraft({ ...draft, par_mode: e.target.value || null })}>
              <option value="">Up to par once there is an approved count (now: {mine?.counted ? 'up to par' : 'order the par'})</option>
              {Object.entries(PAR_MODES).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
            </select>
          </Field>
          <p className="text-xs text-muted-foreground">Up to par: Fill to par on an order orders the par less what is on hand and already on order. Order the par: the par is ordered as it is.</p>
          {canManage && (
            <button type="button" className={btn.primary + ' h-12'} disabled={save.isPending || (draft.count_kind === 'key' && !lists.data?.length)} onClick={() => save.mutate()} data-testid="stock-count-day-save">
              {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />}Save
            </button>
          )}
          <ErrorNote error={save.error} />
        </ReadOnlyFieldset>
      )}
    </Card>
  )
}

/**
 * The group's waste reasons (phase 4b), each of WRAP's three kinds, dragged
 * into the order the waste form lists them (saved as it is dropped). A reason
 * already on logged waste is switched off, never deleted.
 */
function WasteReasonsCard({ canManage }) {
  const api = useApi()
  const qc = useQueryClient()
  const key = ['stock', 'waste-reasons']
  const { data: reasons = [], isLoading, error } = useQuery({ queryKey: key, queryFn: () => api.get('/stock/waste-reasons') })
  const [name, setName] = useState('')
  const [kind, setKind] = useState('preparation')
  const [editing, setEditing] = useState(null)
  const done = () => { qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ['stock'] }) }
  const add = useMutation({ mutationFn: () => api.post('/stock/waste-reasons', { name: name.trim(), kind }), onSuccess: () => { setName(''); done() } })
  const save = useMutation({ mutationFn: r => api.put('/stock/waste-reasons/' + r.id, { name: r.name.trim(), kind: r.kind, is_active: r.is_active }), onSuccess: () => { setEditing(null); done() } })
  const remove = useMutation({ mutationFn: id => api.delete('/stock/waste-reasons/' + id), onSuccess: done })
  const order = useMutation({ mutationFn: ids => api.put('/stock/waste-reasons/order', { ids }), onSuccess: done })
  const rows = useMemo(() => reasons, [reasons])
  const kinds = WASTE_KIND_KEYS.map(k => ({ value: k, label: WASTE_KINDS[k].label }))
  return (
    <Card title="Waste reasons">
      <div className="space-y-3" data-testid="waste-reasons-card">
        <p className="text-xs text-muted-foreground">
          Each reason is one of WRAP&apos;s three kinds: spoilage (gone off or out of date), preparation (lost in the kitchen) or plate (what guests leave or send back).
          Drag them into the order the waste form shows them. A reason already on logged waste is switched off rather than deleted: change it (the pencil), switch it off and Save.
        </p>
        {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : (
          <SortableRows items={rows} locked={!canManage} onReorder={ids => order.mutate(ids)} renderItem={r => (
            <div className="flex flex-wrap items-center gap-2 min-h-[44px]" data-testid="waste-reason-row" data-reason={r.name}>
              {editing?.id === r.id ? (
                <>
                  <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} maxLength={60} className={cn(inputCls, 'flex-1 min-w-[8rem]')} aria-label="Reason" />
                  <Segmented value={editing.kind} onChange={v => setEditing({ ...editing, kind: v })} options={kinds} />
                  {/* Switched on or off with the rest of the reason, saved by Save (design rule 5). */}
                  <Toggle checked={editing.is_active} onChange={on => setEditing({ ...editing, is_active: on })} label={editing.is_active ? 'On' : 'Off'} />
                  <button type="button" className={btn.primary} disabled={!editing.name.trim() || save.isPending} onClick={() => save.mutate(editing)} data-testid="waste-reason-save">Save</button>
                  <button type="button" className={btn.ghost} onClick={() => setEditing(null)}>Cancel</button>
                </>
              ) : (
                <>
                  <span className={cn('flex-1 text-sm font-medium', !r.is_active && 'text-muted-foreground line-through')}>{r.name}</span>
                  <KindBadge kind={r.kind} />
                  {r.used > 0 && <span className="text-xs text-muted-foreground">{r.used} logged</span>}
                  {!r.is_active && <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium" data-testid="waste-reason-off">Switched off</span>}
                  {canManage && (
                    <>
                      <button type="button" className={btn.ghost} aria-label={'Change ' + r.name} onClick={() => setEditing({ ...r })}><Pencil className="w-4 h-4" /></button>
                      {!r.used && <ConfirmDelete onConfirm={() => remove.mutate(r.id)} label={'Delete ' + r.name} />}
                    </>
                  )}
                </>
              )}
            </div>
          )} />
        )}
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <input value={name} onChange={e => setName(e.target.value)} maxLength={60} placeholder="A new reason, e.g. Fridge failed" className={cn(inputCls, 'h-12 flex-1 min-w-[12rem]')} data-testid="waste-reason-name" />
            <select value={kind} onChange={e => setKind(e.target.value)} aria-label="Kind" className={cn(inputCls, 'h-12 w-40')} data-testid="waste-reason-kind">
              {kinds.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
            <button type="button" className={btn.primary + ' h-12'} disabled={!name.trim() || add.isPending} onClick={() => add.mutate()} data-testid="waste-reason-add"><Plus className="w-4 h-4" />Add</button>
          </div>
        )}
        <ErrorNote error={error || add.error || save.error || remove.error || order.error} />
      </div>
    </Card>
  )
}

/** The variance band (phase 6a): when a venue's period, and an item in it, is flagged. Saved on its own. */
function VarianceBandCard({ canManage }) {
  const api = useApi()
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['stock', 'settings'], queryFn: () => api.get('/stock/settings') })
  const [draft, setDraft] = useState(null)
  useEffect(() => { if (data?.variance) setDraft({ ...data.variance }) }, [data])
  const save = useMutation({
    mutationFn: () => api.put('/stock/variance-settings', { band_pct: Number(draft.band_pct), item_pct: Number(draft.item_pct), item_pounds: Number(draft.item_pounds) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stock'] }),
  })
  const v = data?.variance
  const keys = ['band_pct', 'item_pct', 'item_pounds']
  const dirty = v && draft && keys.some(k => Number(draft[k]) !== Number(v[k]))
  const bad = draft && keys.some(k => draft[k] === '' || !Number.isFinite(Number(draft[k])) || Number(draft[k]) < 0)
  const num = (key, label, hint, step) => (
    <Field label={label} hint={hint}>
      <input type="number" inputMode="decimal" min="0" step={step} className={inputCls} value={draft[key]}
        onChange={e => setDraft({ ...draft, [key]: e.target.value })} data-testid={'variance-band-' + key} />
    </Field>
  )
  return (
    <Card title="Variance band">
      {!draft ? <Loader2 className="w-5 h-5 animate-spin" /> : (
        <ReadOnlyFieldset disabled={!canManage} className="space-y-3" data-testid="stock-variance-band">
          {num('band_pct', 'A venue is over the band at (points of food sales)', 'Unexplained loss in a period over this share of its net food sales: 1 means 1% of food sales.', '0.1')}
          <div className="grid gap-3 sm:grid-cols-2">
            {num('item_pct', 'An item is flagged over (% of what sales took)', null, '0.5')}
            {num('item_pounds', 'and over (pounds)', null, '1')}
          </div>
          <p className="text-xs text-muted-foreground">An item is flagged when its unexplained loss, or gain, is over both: by default over 3% and over £50.</p>
          {canManage && (
            <button type="button" className={btn.primary + ' h-12'} disabled={!dirty || bad || save.isPending} onClick={() => save.mutate()} data-testid="variance-band-save">
              {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />}Save
            </button>
          )}
          <ErrorNote error={save.error} />
        </ReadOnlyFieldset>
      )}
    </Card>
  )
}

// The suggested order's buffer (inventory phase 9a, migration 319): a share of the forecast added on top
// before what is on hand and on order is taken off. Saved on its own (PUT /api/stock/forecast-settings).
function BufferCard({ canManage }) {
  const api = useApi()
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['stock', 'settings'], queryFn: () => api.get('/stock/settings') })
  const [draft, setDraft] = useState(null)
  useEffect(() => { if (data?.buffer_pct != null) setDraft(String(data.buffer_pct)) }, [data])
  const save = useMutation({
    mutationFn: () => api.put('/stock/forecast-settings', { buffer_pct: Number(draft) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stock'] }),
  })
  const problem = draft == null ? null : bufferProblem(draft)
  const dirty = draft != null && data && Number(draft) !== Number(data.buffer_pct)
  return (
    <Card title="Suggested orders">
      {draft == null ? <Loader2 className="w-5 h-5 animate-spin" /> : (
        <div data-testid="stock-buffer"><ReadOnlyFieldset disabled={!canManage} className="space-y-3">
          <Field label="Buffer on top of the forecast (%)" hint={problem || 'Suggest on the order form adds this share of what sales are forecast to use until the delivery after next, then takes off what is on hand and on order. 10 unless you change it.'}>
            <input type="number" inputMode="decimal" min="0" max={BUFFER_PCT_MAX} step="1" className={inputCls} value={draft}
              onChange={e => setDraft(e.target.value)} data-testid="stock-buffer-pct" />
          </Field>
          {canManage && (
            <button type="button" className={btn.primary + ' h-12'} disabled={!dirty || !!problem || save.isPending} onClick={() => save.mutate()} data-testid="stock-buffer-save">
              {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />}Save
            </button>
          )}
          <ErrorNote error={save.error} />
        </ReadOnlyFieldset></div>
      )}
    </Card>
  )
}

export default function StockSettings({ venueId, canManage }) {
  return (
    <div className="space-y-4" data-testid="stock-settings">
      {!canManage && <ReadOnlyNotice what="the stock settings" />}
      <AreasCard venueId={venueId} canManage={canManage} />
      <KeyListsCard venueId={venueId} canManage={canManage} />
      <div className="grid gap-4 lg:grid-cols-2">
        <ApprovalCard canManage={canManage} />
        <CountDayCard venueId={venueId} canManage={canManage} />
      </div>
      <WasteReasonsCard canManage={canManage} />
      <div className="grid gap-4 lg:grid-cols-2">
        <VarianceBandCard canManage={canManage} />
        <BufferCard canManage={canManage} />
      </div>
    </div>
  )
}
