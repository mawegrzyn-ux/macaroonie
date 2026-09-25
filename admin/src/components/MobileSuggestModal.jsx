// src/components/MobileSuggestModal.jsx
// One-time nudge, shown on the desktop AppShell, offering the purpose-built
// /mobile experience to a touch device in portrait — the tablet-first
// sidebar layout assumes >=1015px per the Standard Design Rules, which is
// the wrong shape for a phone. Dismissing (either button) is remembered in
// localStorage so it only ever offers once per browser, not on every visit.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Smartphone, X } from 'lucide-react'

const IS_TOUCH = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0
const DISMISSED_KEY = 'maca_mobile_prompt_dismissed'
const QUERY = '(max-width: 700px) and (orientation: portrait)'

function isPortraitPhone() {
  if (typeof window === 'undefined') return false
  return IS_TOUCH && window.matchMedia(QUERY).matches
}

export default function MobileSuggestModal() {
  const navigate = useNavigate()
  const [show, setShow] = useState(false)

  useEffect(() => {
    let dismissed = false
    try { dismissed = localStorage.getItem(DISMISSED_KEY) === '1' } catch { /* ignore */ }
    if (dismissed) return

    function check() {
      if (isPortraitPhone()) setShow(true)
    }
    check()

    // Also catch a mid-session rotation into portrait, not just page load.
    const mql = window.matchMedia(QUERY)
    mql.addEventListener('change', check)
    return () => mql.removeEventListener('change', check)
  }, [])

  function dismiss() {
    setShow(false)
    try { localStorage.setItem(DISMISSED_KEY, '1') } catch { /* ignore */ }
  }

  function openMobile() {
    try { localStorage.setItem(DISMISSED_KEY, '1') } catch { /* ignore */ }
    navigate('/mobile')
  }

  if (!show) return null

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="relative bg-background rounded-2xl shadow-2xl w-full max-w-sm max-h-[85vh] overflow-y-auto p-6 text-center">
        <button
          onClick={dismiss}
          className="absolute top-3 right-3 p-2 rounded-lg hover:bg-accent text-muted-foreground touch-manipulation"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
        <span className="mx-auto mb-4 w-16 h-16 rounded-2xl bg-[#0f5c4f]/10 text-[#0f5c4f] flex items-center justify-center">
          <Smartphone className="w-8 h-8" />
        </span>
        <h2 className="text-lg font-semibold mb-2">Try the mobile view</h2>
        <p className="text-sm text-muted-foreground mb-6">
          This admin portal is built for tablets. On a phone, the Ops mobile
          view is a lot easier to use one-handed — H&amp;S Dashboard,
          Expenses, and Order Sheets, laid out for a phone screen.
        </p>
        <div className="flex flex-col gap-2">
          <button
            onClick={openMobile}
            className="w-full bg-primary text-primary-foreground rounded-xl py-3.5 text-sm font-semibold touch-manipulation min-h-[48px]"
          >
            Open mobile view
          </button>
          <button
            onClick={dismiss}
            className="w-full text-sm text-muted-foreground py-2.5 touch-manipulation min-h-[44px]"
          >
            Stay on this page
          </button>
        </div>
      </div>
    </div>
  )
}
