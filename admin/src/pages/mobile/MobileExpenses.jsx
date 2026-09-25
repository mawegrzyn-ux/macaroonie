// src/pages/mobile/MobileExpenses.jsx
//
// Phone-first "record an expense" page — a single-purpose slice of Cash
// Reconciliation's Petty Cash Expenses section, for logging an expense
// (and optionally snapping a photo of the receipt) away from a desk.
// Reuses the exact same API endpoints as CashRecon.jsx's ExpensesSection
// (GET config, GET/POST/PUT/DELETE .../cash-recon/expenses[/:id][/receipt])
// — one implementation of the underlying data, this is just a narrower
// entry point into it.

import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { Plus, X, Camera, Trash2, Receipt } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function fmt(n) {
  return `£${Number(n || 0).toFixed(2)}`
}

function ExpenseModal({ venueId, date, categories, initial, onClose, onSave, onDelete, isSaving, isDeleting }) {
  const isEdit = !!initial
  const [description, setDescription] = useState(initial?.description ?? '')
  const [categoryId, setCategoryId] = useState(initial?.category_id ?? null)
  const [amount, setAmount] = useState(initial?.amount != null ? String(initial.amount) : '')
  const [vatAmount, setVatAmount] = useState(initial?.vat_amount != null ? String(initial.vat_amount) : '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [photo, setPhoto] = useState(null) // { file, preview }
  const [confirmDelete, setConfirmDelete] = useState(false)
  const fileRef = useRef(null)

  useEffect(() => () => { if (photo?.preview) URL.revokeObjectURL(photo.preview) }, [photo])

  function pickPhoto(file) {
    if (!file) return
    if (photo?.preview) URL.revokeObjectURL(photo.preview)
    setPhoto({ file, preview: URL.createObjectURL(file) })
  }

  const canSave = description.trim().length > 0 && amount !== ''

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-background rounded-xl shadow-xl w-full max-w-sm max-h-[85vh] overflow-y-auto p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{isEdit ? 'Edit expense' : 'Add expense'}</h2>
          <button type="button" onClick={onClose} className="p-1.5 rounded hover:bg-accent"><X className="w-4 h-4" /></button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Description *</label>
            <input value={description} onChange={e => setDescription(e.target.value)} autoFocus
              placeholder="e.g. Bar mop delivery"
              className="w-full border rounded-lg px-3 py-2.5 text-sm bg-background min-h-[44px]" />
          </div>

          {categories.length > 0 && (
            <div>
              <label className="block text-sm font-medium mb-1.5">Category</label>
              <div className="flex flex-wrap gap-1.5">
                {categories.map(cat => {
                  const active = categoryId === cat.id
                  return (
                    <button key={cat.id} type="button" onClick={() => setCategoryId(active ? null : cat.id)}
                      style={active && cat.colour ? { backgroundColor: cat.colour + '33', borderColor: cat.colour, color: cat.colour } : {}}
                      className={cn(
                        'h-9 px-3 rounded-full text-xs font-medium border touch-manipulation',
                        active ? 'bg-primary/10 border-primary text-primary' : 'bg-background text-muted-foreground hover:bg-muted',
                      )}>
                      {cat.name}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Gross amount *</label>
              <input type="number" step="0.01" min="0" inputMode="decimal" value={amount}
                onChange={e => setAmount(e.target.value)} placeholder="0.00"
                className="w-full border rounded-lg px-3 py-2.5 text-sm bg-background min-h-[44px] font-mono" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">VAT amount</label>
              <input type="number" step="0.01" min="0" inputMode="decimal" value={vatAmount}
                onChange={e => setVatAmount(e.target.value)} placeholder="0.00"
                className="w-full border rounded-lg px-3 py-2.5 text-sm bg-background min-h-[44px] font-mono" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Notes (optional)</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              className="w-full border rounded-lg px-3 py-2.5 text-sm bg-background resize-none" />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5">Receipt photo</label>
            <input type="file" accept="image/*" capture="environment" ref={fileRef} className="hidden"
              onChange={e => pickPhoto(e.target.files[0])} />
            {photo?.preview ? (
              <div className="relative inline-block">
                <img src={photo.preview} alt="Receipt preview" className="h-24 w-24 object-cover rounded-lg border" />
                <button type="button" onClick={() => setPhoto(null)}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-destructive text-white flex items-center justify-center touch-manipulation">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ) : initial?.receipt_url ? (
              <div className="relative inline-block">
                <img src={initial.receipt_url} alt="Receipt" className="h-24 w-24 object-cover rounded-lg border" />
              </div>
            ) : (
              <button type="button" onClick={() => fileRef.current?.click()}
                className="inline-flex items-center gap-2 h-11 px-3 rounded-lg border text-sm text-muted-foreground touch-manipulation hover:bg-muted">
                <Camera className="w-4 h-4" /> Take photo
              </button>
            )}
          </div>

          <button type="button" disabled={!canSave || isSaving}
            onClick={() => onSave({ description: description.trim(), category_id: categoryId, amount: Number(amount) || 0, vat_amount: Number(vatAmount) || 0, notes: notes.trim() || null }, photo?.file)}
            className="w-full bg-primary text-primary-foreground rounded-lg px-4 py-2.5 text-sm font-medium min-h-[44px] disabled:opacity-50 touch-manipulation">
            {isSaving ? 'Saving…' : isEdit ? 'Save changes' : 'Add expense'}
          </button>

          {isEdit && (
            initial.receipt_url ? (
              <p className="text-xs text-muted-foreground text-center">
                Remove the receipt photo before deleting this expense.
              </p>
            ) : confirmDelete ? (
              <div className="flex gap-2">
                <button type="button" onClick={() => onDelete(initial.id)} disabled={isDeleting}
                  className="flex-1 bg-destructive text-destructive-foreground rounded-lg px-4 py-2.5 text-sm font-medium min-h-[44px] disabled:opacity-50 touch-manipulation">
                  {isDeleting ? 'Deleting…' : 'Confirm delete'}
                </button>
                <button type="button" onClick={() => setConfirmDelete(false)}
                  className="flex-1 border rounded-lg px-4 py-2.5 text-sm min-h-[44px] touch-manipulation">
                  Cancel
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirmDelete(true)}
                className="w-full text-destructive text-sm font-medium py-2 min-h-[44px] hover:bg-destructive/5 rounded-lg flex items-center justify-center gap-1.5 touch-manipulation">
                <Trash2 className="w-3.5 h-3.5" /> Delete this expense
              </button>
            )
          )}
        </div>
      </div>
    </div>
  )
}

export default function MobileExpenses() {
  const api = useApi()
  const qc = useQueryClient()

  const [venueId, setVenueId] = useState('')
  const [date, setDate] = useState(todayStr())
  const [modalTarget, setModalTarget] = useState(null) // 'new' | expense row | null

  const { data: venues = [] } = useQuery({
    queryKey: ['venues'],
    queryFn: () => api.get('/venues'),
  })
  useEffect(() => {
    if (!venueId && venues.length) setVenueId(venues[0].id)
  }, [venues, venueId])

  const { data: config } = useQuery({
    queryKey: ['cash-recon-config', venueId],
    queryFn: () => api.get(`/venues/${venueId}/cash-recon/config`),
    enabled: !!venueId,
  })

  const { data: daily } = useQuery({
    queryKey: ['cash-recon-daily', venueId, date],
    queryFn: () => api.get(`/venues/${venueId}/cash-recon/daily/${date}`),
    enabled: !!venueId,
  })

  const categories = (config?.expense_categories ?? []).filter(c => c.is_active)
  const catById = Object.fromEntries((config?.expense_categories ?? []).map(c => [c.id, c]))
  const expenses = daily?.expenses ?? []
  const total = expenses.reduce((s, e) => s + Number(e.amount || 0), 0)
  const isSubmitted = daily?.status === 'submitted'

  const invalidate = () => qc.invalidateQueries({ queryKey: ['cash-recon-daily', venueId, date] })

  const createExpense = useMutation({
    mutationFn: async ({ body, photoFile }) => {
      const created = await api.post(`/venues/${venueId}/cash-recon/expenses`, { ...body, date })
      if (photoFile) {
        try { await api.upload(`/venues/${venueId}/cash-recon/expenses/${created.id}/receipt`, photoFile) } catch {}
      }
      return created
    },
    onSuccess: () => { invalidate(); setModalTarget(null) },
  })
  const updateExpense = useMutation({
    mutationFn: async ({ id, body, photoFile }) => {
      const updated = await api.put(`/venues/${venueId}/cash-recon/expenses/${id}`, body)
      if (photoFile) {
        try { await api.upload(`/venues/${venueId}/cash-recon/expenses/${id}/receipt`, photoFile) } catch {}
      }
      return updated
    },
    onSuccess: () => { invalidate(); setModalTarget(null) },
  })
  const deleteExpense = useMutation({
    mutationFn: id => api.delete(`/venues/${venueId}/cash-recon/expenses/${id}`),
    onSuccess: () => { invalidate(); setModalTarget(null) },
  })

  return (
    <div className="p-3 pb-8 space-y-3">
      {venues.length > 0 && (
        <select value={venueId} onChange={e => setVenueId(e.target.value)}
          className="w-full border rounded-lg px-3 py-2 text-sm bg-background min-h-[44px] touch-manipulation">
          {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      )}

      <div className="relative">
        <button type="button" className="w-full px-3 py-2.5 text-sm font-medium rounded-lg border touch-manipulation text-center">
          {date === todayStr() ? 'Today' : format(new Date(date + 'T12:00:00'), 'EEE d MMM yyyy')}
        </button>
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          className="absolute inset-0 opacity-0 cursor-pointer w-full" />
      </div>

      <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
        <span className="text-sm font-medium">Total for this day</span>
        <span className="text-sm font-semibold">{fmt(total)}</span>
      </div>

      {isSubmitted && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          This day's report is already submitted. Unsubmit it on the desktop Cash Reconciliation page to add or change expenses.
        </p>
      )}

      {expenses.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">No expenses logged for this day.</p>
      ) : (
        <div className="space-y-2">
          {expenses.map(exp => {
            const cat = exp.category_id ? catById[exp.category_id] : null
            return (
              <button key={exp.id} type="button" onClick={() => setModalTarget(exp)}
                className="w-full flex items-center gap-3 border rounded-lg px-3 py-2.5 text-left bg-background hover:bg-accent touch-manipulation min-h-[56px]">
                {exp.receipt_url ? (
                  <img src={exp.receipt_url} alt="" className="w-10 h-10 rounded object-cover shrink-0" />
                ) : (
                  <span className="w-10 h-10 rounded bg-muted flex items-center justify-center shrink-0 text-muted-foreground">
                    <Receipt className="w-4 h-4" />
                  </span>
                )}
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium truncate">{exp.description}</span>
                  {cat && <span className="block text-xs text-muted-foreground truncate">{cat.name}</span>}
                </span>
                <span className="text-sm font-semibold shrink-0">{fmt(exp.amount)}</span>
              </button>
            )
          })}
        </div>
      )}

      {!isSubmitted && (
        <button type="button" onClick={() => setModalTarget('new')}
          className="w-full inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground rounded-lg px-4 py-2.5 text-sm font-medium min-h-[48px] touch-manipulation">
          <Plus className="w-4 h-4" /> Add expense
        </button>
      )}

      {modalTarget && venueId && (
        <ExpenseModal
          venueId={venueId}
          date={date}
          categories={categories}
          initial={modalTarget === 'new' ? null : modalTarget}
          onClose={() => setModalTarget(null)}
          onSave={(body, photoFile) => modalTarget === 'new'
            ? createExpense.mutate({ body, photoFile })
            : updateExpense.mutate({ id: modalTarget.id, body, photoFile })}
          onDelete={id => deleteExpense.mutate(id)}
          isSaving={createExpense.isPending || updateExpense.isPending}
          isDeleting={deleteExpense.isPending}
        />
      )}
    </div>
  )
}
