// src/components/MobileViewToggle.jsx
// Persistent floating button (bottom-left) sending a phone-width touch
// visitor from the desktop AppShell to the Ops app (/mobile). Mounted in
// AppShell only (target="mobile"); the Ops app has no link back to the
// standard view since it is the phone app in its own right. Unlike
// MobileSuggestModal (a one-time, dismissible nudge shown only on first
// detection), this is an always-available toggle, shown any time the
// viewport is phone-width, on every visit.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Smartphone, LayoutDashboard } from 'lucide-react'
import { mobileHref, standardHref } from '@/lib/hosts'

const IS_TOUCH = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0
const QUERY = '(max-width: 700px)'

function isPhoneWidth() {
  if (typeof window === 'undefined') return false
  return IS_TOUCH && window.matchMedia(QUERY).matches
}

export default function MobileViewToggle({ target }) {
  const navigate = useNavigate()
  const [show, setShow] = useState(false)

  useEffect(() => {
    function check() { setShow(isPhoneWidth()) }
    check()
    const mql = window.matchMedia(QUERY)
    mql.addEventListener('change', check)
    return () => mql.removeEventListener('change', check)
  }, [])

  if (!show) return null

  const goingToMobile = target === 'mobile'

  return (
    <button
      type="button"
      onClick={() => {
        // On office./ops. the other view is on the other host (lib/hosts.js).
        const href = goingToMobile ? mobileHref() : standardHref()
        if (href) window.location.assign(href)
        else navigate(goingToMobile ? '/mobile' : '/')
      }}
      className="fixed bottom-4 left-4 z-40 flex items-center gap-2 pl-3 pr-4 py-3 rounded-full bg-[#0f5c4f] text-white shadow-lg touch-manipulation min-h-[48px]"
      aria-label={goingToMobile ? 'Switch to mobile view' : 'Switch to standard view'}
    >
      {goingToMobile ? <Smartphone className="w-4 h-4" /> : <LayoutDashboard className="w-4 h-4" />}
      <span className="text-xs font-semibold">{goingToMobile ? 'Mobile view' : 'Standard view'}</span>
    </button>
  )
}
