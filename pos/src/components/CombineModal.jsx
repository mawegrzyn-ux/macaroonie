// Combine tables (shared/pos/tables.js): a party sits across several tables
// and the till treats them as one. Two windows:
//
// CombineModal: an open check's tables. Its main table is fixed (Move table
// changes that); tap the others to join them or split them off, then Done.
// Bookings' table combinations with the main table are one-tap choices. A
// table with an open order of its own can be picked too: Done then asks
// first (CombineConfirm) and merges that order into this one.
//
// CombineConfirm: the one question before another order is merged in, also
// used by the floor's Combine tables. Merging keeps its own permission (Move
// items between checks): without it a manager types their PIN.

import { useState } from 'react'
import { Link2, Check } from 'lucide-react'
import { checkTotals } from '@shared/pos/pricing.js'
import { joinedTables, tablesOf, tableLabel } from '@shared/pos/tables.js'
import { Modal, cx, money, useApproval } from './ui.jsx'
import { toast, useChecks } from '../lib/store.js'
import { combineChanges, applyCombine, checksByTable, combinationsWith, tableTitleOf, itemCount, mergeable } from '../lib/checkOps.js'

/** "Table 5 has an open order with 3 items (£24.50)." */
function otherOrderText(other, config) {
  const n = itemCount(other)
  return (tableTitleOf(other, config) || 'That table') + ' has an open order with ' + (n === 1 ? '1 item' : n + ' items') + ' (' + money(checkTotals(other).total) + ').'
}

/** Ask for the manager when merging needs one, do it, and say what happened. -> true when done. */
export async function runCombine(check, changes, config, approve) {
  let approver = null
  if (changes.merge.length) {
    approver = await approve('transfer', null, 'Merging another order into this one needs a manager.')
    if (approver === false) return false
  }
  const r = applyCombine(check, changes, approver)
  if (!r.ok) { toast(r.error, 'bad'); return false }
  if (r.nothing) return true
  const after = r.checks[check.id]
  toast(joinedTables(after).length ? (tableTitleOf(after, config) || 'Tables') + ' combined' : (tableTitleOf(after, config) || 'The table') + ' on its own again', 'ok')
  return true
}

/**
 * The question before another table's order is merged in. changes:
 * combineChanges() with something to merge; onConfirm does it.
 */
export function CombineConfirm({ check, changes, config, onClose, onConfirm }) {
  const mine = tableTitleOf(check, config) || 'this order'
  const [busy, setBusy] = useState(false)
  const go = async () => {
    setBusy(true)
    try { await onConfirm() } finally { setBusy(false) }
  }
  return (
    <Modal title="Combine tables" onClose={onClose} wrapTitle
      footer={<>
        <button className="btn h-14 flex-1" onClick={onClose} data-testid="combine-merge-cancel">Cancel</button>
        <button className="btn btn-primary h-14 flex-[2]" disabled={busy} onClick={go} data-testid="combine-merge-go">Combine and merge</button>
      </>}>
      <div className="space-y-3" data-testid="combine-merge">
        {changes.merge.map(other => (
          <div key={other.id} className="rounded-xl bg-warn-soft p-3 font-semibold" data-testid="combine-merge-order">{otherOrderText(other, config)}</div>
        ))}
        <div className="text-base">
          Combine and merge {changes.merge.length === 1 ? 'it' : 'them'} into {mine === 'this order' ? mine : mine + '\'s order'}?
        </div>
        <div className="text-sm text-muted">
          Everything on {changes.merge.length === 1 ? 'that order' : 'those orders'} moves to this one, and the tables are served and paid as one.
          You can split a table off again, but the orders stay merged.
        </div>
      </div>
    </Modal>
  )
}

export default function CombineModal({ check, config, onClose }) {
  const approve = useApproval()
  const checks = useChecks()
  const [want, setWant] = useState(() => joinedTables(check))
  const [confirm, setConfirm] = useState(null) // combineChanges() waiting for a yes to its merges
  const open = Object.values(checks).filter(c => c.status === 'open' && c.id !== check.id && c.mode !== 'counter')
  const held = checksByTable(open)
  const tables = config.tables || []
  const toggle = id => setWant(w => (w.includes(id) ? w.filter(x => x !== id) : [...w, id]))
  // Another order's tables come and go together.
  const pick = t => {
    const others = held[t.id] || []
    if (!others.length) return toggle(t.id)
    if (others.some(o => !mergeable(o))) return toast('That order is part paid: move its items instead', 'bad')
    const ids = [...new Set(others.flatMap(tablesOf))]
    setWant(w => (w.includes(t.id) ? w.filter(x => !ids.includes(x)) : [...w, ...ids.filter(x => !w.includes(x))]))
  }
  const combos = combinationsWith(config, check.table_id)
  const changes = combineChanges(check, want, checks)
  const changed = changes.split.length + changes.join.length > 0
  const label = tableLabel({ table_id: check.table_id, joined_table_ids: want }, tables)

  const done = async () => {
    if (!changed) return onClose()
    if (changes.merge.length) return setConfirm(changes)
    if (await runCombine(check, changes, config, approve)) onClose()
  }

  if (confirm) {
    return (
      <CombineConfirm check={check} changes={confirm} config={config} onClose={() => setConfirm(null)}
        onConfirm={async () => { if (await runCombine(check, confirm, config, approve)) onClose() }} />
    )
  }
  return (
    <Modal title="Combine tables" onClose={onClose} wide
      footer={<>
        <div className="flex-1 min-w-0 self-center font-semibold truncate" data-testid="combine-label">{label ? (want.length ? 'Tables ' : 'Table ') + label : ''}</div>
        <button className="btn h-14 px-6" onClick={onClose} data-testid="combine-cancel">Cancel</button>
        <button className="btn btn-primary h-14 px-8" onClick={done} data-testid="combine-done">Done</button>
      </>}>
      <div className="space-y-3" data-testid="combine-picker">
        <div className="text-sm text-muted">Tap the other tables this party sits at. Tap one again to split it off. The order stays on its own table; Move table changes that.</div>
        {combos.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap" data-testid="combine-suggestions">
            <span className="label">Combinations</span>
            {combos.map(x => (
              <button key={x.id} className="chip" data-testid="combine-suggestion" onClick={() => setWant(w => [...new Set([...w, ...x.table_ids.filter(id => id !== check.table_id)])])}>
                <Link2 size={14} className="inline mr-1" />{x.name}
              </button>
            ))}
          </div>
        )}
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))' }}>
          {tables.map(t => {
            const main = t.id === check.table_id
            const on = want.includes(t.id)
            const others = held[t.id] || []
            const stuck = others.some(o => !mergeable(o))
            const total = others.reduce((s, o) => s + checkTotals(o).total, 0)
            return (
              <button key={t.id} disabled={main} onClick={() => pick(t)} aria-pressed={on}
                data-testid="combine-table" data-table={t.id} data-label={t.label} data-state={main ? 'main' : on ? 'on' : others.length ? (stuck ? 'stuck' : 'busy') : 'free'}
                className={cx('btn h-20 flex-col gap-0 relative disabled:opacity-100', main && 'btn-primary', on && 'ring-4 ring-brand border-brand bg-brand-soft',
                  !on && others.length > 0 && 'border-warn', stuck && 'opacity-60')}>
                {on && <Check size={16} className="absolute top-1.5 right-1.5 text-brand" />}
                <span className="text-xl">{t.label}</span>
                <span className="text-xs font-normal">
                  {main ? 'this order' : others.length ? (stuck ? 'part paid' : 'open order · ' + money(total)) : on ? 'joined' : t.max_covers + ' seats'}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </Modal>
  )
}
