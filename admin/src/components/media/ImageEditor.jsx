// src/components/media/ImageEditor.jsx
//
// Image editor modal — crop, rotate, flip an image from the media library.
// Two save options: "Save as new" creates a new media item, "Replace" overwrites
// the file behind the existing item (id stays, url changes).
//
// Cropping via react-easy-crop. Rotate / flip applied via canvas at export.
// Aspect ratio presets: free, 1:1, 4:3, 3:2, 16:9, 9:16.

import { useState, useCallback, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Cropper from 'react-easy-crop'
import {
  X, Crop, RotateCw, RotateCcw, FlipHorizontal, FlipVertical,
  Save, Loader2, RefreshCw, Check, AlertTriangle,
} from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'

const ASPECTS = [
  { label: 'Free',  value: null },
  { label: '1:1',   value: 1 },
  { label: '4:3',   value: 4 / 3 },
  { label: '3:2',   value: 3 / 2 },
  { label: '16:9',  value: 16 / 9 },
  { label: '9:16',  value: 9 / 16 },
]

export function ImageEditor({ item, onClose, onSaved }) {
  const api = useApi()
  const qc  = useQueryClient()

  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [aspect, setAspect] = useState(null)
  const [rotation, setRotation] = useState(0)
  const [flipH, setFlipH] = useState(false)
  const [flipV, setFlipV] = useState(false)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null)
  const [error, setError] = useState(null)
  const [saveMode, setSaveMode] = useState('new')   // 'new' | 'replace'

  const onCropComplete = useCallback((_, areaPixels) => {
    setCroppedAreaPixels(areaPixels)
  }, [])

  const reset = () => {
    setCrop({ x: 0, y: 0 })
    setZoom(1)
    setAspect(null)
    setRotation(0)
    setFlipH(false)
    setFlipV(false)
  }

  const saveNew = useMutation({
    mutationFn: async (blob) => {
      const filename = renameForEdit(item.filename, 'edited')
      const file = new File([blob], filename, { type: blob.type })
      return api.upload('/media/items/upload', file, {
        scope: item.scope,
        ...(item.category_id ? { category_id: item.category_id } : {}),
      })
    },
    onSuccess: (newItem) => {
      qc.invalidateQueries({ queryKey: ['media-items'] })
      qc.invalidateQueries({ queryKey: ['media-categories'] })
      onSaved?.(newItem, 'new')
      onClose()
    },
    onError: (e) => setError(e?.body?.error || e.message || 'Save failed'),
  })

  const replaceOriginal = useMutation({
    mutationFn: async (blob) => {
      const filename = item.filename
      const file = new File([blob], filename, { type: blob.type })
      return api.upload(`/media/items/${item.id}/replace`, file, {})
    },
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ['media-items'] })
      onSaved?.(updated, 'replace')
      onClose()
    },
    onError: (e) => setError(e?.body?.error || e.message || 'Replace failed'),
  })

  const saving = saveNew.isPending || replaceOriginal.isPending

  const handleSave = async () => {
    setError(null)
    if (!croppedAreaPixels) {
      setError('Crop area not ready — try again in a moment')
      return
    }
    try {
      const blob = await getEditedBlob(item.url, croppedAreaPixels, rotation, flipH, flipV, item.mimetype)
      if (saveMode === 'new') saveNew.mutate(blob)
      else                    replaceOriginal.mutate(blob)
    } catch (e) {
      setError(e?.message || 'Failed to render edit')
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex flex-col" onClick={(e) => e.stopPropagation()}>
      {/* Header */}
      <div className="h-14 px-5 border-b border-white/10 flex items-center justify-between text-white shrink-0">
        <div className="flex items-center gap-2">
          <Crop className="w-4 h-4" />
          <h2 className="font-semibold">Edit image</h2>
          <span className="ml-3 text-xs text-white/60 truncate max-w-md">{item.filename}</span>
        </div>
        <button onClick={onClose} className="p-2 rounded hover:bg-white/10">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Cropper area */}
      <div className="flex-1 relative bg-zinc-900">
        <Cropper
          image={item.url}
          crop={crop}
          zoom={zoom}
          aspect={aspect ?? undefined}
          rotation={rotation}
          transform={`translate(${crop.x}px, ${crop.y}px) rotate(${rotation}deg) scale(${flipH ? -1 : 1}, ${flipV ? -1 : 1}) scale(${zoom})`}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onRotationChange={setRotation}
          onCropComplete={onCropComplete}
          showGrid
          restrictPosition={false}
          objectFit="contain"
        />
      </div>

      {/* Toolbar */}
      <div className="border-t border-white/10 bg-zinc-900 text-white shrink-0">
        <div className="px-5 py-3 flex flex-wrap items-center gap-x-6 gap-y-3">
          {/* Aspect ratios */}
          <div className="flex items-center gap-1">
            <span className="text-xs text-white/60 mr-2">Aspect:</span>
            {ASPECTS.map(a => (
              <button key={a.label} onClick={() => setAspect(a.value)}
                className={cn(
                  'px-2.5 py-1 text-xs rounded',
                  aspect === a.value ? 'bg-primary text-primary-foreground' : 'border border-white/20 hover:bg-white/10'
                )}>
                {a.label}
              </button>
            ))}
          </div>

          {/* Rotate */}
          <div className="flex items-center gap-1">
            <span className="text-xs text-white/60 mr-2">Rotate:</span>
            <ToolbarButton onClick={() => setRotation(r => (r - 90 + 360) % 360)} title="Rotate 90° CCW">
              <RotateCcw className="w-3.5 h-3.5" />
            </ToolbarButton>
            <ToolbarButton onClick={() => setRotation(r => (r + 90) % 360)} title="Rotate 90° CW">
              <RotateCw className="w-3.5 h-3.5" />
            </ToolbarButton>
            <span className="text-xs text-white/40 ml-1 w-8">{rotation}°</span>
          </div>

          {/* Flip */}
          <div className="flex items-center gap-1">
            <span className="text-xs text-white/60 mr-2">Flip:</span>
            <ToolbarButton onClick={() => setFlipH(v => !v)} active={flipH} title="Flip horizontal">
              <FlipHorizontal className="w-3.5 h-3.5" />
            </ToolbarButton>
            <ToolbarButton onClick={() => setFlipV(v => !v)} active={flipV} title="Flip vertical">
              <FlipVertical className="w-3.5 h-3.5" />
            </ToolbarButton>
          </div>

          {/* Zoom */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/60">Zoom:</span>
            <input type="range" min={1} max={3} step={0.05} value={zoom}
              onChange={e => setZoom(Number(e.target.value))}
              className="w-32 accent-[var(--primary)]" />
            <span className="text-xs text-white/40 w-10">{zoom.toFixed(2)}×</span>
          </div>

          <button onClick={reset}
            className="ml-auto inline-flex items-center gap-1.5 text-xs text-white/70 hover:text-white">
            <RefreshCw className="w-3 h-3" /> Reset
          </button>
        </div>

        {/* Footer with save options */}
        <div className="px-5 py-3 border-t border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {error && (
              <p className="text-xs text-rose-400 inline-flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> {error}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose}
              className="text-sm text-white/70 hover:text-white px-4 py-2">Cancel</button>
            <div className="inline-flex items-center gap-1 rounded-md border border-white/20 p-0.5">
              <button onClick={() => setSaveMode('new')}
                className={cn('px-3 py-1.5 text-xs rounded', saveMode === 'new' ? 'bg-primary text-primary-foreground' : 'hover:bg-white/10')}>
                Save as new
              </button>
              <button onClick={() => setSaveMode('replace')}
                className={cn('px-3 py-1.5 text-xs rounded', saveMode === 'replace' ? 'bg-primary text-primary-foreground' : 'hover:bg-white/10')}>
                Replace original
              </button>
            </div>
            <button onClick={handleSave} disabled={saving || !croppedAreaPixels}
              className="bg-primary text-primary-foreground text-sm font-medium rounded-md px-4 py-2 min-h-[40px] inline-flex items-center gap-2 disabled:opacity-50">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {saving ? 'Saving…' : (saveMode === 'replace' ? 'Replace' : 'Save copy')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ToolbarButton({ onClick, active, title, children }) {
  return (
    <button onClick={onClick} title={title}
      className={cn('p-1.5 rounded',
        active ? 'bg-primary text-primary-foreground' : 'border border-white/20 hover:bg-white/10')}>
      {children}
    </button>
  )
}

// ──────────────────────────────────────────────────────────
// Canvas-based crop + rotate + flip → Blob.
// rotation is in degrees (multiples of 1° accepted, but UI emits 90° steps).
// ──────────────────────────────────────────────────────────

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload  = () => resolve(img)
    img.onerror = (e) => reject(new Error('Failed to load image (possible CORS issue)'))
    img.src = src
  })
}

function rad(deg) { return (deg * Math.PI) / 180 }

async function getEditedBlob(imageUrl, pixelCrop, rotation, flipH, flipV, mime = 'image/png') {
  const img = await loadImage(imageUrl)
  // The cropper returns pixelCrop relative to the original image bounding box.
  // We need to render: draw image rotated + flipped on a canvas, then extract the crop region.
  //
  // Strategy: create an "expanded" canvas big enough to hold the rotated image,
  // draw the rotated/flipped image, then create a final canvas of size pixelCrop
  // and copy from the expanded canvas at the offset implied by pixelCrop.

  const rotRad = rad(rotation)
  const sin = Math.abs(Math.sin(rotRad))
  const cos = Math.abs(Math.cos(rotRad))
  const w = img.naturalWidth
  const h = img.naturalHeight
  const expW = Math.floor(w * cos + h * sin)
  const expH = Math.floor(w * sin + h * cos)

  const exp = document.createElement('canvas')
  exp.width  = expW
  exp.height = expH
  const ectx = exp.getContext('2d')
  if (!ectx) throw new Error('Canvas 2D not available')
  ectx.imageSmoothingQuality = 'high'

  ectx.translate(expW / 2, expH / 2)
  ectx.rotate(rotRad)
  ectx.scale(flipH ? -1 : 1, flipV ? -1 : 1)
  ectx.drawImage(img, -w / 2, -h / 2)

  // Crop
  const out = document.createElement('canvas')
  out.width  = Math.max(1, Math.round(pixelCrop.width))
  out.height = Math.max(1, Math.round(pixelCrop.height))
  const octx = out.getContext('2d')
  if (!octx) throw new Error('Canvas 2D not available')
  octx.imageSmoothingQuality = 'high'

  // pixelCrop coordinates from react-easy-crop are relative to the original image
  // BEFORE rotation. After we draw the image into the rotated `exp` canvas, the
  // top-left of the original image maps to (expW/2 - w/2, expH/2 - h/2). For
  // rotation = 0 this collapses to (0, 0); for 90/180/270 the coordinates work
  // out because we sized expW/expH to fit the rotated bounding box.
  const offsetX = expW / 2 - w / 2
  const offsetY = expH / 2 - h / 2

  octx.drawImage(
    exp,
    Math.round(pixelCrop.x + offsetX),
    Math.round(pixelCrop.y + offsetY),
    Math.round(pixelCrop.width),
    Math.round(pixelCrop.height),
    0, 0,
    out.width, out.height,
  )

  // Choose output format. PNG is lossless but big; JPEG smaller. Match input
  // unless input is GIF/SVG (can't re-encode meaningfully) — fall back to PNG.
  const outMime = (mime === 'image/jpeg' || mime === 'image/webp') ? mime : 'image/png'
  const quality = outMime === 'image/jpeg' ? 0.92 : undefined

  return new Promise((resolve, reject) => {
    out.toBlob(b => {
      if (b) resolve(b)
      else reject(new Error('Canvas toBlob returned null'))
    }, outMime, quality)
  })
}

function renameForEdit(name, suffix) {
  const dot = name.lastIndexOf('.')
  if (dot < 0) return `${name}-${suffix}`
  return `${name.slice(0, dot)}-${suffix}${name.slice(dot)}`
}
