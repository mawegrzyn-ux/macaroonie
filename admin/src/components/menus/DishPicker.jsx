// src/components/menus/DishPicker.jsx
//
// Choosing dishes (and whole sections) from the menus: the chosen ones as
// removable chips plus a button, the menu tree in its own modal. Used by
// Promotions and Loyalty (rewards, stamp cards). The catalog is
// { menus: [{ id, name, sections: [{ id, title, items: [{ id, name }] }] }] },
// as GET /api/promotions/catalog and GET /api/loyalty/catalog return it.

import { useMemo, useState } from 'react'
import { Search, ChevronDown, ChevronRight, X, ListChecks } from 'lucide-react'
import { cn } from '@/lib/utils'

const IS_TOUCH = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0

/** { id: name } for every dish and section in the catalog. */
export function catalogNames(catalog) {
  const items = {}, sections = {}
  for (const m of catalog?.menus || []) {
    for (const s of m.sections) {
      sections[s.id] = s.title
      for (const i of s.items) items[i.id] = i.name
    }
  }
  return { items, sections }
}

/**
 * The editor page shows only what is chosen (chips, each removable) and a
 * button; the menu tree opens in its own modal, where Done keeps the ticks
 * and Cancel drops them. With allowSections a whole section can be ticked,
 * which covers dishes added to it later too.
 */
export function DishPicker({ catalog, itemIds, sectionIds = [], onChange, allowSections, title = 'Choose dishes', emptyLabel = 'Choose dishes' }) {
  const [open, setOpen] = useState(false)
  const names = useMemo(() => catalogNames(catalog), [catalog])
  const sections = allowSections ? sectionIds : []
  const count = itemIds.length + sections.length
  const remove = (kind, id) => onChange({
    item_ids: kind === 'item' ? itemIds.filter(x => x !== id) : itemIds,
    section_ids: kind === 'section' ? sectionIds.filter(x => x !== id) : sectionIds,
  })
  const chip = (kind, id, label) => (
    <span key={kind + id} className="inline-flex items-center gap-1 pl-3 pr-1 rounded-full border bg-muted/40 text-sm min-h-[36px]">
      {label}
      <button type="button" onClick={() => remove(kind, id)} aria-label={'Remove ' + label}
        className="w-8 h-8 inline-flex items-center justify-center rounded-full text-muted-foreground hover:bg-muted touch-manipulation">
        <X className="w-4 h-4" />
      </button>
    </span>
  )
  return (
    <div className="space-y-2">
      {count > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {sections.map(id => chip('section', id, (names.sections[id] || 'Removed section') + ' (whole section)'))}
          {itemIds.map(id => chip('item', id, names.items[id] || 'Removed dish'))}
        </div>
      )}
      <button type="button" onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 min-h-[44px] px-3 border rounded-md text-sm bg-background touch-manipulation">
        <ListChecks className="w-4 h-4" /> {count ? 'Change dishes' : emptyLabel}
      </button>
      {open && (
        <DishPickerModal catalog={catalog} title={title} allowSections={allowSections}
          itemIds={itemIds} sectionIds={sections}
          onCancel={() => setOpen(false)}
          onDone={v => { onChange(v); setOpen(false) }} />
      )}
    </div>
  )
}

export function DishPickerModal({ catalog, title, allowSections, itemIds, sectionIds, onCancel, onDone }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState({})
  const [itemSet, setItemSet] = useState(() => new Set(itemIds))
  const [sectionSet, setSectionSet] = useState(() => new Set(sectionIds))
  const needle = q.trim().toLowerCase()
  const flip = (set, setter, id) => {
    const next = new Set(set)
    next.has(id) ? next.delete(id) : next.add(id)
    setter(next)
  }
  const count = itemSet.size + sectionSet.size

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full sm:max-w-lg bg-background rounded-t-2xl sm:rounded-2xl shadow-xl flex flex-col max-h-[85vh]">
        <div className="px-4 py-3 border-b">
          <h2 className="text-sm font-semibold">{title}</h2>
          <div className="flex items-center gap-2 mt-2 px-3 border rounded-md">
            <Search className="w-4 h-4 text-muted-foreground" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search dishes" autoFocus={!IS_TOUCH}
              className="flex-1 min-h-[44px] bg-transparent text-sm outline-none" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto divide-y">
          {(catalog?.menus || []).map(m => {
            const sections = m.sections.map(s => ({
              ...s, items: needle ? s.items.filter(i => i.name.toLowerCase().includes(needle)) : s.items,
            })).filter(s => !needle || s.items.length || s.title.toLowerCase().includes(needle))
            if (!sections.length) return null
            return (
              <div key={m.id}>
                <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground bg-muted/40">{m.name}</div>
                {sections.map(s => {
                  const expanded = needle || open[s.id]
                  const whole = allowSections && sectionSet.has(s.id)
                  const picked = s.items.filter(i => itemSet.has(i.id)).length
                  return (
                    <div key={s.id} className="border-t first:border-t-0">
                      <div className="flex items-center gap-1 pr-2">
                        <button type="button" onClick={() => setOpen(o => ({ ...o, [s.id]: !o[s.id] }))}
                          className="flex-1 flex items-center gap-2 px-4 min-h-[48px] text-left text-sm touch-manipulation">
                          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                          <span className="font-medium">{s.title}</span>
                          {whole ? <span className="text-xs text-primary">whole section</span>
                            : picked > 0 && <span className="text-xs text-primary">{picked} chosen</span>}
                        </button>
                        {allowSections && (
                          <label className="flex items-center gap-2 text-xs min-h-[48px] px-2 cursor-pointer touch-manipulation">
                            <input type="checkbox" checked={whole} onChange={() => flip(sectionSet, setSectionSet, s.id)} className="w-5 h-5" />
                            Whole section
                          </label>
                        )}
                      </div>
                      {expanded && (
                        <div className="pl-10 pr-4 pb-2">
                          {s.items.map(i => (
                            <label key={i.id} className={cn('flex items-center gap-3 min-h-[44px] text-sm cursor-pointer touch-manipulation', whole && 'opacity-50')}>
                              <input type="checkbox" className="w-5 h-5" checked={itemSet.has(i.id) || whole}
                                disabled={whole} onChange={() => flip(itemSet, setItemSet, i.id)} />
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
          {!catalog && <p className="p-4 text-sm text-muted-foreground">Loading dishes…</p>}
          {catalog && !catalog.menus?.length && <p className="p-4 text-sm text-muted-foreground">No menus yet.</p>}
        </div>
        <div className="px-4 py-3 border-t flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground mr-auto">{count ? `${count} chosen` : 'Nothing chosen'}</span>
          {count > 0 && (
            <button type="button" onClick={() => { setItemSet(new Set()); setSectionSet(new Set()) }}
              className="min-h-[48px] px-3 text-sm text-muted-foreground underline touch-manipulation">Clear</button>
          )}
          <button type="button" onClick={onCancel} className="min-h-[48px] px-4 border rounded-lg text-sm touch-manipulation">Cancel</button>
          <button type="button" onClick={() => onDone({ item_ids: [...itemSet], section_ids: [...sectionSet] })}
            className="min-h-[48px] px-5 rounded-lg bg-primary text-primary-foreground text-sm font-medium touch-manipulation">Done</button>
        </div>
      </div>
    </div>
  )
}
