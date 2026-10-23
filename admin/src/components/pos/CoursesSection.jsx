// src/components/pos/CoursesSection.jsx
//
// Store tech > Courses (company-wide): Starters, Mains, Desserts, ... A
// menu section sets its dishes' course (Menus page, section panel), a dish
// can have its own, and staff can change it on the check. A course "held
// by default" waits to be fired when an earlier course goes to the kitchen.

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Loader2, Pencil } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Section, Modal, Field, inputCls, ErrorNote, ConfirmDelete, SortableRows, Btn, Toggle, ColourPick } from './shared'

function CourseModal({ course, onClose }) {
  const api = useApi()
  const qc = useQueryClient()
  const [form, setForm] = useState({
    name: course?.name || '', short_name: course?.short_name || '',
    hold_by_default: !!course?.hold_by_default, colour: course?.colour || null, is_active: course ? course.is_active : true,
  })
  const set = patch => setForm(f => ({ ...f, ...patch }))
  const refresh = () => qc.invalidateQueries({ queryKey: ['pos-setup'] })
  const body = () => ({ ...form, name: form.name.trim(), short_name: form.short_name.trim() || null })
  const save = useMutation({
    mutationFn: () => course ? api.patch(`/pos/courses/${course.id}`, body()) : api.post('/pos/courses', body()),
    onSuccess: () => { refresh(); onClose() },
  })
  const remove = useMutation({ mutationFn: () => api.delete(`/pos/courses/${course.id}`), onSuccess: () => { refresh(); onClose() } })
  return (
    <Modal title={course ? 'Edit ' + course.name : 'Add a course'} onClose={onClose}
      footer={<>
        <Btn variant="primary" className="flex-1" disabled={!form.name.trim() || save.isPending} onClick={() => save.mutate()}>
          {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save
        </Btn>
        {course && <ConfirmDelete label="Delete course" onConfirm={() => remove.mutate()} disabled={remove.isPending} />}
      </>}>
      <Field label="Name"><input className={inputCls} value={form.name} maxLength={40} onChange={e => set({ name: e.target.value })} placeholder="e.g. Mains" /></Field>
      <Field label="Short name" hint="On kitchen tickets and the check, e.g. MN.">
        <input className={cn(inputCls, 'w-28 uppercase')} value={form.short_name} maxLength={6} onChange={e => set({ short_name: e.target.value })} />
      </Field>
      <Toggle label="Hold by default" hint="When it goes with an earlier course, it waits until staff fire it." checked={form.hold_by_default} onChange={v => set({ hold_by_default: v })} />
      <Field group label="Colour on the till"><ColourPick value={form.colour} onChange={v => set({ colour: v })} /></Field>
      {course && <Toggle label="In use" checked={form.is_active} onChange={v => set({ is_active: v })} />}
      {course && <p className="text-xs text-muted-foreground">Deleting a course takes it off the dishes and sections that use it.</p>}
      <ErrorNote error={save.error || remove.error} />
    </Modal>
  )
}

export default function CoursesSection({ setup }) {
  const api = useApi()
  const qc = useQueryClient()
  const [editing, setEditing] = useState(null)
  const reorder = useMutation({ mutationFn: ids => api.put('/pos/courses/order', { ids }), onSettled: () => qc.invalidateQueries({ queryKey: ['pos-setup'] }) })
  const defaults = useMutation({ mutationFn: () => api.post('/pos/courses/defaults', {}), onSuccess: () => qc.invalidateQueries({ queryKey: ['pos-setup'] }) })
  return (
    <Section title="Courses" hint="Shared by every venue, in the order they go to the kitchen. Each menu section picks its course on the Menus page."
      actions={<Btn variant="primary" onClick={() => setEditing('new')}><Plus className="w-4 h-4" /> Add</Btn>}>
      {!setup.courses.length
        ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-muted-foreground flex-1">No courses yet.</p>
            <Btn onClick={() => defaults.mutate()} disabled={defaults.isPending}>Add Starters, Mains, Desserts</Btn>
          </div>
        )
        : (
          <SortableRows items={setup.courses} onReorder={ids => reorder.mutate(ids)}
            renderItem={c => (
              <div className="flex items-center gap-3">
                {c.colour && <span className="w-3 h-8 rounded-full shrink-0" style={{ background: c.colour }} />}
                <div className="flex-1 min-w-0">
                  <p className={cn('text-sm font-medium', !c.is_active && 'line-through text-muted-foreground')}>
                    {c.name}{c.short_name && <span className="text-muted-foreground font-normal"> · {c.short_name}</span>}
                  </p>
                  {c.hold_by_default && <p className="text-xs text-muted-foreground">Held by default</p>}
                </div>
                <Btn onClick={() => setEditing(c)} title={'Edit ' + c.name}><Pencil className="w-4 h-4" /></Btn>
              </div>
            )} />
        )}
      <ErrorNote error={reorder.error || defaults.error} />
      {editing && <CourseModal course={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Section>
  )
}
