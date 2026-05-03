// Shared primitives reused by every block editor.
import { useState, useRef } from 'react'
import { useApi } from '@/lib/api'
import { Loader2, Upload, Image as ImageIcon } from 'lucide-react'
import { MediaLibraryModal } from '@/components/media/MediaLibrary'

export function FormRow({ label, hint, children }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase font-semibold text-muted-foreground tracking-wide block mb-1">{label}</span>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground mt-1">{hint}</p>}
    </label>
  )
}

export function ImageField({ url, onChange, scope = 'shared' }) {
  const api = useApi()
  const inputRef = useRef(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [uploading, setUploading]   = useState(false)

  async function handleFiles(files) {
    if (!files?.[0]) return
    setUploading(true)
    try {
      const res = await api.upload('/website/upload', files[0], { kind: 'images', scope })
      onChange(res.url)
    } catch (e) {
      alert(e?.body?.error || e.message || 'Upload failed')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div>
      <input ref={inputRef} type="file" accept="image/*" hidden onChange={e => handleFiles(e.target.files)} />
      {url ? (
        <div className="flex items-center gap-2">
          <img src={url} alt="" className="w-16 h-16 object-cover rounded border" />
          <div className="flex flex-col gap-1 text-xs">
            <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading}
              className="inline-flex items-center gap-1 text-primary hover:underline">
              {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />} Replace
            </button>
            <button type="button" onClick={() => setPickerOpen(true)}
              className="inline-flex items-center gap-1 text-primary hover:underline">
              <ImageIcon className="w-3 h-3" /> Library
            </button>
            <button type="button" onClick={() => onChange(null)}
              className="text-destructive hover:underline self-start">Remove</button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading}
            className="inline-flex items-center gap-1.5 border rounded-md px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50">
            {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} Upload
          </button>
          <span className="text-xs text-muted-foreground">or</span>
          <button type="button" onClick={() => setPickerOpen(true)}
            className="inline-flex items-center gap-1.5 border rounded-md px-3 py-1.5 text-sm hover:bg-accent">
            <ImageIcon className="w-3.5 h-3.5" /> Library
          </button>
        </div>
      )}
      <MediaLibraryModal open={pickerOpen} onClose={() => setPickerOpen(false)}
        mode="picker" scope={scope} onPick={(picked) => onChange(picked)} />
    </div>
  )
}
