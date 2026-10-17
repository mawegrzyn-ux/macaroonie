// Tenant-wide reusable variant option sets (Protein, Size…), attachable
// to any dish across any menu. Standalone manager — lives at
// /menus/variant-groups, not nested inside a specific menu's editor.
// Till fields (migration 156): pos_prefixes (the till offers No / Light /
// Extra / On the side for each option) and an option's child_group_id
// (pick it, then the till asks that group too, e.g. Steak -> Cooking).
// Migration 171: allow_repeat (the same option more than once, 2 x Extra
// cheese) and on_request (an optional group waits behind a button on the
// till and the ordering page instead of opening by itself).
// Migration 172 (self-order kiosks): kiosk_display (grid / list / slider /
// spin wheel, empty = the kiosk design's choice), scale_low / scale_high (the
// words at the ends of a level scale) and, per option, a picture, a line of
// words and a level (0-5 on that scale). Options drag into order.

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, TouchSensor, useSensor, useSensors,
} from '@dnd-kit/core'
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Plus, Trash2, X, Loader2, Layers, GripVertical } from 'lucide-react'
import { KIOSK_DISPLAYS, DISPLAY_LABELS } from '@shared/kiosk.js'
import { useApi } from '@/lib/api'
import { PicturePick } from '@/components/media/PicturePick'
import { Field, Input, Btn, PriceInput } from './shared'

let keySeq = 0
const newKey = () => 'o' + (++keySeq) + '-' + Date.now().toString(36)
const newOption = () => ({ _key: newKey(), label: '', price_pence: 0, child_group_id: null, image_url: null, description: '', level: null })

function emptyGroup() {
  return {
    name: '', price_mode: 'base', min_select: 1, max_select: 1, pos_prefixes: false, allow_repeat: false, on_request: false,
    kiosk_display: null, scale_low: '', scale_high: '', options: [newOption()],
  }
}

const LEVELS = [0, 1, 2, 3, 4, 5]

function OptionRow({ o, groups, draftId, onPatch, onRemove }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: o._key })
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      className="rounded-md border bg-background p-2 space-y-2" data-testid="vg-option">
      <div className="flex items-center gap-2">
        <button type="button" {...attributes} {...listeners} aria-label="Drag to reorder"
          className="w-9 h-11 shrink-0 flex items-center justify-center text-muted-foreground cursor-grab active:cursor-grabbing touch-manipulation">
          <GripVertical className="w-4 h-4" />
        </button>
        <PicturePick url={o.image_url || null} onChange={url => onPatch({ image_url: url })} scope="menu:option" size="sm" label="option picture" />
        <Input value={o.label} onChange={e => onPatch({ label: e.target.value })} placeholder="Label (e.g. Chicken)" className="flex-1 min-w-0" />
        <PriceInput pence={o.price_pence} onChange={pence => onPatch({ price_pence: pence ?? 0 })} placeholder="£0.00" className="w-24 font-mono" />
        <button type="button" onClick={onRemove} aria-label={'Remove ' + (o.label || 'this option')}
          className="text-destructive hover:bg-destructive/10 rounded w-9 h-11 shrink-0 flex items-center justify-center touch-manipulation">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-11">
        <Input value={o.description || ''} maxLength={300} onChange={e => onPatch({ description: e.target.value })}
          placeholder="Line of words on the kiosk (optional)" className="flex-1 min-w-[160px]" aria-label={'Words for ' + (o.label || 'this option')} />
        <select value={o.level ?? ''} aria-label={'Level of ' + (o.label || 'this option')}
          onChange={e => onPatch({ level: e.target.value === '' ? null : Number(e.target.value) })}
          className="text-xs border rounded-md px-1 min-h-[36px] bg-background">
          <option value="">No level</option>
          {LEVELS.map(n => <option key={n} value={n}>Level {n}</option>)}
        </select>
        {groups.some(g => g.id !== draftId) && (
          <select value={o.child_group_id || ''} aria-label={'Then ask, for ' + (o.label || 'this option')}
            onChange={e => onPatch({ child_group_id: e.target.value || null })}
            className="text-xs border rounded-md px-1 min-h-[36px] bg-background max-w-[150px]">
            <option value="">Then ask: nothing</option>
            {groups.filter(g => g.id !== draftId).map(g => <option key={g.id} value={g.id}>Then ask: {g.name}</option>)}
          </select>
        )}
      </div>
    </div>
  )
}

export function VariantGroupsManager() {
  const api = useApi()
  const qc  = useQueryClient()
  const { data: groups = [], isLoading } = useQuery({
    queryKey: ['menu-variant-groups'],
    queryFn:  () => api.get('/menus/variant-groups'),
  })
  const [draft, setDraft] = useState(null) // null | { id?: uuid, name, options }
  const [confirmDel, setConfirmDel] = useState(null) // group id asking "are you sure"
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: draft.name.trim(),
        // Web ordering: how the price works and how many a guest picks.
        price_mode: draft.price_mode || 'base',
        min_select: Math.max(0, Number(draft.min_select ?? 1)),
        max_select: Math.max(1, Number(draft.max_select ?? 1)),
        pos_prefixes: !!draft.pos_prefixes,
        allow_repeat: !!draft.allow_repeat,
        on_request: !!draft.on_request && Number(draft.min_select ?? 1) === 0,
        kiosk_display: draft.kiosk_display || null,
        scale_low: (draft.scale_low || '').trim() || null,
        scale_high: (draft.scale_high || '').trim() || null,
        sort_order: draft.id ? (groups.find(g => g.id === draft.id)?.sort_order ?? 0) : groups.length,
        options: (draft.options || [])
          .filter(o => o.label.trim())
          .map((o, i) => ({
            id: o.id,
            label: o.label.trim(),
            price_pence: o.price_pence ?? 0,
            child_group_id: o.child_group_id || null,
            image_url: o.image_url || null,
            description: (o.description || '').trim() || null,
            level: o.level ?? null,
            sort_order: i,
          })),
      }
      return draft.id
        ? api.patch(`/menus/variant-groups/${draft.id}`, payload)
        : api.post('/menus/variant-groups', payload)
    },
    onSuccess: () => {
      setDraft(null)
      qc.invalidateQueries({ queryKey: ['menu-variant-groups'] })
      qc.invalidateQueries({ queryKey: ['menu'] })
    },
  })
  const del = useMutation({
    mutationFn: (id) => api.delete(`/menus/variant-groups/${id}`),
    onSuccess: () => {
      setDraft(null)
      qc.invalidateQueries({ queryKey: ['menu-variant-groups'] })
      qc.invalidateQueries({ queryKey: ['menu'] })
    },
  })

  function editGroup(g) {
    setDraft({
      id: g.id,
      name: g.name,
      price_mode: g.price_mode || 'base',
      min_select: g.min_select ?? 1,
      max_select: g.max_select ?? 1,
      pos_prefixes: !!g.pos_prefixes,
      allow_repeat: !!g.allow_repeat,
      on_request: !!g.on_request,
      kiosk_display: g.kiosk_display || null,
      scale_low: g.scale_low || '',
      scale_high: g.scale_high || '',
      options: (g.options || []).map(o => ({ ...o, _key: o.id || newKey(), description: o.description || '' })),
    })
  }

  const patchOption = (key, patch) => setDraft(d => ({ ...d, options: d.options.map(o => (o._key === key ? { ...o, ...patch } : o)) }))
  function onDragEnd({ active, over }) {
    if (!over || active.id === over.id) return
    setDraft(d => {
      const from = d.options.findIndex(o => o._key === active.id)
      const to = d.options.findIndex(o => o._key === over.id)
      return from < 0 || to < 0 ? d : { ...d, options: arrayMove(d.options, from, to) }
    })
  }
  const hasLevels = (draft?.options || []).some(o => o.level != null)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="border rounded-md divide-y bg-background">
        {groups.map(g => (
          <div key={g.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
            <Layers className="w-4 h-4 text-violet-600 shrink-0" />
            <span className="font-medium flex-1">{g.name}</span>
            <span className="text-xs text-muted-foreground truncate max-w-[40%]">
              {(g.options || []).map(o => o.label).join(', ') || 'No options'}
            </span>
            <button onClick={() => editGroup(g)} className="text-xs text-primary hover:underline shrink-0 min-h-[44px] px-2">Edit</button>
            {confirmDel === g.id ? (
              <span className="inline-flex items-center gap-1 shrink-0">
                <button onClick={() => { setConfirmDel(null); del.mutate(g.id) }}
                  className="text-xs rounded-md px-2 min-h-[40px] bg-destructive text-destructive-foreground touch-manipulation">Delete: dishes lose it</button>
                <button onClick={() => setConfirmDel(null)} className="text-xs rounded-md px-2 min-h-[40px] border touch-manipulation">Cancel</button>
              </span>
            ) : (
              <button onClick={() => setConfirmDel(g.id)} aria-label={'Delete ' + g.name}
                className="text-destructive hover:bg-destructive/10 p-1.5 rounded shrink-0 min-h-[40px] min-w-[40px] flex items-center justify-center">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}
        {groups.length === 0 && (
          <div className="px-3 py-6 text-sm text-muted-foreground text-center">
            No variant groups yet. Create "Protein" or "Size" and attach them to dishes from the menu editor.
          </div>
        )}
      </div>

      {draft ? (
        <div className="border rounded-lg p-4 bg-violet-50/60 space-y-3" data-testid="vg-editor">
          <Field label="Group name">
            <Input value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
              placeholder="e.g. Protein" autoFocus />
          </Field>
          <div className="rounded-md border bg-background p-3 space-y-2">
            <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wide">Online ordering</p>
            <div className="flex flex-wrap gap-2">
              {[['base', 'Option price is the dish price'], ['extra', 'Option price is added on top']].map(([k, l]) => (
                <button key={k} type="button" onClick={() => setDraft(d => ({ ...d, price_mode: k }))}
                  className={cn('text-xs px-3 min-h-[40px] rounded-md border touch-manipulation',
                    (draft.price_mode || 'base') === k ? 'bg-primary text-primary-foreground border-primary' : 'bg-background')}>
                  {l}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label className="inline-flex items-center gap-2">Guest picks at least
                <input type="number" min="0" max="20" inputMode="numeric" value={draft.min_select ?? 1}
                  onChange={e => setDraft(d => ({ ...d, min_select: Math.max(0, Number(e.target.value) || 0) }))}
                  className="w-16 border rounded px-2 min-h-[40px]" />
              </label>
              <label className="inline-flex items-center gap-2">and at most
                <input type="number" min="1" max="20" inputMode="numeric" value={draft.max_select ?? 1}
                  onChange={e => setDraft(d => ({ ...d, max_select: Math.max(1, Number(e.target.value) || 1) }))}
                  className="w-16 border rounded px-2 min-h-[40px]" />
              </label>
            </div>
            <p className="text-[11px] text-muted-foreground">
              A protein or size choice: dish price, pick 1. Extras: added on top, at least 0, at most as many as allowed.
            </p>
            <label className="flex items-start gap-2 text-sm min-h-[40px] touch-manipulation">
              <input type="checkbox" className="mt-1" checked={!!draft.allow_repeat}
                onChange={e => setDraft(d => ({ ...d, allow_repeat: e.target.checked }))} />
              <span>The same option more than once
                <span className="block text-[11px] text-muted-foreground">e.g. 2 x Extra cheese. Each one counts towards "at most" and is charged.</span>
              </span>
            </label>
            <label className={cn('flex items-start gap-2 text-sm min-h-[40px] touch-manipulation', Number(draft.min_select ?? 1) > 0 && 'opacity-50')}>
              <input type="checkbox" className="mt-1" checked={!!draft.on_request && Number(draft.min_select ?? 1) === 0} disabled={Number(draft.min_select ?? 1) > 0}
                onChange={e => setDraft(d => ({ ...d, on_request: e.target.checked }))} />
              <span>Don't open it by itself: show a button for it
                <span className="block text-[11px] text-muted-foreground">Only for optional groups (at least 0). On the till, the ordering page and kiosks the group waits behind a "+ {draft.name || 'group'}" button.</span>
              </span>
            </label>
          </div>
          <div className="rounded-md border bg-background p-3 space-y-2">
            <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wide">Till</p>
            <label className="flex items-start gap-2 text-sm min-h-[40px] touch-manipulation">
              <input type="checkbox" className="mt-1" checked={!!draft.pos_prefixes}
                onChange={e => setDraft(d => ({ ...d, pos_prefixes: e.target.checked }))} />
              <span>Offer No, Light, Extra and On the side
                <span className="block text-[11px] text-muted-foreground">For toppings and sauces. No and Light are free; Extra and On the side charge the option's price.</span>
              </span>
            </label>
            <p className="text-[11px] text-muted-foreground">An option can also ask another group when it's picked on the till (e.g. Steak, then Cooking): choose it under "Then ask" on the option.</p>
          </div>
          <div className="rounded-md border bg-background p-3 space-y-2" data-testid="vg-kiosk">
            <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wide">Self-order kiosk</p>
            <div>
              <span className="text-xs font-medium block mb-1">How the options show</span>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="How the options show on a kiosk">
                {[[null, 'As the kiosk design says'], ...KIOSK_DISPLAYS.map(k => [k, DISPLAY_LABELS[k]])].map(([k, l]) => (
                  <button key={k || 'design'} type="button" aria-pressed={(draft.kiosk_display || null) === k} data-testid="vg-display" data-display={k || ''}
                    onClick={() => setDraft(d => ({ ...d, kiosk_display: k }))}
                    className={cn('text-xs px-3 min-h-[40px] rounded-md border touch-manipulation',
                      (draft.kiosk_display || null) === k ? 'bg-primary text-primary-foreground border-primary' : 'bg-background')}>
                    {l}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                Grid and list suit most groups; the slider suits choices with a level, like heat; the spin wheel suits flavours. Pictures and a line of words show on the option cards.
              </p>
            </div>
            <div className="grid sm:grid-cols-2 gap-2">
              <Field label="Words at the low end of the scale">
                <Input value={draft.scale_low || ''} maxLength={40} onChange={e => setDraft(d => ({ ...d, scale_low: e.target.value }))} placeholder="e.g. No spice" />
              </Field>
              <Field label="Words at the high end">
                <Input value={draft.scale_high || ''} maxLength={40} onChange={e => setDraft(d => ({ ...d, scale_high: e.target.value }))} placeholder="e.g. Very spicy" />
              </Field>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Give options a level (0 to 5) and the kiosk marks each with flames (or the design's marks) and, on the slider, shows the scale from one end to the other.
              {hasLevels && !(draft.scale_low || '').trim() && !(draft.scale_high || '').trim() && ' Add the words for the two ends to show the scale.'}
            </p>
          </div>
          <div className="space-y-1.5">
            <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wide">Options + default price</p>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={(draft.options || []).map(o => o._key)} strategy={verticalListSortingStrategy}>
                <div className="space-y-1.5">
                  {(draft.options || []).map(o => (
                    <OptionRow key={o._key} o={o} groups={groups} draftId={draft.id}
                      onPatch={patch => patchOption(o._key, patch)}
                      onRemove={() => setDraft(d => ({ ...d, options: d.options.filter(x => x._key !== o._key) }))} />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
            <button onClick={() => setDraft(d => ({ ...d, options: [...d.options, newOption()] }))}
              className="text-xs text-primary hover:underline inline-flex items-center gap-1 min-h-[40px]">
              <Plus className="w-3 h-3" /> Add option
            </button>
          </div>
          <div className="flex justify-end gap-2">
            <Btn variant="secondary" onClick={() => setDraft(null)}>Cancel</Btn>
            <Btn disabled={!draft.name.trim() || save.isPending} onClick={() => save.mutate()}>
              {save.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {draft.id ? 'Save group' : 'Create group'}
            </Btn>
          </div>
          {save.isError && (
            <p className="text-xs text-destructive">{save.error?.body?.error || 'Save failed'}</p>
          )}
        </div>
      ) : (
        <Btn variant="secondary" onClick={() => setDraft(emptyGroup())}>
          <Plus className="w-3.5 h-3.5" /> New variant group
        </Btn>
      )}
    </div>
  )
}
