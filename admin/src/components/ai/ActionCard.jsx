// src/components/ai/ActionCard.jsx
//
// Pepper's Confirm card (migration 148; by class since Pepper-first step 4b).
// Built by the server from the tool's own describe(), never from the model's
// words. What it asks of the person follows the change's class (the tool's,
// raised for a call that touches allergens):
//   reversible, consequential   one tap on Confirm
//   destructive                 the card's word typed in (a guest's surname,
//                               else CONFIRM) before Confirm is on, and never
//                               a spoken yes (the server refuses one too)
// A done reversible change shows Undo until undo_until (10 minutes); Undo
// runs straight away, with no card of its own, and the card says Undone.
// `before` / `after` show the record as it is and as it will be; `fields`
// are the inputs the tool lets the person change on the card (a time, a
// party size, a note). Changed values go with Confirm and the server checks
// them with the tool's own rules before anything runs.
import { useEffect, useMemo, useState } from 'react'
import { Loader2, Check, X, CircleAlert, Pencil, Undo2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ASSISTANT_NAME } from '@shared/assistant.js'

const STATUS_TEXT = {
  done:      'Done',
  cancelled: 'Cancelled, nothing changed',
  expired:   'Expired, nothing changed',
  failed:    'Didn\'t go through',
  undone:    'Undone, back as it was',
}

const sameWord = (a, b) => String(a ?? '').replace(/\s+/g, ' ').trim().toLowerCase() === String(b ?? '').replace(/\s+/g, ' ').trim().toLowerCase()

/** The card's before and after lines: "Now" beside "After" (stacked when narrow). */
export function BeforeAfter({ before, after, className }) {
  if (!before?.length && !after?.length) return null
  return (
    <div className={cn('grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm', className)} data-testid="card-before-after">
      {before?.length > 0 && (
        <div className="rounded-md border bg-muted/30 px-2.5 py-1.5" data-testid="card-before">
          <div className="text-xs font-medium text-muted-foreground">Now</div>
          {before.map((l, i) => <div key={i} className="break-words">{l}</div>)}
        </div>
      )}
      {after?.length > 0 && (
        <div className="rounded-md border border-primary/40 bg-primary/5 px-2.5 py-1.5" data-testid="card-after">
          <div className="text-xs font-medium text-muted-foreground">After</div>
          {after.map((l, i) => <div key={i} className="break-words font-medium">{l}</div>)}
        </div>
      )}
    </div>
  )
}

/** One field the person may change on the card. Numbers go back as numbers. */
function CardField({ field, value, onChange, disabled }) {
  const id = 'card-field-' + field.key
  const common = {
    id, disabled, 'data-testid': id,
    className: 'w-full min-h-[44px] rounded-md border bg-background px-2.5 text-sm touch-manipulation disabled:opacity-50',
  }
  return (
    <label htmlFor={id} className="block text-sm">
      <span className="text-xs font-medium text-muted-foreground">{field.label}</span>
      {field.kind === 'note' ? (
        <textarea {...common} rows={2} className={cn(common.className, 'py-2')} value={value ?? ''} onChange={e => onChange(e.target.value)} />
      ) : field.kind === 'number' ? (
        <input {...common} type="number" inputMode="decimal" step="any" value={value ?? ''}
          onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))} />
      ) : field.kind === 'time' ? (
        <input {...common} type="time" value={value ?? ''} onChange={e => onChange(e.target.value || null)} />
      ) : (
        <input {...common} type="text" value={value ?? ''} onChange={e => onChange(e.target.value)} />
      )}
    </label>
  )
}

// While a turn is still running (`turnBusy`) its cards can't be answered
// yet: the server would say the chat is busy.
export default function ActionCard({ card, decide, busy: turnBusy = false }) {
  const busy = turnBusy || (decide.isPending && decide.variables?.id === card.id)
  const open = card.status === 'pending'
  const destructive = card.class === 'destructive'
  const fields = card.fields || []
  const start = useMemo(() => Object.fromEntries(fields.map(f => [f.key, f.value ?? null])), [card.id, JSON.stringify(fields)])   // eslint-disable-line react-hooks/exhaustive-deps
  const [values, setValues] = useState(start)
  const [editing, setEditing] = useState(false)
  const [word, setWord] = useState('')
  // Undo (step 4d): offered until the server's undo_until; the button goes at that time.
  const undoAt = card.undo_until ? new Date(card.undo_until).getTime() : 0
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const ms = undoAt - Date.now()
    if (ms <= 0) return undefined
    const t = setTimeout(() => setNow(Date.now()), Math.min(ms + 500, 2 ** 31 - 1))
    return () => clearTimeout(t)
  }, [undoAt])
  const canUndo = card.status === 'done' && undoAt > now
  const untilText = undoAt ? new Date(undoAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
  useEffect(() => { setValues(start) }, [start])
  const changed = Object.fromEntries(Object.entries(values).filter(([k, v]) => JSON.stringify(v ?? null) !== JSON.stringify(start[k] ?? null)))
  const wordOk = !destructive || sameWord(word, card.confirm_word)
  const confirm = () => decide.mutate({
    id: card.id, how: 'confirm',
    ...(destructive ? { word } : {}),
    ...(Object.keys(changed).length ? { values: changed } : {}),
  })
  return (
    <div className={cn('rounded-lg border bg-background overflow-hidden', open && (destructive ? 'ring-2 ring-destructive/50' : 'ring-2 ring-primary/40'))}
      data-testid="action-card" data-class={card.class || undefined}>
      <div className="section-head px-3 py-2 text-sm font-semibold">{card.title}</div>
      <div className="px-3 py-2 text-sm space-y-0.5">
        {(card.lines || []).map((l, i) => <div key={i} className={i === 0 ? 'font-medium' : ''}>{l}</div>)}
      </div>
      <BeforeAfter before={card.before} after={card.after} className="px-3 pb-2" />
      {card.warnings?.length > 0 && (
        <div className="mx-3 mb-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 flex items-start gap-2">
          <CircleAlert className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <div className="font-medium">{card.warningTitle || 'Check before confirming'}</div>
            {card.warnings.map((w, i) => <div key={i}>{w}</div>)}
          </div>
        </div>
      )}
      {open && fields.length > 0 && (
        <div className="px-3 pb-2">
          {editing ? (
            <div className="space-y-2 rounded-md border bg-muted/20 p-2" data-testid="card-fields">
              {fields.map(f => (
                <CardField key={f.key} field={f} value={values[f.key]} disabled={busy}
                  onChange={v => setValues(old => ({ ...old, [f.key]: v }))} />
              ))}
              {Object.keys(changed).length > 0 && <div className="text-xs text-muted-foreground">Checked again when you confirm.</div>}
            </div>
          ) : (
            <button type="button" onClick={() => setEditing(true)} disabled={busy} data-testid="card-edit"
              className="min-h-[44px] px-3 rounded-md border text-sm flex items-center gap-2 touch-manipulation disabled:opacity-50">
              <Pencil className="w-4 h-4" /> Change {fields.map(f => f.label.toLowerCase()).join(', ')}
            </button>
          )}
        </div>
      )}
      {open && destructive && (
        <div className="px-3 pb-2">
          <label htmlFor={'card-word-' + card.id} className="block text-sm">
            <span className="text-xs font-medium text-destructive">
              This can't be undone by {ASSISTANT_NAME}: type <span className="font-mono font-semibold">{card.confirm_word}</span> to confirm
            </span>
            <input id={'card-word-' + card.id} data-testid="card-word" type="text" autoComplete="off" autoCapitalize="off" spellCheck={false}
              value={word} onChange={e => setWord(e.target.value)} disabled={busy}
              className="mt-1 w-full min-h-[44px] rounded-md border bg-background px-2.5 text-sm touch-manipulation disabled:opacity-50" />
          </label>
        </div>
      )}
      {open ? (
        <div className="flex gap-2 px-3 pb-3">
          <button type="button" disabled={busy || !wordOk} onClick={confirm} data-testid="card-confirm"
            className={cn('flex-1 min-h-[48px] rounded-md font-medium text-sm flex items-center justify-center gap-2 touch-manipulation disabled:opacity-50',
              destructive || card.destructive ? 'bg-destructive text-destructive-foreground' : 'bg-primary text-primary-foreground')}>
            {busy && decide.variables?.how === 'confirm' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {card.confirmLabel || 'Confirm'}
          </button>
          <button type="button" disabled={busy}
            onClick={() => decide.mutate({ id: card.id, how: 'cancel' })}
            className="min-h-[48px] px-4 rounded-md border text-sm flex items-center gap-2 touch-manipulation disabled:opacity-50">
            <X className="w-4 h-4" /> Cancel
          </button>
        </div>
      ) : (
        <div className={cn('px-3 py-2 text-sm border-t flex flex-wrap items-center gap-x-3 gap-y-2',
          card.status === 'done' ? 'text-emerald-700 bg-emerald-50' : card.status === 'failed' ? 'text-destructive bg-destructive/10' : 'text-muted-foreground bg-muted/40')}
          data-testid="card-outcome">
          <div className="flex-1 min-w-[10rem]">
            <span className="font-medium">{STATUS_TEXT[card.status] || card.status}</span>
            {card.status !== 'undone' && card.result && <span>: {card.result}</span>}
            {card.error && <span>: {card.error}</span>}
            {card.undo_error && <div className="text-destructive">Undo didn't go through: {card.undo_error}</div>}
          </div>
          {canUndo && (
            <button type="button" disabled={busy} onClick={() => decide.mutate({ id: card.id, how: 'undo' })} data-testid="card-undo"
              className="min-h-[44px] px-4 rounded-md border border-emerald-700/40 bg-background text-emerald-800 text-sm font-medium flex items-center gap-2 touch-manipulation disabled:opacity-50">
              {busy && decide.variables?.how === 'undo' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Undo2 className="w-4 h-4" />}
              Undo <span className="text-xs font-normal text-muted-foreground">until {untilText}</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
