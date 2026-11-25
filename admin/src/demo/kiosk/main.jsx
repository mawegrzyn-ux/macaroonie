// src/demo/kiosk/main.jsx
//
// The kiosk designer demo (macaroonie.com/try/kiosk, framed by the page; the
// build is vite.demo.config.js, entry demo-kiosk.html). The office's real
// kiosk designer (pages/KioskDesigner.jsx) with its real panels, media
// picker and theme maker, inside the providers it needs, without Auth0: the
// demo build swaps src/lib/api.js for demoApi.js, which answers its routes
// from the demo's own data and keeps saves in this browser (demoStore.js).
// Its preview is the real kiosk app in demo mode (pos/src/kiosk/demo), which
// gets the menu from this page (bridge.js) and the design from the
// designer, as the office's preview does.

import React from 'react'
import ReactDOM from 'react-dom/client'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { installDropGuard } from '@/lib/fileDrop'
import KioskDesigner from '@/pages/KioskDesigner'
import { getDemo } from './demoStore.js'
import { startKioskBridge } from './bridge.js'
import { DemoBar, DemoDesigns, PhoneDemo, usePhone } from './DemoShell.jsx'
import '@/index.css'

if (navigator.maxTouchPoints > 0) document.documentElement.setAttribute('data-touch', '')
// The card headers' accent: Harbour & Co's.
document.documentElement.style.setProperty('--site-accent', '#0b5d7a')
document.documentElement.style.setProperty('--site-accent-soft', 'rgba(11, 93, 122, 0.10)')
installDropGuard()
startKioskBridge()

// The design open last time, else the demo's own.
const start = getDemo().designs.find(d => d.id === getDemo().open) || getDemo().designs[0]

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
})

function Demo() {
  const phone = usePhone()
  if (phone) return <PhoneDemo />
  return (
    <div className="h-full flex flex-col">
      <DemoBar />
      <div className="flex-1 min-h-0">
        <Routes>
          <Route path="/pos/kiosk-designs/:id" element={<KioskDesigner />} />
          <Route path="*" element={<DemoDesigns />} />
        </Routes>
      </div>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/pos/kiosk-designs/' + start.id]}>
        <Demo />
      </MemoryRouter>
    </QueryClientProvider>
  </React.StrictMode>,
)
