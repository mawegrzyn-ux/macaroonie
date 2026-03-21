// src/contexts/TimelineSettingsContext.jsx
//
// Shared state for Timeline view settings that live in the AppShell sidebar.
// venueId, hideInactive, groupBySections are managed here so AppShell can
// render the controls and Timeline can read/react without prop drilling.

import { createContext, useContext, useState, useCallback } from 'react'

const TimelineSettingsCtx = createContext(null)

export function TimelineSettingsProvider({ children }) {
  const [venueId,          setVenueId]          = useState(null)
  const [hideInactive,     setHideInactive]     = useState(false)
  const [groupBySections,  setGroupBySections]  = useState(true)
  // Counter that Timeline watches to trigger a manual refetch
  const [refetchTrigger,   setRefetchTrigger]   = useState(0)

  const triggerRefetch = useCallback(() => setRefetchTrigger(n => n + 1), [])

  return (
    <TimelineSettingsCtx.Provider value={{
      venueId,         setVenueId,
      hideInactive,    setHideInactive,
      groupBySections, setGroupBySections,
      refetchTrigger,  triggerRefetch,
    }}>
      {children}
    </TimelineSettingsCtx.Provider>
  )
}

export function useTimelineSettings() {
  return useContext(TimelineSettingsCtx)
}
