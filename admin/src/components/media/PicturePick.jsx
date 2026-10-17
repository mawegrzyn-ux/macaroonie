// src/components/media/PicturePick.jsx
//
// One picture from the Media library: a thumbnail that opens the picker,
// takes a picture dropped on it from the computer (uploaded to Media with
// this scope, lib/fileDrop.js), and a small remove button. Used where a row
// needs a picture without taking much room: option group options, combo
// choices, the kiosk design editor.

import { useState } from 'react'
import { Image as ImageIcon, Loader2, X } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { uploadMedia } from '@/lib/fileDrop'
import { FileDropArea } from '@/components/FileDropArea'
import { MediaLibraryModal } from '@/components/media/MediaLibrary'

const SIZES = { sm: 'w-11 h-11', md: 'w-16 h-16', wide: 'w-24 h-14' }

export function PicturePick({ url, onChange, scope = 'shared', size = 'md', contain = false, disabled = false, label = 'picture', testId }) {
  const api = useApi()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  async function onFiles(files) {
    setBusy(true)
    setError(null)
    try {
      const item = await uploadMedia(api, files[0], scope)
      onChange(item.url)
    } catch (e) {
      setError(e?.body?.error || e.message || 'Upload failed')
    } finally {
      setBusy(false)
    }
  }
  return (
    <span className="relative inline-flex flex-col shrink-0" data-testid={testId}>
      <FileDropArea onFiles={onFiles} onRefused={setError} disabled={disabled || busy} label="Drop">
        <button type="button" onClick={() => setOpen(true)} disabled={disabled}
          title={url ? 'Change the ' + label + ' (or drop a picture here)' : 'Pick a ' + label + ', or drop one here'}
          aria-label={url ? 'Change the ' + label : 'Pick a ' + label}
          className={cn(SIZES[size] || SIZES.md, 'rounded-md border overflow-hidden bg-muted/30 flex items-center justify-center hover:border-primary touch-manipulation disabled:hover:border-border')}>
          {busy
            ? <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            : url
              ? <img src={url} alt="" draggable={false} className={cn('w-full h-full', contain ? 'object-contain' : 'object-cover')} />
              : <ImageIcon className="w-4 h-4 text-muted-foreground" />}
        </button>
        {url && !disabled && (
          // A finger-sized target around a small round button.
          <button type="button" onClick={() => onChange(null)} title={'Remove the ' + label} aria-label={'Remove the ' + label}
            className="absolute -top-5 -right-5 w-11 h-11 flex items-center justify-center bg-transparent touch-manipulation z-20">
            <span className="w-6 h-6 rounded-full bg-background border text-destructive flex items-center justify-center shadow-sm">
              <X className="w-3 h-3" />
            </span>
          </button>
        )}
      </FileDropArea>
      {error && <span className="text-[11px] text-destructive leading-tight max-w-[140px] mt-1">{error}</span>}
      {open && (
        <MediaLibraryModal open mode="picker" kind="image" scope={scope} onClose={() => setOpen(false)}
          onPick={picked => { onChange(picked); setOpen(false) }} />
      )}
    </span>
  )
}
