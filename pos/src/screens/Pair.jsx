// First start on a device. The device shows a code of its own with a QR code
// to the installer app (installer.{root}, migration 184): someone signed in
// scans it with a phone (or types the code there, or in Till setup) and the
// device sets itself up. The other way is still here: type a pairing code
// made in Till setup. Each kind of device has its own address
// (lib/appHost.js): pos. for tills, kitchen. for kitchen screens, kiosk. for
// kiosks; a typed code for another kind is refused with a button to its
// address (carrying the code). A device moved here from another address
// brings its code and pairs by itself.
import { useEffect, useMemo, useRef, useState } from 'react'
import { MonitorSmartphone, ArrowRight, Keyboard, QrCode, RefreshCw } from 'lucide-react'
import { qrSvg } from '@shared/qr.js'
import { pair, requestLinkCode, checkLinkCode, useTill } from '../lib/store.js'
import { HOST_APP, APP_NAMES, addressFor, shortAddress } from '../lib/appHost.js'

const TITLES = { terminal: 'Set up this till', kds: 'Set up this kitchen screen', kiosk: 'Set up this kiosk' }
const SECTIONS = { terminal: 'Tills', kds: 'Kitchen screens', kiosk: 'Kiosks' }
const POLL_MS = 4000
const RETRY_MS = 10000

/**
 * The code this device shows: asked for on mount, checked every few seconds,
 * replaced when it runs out. When it is linked, checkLinkCode() sets the
 * device up and this screen goes away.
 */
function useLinkCode() {
  const [link, setLink] = useState(null)
  const [problem, setProblem] = useState(null)
  useEffect(() => {
    let stop = false
    let timer = null
    const later = (fn, ms) => { clearTimeout(timer); timer = setTimeout(fn, ms) }
    const fresh = async () => {
      try {
        const p = await requestLinkCode()
        if (stop) return
        setLink(p)
        setProblem(null)
        later(() => check(p), POLL_MS)
      } catch (err) {
        if (stop) return
        setProblem(err.offline ? 'No connection: check the Wi-Fi. Trying again…' : err.message)
        later(fresh, RETRY_MS)
      }
    }
    const check = async p => {
      try {
        const st = await checkLinkCode(p)
        if (stop || st === 'paired') return
        if (st === 'expired' || Date.parse(p.expires_at) - Date.now() < 5000) { fresh(); return }
        setProblem(null)
      } catch (err) {
        if (stop) return
        setProblem(err.offline ? 'No connection: check the Wi-Fi. Trying again…' : err.message)
      }
      later(() => check(p), POLL_MS)
    }
    fresh()
    return () => { stop = true; clearTimeout(timer) }
  }, [])
  return { link, problem }
}

function LinkPanel({ link, problem }) {
  const svg = useMemo(() => {
    if (!link?.link_url) return ''
    try { return qrSvg(link.link_url, { margin: 2, title: 'QR code: link this device' }) } catch { return '' }
  }, [link?.link_url])
  let host = ''
  try { host = link?.link_url ? new URL(link.link_url).host : '' } catch { host = '' }
  const left = link ? Math.max(1, Math.round((Date.parse(link.expires_at) - Date.now()) / 60000)) : null
  return (
    <section className="space-y-4" data-testid="link-panel" aria-live="polite">
      <div className="flex flex-col sm:flex-row items-center gap-6">
        <div className="w-56 h-56 shrink-0 rounded-2xl border border-line bg-white p-2 flex items-center justify-center" data-testid="link-qr">
          {svg
            ? <div className="w-full h-full [&>svg]:w-full [&>svg]:h-full" dangerouslySetInnerHTML={{ __html: svg }} />
            : <QrCode size={64} className="text-muted" />}
        </div>
        <div className="space-y-3 text-center sm:text-left min-w-0">
          <div className="label">Code for this {HOST_APP ? APP_NAMES[HOST_APP] : 'device'}</div>
          <div className="text-5xl font-extrabold tracking-[0.12em] tabular-nums" data-testid="link-code">
            {link?.code || '···-···'}
          </div>
          <ol className="text-[15px] space-y-1.5 list-decimal pl-5 text-left text-ink">
            <li>Scan the QR code with a phone signed in to Macaroonie{host ? <>, or open <b>{host}</b> and type the code</> : null}.</li>
            <li>Pick the venue and name it: this {HOST_APP ? APP_NAMES[HOST_APP] : 'device'} sets itself up.</li>
          </ol>
          <div className="text-sm text-muted flex items-center gap-2 justify-center sm:justify-start">
            <RefreshCw size={14} className={link ? 'animate-spin [animation-duration:3s]' : ''} />
            {link ? `Waiting to be linked · new code in about ${left} min` : 'Getting a code…'}
          </div>
        </div>
      </div>
      {problem && <div className="rounded-xl bg-bad-soft text-bad p-3 text-sm font-semibold" data-testid="link-error">{problem}</div>}
    </section>
  )
}

export default function Pair() {
  const s = useTill()
  const [code, setCode] = useState(s.pairCode || '')
  const [typing, setTyping] = useState(!!s.pairCode)
  const [error, setError] = useState(null)
  const [elsewhere, setElsewhere] = useState(null)   // { kind, url } for a code made for another kind
  const [busy, setBusy] = useState(false)
  const { link, problem } = useLinkCode()
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
    if (s.pairCode && !auto.current) { auto.current = true; setTyping(true); submit(null, s.pairCode) }
  }, [s.pairCode]) // eslint-disable-line react-hooks/exhaustive-deps

  const others = HOST_APP ? ['terminal', 'kds', 'kiosk'].filter(k => k !== HOST_APP) : []
  return (
    <div className="h-full flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
      <div className="card p-6 sm:p-8 w-full max-w-2xl space-y-6 my-auto" data-testid="pair">
        <div className="flex items-center gap-3">
          <img src="/till-icon.svg" alt="" className="w-12 h-12" />
          <div>
            <div className="text-xl font-bold">{TITLES[HOST_APP] || 'Set up this device'}</div>
            <div className="text-sm text-muted">{HOST_APP ? 'Macaroonie ' + APP_NAMES[HOST_APP] : 'Macaroonie till, kitchen screen or kiosk'}</div>
          </div>
        </div>

        <LinkPanel link={link} problem={problem} />

        <div className="border-t border-line pt-5">
          {!typing ? (
            <button type="button" className="btn w-full h-14 text-base" onClick={() => setTyping(true)} data-testid="pair-type">
              <Keyboard size={20} /> Have a code from Till setup? Type it instead
            </button>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div className="text-[15px] text-ink">
                {HOST_APP
                  ? <>In Macaroonie, open <b>Till setup</b>, then <b>{SECTIONS[HOST_APP]}</b>, add this {APP_NAMES[HOST_APP]} (or press Pairing code on one already there) and type its code here. It works once, for 30 minutes.</>
                  : <>In Macaroonie, open <b>Till setup</b>, then <b>Tills</b> (or <b>Kitchen screens</b>, or <b>Kiosks</b>), add this device and type its code here. It works once, for 30 minutes.</>}
              </div>
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
            </form>
          )}
        </div>

        {others.length > 0 && (
          <div className="text-sm text-muted" data-testid="pair-others">
            This is the {APP_NAMES[HOST_APP]} address. {others.map((k, i) => (
              <span key={k}>{i ? ' · ' : ''}{SECTIONS[k]}: <a className="underline font-semibold text-ink" href={addressFor(k)}>{shortAddress(addressFor(k))}</a></span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
