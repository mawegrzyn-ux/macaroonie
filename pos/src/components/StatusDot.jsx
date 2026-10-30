// Connection and sync status: green synced, amber sending, red offline.
// At a hub-first location a till trading on the venue hub with the internet
// down is still green: everything is shared and goes up later.
import { useTill } from '../lib/store.js'
import { cx } from './ui.jsx'

export default function StatusDot({ dark = false, compact = false }) {
  const { online, outbox, socket, hub } = useTill()
  const waiting = outbox.length
  const onHub = hub === true
  const label = !online && onHub ? (waiting ? 'Venue hub · ' + waiting + ' to send' : 'Venue hub · internet down')
    : !online ? (waiting ? 'Offline · ' + waiting + ' to send' : 'Offline')
    : waiting ? 'Sending ' + waiting : onHub ? 'Live · venue hub' : socket === 'open' ? 'Live' : 'Online'
  const colour = !online && !onHub ? 'bg-bad' : waiting ? 'bg-warn' : 'bg-ok'
  return (
    <div className={cx('inline-flex items-center gap-2 text-sm font-semibold', dark ? 'text-white/80' : 'text-muted')} title={label} data-testid="status-dot" data-hub={onHub ? '1' : '0'}>
      <span className={cx('w-3 h-3 rounded-full', colour, !online && !onHub && 'animate-pulse')} />
      {!compact && <span>{label}</span>}
    </div>
  )
}
