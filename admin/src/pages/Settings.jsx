// src/pages/Settings.jsx
// Global app settings — theme colour, timeline defaults.

import { useState } from 'react'
import { Eye, EyeOff, Layers, Columns, Check } from 'lucide-react'
import { useSettings, DEFAULT_THEME_HEX, hexToHsl } from '@/contexts/SettingsContext'
import { useTimelineSettings } from '@/contexts/TimelineSettingsContext'
import { cn } from '@/lib/utils'

function SectionCard({ title, children }) {
  return (
    <div className="bg-background border rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b bg-muted/40">
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      <div className="p-5 space-y-5">{children}</div>
    </div>
  )
}

function SettingRow({ label, description, children }) {
  return (
    <div className="flex items-start gap-4">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function Toggle({ value, onChange, label }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={cn(
        'relative inline-flex h-6 w-11 items-center rounded-full transition-colors touch-manipulation focus:outline-none',
        value ? 'bg-primary' : 'bg-muted-foreground/30',
      )}
      aria-label={label}
    >
      <span className={cn(
        'inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform',
        value ? 'translate-x-6' : 'translate-x-1',
      )} />
    </button>
  )
}

export default function Settings() {
  const { themeHex, setThemeHex } = useSettings()
  const tlSettings = useTimelineSettings()

  // Local hex input state so user can type freely; only apply on blur/enter
  const [hexInput, setHexInput] = useState(themeHex)
  const [applied, setApplied] = useState(false)

  function handleHexCommit(hex) {
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
      setThemeHex(hex)
      setApplied(true)
      setTimeout(() => setApplied(false), 1500)
    }
  }

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="flex items-center h-14 border-b px-5 shrink-0">
        <h1 className="text-base font-semibold">Settings</h1>
      </div>

      <div className="flex-1 p-5 max-w-xl space-y-5">

        {/* ── Appearance ───────────────────────────────────── */}
        <SectionCard title="Appearance">
          <SettingRow
            label="Theme colour"
            description="Primary colour used for buttons, active states, and highlights throughout the app."
          >
            <div className="flex items-center gap-2">
              {/* Native colour picker — clicking the swatch opens the OS picker */}
              <label className="cursor-pointer touch-manipulation" title="Pick a colour">
                <div
                  className="w-9 h-9 rounded-lg border-2 border-border shadow-sm cursor-pointer"
                  style={{ background: hexInput }}
                />
                <input
                  type="color"
                  value={hexInput}
                  onChange={e => {
                    setHexInput(e.target.value)
                    setThemeHex(e.target.value)
                  }}
                  className="sr-only"
                />
              </label>

              {/* Hex text input */}
              <input
                type="text"
                value={hexInput}
                onChange={e => setHexInput(e.target.value.toLowerCase())}
                onBlur={e => handleHexCommit(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleHexCommit(hexInput)}
                className="w-24 border rounded px-2 py-1.5 text-xs font-mono"
                placeholder="#630812"
                maxLength={7}
                spellCheck={false}
              />

              {applied && (
                <span className="flex items-center gap-1 text-xs text-green-600">
                  <Check className="w-3.5 h-3.5" /> Applied
                </span>
              )}
            </div>
          </SettingRow>

          {/* Colour preview */}
          <div className="flex gap-2 flex-wrap">
            {['#630812', '#1d4ed8', '#15803d', '#7c3aed', '#b45309', '#0f172a'].map(hex => (
              <button
                key={hex}
                type="button"
                onClick={() => { setHexInput(hex); setThemeHex(hex) }}
                className={cn(
                  'w-8 h-8 rounded-lg border-2 touch-manipulation transition-transform hover:scale-110',
                  themeHex === hex ? 'border-foreground scale-110' : 'border-transparent',
                )}
                style={{ background: hex }}
                title={hex}
              />
            ))}
          </div>

          <p className="text-xs text-muted-foreground">
            Changes apply immediately and are saved for next visit.
          </p>
        </SectionCard>

        {/* ── Timeline defaults ─────────────────────────────── */}
        <SectionCard title="Timeline defaults">
          <p className="text-xs text-muted-foreground -mt-1">
            These become the starting state when you open the Timeline. You can still change them per-session via the sidebar.
          </p>

          <SettingRow
            label="Side panel mode"
            description="Show booking details in a docked panel to the right rather than a floating drawer."
          >
            <Toggle
              value={tlSettings.panelMode}
              onChange={tlSettings.setPanelMode}
              label="Toggle panel mode"
            />
          </SettingRow>

          <SettingRow
            label="Section dividers"
            description="Group tables by section with labelled dividers."
          >
            <Toggle
              value={tlSettings.groupBySections}
              onChange={tlSettings.setGroupBySections}
              label="Toggle section dividers"
            />
          </SettingRow>

          <SettingRow
            label="Hide inactive bookings"
            description="Hide cancelled and no-show bookings by default."
          >
            <Toggle
              value={tlSettings.hideInactive}
              onChange={tlSettings.setHideInactive}
              label="Toggle hide inactive"
            />
          </SettingRow>
        </SectionCard>

      </div>
    </div>
  )
}
