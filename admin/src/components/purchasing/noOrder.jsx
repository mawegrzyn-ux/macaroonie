// src/components/purchasing/noOrder.jsx
//
// Deliveries booked in without a purchase order (migration 238):
//
//   PurchasingSettingsButton  the Purchasing page's Settings (Purchasing
//                             setup manage): who may book in a delivery
//                             without an order (off / anyone who books
//                             deliveries in / only Purchasing approval).
//   NoOrderSupplierModal      the first step: which supplier it came from
//                             (switched-on suppliers, with a price or not).
//   noOrderPo()               the purchase order the receive form works on
//                             until it is saved (no id, no lines).
//
// The form itself is ReceiveForm in ordering.jsx; saving it posts to
// /api/purchasing/venues/:venueId/deliveries.

import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Search, Settings, ChevronRight, Check } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Modal, inputCls, ErrorNote } from '@/components/staff/shared'
import { btn, IS_TOUCH } from '@/components/purchasing/shared'

const CHOICES = [
  { key: 'off', label: 'Off', hint: 'Deliveries are only booked in against a purchase order.' },
  { key: 'anyone', label: 'Anyone who books deliveries in', hint: 'People with Purchasing or Purchasing approval (Manage).' },
  { key: 'approvers', label: 'Only people with Purchasing approval', hint: 'People who can only send orders for approval can\'t.' },
]

/** Settings for purchasing, for people with Purchasing setup (Manage). */
export function PurchasingSettingsButton({ meta }) {
  const [open, setOpen] = useState(false)
  if (!meta?.can_setup) return null
  return (
    <>
      <button type="button" className={btn.outline} onClick={() => setOpen(true)} data-testid="purchasing-settings" aria-label="Purchasing settings">
        <Settings className="w-4 h-4" /><span className="hidden sm:inline">Settings</span>
      </button>
      {open && <PurchasingSettingsModal onClose={() => setOpen(false)} />}
    </>
  )
}

function PurchasingSettingsModal({ onClose }) {
  const api = useApi()
  const qc = useQueryClient()
  const { data, isLoading, error } = useQuery({
    queryKey: ['purchasing-settings'], queryFn: () => api.get('/purchasing/settings'), staleTime: 0, gcTime: 0,
  })
  const [value, setValue] = useState(null)
  const current = value ?? data?.receive_without_order ?? 'off'
  const save = useMutation({
    mutationFn: () => api.put('/purchasing/settings', { receive_without_order: current }),
    onSuccess: saved => {
      qc.setQueryData(['purchasing-settings'], saved)
      qc.invalidateQueries({ queryKey: ['purchasing-meta'] })
      onClose()
    },
  })
  const changed = data && current !== data.receive_without_order
  return (
    <Modal title="Purchasing settings" onClose={onClose}
      footer={(
        <>
          <button type="button" className={btn.primary} disabled={!changed || save.isPending} onClick={() => save.mutate()} data-testid="purchasing-settings-save">
            {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />}Save
          </button>
          <button type="button" className={btn.ghost} onClick={onClose}>Cancel</button>
        </>
      )}>
      {isLoading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : (
        <div className="space-y-2" role="radiogroup" aria-label="Book in deliveries without an order" data-testid="no-order-setting">
          <p className="text-sm font-medium">Book in deliveries without an order</p>
          <p className="text-xs text-muted-foreground">
            For goods that arrive with no purchase order here: extras the driver brought, a standing delivery nobody orders
            in the app, a cash and carry run. They go on the Deliveries tab with a Book in without an order button, and
            the delivery check is saved as for any delivery.
          </p>
          {CHOICES.map(c => (
            <button key={c.key} type="button" role="radio" aria-checked={current === c.key} data-k={c.key}
              onClick={() => setValue(c.key)}
              className={cn('w-full text-left rounded-xl border px-3 py-2.5 min-h-[56px] flex items-center gap-3 touch-manipulation',
                current === c.key ? 'border-primary bg-primary/5' : 'hover:bg-muted')}>
              <span className={cn('w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center',
                current === c.key ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40')}>
                {current === c.key && <Check className="w-3 h-3" />}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium">{c.label}</span>
                <span className="block text-xs text-muted-foreground">{c.hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      <ErrorNote error={error || save.error} />
    </Modal>
  )
}

/** Which supplier a delivery without an order came from. */
export function NoOrderSupplierModal({ venueId, onPick, onClose }) {
  const api = useApi()
  const [search, setSearch] = useState('')
  const { data = [], isLoading, error } = useQuery({
    queryKey: ['purchasing-venue-suppliers', venueId, 'all'],
    queryFn: () => api.get(`/purchasing/venues/${venueId}/suppliers?all=1`),
  })
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? data.filter(s => s.name.toLowerCase().includes(q)) : data
  }, [data, search])
  return (
    <Modal title="Book in without an order" onClose={onClose}>
      <p className="text-sm text-muted-foreground">Which supplier did it come from?</p>
      {data.length > 8 && (
        <label className="relative block">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input className={cn(inputCls, 'pl-9')} value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Find a supplier" aria-label="Find a supplier" autoFocus={!IS_TOUCH} />
        </label>
      )}
      {isLoading && <Loader2 className="w-5 h-5 animate-spin mx-auto" />}
      <ErrorNote error={error} />
      <div className="space-y-2" data-testid="no-order-suppliers">
        {shown.map(s => (
          <button key={s.id} type="button" onClick={() => onPick(s)} data-testid="no-order-supplier" data-id={s.id}
            className="w-full text-left rounded-xl border bg-background px-3 py-2 min-h-[56px] flex items-center gap-3 hover:bg-muted touch-manipulation">
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-medium truncate">{s.name}</span>
              <span className="block text-xs text-muted-foreground">
                {s.prices ? `${s.prices} product${s.prices === 1 ? '' : 's'} in the price list` : 'Nothing in the price list: add items as they came packed'}
              </span>
            </span>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </button>
        ))}
        {!isLoading && !shown.length && (
          <p className="text-sm text-muted-foreground">{search ? 'No supplier found.' : 'No suppliers yet: add them in Suppliers (Purchasing setup).'}</p>
        )}
      </div>
    </Modal>
  )
}

/** The purchase order a delivery without an order is booked in on until it is saved. */
export function noOrderPo({ venueId, supplier, showPrices, today }) {
  return {
    id: null, no_order: true, number: null, status: 'sent',
    venue_id: venueId, supplier_id: supplier.id, supplier_name: supplier.name,
    delivery_date: today, today, show_prices: !!showPrices,
    lines: [], delivery_check: null, receive_notes: '', supplier_ref: null,
  }
}
