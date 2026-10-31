// src/pages/PosSetup.jsx
//
// Store tech (pos_setup module): one page per part, each its own link in the
// main menu's Store tech section (/pos/<key>, TABS below; /pos opens Tills).
// Per venue: tills and pairing,
// revenue streams (with the order types each offers), printers and what
// prints where, the venue hub (linking, updates, Hub first), kitchen screens (stations, the kitchen flows, pairing),
// self-order kiosks, staff PINs, receipts and payments, the Cash Recon link.
// Company-wide: order types (with their charges), discounts, kiosk designs,
// print designs (with which prints where per venue), till roles and courses.
// The floor plan has its own page (/pos/floor). docs/POS.md.

import { useParams, useSearchParams, Navigate } from 'react-router-dom'
import {
  Loader2, MonitorSmartphone, Waypoints, ListOrdered, Printer, ReceiptText, CreditCard, CookingPot,
  TabletSmartphone, KeyRound, ShieldCheck, UtensilsCrossed, Receipt, ArrowRightLeft, RefreshCw, Server, BadgePercent,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { usePermission } from '@/hooks/usePermission'
import { ReadOnlyNotice, ReadOnlyFieldset } from '@/components/ReadOnlyNotice'
import { PageHeader, VenueSelect, usePosVenue, usePosSetup, ErrorNote } from '@/components/pos/shared'
import TillsSection from '@/components/pos/TillsSection'
import RevenueStreamsSection from '@/components/pos/RevenueStreamsSection'
import OrderTypesSection from '@/components/pos/OrderTypesSection'
import DiscountsSection from '@/components/pos/DiscountsSection'
import PrintersSection from '@/components/pos/PrintersSection'
import HubSection from '@/components/pos/HubSection'
import PrintingSection from '@/components/pos/PrintingSection'
import CardMachinesSection from '@/components/pos/CardMachinesSection'
import KitchenSection from '@/components/pos/KitchenSection'
import KiosksSection from '@/components/pos/KiosksSection'
import StaffSection from '@/components/pos/StaffSection'
import RolesSection from '@/components/pos/RolesSection'
import CoursesSection from '@/components/pos/CoursesSection'
import { ReceiptSettingsSection, ReconSection } from '@/components/pos/SettingsSection'
import { DeviceUpdatesSection } from '@/components/pos/DeviceUpdatesSection'

// The keys are the page addresses (/pos/tills ...): the main menu (ROUTE_CATALOG
// in api/src/routes/nav.js, DEFAULT_NAV_TREE) links to each one.
export const TABS = [
  { key: 'tills', label: 'Tills', icon: MonitorSmartphone, render: p => <TillsSection {...p} /> },
  { key: 'streams', label: 'Revenue streams', icon: Waypoints, render: p => <RevenueStreamsSection {...p} /> },
  { key: 'types', label: 'Order types', icon: ListOrdered, render: p => <OrderTypesSection {...p} /> },
  { key: 'discounts', label: 'Discounts', icon: BadgePercent, render: p => <DiscountsSection {...p} /> },
  { key: 'hub', label: 'Venue hub', icon: Server, render: p => <HubSection {...p} /> },
  { key: 'printers', label: 'Printers', icon: Printer, render: p => <PrintersSection {...p} /> },
  { key: 'printing', label: 'Printing', icon: ReceiptText, render: p => <PrintingSection {...p} /> },
  { key: 'cards', label: 'Card machines', icon: CreditCard, render: p => <CardMachinesSection {...p} /> },
  { key: 'updates', label: 'Device updates', icon: RefreshCw, render: p => <DeviceUpdatesSection {...p} /> },
  { key: 'kitchen', label: 'Kitchen screens', icon: CookingPot, wide: true, render: p => <KitchenSection {...p} /> },
  { key: 'kiosks', label: 'Kiosks', icon: TabletSmartphone, render: p => <KiosksSection {...p} /> },
  { key: 'staff', label: 'Staff and PINs', icon: KeyRound, render: p => <StaffSection {...p} /> },
  { key: 'roles', label: 'Till roles', icon: ShieldCheck, render: p => <RolesSection {...p} /> },
  { key: 'courses', label: 'Courses', icon: UtensilsCrossed, render: p => <CoursesSection {...p} /> },
  { key: 'receipts', label: 'Receipts and payments', icon: Receipt, render: p => <ReceiptSettingsSection {...p} /> },
  { key: 'recon', label: 'Cash Recon link', icon: ArrowRightLeft, render: p => <ReconSection {...p} /> },
]

export default function PosSetup() {
  const { tab: key } = useParams()
  const [params] = useSearchParams()
  const tab = TABS.find(t => t.key === key)
  const { venues, venueId, setVenueId, isLoading: venuesLoading } = usePosVenue()
  const { data: setup, isLoading, error } = usePosSetup(tab ? venueId : null)
  const { canManage } = usePermission('pos_setup')

  // /pos, an old /pos?tab=... link (store opening follow-ups keep them) or a
  // part that doesn't exist: open the right page.
  if (!tab) {
    const old = TABS.find(t => t.key === params.get('tab'))
    return <Navigate to={'/pos/' + (old || TABS[0]).key} replace />
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader icon={tab.icon} title={tab.label}>
        <VenueSelect venues={venues} venueId={venueId} onChange={setVenueId} />
      </PageHeader>
      <div className="flex-1 overflow-y-auto">
        <div className={cn('mx-auto p-4 space-y-4', tab.wide ? 'max-w-6xl' : 'max-w-3xl')}>
          {!venuesLoading && !venues.length && <p className="text-sm text-muted-foreground">Add a venue first.</p>}
          <ErrorNote error={error} />
          {(isLoading || venuesLoading) && <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>}
          {setup && !canManage && <ReadOnlyNotice what="the store tech setup" />}
          {setup && (
            <ReadOnlyFieldset disabled={!canManage}>
              {tab.render({ venueId, setup, canManage })}
            </ReadOnlyFieldset>
          )}
        </div>
      </div>
    </div>
  )
}
