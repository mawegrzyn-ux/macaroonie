// src/pages/OrderLists.jsx
//
// Order lists (/purchasing/lists, purchasing_setup): what a venue orders
// from, e.g. "Daily fresh" or "Weekly dry goods". A list can mix suppliers:
// each item is ordered on its chosen supplier price and the order is split
// per supplier when placed. Each venue on the list can have a par per item
// (the usual quantity), stored in the item's base unit and shown in packs.
// API: routes/purchasing.js (lists).

import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors,
} from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ClipboardList, Plus, Loader2, ArrowLeft, Copy, GripVertical, X, Search, Check } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useVenues, Modal, Field, inputCls, ErrorNote, ConfirmDelete, SortableRows, PageHeader } from '@/components/staff/shared'
import { useCategories, usePurchasingMeta, NumInput, Card, Toggle, StorageBadge, btn } from '@/components/purchasing/shared'
import { packLabel, chooseQuote } from '@shared/procurement.js'

export default function OrderLists() {
  const api = useApi()
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const selected = params.get('list')
  const setSelected = id => setParams(id ? { list: id } : {}, { replace: true })
  const [creating, setCreating] = useState(false)
  const { data: meta } = usePurchasingMeta()
  const { data: lists = [], isLoading, error } = useQuery({ queryKey: ['order-lists'], queryFn: () => api.get('/purchasing/lists') })
  const { data: venues = [] } = useVenues()
  const canEdit = !!meta?.can_setup
  const reorder = useMutation({ mutationFn: ids => api.patch('/purchasing/lists/reorder', { ids }), onSuccess: () => qc.invalidateQueries({ queryKey: ['order-lists'] }) })
  const venueName = id => venues.find(v => v.id === id)?.name

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader icon={ClipboardList} title="Order lists">
        {canEdit && <button type="button" className={btn.primary} onClick={() => setCreating(true)}><Plus className="w-4 h-4" />New list</button>}
      </PageHeader>
      <div className="flex-1 min-h-0 flex">
        <div className={cn('w-full md:w-80 shrink-0 border-r bg-background overflow-y-auto p-3 space-y-2', selected && 'hidden md:block')}>
          <ErrorNote error={error} />
          {isLoading ? <Loader2 className="w-5 h-5 animate-spin mx-auto my-8" /> : !lists.length ? (
            <div className="text-sm text-muted-foreground p-4 text-center space-y-2">
              <p>No order lists yet.</p>
              <p>A list is what a venue orders from: pick items from the inventory, any supplier, and set the usual quantity for each venue.</p>
            </div>
          ) : (
            <SortableRows items={lists} onReorder={ids => reorder.mutate(ids)} renderItem={l => (
              <button type="button" onClick={() => setSelected(l.id)}
                className={cn('w-full text-left rounded-lg px-2 py-1.5 touch-manipulation', selected === l.id ? 'bg-primary/10' : 'hover:bg-muted', !l.is_active && 'opacity-60')}>
                <span className="block font-medium text-sm truncate">{l.name}{!l.is_active && ' (off)'}</span>
                <span className="block text-xs text-muted-foreground truncate">
                  {l.item_count} item{l.item_count === 1 ? '' : 's'} · {l.venue_ids.length ? l.venue_ids.map(venueName).filter(Boolean).join(', ') : 'no venues'}
                </span>
              </button>
            )} />
          )}
        </div>
        <div className={cn('flex-1 min-w-0 overflow-y-auto', !selected && 'hidden md:block')}>
          {selected ? (
            <ListEditor key={selected} listId={selected} venues={venues} canEdit={canEdit}
              onBack={() => setSelected(null)} onGone={() => setSelected(null)} onCopied={id => setSelected(id)} />
          ) : (
            <p className="p-8 text-sm text-muted-foreground text-center">Choose a list, or make a new one.</p>
          )}
        </div>
      </div>
      {creating && <NewListModal venues={venues} onClose={() => setCreating(false)} onCreated={id => { setCreating(false); setSelected(id) }} />}
    </div>
  )
}

function VenueChips({ venues, value, onChange, disabled }) {
  const set = new Set(value)
  return (
    <div className="flex flex-wrap gap-2">
      {venues.map(v => (
        <button key={v.id} type="button" disabled={disabled}
          onClick={() => { const n = new Set(set); n.has(v.id) ? n.delete(v.id) : n.add(v.id); onChange([...n]) }}
          className={cn('min-h-[44px] px-3 rounded-full border text-sm inline-flex items-center gap-1.5 touch-manipulation disabled:opacity-50',
            set.has(v.id) ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted')}>
          {set.has(v.id) && <Check className="w-3.5 h-3.5" />}{v.name}
        </button>
      ))}
    </div>
  )
}

function NewListModal({ venues, onClose, onCreated }) {
  const api = useApi()
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [venueIds, setVenueIds] = useState(venues.length === 1 ? [venues[0].id] : [])
  const create = useMutation({
    mutationFn: () => api.post('/purchasing/lists', { name: name.trim(), venue_ids: venueIds }),
    onSuccess: l => { qc.invalidateQueries({ queryKey: ['order-lists'] }); onCreated(l.id) },
  })
  return (
    <Modal title="New order list" onClose={onClose}
      footer={<>
        <button type="button" className={btn.primary} disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>Create</button>
        <button type="button" className={btn.outline} onClick={onClose}>Cancel</button>
      </>}>
      <Field label="Name" hint="e.g. Daily fresh, Weekly dry goods, Drinks"><input className={inputCls} value={name} onChange={e => setName(e.target.value)} /></Field>
      <Field label="Venues that order from it"><VenueChips venues={venues} value={venueIds} onChange={setVenueIds} /></Field>
      <ErrorNote error={create.error} />
    </Modal>
  )
}

function ListEditor({ listId, venues, canEdit, onBack, onGone, onCopied }) {
  const api = useApi()
  const qc = useQueryClient()
  const { data: list, isLoading, error } = useQuery({ queryKey: ['order-list', listId], queryFn: () => api.get(`/purchasing/lists/${listId}`) })
  const refresh = saved => {
    if (saved?.id) qc.setQueryData(['order-list', saved.id], saved)
    qc.invalidateQueries({ queryKey: ['order-lists'] })
  }
  const del = useMutation({ mutationFn: () => api.delete(`/purchasing/lists/${listId}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ['order-lists'] }); onGone() } })
  const copy = useMutation({ mutationFn: () => api.post(`/purchasing/lists/${listId}/duplicate`), onSuccess: l => { refresh(l); onCopied(l.id) } })
  if (isLoading || !list) return <div className="p-8"><ErrorNote error={error} />{!error && <Loader2 className="w-5 h-5 animate-spin mx-auto" />}</div>
  return (
    <div className="p-4 space-y-4 max-w-5xl">
      <div className="flex items-center gap-2 md:hidden">
        <button type="button" onClick={onBack} className={btn.ghost}><ArrowLeft className="w-4 h-4" />Lists</button>
      </div>
      <DetailsCard list={list} venues={venues} canEdit={canEdit} onSaved={refresh}
        actions={canEdit && (
          <>
            <button type="button" className={btn.ghost} onClick={() => copy.mutate()} disabled={copy.isPending}><Copy className="w-4 h-4" />Copy</button>
            <ConfirmDelete label="Delete list" onConfirm={() => del.mutate()} />
          </>
        )} />
      <ItemsCard list={list} venues={venues} canEdit={canEdit} onSaved={refresh} />
      <ErrorNote error={del.error || copy.error} />
    </div>
  )
}

function DetailsCard({ list, venues, canEdit, onSaved, actions }) {
  const api = useApi()
  const initial = { name: list.name, notes: list.notes || '', is_active: list.is_active, venue_ids: [...list.venue_ids].sort() }
  const [f, setF] = useState(initial)
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const dirty = JSON.stringify({ ...f, venue_ids: [...f.venue_ids].sort() }) !== JSON.stringify(initial)
  const save = useMutation({
    mutationFn: async () => {
      let saved = await api.patch(`/purchasing/lists/${list.id}`, { name: f.name.trim(), notes: f.notes, is_active: f.is_active })
      if (JSON.stringify([...f.venue_ids].sort()) !== JSON.stringify(initial.venue_ids)) {
        saved = await api.put(`/purchasing/lists/${list.id}/venues`, { venue_ids: f.venue_ids })
      }
      return saved
    },
    onSuccess: onSaved,
  })
  return (
    <Card title="List" actions={<>
      {actions}
      {canEdit && <button type="button" className={btn.primary} disabled={!dirty || !f.name.trim() || save.isPending} onClick={() => save.mutate()}>Save</button>}
    </>}>
      <div className="space-y-3">
        <Field label="Name"><input className={inputCls} value={f.name} disabled={!canEdit} onChange={e => set('name', e.target.value)} /></Field>
        <Field label="Venues that order from it"><VenueChips venues={venues} value={f.venue_ids} disabled={!canEdit} onChange={v => set('venue_ids', v)} /></Field>
        <Field label="Notes for staff" hint="Shown at the top of the order"><textarea rows={2} className={cn(inputCls, 'h-auto py-2')} value={f.notes} disabled={!canEdit} onChange={e => set('notes', e.target.value)} /></Field>
        <Toggle checked={f.is_active} disabled={!canEdit} onChange={v => set('is_active', v)} label="In use" />
        <ErrorNote error={save.error} />
      </div>
    </Card>
  )
}

/** Items grouped by category (the order they appear in on the order form). */
function groupItems(items, categories) {
  const sortOf = new Map(categories.map(c => [c.id, c.sort_order]))
  const groups = new Map()
  for (const it of items) {
    const key = it.category_id || 'none'
    if (!groups.has(key)) groups.set(key, { key, name: it.category_name || 'No category', sort: it.category_id ? (sortOf.get(it.category_id) ?? 9998) : 9999, items: [] })
    groups.get(key).items.push(it)
  }
  return [...groups.values()].sort((a, b) => a.sort - b.sort)
}

function ItemsCard({ list, venues, canEdit, onSaved }) {
  const api = useApi()
  const { data: categories = [] } = useCategories()
  const [adding, setAdding] = useState(false)
  const listVenues = venues.filter(v => list.venue_ids.includes(v.id))
  const initialPars = useMemo(() => Object.fromEntries(list.items.map(i => [i.item_id, { ...i.pars }])), [list])
  const [pars, setPars] = useState(initialPars)
  const parsDirty = JSON.stringify(pars) !== JSON.stringify(initialPars)
  const groups = groupItems(list.items, categories)

  const setItems = useMutation({ mutationFn: ids => api.put(`/purchasing/lists/${list.id}/items`, { item_ids: ids }), onSuccess: onSaved })
  const savePars = useMutation({
    mutationFn: () => {
      const out = []
      for (const it of list.items) {
        for (const v of listVenues) {
          const a = pars[it.item_id]?.[v.id] ?? null, b = initialPars[it.item_id]?.[v.id] ?? null
          if (a !== b) out.push({ item_id: it.item_id, venue_id: v.id, par_base: a })
        }
      }
      return api.put(`/purchasing/lists/${list.id}/pars`, { pars: out })
    },
    onSuccess: saved => { onSaved(saved); setPars(Object.fromEntries(saved.items.map(i => [i.item_id, { ...i.pars }]))) },
  })
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
  )
  function dropIn(group, { active, over }) {
    if (!over || active.id === over.id) return
    const ids = group.items.map(i => i.item_id)
    const moved = arrayMove(ids, ids.indexOf(active.id), ids.indexOf(over.id))
    const all = groups.flatMap(g => (g.key === group.key ? moved : g.items.map(i => i.item_id)))
    setItems.mutate(all)
  }
  const remove = id => setItems.mutate(list.items.map(i => i.item_id).filter(x => x !== id))

  return (
    <Card title={`Items (${list.items.length})`} bodyClass="p-0"
      actions={canEdit && <>
        {parsDirty && <button type="button" className={btn.primary} disabled={savePars.isPending} onClick={() => savePars.mutate()}>Save pars</button>}
        <button type="button" className={btn.outline} onClick={() => setAdding(true)}><Plus className="w-4 h-4" />Add items</button>
      </>}>
      {!list.items.length ? (
        <p className="p-4 text-sm text-muted-foreground">No items yet. Add items from the inventory: any mix of suppliers.</p>
      ) : (
        <>
          {listVenues.length > 0 && (
            <p className="px-4 pt-3 text-xs text-muted-foreground">
              Par: the usual quantity per venue, in packs of the item's company choice. Staff can fill an order to its pars in one tap.
            </p>
          )}
          {groups.map(g => (
            <div key={g.key}>
              <p className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.name}</p>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={e => dropIn(g, e)}>
                <SortableContext items={g.items.map(i => i.item_id)} strategy={verticalListSortingStrategy}>
                  <div className="divide-y border-y">
                    {g.items.map(it => (
                      <ItemRow key={it.item_id} it={it} venues={listVenues} pars={pars[it.item_id] || {}} canEdit={canEdit}
                        onPar={(vid, base) => setPars(p => ({ ...p, [it.item_id]: { ...(p[it.item_id] || {}), [vid]: base } }))}
                        onRemove={() => remove(it.item_id)} />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            </div>
          ))}
        </>
      )}
      <div className="px-4 py-2"><ErrorNote error={setItems.error || savePars.error} /></div>
      {adding && <AddItemsModal list={list} onClose={() => setAdding(false)} onAdd={ids => { setAdding(false); setItems.mutate([...list.items.map(i => i.item_id), ...ids]) }} />}
    </Card>
  )
}

function ItemRow({ it, venues, pars, canEdit, onPar, onRemove }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: it.item_id, disabled: !canEdit })
  const q = it.quote
  const pb = q?.pack_base_qty
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      className={cn('flex flex-wrap items-center gap-2 px-2 py-2 bg-background', !it.is_active && 'opacity-60')}>
      {canEdit && (
        <button type="button" {...attributes} {...listeners} aria-label="Drag to reorder"
          className="w-11 h-11 shrink-0 flex items-center justify-center text-muted-foreground cursor-grab touch-manipulation">
          <GripVertical className="w-4 h-4" />
        </button>
      )}
      <div className="flex-1 min-w-[160px]">
        <p className="text-sm font-medium">{it.name} <StorageBadge storage={it.storage} />{!it.is_active && <span className="ml-1 text-[11px] px-1.5 rounded bg-muted">Off</span>}</p>
        <p className="text-xs text-muted-foreground">{q ? `${q.supplier_name} · ${q.pack_label}` : <span className="text-amber-700">No supplier price</span>}</p>
      </div>
      {venues.map(v => {
        const base = pars[v.id]
        const shown = base == null ? null : pb ? Math.round((base / pb) * 1000) / 1000 : base
        return (
          <label key={v.id} className="flex items-center gap-1.5">
            {venues.length > 1 && <span className="text-xs text-muted-foreground max-w-[90px] truncate">{v.name}</span>}
            <NumInput value={shown} disabled={!canEdit} className="w-20" placeholder="Par" aria-label={`Par at ${v.name}`}
              onChange={n => onPar(v.id, n == null ? null : pb ? Math.round(n * pb * 10000) / 10000 : n)} />
            <span className="text-xs text-muted-foreground w-12">{pb ? 'packs' : it.base_unit}</span>
          </label>
        )
      })}
      {canEdit && (
        <button type="button" onClick={onRemove} aria-label={`Take ${it.name} off the list`}
          className="w-11 h-11 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted touch-manipulation">
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}

function AddItemsModal({ list, onClose, onAdd }) {
  const api = useApi()
  const { data: items = [], isLoading } = useQuery({ queryKey: ['inv-items'], queryFn: () => api.get('/inventory/items') })
  const { data: categories = [] } = useCategories()
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [picked, setPicked] = useState([])
  const onList = new Set(list.items.map(i => i.item_id))
  const rows = items.filter(i => i.is_active && !onList.has(i.id)
    && (!categoryId || i.category_id === categoryId)
    && (!search.trim() || i.name.toLowerCase().includes(search.trim().toLowerCase())))
  const toggle = id => setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]))
  return (
    <Modal title={`Add items to ${list.name}`} onClose={onClose}
      footer={<>
        <button type="button" className={btn.primary} disabled={!picked.length} onClick={() => onAdd(picked)}>Add {picked.length || ''} item{picked.length === 1 ? '' : 's'}</button>
        <button type="button" className={btn.outline} onClick={() => setPicked(rows.map(r => r.id))} disabled={!rows.length}>Select all shown</button>
      </>}>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input className={cn(inputCls, 'pl-9')} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search items" />
        </div>
        <select className={cn(inputCls, 'w-auto')} value={categoryId} onChange={e => setCategoryId(e.target.value)} aria-label="Category">
          <option value="">All</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : !rows.length ? <p className="text-sm text-muted-foreground">Nothing to add.</p> : (
        <div className="rounded-xl border divide-y">
          {rows.map(i => {
            const q = chooseQuote(i.quotes, null, i.preferred)?.quote
            const on = picked.includes(i.id)
            return (
              <button key={i.id} type="button" onClick={() => toggle(i.id)}
                className={cn('w-full flex items-center gap-3 px-3 py-2 text-left touch-manipulation min-h-[48px]', on ? 'bg-primary/10' : 'hover:bg-muted/40')}>
                <span className={cn('w-5 h-5 rounded border flex items-center justify-center shrink-0', on && 'bg-primary border-primary text-primary-foreground')}>{on && <Check className="w-3.5 h-3.5" />}</span>
                <span className="flex-1 min-w-0">
                  <span className="text-sm font-medium block truncate">{i.name}</span>
                  <span className="text-xs text-muted-foreground block truncate">{[i.category_name, q && `${q.supplier_name}, ${packLabel(q)}`].filter(Boolean).join(' · ') || 'No supplier price'}</span>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </Modal>
  )
}
