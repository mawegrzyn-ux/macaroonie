// canvas/blockCanvas.jsx
//
// Per-type canvas components — these mirror api/src/views/site/blocks/<type>.eta
// so what the operator sees in the admin canvas matches what gets rendered
// to the public site. Each component receives:
//
//   data:      the block.data shape (matches blockRegistry default)
//   onChange:  (data) => void — patches the block's data
//   selected:  boolean — whether the block is the active selection
//   config:    full website_config object (for fonts, theme, gallery, etc.)
//
// Style note: these components ONLY render visual block content. The
// drag handle / selection toolbar / outline come from BlockShell — keep
// them out of here.

import { useRef, useState } from 'react'
import { useApi } from '@/lib/api'
import { Image as ImageIcon, Upload, Loader2 } from 'lucide-react'
import { MediaLibraryModal } from '@/components/media/MediaLibrary'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { InlineText }      from './InlineText'
import { InlineRichText }  from './InlineRichText'
import { BlockInserter }   from './BlockInserter'
import { parentKey }       from '../blockTree'

// Inner container max-width based on the per-block `container` setting.
// Mirror of the corresponding switch in each Eta partial.
function innerContainerStyle(width) {
  switch (width) {
    case 'wide':  return { maxWidth: 1400, marginLeft: 'auto', marginRight: 'auto', paddingLeft: 24, paddingRight: 24, width: '100%' }
    case 'full':  return { maxWidth: 'none', width: '100%', paddingLeft: 24, paddingRight: 24 }
    case 'boxed':
    default:      return { maxWidth: 'var(--cw)', marginLeft: 'auto', marginRight: 'auto', paddingLeft: 24, paddingRight: 24, width: '100%' }
  }
}

// ── Hero ─────────────────────────────────────────────────────
//
// Composable hero — eyebrow, dotted divider, centered logo with optional
// flourishes, rich-html heading (with inline <em> script accents), subheading,
// multiple CTAs. Mirrors api/src/views/site/blocks/hero.eta.

export function HeroCanvas({ data, onChange, selected }) {
  const heightMap = { small: '320px', medium: '520px', large: '680px', full: '600px' }
  const minH = heightMap[data.height || 'medium']
  const align = data.align === 'left' ? 'flex-start' : 'center'
  const textAlign = data.align === 'left' ? 'left' : 'center'
  const overlay = data.overlay_opacity ?? 0.4
  const set = (k) => (v) => onChange({ ...data, [k]: v })

  // Background style
  const bgStyle = data.bg_style || 'image'
  let background, darkText = false
  if (bgStyle === 'image' && data.image_url) {
    background = `url('${data.image_url}') center/cover no-repeat`
  } else if (bgStyle === 'gradient') {
    background = 'linear-gradient(135deg, var(--c-primary), var(--c-accent))'
  } else if (bgStyle === 'surface') {
    background = 'var(--c-surface)'
    darkText = true
  } else if (bgStyle === 'transparent') {
    background = 'transparent'
    darkText = true
  } else {
    // Image style without an image set yet — fall back to gradient.
    background = 'linear-gradient(135deg, var(--c-primary), var(--c-accent))'
  }
  const fg = darkText ? 'var(--c-text)' : '#fff'

  const logoSizeMap = { small: 180, medium: 240, large: 320 }
  const logoSize = logoSizeMap[data.logo_size || 'medium']
  const ctas = Array.isArray(data.ctas) ? data.ctas : []
  const headingHtml = data.heading_html && data.heading_html.trim() ? data.heading_html : null

  return (
    <section
      className="block hero"
      style={{
        position: 'relative',
        minHeight: minH,
        display: 'flex',
        alignItems: 'center',
        justifyContent: align,
        color: fg,
        background,
      }}
    >
      {/* Inline accent style — applies to <em> in heading_html */}
      <style>{`
        .pcf-hero-heading em {
          font-family: 'Caveat', var(--f-heading), cursive;
          font-style: normal; font-weight: 600;
          color: ${darkText ? 'var(--c-primary)' : '#fff'};
          font-size: 1.15em;
          letter-spacing: 0;
        }
      `}</style>

      {bgStyle === 'image' && data.image_url && overlay > 0 && (
        <div style={{ position: 'absolute', inset: 0, background: `rgba(0,0,0,${overlay})` }} />
      )}

      <div style={{ ...innerContainerStyle(data.container), position: 'relative', textAlign, paddingTop: 64, paddingBottom: 64 }}>
        {data.eyebrow_text && (
          <div style={{
            fontFamily: 'var(--f-body), sans-serif', textTransform: 'uppercase',
            letterSpacing: '0.18em', fontSize: '0.72rem', fontWeight: 500,
            color: darkText ? 'var(--c-primary)' : '#fff', opacity: 0.85,
            marginBottom: 8,
          }}>{data.eyebrow_text}</div>
        )}

        {data.show_dotted_divider && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: 14, margin: '12px 0', color: darkText ? 'var(--c-primary)' : '#fff',
          }}>
            <span style={{ flex: 1, maxWidth: 80, height: 1, background: 'currentColor', opacity: 0.4 }} />
            <span style={{ width: 3, height: 3, background: 'currentColor', borderRadius: '50%', opacity: 0.6 }} />
            <span style={{ width: 5, height: 5, background: 'currentColor', borderRadius: '50%' }} />
            <span style={{ width: 3, height: 3, background: 'currentColor', borderRadius: '50%', opacity: 0.6 }} />
            <span style={{ flex: 1, maxWidth: 80, height: 1, background: 'currentColor', opacity: 0.4 }} />
          </div>
        )}

        {(data.logo_url || data.flourish_left_url || data.flourish_right_url) && (
          <div style={{
            display: 'flex', justifyContent: 'center', alignItems: 'center',
            gap: 24, margin: '20px 0 30px', position: 'relative',
          }}>
            {data.flourish_left_url && (
              <img src={data.flourish_left_url} alt=""
                style={{ width: 60, height: 'auto', opacity: 0.5 }} />
            )}
            {data.logo_url && (
              <img src={data.logo_url} alt=""
                style={{ width: logoSize, height: logoSize, objectFit: 'contain' }} />
            )}
            {data.flourish_right_url && (
              <img src={data.flourish_right_url} alt=""
                style={{ width: 60, height: 'auto', opacity: 0.5, transform: 'scaleX(-1)' }} />
            )}
          </div>
        )}

        {headingHtml ? (
          <h1 className="pcf-hero-heading"
            style={{
              fontFamily: 'var(--f-heading)', fontSize: 'clamp(32px, 5vw, 64px)',
              margin: '0 0 16px', letterSpacing: '-0.02em', lineHeight: 1.05,
              fontWeight: 400, color: fg,
            }}
            dangerouslySetInnerHTML={{ __html: headingHtml }} />
        ) : (
          <InlineText as="h1"
            value={data.heading}
            onChange={set('heading')}
            placeholder="Welcome"
            style={{
              fontFamily: 'var(--f-heading)',
              fontSize: 'clamp(32px, 5vw, 64px)',
              margin: '0 0 16px',
              letterSpacing: '-0.02em',
              lineHeight: 1.05,
              fontWeight: 400,
              color: fg,
            }} />
        )}

        <InlineText as="p" multiline
          value={data.subheading}
          onChange={set('subheading')}
          placeholder={selected ? 'Add a tagline' : ''}
          style={{
            fontSize: 'clamp(16px, 1.6vw, 22px)',
            maxWidth: 640,
            margin: data.align === 'left' ? '0' : '0 auto 24px',
            opacity: 0.95, lineHeight: 1.5,
            color: darkText ? 'var(--c-muted)' : '#fff',
          }} />

        {ctas.length > 0 && (
          <div style={{
            display: 'flex', gap: 14, justifyContent: data.align === 'left' ? 'flex-start' : 'center',
            flexWrap: 'wrap', marginTop: 24,
          }}>
            {ctas.map((cta, i) => {
              const isPrimary = cta.style !== 'secondary'
              const onLight = darkText
              const bg     = isPrimary ? (onLight ? 'var(--c-primary)' : '#fff') : 'transparent'
              const color  = isPrimary ? (onLight ? '#fff' : 'var(--c-primary)') : (onLight ? 'var(--c-primary)' : '#fff')
              const border = isPrimary ? '1px solid transparent' : (onLight ? '1px solid var(--c-primary)' : '1px solid #fff')
              return (
                <span key={i} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 10,
                  background: bg, color, border,
                  padding: '14px 28px', borderRadius: 999,
                  fontSize: '0.95rem', fontWeight: 500,
                }}>{cta.text || '(button)'}</span>
              )
            })}
          </div>
        )}
      </div>
      {selected && bgStyle === 'image' && (
        <ImagePicker label="Background image" url={data.image_url} onChange={set('image_url')} scope="website:hero" position="bottom-right" />
      )}
    </section>
  )
}

// ── Text (rich) ──────────────────────────────────────────────

export function TextCanvas({ data, onChange }) {
  const widthMap = { narrow: 700, normal: 980, wide: 1200 }
  const maxW = widthMap[data.max_width || 'normal']
  const bg = data.background === 'surface' ? 'var(--c-surface)'
           : data.background === 'accent'  ? 'var(--c-accent)'
           : 'transparent'
  const color = data.background === 'accent' ? '#fff' : 'inherit'
  const set = (k) => (v) => onChange({ ...data, [k]: v })

  return (
    <section className="block" style={{ background: bg, color, paddingTop: 48, paddingBottom: 48 }}>
      <div style={innerContainerStyle(data.container)}>
        <div style={{ maxWidth: maxW, margin: '0 auto', textAlign: data.align || 'left' }}>
          <InlineRichText
            value={data.html}
            onChange={set('html')}
            placeholder="Write something…"
            className="prose"
          />
        </div>
      </div>
    </section>
  )
}

// ── Image ────────────────────────────────────────────────────

export function ImageCanvas({ data, onChange, selected }) {
  const widthMap = { narrow: 600, normal: 900, wide: 1200, full: null }
  const maxW = widthMap[data.max_width || 'normal']
  const align = data.align === 'left' ? 'flex-start' : data.align === 'right' ? 'flex-end' : 'center'
  const set = (k) => (v) => onChange({ ...data, [k]: v })

  return (
    <section className="block" style={{ paddingTop: 32, paddingBottom: 32 }}>
      <div style={{ ...innerContainerStyle(data.container), display: 'flex', justifyContent: align }}>
        <figure style={{ margin: 0, maxWidth: maxW || undefined, width: '100%' }}>
          {data.url ? (
            <img src={data.url} alt={data.alt || ''} style={{ width: '100%', height: 'auto', borderRadius: 'var(--r-md, 8px)', display: 'block' }} />
          ) : (
            <ImagePlaceholder onChange={set('url')} scope="website:image" />
          )}
          <figcaption style={{ marginTop: 8, fontSize: 14, color: 'var(--c-muted)', textAlign: 'center' }}>
            <InlineText
              as="span"
              value={data.caption}
              onChange={set('caption')}
              placeholder={selected ? 'Add a caption (optional)' : ''}
            />
          </figcaption>
        </figure>
      </div>
    </section>
  )
}

// ── CTA strip ────────────────────────────────────────────────

export function CtaStripCanvas({ data, onChange, selected }) {
  const bgMap = {
    primary: { bg: 'var(--c-primary)', fg: '#fff' },
    accent:  { bg: 'var(--c-accent)',  fg: '#fff' },
    dark:    { bg: '#111',             fg: '#fff' },
    light:   { bg: 'var(--c-surface)', fg: 'var(--c-text)' },
  }
  const { bg, fg } = bgMap[data.bg_style || 'primary']
  const btnBg = data.bg_style === 'light' ? 'var(--c-primary)' : '#fff'
  const btnFg = data.bg_style === 'light' ? '#fff' : 'var(--c-primary)'
  const set = (k) => (v) => onChange({ ...data, [k]: v })

  return (
    <section className="block" style={{ background: bg, color: fg, paddingTop: 48, paddingBottom: 48, textAlign: 'center' }}>
      <div style={{ ...innerContainerStyle(data.container), maxWidth: data.container === 'full' ? 'none' : (data.container === 'wide' ? 1100 : 780) }}>
        <InlineText
          as="h2"
          value={data.heading}
          onChange={set('heading')}
          placeholder="Heading"
          style={{
            fontFamily: 'var(--f-heading)',
            fontSize: 'clamp(22px, 3vw, 36px)',
            margin: '0 0 8px',
            color: fg,
          }}
        />
        <InlineText
          as="p"
          multiline
          value={data.subheading}
          onChange={set('subheading')}
          placeholder="Subheading (optional)"
          style={{ fontSize: 17, opacity: 0.9, margin: '0 0 20px', color: fg }}
        />
        {(data.cta_text || selected) && (
          <InlineText
            as="span"
            value={data.cta_text}
            onChange={set('cta_text')}
            placeholder="Click to set button label"
            style={{
              display: 'inline-block',
              background: btnBg, color: btnFg,
              padding: '14px 32px', borderRadius: 'var(--btn-r, 4px)',
              fontWeight: 600, minWidth: 80,
            }}
          />
        )}
      </div>
    </section>
  )
}

// ── Divider ──────────────────────────────────────────────────

export function DividerCanvas({ data }) {
  const sizeMap = { small: '32px', medium: '64px', large: '120px' }
  const v = sizeMap[data.size || 'medium']
  const colour = data.color === 'accent' ? 'var(--c-accent)'
              : data.color === 'muted'  ? 'var(--c-muted)'
              :                            'var(--c-border)'
  if (data.style === 'space') {
    return <div aria-hidden="true" style={{ height: v }} />
  }
  return (
    <div aria-hidden="true" style={{ padding: `${v} 24px` }}>
      <hr style={{
        margin: '0 auto', maxWidth: 600, border: 0,
        borderTop: `${data.style === 'thick' ? 3 : 1}px solid ${colour}`,
      }} />
    </div>
  )
}

// ── FAQ ──────────────────────────────────────────────────────

export function FaqCanvas({ data, onChange, selected }) {
  const items = Array.isArray(data.items) ? data.items : []
  const set = (k) => (v) => onChange({ ...data, [k]: v })
  const setItem = (i, patch) => {
    const next = items.slice()
    next[i] = { ...next[i], ...patch }
    set('items')(next)
  }
  const addItem = () => set('items')([...items, { q: 'New question', a: 'Answer goes here.' }])
  const removeItem = (i) => set('items')(items.filter((_, j) => j !== i))

  return (
    <section className="block" style={{ paddingTop: 48, paddingBottom: 48 }}>
      <div style={{ ...innerContainerStyle(data.container), maxWidth: data.container === 'full' ? 'none' : (data.container === 'wide' ? 1100 : 780) }}>
        <InlineText
          as="h2"
          value={data.heading}
          onChange={set('heading')}
          placeholder="Frequently asked"
          style={{ fontFamily: 'var(--f-heading)', margin: '0 0 24px', textAlign: 'center' }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((it, i) => (
            <div key={i} style={{
              border: '1px solid var(--c-border)',
              borderRadius: 'var(--r-md, 8px)',
              padding: '14px 18px',
              position: 'relative',
            }}>
              <InlineText
                as="div"
                value={it.q}
                onChange={(v) => setItem(i, { q: v })}
                placeholder="Question?"
                style={{ fontWeight: 600 }}
              />
              <InlineText
                as="div"
                multiline
                value={it.a}
                onChange={(v) => setItem(i, { a: v })}
                placeholder="Answer"
                style={{ marginTop: 10, color: 'var(--c-muted)', lineHeight: 1.6 }}
              />
              {selected && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); removeItem(i) }}
                  style={{
                    position: 'absolute', top: 6, right: 6,
                    background: 'transparent', border: 'none',
                    color: '#9ca3af', cursor: 'pointer',
                    fontSize: 11,
                  }}
                >Remove</button>
              )}
            </div>
          ))}
          {selected && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); addItem() }}
              style={{
                marginTop: 6,
                padding: '10px 14px',
                background: 'transparent',
                border: '2px dashed var(--c-border)',
                borderRadius: 'var(--r-md, 8px)',
                color: 'var(--c-muted)',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >+ Add question</button>
          )}
        </div>
      </div>
    </section>
  )
}

// ── Columns (container block; nests other blocks) ───────────
//
// ColumnsCanvas no longer manages its own DndContext — the page-level
// DndContext (in PageBuilder) coordinates all drags so blocks can move
// across columns and between columns and the top level.

export function ColumnsCanvas({
  data, onChange, selected,
  parentBlockId, onAddInColumn, renderChild,
}) {
  const cols = Array.isArray(data.columns) ? data.columns : []
  const gapMap = { tight: 16, normal: 32, wide: 56 }
  const gap = gapMap[data.gap || 'normal']
  const alignMap = { top: 'flex-start', center: 'center', bottom: 'flex-end', stretch: 'stretch' }
  const alignItems = alignMap[data.align || 'top']
  const stackBp = data.stackOn === 'tablet' ? 900 : data.stackOn === 'never' ? 0 : 700
  const bg = data.background === 'surface' ? 'var(--c-surface)'
           : data.background === 'accent'  ? 'var(--c-accent)'
           : 'transparent'
  const fg = data.background === 'accent' ? '#fff' : 'inherit'

  return (
    <section className="block columns-block" style={{
      background: bg, color: fg,
      paddingTop: 48, paddingBottom: 48,
    }}>
      <div style={innerContainerStyle(data.container)}>
        <div className="columns-grid" style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${cols.length}, 1fr)`,
          gap, alignItems,
        }}>
          {cols.map((col) => {
            const colBlocks = col.blocks || []
            const parentRef = { kind: 'column', blockId: parentBlockId, columnId: col.id }
            const containerId = parentKey(parentRef)
            return (
              <ColumnDropZone key={col.id}
                containerId={containerId}
                isEmpty={colBlocks.length === 0}
              >
                <SortableContext id={containerId} items={colBlocks.map(b => b.id)} strategy={verticalListSortingStrategy}>
                  {colBlocks.length === 0 ? (
                    <BlockInserter mode="empty" onPick={(k) => onAddInColumn?.(parentRef, 0, k)} />
                  ) : (
                    <>
                      <BlockInserter onPick={(k) => onAddInColumn?.(parentRef, 0, k)} />
                      {colBlocks.map((child, i) => (
                        <div key={child.id}>
                          {renderChild(child, parentRef, i, colBlocks.length)}
                          <BlockInserter onPick={(k) => onAddInColumn?.(parentRef, i + 1, k)} />
                        </div>
                      ))}
                    </>
                  )}
                </SortableContext>
              </ColumnDropZone>
            )
          })}
        </div>
      </div>
      <style>{`
        @media (max-width: ${stackBp}px) {
          .columns-block .columns-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </section>
  )
}

// A column body that registers itself as a droppable. This is what lets
// empty columns receive cross-container drops (the per-block useSortable
// hooks alone don't cover the empty case).
function ColumnDropZone({ containerId, isEmpty, children }) {
  const { setNodeRef, isOver } = useDroppable({
    id: containerId,
    data: { kind: 'container', containerId },
  })
  return (
    <div ref={setNodeRef} style={{
      minHeight: 120,
      outline: isOver ? '2px solid var(--c-primary)' : 'none',
      outlineOffset: -2,
      borderRadius: 8,
      background: isOver ? 'rgba(99,8,18,0.05)' : 'transparent',
      transition: 'background .12s, outline-color .12s',
    }}>
      {children}
    </div>
  )
}

// ── Data placeholder (gallery, hours, contact, find_us, etc.) ─

const DATA_BLOCK_LABELS = {
  gallery:        { title: 'Gallery',          hint: 'Pulls from images uploaded in the Gallery section.' },
  opening_hours:  { title: 'Opening hours',    hint: 'Pulls from manual hours or your venue schedule.' },
  find_us:        { title: 'Find us',          hint: 'Pulls from address + map fields in Find us.' },
  contact:        { title: 'Contact',          hint: 'Pulls from phone, email, and social links.' },
  booking_widget: { title: 'Booking widget',   hint: 'Embeds the live booking widget for this venue.' },
  menu_pdfs:      { title: 'Menus',            hint: 'Lists your uploaded menu PDFs as download links.' },
  allergens:      { title: 'Allergens',        hint: 'Allergen info — PDF download or structured table.' },
}

export function DataPlaceholderCanvas({ data, onChange, blockType }) {
  const meta = DATA_BLOCK_LABELS[blockType] || { title: blockType, hint: 'Pulled from your config at render time.' }
  const set = (k) => (v) => onChange({ ...data, [k]: v })

  return (
    <section className="block" style={{
      paddingTop: 48, paddingBottom: 48,
      background: 'repeating-linear-gradient(45deg, rgba(99,8,18,0.025) 0 12px, transparent 12px 24px)',
      border: '1px dashed rgba(99,8,18,0.25)',
      borderRadius: 'var(--r-md, 8px)',
      margin: '0 24px',
    }}>
      <div style={{ ...innerContainerStyle(data.container), textAlign: 'center' }}>
        <InlineText
          as="h2"
          value={data.heading}
          onChange={set('heading')}
          placeholder={meta.title}
          style={{ fontFamily: 'var(--f-heading)', margin: '0 0 8px', color: 'var(--c-primary)' }}
        />
        <p style={{ margin: 0, color: 'var(--c-muted)', fontSize: 14 }}>
          {meta.title} · <em>{meta.hint}</em>
        </p>
      </div>
    </section>
  )
}

// ── Image picker pieces ──────────────────────────────────────

function ImagePlaceholder({ onChange, scope }) {
  const api = useApi()
  const fileRef = useRef(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [uploading, setUploading]   = useState(false)

  async function handleFiles(files) {
    if (!files?.[0]) return
    setUploading(true)
    try {
      const res = await api.upload('/website/upload', files[0], { kind: 'images', scope })
      onChange(res.url)
    } catch (e) {
      alert(e?.body?.error || e.message || 'Upload failed')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div onClick={(e) => e.stopPropagation()} style={{
      width: '100%', minHeight: 220,
      background: 'rgba(0,0,0,0.04)',
      border: '2px dashed var(--c-border)',
      borderRadius: 'var(--r-md, 8px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column', gap: 12,
      color: 'var(--c-muted)',
    }}>
      <ImageIcon size={32} />
      <p style={{ margin: 0, fontSize: 14 }}>No image yet</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => handleFiles(e.target.files)} />
        <button type="button" onClick={() => fileRef.current?.click()}
          style={pickerBtn} disabled={uploading}>
          {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Upload
        </button>
        <button type="button" onClick={() => setPickerOpen(true)} style={pickerBtn}>
          <ImageIcon size={14} /> Library
        </button>
      </div>
      <MediaLibraryModal open={pickerOpen} onClose={() => setPickerOpen(false)}
        mode="picker" scope={scope} onPick={(picked) => onChange(picked)} />
    </div>
  )
}

function ImagePicker({ label, url, onChange, scope, position = 'top-right' }) {
  const api = useApi()
  const fileRef = useRef(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [uploading, setUploading]   = useState(false)

  async function handleFiles(files) {
    if (!files?.[0]) return
    setUploading(true)
    try {
      const res = await api.upload('/website/upload', files[0], { kind: 'images', scope })
      onChange(res.url)
    } catch (e) {
      alert(e?.body?.error || e.message || 'Upload failed')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const posStyle =
    position === 'bottom-right' ? { bottom: 16, right: 16 } :
    position === 'top-right'    ? { top: 16, right: 16 }    : { top: 16, left: 16 }

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute', ...posStyle,
        zIndex: 18,
        display: 'flex', alignItems: 'center', gap: 6,
        background: 'rgba(31,41,55,0.92)', color: '#fff',
        padding: '6px 8px', borderRadius: 6,
        fontSize: 12, fontWeight: 500,
      }}
    >
      <span style={{ opacity: 0.7 }}>{label}</span>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => handleFiles(e.target.files)} />
      <button type="button" style={floatBtn} onClick={() => fileRef.current?.click()} disabled={uploading}>
        {uploading ? <Loader2 size={12} /> : <Upload size={12} />} {url ? 'Replace' : 'Upload'}
      </button>
      <button type="button" style={floatBtn} onClick={() => setPickerOpen(true)}>
        <ImageIcon size={12} /> Library
      </button>
      {url && (
        <button type="button" style={{ ...floatBtn, color: '#fca5a5' }} onClick={() => onChange(null)}>
          Remove
        </button>
      )}
      <MediaLibraryModal open={pickerOpen} onClose={() => setPickerOpen(false)}
        mode="picker" scope={scope} onPick={(picked) => onChange(picked)} />
    </div>
  )
}

const pickerBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '8px 14px',
  background: '#fff',
  color: '#374151',
  border: '1px solid #e5e7eb',
  borderRadius: 6,
  fontSize: 13, fontWeight: 500,
  cursor: 'pointer',
}

const floatBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '4px 8px',
  background: 'transparent',
  color: 'inherit',
  border: '1px solid rgba(255,255,255,0.2)',
  borderRadius: 4,
  fontSize: 12,
  cursor: 'pointer',
}
