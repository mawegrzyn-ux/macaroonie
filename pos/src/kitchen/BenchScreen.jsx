// One kitchen screen in a frame, on the kitchen test bench (Bench.jsx) or the
// live kitchen view (Live.jsx): the real kitchen screen app, talking to that
// page through window.parent[host] (kdsBench or kdsLive) instead of the
// server. Opened as /?kitchen_test=<token>&screen=<id> by the bench and
// /?kitchen_live=<token>&screen=<id> by the live view only.

import { useMemo } from 'react'
import KitchenApp from './KitchenApp.jsx'

const WORDS = {
  kdsBench: 'This screen only works inside the kitchen test page. Open Test the kitchen from Store tech, Kitchen screens.',
  kdsLive: 'This screen only works inside the live kitchen view. Open Live view from Store tech, Kitchen screens.',
}

export default function BenchScreen({ screenId, host = 'kdsBench' }) {
  const link = useMemo(() => {
    try {
      return window.parent !== window ? window.parent[host]?.connect(screenId) || null : null
    } catch {
      return null
    }
  }, [screenId, host])
  if (!link) {
    return (
      <div className="h-full bg-black text-white flex items-center justify-center p-6 text-center">
        {WORDS[host] || WORDS.kdsBench}
      </div>
    )
  }
  return <KitchenApp device={link.device} bench={link} />
}
