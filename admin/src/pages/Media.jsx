// src/pages/Media.jsx
//
// Standalone media library (sidebar Media link). Renders the library as a
// normal page inside AppShell (`inline`), not as a modal; pickers elsewhere
// still open it as a modal.

import { MediaLibraryModal } from '@/components/media/MediaLibrary'

export default function Media() {
  return <MediaLibraryModal open inline mode="manager" />
}
