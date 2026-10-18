// src/components/installer/QrScanner.jsx
//
// Reads a device's QR code with the phone's camera, inside the installer
// (BarcodeDetector: Chrome on Android; elsewhere the phone's own camera app
// opens the code's link, which lands on the same page). Full screen, closes
// itself when it finds a code.
import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { codeFromScan } from '@/pages/installer/shared'

export const CAN_SCAN = typeof window !== 'undefined' && 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia

export default function QrScanner({ onCode, onClose }) {
  const videoRef = useRef(null)
  const [error, setError] = useState(null)
  const [unknown, setUnknown] = useState(false)
  const done = useRef(onCode)
  done.current = onCode

  useEffect(() => {
    let stream = null
    let stop = false
    let timer = null
    ;(async () => {
      try {
        const formats = await window.BarcodeDetector.getSupportedFormats?.()
        if (formats && !formats.includes('qr_code')) throw new Error('This phone can\'t read QR codes here: type the code instead.')
        const detector = new window.BarcodeDetector({ formats: ['qr_code'] })
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
        if (stop) { stream.getTracks().forEach(t => t.stop()); return }
        const v = videoRef.current
        v.srcObject = stream
        await v.play()
        const tick = async () => {
          if (stop) return
          try {
            const found = await detector.detect(v)
            for (const f of found) {
              const code = codeFromScan(f.rawValue)
              if (code) { done.current(code); return }
              setUnknown(true)
            }
          } catch { /* a frame it couldn't read */ }
          timer = setTimeout(tick, 250)
        }
        tick()
      } catch (err) {
        if (stop) return
        setError(err?.name === 'NotAllowedError'
          ? 'The camera wasn\'t allowed. Allow it for this site in the browser, or type the code.'
          : err?.message || 'The camera couldn\'t start. Type the code instead.')
      }
    })()
    return () => {
      stop = true
      clearTimeout(timer)
      stream?.getTracks().forEach(t => t.stop())
    }
  }, [])

  return (
    <div className="fixed inset-0 z-50 bg-black text-white flex flex-col" data-testid="qr-scanner">
      <div className="flex items-center gap-2 px-3" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
        <div className="flex-1 font-semibold">Point the camera at the device's QR code</div>
        <button type="button" onClick={onClose} aria-label="Close the camera"
          className="w-12 h-12 flex items-center justify-center rounded-xl bg-white/10 touch-manipulation">
          <X className="w-6 h-6" />
        </button>
      </div>
      <div className="relative flex-1 min-h-0 flex items-center justify-center">
        <video ref={videoRef} playsInline muted className="absolute inset-0 w-full h-full object-cover" />
        <div className="relative w-64 h-64 max-w-[70vw] max-h-[70vw] rounded-3xl border-4 border-white/90 shadow-[0_0_0_100vmax_rgba(0,0,0,0.45)]" />
      </div>
      <div className="p-4 text-center text-sm" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
        {error
          ? <span className="text-red-300 font-semibold">{error}</span>
          : unknown ? 'That QR code isn\'t a Macaroonie device code.' : 'The code is read by itself.'}
      </div>
    </div>
  )
}
