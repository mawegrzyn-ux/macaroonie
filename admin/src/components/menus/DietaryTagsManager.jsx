// Tenant-wide dietary / allergen tags, shown next to dishes across every
// menu. Lives at /menus/dietary-tags. Add and edit happen in one modal
// (TagModal); delete is inside it with an inline confirm.

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Loader2, Pencil } from 'lucide-react'
import { useApi } from '@/lib/api'
import { Modal } from '@/components/staff/shared'
import { Field, Input, Btn } from './shared'

const EMPTY = { code: '', label: '', glyph: '', colour: '#7a1a26' }
const SWATCHES = ['#7a1a26', '#b91c1c', '#c2410c', '#a16207', '#4d7c0f', '#15803d', '#0f766e', '#1d4ed8', '#6d28d9', '#374151']
const slug = (v) => v.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32)

export function DietaryTagsManager() {
  const api = useApi()
  const { data: tags = [], isLoading } = useQuery({
    queryKey: ['dietary-tags'],
    queryFn:  () => api.get('/menus/dietary/all'),
  })
  const [editing, setEditing] = useState(null)   // null | 'new' | tag row

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
        {tags.map(t => (
          <button key={t.id} type="button" onClick={() => setEditing(t)}
            className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-left hover:bg-accent min-h-[52px] touch-manipulation">
            <TagChip tag={t} />
            <span className="font-medium flex-1">{t.label}</span>
            <code className="text-xs text-muted-foreground">{t.code}</code>
            <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        ))}
        {tags.length === 0 && (
          <div className="px-3 py-6 text-sm text-muted-foreground text-center">No dietary tags yet.</div>
        )}
      </div>

      <Btn variant="secondary" onClick={() => setEditing('new')}>
        <Plus className="w-3.5 h-3.5" /> Add tag
      </Btn>

      {editing && (
        <TagModal tag={editing === 'new' ? null : editing} count={tags.length}
          onClose={() => setEditing(null)} />
      )}
    </div>
  )
}

export function TagChip({ tag, size = 'w-7 h-7' }) {
  return (
    <span className={`inline-flex items-center justify-center text-xs font-bold rounded shrink-0 px-1 ${size}`}
      style={{ background: tag.colour, color: '#fff', minWidth: '1.75rem' }}>{tag.glyph || '?'}</span>
  )
}

function TagModal({ tag, count, onClose }) {
  const api = useApi()
  const qc  = useQueryClient()
  const isNew = !tag
  const [form, setForm] = useState(isNew ? EMPTY : { code: tag.code, label: tag.label, glyph: tag.glyph, colour: tag.colour })
  // New tags get a code from the label until the code is typed by hand.
  const [codeTouched, setCodeTouched] = useState(!isNew)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['dietary-tags'] })
    qc.invalidateQueries({ queryKey: ['menu'] })
  }
  const save = useMutation({
    mutationFn: () => isNew
      ? api.post('/menus/dietary', { ...form, sort_order: count })
      : api.patch(`/menus/dietary/${tag.id}`, form),
    onSuccess: () => { refresh(); onClose() },
  })
  const del = useMutation({
    mutationFn: () => api.delete(`/menus/dietary/${tag.id}`),
    onSuccess: () => { refresh(); onClose() },
  })

  const dirty = isNew || ['code', 'label', 'glyph', 'colour'].some(k => form[k] !== tag[k])
  const valid = form.code && form.label && form.glyph
  const error = save.error || del.error

  return (
    <Modal title={isNew ? 'New dietary tag' : 'Edit dietary tag'} onClose={onClose}
      footer={<>
        <Btn onClick={() => save.mutate()} disabled={!valid || !dirty || save.isPending}>
          {save.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {isNew ? 'Add tag' : 'Save'}
        </Btn>
        <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
        {!isNew && !confirmDelete && (
          <button type="button" onClick={() => setConfirmDelete(true)}
            className="ml-auto inline-flex items-center gap-1.5 text-sm text-destructive px-3 min-h-[44px] rounded-md hover:bg-destructive/10 touch-manipulation">
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </button>
        )}
      </>}>
      <div className="flex items-center gap-3">
        <TagChip tag={form} size="h-10 min-w-10 text-sm" />
        <span className="text-sm text-muted-foreground">Preview</span>
      </div>
      <Field label="Label" hint="What guests see, e.g. Gluten-free">
        <Input value={form.label} autoFocus={isNew}
          onChange={e => { set('label', e.target.value); if (!codeTouched) set('code', slug(e.target.value)) }} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Glyph" hint="Short mark on the badge, e.g. GF or a chilli emoji">
          <Input value={form.glyph} maxLength={8} onChange={e => set('glyph', e.target.value)} />
        </Field>
        <Field label="Code" hint="Short id, e.g. gf">
          <Input value={form.code}
            onChange={e => { setCodeTouched(true); set('code', e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '')) }} />
        </Field>
      </div>
      <Field label="Colour">
        <div className="flex flex-wrap items-center gap-2">
          {SWATCHES.map(c => (
            <button key={c} type="button" onClick={() => set('colour', c)} title={c}
              className={`w-9 h-9 rounded-md border-2 touch-manipulation ${form.colour?.toLowerCase() === c ? 'border-foreground' : 'border-transparent'}`}
              style={{ background: c }} />
          ))}
          <input type="color" value={form.colour} onChange={e => set('colour', e.target.value)}
            className="w-11 h-9 border rounded cursor-pointer" title="Pick any colour" />
        </div>
      </Field>

      {confirmDelete && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 space-y-2">
          <p className="text-sm">Delete <strong>{tag.label}</strong>? It is removed from every dish that uses it.</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => del.mutate()} disabled={del.isPending}
              className="text-sm font-medium rounded-md px-3 min-h-[40px] bg-destructive text-destructive-foreground touch-manipulation">
              {del.isPending ? 'Deleting…' : 'Yes, delete'}
            </button>
            <button type="button" onClick={() => setConfirmDelete(false)}
              className="text-sm rounded-md px-3 min-h-[40px] border touch-manipulation">Cancel</button>
          </div>
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error.body?.error || error.message || 'Save failed'}</p>}
    </Modal>
  )
}
