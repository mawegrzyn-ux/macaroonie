// src/pages/Media.jsx
//
// Standalone media library manager — opens the modal in 'manager' mode
// inline so the existing AppShell layout still wraps it. Sidebar nav
// links here for browsing/organising assets without being mid-task.

import { useEffect } from 'react'
import { MediaLibraryModal } from '@/components/media/MediaLibrary'
import { useNavigate } from 'react-router-dom'

export default function Media() {
  const navigate = useNavigate()

  // Always-open modal; closing returns to dashboard.
  useEffect(() => { /* no-op */ }, [])

  return (
    <MediaLibraryModal
      open
      mode="manager"
      onClose={() => navigate('/')}
    />
  )
}
