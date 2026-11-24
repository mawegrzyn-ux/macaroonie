// src/components/home/Pins.jsx — each person's own pins (migration 272,
// Pepper-first step 2a, docs/PEPPER_FIRST.md 4.3).
//
// A strip of chips, one per pin, each opening its page (at the pin's venue
// and tab when it has them: pageLink(), shared/nav/links.js). The pins are
// kept on the server (GET / PUT /api/pins, routes/pins.js), so they follow the
// person to any device; they replaced the Overview's Quick access picker,
// which kept its list in each browser. Edit pins opens a window where the
// person adds pages from their own menu (me.nav_tree: only pages they can
// open), drags them into order by the grip (pointer and touch), sets a venue
// and a tab where the page's address takes them, names one, or takes one off.
// Nothing is saved until Save (one PUT of the whole list).
//
// Shown on Home (pages/Home.jsx) and in the Overview's Quick access tile
// (pages/Dashboard.jsx); both read the same ['pins'] query. Someone with
// Manage on Navigation can suggest a pin's page to a role from its row
// (TeamSuggestions.jsx, step 7b).

import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import * as LucideIcons from 'lucide-react'
import { Pin, Pencil, X, Plus, GripVertical, Loader2, Search, Megaphone } from 'lucide-react'
import { DndContext, closestCenter, PointerSensor, TouchSensor, KeyboardSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { pageAccepts, pageLink } from '@shared/nav/links.js'
import { searchNavTree } from '@shared/navSearch.js'
import { SuggestForm, useCanSuggest } from '@/components/home/TeamSuggestions'

export const MAX_PINS = 12
const LABEL_MAX = 40

const iconOf = name => LucideIcons[name] || LucideIcons.Circle
const tabName = t => t ? t.charAt(0).toUpperCase() + t.slice(1) : ''

/** The person's menu links, once each, in menu order: { route, label, icon }. */
export function menuLinks(tree) {
  const out = []
  const seen = new Set()
  const walk = nodes => {
    for (const n of nodes || []) {
      if (n.kind === 'link' && n.route && !seen.has(n.route)) { seen.add(n.route); out.push({ route: n.route, label: n.label, icon: n.icon }) }
      walk(n.children)
    }
  }
  walk(tree)
  return out
}

/** The person's pins and the save: one query for every place that shows them. */
export function usePins() {
  const api = useApi()
  const qc = useQueryClient()
  const pins = useQuery({ queryKey: ['pins'], queryFn: () => api.get('/pins'), staleTime: 60_000 })
  const save = useMutation({
    mutationFn: list => api.put('/pins', { pins: list.map(p => ({ path: p.path, venue_id: p.venue_id || null, tab: p.tab || null, label: p.label || null })) }),
    onSuccess: res => qc.setQueryData(['pins'], res),
  })
  return { pins, save }
}

/** The strip of pins with its Edit pins button. `title` heads it (Home); the Overview's tile has its own head. */
export default function PinStrip({ title = null, className }) {
  const api = useApi()
  const { pins, save } = usePins()
  const [editing, setEditing] = useState(false)
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api.get('/me'), staleTime: 60_000 })
  const { data: venues = [] } = useQuery({ queryKey: ['venues'], queryFn: () => api.get('/venues') })
  const links = useMemo(() => menuLinks(me?.nav_tree), [me?.nav_tree])
  const byRoute = useMemo(() => new Map(links.map(l => [l.route, l])), [links])
  const venueName = id => venues.find(v => v.id === id)?.name
  const list = (pins.data?.pins || []).filter(p => byRoute.has(p.path))

  return (
    <div className={cn('space-y-2', className)} data-testid="pins">
      {title && <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>}
      <div className="flex flex-wrap gap-2 items-center">
        {pins.isLoading && <span className="text-sm text-muted-foreground inline-flex items-center gap-2 min-h-[48px]"><Loader2 className="w-4 h-4 animate-spin" /> Loading your pins</span>}
        {list.map(p => {
          const page = byRoute.get(p.path)
          const Icon = iconOf(page.icon)
          const where = [p.venue_id && venueName(p.venue_id), p.tab && tabName(p.tab)].filter(Boolean).join(' · ')
          return (
            <Link key={p.path + (p.venue_id || "") + (p.tab || "")} to={pageLink(p.path, { venue: p.venue_id, tab: p.tab })} data-testid="pin" data-path={p.path}
              className="inline-flex items-center gap-2 min-h-[48px] max-w-full rounded-full border bg-background pl-3 pr-4 py-1 text-sm hover:bg-accent hover:border-primary/40 touch-manipulation">
              <Icon className="w-4 h-4 shrink-0 text-primary" />
              <span className="min-w-0 text-left leading-tight">
                <span className="block font-medium truncate">{p.label || page.label}</span>
                {where && <span className="block text-xs text-muted-foreground truncate" data-testid="pin-where">{where}</span>}
              </span>
            </Link>
          )
        })}
        {pins.isSuccess && (
          <button type="button" onClick={() => setEditing(true)} data-testid="pins-edit"
            className="inline-flex items-center gap-2 min-h-[48px] rounded-full border border-dashed px-4 text-sm text-muted-foreground hover:bg-accent hover:text-foreground touch-manipulation">
            {list.length ? <Pencil className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
            {list.length ? 'Edit pins' : 'Pin a page'}
          </button>
        )}
        {pins.isError && <span className="text-sm text-destructive">Couldn&apos;t load your pins: {pins.error?.message}</span>}
      </div>
      {editing && (
        <PinEditor pins={list} links={links} venues={venues} save={save} onClose={() => setEditing(false)} />
      )}
    </div>
  )
}

let keySeq = 0
const withKey = p => ({ ...p, key: 'p' + (++keySeq) })

/** The window where pins are added, ordered, set and taken off. */
function PinEditor({ pins, links, venues, save, onClose }) {
  const [draft, setDraft] = useState(() => pins.map(withKey))
  const [query, setQuery] = useState('')
  const [error, setError] = useState(null)
  // Someone with Manage on Navigation can suggest a pinned page to a role (step 7b).
  const canSuggest = useCanSuggest()
  const [suggesting, setSuggesting] = useState(null)
  const byRoute = useMemo(() => new Map(links.map(l => [l.route, l])), [links])
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  // Pages to add: the menu search's own matcher over the person's links while typing.
  const choices = useMemo(() => {
    const found = searchNavTree(links.map(l => ({ kind: 'link', ...l })), query)
    return found ? found.map(r => byRoute.get(r.route)).filter(Boolean) : links
  }, [links, query, byRoute])
  const full = draft.length >= MAX_PINS
  const change = (key, patch) => setDraft(d => d.map(p => (p.key === key ? { ...p, ...patch } : p)))

  function onDragEnd({ active, over }) {
    if (!over || active.id === over.id) return
    setDraft(d => arrayMove(d, d.findIndex(p => p.key === active.id), d.findIndex(p => p.key === over.id)))
  }
  async function onSave() {
    setError(null)
    try {
      await save.mutateAsync(draft)
      onClose()
    } catch (err) {
      console.error(err)
      setError(err?.message || 'Couldn\'t save your pins.')
    }
  }

  // On document.body, so it covers the whole screen (the menu too), wherever the strip is.
  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Your pins" data-testid="pins-editor"
        className="w-full sm:max-w-2xl bg-background rounded-t-xl sm:rounded-xl shadow-xl flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>
        <div className="section-head px-4 h-14 shrink-0 flex items-center gap-2 rounded-t-xl">
          <Pin className="w-4 h-4" />
          <h2 className="font-semibold flex-1">Your pins</h2>
          <span className="text-sm opacity-80" data-testid="pins-count">{draft.length} of {MAX_PINS}</span>
          <button type="button" onClick={onClose} aria-label="Close" className="w-12 h-12 -mr-2 flex items-center justify-center rounded-md hover:bg-black/5 touch-manipulation">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            Pages you open often, on your Home. They are yours: nobody else sees them, and they follow you to any device.
            Drag by the grip to change the order.
          </p>
          {draft.length === 0 && <p className="text-sm text-muted-foreground border rounded-lg p-3">No pins yet: add a page below.</p>}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={draft.map(p => p.key)} strategy={verticalListSortingStrategy}>
              <ul className="space-y-2" data-testid="pins-draft">
                {draft.map(p => (
                  <PinRow key={p.key} pin={p} page={byRoute.get(p.path)} venues={venues}
                    onChange={patch => change(p.key, patch)} onRemove={() => setDraft(d => d.filter(x => x.key !== p.key))}
                    onSuggest={canSuggest ? () => setSuggesting(p) : null} />
                ))}
              </ul>
            </SortableContext>
          </DndContext>

          <section className="border rounded-lg overflow-hidden">
            <div className="section-head px-3 py-2 text-sm font-semibold">Add a page</div>
            <div className="p-3 space-y-2">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Find a page" aria-label="Find a page to pin"
                  data-testid="pins-find" className="w-full h-12 pl-9 pr-3 rounded-md border bg-background text-sm touch-manipulation" />
              </div>
              {full && <p className="text-sm text-amber-700" data-testid="pins-full">That is {MAX_PINS}: take one off to add another.</p>}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 max-h-64 overflow-y-auto">
                {choices.map(l => {
                  const Icon = iconOf(l.icon)
                  return (
                    <button key={l.route} type="button" disabled={full} data-testid="pins-add" data-route={l.route}
                      onClick={() => setDraft(d => [...d, withKey({ path: l.route, venue_id: null, tab: null, label: null })])}
                      className="flex items-center gap-2 min-h-[48px] px-3 rounded-md text-left text-sm hover:bg-accent disabled:opacity-40 touch-manipulation">
                      <Plus className="w-4 h-4 shrink-0 text-muted-foreground" />
                      <Icon className="w-4 h-4 shrink-0 text-primary" />
                      <span className="min-w-0 truncate">{l.label}</span>
                    </button>
                  )
                })}
                {!choices.length && <p className="text-sm text-muted-foreground px-1 py-2">No page in your menu matches that.</p>}
              </div>
            </div>
          </section>
        </div>
        {suggesting && <SuggestForm initial={suggesting} onClose={() => setSuggesting(null)} />}
        <div className="shrink-0 border-t p-3 flex items-center gap-2">
          {error && <p className="text-sm text-destructive flex-1 min-w-0" data-testid="pins-error">{error}</p>}
          <button type="button" onClick={onClose} className="ml-auto min-h-[48px] px-4 rounded-md border text-sm touch-manipulation">Cancel</button>
          <button type="button" onClick={onSave} disabled={save.isPending} data-testid="pins-save"
            className="min-h-[48px] px-5 rounded-md bg-primary text-primary-foreground text-sm font-medium inline-flex items-center gap-2 disabled:opacity-50 touch-manipulation">
            {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save pins
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function PinRow({ pin, page, venues, onChange, onRemove, onSuggest }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: pin.key })
  const { keys, tabs } = pageAccepts(pin.path)
  const Icon = iconOf(page?.icon)
  const field = 'h-12 rounded-md border bg-background px-2 text-sm touch-manipulation min-w-0'
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} data-testid="pins-row" data-path={pin.path}
      className={cn('border rounded-lg bg-background flex items-center gap-2 p-2', isDragging && 'shadow-lg relative z-10')}>
      <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={'Move ' + (page?.label || pin.path)}
        data-testid="pins-grip" className="w-12 h-12 shrink-0 flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent cursor-grab touch-none">
        <GripVertical className="w-5 h-5" />
      </button>
      <div className="flex-1 min-w-0 flex flex-wrap items-center gap-2">
      <span className="flex items-center gap-2 min-w-[6rem] flex-[1_1_8rem]">
        <Icon className="w-4 h-4 shrink-0 text-primary" />
        <span className="font-medium text-sm truncate">{page?.label || pin.path}</span>
      </span>
      <input value={pin.label || ''} maxLength={LABEL_MAX} onChange={e => onChange({ label: e.target.value })}
        placeholder="Own name (optional)" aria-label="Own name for this pin" data-testid="pins-label"
        className={cn(field, 'flex-[1_1_9rem]')} />
      {keys.includes('venue') && venues.length > 0 && (
        <select value={pin.venue_id || ''} onChange={e => onChange({ venue_id: e.target.value || null })} aria-label="Venue it opens at"
          data-testid="pins-venue" className={cn(field, 'flex-[1_1_8rem]')}>
          <option value="">Any venue</option>
          {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      )}
      {keys.includes('tab') && tabs.length > 0 && (
        <select value={pin.tab || ''} onChange={e => onChange({ tab: e.target.value || null })} aria-label="Tab it opens at"
          data-testid="pins-tab" className={cn(field, 'flex-[1_1_7rem]')}>
          <option value="">First tab</option>
          {tabs.map(t => <option key={t} value={t}>{tabName(t)}</option>)}
        </select>
      )}
      </div>
      {onSuggest && (
        <button type="button" onClick={onSuggest} aria-label={'Suggest ' + (page?.label || pin.path) + ' to a role'} title="Suggest to a role" data-testid="pins-suggest"
          className="w-12 h-12 shrink-0 flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground touch-manipulation">
          <Megaphone className="w-4 h-4" />
        </button>
      )}
      <button type="button" onClick={onRemove} aria-label={'Take ' + (page?.label || pin.path) + ' off'} data-testid="pins-remove"
        className="w-12 h-12 shrink-0 flex items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive touch-manipulation">
        <X className="w-4 h-4" />
      </button>
    </li>
  )
}
