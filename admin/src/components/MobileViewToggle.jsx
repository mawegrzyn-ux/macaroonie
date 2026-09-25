// src/components/MobileViewToggle.jsx
// Persistent floating button (bottom-left) letting a phone-width touch
// visitor jump straight between the desktop AppShell and the /mobile
// experience without hunting for a menu item. Mounted once in AppShell
// (target="mobile") and once in MobileShell (target="standard") — unlike
// MobileSuggestModal (a one-time, dismissible nudge shown only on first
// detection), this is an always-available toggle, shown any time the
// viewport is phone-width, on every visit.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Smartphone, LayoutDashboard } from 'lucide-react'

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
      onClick={() => navigate(goingToMobile ? '/mobile' : '/')}
      className="fixed bottom-4 left-4 z-40 flex items-center gap-2 pl-3 pr-4 py-3 rounded-full bg-[#0f5c4f] text-white shadow-lg touch-manipulation min-h-[48px]"
      aria-label={goingToMobile ? 'Switch to mobile view' : 'Switch to standard view'}
    >
      {goingToMobile ? <Smartphone className="w-4 h-4" /> : <LayoutDashboard className="w-4 h-4" />}
      <span className="text-xs font-semibold">{goingToMobile ? 'Mobile view' : 'Standard view'}</span>
    </button>
  )
}
