// src/pages/PosSetup.jsx
//
// Till setup (/pos, pos_setup module). Per venue: tills and pairing,
// revenue centres, printers and what prints where, staff PINs, receipts
// and payments, the Cash Recon link. Company-wide: till roles and courses.
// The floor plan has its own page (/pos/floor). docs/POS.md.

import { useSearchParams, Link } from 'react-router-dom'
import { MonitorSmartphone, Loader2, LayoutPanelTop, BarChart3 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PageHeader, VenueSelect, usePosVenue, usePosSetup, ErrorNote } from '@/components/pos/shared'
import TillsSection from '@/components/pos/TillsSection'
import RevenueCentresSection from '@/components/pos/RevenueCentresSection'
import PrintersSection from '@/components/pos/PrintersSection'
import StaffSection from '@/components/pos/StaffSection'
import RolesSection from '@/components/pos/RolesSection'
import CoursesSection from '@/components/pos/CoursesSection'
import { ReceiptSettingsSection, ReconSection } from '@/components/pos/SettingsSection'

const TABS = [
  { key: 'tills', label: 'Tills', render: p => <TillsSection {...p} /> },
  { key: 'revenue', label: 'Revenue centres', render: p => <RevenueCentresSection {...p} /> },
  { key: 'printers', label: 'Printers', render: p => <PrintersSection {...p} /> },
  { key: 'staff', label: 'Staff and PINs', render: p => <StaffSection {...p} /> },
  { key: 'roles', label: 'Till roles', render: p => <RolesSection {...p} /> },
  { key: 'courses', label: 'Courses', render: p => <CoursesSection {...p} /> },
  { key: 'receipts', label: 'Receipts and payments', render: p => <ReceiptSettingsSection {...p} /> },
  { key: 'recon', label: 'Cash Recon', render: p => <ReconSection {...p} /> },
]

export default function PosSetup() {
  const [params, setParams] = useSearchParams()
  const tab = TABS.find(t => t.key === params.get('tab')) || TABS[0]
  const { venues, venueId, setVenueId, isLoading: venuesLoading } = usePosVenue()
  const { data: setup, isLoading, error } = usePosSetup(venueId)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader icon={MonitorSmartphone} title="Till setup">
        <VenueSelect venues={venues} venueId={venueId} onChange={setVenueId} />
        <Link to="/pos/floor" className="h-10 px-3 rounded-xl border bg-background text-sm inline-flex items-center gap-1.5 hover:bg-muted touch-manipulation">
          <LayoutPanelTop className="w-4 h-4" /> <span className="hidden sm:inline">Floor plan</span>
        </Link>
        <Link to="/pos/reports" className="h-10 px-3 rounded-xl border bg-background text-sm inline-flex items-center gap-1.5 hover:bg-muted touch-manipulation">
          <BarChart3 className="w-4 h-4" /> <span className="hidden sm:inline">Reports</span>
        </Link>
      </PageHeader>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto p-4 space-y-4">
          <nav className="flex flex-wrap gap-1.5" aria-label="Till setup sections">
            {TABS.map(t => (
              <button key={t.key} type="button" onClick={() => setParams({ tab: t.key }, { replace: true })}
                aria-current={t.key === tab.key ? 'page' : undefined}
                className={cn('min-h-[44px] px-3 rounded-lg border text-sm font-medium touch-manipulation',
                  t.key === tab.key ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted')}>
                {t.label}
              </button>
            ))}
          </nav>
          {!venuesLoading && !venues.length && <p className="text-sm text-muted-foreground">Add a venue first.</p>}
          <ErrorNote error={error} />
          {(isLoading || venuesLoading) && <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>}
          {setup && tab.render({ venueId, setup })}
        </div>
      </div>
    </div>
  )
}
