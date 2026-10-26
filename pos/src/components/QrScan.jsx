// Reads a QR code with the device's camera (BarcodeDetector: Chrome on
// Android and ChromeOS). Used by the till's and the kiosk's loyalty card
// scan; a USB or Bluetooth scanner types into the scan box instead.
// onText(raw) gets each code read; return true to stop.

import { useEffect, useRef, useState } from 'react'

export const CAN_SCAN = typeof window !== 'undefined' && 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia

export default function QrScan({ onText, facing = 'environment', className = '', hint = null }) {
  const videoRef = useRef(null)
  const [error, setError] = useState(null)
  const done = useRef(onText)
  done.current = onText

  useEffect(() => {
    let stream = null
    let stop = false
    let timer = null
    ;(async () => {
      try {
        const formats = await window.BarcodeDetector.getSupportedFormats?.()
        if (formats && !formats.includes('qr_code')) throw new Error('This device can\'t read QR codes with its camera')
        const detector = new window.BarcodeDetector({ formats: ['qr_code'] })
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing }, audio: false })
        if (stop) { stream.getTracks().forEach(t => t.stop()); return }
        const v = videoRef.current
        v.srcObject = stream
        await v.play()
        const tick = async () => {
          if (stop) return
          try {
            for (const f of await detector.detect(v)) if (done.current(f.rawValue)) return
          } catch { /* a frame it couldn't read */ }
          timer = setTimeout(tick, 250)
        }
        tick()
      } catch (err) {
        if (!stop) setError(err?.name === 'NotAllowedError' ? 'The camera wasn\'t allowed' : err?.message || 'The camera couldn\'t start')
      }
    })()
    return () => {
      stop = true
      clearTimeout(timer)
      stream?.getTracks().forEach(t => t.stop())
    }
  }, [facing])

  return (
    <div className={'relative overflow-hidden rounded-2xl bg-black ' + className} data-testid="qr-scan">
      <video ref={videoRef} playsInline muted className="absolute inset-0 w-full h-full object-cover" />
      <div className="absolute inset-[18%] rounded-2xl border-4 border-white/90" />
      {(error || hint) && <div className="absolute inset-x-0 bottom-0 p-2 text-center text-sm text-white bg-black/50">{error || hint}</div>}
    </div>
  )
}
