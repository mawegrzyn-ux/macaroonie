// Sign in with a PIN. Works offline: the PIN is checked on the till.
import { useTill, signIn } from '../lib/store.js'
import { PinPad, useTick } from '../components/ui.jsx'
import StatusDot from '../components/StatusDot.jsx'

export default function Login() {
  const { config, device } = useTill()
  useTick(15000)
  const now = new Date()
  return (
    <div className="h-full flex">
      <div className="hidden md:flex flex-col justify-between w-[40%] bg-ink text-white p-10">
        <div className="flex items-center gap-3">
          <img src="/till-icon.svg" alt="" className="w-12 h-12" />
          <div>
            <div className="text-xl font-bold">{config?.venue?.name}</div>
            <div className="text-white/70">{device?.name}</div>
          </div>
        </div>
        <div>
          <div className="text-6xl font-bold tabular-nums">{now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</div>
          <div className="text-white/70 text-lg mt-1">{now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
        </div>
        <StatusDot dark />
      </div>
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="text-2xl font-bold mb-1">Type your PIN</div>
        <div className="text-muted mb-6 md:hidden">{config?.venue?.name} · {device?.name}</div>
        <PinPad onSubmit={signIn} />
      </div>
    </div>
  )
}
