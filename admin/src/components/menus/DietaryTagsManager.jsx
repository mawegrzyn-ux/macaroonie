// Tenant-wide menu tags, shown next to dishes across every menu. Lives at
// /menus/dietary-tags. Two lists (migration 145):
//   Allergens     the 14 standard allergens plus any of the tenant's own;
//                 a dish has each at a level (contains / may contain /
//                 can be removed), set in the dish panel or the Allergen
//                 matrix
//   Dietary tags  vegan, gluten-free, spicy...: a dish has it or not
// Each list drags to reorder (that's the order badges show in). Add and
// edit happen in one modal (TagModal), which also changes a tag's type,
// merges it into another tag, or deletes it (inline confirms).

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Loader2, Pencil, ShieldCheck, Merge, EyeOff } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Modal, SortableRows } from '@/components/staff/shared'
import { STANDARD_ALLERGENS } from '@shared/menuTags.js'
import { Card, Field, Input, Btn } from './shared'

const EMPTY = { code: '', label: '', glyph: '', colour: '#7a1a26', show_on_menu: true }
const SWATCHES = ['#7a1a26', '#b91c1c', '#c2410c', '#a16207', '#4d7c0f', '#15803d', '#0f766e', '#1d4ed8', '#6d28d9', '#374151']
const slug = (v) => v.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 16)

export const KIND_LABELS = { allergen: 'Allergen', dietary: 'Dietary tag' }

/** Every tag of the tenant, dietary tags first (the order dishes show them in). */
export function useMenuTags() {
  const api = useApi()
  return useQuery({
    queryKey: ['dietary-tags'],
    queryFn:  () => api.get('/menus/dietary/all'),
  })
}

function refreshTags(qc) {
  qc.invalidateQueries({ queryKey: ['dietary-tags'] })
  qc.invalidateQueries({ queryKey: ['menu'] })
  qc.invalidateQueries({ queryKey: ['allergen-matrix'] })
}

export function DietaryTagsManager() {
  const api = useApi()
  const qc  = useQueryClient()
  const { data: tags = [], isLoading } = useMenuTags()
  const [editing, setEditing] = useState(null)   // null | { kind } (new) | tag row

  const allergens = tags.filter(t => t.kind === 'allergen')
  const dietary   = tags.filter(t => t.kind !== 'allergen')
  const haveKeys  = new Set(tags.map(t => t.standard_key).filter(Boolean))
  const missing   = STANDARD_ALLERGENS.filter(a => !haveKeys.has(a.key))

  const reorder = useMutation({
    mutationFn: (ids) => api.patch('/menus/dietary/reorder', { ids }),
    onSettled:  () => refreshTags(qc),
  })
  const addStandard = useMutation({
    mutationFn: () => api.post('/menus/dietary/standard-allergens', {}),
    onSuccess:  () => refreshTags(qc),
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    )
  }

  const row = (t) => (
    <button type="button" onClick={() => setEditing(t)}
      className="w-full flex items-center gap-3 px-1 py-1 text-sm text-left min-h-[44px] rounded-md hover:bg-accent touch-manipulation">
      <TagChip tag={t} />
      <span className="font-medium flex-1 min-w-0 truncate">{t.label}</span>
      {t.show_on_menu === false && (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 dark:text-amber-300 shrink-0"
          title="Not shown on the website, printed menus or online ordering; still in the Allergen matrix and lookup">
          <EyeOff className="w-3.5 h-3.5" /> Not on menus
        </span>
      )}
      {t.standard_key && (
        <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-muted-foreground" title="One of the 14 allergens UK law says you must declare">
          <ShieldCheck className="w-3.5 h-3.5" /> Standard
        </span>
      )}
      <code className="text-xs text-muted-foreground">{t.code}</code>
      <Pencil className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
    </button>
  )

  return (
    <div className="space-y-5">
      <Card title="Allergens"
        description="Set per dish as Contains, May contain or Can be removed. On menus all three show the badge; Can be removed adds a small asterisk."
        action={<div className="shrink-0 whitespace-nowrap"><Btn variant="secondary" onClick={() => setEditing({ kind: 'allergen' })}><Plus className="w-3.5 h-3.5" /> Add allergen</Btn></div>}>
        {missing.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 text-amber-900 px-3 py-2 text-sm dark:bg-amber-950/30 dark:text-amber-200">
            <span className="flex-1 min-w-[12rem]">
              {missing.length === STANDARD_ALLERGENS.length
                ? 'The 14 standard allergens are not set up yet.'
                : `Missing ${missing.length} of the 14 standard allergens: ${missing.map(a => a.label).join(', ')}.`}
            </span>
            <Btn onClick={() => addStandard.mutate()} disabled={addStandard.isPending}>
              {addStandard.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Add {missing.length === STANDARD_ALLERGENS.length ? 'all 14' : 'missing'}
            </Btn>
          </div>
        )}
        {allergens.length > 0
          ? <SortableRows items={allergens} onReorder={ids => reorder.mutate(ids)} renderItem={row} />
          : <p className="text-sm text-muted-foreground text-center py-4">No allergens yet.</p>}
      </Card>

      <Card title="Dietary tags"
        description="Vegan, gluten-free, spicy and the like: a dish has the tag or it doesn't."
        action={<div className="shrink-0 whitespace-nowrap"><Btn variant="secondary" onClick={() => setEditing({ kind: 'dietary' })}><Plus className="w-3.5 h-3.5" /> Add tag</Btn></div>}>
        {dietary.length > 0
          ? <SortableRows items={dietary} onReorder={ids => reorder.mutate(ids)} renderItem={row} />
          : <p className="text-sm text-muted-foreground text-center py-4">No dietary tags yet.</p>}
      </Card>
      <p className="text-xs text-muted-foreground">Drag the grips to change the order the badges show in. On menus, dietary tags come before allergens.</p>
      {(reorder.error || addStandard.error) && (
        <p className="text-xs text-destructive">{(reorder.error || addStandard.error).message}</p>
      )}

      {editing && (
        <TagModal tag={editing.id ? editing : null} kind={editing.kind || 'dietary'} tags={tags}
          onClose={() => setEditing(null)} />
      )}
    </div>
  )
}

export function TagChip({ tag, size = 'w-7 h-7', star = false }) {
  return (
    <span className={`inline-flex items-center justify-center text-xs font-bold rounded shrink-0 px-1 ${size}`}
      style={{ background: tag.colour, color: '#fff', minWidth: '1.75rem' }}>
      {tag.glyph || '?'}{star && <span className="self-start text-[0.85em] ml-px">*</span>}
    </span>
  )
}

function TagModal({ tag, kind: newKind, tags, onClose }) {
  const api = useApi()
  const qc  = useQueryClient()
  const isNew = !tag
  const [form, setForm] = useState(isNew
    ? { ...EMPTY, kind: newKind }
    : { code: tag.code, label: tag.label, glyph: tag.glyph, colour: tag.colour, kind: tag.kind || 'dietary',
        show_on_menu: tag.show_on_menu !== false })
  // New tags get a code from the label until the code is typed by hand.
  const [codeTouched, setCodeTouched] = useState(!isNew)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [mergeInto, setMergeInto] = useState('')
  const [confirmMerge, setConfirmMerge] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const sameKind = tags.filter(t => t.kind === form.kind).length
  const save = useMutation({
    mutationFn: () => isNew
      ? api.post('/menus/dietary', { ...form, sort_order: sameKind })
      : api.patch(`/menus/dietary/${tag.id}`, form),
    onSuccess: () => { refreshTags(qc); onClose() },
  })
  const del = useMutation({
    mutationFn: () => api.delete(`/menus/dietary/${tag.id}`),
    onSuccess: () => { refreshTags(qc); onClose() },
  })
  const merge = useMutation({
    mutationFn: () => api.post(`/menus/dietary/${tag.id}/merge`, { into_id: mergeInto }),
    onSuccess: () => { refreshTags(qc); onClose() },
  })

  const saved = isNew ? null : { ...tag, kind: tag.kind || 'dietary', show_on_menu: tag.show_on_menu !== false }
  const dirty = isNew || ['code', 'label', 'glyph', 'colour', 'kind', 'show_on_menu'].some(k => form[k] !== saved[k])
  const valid = form.code && form.label && form.glyph
  const error = save.error || del.error || merge.error
  const mergeTarget = tags.find(t => t.id === mergeInto)
  const others = isNew ? [] : tags.filter(t => t.id !== tag.id)
  const noun = form.kind === 'allergen' ? 'allergen' : 'dietary tag'

  return (
    <Modal title={isNew ? `New ${noun}` : `Edit ${noun}`} onClose={onClose}
      footer={<>
        <Btn onClick={() => save.mutate()} disabled={!valid || !dirty || save.isPending}>
          {save.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {isNew ? 'Add' : 'Save'}
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
      <Field label="Type">
        <div className="inline-flex rounded-md border overflow-hidden">
          {['allergen', 'dietary'].map(k => (
            <button key={k} type="button" onClick={() => set('kind', k)}
              disabled={!!tag?.standard_key && k === 'dietary'}
              className={cn('px-3 min-h-[44px] text-sm touch-manipulation disabled:opacity-40',
                form.kind === k ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-accent')}>
              {KIND_LABELS[k]}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground mt-1">
          {tag?.standard_key
            ? 'One of the 14 standard allergens, so it stays an allergen.'
            : form.kind === 'allergen'
              ? 'Dishes get a level: contains, may contain or can be removed.'
              : 'A dish has it or not. Turning an allergen into a dietary tag keeps it on every dish, as "has it".'}
        </p>
      </Field>
      <Field label="Label" hint={form.kind === 'allergen' ? 'What guests see, e.g. Sesame' : 'What guests see, e.g. Gluten-free'}>
        <Input value={form.label} autoFocus={isNew}
          onChange={e => { set('label', e.target.value); if (!codeTouched) set('code', slug(e.target.value)) }} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Glyph" hint="Short mark on the badge, e.g. GF or Se">
          <Input value={form.glyph} maxLength={8} onChange={e => set('glyph', e.target.value)} />
        </Field>
        <Field label="Code" hint="Short id, e.g. gf">
          <Input value={form.code} maxLength={16}
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
      <Field label="On menus">
        <div className="inline-flex rounded-md border overflow-hidden">
          {[[true, 'Show'], [false, 'Hide']].map(([v, label]) => (
            <button key={label} type="button" onClick={() => set('show_on_menu', v)}
              className={cn('px-4 min-h-[44px] text-sm touch-manipulation',
                form.show_on_menu === v ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-accent')}>
              {label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground mt-1">
          Hide leaves the badge off the website, printed menus, the dietary list and online ordering. It stays in the
          Allergen matrix, the allergen lookup and the menu editor, for example Gluten when dishes already show Gluten-free.
        </p>
      </Field>

      {!isNew && others.length > 0 && (
        <div className="border-t pt-3 space-y-2">
          <p className="text-xs font-medium inline-flex items-center gap-1.5"><Merge className="w-3.5 h-3.5" /> Merge into another tag</p>
          <p className="text-[11px] text-muted-foreground">
            Moves {tag.label} off every dish onto the tag you pick, then deletes {tag.label}. Use it when you have two tags for the same thing.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <select value={mergeInto} onChange={e => { setMergeInto(e.target.value); setConfirmMerge(false) }}
              className="border rounded-md px-2 text-sm bg-background min-h-[44px] touch-manipulation flex-1 min-w-[10rem]">
              <option value="">Pick a tag</option>
              {['allergen', 'dietary'].map(k => (
                <optgroup key={k} label={k === 'allergen' ? 'Allergens' : 'Dietary tags'}>
                  {others.filter(t => t.kind === k).map(t => <option key={t.id} value={t.id}>{t.label} ({t.glyph})</option>)}
                </optgroup>
              ))}
            </select>
            {!confirmMerge
              ? <Btn variant="secondary" disabled={!mergeInto} onClick={() => setConfirmMerge(true)}>Merge</Btn>
              : (
                <span className="inline-flex gap-2">
                  <button type="button" onClick={() => merge.mutate()} disabled={merge.isPending}
                    className="text-sm font-medium rounded-md px-3 min-h-[44px] bg-destructive text-destructive-foreground touch-manipulation">
                    {merge.isPending ? 'Merging…' : `Yes, merge into ${mergeTarget?.label}`}
                  </button>
                  <button type="button" onClick={() => setConfirmMerge(false)}
                    className="text-sm rounded-md px-3 min-h-[44px] border touch-manipulation">Cancel</button>
                </span>
              )}
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 space-y-2">
          <p className="text-sm">Delete <strong>{tag.label}</strong>? It is removed from every dish that uses it.</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => del.mutate()} disabled={del.isPending}
              className="text-sm font-medium rounded-md px-3 min-h-[44px] bg-destructive text-destructive-foreground touch-manipulation">
              {del.isPending ? 'Deleting…' : 'Yes, delete'}
            </button>
            <button type="button" onClick={() => setConfirmDelete(false)}
              className="text-sm rounded-md px-3 min-h-[44px] border touch-manipulation">Cancel</button>
          </div>
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error.body?.error || error.message || 'Save failed'}</p>}
    </Modal>
  )
}
