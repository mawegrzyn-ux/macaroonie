// pages/WidgetSettings.jsx
//
// Tenant-level booking widget defaults. Every booking_widget block on the
// public sites (and every widget embed code) inherits these unless
// overridden on the block / embed itself.
//
// Stored on tenant_site.widget_settings (single JSONB column). Read +
// updated via the existing /website/tenant-site GET / PATCH endpoints.

import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useApi } from '@/lib/api'
import { Save, Loader2, Copy, ExternalLink } from 'lucide-react'
import { FontPicker } from '@/components/website-builder/FontPicker'

const FONT_OPTIONS = [
  'Inter', 'Fraunces', 'Caveat', 'Playfair Display', 'Poppins',
  'Lora', 'Montserrat', 'Roboto', 'Open Sans', 'Raleway',
  'Merriweather', 'Work Sans', 'Karla', 'DM Sans', 'DM Serif Display',
  'Space Grotesk', 'Manrope', 'Cormorant Garamond', 'Libre Baskerville',
  'Nunito', 'Rubik',
]

const DEFAULT_SETTINGS = {
  header_show:      true,
  header_text:      '',
  subheader_text:   '',
  button_bg:        '',
  button_fg:        '#ffffff',
  button_radius_px: 8,
  card_radius_px:   8,
  border_colour:    '',
  font_family:      '',
  large_party_text: 'Larger party? Call us — we’ll arrange combined tables.',
}

export default function WidgetSettings() {
  const api = useApi()
  const qc  = useQueryClient()

  const { data: tenantSite, isLoading } = useQuery({
    queryKey: ['tenant-site'],
    queryFn:  () => api.get('/website/tenant-site'),
  })
  const { data: venues = [] } = useQuery({
    queryKey: ['venues'],
    queryFn:  () => api.get('/venues'),
    staleTime: 60_000,
  })

  // Local form state — initialised once tenantSite loads, replaced on save.
  const [form,   setForm]   = useState(DEFAULT_SETTINGS)
  const [dirty,  setDirty]  = useState(false)
  const [error,  setError]  = useState(null)
  const [saved,  setSaved]  = useState(false)
  useEffect(() => {
    if (!tenantSite) return
    setForm({ ...DEFAULT_SETTINGS, ...(tenantSite.widget_settings || {}) })
    setDirty(false)
  }, [tenantSite])

  const set = (k) => (v) => {
    setForm(f => ({ ...f, [k]: v }))
    setDirty(true)
    setSaved(false)
  }

  const save = useMutation({
    mutationFn: (body) => api.patch('/website/tenant-site', body),
    onSuccess: (row) => {
      setForm({ ...DEFAULT_SETTINGS, ...(row.widget_settings || {}) })
      setDirty(false)
      setSaved(true)
      setError(null)
      qc.invalidateQueries({ queryKey: ['tenant-site'] })
    },
    onError: (e) => setError(e?.body?.error || e.message || 'Save failed'),
  })

  const tenantId = tenantSite?.tenant_id
  const subdomain = tenantSite?.subdomain_slug

  function onSave() {
    // Strip empty strings so the merge logic on the server uses fallbacks
    // for blank fields rather than persisting them as overrides.
    const cleaned = Object.fromEntries(
      Object.entries(form).map(([k, v]) => [k, v === '' ? null : v]),
    )
    save.mutate({ widget_settings: cleaned })
  }

  if (isLoading) {
    return <div className="p-8 flex items-center gap-2 text-muted-foreground">
      <Loader2 className="w-4 h-4 animate-spin" /> Loading…
    </div>
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Booking widget defaults</h1>
        <p className="text-sm text-muted-foreground mt-1">
          These settings apply to every booking widget across all your venues unless
          overridden on a specific embed (block or external embed code).
        </p>
      </div>

      {/* Header */}
      <Card title="Header"
        hint='The text shown at the top of the widget ("Brand / Book a table").'>
        <Field label="Show header">
          <ToggleSwitch checked={!!form.header_show} onChange={set('header_show')} />
        </Field>
        <Field label="Header text"
          hint="Override the brand/site name shown at the top of the widget. Blank = use site name.">
          <input className={inputClass}
            value={form.header_text || ''}
            onChange={e => set('header_text')(e.target.value)}
            placeholder={tenantSite?.site_name || tenantSite?.brand_name || 'Site name'} />
        </Field>
        <Field label="Sub-header"
          hint='Smaller line below the header. Default: "Book a table".'>
          <input className={inputClass}
            value={form.subheader_text || ''}
            onChange={e => set('subheader_text')(e.target.value)}
            placeholder="Book a table" />
        </Field>
      </Card>

      {/* Button */}
      <Card title="Button"
        hint='The "Continue / Confirm" button styling.'>
        <Field label="Background colour"
          hint="Blank = brand primary colour.">
          <ColourInput value={form.button_bg} onChange={set('button_bg')}
            placeholder={tenantSite?.primary_colour || ''} />
        </Field>
        <Field label="Text colour" hint="Default white.">
          <ColourInput value={form.button_fg} onChange={set('button_fg')}
            placeholder="#ffffff" />
        </Field>
        <Field label={`Corner radius — ${form.button_radius_px ?? 8}px`}>
          <input type="range" min={0} max={40} step={1}
            value={form.button_radius_px ?? 8}
            onChange={e => set('button_radius_px')(Number(e.target.value))}
            className="w-full" />
        </Field>
      </Card>

      {/* Borders */}
      <Card title="Borders + radii">
        <Field label="Border colour"
          hint="Used for input outlines and chip borders. Blank = subtle theme grey.">
          <ColourInput value={form.border_colour} onChange={set('border_colour')}
            placeholder="" />
        </Field>
        <Field label={`Card / chip radius — ${form.card_radius_px ?? 8}px`}>
          <input type="range" min={0} max={40} step={1}
            value={form.card_radius_px ?? 8}
            onChange={e => set('card_radius_px')(Number(e.target.value))}
            className="w-full" />
        </Field>
      </Card>

      {/* Typography */}
      <Card title="Typography"
        hint="Choose a different font for the widget if you want it to feel like a CTA distinct from the page typography.">
        <Field label="Widget font" hint="Blank = use the brand body font.">
          <FontPicker
            fonts={FONT_OPTIONS}
            value={form.font_family}
            onChange={set('font_family')}
            placeholder={tenantSite?.font_family || 'Brand font'} />
        </Field>
      </Card>

      {/* Messages */}
      <Card title="Messages">
        <Field label="“Larger party” text"
          hint="Shown under the covers row in the widget. Set to a single space to hide it entirely.">
          <textarea className={inputClass + ' min-h-[60px]'}
            value={form.large_party_text || ''}
            onChange={e => set('large_party_text')(e.target.value)}
            placeholder="Larger party? Call us — we’ll arrange combined tables." />
        </Field>
      </Card>

      {/* Embed snippet */}
      <Card title="External embed code"
        hint="Drop this into any third-party site to embed the widget with these defaults.">
        {venues.length === 0
          ? <p className="text-sm text-muted-foreground">Add a venue first — the embed needs a venueId.</p>
          : venues.map(v => (
            <div key={v.id} className="space-y-1 mb-3">
              <p className="text-xs font-medium text-muted-foreground">{v.name}</p>
              <EmbedSnippet
                src={buildEmbedSrc({ tenantId, subdomain, venueId: v.id, settings: form })} />
            </div>
          ))}
        <p className="text-xs text-muted-foreground mt-2">
          The embed sends the same overrides as a query string. If you change defaults
          here, existing embeds keep working — they only override what the snippet specifies.
        </p>
      </Card>

      {/* Save bar */}
      <div className="sticky bottom-0 bg-background border-t pt-3 pb-2 flex items-center gap-3">
        <button type="button" disabled={!dirty || save.isPending}
          onClick={onSave}
          className="inline-flex items-center gap-2 bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50">
          {save.isPending
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
            : <><Save className="w-4 h-4" /> Save defaults</>}
        </button>
        {saved && !dirty && <span className="text-xs text-green-700">Saved.</span>}
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    </div>
  )
}

// ── Pieces ─────────────────────────────────────────────────

const inputClass = 'w-full text-sm border rounded-md px-2 py-1.5 min-h-[36px] bg-background'

function Card({ title, hint, children }) {
  return (
    <div className="border rounded-lg p-4 bg-background">
      <h2 className="text-sm font-semibold">{title}</h2>
      {hint && <p className="text-xs text-muted-foreground mt-0.5 mb-3">{hint}</p>}
      <div className="space-y-3 mt-3">{children}</div>
    </div>
  )
}

function Field({ label, hint, children }) {
  return (
    <div>
      <div className="text-xs font-medium mb-1">{label}</div>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground mt-1">{hint}</p>}
    </div>
  )
}

function ToggleSwitch({ checked, onChange }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
      <input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)} />
      <span>{checked ? 'On' : 'Off'}</span>
    </label>
  )
}

function ColourInput({ value, onChange, placeholder = '' }) {
  const v = value || ''
  const isValid = /^#?[0-9a-fA-F]{6}$/.test(v)
  const swatch  = isValid
    ? (v.startsWith('#') ? v : '#' + v)
    : (placeholder.startsWith('#') ? placeholder : (placeholder ? '#' + placeholder : '#cccccc'))
  return (
    <div className="flex items-center gap-2">
      <input type="color"
        value={isValid ? swatch : '#cccccc'}
        onChange={e => onChange(e.target.value)}
        className="w-10 h-9 border rounded cursor-pointer" />
      <input className={inputClass + ' font-mono text-xs'}
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder || '#hhhhhh'} />
    </div>
  )
}

function EmbedSnippet({ src }) {
  const code = `<iframe src="${src}" style="width:100%; min-height:640px; border:0;" loading="lazy" title="Book a table"></iframe>`
  return (
    <div className="flex items-stretch gap-2">
      <pre className="flex-1 text-[11px] font-mono bg-muted rounded p-2 overflow-x-auto whitespace-pre">{code}</pre>
      <button type="button"
        onClick={() => navigator.clipboard?.writeText(code)}
        title="Copy"
        className="border rounded px-2 hover:bg-accent inline-flex items-center">
        <Copy className="w-3.5 h-3.5" />
      </button>
      <a href={src} target="_blank" rel="noopener"
        title="Preview in a new tab"
        className="border rounded px-2 hover:bg-accent inline-flex items-center">
        <ExternalLink className="w-3.5 h-3.5" />
      </a>
    </div>
  )
}

// Builds the same query string the booking_widget block partial sends —
// so previewing the embed in this page matches what visitors see.
function buildEmbedSrc({ tenantId, subdomain, venueId, settings }) {
  const origin = subdomain ? `https://${subdomain}.macaroonie.com` : ''
  const path   = `/widget/${venueId}`
  const params = []
  // Theme / accent left at defaults — operators tweak these in the page builder.
  params.push('theme=light')
  if (settings.header_show === false) params.push('headerShow=0')
  if (settings.header_show === true)  params.push('headerShow=1')
  if (settings.header_text)    params.push('header='   + encodeURIComponent(settings.header_text))
  if (settings.subheader_text) params.push('sub='      + encodeURIComponent(settings.subheader_text))
  if (settings.button_bg)      params.push('btnBg='    + settings.button_bg.replace(/^#/, ''))
  if (settings.button_fg)      params.push('btnFg='    + settings.button_fg.replace(/^#/, ''))
  if (typeof settings.button_radius_px === 'number') params.push('btnR='  + settings.button_radius_px)
  if (typeof settings.card_radius_px   === 'number') params.push('cardR=' + settings.card_radius_px)
  if (settings.border_colour)  params.push('brd='      + settings.border_colour.replace(/^#/, ''))
  if (settings.font_family)    params.push('font='     + encodeURIComponent(settings.font_family))
  if (settings.large_party_text) params.push('lp='     + encodeURIComponent(settings.large_party_text))
  return origin + path + '?' + params.join('&')
}
