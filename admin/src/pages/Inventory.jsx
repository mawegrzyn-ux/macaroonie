// src/pages/Inventory.jsx
//
// The purchasing catalogue (/inventory, purchasing_setup): every product the
// business buys, each with any number of supplier prices ("quotes": a pack
// size and a price per pack). An item has no price of its own; what it costs
// comes from its quotes. Which quote is ordered: a venue's choice, else the
// company choice (star), else the cheapest per kg / litre / each
// (chooseQuote in shared/procurement.js, same as the API).
// API: routes/inventory.js.

import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Package, Plus, Search, Star, History, Upload, Tags, Loader2, Store, Download, AlertTriangle } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useVenues, Modal, Field, inputCls, ErrorNote, Segmented, ConfirmDelete, SortableRows, PageHeader } from '@/components/staff/shared'
import {
  useCategories, useSuppliers, usePurchasingMeta, NumInput, Drawer, Card, Toggle, StorageBadge, btn, money, perUnit,
  fileToBase64,
} from '@/components/purchasing/shared'
import {
  BASE_UNITS, STORAGE, UNITS, unitsForBase, packBaseQty, packLabel, chooseQuote, formatBase, fmtNum,
} from '@shared/procurement.js'

const PACK_NAMES = ['Case', 'Box', 'Bag', 'Tray', 'Tub', 'Bottle', 'Tin', 'Jar', 'Pack', 'Crate', 'Sack', 'Each']

export default function Inventory() {
  const api = useApi()
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [status, setStatus] = useState('active')
  const [showImport, setShowImport] = useState(false)
  const [showCats, setShowCats] = useState(false)
  const openId = params.get('item')
  const setOpenId = id => setParams(id ? { item: id } : {}, { replace: true })

  const { data: meta } = usePurchasingMeta()
  const { data: items = [], isLoading, error } = useQuery({ queryKey: ['inv-items'], queryFn: () => api.get('/inventory/items') })
  const { data: categories = [] } = useCategories()
  const { data: suppliers = [] } = useSuppliers()
  const canEdit = !!meta?.can_setup

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter(i => {
      if (status === 'active' && !i.is_active) return false
      if (status === 'off' && i.is_active) return false
      if (categoryId === 'none' ? i.category_id : categoryId && i.category_id !== categoryId) return false
      if (supplierId && !i.quotes.some(x => x.supplier_id === supplierId)) return false
      if (q && !i.name.toLowerCase().includes(q) && !(i.code || '').toLowerCase().includes(q)
        && !i.quotes.some(x => (x.supplier_code || '').toLowerCase().includes(q) || (x.product_name || '').toLowerCase().includes(q))) return false
      return true
    })
  }, [items, search, categoryId, supplierId, status])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader icon={Package} title="Inventory">
        {canEdit && (
          <>
            <button type="button" className={btn.outline} onClick={() => setShowCats(true)}><Tags className="w-4 h-4" />Categories</button>
            <button type="button" className={btn.outline} onClick={() => setShowImport(true)}><Upload className="w-4 h-4" />Import</button>
            <button type="button" className={btn.primary} onClick={() => setOpenId('new')}><Plus className="w-4 h-4" />New item</button>
          </>
        )}
      </PageHeader>

      <div className="flex-1 overflow-y-auto">
        <div className="p-4 space-y-3 max-w-6xl mx-auto">
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, item or supplier code"
                className={cn(inputCls, 'pl-9')} />
            </div>
            <select value={categoryId} onChange={e => setCategoryId(e.target.value)} className={cn(inputCls, 'w-auto')} aria-label="Category">
              <option value="">All categories</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              <option value="none">No category</option>
            </select>
            <select value={supplierId} onChange={e => setSupplierId(e.target.value)} className={cn(inputCls, 'w-auto')} aria-label="Supplier">
              <option value="">All suppliers</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <Segmented value={status} onChange={setStatus}
              options={[{ value: 'active', label: 'In use' }, { value: 'off', label: 'Off' }, { value: 'all', label: 'All' }]} />
          </div>

          <ErrorNote error={error} />
          {isLoading ? (
            <div className="py-16 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : !items.length ? (
            <EmptyState canEdit={canEdit} onNew={() => setOpenId('new')} onImport={() => setShowImport(true)} />
          ) : (
            <ItemTable rows={rows} onOpen={setOpenId} total={items.length} />
          )}
        </div>
      </div>

      {openId && (
        <ItemDrawer key={openId} itemId={openId === 'new' ? null : openId} canEdit={canEdit}
          onCreated={id => setOpenId(id)} onClose={() => setOpenId(null)} />
      )}
      {showImport && <ImportModal onClose={() => setShowImport(false)} />}
      {showCats && <CategoriesModal onClose={() => setShowCats(false)} />}
    </div>
  )
}

function EmptyState({ canEdit, onNew, onImport }) {
  return (
    <div className="rounded-xl border bg-background p-8 text-center space-y-3">
      <Package className="w-8 h-8 mx-auto text-muted-foreground" />
      <p className="font-medium">No inventory items yet</p>
      <p className="text-sm text-muted-foreground max-w-md mx-auto">
        Add the products you buy, each with its supplier's pack size and price, or import a whole
        price list from a spreadsheet. Add your <Link to="/suppliers" className="underline">suppliers</Link> first.
      </p>
      {canEdit && (
        <div className="flex flex-wrap justify-center gap-2">
          <button type="button" className={btn.outline} onClick={onImport}><Upload className="w-4 h-4" />Import a spreadsheet</button>
          <button type="button" className={btn.primary} onClick={onNew}><Plus className="w-4 h-4" />New item</button>
        </div>
      )}
    </div>
  )
}

/** The quote the company orders on (no venue): star, else cheapest. */
function companyPick(item) {
  return chooseQuote(item.quotes.filter(q => q.supplier_active !== false), null, item.preferred)
}

function ItemTable({ rows, onOpen, total }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground py-8 text-center">No items match ({total} in total).</p>
  return (
    <div className="rounded-xl border bg-background overflow-hidden">
      <div className="hidden md:grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.6fr)_minmax(0,1.6fr)_70px] gap-3 px-4 py-2 border-b bg-muted/40 text-xs font-medium text-muted-foreground">
        <span>Item</span><span>Category</span><span>Suppliers</span><span>Ordered on</span><span className="text-right">Lists</span>
      </div>
      <div className="divide-y">
        {rows.map(i => {
          const pick = companyPick(i)
          const q = pick?.quote
          return (
            <button key={i.id} type="button" onClick={() => onOpen(i.id)}
              className={cn('w-full text-left px-4 py-3 hover:bg-muted/40 touch-manipulation grid gap-1 md:gap-3 md:items-center',
                'md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.6fr)_minmax(0,1.6fr)_70px]', !i.is_active && 'opacity-60')}>
              <span className="min-w-0">
                <span className="font-medium">{i.name}</span>
                {i.code && <span className="ml-2 text-xs text-muted-foreground">{i.code}</span>}
                <span className="ml-2 align-middle"><StorageBadge storage={i.storage} /></span>
                {!i.is_active && <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded bg-muted">Off</span>}
              </span>
              <span className="text-sm text-muted-foreground truncate">{i.category_name || '—'}</span>
              <span className="text-sm truncate">
                {i.quotes.length ? [...new Set(i.quotes.map(x => x.supplier_name))].join(', ') : <span className="text-amber-700">No supplier price</span>}
              </span>
              <span className="text-sm min-w-0">
                {q ? (
                  <>
                    <span className="truncate block">{packLabel(q)} · {money(q.price)}</span>
                    <span className="text-xs text-muted-foreground">
                      {perUnit(q.price, q.pack_base_qty, i.base_unit)} · {pick.how === 'default' ? 'company choice' : 'cheapest'}
                    </span>
                  </>
                ) : '—'}
              </span>
              <span className="text-sm text-muted-foreground md:text-right">{i.list_count ? `${i.list_count} list${i.list_count === 1 ? '' : 's'}` : ''}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Item drawer ─────────────────────────────────────────────────

const EMPTY_ITEM = { name: '', category_id: null, base_unit: 'g', storage: 'ambient', code: '', notes: '', is_active: true }

function ItemDrawer({ itemId, canEdit, onCreated, onClose }) {
  const api = useApi()
  const qc = useQueryClient()
  const { data: item, isLoading } = useQuery({
    queryKey: ['inv-item', itemId], queryFn: () => api.get(`/inventory/items/${itemId}`), enabled: !!itemId,
  })
  const { data: venues = [] } = useVenues()
  const [quoteEdit, setQuoteEdit] = useState(null)
  const [venuePrices, setVenuePrices] = useState(null)
  const [history, setHistory] = useState(null)
  const [deleted, setDeleted] = useState(null)

  const refresh = updated => {
    if (updated?.id) qc.setQueryData(['inv-item', updated.id], old => ({ ...old, ...updated }))
    qc.invalidateQueries({ queryKey: ['inv-items'] })
    qc.invalidateQueries({ queryKey: ['inv-categories'] })
  }

  const setDefault = useMutation({
    mutationFn: ({ venue_id, quote_id }) => api.put(`/inventory/items/${itemId}/preferred`, { venue_id, quote_id }),
    onSuccess: refresh,
  })
  const del = useMutation({
    mutationFn: () => api.delete(`/inventory/items/${itemId}`),
    onSuccess: r => { setDeleted(r); qc.invalidateQueries({ queryKey: ['inv-items'] }); if (r.deleted) onClose() },
  })
  const delQuote = useMutation({ mutationFn: id => api.delete(`/inventory/quotes/${id}`), onSuccess: refresh })

  if (itemId && (isLoading || !item)) {
    return <Drawer title="Item" onClose={onClose}><div className="py-16 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" /></div></Drawer>
  }

  return (
    <Drawer title={item?.name || 'New item'} subtitle={item ? `Counted in ${BASE_UNITS.find(b => b.key === item.base_unit)?.label.toLowerCase()}` : null} onClose={onClose}>
      <ItemForm item={item} canEdit={canEdit} onSaved={saved => { refresh(saved); if (!item) onCreated(saved.id) }} />

      {item && (
        <>
          <Card title="Supplier prices"
            actions={canEdit && <button type="button" className={btn.outline} onClick={() => setQuoteEdit({})}><Plus className="w-4 h-4" />Add price</button>}
            bodyClass="p-0">
            {!item.quotes.length ? (
              <p className="p-4 text-sm text-muted-foreground">
                No supplier sells this yet. Add a price: the supplier, the pack it comes in and what a pack costs.
              </p>
            ) : (
              <div className="divide-y">
                {item.quotes.map(q => (
                  <QuoteRow key={q.id} q={q} item={item} canEdit={canEdit}
                    isDefault={item.preferred.default === q.id}
                    onStar={() => setDefault.mutate({ venue_id: null, quote_id: item.preferred.default === q.id ? null : q.id })}
                    onEdit={() => setQuoteEdit(q)} onVenuePrices={() => setVenuePrices(q)} onHistory={() => setHistory(q)}
                    onDelete={() => delQuote.mutate(q.id)} />
                ))}
              </div>
            )}
            {item.quotes.length > 1 && (
              <p className="px-4 py-2 border-t text-xs text-muted-foreground">
                The star is the company choice. Without one, each venue orders the cheapest per {item.base_unit === 'g' ? 'kg' : item.base_unit === 'ml' ? 'litre' : 'item'}.
              </p>
            )}
          </Card>

          {item.quotes.length > 0 && venues.length > 0 && (
            <VenueChoices item={item} venues={venues} canEdit={canEdit} onSaved={refresh} />
          )}

          {item.lists?.length > 0 && (
            <Card title="On order lists">
              <div className="flex flex-wrap gap-2">
                {item.lists.map(l => (
                  <Link key={l.id} to={`/purchasing/lists?list=${l.id}`} className="text-sm px-3 py-1.5 rounded-full border hover:bg-muted">{l.name}</Link>
                ))}
              </div>
            </Card>
          )}

          {canEdit && (
            <div className="flex items-center justify-between gap-2 pt-2">
              {deleted?.archived
                ? <p className="text-sm text-amber-800">This item has been ordered before, so it was switched off instead of deleted.</p>
                : <span className="text-xs text-muted-foreground">Deleting an item that has been ordered switches it off instead.</span>}
              <ConfirmDelete label="Delete item" onConfirm={() => del.mutate()} disabled={del.isPending} />
            </div>
          )}
        </>
      )}

      {quoteEdit && <QuoteModal item={item} quote={quoteEdit.id ? quoteEdit : null} onClose={() => setQuoteEdit(null)} onSaved={refresh} />}
      {venuePrices && <VenuePricesModal item={item} quote={venuePrices} venues={venues} onClose={() => setVenuePrices(null)} onSaved={refresh} />}
      {history && <HistoryModal item={item} quote={history} onClose={() => setHistory(null)} />}
    </Drawer>
  )
}

function ItemForm({ item, canEdit, onSaved }) {
  const api = useApi()
  const { data: categories = [] } = useCategories()
  const initial = item ? { ...EMPTY_ITEM, ...item, code: item.code || '', notes: item.notes || '' } : EMPTY_ITEM
  const [form, setForm] = useState(initial)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const dirty = ['name', 'category_id', 'base_unit', 'storage', 'code', 'notes', 'is_active'].some(k => (form[k] ?? '') !== (initial[k] ?? ''))
  const hasQuotes = !!item?.quotes?.length
  const save = useMutation({
    mutationFn: () => {
      const body = { name: form.name.trim(), category_id: form.category_id || null, base_unit: form.base_unit,
        storage: form.storage, code: form.code, notes: form.notes, is_active: form.is_active }
      return item ? api.patch(`/inventory/items/${item.id}`, body) : api.post('/inventory/items', body)
    },
    onSuccess: saved => onSaved(saved),
  })
  return (
    <Card title="Item"
      actions={canEdit && (
        <button type="button" className={btn.primary} disabled={!form.name.trim() || (item && !dirty) || save.isPending} onClick={() => save.mutate()}>
          {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />}{item ? 'Save' : 'Create'}
        </button>
      )}>
      <div className="space-y-3">
        <Field label="Name"><input className={inputCls} value={form.name} disabled={!canEdit} onChange={e => set('name', e.target.value)} autoFocus={!item && !('ontouchstart' in window)} /></Field>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Category">
            <select className={inputCls} value={form.category_id || ''} disabled={!canEdit} onChange={e => set('category_id', e.target.value || null)}>
              <option value="">No category</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Item code" hint="Your own code, optional"><input className={inputCls} value={form.code} disabled={!canEdit} onChange={e => set('code', e.target.value)} /></Field>
        </div>
        <Field label="Counted in" hint={hasQuotes ? 'Fixed while it has supplier prices' : 'How pack sizes and pars are measured'}>
          <Segmented value={form.base_unit} disabled={!canEdit || hasQuotes} onChange={v => set('base_unit', v)}
            options={BASE_UNITS.map(b => ({ value: b.key, label: b.label }))} className="flex-wrap" />
        </Field>
        <Field label="Storage" hint="Chilled and frozen items ask for a temperature when a delivery is booked in">
          <Segmented value={form.storage} disabled={!canEdit} onChange={v => set('storage', v)} options={STORAGE.map(s => ({ value: s.key, label: s.label }))} />
        </Field>
        <Field label="Notes"><textarea rows={2} className={cn(inputCls, 'h-auto py-2')} value={form.notes} disabled={!canEdit} onChange={e => set('notes', e.target.value)} /></Field>
        {item && <Toggle checked={form.is_active} disabled={!canEdit} onChange={v => set('is_active', v)} label="In use (off = hidden from order lists and orders)" />}
        <ErrorNote error={save.error} />
      </div>
    </Card>
  )
}

function QuoteRow({ q, item, canEdit, isDefault, onStar, onEdit, onVenuePrices, onHistory, onDelete }) {
  const venueCount = Object.keys(q.venue_prices || {}).length
  return (
    <div className={cn('px-4 py-3 space-y-2', (!q.is_active || q.supplier_active === false) && 'opacity-60')}>
      <div className="flex items-start gap-2">
        <button type="button" onClick={onStar} disabled={!canEdit} aria-label={isDefault ? 'Company choice' : 'Make company choice'}
          title={isDefault ? 'Company choice' : 'Make company choice'}
          className="w-11 h-11 -ml-2 shrink-0 flex items-center justify-center rounded-lg hover:bg-muted touch-manipulation disabled:hover:bg-transparent">
          <Star className={cn('w-5 h-5', isDefault ? 'fill-amber-400 text-amber-500' : 'text-muted-foreground')} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm">
            {q.supplier_name}{q.supplier_code && <span className="text-muted-foreground font-normal"> · {q.supplier_code}</span>}
            {!q.is_active && <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded bg-muted font-normal">Off</span>}
            {q.supplier_active === false && <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded bg-muted font-normal">Supplier off</span>}
          </p>
          {q.product_name && <p className="text-sm font-medium">{q.product_name}</p>}
          <p className="text-sm">{packLabel(q)} <span className="text-muted-foreground">= {formatBase(q.pack_base_qty, item.base_unit)}</span></p>
          <p className="text-xs text-muted-foreground">
            {[q.min_qty && `min ${fmtNum(q.min_qty)}`, q.order_multiple && `in steps of ${fmtNum(q.order_multiple)}`, `VAT ${fmtNum(q.vat_rate)}%`].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="font-semibold tabular-nums">{money(q.price)}</p>
          <p className="text-xs text-muted-foreground tabular-nums">{perUnit(q.price, q.pack_base_qty, item.base_unit)}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 pl-9">
        {canEdit && <button type="button" className={cn(btn.ghost, 'border')} onClick={onEdit}>Edit</button>}
        <button type="button" className={cn(btn.ghost, 'border')} onClick={onVenuePrices}>
          <Store className="w-4 h-4" />Venue prices{venueCount ? ` (${venueCount})` : ''}
        </button>
        <button type="button" className={cn(btn.ghost, 'border')} onClick={onHistory}><History className="w-4 h-4" />History</button>
        {canEdit && <span className="ml-auto"><ConfirmDelete label="Delete price" onConfirm={onDelete} /></span>}
      </div>
    </div>
  )
}

function QuoteModal({ item, quote, onClose, onSaved }) {
  const api = useApi()
  const { data: suppliers = [] } = useSuppliers()
  const units = unitsForBase(item.base_unit)
  const [f, setF] = useState(() => quote ? {
    supplier_id: quote.supplier_id, supplier_code: quote.supplier_code || '', product_name: quote.product_name || '', pack_name: quote.pack_name || 'pack',
    pack_count: quote.pack_count, pack_qty: quote.pack_qty, pack_unit: quote.pack_unit, price: quote.price,
    vat_rate: quote.vat_rate, min_qty: quote.min_qty, order_multiple: quote.order_multiple, notes: quote.notes || '',
    is_active: quote.is_active,
  } : {
    supplier_id: suppliers.find(s => s.is_active)?.id || '', supplier_code: '', product_name: '', pack_name: 'Case', pack_count: 1,
    pack_qty: null, pack_unit: units.includes('kg') ? 'kg' : units.includes('l') ? 'l' : units[0], price: null,
    vat_rate: 0, min_qty: null, order_multiple: null, notes: '', is_active: true,
  })
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const pbq = packBaseQty({ pack_count: f.pack_count || 1, pack_qty: f.pack_qty, pack_unit: f.pack_unit }, item.base_unit)
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, pack_count: f.pack_count || 1, vat_rate: f.vat_rate ?? 0 }
      return quote ? api.patch(`/inventory/quotes/${quote.id}`, body) : api.post(`/inventory/items/${item.id}/quotes`, body)
    },
    onSuccess: saved => { onSaved(saved); onClose() },
  })
  const ok = f.supplier_id && pbq && f.price != null
  return (
    <Modal title={quote ? `Edit price · ${quote.supplier_name}` : `Add a price for ${item.name}`} onClose={onClose}
      footer={<>
        <button type="button" className={btn.primary} disabled={!ok || save.isPending} onClick={() => save.mutate()}>
          {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />}Save
        </button>
        <button type="button" className={btn.outline} onClick={onClose}>Cancel</button>
      </>}>
      {!suppliers.length ? (
        <p className="text-sm">No suppliers yet. <Link className="underline" to="/suppliers">Add a supplier</Link> first.</p>
      ) : (
        <>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Supplier">
              <select className={inputCls} value={f.supplier_id} onChange={e => set('supplier_id', e.target.value)}>
                <option value="">Choose…</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}{s.is_active ? '' : ' (off)'}</option>)}
              </select>
            </Field>
            <Field label="Supplier's product code"><input className={inputCls} value={f.supplier_code} onChange={e => set('supplier_code', e.target.value)} /></Field>
          </div>
          <Field label="Supplier's product name" hint={`Optional: what ${suppliers.find(s => s.id === f.supplier_id)?.name || 'the supplier'} calls it, e.g. a brand, when it isn't just "${item.name}". It goes on their copy of the order.`}>
            <input className={inputCls} value={f.product_name} onChange={e => set('product_name', e.target.value)} placeholder={item.name} maxLength={200} />
          </Field>
          <Field label="Pack" hint="What one unit you order is called, how many are in it and how big each one is">
            <div className="grid grid-cols-[1.4fr_0.8fr_auto_1fr_auto] gap-2 items-center">
              <input className={inputCls} list="pack-names" value={f.pack_name} onChange={e => set('pack_name', e.target.value)} aria-label="Pack name" />
              <NumInput value={f.pack_count} onChange={v => set('pack_count', v)} aria-label="How many in the pack" />
              <span className="text-sm text-muted-foreground">×</span>
              <NumInput value={f.pack_qty} onChange={v => set('pack_qty', v)} aria-label="Size of each" placeholder="Size" />
              <select className={cn(inputCls, 'w-auto')} value={f.pack_unit} onChange={e => set('pack_unit', e.target.value)} aria-label="Unit">
                {units.map(u => <option key={u} value={u}>{UNITS[u].label}</option>)}
              </select>
            </div>
            <datalist id="pack-names">{PACK_NAMES.map(n => <option key={n} value={n} />)}</datalist>
          </Field>
          <p className="text-sm text-muted-foreground -mt-1">
            {pbq ? <>One {f.pack_name || 'pack'} = <strong>{formatBase(pbq, item.base_unit)}</strong></> : 'Enter the pack size'}
          </p>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Price per pack, ex VAT (£)" hint={pbq && f.price != null ? perUnit(f.price, pbq, item.base_unit) : null}>
              <NumInput value={f.price} onChange={v => set('price', v)} />
            </Field>
            <Field label="VAT">
              <Segmented value={String(f.vat_rate ?? 0)} onChange={v => set('vat_rate', Number(v))}
                options={['0', '5', '20'].map(v => ({ value: v, label: `${v}%` }))} />
            </Field>
            <Field label="Minimum order (packs)" hint="Optional"><NumInput value={f.min_qty} onChange={v => set('min_qty', v)} /></Field>
            <Field label="Order in steps of (packs)" hint="Optional, e.g. 0.5 for half cases"><NumInput value={f.order_multiple} onChange={v => set('order_multiple', v)} /></Field>
          </div>
          <Field label="Notes"><input className={inputCls} value={f.notes} onChange={e => set('notes', e.target.value)} /></Field>
          {quote && <Toggle checked={f.is_active} onChange={v => set('is_active', v)} label="Use this price (off = never ordered on)" />}
          <ErrorNote error={save.error} />
        </>
      )}
    </Modal>
  )
}

function VenuePricesModal({ item, quote, venues, onClose, onSaved }) {
  const api = useApi()
  const [prices, setPrices] = useState(() => Object.fromEntries(venues.map(v => [v.id, quote.venue_prices?.[v.id] ?? null])))
  const save = useMutation({
    mutationFn: () => api.put(`/inventory/quotes/${quote.id}/venue-prices`, {
      prices: venues.map(v => ({ venue_id: v.id, price: prices[v.id] })),
    }),
    onSuccess: saved => { onSaved(saved); onClose() },
  })
  return (
    <Modal title={`Venue prices · ${quote.supplier_name}`} onClose={onClose}
      footer={<>
        <button type="button" className={btn.primary} disabled={save.isPending} onClick={() => save.mutate()}>Save</button>
        <button type="button" className={btn.outline} onClick={onClose}>Cancel</button>
      </>}>
      <p className="text-sm text-muted-foreground">
        {packLabel(quote)}. Company price {money(quote.price)}. Leave a venue blank to use the company price.
      </p>
      <div className="divide-y rounded-xl border">
        {venues.map(v => (
          <div key={v.id} className="flex items-center gap-3 px-3 py-2">
            <span className="flex-1 min-w-0 text-sm truncate">{v.name}</span>
            <NumInput value={prices[v.id]} onChange={n => setPrices(p => ({ ...p, [v.id]: n }))} placeholder={Number(quote.price).toFixed(2)}
              className="w-28" aria-label={`Price at ${v.name}`} />
            <span className="w-28 text-xs text-muted-foreground text-right">
              {prices[v.id] != null ? perUnit(prices[v.id], quote.pack_base_qty, item.base_unit) : ''}
            </span>
          </div>
        ))}
      </div>
      <ErrorNote error={save.error} />
    </Modal>
  )
}

function VenueChoices({ item, venues, canEdit, onSaved }) {
  const api = useApi()
  const initial = Object.fromEntries(venues.map(v => [v.id, item.preferred.venues?.[v.id] || '']))
  const [choice, setChoice] = useState(initial)
  const dirty = venues.some(v => (choice[v.id] || '') !== (initial[v.id] || ''))
  const save = useMutation({
    mutationFn: async () => {
      let last
      for (const v of venues) {
        if ((choice[v.id] || '') === (initial[v.id] || '')) continue
        last = await api.put(`/inventory/items/${item.id}/preferred`, { venue_id: v.id, quote_id: choice[v.id] || null })
      }
      return last
    },
    onSuccess: saved => saved && onSaved(saved),
  })
  const live = item.quotes.filter(q => q.is_active && q.supplier_active !== false)
  return (
    <Card title="Which price each venue orders"
      actions={canEdit && <button type="button" className={btn.primary} disabled={!dirty || save.isPending} onClick={() => save.mutate()}>Save</button>}>
      <div className="space-y-2">
        {venues.map(v => {
          const auto = chooseQuote(live, v.id, { default: item.preferred.default, venues: {} })?.quote
          return (
            <div key={v.id} className="flex flex-wrap items-center gap-2">
              <span className="flex-1 min-w-[120px] text-sm">{v.name}</span>
              <select className={cn(inputCls, 'w-auto max-w-full')} value={choice[v.id] || ''} disabled={!canEdit}
                onChange={e => setChoice(c => ({ ...c, [v.id]: e.target.value }))}>
                <option value="">{auto ? `Automatic: ${auto.supplier_name}, ${packLabel(auto)}` : 'Automatic'}</option>
                {live.map(q => (
                  <option key={q.id} value={q.id}>{q.supplier_name}, {packLabel(q)} ({money(q.venue_prices?.[v.id] ?? q.price)})</option>
                ))}
              </select>
            </div>
          )
        })}
        <ErrorNote error={save.error} />
      </div>
    </Card>
  )
}

function HistoryModal({ item, quote, onClose }) {
  const api = useApi()
  const { data = [], isLoading } = useQuery({ queryKey: ['quote-history', quote.id], queryFn: () => api.get(`/inventory/quotes/${quote.id}/history`) })
  return (
    <Modal title={`Price history · ${quote.supplier_name}`} onClose={onClose}>
      <p className="text-sm text-muted-foreground">{item.name}, {packLabel(quote)}</p>
      {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : !data.length ? <p className="text-sm">No changes recorded.</p> : (
        <div className="divide-y rounded-xl border">
          {data.map(h => (
            <div key={h.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="w-32 shrink-0 text-muted-foreground tabular-nums">{new Date(h.changed_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
              <span className="flex-1 min-w-0 truncate">{h.venue_name || 'Company price'}{h.source === 'import' && <span className="ml-1 text-xs text-muted-foreground">(import)</span>}</span>
              <span className="font-medium tabular-nums">{h.price == null ? 'Removed' : money(h.price)}</span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}

// ── Import ──────────────────────────────────────────────────────

function ImportModal({ onClose }) {
  const api = useApi()
  const qc = useQueryClient()
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [done, setDone] = useState(null)
  const run = useMutation({
    mutationFn: async dry => api.post('/inventory/import', { file: await fileToBase64(file), dry_run: dry }),
    onSuccess: (r, dry) => {
      if (dry) setPreview(r)
      else {
        setDone(r)
        qc.invalidateQueries({ queryKey: ['inv-items'] })
        qc.invalidateQueries({ queryKey: ['inv-categories'] })
        qc.invalidateQueries({ queryKey: ['suppliers'] })
      }
    },
  })
  const result = done || preview
  return (
    <Modal title="Import items and prices" onClose={onClose}
      footer={done ? <button type="button" className={btn.primary} onClick={onClose}>Done</button> : <>
        {!preview ? (
          <button type="button" className={btn.primary} disabled={!file || run.isPending} onClick={() => run.mutate(true)}>
            {run.isPending && <Loader2 className="w-4 h-4 animate-spin" />}Check file
          </button>
        ) : (
          <button type="button" className={btn.primary} disabled={run.isPending} onClick={() => run.mutate(false)}>
            {run.isPending && <Loader2 className="w-4 h-4 animate-spin" />}Import {preview.rows - preview.errors.length} row{preview.rows - preview.errors.length === 1 ? '' : 's'}
          </button>
        )}
        <button type="button" className={btn.outline} onClick={onClose}>Cancel</button>
      </>}>
      <p className="text-sm text-muted-foreground">
        A CSV or Excel file with one row per supplier price. Items are matched by item code, else by name; suppliers by
        name (new ones are added). A row for a price you already have updates it and keeps the old price in its history.
      </p>
      <button type="button" className={btn.outline} onClick={() => api.download('/inventory/import-template', 'inventory-import.csv')}>
        <Download className="w-4 h-4" />Download the template
      </button>
      {!done && (
        <Field label="File">
          <input type="file" accept=".csv,.xlsx,.xls,text/csv" className="block text-sm"
            onChange={e => { setFile(e.target.files?.[0] || null); setPreview(null) }} />
        </Field>
      )}
      {result && (
        <div className="rounded-xl border p-3 space-y-1 text-sm">
          <p className="font-medium">{done ? 'Imported' : 'This file would:'}</p>
          <p>Add {result.items_created} item{result.items_created === 1 ? '' : 's'} (and match {result.items_matched})</p>
          <p>Add {result.quotes_created} price{result.quotes_created === 1 ? '' : 's'}, update {result.quotes_updated} ({result.prices_changed} price change{result.prices_changed === 1 ? '' : 's'})</p>
          {result.suppliers_created > 0 && <p>Add {result.suppliers_created} supplier{result.suppliers_created === 1 ? '' : 's'}</p>}
          {result.categories_created > 0 && <p>Add {result.categories_created} categor{result.categories_created === 1 ? 'y' : 'ies'}</p>}
        </div>
      )}
      {result?.errors?.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 space-y-1 text-sm">
          <p className="font-medium flex items-center gap-1"><AlertTriangle className="w-4 h-4" />{result.errors.length} row{result.errors.length === 1 ? '' : 's'} skipped</p>
          {result.errors.slice(0, 50).map((e, i) => <p key={i}>Row {e.row} ({e.item}): {e.error}</p>)}
        </div>
      )}
      <ErrorNote error={run.error} />
    </Modal>
  )
}

// ── Categories ──────────────────────────────────────────────────

function CategoriesModal({ onClose }) {
  const api = useApi()
  const qc = useQueryClient()
  const { data: categories = [] } = useCategories()
  const [name, setName] = useState('')
  const inval = () => { qc.invalidateQueries({ queryKey: ['inv-categories'] }); qc.invalidateQueries({ queryKey: ['inv-items'] }) }
  const add = useMutation({ mutationFn: () => api.post('/inventory/categories', { name: name.trim() }), onSuccess: () => { setName(''); inval() } })
  const reorder = useMutation({ mutationFn: ids => api.patch('/inventory/categories/reorder', { ids }), onSuccess: inval })
  const del = useMutation({ mutationFn: id => api.delete(`/inventory/categories/${id}`), onSuccess: inval })
  return (
    <Modal title="Categories" onClose={onClose}>
      <p className="text-sm text-muted-foreground">Drag to set the order items are grouped in on order lists and orders.</p>
      <SortableRows items={categories} onReorder={ids => reorder.mutate(ids)}
        renderItem={c => <CategoryRow c={c} onSaved={inval} onDelete={() => del.mutate(c.id)} />} />
      <div className="flex gap-2">
        <input className={inputCls} value={name} onChange={e => setName(e.target.value)} placeholder="New category" />
        <button type="button" className={btn.primary} disabled={!name.trim() || add.isPending} onClick={() => add.mutate()}>Add</button>
      </div>
      <ErrorNote error={add.error || reorder.error || del.error} />
    </Modal>
  )
}

function CategoryRow({ c, onSaved, onDelete }) {
  const api = useApi()
  const [name, setName] = useState(c.name)
  const save = useMutation({ mutationFn: () => api.patch(`/inventory/categories/${c.id}`, { name: name.trim() }), onSuccess: onSaved })
  return (
    <div className="flex items-center gap-2">
      <input className={inputCls} value={name} onChange={e => setName(e.target.value)} aria-label="Category name" />
      {name.trim() && name !== c.name && <button type="button" className={btn.outline} onClick={() => save.mutate()}>Save</button>}
      <span className="text-xs text-muted-foreground whitespace-nowrap">{c.item_count} item{c.item_count === 1 ? '' : 's'}</span>
      <ConfirmDelete label="Delete category" onConfirm={onDelete} />
    </div>
  )
}
