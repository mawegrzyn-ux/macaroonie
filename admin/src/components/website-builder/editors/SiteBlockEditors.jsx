// editors/SiteBlockEditors.jsx
//
// Settings panels (block inspector) for the six "site shell" / themed
// blocks: header, footer, ticker, story_with_stamp, dish_list, reviews_band.
// Bundled together because each is small. They follow the standard
// editor contract: receive { data, onChange, blockType } where onChange(d)
// replaces the block's data object.

import { Plus, X } from 'lucide-react'
import { FormRow, ImageField } from '../shared'
import { FontPicker } from '../FontPicker'

// Same list used in Brand identity / Brand theme. Kept duplicated here to
// avoid a circular import with admin/src/pages/Website.jsx.
const FONT_OPTIONS = [
  'Inter', 'Fraunces', 'Caveat', 'Playfair Display', 'Poppins',
  'Lora', 'Montserrat', 'Roboto', 'Open Sans', 'Raleway',
  'Merriweather', 'Work Sans', 'Karla', 'DM Sans', 'DM Serif Display',
  'Space Grotesk', 'Manrope', 'Cormorant Garamond', 'Libre Baskerville',
  'Nunito', 'Rubik',
]

// ── Tiny field primitives (kept local to avoid touching shared.jsx) ──

function Input({ value, onChange, placeholder = '', className = '', type = 'text' }) {
  return (
    <input
      type={type}
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full text-sm border rounded-md px-2 py-1.5 min-h-[36px] ${className}`}
    />
  )
}

function Area({ value, onChange, placeholder = '', rows = 4, className = '' }) {
  return (
    <textarea
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className={`w-full text-sm border rounded-md px-2 py-1.5 ${className}`}
    />
  )
}

function Select({ value, onChange, children }) {
  return (
    <select value={value || ''} onChange={e => onChange(e.target.value)}
      className="w-full text-sm border rounded-md px-2 py-1.5 bg-background min-h-[36px]">
      {children}
    </select>
  )
}

function Toggle({ checked, onChange, label }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
      <input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)} />
      <span>{label || (checked ? 'On' : 'Off')}</span>
    </label>
  )
}

function SectionHead({ label, action }) {
  return (
    <div className="flex items-center justify-between mb-2">
      <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wide">{label}</p>
      {action}
    </div>
  )
}

function AddButton({ onClick, children }) {
  return (
    <button type="button" onClick={onClick}
      className="text-xs inline-flex items-center gap-1 bg-primary/10 text-primary rounded px-2 py-1 font-medium">
      <Plus className="w-3 h-3" /> {children}
    </button>
  )
}

function RemoveButton({ onClick }) {
  return (
    <button type="button" onClick={onClick}
      className="text-destructive hover:bg-destructive/10 p-1.5 rounded">
      <X className="w-4 h-4" />
    </button>
  )
}

// Tiny array helpers ────────────────────────────────────────
function arrPatch(arr, i, patch) { const n = arr.slice(); n[i] = { ...n[i], ...patch }; return n }
function arrRemove(arr, i)        { return arr.filter((_, j) => j !== i) }
function arrAppend(arr, item)     { return [...(arr || []), item] }

// ── Header editor ──────────────────────────────────────────

export function HeaderBlockEditor({ data, onChange }) {
  const set = (k) => (v) => onChange({ ...data, [k]: v })
  const links = data.links || []
  const cta = data.cta || {}
  return (
    <div className="space-y-5">
      <div>
        <SectionHead label="Brand display" />
        <div className="space-y-3">
          <FormRow label="Brand text" hint="Leave blank to use the site name from Brand identity.">
            <Input value={data.brand_text} onChange={set('brand_text')} placeholder="Auto: site name" />
          </FormRow>
          <FormRow label="Subtitle" hint="Small line under the brand text. Blank = use tagline.">
            <Input value={data.brand_subtitle} onChange={set('brand_subtitle')} placeholder="Auto: tagline" />
          </FormRow>
          <Toggle checked={data.show_logo !== false} onChange={set('show_logo')} label="Show logo" />
          <Toggle checked={data.sticky !== false}    onChange={set('sticky')}    label="Sticky on scroll" />
        </div>
      </div>

      <div>
        <SectionHead label="Nav links"
          action={<AddButton onClick={() => set('links')(arrAppend(links, { label: 'New link', url: '/' }))}>Add link</AddButton>} />
        {links.length === 0
          ? <p className="text-xs text-muted-foreground">No nav links. The brand block + CTA still show.</p>
          : <div className="space-y-2">
              {links.map((link, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input value={link.label} onChange={v => set('links')(arrPatch(links, i, { label: v }))} placeholder="Label" />
                  <Input value={link.url}   onChange={v => set('links')(arrPatch(links, i, { url: v }))}   placeholder="/path" />
                  <RemoveButton onClick={() => set('links')(arrRemove(links, i))} />
                </div>
              ))}
            </div>}
      </div>

      <div>
        <SectionHead label="Booking CTA" />
        <div className="space-y-3">
          <Toggle checked={cta.show !== false} onChange={v => set('cta')({ ...cta, show: v })} label="Show CTA button" />
          <FormRow label="Button text">
            <Input value={cta.text} onChange={v => set('cta')({ ...cta, text: v })} placeholder="Book a Table" />
          </FormRow>
          <FormRow label="Button URL">
            <Input value={cta.url} onChange={v => set('cta')({ ...cta, url: v })} placeholder="/locations" />
          </FormRow>
        </div>
      </div>
    </div>
  )
}

// ── Footer editor ──────────────────────────────────────────

export function FooterBlockEditor({ data, onChange }) {
  const set = (k) => (v) => onChange({ ...data, [k]: v })
  const cols = data.columns || []
  return (
    <div className="space-y-5">
      <div>
        <SectionHead label="What to show" />
        <div className="space-y-2">
          <Toggle checked={data.show_brand_block !== false} onChange={set('show_brand_block')} label="Brand block (logo + tagline + socials)" />
          <Toggle checked={data.show_legal_links !== false} onChange={set('show_legal_links')} label="Auto legal links (Terms / Privacy / Cookies)" />
          <Toggle checked={data.show_powered_by !== false} onChange={set('show_powered_by')} label="Powered-by line" />
        </div>
      </div>

      <div>
        <SectionHead label="Custom columns"
          action={cols.length < 6 && <AddButton onClick={() => set('columns')(arrAppend(cols, { title: '', items: [{ label: '', url: '' }] }))}>Add column</AddButton>} />
        {cols.length === 0
          ? <p className="text-xs text-muted-foreground">No custom columns. The brand block + locations list show automatically.</p>
          : <div className="space-y-3">
              {cols.map((col, ci) => (
                <div key={ci} className="border rounded p-2 space-y-2 bg-muted/30">
                  <div className="flex items-center gap-2">
                    <Input value={col.title} onChange={v => set('columns')(arrPatch(cols, ci, { title: v }))} placeholder="Column title" className="font-medium" />
                    <button type="button" onClick={() => set('columns')(arrRemove(cols, ci))}
                      className="text-xs text-destructive hover:underline shrink-0">Remove</button>
                  </div>
                  {(col.items || []).map((it, ii) => (
                    <div key={ii} className="flex items-center gap-2 pl-3">
                      <Input value={it.label} onChange={v => set('columns')(arrPatch(cols, ci, { items: arrPatch(col.items, ii, { label: v }) }))} placeholder="Label" />
                      <Input value={it.url}   onChange={v => set('columns')(arrPatch(cols, ci, { items: arrPatch(col.items, ii, { url:   v }) }))} placeholder="URL" />
                      <RemoveButton onClick={() => set('columns')(arrPatch(cols, ci, { items: arrRemove(col.items, ii) }))} />
                    </div>
                  ))}
                  <button type="button"
                    onClick={() => set('columns')(arrPatch(cols, ci, { items: arrAppend(col.items, { label: '', url: '' }) }))}
                    className="text-xs text-primary hover:underline">+ Add link</button>
                </div>
              ))}
            </div>}
      </div>

      <div>
        <SectionHead label="Copyright" />
        <FormRow label="Copyright text" hint="Leave blank for © {year} {brand}.">
          <Input value={data.copyright_text} onChange={set('copyright_text')} />
        </FormRow>
      </div>
    </div>
  )
}

// ── Ticker editor ──────────────────────────────────────────

export function TickerBlockEditor({ data, onChange }) {
  const set = (k) => (v) => onChange({ ...data, [k]: v })
  const items = data.items || []
  return (
    <div className="space-y-5">
      <div>
        <SectionHead label="Ticker items"
          action={<AddButton onClick={() => set('items')(arrAppend(items, 'New item'))}>Add</AddButton>} />
        {items.length === 0
          ? <p className="text-xs text-muted-foreground">No items.</p>
          : <div className="space-y-2">
              {items.map((item, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input value={item} onChange={v => {
                    const n = items.slice(); n[i] = v; set('items')(n)
                  }} />
                  <RemoveButton onClick={() => set('items')(arrRemove(items, i))} />
                </div>
              ))}
            </div>}
      </div>
      <div>
        <SectionHead label="Style" />
        <div className="space-y-3">
          <FormRow label="Background">
            <Select value={data.bg_style || 'primary'} onChange={set('bg_style')}>
              <option value="primary">Primary (brand colour)</option>
              <option value="accent">Accent</option>
              <option value="dark">Dark</option>
            </Select>
          </FormRow>
          <FormRow label="Font" hint="Pick any font — the live preview shows each in its own typeface.">
            <FontPicker
              fonts={FONT_OPTIONS}
              value={data.font_family || (data.font_style === 'sans' ? 'Inter' : 'Caveat')}
              onChange={set('font_family')} />
          </FormRow>
          <FormRow label={`Font size — ${data.font_size || 28}px`}>
            <input type="range" min={14} max={64} step={1}
              value={data.font_size || 28}
              onChange={e => set('font_size')(Number(e.target.value))}
              className="w-full" />
          </FormRow>
          <FormRow label="Scroll speed">
            <Select value={data.speed || 'medium'} onChange={set('speed')}>
              <option value="slow">Slow</option>
              <option value="medium">Medium</option>
              <option value="fast">Fast</option>
            </Select>
          </FormRow>
        </div>
      </div>
    </div>
  )
}

// ── Story with stamp editor ────────────────────────────────

export function StoryWithStampEditor({ data, onChange, blockType }) {
  const set = (k) => (v) => onChange({ ...data, [k]: v })
  return (
    <div className="space-y-5">
      <div>
        <SectionHead label="Story" />
        <div className="space-y-3">
          <FormRow label="Heading">
            <Input value={data.heading} onChange={set('heading')} />
          </FormRow>
          <FormRow label="Body (HTML allowed)">
            <Area value={data.body_html} onChange={set('body_html')} rows={8} className="font-mono text-xs" />
          </FormRow>
        </div>
      </div>
      <div>
        <SectionHead label="Years stamp" />
        <div className="space-y-3">
          <Toggle checked={data.stamp_show !== false} onChange={set('stamp_show')} label="Show the dashed stamp pill" />
          <FormRow label="Number" hint="The big number in the dashed pill (e.g. 10).">
            <Input value={data.stamp_number} onChange={set('stamp_number')} placeholder="10" />
          </FormRow>
          <FormRow label="Label after the number">
            <Input value={data.stamp_label} onChange={set('stamp_label')} placeholder="years in Ware" />
          </FormRow>
        </div>
      </div>
      <div>
        <SectionHead label="Image" />
        <div className="space-y-3">
          <FormRow label="Image">
            <ImageField url={data.image_url} onChange={v => set('image_url')(v || null)} scope={`website:${blockType || 'story'}`} />
          </FormRow>
          <FormRow label="Image side">
            <Select value={data.image_side || 'right'} onChange={set('image_side')}>
              <option value="none">No image</option>
              <option value="left">Left</option>
              <option value="right">Right</option>
            </Select>
          </FormRow>
        </div>
      </div>
    </div>
  )
}

// ── Dish list editor ───────────────────────────────────────

export function DishListEditor({ data, onChange }) {
  const set = (k) => (v) => onChange({ ...data, [k]: v })
  const cols = data.columns || []
  return (
    <div className="space-y-5">
      <div>
        <SectionHead label="Heading" />
        <div className="space-y-3">
          <FormRow label="Section heading">
            <Input value={data.heading} onChange={set('heading')} />
          </FormRow>
          <FormRow label="Subheading (optional)">
            <Input value={data.subheading} onChange={set('subheading')} />
          </FormRow>
        </div>
      </div>
      <div>
        <SectionHead label="Columns"
          action={cols.length < 3 && <AddButton onClick={() => set('columns')(arrAppend(cols, { title: 'New column', dishes: [] }))}>Add column</AddButton>} />
        <div className="space-y-3">
          {cols.map((col, ci) => (
            <div key={ci} className="border rounded p-2 space-y-2 bg-muted/30">
              <div className="flex items-center gap-2">
                <Input value={col.title} onChange={v => set('columns')(arrPatch(cols, ci, { title: v }))} placeholder="Column title" className="font-medium" />
                <button type="button" onClick={() => set('columns')(arrRemove(cols, ci))}
                  className="text-xs text-destructive hover:underline shrink-0">Remove column</button>
              </div>
              {(col.dishes || []).map((dish, di) => (
                <div key={di} className="border-l-2 border-muted pl-3 space-y-1">
                  <div className="flex items-center gap-2">
                    <Input value={dish.name} onChange={v => set('columns')(arrPatch(cols, ci, { dishes: arrPatch(col.dishes, di, { name: v }) }))} placeholder="Dish name" />
                    <Input value={dish.price} onChange={v => set('columns')(arrPatch(cols, ci, { dishes: arrPatch(col.dishes, di, { price: v }) }))} placeholder="£0.00" className="w-24" />
                    <RemoveButton onClick={() => set('columns')(arrPatch(cols, ci, { dishes: arrRemove(col.dishes, di) }))} />
                  </div>
                  <div className="flex items-center gap-2">
                    <Input value={dish.thai} onChange={v => set('columns')(arrPatch(cols, ci, { dishes: arrPatch(col.dishes, di, { thai: v }) }))} placeholder="Native script (optional)" />
                    <Select value={dish.heat || ''} onChange={v => set('columns')(arrPatch(cols, ci, { dishes: arrPatch(col.dishes, di, { heat: v }) }))}>
                      <option value="">No heat</option>
                      <option value="●○○">Mild ●○○</option>
                      <option value="●●○">Medium ●●○</option>
                      <option value="●●●">Hot ●●●</option>
                    </Select>
                  </div>
                  <Area value={dish.desc} onChange={v => set('columns')(arrPatch(cols, ci, { dishes: arrPatch(col.dishes, di, { desc: v }) }))} placeholder="Short description" rows={2} />
                </div>
              ))}
              <button type="button"
                onClick={() => set('columns')(arrPatch(cols, ci, { dishes: arrAppend(col.dishes, { name: '', thai: '', heat: '', price: '', desc: '' }) }))}
                className="text-xs text-primary hover:underline">+ Add dish</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Order options editor ───────────────────────────────────

export function OrderOptionsEditor({ data, onChange }) {
  const set = (k) => (v) => onChange({ ...data, [k]: v })
  const cards = data.cards || []

  function patchCard(i, patch) {
    set('cards')(arrPatch(cards, i, patch))
  }

  return (
    <div className="space-y-5">
      <div>
        <SectionHead label="Section copy" />
        <div className="space-y-3">
          <FormRow label="Eyebrow text" hint="Small uppercase line above the heading. Blank to hide.">
            <Input value={data.eyebrow_text} onChange={set('eyebrow_text')}
              placeholder="Takeaway & Delivery" />
          </FormRow>
          <FormRow label="Heading">
            <Input value={data.heading} onChange={set('heading')}
              placeholder="Eating in tonight?" />
          </FormRow>
          <FormRow label="Script accent line" hint="Renders in the script font under the heading. Blank to hide.">
            <Input value={data.accent_text} onChange={set('accent_text')}
              placeholder="We have got you." />
          </FormRow>
          <FormRow label="Body text">
            <Area value={data.body_text} onChange={set('body_text')} rows={3} />
          </FormRow>
          <FormRow label="Background">
            <Select value={data.bg_style || 'dark'} onChange={set('bg_style')}>
              <option value="dark">Dark</option>
              <option value="primary">Primary (brand colour)</option>
              <option value="accent">Accent</option>
              <option value="surface">Surface (light)</option>
            </Select>
          </FormRow>
        </div>
      </div>

      <div>
        <SectionHead label="Cards"
          action={
            cards.length < 6 && (
              <AddButton onClick={() => set('cards')(arrAppend(cards, {
                tag: 'Delivery', badge: '', title: 'New option',
                description: '', cta_text: 'Open', cta_url: 'https://',
              }))}>Add card</AddButton>
            )
          } />
        <div className="space-y-3">
          {cards.map((card, i) => (
            <div key={i} className="border rounded p-2 space-y-2 bg-muted/30">
              <div className="flex items-center gap-2">
                <Input value={card.tag} onChange={v => patchCard(i, { tag: v })}
                  placeholder="Tag (e.g. Direct Collection)" />
                <button type="button" onClick={() => set('cards')(arrRemove(cards, i))}
                  className="text-xs text-destructive hover:underline shrink-0">Remove</button>
              </div>
              <Input value={card.badge} onChange={v => patchCard(i, { badge: v })}
                placeholder="Optional highlighted badge (e.g. 15% OFF)" />
              <Input value={card.title} onChange={v => patchCard(i, { title: v })}
                placeholder="Title (e.g. Order with us)" className="font-medium" />
              <Area value={card.description} onChange={v => patchCard(i, { description: v })}
                placeholder="Short description" rows={2} />
              <div className="flex items-center gap-2">
                <Input value={card.cta_text} onChange={v => patchCard(i, { cta_text: v })}
                  placeholder="Button text" />
                <Input value={card.cta_url} onChange={v => patchCard(i, { cta_url: v })}
                  placeholder="https://… or /path" className="font-mono text-xs" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Reviews band editor ────────────────────────────────────

export function ReviewsBandEditor({ data, onChange }) {
  const set = (k) => (v) => onChange({ ...data, [k]: v })
  const items = data.items || []
  return (
    <div className="space-y-5">
      <div>
        <SectionHead label="Style" />
        <div className="space-y-3">
          <FormRow label="Heading (optional)">
            <Input value={data.heading} onChange={set('heading')} />
          </FormRow>
          <FormRow label="Background">
            <Select value={data.bg_style || 'primary'} onChange={set('bg_style')}>
              <option value="primary">Primary (brand colour)</option>
              <option value="accent">Accent</option>
              <option value="dark">Dark</option>
              <option value="surface">Surface (light)</option>
            </Select>
          </FormRow>
        </div>
      </div>
      <div>
        <SectionHead label="Reviews"
          action={<AddButton onClick={() => set('items')(arrAppend(items, { stars: 5, text: '', attr: '' }))}>Add review</AddButton>} />
        <div className="space-y-3">
          {items.map((r, i) => (
            <div key={i} className="border rounded p-2 space-y-2 bg-muted/30">
              <div className="flex items-center gap-2">
                <Select value={String(r.stars || 5)} onChange={v => set('items')(arrPatch(items, i, { stars: Number(v) }))}>
                  {[5, 4, 3, 2, 1].map(s => <option key={s} value={s}>{'★'.repeat(s)}</option>)}
                </Select>
                <button type="button" onClick={() => set('items')(arrRemove(items, i))}
                  className="text-xs text-destructive hover:underline ml-auto">Remove</button>
              </div>
              <Area value={r.text} onChange={v => set('items')(arrPatch(items, i, { text: v }))} placeholder="What they said" rows={3} />
              <Input value={r.attr} onChange={v => set('items')(arrPatch(items, i, { attr: v }))} placeholder="e.g. Mark, regular since 2018" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
