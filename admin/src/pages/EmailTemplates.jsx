// src/pages/EmailTemplates.jsx
//
// Admin page for customising booking email templates + venue email settings.
// Route: /email-templates

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Mail, Eye, Save, RotateCcw, Plus, Trash2, Loader2, Check,
  Settings, Send, Clock, Shield, ChevronDown,
  Bold, Italic, Underline as UnderlineIcon, List, ListOrdered,
  AlignLeft, AlignCenter, AlignRight, Link2, Image as ImageIcon,
  Type, Heading1, Heading2, Minus, Code,
} from 'lucide-react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import TextAlign from '@tiptap/extension-text-align'
import TextStyle from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'

const EMAIL_TYPES = [
  { key: 'confirmation', label: 'Confirmation',  desc: 'Sent when a booking is confirmed.' },
  { key: 'reminder',     label: 'Reminder',      desc: 'Sent before the booking (configurable hours).' },
  { key: 'modification', label: 'Modification',  desc: 'Sent when the guest modifies their booking.' },
  { key: 'cancellation', label: 'Cancellation',  desc: 'Sent when the booking is cancelled.' },
]

const PROVIDERS = [
  { value: 'sendgrid', label: 'SendGrid',       desc: 'Default. Uses SENDGRID_API_KEY from env if no per-venue key.' },
  { value: 'mailgun',  label: 'Mailgun',         desc: 'Requires API key + domain per venue.' },
  { value: 'ses',      label: 'AWS SES',         desc: 'Uses AWS credentials. Good for high volume.' },
  { value: 'smtp',     label: 'SMTP (custom)',   desc: 'Any SMTP server (Outlook, Gmail, self-hosted).' },
]

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
      <div className="p-5 space-y-4">{children}</div>
    </div>
  )
}

function FormRow({ label, hint, children }) {
  return (
    <div>
      <label className="text-sm font-medium block mb-1">{label}</label>
      {hint && <p className="text-xs text-muted-foreground mb-1.5">{hint}</p>}
      {children}
    </div>
  )
}

function TextInput({ className = '', ...props }) {
  return (
    <input className={cn(
      'w-full border rounded-md px-3 py-2 text-sm bg-background',
      'focus:outline-none focus:ring-1 focus:ring-primary min-h-[44px] touch-manipulation',
      className,
    )} {...props} />
  )
}

function Toggle({ value, onChange, label }) {
  return (
    <button type="button" onClick={() => onChange(!value)}
      className={cn(
        'relative inline-flex h-6 w-11 items-center rounded-full transition-colors touch-manipulation',
        value ? 'bg-primary' : 'bg-muted-foreground/30',
      )} aria-label={label}>
      <span className={cn(
        'inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform',
        value ? 'translate-x-6' : 'translate-x-1',
      )} />
    </button>
  )
}

// ── Template editor ─────────────────────────────────────────

function TemplateEditor({ venueId }) {
  const api = useApi()
  const qc  = useQueryClient()

  const { data: templates = [] } = useQuery({
    queryKey: ['email-templates', venueId],
    queryFn:  () => api.get(`/email-templates${venueId ? `?venue_id=${venueId}` : ''}`),
  })
  const { data: mergeFields = [] } = useQuery({
    queryKey: ['email-merge-fields'],
    queryFn:  () => api.get('/email-templates/merge-fields'),
  })
  const { data: defaults = {} } = useQuery({
    queryKey: ['email-defaults'],
    queryFn:  () => api.get('/email-templates/defaults'),
  })

  const [activeType, setActiveType] = useState('confirmation')
  const tpl = templates.find(t => t.type === activeType && (venueId ? t.venue_id === venueId : !t.venue_id))
  const fallback = defaults[activeType]

  const [subject,  setSubject]  = useState('')
  const [bodyHtml, setBodyHtml] = useState('')
  const [active,   setActive]   = useState(true)
  const [preview,  setPreview]  = useState(null)
  const [editMode, setEditMode] = useState('visual') // 'visual' | 'html'

  const initialContent = tpl?.body_html ?? fallback?.body_html ?? ''

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Underline,
      Link.configure({ openOnClick: false }),
      Image,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TextStyle,
      Color,
    ],
    content: initialContent,
    onUpdate: ({ editor: e }) => {
      setBodyHtml(e.getHTML())
    },
  })

  useEffect(() => {
    const html = tpl?.body_html ?? fallback?.body_html ?? ''
    setSubject(tpl?.subject   ?? fallback?.subject   ?? '')
    setBodyHtml(html)
    setActive(tpl?.is_active  ?? true)
    setPreview(null)
    if (editor && editor.getHTML() !== html) {
      editor.commands.setContent(html, false)
    }
  }, [activeType, tpl, fallback, editor])

  const save = useMutation({
    mutationFn: () => tpl?.id
      ? api.patch(`/email-templates/${tpl.id}`, { subject, body_html: bodyHtml, is_active: active })
      : api.post('/email-templates', {
          venue_id: venueId || null,
          type: activeType,
          subject,
          body_html: bodyHtml,
          is_active: active,
        }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['email-templates', venueId] }),
  })

  const del = useMutation({
    mutationFn: () => api.delete(`/email-templates/${tpl.id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['email-templates', venueId] }),
  })

  const previewMut = useMutation({
    mutationFn: () => api.post('/email-templates/preview', { subject, body_html: bodyHtml }),
    onSuccess: (data) => setPreview(data),
  })

  const dirty = (subject !== (tpl?.subject ?? fallback?.subject ?? ''))
             || (bodyHtml !== (tpl?.body_html ?? fallback?.body_html ?? ''))
             || (active !== (tpl?.is_active ?? true))

  function insertField(key) {
    if (editMode === 'visual' && editor) {
      editor.chain().focus().insertContent(`{{${key}}}`).run()
    } else {
      setBodyHtml(b => b + `{{${key}}}`)
    }
  }

  function resetToDefault() {
    if (!fallback) return
    setSubject(fallback.subject)
    setBodyHtml(fallback.body_html)
    if (editor) editor.commands.setContent(fallback.body_html, false)
  }

  function handleHtmlEdit(html) {
    setBodyHtml(html)
    if (editor) editor.commands.setContent(html, false)
  }

  return (
    <div className="space-y-5">
      {/* Type tabs */}
      <div className="flex gap-2 flex-wrap">
        {EMAIL_TYPES.map(t => {
          const hasCust = templates.some(tp => tp.type === t.key && (venueId ? tp.venue_id === venueId : !tp.venue_id))
          return (
            <button key={t.key} onClick={() => setActiveType(t.key)}
              className={cn(
                'px-4 py-2 rounded-lg text-sm font-medium border transition-colors touch-manipulation',
                activeType === t.key
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background text-foreground hover:border-primary/50',
              )}>
              {t.label}
              {hasCust && <span className="ml-1.5 text-[10px] opacity-70">(customised)</span>}
            </button>
          )
        })}
      </div>

      <p className="text-sm text-muted-foreground">
        {EMAIL_TYPES.find(t => t.key === activeType)?.desc}
        {!tpl && <span className="text-amber-600 ml-1">(using built-in default — edit to customise)</span>}
      </p>

      {/* Subject */}
      <SectionCard title="Subject line">
        <TextInput value={subject} onChange={e => setSubject(e.target.value)}
          placeholder="e.g. Your booking at {{venue_name}} is confirmed" />
      </SectionCard>

      {/* Merge fields */}
      <SectionCard title="Available fields"
        description="Click a field to insert it at the end of the email body.">
        <div className="flex flex-wrap gap-1.5">
          {mergeFields.map(f => (
            <button key={f.key} onClick={() => insertField(f.key)}
              className="text-xs px-2.5 py-1.5 rounded-full border bg-background hover:bg-primary/10 hover:border-primary/50 transition-colors touch-manipulation"
              title={`${f.label} — e.g. ${f.example}`}>
              {'{{' + f.key + '}}'}
            </button>
          ))}
        </div>
      </SectionCard>

      {/* Body editor */}
      <SectionCard title="Email body"
        description="Design your email visually or switch to HTML mode. The manage_link field is the most important — it's the guest's link to view/modify/cancel."
        action={
          <div className="flex gap-2">
            <div className="flex bg-muted rounded-md p-0.5 text-xs">
              <button onClick={() => setEditMode('visual')}
                className={cn('px-2.5 py-1 rounded transition-colors', editMode === 'visual' ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground')}>
                Visual
              </button>
              <button onClick={() => setEditMode('html')}
                className={cn('px-2.5 py-1 rounded transition-colors', editMode === 'html' ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground')}>
                HTML
              </button>
            </div>
            <button onClick={resetToDefault}
              className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 px-2 py-1">
              <RotateCcw className="w-3 h-3"/> Reset
            </button>
            <button onClick={() => previewMut.mutate()}
              disabled={previewMut.isPending}
              className="text-xs text-primary inline-flex items-center gap-1 px-2 py-1 hover:underline">
              {previewMut.isPending ? <Loader2 className="w-3 h-3 animate-spin"/> : <Eye className="w-3 h-3"/>}
              Preview
            </button>
          </div>
        }>

        {editMode === 'visual' ? (
          <div className="border rounded-lg overflow-hidden bg-background">
            {/* Toolbar */}
            {editor && (
              <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b bg-muted/40">
                <ToolbarBtn onClick={() => editor.chain().focus().toggleBold().run()}
                  active={editor.isActive('bold')} title="Bold">
                  <Bold className="w-4 h-4" />
                </ToolbarBtn>
                <ToolbarBtn onClick={() => editor.chain().focus().toggleItalic().run()}
                  active={editor.isActive('italic')} title="Italic">
                  <Italic className="w-4 h-4" />
                </ToolbarBtn>
                <ToolbarBtn onClick={() => editor.chain().focus().toggleUnderline().run()}
                  active={editor.isActive('underline')} title="Underline">
                  <UnderlineIcon className="w-4 h-4" />
                </ToolbarBtn>
                <ToolbarSep />
                <ToolbarBtn onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
                  active={editor.isActive('heading', { level: 1 })} title="Heading 1">
                  <Heading1 className="w-4 h-4" />
                </ToolbarBtn>
                <ToolbarBtn onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
                  active={editor.isActive('heading', { level: 2 })} title="Heading 2">
                  <Heading2 className="w-4 h-4" />
                </ToolbarBtn>
                <ToolbarBtn onClick={() => editor.chain().focus().setParagraph().run()}
                  active={editor.isActive('paragraph')} title="Paragraph">
                  <Type className="w-4 h-4" />
                </ToolbarBtn>
                <ToolbarSep />
                <ToolbarBtn onClick={() => editor.chain().focus().toggleBulletList().run()}
                  active={editor.isActive('bulletList')} title="Bullet list">
                  <List className="w-4 h-4" />
                </ToolbarBtn>
                <ToolbarBtn onClick={() => editor.chain().focus().toggleOrderedList().run()}
                  active={editor.isActive('orderedList')} title="Numbered list">
                  <ListOrdered className="w-4 h-4" />
                </ToolbarBtn>
                <ToolbarSep />
                <ToolbarBtn onClick={() => editor.chain().focus().setTextAlign('left').run()}
                  active={editor.isActive({ textAlign: 'left' })} title="Align left">
                  <AlignLeft className="w-4 h-4" />
                </ToolbarBtn>
                <ToolbarBtn onClick={() => editor.chain().focus().setTextAlign('center').run()}
                  active={editor.isActive({ textAlign: 'center' })} title="Align center">
                  <AlignCenter className="w-4 h-4" />
                </ToolbarBtn>
                <ToolbarBtn onClick={() => editor.chain().focus().setTextAlign('right').run()}
                  active={editor.isActive({ textAlign: 'right' })} title="Align right">
                  <AlignRight className="w-4 h-4" />
                </ToolbarBtn>
                <ToolbarSep />
                <ToolbarBtn onClick={() => {
                  const url = window.prompt('Enter URL:')
                  if (url) editor.chain().focus().setLink({ href: url }).run()
                }} active={editor.isActive('link')} title="Insert link">
                  <Link2 className="w-4 h-4" />
                </ToolbarBtn>
                <ToolbarBtn onClick={() => {
                  const url = window.prompt('Image URL:')
                  if (url) editor.chain().focus().setImage({ src: url }).run()
                }} title="Insert image">
                  <ImageIcon className="w-4 h-4" />
                </ToolbarBtn>
                <ToolbarBtn onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Divider">
                  <Minus className="w-4 h-4" />
                </ToolbarBtn>
                <ToolbarSep />
                <input type="color"
                  onChange={e => editor.chain().focus().setColor(e.target.value).run()}
                  className="w-7 h-7 border rounded cursor-pointer bg-transparent p-0.5"
                  title="Text colour" />
              </div>
            )}

            {/* Editor content */}
            <EditorContent editor={editor}
              className="prose prose-sm max-w-none px-4 py-3 min-h-[320px] focus:outline-none
                         [&_.ProseMirror]:min-h-[300px] [&_.ProseMirror]:outline-none
                         [&_.ProseMirror_p]:my-2 [&_.ProseMirror_h1]:text-2xl [&_.ProseMirror_h2]:text-xl
                         [&_.ProseMirror_img]:max-w-full [&_.ProseMirror_img]:rounded
                         [&_.ProseMirror_a]:text-primary [&_.ProseMirror_a]:underline" />
          </div>
        ) : (
          <textarea value={bodyHtml}
            onChange={e => handleHtmlEdit(e.target.value)}
            className="w-full border rounded-md px-3 py-2 text-xs font-mono bg-background min-h-[320px] resize-y focus:outline-none focus:ring-1 focus:ring-primary"
            spellCheck={false} />
        )}
      </SectionCard>

      {/* Preview */}
      {preview && (
        <SectionCard title="Preview"
          action={<button onClick={() => setPreview(null)} className="text-xs text-muted-foreground">Close</button>}>
          <div className="text-sm font-medium mb-2">Subject: {preview.subject}</div>
          <div className="border rounded-lg overflow-hidden bg-white">
            <iframe
              srcDoc={preview.html}
              title="Email preview"
              className="w-full border-0"
              style={{ minHeight: 480 }}
              sandbox="allow-same-origin"
            />
          </div>
        </SectionCard>
      )}

      {/* Active toggle + save */}
      <div className="flex items-center justify-between pt-2 border-t">
        <div className="flex items-center gap-3">
          <Toggle value={active} onChange={setActive} label="Active" />
          <span className="text-sm text-muted-foreground">
            {active ? 'Email will be sent' : 'Email disabled for this type'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {tpl?.id && (
            <button onClick={() => { if (confirm('Delete custom template? Will fall back to built-in default.')) del.mutate() }}
              className="text-xs text-destructive hover:underline px-2 py-1">
              Delete custom
            </button>
          )}
          <button onClick={() => save.mutate()} disabled={!dirty || save.isPending}
            className="bg-primary text-primary-foreground text-sm font-medium rounded-md px-4 py-2 min-h-[40px] inline-flex items-center gap-2 disabled:opacity-50">
            {save.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin"/>}
            {save.isPending ? 'Saving...' : 'Save template'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Toolbar primitives ──────────────────────────────────────

function ToolbarBtn({ onClick, active, title, children }) {
  return (
    <button type="button" onClick={onClick} title={title}
      className={cn(
        'p-1.5 rounded transition-colors touch-manipulation',
        active ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
      )}>
      {children}
    </button>
  )
}

function ToolbarSep() {
  return <div className="w-px h-5 bg-border mx-1" />
}

// ── Email settings ──────────────────────────────────────────

function EmailSettings({ venueId }) {
  const api = useApi()
  const qc  = useQueryClient()

  const { data: settings = {} } = useQuery({
    queryKey: ['email-settings', venueId],
    queryFn:  () => api.get(`/email-templates/settings/${venueId}`),
    enabled:  !!venueId,
  })
  const hasSettings = !!settings?.id

  const initial = useMemo(() => ({
    email_provider:        settings.email_provider || 'sendgrid',
    from_name:             settings.from_name || '',
    from_email:            settings.from_email || '',
    reply_to:              settings.reply_to || '',
    provider_api_key:      settings.provider_api_key || '',
    provider_domain:       settings.provider_domain || '',
    provider_region:       settings.provider_region || '',
    smtp_host:             settings.smtp_host || '',
    smtp_port:             settings.smtp_port || 587,
    smtp_user:             settings.smtp_user || '',
    smtp_pass:             settings.smtp_pass || '',
    smtp_secure:           settings.smtp_secure ?? true,
    reminder_enabled:      settings.reminder_enabled ?? true,
    reminder_hours_before: settings.reminder_hours_before ?? 24,
    allow_guest_modify:    settings.allow_guest_modify ?? true,
    allow_guest_cancel:    settings.allow_guest_cancel ?? true,
    cancel_cutoff_hours:   settings.cancel_cutoff_hours ?? 2,
  }), [settings])

  const [state, setState] = useState(initial)
  useEffect(() => setState(initial), [initial])
  const dirty = JSON.stringify(state) !== JSON.stringify(initial)

  const save = useMutation({
    mutationFn: () => {
      const body = { ...state }
      for (const k of ['from_name','from_email','reply_to','provider_api_key','provider_domain','provider_region','smtp_host','smtp_user','smtp_pass']) {
        if (!body[k]) body[k] = null
      }
      return hasSettings
        ? api.patch(`/email-templates/settings/${venueId}`, body)
        : api.post(`/email-templates/settings/${venueId}`, body)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['email-settings', venueId] }),
  })

  const set = (k) => (v) => setState(s => ({ ...s, [k]: typeof v === 'object' && v?.target ? v.target.value : v }))
  const provider = state.email_provider

  return (
    <div className="space-y-5">
      {/* Provider */}
      <SectionCard title="Email provider"
        description="Choose how emails are delivered for this venue. SendGrid uses the platform key by default.">
        <div className="grid grid-cols-2 gap-2">
          {PROVIDERS.map(p => (
            <button key={p.value} onClick={() => setState(s => ({ ...s, email_provider: p.value }))}
              className={cn(
                'text-left border rounded-lg p-3 transition-colors touch-manipulation',
                provider === p.value ? 'border-primary bg-primary/5' : 'hover:border-primary/40',
              )}>
              <div className="text-sm font-medium">{p.label}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{p.desc}</div>
            </button>
          ))}
        </div>
      </SectionCard>

      {/* Provider credentials */}
      {(provider === 'sendgrid' || provider === 'mailgun' || provider === 'ses') && (
        <SectionCard title="Provider credentials"
          description={provider === 'sendgrid' ? 'Optional — falls back to the platform SENDGRID_API_KEY.' : 'Required for this provider.'}>
          <FormRow label="API key">
            <TextInput type="password" value={state.provider_api_key} onChange={set('provider_api_key')}
              placeholder={provider === 'sendgrid' ? 'Leave blank to use platform key' : 'Required'} />
          </FormRow>
          {provider === 'mailgun' && (
            <FormRow label="Mailgun domain" hint="e.g. mg.yourdomain.com">
              <TextInput value={state.provider_domain} onChange={set('provider_domain')} />
            </FormRow>
          )}
          {provider === 'ses' && (
            <FormRow label="AWS region" hint="e.g. eu-west-1">
              <TextInput value={state.provider_region} onChange={set('provider_region')} placeholder="eu-west-1" />
            </FormRow>
          )}
        </SectionCard>
      )}

      {provider === 'smtp' && (
        <SectionCard title="SMTP settings">
          <div className="grid grid-cols-2 gap-3">
            <FormRow label="Host">
              <TextInput value={state.smtp_host} onChange={set('smtp_host')} placeholder="smtp.gmail.com" />
            </FormRow>
            <FormRow label="Port">
              <TextInput type="number" value={state.smtp_port} onChange={e => setState(s => ({ ...s, smtp_port: Number(e.target.value) }))} />
            </FormRow>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormRow label="Username">
              <TextInput value={state.smtp_user} onChange={set('smtp_user')} />
            </FormRow>
            <FormRow label="Password">
              <TextInput type="password" value={state.smtp_pass} onChange={set('smtp_pass')} />
            </FormRow>
          </div>
          <div className="flex items-center gap-3">
            <Toggle value={state.smtp_secure} onChange={set('smtp_secure')} label="Use TLS" />
            <span className="text-sm text-muted-foreground">Secure connection (TLS)</span>
          </div>
        </SectionCard>
      )}

      {/* From / reply-to */}
      <SectionCard title="Sender identity">
        <div className="grid grid-cols-2 gap-3">
          <FormRow label="From name" hint="e.g. Wingstop Covent Garden">
            <TextInput value={state.from_name} onChange={set('from_name')} />
          </FormRow>
          <FormRow label="From email" hint="Must be verified with your provider.">
            <TextInput type="email" value={state.from_email} onChange={set('from_email')} placeholder="noreply@yourdomain.com" />
          </FormRow>
        </div>
        <FormRow label="Reply-to" hint="Where guest replies go. Defaults to from email.">
          <TextInput type="email" value={state.reply_to} onChange={set('reply_to')} />
        </FormRow>
      </SectionCard>

      {/* Reminder */}
      <SectionCard title="Reminders">
        <div className="flex items-start gap-4">
          <div className="flex-1">
            <p className="text-sm font-medium">Send reminder emails</p>
            <p className="text-xs text-muted-foreground">Automatically send a reminder before each booking.</p>
          </div>
          <Toggle value={state.reminder_enabled} onChange={set('reminder_enabled')} label="Reminders" />
        </div>
        {state.reminder_enabled && (
          <FormRow label="Hours before booking" hint="1 = 1 hour before, 24 = 1 day before, 48 = 2 days before.">
            <div className="flex items-center gap-3">
              <input type="range" min={1} max={72} value={state.reminder_hours_before}
                onChange={e => setState(s => ({ ...s, reminder_hours_before: Number(e.target.value) }))}
                className="flex-1 accent-primary" />
              <span className="text-sm font-mono w-16 text-right">{state.reminder_hours_before}h</span>
            </div>
          </FormRow>
        )}
      </SectionCard>

      {/* Guest permissions */}
      <SectionCard title="Guest self-service"
        description="Controls what guests can do from the manage-booking link in their email.">
        <div className="flex items-start gap-4">
          <div className="flex-1">
            <p className="text-sm font-medium">Allow guests to modify</p>
            <p className="text-xs text-muted-foreground">Change date, time, or number of guests.</p>
          </div>
          <Toggle value={state.allow_guest_modify} onChange={set('allow_guest_modify')} label="Allow modify" />
        </div>
        <div className="flex items-start gap-4">
          <div className="flex-1">
            <p className="text-sm font-medium">Allow guests to cancel</p>
            <p className="text-xs text-muted-foreground">Cancel their booking from the email link.</p>
          </div>
          <Toggle value={state.allow_guest_cancel} onChange={set('allow_guest_cancel')} label="Allow cancel" />
        </div>
        {state.allow_guest_cancel && (
          <FormRow label="Cancel cutoff (hours before)"
            hint="Guests cannot cancel within this many hours of the booking start time.">
            <div className="flex items-center gap-3">
              <input type="range" min={0} max={48} value={state.cancel_cutoff_hours}
                onChange={e => setState(s => ({ ...s, cancel_cutoff_hours: Number(e.target.value) }))}
                className="flex-1 accent-primary" />
              <span className="text-sm font-mono w-16 text-right">{state.cancel_cutoff_hours}h</span>
            </div>
          </FormRow>
        )}
      </SectionCard>

      {/* Save */}
      {dirty && (
        <div className="flex items-center justify-end gap-2 pt-2 border-t">
          <button onClick={() => setState(initial)}
            className="text-xs text-muted-foreground hover:text-foreground px-3 py-1.5">Reset</button>
          <button onClick={() => save.mutate()} disabled={save.isPending}
            className="bg-primary text-primary-foreground text-sm font-medium rounded-md px-4 py-2 min-h-[40px] inline-flex items-center gap-2 disabled:opacity-50">
            {save.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin"/>}
            Save settings
          </button>
        </div>
      )}
    </div>
  )
}

// ── Email log ───────────────────────────────────────────────

function EmailLog() {
  const api = useApi()
  const { data: log = [], isLoading } = useQuery({
    queryKey: ['email-log'],
    queryFn:  () => api.get('/email-templates/log?limit=50'),
    refetchInterval: 30_000,
  })

  const STATUS_COLOURS = {
    sent:   'bg-emerald-100 text-emerald-700',
    queued: 'bg-blue-100 text-blue-700',
    failed: 'bg-red-100 text-red-700',
    bounced:'bg-amber-100 text-amber-700',
  }

  return (
    <SectionCard title="Recent emails" description="Last 50 deliveries across all venues.">
      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground"/></div>
      ) : log.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">No emails sent yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground border-b">
                <th className="pb-2 pr-3 font-medium">Time</th>
                <th className="pb-2 pr-3 font-medium">Type</th>
                <th className="pb-2 pr-3 font-medium">To</th>
                <th className="pb-2 pr-3 font-medium">Subject</th>
                <th className="pb-2 pr-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {log.map(e => (
                <tr key={e.id} className="border-b last:border-0">
                  <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">
                    {new Date(e.created_at).toLocaleString('en-GB', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}
                  </td>
                  <td className="py-2 pr-3 capitalize">{e.template_type}</td>
                  <td className="py-2 pr-3 truncate max-w-[160px]">{e.recipient}</td>
                  <td className="py-2 pr-3 truncate max-w-[200px] text-muted-foreground">{e.subject}</td>
                  <td className="py-2">
                    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', STATUS_COLOURS[e.status] || '')}>
                      {e.status}
                    </span>
                    {e.error && <span className="ml-1 text-destructive" title={e.error}>!</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  )
}

// ── Page shell ──────────────────────────────────────────────

const TABS = [
  { key: 'templates', label: 'Templates',  icon: Mail },
  { key: 'settings',  label: 'Settings',   icon: Settings },
  { key: 'log',       label: 'Sent emails', icon: Send },
]

export default function EmailTemplatesPage() {
  const api = useApi()
  const [tab, setTab] = useState('templates')
  const [venueId, setVenueId] = useState(null)

  const { data: venues = [] } = useQuery({
    queryKey: ['venues'],
    queryFn:  () => api.get('/venues'),
  })

  useEffect(() => {
    if (!venueId && venues.length) setVenueId(venues[0].id)
  }, [venues, venueId])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 h-14 border-b shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="font-semibold">Email templates</h1>
          <div className="flex gap-1 bg-muted rounded-lg p-0.5">
            {TABS.map(t => {
              const Icon = t.icon
              return (
                <button key={t.key} onClick={() => setTab(t.key)}
                  className={cn(
                    'px-3 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1.5 transition-colors',
                    tab === t.key ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground',
                  )}>
                  <Icon className="w-3.5 h-3.5"/>
                  {t.label}
                </button>
              )
            })}
          </div>
        </div>

        <select value={venueId ?? ''} onChange={e => setVenueId(e.target.value)}
          className="text-sm border rounded px-2 py-1 min-h-[36px] bg-background">
          {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto p-6">
          {tab === 'templates' && <TemplateEditor venueId={venueId} />}
          {tab === 'settings'  && <EmailSettings venueId={venueId} />}
          {tab === 'log'       && <EmailLog />}
        </div>
      </div>
    </div>
  )
}
