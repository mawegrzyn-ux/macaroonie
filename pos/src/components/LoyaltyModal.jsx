// Loyalty on a check (migration 211): find the member (scan their card's QR
// code, or look them up by email, phone, name or member number), add them to
// the check, spend a reward on it, or join them up. Points and stamps for the
// check are worked out by the server when it is paid.
//
// Spending a reward: the discount is worked out first (tillDiscount, so a
// reward that can't go on this check never takes points), then the server
// takes the reward out (points off now) and the till puts the discount on with
// the redemption's id; the sequencer checks the two match.

import { useEffect, useRef, useState } from 'react'
import { Star, ScanLine, Search, UserPlus, Camera, X } from 'lucide-react'
import { ulid } from '@shared/pos/ids.js'
import { checkTotals } from '@shared/pos/pricing.js'
import { tillDiscount, pointsFor, pointsText, parseCardCode, formatMemberNo } from '@shared/loyalty.js'
import { Modal, cx, money } from './ui.jsx'
import QrScan, { CAN_SCAN } from './QrScan.jsx'
import { dispatch, toast, loyaltyLookup, loyaltyJoin, loyaltyReserve, loyaltyRelease } from '../lib/store.js'

const settingsOf = cfg => ({ points: { label: cfg.points_label, per_pound: cfg.per_pound, min_spend_pence: cfg.min_spend_pence || 0 } })

export default function LoyaltyModal({ check, config, onClose }) {
  const cfg = config.loyalty
  const [mode, setMode] = useState(check.loyalty?.member_id ? 'member' : 'find')
  const [member, setMember] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  // A member already on the check: load their points and rewards.
  const refresh = async () => {
    if (!check.loyalty?.no) return
    const r = await loyaltyLookup({ q: check.loyalty.no })
    if (!r.ok) return setError(r.error)
    setMember(r.data.members[0] || null)
  }
  useEffect(() => { if (mode === 'member' && !member) refresh() }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps

  const choose = m => {
    const r = dispatch('check.member_set', { member: { id: m.id, no: m.member_no, name: m.name } }, { check_id: check.id })
    if (!r.ok) return toast(r.error, 'bad')
    setMember(m)
    setMode('member')
    toast(m.name + ' is on the check', 'ok')
  }

  if (!cfg) {
    return <Modal title="Loyalty" onClose={onClose}><div className="text-muted">Loyalty isn't used at this venue.</div></Modal>
  }
  return (
    <Modal title={mode === 'join' ? 'Join ' + cfg.name : cfg.name} onClose={onClose} wide>
      {error && <div className="mb-3 rounded-xl bg-bad-soft text-bad p-3 text-sm font-semibold" data-testid="loy-error">{error}</div>}
      {mode === 'find' && <Find cfg={cfg} onFound={choose} onJoin={() => setMode('join')} busy={busy} setBusy={setBusy} setError={setError} />}
      {mode === 'join' && <Join cfg={cfg} onJoined={choose} onBack={() => setMode('find')} setError={setError} />}
      {mode === 'member' && (
        <MemberOnCheck check={check} cfg={cfg} member={member} onRefresh={refresh} setError={setError}
          onRemove={() => {
            const r = dispatch('check.member_set', { member: null }, { check_id: check.id })
            if (!r.ok) return toast(r.error, 'bad')
            setMember(null); setMode('find')
          }} />
      )}
    </Modal>
  )
}

function Find({ cfg, onFound, onJoin, busy, setBusy, setError }) {
  const [scan, setScan] = useState('')
  const [q, setQ] = useState('')
  const [results, setResults] = useState(null)
  const [camera, setCamera] = useState(false)
  const scanRef = useRef(null)
  useEffect(() => { scanRef.current?.focus() }, [])

  const look = async body => {
    setBusy(true); setError(null)
    const r = await loyaltyLookup(body)
    setBusy(false)
    if (!r.ok) return setError(r.error)
    if (body.code) {
      if (!r.data.members.length) return setError('That card isn\'t one of our members\' (or the membership is closed)')
      return onFound(r.data.members[0])
    }
    setResults(r.data.members)
  }
  const scanned = raw => {
    if (!parseCardCode(raw)) return false
    setCamera(false)
    look({ code: raw })
    return true
  }
  return (
    <div className="space-y-4">
      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <div className="label flex items-center gap-2"><ScanLine size={16} /> Scan their card</div>
          {/* A scanner types the code here and presses Enter; no on-screen keyboard. */}
          <input ref={scanRef} className="input" inputMode="none" autoComplete="off" placeholder="Scan the QR code on their phone" value={scan}
            data-testid="loy-scan" onChange={e => setScan(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && scan.trim()) { e.preventDefault(); const v = scan.trim(); setScan(''); if (!scanned(v)) setError('That isn\'t a loyalty card') } }} />
          {CAN_SCAN && !camera && <button className="btn w-full" onClick={() => setCamera(true)}><Camera size={18} /> Use the camera</button>}
          {camera && (
            <div className="space-y-2">
              <QrScan className="h-56" onText={scanned} hint="Hold the card's QR code in the frame" />
              <button className="btn w-full" onClick={() => setCamera(false)}><X size={18} /> Stop the camera</button>
            </div>
          )}
        </div>
        <div className="space-y-2">
          <div className="label flex items-center gap-2"><Search size={16} /> Or look them up</div>
          <form className="flex gap-2" onSubmit={e => { e.preventDefault(); if (q.trim().length >= 2) look({ q: q.trim() }) }}>
            <input className="input" placeholder="Email, phone, name or member number" value={q} onChange={e => setQ(e.target.value)} data-testid="loy-search" />
            <button className="btn btn-primary" disabled={busy || q.trim().length < 2} data-testid="loy-search-go">Find</button>
          </form>
          {results && (
            <div className="space-y-2" data-testid="loy-results">
              {results.map(m => (
                <button key={m.id} className="w-full card p-3 text-left flex items-center gap-3" onClick={() => onFound(m)} data-testid={'loy-result-' + m.member_no}>
                  <Star size={20} className="text-brand shrink-0" />
                  <span className="flex-1 min-w-0">
                    <span className="block font-semibold truncate">{m.name}</span>
                    <span className="block text-xs text-muted truncate">{[m.email, m.phone, formatMemberNo(m.member_no)].filter(Boolean).join(' · ')}</span>
                  </span>
                  {cfg.points && <span className="text-sm font-semibold tabular-nums">{pointsText(m.points, settingsOf(cfg))}</span>}
                </button>
              ))}
              {!results.length && <div className="text-sm text-muted">Nobody found. Check the spelling, or join them up.</div>}
            </div>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <span className="text-sm text-muted flex-1 min-w-[200px]">Not a member yet?</span>
        <button className="btn" onClick={onJoin} data-testid="loy-join"><UserPlus size={18} /> Join them up</button>
      </div>
    </div>
  )
}

function Join({ cfg, onJoined, onBack, setError }) {
  const [f, setF] = useState({ name: '', email: '', phone: '', marketing: false, agreed: false })
  const [busy, setBusy] = useState(false)
  const set = patch => setF(x => ({ ...x, ...patch }))
  const go = async () => {
    setBusy(true); setError(null)
    const r = await loyaltyJoin({ name: f.name.trim(), email: f.email.trim(), phone: f.phone.trim() || null, marketing: f.marketing, agreed: f.agreed })
    setBusy(false)
    if (!r.ok) return setError(r.error)
    if (!r.data.created) toast('Already a member: added to the check', 'ok')
    onJoined(r.data.member)
  }
  return (
    <div className="space-y-3">
      <div className="grid md:grid-cols-2 gap-3">
        <label className="block"><span className="label">Name</span><input className="input" value={f.name} onChange={e => set({ name: e.target.value })} data-testid="loy-join-name" /></label>
        <label className="block"><span className="label">Email</span><input className="input" type="email" inputMode="email" value={f.email} onChange={e => set({ email: e.target.value })} data-testid="loy-join-email" /></label>
        {cfg.signup?.ask_phone && <label className="block"><span className="label">Phone (optional)</span><input className="input" type="tel" inputMode="tel" value={f.phone} onChange={e => set({ phone: e.target.value })} /></label>}
      </div>
      <label className="flex items-start gap-3 card p-3 cursor-pointer">
        <input type="checkbox" className="w-6 h-6 mt-0.5 shrink-0" checked={f.agreed} onChange={e => set({ agreed: e.target.checked })} data-testid="loy-join-agreed" />
        <span className="text-sm"><span className="font-semibold block">The guest agrees</span>{cfg.signup?.terms_text}</span>
      </label>
      <label className="flex items-start gap-3 card p-3 cursor-pointer">
        <input type="checkbox" className="w-6 h-6 mt-0.5 shrink-0" checked={f.marketing} onChange={e => set({ marketing: e.target.checked })} />
        <span className="text-sm"><span className="font-semibold block">Only if they ask for it</span>{cfg.signup?.marketing_text}</span>
      </label>
      <div className="flex flex-wrap gap-2 justify-end">
        <button className="btn" onClick={onBack}>Back</button>
        <button className="btn btn-primary min-w-[180px]" disabled={busy || !f.name.trim() || !f.email.trim() || !f.agreed} onClick={go} data-testid="loy-join-go">Join and add to the check</button>
      </div>
      <div className="text-xs text-muted">They get an email with their card. Read the words above to them: they need to say yes.</div>
    </div>
  )
}

function MemberOnCheck({ check, cfg, member, onRefresh, onRemove, setError }) {
  const [busy, setBusy] = useState(null)
  const t = checkTotals(check)
  const onCheck = (check.discounts || []).filter(d => d.loyalty_redemption_id)
  const earns = cfg.points && cfg.earn ? pointsFor(t.net, settingsOf(cfg)) : 0
  const use = async reward => {
    setError(null)
    const d = tillDiscount(reward, check, t)
    if (!d.ok) return setError(d.error)
    setBusy(reward.key)
    const r = await loyaltyReserve(check, member, reward)
    if (!r.ok) { setBusy(null); return setError(r.error) }
    const ap = dispatch('discount.applied', { discount: { id: ulid(), ...d.discount, loyalty_redemption_id: r.data.redemption.id } }, { check_id: check.id })
    if (!ap.ok) {
      await loyaltyRelease(r.data.redemption.id)
      setBusy(null)
      return setError(ap.error)
    }
    toast(reward.name + ' is on the check', 'ok')
    await onRefresh()
    setBusy(null)
  }
  const takeOff = d => {
    const r = dispatch('discount.removed', { discount_id: d.id }, { check_id: check.id })
    if (!r.ok) return toast(r.error, 'bad')
    toast(d.name + ' taken off: it goes back to them', 'ok')
    setTimeout(onRefresh, 1500)
  }
  return (
    <div className="space-y-4" data-testid="loy-member">
      <div className="flex flex-wrap items-center gap-3">
        <Star size={28} className="text-brand" />
        <div className="flex-1 min-w-0">
          <div className="text-xl font-bold truncate">{member?.name || check.loyalty?.name}</div>
          <div className="text-sm text-muted">{formatMemberNo(member?.member_no || check.loyalty?.no)}</div>
        </div>
        {cfg.points && member && <div className="text-2xl font-bold tabular-nums" data-testid="loy-points">{pointsText(member.points, settingsOf(cfg))}</div>}
      </div>
      {cfg.earn && cfg.points && <div className="rounded-xl bg-ok-soft p-3 text-sm font-semibold" data-testid="loy-earns">This check earns {pointsText(earns, settingsOf(cfg))} when it is paid.</div>}
      {!cfg.earn && <div className="text-sm text-muted">Points aren't earned at this till.</div>}
      {member?.stamps?.length > 0 && (
        <div className="grid sm:grid-cols-2 gap-2">
          {member.stamps.map(s => (
            <div key={s.card_id} className="card p-3">
              <div className="flex justify-between text-sm font-semibold"><span>{s.name}</span><span className="tabular-nums">{s.count} / {s.needed}</span></div>
              <div className="h-2 mt-2 rounded-full bg-line overflow-hidden"><div className="h-full bg-brand" style={{ width: Math.min(100, s.count / s.needed * 100) + '%' }} /></div>
            </div>
          ))}
        </div>
      )}
      {onCheck.length > 0 && (
        <div className="space-y-2">
          <div className="label">Rewards on this check</div>
          {onCheck.map(d => (
            <div key={d.id} className="flex items-center gap-2 rounded-xl bg-ok-soft p-2 pl-3" data-testid="loy-on-check">
              <span className="flex-1 font-semibold">{d.name}</span>
              <button className="btn min-h-[44px]" onClick={() => takeOff(d)}>Take off</button>
            </div>
          ))}
        </div>
      )}
      {cfg.redeem && member && (
        <div className="space-y-2">
          <div className="label">Their rewards</div>
          {!member.rewards.length && <div className="text-sm text-muted">No rewards to spend yet.</div>}
          {member.rewards.map(r => (
            <div key={r.key} className={cx('card p-3 flex items-center gap-3', !r.can_afford && 'opacity-60')} data-testid={'loy-reward-' + r.reward_id}>
              <div className="flex-1 min-w-0">
                <div className="font-semibold">{r.name}</div>
                <div className="text-xs text-muted">{r.summary}{r.points_cost ? ' · ' + pointsText(r.points_cost, settingsOf(cfg)) : ' · theirs to use'}{r.min_spend_pence ? ' · on ' + money(r.min_spend_pence) + ' or more' : ''}</div>
              </div>
              <button className="btn btn-primary min-w-[96px]" disabled={!r.can_afford || !!busy} onClick={() => use(r)} data-testid={'loy-use-' + r.reward_id}>
                {busy === r.key ? '…' : r.can_afford ? 'Use' : 'Not enough'}
              </button>
            </div>
          ))}
        </div>
      )}
      {!cfg.redeem && <div className="text-sm text-muted">Rewards can't be spent at this till.</div>}
      <div className="border-t border-line pt-3 flex justify-between gap-2">
        <button className="btn" onClick={onRemove} data-testid="loy-remove">Take {member?.name?.split(' ')[0] || 'them'} off the check</button>
      </div>
    </div>
  )
}
