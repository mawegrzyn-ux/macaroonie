// src/pages/installer/InstallerHome.jsx
//
// The installer's home (/install): the venue being set up, the two jobs
// (link a device showing a code, add a new one) and every till, kitchen
// screen, kiosk and menu screen at the venue with its state. Tapping one
// opens its page. What a person sees follows Store tech (tills, kitchen
// screens, kiosks) and Menu screens (menu screens).
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { QrCode, Plus, ChevronDown, Loader2 } from 'lucide-react'
import TenantSwitcherModal from '@/components/TenantSwitcherModal'
import { useInstaller, useOverview, KINDS, KIND_ORDER, Card, DeviceRow, BigButton, ErrorNote, Pill } from './shared'

export function VenueButton() {
  const { venues, venue, setVenueId } = useInstaller()
  const [open, setOpen] = useState(false)
  if (!venue) return null
  const many = venues.length > 1
  return (
    <>
      <button type="button" disabled={!many} onClick={() => setOpen(true)} data-testid="venue-button"
        className="w-full flex items-center gap-3 rounded-2xl border bg-background px-4 min-h-[60px] text-left touch-manipulation disabled:cursor-default">
        <span className="flex-1 min-w-0">
          <span className="block text-xs text-muted-foreground">Setting up</span>
          <span className="block font-semibold truncate">{venue.name}</span>
        </span>
        {many && <span className="text-sm font-semibold text-[#1f3a5f] flex items-center gap-1">Change <ChevronDown className="w-4 h-4" /></span>}
      </button>
      {open && (
        <TenantSwitcherModal tenants={venues} currentTenantId={venue.id} title="Choose a venue"
          onClose={() => setOpen(false)} onPick={id => { setVenueId(id); setOpen(false) }} />
      )}
    </>
  )
}

export default function InstallerHome() {
  const { venueId, venues, isLoading } = useInstaller()
  const { data: o, error, isLoading: loading } = useOverview(venueId)

  if (isLoading) return <Loading />
  if (!venues.length) {
    return <ErrorNote>This restaurant group has no venues yet. Add one in Macaroonie (Venues) first.</ErrorNote>
  }
  const refused = error?.status === 403
  const canAny = o && (o.can.devices === 'manage' || o.can.screens === 'manage')
  const groups = o ? KIND_ORDER.map(kind => ({
    kind,
    shown: KINDS[kind].area === 'screens' ? o.screens !== null : o.devices !== null,
    list: kind === 'screen' ? o.screens || [] : (o.devices || []).filter(d => d.kind === kind),
  })).filter(g => g.shown) : []

  return (
    <div className="space-y-4" data-testid="installer-home">
      <VenueButton />

      {refused && <ErrorNote>You need Store tech or Menu screens access to use the installer. Ask an owner to give your role access.</ErrorNote>}
      {error && !refused && <ErrorNote>{error.message}</ErrorNote>}

      {o && canAny && (
        <div className="grid grid-cols-1 gap-3">
          <BigButton as={Link} to="/install/link" primary data-testid="go-link">
            <QrCode className="w-5 h-5" /> Link a device showing a code
          </BigButton>
          <BigButton as={Link} to="/install/add" data-testid="go-add">
            <Plus className="w-5 h-5" /> Add a new device
          </BigButton>
        </div>
      )}
      {o && !canAny && <p className="text-sm text-muted-foreground">You can see the devices here. Linking or changing them needs Manage on Store tech or Menu screens.</p>}

      {loading && <Loading />}
      {groups.map(g => {
        const online = g.list.filter(d => d.online).length
        return (
          <Card key={g.kind} title={KINDS[g.kind].plural}
            action={g.list.length > 0 && <Pill tone={online === g.list.length ? 'ok' : 'muted'}>{online} of {g.list.length} online</Pill>}>
            {g.list.length === 0
              ? <p className="text-sm text-muted-foreground">No {KINDS[g.kind].plural.toLowerCase()} at this venue yet.</p>
              : <div className="space-y-2">{g.list.map(d => <DeviceRow key={d.id} kind={g.kind} device={d} to={`/install/device/${g.kind}/${d.id}`} />)}</div>}
          </Card>
        )
      })}
    </div>
  )
}

export function Loading() {
  return (
    <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-10">
      <Loader2 className="w-4 h-4 animate-spin" /> Loading…
    </div>
  )
}
