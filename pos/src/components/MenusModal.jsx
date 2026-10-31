// More > Menus (and the Menus button of a till layout): which of the till's
// menus show. The till follows the menu times by itself (Menus > Menu times
// in the admin, lib/tillMenus.js); a pick here holds until the menus on now
// change (lunch ends), then the till follows the menu times again.

import { useState } from 'react'
import { Check, Clock } from 'lucide-react'
import { Modal, cx } from './ui.jsx'
import { menuTimesText } from '../lib/tillMenus.js'

/** shown: what useShownMenus() returns for this till. */
export default function MenusModal({ shown, onClose }) {
  const { menus, onNow, none, auto } = shown
  const [picked, setPicked] = useState(shown.ids)
  const on = new Set(onNow)
  // What the menu times show by themselves: picking exactly that is following them.
  const timed = none ? menus.map(m => m.id) : onNow
  const same = (a, b) => a.length === b.length && a.every(id => b.includes(id))

  const toggle = id => setPicked(p => (p.includes(id) ? (p.length > 1 ? p.filter(x => x !== id) : p) : [...p, id]))
  const done = () => {
    if (same(picked, timed)) shown.follow()
    else shown.pick(menus.filter(m => picked.includes(m.id)).map(m => m.id))
    onClose()
  }
  const follow = () => { shown.follow(); onClose() }

  return (
    <Modal title="Menus" onClose={onClose} wide
      footer={<>
        {!auto && <button className="btn" data-testid="menus-follow" onClick={follow}>Follow the menu times</button>}
        <button className="btn btn-primary" data-testid="menus-done" onClick={done}>Done</button>
      </>}>
      <div data-testid="menus-mode" data-auto={auto ? '1' : '0'}
        className={cx('rounded-xl px-4 py-3 mb-4 text-sm', auto ? 'bg-page' : 'bg-held-soft')}>
        {auto ? (
          <>
            <div className="font-semibold flex items-center gap-2"><Clock size={16} /> Following the menu times</div>
            <div className="text-muted mt-0.5">
              {none
                ? 'No menu is on now, so the till shows every menu.'
                : 'The till shows the menus on now and changes by itself when their times change.'}
            </div>
          </>
        ) : (
          <>
            <div className="font-semibold">Picked on this till</div>
            <div className="text-muted mt-0.5">These show until the menus on now change, then the till follows the menu times again.</div>
          </>
        )}
      </div>
      <div className="text-sm text-muted mb-2">Tap the menus to show. At least one stays on.</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {menus.map(m => {
          const isOn = picked.includes(m.id)
          return (
            <button key={m.id} type="button" data-testid="menus-menu" data-menu={m.id} data-on={isOn ? '1' : '0'}
              aria-pressed={isOn} onClick={() => toggle(m.id)}
              className={cx('btn h-auto min-h-[64px] py-3 px-4 justify-start text-left gap-3', isOn && 'btn-primary')}>
              <span className={cx('w-7 h-7 rounded-full border-2 grid place-items-center shrink-0',
                isOn ? 'border-white bg-white/20' : 'border-line')}>
                {isOn && <Check size={16} />}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block font-semibold truncate">{m.name}</span>
                <span className={cx('block text-xs mt-0.5', isOn ? 'opacity-80' : 'text-muted')}>{menuTimesText(m)}</span>
              </span>
              {on.has(m.id) && (
                <span data-testid="menus-on-now" className={cx('text-xs font-semibold rounded-full px-2 py-0.5 shrink-0',
                  isOn ? 'bg-white/25' : 'bg-ok/15 text-ok')}>On now</span>
              )}
            </button>
          )
        })}
      </div>
    </Modal>
  )
}
