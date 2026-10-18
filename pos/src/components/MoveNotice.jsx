// Shown by a till, kitchen screen or kiosk paired on another device app's
// address (lib/appHost.js): one tap moves it to its own address, where it
// pairs by itself with a one-time code. Also the screen an old address shows
// once its device has moved away.
import { useEffect, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { addressFor, shortAddress, APP_NAMES } from '../lib/appHost.js'

const PLURAL = { terminal: 'Tills', kds: 'Kitchen screens', kiosk: 'Kiosks' }

/** A bar across the top: `onMove()` resolves { ok } or { ok: false, error }. */
export function MoveNotice({ kind, onMove, className = '' }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const to = addressFor(kind)
  if (!to) return null
  const move = async () => {
    setBusy(true)
    setError(null)
    const r = await onMove()
    if (!r?.ok) { setError(r?.error || 'The move didn\'t work'); setBusy(false) }
  }
  return (
    <div className={'flex flex-wrap items-center gap-3 px-4 py-2 bg-amber-300 text-amber-950 text-[15px] font-semibold ' + className} data-testid="move-notice">
      <span className="flex-1 min-w-[220px]">
        {PLURAL[kind]} have their own address now: <b>{shortAddress(to)}</b>. Move this {APP_NAMES[kind]} there (it stays paired).
        {error && <span className="block text-red-800">{error}</span>}
      </span>
      <button onClick={move} disabled={busy}
        className="inline-flex items-center gap-2 min-h-[48px] px-5 rounded-lg bg-amber-950 text-white font-bold touch-manipulation disabled:opacity-60" data-testid="move-now">
        {busy ? 'Moving…' : 'Move this ' + APP_NAMES[kind]} <ArrowRight size={18} />
      </button>
    </div>
  )
}

/** The old address after its device moved: opens the new one after a few seconds. */
export function MovedAway({ to, onStay }) {
  const [left, setLeft] = useState(5)
  useEffect(() => {
    const id = setInterval(() => setLeft(n => n - 1), 1000)
    return () => clearInterval(id)
  }, [])
  useEffect(() => { if (left <= 0) location.assign(to) }, [left, to])
  return (
    <div className="h-full flex items-center justify-center p-6">
      <div className="card p-8 w-full max-w-md space-y-4 text-center" data-testid="moved-away">
        <div className="text-xl font-bold">This device has moved</div>
        <div className="text-[15px]">It now opens at <b>{shortAddress(to)}</b>. Opening it in {Math.max(0, left)}…</div>
        <div className="text-sm text-muted">Set that address as the start page of this device&apos;s browser (or kiosk browser).</div>
        <a href={to} className="btn btn-primary w-full h-14 text-lg">Open {shortAddress(to)} <ArrowRight size={20} /></a>
        <button className="btn w-full" onClick={onStay}>Set up another device here</button>
      </div>
    </div>
  )
}
