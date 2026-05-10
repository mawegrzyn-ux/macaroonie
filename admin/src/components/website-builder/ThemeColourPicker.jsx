// components/website-builder/ThemeColourPicker.jsx
//
// A pill-strip colour picker that constrains operator choice to the seven
// theme roles defined in Theme & Brand. The stored value is a ROLE NAME
// (string) — never a hex. SSR partials resolve role → CSS var() or hex
// depending on context.
//
// Why role names not hex:
//   - One source of truth: change brand primary on the theme page,
//     every block re-themes automatically
//   - Operators can't pick "off-palette" colours that clash with the brand
//   - When the tenant rebrands, no per-block hex strings to chase

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useApi } from '@/lib/api'

export const THEME_ROLES = [
  { key: 'primary',    label: 'Primary',    hint: 'Main brand colour' },
  { key: 'accent',     label: 'Accent',     hint: 'Secondary brand colour' },
  { key: 'background', label: 'Background', hint: 'Page background' },
  { key: 'surface',    label: 'Surface',    hint: 'Cards / panels' },
  { key: 'text',       label: 'Text',       hint: 'Body text' },
  { key: 'muted',      label: 'Muted',      hint: 'Secondary text' },
  { key: 'border',     label: 'Border',     hint: 'Dividers / outlines' },
]

const ROLE_DEFAULTS = {
  primary:    '#630812',
  accent:     '#f4a7b9',
  background: '#ffffff',
  surface:    '#f9f6f1',
  text:       '#1a1a1a',
  muted:      '#666666',
  border:     '#e5e7eb',
}

/**
 * Resolve a role name (or legacy hex) to a hex string using the supplied
 * theme. Used for swatch previews; SSR rendering uses var(--c-{role})
 * directly so no resolution is needed at render time.
 */
export function resolveRole(value, theme) {
  if (!value) return null
  // Legacy hex pass-through (for blocks created before role names existed).
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value
  const colours = (theme && theme.colors) || {}
  return colours[value] || ROLE_DEFAULTS[value] || null
}

/**
 * Theme-aware colour picker.
 *
 * @param {string|null} value - role name ('primary'|'accent'|...|'') or null = inherit
 * @param {(v: string) => void} onChange - new role name (or '' for none)
 * @param {boolean} allowNone - show a "Inherit" / "None" option
 * @param {string} noneLabel - label for the none option
 */
export function ThemeColourPicker({ value, onChange, allowNone = true, noneLabel = 'Inherit' }) {
  const api = useApi()
  const { data: tenantSite } = useQuery({
    queryKey: ['tenant-site'],
    queryFn:  () => api.get('/website/tenant-site'),
    staleTime: 60_000,
  })
  const theme = (tenantSite && tenantSite.theme) || {}
  const colours = theme.colors || {}

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        {allowNone && (
          <SwatchButton
            active={!value}
            onClick={() => onChange('')}
            label={noneLabel}
            // Inherit swatch shows a subtle hatched pattern so it reads as
            // "no override" rather than a real colour.
            backgroundImage="repeating-linear-gradient(45deg, #e5e7eb 0 4px, transparent 4px 8px)"
            background="#f9fafb"
          />
        )}
        {THEME_ROLES.map(role => {
          const hex = colours[role.key] || ROLE_DEFAULTS[role.key]
          return (
            <SwatchButton
              key={role.key}
              active={value === role.key}
              onClick={() => onChange(role.key)}
              label={role.label}
              hint={role.hint}
              background={hex}
              outline={role.key === 'background' || role.key === 'surface'}
            />
          )
        })}
      </div>
      {value && (
        <p className="text-[11px] text-muted-foreground">
          Using <strong>{THEME_ROLES.find(r => r.key === value)?.label || value}</strong>
          {colours[value] ? <> — <span className="font-mono">{colours[value]}</span></> : null}
        </p>
      )}
    </div>
  )
}

function SwatchButton({ active, onClick, label, hint, background, backgroundImage, outline }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint || label}
      className={`group relative w-10 h-10 rounded-md transition-all
        ${active ? 'ring-2 ring-primary ring-offset-2' : 'ring-1 ring-border hover:ring-primary/40'}
        ${outline ? 'border border-border' : ''}`}
      style={{ background, backgroundImage }}
    >
      <span className="sr-only">{label}</span>
      {/* Tooltip-style label below the swatch on hover */}
      <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-1 px-1.5 py-0.5 rounded bg-foreground text-background text-[10px] font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-10">
        {label}
      </span>
    </button>
  )
}
