// src/pages/Checklists.jsx
//
// Operator-defined recurring checklists (opening/closing/cleaning etc.),
// per venue — any name, any set of tasks, daily/weekly/monthly frequency.
// Two tabs: "Today" (tick off what's due) and "Checklists" (the builder).

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, X, ListChecks, Wrench, Check, ChevronUp, ChevronDown, Trash2,
  Pencil, Loader2, ClipboardList,
} from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { FREQUENCY_LABELS, periodLabel, ChecklistRunPanel } from '@/components/checklists/shared'

const TABS = [
  { key: 'today',     label: 'Today',       icon: ListChecks },
  { key: 'templates', label: 'Checklists',  icon: Wrench },
]

const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

// ── Template (checklist definition) modal ─────────────────────

function TemplateModal({ initial, venueId, onClose, onSave, isSaving }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [department, setDepartment] = useState(initial?.department ?? '')
  const [frequency, setFrequency] = useState(initial?.frequency ?? 'daily')
  const [dueDayOfWeek, setDueDayOfWeek] = useState(initial?.due_day_of_week ?? 1)
  const [dueDayOfMonth, setDueDayOfMonth] = useState(initial?.due_day_of_month ?? 1)

  function submit(e) {
    e.preventDefault()
    if (!name.trim()) return
    onSave({
      venue_id: venueId,
      name: name.trim(),
      department: department.trim() || null,
      frequency,
      due_day_of_week: frequency === 'weekly' ? Number(dueDayOfWeek) : null,
      due_day_of_month: frequency === 'monthly' ? Number(dueDayOfMonth) : null,
    })
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-background rounded-xl shadow-xl w-full max-w-md max-h-[85vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{initial ? 'Edit checklist' : 'New checklist'}</h2>
          <button type="button" onClick={onClose} className="p-1.5 rounded hover:bg-accent"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Name *</label>
            <input value={name} onChange={e => setName(e.target.value)} required autoFocus
              className="w-full border rounded px-3 py-2 text-sm bg-background min-h-[44px]"
              placeholder="Kitchen opening checklist" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Department (optional)</label>
            <input value={department} onChange={e => setDepartment(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm bg-background min-h-[44px]"
              placeholder="Kitchen / Bar / Front of house" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Frequency</label>
            <select value={frequency} onChange={e => setFrequency(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm bg-background min-h-[44px]">
              {Object.entries(FREQUENCY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          {frequency === 'weekly' && (
            <div>
              <label className="block text-sm font-medium mb-1">Ideally done on</label>
              <select value={dueDayOfWeek} onChange={e => setDueDayOfWeek(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm bg-background min-h-[44px]">
                {WEEKDAY_LABELS.map((d, i) => <option key={i} value={i}>{d}</option>)}
              </select>
              <p className="text-xs text-muted-foreground mt-1">A reminder only — the checklist stays open for the whole week either way.</p>
            </div>
          )}
          {frequency === 'monthly' && (
            <div>
              <label className="block text-sm font-medium mb-1">Ideally done by day of month</label>
              <input type="number" min={1} max={28} value={dueDayOfMonth}
                onChange={e => setDueDayOfMonth(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm bg-background min-h-[44px]" />
              <p className="text-xs text-muted-foreground mt-1">A reminder only — the checklist stays open for the whole month either way.</p>
            </div>
          )}
          <div className="flex gap-2 pt-2">
            <button type="submit" disabled={isSaving || !name.trim()}
              className="flex-1 bg-primary text-primary-foreground rounded px-4 py-2 text-sm font-medium min-h-[44px] disabled:opacity-50">
              {isSaving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={onClose}
              className="px-4 py-2 border rounded text-sm min-h-[44px]">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Tasks editor modal (the item list on a template) ──────────

function ItemsModal({ template, api, qc, onClose }) {
  const [newLabel, setNewLabel] = useState('')
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkText, setBulkText] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editingLabel, setEditingLabel] = useState('')

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['checklist-items', template.id],
    queryFn: () => api.get(`/checklists/templates/${template.id}/items`),
  })

  const invalidateItems = () => {
    qc.invalidateQueries({ queryKey: ['checklist-items', template.id] })
    qc.invalidateQueries({ queryKey: ['checklist-templates'] })
  }

  const addItem = useMutation({
    mutationFn: label => api.post(`/checklists/templates/${template.id}/items`, { label, sort_order: items.length }),
    onSuccess: () => { invalidateItems(); setNewLabel('') },
  })

  const bulkAdd = useMutation({
    mutationFn: async (lines) => {
      let order = items.length
      for (const line of lines) {
        await api.post(`/checklists/templates/${template.id}/items`, { label: line, sort_order: order++ })
      }
    },
    onSuccess: () => { invalidateItems(); setBulkText(''); setBulkOpen(false) },
  })

  const patchItem = useMutation({
    mutationFn: ({ id, ...body }) => api.patch(`/checklists/templates/${template.id}/items/${id}`, body),
    onSuccess: () => { invalidateItems(); setEditingId(null) },
  })

  const deleteItem = useMutation({
    mutationFn: id => api.delete(`/checklists/templates/${template.id}/items/${id}`),
    onSuccess: invalidateItems,
  })

  const reorder = useMutation({
    mutationFn: ids => api.put(`/checklists/templates/${template.id}/items/reorder`, { ids }),
    onSuccess: invalidateItems,
  })

  function move(idx, dir) {
    const next = [...items]
    const swapIdx = idx + dir
    if (swapIdx < 0 || swapIdx >= next.length) return
    ;[next[idx], next[swapIdx]] = [next[swapIdx], next[idx]]
    reorder.mutate(next.map(i => i.id))
  }

  function submitNew(e) {
    e.preventDefault()
    if (!newLabel.trim()) return
    addItem.mutate(newLabel.trim())
  }

  function submitBulk(e) {
    e.preventDefault()
    const lines = bulkText.split('\n').map(l => l.trim()).filter(Boolean)
    if (!lines.length) return
    bulkAdd.mutate(lines)
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-background rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold">{template.name}</h2>
          <button type="button" onClick={onClose} className="p-1.5 rounded hover:bg-accent"><X className="w-4 h-4" /></button>
        </div>
        <p className="text-xs text-muted-foreground mb-4">Tasks on this checklist, in the order staff will see them.</p>

        {isLoading ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">No tasks yet — add one below, or paste a list.</p>
        ) : (
          <ul className="border rounded-lg divide-y mb-3">
            {items.map((it, idx) => (
              <li key={it.id} className="flex items-center gap-2 px-3 py-2">
                <div className="flex flex-col shrink-0">
                  <button type="button" onClick={() => move(idx, -1)} disabled={idx === 0}
                    className="w-6 h-5 flex items-center justify-center rounded hover:bg-accent disabled:opacity-30 touch-manipulation">
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" onClick={() => move(idx, 1)} disabled={idx === items.length - 1}
                    className="w-6 h-5 flex items-center justify-center rounded hover:bg-accent disabled:opacity-30 touch-manipulation">
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                </div>
                {editingId === it.id ? (
                  <form className="flex-1 flex items-center gap-2" onSubmit={e => {
                    e.preventDefault()
                    if (editingLabel.trim()) patchItem.mutate({ id: it.id, label: editingLabel.trim() })
                  }}>
                    <input value={editingLabel} onChange={e => setEditingLabel(e.target.value)} autoFocus
                      className="flex-1 border rounded px-2 py-1.5 text-sm bg-background min-h-[36px]" />
                    <button type="submit" className="p-1.5 rounded hover:bg-accent text-emerald-600"><Check className="w-4 h-4" /></button>
                    <button type="button" onClick={() => setEditingId(null)} className="p-1.5 rounded hover:bg-accent"><X className="w-4 h-4" /></button>
                  </form>
                ) : (
                  <>
                    <span className="flex-1 text-sm">{it.label}</span>
                    <button type="button" onClick={() => { setEditingId(it.id); setEditingLabel(it.label) }}
                      className="p-1.5 rounded hover:bg-accent text-muted-foreground touch-manipulation">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button type="button" onClick={() => deleteItem.mutate(it.id)}
                      className="p-1.5 rounded hover:bg-accent text-destructive touch-manipulation">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={submitNew} className="flex gap-2 mb-3">
          <input value={newLabel} onChange={e => setNewLabel(e.target.value)}
            placeholder="Add a task…"
            className="flex-1 border rounded px-3 py-2 text-sm bg-background min-h-[44px]" />
          <button type="submit" disabled={!newLabel.trim() || addItem.isPending}
            className="px-4 border rounded text-sm min-h-[44px] disabled:opacity-50 touch-manipulation">
            {addItem.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Add'}
          </button>
        </form>

        {!bulkOpen ? (
          <button type="button" onClick={() => setBulkOpen(true)}
            className="text-xs text-primary hover:underline">
            Paste a list of tasks instead
          </button>
        ) : (
          <form onSubmit={submitBulk} className="space-y-2">
            <label className="block text-xs font-medium">One task per line</label>
            <textarea value={bulkText} onChange={e => setBulkText(e.target.value)} rows={6} autoFocus
              placeholder={'Inspect all equipment and switch on if required\nCheck stock and shelf life, rotate stock if required\nRestock blue paper and chemicals'}
              className="w-full border rounded px-3 py-2 text-sm bg-background resize-none" />
            <div className="flex gap-2">
              <button type="submit" disabled={!bulkText.trim() || bulkAdd.isPending}
                className="flex-1 bg-primary text-primary-foreground rounded px-4 py-2 text-sm font-medium min-h-[44px] disabled:opacity-50">
                {bulkAdd.isPending ? 'Adding…' : 'Add all'}
              </button>
              <button type="button" onClick={() => { setBulkOpen(false); setBulkText('') }}
                className="px-4 py-2 border rounded text-sm min-h-[44px]">Cancel</button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

// ── Today: run a single checklist occurrence ──────────────────

function RunChecklistModal({ template, date, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-background rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-6">
        <ChecklistRunPanel template={template} date={date} onClose={onClose} />
      </div>
    </div>
  )
}

// ── Today tab ──────────────────────────────────────────────────

function TodayTab({ venueId, date, api }) {
  const [running, setRunning] = useState(null)

  const { data: due = [], isLoading } = useQuery({
    queryKey: ['checklists-due', venueId, date],
    queryFn: () => api.get(`/checklists/due?venue_id=${venueId}&date=${date}`),
    enabled: !!venueId,
  })

  if (isLoading) return <p className="text-sm text-muted-foreground py-8 text-center">Loading…</p>

  if (due.length === 0) {
    return (
      <div className="border rounded-xl p-8 text-center">
        <p className="text-muted-foreground text-sm">No checklists set up yet for this venue.</p>
      </div>
    )
  }

  const groups = new Map()
  for (const d of due) {
    const key = d.template.department || 'General'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(d)
  }

  return (
    <div className="space-y-6">
      {[...groups.entries()].map(([dept, rows]) => (
        <div key={dept}>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">{dept}</h3>
          <div className="border rounded-xl divide-y overflow-hidden">
            {rows.map(({ template, period_start, instance }) => {
              const total = template.item_count
              const checked = instance?.checked_count ?? 0
              const completed = instance?.status === 'completed'
              return (
                <button key={template.id} type="button" onClick={() => setRunning(template)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-accent touch-manipulation min-h-[56px]">
                  <span className={cn(
                    'w-9 h-9 shrink-0 rounded-full flex items-center justify-center',
                    completed ? 'bg-emerald-100 text-emerald-700' : 'bg-muted text-muted-foreground',
                  )}>
                    {completed ? <Check className="w-4 h-4" /> : <ClipboardList className="w-4 h-4" />}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium truncate">{template.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {periodLabel(template.frequency, period_start)} · {FREQUENCY_LABELS[template.frequency]}
                    </span>
                  </span>
                  <span className={cn(
                    'text-xs font-medium px-2 py-1 rounded shrink-0',
                    completed ? 'bg-emerald-100 text-emerald-800' : 'bg-muted text-muted-foreground',
                  )}>
                    {completed ? 'Completed' : total ? `${checked}/${total}` : 'No tasks'}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      ))}

      {running && (
        <RunChecklistModal template={running} date={date} onClose={() => setRunning(null)} />
      )}
    </div>
  )
}

// ── Templates (builder) tab ─────────────────────────────────────

function TemplatesTab({ venueId, api, qc }) {
  const [modal, setModal] = useState(null) // 'new' | template row | null
  const [itemsFor, setItemsFor] = useState(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['checklist-templates', venueId],
    queryFn: () => api.get(`/checklists/templates?venue_id=${venueId}`),
    enabled: !!venueId,
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['checklist-templates', venueId] })

  const create = useMutation({
    mutationFn: body => api.post('/checklists/templates', body),
    onSuccess: () => { invalidate(); setModal(null) },
  })
  const patch = useMutation({
    mutationFn: ({ id, ...body }) => api.patch(`/checklists/templates/${id}`, body),
    onSuccess: () => { invalidate(); setModal(null) },
  })
  const remove = useMutation({
    mutationFn: id => api.delete(`/checklists/templates/${id}`),
    onSuccess: () => { invalidate(); setConfirmDeleteId(null) },
  })
  const reorder = useMutation({
    mutationFn: ids => api.put('/checklists/templates/reorder', { venue_id: venueId, ids }),
    onSuccess: invalidate,
  })

  function move(idx, dir) {
    const next = [...templates]
    const swapIdx = idx + dir
    if (swapIdx < 0 || swapIdx >= next.length) return
    ;[next[idx], next[swapIdx]] = [next[swapIdx], next[idx]]
    reorder.mutate(next.map(t => t.id))
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button type="button" onClick={() => setModal('new')}
          className="inline-flex items-center gap-2 bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium min-h-[44px] touch-manipulation">
          <Plus className="w-4 h-4" /> New checklist
        </button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Loading…</p>
      ) : templates.length === 0 ? (
        <div className="border rounded-xl p-8 text-center">
          <p className="text-muted-foreground text-sm">No checklists yet. Create one to define its tasks.</p>
        </div>
      ) : (
        <div className="border rounded-xl divide-y overflow-hidden">
          {templates.map((t, idx) => (
            <div key={t.id} className="flex items-center gap-2 px-4 py-3">
              <div className="flex flex-col shrink-0">
                <button type="button" onClick={() => move(idx, -1)} disabled={idx === 0}
                  className="w-7 h-6 flex items-center justify-center rounded hover:bg-accent disabled:opacity-30 touch-manipulation">
                  <ChevronUp className="w-4 h-4" />
                </button>
                <button type="button" onClick={() => move(idx, 1)} disabled={idx === templates.length - 1}
                  className="w-7 h-6 flex items-center justify-center rounded hover:bg-accent disabled:opacity-30 touch-manipulation">
                  <ChevronDown className="w-4 h-4" />
                </button>
              </div>
              <button type="button" onClick={() => setItemsFor(t)} className="flex-1 min-w-0 text-left touch-manipulation">
                <span className="block text-sm font-medium truncate">{t.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {FREQUENCY_LABELS[t.frequency]}{t.department ? ` · ${t.department}` : ''} · {t.item_count} task{t.item_count === 1 ? '' : 's'}
                </span>
              </button>
              <button type="button" onClick={() => setItemsFor(t)}
                className="px-3 py-1.5 border rounded text-xs font-medium min-h-[36px] hover:bg-accent touch-manipulation">
                Tasks
              </button>
              <button type="button" onClick={() => setModal(t)}
                className="p-2 rounded hover:bg-accent text-muted-foreground touch-manipulation">
                <Pencil className="w-4 h-4" />
              </button>
              {confirmDeleteId === t.id ? (
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => remove.mutate(t.id)} disabled={remove.isPending}
                    className="px-2 py-1.5 bg-destructive text-destructive-foreground rounded text-xs font-medium min-h-[36px] touch-manipulation">
                    Confirm
                  </button>
                  <button type="button" onClick={() => setConfirmDeleteId(null)}
                    className="px-2 py-1.5 border rounded text-xs min-h-[36px] touch-manipulation">Cancel</button>
                </div>
              ) : (
                <button type="button" onClick={() => setConfirmDeleteId(t.id)}
                  className="p-2 rounded hover:bg-accent text-destructive touch-manipulation">
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {modal && (
        <TemplateModal
          initial={modal === 'new' ? null : modal}
          venueId={venueId}
          isSaving={create.isPending || patch.isPending}
          onClose={() => setModal(null)}
          onSave={body => modal === 'new' ? create.mutate(body) : patch.mutate({ id: modal.id, ...body })}
        />
      )}

      {itemsFor && (
        <ItemsModal template={itemsFor} api={api} qc={qc} onClose={() => setItemsFor(null)} />
      )}
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────

export default function Checklists() {
  const api = useApi()
  const qc = useQueryClient()

  const [tab, setTab] = useState('today')
  const [venueId, setVenueId] = useState('')
  const [date, setDate] = useState(todayStr())

  const { data: venues = [] } = useQuery({
    queryKey: ['venues'],
    queryFn: () => api.get('/venues'),
  })

  useEffect(() => {
    if (!venueId && venues.length) setVenueId(venues[0].id)
  }, [venues, venueId])

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-bold">Checklists</h1>
        <div className="flex flex-wrap items-center gap-2">
          {venues.length > 1 && (
            <select value={venueId} onChange={e => setVenueId(e.target.value)}
              className="border rounded px-3 py-2 text-sm bg-background min-h-[44px]">
              {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          )}
          {tab === 'today' && (
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="border rounded px-3 py-2 text-sm bg-background min-h-[44px]" />
          )}
        </div>
      </div>

      <div className="flex gap-1 mb-4">
        {TABS.map(t => {
          const Icon = t.icon
          return (
            <button key={t.key} type="button" onClick={() => setTab(t.key)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-colors touch-manipulation',
                tab === t.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent',
              )}>
              <Icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          )
        })}
      </div>

      {!venueId ? (
        <p className="text-muted-foreground text-sm py-12 text-center">Select a venue to begin.</p>
      ) : tab === 'today' ? (
        <TodayTab venueId={venueId} date={date} api={api} />
      ) : (
        <TemplatesTab venueId={venueId} api={api} qc={qc} />
      )}
    </div>
  )
}
