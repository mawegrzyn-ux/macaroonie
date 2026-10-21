// src/components/venueSetup/ui.jsx
//
// Small parts the venue setup wizard (pages/NewLocation.jsx and
// components/venueSetup/steps.jsx) shares: card, error line, Pepper at work,
// button and field classes, the time zones offered.

import { useEffect, useState } from 'react'
import { AlertTriangle, Loader2, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ASSISTANT_NAME } from '@shared/assistant.js'

export const btn = 'inline-flex items-center justify-center gap-1.5 min-h-[44px] px-4 rounded-lg text-sm font-medium touch-manipulation disabled:opacity-50'
export const primary = btn + ' bg-primary text-primary-foreground'
export const outline = btn + ' border bg-background'
export const inp = 'w-full min-h-[44px] border rounded-lg px-3 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 touch-manipulation'

export const TIMEZONES = [
  'Europe/London', 'Europe/Dublin', 'Europe/Warsaw', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid', 'Europe/Rome',
  'Europe/Amsterdam', 'Europe/Stockholm', 'America/New_York', 'America/Chicago', 'America/Los_Angeles',
  'Asia/Dubai', 'Asia/Singapore', 'Australia/Sydney',
]

export function Card({ title, icon: Icon, extra, children, className, bodyClass }) {
  return (
    <section className={cn('rounded-xl border bg-background overflow-hidden', className)}>
      {title && (
        <div className="section-head px-4 py-3 flex items-center gap-2 flex-wrap">
          {Icon && <Icon className="w-4 h-4 shrink-0" />}
          <h2 className="font-semibold text-sm flex-1 min-w-0">{title}</h2>
          {extra}
        </div>
      )}
      <div className={cn('p-4', bodyClass)}>{children}</div>
    </section>
  )
}

export function ErrorLine({ error }) {
  if (!error) return null
  return (
    <p className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 text-red-800 px-3 py-2 text-sm" role="alert">
      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />{error.body?.error || error.message || String(error)}
    </p>
  )
}

const WORKING = [
  'Reading your venues',
  'Working out what to copy',
  'Checking what each area needs',
  'Thinking about what to ask',
  'Writing it up',
]

/** Pepper at work: a step takes up to a minute. */
export function Working({ what }) {
  const [i, setI] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setI(n => Math.min(n + 1, WORKING.length - 1)), 5000)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="rounded-xl border bg-background p-6 flex items-center gap-4" role="status" aria-live="polite" data-testid="nl-working">
      <span className="relative flex w-12 h-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Sparkles className="w-6 h-6 animate-pulse" />
      </span>
      <div className="min-w-0">
        <p className="font-medium">{what || ASSISTANT_NAME + ' is working on it'}</p>
        <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />{WORKING[i]}…</p>
        <p className="text-xs text-muted-foreground mt-1">This can take up to a minute.</p>
      </div>
    </div>
  )
}

/** Copy / Set up here / Later for one area. */
export function ModePick({ area, template, value, onChange, disabled }) {
  if (!area) return null
  const label = m => (m === 'copy' ? 'Copy from ' + (template?.name || 'another venue') : m === 'new' ? 'Set up here' : 'Later')
  return (
    <div className="flex flex-wrap rounded-lg border overflow-hidden w-fit max-w-full" role="radiogroup" aria-label={area.label + ': how to set it up'} data-testid={'mode-' + area.key}>
      {area.modes.filter(m => m !== 'copy' || template).map(m => {
        const on = value === m
        return (
          <button key={m} type="button" role="radio" aria-checked={on} disabled={disabled || !area.can_set_up} onClick={() => onChange(m)}
            data-value={m}
            className={cn('min-h-[44px] px-4 text-sm font-medium touch-manipulation border-l first:border-l-0', on ? 'bg-primary text-primary-foreground' : 'bg-background')}>
            {label(m)}
          </button>
        )
      })}
    </div>
  )
}
