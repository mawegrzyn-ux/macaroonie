// src/components/FileDropArea.jsx
//
// Wraps a picture field (or any area) so a picture dropped on it from the
// computer is used: onFiles(files) gets the dropped pictures (or videos,
// with kinds). A dashed outline shows while one is held over it. See
// lib/fileDrop.js.

import { cn } from '@/lib/utils'
import { useFileDrop } from '@/lib/fileDrop'

export function FileDropArea({
  onFiles, onRefused, kinds = ['image'], disabled = false, className, label = 'Drop to use this picture', children,
}) {
  const { over, dropProps } = useFileDrop({ onFiles, onRefused, kinds, disabled })
  return (
    <div {...dropProps} className={cn('relative', className)} data-file-drop="">
      {children}
      {over && (
        <div className="absolute inset-0 z-10 rounded-md border-2 border-dashed border-primary bg-primary/10 flex items-center justify-center pointer-events-none">
          {label && <span className="text-[11px] font-medium text-primary bg-background/90 rounded px-1.5 py-0.5 text-center leading-tight">{label}</span>}
        </div>
      )}
    </div>
  )
}
