// Shared primitives for the menu manager (list/edit page + the
// standalone variant-groups / dietary-tags pages under it).

import { useEffect, useRef, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PICK_SCALE_MIN, PICK_SCALE_MAX } from '@shared/combos.js'

// On a phone the header's button goes under the title when they don't fit
// side by side, and the body has less padding.
export function Card({ title, action, description, children }) {
  return (
    <div className="bg-background border rounded-xl overflow-hidden">
      <div className="px-4 sm:px-5 py-3 section-head flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-[12rem]">
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
        </div>
        {action && <div className="shrink-0 ml-auto">{action}</div>}
      </div>
      <div className="p-3 sm:p-5 space-y-4">{children}</div>
    </div>
  )
}

export function Field({ label, hint, children }) {
  // A plain <div>, not <label> — wrapping composite children (e.g. the
  // intro line's RichTextEditor, which has its own toolbar <select>) in a
  // native <label> with no htmlFor makes the browser forward any click
  // inside it to the FIRST labelable control it finds, which isn't
  // necessarily the one the click landed on. That silently stole focus
  // (and, via <select> type-ahead, mangled content) when clicking into
  // the rich text editor's content area. See CLAUDE.md.
  return (
    <div className="block">
      <span className="text-xs font-medium block mb-1">{label}</span>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>}
    </div>
  )
}

export function Input(props) {
  return <input {...props} className={cn('w-full text-sm border rounded-md px-2 py-1.5 min-h-[36px]', props.className)} />
}

export function TextArea(props) {
  return <textarea {...props} className={cn('w-full text-sm border rounded-md px-2 py-1.5', props.className)} />
}

export function Btn({ variant = 'primary', children, ...props }) {
  const cls = variant === 'primary'
    ? 'bg-primary text-primary-foreground'
    : variant === 'destructive'
    ? 'bg-destructive/10 text-destructive hover:bg-destructive/20'
    : 'border bg-background hover:bg-accent'
  return (
    <button {...props}
      className={cn('inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium min-h-[36px] disabled:opacity-50', cls)}>
      {children}
    </button>
  )
}

// Currency helper — converts £ pence → £ display string.
export function formatPrice(pence) {
  if (pence == null || pence === '') return ''
  const n = Number(pence) / 100
  return `£${n.toFixed(2)}`
}

export function parsePrice(str) {
  if (str == null || str === '') return null
  const cleaned = String(str).replace(/[£\s,]/g, '')
  const f = parseFloat(cleaned)
  if (Number.isNaN(f)) return null
  return Math.round(f * 100)
}

// Money input that doesn't fight the caret. Re-deriving a formatted
// string (e.g. `.toFixed(2)`) as the controlled `value` on every keystroke
// resets the DOM input's content mid-edit, which snaps the caret to the
// end — you can't backspace or type in the middle without it jumping.
// Instead this keeps its own raw text buffer while focused (no reformatting
// as you type) and only parses to pence + reformats on blur.
export function PriceInput({ pence, onChange, className, ...props }) {
  const [text, setText] = useState(pence == null ? '' : (pence / 100).toFixed(2))
  const focused = useRef(false)

  useEffect(() => {
    if (focused.current) return
    setText(pence == null ? '' : (pence / 100).toFixed(2))
  }, [pence])

  return (
    <Input
      {...props}
      inputMode="decimal"
      value={text}
      onFocus={(e) => { focused.current = true; props.onFocus?.(e) }}
      onChange={(e) => setText(e.target.value)}
      onBlur={(e) => {
        focused.current = false
        const parsed = parsePrice(e.target.value)
        setText(parsed == null ? '' : (parsed / 100).toFixed(2))
        onChange(parsed)
        props.onBlur?.(e)
      }}
      className={className}
    />
  )
}

/**
 * How big the picks' pictures are small in the corner of the dish's photo on
 * kiosks (an option group's kiosk_pick_scale, a combo step's pick_scale,
 * migration 205): a share of the photo's width, or Automatic (null). The
 * sketch beside it is the photo with one corner picture at that size.
 */
export function PickScale({ value, onChange, testid = 'pick-scale' }) {
  const auto = value == null
  const step = d => onChange(Math.min(PICK_SCALE_MAX, Math.max(PICK_SCALE_MIN, (value ?? 25) + d)))
  // Automatic is about a quarter of the photo's width for one picture.
  const shown = auto ? 24 : value
  return (
    <div className="space-y-1.5" data-testid={testid}>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Size in the corner">
        <span className="text-xs">Size in the corner</span>
        {[[true, 'Automatic'], [false, 'Set a size']].map(([a, l]) => (
          <button key={l} type="button" aria-pressed={auto === a} onClick={() => onChange(a ? null : (value ?? 25))}
            className={cn('text-xs px-3 min-h-[40px] rounded-md border touch-manipulation',
              auto === a ? 'bg-primary text-primary-foreground border-primary' : 'bg-background')}>
            {l}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-28 aspect-[4/3] rounded-md bg-muted border overflow-hidden shrink-0" aria-hidden="true" data-testid={testid + '-sketch'}>
          <span className="absolute bottom-[4%] right-[4%] rounded-full bg-primary/70 border-2 border-background" style={{ width: shown + '%', aspectRatio: '1 / 1' }} />
        </div>
        {auto
          ? <p className="flex-1 min-w-[10rem] text-[11px] text-muted-foreground">About a quarter of the photo's width, smaller when several picks share the corner.</p>
          : (
            <div className="flex-1 min-w-[12rem] flex items-center gap-1.5">
              <button type="button" onClick={() => step(-5)} disabled={value <= PICK_SCALE_MIN} aria-label="Smaller"
                className="w-11 h-11 shrink-0 rounded-md border bg-background flex items-center justify-center touch-manipulation disabled:opacity-40"><Minus className="w-4 h-4" /></button>
              <input type="range" min={PICK_SCALE_MIN} max={PICK_SCALE_MAX} step={1} value={value}
                onChange={e => onChange(Number(e.target.value))} aria-label="Corner picture size, % of the photo's width"
                className="flex-1 min-w-0 h-11 touch-manipulation" data-testid={testid + '-range'} />
              <button type="button" onClick={() => step(5)} disabled={value >= PICK_SCALE_MAX} aria-label="Bigger"
                className="w-11 h-11 shrink-0 rounded-md border bg-background flex items-center justify-center touch-manipulation disabled:opacity-40"><Plus className="w-4 h-4" /></button>
              <span className="text-xs tabular-nums w-[5.5rem] shrink-0" data-testid={testid + '-value'}>{value}% of the photo</span>
            </div>
          )}
      </div>
      <p className="text-[11px] text-muted-foreground">Each picture's width as a share of the dish photo's width. When several don't fit side by side, they shrink together.</p>
    </div>
  )
}
