// Connection and sync status: green synced, amber sending, red offline.
import { useTill } from '../lib/store.js'
import { cx } from './ui.jsx'

export default function StatusDot({ dark = false, compact = false }) {
  const { online, outbox, socket } = useTill()
  const waiting = outbox.length
  const label = !online ? (waiting ? 'Offline · ' + waiting + ' to send' : 'Offline')
    : waiting ? 'Sending ' + waiting : socket === 'open' ? 'Live' : 'Online'
  const colour = !online ? 'bg-bad' : waiting ? 'bg-warn' : 'bg-ok'
  return (
    <div className={cx('inline-flex items-center gap-2 text-sm font-semibold', dark ? 'text-white/80' : 'text-muted')} title={label}>
      <span className={cx('w-3 h-3 rounded-full', colour, !online && 'animate-pulse')} />
      {!compact && <span>{label}</span>}
    </div>
  )
}
