// src/components/menus/TillFields.jsx
//
// The till (POS) fields on the Menus page's section and dish panels:
//   section: course (its dishes' default) and button colour
//   dish:    kitchen name, course and colour of its own, and "meal deal"
//            (kind 'combo'): a set price with slots (Main, Side, Drink),
//            each a choice of dishes and/or whole sections, with optional
//            extra charges per dish.
// Courses are company-wide (Till setup, Courses). These fields only
// matter on the till; the website, print and online ordering ignore them.
// Saved with the menu (Menus.jsx's save payload lists them).

import { useQuery } from '@tanstack/react-query'
import { Plus, X } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Field, Input, PriceInput } from './shared'

const COLOURS = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#4b5563']

/** Company courses, or null when the person can't see Till setup. */
export function useTillCourses() {
  const api = useApi()
  const { data } = useQuery({
    queryKey: ['pos-courses'], queryFn: () => api.get('/pos/courses'), retry: false, staleTime: 60_000,
  })
  return data || null
}

function ColourRow({ value, onChange, inheritLabel }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <button type="button" onClick={() => onChange(null)}
        className={cn('h-9 px-2 rounded-md border text-[11px] touch-manipulation', !value && 'ring-2 ring-primary')}>{inheritLabel}</button>
      {COLOURS.map(c => (
        <button key={c} type="button" onClick={() => onChange(c)} aria-label={'Colour ' + c}
          style={{ background: c }} className={cn('w-9 h-9 rounded-md touch-manipulation', value === c && 'ring-2 ring-offset-1 ring-primary')} />
      ))}
    </div>
  )
}

function CourseSelect({ courses, value, onChange, inheritLabel }) {
  return (
    <select value={value || ''} onChange={e => onChange(e.target.value || null)}
      className="w-full text-sm border rounded-md px-2 bg-background min-h-[44px] touch-manipulation">
      <option value="">{inheritLabel}</option>
      {courses.filter(c => c.is_active || c.id === value).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  )
}

export function SectionTillFields({ section, courses, onChange }) {
  if (!courses) return null
  return (
    <div className="rounded-md border p-3 space-y-3">
      <p className="text-xs font-medium">Till</p>
      <Field label="Course" hint="Its dishes go in this course on the till unless a dish has its own. Courses are set up in Till setup.">
        <CourseSelect courses={courses} value={section.pos_course_id} onChange={v => onChange({ pos_course_id: v })} inheritLabel="No course" />
      </Field>
      <Field label="Button colour">
        <ColourRow value={section.pos_colour || null} onChange={v => onChange({ pos_colour: v })} inheritLabel="Default" />
      </Field>
    </div>
  )
}

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
  const r = Math.random() * 16 | 0
  return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
}))

function SlotEditor({ slot, sections, selfId, onChange, onRemove }) {
  const dishes = sections.flatMap(s => (s.items || []).map(it => ({ ...it, section_title: s.title, section_id: s.id })))
    .filter(d => d.id !== selfId && d.kind !== 'combo')
  const inSlot = new Set([
    ...slot.item_ids,
    ...dishes.filter(d => slot.section_ids.includes(d.section_id)).map(d => d.id),
  ])
  const toggle = (key, id) => onChange({ [key]: slot[key].includes(id) ? slot[key].filter(x => x !== id) : [...slot[key], id] })
  const setUpcharge = (id, pence) => {
    const next = { ...slot.upcharges }
    if (pence) next[id] = pence; else delete next[id]
    onChange({ upcharges: next })
  }
  return (
    <div className="rounded-md border p-3 space-y-2 bg-muted/30">
      <div className="flex items-center gap-2">
        <Input value={slot.name} onChange={e => onChange({ name: e.target.value })} placeholder="e.g. Main" className="flex-1 font-medium" aria-label="Slot name" />
        <button type="button" onClick={onRemove} aria-label="Remove slot" className="w-9 h-9 flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex items-center gap-2 text-xs">
        <span>Pick</span>
        <select value={slot.min} onChange={e => { const min = Number(e.target.value); onChange({ min, max: Math.max(min, slot.max) }) }}
          className="border rounded-md px-1 min-h-[36px] bg-background" aria-label="At least">
          {[0, 1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <span>to</span>
        <select value={slot.max} onChange={e => { const max = Number(e.target.value); onChange({ max, min: Math.min(max, slot.min) }) }}
          className="border rounded-md px-1 min-h-[36px] bg-background" aria-label="At most">
          {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <span className="text-muted-foreground">{slot.min === 0 ? '(optional)' : ''}</span>
      </div>
      <p className="text-[11px] font-medium">Whole sections</p>
      <div className="flex flex-wrap gap-1">
        {sections.map(s => (
          <button key={s.id} type="button" onClick={() => toggle('section_ids', s.id)} aria-pressed={slot.section_ids.includes(s.id)}
            className={cn('text-xs rounded-full border px-2 min-h-[32px]', slot.section_ids.includes(s.id) ? 'bg-primary text-primary-foreground border-primary' : 'bg-background')}>
            {s.title || 'Untitled'}
          </button>
        ))}
      </div>
      <p className="text-[11px] font-medium">Single dishes</p>
      <div className="flex flex-wrap gap-1 max-h-40 overflow-y-auto">
        {dishes.filter(d => !slot.section_ids.includes(d.section_id)).map(d => (
          <button key={d.id} type="button" onClick={() => toggle('item_ids', d.id)} aria-pressed={slot.item_ids.includes(d.id)}
            className={cn('text-xs rounded-full border px-2 min-h-[32px]', slot.item_ids.includes(d.id) ? 'bg-primary text-primary-foreground border-primary' : 'bg-background')}>
            {d.name || 'Untitled'}
          </button>
        ))}
      </div>
      {inSlot.size > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer min-h-[32px] flex items-center">Extra charges ({Object.keys(slot.upcharges).length})</summary>
          <div className="space-y-1 mt-1">
            {dishes.filter(d => inSlot.has(d.id)).map(d => (
              <div key={d.id} className="flex items-center gap-2">
                <span className="flex-1 truncate">{d.name}</span>
                <PriceInput pence={slot.upcharges[d.id] ?? null} onChange={p => setUpcharge(d.id, p)} placeholder="+£0.00" className="w-24 font-mono" />
              </div>
            ))}
          </div>
        </details>
      )}
      {inSlot.size === 0 && <p className="text-[11px] text-amber-700">Pick at least one section or dish.</p>}
    </div>
  )
}

export function ItemTillFields({ item, section, sections, courses, onChange }) {
  if (!courses) return null
  const combo = item.kind === 'combo'
  const slots = item.combo?.slots || []
  const sectionCourse = courses.find(c => c.id === section?.pos_course_id)?.name
  const setSlots = next => onChange({ combo: { slots: next } })
  return (
    <div className="rounded-md border p-3 space-y-3">
      <p className="text-xs font-medium">Till</p>
      <div className="grid grid-cols-2 gap-1.5">
        {[['dish', 'Dish'], ['combo', 'Meal deal']].map(([k, label]) => (
          <button key={k} type="button" aria-pressed={(item.kind || 'dish') === k}
            onClick={() => onChange(k === 'combo' ? { kind: 'combo', combo: item.combo || { slots: [] } } : { kind: 'dish' })}
            className={cn('text-xs rounded-md border min-h-[44px] touch-manipulation', (item.kind || 'dish') === k ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-accent')}>
            {label}
          </button>
        ))}
      </div>
      <Field label="Kitchen name" hint="Shorter name on kitchen tickets. Blank = the dish name.">
        <Input value={item.kitchen_name || ''} maxLength={60} onChange={e => onChange({ kitchen_name: e.target.value || null })} />
      </Field>
      <Field label="Course">
        <CourseSelect courses={courses} value={item.pos_course_id} onChange={v => onChange({ pos_course_id: v })}
          inheritLabel={sectionCourse ? 'As the section (' + sectionCourse + ')' : 'As the section (no course)'} />
      </Field>
      <Field label="Button colour">
        <ColourRow value={item.pos_colour || null} onChange={v => onChange({ pos_colour: v })} inheritLabel="As the section" />
      </Field>
      {combo && (
        <div className="space-y-2">
          <p className="text-[11px] text-muted-foreground">
            The deal's price is the Price above. Staff pick a dish for each slot on the till; extra charges add to the price.
            Each dish's own options (e.g. No onions) are asked as usual.
          </p>
          {slots.map((s, i) => (
            <SlotEditor key={s.id} slot={s} sections={sections} selfId={item.id}
              onChange={patch => setSlots(slots.map((x, j) => (j === i ? { ...x, ...patch } : x)))}
              onRemove={() => setSlots(slots.filter((_, j) => j !== i))} />
          ))}
          {slots.length < 10 && (
            <button type="button" onClick={() => setSlots([...slots, { id: newId(), name: '', min: 1, max: 1, item_ids: [], section_ids: [], upcharges: {} }])}
              className="inline-flex items-center gap-1.5 text-sm border rounded-md px-3 min-h-[44px] bg-background hover:bg-accent touch-manipulation">
              <Plus className="w-4 h-4" /> Add a slot
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** The combo as the API takes it: named slots only, empty names filled in. */
export function comboPayload(item) {
  if (item.kind !== 'combo') return null
  return {
    slots: (item.combo?.slots || []).map((s, i) => ({
      id: s.id, name: (s.name || '').trim() || 'Choice ' + (i + 1),
      min: s.min ?? 1, max: Math.max(1, s.max ?? 1),
      item_ids: s.item_ids || [], section_ids: s.section_ids || [], upcharges: s.upcharges || {},
    })),
  }
}
