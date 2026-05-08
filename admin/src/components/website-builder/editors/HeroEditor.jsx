// Editor for the hero block.
//
// The hero is a composable single-block layout: optional pre-header
// "eyebrow", optional dotted divider, optional centered logo flanked by
// decorative flourishes, headline (rich-html for inline script accents),
// subheading, and a list of CTAs. Background can be an image, gradient,
// transparent, or surface.

import { Plus, X } from 'lucide-react'
import { ImageField, FormRow } from '../shared'

function Input({ value, onChange, placeholder = '', className = '' }) {
  return (
    <input value={value || ''} onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full text-sm border rounded-md px-2 py-1.5 min-h-[36px] ${className}`} />
  )
}
function Area({ value, onChange, placeholder = '', rows = 3 }) {
  return (
    <textarea value={value || ''} onChange={e => onChange(e.target.value)}
      placeholder={placeholder} rows={rows}
      className="w-full text-sm border rounded-md px-2 py-1.5" />
  )
}
function Toggle({ checked, onChange, label }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
      <input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

export function HeroEditor({ data, onChange, scope }) {
  const set = (k) => (v) => onChange({ ...data, [k]: v })
  const ctas = Array.isArray(data.ctas) ? data.ctas : []

  function patchCta(i, patch) {
    const next = ctas.slice(); next[i] = { ...next[i], ...patch }
    set('ctas')(next)
  }
  function addCta() {
    set('ctas')([...ctas, { text: 'New button', link: '/', style: 'secondary' }])
  }
  function removeCta(i) {
    set('ctas')(ctas.filter((_, j) => j !== i))
  }

  return (
    <div className="space-y-5">
      {/* ── Background ────────────────────── */}
      <div>
        <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wide mb-2">Background</p>
        <div className="space-y-3">
          <FormRow label="Background style">
            <select value={data.bg_style || 'image'}
              onChange={e => set('bg_style')(e.target.value)}
              className="w-full text-sm border rounded-md px-2 py-1.5 bg-background min-h-[36px]">
              <option value="image">Image (with overlay)</option>
              <option value="gradient">Brand gradient</option>
              <option value="transparent">Transparent (let the page show through)</option>
              <option value="surface">Soft surface tint</option>
            </select>
          </FormRow>
          {data.bg_style === 'image' && (
            <>
              <FormRow label="Background image">
                <ImageField url={data.image_url}
                  onChange={set('image_url')}
                  scope={scope || 'website:hero'} />
              </FormRow>
              <FormRow label="Image overlay (darkness)">
                <input type="range" min={0} max={1} step={0.05}
                  value={data.overlay_opacity ?? 0.4}
                  onChange={e => set('overlay_opacity')(Number(e.target.value))}
                  className="w-full" />
              </FormRow>
            </>
          )}
        </div>
      </div>

      {/* ── Eyebrow + dotted divider ──────── */}
      <div>
        <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wide mb-2">Eyebrow</p>
        <div className="space-y-3">
          <FormRow label="Pre-header text" hint="Small uppercase line above the logo. Leave blank to hide.">
            <Input value={data.eyebrow_text} onChange={set('eyebrow_text')}
              placeholder="— Your Local Thai —" />
          </FormRow>
          <Toggle checked={!!data.show_dotted_divider}
            onChange={set('show_dotted_divider')}
            label="Show dotted-line ornament under the eyebrow" />
        </div>
      </div>

      {/* ── Logo + flourishes ─────────────── */}
      <div>
        <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wide mb-2">Centered logo</p>
        <div className="space-y-3">
          <FormRow label="Logo image" hint="Optional centered hero logo (overrides the brand logo).">
            <ImageField url={data.logo_url} onChange={set('logo_url')}
              scope="website:hero-logo" />
          </FormRow>
          {data.logo_url && (
            <FormRow label="Logo size">
              <select value={data.logo_size || 'medium'}
                onChange={e => set('logo_size')(e.target.value)}
                className="w-full text-sm border rounded-md px-2 py-1.5 bg-background min-h-[36px]">
                <option value="small">Small (180px)</option>
                <option value="medium">Medium (240px)</option>
                <option value="large">Large (320px)</option>
              </select>
            </FormRow>
          )}
          <FormRow label="Decoration on the LEFT of the logo"
            hint="Small image / icon flanking the logo. Leave blank to hide.">
            <ImageField url={data.flourish_left_url} onChange={set('flourish_left_url')}
              scope="website:hero-flourish" />
          </FormRow>
          <FormRow label="Decoration on the RIGHT of the logo">
            <ImageField url={data.flourish_right_url} onChange={set('flourish_right_url')}
              scope="website:hero-flourish" />
          </FormRow>
        </div>
      </div>

      {/* ── Heading + subheading ──────────── */}
      <div>
        <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wide mb-2">Headline</p>
        <div className="space-y-3">
          <FormRow label="Heading (HTML)"
            hint="Use <em>your phrase</em> to render words in the script accent font. Use <br /> for line breaks.">
            <Area value={data.heading_html || data.heading || ''}
              onChange={v => onChange({ ...data, heading_html: v, heading: v.replace(/<[^>]+>/g, '') })}
              placeholder="A small Thai cafe<br />with <em>very loyal</em> regulars."
              rows={4} />
          </FormRow>
          <FormRow label="Subheading">
            <Area value={data.subheading || ''} onChange={set('subheading')}
              placeholder="One or two lines under the heading." rows={3} />
          </FormRow>
        </div>
      </div>

      {/* ── CTAs ──────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wide">Buttons</p>
          <button type="button" onClick={addCta}
            className="text-xs inline-flex items-center gap-1 bg-primary/10 text-primary rounded px-2 py-1 font-medium">
            <Plus className="w-3 h-3" /> Add button
          </button>
        </div>
        <div className="space-y-2">
          {ctas.map((cta, i) => (
            <div key={i} className="border rounded p-2 space-y-2 bg-muted/30">
              <div className="flex items-center gap-2">
                <Input value={cta.text} onChange={v => patchCta(i, { text: v })}
                  placeholder="Button text" />
                <button type="button" onClick={() => removeCta(i)}
                  className="text-destructive hover:bg-destructive/10 p-1.5 rounded">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <Input value={cta.link} onChange={v => patchCta(i, { link: v })}
                  placeholder="/path or #anchor" className="font-mono" />
                <select value={cta.style || 'primary'}
                  onChange={e => patchCta(i, { style: e.target.value })}
                  className="text-sm border rounded-md px-2 py-1.5 bg-background min-h-[36px] w-32">
                  <option value="primary">Primary</option>
                  <option value="secondary">Secondary</option>
                </select>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Layout ────────────────────────── */}
      <div>
        <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wide mb-2">Layout</p>
        <div className="grid grid-cols-2 gap-2">
          <FormRow label="Height">
            <select value={data.height || 'medium'} onChange={e => set('height')(e.target.value)}
              className="w-full text-sm border rounded-md px-2 py-1.5 bg-background min-h-[36px]">
              <option value="small">Small</option>
              <option value="medium">Medium</option>
              <option value="large">Large</option>
              <option value="full">Full screen</option>
            </select>
          </FormRow>
          <FormRow label="Align">
            <select value={data.align || 'center'} onChange={e => set('align')(e.target.value)}
              className="w-full text-sm border rounded-md px-2 py-1.5 bg-background min-h-[36px]">
              <option value="center">Center</option>
              <option value="left">Left</option>
            </select>
          </FormRow>
        </div>
      </div>
    </div>
  )
}
