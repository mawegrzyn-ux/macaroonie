// src/pages/installer/InstallerAdd.jsx
//
// Add a new device (/install/add): pick what it is, open its address on the
// device (it shows a code and a QR code), then link that code on the Link
// page. The one way devices are set up, here and in Store tech.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Copy, Check, QrCode } from 'lucide-react'
import { qrSvg } from '@shared/qr.js'
import { useInstaller, useOverview, canChange, KINDS, KIND_ORDER, KindIcon, Card, BigButton, shortAddress } from './shared'
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
          ? <p className="text-sm text-muted-foreground">Adding devices needs Manage on Store tech or Menu screens.</p>
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
      {kind && <AddSteps key={kind} kind={kind} overview={o} />}
    </div>
  )
}

/** A venue hub is installed on its mini PC by a command, then shows a code like the others. */
function HubSteps({ overview }) {
  const api = String(overview.addresses?.terminal || '').replace(/\/+$/, '')
  return (
    <Card title="1. On the mini PC">
      <div className="space-y-3">
        <p className="text-sm">With the mini PC on the venue's network and the internet on, open this address in its browser and download the installer. It installs the hub, starts it with the computer, and shows a code.</p>
        <AddressBox url={api + '/hub'} testid="add-hub-page" />
        <p className="text-sm">Or run one of these on it:</p>
        <CommandBox label="Linux (Ubuntu, Debian): in a terminal" text={`curl -fsSL ${api}/pos-api/hub/install.sh | sudo sh`} testid="add-hub-linux" />
        <CommandBox label="Windows 10 or 11: in PowerShell as administrator" text={`irm ${api}/pos-api/hub/install.ps1 | iex`} testid="add-hub-windows" />
        <p className="text-sm">Its page, http://(its address):9180 on the venue's network, shows the code and a QR code too. Scan it with this phone, or type the code:</p>
        <BigButton as={Link} to="/install/link?kind=hub" primary data-testid="add-go-link">
          <QrCode className="w-5 h-5" /> Link a device showing a code
        </BigButton>
      </div>
    </Card>
  )
}

function CommandBox({ label, text, testid }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* not allowed */ }
  }
  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold text-muted-foreground">{label}</div>
      <div className="rounded-xl border bg-muted/40 p-2 flex items-center gap-2">
        <code className="flex-1 min-w-0 font-mono text-xs break-all select-all" data-testid={testid}>{text}</code>
        <button type="button" onClick={copy} aria-label={'Copy: ' + label}
          className="w-12 h-12 shrink-0 rounded-xl border bg-background flex items-center justify-center touch-manipulation">
          {copied ? <Check className="w-5 h-5 text-emerald-600" /> : <Copy className="w-5 h-5" />}
        </button>
      </div>
    </div>
  )
}

function AddSteps({ kind, overview }) {
  if (kind === 'hub') return <HubSteps overview={overview} />
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
    </>
  )
}

function AddressBox({ url, testid = 'add-address' }) {
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
        <div className="font-mono font-bold text-lg break-all" data-testid={testid}>{shortAddress(url)}</div>
        <p className="text-xs text-muted-foreground">A device with a camera can scan this to open it.</p>
      </div>
      <button type="button" onClick={copy} aria-label="Copy the address"
        className="w-12 h-12 shrink-0 rounded-xl border bg-background flex items-center justify-center touch-manipulation">
        {copied ? <Check className="w-5 h-5 text-emerald-600" /> : <Copy className="w-5 h-5" />}
      </button>
    </div>
  )
}
