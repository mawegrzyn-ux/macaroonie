// Shared primitives for the menu manager (list/edit page + the
// standalone variant-groups / dietary-groups pages under it).

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

export function Card({ title, action, description, children }) {
  return (
    <div className="bg-background border rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b bg-muted/40 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
        </div>
        {action}
      </div>
      <div className="p-5 space-y-4">{children}</div>
    </div>
  )
}

export function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="text-xs font-medium block mb-1">{label}</span>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>}
    </label>
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
