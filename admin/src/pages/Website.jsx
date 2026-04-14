// src/pages/Website.jsx
//
// Tenant Website Builder — admin page.
//
// One TanStack Query for the singleton website_config; sibling queries for
// gallery / pages / menus / opening-hours / allergens. Sections each have
// their own save flow so the page never holds a giant pending form.
//
// First-time visit: GET /website/config returns {} → onboarding card asks
// for a subdomain slug then POSTs to create the row.

import { useState, useEffect, useMemo, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Globe, Palette, LayoutTemplate, Image as ImageIcon, FileText, BookOpen,
  AlertTriangle, Clock, MapPin, Phone, ShoppingBag, Truck, Calendar,
  Search, BarChart3, Eye, EyeOff, Check, X, Upload, Trash2, GripVertical,
  Plus, ExternalLink, Loader2,
} from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'

// ── Section list (drives the left rail) ─────────────────────

const SECTIONS = [
  { key: 'setup',     label: 'Setup & domain', icon: Globe },
  { key: 'template',  label: 'Template',       icon: LayoutTemplate },
  { key: 'theme',     label: 'Theme',          icon: Palette },
  { key: 'branding',  label: 'Branding',       icon: ImageIcon },
  { key: 'hero',      label: 'Hero',           icon: ImageIcon },
  { key: 'about',     label: 'About',          icon: FileText },
  { key: 'gallery',   label: 'Gallery',        icon: ImageIcon },
  { key: 'menu',      label: 'Menus (PDF)',    icon: BookOpen },
  { key: 'allergens', label: 'Allergens',      icon: AlertTriangle },
  { key: 'hours',     label: 'Opening hours',  icon: Clock },
  { key: 'find',      label: 'Find us',        icon: MapPin },
  { key: 'contact',   label: 'Contact',        icon: Phone },
  { key: 'ordering',  label: 'Online ordering',icon: ShoppingBag },
  { key: 'delivery',  label: 'Delivery',       icon: Truck },
  { key: 'booking',   label: 'Booking widget', icon: Calendar },
  { key: 'pages',     label: 'Custom pages',   icon: FileText },
  { key: 'seo',       label: 'SEO',            icon: Search },
  { key: 'analytics', label: 'Analytics',      icon: BarChart3 },
]

// ── Shared layout primitives (matches Settings.jsx style) ───

function SectionCard({ title, description, action, children }) {
  return (
    <div className="bg-background border rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b bg-muted/40 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
        </div>
        {action}
      </div>
      <div className="p-5 space-y-5">{children}</div>
    </div>
  )
}

function FormRow({ label, hint, error, children }) {
  return (
    <div>
      <label className="text-sm font-medium block mb-1">{label}</label>
      {hint && <p className="text-xs text-muted-foreground mb-1.5">{hint}</p>}
      {children}
      {error && <p className="text-xs text-destructive mt-1">{error}</p>}
    </div>
  )
}

function TextInput({ className = '', ...props }) {
  return (
    <input
      className={cn(
        'w-full border rounded-md px-3 py-2 text-sm bg-background',
        'focus:outline-none focus:ring-1 focus:ring-primary',
        'min-h-[44px] touch-manipulation',
        className,
      )}
      {...props}
    />
  )
}

function TextArea({ className = '', ...props }) {
  return (
    <textarea
      className={cn(
        'w-full border rounded-md px-3 py-2 text-sm bg-background',
        'focus:outline-none focus:ring-1 focus:ring-primary',
        'min-h-[100px] resize-y touch-manipulation',
        className,
      )}
      {...props}
    />
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

function SaveBar({ dirty, onSave, onReset, saving }) {
  if (!dirty) return null
  return (
    <div className="flex items-center justify-end gap-2 pt-2 border-t">
      <button
        type="button" onClick={onReset}
        className="text-xs text-muted-foreground hover:text-foreground px-3 py-1.5"
      >Reset</button>
      <button
        type="button" onClick={onSave} disabled={saving}
        className="bg-primary text-primary-foreground text-sm font-medium rounded-md px-4 py-2 min-h-[40px] inline-flex items-center gap-2 disabled:opacity-50"
      >
        {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
        {saving ? 'Saving…' : 'Save changes'}
      </button>
    </div>
  )
}

// ── File upload helper ──────────────────────────────────────

function FileUpload({ kind = 'images', accept, onUploaded, label = 'Upload', children }) {
  const api = useApi()
  const inputRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)

  async function handleFiles(files) {
    if (!files?.[0]) return
    setUploading(true); setError(null)
    try {
      const res = await api.upload('/website/upload', files[0], { kind })
      onUploaded?.(res)
    } catch (e) {
      setError(e?.body?.error || e.message || 'Upload failed')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div>
      <input
        ref={inputRef} type="file" hidden accept={accept}
        onChange={e => handleFiles(e.target.files)}
      />
      {children
        ? <span onClick={() => inputRef.current?.click()}>{children}</span>
        : (
          <button
            type="button" onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-2 border rounded-md px-3 py-2 text-sm hover:bg-accent min-h-[40px] disabled:opacity-50"
          >
            {uploading
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Upload className="w-4 h-4" />}
            {uploading ? 'Uploading…' : label}
          </button>
        )}
      {error && <p className="text-xs text-destructive mt-1">{error}</p>}
    </div>
  )
}

function ImageField({ url, kind = 'images', onChange, hint }) {
  return (
    <div>
      {url ? (
        <div className="flex items-center gap-3">
          <img src={url} alt="" className="w-20 h-20 object-cover rounded border" />
          <div className="flex flex-col gap-1.5">
            <FileUpload kind={kind} accept="image/*"
              onUploaded={r => onChange(r.url)}
              label="Replace" />
            <button
              type="button" onClick={() => onChange(null)}
              className="text-xs text-destructive hover:underline self-start"
            >Remove</button>
          </div>
        </div>
      ) : (
        <FileUpload kind={kind} accept="image/*"
          onUploaded={r => onChange(r.url)}
          label="Upload image" />
      )}
      {hint && <p className="text-xs text-muted-foreground mt-1.5">{hint}</p>}
    </div>
  )
}

// ── Onboarding (no website_config row yet) ──────────────────

function OnboardingCard({ onCreated }) {
  const api = useApi()
  const qc  = useQueryClient()
  const [slug, setSlug] = useState('')
  const [error, setError] = useState(null)

  const create = useMutation({
    mutationFn: (subdomain_slug) => api.post('/website/config', { subdomain_slug }),
    onSuccess: (cfg) => { qc.setQueryData(['website-config'], cfg); onCreated?.(cfg) },
    onError: (e) => setError(e?.body?.error || e.message || 'Create failed'),
  })

  function onCreate() {
    setError(null)
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug)) {
      setError('Use lowercase letters, digits and hyphens (max 63 chars).')
      return
    }
    create.mutate(slug)
  }

  return (
    <div className="max-w-xl mx-auto mt-12">
      <div className="border rounded-xl bg-background p-8">
        <h2 className="text-lg font-semibold mb-1">Set up your website</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Pick a subdomain to host your site. You can connect a custom domain later.
        </p>
        <FormRow label="Subdomain" hint="Will be available at {slug}.macaroonie.com">
          <div className="flex items-stretch gap-2">
            <TextInput
              autoFocus value={slug}
              onChange={e => setSlug(e.target.value.toLowerCase())}
              placeholder="wingstop"
              className="flex-1"
            />
            <span className="inline-flex items-center px-3 text-sm text-muted-foreground bg-muted rounded-md">
              .macaroonie.com
            </span>
          </div>
        </FormRow>
        {error && <p className="text-xs text-destructive mt-2">{error}</p>}
        <button
          onClick={onCreate} disabled={create.isPending || !slug}
          className="mt-6 bg-primary text-primary-foreground text-sm font-medium rounded-md px-5 py-2.5 min-h-[44px] inline-flex items-center gap-2 disabled:opacity-50"
        >
          {create.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
          Create website
        </button>
      </div>
    </div>
  )
}

// ── Setup & domain section ──────────────────────────────────

function SetupSection({ config }) {
  const api = useApi()
  const qc  = useQueryClient()
  const [slug,    setSlug]    = useState(config.subdomain_slug || '')
  const [domain,  setDomain]  = useState(config.custom_domain  || '')
  const [pubd,    setPubd]    = useState(!!config.is_published)
  const [slugCheck, setSlugCheck] = useState(null)
  const [verifying,  setVerifying]  = useState(false)
  const [verifyResult, setVerifyResult] = useState(null)

  const dirty = slug !== (config.subdomain_slug || '') ||
                domain !== (config.custom_domain || '') ||
                pubd !== !!config.is_published

  // Debounced slug availability check
  useEffect(() => {
    if (!slug || slug === config.subdomain_slug) { setSlugCheck(null); return }
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug)) {
      setSlugCheck({ ok: false, msg: 'Invalid format' }); return
    }
    const id = setTimeout(async () => {
      try {
        const r = await api.get(`/website/slug-available?slug=${encodeURIComponent(slug)}`)
        setSlugCheck(r.available
          ? { ok: true, msg: 'Available' }
          : { ok: false, msg: 'Already taken' })
      } catch { setSlugCheck(null) }
    }, 400)
    return () => clearTimeout(id)
  }, [slug, config.subdomain_slug, api])

  const save = useMutation({
    mutationFn: () => api.patch('/website/config', {
      subdomain_slug: slug,
      custom_domain:  domain || null,
      is_published:   pubd,
    }),
    onSuccess: (cfg) => qc.setQueryData(['website-config'], cfg),
  })

  const verify = useMutation({
    mutationFn: () => api.post('/website/verify-domain', {}),
    onMutate:   () => setVerifying(true),
    onSettled:  () => setVerifying(false),
    onSuccess:  (r) => {
      setVerifyResult(r)
      qc.invalidateQueries({ queryKey: ['website-config'] })
    },
    onError:    (e) => setVerifyResult({ verified: false, error: e?.body?.error || e.message }),
  })

  function onReset() {
    setSlug(config.subdomain_slug || '')
    setDomain(config.custom_domain || '')
    setPubd(!!config.is_published)
  }

  const liveUrl = config.subdomain_slug
    ? `https://${config.subdomain_slug}.macaroonie.com`
    : null
  const customLiveUrl = config.custom_domain && config.custom_domain_verified
    ? `https://${config.custom_domain}` : null

  return (
    <div className="space-y-5">
      <SectionCard
        title="Domain"
        description="Where guests find your site"
        action={liveUrl && (
          <a href={liveUrl} target="_blank" rel="noopener"
             className="text-xs text-primary hover:underline inline-flex items-center gap-1">
            Visit <ExternalLink className="w-3 h-3" />
          </a>
        )}
      >
        <FormRow label="Subdomain" hint="Always available at {subdomain}.macaroonie.com">
          <div className="flex items-stretch gap-2">
            <TextInput value={slug}
              onChange={e => setSlug(e.target.value.toLowerCase())} className="flex-1" />
            <span className="inline-flex items-center px-3 text-sm text-muted-foreground bg-muted rounded-md">
              .macaroonie.com
            </span>
          </div>
          {slugCheck && (
            <p className={cn('text-xs mt-1', slugCheck.ok ? 'text-emerald-600' : 'text-destructive')}>
              {slugCheck.msg}
            </p>
          )}
        </FormRow>

        <FormRow label="Custom domain (optional)"
          hint="e.g. book.wingstop.co.uk. SSL provisioning happens outside this app.">
          <TextInput value={domain}
            onChange={e => setDomain(e.target.value.toLowerCase().trim())}
            placeholder="book.example.com" />
          {config.custom_domain && (
            <div className="flex items-center justify-between mt-2 text-xs">
              <span className={cn(
                'inline-flex items-center gap-1 font-medium',
                config.custom_domain_verified ? 'text-emerald-600' : 'text-amber-600',
              )}>
                {config.custom_domain_verified
                  ? <><Check className="w-3.5 h-3.5"/> DNS verified</>
                  : <><AlertTriangle className="w-3.5 h-3.5"/> DNS not verified</>}
              </span>
              <button
                type="button" onClick={() => verify.mutate()} disabled={verifying}
                className="text-xs text-primary hover:underline disabled:opacity-50"
              >{verifying ? 'Checking…' : 'Verify DNS'}</button>
            </div>
          )}
          {verifyResult && !verifyResult.verified && (
            <div className="mt-2 text-xs bg-amber-50 border border-amber-200 rounded p-2 text-amber-900">
              <p className="font-medium mb-1">Verification failed</p>
              <p>{verifyResult.hint || verifyResult.error}</p>
              {verifyResult.expected?.cname_suffix && (
                <p className="mt-1 font-mono">CNAME → *.{verifyResult.expected.cname_suffix}</p>
              )}
            </div>
          )}
          {customLiveUrl && (
            <a href={customLiveUrl} target="_blank" rel="noopener"
               className="text-xs text-primary hover:underline inline-flex items-center gap-1 mt-2">
              {customLiveUrl} <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </FormRow>
      </SectionCard>

      <SectionCard title="Publish"
        description="Hide or expose your site to the public.">
        <div className="flex items-start gap-4">
          <div className="flex-1">
            <p className="text-sm font-medium">Site is live</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              When off, visitors see a 404 page.
            </p>
          </div>
          <Toggle value={pubd} onChange={setPubd} label="Published" />
        </div>
      </SectionCard>

      <SaveBar dirty={dirty} saving={save.isPending}
        onReset={onReset} onSave={() => save.mutate()} />
    </div>
  )
}

// ── Template picker ─────────────────────────────────────────

const TEMPLATES = [
  {
    key: 'classic',
    label: 'Classic',
    description: 'Warm, traditional layout with hero banner, gallery grid and balanced sections. Great for established restaurants.',
    accent: '#630812',
  },
  {
    key: 'modern',
    label: 'Modern',
    description: 'Full-bleed hero, editorial typography, card-based gallery and a transparent floating header. More graphic and bold.',
    accent: '#1a1a1a',
  },
]

function TemplateSection({ config }) {
  const api = useApi()
  const qc  = useQueryClient()
  const [key, setKey] = useState(config.template_key || 'classic')
  const dirty = key !== (config.template_key || 'classic')

  const save = useMutation({
    mutationFn: () => api.patch('/website/config', { template_key: key }),
    onSuccess:  (cfg) => qc.setQueryData(['website-config'], cfg),
  })

  return (
    <div className="space-y-5">
      <SectionCard title="Template"
        description="Pick a layout. Your theme (colours, fonts, spacing) applies to whichever template you choose.">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {TEMPLATES.map(t => (
            <button key={t.key} type="button" onClick={() => setKey(t.key)}
              className={cn(
                'text-left border rounded-xl overflow-hidden transition-all',
                'hover:border-primary/60 hover:shadow-sm',
                key === t.key && 'border-primary ring-2 ring-primary/30',
              )}
            >
              <div className="h-28 relative" style={{ background: t.accent }}>
                {t.key === 'classic' ? (
                  <div className="absolute inset-0 p-4 flex flex-col justify-end">
                    <div className="bg-white/90 rounded px-2 py-1 text-[11px] font-semibold" style={{ color: t.accent, width: 'fit-content' }}>
                      Sample Restaurant
                    </div>
                  </div>
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-white">
                    <div className="text-lg font-bold tracking-tight">Sample</div>
                    <div className="text-[10px] opacity-70 uppercase tracking-wider">editorial style</div>
                  </div>
                )}
              </div>
              <div className="p-4 bg-background">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-sm font-semibold">{t.label}</h3>
                  {key === t.key && (
                    <Check className="w-4 h-4 text-primary" />
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{t.description}</p>
              </div>
            </button>
          ))}
        </div>
      </SectionCard>

      <SaveBar dirty={dirty} saving={save.isPending}
        onReset={() => setKey(config.template_key || 'classic')}
        onSave={() => save.mutate()} />
    </div>
  )
}

// ── Theme manager ───────────────────────────────────────────

const DEFAULT_THEME = {
  colors: {
    primary: '#630812', accent: '#f4a7b9', background: '#ffffff',
    surface: '#f9f6f1', text: '#1a1a1a', muted: '#666666', border: '#e5e7eb',
  },
  typography: {
    heading_font: 'Inter', body_font: 'Inter',
    base_size_px: 16, heading_scale: 1.25, heading_weight: 700,
    body_weight: 400, line_height: 1.5, letter_spacing: 'normal',
  },
  spacing: { container_max_px: 1100, section_y_px: 72, section_y_mobile_px: 48, gap_px: 24 },
  radii:   { sm_px: 4, md_px: 8, lg_px: 16 },
  logo:    { height_px: 36, show_name_beside: true },
  buttons: { radius_px: 4, padding_y_px: 12, padding_x_px: 28, weight: 600 },
  hero:    { overlay_opacity: 0.4, min_height_px: 520 },
}

const FONT_OPTIONS = [
  'Inter', 'Playfair Display', 'Poppins', 'Lora', 'Montserrat',
  'Roboto', 'Open Sans', 'Raleway', 'Merriweather', 'Work Sans',
  'Karla', 'DM Sans', 'DM Serif Display', 'Space Grotesk', 'Manrope',
  'Cormorant Garamond', 'Libre Baskerville', 'Nunito', 'Rubik',
]

function mergeTheme(existing) {
  // Deep-merge on the two-level-ish schema so missing keys come from defaults.
  const out = {}
  for (const k of Object.keys(DEFAULT_THEME)) {
    out[k] = { ...DEFAULT_THEME[k], ...(existing?.[k] || {}) }
  }
  return out
}

function ColourField({ label, value, onChange }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{label}</p>
      </div>
      <input type="color" value={value}
        onChange={e => onChange(e.target.value)}
        className="w-12 h-10 border rounded cursor-pointer bg-transparent shrink-0" />
      <TextInput value={value}
        onChange={e => onChange(e.target.value)}
        className="w-28 font-mono text-xs uppercase" />
    </div>
  )
}

function SliderField({ label, value, onChange, min, max, step = 1, unit = 'px', hint }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <p className="text-sm font-medium">{label}</p>
        <span className="text-xs text-muted-foreground font-mono">{value}{unit}</span>
      </div>
      <input type="range"
        min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full accent-primary" />
      {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
    </div>
  )
}

function ThemeSection({ config }) {
  const api = useApi()
  const qc  = useQueryClient()
  const [theme, setTheme] = useState(() => mergeTheme(config.theme))
  const baseline = useMemo(() => mergeTheme(config.theme), [config.theme])
  const dirty = JSON.stringify(theme) !== JSON.stringify(baseline)

  const save = useMutation({
    mutationFn: () => api.patch('/website/config', { theme }),
    onSuccess:  (cfg) => qc.setQueryData(['website-config'], cfg),
  })

  function setPath(section, key, value) {
    setTheme(t => ({ ...t, [section]: { ...t[section], [key]: value } }))
  }

  return (
    <div className="space-y-5">
      <SectionCard title="Colours"
        description="Apply instantly to both templates once saved.">
        <ColourField label="Primary (brand / CTA)"
          value={theme.colors.primary}
          onChange={v => setPath('colors', 'primary', v)} />
        <ColourField label="Accent (highlights)"
          value={theme.colors.accent}
          onChange={v => setPath('colors', 'accent', v)} />
        <ColourField label="Background"
          value={theme.colors.background}
          onChange={v => setPath('colors', 'background', v)} />
        <ColourField label="Surface (alt band bg)"
          value={theme.colors.surface}
          onChange={v => setPath('colors', 'surface', v)} />
        <ColourField label="Body text"
          value={theme.colors.text}
          onChange={v => setPath('colors', 'text', v)} />
        <ColourField label="Muted text"
          value={theme.colors.muted}
          onChange={v => setPath('colors', 'muted', v)} />
        <ColourField label="Borders & dividers"
          value={theme.colors.border}
          onChange={v => setPath('colors', 'border', v)} />
      </SectionCard>

      <SectionCard title="Typography"
        description="Common Google Fonts load automatically.">
        <FormRow label="Heading font">
          <select value={theme.typography.heading_font}
            onChange={e => setPath('typography', 'heading_font', e.target.value)}
            className="w-full border rounded-md px-3 py-2 text-sm min-h-[44px] touch-manipulation bg-background">
            {FONT_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </FormRow>
        <FormRow label="Body font">
          <select value={theme.typography.body_font}
            onChange={e => setPath('typography', 'body_font', e.target.value)}
            className="w-full border rounded-md px-3 py-2 text-sm min-h-[44px] touch-manipulation bg-background">
            {FONT_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </FormRow>
        <SliderField label="Base font size" unit="px"
          min={12} max={22} value={theme.typography.base_size_px}
          onChange={v => setPath('typography', 'base_size_px', v)} />
        <SliderField label="Heading scale" unit="×"
          min={1.0} max={1.8} step={0.05} value={theme.typography.heading_scale}
          onChange={v => setPath('typography', 'heading_scale', v)}
          hint="Multiplier applied per heading level (h1 = base × scale³)." />
        <SliderField label="Heading weight" unit=""
          min={300} max={900} step={100}
          value={theme.typography.heading_weight}
          onChange={v => setPath('typography', 'heading_weight', v)} />
        <SliderField label="Body weight" unit=""
          min={300} max={700} step={100}
          value={theme.typography.body_weight}
          onChange={v => setPath('typography', 'body_weight', v)} />
        <SliderField label="Line height" unit=""
          min={1.0} max={2.2} step={0.05}
          value={theme.typography.line_height}
          onChange={v => setPath('typography', 'line_height', v)} />
      </SectionCard>

      <SectionCard title="Spacing">
        <SliderField label="Container max width"
          min={640} max={1600} step={20}
          value={theme.spacing.container_max_px}
          onChange={v => setPath('spacing', 'container_max_px', v)} />
        <SliderField label="Section vertical padding (desktop)"
          min={16} max={160}
          value={theme.spacing.section_y_px}
          onChange={v => setPath('spacing', 'section_y_px', v)} />
        <SliderField label="Section vertical padding (mobile)"
          min={12} max={120}
          value={theme.spacing.section_y_mobile_px}
          onChange={v => setPath('spacing', 'section_y_mobile_px', v)} />
        <SliderField label="Grid gap"
          min={4} max={60}
          value={theme.spacing.gap_px}
          onChange={v => setPath('spacing', 'gap_px', v)} />
      </SectionCard>

      <SectionCard title="Corners">
        <SliderField label="Small radius" min={0} max={24}
          value={theme.radii.sm_px}
          onChange={v => setPath('radii', 'sm_px', v)} />
        <SliderField label="Medium radius" min={0} max={40}
          value={theme.radii.md_px}
          onChange={v => setPath('radii', 'md_px', v)} />
        <SliderField label="Large radius" min={0} max={60}
          value={theme.radii.lg_px}
          onChange={v => setPath('radii', 'lg_px', v)} />
      </SectionCard>

      <SectionCard title="Logo">
        <SliderField label="Logo height (header)" min={20} max={96}
          value={theme.logo.height_px}
          onChange={v => setPath('logo', 'height_px', v)} />
      </SectionCard>

      <SectionCard title="Buttons">
        <SliderField label="Button radius" min={0} max={40}
          value={theme.buttons.radius_px}
          onChange={v => setPath('buttons', 'radius_px', v)} />
        <SliderField label="Vertical padding" min={4} max={24}
          value={theme.buttons.padding_y_px}
          onChange={v => setPath('buttons', 'padding_y_px', v)} />
        <SliderField label="Horizontal padding" min={8} max={48}
          value={theme.buttons.padding_x_px}
          onChange={v => setPath('buttons', 'padding_x_px', v)} />
        <SliderField label="Font weight" min={300} max={900} step={100}
          value={theme.buttons.weight}
          onChange={v => setPath('buttons', 'weight', v)} />
      </SectionCard>

      <SectionCard title="Hero section">
        <SliderField label="Overlay opacity" unit=""
          min={0} max={0.9} step={0.05}
          value={theme.hero.overlay_opacity}
          onChange={v => setPath('hero', 'overlay_opacity', v)}
          hint="Darkens the hero image so text stays readable." />
        <SliderField label="Minimum height"
          min={240} max={900} step={10}
          value={theme.hero.min_height_px}
          onChange={v => setPath('hero', 'min_height_px', v)} />
      </SectionCard>

      <div className="flex items-center justify-between pt-2 border-t">
        <button type="button"
          onClick={() => setTheme(structuredClone(DEFAULT_THEME))}
          className="text-xs text-muted-foreground hover:text-foreground px-3 py-1.5"
        >Reset to defaults</button>
        <div className="flex items-center gap-2">
          {dirty && (
            <button type="button"
              onClick={() => setTheme(baseline)}
              className="text-xs text-muted-foreground hover:text-foreground px-3 py-1.5"
            >Undo changes</button>
          )}
          <button type="button"
            onClick={() => save.mutate()}
            disabled={!dirty || save.isPending}
            className="bg-primary text-primary-foreground text-sm font-medium rounded-md px-4 py-2 min-h-[40px] inline-flex items-center gap-2 disabled:opacity-50"
          >
            {save.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Save theme
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Generic "edit a batch of config fields" section ─────────
// All the simple text/image sections (branding, hero, about, find us,
// contact, SEO, analytics) follow the same pattern: pull a subset of
// fields from config, let the user edit, PATCH them back.

function useConfigFields(config, fields) {
  const qc = useQueryClient()
  const api = useApi()
  const initial = useMemo(() => {
    const out = {}
    for (const f of fields) out[f] = config[f] ?? ''
    return out
  }, [config, fields.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  const [values, setValues] = useState(initial)
  useEffect(() => setValues(initial), [initial])
  const dirty = JSON.stringify(values) !== JSON.stringify(initial)

  const save = useMutation({
    mutationFn: () => {
      const body = {}
      for (const [k, v] of Object.entries(values)) {
        body[k] = v === '' ? null : v
      }
      return api.patch('/website/config', body)
    },
    onSuccess: (cfg) => qc.setQueryData(['website-config'], cfg),
  })

  const set = (k) => (v) =>
    setValues(s => ({ ...s, [k]: typeof v === 'object' && v?.target ? v.target.value : v }))

  return { values, set, dirty, save, reset: () => setValues(initial) }
}

// ── Branding section ────────────────────────────────────────

function BrandingSection({ config }) {
  const { values, set, dirty, save, reset } = useConfigFields(config,
    ['site_name', 'tagline', 'logo_url', 'favicon_url'])

  return (
    <div className="space-y-5">
      <SectionCard title="Identity">
        <FormRow label="Site name" hint="Shown in the header and browser tab.">
          <TextInput value={values.site_name || ''} onChange={set('site_name')}
            placeholder="Wingstop Covent Garden" />
        </FormRow>
        <FormRow label="Tagline" hint="One-line description shown in the footer.">
          <TextInput value={values.tagline || ''} onChange={set('tagline')} />
        </FormRow>
      </SectionCard>

      <SectionCard title="Logo & favicon">
        <FormRow label="Logo" hint="Shown in the site header. PNG or SVG work best.">
          <ImageField url={values.logo_url} onChange={set('logo_url')} />
        </FormRow>
        <FormRow label="Favicon" hint="Small icon shown in the browser tab.">
          <ImageField url={values.favicon_url} onChange={set('favicon_url')} />
        </FormRow>
      </SectionCard>

      <SaveBar dirty={dirty} saving={save.isPending}
        onReset={reset} onSave={() => save.mutate()} />
    </div>
  )
}

// ── Hero section ────────────────────────────────────────────

function HeroSection({ config }) {
  const { values, set, dirty, save, reset } = useConfigFields(config,
    ['hero_image_url', 'hero_heading', 'hero_subheading', 'hero_cta_text', 'hero_cta_link'])

  return (
    <div className="space-y-5">
      <SectionCard title="Hero"
        description="The big first screen guests see.">
        <FormRow label="Hero image" hint="Shown full-bleed behind the heading.">
          <ImageField url={values.hero_image_url} onChange={set('hero_image_url')} />
        </FormRow>
        <FormRow label="Heading">
          <TextInput value={values.hero_heading || ''} onChange={set('hero_heading')}
            placeholder="Seasonal food, every day" />
        </FormRow>
        <FormRow label="Subheading">
          <TextArea value={values.hero_subheading || ''} onChange={set('hero_subheading')} />
        </FormRow>
        <FormRow label="Call-to-action label">
          <TextInput value={values.hero_cta_text || ''} onChange={set('hero_cta_text')}
            placeholder="Book a Table" />
        </FormRow>
        <FormRow label="Call-to-action link"
          hint="Defaults to the booking widget anchor #booking. Use a full URL to open elsewhere.">
          <TextInput value={values.hero_cta_link || ''} onChange={set('hero_cta_link')}
            placeholder="#booking" />
        </FormRow>
      </SectionCard>
      <SaveBar dirty={dirty} saving={save.isPending}
        onReset={reset} onSave={() => save.mutate()} />
    </div>
  )
}

// ── About section ───────────────────────────────────────────

function AboutSection({ config }) {
  const { values, set, dirty, save, reset } = useConfigFields(config,
    ['about_heading', 'about_text', 'about_image_url'])

  return (
    <div className="space-y-5">
      <SectionCard title="About">
        <FormRow label="Heading">
          <TextInput value={values.about_heading || ''} onChange={set('about_heading')} />
        </FormRow>
        <FormRow label="Text" hint="Line breaks are preserved.">
          <TextArea value={values.about_text || ''} onChange={set('about_text')}
            className="min-h-[180px]" />
        </FormRow>
        <FormRow label="Image">
          <ImageField url={values.about_image_url} onChange={set('about_image_url')} />
        </FormRow>
      </SectionCard>
      <SaveBar dirty={dirty} saving={save.isPending}
        onReset={reset} onSave={() => save.mutate()} />
    </div>
  )
}

// ── Find us section ─────────────────────────────────────────

function FindUsSection({ config }) {
  const { values, set, dirty, save, reset } = useConfigFields(config, [
    'address_line1', 'address_line2', 'city', 'postcode', 'country',
    'latitude', 'longitude', 'google_maps_embed_url',
    'show_find_us',
  ])

  return (
    <div className="space-y-5">
      <SectionCard title="Show section on site">
        <div className="flex items-start gap-4">
          <div className="flex-1">
            <p className="text-sm font-medium">Show "Find us"</p>
          </div>
          <Toggle value={!!values.show_find_us} onChange={set('show_find_us')} label="Show Find us" />
        </div>
      </SectionCard>

      <SectionCard title="Address">
        <FormRow label="Address line 1">
          <TextInput value={values.address_line1 || ''} onChange={set('address_line1')} />
        </FormRow>
        <FormRow label="Address line 2">
          <TextInput value={values.address_line2 || ''} onChange={set('address_line2')} />
        </FormRow>
        <div className="grid grid-cols-2 gap-3">
          <FormRow label="City">
            <TextInput value={values.city || ''} onChange={set('city')} />
          </FormRow>
          <FormRow label="Postcode">
            <TextInput value={values.postcode || ''} onChange={set('postcode')} />
          </FormRow>
        </div>
        <FormRow label="Country code" hint="Two-letter ISO code, e.g. GB.">
          <TextInput value={values.country || ''} onChange={set('country')}
            maxLength={2} className="uppercase w-24" />
        </FormRow>
      </SectionCard>

      <SectionCard title="Map">
        <div className="grid grid-cols-2 gap-3">
          <FormRow label="Latitude">
            <TextInput type="number" step="0.0000001"
              value={values.latitude ?? ''}
              onChange={(e) => set('latitude')(e.target.value === '' ? null : Number(e.target.value))} />
          </FormRow>
          <FormRow label="Longitude">
            <TextInput type="number" step="0.0000001"
              value={values.longitude ?? ''}
              onChange={(e) => set('longitude')(e.target.value === '' ? null : Number(e.target.value))} />
          </FormRow>
        </div>
        <FormRow label="Google Maps embed URL"
          hint="Optional. Paste the src attribute from a Google Maps 'Share > Embed' iframe.">
          <TextInput value={values.google_maps_embed_url || ''}
            onChange={set('google_maps_embed_url')}
            placeholder="https://www.google.com/maps/embed?pb=…" />
        </FormRow>
      </SectionCard>

      <SaveBar dirty={dirty} saving={save.isPending}
        onReset={reset} onSave={() => save.mutate()} />
    </div>
  )
}

// ── Contact section ─────────────────────────────────────────

const SOCIAL_PLATFORMS = [
  { key: 'instagram', label: 'Instagram', placeholder: 'https://instagram.com/yourhandle' },
  { key: 'facebook',  label: 'Facebook',  placeholder: 'https://facebook.com/yourpage' },
  { key: 'x',         label: 'X / Twitter', placeholder: 'https://x.com/yourhandle' },
  { key: 'tiktok',    label: 'TikTok',    placeholder: 'https://tiktok.com/@yourhandle' },
  { key: 'youtube',   label: 'YouTube',   placeholder: 'https://youtube.com/@yourchannel' },
]

function ContactSection({ config }) {
  const api = useApi()
  const qc  = useQueryClient()
  const initial = useMemo(() => ({
    phone:   config.phone ?? '',
    email:   config.email ?? '',
    socials: SOCIAL_PLATFORMS.reduce((acc, p) => {
      acc[p.key] = (config.social_links?.[p.key]) ?? ''
      return acc
    }, {}),
    show_contact: !!config.show_contact,
  }), [config])
  const [state, setState] = useState(initial)
  useEffect(() => setState(initial), [initial])
  const dirty = JSON.stringify(state) !== JSON.stringify(initial)

  const save = useMutation({
    mutationFn: () => {
      const social_links = {}
      for (const [k, v] of Object.entries(state.socials)) {
        if (v) social_links[k] = v
      }
      return api.patch('/website/config', {
        phone:        state.phone   || null,
        email:        state.email   || null,
        social_links,
        show_contact: state.show_contact,
      })
    },
    onSuccess: (cfg) => qc.setQueryData(['website-config'], cfg),
  })

  return (
    <div className="space-y-5">
      <SectionCard title="Show section on site">
        <div className="flex items-start gap-4">
          <div className="flex-1">
            <p className="text-sm font-medium">Show "Contact"</p>
          </div>
          <Toggle value={state.show_contact}
            onChange={v => setState(s => ({ ...s, show_contact: v }))}
            label="Show Contact" />
        </div>
      </SectionCard>

      <SectionCard title="Contact details">
        <FormRow label="Phone">
          <TextInput type="tel" inputMode="tel"
            value={state.phone}
            onChange={e => setState(s => ({ ...s, phone: e.target.value }))} />
        </FormRow>
        <FormRow label="Email">
          <TextInput type="email"
            value={state.email}
            onChange={e => setState(s => ({ ...s, email: e.target.value }))} />
        </FormRow>
      </SectionCard>

      <SectionCard title="Social links">
        {SOCIAL_PLATFORMS.map(p => (
          <FormRow key={p.key} label={p.label}>
            <TextInput type="url" placeholder={p.placeholder}
              value={state.socials[p.key] || ''}
              onChange={e => setState(s => ({
                ...s,
                socials: { ...s.socials, [p.key]: e.target.value },
              }))} />
          </FormRow>
        ))}
      </SectionCard>

      <SaveBar dirty={dirty} saving={save.isPending}
        onReset={() => setState(initial)} onSave={() => save.mutate()} />
    </div>
  )
}

// ── SEO section ─────────────────────────────────────────────

function SeoSection({ config }) {
  const { values, set, dirty, save, reset } = useConfigFields(config,
    ['meta_title', 'meta_description', 'og_image_url'])

  return (
    <div className="space-y-5">
      <SectionCard title="Search engine optimisation"
        description="What search engines and social previews show.">
        <FormRow label="Meta title"
          hint="Shown in browser tabs and search results. Max ~60 chars.">
          <TextInput value={values.meta_title || ''} onChange={set('meta_title')}
            maxLength={200} />
        </FormRow>
        <FormRow label="Meta description"
          hint="Shown beneath your page title in search results. Max ~160 chars.">
          <TextArea value={values.meta_description || ''} onChange={set('meta_description')}
            className="min-h-[80px]" maxLength={500} />
        </FormRow>
        <FormRow label="Social preview image"
          hint="Shown when your URL is shared on Facebook, Twitter, iMessage, etc. 1200×630 works well.">
          <ImageField url={values.og_image_url} onChange={set('og_image_url')} />
        </FormRow>
      </SectionCard>
      <SaveBar dirty={dirty} saving={save.isPending}
        onReset={reset} onSave={() => save.mutate()} />
    </div>
  )
}

// ── Analytics section ───────────────────────────────────────

function AnalyticsSection({ config }) {
  const { values, set, dirty, save, reset } = useConfigFields(config,
    ['ga4_measurement_id', 'fb_pixel_id'])

  return (
    <div className="space-y-5">
      <SectionCard title="Analytics"
        description="Tracking is injected into every page. Comply with your cookie / consent rules.">
        <FormRow label="Google Analytics 4 measurement ID"
          hint="Found in GA4 Admin → Data Streams. Starts with G-.">
          <TextInput value={values.ga4_measurement_id || ''} onChange={set('ga4_measurement_id')}
            placeholder="G-XXXXXXXXXX" />
        </FormRow>
        <FormRow label="Meta (Facebook) Pixel ID"
          hint="Found in Meta Events Manager. Numeric ID.">
          <TextInput value={values.fb_pixel_id || ''} onChange={set('fb_pixel_id')}
            placeholder="1234567890" />
        </FormRow>
      </SectionCard>
      <SaveBar dirty={dirty} saving={save.isPending}
        onReset={reset} onSave={() => save.mutate()} />
    </div>
  )
}

// ── Booking widget section ──────────────────────────────────

function BookingSection({ config }) {
  const api = useApi()
  const qc  = useQueryClient()
  const { data: venues = [] } = useQuery({
    queryKey: ['venues'],
    queryFn:  () => api.get('/venues'),
  })
  const initial = useMemo(() => ({
    widget_venue_id:     config.widget_venue_id ?? '',
    widget_theme:        config.widget_theme || 'light',
    show_booking_widget: !!config.show_booking_widget,
  }), [config])
  const [state, setState] = useState(initial)
  useEffect(() => setState(initial), [initial])
  const dirty = JSON.stringify(state) !== JSON.stringify(initial)

  const save = useMutation({
    mutationFn: () => api.patch('/website/config', {
      widget_venue_id:     state.widget_venue_id || null,
      widget_theme:        state.widget_theme,
      show_booking_widget: state.show_booking_widget,
    }),
    onSuccess: (cfg) => qc.setQueryData(['website-config'], cfg),
  })

  return (
    <div className="space-y-5">
      <SectionCard title="Booking widget"
        description="Embeds the Macaroonie booking widget into your site.">
        <div className="flex items-start gap-4">
          <div className="flex-1">
            <p className="text-sm font-medium">Show booking widget</p>
          </div>
          <Toggle value={state.show_booking_widget}
            onChange={v => setState(s => ({ ...s, show_booking_widget: v }))}
            label="Show booking widget" />
        </div>

        <FormRow label="Venue"
          hint="Which venue's schedule to book against.">
          <select
            value={state.widget_venue_id}
            onChange={e => setState(s => ({ ...s, widget_venue_id: e.target.value }))}
            className="w-full border rounded-md px-3 py-2 text-sm min-h-[44px] bg-background">
            <option value="">— Select a venue —</option>
            {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </FormRow>

        <FormRow label="Widget theme">
          <select
            value={state.widget_theme}
            onChange={e => setState(s => ({ ...s, widget_theme: e.target.value }))}
            className="w-full border rounded-md px-3 py-2 text-sm min-h-[44px] bg-background">
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </FormRow>
      </SectionCard>
      <SaveBar dirty={dirty} saving={save.isPending}
        onReset={() => setState(initial)} onSave={() => save.mutate()} />
    </div>
  )
}

// ── Page shell + section router ─────────────────────────────

export default function Website() {
  const api = useApi()
  const qc  = useQueryClient()
  const [active, setActive] = useState('setup')

  const { data: config, isLoading } = useQuery({
    queryKey: ['website-config'],
    queryFn:  () => api.get('/website/config'),
  })

  const hasConfig = !!config?.id

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!hasConfig) {
    return (
      <div className="h-full overflow-y-auto p-6">
        <div className="mb-6">
          <h1 className="text-xl font-semibold">Website</h1>
          <p className="text-sm text-muted-foreground">
            Build a public website for your restaurant — bookings, menus, contact and more.
          </p>
        </div>
        <OnboardingCard onCreated={() => setActive('setup')} />
      </div>
    )
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left rail */}
      <aside className="w-56 shrink-0 border-r overflow-y-auto py-4 px-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-3 mb-2">
          Sections
        </p>
        <nav className="space-y-0.5">
          {SECTIONS.map(s => {
            const Icon = s.icon
            return (
              <button
                key={s.key}
                onClick={() => setActive(s.key)}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors',
                  active === s.key
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {s.label}
              </button>
            )
          })}
        </nav>
      </aside>

      {/* Main panel */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto p-6">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold">
                {SECTIONS.find(s => s.key === active)?.label}
              </h1>
              {config.subdomain_slug && (
                <p className="text-sm text-muted-foreground mt-0.5">
                  {config.is_published ? (
                    <span className="inline-flex items-center gap-1 text-emerald-600">
                      <Eye className="w-3.5 h-3.5"/> Live
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <EyeOff className="w-3.5 h-3.5"/> Unpublished
                    </span>
                  )}
                  <span className="mx-2">·</span>
                  <a href={`https://${config.subdomain_slug}.macaroonie.com`}
                     target="_blank" rel="noopener"
                     className="text-primary hover:underline inline-flex items-center gap-1">
                    {config.subdomain_slug}.macaroonie.com
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </p>
              )}
            </div>
          </div>

          <ActiveSection active={active} config={config} />
        </div>
      </main>
    </div>
  )
}

function ActiveSection({ active, config }) {
  // Lazy-map — keeps Website.jsx manageable as sections are added.
  switch (active) {
    case 'setup':     return <SetupSection     config={config} />
    case 'template':  return <TemplateSection  config={config} />
    case 'theme':     return <ThemeSection     config={config} />
    case 'branding':  return <BrandingSection  config={config} />
    case 'hero':      return <HeroSection      config={config} />
    case 'about':     return <AboutSection     config={config} />
    case 'find':      return <FindUsSection    config={config} />
    case 'contact':   return <ContactSection   config={config} />
    case 'booking':   return <BookingSection   config={config} />
    case 'seo':       return <SeoSection       config={config} />
    case 'analytics': return <AnalyticsSection config={config} />
    default:
      return (
        <div className="text-sm text-muted-foreground border rounded-xl p-8 text-center bg-background">
          This section is being built. Check back shortly.
        </div>
      )
  }
}
