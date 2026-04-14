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
    case 'setup':     return <SetupSection config={config} />
    default:
      return (
        <div className="text-sm text-muted-foreground border rounded-xl p-8 text-center bg-background">
          This section is being built. Check back shortly.
        </div>
      )
  }
}
