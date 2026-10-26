// The guest's loyalty card on the kiosk (migration 211): a block on the
// order page that opens a sheet to scan the card's QR code (the kiosk's
// scanner types it, or the camera reads it), then shows the guest's points
// and the rewards they can spend on this order. New guests scan a QR code to
// join on their own phone; a kiosk never takes an email address for loyalty.
// The store (store.js loyaltyScan / loyaltyUse / loyaltyUnuse) talks to the
// server; the order carries the card and rewards (shared/kiosk.js kioskOrder).

import { useEffect, useMemo, useRef, useState } from 'react'
import { Star, Camera, X, Check } from 'lucide-react'
import { tillDiscount, pointsFor, pointsText } from '@shared/loyalty.js'
import { qrSvg } from '@shared/qr.js'
import { useKiosk, textsFor, loyaltyScan, loyaltyUse, loyaltyUnuse, loyaltyForget } from './store.js'
import { cx, Sheet } from './parts.jsx'
import { useBasketTotals } from './Menu.jsx'
import { useJourneyState } from './journey.js'
import QrScan, { CAN_SCAN } from '../components/QrScan.jsx'

const settingsOf = cfg => ({ points: { label: cfg.points_label, per_pound: cfg.per_pound, min_spend_pence: cfg.min_spend_pence || 0 } })
const fill = (text, vars) => String(text).replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m))

/** On the order page: the card, or a button to add it. */
export function LoyaltyBlock() {
  const s = useKiosk()
  const cfg = s.config?.loyalty
  const texts = textsFor(s)
  const { ui } = texts
  const [open, setOpen] = useJourneyState('loyalty.sheet', false)
  if (!cfg) return null
  const m = s.loyalty?.member
  return (
    <>
      <button className="k-card p-[var(--k-pad)] flex items-center gap-[.8em] text-left w-full" onClick={() => setOpen(true)} data-testid="k-loyalty">
        <Star className="shrink-0 text-[var(--k-primary)]" />
        <span className="flex-1 min-w-0">
          <span className="k-head block text-[1.2em]">{m ? fill(ui('loyalty_hi'), { name: m.name || '' }) : ui('loyalty_card')}</span>
          {m && cfg.points && <span className="k-muted block" data-testid="k-loyalty-points">{pointsText(m.points, settingsOf(cfg))}</span>}
          {!m && <span className="k-muted block">{ui('loyalty_scan')}</span>}
        </span>
        {s.loyalty?.rewards?.length > 0 && <span className="k-chip k-chip-on" data-testid="k-loyalty-count">{s.loyalty.rewards.length}</span>}
      </button>
      {open && <LoyaltySheet onClose={() => setOpen(false)} />}
    </>
  )
}

export function LoyaltySheet({ onClose }) {
  const s = useKiosk()
  const cfg = s.config.loyalty
  const texts = textsFor(s)
  const { ui } = texts
  const m = s.loyalty?.member
  return (
    <Sheet onClose={onClose} wide>
      <div className="flex flex-col gap-[var(--k-gap)]" data-testid="k-loyalty-sheet">
        <div className="flex items-center gap-[.6em]">
          <Star className="text-[var(--k-primary)]" />
          <h2 className="k-head text-[1.8em] m-0 flex-1">{m ? fill(ui('loyalty_hi'), { name: m.name || '' }) : ui('loyalty_scan')}</h2>
        </div>
        {m ? <Member cfg={cfg} texts={texts} /> : <Scan cfg={cfg} texts={texts} preview={s.preview} />}
        {/* Kept in view at the sheet's foot when its rewards run past the screen. */}
        <div className="sticky z-[1] flex flex-wrap gap-[var(--k-gap)] justify-end" data-testid="k-loyalty-actions"
          style={{ bottom: 'calc(var(--k-pad) * -1.2)', marginBottom: 'calc(var(--k-pad) * -1.2)', padding: '.6em 0 calc(var(--k-pad) * 1.2)', background: 'var(--k-sheet, var(--k-surface))' }}>
          {m && (
            <button className="k-btn k-btn-ghost" onClick={() => { loyaltyForget(); onClose() }} data-testid="k-loyalty-forget">
              <X /> {ui('loyalty_remove')}
            </button>
          )}
          <button className="k-btn k-btn-primary" onClick={onClose} data-testid="k-loyalty-close"><Check /> {ui('done')}</button>
        </div>
      </div>
    </Sheet>
  )
}

function Scan({ cfg, texts, preview }) {
  const { ui } = texts
  const [camera, setCamera] = useJourneyState('loyalty.camera', false)
  const [status, setStatus] = useState(null)   // null | 'busy' | 'not_found' | 'error' | 'preview'
  const buffer = useRef('')
  const busy = useRef(false)

  const scanned = async raw => {
    if (busy.current || !String(raw || '').trim()) return false
    busy.current = true
    setStatus('busy')
    const r = await loyaltyScan(raw)
    busy.current = false
    setStatus(r.ok ? null : r.why === 'not_found' ? 'not_found' : r.why === 'preview' ? 'preview' : 'error')
    if (r.ok) setCamera(false)
    return r.ok
  }
  // The kiosk's scanner types the code and presses Enter, wherever the focus is.
  useEffect(() => {
    const onKey = e => {
      if (e.key === 'Enter') { const v = buffer.current; buffer.current = ''; if (v) scanned(v); return }
      if (e.key.length === 1) buffer.current = (buffer.current + e.key).slice(-300)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const joinSvg = useMemo(() => {
    try { return cfg.join_url ? qrSvg(cfg.join_url, { margin: 2, title: ui('loyalty_join') }) : '' } catch { return '' }
  }, [cfg.join_url]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="grid gap-[var(--k-gap)] sm:grid-cols-2">
      <div className="flex flex-col gap-[var(--k-gap)]">
        <div className="k-card p-[var(--k-pad)] text-[1.15em]" data-testid="k-loyalty-hint">{ui('loyalty_scan_hint')}</div>
        {camera ? (
          <QrScan facing="user" className="h-[30cqh] min-h-[200px]" onText={raw => { scanned(raw); return false }} />
        ) : CAN_SCAN && (
          <button className="k-btn k-btn-ghost" onClick={() => setCamera(true)} data-testid="k-loyalty-camera"><Camera /> {ui('loyalty_camera')}</button>
        )}
        {status === 'busy' && <div className="k-muted">…</div>}
        {status === 'not_found' && <div className="k-card p-[.8em] text-[var(--k-danger,#b91c1c)] font-semibold" data-testid="k-loyalty-not-found">{ui('loyalty_not_found')}</div>}
        {status === 'error' && <div className="k-card p-[.8em] font-semibold">{ui('loyalty_error')}</div>}
        {(status === 'preview' || preview) && <div className="k-muted" data-testid="k-loyalty-preview">{ui('loyalty_preview')}</div>}
      </div>
      {joinSvg && (
        <div className="k-card p-[var(--k-pad)] flex flex-col items-center gap-[.6em] text-center" data-testid="k-loyalty-join">
          <div className="k-head text-[1.15em]">{ui('loyalty_join')}</div>
          <div className="w-[min(40cqmin,260px)] bg-white p-[.4em] rounded-[.6em]" dangerouslySetInnerHTML={{ __html: joinSvg }} />
        </div>
      )}
    </div>
  )
}

function Member({ cfg, texts }) {
  const s = useKiosk()
  const { ui } = texts
  const { totals, check, skipped = [] } = useBasketTotals(s)
  const [busy, setBusy] = useState(null)
  const [problem, setProblem] = useState(null)
  const m = s.loyalty.member
  const used = s.loyalty.rewards
  const skippedIds = new Set(skipped.map(x => x.redemption_id))
  const earns = cfg.points && cfg.earn && totals ? pointsFor(totals.net, settingsOf(cfg)) : 0
  const use = async r => {
    setProblem(null)
    // Only take it out (and the points) when it fits the order as it is now.
    const d = check && totals ? tillDiscount({ ...r, id: r.reward_id }, check, totals) : { ok: false, error: '' }
    if (!d.ok) return setProblem({ key: r.key, text: ui('loyalty_cant') })
    setBusy(r.key)
    const out = await loyaltyUse(r)
    setBusy(null)
    if (!out.ok) setProblem({ key: r.key, text: ui('loyalty_error') })
  }
  return (
    <div className="flex flex-col gap-[var(--k-gap)]" data-testid="k-loyalty-member">
      {cfg.points && <div className="k-head text-[2.2em] tabular-nums" data-testid="k-loyalty-balance">{pointsText(m.points, settingsOf(cfg))}</div>}
      {earns > 0 && <div className="k-card p-[.8em] font-semibold" data-testid="k-loyalty-earns">{fill(ui('loyalty_earns'), { points: pointsText(earns, settingsOf(cfg)) })}</div>}
      {(m.stamps || []).map(st => (
        <div key={st.card_id} className="k-card p-[.8em]">
          <div className="flex justify-between font-semibold"><span>{st.name}</span><span className="tabular-nums">{st.count} / {st.needed}</span></div>
          <div className="h-[.6em] mt-[.4em] rounded-full bg-[var(--k-line)] overflow-hidden"><div className="h-full bg-[var(--k-primary)]" style={{ width: Math.min(100, st.count / st.needed * 100) + '%' }} /></div>
        </div>
      ))}
      {used.length > 0 && (
        <div className="flex flex-col gap-[.5em]">
          <h3 className="k-head text-[1.3em] m-0">{ui('loyalty_on_order')}</h3>
          {used.map(x => (
            <div key={x.redemption_id} className="k-card p-[.8em] flex items-center gap-[.6em]" data-testid="k-loyalty-used">
              <Check className="text-[var(--k-primary)]" />
              <span className="flex-1 font-semibold">{x.reward.name}{skippedIds.has(x.redemption_id) && <span className="k-muted block text-[.85em]">{ui('loyalty_cant')}</span>}</span>
              <button className="k-btn k-btn-ghost" disabled={busy === x.redemption_id}
                onClick={async () => { setBusy(x.redemption_id); await loyaltyUnuse(x.redemption_id); setBusy(null) }} data-testid="k-loyalty-unuse">{ui('remove')}</button>
            </div>
          ))}
        </div>
      )}
      {s.loyalty.redeem && (
        <div className="flex flex-col gap-[.5em]">
          <h3 className="k-head text-[1.3em] m-0">{ui('loyalty_rewards')}</h3>
          {!m.rewards.length && <div className="k-muted">{ui('loyalty_no_rewards')}</div>}
          {m.rewards.map(r => (
            <div key={r.key} className={cx('k-card p-[.8em] flex items-center gap-[.6em]', !r.can_afford && 'opacity-60')} data-testid={'k-loyalty-reward-' + r.reward_id} data-key={r.key}>
              <span className="flex-1 min-w-0">
                <span className="k-head block">{r.name}</span>
                <span className="k-muted block text-[.9em]">{r.summary} · {r.points_cost ? pointsText(r.points_cost, settingsOf(cfg)) : ui('loyalty_yours')}</span>
                {problem?.key === r.key && <span className="block text-[.9em] font-semibold text-[var(--k-danger,#b91c1c)]" data-testid="k-loyalty-problem">{problem.text}</span>}
              </span>
              <button className="k-btn k-btn-primary" disabled={!r.can_afford || !!busy} onClick={() => use(r)} data-testid={'k-loyalty-use-' + r.reward_id} data-key={r.key}>
                {r.can_afford ? ui('loyalty_use') : ui('loyalty_not_enough')}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
