// src/pages/Tables.jsx
// Manage tables grouped by section per venue.
// Inline forms for create/edit. Drag to reorder (sort_order) optional future work.

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Pencil, Trash2, Check, X, Layers, Link2 } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'

const TableSchema = z.object({
  label:      z.string().min(1, 'Required').max(50),
  section_id: z.string().uuid().nullable().optional(),
  min_covers: z.coerce.number().int().min(1),
  max_covers: z.coerce.number().int().min(1),
  sort_order: z.coerce.number().int().default(0),
  is_active:  z.boolean().default(true),
})

const SectionSchema = z.object({
  name:       z.string().min(1, 'Required').max(100),
  sort_order: z.coerce.number().int().default(0),
})

const inp = 'w-full border rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary'

function TableForm({ venueId, table, sections, onSave, onCancel }) {
  const api = useApi()
  const qc  = useQueryClient()

  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(TableSchema),
    defaultValues: table ?? { min_covers: 2, max_covers: 4, sort_order: 0, is_active: true },
  })

  const mutation = useMutation({
    mutationFn: (data) => table
      ? api.patch(`/venues/${venueId}/tables/${table.id}`, data)
      : api.post(`/venues/${venueId}/tables`, data),
    onSuccess: () => { qc.invalidateQueries(['tables', venueId]); onSave() },
  })

  return (
    <form onSubmit={handleSubmit(d => mutation.mutate(d))} className="space-y-3 p-3 bg-muted/20 rounded-lg">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Label</label>
          <input {...register('label')} className={inp} placeholder="T1, Bar-3, Window…" />
          {errors.label && <p className="text-xs text-destructive mt-0.5">{errors.label.message}</p>}
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Section</label>
          <select {...register('section_id')} className={inp}>
            <option value="">No section</option>
            {sections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Min covers</label>
          <input {...register('min_covers')} type="number" min={1} className={inp} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Max covers</label>
          <input {...register('max_covers')} type="number" min={1} className={inp} />
          {errors.max_covers && <p className="text-xs text-destructive mt-0.5">{errors.max_covers.message}</p>}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" {...register('is_active')} className="w-4 h-4" />
          Active
        </label>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Sort order:
          <input {...register('sort_order')} type="number" className="border rounded px-2 py-1 w-16 text-xs" />
        </div>
      </div>

      <div className="flex gap-2">
        <button type="submit" disabled={mutation.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm disabled:opacity-50">
          <Check className="w-3.5 h-3.5" />
          {mutation.isPending ? 'Saving…' : table ? 'Save' : 'Add table'}
        </button>
        <button type="button" onClick={onCancel}
          className="flex items-center gap-1.5 px-3 py-1.5 border rounded-md text-sm hover:bg-accent">
          <X className="w-3.5 h-3.5" /> Cancel
        </button>
      </div>
    </form>
  )
}

function SectionForm({ venueId, onSave, onCancel }) {
  const api = useApi()
  const qc  = useQueryClient()

  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(SectionSchema),
    defaultValues: { sort_order: 0 },
  })

  const mutation = useMutation({
    mutationFn: (data) => api.post(`/venues/${venueId}/sections`, data),
    onSuccess: () => { qc.invalidateQueries(['sections', venueId]); onSave() },
  })

  return (
    <form onSubmit={handleSubmit(d => mutation.mutate(d))}
      className="flex items-center gap-2 p-2 bg-muted/20 rounded-lg">
      <input {...register('name')} className={cn(inp, 'flex-1')} placeholder="Section name (Main Floor, Terrace…)" />
      <input {...register('sort_order')} type="number" className="border rounded px-2 py-1.5 text-sm w-20" placeholder="Order" />
      <button type="submit" disabled={mutation.isPending}
        className="px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm disabled:opacity-50 shrink-0">
        {mutation.isPending ? '…' : 'Add'}
      </button>
      <button type="button" onClick={onCancel}
        className="px-3 py-1.5 border rounded-md text-sm hover:bg-accent shrink-0">
        <X className="w-4 h-4" />
      </button>
    </form>
  )
}

function CombinationForm({ venueId, tables, onSave, onCancel }) {
  const api = useApi()
  const qc  = useQueryClient()
  const [selectedTableIds, setSelectedTableIds] = useState([])
  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(z.object({
      name:       z.string().min(1, 'Required'),
      min_covers: z.coerce.number().int().min(1),
      max_covers: z.coerce.number().int().min(1),
    })),
    defaultValues: { min_covers: 1, max_covers: 4 },
  })

  const mutation = useMutation({
    mutationFn: (data) => api.post(`/venues/${venueId}/combinations`, {
      ...data, table_ids: selectedTableIds,
    }),
    onSuccess: () => { qc.invalidateQueries(['combinations', venueId]); onSave() },
  })

  function toggleTable(id) {
    setSelectedTableIds(prev =>
      prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]
    )
  }

  return (
    <form onSubmit={handleSubmit(d => mutation.mutate(d))} className="space-y-3 p-3 bg-muted/20 rounded-lg border-2 border-dashed">
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-1">
          <label className="text-xs font-medium text-muted-foreground block mb-1">Name</label>
          <input {...register('name')} className={inp} placeholder="T1+T2" />
          {errors.name && <p className="text-xs text-destructive mt-0.5">{errors.name.message}</p>}
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Min covers</label>
          <input {...register('min_covers')} type="number" min={1} className={inp} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Max covers</label>
          <input {...register('max_covers')} type="number" min={1} className={inp} />
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1.5">
          Tables in combination <span className="text-muted-foreground/60">(select 2+)</span>
        </label>
        <div className="flex flex-wrap gap-2">
          {tables.filter(t => t.is_active).map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => toggleTable(t.id)}
              className={cn(
                'px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors',
                selectedTableIds.includes(t.id)
                  ? 'bg-primary/10 border-primary text-primary'
                  : 'hover:bg-accent'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        {selectedTableIds.length < 2 && (
          <p className="text-xs text-muted-foreground mt-1">Select at least 2 tables</p>
        )}
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={mutation.isPending || selectedTableIds.length < 2}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm disabled:opacity-50">
          <Check className="w-3.5 h-3.5" />
          {mutation.isPending ? 'Saving…' : 'Add combination'}
        </button>
        <button type="button" onClick={onCancel}
          className="flex items-center gap-1.5 px-3 py-1.5 border rounded-md text-sm hover:bg-accent">
          <X className="w-3.5 h-3.5" /> Cancel
        </button>
      </div>
    </form>
  )
}

export default function Tables() {
  const api = useApi()
  const qc  = useQueryClient()

  const [selectedVenueId,  setSelectedVenueId]  = useState(null)
  const [editingTable,     setEditingTable]      = useState(null)
  const [addingSection,    setAddingSection]     = useState(false)
  const [addingCombo,      setAddingCombo]       = useState(false)

  const { data: venues = [] } = useQuery({
    queryKey: ['venues'],
    queryFn:  () => api.get('/venues'),
  })

  const venueId = selectedVenueId ?? venues[0]?.id ?? null

  const { data: sections = [] } = useQuery({
    queryKey: ['sections', venueId],
    queryFn:  () => api.get(`/venues/${venueId}/sections`),
    enabled:  !!venueId,
  })

  const { data: tables = [], isLoading } = useQuery({
    queryKey: ['tables', venueId],
    queryFn:  () => api.get(`/venues/${venueId}/tables`),
    enabled:  !!venueId,
  })

  const { data: combinations = [] } = useQuery({
    queryKey: ['combinations', venueId],
    queryFn:  () => api.get(`/venues/${venueId}/combinations`),
    enabled:  !!venueId,
  })

  const deleteComboMutation = useMutation({
    mutationFn: (id) => api.delete(`/venues/${venueId}/combinations/${id}`),
    onSuccess:  () => qc.invalidateQueries(['combinations', venueId]),
  })

  const softDeleteMutation = useMutation({
    mutationFn: (tableId) => api.delete(`/venues/${venueId}/tables/${tableId}`),
    onSuccess: () => qc.invalidateQueries(['tables', venueId]),
  })

  // Group tables by section
  const grouped = sections.reduce((acc, s) => {
    acc[s.id] = { section: s, tables: tables.filter(t => t.section_id === s.id) }
    return acc
  }, {})
  const unsectioned = tables.filter(t => !t.section_id)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 h-14 border-b shrink-0">
        <h1 className="font-semibold">Tables</h1>
        <div className="flex items-center gap-2">
          <select
            value={venueId ?? ''}
            onChange={e => setSelectedVenueId(e.target.value)}
            className="text-sm border rounded px-2 py-1.5"
          >
            {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <button onClick={() => setEditingTable('new')}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 bg-primary text-primary-foreground rounded-lg">
            <Plus className="w-4 h-4" /> Add table
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl space-y-5">

          {/* Sections management */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Sections</p>
              {!addingSection && (
                <button onClick={() => setAddingSection(true)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                  <Plus className="w-3 h-3" /> Add section
                </button>
              )}
            </div>
            {addingSection && (
              <SectionForm venueId={venueId} onSave={() => setAddingSection(false)} onCancel={() => setAddingSection(false)} />
            )}
            {sections.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {sections.map(s => (
                  <span key={s.id} className="flex items-center gap-1.5 text-xs px-2.5 py-1 bg-muted rounded-full">
                    <Layers className="w-3 h-3" /> {s.name}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* New table form */}
          {editingTable === 'new' && (
            <TableForm
              venueId={venueId}
              sections={sections}
              onSave={() => setEditingTable(null)}
              onCancel={() => setEditingTable(null)}
            />
          )}

          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : tables.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tables yet. Add one above.</p>
          ) : (
            <>
              {/* Sectioned tables */}
              {Object.values(grouped).map(({ section, tables: sectionTables }) => (
                sectionTables.length > 0 && (
                  <div key={section.id}>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                      {section.name}
                    </p>
                    <TableGrid
                      tables={sectionTables}
                      sections={sections}
                      venueId={venueId}
                      editingTable={editingTable}
                      setEditingTable={setEditingTable}
                      onDelete={softDeleteMutation.mutate}
                    />
                  </div>
                )
              ))}

              {/* Unsectioned tables */}
              {unsectioned.length > 0 && (
                <div>
                  {sections.length > 0 && (
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                      No section
                    </p>
                  )}
                  <TableGrid
                    tables={unsectioned}
                    sections={sections}
                    venueId={venueId}
                    editingTable={editingTable}
                    setEditingTable={setEditingTable}
                    onDelete={softDeleteMutation.mutate}
                  />
                </div>
              )}
            </>
          )}
          {/* ── Combinations ─────────────────────────────── */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Table combinations
              </p>
              {!addingCombo && (
                <button onClick={() => setAddingCombo(true)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                  <Plus className="w-3 h-3" /> Add combination
                </button>
              )}
            </div>
            {addingCombo && (
              <CombinationForm
                venueId={venueId}
                tables={tables}
                onSave={() => setAddingCombo(false)}
                onCancel={() => setAddingCombo(false)}
              />
            )}
            {combinations.length === 0 && !addingCombo ? (
              <p className="text-xs text-muted-foreground">
                No combinations yet. Push tables together for larger parties.
              </p>
            ) : (
              <div className="grid gap-2 mt-2">
                {combinations.map(c => (
                  <div key={c.id} className={cn(
                    'flex items-center gap-4 px-4 py-3 border rounded-lg',
                    !c.is_active && 'opacity-50'
                  )}>
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Link2 className="w-4 h-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{c.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {c.min_covers}–{c.max_covers} covers ·{' '}
                        {Array.isArray(c.members)
                          ? c.members.map(m => m.label).join(' + ')
                          : ''}
                      </p>
                    </div>
                    <button
                      onClick={() => deleteComboMutation.mutate(c.id)}
                      className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}

function TableGrid({ tables, sections, venueId, editingTable, setEditingTable, onDelete }) {
  return (
    <div className="grid gap-2">
      {tables.map(table => (
        <div key={table.id}>
          {editingTable === table.id ? (
            <TableForm
              venueId={venueId}
              table={table}
              sections={sections}
              onSave={() => setEditingTable(null)}
              onCancel={() => setEditingTable(null)}
            />
          ) : (
            <div className={cn(
              'flex items-center gap-4 px-4 py-3 border rounded-lg',
              !table.is_active && 'opacity-50'
            )}>
              <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
                <span className="text-sm font-bold">{table.label}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">{table.label}</p>
                  {!table.is_active && <span className="text-xs text-muted-foreground">(inactive)</span>}
                </div>
                <p className="text-xs text-muted-foreground">
                  {table.min_covers}–{table.max_covers} covers
                  {table.section_name && ` · ${table.section_name}`}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setEditingTable(table.id)}
                  className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => onDelete(table.id)}
                  className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
