// src/hooks/useRealtimeBookings.js
// Connects to WS, listens for booking events, invalidates TanStack Query cache.
// The API should broadcast on: booking.created, booking.updated, booking.deleted

import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth0 } from '@auth0/auth0-react'

export function useRealtimeBookings(venueId) {
  const queryClient = useQueryClient()
  const { getAccessTokenSilently } = useAuth0()
  const wsRef = useRef(null)

  useEffect(() => {
    if (!venueId) return

    let ws
    let reconnectTimer

    async function connect() {
      try {
        const token = await getAccessTokenSilently()
        const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
        const url   = `${proto}://${window.location.host}/ws?venue=${venueId}&token=${token}`

        ws = new WebSocket(url)
        wsRef.current = ws

        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data)
            if (['booking.created', 'booking.updated', 'booking.deleted'].includes(msg.type)) {
              // Invalidate all booking queries for this venue — TanStack Query refetches
              queryClient.invalidateQueries({ queryKey: ['bookings', venueId] })
              queryClient.invalidateQueries({ queryKey: ['bookings'] })
            }
          } catch {}
        }

        ws.onclose = () => {
          reconnectTimer = setTimeout(connect, 3000)
        }

        ws.onerror = () => ws.close()

      } catch (err) {
        reconnectTimer = setTimeout(connect, 5000)
      }
    }

    connect()

    return () => {
      clearTimeout(reconnectTimer)
      ws?.close()
    }
  }, [venueId, getAccessTokenSilently, queryClient])
}
