// src/pages/installer/InstallerAdd.jsx
//
// Add a new device (/install/add): pick what it is, then either open its
// address on the device (it shows a code and a QR code, linked from the
// Link page) or, for a till, kitchen screen or kiosk, make the device here
// and type the code this page shows into the device
// (POST /api/pos/venues/:id/devices, the same as Till setup).
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Copy, Check, QrCode, KeyRound } from 'lucide-react'
import { qrSvg } from '@shared/qr.js'
import { useApi } from '@/lib/api'
import {
  useInstaller, useOverview, canChange, KINDS, KIND_ORDER, KindIcon, Card, BigButton, ErrorNote, Field,
  KindSettings, inputClass, suggestName, shortAddress,
} from './shared'
import { VenueButton, Loading } from './InstallerHome'

export default function InstallerAdd() {
  const { venueId } = useInstaller()
  const { data: o, isLoading } = useOverview(venueId)
  const [kind, setKind] = useState(null)

  if (isLoading || !o) return <Loading />
  const kinds = KIND_ORDER.filter(k => canChange(o.can, k))
  return (
    <div className="space-y-4" data-testid="installer-add">
      <VenueButton />
      <Card title="What are you adding?">
        {kinds.length === 0
          ? <p className="text-sm text-muted-foreground">Adding devices needs Manage on Till setup or Menu screens.</p>
          : (
            <div className="grid grid-cols-2 gap-2">
              {kinds.map(k => (
                <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={kind === k} data-testid={'add-' + k}
                  className={'flex flex-col items-start gap-2 rounded-xl border p-3 min-h-[104px] text-left touch-manipulation ' + (kind === k ? 'border-[#1f3a5f] ring-2 ring-[#1f3a5f]/30 bg-[#1f3a5f]/5' : 'bg-background')}>
                  <KindIcon kind={k} />
                  <span className="font-semibold leading-tight">{KINDS[k].label}</span>
                </button>
              ))}
            </div>
          )}
      </Card>
      {kind && <AddSteps key={kind} kind={kind} overview={o} venueId={venueId} />}
    </div>
  )
}

function AddSteps({ kind, overview, venueId }) {
  const address = overview.addresses?.[KINDS[kind].address]
  return (
    <>
      <Card title="1. On the device">
        <div className="space-y-3">
          <p className="text-sm">
            Open this address in Chrome on the {KINDS[kind].label.toLowerCase()}
            {kind === 'screen' ? ' (or in Fully Kiosk on a TV box)' : ''}. It shows a code and a QR code.
          </p>
          <AddressBox url={address} />
          <p className="text-sm">Then scan the QR code it shows with this phone, or type its code:</p>
          <BigButton as={Link} to={'/install/link?kind=' + kind} primary data-testid="add-go-link">
            <QrCode className="w-5 h-5" /> Link a device showing a code
          </BigButton>
        </div>
      </Card>
      {kind !== 'screen' && <MakeCode kind={kind} overview={overview} venueId={venueId} />}
    </>
  )
}

function AddressBox({ url }) {
  const [copied, setCopied] = useState(false)
  const svg = useMemo(() => {
    try { return url ? qrSvg(url, { margin: 2, title: 'QR code of the address' }) : '' } catch { return '' }
  }, [url])
  async function copy() {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* not allowed */ }
  }
  return (
    <div className="rounded-xl border bg-muted/40 p-3 flex items-center gap-3">
      {svg && <div className="w-20 h-20 shrink-0 bg-white rounded-lg p-1 [&>svg]:w-full [&>svg]:h-full" dangerouslySetInnerHTML={{ __html: svg }} />}
      <div className="flex-1 min-w-0">
        <div className="font-mono font-bold text-lg break-all" data-testid="add-address">{shortAddress(url)}</div>
        <p className="text-xs text-muted-foreground">A device with a camera can scan this to open it.</p>
      </div>
      <button type="button" onClick={copy} aria-label="Copy the address"
        className="w-12 h-12 shrink-0 rounded-xl border bg-background flex items-center justify-center touch-manipulation">
        {copied ? <Check className="w-5 h-5 text-emerald-600" /> : <Copy className="w-5 h-5" />}
      </button>
    </div>
  )
}

function MakeCode({ kind, overview, venueId }) {
  const api = useApi()
  const qc = useQueryClient()
  const [name, setName] = useState(() => suggestName(kind, overview))
  const [settings, setSettings] = useState({})
  const make = useMutation({
    mutationFn: () => api.post(`/pos/venues/${venueId}/devices`, { name: name.trim(), kind, settings }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['installer', venueId] }),
  })
  const made = make.data
  return (
    <Card title="Or: make it here and type a code on the device">
      {made ? (
        <div className="space-y-3 text-center" data-testid="made-code">
          <p className="text-sm">On the {KINDS[kind].label.toLowerCase()}, press <b>Have a code from Till setup?</b> and type:</p>
          <div className="text-4xl font-extrabold tracking-[0.15em] tabular-nums">{made.pairing_code}</div>
          <p className="text-xs text-muted-foreground">It works once, for 30 minutes. {made.device.name} shows as Code waiting until then.</p>
          <BigButton as={Link} to={`/install/device/${kind}/${made.device.id}`}>Open its page</BigButton>
        </div>
      ) : (
        <div className="space-y-4">
          <Field label="Name">
            <input className={inputClass} value={name} maxLength={60} onChange={e => setName(e.target.value)} data-testid="make-name" />
          </Field>
          <KindSettings kind={kind} settings={settings} onChange={setSettings} overview={overview} />
          <ErrorNote>{make.error?.message}</ErrorNote>
          <BigButton disabled={!name.trim() || make.isPending} onClick={() => make.mutate()} data-testid="make-code">
            <KeyRound className="w-5 h-5" /> {make.isPending ? 'Making…' : 'Make a code'}
          </BigButton>
        </div>
      )}
    </Card>
  )
}
