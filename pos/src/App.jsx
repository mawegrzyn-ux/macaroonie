// The till app (docs/POS.md): pair, sign in with a PIN, then the floor, a
// check, counter service, closed checks, reports and till settings. A device
// paired as a kitchen screen opens the kitchen screen instead, one paired as
// a self-order kiosk the kiosk (and ?kiosk_preview= the kiosk design preview,
// ?kiosk_share= a design's shared preview, ?kitchen_test= the kitchen test bench,
// ?kitchen_live= the live kitchen view).

import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Lock, RefreshCw, WifiOff } from 'lucide-react'
import { useTill, boot, signOut, touch, loadConfig, getState, moveTill, stayHere } from './lib/store.js'
import { belongsHere } from './lib/appHost.js'
import { MoveNotice, MovedAway } from './components/MoveNotice.jsx'
import { whenSafeToReload, idleFor } from './lib/appUpdate.js'
import { ApprovalProvider, Toasts, cx, useTick } from './components/ui.jsx'
import StatusDot from './components/StatusDot.jsx'
import { TillNavProvider, TillMenuModal, tillPages } from './components/TillMenu.jsx'
import { tillLayoutOf } from './lib/tillLayout.js'
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
// A self-order kiosk (and the kiosk design editor's preview) runs the kiosk
// app (src/kiosk), loaded only there.
const KioskApp = lazy(() => import('./kiosk/KioskApp.jsx'))
// The kitchen test bench (Store tech > Kitchen screens > Test the kitchen):
// ?kitchen_test= opens the bench, &screen= one of its scaled-down screens.
const Bench = lazy(() => import('./kitchen/Bench.jsx'))
const BenchScreen = lazy(() => import('./kitchen/BenchScreen.jsx'))
const QUERY = new URLSearchParams(location.search)
const PREVIEW = QUERY.get('kiosk_preview')
// A recorded visit played back (Store tech > Kiosk analytics): the preview with &replay=1.
const REPLAY = QUERY.get('replay') === '1'
// A kiosk design's shared preview (its lasting link): the share page, which
// frames the kiosk itself (&frame=1).
const SHARE = QUERY.get('kiosk_share')
const SHARE_FRAME = QUERY.get('frame') === '1'
const SharePage = lazy(() => import('./kiosk/SharePage.jsx'))
const KITCHEN_TEST = QUERY.get('kitchen_test')
const BENCH_SCREEN = QUERY.get('screen')
// The live kitchen view (Store tech > Kitchen screens > Live view): every real
// kitchen screen with the venue's orders; &screen= one of its frames.
const KITCHEN_LIVE = QUERY.get('kitchen_live')
const Live = lazy(() => import('./kitchen/Live.jsx'))

export default function App() {
  if (PREVIEW) return <Suspense fallback={<div className="h-full bg-black" />}><KioskApp previewToken={PREVIEW} replay={REPLAY} /></Suspense>
  if (SHARE) {
    return (
      <Suspense fallback={<div className="h-full bg-neutral-900" />}>
        {SHARE_FRAME ? <KioskApp shareToken={SHARE} /> : <SharePage token={SHARE} />}
      </Suspense>
    )
  }
  if (KITCHEN_TEST) {
    return (
      <Suspense fallback={<div className="h-full bg-black" />}>
        {BENCH_SCREEN ? <BenchScreen screenId={BENCH_SCREEN} /> : <Bench token={KITCHEN_TEST} />}
      </Suspense>
    )
  }
  if (KITCHEN_LIVE) {
    return (
      <Suspense fallback={<div className="h-full bg-black" />}>
        {BENCH_SCREEN ? <BenchScreen screenId={BENCH_SCREEN} host="kdsLive" /> : <Live token={KITCHEN_LIVE} />}
      </Suspense>
    )
  }
  return <TillApp />
}

function TillApp() {
  useEffect(() => {
    boot()
    const onDown = () => touch()
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [])
  // A new copy of the app goes in (lib/appUpdate.js) while nobody is signed
  // in and nobody is typing a PIN. The kitchen and kiosk apps set their own.
  useEffect(() => whenSafeToReload(() => {
    const t = getState()
    if (t.phase === 'pair' || t.phase === 'update' || t.phase === 'moved') return true
    return !t.staff && idleFor(10000)
  }), [])
  const s = useTill()
  let body
  if (s.phase === 'kitchen') return <Suspense fallback={<div className="h-full bg-black" />}><KitchenApp device={s.device} /></Suspense>
  if (s.phase === 'kiosk') return <Suspense fallback={<div className="h-full bg-black" />}><KioskApp device={s.device} /></Suspense>
  if (s.phase === 'update') body = <NeedsUpdate />
  else if (s.phase === 'moved') body = <MovedAway to={s.movedTo} onStay={stayHere} />
  else if (s.phase === 'pair') body = <Pair />
  else if (s.phase === 'loading') body = <Splash />
  else if (!s.config) body = <NoConfig />
  else if (!s.staff) body = <Login />
  else body = <ApprovalProvider><Main /></ApprovalProvider>
  // A till paired on the kitchen or kiosk address (lib/appHost.js).
  const misplaced = s.device && s.config && !belongsHere(s.device.kind)
  if (misplaced) body = <div className="h-full flex flex-col"><MoveNotice kind="terminal" onMove={moveTill} /><div className="flex-1 min-h-0">{body}</div></div>
  return <>{body}<Toasts /></>
}

function Splash() {
  return (
    <div className="h-full flex items-center justify-center">
      <img src="/till-icon.svg" alt="" className="w-16 h-16 animate-pulse" />
    </div>
  )
}

// Paired as a kind of device this copy of the app doesn't know yet: it reloads
// by itself once the newer copy has arrived (lib/appUpdate.js).
function NeedsUpdate() {
  return (
    <div className="h-full flex items-center justify-center p-6">
      <div className="card p-8 max-w-md text-center space-y-4">
        <RefreshCw className="mx-auto text-muted animate-spin" size={40} />
        <div className="text-xl font-bold">Getting the latest app</div>
        <div className="text-muted">This device was set up as something this copy of the app doesn't know yet. It opens by itself once the update has arrived.</div>
        <button className="btn btn-primary w-full" onClick={() => location.reload()}>
          <RefreshCw size={18} /> Reload now
        </button>
      </div>
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
  const [menuOpen, setMenuOpen] = useState(false)
  useTick(30000)
  const go = name => setView({ name })
  const nav = tillPages(counterMode)
  const active = view.name === 'check' ? (counterMode ? 'counter' : 'floor') : view.name
  // A till layout without the top bar (Store tech > Till layouts): the order
  // screens (a check, the counter) take the whole screen and the till menu is
  // in More; the till's other pages keep the bar.
  const layout = useMemo(() => tillLayoutOf(config), [config])
  const hideBar = layout?.top_bar === false && (view.name === 'check' || view.name === 'counter')
  const navValue = useMemo(() => ({ go, view: view.name, counterMode, hideBar, openMenu: () => setMenuOpen(true) }), [view.name, counterMode, hideBar]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <TillNavProvider value={navValue}>
      <div className="h-full flex flex-col" data-top-bar={hideBar ? '0' : '1'}>
        {!hideBar && (
          <header className="h-16 shrink-0 bg-ink text-white flex items-center gap-2 px-3" data-testid="top-bar">
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
        )}
        <main className="flex-1 min-h-0">
          {view.name === 'floor' && <Floor onOpen={id => setView({ name: 'check', id })} />}
          {view.name === 'check' && <CheckScreen checkId={view.id} onBack={() => setView(counterMode ? { name: 'counter' } : { name: 'floor' })} onOpen={id => setView({ name: 'check', id })} />}
          {view.name === 'counter' && <Counter onOpenCheck={id => setView({ name: 'check', id })} />}
          {view.name === 'closed' && <Closed />}
          {view.name === 'reports' && <Reports />}
          {view.name === 'settings' && <TillSettings />}
        </main>
        {menuOpen && <TillMenuModal onClose={() => setMenuOpen(false)} />}
      </div>
    </TillNavProvider>
  )
}
