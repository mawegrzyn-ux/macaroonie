// src/pages/Rules.jsx
// Booking rules + deposit rules editor per venue.

import { useState, forwardRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Save } from 'lucide-react'
import { useApi } from '@/lib/api'
import { usePermission } from '@/hooks/usePermission'
import { ReadOnlyNotice, ReadOnlyFieldset } from '@/components/ReadOnlyNotice'

const BookingRulesSchema = z.object({
  slot_duration_mins:        z.coerce.number().int().min(15).max(480),
  buffer_after_mins:         z.coerce.number().int().min(0).max(120),
  min_covers:                z.coerce.number().int().min(1),
  max_covers:                z.coerce.number().int().min(1),
  book_from_days:            z.coerce.number().int().min(0),
  book_until_days:           z.coerce.number().int().min(1),
  cutoff_before_mins:        z.coerce.number().int().min(0),
  hold_ttl_secs:             z.coerce.number().int().min(60).max(1800),
  allow_cross_section_combo:                z.boolean().default(false),
  allow_non_adjacent_combo:                 z.boolean().default(false),
  allow_widget_bookings_after_doors_close:  z.boolean().default(false),
  enable_unconfirmed_flow:                  z.boolean().default(false),
  enable_reconfirmed_status:                z.boolean().default(false),
  enable_arrived_status:                    z.boolean().default(true),
})

// An empty box is "not set" (null), not 0: z.coerce.number('') would be 0.
const blankToNull = v => (v === '' || v == null ? null : v)
const DepositSchema = z.object({
  requires_deposit:    z.boolean(),
  deposit_type:        z.enum(['fixed', 'per_cover']).optional(),
  deposit_amount:      z.preprocess(blankToNull, z.coerce.number().positive('Enter the deposit').nullable()).optional(),
  currency:            z.string().length(3).default('GBP'),
  refund_hours_before: z.preprocess(blankToNull, z.coerce.number().int().min(0).nullable()).optional(),
}).superRefine((d, ctx) => {
  if (d.requires_deposit && !d.deposit_amount) ctx.addIssue({ code: 'custom', path: ['deposit_amount'], message: 'Enter the deposit' })
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

const TextInput = forwardRef(function TextInput({ className = '', ...props }, ref) {
  return (
    <input
      ref={ref}
      className={`w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary ${className}`}
      {...props}
    />
  )
})

function Section({ title, description, children }) {
  return (
    <div className="border rounded-xl bg-background overflow-hidden">
      <div className="px-5 py-3 section-head">
        <h3 className="font-semibold text-sm">{title}</h3>
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
      </div>
      <div className="p-5 space-y-4">{children}</div>
    </div>
  )
}

export default function Rules() {
  const api     = useApi()
  const qc      = useQueryClient()
  // Booking rules = View: the rules can be read, nothing changed.
  const { canManage } = usePermission('rules')

  const { data: venues = [] } = useQuery({
    queryKey: ['venues'],
    queryFn:  () => api.get('/venues'),
  })

  const [venueId, setVenueId] = useVenueId(venues)

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
    formState: { errors: errRules },
  } = useForm({
    resolver: zodResolver(BookingRulesSchema),
    values: rules?.venue_id ? rules : {
      slot_duration_mins:        90,
      buffer_after_mins:         0,
      min_covers:                1,
      max_covers:                20,
      book_from_days:            0,
      book_until_days:           90,
      cutoff_before_mins:        60,
      hold_ttl_secs:             300,
      allow_cross_section_combo:                false,
      allow_non_adjacent_combo:                 false,
      allow_widget_bookings_after_doors_close:  false,
      enable_unconfirmed_flow:                  false,
      enable_reconfirmed_status:                false,
      enable_arrived_status:                    true,
    },
  })

  const rulesMutation = useMutation({
    mutationFn: (data) => api.post(`/venues/${venueId}/rules`, data),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['booking-rules', venueId] }),
  })

  // ── Deposit rules form ──────────────────────────────────
  const {
    register: regDeposit,
    handleSubmit: submitDeposit,
    watch: watchDeposit,
    formState: { errors: errDeposit },
  } = useForm({
    resolver: zodResolver(DepositSchema),
    values: deposit?.venue_id ? deposit : { requires_deposit: false, deposit_type: 'fixed', currency: 'GBP' },
  })

  const requiresDeposit = watchDeposit('requires_deposit')

  const depositMutation = useMutation({
    mutationFn: (data) => api.post(`/venues/${venueId}/deposit-rules`, data),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['deposit-rules', venueId] }),
  })

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 h-14 border-b shrink-0 bg-background">
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
        <ReadOnlyFieldset disabled={!canManage} className="max-w-xl space-y-5">
          {!canManage && <ReadOnlyNotice what="the booking rules" />}

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

          {/* ── Smart allocation ─────────────────────────── */}
          <form onSubmit={submitRules(data => rulesMutation.mutate(data))}>
            <Section
              title="Smart allocation"
              description="Controls how the engine combines tables when a drag-to-table drop needs extra capacity."
            >
              <div className="space-y-3">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    {...regRules('allow_cross_section_combo')}
                    className="w-4 h-4 mt-0.5 shrink-0"
                  />
                  <div>
                    <p className="text-sm font-medium">Allow combining tables from different sections</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      When off (default), the engine only considers tables that share the same
                      section as the drop target. Turn on to allow cross-section combinations.
                    </p>
                  </div>
                </label>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    {...regRules('allow_non_adjacent_combo')}
                    className="w-4 h-4 mt-0.5 shrink-0"
                  />
                  <div>
                    <p className="text-sm font-medium">Allow combining non-adjacent tables</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      When off (default), existing combinations are only eligible if their member
                      tables sit consecutively in sort order. The adjacency expansion path always
                      remains contiguous regardless of this setting.
                    </p>
                  </div>
                </label>
              </div>
              <button
                type="submit"
                disabled={rulesMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {rulesMutation.isPending ? 'Saving…' : 'Save allocation rules'}
              </button>
            </Section>
          </form>

          {/* ── Booking confirmation flow ─────────────────── */}
          <form onSubmit={submitRules(data => rulesMutation.mutate(data))}>
            <Section
              title="Booking confirmation"
              description="When enabled, new bookings start as 'Not confirmed'. Operators call the guest to confirm, then manually set the status to Confirmed. When disabled (default), all bookings start as Confirmed immediately."
            >
              <div className="space-y-3">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    {...regRules('enable_unconfirmed_flow')}
                    className="w-4 h-4 mt-0.5 shrink-0"
                  />
                  <div>
                    <p className="text-sm font-medium">Enable call-to-confirm workflow</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      New bookings will be set to <strong>Not confirmed</strong> until an operator
                      calls the guest and moves the status to <strong>Confirmed</strong>.
                      Admin-created bookings follow the same flow when this is on.
                    </p>
                  </div>
                </label>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    {...regRules('enable_reconfirmed_status')}
                    className="w-4 h-4 mt-0.5 shrink-0"
                  />
                  <div>
                    <p className="text-sm font-medium">Enable re-confirmed status</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Adds a <strong>Re-confirmed</strong> status for operators to record
                      that they called the guest the day before and confirmed attendance.
                      Only shown in the booking drawer when this is on.
                    </p>
                  </div>
                </label>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    {...regRules('enable_arrived_status')}
                    className="w-4 h-4 mt-0.5 shrink-0"
                  />
                  <div>
                    <p className="text-sm font-medium">Enable arrived status</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Shows an <strong>Arrived</strong> status (cyan) between Confirmed and Seated.
                      Disable if your workflow goes directly from Confirmed to Seated.
                      On by default.
                    </p>
                  </div>
                </label>
              </div>
              <button
                type="submit"
                disabled={rulesMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {rulesMutation.isPending ? 'Saving…' : 'Save rules'}
              </button>
            </Section>
          </form>

          {/* ── Opening hours enforcement ─────────────────── */}
          <form onSubmit={submitRules(data => rulesMutation.mutate(data))}>
            <Section
              title="Opening hours enforcement"
              description="Controls whether the booking widget respects the Doors Close time set on each day's schedule."
            >
              <div className="space-y-3">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    {...regRules('allow_widget_bookings_after_doors_close')}
                    className="w-4 h-4 mt-0.5 shrink-0"
                  />
                  <div>
                    <p className="text-sm font-medium">Allow widget bookings past doors-close time</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      When off (default), the booking widget hides slots at or after the
                      "Doors close" time set on each day of the schedule.
                      Admin-created bookings always bypass this restriction.
                    </p>
                  </div>
                </label>
              </div>
              <button
                type="submit"
                disabled={rulesMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {rulesMutation.isPending ? 'Saving…' : 'Save rules'}
              </button>
            </Section>
          </form>

          {/* ── Deposit rules ─────────────────────────────── */}
          <form onSubmit={submitDeposit(data => depositMutation.mutate(data))}>
            <Section
              title="Deposit"
              description="Guests booking online pay a deposit by card to hold their table, to your own Stripe account. Bookings your staff add take no deposit."
            >
              <label className="flex items-center gap-2 cursor-pointer min-h-[48px] touch-manipulation">
                <input type="checkbox" {...regDeposit('requires_deposit')} className="w-5 h-5" data-testid="deposit-on" />
                <span className="text-sm">Take a deposit with online bookings</span>
              </label>

              {requiresDeposit && deposit && !deposit.card_payments_ready && (
                <p className="text-sm rounded-md border border-amber-300 bg-amber-50 text-amber-900 px-3 py-2" data-testid="deposit-not-ready">
                  Guests can&apos;t book this venue online until card payments are set up: connect your Stripe account
                  in <a href="/orders/settings" className="underline font-medium">Online orders, Ordering setup</a>.
                </p>
              )}
              {requiresDeposit && deposit?.card_payments_ready && (
                <p className="text-sm rounded-md border border-green-300 bg-green-50 text-green-900 px-3 py-2" data-testid="deposit-ready">
                  Guests pay the deposit by card in the booking widget. It goes to your Stripe account.
                </p>
              )}

              {requiresDeposit && (
                <div className="space-y-4 pl-6 border-l-2 border-primary/30">
                  <FormField label="How it's worked out">
                    <select {...regDeposit('deposit_type')} className="w-full border rounded-md px-3 py-2 text-sm min-h-[48px] touch-manipulation">
                      <option value="fixed">One amount per booking</option>
                      <option value="per_cover">An amount per guest</option>
                    </select>
                  </FormField>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField label="Amount" error={errDeposit.deposit_amount?.message}>
                      <TextInput type="number" step="0.01" inputMode="decimal" {...regDeposit('deposit_amount')} data-testid="deposit-amount" />
                    </FormField>
                    <FormField label="Currency">
                      <TextInput {...regDeposit('currency')} maxLength={3} className="uppercase" />
                    </FormField>
                  </div>
                  <FormField
                    label="Refunded when the guest cancels at least this many hours before"
                    hint="Leave empty to keep the deposit when a guest cancels. Staff can always refund it from the booking."
                    error={errDeposit.refund_hours_before?.message}
                  >
                    <TextInput type="number" inputMode="numeric" {...regDeposit('refund_hours_before')} className="w-40" data-testid="deposit-refund-hours" />
                  </FormField>
                </div>
              )}
              {depositMutation.isError && (
                <p className="text-sm text-destructive">{depositMutation.error?.message || 'Couldn\'t save'}</p>
              )}

              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={depositMutation.isPending}
                  className="flex items-center gap-2 px-4 min-h-[48px] bg-primary text-primary-foreground rounded-md text-sm disabled:opacity-50 touch-manipulation"
                  data-testid="deposit-save"
                >
                  <Save className="w-4 h-4" />
                  {depositMutation.isPending ? 'Saving…' : 'Save deposit rules'}
                </button>
                {depositMutation.isSuccess && <span className="text-sm text-green-700" data-testid="deposit-saved">Saved</span>}
              </div>
            </Section>
          </form>
        </ReadOnlyFieldset>
      </div>
    </div>
  )
}

function useVenueId(venues) {
  const [selectedVenueId, setVenueId] = useState(null)
  const venueId = selectedVenueId ?? venues[0]?.id ?? null
  return [venueId, setVenueId]
}
