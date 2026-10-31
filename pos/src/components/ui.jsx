// Small building blocks for the till's screens: touch first, big targets.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { X, Delete, ShieldCheck } from 'lucide-react'
import { money } from '@shared/pos/pricing.js'
import { useTill, approverFor, can } from '../lib/store.js'

export { money }

export function cx(...parts) { return parts.filter(Boolean).join(' ') }

export function Modal({ title, onClose, children, footer, wide = false, full = false }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && onClose) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3" onPointerDown={e => { if (e.target === e.currentTarget && onClose) onClose() }}>
      <div className={cx('bg-white rounded-2xl shadow-xl flex flex-col max-h-[92vh] w-full',
        full ? 'max-w-[1200px] h-[92vh]' : wide ? 'max-w-3xl' : 'max-w-md')}>
        {title !== undefined && (
          <div className="flex items-center gap-3 px-5 h-16 border-b border-line shrink-0">
            <div className="text-lg font-bold flex-1 min-w-0 truncate">{title}</div>
            {onClose && (
              <button className="btn btn-ghost w-12 px-0" onClick={onClose} aria-label="Close"><X size={22} /></button>
            )}
          </div>
        )}
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
        {footer && <div className="shrink-0 border-t border-line p-4 flex gap-3 justify-end flex-wrap">{footer}</div>}
      </div>
    </div>
  )
}

/**
 * Digits keypad. value is a string; onChange gets the new string. A number
 * (an amount, covers) drops a lone leading 0 when the next digit comes; a
 * code (a PIN) keeps every digit as typed, so 0482 stays 0482.
 */
export function Keypad({ value, onChange, decimal = false, max = 8, big = false, code = false }) {
  const press = k => {
    if (k === 'del') return onChange(value.slice(0, -1))
    if (k === 'clear') return onChange('')
    if (k === '.' && (!decimal || value.includes('.'))) return
    if (decimal && value.includes('.') && value.split('.')[1].length >= 2) return
    if (value.replace('.', '').length >= max) return
    onChange(!code && value === '0' && k !== '.' ? k : value + k)
  }
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', decimal ? '.' : 'clear', '0', 'del']
  return (
    <div className="grid grid-cols-3 gap-2">
      {keys.map(k => (
        <button key={k} type="button" onClick={() => press(k)}
          className={cx('btn text-2xl font-bold', big ? 'h-20' : 'h-16')}>
          {k === 'del' ? <Delete size={24} /> : k === 'clear' ? <span className="text-base">Clear</span> : k}
        </button>
      ))}
    </div>
  )
}

// Letters for a name (the order prompt, a tab's name): a capital at the
// start of each word and small letters after, as names are written; Shift
// turns the next letter the other way (MacDonald). Digits for "Party of 12".
const KEY_ROWS = ['1234567890', 'QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM']

/** Letters keyboard. value is the text; onChange gets the new text. */
export function Keyboard({ value, onChange, max = 80 }) {
  const [shift, setShift] = useState(false)
  // Capitals now: at the start of a word, unless Shift says otherwise.
  const caps = (!value || /[\s\-']$/.test(value)) !== shift
  const type = ch => {
    if (value.length >= max) return
    setShift(false)
    onChange(value + (/[A-Z]/.test(ch) && !caps ? ch.toLowerCase() : ch))
  }
  const space = () => { if (value && !/\s$/.test(value) && value.length < max) onChange(value + ' ') }
  return (
    <div className="space-y-2 select-none" data-testid="keyboard">
      {KEY_ROWS.map((row, i) => (
        <div key={row} className={cx('flex gap-1.5 justify-center', i === 2 && 'px-[4.5%]', i === 3 && 'px-[9%]')}>
          {[...row].map(k => (
            <button key={k} type="button" className={cx('btn flex-1 min-w-0 px-0 text-xl', i === 0 ? 'h-12 text-lg' : 'h-14')} data-key={k}
              onClick={() => type(k)}>
              {/[A-Z]/.test(k) && !caps ? k.toLowerCase() : k}
            </button>
          ))}
        </div>
      ))}
      <div className="flex gap-1.5">
        <button type="button" className={cx('btn h-14 px-3 basis-[14%]', shift && 'btn-primary')} aria-pressed={shift} data-key="shift" onClick={() => setShift(v => !v)}>Shift</button>
        <button type="button" className="btn h-14 px-0 basis-[8%] text-xl" data-key="'" onClick={() => type("'")}>'</button>
        <button type="button" className="btn h-14 px-0 basis-[8%] text-xl" data-key="-" onClick={() => type('-')}>-</button>
        <button type="button" className="btn h-14 flex-1" data-key="space" onClick={space}>Space</button>
        <button type="button" className="btn h-14 px-3 basis-[12%]" data-key="clear" onClick={() => { setShift(false); onChange('') }}>Clear</button>
        <button type="button" className="btn h-14 px-3 basis-[12%]" data-key="del" aria-label="Delete" onClick={() => onChange(value.slice(0, -1))}><Delete size={22} /></button>
      </div>
    </div>
  )
}

/**
 * PIN entry: dots and a keypad. PINs are 4 to 6 digits (a leading 0 counts),
 * so it tries quietly at 4 and 5 digits and says the outcome at 6 or on OK.
 * onSubmit(pin, { final }) resolves to { ok, error }; final = OK or 6 digits.
 */
export function PinPad({ onSubmit }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const tried = useRef('')
  // A try at 4 or 5 digits is quiet (the PIN may be longer): no "Checking",
  // no message, nothing cleared.
  const attempt = async (value, final) => {
    final = final || value.length >= 6
    if (final) setBusy(true)
    let r, say = final
    try { r = await onSubmit(value, { final }) } catch (err) { r = { ok: false, error: err?.message || 'Couldn\'t check the PIN' }; say = true }
    if (final) setBusy(false)
    if (r?.ok) { setPin(''); return }
    if (say) { setError(r?.error || 'PIN not recognised'); setPin('') }
  }
  useEffect(() => {
    if (pin.length >= 4 && pin !== tried.current) { tried.current = pin; attempt(pin, false) }
  }, [pin]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="w-full max-w-xs mx-auto">
      <div className="flex justify-center gap-3 h-8 mb-1">
        {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => (
          <div key={i} className={cx('w-4 h-4 rounded-full mt-2', i < pin.length ? 'bg-ink' : 'bg-line')} />
        ))}
      </div>
      <div className={cx('text-center text-sm h-6', error ? 'text-bad font-semibold' : 'text-muted')} data-testid="pin-note">{busy ? 'Checking…' : error || '4 to 6 digits'}</div>
      <Keypad value={pin} onChange={v => { tried.current = ''; setError(null); setPin(v) }} max={6} big code />
      <button className="btn btn-primary w-full mt-2 h-14" disabled={pin.length < 4 || busy} onClick={() => attempt(pin, true)}>OK</button>
    </div>
  )
}

// ── Manager approval ─────────────────────────────────────────────

const ApprovalContext = createContext(null)

/**
 * Wrap the app. useApproval()(key, amount, label, actions) resolves to null
 * when the signed-in person may do it, the approver's staff id after a
 * manager types their PIN, or false when cancelled. key: the role permission
 * it needs (null = none); actions: the venue's "needs a manager" switches it
 * falls under (shared/pos/permissions.js MANAGER_ACTIONS).
 */
export function ApprovalProvider({ children }) {
  const [ask, setAsk] = useState(null)
  const request = useCallback((key, amount = null, label = '', actions = []) => {
    if (can(key, amount, actions)) return Promise.resolve(null)
    return new Promise(resolve => setAsk({ key, amount, label, actions, resolve }))
  }, [])
  return (
    <ApprovalContext.Provider value={request}>
      {children}
      {ask && <ApprovalModal ask={ask} onDone={v => { ask.resolve(v); setAsk(null) }} />}
    </ApprovalContext.Provider>
  )
}
export const useApproval = () => useContext(ApprovalContext)

function ApprovalModal({ ask, onDone }) {
  const submit = async (pin, opts) => {
    const r = await approverFor(pin, ask.key, ask.amount, ask.actions, opts)
    if (r.ok) onDone(r.staff.id)
    return r
  }
  return (
    <Modal title="Manager needed" onClose={() => onDone(false)}>
      <div className="flex items-start gap-3 mb-4 rounded-xl bg-warn-soft p-3 text-sm">
        <ShieldCheck className="text-warn shrink-0" size={20} />
        <div>{ask.label || 'Your role doesn\'t allow this.'} A manager can type their PIN to allow it.</div>
      </div>
      <PinPad onSubmit={submit} />
    </Modal>
  )
}

export function Toasts() {
  const { toasts } = useTill()
  if (!toasts.length) return null
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] flex flex-col gap-2 items-center pointer-events-none">
      {toasts.map(t => (
        <div key={t.id} className={cx('rounded-xl px-4 py-3 shadow-lg text-[15px] font-semibold max-w-[90vw] flex items-center gap-4',
          t.kind === 'bad' ? 'bg-bad text-white' : t.kind === 'ok' ? 'bg-ok text-white' : 'bg-ink text-white')}>
          <span>{t.text}</span>
          {t.action && (
            <button className="pointer-events-auto rounded-lg border border-white/60 px-3 min-h-[40px] font-bold touch-manipulation" data-testid="toast-action" onClick={t.action.run}>{t.action.label}</button>
          )}
        </div>
      ))}
    </div>
  )
}

/** A number of pence typed as pounds: "12.50" -> 1250. */
export function poundsToPence(s) {
  const n = Number(String(s || '').trim())
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

export function minutesSince(iso) {
  if (!iso) return 0
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000))
}

export function elapsed(iso) {
  const m = minutesSince(iso)
  return m < 60 ? m + 'm' : Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0')
}

/** Re-render every `ms` (clocks, minutes on tables). */
export function useTick(ms = 30000) {
  const [, set] = useState(0)
  useEffect(() => { const t = setInterval(() => set(x => x + 1), ms); return () => clearInterval(t) }, [ms])
}

/** Ask for a reason: quick picks plus typing. */
export function ReasonPicker({ options, value, onChange }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {options.map(o => (
          <button key={o} className={cx('chip', value === o && 'chip-on')} onClick={() => onChange(o)}>{o}</button>
        ))}
      </div>
      <input className="input" placeholder="Or type a reason" value={options.includes(value) ? '' : value} onChange={e => onChange(e.target.value)} />
    </div>
  )
}
