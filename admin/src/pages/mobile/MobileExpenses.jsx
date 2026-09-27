// src/pages/mobile/MobileExpenses.jsx
//
// Phone-first petty cash page: a week (Mon-Sun) of expenses with week to
// week navigation, each day's list, and add / edit (with a receipt photo)
// per day. Reuses the same API endpoints as CashRecon.jsx's ExpensesSection
// (POST/PUT/DELETE .../cash-recon/expenses[/:id][/receipt]) and reads the
// week from week-detail through useReconWeek(), the same data the Cash
// Dashboard's widgets use. PettyCashPanel (one day) is kept for the Cash
// Dashboard's petty cash widget.

import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format, addDays, parseISO } from 'date-fns'
import { Plus, X, Camera, Trash2, Receipt, ChevronLeft, ChevronRight, Lock } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { PaidByCardToggle, CardBadge, useReconWeek, getMonday } from '@/pages/CashRecon'

function todayStr() {
  return format(new Date(), 'yyyy-MM-dd')
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
  const [paidByCard, setPaidByCard] = useState(!!initial?.paid_by_card)
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

          <PaidByCardToggle checked={paidByCard} onChange={setPaidByCard} />

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
            onClick={() => onSave({ description: description.trim(), category_id: categoryId, amount: Number(amount) || 0, vat_amount: Number(vatAmount) || 0, paid_by_card: paidByCard, notes: notes.trim() || null }, photo?.file)}
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

// Create / update / delete for any day of a venue. Refreshes the day query
// (PettyCashPanel) and week-detail (the week list, week grid and dashboard
// balance widgets).
function useExpenseActions(venueId, onDone) {
  const api = useApi()
  const qc = useQueryClient()
  const invalidate = date => {
    qc.invalidateQueries({ queryKey: ['cash-recon-daily', venueId, date] })
    qc.invalidateQueries({ queryKey: ['cash-recon-week-detail', venueId] })
  }
  const upload = async (id, photoFile) => {
    if (!photoFile) return
    try { await api.upload(`/venues/${venueId}/cash-recon/expenses/${id}/receipt`, photoFile) } catch {}
  }
  const create = useMutation({
    mutationFn: async ({ date, body, photoFile }) => {
      const created = await api.post(`/venues/${venueId}/cash-recon/expenses`, { ...body, date })
      await upload(created.id, photoFile)
      return created
    },
    onSuccess: (_, v) => { invalidate(v.date); onDone() },
  })
  const update = useMutation({
    mutationFn: async ({ id, body, photoFile }) => {
      const updated = await api.put(`/venues/${venueId}/cash-recon/expenses/${id}`, body)
      await upload(id, photoFile)
      return updated
    },
    onSuccess: (_, v) => { invalidate(v.date); onDone() },
  })
  const remove = useMutation({
    mutationFn: ({ id }) => api.delete(`/venues/${venueId}/cash-recon/expenses/${id}`),
    onSuccess: (_, v) => { invalidate(v.date); onDone() },
  })
  return { create, update, remove, error: create.error || update.error || remove.error }
}

// Opens ExpenseModal for `target` ({ date, expense | null }) and saves it.
function ExpenseEditor({ venueId, categories, target, onClose, actions }) {
  if (!target) return null
  const { date, expense } = target
  return (
    <ExpenseModal
      venueId={venueId}
      date={date}
      categories={categories}
      initial={expense}
      onClose={onClose}
      onSave={(body, photoFile) => expense
        ? actions.update.mutate({ id: expense.id, date, body, photoFile })
        : actions.create.mutate({ date, body, photoFile })}
      onDelete={id => actions.remove.mutate({ id, date })}
      isSaving={actions.create.isPending || actions.update.isPending}
      isDeleting={actions.remove.isPending}
    />
  )
}

function ExpenseRow({ exp, cat, onClick }) {
  const body = (
    <>
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
        {exp.paid_by_card && <span className="block mt-0.5"><CardBadge /></span>}
      </span>
      <span className="text-right shrink-0">
        <span className="block text-sm font-semibold">{fmt(exp.amount)}</span>
        {Number(exp.vat_amount) > 0 && <span className="block text-[11px] text-muted-foreground">VAT {fmt(exp.vat_amount)}</span>}
      </span>
    </>
  )
  const cls = 'w-full flex items-center gap-3 border rounded-lg px-3 py-2.5 text-left bg-background min-h-[56px]'
  return onClick
    ? <button type="button" onClick={onClick} className={cn(cls, 'hover:bg-accent touch-manipulation')}>{body}</button>
    : <div className={cls}>{body}</div>
}

// One venue + date: day totals, expense list, add / edit. Exported so the
// Cash Recon Dashboard's petty cash widget renders exactly the same panel.
export function PettyCashPanel({ venueId, date }) {
  const api = useApi()
  const [target, setTarget] = useState(null) // { date, expense | null }
  const actions = useExpenseActions(venueId, () => setTarget(null))

  const { data: config } = useQuery({
    queryKey: ['cash-recon-config', venueId],
    queryFn: () => api.get(`/venues/${venueId}/cash-recon/config`),
    enabled: !!venueId,
  })

  const { data: daily } = useQuery({
    queryKey: ['cash-recon-daily', venueId, date],
    queryFn: () => api.get(`/venues/${venueId}/cash-recon/daily/${date}`),
    enabled: !!venueId && !!date,
  })

  const categories = (config?.expense_categories ?? []).filter(c => c.is_active)
  const catById = Object.fromEntries((config?.expense_categories ?? []).map(c => [c.id, c]))
  const expenses = daily?.expenses ?? []
  // Card-paid expenses never left the till, so they don't count toward the
  // cash total (same rule as CashRecon.jsx's day view).
  const total     = expenses.filter(e => !e.paid_by_card).reduce((s, e) => s + Number(e.amount || 0), 0)
  const cardTotal = expenses.filter(e =>  e.paid_by_card).reduce((s, e) => s + Number(e.amount || 0), 0)
  const isSubmitted = daily?.status === 'submitted'

  return (
    <div className="space-y-3">
      <div className="rounded-lg border px-3 py-2.5 space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Cash total for this day</span>
          <span className="text-sm font-semibold">{fmt(total)}</span>
        </div>
        {cardTotal > 0 && (
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs">Paid by card (not in recon)</span>
            <span className="text-xs font-medium">{fmt(cardTotal)}</span>
          </div>
        )}
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
          {expenses.map(exp => (
            <ExpenseRow key={exp.id} exp={exp} cat={exp.category_id ? catById[exp.category_id] : null}
              onClick={() => setTarget({ date, expense: exp })} />
          ))}
        </div>
      )}

      {!isSubmitted && (
        <button type="button" onClick={() => setTarget({ date, expense: null })}
          className="w-full inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground rounded-lg px-4 py-2.5 text-sm font-medium min-h-[48px] touch-manipulation">
          <Plus className="w-4 h-4" /> Add expense
        </button>
      )}

      <ExpenseEditor venueId={venueId} categories={categories} target={target} onClose={() => setTarget(null)} actions={actions} />
    </div>
  )
}

// The whole week (Mon-Sun) for one venue: week totals, then each day's
// expenses with its own Add button. Submitted days are read-only.
function WeekExpensesPanel({ venueId, weekStart }) {
  const [target, setTarget] = useState(null)
  const actions = useExpenseActions(venueId, () => setTarget(null))
  const { config, detail, isLoading } = useReconWeek(venueId, weekStart)

  const categories = (config?.expense_categories ?? []).filter(c => c.is_active)
  const catById = Object.fromEntries((config?.expense_categories ?? []).map(c => [c.id, c]))
  const today = todayStr()
  const dates = detail?.dates ?? Array.from({ length: 7 }, (_, i) => format(addDays(parseISO(weekStart), i), 'yyyy-MM-dd'))
  const open = Array.isArray(detail?.open_dates) ? new Set(detail.open_dates) : null
  const all = dates.flatMap(d => detail?.days?.[d]?.expenses ?? [])
  const sum = rows => rows.reduce((s, e) => s + Number(e.amount || 0), 0)
  const cashTotal = sum(all.filter(e => !e.paid_by_card))
  const cardTotal = sum(all.filter(e => e.paid_by_card))
  const vatTotal  = all.reduce((s, e) => s + Number(e.vat_amount || 0), 0)

  if (isLoading && !detail) return <p className="text-sm text-muted-foreground py-8 text-center">Loading…</p>

  return (
    <div className="space-y-3">
      <div className="rounded-lg border px-3 py-2.5 space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Cash total for the week</span>
          <span className="text-sm font-semibold">{fmt(cashTotal)}</span>
        </div>
        {cardTotal > 0 && (
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs">Paid by card (not in recon)</span>
            <span className="text-xs font-medium">{fmt(cardTotal)}</span>
          </div>
        )}
        {vatTotal > 0 && (
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs">VAT included</span>
            <span className="text-xs font-medium">{fmt(vatTotal)}</span>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">{all.length} expense{all.length === 1 ? '' : 's'} this week</p>
      </div>

      {dates.map(date => {
        const day = detail?.days?.[date]
        const expenses = day?.expenses ?? []
        const submitted = day?.status === 'submitted'
        const closed = open && !open.has(date)
        const dayCash = sum(expenses.filter(e => !e.paid_by_card))
        return (
          <section key={date} className={cn('rounded-xl border overflow-hidden', date === today && 'border-primary')}>
            <div className="flex items-center gap-2 px-3 py-2 bg-muted/40 border-b">
              <span className="flex-1 min-w-0">
                <span className="text-sm font-semibold">{format(parseISO(date), 'EEE d MMM')}</span>
                {date === today && <span className="ml-1.5 text-[11px] text-primary font-medium">Today</span>}
                {closed && <span className="ml-1.5 text-[11px] text-muted-foreground">Closed</span>}
                {submitted && (
                  <span className="ml-1.5 inline-flex items-center gap-0.5 text-[11px] text-amber-700">
                    <Lock className="w-3 h-3" /> Submitted
                  </span>
                )}
              </span>
              <span className="text-sm font-semibold tabular-nums">{expenses.length ? fmt(dayCash) : ''}</span>
              {!submitted && (
                <button type="button" onClick={() => setTarget({ date, expense: null })}
                  aria-label={`Add expense on ${format(parseISO(date), 'EEEE d MMMM')}`}
                  className="h-11 px-3 rounded-lg border bg-background text-sm font-medium inline-flex items-center gap-1 touch-manipulation hover:bg-muted">
                  <Plus className="w-4 h-4" /> Add
                </button>
              )}
            </div>
            {expenses.length > 0 && (
              <div className="p-2 space-y-2">
                {expenses.map(exp => (
                  <ExpenseRow key={exp.id} exp={exp} cat={exp.category_id ? catById[exp.category_id] : null}
                    onClick={submitted ? null : () => setTarget({ date, expense: exp })} />
                ))}
              </div>
            )}
          </section>
        )
      })}

      {dates.some(d => detail?.days?.[d]?.status === 'submitted') && (
        <p className="text-xs text-muted-foreground">
          Submitted days are locked. Unsubmit them on the desktop Cash Reconciliation page to add or change expenses.
        </p>
      )}
      {actions.error && <p className="text-xs text-red-700">{actions.error.message || 'Could not save'}</p>}

      <ExpenseEditor venueId={venueId} categories={categories} target={target} onClose={() => setTarget(null)} actions={actions} />
    </div>
  )
}

export default function MobileExpenses() {
  const api = useApi()

  const [venueId, setVenueId] = useState('')
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()))
  const thisWeek = getMonday(new Date())
  const shift = n => setWeekStart(w => format(addDays(parseISO(w), n * 7), 'yyyy-MM-dd'))
  const weekEnd = format(addDays(parseISO(weekStart), 6), 'yyyy-MM-dd')

  const { data: venues = [] } = useQuery({
    queryKey: ['venues'],
    queryFn: () => api.get('/venues'),
  })
  useEffect(() => {
    if (!venueId && venues.length) setVenueId(venues[0].id)
  }, [venues, venueId])

  const label = `${format(parseISO(weekStart), 'd MMM')} – ${format(parseISO(weekEnd), 'd MMM yyyy')}`

  return (
    <div className="p-3 pb-8 space-y-3">
      {venues.length > 0 && (
        <select value={venueId} onChange={e => setVenueId(e.target.value)}
          className="w-full border rounded-lg px-3 py-2 text-sm bg-background min-h-[44px] touch-manipulation">
          {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      )}

      <div className="flex items-center gap-2">
        <button type="button" onClick={() => shift(-1)} aria-label="Previous week"
          className="h-11 w-11 shrink-0 rounded-lg border flex items-center justify-center touch-manipulation hover:bg-muted">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="relative flex-1 min-w-0">
          <button type="button" className="w-full h-11 px-3 text-sm font-medium rounded-lg border touch-manipulation text-center truncate">
            {weekStart === thisWeek ? `This week · ${label}` : label}
          </button>
          <input type="date" value={weekStart} aria-label="Jump to a week"
            onChange={e => e.target.value && setWeekStart(getMonday(parseISO(e.target.value)))}
            className="absolute inset-0 opacity-0 cursor-pointer w-full" />
        </div>
        <button type="button" onClick={() => shift(1)} aria-label="Next week"
          className="h-11 w-11 shrink-0 rounded-lg border flex items-center justify-center touch-manipulation hover:bg-muted">
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
      {weekStart !== thisWeek && (
        <button type="button" onClick={() => setWeekStart(thisWeek)}
          className="w-full h-10 rounded-lg text-sm text-primary font-medium touch-manipulation hover:bg-muted">
          Back to this week
        </button>
      )}

      {venueId && <WeekExpensesPanel venueId={venueId} weekStart={weekStart} />}
    </div>
  )
}
