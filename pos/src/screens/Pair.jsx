// First start on a device: type the pairing code made in Till setup. Each
// kind of device has its own address (lib/appHost.js): pos. for tills,
// kitchen. for kitchen screens, kiosk. for kiosks; a code for another kind
// is refused with a button to its address (carrying the code). A device
// moved here from another address brings its code and pairs by itself.
import { useEffect, useRef, useState } from 'react'
import { MonitorSmartphone, ArrowRight } from 'lucide-react'
import { pair, useTill } from '../lib/store.js'
import { HOST_APP, APP_NAMES, addressFor, shortAddress } from '../lib/appHost.js'

const TITLES = { terminal: 'Set up this till', kds: 'Set up this kitchen screen', kiosk: 'Set up this kiosk' }
const SECTIONS = { terminal: 'Tills', kds: 'Kitchen screens', kiosk: 'Kiosks' }

export default function Pair() {
  const s = useTill()
  const [code, setCode] = useState(s.pairCode || '')
  const [error, setError] = useState(null)
  const [elsewhere, setElsewhere] = useState(null)   // { kind, url } for a code made for another kind
  const [busy, setBusy] = useState(false)
  const submit = async (e, typed = code) => {
    e?.preventDefault()
    setBusy(true)
    setError(null)
    setElsewhere(null)
    try { await pair(typed) } catch (err) {
      setError(err.offline ? 'No connection: check the Wi-Fi and try again' : err.message)
      const d = err.code === 'wrong_address' && err.details?.[0]
      const url = d && addressFor(d.device_kind)
      if (url) setElsewhere({ kind: d.device_kind, url: url + '/#pair=' + encodeURIComponent(typed) })
    }
    setBusy(false)
  }
  // A code brought by a move is typed in by itself, once.
  const auto = useRef(false)
  useEffect(() => {
    if (s.pairCode && !auto.current) { auto.current = true; submit(null, s.pairCode) }
  }, [s.pairCode]) // eslint-disable-line react-hooks/exhaustive-deps

  const others = HOST_APP ? ['terminal', 'kds', 'kiosk'].filter(k => k !== HOST_APP) : []
  return (
    <div className="h-full flex items-center justify-center p-6 overflow-y-auto">
      <form onSubmit={submit} className="card p-8 w-full max-w-md space-y-5" data-testid="pair">
        <div className="flex items-center gap-3">
          <img src="/till-icon.svg" alt="" className="w-12 h-12" />
          <div>
            <div className="text-xl font-bold">{TITLES[HOST_APP] || 'Set up this device'}</div>
            <div className="text-sm text-muted">{HOST_APP ? 'Macaroonie ' + APP_NAMES[HOST_APP] : 'Macaroonie till, kitchen screen or kiosk'}</div>
          </div>
        </div>
        <ol className="text-[15px] space-y-2 list-decimal pl-5 text-ink">
          {HOST_APP
            ? <li>In Macaroonie, open <b>Till setup</b>, then <b>{SECTIONS[HOST_APP]}</b>, and add this {APP_NAMES[HOST_APP]} (or press Pairing code on one already there).</li>
            : <li>In Macaroonie, open <b>Till setup</b>, then <b>Tills</b> (or <b>Kitchen screens</b>, or <b>Kiosks</b>), and add this device.</li>}
          <li>Type the code it shows here. The code works once, for 30 minutes.</li>
        </ol>
        <label className="block">
          <span className="label">Pairing code</span>
          <input className="input mt-1 text-2xl tracking-[0.3em] uppercase text-center font-bold" value={code}
            onChange={e => setCode(e.target.value.toUpperCase())} placeholder="ABCD-EFGH" autoCapitalize="characters"
            autoComplete="off" spellCheck={false} maxLength={12} aria-label="Pairing code" />
        </label>
        {error && <div className="rounded-xl bg-bad-soft text-bad p-3 text-sm font-semibold" data-testid="pair-error">{error}</div>}
        {elsewhere && (
          <a href={elsewhere.url} className="btn btn-primary w-full h-14 text-lg" data-testid="pair-elsewhere">
            Open {shortAddress(addressFor(elsewhere.kind))} <ArrowRight size={20} />
          </a>
        )}
        <button className="btn btn-primary w-full h-14 text-lg" disabled={busy || code.replace(/[^A-Z0-9]/gi, '').length < 8}>
          <MonitorSmartphone size={20} /> {busy ? 'Pairing…' : 'Pair this device'}
        </button>
        {others.length > 0 && (
          <div className="text-sm text-muted" data-testid="pair-others">
            This is the {APP_NAMES[HOST_APP]} address. {others.map((k, i) => (
              <span key={k}>{i ? ' · ' : ''}{SECTIONS[k]}: <a className="underline font-semibold text-ink" href={addressFor(k)}>{shortAddress(addressFor(k))}</a></span>
            ))}
          </div>
        )}
      </form>
    </div>
  )
}
