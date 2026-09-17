// Tenant-wide dietary / allergen tags, shown next to dishes across every
// menu. Standalone manager — lives at /menus/dietary-groups.

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Loader2 } from 'lucide-react'
import { useApi } from '@/lib/api'
import { Field, Input, Btn } from './shared'

export function DietaryGroupsManager() {
  const api = useApi()
  const qc  = useQueryClient()
  const { data: tags = [], isLoading } = useQuery({
    queryKey: ['dietary-tags'],
    queryFn:  () => api.get('/menus/dietary/all'),
  })
  const [newTag, setNewTag] = useState({ code: '', label: '', glyph: '', colour: '#7a1a26' })

  const create = useMutation({
    mutationFn: () => api.post('/menus/dietary', { ...newTag, sort_order: tags.length }),
    onSuccess: () => {
      setNewTag({ code: '', label: '', glyph: '', colour: '#7a1a26' })
      qc.invalidateQueries({ queryKey: ['dietary-tags'] })
      qc.invalidateQueries({ queryKey: ['menu'] })
    },
  })
  const del = useMutation({
    mutationFn: (id) => api.delete(`/menus/dietary/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dietary-tags'] })
      qc.invalidateQueries({ queryKey: ['menu'] })
    },
  })

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
          <div key={t.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
            <span className="inline-flex items-center justify-center text-xs font-bold w-7 h-7 rounded shrink-0"
              style={{ background: t.colour, color: '#fff' }}>{t.glyph}</span>
            <span className="font-medium flex-1">{t.label}</span>
            <code className="text-xs text-muted-foreground">{t.code}</code>
            <button onClick={() => { if (window.confirm(`Delete tag ${t.label}?`)) del.mutate(t.id) }}
              className="text-destructive hover:bg-destructive/10 p-1.5 rounded">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        {tags.length === 0 && (
          <div className="px-3 py-6 text-sm text-muted-foreground text-center">No dietary tags yet.</div>
        )}
      </div>

      <div className="border rounded-lg p-4 bg-muted/30">
        <p className="text-xs font-semibold text-muted-foreground mb-3">New tag</p>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-end">
          <Field label="Code" hint="e.g. 'gf'">
            <Input value={newTag.code}
              onChange={e => setNewTag(t => ({ ...t, code: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') }))} />
          </Field>
          <Field label="Glyph" hint="e.g. 'GF' or a chilli emoji">
            <Input value={newTag.glyph} onChange={e => setNewTag(t => ({ ...t, glyph: e.target.value }))} />
          </Field>
          <Field label="Label">
            <Input value={newTag.label} onChange={e => setNewTag(t => ({ ...t, label: e.target.value }))} />
          </Field>
          <Field label="Colour">
            <input type="color" value={newTag.colour}
              onChange={e => setNewTag(t => ({ ...t, colour: e.target.value }))}
              className="w-full h-9 border rounded cursor-pointer" />
          </Field>
          <Btn variant="secondary" onClick={() => create.mutate()}
            disabled={!newTag.code || !newTag.label || !newTag.glyph || create.isPending}>
            {create.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Add tag
          </Btn>
        </div>
        {create.isError && (
          <p className="text-xs text-destructive mt-2">{create.error?.body?.error || 'Create failed'}</p>
        )}
      </div>
    </div>
  )
}
