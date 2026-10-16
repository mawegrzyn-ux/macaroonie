// The till app (docs/POS.md): pair, sign in with a PIN, then the floor, a
// check, counter service, closed checks, reports and till settings. A device
// paired as a kitchen screen opens the kitchen screen instead.

import { lazy, Suspense, useEffect, useState } from 'react'
import { LayoutGrid, ShoppingBag, Receipt, BarChart3, Settings, Lock, RefreshCw, WifiOff } from 'lucide-react'
import { useTill, boot, signOut, touch, loadConfig } from './lib/store.js'
import { ApprovalProvider, Toasts, cx, useTick } from './components/ui.jsx'
import StatusDot from './components/StatusDot.jsx'
import Pair from './screens/Pair.jsx'
import Login from './screens/Login.jsx'
import Floor from './screens/Floor.jsx'
import CheckScreen from './screens/Check.jsx'
import Counter from './screens/Counter.jsx'
import Closed from './screens/Closed.jsx'
import Reports from './screens/Reports.jsx'
import TillSettings from './screens/TillSettings.jsx'

// A device paired as a kitchen screen runs the kitchen app (src/kitchen),
// loaded only on those devices.
const KitchenApp = lazy(() => import('./kitchen/KitchenApp.jsx'))

export default function App() {
  useEffect(() => {
    boot()
    const onDown = () => touch()
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [])
  const s = useTill()
  let body
  if (s.phase === 'kitchen') return <Suspense fallback={<div className="h-full bg-black" />}><KitchenApp device={s.device} /></Suspense>
  if (s.phase === 'pair') body = <Pair />
  else if (s.phase === 'loading') body = <Splash />
  else if (!s.config) body = <NoConfig />
  else if (!s.staff) body = <Login />
  else body = <ApprovalProvider><Main /></ApprovalProvider>
  return <>{body}<Toasts /></>
}

function Splash() {
  return (
    <div className="h-full flex items-center justify-center">
      <img src="/till-icon.svg" alt="" className="w-16 h-16 animate-pulse" />
    </div>
  )
}

function NoConfig() {
  const [busy, setBusy] = useState(false)
  return (
    <div className="h-full flex items-center justify-center p-6">
      <div className="card p-8 max-w-md text-center space-y-4">
        <WifiOff className="mx-auto text-bad" size={40} />
        <div className="text-xl font-bold">Can't reach Macaroonie</div>
        <div className="text-muted">This till needs to download its menu once before it can work offline. Check the Wi-Fi.</div>
        <button className="btn btn-primary w-full" disabled={busy} onClick={async () => { setBusy(true); await loadConfig(); setBusy(false) }}>
          <RefreshCw size={18} /> Try again
        </button>
      </div>
    </div>
  )
}

function Main() {
  const { config, staff, device } = useTill()
  const counterMode = config.device?.settings?.mode === 'counter'
  const [view, setView] = useState(counterMode ? { name: 'counter' } : { name: 'floor' })
  useTick(30000)
  const go = name => setView({ name })
  const nav = [
    !counterMode && { key: 'floor', label: 'Floor', icon: LayoutGrid },
    { key: 'counter', label: 'Counter', icon: ShoppingBag },
    { key: 'closed', label: 'Closed', icon: Receipt },
    { key: 'reports', label: 'Reports', icon: BarChart3 },
    { key: 'settings', label: 'Till', icon: Settings },
  ].filter(Boolean)
  const active = view.name === 'check' ? (counterMode ? 'counter' : 'floor') : view.name
  return (
    <div className="h-full flex flex-col">
      <header className="h-16 shrink-0 bg-ink text-white flex items-center gap-2 px-3">
        <div className="hidden lg:flex flex-col leading-tight px-2 min-w-0 max-w-[220px]">
          <div className="font-bold truncate">{config.venue?.name}</div>
          <div className="text-xs text-white/60 truncate">{device?.name}</div>
        </div>
        <nav className="flex gap-1 flex-1 min-w-0 scroll-x">
          {nav.map(n => (
            <button key={n.key} onClick={() => go(n.key)}
              className={cx('h-12 px-3 sm:px-4 rounded-xl flex items-center gap-2 font-semibold shrink-0 touch-manipulation',
                active === n.key ? 'bg-white text-ink' : 'text-white/85 active:bg-white/10')}>
              <n.icon size={20} /><span className="hidden sm:inline">{n.label}</span>
            </button>
          ))}
        </nav>
        <StatusDot dark compact />
        <div className="text-white/80 font-semibold tabular-nums px-2 hidden sm:block">
          {new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
        </div>
        <button className="h-12 px-3 rounded-xl bg-white/10 flex items-center gap-2 font-semibold touch-manipulation" onClick={signOut}>
          <Lock size={18} /><span className="max-w-[120px] truncate">{staff.name}</span>
        </button>
      </header>
      <main className="flex-1 min-h-0">
        {view.name === 'floor' && <Floor onOpen={id => setView({ name: 'check', id })} />}
        {view.name === 'check' && <CheckScreen checkId={view.id} onBack={() => setView(counterMode ? { name: 'counter' } : { name: 'floor' })} onOpen={id => setView({ name: 'check', id })} />}
        {view.name === 'counter' && <Counter onOpenCheck={id => setView({ name: 'check', id })} />}
        {view.name === 'closed' && <Closed />}
        {view.name === 'reports' && <Reports />}
        {view.name === 'settings' && <TillSettings />}
      </main>
    </div>
  )
}
