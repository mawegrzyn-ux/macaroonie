// The till menu: the till's pages (floor, counter, closed orders, reports,
// till settings), sign out and the till's details (location, till, who is
// signed in, the time, the connection). It is the top bar's job; a till
// layout can take the top bar away from the order screen (Store tech > Till
// layouts, top_bar false, shared/pos/tillLayout.js), and then the till menu
// is in More (CheckActions.jsx ActionsMenu), on the counter's New order
// panel, and behind a Buttons zone's Till menu button.
//
// TillNav (App.jsx Main) carries the navigation down: go(view), the view on
// screen, counter mode, whether the top bar is hidden, openMenu().

import { createContext, useContext } from 'react'
import { LayoutGrid, ShoppingBag, Receipt, BarChart3, Settings, Lock } from 'lucide-react'
import { useTill, signOut } from '../lib/store.js'
import { Modal, cx, useTick } from './ui.jsx'
import StatusDot from './StatusDot.jsx'

const TillNav = createContext({ go: () => {}, view: null, counterMode: false, hideBar: false, openMenu: () => {} })
export const TillNavProvider = TillNav.Provider
export const useTillNav = () => useContext(TillNav)

/** The till's pages, as the top bar lists them. */
export function tillPages(counterMode) {
  return [
    !counterMode && { key: 'floor', label: 'Floor', icon: LayoutGrid },
    { key: 'counter', label: 'Counter', icon: ShoppingBag },
    { key: 'closed', label: 'Closed', icon: Receipt },
    { key: 'reports', label: 'Reports', icon: BarChart3 },
    { key: 'settings', label: 'Till', icon: Settings },
  ].filter(Boolean)
}

/** The till's details, its pages and Sign out. onDone: closes the window it sits in. */
export function TillMenuSection({ onDone = () => {} }) {
  const { config, staff, device } = useTill()
  const nav = useTillNav()
  useTick(30000)
  const active = nav.view === 'check' ? (nav.counterMode ? 'counter' : 'floor') : nav.view
  return (
    <div className="space-y-3" data-testid="till-menu">
      <div className="rounded-xl bg-page px-4 py-3 flex items-center gap-3" data-testid="till-menu-info">
        <div className="flex-1 min-w-0 leading-tight">
          <div className="font-bold truncate">{config?.venue?.name}</div>
          <div className="text-sm text-muted truncate">{device?.name} · {staff?.name}</div>
        </div>
        <StatusDot />
        <div className="font-semibold tabular-nums text-lg">{new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {tillPages(nav.counterMode).map(p => (
          <button key={p.key} className={cx('btn h-auto min-h-[64px] py-2 justify-start text-left', active === p.key && 'border-brand bg-brand-soft')}
            onClick={() => { onDone(); nav.go(p.key) }} data-testid={'till-go-' + p.key} aria-current={active === p.key ? 'page' : undefined}>
            <p.icon size={22} className="shrink-0 text-brand" /><span>{p.label}</span>
          </button>
        ))}
        <button className="btn h-auto min-h-[64px] py-2 justify-start text-left" onClick={() => { onDone(); signOut() }} data-testid="till-sign-out">
          <Lock size={22} className="shrink-0 text-brand" /><span className="flex flex-col leading-tight min-w-0"><span>Sign out</span><span className="text-xs text-muted font-normal truncate">{staff?.name}</span></span>
        </button>
      </div>
    </div>
  )
}

/** The till menu in a window of its own (a Till menu button, the counter panel). */
export function TillMenuModal({ onClose }) {
  return (
    <Modal title="Till menu" onClose={onClose} wide>
      <TillMenuSection onDone={onClose} />
    </Modal>
  )
}
