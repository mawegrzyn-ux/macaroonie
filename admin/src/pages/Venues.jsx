// src/pages/Venues.jsx
// List + create + edit venues.
// Inline edit panel slides in on row click.

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Building2, ChevronRight, Globe, Check, X } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'

const VenueSchema = z.object({
  name:             z.string().min(1, 'Required'),
  slug:             z.string().min(1).regex(/^[a-z0-9-]+$/, 'Lowercase letters, numbers and hyphens only'),
  timezone:         z.string().min(1, 'Required'),
  currency:         z.string().length(3, 'Must be 3 characters'),
  zero_cap_display: z.enum(['hidden', 'unavailable']),
  is_active:        z.boolean(),
})

const TIMEZONES = [
  'Europe/London', 'Europe/Warsaw', 'Europe/Paris', 'Europe/Berlin',
  'Europe/Madrid', 'Europe/Rome', 'America/New_York', 'America/Chicago',
  'America/Los_Angeles', 'Asia/Dubai', 'Asia/Singapore', 'Australia/Sydney',
]

function VenueForm({ venue, onSave, onCancel }) {
  const api = useApi()
  const qc  = useQueryClient()

  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(VenueSchema),
    defaultValues: venue ?? {
      timezone:         'Europe/London',
      currency:         'GBP',
      zero_cap_display: 'hidden',
      is_active:        true,
    },
  })

  const mutation = useMutation({
    mutationFn: (data) => venue
      ? api.patch(`/venues/${venue.id}`, data)
      : api.post('/venues', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['venues'] })
      onSave()
    },
  })

  function Field({ label, error, children }) {
    return (
      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1">{label}</label>
        {children}
        {error && <p className="text-xs text-destructive mt-0.5">{error}</p>}
      </div>
    )
  }

  const inp = 'w-full border rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary'

  return (
    <form onSubmit={handleSubmit(d => mutation.mutate(d))} className="space-y-3">
      <Field label="Venue name" error={errors.name?.message}>
        <input {...register('name')} className={inp} placeholder="The Grand Bistro" />
      </Field>

      <Field label="URL slug" error={errors.slug?.message}>
        <input {...register('slug')} className={inp} placeholder="grand-bistro" />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Timezone" error={errors.timezone?.message}>
          <select {...register('timezone')} className={inp}>
            {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
          </select>
        </Field>
        <Field label="Currency" error={errors.currency?.message}>
          <input {...register('currency')} className={inp} maxLength={3} placeholder="GBP" />
        </Field>
      </div>

      <Field label="Zero-cap slot display">
        <select {...register('zero_cap_display')} className={inp}>
          <option value="hidden">Hidden from widget</option>
          <option value="unavailable">Shown as unavailable</option>
        </select>
      </Field>

      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input type="checkbox" {...register('is_active')} className="w-4 h-4 rounded" />
        Active (visible to guests)
      </label>

      <div className="flex items-center gap-2 pt-1">
        <button
          type="submit"
          disabled={mutation.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm disabled:opacity-50"
        >
          <Check className="w-3.5 h-3.5" />
          {mutation.isPending ? 'Saving…' : venue ? 'Save changes' : 'Create venue'}
        </button>
        <button type="button" onClick={onCancel}
          className="flex items-center gap-1.5 px-3 py-1.5 border rounded-md text-sm hover:bg-accent">
          <X className="w-3.5 h-3.5" /> Cancel
        </button>
      </div>

      {mutation.isError && (
        <p className="text-xs text-destructive">{mutation.error.message}</p>
      )}
    </form>
  )
}

export default function Venues() {
  const api = useApi()
  const [editing,  setEditing]  = useState(null)   // venue object or 'new'
  const [expanded, setExpanded] = useState(null)   // venue id for detail

  const { data: venues = [], isLoading } = useQuery({
    queryKey: ['venues'],
    queryFn:  () => api.get('/venues'),
  })

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 h-14 border-b shrink-0">
        <h1 className="font-semibold">Venues</h1>
        <button
          onClick={() => setEditing('new')}
          className="flex items-center gap-1.5 text-sm px-3 py-1.5 bg-primary text-primary-foreground rounded-lg"
        >
          <Plus className="w-4 h-4" /> Add venue
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl space-y-3">

          {/* New venue form */}
          {editing === 'new' && (
            <div className="border rounded-lg p-4 bg-muted/20">
              <p className="text-sm font-semibold mb-3">New venue</p>
              <VenueForm onSave={() => setEditing(null)} onCancel={() => setEditing(null)} />
            </div>
          )}

          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : venues.length === 0 ? (
            <p className="text-sm text-muted-foreground">No venues yet.</p>
          ) : (
            venues.map(venue => (
              <div key={venue.id} className="border rounded-lg overflow-hidden">
                {/* Venue row */}
                <div
                  className="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
                  onClick={() => setExpanded(expanded === venue.id ? null : venue.id)}
                >
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Building2 className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm">{venue.name}</p>
                      {!venue.is_active && (
                        <span className="text-xs px-1.5 py-0.5 bg-muted rounded text-muted-foreground">Inactive</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Globe className="w-3 h-3" /> {venue.timezone}
                      </span>
                      <span className="text-xs text-muted-foreground">{venue.currency}</span>
                      <span className="text-xs text-muted-foreground">{venue.table_count} tables</span>
                    </div>
                  </div>
                  <ChevronRight className={cn(
                    'w-4 h-4 text-muted-foreground transition-transform',
                    expanded === venue.id && 'rotate-90'
                  )} />
                </div>

                {/* Edit panel */}
                {expanded === venue.id && (
                  <div className="border-t px-4 py-4 bg-muted/10">
                    {editing === venue.id ? (
                      <VenueForm
                        venue={venue}
                        onSave={() => { setEditing(null); setExpanded(null) }}
                        onCancel={() => setEditing(null)}
                      />
                    ) : (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setEditing(venue.id)}
                          className="text-sm px-3 py-1.5 border rounded-md hover:bg-accent"
                        >
                          Edit venue
                        </button>
                        <a
                          href={`/tables?venue=${venue.id}`}
                          className="text-sm px-3 py-1.5 border rounded-md hover:bg-accent"
                        >
                          Manage tables →
                        </a>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
