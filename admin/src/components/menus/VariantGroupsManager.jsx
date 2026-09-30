// Tenant-wide reusable variant option sets (Protein, Size…), attachable
// to any dish across any menu. Standalone manager — lives at
// /menus/variant-groups, not nested inside a specific menu's editor.

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, X, Loader2, Layers } from 'lucide-react'
import { useApi } from '@/lib/api'
import { Field, Input, Btn, PriceInput } from './shared'

function emptyGroup() {
  return { name: '', price_mode: 'base', min_select: 1, max_select: 1, options: [{ label: '', price_pence: 0 }] }
}

export function VariantGroupsManager() {
  const api = useApi()
  const qc  = useQueryClient()
  const { data: groups = [], isLoading } = useQuery({
    queryKey: ['menu-variant-groups'],
    queryFn:  () => api.get('/menus/variant-groups'),
  })
  const [draft, setDraft] = useState(null) // null | { id?: uuid, name, options }

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: draft.name.trim(),
        // Web ordering: how the price works and how many a guest picks.
        price_mode: draft.price_mode || 'base',
        min_select: Math.max(0, Number(draft.min_select ?? 1)),
        max_select: Math.max(1, Number(draft.max_select ?? 1)),
        sort_order: draft.id ? (groups.find(g => g.id === draft.id)?.sort_order ?? 0) : groups.length,
        options: (draft.options || [])
          .filter(o => o.label.trim())
          .map((o, i) => ({
            id: o.id,
            label: o.label.trim(),
            price_pence: o.price_pence ?? 0,
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
      options: (g.options || []).map(o => ({ ...o })),
    })
  }

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
            <button onClick={() => editGroup(g)} className="text-xs text-primary hover:underline shrink-0">Edit</button>
            <button onClick={() => { if (window.confirm(`Delete group "${g.name}"? Dishes will lose this group.`)) del.mutate(g.id) }}
              className="text-destructive hover:bg-destructive/10 p-1.5 rounded shrink-0">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        {groups.length === 0 && (
          <div className="px-3 py-6 text-sm text-muted-foreground text-center">
            No variant groups yet. Create "Protein" or "Size" and attach them to dishes from the menu editor.
          </div>
        )}
      </div>

      {draft ? (
        <div className="border rounded-lg p-4 bg-violet-50/60 space-y-3">
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
          </div>
          <div className="space-y-1.5">
            <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wide">Options + default price</p>
            {(draft.options || []).map((o, i) => (
              <div key={o.id || i} className="flex items-center gap-2">
                <Input value={o.label}
                  onChange={e => setDraft(d => {
                    const options = d.options.slice(); options[i] = { ...options[i], label: e.target.value }
                    return { ...d, options }
                  })}
                  placeholder="Label (e.g. Chicken)" className="flex-1" />
                <PriceInput
                  pence={o.price_pence}
                  onChange={pence => setDraft(d => {
                    const options = d.options.slice()
                    options[i] = { ...options[i], price_pence: pence ?? 0 }
                    return { ...d, options }
                  })}
                  placeholder="£0.00" className="w-28 font-mono" />
                <button onClick={() => setDraft(d => ({ ...d, options: d.options.filter((_, j) => j !== i) }))}
                  className="text-destructive hover:bg-destructive/10 p-1 rounded">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            <button onClick={() => setDraft(d => ({ ...d, options: [...d.options, { label: '', price_pence: 0 }] }))}
              className="text-xs text-primary hover:underline inline-flex items-center gap-1">
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
