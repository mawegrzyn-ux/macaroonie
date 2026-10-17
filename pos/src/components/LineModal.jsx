// What can be done to one item on a check. Before it is sent: change the
// quantity, seat, course, note and allergies, or delete it. After: change
// the seat, or void it (with a reason, which a manager may need to allow).
// Either way: comp it, discount it, or move it to another check. A dish not
// sent yet can be made into a combo that offers it (shared/combos.js).

import { useState } from 'react'
import { Minus, Plus, Trash2, Ban, Gift, Percent, ArrowRightLeft, X, Layers } from 'lucide-react'
import { ulid } from '@shared/pos/ids.js'
import { lineGross, modifierText, groupModifiers, checkTotals } from '@shared/pos/pricing.js'
import { Modal, ReasonPicker, cx, money, useApproval } from './ui.jsx'
import { dispatch, toast } from '../lib/store.js'
import { combosForLine } from '../lib/checkOps.js'

const VOID_REASONS = ['Wrong item', 'Guest changed mind', 'Quality', 'Took too long', 'Dropped / spilt']
const COMP_REASONS = ['Quality', 'Took too long', 'Birthday', 'Regular', 'Staff', 'Manager decision']

export default function LineModal({ check, line, config, onClose, onDiscount, onMove, onMakeCombo }) {
  const approve = useApproval()
  const [mode, setMode] = useState(null)   // 'void' | 'comp' | 'delete'
  const [reason, setReason] = useState('')
  const [voidQty, setVoidQty] = useState(line.qty)
  const [waste, setWaste] = useState(true)
  const [note, setNote] = useState(line.note || '')
  const isNew = line.status === 'new'
  const voided = line.status === 'voided'
  const discounts = (check.discounts || []).filter(d => d.scope === 'line' && d.line_ids.includes(line.id))
  const allergens = (config.dietary_tags || []).filter(t => t.kind === 'allergen')
  const t = checkTotals(check)
  const net = t.lines.find(l => l.id === line.id)?.net ?? 0
  const combos = onMakeCombo ? combosForLine(line, config) : []
  const inCombo = (check.promotions || []).filter(p => p.kind === 'combo' && p.lines?.[line.id])

  const change = patch => {
    const r = dispatch('line.changed', { line_id: line.id, ...patch }, { check_id: check.id })
    if (!r.ok) toast(r.error, 'bad')
  }

  const doVoid = async () => {
    const qty = Math.min(voidQty, line.qty)
    const approver = await approve('void', null, 'Voiding an item the kitchen already has needs a manager.')
    if (approver === false) return
    const payload = { line_id: line.id, reason: reason.trim(), waste }
    if (qty < line.qty) { payload.qty = qty; payload.new_line_id = ulid() }
    const r = dispatch('line.voided', payload, { check_id: check.id, approved_by: approver })
    if (!r.ok) return toast(r.error, 'bad')
    toast('Voided' + (qty > 1 ? ' ' + qty + ' x ' : ' ') + line.name, 'ok')
    onClose()
  }

  const doComp = async () => {
    const approver = await approve('comp', null, 'Giving an item free needs a manager.')
    if (approver === false) return
    const r = dispatch('discount.applied', { discount: { id: ulid(), scope: 'line', line_ids: [line.id], comp: true, name: 'Comp: ' + line.name, reason: reason.trim() } }, { check_id: check.id, approved_by: approver })
    if (!r.ok) return toast(r.error, 'bad')
    onClose()
  }

  const doDelete = () => {
    const r = dispatch('line.deleted', { line_id: line.id }, { check_id: check.id })
    if (!r.ok) return toast(r.error, 'bad')
    onClose()
  }

  return (
    <Modal title={line.qty + ' x ' + line.name} onClose={onClose} wide>
      <div className="space-y-5">
        <div className="text-sm text-muted">
          {groupModifiers(line.modifiers).map(modifierText).join(', ')}
          {(line.combo || []).map(c => c.name).join(', ')}
          {inCombo.length > 0 && <div className="text-brand font-semibold mt-1">Part of {inCombo.map(p => p.name).join(', ')} (applied by itself)</div>}
          <div className="text-ink font-semibold mt-1">{money(lineGross(line))}{net !== lineGross(line) && !voided ? ' · after discounts ' + money(net) : ''}</div>
        </div>

        {voided && <div className="rounded-xl bg-bad-soft text-bad p-3 font-semibold">Voided: {line.voided?.reason}</div>}

        {!voided && !mode && (
          <>
            {isNew && (
              <div className="flex items-center gap-3">
                <span className="label w-20">Quantity</span>
                <button className="btn w-14 px-0" disabled={line.qty <= 1} onClick={() => change({ qty: line.qty - 1 })}><Minus size={20} /></button>
                <div className="w-12 text-center text-2xl font-bold tabular-nums">{line.qty}</div>
                <button className="btn w-14 px-0" onClick={() => change({ qty: line.qty + 1 })}><Plus size={20} /></button>
              </div>
            )}
            <div className="flex items-start gap-3">
              <span className="label w-20 pt-3">Seat</span>
              <div className="flex flex-wrap gap-2">
                <button className={cx('chip', !line.seat && 'chip-on')} onClick={() => change({ seat: null })}>Shared</button>
                {Array.from({ length: Math.max(4, check.covers || 0) }).map((_, i) => (
                  <button key={i} className={cx('chip w-12', line.seat === i + 1 && 'chip-on')} onClick={() => change({ seat: i + 1 })}>{i + 1}</button>
                ))}
              </div>
            </div>
            {isNew && (config.courses || []).length > 0 && (
              <div className="flex items-start gap-3">
                <span className="label w-20 pt-3">Course</span>
                <div className="flex flex-wrap gap-2">
                  {config.courses.map(c => <button key={c.id} className={cx('chip', line.course_id === c.id && 'chip-on')} onClick={() => change({ course_id: c.id })}>{c.name}</button>)}
                  <button className={cx('chip', !line.course_id && 'chip-on')} onClick={() => change({ course_id: null })}>None</button>
                </div>
              </div>
            )}
            {isNew && (
              <div className="flex items-center gap-3">
                <span className="label w-20">Note</span>
                <input className="input flex-1" value={note} onChange={e => setNote(e.target.value)} onBlur={() => note !== (line.note || '') && change({ note: note.trim() || null })} maxLength={300} />
              </div>
            )}
            {isNew && allergens.length > 0 && (
              <div className="flex items-start gap-3">
                <span className="label w-20 pt-3">Allergies</span>
                <div className="flex flex-wrap gap-2">
                  {allergens.map(a => {
                    const on = (line.allergies || []).includes(a.label)
                    return <button key={a.code} className={cx('chip', on && 'bg-bad text-white border-bad')}
                      onClick={() => change({ allergies: on ? line.allergies.filter(x => x !== a.label) : [...(line.allergies || []), a.label] })}>{a.label}</button>
                  })}
                </div>
              </div>
            )}

            {discounts.length > 0 && (
              <div className="space-y-2">
                <div className="label">Discounts on this item</div>
                {discounts.map(d => (
                  <div key={d.id} className="flex items-center gap-3 rounded-xl bg-ok-soft p-2 pl-3">
                    <div className="flex-1 font-semibold">{d.name}{d.reason ? ' · ' + d.reason : ''}</div>
                    <button className="btn min-h-[40px]" onClick={() => { const r = dispatch('discount.removed', { discount_id: d.id }, { check_id: check.id }); if (!r.ok) toast(r.error, 'bad') }}><X size={16} /> Take off</button>
                  </div>
                ))}
              </div>
            )}

            {combos.length > 0 && (
              <div className="space-y-2" data-testid="make-combo">
                <div className="label">Make it a combo</div>
                <div className="flex flex-wrap gap-2">
                  {combos.map(({ combo, start }) => (
                    <button key={combo.id} className="btn" onClick={() => onMakeCombo(line, combo, start)}>
                      <Layers size={18} /> {combo.name}{combo.price_pence != null ? ' ' + money(combo.price_pence) : ''}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2">
              {isNew
                ? <button className="btn text-bad" onClick={() => setMode('delete')}><Trash2 size={18} /> Delete</button>
                : <button className="btn text-bad" onClick={() => { setReason(''); setMode('void') }}><Ban size={18} /> Void</button>}
              <button className="btn" onClick={() => { setReason(''); setMode('comp') }}><Gift size={18} /> Comp</button>
              <button className="btn" onClick={() => { onClose(); onDiscount([line.id]) }}><Percent size={18} /> Discount</button>
              <button className="btn" onClick={() => { onClose(); onMove([line.id]) }}><ArrowRightLeft size={18} /> Move</button>
            </div>
          </>
        )}

        {mode === 'delete' && (
          <div className="rounded-xl border-2 border-bad p-4 space-y-3">
            <div className="font-semibold">Delete {line.name}? It hasn't gone to the kitchen.</div>
            <div className="flex gap-2">
              <button className="btn btn-bad" onClick={doDelete}><Trash2 size={18} /> Yes, delete</button>
              <button className="btn" onClick={() => setMode(null)}>Keep it</button>
            </div>
          </div>
        )}

        {mode === 'void' && (
          <div className="rounded-xl border-2 border-bad p-4 space-y-4">
            <div className="font-semibold">Void {line.name}: the kitchen gets a VOID ticket.</div>
            {line.qty > 1 && (
              <div className="flex items-center gap-3">
                <span className="label">How many</span>
                <button className="btn w-12 px-0" onClick={() => setVoidQty(q => Math.max(1, q - 1))}><Minus size={18} /></button>
                <div className="w-10 text-center text-xl font-bold">{voidQty}</div>
                <button className="btn w-12 px-0" onClick={() => setVoidQty(q => Math.min(line.qty, q + 1))}><Plus size={18} /></button>
                <span className="text-muted">of {line.qty}</span>
              </div>
            )}
            <ReasonPicker options={VOID_REASONS} value={reason} onChange={setReason} />
            <div className="flex gap-2">
              <button className={cx('chip', waste && 'chip-on')} onClick={() => setWaste(true)}>Made: waste</button>
              <button className={cx('chip', !waste && 'chip-on')} onClick={() => setWaste(false)}>Not made</button>
            </div>
            <div className="flex gap-2">
              <button className="btn btn-bad" disabled={!reason.trim()} onClick={doVoid}><Ban size={18} /> Void {voidQty > 1 ? voidQty : ''}</button>
              <button className="btn" onClick={() => setMode(null)}>Back</button>
            </div>
          </div>
        )}

        {mode === 'comp' && (
          <div className="rounded-xl border-2 border-ok p-4 space-y-4">
            <div className="font-semibold">Give {line.name} free (comp).</div>
            <ReasonPicker options={COMP_REASONS} value={reason} onChange={setReason} />
            <div className="flex gap-2">
              <button className="btn btn-ok" disabled={!reason.trim()} onClick={doComp}><Gift size={18} /> Comp it</button>
              <button className="btn" onClick={() => setMode(null)}>Back</button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
