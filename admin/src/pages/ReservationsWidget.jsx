// pages/ReservationsWidget.jsx
//
// Tenant-level Reservations widget defaults + management page. Every
// reservations_widget block on the public sites (and every external embed
// code) inherits these unless overridden on the block / embed itself.
//
// Stored on tenant_site.widget_settings (single JSONB column — same column
// used by the legacy widget; values are forward-compatible). Read +
// updated via the existing /website/tenant-site GET / PATCH endpoints.

import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useApi } from '@/lib/api'
import { Save, Loader2, Copy, ExternalLink, X } from 'lucide-react'
import { FontPicker } from '@/components/website-builder/FontPicker'
import { ThemeColourPicker, resolveRole } from '@/components/website-builder/ThemeColourPicker'

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
  button_fg:        '',
  button_radius_px: 8,
  card_radius_px:   8,
  border_colour:    '',
  font_family:      '',
  font_size_px:     16,
  // Per-element typography
  font_calendar_family: '',
  font_calendar_size_px: 15,
  font_slots_family:    '',
  font_slots_size_px:    14,
  // Calendar day colours (theme role names; '' = sensible default)
  cal_open_bg:        '',
  cal_open_fg:        '',
  cal_open_border:    '',
  cal_closed_bg:      '',
  cal_closed_fg:      '',
  cal_closed_border:  '',
  large_party_text: "Larger party? Call us — we’ll arrange combined tables.",
  debug_enabled:    false,
  // Confirmation page
  confirmation_heading:   "",
  confirmation_body_html: "",
  confirmation_ctas:      [],
}

export default function ReservationsWidget() {
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
  // Live preview iframe — operator can pick which venue to preview, and
  // we bump `previewKey` after save to force the iframe to reload with
  // the latest server-rendered defaults.
  const [previewVenueId, setPreviewVenueId] = useState(null)
  const [previewKey,     setPreviewKey]     = useState(0)
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
      setPreviewKey(k => k + 1)  // remount the preview iframe
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
    return <div className="h-full overflow-y-auto">
      <div className="p-8 flex items-center gap-2 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
      </div>
    </div>
  }

  // AppShell's <main> is overflow-hidden — the page needs its own scrolling
  // container or content past the fold gets stranded (CLAUDE.md gotcha).
  return (
    <div className="h-full overflow-y-auto">
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Reservations widget</h1>
        <p className="text-sm text-muted-foreground mt-1">
          These settings apply to every Reservations widget across all your venues unless
          overridden on a specific embed (page-builder block or external embed code).
          Live preview shows below — what you see here is what visitors see.
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
        hint='The "Continue / Confirm" button styling. Pick a role from the brand palette.'>
        <Field label="Background colour"
          hint="Blank = brand primary colour.">
          <ThemeColourPicker value={form.button_bg} onChange={set('button_bg')} />
        </Field>
        <Field label="Text colour" hint="Blank = white.">
          <ThemeColourPicker value={form.button_fg} onChange={set('button_fg')} />
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
          hint="Used for input outlines and chip borders. Blank = the theme's border role.">
          <ThemeColourPicker value={form.border_colour} onChange={set('border_colour')} />
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
        hint="Three independent font tracks — the widget's body, the calendar date numbers, and the slot time buttons. Each can be a different Google Font + size.">
        <Field label="Body font" hint="Used for headers, button labels, form fields. Blank = brand body font.">
          <FontPicker
            fonts={FONT_OPTIONS}
            value={form.font_family}
            onChange={set('font_family')}
            placeholder={tenantSite?.font_family || 'Brand font'} />
        </Field>
        <Field label={`Body size — ${form.font_size_px ?? 16}px`}>
          <input type="range" min={11} max={22} step={1}
            value={form.font_size_px ?? 16}
            onChange={e => set('font_size_px')(Number(e.target.value))}
            className="w-full" />
        </Field>
        <hr className="my-3 border-border" />
        <Field label="Calendar font" hint="The day numbers in the date picker. Try a tabular sans for clean alignment.">
          <FontPicker
            fonts={FONT_OPTIONS}
            value={form.font_calendar_family}
            onChange={set('font_calendar_family')}
            placeholder="Inherit body font" />
        </Field>
        <Field label={`Calendar size — ${form.font_calendar_size_px ?? 15}px`}>
          <input type="range" min={10} max={28} step={1}
            value={form.font_calendar_size_px ?? 15}
            onChange={e => set('font_calendar_size_px')(Number(e.target.value))}
            className="w-full" />
        </Field>
        <hr className="my-3 border-border" />
        <Field label="Time slots font" hint="The HH:MM buttons on the time-pick step.">
          <FontPicker
            fonts={FONT_OPTIONS}
            value={form.font_slots_family}
            onChange={set('font_slots_family')}
            placeholder="Inherit body font" />
        </Field>
        <Field label={`Time slots size — ${form.font_slots_size_px ?? 14}px`}>
          <input type="range" min={10} max={28} step={1}
            value={form.font_slots_size_px ?? 14}
            onChange={e => set('font_slots_size_px')(Number(e.target.value))}
            className="w-full" />
        </Field>
      </Card>

      {/* Calendar colours */}
      <Card title="Calendar day colours"
        hint="Available days vs closed days (venue's day-off, e.g. Sunday). Theme roles only — pick from the brand palette. Blank fields fall back to sensible defaults.">
        <Field label="Open day — background"><ThemeColourPicker value={form.cal_open_bg} onChange={set('cal_open_bg')} /></Field>
        <Field label="Open day — text"><ThemeColourPicker value={form.cal_open_fg} onChange={set('cal_open_fg')} /></Field>
        <Field label="Open day — border"><ThemeColourPicker value={form.cal_open_border} onChange={set('cal_open_border')} /></Field>
        <hr className="my-3 border-border" />
        <Field label="Closed day — background"><ThemeColourPicker value={form.cal_closed_bg} onChange={set('cal_closed_bg')} /></Field>
        <Field label="Closed day — text"><ThemeColourPicker value={form.cal_closed_fg} onChange={set('cal_closed_fg')} /></Field>
        <Field label="Closed day — border"><ThemeColourPicker value={form.cal_closed_border} onChange={set('cal_closed_border')} /></Field>
      </Card>

      {/* Confirmation page */}
      <Card title="Confirmation page"
        hint="Content shown to guests after a successful booking. Merge fields: {{reference}} {{guest_name}} {{date}} {{time}} {{covers}} {{venue_name}} {{email}}.">
        <Field label="Heading" hint='Override "You\'re booked". Blank = default.'>
          <input className={inputClass}
            value={form.confirmation_heading || ''}
            onChange={e => set('confirmation_heading')(e.target.value)}
            placeholder="You're booked!" />
        </Field>
        <Field label="Body HTML"
          hint="Shown below the booking summary card. Supports HTML tags and the merge fields above.">
          <ConfBodyEditor
            value={form.confirmation_body_html || ''}
            onChange={set('confirmation_body_html')}
            inputClass={inputClass}
          />
        </Field>
        <Field label="CTA buttons"
          hint="Up to 4 buttons shown below the body. Link to a menu, directions, review page, etc.">
          <CtaListEditor
            value={form.confirmation_ctas || []}
            onChange={set('confirmation_ctas')}
            inputClass={inputClass}
          />
        </Field>
      </Card>

      {/* Debug */}
      <Card title="Debug"
        hint="Diagnostic overlay shown at the top of the widget. Helps identify state + API issues. Leave OFF for normal customers.">
        <Field label="Show debug overlay">
          <ToggleSwitch checked={!!form.debug_enabled} onChange={set('debug_enabled')} />
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

      {/* Live preview */}
      <Card title="Live preview"
        hint="The actual widget your visitors will see, rendered with your saved defaults.">
        {venues.length === 0
          ? <p className="text-sm text-muted-foreground">Add a venue to preview the widget.</p>
          : (
            <>
              {venues.length > 1 && (
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {venues.map(v => (
                    <button key={v.id} type="button"
                      onClick={() => setPreviewVenueId(v.id)}
                      className={`text-xs border rounded-full px-3 py-1.5 min-h-[32px]
                        ${(previewVenueId || venues[0].id) === v.id
                          ? 'bg-primary/10 border-primary text-primary font-medium'
                          : 'hover:bg-accent'}`}>
                      {v.name}
                    </button>
                  ))}
                </div>
              )}
              <iframe
                key={previewKey /* force remount on save so preview reflects new defaults */}
                src={buildEmbedSrc({
                  tenantId,
                  subdomain,
                  venueId: previewVenueId || venues[0].id,
                  settings: form,
                  theme: tenantSite?.theme,
                })}
                title="Reservations widget preview"
                style={{
                  width: '100%', minHeight: 720, border: '1px solid var(--border)',
                  borderRadius: 8, background: 'transparent',
                }}
              />
            </>
          )}
      </Card>

      {/* Share / embed */}
      <Card title="Share & embed"
        hint="Direct URL for sharing the widget standalone (email, SMS, link in bio) + iframe code for embedding on third-party sites. Both use your current saved defaults.">
        {venues.length === 0
          ? <p className="text-sm text-muted-foreground">Add a venue first — the embed needs a venueId.</p>
          : venues.map(v => {
            const src = buildEmbedSrc({
              tenantId,
              subdomain,
              venueId: v.id,
              settings: form,
              theme: tenantSite?.theme,
            })
            return (
              <div key={v.id} className="space-y-2 mb-4 pb-4 border-b last:border-b-0 last:pb-0 last:mb-0">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{v.name}</p>

                <div className="space-y-1">
                  <p className="text-[11px] text-muted-foreground">Direct URL</p>
                  <UrlSnippet src={src} />
                </div>

                <div className="space-y-1">
                  <p className="text-[11px] text-muted-foreground">Iframe embed code</p>
                  <EmbedSnippet src={src} />
                </div>
              </div>
            )
          })}
        <p className="text-xs text-muted-foreground mt-2">
          Both forms include the current settings as URL query params. Existing embeds
          keep working — they only override what the snippet specifies.
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

function UrlSnippet({ src }) {
  // Direct widget URL — useful for sharing in emails / SMS / "link in bio".
  // Anything that can render a URL can show this. Clickable to open in a
  // new tab so the operator can sanity-check what visitors will land on.
  return (
    <div className="flex items-stretch gap-2">
      <a href={src} target="_blank" rel="noopener"
        className="flex-1 text-[11px] font-mono bg-muted rounded p-2 overflow-x-auto whitespace-nowrap text-primary hover:underline truncate"
        title={src}>
        {src}
      </a>
      <button type="button"
        onClick={() => navigator.clipboard?.writeText(src)}
        title="Copy URL"
        className="border rounded px-2 hover:bg-accent inline-flex items-center">
        <Copy className="w-3.5 h-3.5" />
      </button>
      <a href={src} target="_blank" rel="noopener"
        title="Open in a new tab"
        className="border rounded px-2 hover:bg-accent inline-flex items-center">
        <ExternalLink className="w-3.5 h-3.5" />
      </a>
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
        title="Copy embed code"
        className="border rounded px-2 hover:bg-accent inline-flex items-center">
        <Copy className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

const MERGE_FIELDS = [
  '{{reference}}', '{{guest_name}}', '{{date}}', '{{time}}',
  '{{covers}}', '{{venue_name}}', '{{email}}',
]

function ConfBodyEditor({ value, onChange, inputClass }) {
  const ref = useRef(null)

  function insertField(field) {
    const el = ref.current
    if (!el) { onChange(value + field); return }
    const start = el.selectionStart
    const end   = el.selectionEnd
    const next  = value.slice(0, start) + field + value.slice(end)
    onChange(next)
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = start + field.length
      el.focus()
    })
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {MERGE_FIELDS.map(f => (
          <button key={f} type="button"
            onClick={() => insertField(f)}
            className="text-[10px] font-mono bg-primary/10 text-primary border border-primary/20 rounded px-1.5 py-0.5 hover:bg-primary/20">
            {f}
          </button>
        ))}
      </div>
      <textarea
        ref={ref}
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={5}
        placeholder={'<p>See you soon, {{guest_name}}! Your reference is <strong>{{reference}}</strong>.</p>'}
        className={inputClass + ' font-mono text-xs min-h-[90px]'}
      />
    </div>
  )
}

function CtaListEditor({ value, onChange, inputClass }) {
  const ctas = value || []

  function update(i, field, val) {
    onChange(ctas.map((c, idx) => idx === i ? { ...c, [field]: val } : c))
  }
  function addCta() {
    if (ctas.length >= 4) return
    onChange([...ctas, { label: '', url: '', bg: 'primary', fg: '' }])
  }
  function removeCta(i) {
    onChange(ctas.filter((_, idx) => idx !== i))
  }

  return (
    <div className="space-y-2">
      {ctas.map((cta, i) => (
        <div key={i} className="border rounded-md p-2.5 space-y-2 bg-muted/30">
          <div className="flex items-center gap-1.5">
            <input
              value={cta.label || ''}
              onChange={e => update(i, 'label', e.target.value)}
              placeholder="Button label"
              className={inputClass + ' flex-1'}
            />
            <button type="button" onClick={() => removeCta(i)}
              className="text-destructive hover:bg-destructive/10 p-1.5 rounded flex-shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>
          <input
            value={cta.url || ''}
            onChange={e => update(i, 'url', e.target.value)}
            placeholder="https://..."
            className={inputClass}
          />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="text-[10px] text-muted-foreground mb-1">Background colour</div>
              <ThemeColourPicker value={cta.bg} onChange={v => update(i, 'bg', v)} />
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground mb-1">Text colour</div>
              <ThemeColourPicker value={cta.fg} onChange={v => update(i, 'fg', v)} />
            </div>
          </div>
        </div>
      ))}
      {ctas.length < 4 && (
        <button type="button" onClick={addCta}
          className="w-full text-xs border-2 border-dashed rounded-md py-2.5 text-muted-foreground hover:text-foreground hover:border-foreground/40">
          + Add button
        </button>
      )}
    </div>
  )
}

// Builds the same query string the booking_widget block partial sends —
// so previewing the embed in this page matches what visitors see. Resolves
// theme role names to actual hex colours since the widget URL params
// require hex (the widget route can't query the theme).
function buildEmbedSrc({ tenantId, subdomain, venueId, settings, theme }) {
  const origin = subdomain ? `https://${subdomain}.macaroonie.com` : ''
  const path   = `/reservations/${venueId}`
  const params = []
  const hexFromRole = (v) => {
    const out = resolveRole(v, theme)
    return out ? out.replace(/^#/, '') : null
  }
  params.push('theme=light')
  if (settings.header_show === false) params.push('headerShow=0')
  if (settings.header_show === true)  params.push('headerShow=1')
  if (settings.header_text)    params.push('header='   + encodeURIComponent(settings.header_text))
  if (settings.subheader_text) params.push('sub='      + encodeURIComponent(settings.subheader_text))
  const btnBgHex = hexFromRole(settings.button_bg)
  const btnFgHex = hexFromRole(settings.button_fg)
  const brdHex   = hexFromRole(settings.border_colour)
  if (btnBgHex) params.push('btnBg=' + btnBgHex)
  if (btnFgHex) params.push('btnFg=' + btnFgHex)
  if (brdHex)   params.push('brd='   + brdHex)
  if (typeof settings.button_radius_px === 'number') params.push('btnR='  + settings.button_radius_px)
  if (typeof settings.card_radius_px   === 'number') params.push('cardR=' + settings.card_radius_px)
  if (settings.font_family)    params.push('font='     + encodeURIComponent(settings.font_family))
  if (typeof settings.font_size_px === 'number') params.push('fontS=' + settings.font_size_px)
  if (settings.font_calendar_family) params.push('calFont='  + encodeURIComponent(settings.font_calendar_family))
  if (typeof settings.font_calendar_size_px === 'number') params.push('calSz=' + settings.font_calendar_size_px)
  if (settings.font_slots_family)    params.push('slotFont=' + encodeURIComponent(settings.font_slots_family))
  if (typeof settings.font_slots_size_px === 'number')    params.push('slotSz=' + settings.font_slots_size_px)
  // Calendar day colours — resolve role names to hex for the URL params.
  const coBg = hexFromRole(settings.cal_open_bg)
  const coFg = hexFromRole(settings.cal_open_fg)
  const coBd = hexFromRole(settings.cal_open_border)
  const ccBg = hexFromRole(settings.cal_closed_bg)
  const ccFg = hexFromRole(settings.cal_closed_fg)
  const ccBd = hexFromRole(settings.cal_closed_border)
  if (coBg) params.push('coBg=' + coBg)
  if (coFg) params.push('coFg=' + coFg)
  if (coBd) params.push('coBd=' + coBd)
  if (ccBg) params.push('ccBg=' + ccBg)
  if (ccFg) params.push('ccFg=' + ccFg)
  if (ccBd) params.push('ccBd=' + ccBd)
  if (settings.large_party_text) params.push('lp='     + encodeURIComponent(settings.large_party_text))
  if (settings.debug_enabled) params.push('debug=1')
  if (settings.confirmation_heading) params.push('confHead=' + encodeURIComponent(settings.confirmation_heading))
  if (settings.confirmation_body_html) params.push('confBody=' + encodeURIComponent(settings.confirmation_body_html))
  if (settings.confirmation_ctas && settings.confirmation_ctas.length > 0) {
    const ctas = settings.confirmation_ctas
      .filter(c => c.label && c.url)
      .map(c => ({
        label: c.label,
        url:   c.url,
        bg:    hexFromRole(c.bg) ? '#' + hexFromRole(c.bg) : null,
        fg:    hexFromRole(c.fg) ? '#' + hexFromRole(c.fg) : null,
      }))
    if (ctas.length > 0) params.push('ctas=' + encodeURIComponent(JSON.stringify(ctas)))
  }
  return origin + path + '?' + params.join('&')
}
