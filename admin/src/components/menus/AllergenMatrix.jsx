// Allergen matrix: every dish of a menu against every allergen and
// dietary tag. Two views over the same data (GET /menus/:id/allergens,
// each dish's tags as { tag id: level }):
//   AllergenMatrixEditor  the Menus > Allergen matrix page: tap an allergen
//                         cell to cycle No / Contains / May contain / Can
//                         be removed, a dietary cell to toggle it; explicit
//                         Save (PUT, only the dishes changed)
//   AllergenLookup        read-only lookup for the H&S Dashboard widget, the
//                         Overview tile and /mobile/allergens: search a
//                         dish, or filter by "has" / "free from" a tag
// Both have a menu picker and a search box. Tags are tenant-wide (Menus >
// Allergens & dietary, migration 145); the API lists allergens first.

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Search, X, Loader2, Check, EyeOff, AlertTriangle, ChevronDown, SlidersHorizontal } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { LEVEL_LABELS } from '@shared/menuTags.js'
import { TagChip } from './DietaryTagsManager'

function readStore(key) {
  try { return localStorage.getItem(key) || '' } catch { return '' }
}
function writeStore(key, value) {
  try { value ? localStorage.setItem(key, value) : localStorage.removeItem(key) } catch { /* private mode */ }
}

const norm = (s) => String(s || '').toLowerCase()

function matchesSearch(item, q) {
  if (!q) return true
  return norm(item.name).includes(q) || norm(item.native_name).includes(q)
}

/** The tenant's menus plus the chosen one, remembered under storeKey. */
export function useMenuChoice(storeKey) {
  const api = useApi()
  const { data: menus = [], isLoading } = useQuery({
    queryKey: ['menus'],
    queryFn:  () => api.get('/menus'),
  })
  const [picked, setPicked] = useState(() => readStore(storeKey))
  const menuId = menus.some(m => m.id === picked) ? picked : (menus[0]?.id || '')
  function setMenuId(id) {
    setPicked(id)
    writeStore(storeKey, id)
  }
  return { menus, menuId, setMenuId, isLoading }
}

export function useAllergenMatrix(menuId) {
  const api = useApi()
  return useQuery({
    queryKey: ['allergen-matrix', menuId],
    queryFn:  () => api.get(`/menus/${menuId}/allergens`),
    enabled:  !!menuId,
  })
}

export function MenuSelect({ menus, value, onChange, disabled, className }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} disabled={disabled}
      aria-label="Menu"
      className={cn('border rounded-md px-2 text-sm bg-background min-h-[44px] touch-manipulation disabled:opacity-60', className)}>
      {menus.map(m => (
        <option key={m.id} value={m.id}>{m.name}{m.venue_name ? ` (${m.venue_name})` : ''}</option>
      ))}
    </select>
  )
}

export function SearchBox({ value, onChange, placeholder = 'Search dishes', className }) {
  return (
    <div className={cn('relative', className)}>
      <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        type="text" enterKeyHint="search" aria-label="Search dishes"
        className="w-full border rounded-md pl-8 pr-9 text-sm bg-background min-h-[44px]" />
      {value && (
        <button type="button" onClick={() => onChange('')} aria-label="Clear search"
          className="absolute right-0 top-0 h-full w-9 flex items-center justify-center text-muted-foreground hover:text-foreground touch-manipulation">
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}

function sameLevels(a, b) {
  const ka = Object.keys(a || {})
  if (ka.length !== Object.keys(b || {}).length) return false
  return ka.every(k => a[k] === b[k])
}

// Allergens cycle through the levels; a dietary tag is on or off.
const NEXT_LEVEL = { none: 'contains', contains: 'may_contain', may_contain: 'removable', removable: null }
function nextLevel(tag, level) {
  if (tag.kind !== 'allergen') return level ? null : 'contains'
  return NEXT_LEVEL[level || 'none']
}

/** A tag badge drawn for its level: Contains = filled, May contain =
 *  outlined on a pale tint, Can be removed = filled with an asterisk. Staff tools
 *  only; menus show May contain the same as Contains. */
export function LevelChip({ tag, level, className = 'w-8 h-8 text-xs' }) {
  if (level === 'may_contain') {
    return (
      <span className={cn('inline-flex items-center justify-center rounded font-bold border-2 px-1 shrink-0', className)}
        style={{ borderColor: tag.colour, color: tag.colour, background: `color-mix(in srgb, ${tag.colour} 14%, white)` }}>{tag.glyph}</span>
    )
  }
  return (
    <span className={cn('inline-flex items-center justify-center rounded font-bold text-white px-1 shrink-0', className)}
      style={{ background: tag.colour }}>
      {tag.glyph || <Check className="w-4 h-4" />}
      {level === 'removable' && <span className="self-start text-[0.85em] ml-px">*</span>}
    </span>
  )
}

function LevelKey() {
  const sample = { glyph: 'Ab', colour: '#57534e' }
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {['contains', 'may_contain', 'removable'].map(l => (
        <span key={l} className="inline-flex items-center gap-1.5">
          <LevelChip tag={sample} level={l} className="w-7 h-6 text-[10px]" />{LEVEL_LABELS[l]}
        </span>
      ))}
    </div>
  )
}

// ── Editor (page) ──────────────────────────────────────────────

export function AllergenMatrixEditor({ canEdit }) {
  const api = useApi()
  const qc  = useQueryClient()
  const { menus, menuId, setMenuId, isLoading: menusLoading } = useMenuChoice('maca_allergen_matrix_menu')
  const { data, isLoading, error } = useAllergenMatrix(menuId)
  const [search, setSearch] = useState('')
  // item id -> { tag id: level }, only for dishes the operator has touched.
  const [draft, setDraft] = useState({})
  const [saveError, setSaveError] = useState('')

  useEffect(() => { setDraft({}); setSaveError('') }, [menuId])

  const savedTags = useMemo(() => {
    const out = {}
    for (const s of data?.sections || []) for (const i of s.items) out[i.id] = i.levels || {}
    return out
  }, [data])

  const changedIds = Object.keys(draft).filter(id => savedTags[id] && !sameLevels(draft[id], savedTags[id]))
  const dirty = changedIds.length > 0

  const save = useMutation({
    mutationFn: () => api.put(`/menus/${menuId}/allergens`, {
      items: changedIds.map(id => ({ item_id: id, levels: draft[id] })),
    }),
    onSuccess: (fresh) => {
      qc.setQueryData(['allergen-matrix', menuId], fresh)
      qc.invalidateQueries({ queryKey: ['menu', menuId] })
      setDraft({})
      setSaveError('')
    },
    onError: (e) => setSaveError(e?.message || 'Save failed'),
  })

  function tagsOf(itemId) {
    return draft[itemId] || savedTags[itemId] || {}
  }
  function toggle(itemId, tag) {
    if (!canEdit) return
    const next = { ...tagsOf(itemId) }
    const level = nextLevel(tag, next[tag.id])
    if (level) next[tag.id] = level; else delete next[tag.id]
    setDraft(d => ({ ...d, [itemId]: next }))
  }

  const q = norm(search.trim())
  const tags = data?.tags || []
  const allergenCount = tags.filter(t => t.kind === 'allergen').length
  const sections = (data?.sections || [])
    .map(s => ({ ...s, items: s.items.filter(i => matchesSearch(i, q)) }))
    .filter(s => s.items.length > 0)
  const dishCount = sections.reduce((n, s) => n + s.items.length, 0)

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex flex-wrap items-center gap-2 pb-3">
        <MenuSelect menus={menus} value={menuId} onChange={setMenuId} disabled={dirty}
          className="min-w-[12rem] max-w-full" />
        <SearchBox value={search} onChange={setSearch} className="flex-1 min-w-[12rem]" />
        {canEdit && (
          <div className="flex items-center gap-2 ml-auto">
            {dirty && (
              <button type="button" onClick={() => { setDraft({}); setSaveError('') }} disabled={save.isPending}
                className="px-3 min-h-[44px] rounded-md border text-sm hover:bg-accent touch-manipulation">
                Discard
              </button>
            )}
            <button type="button" onClick={() => save.mutate()} disabled={!dirty || save.isPending}
              className="inline-flex items-center gap-1.5 px-4 min-h-[44px] rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 touch-manipulation">
              {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {dirty ? `Save ${changedIds.length} ${changedIds.length === 1 ? 'dish' : 'dishes'}` : 'Saved'}
            </button>
          </div>
        )}
      </div>
      {dirty && <p className="text-xs text-muted-foreground -mt-1 pb-2">Save or discard your changes to switch menu.</p>}
      {allergenCount > 0 && (
        <div className="pb-2"><LevelKey /></div>
      )}
      {saveError && <p className="text-sm text-destructive pb-2">{saveError}</p>}

      {(menusLoading || isLoading) ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : !menus.length ? (
        <p className="text-sm text-muted-foreground py-12 text-center">No menus yet. Create one on the Menus page first.</p>
      ) : error ? (
        <p className="text-sm text-destructive py-12 text-center">{error.message}</p>
      ) : !tags.length ? (
        <p className="text-sm text-muted-foreground py-12 text-center">No allergens or dietary tags yet. Add them under Menus, Allergens &amp; dietary.</p>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto border rounded-lg bg-background">
          <table className="border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th rowSpan={2} className="sticky top-0 left-0 z-30 bg-muted text-left font-medium px-3 py-2 border-b border-r min-w-[13rem] align-bottom">
                  Dish <span className="font-normal text-muted-foreground">({dishCount})</span>
                </th>
                {[['allergen', 'Allergens'], ['dietary', 'Dietary tags']].map(([k, label]) => {
                  const n = tags.filter(t => (t.kind === 'allergen') === (k === 'allergen')).length
                  return n > 0 && (
                    <th key={k} colSpan={n} scope="colgroup"
                      className={cn('sticky top-0 z-20 bg-muted h-7 px-2 border-b text-left text-[11px] font-semibold uppercase tracking-wide',
                        k === 'dietary' && allergenCount > 0 && 'border-l-2 border-l-foreground/20')}>
                      <span className="sticky left-[13.5rem] inline-block">{label}</span>
                    </th>
                  )
                })}
              </tr>
              <tr>
                {tags.map((t, ti) => (
                  <th key={t.id} scope="col" title={t.show_on_menu === false ? `${t.label} (not shown on menus)` : t.label}
                    className={cn('sticky top-7 z-20 bg-muted px-1 py-2 border-b font-normal align-bottom w-14 min-w-[3.5rem]',
                      ti === allergenCount && ti > 0 && 'border-l-2 border-l-foreground/20')}>
                    <div className="flex flex-col items-center gap-1.5">
                      <span className="text-xs leading-tight whitespace-nowrap [writing-mode:vertical-rl] rotate-180 max-h-[9rem] overflow-hidden text-ellipsis">{t.label}</span>
                      {t.show_on_menu === false && (
                        <EyeOff className="w-3.5 h-3.5 text-muted-foreground" aria-label="Not shown on menus" />
                      )}
                      <TagChip tag={t} />
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sections.map(s => (
                <SectionRows key={s.id} section={s} tags={tags} tagsOf={tagsOf} allergenCount={allergenCount}
                  savedTags={savedTags} draft={draft} onToggle={toggle} canEdit={canEdit} />
              ))}
              {sections.length === 0 && (
                <tr><td colSpan={tags.length + 1} className="px-3 py-8 text-center text-muted-foreground">
                  {q ? 'No dishes match your search.' : 'This menu has no dishes yet.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function SectionRows({ section, tags, tagsOf, allergenCount, savedTags, draft, onToggle, canEdit }) {
  return (
    <>
      <tr>
        <th colSpan={tags.length + 1} scope="colgroup"
          className="text-left bg-muted/50 px-3 py-1.5 border-b text-xs font-semibold uppercase tracking-wide">
          <span className="sticky left-3 inline-flex items-center gap-2">
            {section.title}
            {section.visibility !== 'show' && (
              <span className="inline-flex items-center gap-1 font-normal normal-case tracking-normal text-muted-foreground">
                <EyeOff className="w-3 h-3" />
                {section.visibility === 'hidden' ? 'Hidden everywhere' : 'Hidden on website'}
              </span>
            )}
          </span>
        </th>
      </tr>
      {section.items.map(item => {
        const has = tagsOf(item.id)
        const changed = draft[item.id] && !sameLevels(draft[item.id], savedTags[item.id] || {})
        return (
          <tr key={item.id} className="group">
            <th scope="row"
              className={cn('sticky left-0 z-10 text-left font-normal px-3 py-1.5 border-b border-r bg-background group-hover:bg-accent/60 max-w-[16rem]',
                changed && 'bg-amber-50 dark:bg-amber-950/30')}>
              <div className="font-medium leading-snug">{item.name}</div>
              {item.native_name && <div className="text-xs text-muted-foreground leading-snug">{item.native_name}</div>}
            </th>
            {tags.map((t, ti) => {
              const level = has[t.id]
              const cellChanged = changed && (level || null) !== (savedTags[item.id]?.[t.id] || null)
              const state = level ? (t.kind === 'allergen' ? LEVEL_LABELS[level] : 'Yes') : 'No'
              return (
                <td key={t.id} className={cn('border-b p-0 text-center group-hover:bg-accent/30',
                  ti === allergenCount && ti > 0 && 'border-l-2 border-l-foreground/20')}>
                  <button type="button" onClick={() => onToggle(item.id, t)} disabled={!canEdit}
                    aria-label={`${t.label}, ${item.name}: ${state}`} title={`${t.label}: ${state}`}
                    className={cn('w-14 h-12 flex items-center justify-center touch-manipulation disabled:cursor-default',
                      cellChanged && 'ring-2 ring-inset ring-amber-400')}>
                    {level
                      ? <LevelChip tag={t} level={level} />
                      : <span className="inline-block w-8 h-8 rounded border-2 border-dashed border-muted-foreground/25" />}
                  </button>
                </td>
              )
            })}
          </tr>
        )
      })}
    </>
  )
}

// ── Lookup (dashboard widget / Overview tile / /mobile/allergens) ──

// Tag filter states: tap cycles off -> has -> free from -> off. "Has"
// matches any level; "free from" an allergen also keeps dishes that can be
// made without it, marked "Ask for it without ..." (May contain never counts
// as free from).
const NEXT_MODE = { undefined: 'has', has: 'not', not: undefined }

const LEVEL_ORDER = ['contains', 'may_contain', 'removable']

// `phone` (the /mobile page): menu + search stick to the top while the
// list scrolls, and the tag filter folds away behind one button.
export function AllergenLookup({ storeKey = 'maca_allergen_lookup_menu', phone = false }) {
  const { menus, menuId, setMenuId, isLoading: menusLoading } = useMenuChoice(storeKey)
  const { data, isLoading } = useAllergenMatrix(menuId)
  const [search, setSearch] = useState('')
  const [modes, setModes] = useState({})   // tag id -> 'has' | 'not'
  const [openId, setOpenId] = useState(null)   // dish shown with full tag names
  const [showTags, setShowTags] = useState(!phone)

  useEffect(() => { setModes({}); setOpenId(null) }, [menuId])

  const tags = data?.tags || []
  const tagById = useMemo(() => Object.fromEntries(tags.map(t => [t.id, t])), [tags])
  const q = norm(search.trim())
  const active = Object.entries(modes).filter(([, m]) => m)
  const filtering = !!q || active.length > 0

  // "Hidden everywhere" sections are not on the menu any more, so they
  // are left out here (the matrix page still shows them).
  const sections = (data?.sections || [])
    .filter(s => s.visibility !== 'hidden')
    .map(s => ({
      ...s,
      items: s.items.filter(i => {
        if (!matchesSearch(i, q)) return false
        for (const [tagId, mode] of active) {
          const level = (i.levels || {})[tagId]
          if (mode === 'has' && !level) return false
          if (mode === 'not' && level && level !== 'removable') return false
        }
        return true
      }),
    }))
    .filter(s => s.items.length > 0)
  const count = sections.reduce((n, s) => n + s.items.length, 0)

  function cycle(tagId) {
    setModes(m => ({ ...m, [tagId]: NEXT_MODE[m[tagId]] }))
  }

  if (menusLoading) {
    return <div className="flex items-center justify-center py-8 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>
  }
  if (!menus.length) {
    return <p className="text-sm text-muted-foreground p-4 text-center">No menus yet.</p>
  }

  const controls = (
    <div className="flex flex-wrap gap-2">
      <MenuSelect menus={menus} value={menuId} onChange={setMenuId} className="flex-1 min-w-[9rem]" />
      <SearchBox value={search} onChange={setSearch} className="flex-[2] min-w-[10rem]" />
      {phone && tags.length > 0 && (
        <button type="button" onClick={() => setShowTags(v => !v)} aria-expanded={showTags}
          className={cn('w-full inline-flex items-center gap-2 px-3 min-h-[44px] rounded-md border text-sm touch-manipulation',
            active.length > 0 && 'border-foreground font-medium')}>
          <SlidersHorizontal className="w-4 h-4" />
          <span className="flex-1 min-w-0 text-left truncate">
            {active.length
              ? active.map(([id, m]) => `${m === 'has' ? 'Has' : 'Free from'} ${tagById[id]?.label ?? ''}`).join(' · ')
              : 'Filter by allergen or diet'}
          </span>
          <ChevronDown className={cn('w-4 h-4 transition-transform', showTags && 'rotate-180')} />
        </button>
      )}
    </div>
  )

  return (
    <div className={cn('space-y-2', phone ? 'px-3 pb-24' : 'p-3')}>
      {phone
        ? <div className="sticky top-0 z-10 bg-background -mx-3 px-3 pt-3 pb-2 border-b">{controls}</div>
        : controls}

      {tags.length > 0 && showTags && (
        <div>
          <div className="flex flex-wrap gap-1.5">
            {tags.map(t => {
              const mode = modes[t.id]
              return (
                <button key={t.id} type="button" onClick={() => cycle(t.id)}
                  aria-label={`${t.label}: ${mode === 'has' ? 'contains' : mode === 'not' ? 'free from' : 'any'}`}
                  className={cn('inline-flex items-center gap-1.5 rounded-full border pl-1 pr-2.5 min-h-[40px] text-xs touch-manipulation',
                    mode === 'has' && 'border-foreground bg-foreground/5 font-medium',
                    mode === 'not' && 'border-emerald-600 bg-emerald-50 text-emerald-800 font-medium dark:bg-emerald-950/40 dark:text-emerald-300')}>
                  <TagChip tag={t} size="w-6 h-6" />
                  <span className={cn(mode === 'not' && 'line-through decoration-2')}>{t.label}</span>
                  {mode === 'has' && <span className="text-[10px] uppercase tracking-wide">has</span>}
                  {mode === 'not' && <span className="text-[10px] uppercase tracking-wide">free</span>}
                </button>
              )
            })}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            Tap a tag once for dishes that have it, twice for dishes free from it (including dishes it can be removed from).
            {active.length > 0 && (
              <button type="button" onClick={() => setModes({})} className="ml-2 underline touch-manipulation">Clear tags</button>
            )}
          </p>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-6 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : (
        <>
          {filtering && <p className="text-xs text-muted-foreground">{count} {count === 1 ? 'dish' : 'dishes'}</p>}
          <div className="divide-y border rounded-md">
            {sections.map(s => (
              <div key={s.id}>
                <div className="px-2.5 py-1 bg-muted/50 text-[11px] font-semibold uppercase tracking-wide">{s.title}</div>
                {s.items.map(i => {
                  const levels = i.levels || {}
                  // Dish badges: allergens first (as the API lists tags), then dietary tags.
                  const itemTags = tags.filter(t => levels[t.id])
                  // Free-from filters this dish only passes because the allergen can be removed.
                  const removeFor = active
                    .filter(([id, m]) => m === 'not' && levels[id] === 'removable')
                    .map(([id]) => tagById[id]?.label).filter(Boolean)
                  const groups = [
                    ...LEVEL_ORDER.map(l => [LEVEL_LABELS[l], itemTags.filter(t => t.kind === 'allergen' && levels[t.id] === l)]),
                    ['Dietary', itemTags.filter(t => t.kind !== 'allergen')],
                  ].filter(([, list]) => list.length)
                  const open = openId === i.id
                  return (
                    <div key={i.id} className={cn('border-t first:border-t-0', open && 'bg-muted/30')}>
                      <button type="button" onClick={() => setOpenId(open ? null : i.id)} aria-expanded={open}
                        className="w-full flex items-start gap-2 px-2.5 py-2 text-left min-h-[48px] touch-manipulation">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium leading-snug">{i.name}</div>
                          {i.native_name && <div className="text-xs text-muted-foreground">{i.native_name}</div>}
                          {removeFor.length > 0 && (
                            <div className="text-xs font-medium text-amber-700 dark:text-amber-300">Ask for it without {removeFor.join(', ')}</div>
                          )}
                        </div>
                        <div className="flex flex-wrap justify-end gap-1 max-w-[60%]">
                          {itemTags.map(t => (
                            <span key={t.id} title={`${t.label}${t.kind === 'allergen' ? ': ' + LEVEL_LABELS[levels[t.id]] : ''}`}>
                              <LevelChip tag={t} level={t.kind === 'allergen' ? levels[t.id] : 'contains'} className="min-w-[1.6rem] h-6 text-[11px]" />
                            </span>
                          ))}
                          {itemTags.length === 0 && <span className="text-[11px] text-muted-foreground">No tags</span>}
                        </div>
                      </button>
                      {open && (
                        <div className="px-2.5 pb-3 space-y-2 text-sm">
                          {i.description && <p className="text-muted-foreground">{i.description}</p>}
                          {groups.length ? (
                            <div className="space-y-2">
                              {groups.map(([title, list]) => (
                                <div key={title}>
                                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
                                  <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                                    {list.map(t => (
                                      <li key={t.id} className="flex items-center gap-2">
                                        <LevelChip tag={t} level={t.kind === 'allergen' ? levels[t.id] : 'contains'} className="min-w-[1.5rem] h-6 text-[11px]" />
                                        <span>{t.label}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-muted-foreground">No allergen or dietary tags recorded for this dish.</p>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
            {sections.length === 0 && (
              <p className="px-3 py-6 text-sm text-center text-muted-foreground">
                {filtering ? 'No dishes match.' : 'This menu has no dishes yet.'}
              </p>
            )}
          </div>
          {tags.length > 0 && (
            <div className="space-y-1.5">
              <LevelKey />
              <p className="text-[11px] text-muted-foreground flex items-start gap-1">
                <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                Only shows the tags recorded on each dish. Check recipes and suppliers before confirming an allergy.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
