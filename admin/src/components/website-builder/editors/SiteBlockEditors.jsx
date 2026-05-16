// editors/SiteBlockEditors.jsx
//
// Settings panels (block inspector) for the six "site shell" / themed
// blocks: header, footer, scrolling_text, story_with_stamp, dish_list, reviews_band,
// order_options, menu_inline, booking_widget.
// Bundled together because each is small. They follow the standard
// editor contract: receive { data, onChange, blockType } where onChange(d)
// replaces the block's data object.

import { Plus, X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useApi } from '@/lib/api'
import { FormRow, ImageField } from '../shared'
import { FontPicker } from '../FontPicker'
import { ThemeColourPicker, THEME_ROLES } from '../ThemeColourPicker'

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

function roleLabel(roleKey) {
  if (!roleKey) return null
  const r = THEME_ROLES.find(x => x.key === roleKey)
  return r ? r.label : roleKey
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

      <div>
        <SectionHead label="Mobile" />
        <p className="text-xs text-muted-foreground mb-2">
          Below the breakpoint width, hide elements to keep the header compact.
        </p>
        <div className="space-y-2">
          <Toggle checked={data.mobile_show_logo     !== false} onChange={set('mobile_show_logo')}     label="Show logo on mobile" />
          <Toggle checked={data.mobile_show_brand    !== false} onChange={set('mobile_show_brand')}    label="Show brand text on mobile" />
          <Toggle checked={data.mobile_show_subtitle === true}  onChange={set('mobile_show_subtitle')} label="Show subtitle on mobile" />
          <Toggle checked={data.mobile_show_links    === true}  onChange={set('mobile_show_links')}    label="Show nav links on mobile" />
          <Toggle checked={data.mobile_show_cta      !== false} onChange={set('mobile_show_cta')}      label="Show booking CTA on mobile" />
        </div>
        <FormRow label="Mobile breakpoint (px)" hint="Width at which the mobile rules apply.">
          <Input
            type="number"
            value={data.mobile_breakpoint ?? 768}
            onChange={v => set('mobile_breakpoint')(Number(v) || 768)}
            placeholder="768"
          />
        </FormRow>
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

// ── Menu (inline) editor ───────────────────────────────────

export function MenuInlineEditor({ data, onChange }) {
  const api = useApi()
  const set = (k) => (v) => onChange({ ...data, [k]: v })
  const { data: menus = [] } = useQuery({
    queryKey: ['menus'],
    queryFn:  () => api.get('/menus'),
  })
  // Hydrate the chosen menu so we can offer section + item pickers below.
  const { data: menu, isLoading: menuLoading } = useQuery({
    queryKey: ['menu', data.menu_id],
    queryFn:  () => api.get(`/menus/${data.menu_id}`),
    enabled:  !!data.menu_id,
    staleTime: 30_000,
  })

  const sectionIds = Array.isArray(data.section_ids) ? data.section_ids : []
  const itemIds    = Array.isArray(data.item_ids)    ? data.item_ids    : []

  const toggleSection = (id) => {
    const next = sectionIds.includes(id)
      ? sectionIds.filter(x => x !== id)
      : [...sectionIds, id]
    set('section_ids')(next)
  }
  const toggleItem = (id) => {
    const next = itemIds.includes(id)
      ? itemIds.filter(x => x !== id)
      : [...itemIds, id]
    set('item_ids')(next)
  }

  // When sections are filtered, dishes outside those sections become
  // unreachable — surface them in the picker anyway, but greyed out.
  const visibleSections = (menu?.sections || []).filter(s =>
    sectionIds.length === 0 || sectionIds.includes(s.id),
  )

  return (
    <div className="space-y-4">
      <FormRow label="Heading" hint="Shown above the menu. Blank to hide.">
        <Input value={data.heading} onChange={set('heading')} placeholder="Our menu" />
      </FormRow>
      <FormRow label="Menu" hint="Pick which menu to render. Manage menus from the main Menus page.">
        <Select value={data.menu_id || ''} onChange={v => {
          // Switching menus invalidates any section/item filters.
          onChange({ ...data, menu_id: v || null, section_ids: [], item_ids: [] })
        }}>
          <option value="">— Pick a menu —</option>
          {menus.map(m => (
            <option key={m.id} value={m.id}>
              {m.name}{m.venue_name ? ` (${m.venue_name})` : ''} · /menus/{m.slug}
            </option>
          ))}
        </Select>
      </FormRow>

      {data.menu_id && (
        <>
          <div>
            <SectionHead label="Sections (categories)"
              action={sectionIds.length > 0 && (
                <button type="button" onClick={() => set('section_ids')([])}
                  className="text-xs text-primary hover:underline">Show all</button>
              )} />
            <p className="text-xs text-muted-foreground mb-2">
              {sectionIds.length === 0
                ? 'Showing all sections. Click chips to limit which sections render.'
                : `Showing ${sectionIds.length} of ${menu?.sections?.length || 0}.`}
            </p>
            {menuLoading
              ? <p className="text-xs text-muted-foreground">Loading…</p>
              : !menu?.sections?.length
                ? <p className="text-xs text-muted-foreground">This menu has no sections yet.</p>
                : <div className="flex flex-wrap gap-1.5">
                    {menu.sections.map(s => {
                      const on = sectionIds.includes(s.id)
                      const active = sectionIds.length === 0 || on
                      return (
                        <button key={s.id} type="button" onClick={() => toggleSection(s.id)}
                          className={`text-xs border rounded-full px-3 py-1.5 min-h-[32px]
                            ${on
                              ? 'bg-primary text-primary-foreground border-primary'
                              : active
                                ? 'bg-background hover:bg-accent'
                                : 'bg-muted/40 text-muted-foreground'}`}>
                          {s.title}
                        </button>
                      )
                    })}
                  </div>}
          </div>

          <div>
            <SectionHead label="Specific dishes"
              action={itemIds.length > 0 && (
                <button type="button" onClick={() => set('item_ids')([])}
                  className="text-xs text-primary hover:underline">Show all</button>
              )} />
            <p className="text-xs text-muted-foreground mb-2">
              {itemIds.length === 0
                ? 'Showing all dishes within visible sections. Click chips to limit to specific dishes.'
                : `Limiting to ${itemIds.length} dish${itemIds.length === 1 ? '' : 'es'}.`}
            </p>
            {menuLoading
              ? <p className="text-xs text-muted-foreground">Loading…</p>
              : visibleSections.length === 0
                ? <p className="text-xs text-muted-foreground">Pick a section to see its dishes.</p>
                : <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
                    {visibleSections.map(s => (
                      <div key={s.id}>
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">{s.title}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {(s.items || []).map(item => {
                            const on = itemIds.includes(item.id)
                            return (
                              <button key={item.id} type="button" onClick={() => toggleItem(item.id)}
                                className={`text-xs border rounded-full px-2.5 py-1 min-h-[28px]
                                  ${on
                                    ? 'bg-primary text-primary-foreground border-primary'
                                    : 'bg-background hover:bg-accent'}`}>
                                {item.name}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>}
          </div>

          <div>
            <SectionHead label="Layout" />
            <div className="space-y-3">
              <FormRow label="Columns"
                hint={`How many columns to lay out sections in. Blank uses the menu's setting (${menu?.print_columns || 3}).`}>
                <div className="grid grid-cols-5 gap-1.5">
                  {[null, 1, 2, 3, 4].map(n => (
                    <button key={String(n)} type="button"
                      onClick={() => set('columns')(n)}
                      className={`text-sm border rounded-md py-2 min-h-[36px]
                        ${data.columns === n
                          ? 'bg-primary/10 border-primary text-primary font-medium'
                          : 'hover:bg-accent'}`}>
                      {n === null ? 'Auto' : n}
                    </button>
                  ))}
                </div>
              </FormRow>
              <FormRow label="Flow"
                hint='"Columns" snakes sections vertically through column 1, then 2, etc. "Rows" places sections left-to-right and wraps to a new row.'>
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { v: 'columns', label: 'Columns (snake)' },
                    { v: 'rows',    label: 'Rows (wrap)' },
                  ].map(opt => (
                    <button key={opt.v} type="button"
                      onClick={() => set('direction')(opt.v)}
                      className={`text-sm border rounded-md py-2 min-h-[36px]
                        ${(data.direction || 'columns') === opt.v
                          ? 'bg-primary/10 border-primary text-primary font-medium'
                          : 'hover:bg-accent'}`}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </FormRow>
            </div>
          </div>

          <div>
            <SectionHead label="Display" />
            <div className="space-y-3">
              <Toggle
                checked={data.show_section_headers !== false}
                onChange={set('show_section_headers')}
                label="Show category headers"
              />
              <Toggle
                checked={data.show_subheader !== false}
                onChange={set('show_subheader')}
                label="Show subheader (menu tagline)"
              />
              {data.show_subheader !== false && (
                <FormRow label="Subheader text"
                  hint={`Override the menu's tagline. Blank = use ${menu?.tagline ? `"${menu.tagline}"` : 'the tagline set on the menu'}.`}>
                  <Input value={data.subheader_text} onChange={set('subheader_text')}
                    placeholder={menu?.tagline || 'Menu tagline'} />
                </FormRow>
              )}
              <Toggle
                checked={!!data.hide_prices}
                onChange={set('hide_prices')}
                label="Hide prices"
              />
            </div>
          </div>

          <a href={`/api/menus/${data.menu_id}/print`} target="_blank" rel="noopener"
            className="text-xs text-primary hover:underline block">
            Preview printable version →
          </a>
        </>
      )}
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
  const items  = data.items || []
  const source = data.source || 'static'

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
        <SectionHead label="Review source" />
        <div className="space-y-3">
          <FormRow label="Source">
            <Select value={source} onChange={set('source')}>
              <option value="static">Hand-curated (entered below)</option>
              <option value="db">Live from review database</option>
            </Select>
          </FormRow>
          {source === 'db' && (
            <>
              <FormRow label="Min. star rating">
                <Select value={String(data.min_rating || 4)} onChange={v => set('min_rating')(Number(v))}>
                  {[5, 4, 3, 2, 1].map(s => <option key={s} value={s}>{'★'.repeat(s) + ' and above'}</option>)}
                </Select>
              </FormRow>
              <FormRow label="Max. to show">
                <Select value={String(data.max_count || 6)} onChange={v => set('max_count')(Number(v))}>
                  {[3, 4, 5, 6, 8, 10].map(n => <option key={n} value={n}>{n} reviews</option>)}
                </Select>
              </FormRow>
              <FormRow label="Platform filter">
                <Select value={data.platform || ''} onChange={set('platform')}>
                  <option value="">All platforms</option>
                  <option value="google">Google</option>
                  <option value="tripadvisor">TripAdvisor</option>
                  <option value="justeat">Just Eat</option>
                  <option value="deliveroo">Deliveroo</option>
                  <option value="manual">Manually added</option>
                </Select>
              </FormRow>
              <p className="text-xs text-muted-foreground">
                Shows approved reviews only. Featured reviews appear first. Manage your review database under <strong>Reviews</strong> in the sidebar.
              </p>
            </>
          )}
        </div>
      </div>

      {source === 'static' && (
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
            {items.length === 0 && <p className="text-xs text-muted-foreground">No reviews yet — add one above.</p>}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Scrolling text editor ──────────────────────────────────
//
// A from-scratch replacement for the broken Ticker editor. Picks a font,
// saves it. Period. No legacy `font_style: 'sans'` branch, no display-only
// fallback that ghosts the underlying state. The SSR partial (scrolling_text.eta)
// loads the chosen font directly via its own <link> and applies it with
// !important, so what you pick is what visitors see.

export function ScrollingTextEditor({ data, onChange }) {
  const set = (k) => (v) => onChange({ ...data, [k]: v })
  const items = data.items || []

  // Persist a real font_family on first interaction so the saved data
  // matches what the picker is showing.
  const fontValue = data.font_family || 'Caveat'

  return (
    <div className="space-y-5">
      <div>
        <SectionHead label="Phrases"
          action={<AddButton onClick={() => set('items')(arrAppend(items, 'New phrase'))}>Add</AddButton>} />
        <p className="text-xs text-muted-foreground mb-2">
          Each phrase scrolls past with a bullet between. Order = scroll order. The list loops automatically.
        </p>
        {items.length === 0
          ? <p className="text-xs text-muted-foreground">No phrases yet — add one to start.</p>
          : <div className="space-y-2">
              {items.map((phrase, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input value={phrase}
                    onChange={v => {
                      const next = items.slice()
                      next[i] = v
                      set('items')(next)
                    }}
                    placeholder="e.g. Pad Thai" />
                  <RemoveButton onClick={() => set('items')(arrRemove(items, i))} />
                </div>
              ))}
            </div>}
      </div>

      <div>
        <SectionHead label="Typography" />
        <div className="space-y-3">
          <FormRow label="Font"
            hint="Loaded from Google Fonts directly inside the block — no theme cascade.">
            <FontPicker
              fonts={FONT_OPTIONS}
              value={fontValue}
              onChange={set('font_family')} />
          </FormRow>
          <FormRow label="Font size"
            hint={`Relative to the theme's base font size. Current scale: ${data.font_scale || 'lg'}.`}>
            <Select value={data.font_scale || 'lg'} onChange={set('font_scale')}>
              <option value="sm">Small (1× base)</option>
              <option value="base">Base (1.125× base)</option>
              <option value="lg">Large (1.5× base)</option>
              <option value="xl">Extra-large (2× base)</option>
              <option value="2xl">Display (2.5× base)</option>
              <option value="3xl">Hero (3.5× base)</option>
            </Select>
          </FormRow>
          <FormRow label="Weight">
            <Select value={String(data.font_weight ?? 500)} onChange={v => set('font_weight')(Number(v))}>
              <option value="400">Regular (400)</option>
              <option value="500">Medium (500)</option>
              <option value="600">Semi-bold (600)</option>
              <option value="700">Bold (700)</option>
            </Select>
          </FormRow>
          <FormRow label="Style">
            <Select value={data.font_style || 'normal'} onChange={set('font_style')}>
              <option value="normal">Normal</option>
              <option value="italic">Italic</option>
            </Select>
          </FormRow>
        </div>
      </div>

      <div>
        <SectionHead label="Colours + motion" />
        <div className="space-y-3">
          <FormRow label="Background">
            <Select value={data.bg_style || 'primary'} onChange={set('bg_style')}>
              <option value="primary">Primary (brand colour)</option>
              <option value="accent">Accent</option>
              <option value="surface">Surface (light)</option>
            </Select>
          </FormRow>
          <FormRow label="Text colour"
            hint="Pick a theme role. Inherit = white on dark backgrounds, brand text colour on surface.">
            <ThemeColourPicker value={data.text_colour} onChange={set('text_colour')} />
          </FormRow>
          <FormRow label="Scroll speed">
            <Select value={data.speed || 'medium'} onChange={set('speed')}>
              <option value="slow">Slow</option>
              <option value="medium">Medium</option>
              <option value="fast">Fast</option>
            </Select>
          </FormRow>
          <Toggle
            checked={data.show_separators !== false}
            onChange={set('show_separators')}
            label="Show bullet separators between phrases" />
        </div>
      </div>
    </div>
  )
}

// ── Gallery editor ─────────────────────────────────────────
//
// Source-or-pick model:
//   * source='category' + category_id=<uuid>   → all images in that category
//   * source='category' + category_id=null     → all images for the tenant
//   * source='items'    + item_ids=[uuid,...]  → exactly those images, in order
//
// Layout (grid / masonry / horizontal scroll), columns (2-4), gap, aspect
// ratio, captions, lightbox — all controllable. Renders thumbnails of the
// resolved set inline so the operator can sanity-check the selection.

export function GalleryEditor({ data, onChange }) {
  const api = useApi()
  const set = (k) => (v) => onChange({ ...data, [k]: v })
  const source     = data.source || 'category'
  const categoryId = data.category_id || null
  const itemIds    = Array.isArray(data.item_ids) ? data.item_ids : []

  const { data: categories = [] } = useQuery({
    queryKey: ['media-categories'],
    queryFn:  () => api.get('/media/categories'),
    staleTime: 60_000,
  })

  // Library list — used for the multi-pick UI when source='items', AND
  // to render thumbnails of the resolved selection.
  const { data: libraryItems = [], isLoading: libLoading } = useQuery({
    queryKey: ['media-items', { categoryId: source === 'category' ? categoryId : null }],
    queryFn:  () => {
      const qs = source === 'category' && categoryId
        ? '?category_id=' + encodeURIComponent(categoryId)
        : ''
      return api.get('/media/items' + qs)
    },
    staleTime: 30_000,
  })

  // Filter to images only (Media library can hold non-images).
  const images = libraryItems.filter(i => /^image\//.test(i.mimetype || ''))

  // The set actually rendered by the SSR partial — used for the live
  // thumb preview inside the editor.
  let resolvedItems = []
  if (source === 'items') {
    const byId = Object.fromEntries(images.map(i => [i.id, i]))
    resolvedItems = itemIds.map(id => byId[id]).filter(Boolean)
  } else {
    resolvedItems = images
  }
  if (data.max_items && resolvedItems.length > data.max_items) {
    resolvedItems = resolvedItems.slice(0, data.max_items)
  }

  function toggleItem(id) {
    const next = itemIds.includes(id) ? itemIds.filter(x => x !== id) : [...itemIds, id]
    set('item_ids')(next)
  }

  return (
    <div className="space-y-5">
      <div>
        <SectionHead label="Heading" />
        <FormRow label="Section heading" hint="Above the gallery. Blank to hide.">
          <Input value={data.heading} onChange={set('heading')} placeholder="Gallery" />
        </FormRow>
      </div>

      <div>
        <SectionHead label="Source" />
        <p className="text-xs text-muted-foreground mb-2">
          Pull images from a Media library category, or hand-pick specific images.
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          {[
            { v: 'category', label: 'By category' },
            { v: 'items',    label: 'Pick specific images' },
          ].map(opt => (
            <button key={opt.v} type="button" onClick={() => set('source')(opt.v)}
              className={`text-sm border rounded-md py-2 min-h-[36px]
                ${source === opt.v ? 'bg-primary/10 border-primary text-primary font-medium' : 'hover:bg-accent'}`}>
              {opt.label}
            </button>
          ))}
        </div>

        {source === 'category' && (
          <FormRow label="Category" className="mt-3"
            hint="Blank = all images for this tenant.">
            <Select value={categoryId || ''} onChange={v => set('category_id')(v || null)}>
              <option value="">— All images —</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </FormRow>
        )}

        {source === 'items' && (
          <div className="mt-3">
            <p className="text-xs text-muted-foreground mb-2">
              {itemIds.length === 0
                ? 'No images selected. Click thumbnails below to add.'
                : `${itemIds.length} image${itemIds.length === 1 ? '' : 's'} selected.`}
              {itemIds.length > 0 && (
                <button type="button" onClick={() => set('item_ids')([])}
                  className="ml-2 text-primary hover:underline">Clear</button>
              )}
            </p>
            {libLoading
              ? <p className="text-xs text-muted-foreground">Loading library…</p>
              : images.length === 0
                ? <p className="text-xs text-muted-foreground">No images in your Media library yet — upload some on the Media page.</p>
                : <div className="grid grid-cols-4 gap-1.5 max-h-[280px] overflow-y-auto p-1 border rounded">
                    {images.map(img => {
                      const on = itemIds.includes(img.id)
                      return (
                        <button key={img.id} type="button" onClick={() => toggleItem(img.id)}
                          title={img.filename}
                          className={`relative aspect-square overflow-hidden rounded border
                            ${on ? 'ring-2 ring-primary ring-offset-1' : 'hover:border-primary/40'}`}>
                          <img src={img.url} alt="" className="w-full h-full object-cover" loading="lazy" />
                          {on && (
                            <span className="absolute top-1 right-1 bg-primary text-primary-foreground text-[10px] px-1 py-0.5 rounded">✓</span>
                          )}
                        </button>
                      )
                    })}
                  </div>}
          </div>
        )}
      </div>

      <div>
        <SectionHead label="Layout" />
        <div className="space-y-3">
          <FormRow label="Style">
            <div className="grid grid-cols-3 gap-1.5">
              {[
                { v: 'grid',       label: 'Grid' },
                { v: 'masonry',    label: 'Masonry' },
                { v: 'horizontal', label: 'Horizontal' },
              ].map(opt => (
                <button key={opt.v} type="button" onClick={() => set('layout')(opt.v)}
                  className={`text-sm border rounded-md py-2 min-h-[36px]
                    ${(data.layout || 'grid') === opt.v
                      ? 'bg-primary/10 border-primary text-primary font-medium'
                      : 'hover:bg-accent'}`}>
                  {opt.label}
                </button>
              ))}
            </div>
          </FormRow>
          {(data.layout || 'grid') !== 'horizontal' && (
            <FormRow label="Columns">
              <div className="grid grid-cols-3 gap-1.5">
                {[2, 3, 4].map(n => (
                  <button key={n} type="button" onClick={() => set('columns')(n)}
                    className={`text-sm border rounded-md py-2 min-h-[36px]
                      ${(data.columns || 3) === n
                        ? 'bg-primary/10 border-primary text-primary font-medium'
                        : 'hover:bg-accent'}`}>
                    {n}
                  </button>
                ))}
              </div>
            </FormRow>
          )}
          <FormRow label="Gap">
            <Select value={data.gap || 'normal'} onChange={set('gap')}>
              <option value="tight">Tight (8px)</option>
              <option value="normal">Normal (16px)</option>
              <option value="wide">Wide (24px)</option>
            </Select>
          </FormRow>
          <FormRow label="Aspect ratio"
            hint="Forces every image to the same shape. Natural keeps each image's own ratio (best with masonry).">
            <Select value={data.aspect || 'square'} onChange={set('aspect')}>
              <option value="square">Square (1:1)</option>
              <option value="4:3">Landscape (4:3)</option>
              <option value="16:9">Wide (16:9)</option>
              <option value="natural">Natural (per-image)</option>
            </Select>
          </FormRow>
          <FormRow label="Max images shown"
            hint="Optional cap. Blank = show everything matched.">
            <Input type="number" value={data.max_items ?? ''}
              onChange={v => set('max_items')(v === '' ? null : Math.max(0, Number(v) || 0))}
              placeholder="No limit" />
          </FormRow>
        </div>
      </div>

      <div>
        <SectionHead label="Display" />
        <div className="space-y-2">
          <Toggle checked={!!data.show_captions} onChange={set('show_captions')}
            label="Show captions under images" />
          <Toggle checked={data.lightbox !== false} onChange={set('lightbox')}
            label="Click to open full-size (lightbox)" />
        </div>
      </div>

      <div>
        <SectionHead label="Selection preview" />
        <p className="text-xs text-muted-foreground mb-2">
          {resolvedItems.length === 0
            ? 'Nothing will render yet — pick a category or images above.'
            : `${resolvedItems.length} image${resolvedItems.length === 1 ? '' : 's'} will render.`}
        </p>
        {resolvedItems.length > 0 && (
          <div className="grid grid-cols-6 gap-1">
            {resolvedItems.slice(0, 12).map(img => (
              <div key={img.id} className="aspect-square overflow-hidden rounded border">
                <img src={img.url} alt="" className="w-full h-full object-cover" loading="lazy" />
              </div>
            ))}
            {resolvedItems.length > 12 && (
              <div className="aspect-square rounded border bg-muted flex items-center justify-center text-xs text-muted-foreground">
                +{resolvedItems.length - 12}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Booking widget editor ──────────────────────────────────
//
// Per-block overrides for the booking widget chrome. Tenant-wide defaults
// live at /widget-settings — anything left blank here inherits from there.
// The placeholder text on each input shows the value that would be used
// if blank, pulled live from the tenant_site row.

function BlockCtaEditor({ value, onChange }) {
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
              className="flex-1 text-sm border rounded-md px-2 py-1.5 min-h-[36px] bg-background"
            />
            <RemoveButton onClick={() => removeCta(i)} />
          </div>
          <Input value={cta.url} onChange={v => update(i, 'url', v)} placeholder="https://..." />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="text-[10px] text-muted-foreground mb-1">Background</div>
              <ThemeColourPicker value={cta.bg} onChange={v => update(i, 'bg', v)} />
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground mb-1">Text</div>
              <ThemeColourPicker value={cta.fg} onChange={v => update(i, 'fg', v)} />
            </div>
          </div>
        </div>
      ))}
      {ctas.length < 4 && (
        <AddButton onClick={addCta}>Add button</AddButton>
      )}
    </div>
  )
}

export function ReservationsWidgetEditor({ data, onChange, config }) {
  const api = useApi()
  const set = (k) => (v) => onChange({ ...data, [k]: v })

  // Pull tenant defaults so we can show the inherited values as placeholders.
  const { data: tenantSite } = useQuery({
    queryKey: ['tenant-site'],
    queryFn:  () => api.get('/website/tenant-site'),
    staleTime: 60_000,
  })
  const ws = (tenantSite && tenantSite.widget_settings) || {}

  // Venue picker — useful when the embedding page can't infer a venue
  // (e.g. tenant home pages that should target a specific location).
  const { data: venues = [] } = useQuery({
    queryKey: ['venues'],
    queryFn:  () => api.get('/venues'),
    staleTime: 60_000,
  })

  // Tri-state header toggle: null (inherit) | true | false
  function setHeaderShow(state) {
    onChange({ ...data, header_show: state })
  }

  return (
    <div className="space-y-5">
      <div>
        <SectionHead label="Heading + venue" />
        <div className="space-y-3">
          <FormRow label="Section heading" hint="Above the iframe. Blank to hide.">
            <Input value={data.heading} onChange={set('heading')} placeholder="Reserve a table" />
          </FormRow>
          <FormRow label="Anchor ID"
            hint='Lets you link to this block from anywhere with e.g. &lt;a href="#book-now"&gt;. Blank = "reservations".'>
            <Input
              value={data.anchor_id}
              onChange={v => {
                // Strip a leading '#' so paste from CSS / link text works,
                // and constrain to safe URL-fragment chars.
                const clean = String(v || '')
                  .replace(/^#/, '')
                  .replace(/[^A-Za-z0-9_-]/g, '-')
                  .replace(/-{2,}/g, '-')
                  .slice(0, 60)
                set('anchor_id')(clean)
              }}
              placeholder="e.g. book-now" />
          </FormRow>
          <FormRow label="Target venue"
            hint="Leave blank to use the page's venue (location pages) or the tenant default.">
            <Select value={data.venue_id || ''} onChange={v => set('venue_id')(v || null)}>
              <option value="">— Auto (page venue / tenant default) —</option>
              {venues.map(v => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </Select>
          </FormRow>
        </div>
      </div>

      <div>
        <SectionHead label="Header" />
        <p className="text-xs text-muted-foreground mb-2">
          The text shown at the top of the widget iframe ("One Thai Cafe / Book a table").
        </p>
        <div className="space-y-3">
          <FormRow label="Show widget header">
            <div className="grid grid-cols-3 gap-1.5">
              {[
                { v: null,  label: 'Inherit' },
                { v: true,  label: 'Show' },
                { v: false, label: 'Hide' },
              ].map(opt => (
                <button key={String(opt.v)} type="button" onClick={() => setHeaderShow(opt.v)}
                  className={`text-sm border rounded-md py-2 min-h-[36px]
                    ${data.header_show === opt.v
                      ? 'bg-primary/10 border-primary text-primary font-medium'
                      : 'hover:bg-accent'}`}>
                  {opt.label}
                </button>
              ))}
            </div>
          </FormRow>
          <FormRow label="Header text" hint={`Blank = ${ws.header_text || 'tenant site name'}.`}>
            <Input value={data.header_text} onChange={set('header_text')}
              placeholder={ws.header_text || 'Tenant site name'} />
          </FormRow>
          <FormRow label="Sub-header" hint={`Blank = ${ws.subheader_text || '"Book a table"'}.`}>
            <Input value={data.subheader_text} onChange={set('subheader_text')}
              placeholder={ws.subheader_text || 'Book a table'} />
          </FormRow>
        </div>
      </div>

      <div>
        <SectionHead label="Button" />
        <div className="space-y-3">
          <FormRow label="Background colour"
            hint={`Pick a theme role. Inherit = ${roleLabel(ws.button_bg) || 'tenant default'}.`}>
            <ThemeColourPicker value={data.button_bg} onChange={set('button_bg')} />
          </FormRow>
          <FormRow label="Text colour"
            hint={`Pick a theme role. Inherit = ${roleLabel(ws.button_fg) || 'white'}.`}>
            <ThemeColourPicker value={data.button_fg} onChange={set('button_fg')} />
          </FormRow>
          <FormRow label={`Corner radius — ${data.button_radius_px ?? ws.button_radius_px ?? 8}px`}>
            <input type="range" min={0} max={40} step={1}
              value={data.button_radius_px ?? ws.button_radius_px ?? 8}
              onChange={e => set('button_radius_px')(Number(e.target.value))}
              className="w-full" />
          </FormRow>
        </div>
      </div>

      <div>
        <SectionHead label="Borders + radii" />
        <div className="space-y-3">
          <FormRow label="Border colour"
            hint={`Pick a theme role. Inherit = ${roleLabel(ws.border_colour) || 'theme border'}.`}>
            <ThemeColourPicker value={data.border_colour} onChange={set('border_colour')} />
          </FormRow>
          <FormRow label={`Card / chip radius — ${data.card_radius_px ?? ws.card_radius_px ?? 8}px`}>
            <input type="range" min={0} max={40} step={1}
              value={data.card_radius_px ?? ws.card_radius_px ?? 8}
              onChange={e => set('card_radius_px')(Number(e.target.value))}
              className="w-full" />
          </FormRow>
        </div>
      </div>

      <div>
        <SectionHead label="Typography" />
        <p className="text-xs text-muted-foreground mb-2">
          Three independent font tracks. Each falls back to the tenant default
          when blank, then to the brand body font.
        </p>
        <div className="space-y-3">
          <FormRow label="Body font"
            hint={`Headers, button labels, form fields. Blank = ${ws.font_family || 'tenant default'}.`}>
            <FontPicker fonts={FONT_OPTIONS}
              value={data.font_family}
              onChange={set('font_family')}
              placeholder={ws.font_family || 'Inherit tenant'} />
          </FormRow>
          <FormRow label={`Body size — ${data.font_size_px ?? ws.font_size_px ?? 16}px`}>
            <input type="range" min={11} max={22} step={1}
              value={data.font_size_px ?? ws.font_size_px ?? 16}
              onChange={e => set('font_size_px')(Number(e.target.value))}
              className="w-full" />
          </FormRow>
          <FormRow label="Calendar font"
            hint="Used for the date numbers in the date picker.">
            <FontPicker fonts={FONT_OPTIONS}
              value={data.font_calendar_family}
              onChange={set('font_calendar_family')}
              placeholder={ws.font_calendar_family || 'Inherit body font'} />
          </FormRow>
          <FormRow label={`Calendar size — ${data.font_calendar_size_px ?? ws.font_calendar_size_px ?? 15}px`}>
            <input type="range" min={10} max={28} step={1}
              value={data.font_calendar_size_px ?? ws.font_calendar_size_px ?? 15}
              onChange={e => set('font_calendar_size_px')(Number(e.target.value))}
              className="w-full" />
          </FormRow>
          <FormRow label="Time slots font" hint="Used for the HH:MM time buttons.">
            <FontPicker fonts={FONT_OPTIONS}
              value={data.font_slots_family}
              onChange={set('font_slots_family')}
              placeholder={ws.font_slots_family || 'Inherit body font'} />
          </FormRow>
          <FormRow label={`Time slots size — ${data.font_slots_size_px ?? ws.font_slots_size_px ?? 14}px`}>
            <input type="range" min={10} max={28} step={1}
              value={data.font_slots_size_px ?? ws.font_slots_size_px ?? 14}
              onChange={e => set('font_slots_size_px')(Number(e.target.value))}
              className="w-full" />
          </FormRow>
        </div>
      </div>

      <div>
        <SectionHead label="Calendar day colours" />
        <p className="text-xs text-muted-foreground mb-2">
          Available days vs closed days. Theme roles only — pick from the brand
          palette. Blank fields fall back to tenant defaults / sensible defaults.
        </p>
        <div className="space-y-3">
          <FormRow label="Open day — background">
            <ThemeColourPicker value={data.cal_open_bg} onChange={set('cal_open_bg')} />
          </FormRow>
          <FormRow label="Open day — text">
            <ThemeColourPicker value={data.cal_open_fg} onChange={set('cal_open_fg')} />
          </FormRow>
          <FormRow label="Open day — border">
            <ThemeColourPicker value={data.cal_open_border} onChange={set('cal_open_border')} />
          </FormRow>
          <FormRow label="Closed day — background">
            <ThemeColourPicker value={data.cal_closed_bg} onChange={set('cal_closed_bg')} />
          </FormRow>
          <FormRow label="Closed day — text">
            <ThemeColourPicker value={data.cal_closed_fg} onChange={set('cal_closed_fg')} />
          </FormRow>
          <FormRow label="Closed day — border">
            <ThemeColourPicker value={data.cal_closed_border} onChange={set('cal_closed_border')} />
          </FormRow>
        </div>
      </div>

      <div>
        <SectionHead label="Messages" />
        <FormRow label="“Larger party” text"
          hint={`Shown under the covers row. Blank = ${ws.large_party_text ? '"' + ws.large_party_text + '"' : 'default copy'}. Set to a single space to hide it.`}>
          <Area value={data.large_party_text} onChange={set('large_party_text')} rows={2}
            placeholder={ws.large_party_text || 'Larger party? Call us — we’ll arrange combined tables.'} />
        </FormRow>
      </div>

      <div>
        <SectionHead label="Confirmation page" />
        <p className="text-xs text-muted-foreground mb-2">
          Content shown to guests after a successful booking.
          Supports HTML and merge fields:
          {' '}<code className="text-[10px]">{'{{guest_name}}'}</code>,
          {' '}<code className="text-[10px]">{'{{reference}}'}</code>,
          {' '}<code className="text-[10px]">{'{{date}}'}</code>,
          {' '}<code className="text-[10px]">{'{{time}}'}</code>,
          {' '}<code className="text-[10px]">{'{{covers}}'}</code>,
          {' '}<code className="text-[10px]">{'{{venue_name}}'}</code>,
          {' '}<code className="text-[10px]">{'{{email}}'}</code>.
          Blank = tenant defaults.
        </p>
        <div className="space-y-3">
          <FormRow label="Heading" hint='Override "You\'re booked". Blank = tenant default.'>
            <Input value={data.confirmation_heading} onChange={set('confirmation_heading')}
              placeholder={ws.confirmation_heading || "You're booked!"} />
          </FormRow>
          <FormRow label="Body HTML" hint="Below the booking summary card. Supports basic HTML + merge fields.">
            <Area value={data.confirmation_body_html} onChange={set('confirmation_body_html')} rows={4}
              placeholder={ws.confirmation_body_html || '<p>See you soon!</p>'} />
          </FormRow>
          <FormRow label="CTA buttons" hint="Up to 4 link buttons below the body.">
            <BlockCtaEditor
              value={data.confirmation_ctas || []}
              onChange={v => onChange({ ...data, confirmation_ctas: v })}
            />
          </FormRow>
        </div>
      </div>

      <div>
        <SectionHead label="Debug" />
        <p className="text-xs text-muted-foreground mb-2">
          Tri-state: Inherit (use tenant default) / Force on / Force off. The
          diagnostic overlay shows live state at the top of the widget. Should
          stay off for normal customers.
        </p>
        <div className="grid grid-cols-3 gap-1.5">
          {[
            { v: null,  label: 'Inherit' },
            { v: true,  label: 'On' },
            { v: false, label: 'Off' },
          ].map(opt => (
            <button key={String(opt.v)} type="button"
              onClick={() => set('debug_enabled')(opt.v)}
              className={`text-sm border rounded-md py-2 min-h-[36px]
                ${data.debug_enabled === opt.v
                  ? 'bg-primary/10 border-primary text-primary font-medium'
                  : 'hover:bg-accent'}`}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

