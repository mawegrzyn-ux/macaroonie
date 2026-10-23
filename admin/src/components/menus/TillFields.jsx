// src/components/menus/TillFields.jsx
//
// The till (POS) fields on the Menus page's section and dish panels:
//   section: course (its dishes' default) and button colour
//   dish:    kitchen name, course and colour of its own
// Courses are company-wide (Store tech, Courses). These fields only
// matter on the till; the website, print and online ordering ignore them.
// Combos (a dish's kind and steps) are edited in ComboEditor.jsx.
// Saved with the menu (Menus.jsx's save payload lists them).

import { useQuery } from '@tanstack/react-query'
import { useApi } from '@/lib/api'
import { usePermission } from '@/hooks/usePermission'
import { cn } from '@/lib/utils'
import { Field, Input } from './shared'

const COLOURS = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#4b5563']

/** Company courses, or null when the person can't see Store tech. */
export function useTillCourses() {
  const api = useApi()
  const { canView } = usePermission('pos_setup')
  const { data } = useQuery({
    queryKey: ['pos-courses'], queryFn: () => api.get('/pos/courses'), retry: false, staleTime: 60_000,
    enabled: canView,
  })
  return (canView && data) || null
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
      <Field label="Course" hint="Its dishes go in this course on the till unless a dish has its own. Courses are set up in Store tech.">
        <CourseSelect courses={courses} value={section.pos_course_id} onChange={v => onChange({ pos_course_id: v })} inheritLabel="No course" />
      </Field>
      <Field label="Button colour">
        <ColourRow value={section.pos_colour || null} onChange={v => onChange({ pos_colour: v })} inheritLabel="Default" />
      </Field>
    </div>
  )
}

export function ItemTillFields({ item, section, courses, onChange }) {
  if (!courses) return null
  const sectionCourse = courses.find(c => c.id === section?.pos_course_id)?.name
  return (
    <div className="rounded-md border p-3 space-y-3">
      <p className="text-xs font-medium">Till</p>
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
    </div>
  )
}
