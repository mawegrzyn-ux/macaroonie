// First start on a tablet: type the pairing code made in Till setup (a till,
// or a kitchen screen: the code decides which).
import { useState } from 'react'
import { MonitorSmartphone } from 'lucide-react'
import { pair } from '../lib/store.js'

export default function Pair() {
  const [code, setCode] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const submit = async e => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try { await pair(code) } catch (err) { setError(err.offline ? 'No connection: check the Wi-Fi and try again' : err.message) }
    setBusy(false)
  }
  return (
    <div className="h-full flex items-center justify-center p-6">
      <form onSubmit={submit} className="card p-8 w-full max-w-md space-y-5">
        <div className="flex items-center gap-3">
          <img src="/till-icon.svg" alt="" className="w-12 h-12" />
          <div>
            <div className="text-xl font-bold">Set up this device</div>
            <div className="text-sm text-muted">Macaroonie Till or kitchen screen</div>
          </div>
        </div>
        <ol className="text-[15px] space-y-2 list-decimal pl-5 text-ink">
          <li>In Macaroonie, open <b>Till setup</b>, then <b>Tills</b> (or <b>Kitchen screens</b>), and add this device.</li>
          <li>Type the code it shows here. The code works once, for 30 minutes.</li>
        </ol>
        <label className="block">
          <span className="label">Pairing code</span>
          <input className="input mt-1 text-2xl tracking-[0.3em] uppercase text-center font-bold" value={code}
            onChange={e => setCode(e.target.value.toUpperCase())} placeholder="ABCD-EFGH" autoCapitalize="characters"
            autoComplete="off" spellCheck={false} maxLength={12} />
        </label>
        {error && <div className="rounded-xl bg-bad-soft text-bad p-3 text-sm font-semibold">{error}</div>}
        <button className="btn btn-primary w-full h-14 text-lg" disabled={busy || code.replace(/[^A-Z0-9]/gi, '').length < 8}>
          <MonitorSmartphone size={20} /> {busy ? 'Pairing…' : 'Pair this device'}
        </button>
      </form>
    </div>
  )
}
