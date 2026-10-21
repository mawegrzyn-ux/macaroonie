// src/components/cashRecon/ReceiptRead.jsx
//
// "Read the receipt" for petty cash expenses (migration 197): take a photo of
// the receipt (or pick a photo or PDF), Pepper reads it
// (POST /api/ai/receipts/read) and the expense form fills itself with the
// description, amount, VAT, card or cash and the venue's category; the
// photo becomes the expense's receipt when it is saved. Nothing is saved by
// reading. Used by CashRecon.jsx's ExpensesSection and MobileExpenses.jsx's
// ExpenseModal.
//
//   <ReadReceiptButton venueId onRead={(fields, file) => ...} />
//   fields: { description, amount, vat_amount, paid_by_card, category_id,
//             date, merchant, notes } (null where the receipt didn't say)
//   applyReceipt(form, fields): the form's values with the read ones laid
//             over (empty ones left as they were).

import { useRef, useState } from 'react'
import { Loader2, ScanLine } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAiStatus } from '@/components/ai/ChatView'
import { prepareFile } from '@/components/ai/attachments'
import { fileToBase64 } from '@/components/purchasing/shared'
import { ASSISTANT_NAME } from '@shared/assistant.js'

const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,application/pdf,.pdf'
const errText = e => e?.body?.error || e?.message || 'Something went wrong'

export function ReadReceiptButton({ venueId, onRead, disabled, className }) {
  const api = useApi()
  const { data: ai } = useAiStatus()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const camRef = useRef(null)
  const fileRef = useRef(null)
  if (!ai?.can_chat) return null

  async function read(raw) {
    if (!raw) return
    setError(null)
    if (!/^image\//.test(raw.type) && raw.type !== 'application/pdf' && !/\.pdf$/i.test(raw.name)) { setError('Use a photo or a PDF of the receipt.'); return }
    setBusy(true)
    try {
      const file = await prepareFile(raw)
      const res = await api.post('/ai/receipts/read', { venue_id: venueId, file: { name: file.name, data: await fileToBase64(file) } })
      onRead(res, file)
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }
  const pick = e => { const f = e.target.files?.[0]; e.target.value = ''; read(f) }
  return (
    <div className={cn('space-y-1 relative', className)}>
      <input ref={camRef} type="file" accept="image/*" capture="environment" className="sr-only" onChange={pick} />
      <input ref={fileRef} type="file" accept={ACCEPT} className="sr-only" onChange={pick} data-testid="receipt-read-input" />
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy || disabled} onClick={() => camRef.current?.click()} data-testid="receipt-read"
          className="flex-1 min-w-[180px] h-11 px-3 rounded-xl border border-primary/40 bg-primary/5 text-sm font-medium text-primary touch-manipulation hover:bg-primary/10 disabled:opacity-50 inline-flex items-center justify-center gap-2">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanLine className="w-4 h-4" />}
          {busy ? `${ASSISTANT_NAME} is reading the receipt…` : `Photograph the receipt: ${ASSISTANT_NAME} fills this in`}
        </button>
        <button type="button" disabled={busy || disabled} onClick={() => fileRef.current?.click()}
          className="h-11 px-3 rounded-xl border text-sm text-muted-foreground touch-manipulation hover:bg-muted disabled:opacity-50">
          Choose a file
        </button>
      </div>
      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
    </div>
  )
}

/** The form's values with what was read laid over them (amounts as text, as the inputs keep them). */
export function applyReceipt(form, r) {
  return {
    ...form,
    ...(r.description ? { description: r.description } : {}),
    ...(r.amount != null ? { amount: String(r.amount) } : {}),
    ...(r.vat_amount != null ? { vat_amount: String(r.vat_amount) } : {}),
    ...(r.paid_by_card != null ? { paid_by_card: r.paid_by_card } : {}),
    ...(r.category_id ? { category_id: r.category_id } : {}),
  }
}

/** A line under the form: what Pepper noticed (a different date, an unclear total). */
export function ReceiptNote({ read, date }) {
  if (!read) return null
  const other = read.date && date && read.date !== date
  if (!other && !read.notes) return null
  return (
    <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2" data-testid="receipt-note">
      {other && <>The receipt is dated {format(parseISO(read.date), 'EEE d MMM yyyy')}. </>}
      {read.notes}
    </p>
  )
}
