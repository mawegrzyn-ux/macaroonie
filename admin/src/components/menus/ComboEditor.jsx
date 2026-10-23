// src/components/menus/ComboEditor.jsx
//
// Combos on the Menus page's dish panel (migration 171, shared/combos.js).
// A dish can be a combo: its Price is the combo's price (may be £0) and
// its steps are what the guest or staff choose (Main, Side, Drink):
//
//   ComboBox          the dish panel's card: Dish / Combo, Manual /
//                     Automatic, a summary of the steps, the "from" price,
//                     problems, and the Edit steps button
//   ComboStepsModal   the steps: name, how many (min 0 = optional), the same
//                     choice more than once, picks itself when it has one
//                     choice, optional steps behind a button, a condition
//                     on an earlier step, and the choices (this menu's
//                     dishes, whole sections, or new ones typed in), each
//                     with an extra charge. Steps and choices drag to
//                     reorder.
//   comboPayload()    the combo as the menu save sends it
//
// Kiosks (migration 172): each step can say how a kiosk shows its choices
// (grid / list / slider / spin wheel, empty = the kiosk design's choice), and
// a typed-in choice can have a picture and a line of words (a dish shows its
// own photo and description).
//
// Edits change the menu draft; the menu's Save button saves them.

import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, TouchSensor, useSensor, useSensors,
} from '@dnd-kit/core'
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove, sortableKeyboardCoordinates,
} from '@dnd-kit/sortable'
import { restrictToVerticalAxis, restrictToParentElement } from '@dnd-kit/modifiers'
import { CSS } from '@dnd-kit/utilities'
import { AlertTriangle, ChevronDown, ChevronRight, GripVertical, Plus, Search, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { normaliseCombo, comboFromPrice, comboProblems, sectionItemsOf, stepRule, stepChoices, STEP_DISPLAYS } from '@shared/combos.js'
import { DISPLAY_LABELS } from '@shared/kiosk.js'
import { PicturePick } from '@/components/media/PicturePick'
import { Field, Input, PriceInput, formatPrice } from './shared'

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
  const r = Math.random() * 16 | 0
  return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
}))

const emptyStep = (n) => ({ id: newId(), name: '', min: 1, max: 1, repeat: false, auto: true, ask: 'always', when: null, display: null, options: [] })

/** The combo as the menu save sends it (null for a dish). */
export function comboPayload(item) {
  if (item.kind !== 'combo') return null
  const c = item.combo || {}
  return {
    mode: c.mode === 'auto' ? 'auto' : 'manual',
    steps: (c.steps || []).map((s, i) => {
      const max = Math.max(1, Number(s.max ?? 1))
      const min = Math.max(0, Math.min(max, Number(s.min ?? 1)))
      return {
        id: s.id, name: (s.name || '').trim() || 'Choice ' + (i + 1),
        min, max, repeat: !!s.repeat, auto: s.auto !== false,
        ask: min === 0 && s.ask === 'button' ? 'button' : 'always',
        when: s.when && s.when.step_id ? { step_id: s.when.step_id, option_ids: s.when.option_ids || [] } : null,
        display: STEP_DISPLAYS.includes(s.display) ? s.display : null,
        // Sent only when on: a step saved without it isn't a change to publish.
        ...(s.split ? { split: true } : {}),
        options: (s.options || []).filter(o => (o.type === 'custom' ? (o.label || '').trim() : o.item_id || o.section_id)).map(o => ({
          id: o.id, type: o.type,
          item_id: o.type === 'item' ? o.item_id : null,
          section_id: o.type === 'section' ? o.section_id : null,
          label: o.type === 'custom' ? o.label.trim() : null,
          kitchen_name: o.type === 'custom' ? ((o.kitchen_name || '').trim() || null) : null,
          image_url: o.type === 'custom' ? (o.image_url || null) : null,
          description: o.type === 'custom' ? ((o.description || '').trim() || null) : null,
          price_pence: Math.max(0, Number(o.price_pence) || 0),
        })),
      }
    }),
  }
}

/** Dishes and sections of the menu being edited, for choices and the "from" price. */
function useMenuIndex(sections, selfId) {
  return useMemo(() => {
    const items = sections.flatMap(s => (s.items || []).map(it => ({ ...it, section_id: s.id, section_title: s.title })))
    const itemsById = Object.fromEntries(items.map(i => [i.id, i]))
    const sectionItems = sectionItemsOf([{ sections }])
    const dishes = items.filter(i => i.kind !== 'combo' && i.id !== selfId)
    return { itemsById, sectionItems, dishes, sectionsById: Object.fromEntries(sections.map(s => [s.id, s])) }
  }, [sections, selfId])
}

function optionLabel(o, index) {
  if (o.type === 'item') return index.itemsById[o.item_id]?.name || 'A dish no longer on this menu'
  if (o.type === 'section') return 'Any ' + (index.sectionsById[o.section_id]?.title || 'section (gone)')
  return o.label || 'New choice'
}

export function ComboBox({ item, section, sections, readOnly, onChange }) {
  const [open, setOpen] = useState(false)
  const index = useMenuIndex(sections, item.id)
  const isCombo = item.kind === 'combo'
  const combo = item.combo || { mode: 'manual', steps: [] }
  const steps = combo.steps || []
  const ctx = { itemsById: index.itemsById, sectionItems: index.sectionItems }
  const from = isCombo ? comboFromPrice({ ...item, combo: comboPayload(item) }, item.price_pence ?? 0, ctx) : null
  const problems = isCombo ? comboProblems(comboPayload(item), {
    itemIds: new Set(index.dishes.map(d => d.id)), sectionIds: new Set(Object.keys(index.sectionsById)),
  }) : []
  const setCombo = patch => onChange({ combo: { mode: combo.mode || 'manual', steps, ...patch } })

  return (
    <div className="rounded-md border p-3 space-y-3" data-testid="combo-box">
      <div className="grid grid-cols-2 gap-1.5">
        {[['dish', 'Dish'], ['combo', 'Combo']].map(([k, label]) => (
          <button key={k} type="button" aria-pressed={(item.kind || 'dish') === k}
            onClick={() => onChange(k === 'combo' ? { kind: 'combo', combo: item.combo || { mode: 'manual', steps: [] } } : { kind: 'dish' })}
            className={cn('text-sm rounded-md border min-h-[44px] touch-manipulation', (item.kind || 'dish') === k ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-accent')}>
            {label}
          </button>
        ))}
      </div>
      {isCombo && (
        <>
          <p className="text-[11px] text-muted-foreground">
            A combo's price is the Price above (it can be £0). Guests and staff go through its steps; a choice's extra charge
            and its dish's own extras add to the price. Menus and screens show the description and the price, with "from" when choices can cost more.
          </p>
          <Field label="How it's used">
            <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="How it's used">
              {[['manual', 'Manual'], ['auto', 'Automatic']].map(([k, label]) => (
                <button key={k} type="button" aria-pressed={(combo.mode || 'manual') === k}
                  onClick={() => setCombo({ mode: k })}
                  className={cn('text-sm rounded-md border min-h-[44px] touch-manipulation', (combo.mode || 'manual') === k ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-accent')}>
                  {label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              {combo.mode === 'auto'
                ? 'Chosen with its button, and also applied by itself when an order has its dishes as separate items (on the till and online), whenever that makes the order cheaper. The items stay as they were entered.'
                : 'Only when it is chosen: its own button, or "Make it a combo" on a dish already on a till order.'}
            </p>
          </Field>
          <div className="space-y-1" data-testid="combo-summary">
            {steps.length === 0 && <p className="text-xs text-muted-foreground">No steps yet.</p>}
            {steps.map((s, i) => (
              <div key={s.id} className="text-xs flex gap-2">
                <span className="font-medium w-5 text-right shrink-0">{i + 1}.</span>
                <span className="flex-1 min-w-0">
                  <span className="font-medium">{s.name || 'Choice ' + (i + 1)}</span>
                  <span className="text-muted-foreground"> · {stepRule({ min: s.min ?? 1, max: s.max ?? 1 })}{s.when ? ' · only sometimes' : ''}</span>
                  <span className="block text-muted-foreground truncate">{(s.options || []).map(o => optionLabel(o, index)).join(', ') || 'No choices'}</span>
                </span>
              </div>
            ))}
          </div>
          {from && (
            <p className="text-xs" data-testid="combo-from">
              Shown as <span className="font-semibold">{from.varies ? 'from ' : ''}{formatPrice(from.pence)}</span>
            </p>
          )}
          {problems.length > 0 && (
            <ul className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-2 space-y-0.5" data-testid="combo-problems">
              {problems.map(p => <li key={p} className="flex gap-1"><AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />{p}</li>)}
            </ul>
          )}
          {/* The dish panel is a disabled fieldset when read only, which would
              disable a <button>: View steps is a div with the button role. */}
          <div role="button" tabIndex={0} onClick={() => setOpen(true)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(true) } }}
            className="w-full text-sm border rounded-md min-h-[44px] bg-background hover:bg-accent touch-manipulation font-medium flex items-center justify-center cursor-pointer">
            {readOnly ? 'View steps' : 'Edit steps'}
          </div>
        </>
      )}
      {/* Outside the dish panel (a disabled fieldset when read only). */}
      {open && createPortal(
        <ComboStepsModal item={item} index={index} readOnly={readOnly}
          onChange={next => setCombo({ steps: next })} onClose={() => setOpen(false)} />,
        document.body,
      )}
    </div>
  )
}

function useDnd() {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
}

function Grip({ handle, label }) {
  return (
    <button type="button" ref={handle.setActivatorNodeRef} {...handle.attributes} {...handle.listeners} aria-label={label}
      className="w-10 min-h-[44px] flex items-center justify-center shrink-0 cursor-grab active:cursor-grabbing touch-none text-muted-foreground hover:text-foreground">
      <GripVertical className="w-4 h-4" />
    </button>
  )
}

function Sortable({ id, disabled, children }) {
  const s = useSortable({ id, disabled })
  return (
    <div ref={s.setNodeRef} style={{ transform: CSS.Transform.toString(s.transform), transition: s.transition }}
      className={cn(s.isDragging && 'relative z-10 shadow-lg opacity-90')}>
      {children(s)}
    </div>
  )
}

export function ComboStepsModal({ item, index, readOnly, onChange, onClose }) {
  const steps = item.combo?.steps || []
  const [openId, setOpenId] = useState(steps[0]?.id || null)
  const [confirmDel, setConfirmDel] = useState(null)
  const sensors = useDnd()
  const setStep = (i, patch) => onChange(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)))
  const add = () => { const s = emptyStep(); onChange([...steps, s]); setOpenId(s.id) }
  const remove = i => {
    const gone = steps[i].id
    // Conditions on the removed step go with it.
    onChange(steps.filter((_, j) => j !== i).map(s => (s.when?.step_id === gone ? { ...s, when: null } : s)))
    setConfirmDel(null)
  }
  const onDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return
    const next = arrayMove(steps, steps.findIndex(s => s.id === active.id), steps.findIndex(s => s.id === over.id))
    // A condition can only look back: one that now points forward is dropped.
    const seen = new Set()
    onChange(next.map(s => { const keep = !s.when || seen.has(s.when.step_id); seen.add(s.id); return keep ? s : { ...s, when: null } }))
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-background rounded-xl shadow-xl w-full max-w-3xl flex flex-col max-h-[85vh]" role="dialog" aria-label={'Steps of ' + (item.name || 'combo')}>
        <div className="flex items-center gap-2 px-5 py-3 section-head shrink-0">
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold truncate">Steps: {item.name || 'Combo'}</h2>
            <p className="text-xs text-muted-foreground">In order. Drag the grip to move a step.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="w-11 h-11 flex items-center justify-center rounded-md hover:bg-accent"><X className="w-4 h-4" /></button>
        </div>
        {/* The scroll is on a div: a fieldset can't scroll in Chromium. */}
        <div className="flex-1 min-h-0 overflow-y-auto">
        <fieldset disabled={readOnly} className="p-5 space-y-3 m-0 border-0 min-w-0">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd} modifiers={[restrictToVerticalAxis, restrictToParentElement]}>
            <SortableContext items={steps.map(s => s.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-3">
                {steps.map((s, i) => (
                  <Sortable key={s.id} id={s.id} disabled={readOnly}>
                    {handle => (
                      <StepCard step={s} index={i} steps={steps} itemIndex={index} readOnly={readOnly} handle={handle}
                        open={readOnly || openId === s.id} onToggle={() => setOpenId(openId === s.id ? null : s.id)}
                        confirmDel={confirmDel === s.id} onAskDel={() => setConfirmDel(s.id)} onCancelDel={() => setConfirmDel(null)}
                        onRemove={() => remove(i)} onChange={patch => setStep(i, patch)} selfId={item.id} />
                    )}
                  </Sortable>
                ))}
              </div>
            </SortableContext>
          </DndContext>
          {!readOnly && steps.length < 12 && (
            <button type="button" onClick={add}
              className="inline-flex items-center gap-1.5 text-sm border rounded-md px-3 min-h-[44px] bg-background hover:bg-accent touch-manipulation">
              <Plus className="w-4 h-4" /> Add a step
            </button>
          )}
        </fieldset>
        </div>
        <div className="px-5 py-3 border-t flex items-center gap-3 shrink-0">
          <p className="text-[11px] text-muted-foreground flex-1">Changes are kept in this menu. Save the menu to keep them.</p>
          <button type="button" onClick={onClose} className="bg-primary text-primary-foreground rounded-md px-5 min-h-[44px] text-sm font-medium">Done</button>
        </div>
      </div>
    </div>
  )
}

function StepCard({ step, index, steps, itemIndex, readOnly, handle, open, onToggle, confirmDel, onAskDel, onCancelDel, onRemove, onChange, selfId }) {
  const options = step.options || []
  const min = step.min ?? 1
  const max = step.max ?? 1
  const earlier = steps.slice(0, index)
  const cond = step.when ? earlier.find(s => s.id === step.when.step_id) : null
  const sensors = useDnd()
  const [picker, setPicker] = useState(false)
  const setOption = (j, patch) => onChange({ options: options.map((o, k) => (k === j ? { ...o, ...patch } : o)) })
  const onDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return
    onChange({ options: arrayMove(options, options.findIndex(o => o.id === active.id), options.findIndex(o => o.id === over.id)) })
  }
  const choices = stepChoices(normaliseCombo({ steps: [step] }).steps[0] || { options: [] }, { itemsById: itemIndex.itemsById, sectionItems: itemIndex.sectionItems, selfId })
  const sectionsLeft = Object.values(itemIndex.sectionsById).filter(sec => !options.some(o => o.type === 'section' && o.section_id === sec.id))

  return (
    <div className="border rounded-lg bg-background" data-testid="combo-step">
      <div className="flex items-center gap-1 pr-2">
        {!readOnly && <Grip handle={handle} label={'Drag to move ' + (step.name || 'step')} />}
        <button type="button" onClick={onToggle} className="flex-1 min-w-0 flex items-center gap-2 text-left min-h-[48px] px-1">
          {open ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
          <span className="text-sm font-semibold truncate">{index + 1}. {step.name || 'New step'}</span>
          <span className="text-xs text-muted-foreground shrink-0">{stepRule({ min, max })} · {choices.length} choice{choices.length === 1 ? '' : 's'}</span>
        </button>
        {!readOnly && (confirmDel ? (
          <span className="flex items-center gap-1 text-xs">
            <button type="button" onClick={onRemove} className="px-2 min-h-[40px] rounded-md bg-destructive text-white">Remove step</button>
            <button type="button" onClick={onCancelDel} className="px-2 min-h-[40px] rounded-md border">Keep</button>
          </span>
        ) : (
          <button type="button" onClick={onAskDel} aria-label="Remove step" className="w-10 h-10 flex items-center justify-center rounded-md text-destructive hover:bg-destructive/10">
            <Trash2 className="w-4 h-4" />
          </button>
        ))}
      </div>
      {open && (
        <div className="px-4 pb-4 space-y-3 border-t pt-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Step name">
              <Input value={step.name} maxLength={60} onChange={e => onChange({ name: e.target.value })} placeholder="e.g. Choose your side" />
            </Field>
            <Field label="How many">
              <div className="flex items-center gap-2 text-sm">
                <select value={min} aria-label="At least" onChange={e => { const v = Number(e.target.value); onChange({ min: v, max: Math.max(v, max), ...(v > 0 ? { ask: 'always' } : {}) }) }}
                  className="border rounded-md px-2 min-h-[44px] bg-background">
                  {Array.from({ length: 11 }, (_, n) => <option key={n} value={n}>{n}</option>)}
                </select>
                <span>to</span>
                <select value={max} aria-label="At most" onChange={e => { const v = Number(e.target.value); onChange({ max: v, min: Math.min(v, min) }) }}
                  className="border rounded-md px-2 min-h-[44px] bg-background">
                  {Array.from({ length: 10 }, (_, n) => <option key={n + 1} value={n + 1}>{n + 1}</option>)}
                </select>
                <span className="text-muted-foreground text-xs">{min === 0 ? 'optional' : ''}</span>
              </div>
            </Field>
          </div>
          <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1">
            <Check checked={!!step.repeat} onChange={v => onChange({ repeat: v })} label="The same choice more than once" hint="e.g. 2 x Cola" />
            <Check checked={step.auto !== false} onChange={v => onChange({ auto: v })} label="Pick it by itself when there's one choice" hint="The step is filled in and skipped" />
            {min === 0 && (
              <Check checked={step.ask === 'button'} onChange={v => onChange({ ask: v ? 'button' : 'always' })}
                label="Don't open it: show a button" hint={'"+ ' + (step.name || 'step') + '" opens it'} />
            )}
          </div>
          <Field label="On a kiosk, the choices show as">
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="How a kiosk shows the choices">
              {[[null, 'As the kiosk design says'], ...STEP_DISPLAYS.map(k => [k, DISPLAY_LABELS[k]])].map(([k, l]) => (
                <button key={k || 'design'} type="button" aria-pressed={(step.display || null) === k} data-testid="combo-step-display" data-display={k || ''}
                  onClick={() => onChange({ display: k })}
                  className={cn('text-xs rounded-md border px-3 min-h-[40px] touch-manipulation',
                    (step.display || null) === k ? 'bg-primary text-primary-foreground border-primary' : 'bg-background')}>
                  {l}
                </button>
              ))}
            </div>
            <Check checked={!!step.split} onChange={v => onChange({ split: v })} label="Split photo from the picks"
              hint="The picks' pictures (from this step and others with this on) show on the combo's photo on kiosks, as the kiosk design says: one in its place or several side by side with a torn edge, or small in its corner" />
          </Field>
          {earlier.length > 0 && (
            <Field label="When it shows">
              <select value={step.when?.step_id || ''} aria-label="When it shows"
                onChange={e => onChange({ when: e.target.value ? { step_id: e.target.value, option_ids: [] } : null })}
                className="w-full border rounded-md px-2 min-h-[44px] bg-background text-sm">
                <option value="">Always</option>
                {earlier.map((s, k) => <option key={s.id} value={s.id}>Only after step {k + 1}: {s.name || 'Choice ' + (k + 1)}</option>)}
              </select>
              {cond && (
                <div className="mt-2">
                  <p className="text-[11px] text-muted-foreground mb-1">…when one of these is picked there (none ticked = anything):</p>
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="Picked in that step">
                    {(cond.options || []).map(o => {
                      const on = step.when.option_ids.includes(o.id)
                      return (
                        <button key={o.id} type="button" aria-pressed={on}
                          onClick={() => onChange({ when: { ...step.when, option_ids: on ? step.when.option_ids.filter(x => x !== o.id) : [...step.when.option_ids, o.id] } })}
                          className={cn('text-xs rounded-full border px-3 min-h-[36px] touch-manipulation', on ? 'bg-primary text-primary-foreground border-primary' : 'bg-background')}>
                          {optionLabel(o, itemIndex)}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </Field>
          )}

          <div>
            <p className="text-xs font-medium mb-1">Choices and extra charges</p>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd} modifiers={[restrictToVerticalAxis, restrictToParentElement]}>
              <SortableContext items={options.map(o => o.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-1.5">
                  {options.map((o, j) => (
                    <Sortable key={o.id} id={o.id} disabled={readOnly}>
                      {h => (
                        <div className="flex items-start gap-1 border rounded-md bg-muted/30 pr-1" data-testid="combo-choice">
                          {!readOnly && <Grip handle={h} label={'Drag to move ' + optionLabel(o, itemIndex)} />}
                          <div className="flex-1 min-w-0 py-1.5 space-y-1">
                            {o.type === 'custom' ? (
                              <div className="flex items-start gap-2">
                                <PicturePick url={o.image_url || null} onChange={url => setOption(j, { image_url: url })} scope="menu:item"
                                  size="sm" disabled={readOnly} label="choice picture" />
                                <div className="flex-1 min-w-0 space-y-1.5">
                                  <div className="grid grid-cols-2 gap-1.5">
                                    <Input value={o.label || ''} maxLength={80} onChange={e => setOption(j, { label: e.target.value })} placeholder="Name, e.g. Surprise toy" aria-label="Choice name" />
                                    <Input value={o.kitchen_name || ''} maxLength={60} onChange={e => setOption(j, { kitchen_name: e.target.value })} placeholder="Kitchen name (optional)" aria-label="Kitchen name" />
                                  </div>
                                  <Input value={o.description || ''} maxLength={300} onChange={e => setOption(j, { description: e.target.value })}
                                    placeholder="Words on the kiosk (optional)" aria-label="Words for this choice on the kiosk" />
                                </div>
                              </div>
                            ) : (
                              <p className={cn('text-sm truncate min-h-[36px] flex items-center', o.type === 'item' && !itemIndex.itemsById[o.item_id] && 'text-amber-700')}>
                                {optionLabel(o, itemIndex)}
                                {o.type === 'section' && <span className="ml-2 text-[11px] text-muted-foreground">({(itemIndex.sectionItems[o.section_id] || []).filter(id => itemIndex.itemsById[id]?.kind !== 'combo').length} dishes)</span>}
                              </p>
                            )}
                          </div>
                          <PriceInput pence={o.price_pence || null} onChange={p => setOption(j, { price_pence: p || 0 })} placeholder="+£0.00"
                            className="w-24 font-mono mt-1.5" aria-label={'Extra charge for ' + optionLabel(o, itemIndex)} />
                          {!readOnly && (
                            <button type="button" onClick={() => onChange({ options: options.filter((_, k) => k !== j) })} aria-label={'Remove ' + optionLabel(o, itemIndex)}
                              className="w-10 h-11 flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent mt-0.5">
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      )}
                    </Sortable>
                  ))}
                </div>
              </SortableContext>
            </DndContext>
            {options.length === 0 && <p className="text-[11px] text-amber-700">Add at least one choice.</p>}
            {!readOnly && (
              <div className="flex flex-wrap gap-2 mt-2">
                <button type="button" onClick={() => setPicker(true)} className="inline-flex items-center gap-1.5 text-sm border rounded-md px-3 min-h-[44px] bg-background hover:bg-accent touch-manipulation">
                  <Plus className="w-4 h-4" /> Dishes
                </button>
                {sectionsLeft.length > 0 && (
                  <select value="" aria-label="Add a whole section"
                    onChange={e => { if (e.target.value) onChange({ options: [...options, { id: newId(), type: 'section', section_id: e.target.value, price_pence: 0 }] }) }}
                    className="text-sm border rounded-md px-2 min-h-[44px] bg-background">
                    <option value="">+ A whole section…</option>
                    {sectionsLeft.map(sec => <option key={sec.id} value={sec.id}>{sec.title || 'Untitled'}</option>)}
                  </select>
                )}
                <button type="button" onClick={() => onChange({ options: [...options, { id: newId(), type: 'custom', label: '', kitchen_name: '', price_pence: 0 }] })}
                  className="inline-flex items-center gap-1.5 text-sm border rounded-md px-3 min-h-[44px] bg-background hover:bg-accent touch-manipulation">
                  <Plus className="w-4 h-4" /> New choice
                </button>
              </div>
            )}
            <p className="text-[11px] text-muted-foreground mt-1">
              A whole section offers every dish in it, now and later. A new choice isn't a dish on the menu: it goes to the kitchen with the combo.
            </p>
          </div>
        </div>
      )}
      {picker && createPortal(
        <DishPicker dishes={itemIndex.dishes} chosen={new Set(options.filter(o => o.type === 'item').map(o => o.item_id))}
          onToggle={(id, on) => onChange({ options: on ? [...options, { id: newId(), type: 'item', item_id: id, price_pence: 0 }] : options.filter(o => !(o.type === 'item' && o.item_id === id)) })}
          onClose={() => setPicker(false)} />,
        document.body,
      )}
    </div>
  )
}

function Check({ checked, onChange, label, hint }) {
  return (
    <label className="flex items-start gap-2 text-sm min-h-[44px] touch-manipulation py-1">
      <input type="checkbox" className="mt-1 w-4 h-4" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span>{label}{hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}</span>
    </label>
  )
}

function DishPicker({ dishes, chosen, onToggle, onClose }) {
  const [q, setQ] = useState('')
  const shown = dishes.filter(d => !q.trim() || (d.name || '').toLowerCase().includes(q.trim().toLowerCase()))
  const bySection = []
  for (const d of shown) {
    let g = bySection.find(x => x.id === d.section_id)
    if (!g) bySection.push(g = { id: d.section_id, title: d.section_title, items: [] })
    g.items.push(d)
  }
  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-background rounded-xl shadow-xl w-full max-w-lg flex flex-col max-h-[85vh]" role="dialog" aria-label="Choose dishes">
        <div className="px-4 py-3 section-head flex items-center gap-2 shrink-0">
          <p className="text-sm font-semibold flex-1">Dishes from this menu</p>
          <button type="button" onClick={onClose} aria-label="Close" className="w-11 h-11 flex items-center justify-center rounded-md hover:bg-accent"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-4 pt-3 shrink-0">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search dishes" className="pl-8 min-h-[44px]" autoFocus={!navigator.maxTouchPoints} />
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
          {bySection.map(g => (
            <div key={g.id}>
              <p className="text-[11px] uppercase font-semibold text-muted-foreground tracking-wide mb-1">{g.title || 'Untitled section'}</p>
              <div className="flex flex-wrap gap-1.5">
                {g.items.map(d => {
                  const on = chosen.has(d.id)
                  return (
                    <button key={d.id} type="button" aria-pressed={on} onClick={() => onToggle(d.id, !on)}
                      className={cn('text-sm rounded-full border px-3 min-h-[40px] touch-manipulation', on ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-accent')}>
                      {d.name || 'Untitled'}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
          {!bySection.length && <p className="text-sm text-muted-foreground">No dishes match.</p>}
        </div>
        <div className="px-4 py-3 border-t flex justify-end shrink-0">
          <button type="button" onClick={onClose} className="bg-primary text-primary-foreground rounded-md px-5 min-h-[44px] text-sm font-medium">Done</button>
        </div>
      </div>
    </div>
  )
}
