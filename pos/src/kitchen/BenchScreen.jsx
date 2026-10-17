// One kitchen screen on the kitchen test bench (Bench.jsx): the real kitchen
// screen app in a frame, talking to the bench's pretend kitchen through the
// parent page (window.parent.kdsBench) instead of the server. Opened as
// /?kitchen_test=<token>&screen=<id> by the bench only.

import { useMemo } from 'react'
import KitchenApp from './KitchenApp.jsx'

export default function BenchScreen({ screenId }) {
  const link = useMemo(() => {
    try {
      return window.parent !== window ? window.parent.kdsBench?.connect(screenId) || null : null
    } catch {
      return null
    }
  }, [screenId])
  if (!link) {
    return (
      <div className="h-full bg-black text-white flex items-center justify-center p-6 text-center">
        This screen only works inside the kitchen test page. Open Test the kitchen from Till setup, Kitchen screens.
      </div>
    )
  }
  return <KitchenApp device={link.device} bench={link} />
}
