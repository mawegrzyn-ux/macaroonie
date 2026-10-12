// This till: connection and sync, printing here, the print queue (waiting
// for the venue hub), events that weren't saved, and unpairing.

import { useEffect, useState } from 'react'
import { RefreshCw, Printer, Unplug, Check, AlertTriangle } from 'lucide-react'
import { useTill, setPrefs, flush, pull, loadConfig, server, toast, unpair } from '../lib/store.js'
import { printTickets } from '../lib/print.js'
import { cx, useApproval } from '../components/ui.jsx'
import StatusDot from '../components/StatusDot.jsx'

export default function TillSettings() {
  const s = useTill()
  const approve = useApproval()
  const [jobs, setJobs] = useState([])
  const [confirmUnpair, setConfirmUnpair] = useState(false)
  const loadJobs = async () => { try { setJobs(await server.printJobs('queued')) } catch { setJobs([]) } }
  useEffect(() => { loadJobs() }, [])
  const printers = Object.fromEntries((s.config.printers || []).map(p => [p.id, p]))
  const doUnpair = async () => {
    const a = await approve('manager', null, 'Unpairing the till needs a manager.')
    if (a === false) return
    if (s.outbox.length) return toast(s.outbox.length + ' changes haven\'t been sent yet: connect first', 'bad')
    unpair()
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
          </div>
          <div className="flex gap-2 flex-wrap">
            <button className="btn" onClick={async () => { await flush(); await pull(); await loadConfig(); toast('Synced', 'ok') }}><RefreshCw size={18} /> Sync now</button>
          </div>
          <div className="text-sm text-muted">The till keeps working with the internet down; changes wait here and are sent when it comes back. Kitchen tickets print through the venue hub once one is installed.</div>
        </div>

        <div className="card p-5 space-y-3">
          <div className="text-lg font-bold">Print from this tablet</div>
          <Toggle on={s.prefs.print_bills} label="Bills and receipts" hint="Uses the tablet's own print dialog (a printer set up in Android or Windows)." onChange={v => setPrefs({ print_bills: v })} />
          <Toggle on={s.prefs.print_kitchen} label="Kitchen tickets too" hint="Until the venue hub prints them to the kitchen printers." onChange={v => setPrefs({ print_kitchen: v })} />
        </div>

        <div className="card p-5 space-y-3">
          <div className="flex items-center gap-2">
            <div className="text-lg font-bold flex-1">Print queue</div>
            <button className="btn" onClick={loadJobs}><RefreshCw size={18} /></button>
          </div>
          <div className="text-sm text-muted">Tickets waiting for the venue hub to print them to {Object.keys(printers).length ? 'the network printers' : 'network printers (none set up yet)'}.</div>
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

        <div className="card p-5 space-y-3">
          <div className="text-lg font-bold">Unpair this till</div>
          {!confirmUnpair
            ? <button className="btn text-bad" onClick={() => setConfirmUnpair(true)}><Unplug size={18} /> Unpair</button>
            : <div className="flex gap-2 items-center flex-wrap"><span className="font-semibold">It will need a new pairing code.</span><button className="btn btn-bad" onClick={doUnpair}>Yes, unpair</button><button className="btn" onClick={() => setConfirmUnpair(false)}>Cancel</button></div>}
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
