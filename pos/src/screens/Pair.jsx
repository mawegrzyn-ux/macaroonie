// First start on a device. The device shows a code of its own with a QR code
// to the installer app (installer.{root}, migration 184): someone signed in
// scans it with a phone, or types the code in Till setup (Add a till, Add a
// screen, Add a kiosk) or the installer, and the device sets itself up. That
// is the one way a till, kitchen screen or kiosk is set up. Each kind of
// device has its own address (lib/appHost.js): pos. for tills, kitchen. for
// kitchen screens, kiosk. for kiosks, and a code shown on one can only become
// that kind. A device moved here from another address brings a one-time code
// and pairs by itself (no typing).
import { useEffect, useMemo, useRef, useState } from 'react'
import { QrCode, RefreshCw } from 'lucide-react'
import { qrSvg } from '@shared/qr.js'
import { pair, requestLinkCode, checkLinkCode, useTill } from '../lib/store.js'
import { HOST_APP, APP_NAMES, addressFor, shortAddress } from '../lib/appHost.js'

const TITLES = { terminal: 'Set up this till', kds: 'Set up this kitchen screen', kiosk: 'Set up this kiosk' }
const SECTIONS = { terminal: 'Tills', kds: 'Kitchen screens', kiosk: 'Kiosks' }
const ADD_BUTTONS = { terminal: 'Add a till', kds: 'Add a screen', kiosk: 'Add a kiosk' }
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
            <li>Scan the QR code with a phone signed in to Macaroonie{host ? <> (it opens <b>{host}</b>)</> : null}, or type the code in Macaroonie: <b>Till setup</b>, <b>{HOST_APP ? SECTIONS[HOST_APP] : 'Tills'}</b>, <b>{HOST_APP ? ADD_BUTTONS[HOST_APP] : 'Add a till'}</b>.</li>
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
  const [moving, setMoving] = useState(!!s.pairCode)
  const [error, setError] = useState(null)
  const { link, problem } = useLinkCode()
  // A device moved here from another address brings a one-time code: it
  // pairs with it by itself, once. If that fails, the code below still works.
  const auto = useRef(false)
  useEffect(() => {
    if (!s.pairCode || auto.current) return
    auto.current = true
    setMoving(true)
    pair(s.pairCode)
      .catch(err => setError(err.offline ? 'No connection: check the Wi-Fi.' : err.message))
      .finally(() => setMoving(false))
  }, [s.pairCode])

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

        {moving && (
          <div className="rounded-xl bg-brand-soft p-3 text-sm font-semibold" data-testid="pair-moving">
            Moving this {HOST_APP ? APP_NAMES[HOST_APP] : 'device'} here from its old address…
          </div>
        )}
        {error && (
          <div className="rounded-xl bg-bad-soft text-bad p-3 text-sm font-semibold" data-testid="pair-error">
            The move didn't finish: {error} Link this {HOST_APP ? APP_NAMES[HOST_APP] : 'device'} with the code below instead.
          </div>
        )}

        <LinkPanel link={link} problem={problem} />

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
