// src/pages/Rules.jsx
// Booking rules + deposit rules editor per venue.

import { useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Save } from 'lucide-react'
import { useApi } from '@/lib/api'

const BookingRulesSchema = z.object({
  slot_duration_mins:  z.coerce.number().int().min(15).max(480),
  buffer_after_mins:   z.coerce.number().int().min(0).max(120),
  min_covers:          z.coerce.number().int().min(1),
  max_covers:          z.coerce.number().int().min(1),
  book_from_days:      z.coerce.number().int().min(0),
  book_until_days:     z.coerce.number().int().min(1),
  cutoff_before_mins:  z.coerce.number().int().min(0),
  hold_ttl_secs:       z.coerce.number().int().min(60).max(1800),
})

const DepositSchema = z.object({
  requires_deposit:    z.boolean(),
  deposit_type:        z.enum(['fixed', 'per_cover']).optional(),
  deposit_amount:      z.coerce.number().min(0).optional(),
  currency:            z.string().length(3),
  refund_hours_before: z.coerce.number().int().min(0).nullable().optional(),
})

function FormField({ label, hint, error, children }) {
  return (
    <div>
      <label className="text-sm font-medium block mb-1">{label}</label>
      {hint && <p className="text-xs text-muted-foreground mb-1.5">{hint}</p>}
      {children}
      {error && <p className="text-xs text-destructive mt-1">{error}</p>}
    </div>
  )
}

function TextInput({ className = '', ...props }) {
  return (
    <input
      className={`w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary ${className}`}
      {...props}
    />
  )
}

function Section({ title, description, children }) {
  return (
    <div className="border rounded-lg p-5">
      <h3 className="font-semibold text-sm mb-1">{title}</h3>
      {description && <p className="text-xs text-muted-foreground mb-4">{description}</p>}
      <div className="space-y-4">{children}</div>
    </div>
  )
}

export default function Rules() {
  const api     = useApi()
  const qc      = useQueryClient()

  const { data: venues = [] } = useQuery({
    queryKey: ['venues'],
    queryFn:  () => api.get('/venues'),
  })

  const [venueId, setVenueId] = useStateFromFirst(venues)

  const { data: rules }   = useQuery({
    queryKey: ['booking-rules', venueId],
    queryFn:  () => api.get(`/venues/${venueId}/rules`),
    enabled:  !!venueId,
  })

  const { data: deposit } = useQuery({
    queryKey: ['deposit-rules', venueId],
    queryFn:  () => api.get(`/venues/${venueId}/deposit-rules`),
    enabled:  !!venueId,
  })

  // ── Booking rules form ──────────────────────────────────
  const {
    register: regRules,
    handleSubmit: submitRules,
    reset: resetRules,
    formState: { errors: errRules },
  } = useForm({ resolver: zodResolver(BookingRulesSchema) })

  useEffect(() => { if (rules) resetRules(rules) }, [rules])

  const rulesMutation = useMutation({
    mutationFn: (data) => api.patch(`/venues/${venueId}/rules`, data),
    onSuccess:  () => qc.invalidateQueries(['booking-rules', venueId]),
  })

  // ── Deposit rules form ──────────────────────────────────
  const {
    register: regDeposit,
    handleSubmit: submitDeposit,
    reset: resetDeposit,
    watch: watchDeposit,
    formState: { errors: errDeposit },
  } = useForm({ resolver: zodResolver(DepositSchema) })

  useEffect(() => { if (deposit) resetDeposit(deposit) }, [deposit])

  const requiresDeposit = watchDeposit('requires_deposit')

  const depositMutation = useMutation({
    mutationFn: (data) => api.patch(`/venues/${venueId}/deposit-rules`, data),
    onSuccess:  () => qc.invalidateQueries(['deposit-rules', venueId]),
  })

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 h-14 border-b shrink-0">
        <h1 className="font-semibold">Booking rules</h1>
        <select
          value={venueId ?? ''}
          onChange={e => setVenueId(e.target.value)}
          className="text-sm border rounded px-2 py-1"
        >
          {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-xl space-y-5">

          {/* ── Booking rules ────────────────────────────── */}
          <form onSubmit={submitRules(data => rulesMutation.mutate(data))}>
            <Section
              title="Slot & timing"
              description="Controls how slots are sized and when guests can book."
            >
              <div className="grid grid-cols-2 gap-4">
                <FormField label="Slot duration (mins)" error={errRules.slot_duration_mins?.message}>
                  <TextInput type="number" {...regRules('slot_duration_mins')} className="w-full" />
                </FormField>
                <FormField label="Buffer after slot (mins)" hint="Cleaning / turnover time">
                  <TextInput type="number" {...regRules('buffer_after_mins')} className="w-full" />
                </FormField>
                <FormField label="Min covers" error={errRules.min_covers?.message}>
                  <TextInput type="number" {...regRules('min_covers')} className="w-full" />
                </FormField>
                <FormField label="Max covers" error={errRules.max_covers?.message}>
                  <TextInput type="number" {...regRules('max_covers')} className="w-full" />
                </FormField>
                <FormField label="Book from (days ahead)" hint="0 = same day allowed">
                  <TextInput type="number" {...regRules('book_from_days')} className="w-full" />
                </FormField>
                <FormField label="Book until (days ahead)" hint="How far in future guests can book">
                  <TextInput type="number" {...regRules('book_until_days')} className="w-full" />
                </FormField>
                <FormField label="Cutoff before slot (mins)" hint="e.g. 60 = can't book within 1h of start">
                  <TextInput type="number" {...regRules('cutoff_before_mins')} className="w-full" />
                </FormField>
                <FormField label="Hold duration (secs)" hint="60–1800. Time guest has to complete payment.">
                  <TextInput type="number" {...regRules('hold_ttl_secs')} className="w-full" />
                </FormField>
              </div>
              <button
                type="submit"
                disabled={rulesMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {rulesMutation.isPending ? 'Saving…' : 'Save booking rules'}
              </button>
            </Section>
          </form>

          {/* ── Deposit rules ─────────────────────────────── */}
          <form onSubmit={submitDeposit(data => depositMutation.mutate(data))}>
            <Section
              title="Deposit"
              description="Require a payment deposit at time of booking."
            >
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" {...regDeposit('requires_deposit')} className="w-4 h-4" />
                <span className="text-sm">Require deposit</span>
              </label>

              {requiresDeposit && (
                <div className="space-y-4 pl-6 border-l-2 border-primary/30">
                  <FormField label="Deposit type">
                    <select {...regDeposit('deposit_type')} className="w-full border rounded-md px-3 py-2 text-sm">
                      <option value="fixed">Fixed amount per booking</option>
                      <option value="per_cover">Amount per cover</option>
                    </select>
                  </FormField>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField label="Amount" error={errDeposit.deposit_amount?.message}>
                      <TextInput type="number" step="0.01" {...regDeposit('deposit_amount')} />
                    </FormField>
                    <FormField label="Currency">
                      <TextInput {...regDeposit('currency')} maxLength={3} className="uppercase" />
                    </FormField>
                  </div>
                  <FormField label="Refund if cancelled X hours before" hint="Leave blank = non-refundable">
                    <TextInput type="number" {...regDeposit('refund_hours_before')} className="w-40" />
                  </FormField>
                </div>
              )}

              <button
                type="submit"
                disabled={depositMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {depositMutation.isPending ? 'Saving…' : 'Save deposit rules'}
              </button>
            </Section>
          </form>
        </div>
      </div>
    </div>
  )
}

// Helper: initialise state from first array item
function useStateFromFirst(items) {
  const { useState, useEffect } = require('react')
  const [value, setValue] = useState(null)
  useEffect(() => { if (items.length && !value) setValue(items[0].id) }, [items])
  return [value, setValue]
}
