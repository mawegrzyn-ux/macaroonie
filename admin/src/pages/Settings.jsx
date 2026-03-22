// src/pages/Settings.jsx
// Global app settings — theme colour, status colours, timeline background, timeline defaults.

import { useState } from 'react'
import { Eye, EyeOff, Layers, Columns, Check, RotateCcw } from 'lucide-react'
import {
  useSettings,
  DEFAULT_THEME_HEX,
  DEFAULT_TIMELINE_BG,
  hexToHsl,
  deriveBorderFromBg,
} from '@/contexts/SettingsContext'
import { useTimelineSettings } from '@/contexts/TimelineSettingsContext'
import { cn } from '@/lib/utils'

// ── Shared layout primitives ───────────────────────────────────

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

// ── Shared colour picker row (swatch + hex input) ──────────────

function ColourPickerRow({ value, onChange, swatches, activeHex, label }) {
  const [hexInput, setHexInput] = useState(value)
  const [applied, setApplied] = useState(false)

  function commit(hex) {
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
      onChange(hex)
      setApplied(true)
      setTimeout(() => setApplied(false), 1400)
    }
  }

  return (
    <div className="space-y-3">
      {/* Preset swatches */}
      <div className="flex gap-1.5 flex-wrap">
        {swatches.map(hex => (
          <button
            key={hex}
            type="button"
            onClick={() => { setHexInput(hex); commit(hex) }}
            className={cn(
              'w-8 h-8 rounded-lg border-2 touch-manipulation transition-transform hover:scale-110',
              activeHex === hex ? 'border-foreground scale-110' : 'border-transparent',
            )}
            style={{ background: hex }}
            title={hex}
          />
        ))}
      </div>

      {/* Native colour picker + hex text */}
      <div className="flex items-center gap-2">
        <label className="cursor-pointer touch-manipulation" title={`Pick ${label}`}>
          <div
            className="w-9 h-9 rounded-lg border-2 border-border shadow-sm"
            style={{ background: hexInput }}
          />
          <input
            type="color"
            value={hexInput}
            onChange={e => { setHexInput(e.target.value); onChange(e.target.value) }}
            className="sr-only"
          />
        </label>
        <input
          type="text"
          value={hexInput}
          onChange={e => setHexInput(e.target.value.toLowerCase())}
          onBlur={e => commit(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && commit(hexInput)}
          className="w-24 border rounded px-2 py-1.5 text-xs font-mono"
          placeholder="#ffffff"
          maxLength={7}
          spellCheck={false}
        />
        {applied && (
          <span className="flex items-center gap-1 text-xs text-green-600">
            <Check className="w-3.5 h-3.5" /> Applied
          </span>
        )}
      </div>
    </div>
  )
}

// ── Status colours ─────────────────────────────────────────────

const STATUS_LIST = [
  { key: 'unconfirmed',     label: 'Not confirmed' },
  { key: 'confirmed',       label: 'Confirmed'     },
  { key: 'reconfirmed',     label: 'Re-confirmed'  },
  { key: 'pending_payment', label: 'Pending pay.'  },
  { key: 'arrived',         label: 'Arrived'       },
  { key: 'seated',          label: 'Seated'        },
  { key: 'checked_out',     label: 'Checked out'   },
  { key: 'cancelled',       label: 'Cancelled'     },
  { key: 'no_show',         label: 'No show'       },
]

// 12 pastel swatches covering the full spectrum — suitable for any status tile
const STATUS_SWATCHES = [
  '#fca5a5', '#fed7aa', '#fde68a', '#fef08a',
  '#d9f99d', '#86efac', '#99f6e4', '#a5f3fc',
  '#bae6fd', '#bfdbfe', '#c7d2fe', '#e9d5ff',
]

function StatusColourEditor() {
  const { statusColours, setStatusColour, resetStatusColours } = useSettings()
  const [editingKey, setEditingKey]  = useState(null)
  const [hexInput,   setHexInput]    = useState('')

  function toggleEdit(key) {
    if (editingKey === key) { setEditingKey(null); return }
    setEditingKey(key)
    setHexInput(statusColours[key] ?? '')
  }

  function applyHex(hex) {
    if (!editingKey) return
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
      setStatusColour(editingKey, hex)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-muted-foreground">
          Click a status tile to edit its colour. Changes apply immediately to the Timeline.
        </p>
        <button
          type="button"
          onClick={() => { resetStatusColours(); setEditingKey(null) }}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground touch-manipulation ml-3 shrink-0"
        >
          <RotateCcw className="w-3 h-3" /> Reset all
        </button>
      </div>

      {/* 3×3 status grid */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        {STATUS_LIST.map(({ key, label }) => {
          const bg  = statusColours[key] ?? '#e5e7eb'
          const bd  = deriveBorderFromBg(bg)
          return (
            <button
              key={key}
              type="button"
              onClick={() => toggleEdit(key)}
              className={cn(
                'flex items-center gap-2 px-2.5 py-2 rounded-lg border text-left text-xs font-medium touch-manipulation transition-all',
                editingKey === key
                  ? 'ring-2 ring-primary border-primary'
                  : 'border-border hover:border-muted-foreground',
              )}
            >
              {/* Mini booking-tile preview */}
              <div
                className="w-4 h-4 rounded shrink-0 border-l-2"
                style={{ background: bg, borderLeftColor: bd }}
              />
              <span className="truncate leading-none">{label}</span>
            </button>
          )
        })}
      </div>

      {/* Inline swatch + picker panel for selected status */}
      {editingKey && (
        <div className="border rounded-xl p-4 bg-muted/30 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold">
              Editing: {STATUS_LIST.find(s => s.key === editingKey)?.label}
            </p>
            {/* Live tile preview */}
            <div
              className="h-5 w-20 rounded text-[10px] font-medium flex items-center justify-center border-l-2 shrink-0"
              style={{
                background:     statusColours[editingKey],
                borderLeftColor: deriveBorderFromBg(statusColours[editingKey]),
                color: statusColours[editingKey],   // text deliberately same colour — invisible preview of tile
              }}
            >
              <span style={{ color: '#00000066', fontSize: 10 }}>preview</span>
            </div>
          </div>

          {/* 12 preset swatches */}
          <div className="flex gap-1.5 flex-wrap">
            {STATUS_SWATCHES.map(hex => (
              <button
                key={hex}
                type="button"
                onClick={() => { setHexInput(hex); applyHex(hex) }}
                className={cn(
                  'w-8 h-8 rounded-lg border-2 touch-manipulation transition-transform hover:scale-110',
                  statusColours[editingKey] === hex ? 'border-foreground scale-110' : 'border-transparent',
                )}
                style={{ background: hex }}
                title={hex}
              />
            ))}
          </div>

          {/* Colour picker + hex input */}
          <div className="flex items-center gap-2">
            <label className="cursor-pointer touch-manipulation">
              <div
                className="w-9 h-9 rounded-lg border-2 border-border shadow-sm"
                style={{ background: hexInput || statusColours[editingKey] }}
              />
              <input
                type="color"
                value={hexInput || statusColours[editingKey]}
                onChange={e => { setHexInput(e.target.value); applyHex(e.target.value) }}
                className="sr-only"
              />
            </label>
            <input
              type="text"
              value={hexInput}
              onChange={e => setHexInput(e.target.value.toLowerCase())}
              onBlur={e => applyHex(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && applyHex(hexInput)}
              className="w-24 border rounded px-2 py-1.5 text-xs font-mono"
              placeholder="#bfdbfe"
              maxLength={7}
              spellCheck={false}
            />
            <button
              type="button"
              onClick={() => setEditingKey(null)}
              className="text-xs px-3 py-1.5 border rounded touch-manipulation hover:bg-accent ml-auto"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────

// 6 predefined timeline background swatches
const TIMELINE_BG_SWATCHES = [
  '#ffffff', // White (default)
  '#f8f9fa', // Light grey
  '#fdf6ec', // Warm cream
  '#eff6ff', // Pale blue
  '#f0fdf4', // Pale mint
  '#faf5ff', // Pale lavender
]

export default function Settings() {
  const { themeHex, setThemeHex, timelineBg, setTimelineBg } = useSettings()
  const tlSettings = useTimelineSettings()

  // Local hex input state so user can type freely; only apply on blur/enter
  const [hexInput, setHexInput] = useState(themeHex)
  const [applied,  setApplied]  = useState(false)

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

          {/* Theme colour */}
          <SettingRow
            label="Theme colour"
            description="Primary colour used for buttons, active states, and highlights throughout the app."
          >
            <div className="flex items-center gap-2">
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

          {/* Theme colour swatches */}
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

          {/* ── Divider ── */}
          <div className="border-t pt-5 -mx-5 px-5">
            <p className="text-sm font-medium mb-1">Timeline background</p>
            <p className="text-xs text-muted-foreground mb-4">
              Background colour of the empty areas on the Timeline canvas.
            </p>

            {/* 6 predefined bg swatches */}
            <div className="flex gap-2 flex-wrap mb-3">
              {TIMELINE_BG_SWATCHES.map(hex => (
                <button
                  key={hex}
                  type="button"
                  onClick={() => setTimelineBg(hex)}
                  className={cn(
                    'w-8 h-8 rounded-lg border-2 touch-manipulation transition-transform hover:scale-110',
                    timelineBg === hex ? 'border-foreground scale-110' : 'border-border',
                  )}
                  style={{ background: hex }}
                  title={hex}
                />
              ))}
            </div>

            <ColourPickerRow
              value={timelineBg}
              activeHex={timelineBg}
              onChange={setTimelineBg}
              swatches={[]}
              label="timeline background"
            />
          </div>

          {/* ── Divider ── */}
          <div className="border-t pt-5 -mx-5 px-5">
            <p className="text-sm font-medium mb-1">Booking status colours</p>
            <StatusColourEditor />
          </div>

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
            <Toggle value={tlSettings.panelMode} onChange={tlSettings.setPanelMode} label="Toggle panel mode" />
          </SettingRow>

          <SettingRow
            label="Section dividers"
            description="Group tables by section with labelled dividers."
          >
            <Toggle value={tlSettings.groupBySections} onChange={tlSettings.setGroupBySections} label="Toggle section dividers" />
          </SettingRow>

          <SettingRow
            label="Hide inactive bookings"
            description="Hide cancelled and no-show bookings by default."
          >
            <Toggle value={tlSettings.hideInactive} onChange={tlSettings.setHideInactive} label="Toggle hide inactive" />
          </SettingRow>
        </SectionCard>

      </div>
    </div>
  )
}
