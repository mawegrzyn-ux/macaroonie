// src/pages/Promotions.jsx
//
// Promotions for online ordering (/promotions, module 'promotions',
// migration 131). The list order is priority (drag to reorder): the first
// promotion applies first, and an exclusive one is never combined with
// another. The discount rules are shared/promotions.js, the API
// routes/promotions.js; the ordering page and the server both apply them.

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { BadgePercent, Plus, Loader2, ArrowLeft, Search, ChevronDown, ChevronRight, Copy } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useMe } from '@/components/staff/rota'
import { SortableRows, ConfirmDelete } from '@/components/staff/shared'
import { PriceInput } from '@/components/menus/shared'
import { ScheduleEditor } from '@/components/orders/ScheduleEditor'
import { promoSummary } from '@shared/promotions.js'
import { isScheduled, scheduleLabel } from '@shared/menuSchedule.js'

const money = p => '£' + ((Number(p) || 0) / 100).toFixed(2)

const KINDS = [
  { key: 'basket', label: 'Order discount', hint: 'Money or % off the whole order' },
  { key: 'item', label: 'Dish discount', hint: 'Money or % off chosen dishes' },
  { key: 'bogo', label: 'Buy X get Y', hint: 'e.g. buy 1 get 1 free, 3 for 2' },
  { key: 'free_item', label: 'Free dish', hint: 'A dish free once the order qualifies' },
  { key: 'bundle', label: 'Meal deal', hint: 'e.g. starter + main + drink for £15' },
  { key: 'tiered', label: 'Spend more, save more', hint: 'e.g. £20 gets 10%, £40 gets 15%' },
]
// Offer types that pick dishes with the dish picker (Every dish allowed).
const PICKS_DISHES = new Set(['item', 'bogo', 'free_item'])
const DEFAULT_TIERS = { percent: [{ min_pence: 2000, value: 10 }, { min_pence: 4000, value: 15 }], amount: [{ min_pence: 2000, value: 300 }, { min_pence: 4000, value: 800 }] }
const DEFAULT_BUNDLE = [
  { label: 'Starter', item_ids: [], section_ids: [], qty: 1 },
  { label: 'Main', item_ids: [], section_ids: [], qty: 1 },
  { label: 'Drink', item_ids: [], section_ids: [], qty: 1 },
]
const MODES = [
  { key: 'auto', label: 'Automatic', hint: 'Taken off as soon as the order qualifies' },
  { key: 'manual', label: 'Tap to apply', hint: 'Shown in the basket; the guest taps Apply' },
  { key: 'code', label: 'Promo code', hint: 'Only with the code you give out' },
]

const EMPTY = {
  name: '', description: '', badge_text: '', is_active: true,
  kind: 'basket', discount_type: 'percent', discount_value: 10,
  item_ids: [], section_ids: [], buy_qty: 1, get_qty: 1, get_percent: 100,
  min_subtotal_pence: 0, required_item_ids: [], max_discount_pence: null,
  apply_mode: 'auto', code: '', max_uses: null,
  schedule: { from: null, until: null, times: [] }, venue_ids: [], exclusive: false,
  bundle: [], bundle_price_pence: null, tiers: [],
}

function todayLocal() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Active / Scheduled / Ended / Used up / Off, from today's date. */
export function promoStatus(p, today = todayLocal()) {
  if (!p.is_active) return { key: 'off', label: 'Off', cls: 'bg-muted text-muted-foreground' }
  if (p.max_uses && p.uses >= p.max_uses) return { key: 'used', label: 'Used up', cls: 'bg-amber-100 text-amber-800' }
  if (p.schedule?.until && p.schedule.until < today) return { key: 'ended', label: 'Ended', cls: 'bg-muted text-muted-foreground' }
  if (p.schedule?.from && p.schedule.from > today) return { key: 'scheduled', label: 'Scheduled', cls: 'bg-sky-100 text-sky-800' }
  return { key: 'active', label: 'Active', cls: 'bg-emerald-100 text-emerald-800' }
}

function modeLabel(p) {
  if (p.apply_mode === 'code') return `Code ${p.code}`
  return p.apply_mode === 'manual' ? 'Tap to apply' : 'Automatic'
}

// ── Small inputs ────────────────────────────────────────────

function Row({ label, hint, children }) {
  return (
    <div className="space-y-1">
      <div className="text-sm font-medium">{label}</div>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

const inputCls = 'w-full border rounded-md px-3 min-h-[44px] bg-background text-sm'

function IntInput({ value, onChange, min = 0, max, allowEmpty, className, placeholder, ...rest }) {
  const [text, setText] = useState(null)
  const shown = text ?? (value == null ? '' : String(value))
  return (
    <input {...rest} type="text" inputMode="numeric" value={shown} placeholder={placeholder}
      onFocus={() => setText(value == null ? '' : String(value))}
      onChange={e => setText(e.target.value.replace(/[^\d]/g, ''))}
      onBlur={() => {
        const n = text === '' || text == null ? null : Number(text)
        setText(null)
        if (n == null) onChange(allowEmpty ? null : min)
        else onChange(Math.max(min, max != null ? Math.min(max, n) : n))
      }}
      className={cn('border rounded-md px-3 min-h-[44px] bg-background text-sm touch-manipulation', className)} />
  )
}

function Choice({ options, value, onChange }) {
  return (
    <div className="grid sm:grid-cols-3 gap-2">
      {options.map(o => (
        <button key={o.key} type="button" onClick={() => onChange(o.key)} aria-pressed={value === o.key}
          className={cn('text-left rounded-lg border p-3 min-h-[56px] touch-manipulation',
            value === o.key ? 'border-primary ring-2 ring-primary/30 bg-primary/5' : 'bg-background hover:bg-muted/50')}>
          <div className="text-sm font-medium">{o.label}</div>
          <div className="text-xs text-muted-foreground">{o.hint}</div>
        </button>
      ))}
    </div>
  )
}

function Switch({ checked, onChange, label }) {
  return (
    <button type="button" role="switch" aria-checked={!!checked} aria-label={label} onClick={() => onChange(!checked)}
      className="w-14 h-12 shrink-0 flex items-center justify-center touch-manipulation">
      <span className={cn('relative w-11 h-6 rounded-full transition-colors', checked ? 'bg-primary' : 'bg-muted-foreground/30')}>
        <span className={cn('absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all', checked ? 'left-[22px]' : 'left-0.5')} />
      </span>
    </button>
  )
}

function Check({ checked, onChange, children, hint }) {
  return (
    <label className="flex items-start gap-3 min-h-[44px] cursor-pointer touch-manipulation">
      <input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)} className="w-5 h-5 mt-0.5 shrink-0" />
      <span className="text-sm">{children}{hint && <span className="block text-xs text-muted-foreground">{hint}</span>}</span>
    </label>
  )
}

// ── Dish picker ─────────────────────────────────────────────

/**
 * Pick dishes (and, with allowSections, whole sections) from every menu.
 * A section tick covers dishes added to that section later too.
 */
function DishPicker({ catalog, itemIds, sectionIds = [], onChange, allowSections }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState({})
  const needle = q.trim().toLowerCase()
  const itemSet = new Set(itemIds)
  const sectionSet = new Set(sectionIds)
  const put = (items, sections) => onChange({ item_ids: [...items], section_ids: [...sections] })
  const toggleItem = id => {
    const next = new Set(itemSet)
    next.has(id) ? next.delete(id) : next.add(id)
    put(next, sectionSet)
  }
  const toggleSection = id => {
    const next = new Set(sectionSet)
    next.has(id) ? next.delete(id) : next.add(id)
    put(itemSet, next)
  }
  const count = itemIds.length + (allowSections ? sectionIds.length : 0)

  return (
    <div className="rounded-lg border">
      <div className="flex items-center gap-2 px-3 border-b">
        <Search className="w-4 h-4 text-muted-foreground" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search dishes"
          className="flex-1 min-h-[44px] bg-transparent text-sm outline-none" />
        {count > 0 && (
          <button type="button" onClick={() => put([], [])} className="text-xs text-muted-foreground underline min-h-[44px] px-1 touch-manipulation">
            Clear ({count})
          </button>
        )}
      </div>
      <div className="max-h-72 overflow-y-auto divide-y">
        {(catalog?.menus || []).map(m => {
          const sections = m.sections.map(s => ({
            ...s, items: needle ? s.items.filter(i => i.name.toLowerCase().includes(needle)) : s.items,
          })).filter(s => !needle || s.items.length || s.title.toLowerCase().includes(needle))
          if (!sections.length) return null
          return (
            <div key={m.id}>
              <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground bg-muted/40">{m.name}</div>
              {sections.map(s => {
                const expanded = needle || open[s.id]
                const picked = s.items.filter(i => itemSet.has(i.id)).length
                return (
                  <div key={s.id} className="border-t first:border-t-0">
                    <div className="flex items-center gap-1 pr-2">
                      <button type="button" onClick={() => setOpen(o => ({ ...o, [s.id]: !o[s.id] }))}
                        className="flex-1 flex items-center gap-2 px-3 min-h-[44px] text-left text-sm touch-manipulation">
                        {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        <span className="font-medium">{s.title}</span>
                        {picked > 0 && <span className="text-xs text-primary">{picked} chosen</span>}
                      </button>
                      {allowSections && (
                        <label className="flex items-center gap-2 text-xs min-h-[44px] px-2 cursor-pointer touch-manipulation">
                          <input type="checkbox" checked={sectionSet.has(s.id)} onChange={() => toggleSection(s.id)} className="w-5 h-5" />
                          Whole section
                        </label>
                      )}
                    </div>
                    {expanded && (
                      <div className="pl-9 pr-3 pb-2">
                        {s.items.map(i => (
                          <label key={i.id} className={cn('flex items-center gap-3 min-h-[44px] text-sm cursor-pointer touch-manipulation',
                            allowSections && sectionSet.has(s.id) && 'opacity-50')}>
                            <input type="checkbox" className="w-5 h-5" checked={itemSet.has(i.id) || (allowSections && sectionSet.has(s.id))}
                              disabled={allowSections && sectionSet.has(s.id)} onChange={() => toggleItem(i.id)} />
                            {i.name}
                          </label>
                        ))}
                        {!s.items.length && <p className="text-xs text-muted-foreground py-2">No dishes.</p>}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}
        {!catalog && <p className="p-3 text-sm text-muted-foreground">Loading dishes…</p>}
        {catalog && !catalog.menus?.length && <p className="p-3 text-sm text-muted-foreground">No menus yet.</p>}
      </div>
    </div>
  )
}

// ── Meal deal parts and spend levels ────────────────────────

/** The parts of a meal deal: a name, how many, and which dishes count. */
function BundleEditor({ parts, onChange, catalog }) {
  const [open, setOpen] = useState(0)
  const setPart = (i, patch) => onChange(parts.map((c, j) => (j === i ? { ...c, ...patch } : c)))
  return (
    <div className="space-y-2">
      {parts.map((c, i) => {
        const count = (c.item_ids?.length || 0) + (c.section_ids?.length || 0)
        return (
          <div key={i} className="rounded-lg border">
            <div className="flex flex-wrap items-center gap-2 p-2">
              <IntInput value={c.qty} onChange={v => setPart(i, { qty: v })} min={1} max={10} className="w-14" aria-label="How many" />
              <span className="text-sm">x</span>
              <input value={c.label} onChange={e => setPart(i, { label: e.target.value.slice(0, 40) })} placeholder="e.g. Starter"
                className={cn(inputCls, 'flex-1 min-w-[120px] w-auto')} aria-label="Part name" />
              <button type="button" onClick={() => setOpen(open === i ? -1 : i)}
                className="min-h-[44px] px-3 border rounded-md text-sm touch-manipulation">
                {count ? `${count} chosen` : 'Choose dishes'}
              </button>
              <ConfirmDelete onConfirm={() => onChange(parts.filter((_, j) => j !== i))} label="Remove part" confirmLabel="Remove" />
            </div>
            {open === i && (
              <div className="p-2 pt-0">
                <DishPicker catalog={catalog} allowSections itemIds={c.item_ids || []} sectionIds={c.section_ids || []}
                  onChange={v => setPart(i, v)} />
              </div>
            )}
          </div>
        )
      })}
      <button type="button" onClick={() => { onChange([...parts, { label: '', item_ids: [], section_ids: [], qty: 1 }]); setOpen(parts.length) }}
        className="inline-flex items-center gap-1 min-h-[44px] px-3 border rounded-md text-sm touch-manipulation">
        <Plus className="w-4 h-4" /> Add a part
      </button>
    </div>
  )
}

/** Spend levels for a tiered offer: spend at least X, get Y off. */
function TierEditor({ tiers, type, onChange }) {
  const setTier = (i, patch) => onChange(tiers.map((t, j) => (j === i ? { ...t, ...patch } : t)))
  return (
    <div className="space-y-2">
      {tiers.map((t, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
          <span>Spend</span>
          <PriceInput pence={t.min_pence} onChange={v => setTier(i, { min_pence: v || 0 })} className="w-28" aria-label="Spend at least" />
          <span>get</span>
          {type === 'percent'
            ? <><IntInput value={t.value} onChange={v => setTier(i, { value: v })} min={1} max={100} className="w-20" aria-label="Percent off" /><span>% off</span></>
            : <><PriceInput pence={t.value} onChange={v => setTier(i, { value: v || 0 })} className="w-28" aria-label="Amount off" /><span>off</span></>}
          {tiers.length > 1 && <ConfirmDelete onConfirm={() => onChange(tiers.filter((_, j) => j !== i))} label="Remove level" confirmLabel="Remove" />}
        </div>
      ))}
      <button type="button" onClick={() => { const last = tiers[tiers.length - 1]; onChange([...tiers, { min_pence: (last?.min_pence || 0) + 2000, value: last?.value || (type === 'percent' ? 10 : 300) }]) }}
        className="inline-flex items-center gap-1 min-h-[44px] px-3 border rounded-md text-sm touch-manipulation">
        <Plus className="w-4 h-4" /> Add a level
      </button>
      <p className="text-xs text-muted-foreground">The highest level the order reaches is taken off the whole order. Guests see how much more to spend for the next one.</p>
    </div>
  )
}

// ── Editor ──────────────────────────────────────────────────

function toDraft(p) {
  if (!p) return { ...EMPTY, schedule: { ...EMPTY.schedule } }
  const d = { ...EMPTY }
  for (const k of Object.keys(EMPTY)) if (p[k] !== undefined && p[k] !== null) d[k] = p[k]
  d.max_discount_pence = p.max_discount_pence ?? null
  d.max_uses = p.max_uses ?? null
  d.code = p.code || ''
  d.description = p.description || ''
  d.badge_text = p.badge_text || ''
  d.schedule = { from: null, until: null, times: [], ...(p.schedule || {}) }
  d.bundle = Array.isArray(p.bundle) ? p.bundle : []
  d.bundle_price_pence = p.bundle_price_pence ?? null
  d.tiers = Array.isArray(p.tiers) ? p.tiers : []
  return d
}

function randomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

function PromoEditor({ promo, copyOf, catalog, onClose, onSaved }) {
  const api = useApi()
  const [d, setD] = useState(() => {
    const base = toDraft(promo || copyOf)
    if (copyOf) { base.name = `${base.name} (copy)`; base.code = ''; base.is_active = false }
    return base
  })
  const [error, setError] = useState(null)
  const [confirmAll, setConfirmAll] = useState(() => !!(promo || copyOf) && PICKS_DISHES.has((promo || copyOf).kind) && !(promo || copyOf).item_ids?.length && !(promo || copyOf).section_ids?.length)
  const set = patch => setD(x => ({ ...x, ...patch }))
  const venues = catalog?.venues || []
  const itemName = useMemo(() => {
    const m = {}
    for (const menu of catalog?.menus || []) for (const s of menu.sections) for (const i of s.items) m[i.id] = i.name
    return m
  }, [catalog])

  const save = useMutation({
    mutationFn: body => (promo ? api.put(`/promotions/${promo.id}`, body) : api.post('/promotions', body)),
    onSuccess: () => { onSaved(); onClose() },
    onError: e => setError(e?.message || 'Could not save'),
  })

  function submit() {
    setError(null)
    if (!d.name.trim()) return setError('Give the promotion a name')
    if (d.apply_mode === 'code' && d.code.trim().length < 3) return setError('Enter a promo code of at least 3 characters')
    if ((d.kind === 'basket' || d.kind === 'item') && !d.discount_value) return setError('Enter how much the promotion takes off')
    if (PICKS_DISHES.has(d.kind) && !d.item_ids.length && !d.section_ids.length && !confirmAll) return setError('Choose the dishes it covers, or tick "Every dish"')
    if (d.kind === 'bundle') {
      if (!d.bundle.length) return setError('Add the parts of the meal deal')
      if (d.bundle.some(c => !String(c.label || '').trim())) return setError('Give each part of the meal deal a name')
      if (d.bundle.some(c => !c.item_ids?.length && !c.section_ids?.length)) return setError('Choose the dishes for each part of the meal deal')
      if (d.bundle_price_pence == null) return setError('Enter the meal deal price')
    }
    if (d.kind === 'tiered' && !d.tiers.length) return setError('Add at least one spend level')
    save.mutate({
      ...d,
      name: d.name.trim(),
      description: d.description.trim() || null,
      badge_text: d.badge_text.trim() || null,
      code: d.apply_mode === 'code' ? d.code.trim() : null,
      schedule: isScheduled(d.schedule) ? d.schedule : { times: [] },
      bundle: d.kind === 'bundle' ? d.bundle.map(c => ({ ...c, label: String(c.label).trim() })) : [],
      tiers: d.kind === 'tiered' ? d.tiers : [],
    })
  }

  const covers = PICKS_DISHES.has(d.kind)
  // Starting values when an operator switches to a type that needs them.
  function setKind(kind) {
    const patch = { kind }
    if (kind === 'bundle' && !d.bundle.length) Object.assign(patch, { bundle: DEFAULT_BUNDLE, bundle_price_pence: d.bundle_price_pence ?? 1500 })
    if (kind === 'tiered' && !d.tiers.length) patch.tiers = DEFAULT_TIERS[d.discount_type] || DEFAULT_TIERS.percent
    set(patch)
  }
  const summary = promoSummary({ ...d })

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" role="dialog" aria-modal="true" aria-label={promo ? 'Edit promotion' : 'New promotion'}>
      <div className="w-full sm:max-w-2xl bg-background rounded-t-2xl sm:rounded-2xl shadow-xl flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold truncate">{promo ? 'Edit promotion' : 'New promotion'}</h2>
            <p className="text-xs text-muted-foreground truncate">{summary}</p>
          </div>
          <button type="button" onClick={onClose} className="h-11 px-3 rounded-lg text-sm text-muted-foreground hover:bg-muted touch-manipulation">Close</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          <section className="space-y-3">
            <Row label="Name" hint="Guests see this in the basket and on their receipt.">
              <input value={d.name} onChange={e => set({ name: e.target.value })} maxLength={120} placeholder="e.g. 10% off lunch" className={inputCls} />
            </Row>
            <Row label="Description (optional)" hint="A line of detail for guests, e.g. terms.">
              <input value={d.description} onChange={e => set({ description: e.target.value })} maxLength={500} className={inputCls} />
            </Row>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">What it takes off</h3>
            <Choice options={KINDS} value={d.kind} onChange={setKind} />
            {d.kind === 'tiered' ? (
              <div className="space-y-2">
                <div className="inline-flex rounded-md border overflow-hidden">
                  {[['percent', '%'], ['amount', '£']].map(([k, l]) => (
                    <button key={k} type="button" onClick={() => set({ discount_type: k, tiers: DEFAULT_TIERS[k] })}
                      className={cn('w-12 min-h-[44px] text-sm font-semibold touch-manipulation', d.discount_type === k ? 'bg-primary text-primary-foreground' : 'bg-background')}>
                      {l}
                    </button>
                  ))}
                </div>
                <TierEditor tiers={d.tiers} type={d.discount_type} onChange={tiers => set({ tiers })} />
              </div>
            ) : d.kind === 'bundle' ? (
              <div className="space-y-3">
                <BundleEditor parts={d.bundle} catalog={catalog} onChange={bundle => set({ bundle })} />
                <Row label="Meal deal price" hint="Each complete deal in the basket costs this. The dearest dishes that fit are used, so guests save the most; anything extra is at full price.">
                  <PriceInput pence={d.bundle_price_pence} onChange={v => set({ bundle_price_pence: v })} className="w-32" aria-label="Meal deal price" />
                </Row>
              </div>
            ) : d.kind === 'free_item' ? (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <IntInput value={d.get_qty} onChange={v => set({ get_qty: v })} min={1} max={20} className="w-16" aria-label="How many" />
                <span>{d.get_qty === 1 ? 'dish' : 'dishes'}</span>
                <select value={d.get_percent === 100 ? '100' : 'pct'} onChange={e => set({ get_percent: e.target.value === '100' ? 100 : 50 })}
                  className="border rounded-md px-3 min-h-[44px] bg-background">
                  <option value="100">free</option>
                  <option value="pct">% off</option>
                </select>
                {d.get_percent !== 100 && <><IntInput value={d.get_percent} onChange={v => set({ get_percent: v })} min={1} max={99} className="w-16" aria-label="Percent off" /><span>% off</span></>}
                <p className="w-full text-xs text-muted-foreground">Once the order qualifies, the guest adds one of the dishes below and the cheapest is free. The basket reminds them to add it. The free dish doesn't count towards the minimum spend.</p>
              </div>
            ) : d.kind !== 'bogo' ? (
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-md border overflow-hidden">
                  {[['percent', '%'], ['amount', '£']].map(([k, l]) => (
                    <button key={k} type="button" onClick={() => set({ discount_type: k, discount_value: k === 'percent' ? 10 : 200 })}
                      className={cn('w-12 min-h-[44px] text-sm font-semibold touch-manipulation', d.discount_type === k ? 'bg-primary text-primary-foreground' : 'bg-background')}>
                      {l}
                    </button>
                  ))}
                </div>
                {d.discount_type === 'percent'
                  ? <><IntInput value={d.discount_value} onChange={v => set({ discount_value: v })} min={1} max={100} className="w-24" aria-label="Percent off" /><span className="text-sm">% off{d.kind === 'item' ? ' each dish' : ''}</span></>
                  : <><PriceInput pence={d.discount_value} onChange={v => set({ discount_value: v || 0 })} className="w-28" aria-label="Amount off" /><span className="text-sm">off{d.kind === 'item' ? ' each dish' : ' the order'}</span></>}
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span>Buy</span>
                <IntInput value={d.buy_qty} onChange={v => set({ buy_qty: v })} min={1} max={20} className="w-16" aria-label="Buy" />
                <span>get</span>
                <IntInput value={d.get_qty} onChange={v => set({ get_qty: v })} min={1} max={20} className="w-16" aria-label="Get" />
                <select value={d.get_percent === 100 ? '100' : 'pct'} onChange={e => set({ get_percent: e.target.value === '100' ? 100 : 50 })}
                  className="border rounded-md px-3 min-h-[44px] bg-background">
                  <option value="100">free</option>
                  <option value="pct">% off</option>
                </select>
                {d.get_percent !== 100 && <><IntInput value={d.get_percent} onChange={v => set({ get_percent: v })} min={1} max={99} className="w-16" aria-label="Percent off" /><span>% off</span></>}
                <p className="w-full text-xs text-muted-foreground">The cheapest dishes in each group are the ones that are free (or reduced).</p>
              </div>
            )}
            {covers && (
              <Row label={d.kind === 'bogo' ? 'Dishes that count' : d.kind === 'free_item' ? 'Dishes that can be the free one' : 'Dishes it covers'}>
                <Check checked={confirmAll} onChange={v => { setConfirmAll(v); if (v) set({ item_ids: [], section_ids: [] }) }}>Every dish</Check>
                {!confirmAll && (
                  <DishPicker catalog={catalog} allowSections itemIds={d.item_ids} sectionIds={d.section_ids}
                    onChange={v => set(v)} />
                )}
              </Row>
            )}
            {(covers || d.kind === 'bundle') && (
              <Row label="Dish label (optional)" hint="A small badge on the dishes it covers, e.g. 2 FOR 1.">
                <input value={d.badge_text} onChange={e => set({ badge_text: e.target.value })} maxLength={30} className={inputCls} />
              </Row>
            )}
            <Row label="Most it can take off (optional)" hint="Leave empty for no limit.">
              <PriceInput pence={d.max_discount_pence} onChange={v => set({ max_discount_pence: v || null })} className="w-32" placeholder="No limit" />
            </Row>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Conditions</h3>
            {d.kind !== 'tiered' && (
              <Row label="Minimum spend" hint={'Dishes in the basket, before any discount. 0 = none.' + (d.kind === 'free_item' ? " The free dish itself doesn't count." : '')}>
                <PriceInput pence={d.min_subtotal_pence} onChange={v => set({ min_subtotal_pence: v || 0 })} className="w-32" />
              </Row>
            )}
            <Row label="Needs one of these dishes in the basket (optional)">
              <DishPicker catalog={catalog} itemIds={d.required_item_ids} onChange={v => set({ required_item_ids: v.item_ids })} />
              {d.required_item_ids.length > 0 && (
                <p className="text-xs text-muted-foreground">{d.required_item_ids.map(id => itemName[id] || 'Removed dish').join(', ')}</p>
              )}
            </Row>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">How guests get it</h3>
            <Choice options={MODES} value={d.apply_mode} onChange={apply_mode => set({ apply_mode, code: apply_mode === 'code' && !d.code ? randomCode() : d.code })} />
            {d.apply_mode === 'code' && (
              <Row label="Promo code" hint="Letters, numbers, - and _. Guests can type it in any case.">
                <div className="flex gap-2">
                  <input value={d.code} onChange={e => set({ code: e.target.value.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) })}
                    className={cn(inputCls, 'font-mono uppercase max-w-xs')} />
                  <button type="button" onClick={() => set({ code: randomCode() })}
                    className="min-h-[44px] px-3 border rounded-md text-sm touch-manipulation">Generate</button>
                </div>
              </Row>
            )}
            <Row label="Number of uses (optional)" hint="Across all guests. Cancelled and rejected orders give their use back. Empty = unlimited.">
              <IntInput value={d.max_uses} onChange={v => set({ max_uses: v })} min={1} allowEmpty placeholder="Unlimited" className="w-32" />
            </Row>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">When and where</h3>
            <ScheduleEditor value={d.schedule} onChange={sc => set({ schedule: sc || { from: null, until: null, times: [] } })}
              alwaysLabel="Any time the venue takes orders" resetLabel="Make it available any time" datesLabel="Dates" />
            <p className="text-xs text-muted-foreground">Times are checked when the guest places the order, in the venue's time zone.</p>
            {venues.length > 1 && (
              <Row label="Venues">
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => set({ venue_ids: [] })} aria-pressed={!d.venue_ids.length}
                    className={cn('min-h-[44px] px-3 rounded-full border text-sm touch-manipulation', !d.venue_ids.length ? 'bg-primary text-primary-foreground border-primary' : 'bg-background')}>
                    All venues
                  </button>
                  {venues.map(v => {
                    const on = d.venue_ids.includes(v.id)
                    return (
                      <button key={v.id} type="button" aria-pressed={on}
                        onClick={() => set({ venue_ids: on ? d.venue_ids.filter(x => x !== v.id) : [...d.venue_ids, v.id] })}
                        className={cn('min-h-[44px] px-3 rounded-full border text-sm touch-manipulation', on ? 'bg-primary text-primary-foreground border-primary' : 'bg-background')}>
                        {v.name}
                      </button>
                    )
                  })}
                </div>
              </Row>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Combining</h3>
            <Check checked={d.exclusive} onChange={exclusive => set({ exclusive })}
              hint="Applies only when no promotion higher in the list already has, and then no other promotion applies. Order of the list = priority.">
              Can't be combined with other promotions
            </Check>
            <Check checked={d.is_active} onChange={is_active => set({ is_active })}>Switched on</Check>
          </section>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <div className="px-4 py-3 border-t flex flex-wrap gap-2 justify-end">
          <button type="button" onClick={onClose} className="min-h-[48px] px-4 border rounded-lg text-sm touch-manipulation">Cancel</button>
          <button type="button" onClick={submit} disabled={save.isPending}
            className="min-h-[48px] px-5 rounded-lg bg-primary text-primary-foreground text-sm font-medium touch-manipulation disabled:opacity-50 inline-flex items-center gap-2">
            {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Page ────────────────────────────────────────────────────

export default function Promotions() {
  const api = useApi()
  const qc = useQueryClient()
  const { data: me } = useMe()
  const canManage = me?.is_platform_admin || me?.permissions?.promotions === 'manage'
  const [editing, setEditing] = useState(null)   // null | { promo?, copyOf? }
  const list = useQuery({ queryKey: ['promotions'], queryFn: () => api.get('/promotions') })
  const catalog = useQuery({ queryKey: ['promotions-catalog'], queryFn: () => api.get('/promotions/catalog'), enabled: !!editing })
  const refresh = () => qc.invalidateQueries({ queryKey: ['promotions'] })

  const reorder = useMutation({ mutationFn: ids => api.patch('/promotions/reorder', { ids }), onSettled: refresh })
  const toggle = useMutation({ mutationFn: ({ id, is_active }) => api.patch(`/promotions/${id}/active`, { is_active }), onSettled: refresh })
  const remove = useMutation({ mutationFn: id => api.delete(`/promotions/${id}`), onSettled: refresh })

  const promos = list.data || []
  const today = todayLocal()

  function renderRow(p) {
    const st = promoStatus(p, today)
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1">
        <button type="button" onClick={() => canManage && setEditing({ promo: p })} disabled={!canManage}
          className="flex-1 min-w-[200px] text-left min-h-[48px] touch-manipulation">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{p.name}</span>
            <span className={cn('text-[11px] font-semibold px-2 py-0.5 rounded-full', st.cls)}>{st.label}</span>
            {p.exclusive && <span className="text-[11px] px-2 py-0.5 rounded-full border">Not combined</span>}
          </div>
          <div className="text-xs text-muted-foreground">
            {promoSummary(p)}
            {p.min_subtotal_pence > 0 && ` · min spend ${money(p.min_subtotal_pence)}`}
            {' · '}{modeLabel(p)}
            {isScheduled(p.schedule) && ` · ${scheduleLabel(p.schedule)}`}
          </div>
        </button>
        <div className="text-xs text-muted-foreground text-right w-28">
          <div>{p.uses}{p.max_uses ? ` / ${p.max_uses}` : ''} used</div>
          <div>{money(p.discount_given_pence)} off</div>
        </div>
        {canManage && (
          <div className="flex items-center">
            <Switch checked={p.is_active} label={`Switch ${p.name} ${p.is_active ? 'off' : 'on'}`} onChange={v => toggle.mutate({ id: p.id, is_active: v })} />
            <button type="button" onClick={() => setEditing({ copyOf: p })} aria-label={`Copy ${p.name}`} title="Copy"
              className="w-11 h-11 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted touch-manipulation">
              <Copy className="w-4 h-4" />
            </button>
            <ConfirmDelete onConfirm={() => remove.mutate(p.id)} label={`Delete ${p.name}`} />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-5 max-lg:notouch:pl-14">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Link to="/orders" className="w-11 h-11 flex items-center justify-center rounded-lg hover:bg-muted touch-manipulation" aria-label="Back to online orders">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <BadgePercent className="w-6 h-6 text-primary shrink-0" />
            <h1 className="text-xl font-semibold truncate">Promotions</h1>
          </div>
          {canManage && (
            <button type="button" onClick={() => setEditing({})}
              className="inline-flex items-center gap-2 min-h-[48px] px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium touch-manipulation">
              <Plus className="w-4 h-4" /> New promotion
            </button>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Discounts for online ordering. The list order is the priority: the promotion at the top is applied first, and each
          one after it takes its discount off what is left. Drag to reorder. Put a promotion on your website with the Promo block.
        </p>

        {list.isLoading && <Loader2 className="w-5 h-5 animate-spin" />}
        {list.isError && <p className="text-sm text-destructive">Could not load promotions.</p>}
        {!list.isLoading && !promos.length && (
          <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            No promotions yet.
          </div>
        )}
        {promos.length > 0 && (canManage
          ? <SortableRows items={promos} onReorder={ids => reorder.mutate(ids)} renderItem={renderRow} />
          : <div className="rounded-xl border divide-y px-3">{promos.map(p => <div key={p.id}>{renderRow(p)}</div>)}</div>)}
      </div>

      {editing && (
        <PromoEditor promo={editing.promo} copyOf={editing.copyOf} catalog={catalog.data}
          onClose={() => setEditing(null)} onSaved={refresh} />
      )}
    </div>
  )
}
