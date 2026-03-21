// src/contexts/TimelineSettingsContext.jsx
//
// Shared state for Timeline view settings that live in the AppShell sidebar.
// venueId, hideInactive, groupBySections, panelMode are managed here so
// AppShell can render the controls and Timeline can read/react without prop drilling.
// Boolean view preferences are persisted to localStorage so they survive page reloads.

import { createContext, useContext, useState, useCallback, useEffect } from 'react'

const TimelineSettingsCtx = createContext(null)

const TL_KEY = 'maca_timeline_prefs'

function loadPrefs() {
  try {
    const s = JSON.parse(localStorage.getItem(TL_KEY))
    return {
      hideInactive:    s?.hideInactive    ?? false,
      groupBySections: s?.groupBySections ?? true,
      panelMode:       s?.panelMode       ?? true,
    }
  } catch {
    return { hideInactive: false, groupBySections: true, panelMode: true }
  }
}

function savePrefs(prefs) {
  try { localStorage.setItem(TL_KEY, JSON.stringify(prefs)) } catch {}
}

export function TimelineSettingsProvider({ children }) {
  const prefs = loadPrefs()
  const [venueId,          setVenueId]          = useState(null)
  const [hideInactive,     setHideInactive]     = useState(prefs.hideInactive)
  const [groupBySections,  setGroupBySections]  = useState(prefs.groupBySections)
  const [panelMode,        setPanelMode]        = useState(prefs.panelMode)
  // Counter that Timeline watches to trigger a manual refetch
  const [refetchTrigger,   setRefetchTrigger]   = useState(0)

  const triggerRefetch = useCallback(() => setRefetchTrigger(n => n + 1), [])

  // Persist view prefs whenever they change
  useEffect(() => {
    savePrefs({ hideInactive, groupBySections, panelMode })
  }, [hideInactive, groupBySections, panelMode])

  return (
    <TimelineSettingsCtx.Provider value={{
      venueId,         setVenueId,
      hideInactive,    setHideInactive,
      groupBySections, setGroupBySections,
      panelMode,       setPanelMode,
      refetchTrigger,  triggerRefetch,
    }}>
      {children}
    </TimelineSettingsCtx.Provider>
  )
}

export function useTimelineSettings() {
  return useContext(TimelineSettingsCtx)
}
