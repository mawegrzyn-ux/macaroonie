// src/contexts/TimelineSettingsContext.jsx
//
// Shared state for Timeline view settings that live in the AppShell sidebar.
// venueId, hideInactive, groupBySections, panelMode are managed here so
// AppShell can render the controls and Timeline can read/react without prop drilling.
// Boolean view preferences are persisted to localStorage so they survive page reloads.
// selectedDate is also persisted so the last-viewed date is restored across page visits
// and when switching between the Timeline and Bookings pages.

import { createContext, useContext, useState, useCallback, useEffect } from 'react'

const TimelineSettingsCtx = createContext(null)

const TL_KEY = 'maca_timeline_prefs'

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function loadPrefs() {
  try {
    const s = JSON.parse(localStorage.getItem(TL_KEY))
    return {
      hideInactive:    s?.hideInactive    ?? false,
      groupBySections: s?.groupBySections ?? true,
      panelMode:       s?.panelMode       ?? true,
      tileMode:        s?.tileMode        ?? 'compact',
      compactFontSize: s?.compactFontSize ?? 'sm',
      selectedDate:    s?.selectedDate    ?? todayStr(),
      wideColumns:     s?.wideColumns     ?? false,
    }
  } catch {
    return { hideInactive: false, groupBySections: true, panelMode: true, tileMode: 'compact', compactFontSize: 'sm', selectedDate: todayStr(), wideColumns: false }
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
  const [tileMode,         setTileMode]         = useState(prefs.tileMode)
  const [compactFontSize,  setCompactFontSize]  = useState(prefs.compactFontSize)
  const [selectedDate,     setSelectedDate]     = useState(prefs.selectedDate)
  const [wideColumns,      setWideColumns]      = useState(prefs.wideColumns)
  // Counter that Timeline watches to trigger a manual refetch
  const [refetchTrigger,   setRefetchTrigger]   = useState(0)

  const triggerRefetch = useCallback(() => setRefetchTrigger(n => n + 1), [])

  // Persist view prefs whenever they change
  useEffect(() => {
    savePrefs({ hideInactive, groupBySections, panelMode, tileMode, compactFontSize, selectedDate, wideColumns })
  }, [hideInactive, groupBySections, panelMode, tileMode, compactFontSize, selectedDate, wideColumns])

  return (
    <TimelineSettingsCtx.Provider value={{
      venueId,          setVenueId,
      hideInactive,     setHideInactive,
      groupBySections,  setGroupBySections,
      panelMode,        setPanelMode,
      tileMode,         setTileMode,
      compactFontSize,  setCompactFontSize,
      selectedDate,     setSelectedDate,
      wideColumns,      setWideColumns,
      refetchTrigger,   triggerRefetch,
    }}>
      {children}
    </TimelineSettingsCtx.Provider>
  )
}

export function useTimelineSettings() {
  return useContext(TimelineSettingsCtx)
}
