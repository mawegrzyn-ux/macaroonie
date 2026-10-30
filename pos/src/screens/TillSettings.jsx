// This till: connection and sync, printing here, the print queue (tickets
// waiting for their printer), events that weren't saved, and disconnecting it.

import { useEffect, useState } from 'react'
import { RefreshCw, Printer, Unplug, Check, AlertTriangle } from 'lucide-react'
import { useTill, setPrefs, flush, pull, loadConfig, server, toast, disconnect } from '../lib/store.js'
import { printTickets } from '../lib/print.js'
import { cx, useApproval } from '../components/ui.jsx'
import StatusDot from '../components/StatusDot.jsx'
import { pullTimes, pullText } from '@shared/pos/pullTimes.js'

export default function TillSettings() {
  const s = useTill()
  const approve = useApproval()
  const [jobs, setJobs] = useState([])
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const loadJobs = async () => { try { setJobs(await server.printJobs('queued')) } catch { setJobs([]) } }
  useEffect(() => { loadJobs() }, [])
  const printers = Object.fromEntries((s.config.printers || []).map(p => [p.id, p]))
  const ownPrinters = (s.config.printers || []).filter(p => p.connection === 'device' && p.device_id === s.device?.id)
  const doDisconnect = async () => {
    if (s.outbox.length) return toast(s.outbox.length + ' changes haven\'t been sent yet: connect first', 'bad')
    const a = await approve('manager', null, 'Disconnecting the till needs a manager.')
    if (a === false) return
    const told = await disconnect()
    if (!told) toast('Disconnected here. Macaroonie couldn\'t be told (offline): remove the till in Store tech, or link the code this tablet shows next.', 'bad', 9000)
  }
  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="card p-5 space-y-3">
          <div className="flex items-center gap-3">
            <div className="text-xl font-bold flex-1">{s.device?.name} <span className="text-muted font-normal text-base">({s.device?.short_code})</span></div>
            <StatusDot />
          </div>
          <div className="grid sm:grid-cols-2 gap-2 text-[15px]">
            <div>Venue: <b>{s.config.venue?.name}</b></div>
            <div>Mode: <b>{s.config.device?.settings?.mode === 'counter' ? 'Counter service' : 'Table service'}</b></div>
            <div>Waiting to send: <b>{s.outbox.length}</b></div>
            <div>Last sync: <b>{s.lastSync ? new Date(s.lastSync).toLocaleTimeString('en-GB') : 'not yet'}</b></div>
            <div>Event number: <b>{s.seq}</b></div>
            <div>Menu version: <b>{s.config.version}</b></div>
            <div data-testid="till-checked">Prices and sold out checked: <b>{s.checked?.live ? new Date(s.checked.live).toLocaleTimeString('en-GB') : 'not yet'}</b></div>
            <div data-testid="till-pull">Checks for changes: <b>{pullTimes(s.config.pull).live ? 'prices every ' + pullText(pullTimes(s.config.pull).live) + ', ' : ''}menu every {pullText(pullTimes(s.config.pull).content)}</b></div>
            <div>Whole menu checked: <b>{s.checked?.content ? new Date(s.checked.content).toLocaleTimeString('en-GB') : 'not yet'}</b></div>
            {s.config.hub && <HubLine on={s.hub} />}
          </div>
          <div className="flex gap-2 flex-wrap">
            <button className="btn" onClick={async () => { await flush(); await pull(); await loadConfig(); toast('Synced', 'ok') }}><RefreshCw size={18} /> Sync now</button>
          </div>
          <div className="text-sm text-muted">The till keeps working with the internet down; changes wait here and are sent when it comes back. It asks for {s.config.pull?.live === 0 ? 'prices and sold out dishes only when told of a change' : 'prices and sold out dishes every ' + pullText(pullTimes(s.config.pull).live)} and for the whole menu every {pullText(pullTimes(s.config.pull).content)} (Store tech, Device updates). Kitchen tickets print where the kitchen flow sends them (Store tech, Kitchen screens).</div>
        </div>

        <div className="card p-5 space-y-3">
          <div className="text-lg font-bold">Print from this tablet</div>
          <Toggle on={s.prefs.print_bills} label="Bills and receipts" hint="When this till has no receipt printer, or one plugged into it: through the tablet's own print dialog (a printer set up in Android or Windows). A receipt printer on the network prints through the venue hub." onChange={v => setPrefs({ print_bills: v })} />
          {ownPrinters.length > 0 && (
            <div className="text-sm" data-testid="own-printers">Plugged into this till: <b>{ownPrinters.map(p => p.name).join(', ')}</b>. Their tickets print here as they come in (start Chrome with --kiosk-printing to print without the dialog).</div>
          )}
        </div>

        <div className="card p-5 space-y-3">
          <div className="flex items-center gap-2">
            <div className="text-lg font-bold flex-1">Print queue</div>
            <button className="btn" onClick={loadJobs}><RefreshCw size={18} /></button>
          </div>
          <div className="text-sm text-muted">Tickets waiting for their printer: the venue hub prints the network printers, a till or kitchen screen the printers plugged into it. Print one here if its printer is down.</div>
          <div className="divide-y divide-line">
            {jobs.slice(0, 30).map(j => (
              <div key={j.id} className="py-2 flex items-center gap-3">
                <div className="flex-1 min-w-0"><div className="font-semibold truncate">{j.title || j.kind}</div><div className="text-xs text-muted">{printers[j.printer_id]?.name || 'Printer'} · {new Date(j.created_at).toLocaleTimeString('en-GB')}</div></div>
                <button className="btn min-h-[44px]" onClick={() => printTickets([j.ops])}><Printer size={16} /> Print here</button>
                <button className="btn min-h-[44px]" onClick={async () => { await server.printJobDone(j.id, 'printed'); loadJobs() }}><Check size={16} /> Done</button>
              </div>
            ))}
            {!jobs.length && <div className="py-2 text-muted text-sm">Nothing waiting.</div>}
          </div>
        </div>

        {s.conflicts.length > 0 && (
          <div className="card p-5 space-y-2">
            <div className="text-lg font-bold flex items-center gap-2"><AlertTriangle className="text-bad" size={20} /> Not saved</div>
            <div className="text-sm text-muted">Changes made on this till that Macaroonie refused (usually because another till changed the check first). A manager sees these in Till reports.</div>
            {s.conflicts.map(c => (
              <div key={c.id} className="rounded-xl bg-bad-soft p-3 text-sm"><b>{c.type}</b>: {c.error}<span className="text-muted"> · {new Date(c.at).toLocaleTimeString('en-GB')}</span></div>
            ))}
          </div>
        )}

        <div className="card p-5 space-y-3" data-testid="disconnect-card">
          <div className="text-lg font-bold">Disconnect this till</div>
          <div className="text-sm text-muted">This tablet stops being a till and shows a code. Link that code in Store tech (Tills, Link a device) or with the installer app to set it up again: the till keeps its name and settings.</div>
          {s.outbox.length > 0 && <div className="rounded-xl bg-bad-soft text-bad p-3 text-sm font-semibold">{s.outbox.length} changes haven&apos;t been sent yet. Get the till online first: they go by themselves.</div>}
          {!confirmDisconnect
            ? <button className="btn text-bad" onClick={() => setConfirmDisconnect(true)}><Unplug size={18} /> Disconnect</button>
            : <div className="flex gap-2 items-center flex-wrap"><span className="font-semibold">Disconnect this till? A manager confirms.</span><button className="btn btn-bad" onClick={doDisconnect}>Yes, disconnect</button><button className="btn" onClick={() => setConfirmDisconnect(false)}>Cancel</button></div>}
        </div>
      </div>
    </div>
  )
}

function Toggle({ on, label, hint, onChange }) {
  return (
    <button className="w-full flex items-center gap-4 text-left py-1" onClick={() => onChange(!on)}>
      <span className={cx('w-14 h-8 rounded-full relative transition-colors shrink-0', on ? 'bg-ok' : 'bg-line')}>
        <span className={cx('absolute top-1 w-6 h-6 rounded-full bg-white shadow transition-all', on ? 'left-7' : 'left-1')} />
      </span>
      <span><span className="font-semibold block">{label}</span><span className="text-sm text-muted">{hint}</span></span>
    </button>
  )
}

// Hub first (docs/POS.md section 11): which venue hub this till sends to.
function HubLine({ on }) {
  const st = server.hubStatus()
  const text = !st.configured ? 'not used here (it needs the Macaroonie app)'
    : on === true ? 'in use' + (st.url ? ' (' + st.url.replace(/^https?:\/\//, '') + ')' : '')
    : on === false ? 'not answering: the cloud instead, asked again every 30 s' : 'checking'
  return <div data-testid="till-hub">Venue hub: <b>{text}</b></div>
}
